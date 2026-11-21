"use client";
import { useState } from "react";
import { useQueryClient, type MutateOptions, type MutationFunctionContext, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { MutationInput, MutationOutcome, Scope } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { withdrawLocaleInputSchema, withdrawPageInputSchema, type WithdrawLocalePayload, type WithdrawPagePayload } from "../schemas/release";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

const WITHDRAW_PATH = "/api/pages/withdraw";
const WITHDRAW_PAGE_OPERATION = "withdrawPage";
const WITHDRAW_LOCALE_OPERATION = "withdrawLocale";

type WithdrawPagePacket = WithdrawPagePayload & { readonly operation: typeof WITHDRAW_PAGE_OPERATION };

type WithdrawLocalePacket = WithdrawLocalePayload & { readonly operation: typeof WITHDRAW_LOCALE_OPERATION };

export interface WithdrawPageVariables extends MutationInput<WithdrawPagePayload> {
  /** The Page whose released editions stop being served. It rides beside the payload for the cache keys and for the caller's clarity; the payload's own copy is the one posted. */
  readonly documentId: string;
}

export interface WithdrawLocaleVariables extends MutationInput<WithdrawLocalePayload> {
  /** The Page the edition belongs to, named so the keys re-read afterwards cover the Page it was read from. */
  readonly documentId: string;
  /** The one language edition this withdrawal contains, named beside the payload for the caller's clarity; the payload's own copy is the one posted, and the Page's other editions keep their releases. */
  readonly variantId: string;
}

function mustReRead(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unknown";
}

async function reReadWithdrawnPage(queryClient: QueryClient, scope: Scope, documentId: string): Promise<void> {
  await Promise.all([queryClient.invalidateQueries({ queryKey: pageKey(scope, documentId) }), queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) })]);
}

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

function reportAs<Posted, V>(result: UseMutationResult<MutationOutcome, never, Posted>, variables: V | undefined, mutate: (variables: V, options?: MutateOptions<MutationOutcome, never, V, unknown>) => void, mutateAsync: (variables: V) => Promise<MutationOutcome>): UseMutationResult<MutationOutcome, never, V> {
  return { ...result, variables, mutate, mutateAsync } as UseMutationResult<MutationOutcome, never, V>;
}

/** Withdraws every released edition of one Page (`withdrawPage`), answering `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useWithdrawPage(): UseMutationResult<MutationOutcome, never, WithdrawPageVariables> {
  const queryClient = useQueryClient();
  const transport: UseMutationResult<MutationOutcome, never, MutationInput<WithdrawPagePacket>> = usePageMutation({ path: WITHDRAW_PATH });
  const [attempted, setAttempted] = useState<WithdrawPageVariables | undefined>(undefined);

  const submit = async (variables: WithdrawPageVariables): Promise<MutationOutcome> => {
    setAttempted(variables);
    const checked = withdrawPageInputSchema.safeParse({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: { documentId: variables.payload.documentId } });
    if (!checked.success) {
      return invalid({ operationId: variables.operationId, fields: checked.error });
    }
    const outcome = await transport.mutateAsync({ ...checked.data, payload: { ...checked.data.payload, operation: WITHDRAW_PAGE_OPERATION } });
    if (mustReRead(outcome)) {
      await reReadWithdrawnPage(queryClient, variables.scope, variables.documentId);
    }
    return outcome;
  };

  return reportAs(transport, attempted, fireAndForget(submit, { client: queryClient, meta: undefined }), submit);
}

/** Withdraws exactly one language edition of a Page (`withdrawLocale`) and leaves its siblings released, answering `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid` … */
export function useWithdrawPageLocale(): UseMutationResult<MutationOutcome, never, WithdrawLocaleVariables> {
  const queryClient = useQueryClient();
  const transport: UseMutationResult<MutationOutcome, never, MutationInput<WithdrawLocalePacket>> = usePageMutation({ path: WITHDRAW_PATH });
  const [attempted, setAttempted] = useState<WithdrawLocaleVariables | undefined>(undefined);

  const submit = async (variables: WithdrawLocaleVariables): Promise<MutationOutcome> => {
    setAttempted(variables);
    const checked = withdrawLocaleInputSchema.safeParse({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: { variantId: variables.payload.variantId } });
    if (!checked.success) {
      return invalid({ operationId: variables.operationId, fields: checked.error });
    }
    const outcome = await transport.mutateAsync({ ...checked.data, payload: { ...checked.data.payload, operation: WITHDRAW_LOCALE_OPERATION } });
    if (mustReRead(outcome)) {
      await reReadWithdrawnPage(queryClient, variables.scope, variables.documentId);
    }
    return outcome;
  };

  return reportAs(transport, attempted, fireAndForget(submit, { client: queryClient, meta: undefined }), submit);
}
