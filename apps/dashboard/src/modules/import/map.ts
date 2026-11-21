/**
 * Contact import, step two: propose which column of a parsed CSV could supply which contact field, and
 * turn that suggestion into a mapping the worker has confirmed.
 */
import type { ParsedCsvFile } from "./parse";
// Phase A: the closed target vocabulary
/** The import's whole field vocabulary: the partner-record facts one contact row may supply, and nothing else. */
export type ImportFieldId = "display-name" | "name-given" | "name-family" | "name-organization" | "contact-email" | "contact-phone" | "contact-postal" | "restriction" | "tag" | "source-reference";
/** The partner-record key a field supplies (AAP 0.6.2). */
export type ImportFieldTarget = "displayName" | "nameParts" | "contactMethods" | "restrictions" | "tags" | "source";
/** The `contactMethods[].kind` a contact-method field supplies; null for every other field. */
export type ImportContactKind = "email" | "phone" | "postal";

export interface ImportFieldDescriptor {
  readonly id: ImportFieldId;
  readonly label: string;
  readonly target: ImportFieldTarget;
  readonly contactKind: ImportContactKind | null;
  readonly cardinality: "single" | "multi";
  readonly repeatableAcrossColumns: boolean;
  readonly aliases: readonly string[];
  readonly note: string;
}
/** The vocabulary in display order. */
export const IMPORT_FIELD_VOCABULARY: readonly ImportFieldDescriptor[] = [
  {
    id: "display-name",
    label: "Display name",
    target: "displayName",
    contactKind: null,
    cardinality: "single",
    repeatableAcrossColumns: false,
    aliases: ["name", "display name", "displayname", "full name", "fullname", "contact name", "preferred name"],
    note: "The name the contact is shown under. It is a label, not an identity: two contacts with the same name stay two contacts.",
  },
  {
    id: "name-given",
    label: "Given name",
    target: "nameParts",
    contactKind: null,
    cardinality: "single",
    repeatableAcrossColumns: false,
    aliases: ["first name", "firstname", "given name", "givenname", "forename"],
    note: "One part of a person's name, kept as it arrived; it is not used to match a person to a record.",
  },
  {
    id: "name-family",
    label: "Family name",
    target: "nameParts",
    contactKind: null,
    cardinality: "single",
    repeatableAcrossColumns: false,
    aliases: ["last name", "lastname", "family name", "familyname", "surname"],
    note: "One part of a person's name, kept as it arrived; sharing a family name proves no household and no relationship.",
  },
  {
    id: "name-organization",
    label: "Organization name",
    target: "nameParts",
    contactKind: null,
    cardinality: "single",
    repeatableAcrossColumns: false,
    aliases: ["organization", "organisation", "organization name", "organisation name", "church", "church name", "company", "company name", "congregation"],
    note: "The name of an organization or church record, never a person's name part: a church is one partner record and its people are separate records.",
  },
  {
    id: "contact-email",
    label: "Email",
    target: "contactMethods",
    contactKind: "email",
    cardinality: "multi",
    repeatableAcrossColumns: true,
    aliases: ["email", "e mail", "email address", "e mail address", "primary email", "secondary email", "work email", "home email", "other email", "email 1", "email 2"],
    note: "A contact method of kind email, held as data on the record. It never joins records, and it is not consent to receive any publication.",
  },
  {
    id: "contact-phone",
    label: "Phone",
    target: "contactMethods",
    contactKind: "phone",
    cardinality: "multi",
    repeatableAcrossColumns: true,
    aliases: ["phone", "phone number", "telephone", "telephone number", "tel", "mobile", "mobile phone", "mobile number", "cell", "cell phone", "work phone", "home phone", "phone 1", "phone 2"],
    note: "A contact method of kind phone, held as data exactly as it arrived. The import reads no format and dials nothing.",
  },
  {
    id: "contact-postal",
    label: "Postal address",
    target: "contactMethods",
    contactKind: "postal",
    cardinality: "multi",
    repeatableAcrossColumns: true,
    aliases: [
      "address",
      "postal address",
      "mailing address",
      "street",
      "street address",
      "address line 1",
      "address line 2",
      "city",
      "town",
      "state",
      "province",
      "region",
      "county",
      "postal code",
      "postcode",
      "post code",
      "zip",
      "zip code",
      "country",
    ],
    note: "A contact method of kind postal. Each mapped column contributes one value; the import never composes an address out of several columns and never geocodes one.",
  },
  {
    id: "restriction",
    label: "Contact restriction",
    target: "restrictions",
    contactKind: null,
    cardinality: "multi",
    repeatableAcrossColumns: true,
    aliases: ["restriction", "restrictions", "contact restriction", "contact restrictions", "do not contact", "do not email", "do not mail", "do not call", "no contact"],
    note: "A negative contact instruction the record carries, kept as text. It is a contactability instruction, not a consent decision for any publisher and purpose.",
  },
  {
    id: "tag",
    label: "Tag",
    target: "tags",
    contactKind: null,
    cardinality: "multi",
    repeatableAcrossColumns: true,
    aliases: ["tag", "tags", "tag list", "tags list", "label", "labels"],
    note: "The worker's own label for their own sorting. A tag is not a stage, an initiative membership or an audience.",
  },
  {
    id: "source-reference",
    label: "Source reference",
    target: "source",
    contactKind: null,
    cardinality: "single",
    repeatableAcrossColumns: false,
    aliases: ["source id", "source reference", "source ref", "sourceid", "external id", "external reference", "contact id", "record id", "crm id", "constituent id", "supporter id"],
    note: "An opaque reference the source system used for this contact, carried as text exactly as it arrived: never parsed, never a join key, and leading zeros are part of the value.",
  },
];
/** Every field id, in vocabulary order, for a caller that renders or reports the whole vocabulary. */
export const IMPORT_FIELD_IDS: readonly ImportFieldId[] = IMPORT_FIELD_VOCABULARY.map((field) => field.id);

function vocabularyField(fieldId: ImportFieldId): ImportFieldDescriptor {
  const field = IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId);
  if (field === undefined) {
    // Unreachable: ImportFieldId is exactly the id union of the table above, so a miss means the
    // two were edited apart. Failing loudly beats returning a mapping with a field it cannot name.
    throw new Error(`import field "${fieldId}" is missing from the vocabulary`);
  }
  return field;
}
// Phase B: reading a header, without ever treating it as an identity
const COMBINING_MARKS = /\p{M}+/gu;
const WORD_BREAKS = /[-_]+/gu;
const WHITESPACE_RUNS = /\s+/gu;
/** Folds a header into the form the alias table is written in: compatibility-decomposed so that full-width forms (`ＥＭＡＩＬ`) and accented spellings (`Émail`) meet their plain ASCII spelling. */
export function normaliseHeader(header: string): string {
  return header.normalize("NFKD").replace(COMBINING_MARKS, "").replace(WORD_BREAKS, " ").toLowerCase().replace(WHITESPACE_RUNS, " ").trim();
}
function headerWords(normalised: string): readonly string[] {
  return normalised.length === 0 ? [] : normalised.split(" ");
}
function containsWordSequence(words: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || sequence.length > words.length) return false;
  for (let start = 0; start + sequence.length <= words.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (words[start + offset] !== sequence[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
const CONSENT_WORDS: readonly string[] = [
  "subscribed",
  "unsubscribed",
  "subscribe",
  "unsubscribe",
  "subscription",
  "subscriptions",
  "consent",
  "consents",
  "consented",
  "newsletter",
  "marketing",
  "optin",
  "optout",
];
const CONSENT_PHRASES: readonly (readonly string[])[] = [
  ["opt", "in"],
  ["opt", "out"],
  ["opted", "in"],
  ["opted", "out"],
  ["opt", "status"],
  ["can", "email"],
  ["can", "mail"],
  ["can", "contact"],
  ["can", "call"],
  ["may", "email"],
  ["may", "contact"],
  ["permission", "to", "email"],
  ["email", "permission"],
  ["mail", "permission"],
  ["email", "status"],
];
const EXCLUDED_TOPIC_WORDS: readonly string[] = [
  "gift",
  "gifts",
  "giving",
  "donation",
  "donations",
  "donated",
  "amount",
  "amounts",
  "total",
  "totals",
  "balance",
  "revenue",
  "stewardship",
  "commitment",
  "commitments",
  "pledge",
  "pledges",
  "recurring",
  "refund",
  "refunds",
  "note",
  "notes",
  "interaction",
  "interactions",
  "meeting",
  "meetings",
  "task",
  "tasks",
  "referral",
  "referrals",
  "initiative",
  "initiatives",
  "membership",
  "memberships",
  "audience",
  "audiences",
  "segment",
  "segments",
  "household",
  "households",
];
function matchConsent(normalised: string): string | null {
  const words = headerWords(normalised);
  for (const word of words) {
    if (CONSENT_WORDS.includes(word)) return word;
  }
  for (const phrase of CONSENT_PHRASES) {
    if (containsWordSequence(words, phrase)) return phrase.join(" ");
  }
  return null;
}
function matchExcludedTopic(normalised: string): string | null {
  const words = headerWords(normalised);
  for (const word of words) {
    if (EXCLUDED_TOPIC_WORDS.includes(word)) return word;
  }
  return null;
}
/** Why a column is not used. */
export type ImportColumnIgnoreReason = "blank-header" | "unrecognised-header" | "consent-preserved-as-data" | "excluded-topic" | "field-declined" | "not-chosen";
/** A column the mapping does not use, kept visible with the factual reason it was left out. */
export interface ImportIgnoredColumn {
  readonly index: number;
  readonly header: string;
  readonly occurrence: number;
  readonly reason: ImportColumnIgnoreReason;
  readonly message: string;
}
type HeaderReading =
  | { readonly kind: "field"; readonly fieldId: ImportFieldId }
  | {
      readonly kind: "ignored";
      readonly reason: ImportColumnIgnoreReason;
      readonly message: string;
    };
function readHeader(header: string): HeaderReading {
  const text = header.trim();
  if (text.length === 0) {
    return {
      kind: "ignored",
      reason: "blank-header",
      message: "This column has no header text, so nothing is known about what it holds and it is left out of the mapping. Name the column in the file and choose the file again.",
    };
  }
  const normalised = normaliseHeader(text);
  const consent = matchConsent(normalised);
  if (consent !== null) {
    return {
      kind: "ignored",
      reason: "consent-preserved-as-data",
      message: `Kept exactly as it arrived and never mapped: "${consent}" is a subscription or consent statement, which this import does not read. A subscription flag is not consent, and importing a contact never subscribes anyone.`,
    };
  }
  const topic = matchExcludedTopic(normalised);
  if (topic !== null) {
    return {
      kind: "ignored",
      reason: "excluded-topic",
      message: `Left out of the mapping: "${topic}" names a fact this contact import never produces — money or a commitment, an activity record or a task, a referral, an initiative membership or an audience. Its values are not read, and the column keeps its place in the file.`,
    };
  }
  for (const field of IMPORT_FIELD_VOCABULARY) {
    if (field.aliases.includes(normalised)) return { kind: "field", fieldId: field.id };
  }
  return {
    kind: "ignored",
    reason: "unrecognised-header",
    message: `No contact field matches "${text}", so the column is left out of the mapping. Rename the header in the file, or choose a field for this column deliberately.`,
  };
}
// Phase B: the suggestion — position is identity, a header is not
/** One parsed column, addressed by position: `index` and `occurrence`, never by `header`. */
export interface ImportColumnMapping {
  readonly index: number;
  readonly header: string;
  readonly occurrence: number;
  readonly normalisedHeader: string;
  readonly suggestedField: ImportFieldId | null;
}
/** A field with the columns that could supply it, in file order; the first is not a preference. */
export interface ImportFieldClaim {
  readonly fieldId: ImportFieldId;
  readonly columnIndexes: readonly number[];
}
/** A single-valued field two or more columns claim, so the worker has to choose one or none. */
export interface ImportFieldAmbiguity extends ImportFieldClaim {
  readonly message: string;
}
/** Header texts carried by more than one column, with every position that carries them. */
export interface ImportRepeatedHeader {
  readonly header: string;
  readonly columnIndexes: readonly number[];
}
/** What step two proposes: every column of the file with the field it could supply, the ordered columns behind each field, the fields that need a choice, the columns left out and why, and the. */
export interface ImportSuggestedMapping {
  readonly columnCount: number;
  readonly columns: readonly ImportColumnMapping[];
  readonly claims: readonly ImportFieldClaim[];
  readonly ambiguous: readonly ImportFieldAmbiguity[];
  readonly ignored: readonly ImportIgnoredColumn[];
  readonly unmapped: readonly ImportFieldId[];
  readonly repeatedHeaders: readonly ImportRepeatedHeader[];
}
/** Proposes a mapping from a parsed file's headers, keeping every repeated header a separate column and every ignored column visible with its reason. */
export function suggestMapping(file: ParsedCsvFile): ImportSuggestedMapping {
  const columns: ImportColumnMapping[] = [];
  const ignored: ImportIgnoredColumn[] = [];
  // Keyed by field id, which is a closed vocabulary — never by header text.
  const claimedByField = new Map<ImportFieldId, number[]>();
  file.headers.forEach((header, offset) => {
    const index = offset + 1;
    const occurrence = occurrenceOf(file.headers, offset, header);
    const reading = readHeader(header);
    const suggestedField = reading.kind === "field" ? reading.fieldId : null;
    columns.push({
      index,
      header,
      occurrence,
      normalisedHeader: normaliseHeader(header),
      suggestedField,
    });
    if (reading.kind === "ignored") {
      ignored.push({ index, header, occurrence, reason: reading.reason, message: reading.message });
      return;
    }
    const claimed = claimedByField.get(reading.fieldId);
    if (claimed === undefined) claimedByField.set(reading.fieldId, [index]);
    else claimed.push(index);
  });
  const claims: ImportFieldClaim[] = [];
  for (const fieldId of IMPORT_FIELD_IDS) {
    const columnIndexes = claimedByField.get(fieldId);
    if (columnIndexes !== undefined) {
      // A copy, so a caller cannot mutate the suggestion through the returned claim.
      claims.push({ fieldId, columnIndexes: [...columnIndexes] });
    }
  }
  const ambiguous: ImportFieldAmbiguity[] = [];
  for (const claim of claims) {
    const field = vocabularyField(claim.fieldId);
    if (field.cardinality !== "single" || claim.columnIndexes.length < 2) continue;
    ambiguous.push({
      fieldId: claim.fieldId,
      columnIndexes: [...claim.columnIndexes],
      message: `Columns ${listPositions(claim.columnIndexes)} all look like "${field.label}", which holds a single value. Choose the column to use, or decline the field.`,
    });
  }
  const unmapped = IMPORT_FIELD_IDS.filter((fieldId) => !claimedByField.has(fieldId));
  return {
    columnCount: columns.length,
    columns,
    claims,
    ambiguous,
    ignored,
    unmapped,
    repeatedHeaders: repeatedHeadersOf(file.headers),
  };
}
function occurrenceOf(headers: readonly string[], offset: number, header: string): number {
  let occurrence = 1;
  for (let earlier = 0; earlier < offset; earlier += 1) {
    if (headers[earlier] === header) occurrence += 1;
  }
  return occurrence;
}
function repeatedHeadersOf(headers: readonly string[]): ImportRepeatedHeader[] {
  const repeated: ImportRepeatedHeader[] = [];
  headers.forEach((header, offset) => {
    const seenEarlier = headers.slice(0, offset).some((earlier) => earlier === header);
    if (seenEarlier) return;
    const columnIndexes: number[] = [];
    headers.forEach((candidate, candidateOffset) => {
      if (candidate === header) columnIndexes.push(candidateOffset + 1);
    });
    if (columnIndexes.length > 1) repeated.push({ header, columnIndexes });
  });
  return repeated;
}
function listPositions(columnIndexes: readonly number[]): string {
  const [first] = columnIndexes;
  if (first === undefined) return "none";
  if (columnIndexes.length === 1) return String(first);
  const head = columnIndexes
    .slice(0, -1)
    .map((columnIndex) => String(columnIndex))
    .join(", ");
  const last = columnIndexes[columnIndexes.length - 1];
  return `${head} and ${String(last)}`;
}
// Phase C: turning the suggestion into a confirmed mapping
/** One decision a worker makes about one field: supply it from these columns, or leave it out. */
export type ImportMappingDecision =
  | {
      readonly kind: "choose";
      readonly fieldId: ImportFieldId;
      readonly columnIndexes: readonly number[];
    }
  | { readonly kind: "decline"; readonly fieldId: ImportFieldId };
/** One confirmed pair: this field is supplied by the column at this 1-based position. */
export interface ImportFieldAssignment {
  readonly fieldId: ImportFieldId;
  readonly columnIndex: number;
}
/** The mapping a worker confirmed: explicit pairs, plus every unused column and its reason. */
export interface ImportConfirmedMapping {
  readonly columnCount: number;
  readonly assignments: readonly ImportFieldAssignment[];
  readonly fields: readonly ImportFieldId[];
  readonly declined: readonly ImportFieldId[];
  readonly unmapped: readonly ImportFieldId[];
  readonly ignored: readonly ImportIgnoredColumn[];
}
export type ImportMappingRefusalCode = "field-ambiguous" | "field-not-single" | "column-shared" | "column-not-found" | "column-excluded" | "decision-duplicated" | "decision-empty";
/** A reason the mapping cannot be confirmed, naming the field and the exact positions involved. */
export interface ImportMappingRefusal {
  readonly code: ImportMappingRefusalCode;
  readonly fieldId: ImportFieldId | null;
  readonly columnIndexes: readonly number[];
  readonly message: string;
}
export type ImportConfirmMappingResult = { readonly ok: true; readonly mapping: ImportConfirmedMapping } | { readonly ok: false; readonly refusals: ImportMappingRefusal[] };
/** Confirms a suggestion, applying the worker's decisions, and returns either the explicit mapping or every problem that stops it. */
export function confirmMapping(suggestion: ImportSuggestedMapping, decisions: readonly ImportMappingDecision[] = []): ImportConfirmMappingResult {
  const refusals: ImportMappingRefusal[] = [];
  const decisionByField = decisionsByField(decisions, refusals);
  const assignmentByField = new Map<ImportFieldId, number[]>();
  const declined: ImportFieldId[] = [];
  for (const fieldId of IMPORT_FIELD_IDS) {
    const field = vocabularyField(fieldId);
    const decision = decisionByField.get(fieldId);
    if (decision?.kind === "decline") {
      declined.push(fieldId);
      continue;
    }
    if (decision?.kind === "choose") {
      // A position named twice is one position: the confirmed mapping holds one pair per field and
      // column, and repeating it never widens what the file supplies.
      const chosen = uniquePositions(decision.columnIndexes);
      if (chosen.length === 0) {
        refusals.push({
          code: "decision-empty",
          fieldId,
          columnIndexes: [],
          message: `No column was chosen for "${field.label}". Choose at least one column, or decline the field so leaving it out is deliberate.`,
        });
        continue;
      }
      assignmentByField.set(fieldId, chosen);
      continue;
    }
    const claim = suggestion.claims.find((candidate) => candidate.fieldId === fieldId);
    if (claim === undefined) continue;
    if (field.cardinality === "single" && claim.columnIndexes.length > 1) {
      refusals.push({
        code: "field-ambiguous",
        fieldId,
        columnIndexes: [...claim.columnIndexes],
        message: `Columns ${listPositions(claim.columnIndexes)} could each supply "${field.label}", which holds a single value. Choose one column for it, or decline the field, before confirming.`,
      });
      continue;
    }
    assignmentByField.set(fieldId, [...claim.columnIndexes]);
  }
  const fieldsByColumn = new Map<number, ImportFieldId[]>();
  for (const fieldId of IMPORT_FIELD_IDS) {
    const columnIndexes = assignmentByField.get(fieldId);
    if (columnIndexes === undefined) continue;
    const field = vocabularyField(fieldId);
    if (field.cardinality === "single" && columnIndexes.length > 1) {
      refusals.push({
        code: "field-not-single",
        fieldId,
        columnIndexes: [...columnIndexes],
        message: `"${field.label}" holds a single value, but columns ${listPositions(columnIndexes)} are all assigned to it. Keep one column.`,
      });
    }
    for (const columnIndex of columnIndexes) {
      const column = suggestion.columns.find((candidate) => candidate.index === columnIndex);
      if (column === undefined) {
        refusals.push({
          code: "column-not-found",
          fieldId,
          columnIndexes: [columnIndex],
          message: `Column ${columnIndex} is not in this file, which has ${suggestion.columnCount} column(s). Choose a column the file actually has.`,
        });
        continue;
      }
      const blocked = blockedColumn(column, suggestion.ignored);
      if (blocked !== null) {
        refusals.push({
          code: "column-excluded",
          fieldId,
          columnIndexes: [columnIndex],
          message: `Column ${columnIndex} ("${column.header}") cannot be mapped to "${field.label}": ${blocked.message}`,
        });
        continue;
      }
      const claimants = fieldsByColumn.get(columnIndex);
      if (claimants === undefined) fieldsByColumn.set(columnIndex, [fieldId]);
      else claimants.push(fieldId);
    }
  }
  for (const [columnIndex, fieldIds] of fieldsByColumn) {
    if (fieldIds.length < 2) continue;
    const labels = fieldIds.map((fieldId) => `"${vocabularyField(fieldId).label}"`).join(" and ");
    refusals.push({
      code: "column-shared",
      fieldId: null,
      columnIndexes: [columnIndex],
      message: `Column ${columnIndex} is claimed by ${labels}; one column supplies one field.`,
    });
  }
  if (refusals.length > 0) return { ok: false, refusals };
  const assignments: ImportFieldAssignment[] = [];
  const fields: ImportFieldId[] = [];
  const unmapped: ImportFieldId[] = [];
  for (const fieldId of IMPORT_FIELD_IDS) {
    const columnIndexes = assignmentByField.get(fieldId);
    if (columnIndexes === undefined) {
      if (!declined.includes(fieldId)) unmapped.push(fieldId);
      continue;
    }
    fields.push(fieldId);
    for (const columnIndex of ascending(columnIndexes)) {
      assignments.push({ fieldId, columnIndex });
    }
  }
  return {
    ok: true,
    mapping: {
      columnCount: suggestion.columnCount,
      assignments,
      fields,
      declined,
      unmapped,
      ignored: ignoredColumnsFor(suggestion, assignmentByField, declined),
    },
  };
}
function decisionsByField(decisions: readonly ImportMappingDecision[], refusals: ImportMappingRefusal[]): Map<ImportFieldId, ImportMappingDecision> {
  const byField = new Map<ImportFieldId, ImportMappingDecision>();
  for (const decision of decisions) {
    if (byField.has(decision.fieldId)) {
      refusals.push({
        code: "decision-duplicated",
        fieldId: decision.fieldId,
        columnIndexes: [],
        message: `Two decisions were supplied for "${vocabularyField(decision.fieldId).label}". Keep one: choose its columns, or decline it.`,
      });
      continue;
    }
    byField.set(decision.fieldId, decision);
  }
  return byField;
}
function uniquePositions(columnIndexes: readonly number[]): number[] {
  const unique: number[] = [];
  for (const columnIndex of columnIndexes) {
    if (!unique.includes(columnIndex)) unique.push(columnIndex);
  }
  return unique;
}
function ascending(columnIndexes: readonly number[]): number[] {
  return [...columnIndexes].sort((left, right) => left - right);
}
function blockedColumn(column: ImportColumnMapping, ignoredColumns: readonly ImportIgnoredColumn[]): ImportIgnoredColumn | null {
  if (column.suggestedField !== null) return null;
  const recorded = ignoredColumns.find((candidate) => candidate.index === column.index);
  if (recorded === undefined) return null;
  const blocked = recorded.reason === "blank-header" || recorded.reason === "consent-preserved-as-data" || recorded.reason === "excluded-topic";
  return blocked ? recorded : null;
}
function ignoredColumnsFor(suggestion: ImportSuggestedMapping, assignmentByField: ReadonlyMap<ImportFieldId, readonly number[]>, declined: readonly ImportFieldId[]): ImportIgnoredColumn[] {
  const usedColumns: number[] = [];
  for (const columnIndexes of assignmentByField.values()) usedColumns.push(...columnIndexes);
  const ignored: ImportIgnoredColumn[] = [];
  for (const column of suggestion.columns) {
    if (usedColumns.includes(column.index)) continue;
    const recorded = suggestion.ignored.find((candidate) => candidate.index === column.index);
    if (recorded !== undefined) {
      ignored.push(recorded);
      continue;
    }
    const fieldId = column.suggestedField;
    if (fieldId === null) continue;
    const field = vocabularyField(fieldId);
    if (declined.includes(fieldId)) {
      ignored.push({
        index: column.index,
        header: column.header,
        occurrence: column.occurrence,
        reason: "field-declined",
        message: `Left out because you chose not to import "${field.label}".`,
      });
      continue;
    }
    const takenBy = assignmentByField.get(fieldId);
    const instead = takenBy === undefined || takenBy.length === 0 ? "" : ` It is supplied by column ${listPositions(ascending(takenBy))} instead.`;
    ignored.push({
      index: column.index,
      header: column.header,
      occurrence: column.occurrence,
      reason: "not-chosen",
      message: `Not used in the confirmed mapping: column ${column.index} could supply "${field.label}" and was not chosen.${instead}`,
    });
  }
  return ignored;
}
// Phase D: what this file deliberately does not do
//
// A mapping describes columns, never people. Nothing here compares two cell values, suggests that a
// row matches a contact the worker already has, or says a row will "update" one: reuse is a decision
// the worker makes in `decide.ts`, on a suggestion that comes from `validate.ts`, and this file never
// states or implies it. No message claims the file is safe or validated either — a successful local
// parse is not a safety qualification, and the synthetic-files label belongs to the import feature.
