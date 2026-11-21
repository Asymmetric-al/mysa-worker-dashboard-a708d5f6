"use client";
/**
 * The two withdrawals of the Worker and Project Pages family — `withdrawPage`, which contains every
 * released edition of one Page, and `withdrawLocale`, which contains exactly one language edition and
 * leaves its siblings released — as the transports the release controls call.
 *
 * One transport, one schema per mutation. Both hooks hand the four-field mutation input to
 * `usePageMutation`, which posts it to the documented handler path and answers exactly one of the eight
 * outcomes; the sibling request schema judges the body first, so a malformed attempt answers `invalid`
 * with per-field messages and makes no request. Neither hook mints an `operationId`: the attempt's
 * identity belongs to the caller, which is what lets a lost acknowledgement be recovered by repeating
 * the same identity instead of sending the work again under a fresh one.
 *
 * Why the posted body differs from the caller's variables in one respect. The handler on
 * `POST /api/pages/withdraw` serves both withdrawals and selects one by `payload.operation`; that
 * discriminant is the wire's business rather than the caller's, so it is added here. A Page's own
 * `documentId`, and an edition's `variantId`, travel beside the payload for the cache keys and for the
 * caller's clarity; the posted body carries the payload's own copy alone, because the envelope is
 * strict and a second copy would be refused before the service read anything.
 *
 * Who re-reads the cache. The transport re-reads the prefixes a hook configures when it was built, and
 * these keys depend on the call's own record, so each hook re-reads `pageKey` and `pagesPrefix` in the
 * step that settles the call instead.
 *
 * What a withdrawal is, and what it is not. It stops an edition being served from this application from
 * now on, and the reading route answers a tombstone in the same read that removed the edition. Nothing
 * here recalls a copy someone already received, saved or shared, deletes the source media or the draft,
 * or follows a withdrawal with a release, a reach change or a notice. Document-wide containment that
 * must also work beside an invalid draft belongs to the reach hook's own mutation, and is deliberately
 * not repeated here.
 */
import { useState } from "react";
import { useQueryClient, type MutateOptions, type MutationFunctionContext, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { MutationInput, MutationOutcome, Scope } from "@/modules/data-service";
/**
 * The outcome module rather than the service barrel, for the reason the transport states: this is a
 * browser module, so a value import of the barrel would pull every read, every mutation and the store
 * into the client bundle. `invalid` is imported from its owner rather than restated, so a changed
 * refusal shape reaches this file as a compile error instead of drifting.
 */
import { invalid } from "@/modules/data-service/outcome";
import { withdrawLocaleInputSchema, withdrawPageInputSchema, type WithdrawLocalePayload, type WithdrawPagePayload } from "../schemas/release";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

/** The one handler path both withdrawals post to. */
const WITHDRAW_PATH = "/api/pages/withdraw";

/** The handler's discriminant for `withdrawPage`. */
const WITHDRAW_PAGE_OPERATION = "withdrawPage";

/** The handler's discriminant for `withdrawLocale`. */
const WITHDRAW_LOCALE_OPERATION = "withdrawLocale";

/** The payload `withdrawPage` posts: the schema's own member plus the handler's discriminant. */
type WithdrawPagePacket = WithdrawPagePayload & { readonly operation: typeof WITHDRAW_PAGE_OPERATION };

/** The payload `withdrawLocale` posts: the schema's own member plus the handler's discriminant. */
type WithdrawLocalePacket = WithdrawLocalePayload & { readonly operation: typeof WITHDRAW_LOCALE_OPERATION };

/** What one `withdrawPage` call presents: the attempt and the scope and revision it was built on, the Page it contains, and the payload the family's schema declares. */
export interface WithdrawPageVariables extends MutationInput<WithdrawPagePayload> {
  /** The Page whose released editions stop being served. It rides beside the payload for the cache keys and for the caller's clarity; the payload's own copy is the one posted. */
  readonly documentId: string;
}

/** What one `withdrawLocale` call presents: the attempt and the scope and revision it was built on, the edition it contains, and the payload the family's schema declares. */
export interface WithdrawLocaleVariables extends MutationInput<WithdrawLocalePayload> {
  /** The Page the edition belongs to, named so the keys re-read afterwards cover the Page it was read from. */
  readonly documentId: string;
  /** The one language edition this withdrawal contains, named beside the payload for the caller's clarity; the payload's own copy is the one posted, and the Page's other editions keep their releases. */
  readonly variantId: string;
}

/**
 * The outcomes after which the withdrawn edition's keys must be re-read: the change is held, or its
 * fate is not known and the reads are then the only statement of what the service serves.
 */
function mustReRead(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unknown";
}

/**
 * Re-reads the two keys a withdrawal changes: the Page itself — every locale edition, its giving
 * binding and every preview of it — and the family's index, so the listed and link-public editions
 * settle in the same read that removed one.
 */
async function reReadWithdrawnPage(queryClient: QueryClient, scope: Scope, documentId: string): Promise<void> {
  await Promise.all([queryClient.invalidateQueries({ queryKey: pageKey(scope, documentId) }), queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) })]);
}

/**
 * Runs one withdrawal as the fire-and-forget `mutate` a caller may use, so the call's own callbacks
 * receive the caller's variables rather than the four-field body the transport posts. `data` and
 * `status` on the result track the transport's own attempts; a body refused before it left the browser
 * reaches the caller as this promise's outcome, or through these callbacks.
 */
function fireAndForget<V>(submit: (variables: V) => Promise<MutationOutcome>, context: MutationFunctionContext): (variables: V, options?: MutateOptions<MutationOutcome, never, V, unknown>) => void {
  return (variables, options) => {
    // `mutate` is fire-and-forget by contract: the outcome reaches the caller through the result's own
    // state and this call's callbacks, so the promise is discarded rather than returned.
    void (async () => {
      try {
        const outcome = await submit(variables);
        options?.onSuccess?.(outcome, variables, undefined, context);
        options?.onSettled?.(outcome, null, variables, undefined, context);
      } catch (cause) {
        // The transport answers every failure it can meet as an outcome, so a rejection here is a defect
        // in this file rather than the mutation's declared error — the declared error type is `never`.
        // It still reaches this call's own callbacks instead of vanishing.
        const error = cause as never;
        options?.onError?.(error, variables, undefined, context);
        options?.onSettled?.(undefined, error, variables, undefined, context);
      }
    })();
  };
}

/**
 * The transport's result, reported under this family's own variables.
 *
 * `usePageMutation` is typed per mutation state, so its `variables` is the four-field body it posted
 * and is present only once a call has run. These hooks name the caller's own object in that position,
 * which is the same value at runtime and `undefined` only before the first call, exactly as the
 * transport's is. Retyping that one member is all the assertion does; it changes nothing the browser
 * sees.
 */
function reportAs<Posted, V>(
  result: UseMutationResult<MutationOutcome, never, Posted>,
  variables: V | undefined,
  mutate: (variables: V, options?: MutateOptions<MutationOutcome, never, V, unknown>) => void,
  mutateAsync: (variables: V) => Promise<MutationOutcome>,
): UseMutationResult<MutationOutcome, never, V> {
  return { ...result, variables, mutate, mutateAsync } as UseMutationResult<MutationOutcome, never, V>;
}

/**
 * Withdraws every released edition of one Page (`withdrawPage`), answering `accepted`,
 * `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`.
 */
export function useWithdrawPage(): UseMutationResult<MutationOutcome, never, WithdrawPageVariables> {
  const queryClient = useQueryClient();
  const transport: UseMutationResult<MutationOutcome, never, MutationInput<WithdrawPagePacket>> = usePageMutation({ path: WITHDRAW_PATH });
  const [attempted, setAttempted] = useState<WithdrawPageVariables | undefined>(undefined);

  const submit = async (variables: WithdrawPageVariables): Promise<MutationOutcome> => {
    setAttempted(variables);
    const checked = withdrawPageInputSchema.safeParse({
      operationId: variables.operationId,
      scope: variables.scope,
      expectedRevision: variables.expectedRevision,
      payload: { documentId: variables.payload.documentId },
    });
    if (!checked.success) {
      return invalid({ operationId: variables.operationId, fields: checked.error });
    }
    const outcome = await transport.mutateAsync({
      ...checked.data,
      payload: { ...checked.data.payload, operation: WITHDRAW_PAGE_OPERATION },
    });
    if (mustReRead(outcome)) {
      await reReadWithdrawnPage(queryClient, variables.scope, variables.documentId);
    }
    return outcome;
  };

  return reportAs(transport, attempted, fireAndForget(submit, { client: queryClient, meta: undefined }), submit);
}

/**
 * Withdraws exactly one language edition of a Page (`withdrawLocale`) and leaves its siblings released,
 * answering `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`
 * or `unknown`.
 */
export function useWithdrawPageLocale(): UseMutationResult<MutationOutcome, never, WithdrawLocaleVariables> {
  const queryClient = useQueryClient();
  const transport: UseMutationResult<MutationOutcome, never, MutationInput<WithdrawLocalePacket>> = usePageMutation({ path: WITHDRAW_PATH });
  const [attempted, setAttempted] = useState<WithdrawLocaleVariables | undefined>(undefined);

  const submit = async (variables: WithdrawLocaleVariables): Promise<MutationOutcome> => {
    setAttempted(variables);
    const checked = withdrawLocaleInputSchema.safeParse({
      operationId: variables.operationId,
      scope: variables.scope,
      expectedRevision: variables.expectedRevision,
      payload: { variantId: variables.payload.variantId },
    });
    if (!checked.success) {
      return invalid({ operationId: variables.operationId, fields: checked.error });
    }
    const outcome = await transport.mutateAsync({
      ...checked.data,
      payload: { ...checked.data.payload, operation: WITHDRAW_LOCALE_OPERATION },
    });
    if (mustReRead(outcome)) {
      await reReadWithdrawnPage(queryClient, variables.scope, variables.documentId);
    }
    return outcome;
  };

  return reportAs(transport, attempted, fireAndForget(submit, { client: queryClient, meta: undefined }), submit);
}
