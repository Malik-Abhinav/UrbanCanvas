# UrbanCanvas

UrbanCanvas is a 2D urban planning sandbox built with Next.js, Express, and Postgres.

## Milestone 1

The repo is scaffolded with:

- Next.js + TypeScript frontend on `http://localhost:3000`
- Express + TypeScript backend on `http://localhost:3001`
- Postgres connection wiring through `DATABASE_URL`
- A combined local dev script

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

- Frontend: `http://localhost:3000`
- API health: `http://localhost:3001/api/health`

## Postgres

Create a Postgres database on Railway, copy its connection string, and set it in `.env`:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME
```

The API health endpoint reports whether the database is configured and reachable.
