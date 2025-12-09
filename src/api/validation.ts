import { Request, Response, NextFunction } from 'express';
import { graph } from '../core/graph';

/**
 * Validate route query parameters
 */
export function validateRouteQuery(req: Request, res: Response, next: NextFunction): void {
    const { from, to, time } = req.query;

    // Check required parameters
    if (!from || !to || !time) {
        res.status(400).json({
            error: 'Missing required parameters',
            required: ['from', 'to', 'time'],
            received: { from, to, time }
        });
        return;
    }

    // Validate node IDs exist
    if (!graph.hasNode(from as string)) {
        res.status(400).json({
            error: 'Invalid origin node',
            message: `Node '${from}' not found`,
            hint: 'Use GET /api/nodes to see available nodes'
        });
        return;
    }

    if (!graph.hasNode(to as string)) {
        res.status(400).json({
            error: 'Invalid destination node',
            message: `Node '${to}' not found`,
            hint: 'Use GET /api/nodes to see available nodes'
        });
        return;
    }

    // Validate time format (HH:MM)
    const timeStr = time as string;
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(timeStr)) {
        res.status(400).json({
            error: 'Invalid time format',
            message: `Time '${timeStr}' is not in HH:MM format`,
            example: '08:30'
        });
        return;
    }

    next();
}
