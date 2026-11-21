"use client";

/**
 * The worker's one view of the coaching grant that is in force: the lifecycle state with its
 * availability stated separately, the four sharing outcomes kept four, the five modules in their
 * canonical order with the state each is read in, the duration with the frozen exclusive cutoff, the
 * reviewed financial range, and the whole-summary unavailable case.
 *
 * Plan items that put this file in scope:
 * - AAP 0.9.1 / 0.11.1 `src/features/coaching/**`: the coaching family's sharing surface, composed by
 *   the `/coaching` and `/coaching/sharing` routes.
 * - AAP 0.10.1 family "Coaching": an invitation naming recipient, organization, ministry, five
 *   independently selected modules and a duration; a frozen exclusive cutoff; a reviewed fixed
 *   financial range.
 * - AAP 0.8.4 rows 1, 2, 5 and 6: the four separate outcomes, the frozen cutoff, the five module read
 *   states, and the range with no drilldown, no reconstructing total and no missing-as-zero.
 * - Acceptance criterion 16: the shared modules and the exact periods are readable here.
 *
 * Every value is rendered, never derived. The cutoff is frozen when the episode begins, so only the
 * read that produced this grant knows the resolved instant and which limit decided it — this file
 * receives that instant and never recomputes a window. Money is formatted by `modules/money/format`,
 * the range sentence and its per-currency entries come from `coaching/grant`'s
 * `describeFinancialRange`, the module states come from the read, and the lifecycle, module, outcome
 * and surface words come from `../copy`. No arithmetic, no clock, no percentage and no total is
 * computed here. A civil date may arrive as the domain's own `CivilDate` or in its stored
 * `YYYY-MM-DD` form, because a Server Component cannot pass a `Temporal.PlainDate` across the
 * server-to-client boundary; both mean the same calendar day and neither is re-derived from a
 * formatted string.
 *
 * The four outcomes never collapse. An invitation being recorded, an identity being verified, an
 * acceptance being deliberate and access being live are four independent facts with four independent
 * words, and this surface states them as four rows in one list — a screen reader announces four
 * items. Acceptance implies no access, a recorded invitation implies no arrival (a simulated mail
 * submission is labelled as such beside that one row), and an outcome whose acknowledgement was lost
 * is stated as unknown rather than as a success or a failure.
 *
 * The five module states stay five. Empty, partly covered, held until reviewed, unavailable right now
 * and ended each get their own word, their own sentence and — where a frame is used at all — their own
 * icon, so an outage is never read as an ending and an ending is never read as an outage. A module
 * the grant does not share is stated as switched off and gets no state of its own, because
 * authorisation precedes enumeration.
 *
 * This surface is read-only. Every state change lives in `module-toggles.tsx`, `duration-control.tsx`
 * and `stop-actions.tsx`; the only control here is the route's link to the sharing screen. No coach is
 * ever described as having been told about a change, and nothing claims to recall what a coach has
 * already read.
 *
 * Accessibility and layout: the section is named by its own heading, each state word is text inside
 * the accessible name rather than a colour, every value that may be mixed-direction (module names,
 * currency codes, zones, instants, civil dates) sits in `<bdi>`, spacing is logical (`ms-*`, `ps-*`,
 * `gap-*`) and every block wraps, so the whole summary reflows to one column at 320 CSS pixels with
 * no horizontal page scroll.
 */

import Link from "next/link";
import {
  CalendarXIcon,
  ClockIcon,
  EyeOffIcon,
  HourglassIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import SimulationLabel from "@/components/simulation-label";
import StateNotice from "@/components/state-notice";
import StatusBadge, {
  COACHING_STATUS,
  statusBadgeProps,
  type StatusTone,
} from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import {
  MODULE_KEYS,
  describeFinancialRange,
  type GrantLifecycleState,
  type ModuleKey,
  type ModuleReadState,
  type PermissionHold,
  type SubjectAvailability,
} from "@/modules/coaching/grant";
import type { ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor, type MinorFormatting } from "@/modules/money/format";
import { BASIS_DESCRIPTION, SUPPORT_BASIS } from "@/modules/support/basis";
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";

import {
  COACHING_COPY,
  FINANCIAL_RANGE_COPY,
  GRANT_STATE_COPY,
  MODULE_COPY,
  MODULE_READ_STATE_COPY,
  SHARING_OUTCOME_COPY,
  type SharingOutcomeCopy,
  type SharingOutcomeId,
} from "../copy";

// ---------------------------------------------------------------------------------------------
// The contract: the grant exactly as the read reports it
// ---------------------------------------------------------------------------------------------

/**
 * The three states one sharing outcome can be in.
 *
 * `reached` means the step has happened, `not-reached` that it has not, and `unknown` that the
 * effect may have happened but its acknowledgement was lost. Unknown is never rendered as either of
 * the other two: an undetermined outcome is a fact of its own.
 */
export type SharingOutcome = "reached" | "not-reached" | "unknown";

/**
 * The four outcomes a sharing step passes through, one independent state each.
 *
 * The field names are this file's own (`identityVerification`, `acceptance`, `access`) and the four
 * are deliberately separate members, so a caller cannot pass one value for all four by accident and
 * no code path can read one outcome as evidence of another.
 */
export interface SharingOutcomeSet {
  readonly delivery: SharingOutcome;
  readonly identityVerification: SharingOutcome;
  readonly acceptance: SharingOutcome;
  readonly access: SharingOutcome;
}

/**
 * The availability of the grant, kept apart from its lifecycle state.
 *
 * Neither member is a lifecycle state a change could set: a source that cannot be read right now
 * leaves the episode open, and a temporary permission hold suspends access without ending anything.
 * Both are dimensions of the read, which is why they are stated on their own line instead of being
 * folded into the lifecycle word.
 */
export interface GrantAvailability {
  readonly source: SubjectAvailability;
  readonly permissionHold: PermissionHold;
}

/**
 * One module as the read observed it.
 *
 * `readState` is `null` for a module that is shared, readable and complete — the domain's own way of
 * saying that nothing stands beside the content — and one of the five states otherwise. A module the
 * grant does not share is absent from the list, so this surface cannot render a state, a count or a
 * title for it.
 */
export interface ModuleRead {
  readonly key: ModuleKey;
  readonly readState: ModuleReadState | null;
}

/**
 * A civil date as the composition layer can hand one over: the domain's own `CivilDate`, or the
 * stored `YYYY-MM-DD` form.
 *
 * Both mean the same calendar day, and which one arrives depends on where the view is composed. A
 * Server Component composes it from the read and cannot pass a `Temporal.PlainDate` across the
 * server-to-client boundary — a class instance carrying methods is not serialisable — so it passes
 * the stored form and this component reads it with the domain's own parser. A Client Component may
 * pass either. Neither form is treated as a display value: a civil date is rendered in its stored
 * form and is never re-derived from a formatted string or from the host's zone.
 */
export type CivilDateInput = CivilDate | string;

/**
 * The separately reviewed fixed range, exactly as the read reports it: the civil dates reviewed, the
 * currency the figure is stated in, the amount (or `null` when the read established none) and the
 * state that amount was read in.
 */
export interface FinancialRange {
  readonly from: CivilDateInput;
  readonly to: CivilDateInput;
  readonly currency: string;
  readonly money: Money | null;
  readonly valueState: ValueState;
}

/** How long the worker chose to share: open-ended, or through one civil date. */
export type GrantDurationView =
  | { readonly kind: "ongoing" }
  | { readonly kind: "through-date"; readonly throughDate: CivilDateInput };

/**
 * The bound the invitation froze, rendered as the read reports it.
 *
 * `instant` is the resolved exclusive endpoint and `zone` the zone it was resolved in;
 * `sourceLimitWins` says an earlier limit imposed by the source itself decided the bound. None of the
 * three is derived here, because only the read that froze them knows them.
 */
export interface ShareCutoffView {
  readonly instant: string;
  readonly zone: string;
  readonly sourceLimitWins: boolean;
}

/** The grant as this surface renders it, composed from the domain types above. */
export interface CoachingGrantView {
  readonly state: GrantLifecycleState;
  readonly availability: GrantAvailability;
  readonly modules: ReadonlyArray<ModuleRead>;
  readonly duration: GrantDurationView;
  readonly shareCutoff: ShareCutoffView;
  readonly financialRange: FinancialRange | null;
  readonly outcomes: SharingOutcomeSet;
}

/** Props of {@link SharingSummary}. */
export interface SharingSummaryProps {
  /** The grant the read returned, or `null` when no coaching relationship is set up. */
  readonly grant: CoachingGrantView | null;
  /** The viewer's display locale, supplied by the route composition; never read from the host. */
  readonly locale: string;
  /** The source that could not be read, when the grant source itself is down. */
  readonly unavailable?: { readonly source: SourceReference } | null;
  /** Layout classes for the summary's place in the page. Never a colour, radius or shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// The words this surface adds to the family's copy
// ---------------------------------------------------------------------------------------------

/** The route that owns the invitations, modules and durations. Referenced, never created here. */
const SHARING_ROUTE = "/coaching/sharing";

/** The section headings of the summary, in the order they appear. */
const SECTION_TITLES = {
  relationship: "This coaching relationship",
  outcomes: "Where the invitation stands",
  modules: "What your coach can read",
  duration: "Duration and closing instant",
} as const;

/**
 * The stage each outcome names, shown beside its state word.
 *
 * The family's copy labels each outcome by what has been achieved ("Access live"), so a row needs a
 * neutral name for the stage itself — otherwise an outcome that has not happened would have to be
 * labelled with the word for the one that has.
 */
const OUTCOME_STAGE_NAME: Readonly<Record<SharingOutcomeId, string>> = {
  delivery: "Invitation",
  "identity-verification": "Identity",
  "deliberate-acceptance": "Acceptance",
  "active-access": "Access",
};

/** Where each outcome of the copy's tuple is recorded on {@link SharingOutcomeSet}. */
const OUTCOME_STATE_FIELD: Readonly<Record<SharingOutcomeId, keyof SharingOutcomeSet>> = {
  delivery: "delivery",
  "identity-verification": "identityVerification",
  "deliberate-acceptance": "acceptance",
  "active-access": "access",
};

/**
 * The word for an outcome that has not happened yet.
 *
 * Each says only that its own step is absent. None of them says anything about the steps after it,
 * which is why "Not accepted yet" claims no access and "Access not live yet" claims no acceptance.
 */
const OUTCOME_NOT_REACHED_WORD: Readonly<Record<SharingOutcomeId, string>> = {
  delivery: "No invitation recorded",
  "identity-verification": "Identity not verified",
  "deliberate-acceptance": "Not accepted yet",
  "active-access": "Access not live yet",
};

/** The word for an outcome whose acknowledgement was lost: neither success nor failure. */
const OUTCOME_UNKNOWN_WORD: Readonly<Record<SharingOutcomeId, string>> = {
  delivery: "Recording uncertain",
  "identity-verification": "Verification unknown",
  "deliberate-acceptance": "Acceptance unknown",
  "active-access": "Access unknown",
};

/** How each outcome state reads. The tone reinforces the word; it never carries the meaning alone. */
const OUTCOME_TONE: Readonly<Record<SharingOutcome, StatusTone>> = {
  reached: "info",
  "not-reached": "muted",
  unknown: "caution",
};

/**
 * The word for one outcome in one state.
 *
 * The achieved word is the family's own (`SharingOutcomeCopy.label`); the other two are this file's,
 * because the copy source words the four outcomes and what each does not mean, and says nothing about
 * an outcome that has not happened or whose acknowledgement was lost.
 */
function outcomeWord(entry: SharingOutcomeCopy, state: SharingOutcome): string {
  switch (state) {
    case "reached":
      return entry.label;
    case "not-reached":
      return OUTCOME_NOT_REACHED_WORD[entry.id];
    case "unknown":
      return OUTCOME_UNKNOWN_WORD[entry.id];
  }
}

/** How each module read state reads. `ended` and `unavailable` never share a tone or a word. */
const MODULE_READ_STATE_TONE: Readonly<Record<ModuleReadState, StatusTone>> = {
  empty: "muted",
  partial: "info",
  withheld: "caution",
  unavailable: "danger",
  ended: "neutral",
};

/**
 * The two facts the five read states do not cover: a module that is switched on and readable with
 * nothing to report, and a module the grant does not share.
 *
 * Neither is a read state, so neither has a member in the domain's union or in
 * `MODULE_READ_STATE_COPY`; both are selection facts about the grant and are worded here once.
 */
const MODULE_SHARED_WORD = "Shared";
const MODULE_SHARED_SENTENCE =
  "This module is switched on and your coach can read it inside the dates you chose. Nothing in it " +
  "is held, missing or unavailable.";
const MODULE_OFF_WORD = "Switched off";
const MODULE_OFF_SENTENCE = "This module is switched off, so your coach cannot read it.";

/** What a readable or an unreadable source means for the grant, in one line each. */
const AVAILABILITY_COPY: Readonly<
  Record<SubjectAvailability, { label: string; description: string }>
> = {
  available: {
    label: "Readable",
    description: "Every module this grant shares has a source that can be read at this moment.",
  },
  unavailable: {
    label: "Unavailable right now",
    description:
      "The source behind these modules cannot be read at this moment. The episode is still open, " +
      "the modules that do not depend on it stay usable, and this is an outage rather than an " +
      "ending.",
  },
};

/** What a permission hold means, kept apart from every closure. */
const HOLD_COPY: Readonly<Record<PermissionHold, { label: string; description: string }>> = {
  none: {
    label: "Not on hold",
    description: "Access is not suspended: the invitation's own dates bound this share.",
  },
  temporary: {
    label: "Temporary hold",
    description:
      "Access is suspended by a temporary permission hold. A hold is not an ending, and lifting it " +
      "grants nothing the invitation had not already named.",
  },
};

/** The disclosure the cutoff needs, whichever kind of duration was chosen. */
const CUTOFF_EXCLUSIVE_SENTENCE =
  "That instant is the exclusive end of the share: a read at it is already outside the window, so " +
  "the last moment that stays readable is the one before it.";
const CUTOFF_DAY_AFTER_SENTENCE =
  "It is the first instant of the civil day after the Share-through date, expressed in that zone.";
const CUTOFF_FROZEN_SENTENCE =
  "It was frozen when this episode began, so a later travel, display-timezone or settings change " +
  "cannot move it.";
const CUTOFF_ABSENT_ONGOING_SENTENCE =
  "No closing instant is set: this share has no end date until you stop it.";
const CUTOFF_ABSENT_SENTENCE = "No closing instant has been resolved for this share yet.";

/** The statement that an earlier limit the source imposes decided the bound. */
const SOURCE_LIMIT_WINS_TITLE = "An earlier limit set by the source decides this end";
const SOURCE_LIMIT_WINS_SENTENCE =
  "The source itself imposes an earlier limit than the date you chose, and that limit wins. The " +
  "share closes at the frozen instant above, in the zone named with it, and not at the end of the " +
  "Share-through date.";

/** The duration's own words, with no boundary arithmetic of their own. */
const DURATION_ONGOING_WORD = "Ongoing";
const DURATION_ONGOING_SENTENCE =
  "You chose no end date, so the share stays open until you stop it, or until any earlier limit the " +
  "source imposes.";
const DURATION_THROUGH_SENTENCE =
  "You chose to share through the end of that date, and the whole of it stays readable.";

/** What the surface says when no financial range was reviewed and shared at all. */
const NO_RANGE_SENTENCE =
  "You did not review and share a financial range with this coach, so this grant carries no support " +
  "figure. Sharing a range is a separate decision from sharing targets, check-ins or task summaries.";

/** The heading of the incoherent-range statement, whose sentence is the domain's own refusal. */
const RANGE_PROBLEM_TITLE = "This range cannot be shown as reviewed";

/** What the surface says when the reviewed dates themselves cannot be read. */
const RANGE_DATES_UNREADABLE =
  "The dates this range was reviewed for could not be read, so the range is not shown as reviewed " +
  "and no figure stands in for it.";

/** The three value states that carry digits; the other three carry words instead of a number. */
const DIGIT_STATES: ReadonlySet<ValueState> = new Set<ValueState>([
  "value",
  "zero",
  "incomplete-subtotal",
]);

/** Whether a value state renders digits, and so needs an amount behind it. */
function carriesDigits(state: ValueState): boolean {
  return DIGIT_STATES.has(state);
}

/** Reads a supplied civil date, whichever form it arrived in; `null` when a string is not one. */
function resolveCivilDate(value: CivilDateInput): CivilDate | null {
  if (typeof value !== "string") {
    return value;
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : null;
}

/** Renders a supplied civil date in the stored form, keeping an unreadable one exactly as given. */
function civilDateText(value: CivilDateInput): string {
  if (typeof value !== "string") {
    return serialiseCivilDate(value);
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : value.trim();
}

/** One reviewed range, prepared for rendering: the period, the figure, and any worded problem. */
interface RangeView {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly state: ValueState;
  readonly formatting: MinorFormatting;
  readonly problem: string | null;
}

/**
 * Prepares the reviewed range by calling the domain's own describer, and the money module's formatter
 * for the one figure it names.
 *
 * A state that carries digits needs an amount behind it. When the read established none, the value is
 * not a number: it is rendered as unknown rather than as a zero, because a missing amount and a
 * genuine zero are different facts and only one of them is known. A range the domain refuses — one
 * that ends before it starts, for instance — keeps the period and the figure it states and carries
 * the refusal's own sentence; dates that cannot be read at all are stated as such. Either way the
 * range is never silently presented as reviewed, and no figure is ever invented for it.
 */
function buildRangeView(range: FinancialRange, locale: string): RangeView {
  const state: ValueState =
    range.money === null && carriesDigits(range.valueState) ? "unknown" : range.valueState;
  const money: Money = range.money ?? { currency: range.currency, minorUnits: minorUnitsOf(0) };
  const from = resolveCivilDate(range.from);
  const to = resolveCivilDate(range.to);

  // The path for a range the describer cannot present as reviewed: the period exactly as supplied,
  // the figure through the money formatter, and the sentence that says what is wrong with it.
  const asSupplied = (problem: string | null): RangeView => ({
    from: civilDateText(range.from),
    to: civilDateText(range.to),
    currency: range.currency,
    state,
    formatting: formatMinor(money, state, locale),
    problem,
  });

  if (from === null || to === null) {
    return asSupplied(RANGE_DATES_UNREADABLE);
  }

  const described = describeFinancialRange(
    { from, to, measures: [{ amount: money, state }] },
    locale,
  );

  if (!described.ok) {
    return asSupplied(described.error.message);
  }

  const entry = described.value.entries[0];
  if (entry === undefined) {
    // The describer accepted the range but reported no entry, which its contract does not allow; the
    // period and the figure it was given are still stated rather than a review being claimed.
    return asSupplied(null);
  }

  return {
    from: described.value.from,
    to: described.value.to,
    currency: entry.currency,
    state: entry.state,
    formatting: entry.formatting,
    problem: null,
  };
}

// ---------------------------------------------------------------------------------------------
// The small parts the six sections are built from
// ---------------------------------------------------------------------------------------------

/** One term and its value in a definition list, so a fact row is one line at the call site. */
function Fact({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** One named section of the summary: a real heading, so the notice joins the document outline. */
function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * One static statement in the alert frame, with its own icon and its own word.
 *
 * The frame is the design system's `Alert` with `role` removed: every statement here describes a
 * state the summary is already showing, so nothing announces itself on mount and the one announcing
 * region stays the caller's own. The tone is always `default`, because an ending, a hold and an
 * earlier limit are facts to read rather than alarms to raise.
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

/**
 * The word and the tone one module row's label carries.
 *
 * `undefined` is a module this grant does not share, `null` one that is switched on with nothing to
 * report, and any other value one of the five read states. All three are distinct words, so no
 * screen reader hears the same label for two different facts.
 */
function moduleWordAndTone(readState: ModuleReadState | null | undefined): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  if (readState === undefined) {
    return { label: MODULE_OFF_WORD, tone: "muted" };
  }
  if (readState === null) {
    return { label: MODULE_SHARED_WORD, tone: "positive" };
  }
  return {
    label: MODULE_READ_STATE_COPY[readState].label,
    tone: MODULE_READ_STATE_TONE[readState],
  };
}

/**
 * The statement one module row carries below its name and state word.
 *
 * A source outage uses the application's one unavailable surface, which names the outage and never a
 * zero. `withheld`, `ended` and `partial` take the alert frame with their own icon and their own
 * sentence: `ended` keeps the calendar icon and a neutral tone so it can never be read as the cloud
 * outage, and `partial` says only that part of the period can be read. `partial-coverage` is
 * deliberately not used for a module, because its fixed sentences state what a *total* over a period
 * means and a coaching module carries no total at all; the module's own sentence says what is
 * actually missing. An empty module and a switched-on module with nothing to report need no frame —
 * they are one sentence each, and neither is an alarm.
 */
function ModuleStatement({
  readState,
}: {
  readonly readState: ModuleReadState | null | undefined;
}): ReactElement {
  if (readState === undefined) {
    return <p className="text-sm text-pretty text-muted-foreground">{MODULE_OFF_SENTENCE}</p>;
  }
  if (readState === null) {
    return <p className="text-sm text-pretty text-muted-foreground">{MODULE_SHARED_SENTENCE}</p>;
  }

  const copy = MODULE_READ_STATE_COPY[readState];

  switch (readState) {
    case "empty":
      return <p className="text-sm text-pretty text-muted-foreground">{copy.description}</p>;
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
        />
      );
  }
}

// ---------------------------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------------------------

/**
 * Renders the grant the read returned across six sections — lifecycle with its availability, the four
 * sharing outcomes, the five modules and their read states, the duration with the frozen cutoff, the
 * reviewed financial range, and the unavailable or empty summary — rendering every value it is given
 * and deriving none of them.
 */
export function SharingSummary({
  grant,
  locale,
  unavailable,
  className,
}: SharingSummaryProps): ReactElement {
  const headingId = "coaching-sharing-summary";
  const heading = COACHING_COPY.sharing.heading;

  if (unavailable !== undefined && unavailable !== null) {
    return (
      <StateNotice
        kind="unavailable"
        headingLevel={2}
        title={heading}
        description={COACHING_COPY.sharing.unavailable}
        source={unavailable.source}
        className={className}
      />
    );
  }

  if (grant === null) {
    return (
      <StateNotice
        kind="empty"
        headingLevel={2}
        title={heading}
        description={COACHING_COPY.sharing.empty}
        action={{ label: "Invite a coach", href: SHARING_ROUTE }}
        className={className}
      />
    );
  }

  // The lifecycle word is the coaching family's own (`GRANT_STATE_COPY`, which tells the three
  // closures and "accepted, access not yet live" apart in words a worker can act on) and the tone is
  // the status vocabulary's, taken from its one mapping rather than written here. Neither source is
  // restated: the word is displayed from the family's copy and only the tone crosses over, so one
  // state keeps one spelling on screen.
  const lifecycle = GRANT_STATE_COPY[grant.state];
  const lifecycleTone = statusBadgeProps(COACHING_STATUS, grant.state).tone;
  const sourceAvailability = AVAILABILITY_COPY[grant.availability.source];
  const hold = HOLD_COPY[grant.availability.permissionHold];
  const range = grant.financialRange === null ? null : buildRangeView(grant.financialRange, locale);
  const cutoffInstant = grant.shareCutoff.instant.trim();
  const ongoing = grant.duration.kind === "ongoing";

  const modulesByKey = new Map<ModuleKey, ModuleReadState | null>(
    grant.modules.map((module) => [module.key, module.readState]),
  );

  return (
    <section aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId}>{heading}</h2>
          </CardTitle>
          <CardDescription>{COACHING_COPY.sharing.purpose}</CardDescription>
          <CardAction>
            <StatusBadge label={lifecycle.label} tone={lifecycleTone} srPrefix="Lifecycle" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-5">
          <Section id={`${headingId}-relationship`} title={SECTION_TITLES.relationship}>
            <p className="text-sm text-pretty text-muted-foreground">{lifecycle.description}</p>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="font-medium">Source</dt>
                <dd className="text-pretty text-muted-foreground">
                  <span className="font-medium text-foreground">
                    <bdi>{sourceAvailability.label}</bdi>
                  </span>
                  {`. ${sourceAvailability.description}`}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="font-medium">Access hold</dt>
                <dd className="text-pretty text-muted-foreground">
                  <span className="font-medium text-foreground">
                    <bdi>{hold.label}</bdi>
                  </span>
                  {`. ${hold.description}`}
                </dd>
              </div>
            </dl>
          </Section>
          <Separator />
          <Section id={`${headingId}-outcomes`} title={SECTION_TITLES.outcomes}>
            <ul className="flex min-w-0 flex-col gap-4">
              {SHARING_OUTCOME_COPY.map((entry) => {
                const state = grant.outcomes[OUTCOME_STATE_FIELD[entry.id]];
                return (
                  <li key={entry.id} className="flex min-w-0 flex-col gap-1.5">
                    <p className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="font-medium">{OUTCOME_STAGE_NAME[entry.id]}</span>
                      <StatusBadge label={outcomeWord(entry, state)} tone={OUTCOME_TONE[state]} />
                    </p>
                    <p className="text-sm text-pretty text-muted-foreground">{entry.description}</p>
                    {entry.id === "delivery" ? <SimulationLabel effect="mail-submission" /> : null}
                  </li>
                );
              })}
            </ul>
          </Section>
          <Separator />
          <Section id={`${headingId}-modules`} title={SECTION_TITLES.modules}>
            <ul className="flex min-w-0 flex-col gap-4">
              {MODULE_KEYS.map((key) => {
                const readState = modulesByKey.get(key);
                const word = moduleWordAndTone(readState);
                return (
                  <li key={key} className="flex min-w-0 flex-col gap-1.5">
                    <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">
                        <bdi>{MODULE_COPY[key].name}</bdi>
                      </span>
                      <StatusBadge label={word.label} tone={word.tone} />
                    </p>
                    <p className="text-sm text-pretty text-muted-foreground">
                      {MODULE_COPY[key].description}
                    </p>
                    <ModuleStatement readState={readState} />
                  </li>
                );
              })}
            </ul>
          </Section>
          <Separator />
          <Section id={`${headingId}-duration`} title={SECTION_TITLES.duration}>
            <p className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-medium">Duration</span>
              <span>
                {ongoing ? (
                  <bdi>{DURATION_ONGOING_WORD}</bdi>
                ) : (
                  <>
                    Through <bdi>{civilDateText(grant.duration.throughDate)}</bdi>
                  </>
                )}
              </span>
            </p>
            <p className="text-sm text-pretty text-muted-foreground">
              {ongoing ? DURATION_ONGOING_SENTENCE : DURATION_THROUGH_SENTENCE}
            </p>
            {cutoffInstant.length === 0 ? (
              <p className="text-sm text-pretty text-muted-foreground">
                {ongoing ? CUTOFF_ABSENT_ONGOING_SENTENCE : CUTOFF_ABSENT_SENTENCE}
              </p>
            ) : (
              <>
                <p className="text-sm text-pretty">
                  Closes at <bdi className="mono-identifier">{cutoffInstant}</bdi> in{" "}
                  <bdi className="mono-identifier">{grant.shareCutoff.zone}</bdi>.
                </p>
                <p className="text-sm text-pretty text-muted-foreground">
                  {/*
                   * The civil-day rule is stated only when it actually decided the bound: with an
                   * earlier source limit in force, presenting the Share-through date as the reason
                   * would state a rule that did not apply to this share.
                   */}
                  {ongoing || grant.shareCutoff.sourceLimitWins
                    ? ""
                    : `${CUTOFF_DAY_AFTER_SENTENCE} `}
                  {CUTOFF_EXCLUSIVE_SENTENCE} {CUTOFF_FROZEN_SENTENCE}
                </p>
                {grant.shareCutoff.sourceLimitWins ? (
                  <StatementAlert
                    icon={<ClockIcon aria-hidden="true" />}
                    label={SOURCE_LIMIT_WINS_TITLE}
                    sentence={SOURCE_LIMIT_WINS_SENTENCE}
                  />
                ) : null}
              </>
            )}
          </Section>
          <Separator />
          <Section id={`${headingId}-range`} title={FINANCIAL_RANGE_COPY.heading}>
            <p className="text-sm text-pretty text-muted-foreground">
              {FINANCIAL_RANGE_COPY.purpose}
            </p>
            {range === null ? (
              <p className="text-sm text-pretty text-muted-foreground">{NO_RANGE_SENTENCE}</p>
            ) : (
              <>
                <dl className="flex flex-col gap-1 text-sm">
                  <Fact term="Period">
                    <bdi>{`${range.from} – ${range.to}`}</bdi>
                  </Fact>
                  <Fact term="Figure">
                    <span className="tabular-figures" title={range.formatting.accessibleLabel}>
                      <bdi>{range.formatting.text}</bdi>
                      {range.formatting.accessibleLabel === range.formatting.text ? null : (
                        <span className="sr-only">{range.formatting.accessibleLabel}</span>
                      )}
                    </span>
                    {carriesDigits(range.state) ? null : (
                      <span className="mono-identifier ms-1">
                        <bdi>{range.currency}</bdi>
                      </span>
                    )}
                  </Fact>
                  <Fact term="Basis">
                    <bdi className="mono-identifier">{SUPPORT_BASIS}</bdi>
                  </Fact>
                </dl>
                <p className="text-sm text-pretty text-muted-foreground">{BASIS_DESCRIPTION}</p>
                <p className="text-sm text-pretty text-muted-foreground">
                  {FINANCIAL_RANGE_COPY.exclusions}
                </p>
                {range.problem === null ? null : (
                  <StatementAlert
                    icon={<TriangleAlertIcon aria-hidden="true" />}
                    label={RANGE_PROBLEM_TITLE}
                    sentence={range.problem}
                  />
                )}
              </>
            )}
          </Section>
        </CardContent>
        <CardFooter>
          <Link href={SHARING_ROUTE} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Manage what you share
          </Link>
        </CardFooter>
      </Card>
    </section>
  );
}

export default SharingSummary;
