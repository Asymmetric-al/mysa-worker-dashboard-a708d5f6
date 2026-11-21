/** `POST /api/import/accept` — the one browser transport for `acceptImportRows`, the call that turns the reviewed decisions of an import into contacts. */
import { ZodError, z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput } from "@/modules/data-service";
import { IMPORT_DECISION_KINDS, type ImportCellCorrectionInput, type ImportDecisionInput } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS, IMPORT_MAX_DATA_ROWS } from "@/modules/import/parse";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../../handler";
/** The synthetic store reads and writes local files, so this handler runs on the Node runtime and never on the edge runtime. */
export const runtime = "nodejs";
/** The development session and the scenario clock are resolved per request, so an acceptance is never served from a cache across a persona switch, a reset or a scenario change. */
export const dynamic = "force-dynamic";
const JSON_BODY_REFUSAL = "Send the acceptance as a JSON object carrying operationId, scope, expectedRevision and payload, so the reviewed decisions arrive together with the identity of the attempt.";
/** The payload `acceptImportRows` accepts, taken from the mutation that validates it so the two cannot drift. */
type AcceptImportRowsPayload = Parameters<typeof mutations.import.acceptImportRows>[0]["payload"];
/** One decision kind, read off the domain's own runtime list. */
type DecisionKind = (typeof IMPORT_DECISION_KINDS)[number];
const sourceReferenceSchema: z.ZodType<SourceReference> = z.strictObject({ system: z.string().min(1, { error: "system must name the source that issued this reference." }), reference: z.string().min(1, { error: "reference must carry the identifier that source issued." }) });
const rowNumberSchema = z.int({ error: "rowNumber must be the number of a data row of the proposal you reviewed." }).positive({ error: "A row number is the proposal's own 1-based identity, so it starts at 1." });
const rowCorrectionSchema: z.ZodType<ImportCellCorrectionInput> = z.strictObject({
  columnNumber: z.int({ error: "columnNumber must be the position of a column of the file." }).positive({ error: "A column position is 1-based, so it starts at 1." }),
  value: z.string().max(IMPORT_MAX_CELL_CODE_POINTS, { error: `A corrected cell holds at most ${String(IMPORT_MAX_CELL_CODE_POINTS)} Unicode code points, which is the length every cell of the file is measured against.` }),
});
/** One shape per decision kind, each carrying that kind's members and no other kind's. */
const ROW_DECISION_SHAPES = {
  create: z.strictObject({ kind: z.literal("create"), rowNumber: rowNumberSchema, corrections: z.array(rowCorrectionSchema).optional() }),
  reuse: z.strictObject({
    kind: z.literal("reuse"),
    rowNumber: rowNumberSchema,
    // Named only by its opaque reference: whether this caller may reuse that identity, and whether the identity was offered for this row, are the service's re-check, not this transport's.
    candidate: sourceReferenceSchema,
    corrections: z.array(rowCorrectionSchema).optional(),
  }),
  skip: z.strictObject({ kind: z.literal("skip"), rowNumber: rowNumberSchema, reason: z.string().optional() }),
  unresolved: z.strictObject({ kind: z.literal("unresolved"), rowNumber: rowNumberSchema }),
} satisfies Record<DecisionKind, z.ZodObject>;
const rowDecisionSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion("kind", [ROW_DECISION_SHAPES.create, ROW_DECISION_SHAPES.reuse, ROW_DECISION_SHAPES.skip, ROW_DECISION_SHAPES.unresolved]);
/** The payload this path accepts, mirroring the review step's own check field for field. */
const acceptImportRowsPayloadSchema: z.ZodType<AcceptImportRowsPayload> = z.strictObject({
  acknowledged: z.literal(true, { error: "Confirm the acceptance explicitly, because accepting is the step that writes the contacts." }),
  // The file's fingerprint, opaque here: a fingerprint that belongs to another version of the file is the service's conflict to answer, and this file compares it with nothing.
  fileFingerprint: z.string({ error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." }).min(1, { error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." }).max(128, { error: "fileFingerprint is longer than a fingerprint of a reviewed file can be." }),
  decisions: z
    .array(rowDecisionSchema, { error: "A reviewed snapshot lists the decision taken for each row it covers." })
    .min(1, { error: "Review at least one row decision before accepting." })
    .max(IMPORT_MAX_DATA_ROWS, { error: `A reviewed snapshot holds at most ${String(IMPORT_MAX_DATA_ROWS)} decisions, one per data row an import accepts; this request carried more.` }),
});
/** The whole request: the shared envelope and this path's payload judged in one pass, so a single fault is reported once, under the field path it belongs to (`payload.decisions` and so on). */
const acceptImportRowsRequestSchema: z.ZodType<MutationInput<AcceptImportRowsPayload>> = mutationInputSchema(acceptImportRowsPayloadSchema);
function isBodyObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Accepts the reviewed decisions snapshot and answers with exactly one of the service's eight outcomes — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or … */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  if (body === undefined) {
    // A body that is not JSON carried no member at all, so the refusal is about the request rather than about a field somebody could have filled in, and nothing was read and nothing was written. It is built through the index's one converter, so this file imports nothing below the service's entry
    // point and answers in the same refusal shape as every other invalid outcome there.
    return toResponse(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: ["payload"], message: JSON_BODY_REFUSAL }])));
  }
  const parsed = acceptImportRowsRequestSchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  // The four members are carried by reference, never rebuilt from their parts. The reviewed snapshot and the identity of the attempt together are the intent the ledger records, so reordering, deduplicating,
  // relabelling or renumbering a decision here would change that intent: it would turn a legitimate replay into a conflict and a changed snapshot into a false replay.
  const input: MutationInput<AcceptImportRowsPayload> = { operationId: parsed.data.operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: parsed.data.payload };
  try {
    return toResponse(await mutations.import.acceptImportRows(input));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a throw means a store fault or a failure whose fate is not known. The one mapper tells those apart, so neither becomes an acceptance this file claims and neither is retried here.
    return toResponse(outcomeFromError(input.operationId, error));
  }
}
