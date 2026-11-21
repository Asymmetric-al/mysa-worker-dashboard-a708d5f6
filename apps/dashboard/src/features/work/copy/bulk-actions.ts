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
export const BULK_ITEM_RESULT_DESCRIPTIONS: Record<BulkItemResultState, string> = {
  accepted: "The action was applied to this row, once.",
  unchanged: "Nothing needed doing on this row, so nothing changed.",
  excluded: "This row was no longer eligible when the action ran, so it was left as it was.",
  failed: "Nothing was applied to this row; what was there before still stands.",
};
export const BULK_RESULT_HEADING = "Result for each selected row";
export const BULK_MIXED_RESULT_NOTE = "Each row shows its own result and rows can differ, so read them one at a time rather than as one outcome for the whole selection.";
export const BULK_REPLAY_NOTE = "This is the result of your earlier submission; nothing was applied a second time.";
export const BULK_FIELD_MESSAGES = { emptySelection: "Select at least one row to use a bulk action.", tagRequired: "Enter the private tag this action applies or removes.", followUpTaskTitleRequired: "Enter a title for the follow-up tasks." } as const;
