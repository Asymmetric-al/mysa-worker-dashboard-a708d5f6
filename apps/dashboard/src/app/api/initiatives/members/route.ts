import { z } from "zod";
import { mutationInputSchema, mutations, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { writeRoute } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ACTION_MESSAGE = "State which change this request makes as payload.action: add, remove or return.";
const initiativeIdField = z.string().trim().min(1, "Name the initiative this working-list change belongs to.");
const partnerIdField = z.string().trim().min(1, "This selection is missing a partner; reopen the member picker and choose again.");
const memberIdField = z.string().trim().min(1, "Name the working-list member this change belongs to.");
const reasonField = z.string().trim().min(1, "Enter a reason or leave the reason empty.").optional();
const addSelectionSchema = z.strictObject({ action: z.literal("add"), initiativeId: initiativeIdField, partnerIds: z.array(partnerIdField).min(1, "Choose at least one partner to add.") });
const removeSelectionSchema = z.strictObject({ action: z.literal("remove"), initiativeId: initiativeIdField, memberId: memberIdField, reason: reasonField });
const returnSelectionSchema = z.strictObject({ action: z.literal("return"), initiativeId: initiativeIdField, memberId: memberIdField });
const membersPayloadSchema = z.discriminatedUnion("action", [addSelectionSchema, removeSelectionSchema, returnSelectionSchema], { error: ACTION_MESSAGE });
type MemberChange = z.infer<typeof membersPayloadSchema>;
const membersRequestSchema = mutationInputSchema(membersPayloadSchema);
async function runMemberChange(input: MutationInput<MemberChange>): Promise<MutationOutcome> {
  const { payload } = input;
  if (payload.action === "add") return mutations.outreach.addMembers({ ...input, payload: { initiativeId: payload.initiativeId, partnerIds: payload.partnerIds } });
  if (payload.action === "remove") return mutations.outreach.removeMember({ ...input, payload: { initiativeId: payload.initiativeId, memberId: payload.memberId, ...(payload.reason === undefined ? {} : { reason: payload.reason }) } });
  return mutations.outreach.returnMember({ ...input, payload: { initiativeId: payload.initiativeId, memberId: payload.memberId } });
}
/** Adds, removes or returns the explicitly selected working-list members, and answers one outcome. */
export const POST = (request: Request): Promise<Response> => writeRoute(request, membersRequestSchema, runMemberChange);
