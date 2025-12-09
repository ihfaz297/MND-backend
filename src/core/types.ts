// ============================================================================
// Data Model Types
// ============================================================================

export interface Node {
    id: string;
    name: string;
    type: 'stop' | 'intersection' | 'destination';
    gmaps_address: string;
    lat?: number;
    lng?: number;
}

export interface Edge {
    from: string;
    to: string;
    mode: 'bus' | 'local' | 'walk';
    route_ids?: string[];
    time_min: number;
    cost: number;
    one_way: boolean;
}

export interface Trip {
    trip_id: string;
    direction: 'to_campus' | 'from_campus';
    stops: string[];
    departure_time: string;
}

export interface Route {
    route_id: string;
    name: string;
    trips: Trip[];
}

// ============================================================================
// Internal Graph Types
// ============================================================================

export interface GraphData {
    nodes: Node[];
    edges: Edge[];
    routes: Route[];
}

export interface AdjacencyList {
    [nodeId: string]: EdgeInfo[];
}

export interface EdgeInfo {
    to: string;
    mode: 'bus' | 'local' | 'walk';
    route_ids?: string[];
    time_min: number;
    cost: number;
}

export interface PathResult {
    found: boolean;
    path: string[];
    totalTime: number;
    totalCost: number;
    edges: EdgeInfo[];
}

// ============================================================================
// API Response Types
// ============================================================================

export interface RouteLeg {
    mode: 'bus' | 'local' | 'walk';
    submode?: 'driving' | 'walking';
    route_id?: string;
    trip_id?: string;
    from: string;
    to: string;
    departure?: string;
    arrival?: string;
    durationMin?: number;
    distanceMeters?: number;
    cost?: number;
    source?: 'graph' | 'distance_matrix';
}

export interface RouteOption {
    label: string;
    category: 'fastest' | 'least_local' | 'both';
    type: 'direct' | 'transfer' | 'local_only';
    transfers: number;
    totalTimeMin: number;
    totalCost: number;
    localTimeMin: number;
    localDistanceMeters: number;
    usesDistanceMatrix: boolean;
    legs: RouteLeg[];
}

export interface RouteResponse {
    from: string;
    to: string;
    requestTime: string;
    options: RouteOption[];
}

// ============================================================================
// Distance Matrix API Types
// ============================================================================

export interface DistanceMatrixResult {
    ok: boolean;
    distanceMeters?: number;
    durationSeconds?: number;
    raw?: any;
    errorMessage?: string;
    fromCache?: boolean;
}

export interface CacheEntry {
    distanceMeters: number;
    durationSeconds: number;
    timestamp: number;
}

export interface UsageStats {
    monthlyCount: number;
    dailyCount: number;
    lastReset: string;
    cacheHits: number;
    cacheMisses: number;
}

// ============================================================================
// Helper Types
// ============================================================================

export interface TimeOfDay {
    hours: number;
    minutes: number;
}

export function parseTime(timeStr: string): TimeOfDay {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return { hours, minutes };
}

export function timeToMinutes(time: TimeOfDay): number {
    return time.hours * 60 + time.minutes;
}

export function minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function addMinutes(timeStr: string, minutesToAdd: number): string {
    const time = parseTime(timeStr);
    const totalMinutes = timeToMinutes(time) + minutesToAdd;
    return minutesToTime(totalMinutes % 1440); // Wrap at 24 hours
}
