/**
 * Contact import, steps one and two: the displayed limits are enforced before anything is
 * processed, then a UTF-8 CSV text is read into ordered headers and ordered rows.
 *
 * Scope: AAP 0.6.1 import-module row (`checkLimits()`, `parseCsv()`); 0.8.7 fixed values (5 MiB,
 * 5000 nonblank data rows, 60 columns, 2000 code points per cell, each with its exact boundary);
 * 0.2.1 (csv-parse 7.0.3, `bom` enabled, limits enforced before processing, never a generic
 * column-mapped mode); 0.9.1/0.11.1 (`modules/import/{parse,map,validate,decide,receipt}.ts`).
 *
 * This file also declares the import module's shared types, because no import here may reach the
 * record store, the data service, a feature folder or a component folder, and the module has no
 * sixth `types.ts`. Row-value validation and its schemas belong to `validate.ts`; no shape in this
 * file crosses an external boundary, so none carries a schema.
 */

import { parse } from "csv-parse/sync";

// ---------------------------------------------------------------------------------------------
// Phase A: the limits, declared once
// ---------------------------------------------------------------------------------------------

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_DATA_ROWS = 5000;
export const IMPORT_MAX_COLUMNS = 60;
export const IMPORT_MAX_CELL_CODE_POINTS = 2000;

export type ImportLimitId = "file-bytes" | "data-rows" | "columns" | "cell-code-points";

export type ImportLimitUnit = "bytes" | "nonblank data rows" | "columns" | "Unicode code points";

export interface ImportLimitDescriptor {
  readonly id: ImportLimitId;
  readonly label: string;
  readonly value: number;
  readonly unit: ImportLimitUnit;
  /** True when exceeding the limit refuses the whole file; false when it refuses only that row. */
  readonly refusesWholeFile: boolean;
  /** The boundary sentence the import step shows before any work begins. */
  readonly boundary: string;
}

/**
 * The four product limits, each stated once so the import step's list, every refusal message and
 * every boundary test read the same source of truth.
 */
export const IMPORT_LIMIT_DESCRIPTORS: readonly ImportLimitDescriptor[] = [
  {
    id: "file-bytes",
    label: "File size",
    value: IMPORT_MAX_BYTES,
    unit: "bytes",
    refusesWholeFile: true,
    boundary:
      "A file of 5242880 bytes (5 MiB) is accepted; one byte more is refused before the file is read.",
  },
  {
    id: "data-rows",
    label: "Data rows",
    value: IMPORT_MAX_DATA_ROWS,
    unit: "nonblank data rows",
    refusesWholeFile: true,
    boundary:
      "5000 rows that contain data are accepted; a blank row is not counted, and row 5001 is refused before anything is imported.",
  },
  {
    id: "columns",
    label: "Columns",
    value: IMPORT_MAX_COLUMNS,
    unit: "columns",
    refusesWholeFile: true,
    boundary:
      "60 columns are accepted; a header row with 61 columns is refused before anything is imported.",
  },
  {
    id: "cell-code-points",
    label: "Cell length",
    value: IMPORT_MAX_CELL_CODE_POINTS,
    unit: "Unicode code points",
    refusesWholeFile: false,
    boundary:
      "2000 characters per cell are accepted; a longer cell is refused on its own row, so the rest of the file can still be imported.",
  },
];

// ---------------------------------------------------------------------------------------------
// Module-owned types
// ---------------------------------------------------------------------------------------------

export type ImportRefusalCode =
  /** No bytes at all were supplied. */
  | "file-empty"
  /** Above IMPORT_MAX_BYTES, decided on the raw bytes before anything is decoded. */
  | "file-too-large"
  /** ZIP or OLE2 container bytes: a spreadsheet workbook, not a CSV. */
  | "content-workbook"
  /** Not decodable as UTF-8, so it is not the UTF-8 CSV this step accepts. */
  | "content-not-utf8"
  /** Decoded, but carries NUL or a control character no text file holds. */
  | "content-binary"
  /** No nonblank record that could name the columns. */
  | "no-header-row"
  /** A header row and nothing else. */
  | "no-data-rows"
  /** More than IMPORT_MAX_COLUMNS columns. */
  | "too-many-columns"
  /** More than IMPORT_MAX_DATA_ROWS nonblank data rows. */
  | "too-many-rows"
  /** More records, blank ones included, than the bounded scan materialises. */
  | "record-scan-exceeded"
  /** csv-parse could not tokenise the text (unclosed quote, runaway record, and so on). */
  | "parser-fault";

/**
 * A reason the file was refused: `limit` and `measured` are populated whenever a fixed limit
 * decided it, and `message` always names both so the worker can act without reading code.
 */
export interface ImportRefusal {
  readonly code: ImportRefusalCode;
  readonly limit: ImportLimitId | null;
  readonly measured: number | null;
  readonly message: string;
}

export type ImportRowFaultKind =
  /** A cell above IMPORT_MAX_CELL_CODE_POINTS, which refuses that row only. */
  | "cell-too-long"
  /** A row whose field count differs from the header's; kept exactly as parsed. */
  | "ragged-row";

/** A fault that refuses one row while leaving the rest of the file acceptable. */
export interface ImportRowFault {
  /** The same 1-based data-row number as the row it describes, counted over nonblank data rows. */
  readonly rowNumber: number;
  readonly kind: ImportRowFaultKind;
  /** 1-based column number for a cell fault; null when the fault is the row's shape. */
  readonly columnNumber: number | null;
  /** The measured value, in the fault's own unit: code points, or fields in the row. */
  readonly measured: number;
  readonly message: string;
}

export interface ParsedCsvRow {
  /**
   * The 1-based position of this row among the file's nonblank data rows, so
   * `1 <= rowNumber <= dataRowCount` always holds and the header and blank rows are never numbered.
   * This is the only row numbering the import module uses: `map.ts`, `validate.ts`, `decide.ts`,
   * the proposal summary and the receipt's correction routes all address a row by it.
   */
  readonly rowNumber: number;
  /** The cells exactly as parsed, untrimmed and unpadded, in header order. */
  readonly cells: string[];
}

export interface ParsedCsvFile {
  /** What the content check established, stated narrowly: UTF-8 text, not a safety qualification. */
  readonly contentTyped: "csv-utf8";
  /** Header cells in original order, trimmed, duplicates preserved as separate positions. */
  readonly headers: string[];
  readonly rows: ParsedCsvRow[];
  readonly columnCount: number;
  readonly dataRowCount: number;
  /** Blank records — all-empty, delimiter-only and whitespace-only — ignored and not counted. */
  readonly blankRowCount: number;
  readonly rowFaults: ImportRowFault[];
}

export interface ImportFileStructure {
  readonly columnCount: number;
  readonly dataRowCount: number;
  readonly blankRowCount: number;
  readonly rowFaults: ImportRowFault[];
}

export interface AdmittedImportFile {
  readonly contentTyped: "csv-utf8";
  /** Display metadata only: never evidence of the file's type and never put into a message. */
  readonly displayName: string;
  readonly byteLength: number;
  /** The decode-ready text, for `parseCsv()`. */
  readonly text: string;
  /** The limits this file was measured against, so the step can display them alongside it. */
  readonly limits: readonly ImportLimitDescriptor[];
  readonly structure: ImportFileStructure;
}

export type ImportLimitCheckResult =
  | { readonly ok: true; readonly file: AdmittedImportFile }
  | { readonly ok: false; readonly refusals: ImportRefusal[] };

export type ParseCsvResult =
  | { readonly ok: true; readonly file: ParsedCsvFile }
  | { readonly ok: false; readonly refusals: ImportRefusal[] };

// ---------------------------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------------------------

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const CSV_DELIMITER = ",";

/** ZIP local-file, end-of-directory and spanned-archive headers: spreadsheet workbooks are ZIPs. */
const ZIP_SIGNATURES: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

/** OLE2 compound-file header: a legacy .xls workbook. */
const OLE2_SIGNATURE: readonly number[] = [0xd0, 0xcf, 0x11, 0xe0];

/**
 * The most records one scan materialises. The byte ceiling alone cannot bound this: a 5 MiB file of
 * newlines holds millions of one-field records, and an eager parse of them would exhaust memory on
 * a host running many tasks. The bound sits far above any file that fits the row limit, so reaching
 * it means the file is not a contact list this importer reviews — refused as such, never counted
 * wrongly.
 */
const RECORD_SCAN_LIMIT = 100_000;

/**
 * csv-parse's record-buffer guard, in UTF-16 units. A legal record is at most 60 cells of 2000 code
 * points, and a code point can take 2 units (an astral character) and be doubled again by RFC 4180
 * quote escaping: four units per code point plus slack for delimiters is the ceiling a legal record
 * can reach, so anything above it is a runaway quote rather than a large cell.
 */
const MAX_RECORD_SIZE = IMPORT_MAX_COLUMNS * IMPORT_MAX_CELL_CODE_POINTS * 4 + 4096;

interface CsvScan {
  readonly headerCells: string[];
  readonly dataRecords: readonly string[][];
  readonly blankRecordCount: number;
  readonly scanLimitReached: boolean;
}

type ScanOutcome =
  | { readonly ok: true; readonly scan: CsvScan }
  | { readonly ok: false; readonly refusals: ImportRefusal[] };

type DecodeOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly refusal: ImportRefusal };

function refusal(
  code: ImportRefusalCode,
  message: string,
  limit: ImportLimitId | null = null,
  measured: number | null = null,
): ImportRefusal {
  return { code, limit, measured, message };
}

function refused(...refusals: ImportRefusal[]): {
  readonly ok: false;
  readonly refusals: ImportRefusal[];
} {
  return { ok: false, refusals };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function isWorkbookContainer(bytes: Uint8Array): boolean {
  return (
    ZIP_SIGNATURES.some((signature) => startsWith(bytes, signature)) ||
    startsWith(bytes, OLE2_SIGNATURE)
  );
}

function countCodePoints(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    // A surrogate pair is one code point, so an emoji in a cell counts once: a cell of 2000 astral
    // characters is inside the limit, and counting UTF-16 units there would refuse it wrongly.
    if (unit >= 0xd800 && unit <= 0xdbff) index += 1;
    count += 1;
  }
  return count;
}

function isBlankRecord(record: readonly string[]): boolean {
  // Every field empty after trimming covers the three blank shapes a real export produces: an empty
  // line, a delimiter-only line such as ",,", and a line of spaces.
  return record.every((cell) => cell.trim().length === 0);
}

function decodeUtf8(bytes: Uint8Array): DecodeOutcome {
  try {
    // `fatal` is the whole point: a permissive decode turns a UTF-16 or legacy-encoded file into
    // replacement characters and imports nonsense, so an undecodable byte refuses the file instead.
    return { ok: true, text: UTF8_DECODER.decode(bytes) };
  } catch {
    return {
      ok: false,
      refusal: refusal(
        "content-not-utf8",
        "This file is not UTF-8 text, so it cannot be read as CSV. Save it as UTF-8 CSV and choose it again.",
        null,
        bytes.byteLength,
      ),
    };
  }
}

function binaryControlRefusal(text: string): ImportRefusal | null {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const isRecordWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    // NUL is how a UTF-16LE file looks once its bytes decode as UTF-8: every ASCII character is
    // followed by one. Refusing that says so plainly rather than importing "N\u0000a\u0000m\u0000e".
    if ((code < 0x20 && !isRecordWhitespace) || code === 0x7f) {
      return refusal(
        "content-binary",
        "This file contains binary characters rather than text, so it cannot be read as CSV. Save it as UTF-8 CSV and choose it again.",
        null,
        null,
      );
    }
  }
  return null;
}

function objectCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const { code } = error;
  return typeof code === "string" ? code : null;
}

function firstLine(error: unknown): string {
  if (!(error instanceof Error)) return "the parser reported a fault without a description";
  const [head] = error.message.split("\n");
  const trimmed = head?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "the parser reported a fault without a description";
}

function parserFaultRefusal(error: unknown): ImportRefusal {
  if (objectCode(error) === "CSV_MAX_RECORD_SIZE") {
    return refusal(
      "parser-fault",
      `One record in this file is longer than a legal record of ${IMPORT_MAX_COLUMNS} columns of ${IMPORT_MAX_CELL_CODE_POINTS} characters. Check for an unclosed quotation mark and try again.`,
      "cell-code-points",
      null,
    );
  }
  return refusal(
    "parser-fault",
    `This file could not be read as CSV: ${firstLine(error)}. Check its quotation marks and line endings, then try again.`,
    null,
    null,
  );
}

/**
 * The one tokenisation of the file: csv-parse in plain array mode, with every limit-relevant fact
 * derived from the records as parsed. Both entry points below read its result, so headers, rows,
 * blank counts and row numbering cannot diverge between the check and the parse.
 */
function scanCsv(text: string): ScanOutcome {
  let records: string[][];
  try {
    records = parse(text, {
      // An unstripped byte-order mark becomes part of the first header cell, turning "Email" into
      // "\uFEFFEmail" and silently breaking every mapping that looks the column up by its name.
      bom: true,
      delimiter: CSV_DELIMITER,
      max_record_size: MAX_RECORD_SIZE,
      // Ragged rows and blank lines are kept exactly as parsed so they can be reported, corrected
      // or counted; dropping them would hide a row, padding them would invent cells.
      relax_column_count: true,
      skip_empty_lines: false,
      to: RECORD_SCAN_LIMIT + 1,
    });
  } catch (error) {
    return refused(parserFaultRefusal(error));
  }

  let headerIndex = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record !== undefined && !isBlankRecord(record)) {
      headerIndex = index;
      break;
    }
  }

  const headerRecord = headerIndex === -1 ? undefined : records[headerIndex];
  if (headerRecord === undefined) {
    return refused(
      refusal(
        "no-header-row",
        "This file has no header row. Add a header row naming each column and try again.",
        "columns",
        0,
      ),
    );
  }

  // The header is the first record with any content, so at least one header cell is non-empty by
  // construction: a record of only empty cells is a blank row and was skipped above.
  const headerCells = headerRecord.map((cell) => cell.trim());

  const dataRecords: string[][] = [];
  // Blank records before the header are ignored like any other blank row, so the header may follow
  // a leading empty line without that line becoming a column.
  let blankRecordCount = headerIndex;
  for (let index = headerIndex + 1; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) continue;
    if (isBlankRecord(record)) {
      blankRecordCount += 1;
      continue;
    }
    dataRecords.push(record);
  }

  return {
    ok: true,
    scan: {
      headerCells,
      dataRecords,
      blankRecordCount,
      scanLimitReached: records.length >= RECORD_SCAN_LIMIT + 1,
    },
  };
}

function structuralRefusals(scan: CsvScan): ImportRefusal[] {
  if (scan.scanLimitReached) {
    return [
      refusal(
        "record-scan-exceeded",
        `This file holds more than ${RECORD_SCAN_LIMIT} records including blank rows, and the importer reviews up to ${IMPORT_MAX_DATA_ROWS} nonblank data rows. Remove the empty rows and try again.`,
        "data-rows",
        RECORD_SCAN_LIMIT + 1,
      ),
    ];
  }

  const refusals: ImportRefusal[] = [];
  const columnCount = scan.headerCells.length;
  const dataRowCount = scan.dataRecords.length;

  if (columnCount > IMPORT_MAX_COLUMNS) {
    refusals.push(
      refusal(
        "too-many-columns",
        `The header row has ${columnCount} columns; the limit is ${IMPORT_MAX_COLUMNS} columns. Remove the extra columns and try again.`,
        "columns",
        columnCount,
      ),
    );
  }

  if (dataRowCount > IMPORT_MAX_DATA_ROWS) {
    refusals.push(
      refusal(
        "too-many-rows",
        `This file has ${dataRowCount} nonblank data rows; the limit is ${IMPORT_MAX_DATA_ROWS} nonblank data rows. Split the file and import it in parts.`,
        "data-rows",
        dataRowCount,
      ),
    );
  } else if (dataRowCount === 0) {
    refusals.push(
      refusal(
        "no-data-rows",
        "This file has a header row but no data rows. Add at least one contact row and try again.",
        "data-rows",
        0,
      ),
    );
  }

  return refusals;
}

function rowFaultsFor(
  records: readonly (readonly string[])[],
  columnCount: number,
): ImportRowFault[] {
  const faults: ImportRowFault[] = [];

  records.forEach((record, recordIndex) => {
    const rowNumber = recordIndex + 1;

    if (record.length !== columnCount) {
      faults.push({
        rowNumber,
        kind: "ragged-row",
        columnNumber: null,
        measured: record.length,
        message: `Row ${rowNumber} has ${record.length} columns but the header row names ${columnCount}. Line the row up with the header before accepting it.`,
      });
    }

    record.forEach((cell, cellIndex) => {
      const codePoints = countCodePoints(cell);
      if (codePoints <= IMPORT_MAX_CELL_CODE_POINTS) return;
      faults.push({
        rowNumber,
        kind: "cell-too-long",
        columnNumber: cellIndex + 1,
        measured: codePoints,
        message: `Row ${rowNumber}, column ${cellIndex + 1} is ${codePoints} characters long; the limit is ${IMPORT_MAX_CELL_CODE_POINTS} characters per cell. Shorten the cell or skip this row.`,
      });
    });
  });

  return faults;
}

// ---------------------------------------------------------------------------------------------
// Phase B and C: content typing, then the limits
// ---------------------------------------------------------------------------------------------

/**
 * Enforces every displayed limit on a chosen file before anything is processed, returning either
 * the admitted file (UTF-8 text plus its measured structure) or the refusals that stopped it.
 */
export function checkLimits(
  bytes: Uint8Array,
  displayName = "the chosen file",
): ImportLimitCheckResult {
  // Size comes first: it is the only limit decidable from the byte count alone, and it bounds the
  // cost of every later step — decode, tokenise, count.
  if (bytes.byteLength === 0) {
    return refused(
      refusal(
        "file-empty",
        "This file is empty. Choose a CSV file with a header row and at least one data row.",
        "file-bytes",
        0,
      ),
    );
  }

  if (bytes.byteLength > IMPORT_MAX_BYTES) {
    return refused(
      refusal(
        "file-too-large",
        `This file is ${bytes.byteLength} bytes; the limit is ${IMPORT_MAX_BYTES} bytes (5 MiB). Choose a smaller CSV file.`,
        "file-bytes",
        bytes.byteLength,
      ),
    );
  }

  // Type is decided by the bytes alone. Neither the display name nor an extension is evidence: a
  // workbook renamed to .csv is still a workbook, and a text file given any name is still text.
  if (isWorkbookContainer(bytes)) {
    return refused(
      refusal(
        "content-workbook",
        "This file is a spreadsheet workbook, not a CSV. Export the sheet as UTF-8 CSV and choose that file.",
        null,
        bytes.byteLength,
      ),
    );
  }

  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) return refused(decoded.refusal);

  const binaryRefusal = binaryControlRefusal(decoded.text);
  if (binaryRefusal !== null) return refused(binaryRefusal);

  const scanned = scanCsv(decoded.text);
  if (!scanned.ok) return refused(...scanned.refusals);

  const refusals = structuralRefusals(scanned.scan);
  if (refusals.length > 0) return refused(...refusals);

  return {
    ok: true,
    file: {
      contentTyped: "csv-utf8",
      displayName,
      byteLength: bytes.byteLength,
      text: decoded.text,
      limits: IMPORT_LIMIT_DESCRIPTORS,
      structure: {
        columnCount: scanned.scan.headerCells.length,
        dataRowCount: scanned.scan.dataRecords.length,
        blankRowCount: scanned.scan.blankRecordCount,
        rowFaults: rowFaultsFor(scanned.scan.dataRecords, scanned.scan.headerCells.length),
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Phase D: the parse
// ---------------------------------------------------------------------------------------------

/**
 * Reads admitted UTF-8 CSV text into ordered headers and ordered nonblank rows, refusing rather
 * than returning an empty success when the text cannot be used.
 */
export function parseCsv(text: string): ParseCsvResult {
  const scanned = scanCsv(text);
  if (!scanned.ok) return refused(...scanned.refusals);

  const refusals = structuralRefusals(scanned.scan);
  if (refusals.length > 0) return refused(...refusals);

  const headers = [...scanned.scan.headerCells];
  const columnCount = headers.length;
  const rows = scanned.scan.dataRecords.map((cells, recordIndex) => ({
    rowNumber: recordIndex + 1,
    cells: [...cells],
  }));

  return {
    ok: true,
    file: {
      contentTyped: "csv-utf8",
      headers,
      rows,
      columnCount,
      dataRowCount: rows.length,
      blankRowCount: scanned.scan.blankRecordCount,
      rowFaults: rowFaultsFor(scanned.scan.dataRecords, columnCount),
    },
  };
}
