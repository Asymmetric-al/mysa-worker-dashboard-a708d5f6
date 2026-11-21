/**
 * `POST /api/import/accept` — the one browser transport for `acceptImportRows`, the call that turns the
 * reviewed decisions of an import into contacts. It holds the only durable effect in the import journey,
 * so it carries that journey's hardest guarantee: the identity of the attempt recovers the receipt when an
 * acknowledgement is lost, and the reviewed snapshot reaches the service exactly as it arrived.
 *
 * In scope from the API table's `POST /api/import/accept` row (AAP 0.6.3), the "Bring in a contact list"
 * entry of the named inventory (AAP 0.7.1), and the rule that every handler under `src/app/api` is a thin
 * adapter over exactly one named mutation (AAP 0.11.1).
 *
 * This path answers `POST` alone. The receipt a lost acknowledgement is recovered from is read back by
 * operation identity through `GET /api/import/[operationId]`, so a `GET` here would be a second way to
 * read one receipt rather than a second way to accept.
 */
import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput } from "@/modules/data-service";
/**
 * The `invalid` constructor comes from the module that owns the outcome set rather than through the service
 * barrel, which re-exports the conversion helpers only: a body that never parsed names no member of its
 * own, so its refusal is built here from the shape the constructor declares.
 */
import { invalid } from "@/modules/data-service/outcome";
import { IMPORT_DECISION_KINDS, type ImportCellCorrectionInput, type ImportDecisionInput } from "@/modules/import/decide";
import { IMPORT_MAX_CELL_CODE_POINTS, IMPORT_MAX_DATA_ROWS } from "@/modules/import/parse";

/** The synthetic store reads and writes local files, so this handler runs on the Node runtime and never on the edge runtime. */
export const runtime = "nodejs";

/** The development session and the scenario clock are resolved per request, so an acceptance is never served from a cache across a persona switch, a reset or a scenario change. */
export const dynamic = "force-dynamic";

/** The attempt a refusal answers for when the body named none, so every answer names the attempt it answers. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const JSON_BODY_REFUSAL = "Send the acceptance as a JSON object carrying operationId, scope, expectedRevision and payload, so the reviewed decisions arrive together with the identity of the attempt.";

/** The payload `acceptImportRows` accepts, taken from the mutation that validates it so the two cannot drift. */
type AcceptImportRowsPayload = Parameters<typeof mutations.import.acceptImportRows>[0]["payload"];

/**
 * One decision kind, read off the domain's own runtime list. The shapes below are declared against this
 * type, so a fifth kind the domain adds, or a kind offered here that the domain does not have, fails to
 * compile instead of reaching the service unshaped.
 */
type DecisionKind = (typeof IMPORT_DECISION_KINDS)[number];

const sourceReferenceSchema: z.ZodType<SourceReference> = z.strictObject({
  system: z.string().min(1, { error: "system must name the source that issued this reference." }),
  reference: z.string().min(1, { error: "reference must carry the identifier that source issued." }),
});

const rowNumberSchema = z
  .int({
    error: "rowNumber must be the number of a data row of the proposal you reviewed.",
  })
  .positive({ error: "A row number is the proposal's own 1-based identity, so it starts at 1." });

const rowCorrectionSchema: z.ZodType<ImportCellCorrectionInput> = z.strictObject({
  columnNumber: z.int({ error: "columnNumber must be the position of a column of the file." }).positive({
    error: "A column position is 1-based, so it starts at 1.",
  }),
  value: z.string().max(IMPORT_MAX_CELL_CODE_POINTS, {
    error: `A corrected cell holds at most ${String(IMPORT_MAX_CELL_CODE_POINTS)} Unicode code points, which is the length every cell of the file is measured against.`,
  }),
});

/** One shape per decision kind, each carrying that kind's members and no other kind's. */
const ROW_DECISION_SHAPES = {
  create: z.strictObject({
    kind: z.literal("create"),
    rowNumber: rowNumberSchema,
    corrections: z.array(rowCorrectionSchema).optional(),
  }),
  reuse: z.strictObject({
    kind: z.literal("reuse"),
    rowNumber: rowNumberSchema,
    // Named only by its opaque reference: whether this caller may reuse that identity, and whether the
    // identity was offered for this row, are the service's re-check, not this transport's.
    candidate: sourceReferenceSchema,
    corrections: z.array(rowCorrectionSchema).optional(),
  }),
  skip: z.strictObject({
    kind: z.literal("skip"),
    rowNumber: rowNumberSchema,
    reason: z.string().optional(),
  }),
  unresolved: z.strictObject({
    kind: z.literal("unresolved"),
    rowNumber: rowNumberSchema,
  }),
} satisfies Record<DecisionKind, z.ZodObject>;

const rowDecisionSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion("kind", [
  ROW_DECISION_SHAPES.create,
  ROW_DECISION_SHAPES.reuse,
  ROW_DECISION_SHAPES.skip,
  ROW_DECISION_SHAPES.unresolved,
]);

/**
 * The payload this path accepts, mirroring the review step's own check field for field. Every object is
 * strict, so a member the review step does not send is refused by name rather than carried onward: there
 * is no field here in which a mailing preference, a merge, an overwrite or a forced rerun could travel,
 * and adding one would have to be a visible change to this declaration.
 */
const acceptImportRowsPayloadSchema: z.ZodType<AcceptImportRowsPayload> = z.strictObject({
  acknowledged: z.literal(true, {
    error: "Confirm the acceptance explicitly, because accepting is the step that writes the contacts.",
  }),
  // The file's fingerprint, opaque here: a fingerprint that belongs to another version of the file is the
  // service's conflict to answer, and this file compares it with nothing.
  fileFingerprint: z
    .string({ error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." })
    .min(1, { error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." })
    .max(128, { error: "fileFingerprint is longer than a fingerprint of a reviewed file can be." }),
  decisions: z
    .array(rowDecisionSchema, { error: "A reviewed snapshot lists the decision taken for each row it covers." })
    .min(1, { error: "Review at least one row decision before accepting." })
    .max(IMPORT_MAX_DATA_ROWS, {
      error: `A reviewed snapshot holds at most ${String(IMPORT_MAX_DATA_ROWS)} decisions, one per data row an import accepts; this request carried more.`,
    }),
});

/**
 * The whole request: the shared envelope and this path's payload judged in one pass, so a single fault is
 * reported once, under the field path it belongs to (`payload.decisions` and so on).
 */
const acceptImportRowsRequestSchema: z.ZodType<MutationInput<AcceptImportRowsPayload>> = mutationInputSchema(acceptImportRowsPayloadSchema);

function isBodyObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The attempt a refusal answers for: the caller's own identity, forwarded as it arrived and never minted here. */
function attemptIdOf(body: unknown): string {
  if (!isBodyObject(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed = body["operationId"];
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * Accepts the reviewed decisions snapshot and answers with exactly one of the service's eight outcomes —
 * `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown` —
 * whose per-row results are the receipt of what happened to each reviewed row. Forwarded untouched: the
 * outcome is the service's, and this file adds no field, header or status of its own.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // A body that is not JSON carried no member at all, so the refusal is about the request rather than
    // about a field somebody could have filled in, and nothing was read and nothing was written.
    return toResponse(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: { payload: [JSON_BODY_REFUSAL] } }));
  }
  const parsed = acceptImportRowsRequestSchema.safeParse(isBodyObject(body) ? body : {});
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  // The four members are carried by reference, never rebuilt from their parts. The reviewed snapshot and
  // the identity of the attempt together are the intent the ledger records, so reordering, deduplicating,
  // relabelling or renumbering a decision here would change that intent: it would turn a legitimate replay
  // into a conflict and a changed snapshot into a false replay.
  const input: MutationInput<AcceptImportRowsPayload> = {
    operationId: parsed.data.operationId,
    scope: parsed.data.scope,
    expectedRevision: parsed.data.expectedRevision,
    payload: parsed.data.payload,
  };
  try {
    return toResponse(await mutations.import.acceptImportRows(input));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so a
    // throw means a store fault or a failure whose fate is not known. The one mapper tells those apart, so
    // neither becomes an acceptance this file claims and neither is retried here.
    return toResponse(outcomeFromError(input.operationId, error));
  }
}
