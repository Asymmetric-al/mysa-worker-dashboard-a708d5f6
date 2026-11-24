"use client";
import { useId, type ReactElement } from "react";
import { StateNotice, type NoticeRetry } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import type { DisclosedMonthDayResolution, SeriesState } from "@/modules/time/recurrence";
import { PAUSED_NOTE, SERIES_STATE_LABELS, STOPPED_NOTE } from "../copy/missed-dates";
import { LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE, NEXT_DATES_PREVIEW_HEADING, PLANNING_TIME_ZONE_LABEL, REPEAT_PROFILE_DESCRIPTIONS, SINGLE_ACTIONABLE_OCCURRENCE_NOTE, repeatRuleLabel, type RepeatRuleFacts } from "../copy/repeat-profiles";
import { StatedInstant } from "./stated-instant";
export type SeriesPreviewReading =
  | { readonly status: "preview"; readonly dates: readonly CivilDate[]; readonly actionableOccurrenceId: string; readonly actionableDueOn: CivilDate; readonly monthDayResolutions: readonly DisclosedMonthDayResolution[] }
  | { readonly status: "unavailable"; readonly source?: SourceReference; readonly retry?: NoticeRetry }
  | { readonly status: "unknown"; readonly operationId: string; readonly retry?: NoticeRetry };
export type SeriesPreviewProps = { readonly state: SeriesState; readonly rule: RepeatRuleFacts; readonly planningTimeZone: string; readonly reading: SeriesPreviewReading; readonly displayLocale: string; readonly className?: string };
const SERIES_STATE_TONES: Readonly<Record<SeriesState, StatusTone>> = { active: "positive", paused: "caution", stopped: "neutral" };
const DATE_DISPLAY_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
const MONTH_NAME_FORMAT: Intl.DateTimeFormatOptions = { month: "long" };
function formatDatePart(date: CivilDate, displayLocale: string, format: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleString(displayLocale, format);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return serialiseCivilDate(date);
  }
}
const displayCivilDate = (date: CivilDate, displayLocale: string): string => formatDatePart(date, displayLocale, DATE_DISPLAY_FORMAT);
function resolutionSentence(resolution: DisclosedMonthDayResolution, displayLocale: string): string {
  const { requestedDay, dueOn } = resolution;
  return LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE.replace("{day}", String(requestedDay)).replace("{month}", ((date: CivilDate, displayLocale: string): string => formatDatePart(date, displayLocale, MONTH_NAME_FORMAT))(dueOn, displayLocale));
}
export default function SeriesPreview({ state, rule, planningTimeZone, reading, displayLocale, className }: SeriesPreviewProps): ReactElement {
  const previewLabelId = useId();
  if (reading.status === "unavailable")
    return <StateNotice kind="unavailable" title="The next dates could not be read" description="This series is still here; the dates its rule produces are not shown because the data behind them could not be read, so nothing stands in for them." source={reading.source} retry={reading.retry} className={className} />;
  if (reading.status === "unknown")
    return <StateNotice kind="unknown" title="The next dates are not confirmed" description="Whether the rule produced new dates after this change is not known yet, so no date is shown in place of the answer." operationId={reading.operationId} retry={reading.retry} className={className} />;
  const stopped = state === "stopped";
  const dates = reading.dates.slice(0, 3);
  if (!stopped && dates.length === 0) return <StateNotice kind="empty" title="No further dates on this plan" description="The series has reached the end its rule states, so the rule produces no further date to preview." className={className} />;
  const actionableKey = serialiseCivilDate(reading.actionableDueOn);
  const resolutionByDate = new Map<string, DisclosedMonthDayResolution>(reading.monthDayResolutions.map((resolution): [string, DisclosedMonthDayResolution] => [serialiseCivilDate(resolution.dueOn), resolution]));
  const displayedKeys = new Set(dates.map(serialiseCivilDate));
  const unattachedResolutions = reading.monthDayResolutions.filter((resolution) => !displayedKeys.has(serialiseCivilDate(resolution.dueOn)));
  const actionableShown = dates.some((date) => serialiseCivilDate(date) === actionableKey);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{repeatRuleLabel(rule)}</p>
        <StatusBadge label={SERIES_STATE_LABELS[state]} tone={SERIES_STATE_TONES[state]} srPrefix="Series status" />
      </div>
      <p className="text-sm text-muted-foreground">{REPEAT_PROFILE_DESCRIPTIONS[rule.profile]}</p>
      {state === "paused" ? <p className="text-sm text-muted-foreground">{PAUSED_NOTE}</p> : null}
      {stopped ? (
        <p className="text-sm">{STOPPED_NOTE}</p>
      ) : (
        <>
          <p className="text-sm break-words text-muted-foreground">
            {`${PLANNING_TIME_ZONE_LABEL}: `}
            <bdi>{planningTimeZone}</bdi>
          </p>
          {unattachedResolutions.map((resolution) => {
            const key = serialiseCivilDate(resolution.dueOn);
            return (
              <p key={key} className="text-sm break-words text-muted-foreground">
                {resolutionSentence(resolution, displayLocale)} <StatedInstant iso={key} text={displayCivilDate(resolution.dueOn, displayLocale)} className="tabular-figures" />
              </p>
            );
          })}
          <p id={previewLabelId} className="text-sm font-medium">
            {NEXT_DATES_PREVIEW_HEADING}
          </p>
          <ol aria-labelledby={previewLabelId} className="flex flex-col gap-2">
            {dates.map((date) => {
              const key = serialiseCivilDate(date);
              const isActionable = key === actionableKey;
              const resolution = resolutionByDate.get(key);
              return (
                <li key={isActionable ? reading.actionableOccurrenceId : key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <StatedInstant iso={key} text={displayCivilDate(date, displayLocale)} className="tabular-figures" />
                  <StatusBadge label={isActionable ? "Actionable" : "Preview"} tone={isActionable ? "info" : "muted"} srPrefix="Date status" />
                  {resolution === undefined ? null : <p className="w-full text-sm text-muted-foreground">{resolutionSentence(resolution, displayLocale)}</p>}
                </li>
              );
            })}
          </ol>
          {actionableShown ? <p className="text-sm text-muted-foreground">{SINGLE_ACTIONABLE_OCCURRENCE_NOTE}</p> : null}
        </>
      )}
    </div>
  );
}
