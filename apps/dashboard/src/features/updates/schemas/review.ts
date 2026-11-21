import { z } from "zod";
import { REVIEW_ROUND_NOTE } from "../copy/updates-copy";
// No review payload names a content locale — the service's record supplies it — so that shape stays out.
import { contentIdSchema } from "./draft";
export const REVIEW_REASON_MAX_CHARS = 2000;
export const approveCandidateSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  contentChecksum: z
    .string({ error: "Approval names the checksum of the revision you read, so approve the candidate from its " + "review panel rather than here." })
    .trim()
    .min(1, "Approve the candidate from its review panel, which carries the checksum of the revision you " + "read. " + REVIEW_ROUND_NOTE.approvalIsPerVariant)
    .max(64, "That checksum is longer than any this application produces, so approve the candidate from " + "its review panel rather than pasting one."),
});
export const requestChangesSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  reason: z
    .string({ error: "Say what needs changing, as a note on this candidate rather than a message to anyone." })
    .trim()
    .min(1, "Say what needs changing so the author can act on it. " + REVIEW_ROUND_NOTE.furtherRoundIsNewSubmission)
    .max(REVIEW_REASON_MAX_CHARS, `Keep the note to ${REVIEW_REASON_MAX_CHARS} characters, which is all this review record ` + "holds, so point at what needs changing and leave the rewriting to the author."),
});
export const rejectCandidateSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  reason: z
    .string({ error: "State the reason as a note on this candidate, or leave the reason out entirely." })
    .trim()
    .min(1, "Either leave the reason out or say what ended this candidate: an empty note states nothing.")
    .max(REVIEW_REASON_MAX_CHARS, `Keep the note to ${REVIEW_REASON_MAX_CHARS} characters, which is all this review record ` + "holds, so say what ended the candidate and leave the rest to its author.")
    .optional(),
});
export const restoreRevisionAsDraftSchema = z.strictObject({ revisionId: contentIdSchema });
export type ApproveCandidatePayload = z.infer<typeof approveCandidateSchema>;
export type RequestChangesPayload = z.infer<typeof requestChangesSchema>;
export type RejectCandidatePayload = z.infer<typeof rejectCandidateSchema>;
export type RestoreRevisionAsDraftPayload = z.infer<typeof restoreRevisionAsDraftSchema>;
