import type { ParsedCsvFile } from "./parse";
export type ImportFieldId = "display-name" | "name-given" | "name-family" | "name-organization" | "contact-email" | "contact-phone" | "contact-postal" | "restriction" | "tag" | "source-reference";
export type ImportFieldTarget = "displayName" | "nameParts" | "contactMethods" | "restrictions" | "tags" | "source";
export type ImportContactKind = "email" | "phone" | "postal";
export type ImportFieldDescriptor = { readonly id: ImportFieldId; readonly label: string; readonly target: ImportFieldTarget; readonly contactKind: ImportContactKind | null; readonly cardinality: "single" | "multi"; readonly repeatableAcrossColumns: boolean; readonly aliases: readonly string[]; readonly note: string };
type ImportFieldRow = readonly [ImportFieldId, string, ImportFieldTarget, ImportContactKind | null, readonly string[], string];
const MULTI_VALUE_TARGETS: ReadonlySet<ImportFieldTarget> = new Set<ImportFieldTarget>(["contactMethods", "restrictions", "tags"]);
const ORGANIZATION_NAME_ALIASES: readonly string[] = ["organization", "organisation", "organization name", "organisation name", "church", "church name", "company", "company name", "congregation"];
const EMAIL_ALIASES: readonly string[] = ["email", "e mail", "email address", "e mail address", "primary email", "secondary email", "work email", "home email", "other email", "email 1", "email 2"];
const PHONE_ALIASES: readonly string[] = ["phone", "phone number", "telephone", "telephone number", "tel", "mobile", "mobile phone", "mobile number", "cell", "cell phone", "work phone", "home phone", "phone 1", "phone 2"];
const POSTAL_ALIASES: readonly string[] = ["address", "postal address", "mailing address", "street", "street address", "address line 1", "address line 2", "city", "town", "state", "province", "region", "county", "postal code", "postcode", "post code", "zip", "zip code", "country"];
const RESTRICTION_ALIASES: readonly string[] = ["restriction", "restrictions", "contact restriction", "contact restrictions", "do not contact", "do not email", "do not mail", "do not call", "no contact"];
const SOURCE_REFERENCE_ALIASES: readonly string[] = ["source id", "source reference", "source ref", "sourceid", "external id", "external reference", "contact id", "record id", "crm id", "constituent id", "supporter id"];
const IMPORT_FIELD_ROWS: readonly ImportFieldRow[] = [
  ["display-name", "Display name", "displayName", null, ["name", "display name", "displayname", "full name", "fullname", "contact name", "preferred name"], "The name the contact is shown under. It is a label, not an identity: two contacts with the same name stay two contacts."],
  ["name-given", "Given name", "nameParts", null, ["first name", "firstname", "given name", "givenname", "forename"], "One part of a person's name, kept as it arrived; it is not used to match a person to a record."],
  ["name-family", "Family name", "nameParts", null, ["last name", "lastname", "family name", "familyname", "surname"], "One part of a person's name, kept as it arrived; sharing a family name proves no household and no relationship."],
  ["name-organization", "Organization name", "nameParts", null, ORGANIZATION_NAME_ALIASES, "The name of an organization or church record, never a person's name part: a church is one partner record and its people are separate records."],
  ["contact-email", "Email", "contactMethods", "email", EMAIL_ALIASES, "A contact method of kind email, held as data on the record. It never joins records, and it is not consent to receive any publication."],
  ["contact-phone", "Phone", "contactMethods", "phone", PHONE_ALIASES, "A contact method of kind phone, held as data exactly as it arrived. The import reads no format and dials nothing."],
  ["contact-postal", "Postal address", "contactMethods", "postal", POSTAL_ALIASES, "A contact method of kind postal. Each mapped column contributes one value; the import never composes an address out of several columns and never geocodes one."],
  ["restriction", "Contact restriction", "restrictions", null, RESTRICTION_ALIASES, "A negative contact instruction the record carries, kept as text. It is a contactability instruction, not a consent decision for any publisher and purpose."],
  ["tag", "Tag", "tags", null, ["tag", "tags", "tag list", "tags list", "label", "labels"], "The worker's own label for their own sorting. A tag is not a stage, an initiative membership or an audience."],
  ["source-reference", "Source reference", "source", null, SOURCE_REFERENCE_ALIASES, "An opaque reference the source system used for this contact, carried as text exactly as it arrived: never parsed, never a join key, and leading zeros are part of the value."],
];
const fieldDescriptorOf = ([id, label, target, contactKind, aliases, note]: ImportFieldRow): ImportFieldDescriptor => ({ id, label, target, contactKind, cardinality: MULTI_VALUE_TARGETS.has(target) ? "multi" : "single", repeatableAcrossColumns: MULTI_VALUE_TARGETS.has(target), aliases, note });
export const IMPORT_FIELD_VOCABULARY: readonly ImportFieldDescriptor[] = IMPORT_FIELD_ROWS.map(fieldDescriptorOf);
export const IMPORT_FIELD_IDS: readonly ImportFieldId[] = IMPORT_FIELD_VOCABULARY.map((field) => field.id);
function vocabularyField(fieldId: ImportFieldId): ImportFieldDescriptor {
  const field = IMPORT_FIELD_VOCABULARY.find((candidate) => candidate.id === fieldId);
  if (field === undefined) throw new Error(`import field "${fieldId}" is missing from the vocabulary`);
  return field;
}
const COMBINING_MARKS = /\p{M}+/gu;
const WORD_BREAKS = /[-_]+/gu;
const WHITESPACE_RUNS = /\s+/gu;
export const normaliseHeader = (header: string): string => header.normalize("NFKD").replace(COMBINING_MARKS, "").replace(WORD_BREAKS, " ").toLowerCase().replace(WHITESPACE_RUNS, " ").trim();
const headerWords = (normalised: string): readonly string[] => (normalised.length === 0 ? [] : normalised.split(" "));
const containsWordSequence = (words: readonly string[], sequence: readonly string[]): boolean => sequence.length > 0 && sequence.length <= words.length && words.some((_, start) => start + sequence.length <= words.length && sequence.every((word, offset) => words[start + offset] === word));
const CONSENT_WORDS: readonly string[] = ["subscribed", "unsubscribed", "subscribe", "unsubscribe", "subscription", "subscriptions", "consent", "consents", "consented", "newsletter", "marketing", "optin", "optout"];
const CONSENT_TOPIC_PHRASES = "opt in|opt out|opted in|opted out|opt status|can email|can mail|can contact|can call|may email|may contact|permission to email|email permission|mail permission|email status";
const CONSENT_PHRASES: readonly (readonly string[])[] = CONSENT_TOPIC_PHRASES.split("|").map((phrase) => phrase.split(" "));
const EXCLUDED_TOPIC_TEXT =
  "gift gifts giving donation donations donated amount amounts total totals balance revenue stewardship commitment commitments pledge pledges recurring refund refunds note notes interaction interactions meeting meetings task tasks referral referrals initiative initiatives membership memberships audience audiences segment segments household households";
const EXCLUDED_TOPIC_WORDS: readonly string[] = EXCLUDED_TOPIC_TEXT.split(" ");
const firstNamedWord = (words: readonly string[], names: readonly string[]): string | null => words.find((word) => names.includes(word)) ?? null;
const matchConsent = (normalised: string): string | null => {
  const words = headerWords(normalised);
  return firstNamedWord(words, CONSENT_WORDS) ?? CONSENT_PHRASES.find((candidate) => containsWordSequence(words, candidate))?.join(" ") ?? null;
};
const matchExcludedTopic = (normalised: string): string | null => firstNamedWord(headerWords(normalised), EXCLUDED_TOPIC_WORDS);
export type ImportColumnIgnoreReason = "blank-header" | "unrecognised-header" | "consent-preserved-as-data" | "excluded-topic" | "field-declined" | "not-chosen";
export type ImportIgnoredColumn = { readonly index: number; readonly header: string; readonly occurrence: number; readonly reason: ImportColumnIgnoreReason; readonly message: string };
type HeaderReading = { readonly kind: "field"; readonly fieldId: ImportFieldId } | { readonly kind: "ignored"; readonly reason: ImportColumnIgnoreReason; readonly message: string };
const ignoredReading = (reason: ImportColumnIgnoreReason, message: string): HeaderReading => ({ kind: "ignored", reason, message });
function readHeader(header: string): HeaderReading {
  const text = header.trim();
  if (text.length === 0) return ignoredReading("blank-header", "This column has no header text, so nothing is known about what it holds and it is left out of the mapping. Name the column in the file and choose the file again.");
  const normalised = normaliseHeader(text);
  const consent = matchConsent(normalised);
  if (consent !== null) return ignoredReading("consent-preserved-as-data", `Kept exactly as it arrived and never mapped: "${consent}" is a subscription or consent statement, which this import does not read. A subscription flag is not consent, and importing a contact never subscribes anyone.`);
  const topic = matchExcludedTopic(normalised);
  if (topic !== null)
    return ignoredReading("excluded-topic", `Left out of the mapping: "${topic}" names a fact this contact import never produces — money or a commitment, an activity record or a task, a referral, an initiative membership or an audience. Its values are not read, and the column keeps its place in the file.`);
  for (const field of IMPORT_FIELD_VOCABULARY) if (field.aliases.includes(normalised)) return { kind: "field", fieldId: field.id };
  return ignoredReading("unrecognised-header", `No contact field matches "${text}", so the column is left out of the mapping. Rename the header in the file, or choose a field for this column deliberately.`);
}
export type ImportColumnMapping = { readonly index: number; readonly header: string; readonly occurrence: number; readonly normalisedHeader: string; readonly suggestedField: ImportFieldId | null };
export type ImportFieldClaim = { readonly fieldId: ImportFieldId; readonly columnIndexes: readonly number[] };
export type ImportFieldAmbiguity = ImportFieldClaim & { readonly message: string };
export type ImportRepeatedHeader = { readonly header: string; readonly columnIndexes: readonly number[] };
export interface ImportSuggestedMapping {
  readonly columnCount: number;
  readonly columns: readonly ImportColumnMapping[];
  readonly claims: readonly ImportFieldClaim[];
  readonly ambiguous: readonly ImportFieldAmbiguity[];
  readonly ignored: readonly ImportIgnoredColumn[];
  readonly unmapped: readonly ImportFieldId[];
  readonly repeatedHeaders: readonly ImportRepeatedHeader[];
}
/** Proposes a mapping from a parsed file's headers, keeping every repeated header a separate column and every ignored column visible with its reason. */ export function suggestMapping(file: ParsedCsvFile): ImportSuggestedMapping {
  const columns: ImportColumnMapping[] = [];
  const ignored: ImportIgnoredColumn[] = [];
  const claimedByField = new Map<ImportFieldId, number[]>();
  file.headers.forEach((header, offset) => {
    const index = offset + 1;
    const occurrence = occurrenceOf(file.headers, offset, header);
    const reading = readHeader(header);
    const suggestedField = reading.kind === "field" ? reading.fieldId : null;
    columns.push({ index, header, occurrence, normalisedHeader: normaliseHeader(header), suggestedField });
    if (reading.kind === "ignored") return void ignored.push({ index, header, occurrence, reason: reading.reason, message: reading.message });
    const claimed = claimedByField.get(reading.fieldId);
    if (claimed === undefined) claimedByField.set(reading.fieldId, [index]);
    else claimed.push(index);
  });
  const claims: ImportFieldClaim[] = IMPORT_FIELD_IDS.flatMap((fieldId) => {
    const columnIndexes = claimedByField.get(fieldId);
    return columnIndexes === undefined ? [] : [{ fieldId, columnIndexes: [...columnIndexes] }];
  });
  const ambiguous: ImportFieldAmbiguity[] = claims.flatMap((claim) => {
    const field = vocabularyField(claim.fieldId);
    return field.cardinality !== "single" || claim.columnIndexes.length < 2 ? [] : [{ fieldId: claim.fieldId, columnIndexes: [...claim.columnIndexes], message: `Columns ${listPositions(claim.columnIndexes)} all look like "${field.label}", which holds a single value. Choose the column to use, or decline the field.` }];
  });
  const unmapped = IMPORT_FIELD_IDS.filter((fieldId) => !claimedByField.has(fieldId));
  return { columnCount: columns.length, columns, claims, ambiguous, ignored, unmapped, repeatedHeaders: repeatedHeadersOf(file.headers) };
}
const occurrenceOf = (headers: readonly string[], offset: number, header: string): number => headers.slice(0, offset).filter((earlier) => earlier === header).length + 1;
const repeatedHeadersOf = (headers: readonly string[]): ImportRepeatedHeader[] => uniqueInOrder(headers).flatMap((header) => (headers.filter((candidate) => candidate === header).length > 1 ? [{ header, columnIndexes: headers.flatMap((candidate, offset) => (candidate === header ? [offset + 1] : [])) }] : []));
/** One readable list of the values in the order given, each named once: "a", "a and b", "a, b and c", and an empty string when there is nothing to name. */ export function listOf(values: readonly string[]): string {
  const unique = uniqueInOrder(values);
  const [first] = unique;
  if (first === undefined) return "";
  return unique.length === 1 ? first : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1] ?? ""}`;
}
/** The values in the order they arrived, each kept once: the one de-duplication every import step states its lists with. */ export function uniqueInOrder<Value>(values: readonly Value[]): Value[] {
  const unique: Value[] = [];
  for (const value of values) if (!unique.includes(value)) unique.push(value);
  return unique;
}
const listPositions = (columnIndexes: readonly number[]): string => listOf(columnIndexes.map(String)) || "none";
export type ImportMappingDecision = { readonly kind: "choose"; readonly fieldId: ImportFieldId; readonly columnIndexes: readonly number[] } | { readonly kind: "decline"; readonly fieldId: ImportFieldId };
export type ImportFieldAssignment = { readonly fieldId: ImportFieldId; readonly columnIndex: number };
export type ImportConfirmedMapping = { readonly columnCount: number; readonly assignments: readonly ImportFieldAssignment[]; readonly fields: readonly ImportFieldId[]; readonly declined: readonly ImportFieldId[]; readonly unmapped: readonly ImportFieldId[]; readonly ignored: readonly ImportIgnoredColumn[] };
export type ImportMappingRefusalCode = "field-ambiguous" | "field-not-single" | "column-shared" | "column-not-found" | "column-excluded" | "decision-duplicated" | "decision-empty";
export type ImportMappingRefusal = { readonly code: ImportMappingRefusalCode; readonly fieldId: ImportFieldId | null; readonly columnIndexes: readonly number[]; readonly message: string };
export type ImportConfirmMappingResult = { readonly ok: true; readonly mapping: ImportConfirmedMapping } | { readonly ok: false; readonly refusals: ImportMappingRefusal[] };
/** Confirms a suggestion, applying the worker's decisions, and returns either the explicit mapping or every problem that stops it. */
export function confirmMapping(suggestion: ImportSuggestedMapping, decisions: readonly ImportMappingDecision[] = []): ImportConfirmMappingResult {
  const refusals: ImportMappingRefusal[] = [];
  const assignmentByField = new Map<ImportFieldId, number[]>();
  const declined: ImportFieldId[] = [];
  for (const fieldId of IMPORT_FIELD_IDS) {
    const field = vocabularyField(fieldId);
    const decision = decisionsByField(decisions, refusals).get(fieldId);
    if (decision?.kind === "decline") {
      declined.push(fieldId);
      continue;
    }
    if (decision?.kind === "choose") {
      const chosen = uniqueInOrder(decision.columnIndexes);
      if (chosen.length === 0) {
        refusals.push({ code: "decision-empty", fieldId, columnIndexes: [], message: `No column was chosen for "${field.label}". Choose at least one column, or decline the field so leaving it out is deliberate.` });
        continue;
      }
      assignmentByField.set(fieldId, chosen);
      continue;
    }
    const claim = suggestion.claims.find((candidate) => candidate.fieldId === fieldId);
    if (claim === undefined) continue;
    if (field.cardinality === "single" && claim.columnIndexes.length > 1) {
      refusals.push({ code: "field-ambiguous", fieldId, columnIndexes: [...claim.columnIndexes], message: `Columns ${listPositions(claim.columnIndexes)} could each supply "${field.label}", which holds a single value. Choose one column for it, or decline the field, before confirming.` });
      continue;
    }
    assignmentByField.set(fieldId, [...claim.columnIndexes]);
  }
  const fieldsByColumn = new Map<number, ImportFieldId[]>();
  for (const fieldId of IMPORT_FIELD_IDS) {
    const columnIndexes = assignmentByField.get(fieldId);
    if (columnIndexes === undefined) continue;
    const field = vocabularyField(fieldId);
    if (field.cardinality === "single" && columnIndexes.length > 1) refusals.push({ code: "field-not-single", fieldId, columnIndexes: [...columnIndexes], message: `"${field.label}" holds a single value, but columns ${listPositions(columnIndexes)} are all assigned to it. Keep one column.` });
    for (const columnIndex of columnIndexes) {
      const column = suggestion.columns.find((candidate) => candidate.index === columnIndex);
      if (column === undefined) {
        refusals.push({ code: "column-not-found", fieldId, columnIndexes: [columnIndex], message: `Column ${columnIndex} is not in this file, which has ${suggestion.columnCount} column(s). Choose a column the file actually has.` });
        continue;
      }
      const blocked = blockedColumn(column, suggestion.ignored);
      if (blocked !== null) {
        refusals.push({ code: "column-excluded", fieldId, columnIndexes: [columnIndex], message: `Column ${columnIndex} ("${column.header}") cannot be mapped to "${field.label}": ${blocked.message}` });
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
    refusals.push({ code: "column-shared", fieldId: null, columnIndexes: [columnIndex], message: `Column ${columnIndex} is claimed by ${labels}; one column supplies one field.` });
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
    for (const columnIndex of ascending(columnIndexes)) assignments.push({ fieldId, columnIndex });
  }
  return { ok: true, mapping: { columnCount: suggestion.columnCount, assignments, fields, declined, unmapped, ignored: ignoredColumnsFor(suggestion, assignmentByField, declined) } };
}
function decisionsByField(decisions: readonly ImportMappingDecision[], refusals: ImportMappingRefusal[]): Map<ImportFieldId, ImportMappingDecision> {
  const byField = new Map<ImportFieldId, ImportMappingDecision>();
  for (const decision of decisions) {
    if (byField.has(decision.fieldId)) {
      refusals.push({ code: "decision-duplicated", fieldId: decision.fieldId, columnIndexes: [], message: `Two decisions were supplied for "${vocabularyField(decision.fieldId).label}". Keep one: choose its columns, or decline it.` });
      continue;
    }
    byField.set(decision.fieldId, decision);
  }
  return byField;
}
const ascending = (columnIndexes: readonly number[]): number[] => [...columnIndexes].sort((left, right) => left - right);
const BLOCKING_IGNORE_REASONS: ReadonlySet<ImportColumnIgnoreReason> = new Set<ImportColumnIgnoreReason>(["blank-header", "consent-preserved-as-data", "excluded-topic"]);
const blockedColumn = (column: ImportColumnMapping, ignoredColumns: readonly ImportIgnoredColumn[]): ImportIgnoredColumn | null => (column.suggestedField === null ? (ignoredColumns.find((candidate) => candidate.index === column.index && BLOCKING_IGNORE_REASONS.has(candidate.reason)) ?? null) : null);
function ignoredColumnsFor(suggestion: ImportSuggestedMapping, assignmentByField: ReadonlyMap<ImportFieldId, readonly number[]>, declined: readonly ImportFieldId[]): ImportIgnoredColumn[] {
  const usedColumns = [...assignmentByField.values()].flat();
  return suggestion.columns.flatMap((column): ImportIgnoredColumn[] => {
    if (usedColumns.includes(column.index)) return [];
    const recorded = suggestion.ignored.find((candidate) => candidate.index === column.index);
    if (recorded !== undefined) return [recorded];
    const fieldId = column.suggestedField;
    if (fieldId === null) return [];
    const field = vocabularyField(fieldId);
    if (declined.includes(fieldId)) return [{ index: column.index, header: column.header, occurrence: column.occurrence, reason: "field-declined", message: `Left out because you chose not to import "${field.label}".` }];
    const takenBy = assignmentByField.get(fieldId);
    const instead = takenBy === undefined || takenBy.length === 0 ? "" : ` It is supplied by column ${listPositions(ascending(takenBy))} instead.`;
    return [{ index: column.index, header: column.header, occurrence: column.occurrence, reason: "not-chosen", message: `Not used in the confirmed mapping: column ${column.index} could supply "${field.label}" and was not chosen.${instead}` }];
  });
}
