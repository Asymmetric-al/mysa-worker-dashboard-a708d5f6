"use client";
/** The two reach decisions of the Worker and Project Pages family, as the reach control and the containment confirmation dispatch them: */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { input as SchemaInput } from "zod";
import { assertNever } from "@/lib/result";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { setReachInputSchema, stopShowingPubliclyFormSchema, stopShowingPubliclyInputSchema, type SetReachPayload, type StopShowingPubliclyPayload } from "../schemas/reach";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

const REACH_PATH = "/api/pages/reach";
const SET_REACH_OPERATION = "setReach";
const STOP_SHOWING_OPERATION = "stopShowingPublicly";

type Routed<P> = P & { readonly operation: string };

export type SetReachVariables = MutationInput<SetReachPayload>;

export type StopShowingPayload = SchemaInput<typeof stopShowingPubliclyFormSchema>;

export type StopShowingVariables = MutationInput<StopShowingPayload>;

function reReadReach(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope, documentId: string): void {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unknown":
      void queryClient.invalidateQueries({ queryKey: pageKey(scope, documentId) });
      void queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) });
      return;
    case "unchanged":
    case "conflict":
    case "invalid":
    case "denied":
    case "unavailable":
      return;
    default:
      assertNever(outcome, "Unhandled mutation outcome");
  }
}

/** `setReach`: gives every released edition of one page one of the three reach values, and answers with the outcome the service stated — `accepted`, `alreadyAccepted`, `unchanged`, `conflict` … */
export function useSetPageReach(): UseMutationResult<MutationOutcome, never, SetReachVariables> {
  const queryClient = useQueryClient();
  // The transport is given no invalidation list of its own: the keys that must be re-read depend on
  // the scope and the page this call carries, so they are derived from the settled attempt below.
  const transport = usePageMutation<Routed<SetReachPayload>>({ path: REACH_PATH });
  return useMutation<MutationOutcome, never, SetReachVariables>({
    // A mutation is not retried: an attempt whose acknowledgement was lost is recovered by the caller
    // under the same operationId, never repeated here under a fresh one.
    retry: false,
    mutationFn: async (variables: SetReachVariables): Promise<MutationOutcome> => {
      const checked = setReachInputSchema.safeParse(variables);
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      return transport.mutateAsync({ ...checked.data, payload: { operation: SET_REACH_OPERATION, ...checked.data.payload } });
    },
    onSuccess: (outcome: MutationOutcome, variables: SetReachVariables): void => {
      reReadReach(queryClient, outcome, variables.scope, variables.payload.documentId);
    },
  });
}

/** `useStopShowingPagePublicly` posts `stopShowingPublicly`: it contains every language edition of one page at one instant, and answers with the outcome the service stated. */
export function useStopShowingPagePublicly(): UseMutationResult<MutationOutcome, never, StopShowingVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation<Routed<StopShowingPubliclyPayload>>({ path: REACH_PATH });
  return useMutation<MutationOutcome, never, StopShowingVariables>({
    retry: false,
    mutationFn: async (variables: StopShowingVariables): Promise<MutationOutcome> => {
      // The confirmation is judged by the dialog's own schema first, and the acknowledgement is then
      // left out of the request: the service's payload carries only the page, so a containment is never
      // requested without the worker having confirmed that it covers every language edition.
      const confirmed = stopShowingPubliclyFormSchema.safeParse(variables.payload);
      if (!confirmed.success) {
        return invalid({ operationId: variables.operationId, fields: confirmed.error });
      }
      const checked = stopShowingPubliclyInputSchema.safeParse({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: confirmed.data });
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      return transport.mutateAsync({ ...checked.data, payload: { operation: STOP_SHOWING_OPERATION, ...checked.data.payload } });
    },
    onSuccess: (outcome: MutationOutcome, variables: StopShowingVariables): void => {
      reReadReach(queryClient, outcome, variables.scope, variables.payload.documentId);
    },
  });
}
