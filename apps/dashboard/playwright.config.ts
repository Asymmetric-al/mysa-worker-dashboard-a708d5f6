import { defineConfig } from "@playwright/test";
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  // The browser journeys are added under `e2e/` as they are written, so an empty spec set is not a
  // failure: the `test` script passes `--pass-with-no-tests`, and vitest gates `tests/` in the meantime.
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
