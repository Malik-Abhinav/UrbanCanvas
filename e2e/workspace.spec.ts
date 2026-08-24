import { expect, test } from "@playwright/test";

const appOrigin = "http://127.0.0.1:3100";
const osmEndpoint = "http://localhost:3001/api/osm";

test("workspace reaches deterministic map and selection readiness", async ({ page }) => {
  const blockedRequests: string[] = [];
  const osmBodies: unknown[] = [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin === appOrigin) {
      await route.continue();
      return;
    }

    if (url.href === osmEndpoint && request.method() === "POST") {
      const body = request.postDataJSON() as { bbox?: { north: number; south: number; east: number; west: number } };
      osmBodies.push(body);
      const bbox = body.bbox;

      if (!bbox) {
        await route.fulfill({
          contentType: "application/json",
          status: 400,
          body: JSON.stringify({ status: "error", message: "Missing fixture bbox" })
        });
        return;
      }

      const center = {
        lat: (bbox.north + bbox.south) / 2,
        lng: (bbox.east + bbox.west) / 2
      };
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          status: "ok",
          data: {
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
          }
        })
      });
      return;
    }

    blockedRequests.push(`${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Map workspace" })).toBeVisible();
  await expect(page.getByText("Loading satellite map...")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Mapbox token needed" })).toBeHidden();

  const selectArea = page.getByRole("button", { name: "Select Area" });
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
  await expect(page.getByText(/Approx\. area:/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm Area" }).click();

  await expect(page.getByText("Satellite base frozen. Canvas overlay ready.")).toBeVisible();
  const drawingOverlay = page.getByRole("region", { name: "Drawing canvas overlay" });
  await expect(drawingOverlay).toBeVisible();
  const overlayBox = await drawingOverlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  expect(overlayBox!.width).toBeGreaterThan(0);
  expect(overlayBox!.height).toBeGreaterThan(0);
  await expect(drawingOverlay.locator("canvas").first()).toBeVisible();

  await expect(page.getByText("OSM data stored")).toBeVisible();
  await expect(page.getByLabel("Buildings: 1")).toBeVisible();
  await expect(page.getByLabel("Roads: 1")).toBeVisible();
  expect(osmBodies).toHaveLength(1);
  expect(blockedRequests).toEqual([]);
});
