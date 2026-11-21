/**
 * The Ministry Updates family's withdrawal payload schemas — `withdrawUpdate` and `withdrawLocale` —
 * and the one bound this family puts on the note a worker may attach to either.
 */
import { z } from "zod";
import { WITHDRAWAL_WORDING } from "../copy/updates-copy";
import { contentIdSchema, localeTagSchema } from "./draft";
// The one bound on the reason, and the reason schema derived from it
/** The longest reason this family accepts beside a withdrawal: 500 characters. */
export const WITHDRAWAL_REASON_MAX_CHARS = 500;
/** The optional reason a worker may attach to a withdrawal: trimmed text within the family bound. */
export const withdrawalReasonSchema = z
  .string({
    error: "A withdrawal reason is text, so type it here rather than pasting formatted content.",
  })
  .trim()
  .max(WITHDRAWAL_REASON_MAX_CHARS, `Keep the reason to ${WITHDRAWAL_REASON_MAX_CHARS} characters or fewer: it is a short note ` + "beside the withdrawal, not a record of why the edition existed.")
  .optional()
  .describe(`${WITHDRAWAL_WORDING.whatItDoes} ${WITHDRAWAL_WORDING.whatItDoesNotDo}`);
// The two withdrawal payloads: every locale edition of one Update, or exactly one edition
/** Feeds `withdrawUpdate`: withdraw every locale edition of one Update inside this application. */
export const withdrawUpdateSchema = z.strictObject({
  documentId: contentIdSchema,
  reason: withdrawalReasonSchema,
});
/** Feeds `withdrawLocale`: withdraw exactly one locale edition, leaving its siblings readable. */
export const withdrawLocaleSchema = z.strictObject({
  variantId: contentIdSchema,
  locale: localeTagSchema,
  reason: withdrawalReasonSchema,
});
// Payload types: inferred from the schemas, never written beside them
/** The payload `withdrawUpdate` accepts, inferred so the overview and its hook hold one shape. */
export type WithdrawUpdatePayload = z.infer<typeof withdrawUpdateSchema>;
/** The payload `withdrawLocale` accepts, inferred so a locale edition cannot restate it. */
export type WithdrawLocalePayload = z.infer<typeof withdrawLocaleSchema>;
