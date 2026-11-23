"use client";
import type { UseMutationResult } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import ActionReview, { mayReplay, type ActionReviewSelection, type MutationSubmit } from "@/components/action-review";
import { FactList, type FactSpec } from "@/components/fact-list";
import { civilDateConvention, fieldMessagesOf } from "@/components/form-field";
import { OperationResult, OUTCOME_HEADINGS, PerItemResults } from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import SectionCard from "@/components/section-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { MutationInput, Scope, TaskRecordStatus } from "@/modules/data-service/envelope";
import type { MutationOutcome, PerItemResult } from "@/modules/data-service/outcome";
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
  BULK_UNCHANGED_BATCH_NOTE,
  BULK_UNCHANGED_ROW_REASONS,
  BULK_UNNAMED_ROW_REASON,
  type BulkOperation,
  BULK_TAG_DIRECTION_LABELS,
  BULK_TAG_DIRECTIONS,
  type BulkIntent,
  type BulkTagDirection,
} from "../copy/bulk-actions";
import { useBulkTaskMutations, type BulkIntent as BulkMutationIntent } from "../hooks/use-bulk-task-mutations";
import { PRIVATE_TAG_MAX_LENGTH, bulkApplyTagSchema, bulkCompleteTasksSchema, bulkCreateTasksSchema, bulkRemoveTagSchema, type BulkApplyTagPayload, type BulkCompleteTasksPayload, type BulkCreateTasksPayload, type BulkItemResultState, type BulkRemoveTagPayload, type FollowUpTaskTemplate } from "../schemas/bulk";
import { StatedInstant } from "./stated-instant";
export type BulkSelectionRow = { readonly taskId: string; readonly status: TaskRecordStatus; readonly selectable: boolean; readonly selectionReason?: string };
export type BulkActionBarProps = { readonly scope: Scope; readonly expectedRevision: string; readonly selectedTasks: readonly BulkSelectionRow[]; readonly onClearSelection: () => void; readonly onCheckResult?: () => void; readonly className?: string };
const ROW_NOUN = { one: "row", many: "rows" } as const;
const SECTION_CLASS = "flex min-w-0 flex-col gap-3";
const FIELD_STACK_CLASS = "flex min-w-0 flex-col gap-3";
const NOTE_CLASS = "type-supporting text-pretty";
const CONTROL_CLASS = `${BUTTON_WRAP_CLASS} text-pretty`;
const TAG_FIELD_LABEL = "Private tag";
const TAG_FIELD_DESCRIPTION = `Only you see this tag. Up to ${String(PRIVATE_TAG_MAX_LENGTH)} characters.`;
const FOLLOW_UP_LABELS = { title: "Title", category: "Category", dueOn: "Due date", note: "Note" } as const;
const CLOSED_INTENT_REASONS: Readonly<Record<BulkIntent, string>> = {
  "private-tag": "None of the selected rows can be changed from this session, so there is no private tag to apply or remove here.",
  "create-follow-up-tasks": "None of the selected rows can be changed from this session, so no follow-up task is created from them.",
  "complete-independent-tasks": "No selected row is open or reopened, so none of them can be completed on its own here.",
}; /** The one eligibility rule the completion intent applies, stated once because the bar refuses and reports the same sentence. */
const CLOSED_ROW_REASON = "A task is completed only while it is open or reopened, so a row that is already completed or cancelled is left as it is.";
const COMPLETABLE_STATUSES: readonly TaskRecordStatus[] = ["open", "reopened"];
const REVIEW_FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  taskIds: "Selected rows",
  tag: TAG_FIELD_LABEL,
  template: "Follow-up task",
  "template.title": FOLLOW_UP_LABELS.title,
  "template.category": FOLLOW_UP_LABELS.category,
  "template.dueOn": FOLLOW_UP_LABELS.dueOn,
  "template.note": FOLLOW_UP_LABELS.note,
};
const RENDERED_FIELDS: readonly string[] = ["tag", "template.title", "template.category", "template.dueOn", "template.note"];
const RETAINS_SELECTION: Readonly<Record<BulkItemResultState, boolean>> = { accepted: false, unchanged: false, excluded: true, failed: true };
type PreparedBulk =
  | { readonly operation: "bulkApplyTag"; readonly payload: BulkApplyTagPayload }
  | { readonly operation: "bulkRemoveTag"; readonly payload: BulkRemoveTagPayload }
  | { readonly operation: "bulkCreateTasks"; readonly payload: BulkCreateTasksPayload }
  | { readonly operation: "bulkCompleteTasks"; readonly payload: BulkCompleteTasksPayload };
type Preparation = { readonly kind: "ready"; readonly prepared: PreparedBulk } | { readonly kind: "refused"; readonly error: ZodError };
type ReviewTarget = { readonly prepared: PreparedBulk; readonly revision: string };
type DraftTextField = "tag" | "followUpTitle" | "followUpCategory" | "followUpDueOn" | "followUpNote";
type BulkDraft = { readonly direction: BulkTagDirection; readonly tag: string; readonly followUpTitle: string; readonly followUpCategory: string; readonly followUpDueOn: string; readonly followUpNote: string };
const EMPTY_DRAFT: BulkDraft = { direction: "apply", tag: "", followUpTitle: "", followUpCategory: "", followUpDueOn: "", followUpNote: "" };
const optionalText = (value: string): string | undefined => (value.trim() === "" ? undefined : value);
function prepareBulk(intent: BulkIntent, draft: BulkDraft, taskIds: readonly string[]): Preparation {
  switch (intent) {
    case "private-tag": {
      if (draft.direction === "apply") {
        const applied = bulkApplyTagSchema.safeParse({ taskIds, tag: draft.tag });
        return applied.success ? { kind: "ready", prepared: { operation: "bulkApplyTag", payload: applied.data } } : { kind: "refused", error: applied.error };
      }
      const removed = bulkRemoveTagSchema.safeParse({ taskIds, tag: draft.tag });
      return removed.success ? { kind: "ready", prepared: { operation: "bulkRemoveTag", payload: removed.data } } : { kind: "refused", error: removed.error };
    }
    case "create-follow-up-tasks": {
      const created = bulkCreateTasksSchema.safeParse({ taskIds, template: { title: draft.followUpTitle, category: optionalText(draft.followUpCategory), dueOn: optionalText(draft.followUpDueOn), note: optionalText(draft.followUpNote) } });
      return created.success ? { kind: "ready", prepared: { operation: "bulkCreateTasks", payload: created.data } } : { kind: "refused", error: created.error };
    }
    case "complete-independent-tasks": {
      const completed = bulkCompleteTasksSchema.safeParse({ taskIds });
      return completed.success ? { kind: "ready", prepared: { operation: "bulkCompleteTasks", payload: completed.data } } : { kind: "refused", error: completed.error };
    }
  }
}
const rowKeepsSelection = (state: string): boolean => {
  const known = BULK_ITEM_RESULT_STATES.find((candidate) => candidate === state);
  return known === undefined || RETAINS_SELECTION[known];
};
const itemsOf = (outcome: MutationOutcome): readonly PerItemResult[] => (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? (outcome.items ?? []) : []); /** The reason codes this surface states for a row it answers on its own authority rather than from a service answer. */
const SURFACE_REASON_CODES = { excludedBeforeSubmit: "excluded-before-submit", batchUnchanged: "batch-unchanged", unnamed: "result-not-stated" } as const;
/** Why this surface left one selected row out before submitting: the read's own words where it gave a reason, otherwise the two eligibility rules this bar already applies. */ function surfaceExclusionReason(row: BulkSelectionRow): string {
  const stated = row.selectionReason?.trim();
  if (stated !== undefined && stated !== "") return stated;
  return row.selectable ? CLOSED_ROW_REASON : BULK_SESSION_ROW_EXCLUSION_REASON;
}
/** One selected row this surface withheld from the submission, reported in the vocabulary the service answers in. */ const excludedRowOf = (row: BulkSelectionRow): PerItemResult => ({ targetId: row.taskId, state: "excluded", reasonCode: SURFACE_REASON_CODES.excludedBeforeSubmit, reason: surfaceExclusionReason(row) });
/** One submitted row the service answered only as part of a whole-batch `unchanged`, so the intent that was sent states its reason. */
const unchangedRowOf = (taskId: string, operation: BulkOperation): PerItemResult => ({ targetId: taskId, state: "unchanged", reasonCode: SURFACE_REASON_CODES.batchUnchanged, reason: BULK_UNCHANGED_ROW_REASONS[operation] });
/** One row per selected task: the service's answers for the rows it was sent, in submission order, then the rows this surface withheld; a whole-batch `unchanged` answer names every submitted row under the reason its intent supports, and an outcome that reported no effect states no rows. */
function receiptRowsOf(outcome: MutationOutcome, operation: BulkOperation, submittedIds: readonly string[], selected: readonly BulkSelectionRow[]): readonly PerItemResult[] {
  const rows: PerItemResult[] = [];
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") {
    const answered = new Map(itemsOf(outcome).map((item) => [item.targetId, item]));
    // A submitted row the answer never named is reported as failed with the reason that says so, rather than dropped from a receipt that claims one row for every row sent.
    for (const taskId of submittedIds) rows.push(answered.get(taskId) ?? { targetId: taskId, state: "failed", reasonCode: SURFACE_REASON_CODES.unnamed, reason: BULK_UNNAMED_ROW_REASON });
  } else if (outcome.outcome === "unchanged") {
    for (const taskId of submittedIds) rows.push(unchangedRowOf(taskId, operation));
  } else {
    return [];
  }
  const submitted = new Set(submittedIds);
  for (const row of selected) if (!submitted.has(row.taskId)) rows.push(excludedRowOf(row));
  return rows;
}
/** The outcome the receipt shows, carrying the rows this surface states in place of the service's submitted-rows-only list. */ function withReceiptRows(outcome: MutationOutcome, rows: readonly PerItemResult[]): MutationOutcome {
  return rows.length === 0 || (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") ? outcome : { ...outcome, items: rows };
}
/** Turns one of the four browser transports into the submit function the review step calls, holding the rows this surface states for the answer at the moment it arrives, so the receipt keeps stating them after the lists behind it re-read. */ const submitFor =
  <P extends { readonly taskIds: readonly string[] }>(transport: UseMutationResult<MutationOutcome, Error, BulkMutationIntent<P>>, operation: BulkOperation, selected: readonly BulkSelectionRow[], hold: (rows: readonly PerItemResult[]) => void): MutationSubmit<P> =>
  async (input: MutationInput<P>): Promise<MutationOutcome> => {
    const outcome = await transport.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
    const rows = receiptRowsOf(outcome, operation, input.payload.taskIds, selected);
    hold(rows);
    return withReceiptRows(outcome, rows);
  };
const retainedSelectionNote = (count: number): string => `${String(count)} ${count === 1 ? ROW_NOUN.one : ROW_NOUN.many} kept the selection because the result was ${BULK_ITEM_RESULT_LABELS.excluded} or ${BULK_ITEM_RESULT_LABELS.failed}.`;
function distinctReasons(rows: readonly BulkSelectionRow[]): readonly string[] {
  const reasons = new Set<string>();
  for (const row of rows) {
    const reason = row.selectionReason?.trim();
    if (reason !== undefined && reason !== "") reasons.add(reason);
  }
  return [...reasons];
}
type FieldInputProps = { readonly id: string; readonly label: string; readonly description?: string; readonly error?: string; readonly value: string; readonly type?: "text" | "date"; readonly onChange: (value: string) => void; readonly onBlur: () => void };
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
      <Input id={id} type={type} value={value} className="max-w-full" aria-describedby={describedBy === "" ? undefined : describedBy} aria-invalid={error === undefined ? undefined : true} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
      {error === undefined ? null : (
        <p id={errorId} className="type-body text-pretty text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
const ReviewFacts = ({ children }: { readonly children: ReactNode }): ReactElement => <div className="flex min-w-0 flex-col gap-2">{children}</div>;
function ReviewDescription({ prepared, perRowNotes }: { readonly prepared: PreparedBulk; readonly perRowNotes: ReactNode }): ReactElement {
  const intent: BulkIntent = prepared.operation === "bulkApplyTag" || prepared.operation === "bulkRemoveTag" ? "private-tag" : prepared.operation === "bulkCreateTasks" ? "create-follow-up-tasks" : "complete-independent-tasks";
  const stated = prepared.operation === "bulkApplyTag" || prepared.operation === "bulkRemoveTag" ? <TagFacts direction={prepared.operation === "bulkApplyTag" ? "apply" : "remove"} tag={prepared.payload.tag} /> : prepared.operation === "bulkCreateTasks" ? <FollowUpFacts template={prepared.payload.template} /> : null;
  return (
    <ReviewFacts>
      <p>{BULK_INTENT_DESCRIPTIONS[intent]}</p>
      {stated}
      {perRowNotes}
    </ReviewFacts>
  );
}
function TagFacts({ direction, tag }: { readonly direction: BulkTagDirection; readonly tag: string }): ReactElement {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="font-medium">{BULK_TAG_DIRECTION_LABELS[direction]}</span>
      <bdi className="min-w-0 wrap-anywhere">{tag}</bdi>
    </p>
  );
}
function FollowUpFacts({ template }: { readonly template: FollowUpTaskTemplate }): ReactElement {
  const { dueOn } = template;
  const rows: readonly FactSpec[] = [
    { term: FOLLOW_UP_LABELS.title, value: <bdi>{template.title}</bdi> },
    ...(template.category === undefined ? [] : [{ term: FOLLOW_UP_LABELS.category, value: <bdi>{template.category}</bdi> }]),
    ...(dueOn === undefined ? [] : [{ term: FOLLOW_UP_LABELS.dueOn, value: <StatedInstant iso={dueOn} /> }]),
    ...(template.note === undefined ? [] : [{ term: FOLLOW_UP_LABELS.note, value: <bdi>{template.note}</bdi> }]),
  ];
  return <FactList className="flex min-w-0 flex-col gap-1.5" facts={rows} rowClassName="flex min-w-0 flex-wrap items-baseline gap-x-2" termClassName="font-medium" valueClassName="min-w-0 wrap-anywhere" />;
} /** A replay answers with the stored per-item results and a batch that changed nothing carries none; both are stated here from the rows this surface holds, so every row the action was sent still names its own result. */
function SettledRows({ outcome, rows }: { readonly outcome: MutationOutcome | null; readonly rows: readonly PerItemResult[] }): ReactElement | null {
  if (outcome === null || rows.length === 0) return null;
  if (outcome.outcome !== "alreadyAccepted" && outcome.outcome !== "unchanged") return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className={NOTE_CLASS}>{outcome.outcome === "alreadyAccepted" ? BULK_REPLAY_NOTE : BULK_UNCHANGED_BATCH_NOTE}</p>
      <PerItemResults items={rows} heading={BULK_RESULT_HEADING} />
    </div>
  );
} /** The bar that carries the three bulk task actions over the rows a worker has explicitly selected, and the record of what each action did to each of them. */
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
  const reviewTarget = panelOpen ? liveTarget : null;
  const receiptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (settledOutcome !== null && !panelOpen) receiptRef.current?.focus();
  }, [settledOutcome, panelOpen]);
  const settledItems = settledOutcome === null ? [] : settledRows;
  const retainedCount = settledItems.filter((item) => rowKeepsSelection(item.state)).length;
  const eligibleCount = intent === null ? 0 : eligibleIds[intent].length;
  const selection: ActionReviewSelection = { count: eligibleCount, noun: eligibleCount === 1 ? ROW_NOUN.one : ROW_NOUN.many, excluded: intent === null ? 0 : selectedTasks.length - eligibleCount };
  const refusedFields = touched && livePreparation?.kind === "refused" ? fieldMessagesOf(livePreparation.error) : null;
  const fieldError = (key: string): string | undefined => refusedFields?.[key]?.join(" ");
  const unplacedMessages = refusedFields === null ? [] : Object.entries(refusedFields).flatMap(([key, messages]) => (RENDERED_FIELDS.includes(key) ? [] : messages));
  const recoveryHeld = settledOutcome !== null && (mayReplay(settledOutcome) || settledOutcome.outcome === "conflict");
  const panelTitle = intent === null ? "" : intent === "private-tag" ? BULK_TAG_DIRECTION_LABELS[draft.direction] : BULK_INTENT_LABELS[intent];
  const updateDraft = (field: DraftTextField, value: string): void => setDraft((current) => ({ ...current, [field]: value }));
  const markTouched = (): void => setTouched(true);
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
    setDraft((current) => ({ ...EMPTY_DRAFT, direction: current.direction }));
    onClearSelection();
  };
  const dismissResult = (): void => {
    setSettledOutcome(null);
    setSettledRows([]);
    closePanel();
  };
  const perRowNotes = (
    <>
      <p>{BULK_SELECTION_SCOPE_NOTE}</p>
      <p>{BULK_MIXED_RESULT_NOTE}</p>
    </>
  );
  const reviewOf = (target: ReviewTarget): ReactElement => {
    const common = { title: BULK_REVIEW_HEADING, confirmLabel: BULK_REVIEW_CONFIRM_LABEL, cancelLabel: BULK_REVIEW_CANCEL_LABEL, onCancel: closePanel, selection, headingLevel: 3 as const, onSettled: setSettledOutcome, checkResult: onCheckResult, fieldLabels: REVIEW_FIELD_LABELS };
    const { prepared } = target;
    const input = { scope, expectedRevision: target.revision };
    switch (prepared.operation) {
      case "bulkApplyTag":
        return <ActionReview<BulkApplyTagPayload> key="bulkApplyTag" {...common} description={<ReviewDescription prepared={prepared} perRowNotes={perRowNotes} />} input={{ ...input, payload: prepared.payload }} submit={submitFor(transports.bulkApplyTag, "bulkApplyTag", selectedTasks, setSettledRows)} />;
      case "bulkRemoveTag":
        return <ActionReview<BulkRemoveTagPayload> key="bulkRemoveTag" {...common} description={<ReviewDescription prepared={prepared} perRowNotes={perRowNotes} />} input={{ ...input, payload: prepared.payload }} submit={submitFor(transports.bulkRemoveTag, "bulkRemoveTag", selectedTasks, setSettledRows)} />;
      case "bulkCreateTasks":
        return <ActionReview<BulkCreateTasksPayload> key="bulkCreateTasks" {...common} description={<ReviewDescription prepared={prepared} perRowNotes={perRowNotes} />} input={{ ...input, payload: prepared.payload }} submit={submitFor(transports.bulkCreateTasks, "bulkCreateTasks", selectedTasks, setSettledRows)} />;
      case "bulkCompleteTasks":
        return (
          <ActionReview<BulkCompleteTasksPayload> key="bulkCompleteTasks" {...common} description={<ReviewDescription prepared={prepared} perRowNotes={perRowNotes} />} input={{ ...input, payload: prepared.payload }} submit={submitFor(transports.bulkCompleteTasks, "bulkCompleteTasks", selectedTasks, setSettledRows)} />
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
              <DropdownMenuItem key={direction} className="py-2 text-pretty" onClick={() => openIntent(entry, direction)}>
                {BULK_TAG_DIRECTION_LABELS[direction]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    return (
      <Button key={entry} type="button" variant="outline" disabled={closed || pending} aria-describedby={describedBy} className={CONTROL_CLASS} onClick={() => openIntent(entry, draft.direction)}>
        {BULK_INTENT_LABELS[entry]}
      </Button>
    );
  });
  const closedReasons = BULK_INTENTS.filter((entry) => eligibleIds[entry].length === 0).map((entry) => (
    <div key={entry} id={`${reasonIdPrefix}-${entry}`} className="flex min-w-0 flex-col gap-1">
      <p className="type-body text-pretty">
        <span className="font-medium">{BULK_INTENT_LABELS[entry]}</span>
        {` — ${CLOSED_INTENT_REASONS[entry]}`}
      </p>
      {unavailableReasons[entry].map((reason) => (
        <p key={reason} className={NOTE_CLASS}>
          {reason}
        </p>
      ))}
    </div>
  ));
  if (!rowsSelected && settledOutcome === null) return null;
  return (
    <section data-slot="bulk-action-bar" aria-busy={pending ? true : undefined} aria-labelledby={rowsSelected ? regionTitleId : undefined} className={className === undefined ? SECTION_CLASS : `${SECTION_CLASS} ${className}`}>
      {rowsSelected ? (
        <SectionCard title="Bulk actions" headingId={regionTitleId} cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
          <p aria-live="polite" className="type-body text-pretty">
            {BULK_SELECTION_COUNT_TEMPLATE.replace("{count}", String(selectedTasks.length))}
          </p>
          <p className={NOTE_CLASS}>{BULK_SELECTION_SCOPE_NOTE}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {intentControls}
            <Button type="button" variant="ghost" size="sm" className={CONTROL_CLASS} disabled={pending} onClick={onClearSelection}>
              {"Clear selection"}
            </Button>
          </div>
          {closedReasons}
          {retainedCount === 0 ? null : <p className={NOTE_CLASS}>{retainedSelectionNote(retainedCount)}</p>}
        </SectionCard>
      ) : null}
      {panelOpen && intent !== null ? (
        <section aria-labelledby={panelTitleId} className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h3 id={panelTitleId} className="type-subsection-title min-w-0">
              {panelTitle}
            </h3>
            {recoveryHeld ? null : (
              <Button type="button" variant="ghost" size="sm" className={CONTROL_CLASS} disabled={pending} onClick={closePanel}>
                {"Close"}
              </Button>
            )}
          </div>
          <p className={NOTE_CLASS}>{BULK_INTENT_DESCRIPTIONS[intent]}</p>
          {intent === "private-tag" ? (
            <div className={FIELD_STACK_CLASS}>
              <FieldInput id={`${fieldIdPrefix}-tag`} label={TAG_FIELD_LABEL} description={TAG_FIELD_DESCRIPTION} error={fieldError("tag")} value={draft.tag} onChange={(value) => updateDraft("tag", value)} onBlur={markTouched} />{" "}
            </div>
          ) : null}
          {intent === "create-follow-up-tasks" ? (
            <div className={FIELD_STACK_CLASS}>
              <p className={NOTE_CLASS}>{"Each selected row gets one ordinary follow-up task with these fields; no message is sent and no meeting time is set here."}</p>
              <FieldInput id={`${fieldIdPrefix}-title`} label={FOLLOW_UP_LABELS.title} error={fieldError("template.title")} value={draft.followUpTitle} onChange={(value) => updateDraft("followUpTitle", value)} onBlur={markTouched} />
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <FieldInput id={`${fieldIdPrefix}-category`} label={FOLLOW_UP_LABELS.category} error={fieldError("template.category")} value={draft.followUpCategory} onChange={(value) => updateDraft("followUpCategory", value)} onBlur={markTouched} />
                <FieldInput id={`${fieldIdPrefix}-due`} label={FOLLOW_UP_LABELS.dueOn} description={civilDateConvention(draft.followUpDueOn)} error={fieldError("template.dueOn")} value={draft.followUpDueOn} type="date" onChange={(value) => updateDraft("followUpDueOn", value)} onBlur={markTouched} />
              </div>
              <FieldInput id={`${fieldIdPrefix}-note`} label={FOLLOW_UP_LABELS.note} error={fieldError("template.note")} value={draft.followUpNote} onChange={(value) => updateDraft("followUpNote", value)} onBlur={markTouched} />
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
            <p className={NOTE_CLASS}>{"The review step appears here once these fields are valid, so nothing can be submitted that the action would refuse."}</p>
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
            <Button type="button" variant="outline" size="sm" className={CONTROL_CLASS} onClick={dismissResult}>
              {"Dismiss the result"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
