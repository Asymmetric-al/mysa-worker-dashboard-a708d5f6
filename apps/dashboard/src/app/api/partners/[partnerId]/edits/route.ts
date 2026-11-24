import { mutationInputSchema, mutations, saveContactEditsInput } from "@/modules/data-service";
import { writeRoute } from "../../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const contactEditPayloadSchema = saveContactEditsInput.partial({ partnerId: true });
function contactEditRequestSchema(target: string) {
  return mutationInputSchema(contactEditPayloadSchema).superRefine((input, context) => {
    const claimed = input.payload.partnerId;
    if (claimed !== undefined && claimed !== target) context.addIssue({ code: "custom", path: ["payload", "partnerId"], message: "Name one record. The path names the record this change applies to, and a payload naming a different one would leave the answer describing a record the caller did not address." });
  });
}
async function saveContactEdits(request: Request, { params }: { params: Promise<{ partnerId: string }> }): Promise<Response> {
  const { partnerId } = await params;
  return writeRoute(request, contactEditRequestSchema(partnerId), (input) => mutations.partnerPreparation.saveContactEdits({ ...input, payload: { ...input.payload, partnerId } }));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: saveContactEdits });
