/** Consent: which send outcomes exist and which of them may ever be repeated, the one Off/Immediate decision and the one unsubscribe, whether a membership may be sent to. */
import type { Temporal } from "temporal-polyfill";
import { type AudiencePurpose, type MemberChoice, type MembershipRecord, isExcludedSourceMembership, withChoice } from "@/modules/audience/membership";
export type SendOutcomeState = "accepted" | "failed" | "unknown";
export const SEND_OUTCOME_STATES: readonly SendOutcomeState[] = ["accepted", "failed", "unknown"];
export const mayRepeatIntent = (state: SendOutcomeState): boolean => state === "failed";
export type AddressedMembership = { memberships: readonly MembershipRecord[]; publisherId: string; purpose: AudiencePurpose; recipientId: string };
export type ChoiceChange = AddressedMembership & { choice: MemberChoice };
export type ChoiceChangeResult = { memberships: MembershipRecord[]; changedMembershipId: string | null };
function rewriteOneMembership(input: AddressedMembership, transition: (membership: MembershipRecord) => MembershipRecord): ChoiceChangeResult {
  const index = input.memberships.findIndex((membership) => membership.publisherId === input.publisherId && membership.purpose === input.purpose && membership.recipientId === input.recipientId);
  const addressed = index === -1 ? undefined : input.memberships[index];
  if (addressed === undefined) return { memberships: [...input.memberships], changedMembershipId: null };
  const next = transition(addressed);
  if (next === addressed) return { memberships: [...input.memberships], changedMembershipId: null };
  const memberships = [...input.memberships];
  memberships[index] = next;
  return { memberships, changedMembershipId: next.membershipId };
}
export function applyChoice(input: ChoiceChange, now: Temporal.Instant): ChoiceChangeResult {
  return rewriteOneMembership(input, (membership) => withChoice(membership, input.choice, now));
}
export function unsubscribe(input: AddressedMembership, now: Temporal.Instant): ChoiceChangeResult {
  return rewriteOneMembership(input, (membership) => withChoice(membership, "off", now));
}
// Consent is a chosen state, never an inferred one
/** Whether this membership may receive an immediate notice: the address was deliberately proven and the person asked for Immediate. */
export function hasConsent(membership: MembershipRecord): boolean {
  if (isExcludedSourceMembership(membership)) return false;
  return membership.state === "active" && membership.choice === "immediate" && membership.confirmedAt !== undefined;
}
/** Evidence that does not establish communication consent for this publisher and purpose, however much it looks like it does. */
export type NonConsentEvidence = "subscribed-column" | "contact-edit" | "import-row" | "partner-record" | "language-preference";
export type ConsentEvidence = "explicit-choice" | NonConsentEvidence;
/** The evidence kinds that never establish consent, in the order a surface or a test lists them. */
export const NON_CONSENT_EVIDENCE: readonly NonConsentEvidence[] = ["subscribed-column", "contact-edit", "import-row", "partner-record", "language-preference"];
/** Whether one piece of evidence establishes consent: only `explicit-choice` does, meaning the person themselves selected Immediate for this publisher and purpose and then passed the. */
export const evidenceGrantsConsent = (evidence: ConsentEvidence): boolean => evidence === "explicit-choice";
// One notification intent is identified by four values, not by a fresh attempt
export type IntentIdentity = { publisherId: string; purpose: AudiencePurpose; recipientId: string; intentId: string };
const DEDUPE_KEY_SCHEME = "notice-intent:v1";
type DedupeKey = string & { readonly dedupeKeyOf: "notification-intent" };
const lengthPrefixed = (value: string): string => `${value.length}:${value}`;
export const dedupeKey = (input: IntentIdentity): DedupeKey => [DEDUPE_KEY_SCHEME, lengthPrefixed(input.publisherId), lengthPrefixed(input.purpose), lengthPrefixed(input.recipientId), lengthPrefixed(input.intentId)].join("|") as DedupeKey;
