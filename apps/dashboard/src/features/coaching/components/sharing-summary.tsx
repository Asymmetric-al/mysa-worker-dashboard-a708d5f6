"use client";
import Link from "next/link";
import { CalendarXIcon, ClockIcon, EyeOffIcon, HourglassIcon, TriangleAlertIcon } from "lucide-react";
import { useId, type ReactElement, type ReactNode } from "react";
import SimulationLabel from "@/components/simulation-label";
import StateNotice from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { MODULE_KEYS, describeFinancialRange, type GrantLifecycleState, type ModuleKey, type ModuleReadState, type PermissionHold, type SubjectAvailability } from "@/modules/coaching/grant";
import type { ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor, type MinorFormatting } from "@/modules/money/format";
import { BASIS_DESCRIPTION, SUPPORT_BASIS } from "@/modules/support/basis";
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, FINANCIAL_RANGE_COPY, GRANT_STATE_COPY, MODULE_COMPLETE_COPY, MODULE_COPY, MODULE_READ_STATE_COPY, SHARING_OUTCOME_COPY, type SharingOutcomeCopy, type SharingOutcomeId } from "../copy";
export type SharingOutcome = "reached" | "not-reached" | "unknown";
export type SharingOutcomeSet = { readonly delivery: SharingOutcome; readonly identityVerification: SharingOutcome; readonly acceptance: SharingOutcome; readonly access: SharingOutcome };
/** The availability of the grant, kept apart from its lifecycle state. */
export type GrantAvailability = { readonly source: SubjectAvailability; readonly permissionHold: PermissionHold };
export type ModuleRead = { readonly key: ModuleKey; readonly readState: ModuleReadState | null };
export type CivilDateInput = CivilDate | string;
export type FinancialRange = { readonly from: CivilDateInput; readonly to: CivilDateInput; readonly currency: string; readonly money: Money | null; readonly valueState: ValueState };
export type GrantDurationView = { readonly kind: "ongoing" } | { readonly kind: "through-date"; readonly throughDate: CivilDateInput | null } | { readonly kind: "none" };
export type ShareCutoffView = { readonly instant: string; readonly zone: string; readonly sourceLimitWins: boolean };
export type CoachingGrantView = {
  readonly state: GrantLifecycleState;
  readonly availability: GrantAvailability;
  readonly modules: ReadonlyArray<ModuleRead>;
  readonly duration: GrantDurationView;
  readonly shareCutoff: ShareCutoffView;
  readonly financialRange: FinancialRange | null;
  readonly outcomes: SharingOutcomeSet;
};
export type SharingSummaryProps = { readonly grant: CoachingGrantView | null; readonly locale: string; readonly unavailable?: { readonly source: SourceReference } | null; readonly className?: string };
const SHARING_ROUTE = "/coaching/sharing";
const SECTION_TITLES = { relationship: "This coaching relationship", outcomes: "Where the invitation stands", modules: "What your coach can read", duration: "Duration and closing instant" } as const;
const OUTCOME_STAGE_NAME: Readonly<Record<SharingOutcomeId, string>> = { delivery: "Invitation", "identity-verification": "Identity", "deliberate-acceptance": "Acceptance", "active-access": "Access" };
const OUTCOME_STATE_FIELD: Readonly<Record<SharingOutcomeId, keyof SharingOutcomeSet>> = { delivery: "delivery", "identity-verification": "identityVerification", "deliberate-acceptance": "acceptance", "active-access": "access" };
const OUTCOME_NOT_REACHED_WORD: Readonly<Record<SharingOutcomeId, string>> = { delivery: "No invitation recorded", "identity-verification": "Identity not verified", "deliberate-acceptance": "Not accepted yet", "active-access": "Access not live yet" };
const OUTCOME_UNKNOWN_WORD: Readonly<Record<SharingOutcomeId, string>> = { delivery: "Recording uncertain", "identity-verification": "Verification unknown", "deliberate-acceptance": "Acceptance unknown", "active-access": "Access unknown" };
const OUTCOME_TONE: Readonly<Record<SharingOutcome, StatusTone>> = { reached: "info", "not-reached": "muted", unknown: "caution" };
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
const MODULE_READ_STATE_TONE: Readonly<Record<ModuleReadState, StatusTone>> = { empty: "muted", partial: "info", withheld: "caution", unavailable: "danger", ended: "neutral" };
const MODULE_OFF_WORD = "Switched off";
const MODULE_OFF_SENTENCE = "This module is switched off, so your coach cannot read it.";
const AVAILABILITY_COPY: Readonly<Record<SubjectAvailability, { label: string; description: string }>> = {
  available: { label: "Readable", description: "Every module this grant shares has a source that can be read at this moment." },
  unavailable: { label: "Unavailable right now", description: "The source behind these modules cannot be read at this moment. The episode is still open, " + "the modules that do not depend on it stay usable, and this is an outage rather than an " + "ending." },
};
const HOLD_COPY: Readonly<Record<PermissionHold, { label: string; description: string }>> = {
  none: { label: "Not on hold", description: "Access is not suspended: the invitation's own dates bound this share." },
  temporary: { label: "Temporary hold", description: "Access is suspended by a temporary permission hold. A hold is not an ending, and lifting it " + "grants nothing the invitation had not already named." },
};
const CUTOFF_EXCLUSIVE_SENTENCE = "That instant is the exclusive end of the share: a read at it is already outside the window, so " + "the last moment that stays readable is the one before it.";
const CUTOFF_DAY_AFTER_SENTENCE = "It is the first instant of the civil day after the Share-through date, expressed in that zone.";
const CUTOFF_FROZEN_SENTENCE = "It was frozen when this episode began, so a later travel, display-timezone or settings change " + "cannot move it.";
const CUTOFF_ABSENT_ONGOING_SENTENCE = "No closing instant is set: this share has no end date until you stop it.";
const CUTOFF_ABSENT_SENTENCE = "No closing instant has been resolved for this share yet.";
const SOURCE_LIMIT_WINS_TITLE = "An earlier limit set by the source decides this end";
const SOURCE_LIMIT_WINS_SENTENCE = "The source itself imposes an earlier limit than the date you chose, and that limit wins. The " + "share closes at the frozen instant above, in the zone named with it, and not at the end of the " + "Share-through date.";
const DURATION_ONGOING_WORD = "Ongoing";
const DURATION_ONGOING_SENTENCE = "You chose no end date, so the share stays open until you stop it, or until any earlier limit the " + "source imposes.";
const DURATION_THROUGH_SENTENCE = "You chose to share through the end of that date, and the whole of it stays readable.";
const DURATION_UNRESOLVED_WORD = "Through a day that could not be resolved";
const DURATION_UNRESOLVED_SENTENCE = "This share was set to run through a calendar day, but that day could not be resolved from the " + "frozen bound, so no date is shown beside it. The closing instant below still stands.";
const DURATION_NONE_WORD = "No usable duration recorded";
const DURATION_NONE_SENTENCE = "This relationship records no usable duration, so it is not an open-ended share: nothing is " + "readable under it, because a missing duration is never permission.";
const NO_RANGE_SENTENCE = "You did not review and share a financial range with this coach, so this grant carries no support " + "figure. Sharing a range is a separate decision from sharing targets, check-ins or task summaries.";
const RANGE_PROBLEM_TITLE = "This range cannot be shown as reviewed";
const RANGE_DATES_UNREADABLE = "The dates this range was reviewed for could not be read, so the range is not shown as reviewed " + "and no figure stands in for it.";
function carriesDigits(state: ValueState): boolean {
  return state === "value" || state === "zero" || state === "incomplete-subtotal";
}
function resolveCivilDate(value: CivilDateInput): CivilDate | null {
  if (typeof value !== "string") {
    return value;
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : null;
}
function civilDateText(value: CivilDateInput): string {
  if (typeof value !== "string") {
    return serialiseCivilDate(value);
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : value.trim();
}
type DurationStatement = { readonly value: ReactNode; readonly sentence: string; readonly dayShown: boolean };
function durationStatementOf(duration: GrantDurationView): DurationStatement {
  switch (duration.kind) {
    case "ongoing":
      return { value: <bdi>{DURATION_ONGOING_WORD}</bdi>, sentence: DURATION_ONGOING_SENTENCE, dayShown: false };
    case "through-date": {
      const day = duration.throughDate === null ? null : resolveCivilDate(duration.throughDate);
      if (day === null) {
        return { value: <bdi>{DURATION_UNRESOLVED_WORD}</bdi>, sentence: DURATION_UNRESOLVED_SENTENCE, dayShown: false };
      }
      return {
        value: (
          <>
            Through <bdi>{civilDateText(day)}</bdi>
          </>
        ),
        sentence: DURATION_THROUGH_SENTENCE,
        dayShown: true,
      };
    }
    case "none":
      return { value: <bdi>{DURATION_NONE_WORD}</bdi>, sentence: DURATION_NONE_SENTENCE, dayShown: false };
  }
}
type RangeView = { readonly from: string; readonly to: string; readonly currency: string; readonly state: ValueState; readonly formatting: MinorFormatting; readonly problem: string | null };
function buildRangeView(range: FinancialRange, locale: string): RangeView {
  const state: ValueState = range.money === null && carriesDigits(range.valueState) ? "unknown" : range.valueState;
  const money: Money = range.money ?? { currency: range.currency, minorUnits: minorUnitsOf(0) };
  const from = resolveCivilDate(range.from);
  const to = resolveCivilDate(range.to);
  const asSupplied = (problem: string | null): RangeView => ({ from: civilDateText(range.from), to: civilDateText(range.to), currency: range.currency, state, formatting: formatMinor(money, state, locale), problem });
  if (from === null || to === null) {
    return asSupplied(RANGE_DATES_UNREADABLE);
  }
  const described = describeFinancialRange({ from, to, measures: [{ amount: money, state }] }, locale);
  if (!described.ok) {
    return asSupplied(described.error.message);
  }
  const entry = described.value.entries[0];
  if (entry === undefined) {
    // The describer accepted the range but reported no entry, which its contract does not allow; the
    // period and the figure it was given are still stated rather than a review being claimed.
    return asSupplied(null);
  }
  return { from: described.value.from, to: described.value.to, currency: entry.currency, state: entry.state, formatting: entry.formatting, problem: null };
}
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }): ReactElement {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}
function StatementAlert({ icon, label, sentence }: { readonly icon: ReactElement; readonly label: string; readonly sentence: string }): ReactElement {
  return (
    <Alert role={undefined} variant="default">
      {icon}
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>{sentence}</AlertDescription>
    </Alert>
  );
}
function moduleWordAndTone(readState: ModuleReadState | null | undefined): { readonly label: string; readonly tone: StatusTone } {
  // `undefined` is a module this grant does not share, and `null` is the read's own answer for a
  // module whose content is complete: the null answer states the complete share, never an unknown one.
  if (readState === undefined) {
    return { label: MODULE_OFF_WORD, tone: "muted" };
  }
  if (readState === null) {
    return { label: MODULE_COMPLETE_COPY.label, tone: "positive" };
  }
  return { label: MODULE_READ_STATE_COPY[readState].label, tone: MODULE_READ_STATE_TONE[readState] };
}
function ModuleStatement({ readState }: { readonly readState: ModuleReadState | null | undefined }): ReactElement {
  if (readState === undefined) {
    return <p className="text-sm text-pretty text-muted-foreground">{MODULE_OFF_SENTENCE}</p>;
  }
  if (readState === null) {
    return <p className="text-sm text-pretty text-muted-foreground">{MODULE_COMPLETE_COPY.description}</p>;
  }
  const copy = MODULE_READ_STATE_COPY[readState];
  switch (readState) {
    case "empty":
      return <p className="text-sm text-pretty text-muted-foreground">{copy.description}</p>;
    case "partial":
      return <StatementAlert icon={<HourglassIcon aria-hidden="true" />} label={copy.label} sentence={copy.description} />;
    case "withheld":
      return <StatementAlert icon={<EyeOffIcon aria-hidden="true" />} label={copy.label} sentence={copy.description} />;
    case "ended":
      return <StatementAlert icon={<CalendarXIcon aria-hidden="true" />} label={copy.label} sentence={copy.description} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={4} title={copy.label} description={copy.description} />;
  }
}
export function SharingSummary({ grant, locale, unavailable, className }: SharingSummaryProps): ReactElement {
  // The summary's own identity, minted per instance: a worker can hold several relationships, and each one's
  // summary is a separately labelled region rather than a second element answering to the same ids.
  const headingId = useId();
  const heading = COACHING_COPY.sharing.heading;
  if (unavailable !== undefined && unavailable !== null) {
    return <StateNotice kind="unavailable" headingLevel={2} title={heading} description={COACHING_COPY.sharing.unavailable} source={unavailable.source} className={className} />;
  }
  if (grant === null) {
    return <StateNotice kind="empty" headingLevel={2} title={heading} description={COACHING_COPY.sharing.empty} action={{ label: "Invite a coach", href: SHARING_ROUTE }} className={className} />;
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
  const duration = durationStatementOf(grant.duration);
  const modulesByKey = new Map<ModuleKey, ModuleReadState | null>(grant.modules.map((module) => [module.key, module.readState]));
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
                    <p className="text-sm text-pretty text-muted-foreground">{MODULE_COPY[key].description}</p>
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
              <span>{duration.value}</span>
            </p>
            <p className="text-sm text-pretty text-muted-foreground">{duration.sentence}</p>
            {cutoffInstant.length === 0 ? (
              <p className="text-sm text-pretty text-muted-foreground">{grant.duration.kind === "ongoing" ? CUTOFF_ABSENT_ONGOING_SENTENCE : CUTOFF_ABSENT_SENTENCE}</p>
            ) : (
              <>
                <p className="text-sm text-pretty">
                  Closes at <bdi className="mono-identifier">{cutoffInstant}</bdi> in <bdi className="mono-identifier">{grant.shareCutoff.zone}</bdi>.
                </p>
                <p className="text-sm text-pretty text-muted-foreground">
                  {/*
                   * The civil-day rule is stated only when it actually decided the bound and its day is
                   * shown: with an earlier source limit in force, or with no resolved day, presenting the
                   * Share-through date as the reason would state a rule that did not apply to this share.
                   */}
                  {duration.dayShown && !grant.shareCutoff.sourceLimitWins ? `${CUTOFF_DAY_AFTER_SENTENCE} ` : ""}
                  {CUTOFF_EXCLUSIVE_SENTENCE} {CUTOFF_FROZEN_SENTENCE}
                </p>
                {grant.shareCutoff.sourceLimitWins ? <StatementAlert icon={<ClockIcon aria-hidden="true" />} label={SOURCE_LIMIT_WINS_TITLE} sentence={SOURCE_LIMIT_WINS_SENTENCE} /> : null}
              </>
            )}
          </Section>
          <Separator />
          <Section id={`${headingId}-range`} title={FINANCIAL_RANGE_COPY.heading}>
            <p className="text-sm text-pretty text-muted-foreground">{FINANCIAL_RANGE_COPY.purpose}</p>
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
                      {range.formatting.accessibleLabel === range.formatting.text ? null : <span className="sr-only">{range.formatting.accessibleLabel}</span>}
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
                <p className="text-sm text-pretty text-muted-foreground">{FINANCIAL_RANGE_COPY.exclusions}</p>
                {range.problem === null ? null : <StatementAlert icon={<TriangleAlertIcon aria-hidden="true" />} label={RANGE_PROBLEM_TITLE} sentence={range.problem} />}
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
