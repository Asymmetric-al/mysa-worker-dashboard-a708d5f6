"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { hasSettled } from "@/components/attempt";
import OperationResult, { focusAnnouncedRegion } from "@/components/operation-result";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { TickMeter } from "@/components/ui/segmented-meter";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import type { ValueState } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
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
const targetViewOf = (target: WireTarget): TargetView => ({
  targetId: target.targetId,
  measure: target.measure,
  quantity: target.quantity,
  period: target.period.kind,
  calendarStart: civilDateOf(target.calendarStart),
  periodEnd: target.period.to === null ? null : civilDateOf(target.period.to),
  privateLabel: target.privateLabel,
  homePlacement: target.homePlacement === "placed",
  state: target.state,
});
const versionsViewOf = (target: WireTarget): TargetHistoryProps["versions"] =>
  target.versions.map((version) => ({
    revisionId: version.revisionId,
    effectiveFrom: civilDateOf(version.effectiveFrom),
    effectiveTo: version.effectiveTo === null ? null : civilDateOf(version.effectiveTo),
    measure: version.measure,
    quantity: version.quantity,
    calendarStart: civilDateOf(version.calendarStart),
    state: version.effectiveTo === null ? "open" : "closed",
  }));
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
const comparisonViewOf = (envelope: TargetsEnvelope): readonly NonNullable<TargetProgressProps["comparison"]>[number][] =>
  envelope.data.targets.map((target, targetIndex) => {
    const current = target.periods[0];
    if (current === undefined) return { measure: target.measure, recorded: 0, target: target.quantity, valueState: "unavailable" };
    return { measure: target.measure, recorded: current.count ?? 0, target: target.quantity, valueState: valueStateOf(envelope, targetIndex, 0, current) };
  });
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
  <nav aria-label={COACHING_COPY.targets.heading} className="min-w-0 rounded-2xl border border-border/80 bg-surface-subtle p-2.5">
    <ul className="flex flex-wrap gap-2">
      {targets.map((target, index) => (
        <li key={target.targetId} className="min-w-0">
          <Link {...{ href: `/coaching/targets?target=${encodeURIComponent(target.targetId)}`, "aria-current": index === selectedIndex ? "page" : undefined, "data-slot": "button", className: cn(buttonVariants({ variant: index === selectedIndex ? "default" : "outline", size: "sm" }), PICKER_CLASS) }}>
            {targetLinkTextOf(target)}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);
/** The create a settled save made, which is the only kind of save that states identifiers it created; every other settlement leaves the surface with no receipt of its own. */
const createdOf = (outcome: MutationOutcome): MutationOutcome | null => (hasSettled(outcome) && "created" in outcome && (outcome.created?.length ?? 0) > 0 ? outcome : null);
export default function TargetsSurface({ envelope, locale, selectedTargetId, className }: TargetsSurfaceProps): ReactElement {
  const router = useRouter();
  const reread = useCallback((): void => {
    router.refresh();
  }, [router]);
  const targets = envelope.data.targets;
  const selectedIndex = selectedIndexIn(targets, selectedTargetId);
  const selected = selectedIndex === -1 ? undefined : targets[selectedIndex];
  const [createdTarget, setCreatedTarget] = useState<{ readonly selection: string | undefined; readonly outcome: MutationOutcome } | null>(null);
  const createdRegion = useRef<HTMLDivElement | null>(null);
  // A create makes the re-read return the target it created, which replaces the blank form with that target's own form; the receipt is held here, on the surface that survives that replacement, so the announcement it carries and its focus stop outlive the form they were reported in. Any later settlement of an edit, a pause or an end states no created identifier, so it clears this one and only one receipt is ever on screen.
  const settleTarget = useCallback(
    (outcome: MutationOutcome): void => {
      const createdNow = createdOf(outcome);
      setCreatedTarget(createdNow === null ? null : { selection: selectedTargetId, outcome: createdNow });
      router.refresh();
    },
    [router, selectedTargetId],
  );
  // The receipt is shown only once the re-read has landed a target to show, which is the same state the surface that reported it gives way to: until then the review step's own receipt is the one on screen, so two "Saved" regions never state the same save at once. It also belongs to the selection the save was made in, so a target the caller picks afterwards is a different selection and carries no receipt of the one created before it.
  const created = createdTarget === null || createdTarget.selection !== selectedTargetId || selected === undefined ? null : createdTarget.outcome;
  useEffect(() => {
    if (created !== null) focusAnnouncedRegion(createdRegion.current);
  }, [created]);
  // The chart's value is derived once per (envelope, target, position) rather than once per commit: the progress component rebuilds its points, its series and every formatted figure from this object.
  const progress = useMemo(() => (selected === undefined ? null : progressViewOf(envelope, selected, selectedIndex)), [envelope, selected, selectedIndex]);
  return (
    <div className={cn("flex min-w-0 flex-col gap-6", className)}>
      {targets.length > 1 ? <TargetPicker targets={targets} selectedIndex={selectedIndex} /> : null}
      {created === null ? null : (
        <div ref={createdRegion} tabIndex={-1} data-slot="created-target-result" className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={created} headingLevel={3} />
        </div>
      )}
      <TargetForm key={selected === undefined ? "new-target" : selected.targetId} target={selected === undefined ? null : targetViewOf(selected)} scope={envelope.scope} expectedRevision={selected === undefined ? envelope.revision : selected.revision} locale={locale} onSettled={settleTarget} onCheckResult={reread} />
      {selected === undefined || selectedIndex === -1 ? null : (
        <>
          {progress !== null && progress.state === "active" && progress.quantity > 0 && progress.recorded[0] !== undefined && (progress.recorded[0].valueState === "value" || progress.recorded[0].valueState === "zero") && progress.recorded[0].value !== null ? (
            <div data-slot="target-cadence-meter" className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">Current period cadence</span>
                <span className="tabular-figures text-muted-foreground">{`${String(progress.recorded[0].value)} of ${String(progress.quantity)} ${MEASURE_COPY[progress.measure].label.toLowerCase()}`}</span>
              </div>
              <TickMeter
                ratio={progress.recorded[0].value / progress.quantity}
                tone={progress.recorded[0].value >= progress.quantity ? "positive" : "primary"}
                label={`Current period progress: ${String(progress.recorded[0].value)} of ${String(progress.quantity)}`}
              />
            </div>
          ) : null}
          <TargetHistory versions={versionsViewOf(selected)} closedPeriods={closedPeriodsViewOf(selected)} locale={locale} />
          {progress === null ? null : <TargetProgress progress={progress} comparison={comparisonViewOf(envelope)} locale={locale} />}
        </>
      )}
    </div>
  );
}
