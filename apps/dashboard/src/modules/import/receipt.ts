import { z } from "zod";
import type {
  ImportBlockedReasonCount,
  ImportBlockingReasonCode,
  ImportCorrectionCount,
  ImportDecisionCounts,
  ImportDecisionFacts,
  ImportDecisionKind,
  ImportDecisionSet,
  ImportDecisionSummary,
  ImportDecisionSummaryRow,
  ImportFileFingerprint,
  ImportPreservedColumnSummary,
  ImportRecordedCorrection,
  ImportRowDecision,
} from "./decide";
import { IMPORT_DECISION_KINDS } from "./decide";
import { IMPORT_FIELD_IDS, ImportConfirmedMapping, ImportFieldAssignment, ImportIgnoredColumn, type ImportColumnIgnoreReason } from "./map";
import type { ImportMatchReference, ImportPreservedReason, ImportRowVerdict } from "./validate";
export const IMPORT_ROW_RESULT_STATES = ["accepted", "already-accepted", "skipped", "needs-review", "failed"] as const;
export type ImportRowResultState = (typeof IMPORT_ROW_RESULT_STATES)[number];
export const IMPORT_RESULT_REASON_CODES = ["applied", "reused-identity", "applied-by-earlier-attempt", "worker-skipped", "cancelled-before-acceptance", "blocked", "undecided", "not-applied", "write-conflict", "store-unavailable", "operation-superseded"] as const;
export type ImportResultReasonCode = (typeof IMPORT_RESULT_REASON_CODES)[number];
const STATE_BY_REASON = {
  applied: "accepted",
  "reused-identity": "accepted",
  "applied-by-earlier-attempt": "already-accepted",
  "worker-skipped": "skipped",
  "cancelled-before-acceptance": "skipped",
  blocked: "needs-review",
  undecided: "needs-review",
  "not-applied": "needs-review",
  "write-conflict": "failed",
  "store-unavailable": "failed",
  "operation-superseded": "failed",
} as const satisfies Readonly<Record<ImportResultReasonCode, ImportRowResultState>>;
const COUNT_KEY_BY_STATE = { accepted: "accepted", "already-accepted": "alreadyAccepted", skipped: "skipped", "needs-review": "needsReview", failed: "failed" } as const satisfies Readonly<Record<ImportRowResultState, CountedResultState>>;
export type ImportResultRoute = { readonly kind: "partner"; readonly partnerRef: ImportMatchReference } | { readonly kind: "correction"; readonly rowNumber: number };
export type ImportRowResult = { readonly rowNumber: number; readonly state: ImportRowResultState; readonly reasonCode: ImportResultReasonCode; readonly reason: string; readonly route: ImportResultRoute | null };
export const IMPORT_RECEIPT_FORMAT = "contact-import-receipt-1";
export type ImportReceiptFileMeta = { readonly name: string; readonly bytes: number; readonly rowCount: number; readonly columnCount: number };
export type ImportReceiptCounts = { readonly accepted: number; readonly alreadyAccepted: number; readonly skipped: number; readonly needsReview: number; readonly failed: number; readonly total: number };
type CountedResultState = Exclude<keyof ImportReceiptCounts, "total">;
export type ImportReceiptFacts = { readonly memberships: 0; readonly consentRecords: 0; readonly audienceMembers: 0; readonly safetyQualified: false; readonly externalEffects: 0 };
export type ImportReceiptCancellation = { readonly cancelledAt: string; readonly acceptedRowsRetained: number; readonly stoppedRows: number; readonly recallsCreatedRecords: false };
export interface ImportReceipt {
  readonly receiptFormat: typeof IMPORT_RECEIPT_FORMAT;
  readonly importOperationId: string;
  readonly fileMeta: ImportReceiptFileMeta;
  readonly fingerprint: ImportFileFingerprint;
  readonly mapping: ImportConfirmedMapping;
  readonly rowDecisions: ImportDecisionSet;
  readonly summary: ImportDecisionSummary;
  readonly processedAt: string;
  readonly results: readonly ImportRowResult[];
  readonly counts: ImportReceiptCounts;
  readonly cancellation: ImportReceiptCancellation | null;
  readonly facts: ImportReceiptFacts;
}
export const IMPORT_ROW_FAILURE_CODES = ["write-conflict", "store-unavailable", "operation-superseded"] as const satisfies readonly ImportResultReasonCode[];
export type ImportRowFailureCode = (typeof IMPORT_ROW_FAILURE_CODES)[number];
export type ImportRowFailure = { readonly code: ImportRowFailureCode; readonly reason: string };
export type ImportRowApplication = { readonly rowNumber: number; readonly partnerRef: ImportMatchReference | null; readonly appliedByThisAttempt: boolean; readonly failure: ImportRowFailure | null };
export interface ImportReceiptBuildInput {
  readonly importOperationId: string;
  readonly fileMeta: ImportReceiptFileMeta;
  readonly mapping: ImportConfirmedMapping;
  readonly rowDecisions: ImportDecisionSet;
  readonly summary: ImportDecisionSummary;
  readonly processedAt: string;
  readonly applications: readonly ImportRowApplication[];
}
export type ImportReceiptRefusalCode = "file-mismatch" | "decisions-mismatch";
export type ImportReceiptRefusal = { readonly code: ImportReceiptRefusalCode; readonly message: string };
export type ImportReceiptBuild = { readonly ok: true; readonly receipt: ImportReceipt } | { readonly ok: false; readonly refusal: ImportReceiptRefusal };
const REASON_APPLIED = "Applied: a private contact entry was created for this row.";
const REASON_REUSED = "Applied: a private preparation entry now points at the existing contact this row reuses, and that contact itself was not changed.";
const REASON_ALREADY_APPLIED = "Applied by an earlier attempt of this same import: the reference it already created is reported and nothing was created a second time.";
const REASON_WORKER_SKIPPED = "Skipped by the worker's own decision: nothing was created for this row.";
const REASON_CANCELLED = "Stopped by the cancellation before acceptance: nothing was created for this row.";
const REASON_UNDECIDED = "No decision was recorded for this row, so nothing was created for it. Decide about the row, or skip it, before importing again.";
const REASON_NOT_APPLIED = "Acceptance did not apply this row and recorded no fault for it: nothing was created, so review the row before doing anything else with it.";
const partnerRoute = (partnerRef: ImportMatchReference): ImportResultRoute => ({ kind: "partner", partnerRef: { ...partnerRef } });
const correctionRoute = (rowNumber: number): ImportResultRoute => ({ kind: "correction", rowNumber });
const rowResult = (rowNumber: number, reasonCode: ImportResultReasonCode, reason: string, route: ImportResultRoute | null): ImportRowResult => ({ rowNumber, state: STATE_BY_REASON[reasonCode], reasonCode, reason, route });
const skippedResult = (rowNumber: number): ImportRowResult => rowResult(rowNumber, "worker-skipped", REASON_WORKER_SKIPPED, null);
const cancelledResult = (rowNumber: number): ImportRowResult => rowResult(rowNumber, "cancelled-before-acceptance", REASON_CANCELLED, null);
const needsReviewResult = (rowNumber: number, reasonCode: "blocked" | "undecided" | "not-applied", reason: string): ImportRowResult => rowResult(rowNumber, reasonCode, reason, correctionRoute(rowNumber));
function appliedResult(rowNumber: number, decisionKind: ImportDecisionKind, partnerRef: ImportMatchReference, appliedByThisAttempt: boolean): ImportRowResult {
  const [reasonCode, reason] = !appliedByThisAttempt ? (["applied-by-earlier-attempt", REASON_ALREADY_APPLIED] as const) : decisionKind === "reuse" ? (["reused-identity", REASON_REUSED] as const) : (["applied", REASON_APPLIED] as const);
  return rowResult(rowNumber, reasonCode, reason, partnerRoute(partnerRef));
}
function resultFor(row: ImportDecisionSummaryRow, application: ImportRowApplication | undefined): ImportRowResult {
  if (application !== undefined) {
    if (application.failure !== null) {
      const { code, reason } = application.failure;
      return rowResult(row.rowNumber, code, reason, correctionRoute(row.rowNumber));
    }
    if (application.partnerRef !== null) return appliedResult(row.rowNumber, row.decisionKind, application.partnerRef, application.appliedByThisAttempt);
  }
  if (row.decisionKind === "skip") return skippedResult(row.rowNumber);
  if (row.decisionKind === "unresolved") return needsReviewResult(row.rowNumber, "undecided", REASON_UNDECIDED);
  return row.blockedReasons.length > 0 ? needsReviewResult(row.rowNumber, "blocked", `Still blocked when acceptance ran (${row.blockedReasons.join(", ")}), so nothing was created for this row.`) : needsReviewResult(row.rowNumber, "not-applied", REASON_NOT_APPLIED);
}
function indexApplications(applications: readonly ImportRowApplication[]): ReadonlyMap<number, ImportRowApplication> {
  const byRow = new Map<number, ImportRowApplication>();
  for (const application of applications) if (!byRow.has(application.rowNumber)) byRow.set(application.rowNumber, application);
  return byRow;
}
function countsOf(results: readonly ImportRowResult[]): ImportReceiptCounts {
  const counts = { accepted: 0, alreadyAccepted: 0, skipped: 0, needsReview: 0, failed: 0, total: results.length };
  for (const result of results) counts[COUNT_KEY_BY_STATE[result.state]] += 1;
  return counts;
}
const sameFingerprint = (left: ImportFileFingerprint, right: ImportFileFingerprint): boolean => left.checksum === right.checksum && left.columnCount === right.columnCount && left.dataRowCount === right.dataRowCount;
function inputRefusalOf(input: ImportReceiptBuildInput): ImportReceiptRefusal | null {
  const { fileMeta, summary, rowDecisions } = input;
  const { fingerprint } = summary;
  if (summary.totalRowCount !== summary.rows.length || summary.counts.total !== summary.totalRowCount || summary.totalRowCount !== fileMeta.rowCount)
    return { code: "file-mismatch", message: `The summary describes ${summary.totalRowCount} row(s) in ${summary.rows.length} row entries, and the file metadata reports ${fileMeta.rowCount}. A receipt reports the rows of one file, so review this file's decisions again.` };
  if (fingerprint.columnCount !== fileMeta.columnCount || fingerprint.dataRowCount !== fileMeta.rowCount)
    return { code: "file-mismatch", message: `The file metadata reports ${fileMeta.rowCount} data row(s) in ${fileMeta.columnCount} column(s), and the summary's fingerprint describes ${fingerprint.dataRowCount} in ${fingerprint.columnCount}. A changed file needs a fresh review.` };
  if (!sameFingerprint(rowDecisions.fingerprint, fingerprint))
    return {
      code: "decisions-mismatch",
      message: `These row decisions were recorded against a different version of this file: it held ${rowDecisions.fingerprint.dataRowCount} data row(s) in ${rowDecisions.fingerprint.columnCount} column(s) then, and holds ${fingerprint.dataRowCount} in ${fingerprint.columnCount} now. A changed file needs a fresh review.`,
    };
  return null;
}
/** Builds the receipt for one acceptance, or refuses inputs that describe two different files. */ export function buildReceipt(input: ImportReceiptBuildInput): ImportReceiptBuild {
  const refusal = inputRefusalOf(input);
  if (refusal !== null) return { ok: false, refusal };
  const results = input.summary.rows.map((row) => resultFor(row, indexApplications(input.applications).get(row.rowNumber)));
  return {
    ok: true,
    receipt: {
      receiptFormat: IMPORT_RECEIPT_FORMAT,
      importOperationId: input.importOperationId,
      fileMeta: { ...input.fileMeta },
      fingerprint: { ...input.summary.fingerprint },
      mapping: input.mapping,
      rowDecisions: input.rowDecisions,
      summary: input.summary,
      processedAt: input.processedAt,
      results,
      counts: countsOf(results),
      cancellation: null,
      facts: { memberships: 0, consentRecords: 0, audienceMembers: 0, safetyQualified: false, externalEffects: 0 },
    },
  };
}
const PRESERVED_REASONS = ["blank-cell", "rejected-value", "consent-preserved", "excluded-topic", "unmapped-column"] as const satisfies readonly ImportPreservedReason[];
const COLUMN_IGNORE_REASONS = ["blank-header", "unrecognised-header", "consent-preserved-as-data", "excluded-topic", "field-declined", "not-chosen"] as const satisfies readonly ImportColumnIgnoreReason[];
const BLOCKING_REASON_CODES = ["name-missing", "email-not-complete", "phone-not-a-number", "postal-not-an-address", "ragged-row", "cell-too-long", "reuse-not-offered"] as const satisfies readonly ImportBlockingReasonCode[];
const ROW_NUMBER_SCHEMA = z.number().int().min(1);
const COUNT_SCHEMA = z.number().int().min(0);
const REFERENCE_SCHEMA: z.ZodType<ImportMatchReference> = z.strictObject({ system: z.string().min(1), reference: z.string().min(1) });
const FINGERPRINT_SCHEMA: z.ZodType<ImportFileFingerprint> = z.strictObject({ checksum: z.string().min(1), columnCount: COUNT_SCHEMA, dataRowCount: COUNT_SCHEMA });
const ROUTE_SCHEMA: z.ZodType<ImportResultRoute> = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("partner"), partnerRef: REFERENCE_SCHEMA }), z.strictObject({ kind: z.literal("correction"), rowNumber: ROW_NUMBER_SCHEMA })]);
const RESULT_SCHEMA: z.ZodType<ImportRowResult> = z.strictObject({ rowNumber: ROW_NUMBER_SCHEMA, state: z.enum(IMPORT_ROW_RESULT_STATES), reasonCode: z.enum(IMPORT_RESULT_REASON_CODES), reason: z.string().min(1), route: ROUTE_SCHEMA.nullable() });
const FILE_META_SCHEMA: z.ZodType<ImportReceiptFileMeta> = z.strictObject({ name: z.string(), bytes: COUNT_SCHEMA, rowCount: COUNT_SCHEMA, columnCount: COUNT_SCHEMA });
const COUNTS_SCHEMA: z.ZodType<ImportReceiptCounts> = z.strictObject({ accepted: COUNT_SCHEMA, alreadyAccepted: COUNT_SCHEMA, skipped: COUNT_SCHEMA, needsReview: COUNT_SCHEMA, failed: COUNT_SCHEMA, total: COUNT_SCHEMA });
const CANCELLATION_SCHEMA: z.ZodType<ImportReceiptCancellation> = z.strictObject({ cancelledAt: z.string().min(1), acceptedRowsRetained: COUNT_SCHEMA, stoppedRows: COUNT_SCHEMA, recallsCreatedRecords: z.literal(false) });
const FACTS_SCHEMA: z.ZodType<ImportReceiptFacts> = z.strictObject({ memberships: z.literal(0), consentRecords: z.literal(0), audienceMembers: z.literal(0), safetyQualified: z.literal(false), externalEffects: z.literal(0) });
const FIELD_ID_SCHEMA = z.enum(IMPORT_FIELD_IDS);
const FIELD_ASSIGNMENT_SCHEMA: z.ZodType<ImportFieldAssignment> = z.strictObject({ fieldId: FIELD_ID_SCHEMA, columnIndex: ROW_NUMBER_SCHEMA });
const IGNORED_COLUMN_SCHEMA: z.ZodType<ImportIgnoredColumn> = z.strictObject({ index: ROW_NUMBER_SCHEMA, header: z.string(), occurrence: ROW_NUMBER_SCHEMA, reason: z.enum(COLUMN_IGNORE_REASONS), message: z.string() });
const CONFIRMED_MAPPING_SCHEMA: z.ZodType<ImportConfirmedMapping> = z.strictObject({ columnCount: COUNT_SCHEMA, assignments: z.array(FIELD_ASSIGNMENT_SCHEMA), fields: z.array(FIELD_ID_SCHEMA), declined: z.array(FIELD_ID_SCHEMA), unmapped: z.array(FIELD_ID_SCHEMA), ignored: z.array(IGNORED_COLUMN_SCHEMA) });
const VERDICT_SCHEMA: z.ZodType<ImportRowVerdict> = z.enum(["ready", "needs-correction"]);
const CORRECTION_SCHEMA: z.ZodType<ImportRecordedCorrection> = z.strictObject({ columnNumber: ROW_NUMBER_SCHEMA, fieldId: FIELD_ID_SCHEMA, value: z.string() });
const ROW_DECISION_SCHEMA: z.ZodType<ImportRowDecision> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("create"), rowNumber: ROW_NUMBER_SCHEMA, verdict: VERDICT_SCHEMA, corrections: z.array(CORRECTION_SCHEMA) }),
  z.strictObject({ kind: z.literal("reuse"), rowNumber: ROW_NUMBER_SCHEMA, verdict: VERDICT_SCHEMA, candidate: REFERENCE_SCHEMA, corrections: z.array(CORRECTION_SCHEMA) }),
  z.strictObject({ kind: z.literal("skip"), rowNumber: ROW_NUMBER_SCHEMA, verdict: VERDICT_SCHEMA, workerReason: z.string(), rowProblem: z.string().nullable() }),
  z.strictObject({ kind: z.literal("unresolved"), rowNumber: ROW_NUMBER_SCHEMA, verdict: VERDICT_SCHEMA }),
]);
const DECISION_SET_SCHEMA: z.ZodType<ImportDecisionSet> = z.strictObject({ fingerprint: FINGERPRINT_SCHEMA, decisions: z.array(ROW_DECISION_SCHEMA) });
const DECISION_COUNTS_SCHEMA: z.ZodType<ImportDecisionCounts> = z.strictObject({ create: COUNT_SCHEMA, reuse: COUNT_SCHEMA, skip: COUNT_SCHEMA, unresolved: COUNT_SCHEMA, total: COUNT_SCHEMA });
const BLOCKED_REASON_COUNT_SCHEMA: z.ZodType<ImportBlockedReasonCount> = z.strictObject({ code: z.enum(BLOCKING_REASON_CODES), label: z.string(), count: COUNT_SCHEMA });
const CORRECTION_COUNT_SCHEMA: z.ZodType<ImportCorrectionCount> = z.strictObject({ fieldId: FIELD_ID_SCHEMA, label: z.string(), count: COUNT_SCHEMA });
const PRESERVED_COLUMN_SCHEMA: z.ZodType<ImportPreservedColumnSummary> = z.strictObject({ columnNumber: ROW_NUMBER_SCHEMA, header: z.string(), reason: z.enum(PRESERVED_REASONS), statesConsent: z.boolean(), cellCount: COUNT_SCHEMA });
const DECISION_FACTS_SCHEMA: z.ZodType<ImportDecisionFacts> = z.strictObject({ memberships: z.literal(0), consentRecords: z.literal(0), audienceMembers: z.literal(0), preservedColumnsCreateNothing: z.literal(true) });
const SUMMARY_ROW_SCHEMA: z.ZodType<ImportDecisionSummaryRow> = z.strictObject({ rowNumber: ROW_NUMBER_SCHEMA, decisionKind: z.enum(IMPORT_DECISION_KINDS), verdict: VERDICT_SCHEMA, blockedReasons: z.array(z.enum(BLOCKING_REASON_CODES)), correctedFields: z.array(FIELD_ID_SCHEMA) });
const SUMMARY_SCHEMA: z.ZodType<ImportDecisionSummary> = z.strictObject({
  fingerprint: FINGERPRINT_SCHEMA,
  totalRowCount: COUNT_SCHEMA,
  counts: DECISION_COUNTS_SCHEMA,
  blockedRowCount: COUNT_SCHEMA,
  blockedReasons: z.array(BLOCKED_REASON_COUNT_SCHEMA),
  corrections: z.array(CORRECTION_COUNT_SCHEMA),
  correctionCount: COUNT_SCHEMA,
  restrictionsPreserved: COUNT_SCHEMA,
  restrictionsCarried: COUNT_SCHEMA,
  preservedColumns: z.array(PRESERVED_COLUMN_SCHEMA),
  preservedColumnCount: COUNT_SCHEMA,
  consentLookingColumnCount: COUNT_SCHEMA,
  facts: DECISION_FACTS_SCHEMA,
  rows: z.array(SUMMARY_ROW_SCHEMA),
});
const RECEIPT_SCHEMA: z.ZodType<ImportReceipt> = z.strictObject({
  receiptFormat: z.literal(IMPORT_RECEIPT_FORMAT),
  importOperationId: z.string().min(1),
  fileMeta: FILE_META_SCHEMA,
  fingerprint: FINGERPRINT_SCHEMA,
  mapping: CONFIRMED_MAPPING_SCHEMA,
  rowDecisions: DECISION_SET_SCHEMA,
  summary: SUMMARY_SCHEMA,
  processedAt: z.string().min(1),
  results: z.array(RESULT_SCHEMA),
  counts: COUNTS_SCHEMA,
  cancellation: CANCELLATION_SCHEMA.nullable(),
  facts: FACTS_SCHEMA,
});
type ReceiptReadFailure = { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] };
function describeFirstIssue(failure: ReceiptReadFailure): string {
  const [issue] = failure.issues;
  if (issue === undefined) return "the stored value is not a contact-import receipt";
  const path = issue.path.map((part) => String(part)).join(".");
  return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}
function integrityProblemOf(receipt: ImportReceipt): string | null {
  const { results, counts, summary } = receipt;
  if (results.length !== counts.total) return `${results.length} row result(s) are recorded and the counts report ${counts.total}.`;
  if (summary.totalRowCount !== results.length || summary.counts.total !== results.length) return `The results describe ${results.length} row(s) and the reviewed summary ${summary.totalRowCount}.`;
  for (const [offset, result] of results.entries()) {
    if (result.rowNumber !== offset + 1) return `Row result ${offset + 1} carries row number ${result.rowNumber} instead of ${offset + 1}.`;
    if (STATE_BY_REASON[result.reasonCode] !== result.state) return `Row ${result.rowNumber} reports "${result.state}" for the reason "${result.reasonCode}".`;
    const routeProblem = routeProblemOf(result);
    if (routeProblem !== null) return routeProblem;
  }
  const recounted = countsOf(results);
  const mismatch = (Object.keys(recounted) as (keyof ImportReceiptCounts)[]).find((key) => counts[key] !== recounted[key]);
  if (mismatch !== undefined) return `The counts report ${mismatch} as ${counts[mismatch]} where the results give ${recounted[mismatch]}.`;
  if (!sameFingerprint(receipt.fingerprint, summary.fingerprint) || !sameFingerprint(receipt.fingerprint, receipt.rowDecisions.fingerprint)) return "The receipt's fingerprint, its reviewed summary and its row decisions describe different files.";
  const { cancellation } = receipt;
  if (cancellation !== null) {
    const retained = recounted.accepted + recounted.alreadyAccepted;
    if (cancellation.acceptedRowsRetained !== retained) return `The cancellation reports ${cancellation.acceptedRowsRetained} retained row(s) where ${retained} row(s) are accepted.`;
    if (cancellation.stoppedRows !== recounted.skipped) return `The cancellation reports ${cancellation.stoppedRows} stopped row(s) where ${recounted.skipped} row(s) are skipped.`;
  }
  return null;
}
function routeProblemOf(result: ImportRowResult): string | null {
  const accepted = result.state === "accepted" || result.state === "already-accepted";
  if (accepted) return result.route === null || result.route.kind !== "partner" ? `Row ${result.rowNumber} is ${result.state} without the contact it points at.` : null;
  if (result.state === "skipped") return result.route === null ? null : `Row ${result.rowNumber} is skipped but carries a route.`;
  return result.route === null || result.route.kind !== "correction" || result.route.rowNumber !== result.rowNumber ? `Row ${result.rowNumber} is ${result.state} without a correction route to its own row.` : null;
}
export type ImportReceiptIntent = { readonly fingerprint: ImportFileFingerprint; readonly mapping: ImportConfirmedMapping; readonly rowDecisions: ImportDecisionSet };
export type ImportReceiptIntentPart = "file" | "mapping" | "row-decisions";
export type ImportReceiptUnavailableCode = "receipt-unreadable" | "receipt-inconsistent";
export type ImportReceiptRead =
  | { readonly kind: "found"; readonly receipt: ImportReceipt }
  | { readonly kind: "not-found"; readonly importOperationId: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly importOperationId: string; readonly reasonCode: ImportReceiptUnavailableCode; readonly reason: string };
const NOT_FOUND_MESSAGE = "No receipt is stored under this import operation. Nothing is reported as applied under this identity, so check the operation's recorded result before repeating any of this work.";
const UNTRUSTWORTHY_TRAILER = "Nothing is reported as applied from it, so check the operation's recorded result before repeating any of this work.";
const isJsonRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
// One value in a canonical form, independent of the member order it was built in, so two records assembled by different paths compare equal when they say the same thing; exported because the import mutation decides with this comparison whether a repeated proposal of one file would change anything.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isJsonRecord(value)) {
    const entries = Object.keys(value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}
/** Reads the receipt stored under one import operation, validating it with `RECEIPT_SCHEMA` and then checking that its numbers agree with each other. */
export function readStoredReceipt(stored: unknown, importOperationId: string): ImportReceiptRead {
  if (stored === null || stored === undefined) return { kind: "not-found", importOperationId, message: NOT_FOUND_MESSAGE };
  const parsed = RECEIPT_SCHEMA.safeParse(stored);
  if (!parsed.success) return { kind: "unavailable", importOperationId, reasonCode: "receipt-unreadable", reason: `The receipt stored under this import operation cannot be read (${describeFirstIssue(parsed.error)}). ${UNTRUSTWORTHY_TRAILER}` };
  const receipt = parsed.data;
  if (receipt.importOperationId !== importOperationId) return { kind: "not-found", importOperationId, message: NOT_FOUND_MESSAGE };
  const problem = integrityProblemOf(receipt);
  return problem !== null ? { kind: "unavailable", importOperationId, reasonCode: "receipt-inconsistent", reason: `The receipt stored under this import operation does not add up: ${problem} ${UNTRUSTWORTHY_TRAILER}` } : { kind: "found", receipt };
}
/** Stops every row the acceptance had not applied, and leaves every row it had applied exactly as it stands. */ export function cancelUnacceptedRows(receipt: ImportReceipt, cancelledAt: string): ImportReceipt {
  if (receipt.cancellation !== null) return receipt;
  const results = receipt.results.map((result) => (result.state === "accepted" || result.state === "already-accepted" ? result : cancelledResult(result.rowNumber)));
  const counts = countsOf(results);
  const acceptedRowsRetained = counts.accepted + counts.alreadyAccepted;
  return { ...receipt, results, counts, cancellation: { cancelledAt, acceptedRowsRetained, stoppedRows: counts.total - acceptedRowsRetained, recallsCreatedRecords: false } };
}
