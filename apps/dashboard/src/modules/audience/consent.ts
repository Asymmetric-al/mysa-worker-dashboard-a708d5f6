/**
 * Consent: which send outcomes exist and which of them may ever be repeated, the one Off/Immediate
 * decision and the one unsubscribe, whether a membership may be sent to, and the identity under which
 * a notification intent is deduplicated.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Audience module" row: `src/modules/audience/{membership,consent,resolve}.ts`, whose
 *   named interfaces are `applyChoice()` and `dedupeKey()`. This file is the consent half; the record
 *   and its states are `membership.ts`'s, and recipient-to-rendition resolution is `resolve.ts`'s.
 * - AAP 0.3.4 row "Audience membership and consent": the single implementation, consumed by the
 *   Updates notification path, the receiving preview, the preferences surface and the unsubscribe.
 * - AAP 0.10.1 family requirement "an unsubscribe that acts on one publisher and purpose", and the
 *   0.8.5 rules that a source-supplied subscribed column is not consent, that importing or editing a
 *   contact never subscribes anyone, and that dedupe is exactly publisher + purpose + recipient +
 *   notification intent, under which accepted or possibly accepted work is never resent.
 * - AAP 0.11.1 deliverable row and the 0.9.1 repository tree; acceptance criteria 10 and 11, proven
 *   by `tests/domain/notification-window.test.ts`, `tests/integration/notification-dedupe.test.ts`,
 *   `e2e/consent-notification.spec.ts` and `e2e/delivery-recovery.spec.ts`.
 *
 * Five facts stay five facts. A membership state (`membership.ts`), the consent a send requires
 * (here), a person's language preference (`membership.ts`), the contact methods a partner record
 * holds (`modules/data-service/reads/partners.ts`) and a protected-content reader grant
 * (`data-service/authorize.ts#canReadProtected`) are separate answers evaluated separately. None of
 * them is derived from another, and no address, name or relationship joins them.
 *
 * A recorded send outcome is one of five separate outcomes the product keeps apart — publication,
 * notification submission, provider acceptance, delivery and reading. This module models the second
 * and third only. An `accepted` state says the local stand-in for a provider took the work: it does
 * not say a message arrived, and it never says anyone opened it.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. It
 * imports the membership record and the two membership transitions, plus the `Instant` type. It reads
 * no clock (`now` is always a parameter, so a call site that omits it does not compile), holds no
 * state, performs no I/O, generates no identifier and restates no time window: the elapsed-hour
 * usefulness boundary has one owner in `time/window.ts#notificationDeadline`, and the confirmation
 * window has one owner in `membership.ts`, which calls `time/window.ts#confirmationDeadline`.
 */
import type { Temporal } from "temporal-polyfill";

import {
  type AudiencePurpose,
  type MemberChoice,
  type MembershipRecord,
  isExcludedSourceMembership,
  withChoice,
} from "@/modules/audience/membership";

// ---------------------------------------------------------------------------------------------
// Send outcomes: the three states a send attempt can be recorded in
// ---------------------------------------------------------------------------------------------

/**
 * The three states one send attempt can be recorded in. Each names a different fact about the local
 * submission, and none of them states that a message arrived or was opened:
 *
 * - `accepted` — the local stand-in for a provider took the work, so it is one record for one
 *   recipient and one intent. It is not evidence of delivery and not evidence of reading.
 * - `failed` — the attempt definitely did not take the work.
 * - `unknown` — the acknowledgement was lost, so the effect may or may not have been applied.
 *
 * A fourth value cannot be added here without failing to compile, and no surface may present
 * `accepted` as anything beyond acceptance.
 */
export type SendOutcomeState = "accepted" | "failed" | "unknown";

/** The three send states in the order a surface lists them; a fourth member does not typecheck. */
export const SEND_OUTCOME_STATES: readonly SendOutcomeState[] = ["accepted", "failed", "unknown"];

/**
 * Whether one recorded send state may ever be attempted again for the same intent.
 *
 * Only `failed` may: it is the one state that says the work definitely did not go through, and even
 * then the caller must find the attempt still inside its usefulness window, whose boundary
 * `time/window.ts#notificationDeadline` owns.
 *
 * `accepted` is never repeated, because the work was already taken and a second attempt would be a
 * second copy. `unknown` is never repeated under a fresh key either: the effect may exist, so the
 * caller offers recovery by operation identity, which returns the original result instead of sending
 * again. That is what keeps accepted or possibly accepted work from ever being resent under a new key.
 */
export function mayRepeatIntent(state: SendOutcomeState): boolean {
  return state === "failed";
}

// ---------------------------------------------------------------------------------------------
// The Off/Immediate decision and the unsubscribe: one membership at a time
// ---------------------------------------------------------------------------------------------

/** The membership a choice change addresses: one publisher, one purpose, one recipient. */
interface AddressedMembership {
  memberships: readonly MembershipRecord[];
  publisherId: string;
  purpose: AudiencePurpose;
  recipientId: string;
}

/** A choice change: the addressed membership plus the choice the person made. */
interface ChoiceChange extends AddressedMembership {
  choice: MemberChoice;
}

/**
 * The result of a choice change: the memberships as they now stand, and the identifier of the one
 * record that actually changed.
 *
 * `changedMembershipId` is `null` when nothing changed, which is the honest answer both when no record
 * matched and when the matched record was already in the requested state. The mutation that calls
 * this maps `null` to its `unchanged` outcome rather than reporting a success that did not happen.
 */
interface ChoiceChangeResult {
  memberships: MembershipRecord[];
  changedMembershipId: string | null;
}

/**
 * Applies one transition to the single membership addressed by publisher, purpose and recipient, and
 * returns every other record untouched and in the order it arrived.
 *
 * Identity is the record's own — publisher plus purpose plus recipient inside one scope — so a
 * membership for another publisher or another purpose is never caught by a change aimed at this one.
 * A transition that returns the record it was given has changed nothing, which is how a no-op is
 * detected without a second flag beside the record.
 */
function rewriteOneMembership(
  input: AddressedMembership,
  transition: (membership: MembershipRecord) => MembershipRecord,
): ChoiceChangeResult {
  const index = input.memberships.findIndex(
    (membership) =>
      membership.publisherId === input.publisherId &&
      membership.purpose === input.purpose &&
      membership.recipientId === input.recipientId,
  );
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

/**
 * Records the person's Off or Immediate decision for one publisher and one purpose, and nothing else.
 *
 * The transition is `membership.ts#withChoice`, which owns what each choice means: Immediate on a
 * record that has not passed proof reopens the proof step with a fresh acceptance, re-submitted
 * Immediate on a record already waiting keeps the acceptance it has rather than extending the window,
 * and a source-supplied or restricted record comes back untouched because neither a held row nor a
 * source limitation is a preference. The language preference, the contact methods and any protected
 * reading grant are left exactly as they were, because none of them is this decision.
 */
export function applyChoice(input: ChoiceChange, now: Temporal.Instant): ChoiceChangeResult {
  return rewriteOneMembership(input, (membership) => withChoice(membership, input.choice, now));
}

/**
 * Turns one person's membership for one publisher and one purpose off, and touches nothing else: a
 * membership for another publisher, and a membership for another purpose, is returned unchanged and
 * in order.
 *
 * `now` is the instant the request ran. It goes to the same `withChoice` transition, because the off
 * decision has one implementation and this is not a second one.
 *
 * What this deliberately does not do:
 * - It does not recall a copy the local submission already accepted. Stopping future notices says
 *   nothing about a message that has already left the application, and no surface may claim otherwise.
 * - It does not revoke a protected-reading grant, which is evaluated at read time by
 *   `data-service/authorize.ts` and which no preference change can grant or remove.
 * - It does not change donations, support records or commitments: a notification preference is not a
 *   financial fact and no financial fact follows from it.
 * - It creates no suppression record of a second shape. The membership state itself is the record
 *   that the person is off for this publisher and purpose, so a parallel list would be a second owner
 *   of one fact, free to disagree with the first.
 */
export function unsubscribe(input: AddressedMembership, now: Temporal.Instant): ChoiceChangeResult {
  return rewriteOneMembership(input, (membership) => withChoice(membership, "off", now));
}

// ---------------------------------------------------------------------------------------------
// Consent is a chosen state, never an inferred one
// ---------------------------------------------------------------------------------------------

/**
 * Whether this membership may receive an immediate notice: the address was deliberately proven and
 * the person asked for Immediate.
 *
 * Every condition is required and each is a separate fact. `off` is a choice the person made,
 * `awaiting-proof` has not been proven, `restricted` is a limitation the source imposed, and a
 * source-supplied row is excluded however it is labelled. Consent is never inferred from an email
 * match, a partner record, a household, a relationship label, a language preference or an earlier
 * send, and being consented here grants nothing beyond this one publisher and this one purpose.
 */
export function hasConsent(membership: MembershipRecord): boolean {
  if (isExcludedSourceMembership(membership)) {
    return false;
  }
  return (
    membership.state === "active" &&
    membership.choice === "immediate" &&
    membership.confirmedAt !== undefined
  );
}

/**
 * Evidence that does not establish communication consent for this publisher and purpose, however much
 * it looks like it does. Each member is a real path by which a contact reaches the application, and
 * none of them is a choice the person made here.
 */
export type NonConsentEvidence =
  /** A source row or export carried a subscribed column of its own. */
  | "subscribed-column"
  /** A worker created the contact or edited its permitted fields. */
  | "contact-edit"
  /** An accepted import row created or reused a contact. */
  | "import-row"
  /** A partner record exists, with everything a relationship suggests about it. */
  | "partner-record"
  /** The person chose a reading language. */
  | "language-preference";

/** Everything the application can hold as evidence about consent for one publisher and purpose. */
export type ConsentEvidence = "explicit-choice" | NonConsentEvidence;

/**
 * The evidence kinds that never establish consent, in the order a surface or a test lists them.
 * Declared once so the edit path, the import path and a browser check agree on the set instead of
 * each reciting its own copy.
 */
export const NON_CONSENT_EVIDENCE: readonly NonConsentEvidence[] = [
  "subscribed-column",
  "contact-edit",
  "import-row",
  "partner-record",
  "language-preference",
];

/**
 * Whether one piece of evidence establishes consent: only `explicit-choice` does, meaning the person
 * themselves selected Immediate for this publisher and purpose and then passed the confirmation step.
 *
 * The contact-edit and import paths consult this before creating or changing a membership, so an
 * imported row that happens to carry a subscribed column produces no membership and no consent.
 */
export function evidenceGrantsConsent(evidence: ConsentEvidence): boolean {
  return evidence === "explicit-choice";
}

// ---------------------------------------------------------------------------------------------
// One notification intent is identified by four values, not by a fresh attempt
// ---------------------------------------------------------------------------------------------

/** The four values that identify one notification intent for one recipient on one purpose. */
interface IntentIdentity {
  publisherId: string;
  purpose: AudiencePurpose;
  recipientId: string;
  intentId: string;
}

/** Which kind of identity a stored key is, so a value in a store says so without being parsed. */
const DEDUPE_KEY_SCHEME = "notice-intent:v1";

/**
 * A dedupe key: a `string` at runtime and everywhere a caller consumes it, but not one a caller can
 * make. The compiler refuses a value someone wrote themselves, so `dedupeKey()` stays the only place a
 * key is composed — which is what keeps an identity that is never meant to be parsed from being
 * assembled out of parts somewhere else. The brand is private, so a signature that returns one still
 * reads as returning a string and no caller has to name this type.
 */
type DedupeKey = string & { readonly dedupeKeyOf: "notification-intent" };

/**
 * Encodes one value so a concatenation cannot be ambiguous: a value that holds the separator, and two
 * different tuples that would otherwise join to the same text, still produce different keys.
 */
function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * The identity under which one publisher's notification intent for one recipient is deduplicated:
 * publisher + purpose + recipient + intent, in that order.
 *
 * The returned key is an opaque identity. Callers store it and compare it; they never parse it, never
 * recompose it from parts and never build one from a template string — the return type refuses a value
 * this function did not produce, so it is the only composer of a key. The same four values always give
 * the same key, and changing any one of them gives a different one, so a repeated submit of the same
 * intent is a recovery while a deliberate new intent is a new key and therefore a new, legitimately
 * distinct message.
 */
export function dedupeKey(input: IntentIdentity): DedupeKey {
  return [
    DEDUPE_KEY_SCHEME,
    lengthPrefixed(input.publisherId),
    lengthPrefixed(input.purpose),
    lengthPrefixed(input.recipientId),
    lengthPrefixed(input.intentId),
  ].join("|") as DedupeKey;
}
