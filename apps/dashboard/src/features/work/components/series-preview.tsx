"use client";
/**
 * The next dates a recurring task's rule produces, shown as a preview, and the disclosure that keeps a
 * resolved month day honest.
 */
import { useId, type ReactElement } from "react";
import { StateNotice, type NoticeRetry } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import type { DisclosedMonthDayResolution, RepeatProfile, SeriesState } from "@/modules/time/recurrence";
import { PAUSED_NOTE, SERIES_STATE_LABELS, STOPPED_NOTE } from "../copy/missed-dates";
import {
  LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE,
  NEXT_DATES_PREVIEW_HEADING,
  PLANNING_TIME_ZONE_LABEL,
  REPEAT_PROFILE_DESCRIPTIONS,
  REPEAT_PROFILE_LABELS,
  SINGLE_ACTIONABLE_OCCURRENCE_NOTE,
} from "../copy/repeat-profiles";
/** What the envelope says about the series' next dates. */
export type SeriesPreviewReading =
  | {
      readonly status: "preview";
      readonly dates: readonly CivilDate[];
      readonly actionableOccurrenceId: string;
      readonly actionableDueOn: CivilDate;
      readonly monthDayResolutions: readonly DisclosedMonthDayResolution[];
    }
  | {
      readonly status: "unavailable";
      readonly source?: SourceReference;
      readonly retry?: NoticeRetry;
    }
  | {
      readonly status: "unknown";
      readonly operationId: string;
      readonly retry?: NoticeRetry;
    };
/** Props of {@link SeriesPreview}. */
export interface SeriesPreviewProps {
  readonly state: SeriesState;
  readonly profile: RepeatProfile;
  readonly planningTimeZone: string;
  readonly reading: SeriesPreviewReading;
  readonly displayLocale: string;
  readonly className?: string;
}
const SERIES_STATE_TONES: Readonly<Record<SeriesState, StatusTone>> = {
  active: "positive",
  paused: "caution",
  stopped: "neutral",
};
const MAX_PREVIEWED_DATES = 3;

const DATE_DISPLAY_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
const MONTH_NAME_FORMAT: Intl.DateTimeFormatOptions = { month: "long" };

function formatDatePart(date: CivilDate, displayLocale: string, format: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleString(displayLocale, format);
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return serialiseCivilDate(date);
  }
}
function displayCivilDate(date: CivilDate, displayLocale: string): string {
  return formatDatePart(date, displayLocale, DATE_DISPLAY_FORMAT);
}
function monthNameOf(date: CivilDate, displayLocale: string): string {
  return formatDatePart(date, displayLocale, MONTH_NAME_FORMAT);
}
function resolutionSentence(resolution: DisclosedMonthDayResolution, displayLocale: string): string {
  const { requestedDay, dueOn } = resolution;
  return LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE.replace("{day}", String(requestedDay)).replace("{month}", monthNameOf(dueOn, displayLocale));
}
const ACTIONABLE_DATE_LABEL = "Actionable";
const PREVIEW_DATE_LABEL = "Preview";

const DATE_STATUS_SR_PREFIX = "Date status";

const SERIES_STATUS_SR_PREFIX = "Series status";

const PREVIEW_UNAVAILABLE_TITLE = "The next dates could not be read";
const PREVIEW_UNAVAILABLE_DESCRIPTION = "This series is still here; the dates its rule produces are not shown because the data behind them could not be read, so nothing stands in for them.";

const PREVIEW_UNKNOWN_TITLE = "The next dates are not confirmed";
const PREVIEW_UNKNOWN_DESCRIPTION = "Whether the rule produced new dates after this change is not known yet, so no date is shown in place of the answer.";

const PREVIEW_ENDED_TITLE = "No further dates on this plan";
const PREVIEW_ENDED_DESCRIPTION = "The series has reached the end its rule states, so the rule produces no further date to preview.";
/** The next dates of one recurring task series, the single actionable occurrence among them, and the resolution each shortened month forced. */
export default function SeriesPreview({ state, profile, planningTimeZone, reading, displayLocale, className }: SeriesPreviewProps): ReactElement {
  // Hook first and unconditionally, so the label association below survives every branch.
  const previewLabelId = useId();
  if (reading.status === "unavailable") {
    return <StateNotice kind="unavailable" title={PREVIEW_UNAVAILABLE_TITLE} description={PREVIEW_UNAVAILABLE_DESCRIPTION} source={reading.source} retry={reading.retry} className={className} />;
  }
  if (reading.status === "unknown") {
    return <StateNotice kind="unknown" title={PREVIEW_UNKNOWN_TITLE} description={PREVIEW_UNKNOWN_DESCRIPTION} operationId={reading.operationId} retry={reading.retry} className={className} />;
  }
  const stopped = state === "stopped";
  const dates = reading.dates.slice(0, MAX_PREVIEWED_DATES);
  // An end the rule states is a complete answer, not a blank one: the series produces no next date,
  // and a stopped series is described by its own note rather than reported as ended.
  if (!stopped && dates.length === 0) {
    return <StateNotice kind="empty" title={PREVIEW_ENDED_TITLE} description={PREVIEW_ENDED_DESCRIPTION} className={className} />;
  }
  const actionableKey = serialiseCivilDate(reading.actionableDueOn);
  const resolutionByDate = new Map<string, DisclosedMonthDayResolution>(
    reading.monthDayResolutions.map((resolution): [string, DisclosedMonthDayResolution] => [serialiseCivilDate(resolution.dueOn), resolution]),
  );
  const displayedKeys = new Set(dates.map(serialiseCivilDate));
  // A resolution whose date is not among the previewed ones is still a fact about this plan, so it
  // is stated once above the list rather than dropped.
  const unattachedResolutions = reading.monthDayResolutions.filter((resolution) => !displayedKeys.has(serialiseCivilDate(resolution.dueOn)));
  const actionableShown = dates.some((date) => serialiseCivilDate(date) === actionableKey);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{REPEAT_PROFILE_LABELS[profile]}</p>
        <StatusBadge label={SERIES_STATE_LABELS[state]} tone={SERIES_STATE_TONES[state]} srPrefix={SERIES_STATUS_SR_PREFIX} />
      </div>
      <p className="text-sm text-muted-foreground">{REPEAT_PROFILE_DESCRIPTIONS[profile]}</p>
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
                {resolutionSentence(resolution, displayLocale)}{" "}
                <bdi>
                  <time dateTime={key} className="tabular-figures">
                    {displayCivilDate(resolution.dueOn, displayLocale)}
                  </time>
                </bdi>
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
                <li
                  // The actionable row is keyed by the occurrence the envelope named, so a re-read
                  // that keeps the same occurrence does not remount the row.
                  key={isActionable ? reading.actionableOccurrenceId : key}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
                >
                  <bdi>
                    <time dateTime={key} className="tabular-figures">
                      {displayCivilDate(date, displayLocale)}
                    </time>
                  </bdi>
                  <StatusBadge label={isActionable ? ACTIONABLE_DATE_LABEL : PREVIEW_DATE_LABEL} tone={isActionable ? "info" : "muted"} srPrefix={DATE_STATUS_SR_PREFIX} />
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
