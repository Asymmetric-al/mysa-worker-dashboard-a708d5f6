"use client";
/**
 * The Worker and Project Pages family's two edition-lifecycle mutations: `createVariant` adds one
 * language edition to a Page, and `saveDraft` saves one edition's working document. Each is exposed as
 * the mutation result the edition list and the page builder hold, and each keeps its write inside the
 * one edition and one locale it names, so saving an English draft never advances a French release.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { MutationInput } from "@/modules/data-service/envelope";
/**
 * The outcome module rather than the service barrel: this is a browser module, and a value import of
 * the barrel reaches the synthetic store and its `node:fs` writes. The one constructor a client answers
 * a refusal with is taken from its owner, so a changed refusal shape reaches this file as a compile
 * error instead of drifting from the service.
 */
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { createVariantInputSchema, saveDraftInputSchema, type CreateVariantPayload, type SaveDraftPayload } from "../schemas/release";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

/** The one handler both edition writes post to; it selects the named mutation by `payload.operation`. */
const PAGES_HANDLER_PATH = "/api/pages";

/**
 * The routing discriminant the handler dispatches on and removes before the service validates the
 * payload. Neither sibling schema carries it, because it names the mutation rather than any field of an
 * edition; the per-mutation hook is the only layer that knows which mutation it is, so it adds its own
 * literal here, after the four-field body has been validated.
 */
const CREATE_VARIANT_OPERATION = "createVariant" as const;
const SAVE_DRAFT_OPERATION = "saveDraft" as const;

/** What one `createVariant` request posts: the edition fields the sibling schema admits, plus the operation the handler routes on. */
type RoutedCreateVariantPayload = CreateVariantPayload & { readonly operation: typeof CREATE_VARIANT_OPERATION };

/** What one `saveDraft` request posts: the working document the sibling schema admits, plus the operation the handler routes on. */
type RoutedSaveDraftPayload = SaveDraftPayload & { readonly operation: typeof SAVE_DRAFT_OPERATION };

/** Everything one attempt to add a language edition presents: the four-field mutation input unchanged — one Page, one content locale, one permitted audience. */
export type CreateVariantVariables = MutationInput<CreateVariantPayload>;

/**
 * Everything one draft save presents: the four-field mutation input plus the Page the save belongs to.
 * `documentId` is carried for the cache re-read alone and is never part of the payload, so it cannot
 * reach the service, where the strict payload schema would refuse a member no edition field names.
 */
export type SaveDraftVariables = MutationInput<SaveDraftPayload> & { readonly documentId: string };

/**
 * Re-reads the Pages a settled write may have changed. The family transport's configured prefixes are
 * static, while these keys carry the scope and the Page each attempt names, so the keys are built from
 * the submitted variables here instead — never from an envelope that a restriction may have moved.
 */
function reReadPages(queryClient: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Whether a settled outcome leaves work the cache must re-read: exactly the three whose effect may now
 * stand. `conflict`, `unchanged`, `invalid`, `denied` and `unavailable` changed nothing, so re-reading
 * on them would only replace the worker's unsaved text with a version they did not ask for. An outcome
 * this list does not name is treated the same way — the cache is left alone until something is known to
 * have changed.
 */
function needsReRead(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unknown";
}

/**
 * `createVariant` — adds one language edition to a Page, answering exactly one of the eight outcomes:
 * `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`.
 *
 * The mutation wraps the family transport so a malformed attempt settles as the `invalid` outcome with
 * the per-field paths the service would have used, without a request leaving the browser; every other
 * attempt, and every answer the service gives, is returned untouched.
 */
export function useCreatePageVariant(): UseMutationResult<MutationOutcome, never, CreateVariantVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGES_HANDLER_PATH });
  return useMutation<MutationOutcome, never, CreateVariantVariables>({
    mutationFn: async (variables) => {
      // The service re-validates and stays authoritative; this refusal only spares the worker a round
      // trip for a body the same schema already rejects.
      const checked = createVariantInputSchema.safeParse({
        operationId: variables.operationId,
        scope: variables.scope,
        expectedRevision: variables.expectedRevision,
        payload: variables.payload,
      });
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      const request: MutationInput<RoutedCreateVariantPayload> = {
        ...checked.data,
        payload: { ...checked.data.payload, operation: CREATE_VARIANT_OPERATION },
      };
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

/**
 * `saveDraft` — saves one edition's working document, answering exactly one of the eight outcomes:
 * `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`.
 *
 * The save always carries the revision the caller read, so a write built on a version another change
 * has replaced answers `conflict`: that outcome is returned as it stands, and the caller keeps the
 * readable local text to compare with the current value. No draft save names a candidate or a release,
 * and none is presented as one.
 */
export function useSavePageDraft(): UseMutationResult<MutationOutcome, never, SaveDraftVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGES_HANDLER_PATH });
  return useMutation<MutationOutcome, never, SaveDraftVariables>({
    mutationFn: async (variables) => {
      // The four-field body is built member by member: `documentId` rides on the variables for the
      // re-read below and must not reach the strict payload schema. `variantId` inside the payload is
      // what confines the save to one edition.
      const checked = saveDraftInputSchema.safeParse({
        operationId: variables.operationId,
        scope: variables.scope,
        expectedRevision: variables.expectedRevision,
        payload: variables.payload,
      });
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      const request: MutationInput<RoutedSaveDraftPayload> = {
        ...checked.data,
        payload: { ...checked.data.payload, operation: SAVE_DRAFT_OPERATION },
      };
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
