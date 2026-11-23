"use client";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { input as SchemaInput } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import { refreshJobs, sendMutation, useAttemptIdentity } from "@/lib/read-transport";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { goalSavePayloadSchema, type GoalSavePayload } from "../schemas";
const REFRESHED_JOBS = ["goal", "overview", "report"] as const;
export type GoalSaveFormPayload = SchemaInput<typeof goalSavePayloadSchema>;
export type SaveGoalVariables = { readonly scope: Scope; readonly expectedRevision: string; readonly payload: GoalSaveFormPayload; readonly operationId?: string };
/** Posts one `saveGoal` intent and answers with exactly one outcome — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */ export function useSaveGoal(): UseMutationResult<MutationOutcome, Error, SaveGoalVariables> {
  const queryClient = useQueryClient();
  const { operationIdFor } = useAttemptIdentity();
  return useMutation<MutationOutcome, Error, SaveGoalVariables>({
    mutationFn: async (variables: SaveGoalVariables): Promise<MutationOutcome> => {
      const operationId = operationIdFor("saveGoal", variables.scope, variables.expectedRevision, variables.payload, variables.operationId);
      const checked = goalSavePayloadSchema.safeParse(variables.payload);
      if (!checked.success) return invalid({ operationId, fields: checked.error });
      const input: MutationInput<GoalSavePayload> = { operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: checked.data };
      return sendMutation("/api/support/goal", input, "This device reported no connection, so the request did not leave from here. Reconnect and submit this same change again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.");
    },
    onSuccess: async (outcome: MutationOutcome, variables: SaveGoalVariables): Promise<void> => await refreshJobs(queryClient, outcome, scopeKey(variables.scope), REFRESHED_JOBS),
  });
}
