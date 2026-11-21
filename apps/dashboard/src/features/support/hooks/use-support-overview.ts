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
 * itself. The handler answers through `toResponse`, the application's one status ladder, which
 * flattens a read result onto the status: `200` carries the envelope object itself, `403` the denial
 * and `503` the outage, and none of them is wrapped in a `kind` member. That wrapper is the
 * in-process value this hook returns to its caller, not the wire shape, so the response's status is
 * read first and the body is then checked against the arm that status names. A status this read does
 * not answer with, or a body that is not the arm its status names, is a genuine fault rather than a
 * presentation: it rejects the query so the caller renders its own unavailable state, and no result
 * is invented here to stand in for one — least of all an outage carrying a source this file made up.
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
// Type-only: the outcome module imports `next/server` for its response mapping, so a value import
// would pull server code into the browser bundle. The two failure arms are decoded from the wire here.
import type { DeniedOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

/**
 * What the overview read answers with, derived from the service instead of restated here.
 *
 * The envelope arm carries the built envelope inline under `envelope`; the denial and outage arms
 * carry no envelope at all. Deriving the type means a field added, renamed or withdrawn in the read
 * stops this file compiling rather than letting a second copy of the vocabulary drift from the one
 * the service answers with.
 */
export type SupportOverviewRead = Awaited<ReturnType<typeof reads.support.readSupportOverview>>;

/**
 * The one envelope this hook reads: the overview's report, its three non-cash measure sets, and the
 * scope, source, revision, as-of instant, coverage, value states and actions every read carries.
 *
 * Extracted from the service's own result rather than written out, for the same reason as
 * {@link SupportOverviewRead}: the shape a surface renders is the shape the service answered with.
 */
type SupportOverviewEnvelope = Extract<
  SupportOverviewRead,
  { readonly kind: "envelope" }
>["envelope"];

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

/** The three statuses an overview read answers with: the envelope, a denial and an outage. */
const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
const UNAVAILABLE_STATUS = 503;

/**
 * The one error this file raises: an answer no contract describes, named by the request and the
 * status that produced it.
 *
 * It is a plain `Error` on purpose, because the caller renders an unavailable state from it. It is
 * raised rather than answered with a read result: a transport fault and an unrecognised body
 * produced no contract answer at all, and the outage arm this file would otherwise build would have
 * to invent the source identity that arm's honesty depends on.
 */
function noAnswer(status: number, detail: string): Error {
  return new Error(
    `${OVERVIEW_ENDPOINT} answered ${status} with ${detail}, so the overview read has no answer to state.`,
  );
}

/**
 * The overview read over the browser transport: one same-origin `GET` answered with a read result.
 *
 * The status decides which arm the body is, because the handler flattens the read result onto the
 * status and writes that arm's object itself as the body — `200` the envelope, `403` the denial,
 * `503` the outage, with no `kind` member around any of them. Each status is therefore read against
 * its own arm's shape and mapped back into the in-process union this hook answers with.
 *
 * Both the request and the body read are guarded, so a transport fault or an unparsable body rejects
 * this query with an `Error` that names the endpoint and the status and keeps the underlying cause.
 * A status this read does not answer with, or a body that is not the arm its status names, rejects
 * the same way, because none of them produced a contract answer and the only honest presentations of
 * that are the caller's unavailable state — never an empty overview, a zero, or an `unavailable`
 * result whose source this file made up.
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

  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isOverviewEnvelope(payload)) {
        throw noAnswer(response.status, "a body that is not an overview envelope");
      }
      return { kind: "envelope", envelope: payload };
    case DENIED_STATUS:
      if (!isDeniedBody(payload)) {
        throw noAnswer(response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: payload };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(payload)) {
        throw noAnswer(response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: payload };
    default:
      throw noAnswer(response.status, "a status this read does not answer with");
  }
}

/**
 * Whether a decoded body is the envelope the overview read states: the eight members every read
 * envelope carries, with the data this surface renders present and of the shape it renders it in.
 *
 * The check stops at what a surface would otherwise trip over — the report, its three non-cash
 * measure sets, the scope, the coverage, the value states, the actions, the instant and the revision
 * — because a body missing one of them is a truncated or foreign answer rather than a read that
 * found nothing. It is deliberately not a second schema for the figures inside: the data service
 * validated what it wrote, so a figure here is the service's own and is never re-checked.
 */
function isOverviewEnvelope(value: unknown): value is SupportOverviewEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, coverage, valueStates, actions, asOf, revision } = value;
  return (
    isRecord(data) &&
    isRecord(data.report) &&
    Array.isArray(data.monthlyEquivalent) &&
    Array.isArray(data.buckets) &&
    Array.isArray(data.commitmentKinds) &&
    isRecord(scope) &&
    isRecord(coverage) &&
    isRecord(valueStates) &&
    Array.isArray(actions) &&
    typeof asOf === "string" &&
    typeof revision === "string"
  );
}

/**
 * Whether a decoded body is the denial a `403` carries. The reason code describes the caller's
 * relationship to the request, never a record, so nothing here can be read as an existence flag.
 */
function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.outcome === "denied" &&
    typeof value.operationId === "string" &&
    typeof value.reasonCode === "string"
  );
}

/**
 * Whether a decoded body is the outage a `503` carries: the source identity and the guidance, both of
 * which a surface states instead of showing an empty overview or a zero.
 */
function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const source = value.source;
  return (
    value.outcome === "unavailable" &&
    typeof value.operationId === "string" &&
    typeof value.guidance === "string" &&
    isRecord(source) &&
    typeof source.system === "string" &&
    typeof source.reference === "string"
  );
}
