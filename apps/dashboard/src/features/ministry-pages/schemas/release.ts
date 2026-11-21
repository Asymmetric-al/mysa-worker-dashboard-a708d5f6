import { z } from "zod";
import { contentDocumentSchema, parseDocument, type ContentDocumentJson } from "@/modules/content/document";
import type { ContentLocale } from "@/modules/content/locale";
import type { ContentVariant } from "@/modules/content/variant";
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";
const pageAudience = "public" satisfies ContentVariant["audience"];
const pageAudienceSchema = z.literal(pageAudience, "A page edition is public, so this family has no other audience.");
const recordIdSchema = z.string({ error: "This action applies to one record, so reopen it from its list and try again." }).trim().min(1, "This action applies to one record, so reopen it from its list and try again.");
const localeTagSchema: z.ZodType<ContentLocale["tag"]> = z.string({ error: "Choose the language edition this change applies to." }).trim().min(1, "Choose the language edition this change applies to.");
function bodyIssuePath(documentPath: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const segment of documentPath.split(".")) {
    if (segment.length === 0) continue;
    segments.push(/^\d+$/.test(segment) ? Number(segment) : segment);
  }
  return segments;
}
const draftBodySchema: z.ZodType<ContentDocumentJson> = contentDocumentSchema.superRefine((document, ctx) => {
  const parsed = parseDocument(document);
  if (parsed.status === "valid") return;
  for (const issue of parsed.issues) {
    ctx.addIssue({ code: "custom", path: bodyIssuePath(issue.path), message: issue.message });
  }
});
export const createVariantPayloadSchema = z.strictObject({ documentId: recordIdSchema, locale: localeTagSchema, audience: pageAudienceSchema });
export type CreateVariantPayload = z.infer<typeof createVariantPayloadSchema>;
export const createVariantInputSchema = mutationInputSchema(createVariantPayloadSchema);
export type CreateVariantInput = MutationInput<CreateVariantPayload>;
export const saveDraftPayloadSchema = z.strictObject({ variantId: recordIdSchema, body: draftBodySchema });
export type SaveDraftPayload = z.infer<typeof saveDraftPayloadSchema>;
export const saveDraftInputSchema = mutationInputSchema(saveDraftPayloadSchema);
export type SaveDraftInput = MutationInput<SaveDraftPayload>;
export const submitForReviewPayloadSchema = z.strictObject({ variantId: recordIdSchema, revisionId: recordIdSchema });
export type SubmitForReviewPayload = z.infer<typeof submitForReviewPayloadSchema>;
export const submitForReviewInputSchema = mutationInputSchema(submitForReviewPayloadSchema);
export type SubmitForReviewInput = MutationInput<SubmitForReviewPayload>;
export const approveCandidatePayloadSchema = z.strictObject({ candidateId: recordIdSchema, notifyMode: z.literal("publish-only", "A Page release sends no notice, so an approval releases the edition without one.") });
export type ApproveCandidatePayload = z.infer<typeof approveCandidatePayloadSchema>;
export const approveCandidateInputSchema = mutationInputSchema(approveCandidatePayloadSchema);
export type ApproveCandidateInput = MutationInput<ApproveCandidatePayload>;
export const requestChangesPayloadSchema = z.strictObject({ candidateId: recordIdSchema, reason: z.string({ error: "Say what needs changing, as a note on this candidate." }).trim().min(1, "Say what needs changing so the author can act on it.") });
export type RequestChangesPayload = z.infer<typeof requestChangesPayloadSchema>;
export const requestChangesInputSchema = mutationInputSchema(requestChangesPayloadSchema);
export type RequestChangesInput = MutationInput<RequestChangesPayload>;
export const publishVariantsPayloadSchema = z.strictObject({ documentId: recordIdSchema, candidateIds: z.array(recordIdSchema).min(1, "Choose at least one language edition to release.") });
export type PublishVariantsPayload = z.infer<typeof publishVariantsPayloadSchema>;
export const publishVariantsInputSchema = mutationInputSchema(publishVariantsPayloadSchema);
export type PublishVariantsInput = MutationInput<PublishVariantsPayload>;
export const withdrawPagePayloadSchema = z.strictObject({ documentId: recordIdSchema });
export type WithdrawPagePayload = z.infer<typeof withdrawPagePayloadSchema>;
export const withdrawPageInputSchema = mutationInputSchema(withdrawPagePayloadSchema);
export type WithdrawPageInput = MutationInput<WithdrawPagePayload>;
export const withdrawLocalePayloadSchema = z.strictObject({ variantId: recordIdSchema });
export type WithdrawLocalePayload = z.infer<typeof withdrawLocalePayloadSchema>;
export const withdrawLocaleInputSchema = mutationInputSchema(withdrawLocalePayloadSchema);
export type WithdrawLocaleInput = MutationInput<WithdrawLocalePayload>;
