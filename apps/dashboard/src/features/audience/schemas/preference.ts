import { z } from "zod";
import { MEMBER_CHOICES, type MemberChoice } from "@/modules/audience/membership";
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;
export const languageTagSchema = z.string({ error: "Use a language tag such as en-GB or ar." }).max(35, { error: "Use a language tag of 35 characters or fewer." }).regex(LANGUAGE_TAG_SHAPE, { error: "Use a language tag such as en-GB or ar." });
const membershipIdSchema = z
  .string({ error: "Select the membership this preference applies to." })
  .min(1, { error: "Select the membership this preference applies to." })
  .max(200, { error: "That reference is too long to be one membership, so open your preferences again from the page that lists them instead of pasting a value." });
const choiceSchema = z.enum(MEMBER_CHOICES, { error: "Choose Off or Immediate. Those are the only two choices for this purpose." }) satisfies z.ZodType<MemberChoice, MemberChoice>;
export const setPreferencePayloadSchema = z.strictObject({ membershipId: membershipIdSchema, choice: choiceSchema, languagePreference: languageTagSchema.optional() });
export type SetPreferencePayload = z.infer<typeof setPreferencePayloadSchema>;
