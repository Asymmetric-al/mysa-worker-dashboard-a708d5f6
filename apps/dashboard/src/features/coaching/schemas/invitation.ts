/**
 * The Coaching family's two invitation payloads: the one a worker submits to invite one named coach
 * (`inviteCoach`) and the one a coach submits to accept the invitation they were given
 * (`acceptInvitation`).
 *
 * Plan items that put this file in scope:
 * - AAP 0.11.1 deliverable row `apps/dashboard/src/features/coaching/**`: the Coaching family's Zod
 *   schemas, of which this file holds the invitation and its acceptance.
 * - AAP 0.8.4 rules 1-3: an invitation names the recipient, the organization, the ministry, the five
 *   modules and the duration, with every module unselected; delivery, identity verification,
 *   deliberate acceptance and live access are four separate outcomes; financial disclosure uses a
 *   separately reviewed fixed date range.
 * - AAP 0.7.1: every mutation takes `{ operationId, scope, expectedRevision, payload }`. Only the
 *   `payload` is validated here — the envelope is composed by the hooks in `../hooks/` — so neither
 *   schema below declares `operationId`, `scope` or `expectedRevision`.
 *
 * What this file decides, and what it leaves alone. These schemas decide the shape of a payload
 * before it leaves the browser. They answer no admissibility question: whether the recipient exists,
 * whether this worker may invite them, whether the invitation is still the newest one, whether the
 * coach's identity is verified, and which instant the share cutoff freezes at are all decided by the
 * service against the record as it stands and the scenario clock, with `@/modules/coaching/grant`
 * owning the episode and `@/modules/time` owning every boundary. Nothing here reads a clock,
 * compares a revision, resolves a zone or asks a permission question.
 *
 * An outcome is never an input. Delivery, identity verification, acceptance, live access, the frozen
 * cutoff and the five module read states are values the service returns, so the strict objects below
 * refuse a payload that tries to state one about itself.
 *
 * Text and types only: no component, no JSX, no request, no store, no feature and no clock.
 */
import { z } from "zod";

import type { ModuleKey } from "@/modules/coaching/grant";
import { parseCivilDate } from "@/modules/time/civil";

// ---------------------------------------------------------------------------------------------
// The two values both payloads carry
// ---------------------------------------------------------------------------------------------

/**
 * An opaque reference, exactly as a read envelope handed it out.
 *
 * Never a name, an email address or a postal address: equal-looking identifiers establish neither
 * identity nor authority, so a payload carries the handle the service re-authorises rather than a
 * value it could match a record by. Blank text is refused, because it names nothing at all.
 */
const opaqueReferenceSchema = z.string().trim().min(1);

/**
 * A civil date carried as `YYYY-MM-DD` and read by `@/modules/time/civil`.
 *
 * Validated, never converted: the payload stays plain JSON for the Route Handler, so no date is
 * transformed into a `Temporal.PlainDate` here and no time of day, zone or instant is invented for
 * the day the worker chose. The calendar itself is read by the one civil-date implementation, so a
 * value shaped like a date that names no day — `2027-02-30`, for instance — is refused rather than
 * rolled forward into March, and this schema cannot answer differently from the service for one
 * value.
 *
 * The refusal carries no message of its own: the family's wording is owned by `../copy.ts`, which
 * has no builder for a structural failure yet, so Zod's own message stands until it gains one.
 */
const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom" });
    }
  });

// ---------------------------------------------------------------------------------------------
// The invitation
// ---------------------------------------------------------------------------------------------

/**
 * The module selection an invitation carries: all five modules off.
 *
 * An invitation grants nothing. A module is switched on only after acceptance, one at a time,
 * through `setModule`, so a payload that states a module as already on is refused rather than
 * quietly stripped — that is how "modules start unselected" stays a boundary instead of a
 * convention the service has to notice afterwards.
 *
 * The keys are listed so the shape reads as the five modules it is, and the annotation checks them
 * against `ModuleKey`, which is derived from the one `MODULE_KEYS` tuple: a misspelt key fails to
 * compile, and a sixth module added to that tuple fails here until it is listed too.
 */
const invitedModulesShape = {
  "support-goal": z.literal(false),
  "support-results": z.literal(false),
  targets: z.literal(false),
  "check-ins": z.literal(false),
  "task-summaries": z.literal(false),
} satisfies Record<ModuleKey, z.ZodLiteral<false>>;

/**
 * How long the worker chose to share: open-ended, or through one civil date.
 *
 * Required, with no default and no implicit "ongoing", because a missing duration is not permission:
 * it is refused here and again by `inviteGrant`. No zone field sits beside the date — the zone a
 * cutoff is resolved in belongs to the source, and a client-supplied one would let a display change
 * move a boundary that was already frozen. The zone and the exclusive cutoff are resolved
 * server-side when the invitation is accepted.
 */
const shareDurationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ongoing") }),
  z.strictObject({ kind: z.literal("through-date"), shareThroughDate: civilDateSchema }),
]);

/**
 * The separately reviewed fixed date range a worker may share, present only when they chose to share
 * financial results.
 *
 * One fixed period is what AAP 0.8.4 permits: the numbers inside it are measured by the service on
 * the retained basis and stated per currency, so the payload names the range and never an amount.
 * The two ends are compared as the serialised `YYYY-MM-DD` values, which order as calendar days
 * without a second date implementation, and the comparison runs only once both ends name a real day,
 * so an impossible date is reported as the impossible date it is rather than as a disordered range.
 */
const financialRangeSchema = z
  .strictObject({ fromDate: civilDateSchema, toDate: civilDateSchema })
  .refine((range) => range.fromDate <= range.toDate, { path: ["toDate"] });

/**
 * The `inviteCoach` payload: one named coach, the organization and ministry the invitation is made
 * in, all five modules off, a duration, and optionally the fixed range whose figures the coach may
 * read.
 *
 * The three references are principal and context identifiers, so no field here can be satisfied by a
 * name or an address that merely looks right. Organization and ministry travel in the payload rather
 * than being taken from the session because an invitation states the scope it was made in, and the
 * service re-checks that scope before it writes anything.
 */
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

// ---------------------------------------------------------------------------------------------
// The acceptance
// ---------------------------------------------------------------------------------------------

/**
 * The `acceptInvitation` payload: which invitation, and the revision of it the coach actually saw.
 *
 * The second field is named `invitationRevision` rather than `expectedRevision` because the envelope
 * already carries `expectedRevision` for the grant record, and two revision fields in one request
 * would let two competing checks disagree about which state was accepted. Carrying the revision the
 * coach saw is what makes a superseded invitation refusable: `superseded` is its own outcome rather
 * than a silent acceptance of whatever replaced it.
 *
 * Acceptance states nothing about identity: whether that identity is verified is a fact the service
 * reads from the session, never a value a payload may assert about itself.
 */
export const acceptancePayloadSchema = z.strictObject({
  grantId: opaqueReferenceSchema,
  invitationRevision: z.number().int().min(0),
});

/** The validated `acceptInvitation` payload. */
export type AcceptancePayload = z.infer<typeof acceptancePayloadSchema>;
