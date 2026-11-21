"use client";
/** The reach control: exactly the three reach values one released edition may carry, the one sentence each of them means, and the reviewed save that sets it — never a fourth value, and never a change that pretends to release something. */
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { decideReach, REACH_VALUES, type Reach } from "@/modules/content/reach";
import { copy } from "../copy";
import { useSetPageReach, type SetReachVariables } from "../hooks/use-reach-mutations";
import type { SetReachPayload } from "../schemas/reach";

/** The authority a reach change is made in, taken from the family's own mutation so this file never restates the scope it acts under. */
type ReachScope = SetReachVariables["scope"];

/** The outcome a reach change answers with, derived from the hook that produces it, so the eight outcomes keep one owner. */
type ReachOutcome = Awaited<ReturnType<ReturnType<typeof useSetPageReach>["mutateAsync"]>>;

/** The field names an `invalid` outcome may key its messages by, said as the words this surface uses for them. */
const FIELD_LABELS: Readonly<Record<string, string>> = { documentId: "Page", reach: "Reach" };

const REACH_CONTROL_COPY = {
  scopeNote: "Reach belongs to a release, so this sets how far every released language edition of this page reaches. It releases nothing and sends no notice: an edition reaches only at the reach it already had when it was released.",
  recordedTerm: "Recorded reach",
  intendedTerm: "Reach after this change",
  meaningTerm: "What that means",
  reviewTitle: "Review this reach change",
  reviewNote: "Choosing an option saves nothing on its own. Saving applies the change once, to every released edition of this page, and leaves every draft exactly as it is.",
  confirmLabel: "Save reach",
  cancelLabel: "Keep the recorded reach",
  doneLabel: "Done",
  disabledFallback: "Reach cannot be changed right now.",
  noReleaseTitle: "Reach is set when this edition is released",
  noReleaseBody: "This edition has no released edition yet, so it has no reach to set. Releasing it is a separate action, and no value is offered here that could not be saved.",
} as const;

export type ReachControlProps = {
  /** The edition whose reach this control shows. Reach is held by the page's releases, so this names what the worker is looking at rather than what the save targets. */
  readonly variantId: string;
  /** The page the release belongs to: the reach change applies to every released language edition of this document. */
  readonly documentId: string;
  /** The context the change is made in, checked by the service against the caller's admitted memberships. */
  readonly scope: ReachScope;
  /** The revision the caller read. A stale one is a `conflict` that preserves the chosen value rather than an overwrite. */
  readonly expectedRevision: string;
  /** The reach the release carries now, taken from the read envelope. `null` states that there is no release, and this control then offers no value at all. */
  readonly current: Reach | null;
  readonly onSaved?: (reach: Reach) => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly className?: string;
};

/** The recorded value beside the value this change would set, so the review states both before anything is applied. */
function ReachComparison({ recorded, intended }: { readonly recorded: Reach; readonly intended: Reach }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-2 text-sm">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="font-medium">{REACH_CONTROL_COPY.recordedTerm}</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi>{copy.reach[recorded].label}</bdi>
        </dd>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="font-medium">{REACH_CONTROL_COPY.intendedTerm}</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi>{copy.reach[intended].label}</bdi>
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-muted-foreground">{REACH_CONTROL_COPY.meaningTerm}</dt>
        <dd className="min-w-0 text-pretty">{copy.reach[intended].explanation}</dd>
      </div>
    </dl>
  );
}

/** How far one released edition reaches: the three settings, what each means, and the reviewed save that applies one of them. */
export default function ReachControl({ variantId, documentId, scope, expectedRevision, current, onSaved, disabled = false, disabledReason, className }: ReachControlProps): ReactElement {
  const idPrefix = useId();
  const legendId = useId();
  const scopeNoteId = useId();
  const disabledReasonId = useId();
  const [chosen, setChosen] = useState<Reach | null>(null);
  const [settled, setSettled] = useState(false);
  const setReach = useSetPageReach();
  const mutateReach = setReach.mutateAsync;
  const submit = useCallback(async (input: SetReachVariables) => mutateReach({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateReach]);
  const statedReason = (disabledReason ?? "").trim();
  const refusal = disabled ? (statedReason === "" ? REACH_CONTROL_COPY.disabledFallback : statedReason) : null;
  // No release means no reach: offering a setting here would fabricate a released edition the worker never made, so the surface states the rule instead of a value.
  if (current === null) {
    return (
      <div data-slot="reach-control" data-variant-id={variantId} data-reach-set="false" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
        {/* A standing explanation rather than an announcement: nothing changed, so nothing is spoken on render. */}
        <Alert role={undefined}>
          <AlertTitle>{REACH_CONTROL_COPY.noReleaseTitle}</AlertTitle>
          <AlertDescription>
            <p>{REACH_CONTROL_COPY.noReleaseBody}</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  const shown = chosen ?? current;
  const describedBy = refusal === null ? scopeNoteId : `${scopeNoteId} ${disabledReasonId}`;
  const choose = (next: string): void => {
    if (disabled) return;
    // The page's own reach rule decides whether a reported value is a setting at all and whether it changes anything, so this control repeats neither judgement: a value outside the three opens no review, and re-choosing the recorded value returns the control to the state the release is in.
    const decision = decideReach(current, next);
    if (decision.status === "invalid") return;
    setChosen(decision.status === "changed" ? decision.reach : null);
    setSettled(false);
  };
  const keepRecorded = (): void => {
    setChosen(null);
    setSettled(false);
  };
  const handleSettled = (outcome: ReachOutcome): void => {
    if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted" && outcome.outcome !== "unchanged") return;
    setSettled(true);
    if (chosen !== null) onSaved?.(chosen);
  };
  return (
    <div data-slot="reach-control" data-variant-id={variantId} data-current-reach={current} data-selected-reach={shown} data-reach-set="true" data-state={chosen === null ? "recorded" : settled ? "settled" : "review"} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <fieldset className="min-w-0 border-0 p-0" disabled={disabled}>
        <legend id={legendId} className="pb-2 text-start text-sm font-medium">
          {copy.release.reachHeading}
        </legend>
        <p id={scopeNoteId} className="max-w-prose pb-3 text-sm text-pretty text-muted-foreground">
          {REACH_CONTROL_COPY.scopeNote}
        </p>
        {refusal === null ? null : (
          <p id={disabledReasonId} className="pb-3 text-sm text-pretty text-muted-foreground">
            {refusal}
          </p>
        )}
        <RadioGroup value={shown} onValueChange={choose} disabled={disabled} aria-labelledby={legendId} aria-describedby={describedBy}>
          {REACH_VALUES.map((option) => {
            const wording = copy.reach[option];
            const optionId = `${idPrefix}-reach-${option}`;
            const descriptionId = `${optionId}-description`;
            return (
              <Label key={option} htmlFor={optionId} data-reach-option={option} className="min-h-target items-start gap-3 py-1">
                <RadioGroupItem id={optionId} value={option} aria-label={wording.label} aria-describedby={descriptionId} className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{wording.label}</span>
                  <span id={descriptionId} className="text-sm font-normal text-pretty text-muted-foreground">
                    {wording.explanation}
                  </span>
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      </fieldset>
      {chosen === null ? null : (
        <ActionReview<SetReachPayload>
          title={REACH_CONTROL_COPY.reviewTitle}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <ReachComparison recorded={current} intended={chosen} />
              <p>{REACH_CONTROL_COPY.reviewNote}</p>
            </div>
          }
          confirmLabel={REACH_CONTROL_COPY.confirmLabel}
          cancelLabel={REACH_CONTROL_COPY.cancelLabel}
          onCancel={keepRecorded}
          input={{ scope, expectedRevision, payload: { documentId, reach: chosen } }}
          submit={submit}
          onSettled={handleSettled}
          simulationEffect={copy.release.simulatedEffectKey}
          fieldLabels={FIELD_LABELS}
          headingLevel={3}
        />
      )}
      {settled ? (
        <div>
          <Button type="button" variant="outline" onClick={keepRecorded}>
            {REACH_CONTROL_COPY.doneLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
