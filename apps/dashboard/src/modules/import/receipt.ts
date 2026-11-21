/**
 * Contact import, step five: the recoverable receipt — what each data row of the chosen file became,
 * where the worker can go to see it or to correct it, and the operation identity that makes a lost
 * acknowledgement return the original result instead of a second effect.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 import-module row: `buildReceipt()` in `src/modules/import/*`, the module responsible for
 *   "limits, parsing, mapping, validation, duplicate suggestions, decisions, receipt".
 * - AAP 0.6.2 import proposal and receipt record: `importOperationId`, `fileMeta {name, bytes,
 *   rowCount, columnCount}`, `mapping`, `rowDecisions`, `summary`, `processedAt`, and `results[]` whose
 *   per-row state is exactly `accepted | already-accepted | skipped | needs-review | failed` —
 *   "a changed file requires fresh review; cancellation after acceptance stops only unaccepted rows."
 * - AAP 0.7.1 closed outcome set: the same `operationId` with the same intent is a replay that returns
 *   the stored result with no new effect; the same `operationId` with a changed intent is a conflict
 *   that preserves the caller's input; an unacknowledged effect is `unknown` and is recovered by its
 *   identity, never by resending.
 * - AAP 0.6.3's receipt lookup (`import/[operationId]`); 0.10.1 contact import requires
 *   "per-row results with routes to the contact or to a correction, and receipt recovery after a lost
 *   response"; 0.12.5 arms `acceptImportRows` with the lost acknowledgement, and criterion 4 is proven
 *   by `tests/integration/import-receipt-recovery.test.ts` and `e2e/import.spec.ts`.
 * - AAP 0.8.5: "importing or editing a contact never subscribes anyone"; "a `subscribed` flag is not
 *   consent" — so the receipt reports no membership, consent record or audience member, and a
 *   consent-looking column stays in it as preserved, uninterpreted data.
 *
 * Three rules shape the file. The receipt is a value, not a side effect: it is a pure function of the
 * file metadata, the decisions and the applications the service reports, with `processedAt` and the
 * operation identity supplied by the caller, so a replay rebuilds it byte for byte and no row can be
 * applied twice. A row has exactly five possible results and no sixth, and each result carries a route
 * that is data — a route kind and an opaque reference — never a URL or a host, because building an href
 * belongs to the import feature. And nothing here claims what did not happen: an applied row is never
 * re-applied, a row acceptance did not apply is never reported as accepted, and a cancellation records
 * that the records already created stay exactly where they are.
 *
 * The module is pure and deterministic. It reads no clock, opens no file, performs no network call,
 * mints no identifier and draws no random value; it orders everything by code-unit comparison rather
 * than a locale-dependent sort, so the same inputs yield the same receipt on every machine.
 *
 * Layering: a framework-free domain module beside `parse.ts`, `map.ts`, `validate.ts` and `decide.ts`.
 * It imports those four — the file's own vocabulary, the confirmed mapping, the row decision set, the
 * pre-acceptance summary — and `zod`, which re-checks a stored receipt before any of it is trusted. It
 * imports no store, no data service, no feature and no component: the service imports this module,
 * persists the value it returns and hands it back unchanged on a replay.
 */

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
import type {
  ImportColumnIgnoreReason,
  ImportConfirmedMapping,
  ImportFieldAssignment,
  ImportIgnoredColumn,
} from "./map";
import { IMPORT_FIELD_IDS } from "./map";
import type { ImportMatchReference, ImportPreservedReason, ImportRowVerdict } from "./validate";

// ---------------------------------------------------------------------------------------------
// Phase A: exactly five results, each with the route it hands the worker
// ---------------------------------------------------------------------------------------------

/**
 * What happened to one data row at acceptance. The five members are the AAP's own words, in its own
 * spelling, and they are closed: there is no `success`, no `done` and no `error`, because the state a
 * surface renders is the fact that was recorded rather than a word a component chose. A row the
 * worker skipped is `skipped`, never `accepted`; a row still blocked is `needs-review`, never
 * `skipped`, because nothing was decided about it.
 */
export const IMPORT_ROW_RESULT_STATES = [
  "accepted",
  "already-accepted",
  "skipped",
  "needs-review",
  "failed",
] as const;

export type ImportRowResultState = (typeof IMPORT_ROW_RESULT_STATES)[number];

/**
 * Why a row carries the result it does. The service switches on these, a person reads `reason`, and
 * each code belongs to exactly one result state — `STATE_BY_REASON` is the single place that pairing
 * is stated, so a result can never claim an acceptance and a write fault at the same time.
 */
export const IMPORT_RESULT_REASON_CODES = [
  /** This acceptance created the row's private contact entry. */
  "applied",
  /** This acceptance attached a private preparation entry to an identity the worker already holds. */
  "reused-identity",
  /** An earlier attempt of this same import created the row's record; nothing was created again. */
  "applied-by-earlier-attempt",
  /** The worker skipped the row themselves. */
  "worker-skipped",
  /** The import was cancelled before this row was accepted. */
  "cancelled-before-acceptance",
  /** The row was still blocked when acceptance ran, so nothing could be applied. */
  "blocked",
  /** No decision was recorded for the row, so acceptance left it alone. */
  "undecided",
  /** The row was decided and clear, and acceptance still did not apply it. */
  "not-applied",
  /** The write collided with a newer revision of the record. */
  "write-conflict",
  /** The record store could not be reached, so the row's fate is unknown rather than failed. */
  "store-unavailable",
  /** A later operation superseded this acceptance before the row was reached. */
  "operation-superseded",
] as const;

export type ImportResultReasonCode = (typeof IMPORT_RESULT_REASON_CODES)[number];

/**
 * The one statement of which result state a reason code produces. Annotating it with the full record
 * makes a sixth state or a sixth code a compile error here instead of a silently unhandled case, and
 * every result this module builds derives its state from this table rather than restating it.
 */
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

/** Which counter in the receipt's counts one result state increments; also stated for every state. */
const COUNT_KEY_BY_STATE = {
  accepted: "accepted",
  "already-accepted": "alreadyAccepted",
  skipped: "skipped",
  "needs-review": "needsReview",
  failed: "failed",
} as const satisfies Readonly<Record<ImportRowResultState, CountedResultState>>;

/**
 * Where the result step sends the worker next, as data. `partnerRef` is the opaque, source-qualified
 * reference of a partner record and `rowNumber` is a data row of this file; neither is a path, a query
 * string or a host, because the import feature builds the href from this descriptor and this module is
 * the wrong place to know a route.
 */
export type ImportResultRoute =
  | { readonly kind: "partner"; readonly partnerRef: ImportMatchReference }
  | { readonly kind: "correction"; readonly rowNumber: number };

/** One data row's result: its number, what happened, why, and where to go next. */
export interface ImportRowResult {
  /** The same 1-based nonblank data-row number `parse.ts` assigned, so a correction route can find it. */
  readonly rowNumber: number;
  readonly state: ImportRowResultState;
  readonly reasonCode: ImportResultReasonCode;
  /** One factual sentence for the result step. It names no private value the row held. */
  readonly reason: string;
  /** A contact to open, a row to correct, or nothing at all for a skipped row. */
  readonly route: ImportResultRoute | null;
}

// ---------------------------------------------------------------------------------------------
// Phase B: the receipt record
// ---------------------------------------------------------------------------------------------

/**
 * The receipt's own format tag, held in the stored document so a receipt written by an older shape is
 * refused as unreadable rather than read as if it still meant the same thing. It changes only when a
 * stored field's meaning changes.
 */
export const IMPORT_RECEIPT_FORMAT = "contact-import-receipt-1";

/**
 * What the receipt says about the chosen file. `name` is display metadata carried from the choice and
 * is evidence of nothing: a filename and an extension never establish a file's type, because the file
 * was typed by its content in `parse.ts`. `rowCount` is the nonblank data rows that module counted and
 * `columnCount` its header's columns, so the two agree with the results below them.
 */
export interface ImportReceiptFileMeta {
  readonly name: string;
  readonly bytes: number;
  readonly rowCount: number;
  readonly columnCount: number;
}

/** The five result states counted, plus the row total the five must add up to exactly. */
export interface ImportReceiptCounts {
  readonly accepted: number;
  readonly alreadyAccepted: number;
  readonly skipped: number;
  readonly needsReview: number;
  readonly failed: number;
  /** Every data row of the file: one result exists per row, so the five counters sum to this. */
  readonly total: number;
}

/** The counter names a result state increments, as a closed union so a count cannot be invented. */
type CountedResultState = Exclude<keyof ImportReceiptCounts, "total">;

/**
 * What the receipt states it did not do, as literal types rather than as a sentence the result step
 * has to trust. This import creates private contact entries and nothing else: it subscribes nobody,
 * records no consent, joins no audience, sends nothing anywhere, and a successful local parse is not a
 * safety qualification for the file it read.
 */
export interface ImportReceiptFacts {
  readonly memberships: 0;
  readonly consentRecords: 0;
  readonly audienceMembers: 0;
  readonly safetyQualified: false;
  readonly externalEffects: 0;
}

/**
 * What a cancellation did, recorded beside the results rather than folded into them. The accepted
 * rows keep their references and their state, so `acceptedRowsRetained` counts records that are still
 * there, and `recallsCreatedRecords: false` states plainly that a cancellation recalls nothing.
 */
export interface ImportReceiptCancellation {
  readonly cancelledAt: string;
  /** Rows already accepted before the cancellation. Their records stay exactly where they are. */
  readonly acceptedRowsRetained: number;
  /** Rows the cancellation stopped before acceptance, which is every row that was not accepted. */
  readonly stoppedRows: number;
  readonly recallsCreatedRecords: false;
}

/**
 * The recoverable receipt for one import operation: the file it read, the mapping and decisions it was
 * accepted under, the summary acceptance was reviewed against, one result per data row, the counts
 * those results add up to, what a cancellation did if one happened, and the facts that keep the record
 * honest. This is the value the service persists and hands back unchanged from the receipt lookup,
 * so it is JSON-safe throughout and carries no timestamp this module read for itself.
 */
export interface ImportReceipt {
  readonly receiptFormat: typeof IMPORT_RECEIPT_FORMAT;
  readonly importOperationId: string;
  readonly fileMeta: ImportReceiptFileMeta;
  /** The content fingerprint of the file the results belong to, agreed by every part of the receipt. */
  readonly fingerprint: ImportFileFingerprint;
  readonly mapping: ImportConfirmedMapping;
  readonly rowDecisions: ImportDecisionSet;
  /** The pre-acceptance summary from `decide.ts`: what the worker reviewed before accepting. */
  readonly summary: ImportDecisionSummary;
  /** The instant the acceptance ran, supplied by the caller from `time/clock.ts`. */
  readonly processedAt: string;
  /** One result per data row, in file order, so `results[i].rowNumber === i + 1` throughout. */
  readonly results: readonly ImportRowResult[];
  readonly counts: ImportReceiptCounts;
  readonly cancellation: ImportReceiptCancellation | null;
  readonly facts: ImportReceiptFacts;
}

// ---------------------------------------------------------------------------------------------
// Phase C: building the receipt from what the acceptance applied
// ---------------------------------------------------------------------------------------------

/** How a row's record failed to be applied. Each code states one fact the result step can act on. */
export const IMPORT_ROW_FAILURE_CODES = [
  /** The write collided with a newer revision of the record. */
  "write-conflict",
  /** The store could not be reached, so the row's fate is unknown rather than definitely failed. */
  "store-unavailable",
  /** A later operation superseded this acceptance before the row was reached. */
  "operation-superseded",
] as const satisfies readonly ImportResultReasonCode[];

export type ImportRowFailureCode = (typeof IMPORT_ROW_FAILURE_CODES)[number];

/**
 * An application fault at write time, in the service's own words. The sentence travels unchanged into
 * the row's result, so a result never rewords a fault it did not observe.
 */
export interface ImportRowFailure {
  readonly code: ImportRowFailureCode;
  readonly reason: string;
}

/**
 * What the acceptance applied for one row, as the service reports it. This module performs no write,
 * so the record's reference — and, on a replayed acceptance, the fact that an earlier attempt of the
 * same operation already created it — arrive here as inputs. A row with neither a reference nor a
 * failure was not applied, and is never reported as accepted: absence of evidence is not acceptance.
 */
export interface ImportRowApplication {
  readonly rowNumber: number;
  /** The opaque, source-qualified reference of the record the row now points at. */
  readonly partnerRef: ImportMatchReference | null;
  /** True when this acceptance created that reference; false when an earlier attempt of it did. */
  readonly appliedByThisAttempt: boolean;
  /** The write fault, when the row could not be applied. A failure always outranks a reference. */
  readonly failure: ImportRowFailure | null;
}

/** Everything `buildReceipt` reads: the file, the decisions reviewed, and what acceptance applied. */
export interface ImportReceiptBuildInput {
  readonly importOperationId: string;
  readonly fileMeta: ImportReceiptFileMeta;
  readonly mapping: ImportConfirmedMapping;
  readonly rowDecisions: ImportDecisionSet;
  readonly summary: ImportDecisionSummary;
  /** The instant the acceptance ran. This module never reads a clock, so the caller supplies it. */
  readonly processedAt: string;
  /** One entry per row the service touched. A row absent here was not applied. */
  readonly applications: readonly ImportRowApplication[];
}

/**
 * Why no receipt could be built. Both codes describe an input that contradicts itself, which is the
 * one thing a receipt must never paper over: it reports the rows of one file, under one set of
 * decisions, so a mixture of two versions would describe neither.
 */
export type ImportReceiptRefusalCode =
  /** The file metadata and the summary describe different row or column counts. */
  | "file-mismatch"
  /** The row decisions were recorded against another version of this file. */
  | "decisions-mismatch";

export interface ImportReceiptRefusal {
  readonly code: ImportReceiptRefusalCode;
  readonly message: string;
}

/** Either the receipt or the reason the inputs contradict each other. */
export type ImportReceiptBuild =
  | { readonly ok: true; readonly receipt: ImportReceipt }
  | { readonly ok: false; readonly refusal: ImportReceiptRefusal };

const REASON_APPLIED = "Applied: a private contact entry was created for this row.";
const REASON_REUSED =
  "Applied: a private preparation entry now points at the existing contact this row reuses, and that contact itself was not changed.";
const REASON_ALREADY_APPLIED =
  "Applied by an earlier attempt of this same import: the reference it already created is reported and nothing was created a second time.";
const REASON_WORKER_SKIPPED =
  "Skipped by the worker's own decision: nothing was created for this row.";
const REASON_CANCELLED =
  "Stopped by the cancellation before acceptance: nothing was created for this row.";
const REASON_UNDECIDED =
  "No decision was recorded for this row, so nothing was created for it. Decide about the row, or skip it, before importing again.";
const REASON_NOT_APPLIED =
  "Acceptance did not apply this row and recorded no fault for it: nothing was created, so review the row before doing anything else with it.";

function partnerRoute(partnerRef: ImportMatchReference): ImportResultRoute {
  // A copy, so a caller cannot reach back through the receipt into the record it reported.
  return { kind: "partner", partnerRef: { ...partnerRef } };
}

function correctionRoute(rowNumber: number): ImportResultRoute {
  return { kind: "correction", rowNumber };
}

function skippedResult(rowNumber: number, reasonCode: "worker-skipped"): ImportRowResult {
  return {
    rowNumber,
    state: STATE_BY_REASON[reasonCode],
    reasonCode,
    reason: REASON_WORKER_SKIPPED,
    route: null,
  };
}

/** The result a cancellation leaves on a row it stopped before acceptance. */
function cancelledResult(rowNumber: number): ImportRowResult {
  const reasonCode: ImportResultReasonCode = "cancelled-before-acceptance";
  return {
    rowNumber,
    state: STATE_BY_REASON[reasonCode],
    reasonCode,
    reason: REASON_CANCELLED,
    route: null,
  };
}

function needsReviewResult(
  rowNumber: number,
  reasonCode: "blocked" | "undecided" | "not-applied",
  reason: string,
): ImportRowResult {
  return {
    rowNumber,
    state: STATE_BY_REASON[reasonCode],
    reasonCode,
    reason,
    route: correctionRoute(rowNumber),
  };
}

/**
 * The result of a row this import applied — now, or by an earlier attempt of the same operation. The
 * two are kept apart because they are different facts: the first created the reference, the second
 * only reports the one that already existed.
 */
function appliedResult(
  rowNumber: number,
  decisionKind: ImportDecisionKind,
  partnerRef: ImportMatchReference,
  appliedByThisAttempt: boolean,
): ImportRowResult {
  let reasonCode: ImportResultReasonCode = "applied";
  let reason = REASON_APPLIED;

  if (!appliedByThisAttempt) {
    reasonCode = "applied-by-earlier-attempt";
    reason = REASON_ALREADY_APPLIED;
  } else if (decisionKind === "reuse") {
    reasonCode = "reused-identity";
    reason = REASON_REUSED;
  }

  return {
    rowNumber,
    state: STATE_BY_REASON[reasonCode],
    reasonCode,
    reason,
    route: partnerRoute(partnerRef),
  };
}

/**
 * The result for one row: what happened outranks what was intended, because an application is an
 * effect and a decision is only an intention. A row this operation applied is therefore reported as
 * applied, a fault is reported as a fault with a correction route, and a row nothing was applied to is
 * reported by what still stood in its way.
 */
function resultFor(
  row: ImportDecisionSummaryRow,
  application: ImportRowApplication | undefined,
): ImportRowResult {
  if (application !== undefined) {
    if (application.failure !== null) {
      const { code, reason } = application.failure;
      return {
        rowNumber: row.rowNumber,
        state: STATE_BY_REASON[code],
        reasonCode: code,
        reason,
        route: correctionRoute(row.rowNumber),
      };
    }
    if (application.partnerRef !== null) {
      return appliedResult(
        row.rowNumber,
        row.decisionKind,
        application.partnerRef,
        application.appliedByThisAttempt,
      );
    }
  }

  if (row.decisionKind === "skip") return skippedResult(row.rowNumber, "worker-skipped");

  if (row.decisionKind === "unresolved") {
    return needsReviewResult(row.rowNumber, "undecided", REASON_UNDECIDED);
  }

  if (row.blockedReasons.length > 0) {
    return needsReviewResult(
      row.rowNumber,
      "blocked",
      `Still blocked when acceptance ran (${row.blockedReasons.join(", ")}), so nothing was created for this row.`,
    );
  }

  return needsReviewResult(row.rowNumber, "not-applied", REASON_NOT_APPLIED);
}

/**
 * The applications keyed by row. The first entry recorded for a row stands: a second entry for one row
 * is a caller defect, and letting the later one win would allow a retry's failure to overwrite the
 * record an earlier attempt already created.
 */
function indexApplications(
  applications: readonly ImportRowApplication[],
): ReadonlyMap<number, ImportRowApplication> {
  const byRow = new Map<number, ImportRowApplication>();
  for (const application of applications) {
    if (!byRow.has(application.rowNumber)) byRow.set(application.rowNumber, application);
  }
  return byRow;
}

function countsOf(results: readonly ImportRowResult[]): ImportReceiptCounts {
  const counts = {
    accepted: 0,
    alreadyAccepted: 0,
    skipped: 0,
    needsReview: 0,
    failed: 0,
    total: results.length,
  };
  for (const result of results) counts[COUNT_KEY_BY_STATE[result.state]] += 1;
  return counts;
}

function sameFingerprint(left: ImportFileFingerprint, right: ImportFileFingerprint): boolean {
  return (
    left.checksum === right.checksum &&
    left.columnCount === right.columnCount &&
    left.dataRowCount === right.dataRowCount
  );
}

/**
 * Whether the inputs describe one file under one set of decisions, and if not, which part disagrees.
 * The checks run in a fixed order so the same input always yields the same refusal.
 */
function inputRefusalOf(input: ImportReceiptBuildInput): ImportReceiptRefusal | null {
  const { fileMeta, summary, rowDecisions } = input;
  const { fingerprint } = summary;

  if (
    summary.totalRowCount !== summary.rows.length ||
    summary.counts.total !== summary.totalRowCount ||
    summary.totalRowCount !== fileMeta.rowCount
  ) {
    return {
      code: "file-mismatch",
      message: `The summary describes ${summary.totalRowCount} row(s) in ${summary.rows.length} row entries, and the file metadata reports ${fileMeta.rowCount}. A receipt reports the rows of one file, so review this file's decisions again.`,
    };
  }

  if (fingerprint.columnCount !== fileMeta.columnCount || fingerprint.dataRowCount !== fileMeta.rowCount) {
    return {
      code: "file-mismatch",
      message: `The file metadata reports ${fileMeta.rowCount} data row(s) in ${fileMeta.columnCount} column(s), and the summary's fingerprint describes ${fingerprint.dataRowCount} in ${fingerprint.columnCount}. A changed file needs a fresh review.`,
    };
  }

  if (!sameFingerprint(rowDecisions.fingerprint, fingerprint)) {
    return {
      code: "decisions-mismatch",
      message: `These row decisions were recorded against a different version of this file: it held ${rowDecisions.fingerprint.dataRowCount} data row(s) in ${rowDecisions.fingerprint.columnCount} column(s) then, and holds ${fingerprint.dataRowCount} in ${fingerprint.columnCount} now. A changed file needs a fresh review.`,
    };
  }

  return null;
}

/**
 * Builds the receipt for one acceptance, or refuses inputs that describe two different files. One
 * result is produced per data row of the reviewed summary, in file order, and the counts are taken
 * from those results, so `results.length` and the counts always agree. Every effect this describes is
 * on the local synthetic record set.
 */
export function buildReceipt(input: ImportReceiptBuildInput): ImportReceiptBuild {
  const refusal = inputRefusalOf(input);
  if (refusal !== null) return { ok: false, refusal };

  const applicationByRow = indexApplications(input.applications);
  const results = input.summary.rows.map((row) =>
    resultFor(row, applicationByRow.get(row.rowNumber)),
  );

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
      facts: {
        memberships: 0,
        consentRecords: 0,
        audienceMembers: 0,
        safetyQualified: false,
        externalEffects: 0,
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Phase D: the stored shape, checked before any of it is trusted
// ---------------------------------------------------------------------------------------------
//
// The store is JSON, so a receipt read back from it is a document of unknown shape until it has been
// checked. These schemas are the receipt's shape stated as code, and each is annotated with the
// interface it describes: a change to a domain type stops compiling here rather than letting the two
// drift, which is what keeps a stored receipt from being read as a shape it no longer has.

/** The preserved-cell reasons `validate.ts` states as a type; a stored document names one of them. */
const PRESERVED_REASONS = [
  "blank-cell",
  "rejected-value",
  "consent-preserved",
  "excluded-topic",
  "unmapped-column",
] as const satisfies readonly ImportPreservedReason[];

/**
 * The reasons a mapping gives for leaving a column out, restated with a `satisfies` clause: a reason
 * this file cannot name, or one that is no longer a member of the mapping's union, fails to compile.
 */
const COLUMN_IGNORE_REASONS = [
  "blank-header",
  "unrecognised-header",
  "consent-preserved-as-data",
  "excluded-topic",
  "field-declined",
  "not-chosen",
] as const satisfies readonly ImportColumnIgnoreReason[];

/**
 * Every reason `decide.ts` can report for a blocked row — the four field issues, the two row faults
 * `parse.ts` measures, and a reuse the comparison no longer offers — in that module's own order.
 */
const BLOCKING_REASON_CODES = [
  "name-missing",
  "email-not-complete",
  "phone-not-a-number",
  "postal-not-an-address",
  "ragged-row",
  "cell-too-long",
  "reuse-not-offered",
] as const satisfies readonly ImportBlockingReasonCode[];

const ROW_NUMBER_SCHEMA = z.number().int().min(1);
const COUNT_SCHEMA = z.number().int().min(0);

const REFERENCE_SCHEMA: z.ZodType<ImportMatchReference> = z.strictObject({
  system: z.string().min(1),
  reference: z.string().min(1),
});

const FINGERPRINT_SCHEMA: z.ZodType<ImportFileFingerprint> = z.strictObject({
  checksum: z.string().min(1),
  columnCount: COUNT_SCHEMA,
  dataRowCount: COUNT_SCHEMA,
});

const ROUTE_SCHEMA: z.ZodType<ImportResultRoute> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("partner"), partnerRef: REFERENCE_SCHEMA }),
  z.strictObject({ kind: z.literal("correction"), rowNumber: ROW_NUMBER_SCHEMA }),
]);

const RESULT_SCHEMA: z.ZodType<ImportRowResult> = z.strictObject({
  rowNumber: ROW_NUMBER_SCHEMA,
  state: z.enum(IMPORT_ROW_RESULT_STATES),
  reasonCode: z.enum(IMPORT_RESULT_REASON_CODES),
  reason: z.string().min(1),
  route: ROUTE_SCHEMA.nullable(),
});

const FILE_META_SCHEMA: z.ZodType<ImportReceiptFileMeta> = z.strictObject({
  name: z.string(),
  bytes: COUNT_SCHEMA,
  rowCount: COUNT_SCHEMA,
  columnCount: COUNT_SCHEMA,
});

const COUNTS_SCHEMA: z.ZodType<ImportReceiptCounts> = z.strictObject({
  accepted: COUNT_SCHEMA,
  alreadyAccepted: COUNT_SCHEMA,
  skipped: COUNT_SCHEMA,
  needsReview: COUNT_SCHEMA,
  failed: COUNT_SCHEMA,
  total: COUNT_SCHEMA,
});

const CANCELLATION_SCHEMA: z.ZodType<ImportReceiptCancellation> = z.strictObject({
  cancelledAt: z.string().min(1),
  acceptedRowsRetained: COUNT_SCHEMA,
  stoppedRows: COUNT_SCHEMA,
  recallsCreatedRecords: z.literal(false),
});

const FACTS_SCHEMA: z.ZodType<ImportReceiptFacts> = z.strictObject({
  memberships: z.literal(0),
  consentRecords: z.literal(0),
  audienceMembers: z.literal(0),
  safetyQualified: z.literal(false),
  externalEffects: z.literal(0),
});

const FIELD_ID_SCHEMA = z.enum(IMPORT_FIELD_IDS);

const FIELD_ASSIGNMENT_SCHEMA: z.ZodType<ImportFieldAssignment> = z.strictObject({
  fieldId: FIELD_ID_SCHEMA,
  columnIndex: ROW_NUMBER_SCHEMA,
});

const IGNORED_COLUMN_SCHEMA: z.ZodType<ImportIgnoredColumn> = z.strictObject({
  index: ROW_NUMBER_SCHEMA,
  header: z.string(),
  occurrence: ROW_NUMBER_SCHEMA,
  reason: z.enum(COLUMN_IGNORE_REASONS),
  message: z.string(),
});

const CONFIRMED_MAPPING_SCHEMA: z.ZodType<ImportConfirmedMapping> = z.strictObject({
  columnCount: COUNT_SCHEMA,
  assignments: z.array(FIELD_ASSIGNMENT_SCHEMA),
  fields: z.array(FIELD_ID_SCHEMA),
  declined: z.array(FIELD_ID_SCHEMA),
  unmapped: z.array(FIELD_ID_SCHEMA),
  ignored: z.array(IGNORED_COLUMN_SCHEMA),
});

const VERDICT_SCHEMA: z.ZodType<ImportRowVerdict> = z.enum(["ready", "needs-correction"]);

const CORRECTION_SCHEMA: z.ZodType<ImportRecordedCorrection> = z.strictObject({
  columnNumber: ROW_NUMBER_SCHEMA,
  fieldId: FIELD_ID_SCHEMA,
  value: z.string(),
});

const ROW_DECISION_SCHEMA: z.ZodType<ImportRowDecision> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create"),
    rowNumber: ROW_NUMBER_SCHEMA,
    verdict: VERDICT_SCHEMA,
    corrections: z.array(CORRECTION_SCHEMA),
  }),
  z.strictObject({
    kind: z.literal("reuse"),
    rowNumber: ROW_NUMBER_SCHEMA,
    verdict: VERDICT_SCHEMA,
    candidate: REFERENCE_SCHEMA,
    corrections: z.array(CORRECTION_SCHEMA),
  }),
  z.strictObject({
    kind: z.literal("skip"),
    rowNumber: ROW_NUMBER_SCHEMA,
    verdict: VERDICT_SCHEMA,
    workerReason: z.string(),
    rowProblem: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("unresolved"),
    rowNumber: ROW_NUMBER_SCHEMA,
    verdict: VERDICT_SCHEMA,
  }),
]);

const DECISION_SET_SCHEMA: z.ZodType<ImportDecisionSet> = z.strictObject({
  fingerprint: FINGERPRINT_SCHEMA,
  decisions: z.array(ROW_DECISION_SCHEMA),
});

const DECISION_COUNTS_SCHEMA: z.ZodType<ImportDecisionCounts> = z.strictObject({
  create: COUNT_SCHEMA,
  reuse: COUNT_SCHEMA,
  skip: COUNT_SCHEMA,
  unresolved: COUNT_SCHEMA,
  total: COUNT_SCHEMA,
});

const BLOCKED_REASON_COUNT_SCHEMA: z.ZodType<ImportBlockedReasonCount> = z.strictObject({
  code: z.enum(BLOCKING_REASON_CODES),
  label: z.string(),
  count: COUNT_SCHEMA,
});

const CORRECTION_COUNT_SCHEMA: z.ZodType<ImportCorrectionCount> = z.strictObject({
  fieldId: FIELD_ID_SCHEMA,
  label: z.string(),
  count: COUNT_SCHEMA,
});

const PRESERVED_COLUMN_SCHEMA: z.ZodType<ImportPreservedColumnSummary> = z.strictObject({
  columnNumber: ROW_NUMBER_SCHEMA,
  header: z.string(),
  reason: z.enum(PRESERVED_REASONS),
  statesConsent: z.boolean(),
  cellCount: COUNT_SCHEMA,
});

const DECISION_FACTS_SCHEMA: z.ZodType<ImportDecisionFacts> = z.strictObject({
  memberships: z.literal(0),
  consentRecords: z.literal(0),
  audienceMembers: z.literal(0),
  preservedColumnsCreateNothing: z.literal(true),
});

const SUMMARY_ROW_SCHEMA: z.ZodType<ImportDecisionSummaryRow> = z.strictObject({
  rowNumber: ROW_NUMBER_SCHEMA,
  decisionKind: z.enum(IMPORT_DECISION_KINDS),
  verdict: VERDICT_SCHEMA,
  blockedReasons: z.array(z.enum(BLOCKING_REASON_CODES)),
  correctedFields: z.array(FIELD_ID_SCHEMA),
});

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

/**
 * The receipt as it is stored, validated before it is trusted. A document with an unknown member, a
 * result state outside the five, a foreign receipt format or an empty reference fails here rather than
 * reaching a surface, and the caller reports it as `unavailable` exactly as it would report a source
 * that answered with nothing.
 */
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

/**
 * The two facts a failed parse yields that a readable reason needs, without naming zod's own types —
 * the same narrowing `decide.ts` uses, so a change inside the schema library cannot reach a message.
 */
interface ReceiptReadFailure {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}

/** The first problem a failed parse reported, named by its path so a reader can find the field. */
function describeFirstIssue(failure: ReceiptReadFailure): string {
  const [issue] = failure.issues;
  if (issue === undefined) return "the stored value is not a contact-import receipt";
  const path = issue.path.map((part) => String(part)).join(".");
  return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}

/**
 * Why a receipt's own numbers do not add up, or null when they do. Agreement is checked here rather
 * than assumed: a receipt is the record a worker relies on after a lost acknowledgement, so the row
 * count, the counters, the three copies of the fingerprint and every row's route have to hold together
 * before any of it is reported as the result of an import.
 */
function integrityProblemOf(receipt: ImportReceipt): string | null {
  const { results, counts, summary } = receipt;

  if (results.length !== counts.total) {
    return `${results.length} row result(s) are recorded and the counts report ${counts.total}.`;
  }
  if (summary.totalRowCount !== results.length || summary.counts.total !== results.length) {
    return `The results describe ${results.length} row(s) and the reviewed summary ${summary.totalRowCount}.`;
  }

  for (const [offset, result] of results.entries()) {
    // Row numbers are the file's own, contiguous from 1: a gap, a repeat or a reordering means these
    // results do not describe one parsed file in its own order.
    if (result.rowNumber !== offset + 1) {
      return `Row result ${offset + 1} carries row number ${result.rowNumber} instead of ${offset + 1}.`;
    }
    if (STATE_BY_REASON[result.reasonCode] !== result.state) {
      return `Row ${result.rowNumber} reports "${result.state}" for the reason "${result.reasonCode}".`;
    }
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
  for (const [key, held] of recounters) {
    if (counts[key] !== held) {
      return `The counts report ${key} as ${counts[key]} where the results give ${held}.`;
    }
  }

  if (
    !sameFingerprint(receipt.fingerprint, summary.fingerprint) ||
    !sameFingerprint(receipt.fingerprint, receipt.rowDecisions.fingerprint)
  ) {
    return "The receipt's fingerprint, its reviewed summary and its row decisions describe different files.";
  }

  const { cancellation } = receipt;
  if (cancellation !== null) {
    const retained = recounted.accepted + recounted.alreadyAccepted;
    if (cancellation.acceptedRowsRetained !== retained) {
      return `The cancellation reports ${cancellation.acceptedRowsRetained} retained row(s) where ${retained} row(s) are accepted.`;
    }
    if (cancellation.stoppedRows !== recounted.skipped) {
      return `The cancellation reports ${cancellation.stoppedRows} stopped row(s) where ${recounted.skipped} row(s) are skipped.`;
    }
  }

  return null;
}

/** Whether a result carries the route its state requires: a contact, a correction, or nothing. */
function routeProblemOf(result: ImportRowResult): string | null {
  const accepted = result.state === "accepted" || result.state === "already-accepted";
  if (accepted) {
    if (result.route === null || result.route.kind !== "partner") {
      return `Row ${result.rowNumber} is ${result.state} without the contact it points at.`;
    }
    return null;
  }
  if (result.state === "skipped") {
    return result.route === null ? null : `Row ${result.rowNumber} is skipped but carries a route.`;
  }
  if (
    result.route === null ||
    result.route.kind !== "correction" ||
    result.route.rowNumber !== result.rowNumber
  ) {
    return `Row ${result.rowNumber} is ${result.state} without a correction route to its own row.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Phase E: recovery by operation identity
// ---------------------------------------------------------------------------------------------

/**
 * The parts of a request that make its intent. Two calls with the same operation identity and the
 * same three parts are the same attempt; a change to any of them is a different import wearing an
 * identity that already belongs to another.
 */
export interface ImportReceiptIntent {
  readonly fingerprint: ImportFileFingerprint;
  readonly mapping: ImportConfirmedMapping;
  readonly rowDecisions: ImportDecisionSet;
}

/** One part of an intent, so a conflict names which parts disagree instead of only that they do. */
export type ImportReceiptIntentPart = "file" | "mapping" | "row-decisions";

/**
 * A caller's claim on an operation identity: the identity it means to act under, and the intent it
 * believes that identity carries. The mapping and the decisions are the caller's own, preserved
 * unchanged in a conflict so the two versions can be read side by side.
 */
export interface ImportReceiptRequest extends ImportReceiptIntent {
  readonly importOperationId: string;
}

/** Whether a stored receipt could be read at all, and if not, which fact stopped it. */
export type ImportReceiptUnavailableCode = "receipt-unreadable" | "receipt-inconsistent";

/**
 * What the store held for one import operation: the receipt itself, an explicit absence, or a
 * document that could not be trusted. Absence and unreadability are kept apart on purpose — the first
 * says nothing was stored under that identity, the second says something was and cannot be relied on —
 * and neither is ever reported as an empty success.
 */
export type ImportReceiptRead =
  | { readonly kind: "found"; readonly receipt: ImportReceipt }
  | {
      readonly kind: "not-found";
      readonly importOperationId: string;
      readonly message: string;
    }
  | {
      readonly kind: "unavailable";
      readonly importOperationId: string;
      readonly reasonCode: ImportReceiptUnavailableCode;
      readonly reason: string;
    };

/**
 * What a caller learns when it claims an operation identity: the stored receipt when the intent is the
 * same, a conflict carrying both intents when it is not, and otherwise the absence or the
 * unreadability `readStoredReceipt` reported. There is deliberately no retry, resend or re-apply
 * variant: uncertainty is answered by reading the identity again, never by repeating the effect.
 */
export type ImportReceiptLookup =
  | ImportReceiptRead
  | {
      readonly kind: "conflict";
      readonly importOperationId: string;
      /** The intent the receipt was built under. */
      readonly stored: ImportReceiptIntent;
      /** The caller's intent, preserved exactly as it arrived. */
      readonly requested: ImportReceiptIntent;
      readonly differingParts: readonly ImportReceiptIntentPart[];
      readonly message: string;
    };

const NOT_FOUND_MESSAGE =
  "No receipt is stored under this import operation. Nothing is reported as applied under this identity, so check the operation's recorded result before repeating any of this work.";

const UNTRUSTWORTHY_TRAILER =
  "Nothing is reported as applied from it, so check the operation's recorded result before repeating any of this work.";

/** The noun a conflict uses for each part of an intent. */
const INTENT_PART_NOUNS: Readonly<Record<ImportReceiptIntentPart, string>> = {
  file: "file",
  mapping: "column mapping",
  "row-decisions": "row decisions",
};

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The canonical text of a JSON value: object keys in sorted code-unit order, so two structurally
 * equal values compare equal however the store happened to write their keys, and no key-order accident
 * can make a replay of the same intent look like a changed one.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
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

/** The intent a stored receipt was built under. */
function intentOf(receipt: ImportReceipt): ImportReceiptIntent {
  return {
    fingerprint: receipt.fingerprint,
    mapping: receipt.mapping,
    rowDecisions: receipt.rowDecisions,
  };
}

/** Every part of the intent the request changes, in a fixed order. */
function differingPartsOf(
  receipt: ImportReceipt,
  request: ImportReceiptRequest,
): ImportReceiptIntentPart[] {
  const stored = intentOf(receipt);
  const parts: ImportReceiptIntentPart[] = [];
  if (canonicalJson(stored.fingerprint) !== canonicalJson(request.fingerprint)) parts.push("file");
  if (canonicalJson(stored.mapping) !== canonicalJson(request.mapping)) parts.push("mapping");
  if (canonicalJson(stored.rowDecisions) !== canonicalJson(request.rowDecisions)) {
    parts.push("row-decisions");
  }
  return parts;
}

/** "the file", "the file and the row decisions", or "the file, the column mapping and the row decisions". */
function joinNouns(parts: readonly ImportReceiptIntentPart[]): string {
  const nouns = parts.map((part) => `the ${INTENT_PART_NOUNS[part]}`);
  const [first, ...rest] = nouns;
  if (first === undefined) return "nothing";
  const last = rest.pop();
  if (last === undefined) return first;
  if (rest.length === 0) return `${first} and ${last}`;
  return `${first}, ${rest.join(", ")} and ${last}`;
}

/**
 * Reads the receipt stored under one import operation, validating it with `RECEIPT_SCHEMA` and then
 * checking that its numbers agree with each other. A malformed document is reported as `unavailable`
 * rather than as an absent or an empty result, because a receipt that cannot be trusted is not
 * evidence that nothing happened.
 */
export function readStoredReceipt(stored: unknown, importOperationId: string): ImportReceiptRead {
  if (stored === null || stored === undefined) {
    return { kind: "not-found", importOperationId, message: NOT_FOUND_MESSAGE };
  }

  const parsed = RECEIPT_SCHEMA.safeParse(stored);
  if (!parsed.success) {
    return {
      kind: "unavailable",
      importOperationId,
      reasonCode: "receipt-unreadable",
      reason: `The receipt stored under this import operation cannot be read (${describeFirstIssue(parsed.error)}). ${UNTRUSTWORTHY_TRAILER}`,
    };
  }

  const receipt = parsed.data;
  if (receipt.importOperationId !== importOperationId) {
    // The document belongs to another operation, so nothing is stored under the identity asked for.
    return { kind: "not-found", importOperationId, message: NOT_FOUND_MESSAGE };
  }

  const problem = integrityProblemOf(receipt);
  if (problem !== null) {
    return {
      kind: "unavailable",
      importOperationId,
      reasonCode: "receipt-inconsistent",
      reason: `The receipt stored under this import operation does not add up: ${problem} ${UNTRUSTWORTHY_TRAILER}`,
    };
  }

  return { kind: "found", receipt };
}

/**
 * Decides what a caller claiming an operation identity gets: the stored receipt unchanged when the
 * intent is the same, a conflict carrying both intents when it differs, and otherwise what
 * `readStoredReceipt` found. No branch re-applies a row, so a replay can never produce a second
 * contact.
 */
export function resolveReceiptLookup(
  stored: unknown,
  request: ImportReceiptRequest,
): ImportReceiptLookup {
  const read = readStoredReceipt(stored, request.importOperationId);
  if (read.kind !== "found") return read;

  const differingParts = differingPartsOf(read.receipt, request);
  if (differingParts.length === 0) return read;

  return {
    kind: "conflict",
    importOperationId: request.importOperationId,
    stored: intentOf(read.receipt),
    requested: {
      fingerprint: request.fingerprint,
      mapping: request.mapping,
      rowDecisions: request.rowDecisions,
    },
    differingParts,
    message: `This operation identity was already used for a different import. What no longer matches the stored receipt: ${joinNouns(differingParts)}. Nothing was changed and no row was applied again. If the file or the decisions changed, start a new import so the changed work gets its own identity.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Phase F: cancellation after acceptance
// ---------------------------------------------------------------------------------------------

/**
 * Stops every row the acceptance had not applied, and leaves every row it had applied exactly as it
 * stands. Rows that were accepted or re-applied by an earlier attempt keep their state, their reason
 * and the reference of the record that exists, so nothing already created is deleted, reverted or
 * re-reported as cancelled; the cancellation record states that it recalls nothing. A second
 * cancellation returns the receipt unchanged, so the instant the first one stopped the work is
 * preserved.
 */
export function cancelUnacceptedRows(receipt: ImportReceipt, cancelledAt: string): ImportReceipt {
  if (receipt.cancellation !== null) return receipt;

  const results = receipt.results.map((result) =>
    result.state === "accepted" || result.state === "already-accepted"
      ? result
      : cancelledResult(result.rowNumber),
  );
  const counts = countsOf(results);
  const acceptedRowsRetained = counts.accepted + counts.alreadyAccepted;

  return {
    ...receipt,
    results,
    counts,
    cancellation: {
      cancelledAt,
      acceptedRowsRetained,
      stoppedRows: counts.total - acceptedRowsRetained,
      recallsCreatedRecords: false,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Phase G: what this file deliberately does not do
// ---------------------------------------------------------------------------------------------
//
// Nothing here parses a file, suggests a mapping, validates a row, records a decision, applies one,
// re-applies one, mints an operation identity, reads a clock or stores anything: `parse.ts`, `map.ts`,
// `validate.ts` and `decide.ts` own steps one to four, and the service owns acceptance, persistence and
// the operation ledger. A refusal here never deletes or reverses an effect — it reports a shape or a
// numbering that does not hold together, and the caller keeps whatever the store still holds.
//
// No result offers a resend, a retry or a re-apply, because a lost acknowledgement is answered by
// reading the same operation identity rather than by repeating the effect: a result states what
// happened — applied, applied by an earlier attempt, skipped, still needing review, failed — and
// carries no action that would do it again. Nothing claims that the file was safe, that a message was
// delivered, or that a partner consented: `facts` carries those as zeros and `false`, a consent-looking
// column stays preserved data in the reviewed summary, and no route in a result is a URL — the import
// feature builds every href from the descriptors defined here.

