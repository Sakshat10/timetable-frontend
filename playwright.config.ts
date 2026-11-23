import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the REAL disposable backend (timetable-backend/e2e/dashboard/e2e.sh,
 * http://127.0.0.1:4010, database timetable_dashboard_e2e_test). They never use port 4000, the
 * backend .env, Neon or production data. Error states the real backend cannot produce on demand are
 * simulated per test with page.route() on /api/ only.
 *
 * Before a full run:  ../timetable-backend/e2e/dashboard/e2e.sh restart   (resets the in-memory login limiter)
 * After specs that publish or generate:  e2e.sh reset --yes --seed           (fresh seed)
 */
const PORT = 3100;
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? "http://127.0.0.1:4010";
if (/:4000\b/.test(BACKEND_URL)) throw new Error("Refusing to run e2e tests against port 4000 (the developer backend).");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "app",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
      testIgnore: [/auth\.spec\.ts$/, /responsive\.spec\.ts$/],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
      testMatch: /responsive\.spec\.ts$/,
    },
    { name: "auth", use: { ...devices["Desktop Chrome"] }, testMatch: /auth\.spec\.ts$/ },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { BACKEND_URL, NEXT_DIST_DIR: ".next-e2e" },
  },
});
