/**
 * Contact import, step four: the browser-side payload check for the `setRowDecision` mutation.
 *
 * Scope: AAP 0.6.1 "Mutations: import" (`setRowDecision`); 0.6.3 `POST /api/import/decisions`; 0.7.1
 * ("A form validates with Zod, then posts `{ operationId, scope, expectedRevision, payload }`");
 * 0.10.1 family 6, contact import, with criterion 4 — the per-row decisions are "new private entry,
 * reuse authorized identity, skip, unresolved". Zod stays at the pinned 4.6.7 API.
 *
 * This checks shape and vocabulary, and nothing else. The service validates the same payload again
 * and answers with the `invalid` outcome whose per-field messages the form renders verbatim, and the
 * decision itself — whether a row may be accepted as it stands, whether a correction clears it, which
 * identities this caller may reuse, whether the file changed since the decisions were taken — belongs
 * to `@/modules/import/decide`. Nothing here parses a CSV, restates a limit, suggests a match or
 * produces a receipt.
 *
 * The payload is the domain's own `ImportDecisionInput`, the one closed union `recordDecision()`
 * reads, and the schema is annotated with that type, so a change to a decision's members stops
 * compiling here rather than failing at the service. Its member names are therefore the domain's —
 * `kind`, `candidate`, `corrections`, `reason` — and not a second set of names for the same facts:
 * renamed fields could not be read by the domain at all without a translation layer, which would
 * leave two vocabularies for one closed union.
 *
 * A recorded decision is not consent. `skip` is not a delete, `reuse` attaches a private preparation
 * entry to an identity that already exists instead of merging with it, and no member subscribes
 * anyone, delivers a message or qualifies an uploaded file as safe. Every failure carries the field
 * path the form anchors its message to.
 */

import { z } from "zod";

import type {
  ImportCellCorrectionInput,
  ImportDecisionInput,
  ImportDecisionKind,
} from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS } from "@/modules/import/parse";
import type { SourceReference } from "@/lib/ids";

// ---------------------------------------------------------------------------------------------
// The leaf shapes: an opaque reference, a corrected cell, a data-row number
// ---------------------------------------------------------------------------------------------

/**
 * An identity named the only way this import may name one: by the source system that issued the
 * reference and the opaque reference itself. Both members are opaque — neither is parsed, compared
 * or used as a join key — so two references that look alike are still two identities, and a name, an
 * address or an email is never a reference. The annotation is what keeps this in step with the
 * domain's `SourceReference`.
 */
const sourceReferenceSchema: z.ZodType<SourceReference> = z.strictObject({
  system: z.string().min(1, { error: "system must name the source that issued this reference." }),
  reference: z
    .string()
    .min(1, { error: "reference must carry the identifier that source issued." }),
});

/**
 * One cell the worker rewrote. The position is the domain's 1-based column number and never the
 * header text, so two columns with the same header stay distinct. No upper bound is set here on
 * purpose: the column count against the file itself is the domain's check, which refuses a file wider
 * than it accepts with its own reason. The value's bound is request-body protection aligned to the
 * domain's own cell limit, and the domain remains the authority that refuses an over-long cell.
 */
const rowCorrectionSchema: z.ZodType<ImportCellCorrectionInput> = z.strictObject({
  columnNumber: z.number().int().min(1, { error: "columnNumber is 1-based, so it starts at 1." }),
  value: z.string().max(IMPORT_MAX_CELL_CODE_POINTS, {
    error: "A correction value is limited in length.",
  }),
});

/**
 * A data row's number: the domain's 1-based position among the file's nonblank data rows, so the
 * header and any blank row are never numbered. Coercion is deliberately absent — a string that looks
 * like a number is a malformed decision here, not something to guess at.
 */
const rowNumberSchema = z
  .number({ error: "rowNumber must be the number of a data row." })
  .int({ error: "rowNumber must be a whole number." })
  .min(1, { error: "rowNumber is 1-based, so it starts at 1." });

// ---------------------------------------------------------------------------------------------
// The four decisions, each carrying its own members and no other kind's
// ---------------------------------------------------------------------------------------------

/**
 * The four payload shapes, keyed by the domain's own kind union. That key type is the guard: a kind
 * `decide.ts` adds leaves a member missing, and a kind it renames leaves a key unmatched, so neither
 * can drift into this file unnoticed. A strict object per kind is what keeps the vocabulary honest —
 * `skip` has no correction and no candidate, `reuse` has no worker reason, and an unknown member is
 * refused instead of dropped.
 *
 * The kinds are declared once here rather than in a separate enum: Zod needs a literal discriminator
 * per member, the record's keys and those literals are each checked against `ImportDecisionKind`, and
 * an enum beside them would be a second declaration of the same closed set.
 */
const ROW_DECISION_SHAPES = {
  create: z.strictObject({
    kind: z.literal("create"),
    rowNumber: rowNumberSchema,
    corrections: z.array(rowCorrectionSchema).optional(),
  }),
  reuse: z.strictObject({
    kind: z.literal("reuse"),
    rowNumber: rowNumberSchema,
    // Named only by its opaque reference. Whether this caller may reuse that identity, and whether
    // the identity was even offered for this row, are the service's decisions, not this check's.
    candidate: sourceReferenceSchema,
    corrections: z.array(rowCorrectionSchema).optional(),
  }),
  skip: z.strictObject({
    kind: z.literal("skip"),
    rowNumber: rowNumberSchema,
    // The worker's own words about leaving the row out, optional and untrimmed here; the domain
    // trims them and keeps the row's own problem beside them.
    reason: z.string().optional(),
  }),
  unresolved: z.strictObject({
    kind: z.literal("unresolved"),
    rowNumber: rowNumberSchema,
  }),
} satisfies Record<ImportDecisionKind, z.ZodObject>;

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

/**
 * Validates one browser decision about one imported row: exactly one of the domain's four client
 * decisions, with the members that decision carries. The union rather than a single object is what
 * expresses the coupling — reuse cannot arrive without its candidate, and no kind can arrive with
 * another kind's members — and it is what makes the result the domain's `ImportDecisionInput`.
 */
export const rowDecisionPayloadSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion(
  "kind",
  [
    ROW_DECISION_SHAPES.create,
    ROW_DECISION_SHAPES.reuse,
    ROW_DECISION_SHAPES.skip,
    ROW_DECISION_SHAPES.unresolved,
  ],
);

/** The validated decision payload: the domain's closed client union, checked before it is posted. */
export type RowDecisionPayload = z.infer<typeof rowDecisionPayloadSchema>;
