# UrbanCanvas

UrbanCanvas is a web-based urban planning sandbox for selecting a real location, drawing proposed street infrastructure over satellite imagery, and analyzing the effect of those edits with map data, graph metrics, and rule-based feedback.

**Live app:** https://urban-canvas-flax.vercel.app  
**Repository:** https://github.com/Malik-Abhinav/UrbanCanvas

## Features

- **Location search**
  - Search for cities, neighbourhoods, localities, and addresses using Mapbox Geocoding.
  - Move the satellite map directly to the selected result.

- **Bounding-box area selection**
  - Draw a rectangular area on the map.
  - Display north, south, east, and west coordinates.
  - Estimate selected area size and limit selections to small workable regions.

- **Satellite editing workspace**
  - Freeze the selected satellite area.
  - Overlay a Konva drawing canvas that stays aligned with the selected map bounds.
  - Pan and zoom the frozen satellite base without resizing the selected edit area.
  - Collapse the sidebar for a larger map workspace.

- **Infrastructure drawing tools**
  - Road / lane segments
  - Bike lanes
  - Sidewalks
  - Pedestrian crossings
  - Roundabouts
  - Traffic signals
  - Eraser
  - Undo / redo

- **OpenStreetMap context**
  - Fetch roads, buildings, land use, and leisure/open-land features from Overpass.
  - Store OSM data with saved projects.
  - Use road geometry for snapping and analysis.

- **Snapping**
  - Snap drawn roads, bike lanes, and sidewalks to nearby OSM road geometry.
  - Snap crossings perpendicular to nearby roads.
  - Snap roundabout entries/exits to nearby road vertices and roundabout points.

- **Road graph analysis**
  - Build a graph from OSM roads.
  - Display node count, edge count, and dead-end count.
  - Highlight dead-end road segments.
  - Estimate sidewalk coverage as a walkability score.
  - Pick two road points to show a shortest path.

- **Project persistence**
  - Clerk-authenticated users can save projects.
  - Saved projects include selected bounds, OSM data, and user edits.
  - Projects are scoped to the signed-in Clerk user.
  - Supports manual save and timed auto-save.

- **Rule-based change analysis**
  - Analyze user edits without paid AI credits.
  - Generate safety observations, pedestrian impact notes, and suggestions.
  - Keep analysis explicitly framed as rule-based guidance, not traffic simulation or engineering certification.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js App Router, React 19, TypeScript |
| Styling | Tailwind CSS, custom CSS utilities |
| Map | Mapbox GL JS, Mapbox Geocoding API, Mapbox satellite tiles |
| Canvas | Konva, React Konva |
| Icons | Lucide React |
| Backend | Node.js, Express, TypeScript |
| Auth | Clerk for Next.js and Clerk Express middleware |
| Database | Postgres via Neon |
| OSM data | Overpass API |
| Graph analysis | Graphology, graphology-shortest-path |
| Deployment | Vercel frontend, Render API service |
| Tooling | ESLint, TypeScript, tsx, concurrently |

## Architecture Overview

UrbanCanvas is split into a Next.js frontend and an Express API.

```text
Browser
  |
  | Next.js app on Vercel
  | - Mapbox satellite map
  | - Konva edit overlay
  | - Clerk frontend auth
  |
  v
Express API on Render
  |
  | Public routes
  | - /api/health
  | - /api/osm
  |
  | Authenticated routes
  | - /api/projects
  | - /api/analyze
  |
  v
Neon Postgres
  |
  | users
  | projects
  | project_state
```

### Frontend Flow

1. The user searches for a location with Mapbox Geocoding.
2. The user draws and confirms a small bounding box.
3. The app freezes the selected satellite area and places a Konva canvas over it.
4. The frontend calls `/api/osm` to fetch OSM features for the selected bounds.
5. Drawing tools use map-to-screen projection helpers so edits stay aligned with the satellite base.
6. Saved projects and analysis calls include Clerk auth tokens.

### Backend Flow

1. Express serves health, OSM, project, and analysis endpoints.
2. `/api/osm` validates the bounding box, calls Overpass, and returns parsed features.
3. Project routes use Clerk auth to scope saved projects by user.
4. Project data is stored in Postgres as selected bounds, OSM data, and serialized user edits.
5. `/api/analyze` runs the local rule-based analyzer over OSM counts, selected bounds, and user edits.

## Local Setup

### Prerequisites

- Node.js
- npm
- Postgres database URL
- Mapbox public token
- Clerk application keys

### Install

```bash
npm install
cp .env.example .env
```

Fill in `.env` with the required values below.

### Run Locally

```bash
npm run dev
```

Open:

- Frontend: http://localhost:3000
- API health: http://localhost:3001/api/health

## Environment Variables

### Frontend

| Variable | Required | Description |
|---|---:|---|
| `NEXT_PUBLIC_API_URL` | Yes | URL of the Express API. Use `http://localhost:3001` locally. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Public Mapbox token for maps and geocoding. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key for the Next.js frontend. |

### Backend

| Variable | Required | Description |
|---|---:|---|
| `DATABASE_URL` | Yes | Postgres connection string. Neon pooled connection strings work well in production. |
| `FRONTEND_ORIGIN` | Yes | Allowed CORS origin, for example `http://localhost:3000` or the Vercel domain. Accepts comma-separated origins. |
| `CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key used by the Express Clerk middleware. |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key used by authenticated API routes. |
| `AI_ANALYSIS_PROVIDER` | Yes | Set to `rules` for the local rule-based analyzer. |
| `API_PORT` | Local only | Optional local API port. Defaults to `3001`. Render provides `PORT` automatically. |

Example local values:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_MAPBOX_TOKEN=pk_your_mapbox_token
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key

API_PORT=3001
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME
FRONTEND_ORIGIN=http://localhost:3000
CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key
AI_ANALYSIS_PROVIDER=rules
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run frontend and API together. |
| `npm run dev:web` | Run only the Next.js app on port 3000. |
| `npm run dev:api` | Run only the Express API with `tsx watch`. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Type-check frontend and backend TypeScript. |
| `npm run build` | Build frontend and backend. |
| `npm run build:web` | Build only the Next.js frontend. |
| `npm run build:api` | Compile only the Express API. |
| `npm run start:api` | Start the compiled Express API. |

## Deployment

### Frontend: Vercel

Set these environment variables in Vercel:

```text
NEXT_PUBLIC_API_URL=https://your-render-api.onrender.com
NEXT_PUBLIC_MAPBOX_TOKEN=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
```

Build command:

```bash
npm run build:web
```

### Backend: Render

Create a Render Web Service using:

```bash
npm ci && npm run build:api
```

Start command:

```bash
npm run start:api
```

Set these environment variables in Render:

```text
DATABASE_URL=...
FRONTEND_ORIGIN=https://urban-canvas-flax.vercel.app
CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
AI_ANALYSIS_PROVIDER=rules
```

Health check:

```text
/api/health
```

### Database: Neon

Use a Neon Postgres connection string as `DATABASE_URL`. The API creates the required tables automatically when project routes are used.

## Known Limitations

- Selected areas are limited to 5 km² to keep Overpass requests fast and reliable.
- OSM coverage varies by location; snapping and graph analysis depend on available OSM road geometry.
- The walkability score is a heuristic based on sidewalk coverage over graph edges, not a calibrated mobility model.
- The change analysis is rule-based and does not run a traffic simulation.
- Render free services may cold-start after inactivity.
- Mapbox, Clerk, Neon, Vercel, Render, and Overpass availability affect the deployed app.

## License

See [LICENSE](./LICENSE).
