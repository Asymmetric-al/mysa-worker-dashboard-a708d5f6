import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
/** The runner for the domain and integration suites: both import the data service, the domain modules and the file-backed store directly, so they need no DOM and no browser. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/domain/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // `e2e/` is excluded because Playwright owns it; the other two are build and dependency output.
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
