"use client";
import { useId, useMemo, useSyncExternalStore, type ReactElement } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import { VALUE_STATE_WORDS } from "@/components/status-badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
/** The three shapes this release draws, listed once so the closed set has a runtime form as well as a type. */
export type ChartKind = "bar" | "line" | "area";
export type ChartPoint = { readonly bucket: string; readonly value: number | null; readonly state: ValueState; readonly gap?: boolean };
export type ChartSeries = { readonly key: string; readonly label: string; readonly currency?: string; readonly points: readonly ChartPoint[] };
export type ChartTableColumn = { readonly key: string; readonly label: string };
export type ChartTable = { readonly caption: string; readonly columns: readonly ChartTableColumn[]; readonly rows: readonly Readonly<Record<string, string>>[] };
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
const pointText = (currency: string | undefined, point: ChartPoint, locale: string): string => (currency === undefined ? countText(point) : formatMinor(amountOf(currency, point), point.state, locale).text);
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
type ChartPlotProps = { readonly group: ChartGroup; readonly kind: ChartKind; readonly locale: string; readonly animate: boolean };
function ChartPlot({ group, kind, locale, animate }: ChartPlotProps): ReactElement {
  const currency = group.currency;
  const valueTick = currency === undefined ? undefined : (value: number): string => (Number.isFinite(value) && Number.isInteger(value) ? formatMinor({ currency, minorUnits: minorUnitsOf(value) }, "value", locale).text : "");
  const grid = <CartesianGrid stroke={GRID_PAINT} vertical={false} />;
  const categoryAxis = <XAxis dataKey={BUCKET_DATA_KEY} tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID_PAINT }} interval="preserveStartEnd" minTickGap={8} />;
  const valueAxis = <YAxis width="auto" tick={AXIS_TEXT} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={valueTick} />;
  const tooltip = <Tooltip content={<ChartTooltip group={group} />} cursor={TOOLTIP_CURSOR} filterNull={false} />;
  const marks = group.series.map((member) => plotMarkOf(kind, member, animate));
  if (kind === "bar") {
    return (
      <BarChart data={group.rows} accessibilityLayer={false}>
        {grid}
        {categoryAxis}
        {valueAxis}
        {tooltip}
        {marks}
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
type ChartGroupFigureProps = { readonly group: ChartGroup; readonly kind: ChartKind; readonly caption: string; readonly height: number; readonly describedBy: string; readonly locale: string; readonly animate: boolean };
// `jsx-a11y/prefer-tag-over-role` is suppressed for this component and only this component: the marks are SVG the chart library draws, with no `src` an `img` could carry, so the element the rule prefers would leave the plot with no accessible name at all.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
function ChartGroupFigure({ group, kind, caption, height, describedBy, locale, animate }: ChartGroupFigureProps): ReactElement {
  const regionLabel = group.currency === undefined ? caption : `${caption} Figures are in ${group.currency}.`;
  return (
    <div className="flex w-full flex-col gap-2">
      {group.plottable === 0 ? (
        <UnplottableNotice group={group} />
      ) : (
        <>
          {group.currency === undefined ? null : <p className="text-xs font-medium text-muted-foreground">{group.currency}</p>}
          <div role="img" aria-label={regionLabel} aria-describedby={describedBy}>
            <ResponsiveContainer width="100%" height={height} initialDimension={{ width: INITIAL_PLOT_WIDTH, height }}>
              <ChartPlot group={group} kind={kind} locale={locale} animate={animate} />
            </ResponsiveContainer>
          </div>
          <ChartLegend series={group.series} />
        </>
      )}
    </div>
  );
}
/** The single chart: a caption that states the subject, the unit, the coverage and the as-of time, one plot per currency, the prose summary that names every bucket the plot does not draw, and. */
export function ChartFigure({ title, summary, caption, kind, height = DEFAULT_CHART_HEIGHT, series, units, coverage, asOf, table, locale, className }: ChartFigureProps): ReactElement {
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
        groups.map((group, index) => <ChartGroupFigure key={group.currency ?? `counts-${String(index)}`} group={group} kind={kind} caption={caption} height={height} describedBy={`${summaryId} ${tableId}`} locale={locale} animate={!reducedMotion} />)
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
