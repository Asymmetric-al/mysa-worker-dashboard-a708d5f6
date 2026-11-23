import { z } from "zod";
import type { InteractionRecord } from "@/modules/data-service/envelope";
import { parseCivilDate } from "@/modules/time/civil";
const INTERACTION_MESSAGES = {
  dateInvalid: "State the day as a calendar date in YYYY-MM-DD form, because a day that does not exist is refused.",
  participantReferenceInvalid: "A participant reference is text, so choose the person from the records this contact can see.",
  participantReferenceRequired: "Choose the person who took part, because a participant names a record rather than a typed name.",
  participantRoleInvalid: "A participant role is text, so say how this person took part.",
  participantsRequired: "Name at least one person who took part, because an interaction is always recorded against the contact it is about.",
  plannedTimeInvalid: "A planned time is a day and a clock time together, so enter both.",
  timeZoneInvalid: "A timezone is text, so choose the zone this time is stated in.",
  timeZoneRequired: "Choose the timezone this time is stated in, so the time is never read in an assumed zone.",
  linkInvalid: "Choose the linked contact from the list, so a link names a record rather than typed text.",
} as const;
const requiredReference = (invalidMessage: string, emptyMessage: string): z.ZodString => z.string({ error: invalidMessage }).min(1, emptyMessage);
const requiredText = (invalidMessage: string, emptyMessage: string): z.ZodString => z.string({ error: invalidMessage }).refine((value) => value.trim().length > 0, { error: emptyMessage });
export const INTERACTION_KINDS = ["conversation", "visit", "call", "meeting", "written-exchange", "other"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];
export const interactionKindSchema = z.enum(INTERACTION_KINDS, { error: "Choose the kind of contact that took place." });
export const INTERACTION_PRECISIONS = ["date", "approximate", "unknown"] as const satisfies readonly InteractionRecord["precision"][];
export type InteractionPrecision = (typeof INTERACTION_PRECISIONS)[number];
export const interactionPrecisionSchema = z.enum(INTERACTION_PRECISIONS, { error: "Say how precisely you know the day: the day itself, roughly, or not at all." });
/** Whether the text names a day that exists, read through the one civil-date owner so a form and the service refuse the same days. */
const civilDateExists = (value: string): boolean => parseCivilDate(value).status === "parsed";
export const civilDateSchema = z.string({ error: INTERACTION_MESSAGES.dateInvalid }).refine(civilDateExists, { error: INTERACTION_MESSAGES.dateInvalid });
export const interactionOccurredOnSchema = z.strictObject({ precision: interactionPrecisionSchema, date: civilDateSchema.optional() }).superRefine((value, context) => {
  if (value.precision === "unknown" && value.date !== undefined) {
    context.addIssue({ code: "custom", path: ["date"], message: "An unknown day carries no date, because a day entered there would be invented rather than known." });
    return;
  }
  if (value.precision !== "unknown" && value.date === undefined) context.addIssue({ code: "custom", path: ["date"], message: "State the day this interaction happened on, or record that you do not know when." });
});
export const interactionParticipantSchema = z.strictObject({ partnerId: requiredReference(INTERACTION_MESSAGES.participantReferenceInvalid, INTERACTION_MESSAGES.participantReferenceRequired), role: requiredText(INTERACTION_MESSAGES.participantRoleInvalid, "Say how this person took part.") });
export const interactionNoteBodySchema = requiredText("A note is text, so write it as plain text or leave it empty.", "A note needs at least one visible character, or leave the field empty.");
export const logInteractionPayloadSchema = z.strictObject({
  partnerId: requiredReference("A record reference is text, so open the contact again and retry from its own page.", "Name the contact this interaction is about, because an interaction is recorded against one record."),
  type: interactionKindSchema,
  occurredOn: interactionOccurredOnSchema,
  outcome: requiredText("An outcome is text, so say in a sentence what came of the contact.", "Say what came of the contact."),
  participants: z.array(interactionParticipantSchema, { error: "The people who took part are a list, so name them as a list of records." }).min(1, INTERACTION_MESSAGES.participantsRequired),
  note: interactionNoteBodySchema.optional(),
});
export type LogInteractionPayload = z.infer<typeof logInteractionPayloadSchema>;
export const NEXT_TASK_KINDS = ["default", "meeting"] as const;
export type NextTaskKind = (typeof NEXT_TASK_KINDS)[number];
export const nextTaskKindSchema = z.enum(NEXT_TASK_KINDS, { error: "Choose Task or Meeting as the kind of work." });
const PLANNED_CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const PLANNED_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u;
const plannedDayOf = (value: string): string | null => (PLANNED_DATE_TIME_PATTERN.test(value) ? value.slice(0, 10) : null);
function isPlannedTime(value: string): boolean {
  if (PLANNED_CLOCK_PATTERN.test(value)) return true;
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
    if (hasTime || hasZone) context.addIssue({ code: "custom", path: ["plannedTime"], message: "A planned time belongs to a meeting, so record the kind as Meeting or remove the time." });
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
  if (plannedDay !== null && value.dueOn !== undefined && plannedDay !== value.dueOn) context.addIssue({ code: "custom", path: ["plannedTime"], message: "The planned time falls on a different day from the due date, so make the two describe one plan." });
}
export const nextTaskPayloadSchema = z
  .strictObject({
    operation: z.literal("createTask").default("createTask"),
    title: requiredText("A task title is text, so say in a few words what needs doing.", "A follow-up task needs a title, so say what needs doing or leave the task out."),
    category: z.string({ error: "A category is text, so enter a short label of your own or leave it empty." }).optional(),
    dueOn: civilDateSchema.optional(),
    kind: nextTaskKindSchema.optional(),
    plannedTime: nextTaskPlannedTimeSchema.optional(),
    timeZone: nextTaskTimeZoneSchema.optional(),
    partnerId: requiredReference(INTERACTION_MESSAGES.linkInvalid, INTERACTION_MESSAGES.linkInvalid).optional(),
    note: z.string({ error: "A note is text, so write a short reminder or leave it empty." }).optional(),
  })
  .superRefine(refineNextTaskPlan);
export type NextTaskPayload = z.infer<typeof nextTaskPayloadSchema>;
