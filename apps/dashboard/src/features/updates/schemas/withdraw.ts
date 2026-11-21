import { z } from "zod";
import { WITHDRAWAL_WORDING } from "../copy/updates-copy";
import { contentIdSchema, localeTagSchema } from "./draft";
export const WITHDRAWAL_REASON_MAX_CHARS = 500;
export const withdrawalReasonSchema = z
  .string({ error: "A withdrawal reason is text, so type it here rather than pasting formatted content." })
  .trim()
  .max(WITHDRAWAL_REASON_MAX_CHARS, `Keep the reason to ${WITHDRAWAL_REASON_MAX_CHARS} characters or fewer: it is a short note ` + "beside the withdrawal, not a record of why the edition existed.")
  .optional()
  .describe(`${WITHDRAWAL_WORDING.whatItDoes} ${WITHDRAWAL_WORDING.whatItDoesNotDo}`);
export const withdrawUpdateSchema = z.strictObject({ documentId: contentIdSchema, reason: withdrawalReasonSchema });
export const withdrawLocaleSchema = z.strictObject({ variantId: contentIdSchema, locale: localeTagSchema, reason: withdrawalReasonSchema });
export type WithdrawUpdatePayload = z.infer<typeof withdrawUpdateSchema>;
export type WithdrawLocalePayload = z.infer<typeof withdrawLocaleSchema>;
