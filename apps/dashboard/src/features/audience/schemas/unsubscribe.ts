import { z } from "zod";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
const PUBLISHER_REFERENCE_MAX_LENGTH = 200;
export const unsubscribePayloadSchema = z.strictObject({
  publisherId: z.string({ error: "Select the one publisher this unsubscribe applies to." }).min(1, "Select the one publisher this unsubscribe applies to.").max(PUBLISHER_REFERENCE_MAX_LENGTH, `A publisher reference is at most ${PUBLISHER_REFERENCE_MAX_LENGTH} characters.`),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, "Select the one purpose this unsubscribe applies to."),
});
export type UnsubscribePayload = z.infer<typeof unsubscribePayloadSchema>;
