/**
 * The Audience family's unsubscribe payload schema: the client half of `unsubscribe`, the one mutation
 * that turns a person's Update email from a single publisher for a single purpose off.
 */
import { z } from "zod";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
// The payload: one publisher, one purpose, and nothing else
const PUBLISHER_REFERENCE_MAX_LENGTH = 200;
/** Feeds `unsubscribe`: turn off this person's Update email from one publisher for one purpose. */
export const unsubscribePayloadSchema = z.strictObject({
  publisherId: z
    .string({ error: "Select the one publisher this unsubscribe applies to." })
    .min(1, "Select the one publisher this unsubscribe applies to.")
    .max(PUBLISHER_REFERENCE_MAX_LENGTH, `A publisher reference is at most ${PUBLISHER_REFERENCE_MAX_LENGTH} characters.`),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, "Select the one purpose this unsubscribe applies to."),
});
/** The payload `unsubscribe` accepts, inferred so the preferences surface and its hook hold one shape and no caller restates a field. */
export type UnsubscribePayload = z.infer<typeof unsubscribePayloadSchema>;
