# University Bus Routing API

A graph-based routing engine for Sylhet SUST(Shahjalal University of Science and Technology) campus buses with multi-modal transport optimization (buses + local transport).

## Features

- ✅ **Direct Bus Routing**: Single bus from origin to destination
- ✅ **Bus + Local Hybrid**: Bus as far as possible + walking/CNG
- ✅ **Bus Transfers**: Multi-leg journeys with optimized connections
- ✅ **Dual Optimization**: "Fastest" vs "Least Local Transport"
- ✅ **Local-Only Fallback**: When no buses are available (e.g., missed last bus)
- ✅ **Google Distance Matrix Integration**: For last-mile segments with quota management

## Tech Stack

- **Backend**: Node.js v18+, Express, TypeScript
- **Algorithms**: Dijkstra's algorithm for shortest paths
- **External API**: Google Distance Matrix API (limited use: ~700 calls/month)
- **Data Model**: JSON-based graph (nodes, edges, routes)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your Google Distance Matrix API key:

```bash
cp .env.example .env
```

Edit `.env`:
```
GOOGLE_DM_API_KEY=your_api_key_here
PORT=3000
```

### 3. Run Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3000`

### 4. Build for Production

```bash
npm run build
npm start
```

## API Endpoints

### Plan a Route

```http
GET /api/routes?from=TILAGOR&to=CAMPUS&time=08:30
```

**Query Parameters:**
- `from` (required): Origin node ID
- `to` (required): Destination node ID
- `time` (required): Departure time in HH:MM format
- `currentRoute` (optional): Current bus route ID

**Example Response:**

```json
{
  "from": "TILAGOR",
  "to": "CAMPUS",
  "requestTime": "08:30",
  "options": [
    {
      "label": "Fastest Route",
      "category": "fastest",
      "type": "direct",
      "transfers": 0,
      "totalTimeMin": 45,
      "totalCost": 0,
      "localTimeMin": 0,
      "localDistanceMeters": 0,
      "usesDistanceMatrix": false,
      "legs": [
        {
          "mode": "bus",
          "route_id": "bus1",
          "trip_id": "bus1_0825",
          "from": "TILAGOR",
          "to": "CAMPUS",
          "departure": "08:25",
          "arrival": "09:10",
          "durationMin": 45,
          "cost": 0,
          "source": "graph"
        }
      ]
    }
  ]
}
```

### Get Available Nodes

```http
GET /api/nodes
```

Returns all bus stops, intersections, and destinations.

### Get Bus Routes

```http
GET /api/routes/list
```

Returns all available bus routes with trip counts.

### Health Check

```http
GET /api/health
```

Returns system status and Distance Matrix API usage statistics.

## Data Structure

### Nodes (`src/data/nodes.json`)

19 locations in Sylhet including:
- Bus stops: Tilagor, Shibgonj, Naiorpul, etc.
- Intersections: Shahi Eidgah, Ambarkhana, Subidbazar
- Destinations: Campus, Medical, Zindabazar

### Edges (`src/data/edges.json`)

Directed connections with:
- **Bus edges**: Free travel along bus routes
- **Local edges**: CNG/rickshaw with cost
- **Walk edges**: Free walking paths

### Routes (`src/data/routes.json`)

7 bus routes (bus1-bus7) with scheduled trips:
- Morning departures: 7:30 AM - 9:35 AM
- Afternoon returns: 1:10 PM - 6:30 PM

## Architecture

```
src/
  data/           # JSON graph data
  core/           # Graph algorithms & routing logic
  infra/          # Distance Matrix API client
  api/            # Express controllers & validation
  server.ts       # Application entry point
```

## Distance Matrix API Usage

- **Primary**: Internal graph-based routing
- **Fallback**: Distance Matrix API for last-mile segments only
- **Quota**: 700 calls/month, 25 calls/day
- **Caching**: 7-day TTL to minimize API usage
- **Security**: API key stored in environment variable (never committed)

## Examples

### Direct Bus Route
```bash
curl "http://localhost:3000/api/routes?from=TILAGOR&to=CAMPUS&time=08:30"
```

### Bus + Local Hybrid
```bash
curl "http://localhost:3000/api/routes?from=TILAGOR&to=MEDICAL&time=09:00"
```

### Missed Bus (Local-Only)
```bash
curl "http://localhost:3000/api/routes?from=CAMPUS&to=TILAGOR&time=19:00"
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode with hot-reload
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

## License

MIT
