"use client";
/**
 * The one *Plan needs review* surface. Several dates passed without an action, so it is the plan — not a stack of
 * overdue work — that the worker decides about, and exactly three resolutions are offered for it.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { fieldErrorsFromInvalid, FormFieldGroup } from "@/components/form-field";
import { StateNotice, type NoticeRetry } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import type { MutationInput, MutationOutcome, Scope } from "@/modules/data-service";
import type { SeriesState } from "@/modules/time/recurrence";
import {
  MISSED_PLAN_RESOLUTION_DESCRIPTIONS,
  MISSED_PLAN_RESOLUTION_LABELS,
  MISSED_PLAN_RESOLUTION_ORDER,
  MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE,
  PAUSED_NOTE,
  PLAN_NEEDS_REVIEW_EXPLANATION,
  PLAN_NEEDS_REVIEW_HEADING,
  SERIES_STATE_LABELS,
  STALE_SERIES_ACTION_MESSAGE,
  STALE_SERIES_ACTION_RECOVERY,
  STOPPED_NOTE,
  type MissedPlanResolution,
} from "../copy/missed-dates";
import { useSeriesMutations } from "../hooks/use-series-mutations";
import { resolveMissedPlanSchema, type ResolveMissedPlanPayload } from "../schemas/occurrence";

/** A civil date the envelope already produced and formatted. This panel shows a date it was handed; it reads no clock and computes no date of its own. */
export type PlanDateFact = { readonly iso: string; readonly display: string };

/** The series facts the read envelope supplies: never re-derived, counted or completed here. */
export type PlanNeedsReviewFacts = {
  readonly state: SeriesState;
  /** The revision a resolution has to present, always the envelope's own. */
  readonly revision: string;
  /** Whether the envelope reports that this plan is awaiting a decision. */
  readonly planNeedsReview: boolean;
  /** How many dates the envelope reports as having passed without an action. Stated, never counted locally, and never enumerated as a stack. */
  readonly missedDateCount: number;
  /** The next date the envelope states the rule produces, if it states one. */
  readonly nextNominalDate?: PlanDateFact | null;
  /** Resolutions the envelope reports as not admissible for this series, each with its own stated reason. A resolution named here is disabled and never quietly mapped onto another. */
  readonly notAdmissible?: Readonly<Partial<Record<MissedPlanResolution, string>>>;
};

/** The series could not be read, so the panel reports the outage instead of offering decisions over facts it does not hold. */
export type PlanNeedsReviewReadOutage = { readonly source?: SourceReference; readonly retry?: NoticeRetry };

/** The heading levels a surrounding page can need; the level belongs to the page, not to this panel. */
export type PlanNeedsReviewHeadingLevel = 2 | 3 | 4;

export type PlanNeedsReviewPanelProps = {
  readonly scope: Scope;
  /** The occurrence the envelope reports as the one awaiting a decision: the identity every resolution is applied to. */
  readonly occurrenceId: string;
  readonly facts: PlanNeedsReviewFacts;
  /** The series title, isolated as a mixed-direction value where it is shown. */
  readonly seriesTitle?: string;
  readonly readOutage?: PlanNeedsReviewReadOutage;
  /** Called with the outcome of every settled attempt, so the composing page can re-read the series or state the result. */
  readonly onResolved?: (outcome: MutationOutcome) => void;
  /** Called when the worker closes the panel; the keyboard position then returns to the control that opened it. */
  readonly onDismiss?: () => void;
  /** Offered as the receipt's "Check the result" action for an `unknown` outcome. */
  readonly onCheckResult?: () => void;
  readonly headingLevel?: PlanNeedsReviewHeadingLevel;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};

const RESOLUTION_FIELD = "resolution";
const OCCURRENCE_FIELD = "occurrenceId";
const RESOLUTION_GROUP_LEGEND = "How this plan continues";
const APPLY_LABEL = "Apply this resolution";
const DISMISS_LABEL = "Close";
const NEXT_DATE_LABEL = "Next date this rule produces";
const SETTLED_HEADING = "This plan's review is settled";
const SETTLED_SENTENCE = "The plan is no longer awaiting a decision, so no resolution is offered here: the result of the one you applied stands below as its record.";
const OUTAGE_TITLE = "The series could not be read";
const OUTAGE_DESCRIPTION = "The recurring series this review belongs to could not be read, so no resolution is offered over facts that are not here. Nothing has been changed by opening this panel.";
const UNPREPARED_TITLE = "This review could not be prepared";
const SERIES_STATUS_SR_PREFIX = "Series status";
const COUNT_CLASS = "tabular-figures font-medium text-foreground";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const SERIES_STATE_TONES: Readonly<Record<SeriesState, StatusTone>> = { active: "positive", paused: "caution", stopped: "neutral" };
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { [RESOLUTION_FIELD]: RESOLUTION_GROUP_LEGEND, [OCCURRENCE_FIELD]: "The date this review covers" };

/**
 * What the review step discloses for each resolution. Exhaustively typed against the closed union, so a fourth
 * resolution is a compile error here as well as in the schema: `stop-series` is the one consequential choice, and
 * `move-next-date-forward` is the one whose consequence names the next date the envelope reports.
 */
const RESOLUTION_REVIEW: Readonly<Record<MissedPlanResolution, { readonly consequential: boolean; readonly namesNextDate: boolean }>> = {
  "keep-this-occurrence": { consequential: false, namesNextDate: false },
  "move-next-date-forward": { consequential: false, namesNextDate: true },
  "stop-series": { consequential: true, namesNextDate: false },
};

/** Whether a value from a radio group is one of the three admitted resolutions, rather than something mapped onto one of them. */
function isPlanResolution(value: unknown): value is MissedPlanResolution {
  return typeof value === "string" && (MISSED_PLAN_RESOLUTION_ORDER as readonly string[]).includes(value);
}

/** Whether an outcome settled the attempt, so its receipt is the record of what happened rather than a request to look again. */
function isTerminalOutcome(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
}

/**
 * Why a resolution is not admissible for this series, or `undefined` when it is. The envelope's own reason wins;
 * without one, a series that is not admitting dates states its own condition, and the resolution is never remapped.
 */
export function inadmissibleReason(facts: PlanNeedsReviewFacts, resolution: MissedPlanResolution): string | undefined {
  const stated = facts.notAdmissible?.[resolution];
  if (stated !== undefined && stated.trim() !== "") return stated;
  if (facts.state === "active") return undefined;
  return facts.state === "paused" ? PAUSED_NOTE : STOPPED_NOTE;
}

/** What the worker is about to apply, in the copy module's own wording, with the count the envelope states. */
function ReviewedResolution({ resolution, missedDateCount, nextNominalDate }: { readonly resolution: MissedPlanResolution; readonly missedDateCount: number; readonly nextNominalDate: PlanDateFact | null }): ReactElement {
  const { namesNextDate } = RESOLUTION_REVIEW[resolution];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="font-medium text-foreground">{MISSED_PLAN_RESOLUTION_LABELS[resolution]}</p>
      <p>{MISSED_PLAN_RESOLUTION_DESCRIPTIONS[resolution]}</p>
      <p>
        This review covers <bdi className={COUNT_CLASS}>{String(missedDateCount)}</bdi> dates that passed without an action. It changes this series only, and it records no contact and no completion on your behalf.
      </p>
      {!namesNextDate ? null : nextNominalDate === null ? (
        <p>The series states no next date for its rule right now, so this review names none and leaves that date to the series.</p>
      ) : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span>{NEXT_DATE_LABEL}</span>
          <bdi>
            <time dateTime={nextNominalDate.iso} className="tabular-figures">
              {nextNominalDate.display}
            </time>
          </bdi>
        </p>
      )}
    </div>
  );
}

/** The plan review a recurring series offers after several missed dates, with exactly three resolutions. */
export default function PlanNeedsReviewPanel({ scope, occurrenceId, facts, seriesTitle, readOutage, onResolved, onDismiss, onCheckResult, headingLevel = 3, dir, className }: PlanNeedsReviewPanelProps): ReactElement | null {
  const headingId = useId();
  const optionIdPrefix = useId();
  const returnTo = useRef<HTMLElement | null>(null);
  const { resolveMissedPlan } = useSeriesMutations(scope);
  const { mutateAsync } = resolveMissedPlan;
  const [selected, setSelected] = useState<MissedPlanResolution | null>(null);
  const [submitted, setSubmitted] = useState<Omit<MutationInput<ResolveMissedPlanPayload>, "operationId"> | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Where the keyboard was when this panel appeared, so closing it returns the worker to the control that opened it.
  useEffect(() => {
    const focused = document.activeElement;
    returnTo.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
  }, []);
  const submit = useCallback<MutationSubmit<ResolveMissedPlanPayload>>(
    async (attempt): Promise<MutationOutcome> => {
      // The reviewed intent is held so the receipt stands beside the re-read that follows it: the review step shows a
      // result only while the input it is handed matches the intent it reviewed, and that re-read advances the revision.
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      setSubmitting(true);
      try {
        return await mutateAsync(attempt);
      } finally {
        setSubmitting(false);
      }
    },
    [mutateAsync],
  );
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettled(outcome);
      onResolved?.(outcome);
    },
    [onResolved],
  );
  const dismiss = useCallback((): void => {
    if (onDismiss === undefined) return;
    onDismiss();
    const target = returnTo.current;
    if (target !== null && target.isConnected) target.focus();
  }, [onDismiss]);
  if (readOutage !== undefined) {
    return <StateNotice kind="unavailable" headingLevel={headingLevel} title={OUTAGE_TITLE} description={OUTAGE_DESCRIPTION} source={readOutage.source} retry={readOutage.retry} className={className} />;
  }
  // The panel exists where the plan needs a decision. It also stays mounted after its own attempt, so the receipt of
  // what was applied survives the re-read that follows it rather than vanishing with the review that produced it.
  if (!facts.planNeedsReview && settled === null) return null;
  // The payload is composed and judged by the family's own schema before anything is sent, so a request this panel
  // could not have stated correctly is refused here instead of arriving as a second fault from the service.
  const prepared = selected === null ? null : resolveMissedPlanSchema.safeParse({ occurrenceId, resolution: selected });
  const unprepared = prepared === null || prepared.success ? [] : prepared.error.issues.map((issue) => issue.message);
  const liveInput: Omit<MutationInput<ResolveMissedPlanPayload>, "operationId"> | null = prepared === null || !prepared.success ? null : { scope, expectedRevision: facts.revision, payload: prepared.data };
  const holdsReceipt = settled !== null && isTerminalOutcome(settled) && submitted !== null && selected !== null && submitted.payload.resolution === selected;
  const input = holdsReceipt ? submitted : liveInput;
  const staleAfterStop = settled !== null && facts.state === "stopped" && (settled.outcome === "conflict" || settled.outcome === "unchanged");
  const stateReason = facts.state === "active" ? undefined : facts.state === "paused" ? PAUSED_NOTE : STOPPED_NOTE;
  const offered = MISSED_PLAN_RESOLUTION_ORDER.filter((resolution) => inadmissibleReason(facts, resolution) === undefined);
  const refusals = settled !== null && settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null;
  const nextNominalDate = facts.nextNominalDate ?? null;
  const title = seriesTitle?.trim() ?? "";
  const Heading = HEADING_TAG[headingLevel];
  const reviewLevel = headingLevel === 2 ? 3 : 4;
  return (
    <section dir={dir} aria-labelledby={headingId} aria-busy={submitting ? true : undefined} data-slot="plan-needs-review-panel" data-plan-state={facts.planNeedsReview ? "needs-review" : "settled"} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <Card className="min-w-0">
        <CardHeader className="flex min-w-0 flex-col gap-2">
          <CardTitle>
            <Heading id={headingId}>{facts.planNeedsReview ? PLAN_NEEDS_REVIEW_HEADING : SETTLED_HEADING}</Heading>
          </CardTitle>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge label={SERIES_STATE_LABELS[facts.state]} tone={SERIES_STATE_TONES[facts.state]} srPrefix={SERIES_STATUS_SR_PREFIX} />
            {title === "" ? null : (
              <p className="min-w-0 text-sm wrap-anywhere">
                <bdi>{title}</bdi>
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {facts.planNeedsReview ? (
            <>
              <p className={SENTENCE_CLASS}>{PLAN_NEEDS_REVIEW_EXPLANATION}</p>
              <p className={SENTENCE_CLASS}>
                This plan carries <bdi className={COUNT_CLASS}>{String(facts.missedDateCount)}</bdi> dates that passed without an action. They are not listed here as overdue work to clear one at a time: the decision below settles the plan.
              </p>
              {nextNominalDate === null ? null : (
                <p className={cn(SENTENCE_CLASS, "flex min-w-0 flex-wrap items-baseline gap-x-2")}>
                  <span>{NEXT_DATE_LABEL}</span>
                  <bdi>
                    <time dateTime={nextNominalDate.iso} className="tabular-figures">
                      {nextNominalDate.display}
                    </time>
                  </bdi>
                </p>
              )}
            </>
          ) : (
            <p className={SENTENCE_CLASS}>{SETTLED_SENTENCE}</p>
          )}
          {facts.planNeedsReview && offered.length === 0 ? <p className={SENTENCE_CLASS}>{stateReason}</p> : null}
          {facts.planNeedsReview && offered.length > 0 ? (
            <FormFieldGroup legend={RESOLUTION_GROUP_LEGEND} name={RESOLUTION_FIELD} description={MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE} error={refusals?.byField[RESOLUTION_FIELD]} required>
              {(group) => (
                <RadioGroup
                  value={selected ?? null}
                  onValueChange={(next) => {
                    // A value outside the three admitted resolutions is refused rather than mapped onto one of them,
                    // and the choice is frozen while an attempt is in flight so the receipt cannot lose its intent.
                    if (!isPlanResolution(next) || submitting) return;
                    setSelected(next);
                  }}
                  aria-labelledby={group.legendId}
                  aria-describedby={group.describedBy}
                  aria-invalid={group.invalid ? true : undefined}
                  aria-required={group.required ? true : undefined}
                  aria-busy={submitting ? true : undefined}
                >
                  {MISSED_PLAN_RESOLUTION_ORDER.map((resolution) => {
                    const optionId = `${optionIdPrefix}-${resolution}`;
                    const descriptionId = `${optionId}-description`;
                    const reasonId = `${optionId}-reason`;
                    const reason = inadmissibleReason(facts, resolution);
                    return (
                      <label key={resolution} htmlFor={optionId} className={cn("flex min-h-target items-start gap-3 py-1", reason !== undefined && "opacity-70")}>
                        <RadioGroupItem
                          id={optionId}
                          value={resolution}
                          disabled={reason !== undefined || submitting}
                          aria-label={MISSED_PLAN_RESOLUTION_LABELS[resolution]}
                          aria-describedby={reason === undefined ? descriptionId : `${descriptionId} ${reasonId}`}
                          className="mt-0.5"
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm font-medium">{MISSED_PLAN_RESOLUTION_LABELS[resolution]}</span>
                          <span id={descriptionId} className={cn(SENTENCE_CLASS, "block")}>
                            {MISSED_PLAN_RESOLUTION_DESCRIPTIONS[resolution]}
                          </span>
                          {reason === undefined ? null : (
                            <span id={reasonId} className={cn(SENTENCE_CLASS, "block")}>
                              {reason}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </RadioGroup>
              )}
            </FormFieldGroup>
          ) : null}
          {unprepared.length === 0 ? null : (
            <Alert variant="destructive">
              <AlertTitle>{UNPREPARED_TITLE}</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 ps-4">
                  {unprepared.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {staleAfterStop ? (
            <Alert>
              <AlertTitle>{SERIES_STATE_LABELS.stopped}</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>{STALE_SERIES_ACTION_MESSAGE}</span>
                <span>{STALE_SERIES_ACTION_RECOVERY}</span>
              </AlertDescription>
            </Alert>
          ) : null}
          {selected === null || input === null ? null : (
            <>
              <Separator />
              <ActionReview<ResolveMissedPlanPayload>
                title={MISSED_PLAN_RESOLUTION_LABELS[selected]}
                description={<ReviewedResolution resolution={selected} missedDateCount={facts.missedDateCount} nextNominalDate={nextNominalDate} />}
                confirmLabel={APPLY_LABEL}
                // Only Stop series is confirmed through the pattern's AlertDialog: the other two keep the plan running and
                // leave every existing date exactly where it is.
                consequential={RESOLUTION_REVIEW[selected].consequential}
                input={input}
                submit={submit}
                onSettled={handleSettled}
                checkResult={onCheckResult}
                fieldLabels={FIELD_LABELS}
                headingLevel={reviewLevel}
              />
            </>
          )}
          {onDismiss === undefined ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal" disabled={submitting} onClick={dismiss}>
                {DISMISS_LABEL}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
