"use client";
/** The contact-import receipt's recovery read: the receipt of one import operation, read by the identity of the attempt that produced it, so a lost acknowledgement is answered by asking what that operation recorded rather than by sending anything again. */
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { scopeKey } from "@/components/context-switch-guard";
// Type-only, like every data-service import in this layer: these are the contract's own names, taken
// without loading the modules that produce them (the service index reaches the synthetic store, its
// outcome module reaches a server-only response type), and neither belongs in a browser bundle.
import type { Scope } from "@/modules/data-service";
import { fetchImportReceipt } from "../client";
// ---------------------------------------------------------------------------------------------
// The read's own contract, derived from the transport rather than restated
// ---------------------------------------------------------------------------------------------
/** What a receipt read answers: the envelope the service built for this operation, or the denial, refusal or outage it answered with instead — `fetchImportReceipt`'s own union, so this hook cannot drift from the transport. */
export type ImportReceiptReadResult = Awaited<ReturnType<typeof fetchImportReceipt>>;
/**
 * The envelope arm alone: the scoped record of what one import operation processed — its per-row results and
 * counts, its coverage, the instant it was evaluated — together with the actions it still offers.
 *
 * The name is `ImportReceiptReadEnvelope` rather than `ImportReceiptEnvelope` because this feature's transport
 * (`../client`) already gives that second name to the payload inside this envelope: the receipt itself, wrapped
 * with the phase that answered. One feature holds one name per type, so the arm and its payload stay tellable
 * apart.
 */
export type ImportReceiptReadEnvelope = Extract<ImportReceiptReadResult, { readonly kind: "envelope" }>["envelope"];
// ---------------------------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------------------------
/** The one job name this read is cached under. */
const IMPORT_RECEIPT_JOB = "import-receipt";
/**
 * The key an unidentifiable recovery read sits under: no scope exists yet, so no receipt is cached, fetched or
 * served beneath it. It is an idle placeholder and never a second way of naming a receipt — {@link importReceiptKey}
 * remains the only definition of that key.
 */
const UNIDENTIFIED_RECEIPT_KEY: readonly unknown[] = [IMPORT_RECEIPT_JOB, "unidentified"];
/** The single definition of the receipt cache key: the scope segments first, so the context switch's fence clears this entry with the rest of the previous context, then the job and the operation the receipt belongs to. */
export const importReceiptKey = (scope: Scope, operationId: string): readonly unknown[] => [...scopeKey(scope), IMPORT_RECEIPT_JOB, operationId];
// ---------------------------------------------------------------------------------------------
// What the hook is given, and what it hands back
// ---------------------------------------------------------------------------------------------
/** What {@link useImportReceipt} is given: the context to read in, the attempt identity to ask about, and whether the results step is in its recovery state at all. */
export interface UseImportReceiptParams {
  readonly scope: Scope | undefined;
  readonly operationId: string | undefined;
  /** The results step's recovery state: false while there is nothing to recover. */
  readonly enabled?: boolean;
}
/** What {@link useImportReceipt} answers: the read's own arms untouched, the envelope arm narrowed out of them, its query state, and the recovery the `unknown` outcome's "check the result" action calls. */
export interface UseImportReceiptResult {
  /** The read exactly as the transport produced it, including the denial, refusal, outage and unconfirmed arms. */
  readonly result: ImportReceiptReadResult | undefined;
  /** The same value, narrowed: present only when the service answered with an envelope. */
  readonly envelope: ImportReceiptReadEnvelope | undefined;
  /** Whether no answer has arrived yet. A read with no identity stays pending for as long as it has none, because nothing will be asked. */
  readonly pending: boolean;
  /** Whether a request for this receipt is open right now, including a recovery the caller asked for. */
  readonly fetching: boolean;
  /** The user-initiated recovery: re-ask by the same operationId. */
  readonly refetch: () => Promise<ImportReceiptReadResult | undefined>;
}
// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------
/**
 * Reads the recoverable receipt of one import operation through this family's transport, keyed by the scope and the
 * attempt identity it is asked about. This is the recovery read and only that: it mints no attempt identity, sends
 * no payload, accepts no rows and uploads nothing, so nothing here can repeat an effect whose acknowledgement was
 * lost. It answers the read union unchanged — an unknown operation identity and a same-identity-changed-intent
 * request are the service's own arms, and restating either rule here would be a second copy of the domain.
 *
 * Nothing observes the clock either: the query is never retried, never polled and never refetched by a window or
 * connection event. It is read once when the results step mounts, and again only when a person asks through
 * `refetch`, which keeps recovery deterministic and reproducible from a reset seed.
 */
export function useImportReceipt({ scope, operationId, enabled = true }: UseImportReceiptParams): UseImportReceiptResult {
  // An identity is what makes the read askable: without a context and an operation there is no receipt to name, so
  // no request is sent and no entry is cached. The identity is opaque, so it is counted and carried but never
  // trimmed, parsed or compared — the service decides what an identity may read.
  const identity = scope !== undefined && operationId !== undefined && operationId.length > 0 ? { scope, operationId } : undefined;
  const isEnabled = identity !== undefined && enabled;
  const {
    data,
    isPending,
    isFetching,
    refetch: refetchQuery,
  } = useQuery<ImportReceiptReadResult, Error>({
    queryKey: identity === undefined ? UNIDENTIFIED_RECEIPT_KEY : importReceiptKey(identity.scope, identity.operationId),
    // The identity is the only input this read has, and it is the only thing sent. A read has no effect to repeat,
    // so the same identity may be asked again without risk; a transport that could not reach its source answers
    // `unavailable` itself rather than being retried into repeated loads of the same outage.
    queryFn: () => {
      if (identity === undefined) {
        // Unreachable: the query is disabled without an identity. It is stated rather than papered over, because
        // asking the service about a blank identity would be a request for a record that does not exist.
        return Promise.reject(new Error("An import receipt read needs a scope and an operation identity."));
      }
      return fetchImportReceipt(identity.operationId);
    },
    enabled: isEnabled,
    retry: false,
    // Written out rather than left to a default, so no future option can quietly turn this into a poll: recovery
    // happens when the results step mounts and when a person asks for it, and at no other moment.
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const refetch = useCallback(async (): Promise<ImportReceiptReadResult | undefined> => {
    if (!isEnabled) {
      return undefined;
    }
    try {
      // `throwOnError: false` keeps a failed recovery inside the read's own union; the guard below covers anything
      // that escapes it, because a caller rendering the receipt is owed an arm, never an exception.
      const answer = await refetchQuery({ throwOnError: false });
      return answer.data;
    } catch {
      return undefined;
    }
  }, [isEnabled, refetchQuery]);
  return {
    // Handed on exactly as the transport produced it: no arm is transformed, re-shaped, re-validated, counted or
    // summarised here, and an `unknown` result never becomes a claim that the operation succeeded or failed.
    result: data,
    envelope: data !== undefined && data.kind === "envelope" ? data.envelope : undefined,
    pending: isPending,
    fetching: isFetching,
    refetch,
  };
}
