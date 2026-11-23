import { z } from "zod";
import { archivePreparationInput, mutationInputSchema, mutations, restorePreparationInput } from "@/modules/data-service";
import { refusalIdentityGiven, writeRoute } from "../../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UNATTEMPTED_OPERATION_ID = "no-operation-attempted";
const preparationIntent = z.discriminatedUnion("intent", [archivePreparationInput.extend({ intent: z.literal("archivePreparation") }), restorePreparationInput.extend({ intent: z.literal("restorePreparation") })], { error: "Name the change this request asks for: archivePreparation or restorePreparation." });
function preparationChangeRequest(address: string) {
  return mutationInputSchema(preparationIntent).superRefine((input, context) => {
    if (input.payload.partnerId !== address) context.addIssue({ code: "custom", path: ["payload", "partnerId"], message: "Name one preparation record. The path names the record this change applies to, and a payload naming a different one would leave the answer describing a record the caller did not address." });
  });
}
type PreparationAddress = { readonly partnerId: string };
const refusalIdentityOf = refusalIdentityGiven(UNATTEMPTED_OPERATION_ID);
/** Archives or restores one worker-private preparation record, as `payload.intent` names, and answers with exactly one of the eight outcomes. */
async function changePreparationArchive(request: Request, context: { params: Promise<PreparationAddress> }): Promise<Response> {
  const { partnerId } = await context.params;
  return writeRoute(
    request,
    preparationChangeRequest(partnerId),
    ({ payload, ...envelope }) => (payload.intent === "archivePreparation" ? mutations.partnerPreparation.archivePreparation({ ...envelope, payload: { partnerId: payload.partnerId } }) : mutations.partnerPreparation.restorePreparation({ ...envelope, payload: { partnerId: payload.partnerId } })),
    refusalIdentityOf,
  );
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: changePreparationArchive });
