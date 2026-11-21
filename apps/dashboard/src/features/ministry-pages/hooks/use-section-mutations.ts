"use client";
/**
 * The Page builder's six section mutations, as the writes the outline, the field form and the preset
 * control send: `addSection`, `moveSection`, `duplicateSection`, `removeSection`, `saveSectionFields`
 * and `applyPreset`.
 *
 * **One transport.** Every member posts through `usePageMutation`, the family's only writer transport,
 * to the one handler `/api/pages/sections`. None of them posts anywhere else, and none builds a request
 * body of its own: the body is the four members below, and the payload inside it is the type the
 * sibling schema inferred.
 *
 * **Judged before it is sent.** Each member hands that four-member body to the mutation's own schema
 * first, so a body the service would refuse is answered as `invalid` with its per-field messages and no
 * request leaves the browser. That is also how a presentation choice the content profile does not admit
 * — a treatment, layout, alignment or image fit outside the bounded set — is refused rather than
 * restyled: the schema owns the admitted set, so nothing here coerces a value to a nearest option, and
 * a section type outside the family catalogue is refused by the same judgement.
 *
 * **`expectedRevision` is the revision token a read reported**, as the opaque string that read emitted.
 * The service compares it exactly, so a write built on a revision another change has replaced answers
 * `conflict` with the caller's input preserved instead of overwriting it.
 *
 * **`documentId` is not part of the change.** It names the Page whose read is re-run once an attempt
 * settles, and it stops here: the body is rebuilt from the four members the envelope has, so a document
 * identity can never reach a payload whose schema is strict. No member re-orders the outline in advance;
 * the outline re-reads the Page and so shows the order the service stored. Instant feedback for a
 * keyboard or single-pointer move is the outline's own transient selection, never an invented order, and
 * this is what keeps a move-by-one control and a move-to-position control from ever diverging.
 *
 * **`applyPreset` releases nothing.** A preset composes sections into the draft edition and publishes no
 * release, so this module sends no release and no reach with it and never follows it with one. It posts
 * to `/api/pages/sections` with the other five because the route inventory declares no separate preset
 * handler, which is a path decision only: the schema and the service keep `applyPreset` its own named
 * meaning, and its settled draft appears on the index as a draft.
 *
 * **Removal is draft-scoped.** `removeSection` changes the draft edition under review and no other
 * revision, so nothing here is paired with a withdrawal and nothing here says a released edition
 * changed. The sentences that tell a reader that live in `../copy`, which is where the builder's wording
 * belongs.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { ZodType } from "zod";

import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";

import {
  addSectionInputSchema,
  duplicateSectionInputSchema,
  moveSectionInputSchema,
  removeSectionInputSchema,
  saveSectionFieldsInputSchema,
  type AddSectionPayload,
  type DuplicateSectionPayload,
  type MoveSectionPayload,
  type RemoveSectionPayload,
  type SaveSectionFieldsPayload,
} from "../schemas/section";
import { applyPresetInputSchema, type applyPresetPayload } from "../schemas/preset";
import { pageKey, pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

/** The one handler the six section mutations post to. */
const SECTIONS_PATH = "/api/pages/sections";

/**
 * What one section attempt presents: the mutation envelope's four members, plus the Page whose read is
 * re-run once the attempt settles. The last member stays out of `payload`, whose schema is strict.
 */
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

/**
 * Judges the four-member body against the mutation's own schema, then sends it only if it holds.
 *
 * The body is rebuilt from the four members the envelope defines rather than forwarded from the
 * variables, which is what keeps the Page identity above out of the payload. A refusal answers as
 * `invalid` — the outcome the service itself returns for the same body — carrying the schema's messages
 * keyed by field path, and the transport is not called, so a refused body never reaches the handler.
 */
async function submitSectionChange<Payload>(dispatch: SectionDispatch<Payload>, schema: ZodType<MutationInput<Payload>>, variables: SectionMutationVariables<Payload>): Promise<MutationOutcome> {
  const body: MutationInput<Payload> = {
    operationId: variables.operationId,
    scope: variables.scope,
    expectedRevision: variables.expectedRevision,
    payload: variables.payload,
  };
  const checked = schema.safeParse(body);
  if (!checked.success) {
    return invalid({ operationId: variables.operationId, fields: checked.error });
  }
  // The schema's output, not the caller's input: a member the schema trims or narrows travels in the
  // form the schema accepted, so what the service judges is exactly what passed judgement here.
  return dispatch.mutateAsync(checked.data);
}

/**
 * Whether a settled attempt could have changed what the Page read holds.
 *
 * `accepted` and `alreadyAccepted` both describe a stored edition — a replay is one change seen twice,
 * not a second change — and `unknown` may have written without an acknowledgement, so all three are
 * re-read. The other five changed nothing: `conflict`, `invalid` and `denied` were refused before any
 * write, `unchanged` had nothing to write, and `unavailable` never reached the store.
 */
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

/**
 * Re-reads the one Page a settled attempt could have changed, and — for the preset, whose new draft
 * becomes visible on the family index — that index too.
 */
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
  return useMutation<MutationOutcome, never, SectionMutationVariables<AddSectionPayload>>({
    mutationFn: (variables) => submitSectionChange(dispatch, addSectionInputSchema, variables),
    onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false),
  });
}

/** `moveSection`: moves one section to an explicit position, the single shape behind move up, move down and move to a position. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useMovePageSection(): SectionMutation<MoveSectionPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<MoveSectionPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<MoveSectionPayload>>({
    mutationFn: (variables) => submitSectionChange(dispatch, moveSectionInputSchema, variables),
    onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false),
  });
}

/** `duplicateSection`: copies one section, its fields and its presentation, directly after itself in the draft edition. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useDuplicatePageSection(): SectionMutation<DuplicateSectionPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<DuplicateSectionPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<DuplicateSectionPayload>>({
    mutationFn: (variables) => submitSectionChange(dispatch, duplicateSectionInputSchema, variables),
    onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false),
  });
}

/** `removeSection`: removes one section from the draft edition under review, leaving every released edition as it was released. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRemovePageSection(): SectionMutation<RemoveSectionPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<RemoveSectionPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<RemoveSectionPayload>>({
    mutationFn: (variables) => submitSectionChange(dispatch, removeSectionInputSchema, variables),
    onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false),
  });
}

/** `saveSectionFields`: saves one section's fields, its bounded presentation choices, or both, in the draft edition. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveSectionFields(): SectionMutation<SaveSectionFieldsPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<SaveSectionFieldsPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<SaveSectionFieldsPayload>>({
    mutationFn: (variables) => submitSectionChange(dispatch, saveSectionFieldsInputSchema, variables),
    onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, false),
  });
}

/** `applyPreset`: composes one catalogue preset's sections into the draft edition, producing a reviewable draft and releasing nothing. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useApplyPagePreset(): SectionMutation<applyPresetPayload> {
  const queryClient = useQueryClient();
  const dispatch: SectionDispatch<applyPresetPayload> = usePageMutation({ path: SECTIONS_PATH });
  return useMutation<MutationOutcome, never, SectionMutationVariables<applyPresetPayload>>({
    mutationFn: (variables) => submitSectionChange(dispatch, applyPresetInputSchema, variables),
    onSuccess: (outcome, variables) => reReadPage(queryClient, outcome, variables.scope, variables.documentId, true),
  });
}
