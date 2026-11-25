"use client";
import { useMemo, type ReactElement } from "react";
import { ChartFigure, type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { MeterBar } from "@/components/ui/meter-bar";
import { cn } from "@/lib/cn";
import type { TargetMeasure, TargetState } from "@/modules/coaching/target";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MEASURE_COPY, TARGET_STATE_COPY } from "../copy";
import { Panel } from "./panel";
export type TargetProgressProps = {
  readonly progress: {
    readonly measure: TargetMeasure;
    readonly quantity: number;
    readonly recorded: ReadonlyArray<{ readonly periodLabel: string; readonly periodStart: CivilDate; readonly periodEnd: CivilDate; readonly value: number | null; readonly valueState: ValueState }>;
    readonly coverage: Coverage;
    readonly asOf: string;
    readonly state: TargetState;
  } | null;
  readonly comparison?: ReadonlyArray<{ readonly measure: TargetMeasure; readonly recorded: number; readonly target: number; readonly valueState: ValueState }>;
  readonly locale: string;
  readonly className?: string;
};
type Progress = NonNullable<TargetProgressProps["progress"]>;
type RecordedPeriod = Progress["recorded"][number];
type BanneredState = Exclude<TargetState, "no-target" | "unavailable">;
const COMPARISON_HEADING = "The four measures";
const TABLE_COLUMNS = [
  { key: "period", label: "Period" },
  { key: "dates", label: "Dates" },
  { key: "recorded", label: "Recorded" },
] as const;
type RecordedReading = { readonly word: string | null; readonly showsFigure: boolean; readonly qualifier: string | null; readonly sentence: string | null };
const RECORDED_READING: Readonly<Record<ValueState, RecordedReading>> = {
  value: { word: null, showsFigure: true, qualifier: null, sentence: null },
  zero: { word: TARGET_STATE_COPY["zero-recorded"].label, showsFigure: true, qualifier: null, sentence: TARGET_STATE_COPY["zero-recorded"].description },
  unknown: { word: "Unknown", showsFigure: false, qualifier: null, sentence: "The activity source did not establish a count for this period, so no figure is stated. Unknown is not a zero." },
  withheld: { word: "Withheld", showsFigure: false, qualifier: null, sentence: "A count exists for this period but is not shown on this surface. Withheld is neither a zero nor an empty period." },
  unavailable: { word: TARGET_STATE_COPY.unavailable.label, showsFigure: false, qualifier: null, sentence: TARGET_STATE_COPY.unavailable.description },
  "incomplete-subtotal": { word: "Incomplete subtotal", showsFigure: true, qualifier: "incomplete subtotal", sentence: COACHING_COPY.targets.partial },
};
const STATE_BADGE_VARIANT: Readonly<Record<BanneredState, "secondary" | "outline">> = { active: "secondary", ended: "secondary", paused: "outline", unplaced: "outline", "zero-recorded": "outline" };
const datesOf = (period: RecordedPeriod): string => `${serialiseCivilDate(period.periodStart)} to ${serialiseCivilDate(period.periodEnd)}`;
function recordedCell(period: RecordedPeriod): string {
  const reading = RECORDED_READING[period.valueState];
  if (!reading.showsFigure || period.value === null) return reading.word ?? "";
  const figure = String(period.value);
  return reading.qualifier === null ? figure : `${figure} (${reading.qualifier})`;
}
function rangeClause(coverage: Coverage): string {
  const { from, to } = coverage;
  if (from !== null && to !== null) return ` from ${from} to ${to}`;
  if (from !== null) return ` from ${from} onwards`;
  if (to !== null) return ` up to ${to}`;
  return "";
}
const coverageSentence = (coverage: Coverage): string => `Coverage is ${coverage.state}${rangeClause(coverage)}.`;
const statesAFigure = (progress: Progress): boolean => progress.recorded.some((period) => RECORDED_READING[period.valueState].showsFigure);
function StateStatement({ state }: { readonly state: BanneredState }): ReactElement {
  const copy = TARGET_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge variant={STATE_BADGE_VARIANT[state]}>{copy.label}</Badge>
      <p className="type-supporting text-balance">{copy.description}</p>
    </div>
  );
}
const NoTargetNotice = (): ReactElement => <StateNotice kind="empty" title={TARGET_STATE_COPY["no-target"].label} description={TARGET_STATE_COPY["no-target"].description} action={{ label: "Set a target", href: "/coaching/targets#target-form" }} headingLevel={2} />;
function ProgressFigure({ progress, locale }: { readonly progress: Progress; readonly locale: string }): ReactElement {
  const measureLabel = MEASURE_COPY[progress.measure].label;
  const measureNoun = measureLabel.toLowerCase();
  const quantity = String(progress.quantity);
  const points = useMemo<readonly ChartPoint[]>(() => progress.recorded.map((period) => ({ bucket: period.periodLabel, value: period.value, state: period.valueState })), [progress]);
  const series = useMemo<readonly ChartSeries[]>(() => [{ key: progress.measure, label: measureLabel, points }], [progress.measure, measureLabel, points]);
  const table: ChartTable = { caption: `${measureLabel} recorded in each period, against a target of ${quantity}.`, columns: TABLE_COLUMNS, rows: progress.recorded.map((period) => ({ period: period.periodLabel, dates: datesOf(period), recorded: recordedCell(period) })) };
  return (
    <ChartFigure
      title={`${measureLabel} recorded against a target of ${quantity}`}
      summary={
        `${MEASURE_COPY[progress.measure].hint} ${coverageSentence(progress.coverage)} ` + `As-of statement: ${progress.asOf}. Each point is the count recorded for one period: a ` + "period is never filled in from its neighbour, and these counts are never turned into a percentage, a completion rate or a running total."
      }
      caption={`Bar chart of ${measureNoun} recorded per period${rangeClause(progress.coverage)}, ` + "with the same periods and figures in the data table below."}
      kind="bar"
      series={series}
      units={`Units: whole ${measureNoun}, counted from activity recorded inside each period. ` + "Nothing here is an amount of money."}
      coverage={progress.coverage}
      asOf={progress.asOf}
      table={table}
      locale={locale}
      reference={{ value: progress.quantity, label: `Target ${quantity}` }}
    />
  );
}
const ComparisonRegion = ({ rows }: { readonly rows: ReadonlyArray<NonNullable<TargetProgressProps["comparison"]>[number]> }): ReactElement => (
  <Panel headingLevel={2} title={COMPARISON_HEADING} description="Each measure is counted on its own from the activity you recorded, so a conversation inside a call is counted as a conversation and the call remains one call." contentClassName="flex min-w-0 flex-col gap-4">
    <ul aria-label={COMPARISON_HEADING} className="grid min-w-0 gap-3 sm:grid-cols-2">
      {rows.map((row, index) => {
        const reading = RECORDED_READING[row.valueState];
        const meterMax = Math.max(row.target, 1);
        return (
          <li key={`${row.measure}-${String(index)}`} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/80 bg-surface-subtle p-4 shadow-xs">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{MEASURE_COPY[row.measure].label}</p>
              {reading.word === null ? null : <Badge variant="outline">{reading.word}</Badge>}
            </div>
            <p className="type-body">
              {reading.showsFigure ? (
                <>
                  Recorded <bdi className="tabular-figures font-semibold">{String(row.recorded)}</bdi> against a target of <bdi className="tabular-figures font-semibold">{String(row.target)}</bdi>.
                </>
              ) : (
                <>
                  No count is stated for this measure against a target of <bdi className="tabular-figures font-semibold">{String(row.target)}</bdi>.
                </>
              )}
            </p>
            {reading.showsFigure && row.target > 0 ? (
              <MeterBar label={MEASURE_COPY[row.measure].label} min={0} max={meterMax} value={Math.min(meterMax, Math.max(0, row.recorded))} valueText={`${String(row.recorded)} against a target of ${String(row.target)}`} tone={row.recorded >= row.target ? "positive" : "primary"} showHeader={false} />
            ) : null}
            <p className="type-supporting text-balance">{MEASURE_COPY[row.measure].hint}</p>
            {reading.sentence === null ? null : <p className="type-supporting text-balance">{reading.sentence}</p>}
          </li>
        );
      })}
    </ul>
    <p className="type-supporting text-balance">{"These four are stated separately and are never added together, ranked or turned into a score: none of them measures effort, and no worker is compared with another."}</p>
  </Panel>
);
export default function TargetProgress({ progress, comparison, locale, className }: TargetProgressProps): ReactElement {
  const comparisonRows = comparison ?? [];
  const comparisonRegion = comparisonRows.length === 0 ? null : <ComparisonRegion rows={comparisonRows} />;
  if (progress === null || progress.state === "no-target") {
    return (
      <section className={cn("flex min-w-0 flex-col gap-4", className)} data-interface-locale={locale}>
        <NoTargetNotice />
        {comparisonRegion}
      </section>
    );
  }
  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)} data-interface-locale={locale}>
      {progress.state === "unavailable" ? <StateNotice kind="unavailable" title={TARGET_STATE_COPY.unavailable.label} description={TARGET_STATE_COPY.unavailable.description} headingLevel={2} /> : <StateStatement state={progress.state} />}
      {progress.state !== "unavailable" || statesAFigure(progress) ? <ProgressFigure progress={progress} locale={locale} /> : null}
      {comparisonRegion}
    </section>
  );
}
