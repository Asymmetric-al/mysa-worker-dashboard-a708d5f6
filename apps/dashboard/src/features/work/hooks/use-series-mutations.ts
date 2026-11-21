"use client";
/**
 * The browser transport for the recurring-task family's eight named mutations — `createSeries`,
 * `editOccurrence`, `editThisAndFuture`, `skipOccurrence`, `pauseSeries`, `resumeSeries`, `stopSeries`
 * and `resolveMissedPlan` — over `POST /api/series`.
 *
 * Each mutation submits the four-field contract (`operationId`, `scope`, `expectedRevision`, `payload`)
 * and returns the handler's own outcome unchanged, so one receipt renders what happened. The attempt
 * identity and the revision are the caller's: they arrive with the intent and leave in the body
 * untouched, which is what lets a lost acknowledgement return the original result instead of repeating
 * the effect, and what makes an action queued across a later Stop answer `conflict` rather than quietly
 * revive a plan the worker ended.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { EditOccurrencePayload, ResolveMissedPlanPayload, SkipOccurrencePayload } from "../schemas/occurrence";
import type { CreateSeriesPayload, EditThisAndFuturePayload, PauseSeriesPayload, ResumeSeriesPayload, StopSeriesPayload } from "../schemas/series";
/** The one handler every series change travels to. */
const SERIES_ENDPOINT = "/api/series";

/** The closed set of series mutations: the names `POST /api/series` dispatches on, and no ninth. */
const SERIES_MUTATIONS = ["createSeries", "editOccurrence", "editThisAndFuture", "skipOccurrence", "pauseSeries", "resumeSeries", "stopSeries", "resolveMissedPlan"] as const;

/** One of the eight names above. */
export type SeriesMutationName = (typeof SERIES_MUTATIONS)[number];

/**
 * The cache segments any of the eight changes can leave out of date.
 *
 * A series change moves the actionable occurrence, so the plan's own view is stale — and so are the
 * task lists and the agenda that show that occurrence, because only one date of a series is ever
 * actionable and completing, skipping or revising it is what admits the next one.
 */
const SERIES_JOB_KEYS = ["series", "tasks", "agenda"] as const;

/** A record's optimistic-concurrency token, taken from the mutation contract rather than declared again here. */
type ExpectedRevision = MutationInput<unknown>["expectedRevision"];

/**
 * One change a caller asks for: the attempt's identity, the revision it was read at, and the payload.
 *
 * Both machine values are required and neither has a default. The call site mints one `operationId` per
 * intent and resubmits the same one on retry — minting here would hand one identity to two intents and
 * turn a changed request into a false `alreadyAccepted`. The revision is equally the caller's: refreshing
 * it here would let an action the worker made against an older plan overwrite the Stop that replaced it.
 */
export type SeriesIntent<P> = {
  readonly operationId: string;
  readonly expectedRevision: ExpectedRevision;
  readonly payload: P;
};

/** The payload each named mutation takes, kept beside the closed set that names them. */
export interface SeriesMutationTransports {
  readonly createSeries: UseMutationResult<MutationOutcome, Error, SeriesIntent<CreateSeriesPayload>>;
  readonly editOccurrence: UseMutationResult<MutationOutcome, Error, SeriesIntent<EditOccurrencePayload>>;
  readonly editThisAndFuture: UseMutationResult<MutationOutcome, Error, SeriesIntent<EditThisAndFuturePayload>>;
  readonly skipOccurrence: UseMutationResult<MutationOutcome, Error, SeriesIntent<SkipOccurrencePayload>>;
  readonly pauseSeries: UseMutationResult<MutationOutcome, Error, SeriesIntent<PauseSeriesPayload>>;
  readonly resumeSeries: UseMutationResult<MutationOutcome, Error, SeriesIntent<ResumeSeriesPayload>>;
  readonly stopSeries: UseMutationResult<MutationOutcome, Error, SeriesIntent<StopSeriesPayload>>;
  readonly resolveMissedPlan: UseMutationResult<MutationOutcome, Error, SeriesIntent<ResolveMissedPlanPayload>>;
}

/**
 * Posts one series mutation and answers the handler's own outcome.
 *
 * The mutation's name travels inside `payload` because that is where `POST /api/series` selects the
 * mutation: its body carries the four contract fields alone, each payload's closed schema declares the
 * `mutation` literal beside the fields that mutation reads, and the handler strips the discriminant again
 * before calling the service. A name carried beside the contract fields would be an unknown field and
 * every request would answer `invalid`.
 *
 * A rejected fetch is infrastructure, not a business outcome: it is left to reject so the caller renders
 * its unavailable state. An outcome built in the browser would be a claim about the store that this
 * process never asked the store for.
 */
async function postSeriesMutation<P extends object>(mutation: SeriesMutationName, input: MutationInput<P>): Promise<MutationOutcome> {
  const response = await fetch(SERIES_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    // The development session is an httpOnly, sameSite=lax cookie, so only a same-origin request carries
    // it; the handler resolves the caller's authority from it rather than from the body's scope alone.
    credentials: "same-origin",
    body: JSON.stringify({ ...input, payload: { ...input.payload, mutation } }),
  });
  // `toResponse` in `modules/data-service/response.ts` is the only producer of this body: every answer —
  // `conflict` and `invalid` included — is one of the eight outcomes, so the body is read as the union
  // rather than re-validated or re-shaped in the browser.
  return (await response.json()) as MutationOutcome;
}

/** The body one intent presents: the hook's own scope, with the caller's identity, revision and payload intact. */
function withScope<P extends object>(scope: Scope, intent: SeriesIntent<P>): MutationInput<P> {
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
 * Re-reads the three job keys that a series change can affect, under the scope the change was made in.
 *
 * Exactly the two outcomes that changed something refresh. The other six did not, and re-reading on them
 * would replace what the worker is looking at for no reason: a `conflict` must leave the current plan
 * visible beside the preserved intent, and an `unknown` must stay an uncertainty the worker resolves by
 * re-querying its `operationId`, not a silent refresh that reads like confirmation.
 */
async function refreshSeriesJobs(outcome: MutationOutcome, queryClient: QueryClient, scope: Scope): Promise<void> {
  if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
    return;
  }
  const prefix = scopeKey(scope);
  for (const job of SERIES_JOB_KEYS) {
    await queryClient.invalidateQueries({ queryKey: [...prefix, job] });
  }
}

/**
 * Builds the eight series mutations — `createSeries`, `editOccurrence`, `editThisAndFuture`,
 * `skipOccurrence`, `pauseSeries`, `resumeSeries`, `stopSeries` and `resolveMissedPlan` — as the browser
 * transports for `POST /api/series`, each returning exactly one `MutationOutcome` unchanged so no surface
 * infers success from an absent error.
 *
 * Every one refuses to retry: a resubmission must carry the caller's original `operationId` and the
 * revision it read, so the library quietly trying again would repeat an effect under an identity the
 * recovery path cannot see. Nothing here computes a date or a repeat: the rule in force, the next-three
 * preview, the disclosed month-day resolution and the plan's standing all come from the read envelope,
 * and the resolved next date from the outcome.
 */
export function useSeriesMutations(scope: Scope): SeriesMutationTransports {
  const queryClient = useQueryClient();

  const createSeries = useMutation<MutationOutcome, Error, SeriesIntent<CreateSeriesPayload>>({
    mutationFn: (intent) => postSeriesMutation("createSeries", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  const editOccurrence = useMutation<MutationOutcome, Error, SeriesIntent<EditOccurrencePayload>>({
    mutationFn: (intent) => postSeriesMutation("editOccurrence", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  const editThisAndFuture = useMutation<MutationOutcome, Error, SeriesIntent<EditThisAndFuturePayload>>({
    mutationFn: (intent) => postSeriesMutation("editThisAndFuture", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  const skipOccurrence = useMutation<MutationOutcome, Error, SeriesIntent<SkipOccurrencePayload>>({
    mutationFn: (intent) => postSeriesMutation("skipOccurrence", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  const pauseSeries = useMutation<MutationOutcome, Error, SeriesIntent<PauseSeriesPayload>>({
    mutationFn: (intent) => postSeriesMutation("pauseSeries", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  const resumeSeries = useMutation<MutationOutcome, Error, SeriesIntent<ResumeSeriesPayload>>({
    mutationFn: (intent) => postSeriesMutation("resumeSeries", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  const stopSeries = useMutation<MutationOutcome, Error, SeriesIntent<StopSeriesPayload>>({
    mutationFn: (intent) => postSeriesMutation("stopSeries", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  const resolveMissedPlan = useMutation<MutationOutcome, Error, SeriesIntent<ResolveMissedPlanPayload>>({
    mutationFn: (intent) => postSeriesMutation("resolveMissedPlan", withScope(scope, intent)),
    onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope),
    retry: false,
  });

  return { createSeries, editOccurrence, editThisAndFuture, skipOccurrence, pauseSeries, resumeSeries, stopSeries, resolveMissedPlan };
}
