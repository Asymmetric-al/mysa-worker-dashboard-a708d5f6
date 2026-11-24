import { z } from "zod";
const PRIVATE_NOTE_MESSAGES = { partnerIdEmpty: "Name the contact this note is about, because a note is filed against one record." } as const;
export const PRIVATE_NOTE_AUDIENCE = "private" as const;
export const privateNoteAudienceSchema = z.literal(PRIVATE_NOTE_AUDIENCE, { error: "A private note is always filed as private, so its audience cannot be anything else." });
export const privateNoteBodySchema = z.string({ error: "A note is text, so write it as plain text rather than pasting anything else." }).refine((value) => value.trim().length > 0, { error: "A note needs at least one visible character." });
export const savePrivateNotePayloadSchema = z.strictObject({ partnerId: z.string({ error: "A record reference is text, so open the contact again and retry from its own page." }).min(1, PRIVATE_NOTE_MESSAGES.partnerIdEmpty), body: privateNoteBodySchema, audience: privateNoteAudienceSchema });
export type SavePrivateNotePayload = z.infer<typeof savePrivateNotePayloadSchema>;
