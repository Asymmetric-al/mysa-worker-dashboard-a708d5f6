"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { fieldErrorsFromInvalid, FormFieldGroup } from "@/components/form-field";
import { StateNotice, type NoticeRetry } from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import SectionCard from "@/components/section-card";
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
import { StatedInstant } from "./stated-instant";
export type PlanDateFact = { readonly iso: string; readonly display: string };
export type PlanNeedsReviewFacts = { readonly state: SeriesState; readonly revision: string; readonly planNeedsReview: boolean; readonly missedDateCount: number; readonly nextNominalDate?: PlanDateFact | null; readonly notAdmissible?: Readonly<Partial<Record<MissedPlanResolution, string>>> };
export type PlanNeedsReviewReadOutage = { readonly source?: SourceReference; readonly retry?: NoticeRetry };
export type PlanNeedsReviewHeadingLevel = 2 | 3 | 4;
export type PlanNeedsReviewPanelProps = {
  readonly scope: Scope;
  readonly occurrenceId: string;
  readonly facts: PlanNeedsReviewFacts;
  readonly seriesTitle?: string;
  readonly readOutage?: PlanNeedsReviewReadOutage;
  readonly onResolved?: (outcome: MutationOutcome) => void;
  readonly onDismiss?: () => void;
  readonly onCheckResult?: () => void;
  readonly headingLevel?: PlanNeedsReviewHeadingLevel;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};
const RESOLUTION_FIELD = "resolution";
const RESOLUTION_GROUP_LEGEND = "How this plan continues";
const NEXT_DATE_LABEL = "Next date this rule produces";
const OUTAGE_DESCRIPTION = "The recurring series this review belongs to could not be read, so no resolution is offered over facts that are not here. Nothing has been changed by opening this panel.";
const COUNT_CLASS = "tabular-figures font-medium text-foreground";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const SERIES_STATE_TONES: Readonly<Record<SeriesState, StatusTone>> = { active: "positive", paused: "caution", stopped: "neutral" };
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { [RESOLUTION_FIELD]: RESOLUTION_GROUP_LEGEND, ["occurrenceId"]: "The date this review covers" };
const RESOLUTION_REVIEW: Readonly<Record<MissedPlanResolution, { readonly consequential: boolean; readonly namesNextDate: boolean }>> = {
  "keep-this-occurrence": { consequential: false, namesNextDate: false },
  "move-next-date-forward": { consequential: false, namesNextDate: true },
  "stop-series": { consequential: true, namesNextDate: false },
};
/** Why a resolution is not admissible for this series, or `undefined` when it is. The envelope's own reason wins; without one, a series that is not admitting dates states its own condition, and the resolution is never remapped. */
export function inadmissibleReason(facts: PlanNeedsReviewFacts, resolution: MissedPlanResolution): string | undefined {
  const stated = facts.notAdmissible?.[resolution];
  return stated !== undefined && stated.trim() !== "" ? stated : facts.state === "active" ? undefined : facts.state === "paused" ? PAUSED_NOTE : STOPPED_NOTE;
}
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
          <StatedInstant iso={nextNominalDate.iso} text={nextNominalDate.display} className="tabular-figures" />
        </p>
      )}
    </div>
  );
} /** The plan review a recurring series offers after several missed dates, with exactly three resolutions. */
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
  useEffect(() => {
    const focused = document.activeElement;
    returnTo.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
  }, []);
  const submit = useCallback<MutationSubmit<ResolveMissedPlanPayload>>(
    async (attempt): Promise<MutationOutcome> => {
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
  if (readOutage !== undefined) return <StateNotice kind="unavailable" headingLevel={headingLevel} title="The series could not be read" description={OUTAGE_DESCRIPTION} source={readOutage.source} retry={readOutage.retry} className={className} />;
  if (!facts.planNeedsReview && settled === null) return null;
  const prepared = selected === null ? null : resolveMissedPlanSchema.safeParse({ occurrenceId, resolution: selected });
  const unprepared = prepared === null || prepared.success ? [] : prepared.error.issues.map((issue) => issue.message);
  const liveInput: Omit<MutationInput<ResolveMissedPlanPayload>, "operationId"> | null = prepared === null || !prepared.success ? null : { scope, expectedRevision: facts.revision, payload: prepared.data };
  const input = settled !== null && ((outcome: MutationOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged")(settled) && submitted !== null && selected !== null && submitted.payload.resolution === selected ? submitted : liveInput;
  const offered = MISSED_PLAN_RESOLUTION_ORDER.filter((resolution) => inadmissibleReason(facts, resolution) === undefined);
  const nextNominalDate = facts.nextNominalDate ?? null;
  const title = seriesTitle?.trim() ?? "";
  const cardTitle = facts.planNeedsReview ? PLAN_NEEDS_REVIEW_HEADING : "This plan's review is settled";
  const headerExtra = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <StatusBadge label={SERIES_STATE_LABELS[facts.state]} tone={SERIES_STATE_TONES[facts.state]} srPrefix="Series status" />
      {title === "" ? null : (
        <p className="min-w-0 text-sm wrap-anywhere">
          <bdi>{title}</bdi>
        </p>
      )}
    </div>
  );
  return (
    <section dir={dir} aria-labelledby={headingId} aria-busy={submitting ? true : undefined} data-slot="plan-needs-review-panel" data-plan-state={facts.planNeedsReview ? "needs-review" : "settled"} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <SectionCard {...{ title: cardTitle, headingLevel, headingId, headerClassName: "flex min-w-0 flex-col gap-2", cardClassName: "min-w-0", contentClassName: "flex min-w-0 flex-col gap-4", headerExtra }}>
        {facts.planNeedsReview ? (
          <>
            <p className={SENTENCE_CLASS}>{PLAN_NEEDS_REVIEW_EXPLANATION}</p>
            <p className={SENTENCE_CLASS}>
              This plan carries <bdi className={COUNT_CLASS}>{String(facts.missedDateCount)}</bdi> dates that passed without an action. They are not listed here as overdue work to clear one at a time: the decision below settles the plan.
            </p>
            {nextNominalDate === null ? null : (
              <p className={cn(SENTENCE_CLASS, "flex min-w-0 flex-wrap items-baseline gap-x-2")}>
                <span>{NEXT_DATE_LABEL}</span>
                <StatedInstant iso={nextNominalDate.iso} text={nextNominalDate.display} className="tabular-figures" />
              </p>
            )}
          </>
        ) : (
          <p className={SENTENCE_CLASS}>{"The plan is no longer awaiting a decision, so no resolution is offered here: the result of the one you applied stands below as its record."}</p>
        )}
        {facts.planNeedsReview && offered.length === 0 ? <p className={SENTENCE_CLASS}>{facts.state === "active" ? undefined : facts.state === "paused" ? PAUSED_NOTE : STOPPED_NOTE}</p> : null}
        {facts.planNeedsReview && offered.length > 0 ? (
          <FormFieldGroup legend={RESOLUTION_GROUP_LEGEND} name={RESOLUTION_FIELD} description={MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE} error={(settled !== null && settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null)?.byField[RESOLUTION_FIELD]} required>
            {(group) => {
              const onResolutionChange = (next: string): void => {
                if (!((value: unknown): value is MissedPlanResolution => typeof value === "string" && (MISSED_PLAN_RESOLUTION_ORDER as readonly string[]).includes(value))(next) || submitting) return;
                setSelected(next);
              };
              return (
                <RadioGroup value={selected ?? null} onValueChange={onResolutionChange} aria-labelledby={group.legendId} aria-describedby={group.describedBy} aria-invalid={group.invalid ? true : undefined} aria-required={group.required ? true : undefined} aria-busy={submitting ? true : undefined}>
                  {MISSED_PLAN_RESOLUTION_ORDER.map((resolution) => {
                    const optionId = `${optionIdPrefix}-${resolution}`;
                    const descriptionId = `${optionId}-description`;
                    const reasonId = `${optionId}-reason`;
                    const reason = inadmissibleReason(facts, resolution);
                    return (
                      <label key={resolution} htmlFor={optionId} className={cn("flex min-h-target items-start gap-3 py-1", reason !== undefined && "opacity-70")}>
                        <RadioGroupItem id={optionId} value={resolution} disabled={reason !== undefined || submitting} aria-label={MISSED_PLAN_RESOLUTION_LABELS[resolution]} aria-describedby={reason === undefined ? descriptionId : `${descriptionId} ${reasonId}`} className="mt-0.5" />
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
              );
            }}
          </FormFieldGroup>
        ) : null}
        {unprepared.length === 0 ? null : (
          <Alert variant="destructive">
            <AlertTitle>{"This review could not be prepared"}</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-1 ps-4">
                {unprepared.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {settled !== null && facts.state === "stopped" && (settled.outcome === "conflict" || settled.outcome === "unchanged") ? (
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
              confirmLabel="Apply this resolution"
              consequential={RESOLUTION_REVIEW[selected].consequential}
              input={input}
              submit={submit}
              onSettled={handleSettled}
              checkResult={onCheckResult}
              fieldLabels={FIELD_LABELS}
              headingLevel={headingLevel === 2 ? 3 : 4}
            />
          </>
        )}
        {onDismiss === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className={BUTTON_WRAP_CLASS} disabled={submitting} onClick={dismiss}>
              {"Close"}
            </Button>
          </div>
        )}
      </SectionCard>
    </section>
  );
}
