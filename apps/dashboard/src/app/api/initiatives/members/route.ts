/** `POST /api/initiatives/members` — the three changes that act on one initiative's reviewed working list: */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Every request resolves the development session and evaluates the scenario clock once.
export const dynamic = "force-dynamic";
// No `GET` is exported here on purpose, and neither is any other verb: the working list is read by `readInitiative` inside the initiative page, so a list handler on this path would be a second enumeration path beside that read. Next answers 405 to every other verb because none exists.
const ACTION_MESSAGE = "State which change this request makes as payload.action: add, remove or return.";
const initiativeIdField = z.string().trim().min(1, "Name the initiative this working-list change belongs to.");
const partnerIdField = z.string().trim().min(1, "This selection is missing a partner; reopen the member picker and choose again.");
const memberIdField = z.string().trim().min(1, "Name the working-list member this change belongs to.");
const reasonField = z.string().trim().min(1, "Enter a reason or leave the reason empty.").optional();
// One strict schema per change, so a request can state only the change it names. Strictness is what keeps the three states apart: a filter, a facet, an `allMatching` flag, an audience or consent field, a `state` or a `stage`, and a `deleteHistory` or `cascade` request are
// refused as unrecognised keys rather than dropped, so a selection is only ever the partners the worker ticked and a removal can never reach another record's history or obligations.
const addSelectionSchema = z.strictObject({ action: z.literal("add"), initiativeId: initiativeIdField, partnerIds: z.array(partnerIdField).min(1, "Choose at least one partner to add.") });
const removeSelectionSchema = z.strictObject({
  action: z.literal("remove"),
  initiativeId: initiativeIdField,
  memberId: memberIdField,
  // The service records this in the member's own history: leaving it out is a valid removal, and a blank reason is refused rather than saved as though none was given.
  reason: reasonField,
});
const returnSelectionSchema = z.strictObject({ action: z.literal("return"), initiativeId: initiativeIdField, memberId: memberIdField });
const membersPayloadSchema = z.discriminatedUnion("action", [addSelectionSchema, removeSelectionSchema, returnSelectionSchema], { error: ACTION_MESSAGE });
type MemberChange = z.infer<typeof membersPayloadSchema>;
// The four-field envelope is composed from the shared schema instead of restated, so `operationId`, `scope`, `expectedRevision` and the presence of `payload` are judged exactly as every other mutation in the application judges them.
const membersRequestSchema = mutationInputSchema(membersPayloadSchema);
async function runMemberChange(input: MutationInput<MemberChange>): Promise<MutationOutcome> {
  const { payload } = input;
  switch (payload.action) {
    case "add":
      return mutations.outreach.addMembers({ ...input, payload: { initiativeId: payload.initiativeId, partnerIds: payload.partnerIds } });
    case "remove":
      return mutations.outreach.removeMember({ ...input, payload: { initiativeId: payload.initiativeId, memberId: payload.memberId, ...(payload.reason === undefined ? {} : { reason: payload.reason }) } });
    case "return":
      return mutations.outreach.returnMember({ ...input, payload: { initiativeId: payload.initiativeId, memberId: payload.memberId } });
  }
}
/** Adds, removes or returns the explicitly selected working-list members, and answers one outcome. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = membersRequestSchema.safeParse(body);
  if (!parsed.success) return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  try {
    return toResponse(await runMemberChange(parsed.data));
  } catch (error) {
    // The shared mapper is the only place that tells a store outage from a lost acknowledgement, and the identity it answers with is the one the caller supplied.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
