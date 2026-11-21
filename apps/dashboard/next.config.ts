import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every image byte reaches a reader through the application's own scope-checked
  // route handler. The framework optimiser would serve the same bytes from
  // /_next/image with no per-request authorisation, which is a second, unauthorised
  // route to protected media, so it is switched off.
  images: { unoptimized: true },
  // sharp is a Node-API native addon, so the server compiler cannot bundle its
  // prebuilt binary: it stays external and is loaded at runtime instead.
  serverExternalPackages: ["sharp"],
  // Next 16 answers 403 to cross-origin development requests for /_next resources
  // from a host it was not told about, and the browser journeys drive the dev server
  // from these loopback hosts. It is read in development only, so it widens nothing
  // in a production build.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
