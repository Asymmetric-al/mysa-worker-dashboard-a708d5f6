import { z } from "zod";
import type { ImportCellCorrectionInput, ImportDecisionInput, ImportDecisionKind } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS } from "@/modules/import/parse";
import type { SourceReference } from "@/lib/ids";
const sourceReferenceSchema: z.ZodType<SourceReference> = z.strictObject({ system: z.string().min(1, { error: "system must name the source that issued this reference." }), reference: z.string().min(1, { error: "reference must carry the identifier that source issued." }) });
const rowCorrectionSchema: z.ZodType<ImportCellCorrectionInput> = z.strictObject({ columnNumber: z.number().int().min(1, { error: "columnNumber is 1-based, so it starts at 1." }), value: z.string().max(IMPORT_MAX_CELL_CODE_POINTS, { error: "A correction value is limited in length." }) });
const rowNumberSchema = z.number({ error: "rowNumber must be the number of a data row." }).int({ error: "rowNumber must be a whole number." }).min(1, { error: "rowNumber is 1-based, so it starts at 1." });
const ROW_DECISION_SHAPES = {
  create: z.strictObject({ kind: z.literal("create"), rowNumber: rowNumberSchema, corrections: z.array(rowCorrectionSchema).optional() }),
  reuse: z.strictObject({ kind: z.literal("reuse"), rowNumber: rowNumberSchema, candidate: sourceReferenceSchema, corrections: z.array(rowCorrectionSchema).optional() }),
  skip: z.strictObject({ kind: z.literal("skip"), rowNumber: rowNumberSchema, reason: z.string().optional() }),
  unresolved: z.strictObject({ kind: z.literal("unresolved"), rowNumber: rowNumberSchema }),
} satisfies Record<ImportDecisionKind, z.ZodObject>;
export const rowDecisionPayloadSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion("kind", [ROW_DECISION_SHAPES.create, ROW_DECISION_SHAPES.reuse, ROW_DECISION_SHAPES.skip, ROW_DECISION_SHAPES.unresolved]);
export type RowDecisionPayload = z.infer<typeof rowDecisionPayloadSchema>;
