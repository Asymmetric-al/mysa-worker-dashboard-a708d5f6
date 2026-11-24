"use client";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { decideReach, REACH_VALUES, type Reach } from "@/modules/content/reach";
import { copy } from "../copy";
import { openRevisionOf, settledRevisionOf, useSetPageReach, type SetReachVariables } from "../hooks/page-mutations";
import type { SetReachPayload } from "../schemas/reach";
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
  readonly variantId: string;
  readonly documentId: string;
  readonly scope: SetReachVariables["scope"];
  readonly expectedRevision: string;
  readonly current: Reach | null;
  readonly onSaved?: (reach: Reach) => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly className?: string;
};
const ReachComparison = ({ recorded, intended }: { readonly recorded: Reach; readonly intended: Reach }): ReactElement => (
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
/** How far one released edition reaches: the three settings, what each means, and the reviewed save that applies one of them. */
export default function ReachControl({ variantId, documentId, scope, expectedRevision, current, onSaved, disabled = false, disabledReason, className }: ReachControlProps): ReactElement {
  const idPrefix = useId();
  const legendId = useId();
  const scopeNoteId = useId();
  const disabledReasonId = useId();
  const [chosen, setChosen] = useState<Reach | null>(null);
  const [settled, setSettled] = useState(false);
  const [attemptRevision, setAttemptRevision] = useState<string | null>(null);
  const [acceptedRevision, setAcceptedRevision] = useState<string | null>(null);
  const setReach = useSetPageReach();
  const mutateReach = setReach.mutateAsync;
  const submit = useCallback(async (input: SetReachVariables) => mutateReach({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateReach]);
  const refusal = disabled ? ((disabledReason ?? "").trim() === "" ? REACH_CONTROL_COPY.disabledFallback : (disabledReason ?? "").trim()) : null;
  if (current === null) {
    return (
      <div data-slot="reach-control" data-variant-id={variantId} data-reach-set="false" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
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
  // The revision a new attempt presents: the record's revision as the read states it, or — until that read has landed — the revision the change this view last had accepted produced.
  const openRevision = openRevisionOf(expectedRevision, attemptRevision, acceptedRevision);
  const choose = (next: string): void => {
    if (disabled) return;
    const decision = decideReach(current, next);
    if (decision.status === "invalid") return;
    setChosen(decision.status === "changed" ? decision.reach : null);
    setAttemptRevision(decision.status === "changed" ? openRevision : null); // The revision this step is opened against, held for the attempt: the read that follows an acceptance states a newer one, and the result the step reports still belongs to the attempt it made.
    setSettled(false);
  };
  const keepRecorded = (): void => {
    setChosen(null);
    setSettled(false);
  };
  const handleSettled = (outcome: Awaited<ReturnType<ReturnType<typeof useSetPageReach>["mutateAsync"]>>): void => {
    const settledRevision = settledRevisionOf(outcome);
    if (settledRevision === null) return;
    setAcceptedRevision(settledRevision);
    setSettled(true);
    if (chosen !== null) onSaved?.(chosen);
  };
  return (
    <div data-slot="reach-control" data-variant-id={variantId} data-current-reach={current} data-selected-reach={shown} data-reach-set="true" data-state={chosen === null ? "recorded" : settled ? "settled" : "review"} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <fieldset className="min-w-0 border-0 p-0" disabled={disabled}>
        <legend {...{ id: legendId, className: "pb-2 text-start text-sm font-medium" as const }}>{copy.release.reachHeading}</legend>
        <p {...{ id: scopeNoteId, className: "max-w-prose pb-3 text-sm text-pretty text-muted-foreground" as const }}>{REACH_CONTROL_COPY.scopeNote}</p>
        {refusal === null ? null : <p {...{ id: disabledReasonId, className: "pb-3 text-sm text-pretty text-muted-foreground" as const }}>{refusal}</p>}
        <RadioGroup value={shown} onValueChange={choose} disabled={disabled} aria-labelledby={legendId} aria-describedby={refusal === null ? scopeNoteId : `${scopeNoteId} ${disabledReasonId}`}>
          {REACH_VALUES.map((option) => {
            const wording = copy.reach[option];
            const optionId = `${idPrefix}-reach-${option}`;
            const descriptionId = `${optionId}-description`;
            return (
              <Label key={option} htmlFor={optionId} data-reach-option={option} className="min-h-target items-start gap-3 py-1">
                <RadioGroupItem id={optionId} value={option} aria-label={wording.label} aria-describedby={descriptionId} className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{wording.label}</span>
                  <span {...{ id: descriptionId, className: "text-sm font-normal text-pretty text-muted-foreground" as const }}>{wording.explanation}</span>
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
              <ReachComparison recorded={current} intended={chosen} /> <p>{REACH_CONTROL_COPY.reviewNote}</p>
            </div>
          }
          confirmLabel={REACH_CONTROL_COPY.confirmLabel}
          cancelLabel={REACH_CONTROL_COPY.cancelLabel}
          onCancel={keepRecorded}
          input={{ scope, expectedRevision: attemptRevision ?? openRevision, payload: { documentId, reach: chosen } }}
          submit={submit}
          onSettled={handleSettled}
          simulationEffect={copy.release.simulatedEffectKey}
          fieldLabels={FIELD_LABELS}
          headingLevel={3}
        />
      )}
      {settled ? (
        <div>
          <Button {...{ type: "button" as const, variant: "outline" as const, onClick: keepRecorded }}>{REACH_CONTROL_COPY.doneLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}
