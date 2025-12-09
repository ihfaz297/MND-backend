import axios from 'axios';
import { graph } from '../core/graph';
import {
    DistanceMatrixResult,
    CacheEntry,
    UsageStats
} from '../core/types';

class DistanceMatrixClient {
    private apiKey: string;
    private cache: Map<string, CacheEntry> = new Map();
    private usageStats: UsageStats = {
        monthlyCount: 0,
        dailyCount: 0,
        lastReset: new Date().toISOString().slice(0, 10),
        cacheHits: 0,
        cacheMisses: 0
    };
    private readonly MONTHLY_LIMIT = 700;
    private readonly DAILY_LIMIT = 50;
    private readonly CACHE_TTL_DAYS = 7;

    constructor() {
        // Read API key from environment
        this.apiKey = process.env.GOOGLE_DM_API_KEY || '';

        if (!this.apiKey) {
            console.warn('⚠️  GOOGLE_DM_API_KEY not set. Distance Matrix features will be disabled.');
        } else {
            console.log('✓ Distance Matrix client initialized');
        }
    }

    /**
     * Get local segment duration and distance between two nodes
     */
    public async getLocalSegment(
        originNodeId: string,
        destNodeId: string,
        mode: 'driving' | 'walking' = 'driving'
    ): Promise<DistanceMatrixResult> {
        // Check if API key is available
        if (!this.apiKey) {
            return {
                ok: false,
                errorMessage: 'Distance Matrix API key not configured'
            };
        }

        // Reset counters if date changed
        this.checkAndResetCounters();

        // Check cache first
        const cacheKey = `${originNodeId}|${destNodeId}|${mode}`;
        const cached = this.cache.get(cacheKey);

        if (cached && this.isCacheValid(cached)) {
            this.usageStats.cacheHits++;
            console.log(`  ✓ Cache hit: ${originNodeId} → ${destNodeId}`);
            return {
                ok: true,
                distanceMeters: cached.distanceMeters,
                durationSeconds: cached.durationSeconds,
                fromCache: true
            };
        }

        // Check quota
        if (this.usageStats.monthlyCount >= this.MONTHLY_LIMIT) {
            console.warn(`  ⚠️  Monthly limit reached (${this.MONTHLY_LIMIT})`);
            return {
                ok: false,
                errorMessage: 'Monthly API quota exceeded'
            };
        }

        if (this.usageStats.dailyCount >= this.DAILY_LIMIT) {
            console.warn(`  ⚠️  Daily limit reached (${this.DAILY_LIMIT})`);
            return {
                ok: false,
                errorMessage: 'Daily API quota exceeded'
            };
        }

        // Get node addresses
        const originNode = graph.getNode(originNodeId);
        const destNode = graph.getNode(destNodeId);

        if (!originNode || !destNode) {
            return {
                ok: false,
                errorMessage: 'Invalid node IDs'
            };
        }

        // Make API call
        this.usageStats.cacheMisses++;
        console.log(`  🌐 Distance Matrix API: ${originNodeId} → ${destNodeId} (${mode})`);

        try {
            const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                params: {
                    origins: originNode.gmaps_address,
                    destinations: destNode.gmaps_address,
                    mode: mode,
                    key: this.apiKey
                },
                timeout: 10000 // 10 second timeout
            });

            // Increment usage counters
            this.usageStats.monthlyCount++;
            this.usageStats.dailyCount++;

            const data = response.data;

            // Check top-level status
            if (data.status !== 'OK') {
                console.error(`  ✗ Distance Matrix error: ${data.status}`);
                return {
                    ok: false,
                    errorMessage: `API status: ${data.status}`,
                    raw: data
                };
            }

            // Check element status
            const element = data.rows[0]?.elements[0];
            if (!element || element.status !== 'OK') {
                console.error(`  ✗ Element status: ${element?.status || 'MISSING'}`);
                return {
                    ok: false,
                    errorMessage: `Element status: ${element?.status || 'MISSING'}`,
                    raw: data
                };
            }

            // Extract distance and duration
            const distanceMeters = element.distance?.value || 0;
            const durationSeconds = element.duration?.value || 0;

            // Cache the result
            this.cache.set(cacheKey, {
                distanceMeters,
                durationSeconds,
                timestamp: Date.now()
            });

            console.log(`  ✓ ${distanceMeters}m, ${durationSeconds}s`);

            return {
                ok: true,
                distanceMeters,
                durationSeconds,
                raw: data,
                fromCache: false
            };

        } catch (error: any) {
            console.error(`  ✗ Distance Matrix request failed: ${error.message}`);
            return {
                ok: false,
                errorMessage: `Network error: ${error.message}`
            };
        }
    }

    /**
     * Pre-warm cache with common routes
     */
    public async prewarmCache(pairs: Array<[string, string, 'driving' | 'walking']>): Promise<void> {
        console.log(`\n🔥 Pre-warming cache with ${pairs.length} common routes...`);

        for (const [origin, dest, mode] of pairs) {
            await this.getLocalSegment(origin, dest, mode);
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`✓ Cache pre-warming complete`);
        this.printStats();
    }

    /**
     * Get current usage statistics
     */
    public getStats(): UsageStats {
        return { ...this.usageStats };
    }

    /**
     * Print usage statistics
     */
    public printStats(): void {
        console.log('\n📊 Distance Matrix Usage:');
        console.log(`  Monthly: ${this.usageStats.monthlyCount}/${this.MONTHLY_LIMIT}`);
        console.log(`  Daily: ${this.usageStats.dailyCount}/${this.DAILY_LIMIT}`);
        console.log(`  Cache hits: ${this.usageStats.cacheHits}`);
        console.log(`  Cache misses: ${this.usageStats.cacheMisses}`);
        console.log(`  Cache size: ${this.cache.size} entries`);
    }

    /**
     * Clear cache (for testing)
     */
    public clearCache(): void {
        this.cache.clear();
        console.log('✓ Cache cleared');
    }

    /**
     * Reset usage counters (for testing)
     */
    public resetCounters(): void {
        this.usageStats.monthlyCount = 0;
        this.usageStats.dailyCount = 0;
        this.usageStats.cacheHits = 0;
        this.usageStats.cacheMisses = 0;
        console.log('✓ Usage counters reset');
    }

    /**
     * Check if cached entry is still valid
     */
    private isCacheValid(entry: CacheEntry): boolean {
        const ageMs = Date.now() - entry.timestamp;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        return ageDays < this.CACHE_TTL_DAYS;
    }

    /**
     * Reset daily/monthly counters if date changed
     */
    private checkAndResetCounters(): void {
        const today = new Date().toISOString().slice(0, 10);

        if (this.usageStats.lastReset !== today) {
            // New day
            this.usageStats.dailyCount = 0;

            // Check if new month
            const lastMonth = this.usageStats.lastReset.slice(0, 7); // YYYY-MM
            const currentMonth = today.slice(0, 7);

            if (lastMonth !== currentMonth) {
                this.usageStats.monthlyCount = 0;
                console.log('✓ Monthly quota reset');
            }

            this.usageStats.lastReset = today;
            console.log('✓ Daily quota reset');
        }
    }
}

// Export singleton instance
export const distanceMatrixClient = new DistanceMatrixClient();
