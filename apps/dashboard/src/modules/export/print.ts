/** The print model: one `ReportResult` as the text and the semantics of a printable page, so a worker can print the answer to a report query and read the same figures, the same period. */
import { minorUnitsOf, type MinorUnits, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { REPORT_IDS, type ReportResult, type ReportRow } from "@/modules/support/report";
import { countCellText, snapshotMetadata, VALUE_STATE_TEXT } from "./csv";
export type PrintValueState = ReportResult["valueStates"][string];
export type PrintFact = { readonly field: string; readonly label: string; readonly value: string };
export type PrintSummaryLine = { readonly label: string; readonly text: string; readonly accessibleLabel: string; readonly state: PrintValueState };
export type PrintColumn = { readonly header: string; readonly align: "start" | "end" };
export type PrintCell = { readonly text: string; readonly accessibleLabel: string | null; readonly state: PrintValueState };
export type PrintRow = readonly PrintCell[];
export type PrintModel = {
  readonly title: string;
  readonly inProgress: boolean;
  readonly statusLabel: string | null;
  readonly facts: readonly PrintFact[];
  readonly summary: readonly PrintSummaryLine[];
  readonly columns: readonly PrintColumn[];
  readonly rows: readonly PrintRow[];
  readonly rowTotal: number;
  readonly completeness: "whole-query" | "page-only";
  readonly notes: readonly string[];
};
type PrintAlign = PrintColumn["align"];
const REPORT_TITLE = { "received-period-and-year-to-date": "Received support — period and year to date", "monthly-history": "Received support — monthly history", "partner-month-matrix": "Received support — partner by month", "period-comparison": "Received support — period comparison" } as const satisfies Readonly<
  Record<(typeof REPORT_IDS)[number], string>
>;
const RECEIVED_MEASURE_LABEL = "Received support";
const IN_PROGRESS_STATUS = "In progress";
type CivilDate = NonNullable<ReportRow["originalGiftOn"]>;
/** A civil date's text, taken from the value or from its wire form: the printed page is built from the same result the browser received, where a calendar day travels as its own `YYYY-MM-DD` text. */
const civilDateText = (date: CivilDate | string): string => (typeof date === "string" ? date : date.withCalendar("iso8601").toString());
const recordedCell = (text: string): PrintCell => ({ text, accessibleLabel: null, state: "value" });
function notCarriedCell(fieldLabel: string): PrintCell {
  const text = VALUE_STATE_TEXT.unknown;
  return { text, accessibleLabel: `${fieldLabel}: ${text}. This row carries no such value, which is not a zero and not an empty value.`, state: "unknown" };
}
const optionalCell = (value: string | undefined, fieldLabel: string): PrintCell => (value === undefined ? notCarriedCell(fieldLabel) : recordedCell(value));
const rowAmountPath = (index: number): string => `rows.${index}.amount`;
type PrintCellContext = { readonly index: number; readonly row: ReportRow; readonly locale: string; readonly stateOf: (path: string) => PrintValueState };
type PrintCellWriter = (context: PrintCellContext) => PrintCell;
function amountCell(context: PrintCellContext): PrintCell {
  const state = context.stateOf(rowAmountPath(context.index));
  const formatted = formatMinor(context.row.amount, state, context.locale);
  return { text: formatted.text, accessibleLabel: formatted.accessibleLabel, state };
}
function amountMinorUnitsCell(context: PrintCellContext): PrintCell {
  const state = context.stateOf(rowAmountPath(context.index));
  const carriesNumber = state === "value" || state === "zero" || state === "incomplete-subtotal";
  const count = state === "zero" ? 0 : context.row.amount.minorUnits;
  return { text: countCellText(count, state), accessibleLabel: carriesNumber ? null : `${VALUE_STATE_TEXT[state]}. No minor-unit count is stated for this row.`, state };
}
function giftDateCell(context: PrintCellContext): PrintCell {
  const { row } = context;
  if (row.originalGiftOn === undefined || row.datePrecision === "unknown") return notCarriedCell("Original gift date");
  return recordedCell(civilDateText(row.originalGiftOn));
}
const partnerCell = (context: PrintCellContext): PrintCell => (context.row.attribution.kind === "partner" ? recordedCell(context.row.attribution.partnerId) : notCarriedCell("Partner"));
type PrintColumnSpec<Field extends keyof ReportRow> = { readonly field: Field; readonly cells: readonly (readonly [header: string, align: PrintAlign, write: PrintCellWriter])[] };
type RowField = keyof ReportRow;
type ColumnTable = readonly [PrintColumnSpec<RowField>, ...PrintColumnSpec<RowField>[]];
type FieldOf<Column> = Column extends { readonly field: infer Field } ? Field : never;
type DeclaredFields<Table extends ColumnTable> = FieldOf<Table[number]>;
type DeclaredFieldTuple<Table extends ColumnTable> = { readonly [Index in keyof Table]: FieldOf<Table[Index]> };
type FieldsAreDistinct<Tuple extends readonly string[], Seen extends string = never> = Tuple extends readonly [infer Head extends string, ...infer Tail extends readonly string[]] ? (Head extends Seen ? false : FieldsAreDistinct<Tail, Seen | Head>) : true;
type AuditedColumnTable<Table extends ColumnTable> = [Exclude<RowField, DeclaredFields<Table>>] extends [never] ? ([Exclude<DeclaredFields<Table>, RowField>] extends [never] ? (FieldsAreDistinct<DeclaredFieldTuple<Table>> extends true ? Table : never) : never) : never;
const COLUMN_TABLE = [
  { field: "giftRowId", cells: [["gift_row_id", "start", (context: PrintCellContext) => recordedCell(context.row.giftRowId)]] },
  { field: "giftId", cells: [["gift_id", "start", (context: PrintCellContext) => recordedCell(context.row.giftId)]] },
  { field: "allocationId", cells: [["allocation_id", "start", (context: PrintCellContext) => optionalCell(context.row.allocationId, "Allocation")]] },
  {
    field: "amount",
    cells: [
      ["currency", "start", (context: PrintCellContext) => recordedCell(context.row.amount.currency)],
      ["amount", "end", amountCell],
      ["amount_minor_units", "end", amountMinorUnitsCell],
    ],
  },
  { field: "originalGiftOn", cells: [["original_gift_on", "start", giftDateCell]] },
  { field: "datePrecision", cells: [["date_precision", "start", (context: PrintCellContext) => recordedCell(context.row.datePrecision)]] },
  { field: "designation", cells: [["designation", "start", (context: PrintCellContext) => optionalCell(context.row.designation, "Designation")]] },
  {
    field: "attribution",
    cells: [
      ["attribution", "start", (context: PrintCellContext) => recordedCell(context.row.attribution.kind)],
      ["partner_id", "start", partnerCell],
    ],
  },
  { field: "refundOf", cells: [["refund_of", "start", (context: PrintCellContext) => optionalCell(context.row.refundOf, "Refund of")]] },
  {
    field: "provenance",
    cells: [
      ["source_system", "start", (context: PrintCellContext) => recordedCell(context.row.provenance.system)],
      ["source_reference", "start", (context: PrintCellContext) => recordedCell(context.row.provenance.reference)],
    ],
  },
  { field: "entryOn", cells: [["entry_on", "start", (context: PrintCellContext) => recordedCell(civilDateText(context.row.entryOn))]] },
] as const satisfies ColumnTable;
const PRINT_COLUMNS: AuditedColumnTable<typeof COLUMN_TABLE> = COLUMN_TABLE;
function printColumns(): readonly PrintColumn[] {
  return PRINT_COLUMNS.flatMap((column) => column.cells.map(([header, align]) => ({ header, align })));
}
function printRows(result: ReportResult, locale: string): readonly PrintRow[] {
  const stateOf = (path: string): PrintValueState => result.valueStates[path] ?? "unknown";
  return result.rows.map((row, index) => PRINT_COLUMNS.flatMap((column) => column.cells.map(([, , write]) => write({ index, row, locale, stateOf }))));
}
const NO_AMOUNT_MINOR_UNITS: MinorUnits = minorUnitsOf(0);
function printSummary(result: ReportResult, locale: string): readonly PrintSummaryLine[] {
  return result.summary.map((entry) => {
    const state = entry.received.valueState;
    const amount: Money = { currency: entry.currency, minorUnits: entry.received.minorUnits ?? NO_AMOUNT_MINOR_UNITS };
    const formatted = formatMinor(amount, state, locale);
    return { label: `${RECEIVED_MEASURE_LABEL} (${entry.currency})`, text: formatted.text, accessibleLabel: formatted.accessibleLabel, state };
  });
}
function carriesWithheldValue(result: ReportResult): boolean {
  return Object.values(result.valueStates).some((state) => state === "withheld");
}
function printNotes(result: ReportResult): readonly string[] {
  const notes: string[] = [];
  if (result.rows.length !== result.total) notes.push(`This view shows ${String(result.rows.length)} of ${String(result.total)} rows; export the CSV for the complete result.`);
  if (result.snapshot.coverage.state === "partial") {
    notes.push("Coverage is partial: each subtotal on this page covers only the part of the period the source holds and is marked incomplete.");
  } else if (result.snapshot.coverage.state === "unknown") {
    notes.push("Coverage is unknown: the source did not state how much of the past this result covers, so no subtotal here is presented as a total.");
  }
  if (carriesWithheldValue(result)) notes.push("Some values are withheld here. They are in no total, directly or by subtraction, and none of them may be inferred from any other figure on this page.");
  for (const point of result.series) {
    if (!point.gap) continue;
    notes.push(`No rows in ${point.currency} ${civilDateText(point.bucketStart)} to ${civilDateText(point.bucketEnd)} — shown as a gap, not zero.`);
  }
  return notes;
}
function printTitle(result: ReportResult): string {
  const { period, query } = result.snapshot;
  return `${REPORT_TITLE[query.reportId]} (${civilDateText(period.from)} to ${civilDateText(period.to)})`;
}
/** Renders one report result as the printable page's model: its title, its period state, the snapshot facts it states, its per-currency summary, its table and the notes that keep it honest. */
export function printModel(result: ReportResult, options?: { locale?: string }): PrintModel {
  const locale = options?.locale ?? "en";
  const inProgress = result.snapshot.period.state === "in-progress";
  return {
    title: printTitle(result),
    inProgress,
    statusLabel: inProgress ? IN_PROGRESS_STATUS : null,
    facts: snapshotMetadata(result),
    summary: printSummary(result, locale),
    columns: printColumns(),
    rows: printRows(result, locale),
    rowTotal: result.total,
    completeness: result.rows.length === result.total ? "whole-query" : "page-only",
    notes: printNotes(result),
  };
}
