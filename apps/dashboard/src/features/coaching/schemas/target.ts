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
type PeriodChoice = { readonly period: PayloadPeriodKind; readonly calendarStart?: string | undefined; readonly periodEnd?: string | undefined };
/**
 * A one-off period states the two dates it runs between, so it is the only period shape this schema refines. The service
 * states the same requirement, and `PERIOD_COPY.custom` words it as the first date and the last date that the worker
 * names: without the second date on the wire a one-off period could never be recorded.
 */
function requireCustomPeriodDates(value: PeriodChoice, ctx: z.RefinementCtx): void {
  if (value.period !== "custom") {
    return;
  }
  if (value.calendarStart === undefined) {
    ctx.addIssue({ code: "custom", path: ["calendarStart"], message: "A one-off period states the day it starts." });
  }
  if (value.periodEnd === undefined) {
    ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "A one-off period states the day it ends." });
  }
}
const targetIdSchema = z.string().trim().min(1);
const quantitySchema = z.number().int().min(1);
const privateLabelSchema = z.string().trim().min(1);
const homePlacementSchema = z.boolean();
export const targetSavePayloadSchema = z.strictObject({ measure: measureSchema, quantity: quantitySchema, period: periodSchema, calendarStart: civilDateSchema.optional(), periodEnd: civilDateSchema.optional(), privateLabel: privateLabelSchema, homePlacement: homePlacementSchema }).superRefine(requireCustomPeriodDates);
export type TargetSavePayload = z.infer<typeof targetSavePayloadSchema>;
export const targetEditPayloadSchema = z
  .strictObject({ targetId: targetIdSchema, measure: measureSchema, quantity: quantitySchema, period: periodSchema, calendarStart: civilDateSchema.optional(), periodEnd: civilDateSchema.optional(), privateLabel: privateLabelSchema.optional(), homePlacement: homePlacementSchema.optional() })
  .superRefine(requireCustomPeriodDates);
export type TargetEditPayload = z.infer<typeof targetEditPayloadSchema>;
export const targetPausePayloadSchema = z.strictObject({ targetId: targetIdSchema });
export type TargetPausePayload = z.infer<typeof targetPausePayloadSchema>;
export const targetEndPayloadSchema = z.strictObject({ targetId: targetIdSchema });
export type TargetEndPayload = z.infer<typeof targetEndPayloadSchema>;
