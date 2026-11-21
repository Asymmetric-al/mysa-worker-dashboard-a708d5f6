"use client";
/** The Page builder's six section mutations, as the writes the outline, the field form and the preset control send: */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { ZodType } from "zod";

import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";

import { addSectionInputSchema, duplicateSectionInputSchema, moveSectionInputSchema, removeSectionInputSchema, saveSectionFieldsInputSchema, type AddSectionPayload, type DuplicateSectionPayload, type MoveSectionPayload, type RemoveSectionPayload, type SaveSectionFieldsPayload } from "../schemas/section";
import { applyPresetInputSchema, type applyPresetPayload } from "../schemas/preset";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

/** The one handler the six section mutations post to. */
const SECTIONS_PATH = "/api/pages/sections";

/** What one section attempt presents: the mutation envelope's four members, plus the Page whose read is re-run once the attempt settles. */
export interface SectionMutationVariables<Payload> {
  readonly operationId: string;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly documentId: string;
  readonly payload: Payload;
}

/** One member's result: the family's mutation result over that member's variables. */
type SectionMutation<Payload> = UseMutationResult<MutationOutcome, never, SectionMutationVariables<Payload>>;

/** The family transport, narrowed to the one thing a member does with it: post a judged body. */
type SectionDispatch<Payload> = UseMutationResult<MutationOutcome, never, MutationInput<Payload>>;

/** Judges the four-member body against the mutation's own schema, then sends it only if it holds. */
async function submitSectionChange<Payload>(dispatch: SectionDispatch<Payload>, schema: ZodType<MutationInput<Payload>>, variables: SectionMutationVariables<Payload>): Promise<MutationOutcome> {
  const body: MutationInput<Payload> = { operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload };
  const checked = schema.safeParse(body);
  if (!checked.success) {
    return invalid({ operationId: variables.operationId, fields: checked.error });
  }
  // The schema's output, not the caller's input: a member the schema trims or narrows travels in the
  // form the schema accepted, so what the service judges is exactly what passed judgement here.
  return dispatch.mutateAsync(checked.data);
}

/** Whether a settled attempt could have changed what the Page read holds. */
function reReadsAfter(outcome: MutationOutcome): boolean {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unknown":
      return true;
    default:
      return false;
  }
}

/** Re-reads the one Page a settled attempt could have changed, and — for the preset, whose new draft becomes visible on the family index — that index too. */
async function reReadPage(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope, documentId: string, alsoIndex: boolean): Promise<void> {
  if (!reReadsAfter(outcome)) {
    return;
  }
  await queryClient.invalidateQueries({ queryKey: pageKey(scope, documentId) });
  if (alsoIndex) {
    await queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) });
  }
}

/** `addSection`: adds one section of an admitted catalogue type to the draft edition, after a named section or at the end. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useAddPageSection(): SectionMutation<AddSectionPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<AddSectionPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<AddSectionPayload>>({ mutationFn: (variables) => submitSectionChange(dispatch, addSectionInputSchema, variables), onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false) });
}

/** `moveSection`: moves one section to an explicit position, the single shape behind move up, move down and move to a position. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useMovePageSection(): SectionMutation<MoveSectionPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<MoveSectionPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<MoveSectionPayload>>({ mutationFn: (variables) => submitSectionChange(dispatch, moveSectionInputSchema, variables), onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false) });
}

/** `duplicateSection`: copies one section, its fields and its presentation, directly after itself in the draft edition. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useDuplicatePageSection(): SectionMutation<DuplicateSectionPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<DuplicateSectionPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<DuplicateSectionPayload>>({ mutationFn: (variables) => submitSectionChange(dispatch, duplicateSectionInputSchema, variables), onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false) });
}

/** `removeSection`: removes one section from the draft edition under review, leaving every released edition as it was released. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRemovePageSection(): SectionMutation<RemoveSectionPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<RemoveSectionPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<RemoveSectionPayload>>({ mutationFn: (variables) => submitSectionChange(dispatch, removeSectionInputSchema, variables), onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false) });
}

/** `saveSectionFields`: saves one section's fields, its bounded presentation choices, or both, in the draft edition. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveSectionFields(): SectionMutation<SaveSectionFieldsPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<SaveSectionFieldsPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<SaveSectionFieldsPayload>>({ mutationFn: (variables) => submitSectionChange(dispatch, saveSectionFieldsInputSchema, variables), onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false) });
}

/** `applyPreset`: composes one catalogue preset's sections into the draft edition, producing a reviewable draft and releasing nothing. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useApplyPagePreset(): SectionMutation<applyPresetPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<applyPresetPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<applyPresetPayload>>({ mutationFn: (variables) => submitSectionChange(dispatch, applyPresetInputSchema, variables), onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, true) });
}
