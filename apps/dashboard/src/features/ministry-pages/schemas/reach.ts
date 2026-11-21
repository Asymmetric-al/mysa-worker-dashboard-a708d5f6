/**
 * The Worker and Project Pages family's two reach payloads — `setReach` and `stopShowingPublicly` —
 * each with the four-field mutation envelope it is posted inside.
 */
import { z } from "zod";
// The envelope comes from its own module rather than the `@/modules/data-service` barrel: the barrel
// also re-exports the reads and mutations, whose graph reaches the store and `node:fs`, while this
// file is loaded by the browser's reach control.
import { mutationInputSchema } from "@/modules/data-service/envelope";
// The annotation types are imported with `import type`, which the compiler erases: they hold these
// schemas to the service's own payload types without pulling the mutation bodies, the store or
// `node:fs` into a client bundle.
import type { DocumentPayload, SetReachPayload as ServiceSetReachPayload } from "@/modules/data-service/mutations/content";
import { REACH_VALUES } from "@/modules/content/reach";
// Every refusal these payloads can show
const MESSAGES = {
  reachDocumentRequired: "Open the page whose reach you want to change.",
  reachInvalid: "Choose one of the three visibility options.",
  documentRequired: "Open the page you want to stop showing publicly.",
  containmentUnacknowledged: "Confirm that this hides every language edition of this page.",
} as const;
// setReach: how far one page's released editions reach
/** Validates the `setReach` payload: the page whose released editions change reach, and the reach they take. */
export const setReachPayloadSchema: z.ZodType<ServiceSetReachPayload> = z.strictObject({
  documentId: z.string({ message: MESSAGES.reachDocumentRequired }).trim().min(1, { message: MESSAGES.reachDocumentRequired }),
  // The three values come from `reach.ts`, and no component may invent a fourth: a value outside the
  // vocabulary is refused here rather than snapped to whichever member looks closest.
  reach: z.enum(REACH_VALUES, { message: MESSAGES.reachInvalid }),
});
/** The validated `setReach` payload: the page whose released editions change reach, and that reach. */
export type SetReachPayload = z.infer<typeof setReachPayloadSchema>;
/** Feeds `setReach`: that payload inside the shared operation, scope and revision envelope. */
export const setReachInputSchema = mutationInputSchema(setReachPayloadSchema);
/** The complete `setReach` request body, inferred so the reach control and its hook hold one shape. */
export type SetReachInput = z.infer<typeof setReachInputSchema>;
// stopShowingPublicly: every edition of one page, at once
const documentIdField = z.string({ message: MESSAGES.documentRequired }).trim().min(1, { message: MESSAGES.documentRequired });
/** Validates the `stopShowingPublicly` payload the service accepts: the page, and nothing beside it. */
export const stopShowingPubliclyPayloadSchema: z.ZodType<DocumentPayload> = z.strictObject({
  documentId: documentIdField,
});
/** Validates what the containment dialog submits: the page, and the worker's explicit confirmation that every language edition of it stops being served. */
export const stopShowingPubliclyFormSchema = z
  .strictObject({
    documentId: documentIdField,
    acknowledgeContainsAllLocales: z.literal(true, {
      message: MESSAGES.containmentUnacknowledged,
    }),
  })
  .transform((form): DocumentPayload => ({ documentId: form.documentId }));
/** The validated `stopShowingPublicly` payload: the page whose editions are contained. */
export type StopShowingPubliclyPayload = z.infer<typeof stopShowingPubliclyPayloadSchema>;
/** Feeds `stopShowingPublicly`: that payload inside the shared operation, scope and revision envelope. */
export const stopShowingPubliclyInputSchema = mutationInputSchema(stopShowingPubliclyPayloadSchema);
/** The complete `stopShowingPublicly` request body, inferred so its dialog and hook hold one shape. */
export type StopShowingPubliclyInput = z.infer<typeof stopShowingPubliclyInputSchema>;
