/** The cold-start warm-up the browser suite runs once, before its first test. */
import { readdirSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import type { FullConfig } from "@playwright/test";
const APP_DIRECTORY = join("src", "app");
const DEFAULT_PORT = "3000";
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_INTERVAL_MS = 250;
const READY_PROBE_TIMEOUT_MS = 1_000;
const ANSWER_TIMEOUT_MS = 120_000; // How long one address is given to compile and answer. A first compile of the shell is slow, so this is its own generous bound rather than the test budget.
const RETRY_DELAY_MS = 1_000;
type WarmUpAddress = { readonly path: string; readonly kind: "page" | "endpoint" }; // One address to warm: the path to ask the server for, and which kind of route file declares it.
type WarmAnswer = { readonly kind: "answered"; readonly status: number } | { readonly kind: "unreachable"; readonly reason: string }; // What one attempt at an address answered: a status the server chose, or a failure to reach the server at all.
type WarmedAddress = WarmUpAddress & { readonly status: number }; // The outcome of warming one address, kept so the summary can state what the server actually answered.
const UNROUTED_SEGMENT = /^(?:\([^)]*\)|_.*|@.*)$/u; // A router segment that is part of no URL: a route group `(name)` and a private folder `_name` both exist only to organise files.
const DYNAMIC_SEGMENT = /^\[(?:\.{3})?([^\]]+)\]$/u; // A dynamic segment, `[name]` or a catch-all `[...name]`, named without its brackets.
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
const UNNAMED_SEGMENT = "warm-up"; // The value a dynamic segment the seed table does not name is warmed with: any value the route can parse.
/** Warms every route once, so no route's first compile can land inside a test. */
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
function applicationDirectoryFrom(config: FullConfig): string {
  const configFile = config.configFile; // The directory holding the router files: this runner's own directory, whatever directory the suite was started from.
  return configFile === undefined || configFile === "" ? process.cwd() : dirname(configFile);
}
function routeAddressesUnder(applicationDirectory: string): readonly WarmUpAddress[] {
  const routes = routeDirectoriesUnder(join(applicationDirectory, APP_DIRECTORY), []); // Every address the application serves, in the order the warm-up asks for them: the documents a journey
  const pages = routes.filter((route) => route.files.includes("page.tsx")).map((route) => ({ path: addressOf(route.segments), kind: "page" as const }));
  const endpoints = routes.filter((route) => route.files.includes("route.ts")).map((route) => ({ path: addressOf(route.segments), kind: "endpoint" as const }));
  const byPath = (left: WarmUpAddress, right: WarmUpAddress): number => left.path.localeCompare(right.path);
  return [...pages.sort(byPath), ...endpoints.sort(byPath)];
}
type RouteDirectory = { readonly segments: readonly string[]; readonly files: readonly string[] }; // One directory of the router: the segments that route to it, and the entries beside its subdirectories.
function routeDirectoriesUnder(directory: string, segments: readonly string[]): readonly RouteDirectory[] {
  const entries = readdirSync(directory, { withFileTypes: true }); // Walks the router, keeping every directory whose routable segments address it, so nested routes are found without a second inventory.
  const here: RouteDirectory = { segments: segments.filter((segment) => !UNROUTED_SEGMENT.test(segment)), files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) };
  const nested = entries.filter((entry) => entry.isDirectory() && !UNROUTED_SEGMENT.test(entry.name)).flatMap((entry) => routeDirectoriesUnder(join(directory, entry.name), [...segments, entry.name]));
  return [here, ...nested];
}
/** The address a route's segments name, with each dynamic segment replaced by the value the warm-up asks it for. */
function addressOf(segments: readonly string[]): string {
  const path = segments.map((segment) => {
    const dynamic = DYNAMIC_SEGMENT.exec(segment);
    if (dynamic === null) return segment;
    const name = dynamic[1] ?? "";
    return SEEDED_SEGMENT_VALUES[name] ?? UNNAMED_SEGMENT;
  });
  return `/${path.join("/")}`;
}
async function waitForServer(origin: URL): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS; // Waits until the server accepts a connection, because the warm-up's first request is issued against a server that may still be starting.
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
const portOf = (origin: URL): number => (origin.port.length > 0 ? Number(origin.port) : origin.protocol === "https:" ? 443 : 80);
async function warmEach(addresses: readonly WarmUpAddress[], origin: URL): Promise<readonly WarmedAddress[]> {
  const warmed: WarmedAddress[] = []; // Warms every address in turn, retrying one that could not be reached at all once, and failing loudly if it still cannot be.
  for (const address of addresses) {
    const url = new URL(address.path, origin);
    const first = await answerFor(url);
    const answer = first.kind === "answered" ? first : await answerForAfterRetry(url, first);
    if (answer.kind === "unreachable") throw new Error(`The route warm-up could not reach ${url.href} to compile it: ${answer.reason}. A route the warm-up cannot ask for would compile inside the first test that opens it, so the run stops here instead of reporting a failure the application did not cause.`);
    warmed.push({ ...address, status: answer.status });
  }
  return warmed;
}
async function answerForAfterRetry(url: URL, failure: Extract<WarmAnswer, { readonly kind: "unreachable" }>): Promise<WarmAnswer> {
  process.stdout.write(`[route warm-up] ${url.pathname} could not be reached (${failure.reason}), asking once more\n`); // The one retry a transport error earns: a server that dropped a connection mid-compile is asked again after a pause.
  await delay(RETRY_DELAY_MS);
  return answerFor(url);
}
async function answerFor(url: URL): Promise<WarmAnswer> {
  try {
    const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS) });
    await response.arrayBuffer().catch(() => undefined);
    return { kind: "answered", status: response.status };
  } catch (error) {
    return { kind: "unreachable", reason: error instanceof Error ? error.message : String(error) };
  }
}
function answersByClass(warmed: readonly WarmedAddress[]): string {
  const counts = new Map<string, number>(); // The warm-up's own summary of what the server answered, by status class, because the exact status depends on the identity and the seeded state that asked.
  for (const address of warmed) {
    const statusClass = `${String(Math.floor(address.status / 100))}xx`;
    counts.set(statusClass, (counts.get(statusClass) ?? 0) + 1);
  }
  const summary = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([statusClass, count]) => `${statusClass} ${String(count)}`);
  return summary.length === 0 ? "no status" : summary.join(", ");
}
/** Pauses for the stated time, so the readiness poll and the single retry are spaced rather than spun. */
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
