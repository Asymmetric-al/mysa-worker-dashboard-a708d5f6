import { z } from "zod";
import { IMPORT_FIELD_IDS } from "@/modules/import/map";
import type { ImportColumnIgnoreReason, ImportConfirmedMapping, ImportFieldAssignment } from "@/modules/import/map";
import { IMPORT_MAX_BYTES } from "@/modules/import/parse";
const BASE64_CHARS_PER_BYTE = 4 / 3;
const TRANSPORT_HEADROOM_BYTES = 1 << 20;
const CONTENT_BASE64_MAX_CHARS = Math.ceil((IMPORT_MAX_BYTES + TRANSPORT_HEADROOM_BYTES) * BASE64_CHARS_PER_BYTE);
const importFieldIdSchema = z.enum(IMPORT_FIELD_IDS);
const IMPORT_COLUMN_IGNORE_REASONS = ["blank-header", "unrecognised-header", "consent-preserved-as-data", "excluded-topic", "field-declined", "not-chosen"] as const satisfies readonly ImportColumnIgnoreReason[];
const importFieldAssignmentSchema: z.ZodType<ImportFieldAssignment> = z.strictObject({ fieldId: importFieldIdSchema, columnIndex: z.number().int().min(1, { error: "columnIndex is 1-based, so it starts at 1." }) });
// A blank header is a real case this list reports, so an empty header text is accepted here.
const importIgnoredColumnSchema = z.strictObject({ index: z.number().int().min(1, { error: "index is 1-based, so it starts at 1." }), header: z.string(), occurrence: z.number().int().min(1, { error: "occurrence is 1-based, so it starts at 1." }), reason: z.enum(IMPORT_COLUMN_IGNORE_REASONS), message: z.string() });
const confirmedMappingSchema: z.ZodType<ImportConfirmedMapping> = z.strictObject({
  columnCount: z.number().int().min(0),
  assignments: z.array(importFieldAssignmentSchema),
  fields: z.array(importFieldIdSchema),
  declined: z.array(importFieldIdSchema),
  unmapped: z.array(importFieldIdSchema),
  ignored: z.array(importIgnoredColumnSchema),
});
const importProposalFields = {
  fileName: z.string().min(1, { error: "fileName must name the chosen file." }),
  // Left able to be empty: the empty file's refusal belongs to the domain, and decoding is its job.
  contentBase64: z.string().max(CONTENT_BASE64_MAX_CHARS, { error: "contentBase64 is longer than one import request can carry; choose a smaller file." }),
};
export const importFilePayloadSchema = z.strictObject({ ...importProposalFields, confirmedMapping: confirmedMappingSchema.optional() });
export const importMappingPayloadSchema = z.strictObject({ ...importProposalFields, confirmedMapping: confirmedMappingSchema.refine((mapping) => mapping.assignments.length > 0, { error: "confirmedMapping pairs no field with a column; map at least one field." }) });
export type ImportFilePayload = z.infer<typeof importFilePayloadSchema>;
export type ImportMappingPayload = z.infer<typeof importMappingPayloadSchema>;
