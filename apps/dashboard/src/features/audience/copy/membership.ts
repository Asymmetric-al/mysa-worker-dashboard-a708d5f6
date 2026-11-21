/**
 * The Audience family's words for what a membership is: the four states one person's purpose-specific
 * relationship to one publisher's Update email can be read in, the eight reasons a member of that
 * audience receives no notice, the two dispositions a source system places on a row it supplies, the
 * two headings the counts sit under, the human name of the purpose, the membership table's headings,
 * and the statement that a subscribed-style flag is not consent.
 */
import { NON_CONSENT_EVIDENCE, type NonConsentEvidence } from "@/modules/audience/consent";
import { UPDATE_EMAIL_PURPOSE, type AudiencePurpose, type MembershipState, type SourceMembershipDisposition } from "@/modules/audience/membership";
import type { ExclusionReason } from "@/modules/audience/resolve";
// The four membership states
type MembershipStateDescription = {
  readonly description: string;
  readonly eligibleSuffix: string;
};
/** The four states, in the order `@/modules/audience/membership` declares them, each explained once. */
export const MEMBERSHIP_STATE_DESCRIPTIONS: Record<MembershipState, MembershipStateDescription> = {
  active: {
    description:
      "This person consented to this publisher's Update email for this purpose and confirmed the address, so the membership is active. That consent covers this publisher and this purpose only, and it is not contact permission for anything else.",
    eligibleSuffix: "eligible for this publisher and this purpose",
  },
  "awaiting-proof": {
    description:
      "This person asked to receive this publisher's notices for this purpose, and the address is not proven yet. The membership is therefore neither consent nor eligible: eligibility begins only after the person confirms the address explicitly.",
    eligibleSuffix: "not eligible until the address is confirmed",
  },
  off: {
    description:
      "This person chose Off for this publisher's Update email for this purpose. The choice covers this publisher and this purpose only, so other publishers, other purposes and the person's other records are unchanged.",
    eligibleSuffix: "not eligible, because the person chose Off",
  },
  restricted: {
    description:
      "A restriction excludes this membership from this publisher's Update email for this purpose. A restricted membership is never silently re-activated, and a restriction is a limitation rather than a preference, so no hidden record is implied.",
    eligibleSuffix: "not eligible, because a restriction applies",
  },
};
// Why one member of the audience receives no notice
/** The eight exclusion reasons, each a sentence that cannot be mistaken for another. */
export const EXCLUSION_REASON_COPY: Record<ExclusionReason, string> = {
  restricted: "A restriction excludes this person from this publisher's Update email for this purpose, and a restriction is not a preference the person made.",
  off: "The person's own Off choice for this publisher and this purpose excludes this membership, and that choice is not a restriction.",
  unsubscribed:
    "The person unsubscribed from this publisher and this purpose, which is a different history from an address that was never confirmed: the address had been confirmed and the person then turned these notices off.",
  "awaiting-proof": "The address is unconfirmed, so there is no consent and no eligibility yet; eligibility begins only after an explicit confirmation.",
  "confirmation-expired": "The confirmation window closed without an explicit confirmation, and reloading the page, retrying or resending the message never extends it.",
  held: "The source system holds this row back, so it is excluded and never silently activated.",
  unqualified: "This row does not qualify for this publisher's Update email for this purpose, so it is excluded and never silently activated.",
  "signed-up-after-intent": "This person signed up after this notification's intent was accepted, and a late signup never expands an accepted ceiling, so this signup is not part of this send.",
};
// The two dispositions a source system places on a row it supplies
/** `held` and `unqualified` in the source system's own terms, so a surface can explain a row it did not create without translating the source's judgement into the person's wishes. */
export const SOURCE_DISPOSITION_COPY: Record<SourceMembershipDisposition, string> = {
  held: "The source system holds this row back: the membership is excluded, it is never silently activated, and the disposition says nothing about what the person wants.",
  unqualified:
    "The source system does not qualify this row for this purpose: the membership is excluded, it is never silently activated, and the disposition says nothing about what the person wants.",
};
// The two headings the counts sit under, and the purpose's own name
/** The heading over the memberships the service counted as eligible for this publisher and purpose. */
export const ELIGIBLE_HEADING = "Eligible for this purpose";
/** The heading over the memberships the service excluded, whose reasons `EXCLUSION_REASON_COPY` explains one by one. */
export const EXCLUDED_HEADING = "Excluded from this purpose";
/** The human name of each purpose, keyed by the constant `@/modules/audience/membership` declares rather than by a retyped string, so a second purpose added there fails to compile here until. */
export const PURPOSE_LABEL: Record<AudiencePurpose, string> = {
  [UPDATE_EMAIL_PURPOSE]: "Update email",
};
// The membership table's headings
type MembershipColumnHeadingSet = {
  readonly caption: string;
  readonly identity: string;
  readonly emailValue: string;
  readonly state: string;
  readonly languagePreference: string;
  readonly purpose: string;
  readonly since: string;
  readonly exclusionReason: string;
};
/** The headings, each stating the fact it labels in the terms the domain keeps. */
export const MEMBERSHIP_COLUMN_HEADINGS: MembershipColumnHeadingSet = {
  caption: "Memberships of this publisher's Update email for this purpose",
  identity: "Person",
  emailValue: "Email address (a value only, never a match)",
  state: "State",
  languagePreference: "Language preference (not consent)",
  purpose: "Purpose",
  since: "Recorded since",
  exclusionReason: "Reason for exclusion",
};
// A subscribed-style flag is not consent
/** The one sentence the audience view states beside its counts, so a reader never has to infer why a contact they can see does not appear among the eligible memberships. */
export const NOT_CONSENT_STATEMENT = "A subscribed-style flag, an imported row, a contact edit or an existing partner record is not consent to receive this publisher's Update email for this purpose.";

const NON_CONSENT_HINT_COPY: Record<NonConsentEvidence, string> = {
  "subscribed-column": "A subscribed column that arrived with a source row is a value in that row. The application records it and never treats it as consent.",
  "contact-edit": "A contact created or edited in this application holds what a worker entered, and editing a permitted field is never consent to receive notices.",
  "import-row": "An accepted import row creates or reuses a contact, and no imported row subscribes anyone to this publisher's Update email.",
  "partner-record": "A partner record exists for the work it supports, and neither its existence nor anything a relationship suggests is consent.",
  "language-preference": "A language preference describes how a person reads. Choosing a language is not consent to receive notices and does not prove the address can be read.",
};
/** The hints in the order `NON_CONSENT_EVIDENCE` declares them, derived from that declaration rather than listed again, so the words shown and the decision the consent module makes cannot. */
export const NON_CONSENT_HINTS: readonly string[] = Object.freeze(NON_CONSENT_EVIDENCE.map((evidence) => NON_CONSENT_HINT_COPY[evidence]));
