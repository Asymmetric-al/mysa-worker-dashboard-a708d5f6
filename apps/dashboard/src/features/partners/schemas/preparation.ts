/**
 * The Partners family's three private-preparation payloads: `createPrivatePreparation`,
 * `archivePreparation` and `restorePreparation`.
 */
import { z } from "zod";
// The closed contact-method vocabulary is imported from its single owner rather than restated here, so a
// method kind the record admits can never be refused by a second list kept in this file. `./partner-edit`
// reads the same tuple for the same reason; the two item schemas stay separate because a preparation's
// contact methods are its own creating payload and must be able to diverge from a permitted-field edit.
import { CONTACT_METHOD_KINDS } from "@/modules/data-service/envelope";
// The opening note is a private note like any other, so its body rule is the family's one rule for one.
import { privateNoteBodySchema } from "./private-note";
// Wording
const PREPARATION_MESSAGES = {
  createShape: "A private contact is created from the fields this form shows, so remove any other field and submit again.",
  nameMissing: "A private contact needs a name to recognise it by.",
  nameBlank: "A private contact needs a name with at least one visible character.",
  contactKindInvalid: "Choose a contact method kind: email, phone or postal.",
  contactValueMissing: "A contact method needs a value, such as an address or a number.",
  contactValueBlank: "A contact method needs a value with at least one visible character.",
  contactPermittedInvalid: "State whether this contact method may be used.",
  archiveShape: "Archiving a preparation names one record and nothing else, so remove any other field and submit again.",
  restoreShape: "Restoring a preparation names one record and nothing else, so remove any other field and submit again.",
  referenceMissing: "Name the preparation record this change applies to, then retry.",
  referenceBlank: "A preparation record is named by its identifier, and that reference is empty.",
} as const;
// Field primitives
const preparationNameField = z.string({ error: PREPARATION_MESSAGES.nameMissing }).refine((value) => value.trim().length > 0, { error: PREPARATION_MESSAGES.nameBlank });

const preparationReferenceField = z.string({ error: PREPARATION_MESSAGES.referenceMissing }).min(1, PREPARATION_MESSAGES.referenceBlank);
// One contact method on a new preparation
/** Validates one way of reaching the person a preparation is being created for: the kind of method, its value, and whether the worker may use it. */
export const preparationContactMethodSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, { error: PREPARATION_MESSAGES.contactKindInvalid }),
  value: z.string({ error: PREPARATION_MESSAGES.contactValueMissing }).refine((value) => value.trim().length > 0, { error: PREPARATION_MESSAGES.contactValueBlank }),
  permitted: z.boolean({ error: PREPARATION_MESSAGES.contactPermittedInvalid }),
});
/** The validated contact method on a new preparation: its kind, the value as entered, and its permitted flag. */
export type PreparationContactMethod = z.infer<typeof preparationContactMethodSchema>;
// createPrivatePreparation
/** Validates what `createPrivatePreparation` submits: a name, any contact methods, and an optional opening note. */
export const createPrivatePreparationPayloadSchema = z.strictObject(
  {
    displayName: preparationNameField,
    contactMethods: z.array(preparationContactMethodSchema).optional(),
    note: privateNoteBodySchema.optional(),
  },
  { error: PREPARATION_MESSAGES.createShape },
);
/** The validated `createPrivatePreparation` payload: the one required name, any contact methods and an optional note. */
export type CreatePrivatePreparationPayload = z.infer<typeof createPrivatePreparationPayloadSchema>;
// archivePreparation and restorePreparation
/** Validates the `archivePreparation` payload: the preparation being archived, and nothing else. */
export const archivePreparationPayloadSchema = z.strictObject(
  {
    partnerId: preparationReferenceField,
  },
  { error: PREPARATION_MESSAGES.archiveShape },
);
/** The validated `archivePreparation` payload: one opaque preparation reference and nothing else. */
export type ArchivePreparationPayload = z.infer<typeof archivePreparationPayloadSchema>;
/** Validates the `restorePreparation` payload: the archived preparation being returned to the working lists, and nothing else. */
export const restorePreparationPayloadSchema = z.strictObject(
  {
    partnerId: preparationReferenceField,
  },
  { error: PREPARATION_MESSAGES.restoreShape },
);
/** The validated `restorePreparation` payload: one opaque preparation reference and nothing else. */
export type RestorePreparationPayload = z.infer<typeof restorePreparationPayloadSchema>;
