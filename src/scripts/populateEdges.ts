import dotenv from 'dotenv';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const API_KEY = process.env.GOOGLE_DM_API_KEY;

if (!API_KEY) {
    console.error('❌ GOOGLE_DM_API_KEY not found in .env file!');
    process.exit(1);
}

interface Node {
    id: string;
    name: string;
    gmaps_address: string;
}

interface Route {
    route_id: string;
    trips: Array<{
        stops: string[];
    }>;
}

interface EdgeData {
    from: string;
    to: string;
    mode: string;
    route_ids?: string[];
    time_min: number;
    distance_meters: number;
    cost: number;
    one_way: boolean;
    source: string;
}

async function getDistanceMatrix(origin: string, destination: string): Promise<{ durationSeconds: number, distanceMeters: number } | null> {
    try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
            params: {
                origins: origin,
                destinations: destination,
                mode: 'driving',
                key: API_KEY
            }
        });

        if (response.data.status !== 'OK') {
            console.error(`    ✗ API Error: ${response.data.status}`);
            return null;
        }

        const element = response.data.rows[0]?.elements[0];
        if (element?.status !== 'OK') {
            console.error(`    ✗ Route Error: ${element?.status || 'NO_DATA'}`);
            return null;
        }

        return {
            durationSeconds: element.duration.value,
            distanceMeters: element.distance.value
        };
    } catch (error: any) {
        console.error(`    ✗ Request failed: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log('\n🚀 Populating edges.json with real Distance Matrix data\n');

    // Load data files  
    const dataDir = path.join(__dirname, '../data');
    const nodesPath = path.join(dataDir, 'nodes.json');
    const routesPath = path.join(dataDir, 'routes.json');
    const cachePath = path.join(dataDir, 'distance_cache.json');
    const edgesPath = path.join(dataDir, 'edges.json');

    const nodes: Node[] = JSON.parse(fs.readFileSync(nodesPath, 'utf-8'));
    const routes: Route[] = JSON.parse(fs.readFileSync(routesPath, 'utf-8'));

    // Create node lookup
    const nodeMap = new Map<string, Node>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // Load or create cache
    let cache: any = {};
    if (fs.existsSync(cachePath)) {
        cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        console.log(`📦 Loaded cache with ${Object.keys(cache).length} entries\n`);
    }

    // Extract unique stop pairs
    const stopPairs = new Map<string, { from: string, to: string, route_ids: string[] }>();

    console.log('📍 Extracting stop pairs from routes...\n');
    for (const route of routes) {
        for (const trip of route.trips) {
            for (let i = 0; i < trip.stops.length - 1; i++) {
                const from = trip.stops[i];
                const to = trip.stops[i + 1];
                const key = `${from}|${to}`;

                if (stopPairs.has(key)) {
                    const existing = stopPairs.get(key)!;
                    if (!existing.route_ids.includes(route.route_id)) {
                        existing.route_ids.push(route.route_id);
                    }
                } else {
                    stopPairs.set(key, { from, to, route_ids: [route.route_id] });
                }
            }
        }
    }

    console.log(`✓ Found ${stopPairs.size} unique stop pairs\n`);
    console.log('🌐 Fetching distance data from Google Maps...\n');

    const edges: EdgeData[] = [];
    let apiCalls = 0;
    let cacheHits = 0;
    let errors = 0;

    for (const [key, pair] of stopPairs) {
        const cacheKey = `${pair.from}|${pair.to}|driving`;

        // Check cache
        if (cache[cacheKey]) {
            cacheHits++;
            const cached = cache[cacheKey];

            edges.push({
                from: pair.from,
                to: pair.to,
                mode: 'bus',
                route_ids: pair.route_ids,
                time_min: Math.round(cached.durationSeconds / 60),
                distance_meters: cached.distanceMeters,
                cost: 0,
                one_way: false,
                source: 'distance_matrix'
            });

            const fromNode = nodeMap.get(pair.from);
            const toNode = nodeMap.get(pair.to);
            console.log(`  ✓ [CACHE] ${fromNode?.name} → ${toNode?.name}: ${Math.round(cached.durationSeconds / 60)} min, ${cached.distanceMeters} m`);
            continue;
        }

        // Get addresses
        const fromNode = nodeMap.get(pair.from);
        const toNode = nodeMap.get(pair.to);

        if (!fromNode || !toNode) {
            console.error(`  ✗ Missing node: ${pair.from} or ${pair.to}`);
            errors++;
            continue;
        }

        // Call API
        const result = await getDistanceMatrix(fromNode.gmaps_address, toNode.gmaps_address);

        if (result) {
            apiCalls++;

            // Save to cache
            cache[cacheKey] = {
                distanceMeters: result.distanceMeters,
                durationSeconds: result.durationSeconds,
                timestamp: new Date().toISOString()
            };

            edges.push({
                from: pair.from,
                to: pair.to,
                mode: 'bus',
                route_ids: pair.route_ids,
                time_min: Math.round(result.durationSeconds / 60),
                distance_meters: result.distanceMeters,
                cost: 0,
                one_way: false,
                source: 'distance_matrix'
            });

            console.log(`  ✓ [API] ${fromNode.name} → ${toNode.name}: ${Math.round(result.durationSeconds / 60)} min, ${result.distanceMeters} m`);

            // Delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
        } else {
            errors++;
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  Total pairs: ${stopPairs.size}`);
    console.log(`  API calls: ${apiCalls}`);
    console.log(`  Cache hits: ${cacheHits}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Bus edges created: ${edges.length}`);

    // Add local transport and walking edges
    console.log(`\n🚶 Adding local transport and walking edges...\n`);

    const localEdges: EdgeData[] = [
        { from: 'SHAHI_EIDGAH', to: 'SUBIDBAZAR', mode: 'local', time_min: 8, distance_meters: 2000, cost: 30, one_way: false, source: 'estimated' },
        { from: 'AMBARKHANA', to: 'CHOWHATTA', mode: 'local', time_min: 6, distance_meters: 1500, cost: 25, one_way: false, source: 'estimated' },
        { from: 'SUBIDBAZAR', to: 'RIKABI_BAZAR', mode: 'local', time_min: 5, distance_meters: 1200, cost: 20, one_way: false, source: 'estimated' },
        { from: 'NAIORPUL', to: 'SHAHI_EIDGAH', mode: 'local', time_min: 10, distance_meters: 2500, cost: 40, one_way: false, source: 'estimated' },
        { from: 'KUMARPARA', to: 'AMBARKHANA', mode: 'local', time_min: 8, distance_meters: 1800, cost: 35, one_way: false, source: 'estimated' },
        { from: 'TILAGOR', to: 'NAIORPUL', mode: 'local', time_min: 15, distance_meters: 3500, cost: 50, one_way: false, source: 'estimated' },
        { from: 'CAMPUS', to: 'MODINA_MARKET', mode: 'walk', time_min: 5, distance_meters: 400, cost: 0, one_way: false, source: 'estimated' },
        { from: 'MODINA_MARKET', to: 'PATHANTULA', mode: 'walk', time_min: 4, distance_meters: 300, cost: 0, one_way: false, source: 'estimated' },
        { from: 'PATHANTULA', to: 'SUBIDBAZAR', mode: 'walk', time_min: 6, distance_meters: 500, cost: 0, one_way: false, source: 'estimated' },
        { from: 'SUBIDBAZAR', to: 'AMBARKHANA', mode: 'walk', time_min: 8, distance_meters: 650, cost: 0, one_way: false, source: 'estimated' },
        { from: 'AMBARKHANA', to: 'SHAHI_EIDGAH', mode: 'walk', time_min: 7, distance_meters: 550, cost: 0, one_way: false, source: 'estimated' },
        { from: 'CHOWHATTA', to: 'RIKABI_BAZAR', mode: 'walk', time_min: 6, distance_meters: 450, cost: 0, one_way: false, source: 'estimated' },
        { from: 'RIKABI_BAZAR', to: 'SUBIDBAZAR', mode: 'walk', time_min: 7, distance_meters: 600, cost: 0, one_way: false, source: 'estimated' }
    ];

    const allEdges = [...edges, ...localEdges];

    // Save cache
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    console.log(`\n💾 Cache saved: ${Object.keys(cache).length} entries`);

    // Save edges
    fs.writeFileSync(edgesPath, JSON.stringify(allEdges, null, 2));

    console.log(`\n✅ SUCCESS! Created ${allEdges.length} total edges:`);
    console.log(`   - ${edges.length} bus edges (from Distance Matrix API)`);
    console.log(`   - ${localEdges.length} local/walking edges (estimated)`);
    console.log(`\n📁 Saved to: ${edgesPath}\n`);
}

main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
