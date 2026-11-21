/**
 * Resolution: which of a publisher's memberships may receive one publication's notice, and the single
 * rendition each of those recipients is pinned to.
 */
import { Temporal } from "temporal-polyfill";
import type { ContentVariant } from "@/modules/content/variant";
import { dedupeKey, hasConsent } from "./consent";
import { isConfirmationOpen, isExcludedSourceMembership, type AudiencePurpose, type MembershipRecord, type MembershipState } from "./membership";
// Vocabulary: the two audiences, the eight exclusion reasons and the recipient a notice addresses
/** The two audiences a notice can serve, taken from the variant record so the pair is declared once: `public` and `approved-supporter`, where the second is a protected reading audience. */
export type ContentAudience = ContentVariant["audience"];
/** Why one member of the publisher's audience receives no notice for this intent. */
export const EXCLUSION_REASONS = ["restricted", "off", "unsubscribed", "awaiting-proof", "confirmation-expired", "held", "unqualified", "signed-up-after-intent"] as const;
/** One exclusion reason, derived from {@link EXCLUSION_REASONS}. */
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
/** One recipient who may receive the notice, carrying the identity the caller stores: the person's own identifier, the language they read in, and the dedupe key for this publisher, purpose. */
export interface EligibleRecipient {
  readonly recipientId: string;
  readonly languagePreference: string;
  readonly dedupeKey: string;
}
/** One member of the publisher's audience who receives nothing, and the reason that says why. */
export interface ExcludedRecipient {
  readonly recipientId: string;
  readonly reason: ExclusionReason;
}
/** The whole answer for one intent: who may receive it, who may not and why, and whether the accepted ceiling was smaller than the eligible set. */
export interface EligibilityResult {
  readonly eligible: EligibleRecipient[];
  readonly excluded: ExcludedRecipient[];
  readonly ceilingSaturated: boolean;
}
/** One notification intent as the caller accepted it: the identity every recipient's dedupe key is built from, the instant it was accepted — which no late signup may enlarge — and the ceiling. */
export interface NotificationIntent {
  readonly intentId: string;
  readonly acceptedAt: Temporal.Instant;
  readonly ceilingCount?: number;
}
/** Everything one eligibility question needs: authorised rows for one publisher and purpose, and now. */
export interface EligibilityInput {
  readonly memberships: readonly MembershipRecord[];
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly intent: NotificationIntent;
  readonly now: Temporal.Instant;
}
// Pinning vocabulary: one candidate rendition in, exactly one pinned rendition out
/** One rendition a recipient could be given: an admitted, non-withdrawn release of one variant, with the declared fallback rank the caller's locale chain assigned it. */
export interface RenditionCandidate {
  readonly variantId: string;
  readonly releaseId: string;
  readonly audience: ContentAudience;
  readonly localeTag: string;
  readonly publishedAt: Temporal.Instant;
  readonly fallbackRank: number;
}
/** The one rendition a recipient is pinned to. */
export interface PinnedRendition {
  readonly recipientId: string;
  readonly variantId: string;
  readonly releaseId: string;
  readonly audience: ContentAudience;
  readonly localeTag: string;
}
/** The result of resolving one recipient's rendition: exactly one pin, or an `unavailable` answer with the reason. */
export type RenditionResolution =
  | { readonly status: "pinned"; readonly pinned: PinnedRendition }
  | {
      readonly status: "unavailable";
      readonly reason: "no-admitted-rendition" | "audience-not-permitted";
    };
/** The recipient a pin is resolved for, with the grant already decided elsewhere. */
export interface RenditionRecipient {
  readonly recipientId: string;
  readonly languagePreference: string;
  readonly protectedReadingGranted: boolean;
}
/** Everything one pinning question needs: the recipient and the candidates offered for it. */
export interface RenditionResolutionInput {
  readonly recipient: RenditionRecipient;
  readonly candidates: readonly RenditionCandidate[];
}
/** The order in which {@link recipientRendition} resolves a candidate set, as a closed tuple a test can assert. */
export const RENDITION_RESOLUTION_ORDER = Object.freeze(["protected-audience-gate", "language-preference", "fallback-rank", "audience-specificity", "most-recent-publication", "variant-id"] as const);

const AUDIENCE_SPECIFICITY: Record<ContentAudience, number> = {
  "approved-supporter": 0,
  public: 1,
};
// Ordering: one deterministic comparison, with no locale collation
function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
function compareMembershipRows(left: MembershipRecord, right: MembershipRecord): number {
  return compareCodeUnits(left.membershipId, right.membershipId);
}
// The one exclusion test, shared by the audience view and the per-read access check
function exclusionReasonFor(membership: MembershipRecord, now: Temporal.Instant): ExclusionReason | undefined {
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
function lateSignupReason(membership: MembershipRecord, intent: NotificationIntent): ExclusionReason | undefined {
  const { acceptedAt } = membership;
  if (acceptedAt === undefined) {
    return undefined;
  }
  return Temporal.Instant.compare(acceptedAt, intent.acceptedAt) > 0 ? "signed-up-after-intent" : undefined;
}
// Eligibility: the publisher's audience for one intent
/** The recipients who may receive this publisher's notice for `input.intent`, and everyone else on the same publisher and purpose with the reason they may not. */
export function eligibleRecipients(input: EligibilityInput): EligibilityResult {
  const addressed = input.memberships.filter((membership) => membership.publisherId === input.publisherId && membership.purpose === input.purpose);
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
      const reason = exclusionReasonFor(membership, input.now) ?? lateSignupReason(membership, input.intent);
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
// Pinning: one recipient, exactly one rendition
/** The single rendition one recipient is pinned to, or the reason no rendition can be pinned. */
export function recipientRendition(input: RenditionResolutionInput): RenditionResolution {
  const { recipient, candidates } = input;
  const admitted = candidates.filter((candidate) => recipient.protectedReadingGranted || candidate.audience !== "approved-supporter");
  if (admitted.length === 0) {
    return {
      status: "unavailable",
      reason: candidates.length === 0 ? "no-admitted-rendition" : "audience-not-permitted",
    };
  }
  const ordered = [...admitted].sort((left, right) => compareCandidates(left, right, recipient.languagePreference));
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
function compareCandidates(left: RenditionCandidate, right: RenditionCandidate, languagePreference: string): number {
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
// Per-read access: the same test, applied to the one row a read is about
/** The answer a per-read access check gives: whether the row admits, its state, and why not. */
export interface MembershipAccess {
  readonly admitted: boolean;
  readonly state: MembershipState;
  readonly reason?: ExclusionReason;
}
/** Whether one membership row admits at `now`, re-evaluated on every read by the receiving preview and the synthetic inbox so a stale row can never grant access. */
export function membershipAccessAt(membership: MembershipRecord, now: Temporal.Instant): MembershipAccess {
  const reason = exclusionReasonFor(membership, now);
  return reason === undefined ? { admitted: true, state: membership.state } : { admitted: false, state: membership.state, reason };
}
