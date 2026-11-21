"use client";
/** The browser transport for the one piece of work a gift may lead to: the thank-you follow-up the gift detail offers, submitted as the named mutation `createTask` over `POST /api/tasks`. */
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import { newOperationId } from "@/lib/ids";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { invalid, isOutcome, unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { followUpTaskPayloadSchema, type FollowUpTaskInput, type FollowUpTaskPayload } from "../schemas";
// The one handler, and the cache segments a created task can appear under
const TASKS_ENDPOINT = "/api/tasks";
const TASKS_JOB = "tasks";
const AGENDA_JOB = "agenda";
// What one submission needs
export interface FollowUpTaskVariables {
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly payload: FollowUpTaskInput;
  readonly operationId?: string;
}
export type FollowUpTaskMutation = UseMutationResult<MutationOutcome, Error, FollowUpTaskVariables>;

interface FollowUpAttempt {
  readonly operationId: string;
  readonly intent: string;
}
// Identity, keyed by intent
function intentText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function intentKeyOf(scope: Scope, expectedRevision: string, payload: FollowUpTaskInput): string {
  return JSON.stringify([scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, expectedRevision, intentText(payload.title), intentText(payload.category), intentText(payload.dueOn), intentText(payload.partnerId), intentText(payload.kind)]);
}
// Reading the answer
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
// The hook
/** Submits the gift's thank-you follow-up as `createTask`, answering with one of the eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`, `unknown`. */
export function useFollowUpTask(): FollowUpTaskMutation {
  const queryClient = useQueryClient();
  const attemptRef = useRef<FollowUpAttempt | null>(null);
  return useMutation<MutationOutcome, Error, FollowUpTaskVariables>({
    mutationFn: async (variables) => {
      const intent = intentKeyOf(variables.scope, variables.expectedRevision, variables.payload);
      const held = attemptRef.current;
      const operationId = variables.operationId ?? (held !== null && held.intent === intent ? held.operationId : newOperationId());
      attemptRef.current = { operationId, intent };
      const parsed = followUpTaskPayloadSchema.safeParse(variables.payload);
      if (!parsed.success) {
        return invalid({ operationId, fields: parsed.error });
      }
      const request: MutationInput<FollowUpTaskPayload> = {
        operationId,
        scope: variables.scope,
        expectedRevision: variables.expectedRevision,
        // The schema's output carries `operation`, the routing discriminant the handler dispatches on
        // and removes before the mutation's closed schema validates the payload; it is not a task field
        // and it is not keyed into the attempt identity above.
        payload: parsed.data,
      };
      let response: Response;
      try {
        response = await fetch(TASKS_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The development session is an httpOnly, sameSite=lax cookie, so the handler can only
          // derive scope from a same-origin request that carries it.
          credentials: "same-origin",
          body: JSON.stringify(request),
        });
      } catch {
        return unknownOutcome({ operationId });
      }
      const body = await readJsonBody(response);
      if (!isOutcome(body)) {
        return unknownOutcome({ operationId });
      }
      return body;
    },
    onSuccess: async (outcome, variables) => {
      if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
        return;
      }
      const scope = scopeKey(variables.scope);
      await Promise.all([queryClient.invalidateQueries({ queryKey: [...scope, TASKS_JOB] }), queryClient.invalidateQueries({ queryKey: [...scope, AGENDA_JOB] })]);
    },
  });
}
