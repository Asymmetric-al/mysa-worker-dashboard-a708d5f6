/**
 * Resolution: which of a publisher's memberships may receive one publication's notice, and the single
 * rendition each of those recipients is pinned to.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Audience module" row: `src/modules/audience/{membership,consent,resolve}.ts`, whose
 *   named interfaces are `eligibleRecipients()` and `recipientRendition()`. The record and its four
 *   states are `membership.ts`'s, whether a send is consented and the identity it is deduplicated
 *   under are `consent.ts`'s, and recipient-to-rendition resolution is this file's.
 * - AAP 0.8.5 notification rules: immediate notification covers this publication intent and the
 *   currently eligible subscribers to this publisher's Update-email purpose only; each eligible
 *   recipient receives exactly one pinned rendition; a later restriction may remove an unsubmitted
 *   recipient while a late signup never expands an accepted ceiling; dedupe is publisher + purpose +
 *   recipient + notification intent.
 * - AAP 0.10.1 receiving experience, which rechecks access on open; `membershipAccessAt` is the
 *   per-read re-evaluation it uses, so a stale membership row can never grant access.
 * - AAP 0.9.1 tree, 0.11.1 deliverable row, and acceptance criteria 10, 11 and 17, proven by
 *   `tests/domain/notification-window.test.ts`, `tests/integration/notification-dedupe.test.ts`,
 *   `e2e/consent-notification.spec.ts`, `e2e/delivery-recovery.spec.ts` and
 *   `e2e/variants-and-rtl.spec.ts`.
 *
 * Authorisation precedes enumeration, so this module authorises nothing and enumerates nothing of its
 * own: it receives the membership rows a caller was already entitled to read, for one publisher and
 * one purpose, and returns projections of them. A recipient is identified by its own identifier
 * inside the scope — an equal-looking address, name or postal address establishes neither identity
 * nor consent and is never a join key — and no address is returned, because no surface that consumes
 * this needs one.
 *
 * Five facts stay five facts. The membership state (`membership.ts`), the consent a send requires
 * (`consent.ts`), the language preference (`membership.ts`), the contact methods a partner record
 * holds and the protected-content reader grant the authorisation service decides (arriving here as
 * `protectedReadingGranted`) are separate answers evaluated separately. Being eligible here therefore
 * grants nothing beyond one notice for one publisher and one purpose, and it never grants a read
 * right: whether a person may open a protected rendition is re-decided when they ask for it.
 *
 * Publication, notification submission, provider acceptance, delivery and reading are five further
 * separate outcomes. This module selects recipients and pins renditions; it records no send, and no
 * state it returns can mean that a message arrived or that anyone opened it.
 *
 * Every answer is derived at read time from `now`, and nothing is cached, memoised or marked as
 * "still valid" on a result: a row that expires between two reads is excluded by the second one.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. Its one
 * cross-folder import is the type-only `content/variant` audience, so no runtime edge from this
 * folder to the content module exists and the module graph stays acyclic — `content/notice.ts`
 * imports this file at runtime, not the other way round. It reads no clock (`now` is always a
 * parameter, so a call site that omits it does not compile), performs no I/O, resolves no locale,
 * decides no publication or reach, and generates no identifier.
 */
import { Temporal } from "temporal-polyfill";

import type { ContentVariant } from "@/modules/content/variant";

import { dedupeKey, hasConsent } from "./consent";
import {
  isConfirmationOpen,
  isExcludedSourceMembership,
  type AudiencePurpose,
  type MembershipRecord,
  type MembershipState,
} from "./membership";

// ---------------------------------------------------------------------------------------------
// Vocabulary: the two audiences, the eight exclusion reasons and the recipient a notice addresses
// ---------------------------------------------------------------------------------------------

/**
 * The two audiences a notice can serve, taken from the variant record so the pair is declared once:
 * `public` and `approved-supporter`, where the second is a protected reading audience.
 */
export type ContentAudience = ContentVariant["audience"];

/**
 * Why one member of the publisher's audience receives no notice for this intent. Every member is a
 * distinct rendering, because the reasons are not interchangeable:
 *
 * - `restricted` — the source imposed a limitation on this person. No preference change lifts it.
 * - `off` — the person chose Off and never passed proof, so nothing was ever being sent.
 * - `unsubscribed` — the person had passed proof, and then turned this publisher and purpose off.
 * - `awaiting-proof` — the acceptance is still inside its confirmation window and unconfirmed.
 * - `confirmation-expired` — that window closed before the confirmation came.
 * - `held` — the source withholds the address itself (suppressed or unverifiable).
 * - `unqualified` — the row cannot establish consent for this publisher and purpose.
 * - `signed-up-after-intent` — the acceptance came after this intent was accepted, and a late signup
 *   never expands an accepted ceiling.
 *
 * `off` and `unsubscribed` are both the person's own decision and are kept apart because the surface
 * that shows them says different things; `restricted`, `held` and `unqualified` are three different
 * source-side answers and are never collapsed into one "not eligible".
 */
export const EXCLUSION_REASONS = [
  "restricted",
  "off",
  "unsubscribed",
  "awaiting-proof",
  "confirmation-expired",
  "held",
  "unqualified",
  "signed-up-after-intent",
] as const;

/** One exclusion reason, derived from {@link EXCLUSION_REASONS}. */
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/**
 * One recipient who may receive the notice, carrying the identity the caller stores: the person's own
 * identifier, the language they read in, and the dedupe key for this publisher, purpose, recipient and
 * intent. No address and no name travels here.
 */
export interface EligibleRecipient {
  readonly recipientId: string;
  readonly languagePreference: string;
  /** From `consent.ts#dedupeKey`, so no caller can compose a notification identity differently. */
  readonly dedupeKey: string;
}

/** One member of the publisher's audience who receives nothing, and the reason that says why. */
export interface ExcludedRecipient {
  readonly recipientId: string;
  readonly reason: ExclusionReason;
}

/**
 * The whole answer for one intent: who may receive it, who may not and why, and whether the accepted
 * ceiling was smaller than the eligible set.
 *
 * `ceilingSaturated` is a report, never a truncation: the eligible list is never silently cut to the
 * ceiling, because dropping people quietly would hide a notification that needs attention.
 */
export interface EligibilityResult {
  readonly eligible: EligibleRecipient[];
  readonly excluded: ExcludedRecipient[];
  readonly ceilingSaturated: boolean;
}

/**
 * One notification intent as the caller accepted it: the identity every recipient's dedupe key is
 * built from, the instant it was accepted — which no late signup may enlarge — and the ceiling the
 * caller promised at that moment.
 */
interface NotificationIntent {
  readonly intentId: string;
  readonly acceptedAt: Temporal.Instant;
  readonly ceilingCount?: number;
}

/** Everything one eligibility question needs: authorised rows for one publisher and purpose, and now. */
interface EligibilityInput {
  readonly memberships: readonly MembershipRecord[];
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly intent: NotificationIntent;
  readonly now: Temporal.Instant;
}

// ---------------------------------------------------------------------------------------------
// Pinning vocabulary: one candidate rendition in, exactly one pinned rendition out
// ---------------------------------------------------------------------------------------------

/**
 * One rendition a recipient could be given: an admitted, non-withdrawn release of one variant, with
 * the declared fallback rank the caller's locale chain assigned it.
 *
 * The caller enumerates these — publication and reach are decided by the content module, and locale
 * fallback is resolved there too — so this module never decides what was published or what a locale
 * chain is. It only picks one.
 */
export interface RenditionCandidate {
  readonly variantId: string;
  readonly releaseId: string;
  readonly audience: ContentAudience;
  /** The exact content locale of the release, matched against the person's reading language. */
  readonly localeTag: string;
  readonly publishedAt: Temporal.Instant;
  /** The caller's declared fallback chain position: lower is nearer the person's own language. */
  readonly fallbackRank: number;
}

/**
 * The one rendition a recipient is pinned to. This is the identity a caller stores on the send record,
 * so a replay or a later restriction cannot silently substitute a different copy: the pinned variant,
 * release, audience and locale are exactly what was resolved.
 */
export interface PinnedRendition {
  readonly recipientId: string;
  readonly variantId: string;
  readonly releaseId: string;
  readonly audience: ContentAudience;
  readonly localeTag: string;
}

/**
 * The result of resolving one recipient's rendition: exactly one pin, or an `unavailable` answer with
 * the reason. There is no third shape, no array and no null — a caller that received two renditions
 * would have two copies to send, which is the defect this prevents.
 *
 * `no-admitted-rendition` means there was nothing to choose from; `audience-not-permitted` means
 * everything offered was protected and the recipient holds no protected-reading grant.
 */
export type RenditionResolution =
  | { readonly status: "pinned"; readonly pinned: PinnedRendition }
  | {
      readonly status: "unavailable";
      readonly reason: "no-admitted-rendition" | "audience-not-permitted";
    };

/** The recipient a pin is resolved for, with the grant already decided elsewhere. */
interface RenditionRecipient {
  readonly recipientId: string;
  readonly languagePreference: string;
  /** Decided by the authorisation service at read time; this module never evaluates a grant. */
  readonly protectedReadingGranted: boolean;
}

/** Everything one pinning question needs: the recipient and the candidates offered for it. */
interface RenditionResolutionInput {
  readonly recipient: RenditionRecipient;
  readonly candidates: readonly RenditionCandidate[];
}

/**
 * The order in which {@link recipientRendition} resolves a candidate set, as a closed tuple a test can
 * assert. The first entry removes candidates; the rest break ties in sequence, so the same inputs
 * always produce the same single pin on every host.
 */
export const RENDITION_RESOLUTION_ORDER = Object.freeze([
  "protected-audience-gate",
  "language-preference",
  "fallback-rank",
  "audience-specificity",
  "most-recent-publication",
  "variant-id",
] as const);

/**
 * How specific each admitted audience is, lower being more specific. Declared as a total record over
 * the closed audience union, so a third audience fails to compile here and forces a precedence
 * decision instead of silently landing on the `public` rank.
 */
const AUDIENCE_SPECIFICITY: Record<ContentAudience, number> = {
  "approved-supporter": 0,
  public: 1,
};

// ---------------------------------------------------------------------------------------------
// Ordering: one deterministic comparison, with no locale collation
// ---------------------------------------------------------------------------------------------

/**
 * Compares two identifiers by UTF-16 code unit, which is the same order on every host and in every
 * interface language. Locale-aware collation is deliberately not used: it would let two runs order
 * the same audience differently, and matching content locales is the content module's job.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Orders rows of one recipient by membership identity, so a duplicated row is decided the same way twice. */
function compareMembershipRows(left: MembershipRecord, right: MembershipRecord): number {
  return compareCodeUnits(left.membershipId, right.membershipId);
}

// ---------------------------------------------------------------------------------------------
// The one exclusion test, shared by the audience view and the per-read access check
// ---------------------------------------------------------------------------------------------

/**
 * Why one membership may not receive a notice at `now`, or `undefined` when it may.
 *
 * This is the single eligibility test: the audience view and {@link membershipAccessAt} both read the
 * answer from here, so a surface cannot admit a row the notification path would refuse. The order of
 * the checks is the order of the reasons — a source disposition is a property of the row, a
 * restriction is a source limitation, and a state is the person's decision or the proof step — so one
 * row is reported under exactly one reason.
 *
 * `off` and `unsubscribed` share a state and are separated by evidence of having passed proof: a
 * record with a confirmation instant was receiving this publisher's notices and then turned them off,
 * while one that never recorded a confirmation only ever chose Off. An `active` row that fails the
 * consent test — no recorded confirmation, or a choice that is not Immediate — cannot establish
 * consent for this publisher and purpose, so it is excluded as `unqualified` rather than admitted.
 */
function exclusionReasonFor(
  membership: MembershipRecord,
  now: Temporal.Instant,
): ExclusionReason | undefined {
  if (isExcludedSourceMembership(membership)) {
    return membership.sourceDisposition;
  }
  if (membership.state === "restricted") {
    return "restricted";
  }
  if (membership.state === "off") {
    return membership.confirmedAt === undefined ? "off" : "unsubscribed";
  }
  if (membership.state === "awaiting-proof") {
    return isConfirmationOpen(membership, now) ? "awaiting-proof" : "confirmation-expired";
  }
  return hasConsent(membership) ? undefined : "unqualified";
}

/**
 * Why a membership accepted after this intent was accepted may not receive it, or `undefined` when it
 * was accepted before. A row that recorded no acceptance at all is not "late": there is nothing to
 * compare, and its state already decided the question above.
 */
function lateSignupReason(
  membership: MembershipRecord,
  intent: NotificationIntent,
): ExclusionReason | undefined {
  const { acceptedAt } = membership;
  if (acceptedAt === undefined) {
    return undefined;
  }
  return Temporal.Instant.compare(acceptedAt, intent.acceptedAt) > 0
    ? "signed-up-after-intent"
    : undefined;
}

// ---------------------------------------------------------------------------------------------
// Eligibility: the publisher's audience for one intent
// ---------------------------------------------------------------------------------------------

/**
 * The recipients who may receive this publisher's notice for `input.intent`, and everyone else on the
 * same publisher and purpose with the reason they may not.
 *
 * Only rows for this publisher and this purpose are considered: other publishers' audiences are not
 * enumerated here at all, not even as exclusions, because a count of them would disclose something
 * the caller was never handed. Each recipient appears at most once, resolved by its own identifier,
 * and the result is ordered by that identifier — deterministic, so the audience view, the delivery
 * view and a replay agree.
 *
 * A row accepted after `input.intent.acceptedAt` is excluded as `signed-up-after-intent`: late signups
 * never expand a ceiling that was accepted earlier, while rows accepted before it stay eligible.
 * When `ceilingCount` is smaller than the eligible set, `ceilingSaturated` says so and nothing is
 * dropped — the caller reports a notification that needs attention instead of quietly sending fewer
 * copies than the person expected.
 */
export function eligibleRecipients(input: EligibilityInput): EligibilityResult {
  const addressed = input.memberships.filter(
    (membership) =>
      membership.publisherId === input.publisherId && membership.purpose === input.purpose,
  );

  const rowsByRecipient = new Map<string, MembershipRecord[]>();
  for (const membership of addressed) {
    const rows = rowsByRecipient.get(membership.recipientId);
    if (rows === undefined) {
      rowsByRecipient.set(membership.recipientId, [membership]);
    } else {
      rows.push(membership);
    }
  }

  const recipientIds = [...rowsByRecipient.keys()].sort(compareCodeUnits);
  const eligible: EligibleRecipient[] = [];
  const excluded: ExcludedRecipient[] = [];

  for (const recipientId of recipientIds) {
    const rows = (rowsByRecipient.get(recipientId) ?? []).sort(compareMembershipRows);
    let admitted: EligibleRecipient | undefined;
    let refusal: ExclusionReason | undefined;

    for (const membership of rows) {
      const reason =
        exclusionReasonFor(membership, input.now) ?? lateSignupReason(membership, input.intent);
      if (reason === undefined) {
        admitted = {
          recipientId,
          languagePreference: membership.languagePreference,
          dedupeKey: dedupeKey({
            publisherId: input.publisherId,
            purpose: input.purpose,
            recipientId,
            intentId: input.intent.intentId,
          }),
        };
        break;
      }
      refusal ??= reason;
    }

    if (admitted !== undefined) {
      eligible.push(admitted);
    } else if (refusal !== undefined) {
      excluded.push({ recipientId, reason: refusal });
    }
  }

  const { ceilingCount } = input.intent;
  return {
    eligible,
    excluded,
    ceilingSaturated: ceilingCount !== undefined && eligible.length > ceilingCount,
  };
}

// ---------------------------------------------------------------------------------------------
// Pinning: one recipient, exactly one rendition
// ---------------------------------------------------------------------------------------------

/**
 * The single rendition one recipient is pinned to, or the reason no rendition can be pinned.
 *
 * Precedence is applied in the order {@link RENDITION_RESOLUTION_ORDER} states it: a candidate whose
 * audience is `approved-supporter` is dropped for a recipient without a protected-reading grant; an
 * exact match on the person's reading language wins over any other locale; the caller's declared
 * fallback chain decides next; the more specific admitted audience wins over `public`; the more
 * recently published release wins; and the variant identifier settles the remaining ties. The result
 * is one `PinnedRendition`, never two — a person eligible for two audiences and two languages
 * receives one copy per intent, which is the rule criterion 17 checks.
 *
 * The caller stores the pinned identity on the send record. Language preference is read from the
 * recipient given here and never inferred from the candidate set, and changing it later cannot
 * substitute the copy already pinned on an intent accepted earlier.
 *
 * Single implementation: `content/notice.ts` resolves the notice for an already-eligible recipient and
 * must call this function for its pinning step rather than repeating the order, so the tie-break
 * exists once. That file owns candidate enumeration and message construction; eligibility, the dedupe
 * identity and this pin belong here.
 */
export function recipientRendition(input: RenditionResolutionInput): RenditionResolution {
  const { recipient, candidates } = input;

  const admitted = candidates.filter(
    (candidate) => recipient.protectedReadingGranted || candidate.audience !== "approved-supporter",
  );
  if (admitted.length === 0) {
    return {
      status: "unavailable",
      reason: candidates.length === 0 ? "no-admitted-rendition" : "audience-not-permitted",
    };
  }

  const ordered = [...admitted].sort((left, right) =>
    compareCandidates(left, right, recipient.languagePreference),
  );
  const [pinnedCandidate] = ordered;
  if (pinnedCandidate === undefined) {
    // Unreachable: a non-empty admitted set always yields a first element. Stated so the return shape
    // is total under `noUncheckedIndexedAccess` instead of asserting a value the guard proved.
    return { status: "unavailable", reason: "no-admitted-rendition" };
  }

  return {
    status: "pinned",
    pinned: {
      recipientId: recipient.recipientId,
      variantId: pinnedCandidate.variantId,
      releaseId: pinnedCandidate.releaseId,
      audience: pinnedCandidate.audience,
      localeTag: pinnedCandidate.localeTag,
    },
  };
}

/**
 * The pinning precedence as one comparator, in the order {@link RENDITION_RESOLUTION_ORDER} names
 * after the protected-audience gate that ran before it.
 */
function compareCandidates(
  left: RenditionCandidate,
  right: RenditionCandidate,
  languagePreference: string,
): number {
  const leftExact = left.localeTag === languagePreference ? 0 : 1;
  const rightExact = right.localeTag === languagePreference ? 0 : 1;
  if (leftExact !== rightExact) {
    return leftExact - rightExact;
  }

  if (left.fallbackRank !== right.fallbackRank) {
    return left.fallbackRank < right.fallbackRank ? -1 : 1;
  }

  const leftSpecificity = AUDIENCE_SPECIFICITY[left.audience];
  const rightSpecificity = AUDIENCE_SPECIFICITY[right.audience];
  if (leftSpecificity !== rightSpecificity) {
    return leftSpecificity - rightSpecificity;
  }

  const published = Temporal.Instant.compare(right.publishedAt, left.publishedAt);
  if (published !== 0) {
    return published;
  }

  return compareCodeUnits(left.variantId, right.variantId);
}

// ---------------------------------------------------------------------------------------------
// Per-read access: the same test, applied to the one row a read is about
// ---------------------------------------------------------------------------------------------

/** The answer a per-read access check gives: whether the row admits, its state, and why not. */
export interface MembershipAccess {
  readonly admitted: boolean;
  readonly state: MembershipState;
  readonly reason?: ExclusionReason;
}

/**
 * Whether one membership row admits at `now`, re-evaluated on every read by the receiving preview and
 * the synthetic inbox so a stale row can never grant access.
 *
 * This reads only the row it was given and the instant it was given; it confirms nothing, subscribes
 * nobody, disposes no source row and repairs no record, because confirmation is an explicit command
 * the person themselves triggers. A row whose confirmation window has closed, or which the source
 * restricted, therefore denies the read the moment it closes rather than when a status was last
 * written.
 */
export function membershipAccessAt(
  membership: MembershipRecord,
  now: Temporal.Instant,
): MembershipAccess {
  const reason = exclusionReasonFor(membership, now);
  return reason === undefined
    ? { admitted: true, state: membership.state }
    : { admitted: false, state: membership.state, reason };
}
