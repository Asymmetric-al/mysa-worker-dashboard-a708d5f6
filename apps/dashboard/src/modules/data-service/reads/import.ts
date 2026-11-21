/**
 * Contact import reads: the proposal a worker is reviewing, and the recoverable receipt of an
 * acceptance looked up by its operation identity.
 *
 * Plan items that put this file in scope: AAP 0.9.1's `data-service/reads/*` tree and 0.11.1's
 * "reads/*.ts (11 files)" row; 0.7.1's job group "Bring in a contact list", whose reads are
 * `readImportProposal` and `readImportReceipt`; 0.6.3's `GET /api/import/[operationId]` receipt
 * lookup; and criterion 4's recovery after a lost acknowledgement.
 *
 * Two reads, and the difference between them is the design. A proposal is unfinished work: it reports
 * the file the worker chose, every limit the step displays beside it, the mapping column by column,
 * the decision recorded about each row and the summary acceptance is reviewed against. A receipt is a
 * finished fact: it is looked up by operation identity and returned exactly as it was recorded, so a
 * lost acknowledgement recovers the original result instead of processing the file a second time.
 *
 * Scope comes from the session, never from the request. The proposal family the store holds carries no
 * scope of its own, so ownership is read from the operation ledger entry that recorded the proposal —
 * the one place a stored operation states the authority it ran under — and a proposal whose entry
 * belongs to another scope is never enumerated. Authorisation precedes enumeration: a refusal carries
 * no count, no row count, no file name and no existence flag, which is why an unknown operation
 * identity and another scope's identity answer identically.
 *
 * Importing a contact creates a private contact entry and nothing else. This file keeps that true
 * structurally rather than by habit: it carries no field whose name or value is a permission fact, and
 * it reads no consent-derived tally out of the stored summary it projects. A column headed like a
 * subscription statement stays preserved data in the stored record, is never surfaced here as if it
 * permitted anything, and importing or editing a contact subscribes nobody. A successful local parse
 * is never presented as a safety qualification of the file, and an original file name is display
 * metadata only: it establishes no type, and it is never parsed, joined, put into a path or echoed
 * into a message.
 *
 * Layering: one of the service's named reads. It re-derives scope through `authorize.ts`, reads the
 * session documents through the store's one read function, and otherwise only projects what
 * `modules/import/*` produced — no limit, mapping rule, validation rule, decision rule or receipt
 * shape is restated here. It imports no component, no feature and no application route, never parses a
 * file, never opens one and never reads the uploaded bytes again, and it writes nothing at all: every
 * change belongs to the named mutations, and a receipt is recovered by reading its identity rather
 * than by repeating an effect.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { isRecord } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { assertNever } from "@/lib/result";
import type { ImportDecisionKind, ImportDecisionSummary } from "@/modules/import/decide";
import { IMPORT_FIELD_VOCABULARY, type ImportFieldId } from "@/modules/import/map";
import {
  IMPORT_LIMIT_DESCRIPTORS,
  type ImportLimitId,
  type ImportLimitUnit,
} from "@/modules/import/parse";
import {
  IMPORT_RECEIPT_FORMAT,
  readStoredReceipt,
  type ImportReceipt,
  type ImportReceiptRead,
  type ImportResultRoute,
} from "@/modules/import/receipt";
import { readSession } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";

import { assertScope, resolveSession, type ResolvedSession, type SessionSource } from "../authorize";
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

// ---------------------------------------------------------------------------------------------
// Copy the review and result steps show, in the closed vocabularies the record stores
// ---------------------------------------------------------------------------------------------

/** The four decisions as the review step words them, keyed by the value the record stores. */
const DECISION_LABELS: Readonly<Record<ImportRowDecision, string>> = {
  "new-private-entry": "Create a new private entry",
  "reuse-authorized-identity": "Reuse an authorized identity",
  skip: "Skip the row",
  unresolved: "Leave unresolved",
};

/** The five results one row can end in, as the result step words them. There is no sixth. */
const ROW_STATE_LABELS: Readonly<Record<ImportRowState, string>> = {
  accepted: "Accepted",
  "already-accepted": "Accepted by an earlier attempt",
  skipped: "Skipped",
  "needs-review": "Needs review",
  failed: "Failed",
};

/**
 * The four decisions in the order the review step offers them, taken from the stored vocabulary so a
 * fifth decision would be a type error rather than a second list.
 */
const DECISION_OPTIONS: readonly ImportDecisionOption[] = Object.freeze(
  IMPORT_ROW_DECISIONS.map((value) => Object.freeze({ value, label: DECISION_LABELS[value] })),
);

/** What the review step shows when the saved proposal does not hold detail the step itself produced. */
const PROPOSAL_REVIEW_DETAIL: ImportProposalReviewDetail = Object.freeze({
  recorded: Object.freeze(["column-mapping", "row-decisions", "row-results", "summary"]),
  notRecorded: Object.freeze([
    "duplicate-contact-suggestions",
    "preserved-restrictions",
    "field-issues",
    "preserved-cells",
    "unused-columns-and-their-reasons",
  ]),
  message:
    "The saved proposal holds the columns a field is supplied from, the decision recorded about each row, any row result already recorded, and the summary acceptance is reviewed against. Duplicate-contact suggestions, preserved restrictions, per-field issues and the columns no field uses — with the reason each was left out — belong to the review step that produced this proposal and are not part of the saved record, so their absence here means they were not recorded — never that none was found.",
});

// ---------------------------------------------------------------------------------------------
// Fixed values of this read
// ---------------------------------------------------------------------------------------------

/**
 * The attempt identity a read refusal carries. A read changes nothing, so it has no attempt of its
 * own to replay; the value states that instead of inventing an identifier, and keeps the refusal's
 * shape identical to a mutation's.
 */
const READ_ATTEMPT_ID = "read";

/**
 * The opaque source reference a proposal read reports instead of an operation identity: the proposal
 * family itself is the source, and there is no operation to name when none could be read.
 */
const PROPOSAL_SOURCE_REFERENCE = "import-proposal";

/** The row-detail page size these reads use: 50 by default, capped at 200 (AAP 0.8.7). */
const DEFAULT_ROW_PAGE_SIZE = 50;

/** The row-detail page-size cap, so a request for more rows is clamped rather than honoured. */
const MAX_ROW_PAGE_SIZE = 200;

/**
 * How deep a stored operation's result is searched for a receipt. The receipt identifies itself by
 * its own format tag and operation identity, so the search looks for it instead of assuming which
 * wrapper the acceptance writes around it; the bound keeps a pathological document from being walked.
 */
const RECEIPT_SEARCH_DEPTH = 4;

/**
 * Import reads are not financial and describe one file rather than a period, so their coverage is
 * complete with no boundaries: the record is everything the read has, and no value in it is a partial
 * subtotal of a longer span.
 */
const IMPORT_COVERAGE: Coverage = Object.freeze({ from: null, to: null, state: "complete" });

// ---------------------------------------------------------------------------------------------
// The stored documents these reads open, validated before any of them is trusted
// ---------------------------------------------------------------------------------------------

/**
 * The one family of the session's state document an import proposal lives in.
 *
 * The store is JSON, so the document is a value of unknown shape until it has been checked; a document
 * with no proposal family is reported as unreadable rather than served as "no proposal", because "the
 * store holds none" and "this build cannot read what the store holds" are different facts.
 */
const importStateDocumentSchema = z.object({
  importProposals: z.array(importProposalRecordSchema),
});

/**
 * The operation ledger document, in either arrangement this build finds it in.
 *
 * The service's own ledger appends an accepted attempt to a `records` map keyed by `operationId`, and
 * the deterministic seed writes the same entries as an `entries` array. Both are the same information,
 * so both are read here rather than one being reported as an unreadable document — which would lose the
 * ownership of every proposal and the receipt of every acceptance the moment a session accepted its
 * first operation. Only the scope and the result are read from an entry: the scope is the authority a
 * proposal was recorded under, and the result is where an acceptance keeps its receipt.
 */
const operationLedgerDocumentSchema = z.object({
  entries: z.array(operationRecordSchema).optional(),
  records: z.record(z.string().min(1), operationRecordSchema).optional(),
});

/**
 * Every entry of a stored ledger, normalised from whichever arrangement the document holds, or null when
 * the document is not a ledger this build can read.
 *
 * An entry whose map key disagrees with its own `operationId`, or one identity recorded twice with
 * different intent, is refused rather than merged: a ledger that cannot say which attempt an entry
 * belongs to cannot establish whose work it is.
 */
function ledgerEntriesOf(
  document: z.infer<typeof operationLedgerDocumentSchema>,
): readonly OperationRecord[] | null {
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

/** What one read needs from the session's documents. `null` means the document could not be read. */
interface ImportDocuments {
  readonly proposals: readonly ImportProposalRecord[] | null;
  readonly entries: readonly OperationRecord[] | null;
}

// ---------------------------------------------------------------------------------------------
// What a proposal read returns
// ---------------------------------------------------------------------------------------------

/** Paging of a per-row detail list. Defaults come from this file; a caller supplies only what it means. */
export interface ImportPagingInput {
  readonly page?: number;
  readonly pageSize?: number;
}

/** The paging a read actually applied, so a surface states the window it is showing. */
export interface ImportRowWindow {
  /** 1-based page number, clamped to the last page when the caller asked for one past the end. */
  readonly page: number;
  /** The page size applied after the cap. */
  readonly pageSize: number;
  /** How many rows match before paging: a whole-result count, never the size of the loaded page. */
  readonly total: number;
  /** How many pages the matching rows occupy; at least 1, so an empty filter still reads as one page. */
  readonly pageCount: number;
}

/** A result state a row can be filtered by, plus the state of a row nothing has been recorded for. */
export type ImportRowFilterState = ImportRowState | "not-recorded";

/**
 * One filter a caller may apply to the per-row detail. Filtering happens here, over the whole record,
 * so a surface never receives the rows of one page and filters them itself.
 */
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
  /** Whether exceeding this limit refuses the whole file or only the row that holds it. */
  readonly refusesWholeFile: boolean;
  /** The boundary sentence the import step shows before any work begins. */
  readonly boundary: string;
  /**
   * This file's measured value, or `null` when the saved record does not hold one. The read states the
   * measurement and the admitted limit and leaves the verdict to the module that enforced it, so the
   * limit rule is never restated here.
   */
  readonly measured: number | null;
}

/** One column of the file, addressed by position so a repeated header stays a distinct column. */
export interface ImportProposalColumnView {
  /** 1-based position in the file, which is this column's identity. */
  readonly columnIndex: number;
  readonly header: string;
  /** 1-based ordinal of this header text among identical headers, so two "Email" columns stay two. */
  readonly occurrence: number;
  /** The stored field key this column supplies, or `null` when the record states it supplies none. */
  readonly field: string | null;
  /** The vocabulary's label for that field, or `null` when the vocabulary does not name the key. */
  readonly fieldLabel: string | null;
  /** True when the record states this column supplies no field, so it is named as ignored, not dropped. */
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
export type ImportProposalRowRoute =
  | { readonly kind: "partner"; readonly partnerId: string }
  | { readonly kind: "correction"; readonly rowNumber: number };

/** One row of a proposal: its decision, whatever result is already recorded, and the route to it. */
export interface ImportProposalRowView {
  readonly rowNumber: number;
  readonly decision: ImportRowDecision;
  readonly decisionLabel: string;
  /** The existing identity a reuse decision targets; `null` for every other decision. */
  readonly reuseTargetPartnerId: string | null;
  /** The recorded result for this row, or `null` while nothing has been recorded about it. */
  readonly state: ImportRowState | null;
  readonly stateLabel: string | null;
  /** The recorded sentence for a problem this row has, or `null` when it has none recorded. */
  readonly reason: string | null;
  readonly route: ImportProposalRowRoute | null;
}

/**
 * How the file's rows divide, stated per decision so nothing is aggregated into one "contacts" number.
 * The four decision counts partition the file's rows exactly; `needsReview` is the record's own separate
 * count of rows that still want attention, and is never added to them.
 */
export interface ImportProposalSummaryView {
  readonly create: number;
  readonly reuse: number;
  readonly skip: number;
  /** Rows carrying no decision at all are unresolved too, so the four buckets always partition. */
  readonly unresolved: number;
  readonly needsReview: number;
  /** Every data row of the file: the count the four decisions partition. */
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
  /** The instant acceptance ran, or `null` while the proposal is still being reviewed. */
  readonly processedAt: string | null;
  readonly inFlight: boolean;
  readonly revision: string;
  /** The chosen file as measured before a row was processed. `name` is display metadata only. */
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
  /** A specific proposal to address; when absent the caller's current in-flight proposal is returned. */
  readonly importOperationId?: string;
  /** A session named directly by a development caller (a test or a script), never by the browser. */
  readonly session?: SessionSource;
}

// ---------------------------------------------------------------------------------------------
// What a receipt read returns
// ---------------------------------------------------------------------------------------------

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
  /** A contact to open or a row to correct, as data; the import feature builds the href from it. */
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
  /** Restrictions the file stated, none of which is read as a permission. */
  readonly restrictionsPreserved: number;
  /** Restrictions on rows that became a private preparation entry, and so were carried. */
  readonly restrictionsCarried: number;
}

/** What a cancellation did: the accepted rows it left in place and the rows it stopped. */
export interface ImportReceiptCancellationView {
  readonly cancelledAt: string;
  readonly acceptedRowsRetained: number;
  readonly stoppedRows: number;
}

/**
 * The recoverable receipt of one acceptance: the file it read, the mapping and decisions it was
 * accepted under, the summary it was reviewed against, one result per data row, the counts those
 * results add up to, and what a cancellation did if one happened.
 */
export interface ImportReceiptView {
  readonly importOperationId: string;
  /** The instant the acceptance ran, as the acceptance recorded it. */
  readonly processedAt: string;
  readonly revision: string;
  /** The file the results belong to. `name` is display metadata only, and establishes no type. */
  readonly file: {
    readonly name: string;
    readonly bytes: number;
    readonly rowCount: number;
    readonly columnCount: number;
  };
  readonly mapping: ImportReceiptMappingView;
  /** The five result states counted, plus the row total they add up to exactly. */
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
  /** A session named directly by a development caller (a test or a script), never by the browser. */
  readonly session?: SessionSource;
}


// ---------------------------------------------------------------------------------------------
// The caller: one session, one scope, and one shape for each refusal
// ---------------------------------------------------------------------------------------------

/** A caller as a read sees it: the session it acts for and the exact scope the read runs under. */
type ScopeResolution =
  | { readonly ok: true; readonly session: ResolvedSession; readonly scope: Scope }
  | { readonly ok: false; readonly result: ReadResult<never> };

/**
 * Resolves the session this request acts for and the scope its read runs under, or hands back the one
 * refusal the caller should see.
 *
 * The scope is the session's own selection with the principal the session resolved to; nothing in a
 * request, a query string or a payload can name one. A session that has selected no context has no
 * authority to act in, and a scope the caller is not admitted to is refused by the shared resolver
 * rather than by a second check here.
 */
async function resolveReadScope(source: SessionSource | undefined): Promise<ScopeResolution> {
  const resolution = await resolveSession(source);
  if (!resolution.ok) {
    return { ok: false, result: { kind: "denied", denied: resolution.denial } };
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

/**
 * The one refusal shape these reads produce.
 *
 * It carries a reason code describing the caller's relationship to the request and nothing else: no
 * count, no row count, no file name, no size and no existence flag, so an operation that is another
 * scope's and one that never existed answer identically and neither can be used to enumerate.
 */
function importDenied(reason: DenialReason = "no-permission"): ReadResult<never> {
  return { kind: "denied", denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }) };
}

/**
 * The one outage shape these reads produce: the source that could not answer and what the worker can
 * do next. An unreadable or absent source is never reported as an empty list or a zero, and the
 * diagnostic line names only the job and the source's opaque identity.
 */
function importUnavailable(job: string, reference: string, guidance: string): ReadResult<never> {
  const source = { system: LOCAL_STORE_SYSTEM, reference };
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}

/**
 * Reads the two session documents an import read needs, once, and validates each on its own.
 *
 * `undefined` means the store could not answer at all; a `null` member means that one document could
 * not be read as this build records it. The two are kept apart because a proposal needs both (its
 * record and the ledger entry that establishes whose it is) while a receipt needs only the ledger.
 */
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

// ---------------------------------------------------------------------------------------------
// Ownership: a proposal belongs to the scope its operation was recorded under
// ---------------------------------------------------------------------------------------------

/** One stored proposal beside the ledger entry that states the authority it was recorded under. */
interface OwnedProposal {
  readonly record: ImportProposalRecord;
  readonly entry: OperationRecord;
}

/**
 * Every proposal this caller owns, newest first.
 *
 * The proposal family carries no scope of its own, so ownership is read from the operation ledger
 * entry keyed by the proposal's own operation identity — the one place a stored operation states the
 * authority it ran under. A record with no such entry establishes no owner and is left out, and a
 * record whose entry belongs to another scope is another worker's work and is never enumerated.
 */
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

/** Orders proposals by the instant their operation was recorded, newest first, with a stable tiebreak. */
function newestFirst(left: OwnedProposal, right: OwnedProposal): number {
  const byInstant = Temporal.Instant.compare(
    Temporal.Instant.from(right.entry.at),
    Temporal.Instant.from(left.entry.at),
  );
  if (byInstant !== 0) {
    return byInstant;
  }
  return compareText(right.entry.operationId, left.entry.operationId);
}

/**
 * Code-unit ordering, never `localeCompare`: a locale-dependent sort would order the same two values
 * differently on a machine with a different default locale.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------
// Paging and value states, shared by both reads
// ---------------------------------------------------------------------------------------------

/** The page size a caller asked for, clamped to the documented default and cap. */
function resolvePageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) {
    return DEFAULT_ROW_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_ROW_PAGE_SIZE);
}

/**
 * The page of rows to show and the window that page sits in.
 *
 * The window's `total` counts the rows that matched before paging, so a surface always states the
 * whole-result count beside the page it loaded rather than presenting the page as the result.
 */
function pagedRows<T>(
  rows: readonly T[],
  paging: ImportPagingInput,
): { readonly rows: readonly T[]; readonly window: ImportRowWindow } {
  const pageSize = resolvePageSize(paging.pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const requested = paging.page;
  const page =
    requested === undefined || !Number.isFinite(requested) || requested < 1
      ? 1
      : Math.min(Math.floor(requested), pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    window: { page, pageSize, total: rows.length, pageCount },
  };
}

/**
 * The state of one measured value: a genuine zero and a value are stated apart, and a measurement the
 * record does not hold is `unknown` rather than nought. `incomplete-subtotal` is never named here: it
 * is `buildEnvelope`'s to derive from coverage.
 */
function measuredState(value: number | null): RecordedValueState {
  if (value === null) {
    return "unknown";
  }
  return value === 0 ? "zero" : "value";
}

/** Whether one row survives the filter a caller applied, judged over the whole record before paging. */
function matchesRowFilter(
  decision: ImportRowDecision,
  state: ImportRowState | null,
  filter: ImportRowFilter,
): boolean {
  if (filter.decision !== undefined && decision !== filter.decision) {
    return false;
  }
  if (filter.state !== undefined && (state ?? "not-recorded") !== filter.state) {
    return false;
  }
  return true;
}

/** The plain-language name the mapping vocabulary gives a field id, or null when it names none. */
function fieldLabelOf(fieldId: string): string | null {
  const field = IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId);
  return field === undefined ? null : field.label;
}


// ---------------------------------------------------------------------------------------------
// A proposal, projected from the record the review step saved
// ---------------------------------------------------------------------------------------------

/** One proposal's per-row records, indexed by row number and bounded to the rows it reports. */
interface ProposalIndex {
  readonly decisions: ReadonlyMap<number, ImportRowDecisionRecord>;
  readonly results: ReadonlyMap<number, ImportRowResultRecord>;
}

/**
 * Indexes a proposal's per-row records by row number.
 *
 * A row number outside `1 .. fileMeta.rowCount` addresses no row of this file, so it is left out of
 * the index rather than shown as a row the file does not have; where one row carries two entries, the
 * first recorded stands, which keeps the projection stable for a record written twice.
 */
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

/** Whether a stored row number addresses one of the file's data rows. */
function isReportedRow(rowNumber: number, rowCount: number): boolean {
  return Number.isInteger(rowNumber) && rowNumber >= 1 && rowNumber <= rowCount;
}

/**
 * The four displayed limits, each with this file's measured value in the limit's own unit.
 *
 * The descriptors come from the module that enforced them, so no number and no boundary sentence is
 * restated here, and no verdict is computed: a file that broke a whole-file limit never became a
 * proposal, and a row that broke the cell limit carries its own recorded reason.
 */
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

/**
 * This file's measured value for one limit, or `null` when the saved record does not hold it. The
 * longest cell is the only measurement a proposal does not keep, because a cell over the limit refuses
 * its own row and is reported there rather than measured for the whole file.
 */
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

/** The columns of one proposal, with the ignored ones named and repeated headers kept distinct. */
interface ProposalColumns {
  readonly columns: readonly ImportProposalColumnView[];
  readonly ignoredColumnIndexes: readonly number[];
  readonly repeatedHeaders: readonly ImportRepeatedHeaderView[];
}

/**
 * Projects the mapping the worker confirmed, column by column.
 *
 * Every column is addressed by its 1-based position, never by its header text, so two columns carrying
 * the same header stay two columns at two positions and neither overwrites the other; the header text
 * is carried as a label beside the position. The record states the columns a field is supplied from, so
 * a column no field uses is simply not in it — that is reported as not recorded rather than guessed
 * at — while a column the record states with no field is named as ignored instead of disappearing.
 */
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

/**
 * Counts the rows into the four decisions, over the whole file rather than over a page.
 *
 * A row nobody decided is unresolved rather than quietly counted as a new entry, so the four buckets
 * partition the file's rows exactly. `needsReview` is the record's own count of rows that still want
 * attention and is reported beside them, never added to them: a row can be decided for a new entry and
 * still be blocked, and one "contacts" total would hide which is which.
 */
function proposalSummaryOf(
  record: ImportProposalRecord,
  index: ProposalIndex,
): ImportProposalSummaryView {
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

/** Every row of the proposal in file order, with its decision, recorded result and route. */
function proposalRowsOf(
  record: ImportProposalRecord,
  index: ProposalIndex,
): readonly ImportProposalRowView[] {
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
      reuseTargetPartnerId:
        decision === "reuse-authorized-identity" ? (decisionRecord?.targetPartnerId ?? null) : null,
      state,
      stateLabel: state === null ? null : ROW_STATE_LABELS[state],
      reason: result?.message ?? null,
      route: proposalRouteOf(rowNumber, state, partnerId),
    });
  }
  return rows;
}

/**
 * Where a row sends the worker next, as data rather than as a URL. A row already applied points at the
 * record it became; a row that could not be applied points at itself so it can be corrected; a skipped
 * row and a row nothing has been recorded about offer no route, because there is nowhere to go.
 */
function proposalRouteOf(
  rowNumber: number,
  state: ImportRowState | null,
  partnerId: string | null,
): ImportProposalRowRoute | null {
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

/** One state per value-bearing field of a proposal, so a surface never formats a number alone. */
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

/**
 * The actions available on a proposal, advisory only: the service re-derives scope, permission and the
 * expected revision when one is submitted, so a stale envelope can produce a refusal but never an
 * unauthorised write. An action that is not available states why.
 */
function proposalActions(summary: ImportProposalSummaryView): readonly ReadAction[] {
  const acceptable = summary.create + summary.reuse;
  return [
    { name: "setRowDecision", available: true },
    acceptable > 0
      ? { name: "acceptImportRows", available: true }
      : {
          name: "acceptImportRows",
          available: false,
          reason:
            "No row is decided for a new entry or a reuse yet, so there is nothing to accept. Decide about a row, or skip it, before importing.",
        },
    { name: "cancelImport", available: true },
  ];
}

// ---------------------------------------------------------------------------------------------
// A receipt, projected from the record the acceptance saved
// ---------------------------------------------------------------------------------------------

/**
 * The summary members a receipt shows, in the order the review step reads them.
 *
 * The stored summary also carries the preserved-column tallies and a set of literal facts about what
 * acceptance creates nothing of. Neither is chosen here: a read whose subject is what the import did
 * carries no permission fact at all, and choosing the permitted shape in one place is what keeps that
 * true rather than trusting every surface to ignore what it was handed.
 */
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

/** Projects the summary acceptance was reviewed against, narrowed to the members chosen above. */
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

/** Projects the confirmed mapping the receipt was accepted under, column by column. */
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

/** One result per data row, in file order, with the decision acceptance was carried out under. */
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

/**
 * The record's decision vocabulary as the one the stored proposal and this receipt both report.
 *
 * The two are the same four facts stated by the two modules that own them, so the correspondence is
 * written once here, exhaustively: a fifth kind in either module stops this compiling instead of being
 * carried through as a decision no surface can word.
 */
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

/**
 * The revision a receipt presents.
 *
 * A receipt is an immutable record of one acceptance, so there is no stored revision to read: the value
 * is derived from the receipt's own content identity plus whether a cancellation has since stopped its
 * unapplied rows, which makes it stable across a replay of the same operation and different once the
 * outcome has changed.
 */
function receiptRevisionOf(receipt: ImportReceipt): string {
  const state =
    receipt.cancellation === null ? "accepted" : `cancelled:${receipt.cancellation.cancelledAt}`;
  return `${receipt.receiptFormat}:${receipt.fingerprint.checksum}:${state}`;
}

/** One state per value-bearing field of a receipt, so a surface never formats a count alone. */
function receiptValueStates(
  receipt: ImportReceipt,
  summary: ImportReceiptSummaryView,
  window: ImportRowWindow,
): Readonly<Record<string, RecordedValueState>> {
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
    states["cancellation.acceptedRowsRetained"] = measuredState(
      receipt.cancellation.acceptedRowsRetained,
    );
    states["cancellation.stoppedRows"] = measuredState(receipt.cancellation.stoppedRows);
  }
  return states;
}

/**
 * The actions available on a receipt, advisory only.
 *
 * There is deliberately no resend, retry or re-apply action: an uncertain outcome is answered by
 * reading this same operation identity again, never by repeating an effect, and a result states what
 * happened rather than offering to do it again. A cancellation is the one action left, and only while
 * something acceptance did not apply is still stoppable.
 */
function receiptActions(receipt: ImportReceipt): readonly ReadAction[] {
  if (receipt.cancellation !== null) {
    return [
      {
        name: "cancelImport",
        available: false,
        reason:
          "This import was already cancelled, and the rows it stopped stay stopped. Nothing is recalled, and no row is applied again from this receipt.",
      },
    ];
  }
  const unapplied =
    receipt.counts.total - receipt.counts.accepted - receipt.counts.alreadyAccepted;
  return unapplied > 0
    ? [{ name: "cancelImport", available: true }]
    : [
        {
          name: "cancelImport",
          available: false,
          reason:
            "Every row of this file was accepted, so there is nothing left for a cancellation to stop and nothing to recall.",
        },
      ];
}

/**
 * Finds the receipt a stored operation result carries for one operation identity.
 *
 * The receipt identifies itself by its own format tag and by the identity inside it, so the search
 * looks for it instead of assuming which wrapper acceptance writes around it, and a document that is
 * not a receipt is passed over rather than reported as unreadable. The walk is bounded and follows
 * the document's own member order, so the same stored result always yields the same answer; its depth
 * is small because a receipt sits at or one level under the operation's recorded result.
 */
function findStoredReceipt(
  value: unknown,
  importOperationId: string,
  depth = 0,
): ImportReceiptRead | null {
  if (depth > RECEIPT_SEARCH_DEPTH || value === null || value === undefined) {
    return null;
  }
  if (isRecord(value) && value["receiptFormat"] === IMPORT_RECEIPT_FORMAT) {
    return readStoredReceipt(value, importOperationId);
  }
  const children: readonly unknown[] = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
  for (const child of children) {
    const found = findStoredReceipt(child, importOperationId, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  return null;
}


// ---------------------------------------------------------------------------------------------
// The two reads
// ---------------------------------------------------------------------------------------------

/**
 * Reads the import proposal the caller is reviewing: the chosen file with every displayed limit and
 * its measured value, the mapping column by column, the decision recorded about each row, and the
 * summary acceptance is reviewed against. With an operation identity it returns that proposal; without
 * one it returns the caller's current in-flight proposal, and never another scope's.
 */
export async function readImportProposal(
  input: ReadImportProposalInput = {},
): Promise<ReadResult<ReadEnvelope<ImportProposalView>>> {
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
  const record =
    requested === undefined
      ? owned.find((proposal) => proposal.record.processedAt === null)?.record
      : owned.find((proposal) => proposal.record.importOperationId === requested)?.record;

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
  const matching = proposalRowsOf(record, index).filter((row) =>
    matchesRowFilter(row.decision, row.state, input),
  );
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
      asOf: now().toString(),
      coverage: IMPORT_COVERAGE,
      valueStates: proposalValueStates(record, summary, limits, paged.window),
      actions: proposalActions(summary),
    }),
  };
}

/**
 * Reads the recoverable receipt of one import acceptance by its operation identity: what became of
 * each data row, where to go next, and the counts those results add up to. A replay returns the
 * original result unchanged, because reading an identity applies nothing a second time.
 */
export async function readImportReceipt(
  importOperationId: string,
  input: ReadImportReceiptInput = {},
): Promise<ReadResult<ReadEnvelope<ImportReceiptView>>> {
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
  const ownedEntries = documents.entries.filter(
    (candidate) => candidate.operationId === importOperationId && sameScope(candidate.scope, scope),
  );
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
  const matching = receiptRowsOf(receipt).filter((row) =>
    matchesRowFilter(row.decision, row.state, input),
  );
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
      asOf: now().toString(),
      coverage: IMPORT_COVERAGE,
      valueStates: receiptValueStates(receipt, summary, paged.window),
      actions: receiptActions(receipt),
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// What these reads deliberately do not do
// ---------------------------------------------------------------------------------------------
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

