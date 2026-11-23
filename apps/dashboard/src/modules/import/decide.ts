import { z } from "zod";
import { IMPORT_FIELD_IDS, IMPORT_FIELD_VOCABULARY, ImportFieldId, type ImportConfirmedMapping } from "./map";
import { IMPORT_MAX_CELL_CODE_POINTS, ParsedCsvFile, ParsedCsvRow, type ImportRowFaultKind } from "./parse";
import { suggestMatches, validateRows, ImportMatchCandidate, ImportMatchReference, ImportPreservedReason, ImportRowVerdict, ImportValidatedRow, ImportValidation, type ImportIssueCode } from "./validate";
export type ImportDecisionKind = "create" | "reuse" | "skip" | "unresolved";
export const IMPORT_DECISION_KINDS: readonly ImportDecisionKind[] = ["create", "reuse", "skip", "unresolved"];
export type ImportCellCorrectionInput = { readonly columnNumber: number; readonly value: string };
export type ImportRecordedCorrection = { readonly columnNumber: number; readonly fieldId: ImportFieldId; readonly value: string };
export type ImportCreateDecision = { readonly kind: "create"; readonly rowNumber: number; readonly verdict: ImportRowVerdict; readonly corrections: readonly ImportRecordedCorrection[] };
export type ImportReuseDecision = { readonly kind: "reuse"; readonly rowNumber: number; readonly verdict: ImportRowVerdict; readonly candidate: ImportMatchReference; readonly corrections: readonly ImportRecordedCorrection[] };
export type ImportSkipDecision = { readonly kind: "skip"; readonly rowNumber: number; readonly verdict: ImportRowVerdict; readonly workerReason: string; readonly rowProblem: string | null };
export type ImportUnresolvedDecision = { readonly kind: "unresolved"; readonly rowNumber: number; readonly verdict: ImportRowVerdict };
export type ImportRowDecision = ImportCreateDecision | ImportReuseDecision | ImportSkipDecision | ImportUnresolvedDecision;
export type ImportCreateDecisionInput = { readonly kind: "create"; readonly rowNumber: number; readonly corrections?: readonly ImportCellCorrectionInput[] };
export type ImportReuseDecisionInput = { readonly kind: "reuse"; readonly rowNumber: number; readonly candidate: ImportMatchReference; readonly corrections?: readonly ImportCellCorrectionInput[] };
export type ImportSkipDecisionInput = { readonly kind: "skip"; readonly rowNumber: number; readonly reason?: string };
export type ImportUnresolvedDecisionInput = { readonly kind: "unresolved"; readonly rowNumber: number };
export type ImportDecisionInput = ImportCreateDecisionInput | ImportReuseDecisionInput | ImportSkipDecisionInput | ImportUnresolvedDecisionInput;
export type ImportDecisionEcho = { readonly kind: ImportDecisionKind; readonly rowNumber: number; readonly corrections: readonly ImportCellCorrectionInput[]; readonly candidate: ImportMatchReference | null; readonly reason: string };
/** The one input shape a client posts for a decision of this kind, carrying only the members that kind takes. */
const DECISION_INPUT_BUILDERS: Readonly<Record<ImportDecisionKind, (echo: ImportDecisionEcho) => ImportDecisionInput>> = {
  create: (echo) => ({ kind: "create", rowNumber: echo.rowNumber, corrections: echo.corrections }),
  reuse: (echo) => (echo.candidate === null ? { kind: "unresolved", rowNumber: echo.rowNumber } : { kind: "reuse", rowNumber: echo.rowNumber, candidate: { ...echo.candidate }, corrections: echo.corrections }),
  skip: (echo) => ({ kind: "skip", rowNumber: echo.rowNumber, reason: echo.reason }),
  unresolved: (echo) => ({ kind: "unresolved", rowNumber: echo.rowNumber }),
};
export const decisionInputOf = (echo: ImportDecisionEcho): ImportDecisionInput => DECISION_INPUT_BUILDERS[echo.kind](echo);
/** The input that records a decision this import already holds, so a read publishes exactly what acceptance takes. */
export const recordedDecisionInputOf = (decision: ImportRowDecision): ImportDecisionInput =>
  decisionInputOf({
    kind: decision.kind,
    rowNumber: decision.rowNumber,
    corrections: decision.kind === "create" || decision.kind === "reuse" ? decision.corrections.map((correction) => ({ columnNumber: correction.columnNumber, value: correction.value })) : [],
    candidate: decision.kind === "reuse" ? decision.candidate : null,
    reason: decision.kind === "skip" ? decision.workerReason : "",
  });
export type ImportFileFingerprint = { readonly checksum: string; readonly columnCount: number; readonly dataRowCount: number };
export type ImportDecisionSet = { readonly fingerprint: ImportFileFingerprint; readonly decisions: readonly ImportRowDecision[] };
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
export type ImportDecisionRefusal = { readonly code: ImportDecisionRefusalCode; readonly rowNumber: number | null; readonly columnNumbers: readonly number[]; readonly message: string };
const refusalOf = (code: ImportDecisionRefusalCode, rowNumber: number | null, columnNumbers: readonly number[], message: string): ImportDecisionRefusal => ({ code, rowNumber, columnNumbers, message });
export type ImportDecisionContext = { readonly file: ParsedCsvFile; readonly mapping: ImportConfirmedMapping; readonly validation: ImportValidation; readonly candidates: readonly ImportMatchCandidate[] };
export type ImportRecordDecisionResult = { readonly ok: true; readonly set: ImportDecisionSet; readonly decision: ImportRowDecision; readonly changed: boolean } | { readonly ok: false; readonly refusal: ImportDecisionRefusal };
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
const hex8 = (value: number): string => value.toString(16).padStart(8, "0");
const checksumOf = (text: string): string => `${FINGERPRINT_TAG}-${hex8(hashRound(text, SECOND_SEED, SECOND_PRIME))}${hex8(hashRound(text, FNV_OFFSET, FNV_PRIME))}`;
const framedPart = (part: string): string => `${part.length}:${part}`;
/** The content fingerprint of a parsed file: its headers and every cell in row order, each length framed, hashed once here. */
export function fingerprintOf(file: ParsedCsvFile): ImportFileFingerprint {
  const parts: string[] = [framedPart(String(file.headers.length)), ...file.headers.map((header) => framedPart(header)), framedPart(String(file.rows.length))];
  for (const row of file.rows) {
    parts.push(framedPart(String(row.rowNumber)));
    parts.push(framedPart(String(row.cells.length)));
    for (const cell of row.cells) parts.push(framedPart(cell));
  }
  return { checksum: checksumOf(parts.join(PART_SEPARATOR)), columnCount: file.headers.length, dataRowCount: file.rows.length };
}
export const createDecisionSet = (file: ParsedCsvFile): ImportDecisionSet => ({ fingerprint: fingerprintOf(file), decisions: [] });
const sameFingerprint = (left: ImportFileFingerprint, right: ImportFileFingerprint): boolean => left.checksum === right.checksum && left.columnCount === right.columnCount && left.dataRowCount === right.dataRowCount;
const contextRefusal = (set: ImportDecisionSet, context: ImportDecisionContext): ImportDecisionRefusal | null => staleFileRefusal(set, context.file) ?? contextMismatchRefusal(context);
/** Null when the set describes this exact file, and the `file-changed` refusal when it does not. */
export function staleFileRefusal(set: ImportDecisionSet, file: ParsedCsvFile): ImportDecisionRefusal | null {
  const current = fingerprintOf(file);
  if (sameFingerprint(set.fingerprint, current)) return null;
  const recorded = set.fingerprint;
  return refusalOf(
    "file-changed",
    null,
    [],
    `These decisions were recorded against a different version of this file: it held ${recorded.dataRowCount} data row(s) in ${recorded.columnCount} column(s) then, and holds ${current.dataRowCount} in ${current.columnCount} now. A changed file needs a fresh review, so choose the file again and decide about its rows.`,
  );
}
function contextMismatchRefusal(context: ImportDecisionContext): ImportDecisionRefusal | null {
  const { file, validation } = context;
  if (validation.rows.length === file.rows.length && validation.rows.every((row, index) => file.rows[index]?.rowNumber === row.rowNumber)) return null;
  return { code: "context-mismatch", rowNumber: null, columnNumbers: [], message: `The validation offered for this file describes ${validation.rows.length} row(s) and the file holds ${file.rows.length}. Validate this file again, then decide about its rows.` };
}
const CORRECTION_SCHEMA = z.object({ columnNumber: z.number().int().min(1), value: z.string() });
const REFERENCE_SCHEMA = z.object({ system: z.string().min(1), reference: z.string().min(1) });
const DECISION_INPUT_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), rowNumber: z.number().int().min(1), corrections: z.array(CORRECTION_SCHEMA).optional() }),
  z.object({ kind: z.literal("reuse"), rowNumber: z.number().int().min(1), candidate: REFERENCE_SCHEMA, corrections: z.array(CORRECTION_SCHEMA).optional() }),
  z.object({ kind: z.literal("skip"), rowNumber: z.number().int().min(1), reason: z.string().optional() }),
  z.object({ kind: z.literal("unresolved"), rowNumber: z.number().int().min(1) }),
]);
type ParseFailure = { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] };
/** Records one row's decision, or refuses it with the reason it cannot stand, and returns the set the service persists. */
export function recordDecision(set: ImportDecisionSet, input: ImportDecisionInput, context: ImportDecisionContext): ImportRecordDecisionResult {
  const parsed = DECISION_INPUT_SCHEMA.safeParse(input);
  if (!parsed.success) return { ok: false, refusal: unreadableDecisionRefusal(parsed.error) };
  const refused = contextRefusal(set, context);
  if (refused !== null) return { ok: false, refusal: refused };
  const data = parsed.data;
  const rowNumber = data.rowNumber;
  const row = context.file.rows.find((candidate) => candidate.rowNumber === rowNumber);
  const validated = context.validation.rows.find((candidate) => candidate.rowNumber === rowNumber);
  if (row === undefined || validated === undefined) return { ok: false, refusal: rowNotFoundRefusal(rowNumber, context.file.rows.length) };
  if (data.kind === "unresolved") return withDecision(set, { kind: "unresolved", rowNumber, verdict: validated.verdict });
  if (data.kind === "skip") return withDecision(set, { kind: "skip", rowNumber, verdict: validated.verdict, workerReason: (data.reason ?? "").trim(), rowProblem: rowProblemOf(validated) });
  const corrections = data.corrections ?? [];
  const checked = checkCorrections(corrections, row, validated, context);
  if (!checked.ok) return { ok: false, refusal: checked.refusal };
  const revalidated = revalidateRow(row, corrections, validated, context);
  if (revalidated === null) return { ok: false, refusal: correctionNotCheckedRefusal(rowNumber) };
  if (revalidated.verdict === "needs-correction") return { ok: false, refusal: corrections.length === 0 ? rowNeedsCorrectionRefusal(rowNumber, revalidated) : correctionNotClearingRefusal(rowNumber, revalidated) };
  if (data.kind === "reuse") {
    const suggestions = suggestMatches(revalidated, context.candidates).suggestions;
    if (suggestions.length === 0) return { ok: false, refusal: noReusableCandidateRefusal(rowNumber) };
    if (!suggestions.some((candidate) => sameReference(candidate.reference, data.candidate))) return { ok: false, refusal: candidateNotSuggestedRefusal(rowNumber, suggestions.length) };
    return withDecision(set, { kind: "reuse", rowNumber, verdict: revalidated.verdict, candidate: { system: data.candidate.system, reference: data.candidate.reference }, corrections: checked.corrections });
  }
  return withDecision(set, { kind: "create", rowNumber, verdict: revalidated.verdict, corrections: checked.corrections });
}
function withDecision(set: ImportDecisionSet, decision: ImportRowDecision): ImportRecordDecisionResult {
  const standing = set.decisions.find((candidate) => candidate.rowNumber === decision.rowNumber);
  if (standing !== undefined && JSON.stringify(standing) === JSON.stringify(decision)) return { ok: true, set, decision: standing, changed: false };
  const decisions = set.decisions
    .filter((candidate) => candidate.rowNumber !== decision.rowNumber)
    .concat(decision)
    .sort((left, right) => left.rowNumber - right.rowNumber);
  return { ok: true, set: { fingerprint: set.fingerprint, decisions }, decision, changed: true };
}
const sameReference = (left: ImportMatchReference, right: ImportMatchReference): boolean => left.system === right.system && left.reference === right.reference;
function rowProblemOf(validated: ImportValidatedRow): string | null {
  const issue = validated.issues[0];
  if (issue !== undefined) return issue.message;
  const fault = validated.faults[0];
  return fault !== undefined ? fault.message : null;
}
const problemCountOf = (validated: ImportValidatedRow): number => validated.issues.length + validated.faults.length;
function problemColumnsOf(validated: ImportValidatedRow): number[] {
  const named = [...validated.issues.map((issue) => issue.columnNumber), ...validated.faults.map((fault) => fault.columnNumber)];
  return [...new Set(named.flatMap((columnNumber) => (columnNumber === null ? [] : [columnNumber])))].sort((left, right) => left - right);
}
function unreadableDecisionRefusal(error: ParseFailure): ImportDecisionRefusal {
  const places = [...new Set(error.issues.map((issue) => issue.path.map((part) => String(part)).join(".")).filter((place) => place.length > 0))];
  const where = places.length === 0 ? "its own shape" : places.join(", ");
  const first = error.issues[0];
  return { code: "decision-invalid", rowNumber: null, columnNumbers: [], message: `This decision could not be read at ${where}${first === undefined ? "" : `: ${first.message}`}. A decision names one data row of this file and what to do with that row.` };
}
const rowNotFoundRefusal = (rowNumber: number, rowCount: number): ImportDecisionRefusal => refusalOf("row-not-found", rowNumber, [], `Row ${rowNumber} is not one of this file's ${rowCount} data row(s). Decide about a row the file actually holds.`);
const rowNeedsCorrectionRefusal = (rowNumber: number, validated: ImportValidatedRow): ImportDecisionRefusal =>
  refusalOf("row-needs-correction", rowNumber, problemColumnsOf(validated), `Row ${rowNumber} cannot be accepted as it stands: it has ${problemCountOf(validated)} problem(s). ${rowProblemOf(validated) ?? ""} Correct the cell and decide again, or skip the row.`);
const correctionNotClearingRefusal = (rowNumber: number, validated: ImportValidatedRow): ImportDecisionRefusal =>
  refusalOf("correction-not-clearing", rowNumber, problemColumnsOf(validated), `Row ${rowNumber} was corrected and still has ${problemCountOf(validated)} problem(s) that stop it being accepted. ${rowProblemOf(validated) ?? ""} Supply a correction for every cell named there, or skip the row.`);
const correctionNotCheckedRefusal = (rowNumber: number): ImportDecisionRefusal => refusalOf("correction-not-clearing", rowNumber, [], `Row ${rowNumber} could not be re-checked after the correction, so it cannot be accepted as corrected. Choose the file again and confirm the mapping for it.`);
const noReusableCandidateRefusal = (rowNumber: number): ImportDecisionRefusal => refusalOf("no-reusable-candidate", rowNumber, [], `Row ${rowNumber} shares no usable value with a contact you can reuse, so there is nothing to attach it to. Create a new private entry for this row instead, or skip it.`);
const candidateNotSuggestedRefusal = (rowNumber: number, offeredCount: number): ImportDecisionRefusal =>
  refusalOf("candidate-not-suggested", rowNumber, [], `Row ${rowNumber} was offered ${offeredCount} contact(s) it could reuse, and that reference is not one of them. Choose one of the contacts proposed for this row, create a new private entry, or skip it.`);
type CorrectionCheck = { readonly ok: true; readonly corrections: readonly ImportRecordedCorrection[] } | { readonly ok: false; readonly refusal: ImportDecisionRefusal };
const refusedCorrection = (code: ImportDecisionRefusalCode, rowNumber: number, columnNumbers: readonly number[], message: string): CorrectionCheck => ({ ok: false, refusal: refusalOf(code, rowNumber, columnNumbers, message) });
function checkCorrections(input: readonly ImportCellCorrectionInput[], row: ParsedCsvRow, validated: ImportValidatedRow, context: ImportDecisionContext): CorrectionCheck {
  const byColumn = new Map<number, string>();
  for (const correction of input) {
    if (byColumn.has(correction.columnNumber)) return refusedCorrection("correction-duplicated", row.rowNumber, [correction.columnNumber], `Column ${correction.columnNumber} was corrected twice in one decision. Supply one corrected value per column.`);
    byColumn.set(correction.columnNumber, correction.value);
  }
  const fixable = fixableColumnsOf(validated);
  const recorded: ImportRecordedCorrection[] = [];
  for (const columnNumber of [...byColumn.keys()].sort((left, right) => left - right)) {
    const value = byColumn.get(columnNumber);
    if (value === undefined) continue;
    if (columnNumber > row.cells.length) {
      return refusedCorrection("correction-target-unknown", row.rowNumber, [columnNumber], `Column ${columnNumber} is not a cell of row ${row.rowNumber}, which holds ${row.cells.length} cell(s) while the header names ${context.file.headers.length} column(s). Correct a cell the row actually has.`);
    }
    const fieldId = fieldAtColumn(context.mapping, columnNumber);
    if (fieldId === null) {
      const header = headerAt(context.file.headers, columnNumber);
      return refusedCorrection("correction-target-unmapped", row.rowNumber, [columnNumber], `Column ${columnNumber} ("${header}") supplies no contact field in the confirmed mapping, so correcting it would change nothing about this row.`);
    }
    if (!fixable.has(columnNumber)) return refusedCorrection("correction-not-needed", row.rowNumber, [columnNumber], `Column ${columnNumber} has no problem on row ${row.rowNumber}, so there is nothing to correct there. Correct only the cells the file could not use, or skip the row.`);
    const measured = codePointCount(value);
    if (measured > IMPORT_MAX_CELL_CODE_POINTS) return refusedCorrection("correction-not-clearing", row.rowNumber, [columnNumber], `The corrected value for column ${columnNumber} is ${measured} characters long; the limit is ${IMPORT_MAX_CELL_CODE_POINTS} characters per cell. Shorten it, or skip this row.`);
    recorded.push({ columnNumber, fieldId, value });
  }
  return { ok: true, corrections: recorded };
}
function fixableColumnsOf(validated: ImportValidatedRow): ReadonlySet<number> {
  const fixable = new Set<number>();
  for (const issue of validated.issues) if (issue.columnNumber !== null) fixable.add(issue.columnNumber);
  for (const fault of validated.faults) if (fault.kind === "cell-too-long" && fault.columnNumber !== null) fixable.add(fault.columnNumber);
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
  const revalidated = validateRows({ ...context.file, rows: [{ rowNumber: row.rowNumber, cells }], dataRowCount: 1, rowFaults: faults }, context.mapping);
  return revalidated.rows[0] ?? null;
}
const fieldAtColumn = (mapping: ImportConfirmedMapping, columnNumber: number): ImportFieldId | null => mapping.assignments.find((candidate) => candidate.columnIndex === columnNumber)?.fieldId ?? null;
const headerAt = (headers: readonly string[], columnNumber: number): string => headers[columnNumber - 1] ?? "";
const codePointCount = (value: string): number => [...value].length;
export type ImportBlockingReasonCode = ImportIssueCode | ImportRowFaultKind | "reuse-not-offered";
const BLOCKING_REASON_ORDER: readonly ImportBlockingReasonCode[] = ["name-missing", "email-not-complete", "phone-not-a-number", "postal-not-an-address", "ragged-row", "cell-too-long", "reuse-not-offered"];
const BLOCKING_REASON_LABELS: Readonly<Record<ImportBlockingReasonCode, string>> = {
  "name-missing": "No name supplied",
  "email-not-complete": "Email is not one complete address",
  "phone-not-a-number": "Phone is not a number",
  "postal-not-an-address": "Postal address holds no letters and no digits",
  "ragged-row": "The row does not line up with the header",
  "cell-too-long": "A cell is longer than the limit",
  "reuse-not-offered": "The contact chosen for reuse is no longer offered",
};
export type ImportDecisionCounts = { readonly create: number; readonly reuse: number; readonly skip: number; readonly unresolved: number; readonly total: number };
export type ImportBlockedReasonCount = { readonly code: ImportBlockingReasonCode; readonly label: string; readonly count: number };
export type ImportCorrectionCount = { readonly fieldId: ImportFieldId; readonly label: string; readonly count: number };
export type ImportPreservedColumnSummary = { readonly columnNumber: number; readonly header: string; readonly reason: ImportPreservedReason; readonly statesConsent: boolean; readonly cellCount: number };
export type ImportDecisionFacts = { readonly memberships: 0; readonly consentRecords: 0; readonly audienceMembers: 0; readonly preservedColumnsCreateNothing: true };
export type ImportDecisionSummaryRow = { readonly rowNumber: number; readonly decisionKind: ImportDecisionKind; readonly verdict: ImportRowVerdict; readonly blockedReasons: readonly ImportBlockingReasonCode[]; readonly correctedFields: readonly ImportFieldId[] };
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
type PreservedColumnTally = { columnNumber: number; header: string; reason: ImportPreservedReason; statesConsent: boolean; cellCount: number };
/** Counts the decision set against the file it belongs to, refusing rather than describing a file the set was not taken against. */
export function summariseDecisions(set: ImportDecisionSet, context: ImportDecisionContext): ImportSummaryResult {
  const refused = contextRefusal(set, context);
  if (refused !== null) return { ok: false, refusal: refused };
  const decisionByRow = new Map<number, ImportRowDecision>();
  for (const decision of set.decisions) decisionByRow.set(decision.rowNumber, decision);
  const kindCounts: Record<ImportDecisionKind, number> = { create: 0, reuse: 0, skip: 0, unresolved: 0 };
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
    const effective = effectiveRowOf(validated, decision, context);
    const blockedReasons = blockedReasonsOf(effective, decision, context.candidates);
    for (const reason of blockedReasons) blockedCounts.set(reason, (blockedCounts.get(reason) ?? 0) + 1);
    const correctedFields: ImportFieldId[] = [];
    if (decision !== undefined && (decision.kind === "create" || decision.kind === "reuse")) {
      for (const correction of decision.corrections) {
        correctionCount += 1;
        correctionCounts.set(correction.fieldId, (correctionCounts.get(correction.fieldId) ?? 0) + 1);
        if (!correctedFields.includes(correction.fieldId)) correctedFields.push(correction.fieldId);
      }
    }
    restrictionsPreserved += validated.restrictions.length;
    if (decisionKind === "create" || decisionKind === "reuse") restrictionsCarried += validated.restrictions.length;
    tallyPreservedColumns(preservedColumns, validated);
    rows.push({ rowNumber: validated.rowNumber, decisionKind, verdict: effective.verdict, blockedReasons, correctedFields: IMPORT_FIELD_IDS.filter((fieldId) => correctedFields.includes(fieldId)) });
  }
  const blockedReasons = countedEntries(BLOCKING_REASON_ORDER, blockedCounts, (code, count) => ({ code, label: BLOCKING_REASON_LABELS[code], count }));
  const corrections = countedEntries(IMPORT_FIELD_IDS, correctionCounts, (fieldId, count) => ({ fieldId, label: labelOf(fieldId), count }));
  const preserved = [...preservedColumns.values()].sort((left, right) => left.columnNumber - right.columnNumber).map((column) => ({ ...column }));
  const summary: ImportDecisionSummary = {
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
    facts: { memberships: 0, consentRecords: 0, audienceMembers: 0, preservedColumnsCreateNothing: true },
    rows,
  };
  return { ok: true, summary };
}
function countedEntries<Key, Entry>(order: readonly Key[], counts: ReadonlyMap<Key, number>, entry: (key: Key, count: number) => Entry): Entry[] {
  return order.flatMap((key) => {
    const count = counts.get(key);
    return count === undefined ? [] : [entry(key, count)];
  });
}
function effectiveRowOf(validated: ImportValidatedRow, decision: ImportRowDecision | undefined, context: ImportDecisionContext): ImportValidatedRow {
  if (decision === undefined) return validated;
  if (decision.kind !== "create" && decision.kind !== "reuse") return validated;
  if (decision.corrections.length === 0) return validated;
  const row = context.file.rows.find((candidate) => candidate.rowNumber === validated.rowNumber);
  if (row === undefined) return validated;
  const corrections = decision.corrections.map((correction) => ({ columnNumber: correction.columnNumber, value: correction.value }));
  return revalidateRow(row, corrections, validated, context) ?? validated;
}
function blockedReasonsOf(validated: ImportValidatedRow, decision: ImportRowDecision | undefined, candidates: readonly ImportMatchCandidate[]): ImportBlockingReasonCode[] {
  if (decision !== undefined && decision.kind === "skip") return [];
  const found = new Set<ImportBlockingReasonCode>();
  if (validated.verdict === "needs-correction") {
    for (const issue of validated.issues) found.add(issue.code);
    for (const fault of validated.faults) found.add(fault.kind);
  }
  if (decision !== undefined && decision.kind === "reuse") {
    const suggestions = suggestMatches(validated, candidates).suggestions;
    if (!suggestions.some((candidate) => sameReference(candidate.reference, decision.candidate))) found.add("reuse-not-offered");
  }
  return BLOCKING_REASON_ORDER.filter((code) => found.has(code));
}
function tallyPreservedColumns(columns: Map<number, PreservedColumnTally>, validated: ImportValidatedRow): void {
  for (const cell of validated.preservedCells) {
    if (cell.reason === "blank-cell" || cell.reason === "rejected-value") continue;
    const held = columns.get(cell.columnNumber);
    if (held === undefined) {
      columns.set(cell.columnNumber, { columnNumber: cell.columnNumber, header: cell.header, reason: cell.reason, statesConsent: cell.statesConsent, cellCount: 1 });
      continue;
    }
    held.cellCount += 1;
  }
}
const labelOf = (fieldId: ImportFieldId): string => IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId)?.label ?? fieldId;
