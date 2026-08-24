import type { Page, Route } from "@playwright/test";
import { getPlaywrightPort } from "../lib/e2e-fixtures";

export const appOrigin = `http://127.0.0.1:${getPlaywrightPort()}`;
export const apiOrigin = "http://localhost:3001";
export const fixtureProjectId = "22222222-2222-4222-8222-222222222222";
export const fixtureBbox = { north: 28.615, south: 28.605, east: 77.215, west: 77.205 };

export type ApiFixtureOptions = {
  failFirstSave?: boolean;
  project?: Record<string, unknown>;
};

export type ApiFixtureState = {
  blockedRequests: string[];
  deleteRequests: string[];
  osmBodies: unknown[];
  postBodies: Array<Record<string, unknown>>;
};

export function createOsmData(bbox = fixtureBbox) {
  const center = {
    lat: (bbox.north + bbox.south) / 2,
    lng: (bbox.east + bbox.west) / 2
  };
  return {
    bbox,
    buildings: [
      {
        geometry: [
          { lat: center.lat, lng: center.lng },
          { lat: center.lat, lng: center.lng + 0.0001 },
          { lat: center.lat - 0.0001, lng: center.lng + 0.0001 },
          { lat: center.lat, lng: center.lng }
        ],
        id: 1001,
        kind: "building",
        tags: { building: "yes" }
      }
    ],
    counts: { buildings: 1, openLand: 1, roads: 1 },
    openLand: [
      {
        geometry: [
          { lat: center.lat + 0.0002, lng: center.lng },
          { lat: center.lat + 0.0002, lng: center.lng + 0.0001 },
          { lat: center.lat + 0.0001, lng: center.lng },
          { lat: center.lat + 0.0002, lng: center.lng }
        ],
        id: 1003,
        kind: "park",
        tags: { leisure: "park" }
      }
    ],
    roads: [
      {
        geometry: [
          { lat: bbox.south, lng: bbox.west },
          { lat: bbox.north, lng: bbox.east }
        ],
        id: 1002,
        kind: "residential",
        tags: { highway: "residential" }
      }
    ]
  };
}

export async function installApiFixtures(page: Page, options: ApiFixtureOptions = {}): Promise<ApiFixtureState> {
  const state: ApiFixtureState = { blockedRequests: [], deleteRequests: [], osmBodies: [], postBodies: [] };
  let project = options.project ?? null;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin === appOrigin) {
      await route.continue();
      return;
    }

    if (url.origin !== apiOrigin) {
      state.blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (url.pathname === "/api/osm" && request.method() === "POST") {
      const body = request.postDataJSON() as { bbox?: typeof fixtureBbox };
      state.osmBodies.push(body);
      if (!body.bbox) {
        await json(route, 400, { status: "error", message: "Missing fixture bbox" });
        return;
      }
      await json(route, 200, { status: "ok", data: createOsmData(body.bbox) });
      return;
    }

    if (url.pathname === "/api/projects" && request.method() === "GET") {
      await json(route, 200, {
        status: "ok",
        projects: project
          ? [
              {
                bbox: project.bbox,
                created_at: project.created_at,
                id: project.id,
                name: project.name,
                updated_at: project.updated_at
              }
            ]
          : []
      });
      return;
    }

    if (url.pathname === "/api/projects" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.postBodies.push(body);
      if (options.failFirstSave && state.postBodies.length === 1) {
        await route.abort("timedout");
        return;
      }
      const timestamp = "2026-08-24T00:00:00.000Z";
      project = {
        ...body,
        created_at: timestamp,
        osm_data: body.osmData,
        updated_at: timestamp,
        user_edits: body.userEdits
      };
      await json(route, 200, { status: "ok", project });
      return;
    }

    if (url.pathname.startsWith("/api/projects/") && request.method() === "GET" && project) {
      await json(route, 200, { status: "ok", project });
      return;
    }

    if (url.pathname.startsWith("/api/projects/") && request.method() === "DELETE") {
      state.deleteRequests.push(url.pathname);
      project = null;
      await json(route, 200, { status: "ok" });
      return;
    }

    state.blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });

  return state;
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({ contentType: "application/json", status, body: JSON.stringify(body) });
}
