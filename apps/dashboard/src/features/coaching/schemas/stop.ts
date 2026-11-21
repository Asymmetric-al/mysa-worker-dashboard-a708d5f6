import { z } from "zod";
import type { StopEffect } from "../copy";
import { withdrawCheckInPayloadSchema } from "./checkin";
import { moduleChangePayloadSchema } from "./module";
import { taskShareStopPayloadSchema } from "./taskshare";
const grantReferenceSchema = z.string().trim().min(1);
export const revokeGrantPayloadSchema = z.strictObject({ grantId: grantReferenceSchema });
export type RevokeGrantPayload = z.infer<typeof revokeGrantPayloadSchema>;
export const endCoachingPayloadSchema = z.strictObject({ grantId: grantReferenceSchema });
export type EndCoachingPayload = z.infer<typeof endCoachingPayloadSchema>;
export const leaveCoachingPayloadSchema = z.strictObject({ grantId: grantReferenceSchema });
export type LeaveCoachingPayload = z.infer<typeof leaveCoachingPayloadSchema>;
export type StopMutation = "setModule" | "withdrawCheckIn" | "stopTaskShare" | "endCoaching" | "leaveCoaching" | "revokeGrant";
export type StopAction = { readonly mutation: StopMutation; readonly schema: z.ZodType };
export const STOP_ACTIONS = {
  "stop-module": { mutation: "setModule", schema: moduleChangePayloadSchema },
  "withdraw-check-in": { mutation: "withdrawCheckIn", schema: withdrawCheckInPayloadSchema },
  "remove-task-share": { mutation: "stopTaskShare", schema: taskShareStopPayloadSchema },
  "end-relationship": { mutation: "endCoaching", schema: endCoachingPayloadSchema },
  "coach-leave": { mutation: "leaveCoaching", schema: leaveCoachingPayloadSchema },
  revoke: { mutation: "revokeGrant", schema: revokeGrantPayloadSchema },
} as const satisfies Record<StopEffect, StopAction>;
export function stopActionFor(effect: StopEffect): StopAction {
  return STOP_ACTIONS[effect];
}
