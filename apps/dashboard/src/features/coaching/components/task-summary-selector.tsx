"use client";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import { Temporal } from "temporal-polyfill";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { FormField } from "@/components/form-field";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { TASK_STATUS } from "@/components/status-badge";
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
import { type DatePrecision } from "@/modules/time/civil";
import { COACHING_COPY, LIMIT_COPY, MODULE_COPY, TASK_SHARE_STATE_COPY } from "../copy";
import { useShareTaskSummary } from "../hooks/use-coaching";
import { taskSharePayloadSchema, type TaskSharePayload } from "../schemas";
const SURFACE_PURPOSE = COACHING_COPY.sharing.purpose;
const COACH_SEES = MODULE_COPY["task-summaries"].description;
const SELECT_LABEL = "Task to share";
const PREVIEW_DUE_TERM = "Due date";
const PREVIEW_STATUS_TERM = "Status";
const NO_DUE_DATE = "No due date";
const OCCURRENCE_MISSING_BODY = "This task repeats, and the list states no occurrence of it: a repeating task's summary is shared only for the occurrence you select, so nothing can be shared from it here. The task itself is unchanged, and a summary can still be shared from a task that does not repeat.";
const FINGERPRINT_MISSING_BODY = "The list did not carry the fingerprint of this task's reviewed meaning, so a description could not be tied to what was reviewed. Reload the list and choose the task again.";
const FIELD_LABELS: Readonly<Record<string, string>> = { taskId: SELECT_LABEL, safeDescription: "Reviewed description", occurrenceId: "Occurrence", reviewedFingerprint: "Reviewed meaning" };
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The one type scale's heading utility per level, so the selector's card states its heading at the level it sits at with the same measure as every other heading there. */
const HEADING_SCALE: Readonly<Record<ReviewHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const SENTENCE_CLASS = "type-supporting text-pretty";
const FACT_ROW_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2";
const FACT_TERM_CLASS = "text-muted-foreground";
const AUTHORED_TEXT_CLASS = "min-w-0 break-words text-pretty whitespace-pre-wrap";
const REFUSAL_COPY: Readonly<Record<Exclude<TaskShareRefusalReason, "description-too-long">, string>> = {
  "description-empty": "A shared summary states what you want your coach to read, so write the description before you share it.",
  "not-reviewed": "This summary has no reviewed description attached, so nothing is shared until it is reviewed again.",
  "successor-needs-fresh-selection": "This is a new occurrence of a repeating task, and nothing carries over from the occurrence you shared before. Select this occurrence to share a summary of it.",
  "stale-revision": "The summary moved since this list was read, so nothing was shared. Reload the list and review the description again.",
  "not-shared": "This summary is no longer shared, so there is nothing here to extend.",
  "occurrence-already-shared": "This task already has a summary shared with your coach, so the same occurrence is not shared twice.",
  unavailable: "The task behind this summary cannot be read right now, so nothing was shared. Try again in a moment.",
};
export type TaskSummaryCandidate = {
  readonly taskId: string;
  readonly safeLabel: string;
  readonly dueOn: string | null;
  readonly duePrecision: DatePrecision;
  readonly status: TaskStatus;
  readonly isRecurringSuccessor: boolean;
  /** The task's own revision as the read stated it: a share presents it, because the service compares the revision of the task the summary is written against, so a task that moved settles as a conflict instead of sharing a description of something else. */
  readonly revision: string;
  readonly occurrenceId?: string;
  readonly reviewedFingerprint?: string;
  readonly predecessorShare?: TaskShare;
};
export type TaskSummaryExistingShare = { readonly taskId: string; readonly state: TaskShareSummaryState; readonly reviewedDescription: string | null };
export type TaskSummarySelectorProps = {
  readonly candidates: ReadonlyArray<TaskSummaryCandidate>;
  readonly existing: ReadonlyArray<TaskSummaryExistingShare>;
  readonly scope: Scope;
  readonly locale: string;
  readonly initialTaskId?: string;
  readonly asOf?: string;
  readonly onCheckResult?: () => void;
  readonly onReload?: () => void | Promise<void>;
  readonly headingLevel?: ReviewHeadingLevel;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
};
type DisplayedRefusal = { readonly reason: "description-too-long"; readonly codePoints: number } | { readonly reason: Exclude<TaskShareRefusalReason, "description-too-long"> };
type ShareDecision =
  | { readonly kind: "choose" }
  | { readonly kind: "cannot"; readonly heading: string; readonly description: string; readonly reloadable: boolean }
  | { readonly kind: "refused"; readonly message: string; readonly about: "description" | "selection" }
  | { readonly kind: "ready"; readonly payload: TaskSharePayload };
function describeRefusal(refusal: DisplayedRefusal): string {
  switch (refusal.reason) {
    case "description-too-long":
      return LIMIT_COPY.taskDescriptionExceeded(refusal.codePoints);
    default:
      return REFUSAL_COPY[refusal.reason];
  }
}
function blockingStateOf(shares: ReadonlyArray<TaskSummaryExistingShare>, taskId: string): "shared" | "needs-review" | undefined {
  const state = shares.find((share) => share.taskId === taskId)?.state;
  return state === "shared" || state === "needs-review" ? state : undefined;
}
function dueTextOf(candidate: TaskSummaryCandidate): string {
  const date = candidate.dueOn;
  if (date === null) return NO_DUE_DATE;
  switch (candidate.duePrecision) {
    case "date":
      return date;
    case "approximate":
      return `About ${date}`;
    case "unknown":
      return "Date not known";
  }
}
function reviewInstantOf(asOf: string | undefined): Temporal.Instant | undefined {
  if (asOf === undefined || asOf.trim() === "") return undefined;
  try {
    return Temporal.Instant.from(asOf);
  } catch {
    return undefined;
  }
}
function firstSchemaMessage(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string {
  const aboutDescription = issues.find((issue) => issue.path.includes("safeDescription"));
  const chosen = aboutDescription ?? issues[0];
  return chosen === undefined ? REFUSAL_COPY["not-reviewed"] : chosen.message;
}
const schemaIssueIsAboutDescription = (issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }>): boolean => issues.some((issue) => issue.path.includes("safeDescription"));
type DecisionInput = { readonly selected: TaskSummaryCandidate | undefined; readonly shares: ReadonlyArray<TaskSummaryExistingShare>; readonly description: string; readonly selectedOccurrenceId: string | undefined; readonly reviewInstant: Temporal.Instant | undefined };
function decideShare({ selected, shares, description, selectedOccurrenceId, reviewInstant }: DecisionInput): ShareDecision {
  if (selected === undefined) return { kind: "choose" };
  const blocking = blockingStateOf(shares, selected.taskId);
  if (blocking !== undefined) return { kind: "refused", message: blocking === "shared" ? REFUSAL_COPY["occurrence-already-shared"] : TASK_SHARE_STATE_COPY["needs-review"].description, about: "selection" };
  const occurrenceId = selected.occurrenceId;
  // No reload is offered here: the surface states that it can name no occurrence, so re-reading the same list would answer the same way.
  if (selected.isRecurringSuccessor && occurrenceId === undefined) return { kind: "cannot", heading: "This occurrence cannot be shared yet", description: OCCURRENCE_MISSING_BODY, reloadable: false };
  let reviewedFingerprint = selected.reviewedFingerprint;
  if (selected.isRecurringSuccessor) {
    if (occurrenceId === undefined || selectedOccurrenceId !== occurrenceId) return { kind: "refused", message: describeRefusal({ reason: "successor-needs-fresh-selection" }), about: "selection" };
    const predecessor = selected.predecessorShare;
    if (predecessor !== undefined) {
      const admitted = selectSuccessorForSharing({ share: predecessor, occurrenceId, selectedOccurrenceId, expectedRevision: predecessor.revision });
      if (!admitted.ok) return { kind: "refused", message: describeRefusal(admitted.error), about: "selection" };
      reviewedFingerprint = reviewedFingerprint ?? admitted.value.reviewedFingerprint;
    }
  }
  if (reviewedFingerprint === undefined || reviewedFingerprint.trim() === "") return { kind: "cannot", heading: "This task cannot be shared yet", description: FINGERPRINT_MISSING_BODY, reloadable: true };
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
const shareStateOf = (shares: ReadonlyArray<TaskSummaryExistingShare>, taskId: string): TaskShareSummaryState | undefined => shares.find((share) => share.taskId === taskId)?.state;
function optionLabelOf(candidate: TaskSummaryCandidate, state: TaskShareSummaryState | undefined): string {
  const standing = `${candidate.safeLabel} — ${dueTextOf(candidate)} — ${TASK_STATUS[candidate.status].label}`;
  return state === "shared" || state === "needs-review" ? `${standing} — ${TASK_SHARE_STATE_COPY[state].label}` : standing;
}
const describedByWith = (base: string | undefined, extra: string): string => (base === undefined || base.trim() === "" ? extra : `${base} ${extra}`);
function CoachPreview({ candidate, description, locale, labelId }: { readonly candidate: TaskSummaryCandidate; readonly description: string; readonly locale: string; readonly labelId: string }): ReactElement {
  const status = TASK_STATUS[candidate.status];
  const written = description.trim();
  return (
    <div data-slot="task-summary-preview" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
      <p {...{ id: labelId, className: "text-sm font-medium" }}>{"What your coach will read"}</p>
      <dl aria-labelledby={labelId} className="flex min-w-0 flex-col gap-1.5 text-sm">
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
          <dt className={FACT_TERM_CLASS}>{"Description"}</dt>
          <dd className="min-w-0">{written === "" ? <span className={SENTENCE_CLASS}>{"Nothing written yet. A coach reads nothing until you write a description and share it."}</span> : <bdi {...{ lang: locale, className: AUTHORED_TEXT_CLASS }}>{description}</bdi>}</dd>
        </div>
      </dl>
      <p className="text-xs text-pretty text-muted-foreground wrap-anywhere">{"The due date and the status come from the task and stay live. Neither is editable here, and neither is a promise that the work was done."}</p>
    </div>
  );
}
type SuccessorSelectionProps = { readonly candidate: TaskSummaryCandidate; readonly selectedOccurrenceId: string | undefined; readonly onSelectOccurrence: () => void };
function SuccessorSelection({ candidate, selectedOccurrenceId, onSelectOccurrence }: SuccessorSelectionProps): ReactElement {
  const selected = candidate.occurrenceId !== undefined && selectedOccurrenceId === candidate.occurrenceId;
  return (
    <Alert data-slot="task-summary-successor">
      <AlertTitle>{"This is a new occurrence of a repeating task"}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2">
        <p className="text-pretty wrap-anywhere">{"Nothing carries over from the occurrence you shared before: a summary of this occurrence is shared only when you select it here."}</p>
        {selected ? (
          <p className="text-pretty wrap-anywhere">{"You selected this occurrence in this session. It is the one this description will be shared for."}</p>
        ) : (
          <Button {...{ type: "button", variant: "outline", size: "sm", className: cn("min-h-target", "max-w-full whitespace-normal"), onClick: onSelectOccurrence }}>{"Select this occurrence"}</Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
type AttemptInput = Omit<MutationInput<TaskSharePayload>, "operationId">;
export function TaskSummarySelector({ candidates, existing, scope, locale, initialTaskId, asOf, onCheckResult, onReload, headingLevel = 2, dir, className }: TaskSummarySelectorProps): ReactElement {
  const { mutateAsync } = useShareTaskSummary();
  const headingId = useId();
  const counterId = useId();
  const previewLabelId = useId();
  const [selectedTaskId, setSelectedTaskId] = useState(initialTaskId ?? "");
  const [description, setDescription] = useState("");
  const [selectedOccurrence, setSelectedOccurrence] = useState<{ readonly taskId: string; readonly occurrenceId: string } | null>(null);
  const [submitted, setSubmitted] = useState<AttemptInput | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const Heading = HEADING_TAG[headingLevel];
  const noticeHeading = headingLevel === 2 ? 3 : 4;
  const selected = candidates.find((candidate) => candidate.taskId === selectedTaskId);
  const sharedCount = existing.filter((share) => share.state === "shared").length;
  const reviewInstant = useMemo(() => reviewInstantOf(asOf), [asOf]);
  const selectedOccurrenceId = selected !== undefined && selectedOccurrence !== null && selectedOccurrence.taskId === selected.taskId ? selectedOccurrence.occurrenceId : undefined;
  const decision = useMemo<ShareDecision>(() => decideShare({ selected, shares: existing, description, selectedOccurrenceId, reviewInstant }), [selected, existing, description, selectedOccurrenceId, reviewInstant]);
  // The revision presented is the chosen task's own: the service compares the revision of the task the summary is written against, so a task that moved settles as a conflict rather than a description of something else.
  const liveInput = useMemo<AttemptInput | null>(() => (decision.kind === "ready" && selected !== undefined ? { scope, expectedRevision: selected.revision, payload: decision.payload } : null), [decision, scope, selected]);
  const receiptHolds = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  const input = receiptHolds && submitted !== null ? submitted : liveInput;
  const clearReceipt = useCallback((): void => {
    setSubmitted(null);
    setSettled(null);
  }, []);
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
      setDescription("");
      setSelectedOccurrence(null);
      clearReceipt();
    },
    [clearReceipt],
  );
  const writeDescription = useCallback(
    (value: string): void => {
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
  const statusSpec = selected === undefined ? undefined : TASK_STATUS[selected.status];
  return (
    <section aria-labelledby={headingId} dir={dir} data-slot="task-summary-selector" data-decision={decision.kind} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <Heading {...{ id: headingId, className: HEADING_SCALE[headingLevel] }}>{"Share a task summary"}</Heading>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{SURFACE_PURPOSE}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-5">
          <p className={SENTENCE_CLASS}>
            <bdi>{COACH_SEES}</bdi>
          </p>
          {sharedCount === 0 ? null : (
            <p className={SENTENCE_CLASS}>
              <bdi className="tabular-figures">{String(sharedCount)}</bdi> {sharedCount === 1 ? "summary shared with your coach" : "summaries shared with your coach"}.{" "}
            </p>
          )}
          <Separator />
          {candidates.length === 0 ? (
            <StateNotice kind="empty" title="No task to share yet" description="A summary is shared from a task you already have. Add the work you want your coach to see, then come back and review a description of it." action={{ label: "Go to Work", href: "/work" }} headingLevel={noticeHeading} />
          ) : (
            <>
              <FormField label={SELECT_LABEL} name="task-summary-task" description="Choose one task. Its due date and status travel with the summary and stay live; the wording is yours." required>
                {(field) => (
                  <NativeSelect id={field.id} className="w-full max-w-full" value={selectedTaskId} onChange={(event) => chooseTask(event.target.value)} aria-describedby={field.describedBy} aria-invalid={field.invalid} aria-required={field.required}>
                    <NativeSelectOption value="">{"Choose a task"}</NativeSelectOption>
                    {candidates.map((candidate) => {
                      const state = shareStateOf(existing, candidate.taskId);
                      return (
                        <NativeSelectOption key={candidate.taskId} value={candidate.taskId} disabled={state === "shared" || state === "needs-review"}>
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
                  <FormField label="Reviewed description — a coach will read exactly this" name="task-summary-description" description="Write what you want your coach to understand about this piece of work. The task's own title, notes and history stay with you." error={descriptionError} required>
                    {(field) => (
                      <>
                        <Textarea
                          id={field.id}
                          rows={5}
                          className={cn("min-h-24", AUTHORED_TEXT_CLASS)}
                          lang={locale}
                          value={description}
                          onChange={(event) => writeDescription(event.target.value)}
                          aria-describedby={describedByWith(field.describedBy, counterId)}
                          aria-invalid={field.invalid}
                          aria-required={field.required}
                        />
                        <p {...{ id: counterId, "aria-live": "polite", className: "text-xs text-muted-foreground tabular-figures" }}>{`Written: ${String(Array.from(description).length)} / ${String(TASK_SUMMARY_MAX_CODE_POINTS)} code points`}</p>
                      </>
                    )}
                  </FormField>
                  {selected.isRecurringSuccessor ? <SuccessorSelection candidate={selected} selectedOccurrenceId={selectedOccurrenceId} onSelectOccurrence={confirmOccurrence} /> : null}
                  {cannot === null ? null : <StateNotice kind="unavailable" title={cannot.heading} description={cannot.description} headingLevel={noticeHeading} retry={cannot.reloadable && onReload !== undefined ? { label: "Reload the list", onClick: onReload } : undefined} />}
                  {selectionRefusal === undefined ? null : (
                    <Alert variant="destructive">
                      <AlertTitle>{"This summary cannot be shared yet"}</AlertTitle>
                      <AlertDescription className="text-pretty wrap-anywhere">{selectionRefusal}</AlertDescription>
                    </Alert>
                  )}
                  {input === null ? null : (
                    <ActionReview<TaskSharePayload>
                      title="Share this summary with your coach"
                      description={
                        <div className="flex min-w-0 flex-col gap-2">
                          <bdi {...{ lang: locale, className: cn("block rounded-lg border border-border p-2", AUTHORED_TEXT_CLASS) }}>{description}</bdi>
                          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className={FACT_TERM_CLASS}>{PREVIEW_DUE_TERM}</span>
                            <bdi className="mono-identifier wrap-anywhere">{selected === undefined ? NO_DUE_DATE : dueTextOf(selected)}</bdi>
                          </p>
                          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className={FACT_TERM_CLASS}>{PREVIEW_STATUS_TERM}</span>
                            {statusSpec === undefined ? null : <StatusBadge label={statusSpec.label} tone={statusSpec.tone} srPrefix={PREVIEW_STATUS_TERM} />}
                          </p>
                        </div>
                      }
                      consequence="Sharing writes this summary once. It sends no notice, records no interaction, creates no task and proves nothing about contact or payment."
                      confirmLabel="Share this summary"
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
