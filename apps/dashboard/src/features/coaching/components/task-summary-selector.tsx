"use client";

/**
 * The one surface that shares a selected task summary with a coach: the worker chooses a task, writes
 * a reviewed description of at most `TASK_SUMMARY_MAX_CODE_POINTS` Unicode code points, sees the live
 * civil due date and live status a coach will read beside it, and confirms once through the shared
 * review step, which answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`,
 * `invalid`, `unavailable` or `unknown`.
 *
 * What leaves this surface is exactly the reviewed description plus the task's live due date and live
 * status. No field here carries the task's own title, notes, donor, amounts, attachments, source
 * reference, links or history, and a task's raw title is never rendered into anything this component
 * submits. A repeating task's successor occurrence is shared only after a fresh selection in this
 * session, so nothing is inherited from the occurrence shared before it. Stopping a share is a
 * different action on a different surface, and it leaves the task itself untouched.
 */
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import { Temporal } from "temporal-polyfill";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { FormField } from "@/components/form-field";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { TASK_SUMMARY_MAX_CODE_POINTS, reviewTaskSummary, selectSuccessorForSharing, type TaskShare, type TaskShareRefusalReason, type TaskShareSummaryState, type TaskStatus } from "@/modules/coaching/taskshare";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { serialiseCivilDate, type CivilDate, type DatePrecision } from "@/modules/time/civil";
import { COACHING_COPY, LIMIT_COPY, MODULE_COPY, TASK_SHARE_STATE_COPY } from "../copy";
import { useShareTaskSummary } from "../hooks/use-coaching-mutations";
import { taskSharePayloadSchema, type TaskSharePayload } from "../schemas/taskshare";

// ---------------------------------------------------------------------------------------------
// The words this surface says, once
// ---------------------------------------------------------------------------------------------

const HEADING = "Share a task summary";
const SURFACE_PURPOSE = COACHING_COPY.sharing.purpose;

/**
 * What a coach can read, in the wording the coaching copy module already owns for the module this
 * surface feeds. A second sentence here would be a second description of the same module.
 */
const COACH_SEES = MODULE_COPY["task-summaries"].description;

const SELECT_LABEL = "Task to share";
const SELECT_HINT = "Choose one task. Its due date and status travel with the summary and stay live; the wording is yours.";
const SELECT_PLACEHOLDER = "Choose a task";
const DESCRIPTION_LABEL = "Reviewed description — a coach will read exactly this";
const DESCRIPTION_HINT = "Write what you want your coach to understand about this piece of work. The task's own title, notes and history stay with you.";
const DESCRIPTION_EMPTY_PREVIEW = "Nothing written yet. A coach reads nothing until you write a description and share it.";
const PREVIEW_LABEL = "What your coach will read";
const PREVIEW_DUE_TERM = "Due date";
const PREVIEW_STATUS_TERM = "Status";
const PREVIEW_DESCRIPTION_TERM = "Description";
const PREVIEW_LIVE_NOTE = "The due date and the status come from the task and stay live. Neither is editable here, and neither is a promise that the work was done.";
const NO_DUE_DATE = "No due date";
const DATE_NOT_KNOWN = "Date not known";
const DUE_APPROXIMATE_PREFIX = "About ";
const COUNTER_NOUN = "code points";
const COUNTER_PREFIX = "Written:";
const SHARED_COUNT_NOUN = "summary shared with your coach";
const SHARED_COUNT_NOUN_PLURAL = "summaries shared with your coach";
const SUCCESSOR_HEADING = "This is a new occurrence of a repeating task";
const SUCCESSOR_BODY = "Nothing carries over from the occurrence you shared before: a summary of this occurrence is shared only when you select it here.";
const SUCCESSOR_CONFIRMED = "You selected this occurrence in this session. It is the one this description will be shared for.";
const SUCCESSOR_CONFIRM_LABEL = "Select this occurrence";
const DISMISSED_HEADING = "This summary cannot be shared yet";
const REVIEW_HEADING = "Share this summary with your coach";
const REVIEW_CONFIRM_LABEL = "Share this summary";
const REVIEW_CONSEQUENCE = "Sharing writes this summary once. It sends no notice, records no interaction, creates no task and proves nothing about contact or payment.";
const EMPTY_HEADING = "No task to share yet";
const EMPTY_BODY = "A summary is shared from a task you already have. Add the work you want your coach to see, then come back and review a description of it.";
const EMPTY_ACTION_LABEL = "Go to Work";
const EMPTY_ACTION_HREF = "/work";
const OCCURRENCE_MISSING_HEADING = "This occurrence cannot be shared yet";
const OCCURRENCE_MISSING_BODY = "The list did not say which occurrence of this repeating task this is, so nothing can be shared from it. Reload the list and choose the occurrence again.";
const FINGERPRINT_MISSING_HEADING = "This task cannot be shared yet";
const FINGERPRINT_MISSING_BODY = "The list did not carry the fingerprint of this task's reviewed meaning, so a description could not be tied to what was reviewed. Reload the list and choose the task again.";
const RELOAD_LABEL = "Reload the list";
const FIELD_LABELS: Readonly<Record<string, string>> = { taskId: SELECT_LABEL, safeDescription: "Reviewed description", occurrenceId: "Occurrence", reviewedFingerprint: "Reviewed meaning" };
const DEFAULT_HEADING_LEVEL: ReviewHeadingLevel = 2;
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const ROOT_CLASS = "flex min-w-0 flex-col gap-4";
const CARD_CONTENT_CLASS = "flex min-w-0 flex-col gap-5";
const PANEL_CLASS = "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const FACTS_CLASS = "flex min-w-0 flex-col gap-1.5 text-sm";
const FACT_ROW_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2";
const FACT_TERM_CLASS = "text-muted-foreground";
const AUTHORED_TEXT_CLASS = "min-w-0 break-words text-pretty whitespace-pre-wrap";
const SELECT_CLASS = "w-full max-w-full";
const CONTROL_CLASS = "min-h-target";

/** The four statuses a task can hold, in this surface's own words. The work feature's list is not importable across features, so the words are stated here rather than shared. */
const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, StatusBadgeSpec>> = { open: { label: "Open", tone: "info" }, completed: { label: "Completed", tone: "positive" }, reopened: { label: "Reopened", tone: "caution" }, cancelled: { label: "Cancelled", tone: "muted" } };

/**
 * The refusal sentences, keyed by the domain's closed reason union, so a reason added to
 * `TaskShareRefusalReason` fails to compile here until it is worded. `description-too-long` is absent
 * on purpose: its sentence is the one limit copy that carries the measured count and the limit, and it
 * is read from `LIMIT_COPY` rather than restated.
 */
const REFUSAL_COPY: Readonly<Record<Exclude<TaskShareRefusalReason, "description-too-long">, string>> = {
  "description-empty": "A shared summary states what you want your coach to read, so write the description before you share it.",
  "not-reviewed": "This summary has no reviewed description attached, so nothing is shared until it is reviewed again.",
  "successor-needs-fresh-selection": "This is a new occurrence of a repeating task, and nothing carries over from the occurrence you shared before. Select this occurrence to share a summary of it.",
  "stale-revision": "The summary moved since this list was read, so nothing was shared. Reload the list and review the description again.",
  "not-shared": "This summary is no longer shared, so there is nothing here to extend.",
  "occurrence-already-shared": "This task already has a summary shared with your coach, so the same occurrence is not shared twice.",
  unavailable: "The task behind this summary cannot be read right now, so nothing was shared. Try again in a moment.",
};

// ---------------------------------------------------------------------------------------------
// What the surface is handed
// ---------------------------------------------------------------------------------------------

/** One task the worker may share a summary of, as the envelope supplied it. */
export type TaskSummaryCandidate = {
  /** The task this summary is of. */
  readonly taskId: string;
  /** The worker's own neutral label for choosing among tasks. It is not the task's title and never leaves this surface. */
  readonly safeLabel: string;
  /** The civil due date, or `null` when the task carries none. A calendar day is never turned into an instant here. */
  readonly dueOn: CivilDate | null;
  readonly duePrecision: DatePrecision;
  readonly status: TaskStatus;
  /** Whether this is a new occurrence of a repeating task, which requires a fresh selection in this session. */
  readonly isRecurringSuccessor: boolean;
  /**
   * The occurrence this description would be shared for, where the task repeats. The service shares a
   * repeating task's occurrence only when the payload names it.
   */
  readonly occurrenceId?: string;
  /**
   * The opaque fingerprint of the task's reviewed meaning, supplied by the envelope. The payload schema
   * requires it, and this surface cannot derive it: the fingerprint covers the task's own title and
   * notes, which are exactly the values a coach never receives.
   */
  readonly reviewedFingerprint?: string;
  /** The occurrence shared before this one, where the list carried it, so the domain decides a successor share rather than this surface guessing. */
  readonly predecessorShare?: TaskShare;
};

/** One summary that already exists for a task, so an already-shared occurrence cannot be selected again. */
export type TaskSummaryExistingShare = {
  readonly taskId: string;
  /** The read's own four states: a `shared` or `needs-review` summary blocks a second share of the same occurrence. */
  readonly state: TaskShareSummaryState;
  readonly reviewedDescription: string | null;
};

export type TaskSummarySelectorProps = {
  /** The tasks the worker may share a summary of, already scoped and already projected by the envelope. */
  readonly candidates: ReadonlyArray<TaskSummaryCandidate>;
  /** The summaries that already exist, so the surface shows which tasks are already shared and refuses a duplicate selection. */
  readonly existing: ReadonlyArray<TaskSummaryExistingShare>;
  /** The context the command is submitted in. The service re-resolves it, so this is a claim the caller makes and not an authority it grants. */
  readonly scope: Scope;
  /** The revision the caller read. A summary that moved settles as a conflict rather than overwriting. */
  readonly expectedRevision: string;
  /** The locale the worker writes in, set on the authored text only, never on the surrounding interface copy. */
  readonly locale: string;
  /**
   * The task this surface opens on, where it is reached from that task's own screen. Nothing about the
   * opening selection is inherited: a repeating task's occurrence still has to be selected here, and a
   * description still has to be written.
   */
  readonly initialTaskId?: string;
  /** The scenario instant the list was read at (the envelope's `asOf`), stamped on the local review. Nothing reads a wall clock: the only now in this application is the scenario clock the read answered with. */
  readonly asOf?: string;
  /** Reads the result of an operation whose acknowledgement was lost. Recovery is by operation identity, so this re-reads rather than re-sending. */
  readonly onCheckResult?: () => void;
  /** Re-reads the candidates and the summaries, for a task the list could not describe completely. */
  readonly onReload?: () => void | Promise<void>;
  /** The heading level of this surface, so it nests under whatever heading the page around it reaches. */
  readonly headingLevel?: ReviewHeadingLevel;
  /** The reading direction of the page, set on this block only. The review step inherits it, including its portalled dialog. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};

/** A refusal as this surface displays it: the domain's own reason, with the measured count where the reason is the limit. */
type DisplayedRefusal = { readonly reason: "description-too-long"; readonly codePoints: number } | { readonly reason: Exclude<TaskShareRefusalReason, "description-too-long"> };

/** What one review decided: nothing chosen yet, a task that cannot be shared, a refusal, or the exact payload the review step may submit. */
type ShareDecision =
  | { readonly kind: "choose" }
  | { readonly kind: "cannot"; readonly heading: string; readonly description: string; readonly reloadable: boolean }
  | { readonly kind: "refused"; readonly message: string; readonly about: "description" | "selection" }
  | { readonly kind: "ready"; readonly payload: TaskSharePayload };

/** The sentence for a refusal the domain or the payload schema produced. */
function describeRefusal(refusal: DisplayedRefusal): string {
  switch (refusal.reason) {
    case "description-too-long":
      // The one sentence that carries the measured count and the limit, so the worker is told exactly how far over they are and that nothing was dropped.
      return LIMIT_COPY.taskDescriptionExceeded(refusal.codePoints);
    default:
      return REFUSAL_COPY[refusal.reason];
  }
}

/** The state that blocks a second share of the same occurrence, or `undefined` when the task is shareable. */
function blockingStateOf(shares: ReadonlyArray<TaskSummaryExistingShare>, taskId: string): "shared" | "needs-review" | undefined {
  const state = shares.find((share) => share.taskId === taskId)?.state;
  return state === "shared" || state === "needs-review" ? state : undefined;
}

/** The civil due date as the worker reads it: the stored day, the honest word for an approximate day, and the precision word when the day is not known. */
function dueTextOf(candidate: TaskSummaryCandidate): string {
  const date = candidate.dueOn;
  if (date === null) return NO_DUE_DATE;
  switch (candidate.duePrecision) {
    case "date":
      return serialiseCivilDate(date);
    case "approximate":
      return `${DUE_APPROXIMATE_PREFIX}${serialiseCivilDate(date)}`;
    case "unknown":
      return DATE_NOT_KNOWN;
  }
}

/** The scenario instant the read answered with, or `undefined` when it was not supplied or cannot be read. No wall clock stands in for it. */
function reviewInstantOf(asOf: string | undefined): Temporal.Instant | undefined {
  if (asOf === undefined || asOf.trim() === "") return undefined;
  try {
    return Temporal.Instant.from(asOf);
  } catch {
    return undefined;
  }
}

/** The first message the payload schema produced, preferring the description's own message so a limit refusal reads as one. */
function firstSchemaMessage(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string {
  const aboutDescription = issues.find((issue) => issue.path.includes("safeDescription"));
  const chosen = aboutDescription ?? issues[0];
  return chosen === undefined ? REFUSAL_COPY["not-reviewed"] : chosen.message;
}

/** Whether a schema issue is about the description rather than about the task or its reviewed meaning. */
function schemaIssueIsAboutDescription(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }>): boolean {
  return issues.some((issue) => issue.path.includes("safeDescription"));
}

type DecisionInput = {
  readonly selected: TaskSummaryCandidate | undefined;
  readonly shares: ReadonlyArray<TaskSummaryExistingShare>;
  readonly description: string;
  /** The occurrence the worker selected in this session, where the chosen task repeats. An inherited value is never passed here. */
  readonly selectedOccurrenceId: string | undefined;
  readonly reviewInstant: Temporal.Instant | undefined;
};

/**
 * Decides whether the chosen task and the written description may be reviewed for sharing, and hands
 * back the exact payload the review step submits. Every rule that can be the domain's is the domain's:
 * the description's emptiness and its length come from `reviewTaskSummary`, a successor occurrence's
 * admission comes from `selectSuccessorForSharing`, and the payload itself must satisfy
 * `taskSharePayloadSchema` before it is offered. This function only chooses which of them to ask.
 */
function decideShare({ selected, shares, description, selectedOccurrenceId, reviewInstant }: DecisionInput): ShareDecision {
  if (selected === undefined) return { kind: "choose" };
  const blocking = blockingStateOf(shares, selected.taskId);
  if (blocking !== undefined) {
    // The same occurrence is never shared twice: a summary that is current stays current, and one whose reviewed meaning changed is held until it is reviewed again.
    return { kind: "refused", message: blocking === "shared" ? REFUSAL_COPY["occurrence-already-shared"] : TASK_SHARE_STATE_COPY["needs-review"].description, about: "selection" };
  }
  const occurrenceId = selected.occurrenceId;
  if (selected.isRecurringSuccessor && occurrenceId === undefined) {
    return { kind: "cannot", heading: OCCURRENCE_MISSING_HEADING, description: OCCURRENCE_MISSING_BODY, reloadable: true };
  }
  let reviewedFingerprint = selected.reviewedFingerprint;
  if (selected.isRecurringSuccessor) {
    if (occurrenceId === undefined || selectedOccurrenceId !== occurrenceId) {
      // A fresh selection is the one thing this surface can prove on its own: nothing carries over from the occurrence shared before it.
      return { kind: "refused", message: describeRefusal({ reason: "successor-needs-fresh-selection" }), about: "selection" };
    }
    const predecessor = selected.predecessorShare;
    if (predecessor !== undefined) {
      // Where the earlier occurrence's share was supplied, the domain decides whether this occurrence may be covered, and its fingerprint is the reviewed meaning that carries over.
      const admitted = selectSuccessorForSharing({ share: predecessor, occurrenceId, selectedOccurrenceId, expectedRevision: predecessor.revision });
      if (!admitted.ok) return { kind: "refused", message: describeRefusal(admitted.error), about: "selection" };
      reviewedFingerprint = reviewedFingerprint ?? admitted.value.reviewedFingerprint;
    }
  }
  if (reviewedFingerprint === undefined || reviewedFingerprint.trim() === "") {
    return { kind: "cannot", heading: FINGERPRINT_MISSING_HEADING, description: FINGERPRINT_MISSING_BODY, reloadable: true };
  }
  if (reviewInstant !== undefined) {
    const reviewed = reviewTaskSummary(description, reviewInstant);
    if (!reviewed.ok) return { kind: "refused", message: describeRefusal(reviewed.error), about: "description" };
  }
  const payload: TaskSharePayload = { taskId: selected.taskId, reviewedFingerprint, safeDescription: description, ...(occurrenceId === undefined ? {} : { occurrenceId }) };
  const parsed = taskSharePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const aboutDescription = schemaIssueIsAboutDescription(parsed.error.issues);
    return { kind: "refused", message: firstSchemaMessage(parsed.error.issues), about: aboutDescription ? "description" : "selection" };
  }
  return { kind: "ready", payload: parsed.data };
}

// ---------------------------------------------------------------------------------------------
// The smaller surfaces this one is made of
// ---------------------------------------------------------------------------------------------

/** The state a summary already holds for a task, or `undefined` when the task has no summary yet. */
function shareStateOf(shares: ReadonlyArray<TaskSummaryExistingShare>, taskId: string): TaskShareSummaryState | undefined {
  return shares.find((share) => share.taskId === taskId)?.state;
}

/**
 * One entry in the select: the worker's own label for the task, the date it is due and the status it
 * holds, so the choice is made on what the summary will say and not on the task's raw title. An entry
 * whose summary is already current, or is held until it is reviewed again, says so and cannot be
 * chosen: the same occurrence is never shared twice.
 */
function optionLabelOf(candidate: TaskSummaryCandidate, state: TaskShareSummaryState | undefined): string {
  const standing = `${candidate.safeLabel} — ${dueTextOf(candidate)} — ${TASK_STATUS_LABEL[candidate.status].label}`;
  return state === "shared" || state === "needs-review" ? `${standing} — ${TASK_SHARE_STATE_COPY[state].label}` : standing;
}

/** The ids a control is described by, with this surface's own live counter appended to whatever the field already names. */
function describedByWith(base: string | undefined, extra: string): string {
  return base === undefined || base.trim() === "" ? extra : `${base} ${extra}`;
}

type CoachPreviewProps = { readonly candidate: TaskSummaryCandidate; readonly description: string; readonly locale: string; readonly labelId: string };

/**
 * What a coach will read, beside the field it comes from: the live due date, the live status and the
 * description as it is being written. The due date and the status are read from the task and are not
 * editable here, and the note under them says so, because a worker who could edit them would be
 * reading a summary of a task that does not exist.
 */
function CoachPreview({ candidate, description, locale, labelId }: CoachPreviewProps): ReactElement {
  const status = TASK_STATUS_LABEL[candidate.status];
  const written = description.trim();
  return (
    <div data-slot="task-summary-preview" className={PANEL_CLASS}>
      <p id={labelId} className="text-sm font-medium">
        {PREVIEW_LABEL}
      </p>
      <dl aria-labelledby={labelId} className={FACTS_CLASS}>
        <div className={FACT_ROW_CLASS}>
          <dt className={FACT_TERM_CLASS}>{PREVIEW_DUE_TERM}</dt>
          <dd className="min-w-0">
            <bdi className="mono-identifier wrap-anywhere">{dueTextOf(candidate)}</bdi>
          </dd>
        </div>
        <div className={FACT_ROW_CLASS}>
          <dt className={FACT_TERM_CLASS}>{PREVIEW_STATUS_TERM}</dt>
          <dd>
            <StatusBadge label={status.label} tone={status.tone} srPrefix={PREVIEW_STATUS_TERM} />
          </dd>
        </div>
        <div className={FACT_ROW_CLASS}>
          <dt className={FACT_TERM_CLASS}>{PREVIEW_DESCRIPTION_TERM}</dt>
          <dd className="min-w-0">
            {written === "" ? (
              <span className={SENTENCE_CLASS}>{DESCRIPTION_EMPTY_PREVIEW}</span>
            ) : (
              <bdi lang={locale} className={AUTHORED_TEXT_CLASS}>
                {description}
              </bdi>
            )}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-pretty text-muted-foreground wrap-anywhere">{PREVIEW_LIVE_NOTE}</p>
    </div>
  );
}

type SuccessorSelectionProps = {
  readonly candidate: TaskSummaryCandidate;
  /** The occurrence this session selected, which is `undefined` until the worker selects one. */
  readonly selectedOccurrenceId: string | undefined;
  readonly onSelectOccurrence: () => void;
};

/**
 * A repeating task's next occurrence, which is shared only after a fresh selection in this session.
 * Nothing is inherited: the occurrence shared before this one carried a review of its own, and a
 * description written for it is not a description written for this one.
 */
function SuccessorSelection({ candidate, selectedOccurrenceId, onSelectOccurrence }: SuccessorSelectionProps): ReactElement {
  const selected = candidate.occurrenceId !== undefined && selectedOccurrenceId === candidate.occurrenceId;
  return (
    <Alert data-slot="task-summary-successor">
      <AlertTitle>{SUCCESSOR_HEADING}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2">
        <p className="text-pretty wrap-anywhere">{SUCCESSOR_BODY}</p>
        {selected ? (
          <p className="text-pretty wrap-anywhere">{SUCCESSOR_CONFIRMED}</p>
        ) : (
          // A button, not a switch and not a drag: the selection is one deliberate action, reachable by a single pointer and by the keyboard, and it states what it selects.
          <Button type="button" variant="outline" size="sm" className={cn(CONTROL_CLASS, "max-w-full whitespace-normal")} onClick={onSelectOccurrence}>
            {SUCCESSOR_CONFIRM_LABEL}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** The payload one attempt carries, without the identity the review step mints for it. */
type AttemptInput = Omit<MutationInput<TaskSharePayload>, "operationId">;

/**
 * Shares one selected task summary under a reviewed description of at most
 * `TASK_SUMMARY_MAX_CODE_POINTS` code points — never the task's own title, notes, donor, amounts,
 * attachments, source reference, links or history — with the task's live due date and status beside
 * it, and only after a fresh selection for a repeating task's successor occurrence; answers
 * `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`.
 */
export function TaskSummarySelector({ candidates, existing, scope, expectedRevision, locale, initialTaskId, asOf, onCheckResult, onReload, headingLevel = DEFAULT_HEADING_LEVEL, dir, className }: TaskSummarySelectorProps): ReactElement {
  const { mutateAsync } = useShareTaskSummary();
  const headingId = useId();
  const counterId = useId();
  const previewLabelId = useId();
  const [selectedTaskId, setSelectedTaskId] = useState(initialTaskId ?? "");
  const [description, setDescription] = useState("");
  // The occurrence this session selected, and the task it belongs to: a selection made for one task never authorises a share of another.
  const [selectedOccurrence, setSelectedOccurrence] = useState<{ readonly taskId: string; readonly occurrenceId: string } | null>(null);
  const [submitted, setSubmitted] = useState<AttemptInput | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const Heading = HEADING_TAG[headingLevel];
  const noticeHeading = headingLevel === 2 ? 3 : 4;
  const selected = candidates.find((candidate) => candidate.taskId === selectedTaskId);
  const sharedCount = existing.filter((share) => share.state === "shared").length;
  // Counted as Unicode code points, because that is what the limit and the domain's own count are stated in: an emoji or a Devanagari syllable is one code point and two UTF-16 units, so a `.length` here would refuse text the rule admits.
  const codePoints = Array.from(description).length;
  const reviewInstant = useMemo(() => reviewInstantOf(asOf), [asOf]);
  const selectedOccurrenceId = selected !== undefined && selectedOccurrence !== null && selectedOccurrence.taskId === selected.taskId ? selectedOccurrence.occurrenceId : undefined;
  const decision = useMemo<ShareDecision>(() => decideShare({ selected, shares: existing, description, selectedOccurrenceId, reviewInstant }), [selected, existing, description, selectedOccurrenceId, reviewInstant]);
  const liveInput = useMemo<AttemptInput | null>(() => (decision.kind === "ready" ? { scope, expectedRevision, payload: decision.payload } : null), [decision, scope, expectedRevision]);
  // An accepted share advances the collection's revision and the list beside this surface re-reads, which
  // would otherwise read as a different intention and take the receipt away. Holding the intent that was
  // submitted keeps the receipt where it is until the worker changes what it would apply.
  const receiptHolds = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  const input = receiptHolds && submitted !== null ? submitted : liveInput;
  const clearReceipt = useCallback((): void => {
    setSubmitted(null);
    setSettled(null);
  }, []);
  // The identity of the attempt is the review step's to mint: it mints one per intent and reuses it for a
  // retry of the same work, which is what lets a replay answer `alreadyAccepted` instead of sharing twice.
  const submit = useCallback<MutationSubmit<TaskSharePayload>>(
    async (attempt: MutationInput<TaskSharePayload>): Promise<MutationOutcome> => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return mutateAsync(attempt);
    },
    [mutateAsync],
  );
  const chooseTask = useCallback(
    (taskId: string): void => {
      setSelectedTaskId(taskId);
      // A description written for one task is never carried to another: it described that piece of work, and reusing it would put the wrong words in front of a coach.
      setDescription("");
      setSelectedOccurrence(null);
      clearReceipt();
    },
    [clearReceipt],
  );
  const writeDescription = useCallback(
    (value: string): void => {
      // The text is kept exactly as typed and never shortened: a refusal states the measured count and asks for a shorter description.
      setDescription(value);
      clearReceipt();
    },
    [clearReceipt],
  );
  const confirmOccurrence = useCallback((): void => {
    if (selected === undefined || selected.occurrenceId === undefined) return;
    setSelectedOccurrence({ taskId: selected.taskId, occurrenceId: selected.occurrenceId });
    clearReceipt();
  }, [selected, clearReceipt]);
  const descriptionError = decision.kind === "refused" && decision.about === "description" && description.trim() !== "" ? decision.message : undefined;
  const selectionRefusal = decision.kind === "refused" && decision.about === "selection" ? decision.message : undefined;
  const cannot = decision.kind === "cannot" ? decision : null;
  const statusSpec = selected === undefined ? undefined : TASK_STATUS_LABEL[selected.status];
  const selectedDueText = selected === undefined ? NO_DUE_DATE : dueTextOf(selected);
  return (
    <section aria-labelledby={headingId} dir={dir} data-slot="task-summary-selector" data-decision={decision.kind} className={cn(ROOT_CLASS, className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <Heading id={headingId}>{HEADING}</Heading>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{SURFACE_PURPOSE}</CardDescription>
        </CardHeader>
        <CardContent className={CARD_CONTENT_CLASS}>
          {/*
            The limitation is stated before any control is reached, so a worker knows what a coach will
            read before choosing a task rather than after sharing one. The wording is the coaching copy
            module's own description of the module this surface feeds.
          */}
          <p className={SENTENCE_CLASS}>
            <bdi>{COACH_SEES}</bdi>
          </p>
          {sharedCount === 0 ? null : (
            <p className={SENTENCE_CLASS}>
              <bdi className="tabular-figures">{String(sharedCount)}</bdi> {sharedCount === 1 ? SHARED_COUNT_NOUN : SHARED_COUNT_NOUN_PLURAL}.
            </p>
          )}
          <Separator />
          {candidates.length === 0 ? (
            <StateNotice kind="empty" title={EMPTY_HEADING} description={EMPTY_BODY} action={{ label: EMPTY_ACTION_LABEL, href: EMPTY_ACTION_HREF }} headingLevel={noticeHeading} />
          ) : (
            <>
              <FormField label={SELECT_LABEL} name="task-summary-task" description={SELECT_HINT} required>
                {(field) => (
                  <NativeSelect id={field.id} className={SELECT_CLASS} value={selectedTaskId} onChange={(event) => chooseTask(event.target.value)} aria-describedby={field.describedBy} aria-invalid={field.invalid} aria-required={field.required}>
                    <NativeSelectOption value="">{SELECT_PLACEHOLDER}</NativeSelectOption>
                    {candidates.map((candidate) => {
                      const state = shareStateOf(existing, candidate.taskId);
                      const blocked = state === "shared" || state === "needs-review";
                      return (
                        <NativeSelectOption key={candidate.taskId} value={candidate.taskId} disabled={blocked}>
                          {optionLabelOf(candidate, state)}
                        </NativeSelectOption>
                      );
                    })}
                  </NativeSelect>
                )}
              </FormField>
              {selected === undefined || statusSpec === undefined ? null : (
                <>
                  <CoachPreview candidate={selected} description={description} locale={locale} labelId={previewLabelId} />
                  <FormField label={DESCRIPTION_LABEL} name="task-summary-description" description={DESCRIPTION_HINT} error={descriptionError} required>
                    {(field) => (
                      <>
                        <Textarea
                          id={field.id}
                          rows={5}
                          className={cn("min-h-24", AUTHORED_TEXT_CLASS)}
                          // The authored text carries the worker's own language, so a screen reader pronounces it in that language even though the interface around it is in another.
                          lang={locale}
                          value={description}
                          onChange={(event) => writeDescription(event.target.value)}
                          aria-describedby={describedByWith(field.describedBy, counterId)}
                          aria-invalid={field.invalid}
                          aria-required={field.required}
                        />
                        {/* A limit counter, not a counter of what was kept: nothing is ever dropped, so the number is where the description stands against the limit and not a budget it is being cut down to. */}
                        <p id={counterId} aria-live="polite" className="text-xs text-muted-foreground tabular-figures">
                          {`${COUNTER_PREFIX} ${String(codePoints)} / ${String(TASK_SUMMARY_MAX_CODE_POINTS)} ${COUNTER_NOUN}`}
                        </p>
                      </>
                    )}
                  </FormField>
                  {selected.isRecurringSuccessor ? <SuccessorSelection candidate={selected} selectedOccurrenceId={selectedOccurrenceId} onSelectOccurrence={confirmOccurrence} /> : null}
                  {cannot === null ? null : <StateNotice kind="unavailable" title={cannot.heading} description={cannot.description} headingLevel={noticeHeading} retry={cannot.reloadable && onReload !== undefined ? { label: RELOAD_LABEL, onClick: onReload } : undefined} />}
                  {selectionRefusal === undefined ? null : (
                    // The alert's own role announces the refusal when it appears, so a change in what is shareable is never silent.
                    <Alert variant="destructive">
                      <AlertTitle>{DISMISSED_HEADING}</AlertTitle>
                      <AlertDescription className="text-pretty wrap-anywhere">{selectionRefusal}</AlertDescription>
                    </Alert>
                  )}
                  {input === null ? null : (
                    <ActionReview<TaskSharePayload>
                      title={REVIEW_HEADING}
                      description={
                        <div className="flex min-w-0 flex-col gap-2">
                          <bdi lang={locale} className={cn("block rounded-lg border border-border p-2", AUTHORED_TEXT_CLASS)}>
                            {description}
                          </bdi>
                          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className={FACT_TERM_CLASS}>{PREVIEW_DUE_TERM}</span>
                            <bdi className="mono-identifier wrap-anywhere">{selectedDueText}</bdi>
                          </p>
                          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className={FACT_TERM_CLASS}>{PREVIEW_STATUS_TERM}</span>
                            {statusSpec === undefined ? null : <StatusBadge label={statusSpec.label} tone={statusSpec.tone} srPrefix={PREVIEW_STATUS_TERM} />}
                          </p>
                        </div>
                      }
                      consequence={REVIEW_CONSEQUENCE}
                      confirmLabel={REVIEW_CONFIRM_LABEL}
                      input={input}
                      submit={submit}
                      onSettled={setSettled}
                      checkResult={onCheckResult}
                      fieldLabels={FIELD_LABELS}
                      headingLevel={headingLevel}
                    />
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export default TaskSummarySelector;
