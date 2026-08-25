import { defineConfig, devices } from "@playwright/test";
import { getPlaywrightPort } from "./lib/e2e-fixtures";

const port = getPlaywrightPort();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `node scripts/run-e2e-web-server.mjs ${port}`,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}`
  }
});
