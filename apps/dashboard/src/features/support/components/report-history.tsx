"use client";
import { useId, useMemo, type ChangeEvent, type ReactElement } from "react";
import ChartFigure, { type ChartKind, type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import StateNotice from "@/components/state-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import type { ReportResult, SeriesPoint } from "@/modules/support/report";
import { CHART_CAPTIONS, EMPTY_STATES, MEASURE_LABELS, REPORT_COPY, fillTemplate } from "../copy";
export type ReportHistoryProps = { readonly result: ReportResult; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly year: number; readonly years: readonly number[]; readonly onSelectYear: (year: number) => void; readonly className?: string };
const SERIES_LABEL: string = MEASURE_LABELS["received-gifts"];
const YEAR_LABEL = "Year";
const PARTITION_HEADING_LEAD = "Amounts in";
const CHART_KIND: ChartKind = "bar";
const CHART_SHAPE_WORD: Readonly<Record<ChartKind, string>> = { bar: "Bar chart", line: "Line chart", area: "Area chart" };
const MONTH_BUCKET_FORMAT: Intl.DateTimeFormatOptions = { month: "short" };
const MONTH_COLUMN_KEY = "month";
const AMOUNT_COLUMN_KEY = "amount";
const TITLE_TEMPLATE = `${REPORT_COPY.history.title} for {year} — {currency}`;
const TAKEAWAY_TEMPLATE = "each month of {year} is drawn from the amount the source recorded in it, and a month it " + "recorded nothing in is left undrawn and named below rather than drawn at zero";
const TABLE_CAPTION_TEMPLATE = `${REPORT_COPY.history.title} for {year}, amounts in {currency}: one row per month of the year, ` + "and a month the source recorded nothing in states that rather than a zero.";
function monthLabel(date: SeriesPoint["bucketStart"], locale: string): string {
  try {
    return date.toLocaleString(locale, MONTH_BUCKET_FORMAT);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return String(date);
  }
}
type StatedAmount = SeriesPoint["value"];
interface CurrencyPartition {
  readonly currency: string;
  readonly points: readonly SeriesPoint[];
}
function currencyPartitions(series: readonly SeriesPoint[]): readonly CurrencyPartition[] {
  const order: string[] = [];
  const byCurrency = new Map<string, SeriesPoint[]>();
  for (const point of series) {
    const existing = byCurrency.get(point.currency);
    if (existing === undefined) {
      byCurrency.set(point.currency, [point]);
      order.push(point.currency);
    } else {
      existing.push(point);
    }
  }
  return order.map((currency) => ({ currency, points: byCurrency.get(currency) ?? [] }));
}
function chartPoints(points: readonly SeriesPoint[], locale: string): readonly ChartPoint[] {
  return points.map((point) => ({ bucket: monthLabel(point.bucketStart, locale), value: point.value.minorUnits, state: point.value.valueState, gap: point.gap }));
}
function chartSeries(partition: CurrencyPartition, locale: string): ChartSeries {
  return { key: `${partition.currency}-received`, label: SERIES_LABEL, currency: partition.currency, points: chartPoints(partition.points, locale) };
}
function amountCell(value: StatedAmount, currency: string, gap: boolean, locale: string): string {
  if (gap && value.minorUnits === null) return "No recorded value";
  const money: Money = { currency, minorUnits: value.minorUnits ?? minorUnitsOf(0) };
  return formatMinor(money, value.valueState, locale).text;
}
function chartTable(partition: CurrencyPartition, year: number, locale: string): ChartTable {
  return {
    caption: fillTemplate(TABLE_CAPTION_TEMPLATE, { year: String(year), currency: partition.currency }),
    columns: [
      { key: MONTH_COLUMN_KEY, label: "Month" },
      { key: AMOUNT_COLUMN_KEY, label: SERIES_LABEL },
    ],
    rows: partition.points.map((point) => ({ [MONTH_COLUMN_KEY]: monthLabel(point.bucketStart, locale), [AMOUNT_COLUMN_KEY]: amountCell(point.value, partition.currency, point.gap, locale) })),
  };
}
type CurrencyHistoryFigureProps = { readonly partition: CurrencyPartition; readonly year: number; readonly coverage: ReportResult["snapshot"]["coverage"]; readonly asOf: string; readonly locale: string };
function CurrencyHistoryFigure({ partition, year, coverage, asOf, locale }: CurrencyHistoryFigureProps): ReactElement {
  const yearText = String(year);
  const currency = partition.currency;
  const series = useMemo<readonly ChartSeries[]>(() => [chartSeries(partition, locale)], [partition, locale]);
  return (
    <ChartFigure
      title={fillTemplate(TITLE_TEMPLATE, { year: yearText, currency })}
      summary={fillTemplate(CHART_CAPTIONS.summaryOpener, { series: SERIES_LABEL, currency, takeaway: fillTemplate(TAKEAWAY_TEMPLATE, { year: yearText }) })}
      caption={fillTemplate("{shape} of {series} in {currency} for each month of {year}.", { shape: CHART_SHAPE_WORD[CHART_KIND], series: SERIES_LABEL, currency, year: yearText })}
      kind={CHART_KIND}
      series={series}
      units={fillTemplate(CHART_CAPTIONS.unit, { currency })}
      coverage={coverage}
      asOf={fillTemplate(CHART_CAPTIONS.asOf, { asOf })}
      table={chartTable(partition, year, locale)}
      locale={locale}
    />
  );
}
/** The year's monthly history, one figure per currency, with the year control the report is asked for. */
export function ReportHistory({ result, locale, dir, year, years, onSelectYear, className }: ReportHistoryProps): ReactElement {
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
          <Label htmlFor={selectId}>{YEAR_LABEL}</Label>
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
          <Card key={partition.currency} size="sm">
            <CardHeader>
              <CardTitle>
                <h2>
                  {`${PARTITION_HEADING_LEAD} `}
                  <bdi>{partition.currency}</bdi>
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              <CurrencyHistoryFigure partition={partition} year={year} coverage={result.snapshot.coverage} asOf={result.snapshot.asOf} locale={locale} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
export default ReportHistory;
