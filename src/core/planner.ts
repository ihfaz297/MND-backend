import { graph } from './graph';
import { distanceMatrixClient } from '../infra/distanceMatrixClient';
import {
    RouteResponse,
    RouteOption,
    RouteLeg,
    Trip,
    Route,
    parseTime,
    timeToMinutes,
    addMinutes,
    PathResult
} from './types';

export class RoutePlanner {
    /**
     * Main entry point: Plan a route from origin to destination at given time
     */
    public async planRoute(
        from: string,
        to: string,
        requestTime: string,
        currentRoute?: string
    ): Promise<RouteResponse> {
        console.log(`\n📍 Planning route: ${from} → ${to} at ${requestTime}`);

        const options: RouteOption[] = [];

        // Validate nodes
        if (!graph.hasNode(from) || !graph.hasNode(to)) {
            return { from, to, requestTime, options: [] };
        }

        // Same origin and destination
        if (from === to) {
            return { from, to, requestTime, options: [] };
        }

        // Try all bus routes
        const allRoutes = graph.getAllRoutes();

        for (const route of allRoutes) {
            // Try direct bus route
            const directOption = await this.directBusRoute(route, from, to, requestTime);
            if (directOption) {
                options.push(directOption);
            }

            // Try bus + local hybrid
            const hybridOption = await this.busToLocalRoute(route, from, to, requestTime);
            if (hybridOption) {
                options.push(hybridOption);
            }
        }

        // Try multi-leg transfers
        const transferOptions = await this.findTransferRoutes(from, to, requestTime);
        options.push(...transferOptions);

        // Local-only fallback
        const localOption = await this.localOnlyRoute(from, to);
        if (localOption) {
            options.push(localOption);
        }

        // Compare and classify routes
        const finalOptions = this.compareRoutes(options);

        console.log(`✓ Found ${finalOptions.length} route options`);
        return { from, to, requestTime, options: finalOptions };
    }

    /**
     * Feature 1: Direct bus routing (single bus from origin to destination)
     */
    private async directBusRoute(
        route: Route,
        from: string,
        to: string,
        requestTime: string
    ): Promise<RouteOption | null> {
        // Find trips that serve both stops
        for (const trip of route.trips) {
            const fromIndex = trip.stops.indexOf(from);
            const toIndex = trip.stops.indexOf(to);

            // Check if both stops are on this trip and in correct order
            if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) {
                continue;
            }

            // Calculate departure time from origin
            const hopsBefore = fromIndex;
            const tripStart = parseTime(trip.departure_time);
            const tripStartMin = timeToMinutes(tripStart);

            // Estimate time to reach 'from' stop
            const timeToFrom = hopsBefore * 5; // 5 min average per hop
            const departureMin = tripStartMin + timeToFrom;

            // Check if this departure is after requested time
            const requestMin = timeToMinutes(parseTime(requestTime));
            if (departureMin < requestMin) {
                continue;
            }

            // Calculate travel time and arrival
            const hops = toIndex - fromIndex;
            const travelTime = hops * 5; // 5 min average per hop
            const arrivalTime = addMinutes(trip.departure_time, timeToFrom + travelTime);
            const departureTime = addMinutes(trip.departure_time, timeToFrom);

            // Create route option
            const leg: RouteLeg = {
                mode: 'bus',
                route_id: route.route_id,
                trip_id: trip.trip_id,
                from,
                to,
                departure: departureTime,
                arrival: arrivalTime,
                durationMin: travelTime,
                cost: 0,
                source: 'graph'
            };

            return {
                label: `${route.name} Direct`,
                category: 'fastest',
                type: 'direct',
                transfers: 0,
                totalTimeMin: travelTime + (departureMin - requestMin),
                totalCost: 0,
                localTimeMin: 0,
                localDistanceMeters: 0,
                usesDistanceMatrix: false,
                legs: [leg]
            };
        }

        return null;
    }

    /**
     * Feature 2: Bus + local hybrid (bus as far as possible, then local transport)
     */
    private async busToLocalRoute(
        route: Route,
        from: string,
        to: string,
        requestTime: string
    ): Promise<RouteOption | null> {
        let bestOption: RouteOption | null = null;
        let minTotalTime = Infinity;

        for (const trip of route.trips) {
            const fromIndex = trip.stops.indexOf(from);
            if (fromIndex === -1) continue;

            // Try each possible drop-off stop after 'from'
            for (let i = fromIndex + 1; i < trip.stops.length; i++) {
                const dropOffStop = trip.stops[i];
                if (dropOffStop === to) continue; // Direct route handled separately

                // Calculate local segment from drop-off to destination
                const localPath = graph.localShortestPath(dropOffStop, to);
                let localTime = localPath.totalTime;
                let localCost = localPath.totalCost;
                let localDistance = 0;
                let usedDM = false;

                // If no local path in graph, try Distance Matrix
                if (!localPath.found) {
                    const dmResult = await distanceMatrixClient.getLocalSegment(dropOffStop, to, 'driving');
                    if (dmResult.ok) {
                        localTime = Math.round((dmResult.durationSeconds || 0) / 60);
                        localDistance = dmResult.distanceMeters || 0;
                        localCost = Math.round(localDistance / 100) * 2; // Estimate: 2 BDT per 100m
                        usedDM = true;
                    } else {
                        continue; // Skip this drop-off point
                    }
                }

                // Calculate bus segment
                const hopsBefore = fromIndex;
                const busHops = i - fromIndex;
                const timeToFrom = hopsBefore * 5;
                const busTravelTime = busHops * 5;

                const tripStartMin = timeToMinutes(parseTime(trip.departure_time));
                const departureMin = tripStartMin + timeToFrom;
                const requestMin = timeToMinutes(parseTime(requestTime));

                if (departureMin < requestMin) continue;

                const waitTime = departureMin - requestMin;
                const totalTime = waitTime + busTravelTime + localTime;

                if (totalTime < minTotalTime) {
                    minTotalTime = totalTime;

                    const busLeg: RouteLeg = {
                        mode: 'bus',
                        route_id: route.route_id,
                        trip_id: trip.trip_id,
                        from,
                        to: dropOffStop,
                        departure: addMinutes(trip.departure_time, timeToFrom),
                        arrival: addMinutes(trip.departure_time, timeToFrom + busTravelTime),
                        durationMin: busTravelTime,
                        cost: 0,
                        source: 'graph'
                    };

                    const localLeg: RouteLeg = {
                        mode: 'local',
                        submode: 'driving',
                        from: dropOffStop,
                        to,
                        durationMin: localTime,
                        distanceMeters: localDistance,
                        cost: localCost,
                        source: usedDM ? 'distance_matrix' : 'graph'
                    };

                    bestOption = {
                        label: `${route.name} + Local`,
                        category: 'fastest',
                        type: 'direct',
                        transfers: 0,
                        totalTimeMin: totalTime,
                        totalCost: localCost,
                        localTimeMin: localTime,
                        localDistanceMeters: localDistance,
                        usesDistanceMatrix: usedDM,
                        legs: [busLeg, localLeg]
                    };
                }
            }
        }

        return bestOption;
    }

    /**
     * Feature 3: Bus transfers (multi-leg journeys)
     */
    private async findTransferRoutes(
        from: string,
        to: string,
        requestTime: string
    ): Promise<RouteOption[]> {
        const options: RouteOption[] = [];
        const allRoutes = graph.getAllRoutes();

        // Try all route pairs
        for (const route1 of allRoutes) {
            for (const route2 of allRoutes) {
                if (route1.route_id === route2.route_id) continue;

                // Find common transfer points
                const transferPoints = this.findTransferPoints(route1, route2);

                for (const transferNode of transferPoints) {
                    const option = await this.createTransferRoute(
                        route1, route2, from, to, transferNode, requestTime
                    );
                    if (option) {
                        options.push(option);
                    }
                }
            }
        }

        return options;
    }

    /**
     * Find shared stops between two routes
     */
    private findTransferPoints(route1: Route, route2: Route): string[] {
        const stops1 = new Set<string>();
        route1.trips.forEach(trip => trip.stops.forEach(stop => stops1.add(stop)));

        const stops2 = new Set<string>();
        route2.trips.forEach(trip => trip.stops.forEach(stop => stops2.add(stop)));

        return Array.from(stops1).filter(stop => stops2.has(stop));
    }

    /**
     * Create a transfer route option
     */
    private async createTransferRoute(
        route1: Route,
        route2: Route,
        from: string,
        to: string,
        transferNode: string,
        requestTime: string
    ): Promise<RouteOption | null> {
        // Find trip on route1 from 'from' to 'transferNode'
        const leg1 = await this.directBusRoute(route1, from, transferNode, requestTime);
        if (!leg1) return null;

        // Calculate arrival time at transfer point
        const arrivalAtTransfer = leg1.legs[0].arrival!;

        // Find trip on route2 from 'transferNode' to 'to'
        const leg2 = await this.directBusRoute(route2, transferNode, to, arrivalAtTransfer);
        if (!leg2) return null;

        // Check wait time at transfer stop
        const arrivalMin = timeToMinutes(parseTime(arrivalAtTransfer));
        const departureMin = timeToMinutes(parseTime(leg2.legs[0].departure!));
        const waitTime = departureMin - arrivalMin;

        // Only suggest if wait time is reasonable (≤ 15 min)
        if (waitTime < 0 || waitTime > 15) {
            return null;
        }

        const totalTime = leg1.totalTimeMin + waitTime + leg2.legs[0].durationMin!;

        return {
            label: `Transfer at ${graph.getNode(transferNode)?.name}`,
            category: 'fastest',
            type: 'transfer',
            transfers: 1,
            totalTimeMin: totalTime,
            totalCost: 0,
            localTimeMin: 0,
            localDistanceMeters: 0,
            usesDistanceMatrix: false,
            legs: [...leg1.legs, ...leg2.legs]
        };
    }

    /**
     * Feature 5: Local-only fallback (missed bus scenario)
     */
    private async localOnlyRoute(from: string, to: string): Promise<RouteOption | null> {
        // Try local shortest path first
        const localPath = graph.localShortestPath(from, to);

        if (localPath.found) {
            const legs: RouteLeg[] = localPath.edges.map((edge, idx) => ({
                mode: edge.mode,
                from: localPath.path[idx],
                to: localPath.path[idx + 1],
                durationMin: edge.time_min,
                cost: edge.cost,
                source: 'graph'
            }));

            return {
                label: 'Local Transport Only',
                category: 'least_local',
                type: 'local_only',
                transfers: 0,
                totalTimeMin: localPath.totalTime,
                totalCost: localPath.totalCost,
                localTimeMin: localPath.totalTime,
                localDistanceMeters: 0,
                usesDistanceMatrix: false,
                legs
            };
        }

        // Fallback to Distance Matrix
        const dmResult = await distanceMatrixClient.getLocalSegment(from, to, 'driving');
        if (dmResult.ok) {
            const leg: RouteLeg = {
                mode: 'local',
                submode: 'driving',
                from,
                to,
                durationMin: Math.round((dmResult.durationSeconds || 0) / 60),
                distanceMeters: dmResult.distanceMeters || 0,
                cost: Math.round((dmResult.distanceMeters || 0) / 100) * 2,
                source: 'distance_matrix'
            };

            return {
                label: 'Local Transport Only',
                category: 'least_local',
                type: 'local_only',
                transfers: 0,
                totalTimeMin: leg.durationMin!,
                totalCost: leg.cost!,
                localTimeMin: leg.durationMin!,
                localDistanceMeters: leg.distanceMeters!,
                usesDistanceMatrix: true,
                legs: [leg]
            };
        }

        return null;
    }

    /**
     * Feature 4: Compare routes and classify as FASTEST vs LEAST_LOCAL
     */
    private compareRoutes(options: RouteOption[]): RouteOption[] {
        if (options.length === 0) return [];

        // Remove duplicates
        const unique = this.deduplicateOptions(options);

        // Find fastest
        let fastest = unique[0];
        for (const option of unique) {
            if (option.totalTimeMin < fastest.totalTimeMin) {
                fastest = option;
            }
        }

        // Find least local
        let leastLocal = unique[0];
        for (const option of unique) {
            if (option.localTimeMin < leastLocal.localTimeMin) {
                leastLocal = option;
            }
        }

        // Mark categories
        const result: RouteOption[] = [];
        const addedIds = new Set<string>();

        if (fastest) {
            fastest.category = 'fastest';
            fastest.label = 'Fastest Route';
            result.push(fastest);
            addedIds.add(this.getOptionId(fastest));
        }

        if (leastLocal && this.getOptionId(leastLocal) !== this.getOptionId(fastest)) {
            leastLocal.category = 'least_local';
            leastLocal.label = 'Least Local Transport';
            result.push(leastLocal);
        }

        // Add other options if we have less than 3
        for (const option of unique) {
            if (result.length >= 3) break;
            const id = this.getOptionId(option);
            if (!addedIds.has(id)) {
                result.push(option);
                addedIds.add(id);
            }
        }

        return result;
    }

    private getOptionId(option: RouteOption): string {
        return option.legs.map(leg => `${leg.from}-${leg.to}-${leg.mode}`).join('|');
    }

    private deduplicateOptions(options: RouteOption[]): RouteOption[] {
        const seen = new Set<string>();
        const result: RouteOption[] = [];

        for (const option of options) {
            const id = this.getOptionId(option);
            if (!seen.has(id)) {
                seen.add(id);
                result.push(option);
            }
        }

        return result;
    }
}

// Export singleton instance
export const routePlanner = new RoutePlanner();
