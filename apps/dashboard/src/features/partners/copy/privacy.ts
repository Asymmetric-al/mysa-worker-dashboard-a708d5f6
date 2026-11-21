import { PERMISSION_FACT_COPY } from "./facets";
export type Copy = { readonly title: string; readonly body: string };
export const PRIVATE_RECORD_COPY: Readonly<Record<"preparationIsPrivate" | "noteIsPrivate" | "remainsPrivate" | "linkingIsDeliberate" | "linkingCopiesNothing" | "exportExcludesPrivate", Copy>> = {
  preparationIsPrivate: { title: "Your own preparation", body: "This record holds preparation you wrote, it may exist without any shared identity, and it is not a contact record for anyone else." },
  noteIsPrivate: { title: "A note you wrote", body: "It records what you observed or decided, and its audience is private." },
  remainsPrivate: { title: "Private text stays where you wrote it", body: "A private note or a private preparation record never appears in a shared projection, in an export, or in another record's audience." },
  linkingIsDeliberate: { title: "Linking is your decision", body: "Connecting a private preparation record to a shared identity is a deliberate act of yours, and it never happens because a name or an address looked the same." },
  linkingCopiesNothing: { title: "Linking copies nothing", body: "Linking leaves every private word in the preparation record; nothing is copied into the shared record." },
  exportExcludesPrivate: { title: "Exports carry shared facts only", body: "A roster export contains no private text, so the file you download is not a copy of your preparation." },
};
export const AUDIENCE_LABEL_COPY: Readonly<Record<"private" | "shared", { readonly label: string; readonly description: string }>> = {
  private: { label: "Private", description: "Only you can read this line; it is not part of the shared record." },
  shared: { label: "Shared", description: "Other people who can see this record may read this line, so treat it as shared and not as private." },
};
export const IDENTITY_COPY: Readonly<Record<"distinctKinds" | "equalLooking" | "noIdentityFromMatching" | "householdIsNotPerson" | "representativeIsSeparate" | "noJoinKey", Copy>> = {
  distinctKinds: { title: "Six record kinds", body: "A person, a household, a church, an organization, an organization's representative and a private preparation record are six distinct record kinds, and each keeps its own identity." },
  equalLooking: { title: "Look-alike details", body: "Records that share a name, an email address or a postal address stay separate records." },
  noIdentityFromMatching: { title: "What a match does not establish", body: "A match on a name or an address establishes neither identity nor authority." },
  householdIsNotPerson: { title: "Consent and giving are a person's", body: "A household is not a person's consent or giving identity." },
  representativeIsSeparate: { title: "A representative stands apart", body: "An organization's representative is a separate record from the organization." },
  noJoinKey: { title: "How records link", body: "Records are linked by their own identifiers, never by the details written on them." },
};
export const INTERACTION_COPY: Readonly<Record<"whatCounts" | "whatDoesNot" | "precisionDate" | "precisionApproximate" | "precisionUnknown" | "provesNothing" | "recordedOnce", Copy>> = {
  whatCounts: { title: "What an interaction records", body: "An interaction records something that actually happened, with its date or an honest precision, an outcome and the people who took part." },
  whatDoesNot: { title: "What is not an interaction", body: "A gift, a scheduled task or opening a mail or dialer app is not an interaction." },
  precisionDate: { title: "You know the day", body: "The interaction is recorded against the day it happened." },
  precisionApproximate: { title: "You know roughly when", body: "The interaction is recorded as approximate, because a nearer day would be invented rather than known." },
  precisionUnknown: { title: "You do not know when", body: "The interaction is recorded without a date, and nothing is guessed to fill one in." },
  provesNothing: {
    title: "What a logged interaction does not prove",
    body: `Recording an interaction is not proof of a gift, a payment or a promise kept, and it does not mean work was completed. ${PERMISSION_FACT_COPY.communicationConsent.label} is a separate fact: ${PERMISSION_FACT_COPY.communicationConsent.explanation}`,
  },
  recordedOnce: { title: "Recorded once", body: "An event a source already recorded appears once, and logging it again would record it twice." },
};
export const ARCHIVE_COPY: Readonly<Record<"archiveIsNotDelete" | "restore" | "leavesSharedAlone" | "scope", Copy>> = {
  archiveIsNotDelete: { title: "Archiving hides, it does not delete", body: "Archiving takes a private preparation record out of your working lists and deletes nothing, so the record and its text are still there." },
  restore: { title: "Restoring brings it back", body: "Restoring returns the record to your working lists with its content as you left it." },
  leavesSharedAlone: { title: "Nothing else moves", body: "Archiving never touches a shared record, an open task, an interaction or any other independent obligation." },
  scope: { title: "Private preparation only", body: "Archive and restore apply to private preparation records and to nothing else." },
};
export const SAVED_VIEW_COPY: Readonly<Record<"save" | "update" | "rename" | "delete" | "drift" | "repair" | "leavesRecordsAlone", Copy>> = {
  save: { title: "Save this view", body: "Stores your current search, filters, sort, columns and page size under a name you choose; the records themselves are untouched." },
  update: { title: "Update this view", body: "Replaces what the view stores with the choices on screen now, without writing to any record." },
  rename: { title: "Rename this view", body: "Changes the view's name and nothing else; the choices it stores stay as they are." },
  delete: { title: "Delete this view", body: "Removes the stored view; every record, tag and note stays as it was." },
  drift: { title: "This view has drifted", body: "This saved view refers to a filter that is no longer available; the view and every record are otherwise unchanged." },
  repair: { title: "Repair this view", body: "Saves the selection again so the view matches what is available now; only the view's stored choices change." },
  leavesRecordsAlone: { title: "Views store choices, not records", body: "No saved-view action writes to a partner record." },
};
