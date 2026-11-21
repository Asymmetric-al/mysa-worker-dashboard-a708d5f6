"use client";
/**
 * The Worker and Project Pages review route: this family's context wrapped around the one shared review panel.
 *
 * A reviewer answers one frozen candidate, and that answer concerns one language edition of one Page. What
 * releasing that edition would mean is decided by two facts that live with the Page rather than with the
 * revision — how far its releases reach, and whether an approved giving designation exists — so they are
 * stated beside the decision instead of being left on the builder's screen. The panel, its frozen-revision
 * display, its decision step and its receipt belong to the shared component; this file composes them, and
 * every answer it dispatches is the family's own mutation.
 */
import { useCallback, useId, useState, type ReactElement } from "react";
import { DraftStatus, type ContentLifecycleState } from "@/components/draft-status";
import ReviewPanel, { type CandidateMediaRendition, type CandidateView, type RecordedCandidateDecision, type ReviewPanelProps } from "@/components/review-panel";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge from "@/components/status-badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { copy, type PageFamily } from "../copy";
import { useApprovePageCandidate, useRequestPageChanges } from "../hooks/use-release-mutations";
import type { ApproveCandidateInput, ApproveCandidatePayload, CreateVariantPayload } from "../schemas/release";
import GivingDesignation, { type GivingBindingView } from "./giving-designation";
import ReachControl, { type ReachControlProps } from "./reach-control";

// ---------------------------------------------------------------------------------------------
// Types, derived from the modules that own them rather than restated here
// ---------------------------------------------------------------------------------------------

/** The authority a Page review is given in, taken from the family's own mutation so this file never restates the scope it acts under. */
type PageReviewScope = ApproveCandidateInput["scope"];

/** What the shared panel hands its decision handler, and what that handler answers with: both read from the panel's own contract. */
type ReviewDecisionInput = Parameters<ReviewPanelProps["onDecide"]>[0];

type ReviewOutcome = Awaited<ReturnType<ReviewPanelProps["onDecide"]>>;

/** The one outcome this surface produces itself, for the answer it refuses rather than sends. */
type RefusedOutcome = Extract<ReviewOutcome, { readonly outcome: "invalid" }>;

/** The reach one released edition carries, taken from the control that sets it so this file holds no second copy of the three values. */
type PageReach = NonNullable<ReachControlProps["current"]>;

/** The one audience a Page edition has, taken from the payload the family's own schema creates, so a second audience could not compile here. */
type PageAudience = CreateVariantPayload["audience"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The release intent a Page approval always carries. The family schema names this field `notifyMode`, and its
 * only admitted value is `publish-only`: a Page release sends no notice at all, so there is nothing here a
 * reviewer could turn into a notification, and no second value this surface could send.
 */
const PUBLISH_ONLY = "publish-only" satisfies ApproveCandidatePayload["notifyMode"];

/** A Page edition is public: the approved-supporter audience belongs to an Update and never to a Page. */
const PAGE_AUDIENCE: PageAudience = "public";

/** The field key the receipt reads as a statement about the whole attempt rather than about one field of it. */
const ATTEMPT_FIELD_KEY = "_root";

/** What a rejection is answered with, because a Page candidate is answered by an approval or by a request for changes and by nothing else. */
const REJECTION_NOT_OFFERED = "A Page candidate is answered with an approval or a request for changes, so no rejection was recorded and nothing was applied. " + "Choose Request changes and say in the note what has to change: that answer gives the author a new revision to submit.";

/**
 * A review route is opened because an author submitted a frozen candidate for its one review step, so review is
 * the path this edition is on. The panel's "review is not required" state belongs to a surface where nothing
 * was submitted, and nothing here may reach it.
 */
const REVIEW_IS_REQUIRED = true;

/** A Page release sends no notice at all, so the author's release intent is always Publish only. */
const RELEASE_SENDS_NO_NOTICE = false;

/** The candidates this surface offers when the identity it was opened on states no frozen revision. */
const NO_CANDIDATES: readonly CandidateView[] = [];

// ---------------------------------------------------------------------------------------------
// What the review envelope carries, as this surface reads it
// ---------------------------------------------------------------------------------------------

/**
 * One language edition of the Page as the review read states it. An edition with no frozen candidate states
 * neither a revision nor a checksum: it has nothing to answer, and it is listed for its lifecycle alone.
 */
export type ReviewEditionView = {
  readonly variantId: string;
  /** The candidate this edition holds, when it holds one. This is the identity a decision is recorded against. */
  readonly candidateId?: string;
  /** The exact language edition, with the direction it is authored and read in. */
  readonly locale: CandidateView["locale"];
  /** The state this edition's own records state: its draft, its candidate, its release head or none of them. */
  readonly lifecycle: ContentLifecycleState;
  /** The revision frozen for review, and the checksum that identifies its content. Both are absent together. */
  readonly revisionId?: string;
  readonly contentChecksum?: string;
  /** The body the read rendered for the frozen revision, as the shared panel shows it. */
  readonly renderedHtml?: string;
  readonly mediaRenditions?: readonly CandidateMediaRendition[];
  /** Whether this edition is a translation of one that has since changed. Staleness is shown, and withdraws nothing. */
  readonly staleTranslation?: boolean;
  /** The decision already recorded for this candidate, or `null` while its record still stands at `submitted`. */
  readonly decisionRecord?: RecordedCandidateDecision | null;
};

/**
 * The Page a review route answers for: the document's identity, its family, the revision its record states,
 * and one entry per language edition. It adds no field the read does not state, so the route composes it
 * directly from the envelope rather than deriving anything the service already decided.
 */
export type ReviewDocumentView = {
  readonly documentId: string;
  readonly family: PageFamily;
  /**
   * The document record's revision. A Page-level change — its reach — states this as the revision it read, so
   * it is carried separately from the review envelope's own revision, which belongs to the edition.
   */
  readonly recordRevision: string;
  readonly editions: readonly ReviewEditionView[];
};

export type PageReviewSurfaceProps = {
  readonly document: ReviewDocumentView;
  /** The candidate the reviewer is answering. One identity: this surface offers no way to answer a second. */
  readonly candidateId: string;
  /** The revision the reviewer read, which the panel presents as the revision its decision expects. */
  readonly expectedRevision: string;
  /**
   * The authority every answer is given in. The service checks it against the caller's admitted memberships
   * instead of inferring it, so the surface that dispatches the answers has to carry that context.
   */
  readonly scope: PageReviewScope;
  /** The approved giving designation, or the reason giving is unavailable on this Page. */
  readonly givingBinding?: GivingBindingView;
  /** The reach the edition's release carries, or absent when this edition has published nothing to reach anyone. */
  readonly reach?: PageReach;
  readonly className?: string;
};

// ---------------------------------------------------------------------------------------------
// Reading the envelope onto the panel's contract
// ---------------------------------------------------------------------------------------------

/** The edition the review route named, resolved by the candidate it holds and then by the revision it froze. */
function reviewedEditionOf(editions: readonly ReviewEditionView[], candidateId: string): ReviewEditionView | undefined {
  const named = candidateId.trim();
  if (named === "") {
    return undefined;
  }
  return editions.find((edition) => edition.candidateId === named) ?? editions.find((edition) => edition.revisionId === named);
}

/** The identity a decision is recorded against: the candidate the edition itself holds, and the route's identity when the edition states none. */
function candidateIdentityOf(edition: ReviewEditionView | undefined, named: string): string {
  const held = edition?.candidateId?.trim() ?? "";
  return held === "" ? named.trim() : held;
}

/** The frozen edition as the shared panel reads it, or nothing when the edition states no frozen revision to answer. */
function candidateViewOf(edition: ReviewEditionView): CandidateView | undefined {
  const revisionId = edition.revisionId?.trim() ?? "";
  const contentChecksum = edition.contentChecksum?.trim() ?? "";
  if (revisionId === "" || contentChecksum === "") {
    return undefined;
  }
  return {
    variantId: edition.variantId,
    audience: PAGE_AUDIENCE,
    locale: edition.locale,
    revisionId,
    contentChecksum,
    renderedHtml: edition.renderedHtml ?? "",
    mediaRenditions: edition.mediaRenditions ?? [],
    lifecycle: edition.lifecycle,
    ...(edition.staleTranslation === undefined ? {} : { staleTranslation: edition.staleTranslation }),
    decisionRecord: edition.decisionRecord ?? null,
  };
}

/** The refusal a decision with no Page transport is answered with, stated as the receipt the reviewer reads in place. */
function refusalOf(operationId: string, message: string): RefusedOutcome {
  return { outcome: "invalid", operationId, fields: { [ATTEMPT_FIELD_KEY]: [message] } };
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The review of one frozen Page candidate: the Page's visibility and giving context, and the one decision the shared panel takes. */
export function PageReviewSurface({ document, candidateId, expectedRevision, scope, givingBinding, reach, className }: PageReviewSurfaceProps): ReactElement {
  const editionsTitleId = useId();
  const reachTitleId = useId();
  const givingTitleId = useId();
  // The panel reports which edition it was asked to show. This surface offers it one, so a selection names the
  // same edition it already shows; the state exists because the panel's contract names a selection handler, not
  // because a second edition is reachable from here.
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const { mutateAsync: approveCandidate } = useApprovePageCandidate();
  const { mutateAsync: requestChanges } = useRequestPageChanges();
  const reviewedEdition = reviewedEditionOf(document.editions, candidateId);
  const reviewedCandidate = reviewedEdition === undefined ? undefined : candidateViewOf(reviewedEdition);
  const activeVariantId = selectedVariantId ?? reviewedEdition?.variantId ?? "";
  const answeredCandidateId = candidateIdentityOf(reviewedEdition, candidateId);
  const decide = useCallback(
    async (input: ReviewDecisionInput): Promise<ReviewOutcome> => {
      const { operationId, expectedRevision: attemptRevision, scope: attemptScope, payload } = input;
      switch (payload.decision) {
        case "approved":
          // The attempt identity, the scope and the revision are the reviewed attempt's own, so a replay of this
          // answer returns its recorded result instead of answering the candidate a second time.
          return approveCandidate({ operationId, scope: attemptScope, expectedRevision: attemptRevision, payload: { candidateId: answeredCandidateId, notifyMode: PUBLISH_ONLY } });
        case "changes-requested":
          // An empty note is sent as it stands: the family schema refuses it with the message the receipt shows,
          // and nothing is written. Trimming it here would hide which field the author has to fill in.
          return requestChanges({ operationId, scope: attemptScope, expectedRevision: attemptRevision, payload: { candidateId: answeredCandidateId, reason: payload.note } });
        case "rejected":
          return refusalOf(operationId, REJECTION_NOT_OFFERED);
      }
    },
    [approveCandidate, requestChanges, answeredCandidateId],
  );
  return (
    <div data-slot="page-review-surface" data-page-family={document.family} data-reviewed-variant-id={reviewedEdition?.variantId} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <p data-slot="page-review-family" className="text-sm text-muted-foreground text-pretty">
        <bdi>{copy.families[document.family].label}</bdi>
      </p>
      <section aria-labelledby={editionsTitleId} data-slot="page-review-editions" className="flex min-w-0 flex-col gap-3">
        <h2 id={editionsTitleId} className="font-heading text-base font-medium text-pretty">
          {copy.editions.heading}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">{copy.review.approveNote}</p>
        {/* A Page with no edition has nothing to approve, and the list states that rather than standing empty. */}
        {document.editions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-pretty">{copy.states.emptyEditions}</p>
        ) : (
          <ul aria-labelledby={editionsTitleId} className="flex min-w-0 flex-col gap-3">
            {document.editions.map((edition) => {
              const underReview = edition.variantId === reviewedEdition?.variantId;
              return (
                <li key={edition.variantId} data-slot="page-review-edition" data-locale={edition.locale.tag} data-lifecycle-state={edition.lifecycle} data-under-review={underReview ? "true" : undefined} className="flex min-w-0 flex-col gap-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <bdi lang={edition.locale.tag} className="mono-identifier text-xs text-muted-foreground">
                      {edition.locale.tag}
                    </bdi>
                    {underReview ? <StatusBadge label={copy.review.frozenRevisionLabel} tone="info" /> : null}
                  </span>
                  <DraftStatus state={edition.lifecycle} />
                </li>
              );
            })}
          </ul>
        )}
        <Separator />
        <p className="text-sm text-muted-foreground text-pretty">{copy.review.reviewDoesNotRelease}</p>
      </section>
      {reviewedEdition === undefined ? null : (
        <section aria-labelledby={reachTitleId} data-slot="page-review-reach" className="flex min-w-0 flex-col gap-3">
          <h2 id={reachTitleId} className="font-heading text-base font-medium text-pretty">
            {copy.release.reachHeading}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">{copy.review.publishOnlyCannotBecomeNotify}</p>
          {/* The same control the builder uses, carrying the document's own revision: reach belongs to the Page's
           * releases, so an edition with no release is shown the control's honest "set at release" state rather
           * than a value this surface would have had to invent. */}
          <ReachControl variantId={reviewedEdition.variantId} documentId={document.documentId} scope={scope} expectedRevision={document.recordRevision} current={reach ?? null} />
          <SimulationLabel effect="publication-reach" />
        </section>
      )}
      {givingBinding === undefined ? null : (
        <section aria-labelledby={givingTitleId} data-slot="page-review-giving" className="flex min-w-0 flex-col gap-3">
          <h2 id={givingTitleId} className="font-heading text-base font-medium text-pretty">
            {copy.giving.designationLabel}
          </h2>
          <GivingDesignation binding={givingBinding} layout="inline" />
        </section>
      )}
      <ReviewPanel
        family="page"
        candidates={reviewedCandidate === undefined ? NO_CANDIDATES : [reviewedCandidate]}
        activeVariantId={activeVariantId}
        onSelect={setSelectedVariantId}
        policyRequiresReview={REVIEW_IS_REQUIRED}
        notifyRequestedByAuthor={RELEASE_SENDS_NO_NOTICE}
        scope={scope}
        expectedRevision={expectedRevision}
        onDecide={decide}
        headingLevel={2}
      />
    </div>
  );
}

export default PageReviewSurface;
