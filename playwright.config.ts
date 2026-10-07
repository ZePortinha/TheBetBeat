import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { TEST_APP_PORT, TEST_APP_URL, testEnv } from "./tests/test-env";

// The runner, its workers (fixtures read process.env first) and the app
// server all use the test stack, never the dev database.
Object.assign(process.env, testEnv);

// A repo-local SWC cache: the default %LOCALAPPDATA%\swc can carry a DACL
// Turbopack rejects (OneDrive/AV), which stops `next dev` from starting.
const SWC_CACHE = process.env.SWC_NATIVE_BINDING_CACHE ?? path.resolve(__dirname, ".swc-cache");

export default defineConfig({
  testDir: "./tests/e2e",
  // Starts the test stack and puts it back to migrations + seed.
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,
  // `pnpm dev` compiles each route on first visit: the first navigation can take >5 s.
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? TEST_APP_URL,
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
        command: `pnpm exec next dev --turbopack -p ${TEST_APP_PORT}`,
        url: TEST_APP_URL,
        reuseExistingServer: true,
        timeout: 180_000,
        env: { ...testEnv, SWC_NATIVE_BINDING_CACHE: SWC_CACHE },
      },
});
