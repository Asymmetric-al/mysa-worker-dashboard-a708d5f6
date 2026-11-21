"use client";
/** The Coaching family's read transport: the six TanStack Query clients of the family's six named coaching reads, each handing its read's `envelope | denied | unavailable | refused` to the family's … */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import type { DeniedOutcome, InvalidOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

// ---------------------------------------------------------------------------------------------
// The six jobs this module transports
// ---------------------------------------------------------------------------------------------

/** The six job segments a Coaching cache key carries after its scope segments. */
export const COACHING_JOB_KEYS = { overview: "coaching-overview", targets: "targets", checkIns: "check-ins", taskShares: "task-shares", coachPortfolio: "coach-portfolio", coachSubject: "coach-subject" } as const;

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

/** The page window a coaching list states, taken from the read that folds in the default of 25 rows and the cap of 100 (AAP 0.8.7). */
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

/** A session that expired or could not be established answers 401 with the same denial, which is a session fault rather than a permission refusal. */
const SESSION_FAULT_STATUS = 401;

const UNAVAILABLE_STATUS = 503;

/** A query this read does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;

/** A stated list window as the handler's search string. */
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
  return isRecord(data) && admitsData(data) && isRecord(scope) && isRecord(source) && typeof revision === "string" && typeof asOf === "string" && isRecord(coverage) && isRecord(valueStates) && Array.isArray(actions);
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
  return value.outcome === "unavailable" && typeof value.operationId === "string" && typeof value.guidance === "string" && isRecord(source) && typeof source.system === "string" && typeof source.reference === "string";
}

function isRefusedBody(value: unknown): value is InvalidOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "invalid" && typeof value.operationId === "string" && isRecord(value.fields);
}

/** Reads one coaching envelope and answers the read's own result. */
async function getReadResult<T>(url: string, signal: AbortSignal, admitsData: (data: Record<string, unknown>) => boolean): Promise<ReadResult<ReadEnvelope<T>>> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", signal, headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
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
    case SESSION_FAULT_STATUS:
      if (!isDeniedBody(body)) {
        throw noAnswer(url, response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: body };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(body)) {
        throw noAnswer(url, response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: body };
    case REFUSED_STATUS:
      if (!isRefusedBody(body)) {
        throw noAnswer(url, response.status, "a body that is not a refused request");
      }
      return { kind: "refused", refused: body };
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

/** Reads the worker's coaching overview — private preparation and every relationship's state, its five independent module switches and its duration — answering `envelope`, `denied` or `unavailable`. */
export function useCoachingOverview(scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<CoachingOverviewData>>, Error> {
  return useQuery({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.overview], queryFn: ({ signal }) => getReadResult<CoachingOverviewData>(COACHING_ENDPOINT, signal, admitsCoachingOverview), retry: false });
}

/** Reads one page of the worker's targets with their versions and measured periods, answering `envelope`, `denied` or `unavailable`. */
export function useTargets(scope: Scope, params: TargetsQuery): UseQueryResult<ReadResult<ReadEnvelope<TargetsData>>, Error> {
  return useQuery({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.targets, params], queryFn: ({ signal }) => getReadResult<TargetsData>(readUrl(TARGETS_ENDPOINT, params), signal, admitsTargets), retry: false });
}

/** Reads one page of the worker's check-ins, the private autosave and the shared revision kept apart, answering `envelope`, `denied` or `unavailable`. */
export function useCheckIns(scope: Scope, params: CheckInsQuery): UseQueryResult<ReadResult<ReadEnvelope<CheckInsData>>, Error> {
  return useQuery({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.checkIns, params], queryFn: ({ signal }) => getReadResult<CheckInsData>(readUrl(CHECK_INS_ENDPOINT, params), signal, admitsCheckIns), retry: false });
}

/** Reads one page of the task summaries the worker selected for sharing, answering `envelope`, `denied` or `unavailable`. */
export function useTaskShares(scope: Scope, params: TaskSharesQuery): UseQueryResult<ReadResult<ReadEnvelope<TaskSharesData>>, Error> {
  return useQuery({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.taskShares, params], queryFn: ({ signal }) => getReadResult<TaskSharesData>(readUrl(TASK_SHARES_ENDPOINT, params), signal, admitsTaskShares), retry: false });
}

/** Reads the coach's own portfolio of admitted subjects, answering `envelope`, `denied` or `unavailable`: a portfolio holding no subject is the envelope's own empty answer, never a denial and never … */
export function useCoachPortfolio(scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<CoachPortfolioData>>, Error> {
  return useQuery({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.coachPortfolio], queryFn: ({ signal }) => getReadResult<CoachPortfolioData>(readUrl(COACH_ENDPOINT, { view: PORTFOLIO_VIEW }), signal, admitsCoachPortfolio), retry: false });
}

/** Reads one admitted subject as the coach, addressing it by the identifier the caller holds so this read can never enumerate subjects, and answering `envelope`, `denied` or `unavailable`. */
export function useCoachSubject(scope: Scope, subjectId: string): UseQueryResult<ReadResult<ReadEnvelope<CoachSubjectData>>, Error> {
  return useQuery({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.coachSubject, { subjectId }], queryFn: ({ signal }) => getReadResult<CoachSubjectData>(readUrl(COACH_ENDPOINT, { subjectId }), signal, admitsCoachSubject), retry: false });
}
