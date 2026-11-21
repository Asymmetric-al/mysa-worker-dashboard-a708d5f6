/**
 * The Coaching family's three stop-type payloads, and the closed table that binds every stop-type
 * effect to exactly one named mutation and the one schema that guards that mutation's payload.
 */
import { z } from "zod";
import type { StopEffect } from "../copy";
import { withdrawCheckInPayloadSchema } from "./checkin";
import { moduleChangePayloadSchema } from "./module";
import { taskShareStopPayloadSchema } from "./taskshare";
// Grant identity, and the three payloads that carry nothing else
const grantReferenceSchema = z.string().trim().min(1);
/** Validates the `revokeGrant` payload: the grant whose coach access is being revoked. */
export const revokeGrantPayloadSchema = z.strictObject({
  grantId: grantReferenceSchema,
});
/** The validated `revokeGrant` payload: one opaque grant reference and nothing else. */
export type RevokeGrantPayload = z.infer<typeof revokeGrantPayloadSchema>;
/** Validates the `endCoaching` payload: the grant the worker is ending. */
export const endCoachingPayloadSchema = z.strictObject({
  grantId: grantReferenceSchema,
});
/** The validated `endCoaching` payload: one opaque grant reference and nothing else. */
export type EndCoachingPayload = z.infer<typeof endCoachingPayloadSchema>;
/** Validates the `leaveCoaching` payload: the grant the coach is leaving. */
export const leaveCoachingPayloadSchema = z.strictObject({
  grantId: grantReferenceSchema,
});
/** The validated `leaveCoaching` payload: one opaque grant reference and nothing else. */
export type LeaveCoachingPayload = z.infer<typeof leaveCoachingPayloadSchema>;
// The six named mutations the effects reach, and the closed table that binds them
/** The six named mutations a stop-type effect may reach, spelled exactly as AAP 0.7.1 names them. */
export type StopMutation = "setModule" | "withdrawCheckIn" | "stopTaskShare" | "endCoaching" | "leaveCoaching" | "revokeGrant";
/** One stop-type action: the single named mutation it dispatches to, and the schema that guards that mutation's payload. */
export type StopAction = {
  readonly mutation: StopMutation;
  readonly schema: z.ZodType;
};
/** The closed table from each stop-type effect to its one mutation and its one payload schema. */
export const STOP_ACTIONS = {
  "stop-module": { mutation: "setModule", schema: moduleChangePayloadSchema },
  "withdraw-check-in": { mutation: "withdrawCheckIn", schema: withdrawCheckInPayloadSchema },
  "remove-task-share": { mutation: "stopTaskShare", schema: taskShareStopPayloadSchema },
  "end-relationship": { mutation: "endCoaching", schema: endCoachingPayloadSchema },
  "coach-leave": { mutation: "leaveCoaching", schema: leaveCoachingPayloadSchema },
  revoke: { mutation: "revokeGrant", schema: revokeGrantPayloadSchema },
} as const satisfies Record<StopEffect, StopAction>;
/** The action bound to the effect the person chose, and the single accessor the surface calls. */
export function stopActionFor(effect: StopEffect): StopAction {
  return STOP_ACTIONS[effect];
}
