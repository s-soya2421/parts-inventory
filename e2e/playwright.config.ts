import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "./specs",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1, // A single local D1 database is shared between tests.
  reporter: [
    ["list"],
    ["html", { outputFolder: "./playwright-report", open: "never" }],
  ],
  outputDir: "./test-results",
  use: {
    baseURL,
    httpCredentials: {
      username: process.env.E2E_BASIC_AUTH_USER ?? "e2e",
      password: process.env.E2E_BASIC_AUTH_PASSWORD ?? "test-only-secret",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
