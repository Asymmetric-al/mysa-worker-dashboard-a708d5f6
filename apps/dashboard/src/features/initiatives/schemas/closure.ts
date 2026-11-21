import { z } from "zod";

const initiativeHandoffSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("eligible-handoff"),
      toPrincipalId: z
        .string()
        .trim()
        .min(1, "Name the person who takes over the unfinished work."),
      note: z.string().trim().min(1, "Describe what is being handed over."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("none"),
      reason: z.string().trim().min(1, "Say why no handoff is needed."),
    })
    .strict(),
]);

/** Client-side shape of a `closeInitiative` payload, checked before the service re-checks it. */
export const closeInitiativePayloadSchema = z
  .object({
    initiativeId: z
      .string()
      .trim()
      .min(
        1,
        "This change is missing the initiative it belongs to; reopen the initiative and try again.",
      ),
    // The admitted dispositions come from the read envelope, so this only checks that one was chosen.
    disposition: z
      .string()
      .trim()
      .min(1, "Choose how this initiative is closing, or name who takes over the unfinished work.")
      .optional(),
    // Required on purpose: the `none` member records why no handoff is needed, so silence cannot close an initiative.
    handoff: initiativeHandoffSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    // Whether this initiative actually owns unfinished work is the service's question; this only asks the worker to answer.
    if (payload.disposition === undefined && payload.handoff.kind !== "eligible-handoff") {
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message:
          "Say how this initiative closes: choose a disposition, or name who takes over the unfinished work.",
      });
    }
  });

/** The validated fields of a close request. */
export type CloseInitiativePayload = z.infer<typeof closeInitiativePayloadSchema>;

/** How owned unfinished work is dealt with when an initiative closes. */
export type InitiativeHandoff = CloseInitiativePayload["handoff"];

/** Client-side shape of a `reopenInitiative` payload, checked before the service re-checks it. */
export const reopenInitiativePayloadSchema = z
  .object({
    initiativeId: z
      .string()
      .trim()
      .min(
        1,
        "This change is missing the initiative it belongs to; reopen the initiative and try again.",
      ),
    reason: z.string().trim().min(1, "Enter a reason or leave the reason empty.").optional(),
  })
  .strict();

/** The validated fields of a reopen request. */
export type ReopenInitiativePayload = z.infer<typeof reopenInitiativePayloadSchema>;
