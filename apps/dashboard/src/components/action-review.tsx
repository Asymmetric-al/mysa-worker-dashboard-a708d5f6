"use client";
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { hasSettled, intentKeyOf, mayReplay, useAttemptedMutation, type MutationSubmit } from "@/components/attempt";
import OperationResult from "@/components/operation-result";
import SimulationLabel, { type SimulatedEffect } from "@/components/simulation-label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationInput } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
export { attemptForIntent, intentKeyOf, mayReplay, reappliableRevision, useReviewedMutation } from "@/components/attempt";
export type { MutationSubmit, ReviewedAttempt, UseReviewedMutationResult } from "@/components/attempt";
const CONTAINMENT_SENTENCE = "Confirming applies this change once. Nothing outside the summary above changes: this step sends " + "no notice, creates no financial record and subscribes no one unless the summary names it.";
const SETTLED_SENTENCE = "This step is complete for this attempt, and the result below is its record. Changing what this " + "step would apply begins a new attempt with its own identity.";
const NOTHING_SELECTED_SENTENCE = "Nothing is selected, so this step has nothing to apply. Select at least one row in the list, then " + "return here.";
const COUNT_CLASS = "tabular-figures font-medium text-foreground";
const STEP_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The one type scale's utility per level, so a review step and its receipt state the level they sit at with the same measure on every surface. */ const STEP_HEADING_SCALE: Readonly<Record<"h2" | "h3" | "h4", string>> = { h2: "type-section-title", h3: "type-subsection-title", h4: "type-group-title" };
/** The heading level a step renders at when the caller states none. */ export type ReviewHeadingLevel = keyof typeof STEP_HEADING_TAG;
export type ActionReviewSelection = { readonly count: number; readonly noun: string; readonly excluded?: number };
export type ActionReviewProps<P = unknown> = {
  readonly title: string;
  readonly description?: ReactNode;
  readonly consequence?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly onCancel?: () => void;
  readonly consequential?: boolean;
  readonly simulationEffect?: SimulatedEffect;
  readonly selection?: ActionReviewSelection;
  readonly input: Omit<MutationInput<P>, "operationId">;
  readonly submit: MutationSubmit<P>;
  readonly checkResult?: () => void;
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;
  readonly headingLevel?: ReviewHeadingLevel;
  /** A choice this step's own input carries, rendered with the step rather than in a second surface beside it: the control belongs to the reviewed intent, so changing it changes the intent and begins a new attempt's identity. */ readonly children?: ReactNode;
  readonly className?: string;
};
const receiptHeadingLevel = (level: ReviewHeadingLevel): 2 | 3 | 4 => (level === 2 ? 3 : 4);
function SelectionSummary({ selection }: { readonly selection: ActionReviewSelection }): ReactElement {
  const excluded = selection.excluded ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty">
      <p>
        Selected: <bdi className={COUNT_CLASS}>{String(selection.count)}</bdi> {selection.noun}.
      </p>
      {excluded <= 0 ? null : (
        <p className="text-muted-foreground">
          Excluded before this step: <bdi className={COUNT_CLASS}>{String(excluded)}</bdi> {selection.noun}. This step leaves them unchanged.
        </p>
      )}
    </div>
  );
}
/** The one review-then-accept step. */
export function ActionReview<P = unknown>({ title, description, consequence, confirmLabel, cancelLabel = "Cancel", onCancel, consequential = false, simulationEffect, selection, input, submit, checkResult, onSettled, fieldLabels, headingLevel = 2, children, className }: ActionReviewProps<P>): ReactElement {
  const { operationId, pending, outcome, reviewedIntent, submit: dispatchSubmit, retry, reapplyOnConflict } = useAttemptedMutation<P>(submit, onSettled);
  const titleId = useId();
  const emptySelectionId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const reviewed = reviewedIntent === intentKeyOf(input);
  const current = reviewed ? outcome : null;
  const settled = reviewed && hasSettled(outcome);
  const nothingSelected = selection !== undefined && selection.count <= 0;
  const confirmUnavailable = pending || nothingSelected;
  const state = pending ? "working" : settled ? "settled" : "review";
  useEffect(() => {
    if (current === null || current.outcome === "invalid") return;
    resultRef.current?.focus();
  }, [current]);
  const confirm = (): void => {
    setDialogOpen(false);
    void dispatchSubmit(input);
  };
  const replay = (): void => void retry();
  const applyAgain = (): void => void reapplyOnConflict();
  const confirmText = pending ? `${confirmLabel} — working` : confirmLabel;
  const describedByEmptySelection = nothingSelected ? emptySelectionId : undefined;
  const Heading = STEP_HEADING_TAG[headingLevel];
  return (
    <section aria-labelledby={titleId} aria-busy={pending ? true : undefined} data-slot="action-review" data-state={state} data-operation-id={operationId ?? undefined} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <Frame spacing="flush">
        <FramePanel>
          <Card className="min-w-0 rounded-none border-0 shadow-none ring-0">
            <CardHeader className="border-b border-border/70">
              <CardTitle>
                <Heading id={titleId} className={STEP_HEADING_SCALE[STEP_HEADING_TAG[headingLevel]]}>
                  {title}
                </Heading>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              {description === undefined ? null : <div className="min-w-0 text-sm text-pretty text-muted-foreground">{description}</div>}
              {selection === undefined ? null : <SelectionSummary selection={selection} />}
              {children === undefined ? null : (
                <div data-slot="action-review-choice" className="flex min-w-0 flex-col gap-3">
                  {children}
                </div>
              )}
              <p className="text-sm text-pretty text-muted-foreground">{CONTAINMENT_SENTENCE}</p>
              {simulationEffect === undefined ? null : <SimulationLabel effect={simulationEffect} />}
              <Separator />
              {settled ? (
                <p className="text-sm text-pretty text-muted-foreground">{SETTLED_SENTENCE}</p>
              ) : (
                <>
                  {nothingSelected ? (
                    <p id={emptySelectionId} className="text-sm text-pretty text-muted-foreground">
                      {NOTHING_SELECTED_SENTENCE}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {consequential ? (
                      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <AlertDialogTrigger render={<Button type="button" variant="destructive" disabled={confirmUnavailable} aria-describedby={describedByEmptySelection} />}>{confirmText}</AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{confirmLabel}</AlertDialogTitle>
                            <AlertDialogDescription className="flex flex-col gap-2">
                              <span className="font-medium text-foreground">{title}</span>
                              <span>{"It takes effect as soon as you confirm it."}</span>
                              {selection === undefined ? null : (
                                <span>
                                  It applies to <bdi className={COUNT_CLASS}>{String(selection.count)}</bdi> selected {selection.noun}
                                  {(selection.excluded ?? 0) <= 0 ? null : (
                                    <>
                                      ; <bdi className={COUNT_CLASS}>{String(selection.excluded ?? 0)}</bdi> excluded {selection.noun} are left unchanged
                                    </>
                                  )}
                                  .
                                </span>
                              )}
                              <span>{CONTAINMENT_SENTENCE}</span>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          {consequence === undefined ? null : <div className="min-w-0 text-sm text-pretty">{consequence}</div>}
                          {simulationEffect === undefined ? null : <SimulationLabel effect={simulationEffect} context="block" />}
                          <AlertDialogFooter>
                            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
                            <AlertDialogAction confirmVariant="destructive" onClick={confirm}>
                              {confirmLabel}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <Button type="button" disabled={confirmUnavailable} aria-describedby={describedByEmptySelection} onClick={confirm}>
                        {confirmText}
                      </Button>
                    )}
                    {onCancel === undefined ? null : (
                      <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
                        {cancelLabel}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </FramePanel>
      </Frame>
      {current === null ? null : (
        <div ref={resultRef} tabIndex={-1} data-slot="action-review-result" data-outcome={current.outcome} className="flex min-w-0 flex-col gap-3">
          {simulationEffect === undefined ? null : <SimulationLabel effect={simulationEffect} context="block" />}
          <OperationResult outcome={current} headingLevel={receiptHeadingLevel(headingLevel)} onCheckResult={current.outcome === "unknown" ? checkResult : undefined} onRetrySameWork={mayReplay(current) ? replay : undefined} onReapply={current.outcome === "conflict" ? applyAgain : undefined} fieldLabels={fieldLabels} />
        </div>
      )}
    </section>
  );
}
export default ActionReview;
