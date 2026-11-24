"use client";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { EllipsisIcon } from "lucide-react";
import type { ZodType } from "zod";
import { hasSettled, intentKeyOf, mayReplay, useReviewedMutation, type MutationSubmit } from "@/components/attempt";
import OperationResult, { focusAnnouncedRegion, type ReceiptHeadingLevel } from "@/components/operation-result";
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
/** One attempt's settled receipt, published to the surface that composed the list: the task the attempt named, the outcome the service answered, and the recoveries that outcome admits. */
export type TaskActionReceipt = { readonly taskId: string; readonly title: string; readonly outcome: MutationOutcome; readonly onCheckResult?: () => void; readonly onRetrySameWork?: () => void; readonly onReapply?: () => void; readonly onDismiss: () => void };
export interface TaskActionsProps {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskRecordStatus;
  readonly revision: string;
  readonly scope: Scope;
  readonly actions: readonly ReadAction[];
  readonly presentation: TaskActionsPresentation;
  readonly onEdit: () => void;
  readonly onReceiptChange: (receipt: TaskActionReceipt | null) => void;
  readonly onCheckResult?: () => void;
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
/** The receipt's own box: a programmatic focus stop whose scroll margin clears the sticky shell, so the outcome this surface moves the focus to is never obscured by the chrome above it. */
const RECEIPT_CLASS = "flex min-w-0 scroll-mt-[calc(var(--app-shell-sticky-offset,4rem)_+_0.5rem)] flex-col gap-2 text-start whitespace-normal";
export type TaskActionResultProps = { readonly receipt: TaskActionReceipt | null; readonly headingLevel?: ReceiptHeadingLevel };
/** The one receipt for a task action, rendered by the surface that composes the list rather than by the row it came from: completing a task takes its row out of every list that reads only open work, which unmounts that row's actions, so a receipt they owned would leave with them. The whole card is brought inside the
 * viewport when a receipt arrives. */
export function TaskActionResult({ receipt, headingLevel = 3 }: TaskActionResultProps): ReactElement | null {
  const resultRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = resultRef.current;
    if (receipt === null || container === null) return;
    focusAnnouncedRegion(container);
    container.scrollIntoView({ block: "nearest" });
  }, [receipt]);
  if (receipt === null) return null;
  return (
    <div ref={resultRef} tabIndex={-1} data-slot="task-action-result" data-outcome={receipt.outcome.outcome} data-task-id={receipt.taskId} className={RECEIPT_CLASS}>
      {/* The task the attempt named: read at the list's width the receipt is no longer beside the row it came from, so it states which task's change it records rather than leaving the outcome to stand on its own. */}
      <p className="type-supporting max-w-prose text-pretty">
        {"This receipt records the change to "}
        <bdi className="font-medium">{titleTextOf(receipt.title, receipt.taskId)}</bdi>
        {"."}
      </p>
      <OperationResult outcome={receipt.outcome} headingLevel={headingLevel} onCheckResult={receipt.onCheckResult} onRetrySameWork={receipt.onRetrySameWork} onReapply={receipt.onReapply} fieldLabels={FIELD_LABELS} />
      {hasSettled(receipt.outcome) ? (
        <Button type="button" variant="outline" size="sm" onClick={receipt.onDismiss} className={BUTTON_WRAP_CLASS}>
          {"Dismiss this result"}
        </Button>
      ) : null}
    </div>
  );
}
/** One task's complete, reopen, edit and cancel actions, in a row menu or in the record body. */ export default function TaskActions({ taskId, title, status, revision, scope, actions, presentation, onEdit, onReceiptChange, onCheckResult, className }: TaskActionsProps): ReactElement {
  const instanceId = useId();
  const noteId = `${instanceId}-note`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const controlRefs = useRef<Partial<Record<TaskActionName, HTMLButtonElement | null>>>({});
  const runningRef = useRef(false);
  // Whether these actions are still the mounted owner of the receipt they published: a receipt outlives its row, so the dismiss it offers has to know which half of the hand-back it can still perform.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
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
  const busyText = pending && attempt !== null ? `${ACTION_LABELS[attempt.action]}${WORKING_SUFFIX}` : "";
  const facts = ACTION_ORDER.map((name) => ({ name, fact: factOf(actions, name) }));
  const unavailable = facts.filter((entry) => !entry.fact.available);
  const reasonIdOf = (name: TaskActionName): string => `${instanceId}-${name}-reason`;
  // Where a closed dialog or a dismissed result hands the focus back to: the row's own trigger, which stays mounted for exactly that, or the record body's control for the action that was taken, which this surface renders again only once the result is dismissed. A row that has left the list it was read in leaves no control of its own, so the place to carry on from is the list: its labelled scroll region while it holds rows, and its own first control — the empty state's action — once it holds none, rather than the document body.
  const returnFocusTarget = useCallback(
    (action: TaskActionName | null): HTMLElement | null => {
      const invoked = presentation === "row" ? triggerRef.current : action === null ? null : (controlRefs.current[action] ?? null);
      if (invoked !== null && invoked.isConnected) return invoked;
      const surface = document.querySelector<HTMLElement>('[data-slot="work-task-lists"], [data-slot="work-agenda"], [data-slot="record-list"]');
      if (surface === null) return null;
      const region = surface.querySelector<HTMLElement>('[data-slot="record-list"] section[tabindex]') ?? (surface.matches("section[tabindex]") ? surface : null);
      if (region !== null && region.isConnected) return region;
      // The receipt this dismissal is removing is never the place to land: the fallback runs before that removal commits, so its own control would be focused and then unmounted, dropping the reader's focus onto the document body. The first control the surface offers outside the receipt is what is left to carry on from.
      return [...surface.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], select:not([disabled]), input:not([disabled])")].find((candidate) => candidate.closest('[data-slot="task-action-result"]') === null) ?? null;
    },
    [presentation],
  );
  useEffect(() => {
    if (dismissed === null) return;
    returnFocusTarget(dismissed.action)?.focus();
  }, [dismissed, returnFocusTarget]);
  const dismiss = useCallback((): void => {
    onReceiptChange(null);
    reset();
    setAttempt(null);
    // A row that has left the list it was read in has unmounted these actions, so the hand-back below can never run for it: the list's own labelled region is then the place the focus returns to, so dismissing the last receipt of a filtered list never drops the reader's focus onto the document body.
    if (mountedRef.current) setDismissed({ action: attempt?.action ?? null });
    else returnFocusTarget(attempt?.action ?? null)?.focus();
  }, [attempt, onReceiptChange, reset, returnFocusTarget]);
  // The receipt is published from the promise that answers the attempt rather than from an effect on its outcome, so it reaches the surface that composed the list even when this row has already left it: a completion takes its row out of every list that reads only open work, and these actions are unmounted before an effect of theirs could run. A recovery published from that receipt runs through the ref, so a retried or re-applied attempt replaces the receipt it was read from.
  const publishRef = useRef<(result: MutationOutcome | null) => void>(() => undefined);
  const publish = useCallback(
    (result: MutationOutcome | null): void => {
      if (result === null) return;
      const republish = (next: MutationOutcome | null): void => publishRef.current(next);
      onReceiptChange({
        taskId,
        title: titleText,
        outcome: result,
        onCheckResult: result.outcome === "unknown" ? onCheckResult : undefined,
        onRetrySameWork: mayReplay(result) ? () => void retry().then(republish) : undefined,
        onReapply: result.outcome === "conflict" ? () => void reapply().then(republish) : undefined,
        onDismiss: dismiss,
      });
    },
    [dismiss, onCheckResult, onReceiptChange, reapply, retry, taskId, titleText],
  );
  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);
  // The control that starts an attempt keeps its focus while that attempt is in flight, so the attempt is fenced here rather than by disabling the control: a second activation returns early and the attempt already running stays the only one.
  const run = useCallback(
    (action: TaskTransitionName): void => {
      if (runningRef.current) return;
      runningRef.current = true;
      const input: Omit<MutationInput<TaskTransitionPayload>, "operationId"> = { scope, expectedRevision: revision, payload: PAYLOADS[action](taskId) };
      setAttempt({ action, input });
      void submit(input)
        .then(publish)
        .catch(() => undefined)
        .finally(() => {
          runningRef.current = false;
        });
    },
    [publish, revision, scope, submit, taskId],
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
  const rowControls = (
    <>
      <span id={noteId} className="sr-only">
        {COMPLETION_MEANS_NOTHING_NOTE}
      </span>
      {/* The row's own control is the control a dismissed result returns the focus to, for as long as the row it belongs to is in the list. It states that an attempt is in flight with `aria-busy` rather than `disabled`, which would drop the focus the attempt was started with, and the attempt itself is fenced in the handlers. */}
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
          {settled ? <p className="text-sm text-pretty text-muted-foreground">{"This action is complete for this attempt, and the receipt the surface renders is its record; dismiss that receipt to work with the task again."}</p> : <div className="flex min-w-0 flex-wrap items-center gap-2">{bodyControls}</div>}
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
