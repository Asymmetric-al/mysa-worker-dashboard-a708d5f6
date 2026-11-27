"use client";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import type { ZodError } from "zod";
import { mayReplay, useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import { FactList, type FactSpec } from "@/components/fact-list";
import { fieldErrorsFromInvalid, FormErrorSummary, FormField, type FieldErrorLookup } from "@/components/form-field";
import RecordDetail, { type RecordDetailSectionSlots } from "@/components/record-detail";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationInput, ReadAction, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome, reads } from "@/modules/data-service";
import { parseCivilDate, type CivilDate } from "@/modules/time/civil";
import type { DisclosedMonthDayResolution } from "@/modules/time/recurrence";
import {
  MISSED_PLAN_RESOLUTION_LABELS,
  MISSED_PLAN_RESOLUTION_ORDER,
  ONE_SUCCESSOR_NOTE,
  PAUSED_NOTE,
  PLAN_NEEDS_REVIEW_EXPLANATION,
  PLAN_NEEDS_REVIEW_HEADING,
  SERIES_STATE_LABELS,
  SKIPPED_MEANS_NOT_PERFORMED_NOTE,
  STOPPED_NOTE,
  STOP_REVIEW_CHOICE_SENTENCE,
  STOP_REVIEW_NOT_RESUMABLE_SENTENCE,
  UNFINISHED_WORK_HINTS,
  UNFINISHED_WORK_LABELS,
  UNFINISHED_WORK_LEGEND,
  UNFINISHED_WORK_VALUES,
  type UnfinishedWork,
} from "../copy/missed-dates";
import {
  DAY_OF_MONTH_LABEL,
  END_CONDITION_LABELS,
  END_COUNT_LABEL,
  END_DATE_LABEL,
  FIRST_DUE_DATE_LABEL,
  INTERVAL_LABEL,
  MISSING_MONTHLY_DAY_DISCLOSURE,
  ONGOING_POLICY_END_STATEMENT,
  PLANNING_TIME_ZONE_LABEL,
  PLANNING_TIME_ZONE_NOTE,
  REPEAT_PROFILE_DESCRIPTIONS,
  REPEAT_PROFILE_FIELDS,
  REPEAT_PROFILE_LABELS,
  REPEAT_PROFILE_ORDER,
  SINGLE_ACTIONABLE_OCCURRENCE_NOTE,
  repeatRuleLabel,
} from "../copy/repeat-profiles";
import { CATEGORY_LABEL, COMPLETION_MEANS_NOTHING_NOTE, DUE_DATE_LABEL, PLANNED_VERSUS_HELD_NOTE, TASK_KIND_LABELS, TASK_STATUS_LABELS, UNDATED_LABEL } from "../copy/task-status";
import { editOccurrenceSchema, skipOccurrenceSchema, type EditOccurrencePayload, type SkipOccurrencePayload } from "../schemas/occurrence";
import { editThisAndFutureSchema, endPayloadOf, pauseSeriesSchema, resumeSeriesSchema, statedNumber, stopSeriesSchema, type EditThisAndFuturePayload, type PauseSeriesPayload, type ResumeSeriesPayload, type StopSeriesPayload } from "../schemas/series";
import { completeTaskSchema, type CompleteTaskPayload } from "../schemas/task";
import { useSeriesMutations } from "../hooks/use-series-mutations";
import { SelectItem } from "@/components/ui/select";
import { prospectiveRevisionBoundary } from "../series-revision-boundary";
import { useTaskMutations } from "../hooks/use-task-mutations";
import PlanNeedsReviewPanel, { type PlanNeedsReviewFacts } from "./plan-needs-review-panel";
import { BoundField, FormChoiceGroup, FormReceipt, FormSelectField, FormStyledSelectField, refusalLookupOf, type TextSpec } from "./reviewed-form";
import SeriesPreview, { type SeriesPreviewReading } from "./series-preview";
import { StatedInstant } from "./stated-instant";
type SeriesReadEnvelope = Extract<Awaited<ReturnType<typeof reads.series.readSeries>>, { readonly kind: "envelope" }>["envelope"];
type SeriesView = SeriesReadEnvelope["data"];
type SeriesOccurrence = NonNullable<SeriesView["currentOccurrence"]>;
type SeriesStateName = keyof typeof SERIES_STATE_LABELS;
type SeriesEndKind = SeriesView["rule"]["end"]["kind"];
type SeriesGroupHeadingLevel = 2 | 3 | 4;
const SERIES_STATUS_SR_PREFIX = "Plan status";
const PLANNED_TIME_PREFIX = "Scheduled time";
const END_OF_SERIES_LABEL = "Ends";
const PREVIEW_DATES_NOTE = "Dates follow this plan’s time zone. Only the active date can be completed or skipped — future dates are shown as a preview.";
const SERIES_STATE_TONES: Readonly<Record<SeriesStateName, StatusTone>> = { active: "positive", paused: "caution", stopped: "neutral" };
const GROUP_HEADING_TAG: Readonly<Record<SeriesGroupHeadingLevel, "h2" | "h3" | "h4">> = { 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's heading utility per level, so a group heading states the level its caller renders it at with the same measure on every surface. */ const GROUP_HEADING_SCALE: Readonly<Record<SeriesGroupHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const COMMANDS = {
  complete: { label: "Complete", receiptHeading: "Completed occurrence" },
  skip: { label: "Skip", receiptHeading: "Skipped occurrence" },
  editOccurrence: { label: "Edit this occurrence", receiptHeading: "Updated occurrence" },
  editFuture: { label: "Edit this and future", receiptHeading: "Updated repeating plan" },
  pause: { label: "Pause", receiptHeading: "Paused plan", narration: "Temporarily holds future dates without completing any tasks." },
  resume: { label: "Resume", receiptHeading: "Resumed plan", narration: "Restarts scheduling the next date on this plan." },
  stop: { label: "Stop", receiptHeading: "Stopped plan", narration: "Permanently ends this repeating plan (cannot be resumed)." },
  applyOccurrence: { label: "Save this occurrence" },
  applyRevision: { label: "Save changes" },
  stopConfirm: { label: "Stop plan" },
  composer: { label: "Add as one-off task" },
  cancel: { label: "Cancel" },
} as const;
const COMMAND_BUTTON_CLASS = "min-h-8 max-w-full whitespace-normal";
const GROUP_LEGENDS = { occurrence: "Current occurrence", series: "Plan controls", preview: "Schedule & upcoming dates", noDate: "None active" } as const;
const OCCURRENCE_ABSENT = { heading: "No active occurrence right now", body: "There isn’t an open occurrence awaiting action on this plan right now." } as const;
const EFFECTIVE_BOUNDARY_LABEL = "Takes effect from";
const OCCURRENCE_FORM = { heading: "Edit this occurrence", note: "Updates only this single date without changing the rest of the repeating schedule." } as const;
const REVISION_FORM = { heading: "Update future occurrences", note: "Applies from the date above onward — earlier dates and completed history stay unchanged." } as const;
const FORM_REFUSAL = { title: "Please check these details", description: "Nothing was saved yet — fix the highlighted fields and try again." } as const;
const SERVICE_REFUSAL = { title: "Please check these details", description: "Fix the highlighted fields and try again." } as const;
const SERIES_COMMAND_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { seriesId: "Series", unfinishedWork: UNFINISHED_WORK_LEGEND };
const UNFINISHED_WORK_OPTIONS: readonly { readonly value: string; readonly label: string; readonly hint?: string }[] = UNFINISHED_WORK_VALUES.map((value) => ({ value, label: UNFINISHED_WORK_LABELS[value], hint: UNFINISHED_WORK_HINTS[value] }));
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
const withheldReasonFor = (actions: readonly ReadAction[], name: string): string | null => {
  const published = actions.find((candidate) => candidate.name === name);
  const reason = published === undefined || published.available ? "" : (published.reason?.trim() ?? "");
  return reason === "" ? null : reason;
};
type Judgement<T> = { readonly parsed: T } | { readonly refused: ZodError };
const judged = <T,>(checked: { readonly success: true; readonly data: T } | { readonly success: false; readonly error: ZodError }): Judgement<T> => (checked.success ? { parsed: checked.data } : { refused: checked.error });
type ReceiptCallback = (() => void) | undefined;
const onCheckOf = (outcome: MutationOutcome, onCheckResult: ReceiptCallback): ReceiptCallback => (outcome.outcome === "unknown" ? onCheckResult : undefined);
const replayOf = (outcome: MutationOutcome, retry: () => Promise<unknown>): ReceiptCallback => (mayReplay(outcome) ? () => void retry() : undefined);
const reapplyOf = (outcome: MutationOutcome, reapply: () => Promise<unknown>): ReceiptCallback => (outcome.outcome === "conflict" ? () => void reapply() : undefined);
function plannedTimeFieldValue(occurrence: SeriesOccurrence): string {
  const stored = occurrence.plannedTime?.trim() ?? "";
  return stored === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(stored) ? stored : /^([01]\d|2[0-3]):[0-5]\d$/u.test(stored) && occurrence.dueOn !== null ? `${occurrence.dueOn}T${stored}` : "";
}
const previewReadingOf = (series: SeriesView): SeriesPreviewReading | null => {
  if (series.preview.status !== "preview") return null;
  const current = series.currentOccurrence;
  const actionableId = series.actionableOccurrenceId;
  if (actionableId === null || current === null || current.taskId !== actionableId || current.dueOn === null) return null;
  const actionableDueOn = parseCivilDate(current.dueOn);
  if (actionableDueOn.status !== "parsed") return null;
  const dates: CivilDate[] = [];
  for (const stored of series.preview.dates) {
    const parsed = parseCivilDate(stored);
    if (parsed.status !== "parsed") return null;
    dates.push(parsed.date);
  }
  const monthDayResolutions: DisclosedMonthDayResolution[] = [];
  for (const resolution of series.preview.monthDayResolutions) {
    const parsed = parseCivilDate(resolution.dueOn);
    if (parsed.status !== "parsed") return null;
    monthDayResolutions.push({ dueOn: parsed.date, requestedDay: resolution.requestedDay, resolvedDay: resolution.resolvedDay });
  }
  return { status: "preview", dates, actionableOccurrenceId: actionableId, actionableDueOn: actionableDueOn.date, monthDayResolutions };
};
interface ReviewedCommandProps<P extends object> {
  readonly label: string;
  readonly variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  readonly receiptHeading: string;
  readonly narration: ReactNode;
  readonly input: Omit<MutationInput<P>, "operationId">;
  readonly submit: MutationSubmit<P>;
  readonly withheldReason?: string | null;
  readonly admitted?: boolean;
  readonly confirmation?: { readonly title: string; readonly description: ReactNode; readonly confirmLabel: string; readonly controls?: ReactNode };
  readonly onCheckResult?: (() => void) | undefined;
  readonly fieldLabels?: Readonly<Record<string, string | undefined>> | undefined;
  readonly className?: string;
}
function ReviewedCommand<P extends object>({ label, variant = "outline", receiptHeading, narration, input, submit, withheldReason = null, admitted = true, confirmation, onCheckResult, fieldLabels, className }: ReviewedCommandProps<P>): ReactElement {
  const { pending, outcome, submit: dispatch, retry, reapply } = useReviewedMutation<P>(submit);
  const [confirming, setConfirming] = useState(false);
  const narrationId = useId();
  const disabled = pending || withheldReason !== null || !admitted;
  const run = (): void => void dispatch(input);
  const confirm = (): void => {
    setConfirming(false);
    run();
  };
  return (
    <div data-slot="occurrence-command" data-command={label} aria-busy={pending ? true : undefined} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {confirmation === undefined ? (
          <Button {...{ type: "button", variant, size: "sm", disabled, "aria-describedby": narrationId, className: COMMAND_BUTTON_CLASS, onClick: run }}>{label}</Button>
        ) : (
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" disabled={disabled} aria-describedby={narrationId} className={COMMAND_BUTTON_CLASS} />}>{label}</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
                <AlertDialogDescription className="flex flex-col gap-2">{confirmation.description}</AlertDialogDescription>
              </AlertDialogHeader>
              {confirmation.controls === undefined ? null : confirmation.controls}
              <AlertDialogFooter>
                <AlertDialogCancel>{COMMANDS.cancel.label}</AlertDialogCancel>
                <AlertDialogAction confirmVariant="destructive" onClick={confirm}>
                  {confirmation.confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <p id={narrationId} className="min-w-0 flex-1 basis-56 type-supporting text-pretty">
          {narration}
        </p>
      </div>
      {withheldReason === null ? null : <p className="type-supporting text-pretty">{withheldReason}</p>}
      {pending ? <output className="block type-supporting">{`${label}: working. Nothing else is submitted while this one is in flight.`}</output> : null}
      {outcome === null ? null : <FormReceipt outcome={outcome} heading={receiptHeading} headingLevel={4} dataSlot="occurrence-command-result" onCheckResult={onCheckOf(outcome, onCheckResult)} onRetrySameWork={replayOf(outcome, retry)} onReapply={reapplyOf(outcome, reapply)} fieldLabels={fieldLabels} />}
    </div>
  );
}
/** The end the read resolved, in the shape it resolved to: a date, a count, or the qualified ongoing-personal-series policy, which states it has no end rather than reading as a plan whose end was left blank. */ function SeriesEndValue({ end }: { readonly end: SeriesView["rule"]["end"] }): ReactElement {
  if (end.kind === "ongoing-personal-policy") return <span>{ONGOING_POLICY_END_STATEMENT}</span>;
  const stated: string = end.kind === "on-date" ? END_DATE_LABEL : END_COUNT_LABEL;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="text-muted-foreground">{`${stated}:`}</span>
      {end.kind === "on-date" ? <StatedInstant iso={end.on} className="tabular-figures" /> : <bdi className="tabular-figures">{String(end.count)}</bdi>}
    </span>
  );
}
/** The plan's own rule, stated from the read before the dates that rule produces: the rule in force is a fact whether the plan is active, paused or stopped. */ function PlanRuleFacts({ rule }: { readonly rule: SeriesView["rule"] }): ReactElement {
  const facts: readonly FactSpec[] = [
    { term: FIRST_DUE_DATE_LABEL, value: <StatedInstant iso={rule.firstDueOn} className="tabular-figures" /> },
    { term: END_OF_SERIES_LABEL, value: <SeriesEndValue end={rule.end} /> },
  ];
  return <FactList className="flex min-w-0 flex-col gap-1.5 type-body sm:flex-row sm:gap-x-6" facts={facts} />;
}
function OccurrenceFacts({ occurrence }: { readonly occurrence: SeriesOccurrence }): ReactElement {
  const category = occurrence.category?.trim() ?? "";
  const plannedTime = occurrence.kind === "meeting" ? occurrence.plannedTime : null;
  const facts: readonly FactSpec[] = [
    { term: DUE_DATE_LABEL, value: occurrence.dueOn === null ? UNDATED_LABEL : <StatedInstant iso={occurrence.dueOn} className="tabular-figures" /> },
    { term: "Kind", value: <Badge variant="outline">{TASK_KIND_LABELS[occurrence.kind]}</Badge> },
    ...(plannedTime === null
      ? []
      : [
          {
            term: PLANNED_TIME_PREFIX,
            valueClassName: "flex min-w-0 flex-col gap-1",
            value: (
              <>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <bdi className="tabular-figures">{plannedTime}</bdi>
                  {occurrence.timeZone === null ? null : <bdi className="min-w-0 text-muted-foreground">{occurrence.timeZone}</bdi>}
                </span>
                <span className="type-supporting text-pretty">{PLANNED_VERSUS_HELD_NOTE}</span>
              </>
            ),
          },
        ]),
    ...(category === "" ? [] : [{ term: CATEGORY_LABEL, valueClassName: "min-w-0 wrap-anywhere", value: <bdi>{category}</bdi> }]),
  ];
  return <FactList className="flex min-w-0 flex-col gap-1.5 type-body" facts={facts} />;
}
interface CommandFormProps<Text extends string, Draft extends Readonly<Record<Text, string>>, Payload extends object> {
  readonly slot: string;
  readonly heading: string;
  readonly note: string;
  readonly preamble?: ReactNode;
  readonly applyLabel: string;
  readonly receiptHeading: string;
  readonly fieldLabels: Readonly<Record<string, string | undefined>>;
  readonly fieldOrder: readonly string[];
  readonly initialDraft: Draft;
  readonly input: (payload: Payload) => Omit<MutationInput<Payload>, "operationId">;
  readonly submit: MutationSubmit<Payload>;
  readonly judge: (payload: Payload) => { readonly parsed: Payload } | { readonly refused: ZodError };
  readonly compose: (draft: Draft) => Payload;
  readonly onClose: () => void;
  readonly onCheckResult?: (() => void) | undefined;
  readonly children: (draft: Draft, edit: (name: Text, value: string) => void, errors: FieldErrorLookup | null, update: (patch: Partial<Draft>) => void) => ReactNode;
}
function CommandForm<Text extends string, Draft extends Readonly<Record<Text, string>>, Payload extends object>(props: CommandFormProps<Text, Draft, Payload>): ReactElement {
  const { slot, heading, note, preamble, applyLabel, receiptHeading, fieldLabels, fieldOrder, initialDraft, input, submit, judge, compose, onClose, onCheckResult, children } = props;
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const { pending, outcome, submit: dispatch, retry, reapply } = useReviewedMutation<Payload>(submit);
  // The refusal the summary states comes from one of two sources, and they report different outcomes: the form's own refusal
  // never left this browser, while a service `invalid` outcome is a change that was sent and came back refused with the fields it names, so each states its own outcome rather than sharing a sentence that claims nothing was sent.
  const refusal: { readonly errors: FieldErrorLookup; readonly copy: typeof FORM_REFUSAL | typeof SERVICE_REFUSAL } | null = errors !== null ? { errors, copy: FORM_REFUSAL } : outcome !== null && outcome.outcome === "invalid" ? { errors: fieldErrorsFromInvalid(outcome), copy: SERVICE_REFUSAL } : null;
  const shown = refusal === null ? null : refusal.errors;
  const refusalCopy = refusal === null ? FORM_REFUSAL : refusal.copy;
  const update = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));
  const edit = (name: Text, value: string): void => setDraft((current) => ({ ...current, [name]: value }));
  const submitDraft = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const judged = judge(compose(draft));
    if ("refused" in judged) return setErrors(refusalLookupOf(judged.refused));
    setErrors(null);
    void dispatch(input(judged.parsed));
  };
  return (
    <Card size="sm" data-slot={slot} aria-busy={pending ? true : undefined} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h4 className="type-group-title">{heading}</h4>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate className="flex min-w-0 flex-col gap-3" onSubmit={submitDraft}>
          <p className="type-supporting text-pretty">{note}</p>
          {preamble}
          <FormErrorSummary errors={shown} labels={fieldLabels} order={fieldOrder} title={refusalCopy.title} description={refusalCopy.description} headingLevel={4} />
          {children(draft, edit, shown, update)}
          <div className="flex flex-wrap items-center gap-2">
            <Button {...{ type: "submit", size: "sm", disabled: pending, className: COMMAND_BUTTON_CLASS }}>{applyLabel}</Button>
            <Button {...{ type: "button", variant: "outline", size: "sm", className: COMMAND_BUTTON_CLASS, onClick: onClose }}>{COMMANDS.cancel.label}</Button>
          </div>
          {pending ? <output className="block type-supporting">{`${applyLabel}: working. Nothing else is submitted while this one is in flight.`}</output> : null}
          {outcome === null ? null : <FormReceipt outcome={outcome} heading={receiptHeading} headingLevel={4} dataSlot="occurrence-command-result" onCheckResult={onCheckOf(outcome, onCheckResult)} onRetrySameWork={replayOf(outcome, retry)} onReapply={reapplyOf(outcome, reapply)} fieldLabels={fieldLabels} />}
        </form>
      </CardContent>
    </Card>
  );
}
type OccurrenceText = "title" | "category" | "dueOn" | "plannedTime" | "timeZone" | "note";
type OccurrenceDraft = Readonly<Record<OccurrenceText, string>> & { readonly kind: keyof typeof TASK_KIND_LABELS };
const OCCURRENCE_FIELDS: Readonly<Record<OccurrenceText, TextSpec<OccurrenceText>>> = {
  title: { name: "title", label: "Title", mark: "required", type: "text", autoComplete: "off" },
  dueOn: { name: "dueOn", label: DUE_DATE_LABEL, description: "A due date is a calendar date, so it stays that day wherever you are.", mark: "required", type: "date" },
  plannedTime: { name: "plannedTime", label: PLANNED_TIME_PREFIX, mark: "optional", type: "datetime-local" },
  timeZone: { name: "timeZone", label: PLANNING_TIME_ZONE_LABEL, description: PLANNED_VERSUS_HELD_NOTE, mark: "optional", type: "text", autoComplete: "off" },
  category: { name: "category", label: CATEGORY_LABEL, mark: "optional", type: "text", autoComplete: "off" },
  note: { name: "note", label: "Note", mark: "optional", type: "text" },
};
function OccurrenceEditForm({ scope, occurrence, onClose, onCheckResult }: { readonly scope: Scope; readonly occurrence: SeriesOccurrence; readonly onClose: () => void; readonly onCheckResult?: (() => void) | undefined }): ReactElement {
  const { editOccurrence } = useSeriesMutations(scope);
  const draft: OccurrenceDraft = { title: occurrence.title, category: occurrence.category ?? "", dueOn: occurrence.dueOn ?? "", plannedTime: plannedTimeFieldValue(occurrence), timeZone: occurrence.timeZone ?? "", note: occurrence.note ?? "", kind: occurrence.kind };
  return (
    <CommandForm<OccurrenceText, OccurrenceDraft, EditOccurrencePayload>
      slot="occurrence-edit-form"
      heading={OCCURRENCE_FORM.heading}
      note={OCCURRENCE_FORM.note}
      applyLabel={COMMANDS.applyOccurrence.label}
      receiptHeading={COMMANDS.editOccurrence.receiptHeading}
      fieldLabels={OCCURRENCE_FIELD_LABELS}
      fieldOrder={["dueOn", "kind", "plannedTime", "timeZone", "title"]}
      initialDraft={draft}
      compose={(values) => {
        const meeting = values.kind === "meeting";
        const { title, category, dueOn, kind, plannedTime, timeZone, note } = values;
        return { occurrenceId: occurrence.taskId, title, category, dueOn, kind, ...(meeting && plannedTime.trim() !== "" ? { plannedTime } : {}), ...(meeting && timeZone.trim() !== "" ? { timeZone } : {}), note };
      }}
      judge={(payload) => judged(editOccurrenceSchema.safeParse(payload))}
      input={(payload) => ({ scope, expectedRevision: occurrence.revision, payload })}
      submit={editOccurrence.mutateAsync}
      onClose={onClose}
      onCheckResult={onCheckResult}
    >
      {(values, edit, errors) => {
        const order: readonly OccurrenceText[] = values.kind === "meeting" ? ["title", "dueOn", "plannedTime", "timeZone", "category"] : ["title", "dueOn", "category"];
        return (
          <>
            {order.map((key) => (
              <BoundField key={key} spec={OCCURRENCE_FIELDS[key]} values={values} errors={errors} onEdit={edit} />
            ))}
            <FormField name="note" label="Note" optionalHint error={errors?.byField["note"]}>
              {(control) => <Textarea id={control.id} name="note" rows={3} value={values.note} onChange={(event) => edit("note", event.currentTarget.value)} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} aria-required={control.required ? true : undefined} />}
            </FormField>
          </>
        );
      }}
    </CommandForm>
  );
}
type RevisionText = "title" | "planningTimeZone" | "interval" | "dayOfMonth" | "endOn" | "endCount";
type RevisionDraft = Readonly<Record<RevisionText, string>> & { readonly profile: keyof typeof REPEAT_PROFILE_LABELS; readonly endKind: SeriesEndKind };
const REVISION_FIELDS: Readonly<Record<RevisionText, TextSpec<RevisionText>>> = {
  title: { name: "title", label: "Title", mark: "required", type: "text", autoComplete: "off" },
  planningTimeZone: { name: "planningTimeZone", label: PLANNING_TIME_ZONE_LABEL, description: PLANNING_TIME_ZONE_NOTE, mark: "required", type: "text", autoComplete: "off" },
  interval: { name: "interval", label: INTERVAL_LABEL, mark: "required", type: "number", min: 1, step: 1 },
  dayOfMonth: { name: "dayOfMonth", label: DAY_OF_MONTH_LABEL, description: MISSING_MONTHLY_DAY_DISCLOSURE, mark: "required", type: "number", min: 1, max: 31, step: 1 },
  endOn: { name: "endOn", controlName: "end.on", label: END_DATE_LABEL, mark: "required", type: "date" },
  endCount: { name: "endCount", controlName: "end.count", label: END_COUNT_LABEL, mark: "required", type: "number", min: 1, step: 1 },
};
const admittedOf = <T extends string>(order: readonly T[], value: string, fallback: T): T => order.find((member) => member === value) ?? fallback;
const revisionDraftOf = ({ title, rule }: SeriesView): RevisionDraft => {
  const { end } = rule;
  return { title, planningTimeZone: rule.planningTimeZone, profile: rule.profile, interval: String(rule.interval), dayOfMonth: rule.dayOfMonth === null ? "" : String(rule.dayOfMonth), endKind: end.kind, endOn: end.kind === "on-date" ? end.on : "", endCount: end.kind === "after-count" ? String(end.count) : "" };
};
function FutureRevisionForm({ scope, series, revision, effectiveFrom, onClose, onCheckResult }: { readonly scope: Scope; readonly series: SeriesView; readonly revision: string; readonly effectiveFrom: string; readonly onClose: () => void; readonly onCheckResult?: (() => void) | undefined }): ReactElement {
  const { editThisAndFuture } = useSeriesMutations(scope);
  return (
    <CommandForm<RevisionText, RevisionDraft, EditThisAndFuturePayload>
      slot="series-revision-form"
      heading={REVISION_FORM.heading}
      note={REVISION_FORM.note}
      preamble={
        <>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
            <span className="text-muted-foreground">{EFFECTIVE_BOUNDARY_LABEL}</span>
            <StatedInstant iso={effectiveFrom} className="tabular-figures" />
          </p>
          <p className="type-supporting text-pretty">{"This is a prospective revision: the dates before that boundary keep the rule they were planned under, and completed history is untouched."}</p>
        </>
      }
      applyLabel={COMMANDS.applyRevision.label}
      receiptHeading={COMMANDS.editFuture.receiptHeading}
      fieldLabels={REVISION_FIELD_LABELS}
      fieldOrder={["planningTimeZone", "profile", "interval", "dayOfMonth", "end", "effectiveFrom", "title"]}
      initialDraft={revisionDraftOf(series)}
      compose={(values) => {
        const fields = REPEAT_PROFILE_FIELDS[values.profile];
        return {
          seriesId: series.seriesId,
          effectiveFrom,
          title: values.title,
          category: undefined,
          note: undefined,
          planningTimeZone: values.planningTimeZone,
          profile: values.profile,
          ...(fields.includes("interval") ? { interval: statedNumber(values.interval) } : {}),
          ...(fields.includes("dayOfMonth") ? { dayOfMonth: statedNumber(values.dayOfMonth) } : {}),
          end: endPayloadOf(values.endKind, values.endOn, values.endCount),
        };
      }}
      judge={(payload) => judged(editThisAndFutureSchema.safeParse(payload))}
      input={(payload) => ({ scope, expectedRevision: revision, payload })}
      submit={editThisAndFuture.mutateAsync}
      onClose={onClose}
      onCheckResult={onCheckResult}
    >
      {(values, edit, errors, update) => (
        <>
          <BoundField spec={REVISION_FIELDS.title} values={values} errors={errors} onEdit={edit} />
          <BoundField spec={REVISION_FIELDS.planningTimeZone} values={values} errors={errors} onEdit={edit} />
          <FormStyledSelectField {...{ name: "profile", label: "Repeat", mark: "required", errors, value: values.profile, items: REPEAT_PROFILE_LABELS, onValueChange: (profile: string) => update({ profile: admittedOf(REPEAT_PROFILE_ORDER, profile, "none") }) }}>
            {REPEAT_PROFILE_ORDER.map((profile) => (
              <SelectItem key={profile} value={profile}>
                {REPEAT_PROFILE_LABELS[profile]}
              </SelectItem>
            ))}
          </FormStyledSelectField>
          <p className="type-supporting text-pretty">{REPEAT_PROFILE_DESCRIPTIONS[values.profile]}</p>
          {REPEAT_PROFILE_FIELDS[values.profile].includes("interval") ? <BoundField spec={REVISION_FIELDS.interval} values={values} errors={errors} onEdit={edit} /> : null}
          {REPEAT_PROFILE_FIELDS[values.profile].includes("dayOfMonth") ? <BoundField spec={REVISION_FIELDS.dayOfMonth} values={values} errors={errors} onEdit={edit} /> : null}
          <FormSelectField {...{ name: "end", label: END_OF_SERIES_LABEL, mark: "required", errors, value: values.endKind, onValueChange: (endKind) => update({ endKind: admittedOf(END_KIND_ORDER, endKind, "on-date") }) }}>
            {END_KIND_ORDER.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {END_CONDITION_LABELS[kind]}
              </NativeSelectOption>
            ))}
          </FormSelectField>
          {values.endKind === "on-date" ? <BoundField spec={REVISION_FIELDS.endOn} values={values} errors={errors} onEdit={edit} /> : null}
          {values.endKind === "after-count" ? <BoundField spec={REVISION_FIELDS.endCount} values={values} errors={errors} onEdit={edit} /> : null}
        </>
      )}
    </CommandForm>
  );
}
/** One group's heading and the state badge beside it, so the three groups on a series body share one heading frame. */
function GroupHeading({ heading, headingId, label, badge }: { readonly heading: SeriesGroupHeadingLevel; readonly headingId: string; readonly label: ReactNode; readonly badge: ReactNode }): ReactElement {
  const Heading = GROUP_HEADING_TAG[heading];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Heading {...{ id: headingId, className: GROUP_HEADING_SCALE[heading] }}>{label}</Heading>
      {badge}
    </div>
  );
}
const EDIT_TOGGLES = [
  { key: "occurrence", ...COMMANDS.editOccurrence, narration: "Changes only this single date without altering the repeating schedule." },
  { key: "future", ...COMMANDS.editFuture, narration: "Updates the schedule from this date onward while keeping past history intact." },
] as const;
type OccurrenceCommandsProps = { readonly scope: Scope; readonly series: SeriesView; readonly revision: string; readonly actions: readonly ReadAction[]; readonly effectiveFrom: string | null; readonly onCheckResult?: (() => void) | undefined; readonly onOpenComposer?: (() => void) | undefined };
function OccurrenceCommands({ scope, series, revision, actions, effectiveFrom, onCheckResult, onOpenComposer }: OccurrenceCommandsProps): ReactElement {
  const headingId = useId();
  const formId = useId();
  const router = useRouter();
  const { completeTask } = useTaskMutations(scope);
  const { skipOccurrence } = useSeriesMutations(scope);
  const [editing, setEditing] = useState<"none" | "occurrence" | "future">("none");
  const occurrenceToggleRef = useRef<HTMLButtonElement | null>(null);
  const futureToggleRef = useRef<HTMLButtonElement | null>(null);
  const closeEditing = (toggle: RefObject<HTMLButtonElement | null>): void => {
    setEditing("none");
    toggle.current?.focus();
  };
  const actionable = series.actionableOccurrenceId !== null && series.currentOccurrence !== null && series.currentOccurrence.taskId === series.actionableOccurrenceId ? series.currentOccurrence : null;
  if (actionable === null) {
    const absentReason = withheldReasonFor(actions, "skipOccurrence") ?? withheldReasonFor(actions, "editOccurrence");
    return (
      <section aria-labelledby={headingId} data-slot="occurrence-actions" data-occurrence="absent" className="flex min-w-0 flex-col gap-3">
        <GroupHeading heading={3} headingId={headingId} label={GROUP_LEGENDS.occurrence} badge={<Badge variant="outline">{GROUP_LEGENDS.noDate}</Badge>} />
        <Alert>
          <AlertTitle>{OCCURRENCE_ABSENT.heading}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{OCCURRENCE_ABSENT.body}</p>
            {absentReason === null ? null : <p>{absentReason}</p>}
            <p>{SINGLE_ACTIONABLE_OCCURRENCE_NOTE}</p>
          </AlertDescription>
        </Alert>
        {onOpenComposer === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <Button {...{ type: "button", variant: "outline", size: "sm", className: COMMAND_BUTTON_CLASS, onClick: onOpenComposer }}>{COMMANDS.composer.label}</Button>
            <p className="min-w-0 flex-1 basis-56 type-supporting text-pretty">{"That creates an ordinary task rather than a date on this series, so this plan stays exactly as it is."}</p>
          </div>
        )}
      </section>
    );
  }
  const both = { scope, expectedRevision: actionable.revision };
  const withheld = {
    complete: withheldReasonFor(actionable.actions, "completeTask"),
    skip: withheldReasonFor(actions, "skipOccurrence"),
    occurrence: withheldReasonFor(actions, "editOccurrence"),
    future: effectiveFrom === null ? "This series states no boundary a prospective change could take effect from, so nothing is revised here." : withheldReasonFor(actions, "editThisAndFuture"),
  };
  const completeInput = { ...both, payload: completeTaskSchema.parse({ taskId: actionable.taskId }) };
  const skipInput = { ...both, payload: skipOccurrenceSchema.parse({ occurrenceId: actionable.taskId }) };
  // Completing the date is the one command on this body that is not a series mutation, so it does not settle through the
  // series hook's own re-read: the re-read is asked for here, at the one place this body sends the completion, and only when the attempt applied, because `unchanged`, the refusals and an `unknown` attempt leave every read as it stands.
  const submitComplete = async (input: MutationInput<CompleteTaskPayload>): Promise<MutationOutcome> => {
    const outcome = await completeTask.mutateAsync({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
    if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") router.refresh();
    return outcome;
  };
  return (
    <section aria-labelledby={headingId} data-slot="occurrence-actions" data-occurrence="actionable" className="flex min-w-0 flex-col gap-3">
      <GroupHeading heading={3} headingId={headingId} label={GROUP_LEGENDS.occurrence} badge={<StatusBadge label={TASK_STATUS_LABELS[actionable.status]} tone="info" srPrefix="Date status" />} />
      <p className="min-w-0 type-group-title text-pretty wrap-anywhere">
        <bdi>{actionable.title}</bdi>{" "}
      </p>
      <OccurrenceFacts occurrence={actionable} />
      <ReviewedCommand<CompleteTaskPayload> {...COMMANDS.complete} variant="default" narration={COMPLETION_MEANS_NOTHING_NOTE} input={completeInput} submit={submitComplete} withheldReason={withheld.complete} onCheckResult={onCheckResult} fieldLabels={OCCURRENCE_FIELD_LABELS} />
      <ReviewedCommand<SkipOccurrencePayload> {...COMMANDS.skip} narration={SKIPPED_MEANS_NOT_PERFORMED_NOTE} input={skipInput} submit={skipOccurrence.mutateAsync} withheldReason={withheld.skip} onCheckResult={onCheckResult} fieldLabels={OCCURRENCE_FIELD_LABELS} />
      {EDIT_TOGGLES.map((toggle) => {
        const toggleRef = toggle.key === "occurrence" ? occurrenceToggleRef : futureToggleRef;
        const toggleReason = withheld[toggle.key];
        const onToggle = (): void => setEditing(editing === toggle.key ? "none" : toggle.key);
        return (
          <div key={toggle.key} className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <Button {...{ ref: toggleRef, type: "button", variant: "outline", size: "sm", className: COMMAND_BUTTON_CLASS, disabled: toggleReason !== null, "aria-expanded": editing === toggle.key, "aria-controls": editing === toggle.key ? formId : undefined, onClick: onToggle }}>{toggle.label}</Button>
              <p className="min-w-0 flex-1 basis-56 type-supporting text-pretty">{toggle.narration}</p>
            </div>
            {toggleReason === null ? null : <p className="type-supporting text-pretty">{toggleReason}</p>}
          </div>
        );
      })}
      <div id={formId} className="flex min-w-0 flex-col gap-3">
        {editing === "occurrence" ? <OccurrenceEditForm scope={scope} occurrence={actionable} onClose={() => closeEditing(occurrenceToggleRef)} onCheckResult={onCheckResult} /> : null}
        {editing === "future" && effectiveFrom !== null ? <FutureRevisionForm scope={scope} series={series} revision={revision} effectiveFrom={effectiveFrom} onClose={() => closeEditing(futureToggleRef)} onCheckResult={onCheckResult} /> : null}
      </div>
      <p className="type-supporting text-pretty">{ONE_SUCCESSOR_NOTE}</p>
    </section>
  );
}
export type SeriesStateControlsProps = {
  readonly scope: Scope;
  readonly seriesId: string;
  readonly revision: string;
  readonly state: SeriesStateName;
  readonly actions: readonly ReadAction[];
  readonly onCheckResult?: (() => void) | undefined;
  readonly headingLevel?: SeriesGroupHeadingLevel;
  readonly className?: string;
}; /** The one implementation of pause, resume and stop, so the series detail surface and the series editor share it rather than each writing their own. */
export function SeriesStateControls({ scope, seriesId, revision, state, actions, onCheckResult, headingLevel = 3, className }: SeriesStateControlsProps): ReactElement {
  const headingId = useId();
  const unfinishedWorkIdPrefix = useId();
  const { pauseSeries, resumeSeries, stopSeries } = useSeriesMutations(scope);
  const active = state === "active";
  const paused = state === "paused";
  const stopped = state === "stopped";
  const stateSentence = paused ? PAUSED_NOTE : stopped ? STOPPED_NOTE : SINGLE_ACTIONABLE_OCCURRENCE_NOTE;
  const pauseInput = { scope, expectedRevision: revision, payload: pauseSeriesSchema.parse({ seriesId }) };
  const resumeInput = { scope, expectedRevision: revision, payload: resumeSeriesSchema.parse({ seriesId }) };
  // Stopping states what becomes of the dates it leaves behind, so the two fates are both reachable here rather than one being decided by the service's default. The selection starts at the fate the schema itself defaults to, which is the same `keep` the service applies when the field is absent.
  const [unfinishedWork, setUnfinishedWork] = useState<UnfinishedWork>(() => stopSeriesSchema.parse({ seriesId }).unfinishedWork);
  const stopInput = { scope, expectedRevision: revision, payload: stopSeriesSchema.parse({ seriesId, unfinishedWork }) };
  const stopConfirmation = {
    title: "Stop this repeating plan?",
    confirmLabel: COMMANDS.stopConfirm.label,
    description: (
      <>
        <span>{STOP_REVIEW_CHOICE_SENTENCE}</span>
        <span>{STOP_REVIEW_NOT_RESUMABLE_SENTENCE}</span>
      </>
    ),
    controls: <FormChoiceGroup name="unfinishedWork" legend={UNFINISHED_WORK_LEGEND} errors={null} value={unfinishedWork} options={UNFINISHED_WORK_OPTIONS} onValueChange={(value) => setUnfinishedWork(admittedOf(UNFINISHED_WORK_VALUES, value, unfinishedWork))} idPrefix={unfinishedWorkIdPrefix} />,
  };
  return (
    <section aria-labelledby={headingId} data-slot="series-state-controls" data-series-state={state} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <GroupHeading heading={headingLevel} headingId={headingId} label={GROUP_LEGENDS.series} badge={<StatusBadge label={SERIES_STATE_LABELS[state]} tone={SERIES_STATE_TONES[state]} srPrefix={SERIES_STATUS_SR_PREFIX} />} />
      <p className="type-supporting text-pretty">{stateSentence}</p>
      <div className="flex min-w-0 flex-col gap-3">
        {/* A stopped plan offers no pause: stopping ends the plan for good, so its own read refuses a pause on it, and the badge and state sentence above already state that fate. */}
        {stopped ? null : <ReviewedCommand<PauseSeriesPayload> {...COMMANDS.pause} input={pauseInput} submit={pauseSeries.mutateAsync} admitted={active} withheldReason={active ? withheldReasonFor(actions, "pauseSeries") : null} onCheckResult={onCheckResult} fieldLabels={SERIES_COMMAND_FIELD_LABELS} />}
        <ReviewedCommand<ResumeSeriesPayload> {...COMMANDS.resume} input={resumeInput} submit={resumeSeries.mutateAsync} admitted={paused} withheldReason={paused ? withheldReasonFor(actions, "resumeSeries") : null} onCheckResult={onCheckResult} fieldLabels={SERIES_COMMAND_FIELD_LABELS} />
        <ReviewedCommand<StopSeriesPayload> {...COMMANDS.stop} input={stopInput} submit={stopSeries.mutateAsync} admitted={!stopped} withheldReason={stopped ? null : withheldReasonFor(actions, "stopSeries")} onCheckResult={onCheckResult} fieldLabels={SERIES_COMMAND_FIELD_LABELS} confirmation={stopConfirmation} />
      </div>
    </section>
  );
}
export type OccurrenceActionsProps = { readonly envelope: SeriesReadEnvelope; readonly displayLocale: string; readonly effectiveFrom?: string | null; readonly onCheckResult?: (() => void) | undefined; readonly onOpenComposer?: (() => void) | undefined; readonly className?: string };
/** The series detail body: the shared record body, the plan's own preview, the plan review, the occurrence group and the series-state group, in that order. */
export default function OccurrenceActions({ envelope, displayLocale, effectiveFrom = null, onCheckResult, onOpenComposer, className }: OccurrenceActionsProps): ReactElement {
  const series = envelope.data;
  // The revision this body offers is prospective, so the boundary it presents is the plan's own: the later of the plan's
  const boundary = effectiveFrom ?? prospectiveRevisionBoundary(series); // today and the latest rule boundary it carries. Today alone would hand a plan whose rule begins in the future a boundary its own engine refuses, and a change the worker genuinely made would settle as nothing.
  const needsReview = series.planReview.state === "needs-review";
  // The plan's review opens on the date this read names as awaiting a decision and holds it after its own resolution
  const reviewOccurrenceId = needsReview ? series.actionableOccurrenceId : null; // settles: applying one re-reads the plan, so without holding it the panel would unmount and take the receipt of what was applied with it. The date is released when the worker dismisses that receipt.
  const [heldReviewOccurrenceId, setHeldReviewOccurrenceId] = useState<string | null>(null);
  const reviewPanelOccurrenceId = reviewOccurrenceId ?? heldReviewOccurrenceId;
  const holdReviewReceipt = useCallback((): void => setHeldReviewOccurrenceId(reviewPanelOccurrenceId), [reviewPanelOccurrenceId]);
  const releaseReviewReceipt = useCallback((): void => setHeldReviewOccurrenceId(null), []);
  const missedId = useId();
  const ruleHeadingId = useId();
  const previewHeadingId = useId();
  const previewReading = previewReadingOf(series);
  const nextNominalDate = series.preview.status === "preview" ? series.preview.dates.at(0) : undefined;
  const planReviewFacts: PlanNeedsReviewFacts = { state: series.state, revision: envelope.revision, planNeedsReview: needsReview, missedDateCount: series.planReview.missedDateCount, nextNominalDate: nextNominalDate === undefined ? null : { iso: nextNominalDate, display: nextNominalDate } };
  const reviewPanel = reviewPanelOccurrenceId === null ? null : <PlanNeedsReviewPanel scope={envelope.scope} occurrenceId={reviewPanelOccurrenceId} facts={planReviewFacts} seriesTitle={series.title} headingLevel={3} onResolved={holdReviewReceipt} onDismiss={needsReview ? undefined : releaseReviewReceipt} />;
  const identity = { displayName: series.title, secondaryName: repeatRuleLabel(series.rule), kind: "Repeating task", reference: envelope.source };
  const status = <StatusBadge label={SERIES_STATE_LABELS[series.state]} tone={SERIES_STATE_TONES[series.state]} srPrefix={SERIES_STATUS_SR_PREFIX} />;
  const sections: RecordDetailSectionSlots = {
    openTasks: (
      <div className="flex min-w-0 flex-col gap-4">
        {/* The plan's own rule, stated before the dates it produces: what the plan is comes before what it produces next. */}
        <section aria-labelledby={ruleHeadingId} data-slot="series-plan-rule" className="flex min-w-0 flex-col gap-2">
          <h3 {...{ id: ruleHeadingId, className: "type-subsection-title" }}>{"Start date & end"}</h3>
          <PlanRuleFacts rule={series.rule} />
        </section>
        {previewReading === null ? null : (
          <section aria-labelledby={previewHeadingId} data-slot="series-plan-preview" className="flex min-w-0 flex-col gap-2">
            <h3 {...{ id: previewHeadingId, className: "type-subsection-title" }}>{GROUP_LEGENDS.preview}</h3>
            <SeriesPreview state={series.state} rule={series.rule} planningTimeZone={series.rule.planningTimeZone} reading={previewReading} displayLocale={displayLocale} />
            <p className="type-supporting text-pretty">{PREVIEW_DATES_NOTE}</p>
          </section>
        )}
        {reviewPanel}
        {!needsReview || series.actionableOccurrenceId !== null ? null : (
          <Alert>
            <AlertTitle>{PLAN_NEEDS_REVIEW_HEADING}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <p>{PLAN_NEEDS_REVIEW_EXPLANATION}</p>
              <p>
                Dates that passed with no action: <bdi className="tabular-figures">{String(series.planReview.missedDateCount)}</bdi>.
              </p>
              <p id={missedId}>{"The plan's own review applies one of these:"}</p>
              <ul aria-labelledby={missedId} className="flex min-w-0 list-disc flex-col gap-1 ps-5">
                {MISSED_PLAN_RESOLUTION_ORDER.map((resolution) => (
                  <li key={resolution}>{MISSED_PLAN_RESOLUTION_LABELS[resolution]}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <OccurrenceCommands scope={envelope.scope} series={series} revision={envelope.revision} actions={envelope.actions} effectiveFrom={boundary} onCheckResult={onCheckResult} onOpenComposer={onOpenComposer} />
        <Separator />
        <SeriesStateControls scope={envelope.scope} seriesId={series.seriesId} revision={envelope.revision} state={series.state} actions={envelope.actions} onCheckResult={onCheckResult} headingLevel={3} />
      </div>
    ),
  };
  return <RecordDetail {...{ layout: "page", className, breadcrumb: [{ label: "Tasks", href: "/work" }], identity, status, sections }} />;
}
