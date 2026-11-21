import { z } from "zod";
import type { ModuleKey } from "@/modules/coaching/grant";
import { parseCivilDate } from "@/modules/time/civil";
const opaqueReferenceSchema = z.string().trim().min(1);
const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom" });
    }
  });
const invitedModulesShape = { "support-goal": z.literal(false), "support-results": z.literal(false), targets: z.literal(false), "check-ins": z.literal(false), "task-summaries": z.literal(false) } satisfies Record<ModuleKey, z.ZodLiteral<false>>;
const shareDurationSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("ongoing") }), z.strictObject({ kind: z.literal("through-date"), shareThroughDate: civilDateSchema })]);
const financialRangeSchema = z.strictObject({ fromDate: civilDateSchema, toDate: civilDateSchema }).refine((range) => range.fromDate <= range.toDate, { path: ["toDate"] });
export const invitationPayloadSchema = z.strictObject({ coachPrincipalId: opaqueReferenceSchema, organizationId: opaqueReferenceSchema, ministryId: opaqueReferenceSchema, modules: z.strictObject(invitedModulesShape), duration: shareDurationSchema, financialRange: financialRangeSchema.optional() });
export type InvitationPayload = z.infer<typeof invitationPayloadSchema>;
export const acceptancePayloadSchema = z.strictObject({ grantId: opaqueReferenceSchema, invitationRevision: z.number().int().min(0) });
export type AcceptancePayload = z.infer<typeof acceptancePayloadSchema>;
