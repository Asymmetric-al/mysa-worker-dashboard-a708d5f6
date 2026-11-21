"use client";
/**
 * The two reach decisions of the Worker and Project Pages family, as the reach control and the
 * containment confirmation dispatch them: `setReach`, which gives every released edition of one page
 * one of exactly three reaches, and `stopShowingPublicly`, which contains every edition of it at once.
 *
 * **One transport.** Both post through `./use-page-mutation`, so the family has one request path, one
 * outcome guard and one recovery for a lost acknowledgement. Neither hook mints an `operationId`: the
 * attempt's identity belongs to the caller that started it, which is what lets an uncertain attempt be
 * re-queried under the same identity instead of being repeated under a new one.
 *
 * **Judged before anything is sent.** Each body is validated by its own schema in `../schemas/reach.ts`
 * first, so a fourth visibility value, or a containment the worker did not acknowledge, reaches the
 * caller as the `invalid` outcome with per-field messages and no request. The handler path serves both
 * mutations, so each payload also names the mutation that chose it as `operation`; that is a mutation
 * name, never a reach value.
 *
 * Reach is exactly Not public, Shared by link: public, or Listed publicly — one closed vocabulary,
 * owned by that schema's enum and never restated here as a tuple of its own.
 *
 * **Nothing is claimed locally.** Neither hook writes a reach or a withdrawal into the cache: both
 * re-read the page and the pages family after a settled attempt, so a reach the service refused can
 * never be displayed as though it had been applied.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { input as SchemaInput } from "zod";
import { assertNever } from "@/lib/result";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { setReachInputSchema, stopShowingPubliclyFormSchema, stopShowingPubliclyInputSchema, type SetReachPayload, type StopShowingPubliclyPayload } from "../schemas/reach";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

const REACH_PATH = "/api/pages/reach";
/** The mutation name the reach handler reads to choose `setReach`, so no caller names it. */
const SET_REACH_OPERATION = "setReach";
/** The mutation name the same handler reads to choose `stopShowingPublicly`. */
const STOP_SHOWING_OPERATION = "stopShowingPublicly";

/** A payload as the reach handler selects it: the service's own payload plus the mutation name that chose it. */
type Routed<P> = P & { readonly operation: string };

/**
 * What `useSetPageReach` accepts: the page and the reach it takes, inside the shared operation,
 * scope and revision envelope.
 */
export type SetReachVariables = MutationInput<SetReachPayload>;

/**
 * What the containment confirmation submits: the page, and the worker's confirmation that every
 * language edition of it stops being served.
 */
export type StopShowingPayload = SchemaInput<typeof stopShowingPubliclyFormSchema>;

/** What `useStopShowingPagePublicly` accepts: the acknowledged containment inside the same envelope. */
export type StopShowingVariables = MutationInput<StopShowingPayload>;

/**
 * Re-reads what a settled reach change can have altered: the page's own reach-bearing reads and the
 * pages family, because reach decides what the discovery index enumerates and what a direct reading
 * route serves.
 *
 * An `unknown` attempt is re-read as well, since an unacknowledged reach change may have been applied
 * and only the service can say whether it was. An outcome that left the service's state as it was
 * refreshes nothing, so a refusal never looks like a change.
 */
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

/**
 * `setReach`: gives every released edition of one page one of the three reach values, and answers with
 * the outcome the service stated — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`,
 * `invalid`, `unavailable` or `unknown`.
 */
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
      return transport.mutateAsync({
        ...checked.data,
        payload: { operation: SET_REACH_OPERATION, ...checked.data.payload },
      });
    },
    onSuccess: (outcome: MutationOutcome, variables: SetReachVariables): void => {
      reReadReach(queryClient, outcome, variables.scope, variables.payload.documentId);
    },
  });
}

/**
 * `useStopShowingPagePublicly` posts `stopShowingPublicly`: it contains every language edition of one
 * page at one instant, and answers with the outcome the service stated.
 *
 * This is containment rather than editorial cleanup — it is accepted while an unrelated draft of the
 * page is invalid, so no draft, prose or page body is read or validated here — and it promises no
 * recall of a copy a reader has already received. It records no approval, review or publication: the
 * outcome reaches the caller exactly as the service stated it, with no message added and nothing
 * chained after it.
 */
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
      const checked = stopShowingPubliclyInputSchema.safeParse({
        operationId: variables.operationId,
        scope: variables.scope,
        expectedRevision: variables.expectedRevision,
        payload: confirmed.data,
      });
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      return transport.mutateAsync({
        ...checked.data,
        payload: { operation: STOP_SHOWING_OPERATION, ...checked.data.payload },
      });
    },
    onSuccess: (outcome: MutationOutcome, variables: StopShowingVariables): void => {
      reReadReach(queryClient, outcome, variables.scope, variables.payload.documentId);
    },
  });
}
