"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";
const GOAL_QUERY_JOB = "goal";
export type GoalReadResult = Awaited<ReturnType<typeof reads.support.readGoal>>;
export type GoalEnvelope = Extract<GoalReadResult, { kind: "envelope" }>["envelope"];
export type GoalQueryKey = readonly [...ScopeKey, typeof GOAL_QUERY_JOB];
export type UseGoalOptions = { readonly scope: Scope; readonly initialEnvelope?: GoalEnvelope };
export type UseGoalResult = UseQueryResult<GoalReadResult, Error>; /** The cache key of the goal read for a context: `scopeKey`'s segments and the job segment, in the one order every key in this application uses. */
export const goalQueryKey = (scope: Scope): GoalQueryKey => [...scopeKey(scope), GOAL_QUERY_JOB];
/** The goal read as a query result for one context, seeded by the envelope a server read supplied. */ export function useGoal({ scope, initialEnvelope }: UseGoalOptions): UseGoalResult {
  const asOfInstant = initialEnvelope === undefined ? undefined : Date.parse(initialEnvelope.asOf);
  return useQuery({
    queryKey: goalQueryKey(scope),
    queryFn: () => fetchRead<GoalEnvelope["data"], GoalEnvelope["coverage"]>({ url: "/api/support/goal", admits: isRecord }),
    staleTime: 30_000,
    refetchOnMount: false,
    initialData: initialEnvelope === undefined ? undefined : { kind: "envelope", envelope: initialEnvelope },
    initialDataUpdatedAt: asOfInstant === undefined || Number.isNaN(asOfInstant) ? undefined : asOfInstant,
  });
}
