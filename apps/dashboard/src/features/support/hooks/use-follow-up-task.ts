"use client";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { refreshJobs, sendMutation, useAttemptIdentity } from "@/lib/read-transport";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { followUpTaskPayloadSchema, type FollowUpTaskInput, type FollowUpTaskPayload } from "../schemas";
const REFRESHED_JOBS = ["tasks", "agenda"] as const;
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same follow-up again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than creating the task twice.";
export type FollowUpTaskVariables = { readonly scope: Scope; readonly expectedRevision: string; readonly payload: FollowUpTaskInput; readonly operationId?: string };
export type FollowUpTaskMutation = UseMutationResult<MutationOutcome, Error, FollowUpTaskVariables>;
/** Submits the gift's thank-you follow-up as `createTask`, answering with one of the eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`, `unknown`. */ export function useFollowUpTask(): FollowUpTaskMutation {
  const queryClient = useQueryClient();
  const { operationIdFor } = useAttemptIdentity();
  return useMutation<MutationOutcome, Error, FollowUpTaskVariables>({
    mutationFn: async (variables: FollowUpTaskVariables): Promise<MutationOutcome> => {
      const operationId = operationIdFor("createTask", variables.scope, variables.expectedRevision, variables.payload, variables.operationId);
      const parsed = followUpTaskPayloadSchema.safeParse(variables.payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const request: MutationInput<FollowUpTaskPayload> = { operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: parsed.data };
      return sendMutation("/api/tasks", request, OFFLINE_GUIDANCE);
    },
    onSuccess: async (outcome: MutationOutcome, variables: FollowUpTaskVariables): Promise<void> => await refreshJobs(queryClient, outcome, scopeKey(variables.scope), REFRESHED_JOBS),
  });
}
