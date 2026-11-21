import { z } from "zod";
import { MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE, type MissedPlanResolution } from "../copy/missed-dates";
import { civilDateSchema, plannedTimeSchema, refinePlannedTimePairing, taskCategorySchema, taskKindSchema, taskNoteSchema, taskTitleSchema, timeZoneSchema, TASK_SCHEMA_MESSAGES } from "./task";
export const occurrenceIdSchema = z.string({ error: TASK_SCHEMA_MESSAGES.taskIdRequired }).trim().min(1, TASK_SCHEMA_MESSAGES.taskIdRequired);
export const MISSED_PLAN_RESOLUTIONS = ["keep-this-occurrence", "move-next-date-forward", "stop-series"] as const satisfies readonly MissedPlanResolution[];
export const missedPlanResolutionSchema = z.enum(MISSED_PLAN_RESOLUTIONS, { error: MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE });
export const MISSED_PLAN_RESOLUTION_COVERAGE: Record<MissedPlanResolution, true> = { "keep-this-occurrence": true, "move-next-date-forward": true, "stop-series": true };
export const editOccurrenceSchema = z
  .strictObject({ occurrenceId: occurrenceIdSchema, title: taskTitleSchema, category: taskCategorySchema, dueOn: civilDateSchema.optional(), kind: taskKindSchema, plannedTime: plannedTimeSchema.optional(), timeZone: timeZoneSchema.optional(), note: taskNoteSchema })
  .superRefine(refinePlannedTimePairing);
export type EditOccurrencePayload = z.infer<typeof editOccurrenceSchema>;
export const skipOccurrenceSchema = z.strictObject({ occurrenceId: occurrenceIdSchema });
export type SkipOccurrencePayload = z.infer<typeof skipOccurrenceSchema>;
export const resolveMissedPlanSchema = z.strictObject({ occurrenceId: occurrenceIdSchema, resolution: missedPlanResolutionSchema });
export type ResolveMissedPlanPayload = z.infer<typeof resolveMissedPlanSchema>;
