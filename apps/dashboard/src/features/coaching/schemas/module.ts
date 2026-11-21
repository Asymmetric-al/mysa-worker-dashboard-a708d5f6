import { z } from "zod";
import { MODULE_KEYS } from "@/modules/coaching/grant";
export const moduleChangePayloadSchema = z.strictObject({ grantId: z.string().trim().min(1), moduleKey: z.enum(MODULE_KEYS), enabled: z.boolean() });
export type ModuleChangePayload = z.infer<typeof moduleChangePayloadSchema>;
