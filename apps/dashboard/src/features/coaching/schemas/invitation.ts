/**
 * The Coaching family's two invitation payloads: the one a worker submits to invite one named coach
 * (`inviteCoach`) and the one a coach submits to accept the invitation they were given
 * (`acceptInvitation`).
 */
import { z } from "zod";
import type { ModuleKey } from "@/modules/coaching/grant";
import { parseCivilDate } from "@/modules/time/civil";
// The two values both payloads carry
const opaqueReferenceSchema = z.string().trim().min(1);

const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom" });
    }
  });
// The invitation
const invitedModulesShape = {
  "support-goal": z.literal(false),
  "support-results": z.literal(false),
  targets: z.literal(false),
  "check-ins": z.literal(false),
  "task-summaries": z.literal(false),
} satisfies Record<ModuleKey, z.ZodLiteral<false>>;
const shareDurationSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("ongoing") }), z.strictObject({ kind: z.literal("through-date"), shareThroughDate: civilDateSchema })]);

const financialRangeSchema = z.strictObject({ fromDate: civilDateSchema, toDate: civilDateSchema }).refine((range) => range.fromDate <= range.toDate, { path: ["toDate"] });
/** The `inviteCoach` payload: one named coach, the organization and ministry the invitation is made in, all five modules off, a duration, and optionally the fixed range whose figures the coach. */
export const invitationPayloadSchema = z.strictObject({
  coachPrincipalId: opaqueReferenceSchema,
  organizationId: opaqueReferenceSchema,
  ministryId: opaqueReferenceSchema,
  modules: z.strictObject(invitedModulesShape),
  duration: shareDurationSchema,
  financialRange: financialRangeSchema.optional(),
});
/** The validated `inviteCoach` payload. */
export type InvitationPayload = z.infer<typeof invitationPayloadSchema>;
// The acceptance
/** The `acceptInvitation` payload: which invitation, and the revision of it the coach actually saw. */
export const acceptancePayloadSchema = z.strictObject({
  grantId: opaqueReferenceSchema,
  invitationRevision: z.number().int().min(0),
});
/** The validated `acceptInvitation` payload. */
export type AcceptancePayload = z.infer<typeof acceptancePayloadSchema>;
