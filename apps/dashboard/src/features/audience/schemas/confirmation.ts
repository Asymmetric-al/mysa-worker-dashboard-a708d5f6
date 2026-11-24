import { z } from "zod";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
import { languageTagSchema } from "./preference";
export const signupPayloadSchema = z.strictObject({
  publisherId: z.string({ error: "Select the publisher this request belongs to." }).min(1, { error: "Select the publisher this request belongs to." }).max(200, { error: "A publisher reference is at most 200 characters." }),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, { error: "This request can only be made for Update email." }),
  email: z.email({ error: "Enter a valid email address." }),
  displayName: z.string({ error: "A display name is at least one character, or left out." }).min(1, { error: "A display name is at least one character, or left out." }).max(120, { error: "A display name is at most 120 characters." }).optional(),
  languagePreference: languageTagSchema.optional(),
});
export type SignupPayload = z.infer<typeof signupPayloadSchema>;
export const confirmPayloadSchema = z.strictObject({ membershipId: z.string({ error: "Select the membership to confirm." }).min(1, { error: "Select the membership to confirm." }).max(200, { error: "A membership identifier is at most 200 characters." }) });
export type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;
