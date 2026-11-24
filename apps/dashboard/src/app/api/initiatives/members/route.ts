import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { writeRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const initiativeIdField = z.string().trim().min(1, "Name the initiative this working-list change belongs to.");
const partnerIdField = z.string().trim().min(1, "This selection is missing a partner; reopen the member picker and choose again.");
const memberIdField = z.string().trim().min(1, "Name the working-list member this change belongs to.");
const reasonField = z.string().trim().min(1, "Enter a reason or leave the reason empty.").optional();
const addSelectionSchema = z.strictObject({ action: z.literal("add"), initiativeId: initiativeIdField, partnerIds: z.array(partnerIdField).min(1, "Choose at least one partner to add.") });
const removeSelectionSchema = z.strictObject({ action: z.literal("remove"), initiativeId: initiativeIdField, memberId: memberIdField, reason: reasonField });
const returnSelectionSchema = z.strictObject({ action: z.literal("return"), initiativeId: initiativeIdField, memberId: memberIdField });
const membersPayloadSchema = z.discriminatedUnion("action", [addSelectionSchema, removeSelectionSchema, returnSelectionSchema], { error: "State which change this request makes as payload.action: add, remove or return." });
const membersRequestSchema = mutationInputSchema(membersPayloadSchema);
async function runMemberChange(input: MutationInput<z.infer<typeof membersPayloadSchema>>): Promise<MutationOutcome> {
  const { payload } = input;
  if (payload.action === "add") return mutations.outreach.addMembers({ ...input, payload: { initiativeId: payload.initiativeId, partnerIds: payload.partnerIds } });
  if (payload.action === "remove") return mutations.outreach.removeMember({ ...input, payload: { initiativeId: payload.initiativeId, memberId: payload.memberId, ...(payload.reason === undefined ? {} : { reason: payload.reason }) } });
  return mutations.outreach.returnMember({ ...input, payload: { initiativeId: payload.initiativeId, memberId: payload.memberId } });
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: (request: Request): Promise<Response> => writeRoute(request, membersRequestSchema, runMemberChange) });
