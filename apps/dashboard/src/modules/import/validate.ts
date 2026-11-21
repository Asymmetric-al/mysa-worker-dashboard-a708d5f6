/**
 * Contact import, step three: turn the parsed rows and the confirmed mapping into per-row validation
 * state with a readable reason for every problem, and propose existing partners for reuse as
 * suggestions only.
 *
 * Scope: AAP 0.6.1 import-module row (`validateRows()` and `suggestMatches()` in
 * `src/modules/import/*`; 0.9.1 and 0.11.1 `modules/import/{parse,map,validate,decide,receipt}.ts`);
 * 0.10.1 contact import ("per-row decisions", "duplicate suggestions that never merge", "proposed
 * changes beside existing values", "negative-restriction preservation"); 0.6.2 partner record
 * (`contactMethods[].permitted`, `restrictions[]`, and the rule that equal-looking identifiers,
 * names, email addresses and postal addresses establish neither identity nor authority); 0.8.5
 * ("importing or editing a contact never subscribes anyone"; "a `subscribed` flag is not consent");
 * 0.3.4 (import parsing and decisions — contact import only).
 *
 * Three rules shape the file. A cell is never dropped: every parsed cell ends in exactly one of a
 * row's `mappedCells` or `preservedCells`, so a worker can correct the row and a test can count what
 * survived. A restriction outranks a validation failure beside it, because a restriction must reach
 * the record whether or not its neighbours were correctable, and it is never read as a permission. A
 * match is a suggestion: nothing here merges, overwrites, decides, writes or authorises, and no
 * value is presented as though it had been applied.
 *
 * The module is pure and deterministic. It reads no clock, no filesystem, no network and no random
 * source, and it orders everything by code-unit comparison rather than a locale-dependent sort, so
 * the same rows and the same candidates yield the same result on every machine.
 */

import { z } from "zod";

import type {
  ImportConfirmedMapping,
  ImportContactKind,
  ImportFieldId,
  ImportIgnoredColumn,
} from "./map";
import { IMPORT_FIELD_IDS, IMPORT_FIELD_VOCABULARY } from "./map";
import type { ImportRowFault, ParsedCsvFile, ParsedCsvRow } from "./parse";

// ---------------------------------------------------------------------------------------------
// Phase A: the row's verdict, in this module's own vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * What a row is, as far as this step can tell: correctable, or ready to be decided about.
 *
 * These two words belong to this module alone. The receipt's result literals — `accepted`,
 * `already-accepted`, `skipped`, `needs-review`, `failed` — record what happened to a row at
 * acceptance and belong to `decide.ts` and `receipt.ts`. A row that reads `ready` here has been
 * accepted nowhere, and a row that needs correction has decided nothing.
 */
export type ImportRowVerdict = "ready" | "needs-correction";

/** Why a mapped value cannot be used as it stands. Each code states one fact, not one remedy. */
export type ImportIssueCode =
  /** The row supplies no name, although the mapping supplies at least one name field. */
  | "name-missing"
  /** An email cell that is not one complete address. */
  | "email-not-complete"
  /** A phone cell that holds no digit, or holds letters. */
  | "phone-not-a-number"
  /** A postal cell that holds neither a letter nor a digit. */
  | "postal-not-an-address";

/**
 * One problem with one mapped value, addressed to the row and column the worker can look at. The
 * offending cell is repeated verbatim so the message stands alone, and no internal identifier
 * appears in it.
 */
export interface ImportFieldIssue {
  readonly rowNumber: number;
  readonly code: ImportIssueCode;
  readonly fieldId: ImportFieldId;
  /** Plain-language field name from the mapping vocabulary. */
  readonly label: string;
  /** 1-based column position, or null when the problem is that the row supplied nothing at all. */
  readonly columnNumber: number | null;
  readonly header: string | null;
  /** The cell exactly as parsed; null when no cell supplied a value. */
  readonly value: string | null;
  readonly message: string;
}

/** A cell that supplied a usable value, with the field it supplies and where it sits. */
export interface ImportMappedCell {
  readonly columnNumber: number;
  readonly header: string;
  readonly fieldId: ImportFieldId;
  /** The contact-method kind the field supplies; null for every non-contact field. */
  readonly contactKind: ImportContactKind | null;
  /** The cell exactly as parsed and untrimmed: nothing here rewords what the file holds. */
  readonly value: string;
}

/** Why a parsed cell supplied no value. Every reason keeps the cell's text. */
export type ImportPreservedReason =
  /** The cell is empty, so it supplies nothing and none is invented in its place. */
  | "blank-cell"
  /** The cell holds text that failed its field's check; the text stays for correction. */
  | "rejected-value"
  /** The column states a subscription or consent, which this import never reads. */
  | "consent-preserved"
  /** The column names a fact this import never produces, such as money or a membership. */
  | "excluded-topic"
  /** The confirmed mapping does not use this column. */
  | "unmapped-column";

/**
 * A parsed cell that supplied no value, kept so the row can be corrected and shown in full.
 * `statesConsent` is the explicit marking the money-and-consent rule requires: such a cell is data
 * about what the file claimed, and it is never a permission, a membership, an audience entry or a
 * decision.
 */
export interface ImportPreservedCell {
  readonly columnNumber: number;
  readonly header: string;
  readonly text: string;
  readonly reason: ImportPreservedReason;
  readonly statesConsent: boolean;
  readonly message: string;
}

/**
 * A contact restriction exactly as the file stated it.
 *
 * `kind` says where the statement came from, never what it forbids. Reading a channel out of free
 * text would let "do not phone; email is fine" be labelled as a phone restriction, which reads as
 * permission for the channel the worker never mentioned — so the wording is carried untouched and
 * interpreted by nobody here.
 */
export interface ImportRestriction {
  readonly columnNumber: number;
  readonly header: string;
  readonly kind: "imported-restriction";
  /** The cell exactly as parsed, original wording and spacing untouched. */
  readonly text: string;
}

/** A tag value as the file supplied it, trimmed for display and otherwise unaltered. */
export interface ImportTag {
  readonly columnNumber: number;
  readonly header: string;
  readonly text: string;
}

/**
 * How a row's cells divide. `mapped + preserved === parsed` holds for every row, including a ragged
 * one, so a test can prove no cell vanished and a worker can see every value that was kept.
 */
export interface ImportCellAccounting {
  /** Cells the row holds, exactly as parsed. */
  readonly parsed: number;
  readonly mapped: number;
  readonly preserved: number;
}

/** One data row after validation, in file order and keyed by the row number `parse.ts` assigned. */
export interface ImportValidatedRow {
  readonly rowNumber: number;
  readonly verdict: ImportRowVerdict;
  /** Fields the confirmed mapping supplies, in vocabulary order; the same list on every row. */
  readonly suppliedFields: readonly ImportFieldId[];
  readonly mappedCells: readonly ImportMappedCell[];
  readonly preservedCells: readonly ImportPreservedCell[];
  /** Restrictions the row stated, kept even when another field on the row failed. */
  readonly restrictions: readonly ImportRestriction[];
  readonly tags: readonly ImportTag[];
  readonly issues: readonly ImportFieldIssue[];
  /** Faults `parse.ts` measured on this row, carried forward with their measured value. */
  readonly faults: readonly ImportRowFault[];
  readonly cellAccounting: ImportCellAccounting;
}

/** A mapping that could not be applied to this file, reported once rather than per row. */
export type ImportValidationProblemCode =
  /** An assignment names a column position this file does not have. */
  | "mapping-column-missing"
  /** Two fields claim one column position. */
  | "mapping-column-shared"
  /** A field was assigned a column that may never be mapped: blank header, consent, excluded fact. */
  | "mapping-column-excluded";

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
  /** Cells kept from a column that states consent. None of them is consent. */
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

// ---------------------------------------------------------------------------------------------
// Shared internals: the vocabulary, read once
// ---------------------------------------------------------------------------------------------

/** The field descriptors, keyed by the closed field-id union rather than by header text. */
const DESCRIPTOR_BY_FIELD = new Map(IMPORT_FIELD_VOCABULARY.map((field) => [field.id, field]));

/** The fields whose presence gives a row a name to be shown under. */
const NAME_FIELDS: ReadonlySet<ImportFieldId> = new Set<ImportFieldId>([
  "display-name",
  "name-given",
  "name-family",
  "name-organization",
]);

/** The contact-method fields a reuse suggestion may match on, with the signal each one yields. */
const MATCH_SIGNAL_FIELDS: readonly {
  readonly fieldId: ImportFieldId;
  readonly kind: ImportMatchSignalKind;
}[] = [
  { fieldId: "contact-email", kind: "email" },
  { fieldId: "contact-phone", kind: "phone" },
  { fieldId: "source-reference", kind: "source-reference" },
];

/**
 * Words that make a column a subscription or consent statement, read here independently of the
 * mapping. The mapping already refuses such a column, but a header it reports as merely unrecognised
 * — "Subscribed?", which its own word split keeps whole — must still be marked as consent-looking
 * wherever this module preserves it, so no surface can present its value as a permission. Splitting
 * on any non-letter rather than on the mapping's narrower separators is what closes that gap.
 */
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

/** Characters that read as a complete email address: at most 254, and one @ between two parts. */
const EMAIL_MAX_LENGTH = 254;

/** Digits in any script: a phone number written in Arabic-Indic digits still holds digits. */
const DIGIT = /\p{Nd}/u;

/** Letters in any script, used to refuse a value that is prose rather than a number or an address. */
const LETTER = /\p{L}/u;

/** Whitespace anywhere inside an email address means it is not one address. */
const WHITESPACE = /\s/u;

/** Control characters are never part of a contact value worth keeping as one. */
const CONTROL = /\p{Cc}/u;

/** A domain: labelled parts of letters or digits, no empty part, no part beginning or ending `-`. */
const DOMAIN =
  /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u;

/** Combining marks, removed so an accented header word reads as the plain letters it is written in. */
const COMBINING_MARKS = /\p{M}+/gu;

/** Anything that is not a letter or a digit, so a header of "Subscribed?" splits into "subscribed". */
const NON_WORD = /[^\p{L}\p{N}]+/u;

function labelOf(fieldId: ImportFieldId): string {
  return DESCRIPTOR_BY_FIELD.get(fieldId)?.label ?? fieldId;
}

function contactKindOf(fieldId: ImportFieldId): ImportContactKind | null {
  return DESCRIPTOR_BY_FIELD.get(fieldId)?.contactKind ?? null;
}

// ---------------------------------------------------------------------------------------------
// Phase A: the validation pass
// ---------------------------------------------------------------------------------------------

/**
 * Validates every data row of a parsed file against a confirmed mapping, returning one entry per row
 * in file order and keyed by the row number `parse.ts` assigned: the value or a readable problem for
 * each mapped field, every restriction kept verbatim, every uninterpreted cell preserved, and the
 * verdict that says whether the row can be decided about.
 */
export function validateRows(
  parsed: ParsedCsvFile,
  confirmedMapping: ImportConfirmedMapping,
): ImportValidation {
  const problems: ImportValidationProblem[] = [];
  const ignoredByColumn = new Map(
    confirmedMapping.ignored.map((column) => [column.index, column] as const),
  );
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

/** Everything one row needs from the file, the mapping and the parse faults beside it. */
interface RowContext {
  readonly headers: readonly string[];
  readonly fields: readonly ImportFieldId[];
  /** Column position to the field it supplies, for the columns this file has and may map. */
  readonly assignments: ReadonlyMap<number, ImportFieldId>;
  readonly ignoredByColumn: ReadonlyMap<number, ImportIgnoredColumn>;
  /** Faults `parse.ts` measured on this row. */
  readonly faults: readonly ImportRowFault[];
}

/**
 * Validates one row. Each parsed cell lands in exactly one of the row's two cell lists — a usable
 * value or the reason it supplied none — and a restriction is collected before the verdict is known,
 * so a restriction survives even when a different field on the same row failed.
 */
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
      preservedCells.push(
        preservedOfUnmapped(columnNumber, header, cell, context.ignoredByColumn.get(columnNumber)),
      );
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

/**
 * The problem with a row that supplies no name at all, or null. A name is a label a worker
 * recognises a contact by, so a row without one cannot be presented for a decision; the issue is
 * raised only when the mapping actually supplies a name field, because a mapping that carries no
 * name column is the mapping step's report to make, not each row's fault.
 */
function nameIssueFor(
  row: ParsedCsvRow,
  context: RowContext,
  mappedCells: readonly ImportMappedCell[],
): ImportFieldIssue | null {
  const suppliesNameField = context.fields.some((fieldId) => NAME_FIELDS.has(fieldId));
  if (!suppliesNameField) return null;
  if (mappedCells.some((cell) => NAME_FIELDS.has(cell.fieldId))) return null;

  const nameField = context.fields.find((fieldId) => NAME_FIELDS.has(fieldId));
  const columnNumber =
    nameField === undefined ? null : columnNumberFor(context.assignments, nameField);
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

/** The fact that makes a mapped value unusable, split so an issue and a preserved cell read alike. */
interface ValueProblem {
  readonly code: ImportIssueCode;
  /** What the value is not, phrased to follow the value in a sentence. */
  readonly what: string;
  /** The specific fact that makes it unusable, phrased to follow a colon. */
  readonly detail: string;
}

/**
 * Checks one mapped value against its field. Names, restrictions, tags and source references accept
 * any non-blank text: a name is a label rather than a fact to check, a restriction is a statement
 * repeated rather than classified, a tag is the worker's own word, and a source reference is opaque
 * text that is never parsed, so leading zeros and punctuation in it are part of the value.
 */
function valueProblem(fieldId: ImportFieldId, value: string): ValueProblem | null {
  if (fieldId === "contact-email") {
    const detail = emailDetail(value);
    return detail === null
      ? null
      : { code: "email-not-complete", what: "not a complete email address", detail };
  }
  if (fieldId === "contact-phone") {
    const detail = phoneDetail(value);
    return detail === null
      ? null
      : { code: "phone-not-a-number", what: "not a phone number", detail };
  }
  if (fieldId === "contact-postal") {
    const detail = postalDetail(value);
    return detail === null
      ? null
      : { code: "postal-not-an-address", what: "not a postal address", detail };
  }
  return null;
}

/**
 * Why a value is not one complete email address, or null. The checks are structural and run in a
 * fixed order, so the same text always yields the same sentence; the domain accepts letters and
 * digits of any script, because an address written in another script is still an address.
 */
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

/**
 * Why a value is not a phone number, or null. A number is digits with whatever punctuation the file
 * uses between them; a value with no digit is not a number, and a value with letters is prose — the
 * import reads no format, invents no country code and dials nothing.
 */
function phoneDetail(value: string): string | null {
  if (!DIGIT.test(value)) return "it has no digits";
  if (LETTER.test(value)) return "it contains letters, so it may be a note rather than a number";
  if (CONTROL.test(value)) return "it contains a control character";
  return null;
}

/** Why a value is not a postal address, or null: an address holds at least one letter or digit. */
function postalDetail(value: string): string | null {
  if (!LETTER.test(value) && !DIGIT.test(value)) return "it holds no letters and no digits";
  return null;
}

/** A cell the confirmed mapping does not use, kept with the reason it was left out. */
function preservedOfUnmapped(
  columnNumber: number,
  header: string,
  text: string,
  ignored: ImportIgnoredColumn | undefined,
): ImportPreservedCell {
  const statesConsent = columnStatesConsent(header, ignored);
  const reason: ImportPreservedReason = statesConsent
    ? "consent-preserved"
    : ignored?.reason === "excluded-topic"
      ? "excluded-topic"
      : "unmapped-column";
  const message = statesConsent
    ? `Kept exactly as it arrived and never read as consent: "${header}" states a subscription or consent, which this import does not use. Importing this row subscribes nobody and creates no audience membership.`
    : (ignored?.message ??
      "This column is not part of the confirmed mapping, so its value is kept as data and supplies no contact field.");

  return { columnNumber, header, text, reason, statesConsent, message };
}

/**
 * Whether a column states a subscription or consent: the mapping's own reason, or this module's
 * independent reading of the header when the mapping called it merely unrecognised.
 */
function columnStatesConsent(header: string, ignored: ImportIgnoredColumn | undefined): boolean {
  return ignored?.reason === "consent-preserved-as-data" || looksLikeConsentHeader(header);
}

/** Whether the header's words name a subscription, consent or permission, whatever its punctuation. */
function looksLikeConsentHeader(header: string): boolean {
  const words = header
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .split(NON_WORD)
    .filter((word) => word.length > 0);
  return words.some((word) => CONSENT_HEADER_WORDS.includes(word));
}

/** The fields the confirmed mapping supplies, in vocabulary order so every row lists them alike. */
function orderedFields(mapping: ImportConfirmedMapping): ImportFieldId[] {
  const supplied = new Set<ImportFieldId>(mapping.fields);
  return IMPORT_FIELD_IDS.filter((fieldId) => supplied.has(fieldId));
}

/**
 * Column position to the field it supplies, for the columns this file has and may map. A position
 * the file does not have, a position two fields claim, and a column that may never be mapped — no
 * header, a consent statement, a fact this import does not produce — are reported once each in
 * `problems` rather than silently contributing nothing to every row.
 */
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
    const blocked =
      columnStatesConsent(header, ignored) ||
      ignored?.reason === "blank-header" ||
      ignored?.reason === "excluded-topic";

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

/** The parse faults grouped by the row number they belong to, so each row carries its own. */
function faultsByRowNumber(
  faults: readonly ImportRowFault[],
): ReadonlyMap<number, readonly ImportRowFault[]> {
  const byRow = new Map<number, ImportRowFault[]>();
  for (const fault of faults) {
    const existing = byRow.get(fault.rowNumber);
    if (existing === undefined) byRow.set(fault.rowNumber, [fault]);
    else existing.push(fault);
  }
  return byRow;
}

/** The counts the review step shows above the rows. */
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

/** The header text at a 1-based position, or an empty string when the position has none. */
function headerAt(headers: readonly string[], columnNumber: number): string {
  return headers[columnNumber - 1] ?? "";
}

/** The first column position assigned to a field, or null when the mapping supplies it from none. */
function columnNumberFor(
  assignments: ReadonlyMap<number, ImportFieldId>,
  fieldId: ImportFieldId,
): number | null {
  for (const [columnNumber, assigned] of assignments) {
    if (assigned === fieldId) return columnNumber;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Phase B: reuse suggestions — a proposal, never a merge
// ---------------------------------------------------------------------------------------------

/** An existing record named by an opaque, source-qualified reference; never by a name or an address. */
export interface ImportMatchReference {
  readonly system: string;
  readonly reference: string;
}

/** Why this caller may not reuse an existing identity. The wording of each is the service's to own. */
export type ImportReuseRefusal = "out-of-scope" | "denied" | "archived";

/**
 * Whether an existing identity may be reused by this caller. This is an input the service resolves,
 * never something this module decides: the domain module holds no session, no scope and no
 * permission, so a candidate that carries no such fact is excluded rather than assumed reusable.
 */
export type ImportReuseFact =
  | { readonly permitted: true }
  | { readonly permitted: false; readonly reason: ImportReuseRefusal };

/**
 * One existing contact the service offers for comparison, already resolved in the caller's scope.
 * `visibleFields` and `visibleValues` describe only what this caller may read: a field left out is
 * not compared, and its absence is never read as "the existing record holds nothing".
 */
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
  /** The value exactly as this row supplies it, trimmed. */
  readonly value: string;
}

/**
 * One field the mapping supplies, compared beside the existing value so the difference is visible
 * before acceptance. `differs` is null — not false — when the existing value is not readable here,
 * because "not shown" and "the same" are different facts about a record.
 */
export interface ImportFieldComparison {
  readonly fieldId: ImportFieldId;
  readonly label: string;
  readonly existingState: "readable" | "not-readable";
  /** The existing values this caller may read, trimmed; empty when none is held or none is shown. */
  readonly existing: readonly string[];
  /** The values this row supplies for the field, trimmed. */
  readonly incoming: readonly string[];
  readonly differs: boolean | null;
  readonly message: string;
}

/**
 * One proposal for one row: the existing contact, the values that matched it, the field-by-field
 * comparison, and the fields that differ. It states no sameness of identity and authorises nothing.
 */
export interface ImportMatchSuggestion {
  readonly reference: ImportMatchReference;
  readonly signals: readonly ImportMatchSignal[];
  readonly comparison: readonly ImportFieldComparison[];
  readonly differsOn: readonly ImportFieldId[];
  readonly message: string;
}

/** Every proposal for one row, in a stable order. An empty list is the ordinary no-match result. */
export interface ImportMatchProposal {
  readonly rowNumber: number;
  readonly suggestions: readonly ImportMatchSuggestion[];
}

/** What the review step says when a suggestion shares more than one kind of value with the row. */
const SIGNAL_NOUNS: Readonly<Record<ImportMatchSignalKind, string>> = {
  email: "an email address",
  phone: "a phone number",
  "source-reference": "a source reference",
};

/** Separate parts of a comparison key so a value can never compose with the kind beside it. */
const KEY_SEPARATOR = "\u0000";

/**
 * A candidate as it crosses the boundary from the service: the store is JSON, so the shape is
 * re-checked before it is trusted rather than taken from a type alone.
 */
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

/** The field ids, for checking a candidate's field names against the closed vocabulary. */
const KNOWN_FIELD_IDS: ReadonlySet<string> = new Set<string>(IMPORT_FIELD_IDS);

/** A candidate whose shape and field names have been checked, in the form the pass reads most. */
interface ReadCandidate {
  readonly reference: ImportMatchReference;
  readonly visibleFields: ReadonlySet<ImportFieldId>;
  readonly visibleValues: ReadonlyMap<ImportFieldId, readonly string[]>;
  readonly reuse: ImportReuseFact;
}

/**
 * Proposes the existing contacts a row could reuse, matching only on an exactly equal contact-method
 * value or source reference and comparing every field the mapping supplies beside the existing
 * value. Nothing is merged, overwritten or decided, and the list is ordered deterministically so the
 * same row and candidates always propose the same order.
 */
export function suggestMatches(
  row: ImportValidatedRow,
  candidates: readonly ImportMatchCandidate[],
): ImportMatchProposal {
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

    const comparison = row.suppliedFields.map((fieldId) =>
      compareField(fieldId, candidate, incoming),
    );
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

/**
 * The fields that may match, and only those. A name, a postal address, a tag or a household is never
 * a signal: equal-looking names and addresses establish neither identity nor authority, and there is
 * deliberately no fuzzy, phonetic or partial matching anywhere in this module. That absence is a
 * rule rather than an omission, because a near-match would propose a person the file never named.
 */
function signalsFor(row: ImportValidatedRow, candidate: ReadCandidate): ImportMatchSignal[] {
  const signals: ImportMatchSignal[] = [];
  const seen = new Set<string>();

  for (const { fieldId, kind } of MATCH_SIGNAL_FIELDS) {
    if (!candidate.visibleFields.has(fieldId)) continue;
    const existing = new Set(
      (candidate.visibleValues.get(fieldId) ?? []).map((value) => comparableValue(kind, value)),
    );

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

/**
 * Compares one supplied field beside the candidate's value: the same comparison the matcher uses for
 * a signal, and a plain trimmed comparison for every other field, so "differs" means the same thing
 * everywhere in this file.
 */
function compareField(
  fieldId: ImportFieldId,
  candidate: ReadCandidate,
  incoming: ReadonlyMap<ImportFieldId, readonly string[]>,
): ImportFieldComparison {
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

/** Whether two value lists hold the same values, compared as the field compares them. */
function sameValues(
  left: readonly string[],
  right: readonly string[],
  fieldId: ImportFieldId,
): boolean {
  const first = uniqueSorted(left.map((value) => normaliseFor(fieldId, value)));
  const second = uniqueSorted(right.map((value) => normaliseFor(fieldId, value)));
  if (first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
}

/**
 * The form a value is compared in. An email address is folded to ASCII lower case, because its
 * domain is case-insensitive and a case difference is not a difference in whose address it is; every
 * other value is compared trimmed and case-sensitive, and a phone number is never rewritten, because
 * a formatting catalogue is out of scope and a "near" phone would be a fuzzy suggestion.
 */
function normaliseFor(fieldId: ImportFieldId, value: string): string {
  return signalKindOf(fieldId) === "email" ? foldAsciiLower(value.trim()) : value.trim();
}

/** The signal kind a field matches on, or null for a field that is never a match signal. */
function signalKindOf(fieldId: ImportFieldId): ImportMatchSignalKind | null {
  const signal = MATCH_SIGNAL_FIELDS.find((candidate) => candidate.fieldId === fieldId);
  return signal === undefined ? null : signal.kind;
}

/** The comparable form of a value for one signal kind. */
function comparableValue(kind: ImportMatchSignalKind, value: string): string {
  const trimmed = value.trim();
  return kind === "email" ? foldAsciiLower(trimmed) : trimmed;
}

/**
 * Lower-cases A–Z only. A locale- or Unicode-table-dependent case fold could make the same two
 * addresses compare differently on different machines, and a match must not depend on that.
 */
function foldAsciiLower(value: string): string {
  let folded = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    folded += code >= 0x41 && code <= 0x5a ? String.fromCodePoint(code + 0x20) : character;
  }
  return folded;
}

/** The values the row supplies per field, trimmed, in column order. */
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

/** A candidate re-checked against the boundary schema, or null when it cannot be trusted. */
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

  const reuseFact: ImportReuseFact = reuse.permitted
    ? { permitted: true }
    : { permitted: false, reason: reuse.reason };

  return {
    reference: { system: reference.system, reference: reference.reference },
    visibleFields: new Set(readable),
    visibleValues: values,
    reuse: reuseFact,
  };
}

/** The field id a value names, or null when the closed vocabulary does not hold it. */
function fieldIdOf(value: string): ImportFieldId | null {
  if (!KNOWN_FIELD_IDS.has(value)) return null;
  return IMPORT_FIELD_IDS.find((fieldId) => fieldId === value) ?? null;
}

/** Suggestions in reference order: the documented tiebreak when two candidates match one row. */
function byReference(left: ImportMatchSuggestion, right: ImportMatchSuggestion): number {
  return (
    compareText(left.reference.system, right.reference.system) ||
    compareText(left.reference.reference, right.reference.reference)
  );
}

/**
 * Code-unit ordering, never `localeCompare`: a locale-dependent sort would propose the same two
 * candidates in a different order on a machine with a different default locale.
 */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The values, deduplicated and ordered by code unit so a comparison never depends on input order. */
function uniqueSorted(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.sort(compareText);
}

/** "a", "a and b", or "a, b and c" — the shape a message reads best in. */
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

// ---------------------------------------------------------------------------------------------
// Phase C: what this file deliberately does not do
// ---------------------------------------------------------------------------------------------
//
// Nothing here creates a consent record, a membership, an audience entry, a gift, a commitment, a
// task, an interaction, a note or an identity, and nothing here decides a row's fate: `decide.ts`
// records the worker's per-row decision and `receipt.ts` records what happened at acceptance. No
// function authorises anything — permission arrives with a candidate as a fact the service resolved,
// and a candidate without that fact is excluded. Nothing claims the file is safe or validated
// either: a successful local parse is not a safety qualification, and the synthetic-files label
// belongs to the import feature.
