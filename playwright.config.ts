import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,
  // `pnpm dev` compiles each route on first visit: the first navigation can take >5 s.
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["iPhone 14 Pro"], viewport: { width: 393, height: 852 } },
    },
    {
      name: "ipad",
      use: { viewport: { width: 1194, height: 834 }, hasTouch: true },
    },
    {
      name: "tv-landscape",
      use: { viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "tv-portrait",
      use: { viewport: { width: 1080, height: 1920 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
