"use client";
/**
 * The browser transport for the one task model's five named mutations — `createTask`, `editTask`,
 * `completeTask`, `reopenTask` and `cancelTask` — over `POST /api/tasks`.
 *
 * Each mutation submits exactly the four-field contract (`operationId`, `scope`, `expectedRevision`,
 * `payload`) and returns the handler's own outcome unchanged, so one receipt renders what happened.
 * The attempt identity and the revision are the caller's: they arrive with the intent and leave in the
 * body untouched, which is what lets a lost acknowledgement return the original result instead of
 * repeating the effect, and a stale revision surface as `conflict` rather than be refreshed away.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { CancelTaskPayload, CompleteTaskPayload, CreateTaskPayload, EditTaskPayload, ReopenTaskPayload } from "../schemas/task";
/** The one handler every task change travels to. */
const TASKS_ENDPOINT = "/api/tasks";

/** The closed set of task mutations: the names `POST /api/tasks` dispatches on, and no sixth. */
const TASK_MUTATIONS = ["createTask", "editTask", "completeTask", "reopenTask", "cancelTask"] as const;

/** One of the five names above. */
export type TaskMutationName = (typeof TASK_MUTATIONS)[number];

/** The cache segments any of the five changes can leave out of date: a task list, the agenda and a series view. */
const TASK_JOB_KEYS = ["tasks", "agenda", "series"] as const;

/** A record's optimistic-concurrency token, taken from the mutation contract rather than declared again here. */
type ExpectedRevision = MutationInput<unknown>["expectedRevision"];

/**
 * One change a caller asks for: the attempt's identity, the revision it was read at, and the payload.
 *
 * Both machine values are required and neither has a default. The call site mints one `operationId` per
 * intent and resubmits the same one on retry — minting here would hand one identity to two intents and
 * turn a real change into a false `alreadyAccepted`.
 */
export type TaskIntent<P> = {
  readonly operationId: string;
  readonly expectedRevision: ExpectedRevision;
  readonly payload: P;
};

/**
 * The payload each named mutation takes, read by the closed set above rather than restated beside it.
 *
 * Every payload carries its own `operation`. That field is the discriminant `POST /api/tasks` selects
 * the mutation by, and the handler strips it before the mutation's closed schema validates the rest, so
 * the selected name and the payload cannot disagree.
 */
interface TaskPayloadLookup {
  readonly createTask: CreateTaskPayload;
  readonly editTask: EditTaskPayload;
  readonly completeTask: CompleteTaskPayload;
  readonly reopenTask: ReopenTaskPayload;
  readonly cancelTask: CancelTaskPayload;
}

/** Any payload the one transport accepts: one member per named mutation. */
type TaskPayload = TaskPayloadLookup[TaskMutationName];

type UnnamedMutation = Exclude<TaskMutationName, keyof TaskPayloadLookup>;

type UnpayloadedMutation = Exclude<keyof TaskPayloadLookup, TaskMutationName>;

/** The name a payload reports, wherever it is not the mutation the lookup files it under. */
type PayloadOperationMismatch = {
  readonly [Name in TaskMutationName]: TaskPayloadLookup[Name]["operation"] extends Name ? never : Name;
}[TaskMutationName];

/**
 * A compile-time check rather than a runtime assertion: it holds only while the closed set, the payload
 * lookup and each payload's own `operation` name the same five mutations, so a sixth task mutation — or
 * a renamed one — fails to type-check here instead of at the handler.
 */
export const TASK_MUTATIONS_ARE_COMPLETE: [UnnamedMutation, UnpayloadedMutation, PayloadOperationMismatch] extends [never, never, never] ? true : false = true;

/**
 * Posts one task mutation and answers the handler's own outcome.
 *
 * The mutation is named by `payload.operation`, which the handler dispatches on and strips before the
 * mutation's closed schema reads the rest. `POST /api/tasks` accepts a closed body of the four contract
 * fields alone, so a name carried beside them would be an unknown field and every request would come
 * back `invalid` — the payload is where the selection belongs.
 *
 * A rejected fetch is infrastructure, not a business outcome: it is left to reject so the caller renders
 * its unavailable state, and no outcome is invented here — an outcome built in the browser would be a
 * claim about the store that this process never asked the store for.
 */
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

/** The body one intent presents: the hook's own scope, with the caller's identity, revision and payload intact. */
function withScope<P extends TaskPayload>(scope: Scope, intent: TaskIntent<P>): MutationInput<P> {
  // The scope is the one the route composition handed this hook: never derived from the payload, never
  // defaulted, never held in module state, so a change cannot name authority the caller was not given.
  return {
    operationId: intent.operationId,
    scope,
    expectedRevision: intent.expectedRevision,
    payload: intent.payload,
  };
}

/**
 * Whether a settled attempt leaves a task list, the agenda or a series view out of date.
 *
 * Exactly the two members that changed something do. The other six changed nothing, and re-reading on
 * them would replace the list the worker is looking at for no reason — an `unknown` in particular must
 * stay an uncertainty the worker resolves, not a silent refresh that looks like confirmation.
 */
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

/** Re-reads the three job keys that a task change can affect, under the scope the change was made in. */
async function refreshTaskJobs(outcome: MutationOutcome, queryClient: QueryClient, scope: Scope): Promise<void> {
  if (!invalidatesTaskJobs(outcome)) {
    return;
  }
  const prefix = scopeKey(scope);
  for (const job of TASK_JOB_KEYS) {
    await queryClient.invalidateQueries({ queryKey: [...prefix, job] });
  }
}

/** The five task mutations, each answering the handler's outcome unchanged so one receipt renders it. */
export interface TaskMutationTransports {
  readonly createTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CreateTaskPayload>>;
  readonly editTask: UseMutationResult<MutationOutcome, Error, TaskIntent<EditTaskPayload>>;
  readonly completeTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CompleteTaskPayload>>;
  readonly reopenTask: UseMutationResult<MutationOutcome, Error, TaskIntent<ReopenTaskPayload>>;
  readonly cancelTask: UseMutationResult<MutationOutcome, Error, TaskIntent<CancelTaskPayload>>;
}

/**
 * Builds the five task mutations — `createTask`, `editTask`, `completeTask`, `reopenTask` and
 * `cancelTask` — as the browser transports for `POST /api/tasks`, each returning exactly one
 * `MutationOutcome` unchanged so no surface infers success from an absent error.
 *
 * Every one refuses to retry: a resubmission must carry the caller's original `operationId`, so the
 * library quietly trying again would repeat an effect under an identity the recovery path cannot see.
 */
export function useTaskMutations(scope: Scope): TaskMutationTransports {
  const queryClient = useQueryClient();

  const createTask = useMutation<MutationOutcome, Error, TaskIntent<CreateTaskPayload>>({
    mutationFn: (intent) => postTaskMutation(withScope(scope, intent)),
    onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope),
    retry: false,
  });

  const editTask = useMutation<MutationOutcome, Error, TaskIntent<EditTaskPayload>>({
    mutationFn: (intent) => postTaskMutation(withScope(scope, intent)),
    onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope),
    retry: false,
  });

  const completeTask = useMutation<MutationOutcome, Error, TaskIntent<CompleteTaskPayload>>({
    mutationFn: (intent) => postTaskMutation(withScope(scope, intent)),
    onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope),
    retry: false,
  });

  const reopenTask = useMutation<MutationOutcome, Error, TaskIntent<ReopenTaskPayload>>({
    mutationFn: (intent) => postTaskMutation(withScope(scope, intent)),
    onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope),
    retry: false,
  });

  const cancelTask = useMutation<MutationOutcome, Error, TaskIntent<CancelTaskPayload>>({
    mutationFn: (intent) => postTaskMutation(withScope(scope, intent)),
    onSuccess: (outcome) => refreshTaskJobs(outcome, queryClient, scope),
    retry: false,
  });

  return { createTask, editTask, completeTask, reopenTask, cancelTask };
}
