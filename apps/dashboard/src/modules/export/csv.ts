/**
 * The application's only CSV production path: one `ReportResult` becomes the text of one download,
 * stating the same snapshot facts the screen, the chart, the table and the print view state (AAP
 * 0.8.8; criterion 1).
 */
import type { Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";
import { BASIS_DESCRIPTION, SUPPORT_BASIS } from "@/modules/support/basis";
import { clampPageSize, type ReportId, type ReportResult, type ReportRow } from "@/modules/support/report";
import { neutralizeCell } from "./neutralize";
// The format's own vocabulary
/** The record separator every CSV record ends with, and the one the file ends with. */
export const CSV_RECORD_SEPARATOR = "\r\n";
/** The first field of a metadata record, so a reader can find the file's identity without knowing its shape. */
export const CSV_META_FIELD = "#meta";
/** What the `amount_unit` metadata record states: every `_minor_units` column holds an exact integer count of the currency's minor units, and the column without that suffix holds the same. */
export const CSV_AMOUNT_UNIT = "minor-units";
/** What the `currency` metadata record states when the result is stated in more than one currency — or in none at all. */
export const CSV_ALL_CURRENCIES = "all-currencies";
/** What a metadata record states for a fact the source did not supply, instead of a blank field. */
export const CSV_NOT_STATED = "not-stated";

const EXPORT_ROW_GRAIN = {
  "received-period-and-year-to-date": "gift-allocation",
  "monthly-history": "gift-allocation",
  "partner-month-matrix": "gift-allocation",
  "period-comparison": "gift-allocation",
} as const satisfies Readonly<Record<ReportId, string>>;
const NEUTRALISATION_STATEMENT =
  "Every field is quoted. A leading tab is added at each position where a spreadsheet could open a " +
  "cell — the field's own start and the start of every line inside it — when the text there begins " +
  "with = + - @ TAB CR LF or the full-width forms ＝ ＋ － ＠. The tab stays part of the data, so a " +
  "consumer parsing a number strips one leading tab; no universal mitigation exists.";
type ValueState = ReportResult["valueStates"][string];
/** The words a value that is not an amount renders as, one per state. */
export const VALUE_STATE_TEXT: Readonly<Record<ValueState, string>> = {
  value: "Recorded value",
  zero: "Zero",
  unknown: "Unknown",
  withheld: "Withheld",
  unavailable: "Unavailable",
  "incomplete-subtotal": "Incomplete subtotal",
};
/** The one rendering of a stated non-monetary number: the number itself when the state carries one, and the state's word otherwise. */
export function countCellText(count: number, state: ValueState): string {
  return state === "value" || state === "zero" ? String(count) : VALUE_STATE_TEXT[state];
}
// The metadata record's fields
/** Every metadata field the file states, in the order it states them. */
export type SnapshotFactField =
  | "grain"
  | "basis"
  | "currency"
  | "period_from"
  | "period_to"
  | "period_state"
  | "coverage_from"
  | "coverage_to"
  | "coverage_state"
  | "snapshot_as_of"
  | "snapshot_query"
  | "row_total"
  | "amount_unit"
  | "neutralisation"
  | "page";
/** One fact about the snapshot a file states: its machine field name, the label a printed statement shows, and the value exactly as the metadata record carries it. */
export interface SnapshotFact {
  readonly field: SnapshotFactField;
  readonly label: string;
  readonly value: string;
}
// The column table
interface CsvRowContext {
  readonly index: number;
  readonly row: ReportRow;
  readonly stateOf: (path: string) => ValueState;
}
type CsvCellWriter = (context: CsvRowContext) => string;

interface CsvColumn<Field extends keyof ReportRow> {
  readonly field: Field;
  readonly cells: readonly (readonly [header: string, write: CsvCellWriter])[];
}
type RowField = keyof ReportRow;

type ColumnTable = readonly [CsvColumn<RowField>, ...CsvColumn<RowField>[]];

type FieldOf<Column> = Column extends { readonly field: infer Field } ? Field : never;

type DeclaredFields<Table extends ColumnTable> = FieldOf<Table[number]>;

type DeclaredFieldTuple<Table extends ColumnTable> = {
  readonly [Index in keyof Table]: FieldOf<Table[Index]>;
};
type FieldsAreDistinct<Tuple extends readonly string[], Seen extends string = never> = Tuple extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
  ? Head extends Seen
    ? false
    : FieldsAreDistinct<Tail, Seen | Head>
  : true;
type AuditedColumnTable<Table extends ColumnTable> = [Exclude<RowField, DeclaredFields<Table>>] extends [never]
  ? [Exclude<DeclaredFields<Table>, RowField>] extends [never]
    ? FieldsAreDistinct<DeclaredFieldTuple<Table>> extends true
      ? Table
      : never
    : never
  : never;
// Reading the result the export states
type CivilDate = NonNullable<ReportRow["originalGiftOn"]>;

function civilDateText(date: CivilDate): string {
  return date.withCalendar("iso8601").toString();
}
function giftDateText(row: ReportRow): string {
  if (row.originalGiftOn === undefined || row.datePrecision === "unknown") {
    return VALUE_STATE_TEXT.unknown;
  }
  return civilDateText(row.originalGiftOn);
}
function rowAmountPath(index: number): string {
  return `rows.${index}.amount`;
}
const MACHINE_LOCALE = "en";

function amountCells(amount: Money, state: ValueState): readonly [string, string] {
  if (state === "value" || state === "zero") {
    return [formatMinor(amount, state, MACHINE_LOCALE).plain, String(amount.minorUnits)];
  }
  const marker = VALUE_STATE_TEXT[state];
  return [marker, marker];
}
function currencyOf(result: ReportResult): string {
  const codes = result.snapshot.currencies;
  if (codes.includes(UNKNOWN_CURRENCY)) {
    return UNKNOWN_CURRENCY;
  }
  const [only] = codes;
  return codes.length === 1 && only !== undefined ? only : CSV_ALL_CURRENCIES;
}
function periodIdentity(period: ReportResult["snapshot"]["query"]["period"]): string {
  switch (period.kind) {
    case "preset":
      return `preset:${period.preset}`;
    case "explicit":
      return `explicit:${civilDateText(period.from)}..${civilDateText(period.to)}`;
    case "year":
      return `year:${String(period.year)}`;
  }
}
function partnerIdentity(partner: ReportResult["snapshot"]["query"]["partner"]): string {
  if (partner === undefined) {
    return CSV_NOT_STATED;
  }
  return partner.kind === "partner" ? `partner:${partner.partnerId}` : partner.kind;
}
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
function pageScope(result: ReportResult): string {
  return result.rows.length === result.total ? "whole-query" : "page-only";
}
// The columns
const COLUMN_TABLE = [
  {
    field: "giftRowId",
    cells: [["gift_row_id", (context: CsvRowContext) => context.row.giftRowId]],
  },
  {
    field: "giftId",
    cells: [["gift_id", (context: CsvRowContext) => context.row.giftId]],
  },
  {
    field: "allocationId",
    cells: [["allocation_id", (context: CsvRowContext) => context.row.allocationId ?? ""]],
  },
  {
    field: "amount",
    cells: [
      ["currency", (context: CsvRowContext) => context.row.amount.currency],
      ["amount", (context: CsvRowContext) => amountCells(context.row.amount, context.stateOf(rowAmountPath(context.index)))[0]],
      ["amount_minor_units", (context: CsvRowContext) => amountCells(context.row.amount, context.stateOf(rowAmountPath(context.index)))[1]],
    ],
  },
  {
    field: "originalGiftOn",
    cells: [["original_gift_on", (context: CsvRowContext) => giftDateText(context.row)]],
  },
  {
    field: "datePrecision",
    cells: [["date_precision", (context: CsvRowContext) => context.row.datePrecision]],
  },
  {
    field: "designation",
    cells: [["designation", (context: CsvRowContext) => context.row.designation ?? ""]],
  },
  {
    field: "attribution",
    cells: [
      ["attribution", (context: CsvRowContext) => context.row.attribution.kind],
      ["partner_id", (context: CsvRowContext) => (context.row.attribution.kind === "partner" ? context.row.attribution.partnerId : "")],
    ],
  },
  {
    field: "refundOf",
    cells: [["refund_of", (context: CsvRowContext) => context.row.refundOf ?? ""]],
  },
  {
    field: "provenance",
    cells: [
      ["source_system", (context: CsvRowContext) => context.row.provenance.system],
      ["source_reference", (context: CsvRowContext) => context.row.provenance.reference],
    ],
  },
  {
    field: "entryOn",
    cells: [["entry_on", (context: CsvRowContext) => civilDateText(context.row.entryOn)]],
  },
] as const satisfies ColumnTable;
const CSV_COLUMNS: AuditedColumnTable<typeof COLUMN_TABLE> = COLUMN_TABLE;
/** The data record's headers, in the order written. */
export const CSV_COLUMN_HEADERS: readonly string[] = CSV_COLUMNS.flatMap((column) => column.cells.map(([header]) => header));
// The records
function record(fields: readonly string[]): string {
  const escaped = fields.map((field) => neutralizeCell(field)).join(",");
  return `${escaped}${CSV_RECORD_SEPARATOR}`;
}
// The snapshot the file states
/** The facts that identify the snapshot the file holds: its grain, basis, currency partition, period and period state, coverage, as-of instant, exact query, whole-result count, amount unit. */
export function snapshotMetadata(result: ReportResult): readonly SnapshotFact[] {
  const { snapshot } = result;
  return [
    {
      field: "grain",
      label: "Grain",
      value: EXPORT_ROW_GRAIN[snapshot.query.reportId],
    },
    {
      field: "basis",
      label: "Basis",
      value: `${SUPPORT_BASIS}: ${BASIS_DESCRIPTION}`,
    },
    {
      field: "currency",
      label: "Currency",
      value: currencyOf(result),
    },
    {
      field: "period_from",
      label: "Period from",
      value: civilDateText(snapshot.period.from),
    },
    {
      field: "period_to",
      label: "Period to",
      value: civilDateText(snapshot.period.to),
    },
    {
      field: "period_state",
      label: "Period state",
      value: snapshot.period.state,
    },
    {
      field: "coverage_from",
      label: "Coverage from",
      value: snapshot.coverage.from ?? CSV_NOT_STATED,
    },
    {
      field: "coverage_to",
      label: "Coverage to",
      value: snapshot.coverage.to ?? CSV_NOT_STATED,
    },
    {
      field: "coverage_state",
      label: "Coverage state",
      value: snapshot.coverage.state,
    },
    {
      field: "snapshot_as_of",
      label: "Snapshot as of",
      value: snapshot.asOf,
    },
    {
      field: "snapshot_query",
      label: "Snapshot query",
      value: queryIdentity(snapshot.query),
    },
    {
      field: "row_total",
      label: "Row total",
      value: String(result.total),
    },
    {
      field: "amount_unit",
      label: "Amount unit",
      value: CSV_AMOUNT_UNIT,
    },
    {
      field: "neutralisation",
      label: "Neutralisation",
      value: NEUTRALISATION_STATEMENT,
    },
    {
      field: "page",
      label: "Page",
      value: pageScope(result),
    },
  ];
}
// The writer
/** Renders one report result as the text of a CSV download: its metadata records, the one column header record and one record per authorised row, in the order the service returned them. */
export function toCsv(result: ReportResult): string {
  const stateOf = (path: string): ValueState => result.valueStates[path] ?? "unknown";
  const records: string[] = [];
  for (const fact of snapshotMetadata(result)) {
    records.push(record([CSV_META_FIELD, fact.field, fact.value]));
  }
  records.push(record(CSV_COLUMN_HEADERS));
  result.rows.forEach((row, index) => {
    const cells = CSV_COLUMNS.flatMap((column) => column.cells.map(([, write]) => write({ index, row, stateOf })));
    records.push(record(cells));
  });
  return records.join("");
}
