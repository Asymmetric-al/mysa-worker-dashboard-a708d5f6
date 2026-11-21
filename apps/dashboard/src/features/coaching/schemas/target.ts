/**
 * The Coaching family's four target payload schemas: `saveTarget`, `editTarget`, `pauseTarget` and
 * `endTarget`.
 */
import { z } from "zod";
import { TARGET_MEASURES, type TargetMeasure, type TargetPeriod } from "@/modules/coaching/target";
import { parseCivilDate } from "@/modules/time/civil";
// The closed vocabularies a payload states
const measureSchema = z.enum(TARGET_MEASURES) satisfies z.ZodType<TargetMeasure, TargetMeasure>;

const PERIOD_KINDS = ["weekly", "monthly", "custom"] as const satisfies readonly TargetPeriod["kind"][];

type PayloadPeriodKind = (typeof PERIOD_KINDS)[number];

const periodSchema = z.enum(PERIOD_KINDS);
// The one calendar day a payload may state
const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom" });
    }
  });
interface PeriodChoice {
  readonly period: PayloadPeriodKind;
  readonly calendarStart?: string | undefined;
}
function requireCalendarStartForCustomPeriod(value: PeriodChoice, ctx: z.RefinementCtx): void {
  if (value.period === "custom" && value.calendarStart === undefined) {
    ctx.addIssue({ code: "custom", path: ["calendarStart"] });
  }
}
// The fields the target payloads share
const targetIdSchema = z.string().trim().min(1);

const quantitySchema = z.number().int().min(1);

const privateLabelSchema = z.string().trim().min(1);

const homePlacementSchema = z.boolean();
// saveTarget
/** The payload that sets a target for the first time: what it counts, how many, over which period, what the worker calls it and whether it is placed on Home. */
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
// editTarget
/** The payload that changes a target's plan. */
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
// pauseTarget and endTarget
/** The payload that pauses a target. */
export const targetPausePayloadSchema = z.strictObject({
  targetId: targetIdSchema,
});
/** The payload of `pauseTarget`, inferred from the schema that validates it. */
export type TargetPausePayload = z.infer<typeof targetPausePayloadSchema>;
/** The payload that ends a target. */
export const targetEndPayloadSchema = z.strictObject({
  targetId: targetIdSchema,
});
/** The payload of `endTarget`, inferred from the schema that validates it. */
export type TargetEndPayload = z.infer<typeof targetEndPayloadSchema>;
