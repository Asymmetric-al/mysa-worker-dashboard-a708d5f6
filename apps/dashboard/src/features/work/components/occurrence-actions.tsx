"use client";
/**
 * The one surface for a repeating task's actions: the four things a worker can do about the single
 * actionable date, and the three things they can do to the series itself.
 *
 * Every action is one reviewed mutation. `useReviewedMutation` owns the attempt's identity, so a retry
 * replays the same operation rather than opening a second one, and each action renders exactly one
 * durable `OperationResult` in its own place — results are never aggregated into a single "done". The
 * series body is the shared `RecordDetail` in its page layout, so this file composes no second detail
 * body, header or section order.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { mayReplay, useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import { fieldErrorsFromInvalid, FormErrorSummary, FormField, type FieldErrorLookup, type FormFieldControl } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import RecordDetail from "@/components/record-detail";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationInput, ReadAction, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
// Type-only, like every data-service import in a browser component: the series view and the read's own
// parameter are taken from the service without loading the modules that produce them.
import type { reads } from "@/modules/data-service";
import { MISSED_PLAN_RESOLUTION_LABELS, MISSED_PLAN_RESOLUTION_ORDER, ONE_SUCCESSOR_NOTE, PAUSED_NOTE, PLAN_NEEDS_REVIEW_EXPLANATION, PLAN_NEEDS_REVIEW_HEADING, SERIES_STATE_LABELS, SKIPPED_MEANS_NOT_PERFORMED_NOTE, STOPPED_NOTE } from "../copy/missed-dates";
import {
  DAY_OF_MONTH_LABEL,
  END_CONDITION_LABELS,
  END_COUNT_LABEL,
  END_DATE_LABEL,
  INTERVAL_LABEL,
  MISSING_MONTHLY_DAY_DISCLOSURE,
  PLANNING_TIME_ZONE_LABEL,
  PLANNING_TIME_ZONE_NOTE,
  REPEAT_PROFILE_DESCRIPTIONS,
  REPEAT_PROFILE_FIELDS,
  REPEAT_PROFILE_LABELS,
  REPEAT_PROFILE_ORDER,
  SINGLE_ACTIONABLE_OCCURRENCE_NOTE,
} from "../copy/repeat-profiles";
import { CATEGORY_LABEL, COMPLETION_MEANS_NOTHING_NOTE, DUE_DATE_LABEL, PLANNED_VERSUS_HELD_NOTE, TASK_KIND_LABELS, TASK_STATUS_LABELS, UNDATED_LABEL } from "../copy/task-status";
import { editOccurrenceSchema, skipOccurrenceSchema, type EditOccurrencePayload, type SkipOccurrencePayload } from "../schemas/occurrence";
import { editThisAndFutureSchema, pauseSeriesSchema, resumeSeriesSchema, stopSeriesSchema, type EditThisAndFuturePayload, type PauseSeriesPayload, type ResumeSeriesPayload, type SeriesEndPayload, type StopSeriesPayload } from "../schemas/series";
import { completeTaskSchema, type CompleteTaskPayload } from "../schemas/task";
import { useSeriesMutations } from "../hooks/use-series-mutations";
import { useTaskMutations } from "../hooks/use-task-mutations";

// ---------------------------------------------------------------------------------------------
// Contracts, derived from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** One series read's successful answer, which is the shape this surface is handed. */
type SeriesReadEnvelope = Extract<Awaited<ReturnType<typeof reads.series.readSeries>>, { readonly kind: "envelope" }>["envelope"];

/** The series facts the envelope carries: identity, state, the one actionable date, the rule and the plan review. */
type SeriesView = SeriesReadEnvelope["data"];

/** The one date that can be answered, which the read names; `null` occurrences never reach an action. */
type SeriesOccurrence = NonNullable<SeriesView["currentOccurrence"]>;

type SeriesStateName = keyof typeof SERIES_STATE_LABELS;

type RepeatProfileName = keyof typeof REPEAT_PROFILE_LABELS;

type TaskKindName = keyof typeof TASK_KIND_LABELS;

type SeriesEndKind = SeriesView["rule"]["end"]["kind"];

type SeriesGroupHeadingLevel = 2 | 3 | 4;

// ---------------------------------------------------------------------------------------------
// Copy this surface owns
// ---------------------------------------------------------------------------------------------

const RECORD_KIND = "Repeating task";
const WORK_LIST_LABEL = "Work";
const WORK_ROUTE = "/work";
const SERIES_STATUS_SR_PREFIX = "Series status";
const SERIES_STATE_TONES: Readonly<Record<SeriesStateName, StatusTone>> = { active: "positive", paused: "caution", stopped: "neutral" };
const COMPLETE_LABEL = "Complete";
const SKIP_LABEL = "Skip";
const EDIT_OCCURRENCE_LABEL = "Edit this occurrence";
const EDIT_FUTURE_LABEL = "Edit this and future";
const PAUSE_LABEL = "Pause";
const RESUME_LABEL = "Resume";
const STOP_LABEL = "Stop";
const CANCEL_LABEL = "Cancel";
const OCCURRENCE_GROUP_LEGEND = "This date";
const SERIES_GROUP_LEGEND = "The series";
const OCCURRENCE_ABSENT_HEADING = "No date on this series is waiting for an answer";
const OCCURRENCE_ABSENT_BODY = "Only one date is actionable at a time, and this series has none right now. A preview date is not a date to complete or skip, so nothing is offered here for it.";
const COMPOSER_ACTION_LABEL = "Add this work as a one-off task";
const COMPOSER_ACTION_NOTE = "That creates an ordinary task rather than a date on this series, so this plan stays exactly as it is.";
const COMPLETE_NARRATION = COMPLETION_MEANS_NOTHING_NOTE;
const SKIP_NARRATION = SKIPPED_MEANS_NOT_PERFORMED_NOTE;
const EDIT_OCCURRENCE_NARRATION = "Only this one date changes: the rule that produced it, and every other date on the series, stay as they are.";
const EDIT_FUTURE_NARRATION = "Revises the plan from an explicit boundary onward, so the dates before it keep the rule they were planned under.";
const EFFECTIVE_BOUNDARY_LABEL = "Takes effect from";
const EFFECTIVE_BOUNDARY_EXPLANATION = "This is a prospective revision: the dates before that boundary keep the rule they were planned under, and completed history is untouched.";
const EFFECTIVE_BOUNDARY_ABSENT = "This series states no boundary a prospective change could take effect from, so nothing is revised here.";
const OCCURRENCE_FORM_HEADING = "Change this date";
const OCCURRENCE_FORM_NOTE = "This change applies to the date below and to nothing else: its kind stays as it is, and the rule that produces the following dates is not altered.";
const REVISION_FORM_HEADING = "Revise the plan from the boundary";
const REVISION_FORM_NOTE = "The revision applies from the boundary stated above. Every date before it, and every completed date, keeps the rule it was planned under.";
const FORM_REFUSAL_TITLE = "Check the details of this change";
const FORM_REFUSAL_DESCRIPTION = "Nothing was sent: correct the fields named here and submit the change again.";
const STOP_CONFIRM_TITLE = "Stop this series?";
const STOP_CONFIRM_LABEL = "Stop the series";
const STOP_CONFIRM_KEEPS_WORK = "Stopping admits no further dates. Every date already on the series stays exactly where it is, unfinished: stopping completes nothing on your behalf and records no contact.";
const STOP_CONFIRM_IS_FINAL = "A stopped series is not paused and cannot be resumed, so plan anything still needed after this as new work.";
const PAUSE_NARRATION = "Pausing admits no new dates while the series is on hold, and completes nothing.";
const RESUME_NARRATION = "Resuming lets the rule admit its next date again; it completes nothing and contacts no one.";
const STOP_NARRATION = "Stopping ends the plan for good. It is not the same as pausing, and it completes nothing.";
const NO_ACTIONABLE_DATE_LABEL = "No date to answer";
const TASK_STATUS_SR_PREFIX = "Date status";
const PLANNED_TIME_PREFIX = "Planned time";
const END_OF_SERIES_LABEL = "End";
const REVISION_FIELD_ORDER = ["planningTimeZone", "profile", "interval", "dayOfMonth", "end", "effectiveFrom", "title"] as const;
const OCCURRENCE_FIELD_ORDER = ["dueOn", "kind", "plannedTime", "timeZone", "title"] as const;
const SERIES_COMMAND_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { seriesId: "Series", unfinishedWork: "Unfinished work" };
const OCCURRENCE_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { occurrenceId: "The date", title: "Title", category: CATEGORY_LABEL, dueOn: "Due date", kind: "Kind", plannedTime: PLANNED_TIME_PREFIX, timeZone: PLANNING_TIME_ZONE_LABEL, note: "Note" };
const REVISION_FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  seriesId: "Series",
  effectiveFrom: EFFECTIVE_BOUNDARY_LABEL,
  title: "Title",
  category: CATEGORY_LABEL,
  note: "Note",
  planningTimeZone: PLANNING_TIME_ZONE_LABEL,
  profile: "Repeat",
  interval: INTERVAL_LABEL,
  dayOfMonth: DAY_OF_MONTH_LABEL,
  end: END_OF_SERIES_LABEL,
  "end.on": END_DATE_LABEL,
  "end.count": END_COUNT_LABEL,
};
const END_KIND_ORDER: readonly SeriesEndKind[] = ["on-date", "after-count", "ongoing-personal-policy"];
const PLANNED_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

// ---------------------------------------------------------------------------------------------
// Small readings of the facts the envelope already decided
// ---------------------------------------------------------------------------------------------

/** The envelope's published action with this name, or `undefined` when it published none. */
function actionOf(actions: readonly ReadAction[], name: string): ReadAction | undefined {
  return actions.find((candidate) => candidate.name === name);
}

/** The sentence the envelope gives for withholding this action, or `null` where it published none. */
function withheldReasonFor(actions: readonly ReadAction[], name: string): string | null {
  const published = actionOf(actions, name);
  if (published === undefined || published.available) return null;
  const reason = published.reason?.trim() ?? "";
  return reason === "" ? null : reason;
}

/** The per-field messages a schema refusal produced, in the shape the one form-error presentation reads. */
function lookupFromIssues(issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]): FieldErrorLookup {
  const byField: Record<string, readonly string[]> = {};
  const form: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) {
      form.push(issue.message);
      continue;
    }
    const path = issue.path.map((step) => String(step)).join(".");
    const existing = byField[path];
    byField[path] = existing === undefined ? [issue.message] : existing.includes(issue.message) ? existing : [...existing, issue.message];
  }
  return { byField, form, count: Object.keys(byField).length + form.length };
}

/** The messages for one field path, or `undefined` when the refusal named none. */
function fieldErrorOf(errors: FieldErrorLookup | null, path: string): readonly string[] | undefined {
  if (errors === null) return undefined;
  return errors.byField[path];
}

/** The aria wiring every control under a `FormField` carries, so its description, invalid state and required state are never dropped. */
function controlAria(field: FormFieldControl): { readonly "aria-describedby": string | undefined; readonly "aria-invalid": true | undefined; readonly "aria-required": true | undefined } {
  return { "aria-describedby": field.describedBy, "aria-invalid": field.invalid ? true : undefined, "aria-required": field.required ? true : undefined };
}

/** A calendar date as stored, displayed from the value the envelope supplied rather than recomputed. */
function CivilDateText({ value }: { readonly value: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={value}>
        {value}
      </time>
    </bdi>
  );
}

/** The value a date-and-time input shows for a stored planned time: a clock-only time is shown on the date the occurrence is due on, and nothing is invented when either part is missing. */
function plannedTimeFieldValue(occurrence: SeriesOccurrence): string {
  if (occurrence.plannedTime === null) return "";
  const stored = occurrence.plannedTime.trim();
  if (PLANNED_INPUT_PATTERN.test(stored)) return stored;
  if (!CLOCK_PATTERN.test(stored) || occurrence.dueOn === null) return "";
  return `${occurrence.dueOn}T${stored}`;
}

// ---------------------------------------------------------------------------------------------
// One receipt, in the place the action happened
// ---------------------------------------------------------------------------------------------

interface CommandReceiptProps {
  readonly outcome: MutationOutcome;
  readonly heading: string;
  readonly onCheckResult?: (() => void) | undefined;
  readonly onRetrySameWork?: (() => void) | undefined;
  readonly onReapply?: (() => void) | undefined;
  readonly fieldLabels?: Readonly<Record<string, string | undefined>> | undefined;
}

/** The one durable receipt of an attempt, focused when it appears so a keyboard user lands on its record of what happened. */
function CommandReceipt({ outcome, heading, onCheckResult, onRetrySameWork, onReapply, fieldLabels }: CommandReceiptProps): ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    frameRef.current?.focus();
  }, [outcome]);
  return (
    <div ref={frameRef} tabIndex={-1} data-slot="occurrence-command-result" data-outcome={outcome.outcome} className="flex min-w-0 flex-col gap-2 outline-none">
      <OperationResult outcome={outcome} heading={heading} headingLevel={4} onCheckResult={outcome.outcome === "unknown" ? onCheckResult : undefined} onRetrySameWork={onRetrySameWork} onReapply={onReapply} fieldLabels={fieldLabels} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One command, from trigger through confirmation to receipt
// ---------------------------------------------------------------------------------------------

type CommandVariant = "default" | "outline" | "secondary" | "ghost" | "destructive";

interface CommandConfirmation {
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
}

interface ReviewedCommandProps<P extends object> {
  readonly label: string;
  readonly variant?: CommandVariant;
  readonly receiptHeading: string;
  readonly narration: ReactNode;
  readonly input: Omit<MutationInput<P>, "operationId">;
  readonly submit: MutationSubmit<P>;
  /** The sentence the envelope gives when it withholds this action; the control stays present and disabled so the reason is readable. */
  readonly withheldReason?: string | null;
  /** Whether the record's own state admits this command. A command the state does not admit stays in place disabled, so the state beside it explains the change and its receipt is never lost. */
  readonly admitted?: boolean;
  /** A consequential command states what it does and asks once more, in the one alert-dialog step. */
  readonly confirmation?: CommandConfirmation;
  readonly onCheckResult?: (() => void) | undefined;
  /** The words a refusal's field paths are shown with, so a refused payload names a field rather than a path. */
  readonly fieldLabels?: Readonly<Record<string, string | undefined>> | undefined;
  readonly className?: string;
}

/** One reviewed command: its trigger, the one alert-dialog step a consequential action needs, and its own receipt. */
function ReviewedCommand<P extends object>({ label, variant = "outline", receiptHeading, narration, input, submit, withheldReason = null, admitted = true, confirmation, onCheckResult, fieldLabels, className }: ReviewedCommandProps<P>): ReactElement {
  const { pending, outcome, submit: dispatch, retry, reapply } = useReviewedMutation<P>(submit);
  const [confirming, setConfirming] = useState(false);
  const narrationId = useId();
  const disabled = pending || withheldReason !== null || !admitted;
  const run = (): void => {
    void dispatch(input);
  };
  const confirm = (): void => {
    setConfirming(false);
    run();
  };
  return (
    <div data-slot="occurrence-command" data-command={label} aria-busy={pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {confirmation === undefined ? (
          <Button type="button" variant={variant} size="sm" disabled={disabled} aria-describedby={narrationId} className="min-h-8 max-w-full whitespace-normal" onClick={run}>
            {label}
          </Button>
        ) : (
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" disabled={disabled} aria-describedby={narrationId} className="min-h-8 max-w-full whitespace-normal" />}>{label}</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
                {/* The description element is itself a paragraph, so each sentence is a span laid out as a block. */}
                <AlertDialogDescription className="flex flex-col gap-2">{confirmation.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{CANCEL_LABEL}</AlertDialogCancel>
                <AlertDialogAction confirmVariant="destructive" onClick={confirm}>
                  {confirmation.confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <p id={narrationId} className="min-w-0 flex-1 basis-56 text-sm text-pretty text-muted-foreground">
          {narration}
        </p>
      </div>
      {withheldReason === null ? null : <p className="text-sm text-pretty text-muted-foreground">{withheldReason}</p>}
      {pending ? <output className="block text-sm text-muted-foreground">{`${label}: working. Nothing else is submitted while this one is in flight.`}</output> : null}
      {outcome === null ? null : <CommandReceipt outcome={outcome} heading={receiptHeading} onCheckResult={onCheckResult} onRetrySameWork={mayReplay(outcome) ? () => void retry() : undefined} onReapply={outcome.outcome === "conflict" ? () => void reapply() : undefined} fieldLabels={fieldLabels} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The one date that can be answered
// ---------------------------------------------------------------------------------------------

/** The facts of the single actionable date, shown from the values the read supplied and never recomputed here. */
function OccurrenceFacts({ occurrence }: { readonly occurrence: SeriesOccurrence }): ReactElement {
  const meeting = occurrence.kind === "meeting";
  const category = occurrence.category?.trim() ?? "";
  return (
    <dl className="flex min-w-0 flex-col gap-1.5 text-sm">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="text-muted-foreground">{DUE_DATE_LABEL}</dt>
        <dd className="min-w-0">{occurrence.dueOn === null ? UNDATED_LABEL : <CivilDateText value={occurrence.dueOn} />}</dd>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="text-muted-foreground">Kind</dt>
        <dd className="min-w-0">
          <Badge variant="outline">{TASK_KIND_LABELS[occurrence.kind]}</Badge>
        </dd>
      </div>
      {meeting && occurrence.plannedTime !== null ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">{PLANNED_TIME_PREFIX}</dt>
          <dd className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <bdi className="tabular-figures">{occurrence.plannedTime}</bdi>
              {occurrence.timeZone === null ? null : (
                <span className="min-w-0 text-muted-foreground">
                  <bdi>{occurrence.timeZone}</bdi>
                </span>
              )}
            </span>
            <span className="text-sm text-pretty text-muted-foreground">{PLANNED_VERSUS_HELD_NOTE}</span>
          </dd>
        </div>
      ) : null}
      {category === "" ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">{CATEGORY_LABEL}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi>{category}</bdi>
          </dd>
        </div>
      )}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// Changing one date
// ---------------------------------------------------------------------------------------------

const APPLY_OCCURRENCE_LABEL = "Apply to this date";
const APPLY_REVISION_LABEL = "Apply this revision";

interface OccurrenceDraft {
  readonly title: string;
  readonly category: string;
  readonly dueOn: string;
  readonly kind: TaskKindName;
  readonly plannedTime: string;
  readonly timeZone: string;
  readonly note: string;
}

function occurrenceDraftOf(occurrence: SeriesOccurrence): OccurrenceDraft {
  return { title: occurrence.title, category: occurrence.category ?? "", dueOn: occurrence.dueOn ?? "", kind: occurrence.kind, plannedTime: plannedTimeFieldValue(occurrence), timeZone: occurrence.timeZone ?? "", note: occurrence.note ?? "" };
}

/** The payload one set of entries states: a blank optional field is omitted rather than sent empty, so the schema's own rule decides whether it is absent. */
function occurrencePayloadOf(occurrenceId: string, draft: OccurrenceDraft): EditOccurrencePayload {
  const meeting = draft.kind === "meeting";
  return { occurrenceId, title: draft.title, category: draft.category, dueOn: draft.dueOn, kind: draft.kind, ...(meeting && draft.plannedTime.trim() !== "" ? { plannedTime: draft.plannedTime } : {}), ...(meeting && draft.timeZone.trim() !== "" ? { timeZone: draft.timeZone } : {}), note: draft.note };
}

interface OccurrenceEditFormProps {
  readonly scope: Scope;
  readonly occurrence: SeriesOccurrence;
  readonly onClose: () => void;
  readonly onCheckResult?: (() => void) | undefined;
}

/** The one form for changing this date alone. Its entries stay in this component's state, so a refused or unavailable attempt loses nothing. */
function OccurrenceEditForm({ scope, occurrence, onClose, onCheckResult }: OccurrenceEditFormProps): ReactElement {
  const { editOccurrence } = useSeriesMutations(scope);
  const [draft, setDraft] = useState<OccurrenceDraft>(() => occurrenceDraftOf(occurrence));
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const { pending, outcome, submit, retry, reapply } = useReviewedMutation<EditOccurrencePayload>(async (input) => editOccurrence.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload }));
  const shown = errors ?? (outcome !== null && outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
  const update = (patch: Partial<OccurrenceDraft>): void => setDraft((current) => ({ ...current, ...patch }));
  const meeting = draft.kind === "meeting";
  const submitDraft = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = editOccurrenceSchema.safeParse(occurrencePayloadOf(occurrence.taskId, draft));
    if (!parsed.success) {
      setErrors(lookupFromIssues(parsed.error.issues));
      return;
    }
    setErrors(null);
    void submit({ scope, expectedRevision: occurrence.revision, payload: parsed.data });
  };
  return (
    <Card size="sm" data-slot="occurrence-edit-form" aria-busy={pending ? true : undefined} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h4 className="font-heading text-sm font-medium">{OCCURRENCE_FORM_HEADING}</h4>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate className="flex min-w-0 flex-col gap-3" onSubmit={submitDraft}>
          <p className="text-sm text-pretty text-muted-foreground">{OCCURRENCE_FORM_NOTE}</p>
          <FormErrorSummary errors={shown} labels={OCCURRENCE_FIELD_LABELS} order={OCCURRENCE_FIELD_ORDER} title={FORM_REFUSAL_TITLE} description={FORM_REFUSAL_DESCRIPTION} headingLevel={4} />
          <FormField label="Title" name="title" required error={fieldErrorOf(shown, "title")}>
            {(field) => <Input {...controlAria(field)} value={draft.title} autoComplete="off" onChange={(event) => update({ title: event.target.value })} />}
          </FormField>
          <FormField label={DUE_DATE_LABEL} name="dueOn" required description="A due date is a calendar date, so it stays that day wherever you are." error={fieldErrorOf(shown, "dueOn")}>
            {(field) => <Input {...controlAria(field)} type="date" value={draft.dueOn} onChange={(event) => update({ dueOn: event.target.value })} />}
          </FormField>
          {meeting ? (
            <>
              <FormField label={PLANNED_TIME_PREFIX} name="plannedTime" optionalHint error={fieldErrorOf(shown, "plannedTime")}>
                {(field) => <Input {...controlAria(field)} type="datetime-local" value={draft.plannedTime} onChange={(event) => update({ plannedTime: event.target.value })} />}
              </FormField>
              <FormField label={PLANNING_TIME_ZONE_LABEL} name="timeZone" optionalHint description={PLANNED_VERSUS_HELD_NOTE} error={fieldErrorOf(shown, "timeZone")}>
                {(field) => <Input {...controlAria(field)} value={draft.timeZone} autoComplete="off" onChange={(event) => update({ timeZone: event.target.value })} />}
              </FormField>
            </>
          ) : null}
          <FormField label={CATEGORY_LABEL} name="category" optionalHint error={fieldErrorOf(shown, "category")}>
            {(field) => <Input {...controlAria(field)} value={draft.category} autoComplete="off" onChange={(event) => update({ category: event.target.value })} />}
          </FormField>
          <FormField label="Note" name="note" optionalHint error={fieldErrorOf(shown, "note")}>
            {(field) => <Textarea {...controlAria(field)} rows={3} value={draft.note} onChange={(event) => update({ note: event.target.value })} />}
          </FormField>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending} className="min-h-8 max-w-full whitespace-normal">
              {APPLY_OCCURRENCE_LABEL}
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-8 max-w-full whitespace-normal" onClick={onClose}>
              {CANCEL_LABEL}
            </Button>
          </div>
          {pending ? <output className="block text-sm text-muted-foreground">{`${APPLY_OCCURRENCE_LABEL}: working. Nothing else is submitted while this one is in flight.`}</output> : null}
          {outcome === null ? null : (
            <CommandReceipt outcome={outcome} heading={OCCURRENCE_EDIT_RECEIPT_HEADING} onCheckResult={onCheckResult} onRetrySameWork={mayReplay(outcome) ? () => void retry() : undefined} onReapply={outcome.outcome === "conflict" ? () => void reapply() : undefined} fieldLabels={OCCURRENCE_FIELD_LABELS} />
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Revising the plan from an explicit boundary
// ---------------------------------------------------------------------------------------------

interface RevisionDraft {
  readonly title: string;
  readonly planningTimeZone: string;
  readonly profile: RepeatProfileName;
  readonly interval: string;
  readonly dayOfMonth: string;
  readonly endKind: SeriesEndKind;
  readonly endOn: string;
  readonly endCount: string;
}

function profileOf(value: string): RepeatProfileName {
  return REPEAT_PROFILE_ORDER.find((profile) => profile === value) ?? "none";
}

function endKindOf(value: string): SeriesEndKind {
  return END_KIND_ORDER.find((kind) => kind === value) ?? "on-date";
}

function revisionDraftOf(series: SeriesView): RevisionDraft {
  const rule = series.rule;
  const end = rule.end;
  return {
    title: series.title,
    planningTimeZone: rule.planningTimeZone,
    profile: rule.profile,
    interval: String(rule.interval),
    dayOfMonth: rule.dayOfMonth === null ? "" : String(rule.dayOfMonth),
    endKind: end.kind,
    endOn: end.kind === "on-date" ? end.on : "",
    endCount: end.kind === "after-count" ? String(end.count) : "",
  };
}

/** A number the schema must judge: a blank entry is not silently read as zero or one. */
function statedNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

function endPayloadOf(draft: RevisionDraft): SeriesEndPayload {
  switch (draft.endKind) {
    case "on-date":
      return { kind: "on-date", on: draft.endOn };
    case "after-count":
      return { kind: "after-count", count: statedNumber(draft.endCount) };
    case "ongoing-personal-policy":
      return { kind: "ongoing-personal-policy" };
  }
}

function revisionPayloadOf(seriesId: string, effectiveFrom: string, draft: RevisionDraft): EditThisAndFuturePayload {
  const fields = REPEAT_PROFILE_FIELDS[draft.profile];
  return {
    seriesId,
    effectiveFrom,
    title: draft.title,
    // A revision restates neither label: the series holds no category and no note, so sending an empty
    // restatement would be a statement about the date in force rather than about the plan.
    category: undefined,
    note: undefined,
    planningTimeZone: draft.planningTimeZone,
    profile: draft.profile,
    ...(fields.includes("interval") ? { interval: statedNumber(draft.interval) } : {}),
    ...(fields.includes("dayOfMonth") ? { dayOfMonth: statedNumber(draft.dayOfMonth) } : {}),
    end: endPayloadOf(draft),
  };
}

interface FutureRevisionFormProps {
  readonly scope: Scope;
  readonly series: SeriesView;
  /** The revision the caller read, which the change presents so a plan that moved settles as a conflict. */
  readonly revision: string;
  readonly effectiveFrom: string;
  readonly onClose: () => void;
  readonly onCheckResult?: (() => void) | undefined;
}

/** The one form for a prospective revision of the rule. It names the boundary it applies from and states that completed history is untouched. */
function FutureRevisionForm({ scope, series, revision, effectiveFrom, onClose, onCheckResult }: FutureRevisionFormProps): ReactElement {
  const { editThisAndFuture } = useSeriesMutations(scope);
  const [draft, setDraft] = useState<RevisionDraft>(() => revisionDraftOf(series));
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const { pending, outcome, submit, retry, reapply } = useReviewedMutation<EditThisAndFuturePayload>(async (input) => editThisAndFuture.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload }));
  const shown = errors ?? (outcome !== null && outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
  const update = (patch: Partial<RevisionDraft>): void => setDraft((current) => ({ ...current, ...patch }));
  const fields = REPEAT_PROFILE_FIELDS[draft.profile];
  const submitDraft = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = editThisAndFutureSchema.safeParse(revisionPayloadOf(series.seriesId, effectiveFrom, draft));
    if (!parsed.success) {
      setErrors(lookupFromIssues(parsed.error.issues));
      return;
    }
    setErrors(null);
    void submit({ scope, expectedRevision: revision, payload: parsed.data });
  };
  return (
    <Card size="sm" data-slot="series-revision-form" aria-busy={pending ? true : undefined} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h4 className="font-heading text-sm font-medium">{REVISION_FORM_HEADING}</h4>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate className="flex min-w-0 flex-col gap-3" onSubmit={submitDraft}>
          <p className="text-sm text-pretty text-muted-foreground">{REVISION_FORM_NOTE}</p>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">{EFFECTIVE_BOUNDARY_LABEL}</span>
            <CivilDateText value={effectiveFrom} />
          </p>
          <p className="text-sm text-pretty text-muted-foreground">{EFFECTIVE_BOUNDARY_EXPLANATION}</p>
          <FormErrorSummary errors={shown} labels={REVISION_FIELD_LABELS} order={REVISION_FIELD_ORDER} title={FORM_REFUSAL_TITLE} description={FORM_REFUSAL_DESCRIPTION} headingLevel={4} />
          <FormField label="Title" name="title" required error={fieldErrorOf(shown, "title")}>
            {(field) => <Input {...controlAria(field)} value={draft.title} autoComplete="off" onChange={(event) => update({ title: event.target.value })} />}
          </FormField>
          <FormField label={PLANNING_TIME_ZONE_LABEL} name="planningTimeZone" required description={PLANNING_TIME_ZONE_NOTE} error={fieldErrorOf(shown, "planningTimeZone")}>
            {(field) => <Input {...controlAria(field)} value={draft.planningTimeZone} autoComplete="off" onChange={(event) => update({ planningTimeZone: event.target.value })} />}
          </FormField>
          <FormField label="Repeat" name="profile" required error={fieldErrorOf(shown, "profile")}>
            {(field) => (
              <NativeSelect {...controlAria(field)} value={draft.profile} onChange={(event) => update({ profile: profileOf(event.target.value) })}>
                {REPEAT_PROFILE_ORDER.map((profile) => (
                  <NativeSelectOption key={profile} value={profile}>
                    {REPEAT_PROFILE_LABELS[profile]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <p className="text-sm text-pretty text-muted-foreground">{REPEAT_PROFILE_DESCRIPTIONS[draft.profile]}</p>
          {fields.includes("interval") ? (
            <FormField label={INTERVAL_LABEL} name="interval" required error={fieldErrorOf(shown, "interval")}>
              {(field) => <Input {...controlAria(field)} type="number" min={1} step={1} value={draft.interval} onChange={(event) => update({ interval: event.target.value })} />}
            </FormField>
          ) : null}
          {fields.includes("dayOfMonth") ? (
            <FormField label={DAY_OF_MONTH_LABEL} name="dayOfMonth" required description={MISSING_MONTHLY_DAY_DISCLOSURE} error={fieldErrorOf(shown, "dayOfMonth")}>
              {(field) => <Input {...controlAria(field)} type="number" min={1} max={31} step={1} value={draft.dayOfMonth} onChange={(event) => update({ dayOfMonth: event.target.value })} />}
            </FormField>
          ) : null}
          <FormField label={END_OF_SERIES_LABEL} name="end" required error={fieldErrorOf(shown, "end")}>
            {(field) => (
              <NativeSelect {...controlAria(field)} value={draft.endKind} onChange={(event) => update({ endKind: endKindOf(event.target.value) })}>
                {END_KIND_ORDER.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {END_CONDITION_LABELS[kind]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {draft.endKind === "on-date" ? (
            <FormField label={END_DATE_LABEL} name="end.on" required error={fieldErrorOf(shown, "end.on")}>
              {(field) => <Input {...controlAria(field)} type="date" value={draft.endOn} onChange={(event) => update({ endOn: event.target.value })} />}
            </FormField>
          ) : null}
          {draft.endKind === "after-count" ? (
            <FormField label={END_COUNT_LABEL} name="end.count" required error={fieldErrorOf(shown, "end.count")}>
              {(field) => <Input {...controlAria(field)} type="number" min={1} step={1} value={draft.endCount} onChange={(event) => update({ endCount: event.target.value })} />}
            </FormField>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending} className="min-h-8 max-w-full whitespace-normal">
              {APPLY_REVISION_LABEL}
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-8 max-w-full whitespace-normal" onClick={onClose}>
              {CANCEL_LABEL}
            </Button>
          </div>
          {pending ? <output className="block text-sm text-muted-foreground">{`${APPLY_REVISION_LABEL}: working. Nothing else is submitted while this one is in flight.`}</output> : null}
          {outcome === null ? null : (
            <CommandReceipt outcome={outcome} heading={REVISION_RECEIPT_HEADING} onCheckResult={onCheckResult} onRetrySameWork={mayReplay(outcome) ? () => void retry() : undefined} onReapply={outcome.outcome === "conflict" ? () => void reapply() : undefined} fieldLabels={REVISION_FIELD_LABELS} />
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// The four things a worker can do about the one date that is waiting
// ---------------------------------------------------------------------------------------------

const COMPLETE_RECEIPT_HEADING = "Completing this date";
const SKIP_RECEIPT_HEADING = "Skipping this date";
const OCCURRENCE_EDIT_RECEIPT_HEADING = "Changing this date";
const REVISION_RECEIPT_HEADING = "Revising the plan";
const PAUSE_RECEIPT_HEADING = "Pausing the series";
const RESUME_RECEIPT_HEADING = "Resuming the series";
const STOP_RECEIPT_HEADING = "Stopping the series";
const GROUP_HEADING_TAG: Readonly<Record<SeriesGroupHeadingLevel, "h2" | "h3" | "h4">> = { 2: "h2", 3: "h3", 4: "h4" };

interface OccurrenceCommandsProps {
  readonly scope: Scope;
  readonly series: SeriesView;
  readonly revision: string;
  readonly actions: readonly ReadAction[];
  /** The explicit boundary a prospective revision takes effect from, or `null` when the read supplies none. */
  readonly effectiveFrom: string | null;
  readonly onCheckResult?: (() => void) | undefined;
  readonly onOpenComposer?: (() => void) | undefined;
}

/** The occurrence group: the one actionable date, the four controls the envelope admits for it, and one receipt per attempt. */
function OccurrenceCommands({ scope, series, revision, actions, effectiveFrom, onCheckResult, onOpenComposer }: OccurrenceCommandsProps): ReactElement {
  const headingId = useId();
  const formId = useId();
  const { completeTask } = useTaskMutations(scope);
  const { skipOccurrence } = useSeriesMutations(scope);
  const [editing, setEditing] = useState<"none" | "occurrence" | "future">("none");
  const occurrenceToggleRef = useRef<HTMLButtonElement | null>(null);
  const futureToggleRef = useRef<HTMLButtonElement | null>(null);
  const Heading = GROUP_HEADING_TAG[3];
  // The read names exactly one actionable date: a preview date carries no id here, so it can never reach a complete or skip control.
  const actionable = series.actionableOccurrenceId !== null && series.currentOccurrence !== null && series.currentOccurrence.taskId === series.actionableOccurrenceId ? series.currentOccurrence : null;
  const closeOccurrenceForm = (): void => {
    setEditing("none");
    occurrenceToggleRef.current?.focus();
  };
  const closeRevisionForm = (): void => {
    setEditing("none");
    futureToggleRef.current?.focus();
  };
  const revisionWithheld = effectiveFrom === null ? EFFECTIVE_BOUNDARY_ABSENT : withheldReasonFor(actions, "editThisAndFuture");
  const occurrenceWithheld = actionable === null ? null : withheldReasonFor(actions, "editOccurrence");
  if (actionable === null) {
    const absentReason = withheldReasonFor(actions, "skipOccurrence") ?? withheldReasonFor(actions, "editOccurrence");
    return (
      <section aria-labelledby={headingId} data-slot="occurrence-actions" data-occurrence="absent" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Heading id={headingId} className="font-heading text-base font-medium">
            {OCCURRENCE_GROUP_LEGEND}
          </Heading>
          <Badge variant="outline">{NO_ACTIONABLE_DATE_LABEL}</Badge>
        </div>
        <Alert>
          <AlertTitle>{OCCURRENCE_ABSENT_HEADING}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{OCCURRENCE_ABSENT_BODY}</p>
            {absentReason === null ? null : <p>{absentReason}</p>}
            <p>{SINGLE_ACTIONABLE_OCCURRENCE_NOTE}</p>
          </AlertDescription>
        </Alert>
        {onOpenComposer === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <Button type="button" variant="outline" size="sm" className="min-h-8 max-w-full whitespace-normal" onClick={onOpenComposer}>
              {COMPOSER_ACTION_LABEL}
            </Button>
            <p className="min-w-0 flex-1 basis-56 text-sm text-pretty text-muted-foreground">{COMPOSER_ACTION_NOTE}</p>
          </div>
        )}
      </section>
    );
  }
  const completeInput: Omit<MutationInput<CompleteTaskPayload>, "operationId"> = { scope, expectedRevision: actionable.revision, payload: completeTaskSchema.parse({ taskId: actionable.taskId }) };
  const skipInput: Omit<MutationInput<SkipOccurrencePayload>, "operationId"> = { scope, expectedRevision: actionable.revision, payload: skipOccurrenceSchema.parse({ occurrenceId: actionable.taskId }) };
  return (
    <section aria-labelledby={headingId} data-slot="occurrence-actions" data-occurrence="actionable" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Heading id={headingId} className="font-heading text-base font-medium">
          {OCCURRENCE_GROUP_LEGEND}
        </Heading>
        <StatusBadge label={TASK_STATUS_LABELS[actionable.status]} tone="info" srPrefix={TASK_STATUS_SR_PREFIX} />
      </div>
      <p className="min-w-0 text-sm font-medium text-pretty wrap-anywhere">
        <bdi>{actionable.title}</bdi>
      </p>
      <OccurrenceFacts occurrence={actionable} />
      <ReviewedCommand<CompleteTaskPayload>
        label={COMPLETE_LABEL}
        variant="default"
        receiptHeading={COMPLETE_RECEIPT_HEADING}
        narration={COMPLETE_NARRATION}
        input={completeInput}
        submit={async (input) => completeTask.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload })}
        withheldReason={withheldReasonFor(actionable.actions, "completeTask")}
        onCheckResult={onCheckResult}
        fieldLabels={OCCURRENCE_FIELD_LABELS}
      />
      <ReviewedCommand<SkipOccurrencePayload>
        label={SKIP_LABEL}
        receiptHeading={SKIP_RECEIPT_HEADING}
        narration={SKIP_NARRATION}
        input={skipInput}
        submit={async (input) => skipOccurrence.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload })}
        withheldReason={withheldReasonFor(actions, "skipOccurrence")}
        onCheckResult={onCheckResult}
        fieldLabels={OCCURRENCE_FIELD_LABELS}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button
            ref={occurrenceToggleRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-8 max-w-full whitespace-normal"
            disabled={occurrenceWithheld !== null}
            aria-expanded={editing === "occurrence"}
            aria-controls={editing === "occurrence" ? formId : undefined}
            onClick={() => setEditing(editing === "occurrence" ? "none" : "occurrence")}
          >
            {EDIT_OCCURRENCE_LABEL}
          </Button>
          <p className="min-w-0 flex-1 basis-56 text-sm text-pretty text-muted-foreground">{EDIT_OCCURRENCE_NARRATION}</p>
        </div>
        {occurrenceWithheld === null ? null : <p className="text-sm text-pretty text-muted-foreground">{occurrenceWithheld}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button
            ref={futureToggleRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-8 max-w-full whitespace-normal"
            disabled={revisionWithheld !== null}
            aria-expanded={editing === "future"}
            aria-controls={editing === "future" ? formId : undefined}
            onClick={() => setEditing(editing === "future" ? "none" : "future")}
          >
            {EDIT_FUTURE_LABEL}
          </Button>
          <p className="min-w-0 flex-1 basis-56 text-sm text-pretty text-muted-foreground">{EDIT_FUTURE_NARRATION}</p>
        </div>
        {revisionWithheld === null ? null : <p className="text-sm text-pretty text-muted-foreground">{revisionWithheld}</p>}
      </div>
      <div id={formId} className="flex min-w-0 flex-col gap-3">
        {editing === "occurrence" ? <OccurrenceEditForm scope={scope} occurrence={actionable} onClose={closeOccurrenceForm} onCheckResult={onCheckResult} /> : null}
        {editing === "future" && effectiveFrom !== null ? <FutureRevisionForm scope={scope} series={series} revision={revision} effectiveFrom={effectiveFrom} onClose={closeRevisionForm} onCheckResult={onCheckResult} /> : null}
      </div>
      <p className="text-sm text-pretty text-muted-foreground">{ONE_SUCCESSOR_NOTE}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Pausing, resuming and stopping the series
// ---------------------------------------------------------------------------------------------

export interface SeriesStateControlsProps {
  readonly scope: Scope;
  readonly seriesId: string;
  readonly revision: string;
  readonly state: SeriesStateName;
  readonly actions: readonly ReadAction[];
  /** Re-reads the series for an attempt whose acknowledgement was lost; recovery is by operation identity, never a second attempt. */
  readonly onCheckResult?: (() => void) | undefined;
  readonly headingLevel?: SeriesGroupHeadingLevel;
  readonly className?: string;
}

/**
 * The one implementation of pause, resume and stop, so the series detail surface and the series editor
 * share it rather than each writing their own. Paused and stopped are different states and are never
 * described with one another's words; stop is consequential and states what stays in place.
 */
export function SeriesStateControls({ scope, seriesId, revision, state, actions, onCheckResult, headingLevel = 3, className }: SeriesStateControlsProps): ReactElement {
  const headingId = useId();
  const { pauseSeries, resumeSeries, stopSeries } = useSeriesMutations(scope);
  const Heading = GROUP_HEADING_TAG[headingLevel];
  const active = state === "active";
  const paused = state === "paused";
  const stopped = state === "stopped";
  const pauseInput: Omit<MutationInput<PauseSeriesPayload>, "operationId"> = { scope, expectedRevision: revision, payload: pauseSeriesSchema.parse({ seriesId }) };
  const resumeInput: Omit<MutationInput<ResumeSeriesPayload>, "operationId"> = { scope, expectedRevision: revision, payload: resumeSeriesSchema.parse({ seriesId }) };
  const stopInput: Omit<MutationInput<StopSeriesPayload>, "operationId"> = { scope, expectedRevision: revision, payload: stopSeriesSchema.parse({ seriesId }) };
  const stateSentence = paused ? PAUSED_NOTE : stopped ? STOPPED_NOTE : SINGLE_ACTIONABLE_OCCURRENCE_NOTE;
  // A command the state does not admit stays rendered and disabled: its own receipt has to survive the state
  // change it made, and the sentence beside the state says why nothing further is offered.
  const pauseWithheld = active ? withheldReasonFor(actions, "pauseSeries") : null;
  const resumeWithheld = paused ? withheldReasonFor(actions, "resumeSeries") : null;
  const stopWithheld = stopped ? null : withheldReasonFor(actions, "stopSeries");
  return (
    <section aria-labelledby={headingId} data-slot="series-state-controls" data-series-state={state} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Heading id={headingId} className="font-heading text-base font-medium">
          {SERIES_GROUP_LEGEND}
        </Heading>
        <StatusBadge label={SERIES_STATE_LABELS[state]} tone={SERIES_STATE_TONES[state]} srPrefix={SERIES_STATUS_SR_PREFIX} />
      </div>
      <p className="text-sm text-pretty text-muted-foreground">{stateSentence}</p>
      <div className="flex min-w-0 flex-col gap-3">
        <ReviewedCommand<PauseSeriesPayload>
          label={PAUSE_LABEL}
          receiptHeading={PAUSE_RECEIPT_HEADING}
          narration={PAUSE_NARRATION}
          input={pauseInput}
          submit={async (input) => pauseSeries.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload })}
          admitted={active}
          withheldReason={pauseWithheld}
          onCheckResult={onCheckResult}
          fieldLabels={SERIES_COMMAND_FIELD_LABELS}
        />
        <ReviewedCommand<ResumeSeriesPayload>
          label={RESUME_LABEL}
          receiptHeading={RESUME_RECEIPT_HEADING}
          narration={RESUME_NARRATION}
          input={resumeInput}
          submit={async (input) => resumeSeries.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload })}
          admitted={paused}
          withheldReason={resumeWithheld}
          onCheckResult={onCheckResult}
          fieldLabels={SERIES_COMMAND_FIELD_LABELS}
        />
        <ReviewedCommand<StopSeriesPayload>
          label={STOP_LABEL}
          receiptHeading={STOP_RECEIPT_HEADING}
          narration={STOP_NARRATION}
          input={stopInput}
          submit={async (input) => stopSeries.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload })}
          admitted={!stopped}
          withheldReason={stopWithheld}
          onCheckResult={onCheckResult}
          fieldLabels={SERIES_COMMAND_FIELD_LABELS}
          confirmation={{
            title: STOP_CONFIRM_TITLE,
            confirmLabel: STOP_CONFIRM_LABEL,
            description: (
              <>
                <span>{STOP_CONFIRM_KEEPS_WORK}</span>
                <span>{STOP_CONFIRM_IS_FINAL}</span>
              </>
            ),
          }}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The record body this surface opens into
// ---------------------------------------------------------------------------------------------

export interface OccurrenceActionsProps {
  /** One series read's envelope: the scope, revision and actions the service published with the series. */
  readonly envelope: SeriesReadEnvelope;
  /** The explicit boundary a prospective revision takes effect from. Defaults to the read's own planning-zone today, never a date computed here. */
  readonly effectiveFrom?: string | null;
  readonly onCheckResult?: (() => void) | undefined;
  /** Where the worker goes when this series has no date to answer and the work still exists as ordinary work. */
  readonly onOpenComposer?: (() => void) | undefined;
  readonly className?: string;
}

/** The series detail body: the shared record body, the occurrence group and the series-state group, in that order. */
export default function OccurrenceActions({ envelope, effectiveFrom = null, onCheckResult, onOpenComposer, className }: OccurrenceActionsProps): ReactElement {
  const series = envelope.data;
  const boundary = effectiveFrom ?? series.today;
  const planReview = series.planReview;
  const needsReview = planReview.state === "needs-review";
  const missedId = useId();
  return (
    <RecordDetail
      layout="page"
      className={className}
      breadcrumb={[{ label: WORK_LIST_LABEL, href: WORK_ROUTE }]}
      identity={{ displayName: series.title, secondaryName: REPEAT_PROFILE_LABELS[series.rule.profile], kind: RECORD_KIND, reference: envelope.source }}
      status={<StatusBadge label={SERIES_STATE_LABELS[series.state]} tone={SERIES_STATE_TONES[series.state]} srPrefix={SERIES_STATUS_SR_PREFIX} />}
      sections={{
        openTasks: (
          <div className="flex min-w-0 flex-col gap-4">
            {needsReview ? (
              <Alert>
                <AlertTitle>{PLAN_NEEDS_REVIEW_HEADING}</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <p>{PLAN_NEEDS_REVIEW_EXPLANATION}</p>
                  <p>
                    Dates that passed with no action: <bdi className="tabular-figures">{String(planReview.missedDateCount)}</bdi>.
                  </p>
                  <p id={missedId}>{"The plan's own review applies one of these:"}</p>
                  <ul aria-labelledby={missedId} className="flex min-w-0 list-disc flex-col gap-1 ps-5">
                    {MISSED_PLAN_RESOLUTION_ORDER.map((resolution) => (
                      <li key={resolution}>{MISSED_PLAN_RESOLUTION_LABELS[resolution]}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <OccurrenceCommands scope={envelope.scope} series={series} revision={envelope.revision} actions={envelope.actions} effectiveFrom={boundary} onCheckResult={onCheckResult} onOpenComposer={onOpenComposer} />
            <Separator />
            <SeriesStateControls scope={envelope.scope} seriesId={series.seriesId} revision={envelope.revision} state={series.state} actions={envelope.actions} onCheckResult={onCheckResult} headingLevel={3} />
          </div>
        ),
      }}
    />
  );
}
