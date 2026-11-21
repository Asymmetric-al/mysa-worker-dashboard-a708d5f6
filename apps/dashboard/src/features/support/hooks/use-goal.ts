"use client";
/**
 * Reads the support goal in the browser through `reads.support.readGoal`, whose outcome set is
 * `envelope | denied | unavailable`, and hands the envelope on unchanged.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
const GOAL_QUERY_JOB = "goal";

const GOAL_ENDPOINT = "/api/support/goal";

const GOAL_STALE_TIME_MS = 30_000;
/** The whole answer `reads.support.readGoal` gives, taken from the service so the shape cannot drift from it — the reads are grouped by the job a caller is doing, and the goal belongs to. */
export type GoalReadResult = Awaited<ReturnType<typeof reads.support.readGoal>>;
/** The envelope a goal read answers with: what the hook's `data` is, and what the panel renders. */
export type GoalEnvelope = Extract<GoalReadResult, { kind: "envelope" }>["envelope"];
/** The exact cache key of the goal read in one context. */
export type GoalQueryKey = readonly [...ScopeKey, typeof GOAL_QUERY_JOB];
/** What the goal read is asked for: the context it runs in, and the envelope a server read supplied. */
export interface UseGoalOptions {
  readonly scope: Scope;
  readonly initialEnvelope?: GoalEnvelope;
}
/** The one query this hook returns: the envelope, or the pending and error states TanStack owns. */
export type UseGoalResult = UseQueryResult<GoalEnvelope, Error>;
/** The cache key of the goal read for a context: `scopeKey`'s segments and the job segment, in the one order every key in this application uses. */
export function goalQueryKey(scope: Scope): GoalQueryKey {
  return [...scopeKey(scope), GOAL_QUERY_JOB];
}
function isGoalEnvelopeBody(value: unknown): value is GoalEnvelope {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    isRecord(value.scope) &&
    isRecord(value.source) &&
    isNonEmptyString(value.revision) &&
    isNonEmptyString(value.asOf) &&
    isRecord(value.coverage) &&
    isRecord(value.valueStates) &&
    Array.isArray(value.actions)
  );
}
async function readGoalEnvelope(): Promise<GoalEnvelope> {
  let response: Response;
  try {
    response = await fetch(GOAL_ENDPOINT, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new Error(`GET ${GOAL_ENDPOINT} could not be completed.`, { cause });
  }
  if (!response.ok) {
    throw new Error(`GET ${GOAL_ENDPOINT} did not answer with a goal envelope (status ${response.status}).`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(`GET ${GOAL_ENDPOINT} answered with a body that is not JSON.`, { cause });
  }
  if (!isGoalEnvelopeBody(body)) {
    throw new Error(`GET ${GOAL_ENDPOINT} answered without the envelope its read returns.`);
  }
  return body;
}
/** The goal envelope as a query result for one context, seeded by the envelope a server read supplied. */
export function useGoal({ scope, initialEnvelope }: UseGoalOptions): UseGoalResult {
  const asOfInstant = initialEnvelope === undefined ? undefined : Date.parse(initialEnvelope.asOf);
  const initialDataUpdatedAt = asOfInstant === undefined || Number.isNaN(asOfInstant) ? undefined : asOfInstant;
  return useQuery({
    queryKey: goalQueryKey(scope),
    queryFn: readGoalEnvelope,
    staleTime: GOAL_STALE_TIME_MS,
    refetchOnMount: false,
    initialData: initialEnvelope,
    initialDataUpdatedAt,
  });
}
