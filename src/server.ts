import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import os from 'os';
import { graph } from './core/graph';
import { validateRouteQuery } from './api/validation';
import * as routesController from './api/routesController';

// Load environment variables
dotenv.config();

/**
 * Get the primary network IP address (IPv4)
 * Useful for displaying the network URL for cross-device access
 */
function getNetworkIP(): string | null {
    const interfaces = os.networkInterfaces();

    // Priority: Ethernet > WiFi > Others
    const preferredNames = ['Ethernet', 'Wi-Fi', 'en0', 'eth0', 'wlan0'];

    for (const name of preferredNames) {
        const iface = interfaces[name];
        if (iface) {
            for (const addr of iface) {
                // Skip internal (loopback) and IPv6 addresses
                if (addr.family === 'IPv4' && !addr.internal) {
                    return addr.address;
                }
            }
        }
    }

    // Fallback: find any IPv4 address
    for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (iface) {
            for (const addr of iface) {
                if (addr.family === 'IPv4' && !addr.internal) {
                    return addr.address;
                }
            }
        }
    }

    return null;
}

// Initialize Express app
const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// API Routes
app.get('/api/health', routesController.healthCheck);
app.get('/api/nodes', routesController.getNodes);
app.get('/api/routes/list', routesController.getRoutes);
app.get('/api/routes', validateRouteQuery, routesController.planRoute);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
    res.json({
        service: 'University Bus Routing API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /api/health',
            nodes: 'GET /api/nodes',
            routes: 'GET /api/routes/list',
            plan: 'GET /api/routes?from=NODE_ID&to=NODE_ID&time=HH:MM'
        }
    });
});

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: 'Not found',
        path: req.path
    });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// Start server
async function start() {
    try {
        console.log('\n🚌 University Bus Routing API\n');

        // Load graph data
        console.log('Loading graph data...');
        graph.loadData();

        // Start server on all network interfaces for cross-device access
        app.listen(PORT, '0.0.0.0', () => {
            const networkIP = getNetworkIP();

            console.log(`\n✓ Server running on http://localhost:${PORT}`);

            if (networkIP) {
                console.log(`✓ Network access: http://${networkIP}:${PORT}`);
                console.log(`\n📱 Access from mobile/other devices (same WiFi):`);
                console.log(`   Health check: http://${networkIP}:${PORT}/api/health`);
                console.log(`   Example route: http://${networkIP}:${PORT}/api/routes?from=TILAGOR&to=CAMPUS&time=08:30`);
            } else {
                console.log(`⚠️  Could not detect network IP - check WiFi connection`);
            }

            console.log(`\n💡 Tips for cross-device access:`);
            console.log(`   - Disable Windows Firewall or allow port ${PORT}`);
            console.log(`   - Ensure devices are on the same WiFi network`);
            console.log(`   - Your network IP may change if router reassigns it\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();
