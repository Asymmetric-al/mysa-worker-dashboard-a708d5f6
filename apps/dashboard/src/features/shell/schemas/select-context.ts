import { z } from "zod";
import { ministryIdSchema, mutationInputSchema, organizationIdSchema, supportSubjectIdSchema } from "@/modules/data-service/envelope";
import type { UnsavedWorkResolution } from "@/modules/data-service/mutations/dev";
const unsavedWorkResolutionSchema: z.ZodType<UnsavedWorkResolution> = z.enum(["save", "discard", "stay"]);
export const selectContextPayloadSchema = z.strictObject({ organizationId: organizationIdSchema, ministryId: ministryIdSchema, supportSubjectId: supportSubjectIdSchema, resolveUnsavedWork: unsavedWorkResolutionSchema.optional() });
export type SelectContextPayload = z.infer<typeof selectContextPayloadSchema>;
export const selectContextRequestSchema = mutationInputSchema(selectContextPayloadSchema);
export type SelectContextRequest = z.infer<typeof selectContextRequestSchema>;
