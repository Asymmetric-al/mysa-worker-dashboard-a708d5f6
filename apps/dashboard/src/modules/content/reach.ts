/** The application's one reach rule: how far one released edition reaches — not public, public by link only, or listed publicly — and what withdrawing an edition does, and does not, do. */
import type { Temporal } from "temporal-polyfill";
import { RELEASE_REACH_VALUES, type Release, type ReleaseReach } from "@/modules/content/variant";
import { now } from "@/modules/time/clock";
/** The three reach values a released edition may carry, in the order every surface offers them: Not public, Shared by link: public, and Listed publicly. */
export const REACH_VALUES = RELEASE_REACH_VALUES;
/** One reach value, derived from {@link REACH_VALUES} so a new member can never appear in the vocabulary without also being a valid `Release["reach"]`. */
export type Reach = ReleaseReach;
export type ReachableEdition = { readonly reach: Reach; readonly withdrawnAt?: Temporal.Instant | string | null };
export type ReachMetadata = { readonly listed: boolean; readonly indexable: boolean; readonly robots?: "noindex" };
export type ReachDecision = { readonly status: "changed"; readonly reach: Reach } | { readonly status: "unchanged"; readonly reach: Reach } | { readonly status: "invalid"; readonly reason: string };
export type Tombstone = { readonly robots: "noindex"; readonly body: string };
export type Withdrawal = { readonly release: Release; readonly tombstone: Tombstone };
export type WithdrawEditionResult = Withdrawal & { readonly status: "withdrawn" };
export type ContainEditionsResult = { readonly status: "contained"; readonly withdrawals: readonly Withdrawal[] };
const TOMBSTONE_BODY = "This page is no longer available.";
const isReach = (value: string): value is Reach => REACH_VALUES.some((reach) => reach === value);
export function decideReach(current: Reach, requested: string): ReachDecision {
  if (!isReach(requested)) return { status: "invalid", reason: `"${requested}" is not a reach setting. Reach is one of ${REACH_VALUES.join(", ")}.` };
  if (requested === current) return { status: "unchanged", reach: current };
  return { status: "changed", reach: requested };
}
const isWithdrawn = (edition: ReachableEdition): boolean => edition.withdrawnAt !== undefined && edition.withdrawnAt !== null;
/** Whether the discovery index enumerates this edition: true only for a `listed` edition that has not been withdrawn. */
export const isListedPublicly = (edition: ReachableEdition): boolean => edition.reach === "listed" && !isWithdrawn(edition);
/** Whether a direct link to this edition may be served: true only for a non-withdrawn `link-public` or `listed` release, and false for `not-public`, for any withdrawn edition and for a stored. */
export function isDirectlyReadable(edition: ReachableEdition): boolean {
  if (isWithdrawn(edition)) return false;
  return edition.reach === "link-public" || edition.reach === "listed";
}
export function reachMetadata(edition: ReachableEdition): ReachMetadata {
  if (isListedPublicly(edition)) return { listed: true, indexable: true };
  if (edition.reach === "link-public" || isWithdrawn(edition)) return { listed: false, indexable: false, robots: "noindex" };
  return { listed: false, indexable: false };
}
const withdrawalOf = (release: Release, at: Temporal.Instant): Withdrawal => ({ release: isWithdrawn(release) ? release : { ...release, withdrawnAt: at }, tombstone: { robots: "noindex", body: TOMBSTONE_BODY } });
/** Withdraws one edition, and answers the non-identifying tombstone its address serves from now on. */
export const withdrawEdition = (release: Release, options?: { readonly at?: Temporal.Instant }): WithdrawEditionResult => ({ status: "withdrawn", ...withdrawalOf(release, options?.at ?? now()) });
/** Stop showing me publicly*: withdraws every edition a document holds — every locale and every audience — and returns one list the caller persists in a single store transaction. */
export function containEditions(releases: readonly Release[], options?: { readonly at?: Temporal.Instant }): ContainEditionsResult {
  const at = options?.at ?? now();
  return { status: "contained", withdrawals: releases.map((release) => withdrawalOf(release, at)) };
}
