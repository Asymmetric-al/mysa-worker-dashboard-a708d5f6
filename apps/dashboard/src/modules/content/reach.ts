/**
 * The application's one reach rule: how far one released edition reaches — not public, public by link
 * only, or listed publicly — and what withdrawing an edition does, and does not, do.
 */
import type { Temporal } from "temporal-polyfill";
import { RELEASE_REACH_VALUES, type Release, type ReleaseReach } from "@/modules/content/variant";
import { now } from "@/modules/time/clock";
// The closed reach vocabulary
/** The three reach values a released edition may carry, in the order every surface offers them: Not public, Shared by link: public, and Listed publicly. */
export const REACH_VALUES = RELEASE_REACH_VALUES;
/** One reach value, derived from {@link REACH_VALUES} so a new member can never appear in the vocabulary without also being a valid `Release["reach"]`. */
export type Reach = ReleaseReach;
// What the decisions read, and what they answer
/** The facts a reach decision reads from one released edition: the reach value it carries, and whether it was withdrawn. */
export interface ReachableEdition {
  readonly reach: Reach;
  readonly withdrawnAt?: Temporal.Instant | string | null;
}
/** What an edition's reach permits on the two delivery surfaces, as plain data. */
export interface ReachMetadata {
  readonly listed: boolean;
  readonly indexable: boolean;
  readonly robots?: "noindex";
}
/** The three answers {@link decideReach} gives, one per request. */
export type ReachDecision =
  | {
      readonly status: "changed";
      readonly reach: Reach;
    }
  | {
      readonly status: "unchanged";
      readonly reach: Reach;
    }
  | {
      readonly status: "invalid";
      readonly reason: string;
    };
/** What a reader sees at the address of a withdrawn edition: a `noindex` document carrying one fixed message and nothing about what stood there. */
export interface Tombstone {
  readonly robots: "noindex";
  readonly body: string;
}
/** One edition's withdrawal: the release with its withdrawal recorded, and the tombstone it answers. */
export interface Withdrawal {
  readonly release: Release;
  readonly tombstone: Tombstone;
}
/** The outcome of withdrawing one edition: always `withdrawn`, with the record and its tombstone. */
export interface WithdrawEditionResult extends Withdrawal {
  readonly status: "withdrawn";
}
/** The outcome of *Stop showing me publicly*: one withdrawal per release the document held. */
export interface ContainEditionsResult {
  readonly status: "contained";
  readonly withdrawals: readonly Withdrawal[];
}
// The fixed tombstone message
const TOMBSTONE_BODY = "This page is no longer available.";
// Choosing a reach value
function isReach(value: string): value is Reach {
  return REACH_VALUES.some((reach) => reach === value);
}
/** Decides what a request to change one edition's reach does: `changed` with the value to store, `unchanged` when the edition already carries it, or `invalid` with the reason when the. */
export function decideReach(current: Reach, requested: string): ReachDecision {
  if (!isReach(requested)) {
    return {
      status: "invalid",
      reason: `"${requested}" is not a reach setting. Reach is one of ${REACH_VALUES.join(", ")}.`,
    };
  }
  if (requested === current) {
    return { status: "unchanged", reach: current };
  }
  return { status: "changed", reach: requested };
}
// Reading an edition: the index, the direct link, and the directives the route emits
function isWithdrawn(edition: ReachableEdition): boolean {
  return edition.withdrawnAt !== undefined && edition.withdrawnAt !== null;
}
/** Whether the discovery index enumerates this edition: true only for a `listed` edition that has not been withdrawn. */
export function isListedPublicly(edition: ReachableEdition): boolean {
  return edition.reach === "listed" && !isWithdrawn(edition);
}
/** Whether a direct link to this edition may be served: true only for a non-withdrawn `link-public` or `listed` release, and false for `not-public`, for any withdrawn edition and for a stored. */
export function isDirectlyReadable(edition: ReachableEdition): boolean {
  if (isWithdrawn(edition)) {
    return false;
  }
  return edition.reach === "link-public" || edition.reach === "listed";
}
/** States what an edition's reach permits as plain data: `listed` and `indexable` are true only for a non-withdrawn `listed` edition, and `robots: "noindex"` is present for a `link-public`. */
export function reachMetadata(edition: ReachableEdition): ReachMetadata {
  if (isListedPublicly(edition)) {
    return { listed: true, indexable: true };
  }
  if (edition.reach === "link-public" || isWithdrawn(edition)) {
    return { listed: false, indexable: false, robots: "noindex" };
  }
  return { listed: false, indexable: false };
}
// Withdrawal: one edition, and every edition of a document
function withdrawalOf(release: Release, at: Temporal.Instant): Withdrawal {
  return {
    release: isWithdrawn(release) ? release : { ...release, withdrawnAt: at },
    tombstone: { robots: "noindex", body: TOMBSTONE_BODY },
  };
}
/** Withdraws one edition, and answers the non-identifying tombstone its address serves from now on. */
export function withdrawEdition(release: Release, options?: { readonly at?: Temporal.Instant }): WithdrawEditionResult {
  return { status: "withdrawn", ...withdrawalOf(release, options?.at ?? now()) };
}
/** *Stop showing me publicly*: withdraws every edition a document holds — every locale and every audience — and returns one list the caller persists in a single store transaction. */
export function containEditions(releases: readonly Release[], options?: { readonly at?: Temporal.Instant }): ContainEditionsResult {
  const at = options?.at ?? now();
  return {
    status: "contained",
    withdrawals: releases.map((release) => withdrawalOf(release, at)),
  };
}
