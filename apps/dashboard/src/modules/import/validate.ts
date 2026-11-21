/**
 * Contact import, step three: turn the parsed rows and the confirmed mapping into per-row validation
 * state with a readable reason for every problem, and propose existing partners for reuse as
 * suggestions only.
 */
import { z } from "zod";
import type { ImportConfirmedMapping, ImportContactKind, ImportFieldId, ImportIgnoredColumn } from "./map";
import { IMPORT_FIELD_IDS, IMPORT_FIELD_VOCABULARY } from "./map";
import type { ImportRowFault, ParsedCsvFile, ParsedCsvRow } from "./parse";
// Phase A: the row's verdict, in this module's own vocabulary
/** What a row is, as far as this step can tell: correctable, or ready to be decided about. */
export type ImportRowVerdict = "ready" | "needs-correction";
/** Why a mapped value cannot be used as it stands. */
export type ImportIssueCode = "name-missing" | "email-not-complete" | "phone-not-a-number" | "postal-not-an-address";
/** One problem with one mapped value, addressed to the row and column the worker can look at. */
export interface ImportFieldIssue {
  readonly rowNumber: number;
  readonly code: ImportIssueCode;
  readonly fieldId: ImportFieldId;
  readonly label: string;
  readonly columnNumber: number | null;
  readonly header: string | null;
  readonly value: string | null;
  readonly message: string;
}
/** A cell that supplied a usable value, with the field it supplies and where it sits. */
export interface ImportMappedCell {
  readonly columnNumber: number;
  readonly header: string;
  readonly fieldId: ImportFieldId;
  readonly contactKind: ImportContactKind | null;
  readonly value: string;
}
/** Why a parsed cell supplied no value. */
export type ImportPreservedReason = "blank-cell" | "rejected-value" | "consent-preserved" | "excluded-topic" | "unmapped-column";
/** A parsed cell that supplied no value, kept so the row can be corrected and shown in full. */
export interface ImportPreservedCell {
  readonly columnNumber: number;
  readonly header: string;
  readonly text: string;
  readonly reason: ImportPreservedReason;
  readonly statesConsent: boolean;
  readonly message: string;
}
/** A contact restriction exactly as the file stated it. */
export interface ImportRestriction {
  readonly columnNumber: number;
  readonly header: string;
  readonly kind: "imported-restriction";
  readonly text: string;
}
/** A tag value as the file supplied it, trimmed for display and otherwise unaltered. */
export interface ImportTag {
  readonly columnNumber: number;
  readonly header: string;
  readonly text: string;
}
/** How a row's cells divide. */
export interface ImportCellAccounting {
  readonly parsed: number;
  readonly mapped: number;
  readonly preserved: number;
}
/** One data row after validation, in file order and keyed by the row number `parse.ts` assigned. */
export interface ImportValidatedRow {
  readonly rowNumber: number;
  readonly verdict: ImportRowVerdict;
  readonly suppliedFields: readonly ImportFieldId[];
  readonly mappedCells: readonly ImportMappedCell[];
  readonly preservedCells: readonly ImportPreservedCell[];
  readonly restrictions: readonly ImportRestriction[];
  readonly tags: readonly ImportTag[];
  readonly issues: readonly ImportFieldIssue[];
  readonly faults: readonly ImportRowFault[];
  readonly cellAccounting: ImportCellAccounting;
}
/** A mapping that could not be applied to this file, reported once rather than per row. */
export type ImportValidationProblemCode = "mapping-column-missing" | "mapping-column-shared" | "mapping-column-excluded";
/** A defect in the confirmed mapping itself, which validates no row and silently supplies nothing. */
export interface ImportValidationProblem {
  readonly code: ImportValidationProblemCode;
  readonly columnNumber: number;
  readonly message: string;
}
/** What the review step shows above the rows: how many are ready, and what the cells added up to. */
export interface ImportValidationCounts {
  readonly ready: number;
  readonly needsCorrection: number;
  readonly parsedCells: number;
  readonly mappedCells: number;
  readonly preservedCells: number;
  readonly consentMarkedCells: number;
  readonly restrictions: number;
  readonly tags: number;
}
/** The whole file after validation: its fields, one entry per data row, its counts and any problem. */
export interface ImportValidation {
  readonly fields: readonly ImportFieldId[];
  readonly rows: readonly ImportValidatedRow[];
  readonly counts: ImportValidationCounts;
  readonly problems: readonly ImportValidationProblem[];
}
// Shared internals: the vocabulary, read once
const DESCRIPTOR_BY_FIELD = new Map(IMPORT_FIELD_VOCABULARY.map((field) => [field.id, field]));

const NAME_FIELDS: ReadonlySet<ImportFieldId> = new Set<ImportFieldId>(["display-name", "name-given", "name-family", "name-organization"]);

const MATCH_SIGNAL_FIELDS: readonly {
  readonly fieldId: ImportFieldId;
  readonly kind: ImportMatchSignalKind;
}[] = [
  { fieldId: "contact-email", kind: "email" },
  { fieldId: "contact-phone", kind: "phone" },
  { fieldId: "source-reference", kind: "source-reference" },
];
const CONSENT_HEADER_WORDS: readonly string[] = [
  "subscribed",
  "unsubscribed",
  "subscribe",
  "unsubscribe",
  "subscription",
  "subscriptions",
  "consent",
  "consents",
  "consented",
  "permission",
  "optin",
  "optout",
  "opted",
  "newsletter",
  "marketing",
];
const EMAIL_MAX_LENGTH = 254;

const DIGIT = /\p{Nd}/u;

const LETTER = /\p{L}/u;

const WHITESPACE = /\s/u;

const CONTROL = /\p{Cc}/u;

const DOMAIN = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u;

const COMBINING_MARKS = /\p{M}+/gu;

const NON_WORD = /[^\p{L}\p{N}]+/u;

function labelOf(fieldId: ImportFieldId): string {
  return DESCRIPTOR_BY_FIELD.get(fieldId)?.label ?? fieldId;
}
function contactKindOf(fieldId: ImportFieldId): ImportContactKind | null {
  return DESCRIPTOR_BY_FIELD.get(fieldId)?.contactKind ?? null;
}
// Phase A: the validation pass
/** Validates every data row of a parsed file against a confirmed mapping, returning one entry per row in file order and keyed by the row number `parse.ts` assigned: the value or a readable. */
export function validateRows(parsed: ParsedCsvFile, confirmedMapping: ImportConfirmedMapping): ImportValidation {
  const problems: ImportValidationProblem[] = [];
  const ignoredByColumn = new Map(confirmedMapping.ignored.map((column) => [column.index, column] as const));
  const fields = orderedFields(confirmedMapping);
  const assignments = assignmentsByColumn(parsed, confirmedMapping, ignoredByColumn, problems);
  const faultsByRow = faultsByRowNumber(parsed.rowFaults);
  const rows = parsed.rows.map((row) =>
    validateRow(row, {
      headers: parsed.headers,
      fields,
      assignments,
      ignoredByColumn,
      faults: faultsByRow.get(row.rowNumber) ?? [],
    }),
  );
  return { fields, rows, counts: countsOf(rows), problems };
}
interface RowContext {
  readonly headers: readonly string[];
  readonly fields: readonly ImportFieldId[];
  readonly assignments: ReadonlyMap<number, ImportFieldId>;
  readonly ignoredByColumn: ReadonlyMap<number, ImportIgnoredColumn>;
  readonly faults: readonly ImportRowFault[];
}
function validateRow(row: ParsedCsvRow, context: RowContext): ImportValidatedRow {
  const mappedCells: ImportMappedCell[] = [];
  const preservedCells: ImportPreservedCell[] = [];
  const issues: ImportFieldIssue[] = [];
  const restrictions: ImportRestriction[] = [];
  const tags: ImportTag[] = [];
  row.cells.forEach((cell, offset) => {
    const columnNumber = offset + 1;
    const header = headerAt(context.headers, columnNumber);
    const fieldId = context.assignments.get(columnNumber);
    if (fieldId === undefined) {
      preservedCells.push(preservedOfUnmapped(columnNumber, header, cell, context.ignoredByColumn.get(columnNumber)));
      return;
    }
    const trimmed = cell.trim();
    if (trimmed.length === 0) {
      preservedCells.push({
        columnNumber,
        header,
        text: cell,
        reason: "blank-cell",
        statesConsent: false,
        message: `This cell is empty, so "${labelOf(fieldId)}" gets no value from row ${row.rowNumber}. The row keeps its place and no value is invented for it.`,
      });
      return;
    }
    const problem = valueProblem(fieldId, trimmed);
    if (problem !== null) {
      issues.push({
        rowNumber: row.rowNumber,
        code: problem.code,
        fieldId,
        label: labelOf(fieldId),
        columnNumber,
        header,
        value: cell,
        message: `Row ${row.rowNumber}, column ${columnNumber} ("${header}"): "${trimmed}" is ${problem.what}: ${problem.detail}. Correct the value in the file and choose the file again, or skip this row.`,
      });
      preservedCells.push({
        columnNumber,
        header,
        text: cell,
        reason: "rejected-value",
        statesConsent: false,
        message: `Kept exactly as it arrived so row ${row.rowNumber} can be corrected: "${trimmed}" is ${problem.what}: ${problem.detail}.`,
      });
      return;
    }
    const contactKind = contactKindOf(fieldId);
    mappedCells.push({ columnNumber, header, fieldId, contactKind, value: cell });
    if (fieldId === "restriction") {
      restrictions.push({ columnNumber, header, kind: "imported-restriction", text: cell });
    }
    if (fieldId === "tag") {
      tags.push({ columnNumber, header, text: trimmed });
    }
  });
  const nameIssue = nameIssueFor(row, context, mappedCells);
  if (nameIssue !== null) issues.push(nameIssue);
  return {
    rowNumber: row.rowNumber,
    verdict: issues.length === 0 && context.faults.length === 0 ? "ready" : "needs-correction",
    suppliedFields: context.fields,
    mappedCells,
    preservedCells,
    restrictions,
    tags,
    issues,
    faults: context.faults,
    cellAccounting: {
      parsed: row.cells.length,
      mapped: mappedCells.length,
      preserved: preservedCells.length,
    },
  };
}
function nameIssueFor(row: ParsedCsvRow, context: RowContext, mappedCells: readonly ImportMappedCell[]): ImportFieldIssue | null {
  const suppliesNameField = context.fields.some((fieldId) => NAME_FIELDS.has(fieldId));
  if (!suppliesNameField) return null;
  if (mappedCells.some((cell) => NAME_FIELDS.has(cell.fieldId))) return null;
  const nameField = context.fields.find((fieldId) => NAME_FIELDS.has(fieldId));
  const columnNumber = nameField === undefined ? null : columnNumberFor(context.assignments, nameField);
  return {
    rowNumber: row.rowNumber,
    code: "name-missing",
    fieldId: nameField ?? "display-name",
    label: nameField === undefined ? labelOf("display-name") : labelOf(nameField),
    columnNumber,
    header: columnNumber === null ? null : headerAt(context.headers, columnNumber),
    value: null,
    message: `Row ${row.rowNumber} supplies no name: give it a display name, or a given name and a family name, or an organization name. Correct the row in the file and choose the file again, or skip this row.`,
  };
}
interface ValueProblem {
  readonly code: ImportIssueCode;
  readonly what: string;
  readonly detail: string;
}
function valueProblem(fieldId: ImportFieldId, value: string): ValueProblem | null {
  if (fieldId === "contact-email") {
    const detail = emailDetail(value);
    return detail === null ? null : { code: "email-not-complete", what: "not a complete email address", detail };
  }
  if (fieldId === "contact-phone") {
    const detail = phoneDetail(value);
    return detail === null ? null : { code: "phone-not-a-number", what: "not a phone number", detail };
  }
  if (fieldId === "contact-postal") {
    const detail = postalDetail(value);
    return detail === null ? null : { code: "postal-not-an-address", what: "not a postal address", detail };
  }
  return null;
}
function emailDetail(value: string): string | null {
  if (WHITESPACE.test(value)) return "it contains a space, so it may hold more than one address";
  if (CONTROL.test(value)) return "it contains a control character";
  const at = value.indexOf("@");
  if (at === -1) return "it has no @";
  if (value.indexOf("@", at + 1) !== -1) return "it has more than one @";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0) return "it has nothing before the @";
  if (domain.length === 0) return "it has nothing after the @";
  if (!domain.includes(".")) return "its domain has no dot";
  if (!DOMAIN.test(domain)) {
    return "its domain has an empty part, or a part that begins or ends with a hyphen";
  }
  if (value.length > EMAIL_MAX_LENGTH) {
    return `it is ${value.length} characters long, and an address is at most ${EMAIL_MAX_LENGTH}`;
  }
  return null;
}
function phoneDetail(value: string): string | null {
  if (!DIGIT.test(value)) return "it has no digits";
  if (LETTER.test(value)) return "it contains letters, so it may be a note rather than a number";
  if (CONTROL.test(value)) return "it contains a control character";
  return null;
}
function postalDetail(value: string): string | null {
  if (!LETTER.test(value) && !DIGIT.test(value)) return "it holds no letters and no digits";
  return null;
}
function preservedOfUnmapped(columnNumber: number, header: string, text: string, ignored: ImportIgnoredColumn | undefined): ImportPreservedCell {
  const statesConsent = columnStatesConsent(header, ignored);
  const reason: ImportPreservedReason = statesConsent ? "consent-preserved" : ignored?.reason === "excluded-topic" ? "excluded-topic" : "unmapped-column";
  const message = statesConsent
    ? `Kept exactly as it arrived and never read as consent: "${header}" states a subscription or consent, which this import does not use. Importing this row subscribes nobody and creates no audience membership.`
    : (ignored?.message ?? "This column is not part of the confirmed mapping, so its value is kept as data and supplies no contact field.");
  return { columnNumber, header, text, reason, statesConsent, message };
}
function columnStatesConsent(header: string, ignored: ImportIgnoredColumn | undefined): boolean {
  return ignored?.reason === "consent-preserved-as-data" || looksLikeConsentHeader(header);
}
function looksLikeConsentHeader(header: string): boolean {
  const words = header
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .split(NON_WORD)
    .filter((word) => word.length > 0);
  return words.some((word) => CONSENT_HEADER_WORDS.includes(word));
}
function orderedFields(mapping: ImportConfirmedMapping): ImportFieldId[] {
  const supplied = new Set<ImportFieldId>(mapping.fields);
  return IMPORT_FIELD_IDS.filter((fieldId) => supplied.has(fieldId));
}
function assignmentsByColumn(
  parsed: ParsedCsvFile,
  mapping: ImportConfirmedMapping,
  ignoredByColumn: ReadonlyMap<number, ImportIgnoredColumn>,
  problems: ImportValidationProblem[],
): Map<number, ImportFieldId> {
  const byColumn = new Map<number, ImportFieldId>();
  for (const assignment of mapping.assignments) {
    const { columnIndex, fieldId } = assignment;
    if (!Number.isInteger(columnIndex) || columnIndex < 1 || columnIndex > parsed.columnCount) {
      problems.push({
        code: "mapping-column-missing",
        columnNumber: columnIndex,
        message: `The mapping supplies "${labelOf(fieldId)}" from column ${columnIndex}, and this file has ${parsed.columnCount} column(s). Choose the file again and confirm the mapping for it.`,
      });
      continue;
    }
    const taken = byColumn.get(columnIndex);
    if (taken !== undefined) {
      if (taken !== fieldId) {
        problems.push({
          code: "mapping-column-shared",
          columnNumber: columnIndex,
          message: `Column ${columnIndex} is assigned to both "${labelOf(taken)}" and "${labelOf(fieldId)}"; only "${labelOf(taken)}" is read from it.`,
        });
      }
      continue;
    }
    const ignored = ignoredByColumn.get(columnIndex);
    const header = headerAt(parsed.headers, columnIndex);
    const blocked = columnStatesConsent(header, ignored) || ignored?.reason === "blank-header" || ignored?.reason === "excluded-topic";
    if (blocked) {
      problems.push({
        code: "mapping-column-excluded",
        columnNumber: columnIndex,
        message: `Column ${columnIndex} ("${header}") cannot supply "${labelOf(fieldId)}", so it supplies nothing on any row: ${ignored?.message ?? "the column may not be mapped."}`,
      });
      continue;
    }
    byColumn.set(columnIndex, fieldId);
  }
  return byColumn;
}
function faultsByRowNumber(faults: readonly ImportRowFault[]): ReadonlyMap<number, readonly ImportRowFault[]> {
  const byRow = new Map<number, ImportRowFault[]>();
  for (const fault of faults) {
    const existing = byRow.get(fault.rowNumber);
    if (existing === undefined) byRow.set(fault.rowNumber, [fault]);
    else existing.push(fault);
  }
  return byRow;
}
function countsOf(rows: readonly ImportValidatedRow[]): ImportValidationCounts {
  let ready = 0;
  let needsCorrection = 0;
  let parsedCells = 0;
  let mappedCells = 0;
  let preservedCells = 0;
  let consentMarkedCells = 0;
  let restrictions = 0;
  let tags = 0;
  for (const row of rows) {
    if (row.verdict === "ready") ready += 1;
    else needsCorrection += 1;
    parsedCells += row.cellAccounting.parsed;
    mappedCells += row.cellAccounting.mapped;
    preservedCells += row.cellAccounting.preserved;
    consentMarkedCells += row.preservedCells.filter((cell) => cell.statesConsent).length;
    restrictions += row.restrictions.length;
    tags += row.tags.length;
  }
  return {
    ready,
    needsCorrection,
    parsedCells,
    mappedCells,
    preservedCells,
    consentMarkedCells,
    restrictions,
    tags,
  };
}
function headerAt(headers: readonly string[], columnNumber: number): string {
  return headers[columnNumber - 1] ?? "";
}
function columnNumberFor(assignments: ReadonlyMap<number, ImportFieldId>, fieldId: ImportFieldId): number | null {
  for (const [columnNumber, assigned] of assignments) {
    if (assigned === fieldId) return columnNumber;
  }
  return null;
}
// Phase B: reuse suggestions — a proposal, never a merge
/** An existing record named by an opaque, source-qualified reference; never by a name or an address. */
export interface ImportMatchReference {
  readonly system: string;
  readonly reference: string;
}
/** Why this caller may not reuse an existing identity. */
export type ImportReuseRefusal = "out-of-scope" | "denied" | "archived";
/** Whether an existing identity may be reused by this caller. */
export type ImportReuseFact = { readonly permitted: true } | { readonly permitted: false; readonly reason: ImportReuseRefusal };
/** One existing contact the service offers for comparison, already resolved in the caller's scope. */
export interface ImportMatchCandidate {
  readonly reference: ImportMatchReference;
  readonly visibleFields: readonly ImportFieldId[];
  readonly visibleValues: Readonly<Partial<Record<ImportFieldId, readonly string[]>>>;
  readonly reuse: ImportReuseFact;
}
/** The only signals a suggestion may rest on: values a source system may legitimately repeat. */
export type ImportMatchSignalKind = "email" | "phone" | "source-reference";
/** One value this row and the candidate share, with the kind that made it a signal. */
export interface ImportMatchSignal {
  readonly kind: ImportMatchSignalKind;
  readonly fieldId: ImportFieldId;
  readonly value: string;
}
/** One field the mapping supplies, compared beside the existing value so the difference is visible before acceptance. */
export interface ImportFieldComparison {
  readonly fieldId: ImportFieldId;
  readonly label: string;
  readonly existingState: "readable" | "not-readable";
  readonly existing: readonly string[];
  readonly incoming: readonly string[];
  readonly differs: boolean | null;
  readonly message: string;
}
/** One proposal for one row: the existing contact, the values that matched it, the field-by-field comparison, and the fields that differ. */
export interface ImportMatchSuggestion {
  readonly reference: ImportMatchReference;
  readonly signals: readonly ImportMatchSignal[];
  readonly comparison: readonly ImportFieldComparison[];
  readonly differsOn: readonly ImportFieldId[];
  readonly message: string;
}
/** Every proposal for one row, in a stable order. */
export interface ImportMatchProposal {
  readonly rowNumber: number;
  readonly suggestions: readonly ImportMatchSuggestion[];
}
const SIGNAL_NOUNS: Readonly<Record<ImportMatchSignalKind, string>> = {
  email: "an email address",
  phone: "a phone number",
  "source-reference": "a source reference",
};
const KEY_SEPARATOR = "\u0000";

const CANDIDATE_SCHEMA = z.object({
  reference: z.object({ system: z.string().min(1), reference: z.string().min(1) }),
  visibleFields: z.array(z.string()),
  visibleValues: z.record(z.string(), z.array(z.string())),
  reuse: z.discriminatedUnion("permitted", [
    z.object({ permitted: z.literal(true) }),
    z.object({
      permitted: z.literal(false),
      reason: z.enum(["out-of-scope", "denied", "archived"]),
    }),
  ]),
});
const KNOWN_FIELD_IDS: ReadonlySet<string> = new Set<string>(IMPORT_FIELD_IDS);

interface ReadCandidate {
  readonly reference: ImportMatchReference;
  readonly visibleFields: ReadonlySet<ImportFieldId>;
  readonly visibleValues: ReadonlyMap<ImportFieldId, readonly string[]>;
  readonly reuse: ImportReuseFact;
}
/** Proposes the existing contacts a row could reuse, matching only on an exactly equal contact-method value or source reference and comparing every field the mapping supplies beside the. */
export function suggestMatches(row: ImportValidatedRow, candidates: readonly ImportMatchCandidate[]): ImportMatchProposal {
  const incoming = incomingValues(row);
  const suggestions: ImportMatchSuggestion[] = [];
  for (const offered of candidates) {
    const candidate = readCandidate(offered);
    // A candidate whose shape cannot be read, and a candidate this caller may not reuse, are both
    // dropped without a trace. Reporting either one as "unavailable" would disclose that a record
    // exists outside the caller's authority, which authorisation before enumeration forbids.
    if (candidate === null || !candidate.reuse.permitted) continue;
    const signals = signalsFor(row, candidate);
    if (signals.length === 0) continue;
    const comparison = row.suppliedFields.map((fieldId) => compareField(fieldId, candidate, incoming));
    const differsOn: ImportFieldId[] = [];
    for (const field of comparison) {
      if (field.differs === true) differsOn.push(field.fieldId);
    }
    suggestions.push({
      reference: candidate.reference,
      signals,
      comparison,
      differsOn,
      message: `Row ${row.rowNumber} shares ${phraseList(signals.map((signal) => SIGNAL_NOUNS[signal.kind]))} with a contact already available to you. Nothing has been merged, overwritten or decided: reusing that contact is your choice in the next step.`,
    });
  }
  suggestions.sort(byReference);
  return { rowNumber: row.rowNumber, suggestions };
}
function signalsFor(row: ImportValidatedRow, candidate: ReadCandidate): ImportMatchSignal[] {
  const signals: ImportMatchSignal[] = [];
  const seen = new Set<string>();
  for (const { fieldId, kind } of MATCH_SIGNAL_FIELDS) {
    if (!candidate.visibleFields.has(fieldId)) continue;
    const existing = new Set((candidate.visibleValues.get(fieldId) ?? []).map((value) => comparableValue(kind, value)));
    for (const cell of row.mappedCells) {
      if (cell.fieldId !== fieldId) continue;
      const value = cell.value.trim();
      if (value.length === 0) continue;
      const comparable = comparableValue(kind, value);
      if (!existing.has(comparable)) continue;
      const key = `${kind}${KEY_SEPARATOR}${comparable}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push({ kind, fieldId, value });
    }
  }
  return signals;
}
function compareField(fieldId: ImportFieldId, candidate: ReadCandidate, incoming: ReadonlyMap<ImportFieldId, readonly string[]>): ImportFieldComparison {
  const label = labelOf(fieldId);
  const lower = label.toLowerCase();
  const values = incoming.get(fieldId) ?? [];
  if (!candidate.visibleFields.has(fieldId)) {
    return {
      fieldId,
      label,
      existingState: "not-readable",
      existing: [],
      incoming: values,
      differs: null,
      message: `The existing ${lower} is not shown to you here, so it is not compared and nothing has been changed.`,
    };
  }
  const existing = candidate.visibleValues.get(fieldId) ?? [];
  const differs = !sameValues(existing, values, fieldId);
  const existingShown = phraseList(existing.map((value) => `"${value.trim()}"`));
  const incomingShown = phraseList(values.map((value) => `"${value}"`));
  const base = { fieldId, label, existingState: "readable" as const, existing, incoming: values };
  if (differs) {
    if (existing.length === 0) {
      return {
        ...base,
        differs,
        message: `That contact holds no ${lower}; this row supplies ${incomingShown}. Nothing has been applied.`,
      };
    }
    return {
      ...base,
      differs,
      message: `That contact holds ${existingShown}; this row supplies ${incomingShown}. The difference is shown so you can decide before accepting, and nothing has been applied.`,
    };
  }
  if (values.length === 0) {
    return {
      ...base,
      differs,
      message: `Neither that contact nor this row holds a ${lower}, so there is nothing to compare.`,
    };
  }
  return {
    ...base,
    differs,
    message: `That contact already holds ${existingShown}, the same as this row. Nothing was merged or changed.`,
  };
}
function sameValues(left: readonly string[], right: readonly string[], fieldId: ImportFieldId): boolean {
  const first = uniqueSorted(left.map((value) => normaliseFor(fieldId, value)));
  const second = uniqueSorted(right.map((value) => normaliseFor(fieldId, value)));
  if (first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
}
function normaliseFor(fieldId: ImportFieldId, value: string): string {
  return signalKindOf(fieldId) === "email" ? foldAsciiLower(value.trim()) : value.trim();
}
function signalKindOf(fieldId: ImportFieldId): ImportMatchSignalKind | null {
  const signal = MATCH_SIGNAL_FIELDS.find((candidate) => candidate.fieldId === fieldId);
  return signal === undefined ? null : signal.kind;
}
function comparableValue(kind: ImportMatchSignalKind, value: string): string {
  const trimmed = value.trim();
  return kind === "email" ? foldAsciiLower(trimmed) : trimmed;
}
function foldAsciiLower(value: string): string {
  let folded = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    folded += code >= 0x41 && code <= 0x5a ? String.fromCodePoint(code + 0x20) : character;
  }
  return folded;
}
function incomingValues(row: ImportValidatedRow): Map<ImportFieldId, string[]> {
  const byField = new Map<ImportFieldId, string[]>();
  for (const cell of row.mappedCells) {
    const trimmed = cell.value.trim();
    if (trimmed.length === 0) continue;
    const held = byField.get(cell.fieldId);
    if (held === undefined) byField.set(cell.fieldId, [trimmed]);
    else held.push(trimmed);
  }
  return byField;
}
function readCandidate(offered: ImportMatchCandidate): ReadCandidate | null {
  const parsed = CANDIDATE_SCHEMA.safeParse(offered);
  if (!parsed.success) return null;
  const { reference, visibleFields, visibleValues, reuse } = parsed.data;
  const readable: ImportFieldId[] = [];
  for (const fieldId of visibleFields) {
    const known = fieldIdOf(fieldId);
    if (known === null) return null;
    if (!readable.includes(known)) readable.push(known);
  }
  const values = new Map<ImportFieldId, readonly string[]>();
  for (const [fieldId, list] of Object.entries(visibleValues)) {
    const known = fieldIdOf(fieldId);
    // A value for a field the candidate does not declare readable is a fact without a permission
    // behind it, so the candidate is excluded instead of the value being quietly ignored.
    if (known === null || !readable.includes(known)) return null;
    values.set(known, [...list]);
  }
  const reuseFact: ImportReuseFact = reuse.permitted ? { permitted: true } : { permitted: false, reason: reuse.reason };
  return {
    reference: { system: reference.system, reference: reference.reference },
    visibleFields: new Set(readable),
    visibleValues: values,
    reuse: reuseFact,
  };
}
function fieldIdOf(value: string): ImportFieldId | null {
  if (!KNOWN_FIELD_IDS.has(value)) return null;
  return IMPORT_FIELD_IDS.find((fieldId) => fieldId === value) ?? null;
}
function byReference(left: ImportMatchSuggestion, right: ImportMatchSuggestion): number {
  return compareText(left.reference.system, right.reference.system) || compareText(left.reference.reference, right.reference.reference);
}
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
function uniqueSorted(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.sort(compareText);
}
function phraseList(phrases: readonly string[]): string {
  const unique: string[] = [];
  for (const phrase of phrases) {
    if (!unique.includes(phrase)) unique.push(phrase);
  }
  const [first] = unique;
  if (first === undefined) return "nothing";
  if (unique.length === 1) return first;
  const head = unique.slice(0, -1).join(", ");
  const last = unique[unique.length - 1] ?? "";
  return `${head} and ${last}`;
}
// Phase C: what this file deliberately does not do
//
// Nothing here creates a consent record, a membership, an audience entry, a gift, a commitment, a
// task, an interaction, a note or an identity, and nothing here decides a row's fate: `decide.ts`
// records the worker's per-row decision and `receipt.ts` records what happened at acceptance. No
// function authorises anything — permission arrives with a candidate as a fact the service resolved,
// and a candidate without that fact is excluded. Nothing claims the file is safe or validated
// either: a successful local parse is not a safety qualification, and the synthetic-files label
// belongs to the import feature.
