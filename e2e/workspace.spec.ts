import { expect, test } from "@playwright/test";
import {
  createOsmData,
  fixtureBbox,
  fixtureProjectId,
  installApiFixtures
} from "./api-fixture";

async function releaseMap(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Map workspace" })).toBeVisible();
  await page.evaluate(() => window.__releaseUrbanCanvasE2eMap?.());
  await expect(page.getByText("Loading satellite map...")).toBeHidden();
}

async function prepareUnsavedCanvas(page: import("@playwright/test").Page) {
  await releaseMap(page);
  const selectArea = page.getByRole("button", { name: "Select Area" });
  await selectArea.click();
  const mapCanvas = page.getByRole("region", { name: "Map canvas" });
  const box = await mapCanvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.48, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Confirm Area" }).click();
  await expect(page.getByText("OSM data stored")).toBeVisible();
}

function savedProject(userEdits: unknown[] = []) {
  const timestamp = "2026-08-24T00:00:00.000Z";
  return {
    bbox: fixtureBbox,
    created_at: timestamp,
    id: fixtureProjectId,
    name: "Saved neighborhood",
    osm_data: createOsmData(),
    updated_at: timestamp,
    user_edits: userEdits
  };
}

const osmEndpoint = "http://localhost:3001/api/osm";

test("workspace reaches deterministic map and selection readiness", async ({ page }) => {
  const fixture = await installApiFixtures(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Map workspace" })).toBeVisible();
  const projectName = page.getByLabel("Project name");
  await expect(projectName).toHaveAttribute("maxlength", "80");
  await expect(page.getByText("16 / 80 characters")).toBeVisible();
  await projectName.fill("x".repeat(80));
  await expect(projectName).toHaveAccessibleDescription("80 / 80 characters");

  const selectArea = page.getByRole("button", { name: "Select Area" });
  await expect(page.getByText("Loading satellite map...")).toBeVisible();
  await expect(selectArea).toBeDisabled();
  await expect(selectArea).toHaveAccessibleDescription("Wait for the satellite map to finish loading before selecting an area.");

  await page.evaluate(() => window.__releaseUrbanCanvasE2eMap?.());
  await expect(page.getByText("Loading satellite map...")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Mapbox token needed" })).toBeHidden();
  await expect(selectArea).toBeEnabled();
  await selectArea.click();
  await expect(page.getByRole("button", { name: "Selecting..." })).toHaveAttribute("aria-pressed", "true");

  const mapCanvas = page.getByRole("region", { name: "Map canvas" });
  const box = await mapCanvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.48, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByText("Selected bounds")).toBeVisible();
  await page.getByRole("button", { name: "Confirm Area" }).click();
  await expect(page.getByText("Satellite base frozen. Canvas overlay ready.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Drawing canvas overlay" })).toBeVisible();
  await expect(page.getByText("OSM data stored")).toBeVisible();
  await expect(page.getByLabel("Buildings: 1")).toBeVisible();
  expect(fixture.osmBodies).toHaveLength(1);
  expect(fixture.blockedRequests).toEqual([]);
});

test("a failed first save retries with the identical browser-generated project id", async ({ page }) => {
  const fixture = await installApiFixtures(page, { failFirstSave: true });
  await prepareUnsavedCanvas(page);
  await page.getByLabel("Project name").fill("Retry-safe plan");

  await page.getByRole("button", { name: "Save Project" }).click();
  await expect(page.getByText("Could not reach the UrbanCanvas API. Is the server running?")).toBeVisible();
  await page.getByRole("button", { name: "Save Project" }).click();
  await expect(page.getByText("Project saved.")).toBeVisible();

  expect(fixture.postBodies).toHaveLength(2);
  const firstId = fixture.postBodies[0].id;
  expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(fixture.postBodies[1].id).toBe(firstId);
  expect(fixture.blockedRequests).toEqual([]);
});

test("deleting the active saved project keeps its area, OSM data, drawings, and canvas open as unsaved", async ({ page }) => {
  const signal = { id: "signal-1", point: { lat: 28.61, lng: 77.21 }, type: "signal" };
  const fixture = await installApiFixtures(page, { project: savedProject([signal]) });
  await releaseMap(page);
  await page.getByRole("button", { name: /Saved neighborhood Updated/ }).click();
  await expect(page.getByText("Project loaded.")).toBeVisible();

  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Delete this saved project? Your current canvas will stay open as an unsaved project.");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Delete project Saved neighborhood" }).click();

  await expect(page.getByText("Saved project deleted. Your canvas remains open as an unsaved project.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Project" })).toBeEnabled();
  await expect(page.getByText("Selected bounds")).toBeVisible();
  await expect(page.getByText("OSM data stored")).toBeVisible();
  await expect(page.getByRole("region", { name: "Drawing canvas overlay" })).toBeVisible();
  await expect(page.getByText("No saved projects yet.")).toBeVisible();
  expect(fixture.deleteRequests).toEqual([`/api/projects/${fixtureProjectId}`]);

  await page.getByRole("button", { name: "Save Project" }).click();
  await expect(page.getByText("Project saved.")).toBeVisible();

  // Drawings persist as the schemaVersion 1 document envelope, migrated from
  // the loaded legacy signal.
  expect(fixture.postBodies[0]).toMatchObject({
    bbox: fixtureBbox,
    osmData: createOsmData(),
    userEdits: {
      metadata: { designBasis: "concept-only", locale: "IN" },
      objects: [
        {
          geometry: { point: { lat: 28.61, lng: 77.21 }, type: "Point" },
          id: "signal-1",
          properties: { kind: "vehicle" },
          type: "traffic-signal"
        }
      ],
      schemaVersion: 1
    }
  });
  expect(fixture.blockedRequests).toEqual([]);
});

test("loading mixed drawing entries recovers valid drawings and warns about skipped entries", async ({ page }) => {
  const validSignal = { id: "signal-1", point: { lat: 28.61, lng: 77.21 }, type: "signal" };
  const fixture = await installApiFixtures(page, {
    project: savedProject([validSignal, { id: "broken", type: "teleporter" }])
  });
  await releaseMap(page);
  await page.getByRole("button", { name: /Saved neighborhood Updated/ }).click();

  await expect(page.getByText("Project loaded with 1 invalid drawing skipped.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Drawing canvas overlay" })).toBeVisible();
  await expect(page.getByText("OSM data stored")).toBeVisible();
  expect(fixture.blockedRequests).toEqual([]);
});

test("rate-limited OSM fetch counts down then retries the same confirmed bounds", async ({ page }) => {
  const fixture = await installApiFixtures(page);
  const osmBodies: Array<{ bbox?: { north: number; south: number; east: number; west: number } }> = [];

  // Registered after installApiFixtures, so this route wins for the OSM endpoint.
  await page.route(osmEndpoint, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { bbox?: { north: number; south: number; east: number; west: number } };
    osmBodies.push(body);

    if (osmBodies.length === 1) {
      await route.fulfill({
        contentType: "application/json",
        headers: {
          "access-control-expose-headers": "retry-after",
          "retry-after": "3"
        },
        status: 429,
        body: JSON.stringify({ status: "error", message: "Too many requests." })
      });
      return;
    }

    const bbox = body.bbox!;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        status: "ok",
        data: {
          bbox,
          buildings: [],
          counts: { buildings: 0, openLand: 0, roads: 1 },
          openLand: [],
          roads: [
            {
              geometry: [
                { lat: bbox.south, lng: bbox.west },
                { lat: bbox.north, lng: bbox.east }
              ],
              id: 2001,
              kind: "residential",
              tags: { highway: "residential" }
            }
          ]
        }
      })
    });
  });

  await page.goto("/");
  await expect(page.getByText("Loading satellite map...")).toBeVisible();
  await page.evaluate(() => window.__releaseUrbanCanvasE2eMap?.());
  const selectArea = page.getByRole("button", { name: "Select Area" });
  await expect(selectArea).toBeEnabled();
  await selectArea.click();

  const mapCanvas = page.getByRole("region", { name: "Map canvas" });
  const box = await mapCanvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.48, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Confirm Area" }).click();

  const retryButton = page.getByRole("button", { name: /^Retry OSM in [1-3]s$/ });
  await expect(page.getByRole("alert").filter({ hasText: "Too many requests." })).toContainText("Too many requests.");
  await expect(retryButton).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry OSM" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry OSM" }).click();

  await expect(page.getByText("OSM data stored")).toBeVisible();
  expect(osmBodies).toHaveLength(2);
  expect(osmBodies[1]).toEqual(osmBodies[0]);
  expect(fixture.blockedRequests).toEqual([]);
});

type CanvasState = {
  objects: Array<{
    geometry: { points?: Array<{ lat: number; lng: number }>; type: string };
    id: string;
    properties: { laneWidthMetres: number; lanes: number };
    type: string;
  }>;
  rendered: Array<{ id: string; strokeWidth?: number; type: string }>;
};

// Mirrors app/drawing-document-bridge metresPerPixelAt + MIN_ROAD_WIDTH_PX.
function expectedRoadWidthPx(lat: number, zoom: number) {
  const metresPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

  return Math.max(4, 7 / metresPerPixel);
}

async function readCanvasState(page: import("@playwright/test").Page): Promise<CanvasState> {
  return page.evaluate(() => window.__urbanCanvasE2eCanvasState?.()) as Promise<CanvasState>;
}

test("a drawn road renders with scale-dependent width and persists through save and reload", async ({ page }) => {
  const fixture = await installApiFixtures(page);
  await releaseMap(page);

  // Select most of the map canvas: the drawing overlay mirrors this rectangle,
  // and a wide overlay keeps the analysis panel clear of the drawing tools.
  await page.getByRole("button", { name: "Select Area" }).click();
  const mapCanvas = page.getByRole("region", { name: "Map canvas" });
  const canvasBox = await mapCanvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.1, canvasBox!.y + canvasBox!.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.9, canvasBox!.y + canvasBox!.height * 0.9, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Confirm Area" }).click();
  await expect(page.getByText("OSM data stored")).toBeVisible();
  await page.getByLabel("Project name").fill("Scale plan");

  // Draw at a high simulated zoom: the default road (2 lanes x 3.5 m) is well
  // above the minimum pixel floor there.
  await page.evaluate(() => window.__setUrbanCanvasE2eMapZoom?.(18));
  await page.getByRole("button", { name: "Road / Lane" }).click();
  const overlay = page.getByRole("region", { name: "Drawing canvas overlay" });
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.35, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.55, { steps: 4 });
  await page.mouse.up();

  let state: CanvasState | undefined;
  await expect
    .poll(async () => {
      state = await readCanvasState(page);

      return state?.objects.length ?? 0;
    })
    .toBe(1);
  const road = state!.objects[0];
  expect(road.type).toBe("road");
  expect(road.geometry.type).toBe("LineString");
  expect(road.geometry.points).toHaveLength(2);
  expect(road.properties).toMatchObject({ laneWidthMetres: 3.5, lanes: 2 });

  const anchorLat = road.geometry.points![1].lat;
  const renderedRoad = state!.rendered.find((object) => object.id === road.id);
  expect(renderedRoad?.strokeWidth).toBeCloseTo(expectedRoadWidthPx(anchorLat, 18), 5);

  await page.getByRole("button", { name: "Save Project" }).click();
  await expect(page.getByText("Project saved.")).toBeVisible();

  // The saved payload is the schemaVersion 1 document with real properties.
  expect(fixture.postBodies[0].userEdits).toMatchObject({
    metadata: { locale: "IN" },
    objects: [{ geometry: { type: "LineString" }, id: road.id, properties: { lanes: 2 }, type: "road" }],
    schemaVersion: 1
  });

  // Reload the app and load the saved project back.
  await releaseMap(page);
  await page.getByRole("button", { name: /Scale plan Updated/ }).click();
  await expect(page.getByText("Project loaded.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Drawing canvas overlay" })).toBeVisible();

  // A different zoom must re-derive the width from the stored metres.
  await page.evaluate(() => window.__setUrbanCanvasE2eMapZoom?.(17));
  let reloaded: CanvasState | undefined;
  await expect
    .poll(async () => {
      reloaded = await readCanvasState(page);

      return reloaded.objects.map((object) => object.id).join(",");
    })
    .toBe(road.id);
  expect(reloaded!.objects[0].geometry.points).toEqual(road.geometry.points);
  const reloadedLat = reloaded!.objects[0].geometry.points![1].lat;
  expect(reloadedLat).toBeCloseTo(anchorLat, 9);
  await expect
    .poll(async () => (await readCanvasState(page)).rendered.find((object) => object.id === road.id)?.strokeWidth)
    .toBeCloseTo(expectedRoadWidthPx(anchorLat, 17), 5);
  // Widths at z17 and z18 differ, proving pixels are derived from metres.
  expect(expectedRoadWidthPx(anchorLat, 17)).not.toBeCloseTo(expectedRoadWidthPx(anchorLat, 18), 3);

  // Zoom far out: the real-metre width drops below the visibility floor.
  await page.evaluate(() => window.__setUrbanCanvasE2eMapZoom?.(12));
  await expect
    .poll(async () => (await readCanvasState(page)).rendered.find((object) => object.id === road.id)?.strokeWidth)
    .toBe(4);
  expect(fixture.blockedRequests).toEqual([]);
});
