"use client";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { EllipsisIcon } from "lucide-react";
import type { ZodType } from "zod";
import { createPortal } from "react-dom";
import { hasSettled, intentKeyOf, mayReplay, useReviewedMutation, type MutationSubmit } from "@/components/attempt";
import OperationResult, { focusAnnouncedRegion, type ReceiptHeadingLevel } from "@/components/operation-result";
import { useRecordListRowResultsId } from "@/components/record-list";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import type { MutationInput, ReadAction, Scope, TaskRecordStatus } from "@/modules/data-service/envelope";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { COMPLETION_MEANS_NOTHING_NOTE, TASK_STATUS_LABELS } from "../copy/task-status";
import { useTaskMutations, type TaskIntent } from "../hooks/use-task-mutations";
import { cancelTaskSchema, completeTaskSchema, reopenTaskSchema, type CancelTaskPayload, type CompleteTaskPayload, type ReopenTaskPayload } from "../schemas/task";
const ACTION_ORDER = ["completeTask", "reopenTask", "editTask", "cancelTask"] as const;
export type TaskActionName = (typeof ACTION_ORDER)[number];
type TaskTransitionPayload = CompleteTaskPayload | ReopenTaskPayload | CancelTaskPayload;
type TaskTransitionName = TaskTransitionPayload["operation"];
const ACTION_LABELS: Readonly<Record<TaskActionName, string>> = { completeTask: "Complete", reopenTask: "Reopen", editTask: "Edit", cancelTask: "Cancel" };
const WORKING_SUFFIX = " — working";
const CANCEL_CONFIRM_LABEL = "Cancel the task";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { operation: "Action", taskId: "Task", confirmed: "Confirmation" };
export const TASK_STATUS_TONES: Readonly<Record<TaskRecordStatus, StatusTone>> = { open: "info", completed: "positive", reopened: "caution", cancelled: "muted" };
const ACTION_VARIANTS: Readonly<Record<TaskActionName, "default" | "outline" | "destructive">> = { completeTask: "default", reopenTask: "outline", editTask: "outline", cancelTask: "destructive" };
const PAYLOADS: Readonly<Record<TaskTransitionName, (taskId: string) => TaskTransitionPayload>> = { completeTask: (taskId) => ({ operation: "completeTask", taskId }), reopenTask: (taskId) => ({ operation: "reopenTask", taskId }), cancelTask: (taskId) => ({ operation: "cancelTask", taskId, confirmed: true }) };
export type TaskActionsPresentation = "row" | "body";
export interface TaskActionsProps {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskRecordStatus;
  readonly revision: string;
  readonly scope: Scope;
  readonly actions: readonly ReadAction[];
  readonly presentation: TaskActionsPresentation;
  readonly onEdit: () => void;
  readonly onOutcome?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly headingLevel?: ReceiptHeadingLevel;
  readonly className?: string;
}
const factOf = (actions: readonly ReadAction[], name: TaskActionName): ReadAction => actions.find((entry) => entry.name === name) ?? { name, available: false, reason: "This view did not report this action, so it is not offered here; open the task again to see what it allows." };
function reasonOf(fact: ReadAction): string {
  const stated = (fact.reason ?? "").trim();
  return stated === "" ? "This action is not available from this view." : stated;
}
function titleTextOf(title: string, taskId: string): string {
  const stated = title.trim();
  return stated === "" ? taskId : stated;
}
function sendTransition<T extends TaskTransitionPayload>(schema: ZodType<T>, run: (intent: TaskIntent<T>) => Promise<MutationOutcome>, input: MutationInput<T>): Promise<MutationOutcome> {
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) return Promise.resolve(invalid({ operationId: input.operationId, fields: parsed.error }));
  return run({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: parsed.data });
}
/** One task's complete, reopen, edit and cancel actions, in a row menu or in the record body. */ export default function TaskActions({ taskId, title, status, revision, scope, actions, presentation, onEdit, onOutcome, onCheckResult, headingLevel, className }: TaskActionsProps): ReactElement {
  const instanceId = useId();
  const noteId = `${instanceId}-note`;
  const resultRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const controlRefs = useRef<Partial<Record<TaskActionName, HTMLButtonElement | null>>>({});
  const runningRef = useRef(false);
  const listResultsId = useRecordListRowResultsId();
  // The list's own result region, found by the identifier the list publishes: the region is part of the list's markup, so it is in the document whenever a row of that list is, and no render has to wait for one to be registered.
  const rowResults = presentation === "row" && listResultsId !== null && typeof document !== "undefined" ? document.getElementById(listResultsId) : null;
  const [attempt, setAttempt] = useState<{ readonly action: TaskTransitionName; readonly input: Omit<MutationInput<TaskTransitionPayload>, "operationId"> } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dismissed, setDismissed] = useState<{ readonly action: TaskActionName | null } | null>(null);
  const mutations = useTaskMutations(scope);
  const submitTransition = useCallback<MutationSubmit<TaskTransitionPayload>>(
    async (input) => {
      const { payload } = input;
      switch (payload.operation) {
        case "completeTask":
          return sendTransition(completeTaskSchema, (intent) => mutations.completeTask.mutateAsync(intent), { ...input, payload });
        case "reopenTask":
          return sendTransition(reopenTaskSchema, (intent) => mutations.reopenTask.mutateAsync(intent), { ...input, payload });
        case "cancelTask":
          return sendTransition(cancelTaskSchema, (intent) => mutations.cancelTask.mutateAsync(intent), { ...input, payload });
      }
    },
    [mutations.cancelTask, mutations.completeTask, mutations.reopenTask],
  );
  const { operationId, pending, outcome, reviewedIntent, submit, retry, reapply, reset } = useReviewedMutation<TaskTransitionPayload>(submitTransition);
  const current = attempt !== null && reviewedIntent === intentKeyOf(attempt.input) ? outcome : null;
  const settled = current !== null && hasSettled(current);
  const titleText = titleTextOf(title, taskId);
  const receiptHeadingLevel = headingLevel ?? (presentation === "row" ? 4 : 3);
  const busyText = pending && attempt !== null ? `${ACTION_LABELS[attempt.action]}${WORKING_SUFFIX}` : "";
  const facts = ACTION_ORDER.map((name) => ({ name, fact: factOf(actions, name) }));
  const unavailable = facts.filter((entry) => !entry.fact.available);
  const reasonIdOf = (name: TaskActionName): string => `${instanceId}-${name}-reason`;
  useEffect(() => {
    if (current === null || current.outcome === "invalid") return;
    focusAnnouncedRegion(resultRef.current);
  }, [current]);
  // Where a closed dialog or a dismissed result hands the focus back to: the row's own trigger, which stays mounted for exactly that, or the record body's control for the action that was taken, which this surface renders again only once the result is dismissed. A row that has left the list it was read in leaves the list's own labelled region as the place to carry on from.
  const returnFocusTarget = useCallback(
    (action: TaskActionName | null): HTMLElement | null => {
      const invoked = presentation === "row" ? triggerRef.current : action === null ? null : (controlRefs.current[action] ?? null);
      if (invoked !== null && invoked.isConnected) return invoked;
      return rowResults?.closest('[data-slot="record-list"]')?.querySelector<HTMLElement>("section[tabindex]") ?? null;
    },
    [presentation, rowResults],
  );
  useEffect(() => {
    if (dismissed === null) return;
    returnFocusTarget(dismissed.action)?.focus();
  }, [dismissed, returnFocusTarget]);
  const report = useCallback(
    (result: MutationOutcome | null): void => {
      if (result !== null) onOutcome?.(result);
    },
    [onOutcome],
  );
  // The control that starts an attempt keeps its focus while that attempt is in flight, so the attempt is fenced here rather than by disabling the control: a second activation returns early and the attempt already running stays the only one.
  const run = useCallback(
    (action: TaskTransitionName): void => {
      if (runningRef.current) return;
      runningRef.current = true;
      const input: Omit<MutationInput<TaskTransitionPayload>, "operationId"> = { scope, expectedRevision: revision, payload: PAYLOADS[action](taskId) };
      setAttempt({ action, input });
      void submit(input)
        .then(report)
        .catch(() => undefined)
        .finally(() => {
          runningRef.current = false;
        });
    },
    [report, revision, scope, submit, taskId],
  );
  const startAction = useCallback(
    (action: TaskActionName): void => {
      if (runningRef.current) return;
      if (action === "editTask") onEdit();
      else if (action === "cancelTask") setConfirmOpen(true);
      else run(action);
    },
    [onEdit, run],
  );
  const changeConfirmOpen = useCallback(
    (open: boolean): void => {
      setConfirmOpen(open);
      if (!open) returnFocusTarget("cancelTask")?.focus();
    },
    [returnFocusTarget],
  );
  const confirmCancel = useCallback((): void => {
    changeConfirmOpen(false);
    run("cancelTask");
  }, [changeConfirmOpen, run]);
  const dismiss = useCallback((): void => {
    setDismissed({ action: attempt?.action ?? null });
    reset();
    setAttempt(null);
  }, [attempt, reset]);
  const bodyControls = facts.map(({ name, fact }) => (
    <Button
      key={name}
      ref={(element) => {
        controlRefs.current[name] = element;
      }}
      type="button"
      variant={ACTION_VARIANTS[name]}
      size="sm"
      disabled={!fact.available}
      aria-busy={pending && attempt?.action === name ? true : undefined}
      aria-describedby={fact.available ? undefined : reasonIdOf(name)}
      onClick={() => startAction(name)}
      className={BUTTON_WRAP_CLASS}
    >
      {ACTION_LABELS[name]}
      <span className="sr-only">
        {" for "}
        <bdi>{titleText}</bdi>
      </span>
    </Button>
  ));
  const receiptCheckResult = current !== null && current.outcome === "unknown" ? onCheckResult : undefined;
  const receiptRetry = current !== null && mayReplay(current) ? () => void retry().then(report) : undefined;
  const receiptReapply = current !== null && current.outcome === "conflict" ? () => void reapply().then(report) : undefined;
  // In a row the settled result goes to the list's own region below the table, because inside the actions cell its width widened the table past a phone's viewport and the table region scrolled onto the cell it sat in. A surface with no such region places the result where it is produced, as the record body does.
  const receipt =
    current === null ? null : (
      <div ref={resultRef} tabIndex={-1} data-slot="task-action-result" data-outcome={current.outcome} data-task-id={taskId} className={cn("flex min-w-0 flex-col gap-2", presentation === "row" && (rowResults === null ? "w-64 max-w-full text-start whitespace-normal" : "w-full text-start whitespace-normal"))}>
        <OperationResult outcome={current} headingLevel={receiptHeadingLevel} onCheckResult={receiptCheckResult} onRetrySameWork={receiptRetry} onReapply={receiptReapply} fieldLabels={FIELD_LABELS} />
        {settled ? (
          <Button type="button" variant="outline" size="sm" onClick={dismiss} className={BUTTON_WRAP_CLASS}>
            {"Dismiss this result"}
          </Button>
        ) : null}
      </div>
    );
  const placedReceipt = receipt === null || rowResults === null ? receipt : createPortal(receipt, rowResults);
  const rowControls = (
    <>
      <span id={noteId} className="sr-only">
        {COMPLETION_MEANS_NOTHING_NOTE}
      </span>
      {/* The row's own control stays in the DOM for as long as its result shows: it is the control a dismissed result returns the focus to, and it is what keeps the row's height while the result is read below the table. It states that an attempt is in flight with `aria-busy` rather than `disabled`, which would drop the focus the attempt was started with, and the attempt itself is fenced in the handlers. */}
      <DropdownMenu>
        <DropdownMenuTrigger ref={triggerRef} render={<Button type="button" variant="ghost" size="icon-sm" />} aria-label={`Actions for ${titleText}`} aria-describedby={noteId} aria-busy={pending ? true : undefined}>
          <EllipsisIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
          {facts.map(({ name, fact }) => (
            <Fragment key={name}>
              {name === "cancelTask" ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem disabled={!fact.available} onClick={() => startAction(name)} className="items-start py-2 whitespace-normal">
                <span className="flex min-w-0 flex-col gap-1 text-start">
                  <span>{ACTION_LABELS[name]}</span>
                  {fact.available ? null : <span className="text-xs text-pretty text-muted-foreground">{reasonOf(fact)}</span>}
                </span>
                <span className="sr-only">
                  {" for "}
                  <bdi>{titleText}</bdi>
                </span>
              </DropdownMenuItem>
            </Fragment>
          ))}
          <DropdownMenuLabel className="text-pretty whitespace-normal">{COMPLETION_MEANS_NOTHING_NOTE}</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const fieldsetClass = cn("flex min-w-0 flex-col gap-2 border-0 p-0", presentation === "row" && "items-end", className);
  return (
    <fieldset aria-busy={pending ? true : undefined} data-slot="task-actions" data-presentation={presentation} data-task-id={taskId} data-status={status} data-operation-id={operationId ?? undefined} className={fieldsetClass}>
      <legend className="sr-only">{"Task actions for {title}".replace("{title}", titleText)}</legend>
      {presentation === "body" ? (
        <>
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{"Status"}</span>
            <StatusBadge label={TASK_STATUS_LABELS[status]} tone={TASK_STATUS_TONES[status]} srPrefix="Task status" />
          </p>
          {settled ? <p className="text-sm text-pretty text-muted-foreground">{"This action is complete for this attempt, and the result below is its record; dismiss it to work with the task again."}</p> : <div className="flex min-w-0 flex-wrap items-center gap-2">{bodyControls}</div>}
          <p id={noteId} className="text-xs text-pretty text-muted-foreground">
            {COMPLETION_MEANS_NOTHING_NOTE}
          </p>
          {settled || unavailable.length === 0 ? null : (
            <ul className="flex min-w-0 flex-col gap-1">
              {unavailable.map(({ name, fact }) => (
                <li key={name} id={reasonIdOf(name)} className="text-xs text-pretty text-muted-foreground">{`${ACTION_LABELS[name]}: ${reasonOf(fact)}`}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        rowControls
      )}
      <output aria-live="polite" aria-atomic="true" className="sr-only">
        {busyText}
      </output>
      {placedReceipt}
      <AlertDialog open={confirmOpen} onOpenChange={changeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{"Cancel this task?"}</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-2">
              <bdi className="font-medium text-foreground">{titleText}</bdi>
              <span>{"A cancelled task stays cancelled: it is neither completed nor reopened afterwards, cancelling performs none of the work it describes, and it records no contact, payment, fulfilment or message."}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{"Keep the task"}</AlertDialogCancel>
            <AlertDialogAction confirmVariant="destructive" disabled={pending} onClick={confirmCancel}>
              {pending ? `${CANCEL_CONFIRM_LABEL}${WORKING_SUFFIX}` : CANCEL_CONFIRM_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fieldset>
  );
}
