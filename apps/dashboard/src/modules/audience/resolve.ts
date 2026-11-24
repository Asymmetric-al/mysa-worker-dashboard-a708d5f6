import { Temporal } from "temporal-polyfill";
import type { ContentVariant } from "@/modules/content/variant";
import { dedupeKey, hasConsent } from "./consent";
import { isConfirmationOpen, isExcludedSourceMembership, type AudiencePurpose, type MembershipRecord, type MembershipState } from "./membership";
export type ContentAudience = ContentVariant["audience"];
export const EXCLUSION_REASONS = ["restricted", "off", "unsubscribed", "awaiting-proof", "confirmation-expired", "held", "unqualified", "signed-up-after-intent"] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export type EligibleRecipient = { readonly recipientId: string; readonly languagePreference: string; readonly dedupeKey: string };
export type ExcludedRecipient = { readonly recipientId: string; readonly reason: ExclusionReason };
export type EligibilityResult = { readonly eligible: EligibleRecipient[]; readonly excluded: ExcludedRecipient[]; readonly ceilingSaturated: boolean };
export type NotificationIntent = { readonly intentId: string; readonly acceptedAt: Temporal.Instant; readonly ceilingCount?: number };
export type EligibilityInput = { readonly memberships: readonly MembershipRecord[]; readonly publisherId: string; readonly purpose: AudiencePurpose; readonly intent: NotificationIntent; readonly now: Temporal.Instant };
const compareCodeUnits = (left: string, right: string): number => (left === right ? 0 : left < right ? -1 : 1);
const compareMembershipRows = (left: MembershipRecord, right: MembershipRecord): number => compareCodeUnits(left.membershipId, right.membershipId);
function exclusionReasonFor(membership: MembershipRecord, now: Temporal.Instant): ExclusionReason | undefined {
  if (isExcludedSourceMembership(membership)) return membership.sourceDisposition;
  if (membership.state === "restricted") return "restricted";
  return membership.state === "off" ? (membership.confirmedAt === undefined ? "off" : "unsubscribed") : membership.state === "awaiting-proof" ? (isConfirmationOpen(membership, now) ? "awaiting-proof" : "confirmation-expired") : hasConsent(membership) ? undefined : "unqualified";
}
const lateSignupReason = (membership: MembershipRecord, intent: NotificationIntent): ExclusionReason | undefined => (membership.acceptedAt === undefined ? undefined : Temporal.Instant.compare(membership.acceptedAt, intent.acceptedAt) > 0 ? "signed-up-after-intent" : undefined);
/** The recipients who may receive this publisher's notice for `input.intent`, and everyone else on the same publisher and purpose with the reason they may not. */ export function eligibleRecipients(input: EligibilityInput): EligibilityResult {
  const rowsByRecipient = new Map<string, MembershipRecord[]>();
  for (const membership of input.memberships.filter((membership) => membership.publisherId === input.publisherId && membership.purpose === input.purpose)) rowsByRecipient.set(membership.recipientId, [...(rowsByRecipient.get(membership.recipientId) ?? []), membership]);
  const eligible: EligibleRecipient[] = [];
  const excluded: ExcludedRecipient[] = [];
  for (const recipientId of [...rowsByRecipient.keys()].sort(compareCodeUnits)) {
    const rows = (rowsByRecipient.get(recipientId) ?? []).sort(compareMembershipRows);
    const reasons = rows.map((membership) => exclusionReasonFor(membership, input.now) ?? lateSignupReason(membership, input.intent));
    const admittedRow = rows[reasons.indexOf(undefined)];
    const refusal = reasons.find((reason) => reason !== undefined);
    if (admittedRow !== undefined) eligible.push({ recipientId, languagePreference: admittedRow.languagePreference, dedupeKey: dedupeKey({ publisherId: input.publisherId, purpose: input.purpose, recipientId, intentId: input.intent.intentId }) });
    else if (refusal !== undefined) excluded.push({ recipientId, reason: refusal });
  }
  const { ceilingCount } = input.intent;
  return { eligible, excluded, ceilingSaturated: ceilingCount !== undefined && eligible.length > ceilingCount };
}
export type MembershipAccess = { readonly admitted: boolean; readonly state: MembershipState; readonly reason?: ExclusionReason };
/** Whether one membership row admits at `now`, re-evaluated on every read by the receiving preview and the synthetic inbox so a stale row can never grant access. */ export function membershipAccessAt(membership: MembershipRecord, now: Temporal.Instant): MembershipAccess {
  const reason = exclusionReasonFor(membership, now);
  return reason === undefined ? { admitted: true, state: membership.state } : { admitted: false, state: membership.state, reason };
}
