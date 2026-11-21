import type { ReactNode } from "react";

import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import {
  translationStaleness,
  type ContentVariant,
  type Release,
  type ReleaseOutcome,
  type TranslationSourceContext,
} from "@/modules/content/variant";

/**
 * The one draft, candidate and release indicator for every Update and every Worker or Project Page
 * edition.
 *
 * A content edition passes through states that look alike from a distance and mean very different
 * things up close: work that has never been written, a saved draft, a revision frozen for review, a
 * published revision, a publication that only partly landed, a withdrawal, a head that has been
 * replaced, and a translation whose source has moved on. AAP 0.8.5 requires four of them to stay
 * distinct — `draft`, `submitted candidate`, `current release`, `withdrawn` — and adds
 * `superseded head`; the Continuity requirement adds "saved draft is visually distinct from
 * published". Two feature families (Ministry Updates and Worker/Project Pages) show those states,
 * so a second vocabulary would let the same record be called "Published" on one screen and "Live" on
 * another, and would let one family quietly present a candidate as though it were already published.
 *
 * This file therefore owns two things and nothing else:
 *
 * - {@link lifecycleOf}, the single derivation from the service's `ContentVariant` and `Release`
 *   records to one member of {@link ContentLifecycleState}. It reads pointers the service supplies
 *   and computes no new fact about the content: whether an edition is readable is `reach.ts`'s
 *   decision, surfaced by the read envelope, and is deliberately not answered here.
 * - {@link DraftStatus}, the single rendering: one word from {@link LIFECYCLE_STATUS} painted through
 *   `components/status-badge`, plus the one sentence saying what that state permits.
 *
 * What it refuses to state, because another surface owns it:
 *
 * - Send and delivery outcomes. `accepted`, `failed` and `unknown` describe a submitted notice, not a
 *   publication, and they live in `operation-result.tsx` and the delivery surfaces. A release is not
 *   a message: nothing here claims that publishing notified anybody, and the `released` wording says
 *   so.
 * - Reach. `not-public`, `link-public` and `listed` are a separate axis on a released edition, mapped
 *   by `status-badge`'s `REACH_STATUS`, and folding them in would leave one badge saying two things.
 * - Development-data and simulated-effect wording, which belongs to `dev-banner.tsx` and
 *   `simulation-label.tsx`.
 *
 * Direction and tokens. Direction is a property of the content, so no physical spacing utility and no
 * base direction is set here: a caller-supplied locale tag or formatted instant renders inside
 * `<bdi>` so a Latin tag inside a right-to-left edition cannot reorder the sentence, and every class
 * is a logical, token-resolved utility. No colour, radius, shadow or spacing literal appears: the
 * tone comes from `StatusBadge`, which is the one place a semantic tone becomes a design-system
 * surface.
 *
 * It holds no state, reads no clock, fetches nothing, formats no money and mints no identifier, so a
 * Server Component and a Client Component render it alike and it carries no `use client` boundary of
 * its own.
 */

/**
 * Every state an edition can be in, listed once so the closed set has a runtime form as well as a
 * type. The order is the order a reader meets them — before work, during work, in review, published,
 * partly published, withdrawn, replaced, and a translation that has fallen behind.
 */
export const CONTENT_LIFECYCLE_STATES = [
  "not-started",
  "draft",
  "candidate",
  "released",
  "partially-released",
  "withdrawn",
  "superseded-head",
  "stale-translation",
] as const;

/** One state of an edition. A state outside this union cannot be rendered by {@link DraftStatus}. */
export type ContentLifecycleState = (typeof CONTENT_LIFECYCLE_STATES)[number];

/**
 * The word, the tone and the meaning of one lifecycle state.
 *
 * The word is required, not decorative: a badge whose state lived only in its colour would tell a
 * reader who cannot distinguish the tones — or a reader of a greyscale print — nothing at all. The
 * sentence beside it says what the state permits, because "Submitted for review" and "Published"
 * differ by more than their tone: one can be reviewed, the other can be read.
 */
export interface LifecycleSpec {
  /** Reader-facing state word. Never a class name, an icon key or a colour. */
  readonly label: string;
  /** How the state reads. Resolved to a badge surface by `components/status-badge`. */
  readonly tone: StatusTone;
  /** One sentence stating what this state permits and, where it matters, what it does not prove. */
  readonly explanation: string;
}

/**
 * The whole lifecycle vocabulary: one exhaustive record over the closed union, so a state added
 * without its word, tone and sentence is a compile error rather than an unlabelled chip.
 *
 * The tones keep the states apart on screen as well as in words: a `draft` is the quiet neutral chip
 * and never the positive tone a `released` edition carries; `withdrawn` is the destructive tone
 * because it is the one state that ends a reader's access; `partially-released` and
 * `stale-translation` take the caution tone because both ask the worker to look, while a
 * `superseded-head` and an unwritten edition stay muted as history and absence respectively.
 *
 * The wording keeps three promises of Rule 1 clause 3 apart: publishing is not notifying, a save is
 * not a release, and a withdrawn edition is a tombstone rather than a deleted source. Each sentence
 * is written to be true on its own, because a reader who stops at the badge still needs to know what
 * it permits.
 */
export const LIFECYCLE_STATUS: Readonly<Record<ContentLifecycleState, LifecycleSpec>> = {
  "not-started": {
    label: "Not started",
    tone: "muted",
    explanation:
      "Nothing has been written for this audience and language yet, so there is nothing to review and nothing to read.",
  },
  draft: {
    label: "Draft",
    tone: "neutral",
    explanation:
      "Saved and unpublished. A saved draft is not a release, so no audience can read it.",
  },
  candidate: {
    label: "Submitted for review",
    tone: "info",
    explanation:
      "Frozen for its one review step. A reviewer can approve it or ask for changes, and only a release lets an audience read it.",
  },
  released: {
    label: "Published",
    tone: "positive",
    explanation:
      "Published for this audience and language, so an authorised reader can open the released revision. Releasing sends no message.",
  },
  "partially-released": {
    label: "Partially released",
    tone: "caution",
    explanation:
      "Published for this audience and language. Another edition in the same release attempt kept its earlier published revision, which was not rolled back.",
  },
  withdrawn: {
    label: "Withdrawn",
    tone: "danger",
    explanation:
      "No longer available to this audience, and the edition now reads as a tombstone. Withdrawing deleted no source work and recalled no copy a reader already received.",
  },
  "superseded-head": {
    label: "Superseded",
    tone: "muted",
    explanation:
      "Published once and since replaced by a later release of this edition, so it is no longer the current publication.",
  },
  "stale-translation": {
    label: "Translation stale",
    tone: "caution",
    explanation:
      "The source revision this translation copied is no longer current. Nothing was withdrawn and nothing needs re-approval, but the translation no longer reflects the source.",
  },
};

/**
 * One variant's outcome from the last release attempt, paired with the variant it belongs to.
 *
 * `ReleaseOutcome` reports one variant's result and its `failed` member carries no variant id,
 * because the caller holds one outcome per variant. Re-attaching that id is what lets
 * {@link lifecycleOf} answer "did a sibling edition fail while this one succeeded?" without a second
 * mapping of its own, and without guessing from a reason string.
 */
export interface VariantReleaseOutcome {
  /** The variant this attempt was for. */
  readonly variantId: string;
  /** What happened to that variant's attempt. */
  readonly outcome: ReleaseOutcome;
}

/**
 * The facts {@link lifecycleOf} reads besides the two records themselves — both optional, because a
 * surface that has not run a release attempt or shown a translation has neither.
 */
export interface LifecycleEvidence {
  /**
   * The per-variant outcomes of the last release attempt, when the caller has them. An edition that
   * released while a sibling failed is `partially-released`; without this evidence it can only be
   * reported as `released`, which is why a publish result surface passes it.
   */
  readonly synthesis?: readonly VariantReleaseOutcome[];
  /**
   * The source edition a manual translation was made from, resolved by the caller. Staleness is
   * asked of `translationStaleness` rather than re-derived here, so the two families and the domain
   * module cannot disagree about whether a translation is behind.
   */
  readonly translationSource?: TranslationSourceContext;
}

/**
 * Derives the one lifecycle state of an edition from the records the service supplies.
 *
 * `release` is the release the surface is about — normally the variant's head, and sometimes a
 * specific release from its history, such as the one a withdrawal notice names. A release belonging
 * to another variant is ignored rather than reported, because presenting one edition's publication
 * as another's would be a false statement about what a reader can open.
 *
 * The order of the checks is the order of the claims, strongest first:
 *
 * 1. `withdrawn` — an explicit withdrawal ends availability, so it is stated ahead of every
 *    forward-looking state. A withdrawn edition that later gains a draft or a candidate is still a
 *    tombstone to its audience, and the sentence says a new draft can be published again.
 * 2. `superseded-head` — the release has been replaced, either because a later release stamped it or
 *    because the variant's head is a different release. It was published once, so it is not a draft.
 * 3. `candidate` — a frozen revision awaiting its single review step. A candidate is never a release:
 *    review approves or refuses content, and only a release makes it readable. This check sits above
 *    the release checks because a pending review on a published edition is the fact that needs
 *    attention, and the state word never claims the edition was published.
 * 4. `partially-released` / `released` — a head release that is still current. The two are separate
 *    words because the first must not read as a rolled-back batch: this variant's release succeeded,
 *    a sibling kept its prior-good head, and both facts stand.
 * 5. `stale-translation` — no candidate and no current release, and the recorded source revision is
 *    no longer the source's current revision. Staleness is reported, never acted on: it is not a
 *    withdrawal and it is not unapproved content, so it outranks a plain `draft` (it is the more
 *    specific fact the worker needs) and never outranks a publication.
 * 6. `draft`, then `not-started` — a revision is saved, or nothing is.
 *
 * A variant's own failed attempt is not a lifecycle state. It has no release to describe, and the
 * failure belongs to the release result surface, which reports the reason per variant.
 */
export function lifecycleOf(
  variant: ContentVariant,
  release?: Release,
  evidence?: LifecycleEvidence,
): ContentLifecycleState {
  const current =
    release !== undefined && release.variantId === variant.variantId ? release : undefined;

  if (current !== undefined) {
    if (current.withdrawnAt !== undefined) {
      return "withdrawn";
    }
    if (
      current.supersededBy !== undefined ||
      (variant.releaseHeadId !== undefined && variant.releaseHeadId !== current.releaseId)
    ) {
      return "superseded-head";
    }
  }

  if (variant.candidateId !== undefined) {
    return "candidate";
  }

  if (current !== undefined) {
    return siblingFailed(variant, evidence) ? "partially-released" : "released";
  }

  if (translationIsStale(variant, evidence)) {
    return "stale-translation";
  }

  return variant.draftRevisionId !== undefined ? "draft" : "not-started";
}

/**
 * Whether another variant's attempt failed in the same release, which is what makes this variant's
 * own success partial rather than complete. Only siblings count: this variant's failure is reported
 * by the release result, not folded into its lifecycle.
 */
function siblingFailed(variant: ContentVariant, evidence: LifecycleEvidence | undefined): boolean {
  const synthesis = evidence?.synthesis;
  if (synthesis === undefined) {
    return false;
  }
  return synthesis.some(
    (entry) => entry.variantId !== variant.variantId && entry.outcome.status === "failed",
  );
}

/**
 * Whether a manual translation has fallen behind its source, asked of `translationStaleness` so the
 * rule stays in one place. A variant that is not a translation reports `none` there, and a caller
 * that supplies no source evidence cannot be told the translation is stale.
 */
function translationIsStale(
  variant: ContentVariant,
  evidence: LifecycleEvidence | undefined,
): boolean {
  const source = evidence?.translationSource;
  return source !== undefined && translationStaleness(variant, source).status === "stale";
}

/**
 * The specification of a state, refusing a value the vocabulary has no word for.
 *
 * The union makes an unrecognised state a compile error, but a feature reading a state out of a
 * response can still cast one in. Rendering nothing would leave an edition's lifecycle unstated,
 * which is the one outcome this component exists to prevent, so the defect is reported instead of
 * being silently painted as a blank chip.
 */
function specFor(state: ContentLifecycleState): LifecycleSpec {
  if (!Object.hasOwn(LIFECYCLE_STATUS, state)) {
    throw new Error(
      `DraftStatus received a lifecycle state it has no wording for: "${String(state)}". ` +
        "Every state must state its word, tone and meaning, so add the member to " +
        "CONTENT_LIFECYCLE_STATES and LIFECYCLE_STATUS instead of passing a value the interface " +
        "cannot describe.",
    );
  }

  return LIFECYCLE_STATUS[state];
}

/**
 * The sentence naming which source edition has moved on, when the caller knows.
 *
 * Both values are the caller's: a locale tag it already holds and an instant it has already
 * formatted, so this component formats no date and no interval of its own. Each renders inside
 * `<bdi>` — a Latin tag or an ISO-shaped date inside a right-to-left paragraph is a run of opposite
 * direction, and isolating it is what keeps the surrounding sentence in logical order.
 */
function staleDetail(since: string | undefined, locale: string | undefined): ReactNode | null {
  const at = since === undefined ? "" : since.trim();
  const source = locale === undefined ? "" : locale.trim();

  if (source !== "" && at !== "") {
    return (
      <>
        Source edition <bdi>{source}</bdi> changed on <bdi>{at}</bdi>.
      </>
    );
  }
  if (source !== "") {
    return (
      <>
        Source edition <bdi>{source}</bdi> changed after this translation was written.
      </>
    );
  }
  if (at !== "") {
    return (
      <>
        Source changed on <bdi>{at}</bdi>.
      </>
    );
  }
  return null;
}

/** Props of {@link DraftStatus}. */
export interface DraftStatusProps {
  /** The edition's state, as {@link lifecycleOf} derived it from the service's records. */
  readonly state: ContentLifecycleState;
  /**
   * When the source revision a manual translation copied was replaced, already formatted by the
   * caller. Supplied for a stale translation, and for any state where the underlying edition is a
   * translation that has fallen behind its source.
   */
  readonly staleSince?: string;
  /**
   * The locale tag of the source edition that moved on, for example `en`. Rendered isolated, so it
   * reads correctly inside a right-to-left edition.
   */
  readonly staleLocale?: string;
  /**
   * Layout classes for the surface the indicator sits in, using logical utilities only (`ms-*`,
   * `mt-*`), so it keeps its place in a right-to-left row. Never a colour, radius or shadow.
   */
  readonly className?: string;
}

/**
 * The lifecycle indicator: the state word, the concrete staleness detail when there is one, and the
 * sentence saying what the state permits.
 *
 * The three parts sit in one element so a screen reader hears them together — the badge is announced
 * as "Status: Draft" and the sentence follows it — rather than reading an orphaned state word
 * somewhere else on the row. Layout is a column that wraps: the word and detail share a line where
 * there is room, and both stay inside a 320 CSS px viewport instead of forcing the page sideways.
 */
export function DraftStatus({
  state,
  staleSince,
  staleLocale,
  className,
}: DraftStatusProps): ReactNode {
  const spec = specFor(state);
  const detail = staleDetail(staleSince, staleLocale);

  return (
    <div
      data-slot="draft-status"
      data-lifecycle-state={state}
      className={cn("flex min-w-0 flex-col items-start gap-1", className)}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge label={spec.label} tone={spec.tone} srPrefix="Status" />
        {detail === null ? null : (
          <span className="text-xs text-muted-foreground text-pretty wrap-anywhere">
            {detail}
          </span>
        )}
      </span>
      <p className="text-start text-sm text-muted-foreground text-pretty wrap-anywhere">
        {spec.explanation}
      </p>
    </div>
  );
}

export default DraftStatus;
