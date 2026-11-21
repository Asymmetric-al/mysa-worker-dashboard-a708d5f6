"use client";
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { ZodError, type ZodType } from "zod";
import type { MutationInput, MutationOutcome } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { registerMediaAssetInputSchema, removePlacementInputSchema, replacePlacementInputSchema, type RegisterMediaAssetPayload, type RemovePlacementPayload, type ReplacePlacementPayload } from "../schemas/media";
import { pageKey } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";
/** The one handler the three media mutations are posted to (AAP 0.6.3). */
const MEDIA_PATH = "/api/media";
export interface PageMediaVariables<P> extends MutationInput<P> {
  /** The Page whose draft this write edits. */
  readonly documentId: string;
}
export type PageMediaMutation<P> = UseMutationResult<MutationOutcome, never, PageMediaVariables<P>>;
type RegisterMediaAssetRequest = RegisterMediaAssetPayload & { readonly operation: "registerMediaAsset" };

type ReplacePlacementRequest = ReplacePlacementPayload & { readonly operation: "replacePlacement" };

type RemovePlacementRequest = RemovePlacementPayload & { readonly operation: "removePlacement" };
function envelopeOf<P>(variables: PageMediaVariables<P>): MutationInput<P> {
  return { operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload };
}
type CheckedBody<P> = { readonly ok: true; readonly input: MutationInput<P> } | { readonly ok: false; readonly outcome: MutationOutcome };
function payloadFieldPaths(error: ZodError): ZodError {
  return new ZodError(
    error.issues.map((issue) => {
      const [head, ...rest] = issue.path;
      return head === "payload" ? { ...issue, path: rest } : issue;
    }),
  );
}
function checkBody<P>(schema: ZodType<MutationInput<P>>, variables: PageMediaVariables<P>): CheckedBody<P> {
  const checked = schema.safeParse(envelopeOf(variables));
  if (!checked.success) {
    return { ok: false, outcome: invalid({ operationId: variables.operationId, fields: payloadFieldPaths(checked.error) }) };
  }
  return { ok: true, input: checked.data };
}
const RE_READ_OUTCOMES: Record<MutationOutcome["outcome"], boolean> = { accepted: true, alreadyAccepted: true, unknown: true, unchanged: false, conflict: false, invalid: false, denied: false, unavailable: false };
function reReadPage<P>(queryClient: QueryClient, outcome: MutationOutcome, variables: PageMediaVariables<P>): void {
  if (!RE_READ_OUTCOMES[outcome.outcome]) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: pageKey(variables.scope, variables.documentId) });
}
/** Registers one prepared image or video as a scoped asset for a Page draft, as `registerMediaAsset`. */
export function useRegisterPageMediaAsset(): PageMediaMutation<RegisterMediaAssetPayload> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: MEDIA_PATH });
  return useMutation<MutationOutcome, never, PageMediaVariables<RegisterMediaAssetPayload>>({
    mutationFn: async (variables) => {
      const body = checkBody(registerMediaAssetInputSchema, variables);
      if (!body.ok) {
        return body.outcome;
      }
      const request: MutationInput<RegisterMediaAssetRequest> = { ...body.input, payload: { operation: "registerMediaAsset", ...body.input.payload } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      reReadPage(queryClient, outcome, variables);
    },
    // An uncertain registration is recovered by re-querying the same operation id, never by sending the
    // same bytes again under a fresh one: a replay returns the original result.
    retry: false,
  });
}
/** Fills one existing placement of a Page draft with another prepared asset, or restates the description of the asset it already shows, as `replacePlacement`. */
export function useReplacePagePlacement(): PageMediaMutation<ReplacePlacementPayload> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: MEDIA_PATH });
  return useMutation<MutationOutcome, never, PageMediaVariables<ReplacePlacementPayload>>({
    mutationFn: async (variables) => {
      const body = checkBody(replacePlacementInputSchema, variables);
      if (!body.ok) {
        return body.outcome;
      }
      const request: MutationInput<ReplacePlacementRequest> = { ...body.input, payload: { operation: "replacePlacement", ...body.input.payload } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      reReadPage(queryClient, outcome, variables);
    },
    retry: false,
  });
}
/** Detaches one placement from a Page draft, as `removePlacement`; no asset is deleted and no release is withdrawn, because a removal is neither. */
export function useRemovePagePlacement(): PageMediaMutation<RemovePlacementPayload> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: MEDIA_PATH });
  return useMutation<MutationOutcome, never, PageMediaVariables<RemovePlacementPayload>>({
    mutationFn: async (variables) => {
      const body = checkBody(removePlacementInputSchema, variables);
      if (!body.ok) {
        return body.outcome;
      }
      const request: MutationInput<RemovePlacementRequest> = { ...body.input, payload: { operation: "removePlacement", ...body.input.payload } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      reReadPage(queryClient, outcome, variables);
    },
    retry: false,
  });
}
