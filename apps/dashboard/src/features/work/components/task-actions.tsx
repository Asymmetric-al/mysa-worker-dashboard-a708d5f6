"use client";
/**
 * One task's actions — complete, reopen, edit and cancel — in a list row and in the record body.
 *
 * Both presentations offer the same four actions in the same order, with the same wording and the same
 * enabled state; only the chrome differs, so a row menu and a record body can never disagree about what one
 * task allows. Availability is the read envelope's advisory `actions` list: an action the read did not offer
 * is disabled and states the reason the read gave, and the service re-checks on submit, so a stale envelope
 * can produce `denied` but never an unauthorised write.
 */
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { EllipsisIcon } from "lucide-react";
import type { ZodType } from "zod";
import { intentKeyOf, mayReplay, useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import OperationResult, { type ReceiptHeadingLevel } from "@/components/operation-result";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MutationInput, ReadAction, Scope, TaskRecordStatus } from "@/modules/data-service/envelope";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { COMPLETION_MEANS_NOTHING_NOTE, TASK_STATUS_LABELS } from "../copy/task-status";
import { useTaskMutations, type TaskIntent } from "../hooks/use-task-mutations";
import { cancelTaskSchema, completeTaskSchema, reopenTaskSchema, type CancelTaskPayload, type CompleteTaskPayload, type ReopenTaskPayload } from "../schemas/task";
/** The four actions, in the one order both presentations render them: the reversible work first, the destructive action last. */
const ACTION_ORDER = ["completeTask", "reopenTask", "editTask", "cancelTask"] as const;
export type TaskActionName = (typeof ACTION_ORDER)[number];
type TaskTransitionPayload = CompleteTaskPayload | ReopenTaskPayload | CancelTaskPayload;
type TaskTransitionName = TaskTransitionPayload["operation"];
/** One attempt: the action pressed, and the three-field input whose fourth field — the identity — the review step mints. */
type TaskAttempt = { readonly action: TaskTransitionName; readonly input: Omit<MutationInput<TaskTransitionPayload>, "operationId"> };
/**
 * The action names are the envelope's own (`completeTask`, `reopenTask`, `editTask`, `cancelTask`), so an
 * advisory fact is matched to its action by the name the read reported rather than by the order it listed.
 */
const ACTION_LABELS: Readonly<Record<TaskActionName, string>> = { completeTask: "Complete", reopenTask: "Reopen", editTask: "Edit", cancelTask: "Cancel" };
const UNSTATED_ACTION_REASON = "This view did not report this action, so it is not offered here; open the task again to see what it allows.";
const DEFAULT_UNAVAILABLE_REASON = "This action is not available from this view.";
const GROUP_LABEL_TEMPLATE = "Task actions for {title}";
const WORKING_SUFFIX = " — working";
const TRIGGER_TITLE = "Actions";
const STATUS_LABEL = "Status";
const STATUS_SR_PREFIX = "Task status";
const SETTLED_SENTENCE = "This action is complete for this attempt, and the result below is its record; dismiss it to work with the task again.";
const DISMISS_LABEL = "Dismiss this result";
const CANCEL_DIALOG_TITLE = "Cancel this task?";
const CANCEL_DIALOG_SENTENCE = "A cancelled task stays cancelled: it is neither completed nor reopened afterwards, cancelling performs none of the work it describes, and it records no contact, payment, fulfilment or message.";
const CANCEL_CONFIRM_LABEL = "Cancel the task";
const CANCEL_KEEP_LABEL = "Keep the task";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { operation: "Action", taskId: "Task", confirmed: "Confirmation" };
/** The one tone each task status is stated in, exported so a list row and this menu state a status the same way rather than keeping a second copy of the mapping. */
export const TASK_STATUS_TONES: Readonly<Record<TaskRecordStatus, StatusTone>> = { open: "info", completed: "positive", reopened: "caution", cancelled: "muted" };
const CONTROL_CLASS = "h-auto min-h-8 max-w-full py-1.5 whitespace-normal";
export type TaskActionsPresentation = "row" | "body";
export interface TaskActionsProps {
  /** The task this control acts on. Identity is the identifier, never the title. */
  readonly taskId: string;
  /** The title this surface displayed, used to name the control group and every action for assistive technology. */
  readonly title: string;
  /** The status the surface read, so the record body states it without deriving one from an outcome. */
  readonly status: TaskRecordStatus;
  /** The revision this surface displayed; every submission presents it as `expectedRevision`. */
  readonly revision: string;
  /** The exact authority the surface was read under, handed on unchanged so the service re-checks it. */
  readonly scope: Scope;
  /** The advisory action facts from the same envelope, each naming its action, whether it is available, and why not. */
  readonly actions: readonly ReadAction[];
  /** `row` renders the actions as a menu; `body` renders them as buttons. The set, order, wording and enabled state are identical. */
  readonly presentation: TaskActionsPresentation;
  /** Opens or navigates to the composer. This file implements no form. */
  readonly onEdit: () => void;
  /** Reports each settled outcome to the host, so a surface that shows the receipt elsewhere can. */
  readonly onOutcome?: (outcome: MutationOutcome) => void;
  /** Reads back what an unconfirmed attempt did, by operation identity. Offered only on `unknown`. */
  readonly onCheckResult?: () => void;
  /** The heading level the receipt renders at; the caller knows the heading outline it sits in. */
  readonly headingLevel?: ReceiptHeadingLevel;
  readonly className?: string;
}
/** Joins the classes a caller stated with this component's own, without pulling in a second styling source. */
function classes(...values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined && value !== "").join(" ");
}
/** The transition payload one action asks for. `confirmed` is stated only because the dialog already asked. */
function payloadFor(action: TaskTransitionName, taskId: string): TaskTransitionPayload {
  switch (action) {
    case "completeTask":
      return { operation: "completeTask", taskId };
    case "reopenTask":
      return { operation: "reopenTask", taskId };
    case "cancelTask":
      return { operation: "cancelTask", taskId, confirmed: true };
  }
}
/** The fact a read reported for one action, or the stated absence that disables it. */
function factOf(actions: readonly ReadAction[], name: TaskActionName): ReadAction {
  const reported = actions.find((entry) => entry.name === name);
  return reported ?? { name, available: false, reason: UNSTATED_ACTION_REASON };
}
/** The reason an unavailable action states: the read's own sentence, or the one this surface owns when it gave none. */
function reasonOf(fact: ReadAction): string {
  const stated = (fact.reason ?? "").trim();
  return stated === "" ? DEFAULT_UNAVAILABLE_REASON : stated;
}
/** The task's name for a control: its title, or its identifier when a record states no title at all. */
function titleTextOf(title: string, taskId: string): string {
  const stated = title.trim();
  return stated === "" ? taskId : stated;
}
/**
 * Validates one transition payload and hands the identity, the revision and the parsed payload to its transport.
 *
 * The scope is not restated here: `useTaskMutations` builds each transport from the scope the route composition
 * passed this component, so the four-field mutation input is assembled from two owners — the identity from the
 * review step, the scope from the transport — and a payload the schema refuses never reaches the wire.
 */
function sendTransition<T extends TaskTransitionPayload>(schema: ZodType<T>, run: (intent: TaskIntent<T>) => Promise<MutationOutcome>, input: MutationInput<T>): Promise<MutationOutcome> {
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) {
    return Promise.resolve(invalid({ operationId: input.operationId, fields: parsed.error }));
  }
  return run({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: parsed.data });
}

/**
 * One task's complete, reopen, edit and cancel actions, in a row menu or in the record body.
 *
 * The component owns only what the person did and what came back: the task, its revision and its authority are
 * read above it, so it can never present a revision the surface did not show, and a status it displays is the
 * one the surface read rather than one an outcome implies.
 */
export default function TaskActions({ taskId, title, status, revision, scope, actions, presentation, onEdit, onOutcome, onCheckResult, headingLevel, className }: TaskActionsProps): ReactElement {
  const instanceId = useId();
  const noteId = `${instanceId}-note`;
  const groupRef = useRef<HTMLFieldSetElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState<TaskAttempt | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  // The receipt belongs to the intent on screen and to nothing else: a different action, or the same one against a
  // revision the surface has since advanced past, starts its own attempt instead of showing another attempt's record.
  const current = attempt !== null && reviewedIntent === intentKeyOf(attempt.input) ? outcome : null;
  const settled = current !== null && (current.outcome === "accepted" || current.outcome === "alreadyAccepted" || current.outcome === "unchanged");
  const titleText = titleTextOf(title, taskId);
  const receiptHeadingLevel = headingLevel ?? (presentation === "row" ? 4 : 3);
  const busyText = pending && attempt !== null ? `${ACTION_LABELS[attempt.action]}${WORKING_SUFFIX}` : "";
  const facts = ACTION_ORDER.map((name) => ({ name, fact: factOf(actions, name) }));
  const unavailable = facts.filter((entry) => !entry.fact.available);
  const reasonIdOf = (name: TaskActionName): string => `${instanceId}-${name}-reason`;
  useEffect(() => {
    // The receipt is the record of the action just taken, so it takes the keyboard position that action left behind.
    if (current === null || current.outcome === "invalid") return;
    resultRef.current?.focus();
  }, [current]);
  const run = useCallback(
    (action: TaskTransitionName): void => {
      // The revision is the one this surface displayed. Substituting a fresh one would turn a genuine conflict
      // — two tabs against one task — into an overwrite, and a stale action into an accepted write.
      const input: Omit<MutationInput<TaskTransitionPayload>, "operationId"> = { scope, expectedRevision: revision, payload: payloadFor(action, taskId) };
      setAttempt({ action, input });
      void submit(input).then((result) => {
        onOutcome?.(result);
      });
    },
    [onOutcome, revision, scope, submit, taskId],
  );
  const startAction = useCallback(
    (action: TaskActionName): void => {
      switch (action) {
        case "editTask":
          // The composer is the host's surface: this file opens it and implements no form of its own.
          onEdit();
          return;
        case "cancelTask":
          // Cancelling is consequential and is not undone from here, so it passes one confirmation before it runs.
          setConfirmOpen(true);
          return;
        case "completeTask":
        case "reopenTask":
          run(action);
          return;
      }
    },
    [onEdit, run],
  );
  const confirmCancel = useCallback((): void => {
    setConfirmOpen(false);
    run("cancelTask");
  }, [run]);
  const changeConfirmOpen = useCallback((open: boolean): void => {
    setConfirmOpen(open);
    if (!open) {
      // Escape, Keep the task and the backdrop all close the confirmation, and the keyboard position comes back to
      // the group that asked: the control that opened it may be a menu item inside a popup that has since closed.
      groupRef.current?.focus();
    }
  }, []);
  const dismiss = useCallback((): void => {
    reset();
    setAttempt(null);
    groupRef.current?.focus();
  }, [reset]);
  const replaySameWork = useCallback((): void => {
    // A retry sends the same operation, so the service answers with its original result instead of repeating the effect.
    void retry().then((result) => {
      if (result !== null) onOutcome?.(result);
    });
  }, [onOutcome, retry]);
  const applyAgain = useCallback((): void => {
    void reapply().then((result) => {
      if (result !== null) onOutcome?.(result);
    });
  }, [onOutcome, reapply]);
  const bodyControls = facts.map(({ name, fact }) => (
    <Button
      key={name}
      type="button"
      variant={name === "cancelTask" ? "destructive" : name === "completeTask" ? "default" : "outline"}
      size="sm"
      disabled={!fact.available || pending}
      aria-busy={pending && attempt?.action === name ? true : undefined}
      aria-describedby={fact.available ? undefined : reasonIdOf(name)}
      onClick={() => {
        startAction(name);
      }}
      className={CONTROL_CLASS}
    >
      {ACTION_LABELS[name]}
      <span className="sr-only">
        {" for "}
        <bdi>{titleText}</bdi>
      </span>
    </Button>
  ));
  const receipt =
    current === null ? null : (
      <div
        ref={resultRef}
        tabIndex={-1}
        data-slot="task-action-result"
        data-outcome={current.outcome}
        className={classes("flex min-w-0 flex-col gap-2", presentation === "row" ? "w-64 max-w-full text-start whitespace-normal" : undefined)}
      >
        <OperationResult
          outcome={current}
          headingLevel={receiptHeadingLevel}
          onCheckResult={current.outcome === "unknown" ? onCheckResult : undefined}
          onRetrySameWork={mayReplay(current) ? replaySameWork : undefined}
          onReapply={current.outcome === "conflict" ? applyAgain : undefined}
          fieldLabels={FIELD_LABELS}
        />
        {settled ? (
          <Button type="button" variant="outline" size="sm" onClick={dismiss} className={CONTROL_CLASS}>
            {DISMISS_LABEL}
          </Button>
        ) : null}
      </div>
    );
  const rowControls = (
    <>
      {/* The sentence is stated once for the row: visually, inside the menu beside the actions, and as the
          trigger's description, so the keyboard user hears it before choosing an action. */}
      <span id={noteId} className="sr-only">
        {COMPLETION_MEANS_NOTHING_NOTE}
      </span>
      {settled ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="ghost" size="icon-sm" />}
            aria-label={`${TRIGGER_TITLE} for ${titleText}`}
            aria-describedby={noteId}
            disabled={pending}
            aria-busy={pending ? true : undefined}
          >
            <EllipsisIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
            {facts.map(({ name, fact }) => (
              <Fragment key={name}>
                {name === "cancelTask" ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  disabled={!fact.available || pending}
                  onClick={() => {
                    startAction(name);
                  }}
                  className="items-start py-2 whitespace-normal"
                >
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
      )}
    </>
  );
  return (
    <fieldset
      ref={groupRef}
      // A fieldset is the semantic grouping for a set of related controls, and its legend names the group the way
      // the label alone could not. The class resets what a fieldset would otherwise add: no border, no padding and
      // no min-content width, so the group still wraps inside a phone-width row and inside a table cell.
      aria-busy={pending ? true : undefined}
      tabIndex={-1}
      data-slot="task-actions"
      data-presentation={presentation}
      data-task-id={taskId}
      data-status={status}
      data-operation-id={operationId ?? undefined}
      className={classes("flex min-w-0 flex-col gap-2 border-0 p-0", presentation === "row" ? "items-end" : undefined, className)}
    >
      <legend className="sr-only">{GROUP_LABEL_TEMPLATE.replace("{title}", titleText)}</legend>
      {presentation === "body" ? (
        <>
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{STATUS_LABEL}</span>
            <StatusBadge label={TASK_STATUS_LABELS[status]} tone={TASK_STATUS_TONES[status]} srPrefix={STATUS_SR_PREFIX} />
          </p>
          {settled ? (
            <p className="text-sm text-pretty text-muted-foreground">{SETTLED_SENTENCE}</p>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-2">{bodyControls}</div>
          )}
          {/* The sentence stays beside the actions before and after a result: it is what the record body says about
              the meaning of completing work, and an accepted receipt must not be the only place it was stated. */}
          <p id={noteId} className="text-xs text-pretty text-muted-foreground">
            {COMPLETION_MEANS_NOTHING_NOTE}
          </p>
          {settled || unavailable.length === 0 ? null : (
            <ul className="flex min-w-0 flex-col gap-1">
              {unavailable.map(({ name, fact }) => (
                <li key={name} id={reasonIdOf(name)} className="text-xs text-pretty text-muted-foreground">
                  {`${ACTION_LABELS[name]}: ${reasonOf(fact)}`}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        rowControls
      )}
      {/* The busy condition is announced once, and the receipt below announces the result that replaces it. */}
      <output aria-live="polite" aria-atomic="true" className="sr-only">
        {busyText}
      </output>
      {receipt}
      <AlertDialog open={confirmOpen} onOpenChange={changeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CANCEL_DIALOG_TITLE}</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-2">
              <span className="font-medium text-foreground">
                <bdi>{titleText}</bdi>
              </span>
              <span>{CANCEL_DIALOG_SENTENCE}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{CANCEL_KEEP_LABEL}</AlertDialogCancel>
            <AlertDialogAction confirmVariant="destructive" disabled={pending} onClick={confirmCancel}>
              {pending ? `${CANCEL_CONFIRM_LABEL}${WORKING_SUFFIX}` : CANCEL_CONFIRM_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fieldset>
  );
}

