import { z } from "zod";
import { mutationInputSchema, PAGE_PRESET_IDS } from "@/modules/data-service/envelope";
import type { ApplyPresetPayload as ServiceApplyPresetPayload } from "@/modules/data-service/mutations/content";
const PRESET_SCHEMA_MESSAGES = { presetRequired: "Choose a preset from the list.", draftRevisionInvalid: "Open the page's draft first.", variantInvalid: "Open the language edition you want the preset in." } as const;
const draftTargetShape = {
  draftRevisionId: z.string({ error: PRESET_SCHEMA_MESSAGES.draftRevisionInvalid }).trim().min(1, PRESET_SCHEMA_MESSAGES.draftRevisionInvalid).optional(),
  variantId: z.string({ error: PRESET_SCHEMA_MESSAGES.variantInvalid }).trim().min(1, PRESET_SCHEMA_MESSAGES.variantInvalid).optional(),
} as const;
const presetIdField = z.enum(PAGE_PRESET_IDS, { error: PRESET_SCHEMA_MESSAGES.presetRequired });
/** Validates the `applyPreset` payload: the draft the preset is composed into, and the preset chosen. */
export const applyPresetPayloadSchema: z.ZodType<ServiceApplyPresetPayload> = z.strictObject({ operation: z.literal("applyPreset").default("applyPreset"), ...draftTargetShape, presetId: presetIdField }).superRefine((payload, ctx) => {
  if (payload.draftRevisionId !== undefined || payload.variantId !== undefined) return;
  ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: "Open the page's draft first: a section change names the draft revision it edits." });
});
/** The validated `applyPreset` payload: the draft it composes into, and the preset chosen. */
export type applyPresetPayload = z.infer<typeof applyPresetPayloadSchema>;
/** Validates the whole `applyPreset` request: the payload above inside this application's one mutation envelope. */
export const applyPresetInputSchema = mutationInputSchema(applyPresetPayloadSchema);
