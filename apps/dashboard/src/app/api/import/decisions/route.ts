import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import type { ImportCellCorrectionInput, ImportCreateDecisionInput, ImportDecisionKind, ImportReuseDecisionInput, ImportSkipDecisionInput, ImportUnresolvedDecisionInput } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS } from "@/modules/import/parse";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, mutate, operationIdentityOf } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RowDecisionPayload = Parameters<typeof mutations.import.setRowDecision>[0]["payload"];
const positionSchema = z
  .number({ error: "A position is the number the proposal reported for it, counted from 1: a row number is that row's identity on the review screen and a column number is that column's place in the file, never an array index." })
  .int({ error: "A position is a whole number, because rows and columns are counted rather than measured." })
  .min(1, { error: "Positions start at 1: the first data row of an import is row 1, and a header row or a blank row is never one." });
const candidateReferenceSchema = z.strictObject(
  { system: z.string().min(1, { error: "A reference names the source system that issued it." }), reference: z.string().min(1, { error: "A reference carries the identifier that source issued." }) },
  { error: (issue) => (issue.code === "invalid_type" ? "A reuse decision names the contact it reuses by the opaque reference the proposal reported for that row: reuse attaches to an identity the service has already resolved, and a decision that names none would have to guess one from the file." : undefined) },
) satisfies z.ZodType<SourceReference>;
const correctionSchema = z.strictObject({
  columnNumber: positionSchema,
  value: z
    .string({ error: "A correction carries the text that replaces the cell." })
    .refine((value) => Array.from(value).length <= IMPORT_MAX_CELL_CODE_POINTS, { error: `A corrected cell holds at most the ${IMPORT_MAX_CELL_CODE_POINTS} characters the importer reads from one cell, so a longer value could not have come from this file.` }),
}) satisfies z.ZodType<ImportCellCorrectionInput>;
const createDecisionSchema = z.strictObject({ kind: z.literal("create"), rowNumber: positionSchema, corrections: z.array(correctionSchema).optional() }) satisfies z.ZodType<ImportCreateDecisionInput>;
const reuseDecisionSchema = z.strictObject({ kind: z.literal("reuse"), rowNumber: positionSchema, candidate: candidateReferenceSchema, corrections: z.array(correctionSchema).optional() }) satisfies z.ZodType<ImportReuseDecisionInput>;
const skipDecisionSchema = z.strictObject({ kind: z.literal("skip"), rowNumber: positionSchema, reason: z.string().optional() }) satisfies z.ZodType<ImportSkipDecisionInput>;
const unresolvedDecisionSchema = z.strictObject({ kind: z.literal("unresolved"), rowNumber: positionSchema }) satisfies z.ZodType<ImportUnresolvedDecisionInput>;
const ROW_DECISION_SHAPES = { create: createDecisionSchema, reuse: reuseDecisionSchema, skip: skipDecisionSchema, unresolved: unresolvedDecisionSchema } satisfies Record<ImportDecisionKind, z.ZodObject>;
const rowDecisionPayloadSchema: z.ZodType<RowDecisionPayload> = z.discriminatedUnion("kind", [ROW_DECISION_SHAPES.create, ROW_DECISION_SHAPES.reuse, ROW_DECISION_SHAPES.skip, ROW_DECISION_SHAPES.unresolved], {
  error: "A decision is one of the four the review step offers: create a new private entry, reuse an authorised identity, skip the row, or leave it unresolved.",
});
const rowDecisionRequestSchema = mutationInputSchema(rowDecisionPayloadSchema);
const UNREADABLE_BODY = new z.ZodError([{ code: "custom", path: ["payload"], message: "The request body must be valid JSON: the four-field envelope and the row decision are both read from it, so a body that cannot be decoded states no decision about any row." }]);
/** Records one import row's decision; answers with exactly one of the service's eight outcomes. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  if (body === undefined) return toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, UNREADABLE_BODY));
  const parsed = rowDecisionRequestSchema.safeParse(body);
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  return mutate(parsed.data.operationId, () => mutations.import.setRowDecision(parsed.data));
}
