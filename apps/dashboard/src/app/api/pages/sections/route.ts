/**
 * `POST /api/pages/sections` — the browser transport for composing one page draft's section list: the
 * five section mutations (`addSection`, `moveSection`, `duplicateSection`, `removeSection`,
 * `saveSectionFields`) and the catalogue preset that composes several sections in one draft change,
 * selected by `payload.operation` and answered with exactly one of the service's eight outcomes.
 *
 * Ordering validity, the draft's next revision, catalogue membership, managed sections, media and every
 * authorisation decision belong to the service behind this file. The handler validates the request
 * against the mutation it names, forwards the four-field envelope untouched — the service re-derives the
 * session's scope and re-checks that the changed record is still inside it — and maps the outcome once.
 *
 * The closed vocabularies below are taken from their single declarations rather than restated: the four
 * bounded presentation choices come from the content profile in `modules/content/document.ts`, and the
 * eight admitted section types together with the two preset ids come from the stored record contract in
 * `modules/data-service/envelope.ts`. A section type, a preset or a presentation value the catalogue and
 * the profile admit is therefore admitted by this grammar in the same change, so nothing the builder
 * offers can be refused here while the service would store it. The service still re-checks each value
 * before it writes, and a request naming a value outside a set is refused as `invalid` before any change
 * reaches the store.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { PRESENTATION_CHOICES } from "@/modules/content/document";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { PAGE_PRESET_IDS, PAGE_SECTION_TYPES } from "@/modules/data-service/envelope";
import { sessionIdOf } from "../../session-cookie";
// The store writes through node:fs and media preparation uses the native image pipeline, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every mutation resolves the development session and the scenario clock per request, so no render or intermediate cache may answer for one.
export const dynamic = "force-dynamic";

/** The operation id echoed back when a body states none, so even a refused attempt is answered with the identity it presented. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const MESSAGES = {
  operationUnknown: "State which change this request makes as payload.operation: addSection, moveSection, duplicateSection, removeSection, saveSectionFields or applyPreset.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  draftTargetMissing: "Open the page's draft first: a section change names the draft revision it edits.",
  draftReference: "Open the page's draft again, then change its sections.",
  sectionReference: "Open the page's draft again, then choose the section to change.",
  sectionType: "Choose one of the eight section types this page's catalogue admits.",
  position: "State where this section belongs as a whole position, counting from the first section.",
  treatment: "Choose the weight this section reads at: normal or emphasized.",
  layout: "Choose a layout: single-column or two-column-image-text.",
  alignment: "Choose an alignment: start or center.",
  imageFit: "Choose how an image fits its frame: cover or contain.",
  preset: "Choose one of the presets this page's catalogue proposes.",
  nothingToSave: "Change a field or an option, or there is nothing to save.",
} as const;

// The closed set of changes this path makes. The table below is typed by this tuple, so a member added
// here without its schema and handler, or removed from here while its schema remains, fails to compile.
// A caller says which change it asks for in `payload.operation` — the form every route in this application
// that carries more than one mutation uses — so the four-field envelope the service validates stays the one
// body shape every mutation presents, and the pages family's single transport can reach this path unchanged.
const SECTION_OPERATIONS = ["addSection", "moveSection", "duplicateSection", "removeSection", "saveSectionFields", "applyPreset"] as const;

type SectionOperation = (typeof SECTION_OPERATIONS)[number];

type AddSectionPayload = Parameters<typeof mutations.pages.addSection>[1]["payload"];

type MoveSectionPayload = Parameters<typeof mutations.pages.moveSection>[1]["payload"];

type DuplicateSectionPayload = Parameters<typeof mutations.pages.duplicateSection>[1]["payload"];

type RemoveSectionPayload = Parameters<typeof mutations.pages.removeSection>[1]["payload"];

type SaveSectionFieldsPayload = Parameters<typeof mutations.pages.saveSectionFields>[1]["payload"];

type ApplyPresetPayload = Parameters<typeof mutations.pages.applyPreset>[1]["payload"];

type SaveSectionFieldsPresentation = NonNullable<SaveSectionFieldsPayload["presentation"]>;

/** One opaque identifier as the service accepts it: never empty, never a filename, never a URL, bounded in length. */
function referenceField(message: string) {
  return z.string({ error: message }).trim().min(1, message).max(160, message);
}

const sectionReference = referenceField(MESSAGES.sectionReference);

const draftReference = referenceField(MESSAGES.draftReference);

// Which draft edition a section change names: the exact draft revision, or the variant whose draft it is.
const draftTargetShape = {
  draftRevisionId: draftReference.optional(),
  variantId: draftReference.optional(),
} as const;

function namesDraftTarget(payload: { readonly draftRevisionId?: string; readonly variantId?: string }): boolean {
  return payload.draftRevisionId !== undefined || payload.variantId !== undefined;
}

function requireDraftTarget(payload: { readonly draftRevisionId?: string; readonly variantId?: string }, ctx: z.RefinementCtx): void {
  if (!namesDraftTarget(payload)) {
    ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: MESSAGES.draftTargetMissing });
  }
}

// The four presentation choices, each required and each drawn from its own closed set: a value outside a
// set, or a choice left unstated, is invalid rather than defaulted, because the server cannot know which
// layout a caller meant and must not invent one.
const presentationSchema: z.ZodType<SaveSectionFieldsPresentation> = z.strictObject({
  treatment: z.enum(PRESENTATION_CHOICES.treatment, { error: MESSAGES.treatment }),
  layout: z.enum(PRESENTATION_CHOICES.layout, { error: MESSAGES.layout }),
  alignment: z.enum(PRESENTATION_CHOICES.alignment, { error: MESSAGES.alignment }),
  imageFit: z.enum(PRESENTATION_CHOICES.imageFit, { error: MESSAGES.imageFit }),
});

// One payload schema per mutation. Each is strict and each is held to the service's own payload type, so a
// field the service would refuse cannot be smuggled in, and a field the service starts requiring reaches
// this file as a compile error rather than as a runtime refusal.
const addSectionPayloadSchema: z.ZodType<AddSectionPayload & { readonly operation: "addSection" }> = z
  .strictObject({
    operation: z.literal("addSection"),
    ...draftTargetShape,
    sectionType: z.enum(PAGE_SECTION_TYPES, { error: MESSAGES.sectionType }),
    afterSectionId: sectionReference.optional(),
  })
  .superRefine(requireDraftTarget);

const moveSectionPayloadSchema: z.ZodType<MoveSectionPayload & { readonly operation: "moveSection" }> = z
  .strictObject({
    operation: z.literal("moveSection"),
    ...draftTargetShape,
    sectionId: sectionReference,
    targetIndex: z.int({ error: MESSAGES.position }).nonnegative(MESSAGES.position),
  })
  .superRefine(requireDraftTarget);

const duplicateSectionPayloadSchema: z.ZodType<DuplicateSectionPayload & { readonly operation: "duplicateSection" }> = z
  .strictObject({
    operation: z.literal("duplicateSection"),
    ...draftTargetShape,
    sectionId: sectionReference,
  })
  .superRefine(requireDraftTarget);

const removeSectionPayloadSchema: z.ZodType<RemoveSectionPayload & { readonly operation: "removeSection" }> = z
  .strictObject({
    operation: z.literal("removeSection"),
    ...draftTargetShape,
    sectionId: sectionReference,
  })
  .superRefine(requireDraftTarget);

const saveSectionFieldsPayloadSchema: z.ZodType<SaveSectionFieldsPayload & { readonly operation: "saveSectionFields" }> = z
  .strictObject({
    operation: z.literal("saveSectionFields"),
    ...draftTargetShape,
    sectionId: sectionReference,
    // Plain text only, keyed by the field each section type admits; which keys a type admits is the
    // catalogue's rule and stays behind the service, which refuses a key the type does not edit.
    fields: z.record(z.string(), z.string()).optional(),
    presentation: presentationSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    requireDraftTarget(payload, ctx);
    if (payload.fields === undefined && payload.presentation === undefined) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: MESSAGES.nothingToSave });
    }
  });

const applyPresetPayloadSchema: z.ZodType<ApplyPresetPayload & { readonly operation: "applyPreset" }> = z
  .strictObject({
    operation: z.literal("applyPreset"),
    ...draftTargetShape,
    presetId: z.enum(PAGE_PRESET_IDS, { error: MESSAGES.preset }),
  })
  .superRefine(requireDraftTarget);

// The whole request each mutation accepts: the one four-field envelope every mutation presents, plus the
// operation this path's discriminant names. Composing the envelope rather than restating it keeps
// operation identity, scope and expected revision identical to every other mutation in the application.
const addSectionRequestSchema = mutationInputSchema(addSectionPayloadSchema);

const moveSectionRequestSchema = mutationInputSchema(moveSectionPayloadSchema);

const duplicateSectionRequestSchema = mutationInputSchema(duplicateSectionPayloadSchema);

const removeSectionRequestSchema = mutationInputSchema(removeSectionPayloadSchema);

const saveSectionFieldsRequestSchema = mutationInputSchema(saveSectionFieldsPayloadSchema);

const applyPresetRequestSchema = mutationInputSchema(applyPresetPayloadSchema);

// The discriminant is read on its own, before a mutation's schema runs, so a body that names no operation
// (or one this path does not make) is refused with a message about the discriminant rather than with a
// complaint about whichever payload shape happened to be tried first.
const operationClaimSchema = z.object(
  {
    payload: z.object({ operation: z.enum(SECTION_OPERATIONS, { error: MESSAGES.operationUnknown }) }, { error: MESSAGES.operationUnknown }),
  },
  { error: MESSAGES.bodyNotJson },
);

/** One validated section change: the schema that admits it and the named mutation that performs it. */
type SectionRoute = (sessionId: string, body: unknown, operationId: string) => Promise<Response>;

function withoutOperation<P extends { readonly operation: string }>(payload: P): Omit<P, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

function sectionRoute<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  run: (sessionId: string, input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): SectionRoute {
  return async (sessionId, body, operationId) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Validation happens before anything is read or written, so an invalid request leaves no effect and
      // no revision behind; the per-field messages name the payload path the caller has to correct.
      return toResponse(outcomeFromError(operationId, parsed.error));
    }
    const { payload, ...envelope } = parsed.data;
    try {
      return toResponse(await run(sessionId, { ...envelope, payload: withoutOperation(payload) }));
    } catch (error) {
      // The service answers refusals as outcomes, so a throw is a store or medium fault, or a failure whose
      // fate is not known. One mapper knows the difference, and an unknown outcome carries the operation id
      // so the caller re-queries that attempt instead of sending the change a second time.
      return toResponse(outcomeFromError(operationId, error));
    }
  };
}

// One entry per member of the closed operation set, indexed by that member rather than selected by a
// switch: the `satisfies` clause makes a seventh operation, or a missing one, a compile error. The preset
// belongs here because it composes a draft's section list, which is the one thing this path changes; the
// edition-level writes a page also needs — creating a variant and saving its draft — are `/api/pages`.
const SECTION_ROUTES = {
  addSection: sectionRoute(addSectionRequestSchema, (sessionId, input) => mutations.pages.addSection(sessionId, input)),
  moveSection: sectionRoute(moveSectionRequestSchema, (sessionId, input) => mutations.pages.moveSection(sessionId, input)),
  duplicateSection: sectionRoute(duplicateSectionRequestSchema, (sessionId, input) => mutations.pages.duplicateSection(sessionId, input)),
  removeSection: sectionRoute(removeSectionRequestSchema, (sessionId, input) => mutations.pages.removeSection(sessionId, input)),
  saveSectionFields: sectionRoute(saveSectionFieldsRequestSchema, (sessionId, input) => mutations.pages.saveSectionFields(sessionId, input)),
  applyPreset: sectionRoute(applyPresetRequestSchema, (sessionId, input) => mutations.pages.applyPreset(sessionId, input)),
} satisfies Record<SectionOperation, SectionRoute>;

async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // A body that is not JSON is the caller's input to correct, not a fault of this handler, so it is
    // answered as an invalid request naming the envelope it should have sent.
    return undefined;
  }
}

function operationIdOf(body: unknown): string {
  if (!isRecord(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = body["operationId"];
  return isNonEmptyString(claimed) ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * Makes exactly one of the six named section changes, chosen by `payload.operation`, and answers with one
 * of `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`. A section save is a draft edit: nothing here publishes, notifies or releases anything.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const operationId = operationIdOf(body);
  const claimed = operationClaimSchema.safeParse(body);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  const sessionId = sessionIdOf(request);
  return SECTION_ROUTES[claimed.data.payload.operation](sessionId, body, operationId);
}
