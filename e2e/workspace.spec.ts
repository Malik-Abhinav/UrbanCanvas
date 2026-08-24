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
  expect(fixture.postBodies[0]).toMatchObject({
    bbox: fixtureBbox,
    osmData: createOsmData(),
    userEdits: [signal]
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
