import { ZodError, z } from "zod";
import { routeMethods } from "@/app/api/methods";
import type { SourceReference } from "@/lib/ids";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput } from "@/modules/data-service";
import { IMPORT_DECISION_KINDS, type ImportCellCorrectionInput, type ImportDecisionInput } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS, IMPORT_MAX_DATA_ROWS } from "@/modules/import/parse";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, mutate, operationIdentityOf } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const JSON_BODY_REFUSAL = "Send the acceptance as a JSON object carrying operationId, scope, expectedRevision and payload, so the reviewed decisions arrive together with the identity of the attempt.";
type AcceptImportRowsPayload = Parameters<typeof mutations.import.acceptImportRows>[0]["payload"];
const sourceReferenceSchema: z.ZodType<SourceReference> = z.strictObject({ system: z.string().min(1, { error: "system must name the source that issued this reference." }), reference: z.string().min(1, { error: "reference must carry the identifier that source issued." }) });
const rowNumberSchema = z.int({ error: "rowNumber must be the number of a data row of the proposal you reviewed." }).positive({ error: "A row number is the proposal's own 1-based identity, so it starts at 1." });
const rowCorrectionSchema: z.ZodType<ImportCellCorrectionInput> = z.strictObject({
  columnNumber: z.int({ error: "columnNumber must be the position of a column of the file." }).positive({ error: "A column position is 1-based, so it starts at 1." }),
  value: z.string().max(IMPORT_MAX_CELL_CODE_POINTS, { error: `A corrected cell holds at most ${String(IMPORT_MAX_CELL_CODE_POINTS)} Unicode code points, which is the length every cell of the file is measured against.` }),
});
const ROW_DECISION_SHAPES = {
  create: z.strictObject({ kind: z.literal("create"), rowNumber: rowNumberSchema, corrections: z.array(rowCorrectionSchema).optional() }),
  reuse: z.strictObject({ kind: z.literal("reuse"), rowNumber: rowNumberSchema, candidate: sourceReferenceSchema, corrections: z.array(rowCorrectionSchema).optional() }),
  skip: z.strictObject({ kind: z.literal("skip"), rowNumber: rowNumberSchema, reason: z.string().optional() }),
  unresolved: z.strictObject({ kind: z.literal("unresolved"), rowNumber: rowNumberSchema }),
} satisfies Record<(typeof IMPORT_DECISION_KINDS)[number], z.ZodObject>;
const rowDecisionSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion("kind", [ROW_DECISION_SHAPES.create, ROW_DECISION_SHAPES.reuse, ROW_DECISION_SHAPES.skip, ROW_DECISION_SHAPES.unresolved]);
const acceptImportRowsPayloadSchema: z.ZodType<AcceptImportRowsPayload> = z.strictObject({
  acknowledged: z.literal(true, { error: "Confirm the acceptance explicitly, because accepting is the step that writes the contacts." }),
  fileFingerprint: z.string({ error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." }).min(1, { error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." }).max(128, { error: "fileFingerprint is longer than a fingerprint of a reviewed file can be." }),
  decisions: z
    .array(rowDecisionSchema, { error: "A reviewed snapshot lists the decision taken for each row it covers." })
    .min(1, { error: "Review at least one row decision before accepting." })
    .max(IMPORT_MAX_DATA_ROWS, { error: `A reviewed snapshot holds at most ${String(IMPORT_MAX_DATA_ROWS)} decisions, one per data row an import accepts; this request carried more.` }),
});
const acceptImportRowsRequestSchema: z.ZodType<MutationInput<AcceptImportRowsPayload>> = mutationInputSchema(acceptImportRowsPayloadSchema);
const isBodyObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
async function acceptImportRows(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  if (body === undefined) return toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: ["payload"], message: JSON_BODY_REFUSAL }])));
  const parsed = acceptImportRowsRequestSchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  const input: MutationInput<AcceptImportRowsPayload> = { operationId: parsed.data.operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: parsed.data.payload };
  return mutate(input.operationId, () => mutations.import.acceptImportRows(input));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: acceptImportRows });
