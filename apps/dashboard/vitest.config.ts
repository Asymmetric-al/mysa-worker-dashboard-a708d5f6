import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The runner for the domain and integration suites: both import the data service, the domain
 * modules and the file-backed store directly, so they need no DOM and no browser.
 *
 * `environment: "node"` is deliberate — a claim about rendered components belongs to the Playwright
 * specs in `e2e/`, never to a simulated DOM here.
 *
 * The `@` alias is mapped by hand because Vitest resolves Vite's `resolve.alias` and does not read
 * the TypeScript `paths` in `tsconfig.base.json`. It reproduces that mapping exactly — `@/*` is
 * `apps/dashboard/src/*`, which is `./src` from this file — instead of opening a second namespace.
 *
 * `passWithNoTests` keeps its default of `false`, so an empty suite fails instead of passing
 * quietly. No threshold block or reporting provider belongs here either: the project sets no
 * numeric target for the suite and installs no provider of one.
 */
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
