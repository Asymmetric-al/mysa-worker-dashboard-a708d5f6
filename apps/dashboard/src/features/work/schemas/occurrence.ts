/**
 * The Work family's three occurrence-scoped payload schemas: `editOccurrence`, `skipOccurrence` and
 * `resolveMissedPlan`.
 *
 * A series holds the repeat rule; an occurrence is the one date of that series a worker can act on
 * now. These three schemas are the whole set of things a caller may say about that date, and each
 * names exactly one job:
 *
 * - `editOccurrence` changes this occurrence's own work — its title, category, due date, kind, a
 *   planned time with the zone it is stated in, and its note.
 * - `skipOccurrence` answers the date without performing it.
 * - `resolveMissedPlan` replaces a plan that needs review with one of exactly three resolutions.
 *
 * A schema here validates the **payload alone**. The four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }` belongs to the read envelope, and
 * `../hooks/use-series-mutations.ts` composes the two while preserving `expectedRevision`, so an
 * occurrence action composed before a later Stop comes back `conflict` or `unchanged` instead of
 * reviving a stopped series. No schema below declares `operationId`, `scope` or `expectedRevision`,
 * and the objects keep Zod's default strip mode for that reason: a smuggled envelope field inside a
 * payload is dropped rather than trusted.
 *
 * Two of the rules shape what is deliberately absent, because an absence is the only way to make a
 * dishonest payload unrepresentable:
 *
 * - Only one occurrence of a series is actionable at a time, so no payload here takes a collection:
 *   there is no "skip all", no batch of occurrences and no catch-up stack.
 * - Changing the rule — its profile, interval, day of the month, end, first due date or planning
 *   timezone — is `editThisAndFutureSchema`'s job in `./series.ts`. Those fields are missing from
 *   `editOccurrenceSchema` rather than optional, so a single-occurrence edit cannot carry a new rule
 *   and no caller has to know which fields would be ignored.
 *
 * These schemas decide shape, never admissibility. Whether a date has passed, whether the series
 * still admits an occurrence, whether a change is prospective and whether the caller may act are the
 * service's questions, answered against the record as it stands and the scenario clock, with
 * `@/modules/time/recurrence` deciding which dates are missed and which successor is admitted.
 * Nothing here reads a clock, parses a revision, compares a date or asks a permission question.
 *
 * The resolutions are not declared here either. `MISSED_PLAN_RESOLUTIONS` is checked against the
 * union the recurrence module owns, and `MISSED_PLAN_RESOLUTION_COVERAGE` proves the enum offers
 * every member of it, so a fourth resolution cannot reach a request body through this folder.
 *
 * Plan items: AAP 0.6.1 "Mutations: tasks and recurrence", AAP 0.6.3 `GET/POST /api/series`, the
 * AAP 0.9.1 tree row `features/work/**` ("series editor and Plan needs review"), and the recurrence
 * rules in AAP 0.8.2 with the fixed resolution labels in AAP 0.8.7.
 */

import { z } from "zod";

import {
  MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE,
  type MissedPlanResolution,
} from "../copy/missed-dates";
import {
  civilDateSchema,
  plannedTimeSchema,
  refinePlannedTimePairing,
  taskCategorySchema,
  taskKindSchema,
  taskNoteSchema,
  taskTitleSchema,
  timeZoneSchema,
  TASK_SCHEMA_MESSAGES,
} from "./task";

// ---------------------------------------------------------------------------------------------
// The occurrence reference
// ---------------------------------------------------------------------------------------------

/**
 * An opaque reference to one occurrence of a series.
 *
 * An identifier is a handle to one record inside one scope: it is never parsed for meaning, never
 * split into parts and never compared with a name or an email address, because equal-looking values
 * establish neither identity nor authority. It is declared here rather than reused from `./task`
 * because an occurrence reference and a task reference are different references even when their
 * strings look alike, and a distinct symbol is what stops one being passed where the other belongs.
 *
 * The wording is the task vocabulary's own message for "this action arrived without the record it
 * applies to", taken from {@link TASK_SCHEMA_MESSAGES}: an occurrence is one task admitted by its
 * series, so the condition and the retry are the same and no second text is written for it here.
 */
export const occurrenceIdSchema = z
  .string({ error: TASK_SCHEMA_MESSAGES.taskIdRequired })
  .trim()
  .min(1, TASK_SCHEMA_MESSAGES.taskIdRequired);

// ---------------------------------------------------------------------------------------------
// The three resolutions a plan in review offers
// ---------------------------------------------------------------------------------------------

/**
 * The three resolutions a plan in review offers, in the order the review panel offers them: keep
 * this occurrence, move the next date forward, or stop the series.
 *
 * The tuple is checked against `MissedPlanResolution`, which is the recurrence module's own
 * `PlanResolutions` union, so a member the domain module does not declare cannot appear here. That
 * clause catches a member that stopped being admissible; {@link MISSED_PLAN_RESOLUTION_COVERAGE}
 * catches the opposite case, a resolution the domain module gained and this enum has not offered yet.
 */
export const MISSED_PLAN_RESOLUTIONS = [
  "keep-this-occurrence",
  "move-next-date-forward",
  "stop-series",
] as const satisfies readonly MissedPlanResolution[];

/**
 * The closed resolution choice, refused with the review panel's own required-choice message.
 *
 * A value outside the three is not "unknown", "other" or a free-text answer: it is a resolution this
 * enum cannot express, which keeps "a plan in review offers exactly three resolutions" true of every
 * request body rather than of the panel alone.
 */
export const missedPlanResolutionSchema = z.enum(MISSED_PLAN_RESOLUTIONS, {
  error: MISSED_PLAN_RESOLUTION_REQUIRED_MESSAGE,
});

/**
 * Every resolution the domain module declares, marked as offered here: a compile-time
 * exhaustiveness proof rather than a value anything reads.
 *
 * `Record<MissedPlanResolution, true>` has to name every member of the union, so adding a fourth
 * resolution to `PlanResolutions` in `@/modules/time/recurrence` stops `bun run typecheck` on this
 * object until the tuple above and this object both offer it. Without that proof the panel could
 * come to show an option the schema refuses, or the schema could accept one the panel cannot
 * explain. It is exported so the proof is part of the module's surface rather than an unused local.
 */
export const MISSED_PLAN_RESOLUTION_COVERAGE: Record<MissedPlanResolution, true> = {
  "keep-this-occurrence": true,
  "move-next-date-forward": true,
  "stop-series": true,
};

// ---------------------------------------------------------------------------------------------
// editOccurrence
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `editOccurrence` payload before `../hooks/use-series-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * It is the **this-occurrence** edit: the whole editable state of that one date, and no rule field at
 * all. `category` and `note` are the worker's own short texts, a blank one becoming absent; `dueOn`
 * stays a civil date; and `kind` is stated rather than defaulted so a meeting's planned time and the
 * zone it is stated in arrive together under the one rule
 * {@link refinePlannedTimePairing} implements for every task payload. A patch of individual fields
 * would be the field bag this folder forbids, and it could not express removing a time and the zone
 * it was stated in as one edit.
 *
 * Changing the rule that produces future dates is `editThisAndFutureSchema` in `./series.ts`.
 */
export const editOccurrenceSchema = z
  .object({
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

// ---------------------------------------------------------------------------------------------
// skipOccurrence
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `skipOccurrence` payload before `../hooks/use-series-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * An occurrence reference and nothing else. There is no completion date, no outcome, no note and no
 * reason, because skipping answers the date rather than performing the work: it admits at most one
 * successor, records no contact and completes nothing, so the payload holds no field in which a
 * completion claim could travel. One occurrence id, never a list — only one date is actionable.
 */
export const skipOccurrenceSchema = z.object({
  occurrenceId: occurrenceIdSchema,
});

/** The validated `skipOccurrence` payload. */
export type SkipOccurrencePayload = z.infer<typeof skipOccurrenceSchema>;

// ---------------------------------------------------------------------------------------------
// resolveMissedPlan
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `resolveMissedPlan` payload before `../hooks/use-series-mutations.ts` submits it as
 * the payload of the four-field mutation input.
 *
 * The occurrence under review plus one of the three resolutions. No `seriesId` travels: the service
 * derives the series from the occurrence, so a second reference could only disagree with the first.
 * No date travels either, because the next date a resolution produces is computed by
 * `@/modules/time/recurrence` in the series' own planning zone rather than chosen in the request.
 */
export const resolveMissedPlanSchema = z.object({
  occurrenceId: occurrenceIdSchema,
  resolution: missedPlanResolutionSchema,
});

/** The validated `resolveMissedPlan` payload. */
export type ResolveMissedPlanPayload = z.infer<typeof resolveMissedPlanSchema>;
