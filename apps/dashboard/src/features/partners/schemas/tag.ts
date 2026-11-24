import { z } from "zod";
const TAG_SCHEMA_MESSAGES = { partnerIdRequired: "This change is missing the partner record it applies to; open the record again and retry." } as const;
const codePointCount = (value: string): number => Array.from(value).length;
const partnerIdField = z.string({ error: TAG_SCHEMA_MESSAGES.partnerIdRequired }).trim().min(1, TAG_SCHEMA_MESSAGES.partnerIdRequired);
export const tagValueSchema = z
  .string({ error: "A tag is text, so type the label you want to file this record under." })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointCount(value);
    if (length === 0) ctx.addIssue({ code: "custom", message: "A tag needs at least one visible character." });
    else if (length > 40) ctx.addIssue({ code: "custom", message: "A tag is a short label, so shorten this one to a few words." });
  });
export const setTagPayloadSchema = z.strictObject({ partnerId: partnerIdField, tag: tagValueSchema, present: z.boolean({ error: "A tag change sets the tag on or off, so set it rather than describing it." }) });
export type SetTagPayload = z.infer<typeof setTagPayloadSchema>;
export const setFavouritePayloadSchema = z.strictObject({ partnerId: partnerIdField, favourite: z.boolean({ error: "A favourite is either on or off, so set it rather than describing it." }) });
export type SetFavouritePayload = z.infer<typeof setFavouritePayloadSchema>;
