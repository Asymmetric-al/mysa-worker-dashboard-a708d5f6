import type { Temporal } from "temporal-polyfill";
import { confirmationDeadline } from "../time/window";
export const UPDATE_EMAIL_PURPOSE = "update-email" as const;
export type AudiencePurpose = typeof UPDATE_EMAIL_PURPOSE;
export const MEMBERSHIP_STATES = ["active", "awaiting-proof", "off", "restricted"] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export const MEMBER_CHOICES = ["off", "immediate"] as const;
export type MemberChoice = (typeof MEMBER_CHOICES)[number];
export type SourceMembershipDisposition = "held" | "unqualified";
export type MembershipScope = { organizationId: string; ministryId: string };
export interface MembershipRecord {
  membershipId: string;
  scope: MembershipScope;
  publisherId: string;
  purpose: AudiencePurpose;
  recipientId: string;
  email: string;
  state: MembershipState;
  choice: MemberChoice;
  languagePreference: string;
  acceptedAt?: Temporal.Instant;
  confirmedAt?: Temporal.Instant;
  confirmationDeadline?: Temporal.Instant;
  sourceDisposition?: SourceMembershipDisposition;
  revision: number;
}
export type NewMembershipInput = { membershipId: string; scope: MembershipScope; publisherId: string; purpose?: AudiencePurpose; recipientId: string; email: string; languagePreference: string };
const membershipIdentity = (input: NewMembershipInput): Pick<MembershipRecord, "membershipId" | "scope" | "publisherId" | "purpose" | "recipientId" | "email" | "languagePreference"> => ({
  membershipId: input.membershipId,
  scope: input.scope,
  publisherId: input.publisherId,
  purpose: input.purpose ?? UPDATE_EMAIL_PURPOSE,
  recipientId: input.recipientId,
  email: input.email,
  languagePreference: input.languagePreference,
});
export type ExcludedSourceMembershipInput = NewMembershipInput & { sourceDisposition: SourceMembershipDisposition };
export type PendingProofResult = { readonly status: "pending"; readonly claimsMailSent: false; readonly nextStep: "confirm-from-the-rendered-message" };
export type NewMembershipResult = { readonly membership: MembershipRecord; readonly proof: PendingProofResult };
export type ConfirmationRefusalReason = "confirmation-expired" | "not-awaiting-proof" | "source-excluded";
export type ConfirmMembershipResult = { readonly status: "confirmed"; readonly membership: MembershipRecord } | { readonly status: "refused"; readonly reason: ConfirmationRefusalReason };
/** Opens the proof step for a deliberate signup: `awaiting-proof`, Immediate, an acceptance at `now` and the confirmation deadline that follows from it. */
export function newPendingMembership(input: NewMembershipInput, now: Temporal.Instant): NewMembershipResult {
  const { deadlineInstant } = confirmationDeadline({ acceptedAt: now, now });
  return { membership: { ...membershipIdentity(input), state: "awaiting-proof", choice: "immediate", acceptedAt: now, confirmationDeadline: deadlineInstant, revision: 1 }, proof: pendingProofResult() };
}
export const pendingProofResult = (): PendingProofResult => ({ status: "pending", claimsMailSent: false, nextStep: "confirm-from-the-rendered-message" });
/** Whether a confirmation is still open at `now`: only while the record is `awaiting-proof` and `now` is strictly before the deadline the confirmation window computes from the recorded. */
export const isConfirmationOpen = (membership: MembershipRecord, now: Temporal.Instant): boolean => (!isAwaitingProofState(membership.state) || membership.acceptedAt === undefined ? false : confirmationDeadline({ acceptedAt: membership.acceptedAt, now }).status === "within-window");
export function confirmAt(membership: MembershipRecord, now: Temporal.Instant): ConfirmMembershipResult {
  if (isExcludedSourceMembership(membership)) return { status: "refused", reason: "source-excluded" };
  const { acceptedAt } = membership;
  if (!isAwaitingProofState(membership.state) || acceptedAt === undefined) return { status: "refused", reason: "not-awaiting-proof" };
  return !isConfirmationOpen(membership, now) ? { status: "refused", reason: "confirmation-expired" } : { status: "confirmed", membership: { ...membership, state: "active", confirmedAt: now, revision: membership.revision + 1 } };
}
/** Records the Off/Immediate decision, and only that decision. */ export function withChoice(membership: MembershipRecord, choice: MemberChoice, now: Temporal.Instant): MembershipRecord {
  if (isExcludedSourceMembership(membership) || membership.state === "restricted") return membership;
  if (choice === "off") return membership.state === "off" && membership.choice === "off" ? membership : { ...membership, state: "off", choice: "off", revision: membership.revision + 1 };
  if (membership.confirmedAt !== undefined || membership.state === "active") return membership.state === "active" && membership.choice === "immediate" ? membership : { ...membership, state: "active", choice: "immediate", revision: membership.revision + 1 };
  if (isConfirmationOpen(membership, now)) return membership.choice === "immediate" ? membership : { ...membership, choice: "immediate", revision: membership.revision + 1 };
  const { deadlineInstant } = confirmationDeadline({ acceptedAt: now, now });
  return { ...membership, state: "awaiting-proof", choice: "immediate", acceptedAt: now, confirmationDeadline: deadlineInstant, revision: membership.revision + 1 };
}
export const withLanguagePreference = (membership: MembershipRecord, languagePreference: string): MembershipRecord => (membership.languagePreference === languagePreference ? membership : { ...membership, languagePreference, revision: membership.revision + 1 });
/** Represents a membership the source supplied rather than the person: a held or unqualified row is recorded as `off` with its disposition and no acceptance, so the row is visible while no send may treat it as the person's own. */
export const excludedSourceMembership = (input: ExcludedSourceMembershipInput): MembershipRecord => ({ ...membershipIdentity(input), state: "off", choice: "off", sourceDisposition: input.sourceDisposition, revision: 1 });
/** Whether a record is a source-supplied membership that is excluded from every send: the guard every consumer uses instead of activating such a row. */
export const isExcludedSourceMembership = (membership: MembershipRecord): membership is MembershipRecord & { sourceDisposition: SourceMembershipDisposition } => membership.sourceDisposition !== undefined;
export const isAwaitingProofState = (state: MembershipState): state is "awaiting-proof" => state === "awaiting-proof";
export const isMembershipState = (value: string): value is MembershipState => MEMBERSHIP_STATES.some((state) => state === value);
export const isMemberChoice = (value: string): value is MemberChoice => MEMBER_CHOICES.some((choice) => choice === value);
