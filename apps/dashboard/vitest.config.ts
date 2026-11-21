import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
/** The runner for the domain and integration suites: both import the data service, the domain modules and the file-backed store directly, so they need no DOM and no browser. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Every suite drives the one file-backed synthetic store at the repository root, and the goal suite resets
    // that whole store, so files running beside each other let the reset discard a sibling suite's private
    // fixture session mid-run. One file at a time is what makes the suite repeatable.
    fileParallelism: false,
    include: ["tests/domain/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // `e2e/` is excluded because Playwright owns it; the other two are build and dependency output.
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
