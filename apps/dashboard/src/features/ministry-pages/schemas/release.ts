/**
 * The Worker and Project Pages family's draft, review, release and withdrawal payload schemas: one
 * schema per named mutation for `createVariant`, `saveDraft`, `submitForReview`, `approveCandidate`,
 * `requestChanges`, `publishVariants`, `withdrawPage` and `withdrawLocale`, each with the four-field
 * mutation request the transport composes around it.
 */
import { z } from "zod";
import { contentDocumentSchema, parseDocument, type ContentDocumentJson } from "@/modules/content/document";
import type { ContentLocale } from "@/modules/content/locale";
import type { ContentVariant } from "@/modules/content/variant";
// The envelope module is imported directly rather than through the `@/modules/data-service` barrel:
// the barrel re-exports every read and mutation, whose graph reaches `node:fs` through the synthetic
// store, and this file is loaded by client components. It is the same `mutationInputSchema`.
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";
// Shared primitives: one identifier, one locale tag, one audience, one document body
const pageAudience = "public" satisfies ContentVariant["audience"];

const pageAudienceSchema = z.literal(pageAudience, "A page edition is public, so this family has no other audience.");

const recordIdSchema = z
  .string({ error: "This action applies to one record, so reopen it from its list and try again." })
  .trim()
  .min(1, "This action applies to one record, so reopen it from its list and try again.");
const localeTagSchema: z.ZodType<ContentLocale["tag"]> = z
  .string({ error: "Choose the language edition this change applies to." })
  .trim()
  .min(1, "Choose the language edition this change applies to.");
function bodyIssuePath(documentPath: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const segment of documentPath.split(".")) {
    if (segment.length === 0) {
      continue;
    }
    segments.push(/^\d+$/.test(segment) ? Number(segment) : segment);
  }
  return segments;
}
const draftBodySchema: z.ZodType<ContentDocumentJson> = contentDocumentSchema.superRefine((document, ctx) => {
  const parsed = parseDocument(document);
  if (parsed.status === "valid") {
    return;
  }
  for (const issue of parsed.issues) {
    ctx.addIssue({ code: "custom", path: bodyIssuePath(issue.path), message: issue.message });
  }
});
// createVariant
/** Feeds `createVariant`: the page this edition belongs to, the language it is written in, and the audience it serves. */
export const createVariantPayloadSchema = z.strictObject({
  documentId: recordIdSchema,
  locale: localeTagSchema,
  audience: pageAudienceSchema,
});
/** The payload `createVariant` accepts, inferred so the edition list and its hook hold one shape. */
export type CreateVariantPayload = z.infer<typeof createVariantPayloadSchema>;
/** The request `createVariant` receives: this payload inside the one mutation envelope. */
export const createVariantInputSchema = mutationInputSchema(createVariantPayloadSchema);
/** The request `createVariant` receives, typed from the envelope so it cannot be restated. */
export type CreateVariantInput = MutationInput<CreateVariantPayload>;
// saveDraft
/** Feeds `saveDraft`: the working document of one edition. */
export const saveDraftPayloadSchema = z.strictObject({
  variantId: recordIdSchema,
  body: draftBodySchema,
});
/** The payload `saveDraft` accepts, inferred so the builder and its hook hold one shape. */
export type SaveDraftPayload = z.infer<typeof saveDraftPayloadSchema>;
/** The request `saveDraft` receives: this payload inside the one mutation envelope. */
export const saveDraftInputSchema = mutationInputSchema(saveDraftPayloadSchema);
/** The request `saveDraft` receives, typed from the envelope so it cannot be restated. */
export type SaveDraftInput = MutationInput<SaveDraftPayload>;
// submitForReview
/** Feeds `submitForReview`: the exact revision an author submits, named by its identity. */
export const submitForReviewPayloadSchema = z.strictObject({
  variantId: recordIdSchema,
  revisionId: recordIdSchema,
});
/** The payload `submitForReview` accepts, inferred so the builder and its hook hold one shape. */
export type SubmitForReviewPayload = z.infer<typeof submitForReviewPayloadSchema>;
/** The request `submitForReview` receives: this payload inside the one mutation envelope. */
export const submitForReviewInputSchema = mutationInputSchema(submitForReviewPayloadSchema);
/** The request `submitForReview` receives, typed from the envelope so it cannot be restated. */
export type SubmitForReviewInput = MutationInput<SubmitForReviewPayload>;
// approveCandidate
/** Feeds `approveCandidate`: one frozen candidate and the release mode the approval keeps. */
export const approveCandidatePayloadSchema = z.strictObject({
  candidateId: recordIdSchema,
  notifyMode: z.literal("publish-only", "A Page release sends no notice, so an approval releases the edition without one."),
});
/** The payload `approveCandidate` accepts, inferred so the review panel and its hook hold one shape. */
export type ApproveCandidatePayload = z.infer<typeof approveCandidatePayloadSchema>;
/** The request `approveCandidate` receives: this payload inside the one mutation envelope. */
export const approveCandidateInputSchema = mutationInputSchema(approveCandidatePayloadSchema);
/** The request `approveCandidate` receives, typed from the envelope so it cannot be restated. */
export type ApproveCandidateInput = MutationInput<ApproveCandidatePayload>;
// requestChanges
/** Feeds `requestChanges`: one frozen candidate and the note asking its author for a new revision. */
export const requestChangesPayloadSchema = z.strictObject({
  candidateId: recordIdSchema,
  reason: z.string({ error: "Say what needs changing, as a note on this candidate." }).trim().min(1, "Say what needs changing so the author can act on it."),
});
/** The payload `requestChanges` accepts, inferred so the review panel and its hook hold one shape. */
export type RequestChangesPayload = z.infer<typeof requestChangesPayloadSchema>;
/** The request `requestChanges` receives: this payload inside the one mutation envelope. */
export const requestChangesInputSchema = mutationInputSchema(requestChangesPayloadSchema);
/** The request `requestChanges` receives, typed from the envelope so it cannot be restated. */
export type RequestChangesInput = MutationInput<RequestChangesPayload>;
// publishVariants
/** Feeds `publishVariants`: the page and the approved editions it releases. */
export const publishVariantsPayloadSchema = z.strictObject({
  documentId: recordIdSchema,
  candidateIds: z.array(recordIdSchema).min(1, "Choose at least one language edition to release."),
});
/** The payload `publishVariants` accepts, inferred so the review form and its hook hold one shape. */
export type PublishVariantsPayload = z.infer<typeof publishVariantsPayloadSchema>;
/** The request `publishVariants` receives: this payload inside the one mutation envelope. */
export const publishVariantsInputSchema = mutationInputSchema(publishVariantsPayloadSchema);
/** The request `publishVariants` receives, typed from the envelope so it cannot be restated. */
export type PublishVariantsInput = MutationInput<PublishVariantsPayload>;
// withdrawPage and withdrawLocale
/** Feeds `withdrawPage`: the page whose released editions stop being served. */
export const withdrawPagePayloadSchema = z.strictObject({
  documentId: recordIdSchema,
});
/** The payload `withdrawPage` accepts, inferred so the confirmation holds one shape. */
export type WithdrawPagePayload = z.infer<typeof withdrawPagePayloadSchema>;
/** The request `withdrawPage` receives: this payload inside the one mutation envelope. */
export const withdrawPageInputSchema = mutationInputSchema(withdrawPagePayloadSchema);
/** The request `withdrawPage` receives, typed from the envelope so it cannot be restated. */
export type WithdrawPageInput = MutationInput<WithdrawPagePayload>;
/** Feeds `withdrawLocale`: exactly one language edition, leaving its siblings released. */
export const withdrawLocalePayloadSchema = z.strictObject({
  variantId: recordIdSchema,
});
/** The payload `withdrawLocale` accepts, inferred so the confirmation holds one shape. */
export type WithdrawLocalePayload = z.infer<typeof withdrawLocalePayloadSchema>;
/** The request `withdrawLocale` receives: this payload inside the one mutation envelope. */
export const withdrawLocaleInputSchema = mutationInputSchema(withdrawLocalePayloadSchema);
/** The request `withdrawLocale` receives, typed from the envelope so it cannot be restated. */
export type WithdrawLocaleInput = MutationInput<WithdrawLocalePayload>;
