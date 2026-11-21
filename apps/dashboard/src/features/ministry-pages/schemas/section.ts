/**
 * The payload schemas of the five section mutations the Worker and Project Pages builder sends —
 * `addSection`, `moveSection`, `duplicateSection`, `removeSection` and `saveSectionFields` — together
 * with the two shapes they share: the four bounded presentation choices and the typed field values of
 * each admitted section type.
 *
 * **Each payload names its own change.** `POST /api/pages/sections` selects the mutation by
 * `payload.operation`, so every schema below carries that member as the discriminant of the one mutation
 * it describes, defaulted to the mutation's own name: a builder control composes the change it wants and
 * never repeats the verb, while the body that leaves the browser still names exactly one mutation.
 */
import { z } from "zod";
import { PRESENTATION_CHOICES, type PresentationChoice } from "@/modules/content/document";
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";
// The annotation types are imported with `import type`, which the compiler erases: they hold each schema
// below to the service's own payload type without pulling the mutation bodies, the store or `node:fs`
// into a client bundle. They also keep the defaulted discriminant out of the exported payload types, so
// a control builds the change and nothing else.
import type {
  AddSectionPayload as ServiceAddSectionPayload,
  MoveSectionPayload as ServiceMoveSectionPayload,
  SaveSectionFieldsPayload as ServiceSaveSectionFieldsPayload,
  SectionReferencePayload,
} from "@/modules/data-service/mutations/content";
import { PAGE_SECTION_TYPES, type PageSectionType } from "../copy";
// The four bounded presentation choices
/** The presentation `saveSectionFields` accepts: exactly the profile's four choices, each required. */
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
// The catalogue's section types and the field values each one edits
const sectionFieldValueSchema = z.string({ error: "A section field holds plain text." });

type SectionFieldValues = Readonly<Record<string, typeof sectionFieldValueSchema>>;

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
} as const satisfies Record<PageSectionType, SectionFieldValues>;
/** The typed field values of one catalogue section, discriminated on the section type in hand. */
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
// The draft edition every section change names
function opaqueReferenceSchema(message: string) {
  return z.string({ error: message }).trim().min(1, message);
}
const sectionIdSchema = opaqueReferenceSchema("Open the edition again, then choose the section to change.");

const draftEditionReferenceSchema = opaqueReferenceSchema("Open the draft edition again, then change its sections.");

interface DraftEditionTarget {
  readonly draftRevisionId?: string;
  readonly variantId?: string;
}
const NO_DRAFT_EDITION_MESSAGE = "Open the draft edition first: a section change names what it edits.";

const draftEditionFields = {
  draftRevisionId: draftEditionReferenceSchema.optional(),
  variantId: draftEditionReferenceSchema.optional(),
} as const;
function withDraftEdition<Payload extends DraftEditionTarget>(schema: z.ZodType<Payload>): z.ZodType<Payload> {
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
// addSection — one catalogue section added to the draft edition
// The section type is held to the catalogue this client mirrors, which is narrower than the text the
// service payload types it as, so both are named together: the annotation keeps the admitted set and a
// service change still reaches this file.
/** The payload `addSection` accepts: the draft edition, one catalogue section type, and the section it follows. */
export const addSectionPayloadSchema: z.ZodType<ServiceAddSectionPayload & { readonly sectionType: PageSectionType }> = withDraftEdition(
  z.strictObject({
    operation: z.literal("addSection").default("addSection"),
    ...draftEditionFields,
    sectionType: z.enum(PAGE_SECTION_TYPES, { error: "Choose a section type from the catalogue." }),
    afterSectionId: sectionIdSchema.optional(),
  }),
);
/** The payload `addSection` accepts, inferred so the catalogue and its payload hold one shape. */
export type AddSectionPayload = z.infer<typeof addSectionPayloadSchema>;
/** One `addSection` request: operation identity, scope, expected revision and its payload. */
export type AddSectionInput = MutationInput<AddSectionPayload>;
/** Validates an `addSection` request, envelope included, before it leaves the browser. */
export const addSectionInputSchema: z.ZodType<AddSectionInput> = mutationInputSchema(addSectionPayloadSchema);
// moveSection — one section moved to an explicit position
/** The payload `moveSection` accepts: one section and the position it takes. */
export const moveSectionPayloadSchema: z.ZodType<ServiceMoveSectionPayload> = withDraftEdition(
  z.strictObject({
    operation: z.literal("moveSection").default("moveSection"),
    ...draftEditionFields,
    sectionId: sectionIdSchema,
    targetIndex: z.int({ error: "Choose where this section should go, as a whole position." }).nonnegative("Choose where this section should go."),
  }),
);
/** The payload `moveSection` accepts, inferred so the three reorder controls hold one shape. */
export type MoveSectionPayload = z.infer<typeof moveSectionPayloadSchema>;
/** One `moveSection` request: operation identity, scope, expected revision and its payload. */
export type MoveSectionInput = MutationInput<MoveSectionPayload>;
/** Validates a `moveSection` request, envelope included, before it leaves the browser. */
export const moveSectionInputSchema: z.ZodType<MoveSectionInput> = mutationInputSchema(moveSectionPayloadSchema);
// duplicateSection — one section copied within the draft edition
/** The payload `duplicateSection` accepts: the section to copy. */
export const duplicateSectionPayloadSchema: z.ZodType<SectionReferencePayload> = withDraftEdition(
  z.strictObject({
    operation: z.literal("duplicateSection").default("duplicateSection"),
    ...draftEditionFields,
    sectionId: sectionIdSchema,
  }),
);
/** The payload `duplicateSection` accepts, inferred so its control and its payload agree. */
export type DuplicateSectionPayload = z.infer<typeof duplicateSectionPayloadSchema>;
/** One `duplicateSection` request: operation identity, scope, expected revision and its payload. */
export type DuplicateSectionInput = MutationInput<DuplicateSectionPayload>;
/** Validates a `duplicateSection` request, envelope included, before it leaves the browser. */
export const duplicateSectionInputSchema: z.ZodType<DuplicateSectionInput> = mutationInputSchema(duplicateSectionPayloadSchema);
// removeSection — one section removed from the draft edition
/** The payload `removeSection` accepts: the section to remove, and nothing else. */
export const removeSectionPayloadSchema: z.ZodType<SectionReferencePayload> = withDraftEdition(
  z.strictObject({
    operation: z.literal("removeSection").default("removeSection"),
    ...draftEditionFields,
    sectionId: sectionIdSchema,
  }),
);
/** The payload `removeSection` accepts, inferred so its control and its payload agree. */
export type RemoveSectionPayload = z.infer<typeof removeSectionPayloadSchema>;
/** One `removeSection` request: operation identity, scope, expected revision and its payload. */
export type RemoveSectionInput = MutationInput<RemoveSectionPayload>;
/** Validates a `removeSection` request, envelope included, before it leaves the browser. */
export const removeSectionInputSchema: z.ZodType<RemoveSectionInput> = mutationInputSchema(removeSectionPayloadSchema);
// saveSectionFields — one section's fields and its presentation choices
/** The payload `saveSectionFields` accepts: one section's field values, its presentation choices, or both. */
export const saveSectionFieldsPayloadSchema: z.ZodType<ServiceSaveSectionFieldsPayload> = withDraftEdition(
  z
    .strictObject({
      operation: z.literal("saveSectionFields").default("saveSectionFields"),
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
export const saveSectionFieldsInputSchema: z.ZodType<SaveSectionFieldsInput> = mutationInputSchema(saveSectionFieldsPayloadSchema);
