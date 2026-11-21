"use client";
/** Reads the support goal in the browser through `reads.support.readGoal`, whose read contract is `envelope | denied | unavailable | refused`, and hands the arm it answered with on unchanged. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
// Type-only: the outcome module imports `next/server` for its response mapping, so a value import
// would pull server code into the browser bundle. The two failure arms are decoded from the wire here.
import type { DeniedOutcome, InvalidOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";
const GOAL_QUERY_JOB = "goal";

const GOAL_ENDPOINT = "/api/support/goal";

const GOAL_STALE_TIME_MS = 30_000;
/** The whole answer `reads.support.readGoal` gives, taken from the service so the shape cannot drift from it — the reads are grouped by the job a caller is doing, and the goal belongs to. */
export type GoalReadResult = Awaited<ReturnType<typeof reads.support.readGoal>>;
/** The envelope a goal read answers with: the one arm that carries the goal, its progress and the capability that governs editing it. */
export type GoalEnvelope = Extract<GoalReadResult, { kind: "envelope" }>["envelope"];
/** The exact cache key of the goal read in one context. */
export type GoalQueryKey = readonly [...ScopeKey, typeof GOAL_QUERY_JOB];
/** What the goal read is asked for: the context it runs in, and the envelope a server read supplied. */
export interface UseGoalOptions {
  readonly scope: Scope;
  readonly initialEnvelope?: GoalEnvelope;
}
/** The one query this hook returns: whichever of the read's three arms answered, or the pending and error states TanStack owns. */
export type UseGoalResult = UseQueryResult<GoalReadResult, Error>;
/** The cache key of the goal read for a context: `scopeKey`'s segments and the job segment, in the one order every key in this application uses. */
export function goalQueryKey(scope: Scope): GoalQueryKey {
  return [...scopeKey(scope), GOAL_QUERY_JOB];
}
function isGoalEnvelopeBody(value: unknown): value is GoalEnvelope {
  return isRecord(value) && isRecord(value.data) && isRecord(value.scope) && isRecord(value.source) && isNonEmptyString(value.revision) && isNonEmptyString(value.asOf) && isRecord(value.coverage) && isRecord(value.valueStates) && Array.isArray(value.actions);
}
// Reading the wire answer back into the contract's four arms
const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
/** A session that expired or could not be established answers 401 with the same denial, which is a session fault rather than a permission refusal. */
const SESSION_FAULT_STATUS = 401;
/** A query this read does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;
const UNAVAILABLE_STATUS = 503;

function noAnswer(status: number, detail: string): Error {
  return new Error(`${GOAL_ENDPOINT} answered ${status} with ${detail}, so the goal read has no answer to state.`);
}
function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "denied" && typeof value.operationId === "string" && typeof value.reasonCode === "string";
}
function isRefusedBody(value: unknown): value is InvalidOutcome {
  return isRecord(value) && value.outcome === "invalid" && typeof value.operationId === "string" && isRecord(value.fields);
}
function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const source = value.source;
  return value.outcome === "unavailable" && typeof value.operationId === "string" && typeof value.guidance === "string" && isRecord(source) && typeof source.system === "string" && typeof source.reference === "string";
}
async function fetchGoal(): Promise<GoalReadResult> {
  let response: Response;
  try {
    response = await fetch(GOAL_ENDPOINT, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin" });
  } catch (cause) {
    throw new Error(`GET ${GOAL_ENDPOINT} could not be completed.`, { cause });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(`GET ${GOAL_ENDPOINT} answered ${response.status} with a body that is not JSON.`, { cause });
  }
  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isGoalEnvelopeBody(body)) {
        throw noAnswer(response.status, "a body that is not a goal envelope");
      }
      return { kind: "envelope", envelope: body };
    case DENIED_STATUS:
    case SESSION_FAULT_STATUS:
      if (!isDeniedBody(body)) {
        throw noAnswer(response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: body };
    case REFUSED_STATUS:
      if (!isRefusedBody(body)) {
        throw noAnswer(response.status, "a body that is not a refused request");
      }
      return { kind: "refused", refused: body };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(body)) {
        throw noAnswer(response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: body };
    default:
      throw noAnswer(response.status, "a status this read does not answer with");
  }
}
/** The goal read as a query result for one context, seeded by the envelope a server read supplied. */
export function useGoal({ scope, initialEnvelope }: UseGoalOptions): UseGoalResult {
  const asOfInstant = initialEnvelope === undefined ? undefined : Date.parse(initialEnvelope.asOf);
  const initialDataUpdatedAt = asOfInstant === undefined || Number.isNaN(asOfInstant) ? undefined : asOfInstant;
  return useQuery({
    queryKey: goalQueryKey(scope),
    queryFn: fetchGoal,
    staleTime: GOAL_STALE_TIME_MS,
    refetchOnMount: false,
    // A server render hands over an envelope only, so the seed is the envelope arm: the other two arms
    // are answers that render never received, and seeding either of them would state a refusal or an
    // outage this component was not told about.
    initialData: initialEnvelope === undefined ? undefined : { kind: "envelope", envelope: initialEnvelope },
    initialDataUpdatedAt,
  });
}
