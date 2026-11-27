import { PERMISSION_FACT_COPY } from "./facets";
export type Copy = { readonly title: string; readonly body: string };
export const PRIVATE_RECORD_COPY: Readonly<Record<"preparationIsPrivate" | "noteIsPrivate" | "remainsPrivate" | "linkingIsDeliberate" | "linkingCopiesNothing" | "exportExcludesPrivate", Copy>> = {
  preparationIsPrivate: { title: "Private contact", body: "This contact belongs to you alone — it doesn’t create a shared partner record or give anyone else access." },
  noteIsPrivate: { title: "Only visible to you", body: "Your notes stay private and are never shared with partners or teammates." },
  remainsPrivate: { title: "Private notes stay private", body: "Private contacts and notes never appear in shared partner records, exports, or email audiences." },
  linkingIsDeliberate: { title: "Linking is always your choice", body: "Connecting a private contact to a shared partner only happens when you choose it — never automatically by matching names or emails." },
  linkingCopiesNothing: { title: "Linking copies nothing", body: "Your private notes stay on your private contact and are never copied into the shared partner record." },
  exportExcludesPrivate: { title: "Exports include shared fields only", body: "Downloaded partner exports never include your private contacts or notes." },
};
export const AUDIENCE_LABEL_COPY: Readonly<Record<"private" | "shared", { readonly label: string; readonly description: string }>> = {
  private: { label: "Private", description: "Only visible to you — not part of the shared partner record." },
  shared: { label: "Shared", description: "Visible to anyone on your team who can view this partner." },
};
export const IDENTITY_COPY: Readonly<Record<"distinctKinds" | "equalLooking" | "noIdentityFromMatching" | "householdIsNotPerson" | "representativeIsSeparate" | "noJoinKey", Copy>> = {
  distinctKinds: { title: "Separate partner records", body: "People, households, churches, organizations, representatives, and private contacts each keep their own separate record." },
  equalLooking: { title: "Similar details stay separate", body: "Two records with the same name, email, or address remain separate records." },
  noIdentityFromMatching: { title: "Matching details aren’t merged", body: "A shared name or address never merges two records or transfers permissions." },
  householdIsNotPerson: { title: "Consent and giving belong to the individual", body: "A household record doesn’t carry an individual person’s consent or giving identity." },
  representativeIsSeparate: { title: "Representatives stay separate", body: "An organization’s representative has their own separate record." },
  noJoinKey: { title: "Linked by ID, never guessed", body: "Records are only linked by explicit IDs, never by matching names or contact details." },
};
export const INTERACTION_COPY: Readonly<Record<"whatCounts" | "whatDoesNot" | "precisionDate" | "precisionApproximate" | "precisionUnknown" | "provesNothing" | "recordedOnce", Copy>> = {
  whatCounts: { title: "What counts as activity", body: "Log calls, visits, conversations, meetings, and written messages that actually happened." },
  whatDoesNot: { title: "What isn’t logged here", body: "Gifts, scheduled tasks, and opening your mail or phone app aren’t logged as activity." },
  precisionDate: { title: "Exact date", body: "You know the specific day this happened." },
  precisionApproximate: { title: "Approximate date", body: "Recorded as approximate so an uncertain date isn’t treated as exact." },
  precisionUnknown: { title: "Date unknown", body: "Saved without a date rather than guessing." },
  provesNothing: {
    title: "Activity doesn’t record consent or gifts",
    body: `Logging a conversation doesn’t record a gift, commitment, or completed task. ${PERMISSION_FACT_COPY.communicationConsent.label} is tracked separately: ${PERMISSION_FACT_COPY.communicationConsent.explanation}`,
  },
  recordedOnce: { title: "Recorded once", body: "Imported or synced activity already appears once — avoid logging the same contact twice." },
};
export const CONTACT_HANDOFF_COPY: Readonly<Record<"recordsNothing", Copy>> = { recordsNothing: { title: "Opening mail or phone apps doesn’t log activity", body: "Clicking Email or Call opens your app without logging activity or editing the partner record." } };
export const ARCHIVE_COPY: Readonly<Record<"archiveIsNotDelete" | "restore" | "leavesSharedAlone" | "scope", Copy>> = {
  archiveIsNotDelete: { title: "Archiving hides without deleting", body: "Archiving hides this private contact from your active lists while keeping all of your notes intact." },
  restore: { title: "Restore any time", body: "Restoring returns this private contact to your active lists with all notes as you left them." },
  leavesSharedAlone: { title: "Nothing else changes", body: "Archiving never changes shared partner records, open tasks, or logged activity." },
  scope: { title: "Private contacts only", body: "Only your private contacts can be archived or restored here." },
};
export const SAVED_VIEW_COPY: Readonly<Record<"save" | "update" | "rename" | "delete" | "drift" | "repair" | "leavesRecordsAlone", Copy>> = {
  save: { title: "Save view", body: "Save your current search, filters, sort order, columns, and page size so you can return to them anytime." },
  update: { title: "Update view", body: "Replace this saved view’s filters and columns with what’s currently on screen." },
  rename: { title: "Rename view", body: "Change this saved view’s name without altering its filters." },
  delete: { title: "Delete view", body: "Remove this saved view. Your partners, tags, and notes aren’t affected." },
  drift: { title: "Saved view needs repair", body: "One or more filters or columns in this saved view are no longer available in this ministry." },
  repair: { title: "Repair view", body: "Remove unavailable filters from this saved view so you can use it again." },
  leavesRecordsAlone: { title: "Views only save filters", body: "Saving or deleting a view never edits any partner record." },
};
