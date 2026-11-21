/**
 * Contact import, the four named mutations: propose a file, decide about one row, accept the reviewed
 * rows, cancel the rest.
 *
 * Plan items that put this file in scope: AAP 0.6.1's "Mutations: import" row (`proposeImport`,
 * `setRowDecision`, `acceptImportRows`, `cancelImport`); 0.7.1's job group "Bring in a contact list";
 * 0.9.1's `data-service/mutations/*` tree; 0.10.1 family 6, the five-step journey; 0.8.7's import
 * limits; and criterion 4, whose evidence is a lost acknowledgement recovered without a duplicate
 * contact and without a subscription. 0.12.5 arms `acceptImportRows` with the lost acknowledgement.
 *
 * **Each mutation is a thin composition, not a second pipeline.** The limits, the parse, the mapping
 * suggestion, the row validation, the four decisions, the fingerprint, the summary and the receipt are
 * all `@/modules/import`'s. This file validates a payload, authorises, applies the change inside the
 * runner's transaction and records it; it never re-implements a limit check, a parser, a mapping rule,
 * a duplicate suggestion or a receipt, and it imports no CSV or spreadsheet reader of its own.
 *
 * **The runner owns the order** (`../operations`): validate the envelope and the payload, resolve the
 * session, assert the scope, ask this mutation's authority question, detect a replay or a changed
 * intent, compare the revision, apply, re-check the scope the change produced, then record the ledger
 * entry in the same transaction. So no mutation here compares a revision, opens a transaction, writes
 * a ledger entry or builds an outcome for a replay: those would be a second implementation of one
 * contract, and the `mutation-contract` test exists to catch them.
 *
 * **A domain refusal cannot be raised from inside `apply`.** The runner's `apply` callback answers the
 * two-member `ApplyResult` — a change, or nothing to do — and converts a thrown value into
 * `unavailable`/`unknown`, because a thrown exception is a defect rather than a presentation. A refusal
 * this file decides on (`invalid` for a limit or a decision that cannot stand, `denied` for a reuse of
 * an identity this caller was not offered, `unavailable` for a stored document that cannot be read) is
 * therefore recorded in a local `refusal` variable and answered as `{ changed: false }`, which writes
 * nothing; once the runner has returned, the refusal replaces its `unchanged`. Any other outcome —
 * a replay, a conflict, a denial from the runner's own checks — stands, because nothing was applied for
 * it either.
 *
 * **Storage: one declared projection and one working record.** The state document's
 * `importProposals` family is the record `reads/import.ts` projects, so the proposal a worker reviews
 * and the receipt it becomes are written in exactly the shape that read parses. The working record this
 * file owns (`importReviews`) holds what the next step needs and the declared record deliberately does
 * not: the admitted UTF-8 text, the confirmed mapping, the recorded decision set (with its
 * corrections) and the receipt the acceptance produced. Both are written in the same transaction, and
 * every other family of the document is carried through untouched, so a mutation here never rewrites a
 * partner, a task or a gift it was not asked to change.
 *
 * **Importing subscribes nobody** (AAP 0.8.5). Acceptance creates private preparation entries and
 * nothing else: no membership, no consent record, no Update-audience member, no message. A column that
 * looks like a subscription statement stays preserved data in the reviewed record and is read as
 * nothing, and the receipt states those zeros as literal types rather than as a sentence a surface has
 * to trust. A successful local parse is never reported as a safety qualification of the file.
 *
 * **Recovery is by operation identity** (AAP 0.1.1). The receipt is what the ledger stores under the
 * operation that produced it, so a lost acknowledgement is answered by reading that identity again —
 * the acceptance's own identity for an acceptance, the cancellation's for a post-cancellation state —
 * and never by processing the file a second time. Acceptance is additionally content-idempotent: a row
 * whose private entry this import already recorded is reported as `already-accepted` with the record it
 * became, so even a second acceptance under a fresh identity creates no duplicate contact.
 *
 * Layering: this is the only kind of module that reaches the store, and it reaches it only through the
 * documents the runner hands it inside a transaction — never through `store/repository` directly. It
 * imports the framework-free domain modules (`@/modules/import/*`, `@/modules/time/clock`) and its three
 * sibling contracts (`../authorize`, `../envelope`, `../outcome`, `../operations`). It imports no
 * component, no feature, no application route, no provider package and no filesystem module.
 *
 * Rule 1 obligations this file keeps. Clause 1: contact import only — no historical-gift import, no
 * vendor migration profile, no workbook reader and no scaffolding for a deferred integration. Clause 2:
 * one runner, one ledger, one schema per mutation and one pipeline from `@/modules/import`; no wrapper
 * around the parser and no second decision vocabulary or receipt. Clause 3: an unauthorised reuse is
 * refused rather than merged, a lost acknowledgement returns the same operation's result, a cancellation
 * stops only the rows that were not accepted, accepted stays distinct from delivered and from
 * subscribed, and an undetermined effect stays `unknown` and is recovered by `operationId`.
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
import {
  checkLimits,
  parseCsv,
  IMPORT_MAX_DATA_ROWS,
  type ImportRefusal,
  type ParsedCsvFile,
} from "@/modules/import/parse";
import {
  buildReceipt,
  cancelUnacceptedRows,
  readStoredReceipt,
  type ImportReceipt,
  type ImportRowApplication,
} from "@/modules/import/receipt";
import {
  validateRows,
  type ImportMatchCandidate,
  type ImportMatchReference,
  type ImportValidatedRow,
} from "@/modules/import/validate";
import { now } from "@/modules/time/clock";

import { canEdit, resolveSession, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
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
import {
  LOCAL_STORE_SYSTEM,
  ROOT_FIELD_KEY,
  denied,
  invalid,
  unavailable,
  type DenialReason,
  type FieldMessages,
  type MutationOutcome,
  type MutationResult,
  type PerItemResult,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// The four payloads: one concrete schema per mutation
// ---------------------------------------------------------------------------------------------

/**
 * The transport ceiling for the encoded file, in characters.
 *
 * Base64 turns every three bytes into four characters, and the product's own byte limit is enforced on
 * the decoded bytes where the readable refusal belongs. This ceiling exists only to keep one request
 * finite: it sits a mebibyte of slack above the product limit, so a file just over the limit still
 * reaches `checkLimits()` and is refused there with the limit and the measured byte count named.
 */
const CONTENT_BASE64_MAX_CHARS = Math.ceil(((5 * 1024 * 1024) + (1 << 20)) * (4 / 3));

/** The alphabet base64 uses, with the padding a browser's `btoa` always emits. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** The reasons a file may be left out of a confirmed mapping, as `map.ts` enumerates them. */
const COLUMN_IGNORE_REASONS = [
  "blank-header",
  "unrecognised-header",
  "consent-preserved-as-data",
  "excluded-topic",
  "field-declined",
  "not-chosen",
] as const;

/** The two verdicts a validated row stands in, as `validate.ts` enumerates them. */
const ROW_VERDICTS = ["ready", "needs-correction"] as const;

/** A 1-based position in the file's columns or its nonblank data rows; never a 0-based offset. */
const positionSchema = z.int().positive({
  error: "A row number and a column position are 1-based, so they start at 1.",
});

/**
 * An existing identity named the only way this import names one: the source that issued the reference
 * and the opaque reference itself. Neither member is parsed, compared across systems or used as a join
 * key — two references that look alike are still two identities.
 */
const matchReferenceSchema: z.ZodType<ImportMatchReference> = z.object({
  system: z.string().min(1),
  reference: z.string().min(1),
});

/** One cell a worker rewrote, as `decide.ts` records it: the column, the field it supplied, the text. */
const recordedCorrectionSchema: z.ZodType<ImportRecordedCorrection> = z.object({
  columnNumber: positionSchema,
  fieldId: z.enum(IMPORT_FIELD_IDS),
  value: z.string(),
});

/**
 * One row's decision as recorded: exactly the four kinds `decide.ts` declares, each carrying its own
 * members and no other kind's. The union is annotated with the domain's type, so a kind added,
 * renamed or given another member there stops compiling here instead of failing at the service.
 */
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

/** The content fingerprint a decision set was taken against, checked by `decide.ts` on every use. */
const fileFingerprintSchema: z.ZodType<ImportFileFingerprint> = z.object({
  checksum: z.string().min(1),
  columnCount: z.int().nonnegative(),
  dataRowCount: z.int().nonnegative(),
});

/** The decisions recorded about one file, carried with the fingerprint of the file they answer. */
const decisionSetSchema: z.ZodType<ImportDecisionSet> = z.object({
  fingerprint: fileFingerprintSchema,
  decisions: z.array(recordedDecisionSchema),
});

/** One confirmed pair: this field is supplied by the column at this 1-based position. */
const fieldAssignmentSchema: z.ZodType<ImportFieldAssignment> = z.object({
  fieldId: z.enum(IMPORT_FIELD_IDS),
  columnIndex: positionSchema,
});

/** A column the mapping leaves out, with the factual reason it was left out. */
const ignoredColumnSchema: z.ZodType<ImportIgnoredColumn> = z.object({
  index: positionSchema,
  header: z.string(),
  occurrence: positionSchema,
  reason: z.enum(COLUMN_IGNORE_REASONS),
  message: z.string(),
});

/**
 * The mapping a worker confirmed, in the shape `map.ts` owns. The stored field ids are the domain's own
 * vocabulary rather than header text, so two columns carrying the same header stay two columns.
 */
const confirmedMappingSchema: z.ZodType<ImportConfirmedMapping> = z.object({
  columnCount: z.int().nonnegative(),
  assignments: z.array(fieldAssignmentSchema),
  fields: z.array(z.enum(IMPORT_FIELD_IDS)),
  declined: z.array(z.enum(IMPORT_FIELD_IDS)),
  unmapped: z.array(z.enum(IMPORT_FIELD_IDS)),
  ignored: z.array(ignoredColumnSchema),
});

/**
 * The `proposeImport` payload: the chosen file, and — on the journey's second call — the mapping the
 * worker confirmed.
 *
 * `contentBase64` carries the chosen bytes so the service can decode them, measure them and refuse them
 * itself: a filename and an extension are display metadata and establish no type, and a successful
 * decode here is never a safety qualification. The journey calls this mutation twice — first with the
 * file alone so the limits, the parse and the mapping suggestion run, then again with the confirmed
 * mapping — and confirming a mapping is a new intent, so the second call carries its own
 * `operationId`. A mapping that pairs no field with a column is refused: confirming it would import
 * nothing while reading as a decision.
 */
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

/** One corrected cell as a client sends it: the position and the replacement text, never the field. */
const rowCorrectionInputSchema: z.ZodType<{ columnNumber: number; value: string }> = z.strictObject({
  columnNumber: positionSchema,
  value: z.string(),
});

/**
 * One worker's decision about one imported row: exactly the four kinds `decide.ts` declares, with the
 * members that kind carries. Reuse cannot arrive without its candidate, `skip` carries no correction,
 * and an unknown member is refused rather than dropped, because this union is the domain's own client
 * shape and a renamed member could not be read by `recordDecision()` at all.
 */
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

/**
 * The `setRowDecision` payload: one closed decision about one row, and nothing around it.
 *
 * The payload is the decision itself rather than a wrapper, so the one vocabulary the domain reads is
 * the one a browser sends. The row is named by the 1-based nonblank data-row number `parse.ts`
 * assigned, and by nothing else — not by a header text, not by a cell value — so two rows that look
 * alike stay two rows. Which import the decision belongs to is the caller's current in-flight import in
 * its own scope; the request names no proposal, because a proposal identifier in a payload would be a
 * second way to address a record the scope already decides.
 */
export const setRowDecisionPayloadSchema: z.ZodType<SetRowDecisionPayload> = rowDecisionSchema;

/** The validated `setRowDecision` payload: the domain's own client decision union. */
export type SetRowDecisionPayload = ImportDecisionInput;

/**
 * The `acceptImportRows` payload: the worker's explicit acknowledgement, the fingerprint of the file
 * they reviewed, and the decisions snapshot they reviewed it with.
 *
 * `acknowledged` is the literal `true`, so a defaulted, coerced or absent acknowledgement is refused
 * instead of fabricating consent-to-effect. The snapshot is the intent: posting it under the same
 * `operationId` is one attempt whose stored receipt comes back, and a changed snapshot is different
 * work that carries a new identity. It is bounded by the import module's own row limit rather than by a
 * number written here, so the two cannot drift apart.
 */
export const acceptImportRowsPayloadSchema: z.ZodType<AcceptImportRowsPayload> = z.strictObject({
  acknowledged: z.literal(true, { error: "Confirm the acceptance explicitly." }),
  fileFingerprint: z
    .string()
    .min(1, { error: "fileFingerprint must carry the fingerprint reported for the file you reviewed." }),
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

/**
 * The `cancelImport` payload: nothing beyond the shared envelope.
 *
 * A strict empty object refuses any supplied key rather than ignoring it, because a `reason`, a
 * `rowNumbers` list or a `cancelUnaccepted` flag would read as an instruction the service never
 * receives. What a cancellation means is not asserted in a payload at all: accepted rows stay accepted,
 * rows not yet accepted are stopped, and no record is recalled or deleted.
 */
export const cancelImportPayloadSchema: z.ZodType<CancelImportPayload> = z.strictObject({});

/** The validated `cancelImport` payload: an empty object, so `MutationInput<CancelImportPayload>` types. */
export type CancelImportPayload = Record<string, never>;

// ---------------------------------------------------------------------------------------------
// The working record this file owns, beside the proposal record the reads project
// ---------------------------------------------------------------------------------------------

/**
 * One import as this file keeps it: the admitted text, the confirmed mapping, the recorded decisions
 * and the receipt its acceptance produced.
 *
 * The state document's `importProposals` family is the declared projection `reads/import.ts` parses, and
 * it deliberately holds no cell values: it reports what the worker reviewed and what each row became.
 * The next step needs more than that. Re-validating a corrected row, deciding about a row and applying
 * a row all read the file's own cells, so the admitted text is kept here and run back through the same
 * pipeline the proposal ran through — one implementation of the limits, the parse and the validation,
 * with nothing about a row restated in a stored shape that could drift from it.
 *
 * `scope` is kept because the stored proposal family carries no scope of its own — its owner is read
 * from the operation ledger — and every step after the first has to answer "is this import mine"
 * before it enumerates a single row. `receipt` is the receipt exactly as the ledger stored it, checked
 * through `readStoredReceipt()` on every use: a receipt that cannot be trusted must stop an acceptance
 * before it creates a second contact, never be read as "nothing was applied yet".
 */
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

/** The stored shape of one review, checked before any of it is trusted. */
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

/** The two families of a session's state document this file reads, and the document they sit in. */
interface ImportState {
  /** Every other family of the document, carried through untouched by every write this file makes. */
  readonly document: Record<string, unknown>;
  readonly proposals: readonly ImportProposalRecord[];
  readonly reviews: readonly ImportReviewRecord[];
  readonly partners: readonly PartnerRecord[];
}

/** Either the families this file reads, or the fact that the document cannot be read as this build wrote it. */
type ImportStateRead = { readonly ok: true; readonly state: ImportState } | { readonly ok: false };

/**
 * Reads the families this file works with, refusing rather than repairing.
 *
 * A document this build cannot read is reported as `unavailable` by every mutation that needs it, never
 * as "there is no import in progress": the second would let an acceptance of a file whose review cannot
 * be read proceed as if nothing had ever been applied. The document itself is kept as the record it
 * arrived as, so a write carries every other family — partners, tasks, gifts, content — through
 * unchanged instead of rewriting them from a schema that only knows the import ones.
 */
function readImportState(value: unknown): ImportStateRead {
  if (!isRecord(value)) {
    return { ok: false };
  }
  const proposals = z.array(importProposalRecordSchema).safeParse(value["importProposals"]);
  if (!proposals.success) {
    return { ok: false };
  }
  const storedReviews: unknown = value["importReviews"];
  const reviews =
    storedReviews === undefined ? null : z.array(importReviewRecordSchema).safeParse(storedReviews);
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

/** Whether a stored review's own counts agree with the file it says it holds. */
function reviewIsConsistent(review: ImportReviewRecord): boolean {
  if (review.headers.length !== review.columnCount) {
    return false;
  }
  const decisions = review.decisions;
  return decisions === null || decisions.fingerprint.dataRowCount === review.rowCount;
}

/**
 * The state document after a write, with every family this mutation did not touch exactly as it was.
 *
 * Written as one expression so a mutation cannot replace the document with a narrower shape: the import
 * families are the only ones a write of this file names, and the rest of the record travels with them.
 */
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

/** One stored import: the review this file keeps and the proposal record the reads project. */
interface StoredImport {
  readonly review: ImportReviewRecord;
  readonly proposal: ImportProposalRecord;
}

/**
 * The caller's most recent import in this scope, or null.
 *
 * A review belongs to the scope it was started in, and the most recent one is the import a step acts
 * on: choosing another file supersedes the review it replaces, so at most one import per scope is ever
 * in flight and the newest record is the one the worker is looking at. `inFlightOnly` narrows the same
 * answer to an import that has not finished, which is what a step that changes the review itself
 * requires: a finished import's decisions and cancellation are answered as refusals rather than
 * silently applied to whatever came after it.
 */
function latestImportIn(
  state: ImportState,
  scope: Scope,
  options: { readonly inFlightOnly?: boolean } = {},
): StoredImport | null {
  for (let index = state.reviews.length - 1; index >= 0; index -= 1) {
    const review = state.reviews[index];
    if (review === undefined || !sameScope(review.scope, scope)) {
      continue;
    }
    const proposal = state.proposals.find(
      (candidate) => candidate.importOperationId === review.importOperationId,
    );
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

// ---------------------------------------------------------------------------------------------
// Small shared helpers: revisions, stored results, refusals, identity
// ---------------------------------------------------------------------------------------------

/** The revision a record created by this file starts at, matching the revision the seed writes. */
const FIRST_REVISION = "rev-1";

/** The revision form this file mints: a counter, so any two writes produce two different values. */
const REVISION_PATTERN = /^rev-([0-9]+)$/;

/**
 * The revision a record stands at after one more accepted change.
 *
 * Revisions are opaque strings, and the runner compares them for exact equality, so the only property
 * this needs is that two successive writes never produce the same value. A stored revision this form
 * does not recognise starts the counter again rather than failing: an old record is still writable, and
 * its next revision is still different from the one the caller presented.
 */
function nextRevision(current: string): string {
  const matched = REVISION_PATTERN.exec(current);
  if (matched === null) {
    return FIRST_REVISION;
  }
  const counter = Number(matched[1] ?? "0") + 1;
  return Number.isFinite(counter) && counter > 0 ? `rev-${String(counter)}` : FIRST_REVISION;
}

/**
 * The value the operation ledger stores, as the JSON document it will be read back from.
 *
 * Every result a mutation returns is written to the session's operation ledger and handed back verbatim
 * by a replay, so the honest form of a result is its JSON round trip: what a caller recovers after a
 * lost acknowledgement is exactly what the ledger holds, not a class instance or a value that only
 * survived in memory.
 */
function storedResult(value: unknown): MutationResult {
  return JSON.parse(JSON.stringify(value)) as MutationResult;
}

/**
 * A refusal this file decides on, and the outcome it becomes.
 *
 * It is not one of the runner's eight outcomes because it is raised from inside the transaction: the
 * `apply` callback may only answer "changed" or "nothing to do". A refusal answers "nothing to do" — so
 * the transaction writes nothing — and replaces the runner's `unchanged` once it has returned.
 */
type ImportMutationRefusal =
  | { readonly kind: "invalid"; readonly fields: FieldMessages }
  | { readonly kind: "denied"; readonly reasonCode: DenialReason }
  | { readonly kind: "unavailable"; readonly reference: string; readonly guidance: string };

/** A validation refusal on one field path, which is the path a form anchors its message to. */
function invalidField(field: string, message: string): ImportMutationRefusal {
  return { kind: "invalid", fields: { [field]: [message] } };
}

/** The outcome one refusal answers with. */
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

/**
 * The runner's outcome, with a refusal this file decided on substituted for its `unchanged`.
 *
 * Only an `unchanged` answer is replaced: a replay, a conflict or a denial from the runner's own checks
 * is a complete answer about an attempt that applied nothing, and the refusal recorded beside it would
 * describe a later step that never ran.
 */
function answerFor(
  outcome: MutationOutcome,
  refusal: ImportMutationRefusal | null,
  operationId: string,
): MutationOutcome {
  if (refusal === null || outcome.outcome !== "unchanged") {
    return outcome;
  }
  return refusalOutcome(operationId, refusal);
}

/** The source identity an unreadable import document is reported under. */
const IMPORT_SOURCE_REFERENCE = "contact-import";

/** What a caller is told when this session's import document cannot be read as this build wrote it. */
const STATE_UNAVAILABLE_GUIDANCE =
  "This session's import record cannot be read as this build records it, so nothing was changed. Reload the page; if it stays unreadable, reset the development seed from Settings and start the import again. Nothing that was already accepted is affected.";

/** What a caller is told when a stored file's text can no longer be read as the CSV it was admitted as. */
const TEXT_UNAVAILABLE_GUIDANCE =
  "The file text this import kept can no longer be read as the CSV it was admitted as, so nothing was changed. Start the import again with the same file; contacts an earlier acceptance created stay exactly where they are.";

/** What a caller is told when a stored receipt cannot be trusted, which stops an acceptance. */
const RECEIPT_UNAVAILABLE_GUIDANCE =
  "This import's recorded receipt cannot be read, so an acceptance could not tell which rows it already applied and nothing was changed. Read the operation's result again rather than repeating the import: rows it already accepted are recorded under its operation identity.";

/** The attempt identity a request that states no usable one is answered under. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The operation identity a request carries, read structurally rather than from the declared type.
 *
 * A body arrives from a browser, so the identity is read before the payload is validated: a request
 * that states none is refused as invalid either way, and the refusal still has to carry a field-level
 * answer instead of throwing.
 */
function attemptIdOf(input: unknown): string {
  if (!isRecord(input)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const candidate: unknown = input["operationId"];
  return isNonEmptyString(candidate) ? candidate : UNIDENTIFIED_ATTEMPT;
}

/** The session a mutation acts for, or the refusal that stops it before anything is read. */
type ImportSessionAuthority =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly outcome: MutationOutcome };

/**
 * Resolves the session id the runner's transaction is keyed by, or the answer that stops the request.
 *
 * The runner already resolves the authoritative session for its own authorisation, and it needs this
 * document key to open the transaction at all. A browser's request carries it in the development-session
 * cookie; the explicitly named form is the one path a domain or integration test uses to prove isolation
 * by naming a seeded session, and `authorize.ts` gates it to a development build. A session that cannot
 * be established is a denial with no authority behind it, and no retry can change that.
 */
async function importSessionAuthority(
  source: SessionSource | undefined,
  operationId: string,
): Promise<ImportSessionAuthority> {
  try {
    const resolution = await resolveSession(source);
    return resolution.ok
      ? { ok: true, sessionId: resolution.session.sessionId }
      : { ok: false, outcome: resolution.denial };
  } catch {
    return { ok: false, outcome: denied({ operationId, reasonCode: "session-unavailable" }) };
  }
}

/**
 * This mutation's authority question: may the caller change private preparation in this context?
 *
 * An import creates private preparation entries and nothing else, so the record family whose permission
 * decides it is the private partner record: the caller must be admitted to the scope, and the
 * preparation must be their own. The answer travels in `authorize.ts`'s one refusal shape, so a refusal
 * carries a reason code that names the caller's relationship and nothing it asked about.
 */
function preparationAuthority(session: ResolvedSession, scope: Scope): ScopeDecision {
  const decision = canEdit(session, {
    kind: "partner",
    scope,
    audience: "private",
    authorPrincipalId: session.principalId,
  });
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}

/**
 * The bytes a `contentBase64` value carries, or null when it is not the base64 it claims to be.
 *
 * The round trip is the check: `Buffer.from(value, "base64")` silently ignores a character outside the
 * alphabet, so an input that does not re-encode to itself is not base64 and is refused rather than
 * measured as a smaller file than the worker chose. The decoded bytes are what every limit and the
 * content typing are decided on, so a filename or an extension is never evidence of a type.
 */
function decodeContent(value: string): Uint8Array | null {
  if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? new Uint8Array(decoded) : null;
}

/**
 * The refusals a limit or a parse produced, as the per-field messages an `invalid` outcome carries.
 *
 * Each message is the domain's own, which already names the limit and the value it measured, so this
 * file never rewords a refusal it did not observe. They are keyed on the file's content because that is
 * the field the worker chose; a form anchors every one of them there rather than inventing a key per
 * limit.
 */
function fileRefusalOn(refusals: readonly ImportRefusal[]): ImportMutationRefusal {
  const messages = refusals.map((refusal) => refusal.message);
  return {
    kind: "invalid",
    fields: { contentBase64: messages.length > 0 ? messages : ["This file could not be read as CSV."] },
  };
}

/**
 * Every identity a row could reuse, taken from this session's own partner records.
 *
 * A candidate is named by an opaque, source-qualified reference and is offered with `permitted: true`
 * only because it is reachable in this session and this scope: another principal's records are in
 * another session's documents and are never enumerated here at all, so nothing has to be filtered and
 * nothing about an unreachable record can leak through a suggestion. `visibleValues` states only what
 * this caller may read; a field left out is not compared, and its absence is never read as "the record
 * holds nothing".
 */
function candidatesOf(partners: readonly PartnerRecord[]): readonly ImportMatchCandidate[] {
  return partners.map((partner) => ({
    reference: { system: LOCAL_STORE_SYSTEM, reference: partner.partnerId },
    visibleFields: CANDIDATE_FIELDS,
    visibleValues: visibleValuesOf(partner),
    reuse: { permitted: true },
  }));
}

/**
 * The fields a comparison may look at on an existing record.
 *
 * The list is the whole vocabulary rather than the three fields a suggestion may rest on: a suggestion
 * matches only on a contact method or a source reference — a name is never a signal — but the field-by-
 * field comparison shows every field the mapping supplies beside the value the record already holds, so
 * the difference is visible before anything is accepted.
 */
const CANDIDATE_FIELDS: readonly ImportFieldId[] = [...IMPORT_FIELD_IDS];

/** One partner record's readable values, keyed by the import field each one answers. */
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
    const fieldId: ImportFieldId =
      method.kind === "email" ? "contact-email" : method.kind === "phone" ? "contact-phone" : "contact-postal";
    const existing = values[fieldId];
    if (existing === undefined) {
      values[fieldId] = [method.value];
    } else {
      existing.push(method.value);
    }
  }
  return values;
}


// ---------------------------------------------------------------------------------------------
// The declared projection: the proposal record the import reads parse
// ---------------------------------------------------------------------------------------------

/** Everything the declared proposal record is built from, once a step has decided what it holds. */
interface ProposalProjection {
  readonly importOperationId: string;
  readonly revision: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly columnCount: number;
  readonly mapping: ImportConfirmedMapping | null;
  readonly decisions: ImportDecisionSet | null;
  readonly summary: ImportSummaryRecord;
  readonly results: readonly ImportRowResultRecord[];
  readonly processedAt: string | null;
}

/** The fields whose presence gives a row a name to be created under. */
const NAME_FIELDS: readonly ImportFieldId[] = [
  "display-name",
  "name-given",
  "name-family",
  "name-organization",
];

/**
 * The proposal record, in exactly the shape `reads/import.ts` parses.
 *
 * Every count is derived from the same values the review holds, so the projection and the working record
 * cannot disagree: the row count is the file's nonblank data rows, the decision counts are the recorded
 * set's own kinds, and the per-row results are the receipt's results in file order. The one label this
 * file supplies rather than reads is a blank header's: the stored record requires a non-empty header for
 * every column it states, so a column whose header is blank is labelled by its position instead of being
 * dropped from the mapping the worker reviews.
 */
function proposalRecordOf(projection: ProposalProjection): ImportProposalRecord {
  return {
    importOperationId: projection.importOperationId,
    fileMeta: {
      name: projection.fileName,
      bytes: projection.byteLength,
      rowCount: projection.rowCount,
      columnCount: projection.columnCount,
    },
    mapping: mappingRecordsOf(projection.headers, projection.columnCount, projection.mapping),
    rowDecisions: rowDecisionRecordsOf(projection.decisions),
    summary: projection.summary,
    results: projection.results,
    processedAt: projection.processedAt,
    revision: projection.revision,
  };
}

/**
 * The confirmed mapping as one record per column position, which is what a read projects.
 *
 * Position is the identity here, not the header text: two columns carrying the same header stay two
 * columns at two positions, and a column no field uses is stated with `field: null` rather than
 * disappearing. A column whose header is blank is labelled by its position, because the stored record
 * requires a non-empty header for every column it states and dropping the column would hide it from the
 * worker reviewing the mapping.
 */
function mappingRecordsOf(
  headers: readonly string[],
  columnCount: number,
  mapping: ImportConfirmedMapping | null,
): readonly ImportColumnAssignmentRecord[] {
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

/**
 * The four decision counts as the stored summary states them.
 *
 * `needsReview` is the count of rows that still want attention — a row nobody decided and a row that is
 * decided but blocked — reported beside the four kinds rather than added to them, because a row can be
 * both a new entry and blocked, and one total would hide which is which.
 */
function summaryRecordOf(summary: ImportDecisionSummary | null, rowCount: number): ImportSummaryRecord {
  if (summary === null) {
    return { newEntries: 0, reusedIdentities: 0, skipped: 0, needsReview: rowCount };
  }
  return {
    newEntries: summary.counts.create,
    reusedIdentities: summary.counts.reuse,
    skipped: summary.counts.skip,
    needsReview: summary.counts.unresolved + summary.blockedRowCount,
  };
}

/** One stored decision per row, in the projection's own vocabulary. */
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
  }));
}

/** One decision's kind, in the stored vocabulary. The two vocabularies state the same four kinds. */
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

/** One result per data row, as the projection states it: what became of the row and where it leads. */
function rowResultRecordsOf(receipt: ImportReceipt): readonly ImportRowResultRecord[] {
  return receipt.results.map((result) => ({
    rowNumber: result.rowNumber,
    state: result.state,
    partnerId:
      result.route !== null && result.route.kind === "partner"
        ? result.route.partnerRef.reference
        : null,
    message: result.reason,
  }));
}

/**
 * The mapping a client confirmed, expressed as the decisions `map.ts` itself applies.
 *
 * A payload arrives carrying a whole confirmed mapping, and the honest way to check it is to hand the
 * domain its own input rather than to compare it field by field here: the suggestion is recomputed from
 * the parsed file, these decisions say which column supplies which field, and `confirmMapping()` answers
 * with either the mapping it validated or every reason it cannot stand — a position the file does not
 * have, a column shared by two fields, a column that may never be mapped.
 */
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

/** Whether a confirmed mapping supplies a column that could name the contact it creates. */
function mappingSuppliesName(mapping: ImportConfirmedMapping): boolean {
  return mapping.fields.some((fieldId) => NAME_FIELDS.includes(fieldId));
}

/** Whether two projections state the same column-by-column mapping, so recorded decisions still hold. */
function sameMappingRecords(
  left: readonly ImportColumnAssignmentRecord[],
  right: readonly ImportColumnAssignmentRecord[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((column, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      other.columnIndex === column.columnIndex &&
      other.header === column.header &&
      other.field === column.field
    );
  });
}

/**
 * The decisions the review holds after a mapping is confirmed.
 *
 * Confirming the mapping a worker already confirmed changes nothing, so the decisions recorded against
 * it stand. Confirming a different one invalidates them: a decision was taken about the row as the old
 * mapping read it, and applying it to a differently mapped row would create a contact from cells the
 * worker never reviewed. A changed file reaches this point as a fresh review, so there is nothing to
 * keep in that case at all.
 */
function decisionsFor(
  file: ParsedCsvFile,
  previous: StoredImport | null,
  mappingRecords: readonly ImportColumnAssignmentRecord[],
): ImportDecisionSet {
  if (
    previous !== null &&
    previous.review.decisions !== null &&
    sameMappingRecords(previous.proposal.mapping, mappingRecords)
  ) {
    return previous.review.decisions;
  }
  return createDecisionSet(file);
}


// ---------------------------------------------------------------------------------------------
// The private preparation entry an accepted row becomes
// ---------------------------------------------------------------------------------------------

/** One row's usable values, grouped by the field they supply, with its recorded corrections applied. */
function valuesByField(
  row: ImportValidatedRow,
  decision: RecordedRowDecision | null,
): ReadonlyMap<ImportFieldId, readonly string[]> {
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

/** The first usable value a row supplies for one field, or null. */
function firstValue(
  values: ReadonlyMap<ImportFieldId, readonly string[]>,
  fieldId: ImportFieldId,
): string | null {
  const [first] = values.get(fieldId) ?? [];
  return first === undefined || first.length === 0 ? null : first;
}

/**
 * The name the contact is shown under.
 *
 * A display-name column wins, because that is the label the worker's own file chose; otherwise the given
 * and family name are joined, and an organization name stands alone. Nothing is invented when none of
 * them supplied a value: an empty answer means the row cannot be created, and the mapping step has
 * already refused a mapping that supplies no name column at all.
 */
function displayNameOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): string {
  const displayName = firstValue(values, "display-name");
  if (displayName !== null) {
    return displayName;
  }
  const given = firstValue(values, "name-given");
  const family = firstValue(values, "name-family");
  const composed = [given, family].filter((part): part is string => part !== null).join(" ").trim();
  if (composed.length > 0) {
    return composed;
  }
  return firstValue(values, "name-organization") ?? "";
}

/** The name parts a row supplies, or null when it supplies neither of them. */
function namePartsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): PartnerNameParts | null {
  const given = firstValue(values, "name-given");
  const family = firstValue(values, "name-family");
  if (given === null && family === null) {
    return null;
  }
  return { given, family, additional: [] };
}


/** The contact methods a row supplies, each one permitted and none of them verified. */
function contactMethodsOf(
  values: ReadonlyMap<ImportFieldId, readonly string[]>,
): readonly PartnerContactMethod[] {
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

/** The restrictions a row stated, kept as the file wrote them and interpreted by nobody. */
function restrictionsOf(
  values: ReadonlyMap<ImportFieldId, readonly string[]>,
): readonly PartnerRestriction[] {
  return (values.get("restriction") ?? []).map((detail) => ({
    kind: "imported-restriction",
    detail,
  }));
}

/** The tags a row stated, as the worker's own labels. */
function tagsOf(values: ReadonlyMap<ImportFieldId, readonly string[]>): readonly string[] {
  return [...(values.get("tag") ?? [])];
}

/**
 * The source reference an accepted row's private entry carries.
 *
 * A reuse entry points at the identity the row reuses: the opaque, source-qualified reference is the
 * link, and nothing on the existing record is read from the row or written by it. A created entry has no
 * identity to point at, so it carries the source reference the file itself stated, labelled with the
 * import as the route it arrived by — never a system name invented for a file that does not state one —
 * and carries none at all when the file stated none.
 */
function sourceForRow(
  decision: RecordedRowDecision,
  values: ReadonlyMap<ImportFieldId, readonly string[]>,
): SourceReference | null {
  if (decision.kind === "reuse") {
    return { system: LOCAL_STORE_SYSTEM, reference: decision.candidate.reference };
  }
  const imported = firstValue(values, "source-reference");
  return imported === null ? null : { system: IMPORT_SOURCE_REFERENCE, reference: imported };
}

/**
 * The private preparation entry one accepted row becomes.
 *
 * It is a private record and nothing else: no membership, no consent, no audience entry, no gift and no
 * task. Its identifier is derived from the import's own operation identity and the row's number, so the
 * same row of the same import can never produce two records even if an acknowledgement is lost and the
 * work is replayed under a fresh attempt identity.
 */
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

/** The identifier one row's private preparation entry is created under, derived so it can never repeat. */
function partnerIdFor(importOperationId: string, rowNumber: number): string {
  return `partner-import-${importOperationId}-${String(rowNumber)}`;
}


/**
 * The receipt this import already recorded, or the fact that it recorded none or that the one it holds
 * cannot be trusted.
 *
 * The distinction is what keeps an acceptance from creating a second contact: a receipt that cannot be
 * read is not evidence that nothing was applied, so it stops the acceptance instead of being read as an
 * empty one.
 */
type StoredReceiptRead =
  | { readonly kind: "none" }
  | { readonly kind: "receipt"; readonly receipt: ImportReceipt }
  | { readonly kind: "unreadable" };

/** Reads the receipt this import recorded, through the domain's own stored-shape check. */
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

/** The references one recorded receipt already points at, keyed by the row each one came from. */
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

/**
 * One decision refusal, as the outcome it becomes.
 *
 * A reuse of an identity this caller was never offered is answered as a denial: the decision named a
 * record this import does not hold, and a reason code that describes the caller's relationship reveals
 * nothing about whether such a record exists anywhere. Every other refusal is a fact about the row the
 * worker can act on, so it travels as an `invalid` message on the field path the review step anchors it
 * to.
 */
function decisionRefusal(refusal: ImportDecisionRefusal): ImportMutationRefusal {
  if (refusal.code === "no-reusable-candidate" || refusal.code === "candidate-not-suggested") {
    return { kind: "denied", reasonCode: "no-permission" };
  }
  const field = refusal.rowNumber === null ? ROOT_FIELD_KEY : "rowNumber";
  return invalidField(field, refusal.message);
}

/**
 * What a carried file fingerprint proves, and what it cannot.
 *
 * The file an acceptance applies is the file this import stored and validated — it is never uploaded
 * again — so a changed file cannot reach this step at all. The carried value is therefore used for the
 * one thing it can establish: a caller that reviewed a different version of the file carries a
 * fingerprint framed like the ones this build mints, and one this import does not hold is refused. A
 * value framed some other way is an opaque token this import has nothing to compare against, and it is
 * never treated as evidence of a file this import did not read.
 */
function carriedFingerprintRefusal(
  carried: string,
  current: ImportFileFingerprint,
  recorded: ImportFileFingerprint | null,
): ImportMutationRefusal | null {
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

/** The refusal every step answers with when this session's import document cannot be read. */
function stateUnavailable(): ImportMutationRefusal {
  return {
    kind: "unavailable",
    reference: IMPORT_SOURCE_REFERENCE,
    guidance: STATE_UNAVAILABLE_GUIDANCE,
  };
}

/** The answer a step gives when its `apply` decided on a refusal instead of a change. */
const NOT_CHANGED: { readonly changed: false } = { changed: false };

/** The target of a change that creates an import rather than replacing one. */
const NO_TARGET: CurrentTarget = { kind: "absent" };


// ---------------------------------------------------------------------------------------------
// proposeImport
// ---------------------------------------------------------------------------------------------

/**
 * Proposes an import from a chosen file: the limits enforced before anything is processed, the file
 * typed by its content, the mapping suggested column by column, and — on the journey's second call —
 * the mapping the worker confirmed with the rows validated against it.
 *
 * Job: turn a chosen file into the proposal a worker reviews, or refuse it with the limit and the value
 * it measured. Outcomes: `accepted` (a proposal was recorded, with the record it stored), `invalid`
 * (limits, content, base64 or a confirmed mapping that cannot stand — nothing was processed),
 * `denied`, `conflict`, `unchanged`, `alreadyAccepted`, `unavailable`, `unknown`.
 *
 * It creates no contact, no membership and no consent record: a column that looks like a subscription
 * statement is preserved as data in the review and is read as nothing.
 */
export async function proposeImport(
  input: MutationInput<ProposeImportPayload>,
  session?: SessionSource,
): Promise<MutationOutcome> {
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
        refusal = invalidField(
          "contentBase64",
          "This file's content is not valid base64, so it could not be read as the file that was chosen. Choose the file again.",
        );
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
        const confirmed = confirmMapping(
          suggestMapping(file),
          mappingDecisionsOf(payload.confirmedMapping),
        );
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
      const importOperationId =
        previous === null ? operationId : previous.review.importOperationId;
      const revision = previous === null ? FIRST_REVISION : nextRevision(previous.proposal.revision);

      let decisions: ImportDecisionSet | null = null;
      let summary: ImportDecisionSummary | null = null;
      if (mapping !== null) {
        const confirmedMapping = mapping;
        const recorded = decisionsFor(
          file,
          previous,
          mappingRecordsOf(file.headers, file.columnCount, confirmedMapping),
        );
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
      const dropped = (candidate: { readonly importOperationId: string }): boolean =>
        candidate.importOperationId === importOperationId || candidate.importOperationId === supersededId;
      context.docs.state = stateAfter(state, {
        proposals: [...state.proposals.filter((entry) => !dropped(entry)), proposal],
        reviews: [...state.reviews.filter((entry) => !dropped(entry)), review],
      });

      return { changed: true, revision, result: storedResult(proposal), created: [importOperationId] };
    },
  });

  return answerFor(outcome, refusal, operationId);
}


// ---------------------------------------------------------------------------------------------
// setRowDecision
// ---------------------------------------------------------------------------------------------

/**
 * Records one worker's decision about one row of the import in progress.
 *
 * Job: take the four-decision vocabulary — a new private entry, a reuse of an authorized identity, a
 * skip, or nothing yet — and hold the row to it, with the row's own validation re-checked first.
 * Outcomes: `accepted` (the decision now stands, with the proposal at its new revision), `unchanged`
 * (the same decision again: nothing was written), `invalid` (no import in flight, an import already
 * accepted, a row the file does not have, or a row that still needs a correction), `denied` (a reuse of
 * an identity this caller was not offered, which reveals nothing about it), `conflict`, `denied`,
 * `alreadyAccepted`, `unavailable`, `unknown`.
 *
 * A recorded decision is not consent: `skip` deletes nothing, `reuse` attaches a private entry to an
 * identity instead of merging with it, and no decision subscribes anyone or sends anything.
 */
export async function setRowDecision(
  input: MutationInput<SetRowDecisionPayload>,
  session?: SessionSource,
): Promise<MutationOutcome> {
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
      return stored === null
        ? NO_TARGET
        : { kind: "record", revision: stored.proposal.revision, value: stored.proposal };
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
        refusal = invalidField(
          ROOT_FIELD_KEY,
          "No import is in progress in this context, so there is no row to decide about. Choose a file and map its columns first.",
        );
        return NOT_CHANGED;
      }
      if (stored.proposal.processedAt !== null) {
        refusal = invalidField(
          ROOT_FIELD_KEY,
          "This import has already been accepted or cancelled, so its row decisions can no longer change. Start a new import to decide about these rows again.",
        );
        return NOT_CHANGED;
      }
      const confirmedMapping = stored.review.mapping;
      if (confirmedMapping === null) {
        refusal = invalidField(
          ROOT_FIELD_KEY,
          "No column mapping is confirmed for this import yet, so no row can be decided about. Confirm the mapping first.",
        );
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
      const recorded = recordDecision(
        stored.review.decisions ?? createDecisionSet(file),
        input.payload,
        { file, mapping: confirmedMapping, validation, candidates },
      );
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
        proposals: state.proposals.map((entry) =>
          entry.importOperationId === proposal.importOperationId ? proposal : entry,
        ),
        reviews: state.reviews.map((entry) =>
          entry.importOperationId === review.importOperationId ? review : entry,
        ),
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


// ---------------------------------------------------------------------------------------------
// acceptImportRows
// ---------------------------------------------------------------------------------------------

/**
 * Accepts the reviewed rows of the import in progress: the recorded snapshot is re-checked row by row
 * at execute time, only the eligible ones are applied, and the receipt of what happened is recorded
 * under this attempt's own operation identity.
 *
 * Job: create the accepted private preparation entries and return the recoverable receipt. Outcomes:
 * `accepted` (rows applied, receipt stored), `alreadyAccepted` (the same `operationId` replayed: the
 * stored receipt comes back and nothing is applied twice), `unchanged`, `conflict` (a stale revision or
 * a reused identity carrying different work), `invalid` (no import in progress, no mapping, a decision
 * that cannot stand, or a fingerprint from another version of the file), `denied` (a reuse of an
 * identity this caller was not offered), `unavailable` (a stored document that cannot be read),
 * `unknown` (the acknowledgement was lost — recover it by this `operationId`).
 *
 * Nothing here subscribes anyone: no membership, no consent record, no audience member, no message, and
 * the receipt states those zeros as literal types. `accepted` is not `delivered`.
 */
export async function acceptImportRows(
  input: MutationInput<AcceptImportRowsPayload>,
  session?: SessionSource,
): Promise<MutationOutcome> {
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
      return stored === null
        ? NO_TARGET
        : { kind: "record", revision: stored.proposal.revision, value: stored.proposal };
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
        refusal = invalidField(
          ROOT_FIELD_KEY,
          "No import is in progress in this context, so there is nothing to accept. Choose a file, map its columns and decide about its rows first.",
        );
        return NOT_CHANGED;
      }
      const review = stored.review;
      const confirmedMapping = review.mapping;
      if (confirmedMapping === null) {
        refusal = invalidField(
          "confirmedMapping",
          "No column mapping is confirmed for this import, so no row could be applied. Map the columns and review the rows before accepting.",
        );
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

      const carried = carriedFingerprintRefusal(
        input.payload.fileFingerprint,
        fingerprint,
        review.decisions?.fingerprint ?? null,
      );
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
      const alreadyApplied =
        prior.kind === "receipt" ? appliedRowsOf(prior.receipt) : new Map<number, ImportMatchReference>();
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
        const reference: ImportMatchReference = { system: LOCAL_STORE_SYSTEM, reference: partnerId };
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
        proposals: state.proposals.map((entry) =>
          entry.importOperationId === proposal.importOperationId ? proposal : entry,
        ),
        reviews: state.reviews.map((entry) =>
          entry.importOperationId === nextReview.importOperationId ? nextReview : entry,
        ),
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


// ---------------------------------------------------------------------------------------------
// cancelImport
// ---------------------------------------------------------------------------------------------

/**
 * Cancels the import in progress: every row that was not accepted is stopped, every row that was
 * accepted keeps the record it became, and the state the cancellation produced is recorded under this
 * attempt's own operation identity.
 *
 * Job: stop the work that remains without recalling anything. Outcomes: `accepted` (the cancellation is
 * recorded and its receipt — or, for an import that never reached acceptance, its summary — is
 * stored), `unchanged` (nothing to cancel, or the import was already cancelled: the instant the first
 * one stopped the work is preserved), `conflict`, `denied`, `invalid`, `alreadyAccepted`, `unavailable`,
 * `unknown`.
 *
 * A cancellation never deletes an accepted contact, never reverses one, and never claims to have
 * recalled anything: it stops what had not been applied, and the receipt states that it recalls
 * nothing.
 */
export async function cancelImport(
  input: MutationInput<CancelImportPayload>,
  session?: SessionSource,
): Promise<MutationOutcome> {
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
      return stored === null
        ? NO_TARGET
        : { kind: "record", revision: stored.proposal.revision, value: stored.proposal };
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
        receipt = { ...cancelUnacceptedRows(prior.receipt, cancelledAt), importOperationId: operationId };
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
        proposals: state.proposals.map((entry) =>
          entry.importOperationId === proposal.importOperationId ? proposal : entry,
        ),
        reviews: state.reviews.map((entry) =>
          entry.importOperationId === nextReview.importOperationId ? nextReview : entry,
        ),
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

