import { UPDATE_EMAIL_PURPOSE, type AudiencePurpose, type MembershipState } from "@/modules/audience/membership";
import type { ExclusionReason } from "@/modules/audience/resolve";
type MembershipStateDescription = { readonly description: string; readonly eligibleSuffix: string };
export const MEMBERSHIP_STATE_DESCRIPTIONS: Record<MembershipState, MembershipStateDescription> = {
  active: {
    description: "This person consented to this publisher's Update email for this purpose and confirmed the address, so the membership is active. That consent covers this publisher and this purpose only, and it is not contact permission for anything else.",
    eligibleSuffix: "eligible for this publisher and this purpose",
  },
  "awaiting-proof": {
    description: "This person asked to receive this publisher's notices for this purpose, and the address is not proven yet. The membership is therefore neither consent nor eligible: eligibility begins only after the person confirms the address explicitly.",
    eligibleSuffix: "not eligible until the address is confirmed",
  },
  off: { description: "This person chose Off for this publisher's Update email for this purpose. The choice covers this publisher and this purpose only, so other publishers, other purposes and the person's other records are unchanged.", eligibleSuffix: "not eligible, because the person chose Off" },
  restricted: {
    description: "A restriction excludes this membership from this publisher's Update email for this purpose. A restricted membership is never silently re-activated, and a restriction is a limitation rather than a preference, so no hidden record is implied.",
    eligibleSuffix: "not eligible, because a restriction applies",
  },
};
export const EXCLUSION_REASON_COPY: Record<ExclusionReason, string> = {
  restricted: "A restriction excludes this person from this publisher's Update email for this purpose, and a restriction is not a preference the person made.",
  off: "The person's own Off choice for this publisher and this purpose excludes this membership, and that choice is not a restriction.",
  unsubscribed: "The person unsubscribed from this publisher and this purpose, which is a different history from an address that was never confirmed: the address had been confirmed and the person then turned these notices off.",
  "awaiting-proof": "The address is unconfirmed, so there is no consent and no eligibility yet; eligibility begins only after an explicit confirmation.",
  "confirmation-expired": "The confirmation window closed without an explicit confirmation, and reloading the page, retrying or resending the message never extends it.",
  held: "The source system holds this row back, so it is excluded and never silently activated.",
  unqualified: "This row does not qualify for this publisher's Update email for this purpose, so it is excluded and never silently activated.",
  "signed-up-after-intent": "This person signed up after this notification's intent was accepted, and a late signup never expands an accepted ceiling, so this signup is not part of this send.",
};
export const ELIGIBLE_HEADING = "Eligible for this purpose";
export const EXCLUDED_HEADING = "Excluded from this purpose";
export const PURPOSE_LABEL: Record<AudiencePurpose, string> = { [UPDATE_EMAIL_PURPOSE]: "Update email" };
type MembershipColumnHeadingSet = { readonly caption: string; readonly identity: string; readonly emailValue: string; readonly state: string; readonly languagePreference: string; readonly purpose: string; readonly since: string; readonly exclusionReason: string };
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
export const NOT_CONSENT_STATEMENT = "A subscribed-style flag, an imported row, a contact edit or an existing partner record is not consent to receive this publisher's Update email for this purpose.";
