import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Every image byte reaches a reader through the application's own scope-checked
  // route handler. The framework optimiser would serve the same bytes from
  // /_next/image with no per-request authorisation, which is a second, unauthorised
  // route to protected media, so it is switched off.
  images: { unoptimized: true },
  // sharp is a Node-API native addon, so the server compiler cannot bundle its
  // prebuilt binary: it stays external and is loaded at runtime instead.
  // mediabunny is pure TypeScript and could be bundled, but it marks itself on the
  // global object and warns when a second copy executes. A bundle produces exactly
  // that, because the route-handler graph and the RSC graph each compile their own
  // copy into the same server process, so it stays external and is required once at
  // runtime instead: one Node module instance per process rather than one per
  // compiled chunk, which is what the single in-process data service relies on.
  serverExternalPackages: ["sharp", "mediabunny"],
  // A media registration travels as base64 text inside JSON, so the largest admitted video (100 MiB)
  // states as roughly 133 MiB before its poster, caption track and envelope are counted. Next's proxy —
  // this application's one request-level file, which mints the development session cookie — otherwise
  // cuts every request body off at 10 MB, which would make the 10 MiB image and the 100 MiB video the
  // media profile admits unreachable through POST /api/media. The bound matches that route's own
  // transport bound, so a request past it is refused there with a readable reason rather than silently
  // truncated here.
  experimental: { proxyClientMaxBodySize: "192mb" },
  // Next 16 answers 403 to cross-origin development requests for /_next resources
  // from a host it was not told about, and the browser journeys drive the dev server
  // from these loopback hosts. It is read in development only, so it widens nothing
  // in a production build.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
export default nextConfig;
