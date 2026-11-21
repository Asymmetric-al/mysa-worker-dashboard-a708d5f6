"use client";

/**
 * The version history of a coaching target, and the closed periods that each keep the version they
 * were measured against.
 *
 * Two regions, one job: show how a target's plan changed over time without ever re-rendering a closed
 * period against a later plan. The first region lists the plan's versions newest first, each with the
 * dates it covered, the quantity and the measure it set, and the word for whether it is the version in
 * force; the second lists the closed periods the read reported, each with its own dates, the figure it
 * recorded and an explicit statement of the version it was measured against (AAP 0.8.4 row 7;
 * AAP 0.10.1 "targets over four canonical measures with Weekly, Monthly and one-off Custom periods";
 * criterion 16).
 *
 * Why it exists as its own surface. A target version is prospective: a change begins a version from an
 * explicit date and closes the previous one, so a period that has already closed was measured against
 * a plan that no longer applies. Showing the current targets beside the closed periods, without the
 * version each period resolved against, is how a closed period silently acquires a later quantity —
 * the exact error this component prevents. Three distinctions are therefore carried in text and never
 * in colour alone:
 *
 * - The current version and a closed version are different facts, and each states which it is
 *   ("Current", "Closed") beside its dates.
 * - A closed period names the version it was measured against. When that version is not in the history
 *   the read could show, the row says so; naming the current version's quantity in its place would be
 *   the error above, so it is never done.
 * - A genuine zero, a paused target, an ended target and a source that could not be read stay four
 *   renderings. A `zero-recorded` period shows `0` beside the family's own sentence that a count of
 *   zero says nothing about effort; an `unavailable` period shows no figure at all and names the
 *   source instead.
 *
 * What it never does. It performs no date arithmetic and compares no range: the periods and the
 * versions arrive resolved from the read, so nothing here decides whether a period is closed, which
 * version covers it, or how long anything lasted. It does not total the recorded figures and computes
 * no percentage, completion rate or delta. It offers no control that would merge, restore, edit or
 * delete a version, because merging is not a capability of this release and restoring always creates a
 * new draft through the target form. There is no proration and no bridge row to show.
 *
 * Where the words come from. Measure names, target-state words and the standing guarantee sentence are
 * `../copy`'s; only the two version-state words and the empty-region notice sentences belong to this
 * surface, because no copy module words a version row or an empty history. Every date renders in its
 * exact stored civil form (`YYYY-MM-DD`) inside `<bdi>`, so a date can never be re-rendered as a
 * different day and can never reorder against a right-to-left neighbour.
 *
 * Plan items that put this file in scope: AAP 0.11.1 deliverable row
 * `apps/dashboard/src/features/coaching/**`; AAP 0.8.4 coaching rules row 7; AAP 0.10.1 family 13;
 * criterion 16.
 */

import { useId, type ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { TargetMeasure } from "@/modules/coaching/target";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";

import { COACHING_COPY, MEASURE_COPY, TARGET_STATE_COPY, TARGET_VERSION_GUARANTEE } from "../copy";

/**
 * Props of {@link TargetHistory}. Every fact is supplied by the read that produced the target;
 * nothing here is derived, aggregated or re-dated.
 */
export interface TargetHistoryProps {
  /**
   * The plan's versions as the read reported them, in the order the history was appended: the oldest
   * version first, one version per change, with no overlapping range. A closed version states the last
   * date it covered; the version in force states `null`, because a closed end would be an invented one.
   */
  readonly versions: ReadonlyArray<{
    readonly revisionId: string;
    readonly effectiveFrom: CivilDate;
    readonly effectiveTo: CivilDate | null;
    readonly measure: TargetMeasure;
    readonly quantity: number;
    readonly calendarStart: CivilDate;
    readonly state: "open" | "closed";
  }>;

  /**
   * The closed periods the read reported, each with the identity of the version it was measured
   * against and the figure it recorded. `recorded` is rendered exactly as supplied — `0` is a value —
   * and a period whose source could not be read says so instead of carrying a `0`.
   */
  readonly closedPeriods: ReadonlyArray<{
    readonly periodStart: CivilDate;
    readonly periodEnd: CivilDate;
    readonly measuredAgainstRevisionId: string;
    readonly recorded: number;
    readonly state: "zero-recorded" | "recorded" | "paused" | "ended" | "unavailable";
  }>;

  /**
   * The interface locale the page resolved, recorded on the region and never applied: every fact here
   * is written in its exact stored form (`YYYY-MM-DD` for a civil date, plain digits for a whole
   * count), so no reader's preference can re-render a date as a different day or a count as a
   * different number.
   */
  readonly locale: string;

  /**
   * The source that could not be read for the figures on this surface, when the read reported one. It
   * names the source beside an unreadable period and, when no period could be read at all, replaces
   * the empty list rather than presenting an outage as an empty history.
   */
  readonly unavailable?: { readonly source: SourceReference } | null;

  /** Layout classes for the block this surface occupies. Never a colour, radius or shadow. */
  readonly className?: string;
}

/** One version of the plan, as the read reported it. */
type Version = TargetHistoryProps["versions"][number];

/** One closed period and the figure it recorded. */
type ClosedPeriod = TargetHistoryProps["closedPeriods"][number];

/** The five readings a closed period may have, taken from the props rather than restated. */
type ClosedPeriodState = ClosedPeriod["state"];

/** The state word of a version and the tone that reinforces it. */
interface VersionStateCopy {
  readonly label: string;
  readonly tone: StatusTone;
}

/**
 * The two version states, worded here because no copy module words a version row.
 *
 * "Current" says the version is the plan in force, which is the only version whose count can still
 * change; "Closed" says the version ended on a stated date and that every period it covered keeps it.
 * The tone only reinforces the word, so neither state depends on a colour.
 */
const VERSION_STATE_COPY: Readonly<Record<Version["state"], VersionStateCopy>> = {
  open: { label: "Current", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
};

/** What one closed-period reading renders: its word, its sentence and whether it can show a figure. */
interface ClosedPeriodCopy {
  /** The state word, or `null` when the recorded figure is the whole statement. */
  readonly word: string | null;
  readonly tone: StatusTone;
  /** The family's own sentence for the state; `null` when the state needs none. */
  readonly sentence: string | null;
  /** Whether a recorded figure exists to show. `unavailable` never shows one, not even a zero. */
  readonly showsFigure: boolean;
}

/**
 * How each of the five closed-period readings is worded and what it may show.
 *
 * The four states beyond `recorded` take their words and sentences from `../copy`, which owns the
 * distinction between a count of zero and a judgement about effort, between a paused target and an
 * ended one, and between an outage and an empty period. `recorded` carries no badge: the figure states
 * itself, and a badge saying "recorded" beside a recorded figure would be a second word for one fact.
 * `unavailable` is the one reading with no figure at all, so an unreadable count can never appear as
 * the number zero.
 */
const CLOSED_PERIOD_COPY: Readonly<Record<ClosedPeriodState, ClosedPeriodCopy>> = {
  recorded: { word: null, tone: "neutral", sentence: null, showsFigure: true },
  "zero-recorded": {
    word: TARGET_STATE_COPY["zero-recorded"].label,
    tone: "muted",
    sentence: TARGET_STATE_COPY["zero-recorded"].description,
    showsFigure: true,
  },
  paused: {
    word: TARGET_STATE_COPY.paused.label,
    tone: "caution",
    sentence: TARGET_STATE_COPY.paused.description,
    showsFigure: true,
  },
  ended: {
    word: TARGET_STATE_COPY.ended.label,
    tone: "neutral",
    sentence: TARGET_STATE_COPY.ended.description,
    showsFigure: true,
  },
  unavailable: {
    word: TARGET_STATE_COPY.unavailable.label,
    tone: "danger",
    sentence: TARGET_STATE_COPY.unavailable.description,
    showsFigure: false,
  },
};

/** The heading of the version region. The list takes its accessible name from this heading. */
const VERSIONS_HEADING = "Version history";

/** What the version region is for, stated once above its rows. */
const VERSIONS_DESCRIPTION =
  "Each version is the plan in force from its first date until the day before the next version " +
  "begins, so a period falls inside exactly one of them.";

/** The heading of the closed-period region. The list takes its accessible name from this heading. */
const PERIODS_HEADING = "Closed periods";

/** What the closed-period region is for, stated once above its rows. */
const PERIODS_DESCRIPTION =
  "A period appears here once its calendar has completed, with the version it was measured against " +
  "and the figure that version's measure recorded.";

/** What the version region says when the read reported no version at all. */
const NO_VERSIONS_TITLE = "No version recorded yet";

const NO_VERSIONS_DESCRIPTION =
  "A target records its first version on the date it is set, and every later change to the quantity, " +
  "the measure or the calendar start records another one from the date it takes effect.";

/** What the closed-period region says when no period has completed yet. */
const NO_PERIODS_TITLE = "No closed period yet";

const NO_PERIODS_DESCRIPTION =
  "Periods of this target are still running, so none has closed and none has a settled figure. " +
  "A closed period appears here with the version it was measured against once its calendar completes.";

/** What either region says instead of a list when the source behind the history could not be read. */
const UNREADABLE_TITLE = "This history cannot be read right now";

// ---------------------------------------------------------------------------------------------
// The row-level readings
// ---------------------------------------------------------------------------------------------

/** One civil date, written exactly as it is stored and isolated from the text around it. */
function CivilDateText({ value }: { readonly value: CivilDate }): ReactElement {
  return <bdi>{serialiseCivilDate(value)}</bdi>;
}

/**
 * The dates one version covered.
 *
 * The three cases are three different facts: a version in force has no end yet, a closed version names
 * the last day it covered, and a closed version whose end the read did not state says so rather than
 * borrowing the next version's first date or naming its own start as its end.
 */
function VersionDates({ version }: { readonly version: Version }): ReactElement {
  if (version.state === "open") {
    return (
      <>
        In force from <CivilDateText value={version.effectiveFrom} /> onwards
      </>
    );
  }
  if (version.effectiveTo === null) {
    return (
      <>
        From <CivilDateText value={version.effectiveFrom} /> to a date this read does not state
      </>
    );
  }
  return (
    <>
      From <CivilDateText value={version.effectiveFrom} /> to{" "}
      <CivilDateText value={version.effectiveTo} />
    </>
  );
}

/**
 * The measure a version set, in parentheses beside its quantity.
 *
 * The measure is part of a version, so a period measured against an older version is counted in that
 * version's measure — not in the measure the target tracks now. Rendering it here keeps the figure and
 * its unit together wherever the version is named.
 */
function MeasureLabel({ measure }: { readonly measure: TargetMeasure }): ReactElement {
  return (
    <>
      {" "}
      (<bdi>{MEASURE_COPY[measure].label}</bdi>)
    </>
  );
}

/**
 * The version a closed period was measured against, stated on the period's own row.
 *
 * The lookup is by revision identity, which is the only thing that binds a period to a version. When
 * the history the read could show does not contain that version, the row says so: substituting the
 * current version's quantity is precisely what makes a closed period look as though it had been
 * measured against a plan it never saw.
 */
function MeasuredAgainstVersion({
  version,
}: {
  readonly version: Version | undefined;
}): ReactElement {
  if (version === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        The version this period was measured against is not in the history this read can show, so no
        version is named here in its place.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Measured against the version in force from <CivilDateText value={version.effectiveFrom} />,
      which set a target of <bdi className="tabular-figures">{version.quantity}</bdi>
      <MeasureLabel measure={version.measure} />.
    </p>
  );
}

/** Props of {@link NoRowsNotice}. */
interface NoRowsNoticeProps {
  /** The source that could not be read, or `null` when the region is genuinely empty. */
  readonly source: SourceReference | null;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}

/**
 * What a region shows when it has no rows at all: an outage, or a genuinely empty history.
 *
 * The two are never the same rendering. An unreadable source names itself and shows no list, because
 * an outage presented as an empty history would claim that the target has no versions or that no
 * period has closed — two facts the read never established.
 */
function NoRowsNotice({ source, emptyTitle, emptyDescription }: NoRowsNoticeProps): ReactElement {
  if (source !== null) {
    return (
      <StateNotice
        kind="unavailable"
        title={UNREADABLE_TITLE}
        description={COACHING_COPY.targets.unavailable}
        source={source}
        headingLevel={3}
      />
    );
  }
  return (
    <StateNotice kind="empty" title={emptyTitle} description={emptyDescription} headingLevel={3} />
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/**
 * A target's version history and the closed periods that keep the version they were measured against.
 * Renders the current version, every closed version and each closed period's figure beside the version
 * it resolved against; renders an empty or unreadable region as its own state rather than as a blank
 * list. Holds no state, reads no clock, aggregates nothing, and offers no control that would change the
 * target.
 */
export default function TargetHistory({
  versions,
  closedPeriods,
  locale,
  unavailable = null,
  className,
}: TargetHistoryProps): ReactElement {
  const versionsHeadingId = useId();
  const periodsHeadingId = useId();

  // The read appends one version per change, so its own order is the order the plan changed and
  // reading it backwards presents the version in force first. Reversing a copy is presentation alone:
  // no date is compared, no range is re-derived, and the lookup that binds a period to its version
  // still runs over the history exactly as the read reported it.
  const versionsNewestFirst = [...versions].reverse();
  const unreadableSource = unavailable === null ? null : unavailable.source;

  // `data-interface-locale` records the locale the page resolved without applying it: every fact below
  // is written in its exact stored form, so a reader's preference cannot re-render a civil date as a
  // different day. The attribute keeps that decision visible on the rendered region.
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-interface-locale={locale}
    >
      <p className="text-sm text-balance text-muted-foreground">{TARGET_VERSION_GUARANTEE}</p>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={versionsHeadingId}>{VERSIONS_HEADING}</h2>
          </CardTitle>
          <CardDescription>{VERSIONS_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent>
          {versionsNewestFirst.length === 0 ? (
            <NoRowsNotice
              source={unreadableSource}
              emptyTitle={NO_VERSIONS_TITLE}
              emptyDescription={NO_VERSIONS_DESCRIPTION}
            />
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
                    <p className="text-sm text-muted-foreground">
                      Target <bdi className="tabular-figures">{version.quantity}</bdi>
                      <MeasureLabel measure={version.measure} />
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={periodsHeadingId}>{PERIODS_HEADING}</h2>
          </CardTitle>
          <CardDescription>{PERIODS_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent>
          {closedPeriods.length === 0 ? (
            <NoRowsNotice
              source={unreadableSource}
              emptyTitle={NO_PERIODS_TITLE}
              emptyDescription={NO_PERIODS_DESCRIPTION}
            />
          ) : (
            <ul aria-labelledby={periodsHeadingId} className="flex min-w-0 flex-col gap-4">
              {closedPeriods.map((period, index) => {
                const stateCopy = CLOSED_PERIOD_COPY[period.state];
                const measuredAgainst = versions.find(
                  (version) => version.revisionId === period.measuredAgainstRevisionId,
                );
                const periodKey =
                  `${serialiseCivilDate(period.periodStart)}/${serialiseCivilDate(period.periodEnd)}`;
                return (
                  <li key={periodKey} className="flex min-w-0 flex-col gap-2">
                    {index === 0 ? null : <Separator />}
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-medium">
                        <CivilDateText value={period.periodStart} /> to{" "}
                        <CivilDateText value={period.periodEnd} />
                      </p>
                      {stateCopy.word === null ? null : (
                        <StatusBadge label={stateCopy.word} tone={stateCopy.tone} />
                      )}
                    </div>
                    {stateCopy.showsFigure ? (
                      <p className="text-sm">
                        Recorded <bdi className="tabular-figures">{period.recorded}</bdi>
                        {measuredAgainst === undefined ? null : (
                          <MeasureLabel measure={measuredAgainst.measure} />
                        )}
                      </p>
                    ) : null}
                    {stateCopy.sentence === null ? null : (
                      <p className="text-sm text-muted-foreground">{stateCopy.sentence}</p>
                    )}
                    {period.state === "unavailable" && unreadableSource !== null ? (
                      <p className="text-sm text-muted-foreground">
                        Source{" "}
                        <bdi className="mono-identifier">
                          {formatSourceReference(unreadableSource)}
                        </bdi>
                        .
                      </p>
                    ) : null}
                    <MeasuredAgainstVersion version={measuredAgainst} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

