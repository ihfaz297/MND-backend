import { Request, Response } from 'express';
import { routePlanner } from '../core/planner';
import { graph } from '../core/graph';
import { distanceMatrixClient } from '../infra/distanceMatrixClient';

/**
 * GET /api/routes - Plan a route
 */
export async function planRoute(req: Request, res: Response): Promise<void> {
    try {
        const { from, to, time, currentRoute } = req.query;

        const result = await routePlanner.planRoute(
            from as string,
            to as string,
            time as string,
            currentRoute as string | undefined
        );

        res.json(result);
    } catch (error: any) {
        console.error('Error planning route:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

/**
 * GET /api/nodes - Get all available nodes
 */
export function getNodes(req: Request, res: Response): void {
    try {
        const nodes = graph.getAllNodes();
        res.json({
            count: nodes.length,
            nodes: nodes.map(node => ({
                id: node.id,
                name: node.name,
                type: node.type
            }))
        });
    } catch (error: any) {
        console.error('Error getting nodes:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

/**
 * GET /api/routes/list - Get all available bus routes
 */
export function getRoutes(req: Request, res: Response): void {
    try {
        const routes = graph.getAllRoutes();
        res.json({
            count: routes.length,
            routes: routes.map(route => ({
                route_id: route.route_id,
                name: route.name,
                trips_count: route.trips.length
            }))
        });
    } catch (error: any) {
        console.error('Error getting routes:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

/**
 * GET /api/health - Health check and system status
 */
export function healthCheck(req: Request, res: Response): void {
    try {
        const stats = distanceMatrixClient.getStats();
        const nodes = graph.getAllNodes();
        const routes = graph.getAllRoutes();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            graph: {
                nodes: nodes.length,
                routes: routes.length
            },
            distanceMatrix: {
                available: !!process.env.GOOGLE_DM_API_KEY,
                usage: {
                    monthly: `${stats.monthlyCount}/700`,
                    daily: `${stats.dailyCount}/25`
                },
                cache: {
                    hits: stats.cacheHits,
                    misses: stats.cacheMisses,
                    hitRate: stats.cacheMisses > 0
                        ? `${Math.round(stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100)}%`
                        : 'N/A'
                }
            }
        });
    } catch (error: any) {
        console.error('Error in health check:', error);
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
}
