import { UPDATE_EMAIL_PURPOSE, type AudiencePurpose, type MembershipState } from "@/modules/audience/membership";
import type { ExclusionReason } from "@/modules/audience/resolve";
export const MEMBERSHIP_STATE_DESCRIPTIONS: Record<MembershipState, { readonly description: string; readonly eligibleSuffix: string }> = {
  active: {
    description: "Confirmed their email address and opted in to your ministry update emails.",
    eligibleSuffix: "will receive update emails",
  },
  "awaiting-proof": {
    description: "Requested update emails, but hasn’t confirmed their email address yet. No emails are sent until they confirm.",
    eligibleSuffix: "waiting for email confirmation",
  },
  off: {
    description: "Turned off update emails for your ministry. Their other subscriptions and partner record remain unchanged.",
    eligibleSuffix: "turned off by subscriber",
  },
  restricted: {
    description: "Excluded by an account restriction rather than a subscriber preference. Never silently reactivated.",
    eligibleSuffix: "excluded by restriction",
  },
};
export const EXCLUSION_REASON_COPY: Record<ExclusionReason, string> = {
  restricted: "Excluded by a restriction (not a subscriber choice).",
  off: "Turned off by the subscriber for your update emails.",
  unsubscribed: "Previously confirmed, then unsubscribed from your update emails.",
  "awaiting-proof": "Email address hasn’t been confirmed yet.",
  "confirmation-expired": "The confirmation window expired before confirmation. Reloading or resending doesn’t extend an expired link.",
  held: "Held back by the source system and never silently activated.",
  unqualified: "Not eligible for update emails under current rules.",
  "signed-up-after-intent": "Signed up after this send began, so they’ll start receiving future updates instead.",
};
export const ELIGIBLE_HEADING = "Will receive update emails";
export const EXCLUDED_HEADING = "Excluded from update emails";
export const PURPOSE_LABEL: Record<AudiencePurpose, string> = { [UPDATE_EMAIL_PURPOSE]: "Update emails" };
export const MEMBERSHIP_COLUMN_HEADINGS: { readonly caption: string; readonly identity: string; readonly emailValue: string; readonly state: string; readonly languagePreference: string; readonly purpose: string; readonly since: string; readonly exclusionReason: string } = {
  caption: "Subscribers and exclusions for your update emails",
  identity: "Person",
  emailValue: "Email address",
  state: "Status",
  languagePreference: "Preferred language",
  purpose: "List",
  since: "Since",
  exclusionReason: "Reason excluded",
};
export const NOT_CONSENT_STATEMENT = "Adding a contact, importing a spreadsheet, or editing an email address never subscribes someone automatically — partners must confirm their own consent.";
