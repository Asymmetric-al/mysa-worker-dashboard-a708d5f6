"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, type ReactElement } from "react";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import type { ValueState } from "@/modules/data-service/envelope";
import { parseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MEASURE_COPY } from "../copy";
import TargetForm, { type TargetView } from "./target-form";
import TargetHistory, { type TargetHistoryProps } from "./target-history";
import TargetProgress, { type TargetProgressProps } from "./target-progress";
type TargetsEnvelope = Extract<Awaited<ReturnType<typeof reads.coaching.readTargets>>, { readonly kind: "envelope" }>["envelope"];
type WireTarget = TargetsEnvelope["data"]["targets"][number];
type WirePeriod = WireTarget["periods"][number];
type ProgressView = NonNullable<TargetProgressProps["progress"]>;
export type TargetsSurfaceProps = { readonly envelope: TargetsEnvelope; readonly locale: string; readonly selectedTargetId?: string; readonly className?: string };
const PICKER_CLASS = cn(BUTTON_WRAP_CLASS, "text-start");
const CLOSED_PERIOD_STATE: Readonly<Record<WirePeriod["state"], TargetHistoryProps["closedPeriods"][number]["state"]>> = { active: "recorded", unplaced: "recorded", "zero-recorded": "zero-recorded", paused: "paused", ended: "ended", unavailable: "unavailable", "no-target": "unavailable" };
function civilDateOf(stored: string): CivilDate {
  const parsed = parseCivilDate(stored);
  if (parsed.status !== "parsed") throw new Error(`The targets read stated "${stored}" as a calendar date, and it is not one.`);
  return parsed.date;
}
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
const closedPeriodsViewOf = (target: WireTarget): TargetHistoryProps["closedPeriods"] =>
  target.periods.slice(1).map((period) => ({ periodStart: civilDateOf(period.start), periodEnd: civilDateOf(period.endInclusive), measuredAgainstRevisionId: period.version === null ? "" : period.version.revisionId, recorded: period.count ?? 0, state: CLOSED_PERIOD_STATE[period.state] }));
const valueStateOf = (envelope: TargetsEnvelope, targetIndex: number, periodIndex: number, period: WirePeriod): ValueState => envelope.valueStates[`targets.${String(targetIndex)}.periods.${String(periodIndex)}.count`] ?? period.countState;
const recordedPeriodOf = (envelope: TargetsEnvelope, targetIndex: number, period: WirePeriod, periodIndex: number): ProgressView["recorded"][number] => ({
  periodLabel: period.start,
  periodStart: civilDateOf(period.start),
  periodEnd: civilDateOf(period.endInclusive),
  value: period.count,
  valueState: valueStateOf(envelope, targetIndex, periodIndex, period),
});
const progressViewOf = (envelope: TargetsEnvelope, target: WireTarget, targetIndex: number): ProgressView => ({
  measure: target.measure,
  quantity: target.quantity,
  recorded: target.periods.map((period, periodIndex) => recordedPeriodOf(envelope, targetIndex, period, periodIndex)),
  coverage: envelope.coverage,
  asOf: envelope.asOf,
  state: target.state,
});
function comparisonViewOf(envelope: TargetsEnvelope): readonly NonNullable<TargetProgressProps["comparison"]>[number][] {
  return envelope.data.targets.map((target, targetIndex) => {
    const current = target.periods[0];
    if (current === undefined) return { measure: target.measure, recorded: 0, target: target.quantity, valueState: "unavailable" };
    return { measure: target.measure, recorded: current.count ?? 0, target: target.quantity, valueState: valueStateOf(envelope, targetIndex, 0, current) };
  });
}
function selectedIndexIn(targets: readonly WireTarget[], selectedTargetId: string | undefined): number {
  if (targets.length === 0) return -1;
  if (selectedTargetId === undefined) return 0;
  const named = targets.findIndex((target) => target.targetId === selectedTargetId);
  return named === -1 ? 0 : named;
}
function targetLinkTextOf(target: WireTarget): string {
  const measure = MEASURE_COPY[target.measure].label;
  const label = target.privateLabel.trim();
  return label === "" ? measure : `${measure} — ${label}`;
}
const TargetPicker = ({ targets, selectedIndex }: { readonly targets: readonly WireTarget[]; readonly selectedIndex: number }): ReactElement => (
  <nav aria-label={COACHING_COPY.targets.heading} className="min-w-0">
    <ul className="flex flex-wrap gap-2">
      {targets.map((target, index) => (
        <li key={target.targetId} className="min-w-0">
          <Link {...{ href: `/coaching/targets?target=${encodeURIComponent(target.targetId)}`, "aria-current": index === selectedIndex ? "page" : undefined, "data-slot": "button", className: cn(buttonVariants({ variant: index === selectedIndex ? "secondary" : "outline", size: "sm" }), PICKER_CLASS) }}>
            {targetLinkTextOf(target)}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);
export default function TargetsSurface({ envelope, locale, selectedTargetId, className }: TargetsSurfaceProps): ReactElement {
  const router = useRouter();
  const reread = useCallback((): void => {
    router.refresh();
  }, [router]);
  const targets = envelope.data.targets;
  const selectedIndex = selectedIndexIn(targets, selectedTargetId);
  const selected = selectedIndex === -1 ? undefined : targets[selectedIndex];
  // The chart's value is derived once per (envelope, target, position) rather than once per commit: the progress component rebuilds its points, its series and every formatted figure from this object.
  const progress = useMemo(() => (selected === undefined ? null : progressViewOf(envelope, selected, selectedIndex)), [envelope, selected, selectedIndex]);
  return (
    <div className={cn("flex min-w-0 flex-col gap-6", className)}>
      {targets.length > 1 ? <TargetPicker targets={targets} selectedIndex={selectedIndex} /> : null}
      <TargetForm key={selected === undefined ? "new-target" : selected.targetId} target={selected === undefined ? null : targetViewOf(selected)} scope={envelope.scope} expectedRevision={selected === undefined ? envelope.revision : selected.revision} locale={locale} onSettled={reread} onCheckResult={reread} />
      {selected === undefined || selectedIndex === -1 ? null : (
        <>
          <TargetHistory versions={versionsViewOf(selected)} closedPeriods={closedPeriodsViewOf(selected)} locale={locale} />
          {progress === null ? null : <TargetProgress progress={progress} comparison={comparisonViewOf(envelope)} locale={locale} />}
        </>
      )}
    </div>
  );
}
