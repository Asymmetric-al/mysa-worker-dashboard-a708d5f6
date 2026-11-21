/**
 * The payload schemas of the five section mutations the Worker and Project Pages builder sends —
 * `addSection`, `moveSection`, `duplicateSection`, `removeSection` and `saveSectionFields` — together
 * with the two shapes they share: the four bounded presentation choices and the typed field values of
 * each admitted section type.
 *
 * One schema per named mutation and nothing shared between them beyond those two shapes, so a payload
 * can only ever mean one thing. There is no create-or-update form, no generic field bag and no
 * dispatcher here, because the service deliberately has none either.
 *
 * These schemas are the client's mirror, never the authority. Each payload names the same keys the
 * service's own schema for that mutation validates — the draft edition it edits, the section it
 * changes, and that mutation's own argument — so a payload this file accepts is a payload the service
 * can apply, and the service still re-derives scope, checks the expected revision and answers with the
 * closed outcome set. `../hooks/` composes the four-field mutation input around these payloads, and
 * that envelope is `mutationInputSchema`'s, imported rather than restated here.
 *
 * What the shapes keep apart (AAP 0.8.5, 0.8.6):
 *
 * - A section edit changes the current draft revision only. No payload here carries a candidate, a
 *   release, a reach value, a notification, a schedule or a revision token, so composing a page can
 *   neither publish it nor withdraw a release. `removeSection` removes a reference from the draft and
 *   nothing beside it: the media the section placed stays registered, and a release that already
 *   served the section is untouched.
 * - Presentation is the profile's closed set of four choices, each built from `PRESENTATION_CHOICES`,
 *   so a colour, a spacing, a theme, a CSS class or a pixel position is `invalid` rather than styled.
 * - The section catalogue is this family's own. A stored section's identity is an opaque catalogue key
 *   (`ContentSection["element"]`), so the eight admitted types and the field keys each of them edits
 *   are declared here, where the builder and its forms read them; the service applies the same
 *   catalogue and stays the authority on which key a stored section accepts.
 * - A field value is plain text stored verbatim, and a newly added section carries every field empty,
 *   so these schemas validate the shape of a section's text and never its completeness. Whether a
 *   section says enough to publish is a review question, not a payload one.
 * - A record identity is opaque. It is carried as it stands, never parsed and never compared with a
 *   title, a position or a fragment of another system's id, because equal-looking values establish
 *   neither identity nor authority.
 * - No payload states money, a percentage or a financial fact: composing a page never states an
 *   amount.
 *
 * The module is plain TypeScript — no JSX, no React, no hook, no store, no clock and no style literal
 * — because both a client component and a client hook import it. The envelope comes from
 * `@/modules/data-service/envelope` rather than the barrel: the barrel also re-exports the reads and
 * mutations, which reach `node:fs`, and this module is part of the browser's code.
 */

import { z } from "zod";

import {
  PRESENTATION_CHOICES,
  type ContentSection,
  type PresentationChoice,
} from "@/modules/content/document";
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// The four bounded presentation choices
// ---------------------------------------------------------------------------------------------

/**
 * The presentation `saveSectionFields` accepts: exactly the profile's four choices, each required.
 *
 * A section states all four even where its type offers no alternative, because the read that supplies
 * the section also supplies the admitted value and a missing choice would have to be defaulted
 * somewhere. Each member is built from `PRESENTATION_CHOICES`, so a value the profile admits and a
 * value this form accepts cannot drift apart. The object is closed: a key the profile does not name —
 * a class, a colour, a theme — is `invalid` here and never reaches a stored section.
 */
export const presentationSchema: z.ZodType<PresentationChoice> = z.strictObject({
  treatment: z.enum(PRESENTATION_CHOICES.treatment, {
    error: "Choose the weight this section reads at from the list.",
  }),
  layout: z.enum(PRESENTATION_CHOICES.layout, { error: "Choose a layout from the list." }),
  alignment: z.enum(PRESENTATION_CHOICES.alignment, {
    error: "Choose an alignment from the list.",
  }),
  imageFit: z.enum(PRESENTATION_CHOICES.imageFit, {
    error: "Choose how the image fits its frame from the list.",
  }),
});

/** One section's presentation choices, inferred so the controls and this schema hold one shape. */
export type Presentation = z.infer<typeof presentationSchema>;

// ---------------------------------------------------------------------------------------------
// The catalogue's section types and the field values each one edits
// ---------------------------------------------------------------------------------------------

/**
 * The eight section types the two guided catalogues offer, in the order the catalogue lists them.
 *
 * The content profile leaves a section's identity open on purpose: `ContentSection["element"]` is the
 * catalogue key this family owns, not a value the profile declares. This tuple is therefore the one
 * declaration of the set a payload may name, and every shape below is a total map over its members —
 * a ninth type fails to compile until its field values are stated and its union member added.
 */
const SECTION_TYPES = [
  "introduction",
  "story",
  "prayer",
  "milestone",
  "image",
  "video",
  "giving",
  "progress",
] as const satisfies readonly ContentSection["element"][];

/** One section type of the catalogue. */
type SectionType = (typeof SECTION_TYPES)[number];

/** One plain-text field value: stored verbatim, so leading zeros and mixed scripts survive a save. */
const sectionFieldValueSchema = z.string({ error: "A section field holds plain text." });

/** The field values one section type edits, keyed by the field its form shows. */
type SectionFieldValues = Readonly<Record<string, typeof sectionFieldValueSchema>>;

/**
 * The field keys each catalogue type edits.
 *
 * `giving` and `progress` edit no field at all: an organization supplies both, so the builder shows
 * them locked with the reason rather than empty. Every other type's keys are exactly the ones its form
 * renders, and the service applies the same list, so a key a type does not own is refused rather than
 * stored as an unknown attribute of a section.
 */
const SECTION_FIELD_VALUES = {
  introduction: { heading: sectionFieldValueSchema, body: sectionFieldValueSchema },
  story: { heading: sectionFieldValueSchema, body: sectionFieldValueSchema },
  prayer: { heading: sectionFieldValueSchema, body: sectionFieldValueSchema },
  milestone: {
    heading: sectionFieldValueSchema,
    date: sectionFieldValueSchema,
    body: sectionFieldValueSchema,
  },
  image: {
    altText: sectionFieldValueSchema,
    caption: sectionFieldValueSchema,
    credit: sectionFieldValueSchema,
  },
  video: {
    altText: sectionFieldValueSchema,
    caption: sectionFieldValueSchema,
    credit: sectionFieldValueSchema,
    language: sectionFieldValueSchema,
  },
  giving: {},
  progress: {},
} as const satisfies Record<SectionType, SectionFieldValues>;

/**
 * The typed field values of one catalogue section, discriminated on the section type in hand.
 *
 * A section field form validates what it holds through this union before it builds the `fields` map
 * `saveSectionFields` sends, so a value of the wrong type — a number where a caption belongs — and a
 * key the chosen type does not own — a caption on a video — are refused where they were entered. Each
 * member is strict, so an unknown key is `invalid` instead of being stored.
 *
 * The members are listed in catalogue order, and the map above proves the set is complete: a type
 * added to `SECTION_TYPES` has no member here until one is added, so it cannot be silently
 * unvalidated.
 */
export const sectionFieldsSchema = z.discriminatedUnion("sectionType", [
  z.strictObject({
    sectionType: z.literal("introduction"),
    ...SECTION_FIELD_VALUES.introduction,
  }),
  z.strictObject({
    sectionType: z.literal("story"),
    ...SECTION_FIELD_VALUES.story,
  }),
  z.strictObject({
    sectionType: z.literal("prayer"),
    ...SECTION_FIELD_VALUES.prayer,
  }),
  z.strictObject({
    sectionType: z.literal("milestone"),
    ...SECTION_FIELD_VALUES.milestone,
  }),
  z.strictObject({
    sectionType: z.literal("image"),
    ...SECTION_FIELD_VALUES.image,
  }),
  z.strictObject({
    sectionType: z.literal("video"),
    ...SECTION_FIELD_VALUES.video,
  }),
  z.strictObject({
    sectionType: z.literal("giving"),
  }),
  z.strictObject({
    sectionType: z.literal("progress"),
  }),
]);

/** One catalogue section's type and field values, inferred so the field form and this union agree. */
export type SectionFields = z.infer<typeof sectionFieldsSchema>;

// ---------------------------------------------------------------------------------------------
// The draft edition every section change names
// ---------------------------------------------------------------------------------------------

/**
 * One opaque record reference: an identity this application minted, carried exactly as it stands.
 *
 * Never parsed and never compared with a title, a position or a fragment of another system's id. Only
 * emptiness is refused, because the value names a record inside one draft edition and says nothing
 * about what that record is.
 */
function opaqueReferenceSchema(message: string) {
  return z.string({ error: message }).trim().min(1, message);
}

/** The section a payload changes: the identity the builder's outline holds for it. */
const sectionIdSchema = opaqueReferenceSchema(
  "Open the edition again, then choose the section to change.",
);

/** The draft edition a payload edits, named by its revision or by the variant that holds it. */
const draftEditionReferenceSchema = opaqueReferenceSchema(
  "Open the draft edition again, then change its sections.",
);

/** The draft edition a section payload names, by revision or by the variant holding it. */
interface DraftEditionTarget {
  readonly draftRevisionId?: string;
  readonly variantId?: string;
}

/** What a section payload says when it names no draft edition at all. */
const NO_DRAFT_EDITION_MESSAGE =
  "Open the draft edition first: a section change names what it edits.";

/** The two keys that name the draft edition, declared once for the five payloads below. */
const draftEditionFields = {
  draftRevisionId: draftEditionReferenceSchema.optional(),
  variantId: draftEditionReferenceSchema.optional(),
} as const;

/**
 * Adds the one rule every section payload shares: it names the draft edition it changes.
 *
 * Written once as a wrapper rather than repeated as five identical refinements, so no mutation can
 * drift into accepting a section change that names nothing to change. The issue sits on
 * `draftRevisionId`, the first of the two keys that can carry the answer, so the form highlights one
 * field instead of two for one problem.
 */
function withDraftEdition<Payload extends DraftEditionTarget>(
  schema: z.ZodType<Payload>,
): z.ZodType<Payload> {
  return schema.superRefine((payload, ctx) => {
    if (payload.draftRevisionId === undefined && payload.variantId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["draftRevisionId"],
        message: NO_DRAFT_EDITION_MESSAGE,
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// addSection — one catalogue section added to the draft edition
// ---------------------------------------------------------------------------------------------

/**
 * The payload `addSection` accepts: the draft edition, one catalogue section type, and the section it
 * follows.
 *
 * The insertion point is the section this one goes after, or its absence for the end of the edition,
 * which is the whole of how this mutation expresses a position. No field values are stated: the
 * service applies that type's empty fields and the profile's opening presentation, so composing a
 * section starts blank rather than at a default a form invented, and a source-supplied type is the
 * service's refusal rather than a list this client keeps.
 */
export const addSectionPayloadSchema = withDraftEdition(
  z.strictObject({
    ...draftEditionFields,
    sectionType: z.enum(SECTION_TYPES, { error: "Choose a section type from the catalogue." }),
    afterSectionId: sectionIdSchema.optional(),
  }),
);

/** The payload `addSection` accepts, inferred so the catalogue and its payload hold one shape. */
export type AddSectionPayload = z.infer<typeof addSectionPayloadSchema>;

/** One `addSection` request: operation identity, scope, expected revision and its payload. */
export type AddSectionInput = MutationInput<AddSectionPayload>;

/** Validates an `addSection` request, envelope included, before it leaves the browser. */
export const addSectionInputSchema: z.ZodType<AddSectionInput> =
  mutationInputSchema(addSectionPayloadSchema);

// ---------------------------------------------------------------------------------------------
// moveSection — one section moved to an explicit position
// ---------------------------------------------------------------------------------------------

/**
 * The payload `moveSection` accepts: one section and the position it takes.
 *
 * The position is a number the caller states, so the builder's Move up button, Move down button and
 * position menu all submit this same payload, and a keyboard performs exactly what a pointer does
 * (WCAG 2.5.7 Dragging Movements — nothing in this builder is dragged). The outline emits a 0-based
 * intent and this payload names it `targetIndex`, which is the argument the mutation takes, so the
 * call site renames once rather than translating in two places.
 *
 * A target equal to the section's current position is deliberately accepted: the service answers
 * `unchanged` and nothing is written, so a form that refused it would fork the contract.
 */
export const moveSectionPayloadSchema = withDraftEdition(
  z.strictObject({
    ...draftEditionFields,
    sectionId: sectionIdSchema,
    targetIndex: z
      .int({ error: "Choose where this section should go, as a whole position." })
      .nonnegative("Choose where this section should go."),
  }),
);

/** The payload `moveSection` accepts, inferred so the three reorder controls hold one shape. */
export type MoveSectionPayload = z.infer<typeof moveSectionPayloadSchema>;

/** One `moveSection` request: operation identity, scope, expected revision and its payload. */
export type MoveSectionInput = MutationInput<MoveSectionPayload>;

/** Validates a `moveSection` request, envelope included, before it leaves the browser. */
export const moveSectionInputSchema: z.ZodType<MoveSectionInput> =
  mutationInputSchema(moveSectionPayloadSchema);

// ---------------------------------------------------------------------------------------------
// duplicateSection — one section copied within the draft edition
// ---------------------------------------------------------------------------------------------

/**
 * The payload `duplicateSection` accepts: the section to copy.
 *
 * The copy lands immediately after the section it copies, because that is the mutation's own
 * behaviour, so there is no destination to state here and no second way to say where a copy goes. A
 * copy is a copy of structure and content: it changes no managed subject, no giving binding and no
 * reach value.
 */
export const duplicateSectionPayloadSchema = withDraftEdition(
  z.strictObject({
    ...draftEditionFields,
    sectionId: sectionIdSchema,
  }),
);

/** The payload `duplicateSection` accepts, inferred so its control and its payload agree. */
export type DuplicateSectionPayload = z.infer<typeof duplicateSectionPayloadSchema>;

/** One `duplicateSection` request: operation identity, scope, expected revision and its payload. */
export type DuplicateSectionInput = MutationInput<DuplicateSectionPayload>;

/** Validates a `duplicateSection` request, envelope included, before it leaves the browser. */
export const duplicateSectionInputSchema: z.ZodType<DuplicateSectionInput> = mutationInputSchema(
  duplicateSectionPayloadSchema,
);

// ---------------------------------------------------------------------------------------------
// removeSection — one section removed from the draft edition
// ---------------------------------------------------------------------------------------------

/**
 * The payload `removeSection` accepts: the section to remove, and nothing else.
 *
 * Removing a section removes a reference from the current draft revision. The media the section
 * placed stays registered for every other placement, the release that already served it is untouched,
 * and no supporter saw anything change, so no word for withdrawal, recall or reach belongs in this
 * payload: those are separate outcomes the release mutations own.
 */
export const removeSectionPayloadSchema = withDraftEdition(
  z.strictObject({
    ...draftEditionFields,
    sectionId: sectionIdSchema,
  }),
);

/** The payload `removeSection` accepts, inferred so its control and its payload agree. */
export type RemoveSectionPayload = z.infer<typeof removeSectionPayloadSchema>;

/** One `removeSection` request: operation identity, scope, expected revision and its payload. */
export type RemoveSectionInput = MutationInput<RemoveSectionPayload>;

/** Validates a `removeSection` request, envelope included, before it leaves the browser. */
export const removeSectionInputSchema: z.ZodType<RemoveSectionInput> = mutationInputSchema(
  removeSectionPayloadSchema,
);

// ---------------------------------------------------------------------------------------------
// saveSectionFields — one section's fields and its presentation choices
// ---------------------------------------------------------------------------------------------

/**
 * The payload `saveSectionFields` accepts: one section's field values, its presentation choices, or
 * both.
 *
 * The section type is not part of the payload because the stored section already has one: the service
 * derives it from the section identity and refuses a field key that type does not own, which is why
 * the field form validates its typed values through `sectionFieldsSchema` first and sends the plain
 * `fields` map afterwards. Values are stored verbatim, and an empty value is a legitimate state of a
 * draft, so nothing here trims, requires or defaults a field's text.
 *
 * A save that states neither fields nor a presentation would change nothing, so it is refused here in
 * one sentence rather than travelling and coming back `unchanged`. Presentation travels as the
 * profile's four admitted choices, so a value outside the set is `invalid` and never styled twice.
 */
export const saveSectionFieldsPayloadSchema = withDraftEdition(
  z
    .strictObject({
      ...draftEditionFields,
      sectionId: sectionIdSchema,
      fields: z.record(z.string(), sectionFieldValueSchema).optional(),
      presentation: presentationSchema.optional(),
    })
    .superRefine((payload, ctx) => {
      if (payload.fields === undefined && payload.presentation === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: "Change a field or an option, or there is nothing to save.",
        });
      }
    }),
);

/** The payload `saveSectionFields` accepts, inferred so the field form and its payload agree. */
export type SaveSectionFieldsPayload = z.infer<typeof saveSectionFieldsPayloadSchema>;

/** One `saveSectionFields` request: operation identity, scope, expected revision and its payload. */
export type SaveSectionFieldsInput = MutationInput<SaveSectionFieldsPayload>;

/** Validates a `saveSectionFields` request, envelope included, before it leaves the browser. */
export const saveSectionFieldsInputSchema: z.ZodType<SaveSectionFieldsInput> = mutationInputSchema(
  saveSectionFieldsPayloadSchema,
);
