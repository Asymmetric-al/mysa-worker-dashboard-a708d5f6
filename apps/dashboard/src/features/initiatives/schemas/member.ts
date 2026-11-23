import { z } from "zod";
import { MEMBERSHIP_STATES } from "../copy";
const initiativeIdField = z.string().trim().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again.");
const memberIdField = z.string().trim().min(1, "This change is missing the working-list member it belongs to; reload the working list and try again.");
const partnerIdField = z.string().trim().min(1, "This selection is missing a partner; reopen the member picker and choose again.");
export const addMembersPayloadSchema = z.strictObject({ initiativeId: initiativeIdField, partnerIds: z.array(partnerIdField).min(1, "Choose at least one partner to add.").max(200, "Add 200 partners or fewer at a time.") }).superRefine((payload, context) => {
  const seen = new Set<string>();
  payload.partnerIds.forEach((partnerId, index) => {
    if (!seen.has(partnerId)) {
      seen.add(partnerId);
      return;
    }
    context.addIssue({ code: "custom", message: "Remove the duplicate partner from this selection.", path: ["partnerIds", index] });
  });
});
export const removeMemberPayloadSchema = z.strictObject({ initiativeId: initiativeIdField, memberId: memberIdField, reason: z.string().trim().min(1, "Enter a reason or leave the reason empty.").optional() });
export const returnMemberPayloadSchema = z.strictObject({ initiativeId: initiativeIdField, memberId: memberIdField });
export type AddMembersPayload = z.infer<typeof addMembersPayloadSchema>;
export type RemoveMemberPayload = z.infer<typeof removeMemberPayloadSchema>;
export type ReturnMemberPayload = z.infer<typeof returnMemberPayloadSchema>;
export const MEMBER_ACTIONS = ["add", "remove", "return"] as const;
export type MemberAction = (typeof MEMBER_ACTIONS)[number];
export const MEMBER_ACTION_STATE = { add: "included", remove: "removed", return: "included" } as const satisfies Readonly<Record<MemberAction, (typeof MEMBERSHIP_STATES)[number]>>;
