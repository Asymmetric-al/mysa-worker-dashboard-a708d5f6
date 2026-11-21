/**
 * The audience proof journey: the browser-side payload checks for the two mutations that open and close
 * it — `signupForPurpose` (`POST /api/audience`) and the explicit `confirmMembership`
 * (`POST /api/confirm`).
 *
 * Scope: AAP 0.6.1 "Mutations: audience"; 0.6.3's route table, where a confirmation is reachable only
 * by `POST` and never by `GET` or `HEAD`; 0.7.1, whose mutation input is
 * `{ operationId, scope, expectedRevision, payload }` and whose payload is validated before any state
 * change; 0.3.1 and 0.5.1 pinning Zod 4.6.7; 0.10.1 family 10, the audience and receiving experience,
 * with 0.8.5's consent rules and 0.8.7's 168-elapsed-hour confirmation window; and success criterion 10.
 *
 * Shape and vocabulary only. Which membership a confirmation addresses, whether its window is still
 * open, and what a signup becomes belong to `@/modules/data-service/mutations/audience` and
 * `@/modules/audience/membership`, which the service runs. Nothing here computes a deadline, reads a
 * clock, decides eligibility or records anything: these schemas stop a browser from posting a payload
 * that could not mean what the screen showed, and the service re-validates the same payload before it
 * changes anything.
 *
 * The proof journey is local and simulated. This application renders the confirmation message itself
 * and submits no mail anywhere, so no wording below claims that a message was delivered, that a
 * membership is eligible for anything, or that a reading right follows from an address.
 *
 * Each schema is the payload alone: `{ operationId, scope, expectedRevision }` is the shared mutation
 * envelope the mutation hook composes, so neither object declares it, and both are strict — a smuggled
 * envelope field is an issue at that field rather than a key silently dropped.
 *
 * Both schemas mirror the service's own payload schemas field for field, and the service is the
 * authority on that shape: a key it does not accept cannot be added here, because a strict object on
 * the receiving side would refuse every request as carrying an unknown key. The reading language is
 * the one field a second copy would let drift, so this file declares no shape of its own for it and
 * imports `languageTagSchema` from `./preference`, whose regex is the service's own: a tag one form
 * accepts is a tag the other accepts and a tag the service accepts.
 */

import { z } from "zod";

import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";

import { languageTagSchema } from "./preference";

// ---------------------------------------------------------------------------------------------
// signupForPurpose: the request that opens the proof step
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `signupForPurpose` payload: which publisher's Update email is requested, that one
 * purpose, the address notices would go to, and optionally a display name and a reading language.
 *
 * Signup opens the proof step and grants nothing. It produces an `awaiting-proof` membership, which is
 * neither consent nor eligibility and is never listed as a recipient, and only the explicit
 * confirmation below moves it on. That is why this payload carries no consent field at all: a caller
 * states an address, and nothing a caller sends can assert a permission.
 */
export const signupPayloadSchema = z.strictObject({
  /**
   * The publisher whose Update email is requested: an opaque identifier, carried and never parsed.
   * Bounded to the length the service accepts, so a malformed value is refused at this field instead
   * of arriving as a late refusal of the whole request.
   */
  publisherId: z
    .string({ error: "Select the publisher this request belongs to." })
    .min(1, { error: "Select the publisher this request belongs to." })
    .max(200, { error: "A publisher reference is at most 200 characters." }),
  /** The single purpose this release keeps memberships for; every other purpose is unrepresentable. */
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, {
    error: "This request can only be made for Update email.",
  }),
  /**
   * The address notices would go to: a value only — never a join key, never a lookup, never evidence of
   * authority. Two memberships holding the same address stay two memberships, and nothing compares this
   * value with a partner record, an imported row or a source column.
   */
  email: z.email({ error: "Enter a valid email address." }),
  /**
   * An optional name the person chooses. Absence is the only way to state "no name": a form that has
   * none omits the key rather than sending an empty string.
   */
  displayName: z
    .string({ error: "A display name is at least one character, or left out." })
    .min(1, { error: "A display name is at least one character, or left out." })
    .max(120, { error: "A display name is at most 120 characters." })
    .optional(),
  /**
   * An optional reading language, independent of the Off/Immediate choice and of proof of the address.
   * It neither subscribes nor unsubscribes anyone, never extends the confirmation window and never
   * substitutes the edition already pinned on a notice accepted earlier. Absence is the only way to
   * express "no preference", so a form with no choice omits the key. The shape is the family's one
   * language-tag check, so every tag this form accepts the preference form accepts too.
   */
  languagePreference: languageTagSchema.optional(),
});

/** The validated `signupForPurpose` payload: what the proof flow's request step posts. */
export type SignupPayload = z.infer<typeof signupPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// confirmMembership: the explicit Confirm step
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `confirmMembership` payload: the one membership being confirmed, and nothing else.
 *
 * The explicitness of the act is not a member of this payload, and cannot be. The service's payload for
 * this mutation names the membership alone (`@/modules/data-service/mutations/audience` declares a
 * strict object of `membershipId`), so a confirmation-flag key here would be refused as an unknown key
 * and no confirmation would ever reach the service. The rule is held where it cannot be worked around
 * instead: the command exists only at `POST /api/confirm`, which `GET` and `HEAD` never reach, and it
 * is issued only by the Confirm action on the rendered confirmation message. A page load, a mount
 * effect and a link preview therefore have no confirmation to send.
 *
 * No member of this payload states a window either. The 168 elapsed hours that follow acceptance are
 * resolved and enforced by the service: `confirmationDeadline` in `@/modules/time/window` computes the
 * instant, and the service's comparison against it is strict at equality, so a confirmation at the
 * deadline instant is already too late. The browser is shown the deadline that was resolved and never
 * computes, extends or sends one, which is why a reload, a retry and a resend never move it.
 */
export const confirmPayloadSchema = z.strictObject({
  /** The membership being confirmed: an opaque identifier, carried and never parsed. */
  membershipId: z
    .string({ error: "Select the membership to confirm." })
    .min(1, { error: "Select the membership to confirm." })
    .max(200, { error: "A membership identifier is at most 200 characters." }),
});

/** The validated `confirmMembership` payload: what the Confirm action posts. */
export type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;
