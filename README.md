# UrbanCanvas

UrbanCanvas is a 2D urban planning sandbox for sketching street changes on real satellite imagery. Users can search for a place, select a small area, draw infrastructure edits, inspect road-graph metrics, save projects, and run free rule-based change analysis.

## Features

- Mapbox satellite workspace with a fixed Konva drawing overlay
- OSM data fetch for selected bounding boxes
- Drawing tools for roads, bike lanes, sidewalks, crossings, roundabouts, signals, erase, undo, and redo
- Road snapping, crossing snapping, and roundabout snap points
- Road graph analysis: nodes, edges, dead ends, walkability score, and shortest-path picking
- Clerk auth with user-scoped saved projects in Postgres
- Rule-based change analysis with safety observations, pedestrian impact, and suggestions

## Tech Stack

- Next.js, React, TypeScript, Tailwind CSS
- Express, TypeScript, Postgres
- Mapbox GL, Konva, Graphology
- Clerk authentication
- Railway Postgres/API hosting and Vercel frontend hosting

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

- Frontend: `http://localhost:3000`
- API health: `http://localhost:3001/api/health`

## Environment Variables

Frontend:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_mapbox_public_token
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key
```

Backend:

```bash
API_PORT=3001
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME
FRONTEND_ORIGIN=http://localhost:3000
CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key
AI_ANALYSIS_PROVIDER=rules
```

`FRONTEND_ORIGIN` accepts a comma-separated list, which is useful when allowing both local and deployed frontend URLs.

## Useful Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run build:web
npm run build:api
npm run start:api
```

## Deployment

### Frontend on Vercel

1. Create a Vercel project from this GitHub repo.
2. Set:
   - `NEXT_PUBLIC_API_URL=https://your-railway-api.up.railway.app`
   - `NEXT_PUBLIC_MAPBOX_TOKEN=...`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...`
3. Build command is configured in `vercel.json` as `npm run build:web`.

### Backend on Railway

1. Create a Railway service from this GitHub repo.
2. Add a Railway Postgres database and copy its `DATABASE_URL`.
3. Set:
   - `DATABASE_URL=...`
   - `FRONTEND_ORIGIN=https://your-vercel-app.vercel.app`
   - `CLERK_PUBLISHABLE_KEY=...`
   - `CLERK_SECRET_KEY=...`
   - `AI_ANALYSIS_PROVIDER=rules`
4. `railway.json` builds the API with `npm run build:api`, starts it with `npm run start:api`, and health-checks `/api/health`.

## Demo Flow

1. Sign in.
2. Search for a city or neighbourhood.
3. Select a small area and confirm it.
4. Draw sidewalks, bike lanes, crossings, or roundabouts.
5. Inspect road analysis, dead ends, and shortest path.
6. Click **Analyze Changes** for rule-based feedback.
7. Save the project, refresh, then reload it from the Projects list.

## Notes

- Keep selected areas under 5 km2 so Overpass responses stay fast and reliable.
- The current change analyzer is rule-based and free. It is not a traffic simulation or engineering certification.
- The backend is provider-shaped so an Ollama analyzer can be added later without changing the frontend API.
