/**
 * The Coaching family's four target payload schemas: `saveTarget`, `editTarget`, `pauseTarget` and
 * `endTarget`.
 *
 * One schema per named mutation, each naming its own effect and its own field set, so a request body
 * posted to `/api/coaching/targets` can only ever mean one thing. There is no shared field bag, no
 * create-or-update form and no `payloadSchema(table, fields)` helper, because a payload that could
 * mean several things would be the command dispatcher this application deliberately does not have.
 *
 * A schema here validates the **payload alone**. The four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }` belongs to the read envelope in
 * `@/modules/data-service/envelope`, and `../hooks/use-coaching-mutations.ts` composes the two and
 * mints one operation identity per intent, so nothing below declares `operationId`, `scope` or
 * `expectedRevision`.
 *
 * These schemas decide shape, never admissibility. When a change may take effect, whether the period
 * it would start is still open, whether the version history admits another version, whether the
 * caller may touch this target at all and what a progress figure means are the questions
 * `@/modules/coaching/target` answers against the record as it stands and the scenario clock. No
 * schema here reads a clock, compares a revision or asks a permission question.
 *
 * All four objects are strict, and strictness is a product rule here rather than a style choice. A
 * change to a target's quantity, measure or calendar start opens a *prospective* version: the version
 * it follows closes the day before the change, and every period that already closed keeps the plan it
 * was measured against (AAP 0.8.4). A payload carrying `proration`, `bridge`, `overlap`,
 * `effectiveFrom`, `effectiveTo`, `versionId` or `replaceHistory` would be asking for a mid-period
 * rewrite instead, so an unknown key has to fail loudly rather than be dropped and read as the plain
 * edit it sits beside.
 *
 * Plan items: AAP 0.6.1 "Mutations: coaching" (`saveTarget`, `editTarget`, `pauseTarget`,
 * `endTarget`), AAP 0.6.2's target record (`privateLabel`, `measure`, `quantity`, `period`,
 * `calendarStart`, `homePlacement`, `state`, `versions[]`), the AAP 0.8.4 coaching rules on measures,
 * periods and prospective versions, the AAP 0.11.1 deliverable row `features/coaching/**`, and
 * criterion 16.
 */

import { z } from "zod";

import { TARGET_MEASURES, type TargetMeasure, type TargetPeriod } from "@/modules/coaching/target";
import { parseCivilDate } from "@/modules/time/civil";

// ---------------------------------------------------------------------------------------------
// The closed vocabularies a payload states
// ---------------------------------------------------------------------------------------------

/**
 * The measure a target counts: one of the four the domain declares, read from that declaration and
 * never restated, so a fifth measure cannot be sent from a form without first appearing in
 * `@/modules/coaching/target`.
 */
const measureSchema = z.enum(TARGET_MEASURES) satisfies z.ZodType<TargetMeasure, TargetMeasure>;

/**
 * The three period kinds a target may be measured over, in the order a surface states them.
 *
 * The domain expresses the period as a record rather than a name alone, because its custom arm
 * carries the first and last day it covers, while a payload can carry only what the worker chose: the
 * kind now and, for a one-off range, the day it starts. `custom` is therefore one period and not a
 * rhythm — nothing repeats when it ends. The `satisfies` clause keeps this list tied to the domain's
 * own union, and the family's `PERIOD_COPY` map is exhaustive over that union, so a fourth kind
 * cannot appear in the domain without both being extended deliberately.
 */
const PERIOD_KINDS = [
  "weekly",
  "monthly",
  "custom",
] as const satisfies readonly TargetPeriod["kind"][];

/** The period kind a payload states, derived from the closed list above. */
type PayloadPeriodKind = (typeof PERIOD_KINDS)[number];

/** The chosen period kind, refused unless it is one of the three a target may be measured over. */
const periodSchema = z.enum(PERIOD_KINDS);

// ---------------------------------------------------------------------------------------------
// The one calendar day a payload may state
// ---------------------------------------------------------------------------------------------

/**
 * A civil date carried as its stored `YYYY-MM-DD` form and read by the one calendar authority,
 * `@/modules/time/civil`.
 *
 * Calendar correctness only: a day the calendar does not have, such as the thirtieth of February, is
 * refused rather than rolled forward into the next month, and no time of day, zone or instant is
 * invented for it. `parseCivilDate` answers with a parsed-or-refused status rather than throwing, so a
 * refusal becomes a field issue instead of an exception. The value stays the string it arrived as —
 * there is no transform to a calendar object — because a payload must remain plain JSON, and the
 * service is what turns a day into the record it stores.
 */
const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom" });
    }
  });

/** The two fields the period refinement reads: the chosen kind, and the optional first day. */
interface PeriodChoice {
  readonly period: PayloadPeriodKind;
  readonly calendarStart?: string | undefined;
}

/**
 * Refuses a one-off custom period that names no first day, adding the issue on the `calendarStart`
 * field so the refusal lands beside the control that must be filled in rather than on the payload.
 *
 * A weekly or monthly period needs no day here: its calendar is anchored to the day the target
 * already started on. A custom range has no anchor of its own and cannot be measured without the day
 * it begins, so an absent one is a refusal rather than a period inferred from today — inferring it
 * would start a period the worker never chose. Shared by the save and the edit payload because both
 * can state a custom period, and one rule stated twice would eventually be stated two ways.
 */
function requireCalendarStartForCustomPeriod(value: PeriodChoice, ctx: z.RefinementCtx): void {
  if (value.period === "custom" && value.calendarStart === undefined) {
    ctx.addIssue({ code: "custom", path: ["calendarStart"] });
  }
}

// ---------------------------------------------------------------------------------------------
// The fields the target payloads share
// ---------------------------------------------------------------------------------------------

/**
 * The target a change applies to: an opaque handle to one record inside one scope.
 *
 * Never parsed for meaning and never compared with a label, a quantity or a person's name, because an
 * identifier establishes neither identity nor authority. A blank value names nothing at all, so it is
 * refused here instead of being sent as a request that could only fail deeper in.
 */
const targetIdSchema = z.string().trim().min(1);

/**
 * How many of the measure the target counts, as a positive whole number.
 *
 * A target counts records, so half a call is not a plan and a count of zero asks for nothing. There
 * is no coercion from text either: reading a typed string as a count would turn a typing error into a
 * saved target, and a control that sends a number must send a number.
 */
const quantitySchema = z.number().int().min(1);

/**
 * The worker's own name for the target.
 *
 * This label is private: it is visible only to the worker and is never disclosed to a coach, which is
 * why it is an ordinary payload field and why nothing a coach reads (`CoachTargetProgress` in
 * `@/modules/coaching/target`) declares it. Naming a target is also not a commitment: it carries no
 * reminder, no notification and no promise to anyone.
 */
const privateLabelSchema = z.string().trim().min(1);

/**
 * Whether the worker placed the target on Home.
 *
 * It changes only where the worker sees the target — what Home lists — and carries no commitment, no
 * reminder and no notification, so it is the worker's own arrangement of their own screen and appears
 * in nothing a coach reads.
 */
const homePlacementSchema = z.boolean();

// ---------------------------------------------------------------------------------------------
// saveTarget
// ---------------------------------------------------------------------------------------------

/**
 * The payload that sets a target for the first time: what it counts, how many, over which period,
 * what the worker calls it and whether it is placed on Home.
 */
export const targetSavePayloadSchema = z
  .strictObject({
    measure: measureSchema,
    quantity: quantitySchema,
    period: periodSchema,
    calendarStart: civilDateSchema.optional(),
    privateLabel: privateLabelSchema,
    homePlacement: homePlacementSchema,
  })
  .superRefine(requireCalendarStartForCustomPeriod);

/** The payload of `saveTarget`, inferred from the schema that validates it. */
export type TargetSavePayload = z.infer<typeof targetSavePayloadSchema>;

// ---------------------------------------------------------------------------------------------
// editTarget
// ---------------------------------------------------------------------------------------------

/**
 * The payload that changes a target's plan.
 *
 * `measure`, `quantity` and `period` are required because they are the fields that change what the
 * target counts and how it counts it, and any change among them opens a prospective version: the
 * period that is running closes at the boundary the service chooses and every period already closed
 * keeps the version it was measured against. `privateLabel` and `homePlacement` are optional because
 * renaming a target or moving it on Home starts no version at all — they change what the worker sees
 * and nothing about the count. No version identifier, effective boundary, proration or bridge field
 * is accepted, since naming the boundary is the service's decision and a caller cannot ask for a
 * period to be rewritten.
 */
export const targetEditPayloadSchema = z
  .strictObject({
    targetId: targetIdSchema,
    measure: measureSchema,
    quantity: quantitySchema,
    period: periodSchema,
    calendarStart: civilDateSchema.optional(),
    privateLabel: privateLabelSchema.optional(),
    homePlacement: homePlacementSchema.optional(),
  })
  .superRefine(requireCalendarStartForCustomPeriod);

/** The payload of `editTarget`, inferred from the schema that validates it. */
export type TargetEditPayload = z.infer<typeof targetEditPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// pauseTarget and endTarget
// ---------------------------------------------------------------------------------------------

/**
 * The payload that pauses a target.
 *
 * A pause is its own named mutation, so the payload is the target alone: no reason text, no effective
 * day and no cascade flag. Pausing keeps the history and counts nothing against the target while it
 * is paused, and the period that was running keeps the plan it was measured against — which is why
 * there is nothing here to say about when the pause begins.
 */
export const targetPausePayloadSchema = z.strictObject({
  targetId: targetIdSchema,
});

/** The payload of `pauseTarget`, inferred from the schema that validates it. */
export type TargetPausePayload = z.infer<typeof targetPausePayloadSchema>;

/**
 * The payload that ends a target.
 *
 * Ending is a separate mutation from pausing and takes the target alone, for the same reason: the
 * consequence — history kept, closed periods measured against the plan they had, no activity record
 * touched, no later action reopening it — is the service's to explain, not something a caller states
 * in a payload.
 */
export const targetEndPayloadSchema = z.strictObject({
  targetId: targetIdSchema,
});

/** The payload of `endTarget`, inferred from the schema that validates it. */
export type TargetEndPayload = z.infer<typeof targetEndPayloadSchema>;
