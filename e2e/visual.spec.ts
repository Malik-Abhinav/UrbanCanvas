import { expect, test } from "@playwright/test";
import { installApiFixtures } from "./api-fixture";

/**
 * Visual regression coverage (Task 32).
 *
 * These specs capture the stabilized ThreeUI-workbench direction across
 * desktop / tablet / mobile and the key workspace states.
 *
 * OWNER GATE (plan Task 32): reviewed baselines are stored ONLY after the
 * owner selects the final design direction. Until then every test here is
 * skipped. To review and lock baselines:
 *
 *   VISUAL_BASELINES_REVIEWED=1 npx playwright test visual.spec.ts --update-snapshots
 *   # inspect e2e/visual-baselines/**, then export the flag in CI to enforce
 */

const reviewed = Boolean(process.env.VISUAL_BASELINES_REVIEWED);

test.skip(
  !reviewed,
  "Baselines are locked only after owner design review (Task 32 gate). Set VISUAL_BASELINES_REVIEWED=1 during review."
);

test.beforeEach(async ({ page }) => {
  await installApiFixtures(page);
});

async function releaseMap(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Map workspace" })).toBeVisible();
  await page.evaluate(() => window.__releaseUrbanCanvasE2eMap?.());
  await expect(page.getByText("Loading satellite map...")).toBeHidden();
}

test.describe("workspace visuals", () => {
  test("desktop default workbench", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await releaseMap(page);
    await expect(page.getByRole("button", { name: "Select Area" })).toBeVisible();

    await expect(page).toHaveScreenshot("desktop-default.png", { animations: "disabled", fullPage: true });
  });

  test("desktop confirmed area with drawing overlay", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await page.getByRole("button", { name: "Show map legend" }).click();

    await expect(page).toHaveScreenshot("desktop-confirmed-area.png", { animations: "disabled" });
  });

  test("tablet slide-over controls panel", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await releaseMap(page);
    await page.getByRole("button", { name: "Open workspace controls" }).click();
    await expect(page.getByRole("heading", { name: "Map workspace" })).toBeVisible();

    await expect(page).toHaveScreenshot("tablet-drawer-open.png", { animations: "disabled" });
  });

  test("mobile map with bottom sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await releaseMap(page);
    await page.getByRole("button", { name: "Open workspace controls" }).click();
    await expect(page.getByRole("heading", { name: "Map workspace" })).toBeVisible();

    await expect(page).toHaveScreenshot("mobile-sheet-open.png", { animations: "disabled" });
  });
});
