"use client";
/**
 * The one task composer: the create and edit surface of the single task model, for a title-only task or for a
 * meeting whose planned time is stated in a zone the worker chooses. It composes the payload, has it parsed by
 * the shared task schema, submits one attempt through the shared attempt owner, and renders the one receipt.
 */
import { useForm } from "@tanstack/react-form";
import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { ZodError } from "zod";
import { intentKeyOf, useReviewedMutation } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup, type FormFieldControl } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationInput, Scope, TaskRecord } from "@/modules/data-service/envelope";
import { invalid, UNIDENTIFIED_ATTEMPT, type MutationOutcome, type UnavailableOutcome } from "@/modules/data-service/outcome";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";
import { initiativeLinkValue, linkMembers, partnerLinkValue } from "../copy/task-links";
import { CATEGORY_HINT, CATEGORY_LABEL, DUE_DATE_LABEL, PLANNED_MEETING_LABEL, PLANNED_TIME_LABEL, PLANNED_TIME_ZONE_LABEL, PLANNED_VERSUS_HELD_NOTE, TASK_KIND_LABELS, type TaskKind } from "../copy/task-status";
import { useTaskMutations } from "../hooks/use-task-mutations";
import { createTaskSchema, editTaskSchema, TASK_CATEGORY_MAX_LENGTH, TASK_NOTE_MAX_LENGTH, TASK_TITLE_MAX_LENGTH, type CreateTaskPayload, type EditTaskPayload } from "../schemas/task";

/** One record a task may be linked to, as the read admitted it: the value is the opaque identity, the label is the display text that same read supplied. */
export type TaskLinkChoice = { readonly value: string; readonly label: string };

/**
 * The link options one read admitted, or the outage that stopped it stating any. A read that failed is never
 * presented as a read that admitted nothing, because an empty list would say no record exists.
 */
export type TaskLinkChoices = { readonly status: "admitted"; readonly partners: readonly TaskLinkChoice[]; readonly initiatives: readonly TaskLinkChoice[] } | { readonly status: "unavailable"; readonly source: UnavailableOutcome["source"]; readonly guidance: string };

/** What the open form holds. Every member is text, because every control is a text control. */
type TaskFormValues = { title: string; category: string; dueOn: string; kind: TaskKind; plannedTime: string; timeZone: string; note: string; link: string };

/** The values a host may hand back so an interrupted entry is restored rather than re-entered (WCAG 3.3.7 Redundant Entry). */
export type TaskComposerInitialValues = Partial<TaskFormValues>;

type TaskPayload = CreateTaskPayload | EditTaskPayload;

/** The outcomes that applied the change, which are the only ones a host can act on as a save. */
type AppliedOutcome = Extract<MutationOutcome, { readonly outcome: "accepted" | "alreadyAccepted" }>;

interface TaskComposerCommonProps {
  /** The authority this surface acts in, exactly as the envelope that admitted its options reported it. Never re-derived here. */
  readonly scope: Scope;
  /** The revision the surface loaded: the collection's for a new task, the record's for an edit, so a stale write is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  readonly initialValues?: TaskComposerInitialValues;
  /** The IANA zones this surface admits for a planned time; the display zone is added to them when it is not already listed. */
  readonly timeZoneChoices: readonly string[];
  /** The zone the worker's own display and planning settings state, preselected when a meeting is chosen. */
  readonly defaultTimeZone?: string;
  /** The partners and initiatives this read admitted, or the outage that stopped it admitting any. Omitted means the surface offers no link. */
  readonly linkChoices?: TaskLinkChoices | null;
  readonly headingLevel?: 2 | 3;
  /** Called once when an attempt settles as applied, so the host can re-read what it shows. */
  readonly onSaved?: (outcome: AppliedOutcome) => void;
  /** Called by the receipt's "check the result": only a host that can read one operation's result supplies it. */
  readonly onCheckResult?: () => void;
  readonly onCancel?: () => void;
  readonly onDismiss?: () => void;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}

/** The composer's contract: a new task needs the collection's revision, an edit needs the record it changes. */
export type TaskComposerProps = (TaskComposerCommonProps & { readonly mode: "create"; readonly record?: null | undefined }) | (TaskComposerCommonProps & { readonly mode: "edit"; readonly record: TaskRecord });

const CREATE_HEADING = "New task";
const EDIT_HEADING = "Edit this task";
const FORM_HELP = "A task needs only a title. Everything else is optional, and saving it changes this task alone.";
const TITLE_LABEL = "Title";
const TITLE_DESCRIPTION = `What the work is, in a few words — ${String(TASK_TITLE_MAX_LENGTH)} characters at most.`;
const CATEGORY_DESCRIPTION = `${CATEGORY_HINT} ${String(TASK_CATEGORY_MAX_LENGTH)} characters at most.`;
const DUE_DATE_DESCRIPTION = "A calendar date with no time of day and no zone behind it. Leave it empty for undated work.";
const KIND_LEGEND = "Kind of work";
const KIND_HINTS: Readonly<Record<TaskKind, string>> = { default: "Ordinary work with an optional due date.", meeting: "Work planned for a time, stated in a zone you choose." };
const KIND_ORDER = ["default", "meeting"] as const satisfies readonly TaskKind[];
const PLANNED_TIME_DESCRIPTION = "The day and clock time this meeting is planned for. Give a time and its zone together, or neither; the planned day is also the due date.";
const TIME_ZONE_DESCRIPTION = "The zone this planned time is stated in, so the clock reading is disclosed rather than assumed.";
const PLAN_DAY_IS_DUE_DATE_NOTE = "A meeting's planned day is also its due date, so stating a planned time sets the due date to that day.";
const NOTE_LABEL = "Note";
const NOTE_DESCRIPTION = `A short reminder about the work — ${String(TASK_NOTE_MAX_LENGTH)} characters at most.`;
const LINK_LABEL = "Linked record";
const LINK_DESCRIPTION = "Only the records this read admitted are listed. A link names one of them by its opaque identity and changes nothing else.";
const PARTNER_GROUP_LABEL = "Partners";
const INITIATIVE_GROUP_LABEL = "Initiatives";
const NO_LINK_LABEL = "No link";
const ZONE_PLACEHOLDER = "Not stated";
const CANCEL_LABEL = "Cancel";
const DONE_LABEL = "Done";
const CREATE_LABEL = "Create task";
const EDIT_LABEL = "Save task";
const SAVING_LABEL = "Saving…";
const NO_LINKABLE_RECORD_NOTE = "This read admitted no partner or initiative to link, so the task stands on its own.";

const TITLE_FIELD = "title";
const CATEGORY_FIELD = "category";
const DUE_ON_FIELD = "dueOn";
const KIND_FIELD = "kind";
const PLANNED_TIME_FIELD = "plannedTime";
const TIME_ZONE_FIELD = "timeZone";
const NOTE_FIELD = "note";
const LINK_FIELD = "link";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [TITLE_FIELD]: TITLE_LABEL,
  [CATEGORY_FIELD]: CATEGORY_LABEL,
  [DUE_ON_FIELD]: DUE_DATE_LABEL,
  [KIND_FIELD]: KIND_LEGEND,
  [PLANNED_TIME_FIELD]: PLANNED_TIME_LABEL,
  [TIME_ZONE_FIELD]: PLANNED_TIME_ZONE_LABEL,
  [NOTE_FIELD]: NOTE_LABEL,
  [LINK_FIELD]: LINK_LABEL,
  partnerId: LINK_LABEL,
  initiativeId: LINK_LABEL,
  taskId: "Task",
};
const FIELD_ORDER = [TITLE_FIELD, CATEGORY_FIELD, DUE_ON_FIELD, KIND_FIELD, PLANNED_TIME_FIELD, TIME_ZONE_FIELD, LINK_FIELD, NOTE_FIELD] as const;
const PLANNED_VALUE_SEPARATOR = "T";

/** The aria wiring every control under a `FormField` carries, so its description and its invalid state are never dropped. */
function controlAria(control: FormFieldControl): { "aria-describedby": string | undefined; "aria-invalid": true | undefined } {
  return { "aria-describedby": control.describedBy, "aria-invalid": control.invalid ? true : undefined };
}

const blankToUndefined = (value: string): string | undefined => (value.trim() === "" ? undefined : value);

/** Reads a refusal raised before submission through the one owner of the path-to-message mapping, so no second copy of it lives here. */
function refusalOf(error: ZodError): FieldErrorLookup {
  return fieldErrorsFromInvalid(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: error }));
}

/** The link a record already carries, but only when this read admitted it: a link the read withheld is never reconstructed from the record. */
function admittedLinkOf(record: TaskRecord | null, admitted: ReadonlySet<string>): string {
  if (record === null) return "";
  const candidates: string[] = [];
  if (record.partnerId !== null) candidates.push(partnerLinkValue(record.partnerId));
  if (record.initiativeId !== null) candidates.push(initiativeLinkValue(record.initiativeId));
  return candidates.find((candidate) => admitted.has(candidate)) ?? "";
}

/** The civil day a wall-clock value states, read as a day rather than converted through an instant. */
function plannedDayOf(value: string): string | null {
  const parsed = parseCivilDate(value.slice(0, 10));
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : null;
}

/** The clock reading a wall-clock value states, kept exactly as entered. */
function plannedClockOf(value: string): string {
  const separator = value.indexOf(PLANNED_VALUE_SEPARATOR);
  return separator === -1 ? "" : value.slice(separator + 1);
}

/** The same clock reading, moved onto another civil day: no arithmetic, only the day the worker chose. */
function plannedOnDay(value: string, day: string): string {
  const clock = plannedClockOf(value);
  return clock === "" ? value : `${day}${PLANNED_VALUE_SEPARATOR}${clock}`;
}

/** A stored plan as the wall-clock value the control holds: the record keeps the clock, its due date keeps the day. */
function plannedValueOf(record: TaskRecord | null): string {
  if (record === null || record.plannedTime === null || record.dueOn === null) return "";
  return `${record.dueOn}${PLANNED_VALUE_SEPARATOR}${record.plannedTime}`;
}

/**
 * The plan members the payload carries. A plan belongs to a meeting and is stated as a time and a zone
 * together; a half-stated plan is sent as it stands so the schema refuses it with the message naming the
 * missing half, rather than the composer silently dropping what the worker typed.
 */
function planMembersOf(values: TaskFormValues): { readonly plannedTime?: string; readonly timeZone?: string } {
  if (values.kind !== "meeting") return {};
  const time = values.plannedTime.trim();
  const zone = values.timeZone.trim();
  if (time === "" && zone === "") return {};
  return { ...(time === "" ? {} : { plannedTime: time }), ...(zone === "" ? {} : { timeZone: zone }) };
}

/** The payload the form's values describe, before the schema judges it. */
function composePayload(values: TaskFormValues, taskId: string | null): TaskPayload {
  const members = { title: values.title, kind: values.kind, category: blankToUndefined(values.category), dueOn: blankToUndefined(values.dueOn), note: blankToUndefined(values.note), ...linkMembers(values.link), ...planMembersOf(values) };
  return taskId === null ? { operation: "createTask", ...members } : { operation: "editTask", taskId, ...members };
}

/** Judges the composed payload with the schema that owns its shape, so an obviously invalid form never reaches the route. */
function parsePayload(payload: TaskPayload): { readonly parsed: TaskPayload } | { readonly refused: ZodError } {
  const checked = payload.operation === "editTask" ? editTaskSchema.safeParse(payload) : createTaskSchema.safeParse(payload);
  return checked.success ? { parsed: checked.data } : { refused: checked.error };
}

/** The values the form opens with: the record's for an edit, overlaid by anything an interrupted entry restored. */
function defaultsOf(record: TaskRecord | null, link: string, initialValues: TaskComposerInitialValues | undefined): TaskFormValues {
  const stated: TaskComposerInitialValues = initialValues ?? {};
  return {
    title: stated.title ?? record?.title ?? "",
    category: stated.category ?? record?.category ?? "",
    dueOn: stated.dueOn ?? record?.dueOn ?? "",
    kind: stated.kind ?? record?.kind ?? "default",
    plannedTime: stated.plannedTime ?? plannedValueOf(record),
    timeZone: stated.timeZone ?? record?.timeZone ?? "",
    note: stated.note ?? record?.note ?? "",
    link: stated.link ?? link,
  };
}

const HEADING_TAG: Readonly<Record<2 | 3, "h2" | "h3">> = { 2: "h2", 3: "h3" };
const LINK_UNAVAILABLE_TITLE = "The records a task can link to could not be read";

/** The plan as the form will submit it, stated once in words beside the fields that build it. */
function PlanDisclosure({ value, timeZone }: { readonly value: string; readonly timeZone: string }): ReactElement | null {
  const day = value.slice(0, 10);
  const clock = plannedClockOf(value);
  if (clock === "" || parseCivilDate(day).status === "refused") return null;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3">
      <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{PLANNED_MEETING_LABEL}</Badge>
        {/* The day and the clock reading are neutral-direction values, so each is isolated rather than embedded in the sentence around it. */}
        <bdi className="mono-identifier">{day}</bdi>
        <bdi className="mono-identifier">{clock}</bdi>
        <span className="min-w-0 wrap-anywhere text-muted-foreground">{timeZone.trim() === "" ? ZONE_PLACEHOLDER : timeZone}</span>
      </p>
      <p className="text-sm text-pretty text-muted-foreground">{PLANNED_VERSUS_HELD_NOTE}</p>
      <p className="text-sm text-pretty text-muted-foreground">{PLAN_DAY_IS_DUE_DATE_NOTE}</p>
    </div>
  );
}

/** The create and edit surface of the one task model. */
export default function TaskComposer(props: TaskComposerProps): ReactElement {
  const { scope, expectedRevision, initialValues, timeZoneChoices, defaultTimeZone, linkChoices, headingLevel = 3, onSaved, onCheckResult, onCancel, onDismiss, dir, className } = props;
  const record = props.mode === "edit" ? props.record : null;
  const taskId = record === null ? null : record.taskId;
  const editing = taskId !== null;
  const headingId = useId();
  const optionIdPrefix = useId();
  const Heading = HEADING_TAG[headingLevel];
  const receiptHeadingLevel = headingLevel === 2 ? 3 : 4;
  const admitted = linkChoices === undefined || linkChoices === null || linkChoices.status !== "admitted" ? null : linkChoices;
  const partners: readonly TaskLinkChoice[] = admitted === null ? [] : admitted.partners;
  const initiatives: readonly TaskLinkChoice[] = admitted === null ? [] : admitted.initiatives;
  const linkable = partners.length > 0 || initiatives.length > 0;
  const linkUnavailable = linkChoices === undefined || linkChoices === null || linkChoices.status !== "unavailable" ? null : linkChoices;
  const admittedValues = new Set<string>([...partners.map((choice) => choice.value), ...initiatives.map((choice) => choice.value)]);
  const form = useForm({ defaultValues: defaultsOf(record, admittedLinkOf(record, admittedValues), initialValues) });
  const zoneChoices = useMemo(() => {
    const zones: string[] = [];
    for (const stated of [defaultTimeZone ?? "", ...timeZoneChoices]) {
      const zone = stated.trim();
      if (zone !== "" && !zones.includes(zone)) zones.push(zone);
    }
    return zones;
  }, [defaultTimeZone, timeZoneChoices]);
  const { createTask, editTask } = useTaskMutations(scope);
  const submitTask = useCallback(
    async (input: MutationInput<TaskPayload>): Promise<MutationOutcome> => {
      // The attempt's identity — its `operationId` — belongs to the shared attempt owner below: an unchanged
      // intent reuses it and a changed intent mints a new one, so this composer states only the scope, the
      // revision it read and the payload it composed, and the payload's own member names the mutation.
      const identity = { operationId: input.operationId, expectedRevision: input.expectedRevision };
      return input.payload.operation === "editTask" ? editTask.mutateAsync({ ...identity, payload: input.payload }) : createTask.mutateAsync({ ...identity, payload: input.payload });
    },
    [createTask, editTask],
  );
  const { pending, outcome, reviewedIntent, submit, retry, reapply } = useReviewedMutation<TaskPayload>(submitTask);
  const [refusal, setRefusal] = useState<FieldErrorLookup | null>(null);
  const savedOutcome = useRef<MutationOutcome | null>(null);
  const settle = useCallback(
    (settled: MutationOutcome | null): void => {
      if (settled === null) return;
      // One refusal presentation for every path: a refusal raised here and one refused by the service are read the same way.
      setRefusal(settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null);
      if ((settled.outcome === "accepted" || settled.outcome === "alreadyAccepted") && savedOutcome.current !== settled) {
        savedOutcome.current = settled;
        onSaved?.(settled);
      }
    },
    [onSaved],
  );
  const clearRefusal = useCallback((): void => {
    setRefusal((current) => (current === null ? current : null));
  }, []);
  const changeKind = (next: TaskKind): void => {
    form.setFieldValue("kind", next);
    if (next !== "meeting") {
      // The fields of the kind being left are emptied, so no stale time or zone is ever submitted for ordinary work.
      form.setFieldValue("plannedTime", "");
      form.setFieldValue("timeZone", "");
    } else if (form.state.values.timeZone.trim() === "" && zoneChoices.length > 0) {
      form.setFieldValue("timeZone", zoneChoices[0] ?? "");
    }
    clearRefusal();
  };
  const changeDueOn = (next: string): void => {
    form.setFieldValue("dueOn", next);
    const plan = form.state.values.plannedTime;
    const day = plannedDayOf(next);
    // A meeting's planned day is its due date, so the two visible controls are kept equal rather than left to a
    // refusal the worker cannot see the cause of. Only a real civil day is ever written into the plan.
    if (day !== null && plan.trim() !== "" && plannedDayOf(plan) !== day) form.setFieldValue("plannedTime", plannedOnDay(plan, day));
    clearRefusal();
  };
  const changePlannedTime = (next: string): void => {
    form.setFieldValue("plannedTime", next);
    const day = plannedDayOf(next);
    // The stored plan keeps the clock and the due date keeps the day, so a plan stated on another day moves the
    // due date to that day rather than being refused for a mismatch the worker never typed.
    if (day !== null && day !== form.state.values.dueOn) form.setFieldValue("dueOn", day);
    clearRefusal();
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pending) return;
    const checked = parsePayload(composePayload(form.state.values, taskId));
    if ("refused" in checked) {
      setRefusal(refusalOf(checked.refused));
      return;
    }
    setRefusal(null);
    void submit({ scope, expectedRevision, payload: checked.parsed }).then(settle);
  };
  const retrySameWork = (): void => {
    void retry().then(settle);
  };
  const reapplyInput = (): void => {
    void reapply().then(settle);
  };
  const dismiss = onDismiss ?? onCancel;
  return (
    <section dir={dir} aria-labelledby={headingId} aria-busy={pending ? true : undefined} data-slot="task-composer" data-mode={props.mode} className={cn("flex min-w-0 flex-col gap-5", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className="font-heading text-lg font-medium">
          {editing ? EDIT_HEADING : CREATE_HEADING}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">{FORM_HELP}</p>
      </div>
      {linkUnavailable === null ? null : <StateNotice kind="unavailable" title={LINK_UNAVAILABLE_TITLE} description={linkUnavailable.guidance} source={linkUnavailable.source} headingLevel={4} />}
      <form noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-5">
        {refusal === null || refusal.count === 0 ? null : <FormErrorSummary errors={refusal} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={receiptHeadingLevel} />}
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const payload = composePayload(values, taskId);
            const receipt = reviewedIntent !== null && reviewedIntent === intentKeyOf({ scope, expectedRevision, payload }) ? outcome : null;
            const applied = receipt !== null && (receipt.outcome === "accepted" || receipt.outcome === "alreadyAccepted" || receipt.outcome === "unchanged");
            const linkError = refusal === null ? undefined : [...(refusal.byField.partnerId ?? []), ...(refusal.byField.initiativeId ?? [])];
            return (
              <div className="flex min-w-0 flex-col gap-5">
                <form.Field name="title">
                  {(field) => (
                    <FormField name={TITLE_FIELD} label={TITLE_LABEL} description={TITLE_DESCRIPTION} error={refusal?.byField[TITLE_FIELD]} required>
                      {(control) => (
                        <Input
                          id={control.id}
                          name={TITLE_FIELD}
                          type="text"
                          autoComplete="off"
                          className="w-full"
                          required={control.required}
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.currentTarget.value);
                            clearRefusal();
                          }}
                          onBlur={field.handleBlur}
                          {...controlAria(control)}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                <form.Field name="category">
                  {(field) => (
                    <FormField name={CATEGORY_FIELD} label={CATEGORY_LABEL} description={CATEGORY_DESCRIPTION} error={refusal?.byField[CATEGORY_FIELD]} optionalHint>
                      {(control) => (
                        <Input
                          id={control.id}
                          name={CATEGORY_FIELD}
                          type="text"
                          autoComplete="off"
                          className="w-full sm:max-w-72"
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.currentTarget.value);
                            clearRefusal();
                          }}
                          onBlur={field.handleBlur}
                          {...controlAria(control)}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                <form.Field name="dueOn">
                  {(field) => (
                    <FormField name={DUE_ON_FIELD} label={DUE_DATE_LABEL} description={DUE_DATE_DESCRIPTION} error={refusal?.byField[DUE_ON_FIELD]} optionalHint>
                      {(control) => (
                        <Input
                          id={control.id}
                          name={DUE_ON_FIELD}
                          type="date"
                          className="w-full sm:max-w-60"
                          value={field.state.value}
                          onChange={(event) => {
                            changeDueOn(event.currentTarget.value);
                          }}
                          onBlur={field.handleBlur}
                          {...controlAria(control)}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                <FormFieldGroup legend={KIND_LEGEND} name={KIND_FIELD} description={PLANNED_VERSUS_HELD_NOTE} error={refusal?.byField[KIND_FIELD]}>
                  {(group) => (
                    <form.Field name="kind">
                      {(field) => (
                        <RadioGroup
                          value={field.state.value}
                          onValueChange={(next) => {
                            if (next === "default" || next === "meeting") changeKind(next);
                          }}
                          aria-labelledby={group.legendId}
                          aria-describedby={group.describedBy}
                          aria-invalid={group.invalid ? true : undefined}
                        >
                          {KIND_ORDER.map((kind) => {
                            const optionId = `${optionIdPrefix}-kind-${kind}`;
                            const hintId = `${optionId}-hint`;
                            return (
                              <label key={kind} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                                <RadioGroupItem id={optionId} value={kind} aria-label={TASK_KIND_LABELS[kind]} aria-describedby={hintId} className="mt-0.5" />
                                <span className="flex min-w-0 flex-col gap-0.5">
                                  <span className="text-sm font-medium">{TASK_KIND_LABELS[kind]}</span>
                                  <span id={hintId} className="text-sm text-pretty text-muted-foreground">
                                    {KIND_HINTS[kind]}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </RadioGroup>
                      )}
                    </form.Field>
                  )}
                </FormFieldGroup>
                {values.kind === "meeting" ? (
                  <div className="flex min-w-0 flex-col gap-4">
                    <form.Field name="plannedTime">
                      {(field) => (
                        <FormField name={PLANNED_TIME_FIELD} label={PLANNED_TIME_LABEL} description={PLANNED_TIME_DESCRIPTION} error={refusal?.byField[PLANNED_TIME_FIELD]}>
                          {(control) => (
                            <Input
                              id={control.id}
                              name={PLANNED_TIME_FIELD}
                              type="datetime-local"
                              className="w-full sm:max-w-64"
                              value={field.state.value}
                              onChange={(event) => {
                                changePlannedTime(event.currentTarget.value);
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                    <form.Field name="timeZone">
                      {(field) => (
                        <FormField name={TIME_ZONE_FIELD} label={PLANNED_TIME_ZONE_LABEL} description={TIME_ZONE_DESCRIPTION} error={refusal?.byField[TIME_ZONE_FIELD]}>
                          {(control) => (
                            <NativeSelect
                              id={control.id}
                              name={TIME_ZONE_FIELD}
                              className="w-full sm:max-w-72"
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                                clearRefusal();
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            >
                              <NativeSelectOption value="">{ZONE_PLACEHOLDER}</NativeSelectOption>
                              {zoneChoices.map((zone) => (
                                <NativeSelectOption key={zone} value={zone}>
                                  {zone}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          )}
                        </FormField>
                      )}
                    </form.Field>
                    <PlanDisclosure value={values.plannedTime} timeZone={values.timeZone} />
                  </div>
                ) : null}
                {admitted === null ? null : !linkable ? (
                  <p className="text-sm text-pretty text-muted-foreground">{NO_LINKABLE_RECORD_NOTE}</p>
                ) : (
                  <form.Field name="link">
                    {(field) => (
                      <FormField name={LINK_FIELD} label={LINK_LABEL} description={LINK_DESCRIPTION} error={linkError} optionalHint>
                        {(control) => (
                          <NativeSelect
                            id={control.id}
                            name={LINK_FIELD}
                            className="w-full"
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.currentTarget.value);
                              clearRefusal();
                            }}
                            onBlur={field.handleBlur}
                            {...controlAria(control)}
                          >
                            <NativeSelectOption value="">{NO_LINK_LABEL}</NativeSelectOption>
                            {partners.length === 0 ? null : (
                              <NativeSelectOptGroup label={PARTNER_GROUP_LABEL}>
                                {partners.map((choice) => (
                                  <NativeSelectOption key={choice.value} value={choice.value}>
                                    {choice.label}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelectOptGroup>
                            )}
                            {initiatives.length === 0 ? null : (
                              <NativeSelectOptGroup label={INITIATIVE_GROUP_LABEL}>
                                {initiatives.map((choice) => (
                                  <NativeSelectOption key={choice.value} value={choice.value}>
                                    {choice.label}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelectOptGroup>
                            )}
                          </NativeSelect>
                        )}
                      </FormField>
                    )}
                  </form.Field>
                )}
                <form.Field name="note">
                  {(field) => (
                    <FormField name={NOTE_FIELD} label={NOTE_LABEL} description={NOTE_DESCRIPTION} error={refusal?.byField[NOTE_FIELD]} optionalHint>
                      {(control) => (
                        <Textarea
                          id={control.id}
                          name={NOTE_FIELD}
                          rows={3}
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.currentTarget.value);
                            clearRefusal();
                          }}
                          onBlur={field.handleBlur}
                          {...controlAria(control)}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                {receipt === null || receipt.outcome === "invalid" ? null : <OperationResult outcome={receipt} headingLevel={receiptHeadingLevel} onCheckResult={onCheckResult} onRetrySameWork={retrySameWork} onReapply={reapplyInput} fieldLabels={FIELD_LABELS} />}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  {applied ? (
                    dismiss === undefined ? null : (
                      <Button type="button" onClick={dismiss}>
                        {DONE_LABEL}
                      </Button>
                    )
                  ) : (
                    <>
                      {onCancel === undefined ? null : (
                        <Button type="button" variant="outline" onClick={onCancel}>
                          {CANCEL_LABEL}
                        </Button>
                      )}
                      <Button type="submit" disabled={pending} aria-busy={pending ? true : undefined}>
                        {pending ? SAVING_LABEL : editing ? EDIT_LABEL : CREATE_LABEL}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          }}
        </form.Subscribe>
      </form>
    </section>
  );
}
