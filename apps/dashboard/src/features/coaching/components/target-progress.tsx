"use client";

/**
 * One target's recorded progress, drawn through the application's single chart-with-alternative
 * pattern: `components/chart-figure` owns the caption, the prose summary and the data table, so a
 * period the read could not state a figure for reaches it as `null` and never as a zero, and nothing
 * here interpolates between periods.
 *
 * The four canonical measures are listed beside each other with their own figures and are never
 * combined: five calls that hold two conversations stay five calls and two conversations, and no
 * percentage, completion rate, delta, running total or effort score is computed anywhere in this
 * file — the counts are the envelope's and the chart figure is the only formatter.
 */

import type { ReactElement } from "react";

import {
  ChartFigure,
  type ChartPoint,
  type ChartSeries,
  type ChartTable,
} from "@/components/chart-figure";
import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { TargetMeasure, TargetState } from "@/modules/coaching/target";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";

import { COACHING_COPY, MEASURE_COPY, TARGET_STATE_COPY } from "../copy";

/**
 * Props of {@link TargetProgress}. Every figure is supplied by the read that produced the target;
 * nothing here is derived, aggregated or re-dated.
 */
export interface TargetProgressProps {
  /**
   * The target's progress for the period the read resolved, or `null` when no target exists. A
   * recorded period carries the count the read stated for it and the state that says what kind of
   * value that is: `value: null` with a state of `unknown`, `withheld` or `unavailable` is a period
   * with no figure, which is never rendered as a zero.
   */
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

  /**
   * The four measures with their own recorded figure and their own target quantity, shown separately
   * and never summed. Omitted when the envelope supplies only the one measure's series, because the
   * other three are then not known and are never synthesised here.
   */
  readonly comparison?: ReadonlyArray<{
    readonly measure: TargetMeasure;
    readonly recorded: number;
    readonly target: number;
    readonly valueState: ValueState;
  }>;

  /** The interface locale the page resolved, recorded on the region and never applied to a figure. */
  readonly locale: string;

  /** Layout classes for the block this surface occupies. Never a colour, radius or shadow. */
  readonly className?: string;
}

/** One target's progress, once the caller has supplied it. */
type Progress = NonNullable<TargetProgressProps["progress"]>;

/** One period of that progress. */
type RecordedPeriod = Progress["recorded"][number];

/** One row of the four-measure comparison. */
type ComparisonRow = NonNullable<TargetProgressProps["comparison"]>[number];

/** The states that carry a state line above the figures; `no-target` and `unavailable` differ. */
type BanneredState = Exclude<TargetState, "no-target" | "unavailable">;

// ---------------------------------------------------------------------------------------------
// Where the surface points, and what it says
// ---------------------------------------------------------------------------------------------

/** The targets surface's own form area, the first action of a surface with no target at all. */
const TARGET_FORM_HREF = "/coaching/targets#target-form";

/** The one control the `no-target` state offers: create a target rather than read a chart of zeros. */
const SET_TARGET_LABEL = "Set a target";

/** The heading of the four-measure region. */
const COMPARISON_HEADING = "The four measures";

/** What the four-measure region is for, stated once above its rows. */
const COMPARISON_DESCRIPTION =
  "Each measure is counted on its own from the activity you recorded, so a conversation inside a " +
  "call is counted as a conversation and the call remains one call.";

/**
 * The sentence that forbids reading the four figures as one score.
 *
 * A sum, a ratio or a ranking of these four would be an effort score this release does not compute,
 * and a comparison between workers would need an authority the release does not hold.
 */
const NO_SUM_NOTE =
  "These four are stated separately and are never added together, ranked or turned into a score: " +
  "none of them measures effort, and no worker is compared with another.";

/** The alternative table's columns, in reading order. */
const TABLE_COLUMNS = [
  { key: "period", label: "Period" },
  { key: "dates", label: "Dates" },
  { key: "recorded", label: "Recorded" },
] as const;

// ---------------------------------------------------------------------------------------------
// How one recorded figure is worded
// ---------------------------------------------------------------------------------------------

/**
 * What one value state means on this surface: the word that stands for it, whether a figure may be
 * shown at all, and the sentence that keeps it apart from a zero and from the other absences.
 *
 * `zero` is the one state a reader is most likely to misread as a verdict, so it borrows the family's
 * own `zero-recorded` wording rather than calling itself "zero". `unknown`, `withheld` and
 * `unavailable` never show a figure: an absence drawn as `0` would misstate a count and would let a
 * withheld value be inferred by subtraction.
 */
interface RecordedReading {
  /** The word for a state that is not a plain figure; `null` when the figure states itself. */
  readonly word: string | null;
  /** Whether a figure may be shown for this state. */
  readonly showsFigure: boolean;
  /** What the table appends to a figure it does show, or `null` when nothing applies. */
  readonly qualifier: string | null;
  /** The sentence that keeps this state distinct from a zero and from every other absence. */
  readonly sentence: string | null;
}

/** One entry per value state the envelope can record, worded once for the chart, the list and the table. */
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
    sentence:
      "The activity source did not establish a count for this period, so no figure is stated. " +
      "Unknown is not a zero.",
  },
  withheld: {
    word: "Withheld",
    showsFigure: false,
    qualifier: null,
    sentence:
      "A count exists for this period but is not shown on this surface. Withheld is neither a zero " +
      "nor an empty period.",
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

/**
 * The tone of each state line's badge.
 *
 * The badge only reinforces the word beside it, so no state depends on a colour: a target that is
 * live or has ended is stated with the filled secondary pair, and a target that is held back — paused,
 * unplaced, or counting nothing yet — with the outlined pair.
 */
const STATE_BADGE_VARIANT: Readonly<Record<BanneredState, "secondary" | "outline">> = {
  active: "secondary",
  ended: "secondary",
  paused: "outline",
  unplaced: "outline",
  "zero-recorded": "outline",
};

// ---------------------------------------------------------------------------------------------
// What the figure states
// ---------------------------------------------------------------------------------------------

/** The civil dates one period covers, in their exact stored form rather than a re-rendered day. */
function datesOf(period: RecordedPeriod): string {
  return `${serialiseCivilDate(period.periodStart)} to ${serialiseCivilDate(period.periodEnd)}`;
}

/** What the table states for one period: its figure, or the word that stands where no figure may be. */
function recordedCell(period: RecordedPeriod): string {
  const reading = RECORDED_READING[period.valueState];
  if (!reading.showsFigure || period.value === null) {
    return reading.word ?? "";
  }
  const figure = String(period.value);
  return reading.qualifier === null ? figure : `${figure} (${reading.qualifier})`;
}

/** The range a read covers, as a clause a sentence can carry. */
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

/** The coverage the read recorded, stated as its own sentence so the summary carries it too. */
function coverageSentence(coverage: Coverage): string {
  return `Coverage is ${coverage.state}${rangeClause(coverage)}.`;
}

/** Whether at least one recorded period may state a figure, which is what keeps a chart worth drawing. */
function statesAFigure(progress: Progress): boolean {
  return progress.recorded.some((period) => RECORDED_READING[period.valueState].showsFigure);
}

// ---------------------------------------------------------------------------------------------
// The state a reader sees before the figures
// ---------------------------------------------------------------------------------------------

/**
 * The state a target is in, stated in the family's own words above the figures it does not change.
 *
 * A paused target and an ended one keep the history they recorded, so the sentence sits above the
 * figure instead of replacing it: hiding a recorded count because the plan stopped would lose the only
 * evidence the worker has of it. `no-target` and `unavailable` are deliberately not stated here — the
 * first offers the first action, and the second is an outage notice that must not be mistaken for a
 * quietly zeroed chart.
 */
function StateStatement({ state }: { readonly state: BanneredState }): ReactElement {
  const copy = TARGET_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge variant={STATE_BADGE_VARIANT[state]}>{copy.label}</Badge>
      <p className="text-sm text-balance text-muted-foreground">{copy.description}</p>
    </div>
  );
}

/**
 * What this surface shows when there is no target at all: the family's `no-target` words and the one
 * action that makes the surface useful again — create a target.
 *
 * No chart is drawn for this state. A target that does not exist has recorded nothing, and a bar at
 * zero for every period would state a count the read never established; the notice's link is the
 * form area of the targets surface, rendered by the state notice as real navigation.
 */
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

// ---------------------------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------------------------

/**
 * The figure itself: one count series for this target's measure, drawn as bars over the periods the
 * read resolved, with the same periods in `ChartFigure`'s data table.
 *
 * A period with no figure keeps `value: null`, so the chart leaves the bucket undrawn rather than
 * plotting a zero, and the value state rides along untouched so the figure's own summary can name each
 * undrawn bucket as `unknown`, `withheld` or `unavailable` instead of merging them. The series states
 * no currency: these are counts of activity, not amounts of money, so the money module's exponent and
 * formatter do not apply and the chart renders each point as a whole number.
 */
function ProgressFigure({
  progress,
  locale,
}: {
  readonly progress: Progress;
  readonly locale: string;
}): ReactElement {
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
      caption={
        `Bar chart of ${measureNoun} recorded per period${rangeClause(progress.coverage)}, ` +
        "with the same periods and figures in the data table below."
      }
      kind="bar"
      series={series}
      units={
        `Units: whole ${measureNoun}, counted from activity recorded inside each period. ` +
        "Nothing here is an amount of money."
      }
      coverage={progress.coverage}
      asOf={progress.asOf}
      table={table}
      locale={locale}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// The four measures, side by side
// ---------------------------------------------------------------------------------------------

/**
 * The four canonical measures, each with its own recorded figure and its own target quantity.
 *
 * Four separate rows are the whole point: a conversation that happened inside a call is counted as a
 * conversation and the call is still one call, so the two figures are stated unchanged and nothing
 * subtracts one from the other. A row whose state carries no figure states its word and no number, so
 * an outage can never appear as a zero beside a target.
 */
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
                      Recorded <bdi className="tabular-figures">{String(row.recorded)}</bdi> against
                      a target of <bdi className="tabular-figures">{String(row.target)}</bdi>.
                    </>
                  ) : (
                    <>
                      No count is stated for this measure against a target of{" "}
                      <bdi className="tabular-figures">{String(row.target)}</bdi>.
                    </>
                  )}
                </p>
                <p className="text-sm text-balance text-muted-foreground">
                  {MEASURE_COPY[row.measure].hint}
                </p>
                {reading.sentence === null ? null : (
                  <p className="text-sm text-balance text-muted-foreground">{reading.sentence}</p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-balance text-muted-foreground">{NO_SUM_NOTE}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/**
 * A target's recorded progress: the state word above the figures it does not change, the chart figure
 * with its caption, prose summary and data-table alternative, and the four measures stated side by
 * side with their own figures.
 *
 * Renders `no-target` as the first action rather than a chart of zeros, `unavailable` as an outage
 * notice with any figures the read still recorded beneath it, and `paused`, `ended`, `unplaced`,
 * `zero-recorded` and `active` as their own words above retained history. Holds no state, reads no
 * clock and computes no percentage, total or delta.
 */
export default function TargetProgress({
  progress,
  comparison,
  locale,
  className,
}: TargetProgressProps): ReactElement {
  const comparisonRows = comparison ?? [];
  const comparisonRegion =
    comparisonRows.length === 0 ? null : <ComparisonRegion rows={comparisonRows} />;

  // A target with no plan at all, and a progress read that stated none, are the same outcome to the
  // reader: the family's `no-target` words and a way to set one.
  if (progress === null || progress.state === "no-target") {
    return (
      <section
        className={cn("flex min-w-0 flex-col gap-4", className)}
        data-interface-locale={locale}
      >
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
    <section
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-interface-locale={locale}
    >
      {progress.state === "unavailable" ? (
        <StateNotice
          kind="unavailable"
          title={TARGET_STATE_COPY.unavailable.label}
          description={TARGET_STATE_COPY.unavailable.description}
          headingLevel={2}
        />
      ) : (
        <StateStatement state={progress.state} />
      )}
      {showsFigure ? <ProgressFigure progress={progress} locale={locale} /> : null}
      {comparisonRegion}
    </section>
  );
}
