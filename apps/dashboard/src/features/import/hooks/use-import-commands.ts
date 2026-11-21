"use client";
/**
 * The four contact-import changes as hooks — `proposeImport`, `setRowDecision`, `acceptImportRows` and `cancelImport` — each carrying one named change through this family's transport and handing back the outcome the service answered with, unsummarised.
 *
 * Nothing here validates a payload, suggests a mapping, matches a duplicate, measures a limit, builds a receipt or mints an identity: the payload types are the schemas' own, the attempt identities belong to the journey and to the review step, and every rule about files, rows and cancellation is the service's. What this file does own is the one cache consequence of an answer, stated once in {@link settleImportCache}.
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
// Type-only, as everywhere in this layer: the service entry point also re-exports value helpers built on the framework's server-only response type, so a value import would drag server code into the browser bundle. That is equally why no outcome is ever built here — every one handed on below arrived from `../client`.
import type { MutationInput, MutationOutcome, Scope } from "@/modules/data-service";
import { acceptImportRowsRequest, cancelImportRequest, proposeImportRequest, setRowDecisionRequest } from "../client";
import type { AcceptImportRowsPayload, CancelPayload } from "../schemas/acceptance";
import type { ImportFilePayload } from "../schemas/proposal";
import type { RowDecisionPayload } from "../schemas/row-decision";
// The two reads' own key factories, imported rather than restated: the entry a change invalidates is then the very entry the read answers under, and neither address can drift from the other.
import { importProposalKey } from "./use-import-proposal";
import { importReceiptKey } from "./use-import-receipt";

/**
 * One import change as its caller sees it: the way to submit it, the last answer the service gave, whether a request is open, and the way to clear that answer.
 *
 * This is a return shape and not a factory. Each hook below declares its own mutation with its own payload type, so nothing here dispatches by name, accepts a field map or stands in for a write path the import journey does not have.
 */
export interface ImportCommand<P> {
  /**
   * Submits the input exactly as it was given. The scope is the one the caller read, the expected revision is the one it saw and the operation identity is the one its journey minted, so a member it omits fails to compile instead of being defaulted — and a caller holding no envelope offers no action rather than one this hook invents.
   */
  readonly submit: (input: MutationInput<P>) => Promise<MutationOutcome>;
  /** The last outcome the service reported, and `undefined` before the first submission. */
  readonly outcome: MutationOutcome | undefined;
  /** Whether a request is in flight: from submission until the transport hands back an outcome. */
  readonly pending: boolean;
  /** Clears the recorded outcome so a surface can render a fresh one. It never touches the cache and never re-submits. */
  readonly reset: () => void;
}

/**
 * Whether an answer is terminal, which in this closed set means simply that it is not `unavailable`.
 *
 * A terminal answer is one the server gave — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid` or `unknown` — so the operation's stored record may now differ from what this browser holds. `unavailable` is the single member that is not: the source never answered, so no state was observed and a read of the same identity would only repeat the outage for the reader who is already being told the source is down.
 */
function isTerminalOutcome(outcome: MutationOutcome): boolean {
  return outcome.outcome !== "unavailable";
}

/**
 * Tells the cache what one answered command means: a terminal answer invalidates this operation's proposal and its receipt — the two reads the journey addresses by an attempt's own identity — and nothing else, because nothing else was named by the change.
 *
 * Two details are deliberate. The identity written into the keys is the caller's rather than the one the outcome echoes back, because the service echoes an identity within its own bound while the reads are addressed by the full value, so the caller's is the only one that addresses the same entry in both directions. And the cache is never cleared here: switching context is the fence in `components/context-switch-guard`, which owns that decision.
 */
async function settleImportCache(queryClient: QueryClient, scope: Scope, operationId: string, outcome: MutationOutcome): Promise<void> {
  if (!isTerminalOutcome(outcome)) {
    return;
  }
  await queryClient.invalidateQueries({ queryKey: importProposalKey(scope, operationId) });
  await queryClient.invalidateQueries({ queryKey: importReceiptKey(scope, operationId) });
}

/**
 * `proposeImport`: turns the file the worker chose into a reviewable proposal — the displayed limits measured before anything is processed, then the columns, the suggested mapping and the per-row validation — and answers with exactly one of the eight outcomes.
 */
export function useProposeImport(): ImportCommand<ImportFilePayload> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, Error, MutationInput<ImportFilePayload>>({
    mutationFn: proposeImportRequest<ImportFilePayload>,
    // A mutation is never retried here: the attempt's identity is what makes a second look safe, and the review step submits that same identity again when a person chooses to. The library does not retry mutations by default and no option below changes that.
    retry: false,
    onSuccess: (outcome, input) => settleImportCache(queryClient, input.scope, input.operationId, outcome),
  });
  return { submit: mutation.mutateAsync, outcome: mutation.data, pending: mutation.isPending, reset: mutation.reset };
}

/**
 * `setRowDecision`: records the decision taken about one row of the reviewed proposal, and answers with exactly one of the eight outcomes.
 *
 * Submissions are serialised on an in-order chain, because the review step records several rows in quick succession and one request at a time keeps every answer attributable to the row that produced it, in the order the worker reviewed them. A row the service refuses does not cancel the rows already queued behind it, and each caller still receives its own outcome rather than whichever one settled last.
 */
export function useSetRowDecision(): ImportCommand<RowDecisionPayload> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, Error, MutationInput<RowDecisionPayload>>({ mutationFn: setRowDecisionRequest<RowDecisionPayload>, retry: false, onSuccess: (outcome, input) => settleImportCache(queryClient, input.scope, input.operationId, outcome) });
  const { mutateAsync } = mutation;
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const submit = useCallback(
    (input: MutationInput<RowDecisionPayload>): Promise<MutationOutcome> => {
      const send = (): Promise<MutationOutcome> => mutateAsync(input);
      // Both arms start the next request: a submission fails the same way whether the one before it was answered or refused, so a refused row can neither stall the queue nor lose the rows behind it.
      const run = tail.current.then(send, send);
      tail.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [mutateAsync],
  );
  return { submit, outcome: mutation.data, pending: mutation.isPending, reset: mutation.reset };
}

/**
 * `acceptImportRows`: writes the contacts of the reviewed snapshot once the worker has acknowledged it, and answers with exactly one of the eight outcomes. An accepted row is a contact written, and it subscribes nobody, creates no membership and records no consent: those are the service's distinctions, carried through untouched because this hook passes the outcome on rather than reading it.
 */
export function useAcceptImportRows(): ImportCommand<AcceptImportRowsPayload> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, Error, MutationInput<AcceptImportRowsPayload>>({
    mutationFn: acceptImportRowsRequest<AcceptImportRowsPayload>,
    retry: false,
    // `unknown` is a terminal answer like any other: it says the attempt may have been applied, so the receipt the keys below address is exactly what resolves it — never a second acceptance under a fresh identity.
    onSuccess: (outcome, input) => settleImportCache(queryClient, input.scope, input.operationId, outcome),
  });
  return { submit: mutation.mutateAsync, outcome: mutation.data, pending: mutation.isPending, reset: mutation.reset };
}

/**
 * `cancelImport`: stops the rows of an import still in flight and leaves the accepted contacts in place, answering with exactly one of the eight outcomes. What stays accepted is the service's decision, taken against the revision this attempt saw; no rule about it is restated here, and the empty payload states no rows of its own.
 */
export function useCancelImport(): ImportCommand<CancelPayload> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, Error, MutationInput<CancelPayload>>({ mutationFn: cancelImportRequest<CancelPayload>, retry: false, onSuccess: (outcome, input) => settleImportCache(queryClient, input.scope, input.operationId, outcome) });
  return { submit: mutation.mutateAsync, outcome: mutation.data, pending: mutation.isPending, reset: mutation.reset };
}
