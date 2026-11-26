"use client";
import { useId, type ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { TargetMeasure } from "@/modules/coaching/target";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MEASURE_COPY, TARGET_STATE_COPY, TARGET_VERSION_GUARANTEE } from "../copy";
import { Panel } from "./panel";
export type TargetHistoryProps = {
  readonly versions: ReadonlyArray<{ readonly revisionId: string; readonly effectiveFrom: CivilDate; readonly effectiveTo: CivilDate | null; readonly measure: TargetMeasure; readonly quantity: number; readonly calendarStart: CivilDate; readonly state: "open" | "closed" }>;
  readonly closedPeriods: ReadonlyArray<{ readonly periodStart: CivilDate; readonly periodEnd: CivilDate; readonly measuredAgainstRevisionId: string; readonly recorded: number; readonly state: "zero-recorded" | "recorded" | "paused" | "ended" | "unavailable" }>;
  readonly locale: string;
  readonly unavailable?: { readonly source: SourceReference } | null;
  readonly className?: string;
};
type Version = TargetHistoryProps["versions"][number];
const VERSION_STATE_COPY: Readonly<Record<Version["state"], { readonly label: string; readonly tone: StatusTone }>> = { open: { label: "Current", tone: "info" }, closed: { label: "Closed", tone: "neutral" } };
type ClosedPeriodCopy = { readonly word: string | null; readonly tone: StatusTone; readonly sentence: string | null; readonly showsFigure: boolean };
const CLOSED_PERIOD_COPY: Readonly<Record<TargetHistoryProps["closedPeriods"][number]["state"], ClosedPeriodCopy>> = {
  recorded: { word: null, tone: "neutral", sentence: null, showsFigure: true },
  "zero-recorded": { word: TARGET_STATE_COPY["zero-recorded"].label, tone: "muted", sentence: TARGET_STATE_COPY["zero-recorded"].description, showsFigure: true },
  paused: { word: TARGET_STATE_COPY.paused.label, tone: "caution", sentence: TARGET_STATE_COPY.paused.description, showsFigure: true },
  ended: { word: TARGET_STATE_COPY.ended.label, tone: "neutral", sentence: TARGET_STATE_COPY.ended.description, showsFigure: true },
  unavailable: { word: TARGET_STATE_COPY.unavailable.label, tone: "danger", sentence: TARGET_STATE_COPY.unavailable.description, showsFigure: false },
};
const CivilDateText = ({ value }: { readonly value: CivilDate }): ReactElement => <bdi>{serialiseCivilDate(value)}</bdi>;
function VersionDates({ version }: { readonly version: Version }): ReactElement {
  if (version.state === "open")
    return (
      <>
        Active from <CivilDateText value={version.effectiveFrom} />
      </>
    );
  if (version.effectiveTo === null)
    return (
      <>
        From <CivilDateText value={version.effectiveFrom} /> (end date unavailable)
      </>
    );
  return (
    <>
      From <CivilDateText value={version.effectiveFrom} /> to <CivilDateText value={version.effectiveTo} />
    </>
  );
}
const MeasureLabel = ({ measure }: { readonly measure: TargetMeasure }): ReactElement => (
  <>
    {" "}
    (<bdi>{MEASURE_COPY[measure].label}</bdi>)
  </>
);
function MeasuredAgainstVersion({ version }: { readonly version: Version | undefined }): ReactElement {
  if (version === undefined) return <p className="type-supporting">The target version for this period wasn’t included in this response.</p>;
  return (
    <p className="type-body">
      Measured against target from <CivilDateText value={version.effectiveFrom} />: <bdi className="tabular-figures">{version.quantity}</bdi>
      <MeasureLabel measure={version.measure} />.{" "}
    </p>
  );
}
type NoRowsNoticeProps = { readonly source: SourceReference | null; readonly emptyTitle: string; readonly emptyDescription: string };
const NoRowsNotice = ({ source, emptyTitle, emptyDescription }: NoRowsNoticeProps): ReactElement => {
  return source !== null ? <StateNotice kind="unavailable" title="Couldn’t load target history" description={COACHING_COPY.targets.unavailable} source={source} headingLevel={3} /> : <StateNotice kind="empty" title={emptyTitle} description={emptyDescription} headingLevel={3} />;
};
export default function TargetHistory({ versions, closedPeriods, locale, unavailable = null, className }: TargetHistoryProps): ReactElement {
  const [versionsHeadingId, periodsHeadingId] = [useId(), useId()];
  const versionsNewestFirst = [...versions].reverse();
  const unreadableSource = unavailable === null ? null : unavailable.source;
  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)} data-interface-locale={locale}>
      <p className="type-supporting text-balance">{TARGET_VERSION_GUARANTEE}</p>
      <Panel titleId={versionsHeadingId} headingLevel={2} title="Version history" description="Each edit starts a new version from its effective date while past periods keep their original target.">
        {versionsNewestFirst.length === 0 ? (
          <NoRowsNotice source={unreadableSource} emptyTitle="No versions yet" emptyDescription="Your first version is recorded when you save a target, and edits add new versions going forward." />
        ) : (
          <ul aria-labelledby={versionsHeadingId} className="flex min-w-0 flex-col gap-2.5">
            {versionsNewestFirst.map((version) => {
              const stateCopy = VERSION_STATE_COPY[version.state];
              return (
                <li key={version.revisionId} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/80 bg-surface-subtle p-3.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium">
                      <VersionDates version={version} />
                    </p>
                    <StatusBadge label={stateCopy.label} tone={stateCopy.tone} />
                  </div>
                  <p className="type-body">
                    Target <bdi className="tabular-figures">{version.quantity}</bdi>
                    <MeasureLabel measure={version.measure} />
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel titleId={periodsHeadingId} headingLevel={2} title="Closed periods" description="Completed periods appear here with the target version active at the time and your recorded count.">
        {closedPeriods.length === 0 ? (
          <NoRowsNotice source={unreadableSource} emptyTitle="No completed periods yet" emptyDescription="Once your current period finishes, its final count and target version will appear here." />
        ) : (
          <ul aria-labelledby={periodsHeadingId} className="flex min-w-0 flex-col gap-2.5">
            {closedPeriods.map((period) => {
              const stateCopy = CLOSED_PERIOD_COPY[period.state];
              const measuredAgainst = versions.find((version) => version.revisionId === period.measuredAgainstRevisionId);
              return (
                <li key={`${serialiseCivilDate(period.periodStart)}/${serialiseCivilDate(period.periodEnd)}`} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/80 bg-surface-subtle p-3.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium">
                      <CivilDateText value={period.periodStart} /> to <CivilDateText value={period.periodEnd} />
                    </p>
                    {stateCopy.word === null ? null : <StatusBadge label={stateCopy.word} tone={stateCopy.tone} />}
                  </div>
                  {stateCopy.showsFigure ? (
                    <p className="type-body">
                      Recorded <bdi className="tabular-figures">{period.recorded}</bdi>
                      {measuredAgainst === undefined ? null : <MeasureLabel measure={measuredAgainst.measure} />}
                    </p>
                  ) : null}
                  {stateCopy.sentence === null ? null : <p className="type-supporting">{stateCopy.sentence}</p>}
                  {period.state === "unavailable" && unreadableSource !== null ? (
                    <p className="type-supporting">
                      Source <bdi className="mono-identifier">{formatSourceReference(unreadableSource)}</bdi>.
                    </p>
                  ) : null}
                  <MeasuredAgainstVersion version={measuredAgainst} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </section>
  );
}
