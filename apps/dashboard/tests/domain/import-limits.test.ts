/**
 * Proves the contact-import limits and the two rules that sit beside them (success criterion 4):
 * every limit is decided on the file before anything is processed, at an exact boundary and in its
 * own unit, a refusal names the limit and what was measured, and the pipeline types a file by its
 * bytes rather than by its name.
 *
 * Plan items that put this file in scope: the AAP 0.11.1 deliverable row `tests/domain/*.test.ts`
 * naming `import-limits` for criterion 4; the criterion 4 row of AAP 0.12.1 ("a 5,001-row file and
 * a workbook are each refused before processing"); the fixed values of AAP 0.8.7 (5 MiB, 5,000
 * nonblank data rows with blank rows uncounted, 60 columns and 2,000 Unicode code points per cell,
 * each accepted exactly at the limit and refused one over); AAP 0.2.1 (csv-parse 7.0.3 with `bom`
 * enabled, because an unstripped byte-order mark silently corrupts the first header key); AAP 0.8.5
 * (importing a contact never subscribes anyone, and a `subscribed` flag is not consent); and AAP
 * 0.12.4, which makes `public/fixtures/contacts-example.csv` the input of this journey.
 *
 * Where the module's own surface differs from the brief for this file:
 *
 * - The brief expects a `failed` per-row result. A row-level refusal in this pipeline is an
 *   `ImportRowFault` (`cell-too-long`, `ragged-row`) carried by the row it belongs to, and
 *   `ImportRowVerdict` holds only `ready` and `needs-correction`; the receipt's `failed` literal
 *   belongs to acceptance. The cell-length case is therefore asserted on `rowFaults`, on the row
 *   that survives in `rows`, and on the verdict that fault produces, which is the same claim.
 * - The brief expects the remaining rows to be "accepted" beside the one failing row. Whether a row
 *   is accepted is the worker's decision, so this file asserts what the pipeline can honestly
 *   state: the offending row is the only one carrying a fault, its siblings carry none and are
 *   `ready`, and no row is dropped.
 * - `checkLimits()` returns the admitted UTF-8 text and its measured structure, while headers and
 *   rows belong to `parseCsv()`. "Before processing" is therefore asserted structurally: a refused
 *   result carries no admitted file at all, so no header, no row and no mapping was ever produced.
 *
 * What this file deliberately does not test: the recoverable receipt after a lost acknowledgement,
 * which is `tests/integration/import-receipt-recovery.test.ts`. Nothing here reaches the store, the
 * data service, the clock or a component; the whole suite runs over buffers and text.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  IMPORT_DECISION_KINDS,
  createDecisionSet,
  recordDecision,
  summariseDecisions,
  type ImportDecisionContext,
  type ImportDecisionInput,
} from "@/modules/import/decide";
import {
  confirmMapping,
  suggestMapping,
  type ImportConfirmedMapping,
  type ImportSuggestedMapping,
} from "@/modules/import/map";
import {
  IMPORT_LIMIT_DESCRIPTORS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_CELL_CODE_POINTS,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_DATA_ROWS,
  checkLimits,
  parseCsv,
  type AdmittedImportFile,
  type ImportLimitCheckResult,
  type ImportRefusal,
  type ParsedCsvFile,
} from "@/modules/import/parse";
import {
  suggestMatches,
  validateRows,
  type ImportMatchCandidate,
  type ImportValidatedRow,
  type ImportValidation,
} from "@/modules/import/validate";

// ---------------------------------------------------------------------------------------------
// Builders: every input is generated, so no large literal is checked in
// ---------------------------------------------------------------------------------------------

const ENCODER = new TextEncoder();

function bytesOf(text: string): Uint8Array {
  return ENCODER.encode(text);
}

/** One CSV field, quoted only when it holds a delimiter, a quote or a line break. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** A CSV document: one header row followed by data rows, every cell written by `field()`. */
function csvWith(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return `${[headers, ...rows].map((row) => row.map(field).join(",")).join("\n")}\n`;
}

/** `count` distinct header names, so a column-limit case is built rather than pasted. */
function headerNames(count: number): string[] {
  return Array.from({ length: count }, (_value, index) => `Column ${index + 1}`);
}

/** One short cell per row, so a 5,001-row file stays a few hundred kilobytes. */
function rowNames(count: number): string[] {
  return Array.from({ length: count }, (_value, index) => `Contact ${index + 1}`);
}

/** A one-column CSV holding these cells, one per line. */
function singleColumnCsv(cells: readonly string[]): string {
  return csvWith(
    ["Name"],
    cells.map((cell) => [cell]),
  );
}

/**
 * A one-column CSV of these cells with a blank line before every `blankEvery`-th one. The blank
 * lines are the point of the case: the parser sees them as records and they must not be counted.
 */
function singleColumnCsvWithBlanks(cells: readonly string[], blankEvery: number): string {
  const lines: string[] = ["Name"];
  cells.forEach((cell, position) => {
    if (position > 0 && position % blankEvery === 0) lines.push("");
    lines.push(field(cell));
  });
  return `${lines.join("\n")}\n`;
}

/**
 * A valid one-column CSV of exactly `totalBytes` bytes: the header, then `IMPORT_MAX_DATA_ROWS`
 * cells that differ in length by at most one, so the file sits inside the row, column and cell
 * limits and only the byte count is under test. Cells are ASCII, so a character is a byte and the
 * arithmetic is exact.
 */
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

// ---------------------------------------------------------------------------------------------
// Helpers: the value found, and the shape a refusal must have
// ---------------------------------------------------------------------------------------------

function mustFind<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/**
 * The admitted file of a check that must succeed, with every refusal's own wording quoted in the
 * failure so a limit that moved says which one.
 */
async function admittedFile(
  bytes: Uint8Array,
  displayName = "chosen.csv",
): Promise<AdmittedImportFile> {
  const result = await checkLimits(bytes, displayName);
  if (!result.ok) {
    throw new Error(
      `expected the file to be admitted, but it was refused: ${result.refusals
        .map((refusal) => refusal.message)
        .join(" ")}`,
    );
  }
  return result.file;
}

/** The parsed file of text that must be readable, for the header and mapping cases. */
async function parsedFile(text: string): Promise<ParsedCsvFile> {
  const result = await parseCsv(text);
  if (!result.ok) {
    throw new Error(
      `expected the text to parse, but it was refused: ${result.refusals
        .map((refusal) => refusal.message)
        .join(" ")}`,
    );
  }
  return result.file;
}

/**
 * The refusals of a refused check, insisting the result carries no admitted file. Structural rather
 * than textual: a refused result holds no headers, no rows and no text, which is what "refused
 * before processing" has to mean.
 */
function refusalsOnly(result: ImportLimitCheckResult): readonly ImportRefusal[] {
  if (result.ok) throw new Error("expected the file to be refused, but it was admitted");
  expect("file" in result).toBe(false);
  expect(result.refusals.length).toBeGreaterThan(0);
  return result.refusals;
}

function firstRefusal(refusals: readonly ImportRefusal[]): ImportRefusal {
  return mustFind(refusals[0], "a refusal to report");
}

/** The mapping a parsed file's own headers produce, confirmed without a worker's decisions. */
function confirmedMappingFor(
  file: ParsedCsvFile,
  suggestion: ImportSuggestedMapping = suggestMapping(file),
): ImportConfirmedMapping {
  const result = confirmMapping(suggestion);
  if (!result.ok) {
    throw new Error(
      `expected the mapping to be confirmed, but it was refused: ${result.refusals
        .map((refusal) => refusal.message)
        .join(" ")}`,
    );
  }
  return result.mapping;
}

function validatedRow(
  validation: ImportValidation,
  predicate: (row: ImportValidatedRow) => boolean,
  what: string,
): ImportValidatedRow {
  return mustFind(validation.rows.find(predicate), what);
}

/**
 * The committed example, resolved from this file's own location so the suite reads the same bytes
 * whatever directory the runner is started in. It is an input of the journey, never re-declared.
 */
const FIXTURE_BYTES = new Uint8Array(
  readFileSync(new URL("../../public/fixtures/contacts-example.csv", import.meta.url)),
);

interface FixtureImport {
  readonly file: ParsedCsvFile;
  readonly suggestion: ImportSuggestedMapping;
  readonly mapping: ImportConfirmedMapping;
  readonly validation: ImportValidation;
}

async function importFixture(): Promise<FixtureImport> {
  const admitted = await admittedFile(FIXTURE_BYTES, "contacts-example.csv");
  const file = await parsedFile(admitted.text);
  const suggestion = suggestMapping(file);
  const mapping = confirmedMappingFor(file, suggestion);
  return { file, suggestion, mapping, validation: validateRows(file, mapping) };
}

/** The existing contact the duplicate-suggestion case offers for a row of the fixture. */
function candidateSharing(email: string): ImportMatchCandidate {
  return {
    reference: { system: "synthetic-crm", reference: "partner-existing-0001" },
    visibleFields: ["contact-email", "display-name"],
    visibleValues: { "contact-email": [email] },
    reuse: { permitted: true },
  };
}

// ---------------------------------------------------------------------------------------------
// The limits are the fixed values
// ---------------------------------------------------------------------------------------------

describe("import limits: the fixed values", () => {
  it("states the four limits exactly as the specification fixes them", () => {
    expect(IMPORT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(IMPORT_MAX_DATA_ROWS).toBe(5_000);
    expect(IMPORT_MAX_COLUMNS).toBe(60);
    expect(IMPORT_MAX_CELL_CODE_POINTS).toBe(2_000);

    const byId = new Map(IMPORT_LIMIT_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));
    expect(mustFind(byId.get("file-bytes"), "the file size limit").value).toBe(5 * 1024 * 1024);
    expect(mustFind(byId.get("data-rows"), "the row limit").value).toBe(5_000);
    expect(mustFind(byId.get("columns"), "the column limit").value).toBe(60);
    expect(mustFind(byId.get("cell-code-points"), "the cell limit").value).toBe(2_000);

    // Only the cell limit refuses one row; the other three refuse the whole file, which is what
    // makes a too-long cell correctable while an oversized file is not.
    expect(
      IMPORT_LIMIT_DESCRIPTORS.filter((entry) => entry.refusesWholeFile).map((entry) => entry.id),
    ).toEqual(["file-bytes", "data-rows", "columns"]);
    expect(mustFind(byId.get("cell-code-points"), "the cell limit").unit).toBe(
      "Unicode code points",
    );
    expect(mustFind(byId.get("data-rows"), "the row limit").unit).toBe("nonblank data rows");
  });

  it("refuses an over-limit file before any row is parsed", async () => {
    const result = await checkLimits(bytesOf(singleColumnCsv(rowNames(IMPORT_MAX_DATA_ROWS + 1))));
    const refusals = refusalsOnly(result);
    // The refusal is all there is: no header, no row and no admitted text came out of the file.
    expect(firstRefusal(refusals).code).toBe("too-many-rows");
  });
});

// ---------------------------------------------------------------------------------------------
// Size: exact at 5 MiB, and decided before the content is read
// ---------------------------------------------------------------------------------------------

describe("import limits: file size", () => {
  it("accepts a file of exactly 5 MiB and refuses one byte more", async () => {
    const atLimit = exactSizeCsv(IMPORT_MAX_BYTES);
    expect(atLimit.byteLength).toBe(IMPORT_MAX_BYTES);

    const admitted = await admittedFile(atLimit, "at-the-limit.csv");
    expect(admitted.byteLength).toBe(IMPORT_MAX_BYTES);
    expect(admitted.contentTyped).toBe("csv-utf8");
    // The file is genuinely usable, so nothing but the byte count is under test here.
    expect(admitted.structure.dataRowCount).toBe(IMPORT_MAX_DATA_ROWS);
    expect(admitted.structure.rowFaults).toEqual([]);

    const overLimit = exactSizeCsv(IMPORT_MAX_BYTES + 1);
    expect(overLimit.byteLength).toBe(IMPORT_MAX_BYTES + 1);
    const refusal = firstRefusal(refusalsOnly(await checkLimits(overLimit, "one-byte-over.csv")));
    expect(refusal.code).toBe("file-too-large");
    expect(refusal.limit).toBe("file-bytes");
    expect(refusal.measured).toBe(IMPORT_MAX_BYTES + 1);
    expect(refusal.message).toContain(String(IMPORT_MAX_BYTES));
    expect(refusal.message).toContain(String(overLimit.byteLength));
    expect(refusal.message).toContain("5 MiB");
  });

  it("decides the size before it reads the content", async () => {
    // An oversized buffer that also opens with a spreadsheet container header: the byte count is the
    // only limit decidable without reading the file, and it bounds the cost of every later step, so
    // it must win over the content check rather than being reached afterwards.
    const oversizedWorkbook = new Uint8Array(IMPORT_MAX_BYTES + 1);
    oversizedWorkbook.set([0x50, 0x4b, 0x03, 0x04]);

    const refusal = firstRefusal(
      refusalsOnly(await checkLimits(oversizedWorkbook, "oversized-workbook.csv")),
    );
    expect(refusal.code).toBe("file-too-large");

    // The same signature inside the limit is a content refusal, which is what proves the ordering
    // changed the answer rather than the signature being unrecognised.
    const workbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
    expect(firstRefusal(refusalsOnly(await checkLimits(workbook, "workbook.csv"))).code).toBe(
      "content-workbook",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Rows: counted when they hold data, so blank lines never consume the budget
// ---------------------------------------------------------------------------------------------

describe("import limits: nonblank data rows", () => {
  it("accepts 5,000 nonblank rows and refuses row 5,001", async () => {
    const admitted = await admittedFile(
      bytesOf(singleColumnCsv(rowNames(IMPORT_MAX_DATA_ROWS))),
      "five-thousand.csv",
    );
    expect(admitted.structure.dataRowCount).toBe(IMPORT_MAX_DATA_ROWS);
    expect(admitted.structure.blankRowCount).toBe(0);

    const refusedResult = await checkLimits(
      bytesOf(singleColumnCsv(rowNames(IMPORT_MAX_DATA_ROWS + 1))),
      "five-thousand-and-one.csv",
    );
    const refusal = firstRefusal(refusalsOnly(refusedResult));
    expect(refusal.code).toBe("too-many-rows");
    expect(refusal.limit).toBe("data-rows");
    expect(refusal.measured).toBe(IMPORT_MAX_DATA_ROWS + 1);
    // The reason names the row that broke the limit and the limit itself, so it is actionable.
    expect(refusal.message).toContain(String(IMPORT_MAX_DATA_ROWS + 1));
    expect(refusal.message).toContain(String(IMPORT_MAX_DATA_ROWS));
  });

  it("does not count blank rows against the limit", async () => {
    const cells = rowNames(IMPORT_MAX_DATA_ROWS);
    const blankEvery = 250;
    const text = singleColumnCsvWithBlanks(cells, blankEvery);
    const admitted = await admittedFile(bytesOf(text), "five-thousand-with-blanks.csv");

    // 5,000 data rows plus 19 blank lines: a counter that counted lines would refuse this file,
    // and a counter that counted blank records as data rows would refuse it too.
    expect(admitted.structure.dataRowCount).toBe(IMPORT_MAX_DATA_ROWS);
    expect(admitted.structure.blankRowCount).toBe(
      Math.floor((IMPORT_MAX_DATA_ROWS - 1) / blankEvery),
    );
    expect(admitted.structure.rowFaults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Columns: the header row decides it, before any mapping exists
// ---------------------------------------------------------------------------------------------

describe("import limits: columns", () => {
  it("accepts 60 columns and refuses column 61 before mapping", async () => {
    const sixty = headerNames(IMPORT_MAX_COLUMNS);
    const admitted = await admittedFile(
      bytesOf(csvWith(sixty, [sixty.map(() => "value")])),
      "sixty-columns.csv",
    );
    expect(admitted.structure.columnCount).toBe(IMPORT_MAX_COLUMNS);
    expect(admitted.structure.dataRowCount).toBe(1);

    const sixtyOne = headerNames(IMPORT_MAX_COLUMNS + 1);
    const refusedResult = await checkLimits(
      bytesOf(csvWith(sixtyOne, [sixtyOne.map(() => "value")])),
      "sixty-one-columns.csv",
    );
    const refusal = firstRefusal(refusalsOnly(refusedResult));
    expect(refusal.code).toBe("too-many-columns");
    expect(refusal.limit).toBe("columns");
    expect(refusal.measured).toBe(IMPORT_MAX_COLUMNS + 1);
    expect(refusal.message).toContain(String(IMPORT_MAX_COLUMNS + 1));
    expect(refusal.message).toContain(String(IMPORT_MAX_COLUMNS));

    // The column limit is decided on the header row, so a 61-column file yields no parsed file and
    // therefore no suggestion to confirm: there is nothing for `suggestMapping` to receive.
    expect("file" in refusedResult).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Cell length: one row is refused, the rest of the file survives
// ---------------------------------------------------------------------------------------------

describe("import limits: cell length", () => {
  it("accepts a cell of exactly 2,000 code points and fails only the row at 2,001", async () => {
    const atLimit = "a".repeat(IMPORT_MAX_CELL_CODE_POINTS);
    const overLimit = "a".repeat(IMPORT_MAX_CELL_CODE_POINTS + 1);
    const file = await parsedFile(
      csvWith(["Name"], [[atLimit], [overLimit], ["third contact"], ["fourth contact"]]),
    );

    // The long cell refuses its own row and nothing else: the file parses and every row is kept.
    expect(file.dataRowCount).toBe(4);
    expect(file.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3, 4]);
    expect(file.rowFaults).toHaveLength(1);

    const fault = mustFind(file.rowFaults[0], "the cell-length fault");
    expect(fault.kind).toBe("cell-too-long");
    expect(fault.rowNumber).toBe(2);
    expect(fault.columnNumber).toBe(1);
    expect(fault.measured).toBe(IMPORT_MAX_CELL_CODE_POINTS + 1);
    expect(fault.message).toContain(String(IMPORT_MAX_CELL_CODE_POINTS + 1));
    expect(fault.message).toContain(String(IMPORT_MAX_CELL_CODE_POINTS));

    // The fault follows the row into validation, where it is the only row that cannot be accepted.
    const validation = validateRows(file, confirmedMappingFor(file));
    expect(validation.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3, 4]);
    expect(validation.counts.needsCorrection).toBe(1);
    expect(validation.counts.ready).toBe(3);

    const failedRow = mustFind(
      validation.rows.find((row) => row.rowNumber === 2),
      "the row the long cell belongs to",
    );
    expect(failedRow.verdict).toBe("needs-correction");
    expect(failedRow.faults.map((entry) => entry.kind)).toEqual(["cell-too-long"]);

    for (const rowNumber of [1, 3, 4]) {
      const sibling = mustFind(
        validation.rows.find((row) => row.rowNumber === rowNumber),
        `row ${rowNumber}`,
      );
      expect(sibling.faults).toEqual([]);
      expect(sibling.verdict).toBe("ready");
    }
  });

  it("counts Unicode code points, not UTF-16 units", async () => {
    // An astral character is one code point and two UTF-16 units, so a `.length` check refuses a
    // cell the limit admits. This is the only case that separates the two counts.
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
    expect(fault.kind).toBe("cell-too-long");
    expect(fault.measured).toBe(IMPORT_MAX_CELL_CODE_POINTS + 1);
    expect(fault.message).toContain(String(IMPORT_MAX_CELL_CODE_POINTS + 1));
  });
});

// ---------------------------------------------------------------------------------------------
// Content: typed by bytes, never by name
// ---------------------------------------------------------------------------------------------

describe("import content: typed by bytes, never by name", () => {
  it("refuses a spreadsheet workbook presented as a CSV", async () => {
    const zipWorkbook = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00,
    ]);
    const zipRefusal = firstRefusal(refusalsOnly(await checkLimits(zipWorkbook, "contacts.csv")));
    expect(zipRefusal.code).toBe("content-workbook");
    // The reason is actionable: it names the format this step does admit, not only what it refused.
    expect(zipRefusal.message).toContain("UTF-8 CSV");

    // A legacy .xls workbook is an OLE2 compound file, refused by the same content check.
    const ole2Workbook = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(firstRefusal(refusalsOnly(await checkLimits(ole2Workbook, "contacts.csv"))).code).toBe(
      "content-workbook",
    );
  });

  it("accepts CSV text whatever the file is called", async () => {
    // A name is display metadata: the same text is admitted under a workbook's extension because the
    // bytes are UTF-8 CSV, and an extension is never evidence either way.
    const admitted = await admittedFile(
      bytesOf(csvWith(["Name"], [["Amara Okonkwo"]])),
      "contacts.xls",
    );
    expect(admitted.contentTyped).toBe("csv-utf8");
    expect(admitted.structure.dataRowCount).toBe(1);
  });

  it("refuses bytes that are not UTF-8 instead of decoding them", async () => {
    const notUtf8 = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xff, 0xfe, 0x0a]);
    const result = await checkLimits(notUtf8, "legacy-encoding.csv");
    const refusal = firstRefusal(refusalsOnly(result));
    expect(refusal.code).toBe("content-not-utf8");
    expect(refusal.message).toContain("UTF-8 CSV");
    // Refused, not partially decoded: a permissive decode would have imported replacement characters.
    expect("file" in result).toBe(false);
  });

  it("reads the committed example inside every limit", async () => {
    const admitted = await admittedFile(FIXTURE_BYTES, "contacts-example.csv");
    expect(admitted.byteLength).toBe(FIXTURE_BYTES.byteLength);
    expect(admitted.structure.columnCount).toBe(12);
    expect(admitted.structure.dataRowCount).toBe(25);
    expect(admitted.structure.blankRowCount).toBe(1);
    expect(admitted.structure.rowFaults).toEqual([]);

    const file = await parsedFile(admitted.text);
    expect(file.headers).toHaveLength(12);
    expect(file.headers[0]).toBe("First name");
    expect(file.dataRowCount).toBe(25);
    expect(file.rows.every((row) => row.cells.length === 12)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Headers, mapping and duplicates: a column is a position, a person is never a key
// ---------------------------------------------------------------------------------------------

describe("import mapping: headers are positions, never identities", () => {
  it("keeps the first header key intact when the file starts with a byte-order mark", async () => {
    const file = await parsedFile("\uFEFFName,Email\nAmara Okonkwo,amara@example.org\n");
    expect(file.headers).toHaveLength(2);
    expect(file.headers[0]).toBe("Name");
    expect(file.headers[0]?.codePointAt(0)).toBe(0x4e);

    // A BOM left on the first header is invisible in a "the parse succeeded" check and obvious here:
    // the name column would stop being recognised, so the mapping is where the rule is proven.
    const suggestion = suggestMapping(file);
    const claim = mustFind(
      suggestion.claims.find((entry) => entry.fieldId === "display-name"),
      "the display-name claim",
    );
    expect(claim.columnIndexes).toEqual([1]);
  });

  it("keeps both columns of a repeated header as separate positions", async () => {
    const { suggestion, mapping } = await importFixture();
    expect(suggestion.columns).toHaveLength(12);
    expect(suggestion.repeatedHeaders).toEqual([{ header: "Email", columnIndexes: [5, 7] }]);

    const emailColumns = suggestion.columns.filter((column) => column.header === "Email");
    expect(emailColumns.map((column) => column.index)).toEqual([5, 7]);
    expect(emailColumns.map((column) => column.occurrence)).toEqual([1, 2]);

    // Neither column was collapsed into the other: the field that may repeat keeps both positions.
    const claim = mustFind(
      suggestion.claims.find((entry) => entry.fieldId === "contact-email"),
      "the email claim",
    );
    expect(claim.columnIndexes).toEqual([5, 7]);
    expect(
      mapping.assignments
        .filter((assignment) => assignment.fieldId === "contact-email")
        .map((assignment) => assignment.columnIndex),
    ).toEqual([5, 7]);
  });

  it("proposes an existing contact without deciding or merging it", async () => {
    const { file, mapping, validation } = await importFixture();
    const row = validatedRow(
      validation,
      (candidate) =>
        candidate.mappedCells.some((cell) => cell.value.trim() === "naomi.petersen@example.org"),
      "the row holding the first known email address",
    );
    const candidates = [candidateSharing("naomi.petersen@example.org")];

    const proposal = suggestMatches(row, candidates);
    expect(proposal.rowNumber).toBe(row.rowNumber);
    expect(proposal.suggestions).toHaveLength(1);
    const suggestion = mustFind(proposal.suggestions[0], "the reuse suggestion");
    expect(suggestion.reference).toEqual({
      system: "synthetic-crm",
      reference: "partner-existing-0001",
    });
    expect(suggestion.signals.map((signal) => signal.kind)).toEqual(["email"]);
    expect(suggestion.message).toContain("Nothing has been merged");

    // A suggestion decides nothing and merges nothing: the set stays empty for that row, and the
    // review step counts the row as unresolved until the worker decides about it.
    const set = createDecisionSet(file);
    expect(set.decisions).toHaveLength(0);
    expect(set.decisions.some((decision) => decision.rowNumber === row.rowNumber)).toBe(false);

    const summary = summariseDecisions(set, { file, mapping, validation, candidates });
    if (!summary.ok) throw new Error(summary.refusal.message);
    expect(summary.summary.counts.reuse).toBe(0);
    expect(summary.summary.counts.unresolved).toBe(summary.summary.totalRowCount);
    expect(summary.summary.totalRowCount).toBe(file.dataRowCount);
  });

  it("keeps a restriction the file stated", async () => {
    const { validation } = await importFixture();
    const row = validatedRow(
      validation,
      (candidate) => candidate.restrictions.some((entry) => entry.text.trim() === "Do not contact"),
      "the row that states a contact restriction",
    );

    expect(row.restrictions).toHaveLength(1);
    const restriction = mustFind(row.restrictions[0], "the imported restriction");
    expect(restriction.kind).toBe("imported-restriction");
    expect(restriction.text).toBe("Do not contact");
    expect(restriction.header).toBe("Contact restriction");
    // The wording is kept untouched and read as no channel in particular: a restriction is a
    // contactability instruction, never a permission and never a consent fact.
    expect(
      row.mappedCells
        .filter((cell) => cell.fieldId === "restriction")
        .map((cell) => cell.value.trim()),
    ).toEqual(["Do not contact"]);
    expect(validation.counts.restrictions).toBe(3);
  });

  it("offers exactly the four per-row decisions and refuses a fifth", async () => {
    expect(IMPORT_DECISION_KINDS).toHaveLength(4);
    expect(IMPORT_DECISION_KINDS).toEqual(["create", "reuse", "skip", "unresolved"]);
    expect(new Set(IMPORT_DECISION_KINDS)).toEqual(
      new Set(["create", "reuse", "skip", "unresolved"]),
    );

    const { file, mapping, validation } = await importFixture();
    const candidates = [candidateSharing("naomi.petersen@example.org")];
    const context: ImportDecisionContext = { file, mapping, validation, candidates };
    const readyRow = validatedRow(
      validation,
      (row) =>
        row.verdict === "ready" &&
        row.mappedCells.some((cell) => cell.value.trim() === "naomi.petersen@example.org"),
      "the ready row that shares an email address with a known contact",
    );
    const correctableRow = validatedRow(
      validation,
      (row) => row.verdict === "needs-correction",
      "a row that needs correction",
    );

    const created = recordDecision(
      createDecisionSet(file),
      { kind: "create", rowNumber: readyRow.rowNumber },
      context,
    );
    if (!created.ok) throw new Error(created.refusal.message);
    expect(created.decision.kind).toBe("create");

    const reused = recordDecision(
      createDecisionSet(file),
      {
        kind: "reuse",
        rowNumber: readyRow.rowNumber,
        candidate: { system: "synthetic-crm", reference: "partner-existing-0001" },
      },
      context,
    );
    if (!reused.ok) throw new Error(reused.refusal.message);
    expect(reused.decision.kind).toBe("reuse");

    const skipped = recordDecision(
      createDecisionSet(file),
      { kind: "skip", rowNumber: correctableRow.rowNumber, reason: "duplicate of the row above" },
      context,
    );
    if (!skipped.ok) throw new Error(skipped.refusal.message);
    expect(skipped.decision.kind).toBe("skip");

    const unresolved = recordDecision(
      createDecisionSet(file),
      { kind: "unresolved", rowNumber: correctableRow.rowNumber },
      context,
    );
    if (!unresolved.ok) throw new Error(unresolved.refusal.message);
    expect(unresolved.decision.kind).toBe("unresolved");

    const fifth = recordDecision(
      createDecisionSet(file),
      { kind: "merge", rowNumber: readyRow.rowNumber } as unknown as ImportDecisionInput,
      context,
    );
    if (fifth.ok) throw new Error("expected the fifth decision kind to be refused");
    expect(fifth.refusal.code).toBe("decision-invalid");
  });

  it("keeps a subscription column as data and creates no consent", async () => {
    const { file, mapping, validation } = await importFixture();
    const subscribedColumn = file.headers.indexOf("Subscribed") + 1;
    expect(subscribedColumn).toBe(10);

    const parsedRow = mustFind(
      file.rows.find((row) => row.cells[4]?.trim() === "naomi.petersen@example.org"),
      "the row whose subscription cell reads yes",
    );
    // First half of the rule: the value the file stated is carried exactly as data.
    expect(parsedRow.cells[subscribedColumn - 1]).toBe("yes");

    const row = mustFind(
      validation.rows.find((candidate) => candidate.rowNumber === parsedRow.rowNumber),
      "the validated row of the same contact",
    );
    const consentCell = mustFind(
      row.preservedCells.find((cell) => cell.header === "Subscribed"),
      "the preserved subscription cell",
    );
    expect(consentCell.text).toBe("yes");
    expect(consentCell.reason).toBe("consent-preserved");
    expect(consentCell.statesConsent).toBe(true);
    expect(row.mappedCells.some((cell) => cell.header === "Subscribed")).toBe(false);
    expect(validation.counts.consentMarkedCells).toBeGreaterThan(0);

    // Second half: neither validation nor the review step produces a membership, a consent record
    // or an audience member, so no surface can present the flag as a permission.
    expect(Object.keys(validation).sort()).toEqual(["counts", "fields", "problems", "rows"]);
    const summary = summariseDecisions(createDecisionSet(file), {
      file,
      mapping,
      validation,
      candidates: [],
    });
    if (!summary.ok) throw new Error(summary.refusal.message);
    expect(summary.summary.facts).toEqual({
      memberships: 0,
      consentRecords: 0,
      audienceMembers: 0,
      preservedColumnsCreateNothing: true,
    });
    expect(summary.summary.consentLookingColumnCount).toBe(1);
    expect(
      summary.summary.preservedColumns
        .filter((column) => column.statesConsent)
        .map((column) => column.header),
    ).toEqual(["Subscribed"]);
  });
});
