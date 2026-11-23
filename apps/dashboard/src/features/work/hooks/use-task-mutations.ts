"use client";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { refreshJobs, sendMutation } from "@/lib/read-transport";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { CancelTaskPayload, CompleteTaskPayload, CreateTaskPayload, EditTaskPayload, ReopenTaskPayload } from "../schemas/task";
const TASKS_ENDPOINT = "/api/tasks";
const TASK_MUTATIONS = ["createTask", "editTask", "completeTask", "reopenTask", "cancelTask"] as const;
export type TaskMutationName = (typeof TASK_MUTATIONS)[number];
const TASK_JOB_KEYS = ["tasks", "agenda", "series"] as const;
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same change again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
type ExpectedRevision = MutationInput<unknown>["expectedRevision"];
export type TaskIntent<P> = { readonly operationId: string; readonly expectedRevision: ExpectedRevision; readonly payload: P };
type TaskPayloadLookup = { readonly createTask: CreateTaskPayload; readonly editTask: EditTaskPayload; readonly completeTask: CompleteTaskPayload; readonly reopenTask: ReopenTaskPayload; readonly cancelTask: CancelTaskPayload };
type TaskPayload = TaskPayloadLookup[TaskMutationName];
type UnnamedMutation = Exclude<TaskMutationName, keyof TaskPayloadLookup>;
type UnpayloadedMutation = Exclude<keyof TaskPayloadLookup, TaskMutationName>;
type PayloadOperationMismatch = { readonly [Name in TaskMutationName]: TaskPayloadLookup[Name]["operation"] extends Name ? never : Name }[TaskMutationName];
export const TASK_MUTATIONS_ARE_COMPLETE: [UnnamedMutation, UnpayloadedMutation, PayloadOperationMismatch] extends [never, never, never] ? true : false = true;
export interface TaskMutationTransports {
  readonly createTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CreateTaskPayload>>;
  readonly editTask: UseMutationResult<MutationOutcome, Error, TaskIntent<EditTaskPayload>>;
  readonly completeTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CompleteTaskPayload>>;
  readonly reopenTask: UseMutationResult<MutationOutcome, Error, TaskIntent<ReopenTaskPayload>>;
  readonly cancelTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CancelTaskPayload>>;
}
function useTaskChange<P extends TaskPayload>(scope: Scope): UseMutationResult<MutationOutcome, Error, TaskIntent<P>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, TaskIntent<P>>({
    retry: false,
    mutationFn: (intent: TaskIntent<P>): Promise<MutationOutcome> => sendMutation(TASKS_ENDPOINT, { operationId: intent.operationId, scope, expectedRevision: intent.expectedRevision, payload: intent.payload }, OFFLINE_GUIDANCE),
    onSuccess: async (outcome: MutationOutcome): Promise<void> => await refreshJobs(queryClient, outcome, scopeKey(scope), TASK_JOB_KEYS),
  });
}
/** Builds the five task mutations as the browser transports for `POST /api/tasks`, each returning exactly one outcome. */ export function useTaskMutations(scope: Scope): TaskMutationTransports {
  const createTask = useTaskChange<CreateTaskPayload>(scope);
  const editTask = useTaskChange<EditTaskPayload>(scope);
  const completeTask = useTaskChange<CompleteTaskPayload>(scope);
  const reopenTask = useTaskChange<ReopenTaskPayload>(scope);
  const cancelTask = useTaskChange<CancelTaskPayload>(scope);
  return { createTask, editTask, completeTask, reopenTask, cancelTask };
}
