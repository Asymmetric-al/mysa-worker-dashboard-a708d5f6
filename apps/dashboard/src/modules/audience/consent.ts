/**
 * Consent: which send outcomes exist and which of them may ever be repeated, the one Off/Immediate
 * decision and the one unsubscribe, whether a membership may be sent to, and the identity under which
 * a notification intent is deduplicated.
 */
import type { Temporal } from "temporal-polyfill";
import { type AudiencePurpose, type MemberChoice, type MembershipRecord, isExcludedSourceMembership, withChoice } from "@/modules/audience/membership";
// Send outcomes: the three states a send attempt can be recorded in
/** The three states one send attempt can be recorded in. */
export type SendOutcomeState = "accepted" | "failed" | "unknown";
/** The three send states in the order a surface lists them; a fourth member does not typecheck. */
export const SEND_OUTCOME_STATES: readonly SendOutcomeState[] = ["accepted", "failed", "unknown"];
/** Whether one recorded send state may ever be attempted again for the same intent. */
export function mayRepeatIntent(state: SendOutcomeState): boolean {
  return state === "failed";
}
// The Off/Immediate decision and the unsubscribe: one membership at a time
/** The membership a choice change addresses: one publisher, one purpose, one recipient. */
export interface AddressedMembership {
  memberships: readonly MembershipRecord[];
  publisherId: string;
  purpose: AudiencePurpose;
  recipientId: string;
}
/** A choice change: the addressed membership plus the choice the person made. */
export interface ChoiceChange extends AddressedMembership {
  choice: MemberChoice;
}
/** The result of a choice change: the memberships as they now stand, and the identifier of the one record that actually changed. */
export interface ChoiceChangeResult {
  memberships: MembershipRecord[];
  changedMembershipId: string | null;
}
function rewriteOneMembership(input: AddressedMembership, transition: (membership: MembershipRecord) => MembershipRecord): ChoiceChangeResult {
  const index = input.memberships.findIndex((membership) => membership.publisherId === input.publisherId && membership.purpose === input.purpose && membership.recipientId === input.recipientId);
  const addressed = index === -1 ? undefined : input.memberships[index];
  if (addressed === undefined) {
    return { memberships: [...input.memberships], changedMembershipId: null };
  }
  const next = transition(addressed);
  if (next === addressed) {
    return { memberships: [...input.memberships], changedMembershipId: null };
  }
  const memberships = [...input.memberships];
  memberships[index] = next;
  return { memberships, changedMembershipId: next.membershipId };
}
/** Records the person's Off or Immediate decision for one publisher and one purpose, and nothing else. */
export function applyChoice(input: ChoiceChange, now: Temporal.Instant): ChoiceChangeResult {
  return rewriteOneMembership(input, (membership) => withChoice(membership, input.choice, now));
}
/** Turns one person's membership for one publisher and one purpose off, and touches nothing else: a membership for another publisher, and a membership for another purpose, is returned. */
export function unsubscribe(input: AddressedMembership, now: Temporal.Instant): ChoiceChangeResult {
  return rewriteOneMembership(input, (membership) => withChoice(membership, "off", now));
}
// Consent is a chosen state, never an inferred one
/** Whether this membership may receive an immediate notice: the address was deliberately proven and the person asked for Immediate. */
export function hasConsent(membership: MembershipRecord): boolean {
  if (isExcludedSourceMembership(membership)) {
    return false;
  }
  return membership.state === "active" && membership.choice === "immediate" && membership.confirmedAt !== undefined;
}
/** Evidence that does not establish communication consent for this publisher and purpose, however much it looks like it does. */
export type NonConsentEvidence = "subscribed-column" | "contact-edit" | "import-row" | "partner-record" | "language-preference";
/** Everything the application can hold as evidence about consent for one publisher and purpose. */
export type ConsentEvidence = "explicit-choice" | NonConsentEvidence;
/** The evidence kinds that never establish consent, in the order a surface or a test lists them. */
export const NON_CONSENT_EVIDENCE: readonly NonConsentEvidence[] = ["subscribed-column", "contact-edit", "import-row", "partner-record", "language-preference"];
/** Whether one piece of evidence establishes consent: only `explicit-choice` does, meaning the person themselves selected Immediate for this publisher and purpose and then passed the. */
export function evidenceGrantsConsent(evidence: ConsentEvidence): boolean {
  return evidence === "explicit-choice";
}
// One notification intent is identified by four values, not by a fresh attempt
/** The four values that identify one notification intent for one recipient on one purpose. */
export interface IntentIdentity {
  publisherId: string;
  purpose: AudiencePurpose;
  recipientId: string;
  intentId: string;
}
const DEDUPE_KEY_SCHEME = "notice-intent:v1";

type DedupeKey = string & { readonly dedupeKeyOf: "notification-intent" };

function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}
/** The identity under which one publisher's notification intent for one recipient is deduplicated: publisher + purpose + recipient + intent, in that order. */
export function dedupeKey(input: IntentIdentity): DedupeKey {
  return [DEDUPE_KEY_SCHEME, lengthPrefixed(input.publisherId), lengthPrefixed(input.purpose), lengthPrefixed(input.recipientId), lengthPrefixed(input.intentId)].join("|") as DedupeKey;
}
