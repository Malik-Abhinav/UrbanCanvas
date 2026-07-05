const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-8 text-canvas-ink">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col justify-between gap-10">
        <div className="flex items-center justify-between border-b border-canvas-ink/10 pb-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-canvas-ink/60">
              UrbanCanvas
            </p>
            <h1 className="mt-2 text-4xl font-semibold sm:text-6xl">
              2D urban planning sandbox
            </h1>
          </div>
          <div className="hidden rounded border border-canvas-ink/15 bg-white/70 px-3 py-2 text-sm text-canvas-ink/70 sm:block">
            Milestone 1
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="border border-canvas-ink/10 bg-white/80 p-6 shadow-sm">
            <h2 className="text-2xl font-semibold">Local app shell is running.</h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-canvas-ink/70">
              This is the blank foundation for the map, selection tools, OSM data fetches,
              canvas editor, project saves, graph analysis, and AI feedback planned in
              the roadmap.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <StatusItem label="Frontend" value="localhost:3000" />
              <StatusItem label="API" value="localhost:3001/api/health" />
              <StatusItem label="Stack" value="Next.js + TypeScript" />
              <StatusItem label="Backend" value="Express + Postgres-ready" />
            </div>
          </div>

          <div className="border border-canvas-ink/10 bg-canvas-ink p-6 text-white shadow-sm">
            <h2 className="text-xl font-semibold">API endpoint</h2>
            <p className="mt-3 text-sm leading-6 text-white/70">
              The backend health check is available here once the dev servers are running:
            </p>
            <a
              className="mt-5 block break-all rounded border border-white/15 bg-white/10 px-4 py-3 font-mono text-sm text-white transition hover:bg-white/15"
              href={`${apiUrl}/api/health`}
            >
              {apiUrl}/api/health
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-canvas-ink/10 bg-canvas-mist px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-canvas-ink/50">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}
