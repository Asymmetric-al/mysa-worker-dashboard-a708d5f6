"use client";
/**
 * One target's recorded progress, drawn through the application's single chart-with-alternative
 * pattern: `components/chart-figure` owns the caption, the prose summary and the data table, so a
 * period the read could not state a figure for reaches it as `null` and never as a zero, and nothing
 * here interpolates between periods.
 */
import type { ReactElement } from "react";
import { ChartFigure, type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { TargetMeasure, TargetState } from "@/modules/coaching/target";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MEASURE_COPY, TARGET_STATE_COPY } from "../copy";
/** Props of {@link TargetProgress}. */
export interface TargetProgressProps {
  readonly progress: {
    readonly measure: TargetMeasure;
    readonly quantity: number;
    readonly recorded: ReadonlyArray<{
      readonly periodLabel: string;
      readonly periodStart: CivilDate;
      readonly periodEnd: CivilDate;
      readonly value: number | null;
      readonly valueState: ValueState;
    }>;
    readonly coverage: Coverage;
    readonly asOf: string;
    readonly state: TargetState;
  } | null;
  readonly comparison?: ReadonlyArray<{
    readonly measure: TargetMeasure;
    readonly recorded: number;
    readonly target: number;
    readonly valueState: ValueState;
  }>;
  readonly locale: string;
  readonly className?: string;
}
type Progress = NonNullable<TargetProgressProps["progress"]>;

type RecordedPeriod = Progress["recorded"][number];

type ComparisonRow = NonNullable<TargetProgressProps["comparison"]>[number];

type BanneredState = Exclude<TargetState, "no-target" | "unavailable">;
// Where the surface points, and what it says
const TARGET_FORM_HREF = "/coaching/targets#target-form";

const SET_TARGET_LABEL = "Set a target";

const COMPARISON_HEADING = "The four measures";

const COMPARISON_DESCRIPTION = "Each measure is counted on its own from the activity you recorded, so a conversation inside a " + "call is counted as a conversation and the call remains one call.";

const NO_SUM_NOTE = "These four are stated separately and are never added together, ranked or turned into a score: " + "none of them measures effort, and no worker is compared with another.";

const TABLE_COLUMNS = [
  { key: "period", label: "Period" },
  { key: "dates", label: "Dates" },
  { key: "recorded", label: "Recorded" },
] as const;
// How one recorded figure is worded
interface RecordedReading {
  readonly word: string | null;
  readonly showsFigure: boolean;
  readonly qualifier: string | null;
  readonly sentence: string | null;
}
const RECORDED_READING: Readonly<Record<ValueState, RecordedReading>> = {
  value: { word: null, showsFigure: true, qualifier: null, sentence: null },
  zero: {
    word: TARGET_STATE_COPY["zero-recorded"].label,
    showsFigure: true,
    qualifier: null,
    sentence: TARGET_STATE_COPY["zero-recorded"].description,
  },
  unknown: {
    word: "Unknown",
    showsFigure: false,
    qualifier: null,
    sentence: "The activity source did not establish a count for this period, so no figure is stated. " + "Unknown is not a zero.",
  },
  withheld: {
    word: "Withheld",
    showsFigure: false,
    qualifier: null,
    sentence: "A count exists for this period but is not shown on this surface. Withheld is neither a zero " + "nor an empty period.",
  },
  unavailable: {
    word: TARGET_STATE_COPY.unavailable.label,
    showsFigure: false,
    qualifier: null,
    sentence: TARGET_STATE_COPY.unavailable.description,
  },
  "incomplete-subtotal": {
    word: "Incomplete subtotal",
    showsFigure: true,
    qualifier: "incomplete subtotal",
    sentence: COACHING_COPY.targets.partial,
  },
};
const STATE_BADGE_VARIANT: Readonly<Record<BanneredState, "secondary" | "outline">> = {
  active: "secondary",
  ended: "secondary",
  paused: "outline",
  unplaced: "outline",
  "zero-recorded": "outline",
};
// What the figure states
function datesOf(period: RecordedPeriod): string {
  return `${serialiseCivilDate(period.periodStart)} to ${serialiseCivilDate(period.periodEnd)}`;
}
function recordedCell(period: RecordedPeriod): string {
  const reading = RECORDED_READING[period.valueState];
  if (!reading.showsFigure || period.value === null) {
    return reading.word ?? "";
  }
  const figure = String(period.value);
  return reading.qualifier === null ? figure : `${figure} (${reading.qualifier})`;
}
function rangeClause(coverage: Coverage): string {
  const { from, to } = coverage;
  if (from !== null && to !== null) {
    return ` from ${from} to ${to}`;
  }
  if (from !== null) {
    return ` from ${from} onwards`;
  }
  if (to !== null) {
    return ` up to ${to}`;
  }
  return "";
}
function coverageSentence(coverage: Coverage): string {
  return `Coverage is ${coverage.state}${rangeClause(coverage)}.`;
}
function statesAFigure(progress: Progress): boolean {
  return progress.recorded.some((period) => RECORDED_READING[period.valueState].showsFigure);
}
// The state a reader sees before the figures
function StateStatement({ state }: { readonly state: BanneredState }): ReactElement {
  const copy = TARGET_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge variant={STATE_BADGE_VARIANT[state]}>{copy.label}</Badge>
      <p className="text-sm text-balance text-muted-foreground">{copy.description}</p>
    </div>
  );
}
function NoTargetNotice(): ReactElement {
  return (
    <StateNotice
      kind="empty"
      title={TARGET_STATE_COPY["no-target"].label}
      description={TARGET_STATE_COPY["no-target"].description}
      action={{ label: SET_TARGET_LABEL, href: TARGET_FORM_HREF }}
      headingLevel={2}
    />
  );
}
// The figure
function ProgressFigure({ progress, locale }: { readonly progress: Progress; readonly locale: string }): ReactElement {
  const measureLabel = MEASURE_COPY[progress.measure].label;
  const measureNoun = measureLabel.toLowerCase();
  const quantity = String(progress.quantity);
  const points: readonly ChartPoint[] = progress.recorded.map((period) => ({
    bucket: period.periodLabel,
    value: period.value,
    state: period.valueState,
  }));
  const series: readonly ChartSeries[] = [{ key: progress.measure, label: measureLabel, points }];
  const table: ChartTable = {
    caption: `${measureLabel} recorded in each period, against a target of ${quantity}.`,
    columns: TABLE_COLUMNS,
    rows: progress.recorded.map((period) => ({
      period: period.periodLabel,
      dates: datesOf(period),
      recorded: recordedCell(period),
    })),
  };
  return (
    <ChartFigure
      title={`${measureLabel} recorded against a target of ${quantity}`}
      summary={
        `${MEASURE_COPY[progress.measure].hint} ${coverageSentence(progress.coverage)} ` +
        `As-of statement: ${progress.asOf}. Each point is the count recorded for one period: a ` +
        "period is never filled in from its neighbour, and these counts are never turned into a " +
        "percentage, a completion rate or a running total."
      }
      caption={`Bar chart of ${measureNoun} recorded per period${rangeClause(progress.coverage)}, ` + "with the same periods and figures in the data table below."}
      kind="bar"
      series={series}
      units={`Units: whole ${measureNoun}, counted from activity recorded inside each period. ` + "Nothing here is an amount of money."}
      coverage={progress.coverage}
      asOf={progress.asOf}
      table={table}
      locale={locale}
    />
  );
}
// The four measures, side by side
function ComparisonRegion({ rows }: { readonly rows: ReadonlyArray<ComparisonRow> }): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{COMPARISON_HEADING}</h2>
        </CardTitle>
        <CardDescription>{COMPARISON_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <ul aria-label={COMPARISON_HEADING} className="flex min-w-0 flex-col gap-3">
          {rows.map((row, index) => {
            const reading = RECORDED_READING[row.valueState];
            return (
              <li key={`${row.measure}-${String(index)}`} className="flex min-w-0 flex-col gap-1">
                {index === 0 ? null : <Separator />}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{MEASURE_COPY[row.measure].label}</p>
                  {reading.word === null ? null : <Badge variant="outline">{reading.word}</Badge>}
                </div>
                <p className="text-sm">
                  {reading.showsFigure ? (
                    <>
                      Recorded <bdi className="tabular-figures">{String(row.recorded)}</bdi> against a target of <bdi className="tabular-figures">{String(row.target)}</bdi>.
                    </>
                  ) : (
                    <>
                      No count is stated for this measure against a target of <bdi className="tabular-figures">{String(row.target)}</bdi>.
                    </>
                  )}
                </p>
                <p className="text-sm text-balance text-muted-foreground">{MEASURE_COPY[row.measure].hint}</p>
                {reading.sentence === null ? null : <p className="text-sm text-balance text-muted-foreground">{reading.sentence}</p>}
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-balance text-muted-foreground">{NO_SUM_NOTE}</p>
      </CardContent>
    </Card>
  );
}
// The surface
/** A target's recorded progress: the state word above the figures it does not change, the chart figure with its caption, prose summary and data-table alternative, and the four measures stated. */
export default function TargetProgress({ progress, comparison, locale, className }: TargetProgressProps): ReactElement {
  const comparisonRows = comparison ?? [];
  const comparisonRegion = comparisonRows.length === 0 ? null : <ComparisonRegion rows={comparisonRows} />;
  // A target with no plan at all, and a progress read that stated none, are the same outcome to the
  // reader: the family's `no-target` words and a way to set one.
  if (progress === null || progress.state === "no-target") {
    return (
      <section className={cn("flex min-w-0 flex-col gap-4", className)} data-interface-locale={locale}>
        <NoTargetNotice />
        {comparisonRegion}
      </section>
    );
  }
  // The outage notice replaces the state word rather than sitting beside it, and the figure is kept
  // only when the read still recorded something to draw: an outage with nothing behind it must not be
  // followed by a second notice over an empty plot.
  const showsFigure = progress.state !== "unavailable" || statesAFigure(progress);
  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)} data-interface-locale={locale}>
      {progress.state === "unavailable" ? (
        <StateNotice kind="unavailable" title={TARGET_STATE_COPY.unavailable.label} description={TARGET_STATE_COPY.unavailable.description} headingLevel={2} />
      ) : (
        <StateStatement state={progress.state} />
      )}
      {showsFigure ? <ProgressFigure progress={progress} locale={locale} /> : null}
      {comparisonRegion}
    </section>
  );
}
