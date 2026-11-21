"use client";

/**
 * The one chart in the application: a figure that says what it shows, draws it, and carries the same
 * data beneath it as a real table.
 *
 * Every chart surface reaches a reader through this component and nowhere else — the Support
 * overview, the monthly history, the period comparison, the partner-by-month matrix's companion view
 * and coaching progress all render the same figure under the same rules — so what a chart states
 * about its unit, its coverage and its as-of time cannot drift between them, and no second chart
 * library, `figure` implementation or data-table alternative exists.
 *
 * What this component owns.
 *
 * - The figure's structure, in the order a reader needs it: `figure` > `figcaption` > the chart
 *   region > the prose summary > the data table. The `figcaption` names the subject, the units, the
 *   coverage the read recorded and the instant it was evaluated at, so a reader who cannot see the
 *   chart still learns what it shows and over what period.
 * - The chart region's accessible name: `role="img"` with an `aria-label` equal to the caller's
 *   caption, and `aria-describedby` pointing at both the prose summary and the data table. The plot
 *   itself is marked presentational for assistive technology (`accessibilityLayer={false}`, and
 *   `role="img"` on the region), because a screen-reader user is served better by the table than by
 *   an SVG path, and a focusable element inside a named image region is noise rather than access.
 * - The data-table alternative, which is always in the document — shown, never `display:none`, never
 *   a tooltip, never an image — inside the application's one horizontally scrollable region
 *   (`components/scroll-region`), so a wide table scrolls on its own and the page never scrolls
 *   sideways (WCAG 1.4.10 Reflow).
 * - Honesty about missing data. A bucket the series does not draw is a gap and never a zero: no
 *   interpolation, `connectNulls={false}` on lines and areas, and every undrawn bucket named in the
 *   prose summary together with what it is (`no recorded value`, `unknown`, `withheld`, source
 *   `unavailable`). A recorded zero plots at zero and is named as a recorded zero, so a dip to zero
 *   is never confused with an absence of data.
 * - Four renderings that never merge: a `zero` point is drawn at zero, while an `unknown`, a
 *   `withheld` and an `unavailable` point are not drawn at all and are named in words. The four stay
 *   distinct in the chart, in the tooltip and in the prose summary, and the table the caller supplies
 *   states each bucket's own state, so the chart can never claim a figure the table does not hold.
 *
 * What this component refuses to own, and why.
 *
 * - It computes no financial value. Every amount it draws arrives as an exact integer count of minor
 *   units and is rendered through `modules/money/format`'s `formatMinor` — the application's only
 *   money formatter — so nothing here rounds, reformats or re-derives a figure, and the chart, the
 *   table, the drilldown, the CSV and the print view of one query cannot disagree. This file runs
 *   no report of its own: it receives the result the report already produced, and computes nothing.
 * - It never combines two currencies. Series are grouped by their own ISO code and each currency is
 *   drawn against its own axis, because an axis covering two currencies would state a comparison this
 *   application cannot make — it holds no exchange rate and converts nothing. There is no "total
 *   support" series and no derived cross-currency figure.
 * - It states no colour, radius, shadow or spacing of its own. Series paint comes from the
 *   `--chart-1`…`--chart-5` tokens, grid and axis from `--border` and `--muted-foreground`, and every
 *   layout value from the token utilities, so the chart belongs to the same design system as the
 *   table beside it instead of introducing a palette of its own.
 *
 * Accessibility and motion. Series are distinguished by their label in the legend, in the tooltip and
 * in the table header, never by colour alone, and the legend sits outside the image region so a
 * screen-reader user can reach it. A tooltip only repeats a value the table already holds. Chart
 * animation is disabled whenever the reader has asked for reduced motion — and is off for the
 * server-rendered markup in every case — so no animation is ever required to perceive the data. Bucket
 * labels, amounts and dates are isolated in `<bdi>`: a number and a date are direction-weak, and
 * without isolation an amount in a right-to-left figure would be reordered against its currency code.
 * At 320 CSS px the figure stacks (caption, chart, legend, summary, table) and only the table's own
 * labelled region scrolls.
 *
 * Scope: AAP 0.3.4 (one chart-with-table-alternative pattern, consumed by Support and coaching),
 * 0.4.4 (gap 4 — owned `figure` + `figcaption` + `aria-describedby` + data table + prose summary on
 * Recharts 3.11.0, with the registry's `chart` item deliberately excluded), 0.8.8 (every surface reads
 * the same report result) and success criteria 1, 6 and 16.
 */

import { useId, useSyncExternalStore, type ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import { VALUE_STATE_WORDS } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";

// ---------------------------------------------------------------------------------------------
// What a caller passes
// ---------------------------------------------------------------------------------------------

/**
 * The three shapes this release draws, listed once so the closed set has a runtime form as well as a
 * type. Each is drawn from the same normalised data as the others, so switching the shape can never
 * change which buckets are drawn or which are named as gaps.
 */
export type ChartKind = "bar" | "line" | "area";

/**
 * One bucket of one series: the amount the read recorded for it, and the state that says what kind of
 * value it is.
 *
 * `value` is an exact integer count of the series currency's minor units when the series states a
 * currency, and a plain count otherwise. It is `null` when the read states no amount for the bucket —
 * which is what a gap, an unknown value, a withheld value and an unavailable source all look like in
 * the data — so a point is only ever drawn when it carries both a number and a numeric state.
 *
 * `gap` says the source recorded no row for this bucket, which is a different fact from `unknown`
 * (the source was asked and did not establish a value). Both are undrawn; the prose summary names
 * them separately when the caller distinguishes them, because "nothing was recorded" and "nothing
 * could be established" are different things to tell a worker.
 */
export interface ChartPoint {
  /** The bucket's label, used unchanged for the axis, the tooltip, the summary and the table row. */
  readonly bucket: string;
  /** The exact amount, or `null` when no amount may be stated for this bucket. */
  readonly value: number | null;
  /** The state the read recorded for this bucket. Never inferred here. */
  readonly state: ValueState;
  /** Whether the source recorded no row for this bucket at all. Defaults to `false`. */
  readonly gap?: boolean;
}

/**
 * One drawn series.
 *
 * A series that states `currency` is a monetary series: its points are minor units of that currency
 * and every amount is formatted through `formatMinor`. A series that states no currency is a count
 * series (calls made, conversations, meetings held) and its points are rendered as plain integers —
 * a monetary series must therefore state its ISO code, because a minor-unit integer drawn as a count
 * would overstate the figure by the currency's exponent.
 */
export interface ChartSeries {
  /** Stable identity of the series within its currency group; used as the render key. */
  readonly key: string;
  /** The reader-facing name, drawn in the legend and matching the table's column header. */
  readonly label: string;
  /** The ISO 4217 code whose minor units the points are counted in, for a monetary series. */
  readonly currency?: string;
  /** One point per bucket, in the order the buckets should be read. */
  readonly points: readonly ChartPoint[];
}

/** One column of the data-table alternative: the row field it reads and the header it shows. */
export interface ChartTableColumn {
  readonly key: string;
  readonly label: string;
}

/**
 * The data-table alternative to the chart: the same buckets, formatted by the caller.
 *
 * The rows arrive already formatted — the service formats each amount through `formatMinor` and keeps
 * the value state's own word ("Unknown", "Withheld", "Unavailable", "Incomplete subtotal") in the
 * cell — so the table, the CSV export and the print view of one query state the same figures in the
 * same words, and this component never formats a second copy of them. Every column must have a header
 * and a caption must be supplied: an alternative a reader cannot identify is not an alternative.
 */
export interface ChartTable {
  /** The table's caption: what it holds, for which subject and over which period. */
  readonly caption: string;
  /** The columns, in reading order. The first is the bucket column. */
  readonly columns: readonly ChartTableColumn[];
  /** One row per bucket, keyed by column key. A missing cell renders empty, never "undefined". */
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** Props of {@link ChartFigure}. */
export interface ChartFigureProps {
  /**
   * The figure's visible name — the subject and the measure, in the caller's words. It is rendered in
   * the caption, above the chart, and is what the table's scroll region is named after.
   */
  readonly title: string;

  /**
   * The prose takeaway: what the chart shows, in one or two sentences, in the caller's words.
   *
   * Required, because a chart with no stated takeaway leaves a reader to infer a story from a shape.
   * Every undrawn bucket and every recorded zero is named after this sentence rather than instead of
   * it, so the summary is the caller's reading plus this component's own honesty about the data.
   */
  readonly summary: string;

  /**
   * The short text alternative: the chart type, the subject and the time range, in the caller's
   * words. Applied as the chart region's `aria-label`, so it is the sentence a screen-reader user
   * hears for the image once the caption and the described summary and table are exhausted.
   */
  readonly caption: string;

  /** Which shape to draw. It changes only the mark, never the data, and never the honesty rules. */
  readonly kind: ChartKind;

  /** The plot's height in CSS pixels. Defaults to {@link DEFAULT_CHART_HEIGHT}. */
  readonly height?: number;

  /** The series to draw. Series of different currencies are drawn against separate axes. */
  readonly series: readonly ChartSeries[];

  /**
   * The units the figures are stated in, as a statement in the caller's words — the currency codes
   * present, or the counts being compared. Rendered verbatim in the caption, because a chart that
   * does not state its units is a picture of numbers nobody can check.
   */
  readonly units: string;

  /** The coverage the read recorded, stated in the caption as the range it does and does not cover. */
  readonly coverage: Coverage;

  /**
   * The as-of statement, exactly as the table and the export state it: the instant the read was
   * evaluated at, which is never when the source last changed. Rendered verbatim.
   */
  readonly asOf: string;

  /** The data-table alternative. Always rendered, always in the document, never a hidden copy. */
  readonly table: ChartTable;

  /**
   * The viewer's display locale, supplied by the route composition and never read from the host, so
   * the same figures render identically on the server and in the browser.
   */
  readonly locale: string;

  /** Layout classes for the figure. Never a colour, a radius or a shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// The design system's own values
// ---------------------------------------------------------------------------------------------

/**
 * The data-series ramp, in the order series are painted within one currency group.
 *
 * These are the design system's `--chart-1`…`--chart-5` tokens, referenced as they are declared
 * rather than copied, so the chart follows the theme in both the light and the dark block. A sixth
 * series reuses the first paint: a series is identified by its label, so a repeated paint loses no
 * information, and a chart that invented a colour would leave the token layer.
 */
const SERIES_PAINTS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** One member of the ramp, derived so a paint and its legend swatch cannot drift apart. */
type SeriesPaint = (typeof SERIES_PAINTS)[number];

/**
 * The legend swatch for each paint: the same token through the utility the theme bridge generates for
 * it. Kept beside {@link SERIES_PAINTS} so the two lists are read as one, and so the stylesheet sees
 * a literal utility name it can generate instead of a class built at runtime.
 */
const SERIES_SWATCH: Readonly<Record<SeriesPaint, string>> = {
  "var(--chart-1)": "bg-chart-1",
  "var(--chart-2)": "bg-chart-2",
  "var(--chart-3)": "bg-chart-3",
  "var(--chart-4)": "bg-chart-4",
  "var(--chart-5)": "bg-chart-5",
};

/** The rule colour for the grid and the axis line: the design system's decorative boundary token. */
const GRID_PAINT = "var(--border)";

/** The axis text colour: the design system's quiet foreground, on its own surface at WCAG AA. */
const AXIS_TEXT = { fill: "var(--muted-foreground)", fontSize: 12 } as const;

/** The fill the tooltip paints behind the hovered bar, so the cursor is a token and not a literal. */
const TOOLTIP_CURSOR = { fill: "var(--muted)" } as const;

/**
 * How much of the series paint an area's fill carries.
 *
 * An area chart fills the surface under the line, and at full strength the fill would compete with the
 * line and with the table beneath it. It is an opacity rather than a colour: the hue stays the series'
 * own token, and a second series painted over the first still reads as a second series. The band is
 * reinforcement, never the reading — the line and its markers carry every value, and the table carries
 * them again — so the strength is set where the band stays visible on the dark surface too, where a
 * fainter fill reads as an empty plot.
 */
const AREA_FILL_OPACITY = 0.35;

/** The plot's height when the caller states none, in CSS pixels. */
const DEFAULT_CHART_HEIGHT = 240;

/**
 * The width the plot assumes before the container has been measured.
 *
 * Without it `ResponsiveContainer` renders nothing until the browser reports a size, so the figure
 * would arrive empty on the server and fill in later. Stating an initial width lets the chart be part
 * of the first paint — which matters because the figure sits beside the table that must agree with it
 * — and the measured width replaces it on the client.
 */
const INITIAL_PLOT_WIDTH = 640;

/** The row field the category axis reads. Prefixed so no series key can shadow it. */
const BUCKET_DATA_KEY = "bucket";

// ---------------------------------------------------------------------------------------------
// One point, as it will be drawn and read
// ---------------------------------------------------------------------------------------------

/**
 * A point after normalisation: what to plot, and the text every surface shows for it.
 *
 * Normalising once is what keeps the chart, the tooltip and the summary from disagreeing: the plotted
 * number and the displayed word are decided together, from the state the read recorded, and nothing
 * downstream re-derives either.
 */
interface PlottedPoint {
  /** The bucket's label, unchanged from the caller's point. */
  readonly bucket: string;
  /** The value to draw, or `null` when this point must not be drawn at all. */
  readonly plot: number | null;
  /** The display text: a formatted amount, a count, or the state's own word. Never empty. */
  readonly text: string;
  /** The state the read recorded, carried through for classification and for the table's agreement. */
  readonly state: ValueState;
  /** Whether the source recorded no row for this bucket. */
  readonly gap: boolean;
}

/** One series after normalisation: its identity, its paint and one entry per bucket. */
interface PlottedSeries {
  readonly key: string;
  readonly label: string;
  /** The row field this series plots, derived from its position so no key can collide with a path. */
  readonly dataKey: string;
  readonly paint: SeriesPaint;
  readonly swatch: string;
  /** The buckets in the order the caller listed them, keyed by their label. */
  readonly points: ReadonlyMap<string, PlottedPoint>;
  /** How many points can be drawn. Zero means the series has no picture at all. */
  readonly plottable: number;
  /** How many drawn points are an incomplete subtotal, which makes the figure's partiality visible. */
  readonly incomplete: number;
}

/** One row of the chart's data: the bucket label plus one field per series in the group. */
type ChartRow = Readonly<Record<string, string | number | null>>;

/** One currency group: the series drawn against a single axis, and the rows they share. */
interface ChartGroup {
  /** The ISO code the group is drawn in, or `undefined` for a group of count series. */
  readonly currency: string | undefined;
  readonly series: readonly PlottedSeries[];
  readonly rows: readonly ChartRow[];
  /** How many points the whole group can draw. Zero means the group has no picture. */
  readonly plottable: number;
}

/**
 * Whether a state carries a number.
 *
 * `incomplete-subtotal` is included deliberately: it is a real figure for the part of the period the
 * source holds, so it is drawn, and the caption says it is a subtotal over partial coverage rather
 * than a whole-period total. `unknown`, `withheld` and `unavailable` carry no amount at all.
 */
function isNumericState(state: ValueState): boolean {
  return state === "value" || state === "zero" || state === "incomplete-subtotal";
}

/**
 * The value to plot for one point, or `null` when it must not be drawn.
 *
 * A `zero` plots at zero whatever the point carries, mirroring the money formatter — a zero state is
 * the fact that the amount is zero, and a chart that drew a number beside it would disagree with the
 * table that shows "0". The three non-numeric states are never coerced to zero: a withheld value drawn
 * as a zero would both misstate the figure and let it be inferred, and an unavailable source drawn as
 * a zero would state an outage as a measurement.
 */
function plotValue(point: ChartPoint): number | null {
  if (point.value === null || !Number.isFinite(point.value)) {
    return null;
  }
  if (!isNumericState(point.state)) {
    return null;
  }
  return point.state === "zero" ? 0 : point.value;
}

/**
 * The amount a formatter is given for one point.
 *
 * `formatMinor` reads the amount only for the three numeric states, so a point that carries no number
 * is formatted against a canonical zero instead of being given one. `minorUnitsOf` is the single
 * constructor a minor-unit count may have, so a fractional or out-of-range value is refused there
 * rather than drawn at a precision that would drift; negative zero is mapped to zero exactly as the
 * formatter does, so the two agree on which values are canonical.
 */
function amountOf(currency: string, point: ChartPoint): Money {
  const carried = isNumericState(point.state) && point.value !== null ? point.value : 0;
  return { currency, minorUnits: minorUnitsOf(carried === 0 ? 0 : carried) };
}

/** The word a non-numeric state renders, taken from the one vocabulary that names these states. */
function stateWord(state: ValueState): string {
  switch (state) {
    case "value":
      return "";
    case "zero":
      return VALUE_STATE_WORDS.zero.label;
    case "unknown":
      return VALUE_STATE_WORDS.unknown.label;
    case "withheld":
      return VALUE_STATE_WORDS.withheld.label;
    case "unavailable":
      return VALUE_STATE_WORDS.unavailable.label;
    case "incomplete-subtotal":
      return VALUE_STATE_WORDS["incomplete-subtotal"].label;
  }
}

/**
 * The display text of one point of a count series.
 *
 * A count is not money, so no money formatter applies and no currency's exponent is involved: the
 * value is an integer the read counted, and it is rendered as itself. A state that carries no number
 * renders its own word instead, and an incomplete subtotal keeps its marker, so the four states stay
 * four renderings here exactly as they do in a monetary series.
 */
function countText(point: ChartPoint): string {
  if (!isNumericState(point.state) || point.value === null || !Number.isFinite(point.value)) {
    return stateWord(point.state === "value" ? "unknown" : point.state);
  }
  const shown = point.state === "zero" ? 0 : point.value;
  return point.state === "incomplete-subtotal"
    ? `${String(shown)} (${VALUE_STATE_WORDS["incomplete-subtotal"].label})`
    : String(shown);
}

/** The display text of one point: a formatted amount for a monetary series, a count otherwise. */
function pointText(currency: string | undefined, point: ChartPoint, locale: string): string {
  return currency === undefined
    ? countText(point)
    : formatMinor(amountOf(currency, point), point.state, locale).text;
}

/**
 * Normalises one series into the form the chart, the tooltip and the summary all read.
 *
 * A repeated bucket label within one series keeps its first point: two points cannot share one place
 * on a category axis, and the first is the one the caller listed first. Nothing is dropped silently
 * in a way the reader can detect — the summary and the table are built from the same normalised
 * bucket list, so both state exactly the buckets that are drawn.
 */
function normaliseSeries(series: ChartSeries, index: number, locale: string): PlottedSeries {
  const paint = SERIES_PAINTS[index % SERIES_PAINTS.length] ?? SERIES_PAINTS[0];
  const points = new Map<string, PlottedPoint>();
  let plottable = 0;
  let incomplete = 0;

  for (const point of series.points) {
    if (points.has(point.bucket)) {
      continue;
    }
    const plot = plotValue(point);
    if (plot !== null) {
      plottable += 1;
      if (point.state === "incomplete-subtotal") {
        incomplete += 1;
      }
    }
    points.set(point.bucket, {
      bucket: point.bucket,
      plot,
      text: pointText(series.currency, point, locale),
      state: point.state,
      gap: point.gap === true,
    });
  }

  return {
    key: series.key,
    label: series.label,
    dataKey: `s${String(index)}`,
    paint,
    swatch: SERIES_SWATCH[paint],
    points,
    plottable,
    incomplete,
  };
}

/**
 * Groups the caller's series by currency and builds the rows every shape plots.
 *
 * A group is one axis. Two currencies therefore never share one: the chart would be stating that a
 * KWD thousandth and a JPY yen can be compared on a single scale, which this application has no
 * exchange rate to support. Series of one currency share a group, and a count series (no currency)
 * forms its own group, so counts are compared with counts.
 */
function groupSeries(series: readonly ChartSeries[], locale: string): readonly ChartGroup[] {
  const order: (string | undefined)[] = [];
  const byCurrency = new Map<string, ChartSeries[]>();

  for (const item of series) {
    const groupKey = item.currency ?? "";
    const existing = byCurrency.get(groupKey);
    if (existing === undefined) {
      byCurrency.set(groupKey, [item]);
      order.push(item.currency);
    } else {
      existing.push(item);
    }
  }

  return order.map((currency) => {
    const members = byCurrency.get(currency ?? "") ?? [];
    const plotted = members.map((member, index) => normaliseSeries(member, index, locale));

    const buckets: string[] = [];
    const seen = new Set<string>();
    for (const member of plotted) {
      for (const bucket of member.points.keys()) {
        if (!seen.has(bucket)) {
          seen.add(bucket);
          buckets.push(bucket);
        }
      }
    }

    const rows: ChartRow[] = buckets.map((bucket) => {
      const row: Record<string, string | number | null> = { [BUCKET_DATA_KEY]: bucket };
      for (const member of plotted) {
        row[member.dataKey] = member.points.get(bucket)?.plot ?? null;
      }
      return row;
    });

    return {
      currency,
      series: plotted,
      rows,
      plottable: plotted.reduce((total, member) => total + member.plottable, 0),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------------------------

/** The platform query a reader sets to ask that nothing move. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * True when the reader has asked for reduced motion.
 *
 * Read through `useSyncExternalStore` rather than a state update inside an effect: the query is an
 * external store, its snapshot is a stable boolean, and reading it this way avoids a render pass whose
 * only purpose was to correct the first one. The server snapshot is `true` — the server cannot know
 * the reader's setting, so the markup it produces carries no animation, and a browser without a
 * preference animates from the second render onward.
 */
function subscribeToReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => {
    query.removeEventListener("change", onStoreChange);
  };
}

/** The browser's answer, or `true` where the platform exposes no such query. */
function readReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** The server's answer: no animation, because the reader's preference is not knowable there. */
function readServerReducedMotion(): boolean {
  return true;
}

/** Whether motion must be suppressed for this reader. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, readServerReducedMotion);
}

// ---------------------------------------------------------------------------------------------
// The prose summary the chart owes a reader
// ---------------------------------------------------------------------------------------------

/**
 * The buckets this component sorts into kinds of absence, in the order the summary states them.
 *
 * The order is deliberate: a gap (nothing recorded) comes before a state (a value that cannot be
 * shown), and a recorded zero comes before both, because it is a value and not an absence at all.
 */
const SUMMARY_CLAUSE_KEYS = ["zero", "gap", "unknown", "withheld", "unavailable"] as const;

/** One kind of undrawn — or zero — bucket. */
type SummaryClauseKey = (typeof SUMMARY_CLAUSE_KEYS)[number];

/**
 * How each kind is worded in the prose summary.
 *
 * These are structural phrases, not product copy: they state a fact about a bucket and nothing else,
 * and the family that owns a surface words its own takeaway and costs (`features/support/copy` states
 * the unit, coverage and as-of sentences). None of them merges two facts — a gap and an unknown value
 * are worded differently, and a zero is named as a zero so a dip is never read as missing data.
 */
const SUMMARY_CLAUSE_PHRASE: Readonly<Record<SummaryClauseKey, string>> = {
  zero: "a recorded zero in",
  gap: "no recorded value in",
  unknown: "unknown in",
  withheld: "withheld in",
  unavailable: "the source could not be read for",
};

/** The sentence that explains why the paragraphs after it exist. */
const SUMMARY_LEAD =
  "Buckets the chart does not draw are named here rather than filled in: none of them is treated as " +
  "a zero and none is estimated from a neighbouring bucket. A recorded zero is drawn at zero and " +
  "named as a zero.";

/** One kind of bucket, with the buckets of that kind. */
interface SummaryClause {
  readonly key: SummaryClauseKey;
  readonly phrase: string;
  readonly buckets: readonly string[];
}

/**
 * Sorts one series' buckets into the kinds of value that are not a drawn figure.
 *
 * A point that was drawn contributes only its zero case: a zero is a value, so naming it here is how a
 * reader tells a genuine dip from a gap. A point that was not drawn is classified by its own recorded
 * state — a gap is the source recording nothing, and an unplotted numeric state (a number with no
 * amount beside it) is treated as unknown rather than being drawn at a guessed value.
 */
function summaryClauses(member: PlottedSeries): readonly SummaryClause[] {
  const buckets: Record<SummaryClauseKey, string[]> = {
    zero: [],
    gap: [],
    unknown: [],
    withheld: [],
    unavailable: [],
  };

  for (const point of member.points.values()) {
    if (point.plot !== null) {
      if (point.state === "zero") {
        buckets.zero.push(point.bucket);
      }
      continue;
    }
    if (point.gap) {
      buckets.gap.push(point.bucket);
      continue;
    }
    switch (point.state) {
      case "withheld":
        buckets.withheld.push(point.bucket);
        break;
      case "unavailable":
        buckets.unavailable.push(point.bucket);
        break;
      default:
        buckets.unknown.push(point.bucket);
        break;
    }
  }

  return SUMMARY_CLAUSE_KEYS.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    phrase: SUMMARY_CLAUSE_PHRASE[key],
    buckets: buckets[key],
  }));
}

/**
 * One series' absences, as a sentence.
 *
 * The bucket labels sit inside `<bdi>`: a month name in another script, or a label mixing digits and
 * letters, is direction-weak text, and without isolation it would be reordered against the sentence's
 * own direction in a right-to-left figure.
 */
function SummaryClauseLine({
  member,
  clauses,
}: {
  readonly member: PlottedSeries;
  readonly clauses: readonly SummaryClause[];
}): ReactElement {
  return (
    <p>
      <bdi>{member.label}</bdi>
      {": "}
      {clauses.map((clause, index) => (
        <span key={clause.key}>
          {index === 0 ? null : "; "}
          {clause.phrase} <bdi>{clause.buckets.join(", ")}</bdi>
        </span>
      ))}
      {"."}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Coverage, as the figure states it
// ---------------------------------------------------------------------------------------------

/**
 * The coverage line: the period the read covers, and what that makes the figures drawn over it.
 *
 * Coverage says how much of the past a read reaches; it never stands in for the state of an individual
 * value. A boundary the source did not state is reported as unstated rather than as the earliest or
 * latest day it holds, because those are different facts and only one of them is known. When coverage
 * is partial — or when a drawn point is itself an incomplete subtotal — the line says that every
 * subtotal drawn here covers only part of the period, so a bar is never read as a whole-period total.
 */
function CoverageLine({
  coverage,
  partialFigures,
}: {
  readonly coverage: Coverage;
  readonly partialFigures: boolean;
}): ReactElement {
  const { from, to, state } = coverage;
  const range =
    from !== null && to !== null ? (
      <>
        {" from "}
        <bdi>{from}</bdi>
        {" to "}
        <bdi>{to}</bdi>
      </>
    ) : from !== null ? (
      <>
        {" from "}
        <bdi>{from}</bdi>
        {" onwards"}
      </>
    ) : to !== null ? (
      <>
        {" up to "}
        <bdi>{to}</bdi>
      </>
    ) : null;

  if (state === "unknown") {
    return (
      <span className="text-sm text-muted-foreground">
        {"Coverage: unknown"}
        {range}
        {
          " — the source stated no covered range, so no subtotal drawn here is a total of the period."
        }
      </span>
    );
  }

  if (state === "partial") {
    return (
      <span className="text-sm text-muted-foreground">
        {"Coverage: partial"}
        {range}
        {
          " only, so every subtotal drawn here is an incomplete subtotal of that part of the period."
        }
      </span>
    );
  }

  return (
    <span className="text-sm text-muted-foreground">
      {"Coverage: complete"}
      {range ?? ", with no boundary dates stated"}
      {partialFigures
        ? ". A figure drawn here covers only part of the period, so it is an incomplete subtotal."
        : "."}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// The marks
// ---------------------------------------------------------------------------------------------

/**
 * The legend: which paint belongs to which series, named.
 *
 * It sits outside the chart's image region on purpose. Inside it a screen-reader user would be told
 * the whole plot is one image and would never hear the series names; here the names are real
 * content, and the same names are the table's column headers. The swatch is decorative — the label
 * carries the meaning, so colour is never the only way to tell two series apart.
 */
function ChartLegend({ series }: { readonly series: readonly PlottedSeries[] }): ReactElement {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((member) => (
        <li key={member.dataKey} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("inline-block size-2 shrink-0 rounded-full", member.swatch)}
          />
          <bdi>{member.label}</bdi>
        </li>
      ))}
    </ul>
  );
}

/** What the chart hands its tooltip, plus the props the chart library adds when it renders it. */
interface ChartTooltipProps {
  readonly group: ChartGroup;
  /** Set by the chart while a bucket is hovered or focused. */
  readonly active?: boolean;
  /** The hovered bucket's category value, set by the chart. */
  readonly label?: string | number;
}

/**
 * The tooltip: the hovered bucket's figures, each stated the way the table states it.
 *
 * Supplementary by construction. It reads the same normalised points the table was built from, so it
 * can only repeat a value the table already holds, and a bucket that could not be drawn states its own
 * word here rather than a zero. It is not focusable and carries no control, so nothing it shows is
 * reachable only by pointing at the chart.
 */
function ChartTooltip({ group, active, label }: ChartTooltipProps): ReactElement | null {
  if (active !== true || label === undefined) {
    return null;
  }
  const bucket = String(label);
  const entries = group.series.flatMap((member) => {
    const point = member.points.get(bucket);
    return point === undefined ? [] : [{ member, point }];
  });
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="font-medium">
        <bdi>{bucket}</bdi>
      </p>
      <ul className="flex flex-col gap-1">
        {entries.map(({ member, point }) => (
          <li key={member.dataKey} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn("inline-block size-2 shrink-0 rounded-full", member.swatch)}
            />
            <span className="text-muted-foreground">
              <bdi>{member.label}</bdi>
            </span>
            <bdi className="tabular-figures ms-auto">{point.text}</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Props of {@link ChartPlot}. */
interface ChartPlotProps {
  readonly group: ChartGroup;
  readonly kind: ChartKind;
  readonly locale: string;
  readonly animate: boolean;
}

/**
 * The plot for one currency group, in the shape the caller asked for.
 *
 * All three shapes are drawn from the same rows, so the marks differ and the data does not. A bucket
 * that could not be drawn is absent from the row as `null`, and `connectNulls={false}` keeps a line or
 * a band from being drawn through it — the gap stays a gap rather than becoming an interpolated
 * segment. The value axis states its own amounts through `formatMinor` when the group is monetary, so
 * a tick and the table row behind it are the same figure in the same currency.
 */
function ChartPlot({ group, kind, locale, animate }: ChartPlotProps): ReactElement {
  const currency = group.currency;
  const valueTick =
    currency === undefined
      ? undefined
      : (value: number): string =>
          Number.isFinite(value) && Number.isInteger(value)
            ? formatMinor({ currency, minorUnits: minorUnitsOf(value) }, "value", locale).text
            : "";

  const grid = <CartesianGrid stroke={GRID_PAINT} vertical={false} />;
  const categoryAxis = (
    <XAxis
      dataKey={BUCKET_DATA_KEY}
      tick={AXIS_TEXT}
      tickLine={false}
      axisLine={{ stroke: GRID_PAINT }}
      interval="preserveStartEnd"
      minTickGap={8}
    />
  );
  const valueAxis = (
    <YAxis
      width="auto"
      tick={AXIS_TEXT}
      tickLine={false}
      axisLine={false}
      allowDecimals={false}
      tickFormatter={valueTick}
    />
  );
  /*
    `filterNull={false}` is the honesty setting, not a preference. A bucket with no plottable value
    would otherwise be dropped from the tooltip's payload, so hovering a gap, an unknown value or a
    withheld one would show nothing at all while its neighbours showed amounts — and a reader would
    have no way to tell "no recorded value" from "nothing to see here". Keeping the entry lets the
    bucket state its own word beside the buckets that carry a figure.
  */
  const tooltip = (
    <Tooltip content={<ChartTooltip group={group} />} cursor={TOOLTIP_CURSOR} filterNull={false} />
  );

  if (kind === "bar") {
    return (
      <BarChart data={group.rows} accessibilityLayer={false}>
        {grid}
        {categoryAxis}
        {valueAxis}
        {tooltip}
        {group.series.map((member) => (
          <Bar
            key={member.dataKey}
            dataKey={member.dataKey}
            name={member.label}
            fill={member.paint}
            isAnimationActive={animate}
          />
        ))}
      </BarChart>
    );
  }

  if (kind === "area") {
    return (
      <AreaChart data={group.rows} accessibilityLayer={false}>
        {grid}
        {categoryAxis}
        {valueAxis}
        {tooltip}
        {group.series.map((member) => (
          <Area
            key={member.dataKey}
            dataKey={member.dataKey}
            name={member.label}
            type="linear"
            stroke={member.paint}
            fill={member.paint}
            fillOpacity={AREA_FILL_OPACITY}
            dot={true}
            connectNulls={false}
            isAnimationActive={animate}
          />
        ))}
      </AreaChart>
    );
  }

  return (
    <LineChart data={group.rows} accessibilityLayer={false}>
      {grid}
      {categoryAxis}
      {valueAxis}
      {tooltip}
      {group.series.map((member) => (
        <Line
          key={member.dataKey}
          dataKey={member.dataKey}
          name={member.label}
          type="linear"
          stroke={member.paint}
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={animate}
        />
      ))}
    </LineChart>
  );
}

// ---------------------------------------------------------------------------------------------
// The alternative, and the figure that holds everything
// ---------------------------------------------------------------------------------------------

/**
 * The data-table alternative.
 *
 * A real table, with a caption of its own and a header cell for every column, holding every bucket
 * the chart was given — including the rows whose figure is a zero, a gap, an unknown, a withheld
 * value or an unavailable source. It is the caller's table, formatted from the same result the chart
 * was built from, so the chart and the alternative are one figure at two grains rather than two
 * independent computations a reader has to reconcile. A cell the caller left out renders empty
 * rather than the word "undefined", because a table that prints "undefined" is not an alternative to
 * anything.
 *
 * The caption element is the table's own name, kept visually hidden because the same words are shown
 * just above the scroll region: a caption laid out inside a table wider than its scroll port would be
 * centred across the table's full width and cut off at the region's edge, so a reader on a phone would
 * have to scroll the table sideways to read what the table is. The visible line carries the words; the
 * caption carries them to assistive technology, once.
 */
function ChartDataTable({
  table,
  id,
}: {
  readonly table: ChartTable;
  readonly id: string;
}): ReactElement {
  return (
    <Table id={id}>
      <TableCaption className="sr-only">{table.caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {table.columns.map((column) => (
            <TableHead key={column.key} scope="col">
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row, index) => (
          <TableRow key={`row-${String(index)}`}>
            {table.columns.map((column) => (
              <TableCell key={column.key}>{row[column.key] ?? ""}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Whether every bucket of a group reports that its source could not be read. */
function everyPointUnavailable(group: ChartGroup): boolean {
  let sawPoint = false;
  for (const member of group.series) {
    for (const point of member.points.values()) {
      sawPoint = true;
      if (point.state !== "unavailable") {
        return false;
      }
    }
  }
  return sawPoint;
}

/**
 * What a group with nothing to draw says instead of an empty pair of axes.
 *
 * The two cases are different facts and are worded as themselves: a source that could not be read is
 * an outage, while a group of gaps, unknown values and withheld values is a series with no figure in
 * it. Neither is an empty chart, neither is a zero, and both point at the table, which still states
 * every bucket's own state.
 */
function UnplottableNotice({ group }: { readonly group: ChartGroup }): ReactElement {
  const subject = group.currency === undefined ? "This series" : `The ${group.currency} series`;
  if (everyPointUnavailable(group)) {
    return (
      <StateNotice
        kind="unavailable"
        title={`${subject} could not be read`}
        description="Every bucket in this series reports that its source could not be read, so no point is drawn. Nothing is filled in with a zero, and the table below states each bucket's own state."
      />
    );
  }
  return (
    <StateNotice
      kind="empty"
      title={`${subject} has no figure to draw`}
      description="Every bucket in this series is a gap, an unknown value or a withheld one, so there is nothing to plot. None is treated as a zero, and the table below names each bucket's own state."
    />
  );
}

/** Props of {@link ChartGroupFigure}. */
interface ChartGroupFigureProps {
  readonly group: ChartGroup;
  readonly kind: ChartKind;
  readonly caption: string;
  readonly height: number;
  /** The ids of the prose summary and the data table, referenced by the image region. */
  readonly describedBy: string;
  readonly locale: string;
  readonly animate: boolean;
}

/**
 * One currency group: its axis, its plot, its legend — or the notice that says why it has no plot.
 *
 * The image region is named with the caller's caption and, where a group is one of several, the
 * currency that distinguishes it, so a reader hearing two figures on one page knows which is which.
 * `aria-describedby` reaches the prose summary and the data table, which is what lets the image be
 * understood without the picture.
 *
 * `jsx-a11y/prefer-tag-over-role` is suppressed for this component and only this component: the rule
 * asks for an `img` element instead of `role="img"`, which is right for a sourced picture and wrong
 * here. The marks are SVG the chart library draws, with no `src` an `img` could carry, so the
 * container is the only element that can hold the region's name and its described-by references — the
 * alternative the rule prefers would leave the plot with no accessible name at all.
 */
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
function ChartGroupFigure({
  group,
  kind,
  caption,
  height,
  describedBy,
  locale,
  animate,
}: ChartGroupFigureProps): ReactElement {
  const regionLabel =
    group.currency === undefined ? caption : `${caption} Figures are in ${group.currency}.`;

  return (
    <div className="flex w-full flex-col gap-2">
      {group.plottable === 0 ? (
        <UnplottableNotice group={group} />
      ) : (
        <>
          {/*
            The currency is named above the plot that draws it, so a figure with two currencies shows
            which axis is which. A group with no plot renders no such label: the notice that replaces
            the plot names its own currency in words, and a bare code above an empty space would be a
            label for something that is not there.
          */}
          {group.currency === undefined ? null : (
            <p className="text-xs font-medium text-muted-foreground">{group.currency}</p>
          )}
          {/*
            `role="img"` is the region, not the SVG: the plot is one picture with one name, and the
            table beside it carries the figures. The wrapper is a plain `div` because the region is
            not interactive — nothing here is focusable, so nothing is reachable only by pointing —
            and because an `img` element cannot hold the marks it surrounds.
          */}
          <div role="img" aria-label={regionLabel} aria-describedby={describedBy}>
            <ResponsiveContainer
              width="100%"
              height={height}
              initialDimension={{ width: INITIAL_PLOT_WIDTH, height }}
            >
              <ChartPlot group={group} kind={kind} locale={locale} animate={animate} />
            </ResponsiveContainer>
          </div>
          <ChartLegend series={group.series} />
        </>
      )}
    </div>
  );
}
/* oxlint-enable jsx-a11y/prefer-tag-over-role */

/**
 * The single chart: a caption that states the subject, the unit, the coverage and the as-of time, one
 * plot per currency, the prose summary that names every bucket the plot does not draw, and the data
 * table that holds them all.
 *
 * Renders no figure of its own: every amount arrives as an exact count of minor units and leaves
 * through `formatMinor`, every label arrives in the caller's words, and every state arrives from the
 * read. What this component decides is honesty — what may be drawn, what must be named instead, and
 * what the alternative must contain — because that is the part a caller cannot be trusted to repeat
 * consistently across five chart surfaces.
 */
export function ChartFigure({
  title,
  summary,
  caption,
  kind,
  height = DEFAULT_CHART_HEIGHT,
  series,
  units,
  coverage,
  asOf,
  table,
  locale,
  className,
}: ChartFigureProps): ReactElement {
  const baseId = useId();
  const summaryId = `${baseId}-summary`;
  const tableId = `${baseId}-table`;
  const reducedMotion = usePrefersReducedMotion();
  const groups = groupSeries(series, locale);
  const partialFigures = groups.some((group) =>
    group.series.some((member) => member.incomplete > 0),
  );
  const seriesClauses = groups.flatMap((group, groupIndex) =>
    group.series.map((member, seriesIndex) => ({
      member,
      key: `${member.key}-${String(groupIndex)}-${String(seriesIndex)}`,
      clauses: summaryClauses(member),
    })),
  );
  const named = seriesClauses.filter((entry) => entry.clauses.length > 0);

  return (
    <figure data-slot="chart-figure" className={cn("flex w-full flex-col gap-4", className)}>
      <figcaption className="flex flex-col gap-1">
        <span className="text-base font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{units}</span>
        <CoverageLine coverage={coverage} partialFigures={partialFigures} />
        <span className="text-sm text-muted-foreground">{asOf}</span>
      </figcaption>

      {groups.length === 0 ? (
        <StateNotice
          kind="empty"
          title="This chart has no series"
          description="No series was supplied, so there is nothing to draw. None is invented in its place, and the summary and the table below state what this figure holds."
        />
      ) : (
        groups.map((group, index) => (
          <ChartGroupFigure
            key={group.currency ?? `counts-${String(index)}`}
            group={group}
            kind={kind}
            caption={caption}
            height={height}
            describedBy={`${summaryId} ${tableId}`}
            locale={locale}
            animate={!reducedMotion}
          />
        ))
      )}

      <div id={summaryId} className="flex flex-col gap-2 text-sm">
        <p>{summary}</p>
        {named.length === 0 ? null : <p className="text-muted-foreground">{SUMMARY_LEAD}</p>}
        {named.map((entry) => (
          <SummaryClauseLine key={entry.key} member={entry.member} clauses={entry.clauses} />
        ))}
      </div>

      {/*
        The table's name is shown here, above the scroll region rather than inside the table: a
        caption laid out inside a table wider than its scroll port is centred across the table's full
        width and clipped at the region's edge, so on a phone a reader would have to scroll the table
        sideways to read what the table is. It is hidden from assistive technology because the table's
        own caption element states the same words once, where a table-navigation command finds them.
      */}
      <div className="flex flex-col gap-2">
        <p aria-hidden="true" className="text-sm text-muted-foreground">
          {table.caption}
        </p>
        <ScrollRegion label={`${title}: data table`}>
          <ChartDataTable table={table} id={tableId} />
        </ScrollRegion>
      </div>
    </figure>
  );
}

export default ChartFigure;
