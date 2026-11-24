import { z } from "zod";
import type { RepeatProfile, SeriesEnd } from "@/modules/time/recurrence";
import { UNFINISHED_WORK_VALUES } from "../copy/missed-dates";
import { REPEAT_PROFILE_FIELDS, SERIES_FIELD_MESSAGES, type RepeatProfileField } from "../copy/repeat-profiles";
import { civilDateSchema, taskCategorySchema, taskNoteSchema, taskTitleSchema, timeZoneSchema } from "./task";
export const SERIES_SCHEMA_MESSAGES = {
  seriesIdRequired: "This change applies to one repeating task, so open the series again and retry.",
  profileInvalid: "Choose a repeat profile: does not repeat, weekly, every N weeks, monthly on a day, or every N months.",
  intervalNotApplicable: "A repeat interval belongs to the every-N-weeks and every-N-months profiles, so choose one of those or remove the interval.",
  dayOfMonthNotApplicable: "A day of the month belongs to the monthly profiles, so choose one of those or remove the day.",
  endCountInvalid: "Choose how many occurrences, as a whole number of at least 1.",
  effectiveFromRequired: "Choose the date this change takes effect from, so the dates before it keep the rule they were planned under.",
  unfinishedWorkInvalid: "Choose what happens to the unfinished work when the series stops: keep it, or cancel it.",
} as const;
export const REPEAT_PROFILE_VALUES = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const satisfies readonly RepeatProfile[];
export const repeatProfileSchema = z.enum(REPEAT_PROFILE_VALUES, { error: SERIES_SCHEMA_MESSAGES.profileInvalid });
export const REPEAT_PROFILE_COVERAGE: Record<RepeatProfile, true> = { none: true, weekly: true, everyNWeeks: true, monthlyOnDay: true, everyNMonths: true };
export const seriesIdSchema = z.string({ error: SERIES_SCHEMA_MESSAGES.seriesIdRequired }).trim().min(1, SERIES_SCHEMA_MESSAGES.seriesIdRequired);
type AsStoredDate<End> = { readonly [Key in keyof End]: Key extends "on" ? string : End[Key] };
export type SeriesEndPayload = AsStoredDate<SeriesEnd>;
export const seriesEndSchema: z.ZodType<SeriesEndPayload> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("on-date"), on: civilDateSchema }),
    z.strictObject({ kind: z.literal("after-count"), count: z.number({ error: SERIES_SCHEMA_MESSAGES.endCountInvalid }).int(SERIES_SCHEMA_MESSAGES.endCountInvalid).min(1, SERIES_SCHEMA_MESSAGES.endCountInvalid) }),
    z.strictObject({ kind: z.literal("ongoing-personal-policy") }),
  ],
  { error: SERIES_FIELD_MESSAGES.endRequired },
);
/** A stated field as a number, `NaN` when the field is blank so the schema refuses it rather than reading it as zero. */ export const statedNumber = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value.trim()));
/** The end condition the editor's three fields state, in the shape the write carries. */ export function endPayloadOf(kind: SeriesEnd["kind"], on: string, count: string): SeriesEndPayload {
  switch (kind) {
    case "on-date":
      return { kind: "on-date", on };
    case "after-count":
      return { kind: "after-count", count: statedNumber(count) };
    case "ongoing-personal-policy":
      return { kind: "ongoing-personal-policy" };
  }
}
const PROFILES_READING_INTERVAL: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>(["everyNWeeks", "everyNMonths"]);
const PROFILES_READING_DAY_OF_MONTH: ReadonlySet<RepeatProfile> = new Set<RepeatProfile>(["monthlyOnDay", "everyNMonths"]);
function editorFieldsAgree(profile: RepeatProfile): boolean {
  const editorFields: readonly RepeatProfileField[] | undefined = REPEAT_PROFILE_FIELDS[profile];
  return editorFields !== undefined && editorFields.includes("interval") === PROFILES_READING_INTERVAL.has(profile) && editorFields.includes("dayOfMonth") === PROFILES_READING_DAY_OF_MONTH.has(profile);
}
const intervalSchema = z.number({ error: SERIES_FIELD_MESSAGES.intervalRequired }).int(SERIES_FIELD_MESSAGES.intervalRequired).min(1, SERIES_FIELD_MESSAGES.intervalRequired).optional();
const dayOfMonthSchema = z.number({ error: SERIES_FIELD_MESSAGES.dayOfMonthRequired }).int(SERIES_FIELD_MESSAGES.dayOfMonthRequired).min(1, SERIES_FIELD_MESSAGES.dayOfMonthRequired).max(31, SERIES_FIELD_MESSAGES.dayOfMonthRequired).optional();
export function refineSeriesRuleFields(value: { readonly profile: RepeatProfile; readonly interval?: number | undefined; readonly dayOfMonth?: number | undefined }, ctx: z.RefinementCtx): void {
  if (!editorFieldsAgree(value.profile)) {
    ctx.addIssue({ code: "custom", message: SERIES_SCHEMA_MESSAGES.profileInvalid, path: ["profile"] });
    return;
  }
  if (PROFILES_READING_INTERVAL.has(value.profile)) {
    if (value.interval === undefined) ctx.addIssue({ code: "custom", message: SERIES_FIELD_MESSAGES.intervalRequired, path: ["interval"] });
  } else if (value.interval !== undefined) {
    ctx.addIssue({ code: "custom", message: SERIES_SCHEMA_MESSAGES.intervalNotApplicable, path: ["interval"] });
  }
  if (PROFILES_READING_DAY_OF_MONTH.has(value.profile)) {
    if (value.dayOfMonth === undefined) ctx.addIssue({ code: "custom", message: SERIES_FIELD_MESSAGES.dayOfMonthRequired, path: ["dayOfMonth"] });
  } else if (value.dayOfMonth !== undefined) {
    ctx.addIssue({ code: "custom", message: SERIES_SCHEMA_MESSAGES.dayOfMonthNotApplicable, path: ["dayOfMonth"] });
  }
}
const firstDueOnSchema = z.string({ error: SERIES_FIELD_MESSAGES.firstDueDateRequired }).pipe(civilDateSchema);
const planningTimeZoneSchema = z.string({ error: SERIES_FIELD_MESSAGES.planningTimeZoneRequired }).pipe(timeZoneSchema);
const effectiveFromSchema = z.string({ error: SERIES_SCHEMA_MESSAGES.effectiveFromRequired }).pipe(civilDateSchema);
export const createSeriesSchema = z
  .strictObject({ title: taskTitleSchema, category: taskCategorySchema, note: taskNoteSchema, firstDueOn: firstDueOnSchema, planningTimeZone: planningTimeZoneSchema, profile: repeatProfileSchema, interval: intervalSchema, dayOfMonth: dayOfMonthSchema, end: seriesEndSchema })
  .superRefine(refineSeriesRuleFields);
export type CreateSeriesPayload = z.infer<typeof createSeriesSchema>;
export const editThisAndFutureSchema = z
  .strictObject({ seriesId: seriesIdSchema, effectiveFrom: effectiveFromSchema, title: taskTitleSchema, category: taskCategorySchema, note: taskNoteSchema, planningTimeZone: planningTimeZoneSchema, profile: repeatProfileSchema, interval: intervalSchema, dayOfMonth: dayOfMonthSchema, end: seriesEndSchema })
  .superRefine(refineSeriesRuleFields);
export type EditThisAndFuturePayload = z.infer<typeof editThisAndFutureSchema>;
export const pauseSeriesSchema = z.strictObject({ seriesId: seriesIdSchema });
export type PauseSeriesPayload = z.infer<typeof pauseSeriesSchema>;
export const resumeSeriesSchema = z.strictObject({ seriesId: seriesIdSchema });
export type ResumeSeriesPayload = z.infer<typeof resumeSeriesSchema>;
/** Stopping states what becomes of the dates it leaves behind; the default is the service's own `keep`, so an absence still states a fate. */
export const stopSeriesSchema = z.strictObject({ seriesId: seriesIdSchema, unfinishedWork: z.enum(UNFINISHED_WORK_VALUES, { error: SERIES_SCHEMA_MESSAGES.unfinishedWorkInvalid }).default("keep") });
export type StopSeriesPayload = z.infer<typeof stopSeriesSchema>;
