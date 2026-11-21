/**
 * Membership: the one record of one person's purpose-specific relationship to one publisher's
 * Update email, and the only place the four membership states, the Off/Immediate choice, the
 * language preference and the synthetic confirmation window are decided.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Audience module" row: `src/modules/audience/{membership,consent,resolve}.ts`, consumed
 *   by `data-service/reads/audience.ts`, `data-service/mutations/audience.ts`,
 *   `mutations/content.ts#requestNotification`, `content/notice.ts` and `features/audience`. This file
 *   is the membership half; whether a send is consented is `consent.ts`'s answer, and
 *   recipient-to-rendition resolution is `resolve.ts`'s.
 * - AAP 0.6.2 "Membership and preference" record: `membershipId`, `email` (a value, never a join
 *   key), `publisherId`, `purpose`, `state` of `active | awaiting-proof | off | restricted`,
 *   `acceptedAt`, `confirmationDeadline` and `languagePreference`, with identity being publisher plus
 *   purpose plus recipient inside one scope.
 * - AAP 0.8.5 consent and notification rows: the audience offers only Off and Immediate; membership
 *   states are exactly those four; held or unqualified source memberships are excluded and never
 *   silently activated; a source `subscribed` flag is not consent; a language choice is separate from
 *   the choice and from proof of email possession, and changing it neither subscribes nor resets a
 *   notification intent; confirmation expiry is strict at equality, and reload, retry and resend never
 *   extend it.
 * - AAP 0.8.7 "Confirmation expiry": one week of elapsed hours after acceptance, strict at equality.
 *   That quantity is declared once in `time/window.ts` (`CONFIRMATION_WINDOW_HOURS`) and this module
 *   never restates or recomputes it: it calls `confirmationDeadline` and takes the instant returned.
 * - AAP 0.9.1 repository tree and the 0.11.1 deliverable row for this file; acceptance criterion 10,
 *   proven by `tests/domain/confirmation-window.test.ts`, `tests/integration/notification-dedupe.test.ts`,
 *   `e2e/consent-notification.spec.ts` and `e2e/delivery-recovery.spec.ts`.
 *
 * Five facts stay five facts here. The membership state, the communication consent a send requires
 * (`consent.ts`), the language preference, the contact methods a partner record holds and a
 * protected-content reader grant (`data-service/authorize.ts#canReadProtected`) are separate answers
 * evaluated separately. An `active` membership is not thereby contactable, not consented for another
 * purpose and not entitled to read protected content, and a language preference is never an act of
 * consent. Publication, notification submission, provider acceptance, delivery and reading are five
 * further separate outcomes: nothing here claims that a message left the application, that it reached
 * anyone, or that it was opened.
 *
 * The proof journey is synthetic, and `pendingProofResult()` states that in its own shape — the
 * pending result carries `claimsMailSent: false` — because the confirmation message is rendered by
 * this application and no mail is submitted anywhere. Encoding it structurally means no surface can
 * present the pending step as a sent message.
 *
 * The record's revision is its change counter: every function below that returns a changed record
 * advances it by one, so a caller writing back with the revision it read has a stale write detected.
 * The revision carries no consent meaning of any kind. A function that changes nothing returns the
 * record it was given, by reference, which is how a caller detects a no-op without a second flag.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. It
 * imports the `Instant` type and `time/window`'s confirmation deadline only: no clock read (`now` is
 * always a parameter, so a call site that omits it does not compile), no store, no data service, no
 * content module, no feature, no component, no generated identifier and no I/O. Every identifier it
 * stores arrives from the caller, and none is derived from an email address, because an equal-looking
 * address establishes neither identity nor consent.
 */
import type { Temporal } from "temporal-polyfill";

import { confirmationDeadline } from "../time/window";

// ---------------------------------------------------------------------------------------------
// The purpose, the four states and the two choices
// ---------------------------------------------------------------------------------------------

/**
 * The one communication purpose this release keeps memberships for: topic-specific Update email from
 * one publisher. Closed on purpose — a second purpose (announcements, appeals, a digest) is a product
 * change carrying its own consent, not a configuration value.
 */
export const UPDATE_EMAIL_PURPOSE = "update-email" as const;

/** The only purpose a membership can carry, derived from {@link UPDATE_EMAIL_PURPOSE}. */
export type AudiencePurpose = typeof UPDATE_EMAIL_PURPOSE;

/**
 * The four states a membership can be read in, in the order a surface lists them. The tuple is the
 * single declaration of the union — its length type is exactly 4 — so a fifth state cannot be added
 * in one place only.
 *
 * The states are not interchangeable judgements. `awaiting-proof` is an acceptance still waiting for
 * the person's confirmation, `off` is a choice the person made, and `restricted` is a limitation the
 * source imposed; that is why a restricted membership is never turned on by a preference change.
 */
export const MEMBERSHIP_STATES = ["active", "awaiting-proof", "off", "restricted"] as const;

/** One membership state, derived from {@link MEMBERSHIP_STATES}. */
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

/**
 * The two choices the audience offers for this purpose, in the order a surface lists them; the
 * tuple's length type is exactly 2. There is no third choice: no digest, no cadence, no weekly
 * summary and no "occasionally", because a cadence would need its own consent and its own scheduling
 * of an effect this release deliberately does not perform.
 */
export const MEMBER_CHOICES = ["off", "immediate"] as const;

/** One member choice, derived from {@link MEMBER_CHOICES}. */
export type MemberChoice = (typeof MEMBER_CHOICES)[number];

/**
 * Why a membership the source supplied is excluded rather than activated.
 *
 * `held` is a row the source itself withholds — a suppressed or unverifiable address — and
 * `unqualified` is a row that cannot establish consent for this publisher and purpose. Either way the
 * row is represented without producing consent, and no preference change activates it.
 */
export type SourceMembershipDisposition = "held" | "unqualified";

// ---------------------------------------------------------------------------------------------
// Scope and the record
// ---------------------------------------------------------------------------------------------

/**
 * The organization and ministry authority a membership belongs to, carried by reference from the
 * caller's scope so the record and the read share one authority instead of a copy that could drift.
 */
export interface MembershipScope {
  organizationId: string;
  ministryId: string;
}

/**
 * One purpose-specific membership: the record every audience read, preference change, confirmation
 * and notification decision is made from.
 *
 * Identity is `publisherId` + `purpose` + `recipientId` inside `scope`. `email` is the address this
 * person wants mail sent to and is never a join key, so two records holding the same address remain
 * two memberships in two scopes, and an address by itself establishes neither identity nor consent.
 */
export interface MembershipRecord {
  membershipId: string;
  scope: MembershipScope;
  /** The publisher whose Update this membership is for: one publisher per purpose, never a shared list. */
  publisherId: string;
  purpose: AudiencePurpose;
  /** This person's own opaque identifier inside the scope; never an email address and never a name. */
  recipientId: string;
  /** The address as a value only. An equal-looking address establishes neither identity nor consent. */
  email: string;
  state: MembershipState;
  choice: MemberChoice;
  /**
   * BCP-47 tag for this person's reading, independent of `choice` and of proof. Changing it neither
   * subscribes nor unsubscribes, does not restart a confirmation window, and cannot substitute the
   * rendition already pinned on a notification accepted earlier.
   */
  languagePreference: string;
  /** When the person deliberately accepted the membership. Its only reader is the confirmation window. */
  acceptedAt?: Temporal.Instant;
  /** When the address was confirmed through the explicit confirmation step. */
  confirmedAt?: Temporal.Instant;
  /**
   * The frozen end of the acceptance window, recorded for display. Whether the window is still open
   * is decided by recomputing `time/window.ts#confirmationDeadline` from `acceptedAt`, so a stored
   * value can never widen the window it was written from.
   */
  confirmationDeadline?: Temporal.Instant;
  /**
   * Set when the source supplies the row instead of the person. Present means the record is excluded
   * and is never activated by a preference change or a confirmation.
   */
  sourceDisposition?: SourceMembershipDisposition;
  /** Change counter for optimistic concurrency. Advanced by every function that changes the record. */
  revision: number;
}

// ---------------------------------------------------------------------------------------------
// Constructor inputs and command results
// ---------------------------------------------------------------------------------------------

/**
 * What a deliberate signup supplies. The caller owns every identifier, `membershipId` included, so
 * this module generates and guesses nothing; the acceptance instant is passed separately because it
 * is the instant the command ran, not a value the payload may choose.
 */
export interface NewMembershipInput {
  membershipId: string;
  scope: MembershipScope;
  publisherId: string;
  /** Defaults to {@link UPDATE_EMAIL_PURPOSE}, the only purpose this release keeps memberships for. */
  purpose?: AudiencePurpose;
  recipientId: string;
  email: string;
  languagePreference: string;
}

/** A source-supplied membership row, which this module can only represent as an excluded record. */
export interface ExcludedSourceMembershipInput extends NewMembershipInput {
  /** Why the source row is excluded: `held` (the source withholds the address) or `unqualified`. */
  sourceDisposition: SourceMembershipDisposition;
}

/**
 * What the proof step shows immediately after a deliberate signup: a neutral pending result that
 * claims no message was sent. `nextStep` names the only way forward, which is confirming from the
 * message this application renders itself.
 */
export interface PendingProofResult {
  readonly status: "pending";
  /** Always false: this application submits no mail, so nothing can be reported as sent. */
  readonly claimsMailSent: false;
  readonly nextStep: "confirm-from-the-rendered-message";
}

/** A new membership together with the pending result the proof flow renders beside it. */
export interface NewMembershipResult {
  readonly membership: MembershipRecord;
  readonly proof: PendingProofResult;
}

/** Why an explicit confirmation was refused; each reason is a distinct and honest answer. */
export type ConfirmationRefusalReason =
  /** The window closed: at the exact deadline instant the confirmation is already too late. */
  | "confirmation-expired"
  /** Not waiting for proof: already active, off, restricted, or never accepted at all. */
  | "not-awaiting-proof"
  /** A source-supplied membership is excluded, and no preference or confirmation turns it on. */
  | "source-excluded";

/** The outcome of an explicit confirmation: the record it produced, or the reason it was refused. */
export type ConfirmMembershipResult =
  | { readonly status: "confirmed"; readonly membership: MembershipRecord }
  | { readonly status: "refused"; readonly reason: ConfirmationRefusalReason };

// ---------------------------------------------------------------------------------------------
// The proof journey
// ---------------------------------------------------------------------------------------------

/**
 * Opens the proof step for a deliberate signup: `awaiting-proof`, Immediate, an acceptance at `now`
 * and the confirmation deadline that follows from it.
 *
 * The deadline comes from `time/window.ts`, never from arithmetic here, so the elapsed-hour rule and
 * its strict-at-equality boundary have one implementation.
 */
export function newPendingMembership(
  input: NewMembershipInput,
  now: Temporal.Instant,
): NewMembershipResult {
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

/**
 * Whether a confirmation is still open at `now`: only while the record is `awaiting-proof` and `now`
 * is strictly before the deadline the confirmation window computes from the recorded acceptance.
 *
 * A record that never recorded an acceptance has no window, so it is not open — reading it must not
 * invent one.
 */
export function isConfirmationOpen(membership: MembershipRecord, now: Temporal.Instant): boolean {
  const { acceptedAt } = membership;
  if (!isAwaitingProofState(membership.state) || acceptedAt === undefined) {
    return false;
  }
  return confirmationDeadline({ acceptedAt, now }).status === "within-window";
}

/**
 * The explicit confirmation command: turns an accepted, still-open membership into an `active` one.
 *
 * Only the command that handles the person's own Confirm calls this. No read, page load, retry or
 * resend does, because those must never confirm on someone's behalf, and a confirmation that happened
 * because a page rendered would be a consent nobody gave.
 *
 * Strict at equality: at the exact deadline instant the window is closed and the outcome is
 * `confirmation-expired`. The deadline is a function of the recorded acceptance alone, so a reload, a
 * retry or a resent notice cannot extend it.
 */
export function confirmAt(
  membership: MembershipRecord,
  now: Temporal.Instant,
): ConfirmMembershipResult {
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

// ---------------------------------------------------------------------------------------------
// Preference, held separately from consent
// ---------------------------------------------------------------------------------------------

/**
 * Records the Off/Immediate decision, and only that decision.
 *
 * `off` turns the membership off. `immediate` turns it back on once the address has passed proof, and
 * otherwise reopens the proof step with a fresh acceptance and a fresh deadline. Contact methods,
 * protected-content grants and the language preference are untouched, because none of them is this
 * decision.
 *
 * A source-supplied or restricted record is returned unchanged: a held address, an unqualified source
 * row and a source restriction are not preferences, so no preference change turns one on.
 *
 * A re-submitted Immediate on a record whose window is already running keeps the acceptance it has;
 * only a choice made outside a live window opens a new one, which is how a reload, a retry or a resent
 * notice is prevented from extending a window that is already counting down.
 */
export function withChoice(
  membership: MembershipRecord,
  choice: MemberChoice,
  now: Temporal.Instant,
): MembershipRecord {
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
    return membership.choice === "immediate"
      ? membership
      : { ...membership, choice: "immediate", revision: membership.revision + 1 };
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

/**
 * Records this person's reading language, and nothing else.
 *
 * The tag is stored exactly as given; validating and matching it is `content/locale.ts`'s job. The
 * state, the choice, the acceptance, the confirmation and its deadline are all untouched, because a
 * language preference neither subscribes nor unsubscribes: it is not consent, it is not proof of
 * possessing an address, it does not reset a confirmation window, and it cannot substitute the
 * rendition already pinned on a notification accepted earlier.
 */
export function withLanguagePreference(
  membership: MembershipRecord,
  languagePreference: string,
): MembershipRecord {
  if (membership.languagePreference === languagePreference) {
    return membership;
  }
  return { ...membership, languagePreference, revision: membership.revision + 1 };
}

// ---------------------------------------------------------------------------------------------
// Source-supplied rows are excluded, never activated
// ---------------------------------------------------------------------------------------------

/**
 * Represents a membership the source supplied rather than the person: a held or unqualified row is
 * recorded as `off` with its disposition and no acceptance, so the row is visible while no consent
 * exists for it.
 */
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

/**
 * Whether a record is a source-supplied membership that is excluded from every send: the guard every
 * consumer uses instead of activating such a row.
 */
export function isExcludedSourceMembership(
  membership: MembershipRecord,
): membership is MembershipRecord & { sourceDisposition: SourceMembershipDisposition } {
  return membership.sourceDisposition !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Closed-union guards
//
// A stored or submitted string narrows to a state or a choice through these guards, so a switch over
// the closed sets stays exhaustive without a second declaration of either set.
// ---------------------------------------------------------------------------------------------

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
