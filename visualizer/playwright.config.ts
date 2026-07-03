import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5183",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Built + previewed (not `vite dev`): React StrictMode double-invokes effects only in the
    // development build, which would make network-request-count assertions (VZ-1.6 acceptance 2)
    // flaky/wrong. The production build matches real runtime behavior.
    command: "npm run build && npm run preview -- --port 5183 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
