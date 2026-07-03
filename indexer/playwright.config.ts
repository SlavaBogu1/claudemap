import { defineConfig, devices } from "@playwright/test";
import { API_TEST_PORT, ORIGIN_TEST_PORT } from "./e2e/constants";

// CR-API-02 real-browser CORS check only. Everything else in this repo's Indexer test suite is
// `npm test` (vitest + supertest, in-process — never subject to real browser CORS enforcement).
// This is the one suite that needs a real Chromium making a real cross-origin request.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  use: {
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      command: "npx tsx e2e/server/api-server.ts",
      port: API_TEST_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    },
    {
      command: "npx tsx e2e/server/origin-server.ts",
      port: ORIGIN_TEST_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    }
  ]
});
