/**
 * The Work family's three occurrence-scoped payload schemas: `editOccurrence`, `skipOccurrence` and
 * `resolveMissedPlan`.
 */
import { z } from "zod";
import { MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE, type MissedPlanResolution } from "../copy/missed-dates";
import { civilDateSchema, plannedTimeSchema, refinePlannedTimePairing, taskCategorySchema, taskKindSchema, taskNoteSchema, taskTitleSchema, timeZoneSchema, TASK_SCHEMA_MESSAGES } from "./task";
// The occurrence reference
/** An opaque reference to one occurrence of a series. */
export const occurrenceIdSchema = z.string({ error: TASK_SCHEMA_MESSAGES.taskIdRequired }).trim().min(1, TASK_SCHEMA_MESSAGES.taskIdRequired);
// The three resolutions a plan in review offers
/** The three resolutions a plan in review offers, in the order the review panel offers them: keep this occurrence, move the next date forward, or stop the series. */
export const MISSED_PLAN_RESOLUTIONS = ["keep-this-occurrence", "move-next-date-forward", "stop-series"] as const satisfies readonly MissedPlanResolution[];
/** The closed resolution choice, refused with the review panel's own required-choice message. */
export const missedPlanResolutionSchema = z.enum(MISSED_PLAN_RESOLUTIONS, {
  error: MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE,
});
/** Every resolution the domain module declares, marked as offered here: a compile-time exhaustiveness proof rather than a value anything reads. */
export const MISSED_PLAN_RESOLUTION_COVERAGE: Record<MissedPlanResolution, true> = {
  "keep-this-occurrence": true,
  "move-next-date-forward": true,
  "stop-series": true,
};
// editOccurrence
/** Validates the `editOccurrence` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const editOccurrenceSchema = z
  .strictObject({
    occurrenceId: occurrenceIdSchema,
    title: taskTitleSchema,
    category: taskCategorySchema,
    dueOn: civilDateSchema.optional(),
    kind: taskKindSchema,
    plannedTime: plannedTimeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    note: taskNoteSchema,
  })
  .superRefine(refinePlannedTimePairing);
/** The validated `editOccurrence` payload. */
export type EditOccurrencePayload = z.infer<typeof editOccurrenceSchema>;
// skipOccurrence
/** Validates the `skipOccurrence` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const skipOccurrenceSchema = z.strictObject({
  occurrenceId: occurrenceIdSchema,
});
/** The validated `skipOccurrence` payload. */
export type SkipOccurrencePayload = z.infer<typeof skipOccurrenceSchema>;
// resolveMissedPlan
/** Validates the `resolveMissedPlan` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const resolveMissedPlanSchema = z.strictObject({
  occurrenceId: occurrenceIdSchema,
  resolution: missedPlanResolutionSchema,
});
/** The validated `resolveMissedPlan` payload. */
export type ResolveMissedPlanPayload = z.infer<typeof resolveMissedPlanSchema>;
