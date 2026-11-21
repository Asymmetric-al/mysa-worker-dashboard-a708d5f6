/**
 * The Partners family's `savePrivateNote` payload schema: what the note composer submits about one
 * partner record, and nothing else.
 *
 * It validates the **payload alone**. The four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }` is composed in
 * `../hooks/use-partner-mutations.ts`, so nothing here declares an operation identity, a scope or an
 * expected revision, and nothing here reads a clock, compares a revision or asks a permission question.
 * `noteId`, `authorPrincipalId`, `createdAt` and `revision` are absent for the same reason: the service
 * records who wrote a note and when, and no payload may assert either.
 *
 * The service validates the payload again and its verdict is the one that counts — `savePrivateNote`
 * re-checks the scope, the authorisation and the record as it stands before it writes, and answers from
 * the closed outcome set (`@/modules/data-service/outcome`). This schema only spares the worker a round
 * trip for a mistake the form can already see, so it mirrors the service's members and invents no bound
 * the service does not apply.
 *
 * The audience is a literal rather than a free string, and it is required rather than defaulted: a
 * private note is a different record class from a shared operational fact, so a note cannot be authored
 * as private and submitted as anything else, and a submission that omits the audience is refused rather
 * than quietly filed private. AAP 0.6.2 fixes the stored record's audience to `"private"`, and nothing
 * in this family may widen it.
 *
 * Plan items: AAP 0.6.1 "Mutations: partners" (`savePrivateNote`), AAP 0.7.1's "Prepare and maintain a
 * contact" group, AAP 0.6.2's private note record, AAP 0.10.1's "private note authoring with audience
 * labelling", and AAP 0.12.1 criterion 20, whose failed save must preserve the text that was entered.
 * Rule 1 clause 1: exactly this payload, with no field for a capability the release defers.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

/**
 * The refusals this schema states, worded once.
 *
 * `../copy/privacy.ts` is the family's wording source for guidance about what stays private, and it
 * carries no entry for a refusal about a note's own text: these sentences describe the value that was
 * refused and what to do about it, never the person who typed it. The empty-note sentence is the
 * service's own wording for the same refusal, so a mistake the form catches and the same mistake the
 * service catches read alike.
 */
const PRIVATE_NOTE_MESSAGES = {
  partnerReferenceInvalid:
    "A record reference is text, so open the contact again and retry from its own page.",
  partnerIdEmpty:
    "Name the contact this note is about, because a note is filed against one record.",
  bodyInvalid: "A note is text, so write it as plain text rather than pasting anything else.",
  bodyEmpty: "A note needs at least one visible character.",
  audienceNotPrivate:
    "A private note is always filed as private, so its audience cannot be anything else.",
} as const;

// ---------------------------------------------------------------------------------------------
// The audience
// ---------------------------------------------------------------------------------------------

/**
 * The one spelling of a private note's audience in the Partners family.
 *
 * Declared here so no surface retypes the word: this schema validates against it, the composer labels
 * the note with it, and a read states the audience it returned. A second literal spelling anywhere in
 * the family is what would let the stored value and the submitted value drift apart.
 */
export const PRIVATE_NOTE_AUDIENCE = "private" as const;

/**
 * Validates the audience a note is filed under: `"private"`, and no other value.
 *
 * A submission carrying `"shared"`, `"public"`, an empty string or no audience at all is refused with an
 * issue at the `audience` path, which is the field the composer shows it against. Widening this to a
 * plain string or an enum would be the one change that lets a note about a person be submitted into a
 * shared audience, so the literal is deliberate, and an omitted audience is a refusal rather than a
 * default that would file the note without the worker ever confirming where it goes.
 */
export const privateNoteAudienceSchema = z.literal(PRIVATE_NOTE_AUDIENCE, {
  error: PRIVATE_NOTE_MESSAGES.audienceNotPrivate,
});

// ---------------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------------

/**
 * Validates the text of a private note: any non-empty plain text, stored exactly as it was entered.
 *
 * Emptiness is judged on the trimmed value, so a note of spaces or a lone newline is refused; the value
 * itself is never trimmed, case-folded or otherwise normalised, because the text a worker wrote is what
 * the record holds and what a refused save must put back in front of them unchanged.
 *
 * No length limit is set here. The Action Plan fixes none for a partner field, and the service's own
 * bound stays the service's to apply: a note past it is refused with that bound's message at this same
 * path, rather than truncated, shortened or accepted here only to fail after a round trip.
 */
export const privateNoteBodySchema = z
  .string({ error: PRIVATE_NOTE_MESSAGES.bodyInvalid })
  .refine((value) => value.trim().length > 0, { error: PRIVATE_NOTE_MESSAGES.bodyEmpty });

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

/**
 * Validates what `savePrivateNote` submits: the record the note belongs to, its text, and the audience
 * it is filed under.
 *
 * `partnerId` is an opaque reference to one record in the selected context, never a name, an email
 * address or a postal address: equal-looking details establish neither identity nor authority, so a
 * payload satisfies a partner reference only by identifier.
 *
 * The object is strict, so an unexpected member — a `revision`, a `noteId`, an `authorPrincipalId`, a
 * `createdAt`, a `source` — is refused rather than stripped, and a caller never comes away believing it
 * wrote something it did not. Zod reports that refusal against the object rather than the offending
 * key, which the form shows at its own level while the field issues keep their `partnerId`, `body` and
 * `audience` paths.
 *
 * The parsed payload is the two members the service accepts. Its own strict `savePrivateNoteInput` is
 * `{ partnerId, body }` and it writes `audience: "private"` onto the record itself, so the audience is
 * validated here and then left out of what is handed over — requiring it first is what keeps a note
 * from reaching the service filed as anything but private.
 */
export const savePrivateNotePayloadSchema = z
  .strictObject({
    partnerId: z
      .string({ error: PRIVATE_NOTE_MESSAGES.partnerReferenceInvalid })
      .min(1, PRIVATE_NOTE_MESSAGES.partnerIdEmpty),
    body: privateNoteBodySchema,
    audience: privateNoteAudienceSchema,
  })
  .transform((payload) => ({ partnerId: payload.partnerId, body: payload.body }));

/** The validated `savePrivateNote` payload: one record reference and one note body, with no audience left to get wrong. */
export type SavePrivateNotePayload = z.infer<typeof savePrivateNotePayloadSchema>;
