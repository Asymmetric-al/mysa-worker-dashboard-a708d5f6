/**
 * Contact import, step four: the browser-side payload check for the `setRowDecision` mutation.
 */
import { z } from "zod";
import type { ImportCellCorrectionInput, ImportDecisionInput, ImportDecisionKind } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS } from "@/modules/import/parse";
import type { SourceReference } from "@/lib/ids";
// The leaf shapes: an opaque reference, a corrected cell, a data-row number
const sourceReferenceSchema: z.ZodType<SourceReference> = z.strictObject({
  system: z.string().min(1, { error: "system must name the source that issued this reference." }),
  reference: z.string().min(1, { error: "reference must carry the identifier that source issued." }),
});
const rowCorrectionSchema: z.ZodType<ImportCellCorrectionInput> = z.strictObject({
  columnNumber: z.number().int().min(1, { error: "columnNumber is 1-based, so it starts at 1." }),
  value: z.string().max(IMPORT_MAX_CELL_CODE_POINTS, {
    error: "A correction value is limited in length.",
  }),
});
const rowNumberSchema = z
  .number({ error: "rowNumber must be the number of a data row." })
  .int({ error: "rowNumber must be a whole number." })
  .min(1, { error: "rowNumber is 1-based, so it starts at 1." });
// The four decisions, each carrying its own members and no other kind's
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
// The payload
/** Validates one browser decision about one imported row: exactly one of the domain's four client decisions, with the members that decision carries. */
export const rowDecisionPayloadSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion("kind", [
  ROW_DECISION_SHAPES.create,
  ROW_DECISION_SHAPES.reuse,
  ROW_DECISION_SHAPES.skip,
  ROW_DECISION_SHAPES.unresolved,
]);
/** The validated decision payload: the domain's closed client union, checked before it is posted. */
export type RowDecisionPayload = z.infer<typeof rowDecisionPayloadSchema>;
