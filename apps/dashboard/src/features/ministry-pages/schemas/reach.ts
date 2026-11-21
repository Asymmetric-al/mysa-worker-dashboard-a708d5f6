import { z } from "zod";
import { mutationInputSchema } from "@/modules/data-service/envelope";
import type { DocumentPayload, SetReachPayload as ServiceSetReachPayload } from "@/modules/data-service/mutations/content";
import { REACH_VALUES } from "@/modules/content/reach";
const MESSAGES = {
  reachDocumentRequired: "Open the page whose reach you want to change.",
  reachInvalid: "Choose one of the three visibility options.",
  documentRequired: "Open the page you want to stop showing publicly.",
  containmentUnacknowledged: "Confirm that this hides every language edition of this page.",
} as const;
export const setReachPayloadSchema: z.ZodType<ServiceSetReachPayload> = z.strictObject({ documentId: z.string({ message: MESSAGES.reachDocumentRequired }).trim().min(1, { message: MESSAGES.reachDocumentRequired }), reach: z.enum(REACH_VALUES, { message: MESSAGES.reachInvalid }) });
export type SetReachPayload = z.infer<typeof setReachPayloadSchema>;
export const setReachInputSchema = mutationInputSchema(setReachPayloadSchema);
export type SetReachInput = z.infer<typeof setReachInputSchema>;
const documentIdField = z.string({ message: MESSAGES.documentRequired }).trim().min(1, { message: MESSAGES.documentRequired });
export const stopShowingPubliclyPayloadSchema: z.ZodType<DocumentPayload> = z.strictObject({ documentId: documentIdField });
export const stopShowingPubliclyFormSchema = z.strictObject({ documentId: documentIdField, acknowledgeContainsAllLocales: z.literal(true, { message: MESSAGES.containmentUnacknowledged }) }).transform((form): DocumentPayload => ({ documentId: form.documentId }));
export type StopShowingPubliclyPayload = z.infer<typeof stopShowingPubliclyPayloadSchema>;
export const stopShowingPubliclyInputSchema = mutationInputSchema(stopShowingPubliclyPayloadSchema);
export type StopShowingPubliclyInput = z.infer<typeof stopShowingPubliclyInputSchema>;
