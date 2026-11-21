/**
 * Contact import, steps one and two: the browser-side payload check for the `proposeImport` mutation,
 * in the two shapes the journey posts.
 */
import { z } from "zod";
import { IMPORT_FIELD_IDS } from "@/modules/import/map";
import type { ImportColumnIgnoreReason, ImportConfirmedMapping, ImportFieldAssignment } from "@/modules/import/map";
import { IMPORT_MAX_BYTES } from "@/modules/import/parse";
// The one derived bound: the request body, not the product limit
const BASE64_CHARS_PER_BYTE = 4 / 3;

const TRANSPORT_HEADROOM_BYTES = 1 << 20;

const CONTENT_BASE64_MAX_CHARS = Math.ceil((IMPORT_MAX_BYTES + TRANSPORT_HEADROOM_BYTES) * BASE64_CHARS_PER_BYTE);
// Vocabulary and shapes the mapping module owns
const importFieldIdSchema = z.enum(IMPORT_FIELD_IDS);

const IMPORT_COLUMN_IGNORE_REASONS = [
  "blank-header",
  "unrecognised-header",
  "consent-preserved-as-data",
  "excluded-topic",
  "field-declined",
  "not-chosen",
] as const satisfies readonly ImportColumnIgnoreReason[];
const importFieldAssignmentSchema: z.ZodType<ImportFieldAssignment> = z.strictObject({
  fieldId: importFieldIdSchema,
  columnIndex: z.number().int().min(1, { error: "columnIndex is 1-based, so it starts at 1." }),
});
const importIgnoredColumnSchema = z.strictObject({
  index: z.number().int().min(1, { error: "index is 1-based, so it starts at 1." }),
  // A blank header is a real case this list reports, so an empty header text is accepted here.
  header: z.string(),
  occurrence: z.number().int().min(1, { error: "occurrence is 1-based, so it starts at 1." }),
  reason: z.enum(IMPORT_COLUMN_IGNORE_REASONS),
  message: z.string(),
});
const confirmedMappingSchema: z.ZodType<ImportConfirmedMapping> = z.strictObject({
  columnCount: z.number().int().min(0),
  assignments: z.array(importFieldAssignmentSchema),
  fields: z.array(importFieldIdSchema),
  declined: z.array(importFieldIdSchema),
  unmapped: z.array(importFieldIdSchema),
  ignored: z.array(importIgnoredColumnSchema),
});
// The two payload shapes
const importProposalFields = {
  fileName: z.string().min(1, { error: "fileName must name the chosen file." }),
  // Left able to be empty: an empty file is a real case whose readable refusal belongs to the
  // domain. Neither the base64 alphabet nor its padding is checked here, because decoding is the
  // domain's job and an opinion held here would become a second authority.
  contentBase64: z.string().max(CONTENT_BASE64_MAX_CHARS, {
    error: "contentBase64 is longer than one import request can carry; choose a smaller file.",
  }),
};
/** Validates the first `proposeImport` payload: the chosen file, before any mapping is confirmed. */
export const importFilePayloadSchema = z.strictObject({
  ...importProposalFields,
  confirmedMapping: confirmedMappingSchema.optional(),
});
/** Validates the second `proposeImport` payload: the same file with the mapping the worker confirmed. */
export const importMappingPayloadSchema = z.strictObject({
  ...importProposalFields,
  confirmedMapping: confirmedMappingSchema.refine((mapping) => mapping.assignments.length > 0, {
    error: "confirmedMapping pairs no field with a column; map at least one field.",
  }),
});
/** The validated first `proposeImport` payload. */
export type ImportFilePayload = z.infer<typeof importFilePayloadSchema>;
/** The validated second `proposeImport` payload. */
export type ImportMappingPayload = z.infer<typeof importMappingPayloadSchema>;
