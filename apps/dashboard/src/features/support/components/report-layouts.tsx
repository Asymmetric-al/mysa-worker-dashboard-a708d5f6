"use client";
import Link from "next/link";
import { Fragment, useCallback, useId, useMemo, useRef, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import ChartFigure, { type ChartKind, type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import { factFrame } from "@/components/fact-list";
import { PaginationBar } from "@/components/pagination-bar";
import { ScrollRegion } from "@/components/scroll-region";
import SectionCard from "@/components/section-card";
import StateNotice from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/cn";
import type { GiftAttribution, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import type { CurrencySummary, Matrix, MatrixCell, MatrixRow, ReportComparison as ComparisonResult, ReportQuery, ReportResult, SeriesPoint } from "@/modules/support/report";
import { CHART_CAPTIONS, EMPTY_STATES, IN_PROGRESS_NOTE, MEASURE_LABELS, NO_PERCENTAGE, REPORT_COPY, VALUE_STATE_MEANING, fillTemplate, type NoPercentageReason } from "../copy";
import AmountValue from "./amount-value";
import { countText } from "./count-text";
type PeriodState = ReportResult["snapshot"]["period"];
type StatedAmount = CurrencySummary["received"];
type MonthPoint = ReportResult["series"][number];
type CurrencyChange = ComparisonResult["perCurrency"][number];
type ContributorChange = ComparisonResult["contributorDeltas"][number];
export type ReportReceivedProps = { readonly result: ReportResult; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const NO_COMPARISON_NOTE = "No comparison is stated for this currency, because an amount of a currency with no minor-unit " + "exponent cannot be differenced.";
const DOES_NOT_RECONCILE_NOTE = "The contributor changes do not add up to this difference, and no balancing entry is invented to " + "hide it.";
/** The sentence a bounded contributor list carries: how many changes it states, how many the report counted, and that the rest are not listed while the difference and its reconciliation cover every one. Its counts are written by the family's one whole-number helper, so they read the way every other count on this surface reads. */
function notAllListedNote(listed: number, whole: number, currency: string, locale: string): string {
  const rest = whole - listed;
  return `The report counted ${countText(whole, locale)} contributor changes in ${currency} and this list states ${countText(listed, locale)} of them, the ones with the largest amounts. The other ${countText(rest, locale)} ${rest === 1 ? "is" : "are"} not listed here, while the difference and its reconciliation are computed over all ${countText(whole, locale)} rather than over this list.`;
}
const CHANGE_WORDS: Readonly<Record<CurrencyChange["direction"], string>> = { increase: "Higher than the earlier period", decrease: "Lower than the earlier period", unchanged: "Unchanged from the earlier period" };
const UNATTRIBUTED_WORD = "Unattributed source support";
const civilDateText = (date: PeriodState["from"]): string => String(date);
const periodText = (from: PeriodState["from"], to: PeriodState["to"]): string => `${civilDateText(from)} – ${civilDateText(to)}`;
const monthText = (point: MonthPoint): string => periodText(point.bucketStart, point.bucketEnd);
const contributorValueState = (change: CurrencyChange): ValueState => (change.valueState === "unknown" || change.valueState === "incomplete-subtotal" ? change.valueState : "value");
type StatedFigureProps = { readonly amount: StatedAmount; readonly currency: string; readonly locale: string; readonly emphasis?: "default" | "headline" };
function StatedFigure({ amount, currency, locale, emphasis = "default" }: StatedFigureProps): ReactElement {
  const minorUnits = amount.minorUnits;
  return minorUnits === null ? <StatusBadge label="Amount" valueState={amount.valueState} /> : <AmountValue money={{ currency, minorUnits }} valueState={amount.valueState} locale={locale} emphasis={emphasis} />;
}
const Fact = factFrame({ rowClassName: "flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1", termClassName: "text-sm text-muted-foreground", valueClassName: "flex min-w-0 flex-wrap items-baseline gap-2" });
type ComparisonBlockProps = { readonly comparison: ComparisonResult | undefined; readonly currency: string; readonly locale: string; readonly headingId: string };
function contributorName(delta: ContributorChange): ReactNode {
  const attribution = delta.attribution;
  if (attribution === undefined) return UNATTRIBUTED_WORD;
  if (attribution.kind === "partner") {
    return (
      <>
        {"Partner "}
        <bdi className="mono-identifier break-all">{attribution.partnerId}</bdi>
      </>
    );
  }
  return attribution.kind === "anonymous" ? "Anonymous support" : UNATTRIBUTED_WORD;
}
const contributorKey = (delta: ContributorChange): string => `${delta.currency}:${delta.attribution === undefined ? "unstated" : delta.attribution.kind === "partner" ? `${delta.attribution.kind}:${delta.attribution.partnerId}` : delta.attribution.kind}`;
function noPercentageSentence(change: CurrencyChange): string | undefined {
  return change.valueState === "unknown" ? NO_PERCENTAGE["unknown-denominator"] : change.baselineMinor === 0 ? NO_PERCENTAGE.default : undefined;
}
function ComparisonBlock({ comparison, currency, locale, headingId }: ComparisonBlockProps): ReactElement {
  const heading = (
    <h3 id={headingId} className="type-subsection-title">
      {"Compared with the preceding equal-elapsed period"}
    </h3>
  );
  const change = comparison === undefined ? undefined : comparison.perCurrency.find((entry) => entry.currency === currency);
  if (comparison === undefined || !comparison.equalElapsed || change === undefined) {
    const reason = comparison === undefined || change === undefined ? NO_COMPARISON_NOTE : "The two spans this result compared are not the same length, so no difference is drawn from them.";
    return (
      <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
        {heading}
        <p className="type-supporting">{reason}</p>
      </section>
    );
  }
  const contributors = comparison.contributorDeltas.filter((delta) => delta.currency === currency);
  const countedContributors = comparison.contributorDeltaCounts[currency] ?? contributors.length; // The whole count the report made before it bounded the list, so the surface states what it is not listing rather than letting the list read as every change.
  const contributorState = contributorValueState(change);
  const percentage = noPercentageSentence(change);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      {heading}
      <dl className="grid gap-2">
        <Fact term="Earlier equal-elapsed period">
          <bdi className="text-sm text-muted-foreground">{periodText(comparison.baseline.from, comparison.baseline.to)}</bdi>
          <AmountValue money={{ currency, minorUnits: change.baselineMinor }} valueState={change.valueState} locale={locale} />
        </Fact>
        <Fact term="Difference (this period minus the earlier one)">
          <AmountValue money={{ currency, minorUnits: change.differenceMinor }} valueState={change.valueState} locale={locale} emphasis="headline" />
          <StatusBadge label={CHANGE_WORDS[change.direction]} />
        </Fact>
      </dl>
      {percentage === undefined ? null : <p className="type-supporting">{percentage}</p>}
      {contributors.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="type-group-title">Contributors that changed</p>
          <ul className="flex min-w-0 flex-col gap-2">
            {contributors.map((delta) => (
              <li key={contributorKey(delta)} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words">{contributorName(delta)}</span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <AmountValue money={{ currency, minorUnits: delta.minorUnits }} valueState={contributorState} locale={locale} />
                  <span className="text-sm text-muted-foreground">{delta.minorUnits > 0 ? "gave more in this period than in the earlier one." : "gave less in this period, or gave only in the earlier one — neither is a judgement about them."}</span>
                </span>
              </li>
            ))}
          </ul>
          {countedContributors > contributors.length ? <p className="type-supporting">{notAllListedNote(contributors.length, countedContributors, currency, locale)}</p> : null}
          <p className="type-supporting">{comparison.reconciles ? "The contributor changes add up exactly to this difference." : DOES_NOT_RECONCILE_NOTE}</p>
        </div>
      )}
    </section>
  );
}
type MonthlyTableProps = { readonly months: readonly MonthPoint[]; readonly currency: string; readonly locale: string; readonly headingId: string };
function MonthlyTable({ months, currency, locale, headingId }: MonthlyTableProps): ReactElement {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className="type-subsection-title">
        Each month of the period
      </h3>
      <ScrollRegion label={`${REPORT_COPY.received.title} in ${currency}, months of the period, scrollable`}>
        <Table>
          <TableCaption className="text-start">
            {`${REPORT_COPY.received.title} — `}
            <bdi>{currency}</bdi>
            {` — one row per month of the period, in the order the months occur, at the authorised-allocation grain; a month the source does not cover is a gap rather than a zero.`}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Month</TableHead>
              <TableHead scope="col" className="text-end">
                Received support
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="whitespace-normal text-muted-foreground">
                  {"No month of this period is stated in this currency — each one is a gap, not a zero"}
                </TableCell>
              </TableRow>
            ) : (
              months.map((point) => (
                <TableRow key={civilDateText(point.bucketStart)}>
                  <TableCell className="whitespace-normal">
                    <bdi>{monthText(point)}</bdi>{" "}
                  </TableCell>
                  <TableCell className="text-end">{point.gap ? <span className="text-muted-foreground">{"No gift recorded — a gap, not a zero"}</span> : <StatedFigure amount={point.value} currency={currency} locale={locale} />}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollRegion>
    </section>
  );
}
type ReceivedPartitionProps = { readonly summary: CurrencySummary; readonly months: readonly MonthPoint[]; readonly comparison: ComparisonResult | undefined; readonly period: PeriodState; readonly locale: string };
function ReceivedPartition({ summary, months, comparison, period, locale }: ReceivedPartitionProps): ReactElement {
  const currency = summary.currency;
  const headingId = `report-received-${currency}`;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 id={headingId} className="type-section-title">
          {`${REPORT_COPY.received.title} — `}
          <bdi>{currency}</bdi>
        </h2>
        {summary.exponent === undefined ? <StatusBadge label="Currency not identified" tone="caution" /> : null}
      </div>
      <Card>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="grid gap-2">
            <Fact term="Received in the period">
              <StatedFigure amount={summary.received} currency={currency} locale={locale} emphasis="headline" />{" "}
            </Fact>
            <Fact term="Period">
              <bdi>{periodText(period.from, period.to)}</bdi>{" "}
            </Fact>
          </dl>
          <Separator />
          <ComparisonBlock comparison={comparison} currency={currency} locale={locale} headingId={`${headingId}-comparison`} />
        </CardContent>
      </Card>
      <MonthlyTable months={months} currency={currency} locale={locale} headingId={`${headingId}-months`} />
    </section>
  );
}
/** Received support for the period, month by month, with the equal-elapsed-period comparison. */ export function ReportReceived({ result, locale, dir, className }: ReportReceivedProps): ReactElement {
  const { summary, series, comparison, snapshot } = result;
  const currencies = summary.map((entry) => entry.currency);
  return (
    <div dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {snapshot.period.state === "in-progress" ? (
        <p className="type-supporting flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge label="In progress" tone="info" srPrefix="Period" />
          <span>{IN_PROGRESS_NOTE}</span>
        </p>
      ) : null}
      {currencies.length > 1 ? <p className="type-supporting">{fillTemplate(CHART_CAPTIONS.unit, { currency: currencies.join(", ") })}</p> : null}
      {summary.length === 0 ? (
        <StateNotice kind="empty" title={EMPTY_STATES.gifts.title} description={EMPTY_STATES.gifts.body} action={EMPTY_STATES.gifts.action} headingLevel={2} />
      ) : (
        summary.map((entry) => <ReceivedPartition key={entry.currency} summary={entry} months={series.filter((point) => point.currency === entry.currency)} comparison={comparison} period={snapshot.period} locale={locale} />)
      )}
    </div>
  );
}
export type ReportHistoryProps = { readonly result: ReportResult; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly year: number; readonly years: readonly number[]; readonly onSelectYear: (year: number) => void; readonly className?: string };
type HistoryAmount = SeriesPoint["value"];
type HistoryPartition = { readonly currency: string; readonly points: readonly SeriesPoint[] };
const SERIES_LABEL: string = MEASURE_LABELS["received-gifts"];
const CHART_KIND: ChartKind = "bar";
const CHART_SHAPE_WORD: Readonly<Record<ChartKind, string>> = { bar: "Bar chart", line: "Line chart", area: "Area chart" };
const MONTH_BUCKET_FORMAT: Intl.DateTimeFormatOptions = { month: "short" };
const MONTH_COLUMN_KEY = "month";
const AMOUNT_COLUMN_KEY = "amount";
const TITLE_TEMPLATE = `${REPORT_COPY.history.title} for {year} — {currency}`;
const TAKEAWAY_TEMPLATE = "each month of {year} is drawn from the amount the source recorded in it, and a month it " + "recorded nothing in is left undrawn and named below rather than drawn at zero";
const TABLE_CAPTION_TEMPLATE = `${REPORT_COPY.history.title} for {year}, amounts in {currency}: one row per month of the year, ` + "and a month the source recorded nothing in states that rather than a zero.";
const civilLabel = (date: SeriesPoint["bucketStart"], locale: string, format: Intl.DateTimeFormatOptions): string => {
  try {
    return date.toLocaleString(locale, format);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return String(date);
  }
};
const monthLabel = (date: SeriesPoint["bucketStart"], locale: string): string => civilLabel(date, locale, MONTH_BUCKET_FORMAT);
function currencyPartitions(series: readonly SeriesPoint[]): readonly HistoryPartition[] {
  const byCurrency = new Map<string, SeriesPoint[]>();
  for (const point of series) byCurrency.set(point.currency, [...(byCurrency.get(point.currency) ?? []), point]);
  return [...byCurrency].map(([currency, points]) => ({ currency, points }));
}
const chartPoints = (points: readonly SeriesPoint[], locale: string): readonly ChartPoint[] => points.map((point) => ({ bucket: monthLabel(point.bucketStart, locale), value: point.value.minorUnits, state: point.value.valueState, gap: point.gap }));
const chartSeries = (partition: HistoryPartition, locale: string): ChartSeries => ({ key: `${partition.currency}-received`, label: SERIES_LABEL, currency: partition.currency, points: chartPoints(partition.points, locale) });
function amountCell(value: HistoryAmount, currency: string, gap: boolean, locale: string): string {
  if (gap && value.minorUnits === null) return "No recorded value";
  const money: Money = { currency, minorUnits: value.minorUnits ?? minorUnitsOf(0) };
  return formatMinor(money, value.valueState, locale).text;
}
function chartTable(partition: HistoryPartition, year: number, locale: string): ChartTable {
  const slots = { year: String(year), currency: partition.currency };
  return {
    caption: fillTemplate(TABLE_CAPTION_TEMPLATE, slots),
    columns: [
      { key: MONTH_COLUMN_KEY, label: "Month" },
      { key: AMOUNT_COLUMN_KEY, label: SERIES_LABEL },
    ],
    rows: partition.points.map((point) => ({ [MONTH_COLUMN_KEY]: monthLabel(point.bucketStart, locale), [AMOUNT_COLUMN_KEY]: amountCell(point.value, partition.currency, point.gap, locale) })),
  };
}
type CurrencyHistoryFigureProps = { readonly partition: HistoryPartition; readonly year: number; readonly coverage: ReportResult["snapshot"]["coverage"]; readonly asOf: string; readonly locale: string };
function CurrencyHistoryFigure({ partition, year, coverage, asOf, locale }: CurrencyHistoryFigureProps): ReactElement {
  const yearText = String(year);
  const currency = partition.currency;
  const series = useMemo<readonly ChartSeries[]>(() => [chartSeries(partition, locale)], [partition, locale]);
  const title = fillTemplate(TITLE_TEMPLATE, { year: yearText, currency });
  const summary = fillTemplate(CHART_CAPTIONS.summaryOpener, { series: SERIES_LABEL, currency, takeaway: fillTemplate(TAKEAWAY_TEMPLATE, { year: yearText }) });
  const caption = fillTemplate("{shape} of {series} in {currency} for each month of {year}.", { shape: CHART_SHAPE_WORD[CHART_KIND], series: SERIES_LABEL, currency, year: yearText });
  return <ChartFigure title={title} summary={summary} caption={caption} kind={CHART_KIND} series={series} units={fillTemplate(CHART_CAPTIONS.unit, { currency })} coverage={coverage} asOf={fillTemplate(CHART_CAPTIONS.asOf, { asOf })} table={chartTable(partition, year, locale)} locale={locale} />;
}
/** Renders fixed report 2: the year's monthly history one figure per currency, with the year the report is asked for. */ export function ReportHistory({ result, locale, dir, year, years, onSelectYear, className }: ReportHistoryProps): ReactElement {
  const selectId = useId();
  const partitions = useMemo(() => currencyPartitions(result.series), [result]);
  const handleYearChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const chosen = years.find((candidate) => String(candidate) === event.currentTarget.value);
    if (chosen !== undefined) onSelectYear(chosen);
  };
  return (
    <div dir={dir} className={cn("flex w-full min-w-0 flex-col gap-6", className)}>
      {years.length === 0 ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Label htmlFor={selectId}>Year</Label>
          <NativeSelect id={selectId} value={String(year)} onChange={handleYearChange}>
            {years.map((option) => (
              <NativeSelectOption key={option} value={String(option)}>
                {String(option)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      {partitions.length === 0 ? (
        <StateNotice kind="empty" headingLevel={2} title={EMPTY_STATES.gifts.title} description={EMPTY_STATES.gifts.body} action={EMPTY_STATES.gifts.action} />
      ) : (
        partitions.map((partition) => (
          <SectionCard
            key={partition.currency}
            title={
              <>
                <span>{"Amounts in "}</span>
                <bdi>{partition.currency}</bdi>
              </>
            }
            contentClassName="flex min-w-0 flex-col gap-4"
          >
            <CurrencyHistoryFigure partition={partition} year={year} coverage={result.snapshot.coverage} asOf={result.snapshot.asOf} locale={locale} />{" "}
          </SectionCard>
        ))
      )}
    </div>
  );
}
/** The address one matrix cell opens, bound to the query the matrix was computed from. */ type CellHref = (attribution: GiftAttribution, cell: MatrixCell) => string;
export type ReportMatrixProps = { readonly result: ReportResult; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly drilldownHref: (query: ReportQuery, attribution: GiftAttribution, cell: MatrixCell) => string; readonly onSelectPage: (page: number, pageSize: number) => void; readonly className?: string };
type MonthColumn = { readonly key: string; readonly longLabel: string; readonly shortLabel: string };
type PartitionRow = { readonly key: string; readonly attribution: GiftAttribution; readonly label: string; readonly opaqueReference: boolean; readonly cellsByMonth: ReadonlyMap<string, MatrixCell> };
/** One currency's presentation of the served page of rows. */ type MatrixPartition = { readonly currency: string; readonly rows: readonly PartitionRow[] }; /** The window a rows-per-page choice asks for: the page counted from one as the pager counts it, beside the size asked for. */
type PageAsk = { readonly page: number; readonly size: number };
type StatedCell = { readonly row: PartitionRow; readonly cell: MatrixCell };
type AmountlessMarker = { readonly word: string; readonly explanation: string };
const MONTH_HEADING_FORMAT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };
const MONTH_COLUMN_FORMAT: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
const NUMERIC_CELL_CLASS = "text-end";
const QUIET_TEXT_CLASS = "type-supporting";
const GAP_SENTENCE = "A month the source recorded no gift in is a gap, not a zero.";
const CAPTION_GRAIN = "one row is one partner or support attribution, one column is one month, and every cell states " + "the authorised allocations the source recorded in it";
const PERIOD_WITHOUT_AMOUNT_NOTE = "No amount is stated for this month: either the source recorded no gift, or it did not establish " + "the value. Neither is a zero.";
const ABSENT_MATRIX_DESCRIPTION = "The partners-by-month matrix is computed for that one report, so a result from another report has " + "no cells to show here. Nothing is substituted for it, because a table that looked like this one " + "while describing different records would be worse than no table at all.";
/** What the pager counts: the partner and attribution rows the matrix is made of, never the money in them. */ const ITEM_NOUN = "rows";
/** The derived values above an absent matrix are empty rather than absent, so no hook is called after that return. */ const NO_MONTHS: readonly MonthColumn[] = [];
const NO_PARTITIONS: readonly MatrixPartition[] = [];
function markerFor(valueState: ValueState): AmountlessMarker {
  return valueState === "withheld" ? { word: "Withheld", explanation: VALUE_STATE_MEANING.withheld } : valueState === "unavailable" ? { word: "Unavailable", explanation: VALUE_STATE_MEANING.unavailable } : { word: "Unknown", explanation: VALUE_STATE_MEANING.unknown };
}
const monthsOf = (matrix: Matrix, locale: string): readonly MonthColumn[] => matrix.months.map((month) => ({ key: String(month.start), longLabel: civilLabel(month.start, locale, MONTH_HEADING_FORMAT), shortLabel: civilLabel(month.start, locale, MONTH_COLUMN_FORMAT) }));
function rowsOf(matrix: Matrix, currency: string): readonly PartitionRow[] {
  return matrix.rows.map((row) => {
    const cellsByMonth = new Map(row.cells.filter((cell) => cell.currency === currency).map((cell): [string, MatrixCell] => [String(cell.bucketStart), cell]));
    return { key: rowKeyOf(row), attribution: row.attribution, label: row.label, opaqueReference: row.partnerId !== undefined, cellsByMonth };
  });
}
const rowKeyOf = (row: MatrixRow): string => (row.partnerId === undefined ? row.attribution.kind : `partner:${row.partnerId}`); /** The page that keeps the reader on their first row once the window holds a new size, clamped to the pages the whole result has at that size. */
function pageHoldingFirstRow(firstRowIndex: number, pageSize: number, total: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
  return Math.min(Math.trunc(Math.max(0, firstRowIndex) / pageSize) + 1, pages);
}
const statesAmount = (cell: MatrixCell): boolean => !cell.gap && cell.value.minorUnits !== null;
function statedCells(rows: readonly PartitionRow[], month: MonthColumn): readonly StatedCell[] {
  const stated: StatedCell[] = [];
  for (const row of rows) {
    const cell = row.cellsByMonth.get(month.key);
    if (cell !== undefined && statesAmount(cell)) stated.push({ row, cell });
  }
  return stated;
}
type MatrixCompositionProps = { readonly currency: string; readonly months: readonly MonthColumn[]; readonly rows: readonly PartitionRow[]; readonly locale: string; readonly drilldownHref: CellHref };
function AmountlessValue({ marker }: { readonly marker: AmountlessMarker }): ReactElement {
  return (
    <span className={QUIET_TEXT_CLASS}>
      {marker.word}
      <span className="sr-only">{`. ${marker.explanation}`}</span>
    </span>
  );
}
function MatrixCellContent({ cell, attribution, scopeName, locale, drilldownHref }: { readonly cell: MatrixCell | undefined; readonly attribution: GiftAttribution; readonly scopeName: string; readonly locale: string; readonly drilldownHref: CellHref }): ReactElement {
  if (cell === undefined || cell.gap) return <span className={QUIET_TEXT_CLASS}>No gift</span>;
  const { minorUnits, valueState } = cell.value;
  if (minorUnits === null) return <AmountlessValue marker={markerFor(valueState)} />;
  return (
    <Link href={drilldownHref(attribution, cell)} className="inline-link inline-flex min-h-6 min-w-6 items-center justify-end rounded-sm">
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
            <h3 className="type-subsection-title">{month.longLabel}</h3>
            {stated.length === 0 ? (
              <p className={QUIET_TEXT_CLASS}>{PERIOD_WITHOUT_AMOUNT_NOTE}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {stated.map(({ row, cell }) => (
                  <li key={row.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <bdi className={cn("min-w-0 break-words", row.opaqueReference ? "mono-identifier" : undefined)}>{row.label}</bdi>
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
/** Renders fixed report 3: one partner-by-month matrix per currency over the page of rows the read served, each with a cell-level drilldown. */ export function ReportMatrix({ result, locale, dir, drilldownHref, onSelectPage, className }: ReportMatrixProps): ReactElement {
  const matrix = result.matrix;
  const hrefOf = useCallback<CellHref>((attribution, cell) => drilldownHref(result.snapshot.query, attribution, cell), [drilldownHref, result.snapshot.query]); // The cell's narrowing is derived from the query this matrix was computed from, so a cell states its figure and nothing else.
  const months = useMemo<readonly MonthColumn[]>(() => (matrix === undefined ? NO_MONTHS : monthsOf(matrix, locale)), [matrix, locale]); // The month headings and the per-currency rows are derived once per matrix, because neither belongs to a page or size change.
  const partitions = useMemo<readonly MatrixPartition[]>(() => (matrix === undefined ? NO_PARTITIONS : matrix.currencies.map((currency) => ({ currency, rows: rowsOf(matrix, currency) }))), [matrix]);
  const narrow = useIsMobile(); // One presentation is mounted per viewport, never two: a presentation hidden by a media query still costs every row and cell it renders.
  const askedWindow = useRef<PageAsk | null>(null); // A size choice states its whole window once, and the page report that follows it is recognised as that same window rather than written again.
  if (matrix === undefined || matrix.rows.length === 0 || matrix.currencies.length === 0) {
    const stated = matrix === undefined ? { title: "This result carries no partner-by-month matrix", description: ABSENT_MATRIX_DESCRIPTION, action: EMPTY_STATES.reports.action } : { title: EMPTY_STATES.gifts.title, description: EMPTY_STATES.gifts.body, action: EMPTY_STATES.gifts.action };
    return (
      <div data-slot="report-matrix" dir={dir} className={cn("min-w-0", className)}>
        <StateNotice kind="empty" headingLevel={2} title={stated.title} description={stated.description} action={{ label: stated.action.label, href: stated.action.href }} />
      </div>
    );
  }
  return (
    <div data-slot="report-matrix" dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {partitions.map(({ currency, rows }) => {
        const headingId = `report-matrix-${currency}`; // The heading names the one currency this partition states, so the partition is a region a reader can find by name rather than an untitled run of cells.
        return (
          <section key={currency} data-slot="report-matrix-partition" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
            <h2 id={headingId} className="type-section-title">
              <span>{"Amounts in "}</span>
              <bdi>{currency}</bdi>
            </h2>
            {narrow ? <PeriodFirstMatrix currency={currency} months={months} rows={rows} locale={locale} drilldownHref={hrefOf} /> : <WideMatrix currency={currency} months={months} rows={rows} locale={locale} drilldownHref={hrefOf} />}
          </section>
        );
      })}
      {/* The pager states the whole result's row count beside the window the read served, so the caption reads "Showing 1-50 of 9,000 rows" rather than the page alone; a change states the address's window and the read answers it. */}
      <PaginationBar
        total={matrix.total}
        page={matrix.page.index + 1}
        pageSize={matrix.page.size}
        onPageChange={(page) => {
          const asked = askedWindow.current;
          askedWindow.current = null;
          if (asked !== null && asked.page === page) return;
          onSelectPage(page - 1, asked === null ? matrix.page.size : asked.size);
        }}
        onPageSizeChange={(pageSize) => {
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
export type ReportComparisonProps = { result: ReportResult; locale: string; dir?: "ltr" | "rtl"; className?: string };
type CurrencyFigure = ComparisonResult["perCurrency"][number];
type ComparisonContributorChange = ComparisonResult["contributorDeltas"][number];
type AttributionKind = NonNullable<ComparisonContributorChange["attribution"]>["kind"];
const ATTRIBUTION_LABELS: Readonly<Record<AttributionKind, string>> = { partner: "A partner the report names only by reference", anonymous: "Anonymous support", unresolved: "Support with no attribution stated" };
const NOT_LIKE_FOR_LIKE = { badge: "Not like-for-like", text: "The two periods are not the same number of days, so this difference sets a longer span against " + "a shorter one. The report states that rather than presenting the figures as an equal-elapsed " + "comparison." } as const;
const NOT_RECONCILED = {
  badge: "Contributors do not add up",
  text: "The contributor changes below and the difference do not agree exactly for at least one currency " + "in this comparison. The report says so instead of adding a balancing entry, so no figure on " + "this surface has been adjusted to make the list add up.",
} as const;
const NO_CONTRIBUTOR_CHANGE = "The report states no contributor change in this currency: a contributor whose amount is the same " + "in both periods is left out of this list rather than shown as a zero.";
const CHANGE_MEANING_NOTE =
  "A change here is a fact about the records of two periods, not about anyone's intention. A " + "contributor who gave in the earlier period and not in this one is an earlier-only contributor, " + "not a lost partner: this report names nobody as lost, ranks nobody and infers no motive from a " + "figure.";
function noPercentageReason(entry: CurrencyFigure): NoPercentageReason | "default" | null {
  return entry.valueState === "unknown" || entry.valueState === "unavailable" ? "unknown-denominator" : entry.valueState === "withheld" || entry.baselineMinor === 0 ? "default" : null;
}
function ContributorLabel({ change }: { readonly change: ComparisonContributorChange }): ReactElement {
  const partnerId = change.partnerId;
  if (partnerId !== undefined) {
    return (
      <>
        <span className="text-muted-foreground">{"Partner"} </span>
        <bdi className="mono-identifier">{partnerId}</bdi>
      </>
    );
  }
  return <>{ATTRIBUTION_LABELS[change.attribution?.kind ?? "unresolved"]}</>;
}
const comparisonCivilDateText = (date: ComparisonResult["current"]["from"]): string => date.toString();
type ComparisonPartitionProps = {
  readonly entry: CurrencyFigure;
  readonly current: ComparisonResult["current"];
  readonly baseline: ComparisonResult["baseline"];
  readonly deltas: readonly ComparisonContributorChange[];
  readonly counts: Readonly<Record<string, number>>;
  readonly reconciles: boolean;
  readonly locale: string;
};
function ComparisonPartition({ entry, current, baseline, deltas, counts, reconciles, locale }: ComparisonPartitionProps): ReactElement {
  const headingId = `report-comparison-${entry.currency}`;
  const percentageReason = noPercentageReason(entry);
  const contributors = deltas.filter((change) => change.currency === entry.currency);
  const countedContributors = counts[entry.currency] ?? contributors.length; // The whole count the report made before it bounded the list, so the table states what it is not showing rather than letting the rows read as every change.
  return (
    <SectionCard
      headingId={headingId}
      region={{ id: headingId, className: "min-w-0" }}
      title={
        <>
          <span>{"Amounts in "}</span>
          <bdi>{entry.currency}</bdi>
        </>
      }
      contentClassName="flex min-w-0 flex-col gap-4"
    >
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-start text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        {[
          { label: "This period", from: current.from, to: current.to, minorUnits: entry.currentMinor },
          { label: "Earlier period", from: baseline.from, to: baseline.to, minorUnits: entry.baselineMinor },
        ].map((row) => (
          <Fragment key={row.label}>
            <dt className="font-medium">{row.label}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <bdi className="text-muted-foreground">{`${comparisonCivilDateText(row.from)} – ${comparisonCivilDateText(row.to)}`}</bdi>
              <AmountValue money={{ currency: entry.currency, minorUnits: row.minorUnits }} valueState={entry.valueState} locale={locale} />
            </dd>
          </Fragment>
        ))}
        <dt className="font-medium">Difference (this period minus the earlier one)</dt>
        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <AmountValue money={{ currency: entry.currency, minorUnits: entry.differenceMinor }} valueState={entry.valueState} locale={locale} emphasis="headline" />
        </dd>
      </dl>
      {percentageReason === null ? null : <p className="min-w-0 break-words text-xs text-muted-foreground">{NO_PERCENTAGE[percentageReason]}</p>}
      {contributors.length === 0 ? (
        <p className="type-supporting min-w-0 break-words">{NO_CONTRIBUTOR_CHANGE}</p>
      ) : (
        <ScrollRegion label={`${REPORT_COPY.comparison.title} in ${entry.currency}, contributor changes, scrollable`}>
          <Table>
            <TableCaption>
              {REPORT_COPY.comparison.title}
              {" — contributor changes in "}
              <bdi>{entry.currency}</bdi>
              {", one row per attribution this table states."}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Contributor</TableHead>
                <TableHead scope="col" className="text-end">
                  Change
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contributors.map((change) => (
                <TableRow key={`${change.currency}:${change.partnerId ?? change.attribution?.kind ?? "unresolved"}`}>
                  <TableHead scope="row" className="whitespace-normal break-words">
                    <ContributorLabel change={change} />
                  </TableHead>
                  <TableCell className="text-end">
                    <AmountValue money={{ currency: change.currency, minorUnits: change.minorUnits }} valueState={entry.valueState} locale={locale} />{" "}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      )}
      {countedContributors > contributors.length ? <p className="min-w-0 break-words text-sm text-muted-foreground">{notAllListedNote(contributors.length, countedContributors, entry.currency, locale)}</p> : null}
      {reconciles ? <p className="min-w-0 break-words text-sm text-muted-foreground">{"The contributor changes add up exactly to this difference."}</p> : null}
    </SectionCard>
  );
}
/** Fixed report 4: the two periods of one query, per currency, as the signed difference the report computed plus the contributor changes that reconcile it; never a figure of its own. */ export function ReportComparison({ result, locale, dir, className }: ReportComparisonProps): ReactElement {
  const comparison = result.comparison;
  const rootClassName = cn("flex min-w-0 flex-col gap-6", className);
  if (comparison === undefined || comparison.perCurrency.length === 0) {
    const empty = EMPTY_STATES.reports;
    return (
      <div dir={dir} data-report="period-comparison" className={rootClassName}>
        <StateNotice kind="empty" headingLevel={2} title={empty.title} description={empty.body} action={{ label: empty.action.label, href: empty.action.href }} />
      </div>
    );
  }
  const notice = (badge: string, text: string): ReactElement => (
    <p className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
      <Badge variant="outline">{badge}</Badge>
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
  return (
    <div dir={dir} data-report="period-comparison" className={rootClassName}>
      {comparison.equalElapsed ? null : notice(NOT_LIKE_FOR_LIKE.badge, NOT_LIKE_FOR_LIKE.text)}
      {comparison.reconciles ? null : notice(NOT_RECONCILED.badge, NOT_RECONCILED.text)}
      {comparison.perCurrency.map((entry) => (
        <ComparisonPartition key={entry.currency} entry={entry} current={comparison.current} baseline={comparison.baseline} deltas={comparison.contributorDeltas} counts={comparison.contributorDeltaCounts} reconciles={comparison.reconciles} locale={locale} />
      ))}
      <p className="min-w-0 break-words text-xs text-muted-foreground">{CHANGE_MEANING_NOTE}</p>
    </div>
  );
}
