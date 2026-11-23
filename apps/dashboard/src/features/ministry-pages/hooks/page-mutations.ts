"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, UseMutationResult, MutateOptions, MutationFunctionContext } from "@tanstack/react-query";
import { sendMutation } from "@/lib/read-transport";
import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { ZodError } from "zod";
import type { ZodType, input as SchemaInput } from "zod";
import { addSectionInputSchema, duplicateSectionInputSchema, moveSectionInputSchema, removeSectionInputSchema, saveSectionFieldsInputSchema } from "../schemas/section";
import type { AddSectionPayload, DuplicateSectionPayload, MoveSectionPayload, RemoveSectionPayload, SaveSectionFieldsPayload } from "../schemas/section";
import { applyPresetInputSchema } from "../schemas/preset";
import type { applyPresetPayload } from "../schemas/preset";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { createVariantInputSchema, approveCandidateInputSchema, publishVariantsInputSchema, requestChangesInputSchema, submitForReviewInputSchema, withdrawLocaleInputSchema, withdrawPageInputSchema } from "../schemas/release";
import type { CreateVariantPayload, ApproveCandidateInput, ApproveCandidatePayload, PublishVariantsInput, PublishVariantsPayload, RequestChangesInput, RequestChangesPayload, SubmitForReviewInput, SubmitForReviewPayload, WithdrawLocalePayload, WithdrawPagePayload } from "../schemas/release";
import { setReachInputSchema, stopShowingPubliclyFormSchema, stopShowingPubliclyInputSchema } from "../schemas/reach";
import type { SetReachPayload, StopShowingPubliclyPayload } from "../schemas/reach";
import { useState } from "react";
import { registerMediaAssetInputSchema, removePlacementInputSchema } from "../schemas/media";
import type { RegisterMediaAssetPayload, RemovePlacementPayload } from "../schemas/media";
export type PageMutationConfig = { path: string; invalidate?: readonly (readonly unknown[])[] };
function reReadPrefixes(queryClient: QueryClient, prefixes: PageMutationConfig["invalidate"]): void {
  for (const queryKey of prefixes ?? []) void queryClient.invalidateQueries({ queryKey });
}
/** Whether an outcome re-reads what the attempt acted on: `accepted` and `alreadyAccepted` changed the record and `unknown` may have, so each is read again; `unchanged` and every refusal are not. */
export const reReadsAfterOutcome = (outcome: MutationOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unknown";
/** The family's single mutation transport: posts the four-field input to a documented handler and returns one of eight outcomes; invalidates on accepted/alreadyAccepted, re-reads on unknown. */
export function usePageMutation<P>(config: PageMutationConfig): UseMutationResult<MutationOutcome, never, MutationInput<P>> {
  const queryClient = useQueryClient();
  const { path, invalidate } = config;
  return useMutation<MutationOutcome, never, MutationInput<P>>({
    mutationFn: (input) => sendMutation(path, input, "This device may have lost its connection, so the request is reported as neither applied nor refused. Retry it with the same operation id: a replay returns the original result instead of repeating the effect."),
    onSuccess: (outcome) => {
      if (reReadsAfterOutcome(outcome)) reReadPrefixes(queryClient, invalidate);
    },
  });
}
/** What one section attempt presents: the mutation envelope's four members, plus the Page whose read is re-run once the attempt settles. */
export type SectionMutationVariables<Payload> = { readonly operationId: string; readonly scope: Scope; readonly expectedRevision: string; readonly documentId: string; readonly payload: Payload };
type SectionMutation<Payload> = UseMutationResult<MutationOutcome, never, SectionMutationVariables<Payload>>;
type SectionDispatch<Payload> = UseMutationResult<MutationOutcome, never, MutationInput<Payload>>;
async function submitSectionChange<Payload>(dispatch: SectionDispatch<Payload>, schema: ZodType<MutationInput<Payload>>, variables: SectionMutationVariables<Payload>): Promise<MutationOutcome> {
  const body: MutationInput<Payload> = { operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload };
  const checked = schema.safeParse(body);
  return checked.success ? dispatch.mutateAsync(checked.data) : invalid({ operationId: variables.operationId, fields: checked.error });
}
async function reReadPage(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope, documentId: string, alsoIndex: boolean): Promise<void> {
  if (!reReadsAfterOutcome(outcome)) return;
  await queryClient.invalidateQueries({ queryKey: pageKey(scope, documentId) });
  if (alsoIndex) await queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) });
}
function useSectionChange<Payload>(schema: ZodType<MutationInput<Payload>>, alsoIndex: boolean): SectionMutation<Payload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<Payload> = usePageMutation({ path: "/api/pages/sections" });
  return useMutation<MutationOutcome, never, SectionMutationVariables<Payload>>({ mutationFn: (variables) => submitSectionChange(dispatch, schema, variables), onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, alsoIndex) });
}
/** `addSection`: adds one section of an admitted catalogue type to the draft edition, after a named section or at the end. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useAddPageSection = (): SectionMutation<AddSectionPayload> => useSectionChange<AddSectionPayload>(addSectionInputSchema, false);
/** `moveSection`: moves one section to an explicit position, the single shape behind move up, move down and move to a position. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useMovePageSection = (): SectionMutation<MoveSectionPayload> => useSectionChange<MoveSectionPayload>(moveSectionInputSchema, false);
/** `duplicateSection`: copies one section, its fields and its presentation, directly after itself in the draft edition. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useDuplicatePageSection = (): SectionMutation<DuplicateSectionPayload> => useSectionChange<DuplicateSectionPayload>(duplicateSectionInputSchema, false);
/** `removeSection`: removes one section from the draft edition under review, leaving every released edition as it was released. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useRemovePageSection = (): SectionMutation<RemoveSectionPayload> => useSectionChange<RemoveSectionPayload>(removeSectionInputSchema, false);
/** `saveSectionFields`: saves one section's fields, its bounded presentation choices, or both, in the draft edition. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useSaveSectionFields = (): SectionMutation<SaveSectionFieldsPayload> => useSectionChange<SaveSectionFieldsPayload>(saveSectionFieldsInputSchema, false);
/** `applyPreset`: composes one catalogue preset's sections into the draft edition, producing a reviewable draft and releasing nothing. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useApplyPagePreset = (): SectionMutation<applyPresetPayload> => useSectionChange<applyPresetPayload>(applyPresetInputSchema, true);
const PAGES_HANDLER_PATH = "/api/pages";
const CREATE_VARIANT_OPERATION = "createVariant" as const;
type RoutedCreateVariantPayload = CreateVariantPayload & { readonly operation: typeof CREATE_VARIANT_OPERATION };
function reReadAfterVariant(queryClient: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
}
const needsReRead = (outcome: MutationOutcome): boolean => reReadsAfterOutcome(outcome);
/** `createVariant` — adds one language edition to a Page, answering exactly one of the eight outcomes: */
export function useCreatePageVariant(): UseMutationResult<MutationOutcome, never, MutationInput<CreateVariantPayload>> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGES_HANDLER_PATH });
  return useMutation<MutationOutcome, never, MutationInput<CreateVariantPayload>>({
    mutationFn: async (variables) => {
      const checked = createVariantInputSchema.safeParse({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload });
      if (!checked.success) return invalid({ operationId: variables.operationId, fields: checked.error });
      const request: MutationInput<RoutedCreateVariantPayload> = { ...checked.data, payload: { ...checked.data.payload, operation: CREATE_VARIANT_OPERATION } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      if (!needsReRead(outcome)) return;
      reReadAfterVariant(queryClient, [pagesPrefix(variables.scope), pageKey(variables.scope, variables.payload.documentId)]);
    },
  });
}
type ReleaseStep = "submitForReview" | "approveCandidate" | "requestChanges" | "publishVariants";
type AssociatedPage = { readonly documentId?: string };
type SubmitPageForReviewVariables = SubmitForReviewInput;
type ApprovePageCandidateVariables = ApproveCandidateInput;
type RequestPageChangesVariables = RequestChangesInput & AssociatedPage;
type PublishPageVariantsVariables = PublishVariantsInput & AssociatedPage;
const documentedBody = (variables: MutationInput<unknown>): MutationInput<unknown> => ({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload });
function reReadPages(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope): void {
  if (reReadsAfterOutcome(outcome)) void queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) });
}
const PAGE_RELEASE_PATH = "/api/pages/release";
function useReleaseStep<Payload, Variables extends MutationInput<Payload>>(step: ReleaseStep, schema: ZodType<MutationInput<Payload>>): UseMutationResult<MutationOutcome, never, Variables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGE_RELEASE_PATH });
  return useMutation<MutationOutcome, never, Variables>({
    retry: false,
    mutationFn: async (variables: Variables): Promise<MutationOutcome> => {
      const checked = schema.safeParse(documentedBody(variables));
      if (!checked.success) return invalid({ operationId: variables.operationId, fields: checked.error });
      return transport.mutateAsync({ ...checked.data, payload: { ...checked.data.payload, operation: step } });
    },
    onSuccess: (outcome: MutationOutcome, variables: Variables): void => reReadPages(queryClient, outcome, variables.scope),
  });
}
/** Freezes one exact revision as the candidate under review (`submitForReview`). */
export const useSubmitPageForReview = (): UseMutationResult<MutationOutcome, never, SubmitPageForReviewVariables> => useReleaseStep<SubmitForReviewPayload, SubmitPageForReviewVariables>("submitForReview", submitForReviewInputSchema);
/** Answers one frozen candidate with an approval (`approveCandidate`). */
export const useApprovePageCandidate = (): UseMutationResult<MutationOutcome, never, ApprovePageCandidateVariables> => useReleaseStep<ApproveCandidatePayload, ApprovePageCandidateVariables>("approveCandidate", approveCandidateInputSchema);
/** Answers one frozen candidate with a request for a new revision (`requestChanges`). */
export const useRequestPageChanges = (): UseMutationResult<MutationOutcome, never, RequestPageChangesVariables> => useReleaseStep<RequestChangesPayload, RequestPageChangesVariables>("requestChanges", requestChangesInputSchema);
/** Releases the approved candidates selected for a page (`publishVariants`). */
export const usePublishPageVariants = (): UseMutationResult<MutationOutcome, never, PublishPageVariantsVariables> => useReleaseStep<PublishVariantsPayload, PublishPageVariantsVariables>("publishVariants", publishVariantsInputSchema);
const REACH_PATH = "/api/pages/reach";
type Routed<P> = P & { readonly operation: string };
export type SetReachVariables = MutationInput<SetReachPayload>;
export type StopShowingPayload = SchemaInput<typeof stopShowingPubliclyFormSchema>;
export type StopShowingVariables = MutationInput<StopShowingPayload>;
function reReadReach(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope, documentId: string): void {
  if (!reReadsAfterOutcome(outcome)) return;
  void queryClient.invalidateQueries({ queryKey: pageKey(scope, documentId) });
  void queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) });
}
/** `setReach`: gives every released edition of one page one of the three reach values, and answers with the outcome the service stated — `accepted`, `alreadyAccepted`, `unchanged`, `conflict` … */
export function useSetPageReach(): UseMutationResult<MutationOutcome, never, SetReachVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation<Routed<SetReachPayload>>({ path: REACH_PATH });
  return useMutation<MutationOutcome, never, SetReachVariables>({
    retry: false,
    mutationFn: async (variables: SetReachVariables): Promise<MutationOutcome> => {
      const checked = setReachInputSchema.safeParse(variables);
      if (!checked.success) return invalid({ operationId: variables.operationId, fields: checked.error });
      return transport.mutateAsync({ ...checked.data, payload: { operation: "setReach", ...checked.data.payload } });
    },
    onSuccess: (outcome: MutationOutcome, variables: SetReachVariables): void => reReadReach(queryClient, outcome, variables.scope, variables.payload.documentId),
  });
}
/** `useStopShowingPagePublicly` posts `stopShowingPublicly`: it contains every language edition of one page at one instant, and answers with the outcome the service stated. */
export function useStopShowingPagePublicly(): UseMutationResult<MutationOutcome, never, StopShowingVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation<Routed<StopShowingPubliclyPayload>>({ path: REACH_PATH });
  return useMutation<MutationOutcome, never, StopShowingVariables>({
    retry: false,
    mutationFn: async (variables: StopShowingVariables): Promise<MutationOutcome> => {
      const confirmed = stopShowingPubliclyFormSchema.safeParse(variables.payload);
      if (!confirmed.success) return invalid({ operationId: variables.operationId, fields: confirmed.error });
      const checked = stopShowingPubliclyInputSchema.safeParse({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: confirmed.data });
      if (!checked.success) return invalid({ operationId: variables.operationId, fields: checked.error });
      return transport.mutateAsync({ ...checked.data, payload: { operation: "stopShowingPublicly", ...checked.data.payload } });
    },
    onSuccess: (outcome: MutationOutcome, variables: StopShowingVariables): void => reReadReach(queryClient, outcome, variables.scope, variables.payload.documentId),
  });
}
const WITHDRAW_PATH = "/api/pages/withdraw";
const WITHDRAW_PAGE_OPERATION = "withdrawPage";
const WITHDRAW_LOCALE_OPERATION = "withdrawLocale";
type WithdrawPagePacket = WithdrawPagePayload & { readonly operation: typeof WITHDRAW_PAGE_OPERATION };
type WithdrawLocalePacket = WithdrawLocalePayload & { readonly operation: typeof WITHDRAW_LOCALE_OPERATION };
/** The Page whose released editions stop being served. It rides beside the payload for the cache keys and for the caller's clarity; the payload's own copy is the one posted. */
export type WithdrawPageVariables = MutationInput<WithdrawPagePayload> & { readonly documentId: string };
/** The Page the edition belongs to, named so the keys re-read afterwards cover the Page it was read from. · The one language edition this withdrawal contains, named beside the payload for the caller's clarity; the payload's own copy is the one posted, and the Page's other editions keep their releases. */
export type WithdrawLocaleVariables = MutationInput<WithdrawLocalePayload> & { readonly documentId: string; readonly variantId: string };
const mustReRead = (outcome: MutationOutcome): boolean => reReadsAfterOutcome(outcome);
const reReadWithdrawnPage = async (queryClient: QueryClient, scope: Scope, documentId: string): Promise<void> => void (await Promise.all([queryClient.invalidateQueries({ queryKey: pageKey(scope, documentId) }), queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) })]));
function fireAndForget<V>(submit: (variables: V) => Promise<MutationOutcome>, context: MutationFunctionContext): (variables: V, options?: MutateOptions<MutationOutcome, never, V, unknown>) => void {
  return (variables, options) => {
    void (async () => {
      try {
        const outcome = await submit(variables);
        options?.onSuccess?.(outcome, variables, undefined, context);
        options?.onSettled?.(outcome, null, variables, undefined, context);
      } catch (cause) {
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
    if (!checked.success) return invalid({ operationId: variables.operationId, fields: checked.error });
    const outcome = await transport.mutateAsync({ ...checked.data, payload: { ...checked.data.payload, operation: WITHDRAW_PAGE_OPERATION } });
    if (mustReRead(outcome)) await reReadWithdrawnPage(queryClient, variables.scope, variables.documentId);
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
    if (!checked.success) return invalid({ operationId: variables.operationId, fields: checked.error });
    const outcome = await transport.mutateAsync({ ...checked.data, payload: { ...checked.data.payload, operation: WITHDRAW_LOCALE_OPERATION } });
    if (mustReRead(outcome)) await reReadWithdrawnPage(queryClient, variables.scope, variables.documentId);
    return outcome;
  };
  return reportAs(transport, attempted, fireAndForget(submit, { client: queryClient, meta: undefined }), submit);
}
const MEDIA_PATH = "/api/media";
/** The Page whose draft this write edits. */
export type PageMediaVariables<P> = MutationInput<P> & { readonly documentId: string };
export type PageMediaMutation<P> = UseMutationResult<MutationOutcome, never, PageMediaVariables<P>>;
type RegisterMediaAssetRequest = RegisterMediaAssetPayload & { readonly operation: "registerMediaAsset" };
type RemovePlacementRequest = RemovePlacementPayload & { readonly operation: "removePlacement" };
const envelopeOf = <P>(variables: PageMediaVariables<P>): MutationInput<P> => ({ operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload });
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
  if (!checked.success) return { ok: false, outcome: invalid({ operationId: variables.operationId, fields: payloadFieldPaths(checked.error) }) };
  return { ok: true, input: checked.data };
}
function reReadMediaPage<P>(queryClient: QueryClient, outcome: MutationOutcome, variables: PageMediaVariables<P>): void {
  if (!reReadsAfterOutcome(outcome)) return;
  void queryClient.invalidateQueries({ queryKey: pageKey(variables.scope, variables.documentId) });
}
/** Registers one prepared image or video as a scoped asset for a Page draft, as `registerMediaAsset`. */
export function useRegisterPageMediaAsset(): PageMediaMutation<RegisterMediaAssetPayload> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: MEDIA_PATH });
  return useMutation<MutationOutcome, never, PageMediaVariables<RegisterMediaAssetPayload>>({
    mutationFn: async (variables) => {
      const body = checkBody(registerMediaAssetInputSchema, variables);
      if (!body.ok) return body.outcome;
      const request: MutationInput<RegisterMediaAssetRequest> = { ...body.input, payload: { operation: "registerMediaAsset", ...body.input.payload } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => reReadMediaPage(queryClient, outcome, variables),
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
      if (!body.ok) return body.outcome;
      const request: MutationInput<RemovePlacementRequest> = { ...body.input, payload: { operation: "removePlacement", ...body.input.payload } };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => reReadMediaPage(queryClient, outcome, variables),
    retry: false,
  });
}
