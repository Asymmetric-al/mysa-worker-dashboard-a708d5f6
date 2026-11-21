/**
 * The Partners family's two filing payloads: `setTag` and `setFavourite`.
 */
import { z } from "zod";
// Wording
const TAG_SCHEMA_MESSAGES = {
  partnerIdRequired: "This change is missing the partner record it applies to; open the record again and retry.",
  tagInvalid: "A tag is text, so type the label you want to file this record under.",
  tagRequired: "A tag needs at least one visible character.",
  tagTooLong: "A tag is a short label, so shorten this one to a few words.",
  presentInvalid: "A tag change sets the tag on or off, so set it rather than describing it.",
  favouriteInvalid: "A favourite is either on or off, so set it rather than describing it.",
} as const;
// The length the tag control and the schema share
/** The longest tag this schema accepts, counted in Unicode code points. */
export const PARTNER_TAG_MAX_LENGTH = 40;

function codePointCount(value: string): number {
  return Array.from(value).length;
}
// Field primitives both payloads share
const partnerIdField = z.string({ error: TAG_SCHEMA_MESSAGES.partnerIdRequired }).trim().min(1, TAG_SCHEMA_MESSAGES.partnerIdRequired);
/** The personal tag as the worker typed it, trimmed and measured but otherwise untouched. */
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
// setTag
/** Validates the `setTag` payload: one record, the tag's text, and whether that tag is now present. */
export const setTagPayloadSchema = z.strictObject({
  partnerId: partnerIdField,
  tag: tagValueSchema,
  present: z.boolean({ error: TAG_SCHEMA_MESSAGES.presentInvalid }),
});
/** The validated `setTag` payload: one opaque record reference, the tag, and its new presence. */
export type SetTagPayload = z.infer<typeof setTagPayloadSchema>;
// setFavourite
/** Validates the `setFavourite` payload: one record and the favourite state it should stand in. */
export const setFavouritePayloadSchema = z.strictObject({
  partnerId: partnerIdField,
  favourite: z.boolean({ error: TAG_SCHEMA_MESSAGES.favouriteInvalid }),
});
/** The validated `setFavourite` payload: one opaque record reference and the state it should hold. */
export type SetFavouritePayload = z.infer<typeof setFavouritePayloadSchema>;
