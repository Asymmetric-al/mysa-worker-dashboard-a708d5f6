"use client";
/** The proposal read of one contact-import operation, cached by that operation's own identity: the envelope, denial, refusal or outage the family transport answered with is handed on unchanged, so a return visit, a reload or a lost acknowledgement resumes the same file instead of reading it again. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
// Type-only: the service entry point also re-exports value helpers built on the framework's server-only response
// type, so a value import here would drag server code into the browser bundle.
import type { Scope } from "@/modules/data-service";
// The family's one transport: this hook builds no address of its own, so the path and the read behind it cannot
// drift from the write side of the same journey.
import { fetchImportProposal } from "../client";

/** The one job segment this file adds to a cache key: the read of a proposal by operation identity. */
const IMPORT_PROPOSAL_JOB = "import-proposal";

/** The key a read sits under before its caller has stated a scope to read in: it holds no scope segment, so it can never answer for a context, and the query keyed by it is disabled and never sent. */
const UNADDRESSED_PROPOSAL_KEY = [IMPORT_PROPOSAL_JOB] as const;

/** The identity a query carries before its caller has named an operation. The route reads a blank identity as no identity and refuses it rather than reading anything, and the query that would send it is disabled, so it is never asked of the service. */
const UNADDRESSED_OPERATION = "";

/** The cache key of one operation's proposal read: the scope segments every key in this application leads with, then this job, then the operation identity. */
export type ImportProposalQueryKey = readonly [...ScopeKey, typeof IMPORT_PROPOSAL_JOB, string];

/** The single definition of the proposal cache key, so the read and the invalidation a change performs cannot address different entries. */
export function importProposalKey(scope: Scope, operationId: string): ImportProposalQueryKey {
  return [...scopeKey(scope), IMPORT_PROPOSAL_JOB, operationId];
}

/** The whole answer a proposal read gives, taken from the transport so the payload cannot drift from it: the envelope, a denial, an unavailable source, or a refused request. */
export type ImportProposalReadResult = Awaited<ReturnType<typeof fetchImportProposal>>;

/** The envelope arm of that answer: what the operation holds — its reviewable proposal, or the receipt of an import that already completed — with the scope, source, revision, coverage and actions it was read under. */
export type ImportProposalEnvelope = Extract<ImportProposalReadResult, { readonly kind: "envelope" }>;

/**
 * Reports whether an answered envelope carries a receipt, which means the operation completed before this read
 * asked for its proposal (an acceptance landed first, for instance).
 *
 * The transport's own `completed` phase must agree, and the receipt view's own members must be present: the
 * operation it answers for, the instant it processed its rows, its per-row results, its per-state counts and its
 * cancellation flag. None of them is a status string, an HTTP code, a revision or a list length, and nothing is
 * re-validated or recomputed here — the receipt the service produced stays the receipt.
 */
function reportsCompletion(answered: ImportProposalEnvelope): boolean {
  const { phase, data } = answered.envelope.data;
  if (phase !== "completed") {
    return false;
  }
  return isRecord(data) && isNonEmptyString(data.importOperationId) && isNonEmptyString(data.processedAt) && Array.isArray(data.rows) && isRecord(data.counts) && typeof data.cancelled === "boolean";
}

/** What the proposal read is asked for: the context it is keyed by, the operation identity to read, and what to do when that identity already completed. */
export interface UseImportProposalParams {
  readonly scope: Scope | undefined;
  readonly operationId: string | undefined;
  /** Called once per operationId when the read reports the operation already completed. */
  readonly onAlreadyCompleted?: (operationId: string) => void;
}

/** What the proposal read hands back: the transport's answer untouched, the same answer narrowed to its envelope, whether a read is genuinely in flight, and the way a caller seeds the cache from an envelope it already holds. */
export interface UseImportProposalResult {
  readonly result: ImportProposalReadResult | undefined;
  readonly envelope: ImportProposalEnvelope | undefined;
  readonly pending: boolean;
  /** Seeds the cache from an envelope the caller already holds, so the next step renders without a fetch. */
  readonly seed: (envelope: ImportProposalEnvelope) => void;
}

/**
 * Reads one import operation's proposal by its identity, keyed by the scope segments and the identity so a
 * reload, a return visit or a recovery answers from the same entry.
 *
 * The read is by identity and never by repeating work: no retry, no poll and no refetch on window focus, because
 * recovery from an uncertain answer is another read of the same identity rather than a silent repeat. Staleness
 * keeps the library defaults, so a seeded entry renders at once with no loading state while a background re-read
 * of the same identity is deliberate and re-parses nothing — the service already holds this proposal for this
 * operation.
 */
export function useImportProposal({ scope, operationId, onAlreadyCompleted }: UseImportProposalParams): UseImportProposalResult {
  const queryClient = useQueryClient();
  const requestedOperationId = typeof operationId === "string" ? operationId : UNADDRESSED_OPERATION;
  const addressed = scope !== undefined && requestedOperationId.length > 0;
  const queryKey: ImportProposalQueryKey | typeof UNADDRESSED_PROPOSAL_KEY = scope === undefined ? UNADDRESSED_PROPOSAL_KEY : importProposalKey(scope, requestedOperationId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchImportProposal(requestedOperationId),
    // An identity is what a read is addressed by, so a read without one never runs and nothing is cached under
    // a context or an operation the caller has not stated.
    enabled: addressed,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const result: ImportProposalReadResult | undefined = query.data;
  // The envelope arm is the same value the transport answered with, narrowed for a caller that only renders what
  // the service authorised; the other arms are never reshaped into one.
  const envelope: ImportProposalEnvelope | undefined = result !== undefined && result.kind === "envelope" ? result : undefined;
  // A disabled read holds no answer and is not loading, so a spinner is never shown for a read that is not
  // happening; neither is one shown while an answer is already in hand.
  const pending = query.isPending && query.fetchStatus === "fetching";
  const seed = useCallback(
    (held: ImportProposalEnvelope): void => {
      if (scope === undefined || requestedOperationId.length === 0) {
        // The caller holds an envelope for an identity this hook was not given, so there is no entry it belongs
        // under and none is invented for it.
        return;
      }
      // The envelope arm is written exactly as the transport answers it, member for member: nothing is defaulted
      // or filled in, so a seeded entry states what the service produced and no more than it produced.
      queryClient.setQueryData<ImportProposalReadResult>(importProposalKey(scope, requestedOperationId), held);
    },
    [queryClient, scope, requestedOperationId],
  );
  const completedOperationId = envelope !== undefined && reportsCompletion(envelope) ? requestedOperationId : undefined;
  const reportedCompletion = useRef<string | null>(null);
  useEffect(() => {
    if (completedOperationId === undefined || onAlreadyCompleted === undefined) {
      return;
    }
    // One operation is reported upwards once, however many renders or callback identities pass: the container
    // moves the journey to its results once, and a re-render is not a second completion.
    if (reportedCompletion.current === completedOperationId) {
      return;
    }
    reportedCompletion.current = completedOperationId;
    onAlreadyCompleted(completedOperationId);
  }, [completedOperationId, onAlreadyCompleted]);
  return { result, envelope, pending, seed };
}
