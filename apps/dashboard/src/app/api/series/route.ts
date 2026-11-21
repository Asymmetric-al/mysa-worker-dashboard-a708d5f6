/** The browser transport for the recurring-task family: one series read and the eight named mutations that keep a series useful (AAP 0.6.3 `GET/POST /api/series`, AAP 0.7.1 "Keep a series useful"). */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { dispatch, jsonBodyOf, operationIdentityOf } from "../handler";
// The synthetic store writes through the Node filesystem, so no route in this application runs on the edge runtime.
export const runtime = "nodejs";
// A read resolves the development session's admitted scope and the scenario clock once per request, so no response here may come from a cache that outlives a state change.
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
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
// The closed set of names this transport admits, in the order the job group lists them.
const SERIES_MUTATION_NAMES = ["createSeries", "editOccurrence", "editThisAndFuture", "skipOccurrence", "pauseSeries", "resumeSeries", "stopSeries", "resolveMissedPlan"] as const;
// The closed repeat profile, the two kinds of work, and the two things a Stop can do to unfinished work.
const REPEAT_PROFILE_VALUES = ["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"] as const;
const TASK_KIND_VALUES = ["default", "meeting"] as const;
const UNFINISHED_WORK_VALUES = ["keep", "cancel"] as const;
// The three resolutions a plan in review offers, each stated in the two spellings the service reads.
const PLAN_RESOLUTION_VALUES = ["keep-this-occurrence", "keep-occurrence", "move-next-date-forward", "move-next-forward", "stop-series"] as const;
// Field shapes: presence and type are judged here, meaning by the service.
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
// A series ends on a date, after a count, or — only under the qualified ongoing-personal-series policy — not at all. There is no fourth end, and a stated end is judged here so only a well-formed one reaches the service. Whether a create states an end at all is the service's rule: it refuses a
// body naming neither `end` nor `ongoingPolicy` as `endRequired`.
const seriesEndSchema = z.discriminatedUnion(
  "kind",
  [z.strictObject({ kind: z.literal("on-date", { error: MESSAGES.endKindInvalid }), on: civilDateSchema }), z.strictObject({ kind: z.literal("after-count", { error: MESSAGES.endKindInvalid }), count: endCountSchema }), z.strictObject({ kind: z.literal("ongoing-personal-policy", { error: MESSAGES.endKindInvalid }) })],
  { error: MESSAGES.endRequired },
);
// The eight payloads, each closed to the fields its own mutation reads and each naming itself.
const createSeriesPayloadSchema = z.strictObject({
  mutation: z.literal("createSeries"),
  title: titleSchema,
  category: z.string().optional(),
  note: z.string().optional(),
  profile: repeatProfileSchema,
  interval: intervalSchema.optional(),
  dayOfMonth: dayOfMonthSchema.optional(),
  firstDueOn: civilDateSchema,
  // The planning time zone is an opaque name to this transport: trimming it, defaulting it or resolving it here would change the civil dates a rule produces, so the stated value is forwarded byte-for-byte and the service alone decides whether it resolves.
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
  // The boundary the change takes effect from is the caller's to state and the service's to honour: a transport that computed it would decide which dates history keeps.
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
// The one body schema per mutation: the four-field input, with that mutation's own payload. The discriminant is part of the payload on the wire and is stripped again before the service is called, because a mutation states its own effect and nothing repeats it as a field.
const createSeriesBodySchema = mutationInputSchema(createSeriesPayloadSchema);
const editOccurrenceBodySchema = mutationInputSchema(editOccurrencePayloadSchema);
const editThisAndFutureBodySchema = mutationInputSchema(editThisAndFuturePayloadSchema);
const skipOccurrenceBodySchema = mutationInputSchema(skipOccurrencePayloadSchema);
const pauseSeriesBodySchema = mutationInputSchema(pauseSeriesPayloadSchema);
const resumeSeriesBodySchema = mutationInputSchema(resumeSeriesPayloadSchema);
const stopSeriesBodySchema = mutationInputSchema(stopSeriesPayloadSchema);
const resolveMissedPlanBodySchema = mutationInputSchema(resolveMissedPlanPayloadSchema);
// Which change a request asks for is read from `payload.mutation` alone, before the payload is judged: the eight payloads carry different fields, so the branch has to be known first. This peek stays
// lenient about everything else, and the branch's own strict schema then reports each fault against the field it belongs to.
const claimedBodySchema = z.object({ payload: z.object({ mutation: z.enum(SERIES_MUTATION_NAMES, { error: MESSAGES.mutationRequired }) }, { error: MESSAGES.mutationRequired }) }, { error: MESSAGES.bodyNotJson });
function rawSeriesReadParams(search: URLSearchParams): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    // A repeated parameter travels as a list, which the strict schema then refuses as a wrong type: two values for one key is an ambiguity this read never resolves by picking one of them.
    entries.push([key, values.length === 1 ? values[0] : values]);
  }
  return Object.fromEntries(entries);
}
// The read's whole grammar: the identifier of one series and nothing else. A preview date, a "from" date, a computed next date, an `asOf` instant or a scope override is refused rather than normalised, because every date, resolution and scope this read reports is derived from the session and the
// scenario clock (AAP 0.6.3).
const readSeriesIdSchema = z.string({ error: MESSAGES.readSeriesIdRequired }).min(1, MESSAGES.readSeriesIdRequired);
const seriesReadQuerySchema = z.strictObject({ seriesId: readSeriesIdSchema }, { error: MESSAGES.readingInvalid });
/** One recurring series by its identifier: the rule in force, the next three dates and any disclosed month-day resolution, the single actionable occurrence and how its plan stands. */
export async function GET(request: Request): Promise<Response> {
  try {
    const search = new URL(request.url).searchParams;
    const query = seriesReadQuerySchema.safeParse(rawSeriesReadParams(search));
    if (!query.success) {
      // A value this read does not admit is a request-level refusal, answered with the same per-field refusal the eight mutations answer: no source behind the read failed, and a caller has to be told which field to correct.
      return toResponse(refusedRead(READ_ATTEMPT_ID, query.error));
    }
    // The envelope is forwarded untouched: its scope, source, revision, asOf, coverage, valueStates and actions are what makes two surfaces comparable, so nothing here recomputes or reformats them.
    return toResponse(await reads.series.readSeries(query.data));
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named series mutation, selected by `payload.mutation`, applied at most once by operation identity. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = claimedBodySchema.safeParse(raw);
  if (!claimed.success) {
    // An absent, unknown or ambiguous discriminant is answered before any payload schema runs, so a ninth name cannot reach a mutation and no state is touched on the way to saying so.
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.mutation) {
    case "createSeries":
      return dispatch(createSeriesBodySchema, raw, operationId, "mutation", mutations.series.createSeries);
    case "editOccurrence":
      return dispatch(editOccurrenceBodySchema, raw, operationId, "mutation", mutations.series.editOccurrence);
    case "editThisAndFuture":
      return dispatch(editThisAndFutureBodySchema, raw, operationId, "mutation", mutations.series.editThisAndFuture);
    case "skipOccurrence":
      return dispatch(skipOccurrenceBodySchema, raw, operationId, "mutation", mutations.series.skipOccurrence);
    case "pauseSeries":
      return dispatch(pauseSeriesBodySchema, raw, operationId, "mutation", mutations.series.pauseSeries);
    case "resumeSeries":
      return dispatch(resumeSeriesBodySchema, raw, operationId, "mutation", mutations.series.resumeSeries);
    case "stopSeries":
      return dispatch(stopSeriesBodySchema, raw, operationId, "mutation", mutations.series.stopSeries);
    case "resolveMissedPlan":
      return dispatch(resolveMissedPlanBodySchema, raw, operationId, "mutation", mutations.series.resolveMissedPlan);
    default: {
      // Unreachable: the eight names above are the closed set the peek admits, so a ninth mutation fails to compile at this assignment instead of reaching the runtime. A value that somehow arrives is answered as `unknown` carrying the operationId, which is the only honest answer for an effect
      // nothing here can account for.
      const unhandled: never = claimed.data.payload.mutation;
      return toResponse(outcomeFromError(operationId, unhandled));
    }
  }
}
