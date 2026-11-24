import { z } from "zod";
import { rowDecisionPayloadSchema } from "./row-decision";
import { IMPORT_MAX_DATA_ROWS } from "@/modules/import/parse";
const fileFingerprintSchema = z.string({ error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." }).min(1, { error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." });
const reviewedDecisionsSchema = z
  .array(rowDecisionPayloadSchema, { error: "Review at least one row decision before accepting." })
  .min(1, { error: "Review at least one row decision before accepting." })
  .max(IMPORT_MAX_DATA_ROWS, { error: "A reviewed snapshot holds at most one decision per data row the import accepts." });
export const acceptImportRowsPayloadSchema = z.strictObject({ acknowledged: z.literal(true, { error: "Confirm the acceptance explicitly." }), fileFingerprint: fileFingerprintSchema, decisions: reviewedDecisionsSchema });
export type AcceptImportRowsPayload = z.infer<typeof acceptImportRowsPayloadSchema>;
export const cancelPayloadSchema = z.strictObject({});
export type CancelPayload = z.infer<typeof cancelPayloadSchema>;
