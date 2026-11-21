import Link from "next/link";
import type { ReactElement } from "react";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { ValueState } from "@/modules/data-service/envelope";
import type { Matrix, MatrixCell, MatrixRow, ReportResult } from "@/modules/support/report";
import { EMPTY_STATES, REPORT_COPY, VALUE_STATE_MEANING } from "../copy";
import AmountValue from "./amount-value";
export type ReportMatrixProps = { readonly result: ReportResult; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly drilldownHref: (cell: MatrixCell) => string; readonly className?: string };
type MonthColumn = { readonly key: string; readonly longLabel: string; readonly shortLabel: string };
interface PartitionRow {
  readonly key: string;
  readonly label: string;
  readonly opaqueReference: boolean;
  readonly cellsByMonth: ReadonlyMap<string, MatrixCell>;
}
type StatedCell = { readonly row: PartitionRow; readonly cell: MatrixCell };
type AmountlessMarker = { readonly word: string; readonly explanation: string };
const MONTH_HEADING_FORMAT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };
const MONTH_COLUMN_FORMAT: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
const NUMERIC_CELL_CLASS = "text-end";
const QUIET_TEXT_CLASS = "text-sm text-muted-foreground";
const GAP_SENTENCE = "A month the source recorded no gift in is a gap, not a zero.";
const CAPTION_GRAIN = "one row is one partner or support attribution, one column is one month, and every cell states " + "the authorised allocations the source recorded in it";
const PERIOD_WITHOUT_AMOUNT_NOTE = "No amount is stated for this month: either the source recorded no gift, or it did not establish " + "the value. Neither is a zero.";
const ABSENT_MATRIX_DESCRIPTION = "The partners-by-month matrix is computed for that one report, so a result from another report has " + "no cells to show here. Nothing is substituted for it, because a table that looked like this one " + "while describing different records would be worse than no table at all.";
type MatrixMonth = Matrix["months"][number];
function civilLabel(date: MatrixMonth["start"], locale: string, format: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleString(locale, format);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return String(date);
  }
}
function monthsOf(matrix: Matrix, locale: string): readonly MonthColumn[] {
  return matrix.months.map((month) => ({ key: String(month.start), longLabel: civilLabel(month.start, locale, MONTH_HEADING_FORMAT), shortLabel: civilLabel(month.start, locale, MONTH_COLUMN_FORMAT) }));
}
function rowsOf(matrix: Matrix, currency: string): readonly PartitionRow[] {
  return matrix.rows.map((row) => {
    const cellsByMonth = new Map<string, MatrixCell>();
    for (const cell of row.cells) if (cell.currency === currency) cellsByMonth.set(String(cell.bucketStart), cell);
    return { key: rowKeyOf(row), label: row.label, opaqueReference: row.partnerId !== undefined, cellsByMonth };
  });
}
function rowKeyOf(row: MatrixRow): string {
  return row.partnerId === undefined ? row.attribution.kind : `partner:${row.partnerId}`;
}
function markerFor(valueState: ValueState): AmountlessMarker {
  switch (valueState) {
    case "withheld":
      return { word: "Withheld", explanation: VALUE_STATE_MEANING.withheld };
    case "unavailable":
      return { word: "Unavailable", explanation: VALUE_STATE_MEANING.unavailable };
    default:
      return { word: "Unknown", explanation: VALUE_STATE_MEANING.unknown };
  }
}
function statesAmount(cell: MatrixCell): boolean {
  return !cell.gap && cell.value.minorUnits !== null;
}
function statedCells(rows: readonly PartitionRow[], month: MonthColumn): readonly StatedCell[] {
  const stated: StatedCell[] = [];
  for (const row of rows) {
    const cell = row.cellsByMonth.get(month.key);
    if (cell !== undefined && statesAmount(cell)) {
      stated.push({ row, cell });
    }
  }
  return stated;
}
interface MatrixCompositionProps {
  readonly currency: string;
  readonly months: readonly MonthColumn[];
  readonly rows: readonly PartitionRow[];
  readonly locale: string;
  readonly drilldownHref: (cell: MatrixCell) => string;
}
function AmountlessValue({ marker }: { readonly marker: AmountlessMarker }): ReactElement {
  return (
    <span className={QUIET_TEXT_CLASS}>
      {marker.word}
      <span className="sr-only">{`. ${marker.explanation}`}</span>
    </span>
  );
}
function MatrixCellContent({ cell, scopeName, locale, drilldownHref }: { readonly cell: MatrixCell | undefined; readonly scopeName: string; readonly locale: string; readonly drilldownHref: (cell: MatrixCell) => string }): ReactElement {
  if (cell === undefined || cell.gap) {
    return <span className={QUIET_TEXT_CLASS}>No gift</span>;
  }
  const { minorUnits, valueState } = cell.value;
  if (minorUnits === null) {
    return <AmountlessValue marker={markerFor(valueState)} />;
  }
  return (
    <Link href={drilldownHref(cell)} className="inline-flex min-h-6 min-w-6 items-center justify-end rounded-sm underline-offset-4 hover:underline">
      <AmountValue money={{ currency: cell.currency, minorUnits }} valueState={valueState} locale={locale} />
      <span className="sr-only">{` — ${scopeName}`}</span>
    </Link>
  );
}
function WideMatrix({ currency, months, rows, locale, drilldownHref }: MatrixCompositionProps): ReactElement {
  return (
    <ScrollRegion label={`${REPORT_COPY.matrix.title} in ${currency}, scrollable`} className="rounded-lg">
      <Table>
        <TableCaption className="text-start">
          {`${REPORT_COPY.matrix.title} in `}
          <bdi className="mono-identifier">{currency}</bdi>
          {` — ${CAPTION_GRAIN}. ${GAP_SENTENCE}`}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Partner or support</TableHead>
            {months.map((month) => (
              <TableHead key={month.key} scope="col" className={NUMERIC_CELL_CLASS}>
                <bdi>{month.shortLabel}</bdi>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead scope="row" className="h-auto font-normal">
                <bdi className={row.opaqueReference ? "mono-identifier" : undefined}>{row.label}</bdi>
              </TableHead>
              {months.map((month) => (
                <TableCell key={month.key} className={NUMERIC_CELL_CLASS}>
                  <MatrixCellContent cell={row.cellsByMonth.get(month.key)} scopeName={`${row.label}, ${month.longLabel}`} locale={locale} drilldownHref={drilldownHref} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollRegion>
  );
}
function PeriodFirstMatrix({ currency, months, rows, locale, drilldownHref }: MatrixCompositionProps): ReactElement {
  return (
    <section aria-label={`${REPORT_COPY.matrix.title} in ${currency}, by period`} className="flex min-w-0 flex-col gap-4 md:hidden" data-slot="report-matrix-periods">
      <p className={QUIET_TEXT_CLASS}>
        {"Amounts are in "}
        <bdi className="mono-identifier">{currency}</bdi>
        {`. ${GAP_SENTENCE}`}
      </p>
      {months.map((month) => {
        const stated = statedCells(rows, month);
        return (
          <div key={month.key} className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">{month.longLabel}</h3>
            {stated.length === 0 ? (
              <p className={QUIET_TEXT_CLASS}>{PERIOD_WITHOUT_AMOUNT_NOTE}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {stated.map(({ row, cell }) => (
                  <li key={row.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words">
                      <bdi className={row.opaqueReference ? "mono-identifier" : undefined}>{row.label}</bdi>
                    </span>
                    <MatrixCellContent cell={cell} scopeName={`${row.label}, ${month.longLabel}`} locale={locale} drilldownHref={drilldownHref} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
/** Renders fixed report 3: one partner-by-month matrix per currency, each with a cell-level drilldown. */
export function ReportMatrix({ result, locale, dir, drilldownHref, className }: ReportMatrixProps): ReactElement {
  const matrix = result.matrix;
  if (matrix === undefined) {
    return (
      <div data-slot="report-matrix" dir={dir} className={cn("min-w-0", className)}>
        <StateNotice kind="empty" title="This result carries no partner-by-month matrix" description={ABSENT_MATRIX_DESCRIPTION} action={{ label: EMPTY_STATES.reports.action.label, href: EMPTY_STATES.reports.action.href }} />
      </div>
    );
  }
  if (matrix.rows.length === 0 || matrix.currencies.length === 0) {
    return (
      <div data-slot="report-matrix" dir={dir} className={cn("min-w-0", className)}>
        <StateNotice kind="empty" title={EMPTY_STATES.gifts.title} description={EMPTY_STATES.gifts.body} action={{ label: EMPTY_STATES.gifts.action.label, href: EMPTY_STATES.gifts.action.href }} />
      </div>
    );
  }
  const months = monthsOf(matrix, locale);
  return (
    <div data-slot="report-matrix" dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {matrix.currencies.map((currency) => {
        const rows = rowsOf(matrix, currency);
        return (
          <div key={currency} data-slot="report-matrix-partition" className="flex min-w-0 flex-col gap-4">
            <div className="hidden min-w-0 md:block">
              <WideMatrix currency={currency} months={months} rows={rows} locale={locale} drilldownHref={drilldownHref} />
            </div>
            <PeriodFirstMatrix currency={currency} months={months} rows={rows} locale={locale} drilldownHref={drilldownHref} />
          </div>
        );
      })}
    </div>
  );
}
export default ReportMatrix;
