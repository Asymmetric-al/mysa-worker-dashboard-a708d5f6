/**
 * Contact import, step four: record the worker's decision about one row at a time, and produce the
 * summary the shared review step renders before anything is accepted.
 *
 * Scope: AAP 0.6.1 import-module row (`src/modules/import/*` exists for "Import parsing and
 * decisions", 0.3.4); 0.10.1 contact import ("per-row decisions (new private entry, reuse authorized
 * identity, skip, unresolved) …, a summary before acceptance, per-row results with routes to the
 * contact or a correction"); 0.6.2 import proposal and receipt (`rowDecisions`, `summary`, and "a
 * changed file requires fresh review; cancellation after acceptance stops only unaccepted rows");
 * 0.8.5 ("importing or editing a contact never subscribes anyone"; "a `subscribed` flag is not
 * consent"); 0.7.1 with the owned action-review pattern (a consequential action passes through one
 * shared review step, and "each requires review"). The four service mutations that call this module —
 * `proposeImport`, `setRowDecision`, `acceptImportRows`, `cancelImport` — belong to the data service,
 * and cancellation semantics belong to `receipt.ts`.
 *
 * Three rules shape the file. A row has exactly four possible decisions and no fifth — a new private
 * entry, reuse of an authorized identity, a skip, or nothing yet — and a row nobody has decided is
 * unresolved rather than quietly accepted, so no effect exists that the worker did not choose. A
 * row's blocking problem outranks the decision taken about it, so a decision that cannot be carried
 * out is refused with a readable reason instead of being recorded and dropped later at acceptance.
 * And reuse is a link, never a merge: it attaches a new private preparation entry to an existing
 * identity by that identity's opaque, source-qualified reference, so no field, contact method, tag,
 * favourite or audience membership of the candidate is read, rewritten or joined.
 *
 * The module is pure and deterministic. It holds no session, scope or permission, reads no clock, no
 * filesystem, no random source and no network, and it writes nothing: it returns a decision set and a
 * summary for the service to persist. The same set, decision and context always produce the same
 * result, and re-recording a decision that already stands returns the set unchanged — the value the
 * service reports as `unchanged`.
 */

import { z } from "zod";

import type { ImportConfirmedMapping, ImportFieldId } from "./map";
import { IMPORT_FIELD_IDS, IMPORT_FIELD_VOCABULARY } from "./map";
import type { ImportRowFaultKind, ParsedCsvFile, ParsedCsvRow } from "./parse";
import { IMPORT_MAX_CELL_CODE_POINTS } from "./parse";
import type {
  ImportIssueCode,
  ImportMatchCandidate,
  ImportMatchReference,
  ImportPreservedReason,
  ImportRowVerdict,
  ImportValidatedRow,
  ImportValidation,
} from "./validate";
import { suggestMatches, validateRows } from "./validate";

// ---------------------------------------------------------------------------------------------
// Phase A: exactly four decisions
// ---------------------------------------------------------------------------------------------

/**
 * The four decisions a worker can take about one row, and the whole vocabulary of the step: a new
 * private entry, reuse of an authorized identity, a skip, or nothing yet. There is deliberately no
 * fifth kind — no merge, no "update the existing contact", no bulk accept — because this import
 * either adds a private preparation entry of its own or attaches one to an identity the worker
 * already holds, and it never rewrites a record nobody asked it to touch.
 */
export type ImportDecisionKind = "create" | "reuse" | "skip" | "unresolved";

/** The four kinds in the order the review step offers them. There is no fifth. */
export const IMPORT_DECISION_KINDS: readonly ImportDecisionKind[] = [
  "create",
  "reuse",
  "skip",
  "unresolved",
];

/**
 * A cell the worker rewrote before deciding, as a client sends it: a 1-based column position and the
 * text that replaces the cell. The client never names the field, because which field a column
 * supplies is the confirmed mapping's answer, not the browser's.
 */
export interface ImportCellCorrectionInput {
  readonly columnNumber: number;
  readonly value: string;
}

/**
 * A cell the worker rewrote, as recorded: the field the column supplied at that moment, so the
 * summary counts corrections per field without re-reading a mapping that may since have changed.
 */
export interface ImportRecordedCorrection {
  readonly columnNumber: number;
  readonly fieldId: ImportFieldId;
  /** The replacement text exactly as the worker supplied it. */
  readonly value: string;
}

/**
 * A new private preparation entry, built only from this row's mapped cells. No other record is
 * touched, and nothing outside the row's own cells supplies a value.
 */
export interface ImportCreateDecision {
  readonly kind: "create";
  readonly rowNumber: number;
  /** The verdict this decision was taken against: the row's own, or the corrected row's. */
  readonly verdict: ImportRowVerdict;
  readonly corrections: readonly ImportRecordedCorrection[];
}

/**
 * A private preparation entry of its own, attached to an existing identity by that identity's opaque,
 * source-qualified reference. The candidate is not merged with, overwritten, extended or notified:
 * nothing on it is read from this row and nothing on it is written.
 */
export interface ImportReuseDecision {
  readonly kind: "reuse";
  readonly rowNumber: number;
  readonly verdict: ImportRowVerdict;
  readonly candidate: ImportMatchReference;
  readonly corrections: readonly ImportRecordedCorrection[];
}

/** The row is left out, carrying the worker's reason and the row's own problem beside it. */
export interface ImportSkipDecision {
  readonly kind: "skip";
  readonly rowNumber: number;
  readonly verdict: ImportRowVerdict;
  /** What the worker typed, trimmed; empty when they gave no reason. */
  readonly workerReason: string;
  /** The row's first blocking problem at the time, so a skip records what it left behind. */
  readonly rowProblem: string | null;
}

/**
 * Nothing decided yet: neither accepted nor skipped, and it blocks no other row. A row the worker has
 * never touched is in this state too, because absent from the set means the same thing.
 */
export interface ImportUnresolvedDecision {
  readonly kind: "unresolved";
  readonly rowNumber: number;
  readonly verdict: ImportRowVerdict;
}

/** One row's decision: exactly one of the four kinds above. */
export type ImportRowDecision =
  | ImportCreateDecision
  | ImportReuseDecision
  | ImportSkipDecision
  | ImportUnresolvedDecision;

/** What a client asks for when it means to create a new private entry for one row. */
export interface ImportCreateDecisionInput {
  readonly kind: "create";
  readonly rowNumber: number;
  readonly corrections?: readonly ImportCellCorrectionInput[];
}

/** What a client asks for when it means to reuse one of the contacts proposed for the row. */
export interface ImportReuseDecisionInput {
  readonly kind: "reuse";
  readonly rowNumber: number;
  readonly candidate: ImportMatchReference;
  readonly corrections?: readonly ImportCellCorrectionInput[];
}

/** What a client asks for when it means to leave a row out. */
export interface ImportSkipDecisionInput {
  readonly kind: "skip";
  readonly rowNumber: number;
  /** The worker's own words, optional: a row the file could not use explains itself. */
  readonly reason?: string;
}

/** What a client asks for when it means to clear a decision and leave the row undecided. */
export interface ImportUnresolvedDecisionInput {
  readonly kind: "unresolved";
  readonly rowNumber: number;
}

/**
 * Everything a client may ask for, in one closed union. It is validated with Zod before it is read,
 * so a malformed decision from a browser cannot reach the set — and, like the recorded union, it has
 * exactly four kinds.
 */
export type ImportDecisionInput =
  | ImportCreateDecisionInput
  | ImportReuseDecisionInput
  | ImportSkipDecisionInput
  | ImportUnresolvedDecisionInput;

/**
 * What a decision set was taken against. The checksum is a change detector over the parsed headers
 * and cells — not a security digest, and not evidence about the file's bytes — so decisions made
 * about one version of a file can never be applied to another version the worker never saw.
 */
export interface ImportFileFingerprint {
  readonly checksum: string;
  readonly columnCount: number;
  readonly dataRowCount: number;
}

/**
 * The decisions about one file, carried with the fingerprint of the file they were taken against. The
 * set is a value: the service persists it, replaces it and hands it back, and nothing in this module
 * keeps a copy of it or accumulates a history of superseded decisions.
 */
export interface ImportDecisionSet {
  readonly fingerprint: ImportFileFingerprint;
  /** In row order, at most one entry per row number. */
  readonly decisions: readonly ImportRowDecision[];
}

// ---------------------------------------------------------------------------------------------
// Phase B: refusals, and what a decision is checked against
// ---------------------------------------------------------------------------------------------

/** Why a decision could not be recorded. Each code states one fact, so the review step can act. */
export type ImportDecisionRefusalCode =
  /** The payload is not the shape of any of the four decisions. */
  | "decision-invalid"
  /** The set was recorded against another version of this file, which needs a fresh review. */
  | "file-changed"
  /** The validation does not describe this file, so nothing can honestly be checked against it. */
  | "context-mismatch"
  /** The row number is not one of this file's data rows. */
  | "row-not-found"
  /** The row cannot be accepted as it stands, and no correction was supplied for it. */
  | "row-needs-correction"
  /** One column was corrected twice in the same decision. */
  | "correction-duplicated"
  /** The corrected position is not a cell of this row. */
  | "correction-target-unknown"
  /** The corrected column supplies no contact field, so correcting it changes nothing. */
  | "correction-target-unmapped"
  /** The corrected cell has no problem, so there is nothing there to correct. */
  | "correction-not-needed"
  /** Corrections were supplied and the corrected row is still not clear. */
  | "correction-not-clearing"
  /** The row shares no usable value with any identity this caller may reuse. */
  | "no-reusable-candidate"
  /** The named reference is not one of the contacts proposed for this row. */
  | "candidate-not-suggested";

/**
 * A refusal in the words the review step shows. `rowNumber` is null when the refusal is about the
 * file or the set rather than a row, and `columnNumbers` is empty whenever no cell is at fault.
 */
export interface ImportDecisionRefusal {
  readonly code: ImportDecisionRefusalCode;
  readonly rowNumber: number | null;
  readonly columnNumbers: readonly number[];
  readonly message: string;
}

/**
 * What a decision and a summary are checked against: the file as parsed, the mapping the worker
 * confirmed, the validation of that file, and the existing contacts the service resolved in the
 * caller's scope. Candidates rather than prepared proposals are handed in so the reuse check is
 * always current — this module asks `suggestMatches` about the row in front of it, and a proposal
 * list can therefore never go stale between two screens. The mapping is here because re-checking a
 * corrected cell is a validation pass, and a correction's field comes from the mapping.
 */
export interface ImportDecisionContext {
  readonly file: ParsedCsvFile;
  readonly mapping: ImportConfirmedMapping;
  readonly validation: ImportValidation;
  readonly candidates: readonly ImportMatchCandidate[];
}

/**
 * The decision that now stands, and whether recording it changed anything. `changed: false` is the
 * idempotent replay the service reports as `unchanged`: recording the same decision twice leaves the
 * set exactly as it was.
 */
export type ImportRecordDecisionResult =
  | {
      readonly ok: true;
      readonly set: ImportDecisionSet;
      readonly decision: ImportRowDecision;
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly refusal: ImportDecisionRefusal };

// ---------------------------------------------------------------------------------------------
// Phase C: one fingerprint of the file, computed in one place
// ---------------------------------------------------------------------------------------------

/**
 * The fingerprint's format tag. Bumping it invalidates every checksum taken before the change, which
 * is what any change of hashed content or framing requires: an old checksum must never compare equal
 * to a new one for a file the worker has not seen.
 */
const FINGERPRINT_TAG = "csv-1";

/**
 * Separates the framed parts. Unit separator rather than a printable character, so a cell's own text
 * cannot forge a boundary no matter what the file holds.
 */
const PART_SEPARATOR = "\u001f";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECOND_SEED = 0x9747b28c;
const SECOND_PRIME = 0x85ebca6b;

/**
 * One 32-bit round over the text. `Math.imul` keeps the multiply in 32-bit integer arithmetic on
 * every engine, so the value never depends on the platform, the locale or the process — two machines
 * hash the same file to the same checksum.
 */
function hashRound(text: string, seed: number, prime: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = hash ^ text.charCodeAt(index);
    hash = Math.imul(hash, prime) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/** Two independent rounds make the 16-hex-digit checksum, which is ample for detecting a changed file. */
function checksumOf(text: string): string {
  const high = hashRound(text, SECOND_SEED, SECOND_PRIME);
  const low = hashRound(text, FNV_OFFSET, FNV_PRIME);
  return `${FINGERPRINT_TAG}-${hex8(high)}${hex8(low)}`;
}

/** One part, framed by its length so a cell can never shift the boundary of the part beside it. */
function framedPart(part: string): string {
  return `${part.length}:${part}`;
}

/**
 * The content fingerprint of a parsed file: its headers and every cell in row order, each length
 * framed, hashed once here. Row faults, blank counts and the display name are left out because they
 * are derived from these cells or are metadata about the file rather than the file's content.
 */
export function fingerprintOf(file: ParsedCsvFile): ImportFileFingerprint {
  const parts: string[] = [
    framedPart(String(file.headers.length)),
    ...file.headers.map((header) => framedPart(header)),
    framedPart(String(file.rows.length)),
  ];

  for (const row of file.rows) {
    parts.push(framedPart(String(row.rowNumber)));
    parts.push(framedPart(String(row.cells.length)));
    for (const cell of row.cells) parts.push(framedPart(cell));
  }

  return {
    checksum: checksumOf(parts.join(PART_SEPARATOR)),
    columnCount: file.headers.length,
    dataRowCount: file.rows.length,
  };
}

/** The empty decision set for a file: no row decided, and every row therefore unresolved. */
export function createDecisionSet(file: ParsedCsvFile): ImportDecisionSet {
  return { fingerprint: fingerprintOf(file), decisions: [] };
}

function sameFingerprint(left: ImportFileFingerprint, right: ImportFileFingerprint): boolean {
  return (
    left.checksum === right.checksum &&
    left.columnCount === right.columnCount &&
    left.dataRowCount === right.dataRowCount
  );
}

/**
 * Null when the set describes this exact file, and the `file-changed` refusal when it does not. The
 * service runs this before applying a set, so no decision is ever carried onto a file the worker has
 * not reviewed.
 */
export function staleFileRefusal(
  set: ImportDecisionSet,
  file: ParsedCsvFile,
): ImportDecisionRefusal | null {
  const current = fingerprintOf(file);
  if (sameFingerprint(set.fingerprint, current)) return null;

  const recorded = set.fingerprint;
  return {
    code: "file-changed",
    rowNumber: null,
    columnNumbers: [],
    message: `These decisions were recorded against a different version of this file: it held ${recorded.dataRowCount} data row(s) in ${recorded.columnCount} column(s) then, and holds ${current.dataRowCount} in ${current.columnCount} now. A changed file needs a fresh review, so choose the file again and decide about its rows.`,
  };
}

/**
 * Why the validation offered alongside a file is not that file's validation, or null when it is. This
 * is a cheap consistency guard, not a second validation: without it a decision could be checked
 * against the verdicts of rows from another file and recorded against the wrong row's problem.
 */
function contextMismatchRefusal(context: ImportDecisionContext): ImportDecisionRefusal | null {
  const { file, validation } = context;
  const aligned =
    validation.rows.length === file.rows.length &&
    validation.rows.every((row, index) => file.rows[index]?.rowNumber === row.rowNumber);
  if (aligned) return null;

  return {
    code: "context-mismatch",
    rowNumber: null,
    columnNumbers: [],
    message: `The validation offered for this file describes ${validation.rows.length} row(s) and the file holds ${file.rows.length}. Validate this file again, then decide about its rows.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Phase B: the payload, checked before any of it is read
// ---------------------------------------------------------------------------------------------

const CORRECTION_SCHEMA = z.object({
  columnNumber: z.number().int().min(1),
  value: z.string(),
});

const REFERENCE_SCHEMA = z.object({
  system: z.string().min(1),
  reference: z.string().min(1),
});

/**
 * The four decision payloads a client may send. A fifth kind, a missing row number, a fractional
 * position, a reference with an empty part or a correction without a value fails here, so nothing
 * unreadable reaches the set. The schema and `ImportDecisionInput` are kept in step by hand: the
 * declarations state the shape a reader should expect, and this guards the shape a browser sent.
 */
const DECISION_INPUT_SCHEMA = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    rowNumber: z.number().int().min(1),
    corrections: z.array(CORRECTION_SCHEMA).optional(),
  }),
  z.object({
    kind: z.literal("reuse"),
    rowNumber: z.number().int().min(1),
    candidate: REFERENCE_SCHEMA,
    corrections: z.array(CORRECTION_SCHEMA).optional(),
  }),
  z.object({
    kind: z.literal("skip"),
    rowNumber: z.number().int().min(1),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("unresolved"),
    rowNumber: z.number().int().min(1),
  }),
]);

/** The two facts a failed parse yields that a readable refusal needs, without naming zod's types. */
interface ParseFailure {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}

// ---------------------------------------------------------------------------------------------
// Phase B: recording one decision
// ---------------------------------------------------------------------------------------------

/**
 * Records one row's decision, or refuses it with the reason it cannot stand, and returns the set the
 * service persists. The checks run in a fixed order so the same request always yields the same
 * answer: the payload's shape, then the file the set belongs to, then the validation beside it, then
 * the row, then the corrections, and — for reuse — the identity proposed for that row.
 *
 * Reuse eligibility is judged on the corrected row, because the correction is part of the decision:
 * an email the worker repaired may be the value that connects the row to a contact they already hold.
 */
export function recordDecision(
  set: ImportDecisionSet,
  input: ImportDecisionInput,
  context: ImportDecisionContext,
): ImportRecordDecisionResult {
  const parsed = DECISION_INPUT_SCHEMA.safeParse(input);
  if (!parsed.success) return { ok: false, refusal: unreadableDecisionRefusal(parsed.error) };

  const stale = staleFileRefusal(set, context.file);
  if (stale !== null) return { ok: false, refusal: stale };

  const mismatch = contextMismatchRefusal(context);
  if (mismatch !== null) return { ok: false, refusal: mismatch };

  const data = parsed.data;
  const rowNumber = data.rowNumber;
  const row = context.file.rows.find((candidate) => candidate.rowNumber === rowNumber);
  const validated = context.validation.rows.find((candidate) => candidate.rowNumber === rowNumber);
  if (row === undefined || validated === undefined) {
    return { ok: false, refusal: rowNotFoundRefusal(rowNumber, context.file.rows.length) };
  }

  if (data.kind === "unresolved") {
    return withDecision(set, { kind: "unresolved", rowNumber, verdict: validated.verdict });
  }

  // A skip needs no correction and no candidate: it is always permitted, and it records the row's own
  // problem beside the worker's reason so a skipped row still says what it left behind.
  if (data.kind === "skip") {
    return withDecision(set, {
      kind: "skip",
      rowNumber,
      verdict: validated.verdict,
      workerReason: (data.reason ?? "").trim(),
      rowProblem: rowProblemOf(validated),
    });
  }

  const corrections = data.corrections ?? [];
  const checked = checkCorrections(corrections, row, validated, context);
  if (!checked.ok) return { ok: false, refusal: checked.refusal };

  const revalidated = revalidateRow(row, corrections, validated, context);
  if (revalidated === null) {
    return { ok: false, refusal: correctionNotCheckedRefusal(rowNumber) };
  }

  // The blocking problem outranks the intent. A row that is still unclear after its corrections can
  // only be skipped or left unresolved; recording it as accepted would drop it later, silently.
  if (revalidated.verdict === "needs-correction") {
    return {
      ok: false,
      refusal:
        corrections.length === 0
          ? rowNeedsCorrectionRefusal(rowNumber, revalidated)
          : correctionNotClearingRefusal(rowNumber, revalidated),
    };
  }

  if (data.kind === "reuse") {
    const suggestions = suggestMatches(revalidated, context.candidates).suggestions;
    if (suggestions.length === 0) {
      return { ok: false, refusal: noReusableCandidateRefusal(rowNumber) };
    }
    const offered = suggestions.some((candidate) =>
      sameReference(candidate.reference, data.candidate),
    );
    if (!offered) {
      return { ok: false, refusal: candidateNotSuggestedRefusal(rowNumber, suggestions.length) };
    }
    return withDecision(set, {
      kind: "reuse",
      rowNumber,
      verdict: revalidated.verdict,
      candidate: { system: data.candidate.system, reference: data.candidate.reference },
      corrections: checked.corrections,
    });
  }

  return withDecision(set, {
    kind: "create",
    rowNumber,
    verdict: revalidated.verdict,
    corrections: checked.corrections,
  });
}

/**
 * The set with this decision standing in place of whatever stood for the row before. A decision that
 * already stands is returned as the same set and is not written twice, which is the `unchanged`
 * outcome; a different decision replaces the previous one, and no superseded decision is kept here.
 */
function withDecision(
  set: ImportDecisionSet,
  decision: ImportRowDecision,
): ImportRecordDecisionResult {
  const standing = set.decisions.find((candidate) => candidate.rowNumber === decision.rowNumber);
  // Both objects are built here key by key, so serialising them compares the same fields in the same
  // order: identical decisions compare equal, and a changed one cannot.
  if (standing !== undefined && JSON.stringify(standing) === JSON.stringify(decision)) {
    return { ok: true, set, decision: standing, changed: false };
  }

  const decisions = set.decisions
    .filter((candidate) => candidate.rowNumber !== decision.rowNumber)
    .concat(decision)
    .sort((left, right) => left.rowNumber - right.rowNumber);

  return { ok: true, set: { fingerprint: set.fingerprint, decisions }, decision, changed: true };
}

/** Reference equality on both parts: a system and a reference identify one record only together. */
function sameReference(left: ImportMatchReference, right: ImportMatchReference): boolean {
  return left.system === right.system && left.reference === right.reference;
}

/** The row's first blocking problem in the words the validation already wrote, or null. */
function rowProblemOf(validated: ImportValidatedRow): string | null {
  const issue = validated.issues[0];
  if (issue !== undefined) return issue.message;
  const fault = validated.faults[0];
  if (fault !== undefined) return fault.message;
  return null;
}

/** How many distinct problems stop the row: an issue per value, plus every fault the parse measured. */
function problemCountOf(validated: ImportValidatedRow): number {
  return validated.issues.length + validated.faults.length;
}

/** The columns the row's problems name, ascending and without repeats. */
function problemColumnsOf(validated: ImportValidatedRow): number[] {
  const columns: number[] = [];
  for (const issue of validated.issues) {
    if (issue.columnNumber !== null && !columns.includes(issue.columnNumber)) {
      columns.push(issue.columnNumber);
    }
  }
  for (const fault of validated.faults) {
    if (fault.columnNumber !== null && !columns.includes(fault.columnNumber)) {
      columns.push(fault.columnNumber);
    }
  }
  return columns.sort((left, right) => left - right);
}

function unreadableDecisionRefusal(error: ParseFailure): ImportDecisionRefusal {
  const places: string[] = [];
  for (const issue of error.issues) {
    const place = issue.path.map((part) => String(part)).join(".");
    if (place.length > 0 && !places.includes(place)) places.push(place);
  }
  const where = places.length === 0 ? "its own shape" : places.join(", ");
  const first = error.issues[0];
  const detail = first === undefined ? "" : `: ${first.message}`;

  return {
    code: "decision-invalid",
    rowNumber: null,
    columnNumbers: [],
    message: `This decision could not be read at ${where}${detail}. A decision names one data row of this file and what to do with that row.`,
  };
}

function rowNotFoundRefusal(rowNumber: number, rowCount: number): ImportDecisionRefusal {
  return {
    code: "row-not-found",
    rowNumber,
    columnNumbers: [],
    message: `Row ${rowNumber} is not one of this file's ${rowCount} data row(s). Decide about a row the file actually holds.`,
  };
}

function rowNeedsCorrectionRefusal(
  rowNumber: number,
  validated: ImportValidatedRow,
): ImportDecisionRefusal {
  return {
    code: "row-needs-correction",
    rowNumber,
    columnNumbers: problemColumnsOf(validated),
    message: `Row ${rowNumber} cannot be accepted as it stands: it has ${problemCountOf(validated)} problem(s). ${rowProblemOf(validated) ?? ""} Correct the cell and decide again, or skip the row.`,
  };
}

function correctionNotClearingRefusal(
  rowNumber: number,
  validated: ImportValidatedRow,
): ImportDecisionRefusal {
  return {
    code: "correction-not-clearing",
    rowNumber,
    columnNumbers: problemColumnsOf(validated),
    message: `Row ${rowNumber} was corrected and still has ${problemCountOf(validated)} problem(s) that stop it being accepted. ${rowProblemOf(validated) ?? ""} Supply a correction for every cell named there, or skip the row.`,
  };
}

/** The re-check itself could not read the corrected row, so it is not treated as corrected. */
function correctionNotCheckedRefusal(rowNumber: number): ImportDecisionRefusal {
  return {
    code: "correction-not-clearing",
    rowNumber,
    columnNumbers: [],
    message: `Row ${rowNumber} could not be re-checked after the correction, so it cannot be accepted as corrected. Choose the file again and confirm the mapping for it.`,
  };
}

function noReusableCandidateRefusal(rowNumber: number): ImportDecisionRefusal {
  return {
    code: "no-reusable-candidate",
    rowNumber,
    columnNumbers: [],
    message: `Row ${rowNumber} shares no usable value with a contact you can reuse, so there is nothing to attach it to. Create a new private entry for this row instead, or skip it.`,
  };
}

function candidateNotSuggestedRefusal(
  rowNumber: number,
  offeredCount: number,
): ImportDecisionRefusal {
  return {
    code: "candidate-not-suggested",
    rowNumber,
    columnNumbers: [],
    message: `Row ${rowNumber} was offered ${offeredCount} contact(s) it could reuse, and that reference is not one of them. Choose one of the contacts proposed for this row, create a new private entry, or skip it.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Phase B: the corrections a decision carries, and the re-check they require
// ---------------------------------------------------------------------------------------------

type CorrectionCheck =
  | { readonly ok: true; readonly corrections: readonly ImportRecordedCorrection[] }
  | { readonly ok: false; readonly refusal: ImportDecisionRefusal };

function refusedCorrection(
  code: ImportDecisionRefusalCode,
  rowNumber: number,
  columnNumbers: readonly number[],
  message: string,
): CorrectionCheck {
  return { ok: false, refusal: { code, rowNumber, columnNumbers, message } };
}

/**
 * Reads the corrections into the form the set records, refusing every one the row cannot support. A
 * correction must name a cell this row actually has, a column the confirmed mapping gives a contact
 * field to, and a cell the file could not use — otherwise it would change nothing while looking as
 * though it had. Each replacement is measured in code points before it is accepted, because the cell
 * limit is a parse-time rule the re-check would otherwise never apply to new text.
 */
function checkCorrections(
  input: readonly ImportCellCorrectionInput[],
  row: ParsedCsvRow,
  validated: ImportValidatedRow,
  context: ImportDecisionContext,
): CorrectionCheck {
  const byColumn = new Map<number, string>();
  for (const correction of input) {
    if (byColumn.has(correction.columnNumber)) {
      return refusedCorrection(
        "correction-duplicated",
        row.rowNumber,
        [correction.columnNumber],
        `Column ${correction.columnNumber} was corrected twice in one decision. Supply one corrected value per column.`,
      );
    }
    byColumn.set(correction.columnNumber, correction.value);
  }

  const fixable = fixableColumnsOf(validated);
  const recorded: ImportRecordedCorrection[] = [];

  for (const columnNumber of [...byColumn.keys()].sort((left, right) => left - right)) {
    const value = byColumn.get(columnNumber);
    if (value === undefined) continue;

    if (columnNumber > row.cells.length) {
      return refusedCorrection(
        "correction-target-unknown",
        row.rowNumber,
        [columnNumber],
        `Column ${columnNumber} is not a cell of row ${row.rowNumber}, which holds ${row.cells.length} cell(s) while the header names ${context.file.headers.length} column(s). Correct a cell the row actually has.`,
      );
    }

    const fieldId = fieldAtColumn(context.mapping, columnNumber);
    if (fieldId === null) {
      const header = headerAt(context.file.headers, columnNumber);
      return refusedCorrection(
        "correction-target-unmapped",
        row.rowNumber,
        [columnNumber],
        `Column ${columnNumber} ("${header}") supplies no contact field in the confirmed mapping, so correcting it would change nothing about this row.`,
      );
    }

    if (!fixable.has(columnNumber)) {
      return refusedCorrection(
        "correction-not-needed",
        row.rowNumber,
        [columnNumber],
        `Column ${columnNumber} has no problem on row ${row.rowNumber}, so there is nothing to correct there. Correct only the cells the file could not use, or skip the row.`,
      );
    }

    const measured = codePointCount(value);
    if (measured > IMPORT_MAX_CELL_CODE_POINTS) {
      return refusedCorrection(
        "correction-not-clearing",
        row.rowNumber,
        [columnNumber],
        `The corrected value for column ${columnNumber} is ${measured} characters long; the limit is ${IMPORT_MAX_CELL_CODE_POINTS} characters per cell. Shorten it, or skip this row.`,
      );
    }

    recorded.push({ columnNumber, fieldId, value });
  }

  return { ok: true, corrections: recorded };
}

/**
 * The columns a correction could clear: the cell behind an issue, and an over-long cell the parse
 * measured. A ragged row is deliberately absent — its shape is wrong rather than a value, so no
 * replacement text fixes it and the worker edits the file or skips the row.
 */
function fixableColumnsOf(validated: ImportValidatedRow): ReadonlySet<number> {
  const fixable = new Set<number>();
  for (const issue of validated.issues) {
    if (issue.columnNumber !== null) fixable.add(issue.columnNumber);
  }
  for (const fault of validated.faults) {
    if (fault.kind === "cell-too-long" && fault.columnNumber !== null) {
      fixable.add(fault.columnNumber);
    }
  }
  return fixable;
}

/**
 * The row re-validated with the corrections applied, or null if the re-check could not read it. The
 * corrected cells replace the parsed ones, and every parse fault about a corrected cell is dropped:
 * the replacement was measured against the cell limit first, so a fault describing the old value no
 * longer describes this row. Everything else — the mapping, the untouched cells, the faults on cells
 * nobody corrected — is passed to `validate.ts` exactly as it stood.
 */
function revalidateRow(
  row: ParsedCsvRow,
  corrections: readonly ImportCellCorrectionInput[],
  validated: ImportValidatedRow,
  context: ImportDecisionContext,
): ImportValidatedRow | null {
  const cells = [...row.cells];
  const correctedColumns = new Set<number>();
  for (const correction of corrections) {
    cells[correction.columnNumber - 1] = correction.value;
    correctedColumns.add(correction.columnNumber);
  }

  const faults = validated.faults.filter(
    (fault) => fault.columnNumber === null || !correctedColumns.has(fault.columnNumber),
  );

  const revalidated = validateRows(
    {
      ...context.file,
      rows: [{ rowNumber: row.rowNumber, cells }],
      dataRowCount: 1,
      rowFaults: faults,
    },
    context.mapping,
  );

  return revalidated.rows[0] ?? null;
}

/** The field a 1-based column supplies, or null when the confirmed mapping gives it none. */
function fieldAtColumn(
  mapping: ImportConfirmedMapping,
  columnNumber: number,
): ImportFieldId | null {
  const assignment = mapping.assignments.find(
    (candidate) => candidate.columnIndex === columnNumber,
  );
  return assignment === undefined ? null : assignment.fieldId;
}

/** The header text at a 1-based position, or an empty string when the position has none. */
function headerAt(headers: readonly string[], columnNumber: number): string {
  return headers[columnNumber - 1] ?? "";
}

/** Code points, not UTF-16 units: an astral character counts once, exactly as the limit states. */
function codePointCount(value: string): number {
  return [...value].length;
}

// ---------------------------------------------------------------------------------------------
// Phase D: the summary that must exist before anything is accepted
// ---------------------------------------------------------------------------------------------

/**
 * Why a row cannot be accepted as it stands: a value the file could not supply, a shape the parse
 * measured, or a reuse the comparison no longer offers. Each is a fact the review step can act on.
 */
export type ImportBlockingReasonCode = ImportIssueCode | ImportRowFaultKind | "reuse-not-offered";

/** The order blocked reasons are reported in: issues, then faults, then a lost reuse offer. */
const BLOCKING_REASON_ORDER: readonly ImportBlockingReasonCode[] = [
  "name-missing",
  "email-not-complete",
  "phone-not-a-number",
  "postal-not-an-address",
  "ragged-row",
  "cell-too-long",
  "reuse-not-offered",
];

/** One factual line per blocking reason, so the review step groups by fact rather than by prose. */
const BLOCKING_REASON_LABELS: Readonly<Record<ImportBlockingReasonCode, string>> = {
  "name-missing": "No name supplied",
  "email-not-complete": "Email is not one complete address",
  "phone-not-a-number": "Phone is not a number",
  "postal-not-an-address": "Postal address holds no letters and no digits",
  "ragged-row": "The row does not line up with the header",
  "cell-too-long": "A cell is longer than the limit",
  "reuse-not-offered": "The contact chosen for reuse is no longer offered",
};

/** How many rows stand in each of the four states. `total` is every data row of the file. */
export interface ImportDecisionCounts {
  readonly create: number;
  readonly reuse: number;
  readonly skip: number;
  readonly unresolved: number;
  readonly total: number;
}

/**
 * How many rows carry one blocking reason. A row can carry several, so these counts may add up to
 * more than `blockedRowCount`, which counts rows and not reasons.
 */
export interface ImportBlockedReasonCount {
  readonly code: ImportBlockingReasonCode;
  readonly label: string;
  readonly count: number;
}

/** How many corrections the set carries for one field. */
export interface ImportCorrectionCount {
  readonly fieldId: ImportFieldId;
  readonly label: string;
  readonly count: number;
}

/**
 * A column no field reads, kept with the reason it was left out. `statesConsent` marks the columns
 * that look like a subscription or consent statement: their values are kept as data, are read as
 * nothing, and create no membership.
 */
export interface ImportPreservedColumnSummary {
  readonly columnNumber: number;
  readonly header: string;
  readonly reason: ImportPreservedReason;
  readonly statesConsent: boolean;
  /** How many rows supplied a value in this column. */
  readonly cellCount: number;
}

/**
 * What acceptance will not create, stated as data rather than as a sentence the view has to trust.
 * Every value is a literal type, so no code path can produce a summary that claims anything else:
 * this module has none that could create a membership, a consent record or an audience member.
 */
export interface ImportDecisionFacts {
  readonly memberships: 0;
  readonly consentRecords: 0;
  readonly audienceMembers: 0;
  /** A preserved column is kept as data. Whatever it is called, it creates nothing either. */
  readonly preservedColumnsCreateNothing: true;
}

/** One row of the reconciliation: what stands for the row, and what still stops it. */
export interface ImportDecisionSummaryRow {
  readonly rowNumber: number;
  readonly decisionKind: ImportDecisionKind;
  readonly verdict: ImportRowVerdict;
  readonly blockedReasons: readonly ImportBlockingReasonCode[];
  /** The fields this row's corrections fix, in vocabulary order. */
  readonly correctedFields: readonly ImportFieldId[];
}

/**
 * Everything the review step shows before the worker accepts anything: how the rows divide, what
 * still stops them, what was corrected and where, what is carried and what is only kept, and the
 * fingerprint of the file it describes so the summary cannot be shown against another one.
 *
 * `counts.create + counts.reuse + counts.skip + counts.unresolved === counts.total`, and `total`
 * equals the parsed row count: every row is in exactly one bucket, skipped and unresolved included.
 */
export interface ImportDecisionSummary {
  readonly fingerprint: ImportFileFingerprint;
  readonly totalRowCount: number;
  readonly counts: ImportDecisionCounts;
  /** Rows that cannot be accepted as they stand. A skipped row is decided, so it is never blocked. */
  readonly blockedRowCount: number;
  readonly blockedReasons: readonly ImportBlockedReasonCount[];
  readonly corrections: readonly ImportCorrectionCount[];
  readonly correctionCount: number;
  /** Restrictions the file stated, on every row. Not one of them is read as a permission. */
  readonly restrictionsPreserved: number;
  /** Restrictions on the rows that will become a private preparation entry, and so be carried. */
  readonly restrictionsCarried: number;
  readonly preservedColumns: readonly ImportPreservedColumnSummary[];
  readonly preservedColumnCount: number;
  readonly consentLookingColumnCount: number;
  readonly facts: ImportDecisionFacts;
  readonly rows: readonly ImportDecisionSummaryRow[];
}

export type ImportSummaryResult =
  | { readonly ok: true; readonly summary: ImportDecisionSummary }
  | { readonly ok: false; readonly refusal: ImportDecisionRefusal };

/** A preserved column while it is being counted across rows. */
interface PreservedColumnTally {
  columnNumber: number;
  header: string;
  reason: ImportPreservedReason;
  statesConsent: boolean;
  cellCount: number;
}

/**
 * Counts the decision set against the file it belongs to, refusing rather than describing a file the
 * set was not taken against. Nothing here accepts, skips or changes a row: it reports what the
 * service would do, so the review step can show it before the worker commits to anything.
 */
export function summariseDecisions(
  set: ImportDecisionSet,
  context: ImportDecisionContext,
): ImportSummaryResult {
  const stale = staleFileRefusal(set, context.file);
  if (stale !== null) return { ok: false, refusal: stale };

  const mismatch = contextMismatchRefusal(context);
  if (mismatch !== null) return { ok: false, refusal: mismatch };

  const decisionByRow = new Map<number, ImportRowDecision>();
  for (const decision of set.decisions) decisionByRow.set(decision.rowNumber, decision);

  const kindCounts: Record<ImportDecisionKind, number> = {
    create: 0,
    reuse: 0,
    skip: 0,
    unresolved: 0,
  };
  const blockedCounts = new Map<ImportBlockingReasonCode, number>();
  const correctionCounts = new Map<ImportFieldId, number>();
  const preservedColumns = new Map<number, PreservedColumnTally>();
  const rows: ImportDecisionSummaryRow[] = [];
  let correctionCount = 0;
  let restrictionsPreserved = 0;
  let restrictionsCarried = 0;

  for (const validated of context.validation.rows) {
    const decision = decisionByRow.get(validated.rowNumber);
    const decisionKind: ImportDecisionKind = decision === undefined ? "unresolved" : decision.kind;
    kindCounts[decisionKind] += 1;

    // A row carrying corrections is judged on the corrected row, because that is the row acceptance
    // would create: reporting the problems of text the worker already fixed would keep the review
    // step asking for a correction that has been made.
    const effective = effectiveRowOf(validated, decision, context);
    const blockedReasons = blockedReasonsOf(effective, decision, context.candidates);
    for (const reason of blockedReasons) {
      blockedCounts.set(reason, (blockedCounts.get(reason) ?? 0) + 1);
    }

    const correctedFields: ImportFieldId[] = [];
    if (decision !== undefined && (decision.kind === "create" || decision.kind === "reuse")) {
      for (const correction of decision.corrections) {
        correctionCount += 1;
        correctionCounts.set(
          correction.fieldId,
          (correctionCounts.get(correction.fieldId) ?? 0) + 1,
        );
        if (!correctedFields.includes(correction.fieldId)) {
          correctedFields.push(correction.fieldId);
        }
      }
    }

    restrictionsPreserved += validated.restrictions.length;
    if (decisionKind === "create" || decisionKind === "reuse") {
      restrictionsCarried += validated.restrictions.length;
    }

    tallyPreservedColumns(preservedColumns, validated);

    rows.push({
      rowNumber: validated.rowNumber,
      decisionKind,
      verdict: effective.verdict,
      blockedReasons,
      correctedFields: IMPORT_FIELD_IDS.filter((fieldId) => correctedFields.includes(fieldId)),
    });
  }

  const blockedReasons: ImportBlockedReasonCount[] = [];
  for (const code of BLOCKING_REASON_ORDER) {
    const count = blockedCounts.get(code);
    if (count === undefined) continue;
    blockedReasons.push({ code, label: BLOCKING_REASON_LABELS[code], count });
  }

  const corrections: ImportCorrectionCount[] = [];
  for (const fieldId of IMPORT_FIELD_IDS) {
    const count = correctionCounts.get(fieldId);
    if (count === undefined) continue;
    corrections.push({ fieldId, label: labelOf(fieldId), count });
  }

  const preserved = [...preservedColumns.values()]
    .sort((left, right) => left.columnNumber - right.columnNumber)
    .map((column) => ({ ...column }));

  return {
    ok: true,
    summary: {
      fingerprint: set.fingerprint,
      totalRowCount: rows.length,
      counts: { ...kindCounts, total: rows.length },
      blockedRowCount: rows.filter((row) => row.blockedReasons.length > 0).length,
      blockedReasons,
      corrections,
      correctionCount,
      restrictionsPreserved,
      restrictionsCarried,
      preservedColumns: preserved,
      preservedColumnCount: preserved.length,
      consentLookingColumnCount: preserved.filter((column) => column.statesConsent).length,
      facts: {
        memberships: 0,
        consentRecords: 0,
        audienceMembers: 0,
        preservedColumnsCreateNothing: true,
      },
      rows,
    },
  };
}

/**
 * The row as its decision leaves it: the validated row when nothing was corrected, and otherwise the
 * corrected row re-validated exactly as `recordDecision` re-validated it. A re-check that cannot read
 * the row falls back to the validation as it stands, so a row is never reported as ready on the
 * strength of a check that did not run.
 */
function effectiveRowOf(
  validated: ImportValidatedRow,
  decision: ImportRowDecision | undefined,
  context: ImportDecisionContext,
): ImportValidatedRow {
  if (decision === undefined) return validated;
  if (decision.kind !== "create" && decision.kind !== "reuse") return validated;
  if (decision.corrections.length === 0) return validated;

  const row = context.file.rows.find((candidate) => candidate.rowNumber === validated.rowNumber);
  if (row === undefined) return validated;

  const corrections = decision.corrections.map((correction) => ({
    columnNumber: correction.columnNumber,
    value: correction.value,
  }));
  return revalidateRow(row, corrections, validated, context) ?? validated;
}

/**
 * Why this row cannot be accepted as it stands, in a fixed order, judged on the row its decision
 * leaves behind. A skipped row is decided rather than blocked. An unresolved row is reported here
 * when it still needs a correction, which is what tells the review step how many rows want attention
 * before anything is accepted.
 */
function blockedReasonsOf(
  validated: ImportValidatedRow,
  decision: ImportRowDecision | undefined,
  candidates: readonly ImportMatchCandidate[],
): ImportBlockingReasonCode[] {
  if (decision !== undefined && decision.kind === "skip") return [];

  const found = new Set<ImportBlockingReasonCode>();
  if (validated.verdict === "needs-correction") {
    for (const issue of validated.issues) found.add(issue.code);
    for (const fault of validated.faults) found.add(fault.kind);
  }

  // A reuse decided earlier can stop being offered when the mapping or the caller's candidates
  // change, so the offer is re-read here rather than trusted from the moment it was recorded.
  if (decision !== undefined && decision.kind === "reuse") {
    const suggestions = suggestMatches(validated, candidates).suggestions;
    if (!suggestions.some((candidate) => sameReference(candidate.reference, decision.candidate))) {
      found.add("reuse-not-offered");
    }
  }

  return BLOCKING_REASON_ORDER.filter((code) => found.has(code));
}

/**
 * Adds a row's preserved, uninterpreted cells to the per-column tally. A blank cell and a rejected
 * value are left out: those belong to a field the mapping does read, so they are a correction or a
 * gap in a contact rather than a column nothing interprets.
 */
function tallyPreservedColumns(
  columns: Map<number, PreservedColumnTally>,
  validated: ImportValidatedRow,
): void {
  for (const cell of validated.preservedCells) {
    if (cell.reason === "blank-cell" || cell.reason === "rejected-value") continue;
    const held = columns.get(cell.columnNumber);
    if (held === undefined) {
      columns.set(cell.columnNumber, {
        columnNumber: cell.columnNumber,
        header: cell.header,
        reason: cell.reason,
        statesConsent: cell.statesConsent,
        cellCount: 1,
      });
      continue;
    }
    held.cellCount += 1;
  }
}

/** The plain-language name of a field from the mapping vocabulary, and the id itself if it is missing. */
function labelOf(fieldId: ImportFieldId): string {
  const field = IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId);
  return field === undefined ? fieldId : field.label;
}

// ---------------------------------------------------------------------------------------------
// Phase E: what this file deliberately does not do
// ---------------------------------------------------------------------------------------------
//
// Nothing here subscribes anyone, creates a membership or an audience member, records consent, adds a
// gift, a commitment, a task or an interaction, copies a note body anywhere, merges two records,
// overwrites or deletes an existing one, or produces any effect at all: the summary's facts carry
// those zeros, and the service's `acceptImportRows` is the only caller that may act on a decision.
// Nothing here decides whether a reference may be reused either — a candidate arrives with the reuse
// fact the service resolved, a candidate without it is never proposed by `validate.ts`, and this
// module only checks that the reference the worker named is one of the candidates that row was
// offered. Cancellation, and what happens to rows already accepted before it, belongs to `receipt.ts`.
// No message here claims the file is safe or validated: a successful local parse is not a safety
// qualification, and the synthetic-files label belongs to the import feature.
