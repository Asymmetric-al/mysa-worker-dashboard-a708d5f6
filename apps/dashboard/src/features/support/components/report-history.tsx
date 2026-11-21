"use client";

/**
 * Fixed report 2: one chosen year's monthly history of received support, drawn through the
 * application's single chart pattern and left countable through that figure's own data table.
 *
 * What this layout is. It renders one `ReportResult` — the single computation the report engine
 * performs for one query and one snapshot — as the monthly history of a year: one figure per currency
 * partition, one bar per month the source holds a figure for, and one row per month of the year in the
 * table the figure carries as its alternative. The chart is `@/components/chart-figure` and nothing
 * else, so this surface owns no chart library, no second data table and no second summary: the figure
 * supplies the caption, the prose summary, the table alternative, the units, the coverage and the
 * as-of statement, and this file supplies the figures and the year control.
 *
 * What it refuses, deliberately.
 *
 * - No call into the report engine and no runtime import from `@/modules/support/report`: the result
 *   arrives as a prop and that module is imported for its types only, so every figure on this surface
 *   is one the engine computed and this file cannot become a second computation.
 * - No arithmetic of any kind. Nothing is summed, differenced, averaged, bucketed by month, ranked or
 *   turned into a total, and no year is derived from a clock: the months are the result's own series
 *   points, and the years are the caller's admitted choices.
 * - No forecast, no trend line, no year-over-year comparison, no second series. A year set against
 *   another year is the comparison report, and a prediction drawn over recorded support would state a
 *   figure the source never gave.
 * - No export, print or filter control. The frame around this report owns the query, the export and
 *   the print action; this layout owns the figures.
 *
 * The one fact this report exists to state honestly. A month the source recorded nothing in is a
 * **gap**: no bar, no point, no interpolated neighbour and no zero. The figure names every such month
 * in its prose summary, the table row states "no recorded value" rather than `0`, and a recorded zero
 * still plots at zero and reads as a zero — so a dip to nothing and an absence of data never look
 * alike (criterion 6). The value states stay distinct in the plot, in the tooltip and in the table
 * because every point carries the state the read recorded, and nothing here chooses, converts or
 * recovers one.
 *
 * Currencies are partitioned and never combined. One figure per currency, each naming its own ISO
 * code, because this application holds no exchange rate: a shared axis would state that a dollar and a
 * euro can be compared on one scale. A currency the application holds no exponent for has no series at
 * all — a series is a sequence of totals, and that total cannot be stated — so such a gift appears in
 * the summary rather than here, and no figure on this surface is a combined support total.
 *
 * The empty year. A year that carries no series at all renders the family's own empty wording with the
 * chart absent, rather than an all-zero chart or a flat line across twelve months that would read as
 * twelve months of no giving.
 *
 * Accessibility. The figure has a caption naming its subject, unit, coverage and as-of time, a prose
 * summary naming every undrawn month, and a real table element as its alternative, reached by
 * `aria-describedby`; the year control is a visible label beside a native select, so it is keyboard
 * operable, 36 CSS pixels tall and typeahead-capable without a custom listbox. The figure's name
 * carries its currency, which is what keeps one partition's table region distinguishable from the
 * next when both are announced as landmarks. Headings nest under the report frame's own — one `<h2>`
 * per currency partition, and the empty notice at that same level — every amount and ISO code is
 * isolated with `<bdi>` where it sits among other content, month labels stay short enough for a
 * twelve-tick axis, and at 320 CSS px the figure stacks and only the table's own labelled region
 * scrolls — the page itself never scrolls sideways (WCAG 2.2 AA, including 1.4.10 Reflow).
 *
 * Scope: the second of the support family's four fixed reports — one chosen year's monthly history —
 * on the one report result that stands behind every financial surface, keeping the agreement the
 * chart, table, drilldown, CSV and print view owe each other. The general rule keeps this layout to
 * that one report, is why the chart pattern and the family's wording are imported rather than
 * reimplemented, and is why a gap, a zero, an unknown value, a withheld value, an unavailable source
 * and an incomplete subtotal remain distinct renderings here.
 */

import { useId, type ChangeEvent, type ReactElement } from "react";

import ChartFigure, {
  type ChartKind,
  type ChartPoint,
  type ChartSeries,
  type ChartTable,
} from "@/components/chart-figure";
import StateNotice from "@/components/state-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
/*
  The figure's data-table alternative states every month's amount, and it must state the same words
  the screen, the CSV and the print model state for that query. So the cells are formatted by the
  application's one money formatter rather than by anything this file does: handing the table raw
  minor units, or formatting them here, would make this file a second money formatter that prints
  integers where the export prints amounts — and the chart, its table and the export of one query
  would then disagree in exactly the way this report exists to prevent.
*/
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import type { ReportResult, SeriesPoint } from "@/modules/support/report";

import { CHART_CAPTIONS, EMPTY_STATES, MEASURE_LABELS, REPORT_COPY } from "../copy";

// ---------------------------------------------------------------------------------------------
// What the caller passes
// ---------------------------------------------------------------------------------------------

/** Props of {@link ReportHistory}. */
export type ReportHistoryProps = {
  /**
   * The one snapshot the frame produced for the chosen year. Every figure, month, currency and
   * coverage statement on this surface is read from it; nothing is re-read, re-filtered or
   * re-aggregated here.
   */
  readonly result: ReportResult;
  /** The viewer's display locale, supplied by the route composition; never read from the host. */
  readonly locale: string;
  /** The direction belongs to the block, so a right-to-left locale flows through the whole report. */
  readonly dir?: "ltr" | "rtl";
  /**
   * The chosen year, supplied by the caller. This file never derives one from a clock, a date or the
   * series' own buckets, so the label the reader sees and the query the frame ran cannot drift apart.
   */
  readonly year: number;
  /**
   * The admitted year choices, supplied by the caller. The control renders exactly these and never a
   * year computed here, so it can offer no period the application cannot report.
   */
  readonly years: readonly number[];
  /**
   * Called with the year the reader chose, and with only that: the frame re-runs the same report
   * query for the new year, so the choice changes the query rather than a figure held in this file.
   */
  readonly onSelectYear: (year: number) => void;
  /** Layout classes for the report's place in the frame. Never a colour, radius or shadow. */
  readonly className?: string;
};

// ---------------------------------------------------------------------------------------------
// Wording, read from the family's single source
// ---------------------------------------------------------------------------------------------

/**
 * The measure this report states, taken from the family's one measure vocabulary.
 *
 * Not retyped here: a component that spelled "Received gifts" itself would be the second place the
 * name of a measure could change, and the chart's legend, the table's column header and the prose
 * summary all read this one string.
 */
const SERIES_LABEL: string = MEASURE_LABELS["received-gifts"];

/** The year control's visible label. Short, because it is the report's only input. */
const YEAR_LABEL = "Year";

/** The lead of the heading that names one currency partition. */
const PARTITION_HEADING_LEAD = "Amounts in";

/**
 * The shape this report draws: a bar per month.
 *
 * A month is a discrete period with its own figure, so a bar states each month as itself; a line
 * would invite a reading of slope between months that the data does not support. An undrawn month
 * leaves a space in the bar row rather than a zero-height bar, which is the gap the table then states
 * in words.
 */
const CHART_KIND: ChartKind = "bar";

/**
 * The shape in words, exhaustive over the closed set of kinds, so the figure's short text alternative
 * names the picture the reader is actually given rather than a shape chosen elsewhere.
 */
const CHART_SHAPE_WORD: Readonly<Record<ChartKind, string>> = {
  bar: "Bar chart",
  line: "Line chart",
  area: "Area chart",
};

/**
 * How a month bucket is written: the month, shortened to fit a twelve-tick axis.
 *
 * The year is deliberately not repeated in every label. This report is one chosen year, and that year
 * is stated three times already — in the figure's own name, in its caption and in the data table's
 * caption — so carrying it into all twelve tick labels would spend the axis' width on a constant and
 * leave a reader at 320 CSS px with three of twelve months labelled, a bar sitting under a neighbour's
 * tick. Only the date's own parts are rendered, so a display-timezone change can never shift a month
 * boundary, and the locale is always the caller's explicit tag rather than the platform's, so the
 * server render and the browser render agree.
 */
const MONTH_BUCKET_FORMAT: Intl.DateTimeFormatOptions = { month: "short" };

/** The bucket column of the figure's data table: the month each row states. */
const MONTH_COLUMN_KEY = "month";
const MONTH_COLUMN_LABEL = "Month";

/** The amount column of the figure's data table, labelled with the series it carries. */
const AMOUNT_COLUMN_KEY = "amount";

/**
 * What a cell states for a month the source recorded nothing in.
 *
 * A gap is not one of the five value states — it is the separate fact that the source recorded no row
 * at all — so it needs a word of its own rather than borrowing the formatter's word for a value it
 * could not establish. "No recorded value" says which fact it is, and the table's caption states once
 * that such a month is not a zero.
 */
const GAP_CELL_WORD = "No recorded value";

/**
 * The figure's visible name: the report, the one year it covers and the currency it is stated in.
 *
 * The currency belongs here because the figure is one of a partition, and the figure's name is also
 * the name of the table region beneath it and of the chart region itself. Two figures named only by
 * their year would give a screen-reader user two regions called the same thing and no way to tell
 * which one they are in.
 */
const TITLE_TEMPLATE = `${REPORT_COPY.history.title} for {year} — {currency}`;

/** The figure's short text alternative: the shape, the series, the currency and the time range. */
const CHART_ALT_TEMPLATE = "{shape} of {series} in {currency} for each month of {year}.";

/** The prose takeaway, filled into the family's summary opener after the series and its currency. */
const TAKEAWAY_TEMPLATE =
  "each month of {year} is drawn from the amount the source recorded in it, and a month it " +
  "recorded nothing in is left undrawn and named below rather than drawn at zero";

/** The data table's own caption: what one row is, in which currency, and how a gap reads. */
const TABLE_CAPTION_TEMPLATE =
  `${REPORT_COPY.history.title} for {year}, amounts in {currency}: one row per month of the year, ` +
  "and a month the source recorded nothing in states that rather than a zero.";

// ---------------------------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------------------------

/**
 * Fills a wording template's `{placeholder}` slots with the values the caller supplies.
 *
 * The family's copy module owns the sentences and declares the placeholders it interpolates; this
 * helper only substitutes them. A placeholder with no value is left as it stands rather than being
 * blanked, so a missing substitution is visible in review instead of producing a sentence with a hole
 * in it — and nothing here invents a value for a slot it was not given.
 */
function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : value;
  });
}

/**
 * Writes one month bucket in the reader's locale, without moving it through a zone.
 *
 * A tag `Intl` refuses throws a `RangeError`, and a throw during render would take the whole report
 * down over a preference the reader can change; the stored ISO form is the honest fallback, because it
 * is unambiguous and still reads as a date. Any other throw is a defect and is not absorbed.
 */
function monthLabel(date: SeriesPoint["bucketStart"], locale: string): string {
  try {
    return date.toLocaleString(locale, MONTH_BUCKET_FORMAT);
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return String(date);
  }
}

// ---------------------------------------------------------------------------------------------
// The result, prepared for the figure
// ---------------------------------------------------------------------------------------------

/** One stated amount: the exact minor units and the state that says what kind of value it is. */
type StatedAmount = SeriesPoint["value"];

/** One currency's part of the year: the months the result states in that currency, in its order. */
interface CurrencyPartition {
  /** The ISO 4217 code every figure in this partition is counted in. */
  readonly currency: string;
  /** That currency's month buckets, in the order the engine produced them. */
  readonly points: readonly SeriesPoint[];
}

/**
 * The result's series, grouped into one partition per currency, in the result's own order.
 *
 * The grouping is what keeps two currencies off one axis, and it is a grouping rather than a sum: each
 * partition holds the points it was given, in the order they arrived, and the partitions are ordered
 * by the currency's first appearance so the screen follows the result rather than a sort of its own.
 * Nothing is dropped: a currency the result states no point for has no partition because it has no
 * series at all, which is the honest outcome for a currency whose amounts cannot be stated.
 */
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

/**
 * One currency's months as the figure's points: the label every surface uses for the month, the exact
 * amount and the state the read recorded for it.
 *
 * `value` stays `null` wherever the read stated no amount, and the point carries its own state and its
 * own `gap` flag, so the figure decides to leave it undrawn instead of this file deciding to pass it a
 * zero. That is the whole gap rule: a month the source recorded nothing in reaches the chart with no
 * number to draw and reaches the table as the gap's own word.
 */
function chartPoints(points: readonly SeriesPoint[], locale: string): readonly ChartPoint[] {
  return points.map((point) => ({
    bucket: monthLabel(point.bucketStart, locale),
    value: point.value.minorUnits,
    state: point.value.valueState,
    gap: point.gap,
  }));
}

/** One currency's months as a single drawn series, labelled with the measure it states. */
function chartSeries(partition: CurrencyPartition, locale: string): ChartSeries {
  return {
    key: `${partition.currency}-received`,
    label: SERIES_LABEL,
    currency: partition.currency,
    points: chartPoints(partition.points, locale),
  };
}

/**
 * What one month's amount cell reads.
 *
 * Three facts, kept apart. A month the source recorded nothing in carries no amount, so the cell
 * states that fact in words rather than `0`, which would claim a recorded nothing. A state that
 * carries no number — unknown, withheld, an unavailable source — is worded by the money formatter
 * itself, so the cell, the chart's tooltip and the screen show the same word from the same source. A
 * stated amount is formatted from its exact minor units against its own currency and its own state,
 * which is what lets this cell agree with the export to the last digit `formatMinor` prints.
 */
function amountCell(value: StatedAmount, currency: string, gap: boolean, locale: string): string {
  if (gap && value.minorUnits === null) {
    return GAP_CELL_WORD;
  }
  const money: Money = { currency, minorUnits: value.minorUnits ?? minorUnitsOf(0) };
  return formatMinor(money, value.valueState, locale).text;
}

/**
 * One currency's months as the figure's data-table alternative.
 *
 * One row per month of the year, in the result's order, including the months the source recorded
 * nothing in — a table that omitted them would leave a reader unable to tell a short year from a
 * filtered one. The caption names the report, the year, the currency and the grain, so a cell lifted
 * out of the table still says what it counts, and the amount column is labelled with the series it
 * carries so the table and the chart's legend name the same figure.
 */
function chartTable(partition: CurrencyPartition, year: number, locale: string): ChartTable {
  return {
    caption: fillTemplate(TABLE_CAPTION_TEMPLATE, {
      year: String(year),
      currency: partition.currency,
    }),
    columns: [
      { key: MONTH_COLUMN_KEY, label: MONTH_COLUMN_LABEL },
      { key: AMOUNT_COLUMN_KEY, label: SERIES_LABEL },
    ],
    rows: partition.points.map((point) => ({
      [MONTH_COLUMN_KEY]: monthLabel(point.bucketStart, locale),
      [AMOUNT_COLUMN_KEY]: amountCell(point.value, partition.currency, point.gap, locale),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// One currency's figure
// ---------------------------------------------------------------------------------------------

/** Props of {@link CurrencyHistoryFigure}. */
interface CurrencyHistoryFigureProps {
  /** The currency partition this figure states. */
  readonly partition: CurrencyPartition;
  /** The chosen year the figures belong to, as the caller supplied it. */
  readonly year: number;
  /** The instant and coverage the read recorded, taken from the result's snapshot. */
  readonly coverage: ReportResult["snapshot"]["coverage"];
  readonly asOf: string;
  /** The viewer's display locale. */
  readonly locale: string;
}

/**
 * One currency's monthly history: the figure, its prose summary and the table it carries.
 *
 * The frame supplies every stated fact — coverage and as-of time from the snapshot, the currency from
 * the partition, the year from the control — so the caption underneath cannot state a different
 * instant or period from the table beside it. The figure is given exactly one series, which is why
 * each partition draws against its own axis and no axis ever spans two currencies.
 */
function CurrencyHistoryFigure({
  partition,
  year,
  coverage,
  asOf,
  locale,
}: CurrencyHistoryFigureProps): ReactElement {
  const yearText = String(year);
  const currency = partition.currency;

  return (
    <ChartFigure
      title={fillTemplate(TITLE_TEMPLATE, { year: yearText, currency })}
      summary={fillTemplate(CHART_CAPTIONS.summaryOpener, {
        series: SERIES_LABEL,
        currency,
        takeaway: fillTemplate(TAKEAWAY_TEMPLATE, { year: yearText }),
      })}
      caption={fillTemplate(CHART_ALT_TEMPLATE, {
        shape: CHART_SHAPE_WORD[CHART_KIND],
        series: SERIES_LABEL,
        currency,
        year: yearText,
      })}
      kind={CHART_KIND}
      series={[chartSeries(partition, locale)]}
      units={fillTemplate(CHART_CAPTIONS.unit, { currency })}
      coverage={coverage}
      asOf={fillTemplate(CHART_CAPTIONS.asOf, { asOf })}
      table={chartTable(partition, year, locale)}
      locale={locale}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

/**
 * The year's monthly history, one figure per currency, with the year control the report is asked for.
 *
 * The control is the surface's only input, and it holds no state of its own: the chosen year arrives
 * as a prop and a change is reported to the caller, which re-runs the same report query for that year.
 * A choice this file stored would let the label and the figures disagree the moment the query failed,
 * and a year derived from a clock would offer a period the application was never asked about.
 *
 * An empty year renders the family's empty wording and no figure at all: an all-zero chart, or a flat
 * line across twelve months, would state twelve months of no giving — a different and unrecorded fact.
 */
export function ReportHistory({
  result,
  locale,
  dir,
  year,
  years,
  onSelectYear,
  className,
}: ReportHistoryProps): ReactElement {
  const selectId = useId();
  const partitions = currencyPartitions(result.series);

  /*
    The chosen year is matched back to the caller's admitted list and that member is reported, so the
    control can only ever ask for a year the application offered. Parsing the selected value into a
    number would let a value the list does not hold reach the frame.
  */
  const handleYearChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const chosen = years.find((candidate) => String(candidate) === event.currentTarget.value);
    if (chosen !== undefined) {
      onSelectYear(chosen);
    }
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
        <StateNotice
          kind="empty"
          // Level 2, so this notice replaces the per-currency `<h2>` sections at the same depth of
          // the outline rather than skipping a level under the report frame's heading.
          headingLevel={2}
          title={EMPTY_STATES.gifts.title}
          description={EMPTY_STATES.gifts.body}
          action={EMPTY_STATES.gifts.action}
        />
      ) : (
        partitions.map((partition) => (
          <Card key={partition.currency} size="sm">
            <CardHeader>
              <CardTitle>
                {/* A real heading, naming the region, so a screen-reader user can reach this
                    currency's figures directly instead of tabbing through the one before it. */}
                <h2>
                  {`${PARTITION_HEADING_LEAD} `}
                  <bdi>{partition.currency}</bdi>
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              <CurrencyHistoryFigure
                partition={partition}
                year={year}
                coverage={result.snapshot.coverage}
                asOf={result.snapshot.asOf}
                locale={locale}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

export default ReportHistory;
