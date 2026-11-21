/**
 * Contact import, step four: record the worker's decision about one row at a time, and produce the
 * summary the shared review step renders before anything is accepted.
 */
import { z } from "zod";
import type { ImportConfirmedMapping, ImportFieldId } from "./map";
import { IMPORT_FIELD_IDS, IMPORT_FIELD_VOCABULARY } from "./map";
import type { ImportRowFaultKind, ParsedCsvFile, ParsedCsvRow } from "./parse";
import { IMPORT_MAX_CELL_CODE_POINTS } from "./parse";
import type { ImportIssueCode, ImportMatchCandidate, ImportMatchReference, ImportPreservedReason, ImportRowVerdict, ImportValidatedRow, ImportValidation } from "./validate";
import { suggestMatches, validateRows } from "./validate";
// Phase A: exactly four decisions
/** The four decisions a worker can take about one row, and the whole vocabulary of the step: a new private entry, reuse of an authorized identity, a skip, or nothing yet. */
export type ImportDecisionKind = "create" | "reuse" | "skip" | "unresolved";
/** The four kinds in the order the review step offers them. */
export const IMPORT_DECISION_KINDS: readonly ImportDecisionKind[] = ["create", "reuse", "skip", "unresolved"];
/** A cell the worker rewrote before deciding, as a client sends it: a 1-based column position and the text that replaces the cell. */
export interface ImportCellCorrectionInput {
  readonly columnNumber: number;
  readonly value: string;
}
/** A cell the worker rewrote, as recorded: the field the column supplied at that moment, so the summary counts corrections per field without re-reading a mapping that may since have changed. */
export interface ImportRecordedCorrection {
  readonly columnNumber: number;
  readonly fieldId: ImportFieldId;
  readonly value: string;
}
/** A new private preparation entry, built only from this row's mapped cells. */
export interface ImportCreateDecision {
  readonly kind: "create";
  readonly rowNumber: number;
  readonly verdict: ImportRowVerdict;
  readonly corrections: readonly ImportRecordedCorrection[];
}
/** A private preparation entry of its own, attached to an existing identity by that identity's opaque, source-qualified reference. */
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
  readonly workerReason: string;
  readonly rowProblem: string | null;
}
/** Nothing decided yet: neither accepted nor skipped, and it blocks no other row. */
export interface ImportUnresolvedDecision {
  readonly kind: "unresolved";
  readonly rowNumber: number;
  readonly verdict: ImportRowVerdict;
}
/** One row's decision: exactly one of the four kinds above. */
export type ImportRowDecision = ImportCreateDecision | ImportReuseDecision | ImportSkipDecision | ImportUnresolvedDecision;
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
  readonly reason?: string;
}
/** What a client asks for when it means to clear a decision and leave the row undecided. */
export interface ImportUnresolvedDecisionInput {
  readonly kind: "unresolved";
  readonly rowNumber: number;
}
/** Everything a client may ask for, in one closed union. */
export type ImportDecisionInput = ImportCreateDecisionInput | ImportReuseDecisionInput | ImportSkipDecisionInput | ImportUnresolvedDecisionInput;
/** What a decision set was taken against. */
export interface ImportFileFingerprint {
  readonly checksum: string;
  readonly columnCount: number;
  readonly dataRowCount: number;
}
/** The decisions about one file, carried with the fingerprint of the file they were taken against. */
export interface ImportDecisionSet {
  readonly fingerprint: ImportFileFingerprint;
  readonly decisions: readonly ImportRowDecision[];
}
// Phase B: refusals, and what a decision is checked against
/** Why a decision could not be recorded. */
export type ImportDecisionRefusalCode =
  | "decision-invalid"
  | "file-changed"
  | "context-mismatch"
  | "row-not-found"
  | "row-needs-correction"
  | "correction-duplicated"
  | "correction-target-unknown"
  | "correction-target-unmapped"
  | "correction-not-needed"
  | "correction-not-clearing"
  | "no-reusable-candidate"
  | "candidate-not-suggested";
/** A refusal in the words the review step shows. */
export interface ImportDecisionRefusal {
  readonly code: ImportDecisionRefusalCode;
  readonly rowNumber: number | null;
  readonly columnNumbers: readonly number[];
  readonly message: string;
}
/** What a decision and a summary are checked against: the file as parsed, the mapping the worker confirmed, the validation of that file, and the existing contacts the service resolved in the. */
export interface ImportDecisionContext {
  readonly file: ParsedCsvFile;
  readonly mapping: ImportConfirmedMapping;
  readonly validation: ImportValidation;
  readonly candidates: readonly ImportMatchCandidate[];
}
/** The decision that now stands, and whether recording it changed anything. */
export type ImportRecordDecisionResult =
  | {
      readonly ok: true;
      readonly set: ImportDecisionSet;
      readonly decision: ImportRowDecision;
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly refusal: ImportDecisionRefusal };
// Phase C: one fingerprint of the file, computed in one place
const FINGERPRINT_TAG = "csv-1";

const PART_SEPARATOR = "\u001f";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECOND_SEED = 0x9747b28c;
const SECOND_PRIME = 0x85ebca6b;

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
function checksumOf(text: string): string {
  const high = hashRound(text, SECOND_SEED, SECOND_PRIME);
  const low = hashRound(text, FNV_OFFSET, FNV_PRIME);
  return `${FINGERPRINT_TAG}-${hex8(high)}${hex8(low)}`;
}
function framedPart(part: string): string {
  return `${part.length}:${part}`;
}
/** The content fingerprint of a parsed file: its headers and every cell in row order, each length framed, hashed once here. */
export function fingerprintOf(file: ParsedCsvFile): ImportFileFingerprint {
  const parts: string[] = [framedPart(String(file.headers.length)), ...file.headers.map((header) => framedPart(header)), framedPart(String(file.rows.length))];
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
  return left.checksum === right.checksum && left.columnCount === right.columnCount && left.dataRowCount === right.dataRowCount;
}
/** Null when the set describes this exact file, and the `file-changed` refusal when it does not. */
export function staleFileRefusal(set: ImportDecisionSet, file: ParsedCsvFile): ImportDecisionRefusal | null {
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
function contextMismatchRefusal(context: ImportDecisionContext): ImportDecisionRefusal | null {
  const { file, validation } = context;
  const aligned = validation.rows.length === file.rows.length && validation.rows.every((row, index) => file.rows[index]?.rowNumber === row.rowNumber);
  if (aligned) return null;
  return {
    code: "context-mismatch",
    rowNumber: null,
    columnNumbers: [],
    message: `The validation offered for this file describes ${validation.rows.length} row(s) and the file holds ${file.rows.length}. Validate this file again, then decide about its rows.`,
  };
}
// Phase B: the payload, checked before any of it is read
const CORRECTION_SCHEMA = z.object({
  columnNumber: z.number().int().min(1),
  value: z.string(),
});
const REFERENCE_SCHEMA = z.object({
  system: z.string().min(1),
  reference: z.string().min(1),
});
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
interface ParseFailure {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}
// Phase B: recording one decision
/** Records one row's decision, or refuses it with the reason it cannot stand, and returns the set the service persists. */
export function recordDecision(set: ImportDecisionSet, input: ImportDecisionInput, context: ImportDecisionContext): ImportRecordDecisionResult {
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
      refusal: corrections.length === 0 ? rowNeedsCorrectionRefusal(rowNumber, revalidated) : correctionNotClearingRefusal(rowNumber, revalidated),
    };
  }
  if (data.kind === "reuse") {
    const suggestions = suggestMatches(revalidated, context.candidates).suggestions;
    if (suggestions.length === 0) {
      return { ok: false, refusal: noReusableCandidateRefusal(rowNumber) };
    }
    const offered = suggestions.some((candidate) => sameReference(candidate.reference, data.candidate));
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
function withDecision(set: ImportDecisionSet, decision: ImportRowDecision): ImportRecordDecisionResult {
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
function sameReference(left: ImportMatchReference, right: ImportMatchReference): boolean {
  return left.system === right.system && left.reference === right.reference;
}
function rowProblemOf(validated: ImportValidatedRow): string | null {
  const issue = validated.issues[0];
  if (issue !== undefined) return issue.message;
  const fault = validated.faults[0];
  if (fault !== undefined) return fault.message;
  return null;
}
function problemCountOf(validated: ImportValidatedRow): number {
  return validated.issues.length + validated.faults.length;
}
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
function rowNeedsCorrectionRefusal(rowNumber: number, validated: ImportValidatedRow): ImportDecisionRefusal {
  return {
    code: "row-needs-correction",
    rowNumber,
    columnNumbers: problemColumnsOf(validated),
    message: `Row ${rowNumber} cannot be accepted as it stands: it has ${problemCountOf(validated)} problem(s). ${rowProblemOf(validated) ?? ""} Correct the cell and decide again, or skip the row.`,
  };
}
function correctionNotClearingRefusal(rowNumber: number, validated: ImportValidatedRow): ImportDecisionRefusal {
  return {
    code: "correction-not-clearing",
    rowNumber,
    columnNumbers: problemColumnsOf(validated),
    message: `Row ${rowNumber} was corrected and still has ${problemCountOf(validated)} problem(s) that stop it being accepted. ${rowProblemOf(validated) ?? ""} Supply a correction for every cell named there, or skip the row.`,
  };
}
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
function candidateNotSuggestedRefusal(rowNumber: number, offeredCount: number): ImportDecisionRefusal {
  return {
    code: "candidate-not-suggested",
    rowNumber,
    columnNumbers: [],
    message: `Row ${rowNumber} was offered ${offeredCount} contact(s) it could reuse, and that reference is not one of them. Choose one of the contacts proposed for this row, create a new private entry, or skip it.`,
  };
}
// Phase B: the corrections a decision carries, and the re-check they require
type CorrectionCheck = { readonly ok: true; readonly corrections: readonly ImportRecordedCorrection[] } | { readonly ok: false; readonly refusal: ImportDecisionRefusal };

function refusedCorrection(code: ImportDecisionRefusalCode, rowNumber: number, columnNumbers: readonly number[], message: string): CorrectionCheck {
  return { ok: false, refusal: { code, rowNumber, columnNumbers, message } };
}
function checkCorrections(input: readonly ImportCellCorrectionInput[], row: ParsedCsvRow, validated: ImportValidatedRow, context: ImportDecisionContext): CorrectionCheck {
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
function revalidateRow(row: ParsedCsvRow, corrections: readonly ImportCellCorrectionInput[], validated: ImportValidatedRow, context: ImportDecisionContext): ImportValidatedRow | null {
  const cells = [...row.cells];
  const correctedColumns = new Set<number>();
  for (const correction of corrections) {
    cells[correction.columnNumber - 1] = correction.value;
    correctedColumns.add(correction.columnNumber);
  }
  const faults = validated.faults.filter((fault) => fault.columnNumber === null || !correctedColumns.has(fault.columnNumber));
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
function fieldAtColumn(mapping: ImportConfirmedMapping, columnNumber: number): ImportFieldId | null {
  const assignment = mapping.assignments.find((candidate) => candidate.columnIndex === columnNumber);
  return assignment === undefined ? null : assignment.fieldId;
}
function headerAt(headers: readonly string[], columnNumber: number): string {
  return headers[columnNumber - 1] ?? "";
}
function codePointCount(value: string): number {
  return [...value].length;
}
// Phase D: the summary that must exist before anything is accepted
/** Why a row cannot be accepted as it stands: a value the file could not supply, a shape the parse measured, or a reuse the comparison no longer offers. */
export type ImportBlockingReasonCode = ImportIssueCode | ImportRowFaultKind | "reuse-not-offered";

const BLOCKING_REASON_ORDER: readonly ImportBlockingReasonCode[] = [
  "name-missing",
  "email-not-complete",
  "phone-not-a-number",
  "postal-not-an-address",
  "ragged-row",
  "cell-too-long",
  "reuse-not-offered",
];
const BLOCKING_REASON_LABELS: Readonly<Record<ImportBlockingReasonCode, string>> = {
  "name-missing": "No name supplied",
  "email-not-complete": "Email is not one complete address",
  "phone-not-a-number": "Phone is not a number",
  "postal-not-an-address": "Postal address holds no letters and no digits",
  "ragged-row": "The row does not line up with the header",
  "cell-too-long": "A cell is longer than the limit",
  "reuse-not-offered": "The contact chosen for reuse is no longer offered",
};
/** How many rows stand in each of the four states. */
export interface ImportDecisionCounts {
  readonly create: number;
  readonly reuse: number;
  readonly skip: number;
  readonly unresolved: number;
  readonly total: number;
}
/** How many rows carry one blocking reason. */
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
/** A column no field reads, kept with the reason it was left out. */
export interface ImportPreservedColumnSummary {
  readonly columnNumber: number;
  readonly header: string;
  readonly reason: ImportPreservedReason;
  readonly statesConsent: boolean;
  readonly cellCount: number;
}
/** What acceptance will not create, stated as data rather than as a sentence the view has to trust. */
export interface ImportDecisionFacts {
  readonly memberships: 0;
  readonly consentRecords: 0;
  readonly audienceMembers: 0;
  readonly preservedColumnsCreateNothing: true;
}
/** One row of the reconciliation: what stands for the row, and what still stops it. */
export interface ImportDecisionSummaryRow {
  readonly rowNumber: number;
  readonly decisionKind: ImportDecisionKind;
  readonly verdict: ImportRowVerdict;
  readonly blockedReasons: readonly ImportBlockingReasonCode[];
  readonly correctedFields: readonly ImportFieldId[];
}
/** Everything the review step shows before the worker accepts anything: how the rows divide, what still stops them, what was corrected and where, what is carried and what is only kept, and the. */
export interface ImportDecisionSummary {
  readonly fingerprint: ImportFileFingerprint;
  readonly totalRowCount: number;
  readonly counts: ImportDecisionCounts;
  readonly blockedRowCount: number;
  readonly blockedReasons: readonly ImportBlockedReasonCount[];
  readonly corrections: readonly ImportCorrectionCount[];
  readonly correctionCount: number;
  readonly restrictionsPreserved: number;
  readonly restrictionsCarried: number;
  readonly preservedColumns: readonly ImportPreservedColumnSummary[];
  readonly preservedColumnCount: number;
  readonly consentLookingColumnCount: number;
  readonly facts: ImportDecisionFacts;
  readonly rows: readonly ImportDecisionSummaryRow[];
}
export type ImportSummaryResult = { readonly ok: true; readonly summary: ImportDecisionSummary } | { readonly ok: false; readonly refusal: ImportDecisionRefusal };

interface PreservedColumnTally {
  columnNumber: number;
  header: string;
  reason: ImportPreservedReason;
  statesConsent: boolean;
  cellCount: number;
}
/** Counts the decision set against the file it belongs to, refusing rather than describing a file the set was not taken against. */
export function summariseDecisions(set: ImportDecisionSet, context: ImportDecisionContext): ImportSummaryResult {
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
        correctionCounts.set(correction.fieldId, (correctionCounts.get(correction.fieldId) ?? 0) + 1);
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
  const preserved = [...preservedColumns.values()].sort((left, right) => left.columnNumber - right.columnNumber).map((column) => ({ ...column }));
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
function effectiveRowOf(validated: ImportValidatedRow, decision: ImportRowDecision | undefined, context: ImportDecisionContext): ImportValidatedRow {
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
function blockedReasonsOf(validated: ImportValidatedRow, decision: ImportRowDecision | undefined, candidates: readonly ImportMatchCandidate[]): ImportBlockingReasonCode[] {
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
function tallyPreservedColumns(columns: Map<number, PreservedColumnTally>, validated: ImportValidatedRow): void {
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
function labelOf(fieldId: ImportFieldId): string {
  const field = IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId);
  return field === undefined ? fieldId : field.label;
}
// Phase E: what this file deliberately does not do
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
