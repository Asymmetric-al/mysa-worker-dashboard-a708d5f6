import { z } from "zod";
import { parseCivilDate } from "@/modules/time/civil";
export const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") ctx.addIssue({ code: "custom", message: "Enter a real calendar date as YYYY-MM-DD." });
  });
/** Builds a trimmed text field whose length is bounded in Unicode code points. */
export function boundedTextSchema(maxCodePoints: number, messages: { readonly required: string; readonly tooLong: string }): z.ZodString {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const length = Array.from(value).length;
      if (length === 0) {
        ctx.addIssue({ code: "custom", message: messages.required });
      } else if (length > maxCodePoints) {
        ctx.addIssue({ code: "custom", message: messages.tooLong });
      }
    });
}
export const createInitiativePayloadSchema = z
  .object({
    name: boundedTextSchema(200, { required: "Give the initiative a name.", tooLong: "Keep the name to 200 characters or fewer." }),
    purpose: boundedTextSchema(2000, { required: "Describe what this initiative is for.", tooLong: "Keep the purpose to 2,000 characters or fewer." }),
    responsiblePrincipalId: z.string().trim().min(1, "Choose the person responsible for this initiative."),
    period: z.object({ startOn: civilDateSchema, endOn: civilDateSchema }).strict().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.period === undefined) return;
    if (parseCivilDate(value.period.startOn).status === "refused" || parseCivilDate(value.period.endOn).status === "refused") return;
    if (value.period.endOn < value.period.startOn) ctx.addIssue({ code: "custom", message: "Choose an end date on or after the start date.", path: ["period", "endOn"] });
  });
export type CreateInitiativePayload = z.infer<typeof createInitiativePayloadSchema>;
