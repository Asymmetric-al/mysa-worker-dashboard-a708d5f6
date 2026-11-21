/**
 * The Partners family's `saveContactEdits` payload schema: the permitted fields of one partner record,
 * changed against the revision the caller read.
 *
 * This is the payload half of `{ operationId, scope, expectedRevision, payload }`. The three envelope
 * members are composed by `../hooks/use-partner-mutations.ts` from the envelope the form read, so
 * nothing here declares an operation identity, a selected scope or a revision: the strict objects below
 * refuse a payload that carries one instead of accepting a field nobody wrote. It decides shape, never
 * admissibility — the service re-validates with the schema it owns, re-checks the scope and the expected
 * revision, and answers from the closed outcome set, so its verdict is the one that counts.
 *
 * Absent on purpose, because each is a server-managed fact or another mutation's subject: `revision`,
 * `source`, `kind`, `audience`, `tags`, `favourite`, a contact method's `verified` flag and every consent
 * fact. Contactability and consent stay two facts: a method's `permitted` flag says the worker may use
 * the method, and it subscribes nobody. A payload with no changed field is legal rather than an error —
 * the service answers `unchanged` — so nothing below demands a difference.
 *
 * No length bound appears below. The service holds the only bounds a stored record holds, and a second
 * copy here could drift into refusing a value the service accepts; nothing typed is trimmed, rewritten
 * or defaulted on the way out, so a form submits exactly what the worker entered. Every refusal is keyed
 * to the field path a form renders it under (`@/components/form-field`), and each one says what to do,
 * because the library's default wording names no field and offers no action.
 */
import { z } from "zod";

import { CONTACT_METHOD_KINDS } from "@/modules/data-service/envelope";

/**
 * Text a permitted edit must supply: present and carrying at least one character, refused with the same
 * sentence either way.
 *
 * Zod reports an absent key as a type error and an empty string as a length failure, so the message is
 * stated for both — once as the value's own error, once as its first-character rule. That is what makes
 * either refusal reach the control it belongs to as a sentence a worker can act on.
 */
function requiredText(message: string): z.ZodString {
  return z.string({ error: message }).min(1, message);
}

/**
 * One contact method as a permitted edit states it: the kind, the value and whether the worker may use it.
 *
 * `verified` is absent because a form cannot assert it: this release verifies no address or number, a
 * stored record carries `verified: false`, and a payload claiming otherwise is refused rather than
 * silently corrected. `kind` is read from the closed vocabulary the record declares, so a method the
 * record admits can never be refused by a second list kept here.
 */
export const contactMethodEditSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, {
    error: "Choose a contact method kind: email, phone or postal.",
  }),
  value: requiredText("A contact method needs a value."),
  permitted: z.boolean({ error: "State whether this contact method may be used." }),
});

/** The validated contact-method edit: its kind, the value exactly as entered, and its permitted flag. */
export type ContactMethodEdit = z.infer<typeof contactMethodEditSchema>;

/**
 * One restriction as a permitted edit states it, in the words the record already holds.
 *
 * `kind` is a short source-supplied label rather than a closed list, which is what lets a negative
 * restriction survive a save: "do not contact" or "no visits" is carried by its own label and detail and
 * re-submitted unchanged. There is no polarity flag to set, no entry dropped on the way through and no
 * second vocabulary to translate it into, so a restriction the form loaded is a restriction it can save.
 */
export const restrictionEditSchema = z.strictObject({
  kind: requiredText("A restriction needs a short label."),
  detail: requiredText("A restriction states what must not happen."),
});

/** The validated restriction edit: the source-supplied label and the detail that states it. */
export type RestrictionEdit = z.infer<typeof restrictionEditSchema>;

/**
 * The record's one relationship-context label: the source-supplied word the partner read renders, or
 * `null` to clear it.
 *
 * The payload member is `stage`, the record's own field name, because that is the member
 * `saveContactEdits` accepts; the read presents the same value as the record's relationship context. No
 * list of labels is declared here: the record admits a short source-supplied label rather than a
 * taxonomy, so a list written in this file would invent relationships the source never supplied.
 */
export const relationshipContextEditSchema = requiredText(
  "A relationship label cannot be blank; send null to clear it.",
).nullable();

/**
 * The parts a partner's name is recorded in, as an edit states them.
 *
 * A part that does not apply is `null` rather than an empty string, and the parts are never concatenated
 * to derive a display name: a form edits one component without rewriting the name the record displays.
 */
const namePartsEditSchema = z.strictObject({
  given: requiredText("A given name cannot be blank; send null instead.").nullable(),
  family: requiredText("A family name cannot be blank; send null instead.").nullable(),
  additional: z.array(requiredText("An additional name cannot be blank; remove it instead.")),
});

/**
 * The `saveContactEdits` payload: the target record and the permitted fields this change sets.
 *
 * `partnerId` travels in the payload because the mutation takes its target there, and it names a record
 * by identifier alone — never by a display name, an email address or a postal address, because
 * equal-looking values establish neither identity nor authority. Every changeable member is optional, so
 * a form sends the fields it changed and a save that changed none is `{ partnerId }`: a no-op the service
 * answers `unchanged`, not a failure invented here. An array order is the record's order; a form that
 * removes a contact method sends the remaining ones.
 */
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
