/**
 * The Coaching family's three stop-type payloads, and the closed table that binds every stop-type
 * effect to exactly one named mutation and the one schema that guards that mutation's payload.
 *
 * Plan items that put this file in scope:
 * - AAP 0.11.1 deliverable row `apps/dashboard/src/features/coaching/**`: the family's Zod payload
 *   schemas, of which the three payloads that end a disclosure are three.
 * - AAP 0.7.1 named inventory, "Prepare and share with a coach" and "Read as a coach": the mutations
 *   `endCoaching`, `leaveCoaching` and `revokeGrant`, each guarded here before submit — and the rule
 *   that the coach identity holds exactly two writes, `acceptInvitation` in `./invitation` and
 *   `leaveCoaching` below, so this file declares no other coach-identity write.
 * - AAP 0.8.4 coaching rule 6: the six stop-type effects are distinct, each works while an unrelated
 *   draft is invalid, none deletes the work behind it, and none claims recall of what a coach has
 *   already read.
 * - Rule 1 clause 1: these three payloads and the closed table, nothing more. No stop effect the copy
 *   module's union does not declare, and no dispatcher that could serve another family.
 *
 * What this file decides, and what it leaves alone. These schemas decide the shape of a payload before
 * it leaves the browser, and nothing else: the operation identity, the selected context and the
 * expected revision are the other three fields of the mutation input, composed by the hooks in
 * `../hooks/`, so no schema here declares one and nothing here reads a clock, compares a revision or
 * asks a permission question. The service's own per-mutation schema stays the authority; this file
 * only spares the worker a round trip for a shape the form can already see.
 *
 * `STOP_ACTIONS` is a closed lookup, not a command dispatcher. Its keys are the copy module's closed
 * union, its values are one named mutation and one payload schema, and the compiler proves the set is
 * complete. A registry keyed by arbitrary strings, a capability table or a "generic stop" would be the
 * universal dispatcher AAP 0.7.1 forbids by name, and would let one confirmation stand for six
 * different outcomes.
 *
 * Wording: `../copy.ts` owns the six effect names, their consequences and the two assurances each one
 * owes the person confirming it, and it has no builder yet for a missing or blank grant reference, so
 * the refusals below stand on Zod's own messages until the family's copy catalogue words them. No
 * sentence describing a stop effect is written here.
 *
 * Text and types only: no JSX, no React, no request, no store, no other feature folder, no clock.
 */
import { z } from "zod";

import type { StopEffect } from "../copy";
import { withdrawCheckInPayloadSchema } from "./checkin";
import { moduleChangePayloadSchema } from "./module";
import { taskShareStopPayloadSchema } from "./taskshare";

// ---------------------------------------------------------------------------------------------
// Grant identity, and the three payloads that carry nothing else
// ---------------------------------------------------------------------------------------------

/**
 * The opaque grant reference a stop-type payload carries, and the only value it carries.
 *
 * Never a name, an email address or a ministry label: equal-looking identifiers establish neither
 * identity nor authority, so a payload hands back the reference a read envelope gave out and lets the
 * service re-authorise it. Blank text names nothing at all and is refused.
 */
const grantReferenceSchema = z.string().trim().min(1);

/**
 * Validates the `revokeGrant` payload: the grant whose coach access is being revoked.
 *
 * The object is strict, so no `reason`, `effectiveAt`, `cascade`, `delete` or `confirmed` field can
 * travel with it. Revocation ends access from now on for every module and cannot be undone by a later
 * action, while two assurances stay beyond the payload's reach: the work behind each module is never
 * deleted, and nothing a coach has already read can be recalled.
 */
export const revokeGrantPayloadSchema = z.strictObject({
  grantId: grantReferenceSchema,
});

/** The validated `revokeGrant` payload: one opaque grant reference and nothing else. */
export type RevokeGrantPayload = z.infer<typeof revokeGrantPayloadSchema>;

/**
 * Validates the `endCoaching` payload: the grant the worker is ending.
 *
 * Declared separately from the revoke payload even though the two shapes match, because the two are
 * different acts with different consequences — the worker ending the relationship, and the worker
 * revoking a coach's access to it — and one schema serving both would make them one decision again.
 * Strict for the same reason: ending the relationship deletes no target, check-in, task share or note,
 * and no field in this payload can ask it to.
 */
export const endCoachingPayloadSchema = z.strictObject({
  grantId: grantReferenceSchema,
});

/** The validated `endCoaching` payload: one opaque grant reference and nothing else. */
export type EndCoachingPayload = z.infer<typeof endCoachingPayloadSchema>;

/**
 * Validates the `leaveCoaching` payload: the grant the coach is leaving.
 *
 * This is the coach identity's second and last write — acceptance, guarded in `./invitation`, is the
 * other — so its payload names the grant and states nothing on the worker's behalf. Leaving stops the
 * coach's own access and changes nothing of the worker's work; the record keeps the distinction
 * between a coach who left and a relationship the worker ended.
 */
export const leaveCoachingPayloadSchema = z.strictObject({
  grantId: grantReferenceSchema,
});

/** The validated `leaveCoaching` payload: one opaque grant reference and nothing else. */
export type LeaveCoachingPayload = z.infer<typeof leaveCoachingPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// The six named mutations the effects reach, and the closed table that binds them
// ---------------------------------------------------------------------------------------------

/**
 * The six named mutations a stop-type effect may reach, spelled exactly as AAP 0.7.1 names them.
 *
 * Closed by type rather than widened to `string`, so the table below cannot acquire an entry naming a
 * mutation the service does not expose, and a misspelt mutation fails to compile instead of failing at
 * submit time.
 */
export type StopMutation =
  | "setModule"
  | "withdrawCheckIn"
  | "stopTaskShare"
  | "endCoaching"
  | "leaveCoaching"
  | "revokeGrant";

/**
 * One stop-type action: the single named mutation it dispatches to, and the schema that guards that
 * mutation's payload.
 *
 * `schema` is typed as `z.ZodType` because three of the six payloads belong to sibling files: the
 * surface validates with whichever schema the table hands it, and never with a copy of one.
 */
export type StopAction = {
  readonly mutation: StopMutation;
  readonly schema: z.ZodType;
};

/**
 * The closed table from each stop-type effect to its one mutation and its one payload schema.
 *
 * `satisfies Record<StopEffect, StopAction>` is the whole guard: the key type is the copy module's own
 * union, so a member added there without an entry here fails to compile, a member renamed there leaves
 * a key unmatched, and an entry naming a mutation outside {@link StopMutation} is refused. The three
 * entries whose payload another file owns hold that file's exported schema instance itself, so the
 * distinct effects keep distinct payload contracts while no payload is declared twice.
 */
export const STOP_ACTIONS = {
  "stop-module": { mutation: "setModule", schema: moduleChangePayloadSchema },
  "withdraw-check-in": { mutation: "withdrawCheckIn", schema: withdrawCheckInPayloadSchema },
  "remove-task-share": { mutation: "stopTaskShare", schema: taskShareStopPayloadSchema },
  "end-relationship": { mutation: "endCoaching", schema: endCoachingPayloadSchema },
  "coach-leave": { mutation: "leaveCoaching", schema: leaveCoachingPayloadSchema },
  revoke: { mutation: "revokeGrant", schema: revokeGrantPayloadSchema },
} as const satisfies Record<StopEffect, StopAction>;

/**
 * The action bound to the effect the person chose, and the single accessor the surface calls.
 *
 * Deliberately without a default branch and without a fallback schema: an effect the copy union does
 * not declare cannot reach this function without failing the compiler, and a fallback would be exactly
 * the "generic stop" the six distinct effects exist to prevent.
 */
export function stopActionFor(effect: StopEffect): StopAction {
  return STOP_ACTIONS[effect];
}
