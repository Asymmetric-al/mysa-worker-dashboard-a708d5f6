/**
 * The application's one reach rule: how far one released edition reaches — not public, public by
 * link only, or listed publicly — and what withdrawing an edition does, and does not, do.
 *
 * Plan items that put this file in scope:
 * - AAP 0.11.1, the fourth of the seven `apps/dashboard/src/modules/content/*` deliverables.
 * - AAP 0.6.1 "Content module" row: the content module owns reach, and its consumers are
 *   `data-service/mutations/content.ts` (`setReach`, `stopShowingPublicly`, `withdrawPage`,
 *   `withdrawLocale`, `withdrawUpdate`) and `data-service/reads/audience.ts` (`readDiscoveryIndex`,
 *   `readReceivingPage`).
 * - AAP 0.8.6 reach rule: exactly three reach values, with a real discovery index at
 *   `/preview/pages` that enumerates only `listed` editions and a real direct-link route at
 *   `/preview/pages/[pageId]/[locale]` that serves an admitted release, answers `noindex` for a
 *   `link-public` edition and a safe opaque tombstone once withdrawn; restriction and withdrawal
 *   take effect in the same read that produces the removal; *Stop showing me publicly* works even
 *   when an unrelated draft is invalid and contains every locale edition immediately.
 * - AAP 0.3.2 security architecture and 0.6.3 thin route handlers: this module answers decisions.
 *   The route layer owns the status code, the framework `Metadata` object, cache headers and the
 *   rendered tombstone page, which is why nothing here imports `next/*`, states a header, a
 *   directive or a status, or produces markup.
 *
 * Four states that never merge:
 * - `not-public` means the edition serves nobody: neither the index nor the direct link.
 * - `link-public` means readable by anyone holding the link, unlisted and `noindex`.
 * - `listed` means readable by link and enumerated by the discovery index, so it may be indexed.
 * - `withdrawn` is a fact about a release, not a fourth reach value: a withdrawn edition keeps its
 *   reach value and its identity and is refused everywhere. Reaching fewer readers is a change of
 *   setting; withdrawal is an end of service.
 * - Leaving the index is not the same as answering a tombstone. A withdrawn edition disappears from
 *   the index *and* answers a non-identifying tombstone at its own address, because a link already
 *   shared must not become a 404 that reads as "this never existed" or, worse, as "try again".
 *
 * Withdrawal is neither deletion nor editorial cleanup, and the distinctions are load-bearing for
 * every surface that reads them:
 * - A withdrawn release keeps its identity: `withdrawnAt` is set and nothing else about the record
 *   changes. It is not an archived draft (a draft was never a publication), it is not a superseded
 *   release (`supersededBy` is `variant.ts`'s separate concept for a head that a later release
 *   replaced), and it is not a deleted source asset (bytes in media custody are a different
 *   decision). Withdrawal removes access from now on; it never claims to recall a message already
 *   sent or a copy a third party already holds, and no surface may say it does.
 * - An edition can be withdrawn one locale at a time — the `withdrawLocale` mutation — while its
 *   siblings stay readable. Only {@link containEditions} touches every edition of a document, and it
 *   says so in its name and in the list it returns.
 *
 * Containment outranks editorial state. {@link containEditions} reads nothing but the releases it is
 * handed, so it is callable while a sibling draft fails validation, while a candidate awaits review
 * and while a preview cannot render: stopping public display is a containment decision and never
 * waits for editorial cleanup.
 *
 * Reach is not publication success. This module never sets `publishedAt`, never marks a candidate
 * released, never advances a release head and never records a notification: publishing an edition
 * and choosing how far it reaches are two separate actions, and reach is a discoverability setting
 * rather than a statement that anything was delivered.
 *
 * Fail-closed, and stateless. The two predicates compare against named reach values, so a stored
 * value outside the vocabulary — a hand-edited document, a value from an earlier edition of this
 * rule — is neither listed nor directly readable rather than reaching a reader by default. Both
 * predicates are derived from the same release fields, so a caller cannot meet "listed in the index
 * but refused at the route" or the reverse, and nothing here caches, memoises or remembers: the same
 * release always answers the same way, in the same read.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. It
 * imports the release record and the closed reach vocabulary from `variant.ts`, the scenario clock,
 * and the `Temporal` type. It imports no store, no data service, no media module, no feature, no
 * component and no framework, holds no state, performs no I/O and touches no money or media byte.
 *
 * Time is a parameter. A caller that wants an exact withdrawal instant supplies `at`; a caller that
 * omits it gets `now()` from `time/clock.ts`, the only clock in the application. This module
 * therefore never reads a machine clock, takes no seed and produces no randomness.
 */
import type { Temporal } from "temporal-polyfill";

import { RELEASE_REACH_VALUES, type Release, type ReleaseReach } from "@/modules/content/variant";
import { now } from "@/modules/time/clock";

// ---------------------------------------------------------------------------------------------
// The closed reach vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * The three reach values a released edition may carry, in the order every surface offers them:
 * Not public, Shared by link: public, and Listed publicly.
 *
 * The tuple itself is declared once, on the release record in `variant.ts`, where every stored reach
 * value is checked; this module exports it under the name the surfaces import so a feature never
 * restates the reach set in its own literal. There is no fourth value: a draft is not a reach
 * setting, an archived draft is not a reach setting, and withdrawal is a recorded fact about a
 * release rather than a member of this vocabulary.
 */
export const REACH_VALUES = RELEASE_REACH_VALUES;

/**
 * One reach value, derived from {@link REACH_VALUES} so a new member can never appear in the
 * vocabulary without also being a valid `Release["reach"]`.
 */
export type Reach = ReleaseReach;

// ---------------------------------------------------------------------------------------------
// What the decisions read, and what they answer
// ---------------------------------------------------------------------------------------------

/**
 * The facts a reach decision reads from one released edition: the reach value it carries, and
 * whether it was withdrawn.
 *
 * The record's identity, revision, checksum, audience, locale and publication instant are
 * deliberately absent, because no decision here depends on any of them — and a signature that asked
 * for them would invite a second read path that assembles them. A domain `Release` satisfies this
 * shape, and so does a persisted release document whose withdrawal instant is carried through as the
 * stored string: a present, non-null `withdrawnAt` of either form means the edition was withdrawn,
 * and `undefined` or `null` means it still serves.
 */
export interface ReachableEdition {
  /** The reach value the edition carries. */
  readonly reach: Reach;
  /** The instant the edition was withdrawn, in whichever form the caller stores it; absent while it serves. */
  readonly withdrawnAt?: Temporal.Instant | string | null;
}

/**
 * What an edition's reach permits on the two delivery surfaces, as plain data.
 *
 * `listed` says whether the discovery index enumerates this edition; `indexable` says whether a
 * crawler may index it; `robots: "noindex"` is the directive the route layer emits when it is
 * present. A caller maps these onto its own `Metadata` object or document head — this module holds
 * no framework type, no header name and no cache directive, so the same answer serves the page
 * route, the print view and a test.
 */
export interface ReachMetadata {
  /** Whether the discovery index enumerates this edition. */
  readonly listed: boolean;
  /** Whether a crawler may index this edition. */
  readonly indexable: boolean;
  /** The `noindex` directive, present exactly when the edition must stay out of an index. */
  readonly robots?: "noindex";
}

/** The three answers {@link decideReach} gives, one per request. */
export type ReachDecision =
  | {
      /** The request moves the edition to a different reach value. */
      readonly status: "changed";
      /** The value to store. */
      readonly reach: Reach;
    }
  | {
      /** The request states the value the edition already carries, so nothing is written. */
      readonly status: "unchanged";
      /** The value the edition already carries. */
      readonly reach: Reach;
    }
  | {
      /** The request is not one of {@link REACH_VALUES} and changes nothing. */
      readonly status: "invalid";
      /** Why the request was refused, in words the authoring form can show as it stands. */
      readonly reason: string;
    };

/**
 * What a reader sees at the address of a withdrawn edition: a `noindex` document carrying one fixed
 * message and nothing about what stood there.
 *
 * The body is the same text for every withdrawal, so it names no title, author, organization, locale,
 * identifier or figure, and no caller can make it identify the edition by passing one in.
 */
export interface Tombstone {
  /** The `noindex` directive, so a tombstone is never indexed as the page it replaced. */
  readonly robots: "noindex";
  /** The fixed, non-identifying message the withdrawn address answers with. */
  readonly body: string;
}

/** One edition's withdrawal: the release with its withdrawal recorded, and the tombstone it answers. */
export interface Withdrawal {
  /** The release after withdrawal: `withdrawnAt` is set and nothing else is touched. */
  readonly release: Release;
  /** The non-identifying tombstone served at the edition's own address. */
  readonly tombstone: Tombstone;
}

/** The outcome of withdrawing one edition: always `withdrawn`, with the record and its tombstone. */
export interface WithdrawEditionResult extends Withdrawal {
  /** One edition was withdrawn, or already was and keeps its recorded instant. */
  readonly status: "withdrawn";
}

/** The outcome of *Stop showing me publicly*: one withdrawal per release the document held. */
export interface ContainEditionsResult {
  /** Containment always completes, because it depends on no editorial state. */
  readonly status: "contained";
  /** Every release the document held, each with its withdrawal recorded and its tombstone. */
  readonly withdrawals: readonly Withdrawal[];
}

// ---------------------------------------------------------------------------------------------
// The fixed tombstone message
// ---------------------------------------------------------------------------------------------

/**
 * The one message a withdrawn address answers with. It is constant rather than a parameter so no
 * caller can put a title, a name, a locale or an identifier into it, and it says only that the page
 * is gone: it does not imply an error to retry, a draft that might return, or content that moved.
 */
const TOMBSTONE_BODY = "This page is no longer available.";

// ---------------------------------------------------------------------------------------------
// Choosing a reach value
// ---------------------------------------------------------------------------------------------

/** Whether a submitted value is one of the three reach values, narrowing it for the caller. */
function isReach(value: string): value is Reach {
  return REACH_VALUES.some((reach) => reach === value);
}

/**
 * Decides what a request to change one edition's reach does: `changed` with the value to store,
 * `unchanged` when the edition already carries it, or `invalid` with the reason when the submitted
 * value is not one of {@link REACH_VALUES}.
 *
 * `unchanged` is an answer rather than a refusal, and the service maps it onto its own `unchanged`
 * outcome so re-saving the same setting writes no history entry and moves no revision. A reach
 * change is a discoverability change only: this function returns the value to store, and publishing,
 * withdrawing or notifying stay separate actions that no reach request performs.
 */
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

// ---------------------------------------------------------------------------------------------
// Reading an edition: the index, the direct link, and the directives the route emits
// ---------------------------------------------------------------------------------------------

/** Whether the edition carries a withdrawal, in whichever form the caller stores the instant. */
function isWithdrawn(edition: ReachableEdition): boolean {
  return edition.withdrawnAt !== undefined && edition.withdrawnAt !== null;
}

/**
 * Whether the discovery index enumerates this edition: true only for a `listed` edition that has not
 * been withdrawn.
 *
 * This is the single predicate `/preview/pages` uses, so a `link-public` edition stays out of the
 * index while remaining readable by link, a `not-public` edition is absent from it, and a withdrawn
 * edition leaves it in the same read that records the withdrawal. A stored value outside the
 * vocabulary answers `false`, so an unrecognised reach value can never reach a reader by default.
 */
export function isListedPublicly(edition: ReachableEdition): boolean {
  return edition.reach === "listed" && !isWithdrawn(edition);
}

/**
 * Whether a direct link to this edition may be served: true only for a non-withdrawn `link-public` or
 * `listed` release, and false for `not-public`, for any withdrawn edition and for a stored value
 * outside the vocabulary.
 *
 * The predicate answers about the release it is given; which release a variant currently serves is
 * `variant.ts`'s `releaseHeadId`, and which reader may see it is `audience/`'s eligibility decision.
 * Keeping those two questions out of this function is what lets the index and the direct route agree:
 * both ask this module about the same release record.
 */
export function isDirectlyReadable(edition: ReachableEdition): boolean {
  if (isWithdrawn(edition)) {
    return false;
  }
  return edition.reach === "link-public" || edition.reach === "listed";
}

/**
 * States what an edition's reach permits as plain data: `listed` and `indexable` are true only for a
 * non-withdrawn `listed` edition, and `robots: "noindex"` is present for a `link-public` edition and
 * for any withdrawn edition.
 *
 * The route layer maps this onto its own `Metadata` object or document head, so no framework type
 * crosses this boundary. A `not-public` edition is refused at the route rather than served with a
 * directive, which is why it answers neither flag and no directive.
 */
export function reachMetadata(edition: ReachableEdition): ReachMetadata {
  if (isListedPublicly(edition)) {
    return { listed: true, indexable: true };
  }
  if (edition.reach === "link-public" || isWithdrawn(edition)) {
    return { listed: false, indexable: false, robots: "noindex" };
  }
  return { listed: false, indexable: false };
}

// ---------------------------------------------------------------------------------------------
// Withdrawal: one edition, and every edition of a document
// ---------------------------------------------------------------------------------------------

/**
 * The withdrawal of one edition at a stated instant: the release with `withdrawnAt` recorded, and the
 * tombstone its address answers.
 *
 * An edition that already carries a withdrawal keeps the instant it was withdrawn at, so withdrawing
 * twice dates the withdrawal once — which is what lets a service report the second request as
 * `unchanged` rather than writing a second history entry.
 */
function withdrawalOf(release: Release, at: Temporal.Instant): Withdrawal {
  return {
    release: isWithdrawn(release) ? release : { ...release, withdrawnAt: at },
    tombstone: { robots: "noindex", body: TOMBSTONE_BODY },
  };
}

/**
 * Withdraws one edition, and answers the non-identifying tombstone its address serves from now on.
 *
 * The release keeps its identity and its reach value: withdrawal removes access rather than deleting
 * the record, and it is neither an archived draft, nor a supersession of the variant's head, nor a
 * deletion of the source media the edition placed. Nothing is claimed about copies already received:
 * a message already sent and a page a third party already holds are outside this application's
 * recall, and no surface may say otherwise.
 *
 * An edition already withdrawn is answered unchanged with its recorded instant, so a direct read of a
 * withdrawn address obtains its tombstone here without writing anything: this module has no side
 * effect and the returned release is the caller's to persist, or not.
 *
 * @param release The edition being withdrawn.
 * @param options.at The scenario instant to record; the clock is read only when it is omitted.
 */
export function withdrawEdition(
  release: Release,
  options?: { readonly at?: Temporal.Instant },
): WithdrawEditionResult {
  return { status: "withdrawn", ...withdrawalOf(release, options?.at ?? now()) };
}

/**
 * *Stop showing me publicly*: withdraws every edition a document holds — every locale and every
 * audience — and returns one list the caller persists in a single store transaction.
 *
 * Containment reads nothing but the releases it is handed. It takes no validation result, review
 * state, rendered preview or draft status, so it completes while an unrelated draft of the same
 * document is invalid: stopping public display is a containment decision, and making the author
 * repair prose first would leave a page public that they asked to take down.
 *
 * One instant is used for every edition, so the whole document leaves public display at the same
 * moment, and an edition that was already withdrawn keeps its own earlier instant rather than being
 * re-dated. A document with nothing released contains nothing and returns an empty list.
 */
export function containEditions(
  releases: readonly Release[],
  options?: { readonly at?: Temporal.Instant },
): ContainEditionsResult {
  const at = options?.at ?? now();
  return {
    status: "contained",
    withdrawals: releases.map((release) => withdrawalOf(release, at)),
  };
}
