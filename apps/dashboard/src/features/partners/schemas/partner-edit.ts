/**
 * The Partners family's `saveContactEdits` payload schema: the permitted fields of one partner record,
 * changed against the revision the caller read.
 */
import { z } from "zod";
import { CONTACT_METHOD_KINDS } from "@/modules/data-service/envelope";
function requiredText(message: string): z.ZodString {
  return z.string({ error: message }).min(1, message);
}
/** One contact method as a permitted edit states it: the kind, the value and whether the worker may use it. */
export const contactMethodEditSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, {
    error: "Choose a contact method kind: email, phone or postal.",
  }),
  value: requiredText("A contact method needs a value."),
  permitted: z.boolean({ error: "State whether this contact method may be used." }),
});
/** The validated contact-method edit: its kind, the value exactly as entered, and its permitted flag. */
export type ContactMethodEdit = z.infer<typeof contactMethodEditSchema>;
/** One restriction as a permitted edit states it, in the words the record already holds. */
export const restrictionEditSchema = z.strictObject({
  kind: requiredText("A restriction needs a short label."),
  detail: requiredText("A restriction states what must not happen."),
});
/** The validated restriction edit: the source-supplied label and the detail that states it. */
export type RestrictionEdit = z.infer<typeof restrictionEditSchema>;
/** The record's one relationship-context label: the source-supplied word the partner read renders, or `null` to clear it. */
export const relationshipContextEditSchema = requiredText("A relationship label cannot be blank; send null to clear it.").nullable();

const namePartsEditSchema = z.strictObject({
  given: requiredText("A given name cannot be blank; send null instead.").nullable(),
  family: requiredText("A family name cannot be blank; send null instead.").nullable(),
  additional: z.array(requiredText("An additional name cannot be blank; remove it instead.")),
});
/** The `saveContactEdits` payload: the target record and the permitted fields this change sets. */
export const saveContactEditsPayloadSchema = z.strictObject({
  partnerId: requiredText("Name the record this change applies to, then retry."),
  displayName: requiredText("A display name cannot be blank.").optional(),
  nameParts: namePartsEditSchema.optional(),
  contactMethods: z.array(contactMethodEditSchema).optional(),
  restrictions: z.array(restrictionEditSchema).optional(),
  stage: relationshipContextEditSchema.optional(),
});
/** The validated `saveContactEdits` payload: one opaque target reference and the fields it changes. */
export type SaveContactEditsPayload = z.infer<typeof saveContactEditsPayloadSchema>;
