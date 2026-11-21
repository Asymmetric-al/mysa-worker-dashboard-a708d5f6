"use client";
/**
 * The one review-then-accept step, and the one owner of an attempt's identity.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import OperationResult from "@/components/operation-result";
import SimulationLabel, { type SimulatedEffect } from "@/components/simulation-label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { newOperationId } from "@/lib/ids";
import type { MutationInput } from "@/modules/data-service/envelope";
import { isOutcome, outcomeFromError, type MutationOutcome } from "@/modules/data-service/outcome";
const CONTAINMENT_SENTENCE =
  "Confirming applies this change once. Nothing outside the summary above changes: this step sends " + "no notice, creates no financial record and subscribes no one unless the summary names it.";
const CONFIRM_EFFECT_SENTENCE = "It takes effect as soon as you confirm it.";

const SETTLED_SENTENCE = "This step is complete for this attempt, and the result below is its record. Changing what this " + "step would apply begins a new attempt with its own identity.";

const NOTHING_SELECTED_SENTENCE = "Nothing is selected, so this step has nothing to apply. Select at least one row in the list, then " + "return here.";

const COUNT_CLASS = "tabular-figures font-medium text-foreground";

const STEP_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The heading level a step renders at when the caller states none. */
export type ReviewHeadingLevel = keyof typeof STEP_HEADING_TAG;
/** The identity of one attempt, as the hook holds it: the `operationId` the service recognises, and the intent fingerprint it was minted for (`null` until a submission states that intent). */
export interface ReviewedAttempt {
  readonly operationId: string;
  readonly intent: string | null;
}
function canonicalIntent(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
    case "boolean":
      return value ? "true" : "false";
    case "object":
      break;
    default:
      return JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalIntent(entry)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalIntent(record[key])}`);
  return `{${fields.join(",")}}`;
}
/** The stable fingerprint of one intent: the context, the revision the caller saw, and the payload. */
export function intentKeyOf(input: Omit<MutationInput<unknown>, "operationId">): string {
  return canonicalIntent(input);
}
/** The identity an attempt must carry, given the identity already held and the intent submitted now. */
export function attemptForIntent(current: ReviewedAttempt | null, intent: string, mint: () => string = newOperationId): ReviewedAttempt {
  if (current !== null && current.intent === intent) {
    return current;
  }
  return { operationId: mint(), intent };
}
/** Whether an outcome leaves the same operation worth replaying. */
export function mayReplay(outcome: MutationOutcome | null): boolean {
  return outcome !== null && (outcome.outcome === "unavailable" || outcome.outcome === "unknown");
}
/** The revision a conflict's preserved input may be re-applied against, or `null` when there is no conflict to re-apply. */
export function reappliableRevision(outcome: MutationOutcome | null): string | null {
  return outcome !== null && outcome.outcome === "conflict" ? outcome.currentRevision : null;
}
/** The mutation transport a feature supplies: the one route-handler call, in the feature's hands. */
export type MutationSubmit<P> = (input: MutationInput<P>) => Promise<MutationOutcome>;
/** What {@link useReviewedMutation} hands back to the step that renders it. */
export interface UseReviewedMutationResult<P> {
  readonly operationId: string | null;
  readonly pending: boolean;
  readonly outcome: MutationOutcome | null;
  readonly reviewedIntent: string | null;
  submit(input: Omit<MutationInput<P>, "operationId">): Promise<MutationOutcome>;
  retry(): Promise<MutationOutcome | null>;
  reapply(): Promise<MutationOutcome | null>;
  reset(): void;
}
/** Owns the attempt identity, the in-flight fence and the last outcome of one reviewed mutation. */
export function useReviewedMutation<P = unknown>(submit: MutationSubmit<P>): UseReviewedMutationResult<P> {
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
  const [attempt, setAttempt] = useState<ReviewedAttempt | null>(null);
  const attemptRef = useRef<ReviewedAttempt | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [outcome, setOutcome] = useState<MutationOutcome | null>(null);
  const outcomeRef = useRef<MutationOutcome | null>(null);
  const [reviewedIntent, setReviewedIntent] = useState<string | null>(null);
  const inputRef = useRef<Omit<MutationInput<P>, "operationId"> | null>(null);
  const inFlightRef = useRef<Promise<MutationOutcome> | null>(null);
  const adopt = useCallback((next: ReviewedAttempt | null): ReviewedAttempt | null => {
    attemptRef.current = next;
    setAttempt(next);
    return next;
  }, []);
  const submitInput = useCallback(
    (input: Omit<MutationInput<P>, "operationId">, reviewsInput = true): Promise<MutationOutcome> => {
      const running = inFlightRef.current;
      if (running !== null) {
        return running;
      }
      const intent = intentKeyOf(input);
      if (reviewsInput) {
        setReviewedIntent(intent);
      }
      const identity = attemptForIntent(attemptRef.current, intent);
      adopt(identity);
      inputRef.current = input;
      pendingRef.current = true;
      setPending(true);
      const request: MutationInput<P> = {
        operationId: identity.operationId,
        scope: input.scope,
        expectedRevision: input.expectedRevision,
        payload: input.payload,
      };
      const finish = (result: MutationOutcome): MutationOutcome => {
        pendingRef.current = false;
        outcomeRef.current = result;
        setPending(false);
        setOutcome(result);
        return result;
      };
      const run = (async (): Promise<MutationOutcome> => {
        try {
          const answered: unknown = await submitRef.current(request);
          return finish(isOutcome(answered) ? answered : outcomeFromError(identity.operationId, answered));
        } catch (error) {
          return finish(outcomeFromError(identity.operationId, error));
        }
      })();
      const tracked: Promise<MutationOutcome> = run.finally(() => {
        inFlightRef.current = null;
      });
      inFlightRef.current = tracked;
      return tracked;
    },
    [adopt],
  );
  const retry = useCallback(async (): Promise<MutationOutcome | null> => {
    const input = inputRef.current;
    if (input === null || pendingRef.current || !mayReplay(outcomeRef.current)) {
      return null;
    }
    return submitInput(input);
  }, [submitInput]);
  const reapply = useCallback(async (): Promise<MutationOutcome | null> => {
    const input = inputRef.current;
    const revision = reappliableRevision(outcomeRef.current);
    if (input === null || revision === null || pendingRef.current) {
      return null;
    }
    return submitInput({ ...input, expectedRevision: revision }, false);
  }, [submitInput]);
  const reset = useCallback((): void => {
    if (pendingRef.current) {
      return;
    }
    adopt(null);
    inputRef.current = null;
    outcomeRef.current = null;
    setOutcome(null);
    setReviewedIntent(null);
  }, [adopt]);
  return {
    operationId: attempt === null ? null : attempt.operationId,
    pending,
    outcome,
    reviewedIntent,
    submit: submitInput,
    retry,
    reapply,
    reset,
  };
}
/** The rows a step applies to, named and counted before the write. */
export interface ActionReviewSelection {
  readonly count: number;
  readonly noun: string;
  readonly excluded?: number;
}
/** Props of {@link ActionReview}. */
export interface ActionReviewProps<P = unknown> {
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
  readonly className?: string;
}
function receiptHeadingLevel(level: ReviewHeadingLevel): 2 | 3 | 4 {
  switch (level) {
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 4;
  }
}
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
export function ActionReview<P = unknown>({
  title,
  description,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  onCancel,
  consequential = false,
  simulationEffect,
  selection,
  input,
  submit,
  checkResult,
  onSettled,
  fieldLabels,
  headingLevel = 2,
  className,
}: ActionReviewProps<P>): ReactElement {
  const { operationId, pending, outcome, reviewedIntent, submit: dispatchSubmit, retry, reapply } = useReviewedMutation<P>(submit);
  const titleId = useId();
  const emptySelectionId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const reviewed = reviewedIntent === intentKeyOf(input);
  const current = reviewed ? outcome : null;
  const settled = current !== null && (current.outcome === "accepted" || current.outcome === "alreadyAccepted" || current.outcome === "unchanged");
  const nothingSelected = selection !== undefined && selection.count <= 0;
  const confirmUnavailable = pending || nothingSelected;
  const state = pending ? "working" : settled ? "settled" : "review";
  useEffect(() => {
    if (current === null || current.outcome === "invalid") {
      return;
    }
    resultRef.current?.focus();
  }, [current]);
  const settle = useCallback(
    async (run: () => Promise<MutationOutcome | null>): Promise<void> => {
      const result = await run();
      if (result !== null) {
        onSettled?.(result);
      }
    },
    [onSettled],
  );
  const confirm = (): void => {
    setDialogOpen(false);
    void settle(() => dispatchSubmit(input));
  };
  const replay = (): void => {
    void settle(retry);
  };
  const applyAgain = (): void => {
    void settle(reapply);
  };
  const confirmText = pending ? `${confirmLabel} — working` : confirmLabel;
  const describedByEmptySelection = nothingSelected ? emptySelectionId : undefined;
  const Heading = STEP_HEADING_TAG[headingLevel];
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={pending ? true : undefined}
      data-slot="action-review"
      data-state={state}
      data-operation-id={operationId ?? undefined}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <Heading id={titleId}>{title}</Heading>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {description === undefined ? null : <div className="min-w-0 text-sm text-pretty text-muted-foreground">{description}</div>}
          {selection === undefined ? null : <SelectionSummary selection={selection} />}
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
                    <AlertDialogTrigger render={<Button type="button" variant="destructive" disabled={confirmUnavailable} aria-describedby={describedByEmptySelection} />}>
                      {confirmText}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{confirmLabel}</AlertDialogTitle>
                        {/* The description element is itself a paragraph, so each sentence is a span
                         * laid out as a block: nesting paragraphs would be invalid markup. */}
                        <AlertDialogDescription className="flex flex-col gap-2">
                          <span className="font-medium text-foreground">{title}</span>
                          <span>{CONFIRM_EFFECT_SENTENCE}</span>
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
      {current === null ? null : (
        <div ref={resultRef} tabIndex={-1} data-slot="action-review-result" data-outcome={current.outcome} className="flex min-w-0 flex-col gap-3">
          {simulationEffect === undefined ? null : <SimulationLabel effect={simulationEffect} context="block" />}
          <OperationResult
            outcome={current}
            headingLevel={receiptHeadingLevel(headingLevel)}
            onCheckResult={current.outcome === "unknown" ? checkResult : undefined}
            onRetrySameWork={mayReplay(current) ? replay : undefined}
            onReapply={current.outcome === "conflict" ? applyAgain : undefined}
            fieldLabels={fieldLabels}
          />
        </div>
      )}
    </section>
  );
}
export default ActionReview;
