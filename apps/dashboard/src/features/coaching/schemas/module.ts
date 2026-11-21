/**
 * The Coaching family's `setModule` payload schema: one grant, one of the sharable modules, and
 * whether that module is now shared.
 */
import { z } from "zod";
import { MODULE_KEYS } from "@/modules/coaching/grant";
/** Validates the `setModule` payload: the grant it addresses, the one module it changes, and whether that module is now shared with the coach. */
export const moduleChangePayloadSchema = z.strictObject({
  grantId: z.string().trim().min(1),
  moduleKey: z.enum(MODULE_KEYS),
  enabled: z.boolean(),
});
/** The validated `setModule` payload: one opaque grant reference, one module key, and its new flag. */
export type ModuleChangePayload = z.infer<typeof moduleChangePayloadSchema>;
