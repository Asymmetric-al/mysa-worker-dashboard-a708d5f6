/**
 * The Work family's five recurring-task payload schemas: `createSeries`, `editThisAndFuture`,
 * `pauseSeries`, `resumeSeries` and `stopSeries`.
 *
 * One schema per named mutation, and each names its own effect and its own field set, so a request
 * body posted to `/api/series` can only ever mean one thing. The occurrence-scoped mutations
 * (`editOccurrence`, `skipOccurrence`, `resolveMissedPlan`) live beside this file, the five plain
 * task mutations in `./task.ts` and the bulk actions in `./bulk.ts`; nothing here is a shared field
 * bag or a create-or-update form, because a payload that could mean several things would be the
 * command dispatcher this application deliberately does not have.
 *
 * A schema here validates the **payload alone**. The four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }` belongs to the read envelope, and
 * `../hooks/use-series-mutations.ts` composes the two and mints one operation identity per intent,
 * so no schema below declares `operationId`, `scope` or `expectedRevision`. Every payload object is
 * a strict object for the same reason: an envelope field smuggled into a payload — or any other
 * stray key, inside the `end` object included — is refused here, by the rule the service's own
 * strict payload schema applies, instead of being dropped in the browser and answered `invalid` a
 * round trip later.
 *
 * These schemas decide shape, never admissibility. Whether the ongoing-personal-series policy
 * applies to this worker, whether an end date precedes the first due date, whether a stop already
 * closed the series and whether the caller may revise it are the service's questions, answered
 * against the record as it stands and the scenario clock — so nothing here reads a clock, adds a
 * date or decides that a date was missed.
 *
 * The repeat rule is not implemented here either. `validateSeriesRule`, `monthlyOnDay` and
 * `nextOccurrences` in `@/modules/time/recurrence` own the closed profile set, the short-month
 * resolution and successor admission; this file only states which of the two profile-conditional
 * inputs the chosen profile must carry. That division is why `dayOfMonth` admits 31: a month that
 * cannot hold the chosen day is resolved to its final day — and disclosed — by the engine (AAP
 * 0.8.7), so refusing day 31 here would deny a plan the product is required to express.
 *
 * A civil date travels as its stored `YYYY-MM-DD` form through `civilDateSchema` from `./task`, and
 * the recurrence module is imported as **types only**, so no form or browser bundle pulls the
 * calendar implementation in behind a schema. Every message a worker can see comes from
 * `../copy/repeat-profiles.ts`; the entries that catalogue has no key for yet are named once in
 * {@link SERIES_SCHEMA_MESSAGES}.
 *
 * Plan items: AAP 0.6.1 "Mutations: tasks and recurrence", AAP 0.6.3 `GET/POST /api/series`,
 * AAP 0.8.2 ("the repeat profile is closed to five members; a first due date and a planning timezone
 * are required; an end condition is required unless the qualified ongoing-personal-series policy is
 * stated; this-and-future creates a rule revision with an explicit effective boundary and leaves
 * completed history intact; pause stops future admission; stop explains the fate of unfinished work;
 * a stale action cannot undo a later Stop"), AAP 0.8.7 ("For missing monthly dates, use and disclose
 * the final day of that month"), the AAP 0.9.1 tree row `features/work/**`, and criterion 13.
 */

import { z } from "zod";

import type { RepeatProfile, SeriesEnd } from "@/modules/time/recurrence";

import {
  REPEAT_PROFILE_FIELDS,
  SERIES_FIELD_MESSAGES,
  type RepeatProfileField,
} from "../copy/repeat-profiles";
import {
  civilDateSchema,
  taskCategorySchema,
  taskNoteSchema,
  taskTitleSchema,
  timeZoneSchema,
} from "./task";

// ---------------------------------------------------------------------------------------------
// Wording this schema set needs and the series catalogue does not hold yet
// ---------------------------------------------------------------------------------------------

/**
 * The messages this schema set needs that `../copy/repeat-profiles.ts` has no key for.
 *
 * That file is the Work family's one wording source for the repeat rule, and these entries belong
 * beside the five messages it already words for the same fields. They are declared here only so that
 * no schema below states a message literal inline, and they move into
 * `../copy/repeat-profiles.ts` the moment that catalogue is next edited. Each one describes the
 * value that was refused and what to do about it, never the person who typed it.
 */
export const SERIES_SCHEMA_MESSAGES = {
  /** A mutation arrived without the series it applies to. */
  seriesIdRequired:
    "This change applies to one repeating task, so open the series again and retry.",
  /** A profile outside the closed set, and a profile whose fields contradict the editor's own set. */
  profileInvalid:
    "Choose a repeat profile: does not repeat, weekly, every N weeks, monthly on a day, or every N months.",
  /** An interval left on a payload whose profile reads no interval. */
  intervalNotApplicable:
    "A repeat interval belongs to the every-N-weeks and every-N-months profiles, so choose one of those or remove the interval.",
  /** A day of the month left on a payload whose profile reads none. */
  dayOfMonthNotApplicable:
    "A day of the month belongs to the monthly profiles, so choose one of those or remove the day.",
  /** An occurrence count below one, which is not a number of occurrences. */
  endCountInvalid: "Choose how many occurrences, as a whole number of at least 1.",
  /** A revision submitted without the date it takes effect from. */
  effectiveFromRequired:
    "Choose the date this change takes effect from, so the dates before it keep the rule they were planned under.",
} as const;

// ---------------------------------------------------------------------------------------------
// The closed repeat profile
// ---------------------------------------------------------------------------------------------

/**
 * The five repeat profiles, in the fixed order the rule states them.
 *
 * Declared against the domain module's own union, so a profile this list named but
 * `@/modules/time/recurrence` did not would fail to compile here rather than reach a request body.
 * {@link REPEAT_PROFILE_COVERAGE} closes the other direction, so the pair cannot drift from the
 * engine in either direction.
 */
export const REPEAT_PROFILE_VALUES = [
  "none",
  "weekly",
  "everyNWeeks",
  "monthlyOnDay",
  "everyNMonths",
] as const satisfies readonly RepeatProfile[];

/**
 * The profile a series repeats on, checked against the closed set above.
 *
 * An unrecognised profile is refused with `profile` as its field path instead of being coerced to a
 * default, so nothing can repeat more often — or on a different day — than its author asked.
 */
export const repeatProfileSchema = z.enum(REPEAT_PROFILE_VALUES, {
  error: SERIES_SCHEMA_MESSAGES.profileInvalid,
});

/**
 * The closed set as an exhaustive map, and a compile-time proof that it stays closed.
 *
 * Adding a sixth member to `RepeatProfile` in `@/modules/time/recurrence` fails `bun run typecheck`
 * here, because this object would then be missing that key. The `satisfies` clause in
 * {@link REPEAT_PROFILE_VALUES} covers the other direction, refusing a profile string the union does
 * not name. Together they mean a sixth profile cannot appear here, be offered by the editor or be
 * stored without this file being updated deliberately.
 */
export const REPEAT_PROFILE_COVERAGE: Record<RepeatProfile, true> = {
  none: true,
  weekly: true,
  everyNWeeks: true,
  monthlyOnDay: true,
  everyNMonths: true,
};

// ---------------------------------------------------------------------------------------------
// The series identifier and the end condition
// ---------------------------------------------------------------------------------------------

/**
 * The series a change applies to.
 *
 * An opaque handle to one record inside one scope: never parsed for meaning, never split into parts
 * and never compared with a title or a date. A blank value names nothing at all, so it is refused
 * here rather than sent as a request that could only fail deeper in.
 */
export const seriesIdSchema = z
  .string({ error: SERIES_SCHEMA_MESSAGES.seriesIdRequired })
  .trim()
  .min(1, SERIES_SCHEMA_MESSAGES.seriesIdRequired);

/**
 * The domain's end kinds as a payload carries them: the same arms, with the calendar date written in
 * its stored `YYYY-MM-DD` form.
 *
 * The mapping exists because a payload is JSON over the wire and `SeriesEnd` holds a calendar-date
 * object that no request body can carry — a stored record already states the same kind with the date
 * as a string. Every arm and every field name is taken from `SeriesEnd` itself, so renaming a member,
 * retyping one or adding a fourth kind stops compiling here instead of failing at the service.
 */
type AsStoredDate<End> = { readonly [Key in keyof End]: Key extends "on" ? string : End[Key] };

/** One end condition as this payload set states it, derived from the engine's own closed union. */
export type SeriesEndPayload = AsStoredDate<SeriesEnd>;

/**
 * How a series ends: on a date, after a number of occurrences, or — only under the qualified
 * ongoing-personal-series policy — not at all.
 *
 * All three kinds are expressible and no fourth exists. The ongoing arm is a policy the worker
 * switched on rather than a missing value, which is why an absent end is refused: whether that policy
 * applies to this worker is decided by `validateSeriesRule`, but a payload that simply omitted the
 * end could not even state which of the three was meant. An end date is inclusive of the day it
 * names, and a count counts occurrences from the first due date.
 */
export const seriesEndSchema: z.ZodType<SeriesEndPayload> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("on-date"), on: civilDateSchema }),
    z.strictObject({
      kind: z.literal("after-count"),
      count: z
        .number({ error: SERIES_SCHEMA_MESSAGES.endCountInvalid })
        .int(SERIES_SCHEMA_MESSAGES.endCountInvalid)
        .min(1, SERIES_SCHEMA_MESSAGES.endCountInvalid),
    }),
    z.strictObject({ kind: z.literal("ongoing-personal-policy") }),
  ],
  { error: SERIES_FIELD_MESSAGES.endRequired },
);

// ---------------------------------------------------------------------------------------------
// The two profile-conditional inputs and the one rule they share
// ---------------------------------------------------------------------------------------------

/**
 * The profiles that repeat at an interval, and only those.
 *
 * AAP 0.8.2 closes the profile set at five and gives each one the inputs it reads, so the two "every
 * N" profiles read an interval and the other three read none.
 * {@link refineSeriesRuleFields} checks this statement against `REPEAT_PROFILE_FIELDS`, the list the
 * editor renders its controls from, so the form and the schema cannot disagree about which profile
 * shows an interval.
 */
const INTERVAL_PROFILES = [
  "everyNWeeks",
  "everyNMonths",
] as const satisfies readonly RepeatProfile[];

/**
 * The profiles that repeat on a day of the month, and only those.
 *
 * The same exhaustive-checked statement for the other conditional input, checked against the same
 * editor list in {@link refineSeriesRuleFields}: a month too short for the chosen day resolves to its
 * final day and that resolution is disclosed, so day 31 is a plan the product expresses rather than a
 * contradiction to refuse.
 */
const DAY_OF_MONTH_PROFILES = [
  "monthlyOnDay",
  "everyNMonths",
] as const satisfies readonly RepeatProfile[];

/** The two profile sets as lookups, so the rule reads the same way in both directions. */
const PROFILES_READING_INTERVAL: ReadonlySet<RepeatProfile> = new Set(INTERVAL_PROFILES);
const PROFILES_READING_DAY_OF_MONTH: ReadonlySet<RepeatProfile> = new Set(DAY_OF_MONTH_PROFILES);

/**
 * Whether the editor's own field list still says what the two sets above say for this profile.
 *
 * The editor renders its interval and day-of-month controls from `REPEAT_PROFILE_FIELDS`, and this
 * rule refuses the payloads that list implies; asking it here means the form and the schema cannot
 * disagree, and a profile the list does not name counts as a disagreement rather than a lookup that
 * throws inside validation.
 */
function editorFieldsAgree(profile: RepeatProfile): boolean {
  const editorFields: readonly RepeatProfileField[] | undefined = REPEAT_PROFILE_FIELDS[profile];
  return (
    editorFields !== undefined &&
    editorFields.includes("interval") === PROFILES_READING_INTERVAL.has(profile) &&
    editorFields.includes("dayOfMonth") === PROFILES_READING_DAY_OF_MONTH.has(profile)
  );
}

/** A whole number of periods between occurrences, read only by the two "every N" profiles. */
const intervalSchema = z
  .number({ error: SERIES_FIELD_MESSAGES.intervalRequired })
  .int(SERIES_FIELD_MESSAGES.intervalRequired)
  .min(1, SERIES_FIELD_MESSAGES.intervalRequired)
  .optional();

/** A day of the month, read only by the two monthly profiles; 31 stays expressible on purpose. */
const dayOfMonthSchema = z
  .number({ error: SERIES_FIELD_MESSAGES.dayOfMonthRequired })
  .int(SERIES_FIELD_MESSAGES.dayOfMonthRequired)
  .min(1, SERIES_FIELD_MESSAGES.dayOfMonthRequired)
  .max(31, SERIES_FIELD_MESSAGES.dayOfMonthRequired)
  .optional();

/** The fields the profile-conditional rule reads, present on both payloads that carry a rule. */
type ProfileConditionalFields = {
  readonly profile: RepeatProfile;
  readonly interval?: number | undefined;
  readonly dayOfMonth?: number | undefined;
};

/**
 * The one profile-conditional rule, shared by `createSeries` and `editThisAndFuture`.
 *
 * A callback rather than a schema factory, so the two payloads share one implementation without
 * either wrapping the other. Four cases are refused and four are honest:
 *
 * - an interval missing on a profile that reads one, and an interval left behind by a profile that
 *   reads none, because either one would repeat on a schedule the worker did not state;
 * - a day of the month missing on a monthly profile, and a day left behind by any other profile,
 *   because a value the chosen profile cannot use is a contradiction to report rather than a field
 *   to ignore.
 *
 * Each issue carries the field path the form anchors its message to. The values themselves are
 * checked by the field schemas above; this rule only enforces which of them the chosen profile reads,
 * and it reports the profile when the editor's own list disagrees with it, because then no truthful
 * answer about the other two fields exists.
 */
export function refineSeriesRuleFields(
  value: ProfileConditionalFields,
  ctx: z.RefinementCtx,
): void {
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

// ---------------------------------------------------------------------------------------------
// The dates and the zone a plan is stated in
// ---------------------------------------------------------------------------------------------

/*
 * The shape and the calendar rule behind these three fields are never restated: a civil date is read
 * by `civilDateSchema` and a zone by `timeZoneSchema`, both from `./task.ts`, so an impossible day
 * such as 2026-02-30 and a zone no runtime can resolve are refused by the one implementation of each,
 * and the trimmed value that implementation produces is the one that travels.
 *
 * What each field below adds is its own required-value message, because a missing first due date,
 * planning timezone or effective boundary is a plan the worker has not finished stating rather than a
 * field they may leave empty. A value that is present but impossible keeps the primitive's own
 * wording for it: that sentence is the Work family's one statement of what a calendar date or a
 * resolvable zone is, and it appears beside the labelled control that produced the value.
 */

/** The date a series counts its repeats from — a date the rule never recomputes from anything. */
const firstDueOnSchema = z
  .string({ error: SERIES_FIELD_MESSAGES.firstDueDateRequired })
  .pipe(civilDateSchema);

/** The zone the series is planned in, so a display-zone change cannot move any of its dates. */
const planningTimeZoneSchema = z
  .string({ error: SERIES_FIELD_MESSAGES.planningTimeZoneRequired })
  .pipe(timeZoneSchema);

/**
 * The date a this-and-future revision takes effect from.
 *
 * Required, and stated in the boundary's own words: an edit that does not say when it starts could
 * only be applied backwards over occurrences that were already planned, completed or skipped under
 * the rule then in force.
 */
const effectiveFromSchema = z
  .string({ error: SERIES_SCHEMA_MESSAGES.effectiveFromRequired })
  .pipe(civilDateSchema);

// ---------------------------------------------------------------------------------------------
// createSeries
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `createSeries` payload before `../hooks/use-series-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * A series cannot be created without the three things that make its repeat meaningful: the first due
 * date it counts from, the planning timezone that date is a date in, and an end. The ongoing-policy
 * arm states the qualified ongoing-personal-series policy as a deliberate choice rather than as a
 * missing value, and whether that policy applies to this worker is `validateSeriesRule`'s answer.
 * `profile` is the closed set, and the interval or day of the month it reads arrives only with the
 * profiles that read it.
 *
 * `category` and `note` are the worker's own short label and reminder, carried on the series so that
 * an admitted occurrence inherits them; neither is a taxonomy and neither records anything that
 * happened. No identifier appears: the service creates the series and its first occurrence, and a
 * series is never created by pointing an existing task at another one.
 */
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

// ---------------------------------------------------------------------------------------------
// editThisAndFuture
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `editThisAndFuture` payload before `../hooks/use-series-mutations.ts` submits it as
 * the payload of the four-field mutation input.
 *
 * The revision is prospective, and `effectiveFrom` is what makes it so: the service appends a rule
 * revision in force from that date onwards, so an occurrence completed, skipped or cancelled before
 * it keeps the rule it was measured against and its history is left intact.
 *
 * It deliberately carries **no `firstDueOn`**. The anchor a count-limited end counts from is fixed
 * when the series is created, and re-sending it here would fabricate a new anchor for dates that must
 * stay where they are; a revision changes the rule that runs forward, not where the series began.
 * It carries the whole editable rule rather than a partial patch, for the same reason `editTask`
 * does: a patch could remove a day of the month and leave the profile that reads it.
 */
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

// ---------------------------------------------------------------------------------------------
// pauseSeries, resumeSeries and stopSeries
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `pauseSeries` payload before `../hooks/use-series-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * A series identifier and nothing else. Pausing stops future admission and leaves the plan intact, so
 * the payload has no field for a reason, a resume date or a rescheduled occurrence — each of those
 * would be an edit to the plan that pausing does not perform, and the plan is changed through
 * `editThisAndFuture` or not at all.
 */
export const pauseSeriesSchema = z.strictObject({
  seriesId: seriesIdSchema,
});

/** The validated `pauseSeries` payload. */
export type PauseSeriesPayload = z.infer<typeof pauseSeriesSchema>;

/**
 * Validates the `resumeSeries` payload before `../hooks/use-series-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * The same identifier and nothing else: resuming admits occurrences again from the rule already in
 * force, so there is nothing to restate. A series that was stopped instead of paused is not revived
 * by this payload — the service answers that, and a resume queued before a stop is caught by
 * `expectedRevision` as a conflict rather than re-enacted here.
 */
export const resumeSeriesSchema = z.strictObject({
  seriesId: seriesIdSchema,
});

/** The validated `resumeSeries` payload. */
export type ResumeSeriesPayload = z.infer<typeof resumeSeriesSchema>;

/**
 * Validates the `stopSeries` payload before `../hooks/use-series-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * The identifier and nothing else, deliberately. Stopping closes the series and explains the fate of
 * its unfinished work, but the explanation is the surface's — it comes from
 * `../copy/missed-dates.ts` — and the payload carries no disposition field that would imply the
 * outstanding work was completed, cancelled or handed on. A stop is not a completion, and an action
 * queued before it is caught by `expectedRevision` as `conflict` or `unchanged` rather than revived
 * through a field here.
 */
export const stopSeriesSchema = z.strictObject({
  seriesId: seriesIdSchema,
});

/** The validated `stopSeries` payload. */
export type StopSeriesPayload = z.infer<typeof stopSeriesSchema>;
