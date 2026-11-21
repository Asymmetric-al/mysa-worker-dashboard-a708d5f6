/**
 * The `setPreference` payload contract: which of the reader's own memberships a choice is recorded
 * against, which of the two choices it is, and — only when the same request also changes the reading
 * language — that language.
 *
 * Plan items: AAP 0.7.1's *Reach readers* job group with its mutations inventory (`signupForPurpose`,
 * `confirmMembership`, `setPreference`, `unsubscribe`), AAP 0.6.2's membership record, AAP 0.8.5's
 * consent rules, AAP 0.8.7's confirmation window, the AAP 0.11.1 deliverable row
 * `features/audience/**`, and success criterion 10.
 *
 * This schema types the **payload alone** — the `payload` member of `MutationInput<P>`. The other three
 * members of the mutation input, `operationId`, `scope` and `expectedRevision`, belong to the caller
 * and the service and are composed once in `../hooks/use-audience-mutations.ts`, so nothing here
 * declares them and this file cannot become a second definition of the envelope.
 *
 * The service's `setPreference` payload schema in `modules/data-service/mutations/audience.ts` stays
 * the authority, and this file mirrors it: the same three fields, the same bounds, the same closed
 * vocabularies and the same strictness, so a payload this schema accepts is one the service accepts.
 * Where the two disagree the service wins and this file is corrected, because the service re-validates
 * every payload and answers `invalid` with the per-field messages that `@/components/form-field.tsx`
 * renders; a schema here only spares the reader a round trip for a mistake their form can already see.
 *
 * The purpose is deliberately not a field. `setPreference` addresses one membership inside the selected
 * context, and that context already carries the publisher and the one purpose this release keeps
 * (`update-email`, declared in `@/modules/audience/membership`); the service reads both from the scope.
 * A payload able to name its own purpose would let a request ask for a different one, so leaving it out
 * makes every other purpose unrepresentable rather than merely unvalidated.
 *
 * Three things this payload can never say (AAP 0.8.5), and the strict object at the end of the file is
 * what makes each of them a property of the type rather than a convention:
 * 1. no state — `active`, `awaiting-proof`, `off` and `restricted` are the service's answer, so a client
 *    cannot force a membership on by sending the state it wants;
 * 2. no consent, subscription or `subscribed`-looking flag — a preference is not consent, an imported or
 *    edited contact subscribes nobody, and a source column named `subscribed` proves nothing;
 * 3. no frequency, digest, cadence or channel — this audience offers Off and Immediate and nothing else.
 *
 * Absent by design: no clock read and no deadline, because the 168-hour confirmation window is resolved
 * by the service through `@/modules/time/window` and the scenario clock is an offset the development
 * runtime owns; no email address, which is a value on the record and never a join key; no component,
 * hook or route; and no dependency beyond `zod` and the audience module's closed vocabularies.
 */
import { z } from "zod";

import { MEMBER_CHOICES, type MemberChoice } from "@/modules/audience/membership";

// ---------------------------------------------------------------------------------------------
// The three fields a preference change states
// ---------------------------------------------------------------------------------------------

/**
 * The shape of a reading-language tag: a primary language subtag followed by its hyphenated subtags
 * (`en`, `en-GB`, `ar`, `zh-Hant-TW`), within RFC 5646's 35-character limit checked on the field below.
 *
 * Shape only — this is not a registry lookup. Matching a tag to an edition, resolving the fallback when
 * this publisher has no edition in the chosen language, and reading that edition's direction belong to
 * the content module. The primary subtag is two or three letters because that is the shape the service
 * accepts, so a tag this schema passes is a tag the service passes as well.
 */
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;

/**
 * Which of the reader's own memberships this decision is for: an opaque identifier, carried exactly as
 * given.
 *
 * It is never trimmed, parsed or compared with an address, a name or a value that merely looks like
 * one — equal-looking identifiers establish neither identity nor authority, and the person is the
 * record's identity. The 200-character bound is the service's own, so a reference the service would
 * accept is never refused here for being too long.
 */
const membershipIdSchema = z
  .string({ error: "Select the membership this preference applies to." })
  .min(1, { error: "Select the membership this preference applies to." })
  .max(200, {
    error:
      "That reference is too long to be one membership, so open your preferences again from the page that lists them instead of pasting a value.",
  });

/**
 * Off or Immediate, taken whole from the audience module's closed pair rather than restated here, so a
 * third choice cannot be sent from a form without first appearing in `@/modules/audience/membership`.
 *
 * The `satisfies` clause turns a drift from `MemberChoice` into a compile error in this file instead of
 * a choice the family's copy cannot word.
 */
const choiceSchema = z.enum(MEMBER_CHOICES, {
  error: "Choose Off or Immediate. Those are the only two choices for this purpose.",
}) satisfies z.ZodType<MemberChoice, MemberChoice>;

/**
 * The reading language, held as a **separate field from `choice`** because it is a separate fact.
 *
 * A language is neither an act of consent nor proof of email possession. Changing it neither subscribes
 * nor unsubscribes anyone, never resets a confirmation window, and never alters the fate of a notice
 * already accepted or left unknown — that notice keeps the rendition it was pinned to. A request that
 * changes only the language therefore sends the choice the reader already has, unchanged, beside it.
 *
 * Absence is the only way to say "leave the language as it is": an empty string is not a language tag
 * and is refused, so a form with no language to send leaves the key out rather than clearing a stored
 * preference with a blank.
 */
const languagePreferenceSchema = z
  .string({ error: "Use a language tag such as en-GB or ar." })
  .max(35, { error: "Use a language tag of 35 characters or fewer." })
  .regex(LANGUAGE_TAG_SHAPE, { error: "Use a language tag such as en-GB or ar." });

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

/**
 * The `setPreference` payload.
 *
 * Strict, so an unknown key is refused at this boundary instead of being dropped and saved with a
 * meaning it was never given. The keys that matter most are the ones this payload must never carry: a
 * subscription or consent flag, a membership state, a frequency, a digest or a channel.
 */
export const setPreferencePayloadSchema = z.strictObject({
  membershipId: membershipIdSchema,
  choice: choiceSchema,
  languagePreference: languagePreferenceSchema.optional(),
});

/** The validated `setPreference` payload. */
export type SetPreferencePayload = z.infer<typeof setPreferencePayloadSchema>;
