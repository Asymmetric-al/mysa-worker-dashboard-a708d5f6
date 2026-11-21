/**
 * The Coaching family's `setModule` payload schema: one grant, one of the sharable modules, and
 * whether that module is now shared.
 *
 * Plan items that put this file in scope:
 * - AAP 0.11.1 deliverable row `apps/dashboard/src/features/coaching/**`: the family's Zod payload
 *   schemas, of which the module toggle is one.
 * - AAP 0.7.1 named inventory, "Prepare and share with a coach": the mutation `setModule`, which this
 *   schema guards before submit.
 * - AAP 0.8.4 coaching rules: five independently selected module toggles, and Stop a module kept
 *   distinct from withdrawing a check-in, removing a task share, ending the relationship and a coach
 *   leaving — none of which deletes the work behind it.
 * - Rule 1 clause 1: exactly this one payload, with no field for a capability the release defers.
 *
 * It validates the **payload alone**. The four-field mutation input — operation identity, selected
 * context, expected revision and the payload — is composed in `../hooks/use-coaching-mutations.ts`,
 * so nothing here declares an operation id, a scope or a revision, and nothing here reads a clock or
 * compares one.
 *
 * The service's own per-mutation schema stays the authority: it re-checks the scope, the holder and
 * the revision, and answers from the closed outcome set. This schema only spares the worker a round
 * trip for a mistake the form can already see.
 *
 * The module names are not restated here. `MODULE_KEYS` is their one declaration, in the domain module
 * that also owns the selection, the read states and the episode, so adding or renaming a module fails
 * this file's compilation instead of leaving a second list to drift.
 *
 * Wording: `../copy.ts` has no builder yet for an unknown module key, a missing on-or-off flag or a
 * missing grant, so those refusals stand on Zod's default messages until the family's copy catalogue
 * words them. No refusal sentence is written inline here, and no limit appears in this file.
 */
import { z } from "zod";

import { MODULE_KEYS } from "@/modules/coaching/grant";

/**
 * Validates the `setModule` payload: the grant it addresses, the one module it changes, and whether
 * that module is now shared with the coach.
 *
 * `enabled: false` is the *stop this module* effect: it ends that module's disclosure and changes no
 * source record, so the object is strict and offers no `delete`, `cascade`, `removeData`, `revoke`,
 * `reason` or `effectiveAt` field — a payload that asks for deletion is refused rather than honoured.
 */
export const moduleChangePayloadSchema = z.strictObject({
  grantId: z.string().trim().min(1),
  moduleKey: z.enum(MODULE_KEYS),
  enabled: z.boolean(),
});

/** The validated `setModule` payload: one opaque grant reference, one module key, and its new flag. */
export type ModuleChangePayload = z.infer<typeof moduleChangePayloadSchema>;
