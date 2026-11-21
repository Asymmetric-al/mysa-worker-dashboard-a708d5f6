/**
 * The Work family's five recurring-task payload schemas: `createSeries`, `editThisAndFuture`,
 * `pauseSeries`, `resumeSeries` and `stopSeries`.
 */
import { z } from "zod";
import type { RepeatProfile, SeriesEnd } from "@/modules/time/recurrence";
import { REPEAT_PROFILE_FIELDS, SERIES_FIELD_MESSAGES, type RepeatProfileField } from "../copy/repeat-profiles";
import { civilDateSchema, taskCategorySchema, taskNoteSchema, taskTitleSchema, timeZoneSchema } from "./task";
// Wording this schema set needs and the series catalogue does not hold yet
/** The messages this schema set needs that `../copy/repeat-profiles.ts` has no key for. */
export const SERIES_SCHEMA_MESSAGES = {
  seriesIdRequired: "This change applies to one repeating task, so open the series again and retry.",
  profileInvalid: "Choose a repeat profile: does not repeat, weekly, every N weeks, monthly on a day, or every N months.",
  intervalNotApplicable: "A repeat interval belongs to the every-N-weeks and every-N-months profiles, so choose one of those or remove the interval.",
  dayOfMonthNotApplicable: "A day of the month belongs to the monthly profiles, so choose one of those or remove the day.",
  endCountInvalid: "Choose how many occurrences, as a whole number of at least 1.",
  effectiveFromRequired: "Choose the date this change takes effect from, so the dates before it keep the rule they were planned under.",
} as const;
// The closed repeat profile
/** The five repeat profiles, in the fixed order the rule states them. */
export const REPEAT_PROFILE_VALUES = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const satisfies readonly RepeatProfile[];
/** The profile a series repeats on, checked against the closed set above. */
export const repeatProfileSchema = z.enum(REPEAT_PROFILE_VALUES, {
  error: SERIES_SCHEMA_MESSAGES.profileInvalid,
});
/** The closed set as an exhaustive map, and a compile-time proof that it stays closed. */
export const REPEAT_PROFILE_COVERAGE: Record<RepeatProfile, true> = {
  none: true,
  weekly: true,
  everyNWeeks: true,
  monthlyOnDay: true,
  everyNMonths: true,
};
// The series identifier and the end condition
/** The series a change applies to. */
export const seriesIdSchema = z.string({ error: SERIES_SCHEMA_MESSAGES.seriesIdRequired }).trim().min(1, SERIES_SCHEMA_MESSAGES.seriesIdRequired);

type AsStoredDate<End> = { readonly [Key in keyof End]: Key extends "on" ? string : End[Key] };
/** One end condition as this payload set states it, derived from the engine's own closed union. */
export type SeriesEndPayload = AsStoredDate<SeriesEnd>;
/** How a series ends: on a date, after a number of occurrences, or — only under the qualified ongoing-personal-series policy — not at all. */
export const seriesEndSchema: z.ZodType<SeriesEndPayload> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("on-date"), on: civilDateSchema }),
    z.strictObject({
      kind: z.literal("after-count"),
      count: z.number({ error: SERIES_SCHEMA_MESSAGES.endCountInvalid }).int(SERIES_SCHEMA_MESSAGES.endCountInvalid).min(1, SERIES_SCHEMA_MESSAGES.endCountInvalid),
    }),
    z.strictObject({ kind: z.literal("ongoing-personal-policy") }),
  ],
  { error: SERIES_FIELD_MESSAGES.endRequired },
);
// The two profile-conditional inputs and the one rule they share
const INTERVAL_PROFILES = ["everyNWeeks", "everyNMonths"] as const satisfies readonly RepeatProfile[];

const DAY_OF_MONTH_PROFILES = ["monthlyOnDay", "everyNMonths"] as const satisfies readonly RepeatProfile[];

const PROFILES_READING_INTERVAL: ReadonlySet<RepeatProfile> = new Set(INTERVAL_PROFILES);
const PROFILES_READING_DAY_OF_MONTH: ReadonlySet<RepeatProfile> = new Set(DAY_OF_MONTH_PROFILES);

function editorFieldsAgree(profile: RepeatProfile): boolean {
  const editorFields: readonly RepeatProfileField[] | undefined = REPEAT_PROFILE_FIELDS[profile];
  return (
    editorFields !== undefined && editorFields.includes("interval") === PROFILES_READING_INTERVAL.has(profile) && editorFields.includes("dayOfMonth") === PROFILES_READING_DAY_OF_MONTH.has(profile)
  );
}
const intervalSchema = z.number({ error: SERIES_FIELD_MESSAGES.intervalRequired }).int(SERIES_FIELD_MESSAGES.intervalRequired).min(1, SERIES_FIELD_MESSAGES.intervalRequired).optional();

const dayOfMonthSchema = z
  .number({ error: SERIES_FIELD_MESSAGES.dayOfMonthRequired })
  .int(SERIES_FIELD_MESSAGES.dayOfMonthRequired)
  .min(1, SERIES_FIELD_MESSAGES.dayOfMonthRequired)
  .max(31, SERIES_FIELD_MESSAGES.dayOfMonthRequired)
  .optional();
type ProfileConditionalFields = {
  readonly profile: RepeatProfile;
  readonly interval?: number | undefined;
  readonly dayOfMonth?: number | undefined;
};
/** The one profile-conditional rule, shared by `createSeries` and `editThisAndFuture`. */
export function refineSeriesRuleFields(value: ProfileConditionalFields, ctx: z.RefinementCtx): void {
  if (!editorFieldsAgree(value.profile)) {
    ctx.addIssue({
      code: "custom",
      message: SERIES_SCHEMA_MESSAGES.profileInvalid,
      path: ["profile"],
    });
    return;
  }
  const readsInterval = PROFILES_READING_INTERVAL.has(value.profile);
  const readsDayOfMonth = PROFILES_READING_DAY_OF_MONTH.has(value.profile);
  if (readsInterval) {
    if (value.interval === undefined) {
      ctx.addIssue({
        code: "custom",
        message: SERIES_FIELD_MESSAGES.intervalRequired,
        path: ["interval"],
      });
    }
  } else if (value.interval !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: SERIES_SCHEMA_MESSAGES.intervalNotApplicable,
      path: ["interval"],
    });
  }
  if (readsDayOfMonth) {
    if (value.dayOfMonth === undefined) {
      ctx.addIssue({
        code: "custom",
        message: SERIES_FIELD_MESSAGES.dayOfMonthRequired,
        path: ["dayOfMonth"],
      });
    }
  } else if (value.dayOfMonth !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: SERIES_SCHEMA_MESSAGES.dayOfMonthNotApplicable,
      path: ["dayOfMonth"],
    });
  }
}
// The dates and the zone a plan is stated in
const firstDueOnSchema = z.string({ error: SERIES_FIELD_MESSAGES.firstDueDateRequired }).pipe(civilDateSchema);

const planningTimeZoneSchema = z.string({ error: SERIES_FIELD_MESSAGES.planningTimeZoneRequired }).pipe(timeZoneSchema);

const effectiveFromSchema = z.string({ error: SERIES_SCHEMA_MESSAGES.effectiveFromRequired }).pipe(civilDateSchema);
// createSeries
/** Validates the `createSeries` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const createSeriesSchema = z
  .strictObject({
    title: taskTitleSchema,
    category: taskCategorySchema,
    note: taskNoteSchema,
    firstDueOn: firstDueOnSchema,
    planningTimeZone: planningTimeZoneSchema,
    profile: repeatProfileSchema,
    interval: intervalSchema,
    dayOfMonth: dayOfMonthSchema,
    end: seriesEndSchema,
  })
  .superRefine(refineSeriesRuleFields);
/** The validated `createSeries` payload. */
export type CreateSeriesPayload = z.infer<typeof createSeriesSchema>;
// editThisAndFuture
/** Validates the `editThisAndFuture` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const editThisAndFutureSchema = z
  .strictObject({
    seriesId: seriesIdSchema,
    effectiveFrom: effectiveFromSchema,
    title: taskTitleSchema,
    category: taskCategorySchema,
    note: taskNoteSchema,
    planningTimeZone: planningTimeZoneSchema,
    profile: repeatProfileSchema,
    interval: intervalSchema,
    dayOfMonth: dayOfMonthSchema,
    end: seriesEndSchema,
  })
  .superRefine(refineSeriesRuleFields);
/** The validated `editThisAndFuture` payload. */
export type EditThisAndFuturePayload = z.infer<typeof editThisAndFutureSchema>;
// pauseSeries, resumeSeries and stopSeries
/** Validates the `pauseSeries` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const pauseSeriesSchema = z.strictObject({
  seriesId: seriesIdSchema,
});
/** The validated `pauseSeries` payload. */
export type PauseSeriesPayload = z.infer<typeof pauseSeriesSchema>;
/** Validates the `resumeSeries` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const resumeSeriesSchema = z.strictObject({
  seriesId: seriesIdSchema,
});
/** The validated `resumeSeries` payload. */
export type ResumeSeriesPayload = z.infer<typeof resumeSeriesSchema>;
/** Validates the `stopSeries` payload before `../hooks/use-series-mutations.ts` submits it as the payload of the four-field mutation input. */
export const stopSeriesSchema = z.strictObject({
  seriesId: seriesIdSchema,
});
/** The validated `stopSeries` payload. */
export type StopSeriesPayload = z.infer<typeof stopSeriesSchema>;
