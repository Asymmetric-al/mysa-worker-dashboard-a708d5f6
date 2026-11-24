/** Proves the contact-import limits and the two rules that sit beside them (success criterion 4): every limit is decided on the file before anything is processed. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMPORT_DECISION_KINDS, createDecisionSet, recordDecision, summariseDecisions, type ImportDecisionContext, type ImportDecisionInput } from "@/modules/import/decide";
import { confirmMapping, suggestMapping, type ImportConfirmedMapping, type ImportSuggestedMapping } from "@/modules/import/map";
import { IMPORT_LIMIT_DESCRIPTORS, IMPORT_MAX_BYTES, IMPORT_MAX_CELL_CODE_POINTS, IMPORT_MAX_COLUMNS, IMPORT_MAX_DATA_ROWS, checkLimits, parseCsv, type AdmittedImportFile, type ImportLimitCheckResult, type ImportRefusal, type ParsedCsvFile } from "@/modules/import/parse";
import { flagDuplicateLookingRows, suggestMatches, validateRows, type ImportMatchCandidate, type ImportValidatedRow, type ImportValidation } from "@/modules/import/validate";
import { firstWhere, requiredSaying } from "../helpers/answers";
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const field = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const csvWith = (headers: readonly string[], rows: readonly (readonly string[])[]): string => `${[headers, ...rows].map((row) => row.map(field).join(",")).join("\n")}\n`;
const headerNames = (count: number): string[] => Array.from({ length: count }, (_value, index) => `Column ${index + 1}`);
const rowNames = (count: number): string[] => Array.from({ length: count }, (_value, index) => `Contact ${index + 1}`);
function singleColumnCsv(cells: readonly string[]): string {
  return csvWith(
    ["Name"],
    cells.map((cell) => [cell]),
  );
}
function singleColumnCsvWithBlanks(cells: readonly string[], blankEvery: number): string {
  const lines: string[] = ["Name"];
  cells.forEach((cell, position) => {
    if (position > 0 && position % blankEvery === 0) lines.push("");
    lines.push(field(cell));
  });
  return `${lines.join("\n")}\n`;
}
function exactSizeCsv(totalBytes: number): Uint8Array {
  const header = "Name\n";
  const cellBudget = totalBytes - header.length - IMPORT_MAX_DATA_ROWS;
  const shortest = Math.floor(cellBudget / IMPORT_MAX_DATA_ROWS);
  const longerCells = cellBudget - shortest * IMPORT_MAX_DATA_ROWS;
  const rows: string[] = [];
  for (let position = 0; position < IMPORT_MAX_DATA_ROWS; position += 1) {
    const length = position < longerCells ? shortest + 1 : shortest;
    rows.push(`${"a".repeat(length)}\n`);
  }
  return bytesOf(header + rows.join(""));
}
const mustFind = <T>(value: T | undefined, what: string): T => requiredSaying(value, `expected ${what}`);
async function admittedFile(bytes: Uint8Array, displayName = "chosen.csv"): Promise<AdmittedImportFile> {
  const result = await checkLimits(bytes, displayName);
  if (!result.ok) throw new Error(`expected the file to be admitted, but it was refused: ${result.refusals.map((refusal) => refusal.message).join(" ")}`);
  return result.file;
}
async function parsedFile(text: string): Promise<ParsedCsvFile> {
  const result = await parseCsv(text);
  if (!result.ok) throw new Error(`expected the text to parse, but it was refused: ${result.refusals.map((refusal) => refusal.message).join(" ")}`);
  return result.file;
}
function refusalsOnly(result: ImportLimitCheckResult): readonly ImportRefusal[] {
  if (result.ok) throw new Error("expected the file to be refused, but it was admitted");
  expect("file" in result).toBe(false);
  expect(result.refusals.length).toBeGreaterThan(0);
  return result.refusals;
}
const firstRefusal = (refusals: readonly ImportRefusal[]): ImportRefusal => mustFind(refusals[0], "a refusal to report");
function confirmedMappingFor(file: ParsedCsvFile, suggestion: ImportSuggestedMapping = suggestMapping(file)): ImportConfirmedMapping {
  const result = confirmMapping(suggestion);
  if (!result.ok) throw new Error(`expected the mapping to be confirmed, but it was refused: ${result.refusals.map((refusal) => refusal.message).join(" ")}`);
  return result.mapping;
}
const validatedRow = (validation: ImportValidation, predicate: (row: ImportValidatedRow) => boolean, what: string): ImportValidatedRow => mustFind(validation.rows.find(predicate), what);
const FIXTURE_BYTES = new Uint8Array(readFileSync(new URL("../../public/fixtures/contacts-example.csv", import.meta.url)));
type FixtureImport = { readonly file: ParsedCsvFile; readonly suggestion: ImportSuggestedMapping; readonly mapping: ImportConfirmedMapping; readonly validation: ImportValidation };
async function importFixture(): Promise<FixtureImport> {
  const admitted = await admittedFile(FIXTURE_BYTES, "contacts-example.csv");
  const file = await parsedFile(admitted.text);
  const suggestion = suggestMapping(file);
  const mapping = confirmedMappingFor(file, suggestion);
  return { file, suggestion, mapping, validation: validateRows(file, mapping) };
}
const candidateSharing = (email: string): ImportMatchCandidate => ({ reference: { system: "synthetic-crm", reference: "partner-existing-0001" }, visibleFields: ["contact-email", "display-name"], visibleValues: { "contact-email": [email] }, reuse: { permitted: true } });
it("import limits: the fixed values: states the four limits exactly as the specification fixes them", () => {
  expect([IMPORT_MAX_BYTES, IMPORT_MAX_DATA_ROWS, IMPORT_MAX_COLUMNS, IMPORT_MAX_CELL_CODE_POINTS]).toEqual([5 * 1024 * 1024, 5_000, 60, 2_000]);
  const byId = new Map(IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));
  expect([mustFind(byId.get("file-bytes"), "the file size limit").value, mustFind(byId.get("data-rows"), "the row limit").value, mustFind(byId.get("columns"), "the column limit").value, mustFind(byId.get("cell-code-points"), "the cell limit").value]).toEqual([5 * 1024 * 1024, 5_000, 60, 2_000]);
  expect(IMPORT_LIMIT_DESCRIPTORS.filter((entry) => entry.refusesWholeFile).map((entry) => entry.id)).toEqual(["file-bytes", "data-rows", "columns"]);
  expect([mustFind(byId.get("cell-code-points"), "the cell limit").unit, mustFind(byId.get("data-rows"), "the row limit").unit]).toEqual(["Unicode code points", "nonblank data rows"]);
});
it("import limits: the fixed values: refuses an over-limit file before any row is parsed", async () => {
  const result = await checkLimits(bytesOf(singleColumnCsv(rowNames(IMPORT_MAX_DATA_ROWS + 1))));
  const refusals = refusalsOnly(result);
  expect(firstRefusal(refusals).code).toBe("too-many-rows");
});
it("import limits: file size: accepts a file of exactly 5 MiB and refuses one byte more", async () => {
  const atLimit = exactSizeCsv(IMPORT_MAX_BYTES);
  expect(atLimit.byteLength).toBe(IMPORT_MAX_BYTES);
  const admitted = await admittedFile(atLimit, "at-the-limit.csv");
  expect([[admitted.byteLength, admitted.contentTyped, admitted.structure.dataRowCount], admitted.structure.rowFaults]).toEqual([[IMPORT_MAX_BYTES, "csv-utf8", IMPORT_MAX_DATA_ROWS], []]);
  const overLimit = exactSizeCsv(IMPORT_MAX_BYTES + 1);
  expect(overLimit.byteLength).toBe(IMPORT_MAX_BYTES + 1);
  const refusal = firstRefusal(refusalsOnly(await checkLimits(overLimit, "one-byte-over.csv")));
  expect([refusal.code, refusal.limit, refusal.measured]).toEqual(["file-too-large", "file-bytes", IMPORT_MAX_BYTES + 1]);
  for (const needle of [String(IMPORT_MAX_BYTES), String(overLimit.byteLength), "5 MiB"]) expect(refusal.message).toContain(needle);
});
it("import limits: file size: decides the size before it reads the content", async () => {
  const oversizedWorkbook = new Uint8Array(IMPORT_MAX_BYTES + 1);
  oversizedWorkbook.set([0x50, 0x4b, 0x03, 0x04]);
  const refusal = firstRefusal(refusalsOnly(await checkLimits(oversizedWorkbook, "oversized-workbook.csv")));
  expect(refusal.code).toBe("file-too-large");
  expect(firstRefusal(refusalsOnly(await checkLimits(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]), "workbook.csv"))).code).toBe("content-workbook");
});
it("import limits: nonblank data rows: accepts 5,000 nonblank rows and refuses row 5,001", async () => {
  const admitted = await admittedFile(bytesOf(singleColumnCsv(rowNames(IMPORT_MAX_DATA_ROWS))), "five-thousand.csv");
  expect([admitted.structure.dataRowCount, admitted.structure.blankRowCount]).toEqual([IMPORT_MAX_DATA_ROWS, 0]);
  const refusedResult = await checkLimits(bytesOf(singleColumnCsv(rowNames(IMPORT_MAX_DATA_ROWS + 1))), "five-thousand-and-one.csv");
  const refusal = firstRefusal(refusalsOnly(refusedResult));
  expect([refusal.code, refusal.limit, refusal.measured]).toEqual(["too-many-rows", "data-rows", IMPORT_MAX_DATA_ROWS + 1]);
  for (const needle of [String(IMPORT_MAX_DATA_ROWS + 1), String(IMPORT_MAX_DATA_ROWS)]) expect(refusal.message).toContain(needle);
});
it("import limits: nonblank data rows: does not count blank rows against the limit", async () => {
  const cells = rowNames(IMPORT_MAX_DATA_ROWS);
  const blankEvery = 250;
  const text = singleColumnCsvWithBlanks(cells, blankEvery);
  const admitted = await admittedFile(bytesOf(text), "five-thousand-with-blanks.csv");
  expect([[admitted.structure.dataRowCount, admitted.structure.blankRowCount], admitted.structure.rowFaults]).toEqual([[IMPORT_MAX_DATA_ROWS, Math.floor((IMPORT_MAX_DATA_ROWS - 1) / blankEvery)], []]);
});
it("import limits: columns: accepts 60 columns and refuses column 61 before mapping", async () => {
  const sixty = headerNames(IMPORT_MAX_COLUMNS);
  const admitted = await admittedFile(bytesOf(csvWith(sixty, [sixty.map(() => "value")])), "sixty-columns.csv");
  expect([admitted.structure.columnCount, admitted.structure.dataRowCount]).toEqual([IMPORT_MAX_COLUMNS, 1]);
  const sixtyOne = headerNames(IMPORT_MAX_COLUMNS + 1);
  const refusedResult = await checkLimits(bytesOf(csvWith(sixtyOne, [sixtyOne.map(() => "value")])), "sixty-one-columns.csv");
  const refusal = firstRefusal(refusalsOnly(refusedResult));
  expect([refusal.code, refusal.limit, refusal.measured]).toEqual(["too-many-columns", "columns", IMPORT_MAX_COLUMNS + 1]);
  for (const needle of [String(IMPORT_MAX_COLUMNS + 1), String(IMPORT_MAX_COLUMNS)]) expect(refusal.message).toContain(needle);
  expect("file" in refusedResult).toBe(false);
});
it("import limits: cell length: accepts a cell of exactly 2,000 code points and fails only the row at 2,001", async () => {
  const atLimit = "a".repeat(IMPORT_MAX_CELL_CODE_POINTS);
  const overLimit = "a".repeat(IMPORT_MAX_CELL_CODE_POINTS + 1);
  const file = await parsedFile(csvWith(["Name"], [[atLimit], [overLimit], ["third contact"], ["fourth contact"]]));
  expect(file.dataRowCount).toBe(4);
  expect(file.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3, 4]);
  expect(file.rowFaults).toHaveLength(1);
  const fault = mustFind(file.rowFaults[0], "the cell-length fault");
  expect([fault.kind, fault.rowNumber, fault.columnNumber, fault.measured]).toEqual(["cell-too-long", 2, 1, IMPORT_MAX_CELL_CODE_POINTS + 1]);
  for (const needle of [String(IMPORT_MAX_CELL_CODE_POINTS + 1), String(IMPORT_MAX_CELL_CODE_POINTS)]) expect(fault.message).toContain(needle);
  const validation = validateRows(file, confirmedMappingFor(file));
  expect(validation.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3, 4]);
  expect([validation.counts.needsCorrection, validation.counts.ready]).toEqual([1, 3]);
  const failedRow = firstWhere(validation.rows, "rowNumber", 2, "the row the long cell belongs to");
  expect(failedRow.verdict).toBe("needs-correction");
  expect(failedRow.faults.map((entry) => entry.kind)).toEqual(["cell-too-long"]);
  expect(failedRow.issues.map((issue) => [issue.code, issue.columnNumber, issue.fieldId, issue.header, issue.label])).toEqual([["cell-too-long", 1, "display-name", "Name", "Display name"]]);
  const stated = mustFind(failedRow.issues[0], "the cell-length problem the row states");
  for (const needle of [String(IMPORT_MAX_CELL_CODE_POINTS + 1), String(IMPORT_MAX_CELL_CODE_POINTS)]) expect(stated.message).toContain(needle);
  expect(stated.value).toBe(overLimit);
  for (const rowNumber of [1, 3, 4]) {
    const sibling = firstWhere(validation.rows, "rowNumber", rowNumber, `row ${rowNumber}`);
    expect([sibling.faults, sibling.issues, sibling.verdict]).toEqual([[], [], "ready"]);
  }
});
it("import limits: cell length: states a long cell in a column that supplies no field", async () => {
  const overLimit = "a".repeat(IMPORT_MAX_CELL_CODE_POINTS + 1);
  const file = await parsedFile(
    csvWith(
      ["Name", "Favourite colour"],
      [
        ["Amara Okonkwo", overLimit],
        ["Bo Lindqvist", "blue"],
      ],
    ),
  );
  const mapping = confirmedMappingFor(file);
  expect(mapping.assignments.map((assignment) => [assignment.columnIndex, assignment.fieldId])).toEqual([[1, "display-name"]]);
  const validation = validateRows(file, mapping);
  expect([validation.counts.needsCorrection, validation.counts.ready]).toEqual([1, 1]);
  const failedRow = firstWhere(validation.rows, "rowNumber", 1, "the row the unmapped long cell belongs to");
  expect(failedRow.verdict).toBe("needs-correction");
  expect(failedRow.issues.map((issue) => [issue.code, issue.columnNumber, issue.fieldId, issue.header, issue.label])).toEqual([["cell-too-long", 2, null, "Favourite colour", "Favourite colour"]]);
  const sibling = firstWhere(validation.rows, "rowNumber", 2, "the row beside it");
  expect([sibling.issues, sibling.verdict]).toEqual([[], "ready"]);
});
it("import limits: row shape: states a row that does not line up with the header", async () => {
  const file = await parsedFile(csvWith(["Name", "Email"], [["Amara Okonkwo"], ["Bo Lindqvist", "bo@example.org"]]));
  const validation = validateRows(file, confirmedMappingFor(file));
  expect([validation.counts.needsCorrection, validation.counts.ready]).toEqual([1, 1]);
  const failedRow = firstWhere(validation.rows, "rowNumber", 1, "the row that does not line up with the header");
  expect(failedRow.verdict).toBe("needs-correction");
  expect(failedRow.issues.map((issue) => [issue.code, issue.columnNumber, issue.fieldId, issue.header, issue.label, issue.value])).toEqual([["ragged-row", null, null, null, "Row shape", null]]);
  expect(mustFind(failedRow.issues[0], "the row-shape problem the row states").message).toContain("has 1 columns but the header row names 2");
});
it("import limits: cell length: refuses the row naming the cell, and takes it once the cell is corrected", async () => {
  const overLimit = "a".repeat(IMPORT_MAX_CELL_CODE_POINTS + 1);
  const file = await parsedFile(csvWith(["Name"], [["first contact"], [overLimit]]));
  const mapping = confirmedMappingFor(file);
  const context: ImportDecisionContext = { file, mapping, validation: validateRows(file, mapping), candidates: [] };
  const refused = recordDecision(createDecisionSet(file), { kind: "create", rowNumber: 2 }, context);
  if (refused.ok) throw new Error("expected the row to be refused, but the decision was recorded");
  expect([refused.refusal.code, refused.refusal.rowNumber, refused.refusal.columnNumbers, refused.refusal.message.includes("it has 1 problem(s)")]).toEqual(["row-needs-correction", 2, [1], true]);
  for (const needle of ["Row 2, column 1", String(IMPORT_MAX_CELL_CODE_POINTS + 1), String(IMPORT_MAX_CELL_CODE_POINTS)]) expect(refused.refusal.message).toContain(needle);
  const corrected = recordDecision(createDecisionSet(file), { kind: "create", rowNumber: 2, corrections: [{ columnNumber: 1, value: "Second contact" }] }, context);
  if (!corrected.ok) throw new Error(`expected the corrected row to be accepted, but it was refused: ${corrected.refusal.message}`);
  expect([corrected.decision.kind, corrected.decision.verdict, corrected.changed]).toEqual(["create", "ready", true]);
});
it("import limits: cell length: counts Unicode code points, not UTF-16 units", async () => {
  const astral = "\u{1F600}";
  const atLimit = astral.repeat(IMPORT_MAX_CELL_CODE_POINTS);
  expect(atLimit.length).toBe(IMPORT_MAX_CELL_CODE_POINTS * 2);
  expect([...atLimit]).toHaveLength(IMPORT_MAX_CELL_CODE_POINTS);
  const admitted = await parsedFile(csvWith(["Name"], [[atLimit]]));
  expect(admitted.rowFaults).toEqual([]);
  const overLimit = astral.repeat(IMPORT_MAX_CELL_CODE_POINTS + 1);
  const refused = await parsedFile(csvWith(["Name"], [[overLimit], ["sibling contact"]]));
  expect(refused.dataRowCount).toBe(2);
  const fault = mustFind(refused.rowFaults[0], "the astral cell-length fault");
  expect([fault.kind, fault.measured]).toEqual(["cell-too-long", IMPORT_MAX_CELL_CODE_POINTS + 1]);
  expect(fault.message).toContain(String(IMPORT_MAX_CELL_CODE_POINTS + 1));
});
it("import content: typed by bytes, never by name: refuses a spreadsheet workbook presented as a CSV", async () => {
  const zipRefusal = firstRefusal(refusalsOnly(await checkLimits(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]), "contacts.csv")));
  expect(zipRefusal.code).toBe("content-workbook");
  expect(zipRefusal.message).toContain("UTF-8 CSV");
  expect(firstRefusal(refusalsOnly(await checkLimits(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "contacts.csv"))).code).toBe("content-workbook");
});
it("import content: typed by bytes, never by name: accepts CSV text whatever the file is called", async () => {
  const admitted = await admittedFile(bytesOf(csvWith(["Name"], [["Amara Okonkwo"]])), "contacts.xls");
  expect([admitted.contentTyped, admitted.structure.dataRowCount]).toEqual(["csv-utf8", 1]);
});
it("import content: typed by bytes, never by name: refuses bytes that are not UTF-8 instead of decoding them", async () => {
  const result = await checkLimits(new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xff, 0xfe, 0x0a]), "legacy-encoding.csv");
  const refusal = firstRefusal(refusalsOnly(result));
  expect(refusal.code).toBe("content-not-utf8");
  expect(refusal.message).toContain("UTF-8 CSV");
  expect("file" in result).toBe(false);
});
it("import content: typed by bytes, never by name: reads the committed example inside every limit", async () => {
  const admitted = await admittedFile(FIXTURE_BYTES, "contacts-example.csv");
  expect([[admitted.byteLength, admitted.structure.columnCount, admitted.structure.dataRowCount, admitted.structure.blankRowCount], admitted.structure.rowFaults]).toEqual([[FIXTURE_BYTES.byteLength, 12, 25, 1], []]);
  const file = await parsedFile(admitted.text);
  expect(file.headers).toHaveLength(12);
  expect([file.headers[0], file.dataRowCount, file.rows.every((row) => row.cells.length === 12)]).toEqual(["First name", 25, true]);
});
it("import mapping: headers are positions, never identities: keeps the first header key intact when the file starts with a byte-order mark", async () => {
  const file = await parsedFile("\uFEFFName,Email\nAmara Okonkwo,amara@example.org\n");
  expect(file.headers).toHaveLength(2);
  expect([file.headers[0], file.headers[0]?.codePointAt(0)]).toEqual(["Name", 0x4e]);
  const suggestion = suggestMapping(file);
  const claim = firstWhere(suggestion.claims, "fieldId", "display-name", "the display-name claim");
  expect(claim.columnIndexes).toEqual([1]);
});
it("import mapping: headers are positions, never identities: keeps both columns of a repeated header as separate positions", async () => {
  const { suggestion, mapping } = await importFixture();
  expect(suggestion.columns).toHaveLength(12);
  expect(suggestion.repeatedHeaders).toEqual([{ header: "Email", columnIndexes: [5, 7] }]);
  const emailColumns = suggestion.columns.filter((column) => column.header === "Email");
  expect([emailColumns.map((column) => column.index), emailColumns.map((column) => column.occurrence)]).toEqual([
    [5, 7],
    [1, 2],
  ]);
  const claim = firstWhere(suggestion.claims, "fieldId", "contact-email", "the email claim");
  expect([claim.columnIndexes, mapping.assignments.filter((assignment) => assignment.fieldId === "contact-email").map((assignment) => assignment.columnIndex)]).toEqual([
    [5, 7],
    [5, 7],
  ]);
});
it("import mapping: headers are positions, never identities: proposes an existing contact without deciding or merging it", async () => {
  const { file, mapping, validation } = await importFixture();
  const row = validatedRow(validation, (candidate) => candidate.mappedCells.some((cell) => cell.value.trim() === "naomi.petersen@example.org"), "the row holding the first known email address");
  const candidates = [candidateSharing("naomi.petersen@example.org")];
  const proposal = suggestMatches(row, candidates);
  expect(proposal.rowNumber).toBe(row.rowNumber);
  expect(proposal.suggestions).toHaveLength(1);
  const suggestion = mustFind(proposal.suggestions[0], "the reuse suggestion");
  expect([suggestion.reference, suggestion.signals.map((signal) => signal.kind)]).toEqual([{ system: "synthetic-crm", reference: "partner-existing-0001" }, ["email"]]);
  expect(suggestion.message).toContain("Nothing has been merged");
  const set = createDecisionSet(file);
  expect(set.decisions).toHaveLength(0);
  expect(set.decisions.some((decision) => decision.rowNumber === row.rowNumber)).toBe(false);
  const summary = summariseDecisions(set, { file, mapping, validation, candidates });
  if (!summary.ok) throw new Error(summary.refusal.message);
  expect([summary.summary.counts.reuse, summary.summary.counts.unresolved, summary.summary.totalRowCount]).toEqual([0, summary.summary.totalRowCount, file.dataRowCount]);
});
it("import mapping: headers are positions, never identities: keeps a restriction the file stated", async () => {
  const { validation } = await importFixture();
  const row = validatedRow(validation, (candidate) => candidate.restrictions.some((entry) => entry.text.trim() === "Do not contact"), "the row that states a contact restriction");
  expect(row.restrictions).toHaveLength(1);
  const restriction = mustFind(row.restrictions[0], "the imported restriction");
  expect([[restriction.kind, restriction.text, restriction.header], row.mappedCells.filter((cell) => cell.fieldId === "restriction").map((cell) => cell.value.trim())]).toEqual([["imported-restriction", "Do not contact", "Contact restriction"], ["Do not contact"]]);
  expect(validation.counts.restrictions).toBe(3);
});
it("import mapping: headers are positions, never identities: offers exactly the four per-row decisions and refuses a fifth", async () => {
  expect(IMPORT_DECISION_KINDS).toHaveLength(4);
  expect([IMPORT_DECISION_KINDS, new Set(IMPORT_DECISION_KINDS)]).toEqual([["create", "reuse", "skip", "unresolved"], new Set(["create", "reuse", "skip", "unresolved"])]);
  const { file, mapping, validation } = await importFixture();
  const candidates = [candidateSharing("naomi.petersen@example.org")];
  const context: ImportDecisionContext = { file, mapping, validation, candidates };
  const readyRow = validatedRow(validation, (row) => row.verdict === "ready" && row.mappedCells.some((cell) => cell.value.trim() === "naomi.petersen@example.org"), "the ready row that shares an email address with a known contact");
  const correctableRow = validatedRow(validation, (row) => row.verdict === "needs-correction", "a row that needs correction");
  const created = recordDecision(createDecisionSet(file), { kind: "create", rowNumber: readyRow.rowNumber }, context);
  if (!created.ok) throw new Error(created.refusal.message);
  expect(created.decision.kind).toBe("create");
  const reused = recordDecision(createDecisionSet(file), { kind: "reuse", rowNumber: readyRow.rowNumber, candidate: { system: "synthetic-crm", reference: "partner-existing-0001" } }, context);
  if (!reused.ok) throw new Error(reused.refusal.message);
  expect(reused.decision.kind).toBe("reuse");
  const skipped = recordDecision(createDecisionSet(file), { kind: "skip", rowNumber: correctableRow.rowNumber, reason: "duplicate of the row above" }, context);
  if (!skipped.ok) throw new Error(skipped.refusal.message);
  expect(skipped.decision.kind).toBe("skip");
  const unresolved = recordDecision(createDecisionSet(file), { kind: "unresolved", rowNumber: correctableRow.rowNumber }, context);
  if (!unresolved.ok) throw new Error(unresolved.refusal.message);
  expect(unresolved.decision.kind).toBe("unresolved");
  const fifth = recordDecision(createDecisionSet(file), { kind: "merge", rowNumber: readyRow.rowNumber } as unknown as ImportDecisionInput, context);
  if (fifth.ok) throw new Error("expected the fifth decision kind to be refused");
  expect(fifth.refusal.code).toBe("decision-invalid");
});
it("import mapping: headers are positions, never identities: keeps a subscription column as data and creates no consent", async () => {
  const { file, mapping, validation } = await importFixture();
  const subscribedColumn = file.headers.indexOf("Subscribed") + 1;
  expect(subscribedColumn).toBe(10);
  const parsedRow = mustFind(
    file.rows.find((row) => row.cells[4]?.trim() === "naomi.petersen@example.org"),
    "the row whose subscription cell reads yes",
  );
  expect(parsedRow.cells[subscribedColumn - 1]).toBe("yes");
  const row = firstWhere(validation.rows, "rowNumber", parsedRow.rowNumber, "the validated row of the same contact");
  const consentCell = firstWhere(row.preservedCells, "header", "Subscribed", "the preserved subscription cell");
  expect([consentCell.text, consentCell.reason, consentCell.statesConsent, row.mappedCells.some((cell) => cell.header === "Subscribed")]).toEqual(["yes", "consent-preserved", true, false]);
  expect(validation.counts.consentMarkedCells).toBeGreaterThan(0);
  expect(Object.keys(validation).sort()).toEqual(["counts", "fields", "problems", "rows"]);
  const summary = summariseDecisions(createDecisionSet(file), { file, mapping, validation, candidates: [] });
  if (!summary.ok) throw new Error(summary.refusal.message);
  expect([summary.summary.facts, [summary.summary.consentLookingColumnCount, summary.summary.preservedColumns.filter((column) => column.statesConsent).map((column) => column.header)]]).toEqual([{ memberships: 0, consentRecords: 0, audienceMembers: 0, preservedColumnsCreateNothing: true }, [1, ["Subscribed"]]]);
});
describe("import review: rows of one file that look alike", () => {
  it("flags both rows of one name that share no contact method, and only them", async () => {
    const { validation } = await importFixture();
    const flagged = flagDuplicateLookingRows(validation.rows);
    expect([...flagged.keys()].sort((left, right) => left - right)).toEqual([10, 11]);
    for (const row of validation.rows.filter((entry) => flagged.has(entry.rowNumber))) {
      const flag = mustFind(flagged.get(row.rowNumber), `the look-alike flag of row ${row.rowNumber}`);
      expect([flag.name, flag.otherRowNumbers, Object.keys(flag).sort()]).toEqual(["Tomas Rivera", [row.rowNumber === 10 ? 11 : 10], ["name", "otherRowNumbers", "rowNumber"]]);
      expect(row.verdict).toBe("ready"); // A look-alike is a signal beside the row: it names no reference, merges nothing and leaves the verdict validation graded.
    }
    expect([validation.counts.ready, validation.counts.needsCorrection]).toEqual([22, 3]);
  });
  const lookAlikeCases: readonly { readonly name: string; readonly rows: readonly (readonly string[])[]; readonly flagged: readonly number[] }[] = [
    {
      name: "folds case and spacing when it compares two names",
      rows: [
        ["Siobhán", "Ní Bhraonáin", "siobhan.nb@example.org"],
        ["SIOBHÁN", "NÍ  BHRAONÁIN", "s.nibhraonain@example.net"],
      ],
      flagged: [1, 2],
    },
    {
      name: "does not flag a name carried once, or two rows that already share an email address",
      rows: [
        ["Ada", "Lovelace", "ada.lovelace@example.org"],
        ["Grace", "Hopper", "grace.hopper@example.org"],
        ["GRACE", "Hopper", "Grace.Hopper@example.org"],
        ["Marie", "Curie", "marie.curie@example.org"],
        ["Marie", "Curie", "m.curie@example.net"],
      ],
      flagged: [4, 5],
    },
  ];
  it.each(lookAlikeCases)("$name", async ({ rows, flagged }) => {
    const file = await parsedFile(csvWith(["First name", "Last name", "Email"], rows));
    expect([...flagDuplicateLookingRows(validateRows(file, confirmedMappingFor(file)).rows).keys()].sort((left, right) => left - right)).toEqual(flagged);
  });
});
