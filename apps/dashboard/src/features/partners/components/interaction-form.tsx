"use client";
import { useForm } from "@tanstack/react-form";
import { useId, useState, type FormEvent, type ReactElement } from "react";
import type { ZodError } from "zod";
import { useAttemptedMutation } from "@/components/attempt";
import { ChoiceGroup, type ChoiceWording } from "@/components/choice-group";
import FormField, { civilDateConvention, FormErrorSummary, FormFieldGroup, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { useOutcomeMutation } from "@/lib/read-transport";
import type { Scope } from "@/modules/data-service/envelope";
import { UNIDENTIFIED_ATTEMPT, invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { AUDIENCE_LABEL_COPY, INTERACTION_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { useLogInteraction } from "../hooks/use-partner-mutations";
import { INTERACTION_KINDS, INTERACTION_PRECISIONS, logInteractionPayloadSchema, nextTaskPayloadSchema, type InteractionKind, type InteractionPrecision, type LogInteractionPayload, type NextTaskPayload } from "../schemas/interaction";
import { TextAreaField, TextField, controlAria } from "./bound-fields";
import PartnerPicker, { partnerSelectionRef, type PartnerSelection } from "./partner-picker";
const PART_RECEIPT_HEADING = 3;
const TYPE_LABEL = "Kind of contact";
const PRECISION_LEGEND = "How precisely is the day known?";
const DATE_LABEL = "The day it happened";
const DATE_DESCRIPTION = "A calendar date with no time of day and no time zone behind it: the day as it is stated, never converted through an instant.";
const OUTCOME_LABEL = "What came of it";
const OUTCOME_DESCRIPTION = "A sentence in your own words about what followed the contact. It is a statement of what happened, not a promise, a gift or a task.";
const SUBJECT_LEGEND = "The contact this is recorded against";
const PARTNERS_LABEL = "Other people who took part";
const ROLE_LABEL = "How they took part";
const NOTE_LABEL = "A note about this contact";
const NOTE_DESCRIPTION = `Plain text, in your own words. ${AUDIENCE_LABEL_COPY.private.label}: ${AUDIENCE_LABEL_COPY.private.description} ${PRIVATE_RECORD_COPY.remainsPrivate.body}`;
const TASK_HEADING = "Next step";
const TASK_TITLE_LABEL = "What needs doing";
const TASK_TITLE_DESCRIPTION = "A few words, because a title is the one thing a task cannot do without.";
const TASK_DUE_LABEL = "Due on";
const TASK_DUE_DESCRIPTION = "A calendar date with no time of day and no zone behind it. Leave it empty for undated work.";
const TASK_LINK_LEGEND = "Linked record";
const UNCONFIRMED_NOTE = "The last attempt's result is not confirmed. Check it with the operation identity in the receipt rather than submitting the same work again, because a second attempt could record the contact twice.";
const TASK_READ_JOBS = ["tasks", "agenda", "series"] as const;
const FOLLOW_UP_OFFLINE_GUIDANCE =
  "This device reported no connection, so the follow-up task's request did not leave from here. Reconnect and save this same follow-up again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than creating the task twice.";
const INTERACTION_KIND_LABELS: Readonly<Record<InteractionKind, string>> = { conversation: "A conversation", visit: "A visit", call: "A phone call", meeting: "A meeting", "written-exchange": "A written exchange", other: "Something else" };
const PRECISION_WORDING: Readonly<Record<InteractionPrecision, ChoiceWording>> = {
  date: { label: INTERACTION_COPY.precisionDate.title, hint: INTERACTION_COPY.precisionDate.body },
  approximate: { label: INTERACTION_COPY.precisionApproximate.title, hint: INTERACTION_COPY.precisionApproximate.body },
  unknown: { label: INTERACTION_COPY.precisionUnknown.title, hint: INTERACTION_COPY.precisionUnknown.body },
};
type TaskIntent = "none" | "create";
const TASK_INTENTS = ["none", "create"] as const satisfies readonly TaskIntent[];
const TASK_INTENT_WORDING: Readonly<Record<TaskIntent, ChoiceWording>> = { none: { label: "No follow-up task", hint: "Save the interaction on its own." }, create: { label: "Create a follow-up task", hint: "Save the interaction, then the task as a second change." } };
type TaskLink = "this-record" | "no-link";
const TASK_LINKS = ["this-record", "no-link"] as const satisfies readonly TaskLink[];
const TASK_LINK_WORDING: Readonly<Record<TaskLink, ChoiceWording>> = { "this-record": { label: "This contact", hint: "The task is filed against the record this interaction is about." }, "no-link": { label: "No link", hint: "The task is filed on its own, with no record attached." } };
type InteractionFormValues = { type: string; precision: InteractionPrecision; date: string; outcome: string; note: string; taskIntent: TaskIntent; taskTitle: string; taskDueOn: string; taskLink: TaskLink };
const INITIAL_VALUES: InteractionFormValues = { type: "", precision: "date", date: "", outcome: "", note: "", taskIntent: "none", taskTitle: "", taskDueOn: "", taskLink: "this-record" };
const INTERACTION_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { partnerId: SUBJECT_LEGEND, type: TYPE_LABEL, "occurredOn.precision": PRECISION_LEGEND, "occurredOn.date": DATE_LABEL, outcome: OUTCOME_LABEL, participants: PARTNERS_LABEL, "participants.0.role": ROLE_LABEL, note: NOTE_LABEL };
const INTERACTION_FIELD_ORDER = ["type", "occurredOn.precision", "occurredOn.date", "outcome", "participants", "participants.0.role", "note"] as const;
const TASK_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { title: TASK_TITLE_LABEL, dueOn: TASK_DUE_LABEL, partnerId: TASK_LINK_LEGEND, operation: TASK_HEADING };
const CLEARED_BY_EDIT: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["invalid", "conflict", "denied", "unavailable"]);
const refusalOf = (error: ZodError): FieldErrorLookup => fieldErrorsFromInvalid(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: error }));
const finishesEntry = (outcome: MutationOutcome): outcome is Extract<MutationOutcome, { readonly outcome: "accepted" | "alreadyAccepted" }> => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
function notify(handler: ((outcome: MutationOutcome) => void) | undefined, outcome: MutationOutcome): void {
  try {
    handler?.(outcome);
  } catch {}
}
function distinctSelections(partnerId: string, chosen: readonly PartnerSelection[]): readonly PartnerSelection[] {
  const seen = new Set<string>();
  return chosen.filter((selection) => {
    if (selection.partnerId === partnerId || seen.has(selection.partnerId)) return false;
    seen.add(selection.partnerId);
    return true;
  });
}
function participantsOf(partnerId: string, subjectRole: string, chosen: readonly PartnerSelection[], roles: Readonly<Record<string, string>>): { partnerId: string; role: string }[] {
  return [{ partnerId, role: subjectRole }, ...distinctSelections(partnerId, chosen).map((selection) => ({ partnerId: selection.partnerId, role: roles[partnerSelectionRef(selection)] ?? "" }))];
}
function interactionCandidateOf(partnerId: string, values: InteractionFormValues, subjectRole: string, chosen: readonly PartnerSelection[], roles: Readonly<Record<string, string>>): unknown {
  const stated = values.date.trim();
  return {
    partnerId,
    type: values.type,
    occurredOn: values.precision === "unknown" ? { precision: values.precision } : { precision: values.precision, ...(stated === "" ? {} : { date: stated }) },
    outcome: values.outcome,
    participants: participantsOf(partnerId, subjectRole, chosen, roles),
    ...(values.note.trim() === "" ? {} : { note: values.note }),
  };
}
function taskCandidateOf(partnerId: string, values: InteractionFormValues): unknown {
  const due = values.taskDueOn.trim();
  return { title: values.taskTitle, ...(due === "" ? {} : { dueOn: due }), ...(values.taskLink === "this-record" ? { partnerId } : {}) };
}
function RoleField({ name, error, value, onChange }: { readonly name: string; readonly error: string | readonly string[] | undefined; readonly value: string; readonly onChange: (role: string) => void }): ReactElement {
  return (
    <FormField name={name} label={ROLE_LABEL} description="What this person did in the contact, in a few words." error={error} required>
      {(control) => <Input id={control.id} type="text" autoComplete="off" className="w-full sm:max-w-72" value={value} onChange={(event) => onChange(event.currentTarget.value)} {...controlAria(control)} />}
    </FormField>
  );
}
export interface InteractionFormProps {
  readonly scope: Scope;
  readonly partnerId: string;
  readonly expectedRevision: string;
  readonly subject?: PartnerSelection | null;
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}
/** Logs one interaction that actually happened, and optionally saves the next task as a second, independent change. */
export default function InteractionForm({ scope, partnerId, expectedRevision, subject = null, onSettled, dir, className }: InteractionFormProps): ReactElement {
  const headingId = useId();
  const optionIdPrefix = useId();
  const log = useLogInteraction(partnerId);
  const form = useForm({ defaultValues: { ...INITIAL_VALUES } });
  const [participants, setParticipants] = useState<readonly PartnerSelection[]>([]);
  const [roles, setRoles] = useState<Readonly<Record<string, string>>>({});
  const [subjectRole, setSubjectRole] = useState("");
  const [interactionRefusal, setInteractionRefusal] = useState<FieldErrorLookup | null>(null);
  const [taskRefusal, setTaskRefusal] = useState<FieldErrorLookup | null>(null);
  const [adoptedRevision, setAdoptedRevision] = useState<string | null>(null);
  const revision = adoptedRevision ?? expectedRevision;
  const extras = distinctSelections(partnerId, participants);
  const clearInteractionEntry = (): void => {
    for (const field of ["type", "precision", "date", "outcome", "note"] as const) form.setFieldValue(field, INITIAL_VALUES[field]);
    setSubjectRole("");
    setParticipants([]);
    setRoles({});
    setInteractionRefusal(null);
  };
  const clearTaskEntry = (): void => {
    for (const field of ["taskIntent", "taskTitle", "taskDueOn", "taskLink"] as const) form.setFieldValue(field, INITIAL_VALUES[field]);
    setTaskRefusal(null);
  };
  const interaction = useAttemptedMutation<LogInteractionPayload>(log.submit, (outcome: MutationOutcome): void => {
    if (finishesEntry(outcome)) {
      setAdoptedRevision(outcome.revision);
      clearInteractionEntry();
    }
    notify(onSettled, outcome);
  });
  const followUpTask = useOutcomeMutation<NextTaskPayload>({ url: "/api/tasks", jobs: TASK_READ_JOBS, offlineGuidance: FOLLOW_UP_OFFLINE_GUIDANCE }); // The application's one browser change transport, so the task is reported `unavailable` rather than `unknown` when the device never sent it and its acceptance refreshes the task reads every other task write refreshes.
  const task = useAttemptedMutation<NextTaskPayload>(
    (input) => followUpTask.mutateAsync(input),
    (outcome: MutationOutcome): void => {
      if (finishesEntry(outcome)) clearTaskEntry();
    },
  );
  const pending = interaction.pending || task.pending;
  const unconfirmed = interaction.outcome !== null && interaction.outcome.outcome === "unknown";
  const interactionErrors = interactionRefusal ?? interaction.fieldErrors;
  const taskErrors = taskRefusal ?? task.fieldErrors;
  const editedInteraction = (): void => {
    setInteractionRefusal(null);
    if (interaction.outcome !== null && CLEARED_BY_EDIT.has(interaction.outcome.outcome)) interaction.reset();
  };
  const editedTask = (): void => {
    setTaskRefusal(null);
    if (task.outcome !== null && CLEARED_BY_EDIT.has(task.outcome.outcome)) task.reset();
  };
  const setRole = (reference: string, role: string): void => {
    setRoles((current) => ({ ...current, [reference]: role }));
    setInteractionRefusal(null);
  };
  const setSubjectRoleValue = (role: string): void => {
    setSubjectRole(role);
    setInteractionRefusal(null);
  };
  const removeParticipant = (reference: string): void => {
    setParticipants((current) => current.filter((selection) => partnerSelectionRef(selection) !== reference));
    setInteractionRefusal(null);
  };
  const submitEntry = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pending || unconfirmed) return;
    const values = form.state.values;
    const entry = logInteractionPayloadSchema.safeParse(interactionCandidateOf(partnerId, values, subjectRole, extras, roles));
    const followUp = values.taskIntent === "create" ? nextTaskPayloadSchema.safeParse(taskCandidateOf(partnerId, values)) : null;
    setInteractionRefusal(entry.success ? null : refusalOf(entry.error));
    setTaskRefusal(followUp !== null && !followUp.success ? refusalOf(followUp.error) : null);
    if (!entry.success || (followUp !== null && !followUp.success)) return;
    const preparedTask = followUp === null ? null : followUp.data;
    void interaction.submit({ scope, expectedRevision: revision, payload: entry.data }).then((outcome: MutationOutcome): void => {
      if (preparedTask !== null && finishesEntry(outcome)) void task.submit({ scope, expectedRevision: revision, payload: preparedTask });
    });
  };
  const saveTaskAlone = (): void => {
    if (pending) return;
    const followUp = nextTaskPayloadSchema.safeParse(taskCandidateOf(partnerId, form.state.values));
    if (!followUp.success) {
      setTaskRefusal(refusalOf(followUp.error));
      return;
    }
    setTaskRefusal(null);
    void task.submit({ scope, expectedRevision: revision, payload: followUp.data });
  };
  const replayInteraction = (): void => void interaction.retry();
  const reapplyInteraction = (): void => void interaction.reapplyOnConflict();
  const checkResult = interaction.canReplay ? replayInteraction : undefined;
  const replayTask = (): void => void task.retry();
  const reapplyTask = (): void => void task.reapplyOnConflict();
  return (
    <section data-slot="interaction-form" dir={dir} aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="type-section-title text-pretty">
          Log an interaction
        </h2>
        <p className="type-supporting text-pretty">An interaction records something that actually happened, so this entry states a contact the worker made rather than something the application inferred.</p>
      </div>
      <Alert data-slot="interaction-scope" className="min-w-0">
        <AlertTitle>{INTERACTION_COPY.whatCounts.title}</AlertTitle>
        <AlertDescription>
          <p>{INTERACTION_COPY.whatCounts.body}</p>
          <p>{INTERACTION_COPY.whatDoesNot.body}</p>
          <p>{INTERACTION_COPY.recordedOnce.body}</p>
          <p>{INTERACTION_COPY.provesNothing.body}</p>
        </AlertDescription>
      </Alert>
      {interaction.outcome === null ? null : (
        <OperationResult
          outcome={interaction.outcome}
          headingLevel={PART_RECEIPT_HEADING}
          fieldLabels={INTERACTION_FIELD_LABELS}
          onCheckResult={checkResult}
          onRetrySameWork={interaction.canReplay ? replayInteraction : undefined}
          onReapply={interaction.conflictRevision === null ? undefined : reapplyInteraction}
          className="min-w-0"
        />
      )}
      <form onSubmit={submitEntry} noValidate aria-busy={pending ? true : undefined} className="flex min-w-0 flex-col gap-6">
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <>
              {interactionRefusal === null ? null : <FormErrorSummary errors={interactionRefusal} labels={INTERACTION_FIELD_LABELS} order={INTERACTION_FIELD_ORDER} headingLevel={PART_RECEIPT_HEADING} />}
              <form.Field name="type">
                {(field) => (
                  <FormField name="type" label={TYPE_LABEL} description="The kinds this record admits are closed, so a contact is filed as one of them rather than as free text that nothing can compare." error={interactionErrors?.byField.type} required>
                    {(control) => (
                      <NativeSelect
                        id={control.id}
                        className="w-full sm:max-w-72"
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                          editedInteraction();
                        }}
                        onBlur={field.handleBlur}
                        {...controlAria(control)}
                      >
                        <NativeSelectOption value="">Choose the kind of contact</NativeSelectOption>
                        {INTERACTION_KINDS.map((kind) => (
                          <NativeSelectOption key={kind} value={kind}>
                            {INTERACTION_KIND_LABELS[kind]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                  </FormField>
                )}
              </form.Field>
              <FormFieldGroup legend={PRECISION_LEGEND} name="occurredOn.precision" description="The record keeps the precision you actually have, so a nearer day is never invented to fill the field in." error={interactionErrors?.byField["occurredOn.precision"]} required>
                {(group) => (
                  <form.Field name="precision">
                    {(field) => (
                      <ChoiceGroup
                        frame={group}
                        value={field.state.value}
                        choices={INTERACTION_PRECISIONS}
                        wording={PRECISION_WORDING}
                        idPrefix={`${optionIdPrefix}-precision`}
                        onChange={(next) => {
                          field.handleChange(next);
                          editedInteraction();
                        }}
                      />
                    )}
                  </form.Field>
                )}
              </FormFieldGroup>
              {values.precision === "unknown" ? (
                <p className="type-supporting text-pretty">No date is recorded, because the day is not known. Nothing is guessed to stand in for it, and no deadline is derived from this entry.</p>
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <form.Field name="date">
                    {(field) => <TextField field={field} name="occurredOn.date" label={DATE_LABEL} description={`${DATE_DESCRIPTION} ${civilDateConvention(field.state.value)}`} error={interactionErrors?.byField["occurredOn.date"]} required type="date" onEdit={editedInteraction} className="w-full sm:max-w-60" />}
                  </form.Field>
                  {values.precision === "approximate" ? <p className="type-supporting text-pretty">Recorded as approximate: the day is known only roughly, so the entry says so instead of implying a precision it does not have.</p> : null}
                </div>
              )}
              <form.Field name="outcome">{(field) => <TextAreaField field={field} name="outcome" label={OUTCOME_LABEL} description={OUTCOME_DESCRIPTION} error={interactionErrors?.byField.outcome} required rows={3} onEdit={editedInteraction} />}</form.Field>
              <Separator />
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="type-subsection-title text-pretty">Who took part</h3>
                  <p className="type-supporting text-pretty">The contact this interaction is recorded against always takes part. Anyone else is chosen from the records this context can read, so a participant names a record rather than a typed name.</p>
                </div>
                <FormFieldGroup legend={SUBJECT_LEGEND} name="participants.0" error={interactionErrors?.byField["participants.0"]} className="rounded-xl border border-border p-4">
                  {() => (
                    <div className="flex min-w-0 flex-col gap-3">
                      <p className="flex min-w-0 flex-col gap-1 type-body">
                        {subject === null ? null : <bdi className="min-w-0 font-medium break-words">{subject.displayName}</bdi>}
                        <bdi className="mono-identifier min-w-0 break-words text-xs text-muted-foreground">{subject === null ? partnerId : partnerSelectionRef(subject)}</bdi>
                        <span className="text-pretty text-muted-foreground">Always a participant of this interaction, so it has no remove control: the entry is recorded against exactly one record.</span>
                      </p>
                      <RoleField name="participants.0.role" error={interactionErrors?.byField["participants.0.role"]} value={subjectRole} onChange={setSubjectRoleValue} />
                    </div>
                  )}
                </FormFieldGroup>
                <PartnerPicker
                  mode="multiple"
                  scope={scope}
                  name="participants"
                  label={PARTNERS_LABEL}
                  description="Search the records this context admits. Two records that read alike are listed as two choices, and choosing one states which record you mean."
                  error={interactionErrors?.byField.participants}
                  value={participants}
                  onValueChange={(next) => {
                    setParticipants(next);
                    editedInteraction();
                  }}
                  excludeRefs={subject === null ? [] : [partnerSelectionRef(subject)]}
                  headingLevel={4}
                />
                {extras.length === 0 ? null : (
                  <ul className="flex min-w-0 list-none flex-col gap-4 p-0">
                    {extras.map((selection, index) => {
                      const path = `participants.${String(index + 1)}`;
                      const reference = partnerSelectionRef(selection);
                      const number = index + 2;
                      return (
                        <li key={reference} className="min-w-0">
                          <FormFieldGroup legend={`Participant ${String(number)}`} name={path} error={interactionErrors?.byField[path]} className="rounded-xl border border-border p-4">
                            {() => (
                              <div className="flex min-w-0 flex-col gap-3">
                                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                                  <p className="flex min-w-0 flex-col gap-1 type-body">
                                    <bdi className="min-w-0 font-medium break-words">{selection.displayName}</bdi>
                                    <bdi className="mono-identifier min-w-0 break-words text-xs text-muted-foreground">{reference}</bdi>
                                  </p>
                                  <Button type="button" variant="outline" size="sm" className="min-h-target max-w-full whitespace-normal" onClick={() => removeParticipant(reference)}>{`Remove participant ${String(number)}`}</Button>
                                </div>
                                <RoleField name={`${path}.role`} error={interactionErrors?.byField[`${path}.role`]} value={roles[reference] ?? ""} onChange={(role) => setRole(reference, role)} />
                              </div>
                            )}
                          </FormFieldGroup>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <Separator />
              <form.Field name="note">{(field) => <TextAreaField field={field} name="note" label={NOTE_LABEL} description={NOTE_DESCRIPTION} error={interactionErrors?.byField.note} optionalHint rows={3} onEdit={editedInteraction} />}</form.Field>
              <Separator />
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="type-subsection-title text-pretty">{TASK_HEADING}</h3>
                  <p className="type-supporting text-pretty">A follow-up task is separate work. It is saved as its own change under its own identity, and completing it later proves nothing about contact, support or a promise.</p>
                </div>
                <FormFieldGroup legend="Do you want a follow-up task?" name="task-intent" description="A task is optional. Leaving it out saves the interaction alone.">
                  {(group) => (
                    <form.Field name="taskIntent">
                      {(field) => (
                        <ChoiceGroup
                          frame={group}
                          value={field.state.value}
                          choices={TASK_INTENTS}
                          wording={TASK_INTENT_WORDING}
                          idPrefix={`${optionIdPrefix}-task-intent`}
                          onChange={(next) => {
                            field.handleChange(next);
                            editedTask();
                          }}
                        />
                      )}
                    </form.Field>
                  )}
                </FormFieldGroup>
                {values.taskIntent === "create" ? (
                  <div className="flex min-w-0 flex-col gap-4">
                    {taskRefusal === null ? null : <FormErrorSummary errors={taskRefusal} labels={TASK_FIELD_LABELS} order={["title", "dueOn", "partnerId"] as const} headingLevel={4} />}
                    <form.Field name="taskTitle">{(field) => <TextField field={field} name="title" label={TASK_TITLE_LABEL} description={TASK_TITLE_DESCRIPTION} error={taskErrors?.byField.title} required onEdit={editedTask} className="w-full sm:max-w-96" />}</form.Field>
                    <form.Field name="taskDueOn">
                      {(field) => <TextField field={field} name="dueOn" label={TASK_DUE_LABEL} description={`${TASK_DUE_DESCRIPTION} ${civilDateConvention(field.state.value)}`} error={taskErrors?.byField.dueOn} optionalHint type="date" onEdit={editedTask} className="w-full sm:max-w-60" />}
                    </form.Field>
                    <FormFieldGroup legend={TASK_LINK_LEGEND} name="partnerId" description="A task may name the contact this interaction is recorded against, or stand on its own." error={taskErrors?.byField.partnerId}>
                      {(group) => (
                        <form.Field name="taskLink">
                          {(field) => (
                            <ChoiceGroup
                              frame={group}
                              value={field.state.value}
                              choices={TASK_LINKS}
                              wording={TASK_LINK_WORDING}
                              idPrefix={`${optionIdPrefix}-task-link`}
                              onChange={(next) => {
                                field.handleChange(next);
                                editedTask();
                              }}
                              horizontal
                            />
                          )}
                        </form.Field>
                      )}
                    </FormFieldGroup>
                    {interaction.outcome !== null && finishesEntry(interaction.outcome) ? (
                      <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button {...{ type: "button" as const, variant: "outline" as const, className: "min-h-target max-w-full whitespace-normal" as const, disabled: pending, onClick: saveTaskAlone }}>{task.pending ? "Saving the follow-up task" : "Save the follow-up task"}</Button>
                        </div>
                        <p className="type-supporting text-pretty">The interaction above is already recorded, so this saves the task by itself and sends nothing about the interaction again.</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {task.outcome === null ? null : (
                  <OperationResult outcome={task.outcome} headingLevel={4} fieldLabels={TASK_FIELD_LABELS} onCheckResult={task.canReplay ? replayTask : undefined} onRetrySameWork={task.canReplay ? replayTask : undefined} onReapply={task.conflictRevision === null ? undefined : reapplyTask} className="min-w-0" />
                )}
              </div>
              <Separator />
              <div className="flex min-w-0 flex-col gap-2">
                {unconfirmed ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button {...{ type: "submit" as const, className: "min-h-target max-w-full whitespace-normal" as const, disabled: pending }}>{interaction.pending ? "Logging the interaction" : "Log the interaction"}</Button>
                  </div>
                )}
                <p className="type-supporting text-pretty">{unconfirmed ? UNCONFIRMED_NOTE : "The interaction is saved first. A follow-up task is then saved as a separate change with its own identity, so a task that fails never re-sends the interaction."}</p>
              </div>
            </>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}
