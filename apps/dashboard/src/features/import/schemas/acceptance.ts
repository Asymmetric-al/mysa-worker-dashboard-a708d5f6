/**
 * Contact import, the journey's closing act: the browser-side payload checks for the two mutations
 * that end it — `acceptImportRows` (`POST /api/import/accept`) and `cancelImport` (`POST
 * /api/import/cancel`).
 */
import { z } from "zod";
import { rowDecisionPayloadSchema } from "./row-decision";
import { IMPORT_MAX_DATA_ROWS } from "@/modules/import/parse";
// The explicit acknowledgement, the file it was given for, and the decisions it covers
const acknowledgedSchema = z.literal(true, {
  error: "Confirm the acceptance explicitly.",
});
const fileFingerprintSchema = z
  .string({
    error: "fileFingerprint must carry the fingerprint reported for the file you reviewed.",
  })
  .min(1, {
    error: "fileFingerprint must carry the fingerprint reported for the file you reviewed.",
  });
const reviewedDecisionsSchema = z
  .array(rowDecisionPayloadSchema, {
    error: "Review at least one row decision before accepting.",
  })
  .min(1, { error: "Review at least one row decision before accepting." })
  .max(IMPORT_MAX_DATA_ROWS, {
    error: "A reviewed snapshot holds at most one decision per data row the import accepts.",
  });
// acceptImportRows
/** Validates the `acceptImportRows` payload: the explicit acknowledgement, the fingerprint of the file it was given for, and the decisions it covers. */
export const acceptImportRowsPayloadSchema = z.strictObject({
  acknowledged: acknowledgedSchema,
  fileFingerprint: fileFingerprintSchema,
  decisions: reviewedDecisionsSchema,
});
/** The validated `acceptImportRows` payload: what the review step posts once the worker confirms. */
export type AcceptImportRowsPayload = z.infer<typeof acceptImportRowsPayloadSchema>;
// cancelImport: the payload is empty, and strict about it
/** Validates the `cancelImport` payload: nothing beyond the shared envelope. */
export const cancelPayloadSchema = z.strictObject({});
/** The validated `cancelImport` payload: an empty object, so `MutationInput<CancelPayload>` sites type cleanly. */
export type CancelPayload = z.infer<typeof cancelPayloadSchema>;
