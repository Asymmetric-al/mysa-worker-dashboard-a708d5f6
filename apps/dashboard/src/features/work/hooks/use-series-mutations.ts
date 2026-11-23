"use client";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { refreshJobs, sendMutation } from "@/lib/read-transport";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { EditOccurrencePayload, ResolveMissedPlanPayload, SkipOccurrencePayload } from "../schemas/occurrence";
import type { CreateSeriesPayload, EditThisAndFuturePayload, PauseSeriesPayload, ResumeSeriesPayload, StopSeriesPayload } from "../schemas/series";
const SERIES_ENDPOINT = "/api/series";
const SERIES_MUTATIONS = ["createSeries", "editOccurrence", "editThisAndFuture", "skipOccurrence", "pauseSeries", "resumeSeries", "stopSeries", "resolveMissedPlan"] as const;
export type SeriesMutationName = (typeof SERIES_MUTATIONS)[number];
const SERIES_JOB_KEYS = ["series", "tasks", "agenda"] as const;
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same change again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
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
function useSeriesChange<P extends object>(scope: Scope, mutation: SeriesMutationName): UseMutationResult<MutationOutcome, Error, SeriesIntent<P>> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation<MutationOutcome, Error, SeriesIntent<P>>({
    retry: false,
    mutationFn: (intent: SeriesIntent<P>): Promise<MutationOutcome> => sendMutation(SERIES_ENDPOINT, { operationId: intent.operationId, scope, expectedRevision: intent.expectedRevision, payload: { ...intent.payload, mutation } }, OFFLINE_GUIDANCE),
    // Only `accepted` and `alreadyAccepted` are outcomes that testify an effect exists: `unchanged` answers from the state already on screen, the refusals changed nothing this family reads, and `unknown` refreshes nothing at all because a fresh read is no substitute for checking what the attempt did. The invalidation reaches the plan body's own read; asking this route for its read again renews the envelope that body is seeded with, so the server payload and the cached read state the same plan.
    onSuccess: async (outcome: MutationOutcome): Promise<void> => {
      await refreshJobs(queryClient, outcome, scopeKey(scope), SERIES_JOB_KEYS);
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") router.refresh();
    },
  });
}
/** Builds the eight series mutations as the browser transports for `/api/series`, each returning exactly one outcome. */ export function useSeriesMutations(scope: Scope): SeriesMutationTransports {
  const createSeries = useSeriesChange<CreateSeriesPayload>(scope, "createSeries");
  const editOccurrence = useSeriesChange<EditOccurrencePayload>(scope, "editOccurrence");
  const editThisAndFuture = useSeriesChange<EditThisAndFuturePayload>(scope, "editThisAndFuture");
  const skipOccurrence = useSeriesChange<SkipOccurrencePayload>(scope, "skipOccurrence");
  const pauseSeries = useSeriesChange<PauseSeriesPayload>(scope, "pauseSeries");
  const resumeSeries = useSeriesChange<ResumeSeriesPayload>(scope, "resumeSeries");
  const stopSeries = useSeriesChange<StopSeriesPayload>(scope, "stopSeries");
  const resolveMissedPlan = useSeriesChange<ResolveMissedPlanPayload>(scope, "resolveMissedPlan");
  return { createSeries, editOccurrence, editThisAndFuture, skipOccurrence, pauseSeries, resumeSeries, stopSeries, resolveMissedPlan };
}
