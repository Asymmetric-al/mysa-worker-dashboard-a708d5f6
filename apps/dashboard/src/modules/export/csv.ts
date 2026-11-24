import type { Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { BASIS_DESCRIPTION, SUPPORT_BASIS } from "@/modules/support/basis";
import { clampPageSize, type ReportId, type ReportResult, type ReportRow } from "@/modules/support/report";
import { neutralizeCell } from "./neutralize";
export const CSV_RECORD_SEPARATOR = "\r\n";
export const CSV_META_FIELD = "#meta";
export const CSV_AMOUNT_UNIT = "minor-units";
export const CSV_ALL_CURRENCIES = "all-currencies";
export const CSV_NOT_STATED = "not-stated";
const EXPORT_ROW_GRAIN = { "received-period-and-year-to-date": "gift-allocation", "monthly-history": "gift-allocation", "partner-month-matrix": "gift-allocation", "period-comparison": "gift-allocation" } as const satisfies Readonly<Record<ReportId, string>>;
const NEUTRALISATION_STATEMENT =
  "Every field is quoted. A leading tab is added at each position where a spreadsheet could open a cell — the field's own start and the start of every line inside it — when the text there begins with = + - @ TAB CR LF or the full-width forms ＝ ＋ － ＠. The tab stays part of the data, so a consumer parsing a number strips one leading tab; no universal mitigation exists.";
type ValueState = ReportResult["valueStates"][string];
export const VALUE_STATE_TEXT: Readonly<Record<ValueState, string>> = { value: "Recorded value", zero: "Zero", unknown: "Unknown", withheld: "Withheld", unavailable: "Unavailable", "incomplete-subtotal": "Incomplete subtotal" };
export const countCellText = (count: number, state: ValueState): string => (state === "value" || state === "zero" ? String(count) : VALUE_STATE_TEXT[state]);
export type SnapshotFactField = "grain" | "basis" | "currency" | "period_from" | "period_to" | "period_state" | "coverage_from" | "coverage_to" | "coverage_state" | "snapshot_as_of" | "snapshot_query" | "row_total" | "amount_unit" | "neutralisation" | "page";
export type SnapshotFact = { readonly field: SnapshotFactField; readonly label: string; readonly value: string };
type CsvRowContext = { readonly row: ReportRow; readonly stateOf: (path: string) => ValueState; readonly amountFields: () => readonly [string, string] };
type CsvCellWriter = (context: CsvRowContext) => string;
type CsvColumn<Field extends keyof ReportRow> = { readonly field: Field; readonly cells: readonly (readonly [header: string, write: CsvCellWriter])[] };
type RowField = keyof ReportRow;
type ColumnTable = readonly [CsvColumn<RowField>, ...CsvColumn<RowField>[]];
type FieldOf<Column> = Column extends { readonly field: infer Field } ? Field : never;
type DeclaredFieldTuple<Table extends readonly unknown[]> = { readonly [Index in keyof Table]: FieldOf<Table[Index]> };
type FieldsAreDistinct<Tuple extends readonly string[], Seen extends string = never> = Tuple extends readonly [infer Head extends string, ...infer Tail extends readonly string[]] ? (Head extends Seen ? false : FieldsAreDistinct<Tail, Seen | Head>) : true;
export type AuditedColumnTable<Table extends readonly { readonly field: RowField }[]> = [Exclude<RowField, FieldOf<Table[number]>>] extends [never] ? ([Exclude<FieldOf<Table[number]>, RowField>] extends [never] ? (FieldsAreDistinct<DeclaredFieldTuple<Table>> extends true ? Table : never) : never) : never;
export type ExportCivilDate = NonNullable<ReportRow["originalGiftOn"]>;
export const civilDateText = (date: ExportCivilDate | string): string => (typeof date === "string" ? date : date.withCalendar("iso8601").toString());
const giftDateText = (row: ReportRow): string => (row.originalGiftOn === undefined || row.datePrecision === "unknown" ? VALUE_STATE_TEXT.unknown : civilDateText(row.originalGiftOn));
export const rowAmountPath = (index: number): string => `rows.${index}.amount`;
const MACHINE_LOCALE = "en";
function amountCells(amount: Money, state: ValueState): readonly [string, string] {
  if (state === "value" || state === "zero") return [formatMinor(amount, state, MACHINE_LOCALE).plain, String(amount.minorUnits)];
  const marker = VALUE_STATE_TEXT[state];
  return [marker, marker];
}
// One row's context, whose amount cells are formatted on first use and handed to the column's second writer from there.
function rowContextOf(row: ReportRow, index: number, stateOf: (path: string) => ValueState): CsvRowContext {
  let cells: readonly [string, string] | undefined;
  return { row, stateOf, amountFields: () => (cells ??= amountCells(row.amount, stateOf(rowAmountPath(index)))) };
}
// The currency the file states is the query's own partition, which is the fact its coverage states too, so the file's record and its envelope can never describe the query differently. A row whose own currency is unknown still prints its own code in the row's currency column.
function currencyOf(result: ReportResult): string {
  const { currency } = result.snapshot.query;
  return currency.kind === "one" ? currency.currency : CSV_ALL_CURRENCIES;
}
const periodIdentity = (period: ReportResult["snapshot"]["query"]["period"]): string => (period.kind === "preset" ? `preset:${period.preset}` : period.kind === "explicit" ? `explicit:${civilDateText(period.from)}..${civilDateText(period.to)}` : `year:${String(period.year)}`);
const partnerIdentity = (partner: ReportResult["snapshot"]["query"]["partner"]): string => (partner === undefined ? CSV_NOT_STATED : partner.kind === "partner" ? `partner:${partner.partnerId}` : partner.kind);
function queryIdentity(query: ReportResult["snapshot"]["query"]): string {
  const range = query.amountRange;
  const page = query.page;
  return [
    `report=${query.reportId}`,
    `period=${periodIdentity(query.period)}`,
    `currency=${query.currency.kind === "one" ? `one:${query.currency.currency}` : "all"}`,
    `amount=${range === undefined ? CSV_NOT_STATED : `${String(range.minMinor)}..${String(range.maxMinor)}`}`,
    `designation=${query.designation ?? CSV_NOT_STATED}`,
    `partner=${partnerIdentity(query.partner)}`,
    `search=${query.search ?? CSV_NOT_STATED}`,
    `sort=${query.sort === undefined ? CSV_NOT_STATED : `${query.sort.field}:${query.sort.direction}`}`,
    `page=${page === undefined ? CSV_NOT_STATED : `index:${String(page.index)},size:${String(clampPageSize(page.size))}`}`,
  ].join(";");
}
const pageScope = (result: ReportResult): string => (result.rows.length === result.total ? "whole-query" : "page-only");
const columnOf = <Field extends RowField>(field: Field, ...cells: CsvColumn<Field>["cells"]): CsvColumn<Field> => ({ field, cells });
const COLUMN_TABLE = [
  columnOf("giftRowId", ["gift_row_id", (context: CsvRowContext) => context.row.giftRowId]),
  columnOf("giftId", ["gift_id", (context: CsvRowContext) => context.row.giftId]),
  columnOf("allocationId", ["allocation_id", (context: CsvRowContext) => context.row.allocationId ?? ""]),
  columnOf("amount", ["currency", (context: CsvRowContext) => context.row.amount.currency], ["amount", (context: CsvRowContext) => context.amountFields()[0]], ["amount_minor_units", (context: CsvRowContext) => context.amountFields()[1]]),
  columnOf("originalGiftOn", ["original_gift_on", (context: CsvRowContext) => giftDateText(context.row)]),
  columnOf("datePrecision", ["date_precision", (context: CsvRowContext) => context.row.datePrecision]),
  columnOf("designation", ["designation", (context: CsvRowContext) => context.row.designation ?? ""]),
  columnOf("attribution", ["attribution", (context: CsvRowContext) => context.row.attribution.kind], ["partner_id", (context: CsvRowContext) => (context.row.attribution.kind === "partner" ? context.row.attribution.partnerId : "")]),
  columnOf("refundOf", ["refund_of", (context: CsvRowContext) => context.row.refundOf ?? ""]),
  columnOf("provenance", ["source_system", (context: CsvRowContext) => context.row.provenance.system], ["source_reference", (context: CsvRowContext) => context.row.provenance.reference]),
  columnOf("entryOn", ["entry_on", (context: CsvRowContext) => civilDateText(context.row.entryOn)]),
] as const satisfies ColumnTable;
const CSV_COLUMNS: AuditedColumnTable<typeof COLUMN_TABLE> = COLUMN_TABLE;
export const CSV_COLUMN_HEADERS: readonly string[] = CSV_COLUMNS.flatMap((column) => column.cells.map(([header]) => header));
const record = (fields: readonly string[]): string => `${fields.map((field) => neutralizeCell(field)).join(",")}${CSV_RECORD_SEPARATOR}`;
/** The facts that identify the snapshot the file holds: its grain, basis, currency partition, period and period state, coverage, as-of instant, exact query, whole-result count, amount unit. */ export function snapshotMetadata(result: ReportResult): readonly SnapshotFact[] {
  const { snapshot } = result;
  return [
    { field: "grain", label: "Grain", value: EXPORT_ROW_GRAIN[snapshot.query.reportId] },
    { field: "basis", label: "Basis", value: `${SUPPORT_BASIS}: ${BASIS_DESCRIPTION}` },
    { field: "currency", label: "Currency", value: currencyOf(result) },
    { field: "period_from", label: "Period from", value: civilDateText(snapshot.period.from) },
    { field: "period_to", label: "Period to", value: civilDateText(snapshot.period.to) },
    { field: "period_state", label: "Period state", value: snapshot.period.state },
    { field: "coverage_from", label: "Coverage from", value: snapshot.coverage.from ?? CSV_NOT_STATED },
    { field: "coverage_to", label: "Coverage to", value: snapshot.coverage.to ?? CSV_NOT_STATED },
    { field: "coverage_state", label: "Coverage state", value: snapshot.coverage.state },
    { field: "snapshot_as_of", label: "Snapshot as of", value: snapshot.asOf },
    { field: "snapshot_query", label: "Snapshot query", value: queryIdentity(snapshot.query) },
    { field: "row_total", label: "Row total", value: String(result.total) },
    { field: "amount_unit", label: "Amount unit", value: CSV_AMOUNT_UNIT },
    { field: "neutralisation", label: "Neutralisation", value: NEUTRALISATION_STATEMENT },
    { field: "page", label: "Page", value: pageScope(result) },
  ];
}
const RECORDS_PER_TURN = 2048;
// One event-loop turn: `setImmediate` where the runtime answers it and a zero-delay timer where it does not, so the writer yields either way.
const nextTurn = (): Promise<void> =>
  new Promise<void>((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
/** Renders one report result as the text of a CSV download: its metadata records, the one column header record and one record per authorised row, in the order the service returned them. Answers the whole file, or throws the signal's abort error once the caller that asked for it has gone. */
export async function toCsv(result: ReportResult, signal?: AbortSignal): Promise<string> {
  const stateOf = (path: string): ValueState => result.valueStates[path] ?? "unknown";
  // Accumulated as one string and never as an array joined at the end: a hundred thousand record strings joined into a second copy would hold the whole file twice over while the copy is made.
  let text =
    snapshotMetadata(result)
      .map((fact) => record([CSV_META_FIELD, fact.field, fact.value]))
      .join("") + record(CSV_COLUMN_HEADERS);
  for (const [index, row] of result.rows.entries()) {
    // Rendered as one synchronous block, a whole-query file would starve every other request and hold the close of the caller's socket undelivered, so an abandoned export could not learn that nobody is waiting for it. One turn every 2,048 records lets both events be delivered, and the signal is re-checked after each turn.
    if (index % RECORDS_PER_TURN === 0) {
      await nextTurn();
      signal?.throwIfAborted();
    }
    const context = rowContextOf(row, index, stateOf);
    text += record(CSV_COLUMNS.flatMap((column) => column.cells.map(([, write]) => write(context))));
  }
  return text;
}
