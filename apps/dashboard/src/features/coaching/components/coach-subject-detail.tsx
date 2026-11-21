"use client";

/**
 * The coach's read-only view of one admitted subject: a tab for each module the worker switched on,
 * and nothing else.
 *
 * What this surface is. The worker chooses, module by module, what a coach may read (AAP 0.8.4,
 * `modules/coaching/grant`). This component is the coach's side of that choice and it presents exactly
 * what the read handed it: the subject's name, the episode's lifecycle word, the frozen cutoff the
 * envelope states, and one tab per admitted module carrying that module's own read state. Authorisation
 * happened before the read this component renders, so a module the worker never switched on has no tab
 * here — not a disabled one, not an empty one, and no wording that would tell a coach it exists.
 *
 * The five module read states stay five renderings. `empty` is a period with nothing recorded,
 * `partial` is a period only partly readable, `withheld` is content held until the worker reviews it
 * again, `unavailable` is a source that cannot be read at the moment, and `ended` is a share whose
 * dates have run out. `ended` deliberately does not reuse the outage treatment: an ending is not a
 * temporary failure, so it takes the calendar statement rather than the unavailable notice, and one
 * module's outage never removes the other admitted modules' tabs or content.
 *
 * What it refuses to hold. No gift, allocation, commitment or donor row; no target's private label; no
 * amount at gift grain; no cutoff this component computes, compares or shortens; no percentage and no
 * total; no financial range rebuilt from parts. The reviewed range a worker shares is presented by the
 * reviewed-range surface the route composes, so a `financial-range` body here states the module's read
 * state and no figures at all. The bodies are declared locally as a discriminated union naming only the
 * fields this view draws, which is what makes those omissions a property of the type rather than a
 * promise in a comment.
 *
 * Read-only, in structure and in words. This component declares no mutation, renders no form, no field
 * and no submit control of any kind, and its one statement about the coach's powers says what a coach
 * cannot do. Stopping a share — leaving, revoking, ending, withdrawing — happens on the routes that own
 * those commands; nothing here implies the coach can act, and nothing here claims that stopping a share
 * recalls what was already read.
 *
 * Composition. It draws on the patterns the application already owns rather than new ones: the design
 * system's `Tabs`/`Card`/`Alert`, the one empty/unavailable surface (`components/state-notice`), the one
 * status label (`components/status-badge`), and — for recorded target counts only — the one chart with a
 * data-table alternative (`components/chart-figure`). The family's words come from
 * `features/coaching/copy`; the states and the module list come from `modules/coaching/grant`. Nothing
 * here reads a clock, formats money, branches on the viewer's timezone zone or computes a difference.
 *
 * Accessibility and narrow screens. Tab order follows reading order and the tab list is operable with the
 * arrow keys the tab primitive supplies; every panel is named by its tab and by its own label; headings
 * descend inside the page (subject `h2`, module `h3`, notice `h4`). At 320 CSS px the tab list wraps onto
 * further rows inside its own labelled strip instead of scrolling the page sideways, and the chart's
 * table alternative keeps its own labelled scroll region, so the page itself never scrolls horizontally.
 */

import { CalendarXIcon, EyeOffIcon, HourglassIcon } from "lucide-react";
import { useId, type ReactElement } from "react";

import {
  ChartFigure,
  type ChartPoint,
  type ChartSeries,
  type ChartTable,
} from "@/components/chart-figure";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, {
  COACHING_STATUS,
  statusBadgeProps,
  VALUE_STATE_WORDS,
  valueStateWord,
  type StatusTone,
} from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  COACHING_COPY,
  GRANT_STATE_COPY,
  MODULE_COPY,
  MODULE_READ_STATE_COPY,
} from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import {
  MODULE_KEYS,
  type GrantLifecycleState,
  type ModuleKey,
  type ModuleReadState,
} from "@/modules/coaching/grant";
import type { TaskShareSummaryState } from "@/modules/coaching/taskshare";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import {
  parseCivilDate,
  serialiseCivilDate,
  type CivilDate,
  type DatePrecision,
} from "@/modules/time/civil";

// ---------------------------------------------------------------------------------------------
// Wording this surface owns
// ---------------------------------------------------------------------------------------------

/**
 * The sentences that describe *this* surface rather than a module's state.
 *
 * The family's vocabulary lives in `features/coaching/copy`, and every state word and module name is read
 * from there. Two facts have no entry in it because they belong to the coach's side of a share and to
 * nothing else: the sentence that states the frozen cutoff's meaning, and the one sentence that states what
 * a coach cannot do. Writing them beside the only surface that renders them keeps a single statement of
 * each; a copy map that carried them would have them read on the worker's screens, where the coach's powers
 * are not the subject.
 */
const CUTOFF_MEANING =
  "Access ends at this instant, and a read at it is denied. The modules below stay readable only until " +
  "then; nothing on this page extends or moves that end.";
const CUTOFF_ABSENT = "This relationship states no end instant, so this page states none.";
const READ_ONLY_STATEMENT =
  "This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, " +
  "remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was " +
  "already read.";

/** The lead-in for the lifecycle label, so a screen reader hears "Access: active" and not a bare word. */
const LIFECYCLE_SR_PREFIX = "Access";

/** The tab strip's accessible name: which modules this worker shares, and nothing more. */
const MODULE_TABS_LABEL = "Modules this worker shares";

/** One shared check-in's own facts: when the revision was shared, and the questions it captured. */
const SHARED_ON_LABEL = "Shared on";
const NO_QUESTIONS_STATEMENT = "This shared revision carries no questions.";

/**
 * What an unanswered question states.
 *
 * A check-in may be shared with a question the worker left blank, and a blank cell would read as a fault in
 * the page rather than as the fact that nothing was written. The absence is therefore stated in words — the
 * same rule the module's `partial` sentence holds to, that what is missing is stated and never counted as
 * zero.
 */
const NO_ANSWER_WORD = "No answer recorded";

/** One shared task summary's two live facts. The status word itself arrives from the read. */
const DUE_DATE_LABEL = "Due";
const STATUS_LABEL = "Status";
const NO_DUE_DATE_WORD = "No due date";

/**
 * How a recorded date precision is stated beside a due date.
 *
 * A due date is a civil date, so it renders in its stored `YYYY-MM-DD` form and never as a midnight in
 * some zone. When the precision is not exact the word says so rather than dressing the date up as one
 * that was confirmed: `null` means the date is exact and needs no word.
 */
const DUE_PRECISION_WORD: Readonly<Record<DatePrecision, string | null>> = {
  date: null,
  approximate: "approximate",
  unknown: "date not confirmed",
};

/** The lead-in for a task summary's own label, so "Shared" is never read as a bare word. */
const SHARE_STATE_SR_PREFIX = "Summary";

/**
 * The lead-in for a module's state word. It says "state" rather than repeating the module's name, which the
 * panel heading and the tab already carry, so a screen reader hears "state: partly covered" once.
 */
const MODULE_STATE_SR_PREFIX = "State";

/**
 * The four readings of a shared task summary, worded for the coach who reads it.
 *
 * The family's `TASK_SHARE_STATE_COPY` states these same four facts to the worker who does the sharing, in
 * the worker's own voice — "held until you review it", "you stopped sharing this summary". A coach reading
 * that would be told that a control exists here for them to press, and this surface must never imply the
 * coach can act on anything. So the four facts are stated once, for the reader who can only read, with the
 * action named as the worker's: the readings stay four, the actor stays named, and nothing is reworded
 * where the family's own map already speaks to everybody (the module's own state statement).
 */
const COACH_SHARE_STATE_COPY: Readonly<
  Record<TaskShareSummaryState, { readonly label: string; readonly sentence: string }>
> = {
  shared: {
    label: "Shared",
    sentence:
      "The worker reviewed this description against the task as it stands, so it is current.",
  },
  "needs-review": {
    label: "Held until reviewed",
    sentence:
      "The reviewed meaning changed, so the description is withheld until the worker reviews it again. " +
      "Nothing of it is shown in the meantime, and this is not an empty share.",
  },
  removed: {
    label: "No longer shared",
    sentence:
      "The worker stopped sharing this summary. The task itself keeps working; only this summary is " +
      "withdrawn from this view.",
  },
  unavailable: {
    label: "Unavailable",
    sentence:
      "The task behind this summary cannot be read at the moment. This is an outage, not an empty " +
      "share and not a removal.",
  },
};

/**
 * The one sentence a grant that shares no module states to its coach.
 *
 * The family's portfolio sentence describes a relationship that has not been set up yet, which is what a
 * coach reads before an invitation exists — and it would be the wrong explanation here, where the
 * relationship exists and simply shares nothing (an invitation not yet accepted, a revoked grant, an
 * ended relationship or dates that ran out, each stated by the lifecycle word beside it).
 */
const NOTHING_SHARED_SENTENCE =
  "No module is shared with you under this relationship, so there is nothing here to read. The " +
  "lifecycle word above says why.";

/**
 * The recorded-counts figure: what the targets module draws, in its own words.
 *
 * These are chart words, not family vocabulary: they say what the figure plots, in what unit, and what it
 * does with a period that has no recorded value, which is the honesty rule `chart-figure` applies to
 * every chart in the application. No private label, no percentage and no total appears in any of them.
 */
const TARGETS_SERIES_LABEL = "Recorded";
const TARGETS_UNITS = "Recorded counts per period";
const TARGETS_CHART_SUMMARY =
  "Each bar is the count recorded for one period, taken from the activity the worker logged. A period " +
  "with no recorded value is named in the table beneath the chart rather than drawn as zero.";
const TARGETS_CHART_CAPTION = "Bar chart of recorded target counts by period for this worker.";
const TARGETS_TABLE_CAPTION =
  "Recorded target counts by period, the data table alternative to the chart.";
const PERIOD_COLUMN_LABEL = "Period";

// ---------------------------------------------------------------------------------------------
// What a caller passes
// ---------------------------------------------------------------------------------------------

/**
 * A civil date as this component may receive it: the parsed `Temporal.PlainDate`, or the stored `YYYY-MM-DD`
 * form.
 *
 * Both are admitted because these props cross the server/client boundary, and a `Temporal` value is a class
 * instance that boundary cannot serialise — a route reading the service therefore hands over the stored form
 * the record holds. Neither is interpreted as an instant: no zone is derived and no midnight is fabricated.
 */
type CivilDateInput = CivilDate | string;

/** One question of a shared check-in, exactly as the worker worded and answered it. */
interface SharedCheckInQuestion {
  readonly wording: string;
  readonly answer: string;
}

/** One check-in revision the worker deliberately shared: its shared date and its captured questions. */
interface SharedCheckIn {
  readonly checkInId: string;
  readonly sharedAt: string;
  readonly questions: readonly SharedCheckInQuestion[];
}

/** The facts every task summary states, whatever its reading. */
interface SharedTaskSummaryBase {
  readonly shareId: string;
  readonly dueOn: CivilDateInput | null;
  readonly duePrecision: DatePrecision;
  readonly status: string;
}

/**
 * One task summary as this view draws it: the reviewed description, the live due date and the live status.
 *
 * `state` is `TaskShareSummaryState` — the reading a coach-facing surface renders — and not the stored
 * two-state lifecycle. The wider union is required here: `needs-review` is the reading that withholds the
 * description until the worker reviews it again, and a narrower type could not express it, so a held summary
 * would have to be drawn as a shared one.
 *
 * A description exists on the `shared` reading only. The pairing is a type rather than a rendering rule
 * because withholding has to happen before the value is handed over, not while it is painted: these props
 * cross the server/client boundary, and React serialises every prop it is given into the page, so a
 * description passed beside a held or removed reading would sit in the delivered markup while the panel
 * showed nothing. Typing it away makes that a compile error in the route that builds the props.
 */
type SharedTaskSummary =
  | (SharedTaskSummaryBase & { readonly state: "shared"; readonly reviewedDescription: string })
  | (SharedTaskSummaryBase & {
      readonly state: Exclude<TaskShareSummaryState, "shared">;
      readonly reviewedDescription: null;
    });

/** One period's recorded count, with the state the read recorded for it. */
interface TargetProgressFigure {
  readonly periodLabel: string;
  readonly value: number | null;
  readonly valueState: ValueState;
}

/**
 * The content one module may carry on this surface, one arm per module, naming only the fields drawn.
 *
 * The union is declared here rather than reused from the service view on purpose: a type that cannot hold
 * a gift row, a commitment, a donor identity, a private target label or a per-record amount is what stops
 * one reaching this component, and `financial-range` carries no figures at all because the reviewed range
 * is presented where the worker reviewed it.
 */
type ModuleBody =
  | { readonly kind: "check-ins"; readonly items: readonly SharedCheckIn[] }
  | { readonly kind: "task-shares"; readonly items: readonly SharedTaskSummary[] }
  | {
      readonly kind: "target-progress";
      readonly figures: readonly TargetProgressFigure[];
      readonly coverage: Coverage;
      readonly asOf: string;
    }
  | { readonly kind: "financial-range"; readonly alreadyRendered: false };

/**
 * One admitted module: its key, its read state and the content the read supplied.
 *
 * `state` admits `null` because a shared module with content and no adverse reading has nothing to state
 * beside it — the service records exactly that — and inventing "empty" for such a module would report an
 * absence the read never claimed.
 */
interface AdmittedModule {
  readonly key: ModuleKey;
  readonly state: ModuleReadState | null;
  readonly body: ModuleBody;
}

/** Props of {@link CoachSubjectDetail}: the subject's identity and lifecycle, and the admitted modules. */
interface CoachSubjectDetailProps {
  readonly subject: {
    readonly subjectId: string;
    readonly displayName: string;
    readonly grantState: GrantLifecycleState;
    readonly cutoffDisplay: { readonly instant: string; readonly zone: string } | null;
  };
  readonly modules: readonly AdmittedModule[];
  readonly unavailableSource?: SourceReference | null;
  readonly locale: string;
}

// ---------------------------------------------------------------------------------------------
// The tone each reading carries
// ---------------------------------------------------------------------------------------------

/**
 * How a module's read state reads, in the status vocabulary's own tones.
 *
 * The words are `MODULE_READ_STATE_COPY`'s; only the tone is stated here, and it is the tone the worker's
 * own sharing screen gives the same reading, so one state cannot read as adverse on one screen and quiet on
 * the other. The five are deliberately distinct: an outage is the one adverse tone, an ended share is
 * neutral (a date passed, nobody failed), and a held module is the cautious one because something waits on
 * the worker rather than on the source.
 */
const MODULE_STATE_TONE: Readonly<Record<ModuleReadState, StatusTone>> = {
  empty: "muted",
  partial: "info",
  withheld: "caution",
  unavailable: "danger",
  ended: "neutral",
};

/**
 * How one task summary's reading reads. `needs-review` is cautious rather than adverse — the summary is
 * held, not refused — and `removed` is neutral because the worker stopping a share is not a failure.
 */
const SHARE_STATE_TONE: Readonly<Record<TaskShareSummaryState, StatusTone>> = {
  shared: "positive",
  "needs-review": "caution",
  removed: "neutral",
  unavailable: "danger",
};

/**
 * One static statement in the design system's alert frame, with its own icon and its own word.
 *
 * `role` is removed because every statement here describes a state the panel is already showing: nothing
 * announces itself on mount, so the one announcing region on the surface stays the notice that reports a
 * change of condition. The tone is always the default one — an ending, a hold and a partial period are
 * facts to read rather than alarms to raise.
 */
function StatementAlert({
  icon,
  label,
  sentence,
}: {
  readonly icon: ReactElement;
  readonly label: string;
  readonly sentence: string;
}): ReactElement {
  return (
    <Alert role={undefined} variant="default">
      {icon}
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>{sentence}</AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------------------------
// The five module read states
// ---------------------------------------------------------------------------------------------

/**
 * The statement one module's read state carries, or `null` when the read stated no state at all.
 *
 * An empty module uses the application's one empty surface and an unreadable source its one unavailable
 * surface, so neither can be rendered as the other or as a zero. `partial`, `withheld` and `ended` take
 * the alert frame with their own icon and their own sentence; `ended` keeps a calendar icon so it can
 * never be mistaken for the outage, and `partial` states its own sentence because the
 * `partial-coverage` notice speaks about what a *total* over a period means and a coaching module carries
 * no total at all.
 */
function ModuleStateStatement({
  state,
  unavailableSource,
}: {
  readonly state: ModuleReadState | null;
  readonly unavailableSource: SourceReference | null | undefined;
}): ReactElement | null {
  if (state === null) {
    return null;
  }

  const copy = MODULE_READ_STATE_COPY[state];

  switch (state) {
    case "empty":
      return (
        <StateNotice
          kind="empty"
          headingLevel={4}
          title={copy.label}
          description={copy.description}
        />
      );
    case "partial":
      return (
        <StatementAlert
          icon={<HourglassIcon aria-hidden="true" />}
          label={copy.label}
          sentence={copy.description}
        />
      );
    case "withheld":
      return (
        <StatementAlert
          icon={<EyeOffIcon aria-hidden="true" />}
          label={copy.label}
          sentence={copy.description}
        />
      );
    case "ended":
      return (
        <StatementAlert
          icon={<CalendarXIcon aria-hidden="true" />}
          label={copy.label}
          sentence={copy.description}
        />
      );
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          headingLevel={4}
          title={copy.label}
          description={copy.description}
          source={unavailableSource ?? undefined}
        />
      );
  }
}

// ---------------------------------------------------------------------------------------------
// The shared check-ins module
// ---------------------------------------------------------------------------------------------

/** One shared check-in: when the revision was shared, then the questions it captured, in order. */
function CheckInList({ checkIns }: { readonly checkIns: readonly SharedCheckIn[] }): ReactElement {
  return (
    <ul className="flex min-w-0 flex-col gap-4">
      {checkIns.map((checkIn) => (
        <li key={checkIn.checkInId} className="flex min-w-0 flex-col gap-2">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="font-medium">{SHARED_ON_LABEL}</span>
            <bdi className="mono-identifier">{checkIn.sharedAt}</bdi>
          </p>
          {checkIn.questions.length === 0 ? (
            <p className="text-sm text-pretty text-muted-foreground">{NO_QUESTIONS_STATEMENT}</p>
          ) : (
            <dl className="flex min-w-0 flex-col gap-2">
              {checkIn.questions.map((question, index) => (
                // The captured order is the order the worker wrote, which is why the position is part of
                // the key: two questions may legitimately be worded identically.
                <div
                  key={`${checkIn.checkInId}-question-${String(index)}`}
                  className="flex min-w-0 flex-col gap-0.5"
                >
                  <dt className="text-sm font-medium text-pretty">{question.wording}</dt>
                  {question.answer.trim().length === 0 ? (
                    <dd className="text-sm text-pretty text-muted-foreground">{NO_ANSWER_WORD}</dd>
                  ) : (
                    <dd className="whitespace-pre-line text-sm text-pretty text-muted-foreground">
                      {question.answer}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// The task summaries module
// ---------------------------------------------------------------------------------------------

/**
 * A civil date in its stored `YYYY-MM-DD` form.
 *
 * A date that cannot be read is kept exactly as it arrived rather than dropped or replaced: an unreadable
 * date is a fact about the data, and showing nothing would state a task has no due date.
 */
function civilDateText(value: CivilDateInput): string {
  if (typeof value !== "string") {
    return serialiseCivilDate(value);
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : value.trim();
}

/**
 * One task summary's due date: the civil date in its stored form, with its precision word when the date
 * was not recorded exactly.
 */
function DueDateText({ share }: { readonly share: SharedTaskSummary }): ReactElement {
  if (share.dueOn === null) {
    return <bdi>{NO_DUE_DATE_WORD}</bdi>;
  }

  const word = DUE_PRECISION_WORD[share.duePrecision];

  return (
    <>
      <bdi className="mono-identifier">{civilDateText(share.dueOn)}</bdi>
      {word === null ? null : <span className="text-muted-foreground">{` (${word})`}</span>}
    </>
  );
}

/**
 * The reviewed task summaries, each with the live due date and the live status beside it.
 *
 * The reviewed description is drawn only while the summary's reading is `shared`, and only when the read
 * supplied one: a summary whose reviewed meaning changed is withheld in full, so nothing of it is shown
 * and the state's own sentence says why. The status word arrives from the read and is never spelled here,
 * so this file cannot disagree with the task it came from.
 */
function TaskShareList({
  shares,
}: {
  readonly shares: readonly SharedTaskSummary[];
}): ReactElement {
  return (
    <ul className="flex min-w-0 flex-col gap-4">
      {shares.map((share) => {
        const stateCopy = COACH_SHARE_STATE_COPY[share.state];
        const description = share.state === "shared" ? share.reviewedDescription : null;
        const status = share.status.trim();

        return (
          <li key={share.shareId} className="flex min-w-0 flex-col gap-2">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <StatusBadge
                label={stateCopy.label}
                tone={SHARE_STATE_TONE[share.state]}
                srPrefix={SHARE_STATE_SR_PREFIX}
              />
              <span className="flex min-w-0 items-baseline gap-x-1.5">
                <span className="font-medium">{DUE_DATE_LABEL}</span>
                <DueDateText share={share} />
              </span>
              {status.length === 0 ? null : (
                <span className="flex min-w-0 items-baseline gap-x-1.5">
                  <span className="font-medium">{STATUS_LABEL}</span>
                  <bdi>{status}</bdi>
                </span>
              )}
            </p>
            {description === null || description.trim().length === 0 ? null : (
              <p className="whitespace-pre-line text-sm text-pretty">{description}</p>
            )}
            {share.state === "shared" ? null : (
              <p className="text-sm text-pretty text-muted-foreground">{stateCopy.sentence}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// The targets module
// ---------------------------------------------------------------------------------------------

/**
 * The text the figure's data-table alternative states for one period.
 *
 * It agrees with what the chart draws, from the same two inputs and without reformatting an amount: a
 * count is a count and carries no currency exponent, a recorded zero is stated as zero, a value the read
 * could not establish keeps its own word rather than becoming a zero, and a figure drawn from a partly
 * covered period keeps the marker that says so.
 */
function figureText(figure: TargetProgressFigure): string {
  const { value, valueState } = figure;
  const carriesNumber = value !== null && Number.isFinite(value);
  const word = valueStateWord(valueState);

  if (word === undefined) {
    if (valueState === "zero") {
      return String(0);
    }
    return carriesNumber ? String(value) : VALUE_STATE_WORDS.unknown.label;
  }

  return carriesNumber ? `${String(value)} (${word.label})` : word.label;
}

/** The recorded-counts figure: one bar per period, with the same values in a table beneath it. */
function TargetProgressChart({
  body,
  locale,
}: {
  readonly body: Extract<ModuleBody, { readonly kind: "target-progress" }>;
  readonly locale: string;
}): ReactElement {
  const points: readonly ChartPoint[] = body.figures.map((figure) => ({
    bucket: figure.periodLabel,
    value: figure.value,
    state: figure.valueState,
  }));

  const series: readonly ChartSeries[] = [{ key: "recorded", label: TARGETS_SERIES_LABEL, points }];

  const table: ChartTable = {
    caption: TARGETS_TABLE_CAPTION,
    columns: [
      { key: "period", label: PERIOD_COLUMN_LABEL },
      { key: "recorded", label: TARGETS_SERIES_LABEL },
    ],
    rows: body.figures.map((figure) => ({
      period: figure.periodLabel,
      recorded: figureText(figure),
    })),
  };

  return (
    <ChartFigure
      title={MODULE_COPY.targets.name}
      summary={TARGETS_CHART_SUMMARY}
      caption={TARGETS_CHART_CAPTION}
      kind="bar"
      series={series}
      units={TARGETS_UNITS}
      coverage={body.coverage}
      asOf={body.asOf}
      table={table}
      locale={locale}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// The content one admitted module draws
// ---------------------------------------------------------------------------------------------

/**
 * Which body kind each module may carry here.
 *
 * A read that paired a module key with another module's content would put that content under the wrong
 * name — a check-in drawn as a target, or a summary as a check-in — which is exactly the kind of
 * misattribution this family exists to prevent. The pairing is therefore checked before anything is
 * drawn, and a mismatched pair leaves the module's own state statement standing alone rather than showing
 * content the module does not own.
 */
const EXPECTED_BODY_KIND: Readonly<Record<ModuleKey, ModuleBody["kind"]>> = {
  "support-goal": "financial-range",
  "support-results": "financial-range",
  targets: "target-progress",
  "check-ins": "check-ins",
  "task-summaries": "task-shares",
};

/** The content one module draws, or `null` when this module states no content of its own on this page. */
function ModuleBodyView({
  body,
  locale,
}: {
  readonly body: ModuleBody;
  readonly locale: string;
}): ReactElement | null {
  switch (body.kind) {
    case "check-ins":
      return body.items.length === 0 ? null : <CheckInList checkIns={body.items} />;
    case "task-shares":
      return body.items.length === 0 ? null : <TaskShareList shares={body.items} />;
    case "target-progress":
      return <TargetProgressChart body={body} locale={locale} />;
    case "financial-range":
      /*
       * No figures, by contract. A reviewed financial range is presented by the reviewed-range surface
       * the route composes from the range the worker approved, so this panel states the module's read
       * state and nothing else: rebuilding a range, a subtotal or a per-record amount here would be a
       * second answer to a question the reviewed range already answers, and could show a coach a figure
       * the worker never reviewed. `financial-range` bodies are fixed to `alreadyRendered: false`
       * precisely so nothing in this component can present one as drawn.
       */
      return null;
  }
}

/**
 * One admitted module's panel: its name, its read state and the content that state allows.
 *
 * The family's `MODULE_COPY` description is not rendered here. It explains a disclosure to the person making
 * it — "the targets you set", "the name you give a target stays with you" — so on a coach's screen it would
 * address the reader as the author of choices they did not make. The name, the state word and the state's own
 * sentence say what this module is and how it reads, without telling a coach that any of it is theirs.
 */
function ModulePanel({
  entry,
  unavailableSource,
  locale,
}: {
  readonly entry: AdmittedModule;
  readonly unavailableSource: SourceReference | null | undefined;
  readonly locale: string;
}): ReactElement {
  const baseId = useId();
  const titleId = `${baseId}-module-title`;
  const copy = MODULE_COPY[entry.key];
  const stateCopy = entry.state === null ? null : MODULE_READ_STATE_COPY[entry.state];
  const body = entry.body.kind === EXPECTED_BODY_KIND[entry.key] ? entry.body : null;
  // Content is drawn only when the read states no adverse reading, or states that part of the period could
  // be read. An empty, held, ended or unreadable module shows its own statement and nothing else.
  const drawsContent = entry.state === null || entry.state === "partial";

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 id={titleId} className="text-base font-medium text-pretty">
              <bdi>{copy.name}</bdi>
            </h3>
          </CardTitle>
          {stateCopy === null || entry.state === null ? null : (
            <CardAction>
              <StatusBadge
                label={stateCopy.label}
                tone={MODULE_STATE_TONE[entry.state]}
                srPrefix={MODULE_STATE_SR_PREFIX}
              />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <ModuleStateStatement state={entry.state} unavailableSource={unavailableSource} />
          {drawsContent && body !== null ? <ModuleBodyView body={body} locale={locale} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/**
 * The admitted modules in the order `MODULE_KEYS` declares them, with a repeated key kept once.
 *
 * Order is the module list's own, not the caller's, so two reads of the same grant put the tabs in the same
 * places. A key the read supplied twice keeps its first entry and no second tab, which is the one case in
 * which "fewer tabs" is right: two tabs for one module would show the same content under two controls. A
 * key the read did not supply is absent — no placeholder, no disabled tab and no wording that names it.
 */
function admittedInOrder(modules: readonly AdmittedModule[]): readonly AdmittedModule[] {
  const byKey = new Map<ModuleKey, AdmittedModule>();

  for (const entry of modules) {
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }

  return MODULE_KEYS.flatMap((key) => {
    const found = byKey.get(key);
    return found === undefined ? [] : [found];
  });
}

/**
 * Read-only coach view of one admitted subject: a tab per module the worker switched on, each carrying its
 * own empty, partial, withheld, unavailable or ended reading, and no control anywhere that could write.
 */
export default function CoachSubjectDetail({
  subject,
  modules,
  unavailableSource,
  locale,
}: CoachSubjectDetailProps): ReactElement {
  const headingId = useId();
  const admitted = admittedInOrder(modules);
  const first = admitted[0];
  const lifecycle = GRANT_STATE_COPY[subject.grantState];
  const lifecycleTone = statusBadgeProps(COACHING_STATUS, subject.grantState).tone;
  const cutoff = subject.cutoffDisplay;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-5">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="text-lg font-semibold text-pretty">
              {/* The name is data from another system: isolated, so a mixed-direction neighbour cannot
                  reorder it and it cannot reorder them. */}
              <bdi>{subject.displayName}</bdi>
            </h2>
          </CardTitle>
          <CardDescription>{COACHING_COPY.coachSubject.purpose}</CardDescription>
          <CardAction>
            {/*
              The lifecycle word is the coaching family's own and the tone is the status vocabulary's,
              taken from its one mapping rather than written here: both `accepted` and `active` are past
              acceptance, and revoked, expired, ended and left are four different closures.
            */}
            <StatusBadge
              label={lifecycle.label}
              tone={lifecycleTone}
              srPrefix={LIFECYCLE_SR_PREFIX}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          {/*
            The cutoff is the envelope's own rendering, stated as given: this component neither computes
            it, compares against it nor shortens it. An absent cutoff is stated as absent rather than
            left blank, because a blank line would read as an unlimited share.
          */}
          <p
            className={cn("text-sm text-pretty", cutoff === null ? "text-muted-foreground" : null)}
          >
            {cutoff === null ? (
              CUTOFF_ABSENT
            ) : (
              <>
                {"Access ends at "}
                <bdi className="mono-identifier">{cutoff.instant}</bdi>
                {" in "}
                <bdi className="mono-identifier">{cutoff.zone}</bdi>
                {`. ${CUTOFF_MEANING}`}
              </>
            )}
          </p>
          <Separator />
          {/*
            The lifecycle word is the whole of what this header says about the episode: the sentences in
            `GRANT_STATE_COPY` beside those words address the worker who chose the modules ("only the
            modules you switched on can be read"), and a coach reading them would be told they hold a
            choice they do not. The word itself names the actor, and the cutoff above states the bound.
          */}
          <p className="text-sm text-pretty">{READ_ONLY_STATEMENT}</p>
        </CardContent>
      </Card>

      {first === undefined ? (
        /*
          A grant that shares no module is not a module with nothing in it: it takes the sentence that
          describes a relationship sharing nothing, and it names no module, because none was admitted. The
          lifecycle word in the header is what keeps an invitation not yet accepted, a revoked grant and
          dates that ran out from reading as one outcome.
        */
        <StateNotice
          kind="empty"
          headingLevel={2}
          title={COACHING_COPY.coachSubject.heading}
          description={NOTHING_SHARED_SENTENCE}
        />
      ) : (
        <Tabs defaultValue={first.key} className="gap-3">
          {/*
            The tab strip wraps onto further rows inside its own labelled strip instead of scrolling the
            page sideways: at 320 CSS px five module names cannot share one row, and a tab strip that
            overflowed would make the page itself scroll horizontally (WCAG 1.4.10 Reflow).
          */}
          <TabsList
            aria-label={MODULE_TABS_LABEL}
            className="h-auto w-full max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
          >
            {admitted.map((entry) => (
              <TabsTrigger key={entry.key} value={entry.key} className="h-8 flex-none">
                <bdi>{MODULE_COPY[entry.key].name}</bdi>
              </TabsTrigger>
            ))}
          </TabsList>
          {/*
            Each panel is named here as well as by its tab: the tab primitive links a panel to its tab in
            the browser, and this label keeps the panel identifiable on its own, so a reader is never
            placed in an unnamed region.
          */}
          {admitted.map((entry) => (
            <TabsContent
              key={entry.key}
              value={entry.key}
              aria-label={MODULE_COPY[entry.key].name}
              className="min-w-0"
            >
              <ModulePanel entry={entry} unavailableSource={unavailableSource} locale={locale} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}
