export const BULK_INTENTS = ["private-tag", "create-follow-up-tasks", "complete-independent-tasks"] as const;
export type BulkIntent = (typeof BULK_INTENTS)[number];
export const BULK_INTENT_LABELS: Record<BulkIntent, string> = { "private-tag": "Private tag", "create-follow-up-tasks": "Create follow-up tasks", "complete-independent-tasks": "Complete these tasks" };
export const BULK_INTENT_DESCRIPTIONS: Record<BulkIntent, string> = {
  "private-tag": "Adds or removes one tag that only you can see; nothing is sent and no other person sees the tag.",
  "create-follow-up-tasks": "Creates one ordinary follow-up task for each selected row; no message is sent and nothing is promised on anyone's behalf.",
  "complete-independent-tasks": "Marks each selected task complete, and only those that can be completed on their own; completion never records contact, a payment or a message.",
};
export const BULK_TAG_DIRECTIONS = ["apply", "remove"] as const;
export type BulkTagDirection = (typeof BULK_TAG_DIRECTIONS)[number];
export const BULK_TAG_DIRECTION_LABELS: Record<BulkTagDirection, string> = { apply: "Apply a private tag", remove: "Remove a private tag" };
export const BULK_REVIEW_HEADING = "Review this bulk action";
export const BULK_SELECTION_COUNT_TEMPLATE = "Rows selected: {count}. Only the rows you selected are affected.";
export const BULK_SELECTION_SCOPE_NOTE = "A selection is not an audience, not a consent and not a campaign: this action changes the selected rows only and contacts nobody.";
export const BULK_REVIEW_CONFIRM_LABEL = "Apply to the selected rows";
export const BULK_REVIEW_CANCEL_LABEL = "Cancel";
export const BULK_ITEM_RESULT_STATES = ["accepted", "unchanged", "excluded", "failed"] as const;
export type BulkItemResultState = (typeof BULK_ITEM_RESULT_STATES)[number];
export const BULK_ITEM_RESULT_LABELS: Record<BulkItemResultState, string> = { accepted: "Accepted", unchanged: "Unchanged", excluded: "Excluded", failed: "Failed" };
export const BULK_RESULT_HEADING = "Result for each selected row";
export const BULK_MIXED_RESULT_NOTE = "Each row shows its own result and rows can differ, so read them one at a time rather than as one outcome for the whole selection.";
export const BULK_REPLAY_NOTE = "This is the result of your earlier submission; nothing was applied a second time.";
/** The four bulk mutations, named as the operation each browser transport carries, so a row's reason can be stated for the intent that was actually sent. */ export type BulkOperation = "bulkApplyTag" | "bulkRemoveTag" | "bulkCreateTasks" | "bulkCompleteTasks";
/**
 * What an `unchanged` result means for one row, intent by intent: the service states its own per-row reasons when
 * any row was accepted and answers a batch that changed nothing with no rows at all, so this is the reason the
 * surface states for that batch, and every row the surface submits is one the read offered for that intent.
 */
export const BULK_UNCHANGED_ROW_REASONS: Record<BulkOperation, string> = {
  bulkApplyTag: "This row already carried this tag when the action ran, so nothing was applied to it.",
  bulkRemoveTag: "This row did not carry this tag when the action ran, so there was nothing to remove from it.",
  bulkCreateTasks: "This row could not be read as one of your own tasks when the action ran, so no follow-up task was created from it.",
  bulkCompleteTasks: "This row was no longer open or reopened when the action ran, so there was nothing here to complete.",
};
export const BULK_UNCHANGED_BATCH_NOTE = "No row needed a change, so nothing was applied; each row below states why it was left as it was.";
export const BULK_SESSION_ROW_EXCLUSION_REASON = "This row cannot be changed from this session, so it was left out of the action before it was sent.";
export const BULK_UNNAMED_ROW_REASON = "This row came back with no result of its own, so nothing here states what the action did to it.";
export const BULK_FIELD_MESSAGES = { emptySelection: "Select at least one row to use a bulk action.", tagRequired: "Enter the private tag this action applies or removes.", followUpTaskTitleRequired: "Enter a title for the follow-up tasks." } as const;
