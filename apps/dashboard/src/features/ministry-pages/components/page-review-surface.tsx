"use client";
import { useCallback, useId, useState, type ReactElement } from "react";
import { DraftStatus, type ContentLifecycleState } from "@/components/draft-status";
import ReviewPanel, { type CandidateMediaRendition, type CandidateView, type RecordedCandidateDecision, type ReviewPanelProps } from "@/components/review-panel";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge from "@/components/status-badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { copy, type PageFamily } from "../copy";
import { useApprovePageCandidate, useRequestPageChanges } from "../hooks/page-mutations";
import type { ApproveCandidateInput, ApproveCandidatePayload, CreateVariantPayload } from "../schemas/release";
import GivingDesignation, { type GivingBindingView } from "./giving-designation";
import ReachControl, { type ReachControlProps } from "./reach-control";
type PageReviewScope = ApproveCandidateInput["scope"];
type ReviewDecisionInput = Parameters<ReviewPanelProps["onDecide"]>[0];
type ReviewOutcome = Awaited<ReturnType<ReviewPanelProps["onDecide"]>>;
type RefusedOutcome = Extract<ReviewOutcome, { readonly outcome: "invalid" }>;
type PageReach = NonNullable<ReachControlProps["current"]>;
type PageAudience = CreateVariantPayload["audience"];
const PUBLISH_ONLY = "publish-only" satisfies ApproveCandidatePayload["notifyMode"];
const PAGE_AUDIENCE: PageAudience = "public";
const REJECTION_NOT_OFFERED = "A Page candidate is answered with an approval or a request for changes, so no rejection was recorded and nothing was applied. " + "Choose Request changes and say in the note what has to change: that answer gives the author a new revision to submit.";
const REVIEW_IS_REQUIRED = true;
const RELEASE_SENDS_NO_NOTICE = false;
const NO_CANDIDATES: readonly CandidateView[] = [];
/** One language edition of the Page as the review read states it. */
export type ReviewEditionView = {
  readonly variantId: string;
  readonly candidateId?: string;
  readonly locale: CandidateView["locale"];
  readonly lifecycle: ContentLifecycleState;
  readonly revisionId?: string;
  readonly contentChecksum?: string;
  readonly renderedHtml?: string;
  readonly mediaRenditions?: readonly CandidateMediaRendition[];
  readonly staleTranslation?: boolean;
  readonly decisionRecord?: RecordedCandidateDecision | null;
  /** Whether the principal reading this page wrote the frozen revision, as the read states it. Present with the revision and checksum it describes. */
  readonly reviewedByAuthor?: boolean;
};
/** The Page a review route answers for: the document's identity, its family, the revision its record states, and one entry per language edition. */
export type ReviewDocumentView = { readonly documentId: string; readonly family: PageFamily; readonly recordRevision: string; readonly editions: readonly ReviewEditionView[] };
export type PageReviewSurfaceProps = { readonly document: ReviewDocumentView; readonly candidateId: string; readonly expectedRevision: string; readonly scope: PageReviewScope; readonly givingBinding?: GivingBindingView; readonly reach?: PageReach; readonly className?: string };
const reviewedEditionOf = (editions: readonly ReviewEditionView[], candidateId: string): ReviewEditionView | undefined => (candidateId.trim() === "" ? undefined : (editions.find((edition) => edition.candidateId === candidateId.trim()) ?? editions.find((edition) => edition.revisionId === candidateId.trim())));
const candidateIdentityOf = (edition: ReviewEditionView | undefined, named: string): string => ((edition?.candidateId?.trim() ?? "") === "" ? named.trim() : (edition?.candidateId?.trim() ?? ""));
function candidateViewOf(edition: ReviewEditionView): CandidateView | undefined {
  const revisionId = edition.revisionId?.trim() ?? "";
  const contentChecksum = edition.contentChecksum?.trim() ?? "";
  if (revisionId === "" || contentChecksum === "") return undefined;
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
    reviewedByAuthor: edition.reviewedByAuthor === true,
  };
}
const refusalOf = (operationId: string, message: string): RefusedOutcome => ({ outcome: "invalid", operationId, fields: { ["_root"]: [message] } });
/** The review of one frozen Page candidate: the Page's visibility and giving context, and the one decision the shared panel takes. */
export function PageReviewSurface({ document, candidateId, expectedRevision, scope, givingBinding, reach, className }: PageReviewSurfaceProps): ReactElement {
  const editionsTitleId = useId();
  const reachTitleId = useId();
  const givingTitleId = useId();
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
          return approveCandidate({ operationId, scope: attemptScope, expectedRevision: attemptRevision, payload: { candidateId: answeredCandidateId, notifyMode: PUBLISH_ONLY } });
        case "changes-requested":
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
