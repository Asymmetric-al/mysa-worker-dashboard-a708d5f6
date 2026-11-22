"use client";
import Link from "next/link";
import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { PaginationBar } from "@/components/pagination-bar";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/cn";
import type { GiftAttribution, ValueState } from "@/modules/data-service/envelope";
import type { Matrix, MatrixCell, MatrixRow, ReportQuery, ReportResult } from "@/modules/support/report";
import { EMPTY_STATES, REPORT_COPY, VALUE_STATE_MEANING } from "../copy";
import AmountValue from "./amount-value";
/** The address one matrix cell opens, bound to the query the matrix was computed from. */
type CellHref = (attribution: GiftAttribution, cell: MatrixCell) => string;
export type ReportMatrixProps = { readonly result: ReportResult; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly drilldownHref: (query: ReportQuery, attribution: GiftAttribution, cell: MatrixCell) => string; readonly onSelectPage: (page: number, pageSize: number) => void; readonly className?: string };
type MonthColumn = { readonly key: string; readonly longLabel: string; readonly shortLabel: string };
interface PartitionRow {
  readonly key: string;
  readonly attribution: GiftAttribution;
  readonly label: string;
  readonly opaqueReference: boolean;
  readonly cellsByMonth: ReadonlyMap<string, MatrixCell>;
}
/** One currency's presentation of the served page of rows. */
type MatrixPartition = { readonly currency: string; readonly rows: readonly PartitionRow[] };
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
/** What the pager counts: the partner and attribution rows the matrix is made of, never the money in them. */
const ITEM_NOUN = "rows";
/** A result that carries no matrix renders its own notice, so the derived values above that notice are empty rather than absent, and no hook is called after a return. */
const NO_MONTHS: readonly MonthColumn[] = [];
const NO_PARTITIONS: readonly MatrixPartition[] = [];
type MatrixMonth = Matrix["months"][number];
/** The window a rows-per-page choice asks for: the page counted from one as the pager counts it, beside the size asked for. */
type PageAsk = { readonly page: number; readonly size: number };
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
    return { key: rowKeyOf(row), attribution: row.attribution, label: row.label, opaqueReference: row.partnerId !== undefined, cellsByMonth };
  });
}
function rowKeyOf(row: MatrixRow): string {
  return row.partnerId === undefined ? row.attribution.kind : `partner:${row.partnerId}`;
}
/** The page, counted from one as the pager counts it, that keeps the reader on the row they were reading once the window holds the new size: the page the first row of the current window falls on, clamped to the pages the whole result has at that size. The size handed here is one of the pager's own options, so it is a positive whole number of rows. */
function pageHoldingFirstRow(firstRowIndex: number, pageSize: number, total: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
  return Math.min(Math.trunc(Math.max(0, firstRowIndex) / pageSize) + 1, pages);
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
  readonly drilldownHref: CellHref;
}
function AmountlessValue({ marker }: { readonly marker: AmountlessMarker }): ReactElement {
  return (
    <span className={QUIET_TEXT_CLASS}>
      {marker.word}
      <span className="sr-only">{`. ${marker.explanation}`}</span>
    </span>
  );
}
function MatrixCellContent({ cell, attribution, scopeName, locale, drilldownHref }: { readonly cell: MatrixCell | undefined; readonly attribution: GiftAttribution; readonly scopeName: string; readonly locale: string; readonly drilldownHref: CellHref }): ReactElement {
  if (cell === undefined || cell.gap) {
    return <span className={QUIET_TEXT_CLASS}>No gift</span>;
  }
  const { minorUnits, valueState } = cell.value;
  if (minorUnits === null) {
    return <AmountlessValue marker={markerFor(valueState)} />;
  }
  return (
    <Link href={drilldownHref(attribution, cell)} className="inline-flex min-h-6 min-w-6 items-center justify-end rounded-sm underline-offset-4 hover:underline">
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
                  <MatrixCellContent cell={row.cellsByMonth.get(month.key)} attribution={row.attribution} scopeName={`${row.label}, ${month.longLabel}`} locale={locale} drilldownHref={drilldownHref} />
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
    <section aria-label={`${REPORT_COPY.matrix.title} in ${currency}, by period`} className="flex min-w-0 flex-col gap-4" data-slot="report-matrix-periods">
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
                    <MatrixCellContent cell={cell} attribution={row.attribution} scopeName={`${row.label}, ${month.longLabel}`} locale={locale} drilldownHref={drilldownHref} />
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
/** Renders fixed report 3: one partner-by-month matrix per currency over the page of rows the read served, each with a cell-level drilldown. */
export function ReportMatrix({ result, locale, dir, drilldownHref, onSelectPage, className }: ReportMatrixProps): ReactElement {
  const matrix = result.matrix;
  // The cell's narrowing is derived from the query this matrix was computed from rather than read out of the
  // cell, so the cell states its figure and nothing else.
  const hrefOf = useCallback<CellHref>((attribution, cell) => drilldownHref(result.snapshot.query, attribution, cell), [drilldownHref, result.snapshot.query]);
  // The month headings and the per-currency rows are derived once per matrix: a page or size change renders this
  // surface again from a new answer, and neither derivation belongs to that change.
  const months = useMemo<readonly MonthColumn[]>(() => (matrix === undefined ? NO_MONTHS : monthsOf(matrix, locale)), [matrix, locale]);
  const partitions = useMemo<readonly MatrixPartition[]>(() => (matrix === undefined ? NO_PARTITIONS : matrix.currencies.map((currency) => ({ currency, rows: rowsOf(matrix, currency) }))), [matrix]);
  // One presentation is mounted per viewport, never two: a presentation hidden by a media query still costs
  // every row and every cell it renders. The viewport query is the shell's own 768 px breakpoint.
  const narrow = useIsMobile();
  // The window a rows-per-page choice asked for, held only for the length of that one gesture. The pager reports
  // one choice through two callbacks — the size, then the page that size implies when the window has to move to
  // keep the reader on the row they were reading — and each callback states a whole window in the address. Both
  // of those writes read the same pre-gesture search, because `router.replace` does not commit before the
  // callback returns: composed from that search alone, the page write would state the size the last answer served
  // over the size just asked for, and the choice would be discarded. So a size choice states its whole window
  // once, and the page report that follows it is recognised as that same window rather than written again.
  const askedWindow = useRef<PageAsk | null>(null);
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
  return (
    <div data-slot="report-matrix" dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {partitions.map(({ currency, rows }) => (
        <div key={currency} data-slot="report-matrix-partition" className="flex min-w-0 flex-col gap-4">
          {narrow ? <PeriodFirstMatrix currency={currency} months={months} rows={rows} locale={locale} drilldownHref={hrefOf} /> : <WideMatrix currency={currency} months={months} rows={rows} locale={locale} drilldownHref={hrefOf} />}
        </div>
      ))}
      {/* The pager states the whole result's row count beside the window the read served, so the caption reads
          "Showing 1–50 of 9,000 rows" rather than the page alone. A change states the address's window and the
          read answers it: no page is held here beside the answer, and a page the read clamped is the page shown.
          A rows-per-page choice is one window rather than two, so the size states the page it implies itself and
          the page report that follows the same choice writes nothing further. */}
      <PaginationBar
        total={matrix.total}
        page={matrix.page.index + 1}
        pageSize={matrix.page.size}
        onPageChange={(page) => {
          // A page click asks for no size, so the size the read served stands beside the page asked for. The
          // page that follows a size choice states that choice's own size, and only when it names a page the
          // choice did not already state, so the address is never written twice for one gesture.
          const asked = askedWindow.current;
          askedWindow.current = null;
          if (asked !== null && asked.page === page) return;
          onSelectPage(page - 1, asked === null ? matrix.page.size : asked.size);
        }}
        onPageSizeChange={(pageSize) => {
          // The size alone states the whole window: the page that holds the row the reader was reading stays
          // their first row, and the read answers both parameters together, so the count line and the rows
          // state the same window.
          const page = pageHoldingFirstRow(matrix.page.index * matrix.page.size, pageSize, matrix.total);
          askedWindow.current = { page, size: pageSize };
          onSelectPage(page - 1, pageSize);
        }}
        itemNoun={ITEM_NOUN}
        className="min-w-0"
      />
    </div>
  );
}
export default ReportMatrix;
