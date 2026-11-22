"use client";
/**
 * The worker's targets surface: the one target composer, the one version history and the one progress chart, composed
 * over the envelope the `/coaching/targets` route and `/api/coaching/targets` both read.
 *
 * **Why this is a Client Component.** Every date the family's components state is a `CivilDate`, and a Server
 * Component cannot hand one across the boundary: React has no representation for a `Temporal.PlainDate`, so the value
 * arrives as its own JSON text and the one calendar rule that writes a civil date then fails on a string. The route
 * above therefore passes the read's envelope exactly as the read stated it — every date in it is the stored
 * `YYYY-MM-DD` text — and this surface re-hydrates each date through `modules/time/civil` before a component sees it.
 *
 * **What it does not do.** It derives no count, period boundary, percentage, deadline, permission or instant: the
 * measure, quantity, state, count, coverage, as-of instant, revision and scope below are the read's own members,
 * restated. `valueStates` stays the source of a value's state, so a genuine zero, an unknown, a withheld value and an
 * unavailable source keep their separate renderings, and a closed period keeps the version it was measured against.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, type ReactElement } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import type { ValueState } from "@/modules/data-service/envelope";
import { parseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MEASURE_COPY } from "../copy";
import TargetForm, { type TargetView } from "./target-form";
import TargetHistory, { type TargetHistoryProps } from "./target-history";
import TargetProgress, { type TargetProgressProps } from "./target-progress";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read and from the components rather than restated
// ---------------------------------------------------------------------------------------------

/** The targets read's envelope, derived from the read itself so a member the service adds or renames fails to compile here. */
type TargetsEnvelope = Extract<Awaited<ReturnType<typeof reads.coaching.readTargets>>, { readonly kind: "envelope" }>["envelope"];

/** One target as the read states it, with its versions and its measured periods. */
type WireTarget = TargetsEnvelope["data"]["targets"][number];

/** One measured period of one target: the current period first, then the one before it. */
type WirePeriod = WireTarget["periods"][number];

/** The state a closed period may render, taken from the history component's own contract. */
type ClosedPeriodState = TargetHistoryProps["closedPeriods"][number]["state"];

/** The progress the one chart is drawn from, taken from the progress component's own contract. */
type ProgressView = NonNullable<TargetProgressProps["progress"]>;

/** One recorded period as the progress component reads it. */
type RecordedPeriodView = ProgressView["recorded"][number];

/** One row of the four-measure comparison, taken from the progress component's own contract. */
type ComparisonRowView = NonNullable<TargetProgressProps["comparison"]>[number];

/** Props of {@link TargetsSurface}. */
export type TargetsSurfaceProps = {
  /** The envelope `readTargets` answered with, unchanged: its dates are still the stored civil-date text. */
  readonly envelope: TargetsEnvelope;
  /** The interface locale the components record beside their facts; it reformats no civil date. */
  readonly locale: string;
  /** The target this address named, or `undefined` where it named none this read stated. */
  readonly selectedTargetId?: string;
  readonly className?: string;
};

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The target list's address, which is this page itself: choosing a target is a choice of which of the worker's own
 * targets to read, so it narrows nothing the read was asked for and states no second source of truth.
 */
const TARGETS_HREF = "/coaching/targets";
const TARGET_PARAM = "target";
const PICKER_CLASS = "h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-start";

/**
 * The identity a closed period carries when the read could not bind it to a version. It matches no version's
 * revision, so the history states that the version is not in the history it can show rather than naming the plan that
 * happens to be current.
 */
const NO_BOUND_VERSION = "";

/**
 * A closed period's state, in the history's own vocabulary. A period that closed with activity counted is `recorded`
 * whatever placed the target on Home, because placement changes only what the worker sees on Home; `no-target` is
 * unreachable for a period of a target that exists, and states no figure rather than borrowing one.
 */
const CLOSED_PERIOD_STATE: Readonly<Record<WirePeriod["state"], ClosedPeriodState>> = { active: "recorded", unplaced: "recorded", "zero-recorded": "zero-recorded", paused: "paused", ended: "ended", unavailable: "unavailable", "no-target": "unavailable" };

// ---------------------------------------------------------------------------------------------
// The read's stored text, re-hydrated as the calendar day it stands for
// ---------------------------------------------------------------------------------------------

/**
 * The calendar day a stored civil date stands for. The store validates every one of these as an ISO calendar date
 * before a read can carry it, so a refusal here means the envelope contradicts its own schema: it is thrown rather
 * than rendered as a date the source never stated, and the route segment's error boundary owns it.
 */
function civilDateOf(stored: string): CivilDate {
  const parsed = parseCivilDate(stored);
  if (parsed.status !== "parsed") {
    throw new Error(`The targets read stated "${stored}" as a calendar date, and it is not one.`);
  }
  return parsed.date;
}

// ---------------------------------------------------------------------------------------------
// The envelope, as each component declares its props
// ---------------------------------------------------------------------------------------------

/** One target as the composer reads it: the plan in force, its private label, its Home placement and its state. */
function targetViewOf(target: WireTarget): TargetView {
  return {
    targetId: target.targetId,
    measure: target.measure,
    quantity: target.quantity,
    period: target.period.kind,
    calendarStart: civilDateOf(target.calendarStart),
    periodEnd: target.period.to === null ? null : civilDateOf(target.period.to),
    privateLabel: target.privateLabel,
    homePlacement: target.homePlacement === "placed",
    state: target.state,
  };
}

/** Every version the read stated, with the one in force from its first day onwards still open. */
function versionsViewOf(target: WireTarget): TargetHistoryProps["versions"] {
  return target.versions.map((version) => ({
    revisionId: version.revisionId,
    effectiveFrom: civilDateOf(version.effectiveFrom),
    effectiveTo: version.effectiveTo === null ? null : civilDateOf(version.effectiveTo),
    measure: version.measure,
    quantity: version.quantity,
    calendarStart: civilDateOf(version.calendarStart),
    state: version.effectiveTo === null ? "open" : "closed",
  }));
}

/**
 * The periods whose calendar has completed, each with the version it was measured against. The read states the
 * current period first, so every period after it has closed.
 */
function closedPeriodsViewOf(target: WireTarget): TargetHistoryProps["closedPeriods"] {
  return target.periods.slice(1).map((period) => ({ periodStart: civilDateOf(period.start), periodEnd: civilDateOf(period.endInclusive), measuredAgainstRevisionId: period.version === null ? NO_BOUND_VERSION : period.version.revisionId, recorded: period.count ?? 0, state: CLOSED_PERIOD_STATE[period.state] }));
}

/**
 * The state the read recorded for one period's count: the envelope's own derived state where it states one — the only
 * place a surface learns that a number is not a number — and the count's recorded state where the envelope has no
 * entry for that path.
 */
function valueStateOf(envelope: TargetsEnvelope, targetIndex: number, periodIndex: number, period: WirePeriod): ValueState {
  const path = `targets.${String(targetIndex)}.periods.${String(periodIndex)}.count`;
  return envelope.valueStates[path] ?? period.countState;
}

/** One measured period as the chart and its table alternative read it. */
function recordedPeriodOf(envelope: TargetsEnvelope, targetIndex: number, period: WirePeriod, periodIndex: number): RecordedPeriodView {
  return {
    // The period is named by the first day the read states for it; the range itself is stated in the table's own
    // dates column, so this label is never the only statement of which days a point covers.
    periodLabel: period.start,
    periodStart: civilDateOf(period.start),
    periodEnd: civilDateOf(period.endInclusive),
    value: period.count,
    valueState: valueStateOf(envelope, targetIndex, periodIndex, period),
  };
}

/** The progress the one chart draws: this target's measure, its quantity and every period the read measured. */
function progressViewOf(envelope: TargetsEnvelope, target: WireTarget, targetIndex: number): ProgressView {
  return { measure: target.measure, quantity: target.quantity, recorded: target.periods.map((period, periodIndex) => recordedPeriodOf(envelope, targetIndex, period, periodIndex)), coverage: envelope.coverage, asOf: envelope.asOf, state: target.state };
}

/**
 * The measures this worker has set a target for, each stated on its own: a measure with no target carries no row,
 * because a target nobody set cannot be restated as a quantity of zero, and no two rows are ever added together.
 */
function comparisonViewOf(envelope: TargetsEnvelope): readonly ComparisonRowView[] {
  return envelope.data.targets.map((target, targetIndex) => {
    const current = target.periods[0];
    if (current === undefined) {
      return { measure: target.measure, recorded: 0, target: target.quantity, valueState: "unavailable" };
    }
    return { measure: target.measure, recorded: current.count ?? 0, target: target.quantity, valueState: valueStateOf(envelope, targetIndex, 0, current) };
  });
}

// ---------------------------------------------------------------------------------------------
// Which of the worker's own targets this surface reads
// ---------------------------------------------------------------------------------------------

/** The position of the target this address names, or of the read's first one where it names none this read states. */
function selectedIndexIn(targets: readonly WireTarget[], selectedTargetId: string | undefined): number {
  if (targets.length === 0) {
    return -1;
  }
  if (selectedTargetId === undefined) {
    return 0;
  }
  const named = targets.findIndex((target) => target.targetId === selectedTargetId);
  return named === -1 ? 0 : named;
}

/** The name one target is chosen by: the measure it counts, and the worker's own name for it where they chose one. */
function targetLinkTextOf(target: WireTarget): string {
  const measure = MEASURE_COPY[target.measure].label;
  const label = target.privateLabel.trim();
  return label === "" ? measure : `${measure} — ${label}`;
}

/**
 * Every target the worker holds, each opening the same three surfaces on itself. The list keeps all of a worker's
 * targets reachable, since the composer, the history and the chart each state one target's plan at a time.
 */
function TargetPicker({ targets, selectedIndex }: { readonly targets: readonly WireTarget[]; readonly selectedIndex: number }): ReactElement {
  return (
    <nav aria-label={COACHING_COPY.targets.heading} className="min-w-0">
      <ul className="flex flex-wrap gap-2">
        {targets.map((target, index) => (
          <li key={target.targetId} className="min-w-0">
            <Link href={`${TARGETS_HREF}?${TARGET_PARAM}=${encodeURIComponent(target.targetId)}`} aria-current={index === selectedIndex ? "page" : undefined} className={cn(buttonVariants({ variant: index === selectedIndex ? "secondary" : "outline", size: "sm" }), PICKER_CLASS)}>
              {targetLinkTextOf(target)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The worker's targets, composed in the order the route states: the plan, the history it is read against, then progress. */
export default function TargetsSurface({ envelope, locale, selectedTargetId, className }: TargetsSurfaceProps): ReactElement {
  const router = useRouter();
  // A settled change and a check of an unconfirmed one both re-request this route's own read, so the plan, the history
  // and the counts above are what the service now holds rather than what this page was first rendered with.
  const reread = useCallback((): void => {
    router.refresh();
  }, [router]);
  const targets = envelope.data.targets;
  const selectedIndex = selectedIndexIn(targets, selectedTargetId);
  const selected = selectedIndex === -1 ? undefined : targets[selectedIndex];
  // The chart's value is derived once per (envelope, target, position) rather than once per commit: the progress
  // component rebuilds its points, its series and every formatted figure from this object, so a fresh one on every
  // render would pay all of it again for a render that changed neither.
  const progress = useMemo(() => (selected === undefined ? null : progressViewOf(envelope, selected, selectedIndex)), [envelope, selected, selectedIndex]);
  return (
    <div className={cn("flex min-w-0 flex-col gap-6", className)}>
      {/* Which target is being read. One target is always in view, and the others stay one link away. */}
      {targets.length > 1 ? <TargetPicker targets={targets} selectedIndex={selectedIndex} /> : null}
      {/* The plan first: the composer owns the four measures, the three periods, the private label, the Home
          placement and the four named changes, each with its own reviewed receipt. It is keyed by the target it
          opens, because it holds the entries it was opened with: a different target is a different composer, and
          reusing the first one would show this target's history beside another target's plan. */}
      <TargetForm key={selected === undefined ? "new-target" : selected.targetId} target={selected === undefined ? null : targetViewOf(selected)} scope={envelope.scope} expectedRevision={selected === undefined ? envelope.revision : selected.revision} locale={locale} onSettled={reread} onCheckResult={reread} />
      {selected === undefined || selectedIndex === -1 ? null : (
        <>
          {/* Then the plan's own history: every version, and each closed period against the version it was measured
              against rather than the plan that happens to be current. */}
          <TargetHistory versions={versionsViewOf(selected)} closedPeriods={closedPeriodsViewOf(selected)} locale={locale} />
          {/* Then the counts: this target's periods as the read measured them, with the measures stated separately
              beside them. */}
          <TargetProgress progress={progress} comparison={comparisonViewOf(envelope)} locale={locale} />
        </>
      )}
    </div>
  );
}
