import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { claimedWriteRoute, claimedWrites } from "../handler";
import { READ_ATTEMPT, readGrammar, readRoute } from "../read";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  mutationRequired: "State which change this request makes as payload.mutation: createSeries, editOccurrence, editThisAndFuture, skipOccurrence, pauseSeries, resumeSeries, stopSeries or resolveMissedPlan.",
  seriesIdRequired: "This change applies to one repeating task, so open the series again and retry.",
  occurrenceIdRequired: "This action applies to one date of a repeating task, so open the series again and retry.",
  titleRequired: "Give this task a title, because a title is the one thing a task cannot do without.",
  profileInvalid: "Choose a repeat profile: does not repeat, weekly, every N weeks, monthly on a day, or every N months.",
  intervalInvalid: "Choose how many periods between occurrences as a whole number of at least 1, so no occurrence falls on a fraction of a period.",
  dayOfMonthInvalid: "Choose the day of the month from 1 to 31, because a day outside that range names no date in any month.",
  dateInvalid: "Enter the date as YYYY-MM-DD, so a civil date is stated rather than an instant in an assumed zone.",
  planningTimeZoneRequired: "Choose the planning time zone, so a display change never moves these dates.",
  endKindInvalid: "State how this series ends as on-date, after-count or ongoing-personal-policy.",
  endRequired: "Choose an end date or a number of occurrences, or turn on the ongoing series policy.",
  endCountInvalid: "Choose how many occurrences as a whole number of at least 1, so a series ends after an occurrence that exists.",
  kindInvalid: "Choose Task or Meeting as the kind of work.",
  unfinishedWorkInvalid: "Choose what happens to the unfinished work when the series stops: keep it, or cancel it.",
  resolutionRequired: "Choose one of the three resolutions for a plan that needs review: keep this occurrence, move the next date forward, or stop the series.",
  readingInvalid: "Read one repeating task by seriesId alone: the preview dates, the planning time zone's resolutions and every boundary are computed by the read from the session and the scenario clock, never supplied by a request.",
  readSeriesIdRequired: "Name the one repeating task this read answers for as seriesId, because a series read describes exactly one plan.",
} as const;
const SERIES_MUTATION_NAMES = ["createSeries", "editOccurrence", "editThisAndFuture", "skipOccurrence", "pauseSeries", "resumeSeries", "stopSeries", "resolveMissedPlan"] as const;
type SeriesMutationName = (typeof SERIES_MUTATION_NAMES)[number];
const REPEAT_PROFILE_VALUES = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const;
const TASK_KIND_VALUES = ["default", "meeting"] as const;
const UNFINISHED_WORK_VALUES = ["keep", "cancel"] as const;
const PLAN_RESOLUTION_VALUES = ["keep-this-occurrence", "keep-occurrence", "move-next-date-forward", "move-next-forward", "stop-series"] as const;
const seriesIdSchema = z.string({ error: MESSAGES.seriesIdRequired }).min(1, MESSAGES.seriesIdRequired);
const occurrenceIdSchema = z.string({ error: MESSAGES.occurrenceIdRequired }).min(1, MESSAGES.occurrenceIdRequired);
const titleSchema = z.string({ error: MESSAGES.titleRequired }).min(1, MESSAGES.titleRequired);
const civilDateSchema = z.iso.date({ error: MESSAGES.dateInvalid });
const repeatProfileSchema = z.enum(REPEAT_PROFILE_VALUES, { error: MESSAGES.profileInvalid });
const intervalSchema = z.number({ error: MESSAGES.intervalInvalid }).int(MESSAGES.intervalInvalid).min(1, MESSAGES.intervalInvalid);
const dayOfMonthSchema = z.number({ error: MESSAGES.dayOfMonthInvalid }).int(MESSAGES.dayOfMonthInvalid).min(1, MESSAGES.dayOfMonthInvalid).max(31, MESSAGES.dayOfMonthInvalid);
const endCountSchema = z.number({ error: MESSAGES.endCountInvalid }).int(MESSAGES.endCountInvalid).min(1, MESSAGES.endCountInvalid);
const taskKindSchema = z.enum(TASK_KIND_VALUES, { error: MESSAGES.kindInvalid });
const unfinishedWorkSchema = z.enum(UNFINISHED_WORK_VALUES, { error: MESSAGES.unfinishedWorkInvalid });
const planResolutionSchema = z.enum(PLAN_RESOLUTION_VALUES, { error: MESSAGES.resolutionRequired });
const seriesEndSchema = z.discriminatedUnion(
  "kind",
  [z.strictObject({ kind: z.literal("on-date", { error: MESSAGES.endKindInvalid }), on: civilDateSchema }), z.strictObject({ kind: z.literal("after-count", { error: MESSAGES.endKindInvalid }), count: endCountSchema }), z.strictObject({ kind: z.literal("ongoing-personal-policy", { error: MESSAGES.endKindInvalid }) })],
  { error: MESSAGES.endRequired },
);
const createSeriesPayloadSchema = z.strictObject({
  mutation: z.literal("createSeries"),
  title: titleSchema,
  category: z.string().optional(),
  note: z.string().optional(),
  profile: repeatProfileSchema,
  interval: intervalSchema.optional(),
  dayOfMonth: dayOfMonthSchema.optional(),
  firstDueOn: civilDateSchema,
  planningTimeZone: z.string({ error: MESSAGES.planningTimeZoneRequired }).min(1, MESSAGES.planningTimeZoneRequired),
  end: seriesEndSchema.optional(),
  ongoingPolicy: z.literal(true, { error: MESSAGES.endRequired }).optional(),
  partnerId: z.string().optional(),
});
const editOccurrencePayloadSchema = z.strictObject({
  mutation: z.literal("editOccurrence"),
  occurrenceId: occurrenceIdSchema,
  seriesId: seriesIdSchema.optional(),
  title: titleSchema.optional(),
  category: z.union([z.string(), z.null()]).optional(),
  dueOn: z.union([civilDateSchema, z.null()]).optional(),
  kind: taskKindSchema.optional(),
  plannedTime: z.union([z.string(), z.null()]).optional(),
  timeZone: z.union([z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.null()]).optional(),
});
const editThisAndFuturePayloadSchema = z.strictObject({
  mutation: z.literal("editThisAndFuture"),
  seriesId: seriesIdSchema,
  effectiveFrom: civilDateSchema,
  title: titleSchema.optional(),
  category: z.union([z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.null()]).optional(),
  planningTimeZone: z.string({ error: MESSAGES.planningTimeZoneRequired }).min(1, MESSAGES.planningTimeZoneRequired).optional(),
  profile: repeatProfileSchema.optional(),
  interval: intervalSchema.optional(),
  dayOfMonth: dayOfMonthSchema.optional(),
  end: seriesEndSchema.optional(),
});
const skipOccurrencePayloadSchema = z.strictObject({ mutation: z.literal("skipOccurrence"), occurrenceId: occurrenceIdSchema, seriesId: seriesIdSchema.optional() });
const pauseSeriesPayloadSchema = z.strictObject({ mutation: z.literal("pauseSeries"), seriesId: seriesIdSchema });
const resumeSeriesPayloadSchema = z.strictObject({ mutation: z.literal("resumeSeries"), seriesId: seriesIdSchema });
const stopSeriesPayloadSchema = z.strictObject({ mutation: z.literal("stopSeries"), seriesId: seriesIdSchema, unfinishedWork: unfinishedWorkSchema.optional() });
const resolveMissedPlanPayloadSchema = z.strictObject({ mutation: z.literal("resolveMissedPlan"), occurrenceId: occurrenceIdSchema, seriesId: seriesIdSchema.optional(), resolution: planResolutionSchema });
const createSeriesBodySchema = mutationInputSchema(createSeriesPayloadSchema);
const editOccurrenceBodySchema = mutationInputSchema(editOccurrencePayloadSchema);
const editThisAndFutureBodySchema = mutationInputSchema(editThisAndFuturePayloadSchema);
const skipOccurrenceBodySchema = mutationInputSchema(skipOccurrencePayloadSchema);
const pauseSeriesBodySchema = mutationInputSchema(pauseSeriesPayloadSchema);
const resumeSeriesBodySchema = mutationInputSchema(resumeSeriesPayloadSchema);
const stopSeriesBodySchema = mutationInputSchema(stopSeriesPayloadSchema);
const resolveMissedPlanBodySchema = mutationInputSchema(resolveMissedPlanPayloadSchema);
const claimedBodySchema = z.object({ payload: z.object({ mutation: z.enum(SERIES_MUTATION_NAMES, { error: MESSAGES.mutationRequired }) }, { error: MESSAGES.mutationRequired }) }, { error: MESSAGES.bodyNotJson });
function rawSeriesReadParams(search: URLSearchParams): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    entries.push([key, values.length === 1 ? values[0] : values]);
  }
  return Object.fromEntries(entries);
}
const readSeriesIdSchema = z.string({ error: MESSAGES.readSeriesIdRequired }).min(1, MESSAGES.readSeriesIdRequired);
const seriesReadQuerySchema = z.strictObject({ seriesId: readSeriesIdSchema }, { error: MESSAGES.readingInvalid });
/** One recurring series by its identifier: the rule in force, the next three dates and any disclosed month-day resolution, the single actionable occurrence and how its plan stands. */
const readSeries = readRoute(readGrammar(seriesReadQuerySchema, rawSeriesReadParams), (query) => reads.series.readSeries(query), READ_ATTEMPT);
/** The eight named series mutations, each judged by its own payload schema before it runs. */
const SERIES_WRITES = claimedWrites<SeriesMutationName>("mutation", {
  createSeries: [createSeriesBodySchema, mutations.series.createSeries],
  editOccurrence: [editOccurrenceBodySchema, mutations.series.editOccurrence],
  editThisAndFuture: [editThisAndFutureBodySchema, mutations.series.editThisAndFuture],
  skipOccurrence: [skipOccurrenceBodySchema, mutations.series.skipOccurrence],
  pauseSeries: [pauseSeriesBodySchema, mutations.series.pauseSeries],
  resumeSeries: [resumeSeriesBodySchema, mutations.series.resumeSeries],
  stopSeries: [stopSeriesBodySchema, mutations.series.stopSeries],
  resolveMissedPlan: [resolveMissedPlanBodySchema, mutations.series.resolveMissedPlan],
});
/** One named series mutation, selected by `payload.mutation`, applied at most once by operation identity. */
const changeSeries = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, claimedBodySchema, (claim) => claim.payload.mutation, SERIES_WRITES);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readSeries, POST: changeSeries });
