"use client";
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { EditOccurrencePayload, ResolveMissedPlanPayload, SkipOccurrencePayload } from "../schemas/occurrence";
import type { CreateSeriesPayload, EditThisAndFuturePayload, PauseSeriesPayload, ResumeSeriesPayload, StopSeriesPayload } from "../schemas/series";
const SERIES_ENDPOINT = "/api/series";
const SERIES_MUTATIONS = ["createSeries", "editOccurrence", "editThisAndFuture", "skipOccurrence", "pauseSeries", "resumeSeries", "stopSeries", "resolveMissedPlan"] as const;

export type SeriesMutationName = (typeof SERIES_MUTATIONS)[number];

const SERIES_JOB_KEYS = ["series", "tasks", "agenda"] as const;

type ExpectedRevision = MutationInput<unknown>["expectedRevision"];

export type SeriesIntent<P> = { readonly operationId: string; readonly expectedRevision: ExpectedRevision; readonly payload: P };

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

function withScope<P extends object>(scope: Scope, intent: SeriesIntent<P>): MutationInput<P> {
  // The scope is the one the route composition handed this hook: never derived from the payload, never
  // defaulted, never held in module state, so a change cannot name authority the caller was not given.
  return { operationId: intent.operationId, scope, expectedRevision: intent.expectedRevision, payload: intent.payload };
}

async function refreshSeriesJobs(outcome: MutationOutcome, queryClient: QueryClient, scope: Scope): Promise<void> {
  if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
    return;
  }
  const prefix = scopeKey(scope);
  for (const job of SERIES_JOB_KEYS) {
    await queryClient.invalidateQueries({ queryKey: [...prefix, job] });
  }
}

/** Builds the eight series mutations — `createSeries`, `editOccurrence`, `editThisAndFuture`, `skipOccurrence`, `pauseSeries`, `resumeSeries`, `stopSeries` and `resolveMissedPlan` — as the browser … */
export function useSeriesMutations(scope: Scope): SeriesMutationTransports {
  const queryClient = useQueryClient();

  const createSeries = useMutation<MutationOutcome, Error, SeriesIntent<CreateSeriesPayload>>({ mutationFn: (intent) => postSeriesMutation("createSeries", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  const editOccurrence = useMutation<MutationOutcome, Error, SeriesIntent<EditOccurrencePayload>>({ mutationFn: (intent) => postSeriesMutation("editOccurrence", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  const editThisAndFuture = useMutation<MutationOutcome, Error, SeriesIntent<EditThisAndFuturePayload>>({ mutationFn: (intent) => postSeriesMutation("editThisAndFuture", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  const skipOccurrence = useMutation<MutationOutcome, Error, SeriesIntent<SkipOccurrencePayload>>({ mutationFn: (intent) => postSeriesMutation("skipOccurrence", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  const pauseSeries = useMutation<MutationOutcome, Error, SeriesIntent<PauseSeriesPayload>>({ mutationFn: (intent) => postSeriesMutation("pauseSeries", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  const resumeSeries = useMutation<MutationOutcome, Error, SeriesIntent<ResumeSeriesPayload>>({ mutationFn: (intent) => postSeriesMutation("resumeSeries", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  const stopSeries = useMutation<MutationOutcome, Error, SeriesIntent<StopSeriesPayload>>({ mutationFn: (intent) => postSeriesMutation("stopSeries", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  const resolveMissedPlan = useMutation<MutationOutcome, Error, SeriesIntent<ResolveMissedPlanPayload>>({ mutationFn: (intent) => postSeriesMutation("resolveMissedPlan", withScope(scope, intent)), onSuccess: (outcome) => refreshSeriesJobs(outcome, queryClient, scope), retry: false });

  return { createSeries, editOccurrence, editThisAndFuture, skipOccurrence, pauseSeries, resumeSeries, stopSeries, resolveMissedPlan };
}
