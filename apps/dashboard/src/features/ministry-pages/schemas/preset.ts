/**
 * The Worker and Project Pages family's `applyPreset` payload schema, and the one mutation input it
 * travels in.
 *
 * A preset proposes a starting composition for a page edition so the worker can review and edit it
 * before anything is released. Applying one **composes a reviewable draft and publishes nothing**
 * (AAP 0.8.6, acceptance criterion 12). That is the whole reason this file stands apart from the
 * family's release and reach schemas: the payload names the draft the preset is composed into and the
 * one preset chosen, and no key through which a caller could ask for a release, a reach value, a
 * notification, a withdrawal or a schedule.
 *
 * `.strict()` is therefore load-bearing rather than stylistic. An added `reach`, `publish`, `release`,
 * `notify`, `scheduledAt`, `sections`, `document` or any other key is `invalid` at that key, so a
 * request built from this schema cannot express publication even by mistake, and a caller is never
 * left believing a field it sent was understood when it was quietly dropped.
 *
 * What this file decides, and what it deliberately leaves to the service:
 *
 * - **Shape only.** The service re-validates the payload with its own schema, re-derives the scope from
 *   the development session and answers from the closed outcome set (`accepted`, `alreadyAccepted`,
 *   `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`, `unknown`). The schema below carries
 *   the service's own `ApplyPresetPayload` as its type annotation, imported with `import type` so the
 *   annotation is erased and no server module reaches this client-loaded file: a member this file
 *   drops or mistypes fails the typecheck instead of coming back `invalid` at runtime.
 * - **The edition identifies the page.** The draft is named by its own revision or by the variant that
 *   holds it, and nothing beside it says which document, family or locale the preset lands in: the
 *   service derives the family and the locale from the edition it resolves. That is why this payload
 *   carries no `family`, no `locale` and no second edition reference — those keys are not in the
 *   contract, and the service's strict object refuses them.
 * - **One vocabulary, not a copy of one.** `presetId` is the closed list of presets the page catalogue
 *   proposes. The service declares that list privately, so the ids are repeated here tied to the
 *   payload type it infers: an id the service renames or drops fails to compile here, and the two
 *   lists move together if a third preset is added. Which presets a catalogue offers is the service's
 *   answer (`readPageCatalogues`) either way, not a list this file invents.
 * - **References, never structures.** Both identifiers are opaque identities — carried, never parsed,
 *   never compared with a title, a name or an email address, because equal-looking values establish
 *   neither identity nor authority (AAP 0.7.1). No section array, fields bag or document body travels
 *   here, so a preset changes no prose, places no media and alters no subject, consent or giving
 *   binding.
 * - **No limits of its own.** Preset naming, section counts, field lengths and every media bound
 *   belong to the service and to `modules/media`; this file states no numeric bound it was not given.
 *
 * Layering: a plain TypeScript module — Zod and module imports, no React, JSX, hook or component, no
 * store, no service read or mutation, no second feature and no clock read — so a client form may
 * import it. The envelope half is composed by the imported `mutationInputSchema` rather than
 * restated, so `{ operationId, scope, expectedRevision, payload }` has exactly one implementation here.
 *
 * Plan items: AAP 0.6.3's `GET/POST /api/pages` row (which lists `applyPreset` beside `saveDraft`,
 * `addSection`, `moveSection`, `duplicateSection`, `removeSection` and `saveSectionFields`), AAP 0.7.1
 * "Build and release a Page", AAP 0.8.6 "presets that create reviewable drafts", the AAP 0.9.1 tree
 * row for this family's folder and AAP 0.10.1's Worker and Project Pages family. Rule 1 clause 1
 * keeps the set closed: one schema for the one mutation the plan names, with no field for a deferred
 * capability; clause 2 reuses the service's own preset ids and the one envelope instead of copying
 * either; clause 3 keeps a draft distinct from a release, which is what the strict object enforces.
 */
import { z } from "zod";

// Taken from the module that declares the contract rather than from the `@/modules/data-service`
// barrel, which re-exports the named reads and mutations that reach `node:fs`; a client form imports
// this schema.
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";
// The annotation type is imported with `import type`, which the compiler erases: it holds the schema
// below to the service's own payload type without pulling the mutation bodies, the store or `node:fs`
// into a client bundle.
import type { ApplyPresetPayload as ServiceApplyPresetPayload } from "@/modules/data-service/mutations/content";

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

/**
 * The refusals this payload can produce, declared once so no schema states a sentence inline.
 *
 * Each names the fix in the family's register — short, plain, imperative, sentence case — and none of
 * them can reveal the existence, count or title of anything the caller may not see: a refusal because
 * a record sits outside the caller's scope is the service's `denied` outcome, never a sentence here.
 */
const PRESET_SCHEMA_MESSAGES = {
  /** No preset was chosen, or the choice is not one the catalogue proposes. */
  presetRequired: "Choose a preset from the list.",
  /** The draft revision arrived as something other than the text of its identity. */
  draftRevisionInvalid: "Open the page's draft first.",
  /** The variant arrived as something other than the text of its identity. */
  variantInvalid: "Open the language edition you want the preset in.",
} as const;

/** The refusal a payload answers when it names no draft at all, in the service's own words. */
const NO_DRAFT_TARGET_MESSAGE =
  "Open the page's draft first: a section change names the draft revision it edits.";

// ---------------------------------------------------------------------------------------------
// The presets the catalogue proposes
// ---------------------------------------------------------------------------------------------

/**
 * One preset the page catalogue proposes, spelled exactly as the service spells it.
 *
 * The id type is read off the payload type the service infers from its own schema, so this file holds
 * no vocabulary of its own: a preset the service renames or drops stops compiling here.
 */
type PagePresetId = ServiceApplyPresetPayload["presetId"];

/**
 * The closed list `presetId` accepts, mirroring the service's own private `PAGE_PRESET_IDS`.
 *
 * The service declares that tuple in `@/modules/data-service/mutations/content` without exporting it,
 * so the ids are repeated here — the same presets, in the same spelling — and tied to the service's
 * type with `satisfies`, which refuses one the service does not have. A preset added to the service
 * has to be added here too; the list is short and closed, and it is the catalogue read, not this file,
 * that tells a worker which of them to choose.
 */
const PRESET_IDS = [
  "preset-opening-and-story",
  "preset-story-and-prayer",
] as const satisfies readonly PagePresetId[];

// ---------------------------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------------------------

/**
 * The draft the preset is composed into: its own revision, or the variant that holds it.
 *
 * The service accepts either and resolves a variant to its current draft revision; naming both is
 * allowed and the revision wins. Both are opaque identities the form already holds — carried, never
 * parsed, and never compared with a title or a name — and the payload is refused below when it names
 * neither, because a preset that named no draft could not say where it landed.
 */
const draftTargetShape = {
  draftRevisionId: z
    .string({ error: PRESET_SCHEMA_MESSAGES.draftRevisionInvalid })
    .trim()
    .min(1, PRESET_SCHEMA_MESSAGES.draftRevisionInvalid)
    .optional(),
  variantId: z
    .string({ error: PRESET_SCHEMA_MESSAGES.variantInvalid })
    .trim()
    .min(1, PRESET_SCHEMA_MESSAGES.variantInvalid)
    .optional(),
} as const;

/**
 * The preset chosen from the catalogue, as one of its closed ids.
 *
 * A reference and never a structure: the sections a preset proposes are the service's composition, so
 * no list of them, no fields bag and no markup travels from a form. The enum is the catalogue's own
 * list rather than a free string, so a caller cannot ask for a preset the catalogue does not propose.
 */
const presetIdField = z.enum(PRESET_IDS, { error: PRESET_SCHEMA_MESSAGES.presetRequired });

// ---------------------------------------------------------------------------------------------
// applyPreset
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `applyPreset` payload: the draft the preset is composed into, and the preset chosen.
 *
 * The edition is the whole context. The service derives the document, the family and the locale from
 * the revision or variant named here, which is why no `family`, no `locale` and no second edition
 * reference travels with it — those keys are not in the contract, and the service's strict object
 * refuses them.
 *
 * The object is strict here for the same reason: a preset produces a reviewable draft, so a `reach`,
 * `publish`, `release`, `notify`, `scheduledAt`, `sections` or `document` key is refused by name rather
 * than dropped while the caller believes it was understood. Nothing else is decided here — no
 * family-to-edition rule, no locale admission, no preset existence — because those answers belong to
 * the service and a guess here would either refuse a legitimate call or imply an authority this file
 * does not have.
 */
export const applyPresetPayloadSchema: z.ZodType<ServiceApplyPresetPayload> = z
  .strictObject({
    ...draftTargetShape,
    presetId: presetIdField,
  })
  .superRefine((payload, ctx) => {
    if (payload.draftRevisionId !== undefined || payload.variantId !== undefined) return;
    ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: NO_DRAFT_TARGET_MESSAGE });
  });

/** The validated `applyPreset` payload: the draft it composes into, and the preset chosen. */
export type applyPresetPayload = z.infer<typeof applyPresetPayloadSchema>;

/**
 * Validates the whole `applyPreset` request: the payload above inside this application's one mutation
 * envelope.
 *
 * Composed from the imported factory rather than restated, so a request can never carry a hand-written
 * operation identity, scope or revision shape that the service's own guard would read differently, and
 * a replay is recognised by the operation identity the envelope declares.
 */
export const applyPresetInputSchema = mutationInputSchema(applyPresetPayloadSchema);

/** The `applyPreset` request a form submits: the four-field envelope around the validated payload. */
export type applyPresetInput = MutationInput<applyPresetPayload>;
