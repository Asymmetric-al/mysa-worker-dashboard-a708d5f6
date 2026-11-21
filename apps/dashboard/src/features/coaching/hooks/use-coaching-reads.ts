"use client";
/**
 * The Coaching family's read transport: the six TanStack Query clients of the family's six named coaching
 * reads, each handing its read's `envelope | denied | unavailable` to the family's components unchanged.
 *
 * **Scope basis.** AAP 0.11.1 (`apps/dashboard/src/features/coaching/**`, the hooks for the family's
 * reads and mutations); AAP 0.7.1, whose coaching subset of reads is `readCoachingOverview`,
 * `readTargets`, `readCheckIns`, `readTaskShares`, `readCoachPortfolio` and `readCoachSubject`; AAP 0.6.3,
 * whose handlers are `GET /api/coaching`, `/api/coaching/targets`, `/api/coaching/checkins`,
 * `/api/coaching/taskshare` and `/api/coaching/subjects`; AAP 0.10.1 family 13 (Coaching) with criteria
 * 16 and 19 as its evidence.
 *
 * **What it owns, and what it deliberately does not.** TanStack Query caches the read envelopes and
 * nothing else (AAP 0.7.1), under keys whose leading segments come from `scopeKey` — the one builder whose
 * cache the context fence in `components/context-switch-guard` clears on a switch (AAP 0.7.2). A switch
 * keeps these components mounted and changes only the scope inside the key, so an envelope read in the
 * ministry the worker left cannot be rendered in the one they entered. No measure, cutoff, window,
 * percentage, filter, sort, page or aggregate is computed here: AAP 0.8.4 and 0.8.8 put those behind the
 * service and the envelope states them, and a second computation here is how a coaching surface starts
 * disagreeing with the service that produced it. No envelope is mirrored in local state, so there is no
 * second owner to fall out of step with the store.
 *
 * **Why the wire is decoded rather than asserted.** `toResponse` answers a read as the envelope itself at
 * 200, the denial at 403 and the outage at 503, so the body is not already a `ReadResult`. Asserting the
 * body as one would hand a component a value whose `kind` is `undefined`, and a denial — the answer
 * criterion 19 requires to carry no count, title or existence hint — would render as a coaching surface
 * holding no data. The three arms are therefore rebuilt from the status, and a status or body this read
 * does not answer with is thrown as the fault it is rather than dressed as an empty list or a zero.
 *
 * **Why the two coach reads share one handler.** `view=portfolio` and `subjectId=<opaque id>` are the
 * single handler that serves a coach, and it authorises before it enumerates: a subject outside the
 * coach's admitted grants is a denial carrying no count, title or existence hint rather than an empty
 * module set. The worker overview's own handler answers that read alone and refuses a parameter that would
 * name another authority, so it is not a second way to ask for a portfolio.
 *
 * **Imports.** Every service import here is `import type`: the service barrel reaches the store, which a
 * browser bundle must not load, so the read payloads and the two failure arms arrive as types and the wire
 * is decoded below.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import type { DeniedOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

// ---------------------------------------------------------------------------------------------
// The six jobs this module transports
// ---------------------------------------------------------------------------------------------

/**
 * The six job segments a Coaching cache key carries after its scope segments. Exported so the family's
 * mutation hooks invalidate exactly the entries these reads fill — the coach portfolio on its own, without
 * discarding the worker overview beside it.
 */
export const COACHING_JOB_KEYS = {
  overview: "coaching-overview",
  targets: "targets",
  checkIns: "check-ins",
  taskShares: "task-shares",
  coachPortfolio: "coach-portfolio",
  coachSubject: "coach-subject",
} as const;

// ---------------------------------------------------------------------------------------------
// The reads' own contracts, derived from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** The overview's payload, taken from the read's own answer, so a member added, renamed or removed in the service fails to compile here instead of drifting into a second contract. */
type CoachingOverviewData = Extract<Awaited<ReturnType<typeof reads.coaching.readCoachingOverview>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The targets payload: each target with its versions and measured periods, the canonical measures, the page window and the planning zone. */
type TargetsData = Extract<Awaited<ReturnType<typeof reads.coaching.readTargets>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The check-ins payload: the private autosave and the shared revision kept apart, with the captured question set and the limits in force. */
type CheckInsData = Extract<Awaited<ReturnType<typeof reads.coaching.readCheckIns>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The task-share payload: the summaries the worker selected, how each stands now, and the reviewed description's own bound. */
type TaskSharesData = Extract<Awaited<ReturnType<typeof reads.coaching.readTaskShares>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The coach portfolio payload: the subjects this coach holds an open grant for, and the honest empty case kept distinct from a denial. */
type CoachPortfolioData = Extract<Awaited<ReturnType<typeof reads.coach.readCoachPortfolio>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The coach subject payload: the admitted modules and their states, the frozen duration, the reviewed financial range and the separate `sharesNothing` answer. */
type CoachSubjectData = Extract<Awaited<ReturnType<typeof reads.coach.readCoachSubject>>, { readonly kind: "envelope" }>["envelope"]["data"];

/**
 * The page window a coaching list states, taken from the read that folds in the default of 25 rows and the
 * cap of 100 (AAP 0.8.7). The values are forwarded untouched: the service clamps the window and states the
 * page it actually answered with, so a clamp decided here would be a second rule.
 */
type TargetsQuery = NonNullable<Parameters<typeof reads.coaching.readTargets>[0]>;

/** The page window a check-in list states, forwarded untouched for the same reason. */
type CheckInsQuery = NonNullable<Parameters<typeof reads.coaching.readCheckIns>[0]>;

/** The page window a task-share list states, forwarded untouched for the same reason. */
type TaskSharesQuery = NonNullable<Parameters<typeof reads.coaching.readTaskShares>[0]>;

// ---------------------------------------------------------------------------------------------
// The wire: five handlers, one grammar
// ---------------------------------------------------------------------------------------------

/** The worker's coaching overview (AAP 0.6.3). */
const COACHING_ENDPOINT = "/api/coaching";

/** The worker's targets, and the four named target changes on the same path. */
const TARGETS_ENDPOINT = "/api/coaching/targets";

/** The worker's check-ins, and the four named check-in changes on the same path. */
const CHECK_INS_ENDPOINT = "/api/coaching/checkins";

/** The worker's shared task summaries, and the two named changes on the same path. */
const TASK_SHARES_ENDPOINT = "/api/coaching/taskshare";

/** The coach's read-only handler: one selector per request, either the portfolio view or one subject. */
const COACH_ENDPOINT = "/api/coaching/subjects";

/** The one portfolio view name that handler serves, matched exactly. */
const PORTFOLIO_VIEW = "portfolio";

const ENVELOPE_STATUS = 200;

const DENIED_STATUS = 403;

const UNAVAILABLE_STATUS = 503;

/**
 * A stated list window as the handler's search string. Every member present is sent exactly as the caller
 * stated it, and an absent one is left out so the service applies its own default; no value is formatted,
 * because a query the service parses is not a value a surface displays. `URLSearchParams` keeps insertion
 * order, so the URL and the cache key describe one request.
 */
function toSearchParams(query: Readonly<Record<string, string | number | undefined>>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(name, String(value));
    }
  }
  return search.toString();
}

/** One read's request URL: the endpoint and only the query it was given, with no separator left dangling when nothing was stated. */
function readUrl(endpoint: string, query: Readonly<Record<string, string | number | undefined>>): string {
  const search = toSearchParams(query);
  return search.length === 0 ? endpoint : `${endpoint}?${search}`;
}

function noAnswer(url: string, status: number, detail: string): Error {
  return new Error(`${url} answered ${status} with ${detail}, so this coaching read has no answer to state.`);
}

/** Admits an envelope's eight facts, which every coaching read states the same way, before its payload is judged by the read it belongs to. */
function isEnvelopeOf<T>(value: unknown, admitsData: (data: Record<string, unknown>) => boolean): value is ReadEnvelope<T> {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, source, revision, asOf, coverage, valueStates, actions } = value;
  return (
    isRecord(data) &&
    admitsData(data) &&
    isRecord(scope) &&
    isRecord(source) &&
    typeof revision === "string" &&
    typeof asOf === "string" &&
    isRecord(coverage) &&
    isRecord(valueStates) &&
    Array.isArray(actions)
  );
}

function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "denied" && typeof value.operationId === "string" && typeof value.reasonCode === "string";
}

function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const { source } = value;
  return (
    value.outcome === "unavailable" &&
    typeof value.operationId === "string" &&
    typeof value.guidance === "string" &&
    isRecord(source) &&
    typeof source.system === "string" &&
    typeof source.reference === "string"
  );
}

/**
 * Reads one coaching envelope and answers the read's own result. Exactly one GET is made, with the
 * admission cookie travelling by `same-origin` and the answer left out of the HTTP cache so a withdrawal, a
 * revocation or a cutoff that has just passed takes effect on the next read. A transport fault, an
 * unparseable body and a status this read does not answer with are thrown: `useQuery` reports them as an
 * error the caller renders as a load failure, and none of them becomes an empty list.
 */
async function getReadResult<T>(url: string, signal: AbortSignal, admitsData: (data: Record<string, unknown>) => boolean): Promise<ReadResult<ReadEnvelope<T>>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal,
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (cause) {
    throw new Error(`GET ${url} could not be completed.`, { cause });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(`GET ${url} answered ${response.status} with a body that is not JSON.`, { cause });
  }
  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isEnvelopeOf<T>(body, admitsData)) {
        throw noAnswer(url, response.status, "a body that is not this read's envelope");
      }
      return { kind: "envelope", envelope: body };
    case DENIED_STATUS:
      if (!isDeniedBody(body)) {
        throw noAnswer(url, response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: body };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(body)) {
        throw noAnswer(url, response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: body };
    default:
      throw noAnswer(url, response.status, "a status this read does not answer with");
  }
}

// ---------------------------------------------------------------------------------------------
// Each read's payload, admitted by the member that makes it that view
// ---------------------------------------------------------------------------------------------

function admitsCoachingOverview(data: Record<string, unknown>): boolean {
  return Array.isArray(data.preparation) && Array.isArray(data.relationships) && typeof data.activeModuleCount === "number";
}

function admitsTargets(data: Record<string, unknown>): boolean {
  return Array.isArray(data.targets) && Array.isArray(data.measures) && isRecord(data.page);
}

function admitsCheckIns(data: Record<string, unknown>): boolean {
  return Array.isArray(data.checkIns) && isRecord(data.limits) && isRecord(data.page);
}

function admitsTaskShares(data: Record<string, unknown>): boolean {
  return Array.isArray(data.shares) && typeof data.maxCodePoints === "number" && isRecord(data.page);
}

function admitsCoachPortfolio(data: Record<string, unknown>): boolean {
  return Array.isArray(data.subjects) && typeof data.holdsNoSubjects === "boolean";
}

function admitsCoachSubject(data: Record<string, unknown>): boolean {
  return typeof data.grantId === "string" && Array.isArray(data.modules) && typeof data.sharesNothing === "boolean";
}

// ---------------------------------------------------------------------------------------------
// The six reads
// ---------------------------------------------------------------------------------------------

/**
 * Reads the worker's coaching overview — private preparation and every relationship's state, its five
 * independent module switches and its duration — answering `envelope`, `denied` or `unavailable`.
 */
export function useCoachingOverview(scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<CoachingOverviewData>>, Error> {
  return useQuery({
    queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.overview],
    queryFn: ({ signal }) => getReadResult<CoachingOverviewData>(COACHING_ENDPOINT, signal, admitsCoachingOverview),
    retry: false,
  });
}

/**
 * Reads one page of the worker's targets with their versions and measured periods, answering `envelope`,
 * `denied` or `unavailable`.
 */
export function useTargets(scope: Scope, params: TargetsQuery): UseQueryResult<ReadResult<ReadEnvelope<TargetsData>>, Error> {
  return useQuery({
    queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.targets, params],
    queryFn: ({ signal }) => getReadResult<TargetsData>(readUrl(TARGETS_ENDPOINT, params), signal, admitsTargets),
    retry: false,
  });
}

/**
 * Reads one page of the worker's check-ins, the private autosave and the shared revision kept apart,
 * answering `envelope`, `denied` or `unavailable`.
 */
export function useCheckIns(scope: Scope, params: CheckInsQuery): UseQueryResult<ReadResult<ReadEnvelope<CheckInsData>>, Error> {
  return useQuery({
    queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.checkIns, params],
    queryFn: ({ signal }) => getReadResult<CheckInsData>(readUrl(CHECK_INS_ENDPOINT, params), signal, admitsCheckIns),
    retry: false,
  });
}

/**
 * Reads one page of the task summaries the worker selected for sharing, answering `envelope`, `denied` or
 * `unavailable`.
 */
export function useTaskShares(scope: Scope, params: TaskSharesQuery): UseQueryResult<ReadResult<ReadEnvelope<TaskSharesData>>, Error> {
  return useQuery({
    queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.taskShares, params],
    queryFn: ({ signal }) => getReadResult<TaskSharesData>(readUrl(TASK_SHARES_ENDPOINT, params), signal, admitsTaskShares),
    retry: false,
  });
}

/**
 * Reads the coach's own portfolio of admitted subjects, answering `envelope`, `denied` or `unavailable`: a
 * portfolio holding no subject is the envelope's own empty answer, never a denial and never an outage.
 */
export function useCoachPortfolio(scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<CoachPortfolioData>>, Error> {
  return useQuery({
    queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.coachPortfolio],
    queryFn: ({ signal }) => getReadResult<CoachPortfolioData>(readUrl(COACH_ENDPOINT, { view: PORTFOLIO_VIEW }), signal, admitsCoachPortfolio),
    retry: false,
  });
}

/**
 * Reads one admitted subject as the coach, addressing it by the identifier the caller holds so this read can
 * never enumerate subjects, and answering `envelope`, `denied` or `unavailable`.
 */
export function useCoachSubject(scope: Scope, subjectId: string): UseQueryResult<ReadResult<ReadEnvelope<CoachSubjectData>>, Error> {
  return useQuery({
    queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.coachSubject, { subjectId }],
    queryFn: ({ signal }) => getReadResult<CoachSubjectData>(readUrl(COACH_ENDPOINT, { subjectId }), signal, admitsCoachSubject),
    retry: false,
  });
}
