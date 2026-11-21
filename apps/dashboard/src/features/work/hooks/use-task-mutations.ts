"use client";
/** The browser transport for the one task model's five named mutations — `createTask`, `editTask`, `completeTask`, `reopenTask` and `cancelTask` — over `POST /api/tasks`. */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { CancelTaskPayload, CompleteTaskPayload, CreateTaskPayload, EditTaskPayload, ReopenTaskPayload } from "../schemas/task";
const TASKS_ENDPOINT = "/api/tasks";
const TASK_MUTATIONS = ["createTask", "editTask", "completeTask", "reopenTask", "cancelTask"] as const;

export type TaskMutationName = (typeof TASK_MUTATIONS)[number];

const TASK_JOB_KEYS = ["tasks", "agenda", "series"] as const;

type ExpectedRevision = MutationInput<unknown>["expectedRevision"];

export type TaskIntent<P> = { readonly operationId: string; readonly expectedRevision: ExpectedRevision; readonly payload: P };

interface TaskPayloadLookup {
  readonly createTask: CreateTaskPayload;
  readonly editTask: EditTaskPayload;
  readonly completeTask: CompleteTaskPayload;
  readonly reopenTask: ReopenTaskPayload;
  readonly cancelTask: CancelTaskPayload;
}

type TaskPayload = TaskPayloadLookup[TaskMutationName];

type UnnamedMutation = Exclude<TaskMutationName, keyof TaskPayloadLookup>;

type UnpayloadedMutation = Exclude<keyof TaskPayloadLookup, TaskMutationName>;

type PayloadOperationMismatch = {
  readonly [Name in TaskMutationName]: TaskPayloadLookup[Name]["operation"] extends Name ? never : Name;
}[TaskMutationName];

export const TASK_MUTATIONS_ARE_COMPLETE: [UnnamedMutation, UnpayloadedMutation, PayloadOperationMismatch] extends [never, never, never] ? true : false = true;

async function postTaskMutation<P extends TaskPayload>(input: MutationInput<P>): Promise<MutationOutcome> {
  const response = await fetch(TASKS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    // The development session is an httpOnly, sameSite=lax cookie, so only a same-origin request carries
    // it; the handler resolves the caller's authority from it rather than from the body's scope alone.
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  // `toResponse` in `modules/data-service/response.ts` is the only producer of this body: every answer —
  // including `conflict` (409) and `invalid` (422) — is one of the eight outcomes, so the body is read as
  // the union rather than re-validated or re-shaped in the browser.
  return (await response.json()) as MutationOutcome;
}

function withScope<P extends TaskPayload>(scope: Scope, intent: TaskIntent<P>): MutationInput<P> {
  // The scope is the one the route composition handed this hook: never derived from the payload, never
  // defaulted, never held in module state, so a change cannot name authority the caller was not given.
  return { operationId: intent.operationId, scope, expectedRevision: intent.expectedRevision, payload: intent.payload };
}

function invalidatesTaskJobs(outcome: MutationOutcome): boolean {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
      return true;
    case "unchanged":
    case "conflict":
    case "denied":
    case "invalid":
    case "unavailable":
    case "unknown":
      return false;
  }
}

async function refreshTaskJobs(outcome: MutationOutcome, queryClient: QueryClient, scope: Scope): Promise<void> {
  if (!invalidatesTaskJobs(outcome)) {
    return;
  }
  const prefix = scopeKey(scope);
  for (const job of TASK_JOB_KEYS) {
    await queryClient.invalidateQueries({ queryKey: [...prefix, job] });
  }
}

export interface TaskMutationTransports {
  readonly createTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CreateTaskPayload>>;
  readonly editTask: UseMutationResult<MutationOutcome, Error, TaskIntent<EditTaskPayload>>;
  readonly completeTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CompleteTaskPayload>>;
  readonly reopenTask: UseMutationResult<MutationOutcome, Error, TaskIntent<ReopenTaskPayload>>;
  readonly cancelTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CancelTaskPayload>>;
}

/** Builds the five task mutations — `createTask`, `editTask`, `completeTask`, `reopenTask` and `cancelTask` — as the browser transports for `POST /api/tasks`, each returning exactly one … */
export function useTaskMutations(scope: Scope): TaskMutationTransports {
  const queryClient = useQueryClient();

  const createTask = useMutation<MutationOutcome, Error, TaskIntent<CreateTaskPayload>>({ mutationFn: (intent) => postTaskMutation(withScope(scope, intent)), onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope), retry: false });

  const editTask = useMutation<MutationOutcome, Error, TaskIntent<EditTaskPayload>>({ mutationFn: (intent) => postTaskMutation(withScope(scope, intent)), onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope), retry: false });

  const completeTask = useMutation<MutationOutcome, Error, TaskIntent<CompleteTaskPayload>>({ mutationFn: (intent) => postTaskMutation(withScope(scope, intent)), onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope), retry: false });

  const reopenTask = useMutation<MutationOutcome, Error, TaskIntent<ReopenTaskPayload>>({ mutationFn: (intent) => postTaskMutation(withScope(scope, intent)), onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope), retry: false });

  const cancelTask = useMutation<MutationOutcome, Error, TaskIntent<CancelTaskPayload>>({ mutationFn: (intent) => postTaskMutation(withScope(scope, intent)), onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope), retry: false });

  return { createTask, editTask, completeTask, reopenTask, cancelTask };
}
