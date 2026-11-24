"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import { VALUE_STATE_WORDS } from "@/components/status-badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
/** The three shapes this release draws, listed once so the closed set has a runtime form as well as a type. */ export type ChartKind = "bar" | "line" | "area";
export type ChartPoint = { readonly bucket: string; readonly value: number | null; readonly state: ValueState; readonly gap?: boolean };
export type ChartSeries = { readonly key: string; readonly label: string; readonly currency?: string; readonly points: readonly ChartPoint[] };
export type ChartTableColumn = { readonly key: string; readonly label: string };
export type ChartTable = { readonly caption: string; readonly columns: readonly ChartTableColumn[]; readonly rows: readonly Readonly<Record<string, string>>[] };
/** A stated target a plot holds its figures against: the value the plot marks, and the words that line states so the target is never colour alone. */ export type ChartReference = { readonly value: number; readonly label: string };
export type ChartFigureProps = {
  readonly title: string;
  readonly summary: string;
  readonly caption: string;
  readonly kind: ChartKind;
  readonly height?: number;
  readonly series: readonly ChartSeries[];
  readonly units: string;
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly table: ChartTable;
  readonly locale: string;
  /** A stated target this figure holds its figures against. Supplied, every plot draws it as a labelled reference line and widens its value axis to cover it; omitted, the value axis is exactly what a plot without a target states. */
  readonly reference?: ChartReference;
  readonly className?: string;
};
const SERIES_PAINTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;
type SeriesPaint = (typeof SERIES_PAINTS)[number];
const SERIES_SWATCH: Readonly<Record<SeriesPaint, string>> = { "var(--chart-1)": "bg-chart-1", "var(--chart-2)": "bg-chart-2", "var(--chart-3)": "bg-chart-3", "var(--chart-4)": "bg-chart-4", "var(--chart-5)": "bg-chart-5" };
const GRID_PAINT = "var(--border)";
const AXIS_TEXT = { fill: "var(--muted-foreground)", fontSize: 12 } as const;
const TOOLTIP_CURSOR = { fill: "var(--muted)" } as const;
const AREA_FILL_OPACITY = 0.35;
const DEFAULT_CHART_HEIGHT = 240;
const INITIAL_PLOT_WIDTH = 640;
const BUCKET_DATA_KEY = "bucket";
const REFERENCE_PAINT = "var(--muted-foreground)";
const REFERENCE_LABEL_FONT_SIZE = 12;
/** The lowest ceiling a plot that draws a target reaches above it, so a target of one or two still leaves the axis a band to state its counts against. */ const REFERENCE_MINIMUM_CEILING = 4;
/** The intervals a value axis states across a ceiling a target sets: five keeps an axis countable while every whole count below a small ceiling still lands on a tick. */ const AXIS_TICK_INTERVALS = 5;
/** Recharts' own height for a horizontal category axis, which every plot already reserves below its bands. */ const DEFAULT_CATEGORY_AXIS_HEIGHT = 30;
/** The floor a turned label shrinks to: below it a tick stops being legible, so the axis grows instead of the text shrinking further. */ const MIN_TICK_FONT_SIZE = 9;
const ROTATED_ANGLE = -90;
/** The width one label occupies per character, as a fraction of its font size: the digits, separators and currency letters a tick is set in. */ const TICK_CHARACTER_EM = 0.55;
/** The clearance kept between a value axis' widest tick and the plot's first band, counted into the width that axis reserves. */ const VALUE_AXIS_TICK_GAP = 8;
const MIN_VALUE_AXIS_WIDTH = 32;
/** The gap an upright label keeps from its neighbour and from the value axis, so neither touches it. */ const HORIZONTAL_LABEL_GAP = 4;
/** The band a turned label needs for the size it is set at, so two neighbours never touch. */ const ROTATED_LABEL_BAND_EM = 1.55;
/** Half the height a turned label's glyphs stand above its baseline, kept clear of the plot's left and right edges. */ const ROTATED_LABEL_INSET_EM = 0.5;
/** The clearance below the longest turned label, so the figure's own edge never clips one. */ const ROTATED_LABEL_PADDING = 8;
type PlottedPoint = { readonly bucket: string; readonly plot: number | null; readonly text: string; readonly state: ValueState; readonly gap: boolean };
type PlottedSeries = { readonly key: string; readonly label: string; readonly dataKey: string; readonly paint: SeriesPaint; readonly swatch: string; readonly points: ReadonlyMap<string, PlottedPoint>; readonly plottable: number; readonly incomplete: number };
type ChartRow = Readonly<Record<string, string | number | null>>;
type ChartGroup = { readonly currency: string | undefined; readonly series: readonly PlottedSeries[]; readonly rows: readonly ChartRow[]; readonly plottable: number };
const isNumericState = (state: ValueState): boolean => state === "value" || state === "zero" || state === "incomplete-subtotal";
function plotValue(point: ChartPoint): number | null {
  if (point.value === null || !Number.isFinite(point.value)) return null;
  if (!isNumericState(point.state)) return null;
  return point.state === "zero" ? 0 : point.value;
}
function amountOf(currency: string, point: ChartPoint): Money {
  const carried = isNumericState(point.state) && point.value !== null ? point.value : 0;
  return { currency, minorUnits: minorUnitsOf(carried === 0 ? 0 : carried) };
}
const stateWord = (state: ValueState): string => (state === "value" ? "" : VALUE_STATE_WORDS[state].label);
function countText(point: ChartPoint): string {
  if (!isNumericState(point.state) || point.value === null || !Number.isFinite(point.value)) return stateWord(point.state === "value" ? "unknown" : point.state);
  const shown = point.state === "zero" ? 0 : point.value;
  return point.state === "incomplete-subtotal" ? `${String(shown)} (${VALUE_STATE_WORDS["incomplete-subtotal"].label})` : String(shown);
}
// A bucket the source recorded no row for is a gap, which is a different fact from an unknown value: zero, unknown, withheld, unavailable and a gap are five distinct renderings everywhere, tooltips included, so a gap states the table's own words here rather than the formatter's unknown marker.
const pointText = (currency: string | undefined, point: ChartPoint, locale: string): string => {
  if (point.gap === true && point.value === null) return "No recorded value";
  return currency === undefined ? countText(point) : formatMinor(amountOf(currency, point), point.state, locale).text;
};
function normaliseSeries(series: ChartSeries, index: number, locale: string): PlottedSeries {
  const paint = SERIES_PAINTS[index % SERIES_PAINTS.length] ?? SERIES_PAINTS[0];
  const points = new Map<string, PlottedPoint>();
  let plottable = 0;
  let incomplete = 0;
  for (const point of series.points) {
    if (points.has(point.bucket)) continue;
    const plot = plotValue(point);
    if (plot !== null) {
      plottable += 1;
      if (point.state === "incomplete-subtotal") incomplete += 1;
    }
    points.set(point.bucket, { bucket: point.bucket, plot, text: pointText(series.currency, point, locale), state: point.state, gap: point.gap === true });
  }
  return { key: series.key, label: series.label, dataKey: `s${String(index)}`, paint, swatch: SERIES_SWATCH[paint], points, plottable, incomplete };
}
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
      for (const member of plotted) row[member.dataKey] = member.points.get(bucket)?.plot ?? null;
      return row;
    });
    return { currency, series: plotted, rows, plottable: plotted.reduce((total, member) => total + member.plottable, 0) };
  });
}
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}
const readReducedMotion = (): boolean => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(REDUCED_MOTION_QUERY).matches);
const readServerReducedMotion = (): boolean => true;
const usePrefersReducedMotion = (): boolean => useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, readServerReducedMotion);
const SUMMARY_CLAUSE_KEYS = ["zero", "gap", "unknown", "withheld", "unavailable"] as const;
type SummaryClauseKey = (typeof SUMMARY_CLAUSE_KEYS)[number];
const SUMMARY_CLAUSE_PHRASE: Readonly<Record<SummaryClauseKey, string>> = { zero: "a recorded zero in", gap: "no recorded value in", unknown: "unknown in", withheld: "withheld in", unavailable: "the source could not be read for" };
const SUMMARY_LEAD = "Buckets the chart does not draw are named here rather than filled in: none of them is treated as " + "a zero and none is estimated from a neighbouring bucket. A recorded zero is drawn at zero and " + "named as a zero.";
type SummaryClause = { readonly key: SummaryClauseKey; readonly phrase: string; readonly buckets: readonly string[] };
function summaryClauses(member: PlottedSeries): readonly SummaryClause[] {
  const buckets: Record<SummaryClauseKey, string[]> = { zero: [], gap: [], unknown: [], withheld: [], unavailable: [] };
  for (const point of member.points.values()) {
    if (point.plot !== null) {
      if (point.state === "zero") buckets.zero.push(point.bucket);
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
  return SUMMARY_CLAUSE_KEYS.filter((key) => buckets[key].length > 0).map((key) => ({ key, phrase: SUMMARY_CLAUSE_PHRASE[key], buckets: buckets[key] }));
}
const SummaryClauseLine = ({ member, clauses }: { readonly member: PlottedSeries; readonly clauses: readonly SummaryClause[] }): ReactElement => (
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
function CoverageLine({ coverage, partialFigures }: { readonly coverage: Coverage; readonly partialFigures: boolean }): ReactElement {
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
  if (state !== "complete") {
    return (
      <span className="text-sm text-muted-foreground">
        {`Coverage: ${state}`}
        {range}
        {state === "unknown" ? " — the source stated no covered range, so no subtotal drawn here is a total of the period." : " only, so every subtotal drawn here is an incomplete subtotal of that part of the period."}
      </span>
    );
  }
  return (
    <span className="text-sm text-muted-foreground">
      {"Coverage: complete"}
      {range ?? ", with no boundary dates stated"}
      {partialFigures ? ". A figure drawn here covers only part of the period, so it is an incomplete subtotal." : "."}
    </span>
  );
}
const ChartLegend = ({ series }: { readonly series: readonly PlottedSeries[] }): ReactElement => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
    {series.map((member) => (
      <li key={member.dataKey} className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", member.swatch)} />
        <bdi>{member.label}</bdi>
      </li>
    ))}
  </ul>
);
type ChartTooltipProps = { readonly group: ChartGroup; readonly active?: boolean; readonly label?: string | number };
function ChartTooltip({ group, active, label }: ChartTooltipProps): ReactElement | null {
  if (active !== true || label === undefined) return null;
  const bucket = String(label);
  const entries = group.series.flatMap((member) => {
    const point = member.points.get(bucket);
    return point === undefined ? [] : [{ member, point }];
  });
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <bdi className="font-medium">{bucket}</bdi>
      <ul className="flex flex-col gap-1">
        {entries.map(({ member, point }) => (
          <li key={member.dataKey} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", member.swatch)} />
            <bdi className="text-muted-foreground">{member.label}</bdi>
            <bdi className="tabular-figures ms-auto">{point.text}</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}
function plotMarkOf(kind: ChartKind, member: PlottedSeries, animate: boolean): ReactElement {
  if (kind === "bar") return <Bar key={member.dataKey} dataKey={member.dataKey} name={member.label} fill={member.paint} isAnimationActive={animate} />;
  if (kind === "area") return <Area key={member.dataKey} dataKey={member.dataKey} name={member.label} type="linear" stroke={member.paint} fill={member.paint} fillOpacity={AREA_FILL_OPACITY} dot={true} connectNulls={false} isAnimationActive={animate} />;
  return <Line key={member.dataKey} dataKey={member.dataKey} name={member.label} type="linear" stroke={member.paint} strokeWidth={2} connectNulls={false} isAnimationActive={animate} />;
}
function plottedExtent(group: ChartGroup): { readonly largest: number; readonly smallest: number } {
  let largest = 0;
  let smallest = 0;
  for (const row of group.rows) {
    for (const member of group.series) {
      const value = row[member.dataKey];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value > largest) largest = value;
      if (value < smallest) smallest = value;
    }
  }
  return { largest, smallest };
}
/** The smallest whole ceiling a value axis states that covers one figure — one, two or five times a power of ten — so a target of 5 or 20 lands on a tick the axis draws itself rather than between two. */
function axisCeiling(value: number): number {
  const reached = Math.max(Math.ceil(value), 1);
  const magnitude = 10 ** Math.floor(Math.log10(reached));
  for (const step of [1, 2, 5, 10] as const) {
    const candidate = step * magnitude;
    if (candidate >= reached) return candidate;
  }
  return 10 * magnitude;
}
/** The ceiling a plot that draws a target reaches: the target, the largest figure recorded, or four, whichever is greater, so neither the target nor a count above the constant floor of four is left outside the axis. */
const referenceCeiling = (group: ChartGroup, reference: ChartReference): number => axisCeiling(Math.max(plottedExtent(group).largest, reference.value, REFERENCE_MINIMUM_CEILING));
/** The whole ticks a plot states between zero and the ceiling it reaches, spaced by the smallest step that keeps them countable, so every whole count up to a small ceiling — the target among them — falls on a tick rather than between two. */
function wholeTicks(ceiling: number): readonly number[] {
  const step = axisCeiling(ceiling / AXIS_TICK_INTERVALS);
  const ticks: number[] = [];
  for (let value = 0; value <= ceiling; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== ceiling) ticks.push(ceiling);
  return ticks;
}
/** The text of the widest tick a group's value axis states, which sets the width that axis reserves before the bands are measured. */
function valueAxisTickText(group: ChartGroup, reference: ChartReference | undefined, locale: string): string {
  const { largest, smallest } = plottedExtent(group);
  const reached = reference === undefined ? [largest, smallest] : [referenceCeiling(group, reference)];
  const textOf = (value: number): string => (group.currency === undefined ? String(value) : formatMinor({ currency: group.currency, minorUnits: minorUnitsOf(value) }, "value", locale).text);
  return reached.map(textOf).reduce((longest, text) => (text.length > longest.length ? text : longest), "");
}
/** The width one label occupies at a font size, from the characters it states: the axis' own text is measured before it is drawn, so no plan waits on a render. */
const labelWidth = (text: string, fontSize: number): number => Math.ceil(text.length * fontSize * TICK_CHARACTER_EM);
const bucketLabelsOf = (group: ChartGroup): readonly string[] => group.rows.map((row) => String(row[BUCKET_DATA_KEY] ?? ""));
type CategoryAxisPlan = { readonly angle: number; readonly tickFontSize: number; readonly height: number; readonly extraHeight: number; readonly inset: number };
function categoryAxisPlan(width: number, labels: readonly string[], widestValueTick: string): CategoryAxisPlan {
  const valueAxisWidth = Math.max(MIN_VALUE_AXIS_WIDTH, labelWidth(widestValueTick, AXIS_TEXT.fontSize) + VALUE_AXIS_TICK_GAP);
  const available = width - valueAxisWidth;
  const bandWidth = available / Math.max(labels.length, 1);
  const longestLabel = labels.reduce((longest, label) => (label.length > longest.length ? label : longest), "");
  if (labelWidth(longestLabel, AXIS_TEXT.fontSize) + HORIZONTAL_LABEL_GAP <= bandWidth) return { angle: 0, tickFontSize: AXIS_TEXT.fontSize, height: DEFAULT_CATEGORY_AXIS_HEIGHT, extraHeight: 0, inset: 0 };
  // Every bucket keeps its label, so a band too narrow for an upright one turns it instead, and shrinks it only as far as that band requires.
  const fontSizeFor = (span: number): number => Math.max(MIN_TICK_FONT_SIZE, Math.min(AXIS_TEXT.fontSize, Math.floor(span / Math.max(labels.length, 1) / ROTATED_LABEL_BAND_EM)));
  const insetFor = (fontSize: number): number => Math.ceil(fontSize * ROTATED_LABEL_INSET_EM);
  // The inset narrows every band in turn, so it is taken out of the span the font is chosen for, and the smaller font the plan lands on then needs a smaller inset.
  const tickFontSize = fontSizeFor(available - 2 * insetFor(fontSizeFor(available)));
  const height = Math.max(DEFAULT_CATEGORY_AXIS_HEIGHT, labelWidth(longestLabel, tickFontSize) + ROTATED_LABEL_PADDING);
  return { angle: ROTATED_ANGLE, tickFontSize, height, extraHeight: height - DEFAULT_CATEGORY_AXIS_HEIGHT, inset: insetFor(tickFontSize) };
}
function useFigureWidth(): { readonly ref: RefObject<HTMLDivElement | null>; readonly width: number; readonly reportWidth: (measured: number) => void } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(INITIAL_PLOT_WIDTH);
  // The width the plan is built from is the width the plot is drawn at, because the container measures itself and every report replaces the seeded value.
  const reportWidth = useCallback((measured: number): void => {
    if (measured > 0) setWidth((current) => (Math.abs(current - measured) < 0.5 ? current : measured));
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    // A container's first report of its own size need not reach a render, and a plot left on the seeded width would carry the wrong axis; so the width it already has is read here as well.
    reportWidth(node.getBoundingClientRect().width);
  }, [reportWidth]);
  return { ref, width, reportWidth };
}
type ChartPlotProps = { readonly group: ChartGroup; readonly kind: ChartKind; readonly locale: string; readonly animate: boolean; readonly axis: CategoryAxisPlan; readonly reference: ChartReference | undefined };
function ChartPlot({ group, kind, locale, animate, axis, reference }: ChartPlotProps): ReactElement {
  const currency = group.currency;
  const valueTick = currency === undefined ? undefined : (value: number): string => (Number.isFinite(value) && Number.isInteger(value) ? formatMinor({ currency, minorUnits: minorUnitsOf(value) }, "value", locale).text : "");
  const grid = <CartesianGrid stroke={GRID_PAINT} vertical={false} />;
  const categoryAxis = <XAxis dataKey={BUCKET_DATA_KEY} tick={{ ...AXIS_TEXT, fontSize: axis.tickFontSize }} tickLine={false} axisLine={{ stroke: GRID_PAINT }} interval={0} angle={axis.angle} textAnchor={axis.angle === 0 ? "middle" : "end"} height={axis.height} padding={{ left: axis.inset, right: axis.inset }} />;
  // A stated target gives the value axis a ceiling it reaches and whole ticks it marks the span with; without one the axis states exactly what the figures it draws require, as it always has.
  const ceiling = reference === undefined ? undefined : referenceCeiling(group, reference);
  const valueDomain: [number, number] | undefined = ceiling === undefined ? undefined : [0, ceiling];
  const valueTicks = ceiling === undefined ? undefined : wholeTicks(ceiling);
  const valueAxis = <YAxis width="auto" tick={AXIS_TEXT} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={valueTick} domain={valueDomain} ticks={valueTicks} />;
  const tooltip = <Tooltip content={<ChartTooltip group={group} />} cursor={TOOLTIP_CURSOR} filterNull={false} />;
  const referenceMark = reference === undefined ? null : <ReferenceLine y={reference.value} stroke={REFERENCE_PAINT} strokeDasharray={"4 4"} label={{ value: reference.label, position: "insideTopRight", fill: REFERENCE_PAINT, fontSize: REFERENCE_LABEL_FONT_SIZE }} />;
  const marks = group.series.map((member) => plotMarkOf(kind, member, animate));
  if (kind === "bar") {
    return (
      <BarChart data={group.rows} accessibilityLayer={false}>
        {grid}
        {categoryAxis}
        {valueAxis}
        {tooltip}
        {marks}
        {referenceMark}
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
        {marks}
        {referenceMark}
      </AreaChart>
    );
  }
  return (
    <LineChart data={group.rows} accessibilityLayer={false}>
      {grid}
      {categoryAxis}
      {valueAxis}
      {tooltip}
      {marks}
      {referenceMark}
    </LineChart>
  );
}
const ChartDataTable = ({ table, id }: { readonly table: ChartTable; readonly id: string }): ReactElement => (
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
function everyPointUnavailable(group: ChartGroup): boolean {
  const points = group.series.flatMap((member) => [...member.points.values()]);
  return points.length > 0 && points.every((point) => point.state === "unavailable");
}
function UnplottableNotice({ group }: { readonly group: ChartGroup }): ReactElement {
  const subject = group.currency === undefined ? "This series" : `The ${group.currency} series`;
  if (everyPointUnavailable(group)) return <StateNotice kind="unavailable" title={`${subject} could not be read`} description="Every bucket in this series reports that its source could not be read, so no point is drawn. Nothing is filled in with a zero, and the table below states each bucket's own state." />;
  return <StateNotice kind="empty" title={`${subject} has no figure to draw`} description="Every bucket in this series is a gap, an unknown value or a withheld one, so there is nothing to plot. None is treated as a zero, and the table below names each bucket's own state." />;
}
type ChartGroupFigureProps = { readonly group: ChartGroup; readonly kind: ChartKind; readonly caption: string; readonly height: number; readonly describedBy: string; readonly locale: string; readonly animate: boolean; readonly reference: ChartReference | undefined };
// `jsx-a11y/prefer-tag-over-role` is suppressed for this component and only this component: the marks are SVG the chart library draws, with no `src` an `img` could carry, so the element the rule prefers would leave the plot with no accessible name at all.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
function ChartGroupFigure({ group, kind, caption, height, describedBy, locale, animate, reference }: ChartGroupFigureProps): ReactElement {
  const regionLabel = group.currency === undefined ? caption : `${caption} Figures are in ${group.currency}.`;
  const { ref, width, reportWidth } = useFigureWidth();
  const axis = useMemo(() => categoryAxisPlan(width, bucketLabelsOf(group), valueAxisTickText(group, reference, locale)), [group, reference, locale, width]);
  // The container grows by the room a taller category axis needs, so every bucket gains a label without the plot itself being squeezed to make space for it.
  const plotHeight = height + axis.extraHeight;
  return (
    <div className="flex w-full flex-col gap-2">
      {group.plottable === 0 ? (
        <UnplottableNotice group={group} />
      ) : (
        <>
          {group.currency === undefined ? null : <p className="text-xs font-medium text-muted-foreground">{group.currency}</p>}
          <div role="img" aria-label={regionLabel} aria-describedby={describedBy}>
            <ResponsiveContainer ref={ref} width="100%" height={plotHeight} initialDimension={{ width: INITIAL_PLOT_WIDTH, height: plotHeight }} onResize={reportWidth}>
              <ChartPlot group={group} kind={kind} locale={locale} animate={animate} axis={axis} reference={reference} />
            </ResponsiveContainer>
          </div>
          <ChartLegend series={group.series} />
        </>
      )}
    </div>
  );
}
/** The single chart: a caption that states the subject, the unit, the coverage and the as-of time, one plot per currency, the prose summary that names every bucket the plot does not draw, the data table that states the same figures, and, where the figure holds its figures against a stated target, that target drawn in every plot. */
export function ChartFigure({ title, summary, caption, kind, height = DEFAULT_CHART_HEIGHT, series, units, coverage, asOf, table, locale, reference, className }: ChartFigureProps): ReactElement {
  const baseId = useId();
  const summaryId = `${baseId}-summary`;
  const tableId = `${baseId}-table`;
  const reducedMotion = usePrefersReducedMotion();
  const groups = useMemo(() => groupSeries(series, locale), [series, locale]); // The regeneration is the expensive part of this figure — a map per series, every point re-formatted — so it is derived once per (series, locale) pair rather than once per commit of a parent that re-renders.
  const partialFigures = groups.some((group) => group.series.some((member) => member.incomplete > 0));
  const seriesClauses = groups.flatMap((group, groupIndex) => group.series.map((member, seriesIndex) => ({ member, key: `${member.key}-${String(groupIndex)}-${String(seriesIndex)}`, clauses: summaryClauses(member) })));
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
        <StateNotice kind="empty" title="This chart has no series" description="No series was supplied, so there is nothing to draw. None is invented in its place, and the summary and the table below state what this figure holds." />
      ) : (
        groups.map((group, index) => <ChartGroupFigure key={group.currency ?? `counts-${String(index)}`} group={group} kind={kind} caption={caption} height={height} describedBy={`${summaryId} ${tableId}`} locale={locale} animate={!reducedMotion} reference={reference} />)
      )}
      <div id={summaryId} className="flex flex-col gap-2 text-sm">
        <p>{summary}</p>
        {named.length === 0 ? null : <p className="text-muted-foreground">{SUMMARY_LEAD}</p>}
        {named.map((entry) => (
          <SummaryClauseLine key={entry.key} member={entry.member} clauses={entry.clauses} />
        ))}
      </div>
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
