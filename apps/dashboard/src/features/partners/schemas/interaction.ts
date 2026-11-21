/**
 * The Partners family's `logInteraction` payload schema, plus the follow-up task the same form offers
 * as a *second* operation.
 *
 * This is the payload half of `{ operationId, scope, expectedRevision, payload }`. The three envelope
 * members are composed by `../hooks/use-partner-mutations.ts` from the record the form read, so nothing
 * here declares an operation identity, a selected scope or a revision: the strict objects below refuse
 * a payload that carries one instead of accepting a member nobody wrote. It decides shape, never
 * admissibility — `logInteraction` re-validates with the schema it owns, re-checks the scope and the
 * record as it stands, and answers from the closed outcome set, so its verdict is the one that counts.
 *
 * Two operations, two operation identities. The interaction and the next task are separate named
 * mutations (`logInteraction`, and the work family's `createTask`), so a task that fails to save can
 * never re-post an interaction that already saved once — the recovery criterion 3 requires of the
 * journey "log an actual interaction → create a next task". {@link nextTaskPayloadSchema} is the
 * carry-over that form submits under its own `operationId`, and it stays deliberately smaller than the
 * Work family's task composer: a title plus the plan a follow-up needs, never a second place to
 * author work.
 *
 * What a payload here cannot say is the point of it. No member states an amount, a currency, a gift, a
 * payment, a pledge, a commitment, a delivery, an open or a launch, because none of those is something
 * that happened with a person: a gift and a scheduled task are not interactions, and opening a mail or
 * dialer app is not contact. `occurredOn` is a civil date and its `precision` is the honesty of that
 * date, so "I do not know when" is representable and never becomes a fabricated day. `revision`,
 * `interactionId`, `authorPrincipalId`, `createdAt` and `provenance` are absent because the service
 * records who wrote what and when, and a source-recorded event carries its own reference.
 *
 * The shape mirrors the members `logInteraction` accepts, so a payload that parses here is the payload
 * the service receives: `partnerId`, `type`, `occurredOn` with its precision, `outcome`, `participants`
 * and an optional note. Matching the service's members and field paths rather than inventing a flatter
 * shape is what makes a refusal the form catches land on the same control as the same refusal the
 * service returns, since `outcome.ts` keys an `invalid` outcome by the joined path. Two members
 * therefore follow the service rather than the plan's first sketch: the day carries its precision as a
 * member of its own object, and a participant states the record it names together with the worker's
 * role for that person.
 *
 * No clock is read here, and no `Date` is constructed even to ask whether a day exists: a civil date is
 * judged by arithmetic on its own digits, because an instant, a zone or a local clock has no place in a
 * value that must stay a day. The service reads the same string through the domain's date reader, and
 * that reading is the one that decides, so this predicate answers only for shape and calendar. No length
 * bound appears below either: the service holds the only bounds a stored record holds, and nothing
 * typed is trimmed, rewritten or defaulted on the way out, so the form submits exactly what the worker
 * entered and a refused save can put it back unchanged.
 *
 * Plan items: AAP 0.6.1 "Mutations: partners" (`logInteraction`), AAP 0.7.1's "Record what actually
 * happened" group, AAP 0.6.2's interaction record, AAP 0.8.2's interaction and task rules, AAP 0.10.1
 * journey 1, and AAP 0.12.1 criterion 3. Rule 1 clause 1: exactly these two payloads, with no member
 * for a capability the release defers; clause 3: the interaction, the task and the note's audience stay
 * distinct facts.
 */
import { z } from "zod";

import type { InteractionRecord } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

/**
 * The refusals these two schemas state, worded once.
 *
 * `../copy/privacy.ts` is the family's wording source for what an interaction records, what it is not
 * and what each precision means, and it holds no sentence for a value a form refused: these describe
 * the value and what to do about it, never the person who typed it. The empty-value sentences follow
 * the same pattern the service's own schemas use, so a mistake the form catches and the same mistake
 * the service catches read alike.
 */
const INTERACTION_MESSAGES = {
  partnerReferenceInvalid:
    "A record reference is text, so open the contact again and retry from its own page.",
  partnerReferenceRequired:
    "Name the contact this interaction is about, because an interaction is recorded against one record.",
  kindInvalid: "Choose the kind of contact that took place.",
  precisionInvalid: "Say how precisely you know the day: the day itself, roughly, or not at all.",
  dateInvalid:
    "State the day as a calendar date in YYYY-MM-DD form, because a day that does not exist is refused.",
  dateRequired: "State the day this interaction happened on, or record that you do not know when.",
  unknownPrecisionCarriesNoDate:
    "An unknown day carries no date, because a day entered there would be invented rather than known.",
  outcomeInvalid: "An outcome is text, so say in a sentence what came of the contact.",
  outcomeRequired: "Say what came of the contact.",
  participantsInvalid: "The people who took part are a list, so name them as a list of records.",
  participantReferenceInvalid:
    "A participant reference is text, so choose the person from the records this contact can see.",
  participantReferenceRequired:
    "Choose the person who took part, because a participant names a record rather than a typed name.",
  participantRoleInvalid: "A participant role is text, so say how this person took part.",
  participantRoleRequired: "Say how this person took part.",
  noteInvalid: "A note is text, so write it as plain text or leave it empty.",
  noteEmpty: "A note needs at least one visible character, or leave the field empty.",
  taskTitleInvalid: "A task title is text, so say in a few words what needs doing.",
  taskTitleRequired: "A follow-up task needs a title, so say what needs doing or leave the task out.",
  categoryInvalid: "A category is text, so enter a short label of your own or leave it empty.",
  taskKindInvalid: "Choose Task or Meeting as the kind of work.",
  plannedTimeInvalid: "A planned time is a day and a clock time together, so enter both.",
  timeZoneInvalid: "A timezone is text, so choose the zone this time is stated in.",
  timeZoneRequired:
    "Choose the timezone this time is stated in, so the time is never read in an assumed zone.",
  planOnlyForMeeting:
    "A planned time belongs to a meeting, so record the kind as Meeting or remove the time.",
  planTimeOtherDay:
    "The planned time falls on a different day from the due date, so make the two describe one plan.",
  linkInvalid: "Choose the linked contact from the list, so a link names a record rather than typed text.",
  taskNoteInvalid: "A note is text, so write a short reminder or leave it empty.",
} as const;

// ---------------------------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------------------------

/**
 * A reference to one record: present, and carrying at least one character.
 *
 * It is not trimmed and not repaired, because an identifier is an opaque value this application mints;
 * silently tidying one would let a form submit a reference to a record it did not name. A reference is
 * never a name, an email address or a postal address, so equal-looking details establish neither
 * identity nor authority and two records that look alike stay two records.
 */
function requiredReference(invalidMessage: string, emptyMessage: string): z.ZodString {
  return z.string({ error: invalidMessage }).min(1, emptyMessage);
}

/**
 * Text a person wrote: any non-empty plain text, kept exactly as it was entered.
 *
 * Emptiness is judged on the trimmed value, so text made only of spaces or a lone newline is refused;
 * the value itself is never trimmed, case-folded or otherwise normalised, because what the worker wrote
 * is what the record holds and what a refused save must put back in front of them unchanged. Zod
 * reports an absent key as a type error and an empty string as a blank value, so both sentences describe
 * the same field rather than one of them naming nothing.
 */
function requiredText(invalidMessage: string, emptyMessage: string): z.ZodString {
  return z
    .string({ error: invalidMessage })
    .refine((value) => value.trim().length > 0, { error: emptyMessage });
}

// ---------------------------------------------------------------------------------------------
// The kind of contact that took place
// ---------------------------------------------------------------------------------------------

/**
 * The closed set of things that actually happened with a partner.
 *
 * Every member is a kind of contact that took place, not a channel that was opened: `call` records a
 * conversation that happened, never the act of launching a dialer, and `written-exchange` records that
 * something was written and answered rather than that a message was sent. `other` is the one escape a
 * worker needs for something real that the five do not name, and it carries the same `outcome` sentence
 * as the rest, so no member is an invitation to record a hypothesis. No member means a gift, a payment,
 * a pledge, a scheduled task, an email open or a dialer open, which is why the form built on this list
 * cannot offer one.
 *
 * Declared here rather than imported: the set is owned by the mutation's own input schema, which is a
 * server module this form schema may not reach, and this list is also what the form's kind control
 * offers. The service still decides — a kind outside its set answers `invalid` — so a copy that fell
 * behind could offer less than the service admits, never more.
 */
export const INTERACTION_KINDS = [
  "conversation",
  "visit",
  "call",
  "meeting",
  "written-exchange",
  "other",
] as const;

/** One kind of contact a worker may record. */
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** Validates the kind of contact that took place against the closed set. */
export const interactionKindSchema = z.enum(INTERACTION_KINDS, {
  error: INTERACTION_MESSAGES.kindInvalid,
});

// ---------------------------------------------------------------------------------------------
// How precisely the day is known
// ---------------------------------------------------------------------------------------------

/**
 * The precision vocabulary of the record this payload becomes, read off the record's own field.
 *
 * Taken from the stored record rather than declared again, so the list below is checked against the one
 * union the domain names: a member removed there fails this declaration at compile time, instead of a
 * save refusing a legitimate precision at run time.
 */
type InteractionDatePrecision = InteractionRecord["precision"];

/**
 * The three precisions a recorded interaction day may carry.
 *
 * `date` and `approximate` state the day the event refers to, and `unknown` states that the day is not
 * known at all. The list is what the form's own precision control offers, so the choice a worker is shown
 * and the choice a record stores come from one declaration.
 */
export const INTERACTION_PRECISIONS = [
  "date",
  "approximate",
  "unknown",
] as const satisfies readonly InteractionDatePrecision[];

/** One precision an interaction day may be stated at. */
export type InteractionPrecision = (typeof INTERACTION_PRECISIONS)[number];

/** Validates how precisely the day of an interaction is known. */
export const interactionPrecisionSchema = z.enum(INTERACTION_PRECISIONS, {
  error: INTERACTION_MESSAGES.precisionInvalid,
});

// ---------------------------------------------------------------------------------------------
// A civil date, judged arithmetically
// ---------------------------------------------------------------------------------------------

/** The month lengths of the ISO calendar in a common year; February takes its leap length below. */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** The one accepted storage form of a civil date: four-digit year, two-digit month and day, nothing else. */
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Whether a year carries the leap day, by the calendar rule rather than by a date library.
 *
 * The rule is Gregorian: every fourth year, except centuries that are not divisible by four hundred.
 */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Whether a value is a calendar day that exists, judged from its own digits.
 *
 * A day past the end of its month is refused rather than rolled forward, and a date-time string is
 * refused rather than truncated, so the precision of a recorded day is never quietly widened or
 * narrowed. Only the shape and the calendar are decided here: the value stays the string the worker
 * chose, with its leading zeros exactly as entered, and no instant, zone or clock is consulted.
 */
function civilDateExists(value: string): boolean {
  if (!CIVIL_DATE_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) {
    return false;
  }
  const monthLength = month === 2 && isLeapYear(year) ? 29 : (MONTH_LENGTHS[month - 1] ?? 0);
  return day >= 1 && day <= monthLength;
}

/**
 * Validates a calendar day carried as `YYYY-MM-DD`.
 *
 * The same reading the service applies, made available to the form so a day that does not exist is
 * refused beside the control that chose it instead of after a round trip. The service's own date reader
 * still decides: this predicate answers for shape and calendar, and nothing here converts the day to an
 * instant or rebases it into another zone.
 */
export const civilDateSchema = z
  .string({ error: INTERACTION_MESSAGES.dateInvalid })
  .refine(civilDateExists, { error: INTERACTION_MESSAGES.dateInvalid });

// ---------------------------------------------------------------------------------------------
// The day, with the precision it is known to
// ---------------------------------------------------------------------------------------------

/**
 * Validates when the interaction happened: the day and how precisely it is known.
 *
 * The two travel together because neither is honest alone. `date` and `approximate` state the day the
 * event refers to, and `unknown` states that there is no day to state — so a precision of `unknown`
 * carrying a date fabricates a fact, and a known or approximate precision carrying none leaves the
 * record without the day it claims to know. This mirrors the stored record's own rule rather than
 * adding one: AAP 0.6.2 states an unrecorded date as unknown precision with no date, and the two never
 * disagree.
 *
 * The member is an object rather than two sibling fields for the reason the form cares about: an issue
 * lands on `occurredOn.date`, which is both the path a form renders the day under and the path the
 * service's own `invalid` outcome names, so one refusal reaches one control however it was caught.
 */
export const interactionOccurredOnSchema = z
  .strictObject({
    precision: interactionPrecisionSchema,
    date: civilDateSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.precision === "unknown" && value.date !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: INTERACTION_MESSAGES.unknownPrecisionCarriesNoDate,
      });
      return;
    }
    if (value.precision !== "unknown" && value.date === undefined) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: INTERACTION_MESSAGES.dateRequired,
      });
    }
  });

/** The validated day of an interaction: its civil date, when there is one, beside its precision. */
export type InteractionOccurredOn = z.infer<typeof interactionOccurredOnSchema>;

// ---------------------------------------------------------------------------------------------
// Who took part
// ---------------------------------------------------------------------------------------------

/**
 * One participant in the interaction: the record a person is known by, and the worker's own word for
 * how they took part.
 *
 * `partnerId` is an opaque reference to a record in the selected context, never a name, an email address
 * or a postal address, so two people who look alike in a directory stay two participants and a name
 * typed here could never be read as a person. `role` is the worker's own short label rather than a
 * controlled vocabulary. The acting principal is absent on purpose: the recorder is the session's own
 * principal, so a payload that could name a principal could attribute participation to a colleague who
 * took no part.
 */
export const interactionParticipantSchema = z.strictObject({
  partnerId: requiredReference(
    INTERACTION_MESSAGES.participantReferenceInvalid,
    INTERACTION_MESSAGES.participantReferenceRequired,
  ),
  role: requiredText(
    INTERACTION_MESSAGES.participantRoleInvalid,
    INTERACTION_MESSAGES.participantRoleRequired,
  ),
});

/** One validated participant: the record that took part and the role the worker gives them. */
export type InteractionParticipantInput = z.infer<typeof interactionParticipantSchema>;

// ---------------------------------------------------------------------------------------------
// The note the worker attaches
// ---------------------------------------------------------------------------------------------

/**
 * Validates the text of the note attached to an interaction.
 *
 * The stored note is audience-labelled, and its audience is not a member of this payload because it is
 * not a caller's choice: `logInteraction` files every interaction note as private. A form that offered a
 * shared audience would promise a filing the service never performs, so the private/shared distinction
 * stays where it is decided — in the record and in the copy that labels it — and no field here can get
 * it wrong. Widening it to a second audience means widening the mutation, not this schema.
 *
 * The text itself is kept exactly as entered: no length bound is set, because the service holds the only
 * bound a stored note holds and refuses a longer one with its own message rather than truncating it.
 */
export const interactionNoteBodySchema = requiredText(
  INTERACTION_MESSAGES.noteInvalid,
  INTERACTION_MESSAGES.noteEmpty,
);

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

/**
 * Validates what `logInteraction` submits: one record, the kind of contact, the day with its precision,
 * what came of it, who took part and an optional note.
 *
 * `participants` is required and may be empty. The stored record admits an interaction with nobody named,
 * so this schema states no minimum the record does not state; `logInteraction` answers for the minimum it
 * applies, and its message reaches this same list. Each row's issues are keyed by its index, so a refusal
 * names the participant that has to be corrected rather than the list as a whole.
 *
 * `provenance` is absent because it belongs to an event another system recorded rather than to a worker's
 * form: the service holds the reference when a source supplies one, and no field here lets a form claim
 * one. The object is strict, so an unexpected member — an `amount`, a `currency`, a `giftId`, a
 * `taskId`, a `revision`, an `interactionId`, a `createdAt` — is refused rather than stripped, and a
 * caller never comes away believing it recorded something it did not.
 */
export const logInteractionPayloadSchema = z.strictObject({
  partnerId: requiredReference(
    INTERACTION_MESSAGES.partnerReferenceInvalid,
    INTERACTION_MESSAGES.partnerReferenceRequired,
  ),
  type: interactionKindSchema,
  occurredOn: interactionOccurredOnSchema,
  outcome: requiredText(INTERACTION_MESSAGES.outcomeInvalid, INTERACTION_MESSAGES.outcomeRequired),
  participants: z.array(interactionParticipantSchema, {
    error: INTERACTION_MESSAGES.participantsInvalid,
  }),
  note: interactionNoteBodySchema.optional(),
});

/** The validated `logInteraction` payload: the members the service's own input schema accepts. */
export type LogInteractionPayload = z.infer<typeof logInteractionPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// The follow-up task
// ---------------------------------------------------------------------------------------------

/**
 * The two kinds of work a follow-up can be, listed against the task record's own vocabulary.
 *
 * Ordinary work carries no schedule, and a meeting may state one without the plan ever reading as
 * something that was held.
 */
export const NEXT_TASK_KINDS = ["default", "meeting"] as const;

/** One kind of follow-up work. */
export type NextTaskKind = (typeof NEXT_TASK_KINDS)[number];

/** Validates the kind of follow-up work. */
export const nextTaskKindSchema = z.enum(NEXT_TASK_KINDS, {
  error: INTERACTION_MESSAGES.taskKindInvalid,
});

/** A bare clock reading, and a date-and-time control's value: the two shapes one plan is stated in. */
const PLANNED_CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const PLANNED_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u;

/**
 * The day a planned time belongs to, when the value states one.
 *
 * A bare clock reading states no day of its own — the due date is the day it belongs to — so the answer
 * is `null` rather than an assumed day, and no zone or offset is derived from it.
 */
function plannedDayOf(value: string): string | null {
  return PLANNED_DATE_TIME_PATTERN.test(value) ? value.slice(0, 10) : null;
}

/** Whether a value is a planned time: a clock reading alone, or a day and a clock reading together. */
function isPlannedTime(value: string): boolean {
  if (PLANNED_CLOCK_PATTERN.test(value)) {
    return true;
  }
  const day = plannedDayOf(value);
  return day !== null && civilDateExists(day);
}

/**
 * Validates a meeting's planned wall-clock time, by shape and calendar alone.
 *
 * The value is never converted to an instant and never re-zoned, because the zone is a separate member
 * the worker discloses: this member says what the clock will read, and `timeZone` says where that clock
 * is read.
 */
export const nextTaskPlannedTimeSchema = z
  .string({ error: INTERACTION_MESSAGES.plannedTimeInvalid })
  .refine(isPlannedTime, { error: INTERACTION_MESSAGES.plannedTimeInvalid });

/**
 * Validates the zone a planned time is stated in.
 *
 * Presence and text are checked here; whether the identifier resolves is the service's question, because
 * a list of zone names written into a form would be a second and staler source beside the build's own
 * timezone data.
 */
export const nextTaskTimeZoneSchema = z
  .string({ error: INTERACTION_MESSAGES.timeZoneInvalid })
  .refine((value) => value.trim().length > 0, { error: INTERACTION_MESSAGES.timeZoneInvalid });

/** The four members the planned-time rule reads. */
type NextTaskPlan = {
  readonly kind?: NextTaskKind | undefined;
  readonly dueOn?: string | undefined;
  readonly plannedTime?: string | undefined;
  readonly timeZone?: string | undefined;
};

/**
 * The one planned-time rule: a schedule belongs to a meeting, and a time is always stated in a zone.
 *
 * An ordinary task carrying a time or a zone is refused, because a task with a schedule would read as an
 * appointment the worker never made. A time with no zone, and a zone with no time, are refused, because
 * either alone states half of when the meeting is. A plan on a different day from the due date is
 * refused, because the two would describe two different plans. Honest: a meeting stating both, and a
 * meeting stating neither.
 *
 * This is the rule the service applies, and each issue is placed on the member the form edits it beside.
 * Whether the zone identifier resolves, and whether a repeated task admits one more occurrence, remain
 * the service's questions.
 */
function refineNextTaskPlan(value: NextTaskPlan, context: z.RefinementCtx): void {
  const statedTime = (value.plannedTime ?? "").trim().length > 0 ? value.plannedTime : undefined;
  const hasTime = statedTime !== undefined;
  const hasZone = (value.timeZone ?? "").trim().length > 0;

  if ((value.kind ?? "default") === "default") {
    if (hasTime || hasZone) {
      context.addIssue({
        code: "custom",
        path: ["plannedTime"],
        message: INTERACTION_MESSAGES.planOnlyForMeeting,
      });
    }
    return;
  }

  if (hasTime && !hasZone) {
    context.addIssue({
      code: "custom",
      path: ["timeZone"],
      message: INTERACTION_MESSAGES.timeZoneRequired,
    });
    return;
  }
  if (!hasTime && hasZone) {
    context.addIssue({
      code: "custom",
      path: ["plannedTime"],
      message: INTERACTION_MESSAGES.timeZoneRequired,
    });
    return;
  }

  const plannedDay = statedTime === undefined ? null : plannedDayOf(statedTime);
  if (plannedDay !== null && value.dueOn !== undefined && plannedDay !== value.dueOn) {
    context.addIssue({
      code: "custom",
      path: ["plannedTime"],
      message: INTERACTION_MESSAGES.planTimeOtherDay,
    });
  }
}

/**
 * Validates the follow-up task the interaction form offers as a second operation.
 *
 * `title` is the only field a task cannot do without, so a follow-up written as three words is a complete
 * task. `partnerId` carries the contact the interaction was about when the worker keeps the link, and
 * `dueOn`, `kind`, `plannedTime` and `timeZone` state a plan: a civil due date, a wall-clock time beside
 * the zone that discloses it, and the meeting kind a plan belongs to.
 *
 * This is the minimal carry-over, not a task composer. The Work family owns task authoring, and nothing
 * here grows toward it: no repeat profile, no parent task, no attachment and no completion state, because
 * those are authored where work is planned rather than as a side effect of recording what happened.
 */
export const nextTaskPayloadSchema = z
  .strictObject({
    title: requiredText(
      INTERACTION_MESSAGES.taskTitleInvalid,
      INTERACTION_MESSAGES.taskTitleRequired,
    ),
    category: z.string({ error: INTERACTION_MESSAGES.categoryInvalid }).optional(),
    dueOn: civilDateSchema.optional(),
    kind: nextTaskKindSchema.optional(),
    plannedTime: nextTaskPlannedTimeSchema.optional(),
    timeZone: nextTaskTimeZoneSchema.optional(),
    partnerId: requiredReference(
      INTERACTION_MESSAGES.linkInvalid,
      INTERACTION_MESSAGES.linkInvalid,
    ).optional(),
    note: z.string({ error: INTERACTION_MESSAGES.taskNoteInvalid }).optional(),
  })
  .superRefine(refineNextTaskPlan);

/** The validated follow-up task payload: the members `createTask` accepts from this form. */
export type NextTaskPayload = z.infer<typeof nextTaskPayloadSchema>;

