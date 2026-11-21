import { z } from "zod";
import { TARGET_MEASURES, type TargetMeasure, type TargetPeriod } from "@/modules/coaching/target";
import { parseCivilDate } from "@/modules/time/civil";
const measureSchema = z.enum(TARGET_MEASURES) satisfies z.ZodType<TargetMeasure, TargetMeasure>;
const PERIOD_KINDS = ["weekly", "monthly", "custom"] as const satisfies readonly TargetPeriod["kind"][];
type PayloadPeriodKind = (typeof PERIOD_KINDS)[number];
const periodSchema = z.enum(PERIOD_KINDS);
const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom" });
    }
  });
type PeriodChoice = { readonly period: PayloadPeriodKind; readonly calendarStart?: string | undefined };
function requireCalendarStartForCustomPeriod(value: PeriodChoice, ctx: z.RefinementCtx): void {
  if (value.period === "custom" && value.calendarStart === undefined) {
    ctx.addIssue({ code: "custom", path: ["calendarStart"] });
  }
}
const targetIdSchema = z.string().trim().min(1);
const quantitySchema = z.number().int().min(1);
const privateLabelSchema = z.string().trim().min(1);
const homePlacementSchema = z.boolean();
export const targetSavePayloadSchema = z.strictObject({ measure: measureSchema, quantity: quantitySchema, period: periodSchema, calendarStart: civilDateSchema.optional(), privateLabel: privateLabelSchema, homePlacement: homePlacementSchema }).superRefine(requireCalendarStartForCustomPeriod);
export type TargetSavePayload = z.infer<typeof targetSavePayloadSchema>;
export const targetEditPayloadSchema = z
  .strictObject({ targetId: targetIdSchema, measure: measureSchema, quantity: quantitySchema, period: periodSchema, calendarStart: civilDateSchema.optional(), privateLabel: privateLabelSchema.optional(), homePlacement: homePlacementSchema.optional() })
  .superRefine(requireCalendarStartForCustomPeriod);
export type TargetEditPayload = z.infer<typeof targetEditPayloadSchema>;
export const targetPausePayloadSchema = z.strictObject({ targetId: targetIdSchema });
export type TargetPausePayload = z.infer<typeof targetPausePayloadSchema>;
export const targetEndPayloadSchema = z.strictObject({ targetId: targetIdSchema });
export type TargetEndPayload = z.infer<typeof targetEndPayloadSchema>;
