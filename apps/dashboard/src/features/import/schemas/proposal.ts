/**
 * Contact import, steps one and two: the browser-side payload check for the `proposeImport`
 * mutation, in the two shapes the journey posts.
 *
 * Scope: AAP 0.6.1 "Mutations: import" (`proposeImport`); 0.6.3 `POST /api/import`; 0.7.1 ("A form
 * validates with Zod, then posts `{ operationId, scope, expectedRevision, payload }`"); 0.10.1
 * family 6 with criterion 4; 0.2.1 and 0.8.6 (a file is typed by its content, never by its name).
 * The journey calls `proposeImport` twice — first with the chosen file only, so the service can
 * parse it, refuse the limits and suggest a mapping, then again with the mapping the worker
 * confirmed. Confirming a mapping changes the intent, so the second call carries a new
 * `operationId` — the shared review step's `useReviewedMutation` owns that rule, not this module.
 *
 * This module checks shape and vocabulary only. The fatal UTF-8 decode, the workbook refusal, the
 * four limits and the whole mapping suggestion belong to `@/modules/import/parse` and
 * `@/modules/import/map`, which the service runs; a payload accepted here is never an import
 * result, never a consent and never a safety qualification.
 */

import { z } from "zod";

import { IMPORT_FIELD_IDS } from "@/modules/import/map";
import type {
  ImportColumnIgnoreReason,
  ImportConfirmedMapping,
  ImportFieldAssignment,
} from "@/modules/import/map";
import { IMPORT_MAX_BYTES } from "@/modules/import/parse";

// ---------------------------------------------------------------------------------------------
// The one derived bound: the request body, not the product limit
// ---------------------------------------------------------------------------------------------

/**
 * Base64 turns every three bytes into four characters, so this ratio is the exact expansion of the
 * transport encoding rather than a rounded estimate.
 */
const BASE64_CHARS_PER_BYTE = 4 / 3;

/**
 * One mebibyte of slack above the product's byte limit. The point of the slack is that a file at or
 * just over the limit still reaches the service, which owns the readable refusal, instead of being
 * stopped by a body-size error the worker cannot act on.
 */
const TRANSPORT_HEADROOM_BYTES = 1 << 20;

/**
 * The transported length of the largest file this field will carry: `contentBase64` holds the raw
 * bytes so the service can decode them, measure them and refuse them, and this bound exists solely
 * to keep one request finite. It is derived from the product's byte limit so the two cannot drift
 * apart when that limit changes.
 */
const CONTENT_BASE64_MAX_CHARS = Math.ceil(
  (IMPORT_MAX_BYTES + TRANSPORT_HEADROOM_BYTES) * BASE64_CHARS_PER_BYTE,
);

// ---------------------------------------------------------------------------------------------
// Vocabulary and shapes the mapping module owns
// ---------------------------------------------------------------------------------------------

/**
 * The closed target-field vocabulary, taken from `@/modules/import/map` rather than retyped here:
 * the selector that renders step two reads the same list, so a field it can offer is a field this
 * check accepts, and a field that module drops stops being accepted at once.
 */
const importFieldIdSchema = z.enum(IMPORT_FIELD_IDS);

/**
 * The reasons a confirmed mapping gives for leaving a column out. `ImportColumnIgnoreReason` is a
 * type with no runtime list beside it, so the six members are restated here with a `satisfies`
 * clause: a reason this file cannot name, or one that is no longer a member, fails to compile.
 */
const IMPORT_COLUMN_IGNORE_REASONS = [
  "blank-header",
  "unrecognised-header",
  "consent-preserved-as-data",
  "excluded-topic",
  "field-declined",
  "not-chosen",
] as const satisfies readonly ImportColumnIgnoreReason[];

/**
 * One confirmed pair: a field and the 1-based position of the column that supplies it. The position
 * carries no upper bound here on purpose — a column the file does not have is refused by the
 * domain's own check, with its own reason.
 */
const importFieldAssignmentSchema: z.ZodType<ImportFieldAssignment> = z.strictObject({
  fieldId: importFieldIdSchema,
  columnIndex: z.number().int().min(1, { error: "columnIndex is 1-based, so it starts at 1." }),
});

/** One column the mapping leaves out, with the factual reason it was left out. */
const importIgnoredColumnSchema = z.strictObject({
  index: z.number().int().min(1, { error: "index is 1-based, so it starts at 1." }),
  // A blank header is a real case this list reports, so an empty header text is accepted here.
  header: z.string(),
  occurrence: z.number().int().min(1, { error: "occurrence is 1-based, so it starts at 1." }),
  reason: z.enum(IMPORT_COLUMN_IGNORE_REASONS),
  message: z.string(),
});

/**
 * The mapping a worker confirmed, in the shape `@/modules/import/map` owns: it wraps the explicit
 * assignments and also carries the counts the step displays beside them, so this schema follows
 * that module's `ImportConfirmedMapping` rather than a flattened list of pairs. The annotation is
 * what keeps the two in step — a change to the domain's shape stops compiling here.
 */
const confirmedMappingSchema: z.ZodType<ImportConfirmedMapping> = z.strictObject({
  columnCount: z.number().int().min(0),
  assignments: z.array(importFieldAssignmentSchema),
  fields: z.array(importFieldIdSchema),
  declined: z.array(importFieldIdSchema),
  unmapped: z.array(importFieldIdSchema),
  ignored: z.array(importIgnoredColumnSchema),
});

// ---------------------------------------------------------------------------------------------
// The two payload shapes
// ---------------------------------------------------------------------------------------------

/** The members both shapes carry: the chosen file and the bytes the service will measure itself. */
const importProposalFields = {
  /**
   * Display metadata only. The receipt shows this name and nothing depends on it: a filename or an
   * extension is not evidence of a CSV, because the file is typed by its content.
   */
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

/**
 * Validates the second `proposeImport` payload: the same file with the mapping the worker
 * confirmed. A mapping that pairs no field with a column is refused, because confirming it would
 * import nothing while reading as a decision.
 */
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
