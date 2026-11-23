import { Buffer } from "node:buffer";
import { z } from "zod";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { createDecisionSet, fingerprintOf, recordDecision, summariseDecisions } from "@/modules/import/decide";
import type { ImportDecisionInput, ImportDecisionRefusal, ImportDecisionSet, ImportDecisionSummary, ImportFileFingerprint, ImportRecordedCorrection, ImportRowDecision as RecordedRowDecision } from "@/modules/import/decide";
import { IMPORT_FIELD_IDS, confirmMapping, suggestMapping, type ImportConfirmedMapping, type ImportFieldAssignment, type ImportFieldId, type ImportIgnoredColumn, type ImportMappingDecision } from "@/modules/import/map";
import { checkLimits, parseCsv, IMPORT_MAX_DATA_ROWS, type ImportRefusal, type ParsedCsvFile } from "@/modules/import/parse";
import { buildReceipt, cancelUnacceptedRows, canonicalJson, readStoredReceipt, type ImportReceipt, type ImportRowApplication } from "@/modules/import/receipt";
import { validateRows, type ImportMatchCandidate, type ImportMatchReference, type ImportValidatedRow } from "@/modules/import/validate";
import { now } from "@/modules/time/clock";
import { canEdit, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
import { importProposalRecordSchema, partnerRecordSchema, sameScope, scopeSchema } from "../envelope";
import type { ImportColumnAssignmentRecord, ImportProposalRecord, ImportRowDecision as StoredRowDecision, ImportRowDecisionRecord, ImportRowResultRecord, ImportSummaryRecord, MutationInput, PartnerContactMethod, PartnerNameParts, PartnerRecord, PartnerRestriction, Scope } from "../envelope";
import { attemptIdOf, openMutation, refuseDenied, refuseInvalid, refuseUnavailable, runMutation, type CurrentTarget, type MutationContext, type MutationName, type MutationPlan } from "../operations";
import { LOCAL_STORE_SYSTEM, ROOT_FIELD_KEY, type FieldMessages, type MutationOutcome, type MutationResult, type PerItemResult } from "../outcome";
import { type SourceReference } from "@/lib/ids";
const CONTENT_BASE64_MAX_CHARS = Math.ceil((5 * 1024 * 1024 + (1 << 20)) * (4 / 3));
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const COLUMN_IGNORE_REASONS = ["blank-header", "unrecognised-header", "consent-preserved-as-data", "excluded-topic", "field-declined", "not-chosen"] as const;
const ROW_VERDICTS = ["ready", "needs-correction"] as const;
const positionSchema = z.int().positive({ error: "A row number and a column position are 1-based, so they start at 1." });
const matchReferenceSchema: z.ZodType<ImportMatchReference> = z.object({ system: z.string().min(1), reference: z.string().min(1) });
const recordedCorrectionSchema: z.ZodType<ImportRecordedCorrection> = z.object({ columnNumber: positionSchema, fieldId: z.enum(IMPORT_FIELD_IDS), value: z.string() });
const recordedDecisionSchema: z.ZodType<RecordedRowDecision> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), rowNumber: positionSchema, verdict: z.enum(ROW_VERDICTS), corrections: z.array(recordedCorrectionSchema) }),
  z.object({ kind: z.literal("reuse"), rowNumber: positionSchema, verdict: z.enum(ROW_VERDICTS), candidate: matchReferenceSchema, corrections: z.array(recordedCorrectionSchema) }),
  z.object({ kind: z.literal("skip"), rowNumber: positionSchema, verdict: z.enum(ROW_VERDICTS), workerReason: z.string(), rowProblem: z.string().nullable() }),
  z.object({ kind: z.literal("unresolved"), rowNumber: positionSchema, verdict: z.enum(ROW_VERDICTS) }),
]);
const fileFingerprintSchema: z.ZodType<ImportFileFingerprint> = z.object({ checksum: z.string().min(1), columnCount: z.int().nonnegative(), dataRowCount: z.int().nonnegative() });
const decisionSetSchema: z.ZodType<ImportDecisionSet> = z.object({ fingerprint: fileFingerprintSchema, decisions: z.array(recordedDecisionSchema) });
const fieldAssignmentSchema: z.ZodType<ImportFieldAssignment> = z.object({ fieldId: z.enum(IMPORT_FIELD_IDS), columnIndex: positionSchema });
const ignoredColumnSchema: z.ZodType<ImportIgnoredColumn> = z.object({ index: positionSchema, header: z.string(), occurrence: positionSchema, reason: z.enum(COLUMN_IGNORE_REASONS), message: z.string() });
const confirmedMappingSchema: z.ZodType<ImportConfirmedMapping> = z.object({
  columnCount: z.int().nonnegative(),
  assignments: z.array(fieldAssignmentSchema),
  fields: z.array(z.enum(IMPORT_FIELD_IDS)),
  declined: z.array(z.enum(IMPORT_FIELD_IDS)),
  unmapped: z.array(z.enum(IMPORT_FIELD_IDS)),
  ignored: z.array(ignoredColumnSchema),
});
export const proposeImportPayloadSchema: z.ZodType<ProposeImportPayload> = z.strictObject({
  fileName: z.string().min(1, { error: "fileName must name the chosen file." }).max(255, { error: "fileName is longer than a file name can be." }),
  contentBase64: z.string().max(CONTENT_BASE64_MAX_CHARS, { error: "contentBase64 is longer than one import request can carry; choose a smaller file." }),
  confirmedMapping: confirmedMappingSchema.refine((mapping) => mapping.assignments.length > 0, { error: "confirmedMapping pairs no field with a column; map at least one field." }).optional(),
});
export type ProposeImportPayload = { readonly fileName: string; readonly contentBase64: string; readonly confirmedMapping?: ImportConfirmedMapping };
const rowCorrectionInputSchema: z.ZodType<{ columnNumber: number; value: string }> = z.strictObject({ columnNumber: positionSchema, value: z.string() });
export const rowDecisionSchema: z.ZodType<ImportDecisionInput> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("create"), rowNumber: positionSchema, corrections: z.array(rowCorrectionInputSchema).optional() }),
  z.strictObject({ kind: z.literal("reuse"), rowNumber: positionSchema, candidate: matchReferenceSchema, corrections: z.array(rowCorrectionInputSchema).optional() }),
  z.strictObject({ kind: z.literal("skip"), rowNumber: positionSchema, reason: z.string().optional() }),
  z.strictObject({ kind: z.literal("unresolved"), rowNumber: positionSchema }),
]);
export const setRowDecisionPayloadSchema: z.ZodType<SetRowDecisionPayload> = rowDecisionSchema;
export type SetRowDecisionPayload = ImportDecisionInput;
export const acceptImportRowsPayloadSchema: z.ZodType<AcceptImportRowsPayload> = z.strictObject({
  acknowledged: z.literal(true, { error: "Confirm the acceptance explicitly." }),
  fileFingerprint: z.string().min(1, { error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." }),
  decisions: z.array(rowDecisionSchema).min(1, { error: "Review at least one row decision before accepting." }).max(IMPORT_MAX_DATA_ROWS, { error: "A reviewed snapshot holds at most one decision per data row the import accepts." }),
});
export type AcceptImportRowsPayload = { readonly acknowledged: true; readonly fileFingerprint: string; readonly decisions: readonly ImportDecisionInput[] };
export const cancelImportPayloadSchema: z.ZodType<CancelImportPayload> = z.strictObject({});
export type CancelImportPayload = Record<string, never>;
/** The review in progress: the chosen file's own text, the headers and counts measured from it, the mapping */
export interface ImportReviewRecord {
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
/** The stored review record as it is read back. */
export const importReviewRecordSchema: z.ZodType<ImportReviewRecord> = z.object({
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
type ImportState = { readonly document: Record<string, unknown>; readonly proposals: readonly ImportProposalRecord[]; readonly reviews: readonly ImportReviewRecord[]; readonly partners: readonly PartnerRecord[] };
type ImportStateRead = { readonly ok: true; readonly state: ImportState } | { readonly ok: false };
function readImportState(value: unknown): ImportStateRead {
  if (!isRecord(value)) return { ok: false };
  const proposals = z.array(importProposalRecordSchema).safeParse(value["importProposals"]),
    partners = z.array(partnerRecordSchema).safeParse(value["partners"]);
  const storedReviews: unknown = value["importReviews"];
  const reviews = storedReviews === undefined ? null : z.array(importReviewRecordSchema).safeParse(storedReviews);
  if (!proposals.success || !partners.success) return { ok: false };
  if (reviews !== null && !reviews.success) return { ok: false };
  const read: ImportReviewRecord[] = reviews === null ? [] : [...reviews.data];
  return read.some((review) => !reviewIsConsistent(review)) ? { ok: false } : { ok: true, state: { document: value, proposals: proposals.data, reviews: read, partners: partners.data } };
}
function reviewIsConsistent(review: ImportReviewRecord): boolean {
  if (review.headers.length !== review.columnCount) return false;
  const decisions = review.decisions;
  return decisions === null || decisions.fingerprint.dataRowCount === review.rowCount;
}
function stateAfter(state: ImportState, next: { readonly proposals?: readonly ImportProposalRecord[]; readonly reviews?: readonly ImportReviewRecord[]; readonly partners?: readonly PartnerRecord[] }): Record<string, unknown> {
  return { ...state.document, importProposals: next.proposals ?? state.proposals, importReviews: next.reviews ?? state.reviews, partners: next.partners ?? state.partners };
}
type StoredImport = { readonly review: ImportReviewRecord; readonly proposal: ImportProposalRecord };
function latestImportIn(state: ImportState, scope: Scope, options: { readonly inFlightOnly?: boolean } = {}): StoredImport | null {
  for (let index = state.reviews.length - 1; index >= 0; index -= 1) {
    const review = state.reviews[index];
    if (review === undefined || !sameScope(review.scope, scope)) continue;
    const proposal = state.proposals.find((candidate) => candidate.importOperationId === review.importOperationId);
    if (proposal === undefined) continue;
    if (options.inFlightOnly === true && proposal.processedAt !== null) continue;
    return { review, proposal };
  }
  return null;
}
const FIRST_REVISION = "rev-1";
const REVISION_PATTERN = /^rev-([0-9]+)$/;
function nextRevision(current: string): string {
  const counter = REVISION_PATTERN.test(current) ? Number(REVISION_PATTERN.exec(current)?.[1] ?? "0") + 1 : Number.NaN;
  return Number.isFinite(counter) && counter > 0 ? `rev-${String(counter)}` : FIRST_REVISION;
}
const storedResult = (value: unknown): MutationResult => JSON.parse(JSON.stringify(value)) as MutationResult;
const invalidField = (field: string, message: string): FieldMessages => ({ [field]: [message] });
function openImportState(context: MutationContext): ImportState {
  const read = readImportState(context.docs.state);
  if (!read.ok) refuseState(context.operationId);
  return read.state;
}
function currentImportTarget(docs: MutationContext["docs"], scope: Scope): CurrentTarget {
  const read = readImportState(docs.state);
  const stored = read.ok ? latestImportIn(read.state, scope) : null;
  return stored === null ? NO_TARGET : { kind: "record", revision: stored.proposal.revision, value: stored.proposal };
}
const refuseState: (operationId: string) => never = (operationId) => refuseUnavailable({ operationId, reference: IMPORT_SOURCE_REFERENCE, guidance: STATE_UNAVAILABLE_GUIDANCE });
const IMPORT_SOURCE_REFERENCE = "contact-import";
const STATE_UNAVAILABLE_GUIDANCE = "This session's import record cannot be read as this build records it, so nothing was changed. Reload the page; if it stays unreadable, reset the development seed from Settings and start the import again. Nothing that was already accepted is affected.";
const TEXT_UNAVAILABLE_GUIDANCE = "The file text this import kept can no longer be read as the CSV it was admitted as, so nothing was changed. Start the import again with the same file; contacts an earlier acceptance created stay exactly where they are.";
const RECEIPT_UNAVAILABLE_GUIDANCE = "This import's recorded receipt cannot be read, so an acceptance could not tell which rows it already applied and nothing was changed. Read the operation's result again rather than repeating the import: rows it already accepted are recorded under its operation identity.";
type ImportMutationSpec<P, R extends MutationResult> = Pick<MutationPlan<P, R>, "readCurrent" | "apply">;
async function runImportMutation<P, R extends MutationResult>(input: MutationInput<P>, session: SessionSource | undefined, operationId: string, schema: z.ZodType<P>, name: MutationName, spec: ImportMutationSpec<P, R>): Promise<MutationOutcome> {
  const opening = await openMutation(name, input, session);
  return !opening.ok ? opening.outcome : runMutation<P, R>({ sessionId: opening.sessionId, input, schema, name, authorize: (resolved) => preparationAuthority(resolved, input.scope), ...spec });
}
function preparationAuthority(session: ResolvedSession, scope: Scope): ScopeDecision {
  const decision = canEdit(session, { kind: "partner", scope, audience: "private", authorPrincipalId: session.principalId });
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}
function decodeContent(value: string): Uint8Array | null {
  const decoded = value.length % 4 === 0 && BASE64_PATTERN.test(value) ? Buffer.from(value, "base64") : undefined;
  return decoded !== undefined && decoded.toString("base64") === value ? new Uint8Array(decoded) : null;
}
function fileRefusalOn(refusals: readonly ImportRefusal[]): FieldMessages {
  const messages = refusals.map((refusal) => refusal.message);
  return { contentBase64: messages.length > 0 ? messages : ["This file could not be read as CSV."] };
}
/** The existing contacts a file's rows may be compared against: every stored partner as an opaque, */
export const candidatesOf = (partners: readonly PartnerRecord[]): readonly ImportMatchCandidate[] => partners.map((partner) => ({ reference: { system: LOCAL_STORE_SYSTEM, reference: partner.partnerId }, visibleFields: CANDIDATE_FIELDS, visibleValues: visibleValuesOf(partner), reuse: { permitted: true } }));
const CANDIDATE_FIELDS: readonly ImportFieldId[] = [...IMPORT_FIELD_IDS];
function visibleValuesOf(partner: PartnerRecord): Readonly<Partial<Record<ImportFieldId, readonly string[]>>> {
  const values: Partial<Record<ImportFieldId, string[]>> = { "display-name": [partner.displayName], restriction: partner.restrictions.map((restriction) => restriction.detail), tag: [...partner.tags] };
  if (partner.kind === "organization" || partner.kind === "church") values["name-organization"] = [partner.displayName];
  const given = partner.nameParts?.given,
    family = partner.nameParts?.family,
    source = partner.source;
  if (given !== null && given !== undefined) values["name-given"] = [given];
  if (family !== null && family !== undefined) values["name-family"] = [family];
  if (source !== null) values["source-reference"] = [source.reference];
  for (const method of partner.contactMethods) {
    const fieldId: ImportFieldId = method.kind === "email" ? "contact-email" : method.kind === "phone" ? "contact-phone" : "contact-postal";
    const existing = values[fieldId];
    if (existing === undefined) values[fieldId] = [method.value];
    else existing.push(method.value);
  }
  return values;
}
type ProposalProjection = {
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
};
const NAME_FIELDS: readonly ImportFieldId[] = ["display-name", "name-given", "name-family", "name-organization"];
function proposalRecordOf(projection: ProposalProjection): ImportProposalRecord {
  return {
    importOperationId: projection.importOperationId,
    fileMeta: { name: projection.fileName, bytes: projection.byteLength, rowCount: projection.rowCount, columnCount: projection.columnCount },
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
  if (mapping === null) return [];
  const fieldByColumn = new Map<number, ImportFieldId>();
  for (const assignment of mapping.assignments) fieldByColumn.set(assignment.columnIndex, assignment.fieldId);
  const records: ImportColumnAssignmentRecord[] = [];
  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    const header = (headers[columnIndex - 1] ?? "").trim();
    records.push({ columnIndex, header: header.length > 0 ? header : `Column ${String(columnIndex)}`, field: fieldByColumn.get(columnIndex) ?? null });
  }
  return records;
}
function summaryRecordOf(summary: ImportDecisionSummary | null, rowCount: number): ImportSummaryRecord {
  if (summary === null) return { newEntries: 0, reusedIdentities: 0, skipped: 0, needsReview: rowCount };
  return { newEntries: summary.counts.create, reusedIdentities: summary.counts.reuse, skipped: summary.counts.skip, needsReview: summary.rows.filter((row) => row.decisionKind === "unresolved" || row.blockedReasons.length > 0).length };
}
function rowDecisionRecordsOf(set: ImportDecisionSet | null): readonly ImportRowDecisionRecord[] {
  if (set === null) return [];
  return set.decisions.map((decision) => ({
    rowNumber: decision.rowNumber,
    decision: storedDecisionOf(decision),
    targetPartnerId: decision.kind === "reuse" ? decision.candidate.reference : null,
    corrections: decision.kind === "create" || decision.kind === "reuse" ? decision.corrections.map((correction) => ({ columnNumber: correction.columnNumber, value: correction.value })) : [],
    candidate: decision.kind === "reuse" ? { ...decision.candidate } : null,
    reason: decision.kind === "skip" ? decision.workerReason : null,
  }));
}
const STORED_DECISIONS: Readonly<Record<RecordedRowDecision["kind"], StoredRowDecision>> = { create: "new-private-entry", reuse: "reuse-authorized-identity", skip: "skip", unresolved: "unresolved" };
const storedDecisionOf = (decision: RecordedRowDecision): StoredRowDecision => STORED_DECISIONS[decision.kind];
const rowResultRecordsOf = (receipt: ImportReceipt): readonly ImportRowResultRecord[] => receipt.results.map((result) => ({ rowNumber: result.rowNumber, state: result.state, partnerId: result.route !== null && result.route.kind === "partner" ? result.route.partnerRef.reference : null, message: result.reason }));
function mappingDecisionsOf(mapping: ImportConfirmedMapping): readonly ImportMappingDecision[] {
  const columnsByField = new Map<ImportFieldId, number[]>();
  for (const assignment of mapping.assignments) {
    const existing = columnsByField.get(assignment.fieldId);
    if (existing === undefined) {
      columnsByField.set(assignment.fieldId, [assignment.columnIndex]);
    } else existing.push(assignment.columnIndex);
  }
  const decisions: ImportMappingDecision[] = [];
  for (const fieldId of IMPORT_FIELD_IDS) {
    const columnIndexes = columnsByField.get(fieldId);
    if (columnIndexes !== undefined) {
      decisions.push({ kind: "choose", fieldId, columnIndexes });
      continue;
    }
    if (mapping.declined.includes(fieldId)) decisions.push({ kind: "decline", fieldId });
  }
  return decisions;
}
const mappingSuppliesName = (mapping: ImportConfirmedMapping): boolean => mapping.fields.some((fieldId) => NAME_FIELDS.includes(fieldId));
function sameMappingRecords(left: readonly ImportColumnAssignmentRecord[], right: readonly ImportColumnAssignmentRecord[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((column, index) => {
    const other = right[index];
    return other !== undefined && other.columnIndex === column.columnIndex && other.header === column.header && other.field === column.field;
  });
}
function decisionsFor(file: ParsedCsvFile, previous: StoredImport | null, mappingRecords: readonly ImportColumnAssignmentRecord[]): ImportDecisionSet {
  return previous !== null && previous.review.decisions !== null && sameMappingRecords(previous.proposal.mapping, mappingRecords) ? previous.review.decisions : createDecisionSet(file);
}
function valuesByField(row: ImportValidatedRow, decision: RecordedRowDecision | null): ReadonlyMap<ImportFieldId, readonly string[]> {
  const byColumn = new Map<number, { readonly fieldId: ImportFieldId; readonly value: string }>();
  for (const cell of row.mappedCells) byColumn.set(cell.columnNumber, { fieldId: cell.fieldId, value: cell.value.trim() });
  if (decision !== null && (decision.kind === "create" || decision.kind === "reuse")) for (const correction of decision.corrections) byColumn.set(correction.columnNumber, { fieldId: byColumn.get(correction.columnNumber)?.fieldId ?? correction.fieldId, value: correction.value.trim() });
  const values = new Map<ImportFieldId, string[]>();
  for (const columnNumber of [...byColumn.keys()].sort((left, right) => left - right)) {
    const entry = byColumn.get(columnNumber);
    if (entry === undefined || entry.value.length === 0) continue;
    const collected = values.get(entry.fieldId);
    if (collected === undefined) {
      values.set(entry.fieldId, [entry.value]);
    } else if (!collected.includes(entry.value)) collected.push(entry.value);
  }
  return values;
}
function firstValue(values: ReadonlyMap<ImportFieldId, readonly string[]>, fieldId: ImportFieldId): string | null {
  const [first] = values.get(fieldId) ?? [];
  return first === undefined || first.length === 0 ? null : first;
}
function displayNameOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): string {
  const displayName = firstValue(values, "display-name");
  if (displayName !== null) return displayName;
  const given = firstValue(values, "name-given");
  const family = firstValue(values, "name-family");
  const composed = [given, family]
    .filter((part): part is string => part !== null)
    .join(" ")
    .trim();
  return composed.length > 0 ? composed : (firstValue(values, "name-organization") ?? "");
}
function namePartsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): PartnerNameParts | null {
  const given = firstValue(values, "name-given");
  const family = firstValue(values, "name-family");
  return given === null && family === null ? null : { given, family, additional: [] };
}
function contactMethodsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): readonly PartnerContactMethod[] {
  const methods: PartnerContactMethod[] = [];
  const seen = new Set<string>();
  const fields: readonly { readonly fieldId: ImportFieldId; readonly kind: "email" | "phone" | "postal" }[] = [
    { fieldId: "contact-email", kind: "email" },
    { fieldId: "contact-phone", kind: "phone" },
    { fieldId: "contact-postal", kind: "postal" },
  ];
  for (const field of fields) {
    for (const value of values.get(field.fieldId) ?? []) {
      const key = `${field.kind}\u0000${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      methods.push({ kind: field.kind, value, permitted: true, verified: false });
    }
  }
  return methods;
}
const restrictionsOf = (values: ReadonlyMap<ImportFieldId, readonly string[]>): readonly PartnerRestriction[] => (values.get("restriction") ?? []).map((detail) => ({ kind: "imported-restriction", detail }));
const tagsOf = (values: ReadonlyMap<ImportFieldId, readonly string[]>): readonly string[] => [...(values.get("tag") ?? [])];
function sourceForRow(decision: RecordedRowDecision, values: ReadonlyMap<ImportFieldId, readonly string[]>): SourceReference | null {
  if (decision.kind === "reuse") return { system: LOCAL_STORE_SYSTEM, reference: decision.candidate.reference };
  const imported = firstValue(values, "source-reference");
  return imported === null ? null : { system: IMPORT_SOURCE_REFERENCE, reference: imported };
}
function partnerFromRow(input: { readonly partnerId: string; readonly displayName: string; readonly values: ReadonlyMap<ImportFieldId, readonly string[]>; readonly source: SourceReference | null }): PartnerRecord {
  const contactMethods = contactMethodsOf(input.values);
  const restrictions = restrictionsOf(input.values);
  return { partnerId: input.partnerId, kind: "private-preparation", displayName: input.displayName, nameParts: namePartsOf(input.values), contactMethods, restrictions, tags: tagsOf(input.values), favourite: false, stage: null, audience: "private", revision: FIRST_REVISION, source: input.source };
}
type StoredReceiptRead = { readonly kind: "none" } | { readonly kind: "receipt"; readonly receipt: ImportReceipt } | { readonly kind: "unreadable" };
function storedReceiptOf(review: ImportReviewRecord): StoredReceiptRead {
  const stored = review.receipt;
  if (stored === null) return { kind: "none" };
  const identity = isRecord(stored) ? stored["importOperationId"] : undefined;
  if (!isNonEmptyString(identity)) return { kind: "unreadable" };
  const read = readStoredReceipt(stored, identity);
  return read.kind === "found" ? { kind: "receipt", receipt: read.receipt } : { kind: "unreadable" };
}
function appliedRowsOf(receipt: ImportReceipt): ReadonlyMap<number, ImportMatchReference> {
  const applied = new Map<number, ImportMatchReference>();
  for (const result of receipt.results) {
    if (result.state !== "accepted" && result.state !== "already-accepted") continue;
    if (result.route === null || result.route.kind !== "partner") continue;
    if (!applied.has(result.rowNumber)) applied.set(result.rowNumber, { ...result.route.partnerRef });
  }
  return applied;
}
function refuseDecision(operationId: string, refusal: ImportDecisionRefusal): never {
  return refusal.code === "no-reusable-candidate" || refusal.code === "candidate-not-suggested" ? refuseDenied(operationId) : refuseInvalid(operationId, invalidField(refusal.rowNumber === null ? ROOT_FIELD_KEY : "rowNumber", refusal.message));
}
function carriedFingerprintRefusal(carried: string, current: ImportFileFingerprint, recorded: ImportFileFingerprint | null): FieldMessages | null {
  if (carried === current.checksum || carried === recorded?.checksum) return null;
  const separator = current.checksum.lastIndexOf("-");
  const tag = separator <= 0 ? null : current.checksum.slice(0, separator + 1);
  if (tag === null || !carried.startsWith(tag)) return null;
  return invalidField("fileFingerprint", "This fingerprint belongs to a different version of the file than the one this import holds, so nothing was accepted. Choose the file again and review its rows: the file you are accepting has to be the file that was mapped and validated.");
}
// The content of one proposal with its revision left out: a proposal describing the same file under the same mapping and the same decisions has nothing to change but the number it would advance.
const proposalContentOf = (record: ImportProposalRecord): string => canonicalJson({ ...record, revision: null });
const NOT_CHANGED: { readonly changed: false } = { changed: false };
const NO_TARGET: CurrentTarget = { kind: "absent" };
/** Proposes an import from a chosen file: the limits enforced before anything is processed, the file typed by its content, the mapping suggested column by column, and — on the journey's second. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function proposeImport(input: MutationInput<ProposeImportPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  return runImportMutation<ProposeImportPayload, MutationResult>(input, session, operationId, proposeImportPayloadSchema, "proposeImport", {
    apply: async (context) => {
      const state = openImportState(context);
      const payload = input.payload;
      const bytes = decodeContent(payload.contentBase64);
      if (bytes === null) refuseInvalid(context.operationId, invalidField("contentBase64", "This file's content is not valid base64, so it could not be read as the file that was chosen. Choose the file again."));
      const admitted = await checkLimits(bytes, payload.fileName);
      if (!admitted.ok) refuseInvalid(context.operationId, fileRefusalOn(admitted.refusals));
      const parsed = await parseCsv(admitted.file.text);
      if (!parsed.ok) refuseInvalid(context.operationId, fileRefusalOn(parsed.refusals));
      const file = parsed.file;
      const text = admitted.file.text;
      let mapping: ImportConfirmedMapping | null = null;
      if (payload.confirmedMapping !== undefined) {
        const confirmed = confirmMapping(suggestMapping(file), mappingDecisionsOf(payload.confirmedMapping));
        if (!confirmed.ok) refuseInvalid(context.operationId, { confirmedMapping: confirmed.refusals.map((entry) => entry.message) });
        mapping = confirmed.mapping;
        if (!mappingSuppliesName(mapping)) refuseInvalid(context.operationId, invalidField("confirmedMapping", "This mapping supplies no column that names a contact, so nothing could be created from the file. Map a display name, or a given and family name, or an organization name."));
      }
      const open = latestImportIn(state, input.scope, { inFlightOnly: true });
      const previous = open !== null && open.review.text === text ? open : null;
      const importOperationId = previous === null ? operationId : previous.review.importOperationId;
      const revision = previous === null ? FIRST_REVISION : nextRevision(previous.proposal.revision);
      let decisions: ImportDecisionSet | null = null;
      let summary: ImportDecisionSummary | null = null;
      if (mapping !== null) {
        const confirmedMapping = mapping;
        const recorded = decisionsFor(file, previous, mappingRecordsOf(file.headers, file.columnCount, confirmedMapping));
        const validation = validateRows(file, confirmedMapping);
        const summarised = summariseDecisions(recorded, { file, mapping: confirmedMapping, validation, candidates: candidatesOf(state.partners) });
        if (!summarised.ok) refuseInvalid(context.operationId, invalidField("confirmedMapping", summarised.refusal.message));
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
      const review: ImportReviewRecord = { importOperationId, scope: input.scope, fileName: payload.fileName, byteLength: admitted.file.byteLength, text, headers: [...file.headers], rowCount: file.dataRowCount, columnCount: file.columnCount, mapping, decisions, processedAt: null, cancelledAt: null, receipt: null };
      // The same file, mapped the same way, with the same decisions recorded: the proposal and the review this attempt would write are the two records already stored, so the payload produces no change. The answer is `unchanged` under this attempt's own id, stating the revision the proposal is at, and it names the import it found so the runner can record that attempt under the caller's identity rather than reporting the earlier proposal as something this attempt created.
      if (previous !== null && proposalContentOf(proposal) === proposalContentOf(previous.proposal) && canonicalJson(review) === canonicalJson(previous.review)) return { changed: false, revision: previous.proposal.revision, result: { importOperationId: previous.proposal.importOperationId } };
      const dropped = (candidate: { readonly importOperationId: string }): boolean => candidate.importOperationId === importOperationId || candidate.importOperationId === (open === null ? null : open.review.importOperationId);
      context.docs.state = stateAfter(state, { proposals: [...state.proposals.filter((entry) => !dropped(entry)), proposal], reviews: [...state.reviews.filter((entry) => !dropped(entry)), review] });
      return { changed: true, revision, result: storedResult(proposal), created: [importOperationId] };
    },
  });
}
/** Records one worker's decision about one row of the import in progress. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function setRowDecision(input: MutationInput<SetRowDecisionPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  return runImportMutation<SetRowDecisionPayload, MutationResult>(input, session, operationId, setRowDecisionPayloadSchema, "setRowDecision", {
    readCurrent: (docs) => {
      return currentImportTarget(docs, input.scope);
    },
    apply: async (context) => {
      const state = openImportState(context);
      const stored = latestImportIn(state, input.scope);
      if (stored === null) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, "No import is in progress in this context, so there is no row to decide about. Choose a file and map its columns first."));
      if (stored.proposal.processedAt !== null) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, "This import has already been accepted or cancelled, so its row decisions can no longer change. Start a new import to decide about these rows again."));
      const confirmedMapping = stored.review.mapping;
      if (confirmedMapping === null) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, "No column mapping is confirmed for this import yet, so no row can be decided about. Confirm the mapping first."));
      const parsed = await parseCsv(stored.review.text);
      if (!parsed.ok) refuseUnavailable({ operationId: context.operationId, reference: "stored-import-text", guidance: TEXT_UNAVAILABLE_GUIDANCE });
      const file = parsed.file;
      const validation = validateRows(file, confirmedMapping);
      const candidates = candidatesOf(state.partners);
      const recorded = recordDecision(stored.review.decisions ?? createDecisionSet(file), input.payload, { file, mapping: confirmedMapping, validation, candidates });
      if (!recorded.ok) refuseDecision(context.operationId, recorded.refusal);
      if (!recorded.changed) return NOT_CHANGED;
      const summarised = summariseDecisions(recorded.set, { file, mapping: confirmedMapping, validation, candidates });
      if (!summarised.ok) refuseInvalid(context.operationId, invalidField("rowNumber", summarised.refusal.message));
      const revision = nextRevision(stored.proposal.revision);
      const proposal = proposalRecordOf({
        importOperationId: stored.proposal.importOperationId,
        revision,
        fileName: stored.review.fileName,
        byteLength: stored.review.byteLength,
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
      context.docs.state = stateAfter(state, { proposals: state.proposals.map((entry) => (entry.importOperationId === proposal.importOperationId ? proposal : entry)), reviews: state.reviews.map((entry) => (entry.importOperationId === review.importOperationId ? review : entry)) });
      return { changed: true, revision, result: storedResult(proposal), changedIds: [proposal.importOperationId] };
    },
  });
}
/** Accepts the reviewed rows of the import in progress: the recorded snapshot is re-checked row by row at execute time, only the eligible ones are applied, and the receipt of what happened is. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function acceptImportRows(input: MutationInput<AcceptImportRowsPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  return runImportMutation<AcceptImportRowsPayload, MutationResult>(input, session, operationId, acceptImportRowsPayloadSchema, "acceptImportRows", {
    readCurrent: (docs) => {
      return currentImportTarget(docs, input.scope);
    },
    apply: async (context) => {
      const state = openImportState(context);
      const stored = latestImportIn(state, input.scope);
      if (stored === null) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, "No import is in progress in this context, so there is nothing to accept. Choose a file, map its columns and decide about its rows first."));
      const review = stored.review;
      const confirmedMapping = review.mapping;
      if (confirmedMapping === null) refuseInvalid(context.operationId, invalidField("confirmedMapping", "No column mapping is confirmed for this import, so no row could be applied. Map the columns and review the rows before accepting."));
      const prior = storedReceiptOf(review);
      if (prior.kind === "unreadable") refuseUnavailable({ operationId: context.operationId, reference: "import-receipt", guidance: RECEIPT_UNAVAILABLE_GUIDANCE });
      const parsed = await parseCsv(review.text);
      if (!parsed.ok) refuseUnavailable({ operationId: context.operationId, reference: "stored-import-text", guidance: TEXT_UNAVAILABLE_GUIDANCE });
      const file = parsed.file;
      const fingerprint = fingerprintOf(file);
      const carried = carriedFingerprintRefusal(input.payload.fileFingerprint, fingerprint, review.decisions?.fingerprint ?? null);
      if (carried !== null) refuseInvalid(context.operationId, carried);
      const validation = validateRows(file, confirmedMapping);
      const candidates = candidatesOf(state.partners);
      let set = review.decisions ?? createDecisionSet(file);
      for (const decisionInput of input.payload.decisions) {
        const recorded = recordDecision(set, decisionInput, { file, mapping: confirmedMapping, validation, candidates });
        if (!recorded.ok) refuseDecision(context.operationId, recorded.refusal);
        if (recorded.changed) set = recorded.set;
      }
      const summarised = summariseDecisions(set, { file, mapping: confirmedMapping, validation, candidates });
      if (!summarised.ok) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, summarised.refusal.message));
      const summary = summarised.summary;
      const alreadyApplied = prior.kind === "receipt" ? appliedRowsOf(prior.receipt) : new Map<number, ImportMatchReference>();
      const validatedByRow = new Map<number, ImportValidatedRow>();
      for (const row of validation.rows) validatedByRow.set(row.rowNumber, row);
      const decisionByRow = new Map<number, RecordedRowDecision>();
      for (const decision of set.decisions) decisionByRow.set(decision.rowNumber, decision);
      const knownPartnerIds = new Set(state.partners.map((partner) => partner.partnerId));
      const applications: ImportRowApplication[] = [];
      const createdPartners: PartnerRecord[] = [];
      for (const row of summary.rows) {
        const applied = alreadyApplied.get(row.rowNumber);
        if (applied !== undefined) {
          applications.push({ rowNumber: row.rowNumber, partnerRef: applied, appliedByThisAttempt: false, failure: null });
          continue;
        }
        if (row.decisionKind !== "create" && row.decisionKind !== "reuse") continue;
        if (row.blockedReasons.length > 0) continue;
        const validated = validatedByRow.get(row.rowNumber);
        const decision = decisionByRow.get(row.rowNumber);
        if (validated === undefined || decision === undefined) continue;
        const values = valuesByField(validated, decision);
        const displayName = displayNameOf(values);
        if (displayName.length === 0) continue;
        const partnerId = `partner-import-${review.importOperationId}-${String(row.rowNumber)}`;
        const reference: ImportMatchReference = { system: LOCAL_STORE_SYSTEM, reference: partnerId };
        if (knownPartnerIds.has(partnerId)) {
          applications.push({ rowNumber: row.rowNumber, partnerRef: reference, appliedByThisAttempt: false, failure: null });
          continue;
        }
        createdPartners.push(partnerFromRow({ partnerId, displayName, values, source: sourceForRow(decision, values) }));
        knownPartnerIds.add(partnerId);
        applications.push({ rowNumber: row.rowNumber, partnerRef: reference, appliedByThisAttempt: true, failure: null });
      }
      const acceptedAt = now().toString();
      // The receipt belongs to the import, not to this attempt: it is identified by the import operation identity the review and the proposal are recorded under, so the acceptance stays reachable by the one identity the journey holds and the address names. This attempt's own identity is what the ledger records, and a replay of it returns this same stored receipt.
      const built = buildReceipt({ importOperationId: review.importOperationId, fileMeta: { name: review.fileName, bytes: review.byteLength, rowCount: file.dataRowCount, columnCount: file.columnCount }, mapping: confirmedMapping, rowDecisions: set, summary, processedAt: acceptedAt, applications });
      if (!built.ok) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, built.refusal.message));
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
      const nextReview: ImportReviewRecord = { ...review, decisions: set, processedAt: acceptedAt, receipt: storedResult(receipt) };
      context.docs.state = stateAfter(state, {
        proposals: state.proposals.map((entry) => (entry.importOperationId === proposal.importOperationId ? proposal : entry)),
        reviews: state.reviews.map((entry) => (entry.importOperationId === nextReview.importOperationId ? nextReview : entry)),
        partners: [...state.partners, ...createdPartners],
      });
      const items: readonly PerItemResult[] = receipt.results.map((result) => ({ targetId: String(result.rowNumber), state: result.state, reasonCode: result.reasonCode, reason: result.reason }));
      return { changed: true, revision, result: storedResult(receipt), created: createdPartners.map((partner) => partner.partnerId), items };
    },
  });
}
/** Cancels the import in progress: every row that was not accepted is stopped, every row that was accepted keeps the record it became, and the state the cancellation produced is recorded under. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function cancelImport(input: MutationInput<CancelImportPayload>, session?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  return runImportMutation<CancelImportPayload, MutationResult>(input, session, operationId, cancelImportPayloadSchema, "cancelImport", {
    readCurrent: (docs) => {
      return currentImportTarget(docs, input.scope);
    },
    apply: async (context) => {
      const state = openImportState(context);
      const stored = latestImportIn(state, input.scope);
      if (stored === null) return NOT_CHANGED;
      const review = stored.review;
      if (review.cancelledAt !== null) return NOT_CHANGED;
      const cancelledAt = now().toString();
      const prior = storedReceiptOf(review);
      if (prior.kind === "unreadable") refuseUnavailable({ operationId: context.operationId, reference: "import-receipt", guidance: RECEIPT_UNAVAILABLE_GUIDANCE });
      let receipt: ImportReceipt | null = null;
      if (prior.kind === "receipt") {
        receipt = cancelUnacceptedRows(prior.receipt, cancelledAt); // The stored receipt already names the import, so the cancellation is recorded on that one receipt rather than re-keyed to this attempt.
      } else if (review.mapping !== null) {
        const confirmedMapping = review.mapping;
        const parsed = await parseCsv(review.text);
        if (!parsed.ok) refuseUnavailable({ operationId: context.operationId, reference: "stored-import-text", guidance: TEXT_UNAVAILABLE_GUIDANCE });
        const file = parsed.file;
        const validation = validateRows(file, confirmedMapping);
        const set = review.decisions ?? createDecisionSet(file);
        const summarised = summariseDecisions(set, { file, mapping: confirmedMapping, validation, candidates: candidatesOf(state.partners) });
        if (!summarised.ok) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, summarised.refusal.message));
        const built = buildReceipt({
          importOperationId: review.importOperationId,
          fileMeta: { name: review.fileName, bytes: review.byteLength, rowCount: file.dataRowCount, columnCount: file.columnCount },
          mapping: confirmedMapping,
          rowDecisions: set,
          summary: summarised.summary,
          processedAt: cancelledAt,
          applications: [],
        });
        if (!built.ok) refuseInvalid(context.operationId, invalidField(ROOT_FIELD_KEY, built.refusal.message));
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
      const nextReview: ImportReviewRecord = { ...review, cancelledAt, receipt: receipt === null ? null : storedResult(receipt) };
      context.docs.state = stateAfter(state, { proposals: state.proposals.map((entry) => (entry.importOperationId === proposal.importOperationId ? proposal : entry)), reviews: state.reviews.map((entry) => (entry.importOperationId === nextReview.importOperationId ? nextReview : entry)) });
      return { changed: true, revision, result: storedResult(receipt ?? { importOperationId: review.importOperationId, cancelledAt, acceptedRowsRetained: 0, stoppedRows: 0, recallsCreatedRecords: false }), changedIds: [proposal.importOperationId] };
    },
  });
}
