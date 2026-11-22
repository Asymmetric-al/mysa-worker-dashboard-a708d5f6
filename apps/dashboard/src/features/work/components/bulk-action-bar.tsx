"use client";
/**
 * The bar that carries the three bulk task actions over the rows a worker has explicitly selected.
 *
 * Three intents and no fourth: apply or remove one private tag, create ordinary follow-up tasks, or mark
 * independently completable tasks complete. Each intent passes the one review step, which owns the
 * attempt identity, and every answer is read per row. A selection is never an audience, a consent or a
 * campaign, and a mixed answer is never summarised as one "done".
 */
import type { UseMutationResult } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import ActionReview, { mayReplay, type ActionReviewSelection, type MutationSubmit } from "@/components/action-review";
import { OperationResult, OUTCOME_HEADINGS, PerItemResults } from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { MutationInput, Scope, TaskRecordStatus } from "@/modules/data-service/envelope";
import { ROOT_FIELD_KEY, type MutationOutcome, type PerItemResult } from "@/modules/data-service/outcome";
import {
  BULK_INTENT_DESCRIPTIONS,
  BULK_INTENT_LABELS,
  BULK_INTENTS,
  BULK_ITEM_RESULT_LABELS,
  BULK_ITEM_RESULT_STATES,
  BULK_MIXED_RESULT_NOTE,
  BULK_REPLAY_NOTE,
  BULK_RESULT_HEADING,
  BULK_REVIEW_CANCEL_LABEL,
  BULK_REVIEW_CONFIRM_LABEL,
  BULK_REVIEW_HEADING,
  BULK_SELECTION_COUNT_TEMPLATE,
  BULK_SELECTION_SCOPE_NOTE,
  BULK_SESSION_ROW_EXCLUSION_REASON,
  BULK_TAG_DIRECTION_LABELS,
  BULK_TAG_DIRECTIONS,
  BULK_UNCHANGED_BATCH_NOTE,
  BULK_UNCHANGED_ROW_REASONS,
  BULK_UNNAMED_ROW_REASON,
  type BulkIntent,
  type BulkOperation,
  type BulkTagDirection,
} from "../copy/bulk-actions";
import { useBulkTaskMutations, type BulkIntent as BulkMutationIntent } from "../hooks/use-bulk-task-mutations";
import { PRIVATE_TAG_MAX_LENGTH, bulkApplyTagSchema, bulkCompleteTasksSchema, bulkCreateTasksSchema, bulkRemoveTagSchema, type BulkApplyTagPayload, type BulkCompleteTasksPayload, type BulkCreateTasksPayload, type BulkItemResultState, type BulkRemoveTagPayload, type FollowUpTaskTemplate } from "../schemas/bulk";

/** One selected row as the list projection states it: the identifier a request names, the status the row holds, and whether this session may change it. */
export type BulkSelectionRow = {
  readonly taskId: string;
  readonly status: TaskRecordStatus;
  readonly selectable: boolean;
  /** The reason the read gave when the row may not be changed, stated as the service worded it so an ineligible row is explained rather than silently skipped. */
  readonly selectionReason?: string;
};

export type BulkActionBarProps = {
  /** The scope the selection was read in. It is passed through untouched: the bar never derives a scope of its own. */
  readonly scope: Scope;
  /** The revision of the list the selection was made against, which every submission presents so a stale change is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** The rows the worker explicitly selected. A filter, a saved view or a query object is never accepted in their place. */
  readonly selectedTasks: readonly BulkSelectionRow[];
  /** Performs the host's clear, after the bar has asked for it or the worker has chosen it. */
  readonly onClearSelection: () => void;
  /** Re-reads the list, so an `unknown` outcome offers "check the result" without starting a second attempt. */
  readonly onCheckResult?: () => void;
  readonly className?: string;
};

/** The bar's own wording, and the controls whose words the copy module does not carry. Every intent, result and rule sentence comes from `../copy/bulk-actions`. */
const BAR_TITLE = "Bulk actions";
const CLEAR_SELECTION_LABEL = "Clear selection";
const CLOSE_PANEL_LABEL = "Close";
const DISMISS_RESULT_LABEL = "Dismiss the result";
const ROW_NOUN = { one: "row", many: "rows" } as const;
const SECTION_CLASS = "flex min-w-0 flex-col gap-3";
const PANEL_CLASS = "flex min-w-0 flex-col gap-3";
const FIELD_STACK_CLASS = "flex min-w-0 flex-col gap-3";
const NOTE_CLASS = "text-sm text-pretty text-muted-foreground";
const CONTROL_CLASS = "h-auto min-h-9 max-w-full py-2 whitespace-normal text-pretty";
const SMALL_CONTROL_CLASS = "h-auto min-h-8 max-w-full py-1.5 whitespace-normal text-pretty";
const TAG_FIELD_LABEL = "Private tag";
const TAG_FIELD_DESCRIPTION = `Only you see this tag. Up to ${String(PRIVATE_TAG_MAX_LENGTH)} characters.`;
const FOLLOW_UP_TITLE_LABEL = "Title";
const FOLLOW_UP_CATEGORY_LABEL = "Category";
const FOLLOW_UP_DUE_LABEL = "Due date";
const FOLLOW_UP_NOTE_LABEL = "Note";
const FOLLOW_UP_TEMPLATE_NOTE = "Each selected row gets one ordinary follow-up task with these fields; no message is sent and no meeting time is set here.";
const NO_TAG_REASON = "None of the selected rows can be changed from this session, so there is no private tag to apply or remove here.";
const NO_FOLLOW_UP_REASON = "None of the selected rows can be changed from this session, so no follow-up task is created from them.";
const NO_COMPLETE_REASON = "No selected row is open or reopened, so none of them can be completed on its own here.";
const CLOSED_ROW_REASON = "A task is completed only while it is open or reopened, so a row that is already completed or cancelled is left as it is.";
const REVIEW_PENDING_NOTE = "The review step appears here once these fields are valid, so nothing can be submitted that the action would refuse.";
/** The one status set a task is completed from, matching the rule the service applies when it reports a row as eligible. */
const COMPLETABLE_STATUSES: readonly TaskRecordStatus[] = ["open", "reopened"];
const REVIEW_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { taskIds: "Selected rows", tag: TAG_FIELD_LABEL, template: "Follow-up task", "template.title": FOLLOW_UP_TITLE_LABEL, "template.category": FOLLOW_UP_CATEGORY_LABEL, "template.dueOn": FOLLOW_UP_DUE_LABEL, "template.note": FOLLOW_UP_NOTE_LABEL };

/** One preparation of an intent, as the copy module's tag direction selects one of the two tag mutations. */
type PreparedBulk =
  | { readonly operation: "bulkApplyTag"; readonly payload: BulkApplyTagPayload }
  | { readonly operation: "bulkRemoveTag"; readonly payload: BulkRemoveTagPayload }
  | { readonly operation: "bulkCreateTasks"; readonly payload: BulkCreateTasksPayload }
  | { readonly operation: "bulkCompleteTasks"; readonly payload: BulkCompleteTasksPayload };

type Preparation = { readonly kind: "ready"; readonly prepared: PreparedBulk } | { readonly kind: "refused"; readonly error: ZodError };

/** What the review step is shown: the intent as prepared now, and the revision the panel opened against. */
type ReviewTarget = { readonly prepared: PreparedBulk; readonly revision: string };

type DraftTextField = "tag" | "followUpTitle" | "followUpCategory" | "followUpDueOn" | "followUpNote";

interface BulkDraft {
  readonly direction: BulkTagDirection;
  readonly tag: string;
  readonly followUpTitle: string;
  readonly followUpCategory: string;
  readonly followUpDueOn: string;
  readonly followUpNote: string;
}

const EMPTY_DRAFT: BulkDraft = { direction: "apply", tag: "", followUpTitle: "", followUpCategory: "", followUpDueOn: "", followUpNote: "" };

/** A blank optional field is an absent field, so the schema judges the change rather than a lone empty string. */
function optionalText(value: string): string | undefined {
  return value.trim() === "" ? undefined : value;
}

/**
 * Validates one intent against its own schema and hands back the payload that schema parsed, so the review
 * step only ever sees input the service would also admit. The tag direction selects which of the two tag
 * mutations the payload belongs to; no other intent has a branch here, because a fourth intent does not exist.
 */
function prepareBulk(intent: BulkIntent, draft: BulkDraft, taskIds: readonly string[]): Preparation {
  switch (intent) {
    case "private-tag": {
      if (draft.direction === "apply") {
        const checked = bulkApplyTagSchema.safeParse({ taskIds, tag: draft.tag });
        return checked.success ? { kind: "ready", prepared: { operation: "bulkApplyTag", payload: checked.data } } : { kind: "refused", error: checked.error };
      }
      const checked = bulkRemoveTagSchema.safeParse({ taskIds, tag: draft.tag });
      return checked.success ? { kind: "ready", prepared: { operation: "bulkRemoveTag", payload: checked.data } } : { kind: "refused", error: checked.error };
    }
    case "create-follow-up-tasks": {
      const checked = bulkCreateTasksSchema.safeParse({ taskIds, template: { title: draft.followUpTitle, category: optionalText(draft.followUpCategory), dueOn: optionalText(draft.followUpDueOn), note: optionalText(draft.followUpNote) } });
      return checked.success ? { kind: "ready", prepared: { operation: "bulkCreateTasks", payload: checked.data } } : { kind: "refused", error: checked.error };
    }
    case "complete-independent-tasks": {
      const checked = bulkCompleteTasksSchema.safeParse({ taskIds });
      return checked.success ? { kind: "ready", prepared: { operation: "bulkCompleteTasks", payload: checked.data } } : { kind: "refused", error: checked.error };
    }
    default: {
      const unhandled: never = intent;
      throw new Error(`Unhandled bulk intent: ${String(unhandled)}`);
    }
  }
}

/** The schema's own messages, keyed by the field path the review step reports, so each field states its own rule and nothing is paraphrased here. */
function messagesByField(error: ZodError): ReadonlyMap<string, readonly string[]> {
  const messages = new Map<string, string[]>();
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map((segment) => String(segment)).join(".");
    const existing = messages.get(key);
    if (existing === undefined) {
      messages.set(key, [issue.message]);
    } else if (!existing.includes(issue.message)) {
      existing.push(issue.message);
    }
  }
  return messages;
}

/** Whether one field of the failed payload renders its own message below the control it belongs to. */
function fieldIsRendered(key: string): boolean {
  switch (key) {
    case "tag":
    case "template.title":
    case "template.category":
    case "template.dueOn":
    case "template.note":
      return true;
    default:
      return false;
  }
}

const isKnownResultState = (state: string): state is BulkItemResultState => BULK_ITEM_RESULT_STATES.some((known) => known === state);

/**
 * Whether a row keeps its selection once the action has settled. A row the service left as it was is one the
 * worker may want to act on again, and an answer this release does not name is treated the same way, so no
 * unfamiliar result is quietly dropped from the selection.
 */
function rowKeepsSelection(state: string): boolean {
  if (!isKnownResultState(state)) {
    return true;
  }
  switch (state) {
    case "accepted":
    case "unchanged":
      return false;
    case "excluded":
    case "failed":
      return true;
  }
}

/** The per-item answers a settled outcome carries, which are absent for any outcome that reported no effect. */
function itemsOf(outcome: MutationOutcome): readonly PerItemResult[] {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? (outcome.items ?? []) : [];
}

/** The reason codes this surface states for a row it answers on its own authority rather than from a service answer. */
const SURFACE_REASON_CODES = { excludedBeforeSubmit: "excluded-before-submit", batchUnchanged: "batch-unchanged", unnamed: "result-not-stated" } as const;

/**
 * Why this surface left one selected row out before submitting. The read's own words are used wherever it gave
 * a reason; otherwise the two eligibility rules this bar already applies decide the sentence: a row it may not
 * change is left out by the session, and a selectable row is left out only by the completion intent, which acts
 * on open and reopened rows alone.
 */
function surfaceExclusionReason(row: BulkSelectionRow): string {
  const stated = row.selectionReason?.trim();
  if (stated !== undefined && stated !== "") {
    return stated;
  }
  return row.selectable ? CLOSED_ROW_REASON : BULK_SESSION_ROW_EXCLUSION_REASON;
}

/** One selected row this surface withheld from the submission, reported in the vocabulary the service answers in. */
function excludedRowOf(row: BulkSelectionRow): PerItemResult {
  return { targetId: row.taskId, state: "excluded", reasonCode: SURFACE_REASON_CODES.excludedBeforeSubmit, reason: surfaceExclusionReason(row) };
}

/** One submitted row the service answered only as part of a whole-batch `unchanged`, so the intent that was sent states its reason. */
function unchangedRowOf(taskId: string, operation: BulkOperation): PerItemResult {
  return { targetId: taskId, state: "unchanged", reasonCode: SURFACE_REASON_CODES.batchUnchanged, reason: BULK_UNCHANGED_ROW_REASONS[operation] };
}

/**
 * The rows a settled receipt states: one row per selected task, built from what the service answered and what
 * this surface decided before submitting. The service names a result for every row it was sent, and a row this
 * bar withheld never reached it, so that row's state and reason are this surface's own. A whole-batch
 * `unchanged` answer carries no rows at all, so every submitted row is stated in that state under the reason its
 * intent supports; the rows the service answered come first, in the order they were submitted, and the rows this
 * surface left out follow. An outcome that reported no effect states no rows.
 */
function receiptRowsOf(outcome: MutationOutcome, operation: BulkOperation, submittedIds: readonly string[], selected: readonly BulkSelectionRow[]): readonly PerItemResult[] {
  const submitted = new Set(submittedIds);
  const rows: PerItemResult[] = [];
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") {
    const answered = new Map(itemsOf(outcome).map((item) => [item.targetId, item]));
    for (const taskId of submittedIds) {
      // A submitted row the answer never named states no outcome of its own: it is reported as failed with the
      // reason that says so, rather than dropped from a receipt that claims to hold one row for every row sent.
      rows.push(answered.get(taskId) ?? { targetId: taskId, state: "failed", reasonCode: SURFACE_REASON_CODES.unnamed, reason: BULK_UNNAMED_ROW_REASON });
    }
  } else if (outcome.outcome === "unchanged") {
    for (const taskId of submittedIds) {
      rows.push(unchangedRowOf(taskId, operation));
    }
  } else {
    return [];
  }
  for (const row of selected) {
    if (!submitted.has(row.taskId)) {
      rows.push(excludedRowOf(row));
    }
  }
  return rows;
}

/**
 * The outcome the receipt shows, carrying the rows this surface states. The service's own list stands for the
 * submitted rows alone, so it is replaced by the same answers plus the rows the service never saw: one row per
 * selected task. An outcome that reported no effect keeps its own shape and gains no rows.
 */
function withReceiptRows(outcome: MutationOutcome, rows: readonly PerItemResult[]): MutationOutcome {
  if (rows.length === 0) {
    return outcome;
  }
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
      return { ...outcome, items: rows };
    default:
      return outcome;
  }
}

/**
 * Turns one of the four browser transports into the submit function the review step calls: the operation id,
 * scope and revision reach the transport exactly as the review stated them, and the rows this surface states for
 * the answer are handed back at the moment the answer arrives, so the receipt keeps stating them after the lists
 * behind it re-read.
 */
function submitFor<P extends { readonly taskIds: readonly string[] }>(transport: UseMutationResult<MutationOutcome, Error, BulkMutationIntent<P>>, operation: BulkOperation, selected: readonly BulkSelectionRow[], hold: (rows: readonly PerItemResult[]) => void): MutationSubmit<P> {
  return async (input: MutationInput<P>): Promise<MutationOutcome> => {
    const outcome = await transport.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
    const rows = receiptRowsOf(outcome, operation, input.payload.taskIds, selected);
    hold(rows);
    return withReceiptRows(outcome, rows);
  };
}

const retainedSelectionNote = (count: number): string => `${String(count)} ${count === 1 ? ROW_NOUN.one : ROW_NOUN.many} kept the selection because the result was ${BULK_ITEM_RESULT_LABELS.excluded} or ${BULK_ITEM_RESULT_LABELS.failed}.`;

/** The sentence that explains why an intent cannot act on the current selection. */
function closedIntentReason(intent: BulkIntent): string {
  switch (intent) {
    case "private-tag":
      return NO_TAG_REASON;
    case "create-follow-up-tasks":
      return NO_FOLLOW_UP_REASON;
    case "complete-independent-tasks":
      return NO_COMPLETE_REASON;
  }
}

/** The distinct reasons the read gave for the rows this session may not change, so an ineligible row is explained in the service's own words. */
function distinctReasons(rows: readonly BulkSelectionRow[]): readonly string[] {
  const reasons = new Set<string>();
  for (const row of rows) {
    const reason = row.selectionReason?.trim();
    if (reason !== undefined && reason !== "") {
      reasons.add(reason);
    }
  }
  return [...reasons];
}

interface FieldInputProps {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly error?: string;
  readonly value: string;
  readonly type?: "text" | "date";
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
}

/** One labelled field with its own description and its own message, so the schema's wording reaches the control it belongs to. */
function FieldInput({ id, label, description, error, value, type = "text", onChange, onBlur }: FieldInputProps): ReactElement {
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = [description === undefined ? null : descriptionId, error === undefined ? null : errorId].filter((entry): entry is string => entry !== null).join(" ");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {description === undefined ? null : (
        <p id={descriptionId} className={NOTE_CLASS}>
          {description}
        </p>
      )}
      <Input
        id={id}
        type={type}
        value={value}
        className="max-w-full"
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={error === undefined ? undefined : true}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={onBlur}
      />
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-pretty text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The facts of one bulk action, laid out as sentences rather than as a summary of totals: no total is counted here. */
function ReviewFacts({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="flex min-w-0 flex-col gap-2">{children}</div>;
}

/** The one tag a tag action applies or removes, isolated so a right-to-left or mixed-direction label keeps its own order. */
function TagFacts({ direction, tag }: { readonly direction: BulkTagDirection; readonly tag: string }): ReactElement {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="font-medium">{BULK_TAG_DIRECTION_LABELS[direction]}</span>
      <bdi className="min-w-0 wrap-anywhere">{tag}</bdi>
    </p>
  );
}

/** The follow-up task that will be created once per selected row, stated field by field. */
function FollowUpFacts({ template }: { readonly template: FollowUpTaskTemplate }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="font-medium">{FOLLOW_UP_TITLE_LABEL}</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi>{template.title}</bdi>
        </dd>
      </div>
      {template.category === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="font-medium">{FOLLOW_UP_CATEGORY_LABEL}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi>{template.category}</bdi>
          </dd>
        </div>
      )}
      {template.dueOn === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="font-medium">{FOLLOW_UP_DUE_LABEL}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi>
              <time dateTime={template.dueOn}>{template.dueOn}</time>
            </bdi>
          </dd>
        </div>
      )}
      {template.note === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="font-medium">{FOLLOW_UP_NOTE_LABEL}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi>{template.note}</bdi>
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * A replay answers with the stored per-item results, which the receipt states as its stored value rather than as
 * rows, and a batch that changed nothing carries no rows at all; both are stated here from the rows this surface
 * holds, so a lost acknowledgement is answered with exactly what the first submission produced and a batch that
 * left every row alone still names each row it was sent.
 */
function SettledRows({ outcome, rows }: { readonly outcome: MutationOutcome | null; readonly rows: readonly PerItemResult[] }): ReactElement | null {
  if (outcome === null || rows.length === 0) {
    return null;
  }
  if (outcome.outcome !== "alreadyAccepted" && outcome.outcome !== "unchanged") {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className={NOTE_CLASS}>{outcome.outcome === "alreadyAccepted" ? BULK_REPLAY_NOTE : BULK_UNCHANGED_BATCH_NOTE}</p>
      <PerItemResults items={rows} heading={BULK_RESULT_HEADING} />
    </div>
  );
}

/**
 * The bar that carries the three bulk task actions over the rows a worker has explicitly selected, and the record
 * of what each action did to each of them.
 */
export default function BulkActionBar({ scope, expectedRevision, selectedTasks, onClearSelection, onCheckResult, className }: BulkActionBarProps): ReactElement | null {
  const transports = useBulkTaskMutations(scope);
  const regionTitleId = useId();
  const panelTitleId = useId();
  const reasonIdPrefix = useId();
  const fieldIdPrefix = useId();
  const [intent, setIntent] = useState<BulkIntent | null>(null);
  const [draft, setDraft] = useState<BulkDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(expectedRevision);
  const [settledOutcome, setSettledOutcome] = useState<MutationOutcome | null>(null);
  const [settledRows, setSettledRows] = useState<readonly PerItemResult[]>([]);
  const pending = transports.bulkApplyTag.isPending || transports.bulkRemoveTag.isPending || transports.bulkCreateTasks.isPending || transports.bulkCompleteTasks.isPending;
  const selectableIds = useMemo(() => selectedTasks.filter((row) => row.selectable).map((row) => row.taskId), [selectedTasks]);
  const completableIds = useMemo(() => selectedTasks.filter((row) => row.selectable && COMPLETABLE_STATUSES.includes(row.status)).map((row) => row.taskId), [selectedTasks]);
  const eligibleIds = useMemo<Readonly<Record<BulkIntent, readonly string[]>>>(() => ({ "private-tag": selectableIds, "create-follow-up-tasks": selectableIds, "complete-independent-tasks": completableIds }), [selectableIds, completableIds]);
  const sessionReasons = useMemo(() => distinctReasons(selectedTasks.filter((row) => !row.selectable)), [selectedTasks]);
  const closedButSelectable = useMemo(() => selectedTasks.some((row) => row.selectable && !COMPLETABLE_STATUSES.includes(row.status)), [selectedTasks]);
  const unavailableReasons = useMemo<Readonly<Record<BulkIntent, readonly string[]>>>(() => ({ "private-tag": sessionReasons, "create-follow-up-tasks": sessionReasons, "complete-independent-tasks": closedButSelectable ? [...sessionReasons, CLOSED_ROW_REASON] : sessionReasons }), [sessionReasons, closedButSelectable]);
  const rowsSelected = selectedTasks.length > 0;
  const panelOpen = intent !== null && rowsSelected;
  const livePreparation = intent === null ? null : prepareBulk(intent, draft, eligibleIds[intent]);
  const liveTarget: ReviewTarget | null = livePreparation?.kind === "ready" ? { prepared: livePreparation.prepared, revision: reviewRevision } : null;
  // The review step is only shown for input its own schema admits; an outcome that has already settled keeps its
  // receipt, which is once again the only place that receipt is read once the review step is not shown.
  const reviewTarget = panelOpen ? liveTarget : null;
  const receiptRef = useRef<HTMLDivElement | null>(null);
  // A settled result read outside the review step takes the keyboard position the review step held, so a receipt is
  // never left behind the focus once the rows it describes are no longer selected.
  useEffect(() => {
    if (settledOutcome !== null && !panelOpen) {
      receiptRef.current?.focus();
    }
  }, [settledOutcome, panelOpen]);
  const settledItems = settledOutcome === null ? [] : itemsOf(settledOutcome);
  const retainedCount = settledItems.filter((item) => rowKeepsSelection(item.state)).length;
  const eligibleCount = intent === null ? 0 : eligibleIds[intent].length;
  const excludedCount = intent === null ? 0 : selectedTasks.length - eligibleCount;
  const selection: ActionReviewSelection = { count: eligibleCount, noun: eligibleCount === 1 ? ROW_NOUN.one : ROW_NOUN.many, excluded: excludedCount };
  const refusedFields = touched && livePreparation?.kind === "refused" ? messagesByField(livePreparation.error) : null;
  const fieldError = (key: string): string | undefined => refusedFields?.get(key)?.join(" ");
  // A message the schema raised against no field this panel renders is still stated, so no refusal is ever dropped.
  const unplacedMessages = refusedFields === null ? [] : [...refusedFields].flatMap(([key, messages]) => (fieldIsRendered(key) ? [] : messages));
  // A result that still offers recovery keeps its panel open, so leaving it is never the only way past a receipt.
  const recoveryHeld = settledOutcome !== null && (mayReplay(settledOutcome) || settledOutcome.outcome === "conflict");
  const panelTitle = intent === null ? "" : intent === "private-tag" ? BULK_TAG_DIRECTION_LABELS[draft.direction] : BULK_INTENT_LABELS[intent];
  const updateDraft = (field: DraftTextField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const markTouched = (): void => {
    setTouched(true);
  };
  const openIntent = (next: BulkIntent, direction: BulkTagDirection): void => {
    setIntent(next);
    setDraft((current) => ({ ...current, direction }));
    setTouched(false);
    setSettledOutcome(null);
    setSettledRows([]);
    setReviewRevision(expectedRevision);
  };
  const closePanel = (): void => {
    setIntent(null);
    setTouched(false);
    // The draft is emptied, so re-opening an intent is a deliberate new attempt rather than a silent repeat of the last one.
    setDraft((current) => ({ ...EMPTY_DRAFT, direction: current.direction }));
    // The selection is released when the worker leaves this attempt, never the moment a change is accepted:
    // the host renders this bar only while rows are selected, so releasing them on acceptance unmounts the
    // receipt that is the only record of what the action did to each row. Dismissing the result, cancelling
    // and closing the panel are the three ways to leave, and each of them releases these rows.
    onClearSelection();
  };
  const dismissResult = (): void => {
    setSettledOutcome(null);
    setSettledRows([]);
    closePanel();
  };
  const handleSettled = (outcome: MutationOutcome): void => {
    // The receipt outlives the selection it describes: a row the action changed keeps its row in the result
    // until the worker dismisses it, and a row left as it was or excluded stays selected so it can be acted
    // on again. `closePanel` releases the selection once the record has been read.
    setSettledOutcome(outcome);
  };
  const perRowNotes = (
    <>
      <p>{BULK_SELECTION_SCOPE_NOTE}</p>
      <p>{BULK_MIXED_RESULT_NOTE}</p>
    </>
  );
  const reviewOf = (target: ReviewTarget): ReactElement => {
    const common = { title: BULK_REVIEW_HEADING, confirmLabel: BULK_REVIEW_CONFIRM_LABEL, cancelLabel: BULK_REVIEW_CANCEL_LABEL, onCancel: closePanel, selection, headingLevel: 3 as const, onSettled: handleSettled, checkResult: onCheckResult, fieldLabels: REVIEW_FIELD_LABELS };
    switch (target.prepared.operation) {
      case "bulkApplyTag":
        return (
          <ActionReview<BulkApplyTagPayload>
            key="bulkApplyTag"
            {...common}
            description={
              <ReviewFacts>
                <p>{BULK_INTENT_DESCRIPTIONS["private-tag"]}</p>
                <TagFacts direction="apply" tag={target.prepared.payload.tag} />
                {perRowNotes}
              </ReviewFacts>
            }
            input={{ scope, expectedRevision: target.revision, payload: target.prepared.payload }}
            submit={submitFor(transports.bulkApplyTag, "bulkApplyTag", selectedTasks, setSettledRows)}
          />
        );
      case "bulkRemoveTag":
        return (
          <ActionReview<BulkRemoveTagPayload>
            key="bulkRemoveTag"
            {...common}
            description={
              <ReviewFacts>
                <p>{BULK_INTENT_DESCRIPTIONS["private-tag"]}</p>
                <TagFacts direction="remove" tag={target.prepared.payload.tag} />
                {perRowNotes}
              </ReviewFacts>
            }
            input={{ scope, expectedRevision: target.revision, payload: target.prepared.payload }}
            submit={submitFor(transports.bulkRemoveTag, "bulkRemoveTag", selectedTasks, setSettledRows)}
          />
        );
      case "bulkCreateTasks":
        return (
          <ActionReview<BulkCreateTasksPayload>
            key="bulkCreateTasks"
            {...common}
            description={
              <ReviewFacts>
                <p>{BULK_INTENT_DESCRIPTIONS["create-follow-up-tasks"]}</p>
                <FollowUpFacts template={target.prepared.payload.template} />
                {perRowNotes}
              </ReviewFacts>
            }
            input={{ scope, expectedRevision: target.revision, payload: target.prepared.payload }}
            submit={submitFor(transports.bulkCreateTasks, "bulkCreateTasks", selectedTasks, setSettledRows)}
          />
        );
      case "bulkCompleteTasks":
        return (
          <ActionReview<BulkCompleteTasksPayload>
            key="bulkCompleteTasks"
            {...common}
            description={
              <ReviewFacts>
                <p>{BULK_INTENT_DESCRIPTIONS["complete-independent-tasks"]}</p>
                {perRowNotes}
              </ReviewFacts>
            }
            input={{ scope, expectedRevision: target.revision, payload: target.prepared.payload }}
            submit={submitFor(transports.bulkCompleteTasks, "bulkCompleteTasks", selectedTasks, setSettledRows)}
          />
        );
    }
  };
  const intentControls = BULK_INTENTS.map((entry) => {
    const closed = eligibleIds[entry].length === 0;
    const describedBy = closed ? `${reasonIdPrefix}-${entry}` : undefined;
    if (entry === "private-tag") {
      return (
        <DropdownMenu key={entry}>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" disabled={closed || pending} aria-describedby={describedBy} className={CONTROL_CLASS} />}>{BULK_INTENT_LABELS[entry]}</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 max-w-full">
            {BULK_TAG_DIRECTIONS.map((direction) => (
              <DropdownMenuItem
                key={direction}
                className="py-2 text-pretty"
                onClick={() => {
                  openIntent(entry, direction);
                }}
              >
                {BULK_TAG_DIRECTION_LABELS[direction]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    return (
      <Button
        key={entry}
        type="button"
        variant="outline"
        disabled={closed || pending}
        aria-describedby={describedBy}
        className={CONTROL_CLASS}
        onClick={() => {
          openIntent(entry, draft.direction);
        }}
      >
        {BULK_INTENT_LABELS[entry]}
      </Button>
    );
  });
  const closedReasons = BULK_INTENTS.filter((entry) => eligibleIds[entry].length === 0).map((entry) => (
    <div key={entry} id={`${reasonIdPrefix}-${entry}`} className="flex min-w-0 flex-col gap-1">
      <p className="text-sm text-pretty">
        <span className="font-medium">{BULK_INTENT_LABELS[entry]}</span>
        {` — ${closedIntentReason(entry)}`}
      </p>
      {unavailableReasons[entry].map((reason) => (
        <p key={reason} className={NOTE_CLASS}>
          {reason}
        </p>
      ))}
    </div>
  ));
  if (!rowsSelected && settledOutcome === null) {
    return null;
  }
  return (
    <section data-slot="bulk-action-bar" aria-busy={pending ? true : undefined} aria-labelledby={rowsSelected ? regionTitleId : undefined} className={className === undefined ? SECTION_CLASS : `${SECTION_CLASS} ${className}`}>
      {rowsSelected ? (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <h2 id={regionTitleId} className="text-sm font-medium">
                {BAR_TITLE}
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            <p aria-live="polite" className="text-sm text-pretty">
              {BULK_SELECTION_COUNT_TEMPLATE.replace("{count}", String(selectedTasks.length))}
            </p>
            <p className={NOTE_CLASS}>{BULK_SELECTION_SCOPE_NOTE}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {intentControls}
              <Button type="button" variant="ghost" size="sm" className={SMALL_CONTROL_CLASS} disabled={pending} onClick={onClearSelection}>
                {CLEAR_SELECTION_LABEL}
              </Button>
            </div>
            {closedReasons}
            {retainedCount === 0 ? null : <p className={NOTE_CLASS}>{retainedSelectionNote(retainedCount)}</p>}
          </CardContent>
        </Card>
      ) : null}
      {panelOpen && intent !== null ? (
        <section aria-labelledby={panelTitleId} className={PANEL_CLASS}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h3 id={panelTitleId} className="min-w-0 text-sm font-medium">
              {panelTitle}
            </h3>
            {recoveryHeld ? null : (
              <Button type="button" variant="ghost" size="sm" className={SMALL_CONTROL_CLASS} disabled={pending} onClick={closePanel}>
                {CLOSE_PANEL_LABEL}
              </Button>
            )}
          </div>
          <p className={NOTE_CLASS}>{BULK_INTENT_DESCRIPTIONS[intent]}</p>
          {intent === "private-tag" ? (
            <div className={FIELD_STACK_CLASS}>
              <FieldInput
                id={`${fieldIdPrefix}-tag`}
                label={TAG_FIELD_LABEL}
                description={TAG_FIELD_DESCRIPTION}
                error={fieldError("tag")}
                value={draft.tag}
                onChange={(value) => {
                  updateDraft("tag", value);
                }}
                onBlur={markTouched}
              />
            </div>
          ) : null}
          {intent === "create-follow-up-tasks" ? (
            <div className={FIELD_STACK_CLASS}>
              <p className={NOTE_CLASS}>{FOLLOW_UP_TEMPLATE_NOTE}</p>
              <FieldInput
                id={`${fieldIdPrefix}-title`}
                label={FOLLOW_UP_TITLE_LABEL}
                error={fieldError("template.title")}
                value={draft.followUpTitle}
                onChange={(value) => {
                  updateDraft("followUpTitle", value);
                }}
                onBlur={markTouched}
              />
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <FieldInput
                  id={`${fieldIdPrefix}-category`}
                  label={FOLLOW_UP_CATEGORY_LABEL}
                  error={fieldError("template.category")}
                  value={draft.followUpCategory}
                  onChange={(value) => {
                    updateDraft("followUpCategory", value);
                  }}
                  onBlur={markTouched}
                />
                <FieldInput
                  id={`${fieldIdPrefix}-due`}
                  label={FOLLOW_UP_DUE_LABEL}
                  error={fieldError("template.dueOn")}
                  value={draft.followUpDueOn}
                  type="date"
                  onChange={(value) => {
                    updateDraft("followUpDueOn", value);
                  }}
                  onBlur={markTouched}
                />
              </div>
              <FieldInput
                id={`${fieldIdPrefix}-note`}
                label={FOLLOW_UP_NOTE_LABEL}
                error={fieldError("template.note")}
                value={draft.followUpNote}
                onChange={(value) => {
                  updateDraft("followUpNote", value);
                }}
                onBlur={markTouched}
              />
            </div>
          ) : null}
          {unplacedMessages.length === 0 ? null : (
            <Alert>
              <AlertTitle>{OUTCOME_HEADINGS.invalid}</AlertTitle>
              <AlertDescription>
                <ul className="flex min-w-0 flex-col gap-1">
                  {unplacedMessages.map((message) => (
                    <li key={message} className="min-w-0 wrap-anywhere">
                      {message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <Separator />
          {reviewTarget === null ? (
            <p className={NOTE_CLASS}>{REVIEW_PENDING_NOTE}</p>
          ) : (
            <>
              {reviewOf(reviewTarget)}
              <SettledRows outcome={settledOutcome} rows={settledRows} />
            </>
          )}
        </section>
      ) : null}
      {settledOutcome !== null && (reviewTarget === null || !panelOpen) ? (
        <div ref={receiptRef} tabIndex={-1} className="flex min-w-0 flex-col gap-3">
          <OperationResult outcome={settledOutcome} headingLevel={3} onCheckResult={settledOutcome.outcome === "unknown" ? onCheckResult : undefined} />
          <SettledRows outcome={settledOutcome} rows={settledRows} />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className={SMALL_CONTROL_CLASS} onClick={dismissResult}>
              {DISMISS_RESULT_LABEL}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
