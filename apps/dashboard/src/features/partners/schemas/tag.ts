import { z } from "zod";
const TAG_SCHEMA_MESSAGES = {
  partnerIdRequired: "This change is missing the partner record it applies to; open the record again and retry.",
  tagInvalid: "A tag is text, so type the label you want to file this record under.",
  tagRequired: "A tag needs at least one visible character.",
  tagTooLong: "A tag is a short label, so shorten this one to a few words.",
  presentInvalid: "A tag change sets the tag on or off, so set it rather than describing it.",
  favouriteInvalid: "A favourite is either on or off, so set it rather than describing it.",
} as const;
export const PARTNER_TAG_MAX_LENGTH = 40;
function codePointCount(value: string): number {
  return Array.from(value).length;
}
const partnerIdField = z.string({ error: TAG_SCHEMA_MESSAGES.partnerIdRequired }).trim().min(1, TAG_SCHEMA_MESSAGES.partnerIdRequired);
export const tagValueSchema = z
  .string({ error: TAG_SCHEMA_MESSAGES.tagInvalid })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointCount(value);
    if (length === 0) {
      ctx.addIssue({ code: "custom", message: TAG_SCHEMA_MESSAGES.tagRequired });
    } else if (length > PARTNER_TAG_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: TAG_SCHEMA_MESSAGES.tagTooLong });
    }
  });
export const setTagPayloadSchema = z.strictObject({ partnerId: partnerIdField, tag: tagValueSchema, present: z.boolean({ error: TAG_SCHEMA_MESSAGES.presentInvalid }) });
export type SetTagPayload = z.infer<typeof setTagPayloadSchema>;
export const setFavouritePayloadSchema = z.strictObject({ partnerId: partnerIdField, favourite: z.boolean({ error: TAG_SCHEMA_MESSAGES.favouriteInvalid }) });
export type SetFavouritePayload = z.infer<typeof setFavouritePayloadSchema>;
