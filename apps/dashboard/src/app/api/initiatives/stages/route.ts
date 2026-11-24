import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { writeRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const setStagePayloadSchema = z.strictObject({
  initiativeId: z.string().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."),
  memberId: z.string().min(1, "This change is missing the working-list member it belongs to; reload the working list and try again."),
  stage: z.string().min(1, "Choose a stage from the approved list, or clear the stage.").nullable(),
});
const setStageRequestSchema = mutationInputSchema(setStagePayloadSchema);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: (request: Request): Promise<Response> => writeRoute(request, setStageRequestSchema, mutations.outreach.setStage) });
