"use client";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { refreshJobs, sendMutation } from "@/lib/read-transport";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { BulkApplyTagPayload, BulkCompleteTasksPayload, BulkCreateTasksPayload, BulkRemoveTagPayload } from "../schemas/bulk";
const BULK_ENDPOINT = "/api/tasks/bulk";
const BULK_MUTATIONS = ["bulkApplyTag", "bulkRemoveTag", "bulkCreateTasks", "bulkCompleteTasks"] as const;
export type BulkMutationName = (typeof BULK_MUTATIONS)[number];
const BULK_JOB_KEYS = ["tasks", "agenda", "series"] as const;
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same bulk action again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
type ExpectedRevision = MutationInput<unknown>["expectedRevision"];
export type BulkIntent<P> = { readonly operationId: string; readonly expectedRevision: ExpectedRevision; readonly payload: P };
type BulkPayloadLookup = { readonly bulkApplyTag: BulkApplyTagPayload; readonly bulkRemoveTag: BulkRemoveTagPayload; readonly bulkCreateTasks: BulkCreateTasksPayload; readonly bulkCompleteTasks: BulkCompleteTasksPayload };
type BulkPayload = BulkPayloadLookup[BulkMutationName];
function useBulkChange<P extends BulkPayload>(scope: Scope, mutation: BulkMutationName): UseMutationResult<MutationOutcome, Error, BulkIntent<P>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, BulkIntent<P>>({
    retry: false,
    mutationFn: (intent: BulkIntent<P>): Promise<MutationOutcome> => sendMutation(BULK_ENDPOINT, { operationId: intent.operationId, scope, expectedRevision: intent.expectedRevision, payload: { operation: mutation, ...intent.payload } }, OFFLINE_GUIDANCE),
    onSuccess: async (outcome: MutationOutcome): Promise<void> => await refreshJobs(queryClient, outcome, scopeKey(scope), BULK_JOB_KEYS),
  });
}
export interface BulkTaskMutationTransports {
  readonly bulkApplyTag: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkApplyTagPayload>>;
  readonly bulkRemoveTag: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkRemoveTagPayload>>;
  readonly bulkCreateTasks: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkCreateTasksPayload>>;
  readonly bulkCompleteTasks: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkCompleteTasksPayload>>;
}
/** Builds the four bulk actions as the browser transports for `POST /api/tasks/bulk`, each returning exactly one outcome. */ export function useBulkTaskMutations(scope: Scope): BulkTaskMutationTransports {
  const bulkApplyTag = useBulkChange<BulkApplyTagPayload>(scope, "bulkApplyTag");
  const bulkRemoveTag = useBulkChange<BulkRemoveTagPayload>(scope, "bulkRemoveTag");
  const bulkCreateTasks = useBulkChange<BulkCreateTasksPayload>(scope, "bulkCreateTasks");
  const bulkCompleteTasks = useBulkChange<BulkCompleteTasksPayload>(scope, "bulkCompleteTasks");
  return { bulkApplyTag, bulkRemoveTag, bulkCreateTasks, bulkCompleteTasks };
}
