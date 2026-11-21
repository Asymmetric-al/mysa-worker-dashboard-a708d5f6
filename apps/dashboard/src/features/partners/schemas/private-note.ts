import { z } from "zod";
const PRIVATE_NOTE_MESSAGES = {
  partnerReferenceInvalid: "A record reference is text, so open the contact again and retry from its own page.",
  partnerIdEmpty: "Name the contact this note is about, because a note is filed against one record.",
  bodyInvalid: "A note is text, so write it as plain text rather than pasting anything else.",
  bodyEmpty: "A note needs at least one visible character.",
  audienceNotPrivate: "A private note is always filed as private, so its audience cannot be anything else.",
} as const;
export const PRIVATE_NOTE_AUDIENCE = "private" as const;
export const privateNoteAudienceSchema = z.literal(PRIVATE_NOTE_AUDIENCE, { error: PRIVATE_NOTE_MESSAGES.audienceNotPrivate });
export const privateNoteBodySchema = z.string({ error: PRIVATE_NOTE_MESSAGES.bodyInvalid }).refine((value) => value.trim().length > 0, { error: PRIVATE_NOTE_MESSAGES.bodyEmpty });
export const savePrivateNotePayloadSchema = z
  .strictObject({ partnerId: z.string({ error: PRIVATE_NOTE_MESSAGES.partnerReferenceInvalid }).min(1, PRIVATE_NOTE_MESSAGES.partnerIdEmpty), body: privateNoteBodySchema, audience: privateNoteAudienceSchema })
  .transform((payload) => ({ partnerId: payload.partnerId, body: payload.body }));
export type SavePrivateNotePayload = z.infer<typeof savePrivateNotePayloadSchema>;
