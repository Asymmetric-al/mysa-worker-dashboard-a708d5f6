import { z } from "zod";
export const setStagePayloadSchema = z.strictObject({
  initiativeId: z.string().trim().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."),
  memberId: z.string().trim().min(1, "This change is missing the working-list member it belongs to; reload the working list and try again."),
  stage: z.string().trim().min(1, "Choose a stage from the approved list, or clear the stage.").nullable(),
});
export type StagePayload = z.infer<typeof setStagePayloadSchema>;
export function isAdmittedStage(admitted: readonly string[], value: string | null): boolean {
  return value === null ? true : admitted.includes(value);
}
