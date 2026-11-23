import { z } from "zod";
import { compareCodeUnits } from "@/lib/ordering";
import { IMPORT_FIELD_IDS, IMPORT_FIELD_VOCABULARY, listOf, uniqueInOrder, ImportContactKind, ImportFieldId, ImportIgnoredColumn, type ImportConfirmedMapping } from "./map";
import type { ImportRowFault, ParsedCsvFile, ParsedCsvRow } from "./parse";
export type ImportRowVerdict = "ready" | "needs-correction";
export type ImportIssueCode = "name-missing" | "email-not-complete" | "phone-not-a-number" | "postal-not-an-address";
export type ImportFieldIssue = { readonly rowNumber: number; readonly code: ImportIssueCode; readonly fieldId: ImportFieldId; readonly label: string; readonly columnNumber: number | null; readonly header: string | null; readonly value: string | null; readonly message: string };
export type ImportMappedCell = { readonly columnNumber: number; readonly header: string; readonly fieldId: ImportFieldId; readonly contactKind: ImportContactKind | null; readonly value: string };
export type ImportPreservedReason = "blank-cell" | "rejected-value" | "consent-preserved" | "excluded-topic" | "unmapped-column";
export type ImportPreservedCell = { readonly columnNumber: number; readonly header: string; readonly text: string; readonly reason: ImportPreservedReason; readonly statesConsent: boolean; readonly message: string };
export type ImportRestriction = { readonly columnNumber: number; readonly header: string; readonly kind: "imported-restriction"; readonly text: string };
export type ImportTag = { readonly columnNumber: number; readonly header: string; readonly text: string };
export type ImportCellAccounting = { readonly parsed: number; readonly mapped: number; readonly preserved: number };
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
export type ImportValidationProblemCode = "mapping-column-missing" | "mapping-column-shared" | "mapping-column-excluded";
export type ImportValidationProblem = { readonly code: ImportValidationProblemCode; readonly columnNumber: number; readonly message: string };
export type ImportValidationCounts = { readonly ready: number; readonly needsCorrection: number; readonly parsedCells: number; readonly mappedCells: number; readonly preservedCells: number; readonly consentMarkedCells: number; readonly restrictions: number; readonly tags: number };
export type ImportValidation = { readonly fields: readonly ImportFieldId[]; readonly rows: readonly ImportValidatedRow[]; readonly counts: ImportValidationCounts; readonly problems: readonly ImportValidationProblem[] };
const DESCRIPTOR_BY_FIELD = new Map(IMPORT_FIELD_VOCABULARY.map((field) => [field.id, field]));
const NAME_FIELDS: ReadonlySet<ImportFieldId> = new Set<ImportFieldId>(["display-name", "name-given", "name-family", "name-organization"]);
const MATCH_SIGNAL_FIELDS: readonly { readonly fieldId: ImportFieldId; readonly kind: ImportMatchSignalKind }[] = [
  { fieldId: "contact-email", kind: "email" },
  { fieldId: "contact-phone", kind: "phone" },
  { fieldId: "source-reference", kind: "source-reference" },
];
const CONSENT_HEADER_WORDS: readonly string[] = ["subscribed", "unsubscribed", "subscribe", "unsubscribe", "subscription", "subscriptions", "consent", "consents", "consented", "permission", "optin", "optout", "opted", "newsletter", "marketing"];
const EMAIL_MAX_LENGTH = 254;
const DIGIT = /\p{Nd}/u;
const LETTER = /\p{L}/u;
const WHITESPACE = /\s/u;
const CONTROL = /\p{Cc}/u;
const DOMAIN = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u;
const COMBINING_MARKS = /\p{M}+/gu;
const NON_WORD = /[^\p{L}\p{N}]+/u;
const labelOf = (fieldId: ImportFieldId): string => DESCRIPTOR_BY_FIELD.get(fieldId)?.label ?? fieldId;
const contactKindOf = (fieldId: ImportFieldId): ImportContactKind | null => DESCRIPTOR_BY_FIELD.get(fieldId)?.contactKind ?? null;
const fieldIssue = (rowNumber: number, code: ImportIssueCode, fieldId: ImportFieldId, columnNumber: number | null, header: string | null, value: string | null, message: string): ImportFieldIssue => ({ rowNumber, code, fieldId, label: labelOf(fieldId), columnNumber, header, value, message });
/** Validates every data row of a parsed file against a confirmed mapping, returning one entry per row in file order and keyed by the row number `parse.ts` assigned: the value or a readable. */
export function validateRows(parsed: ParsedCsvFile, confirmedMapping: ImportConfirmedMapping): ImportValidation {
  const problems: ImportValidationProblem[] = [];
  const ignoredByColumn = new Map(confirmedMapping.ignored.map((column) => [column.index, column] as const));
  const fields = orderedFields(confirmedMapping);
  const assignments = assignmentsByColumn(parsed, confirmedMapping, ignoredByColumn, problems);
  const rows = parsed.rows.map((row) => validateRow(row, { headers: parsed.headers, fields, assignments, ignoredByColumn, faults: faultsByRowNumber(parsed.rowFaults).get(row.rowNumber) ?? [] }));
  return { fields, rows, counts: countsOf(rows), problems };
}
type RowContext = { readonly headers: readonly string[]; readonly fields: readonly ImportFieldId[]; readonly assignments: ReadonlyMap<number, ImportFieldId>; readonly ignoredByColumn: ReadonlyMap<number, ImportIgnoredColumn>; readonly faults: readonly ImportRowFault[] };
function validateRow(row: ParsedCsvRow, context: RowContext): ImportValidatedRow {
  const { fields, faults } = context;
  const mappedCells: ImportMappedCell[] = [];
  const preservedCells: ImportPreservedCell[] = [];
  const issues: ImportFieldIssue[] = [];
  const restrictions: ImportRestriction[] = [];
  const tags: ImportTag[] = [];
  row.cells.forEach((cell, offset) => {
    const columnNumber = offset + 1;
    const header = headerAt(context.headers, columnNumber);
    const fieldId = context.assignments.get(columnNumber);
    if (fieldId === undefined) return void preservedCells.push(preservedOfUnmapped(columnNumber, header, cell, context.ignoredByColumn.get(columnNumber)));
    const trimmed = cell.trim();
    if (trimmed.length === 0) return void preservedCells.push({ columnNumber, header, text: cell, reason: "blank-cell", statesConsent: false, message: `This cell is empty, so "${labelOf(fieldId)}" gets no value from row ${row.rowNumber}. The row keeps its place and no value is invented for it.` });
    const problem = valueProblem(fieldId, trimmed);
    if (problem !== null) {
      issues.push(fieldIssue(row.rowNumber, problem.code, fieldId, columnNumber, header, cell, `Row ${row.rowNumber}, column ${columnNumber} ("${header}"): "${trimmed}" is ${problem.what}: ${problem.detail}. Correct the value in the file and choose the file again, or skip this row.`));
      preservedCells.push({ columnNumber, header, text: cell, reason: "rejected-value", statesConsent: false, message: `Kept exactly as it arrived so row ${row.rowNumber} can be corrected: "${trimmed}" is ${problem.what}: ${problem.detail}.` });
      return;
    }
    const contactKind = contactKindOf(fieldId);
    mappedCells.push({ columnNumber, header, fieldId, contactKind, value: cell });
    if (fieldId === "restriction") restrictions.push({ columnNumber, header, kind: "imported-restriction", text: cell });
    if (fieldId === "tag") tags.push({ columnNumber, header, text: trimmed });
  });
  const nameIssue = nameIssueFor(row, context, mappedCells);
  if (nameIssue !== null) issues.push(nameIssue);
  return { rowNumber: row.rowNumber, verdict: issues.length === 0 && faults.length === 0 ? "ready" : "needs-correction", suppliedFields: fields, mappedCells, preservedCells, restrictions, tags, issues, faults, cellAccounting: { parsed: row.cells.length, mapped: mappedCells.length, preserved: preservedCells.length } };
}
function nameIssueFor(row: ParsedCsvRow, context: RowContext, mappedCells: readonly ImportMappedCell[]): ImportFieldIssue | null {
  if (!context.fields.some((fieldId) => NAME_FIELDS.has(fieldId))) return null;
  if (mappedCells.some((cell) => NAME_FIELDS.has(cell.fieldId))) return null;
  const nameField = context.fields.find((fieldId) => NAME_FIELDS.has(fieldId));
  const columnNumber = nameField === undefined ? null : columnNumberFor(context.assignments, nameField);
  const header = columnNumber === null ? null : headerAt(context.headers, columnNumber);
  return fieldIssue(row.rowNumber, "name-missing", nameField ?? "display-name", columnNumber, header, null, `Row ${row.rowNumber} supplies no name: give it a display name, or a given name and a family name, or an organization name. Correct the row in the file and choose the file again, or skip this row.`);
}
type ValueProblem = { readonly code: ImportIssueCode; readonly what: string; readonly detail: string };
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
  const domain = value.slice(at + 1);
  if (value.slice(0, at).length === 0) return "it has nothing before the @";
  if (domain.length === 0) return "it has nothing after the @";
  if (!domain.includes(".")) return "its domain has no dot";
  if (!DOMAIN.test(domain)) return "its domain has an empty part, or a part that begins or ends with a hyphen";
  return value.length > EMAIL_MAX_LENGTH ? `it is ${value.length} characters long, and an address is at most ${EMAIL_MAX_LENGTH}` : null;
}
const phoneDetail = (value: string): string | null => (!DIGIT.test(value) ? "it has no digits" : LETTER.test(value) ? "it contains letters, so it may be a note rather than a number" : CONTROL.test(value) ? "it contains a control character" : null);
const postalDetail = (value: string): string | null => (!LETTER.test(value) && !DIGIT.test(value) ? "it holds no letters and no digits" : null);
function preservedOfUnmapped(columnNumber: number, header: string, text: string, ignored: ImportIgnoredColumn | undefined): ImportPreservedCell {
  const statesConsent = columnStatesConsent(header, ignored);
  const reason: ImportPreservedReason = statesConsent ? "consent-preserved" : ignored?.reason === "excluded-topic" ? "excluded-topic" : "unmapped-column";
  const message = statesConsent
    ? `Kept exactly as it arrived and never read as consent: "${header}" states a subscription or consent, which this import does not use. Importing this row subscribes nobody and creates no audience membership.`
    : (ignored?.message ?? "This column is not part of the confirmed mapping, so its value is kept as data and supplies no contact field.");
  return { columnNumber, header, text, reason, statesConsent, message };
}
const columnStatesConsent = (header: string, ignored: ImportIgnoredColumn | undefined): boolean => ignored?.reason === "consent-preserved-as-data" || looksLikeConsentHeader(header);
const looksLikeConsentHeader = (header: string): boolean =>
  header
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .split(NON_WORD)
    .filter((word) => word.length > 0)
    .some((word) => CONSENT_HEADER_WORDS.includes(word));
const orderedFields = (mapping: ImportConfirmedMapping): ImportFieldId[] => IMPORT_FIELD_IDS.filter((fieldId) => new Set<ImportFieldId>(mapping.fields).has(fieldId));
function assignmentsByColumn(parsed: ParsedCsvFile, mapping: ImportConfirmedMapping, ignoredByColumn: ReadonlyMap<number, ImportIgnoredColumn>, problems: ImportValidationProblem[]): Map<number, ImportFieldId> {
  const byColumn = new Map<number, ImportFieldId>();
  for (const assignment of mapping.assignments) {
    const { columnIndex, fieldId } = assignment;
    if (!Number.isInteger(columnIndex) || columnIndex < 1 || columnIndex > parsed.columnCount) {
      problems.push({ code: "mapping-column-missing", columnNumber: columnIndex, message: `The mapping supplies "${labelOf(fieldId)}" from column ${columnIndex}, and this file has ${parsed.columnCount} column(s). Choose the file again and confirm the mapping for it.` });
      continue;
    }
    const taken = byColumn.get(columnIndex);
    if (taken !== undefined) {
      if (taken !== fieldId) problems.push({ code: "mapping-column-shared", columnNumber: columnIndex, message: `Column ${columnIndex} is assigned to both "${labelOf(taken)}" and "${labelOf(fieldId)}"; only "${labelOf(taken)}" is read from it.` });
      continue;
    }
    const ignored = ignoredByColumn.get(columnIndex);
    const header = headerAt(parsed.headers, columnIndex);
    if (columnStatesConsent(header, ignored) || ignored?.reason === "blank-header" || ignored?.reason === "excluded-topic") {
      problems.push({ code: "mapping-column-excluded", columnNumber: columnIndex, message: `Column ${columnIndex} ("${header}") cannot supply "${labelOf(fieldId)}", so it supplies nothing on any row: ${ignored?.message ?? "the column may not be mapped."}` });
      continue;
    }
    byColumn.set(columnIndex, fieldId);
  }
  return byColumn;
}
function faultsByRowNumber(faults: readonly ImportRowFault[]): ReadonlyMap<number, readonly ImportRowFault[]> {
  const byRow = new Map<number, readonly ImportRowFault[]>();
  for (const fault of faults) byRow.set(fault.rowNumber, [...(byRow.get(fault.rowNumber) ?? []), fault]);
  return byRow;
}
function countsOf(rows: readonly ImportValidatedRow[]): ImportValidationCounts {
  const total = (count: (row: ImportValidatedRow) => number): number => rows.reduce((sum, row) => sum + count(row), 0);
  return {
    ready: total((row) => (row.verdict === "ready" ? 1 : 0)),
    needsCorrection: total((row) => (row.verdict === "ready" ? 0 : 1)),
    parsedCells: total((row) => row.cellAccounting.parsed),
    mappedCells: total((row) => row.cellAccounting.mapped),
    preservedCells: total((row) => row.cellAccounting.preserved),
    consentMarkedCells: total((row) => row.preservedCells.filter((cell) => cell.statesConsent).length),
    restrictions: total((row) => row.restrictions.length),
    tags: total((row) => row.tags.length),
  };
}
const headerAt = (headers: readonly string[], columnNumber: number): string => headers[columnNumber - 1] ?? "";
const columnNumberFor = (assignments: ReadonlyMap<number, ImportFieldId>, fieldId: ImportFieldId): number | null => [...assignments].find(([, assigned]) => assigned === fieldId)?.[0] ?? null;
export type ImportMatchReference = { readonly system: string; readonly reference: string };
export type ImportReuseRefusal = "out-of-scope" | "denied" | "archived";
export type ImportReuseFact = { readonly permitted: true } | { readonly permitted: false; readonly reason: ImportReuseRefusal };
export type ImportMatchCandidate = { readonly reference: ImportMatchReference; readonly visibleFields: readonly ImportFieldId[]; readonly visibleValues: Readonly<Partial<Record<ImportFieldId, readonly string[]>>>; readonly reuse: ImportReuseFact };
export type ImportMatchSignalKind = "email" | "phone" | "source-reference";
export type ImportMatchSignal = { readonly kind: ImportMatchSignalKind; readonly fieldId: ImportFieldId; readonly value: string };
export type ImportFieldComparison = { readonly fieldId: ImportFieldId; readonly label: string; readonly existingState: "readable" | "not-readable"; readonly existing: readonly string[]; readonly incoming: readonly string[]; readonly differs: boolean | null; readonly message: string };
export type ImportMatchSuggestion = { readonly reference: ImportMatchReference; readonly signals: readonly ImportMatchSignal[]; readonly comparison: readonly ImportFieldComparison[]; readonly differsOn: readonly ImportFieldId[]; readonly message: string };
export type ImportMatchProposal = { readonly rowNumber: number; readonly suggestions: readonly ImportMatchSuggestion[] };
const SIGNAL_NOUNS: Readonly<Record<ImportMatchSignalKind, string>> = { email: "an email address", phone: "a phone number", "source-reference": "a source reference" };
const KEY_SEPARATOR = "\u0000";
const CANDIDATE_SCHEMA = z.object({
  reference: z.object({ system: z.string().min(1), reference: z.string().min(1) }),
  visibleFields: z.array(z.string()),
  visibleValues: z.record(z.string(), z.array(z.string())),
  reuse: z.discriminatedUnion("permitted", [z.object({ permitted: z.literal(true) }), z.object({ permitted: z.literal(false), reason: z.enum(["out-of-scope", "denied", "archived"]) })]),
});
const KNOWN_FIELD_IDS: ReadonlySet<string> = new Set<string>(IMPORT_FIELD_IDS);
type ReadCandidate = { readonly reference: ImportMatchReference; readonly visibleFields: ReadonlySet<ImportFieldId>; readonly visibleValues: ReadonlyMap<ImportFieldId, readonly string[]>; readonly reuse: ImportReuseFact };
/** Proposes the existing contacts a row could reuse, matching only on an exactly equal contact-method value or source reference and comparing every field the mapping supplies beside the. */
export function suggestMatches(row: ImportValidatedRow, candidates: readonly ImportMatchCandidate[]): ImportMatchProposal {
  const incoming = incomingValues(row);
  const suggestions: ImportMatchSuggestion[] = [];
  for (const offered of candidates) {
    const candidate = readCandidate(offered);
    if (candidate === null || !candidate.reuse.permitted) continue;
    const signals = signalsFor(row, candidate);
    if (signals.length === 0) continue;
    const comparison = row.suppliedFields.map((fieldId) => compareField(fieldId, candidate, incoming));
    const differsOn: ImportFieldId[] = [];
    for (const field of comparison) if (field.differs === true) differsOn.push(field.fieldId);
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
  const seen = new Set<string>();
  return MATCH_SIGNAL_FIELDS.flatMap(({ fieldId, kind }) => {
    if (!candidate.visibleFields.has(fieldId)) return [];
    const existing = new Set((candidate.visibleValues.get(fieldId) ?? []).map((value) => comparableValue(kind, value)));
    return row.mappedCells.flatMap((cell) => {
      const value = cell.value.trim();
      const comparable = comparableValue(kind, value);
      const key = `${kind}${KEY_SEPARATOR}${comparable}`;
      if (cell.fieldId !== fieldId || value.length === 0 || !existing.has(comparable) || seen.has(key)) return [];
      seen.add(key);
      return [{ kind, fieldId, value }];
    });
  });
}
function compareField(fieldId: ImportFieldId, candidate: ReadCandidate, incoming: ReadonlyMap<ImportFieldId, readonly string[]>): ImportFieldComparison {
  const label = labelOf(fieldId);
  const lower = label.toLowerCase();
  const values = incoming.get(fieldId) ?? [];
  if (!candidate.visibleFields.has(fieldId)) return { fieldId, label, existingState: "not-readable", existing: [], incoming: values, differs: null, message: `The existing ${lower} is not shown to you here, so it is not compared and nothing has been changed.` };
  const existing = candidate.visibleValues.get(fieldId) ?? [];
  const differs = !sameValues(existing, values, fieldId);
  const existingShown = phraseList(existing.map((value) => `"${value.trim()}"`));
  const incomingShown = phraseList(values.map((value) => `"${value}"`));
  const base = { fieldId, label, existingState: "readable" as const, existing, incoming: values };
  if (differs) {
    if (existing.length === 0) return { ...base, differs, message: `That contact holds no ${lower}; this row supplies ${incomingShown}. Nothing has been applied.` };
    return { ...base, differs, message: `That contact holds ${existingShown}; this row supplies ${incomingShown}. The difference is shown so you can decide before accepting, and nothing has been applied.` };
  }
  return values.length === 0 ? { ...base, differs, message: `Neither that contact nor this row holds a ${lower}, so there is nothing to compare.` } : { ...base, differs, message: `That contact already holds ${existingShown}, the same as this row. Nothing was merged or changed.` };
}
function sameValues(left: readonly string[], right: readonly string[], fieldId: ImportFieldId): boolean {
  const first = uniqueSorted(left.map((value) => normaliseFor(fieldId, value)));
  const second = uniqueSorted(right.map((value) => normaliseFor(fieldId, value)));
  return first.length !== second.length ? false : first.every((value, index) => value === second[index]);
}
const normaliseFor = (fieldId: ImportFieldId, value: string): string => (signalKindOf(fieldId) === "email" ? foldAsciiLower(value.trim()) : value.trim());
const signalKindOf = (fieldId: ImportFieldId): ImportMatchSignalKind | null => MATCH_SIGNAL_FIELDS.find((candidate) => candidate.fieldId === fieldId)?.kind ?? null;
const comparableValue = (kind: ImportMatchSignalKind, value: string): string => (kind === "email" ? foldAsciiLower(value.trim()) : value.trim());
/** The ASCII-only fold the import compares email values with: `A`–`Z` lowercased and every other character kept exactly. */
const foldAsciiLower = (value: string): string => value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
function incomingValues(row: ImportValidatedRow): Map<ImportFieldId, string[]> {
  const byField = new Map<ImportFieldId, string[]>();
  for (const cell of row.mappedCells) {
    const trimmed = cell.value.trim();
    if (trimmed.length === 0) continue;
    byField.set(cell.fieldId, [...(byField.get(cell.fieldId) ?? []), trimmed]);
  }
  return byField;
}
function readCandidate(offered: ImportMatchCandidate): ReadCandidate | null {
  const parsed = CANDIDATE_SCHEMA.safeParse(offered);
  if (!parsed.success) return null;
  const { reference, visibleFields, visibleValues, reuse } = parsed.data;
  const knownFields = visibleFields.map(fieldIdOf);
  if (knownFields.some((known) => known === null)) return null;
  const readable = uniqueInOrder(knownFields.flatMap((known) => (known === null ? [] : [known])));
  const values = new Map<ImportFieldId, readonly string[]>();
  for (const [fieldId, list] of Object.entries(visibleValues)) {
    const known = fieldIdOf(fieldId);
    if (known === null || !readable.includes(known)) return null;
    values.set(known, [...list]);
  }
  return { reference: { system: reference.system, reference: reference.reference }, visibleFields: new Set(readable), visibleValues: values, reuse: reuse.permitted ? { permitted: true } : { permitted: false, reason: reuse.reason } };
}
const fieldIdOf = (value: string): ImportFieldId | null => (!KNOWN_FIELD_IDS.has(value) ? null : (IMPORT_FIELD_IDS.find((fieldId) => fieldId === value) ?? null));
const byReference = (left: ImportMatchSuggestion, right: ImportMatchSuggestion): number => compareCodeUnits(left.reference.system, right.reference.system) || compareCodeUnits(left.reference.reference, right.reference.reference);
const uniqueSorted = (values: readonly string[]): string[] => uniqueInOrder(values).sort(compareCodeUnits);
const phraseList = (phrases: readonly string[]): string => listOf(phrases) || "nothing";
/** One row that looks like another row of the same file: the name they share, and the other rows of the file carrying it with no contact method in common. */
export type ImportDuplicateLooking = { readonly rowNumber: number; readonly name: string; readonly otherRowNumbers: readonly number[] };
const NAME_FORMS: readonly (readonly ImportFieldId[])[] = [["display-name"], ["name-organization"], ["name-given", "name-family"]]; // The forms a name is read from, in the order a row is believed: the label a contact is shown under, then the organization it acts as, then its given and family names joined.
const NAME_SPACE = /\s+/gu;
const valuesOf = (row: ImportValidatedRow, fieldId: ImportFieldId): readonly string[] =>
  row.mappedCells
    .filter((cell) => cell.fieldId === fieldId)
    .map((cell) => cell.value.trim())
    .filter((value) => value.length > 0);
// The name a row is compared by, from the first form it supplies in full; `null` when it supplies none, because a row nothing names is compared with nothing. Case and spacing fold so two spellings of one name meet, and nothing else does.
function comparableNameOf(row: ImportValidatedRow): { readonly key: string; readonly text: string } | null {
  for (const form of NAME_FORMS) {
    const parts: string[] = [];
    for (const fieldId of form) {
      const value = valuesOf(row, fieldId).join(" ");
      if (value.length === 0) break;
      parts.push(value);
    }
    if (parts.length !== form.length) continue;
    const text = parts.join(" ").replace(NAME_SPACE, " ").trim();
    if (text.length > 0) return { key: text.toLowerCase(), text };
  }
  return null;
}
// Whether two rows already agree on a signal that names a contact method or a source record, compared as the matching over stored contacts compares it, so the two readings of one email address never disagree.
function sharesSignal(left: ImportValidatedRow, right: ImportValidatedRow): boolean {
  for (const { fieldId, kind } of MATCH_SIGNAL_FIELDS) {
    const held = new Set(valuesOf(left, fieldId).map((value) => comparableValue(kind, value)));
    if (held.size === 0) continue;
    for (const value of valuesOf(right, fieldId)) if (held.has(comparableValue(kind, value))) return true;
  }
  return false;
}
/** Flags, per row of one file, the other rows of that file it looks like: the same comparable name and no shared email address, phone number or source reference. A look-alike signal for the worker to read, never a second rule over the rows — no verdict, candidate, reference, decision or count is touched, and both rows of a pair are named.
 */
export function flagDuplicateLookingRows(rows: readonly ImportValidatedRow[]): ReadonlyMap<number, ImportDuplicateLooking> {
  const groups = new Map<string, { readonly name: string; readonly members: ImportValidatedRow[] }>();
  for (const row of rows) {
    const name = comparableNameOf(row);
    if (name === null) continue;
    const group = groups.get(name.key);
    if (group === undefined) groups.set(name.key, { name: name.text, members: [row] });
    else group.members.push(row);
  }
  const flagged = new Map<number, ImportDuplicateLooking>();
  for (const group of groups.values()) {
    if (group.members.length < 2) continue;
    for (const row of group.members) {
      const otherRowNumbers = group.members.filter((other) => other.rowNumber !== row.rowNumber && !sharesSignal(row, other)).map((other) => other.rowNumber);
      if (otherRowNumbers.length === 0) continue;
      flagged.set(row.rowNumber, { rowNumber: row.rowNumber, name: group.name, otherRowNumbers: otherRowNumbers.sort((left, right) => left - right) });
    }
  }
  return flagged;
}
