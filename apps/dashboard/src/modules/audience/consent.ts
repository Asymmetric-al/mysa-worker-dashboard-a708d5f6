import type { Temporal } from "temporal-polyfill";
import { isExcludedSourceMembership, withChoice, type AudiencePurpose, type MembershipRecord } from "@/modules/audience/membership";
export type SendOutcomeState = "accepted" | "failed" | "unknown";
export const SEND_OUTCOME_STATES: readonly SendOutcomeState[] = ["accepted", "failed", "unknown"];
export const mayRepeatIntent = (state: SendOutcomeState): boolean => state === "failed";
export type AddressedMembership = { memberships: readonly MembershipRecord[]; publisherId: string; purpose: AudiencePurpose; recipientId: string };
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
export const unsubscribe = (input: AddressedMembership, now: Temporal.Instant): ChoiceChangeResult => rewriteOneMembership(input, (membership) => withChoice(membership, "off", now));
/** Whether this membership may receive an immediate notice: the address was deliberately proven and the person asked for Immediate. */
export const hasConsent = (membership: MembershipRecord): boolean => (isExcludedSourceMembership(membership) ? false : membership.state === "active" && membership.choice === "immediate" && membership.confirmedAt !== undefined);
export type IntentIdentity = { publisherId: string; purpose: AudiencePurpose; recipientId: string; intentId: string };
const DEDUPE_KEY_SCHEME = "notice-intent:v1";
type DedupeKey = string & { readonly dedupeKeyOf: "notification-intent" };
const lengthPrefixed = (value: string): string => `${value.length}:${value}`;
export const dedupeKey = (input: IntentIdentity): DedupeKey => [DEDUPE_KEY_SCHEME, lengthPrefixed(input.publisherId), lengthPrefixed(input.purpose), lengthPrefixed(input.recipientId), lengthPrefixed(input.intentId)].join("|") as DedupeKey;
