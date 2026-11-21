import { defineConfig } from "@playwright/test";

/**
 * The browser suite's one project: the journeys drive the real application over HTTP, so the
 * configuration names exactly two things — where the specs live and which origin serves them.
 *
 * The origin is read from `PORT` rather than fixed, and the same value feeds `baseURL` and the dev
 * server's environment, so a checkout that renders on another port still finds the application it
 * started instead of a neighbour's; `reuseExistingServer` keeps a server someone already runs
 * rather than fighting for the port.
 *
 * Readiness is the port accepting connections, not a path answering 200: the first page routes are
 * added by the features themselves, and a readiness probe bound to one of them would make the whole
 * suite depend on that route still existing.
 *
 * The specs own the rest of their setup: each journey resets the seed it works from and selects the
 * persona it acts as, so a run is repeatable without the configuration deciding order or state.
 */
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // A journey mutates the one synthetic store, so specs never run beside each other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: "bun run dev",
    port,
    env: { PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" },
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
