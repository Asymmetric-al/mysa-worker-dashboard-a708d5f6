import { z } from "zod";
// Strict so an unexpected key, such as a previous stage, is an error rather than silently dropped.
/** Validates the `setStage` payload: the initiative, the working-list member, and either an approved stage token or an explicit Clear. */
export const setStagePayloadSchema = z.strictObject({
  initiativeId: z.string().trim().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."),
  memberId: z.string().trim().min(1, "This change is missing the working-list member it belongs to; reload the working list and try again."),
  stage: z.string().trim().min(1, "Choose a stage from the approved list, or clear the stage.").nullable(),
});
/** The validated `setStage` payload: opaque initiative and member references, plus the chosen stage token or `null` for Clear. */
export type StagePayload = z.infer<typeof setStagePayloadSchema>;
/** Answers whether a token is on the source-approved list: `null` (Clear) always is, and any other token only on an exact match. */
export function isAdmittedStage(admitted: readonly string[], value: string | null): boolean {
  return value === null ? true : admitted.includes(value);
}
