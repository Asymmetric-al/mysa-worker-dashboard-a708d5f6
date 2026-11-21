/**
 * The Partners family's single wording source for what stays private, which records are
 * distinct, what an interaction is, what archiving does and what each saved-view action
 * changes.
 *
 * Two boundaries hold throughout this family. A private preparation record and a private
 * note are a different record class from shared operational facts, so they never leave the
 * worker's own space. And equal-looking names, email addresses or postal addresses
 * establish neither identity nor authority: two records that look alike stay two records.
 *
 * The wording is consumed by the roster, the record body, the note composer, the
 * interaction form, the preparation form, the archive actions and the saved-view bar. The
 * permission-fact labels come from `./facets` rather than being reworded here, and the
 * saved-view repair label declared here is the one the states module imports, so the
 * direction of imports stays one-way. This module declares text only: it formats nothing,
 * computes nothing, holds no state and carries no endpoint, provider or credential of any
 * kind.
 */

import { PERMISSION_FACT_COPY } from "./facets";

/** One piece of guidance as a short heading and the sentence that carries its meaning. */
export type Copy = {
  readonly title: string;
  readonly body: string;
};

/** Why a private preparation record and a private note stay out of every shared surface. */
export const PRIVATE_RECORD_COPY: Readonly<
  Record<
    | "preparationIsPrivate"
    | "noteIsPrivate"
    | "remainsPrivate"
    | "linkingIsDeliberate"
    | "linkingCopiesNothing"
    | "exportExcludesPrivate",
    Copy
  >
> = {
  preparationIsPrivate: {
    title: "Your own preparation",
    body: "This record holds preparation you wrote, it may exist without any shared identity, and it is not a contact record for anyone else.",
  },
  noteIsPrivate: {
    title: "A note you wrote",
    body: "It records what you observed or decided, and its audience is private.",
  },
  remainsPrivate: {
    title: "Private text stays where you wrote it",
    body: "A private note or a private preparation record never appears in a shared projection, in an export, or in another record's audience.",
  },
  linkingIsDeliberate: {
    title: "Linking is your decision",
    body: "Connecting a private preparation record to a shared identity is a deliberate act of yours, and it never happens because a name or an address looked the same.",
  },
  linkingCopiesNothing: {
    title: "Linking copies nothing",
    body: "Linking leaves every private word in the preparation record; nothing is copied into the shared record.",
  },
  exportExcludesPrivate: {
    title: "Exports carry shared facts only",
    body: "A roster export contains no private text, so the file you download is not a copy of your preparation.",
  },
};

/** The audience a note shows, with the consequence of that audience made plain. */
export const AUDIENCE_LABEL_COPY: Readonly<
  Record<"private" | "shared", { readonly label: string; readonly description: string }>
> = {
  private: {
    label: "Private",
    description: "Only you can read this line; it is not part of the shared record.",
  },
  shared: {
    label: "Shared",
    description:
      "Other people who can see this record may read this line, so treat it as shared and not as private.",
  },
};

/** The identity rules: six record kinds, and no identity ever inferred from matching details. */
export const IDENTITY_COPY: Readonly<
  Record<
    | "distinctKinds"
    | "equalLooking"
    | "noIdentityFromMatching"
    | "householdIsNotPerson"
    | "representativeIsSeparate"
    | "noJoinKey",
    Copy
  >
> = {
  distinctKinds: {
    title: "Six record kinds",
    body: "A person, a household, a church, an organization, an organization's representative and a private preparation record are six distinct record kinds, and each keeps its own identity.",
  },
  equalLooking: {
    title: "Look-alike details",
    body: "Records that share a name, an email address or a postal address stay separate records.",
  },
  noIdentityFromMatching: {
    title: "What a match does not establish",
    body: "A match on a name or an address establishes neither identity nor authority.",
  },
  householdIsNotPerson: {
    title: "Consent and giving are a person's",
    body: "A household is not a person's consent or giving identity.",
  },
  representativeIsSeparate: {
    title: "A representative stands apart",
    body: "An organization's representative is a separate record from the organization.",
  },
  noJoinKey: {
    title: "How records link",
    body: "Records are linked by their own identifiers, never by the details written on them.",
  },
};

/** What an interaction records, what it is not, and what it never proves. */
export const INTERACTION_COPY: Readonly<
  Record<
    | "whatCounts"
    | "whatDoesNot"
    | "precisionDate"
    | "precisionApproximate"
    | "precisionUnknown"
    | "provesNothing"
    | "recordedOnce",
    Copy
  >
> = {
  whatCounts: {
    title: "What an interaction records",
    body: "An interaction records something that actually happened, with its date or an honest precision, an outcome and the people who took part.",
  },
  whatDoesNot: {
    title: "What is not an interaction",
    body: "A gift, a scheduled task or opening a mail or dialer app is not an interaction.",
  },
  precisionDate: {
    title: "You know the day",
    body: "The interaction is recorded against the day it happened.",
  },
  precisionApproximate: {
    title: "You know roughly when",
    body: "The interaction is recorded as approximate, because a nearer day would be invented rather than known.",
  },
  precisionUnknown: {
    title: "You do not know when",
    body: "The interaction is recorded without a date, and nothing is guessed to fill one in.",
  },
  provesNothing: {
    title: "What a logged interaction does not prove",
    body: `Recording an interaction is not proof of a gift, a payment or a promise kept, and it does not mean work was completed. ${PERMISSION_FACT_COPY.communicationConsent.label} is a separate fact: ${PERMISSION_FACT_COPY.communicationConsent.explanation}`,
  },
  recordedOnce: {
    title: "Recorded once",
    body: "An event a source already recorded appears once, and logging it again would record it twice.",
  },
};

/** What archiving a private preparation record does, and everything it leaves untouched. */
export const ARCHIVE_COPY: Readonly<
  Record<"archiveIsNotDelete" | "restore" | "leavesSharedAlone" | "scope", Copy>
> = {
  archiveIsNotDelete: {
    title: "Archiving hides, it does not delete",
    body: "Archiving takes a private preparation record out of your working lists and deletes nothing, so the record and its text are still there.",
  },
  restore: {
    title: "Restoring brings it back",
    body: "Restoring returns the record to your working lists with its content as you left it.",
  },
  leavesSharedAlone: {
    title: "Nothing else moves",
    body: "Archiving never touches a shared record, an open task, an interaction or any other independent obligation.",
  },
  scope: {
    title: "Private preparation only",
    body: "Archive and restore apply to private preparation records and to nothing else.",
  },
};

/** What each saved-view action does to the stored view and what it leaves alone. */
export const SAVED_VIEW_COPY: Readonly<
  Record<"save" | "update" | "rename" | "delete" | "drift" | "repair" | "leavesRecordsAlone", Copy>
> = {
  save: {
    title: "Save this view",
    body: "Stores your current search, filters, sort, columns and page size under a name you choose; the records themselves are untouched.",
  },
  update: {
    title: "Update this view",
    body: "Replaces what the view stores with the choices on screen now, without writing to any record.",
  },
  rename: {
    title: "Rename this view",
    body: "Changes the view's name and nothing else; the choices it stores stay as they are.",
  },
  delete: {
    title: "Delete this view",
    body: "Removes the stored view; every record, tag and note stays as it was.",
  },
  drift: {
    title: "This view has drifted",
    body: "This saved view refers to a filter that is no longer available; the view and every record are otherwise unchanged.",
  },
  // The states module imports this entry as the saved-view recovery action, so its key
  // name is part of that module's contract.
  repair: {
    title: "Repair this view",
    body: "Saves the selection again so the view matches what is available now; only the view's stored choices change.",
  },
  leavesRecordsAlone: {
    title: "Views store choices, not records",
    body: "No saved-view action writes to a partner record.",
  },
};
