import { z } from "zod";
import { CONTACT_METHOD_KINDS } from "@/modules/data-service/envelope";
import { privateNoteBodySchema } from "./private-note";
const PREPARATION_MESSAGES = { createShape: "A private contact is created from the fields this form shows, so remove any other field and submit again." } as const;
const preparationNameField = z.string({ error: "A private contact needs a name to recognise it by." }).refine((value) => value.trim().length > 0, { error: "A private contact needs a name with at least one visible character." });
const preparationReferenceField = z.string({ error: "Name the preparation record this change applies to, then retry." }).min(1, "A preparation record is named by its identifier, and that reference is empty.");
export const preparationContactMethodSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, { error: "Choose a contact method kind: email, phone or postal." }),
  value: z.string({ error: "A contact method needs a value, such as an address or a number." }).refine((value) => value.trim().length > 0, { error: "A contact method needs a value with at least one visible character." }),
  permitted: z.boolean({ error: "State whether this contact method may be used." }),
});
export type PreparationContactMethod = z.infer<typeof preparationContactMethodSchema>;
export const createPrivatePreparationPayloadSchema = z.strictObject({ displayName: preparationNameField, contactMethods: z.array(preparationContactMethodSchema).optional(), note: privateNoteBodySchema.optional() }, { error: PREPARATION_MESSAGES.createShape });
export type CreatePrivatePreparationPayload = z.infer<typeof createPrivatePreparationPayloadSchema>;
export const archivePreparationPayloadSchema = z.strictObject({ partnerId: preparationReferenceField }, { error: "Archiving a preparation names one record and nothing else, so remove any other field and submit again." });
export type ArchivePreparationPayload = z.infer<typeof archivePreparationPayloadSchema>;
export const restorePreparationPayloadSchema = z.strictObject({ partnerId: preparationReferenceField }, { error: "Restoring a preparation names one record and nothing else, so remove any other field and submit again." });
export type RestorePreparationPayload = z.infer<typeof restorePreparationPayloadSchema>;
