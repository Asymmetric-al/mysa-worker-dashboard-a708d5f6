import { z } from "zod";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
export const unsubscribePayloadSchema = z.strictObject({
  publisherId: z.string({ error: "Select the one publisher this unsubscribe applies to." }).min(1, "Select the one publisher this unsubscribe applies to.").max(200, `A publisher reference is at most ${200} characters.`),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, "Select the one purpose this unsubscribe applies to."),
});
export type UnsubscribePayload = z.infer<typeof unsubscribePayloadSchema>;
