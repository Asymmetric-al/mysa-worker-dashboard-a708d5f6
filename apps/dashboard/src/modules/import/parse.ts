import { parse } from "csv-parse";
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_DATA_ROWS = 5000;
export const IMPORT_MAX_COLUMNS = 60;
export const IMPORT_MAX_CELL_CODE_POINTS = 2000;
export type ImportLimitId = "file-bytes" | "data-rows" | "columns" | "cell-code-points";
export type ImportLimitUnit = "bytes" | "nonblank data rows" | "columns" | "Unicode code points";
export type ImportLimitDescriptor = { readonly id: ImportLimitId; readonly label: string; readonly value: number; readonly unit: ImportLimitUnit; readonly refusesWholeFile: boolean; readonly boundary: string };
export const IMPORT_LIMIT_DESCRIPTORS: readonly ImportLimitDescriptor[] = [
  { id: "file-bytes", label: "File size", value: IMPORT_MAX_BYTES, unit: "bytes", refusesWholeFile: true, boundary: "A file of 5242880 bytes (5 MiB) is accepted; one byte more is refused before the file is read." },
  { id: "data-rows", label: "Data rows", value: IMPORT_MAX_DATA_ROWS, unit: "nonblank data rows", refusesWholeFile: true, boundary: "5000 rows that contain data are accepted; a blank row is not counted, and row 5001 is refused before anything is imported." },
  { id: "columns", label: "Columns", value: IMPORT_MAX_COLUMNS, unit: "columns", refusesWholeFile: true, boundary: "60 columns are accepted; a header row with 61 columns is refused before anything is imported." },
  { id: "cell-code-points", label: "Cell length", value: IMPORT_MAX_CELL_CODE_POINTS, unit: "Unicode code points", refusesWholeFile: false, boundary: "2000 characters per cell are accepted; a longer cell is refused on its own row, so the rest of the file can still be imported." },
];
export type ImportRefusalCode = "file-empty" | "file-too-large" | "content-workbook" | "content-not-utf8" | "content-binary" | "no-header-row" | "no-data-rows" | "too-many-columns" | "too-many-rows" | "record-scan-exceeded" | "parser-fault";
export type ImportRefusal = { readonly code: ImportRefusalCode; readonly limit: ImportLimitId | null; readonly measured: number | null; readonly message: string };
export type ImportRowFaultKind = "cell-too-long" | "ragged-row";
export type ImportRowFault = { readonly rowNumber: number; readonly kind: ImportRowFaultKind; readonly columnNumber: number | null; readonly measured: number; readonly message: string };
export type ParsedCsvRow = { readonly rowNumber: number; readonly cells: string[] };
export type ParsedCsvFile = { readonly contentTyped: "csv-utf8"; readonly headers: string[]; readonly rows: ParsedCsvRow[]; readonly columnCount: number; readonly dataRowCount: number; readonly blankRowCount: number; readonly rowFaults: ImportRowFault[] };
export type ImportFileStructure = { readonly columnCount: number; readonly dataRowCount: number; readonly blankRowCount: number; readonly rowFaults: ImportRowFault[] };
export type AdmittedImportFile = { readonly contentTyped: "csv-utf8"; readonly displayName: string; readonly byteLength: number; readonly text: string; readonly limits: readonly ImportLimitDescriptor[]; readonly structure: ImportFileStructure };
export type ImportLimitCheckResult = { readonly ok: true; readonly file: AdmittedImportFile } | { readonly ok: false; readonly refusals: ImportRefusal[] };
export type ParseCsvResult = { readonly ok: true; readonly file: ParsedCsvFile } | { readonly ok: false; readonly refusals: ImportRefusal[] };
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const CSV_DELIMITER = ",";
const ZIP_SIGNATURES: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];
const OLE2_SIGNATURE: readonly number[] = [0xd0, 0xcf, 0x11, 0xe0];
const RECORD_SCAN_LIMIT = 100_000;
const MAX_RECORD_SIZE = IMPORT_MAX_COLUMNS * IMPORT_MAX_CELL_CODE_POINTS * 4 + 4096;
type CsvScan = { readonly headerCells: string[]; readonly dataRecords: string[][]; readonly blankRecordCount: number; readonly rowFaults: ImportRowFault[] };
type ScanOutcome = { readonly ok: true; readonly scan: CsvScan } | { readonly ok: false; readonly refusals: ImportRefusal[] };
type DecodeOutcome = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly refusal: ImportRefusal };
const refusal = (code: ImportRefusalCode, message: string, limit: ImportLimitId | null = null, measured: number | null = null): ImportRefusal => ({ code, limit, measured, message });
const refused = (...refusals: ImportRefusal[]): { readonly ok: false; readonly refusals: ImportRefusal[] } => ({ ok: false, refusals });
const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean => (bytes.byteLength < signature.length ? false : signature.every((byte, index) => bytes[index] === byte));
const isWorkbookContainer = (bytes: Uint8Array): boolean => ZIP_SIGNATURES.some((signature) => startsWith(bytes, signature)) || startsWith(bytes, OLE2_SIGNATURE);
const countCodePoints = (value: string): number => [...value].length;
const isBlankRecord = (record: readonly string[]): boolean => record.every((cell) => cell.trim().length === 0);
function decodeUtf8(bytes: Uint8Array): DecodeOutcome {
  try {
    return { ok: true, text: UTF8_DECODER.decode(bytes) };
  } catch {
    return { ok: false, refusal: refusal("content-not-utf8", "This file is not UTF-8 text, so it cannot be read as CSV. Save it as UTF-8 CSV and choose it again.", null, bytes.byteLength) };
  }
}
function binaryControlRefusal(text: string): ImportRefusal | null {
  const binary = [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
  });
  return binary ? refusal("content-binary", "This file contains binary characters rather than text, so it cannot be read as CSV. Save it as UTF-8 CSV and choose it again.", null, null) : null;
}
const objectCode = (error: unknown): string | null => (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string" ? null : error.code);
const UNDESCRIBED_FAULT = "the parser reported a fault without a description";
const firstLine = (error: unknown): string => (error instanceof Error ? (error.message.split("\n")[0]?.trim() ?? "") || UNDESCRIBED_FAULT : UNDESCRIBED_FAULT);
function parserFaultRefusal(error: unknown): ImportRefusal {
  if (objectCode(error) === "CSV_MAX_RECORD_SIZE") return refusal("parser-fault", `One record in this file is longer than a legal record of ${IMPORT_MAX_COLUMNS} columns of ${IMPORT_MAX_CELL_CODE_POINTS} characters. Check for an unclosed quotation mark and try again.`, "cell-code-points", null);
  return refusal("parser-fault", `This file could not be read as CSV: ${firstLine(error)}. Check its quotation marks and line endings, then try again.`, null, null);
}
class ScanAborted extends Error {
  readonly refusal: ImportRefusal;
  constructor(refusal: ImportRefusal) {
    super(refusal.message);
    this.name = "ScanAborted";
    this.refusal = refusal;
  }
}
const tooManyColumnsRefusal = (measured: number): ImportRefusal => refusal("too-many-columns", `The header row has ${measured} columns; the limit is ${IMPORT_MAX_COLUMNS} columns. Remove the extra columns and try again.`, "columns", measured);
const tooManyRowsRefusal = (measured: number): ImportRefusal => refusal("too-many-rows", `This file holds at least ${measured} nonblank data rows; the limit is ${IMPORT_MAX_DATA_ROWS} nonblank data rows. Split the file and import it in parts.`, "data-rows", measured);
const recordScanExceededRefusal = (): ImportRefusal => refusal("record-scan-exceeded", `This file holds more than ${RECORD_SCAN_LIMIT} records including blank rows, and the importer reviews up to ${IMPORT_MAX_DATA_ROWS} nonblank data rows. Remove the empty rows and try again.`, "data-rows", RECORD_SCAN_LIMIT + 1);
function tokeniseCsv(text: string, onRecord: (record: string[]) => string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    parse(text, { bom: true, delimiter: CSV_DELIMITER, max_record_size: MAX_RECORD_SIZE, relax_column_count: true, skip_empty_lines: false, on_record: onRecord }, (error) => {
      if (error === undefined) return void resolve();
      reject(error);
    });
  });
}
async function scanCsv(text: string): Promise<ScanOutcome> {
  const dataRecords: string[][] = [];
  const rowFaults: ImportRowFault[] = [];
  let headerCells: string[] | null = null;
  let blankRecordCount = 0;
  let recordCount = 0;
  const onRecord = (record: string[]): string[] => {
    recordCount += 1;
    if (recordCount > RECORD_SCAN_LIMIT) throw new ScanAborted(recordScanExceededRefusal());
    if (isBlankRecord(record)) {
      blankRecordCount += 1;
      return record;
    }
    const header = headerCells;
    if (header === null) {
      const trimmed = record.map((cell) => cell.trim());
      if (trimmed.length > IMPORT_MAX_COLUMNS) throw new ScanAborted(tooManyColumnsRefusal(trimmed.length));
      headerCells = trimmed;
      return record;
    }
    const rowNumber = dataRecords.length + 1;
    if (rowNumber > IMPORT_MAX_DATA_ROWS) throw new ScanAborted(tooManyRowsRefusal(rowNumber));
    if (record.length !== header.length) rowFaults.push({ rowNumber, kind: "ragged-row", columnNumber: null, measured: record.length, message: `Row ${rowNumber} has ${record.length} columns but the header row names ${header.length}. Line the row up with the header before accepting it.` });
    record.forEach((cell, cellIndex) => {
      const codePoints = countCodePoints(cell);
      if (codePoints <= IMPORT_MAX_CELL_CODE_POINTS) return;
      rowFaults.push({ rowNumber, kind: "cell-too-long", columnNumber: cellIndex + 1, measured: codePoints, message: `Row ${rowNumber}, column ${cellIndex + 1} is ${codePoints} characters long; the limit is ${IMPORT_MAX_CELL_CODE_POINTS} characters per cell. Shorten the cell or skip this row.` });
    });
    dataRecords.push(record);
    return record;
  };
  try {
    await tokeniseCsv(text, onRecord);
  } catch (error) {
    return error instanceof ScanAborted ? refused(error.refusal) : refused(parserFaultRefusal(error));
  }
  const header = headerCells;
  if (header === null) return refused(refusal("no-header-row", "This file has no header row. Add a header row naming each column and try again.", "columns", 0));
  return dataRecords.length === 0 ? refused(refusal("no-data-rows", "This file has a header row but no data rows. Add at least one contact row and try again.", "data-rows", 0)) : { ok: true, scan: { headerCells: header, dataRecords, blankRecordCount, rowFaults } };
}
/** Enforces every displayed limit on a chosen file and returns either the admitted file (the UTF-8 text plus its measured structure) or the refusals that stopped it. */
export async function checkLimits(bytes: Uint8Array, displayName = "the chosen file"): Promise<ImportLimitCheckResult> {
  if (bytes.byteLength === 0) return refused(refusal("file-empty", "This file is empty. Choose a CSV file with a header row and at least one data row.", "file-bytes", 0));
  if (bytes.byteLength > IMPORT_MAX_BYTES) return refused(refusal("file-too-large", `This file is ${bytes.byteLength} bytes; the limit is ${IMPORT_MAX_BYTES} bytes (5 MiB). Choose a smaller CSV file.`, "file-bytes", bytes.byteLength));
  if (isWorkbookContainer(bytes)) return refused(refusal("content-workbook", "This file is a spreadsheet workbook, not a CSV. Export the sheet as UTF-8 CSV and choose that file.", null, bytes.byteLength));
  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) return refused(decoded.refusal);
  const binaryRefusal = binaryControlRefusal(decoded.text);
  if (binaryRefusal !== null) return refused(binaryRefusal);
  const scanned = await scanCsv(decoded.text);
  if (!scanned.ok) return refused(...scanned.refusals);
  const scannedFile = scanned.scan;
  const structure = { columnCount: scannedFile.headerCells.length, dataRowCount: scannedFile.dataRecords.length, blankRowCount: scannedFile.blankRecordCount, rowFaults: [...scannedFile.rowFaults] };
  return { ok: true, file: { contentTyped: "csv-utf8", displayName, byteLength: bytes.byteLength, text: decoded.text, limits: IMPORT_LIMIT_DESCRIPTORS, structure } };
}
/** Reads admitted UTF-8 CSV text into ordered headers and ordered nonblank rows, refusing rather than returning an empty success when the text cannot be used. */ export async function parseCsv(text: string): Promise<ParseCsvResult> {
  const scanned = await scanCsv(text);
  if (!scanned.ok) return refused(...scanned.refusals);
  const headers = [...scanned.scan.headerCells];
  const rows = scanned.scan.dataRecords.map((cells, recordIndex) => ({ rowNumber: recordIndex + 1, cells: [...cells] }));
  return { ok: true, file: { contentTyped: "csv-utf8", headers, rows, columnCount: headers.length, dataRowCount: rows.length, blankRowCount: scanned.scan.blankRecordCount, rowFaults: [...scanned.scan.rowFaults] } };
}
