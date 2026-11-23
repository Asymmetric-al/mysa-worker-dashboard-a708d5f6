"use client";
import { useId, type ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Separator } from "@/components/ui/separator";
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
type ClosedPeriod = TargetHistoryProps["closedPeriods"][number];
type ClosedPeriodState = ClosedPeriod["state"];
type VersionStateCopy = { readonly label: string; readonly tone: StatusTone };
const VERSION_STATE_COPY: Readonly<Record<Version["state"], VersionStateCopy>> = { open: { label: "Current", tone: "info" }, closed: { label: "Closed", tone: "neutral" } };
type ClosedPeriodCopy = { readonly word: string | null; readonly tone: StatusTone; readonly sentence: string | null; readonly showsFigure: boolean };
const CLOSED_PERIOD_COPY: Readonly<Record<ClosedPeriodState, ClosedPeriodCopy>> = {
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
        In force from <CivilDateText value={version.effectiveFrom} /> onwards
      </>
    );
  if (version.effectiveTo === null)
    return (
      <>
        From <CivilDateText value={version.effectiveFrom} /> to a date this read does not state
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
  if (version === undefined) return <p className="type-supporting">The version this period was measured against is not in the history this read can show, so no version is named here in its place.</p>;
  return (
    <p className="type-body">
      Measured against the version in force from <CivilDateText value={version.effectiveFrom} />, which set a target of <bdi className="tabular-figures">{version.quantity}</bdi>
      <MeasureLabel measure={version.measure} />.{" "}
    </p>
  );
}
type NoRowsNoticeProps = { readonly source: SourceReference | null; readonly emptyTitle: string; readonly emptyDescription: string };
const NoRowsNotice = ({ source, emptyTitle, emptyDescription }: NoRowsNoticeProps): ReactElement => {
  return source !== null ? <StateNotice kind="unavailable" title={"This history cannot be read right now"} description={COACHING_COPY.targets.unavailable} source={source} headingLevel={3} /> : <StateNotice kind="empty" title={emptyTitle} description={emptyDescription} headingLevel={3} />;
};
export default function TargetHistory({ versions, closedPeriods, locale, unavailable = null, className }: TargetHistoryProps): ReactElement {
  const versionsHeadingId = useId();
  const periodsHeadingId = useId();
  const versionsNewestFirst = [...versions].reverse();
  const unreadableSource = unavailable === null ? null : unavailable.source;
  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)} data-interface-locale={locale}>
      <p className="type-supporting text-balance">{TARGET_VERSION_GUARANTEE}</p>
      <Panel titleId={versionsHeadingId} headingLevel={2} title={"Version history"} description={"Each version is the plan in force from its first date until the day before the next version begins, so a period falls inside exactly one of them."}>
        {versionsNewestFirst.length === 0 ? (
          <NoRowsNotice source={unreadableSource} emptyTitle={"No version recorded yet"} emptyDescription={"A target records its first version on the date it is set, and every later change to the quantity, the measure or the calendar start records another one from the date it takes effect."} />
        ) : (
          <ul aria-labelledby={versionsHeadingId} className="flex min-w-0 flex-col gap-4">
            {versionsNewestFirst.map((version, index) => {
              const stateCopy = VERSION_STATE_COPY[version.state];
              return (
                <li key={version.revisionId} className="flex min-w-0 flex-col gap-2">
                  {index === 0 ? null : <Separator />}
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
      <Panel titleId={periodsHeadingId} headingLevel={2} title={"Closed periods"} description={"A period appears here once its calendar has completed, with the version it was measured against and the figure that version's measure recorded."}>
        {closedPeriods.length === 0 ? (
          <NoRowsNotice source={unreadableSource} emptyTitle={"No closed period yet"} emptyDescription={"Periods of this target are still running, so none has closed and none has a settled figure. A closed period appears here with the version it was measured against once its calendar completes."} />
        ) : (
          <ul aria-labelledby={periodsHeadingId} className="flex min-w-0 flex-col gap-4">
            {closedPeriods.map((period, index) => {
              const stateCopy = CLOSED_PERIOD_COPY[period.state];
              const measuredAgainst = versions.find((version) => version.revisionId === period.measuredAgainstRevisionId);
              return (
                <li key={`${serialiseCivilDate(period.periodStart)}/${serialiseCivilDate(period.periodEnd)}`} className="flex min-w-0 flex-col gap-2">
                  {index === 0 ? null : <Separator />}
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
