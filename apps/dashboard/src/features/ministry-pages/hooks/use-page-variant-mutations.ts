"use client";
/** The Worker and Project Pages family's two edition-lifecycle mutations: */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { MutationInput } from "@/modules/data-service/envelope";
/** The outcome module rather than the service barrel: this is a browser module, and a value import of the barrel reaches the synthetic store and its `node:fs` writes. */
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { createVariantInputSchema, saveDraftInputSchema, type CreateVariantPayload, type SaveDraftPayload } from "../schemas/release";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

const PAGES_HANDLER_PATH = "/api/pages";
const CREATE_VARIANT_OPERATION = "createVariant" as const;
const SAVE_DRAFT_OPERATION = "saveDraft" as const;

type RoutedCreateVariantPayload = CreateVariantPayload & { readonly operation: typeof CREATE_VARIANT_OPERATION };

type RoutedSaveDraftPayload = SaveDraftPayload & { readonly operation: typeof SAVE_DRAFT_OPERATION };

export type CreateVariantVariables = MutationInput<CreateVariantPayload>;

export type SaveDraftVariables = MutationInput<SaveDraftPayload> & { readonly documentId: string };

function reReadPages(queryClient: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

function needsReRead(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unknown";
}

/** `createVariant` — adds one language edition to a Page, answering exactly one of the eight outcomes: */
export function useCreatePageVariant(): UseMutationResult<MutationOutcome, never, CreateVariantVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGES_HANDLER_PATH });
  return useMutation<MutationOutcome, never, CreateVariantVariables>({
    mutationFn: async (variables) => {
      // The service re-validates and stays authoritative; this refusal only spares the worker a round
      // trip for a body the same schema already rejects.
      const checked = createVariantInputSchema.safeParse({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload });
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      const request: MutationInput<RoutedCreateVariantPayload> = { ...checked.data, payload: { ...checked.data.payload, operation: CREATE_VARIANT_OPERATION } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      if (!needsReRead(outcome)) {
        return;
      }
      // The prefix re-reads every Page read the scope keys — the admitted catalogues included; the page
      // key re-reads this Page's body, every edition it carries, its giving binding and the previews of it.
      reReadPages(queryClient, [pagesPrefix(variables.scope), pageKey(variables.scope, variables.payload.documentId)]);
    },
  });
}

/** `saveDraft` — saves one edition's working document, answering exactly one of the eight outcomes: */
export function useSavePageDraft(): UseMutationResult<MutationOutcome, never, SaveDraftVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGES_HANDLER_PATH });
  return useMutation<MutationOutcome, never, SaveDraftVariables>({
    mutationFn: async (variables) => {
      // The four-field body is built member by member: `documentId` rides on the variables for the
      // re-read below and must not reach the strict payload schema. `variantId` inside the payload is
      // what confines the save to one edition.
      const checked = saveDraftInputSchema.safeParse({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload });
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      const request: MutationInput<RoutedSaveDraftPayload> = { ...checked.data, payload: { ...checked.data.payload, operation: SAVE_DRAFT_OPERATION } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      if (!needsReRead(outcome)) {
        return;
      }
      // One edition's save re-reads that Page and nothing else: its body, the editions it carries, its
      // giving binding and the previews of it are all nested under this key.
      reReadPages(queryClient, [pageKey(variables.scope, variables.documentId)]);
    },
  });
}
