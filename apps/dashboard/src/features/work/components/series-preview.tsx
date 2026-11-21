"use client";

/**
 * The next dates a recurring task's rule produces, shown as a preview, and the disclosure that keeps
 * a resolved month day honest.
 *
 * Display only. The dates, the one actionable occurrence and the resolution facts are computed from
 * `nextOccurrences` / `monthlyOnDay` in `@/modules/time/recurrence` when the series is read, and they
 * arrive in the read envelope; this component renders what it is given. It therefore reads no clock,
 * keeps no `now`, imports no recurrence function, adds no fourth date of its own and hides nothing:
 * if the envelope says the dates could not be read, the surface says so instead of drawing a date.
 *
 * Three distinctions the rendering must keep visible:
 *
 * - Exactly one date is actionable. The other dates are previews of what the rule produces, and
 *   nothing happens on them until they become the next date, so no preview row offers an action.
 * - A monthly date that had to fall on the final day of a shorter month is a normal, disclosed
 *   resolution rather than a warning: it is stated in the copy module's own sentence beside the date
 *   it affects, in muted text, with no alert frame and no colour-only emphasis.
 * - A preview date is not a commitment, a booking or a send, and a paused series holds its plan
 *   while a stopped series admits no further dates — so a stop lists no next dates at all and says
 *   what it did instead of showing dates that cannot arrive.
 *
 * The words come from the Work family's copy: profile names, the resolution sentence, the state
 * words and the notes all live in `../copy/repeat-profiles` and `../copy/missed-dates`. Only the two
 * row labels ("Actionable", "Preview") and the notice sentences belong to this surface, because no
 * copy module words a preview row or a preview outage, and the two words exist so a row's status is
 * never carried by a tone alone.
 */

import { useId, type ReactElement } from "react";

import { StateNotice, type NoticeRetry } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import type {
  DisclosedMonthDayResolution,
  RepeatProfile,
  SeriesState,
} from "@/modules/time/recurrence";

import { PAUSED_NOTE, SERIES_STATE_LABELS, STOPPED_NOTE } from "../copy/missed-dates";
import {
  LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE,
  NEXT_DATES_PREVIEW_HEADING,
  PLANNING_TIME_ZONE_LABEL,
  REPEAT_PROFILE_DESCRIPTIONS,
  REPEAT_PROFILE_LABELS,
  SINGLE_ACTIONABLE_OCCURRENCE_NOTE,
} from "../copy/repeat-profiles";

/**
 * What the envelope says about the series' next dates.
 *
 * The three members are three different facts and never share a rendering: dates the rule produced,
 * a source that could not be read, and an acknowledgement that did not arrive. A refused or
 * unreadable preview carries no date at all, because a placeholder date would be indistinguishable
 * from one the rule really produces.
 */
export type SeriesPreviewReading =
  | {
      readonly status: "preview";
      /** The dates the rule produces, in the envelope's own order, the next one first. */
      readonly dates: readonly CivilDate[];
      /** The identity of the one occurrence that can be acted on, as the envelope reported it. */
      readonly actionableOccurrenceId: string;
      /** The date of that occurrence: the one row this preview marks as actionable. */
      readonly actionableDueOn: CivilDate;
      /** Every previewed date whose day the rule had to resolve to the final day of its month. */
      readonly monthDayResolutions: readonly DisclosedMonthDayResolution[];
    }
  | {
      readonly status: "unavailable";
      /** The source that could not be read, reported rather than replaced by an empty list. */
      readonly source?: SourceReference;
      /** Re-requests the same series read. A retry reads; it never repeats a change. */
      readonly retry?: NoticeRetry;
    }
  | {
      readonly status: "unknown";
      /** The attempt whose fate is not known. Rendered verbatim, so a leading zero survives. */
      readonly operationId: string;
      readonly retry?: NoticeRetry;
    };

/** Props of {@link SeriesPreview}. */
export interface SeriesPreviewProps {
  /** The series' own state word: admitting dates, paused from admitting them, or stopped. */
  readonly state: SeriesState;

  /** The closed repeat profile the series follows, named in the copy module's words. */
  readonly profile: RepeatProfile;

  /** The zone the series is planned in, which the envelope reports beside the dates. */
  readonly planningTimeZone: string;

  /** The next dates and their resolution facts, as the service computed them at read time. */
  readonly reading: SeriesPreviewReading;

  /** Layout classes for the block this preview occupies. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * How the three series states read as a label tone.
 *
 * Kept here rather than taken from a caller, so no surface chooses a colour for a state and paused
 * can never be painted as stopped. The word itself always says the state; the tone only reinforces
 * it.
 */
const SERIES_STATE_TONES: Readonly<Record<SeriesState, StatusTone>> = {
  active: "positive",
  paused: "caution",
  stopped: "neutral",
};

/**
 * A preview shows the shape of a repeat rather than the whole plan.
 *
 * The rule module asks for three by default and clamps a caller to 1-12; a preview longer than a
 * phone screen is not a preview, so the rendering stops at the same three.
 */
const MAX_PREVIEWED_DATES = 3;

/**
 * The language a rendered date is written in, stated explicitly.
 *
 * Stating it keeps the server render and the browser render identical and stops a viewer's platform
 * locale from reordering a calendar date that is a civil fact rather than an instant. This is
 * rendering only: the date itself never passes through a zone, and `serialiseCivilDate` still
 * supplies the machine-readable form for the `dateTime` attribute.
 */
const DISPLAY_LOCALE = "en";

const DATE_DISPLAY_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
const MONTH_NAME_FORMAT: Intl.DateTimeFormatOptions = { month: "long" };

/** Renders a civil date for a reader without moving it: the date's own parts, in one locale. */
function displayCivilDate(date: CivilDate): string {
  return date.toLocaleString(DISPLAY_LOCALE, DATE_DISPLAY_FORMAT);
}

/** The month a resolved date fell in, which the resolution sentence names. */
function monthNameOf(date: CivilDate): string {
  return date.toLocaleString(DISPLAY_LOCALE, MONTH_NAME_FORMAT);
}

/**
 * The disclosed resolution for one date, in the copy module's words.
 *
 * Only the envelope's own numbers and month are substituted: the chosen day comes from
 * `requestedDay`, and the month is the one the resolved date belongs to. Nothing is inferred and
 * nothing is recomputed, so the sentence can only say what the rule actually did.
 */
function resolutionSentence(resolution: DisclosedMonthDayResolution): string {
  const { requestedDay, dueOn } = resolution;
  return LAST_DAY_OF_MONTH_RESOLUTION_TEMPLATE.replace("{day}", String(requestedDay)).replace(
    "{month}",
    monthNameOf(dueOn),
  );
}

/**
 * The two statuses a previewed row can hold, in words.
 *
 * No copy module words a preview row, and the distinction is exactly what a worker needs from this
 * surface: one date can be acted on now and the rest cannot yet. Both words are visible, so the
 * distinction never depends on the badge tone.
 */
const ACTIONABLE_DATE_LABEL = "Actionable";
const PREVIEW_DATE_LABEL = "Preview";

/** The visible lead-in that says what a row's status word describes. */
const DATE_STATUS_SR_PREFIX = "Date status";

/** The series-state label's visible lead-in, so the word is not an orphaned chip. */
const SERIES_STATUS_SR_PREFIX = "Series status";

const PREVIEW_UNAVAILABLE_TITLE = "The next dates could not be read";
const PREVIEW_UNAVAILABLE_DESCRIPTION =
  "This series is still here; the dates its rule produces are not shown because the data behind them could not be read, so nothing stands in for them.";

const PREVIEW_UNKNOWN_TITLE = "The next dates are not confirmed";
const PREVIEW_UNKNOWN_DESCRIPTION =
  "Whether the rule produced new dates after this change is not known yet, so no date is shown in place of the answer.";

const PREVIEW_ENDED_TITLE = "No further dates on this plan";
const PREVIEW_ENDED_DESCRIPTION =
  "The series has reached the end its rule states, so the rule produces no further date to preview.";

/**
 * The next dates of one recurring task series, the single actionable occurrence among them, and the
 * resolution each shortened month forced.
 *
 * A description rather than a control: the occurrence actions belong to the series surface that
 * hosts this block, so nothing here completes, skips, pauses or stops anything.
 */
export default function SeriesPreview({
  state,
  profile,
  planningTimeZone,
  reading,
  className,
}: SeriesPreviewProps): ReactElement {
  // Hook first and unconditionally, so the label association below survives every branch.
  const previewLabelId = useId();

  if (reading.status === "unavailable") {
    return (
      <StateNotice
        kind="unavailable"
        title={PREVIEW_UNAVAILABLE_TITLE}
        description={PREVIEW_UNAVAILABLE_DESCRIPTION}
        source={reading.source}
        retry={reading.retry}
        className={className}
      />
    );
  }

  if (reading.status === "unknown") {
    return (
      <StateNotice
        kind="unknown"
        title={PREVIEW_UNKNOWN_TITLE}
        description={PREVIEW_UNKNOWN_DESCRIPTION}
        operationId={reading.operationId}
        retry={reading.retry}
        className={className}
      />
    );
  }

  const stopped = state === "stopped";
  const dates = reading.dates.slice(0, MAX_PREVIEWED_DATES);

  // An end the rule states is a complete answer, not a blank one: the series produces no next date,
  // and a stopped series is described by its own note rather than reported as ended.
  if (!stopped && dates.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={PREVIEW_ENDED_TITLE}
        description={PREVIEW_ENDED_DESCRIPTION}
        className={className}
      />
    );
  }

  const actionableKey = serialiseCivilDate(reading.actionableDueOn);
  const resolutionByDate = new Map<string, DisclosedMonthDayResolution>(
    reading.monthDayResolutions.map((resolution): [string, DisclosedMonthDayResolution] => [
      serialiseCivilDate(resolution.dueOn),
      resolution,
    ]),
  );
  const displayedKeys = new Set(dates.map(serialiseCivilDate));
  // A resolution whose date is not among the previewed ones is still a fact about this plan, so it
  // is stated once above the list rather than dropped.
  const unattachedResolutions = reading.monthDayResolutions.filter(
    (resolution) => !displayedKeys.has(serialiseCivilDate(resolution.dueOn)),
  );
  const actionableShown = dates.some((date) => serialiseCivilDate(date) === actionableKey);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{REPEAT_PROFILE_LABELS[profile]}</p>
        <StatusBadge
          label={SERIES_STATE_LABELS[state]}
          tone={SERIES_STATE_TONES[state]}
          srPrefix={SERIES_STATUS_SR_PREFIX}
        />
      </div>

      <p className="text-sm text-muted-foreground">{REPEAT_PROFILE_DESCRIPTIONS[profile]}</p>

      {state === "paused" ? (
        <p className="text-sm text-muted-foreground">{PAUSED_NOTE}</p>
      ) : null}

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
                {resolutionSentence(resolution)}{" "}
                <bdi>
                  <time dateTime={key} className="tabular-figures">
                    {displayCivilDate(resolution.dueOn)}
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
                      {displayCivilDate(date)}
                    </time>
                  </bdi>
                  <StatusBadge
                    label={isActionable ? ACTIONABLE_DATE_LABEL : PREVIEW_DATE_LABEL}
                    tone={isActionable ? "info" : "muted"}
                    srPrefix={DATE_STATUS_SR_PREFIX}
                  />
                  {resolution === undefined ? null : (
                    <p className="w-full text-sm text-muted-foreground">
                      {resolutionSentence(resolution)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {actionableShown ? (
            <p className="text-sm text-muted-foreground">{SINGLE_ACTIONABLE_OCCURRENCE_NOTE}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
