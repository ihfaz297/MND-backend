import * as fs from 'fs';
import * as path from 'path';
import {
    GraphData,
    Node,
    Edge,
    Route,
    AdjacencyList,
    EdgeInfo,
    PathResult,
    parseTime,
    timeToMinutes
} from './types';

export class Graph {
    private nodes: Map<string, Node> = new Map();
    private edges: Edge[] = [];
    private routes: Map<string, Route> = new Map();
    private adjacencyList: AdjacencyList = {};

    constructor() { }

    /**
     * Load graph data from JSON files
     */
    public loadData(): void {
        const dataDir = path.join(__dirname, '../data');

        // Load nodes
        const nodesPath = path.join(dataDir, 'nodes.json');
        const nodesData: Node[] = JSON.parse(fs.readFileSync(nodesPath, 'utf-8'));
        nodesData.forEach(node => this.nodes.set(node.id, node));

        // Load edges
        const edgesPath = path.join(dataDir, 'edges.json');
        this.edges = JSON.parse(fs.readFileSync(edgesPath, 'utf-8'));

        // Load routes
        const routesPath = path.join(dataDir, 'routes.json');
        const routesData: Route[] = JSON.parse(fs.readFileSync(routesPath, 'utf-8'));
        routesData.forEach(route => this.routes.set(route.route_id, route));

        // Build adjacency list
        this.buildAdjacencyList();

        console.log(`✓ Loaded ${this.nodes.size} nodes, ${this.edges.length} edges, ${this.routes.size} routes`);
    }

    /**
     * Build adjacency list from edges for efficient graph traversal
     */
    private buildAdjacencyList(): void {
        this.adjacencyList = {};

        // Initialize adjacency list for all nodes
        this.nodes.forEach((_, nodeId) => {
            this.adjacencyList[nodeId] = [];
        });

        // Add edges
        this.edges.forEach(edge => {
            const edgeInfo: EdgeInfo = {
                to: edge.to,
                mode: edge.mode,
                route_ids: edge.route_ids,
                time_min: edge.time_min,
                cost: edge.cost
            };

            this.adjacencyList[edge.from].push(edgeInfo);

            // Add reverse edge if not one-way
            if (!edge.one_way) {
                this.adjacencyList[edge.to].push({
                    to: edge.from,
                    mode: edge.mode,
                    route_ids: edge.route_ids,
                    time_min: edge.time_min,
                    cost: edge.cost
                });
            }
        });
    }

    /**
     * Get node by ID
     */
    public getNode(nodeId: string): Node | undefined {
        return this.nodes.get(nodeId);
    }

    /**
     * Get all nodes
     */
    public getAllNodes(): Node[] {
        return Array.from(this.nodes.values());
    }

    /**
     * Get route by ID
     */
    public getRoute(routeId: string): Route | undefined {
        return this.routes.get(routeId);
    }

    /**
     * Get all routes
     */
    public getAllRoutes(): Route[] {
        return Array.from(this.routes.values());
    }

    /**
     * Get adjacency list for a node
     */
    public getNeighbors(nodeId: string): EdgeInfo[] {
        return this.adjacencyList[nodeId] || [];
    }

    /**
     * Find shortest path using only local transport (walk or local)
     * Uses Dijkstra's algorithm
     */
    public localShortestPath(from: string, to: string, allowedModes: ('walk' | 'local')[] = ['walk', 'local']): PathResult {
        // Validate nodes exist
        if (!this.nodes.has(from) || !this.nodes.has(to)) {
            return { found: false, path: [], totalTime: Infinity, totalCost: 0, edges: [] };
        }

        if (from === to) {
            return { found: true, path: [from], totalTime: 0, totalCost: 0, edges: [] };
        }

        // Dijkstra's algorithm
        const distances: Map<string, number> = new Map();
        const costs: Map<string, number> = new Map();
        const previous: Map<string, string | null> = new Map();
        const edgeMap: Map<string, EdgeInfo> = new Map();
        const unvisited: Set<string> = new Set();

        // Initialize
        this.nodes.forEach((_, nodeId) => {
            distances.set(nodeId, Infinity);
            costs.set(nodeId, 0);
            previous.set(nodeId, null);
            unvisited.add(nodeId);
        });

        distances.set(from, 0);

        while (unvisited.size > 0) {
            // Find node with minimum distance
            let current: string | null = null;
            let minDist = Infinity;
            unvisited.forEach(nodeId => {
                const dist = distances.get(nodeId)!;
                if (dist < minDist) {
                    minDist = dist;
                    current = nodeId;
                }
            });

            if (current === null || minDist === Infinity) {
                break; // No path found
            }

            unvisited.delete(current);

            // Found destination
            if (current === to) {
                break;
            }

            // Check neighbors
            const neighbors = this.getNeighbors(current);
            neighbors.forEach(edge => {
                if (!allowedModes.includes(edge.mode as any)) {
                    return; // Skip non-local edges
                }

                if (!unvisited.has(edge.to)) {
                    return; // Already visited
                }

                const newDist = distances.get(current!)! + edge.time_min;
                if (newDist < distances.get(edge.to)!) {
                    distances.set(edge.to, newDist);
                    costs.set(edge.to, costs.get(current!)! + edge.cost);
                    previous.set(edge.to, current);
                    edgeMap.set(edge.to, edge);
                }
            });
        }

        // Reconstruct path
        const finalDist = distances.get(to)!;
        if (finalDist === Infinity) {
            return { found: false, path: [], totalTime: Infinity, totalCost: 0, edges: [] };
        }

        const path: string[] = [];
        const edges: EdgeInfo[] = [];
        let current: string | null = to;

        while (current !== null) {
            path.unshift(current);
            if (previous.get(current)) {
                edges.unshift(edgeMap.get(current)!);
            }
            current = previous.get(current) || null;
        }

        return {
            found: true,
            path,
            totalTime: finalDist,
            totalCost: costs.get(to)!,
            edges
        };
    }

    /**
     * Check if node exists
     */
    public hasNode(nodeId: string): boolean {
        return this.nodes.has(nodeId);
    }

    /**
     * Get direct edge between two nodes (if exists)
     */
    public getEdge(from: string, to: string, mode?: 'bus' | 'local' | 'walk'): EdgeInfo | undefined {
        const neighbors = this.getNeighbors(from);
        return neighbors.find(edge => edge.to === to && (!mode || edge.mode === mode));
    }
}

// Export singleton instance
export const graph = new Graph();
