/**
 * The Shell family's `selectContext` request contract: the context a session asks to act in, and the
 * four-field mutation input that carries that request to `POST /api/session/context`.
 */
import { z } from "zod";
import { ministryIdSchema, mutationInputSchema, organizationIdSchema, supportSubjectIdSchema } from "@/modules/data-service/envelope";
import type { UnsavedWorkResolution } from "@/modules/data-service/mutations/dev";
const unsavedWorkResolutionSchema: z.ZodType<UnsavedWorkResolution> = z.enum(["save", "discard", "stay"]);
/** Validates the `selectContext` payload: the target context only, plus the caller's optional decision. */
export const selectContextPayloadSchema = z.strictObject({
  organizationId: organizationIdSchema,
  ministryId: ministryIdSchema,
  supportSubjectId: supportSubjectIdSchema,
  resolveUnsavedWork: unsavedWorkResolutionSchema.optional(),
});
/** The validated `selectContext` payload: three opaque context references and an optional resolution. */
export type SelectContextPayload = z.infer<typeof selectContextPayloadSchema>;
/** Validates selectContext — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const selectContextRequestSchema = mutationInputSchema(selectContextPayloadSchema);
/** The validated `selectContext` request: the four-field mutation input over the payload above. */
export type SelectContextRequest = z.infer<typeof selectContextRequestSchema>;
