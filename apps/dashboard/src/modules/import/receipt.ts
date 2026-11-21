/** Contact import, step five: the recoverable receipt — what each data row of the chosen file became, where the worker can go to see it or to correct it. */
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
import { IMPORT_FIELD_IDS, type ImportColumnIgnoreReason, ImportConfirmedMapping, ImportFieldAssignment, ImportIgnoredColumn } from "./map";
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
/** The receipt's own format tag, held in the stored document so a receipt written by an older shape is refused as unreadable rather than read as if it still meant the same thing. */
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

function partnerRoute(partnerRef: ImportMatchReference): ImportResultRoute {
  // A copy, so a caller cannot reach back through the receipt into the record it reported.
  return { kind: "partner", partnerRef: { ...partnerRef } };
}
const correctionRoute = (rowNumber: number): ImportResultRoute => ({ kind: "correction", rowNumber });
const skippedResult = (rowNumber: number, reasonCode: "worker-skipped"): ImportRowResult => ({ rowNumber, state: STATE_BY_REASON[reasonCode], reasonCode, reason: REASON_WORKER_SKIPPED, route: null });
function cancelledResult(rowNumber: number): ImportRowResult {
  const reasonCode: ImportResultReasonCode = "cancelled-before-acceptance";
  return { rowNumber, state: STATE_BY_REASON[reasonCode], reasonCode, reason: REASON_CANCELLED, route: null };
}
const needsReviewResult = (rowNumber: number, reasonCode: "blocked" | "undecided" | "not-applied", reason: string): ImportRowResult => ({ rowNumber, state: STATE_BY_REASON[reasonCode], reasonCode, reason, route: correctionRoute(rowNumber) });
function appliedResult(rowNumber: number, decisionKind: ImportDecisionKind, partnerRef: ImportMatchReference, appliedByThisAttempt: boolean): ImportRowResult {
  let reasonCode: ImportResultReasonCode = "applied";
  let reason = REASON_APPLIED;
  if (!appliedByThisAttempt) {
    reasonCode = "applied-by-earlier-attempt";
    reason = REASON_ALREADY_APPLIED;
  } else if (decisionKind === "reuse") {
    reasonCode = "reused-identity";
    reason = REASON_REUSED;
  }
  return { rowNumber, state: STATE_BY_REASON[reasonCode], reasonCode, reason, route: partnerRoute(partnerRef) };
}
function resultFor(row: ImportDecisionSummaryRow, application: ImportRowApplication | undefined): ImportRowResult {
  if (application !== undefined) {
    if (application.failure !== null) {
      const { code, reason } = application.failure;
      return { rowNumber: row.rowNumber, state: STATE_BY_REASON[code], reasonCode: code, reason, route: correctionRoute(row.rowNumber) };
    }
    if (application.partnerRef !== null) return appliedResult(row.rowNumber, row.decisionKind, application.partnerRef, application.appliedByThisAttempt);
  }
  if (row.decisionKind === "skip") return skippedResult(row.rowNumber, "worker-skipped");
  if (row.decisionKind === "unresolved") return needsReviewResult(row.rowNumber, "undecided", REASON_UNDECIDED);
  if (row.blockedReasons.length > 0) return needsReviewResult(row.rowNumber, "blocked", `Still blocked when acceptance ran (${row.blockedReasons.join(", ")}), so nothing was created for this row.`);
  return needsReviewResult(row.rowNumber, "not-applied", REASON_NOT_APPLIED);
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
  if (summary.totalRowCount !== summary.rows.length || summary.counts.total !== summary.totalRowCount || summary.totalRowCount !== fileMeta.rowCount) {
    return { code: "file-mismatch", message: `The summary describes ${summary.totalRowCount} row(s) in ${summary.rows.length} row entries, and the file metadata reports ${fileMeta.rowCount}. A receipt reports the rows of one file, so review this file's decisions again.` };
  }
  if (fingerprint.columnCount !== fileMeta.columnCount || fingerprint.dataRowCount !== fileMeta.rowCount) {
    return { code: "file-mismatch", message: `The file metadata reports ${fileMeta.rowCount} data row(s) in ${fileMeta.columnCount} column(s), and the summary's fingerprint describes ${fingerprint.dataRowCount} in ${fingerprint.columnCount}. A changed file needs a fresh review.` };
  }
  if (!sameFingerprint(rowDecisions.fingerprint, fingerprint)) {
    return {
      code: "decisions-mismatch",
      message: `These row decisions were recorded against a different version of this file: it held ${rowDecisions.fingerprint.dataRowCount} data row(s) in ${rowDecisions.fingerprint.columnCount} column(s) then, and holds ${fingerprint.dataRowCount} in ${fingerprint.columnCount} now. A changed file needs a fresh review.`,
    };
  }
  return null;
}
/** Builds the receipt for one acceptance, or refuses inputs that describe two different files. */
export function buildReceipt(input: ImportReceiptBuildInput): ImportReceiptBuild {
  const refusal = inputRefusalOf(input);
  if (refusal !== null) return { ok: false, refusal };
  const applicationByRow = indexApplications(input.applications);
  const results = input.summary.rows.map((row) => resultFor(row, applicationByRow.get(row.rowNumber)));
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
// The stored shape, checked before any of it is trusted: the store is JSON, so a receipt read back is a document of unknown shape until it has been checked, and each schema is annotated with the type it describes so a change to a domain type stops compiling here rather than letting the two drift.
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
    // Row numbers are the file's own, contiguous from 1: a gap, a repeat or a reordering means these results do not describe one parsed file in its own order.
    if (result.rowNumber !== offset + 1) return `Row result ${offset + 1} carries row number ${result.rowNumber} instead of ${offset + 1}.`;
    if (STATE_BY_REASON[result.reasonCode] !== result.state) return `Row ${result.rowNumber} reports "${result.state}" for the reason "${result.reasonCode}".`;
    const routeProblem = routeProblemOf(result);
    if (routeProblem !== null) return routeProblem;
  }
  const recounted = countsOf(results);
  const recounters: readonly (readonly [CountedResultState | "total", number])[] = [
    ["accepted", recounted.accepted],
    ["alreadyAccepted", recounted.alreadyAccepted],
    ["skipped", recounted.skipped],
    ["needsReview", recounted.needsReview],
    ["failed", recounted.failed],
    ["total", recounted.total],
  ];
  for (const [key, held] of recounters) if (counts[key] !== held) return `The counts report ${key} as ${counts[key]} where the results give ${held}.`;
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
  if (accepted) {
    if (result.route === null || result.route.kind !== "partner") return `Row ${result.rowNumber} is ${result.state} without the contact it points at.`;
    return null;
  }
  if (result.state === "skipped") return result.route === null ? null : `Row ${result.rowNumber} is skipped but carries a route.`;
  if (result.route === null || result.route.kind !== "correction" || result.route.rowNumber !== result.rowNumber) return `Row ${result.rowNumber} is ${result.state} without a correction route to its own row.`;
  return null;
}
export type ImportReceiptIntent = { readonly fingerprint: ImportFileFingerprint; readonly mapping: ImportConfirmedMapping; readonly rowDecisions: ImportDecisionSet };
export type ImportReceiptIntentPart = "file" | "mapping" | "row-decisions";
export type ImportReceiptRequest = ImportReceiptIntent & { readonly importOperationId: string };
export type ImportReceiptUnavailableCode = "receipt-unreadable" | "receipt-inconsistent";
export type ImportReceiptRead =
  | { readonly kind: "found"; readonly receipt: ImportReceipt }
  | { readonly kind: "not-found"; readonly importOperationId: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly importOperationId: string; readonly reasonCode: ImportReceiptUnavailableCode; readonly reason: string };
export type ImportReceiptLookup = ImportReceiptRead | { readonly kind: "conflict"; readonly importOperationId: string; readonly stored: ImportReceiptIntent; readonly requested: ImportReceiptIntent; readonly differingParts: readonly ImportReceiptIntentPart[]; readonly message: string };
const NOT_FOUND_MESSAGE = "No receipt is stored under this import operation. Nothing is reported as applied under this identity, so check the operation's recorded result before repeating any of this work.";
const UNTRUSTWORTHY_TRAILER = "Nothing is reported as applied from it, so check the operation's recorded result before repeating any of this work.";
const INTENT_PART_NOUNS: Readonly<Record<ImportReceiptIntentPart, string>> = { file: "file", mapping: "column mapping", "row-decisions": "row decisions" };
const isJsonRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
function canonicalJson(value: unknown): string {
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
const intentOf = (receipt: ImportReceipt): ImportReceiptIntent => ({ fingerprint: receipt.fingerprint, mapping: receipt.mapping, rowDecisions: receipt.rowDecisions });
function differingPartsOf(receipt: ImportReceipt, request: ImportReceiptRequest): ImportReceiptIntentPart[] {
  const stored = intentOf(receipt);
  const parts: ImportReceiptIntentPart[] = [];
  if (canonicalJson(stored.fingerprint) !== canonicalJson(request.fingerprint)) parts.push("file");
  if (canonicalJson(stored.mapping) !== canonicalJson(request.mapping)) parts.push("mapping");
  if (canonicalJson(stored.rowDecisions) !== canonicalJson(request.rowDecisions)) parts.push("row-decisions");
  return parts;
}
function joinNouns(parts: readonly ImportReceiptIntentPart[]): string {
  const nouns = parts.map((part) => `the ${INTENT_PART_NOUNS[part]}`);
  const [first, ...rest] = nouns;
  if (first === undefined) return "nothing";
  const last = rest.pop();
  if (last === undefined) return first;
  if (rest.length === 0) return `${first} and ${last}`;
  return `${first}, ${rest.join(", ")} and ${last}`;
}
/** Reads the receipt stored under one import operation, validating it with `RECEIPT_SCHEMA` and then checking that its numbers agree with each other. */
export function readStoredReceipt(stored: unknown, importOperationId: string): ImportReceiptRead {
  if (stored === null || stored === undefined) return { kind: "not-found", importOperationId, message: NOT_FOUND_MESSAGE };
  const parsed = RECEIPT_SCHEMA.safeParse(stored);
  if (!parsed.success) return { kind: "unavailable", importOperationId, reasonCode: "receipt-unreadable", reason: `The receipt stored under this import operation cannot be read (${describeFirstIssue(parsed.error)}). ${UNTRUSTWORTHY_TRAILER}` };
  const receipt = parsed.data;
  if (receipt.importOperationId !== importOperationId) {
    // The document belongs to another operation, so nothing is stored under the identity asked for.
    return { kind: "not-found", importOperationId, message: NOT_FOUND_MESSAGE };
  }
  const problem = integrityProblemOf(receipt);
  if (problem !== null) return { kind: "unavailable", importOperationId, reasonCode: "receipt-inconsistent", reason: `The receipt stored under this import operation does not add up: ${problem} ${UNTRUSTWORTHY_TRAILER}` };
  return { kind: "found", receipt };
}
/** Decides what a caller claiming an operation identity gets: the stored receipt unchanged when the intent is the same, a conflict carrying both intents when it differs, and otherwise what. */
export function resolveReceiptLookup(stored: unknown, request: ImportReceiptRequest): ImportReceiptLookup {
  const read = readStoredReceipt(stored, request.importOperationId);
  if (read.kind !== "found") return read;
  const differingParts = differingPartsOf(read.receipt, request);
  if (differingParts.length === 0) return read;
  return {
    kind: "conflict",
    importOperationId: request.importOperationId,
    stored: intentOf(read.receipt),
    requested: { fingerprint: request.fingerprint, mapping: request.mapping, rowDecisions: request.rowDecisions },
    differingParts,
    message: `This operation identity was already used for a different import. What no longer matches the stored receipt: ${joinNouns(differingParts)}. Nothing was changed and no row was applied again. If the file or the decisions changed, start a new import so the changed work gets its own identity.`,
  };
}
/** Stops every row the acceptance had not applied, and leaves every row it had applied exactly as it stands. */
export function cancelUnacceptedRows(receipt: ImportReceipt, cancelledAt: string): ImportReceipt {
  if (receipt.cancellation !== null) return receipt;
  const results = receipt.results.map((result) => (result.state === "accepted" || result.state === "already-accepted" ? result : cancelledResult(result.rowNumber)));
  const counts = countsOf(results);
  const acceptedRowsRetained = counts.accepted + counts.alreadyAccepted;
  return { ...receipt, results, counts, cancellation: { cancelledAt, acceptedRowsRetained, stoppedRows: counts.total - acceptedRowsRetained, recallsCreatedRecords: false } };
}
// What this file deliberately does not do: nothing here parses a file, suggests a mapping, validates a row, records or applies a decision, re-applies one, mints an operation identity, reads a clock or stores anything — `parse.ts`, `map.ts`, `validate.ts` and `decide.ts` own steps one to four and the service owns acceptance, persistence and the ledger — and a refusal never deletes or reverses an effect. No result offers a resend, a retry or a re-apply, because a lost acknowledgement is answered by reading the same operation identity; nothing claims the file was safe, a message was delivered or a partner consented — `facts` carries those as zeros and `false` — and no route in a result is a URL.
