import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Every image byte reaches a reader through the application's own scope-checked route handler. The framework optimiser would serve the same bytes from /_next/image with no per-request authorisation, which is a second, unauthorised route to protected media, so it is switched off.
  images: { unoptimized: true },
  // sharp is a Node-API native addon, so the server compiler cannot bundle its prebuilt binary: it stays external and is loaded at runtime instead. mediabunny is pure TypeScript and could be bundled, but it marks itself on the global object and warns when a second copy executes. A bundle produces exactly that, because
  // the route-handler graph and the RSC graph each compile their own copy into the same server process, so it stays external and is required once at runtime instead: one Node module instance per process rather than one per compiled chunk, which is what the single in-process data service relies on.
  serverExternalPackages: ["sharp", "mediabunny"],
  // A media registration travels as base64 text inside JSON, so the largest admitted video (100 MiB) states as roughly 133 MiB before its poster, caption track and envelope are counted. Next's proxy — this application's one request-level file, which mints the development session cookie — otherwise cuts every request
  // body off at 10 MB, which would make the 10 MiB image and the 100 MiB video the media profile admits unreachable through POST /api/media. The bound matches that route's own transport bound, so a request past it is refused there with a readable reason rather than silently truncated here.
  experimental: { proxyClientMaxBodySize: "192mb" },
  // Next 16 answers 403 to cross-origin development requests for /_next resources from a host it was not told about, and the browser journeys drive the dev server from these loopback hosts. It is read in development only, so it widens nothing in a production build.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Next answers every response with X-Powered-By: Next.js, which names the framework and its version to any client that reads a header. No reader, client or test negotiates on the framework's behalf, so the header is switched off.
  poweredByHeader: false,
  // Every response family leaves the application through this one configuration — the rendered pages, the JSON a Route Handler answers with and the media renditions — so the hardening each of them needs is stated once for every path rather than repeated in every handler. frame-ancestors 'none' together with
  // X-Frame-Options: DENY refuses to be displayed in a frame by any origin, this one included: the dashboard's controls are the real ones, so a page that embedded them could take a click meant for them. X-Frame-Options states the same refusal for a browser that reads it instead of the CSP. X-Content-Type-Options stops
  // a browser deciding a body's type for itself, so a response declared JSON, text or an image is never sniffed into a context its author did not choose. Referrer-Policy: same-origin keeps the application's own URLs, which carry record, page and locale identifiers, out of the Referer of any request a reader's browser
  // makes to another origin. Permissions-Policy refuses camera, microphone, location, payment and USB to the page and to anything it embeds; no workflow here asks for one, so a frame or an injected script cannot request them either. Strict-Transport-Security holds a browser to HTTPS for a year after its first HTTPS
  // response. It carries no includeSubDomains, because the subdomains of the serving host are not part of this application. The CSP states only the directives that need no per-response value. It has no default-src and no script-src, so the framework's own inline bootstrap and the development overlay load unaltered;
  // base-uri and form-action keep one injected <base> tag or one retargeted form from redirecting a submission, and object-src refuses plugin content.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        ],
      },
    ];
  },
};
export default nextConfig;
