/**
 * The Partners family's two filing payloads: `setTag` and `setFavourite`.
 *
 * Each one is the **payload half** of the four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }`. The operation identity, the selected context
 * and the expected revision are composed by `../hooks/use-partner-mutations.ts`, so neither schema
 * declares them, and both objects are strict: an envelope field smuggled into a payload is refused
 * by name instead of being dropped while the caller believes it was sent.
 *
 * A tag is the worker's own filing word and a favourite is the worker's own shortlist. Neither is a
 * segment, an audience, a consent, a subscription, a campaign, a stage or a send, and no field below
 * could express one — so no request body built from these schemas can claim that a person agreed to
 * anything, was reached, gave, or belongs in a group. The target is one partner record named by an
 * opaque reference, never a filter, a saved view or "everything that matches": the record the worker
 * opened is the record the mutation addresses.
 *
 * The service's own payload schema stays the authority — it re-checks the scope, the record and the
 * revision, and answers from the closed outcome set (`accepted`, `alreadyAccepted`, `unchanged`,
 * `conflict`, `denied`, `invalid`, `unavailable`, `unknown`). These schemas decide shape only, so a
 * mistake the form can already see costs no round trip, and every refusal names the field path
 * `@/components/form-field.tsx` renders it against.
 *
 * Three facts about the shape are settled here rather than left to a caller, because getting one of
 * them wrong fails quietly:
 *
 * - **One record per payload.** The route addresses one partner (`POST /api/partners/[partnerId]/tags`)
 *   and the service changes one record per call, so a selection of several rows is one call each,
 *   with its own operation identity and its own per-record result. A selection is therefore never
 *   reported as one aggregate "done", and it can never stand in for a filter or an audience.
 * - **Presence is a state, not an instruction.** `present` and `favourite` are explicit booleans
 *   rather than add-or-remove words, so recovering a lost acknowledgement lands on the same state
 *   instead of flipping the record a second time; a record already in the asked state comes back
 *   `unchanged`, which is information the caller needs rather than a failure.
 * - **The tag is trimmed, and nothing else is normalised.** Trimming matches the rule the service
 *   stores by, so the name validated here is the name the record will carry; casing and the spacing
 *   inside the label stay exactly as typed, because two labels that differ only in case are two
 *   labels if that is what the worker meant.
 *
 * Plan items: AAP 0.6.1 "Mutations: partners" (`setTag`, `setFavourite`), AAP 0.6.3
 * `POST /api/partners/[partnerId]/tags`, AAP 0.7.1 "Find and open a partner", the AAP 0.9.1 tree row
 * `features/partners/**` and AAP 0.10.1's "personal tags and favourites". Rule 1 clause 1 keeps the
 * set closed: two named mutations, no second tag vocabulary, nothing for a capability the release
 * defers. Rule 1 clause 2 keeps it to Zod 4 with no form framework, no registry and no wrapper.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

/**
 * The refusals these two schemas can produce, declared once so no schema states a literal inline.
 *
 * The Partners family words its controls in `../copy/`, and that folder has no key for a tag or a
 * favourite yet; these entries belong beside the facet and privacy wording there and move across the
 * next time that catalogue is edited. Each names the value that was refused and what to do about it,
 * never the person who typed it, and the tag rule is phrased as the service phrases it so the worker
 * reads one sentence before submitting and the same one after.
 */
const TAG_SCHEMA_MESSAGES = {
  /** A payload arrived without the partner record it applies to. */
  partnerIdRequired:
    "This change is missing the partner record it applies to; open the record again and retry.",
  /** A tag that arrived as something other than text. */
  tagInvalid: "A tag is text, so type the label you want to file this record under.",
  /** A tag that is empty, or holds only spaces. */
  tagRequired: "A tag needs at least one visible character.",
  /** A tag longer than a list row can show. */
  tagTooLong: "A tag is a short label, so shorten this one to a few words.",
  /** A presence flag that arrived as something other than a boolean. */
  presentInvalid: "A tag change sets the tag on or off, so set it rather than describing it.",
  /** A favourite flag that arrived as something other than a boolean. */
  favouriteInvalid: "A favourite is either on or off, so set it rather than describing it.",
} as const;

// ---------------------------------------------------------------------------------------------
// The length the tag control and the schema share
// ---------------------------------------------------------------------------------------------

/**
 * The longest tag this schema accepts, counted in Unicode code points.
 *
 * The tag control's `maxLength` and this schema read the same number, so a worker is never shown one
 * limit and refused by another, and it matches the bound the service stores by — a longer label
 * would be accepted here and refused a moment later. Code points rather than UTF-16 units are
 * counted so a script outside the Basic Multilingual Plane is not refused for characters the worker
 * can see. The service still decides what it admits.
 */
export const PARTNER_TAG_MAX_LENGTH = 40;

/** Counts a value in Unicode code points, so a character outside the Basic Multilingual Plane counts once. */
function codePointCount(value: string): number {
  return Array.from(value).length;
}

// ---------------------------------------------------------------------------------------------
// Field primitives both payloads share
// ---------------------------------------------------------------------------------------------

/**
 * An opaque reference to one partner record.
 *
 * Never parsed for meaning, split into parts or compared with a name or an email address: it is a
 * handle to one record inside one scope, and equal-looking values establish neither identity nor
 * authority. A blank value is refused because it names no record at all; whether that record exists
 * and whether this caller may change it are the service's questions.
 */
const partnerIdField = z
  .string({ error: TAG_SCHEMA_MESSAGES.partnerIdRequired })
  .trim()
  .min(1, TAG_SCHEMA_MESSAGES.partnerIdRequired);

/**
 * The personal tag as the worker typed it, trimmed and measured but otherwise untouched.
 *
 * Applicable to one record and no further: the value says nothing about contactability, consent,
 * giving or a stage, and it is visible to the worker alone. Blank-after-trimming is refused rather
 * than stored, because the tag is the whole purpose of the action and an empty one would change
 * nothing while still reporting a result.
 */
export const tagValueSchema = z
  .string({ error: TAG_SCHEMA_MESSAGES.tagInvalid })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointCount(value);

    if (length === 0) {
      ctx.addIssue({ code: "custom", message: TAG_SCHEMA_MESSAGES.tagRequired });
    } else if (length > PARTNER_TAG_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: TAG_SCHEMA_MESSAGES.tagTooLong });
    }
  });

// ---------------------------------------------------------------------------------------------
// setTag
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `setTag` payload: one record, the tag's text, and whether that tag is now present.
 *
 * Exactly two effects exist — the tag is on the record or it is not — and `present` states which, so
 * a replayed submit returns the stored result instead of applying the change twice. Applying a tag a
 * record already carries, or removing one it does not carry, is `unchanged` and not a failure. There
 * is no `tagId`, no owner, no timestamp and no ordering field: the record owns its list, and the
 * service writes it.
 */
export const setTagPayloadSchema = z.strictObject({
  partnerId: partnerIdField,
  tag: tagValueSchema,
  present: z.boolean({ error: TAG_SCHEMA_MESSAGES.presentInvalid }),
});

/** The validated `setTag` payload: one opaque record reference, the tag, and its new presence. */
export type SetTagPayload = z.infer<typeof setTagPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// setFavourite
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `setFavourite` payload: one record and the favourite state it should stand in.
 *
 * An explicit boolean rather than a toggle, for the same reason as `present`: recovering a lost
 * acknowledgement must produce the state that was asked for, never the opposite one. Marking a
 * record that is already a favourite, or clearing one that is not, is `unchanged`. Favouriting
 * records a change in the worker's own shortlist and proves nothing about the relationship.
 */
export const setFavouritePayloadSchema = z.strictObject({
  partnerId: partnerIdField,
  favourite: z.boolean({ error: TAG_SCHEMA_MESSAGES.favouriteInvalid }),
});

/** The validated `setFavourite` payload: one opaque record reference and the state it should hold. */
export type SetFavouritePayload = z.infer<typeof setFavouritePayloadSchema>;
