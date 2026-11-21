/**
 * The Partners family's `savePrivateNote` payload schema: what the note composer submits about one
 * partner record, and nothing else.
 */
import { z } from "zod";
// Wording
const PRIVATE_NOTE_MESSAGES = {
  partnerReferenceInvalid: "A record reference is text, so open the contact again and retry from its own page.",
  partnerIdEmpty: "Name the contact this note is about, because a note is filed against one record.",
  bodyInvalid: "A note is text, so write it as plain text rather than pasting anything else.",
  bodyEmpty: "A note needs at least one visible character.",
  audienceNotPrivate: "A private note is always filed as private, so its audience cannot be anything else.",
} as const;
// The audience
/** The one spelling of a private note's audience in the Partners family. */
export const PRIVATE_NOTE_AUDIENCE = "private" as const;
/** Validates the audience a note is filed under: `"private"`, and no other value. */
export const privateNoteAudienceSchema = z.literal(PRIVATE_NOTE_AUDIENCE, {
  error: PRIVATE_NOTE_MESSAGES.audienceNotPrivate,
});
// The body
/** Validates the text of a private note: any non-empty plain text, stored exactly as it was entered. */
export const privateNoteBodySchema = z.string({ error: PRIVATE_NOTE_MESSAGES.bodyInvalid }).refine((value) => value.trim().length > 0, { error: PRIVATE_NOTE_MESSAGES.bodyEmpty });
// The payload
/** Validates what `savePrivateNote` submits: the record the note belongs to, its text, and the audience it is filed under. */
export const savePrivateNotePayloadSchema = z
  .strictObject({
    partnerId: z.string({ error: PRIVATE_NOTE_MESSAGES.partnerReferenceInvalid }).min(1, PRIVATE_NOTE_MESSAGES.partnerIdEmpty),
    body: privateNoteBodySchema,
    audience: privateNoteAudienceSchema,
  })
  .transform((payload) => ({ partnerId: payload.partnerId, body: payload.body }));
/** The validated `savePrivateNote` payload: one record reference and one note body, with no audience left to get wrong. */
export type SavePrivateNotePayload = z.infer<typeof savePrivateNotePayloadSchema>;
