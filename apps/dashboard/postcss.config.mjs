/**
 * The Tailwind 4 pipeline for src/styles/globals.css, and the only build-side piece of it.
 *
 * Next hands every CSS `@import` to PostCSS, so `@tailwindcss/postcss` bundles `tailwindcss` and
 * the `tw-animate-css` utilities from the application's own `node_modules`. Without this file
 * Turbopack resolves those package imports itself from the workspace root, where Bun installs only
 * the root devDependencies, and the build stops on the first `@import` it cannot find.
 *
 * One plugin and an empty options object, because Tailwind 4 reads its theme from the stylesheet's
 * @theme and @theme inline blocks: there is no JavaScript theme config and no option to pass here.
 * Prefixing, minification and @import resolution are already the plugin's own job, and any further
 * transform would rewrite the token values globals.css keeps single-sourced.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
