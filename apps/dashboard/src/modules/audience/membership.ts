/**
 * Membership: the one record of one person's purpose-specific relationship to one publisher's Update
 * email, and the only place the four membership states, the Off/Immediate choice, the language
 * preference and the synthetic confirmation window are decided.
 */
import type { Temporal } from "temporal-polyfill";
import { confirmationDeadline } from "../time/window";
// The purpose, the four states and the two choices
/** The one communication purpose this release keeps memberships for: topic-specific Update email from one publisher. */
export const UPDATE_EMAIL_PURPOSE = "update-email" as const;
/** The only purpose a membership can carry, derived from {@link UPDATE_EMAIL_PURPOSE}. */
export type AudiencePurpose = typeof UPDATE_EMAIL_PURPOSE;
/** The four states a membership can be read in, in the order a surface lists them. */
export const MEMBERSHIP_STATES = ["active", "awaiting-proof", "off", "restricted"] as const;
/** One membership state, derived from {@link MEMBERSHIP_STATES}. */
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
/** The two choices the audience offers for this purpose, in the order a surface lists them; the tuple's length type is exactly 2. */
export const MEMBER_CHOICES = ["off", "immediate"] as const;
/** One member choice, derived from {@link MEMBER_CHOICES}. */
export type MemberChoice = (typeof MEMBER_CHOICES)[number];
/** Why a membership the source supplied is excluded rather than activated. */
export type SourceMembershipDisposition = "held" | "unqualified";
// Scope and the record
/** The organization and ministry authority a membership belongs to, carried by reference from the caller's scope so the record and the read share one authority instead of a copy that could. */
export interface MembershipScope {
  organizationId: string;
  ministryId: string;
}
/** One purpose-specific membership: the record every audience read, preference change, confirmation and notification decision is made from. */
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
// Constructor inputs and command results
/** What a deliberate signup supplies. */
export interface NewMembershipInput {
  membershipId: string;
  scope: MembershipScope;
  publisherId: string;
  purpose?: AudiencePurpose;
  recipientId: string;
  email: string;
  languagePreference: string;
}
/** A source-supplied membership row, which this module can only represent as an excluded record. */
export interface ExcludedSourceMembershipInput extends NewMembershipInput {
  sourceDisposition: SourceMembershipDisposition;
}
/** What the proof step shows immediately after a deliberate signup: a neutral pending result that claims no message was sent. */
export interface PendingProofResult {
  readonly status: "pending";
  readonly claimsMailSent: false;
  readonly nextStep: "confirm-from-the-rendered-message";
}
/** A new membership together with the pending result the proof flow renders beside it. */
export interface NewMembershipResult {
  readonly membership: MembershipRecord;
  readonly proof: PendingProofResult;
}
/** Why an explicit confirmation was refused; each reason is a distinct and honest answer. */
export type ConfirmationRefusalReason = "confirmation-expired" | "not-awaiting-proof" | "source-excluded";
/** The outcome of an explicit confirmation: the record it produced, or the reason it was refused. */
export type ConfirmMembershipResult = { readonly status: "confirmed"; readonly membership: MembershipRecord } | { readonly status: "refused"; readonly reason: ConfirmationRefusalReason };
// The proof journey
/** Opens the proof step for a deliberate signup: `awaiting-proof`, Immediate, an acceptance at `now` and the confirmation deadline that follows from it. */
export function newPendingMembership(input: NewMembershipInput, now: Temporal.Instant): NewMembershipResult {
  const { deadlineInstant } = confirmationDeadline({ acceptedAt: now, now });
  return {
    membership: {
      membershipId: input.membershipId,
      scope: input.scope,
      publisherId: input.publisherId,
      purpose: input.purpose ?? UPDATE_EMAIL_PURPOSE,
      recipientId: input.recipientId,
      email: input.email,
      state: "awaiting-proof",
      choice: "immediate",
      languagePreference: input.languagePreference,
      acceptedAt: now,
      confirmationDeadline: deadlineInstant,
      revision: 1,
    },
    proof: pendingProofResult(),
  };
}
/** The neutral pending result the proof flow renders: pending, with nothing claimed as sent. */
export function pendingProofResult(): PendingProofResult {
  return {
    status: "pending",
    claimsMailSent: false,
    nextStep: "confirm-from-the-rendered-message",
  };
}
/** Whether a confirmation is still open at `now`: only while the record is `awaiting-proof` and `now` is strictly before the deadline the confirmation window computes from the recorded. */
export function isConfirmationOpen(membership: MembershipRecord, now: Temporal.Instant): boolean {
  const { acceptedAt } = membership;
  if (!isAwaitingProofState(membership.state) || acceptedAt === undefined) {
    return false;
  }
  return confirmationDeadline({ acceptedAt, now }).status === "within-window";
}
/** The explicit confirmation command: turns an accepted, still-open membership into an `active` one. */
export function confirmAt(membership: MembershipRecord, now: Temporal.Instant): ConfirmMembershipResult {
  if (isExcludedSourceMembership(membership)) {
    return { status: "refused", reason: "source-excluded" };
  }
  const { acceptedAt } = membership;
  if (!isAwaitingProofState(membership.state) || acceptedAt === undefined) {
    // A record in `awaiting-proof` that recorded no acceptance is refused in the same terms: it is not
    // waiting for proof, because there is no window for a confirmation to fall inside.
    return { status: "refused", reason: "not-awaiting-proof" };
  }
  if (!isConfirmationOpen(membership, now)) {
    return { status: "refused", reason: "confirmation-expired" };
  }
  return {
    status: "confirmed",
    membership: {
      ...membership,
      state: "active",
      confirmedAt: now,
      // `confirmationDeadline` is kept: it is the record of the window this acceptance opened.
      revision: membership.revision + 1,
    },
  };
}
// Preference, held separately from consent
/** Records the Off/Immediate decision, and only that decision. */
export function withChoice(membership: MembershipRecord, choice: MemberChoice, now: Temporal.Instant): MembershipRecord {
  if (isExcludedSourceMembership(membership) || membership.state === "restricted") {
    return membership;
  }
  if (choice === "off") {
    if (membership.state === "off" && membership.choice === "off") {
      return membership;
    }
    return { ...membership, state: "off", choice: "off", revision: membership.revision + 1 };
  }
  // An active membership has already passed proof, whether or not the confirmation instant was
  // recorded; choosing Immediate again reports it as on instead of demoting it to awaiting proof.
  if (membership.confirmedAt !== undefined || membership.state === "active") {
    if (membership.state === "active" && membership.choice === "immediate") {
      return membership;
    }
    return {
      ...membership,
      state: "active",
      choice: "immediate",
      revision: membership.revision + 1,
    };
  }
  if (isConfirmationOpen(membership, now)) {
    return membership.choice === "immediate" ? membership : { ...membership, choice: "immediate", revision: membership.revision + 1 };
  }
  const { deadlineInstant } = confirmationDeadline({ acceptedAt: now, now });
  return {
    ...membership,
    state: "awaiting-proof",
    choice: "immediate",
    acceptedAt: now,
    confirmationDeadline: deadlineInstant,
    revision: membership.revision + 1,
  };
}
/** Records this person's reading language, and nothing else. */
export function withLanguagePreference(membership: MembershipRecord, languagePreference: string): MembershipRecord {
  if (membership.languagePreference === languagePreference) {
    return membership;
  }
  return { ...membership, languagePreference, revision: membership.revision + 1 };
}
// Source-supplied rows are excluded, never activated
/** Represents a membership the source supplied rather than the person: a held or unqualified row is recorded as `off` with its disposition and no acceptance, so the row is visible while no. */
export function excludedSourceMembership(input: ExcludedSourceMembershipInput): MembershipRecord {
  return {
    membershipId: input.membershipId,
    scope: input.scope,
    publisherId: input.publisherId,
    purpose: input.purpose ?? UPDATE_EMAIL_PURPOSE,
    recipientId: input.recipientId,
    email: input.email,
    state: "off",
    choice: "off",
    languagePreference: input.languagePreference,
    sourceDisposition: input.sourceDisposition,
    revision: 1,
  };
}
/** Whether a record is a source-supplied membership that is excluded from every send: the guard every consumer uses instead of activating such a row. */
export function isExcludedSourceMembership(membership: MembershipRecord): membership is MembershipRecord & { sourceDisposition: SourceMembershipDisposition } {
  return membership.sourceDisposition !== undefined;
}
// Closed-union guards
//
// A stored or submitted string narrows to a state or a choice through these guards, so a switch over
// the closed sets stays exhaustive without a second declaration of either set.
/** Whether a state is the one the proof step waits in. */
export function isAwaitingProofState(state: MembershipState): state is "awaiting-proof" {
  return state === "awaiting-proof";
}
/** Whether a submitted value names one of the four membership states. */
export function isMembershipState(value: string): value is MembershipState {
  return MEMBERSHIP_STATES.some((state) => state === value);
}
/** Whether a submitted value names one of the two member choices. */
export function isMemberChoice(value: string): value is MemberChoice {
  return MEMBER_CHOICES.some((choice) => choice === value);
}
