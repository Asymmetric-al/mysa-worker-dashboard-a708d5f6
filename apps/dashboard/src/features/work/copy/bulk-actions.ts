export const BULK_INTENTS = ["private-tag", "create-follow-up-tasks", "complete-independent-tasks"] as const;
export type BulkIntent = (typeof BULK_INTENTS)[number];
export const BULK_INTENT_LABELS: Record<BulkIntent, string> = { "private-tag": "Private tag", "create-follow-up-tasks": "Create follow-up tasks", "complete-independent-tasks": "Complete selected tasks" };
export const BULK_INTENT_DESCRIPTIONS: Record<BulkIntent, string> = {
  "private-tag": "Add or remove a personal tag that only you can see.",
  "create-follow-up-tasks": "Create one follow-up task for each selected row without sending any messages.",
  "complete-independent-tasks": "Mark each eligible selected task complete (doesn’t log an interaction or gift).",
};
export const BULK_TAG_DIRECTIONS = ["apply", "remove"] as const;
export type BulkTagDirection = (typeof BULK_TAG_DIRECTIONS)[number];
export const BULK_TAG_DIRECTION_LABELS: Record<BulkTagDirection, string> = { apply: "Add private tag", remove: "Remove private tag" };
export const BULK_REVIEW_HEADING = "Review bulk action";
export const BULK_SELECTION_COUNT_TEMPLATE = "{count} selected. Only the rows you selected will be updated.";
export const BULK_SELECTION_SCOPE_NOTE = "Applies only to the rows you selected — doesn’t send messages or subscribe anyone.";
export const BULK_REVIEW_CONFIRM_LABEL = "Apply to selected";
export const BULK_REVIEW_CANCEL_LABEL = "Cancel";
export const BULK_ITEM_RESULT_STATES = ["accepted", "unchanged", "excluded", "failed"] as const;
export type BulkItemResultState = (typeof BULK_ITEM_RESULT_STATES)[number];
export const BULK_ITEM_RESULT_LABELS: Record<BulkItemResultState, string> = { accepted: "Saved", unchanged: "Unchanged", excluded: "Excluded", failed: "Failed" };
export const BULK_RESULT_HEADING = "Row-by-row results";
export const BULK_MIXED_RESULT_NOTE = "Each row reports its own status below — check them individually.";
export const BULK_REPLAY_NOTE = "This action was already saved earlier — nothing was applied twice.";
/** The four bulk mutations, named as the operation each browser transport carries. */ export type BulkOperation = "bulkApplyTag" | "bulkRemoveTag" | "bulkCreateTasks" | "bulkCompleteTasks";
export const BULK_UNCHANGED_ROW_REASONS: Record<BulkOperation, string> = {
  bulkApplyTag: "Already has this tag.",
  bulkRemoveTag: "Didn’t have this tag.",
  bulkCreateTasks: "Couldn’t create a follow-up from this row in your current session.",
  bulkCompleteTasks: "Already completed or cancelled.",
};
export const BULK_UNCHANGED_BATCH_NOTE = "No rows needed changes — see each row’s status below.";
export const BULK_SESSION_ROW_EXCLUSION_REASON = "Can’t be changed in your current session, so it was skipped.";
export const BULK_UNNAMED_ROW_REASON = "No status was returned for this row.";
export const BULK_FIELD_MESSAGES = { emptySelection: "Select at least one row first.", tagRequired: "Enter a private tag name.", followUpTaskTitleRequired: "Enter a title for the follow-up tasks." } as const;
