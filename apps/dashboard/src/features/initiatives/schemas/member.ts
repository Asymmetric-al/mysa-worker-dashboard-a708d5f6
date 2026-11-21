import { z } from "zod";
import { MEMBERSHIP_STATES } from "../copy";
// Strict objects, so a payload carrying a state, a stage or any other unrecognised key
// fails here instead of being silently dropped and saved with the wrong meaning.
const initiativeIdField = z.string().trim().min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again.");

const memberIdField = z.string().trim().min(1, "This change is missing the working-list member it belongs to; reload the working list and try again.");

const partnerIdField = z.string().trim().min(1, "This selection is missing a partner; reopen the member picker and choose again.");
/** Validates the `addMembers` payload: the initiative and the partners the worker explicitly selected. */
export const addMembersPayloadSchema = z
  .strictObject({
    initiativeId: initiativeIdField,
    partnerIds: z
      .array(partnerIdField)
      .min(1, "Choose at least one partner to add.")
      // 200 mirrors the application's list page cap, so one selection never exceeds one page of partners.
      .max(200, "Add 200 partners or fewer at a time."),
  })
  .superRefine((payload, context) => {
    const seen = new Set<string>();
    payload.partnerIds.forEach((partnerId, index) => {
      if (!seen.has(partnerId)) {
        seen.add(partnerId);
        return;
      }
      // The path points at the repeated entry, so the picker marks that chip rather than the whole list.
      context.addIssue({
        code: "custom",
        message: "Remove the duplicate partner from this selection.",
        path: ["partnerIds", index],
      });
    });
  });
/** Validates the `removeMember` payload: the initiative, the working-list member and an optional reason. */
export const removeMemberPayloadSchema = z.strictObject({
  initiativeId: initiativeIdField,
  memberId: memberIdField,
  // Leaving the key out is a valid removal; a blank reason is not silently treated as absent.
  reason: z.string().trim().min(1, "Enter a reason or leave the reason empty.").optional(),
});
/** Validates the `returnMember` payload: the initiative and the working-list member to return. */
export const returnMemberPayloadSchema = z.strictObject({
  initiativeId: initiativeIdField,
  memberId: memberIdField,
});
/** The validated `addMembers` payload. */
export type AddMembersPayload = z.infer<typeof addMembersPayloadSchema>;
/** The validated `removeMember` payload. */
export type RemoveMemberPayload = z.infer<typeof removeMemberPayloadSchema>;
/** The validated `returnMember` payload. */
export type ReturnMemberPayload = z.infer<typeof returnMemberPayloadSchema>;
/** The three per-row working-list actions, declared once for the picker and the row menu. */
export const MEMBER_ACTIONS = ["add", "remove", "return"] as const;
/** One per-row working-list action. */
export type MemberAction = (typeof MEMBER_ACTIONS)[number];
/** The membership state each action results in, so a reviewed change reads "Add → Included" from one vocabulary; the `satisfies` clause makes a drift from the family's states a compile error. */
export const MEMBER_ACTION_STATE = {
  add: "included",
  remove: "removed",
  return: "included",
} as const satisfies Readonly<Record<MemberAction, (typeof MEMBERSHIP_STATES)[number]>>;
