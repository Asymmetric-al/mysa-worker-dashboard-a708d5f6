"use client";

/**
 * The Support overview's one browser read: the client half of `reads.support.readSupportOverview`,
 * whose outcome set is `envelope | denied | unavailable`.
 *
 * The overview is the surface where the five support measures are most at risk of being summed into
 * one "total support" — received support, recurring outcomes, commitments, monthly equivalents and
 * the goal — and this hook is the last place that could happen. So it computes nothing, combines
 * nothing and relabels nothing: the envelope arrives as the service built it and leaves as it
 * arrived, `valueStates` included, so `zero`, `unknown`, `withheld`, `unavailable` and the derived
 * `incomplete-subtotal` reach the view as five distinct renderings, and a denial or an outage is
 * never flattened into an empty list or a zero.
 *
 * **The cache key.** `[ ...scopeKey(scope), "overview" ]`. The scope segments come from
 * `scopeKey`, the one place this application defines them, so the context guard's `cancelQueries`
 * and `clear` reach this entry during a switch and an envelope read in the previous context can
 * never answer for the current one. The overview takes no parameters — no period, no filter, no
 * page — so nothing follows the job name; a read that did vary by something would put every such
 * variable in that position, never inside a literal array of identifiers.
 *
 * **The transport.** One relative `GET /api/support` with same-origin credentials, so the
 * `httpOnly`, `sameSite=lax` development-session cookie travels and the handler derives the scope
 * itself. The HTTP status is deliberately not read as the answer: a denial answers `403` and an
 * outage `503`, and both are contract answers the surface must render rather than transport
 * failures, so the body's discriminant alone decides. What is absent from the body is a genuine
 * fault, and a fault is a defect rather than a presentation: it rejects the query so the caller
 * renders its own unavailable state, and no result is invented here to stand in for one.
 *
 * **Why the server snapshot is not fetched again on mount, and how freshness still bounds it.**
 * `initialDataUpdatedAt` is the envelope's `asOf` — the scenario instant the server read was
 * evaluated at, never the machine clock. The cache measures an entry's age against the machine
 * clock, and this application's clock is anchored at the seed instant rather than at that clock, so
 * the anchor is already in the past by the time the route hydrates; with the default
 * refetch-on-mount the route would repeat, on every visit, the read its own Server Component has
 * just performed from the same source. The bound below is therefore what decides freshness, and
 * `refetchOnMount: false` says only that the snapshot the server handed over is the one to start
 * from. Nothing is left unbounded: once the entry passes its bound it is stale, so a window focus, a
 * reconnect or an invalidation refetches it, and a context change has no cached entry to reuse at
 * all, so it fetches its own immediately.
 *
 * **What it does not own.** No query client and no provider — the cache belongs to the client frame
 * above the routes. No second key builder, no api-client wrapper, no generated transport, no
 * optimistic value and no toast: the query cache is the only asynchronous-result state, and what
 * happened is read from the outcome the service answered with. No late-envelope predicate either:
 * the key is scope-qualified and the context guard cancels and clears before it dispatches, so a
 * response for the previous context lands in an entry nothing is observing. No money arithmetic, no
 * percentage, no aggregation, no filter, no sort and no page, because the report engine owns every
 * one of them; no clock read beyond parsing the instant the envelope already carries; and no fixture
 * fallback, because an absent source is `unavailable` rather than seeded data.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { Scope, reads } from "@/modules/data-service";

/**
 * What the overview read answers with, derived from the service instead of restated here.
 *
 * The envelope arm carries the built envelope inline under `envelope`; the denial and outage arms
 * carry no envelope at all. Deriving the type means a field added, renamed or withdrawn in the read
 * stops this file compiling rather than letting a second copy of the vocabulary drift from the one
 * the service answers with.
 */
export type SupportOverviewRead = Awaited<ReturnType<typeof reads.support.readSupportOverview>>;

/** What the overview hook needs to read the surface. */
export interface UseSupportOverviewOptions {
  /**
   * The context the overview is read in: the leading segment of the cache key, so a read is never
   * shared across contexts.
   */
  readonly scope: Scope;
  /**
   * The answer the Server Component's own read produced, when it produced one. It seeds the cache so
   * the first render shows the server's result; it is not a second authority, and the envelope in it
   * is used exactly as the service built it. The denial and outage arms seed it just as honestly, so
   * a route that could not be read does not open on an empty surface.
   */
  readonly initialEnvelope?: SupportOverviewRead | undefined;
}

/**
 * The one endpoint this hook reads, stated once so every failure names the request that failed and no
 * second path can appear beside it. Relative, so the request stays inside this origin and carries the
 * development-session cookie the handler derives the scope from.
 */
const OVERVIEW_ENDPOINT = "/api/support";

/** The job segment of the cache key: one overview entry per scope, and no parameter segment. */
const OVERVIEW_JOB = "overview";

/**
 * How long a client-held overview envelope counts as fresh, in milliseconds.
 *
 * This is the whole freshness bound for the surface. The overview is server-rendered on every
 * navigation, so a short window is enough to keep a mounted screen from re-reading what the server
 * just read, while a development clock that has moved, a reconnection or an invalidation still
 * replaces the snapshot promptly instead of leaving a stale one on screen.
 */
const OVERVIEW_STALE_TIME_MS = 30_000;

/**
 * Reads the Support overview in the given scope: wraps `reads.support.readSupportOverview` and
 * answers `envelope | denied | unavailable`, unchanged.
 */
export function useSupportOverview({
  scope,
  initialEnvelope,
}: UseSupportOverviewOptions): UseQueryResult<SupportOverviewRead> {
  return useQuery({
    queryKey: [...scopeKey(scope), OVERVIEW_JOB],
    queryFn: fetchSupportOverview,
    staleTime: OVERVIEW_STALE_TIME_MS,
    refetchOnMount: false,
    initialData: initialEnvelope,
    initialDataUpdatedAt:
      initialEnvelope === undefined ? undefined : scenarioAnchorOf(initialEnvelope),
  });
}

/**
 * The instant the seeded answer was evaluated at, in the epoch milliseconds the cache compares an
 * entry's age against: the envelope's `asOf`, which is a scenario instant rather than a wall-clock
 * reading.
 *
 * `Date.parse` only converts that ISO text the service wrote; it reads no clock, which is why it is
 * the one date operation allowed here. A denial or an outage carries no envelope and therefore no
 * instant, and an unparsable instant is treated as absent rather than guessed at.
 */
function scenarioAnchorOf(result: SupportOverviewRead): number | undefined {
  if (result.kind !== "envelope") {
    return undefined;
  }
  const anchor = Date.parse(result.envelope.asOf);
  return Number.isFinite(anchor) ? anchor : undefined;
}

/**
 * The overview read over the browser transport: one same-origin `GET` answered with a read result.
 *
 * Both the request and the body read are guarded, so a transport fault or an unparsable body rejects
 * this query with an `Error` that names the endpoint and the status and keeps the underlying cause:
 * neither produced a contract answer, and the caller renders its own unavailable state from that
 * rejection — never an empty overview, a zero, or an `unavailable` result whose source this file made
 * up.
 */
async function fetchSupportOverview(): Promise<SupportOverviewRead> {
  let response: Response;
  try {
    response = await fetch(OVERVIEW_ENDPOINT, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new Error(`GET ${OVERVIEW_ENDPOINT} could not be completed.`, { cause });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(
      `GET ${OVERVIEW_ENDPOINT} answered ${response.status} with a body that is not JSON.`,
      { cause },
    );
  }

  if (!isOverviewRead(payload)) {
    throw new Error(`GET ${OVERVIEW_ENDPOINT} answered ${response.status} without a read result.`);
  }

  return payload;
}

/**
 * Whether a parsed body is one of the read contract's three answers.
 *
 * The check is the body's discriminant, not a second schema: the data service validates what it
 * writes, so revalidating every field here would be a competing authority over the same contract.
 * What it does establish is that the body really is a read result, so a truncated or foreign payload
 * rejects the query instead of being handed to a view as though it were one.
 *
 * The full `isReadResult` narrowing in `modules/data-service/outcome` cannot be used here: that
 * module imports a server-only response type, and a client module reaches it type-only so no server
 * code enters the browser bundle.
 */
function isOverviewRead(value: unknown): value is SupportOverviewRead {
  if (!isRecord(value)) {
    return false;
  }
  const kind = value.kind;
  if (typeof kind !== "string") {
    return false;
  }
  switch (kind) {
    case "envelope":
      return isRecord(value.envelope);
    case "denied":
      return isRecord(value.denied);
    case "unavailable":
      return isRecord(value.unavailable);
    default:
      return false;
  }
}
