import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { REPORT_IDS, type ReportResult, type ReportRow } from "@/modules/support/report";
import { countCellText, civilDateText, rowAmountPath, snapshotMetadata, VALUE_STATE_TEXT } from "./csv";
import { type AuditedColumnTable } from "@/modules/export/csv";
/** Upper bound on rows rendered into an optional whole-query browser print view; queries above this bound remain printable page-by-page and exportable whole via CSV. */
export const WHOLE_QUERY_PRINT_MAX_ROWS = 2_000;
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
type ReportTitle = Readonly<Record<(typeof REPORT_IDS)[number], string>>;
const REPORT_TITLE: ReportTitle = { "received-period-and-year-to-date": "Received support — period and year to date", "monthly-history": "Received support — monthly history", "partner-month-matrix": "Received support — partner by month", "period-comparison": "Received support — period comparison" };
const RECEIVED_MEASURE_LABEL = "Received support";
const IN_PROGRESS_STATUS = "In progress";
const recordedCell = (text: string): PrintCell => ({ text, accessibleLabel: null, state: "value" });
const notCarriedCell = (fieldLabel: string): PrintCell => ({ text: VALUE_STATE_TEXT.unknown, accessibleLabel: `${fieldLabel}: ${VALUE_STATE_TEXT.unknown}. This row carries no such value, which is not a zero and not an empty value.`, state: "unknown" });
const optionalCell = (value: string | undefined, fieldLabel: string): PrintCell => (value === undefined ? notCarriedCell(fieldLabel) : recordedCell(value));
type PrintCellContext = { readonly index: number; readonly row: ReportRow; readonly locale: string; readonly stateOf: (path: string) => PrintValueState };
type PrintCellWriter = (context: PrintCellContext) => PrintCell;
function amountCell(context: PrintCellContext): PrintCell {
  const state = context.stateOf(rowAmountPath(context.index));
  const formatted = formatMinor(context.row.amount, state, context.locale);
  return { text: formatted.text, accessibleLabel: formatted.accessibleLabel, state };
}
function amountMinorUnitsCell(context: PrintCellContext): PrintCell {
  const state = context.stateOf(rowAmountPath(context.index));
  return { text: countCellText(state === "zero" ? 0 : context.row.amount.minorUnits, state), accessibleLabel: state === "value" || state === "zero" || state === "incomplete-subtotal" ? null : `${VALUE_STATE_TEXT[state]}. No minor-unit count is stated for this row.`, state };
}
function giftDateCell(context: PrintCellContext): PrintCell {
  const { row } = context;
  return row.originalGiftOn === undefined || row.datePrecision === "unknown" ? notCarriedCell("Original gift date") : recordedCell(civilDateText(row.originalGiftOn));
}
const partnerCell = (context: PrintCellContext): PrintCell => (context.row.attribution.kind === "partner" ? recordedCell(context.row.attribution.partnerId) : notCarriedCell("Partner"));
type PrintColumnSpec<Field extends keyof ReportRow> = { readonly field: Field; readonly cells: readonly (readonly [header: string, align: PrintAlign, write: PrintCellWriter])[] };
type ColumnTable = readonly [PrintColumnSpec<keyof ReportRow>, ...PrintColumnSpec<keyof ReportRow>[]];
const columnOf = <Field extends keyof ReportRow>(field: Field, ...cells: PrintColumnSpec<Field>["cells"]): PrintColumnSpec<Field> => ({ field, cells });
const COLUMN_TABLE = [
  columnOf("giftRowId", ["gift_row_id", "start", (context: PrintCellContext) => recordedCell(context.row.giftRowId)]),
  columnOf("giftId", ["gift_id", "start", (context: PrintCellContext) => recordedCell(context.row.giftId)]),
  columnOf("allocationId", ["allocation_id", "start", (context: PrintCellContext) => optionalCell(context.row.allocationId, "Allocation")]),
  columnOf("amount", ["currency", "start", (context: PrintCellContext) => recordedCell(context.row.amount.currency)], ["amount", "end", amountCell], ["amount_minor_units", "end", amountMinorUnitsCell]),
  columnOf("originalGiftOn", ["original_gift_on", "start", giftDateCell]),
  columnOf("datePrecision", ["date_precision", "start", (context: PrintCellContext) => recordedCell(context.row.datePrecision)]),
  columnOf("designation", ["designation", "start", (context: PrintCellContext) => optionalCell(context.row.designation, "Designation")]),
  columnOf("attribution", ["attribution", "start", (context: PrintCellContext) => recordedCell(context.row.attribution.kind)], ["partner_id", "start", partnerCell]),
  columnOf("refundOf", ["refund_of", "start", (context: PrintCellContext) => optionalCell(context.row.refundOf, "Refund of")]),
  columnOf("provenance", ["source_system", "start", (context: PrintCellContext) => recordedCell(context.row.provenance.system)], ["source_reference", "start", (context: PrintCellContext) => recordedCell(context.row.provenance.reference)]),
  columnOf("entryOn", ["entry_on", "start", (context: PrintCellContext) => recordedCell(civilDateText(context.row.entryOn))]),
] as const satisfies ColumnTable;
const PRINT_COLUMNS: AuditedColumnTable<typeof COLUMN_TABLE> = COLUMN_TABLE;
const printColumns = (): readonly PrintColumn[] => PRINT_COLUMNS.flatMap((column) => column.cells.map(([header, align]) => ({ header, align })));
function printRows(result: ReportResult, locale: string): readonly PrintRow[] {
  const stateOf = (path: string): PrintValueState => result.valueStates[path] ?? "unknown";
  return result.rows.map((row, index) => PRINT_COLUMNS.flatMap((column) => column.cells.map(([, , write]) => write({ index, row, locale, stateOf }))));
}
const NO_AMOUNT_MINOR_UNITS: MinorUnits = minorUnitsOf(0);
const printSummary = (result: ReportResult, locale: string): readonly PrintSummaryLine[] =>
  result.summary.map((entry) => {
    const state = entry.received.valueState;
    const formatted = formatMinor({ currency: entry.currency, minorUnits: entry.received.minorUnits ?? NO_AMOUNT_MINOR_UNITS }, state, locale);
    return { label: `${RECEIVED_MEASURE_LABEL} (${entry.currency})`, text: formatted.text, accessibleLabel: formatted.accessibleLabel, state };
  });
const carriesWithheldValue = (result: ReportResult): boolean => Object.values(result.valueStates).some((state) => state === "withheld");
function printNotes(result: ReportResult): readonly string[] {
  const notes: string[] = [];
  if (result.rows.length !== result.total) notes.push(`This view shows ${String(result.rows.length)} of ${String(result.total)} rows; export the CSV for the complete result.`);
  if (result.snapshot.coverage.state === "partial") notes.push("Coverage is partial: each subtotal on this page covers only the part of the period the source holds and is marked incomplete.");
  else if (result.snapshot.coverage.state === "unknown") notes.push("Coverage is unknown: the source did not state how much of the past this result covers, so no subtotal here is presented as a total.");
  if (carriesWithheldValue(result)) notes.push("Some values are withheld here. They are in no total, directly or by subtraction, and none of them may be inferred from any other figure on this page.");
  for (const point of result.series) if (point.gap) notes.push(`No rows in ${point.currency} ${civilDateText(point.bucketStart)} to ${civilDateText(point.bucketEnd)} — shown as a gap, not zero.`);
  return notes;
}
const printTitle = (result: ReportResult): string => `${REPORT_TITLE[result.snapshot.query.reportId]} (${civilDateText(result.snapshot.period.from)} to ${civilDateText(result.snapshot.period.to)})`;
/** Renders one report result as the printable page's model: its title, its period state, the snapshot facts it states, its per-currency summary, its table and the notes that keep it honest. */ export function printModel(result: ReportResult, options?: { locale?: string }): PrintModel {
  const locale = options?.locale ?? "en";
  const inProgress = result.snapshot.period.state === "in-progress";
  const completeness = result.rows.length === result.total ? "whole-query" : "page-only";
  return { title: printTitle(result), inProgress, statusLabel: inProgress ? IN_PROGRESS_STATUS : null, facts: snapshotMetadata(result), summary: printSummary(result, locale), columns: printColumns(), rows: printRows(result, locale), rowTotal: result.total, completeness, notes: printNotes(result) };
}
