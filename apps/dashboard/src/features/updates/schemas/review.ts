/**
 * The Ministry Updates family's review-side payload schemas — `approveCandidate`, `requestChanges`,
 * `rejectCandidate` and `restoreRevisionAsDraft` — the four named mutations the one shared review
 * panel drives (`components/review-panel.tsx`, reached from `communication/review/[candidateId]`),
 * over `POST /api/review`.
 */
import { z } from "zod";
import { REVIEW_ROUND_NOTE } from "../copy/updates-copy";
// The family's one identifier shape, imported from the sibling draft schemas rather than restated. No
// review payload names a content locale — a variant's locale comes from the record the service
// returns — so the sibling locale shape is deliberately left out of this file's imports.
import { contentIdSchema } from "./draft";
// The reviewer's note: one bound, declared once
/** The longest note a reviewer may leave on a candidate. */
export const REVIEW_REASON_MAX_CHARS = 2000;
// The four review payloads
/** Feeds `approveCandidate`: the frozen candidate the reviewer read, named by the exact revision and content checksum the review envelope carried. */
export const approveCandidateSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  contentChecksum: z
    .string({
      error: "Approval names the checksum of the revision you read, so approve the candidate from its " + "review panel rather than here.",
    })
    .trim()
    .min(1, "Approve the candidate from its review panel, which carries the checksum of the revision you " + "read. " + REVIEW_ROUND_NOTE.approvalIsPerVariant)
    .max(64, "That checksum is longer than any this application produces, so approve the candidate from " + "its review panel rather than pasting one."),
});
/** Feeds `requestChanges`: the reviewer's note asking the author for a new revision of one candidate. */
export const requestChangesSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  reason: z
    .string({
      error: "Say what needs changing, as a note on this candidate rather than a message to anyone.",
    })
    .trim()
    .min(1, "Say what needs changing so the author can act on it. " + REVIEW_ROUND_NOTE.furtherRoundIsNewSubmission)
    .max(
      REVIEW_REASON_MAX_CHARS,
      `Keep the note to ${REVIEW_REASON_MAX_CHARS} characters, which is all this review record ` + "holds, so point at what needs changing and leave the rewriting to the author.",
    ),
});
/** Feeds `rejectCandidate`: the reviewer declining one frozen candidate, with a note that is optional. */
export const rejectCandidateSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  reason: z
    .string({
      error: "State the reason as a note on this candidate, or leave the reason out entirely.",
    })
    .trim()
    .min(1, "Either leave the reason out or say what ended this candidate: an empty note states nothing.")
    .max(
      REVIEW_REASON_MAX_CHARS,
      `Keep the note to ${REVIEW_REASON_MAX_CHARS} characters, which is all this review record ` + "holds, so say what ended the candidate and leave the rest to its author.",
    )
    .optional(),
});
/** Feeds `restoreRevisionAsDraft`: the one revision to copy into a draft, and nothing else. */
export const restoreRevisionAsDraftSchema = z.strictObject({
  revisionId: contentIdSchema,
});
// Payload types: inferred from the schemas, never written beside them
/** The payload `approveCandidate` accepts, inferred so the review panel and its hook hold one shape. */
export type ApproveCandidatePayload = z.infer<typeof approveCandidateSchema>;
/** The payload `requestChanges` accepts, inferred so the note a reviewer writes has one bound. */
export type RequestChangesPayload = z.infer<typeof requestChangesSchema>;
/** The payload `rejectCandidate` accepts, inferred so an optional note is one shape, not two. */
export type RejectCandidatePayload = z.infer<typeof rejectCandidateSchema>;
/** The payload `restoreRevisionAsDraft` accepts, inferred so a restore cannot name a record. */
export type RestoreRevisionAsDraftPayload = z.infer<typeof restoreRevisionAsDraftSchema>;
