import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);
const reuseServers = process.env.PLAYWRIGHT_REUSE_SERVER === "1" && !isCi;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run engine:serve",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: reuseServers,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: reuseServers,
      timeout: 30_000,
    },
  ],
});
