"use client";
/**
 * The browser transport for the Work family's three bulk actions — applying or removing one private
 * tag, creating ordinary follow-up tasks, and completing tasks that can be completed independently —
 * over `POST /api/tasks/bulk`, returning the handler's outcome with every per-item result untouched.
 *
 * Exactly three actions exist and four service methods express them, because the private-tag action has
 * two directions. A selection is the rows the worker explicitly chose: never a filter, a saved view or
 * an audience, and never a consent or a campaign.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { BulkApplyTagPayload, BulkCompleteTasksPayload, BulkCreateTasksPayload, BulkRemoveTagPayload } from "../schemas/bulk";
/** The one handler every bulk action travels to. */
const BULK_ENDPOINT = "/api/tasks/bulk";

/** The closed set of bulk mutations: the four methods `POST /api/tasks/bulk` dispatches to, and no fifth. */
const BULK_MUTATIONS = ["bulkApplyTag", "bulkRemoveTag", "bulkCreateTasks", "bulkCompleteTasks"] as const;

/** One of the four names above. */
export type BulkMutationName = (typeof BULK_MUTATIONS)[number];

/** The cache segments a bulk change can leave out of date: a task list, the agenda and a series view. */
const BULK_JOB_KEYS = ["tasks", "agenda", "series"] as const;

/** A record's optimistic-concurrency token, taken from the mutation contract rather than declared again here. */
type ExpectedRevision = MutationInput<unknown>["expectedRevision"];

/**
 * One bulk attempt a caller asks for: the attempt's identity, the revision it was read at, and the
 * payload that action takes.
 *
 * Both machine values are required and neither has a default. The call site mints one `operationId` per
 * intent and resubmits the same one on retry — minting here would give one identity to two intents and
 * turn a real change into a false replay, and defaulting the revision would make a stale write
 * overwrite instead of surfacing as a conflict. Not to be confused with the `BulkIntent` in
 * `../copy/bulk-actions`, which names the three actions the bar offers; this one is a submitted attempt.
 */
export type BulkIntent<P> = {
  readonly operationId: string;
  readonly expectedRevision: ExpectedRevision;
  readonly payload: P;
};

/**
 * The payload each named mutation takes, read by the closed set above rather than restated beside it.
 *
 * These are the schema's own validated payloads and carry no discriminant: the transport below adds the
 * name the handler dispatches on, from the same literal it names the mutation with, so the name in the
 * `mutationFn` and the name in the body cannot disagree.
 */
interface BulkPayloadLookup {
  readonly bulkApplyTag: BulkApplyTagPayload;
  readonly bulkRemoveTag: BulkRemoveTagPayload;
  readonly bulkCreateTasks: BulkCreateTasksPayload;
  readonly bulkCompleteTasks: BulkCompleteTasksPayload;
}

/** Any payload the one transport accepts: one member per named mutation. */
type BulkPayload = BulkPayloadLookup[BulkMutationName];

/**
 * Posts one bulk action and answers the handler's own outcome.
 *
 * The action is named by `payload.operation`, which the handler dispatches on and strips before the
 * mutation's closed schema reads the rest. `POST /api/tasks/bulk` accepts a closed body of the four
 * contract fields alone, so a name carried beside them would be an unknown field and every request would
 * come back `invalid`.
 *
 * A rejected fetch is infrastructure, not a business outcome: it is left to reject so the caller renders
 * its unavailable state, and no outcome is invented here — an outcome built in the browser would be a
 * claim about the store that this process never asked the store for.
 */
async function postBulkMutation<P extends BulkPayload>(mutation: BulkMutationName, input: MutationInput<P>): Promise<MutationOutcome> {
  const response = await fetch(BULK_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    // The development session is an httpOnly, sameSite=lax cookie, so only a same-origin request carries
    // it; the handler resolves the caller's authority from it rather than from the body's scope alone.
    credentials: "same-origin",
    body: JSON.stringify({
      operationId: input.operationId,
      scope: input.scope,
      expectedRevision: input.expectedRevision,
      payload: { operation: mutation, ...input.payload },
    }),
  });
  // `toResponse` in `modules/data-service/response.ts` is the only producer of this body: every answer —
  // including `conflict` (409) and `invalid` (422) — is one of the eight outcomes, so the body is read as
  // the union rather than re-validated or re-shaped in the browser.
  return (await response.json()) as MutationOutcome;
}

/** The body one intent presents: the hook's own scope, with the caller's identity, revision and payload intact. */
function withScope<P extends BulkPayload>(scope: Scope, intent: BulkIntent<P>): MutationInput<P> {
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
 * stay an uncertainty the worker resolves by the operation id, not a silent refresh that reads as
 * confirmation.
 */
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

/** Re-reads the three job keys a bulk change can affect, under the scope the change was made in. */
async function refreshBulkJobs(outcome: MutationOutcome, queryClient: QueryClient, scope: Scope): Promise<void> {
  if (!invalidatesBulkJobs(outcome)) {
    return;
  }
  const prefix = scopeKey(scope);
  for (const job of BULK_JOB_KEYS) {
    await queryClient.invalidateQueries({ queryKey: [...prefix, job] });
  }
}

/**
 * The four bulk mutations, each answering the handler's outcome unchanged so one receipt renders every
 * row's own result. Nothing here counts, totals or filters those results: a selection has no single
 * outcome, and a partial failure must never be summarised away.
 */
export interface BulkTaskMutationTransports {
  readonly bulkApplyTag: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkApplyTagPayload>>;
  readonly bulkRemoveTag: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkRemoveTagPayload>>;
  readonly bulkCreateTasks: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkCreateTasksPayload>>;
  readonly bulkCompleteTasks: UseMutationResult<MutationOutcome, Error, BulkIntent<BulkCompleteTasksPayload>>;
}

/**
 * Builds the four bulk actions — `bulkApplyTag`, `bulkRemoveTag`, `bulkCreateTasks` and
 * `bulkCompleteTasks` — as the browser transports for `POST /api/tasks/bulk`, each returning exactly one
 * `MutationOutcome` unchanged so no surface infers success from an absent error.
 *
 * Every one refuses to retry: a resubmission must carry the caller's original `operationId`, so the
 * library quietly trying again would repeat an effect under an identity the recovery path cannot see.
 */
export function useBulkTaskMutations(scope: Scope): BulkTaskMutationTransports {
  const queryClient = useQueryClient();

  const bulkApplyTag = useMutation<MutationOutcome, Error, BulkIntent<BulkApplyTagPayload>>({
    mutationFn: (intent) => postBulkMutation("bulkApplyTag", withScope(scope, intent)),
    onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope),
    retry: false,
  });

  const bulkRemoveTag = useMutation<MutationOutcome, Error, BulkIntent<BulkRemoveTagPayload>>({
    mutationFn: (intent) => postBulkMutation("bulkRemoveTag", withScope(scope, intent)),
    onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope),
    retry: false,
  });

  const bulkCreateTasks = useMutation<MutationOutcome, Error, BulkIntent<BulkCreateTasksPayload>>({
    mutationFn: (intent) => postBulkMutation("bulkCreateTasks", withScope(scope, intent)),
    onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope),
    retry: false,
  });

  const bulkCompleteTasks = useMutation<MutationOutcome, Error, BulkIntent<BulkCompleteTasksPayload>>({
    mutationFn: (intent) => postBulkMutation("bulkCompleteTasks", withScope(scope, intent)),
    onSuccess: (outcome) => refreshBulkJobs(outcome, queryClient, scope),
    retry: false,
  });

  return { bulkApplyTag, bulkRemoveTag, bulkCreateTasks, bulkCompleteTasks };
}
