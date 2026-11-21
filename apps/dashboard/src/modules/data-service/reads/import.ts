/**
 * Contact import reads: the proposal a worker is reviewing, and the recoverable receipt of an
 * acceptance looked up by its operation identity.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import { assertNever } from "@/lib/result";
import type { ImportDecisionKind, ImportDecisionSummary } from "@/modules/import/decide";
import { IMPORT_FIELD_VOCABULARY, type ImportFieldId } from "@/modules/import/map";
import { IMPORT_LIMIT_DESCRIPTORS, type ImportLimitId, type ImportLimitUnit } from "@/modules/import/parse";
import { IMPORT_RECEIPT_FORMAT, readStoredReceipt, type ImportReceipt, type ImportReceiptRead, type ImportResultRoute } from "@/modules/import/receipt";
import { readSession } from "@/modules/store/repository";
import { clampPageSize } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { assertScope, readResultOfRefusal, resolveSession, type ResolvedSession, type SessionSource } from "../authorize";
import {
  IMPORT_ROW_DECISIONS,
  buildEnvelope,
  importProposalRecordSchema,
  operationRecordSchema,
  project,
  sameScope,
  type Coverage,
  type ImportFileMetaRecord,
  type ImportProposalRecord,
  type ImportRowDecision,
  type ImportRowDecisionRecord,
  type ImportRowResultRecord,
  type ImportRowState,
  type OperationRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type Scope,
} from "../envelope";
import { LOCAL_STORE_SYSTEM, denied, unavailable, type DenialReason, type ReadResult } from "../outcome";
// Copy the review and result steps show, in the closed vocabularies the record stores
const DECISION_LABELS: Readonly<Record<ImportRowDecision, string>> = {
  "new-private-entry": "Create a new private entry",
  "reuse-authorized-identity": "Reuse an authorized identity",
  skip: "Skip the row",
  unresolved: "Leave unresolved",
};
const ROW_STATE_LABELS: Readonly<Record<ImportRowState, string>> = {
  accepted: "Accepted",
  "already-accepted": "Accepted by an earlier attempt",
  skipped: "Skipped",
  "needs-review": "Needs review",
  failed: "Failed",
};
const DECISION_OPTIONS: readonly ImportDecisionOption[] = Object.freeze(IMPORT_ROW_DECISIONS.map((value) => Object.freeze({ value, label: DECISION_LABELS[value] })));

const PROPOSAL_REVIEW_DETAIL: ImportProposalReviewDetail = Object.freeze({
  recorded: Object.freeze(["column-mapping", "row-decisions", "row-results", "summary"]),
  notRecorded: Object.freeze(["duplicate-contact-suggestions", "preserved-restrictions", "field-issues", "preserved-cells", "unused-columns-and-their-reasons"]),
  message:
    "The saved proposal holds the columns a field is supplied from, the decision recorded about each row, any row result already recorded, and the summary acceptance is reviewed against. Duplicate-contact suggestions, preserved restrictions, per-field issues and the columns no field uses — with the reason each was left out — belong to the review step that produced this proposal and are not part of the saved record, so their absence here means they were not recorded — never that none was found.",
});
// Fixed values of this read
const READ_ATTEMPT_ID = "read";

const PROPOSAL_SOURCE_REFERENCE = "import-proposal";

const RECEIPT_SEARCH_DEPTH = 4;

const IMPORT_COVERAGE: Coverage = Object.freeze({ from: null, to: null, state: "complete" });
// The stored documents these reads open, validated before any of them is trusted
const importStateDocumentSchema = z.object({
  importProposals: z.array(importProposalRecordSchema),
});
const operationLedgerDocumentSchema = z.object({
  entries: z.array(operationRecordSchema).optional(),
  records: z.record(z.string().min(1), operationRecordSchema).optional(),
});
function ledgerEntriesOf(document: z.infer<typeof operationLedgerDocumentSchema>): readonly OperationRecord[] | null {
  if (document.entries === undefined && document.records === undefined) {
    return null;
  }
  const byId = new Map<string, OperationRecord>();
  for (const entry of document.entries ?? []) {
    if (byId.has(entry.operationId)) {
      return null;
    }
    byId.set(entry.operationId, entry);
  }
  for (const [operationId, entry] of Object.entries(document.records ?? {})) {
    if (entry.operationId !== operationId || byId.has(operationId)) {
      return null;
    }
    byId.set(operationId, entry);
  }
  return [...byId.values()];
}
interface ImportDocuments {
  readonly proposals: readonly ImportProposalRecord[] | null;
  readonly entries: readonly OperationRecord[] | null;
}
// What a proposal read returns
/** Paging of a per-row detail list. */
export interface ImportPagingInput {
  readonly page?: number;
  readonly pageSize?: number;
}
/** The paging a read actually applied, so a surface states the window it is showing. */
export interface ImportRowWindow {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly pageCount: number;
}
/** A result state a row can be filtered by, plus the state of a row nothing has been recorded for. */
export type ImportRowFilterState = ImportRowState | "not-recorded";
/** One filter a caller may apply to the per-row detail. */
export interface ImportRowFilter {
  readonly decision?: ImportRowDecision;
  readonly state?: ImportRowFilterState;
}
/** One displayed limit, with this file's measured value in the limit's own unit beside it. */
export interface ImportLimitView {
  readonly id: ImportLimitId;
  readonly label: string;
  readonly value: number;
  readonly unit: ImportLimitUnit;
  readonly refusesWholeFile: boolean;
  readonly boundary: string;
  readonly measured: number | null;
}
/** One column of the file, addressed by position so a repeated header stays a distinct column. */
export interface ImportProposalColumnView {
  readonly columnIndex: number;
  readonly header: string;
  readonly occurrence: number;
  readonly field: string | null;
  readonly fieldLabel: string | null;
  readonly ignored: boolean;
}
/** A header text carried by more than one column, with every position that carries it. */
export interface ImportRepeatedHeaderView {
  readonly header: string;
  readonly columnIndexes: readonly number[];
}
/** A decision the review step offers, with the wording it shows beside it. */
export interface ImportDecisionOption {
  readonly value: ImportRowDecision;
  readonly label: string;
}
/** Where a row of a proposal sends the worker next, as data rather than as a URL. */
export type ImportProposalRowRoute = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "correction"; readonly rowNumber: number };
/** One row of a proposal: its decision, whatever result is already recorded, and the route to it. */
export interface ImportProposalRowView {
  readonly rowNumber: number;
  readonly decision: ImportRowDecision;
  readonly decisionLabel: string;
  readonly reuseTargetPartnerId: string | null;
  readonly state: ImportRowState | null;
  readonly stateLabel: string | null;
  readonly reason: string | null;
  readonly route: ImportProposalRowRoute | null;
}
/** How the file's rows divide, stated per decision so nothing is aggregated into one "contacts" number. */
export interface ImportProposalSummaryView {
  readonly create: number;
  readonly reuse: number;
  readonly skip: number;
  readonly unresolved: number;
  readonly needsReview: number;
  readonly rowCount: number;
  readonly decisionsRecorded: number;
}
/** What the saved proposal holds of the review step's detail, and what it does not. */
export interface ImportProposalReviewDetail {
  readonly recorded: readonly string[];
  readonly notRecorded: readonly string[];
  readonly message: string;
}
/** Everything a proposal read returns: the file, its limits, its mapping, its rows and its summary. */
export interface ImportProposalView {
  readonly importOperationId: string;
  readonly processedAt: string | null;
  readonly inFlight: boolean;
  readonly revision: string;
  readonly file: {
    readonly name: string;
    readonly bytes: number;
    readonly rowCount: number;
    readonly columnCount: number;
  };
  readonly limits: readonly ImportLimitView[];
  readonly columns: readonly ImportProposalColumnView[];
  readonly ignoredColumnIndexes: readonly number[];
  readonly repeatedHeaders: readonly ImportRepeatedHeaderView[];
  readonly decisions: readonly ImportDecisionOption[];
  readonly summary: ImportProposalSummaryView;
  readonly rows: readonly ImportProposalRowView[];
  readonly rowWindow: ImportRowWindow;
  readonly reviewDetail: ImportProposalReviewDetail;
}
/** What a caller may ask a proposal read for. */
export interface ReadImportProposalInput extends ImportPagingInput, ImportRowFilter {
  readonly importOperationId?: string;
  readonly session?: SessionSource;
}
// What a receipt read returns
/** What the receipt's confirmed mapping says one column supplies. */
export interface ImportReceiptAssignmentView {
  readonly columnIndex: number;
  readonly fieldId: ImportFieldId;
  readonly fieldLabel: string;
}
/** A column the confirmed mapping does not use, with the factual reason it was left out. */
export interface ImportReceiptIgnoredColumnView {
  readonly columnIndex: number;
  readonly header: string;
  readonly occurrence: number;
  readonly reason: string;
  readonly message: string;
}
/** The mapping acceptance was reviewed under, so a receipt explains which column became which field. */
export interface ImportReceiptMappingView {
  readonly columnCount: number;
  readonly assignments: readonly ImportReceiptAssignmentView[];
  readonly fields: readonly ImportFieldId[];
  readonly declined: readonly ImportFieldId[];
  readonly unmapped: readonly ImportFieldId[];
  readonly ignored: readonly ImportReceiptIgnoredColumnView[];
}
/** One row's result: what happened to it, why, and where the worker can go next. */
export interface ImportReceiptRowView {
  readonly rowNumber: number;
  readonly decision: ImportRowDecision;
  readonly decisionLabel: string;
  readonly state: ImportRowState;
  readonly stateLabel: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly route: ImportResultRoute | null;
}
/** The summary acceptance was reviewed against, as the receipt recorded it. */
export interface ImportReceiptSummaryView {
  readonly create: number;
  readonly reuse: number;
  readonly skip: number;
  readonly unresolved: number;
  readonly rowCount: number;
  readonly blockedRowCount: number;
  readonly blockedReasons: readonly {
    readonly code: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly corrections: readonly {
    readonly fieldId: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly correctionCount: number;
  readonly restrictionsPreserved: number;
  readonly restrictionsCarried: number;
}
/** What a cancellation did: the accepted rows it left in place and the rows it stopped. */
export interface ImportReceiptCancellationView {
  readonly cancelledAt: string;
  readonly acceptedRowsRetained: number;
  readonly stoppedRows: number;
}
/** The recoverable receipt of one acceptance: the file it read, the mapping and decisions it was accepted under, the summary it was reviewed against, one result per data row, the counts those. */
export interface ImportReceiptView {
  readonly importOperationId: string;
  readonly processedAt: string;
  readonly revision: string;
  readonly file: {
    readonly name: string;
    readonly bytes: number;
    readonly rowCount: number;
    readonly columnCount: number;
  };
  readonly mapping: ImportReceiptMappingView;
  readonly counts: {
    readonly accepted: number;
    readonly alreadyAccepted: number;
    readonly skipped: number;
    readonly needsReview: number;
    readonly failed: number;
    readonly total: number;
  };
  readonly summary: ImportReceiptSummaryView;
  readonly rows: readonly ImportReceiptRowView[];
  readonly rowWindow: ImportRowWindow;
  readonly cancelled: boolean;
  readonly cancellation: ImportReceiptCancellationView | null;
}
/** What a caller may ask a receipt read for: the operation identity, plus how to show its rows. */
export interface ReadImportReceiptInput extends ImportPagingInput, ImportRowFilter {
  readonly session?: SessionSource;
}
// The caller: one session, one scope, and one shape for each refusal
type ScopeResolution = { readonly ok: true; readonly session: ResolvedSession; readonly scope: Scope } | { readonly ok: false; readonly result: ReadResult<never> };

async function resolveReadScope(source: SessionSource | undefined): Promise<ScopeResolution> {
  const resolution = await resolveSession(source);
  if (!resolution.ok) {
    return { ok: false, result: readResultOfRefusal(resolution.refusal) };
  }
  const { session } = resolution;
  if (session.selected === null) {
    // A session that has selected no context is not admitted to act anywhere yet, so the read is
    // refused rather than run against an invented scope. The refusal names the caller's relationship
    // and nothing about what was asked for.
    return { ok: false, result: importDenied("not-admitted") };
  }
  const decision = assertScope(session, session.selected);
  if (!decision.ok) {
    return { ok: false, result: { kind: "denied", denied: decision.denial } };
  }
  return { ok: true, session, scope: session.selected };
}
function importDenied(reason: DenialReason = "no-permission"): ReadResult<never> {
  return { kind: "denied", denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }) };
}
function importUnavailable(job: string, reference: string, guidance: string): ReadResult<never> {
  const source = { system: LOCAL_STORE_SYSTEM, reference };
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}
async function readImportDocuments(sessionId: string): Promise<ImportDocuments | undefined> {
  try {
    const documents = await readSession(sessionId);
    if (documents === undefined) {
      return undefined;
    }
    const state = importStateDocumentSchema.safeParse(documents.state);
    const ledger = operationLedgerDocumentSchema.safeParse(documents.operations);
    return {
      proposals: state.success ? state.data.importProposals : null,
      entries: ledger.success ? ledgerEntriesOf(ledger.data) : null,
    };
  } catch {
    // A corrupt or unreadable document means the store cannot answer. The refusal says that and
    // nothing more: naming the document, the path or the fault would disclose where records live.
    return undefined;
  }
}
// Ownership: a proposal belongs to the scope its operation was recorded under
interface OwnedProposal {
  readonly record: ImportProposalRecord;
  readonly entry: OperationRecord;
}
function ownedProposals(documents: ImportDocuments, scope: Scope): OwnedProposal[] {
  const { proposals, entries } = documents;
  if (proposals === null || entries === null) {
    return [];
  }
  const owned: OwnedProposal[] = [];
  for (const record of proposals) {
    const entry = entries.find((candidate) => candidate.operationId === record.importOperationId);
    if (entry === undefined || !sameScope(entry.scope, scope)) {
      continue;
    }
    owned.push({ record, entry });
  }
  return owned.sort(newestFirst);
}
function newestFirst(left: OwnedProposal, right: OwnedProposal): number {
  const byInstant = Temporal.Instant.compare(Temporal.Instant.from(right.entry.at), Temporal.Instant.from(left.entry.at));
  if (byInstant !== 0) {
    return byInstant;
  }
  return compareCodeUnits(right.entry.operationId, left.entry.operationId);
}
// Paging and value states, shared by both reads
function pagedRows<T>(rows: readonly T[], paging: ImportPagingInput): { readonly rows: readonly T[]; readonly window: ImportRowWindow } {
  const pageSize = clampPageSize(paging.pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const requested = paging.page;
  const page = requested === undefined || !Number.isFinite(requested) || requested < 1 ? 1 : Math.min(Math.floor(requested), pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    window: { page, pageSize, total: rows.length, pageCount },
  };
}
function measuredState(value: number | null): RecordedValueState {
  if (value === null) {
    return "unknown";
  }
  return value === 0 ? "zero" : "value";
}
function matchesRowFilter(decision: ImportRowDecision, state: ImportRowState | null, filter: ImportRowFilter): boolean {
  if (filter.decision !== undefined && decision !== filter.decision) {
    return false;
  }
  if (filter.state !== undefined && (state ?? "not-recorded") !== filter.state) {
    return false;
  }
  return true;
}
function fieldLabelOf(fieldId: string): string | null {
  const field = IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId);
  return field === undefined ? null : field.label;
}
// A proposal, projected from the record the review step saved
interface ProposalIndex {
  readonly decisions: ReadonlyMap<number, ImportRowDecisionRecord>;
  readonly results: ReadonlyMap<number, ImportRowResultRecord>;
}
function indexProposal(record: ImportProposalRecord): ProposalIndex {
  const rowCount = record.fileMeta.rowCount;
  const decisions = new Map<number, ImportRowDecisionRecord>();
  const results = new Map<number, ImportRowResultRecord>();
  for (const decision of record.rowDecisions) {
    if (isReportedRow(decision.rowNumber, rowCount) && !decisions.has(decision.rowNumber)) {
      decisions.set(decision.rowNumber, decision);
    }
  }
  for (const result of record.results) {
    if (isReportedRow(result.rowNumber, rowCount) && !results.has(result.rowNumber)) {
      results.set(result.rowNumber, result);
    }
  }
  return { decisions, results };
}
function isReportedRow(rowNumber: number, rowCount: number): boolean {
  return Number.isInteger(rowNumber) && rowNumber >= 1 && rowNumber <= rowCount;
}
function limitViewsOf(fileMeta: ImportFileMetaRecord): readonly ImportLimitView[] {
  return IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => ({
    id: descriptor.id,
    label: descriptor.label,
    value: descriptor.value,
    unit: descriptor.unit,
    refusesWholeFile: descriptor.refusesWholeFile,
    boundary: descriptor.boundary,
    measured: measuredValueOf(descriptor.id, fileMeta),
  }));
}
function measuredValueOf(limitId: ImportLimitId, fileMeta: ImportFileMetaRecord): number | null {
  switch (limitId) {
    case "file-bytes":
      return fileMeta.bytes;
    case "data-rows":
      return fileMeta.rowCount;
    case "columns":
      return fileMeta.columnCount;
    case "cell-code-points":
      return null;
    default:
      return assertNever(limitId, "import limit id");
  }
}
interface ProposalColumns {
  readonly columns: readonly ImportProposalColumnView[];
  readonly ignoredColumnIndexes: readonly number[];
  readonly repeatedHeaders: readonly ImportRepeatedHeaderView[];
}
function columnsOf(record: ImportProposalRecord): ProposalColumns {
  const occurrences = new Map<string, number>();
  const columns = record.mapping.map((column) => {
    const occurrence = (occurrences.get(column.header) ?? 0) + 1;
    occurrences.set(column.header, occurrence);
    return {
      columnIndex: column.columnIndex,
      header: column.header,
      occurrence,
      field: column.field,
      fieldLabel: column.field === null ? null : fieldLabelOf(column.field),
      ignored: column.field === null,
    };
  });
  const positionsByHeader = new Map<string, number[]>();
  for (const column of columns) {
    const positions = positionsByHeader.get(column.header);
    if (positions === undefined) {
      positionsByHeader.set(column.header, [column.columnIndex]);
    } else {
      positions.push(column.columnIndex);
    }
  }
  const repeatedHeaders: ImportRepeatedHeaderView[] = [];
  for (const [header, columnIndexes] of positionsByHeader) {
    if (columnIndexes.length > 1) {
      repeatedHeaders.push({ header, columnIndexes: [...columnIndexes] });
    }
  }
  return {
    columns,
    ignoredColumnIndexes: columns.filter((column) => column.ignored).map((column) => column.columnIndex),
    repeatedHeaders,
  };
}
function proposalSummaryOf(record: ImportProposalRecord, index: ProposalIndex): ImportProposalSummaryView {
  const counts: Record<ImportRowDecision, number> = {
    "new-private-entry": 0,
    "reuse-authorized-identity": 0,
    skip: 0,
    unresolved: 0,
  };
  for (const decision of index.decisions.values()) {
    counts[decision.decision] += 1;
  }
  const decisionsRecorded = index.decisions.size;
  counts.unresolved += record.fileMeta.rowCount - decisionsRecorded;
  return {
    create: counts["new-private-entry"],
    reuse: counts["reuse-authorized-identity"],
    skip: counts.skip,
    unresolved: counts.unresolved,
    needsReview: record.summary.needsReview,
    rowCount: record.fileMeta.rowCount,
    decisionsRecorded,
  };
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
function proposalRouteOf(rowNumber: number, state: ImportRowState | null, partnerId: string | null): ImportProposalRowRoute | null {
  switch (state) {
    case null:
    case "skipped":
      return null;
    case "accepted":
    case "already-accepted":
      return partnerId === null ? null : { kind: "partner", partnerId };
    case "needs-review":
    case "failed":
      return { kind: "correction", rowNumber };
    default:
      return assertNever(state, "import row state");
  }
}
function proposalValueStates(
  record: ImportProposalRecord,
  summary: ImportProposalSummaryView,
  limits: readonly ImportLimitView[],
  window: ImportRowWindow,
): Readonly<Record<string, RecordedValueState>> {
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
  for (const limit of limits) {
    states[`limits.${limit.id}.measured`] = measuredState(limit.measured);
  }
  return states;
}
function proposalActions(summary: ImportProposalSummaryView): readonly ReadAction[] {
  const acceptable = summary.create + summary.reuse;
  return [
    { name: "setRowDecision", available: true },
    acceptable > 0
      ? { name: "acceptImportRows", available: true }
      : {
          name: "acceptImportRows",
          available: false,
          reason: "No row is decided for a new entry or a reuse yet, so there is nothing to accept. Decide about a row, or skip it, before importing.",
        },
    { name: "cancelImport", available: true },
  ];
}
// A receipt, projected from the record the acceptance saved
const RECEIPT_SUMMARY_KEYS = [
  "counts",
  "totalRowCount",
  "blockedRowCount",
  "blockedReasons",
  "corrections",
  "correctionCount",
  "restrictionsPreserved",
  "restrictionsCarried",
] as const satisfies readonly (keyof ImportDecisionSummary)[];
function receiptSummaryOf(receipt: ImportReceipt): ImportReceiptSummaryView {
  const summary = project(receipt.summary, RECEIPT_SUMMARY_KEYS);
  return {
    create: summary.counts.create,
    reuse: summary.counts.reuse,
    skip: summary.counts.skip,
    unresolved: summary.counts.unresolved,
    rowCount: summary.totalRowCount,
    blockedRowCount: summary.blockedRowCount,
    blockedReasons: summary.blockedReasons.map((reason) => ({
      code: reason.code,
      label: reason.label,
      count: reason.count,
    })),
    corrections: summary.corrections.map((correction) => ({
      fieldId: correction.fieldId,
      label: correction.label,
      count: correction.count,
    })),
    correctionCount: summary.correctionCount,
    restrictionsPreserved: summary.restrictionsPreserved,
    restrictionsCarried: summary.restrictionsCarried,
  };
}
function receiptMappingOf(receipt: ImportReceipt): ImportReceiptMappingView {
  return {
    columnCount: receipt.mapping.columnCount,
    assignments: receipt.mapping.assignments.map((assignment) => ({
      columnIndex: assignment.columnIndex,
      fieldId: assignment.fieldId,
      fieldLabel: fieldLabelOf(assignment.fieldId) ?? assignment.fieldId,
    })),
    fields: [...receipt.mapping.fields],
    declined: [...receipt.mapping.declined],
    unmapped: [...receipt.mapping.unmapped],
    ignored: receipt.mapping.ignored.map((column) => ({
      columnIndex: column.index,
      header: column.header,
      occurrence: column.occurrence,
      reason: column.reason,
      message: column.message,
    })),
  };
}
function receiptRowsOf(receipt: ImportReceipt): readonly ImportReceiptRowView[] {
  const decisions = new Map<number, ImportDecisionKind>();
  for (const decision of receipt.rowDecisions.decisions) {
    if (!decisions.has(decision.rowNumber)) {
      decisions.set(decision.rowNumber, decision.kind);
    }
  }
  return receipt.results.map((result) => {
    const decision = rowDecisionOf(decisions.get(result.rowNumber) ?? "unresolved");
    return {
      rowNumber: result.rowNumber,
      decision,
      decisionLabel: DECISION_LABELS[decision],
      state: result.state,
      stateLabel: ROW_STATE_LABELS[result.state],
      reasonCode: result.reasonCode,
      reason: result.reason,
      route: result.route,
    };
  });
}
function rowDecisionOf(kind: ImportDecisionKind): ImportRowDecision {
  switch (kind) {
    case "create":
      return "new-private-entry";
    case "reuse":
      return "reuse-authorized-identity";
    case "skip":
      return "skip";
    case "unresolved":
      return "unresolved";
    default:
      return assertNever(kind, "contact import decision kind");
  }
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
  if (receipt.cancellation !== null) {
    return [
      {
        name: "cancelImport",
        available: false,
        reason: "This import was already cancelled, and the rows it stopped stay stopped. Nothing is recalled, and no row is applied again from this receipt.",
      },
    ];
  }
  const unapplied = receipt.counts.total - receipt.counts.accepted - receipt.counts.alreadyAccepted;
  return unapplied > 0
    ? [{ name: "cancelImport", available: true }]
    : [
        {
          name: "cancelImport",
          available: false,
          reason: "Every row of this file was accepted, so there is nothing left for a cancellation to stop and nothing to recall.",
        },
      ];
}
function findStoredReceipt(value: unknown, importOperationId: string, depth = 0): ImportReceiptRead | null {
  if (depth > RECEIPT_SEARCH_DEPTH || value === null || value === undefined) {
    return null;
  }
  if (isRecord(value) && value["receiptFormat"] === IMPORT_RECEIPT_FORMAT) {
    return readStoredReceipt(value, importOperationId);
  }
  const children: readonly unknown[] = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  for (const child of children) {
    const found = findStoredReceipt(child, importOperationId, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  return null;
}
// The two reads
/** Reads the import proposal the caller is reviewing: the chosen file with every displayed limit and its measured value, the mapping column by column, the decision recorded about each row, and. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readImportProposal(input: ReadImportProposalInput = {}): Promise<ReadResult<ReadEnvelope<ImportProposalView>>> {
  const resolved = await resolveReadScope(input.session);
  if (!resolved.ok) {
    return resolved.result;
  }
  const { session, scope } = resolved;
  const documents = await readImportDocuments(session.sessionId);
  if (documents === undefined) {
    return importUnavailable(
      "read-import-proposal",
      PROPOSAL_SOURCE_REFERENCE,
      "The store could not be read for this session, so no import proposal can be shown. Try again once the store answers; this request changed nothing.",
    );
  }
  if (documents.proposals === null || documents.entries === null) {
    return importUnavailable(
      "read-import-proposal",
      PROPOSAL_SOURCE_REFERENCE,
      "This session's import proposal cannot be read as this build records it, so no proposal is shown rather than an empty one. Start the import again; nothing that was already accepted is affected, and a finished import is read from its receipt by operation identity.",
    );
  }
  const owned = ownedProposals(documents, scope);
  const requested = input.importOperationId;
  // Only the current proposal is returned: the newest in-flight one when no identity is named, and
  // never a superseded proposal of the same scope, which is not enumerated at all.
  const record = requested === undefined ? owned.find((proposal) => proposal.record.processedAt === null)?.record : owned.find((proposal) => proposal.record.importOperationId === requested)?.record;
  if (record === undefined) {
    // An absent proposal is not an empty proposal: a named identity the caller cannot reach answers
    // exactly as one that never existed, and a caller with nothing in flight is told so plainly.
    return requested === undefined
      ? importUnavailable(
          "read-import-proposal",
          PROPOSAL_SOURCE_REFERENCE,
          "No import proposal is in flight for this context: none has been started, or the one that was has already been accepted and is read from its receipt by operation identity. Choose a file to start an import.",
        )
      : importDenied();
  }
  const index = indexProposal(record);
  const columns = columnsOf(record);
  const limits = limitViewsOf(record.fileMeta);
  const summary = proposalSummaryOf(record, index);
  const matching = proposalRowsOf(record, index).filter((row) => matchesRowFilter(row.decision, row.state, input));
  const paged = pagedRows(matching, input);
  const view: ImportProposalView = {
    importOperationId: record.importOperationId,
    processedAt: record.processedAt,
    inFlight: record.processedAt === null,
    revision: record.revision,
    file: {
      // Display metadata exactly as the record holds it: never a path, never parsed, never evidence
      // of the file's type, which the import module established from the bytes before a row was read.
      name: record.fileMeta.name,
      bytes: record.fileMeta.bytes,
      rowCount: record.fileMeta.rowCount,
      columnCount: record.fileMeta.columnCount,
    },
    limits,
    columns: columns.columns,
    ignoredColumnIndexes: columns.ignoredColumnIndexes,
    repeatedHeaders: columns.repeatedHeaders,
    decisions: DECISION_OPTIONS,
    summary,
    rows: paged.rows,
    rowWindow: paged.window,
    reviewDetail: PROPOSAL_REVIEW_DETAIL,
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: view,
      scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: record.importOperationId },
      revision: record.revision,
      asOf: instantAt(session.clockOffsetMs).toString(),
      coverage: IMPORT_COVERAGE,
      valueStates: proposalValueStates(record, summary, limits, paged.window),
      actions: proposalActions(summary),
    }),
  };
}
/** Reads the recoverable receipt of one import acceptance by its operation identity: what became of each data row, where to go next, and the counts those results add up to. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readImportReceipt(importOperationId: string, input: ReadImportReceiptInput = {}): Promise<ReadResult<ReadEnvelope<ImportReceiptView>>> {
  const resolved = await resolveReadScope(input.session);
  if (!resolved.ok) {
    return resolved.result;
  }
  const { session, scope } = resolved;
  if (importOperationId.length === 0) {
    return importDenied();
  }
  const documents = await readImportDocuments(session.sessionId);
  if (documents === undefined) {
    return importUnavailable(
      "read-import-receipt",
      importOperationId,
      "The store could not be read for this session, so this import operation's receipt cannot be shown. Try again once the store answers; reading a receipt applies nothing, so nothing changed.",
    );
  }
  if (documents.entries === null) {
    return importUnavailable(
      "read-import-receipt",
      importOperationId,
      "This session's operation ledger cannot be read as this build records it, so this receipt cannot be shown rather than shown as empty. Do not repeat the import: the rows it already applied are recorded, and this read applies nothing.",
    );
  }
  // Ownership is the ledger entry's own scope. An identity that belongs to another scope and one that
  // was never recorded answer with the same refusal, so neither can be used to learn that a record
  // exists, and no row count, file name or size travels with the refusal.
  //
  // One import identity can be recorded by more than one attempt — the proposal that started it and
  // the acceptance that finished it — so every in-scope entry under this identity is searched for the
  // receipt it carries, in the order the ledger holds them, rather than only the first.
  const ownedEntries = documents.entries.filter((candidate) => candidate.operationId === importOperationId && sameScope(candidate.scope, scope));
  if (ownedEntries.length === 0) {
    return importDenied();
  }
  let stored: ImportReceiptRead | null = null;
  for (const entry of ownedEntries) {
    stored = findStoredReceipt(entry.result, importOperationId);
    if (stored !== null) {
      break;
    }
  }
  if (stored === null || stored.kind === "not-found") {
    return importDenied();
  }
  if (stored.kind === "unavailable") {
    // The document is this caller's own and cannot be trusted, which is an outage rather than an
    // absence: reporting it as absent would invite the very repetition a receipt exists to prevent.
    return importUnavailable("read-import-receipt", importOperationId, stored.reason);
  }
  const receipt = stored.receipt;
  const summary = receiptSummaryOf(receipt);
  const matching = receiptRowsOf(receipt).filter((row) => matchesRowFilter(row.decision, row.state, input));
  const paged = pagedRows(matching, input);
  const cancellation = receipt.cancellation;
  const view: ImportReceiptView = {
    importOperationId: receipt.importOperationId,
    processedAt: receipt.processedAt,
    revision: receiptRevisionOf(receipt),
    file: {
      name: receipt.fileMeta.name,
      bytes: receipt.fileMeta.bytes,
      rowCount: receipt.fileMeta.rowCount,
      columnCount: receipt.fileMeta.columnCount,
    },
    mapping: receiptMappingOf(receipt),
    counts: {
      accepted: receipt.counts.accepted,
      alreadyAccepted: receipt.counts.alreadyAccepted,
      skipped: receipt.counts.skipped,
      needsReview: receipt.counts.needsReview,
      failed: receipt.counts.failed,
      total: receipt.counts.total,
    },
    summary,
    rows: paged.rows,
    rowWindow: paged.window,
    cancelled: cancellation !== null,
    cancellation:
      cancellation === null
        ? null
        : {
            cancelledAt: cancellation.cancelledAt,
            acceptedRowsRetained: cancellation.acceptedRowsRetained,
            stoppedRows: cancellation.stoppedRows,
          },
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: view,
      scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: receipt.importOperationId },
      revision: view.revision,
      asOf: instantAt(session.clockOffsetMs).toString(),
      coverage: IMPORT_COVERAGE,
      valueStates: receiptValueStates(receipt, summary, paged.window),
      actions: receiptActions(receipt),
    }),
  };
}
// What these reads deliberately do not do
//
// Nothing here applies a row, re-applies one, mints an operation identity, records a decision or a
// receipt, writes to the store, opens a file or re-reads the uploaded bytes: parsing, mapping,
// validation, decisions and the receipt belong to `modules/import/*`, and acceptance, persistence and
// the ledger belong to the named mutations. A read never turns uncertainty into a resend, and no result
// it returns offers a retry that would repeat an effect.
//
// Nothing here creates a membership, a consent record, an audience entry, a gift, a commitment, a task,
// an interaction or a note, and no field these reads return carries one: the proposal record holds none,
// the receipt's permission-shaped tallies are not projected, and a column headed like a subscription
// statement stays preserved data in the stored record. A file name is display metadata and evidence of
// nothing, and no message here claims the file was safe or qualified by its local parse.
