import { z } from "zod";
import { CONTACT_METHOD_KINDS } from "@/modules/data-service/envelope";
const requiredText = (message: string): z.ZodString => z.string({ error: message }).min(1, message);
export const contactMethodEditSchema = z.strictObject({ kind: z.enum(CONTACT_METHOD_KINDS, { error: "Choose a contact method kind: email, phone or postal." }), value: requiredText("A contact method needs a value."), permitted: z.boolean({ error: "State whether this contact method may be used." }) });
export const restrictionEditSchema = z.strictObject({ kind: requiredText("A restriction needs a short label."), detail: requiredText("A restriction states what must not happen.") });
export const relationshipContextEditSchema = requiredText("A relationship label cannot be blank; send null to clear it.").nullable();
const namePartsEditSchema = z.strictObject({ given: requiredText("A given name cannot be blank; send null instead.").nullable(), family: requiredText("A family name cannot be blank; send null instead.").nullable(), additional: z.array(requiredText("An additional name cannot be blank; remove it instead.")) });
export const saveContactEditsPayloadSchema = z.strictObject({
  partnerId: requiredText("Name the record this change applies to, then retry."),
  displayName: requiredText("A display name cannot be blank.").optional(),
  nameParts: namePartsEditSchema.optional(),
  contactMethods: z.array(contactMethodEditSchema).optional(),
  restrictions: z.array(restrictionEditSchema).optional(),
  stage: relationshipContextEditSchema.optional(),
});
export type SaveContactEditsPayload = z.infer<typeof saveContactEditsPayloadSchema>;
