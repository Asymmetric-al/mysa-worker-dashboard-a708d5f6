import type { NextRequest } from "next/server";
import { z } from "zod";
import { PRESENTATION_CHOICES } from "@/modules/content/document";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { PAGE_PRESET_IDS, PAGE_SECTION_TYPES } from "@/modules/data-service/envelope";
import { claimedWriteRoute, type ClaimedWrite } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
const SECTION_OPERATIONS = ["addSection", "moveSection", "duplicateSection", "removeSection", "saveSectionFields", "applyPreset"] as const;
type SaveSectionFieldsPayload = Parameters<typeof mutations.pages.saveSectionFields>[1]["payload"];
type ApplyPresetPayload = Parameters<typeof mutations.pages.applyPreset>[1]["payload"];
const referenceField = (message: string) => z.string({ error: message }).trim().min(1, message).max(160, message);
const sectionReference = referenceField(MESSAGES.sectionReference);
const draftReference = referenceField(MESSAGES.draftReference);
const draftTargetShape = { draftRevisionId: draftReference.optional(), variantId: draftReference.optional() } as const;
const namesDraftTarget = (payload: { readonly draftRevisionId?: string; readonly variantId?: string }): boolean => payload.draftRevisionId !== undefined || payload.variantId !== undefined;
function requireDraftTarget(payload: { readonly draftRevisionId?: string; readonly variantId?: string }, ctx: z.RefinementCtx): void {
  if (!namesDraftTarget(payload)) ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: MESSAGES.draftTargetMissing });
}
const presentationSchema: z.ZodType<NonNullable<SaveSectionFieldsPayload["presentation"]>> = z.strictObject({
  treatment: z.enum(PRESENTATION_CHOICES.treatment, { error: MESSAGES.treatment }),
  layout: z.enum(PRESENTATION_CHOICES.layout, { error: MESSAGES.layout }),
  alignment: z.enum(PRESENTATION_CHOICES.alignment, { error: MESSAGES.alignment }),
  imageFit: z.enum(PRESENTATION_CHOICES.imageFit, { error: MESSAGES.imageFit }),
});
const addSectionPayloadSchema: z.ZodType<Parameters<typeof mutations.pages.addSection>[1]["payload"] & { readonly operation: "addSection" }> = z
  .strictObject({ operation: z.literal("addSection"), ...draftTargetShape, sectionType: z.enum(PAGE_SECTION_TYPES, { error: MESSAGES.sectionType }), afterSectionId: sectionReference.optional() })
  .superRefine(requireDraftTarget);
const moveSectionPayloadSchema: z.ZodType<Parameters<typeof mutations.pages.moveSection>[1]["payload"] & { readonly operation: "moveSection" }> = z
  .strictObject({ operation: z.literal("moveSection"), ...draftTargetShape, sectionId: sectionReference, targetIndex: z.int({ error: MESSAGES.position }).nonnegative(MESSAGES.position) })
  .superRefine(requireDraftTarget);
const duplicateSectionPayloadSchema: z.ZodType<Parameters<typeof mutations.pages.duplicateSection>[1]["payload"] & { readonly operation: "duplicateSection" }> = z.strictObject({ operation: z.literal("duplicateSection"), ...draftTargetShape, sectionId: sectionReference }).superRefine(requireDraftTarget);
const removeSectionPayloadSchema: z.ZodType<Parameters<typeof mutations.pages.removeSection>[1]["payload"] & { readonly operation: "removeSection" }> = z.strictObject({ operation: z.literal("removeSection"), ...draftTargetShape, sectionId: sectionReference }).superRefine(requireDraftTarget);
const saveSectionFieldsPayloadSchema: z.ZodType<SaveSectionFieldsPayload & { readonly operation: "saveSectionFields" }> = z
  .strictObject({ operation: z.literal("saveSectionFields"), ...draftTargetShape, sectionId: sectionReference, fields: z.record(z.string(), z.string()).optional(), presentation: presentationSchema.optional() })
  .superRefine((payload, ctx) => {
    requireDraftTarget(payload, ctx);
    if (payload.fields === undefined && payload.presentation === undefined) ctx.addIssue({ code: "custom", path: ["fields"], message: MESSAGES.nothingToSave });
  });
const applyPresetPayloadSchema: z.ZodType<ApplyPresetPayload & { readonly operation: "applyPreset" }> = z.strictObject({ operation: z.literal("applyPreset"), ...draftTargetShape, presetId: z.enum(PAGE_PRESET_IDS, { error: MESSAGES.preset }) }).superRefine(requireDraftTarget);
const addSectionRequestSchema = mutationInputSchema(addSectionPayloadSchema);
const moveSectionRequestSchema = mutationInputSchema(moveSectionPayloadSchema);
const duplicateSectionRequestSchema = mutationInputSchema(duplicateSectionPayloadSchema);
const removeSectionRequestSchema = mutationInputSchema(removeSectionPayloadSchema);
const saveSectionFieldsRequestSchema = mutationInputSchema(saveSectionFieldsPayloadSchema);
const applyPresetRequestSchema = mutationInputSchema(applyPresetPayloadSchema);
const operationClaimSchema = z.object({ payload: z.object({ operation: z.enum(SECTION_OPERATIONS, { error: MESSAGES.operationUnknown }) }, { error: MESSAGES.operationUnknown }) }, { error: MESSAGES.bodyNotJson });
type SectionRoute = ClaimedWrite;
function withoutOperation<P extends { readonly operation: string }>(payload: P): Omit<P, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}
function sectionRoute<P extends { readonly operation: string }>(schema: z.ZodType<MutationInput<P>>, run: (sessionId: string, input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>): SectionRoute {
  return async (body, { operationId, sessionId }) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));
    const { payload, ...envelope } = parsed.data;
    try {
      return toResponse(await run(sessionId, { ...envelope, payload: withoutOperation(payload) }));
    } catch (error) {
      return toResponse(outcomeFromError(operationId, error));
    }
  };
}
const SECTION_ROUTES = {
  addSection: sectionRoute(addSectionRequestSchema, (sessionId, input) => mutations.pages.addSection(sessionId, input)),
  moveSection: sectionRoute(moveSectionRequestSchema, (sessionId, input) => mutations.pages.moveSection(sessionId, input)),
  duplicateSection: sectionRoute(duplicateSectionRequestSchema, (sessionId, input) => mutations.pages.duplicateSection(sessionId, input)),
  removeSection: sectionRoute(removeSectionRequestSchema, (sessionId, input) => mutations.pages.removeSection(sessionId, input)),
  saveSectionFields: sectionRoute(saveSectionFieldsRequestSchema, (sessionId, input) => mutations.pages.saveSectionFields(sessionId, input)),
  applyPreset: sectionRoute(applyPresetRequestSchema, (sessionId, input) => mutations.pages.applyPreset(sessionId, input)),
} satisfies Record<(typeof SECTION_OPERATIONS)[number], SectionRoute>;
/** Makes exactly one of the six named section changes, chosen by `payload.operation`, and answers with one of `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
const changeSection = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, operationClaimSchema, (claim) => claim.payload.operation, SECTION_ROUTES);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: changeSection });
