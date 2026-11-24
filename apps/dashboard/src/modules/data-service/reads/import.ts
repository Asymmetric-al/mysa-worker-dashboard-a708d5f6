import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { compareCodeUnits } from "@/lib/ordering";
import { decisionInputOf, fingerprintOf, recordedDecisionInputOf, type ImportDecisionInput, type ImportDecisionKind, type ImportDecisionSummary } from "@/modules/import/decide";
import { IMPORT_FIELD_VOCABULARY, suggestMapping, type ImportFieldId, type ImportSuggestedMapping } from "@/modules/import/map";
import { IMPORT_LIMIT_DESCRIPTORS, parseCsv, type ImportLimitId, type ImportLimitUnit } from "@/modules/import/parse";
import { IMPORT_RECEIPT_FORMAT, readStoredReceipt, type ImportReceipt, type ImportReceiptRead, type ImportResultRoute } from "@/modules/import/receipt";
import { flagDuplicateLookingRows, suggestMatches, validateRows } from "@/modules/import/validate";
import type { ImportDuplicateLooking, ImportFieldIssue, ImportMappedCell, ImportMatchReference, ImportMatchSuggestion, ImportPreservedCell, ImportRestriction, ImportRowVerdict, ImportValidationCounts, ImportValidationProblem } from "@/modules/import/validate";
import { readSession } from "@/modules/store/repository";
import { clampPageSize } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { assertScope, readResultOfRefusal, recordRefusalOutage, resolveSession, type ResolvedSession, type SessionSource } from "../authorize";
import { IMPORT_ROW_DECISIONS, importProposalRecordSchema, operationRecordSchema, partnerRecordSchema, project, sameScope } from "../envelope";
import type { Coverage, ImportFileMetaRecord, ImportProposalRecord, ImportRowDecision, ImportRowDecisionRecord, ImportRowResultRecord, ImportRowState, OperationRecord, PartnerRecord, ReadAction, ReadEnvelope, RecordedValueState, Scope } from "../envelope";
import { candidatesOf, importReviewRecordSchema, type ImportReviewRecord } from "../mutations/import";
import { LOCAL_STORE_SYSTEM, type ReadResult } from "../outcome";
import { answerOf, deniedRead, storeUnavailableRead } from "./frame";
const DECISION_LABELS: Readonly<Record<ImportRowDecision, string>> = { "new-private-entry": "Create a new private entry", "reuse-authorized-identity": "Reuse an authorized identity", skip: "Skip the row", unresolved: "Leave unresolved" };
const ROW_STATE_LABELS: Readonly<Record<ImportRowState, string>> = { accepted: "Accepted", "already-accepted": "Accepted by an earlier attempt", skipped: "Skipped", "needs-review": "Needs review", failed: "Failed" };
const DECISION_OPTIONS: readonly ImportDecisionOption[] = Object.freeze(IMPORT_ROW_DECISIONS.map((value) => Object.freeze({ value, label: DECISION_LABELS[value] })));
const PROPOSAL_REVIEW_DETAIL: ImportProposalReviewDetail = Object.freeze({
  recorded: Object.freeze(["column-mapping", "row-decisions", "row-results", "summary"]),
  notRecorded: Object.freeze([]),
  message:
    "The saved proposal holds the columns a field is supplied from, the decision recorded about each row, any row result already recorded, and the summary acceptance is reviewed against. The per-row cells, the per-field issues, the preserved cells and restrictions, and the duplicate-contact suggestions are derived at read time from the file the review stored and the mapping it confirmed. When no review material is shown, it could not be derived — no mapping was confirmed for this file yet, or its stored text no longer reads as the file that was reviewed — and its absence there means it could not be derived, never that none was found.",
});
const PROPOSAL_SOURCE_REFERENCE = "import-proposal";
const RECEIPT_SEARCH_DEPTH = 4;
const IMPORT_COVERAGE: Coverage = Object.freeze({ from: null, to: null, state: "complete" });
const importStateDocumentSchema = z.object({ importProposals: z.array(importProposalRecordSchema), importReviews: z.array(importReviewRecordSchema).optional(), partners: z.array(partnerRecordSchema).optional() });
const operationLedgerDocumentSchema = z.object({ entries: z.array(operationRecordSchema).optional(), records: z.record(z.string().min(1), operationRecordSchema).optional() });
function ledgerEntriesOf(document: z.infer<typeof operationLedgerDocumentSchema>): readonly OperationRecord[] | null {
  if (document.entries === undefined && document.records === undefined) return null;
  const byId = new Map<string, OperationRecord>();
  for (const entry of document.entries ?? []) {
    if (byId.has(entry.operationId)) return null;
    byId.set(entry.operationId, entry);
  }
  for (const [operationId, entry] of Object.entries(document.records ?? {})) {
    if (entry.operationId !== operationId || byId.has(operationId)) return null;
    byId.set(operationId, entry);
  }
  return [...byId.values()];
}
type ImportDocuments = { readonly proposals: readonly ImportProposalRecord[] | null; readonly reviews: readonly ImportReviewRecord[] | null; readonly partners: readonly PartnerRecord[]; readonly entries: readonly OperationRecord[] | null };
export type ImportPagingInput = { readonly page?: number; readonly pageSize?: number };
export type ImportRowWindow = { readonly page: number; readonly pageSize: number; readonly total: number; readonly pageCount: number };
export type ImportRowFilterState = ImportRowState | "not-recorded";
export type ImportRowFilter = { readonly decision?: ImportRowDecision; readonly state?: ImportRowFilterState };
export type ImportLimitView = { readonly id: ImportLimitId; readonly label: string; readonly value: number; readonly unit: ImportLimitUnit; readonly refusesWholeFile: boolean; readonly boundary: string; readonly measured: number | null };
export type ImportProposalColumnView = { readonly columnIndex: number; readonly header: string; readonly occurrence: number; readonly field: string | null; readonly fieldLabel: string | null; readonly ignored: boolean };
export type ImportRepeatedHeaderView = { readonly header: string; readonly columnIndexes: readonly number[] };
export type ImportDecisionOption = { readonly value: ImportRowDecision; readonly label: string };
export type ImportProposalRowRoute = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "correction"; readonly rowNumber: number };
export type ImportProposalRowView = { readonly rowNumber: number; readonly decision: ImportRowDecision; readonly decisionLabel: string } & { readonly reuseTargetPartnerId: string | null; readonly state: ImportRowState | null; readonly stateLabel: string | null } & {
  readonly reason: string | null;
  readonly route: ImportProposalRowRoute | null;
};
export type ImportProposalRowReview = { readonly rowNumber: number; readonly verdict: ImportRowVerdict } & { readonly issues: readonly ImportFieldIssue[]; readonly mappedCells: readonly ImportMappedCell[]; readonly preservedCells: readonly ImportPreservedCell[] } & {
  readonly restrictions: readonly ImportRestriction[];
  readonly suggestions: readonly ImportMatchSuggestion[];
  /** The other rows of this same file this row looks like, or `null` when nothing in the file resembles it: a look-alike signal derived once for the whole file, and neither a verdict nor a decision. */
  readonly duplicateLooking: ImportDuplicateLooking | null;
};
/** What the review step reads: the file's fingerprint, the mapping suggestion, the validation counts and one entry per returned row. */
export type ImportProposalReviewView = { readonly fileFingerprint: string; readonly suggestion: ImportSuggestedMapping } & { readonly counts: ImportValidationCounts | null; readonly problems: readonly ImportValidationProblem[] } & { readonly rows: readonly ImportProposalRowReview[] };
export type ImportProposalSummaryView = { readonly create: number; readonly reuse: number; readonly skip: number; readonly unresolved: number; readonly needsReview: number; readonly rowCount: number; readonly decisionsRecorded: number };
export type ImportProposalReviewDetail = { readonly recorded: readonly string[]; readonly notRecorded: readonly string[]; readonly message: string };
export interface ImportProposalView {
  readonly importOperationId: string;
  readonly processedAt: string | null;
  readonly inFlight: boolean;
  readonly revision: string;
  readonly file: { readonly name: string; readonly bytes: number; readonly rowCount: number; readonly columnCount: number };
  readonly fileFingerprint: string;
  readonly limits: readonly ImportLimitView[];
  readonly columns: readonly ImportProposalColumnView[];
  readonly ignoredColumnIndexes: readonly number[];
  readonly repeatedHeaders: readonly ImportRepeatedHeaderView[];
  readonly decisions: readonly ImportDecisionOption[];
  readonly recordedDecisions: readonly ImportDecisionInput[];
  readonly summary: ImportProposalSummaryView;
  readonly rows: readonly ImportProposalRowView[];
  readonly rowWindow: ImportRowWindow;
  readonly reviewDetail: ImportProposalReviewDetail;
  readonly record: ImportProposalRecord;
  readonly review: ImportProposalReviewView | null;
}
export type ReadImportProposalInput = ImportPagingInput & ImportRowFilter & { readonly importOperationId?: string; readonly session?: SessionSource };
export type ImportReceiptAssignmentView = { readonly columnIndex: number; readonly fieldId: ImportFieldId; readonly fieldLabel: string };
export type ImportReceiptIgnoredColumnView = { readonly columnIndex: number; readonly header: string; readonly occurrence: number; readonly reason: string; readonly message: string };
export type ImportReceiptMappingView = { readonly columnCount: number; readonly assignments: readonly ImportReceiptAssignmentView[]; readonly fields: readonly ImportFieldId[] } & { readonly declined: readonly ImportFieldId[]; readonly unmapped: readonly ImportFieldId[] } & {
  readonly ignored: readonly ImportReceiptIgnoredColumnView[];
};
export type ImportReceiptRowView = { readonly rowNumber: number; readonly decision: ImportRowDecision; readonly decisionLabel: string; readonly state: ImportRowState; readonly stateLabel: string; readonly reasonCode: string; readonly reason: string; readonly route: ImportResultRoute | null };
export type ImportReceiptSummaryView = { readonly create: number; readonly reuse: number; readonly skip: number; readonly unresolved: number; readonly rowCount: number } & { readonly blockedRowCount: number } & {
  readonly blockedReasons: readonly { readonly code: string; readonly label: string; readonly count: number }[];
} & { readonly corrections: readonly { readonly fieldId: string; readonly label: string; readonly count: number }[] } & { readonly correctionCount: number; readonly restrictionsPreserved: number; readonly restrictionsCarried: number };
export type ImportReceiptCancellationView = { readonly cancelledAt: string; readonly acceptedRowsRetained: number; readonly stoppedRows: number };
export interface ImportReceiptView {
  readonly importOperationId: string;
  readonly processedAt: string;
  readonly revision: string;
  readonly file: { readonly name: string; readonly bytes: number; readonly rowCount: number; readonly columnCount: number };
  readonly fileFingerprint: string;
  readonly mapping: ImportReceiptMappingView;
  readonly recordedDecisions: readonly ImportDecisionInput[];
  readonly counts: { readonly accepted: number; readonly alreadyAccepted: number; readonly skipped: number; readonly needsReview: number; readonly failed: number; readonly total: number };
  readonly summary: ImportReceiptSummaryView;
  readonly rows: readonly ImportReceiptRowView[];
  readonly rowWindow: ImportRowWindow;
  readonly cancelled: boolean;
  readonly cancellation: ImportReceiptCancellationView | null;
}
export type ReadImportReceiptInput = ImportPagingInput & ImportRowFilter & { readonly session?: SessionSource };
type ScopeResolution = { readonly ok: true; readonly session: ResolvedSession; readonly scope: Scope } | { readonly ok: false; readonly result: ReadResult<never> };
async function resolveReadScope(job: string, source: SessionSource | undefined): Promise<ScopeResolution> {
  const resolution = await resolveSession(source);
  if (!resolution.ok) {
    recordRefusalOutage(job, resolution.refusal);
    return { ok: false, result: readResultOfRefusal(resolution.refusal) };
  }
  const { session } = resolution;
  if (session.selected === null) return { ok: false, result: deniedRead("not-admitted") };
  const decision = assertScope(session, session.selected);
  return !decision.ok ? { ok: false, result: { kind: "denied", denied: decision.denial } } : { ok: true, session, scope: session.selected };
}
async function readImportDocuments(sessionId: string): Promise<ImportDocuments | undefined> {
  const documents = await readSession(sessionId).catch(() => undefined);
  if (documents === undefined) return undefined;
  const state = importStateDocumentSchema.safeParse(documents.state);
  const ledger = operationLedgerDocumentSchema.safeParse(documents.operations);
  return { proposals: state.success ? state.data.importProposals : null, reviews: state.success ? (state.data.importReviews ?? []) : null, partners: state.success ? (state.data.partners ?? []) : [], entries: ledger.success ? ledgerEntriesOf(ledger.data) : null };
}
type OwnedProposal = { readonly record: ImportProposalRecord; readonly entry: OperationRecord };
/** The ledger as a lookup keyed by the identity each entry is recorded under, built once per read and shared by everything that resolves an identity through it. */
const ledgerIndex = (entries: readonly OperationRecord[]): ReadonlyMap<string, OperationRecord> => new Map(entries.map((entry): [string, OperationRecord] => [entry.operationId, entry]));
/** The proposals this scope owns, each with the ledger entry that records it. */ function ownedProposals(documents: ImportDocuments, scope: Scope, entryByOperationId: ReadonlyMap<string, OperationRecord>): OwnedProposal[] {
  const { proposals, entries } = documents;
  if (proposals === null || entries === null) return [];
  const owned: OwnedProposal[] = [];
  for (const record of proposals) {
    const entry = entryByOperationId.get(record.importOperationId);
    if (entry === undefined || !sameScope(entry.scope, scope)) continue;
    owned.push({ record, entry });
  }
  return owned.sort(newestFirst);
}
function newestFirst(left: OwnedProposal, right: OwnedProposal): number {
  const byInstant = Temporal.Instant.compare(Temporal.Instant.from(right.entry.at), Temporal.Instant.from(left.entry.at));
  return byInstant !== 0 ? byInstant : compareCodeUnits(right.entry.operationId, left.entry.operationId);
}
/** The import an attempt recorded finding: the import identity the result a same-scope ledger entry stores carries. An attempt that answered `unchanged` writes no proposal of its own, so its entry is the only thing that names the import it found. */
function foundImportIdOf(entry: OperationRecord | undefined, scope: Scope): string | null {
  if (entry === undefined || !sameScope(entry.scope, scope) || !isRecord(entry.result)) return null;
  const importOperationId = entry.result["importOperationId"];
  return typeof importOperationId === "string" && importOperationId.length > 0 ? importOperationId : null;
}
/** The proposal a requested identity names: the proposal recorded under it, or the import an attempt that answered `unchanged` recorded finding. */
function proposalNamedBy(owned: readonly OwnedProposal[], requested: string, found: string | null): ImportProposalRecord | undefined {
  let throughAttempt: ImportProposalRecord | undefined;
  for (const proposal of owned) {
    if (proposal.record.importOperationId === requested) return proposal.record;
    if (found !== null && proposal.record.importOperationId === found) throughAttempt = proposal.record;
  }
  return throughAttempt;
}
function pagedRows<T>(rows: readonly T[], paging: ImportPagingInput): { readonly rows: readonly T[]; readonly window: ImportRowWindow } {
  const pageSize = clampPageSize(paging.pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const requested = paging.page;
  const page = requested === undefined || !Number.isFinite(requested) || requested < 1 ? 1 : Math.min(Math.floor(requested), pageCount);
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), window: { page, pageSize, total: rows.length, pageCount } };
}
const measuredState = (value: number | null): RecordedValueState => (value === null ? "unknown" : value === 0 ? "zero" : "value");
const matchesRowFilter = (decision: ImportRowDecision, state: ImportRowState | null, filter: ImportRowFilter): boolean => (filter.decision !== undefined && decision !== filter.decision ? false : filter.state !== undefined && (state ?? "not-recorded") !== filter.state ? false : true);
function fieldLabelOf(fieldId: string): string | null {
  const field = IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId);
  return field === undefined ? null : field.label;
}
type ProposalIndex = { readonly decisions: ReadonlyMap<number, ImportRowDecisionRecord>; readonly results: ReadonlyMap<number, ImportRowResultRecord> };
function indexProposal(record: ImportProposalRecord): ProposalIndex {
  const rowCount = record.fileMeta.rowCount;
  const decisions = new Map<number, ImportRowDecisionRecord>();
  const results = new Map<number, ImportRowResultRecord>();
  for (const decision of record.rowDecisions) if (isReportedRow(decision.rowNumber, rowCount) && !decisions.has(decision.rowNumber)) decisions.set(decision.rowNumber, decision);
  for (const result of record.results) if (isReportedRow(result.rowNumber, rowCount) && !results.has(result.rowNumber)) results.set(result.rowNumber, result);
  return { decisions, results };
}
const isReportedRow = (rowNumber: number, rowCount: number): boolean => Number.isInteger(rowNumber) && rowNumber >= 1 && rowNumber <= rowCount;
function limitViewsOf(fileMeta: ImportFileMetaRecord): readonly ImportLimitView[] {
  return IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => ({ id: descriptor.id, label: descriptor.label, value: descriptor.value, unit: descriptor.unit, refusesWholeFile: descriptor.refusesWholeFile, boundary: descriptor.boundary, measured: measuredValueOf(descriptor.id, fileMeta) }));
}
const MEASURED_LIMIT_VALUES: Readonly<Record<ImportLimitId, (fileMeta: ImportFileMetaRecord) => number | null>> = { "file-bytes": (fileMeta) => fileMeta.bytes, "data-rows": (fileMeta) => fileMeta.rowCount, columns: (fileMeta) => fileMeta.columnCount, "cell-code-points": () => null };
const measuredValueOf = (limitId: ImportLimitId, fileMeta: ImportFileMetaRecord): number | null => MEASURED_LIMIT_VALUES[limitId](fileMeta);
type ProposalColumns = { readonly columns: readonly ImportProposalColumnView[]; readonly ignoredColumnIndexes: readonly number[]; readonly repeatedHeaders: readonly ImportRepeatedHeaderView[] };
function columnsOf(record: ImportProposalRecord): ProposalColumns {
  const occurrences = new Map<string, number>();
  const columns = record.mapping.map((column) => {
    const occurrence = (occurrences.get(column.header) ?? 0) + 1;
    occurrences.set(column.header, occurrence);
    return { columnIndex: column.columnIndex, header: column.header, occurrence, field: column.field, fieldLabel: column.field === null ? null : fieldLabelOf(column.field), ignored: column.field === null };
  });
  const positionsByHeader = new Map<string, number[]>();
  for (const column of columns) {
    const positions = positionsByHeader.get(column.header);
    if (positions === undefined) {
      positionsByHeader.set(column.header, [column.columnIndex]);
    } else positions.push(column.columnIndex);
  }
  const repeatedHeaders: ImportRepeatedHeaderView[] = [];
  for (const [header, columnIndexes] of positionsByHeader) if (columnIndexes.length > 1) repeatedHeaders.push({ header, columnIndexes: [...columnIndexes] });
  return { columns, ignoredColumnIndexes: columns.filter((column) => column.ignored).map((column) => column.columnIndex), repeatedHeaders };
}
function proposalSummaryOf(record: ImportProposalRecord, index: ProposalIndex): ImportProposalSummaryView {
  const counts: Record<ImportRowDecision, number> = { "new-private-entry": 0, "reuse-authorized-identity": 0, skip: 0, unresolved: 0 };
  for (const decision of index.decisions.values()) counts[decision.decision] += 1;
  const decisionsRecorded = index.decisions.size;
  counts.unresolved += record.fileMeta.rowCount - decisionsRecorded;
  return { create: counts["new-private-entry"], reuse: counts["reuse-authorized-identity"], skip: counts.skip, unresolved: counts.unresolved, needsReview: record.summary.needsReview, rowCount: record.fileMeta.rowCount, decisionsRecorded };
}
function proposalRowsOf(record: ImportProposalRecord, index: ProposalIndex): readonly ImportProposalRowView[] {
  const rows: ImportProposalRowView[] = [];
  for (let rowNumber = 1; rowNumber <= record.fileMeta.rowCount; rowNumber += 1) {
    const decisionRecord = index.decisions.get(rowNumber);
    const result = index.results.get(rowNumber);
    const decision = decisionRecord?.decision ?? "unresolved";
    const state = result?.state ?? null;
    const partnerId = result?.partnerId ?? null;
    rows.push({
      rowNumber,
      decision,
      decisionLabel: DECISION_LABELS[decision],
      reuseTargetPartnerId: decision === "reuse-authorized-identity" ? (decisionRecord?.targetPartnerId ?? null) : null,
      state,
      stateLabel: state === null ? null : ROW_STATE_LABELS[state],
      reason: result?.message ?? null,
      route: proposalRouteOf(rowNumber, state, partnerId),
    });
  }
  return rows;
}
const PROPOSAL_ROUTES: Readonly<Record<ImportRowState, (rowNumber: number, partnerId: string | null) => ImportProposalRowRoute | null>> = {
  skipped: () => null,
  accepted: (_rowNumber, partnerId) => (partnerId === null ? null : { kind: "partner", partnerId }),
  "already-accepted": (_rowNumber, partnerId) => (partnerId === null ? null : { kind: "partner", partnerId }),
  "needs-review": (rowNumber) => ({ kind: "correction", rowNumber }),
  failed: (rowNumber) => ({ kind: "correction", rowNumber }),
};
const proposalRouteOf = (rowNumber: number, state: ImportRowState | null, partnerId: string | null): ImportProposalRowRoute | null => (state === null ? null : PROPOSAL_ROUTES[state](rowNumber, partnerId));
async function proposalReviewOf(stored: ImportReviewRecord | undefined, window: readonly ImportProposalRowView[], partners: readonly PartnerRecord[]): Promise<ImportProposalReviewView | null> {
  if (stored === undefined) return null;
  const parsed = await parseCsv(stored.text);
  if (!parsed.ok || parsed.file.columnCount !== stored.columnCount || parsed.file.dataRowCount !== stored.rowCount) return null;
  const file = parsed.file;
  const fileFingerprint = fingerprintOf(file).checksum;
  const suggestion = suggestMapping(file);
  const mapping = stored.mapping;
  if (mapping === null) return { fileFingerprint, suggestion, counts: null, problems: [], rows: [] };
  const validation = validateRows(file, mapping);
  // The rows are compared with each other once for the whole file rather than once per returned row: a look-alike pair can straddle two windows, and the answer is a property of the file the worker is importing.
  const duplicateLooking = flagDuplicateLookingRows(validation.rows);
  const candidates = candidatesOf(partners);
  const validatedByRow = new Map(validation.rows.map((row) => [row.rowNumber, row] as const));
  const rows: ImportProposalRowReview[] = [];
  for (const row of window) {
    const validated = validatedByRow.get(row.rowNumber);
    // A returned row the derived file does not carry is not reported as a row with nothing wrong: the whole derivation is unavailable, which the null says plainly.
    if (validated === undefined) return null;
    rows.push({
      rowNumber: validated.rowNumber,
      verdict: validated.verdict,
      issues: validated.issues,
      mappedCells: validated.mappedCells,
      preservedCells: validated.preservedCells,
      restrictions: validated.restrictions,
      suggestions: suggestMatches(validated, candidates).suggestions,
      duplicateLooking: duplicateLooking.get(validated.rowNumber) ?? null,
    });
  }
  return { fileFingerprint, suggestion, counts: validation.counts, problems: validation.problems, rows };
}
const DECISION_KINDS: Readonly<Record<ImportRowDecision, ImportDecisionKind>> = { "new-private-entry": "create", "reuse-authorized-identity": "reuse", skip: "skip", unresolved: "unresolved" };
const decisionKindOf = (decision: ImportRowDecision): ImportDecisionKind => DECISION_KINDS[decision];
const storedCandidateOf = (decision: ImportRowDecisionRecord): ImportMatchReference | null => (decision.candidate !== null ? { ...decision.candidate } : decision.decision !== "reuse-authorized-identity" || decision.targetPartnerId === null ? null : { system: LOCAL_STORE_SYSTEM, reference: decision.targetPartnerId });
function recordedDecisionInputsOf(decisions: ReadonlyMap<number, ImportRowDecisionRecord>): readonly ImportDecisionInput[] {
  return [...decisions.values()]
    .sort((left, right) => left.rowNumber - right.rowNumber)
    .map((decision) => decisionInputOf({ kind: decisionKindOf(decision.decision), rowNumber: decision.rowNumber, corrections: decision.corrections.map((correction) => ({ columnNumber: correction.columnNumber, value: correction.value })), candidate: storedCandidateOf(decision), reason: decision.reason ?? "" }));
}
function proposalValueStates(record: ImportProposalRecord, summary: ImportProposalSummaryView, limits: readonly ImportLimitView[], window: ImportRowWindow): Readonly<Record<string, RecordedValueState>> {
  const states: Record<string, RecordedValueState> = {
    "file.bytes": measuredState(record.fileMeta.bytes),
    "file.rowCount": measuredState(record.fileMeta.rowCount),
    "file.columnCount": measuredState(record.fileMeta.columnCount),
    "summary.create": measuredState(summary.create),
    "summary.reuse": measuredState(summary.reuse),
    "summary.skip": measuredState(summary.skip),
    "summary.unresolved": measuredState(summary.unresolved),
    "summary.needsReview": measuredState(summary.needsReview),
    "summary.rowCount": measuredState(summary.rowCount),
    "summary.decisionsRecorded": measuredState(summary.decisionsRecorded),
    "rows.total": measuredState(window.total),
  };
  for (const limit of limits) states[`limits.${limit.id}.measured`] = measuredState(limit.measured);
  return states;
}
function proposalActions(summary: ImportProposalSummaryView): readonly ReadAction[] {
  return [
    { name: "setRowDecision", available: true },
    summary.create + summary.reuse > 0 ? { name: "acceptImportRows", available: true } : { name: "acceptImportRows", available: false, reason: "No row is decided for a new entry or a reuse yet, so there is nothing to accept. Decide about a row, or skip it, before importing." },
    { name: "cancelImport", available: true },
  ];
}
const RECEIPT_SUMMARY_KEYS = ["counts", "totalRowCount", "blockedRowCount", "blockedReasons", "corrections", "correctionCount", "restrictionsPreserved", "restrictionsCarried"] as const satisfies readonly (keyof ImportDecisionSummary)[];
function receiptSummaryOf(receipt: ImportReceipt): ImportReceiptSummaryView {
  const summary = project(receipt.summary, RECEIPT_SUMMARY_KEYS);
  return {
    create: summary.counts.create,
    reuse: summary.counts.reuse,
    skip: summary.counts.skip,
    unresolved: summary.counts.unresolved,
    rowCount: summary.totalRowCount,
    blockedRowCount: summary.blockedRowCount,
    blockedReasons: summary.blockedReasons.map((reason) => ({ code: reason.code, label: reason.label, count: reason.count })),
    corrections: summary.corrections.map((correction) => ({ fieldId: correction.fieldId, label: correction.label, count: correction.count })),
    correctionCount: summary.correctionCount,
    restrictionsPreserved: summary.restrictionsPreserved,
    restrictionsCarried: summary.restrictionsCarried,
  };
}
function receiptMappingOf(receipt: ImportReceipt): ImportReceiptMappingView {
  return {
    columnCount: receipt.mapping.columnCount,
    assignments: receipt.mapping.assignments.map((assignment) => ({ columnIndex: assignment.columnIndex, fieldId: assignment.fieldId, fieldLabel: fieldLabelOf(assignment.fieldId) ?? assignment.fieldId })),
    fields: [...receipt.mapping.fields],
    declined: [...receipt.mapping.declined],
    unmapped: [...receipt.mapping.unmapped],
    ignored: receipt.mapping.ignored.map((column) => ({ columnIndex: column.index, header: column.header, occurrence: column.occurrence, reason: column.reason, message: column.message })),
  };
}
function receiptRowsOf(receipt: ImportReceipt): readonly ImportReceiptRowView[] {
  const decisions = new Map<number, ImportDecisionKind>();
  for (const decision of receipt.rowDecisions.decisions) if (!decisions.has(decision.rowNumber)) decisions.set(decision.rowNumber, decision.kind);
  return receipt.results.map((result) => {
    const decision = rowDecisionOf(decisions.get(result.rowNumber) ?? "unresolved");
    return { rowNumber: result.rowNumber, decision, decisionLabel: DECISION_LABELS[decision], state: result.state, stateLabel: ROW_STATE_LABELS[result.state], reasonCode: result.reasonCode, reason: result.reason, route: result.route };
  });
}
const ROW_DECISIONS: Readonly<Record<ImportDecisionKind, ImportRowDecision>> = { create: "new-private-entry", reuse: "reuse-authorized-identity", skip: "skip", unresolved: "unresolved" };
const rowDecisionOf = (kind: ImportDecisionKind): ImportRowDecision => ROW_DECISIONS[kind];
function receiptDecisionInputsOf(receipt: ImportReceipt): readonly ImportDecisionInput[] {
  const seen = new Set<number>();
  const inputs: ImportDecisionInput[] = [];
  for (const decision of receipt.rowDecisions.decisions) {
    if (seen.has(decision.rowNumber)) continue;
    seen.add(decision.rowNumber);
    inputs.push(recordedDecisionInputOf(decision));
  }
  return inputs;
}
function receiptRevisionOf(receipt: ImportReceipt): string {
  const state = receipt.cancellation === null ? "accepted" : `cancelled:${receipt.cancellation.cancelledAt}`;
  return `${receipt.receiptFormat}:${receipt.fingerprint.checksum}:${state}`;
}
function receiptValueStates(receipt: ImportReceipt, summary: ImportReceiptSummaryView, window: ImportRowWindow): Readonly<Record<string, RecordedValueState>> {
  const states: Record<string, RecordedValueState> = {
    "file.bytes": measuredState(receipt.fileMeta.bytes),
    "file.rowCount": measuredState(receipt.fileMeta.rowCount),
    "file.columnCount": measuredState(receipt.fileMeta.columnCount),
    "counts.accepted": measuredState(receipt.counts.accepted),
    "counts.alreadyAccepted": measuredState(receipt.counts.alreadyAccepted),
    "counts.skipped": measuredState(receipt.counts.skipped),
    "counts.needsReview": measuredState(receipt.counts.needsReview),
    "counts.failed": measuredState(receipt.counts.failed),
    "counts.total": measuredState(receipt.counts.total),
    "summary.rowCount": measuredState(summary.rowCount),
    "summary.blockedRowCount": measuredState(summary.blockedRowCount),
    "summary.correctionCount": measuredState(summary.correctionCount),
    "summary.restrictionsPreserved": measuredState(summary.restrictionsPreserved),
    "summary.restrictionsCarried": measuredState(summary.restrictionsCarried),
    "rows.total": measuredState(window.total),
  };
  if (receipt.cancellation !== null) {
    states["cancellation.acceptedRowsRetained"] = measuredState(receipt.cancellation.acceptedRowsRetained);
    states["cancellation.stoppedRows"] = measuredState(receipt.cancellation.stoppedRows);
  }
  return states;
}
function receiptActions(receipt: ImportReceipt): readonly ReadAction[] {
  if (receipt.cancellation !== null) return [{ name: "cancelImport", available: false, reason: "This import was already cancelled, and the rows it stopped stay stopped. Nothing is recalled, and no row is applied again from this receipt." }];
  return receipt.counts.total - receipt.counts.accepted - receipt.counts.alreadyAccepted > 0 ? [{ name: "cancelImport", available: true }] : [{ name: "cancelImport", available: false, reason: "Every row of this file was accepted, so there is nothing left for a cancellation to stop and nothing to recall." }];
}
/** The first contact-import receipt a recorded result carries, read under the import operation identity the receipt itself states: an attempt records its receipt in its own ledger entry, and that receipt names the import it belongs to rather than the attempt that ran it. */
function findStoredReceipt(value: unknown, depth = 0): ImportReceiptRead | null {
  if (depth > RECEIPT_SEARCH_DEPTH || value === null || value === undefined) return null;
  if (isRecord(value) && value["receiptFormat"] === IMPORT_RECEIPT_FORMAT) {
    const identity = value["importOperationId"];
    return readStoredReceipt(value, typeof identity === "string" ? identity : "");
  }
  for (const child of Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : []) {
    const found = findStoredReceipt(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}
/** Reads the import proposal the caller is reviewing: the chosen file with every displayed limit and its measured value, the mapping column by column, the decision recorded about each row, the decisions it holds, the stored record itself and the review material re-derived from the file that record holds. Answers `envelope`, or the read's own refusal: `unavailable` when the records cannot be read, `refused` when the query this read was asked to serve is the fault. */
export async function readImportProposal(input: ReadImportProposalInput = {}): Promise<ReadResult<ReadEnvelope<ImportProposalView>>> {
  const resolved = await resolveReadScope("readImportProposal", input.session);
  if (!resolved.ok) return resolved.result;
  const { session, scope } = resolved;
  const documents = await readImportDocuments(session.sessionId);
  if (documents === undefined) return storeUnavailableRead("read-import-proposal", PROPOSAL_SOURCE_REFERENCE, "The store could not be read for this session, so no import proposal can be shown. Try again once the store answers; this request changed nothing.");
  if (documents.proposals === null || documents.reviews === null || documents.entries === null) {
    return storeUnavailableRead(
      "read-import-proposal",
      PROPOSAL_SOURCE_REFERENCE,
      "This session's import proposal cannot be read as this build records it, so no proposal is shown rather than an empty one. Start the import again; nothing that was already accepted is affected, and a finished import is read from its receipt by operation identity.",
    );
  }
  const entryByOperationId = ledgerIndex(documents.entries);
  const owned = ownedProposals(documents, scope, entryByOperationId);
  const requested = input.importOperationId;
  // Only the current proposal is returned, and a named identity may be the proposal's own or an attempt that answered `unchanged` and recorded the import it found, so it is resolved through that attempt's entry too: the review such an attempt found stays reachable by the only identity its caller holds. The resolution never reaches past the owned proposals, so an identity that names nothing answers exactly as one that never existed.
  const record = requested === undefined ? owned.find((proposal) => proposal.record.processedAt === null)?.record : proposalNamedBy(owned, requested, foundImportIdOf(entryByOperationId.get(requested), scope));
  if (record === undefined) {
    return requested === undefined
      ? storeUnavailableRead("read-import-proposal", PROPOSAL_SOURCE_REFERENCE, "No import proposal is in flight for this context: none has been started, or the one that was has already been accepted and is read from its receipt by operation identity. Choose a file to start an import.")
      : deniedRead("no-permission");
  }
  const index = indexProposal(record);
  const columns = columnsOf(record);
  const limits = limitViewsOf(record.fileMeta);
  const summary = proposalSummaryOf(record, index);
  const paged = pagedRows(
    proposalRowsOf(record, index).filter((row) => matchesRowFilter(row.decision, row.state, input)),
    input,
  );
  const review = await proposalReviewOf(
    documents.reviews.find((candidate) => candidate.importOperationId === record.importOperationId),
    paged.rows,
    documents.partners,
  );
  const view: ImportProposalView = {
    importOperationId: record.importOperationId,
    processedAt: record.processedAt,
    inFlight: record.processedAt === null,
    revision: record.revision,
    file: { name: record.fileMeta.name, bytes: record.fileMeta.bytes, rowCount: record.fileMeta.rowCount, columnCount: record.fileMeta.columnCount },
    fileFingerprint: record.fingerprint.checksum,
    limits,
    columns: columns.columns,
    ignoredColumnIndexes: columns.ignoredColumnIndexes,
    repeatedHeaders: columns.repeatedHeaders,
    decisions: DECISION_OPTIONS,
    recordedDecisions: recordedDecisionInputsOf(index.decisions),
    summary,
    rows: paged.rows,
    rowWindow: paged.window,
    reviewDetail: PROPOSAL_REVIEW_DETAIL,
    record,
    review,
  };
  return answerOf(scope, instantAt(session.clockOffsetMs).toString(), {
    data: view,
    source: { system: LOCAL_STORE_SYSTEM, reference: record.importOperationId },
    revision: record.revision,
    coverage: IMPORT_COVERAGE,
    valueStates: proposalValueStates(record, summary, limits, paged.window),
    actions: proposalActions(summary),
  });
}
/** Reads the recoverable receipt of one import acceptance by its operation identity: what became of each data row, where to go next, and the counts those results add up to. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readImportReceipt(importOperationId: string, input: ReadImportReceiptInput = {}): Promise<ReadResult<ReadEnvelope<ImportReceiptView>>> {
  const resolved = await resolveReadScope("readImportReceipt", input.session);
  if (!resolved.ok) return resolved.result;
  const { session, scope } = resolved;
  if (importOperationId.length === 0) return deniedRead("no-permission");
  const documents = await readImportDocuments(session.sessionId);
  if (documents === undefined) return storeUnavailableRead("read-import-receipt", importOperationId, "The store could not be read for this session, so this import operation's receipt cannot be shown. Try again once the store answers; reading a receipt applies nothing, so nothing changed.");
  if (documents.entries === null)
    return storeUnavailableRead("read-import-receipt", importOperationId, "This session's operation ledger cannot be read as this build records it, so this receipt cannot be shown rather than shown as empty. Do not repeat the import: the rows it already applied are recorded, and this read applies nothing.");
  if (documents.reviews === null)
    return storeUnavailableRead("read-import-receipt", importOperationId, "This session's import reviews cannot be read as this build records them, so this receipt cannot be shown rather than shown as empty. Do not repeat the import: the rows it already applied are recorded, and this read applies nothing.");
  const ownedEntries = documents.entries.filter((candidate) => candidate.operationId === importOperationId && sameScope(candidate.scope, scope));
  const ownedReview = documents.reviews.find((candidate) => candidate.importOperationId === importOperationId && sameScope(candidate.scope, scope)) ?? null;
  // The import an identity names: the import itself, when its review is recorded under that identity, or the import an attempt recorded — the identity a receipt or a proposal it stored states. An identity that names neither answers exactly as one that never existed, so no other import is ever reachable through it.
  const importId = ownedReview === null ? foundImportIdOf(ownedEntries[0], scope) : ownedReview.importOperationId;
  if (importId === null) return deniedRead("no-permission");
  // An attempt's own evidence first: the receipt recorded in its ledger entry, which reports the state at the moment it ran, so a later cancellation never rewrites what an acceptance did. Then the import's own record, which is the review keyed by the import operation identity and therefore states the import as it now stands, cancellation included.
  let stored: ImportReceiptRead | null = null;
  for (const entry of ownedEntries) {
    stored = findStoredReceipt(entry.result);
    if (stored !== null) break;
  }
  if (stored === null || stored.kind === "not-found") {
    const importReview = ownedReview ?? documents.reviews.find((candidate) => candidate.importOperationId === importId && sameScope(candidate.scope, scope)) ?? null;
    stored = importReview === null ? null : readStoredReceipt(importReview.receipt, importId);
  }
  if (stored === null || stored.kind === "not-found") return deniedRead("no-permission");
  if (stored.kind === "unavailable") return storeUnavailableRead("read-import-receipt", importOperationId, stored.reason);
  const receipt = stored.receipt;
  const summary = receiptSummaryOf(receipt);
  const paged = pagedRows(
    receiptRowsOf(receipt).filter((row) => matchesRowFilter(row.decision, row.state, input)),
    input,
  );
  const cancellation = receipt.cancellation;
  // The one mutation this view offers is the cancellation of the import, and the revision such a mutation must present is the import record's: the receipt's own revision strings together its format, its file fingerprint and the state it reports, which is not a concurrency token any write accepts.
  const importRecord = documents.proposals?.find((candidate) => candidate.importOperationId === importId) ?? null;
  const view: ImportReceiptView = {
    importOperationId: receipt.importOperationId,
    processedAt: receipt.processedAt,
    revision: receiptRevisionOf(receipt),
    file: { name: receipt.fileMeta.name, bytes: receipt.fileMeta.bytes, rowCount: receipt.fileMeta.rowCount, columnCount: receipt.fileMeta.columnCount },
    fileFingerprint: receipt.fingerprint.checksum,
    mapping: receiptMappingOf(receipt),
    recordedDecisions: receiptDecisionInputsOf(receipt),
    counts: { accepted: receipt.counts.accepted, alreadyAccepted: receipt.counts.alreadyAccepted, skipped: receipt.counts.skipped, needsReview: receipt.counts.needsReview, failed: receipt.counts.failed, total: receipt.counts.total },
    summary,
    rows: paged.rows,
    rowWindow: paged.window,
    cancelled: cancellation !== null,
    cancellation: cancellation === null ? null : { cancelledAt: cancellation.cancelledAt, acceptedRowsRetained: cancellation.acceptedRowsRetained, stoppedRows: cancellation.stoppedRows },
  };
  return answerOf(scope, instantAt(session.clockOffsetMs).toString(), {
    data: view,
    source: { system: LOCAL_STORE_SYSTEM, reference: receipt.importOperationId },
    revision: importRecord === null ? view.revision : importRecord.revision,
    coverage: IMPORT_COVERAGE,
    valueStates: receiptValueStates(receipt, summary, paged.window),
    actions: receiptActions(receipt),
  });
}
