/**
 * The Partners family's three private-preparation payloads: `createPrivatePreparation`,
 * `archivePreparation` and `restorePreparation`.
 *
 * Each one is the **payload half** of the four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }`. The operation identity, the selected context and
 * the expected revision are composed by `../hooks/use-partner-mutations.ts`, so none of the three
 * declares one, and all three objects are strict: an envelope field smuggled into a payload is refused
 * rather than dropped while the caller believes it was sent.
 *
 * A private preparation is **private by construction**, which is why no schema here has an audience
 * branch. The service creates the record as `kind: "private-preparation"` with `audience: "private"`,
 * authored by the acting principal, so there is no second audience to choose and nothing for the form to
 * label. For the same reason no payload states `kind`, `audience`, `isPrivate` or `recordClass`: the
 * mutation is already the private route, and a payload that asserted its own record class could assert
 * the wrong one — `kind: "person"` sent through the create route would be a way to make a shared record
 * out of a private one.
 *
 * Archiving is not deletion: it hides one preparation from the working lists and removes no record, no
 * note, no task and no independent obligation. Which record class archive and restore may touch is the
 * service's decision, not the payload's — `archivePreparation` and `restorePreparation` answer
 * `unchanged` for anything that is not the caller's own private preparation, and a payload claiming
 * otherwise is not evidence of anything.
 *
 * The service's own schemas stay the authority: `createPrivatePreparationInput`,
 * `archivePreparationInput` and `restorePreparationInput` in `@/modules/data-service/mutations/partners`.
 * The three below carry the same members and add no bound of their own, so nothing typed is trimmed,
 * rewritten or defaulted on the way out and a value past the service's own limit is refused there, at the
 * same field path, rather than shortened here.
 *
 * Plan items: AAP 0.6.1 "Mutations: partners" (`createPrivatePreparation`, `archivePreparation`,
 * `restorePreparation`), AAP 0.7.1's "Prepare and maintain a contact" group, AAP 0.6.2's Partner record
 * with its `private-preparation` kind and separate private note, AAP 0.10.1's "archive and restore of
 * private preparation only", and AAP 0.12.1 criterion 2, where the new worker "creates a private contact
 * with only a name". Rule 1 clause 1 keeps the set closed at three named mutations with no field for a
 * capability the release defers; clause 2 keeps it to Zod 4 with no registry, builder, barrel or form
 * framework; clause 3 keeps the created record private, the archive non-destructive, and every refusal
 * worded so the text the worker entered survives it.
 */
import { z } from "zod";

// The closed contact-method vocabulary is imported from its single owner rather than restated here, so a
// method kind the record admits can never be refused by a second list kept in this file. `./partner-edit`
// reads the same tuple for the same reason; the two item schemas stay separate because a preparation's
// contact methods are its own creating payload and must be able to diverge from a permitted-field edit.
import { CONTACT_METHOD_KINDS } from "@/modules/data-service/envelope";

// The opening note is a private note like any other, so its body rule is the family's one rule for one.
import { privateNoteBodySchema } from "./private-note";

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

/**
 * The refusals these three schemas can produce, declared once so no schema states a literal inline.
 *
 * `../copy/privacy.ts` is the family's wording source for what stays private and what archiving does, and
 * it holds no entry for a missing name, a blank contact value or an absent record reference; these belong
 * beside it and move across the next time that catalogue is edited. Each sentence below names the value
 * that was refused and what to do about it, never the person who typed it.
 */
const PREPARATION_MESSAGES = {
  /** A create payload arrived as something other than the object this form submits. */
  createShape:
    "A private contact is created from the fields this form shows, so remove any other field and submit again.",
  /** A create payload arrived with no name at all. */
  nameMissing: "A private contact needs a name to recognise it by.",
  /** A name that is empty, or holds only spaces. */
  nameBlank: "A private contact needs a name with at least one visible character.",
  /** A contact method kind outside the closed vocabulary the record declares. */
  contactKindInvalid: "Choose a contact method kind: email, phone or postal.",
  /** A contact method value that arrived as something other than text. */
  contactValueMissing: "A contact method needs a value, such as an address or a number.",
  /** A contact method value that is empty, or holds only spaces. */
  contactValueBlank: "A contact method needs a value with at least one visible character.",
  /** A permitted flag that arrived as something other than a boolean. */
  contactPermittedInvalid: "State whether this contact method may be used.",
  /** An archive payload arrived as something other than the object this form submits. */
  archiveShape:
    "Archiving a preparation names one record and nothing else, so remove any other field and submit again.",
  /** A restore payload arrived as something other than the object this form submits. */
  restoreShape:
    "Restoring a preparation names one record and nothing else, so remove any other field and submit again.",
  /** A payload arrived without the preparation record it applies to. */
  referenceMissing: "Name the preparation record this change applies to, then retry.",
  /** A record reference that is present but empty. */
  referenceBlank: "A preparation record is named by its identifier, and that reference is empty.",
} as const;

// ---------------------------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------------------------

/**
 * The name a new private preparation is recognised by: any text with at least one visible character,
 * stored exactly as it was entered.
 *
 * Presence is judged on the trimmed value, so a name of spaces or a lone newline is refused; the value
 * itself is never trimmed, case-folded or otherwise normalised, because the name a worker entered is what
 * the record shows and what a refused save must put back in front of them unchanged. This is the one
 * required member of a new preparation — a first session records a private contact from a name alone.
 *
 * No length limit is set here. The service holds the only bound a stored record holds, and the refusal it
 * gives for a name past that bound arrives at this same `displayName` path rather than being truncated
 * here and accepted there.
 */
const preparationNameField = z
  .string({ error: PREPARATION_MESSAGES.nameMissing })
  .refine((value) => value.trim().length > 0, { error: PREPARATION_MESSAGES.nameBlank });

/**
 * An opaque reference to one private preparation record, and the only value archive and restore carry.
 *
 * Never a display name, an email address or a postal address: equal-looking values establish neither
 * identity nor authority, so a payload hands back the identifier a read gave out and lets the service
 * re-authorise it against the record as it stands. The value is not trimmed, because an identifier is
 * something this application mints and silently repairing one would let a request act on a record it did
 * not name; an empty one names nothing and is refused.
 */
const preparationReferenceField = z
  .string({ error: PREPARATION_MESSAGES.referenceMissing })
  .min(1, PREPARATION_MESSAGES.referenceBlank);

// ---------------------------------------------------------------------------------------------
// One contact method on a new preparation
// ---------------------------------------------------------------------------------------------

/**
 * Validates one way of reaching the person a preparation is being created for: the kind of method, its
 * value, and whether the worker may use it.
 *
 * `permitted` is contactability and nothing else. It is not consent to receive a publication, which is a
 * membership with its own state and purpose, and it is not a reader grant for protected content; keeping
 * the three apart starts with a payload that can express only the first.
 *
 * `verified` is absent on purpose: verification is not something a form can assert, so this release stores
 * `verified: false` on every method it holds and a payload claiming otherwise is refused. The object is
 * strict, so a field the record manages — `verified`, a method identifier, a source reference — cannot
 * ride along with the value that was entered.
 */
export const preparationContactMethodSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, { error: PREPARATION_MESSAGES.contactKindInvalid }),
  value: z
    .string({ error: PREPARATION_MESSAGES.contactValueMissing })
    .refine((value) => value.trim().length > 0, { error: PREPARATION_MESSAGES.contactValueBlank }),
  permitted: z.boolean({ error: PREPARATION_MESSAGES.contactPermittedInvalid }),
});

/** The validated contact method on a new preparation: its kind, the value as entered, and its permitted flag. */
export type PreparationContactMethod = z.infer<typeof preparationContactMethodSchema>;

// ---------------------------------------------------------------------------------------------
// createPrivatePreparation
// ---------------------------------------------------------------------------------------------

/**
 * Validates what `createPrivatePreparation` submits: a name, any contact methods, and an optional
 * opening note.
 *
 * **No `kind`, `audience` or `isPrivate` member exists here.** The record this mutation creates is a
 * private preparation by construction, so there is no other record class and no other audience for the
 * form to choose, and a payload that named one would be asserting its own authorisation. That is why this
 * schema also carries no `partnerId`: the service mints the new record's identity and returns it, so a
 * payload can never pick the identifier of a record it does not own.
 *
 * `note` is the opening note as the one plain-text string the service accepts, and it reuses the family's
 * private-note body rule rather than restating it, so a note written here and a note written later are
 * held to the same rule. The submitted note carries no audience of its own, unlike the standalone
 * `savePrivateNote` payload: it becomes a private note record of this private preparation, and there is no
 * other audience it could be filed under. A preparation record itself holds no note field — the note is a
 * separate record with its own revision — so the opening note travels as this separate member and never
 * inside the record.
 *
 * Name parts are absent too: this mutation creates the record with no parts and the typed name as its
 * display name, and a part is filled in afterwards by `saveContactEdits`. The service's create schema is
 * strict and accepts no parts member either, so a form sending one would be refused a round trip later
 * rather than quietly having it dropped.
 */
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

// ---------------------------------------------------------------------------------------------
// archivePreparation and restorePreparation
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `archivePreparation` payload: the preparation being archived, and nothing else.
 *
 * The object is strict, so no `reason`, `delete`, `purge`, `cascade`, `archivedAt` or `revision` field can
 * travel with it. Archiving hides one preparation from the working lists and deletes nothing — the record,
 * its notes and its history all stay — and a payload can neither ask for a deletion nor state when the
 * archive happened, because the service stamps the record and holds the only record of the change.
 *
 * No optional `reason` is offered: `archivePreparation`'s own strict input carries the target alone and the
 * stored record has no archive-reason field, so a reason accepted here would be refused by the service as
 * an unexpected member, or stored nowhere at all.
 *
 * The record class is not stated here either. Only the caller's own private preparation can be archived,
 * and the mutation answers `unchanged` for anything else: a payload that asserted `kind` or
 * `recordClass` would be claiming its own permission, and a caller could omit it or forge it.
 */
export const archivePreparationPayloadSchema = z.strictObject(
  {
    partnerId: preparationReferenceField,
  },
  { error: PREPARATION_MESSAGES.archiveShape },
);

/** The validated `archivePreparation` payload: one opaque preparation reference and nothing else. */
export type ArchivePreparationPayload = z.infer<typeof archivePreparationPayloadSchema>;

/**
 * Validates the `restorePreparation` payload: the archived preparation being returned to the working
 * lists, and nothing else.
 *
 * Declared separately from the archive payload even though the two shapes match today, because the two are
 * different acts with different consequences — leaving the working lists, and coming back to them — and one
 * schema serving both would make them one decision again, so a future divergence could only be made by
 * renaming an import at every call site. The object is strict for the same reason: restoring writes the
 * archive flag and a revision and changes nothing else, so no field here can ask it to rewrite the record
 * it brings back, and no `reason` is offered because the mutation's own strict input carries the target
 * alone.
 */
export const restorePreparationPayloadSchema = z.strictObject(
  {
    partnerId: preparationReferenceField,
  },
  { error: PREPARATION_MESSAGES.restoreShape },
);

/** The validated `restorePreparation` payload: one opaque preparation reference and nothing else. */
export type RestorePreparationPayload = z.infer<typeof restorePreparationPayloadSchema>;
