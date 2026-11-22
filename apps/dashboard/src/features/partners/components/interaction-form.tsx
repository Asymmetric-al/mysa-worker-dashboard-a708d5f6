"use client";
/**
 * The one surface that logs something that actually happened about a partner record, with an optional next task saved
 * as a second and entirely separate change.
 *
 * Two operations, two identities. The interaction is the Partners family's `logInteraction`, driven through
 * `useLogInteraction`, which mints that attempt's own operation identity with `newOperationId` and keeps it for an
 * unchanged intent, so a lost acknowledgement replays to its original result instead of recording the contact twice.
 * The next task is deliberately not a partner mutation: this family's hook is closed at its eleven named changes,
 * `createTask` belongs to the work family, and importing the work feature here is the cross-feature import the
 * layering rules forbid. The task therefore travels to `POST /api/tasks` as its own request, carrying its own
 * operation identity minted below, its own expected revision and its own outcome, and it is sent only once the
 * interaction's outcome is known. No name here is ever used for the other operation's attempt: a task that fails
 * never re-sends the saved interaction, and a retried task presents the identity it was first sent under rather than
 * minting a third.
 *
 * Nothing is an interaction by accident. A gift, a scheduled task and opening a mail or dialer app are not contacts;
 * no other surface in this application logs an interaction on the worker's behalf; and the copy at the top of the
 * form says exactly that, where the record is about to be written rather than after it has been.
 */
import { useForm } from "@tanstack/react-form";
import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { ZodError } from "zod";
import FormField, { FormErrorSummary, FormFieldGroup, fieldErrorsFromInvalid, type FieldErrorLookup, type FormFieldControl } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { newOperationId } from "@/lib/ids";
import { assertNever } from "@/lib/result";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { UNIDENTIFIED_ATTEMPT, invalid, isOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { AUDIENCE_LABEL_COPY, INTERACTION_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { useLogInteraction } from "../hooks/use-partner-mutations";
import { INTERACTION_KINDS, INTERACTION_PRECISIONS, logInteractionPayloadSchema, nextTaskPayloadSchema, type InteractionKind, type InteractionPrecision, type LogInteractionPayload, type NextTaskPayload } from "../schemas/interaction";
import PartnerPicker, { partnerSelectionRef, type PartnerSelection } from "./partner-picker";

/** The one path the optional next task is created on: the work family's own transport, posted to rather than imported from. */
const TASKS_PATH = "/api/tasks";

/** The heading level the receipts carry: one step below this form's own title, so the page keeps one outline. */
const PART_RECEIPT_HEADING = 3;

// The words this form states, kept together so no two renders word the same condition differently.
const HEADING = "Log an interaction";
const LEAD = "An interaction records something that actually happened, so this entry states a contact the worker made rather than something the application inferred.";
const TYPE_LABEL = "Kind of contact";
const TYPE_DESCRIPTION = "The kinds this record admits are closed, so a contact is filed as one of them rather than as free text that nothing can compare.";
const TYPE_PLACEHOLDER = "Choose the kind of contact";
const PRECISION_LEGEND = "How precisely is the day known?";
const PRECISION_DESCRIPTION = "The record keeps the precision you actually have, so a nearer day is never invented to fill the field in.";
const DATE_LABEL = "The day it happened";
const DATE_DESCRIPTION = "A calendar date with no time of day and no time zone behind it: the day as it is stated, never converted through an instant.";
const APPROXIMATE_WORD = "approximate";
const APPROXIMATE_NOTE = `Recorded as ${APPROXIMATE_WORD}: the day is known only roughly, so the entry says so instead of implying a precision it does not have.`;
const UNKNOWN_DATE_NOTE = "No date is recorded, because the day is not known. Nothing is guessed to stand in for it, and no deadline is derived from this entry.";
const OUTCOME_LABEL = "What came of it";
const OUTCOME_DESCRIPTION = "A sentence in your own words about what followed the contact. It is a statement of what happened, not a promise, a gift or a task.";
const PARTICIPANTS_HEADING = "Who took part";
const PARTICIPANTS_HELP = "The contact this interaction is recorded against always takes part. Anyone else is chosen from the records this context can read, so a participant names a record rather than a typed name.";
const SUBJECT_LEGEND = "The contact this is recorded against";
const SUBJECT_FIXED_NOTE = "Always a participant of this interaction, so it has no remove control: the entry is recorded against exactly one record.";
const PARTNERS_LABEL = "Other people who took part";
const PARTNERS_DESCRIPTION = "Search the records this context admits. Two records that read alike are listed as two choices, and choosing one states which record you mean.";
const PARTICIPANT_LEGEND_PREFIX = "Participant";
const ROLE_LABEL = "How they took part";
const ROLE_DESCRIPTION = "What this person did in the contact, in a few words.";
const REMOVE_PARTICIPANT_PREFIX = "Remove participant";
const NOTE_LABEL = "A note about this contact";
const NOTE_DESCRIPTION = `Plain text, in your own words. ${AUDIENCE_LABEL_COPY.private.label}: ${AUDIENCE_LABEL_COPY.private.description} ${PRIVATE_RECORD_COPY.remainsPrivate.body}`;
const TASK_HEADING = "Next step";
const TASK_LEAD = "A follow-up task is separate work. It is saved as its own change under its own identity, and completing it later proves nothing about contact, support or a promise.";
const TASK_INTENT_LEGEND = "Do you want a follow-up task?";
const TASK_INTENT_DESCRIPTION = "A task is optional. Leaving it out saves the interaction alone.";
const TASK_TITLE_LABEL = "What needs doing";
const TASK_TITLE_DESCRIPTION = "A few words, because a title is the one thing a task cannot do without.";
const TASK_DUE_LABEL = "Due on";
const TASK_DUE_DESCRIPTION = "A calendar date with no time of day and no zone behind it. Leave it empty for undated work.";
const TASK_LINK_LEGEND = "Linked record";
const TASK_LINK_DESCRIPTION = "A task may name the contact this interaction is recorded against, or stand on its own.";
const TASK_SAVE_LABEL = "Save the follow-up task";
const TASK_SAVE_PENDING_LABEL = "Saving the follow-up task";
const TASK_SAVE_NOTE = "The interaction above is already recorded, so this saves the task by itself and sends nothing about the interaction again.";
const SUBMIT_LABEL = "Log the interaction";
const SUBMIT_PENDING_LABEL = "Logging the interaction";
const SUBMIT_NOTE = "The interaction is saved first. A follow-up task is then saved as a separate change with its own identity, so a task that fails never re-sends the interaction.";
const UNCONFIRMED_NOTE = "The last attempt's result is not confirmed. Check it with the operation identity in the receipt rather than submitting the same work again, because a second attempt could record the contact twice.";

/** What one kind of contact is called, in the words the worker reads. */
const INTERACTION_KIND_LABELS: Readonly<Record<InteractionKind, string>> = { conversation: "A conversation", visit: "A visit", call: "A phone call", meeting: "A meeting", "written-exchange": "A written exchange", other: "Something else" };

/** What each precision means, taken from the family's own interaction vocabulary rather than restated here. */
const PRECISION_LABELS: Readonly<Record<InteractionPrecision, string>> = { date: INTERACTION_COPY.precisionDate.title, approximate: INTERACTION_COPY.precisionApproximate.title, unknown: INTERACTION_COPY.precisionUnknown.title };

const PRECISION_HINTS: Readonly<Record<InteractionPrecision, string>> = { date: INTERACTION_COPY.precisionDate.body, approximate: INTERACTION_COPY.precisionApproximate.body, unknown: INTERACTION_COPY.precisionUnknown.body };

/** The two states of the optional task section: no task at all, or one task created as a second change. */
type TaskIntent = "none" | "create";
const TASK_INTENTS = ["none", "create"] as const satisfies readonly TaskIntent[];
const TASK_INTENT_LABELS: Readonly<Record<TaskIntent, string>> = { none: "No follow-up task", create: "Create a follow-up task" };
const TASK_INTENT_HINTS: Readonly<Record<TaskIntent, string>> = { none: "Save the interaction on its own.", create: "Save the interaction, then the task as a second change." };

/** Whether the task is linked to the record this interaction is about, or stands alone. */
type TaskLink = "this-record" | "no-link";
const TASK_LINKS = ["this-record", "no-link"] as const satisfies readonly TaskLink[];
const TASK_LINK_LABELS: Readonly<Record<TaskLink, string>> = { "this-record": "This contact", "no-link": "No link" };
const TASK_LINK_HINTS: Readonly<Record<TaskLink, string>> = { "this-record": "The task is filed against the record this interaction is about.", "no-link": "The task is filed on its own, with no record attached." };

/** Every member the form holds. Each is text or one of the two closed choices, because each control is a text control or a radio group. */
interface InteractionFormValues {
  type: string;
  precision: InteractionPrecision;
  date: string;
  outcome: string;
  note: string;
  taskIntent: TaskIntent;
  taskTitle: string;
  taskDueOn: string;
  taskLink: TaskLink;
}

const INITIAL_VALUES: InteractionFormValues = { type: "", precision: "date", date: "", outcome: "", note: "", taskIntent: "none", taskTitle: "", taskDueOn: "", taskLink: "this-record" };

/** The field paths a refusal names, spelled the way the control beside each one is labelled. */
const INTERACTION_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { partnerId: SUBJECT_LEGEND, type: TYPE_LABEL, "occurredOn.precision": PRECISION_LEGEND, "occurredOn.date": DATE_LABEL, outcome: OUTCOME_LABEL, participants: PARTNERS_LABEL, "participants.0.role": ROLE_LABEL, note: NOTE_LABEL };
const INTERACTION_FIELD_ORDER = ["type", "occurredOn.precision", "occurredOn.date", "outcome", "participants", "participants.0.role", "note"] as const;
const TASK_FIELD_LABELS: Readonly<Record<string, string | undefined>> = { title: TASK_TITLE_LABEL, dueOn: TASK_DUE_LABEL, partnerId: TASK_LINK_LEGEND, operation: TASK_HEADING };
const TASK_FIELD_ORDER = ["title", "dueOn", "partnerId"] as const;

/** Whether two strings name the same closed choice, so a control's open value narrows without a cast. */
function isOneOf<T extends string>(choices: readonly T[], value: unknown): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

const isInteractionPrecision = (value: unknown): value is InteractionPrecision => isOneOf(INTERACTION_PRECISIONS, value);
const isTaskIntent = (value: unknown): value is TaskIntent => isOneOf(TASK_INTENTS, value);
const isTaskLink = (value: unknown): value is TaskLink => isOneOf(TASK_LINKS, value);

/** The members a control is described by, so the field's hint, its error and the form's context are all announced. */
function controlAria(control: FormFieldControl): { "aria-describedby": string | undefined; "aria-invalid": true | undefined } {
  return { "aria-describedby": control.describedBy, "aria-invalid": control.invalid ? true : undefined };
}

/** A refusal raised in this browser, read through the one owner of the path-to-message mapping so no second copy of it lives here. */
function refusalOf(error: ZodError): FieldErrorLookup {
  return fieldErrorsFromInvalid(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: error }));
}

/** What one settled attempt means for the rest of this form: whether the entry it came from is finished. */
interface Settlement {
  /** The change was applied or replayed, so the entry it came from is recorded and the form is ready for the next one. */
  readonly finished: boolean;
}

/** The interaction's own reading of the eight outcomes: only an applied or replayed change finishes the entry. */
function interactionSettlement(outcome: MutationOutcome): Settlement {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
      return { finished: true };
    case "unchanged":
    case "conflict":
    case "denied":
    case "invalid":
    case "unavailable":
    case "unknown":
      // Nothing was written, or nothing is known to have been: the entry stays exactly as it was typed.
      return { finished: false };
    default:
      return assertNever(outcome, "Unhandled interaction outcome");
  }
}

/** The task's own reading of the eight outcomes, decided separately because the task's entry is a second entry. */
function taskSettlement(outcome: MutationOutcome): Settlement {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
      return { finished: true };
    case "unchanged":
    case "conflict":
    case "denied":
    case "invalid":
    case "unavailable":
    case "unknown":
      return { finished: false };
    default:
      return assertNever(outcome, "Unhandled follow-up-task outcome");
  }
}

/** Posts one task creation and answers the outcome the handler produced; a request whose answer this browser cannot read is `unknown`, which is the only honest report for a fate it cannot know. */
async function postTask(body: MutationInput<NextTaskPayload>): Promise<MutationOutcome> {
  let response: Response;
  try {
    response = await fetch(TASKS_PATH, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  } catch {
    return { outcome: "unknown", operationId: body.operationId };
  }
  let answered: unknown;
  try {
    answered = await response.json();
  } catch {
    return { outcome: "unknown", operationId: body.operationId };
  }
  return isOutcome(answered) ? answered : { outcome: "unknown", operationId: body.operationId };
}

/** The outcomes that wrote nothing at all, so an edit retires their receipt rather than leaving a refusal describing values that are no longer on screen. */
const CLEARED_BY_EDIT: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["invalid", "conflict", "denied", "unavailable"]);

/** The identity of one task intent: the revision it presents and the exact change it asks for, so two equal intents produce one string. */
function taskIntentOf(expectedRevision: string, payload: NextTaskPayload): string {
  return JSON.stringify([expectedRevision, payload.operation, payload.title, payload.dueOn ?? null, payload.partnerId ?? null]);
}

/** Reports one settled attempt to its caller, because a fault in the caller's own reaction can never remove the receipt. */
function notify(handler: ((outcome: MutationOutcome) => void) | undefined, outcome: MutationOutcome): void {
  if (handler === undefined) {
    return;
  }
  try {
    handler(outcome);
  } catch {
    // The caller's reaction is not this form's answer, so it is not allowed to displace it.
  }
}

/** The chosen participants as one list: the record this interaction is about first, then each other person in the order the picker lists them. */
function participantsOf(partnerId: string, subjectRole: string, chosen: readonly PartnerSelection[], roles: Readonly<Record<string, string>>): { partnerId: string; role: string }[] {
  const seen = new Set<string>([partnerId]);
  const participants = [{ partnerId, role: subjectRole }];
  for (const selection of chosen) {
    // One record is one participant however it was chosen: the subject never appears twice, and a selection that
    // repeats a record already stated is left out rather than counted as a second person.
    if (seen.has(selection.partnerId)) {
      continue;
    }
    seen.add(selection.partnerId);
    participants.push({ partnerId: selection.partnerId, role: roles[partnerSelectionRef(selection)] ?? "" });
  }
  return participants;
}

/** The interaction change as this form states it, left unjudged so the family's own schema names anything wrong with it. */
function interactionCandidateOf(partnerId: string, values: InteractionFormValues, subjectRole: string, chosen: readonly PartnerSelection[], roles: Readonly<Record<string, string>>): unknown {
  const stated = values.date.trim();
  return {
    partnerId,
    type: values.type,
    // An unknown day carries no date at all: sending an empty one would state a day that does not exist, and sending a
    // remembered one would record a day the worker has just said they do not know.
    occurredOn: values.precision === "unknown" ? { precision: values.precision } : { precision: values.precision, ...(stated === "" ? {} : { date: stated }) },
    outcome: values.outcome,
    participants: participantsOf(partnerId, subjectRole, chosen, roles),
    ...(values.note.trim() === "" ? {} : { note: values.note }),
  };
}

/** The optional task as this form states it, left unjudged so the schema shared with the work family names anything wrong with it. */
function taskCandidateOf(partnerId: string, values: InteractionFormValues): unknown {
  const due = values.taskDueOn.trim();
  return { title: values.taskTitle, ...(due === "" ? {} : { dueOn: due }), ...(values.taskLink === "this-record" ? { partnerId } : {}) };
}

/** The records the picker may offer: the ones chosen so far, in order, with the subject's own record left out. */
function otherParticipants(partnerId: string, chosen: readonly PartnerSelection[]): readonly PartnerSelection[] {
  const seen = new Set<string>([partnerId]);
  return chosen.filter((selection) => {
    if (seen.has(selection.partnerId)) {
      return false;
    }
    seen.add(selection.partnerId);
    return true;
  });
}

/** One radio in a group that states its own hint, so a choice is explained beside the control rather than only in a legend. */
function RadioOption({ optionId, value, label, hint }: { readonly optionId: string; readonly value: string; readonly label: string; readonly hint: string }): ReactElement {
  const hintId = `${optionId}-hint`;
  return (
    <label htmlFor={optionId} className="flex min-h-target min-w-0 items-start gap-3 py-1">
      <RadioGroupItem id={optionId} value={value} aria-label={label} aria-describedby={hintId} className="mt-0.5" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span id={hintId} className="text-sm text-pretty text-muted-foreground">
          {hint}
        </span>
      </span>
    </label>
  );
}

/** Props of {@link InteractionForm}. */
export interface InteractionFormProps {
  /** The authority this form acts in, exactly as the envelope that admitted the record reported it. Never re-derived here. */
  readonly scope: Scope;
  /** The opaque reference of the record this interaction is recorded against — an identifier, never a name, an address or an email match. */
  readonly partnerId: string;
  /** The revision the caller read. Every attempt presents it, so a change made elsewhere is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** The subject record as the read admitted it, when the caller has it: it names the fixed first participant and keeps that record out of the picker. Omitted, the row states the opaque reference alone. */
  readonly subject?: PartnerSelection | null;
  /** Participants the caller already chose. They are listed after the subject and each one can be removed. */
  readonly initialParticipants?: readonly PartnerSelection[];
  /** Called with the outcome of each settled interaction attempt, so the caller can re-read the record it already owns. */
  readonly onSettled?: (outcome: MutationOutcome) => void;
  /** Called with the outcome of each settled follow-up-task attempt, which is a second change with its own identity. */
  readonly onTaskSettled?: (outcome: MutationOutcome) => void;
  /** The direction this block is laid out in, stated here rather than by a CSS base direction. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}

/**
 * Logs one interaction that actually happened, and optionally saves the next task as a second, independent change.
 * Each attempt answers one of the eight outcomes and renders its own durable receipt beside the section it belongs
 * to, so what happened to the interaction and what happened to the task are never combined into one report.
 */
export default function InteractionForm({ scope, partnerId, expectedRevision, subject = null, initialParticipants, onSettled, onTaskSettled, dir, className }: InteractionFormProps): ReactElement {
  const headingId = useId();
  const optionIdPrefix = useId();
  const log = useLogInteraction(partnerId);
  const form = useForm({ defaultValues: { ...INITIAL_VALUES } });
  const [participants, setParticipants] = useState<readonly PartnerSelection[]>(() => [...(initialParticipants ?? [])]);
  const [roles, setRoles] = useState<Readonly<Record<string, string>>>({});
  const [subjectRole, setSubjectRole] = useState("");
  const [interactionRefusal, setInteractionRefusal] = useState<FieldErrorLookup | null>(null);
  const [taskRefusal, setTaskRefusal] = useState<FieldErrorLookup | null>(null);
  const [taskOutcome, setTaskOutcome] = useState<MutationOutcome | null>(null);
  const [taskPending, setTaskPending] = useState(false);
  // The revision a re-apply presents after a conflict: the receipt states the one the record holds now, and adopting
  // it is what makes applying this input again a deliberate act rather than a stale write repeated. It is used only
  // while the caller still hands over the revision it read, so a caller that re-reads supplies a fresh one.
  const [adoptedRevision, setAdoptedRevision] = useState<{ readonly from: string; readonly revision: string } | null>(null);
  const interactionBusy = useRef(false);
  // The attempt a recovery replays: the exact payload and revision last sent, and the task that was waiting on it.
  const lastInteractionAttempt = useRef<{ readonly expectedRevision: string; readonly payload: LogInteractionPayload; readonly preparedTask: NextTaskPayload | null } | null>(null);
  const taskBusy = useRef(false);
  // The task's own identity, kept per intent: a retry of unchanged work replays it, and a genuinely different task
  // mints a new one, so no path here can send a second task for work that may already exist.
  const taskIdentity = useRef<{ readonly intent: string; readonly operationId: string } | null>(null);
  const lastTaskAttempt = useRef<{ readonly operationId: string; readonly payload: NextTaskPayload } | null>(null);
  const revision = adoptedRevision !== null && adoptedRevision.from === expectedRevision ? adoptedRevision.revision : expectedRevision;
  const pending = log.isPending || taskPending;
  const interactionOutcome = log.outcome;
  const interactionStanding = interactionOutcome !== null && (interactionOutcome.outcome === "accepted" || interactionOutcome.outcome === "alreadyAccepted");
  const unconfirmed = interactionOutcome !== null && interactionOutcome.outcome === "unknown";
  const interactionErrors = interactionRefusal ?? (interactionOutcome !== null && interactionOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(interactionOutcome) : null);
  const taskErrors = taskRefusal ?? (taskOutcome !== null && taskOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(taskOutcome) : null);
  const extras = otherParticipants(partnerId, participants);
  const subjectName = subject === null ? null : subject.displayName;

  // A refusal describes the values the last submit presented, so it stops describing them the moment one changes.
  // Nothing typed is cleared with it: every field and every participant stays exactly as it was entered, and only a
  // receipt for a change that wrote nothing is retired. A receipt for `unknown` is never retired, because its identity
  // is the only way to find out what happened.
  const editedInteraction = (): void => {
    setInteractionRefusal(null);
    if (interactionOutcome !== null && CLEARED_BY_EDIT.has(interactionOutcome.outcome)) {
      log.reset();
    }
  };

  const editedTask = (): void => {
    setTaskRefusal(null);
    if (taskOutcome !== null && CLEARED_BY_EDIT.has(taskOutcome.outcome)) {
      setTaskOutcome(null);
    }
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
    // The role this person was given is kept, so re-adding the same record restores what was typed rather than
    // asking for it again.
    setParticipants((current) => current.filter((selection) => partnerSelectionRef(selection) !== reference));
    setInteractionRefusal(null);
  };

  /** Clears the interaction's own entry once it is recorded, and leaves the task draft exactly as it stands. */
  const clearInteractionEntry = (): void => {
    form.setFieldValue("type", INITIAL_VALUES.type);
    form.setFieldValue("precision", INITIAL_VALUES.precision);
    form.setFieldValue("date", INITIAL_VALUES.date);
    form.setFieldValue("outcome", INITIAL_VALUES.outcome);
    form.setFieldValue("note", INITIAL_VALUES.note);
    setSubjectRole("");
    setParticipants([]);
    setRoles({});
    setInteractionRefusal(null);
    setAdoptedRevision(null);
  };

  /** Clears the task entry once the task itself is recorded: this is the only place a task draft is ever discarded. */
  const clearTaskEntry = (): void => {
    form.setFieldValue("taskIntent", INITIAL_VALUES.taskIntent);
    form.setFieldValue("taskTitle", INITIAL_VALUES.taskTitle);
    form.setFieldValue("taskDueOn", INITIAL_VALUES.taskDueOn);
    form.setFieldValue("taskLink", INITIAL_VALUES.taskLink);
    setTaskRefusal(null);
    taskIdentity.current = null;
    lastTaskAttempt.current = null;
  };

  const settleTask = (outcome: MutationOutcome): void => {
    setTaskOutcome(outcome);
    if (taskSettlement(outcome).finished) {
      clearTaskEntry();
    }
    notify(onTaskSettled, outcome);
  };

  const submitTask = (payload: NextTaskPayload): void => {
    if (taskBusy.current) {
      return;
    }
    const intent = taskIntentOf(revision, payload);
    const retained = taskIdentity.current;
    const operationId = retained !== null && retained.intent === intent ? retained.operationId : newOperationId();
    taskIdentity.current = { intent, operationId };
    lastTaskAttempt.current = { operationId, payload };
    taskBusy.current = true;
    setTaskPending(true);
    void postTask({ operationId, scope, expectedRevision: revision, payload })
      .then(settleTask, () => undefined)
      .finally(() => {
        taskBusy.current = false;
        setTaskPending(false);
      });
  };

  /** Re-sends the exact task attempt that was made, under the identity it was first sent with: a replay, never a third effect. */
  const retryTask = (): void => {
    const retained = lastTaskAttempt.current;
    if (retained === null || taskBusy.current) {
      return;
    }
    taskBusy.current = true;
    setTaskPending(true);
    void postTask({ operationId: retained.operationId, scope, expectedRevision: revision, payload: retained.payload })
      .then(settleTask, () => undefined)
      .finally(() => {
        taskBusy.current = false;
        setTaskPending(false);
      });
  };

  const settleInteraction = (outcome: MutationOutcome, preparedTask: NextTaskPayload | null): void => {
    if (outcome.outcome === "conflict") {
      setAdoptedRevision({ from: expectedRevision, revision: outcome.currentRevision });
    }
    const settlement = interactionSettlement(outcome);
    if (settlement.finished) {
      clearInteractionEntry();
    }
    notify(onSettled, outcome);
    // The task is a second change and is sent only once the interaction's outcome is known: it waits for a change that
    // was applied or replayed, and it is never sent in the same breath as an interaction whose fate is undetermined.
    if (settlement.finished && preparedTask !== null) {
      submitTask(preparedTask);
    }
  };

  const attemptInteraction = (input: { readonly expectedRevision: string; readonly payload: LogInteractionPayload; readonly preparedTask: NextTaskPayload | null }): void => {
    if (interactionBusy.current || log.isPending) {
      return;
    }
    interactionBusy.current = true;
    lastInteractionAttempt.current = input;
    void log
      .submit({ scope, expectedRevision: input.expectedRevision, payload: input.payload })
      // The hook answers every attempt with one of the eight outcomes and never rejects; the rejection arm exists so a
      // defect in that contract cannot fence this form forever.
      .then(
        (outcome: MutationOutcome) => {
          settleInteraction(outcome, input.preparedTask);
        },
        () => undefined,
      )
      .finally(() => {
        interactionBusy.current = false;
      });
  };

  /** Re-sends the interaction attempt exactly as it was made, which the hook answers with the stored result rather than a second record. */
  const replayInteraction = (): void => {
    const retained = lastInteractionAttempt.current;
    if (retained === null) {
      return;
    }
    attemptInteraction(retained);
  };

  /** Applies the input kept on screen against the revision the receipt says the record holds now. */
  const reapplyInteraction = (): void => {
    const retained = lastInteractionAttempt.current;
    if (retained === null) {
      return;
    }
    attemptInteraction({ expectedRevision: revision, payload: retained.payload, preparedTask: retained.preparedTask });
  };

  const submitEntry = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pending || unconfirmed) {
      return;
    }
    const values = form.state.values;
    const interaction = logInteractionPayloadSchema.safeParse(interactionCandidateOf(partnerId, values, subjectRole, extras, roles));
    let preparedTask: NextTaskPayload | null = null;
    let task: ReturnType<typeof nextTaskPayloadSchema.safeParse> | null = null;
    if (values.taskIntent === "create") {
      task = nextTaskPayloadSchema.safeParse(taskCandidateOf(partnerId, values));
      if (task.success) {
        preparedTask = task.data;
      }
    }
    // Both halves are judged before either is sent, so a fault in the optional task never leaves an interaction
    // recorded against a form the worker still has to correct, and nothing typed is lost while they correct it.
    setInteractionRefusal(interaction.success ? null : refusalOf(interaction.error));
    setTaskRefusal(task !== null && !task.success ? refusalOf(task.error) : null);
    if (!interaction.success || (task !== null && !task.success)) {
      return;
    }
    attemptInteraction({ expectedRevision: revision, payload: interaction.data, preparedTask });
  };

  const saveTaskAlone = (): void => {
    if (pending) {
      return;
    }
    const task = nextTaskPayloadSchema.safeParse(taskCandidateOf(partnerId, form.state.values));
    if (!task.success) {
      setTaskRefusal(refusalOf(task.error));
      return;
    }
    setTaskRefusal(null);
    submitTask(task.data);
  };

  return (
    <section data-slot="interaction-form" dir={dir} aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="font-heading text-lg font-medium text-pretty">
          {HEADING}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{LEAD}</p>
      </div>
      {/* What the entry states, and what it never states, said where the record is about to be written rather than
       * afterwards: a gift, a task and an opened app are named here as things this form cannot record. */}
      <Alert data-slot="interaction-scope" className="min-w-0">
        <AlertTitle>{INTERACTION_COPY.whatCounts.title}</AlertTitle>
        <AlertDescription>
          <p>{INTERACTION_COPY.whatCounts.body}</p>
          <p>{INTERACTION_COPY.whatDoesNot.body}</p>
          <p>{INTERACTION_COPY.recordedOnce.body}</p>
          <p>{INTERACTION_COPY.provesNothing.body}</p>
        </AlertDescription>
      </Alert>
      {/* The interaction's own receipt, durable and separate from the task's: each operation answers for itself. */}
      {interactionOutcome === null ? null : <OperationResult outcome={interactionOutcome} headingLevel={PART_RECEIPT_HEADING} fieldLabels={INTERACTION_FIELD_LABELS} onCheckResult={replayInteraction} onRetrySameWork={replayInteraction} onReapply={reapplyInteraction} className="min-w-0" />}
      <form onSubmit={submitEntry} noValidate aria-busy={pending ? true : undefined} className="flex min-w-0 flex-col gap-6">
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <>
              {interactionRefusal === null ? null : <FormErrorSummary errors={interactionRefusal} labels={INTERACTION_FIELD_LABELS} order={INTERACTION_FIELD_ORDER} headingLevel={PART_RECEIPT_HEADING} />}
              <form.Field name="type">
                {(field) => (
                  <FormField name="type" label={TYPE_LABEL} description={TYPE_DESCRIPTION} error={interactionErrors?.byField.type} required>
                    {(control) => (
                      <NativeSelect
                        id={control.id}
                        className="w-full sm:max-w-72"
                        value={field.state.value}
                        aria-required={control.required ? true : undefined}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                          editedInteraction();
                        }}
                        onBlur={field.handleBlur}
                        {...controlAria(control)}
                      >
                        <NativeSelectOption value="">{TYPE_PLACEHOLDER}</NativeSelectOption>
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
              <FormFieldGroup legend={PRECISION_LEGEND} name="occurredOn.precision" description={PRECISION_DESCRIPTION} error={interactionErrors?.byField["occurredOn.precision"]} required>
                {(group) => (
                  <form.Field name="precision">
                    {(field) => (
                      <RadioGroup
                        value={field.state.value}
                        onValueChange={(next) => {
                          if (!isInteractionPrecision(next)) {
                            return;
                          }
                          field.handleChange(next);
                          editedInteraction();
                        }}
                        aria-labelledby={group.legendId}
                        aria-describedby={group.describedBy}
                        aria-invalid={group.invalid ? true : undefined}
                      >
                        {INTERACTION_PRECISIONS.map((precision) => (
                          <RadioOption key={precision} optionId={`${optionIdPrefix}-precision-${precision}`} value={precision} label={PRECISION_LABELS[precision]} hint={PRECISION_HINTS[precision]} />
                        ))}
                      </RadioGroup>
                    )}
                  </form.Field>
                )}
              </FormFieldGroup>
              {values.precision === "unknown" ? (
                // No date control at all when the day is not known: a field the worker must leave blank is a field that
                // invites an invented answer, and the entry states the absence instead.
                <p className="text-sm text-pretty text-muted-foreground">{UNKNOWN_DATE_NOTE}</p>
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <form.Field name="date">
                    {(field) => (
                      <FormField name="occurredOn.date" label={DATE_LABEL} description={DATE_DESCRIPTION} error={interactionErrors?.byField["occurredOn.date"]} required>
                        {(control) => (
                          <Input
                            id={control.id}
                            type="date"
                            className="w-full sm:max-w-60"
                            value={field.state.value}
                            aria-required={control.required ? true : undefined}
                            onChange={(event) => {
                              field.handleChange(event.currentTarget.value);
                              editedInteraction();
                            }}
                            onBlur={field.handleBlur}
                            {...controlAria(control)}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>
                  {values.precision === "approximate" ? <p className="text-sm text-pretty text-muted-foreground">{APPROXIMATE_NOTE}</p> : null}
                </div>
              )}
              <form.Field name="outcome">
                {(field) => (
                  <FormField name="outcome" label={OUTCOME_LABEL} description={OUTCOME_DESCRIPTION} error={interactionErrors?.byField.outcome} required>
                    {(control) => (
                      <Textarea
                        id={control.id}
                        rows={3}
                        value={field.state.value}
                        aria-required={control.required ? true : undefined}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                          editedInteraction();
                        }}
                        onBlur={field.handleBlur}
                        {...controlAria(control)}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
              <Separator />
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="font-heading text-base font-medium text-pretty">{PARTICIPANTS_HEADING}</h3>
                  <p className="text-sm text-pretty text-muted-foreground">{PARTICIPANTS_HELP}</p>
                </div>
                <FormFieldGroup legend={SUBJECT_LEGEND} name="participants.0" error={interactionErrors?.byField["participants.0"]} className="rounded-xl border border-border p-4">
                  {() => (
                    <div className="flex min-w-0 flex-col gap-3">
                      {/* The subject's own words are isolated from the surrounding direction; a reference is an opaque
                       * identifier, so it is stated in the monospace identifier style rather than read as a value. */}
                      <p className="flex min-w-0 flex-col gap-1 text-sm">
                        {subjectName === null ? null : <bdi className="min-w-0 font-medium break-words">{subjectName}</bdi>}
                        <bdi className="mono-identifier min-w-0 break-words text-xs text-muted-foreground">{subject === null ? partnerId : partnerSelectionRef(subject)}</bdi>
                        <span className="text-pretty text-muted-foreground">{SUBJECT_FIXED_NOTE}</span>
                      </p>
                      <FormField name="participants.0.role" label={ROLE_LABEL} description={ROLE_DESCRIPTION} error={interactionErrors?.byField["participants.0.role"]} required>
                        {(control) => (
                          <Input
                            id={control.id}
                            type="text"
                            autoComplete="off"
                            className="w-full sm:max-w-72"
                            value={subjectRole}
                            aria-required={control.required ? true : undefined}
                            onChange={(event) => {
                              setSubjectRoleValue(event.currentTarget.value);
                            }}
                            {...controlAria(control)}
                          />
                        )}
                      </FormField>
                    </div>
                  )}
                </FormFieldGroup>
                <PartnerPicker
                  mode="multiple"
                  scope={scope}
                  name="participants"
                  label={PARTNERS_LABEL}
                  description={PARTNERS_DESCRIPTION}
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
                          <FormFieldGroup legend={`${PARTICIPANT_LEGEND_PREFIX} ${String(number)}`} name={path} error={interactionErrors?.byField[path]} className="rounded-xl border border-border p-4">
                            {() => (
                              <div className="flex min-w-0 flex-col gap-3">
                                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                                  <p className="flex min-w-0 flex-col gap-1 text-sm">
                                    <bdi className="min-w-0 font-medium break-words">{selection.displayName}</bdi>
                                    <bdi className="mono-identifier min-w-0 break-words text-xs text-muted-foreground">{reference}</bdi>
                                  </p>
                                  <Button type="button" variant="outline" size="sm" className="min-h-target max-w-full whitespace-normal" onClick={() => removeParticipant(reference)}>
                                    {`${REMOVE_PARTICIPANT_PREFIX} ${String(number)}`}
                                  </Button>
                                </div>
                                <FormField name={`${path}.role`} label={ROLE_LABEL} description={ROLE_DESCRIPTION} error={interactionErrors?.byField[`${path}.role`]} required>
                                  {(control) => (
                                    <Input
                                      id={control.id}
                                      type="text"
                                      autoComplete="off"
                                      className="w-full sm:max-w-72"
                                      value={roles[reference] ?? ""}
                                      aria-required={control.required ? true : undefined}
                                      onChange={(event) => {
                                        setRole(reference, event.currentTarget.value);
                                      }}
                                      {...controlAria(control)}
                                    />
                                  )}
                                </FormField>
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
              <form.Field name="note">
                {(field) => (
                  <FormField name="note" label={NOTE_LABEL} description={NOTE_DESCRIPTION} error={interactionErrors?.byField.note} optionalHint>
                    {(control) => (
                      <Textarea
                        id={control.id}
                        rows={3}
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                          editedInteraction();
                        }}
                        onBlur={field.handleBlur}
                        {...controlAria(control)}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
              <Separator />
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="font-heading text-base font-medium text-pretty">{TASK_HEADING}</h3>
                  <p className="text-sm text-pretty text-muted-foreground">{TASK_LEAD}</p>
                </div>
                <FormFieldGroup legend={TASK_INTENT_LEGEND} name="task-intent" description={TASK_INTENT_DESCRIPTION}>
                  {(group) => (
                    <form.Field name="taskIntent">
                      {(field) => (
                        <RadioGroup
                          value={field.state.value}
                          onValueChange={(next) => {
                            if (!isTaskIntent(next)) {
                              return;
                            }
                            field.handleChange(next);
                            editedTask();
                          }}
                          aria-labelledby={group.legendId}
                          aria-describedby={group.describedBy}
                        >
                          {TASK_INTENTS.map((intent) => (
                            <RadioOption key={intent} optionId={`${optionIdPrefix}-task-intent-${intent}`} value={intent} label={TASK_INTENT_LABELS[intent]} hint={TASK_INTENT_HINTS[intent]} />
                          ))}
                        </RadioGroup>
                      )}
                    </form.Field>
                  )}
                </FormFieldGroup>
                {values.taskIntent === "create" ? (
                  <div className="flex min-w-0 flex-col gap-4">
                    {taskRefusal === null ? null : <FormErrorSummary errors={taskRefusal} labels={TASK_FIELD_LABELS} order={TASK_FIELD_ORDER} headingLevel={4} />}
                    <form.Field name="taskTitle">
                      {(field) => (
                        <FormField name="title" label={TASK_TITLE_LABEL} description={TASK_TITLE_DESCRIPTION} error={taskErrors?.byField.title} required>
                          {(control) => (
                            <Input
                              id={control.id}
                              type="text"
                              autoComplete="off"
                              className="w-full sm:max-w-96"
                              value={field.state.value}
                              aria-required={control.required ? true : undefined}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                                editedTask();
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                    <form.Field name="taskDueOn">
                      {(field) => (
                        <FormField name="dueOn" label={TASK_DUE_LABEL} description={TASK_DUE_DESCRIPTION} error={taskErrors?.byField.dueOn} optionalHint>
                          {(control) => (
                            <Input
                              id={control.id}
                              type="date"
                              className="w-full sm:max-w-60"
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                                editedTask();
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                    <FormFieldGroup legend={TASK_LINK_LEGEND} name="partnerId" description={TASK_LINK_DESCRIPTION} error={taskErrors?.byField.partnerId}>
                      {(group) => (
                        <form.Field name="taskLink">
                          {(field) => (
                            <RadioGroup
                              value={field.state.value}
                              onValueChange={(next) => {
                                if (!isTaskLink(next)) {
                                  return;
                                }
                                field.handleChange(next);
                                editedTask();
                              }}
                              aria-labelledby={group.legendId}
                              aria-describedby={group.describedBy}
                              aria-invalid={group.invalid ? true : undefined}
                              orientation="horizontal"
                            >
                              {TASK_LINKS.map((link) => (
                                <RadioOption key={link} optionId={`${optionIdPrefix}-task-link-${link}`} value={link} label={TASK_LINK_LABELS[link]} hint={TASK_LINK_HINTS[link]} />
                              ))}
                            </RadioGroup>
                          )}
                        </form.Field>
                      )}
                    </FormFieldGroup>
                    {/* Once the interaction is recorded, the task is its own change and is saved on its own: a task the
                     * worker had to correct is finished here without sending anything about the interaction again. */}
                    {interactionStanding ? (
                      <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="outline" className="min-h-target max-w-full whitespace-normal" disabled={pending} onClick={saveTaskAlone}>
                            {taskPending ? TASK_SAVE_PENDING_LABEL : TASK_SAVE_LABEL}
                          </Button>
                        </div>
                        <p className="text-sm text-pretty text-muted-foreground">{TASK_SAVE_NOTE}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {taskOutcome === null ? null : <OperationResult outcome={taskOutcome} headingLevel={4} fieldLabels={TASK_FIELD_LABELS} onCheckResult={retryTask} onRetrySameWork={retryTask} className="min-w-0" />}
              </div>
              <Separator />
              <div className="flex min-w-0 flex-col gap-2">
                {/* While the last attempt is unconfirmed there is no control to press: the receipt above carries the one
                 * honest next step, and a second submit is not offered for work that may already exist. */}
                {unconfirmed ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" className="min-h-target max-w-full whitespace-normal" disabled={pending}>
                      {log.isPending ? SUBMIT_PENDING_LABEL : SUBMIT_LABEL}
                    </Button>
                  </div>
                )}
                <p className="text-sm text-pretty text-muted-foreground">{unconfirmed ? UNCONFIRMED_NOTE : SUBMIT_NOTE}</p>
              </div>
            </>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}
