/**
 * The cold-start warm-up the browser suite runs once, before its first test.
 *
 * `next dev` compiles a route the first time that route is asked for, and the development client a
 * loaded document runs answers a compile notification for its own page by re-rendering the router or, on
 * a reload message, by reloading the document itself: `next/dist/client/dev/hot-reloader/app/hot-reloader-app.js`
 * answers `SERVER_COMPONENT_CHANGES` with `hmrRefresh()` and `RELOAD_PAGE` with `window.location.reload()`.
 * On a server that has not compiled the route yet, a journey's first navigation is therefore also that
 * route's first compile: the document the journey opened reloads under it, the `/api` requests it had in
 * flight are aborted, and the assertion it was about to make reads a page that no longer exists. That is
 * a property of the development server warming up, not of the application, and it disappears once the
 * compiler has seen every route.
 *
 * So the suite asks for every address the application serves here, before Playwright opens a browser and
 * before any client can subscribe to the compile stream. Each address is asked for once; the answer is
 * read and discarded. Any status is accepted, because the status a route answers depends on the identity
 * that asks and on whether the store has been seeded yet — a route that answered at all has compiled,
 * which is the whole of what this proves. Nothing is followed: a redirect is one route's answer, and the
 * address it points at is warmed under its own entry.
 */
import { readdirSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";

import type { FullConfig } from "@playwright/test";

/** The application's router directory: every address it serves is declared by a file under it. */
const APP_DIRECTORY = join("src", "app");

/** The two files the app router turns into an address: a page renders a document, a route handler answers a request. */
const PAGE_FILE = "page.tsx";
const ROUTE_FILE = "route.ts";

/** The port the runner's own configuration defaults to when the environment states none, so both agree on the origin. */
const DEFAULT_PORT = "3000";

/** How long the warm-up waits for the server to accept a connection, matching the runner's own readiness timeout. */
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_INTERVAL_MS = 250;
const READY_PROBE_TIMEOUT_MS = 1_000;

/** How long one address is given to compile and answer. A first compile of the shell is slow, so this is its own generous bound rather than the test budget. */
const ANSWER_TIMEOUT_MS = 120_000;

/** How long the warm-up waits before the single retry a transport error earns. */
const RETRY_DELAY_MS = 1_000;

/** One address to warm: the path to ask the server for, and which kind of route file declares it. */
interface WarmUpAddress {
  readonly path: string;
  readonly kind: "page" | "endpoint";
}

/** What one attempt at an address answered: a status the server chose, or a failure to reach the server at all. */
type WarmAnswer = { readonly kind: "answered"; readonly status: number } | { readonly kind: "unreachable"; readonly reason: string };

/** The outcome of warming one address, kept so the summary can state what the server actually answered. */
interface WarmedAddress extends WarmUpAddress {
  readonly status: number;
}

/** A router segment that is part of no URL: a route group `(name)` and a private folder `_name` both exist only to organise files. */
const UNROUTED_SEGMENT = /^(?:\([^)]*\)|_.*|@.*)$/u;

/** A dynamic segment, `[name]` or a catch-all `[...name]`, named without its brackets. */
const DYNAMIC_SEGMENT = /^\[(?:\.{3})?([^\]]+)\]$/u;

/**
 * The value each dynamic segment is warmed with, taken from the deterministic seed so the address asked
 * for is one the application really serves.
 *
 * A segment the table does not name is warmed with {@link UNNAMED_SEGMENT} instead: the module a route
 * compiles is the same whichever id the address carries, so a seed identifier is a convenience that keeps
 * the request an ordinary one, not a requirement of the warm-up. Add a row here when a new dynamic route
 * is added, to keep its warm-up an address the seed answers rather than one that answers `not found`.
 */
const SEEDED_SEGMENT_VALUES: Readonly<Record<string, string>> = {
  updateId: "doc-update-autumn",
  variantId: "variant-update-autumn-en-public",
  candidateId: "rev-update-ar-candidate-1",
  pageId: "doc-page-harbour-youth",
  locale: "en",
  partnerId: "partner-jo-mbeki",
  referralId: "referral-kenji-active",
  commitmentId: "commitment-harbour-0001",
  giftId: "gift-harbour-0001",
  reportId: "received",
  seriesId: "series-weekly-call-round",
  assetId: "asset-image-portrait",
  rendition: "rendition-image-portrait-display",
  operationId: "operation-warm-up",
};

/** The value a dynamic segment the seed table does not name is warmed with: any value the route can parse. */
const UNNAMED_SEGMENT = "warm-up";

/**
 * Warms every route once, so no route's first compile can land inside a test.
 *
 * Playwright runs this after its `webServer` is listening and before it collects or runs a single test,
 * which is the one moment at which the compiler can be driven over the whole route set with no document
 * subscribed to the compile stream.
 */
export default async function warmUpRoutes(config: FullConfig): Promise<void> {
  const origin = originFrom(config);
  const addresses = routeAddressesUnder(applicationDirectoryFrom(config));
  process.stdout.write(
    `[route warm-up] asking for ${String(addresses.length)} address(es) so no route's first compile lands in a test: ${String(addresses.filter((address) => address.kind === "page").length)} page route(s), then ${String(addresses.filter((address) => address.kind === "endpoint").length)} API endpoint(s)\n`,
  );
  await waitForServer(origin);
  const startedAt = Date.now();
  const warmed = await warmEach(addresses, origin);
  process.stdout.write(`[route warm-up] ${String(warmed.length)} address(es) compiled in ${((Date.now() - startedAt) / 1000).toFixed(1)} s, answered ${answersByClass(warmed)}\n`);
}

/** The origin the journeys drive, taken from the runner's own `baseURL` so the warm-up asks the server the specs drive. */
function originFrom(config: FullConfig): URL {
  const baseURL = config.projects[0]?.use.baseURL ?? `http://127.0.0.1:${process.env.PORT ?? DEFAULT_PORT}`;
  return new URL(baseURL);
}

/** The directory holding the router files: this runner's own directory, whatever directory the suite was started from. */
function applicationDirectoryFrom(config: FullConfig): string {
  const configFile = config.configFile;
  return configFile === undefined || configFile === "" ? process.cwd() : dirname(configFile);
}

/**
 * Every address the application serves, in the order the warm-up asks for them: the documents a journey
 * opens first because they compile the shell the endpoints share, then the API endpoints.
 *
 * The list is read from the router itself — one address per `page.tsx` and one per `route.ts` — so a
 * route added to the application is warmed without a second list to remember, and a stale hardcoded
 * inventory cannot leave a route's first compile inside a test.
 */
function routeAddressesUnder(applicationDirectory: string): readonly WarmUpAddress[] {
  const routes = routeDirectoriesUnder(join(applicationDirectory, APP_DIRECTORY), []);
  const pages = routes.filter((route) => route.files.includes(PAGE_FILE)).map((route) => ({ path: addressOf(route.segments), kind: "page" as const }));
  const endpoints = routes.filter((route) => route.files.includes(ROUTE_FILE)).map((route) => ({ path: addressOf(route.segments), kind: "endpoint" as const }));
  const byPath = (left: WarmUpAddress, right: WarmUpAddress): number => left.path.localeCompare(right.path);
  return [...pages.sort(byPath), ...endpoints.sort(byPath)];
}

/** One directory of the router: the segments that route to it, and the entries beside its subdirectories. */
interface RouteDirectory {
  readonly segments: readonly string[];
  readonly files: readonly string[];
}

/** Walks the router, keeping every directory whose routable segments address it, so nested routes are found without a second inventory. */
function routeDirectoriesUnder(directory: string, segments: readonly string[]): readonly RouteDirectory[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const here: RouteDirectory = { segments: segments.filter((segment) => !UNROUTED_SEGMENT.test(segment)), files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) };
  const nested = entries.filter((entry) => entry.isDirectory() && !UNROUTED_SEGMENT.test(entry.name)).flatMap((entry) => routeDirectoriesUnder(join(directory, entry.name), [...segments, entry.name]));
  return [here, ...nested];
}

/** The address a route's segments name, with each dynamic segment replaced by the value the warm-up asks it for. */
function addressOf(segments: readonly string[]): string {
  const path = segments.map((segment) => {
    const dynamic = DYNAMIC_SEGMENT.exec(segment);
    if (dynamic === null) {
      return segment;
    }
    const name = dynamic[1] ?? "";
    return SEEDED_SEGMENT_VALUES[name] ?? UNNAMED_SEGMENT;
  });
  return `/${path.join("/")}`;
}

/** Waits until the server accepts a connection, because the warm-up's first request is issued against a server that may still be starting. */
async function waitForServer(origin: URL): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!(await acceptsConnection(origin))) {
    if (Date.now() >= deadline) {
      throw new Error(
        `The route warm-up waited ${String(READY_TIMEOUT_MS)} ms for a server to accept a connection on ${origin.origin} and none did, so no route could be compiled before the first test. The runner starts the development server itself, so a failure to accept a connection here means that server did not come up.`,
      );
    }
    await delay(READY_POLL_INTERVAL_MS);
  }
}

/** Whether the server's port accepts a connection, probed at the socket rather than by a request, so the probe compiles nothing. */
function acceptsConnection(origin: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: origin.hostname, port: portOf(origin) });
    const settle = (answer: boolean): void => {
      socket.destroy();
      resolve(answer);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(READY_PROBE_TIMEOUT_MS, () => settle(false));
  });
}

/** The port an origin names, or the one its protocol defaults to. */
function portOf(origin: URL): number {
  if (origin.port.length > 0) {
    return Number(origin.port);
  }
  return origin.protocol === "https:" ? 443 : 80;
}

/** Warms every address in turn, retrying one that could not be reached at all once, and failing loudly if it still cannot be. */
async function warmEach(addresses: readonly WarmUpAddress[], origin: URL): Promise<readonly WarmedAddress[]> {
  const warmed: WarmedAddress[] = [];
  for (const address of addresses) {
    const url = new URL(address.path, origin);
    const first = await answerFor(url);
    const answer = first.kind === "answered" ? first : await answerForAfterRetry(url, first);
    if (answer.kind === "unreachable") {
      throw new Error(`The route warm-up could not reach ${url.href} to compile it: ${answer.reason}. A route the warm-up cannot ask for would compile inside the first test that opens it, so the run stops here instead of reporting a failure the application did not cause.`);
    }
    warmed.push({ ...address, status: answer.status });
  }
  return warmed;
}

/** The one retry a transport error earns: a server that dropped a connection mid-compile is asked again after a pause. */
async function answerForAfterRetry(url: URL, failure: Extract<WarmAnswer, { readonly kind: "unreachable" }>): Promise<WarmAnswer> {
  process.stdout.write(`[route warm-up] ${url.pathname} could not be reached (${failure.reason}), asking once more\n`);
  await delay(RETRY_DELAY_MS);
  return answerFor(url);
}

/**
 * Asks the server for one address and reports what it answered.
 *
 * The response is read to its end and dropped: a route that has answered has compiled, and the body
 * itself is never inspected. Nothing is followed, so a redirect is one route's answer rather than a
 * second route's first compile, and any status is a success here.
 */
async function answerFor(url: URL): Promise<WarmAnswer> {
  try {
    const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS) });
    await response.arrayBuffer().catch(() => undefined);
    return { kind: "answered", status: response.status };
  } catch (error) {
    return { kind: "unreachable", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The warm-up's own summary of what the server answered, by status class, because the exact status depends on the identity and the seeded state that asked. */
function answersByClass(warmed: readonly WarmedAddress[]): string {
  const counts = new Map<string, number>();
  for (const address of warmed) {
    const statusClass = `${String(Math.floor(address.status / 100))}xx`;
    counts.set(statusClass, (counts.get(statusClass) ?? 0) + 1);
  }
  const summary = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([statusClass, count]) => `${statusClass} ${String(count)}`);
  return summary.length === 0 ? "no status" : summary.join(", ");
}

/** Pauses for the stated time, so the readiness poll and the single retry are spaced rather than spun. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
