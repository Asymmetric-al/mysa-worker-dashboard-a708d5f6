import { z } from "zod";
import type { InteractionRecord } from "@/modules/data-service/envelope";
const INTERACTION_MESSAGES = {
  partnerReferenceInvalid: "A record reference is text, so open the contact again and retry from its own page.",
  partnerReferenceRequired: "Name the contact this interaction is about, because an interaction is recorded against one record.",
  kindInvalid: "Choose the kind of contact that took place.",
  precisionInvalid: "Say how precisely you know the day: the day itself, roughly, or not at all.",
  dateInvalid: "State the day as a calendar date in YYYY-MM-DD form, because a day that does not exist is refused.",
  dateRequired: "State the day this interaction happened on, or record that you do not know when.",
  unknownPrecisionCarriesNoDate: "An unknown day carries no date, because a day entered there would be invented rather than known.",
  outcomeInvalid: "An outcome is text, so say in a sentence what came of the contact.",
  outcomeRequired: "Say what came of the contact.",
  participantsInvalid: "The people who took part are a list, so name them as a list of records.",
  participantReferenceInvalid: "A participant reference is text, so choose the person from the records this contact can see.",
  participantReferenceRequired: "Choose the person who took part, because a participant names a record rather than a typed name.",
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
  timeZoneRequired: "Choose the timezone this time is stated in, so the time is never read in an assumed zone.",
  planOnlyForMeeting: "A planned time belongs to a meeting, so record the kind as Meeting or remove the time.",
  planTimeOtherDay: "The planned time falls on a different day from the due date, so make the two describe one plan.",
  linkInvalid: "Choose the linked contact from the list, so a link names a record rather than typed text.",
  taskNoteInvalid: "A note is text, so write a short reminder or leave it empty.",
} as const;
function requiredReference(invalidMessage: string, emptyMessage: string): z.ZodString {
  return z.string({ error: invalidMessage }).min(1, emptyMessage);
}
function requiredText(invalidMessage: string, emptyMessage: string): z.ZodString {
  return z.string({ error: invalidMessage }).refine((value) => value.trim().length > 0, { error: emptyMessage });
}
export const INTERACTION_KINDS = ["conversation", "visit", "call", "meeting", "written-exchange", "other"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];
export const interactionKindSchema = z.enum(INTERACTION_KINDS, { error: INTERACTION_MESSAGES.kindInvalid });
type InteractionDatePrecision = InteractionRecord["precision"];
export const INTERACTION_PRECISIONS = ["date", "approximate", "unknown"] as const satisfies readonly InteractionDatePrecision[];
export type InteractionPrecision = (typeof INTERACTION_PRECISIONS)[number];
export const interactionPrecisionSchema = z.enum(INTERACTION_PRECISIONS, { error: INTERACTION_MESSAGES.precisionInvalid });
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
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
export const civilDateSchema = z.string({ error: INTERACTION_MESSAGES.dateInvalid }).refine(civilDateExists, { error: INTERACTION_MESSAGES.dateInvalid });
export const interactionOccurredOnSchema = z.strictObject({ precision: interactionPrecisionSchema, date: civilDateSchema.optional() }).superRefine((value, context) => {
  if (value.precision === "unknown" && value.date !== undefined) {
    context.addIssue({ code: "custom", path: ["date"], message: INTERACTION_MESSAGES.unknownPrecisionCarriesNoDate });
    return;
  }
  if (value.precision !== "unknown" && value.date === undefined) {
    context.addIssue({ code: "custom", path: ["date"], message: INTERACTION_MESSAGES.dateRequired });
  }
});
export type InteractionOccurredOn = z.infer<typeof interactionOccurredOnSchema>;
export const interactionParticipantSchema = z.strictObject({ partnerId: requiredReference(INTERACTION_MESSAGES.participantReferenceInvalid, INTERACTION_MESSAGES.participantReferenceRequired), role: requiredText(INTERACTION_MESSAGES.participantRoleInvalid, INTERACTION_MESSAGES.participantRoleRequired) });
export type InteractionParticipantInput = z.infer<typeof interactionParticipantSchema>;
export const interactionNoteBodySchema = requiredText(INTERACTION_MESSAGES.noteInvalid, INTERACTION_MESSAGES.noteEmpty);
export const logInteractionPayloadSchema = z.strictObject({
  partnerId: requiredReference(INTERACTION_MESSAGES.partnerReferenceInvalid, INTERACTION_MESSAGES.partnerReferenceRequired),
  type: interactionKindSchema,
  occurredOn: interactionOccurredOnSchema,
  outcome: requiredText(INTERACTION_MESSAGES.outcomeInvalid, INTERACTION_MESSAGES.outcomeRequired),
  participants: z.array(interactionParticipantSchema, { error: INTERACTION_MESSAGES.participantsInvalid }),
  note: interactionNoteBodySchema.optional(),
});
export type LogInteractionPayload = z.infer<typeof logInteractionPayloadSchema>;
export const NEXT_TASK_KINDS = ["default", "meeting"] as const;
export type NextTaskKind = (typeof NEXT_TASK_KINDS)[number];
export const nextTaskKindSchema = z.enum(NEXT_TASK_KINDS, { error: INTERACTION_MESSAGES.taskKindInvalid });
const PLANNED_CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const PLANNED_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u;
function plannedDayOf(value: string): string | null {
  return PLANNED_DATE_TIME_PATTERN.test(value) ? value.slice(0, 10) : null;
}
function isPlannedTime(value: string): boolean {
  if (PLANNED_CLOCK_PATTERN.test(value)) {
    return true;
  }
  const day = plannedDayOf(value);
  return day !== null && civilDateExists(day);
}
export const nextTaskPlannedTimeSchema = z.string({ error: INTERACTION_MESSAGES.plannedTimeInvalid }).refine(isPlannedTime, { error: INTERACTION_MESSAGES.plannedTimeInvalid });
export const nextTaskTimeZoneSchema = z.string({ error: INTERACTION_MESSAGES.timeZoneInvalid }).refine((value) => value.trim().length > 0, { error: INTERACTION_MESSAGES.timeZoneInvalid });
type NextTaskPlan = { readonly kind?: NextTaskKind | undefined; readonly dueOn?: string | undefined; readonly plannedTime?: string | undefined; readonly timeZone?: string | undefined };
function refineNextTaskPlan(value: NextTaskPlan, context: z.RefinementCtx): void {
  const statedTime = (value.plannedTime ?? "").trim().length > 0 ? value.plannedTime : undefined;
  const hasTime = statedTime !== undefined;
  const hasZone = (value.timeZone ?? "").trim().length > 0;
  if ((value.kind ?? "default") === "default") {
    if (hasTime || hasZone) {
      context.addIssue({ code: "custom", path: ["plannedTime"], message: INTERACTION_MESSAGES.planOnlyForMeeting });
    }
    return;
  }
  if (hasTime && !hasZone) {
    context.addIssue({ code: "custom", path: ["timeZone"], message: INTERACTION_MESSAGES.timeZoneRequired });
    return;
  }
  if (!hasTime && hasZone) {
    context.addIssue({ code: "custom", path: ["plannedTime"], message: INTERACTION_MESSAGES.timeZoneRequired });
    return;
  }
  const plannedDay = statedTime === undefined ? null : plannedDayOf(statedTime);
  if (plannedDay !== null && value.dueOn !== undefined && plannedDay !== value.dueOn) {
    context.addIssue({ code: "custom", path: ["plannedTime"], message: INTERACTION_MESSAGES.planTimeOtherDay });
  }
}
export const nextTaskPayloadSchema = z
  .strictObject({
    operation: z.literal("createTask").default("createTask"),
    title: requiredText(INTERACTION_MESSAGES.taskTitleInvalid, INTERACTION_MESSAGES.taskTitleRequired),
    category: z.string({ error: INTERACTION_MESSAGES.categoryInvalid }).optional(),
    dueOn: civilDateSchema.optional(),
    kind: nextTaskKindSchema.optional(),
    plannedTime: nextTaskPlannedTimeSchema.optional(),
    timeZone: nextTaskTimeZoneSchema.optional(),
    partnerId: requiredReference(INTERACTION_MESSAGES.linkInvalid, INTERACTION_MESSAGES.linkInvalid).optional(),
    note: z.string({ error: INTERACTION_MESSAGES.taskNoteInvalid }).optional(),
  })
  .superRefine(refineNextTaskPlan);
export type NextTaskPayload = z.infer<typeof nextTaskPayloadSchema>;
