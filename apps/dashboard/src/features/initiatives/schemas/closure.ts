import { z } from "zod";
const initiativeHandoffSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("eligible-handoff"), toPrincipalId: z.string().trim().min(1, "Name the person who takes over the unfinished work."), note: z.string().trim().min(1, "Describe what is being handed over.") }).strict(),
  z.object({ kind: z.literal("none"), reason: z.string().trim().min(1, "Say why no handoff is needed.") }).strict(),
]);
export const closeInitiativePayloadSchema = z
  .object({ initiativeId: z.string().trim().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."), disposition: z.string().trim().min(1, "Choose how this initiative is closing, or name who takes over the unfinished work.").optional(), handoff: initiativeHandoffSchema })
  .strict()
  .superRefine((payload, context) => {
    if (payload.disposition === undefined && payload.handoff.kind !== "eligible-handoff") {
      context.addIssue({ code: "custom", path: ["disposition"], message: "Say how this initiative closes: choose a disposition, or name who takes over the unfinished work." });
    }
  });
export type CloseInitiativePayload = z.infer<typeof closeInitiativePayloadSchema>;
export type InitiativeHandoff = CloseInitiativePayload["handoff"];
export const reopenInitiativePayloadSchema = z.object({ initiativeId: z.string().trim().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."), reason: z.string().trim().min(1, "Enter a reason or leave the reason empty.").optional() }).strict();
export type ReopenInitiativePayload = z.infer<typeof reopenInitiativePayloadSchema>;
