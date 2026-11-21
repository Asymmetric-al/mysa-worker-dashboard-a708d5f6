/**
 * The audience proof journey: the browser-side payload checks for the two mutations that open and
 * close it — `signupForPurpose` (`POST /api/audience`) and the explicit `confirmMembership` (`POST
 * /api/confirm`).
 */
import { z } from "zod";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
import { languageTagSchema } from "./preference";
// signupForPurpose: the request that opens the proof step
/** Validates the `signupForPurpose` payload: which publisher's Update email is requested, that one purpose, the address notices would go to, and optionally a display name and a reading. */
export const signupPayloadSchema = z.strictObject({
  publisherId: z
    .string({ error: "Select the publisher this request belongs to." })
    .min(1, { error: "Select the publisher this request belongs to." })
    .max(200, { error: "A publisher reference is at most 200 characters." }),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, {
    error: "This request can only be made for Update email.",
  }),
  email: z.email({ error: "Enter a valid email address." }),
  displayName: z
    .string({ error: "A display name is at least one character, or left out." })
    .min(1, { error: "A display name is at least one character, or left out." })
    .max(120, { error: "A display name is at most 120 characters." })
    .optional(),
  languagePreference: languageTagSchema.optional(),
});
/** The validated `signupForPurpose` payload: what the proof flow's request step posts. */
export type SignupPayload = z.infer<typeof signupPayloadSchema>;
// confirmMembership: the explicit Confirm step
/** Validates the `confirmMembership` payload: the one membership being confirmed, and nothing else. */
export const confirmPayloadSchema = z.strictObject({
  membershipId: z
    .string({ error: "Select the membership to confirm." })
    .min(1, { error: "Select the membership to confirm." })
    .max(200, { error: "A membership identifier is at most 200 characters." }),
});
/** The validated `confirmMembership` payload: what the Confirm action posts. */
export type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;
