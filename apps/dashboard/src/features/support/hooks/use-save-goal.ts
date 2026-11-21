"use client";
/**
 * The browser transport for `saveGoal` — the one financial write this application has — and the one
 * place a goal edit leaves the page.
 */
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";
import type { input as SchemaInput } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import { newOperationId } from "@/lib/ids";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { invalid, isOutcome, unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { goalSavePayloadSchema, type GoalSavePayload } from "../schemas";
const SAVE_GOAL_PATH = "/api/support/goal";

const REFRESHED_JOBS = ["goal", "overview", "report"] as const;
/** The payload a caller submits: the goal form's own values, before the amount becomes money. */
export type GoalSaveFormPayload = SchemaInput<typeof goalSavePayloadSchema>;
/** Everything one save presents, which is the mutation input with the payload in its form-shaped form and the attempt identity optional because this hook can mint it. */
export interface SaveGoalVariables {
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly payload: GoalSaveFormPayload;
  readonly operationId?: string;
}
interface AttemptIdentity {
  readonly key: string;
  readonly operationId: string;
}
function canonicalIntent(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalIntent(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalIntent((value as Record<string, unknown>)[key])}`);
    return `{${members.join(",")}}`;
  }
  const primitive = JSON.stringify(value);
  return primitive === undefined ? "null" : primitive;
}
function intentKeyOf(scope: Scope, expectedRevision: string, payload: GoalSaveFormPayload): string {
  return canonicalIntent({ payload, expectedRevision, scope });
}
function attemptFor(current: AttemptIdentity | null, key: string, supplied: string | undefined): AttemptIdentity {
  if (supplied !== undefined && supplied.length > 0) {
    return { key, operationId: supplied };
  }
  if (current !== null && current.key === key) {
    return current;
  }
  return { key, operationId: newOperationId() };
}
/** Posts one `saveGoal` intent and answers with exactly one outcome — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveGoal(): UseMutationResult<MutationOutcome, Error, SaveGoalVariables> {
  const queryClient = useQueryClient();
  const attempt = useRef<AttemptIdentity | null>(null);
  return useMutation<MutationOutcome, Error, SaveGoalVariables>({
    mutationFn: async (variables: SaveGoalVariables): Promise<MutationOutcome> => {
      const identity = attemptFor(attempt.current, intentKeyOf(variables.scope, variables.expectedRevision, variables.payload), variables.operationId);
      attempt.current = identity;
      const checked = goalSavePayloadSchema.safeParse(variables.payload);
      if (!checked.success) {
        return invalid({ operationId: identity.operationId, fields: checked.error });
      }
      const input: MutationInput<GoalSavePayload> = {
        operationId: identity.operationId,
        scope: variables.scope,
        expectedRevision: variables.expectedRevision,
        payload: checked.data,
      };
      let response: Response;
      try {
        response = await fetch(SAVE_GOAL_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(input),
        });
      } catch {
        return unknownOutcome({ operationId: identity.operationId });
      }
      const answered: unknown = await response.json().catch(() => undefined);
      if (!isOutcome(answered)) {
        return unknownOutcome({ operationId: identity.operationId });
      }
      return answered;
    },
    onSuccess: async (outcome: MutationOutcome, variables: SaveGoalVariables): Promise<void> => {
      if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
        return;
      }
      const scope = scopeKey(variables.scope);
      await Promise.all(REFRESHED_JOBS.map((job) => queryClient.invalidateQueries({ queryKey: [...scope, job] })));
    },
  });
}
