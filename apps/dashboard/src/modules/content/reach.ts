import type { Temporal } from "temporal-polyfill";
import { RELEASE_REACH_VALUES, type Release, type ReleaseReach } from "@/modules/content/variant";
import { now } from "@/modules/time/clock";
export const REACH_VALUES = RELEASE_REACH_VALUES;
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
export const decideReach = (current: Reach, requested: string): ReachDecision =>
  isReach(requested) ? (requested === current ? { status: "unchanged", reach: current } : { status: "changed", reach: requested }) : { status: "invalid", reason: `"${requested}" is not a reach setting. Reach is one of ${REACH_VALUES.join(", ")}.` };
export const isWithdrawn = (edition: { readonly withdrawnAt?: Temporal.Instant | string | null }): boolean => edition.withdrawnAt !== undefined && edition.withdrawnAt !== null;
export const isSuperseded = (edition: { readonly supersededBy?: unknown }): boolean => typeof edition.supersededBy === "string" && edition.supersededBy.trim().length > 0;
export const isListedPublicly = (edition: ReachableEdition): boolean => edition.reach === "listed" && !isWithdrawn(edition);
/** Whether a direct link to this edition may be served: true only for a non-withdrawn `link-public` or `listed` release, and false for `not-public`, for any withdrawn edition and for a stored. */
export const isDirectlyReadable = (edition: ReachableEdition): boolean => (isWithdrawn(edition) ? false : edition.reach === "link-public" || edition.reach === "listed");
export const reachMetadata = (edition: ReachableEdition): ReachMetadata => (isListedPublicly(edition) ? { listed: true, indexable: true } : edition.reach === "link-public" || isWithdrawn(edition) ? { listed: false, indexable: false, robots: "noindex" } : { listed: false, indexable: false });
const withdrawalOf = (release: Release, at: Temporal.Instant): Withdrawal => ({ release: isWithdrawn(release) ? release : { ...release, withdrawnAt: at }, tombstone: { robots: "noindex", body: TOMBSTONE_BODY } });
export const withdrawEdition = (release: Release, options?: { readonly at?: Temporal.Instant }): WithdrawEditionResult => ({ status: "withdrawn", ...withdrawalOf(release, options?.at ?? now()) });
/** Stop showing me publicly*: withdraws every edition a document holds — every locale and every audience — and returns one list the caller persists in a single store transaction. */
export const containEditions = (releases: readonly Release[], { at = now() }: { readonly at?: Temporal.Instant } = {}): ContainEditionsResult => ({ status: "contained", withdrawals: releases.map((release) => withdrawalOf(release, at)) });
