import { existsSync } from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const FRONTEND_PORT = 3100
// A default production build embeds ws://localhost:8080/ws.
const BACKEND_PORT = process.env.E2E_PRODUCTION === "1" ? 8080 : 8081

const FRONTEND_ORIGIN = `http://localhost:${FRONTEND_PORT}`
const WS_URL = `ws://localhost:${BACKEND_PORT}/ws`
const production = process.env.E2E_PRODUCTION === "1"
const browserName = process.env.E2E_BROWSER ?? "chromium"
const browserProject = browserName === "firefox" ? "firefox" : browserName === "webkit" ? "webkit" : "chromium"
const browserDevice = browserName === "firefox" ? "Desktop Firefox" : browserName === "webkit" ? "Desktop Safari" : "Desktop Chrome"

// The backend is a workspace sibling. If this folder is checked out on its own,
// the scripted-socket tests still run and the real-backend tests skip themselves.
const repoRoot = path.resolve(__dirname, "..")
const backendAvailable = existsSync(path.join(repoRoot, "RoomsBackend", "package.json"))

if (backendAvailable) process.env.E2E_HAS_BACKEND = "1"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: FRONTEND_ORIGIN,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [{ name: browserProject, use: { ...devices[browserDevice] } }],

  webServer: [
    ...(backendAvailable
      ? [
          {
            // Real backend, rebuilt from the workspace root so the tests always
            // run against the current protocol.
            command: `npm --prefix "${repoRoot}" run build:backend && npm --prefix "${repoRoot}" run start:backend`,
            url: `http://localhost:${BACKEND_PORT}/health`,
            reuseExistingServer: !process.env.CI && !production,
            timeout: 120_000,
            env: {
              PORT: String(BACKEND_PORT),
              ALLOWED_ORIGINS: FRONTEND_ORIGIN,
              SWEEP_MS: "500",
            },
          },
        ]
      : []),
    {
      command: production ? "npm run start" : `npm run dev -- -p ${FRONTEND_PORT}`,
      url: FRONTEND_ORIGIN,
      reuseExistingServer: !process.env.CI && !production,
      timeout: 120_000,
      env: {
        PORT: String(FRONTEND_PORT),
        HOSTNAME: "127.0.0.1",
        NEXT_PUBLIC_WS_URL: WS_URL,
      },
    },
  ],
})
