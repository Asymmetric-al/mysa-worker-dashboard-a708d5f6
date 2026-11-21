/**
 * Contact import, the four named mutations: propose a file, decide about one row, accept the reviewed
 * rows, cancel the rest.
 */
import { Buffer } from "node:buffer";
import { z } from "zod";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { type SourceReference } from "@/lib/ids";
import {
  createDecisionSet,
  fingerprintOf,
  recordDecision,
  summariseDecisions,
  type ImportDecisionInput,
  type ImportDecisionRefusal,
  type ImportDecisionSet,
  type ImportDecisionSummary,
  type ImportFileFingerprint,
  type ImportRecordedCorrection,
  type ImportRowDecision as RecordedRowDecision,
} from "@/modules/import/decide";
import {
  IMPORT_FIELD_IDS,
  confirmMapping,
  suggestMapping,
  type ImportConfirmedMapping,
  type ImportFieldAssignment,
  type ImportFieldId,
  type ImportIgnoredColumn,
  type ImportMappingDecision,
} from "@/modules/import/map";
import { checkLimits, parseCsv, IMPORT_MAX_DATA_ROWS, type ImportRefusal, type ParsedCsvFile } from "@/modules/import/parse";
import { buildReceipt, cancelUnacceptedRows, readStoredReceipt, type ImportReceipt, type ImportRowApplication } from "@/modules/import/receipt";
import { validateRows, type ImportMatchCandidate, type ImportMatchReference, type ImportValidatedRow } from "@/modules/import/validate";
import { now } from "@/modules/time/clock";
import { canEdit, outcomeOfRefusal, resolveSession, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
import {
  importProposalRecordSchema,
  partnerRecordSchema,
  sameScope,
  scopeSchema,
  type ImportColumnAssignmentRecord,
  type ImportProposalRecord,
  type ImportRowDecision as StoredRowDecision,
  type ImportRowDecisionRecord,
  type ImportRowResultRecord,
  type ImportSummaryRecord,
  type MutationInput,
  type PartnerContactMethod,
  type PartnerNameParts,
  type PartnerRecord,
  type PartnerRestriction,
  type Scope,
} from "../envelope";
import { runMutation, type CurrentTarget } from "../operations";
import { LOCAL_STORE_SYSTEM, ROOT_FIELD_KEY, denied, invalid, unavailable, type DenialReason, type FieldMessages, type MutationOutcome, type MutationResult, type PerItemResult } from "../outcome";
// The four payloads: one concrete schema per mutation
const CONTENT_BASE64_MAX_CHARS = Math.ceil((5 * 1024 * 1024 + (1 << 20)) * (4 / 3));

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const COLUMN_IGNORE_REASONS = ["blank-header", "unrecognised-header", "consent-preserved-as-data", "excluded-topic", "field-declined", "not-chosen"] as const;

const ROW_VERDICTS = ["ready", "needs-correction"] as const;

const positionSchema = z.int().positive({
  error: "A row number and a column position are 1-based, so they start at 1.",
});
const matchReferenceSchema: z.ZodType<ImportMatchReference> = z.object({
  system: z.string().min(1),
  reference: z.string().min(1),
});
const recordedCorrectionSchema: z.ZodType<ImportRecordedCorrection> = z.object({
  columnNumber: positionSchema,
  fieldId: z.enum(IMPORT_FIELD_IDS),
  value: z.string(),
});
const recordedDecisionSchema: z.ZodType<RecordedRowDecision> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    rowNumber: positionSchema,
    verdict: z.enum(ROW_VERDICTS),
    corrections: z.array(recordedCorrectionSchema),
  }),
  z.object({
    kind: z.literal("reuse"),
    rowNumber: positionSchema,
    verdict: z.enum(ROW_VERDICTS),
    candidate: matchReferenceSchema,
    corrections: z.array(recordedCorrectionSchema),
  }),
  z.object({
    kind: z.literal("skip"),
    rowNumber: positionSchema,
    verdict: z.enum(ROW_VERDICTS),
    workerReason: z.string(),
    rowProblem: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("unresolved"),
    rowNumber: positionSchema,
    verdict: z.enum(ROW_VERDICTS),
  }),
]);
const fileFingerprintSchema: z.ZodType<ImportFileFingerprint> = z.object({
  checksum: z.string().min(1),
  columnCount: z.int().nonnegative(),
  dataRowCount: z.int().nonnegative(),
});
const decisionSetSchema: z.ZodType<ImportDecisionSet> = z.object({
  fingerprint: fileFingerprintSchema,
  decisions: z.array(recordedDecisionSchema),
});
const fieldAssignmentSchema: z.ZodType<ImportFieldAssignment> = z.object({
  fieldId: z.enum(IMPORT_FIELD_IDS),
  columnIndex: positionSchema,
});
const ignoredColumnSchema: z.ZodType<ImportIgnoredColumn> = z.object({
  index: positionSchema,
  header: z.string(),
  occurrence: positionSchema,
  reason: z.enum(COLUMN_IGNORE_REASONS),
  message: z.string(),
});
const confirmedMappingSchema: z.ZodType<ImportConfirmedMapping> = z.object({
  columnCount: z.int().nonnegative(),
  assignments: z.array(fieldAssignmentSchema),
  fields: z.array(z.enum(IMPORT_FIELD_IDS)),
  declined: z.array(z.enum(IMPORT_FIELD_IDS)),
  unmapped: z.array(z.enum(IMPORT_FIELD_IDS)),
  ignored: z.array(ignoredColumnSchema),
});
/** The `proposeImport` payload: the chosen file, and — on the journey's second call — the mapping the worker confirmed. */
export const proposeImportPayloadSchema: z.ZodType<ProposeImportPayload> = z.strictObject({
  fileName: z
    .string()
    .min(1, { error: "fileName must name the chosen file." })
    // Display metadata only, and bounded so it stays a name rather than a document.
    .max(255, { error: "fileName is longer than a file name can be." }),
  contentBase64: z.string().max(CONTENT_BASE64_MAX_CHARS, {
    error: "contentBase64 is longer than one import request can carry; choose a smaller file.",
  }),
  confirmedMapping: confirmedMappingSchema
    .refine((mapping) => mapping.assignments.length > 0, {
      error: "confirmedMapping pairs no field with a column; map at least one field.",
    })
    .optional(),
});
/** The validated `proposeImport` payload. */
export type ProposeImportPayload = {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly confirmedMapping?: ImportConfirmedMapping;
};
const rowCorrectionInputSchema: z.ZodType<{ columnNumber: number; value: string }> = z.strictObject({
  columnNumber: positionSchema,
  value: z.string(),
});
/** One worker's decision about one imported row: exactly the four kinds `decide.ts` declares, with the members that kind carries. */
export const rowDecisionSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create"),
    rowNumber: positionSchema,
    corrections: z.array(rowCorrectionInputSchema).optional(),
  }),
  z.strictObject({
    kind: z.literal("reuse"),
    rowNumber: positionSchema,
    candidate: matchReferenceSchema,
    corrections: z.array(rowCorrectionInputSchema).optional(),
  }),
  z.strictObject({
    kind: z.literal("skip"),
    rowNumber: positionSchema,
    reason: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("unresolved"),
    rowNumber: positionSchema,
  }),
]);
/** The `setRowDecision` payload: one closed decision about one row, and nothing around it. */
export const setRowDecisionPayloadSchema: z.ZodType<SetRowDecisionPayload> = rowDecisionSchema;
/** The validated `setRowDecision` payload: the domain's own client decision union. */
export type SetRowDecisionPayload = ImportDecisionInput;
/** The `acceptImportRows` payload: the worker's explicit acknowledgement, the fingerprint of the file they reviewed, and the decisions snapshot they reviewed it with. */
export const acceptImportRowsPayloadSchema: z.ZodType<AcceptImportRowsPayload> = z.strictObject({
  acknowledged: z.literal(true, { error: "Confirm the acceptance explicitly." }),
  fileFingerprint: z.string().min(1, {
    error: "fileFingerprint must carry the fingerprint reported for the file you reviewed.",
  }),
  decisions: z
    .array(rowDecisionSchema)
    .min(1, { error: "Review at least one row decision before accepting." })
    // The import module's own row limit, so the snapshot and the file it describes cannot drift apart.
    .max(IMPORT_MAX_DATA_ROWS, {
      error: "A reviewed snapshot holds at most one decision per data row the import accepts.",
    }),
});
/** The validated `acceptImportRows` payload. */
export type AcceptImportRowsPayload = {
  readonly acknowledged: true;
  readonly fileFingerprint: string;
  readonly decisions: readonly ImportDecisionInput[];
};
/** The `cancelImport` payload: nothing beyond the shared envelope. */
export const cancelImportPayloadSchema: z.ZodType<CancelImportPayload> = z.strictObject({});
/** The validated `cancelImport` payload: an empty object, so `MutationInput<CancelImportPayload>` types. */
export type CancelImportPayload = Record<string, never>;
// The working record this file owns, beside the proposal record the reads project
interface ImportReviewRecord {
  readonly importOperationId: string;
  readonly scope: Scope;
  readonly fileName: string;
  readonly byteLength: number;
  readonly text: string;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly columnCount: number;
  readonly mapping: ImportConfirmedMapping | null;
  readonly decisions: ImportDecisionSet | null;
  readonly processedAt: string | null;
  readonly cancelledAt: string | null;
  readonly receipt: unknown;
}
const importReviewRecordSchema: z.ZodType<ImportReviewRecord> = z.object({
  importOperationId: z.string().min(1),
  scope: scopeSchema,
  fileName: z.string().min(1),
  byteLength: z.int().nonnegative(),
  text: z.string(),
  headers: z.array(z.string()),
  rowCount: z.int().nonnegative(),
  columnCount: z.int().nonnegative(),
  mapping: confirmedMappingSchema.nullable(),
  decisions: decisionSetSchema.nullable(),
  processedAt: z.string().min(1).nullable(),
  cancelledAt: z.string().min(1).nullable(),
  receipt: z.unknown().nullable(),
});
interface ImportState {
  readonly document: Record<string, unknown>;
  readonly proposals: readonly ImportProposalRecord[];
  readonly reviews: readonly ImportReviewRecord[];
  readonly partners: readonly PartnerRecord[];
}
type ImportStateRead = { readonly ok: true; readonly state: ImportState } | { readonly ok: false };

function readImportState(value: unknown): ImportStateRead {
  if (!isRecord(value)) {
    return { ok: false };
  }
  const proposals = z.array(importProposalRecordSchema).safeParse(value["importProposals"]);
  if (!proposals.success) {
    return { ok: false };
  }
  const storedReviews: unknown = value["importReviews"];
  const reviews = storedReviews === undefined ? null : z.array(importReviewRecordSchema).safeParse(storedReviews);
  if (reviews !== null && !reviews.success) {
    return { ok: false };
  }
  const partners = z.array(partnerRecordSchema).safeParse(value["partners"]);
  if (!partners.success) {
    return { ok: false };
  }
  const read: ImportReviewRecord[] = reviews === null ? [] : [...reviews.data];
  // The review's own counts index its rows, so a document whose counts disagree with its headers is
  // internally inconsistent and cannot be trusted to number a row correctly.
  if (read.some((review) => !reviewIsConsistent(review))) {
    return { ok: false };
  }
  return {
    ok: true,
    state: {
      document: value,
      proposals: proposals.data,
      reviews: read,
      partners: partners.data,
    },
  };
}
function reviewIsConsistent(review: ImportReviewRecord): boolean {
  if (review.headers.length !== review.columnCount) {
    return false;
  }
  const decisions = review.decisions;
  return decisions === null || decisions.fingerprint.dataRowCount === review.rowCount;
}
function stateAfter(
  state: ImportState,
  next: {
    readonly proposals?: readonly ImportProposalRecord[];
    readonly reviews?: readonly ImportReviewRecord[];
    readonly partners?: readonly PartnerRecord[];
  },
): Record<string, unknown> {
  return {
    ...state.document,
    importProposals: next.proposals ?? state.proposals,
    importReviews: next.reviews ?? state.reviews,
    partners: next.partners ?? state.partners,
  };
}
interface StoredImport {
  readonly review: ImportReviewRecord;
  readonly proposal: ImportProposalRecord;
}
function latestImportIn(state: ImportState, scope: Scope, options: { readonly inFlightOnly?: boolean } = {}): StoredImport | null {
  for (let index = state.reviews.length - 1; index >= 0; index -= 1) {
    const review = state.reviews[index];
    if (review === undefined || !sameScope(review.scope, scope)) {
      continue;
    }
    const proposal = state.proposals.find((candidate) => candidate.importOperationId === review.importOperationId);
    if (proposal === undefined) {
      continue;
    }
    if (options.inFlightOnly === true && proposal.processedAt !== null) {
      continue;
    }
    return { review, proposal };
  }
  return null;
}
// Small shared helpers: revisions, stored results, refusals, identity
const FIRST_REVISION = "rev-1";

const REVISION_PATTERN = /^rev-([0-9]+)$/;

function nextRevision(current: string): string {
  const matched = REVISION_PATTERN.exec(current);
  if (matched === null) {
    return FIRST_REVISION;
  }
  const counter = Number(matched[1] ?? "0") + 1;
  return Number.isFinite(counter) && counter > 0 ? `rev-${String(counter)}` : FIRST_REVISION;
}
function storedResult(value: unknown): MutationResult {
  return JSON.parse(JSON.stringify(value)) as MutationResult;
}
type ImportMutationRefusal =
  | { readonly kind: "invalid"; readonly fields: FieldMessages }
  | { readonly kind: "denied"; readonly reasonCode: DenialReason }
  | { readonly kind: "unavailable"; readonly reference: string; readonly guidance: string };
function invalidField(field: string, message: string): ImportMutationRefusal {
  return { kind: "invalid", fields: { [field]: [message] } };
}
function refusalOutcome(operationId: string, refusal: ImportMutationRefusal): MutationOutcome {
  switch (refusal.kind) {
    case "invalid":
      return invalid({ operationId, fields: refusal.fields });
    case "denied":
      return denied({ operationId, reasonCode: refusal.reasonCode });
    case "unavailable":
      return unavailable({
        operationId,
        source: { system: LOCAL_STORE_SYSTEM, reference: refusal.reference },
        guidance: refusal.guidance,
      });
    default:
      return assertNever(refusal, "import mutation refusal");
  }
}
function answerFor(outcome: MutationOutcome, refusal: ImportMutationRefusal | null, operationId: string): MutationOutcome {
  if (refusal === null || outcome.outcome !== "unchanged") {
    return outcome;
  }
  return refusalOutcome(operationId, refusal);
}
const IMPORT_SOURCE_REFERENCE = "contact-import";

const STATE_UNAVAILABLE_GUIDANCE =
  "This session's import record cannot be read as this build records it, so nothing was changed. Reload the page; if it stays unreadable, reset the development seed from Settings and start the import again. Nothing that was already accepted is affected.";
const TEXT_UNAVAILABLE_GUIDANCE =
  "The file text this import kept can no longer be read as the CSV it was admitted as, so nothing was changed. Start the import again with the same file; contacts an earlier acceptance created stay exactly where they are.";
const RECEIPT_UNAVAILABLE_GUIDANCE =
  "This import's recorded receipt cannot be read, so an acceptance could not tell which rows it already applied and nothing was changed. Read the operation's result again rather than repeating the import: rows it already accepted are recorded under its operation identity.";
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

function attemptIdOf(input: unknown): string {
  if (!isRecord(input)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const candidate: unknown = input["operationId"];
  return isNonEmptyString(candidate) ? candidate : UNIDENTIFIED_ATTEMPT;
}
type ImportSessionAuthority = { readonly ok: true; readonly sessionId: string } | { readonly ok: false; readonly outcome: MutationOutcome };

async function importSessionAuthority(source: SessionSource | undefined, operationId: string): Promise<ImportSessionAuthority> {
  try {
    const resolution = await resolveSession(source);
    return resolution.ok ? { ok: true, sessionId: resolution.session.sessionId } : { ok: false, outcome: outcomeOfRefusal(resolution.refusal, operationId) };
  } catch {
    return { ok: false, outcome: denied({ operationId, reasonCode: "session-unavailable" }) };
  }
}
function preparationAuthority(session: ResolvedSession, scope: Scope): ScopeDecision {
  const decision = canEdit(session, {
    kind: "partner",
    scope,
    audience: "private",
    authorPrincipalId: session.principalId,
  });
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}
function decodeContent(value: string): Uint8Array | null {
  if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? new Uint8Array(decoded) : null;
}
function fileRefusalOn(refusals: readonly ImportRefusal[]): ImportMutationRefusal {
  const messages = refusals.map((refusal) => refusal.message);
  return {
    kind: "invalid",
    fields: {
      contentBase64: messages.length > 0 ? messages : ["This file could not be read as CSV."],
    },
  };
}
function candidatesOf(partners: readonly PartnerRecord[]): readonly ImportMatchCandidate[] {
  return partners.map((partner) => ({
    reference: { system: LOCAL_STORE_SYSTEM, reference: partner.partnerId },
    visibleFields: CANDIDATE_FIELDS,
    visibleValues: visibleValuesOf(partner),
    reuse: { permitted: true },
  }));
}
const CANDIDATE_FIELDS: readonly ImportFieldId[] = [...IMPORT_FIELD_IDS];

function visibleValuesOf(partner: PartnerRecord): Readonly<Partial<Record<ImportFieldId, readonly string[]>>> {
  const values: Partial<Record<ImportFieldId, string[]>> = {
    "display-name": [partner.displayName],
    restriction: partner.restrictions.map((restriction) => restriction.detail),
    tag: [...partner.tags],
  };
  if (partner.kind === "organization" || partner.kind === "church") {
    values["name-organization"] = [partner.displayName];
  }
  const given = partner.nameParts?.given;
  if (given !== null && given !== undefined) {
    values["name-given"] = [given];
  }
  const family = partner.nameParts?.family;
  if (family !== null && family !== undefined) {
    values["name-family"] = [family];
  }
  const source = partner.source;
  if (source !== null) {
    values["source-reference"] = [source.reference];
  }
  for (const method of partner.contactMethods) {
    const fieldId: ImportFieldId = method.kind === "email" ? "contact-email" : method.kind === "phone" ? "contact-phone" : "contact-postal";
    const existing = values[fieldId];
    if (existing === undefined) {
      values[fieldId] = [method.value];
    } else {
      existing.push(method.value);
    }
  }
  return values;
}
// The declared projection: the proposal record the import reads parse
interface ProposalProjection {
  readonly importOperationId: string;
  readonly revision: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly fingerprint: ImportFileFingerprint;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly columnCount: number;
  readonly mapping: ImportConfirmedMapping | null;
  readonly decisions: ImportDecisionSet | null;
  readonly summary: ImportSummaryRecord;
  readonly results: readonly ImportRowResultRecord[];
  readonly processedAt: string | null;
}
const NAME_FIELDS: readonly ImportFieldId[] = ["display-name", "name-given", "name-family", "name-organization"];

function proposalRecordOf(projection: ProposalProjection): ImportProposalRecord {
  return {
    importOperationId: projection.importOperationId,
    fileMeta: {
      name: projection.fileName,
      bytes: projection.byteLength,
      rowCount: projection.rowCount,
      columnCount: projection.columnCount,
    },
    // The fingerprint of the text this import parsed, stated once with the file it describes: it is what
    // an acceptance carries back, so the file the worker reviewed is the one the acceptance names.
    fingerprint: { ...projection.fingerprint },
    mapping: mappingRecordsOf(projection.headers, projection.columnCount, projection.mapping),
    rowDecisions: rowDecisionRecordsOf(projection.decisions),
    summary: projection.summary,
    results: projection.results,
    processedAt: projection.processedAt,
    revision: projection.revision,
  };
}
function mappingRecordsOf(headers: readonly string[], columnCount: number, mapping: ImportConfirmedMapping | null): readonly ImportColumnAssignmentRecord[] {
  if (mapping === null) {
    return [];
  }
  const fieldByColumn = new Map<number, ImportFieldId>();
  for (const assignment of mapping.assignments) {
    fieldByColumn.set(assignment.columnIndex, assignment.fieldId);
  }
  const records: ImportColumnAssignmentRecord[] = [];
  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    const header = (headers[columnIndex - 1] ?? "").trim();
    records.push({
      columnIndex,
      header: header.length > 0 ? header : `Column ${String(columnIndex)}`,
      field: fieldByColumn.get(columnIndex) ?? null,
    });
  }
  return records;
}
function summaryRecordOf(summary: ImportDecisionSummary | null, rowCount: number): ImportSummaryRecord {
  if (summary === null) {
    return { newEntries: 0, reusedIdentities: 0, skipped: 0, needsReview: rowCount };
  }
  return {
    newEntries: summary.counts.create,
    reusedIdentities: summary.counts.reuse,
    skipped: summary.counts.skip,
    // A row is reviewed once however many reasons it carries: a row that is both undecided and still
    // blocked is one row awaiting a decision, so the count can never exceed the rows the file holds.
    needsReview: summary.rows.filter((row) => row.decisionKind === "unresolved" || row.blockedReasons.length > 0).length,
  };
}
function rowDecisionRecordsOf(set: ImportDecisionSet | null): readonly ImportRowDecisionRecord[] {
  if (set === null) {
    return [];
  }
  return set.decisions.map((decision) => ({
    rowNumber: decision.rowNumber,
    decision: storedDecisionOf(decision),
    // The candidate reference's `reference` is the partner identifier the suggestion was built from:
    // this import offers only identities this store holds, so the route is that record.
    targetPartnerId: decision.kind === "reuse" ? decision.candidate.reference : null,
    // The corrections as the review step received them, so the decision a read publishes can be posted
    // back as the acceptance it was reviewed as.
    corrections: decision.kind === "create" || decision.kind === "reuse" ? decision.corrections.map((correction) => ({ columnNumber: correction.columnNumber, value: correction.value })) : [],
    candidate: decision.kind === "reuse" ? { ...decision.candidate } : null,
    reason: decision.kind === "skip" ? decision.workerReason : null,
  }));
}
function storedDecisionOf(decision: RecordedRowDecision): StoredRowDecision {
  switch (decision.kind) {
    case "create":
      return "new-private-entry";
    case "reuse":
      return "reuse-authorized-identity";
    case "skip":
      return "skip";
    case "unresolved":
      return "unresolved";
    default:
      return assertNever(decision, "import row decision");
  }
}
function rowResultRecordsOf(receipt: ImportReceipt): readonly ImportRowResultRecord[] {
  return receipt.results.map((result) => ({
    rowNumber: result.rowNumber,
    state: result.state,
    partnerId: result.route !== null && result.route.kind === "partner" ? result.route.partnerRef.reference : null,
    message: result.reason,
  }));
}
function mappingDecisionsOf(mapping: ImportConfirmedMapping): readonly ImportMappingDecision[] {
  const columnsByField = new Map<ImportFieldId, number[]>();
  for (const assignment of mapping.assignments) {
    const existing = columnsByField.get(assignment.fieldId);
    if (existing === undefined) {
      columnsByField.set(assignment.fieldId, [assignment.columnIndex]);
    } else {
      existing.push(assignment.columnIndex);
    }
  }
  const decisions: ImportMappingDecision[] = [];
  for (const fieldId of IMPORT_FIELD_IDS) {
    const columnIndexes = columnsByField.get(fieldId);
    if (columnIndexes !== undefined) {
      decisions.push({ kind: "choose", fieldId, columnIndexes });
      continue;
    }
    if (mapping.declined.includes(fieldId)) {
      decisions.push({ kind: "decline", fieldId });
    }
  }
  return decisions;
}
function mappingSuppliesName(mapping: ImportConfirmedMapping): boolean {
  return mapping.fields.some((fieldId) => NAME_FIELDS.includes(fieldId));
}
function sameMappingRecords(left: readonly ImportColumnAssignmentRecord[], right: readonly ImportColumnAssignmentRecord[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((column, index) => {
    const other = right[index];
    return other !== undefined && other.columnIndex === column.columnIndex && other.header === column.header && other.field === column.field;
  });
}
function decisionsFor(file: ParsedCsvFile, previous: StoredImport | null, mappingRecords: readonly ImportColumnAssignmentRecord[]): ImportDecisionSet {
  if (previous !== null && previous.review.decisions !== null && sameMappingRecords(previous.proposal.mapping, mappingRecords)) {
    return previous.review.decisions;
  }
  return createDecisionSet(file);
}
// The private preparation entry an accepted row becomes
function valuesByField(row: ImportValidatedRow, decision: RecordedRowDecision | null): ReadonlyMap<ImportFieldId, readonly string[]> {
  const byColumn = new Map<number, { readonly fieldId: ImportFieldId; readonly value: string }>();
  for (const cell of row.mappedCells) {
    byColumn.set(cell.columnNumber, { fieldId: cell.fieldId, value: cell.value.trim() });
  }
  // A correction is the worker's own replacement for the cell at that position, so it stands where the
  // cell did: the field came from the mapping, and the replacement text is used exactly as typed.
  if (decision !== null && (decision.kind === "create" || decision.kind === "reuse")) {
    for (const correction of decision.corrections) {
      const existing = byColumn.get(correction.columnNumber);
      byColumn.set(correction.columnNumber, {
        fieldId: existing?.fieldId ?? correction.fieldId,
        value: correction.value.trim(),
      });
    }
  }
  const values = new Map<ImportFieldId, string[]>();
  for (const columnNumber of [...byColumn.keys()].sort((left, right) => left - right)) {
    const entry = byColumn.get(columnNumber);
    if (entry === undefined || entry.value.length === 0) {
      continue;
    }
    const collected = values.get(entry.fieldId);
    if (collected === undefined) {
      values.set(entry.fieldId, [entry.value]);
    } else if (!collected.includes(entry.value)) {
      collected.push(entry.value);
    }
  }
  return values;
}
function firstValue(values: ReadonlyMap<ImportFieldId, readonly string[]>, fieldId: ImportFieldId): string | null {
  const [first] = values.get(fieldId) ?? [];
  return first === undefined || first.length === 0 ? null : first;
}
function displayNameOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): string {
  const displayName = firstValue(values, "display-name");
  if (displayName !== null) {
    return displayName;
  }
  const given = firstValue(values, "name-given");
  const family = firstValue(values, "name-family");
  const composed = [given, family]
    .filter((part): part is string => part !== null)
    .join(" ")
    .trim();
  if (composed.length > 0) {
    return composed;
  }
  return firstValue(values, "name-organization") ?? "";
}
function namePartsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): PartnerNameParts | null {
  const given = firstValue(values, "name-given");
  const family = firstValue(values, "name-family");
  if (given === null && family === null) {
    return null;
  }
  return { given, family, additional: [] };
}
function contactMethodsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): readonly PartnerContactMethod[] {
  const methods: PartnerContactMethod[] = [];
  const seen = new Set<string>();
  const fields: readonly {
    readonly fieldId: ImportFieldId;
    readonly kind: "email" | "phone" | "postal";
  }[] = [
    { fieldId: "contact-email", kind: "email" },
    { fieldId: "contact-phone", kind: "phone" },
    { fieldId: "contact-postal", kind: "postal" },
  ];
  for (const field of fields) {
    for (const value of values.get(field.fieldId) ?? []) {
      const key = `${field.kind}\u0000${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      // `permitted` is contactability, which an imported row never withdraws: a restriction the file
      // stated is carried verbatim below and is never interpreted into a channel's permission.
      methods.push({ kind: field.kind, value, permitted: true, verified: false });
    }
  }
  return methods;
}
function restrictionsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): readonly PartnerRestriction[] {
  return (values.get("restriction") ?? []).map((detail) => ({
    kind: "imported-restriction",
    detail,
  }));
}
function tagsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): readonly string[] {
  return [...(values.get("tag") ?? [])];
}
function sourceForRow(decision: RecordedRowDecision, values: ReadonlyMap<ImportFieldId, readonly string[]>): SourceReference | null {
  if (decision.kind === "reuse") {
    return { system: LOCAL_STORE_SYSTEM, reference: decision.candidate.reference };
  }
  const imported = firstValue(values, "source-reference");
  return imported === null ? null : { system: IMPORT_SOURCE_REFERENCE, reference: imported };
}
function partnerFromRow(input: {
  readonly partnerId: string;
  readonly displayName: string;
  readonly values: ReadonlyMap<ImportFieldId, readonly string[]>;
  readonly source: SourceReference | null;
}): PartnerRecord {
  return {
    partnerId: input.partnerId,
    kind: "private-preparation",
    displayName: input.displayName,
    nameParts: namePartsOf(input.values),
    contactMethods: contactMethodsOf(input.values),
    restrictions: restrictionsOf(input.values),
    tags: tagsOf(input.values),
    favourite: false,
    stage: null,
    audience: "private",
    revision: FIRST_REVISION,
    source: input.source,
  };
}
function partnerIdFor(importOperationId: string, rowNumber: number): string {
  return `partner-import-${importOperationId}-${String(rowNumber)}`;
}
type StoredReceiptRead = { readonly kind: "none" } | { readonly kind: "receipt"; readonly receipt: ImportReceipt } | { readonly kind: "unreadable" };

function storedReceiptOf(review: ImportReviewRecord): StoredReceiptRead {
  const stored = review.receipt;
  if (stored === null) {
    return { kind: "none" };
  }
  const identity = isRecord(stored) ? stored["importOperationId"] : undefined;
  if (!isNonEmptyString(identity)) {
    return { kind: "unreadable" };
  }
  const read = readStoredReceipt(stored, identity);
  return read.kind === "found" ? { kind: "receipt", receipt: read.receipt } : { kind: "unreadable" };
}
function appliedRowsOf(receipt: ImportReceipt): ReadonlyMap<number, ImportMatchReference> {
  const applied = new Map<number, ImportMatchReference>();
  for (const result of receipt.results) {
    if (result.state !== "accepted" && result.state !== "already-accepted") {
      continue;
    }
    if (result.route === null || result.route.kind !== "partner") {
      continue;
    }
    if (!applied.has(result.rowNumber)) {
      applied.set(result.rowNumber, { ...result.route.partnerRef });
    }
  }
  return applied;
}
function decisionRefusal(refusal: ImportDecisionRefusal): ImportMutationRefusal {
  if (refusal.code === "no-reusable-candidate" || refusal.code === "candidate-not-suggested") {
    return { kind: "denied", reasonCode: "no-permission" };
  }
  const field = refusal.rowNumber === null ? ROOT_FIELD_KEY : "rowNumber";
  return invalidField(field, refusal.message);
}
function carriedFingerprintRefusal(carried: string, current: ImportFileFingerprint, recorded: ImportFileFingerprint | null): ImportMutationRefusal | null {
  if (carried === current.checksum || carried === recorded?.checksum) {
    return null;
  }
  const separator = current.checksum.lastIndexOf("-");
  const tag = separator <= 0 ? null : current.checksum.slice(0, separator + 1);
  if (tag === null || !carried.startsWith(tag)) {
    return null;
  }
  return invalidField(
    "fileFingerprint",
    "This fingerprint belongs to a different version of the file than the one this import holds, so nothing was accepted. Choose the file again and review its rows: the file you are accepting has to be the file that was mapped and validated.",
  );
}
function stateUnavailable(): ImportMutationRefusal {
  return {
    kind: "unavailable",
    reference: IMPORT_SOURCE_REFERENCE,
    guidance: STATE_UNAVAILABLE_GUIDANCE,
  };
}
const NOT_CHANGED: { readonly changed: false } = { changed: false };

const NO_TARGET: CurrentTarget = { kind: "absent" };
// proposeImport
/** Proposes an import from a chosen file: the limits enforced before anything is processed, the file typed by its content, the mapping suggested column by column, and — on the journey's second. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function proposeImport(input: MutationInput<ProposeImportPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const authority = await importSessionAuthority(session, operationId);
  if (!authority.ok) {
    return authority.outcome;
  }
  let refusal: ImportMutationRefusal | null = null;
  const outcome = await runMutation<ProposeImportPayload, MutationResult>({
    sessionId: authority.sessionId,
    input,
    schema: proposeImportPayloadSchema,
    name: "proposeImport",
    authorize: (resolved) => preparationAuthority(resolved, input.scope),
    // No revision is compared here, and that is deliberate rather than an omission. This mutation does
    // not change a record in place: it starts a review, continues the review of the same file, or
    // replaces a review whose file has changed — and a review it replaces was never applied, so there is
    // no stored value a stale expectation could overwrite. The payload carries the file itself, which is
    // the only fact that could make this call stale, and a changed file is refused or reopened as a
    // fresh review rather than applied to the one it replaced. The three steps that do change a stored
    // review — a decision, an acceptance and a cancellation — each compare the revision the caller saw.
    apply: async (context) => {
      const read = readImportState(context.docs.state);
      if (!read.ok) {
        refusal = stateUnavailable();
        return NOT_CHANGED;
      }
      const state = read.state;
      const payload = input.payload;
      const bytes = decodeContent(payload.contentBase64);
      if (bytes === null) {
        refusal = invalidField("contentBase64", "This file's content is not valid base64, so it could not be read as the file that was chosen. Choose the file again.");
        return NOT_CHANGED;
      }
      // Every displayed limit, the workbook signature and the UTF-8 check are decided on these bytes,
      // before a single row is read: a refusal names the limit and the value it measured.
      const admitted = await checkLimits(bytes, payload.fileName);
      if (!admitted.ok) {
        refusal = fileRefusalOn(admitted.refusals);
        return NOT_CHANGED;
      }
      const parsed = await parseCsv(admitted.file.text);
      if (!parsed.ok) {
        refusal = fileRefusalOn(parsed.refusals);
        return NOT_CHANGED;
      }
      const file = parsed.file;
      const text = admitted.file.text;
      let mapping: ImportConfirmedMapping | null = null;
      if (payload.confirmedMapping !== undefined) {
        // The mapping the worker confirmed is re-derived through the domain's own check against the
        // suggestion recomputed from this file, so a position the file does not have, a column shared by
        // two fields or a column that may never be mapped is refused with its own reason.
        const confirmed = confirmMapping(suggestMapping(file), mappingDecisionsOf(payload.confirmedMapping));
        if (!confirmed.ok) {
          refusal = {
            kind: "invalid",
            fields: { confirmedMapping: confirmed.refusals.map((entry) => entry.message) },
          };
          return NOT_CHANGED;
        }
        mapping = confirmed.mapping;
        if (!mappingSuppliesName(mapping)) {
          refusal = invalidField(
            "confirmedMapping",
            "This mapping supplies no column that names a contact, so nothing could be created from the file. Map a display name, or a given and family name, or an organization name.",
          );
          return NOT_CHANGED;
        }
      }
      const open = latestImportIn(state, input.scope, { inFlightOnly: true });
      // Confirming the mapping of the file already in flight continues that import under its own
      // identity; choosing another file supersedes it, because a changed file requires fresh review and
      // nothing of an unaccepted review was ever applied.
      const previous = open !== null && open.review.text === text ? open : null;
      const importOperationId = previous === null ? operationId : previous.review.importOperationId;
      const revision = previous === null ? FIRST_REVISION : nextRevision(previous.proposal.revision);
      let decisions: ImportDecisionSet | null = null;
      let summary: ImportDecisionSummary | null = null;
      if (mapping !== null) {
        const confirmedMapping = mapping;
        const recorded = decisionsFor(file, previous, mappingRecordsOf(file.headers, file.columnCount, confirmedMapping));
        const validation = validateRows(file, confirmedMapping);
        const summarised = summariseDecisions(recorded, {
          file,
          mapping: confirmedMapping,
          validation,
          candidates: candidatesOf(state.partners),
        });
        if (!summarised.ok) {
          refusal = invalidField("confirmedMapping", summarised.refusal.message);
          return NOT_CHANGED;
        }
        decisions = recorded;
        summary = summarised.summary;
      }
      const proposal = proposalRecordOf({
        importOperationId,
        revision,
        fileName: payload.fileName,
        byteLength: admitted.file.byteLength,
        fingerprint: fingerprintOf(file),
        headers: file.headers,
        rowCount: file.dataRowCount,
        columnCount: file.columnCount,
        mapping,
        decisions,
        summary: summaryRecordOf(summary, file.dataRowCount),
        results: [],
        processedAt: null,
      });
      const review: ImportReviewRecord = {
        importOperationId,
        scope: input.scope,
        fileName: payload.fileName,
        byteLength: admitted.file.byteLength,
        text,
        headers: [...file.headers],
        rowCount: file.dataRowCount,
        columnCount: file.columnCount,
        mapping,
        decisions,
        processedAt: null,
        cancelledAt: null,
        receipt: null,
      };
      const supersededId = open === null ? null : open.review.importOperationId;
      const dropped = (candidate: { readonly importOperationId: string }): boolean => candidate.importOperationId === importOperationId || candidate.importOperationId === supersededId;
      context.docs.state = stateAfter(state, {
        proposals: [...state.proposals.filter((entry) => !dropped(entry)), proposal],
        reviews: [...state.reviews.filter((entry) => !dropped(entry)), review],
      });
      return {
        changed: true,
        revision,
        result: storedResult(proposal),
        created: [importOperationId],
      };
    },
  });
  return answerFor(outcome, refusal, operationId);
}
// setRowDecision
/** Records one worker's decision about one row of the import in progress. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function setRowDecision(input: MutationInput<SetRowDecisionPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const authority = await importSessionAuthority(session, operationId);
  if (!authority.ok) {
    return authority.outcome;
  }
  let refusal: ImportMutationRefusal | null = null;
  const outcome = await runMutation<SetRowDecisionPayload, MutationResult>({
    sessionId: authority.sessionId,
    input,
    schema: setRowDecisionPayloadSchema,
    name: "setRowDecision",
    authorize: (resolved) => preparationAuthority(resolved, input.scope),
    // The import itself is the record this change lands in, so the revision the caller reviewed is
    // compared with it: a decision taken against a superseded review is a conflict, not a silent
    // application to a file the worker has not seen.
    readCurrent: (docs) => {
      const read = readImportState(docs.state);
      if (!read.ok) {
        return NO_TARGET;
      }
      const stored = latestImportIn(read.state, input.scope);
      return stored === null ? NO_TARGET : { kind: "record", revision: stored.proposal.revision, value: stored.proposal };
    },
    apply: async (context) => {
      const read = readImportState(context.docs.state);
      if (!read.ok) {
        refusal = stateUnavailable();
        return NOT_CHANGED;
      }
      const state = read.state;
      const stored = latestImportIn(state, input.scope);
      if (stored === null) {
        refusal = invalidField(ROOT_FIELD_KEY, "No import is in progress in this context, so there is no row to decide about. Choose a file and map its columns first.");
        return NOT_CHANGED;
      }
      if (stored.proposal.processedAt !== null) {
        refusal = invalidField(ROOT_FIELD_KEY, "This import has already been accepted or cancelled, so its row decisions can no longer change. Start a new import to decide about these rows again.");
        return NOT_CHANGED;
      }
      const confirmedMapping = stored.review.mapping;
      if (confirmedMapping === null) {
        refusal = invalidField(ROOT_FIELD_KEY, "No column mapping is confirmed for this import yet, so no row can be decided about. Confirm the mapping first.");
        return NOT_CHANGED;
      }
      const parsed = await parseCsv(stored.review.text);
      if (!parsed.ok) {
        refusal = {
          kind: "unavailable",
          reference: "stored-import-text",
          guidance: TEXT_UNAVAILABLE_GUIDANCE,
        };
        return NOT_CHANGED;
      }
      const file = parsed.file;
      const validation = validateRows(file, confirmedMapping);
      const candidates = candidatesOf(state.partners);
      const recorded = recordDecision(stored.review.decisions ?? createDecisionSet(file), input.payload, { file, mapping: confirmedMapping, validation, candidates });
      if (!recorded.ok) {
        refusal = decisionRefusal(recorded.refusal);
        return NOT_CHANGED;
      }
      if (!recorded.changed) {
        // The same decision recorded again is a replay of the worker's own answer: nothing is written,
        // no revision advances and no history entry is made.
        return NOT_CHANGED;
      }
      const summarised = summariseDecisions(recorded.set, {
        file,
        mapping: confirmedMapping,
        validation,
        candidates,
      });
      if (!summarised.ok) {
        refusal = invalidField("rowNumber", summarised.refusal.message);
        return NOT_CHANGED;
      }
      const revision = nextRevision(stored.proposal.revision);
      const proposal = proposalRecordOf({
        importOperationId: stored.proposal.importOperationId,
        revision,
        fileName: stored.review.fileName,
        byteLength: stored.review.byteLength,
        // The fingerprint describes the stored text, which this import never rewrites, so carrying the
        // recorded one keeps the proposal's file identity stable across its decisions.
        fingerprint: stored.proposal.fingerprint,
        headers: stored.review.headers,
        rowCount: stored.review.rowCount,
        columnCount: stored.review.columnCount,
        mapping: confirmedMapping,
        decisions: recorded.set,
        summary: summaryRecordOf(summarised.summary, stored.review.rowCount),
        results: stored.proposal.results,
        processedAt: stored.proposal.processedAt,
      });
      const review: ImportReviewRecord = { ...stored.review, decisions: recorded.set };
      context.docs.state = stateAfter(state, {
        proposals: state.proposals.map((entry) => (entry.importOperationId === proposal.importOperationId ? proposal : entry)),
        reviews: state.reviews.map((entry) => (entry.importOperationId === review.importOperationId ? review : entry)),
      });
      return {
        changed: true,
        revision,
        result: storedResult(proposal),
        changedIds: [proposal.importOperationId],
      };
    },
  });
  return answerFor(outcome, refusal, operationId);
}
// acceptImportRows
/** Accepts the reviewed rows of the import in progress: the recorded snapshot is re-checked row by row at execute time, only the eligible ones are applied, and the receipt of what happened is. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function acceptImportRows(input: MutationInput<AcceptImportRowsPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const authority = await importSessionAuthority(session, operationId);
  if (!authority.ok) {
    return authority.outcome;
  }
  let refusal: ImportMutationRefusal | null = null;
  const outcome = await runMutation<AcceptImportRowsPayload, MutationResult>({
    sessionId: authority.sessionId,
    input,
    schema: acceptImportRowsPayloadSchema,
    name: "acceptImportRows",
    authorize: (resolved) => preparationAuthority(resolved, input.scope),
    readCurrent: (docs) => {
      const read = readImportState(docs.state);
      if (!read.ok) {
        return NO_TARGET;
      }
      const stored = latestImportIn(read.state, input.scope);
      return stored === null ? NO_TARGET : { kind: "record", revision: stored.proposal.revision, value: stored.proposal };
    },
    apply: async (context) => {
      const read = readImportState(context.docs.state);
      if (!read.ok) {
        refusal = stateUnavailable();
        return NOT_CHANGED;
      }
      const state = read.state;
      const stored = latestImportIn(state, input.scope);
      if (stored === null) {
        refusal = invalidField(ROOT_FIELD_KEY, "No import is in progress in this context, so there is nothing to accept. Choose a file, map its columns and decide about its rows first.");
        return NOT_CHANGED;
      }
      const review = stored.review;
      const confirmedMapping = review.mapping;
      if (confirmedMapping === null) {
        refusal = invalidField("confirmedMapping", "No column mapping is confirmed for this import, so no row could be applied. Map the columns and review the rows before accepting.");
        return NOT_CHANGED;
      }
      // A receipt that cannot be read would leave this acceptance unable to tell which rows an earlier
      // attempt already applied, so it stops here rather than creating a second contact.
      const prior = storedReceiptOf(review);
      if (prior.kind === "unreadable") {
        refusal = {
          kind: "unavailable",
          reference: "import-receipt",
          guidance: RECEIPT_UNAVAILABLE_GUIDANCE,
        };
        return NOT_CHANGED;
      }
      const parsed = await parseCsv(review.text);
      if (!parsed.ok) {
        refusal = {
          kind: "unavailable",
          reference: "stored-import-text",
          guidance: TEXT_UNAVAILABLE_GUIDANCE,
        };
        return NOT_CHANGED;
      }
      const file = parsed.file;
      const fingerprint = fingerprintOf(file);
      const carried = carriedFingerprintRefusal(input.payload.fileFingerprint, fingerprint, review.decisions?.fingerprint ?? null);
      if (carried !== null) {
        refusal = carried;
        return NOT_CHANGED;
      }
      const validation = validateRows(file, confirmedMapping);
      const candidates = candidatesOf(state.partners);
      // The reviewed snapshot is the intent, and every decision in it is validated by the domain before
      // anything is applied: a decision that cannot stand refuses the whole acceptance, because applying
      // the rest would create contacts from a review the worker cannot see the whole of.
      let set = review.decisions ?? createDecisionSet(file);
      for (const decisionInput of input.payload.decisions) {
        const recorded = recordDecision(set, decisionInput, {
          file,
          mapping: confirmedMapping,
          validation,
          candidates,
        });
        if (!recorded.ok) {
          refusal = decisionRefusal(recorded.refusal);
          return NOT_CHANGED;
        }
        if (recorded.changed) {
          set = recorded.set;
        }
      }
      const summarised = summariseDecisions(set, {
        file,
        mapping: confirmedMapping,
        validation,
        candidates,
      });
      if (!summarised.ok) {
        refusal = invalidField(ROOT_FIELD_KEY, summarised.refusal.message);
        return NOT_CHANGED;
      }
      const summary = summarised.summary;
      // Eligibility is re-checked here, per row, against the state as it stands now: a row already
      // applied by an earlier attempt keeps the record it became, a row that is skipped or still blocked
      // is reported as such, and a reuse whose identity is no longer offered is blocked rather than
      // merged.
      const alreadyApplied = prior.kind === "receipt" ? appliedRowsOf(prior.receipt) : new Map<number, ImportMatchReference>();
      const validatedByRow = new Map<number, ImportValidatedRow>();
      for (const row of validation.rows) {
        validatedByRow.set(row.rowNumber, row);
      }
      const decisionByRow = new Map<number, RecordedRowDecision>();
      for (const decision of set.decisions) {
        decisionByRow.set(decision.rowNumber, decision);
      }
      const knownPartnerIds = new Set(state.partners.map((partner) => partner.partnerId));
      const applications: ImportRowApplication[] = [];
      const createdPartners: PartnerRecord[] = [];
      for (const row of summary.rows) {
        const applied = alreadyApplied.get(row.rowNumber);
        if (applied !== undefined) {
          applications.push({
            rowNumber: row.rowNumber,
            partnerRef: applied,
            appliedByThisAttempt: false,
            failure: null,
          });
          continue;
        }
        if (row.decisionKind !== "create" && row.decisionKind !== "reuse") {
          continue;
        }
        if (row.blockedReasons.length > 0) {
          continue;
        }
        const validated = validatedByRow.get(row.rowNumber);
        const decision = decisionByRow.get(row.rowNumber);
        if (validated === undefined || decision === undefined) {
          continue;
        }
        const values = valuesByField(validated, decision);
        const displayName = displayNameOf(values);
        if (displayName.length === 0) {
          // A row with nothing to show the contact under is left for review rather than created under an
          // invented label; the mapping step refuses a mapping that supplies no name column at all, so
          // this is a row whose name cell was empty.
          continue;
        }
        const partnerId = partnerIdFor(review.importOperationId, row.rowNumber);
        const reference: ImportMatchReference = {
          system: LOCAL_STORE_SYSTEM,
          reference: partnerId,
        };
        if (knownPartnerIds.has(partnerId)) {
          // An earlier attempt of this import created the record and its receipt cannot name it: the
          // record stands, it is reported, and nothing is created a second time.
          applications.push({
            rowNumber: row.rowNumber,
            partnerRef: reference,
            appliedByThisAttempt: false,
            failure: null,
          });
          continue;
        }
        createdPartners.push(
          partnerFromRow({
            partnerId,
            displayName,
            values,
            source: sourceForRow(decision, values),
          }),
        );
        knownPartnerIds.add(partnerId);
        applications.push({
          rowNumber: row.rowNumber,
          partnerRef: reference,
          appliedByThisAttempt: true,
          failure: null,
        });
      }
      const acceptedAt = now().toString();
      const built = buildReceipt({
        // The receipt is stored under the operation that produced it, so the identity a caller recovers
        // it by is the one it minted before sending: an acknowledgement lost in flight is read again
        // under this same id rather than turned into a resend.
        importOperationId: operationId,
        fileMeta: {
          name: review.fileName,
          bytes: review.byteLength,
          rowCount: file.dataRowCount,
          columnCount: file.columnCount,
        },
        mapping: confirmedMapping,
        rowDecisions: set,
        summary,
        processedAt: acceptedAt,
        applications,
      });
      if (!built.ok) {
        refusal = invalidField(ROOT_FIELD_KEY, built.refusal.message);
        return NOT_CHANGED;
      }
      const receipt = built.receipt;
      const revision = nextRevision(stored.proposal.revision);
      const proposal = proposalRecordOf({
        importOperationId: stored.proposal.importOperationId,
        revision,
        fileName: review.fileName,
        byteLength: review.byteLength,
        fingerprint: stored.proposal.fingerprint,
        headers: review.headers,
        rowCount: review.rowCount,
        columnCount: review.columnCount,
        mapping: confirmedMapping,
        decisions: set,
        summary: summaryRecordOf(summary, review.rowCount),
        results: rowResultRecordsOf(receipt),
        processedAt: acceptedAt,
      });
      const nextReview: ImportReviewRecord = {
        ...review,
        decisions: set,
        processedAt: acceptedAt,
        receipt: storedResult(receipt),
      };
      context.docs.state = stateAfter(state, {
        proposals: state.proposals.map((entry) => (entry.importOperationId === proposal.importOperationId ? proposal : entry)),
        reviews: state.reviews.map((entry) => (entry.importOperationId === nextReview.importOperationId ? nextReview : entry)),
        partners: [...state.partners, ...createdPartners],
      });
      const items: readonly PerItemResult[] = receipt.results.map((result) => ({
        targetId: String(result.rowNumber),
        state: result.state,
        reasonCode: result.reasonCode,
        reason: result.reason,
      }));
      return {
        changed: true,
        revision,
        result: storedResult(receipt),
        created: createdPartners.map((partner) => partner.partnerId),
        items,
      };
    },
  });
  return answerFor(outcome, refusal, operationId);
}
// cancelImport
/** Cancels the import in progress: every row that was not accepted is stopped, every row that was accepted keeps the record it became, and the state the cancellation produced is recorded under. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function cancelImport(input: MutationInput<CancelImportPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const authority = await importSessionAuthority(session, operationId);
  if (!authority.ok) {
    return authority.outcome;
  }
  let refusal: ImportMutationRefusal | null = null;
  const outcome = await runMutation<CancelImportPayload, MutationResult>({
    sessionId: authority.sessionId,
    input,
    schema: cancelImportPayloadSchema,
    name: "cancelImport",
    authorize: (resolved) => preparationAuthority(resolved, input.scope),
    readCurrent: (docs) => {
      const read = readImportState(docs.state);
      if (!read.ok) {
        return NO_TARGET;
      }
      const stored = latestImportIn(read.state, input.scope);
      return stored === null ? NO_TARGET : { kind: "record", revision: stored.proposal.revision, value: stored.proposal };
    },
    apply: async (context) => {
      const read = readImportState(context.docs.state);
      if (!read.ok) {
        refusal = stateUnavailable();
        return NOT_CHANGED;
      }
      const state = read.state;
      const stored = latestImportIn(state, input.scope);
      if (stored === null) {
        // There is no import to stop, so nothing needed doing: a cancellation of nothing creates no
        // record and states no effect.
        return NOT_CHANGED;
      }
      const review = stored.review;
      if (review.cancelledAt !== null) {
        // Cancelling twice keeps the instant the first cancellation stopped the work, and re-reports
        // nothing: the rows it stopped stay stopped.
        return NOT_CHANGED;
      }
      const cancelledAt = now().toString();
      const prior = storedReceiptOf(review);
      if (prior.kind === "unreadable") {
        refusal = {
          kind: "unavailable",
          reference: "import-receipt",
          guidance: RECEIPT_UNAVAILABLE_GUIDANCE,
        };
        return NOT_CHANGED;
      }
      let receipt: ImportReceipt | null = null;
      if (prior.kind === "receipt") {
        // The post-cancellation state is what this operation produced, so it is recorded under this
        // operation's identity; the acceptance's own receipt stays exactly as it was recorded under its
        // own, which is what keeps both recoverable and neither overwritten.
        receipt = {
          ...cancelUnacceptedRows(prior.receipt, cancelledAt),
          importOperationId: operationId,
        };
      } else if (review.mapping !== null) {
        // An import that was reviewed but never accepted has no receipt yet, so one is built from the
        // decisions it holds and then cancelled: every row it would have applied is stopped, and the
        // result step still has one record of what the cancellation did.
        const confirmedMapping = review.mapping;
        const parsed = await parseCsv(review.text);
        if (!parsed.ok) {
          refusal = {
            kind: "unavailable",
            reference: "stored-import-text",
            guidance: TEXT_UNAVAILABLE_GUIDANCE,
          };
          return NOT_CHANGED;
        }
        const file = parsed.file;
        const validation = validateRows(file, confirmedMapping);
        const set = review.decisions ?? createDecisionSet(file);
        const summarised = summariseDecisions(set, {
          file,
          mapping: confirmedMapping,
          validation,
          candidates: candidatesOf(state.partners),
        });
        if (!summarised.ok) {
          refusal = invalidField(ROOT_FIELD_KEY, summarised.refusal.message);
          return NOT_CHANGED;
        }
        const built = buildReceipt({
          importOperationId: operationId,
          fileMeta: {
            name: review.fileName,
            bytes: review.byteLength,
            rowCount: file.dataRowCount,
            columnCount: file.columnCount,
          },
          mapping: confirmedMapping,
          rowDecisions: set,
          summary: summarised.summary,
          processedAt: cancelledAt,
          applications: [],
        });
        if (!built.ok) {
          refusal = invalidField(ROOT_FIELD_KEY, built.refusal.message);
          return NOT_CHANGED;
        }
        receipt = cancelUnacceptedRows(built.receipt, cancelledAt);
      }
      const revision = nextRevision(stored.proposal.revision);
      const proposal = proposalRecordOf({
        importOperationId: stored.proposal.importOperationId,
        revision,
        fileName: review.fileName,
        byteLength: review.byteLength,
        fingerprint: stored.proposal.fingerprint,
        headers: review.headers,
        rowCount: review.rowCount,
        columnCount: review.columnCount,
        mapping: review.mapping,
        decisions: review.decisions,
        summary: stored.proposal.summary,
        results: receipt === null ? [] : rowResultRecordsOf(receipt),
        processedAt: stored.proposal.processedAt ?? cancelledAt,
      });
      const nextReview: ImportReviewRecord = {
        ...review,
        cancelledAt,
        receipt: receipt === null ? null : storedResult(receipt),
      };
      context.docs.state = stateAfter(state, {
        proposals: state.proposals.map((entry) => (entry.importOperationId === proposal.importOperationId ? proposal : entry)),
        reviews: state.reviews.map((entry) => (entry.importOperationId === nextReview.importOperationId ? nextReview : entry)),
      });
      return {
        changed: true,
        revision,
        result: storedResult(
          receipt ?? {
            importOperationId: operationId,
            cancelledAt,
            acceptedRowsRetained: 0,
            stoppedRows: 0,
            recallsCreatedRecords: false,
          },
        ),
        changedIds: [proposal.importOperationId],
      };
    },
  });
  return answerFor(outcome, refusal, operationId);
}
