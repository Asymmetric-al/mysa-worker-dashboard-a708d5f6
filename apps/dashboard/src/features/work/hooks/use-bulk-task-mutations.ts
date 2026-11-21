"use client";
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { BulkApplyTagPayload, BulkCompleteTasksPayload, BulkCreateTasksPayload, BulkRemoveTagPayload } from "../schemas/bulk";
const BULK_ENDPOINT = "/api/tasks/bulk";
const BULK_MUTATIONS = ["bulkApplyTag", "bulkRemoveTag", "bulkCreateTasks", "bulkCompleteTasks"] as const;

export type BulkMutationName = (typeof BULK_MUTATIONS)[number];

const BULK_JOB_KEYS = ["tasks", "agenda", "series"] as const;

type ExpectedRevision = MutationInput<unknown>["expectedRevision"];

export type BulkIntent<P> = { readonly operationId: string; readonly expectedRevision: ExpectedRevision; readonly payload: P };

interface BulkPayloadLookup {
  readonly bulkApplyTag: BulkApplyTagPayload;
  readonly bulkRemoveTag: BulkRemoveTagPayload;
  readonly bulkCreateTasks: BulkCreateTasksPayload;
  readonly bulkCompleteTasks: BulkCompleteTasksPayload;
}

type BulkPayload = BulkPayloadLookup[BulkMutationName];

async function postBulkMutation<P extends BulkPayload>(mutation: BulkMutationName, input: MutationInput<P>): Promise<MutationOutcome> {
  const response = await fetch(BULK_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    // The development session is an httpOnly, sameSite=lax cookie, so only a same-origin request carries
    // it; the handler resolves the caller's authority from it rather than from the body's scope alone.
    credentials: "same-origin",
    body: JSON.stringify({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: { operation: mutation, ...input.payload } }),
  });
  // `toResponse` in `modules/data-service/response.ts` is the only producer of this body: every answer —
  // including `conflict` (409) and `invalid` (422) — is one of the eight outcomes, so the body is read as
  // the union rather than re-validated or re-shaped in the browser.
  return (await response.json()) as MutationOutcome;
}

function withScope<P extends BulkPayload>(scope: Scope, intent: BulkIntent<P>): MutationInput<P> {
  // The scope is the one the route composition handed this hook: never derived from the payload, never
  // defaulted, never held in module state, so a change cannot name authority the caller was not given.
  return { operationId: intent.operationId, scope, expectedRevision: intent.expectedRevision, payload: intent.payload };
}

function invalidatesBulkJobs(outcome: MutationOutcome): boolean {
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

async function refreshBulkJobs(outcome: MutationOutcome, queryClient: QueryClient, scope: Scope): Promise<void> {
  if (!invalidatesBulkJobs(outcome)) {
    return;
  }
  const prefix = scopeKey(scope);
  for (const job of BULK_JOB_KEYS) {
    await queryClient.invalidateQueries({ queryKey: [...prefix, job] });
  }
}

export interface BulkTaskMutationTransports {
  readonly bulkApplyTag: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkApplyTagPayload>>;
  readonly bulkRemoveTag: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkRemoveTagPayload>>;
  readonly bulkCreateTasks: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkCreateTasksPayload>>;
  readonly bulkCompleteTasks: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkCompleteTasksPayload>>;
}

/** Builds the four bulk actions — `bulkApplyTag`, `bulkRemoveTag`, `bulkCreateTasks` and `bulkCompleteTasks` — as the browser transports for `POST /api/tasks/bulk`, each returning exactly one … */
export function useBulkTaskMutations(scope: Scope): BulkTaskMutationTransports {
  const queryClient = useQueryClient();

  const bulkApplyTag = useMutation<MutationOutcome, Error, BulkIntent<BulkApplyTagPayload>>({ mutationFn: (intent) => postBulkMutation("bulkApplyTag", withScope(scope, intent)), onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope), retry: false });

  const bulkRemoveTag = useMutation<MutationOutcome, Error, BulkIntent<BulkRemoveTagPayload>>({ mutationFn: (intent) => postBulkMutation("bulkRemoveTag", withScope(scope, intent)), onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope), retry: false });

  const bulkCreateTasks = useMutation<MutationOutcome, Error, BulkIntent<BulkCreateTasksPayload>>({ mutationFn: (intent) => postBulkMutation("bulkCreateTasks", withScope(scope, intent)), onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope), retry: false });

  const bulkCompleteTasks = useMutation<MutationOutcome, Error, BulkIntent<BulkCompleteTasksPayload>>({ mutationFn: (intent) => postBulkMutation("bulkCompleteTasks", withScope(scope, intent)), onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope), retry: false });

  return { bulkApplyTag, bulkRemoveTag, bulkCreateTasks, bulkCompleteTasks };
}
