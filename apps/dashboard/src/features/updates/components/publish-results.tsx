"use client";
import Link from "next/link";
import { useId, type ReactElement, type ReactNode } from "react";
import { DraftStatus, lifecycleOf, type VariantReleaseOutcome } from "@/components/draft-status";
import { fieldErrorsFromInvalid } from "@/components/form-field";
import OperationResult, { type ReceiptHeadingLevel } from "@/components/operation-result";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, type SendStatus } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { AUDIENCE_LABELS, LOCALE_DISPLAY_NAMES, REVIEW_ROUND_NOTE, WITHDRAWAL_WORDING } from "../copy/updates-copy";
type PublishingVariant = Parameters<typeof lifecycleOf>[0];
type PublishingRelease = NonNullable<Parameters<typeof lifecycleOf>[1]>;
export const PUBLISH_EDITION_STATES = ["released", "failed-with-prior-good-head", "needs-attention", "withdrawn"] as const;
export type PublishEditionState = (typeof PUBLISH_EDITION_STATES)[number];
export type PublishedEditionNotice = { readonly state: SendStatus; readonly detail?: string; readonly intentId?: string };
export type PublishedEdition = { readonly variant: PublishingVariant; readonly state: PublishEditionState; readonly release?: PublishingRelease; readonly reasonCode?: string; readonly reason?: string; readonly notice?: PublishedEditionNotice };
const EDITIONS_HEADING = "Result for each edition";
const EDITIONS_INTRO = "Each edition below reports its own result, and editions can differ, so they are read one at a " + "time rather than as one result for the whole submission.";
const REPLAY_NOTE = "These rows are the result stored for that operation, not a new effect: nothing was released a " + "second time and no revision advanced.";
const NOTICE_HONESTY_NOTE = "A notice that was accepted is not a delivered message and not a read one: acceptance states only " + "that this application took the submission, and nothing here states that a message arrived or was " + "opened.";
const RETRY_INTENT_NOTE = "If this page offers to retry, it resubmits this same operation rather than starting a new one, so " + "work that was already accepted answers with its stored result instead of happening twice.";
const NO_EDITIONS_TITLE = "No result for each edition was reported";
const NO_EDITIONS_DESCRIPTION = "The submission was recorded, and the service reported no result for the editions it covered. " + "Nothing here summarises them, because a summary would state what the service did not.";
const UPDATES_LIST = { label: "Open the Updates list", href: "/communication" } as const;
const REFUSED_WITH_FIELDS = "No edition was released or attempted: correct the fields the summary above names and submit the " + "release again.";
const REFUSED_WITHOUT_FIELDS = "No edition was released or attempted, and the refusal named no field to correct, so nothing here " + "can say which edition to change.";
const RECEIPT_HEADING: Readonly<Partial<Record<MutationOutcome["outcome"], string>>> = { accepted: "Release result", alreadyAccepted: "Release result for the earlier submission" };
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const PUBLICATION_LABEL: Readonly<Record<PublishEditionState, string>> = { released: "Revision released", "failed-with-prior-good-head": "Earlier revision still published", "needs-attention": "Earlier revision still published", withdrawn: "Revision withdrawn" };
const NO_REVISION_STATE = "No revision is published for this edition.";
/** Where the recorded per-send results of one submitted notice are read, named by that notice's own identity. */
const DELIVERY_PATH = "/communication/delivery";
const NOTICE_IDENTITY_LABEL = "Notice submitted";
const NOTICE_RESULTS_LINK = "Open the recorded results for this notice";
const noticeResultsHrefOf = (intentId: string): string => `${DELIVERY_PATH}?intentId=${encodeURIComponent(intentId)}`;
/** The link's own target size and wrapping, as the family's outlined links state them. */
const NOTICE_LINK_CLASS = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto min-h-8 max-w-full py-1.5 whitespace-normal");
function synthesisOf(editions: readonly PublishedEdition[]): readonly VariantReleaseOutcome[] {
  const evidence: VariantReleaseOutcome[] = [];
  for (const edition of editions) {
    if (edition.state === "withdrawn") continue;
    if (edition.state === "released") {
      if (edition.release !== undefined) evidence.push({ variantId: edition.variant.variantId, outcome: { status: "released", release: edition.release } });
      continue;
    }
    evidence.push({ variantId: edition.variant.variantId, outcome: { status: "failed", reason: edition.reason?.trim() ?? "" } });
  }
  return evidence;
}
type EditionPublication = { readonly label: string; readonly revisionId: string };
const publicationOf = (edition: PublishedEdition): EditionPublication | null => {
  const revisionId = edition.release?.revisionId.trim() ?? "";
  return revisionId === "" ? null : { label: PUBLICATION_LABEL[edition.state], revisionId };
};
const NARRATIVES: Readonly<Record<PublishEditionState, { readonly published: string; readonly unpublished: string }>> = {
  released: {
    published: "This attempt released this edition for its audience and language, and the revision " + "above is the one it now publishes.",
    unpublished: "This attempt reports this edition as released and the service named no published " + "revision for it, so nothing on this page can state which revision a reader is served.",
  },
  "failed-with-prior-good-head": {
    published: "This attempt did not release this edition. The revision above is its earlier publication " + "and is still the one an authorised reader is served, and the editions that did release " + "in this attempt stand as they are — this is not a rollback of them.",
    unpublished: "This attempt did not release this edition, and it has no earlier publication, so no " + "reader is served a revision of it. No other edition in this attempt was changed by it.",
  },
  "needs-attention": {
    published: "This attempt left this edition needing attention, so no new revision was released for " + "it. The revision above is its earlier publication and is still the one an authorised " + "reader is served. A result that needs attention is a complete result, not a pending one.",
    unpublished: "This attempt left this edition needing attention, so no revision was released for it and " + "no reader is served it yet. A result that needs attention is complete: it names what to " + "look at rather than an error that stopped the run.",
  },
  withdrawn: { published: "This attempt released nothing for this edition, and the edition is withdrawn: this " + "application does not serve it to that audience.", unpublished: "This attempt released nothing for this edition, and the edition is withdrawn: this " + "application does not serve it to that audience." },
};
const narrativeOf = (state: PublishEditionState, publishesRevision: boolean): string => (publishesRevision ? NARRATIVES[state].published : NARRATIVES[state].unpublished);
type EditionRowProps = { readonly edition: PublishedEdition; readonly synthesis: readonly VariantReleaseOutcome[]; readonly renderAction?: ((edition: PublishedEdition) => ReactNode) | undefined };
function EditionRow({ edition, synthesis, renderAction }: EditionRowProps): ReactElement {
  const { variant, state } = edition;
  const lifecycle = lifecycleOf(variant, edition.release, { synthesis });
  const audience = AUDIENCE_LABELS[variant.audience];
  const localeName = LOCALE_DISPLAY_NAMES[variant.locale.tag] ?? variant.locale.tag;
  const publication = publicationOf(edition);
  const reason = edition.reason?.trim() ?? "";
  const reasonCode = edition.reasonCode?.trim() ?? "";
  const noticeDetail = edition.notice?.detail?.trim() ?? "";
  const noticeIntentId = edition.notice?.intentId?.trim() ?? "";
  const action = renderAction?.(edition) ?? null;
  return (
    <li data-slot="publish-edition" data-variant-id={variant.variantId} data-edition-state={state} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge label={audience.label} srPrefix="Audience" />
        <span className="text-sm text-muted-foreground">
          <span className="sr-only">Language: </span>
          <bdi>{localeName}</bdi>
        </span>
      </p>
      <DraftStatus state={lifecycle} />
      {publication === null ? (
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{NO_REVISION_STATE}</p>
      ) : (
        <p className="min-w-0 text-sm text-pretty wrap-anywhere">
          <span className="text-muted-foreground">{`${publication.label}: `}</span>
          <bdi className="mono-identifier">{publication.revisionId}</bdi>
        </p>
      )}
      <p className="text-sm text-pretty wrap-anywhere">{narrativeOf(state, publication !== null)}</p>
      {/* A withdrawal never claims a notice was taken back or a copy retrieved, so the Page-shaped withdrawal sentence is deliberately not used here. */}
      {state === "withdrawn" ? <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{WITHDRAWAL_WORDING.whatItDoesNotDo}</p> : null}
      {reason === "" ? null : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{reason}</p>}
      {reasonCode === "" ? null : (
        <p className="min-w-0 text-sm text-muted-foreground wrap-anywhere">
          <span>Reason code: </span>
          <bdi className="mono-identifier">{reasonCode}</bdi>
        </p>
      )}
      {edition.notice === undefined ? null : (
        <div data-slot="publish-edition-notice" data-notice-state={edition.notice.state} className="flex min-w-0 flex-col gap-2">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-muted-foreground">Notice for this edition:</span>
            <StatusBadge {...SEND_STATUS[edition.notice.state]} srPrefix="Notice" />
            {noticeDetail === "" ? null : <span className="min-w-0 text-muted-foreground wrap-anywhere">{noticeDetail}</span>}
          </p>
          {/*
            The notice's own identity, where the answer stated one: the recorded outcomes are read under it, so the result
            row names the notice it is about instead of describing whichever was submitted last. Acceptance is neither
            delivery nor reading, so the link opens the recorded outcomes and claims nothing about arrival.
          */}
          {noticeIntentId === "" ? null : (
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="min-w-0 wrap-anywhere">
                <span className="text-muted-foreground">{`${NOTICE_IDENTITY_LABEL}: `}</span>
                <bdi className="mono-identifier">{noticeIntentId}</bdi>
              </p>
              <p className="min-w-0">
                <Link href={noticeResultsHrefOf(noticeIntentId)} className={NOTICE_LINK_CLASS}>
                  {NOTICE_RESULTS_LINK}
                </Link>
              </p>
            </div>
          )}
        </div>
      )}
      {action === null ? null : <div className="min-w-0">{action}</div>}
    </li>
  );
}
export interface PublishResultsProps {
  readonly outcome: MutationOutcome;
  readonly editions?: readonly PublishedEdition[];
  readonly onCheckResult: (operationId: string) => void | Promise<void>;
  readonly onReapply?: () => void;
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;
  readonly renderEditionAction?: (edition: PublishedEdition) => ReactNode;
  readonly headingLevel?: ReceiptHeadingLevel;
  readonly className?: string;
}
export function PublishResults({ outcome, editions, onCheckResult, onReapply, fieldLabels, renderEditionAction, headingLevel = 2, className }: PublishResultsProps): ReactElement {
  const titleId = useId();
  const Heading = HEADING_TAG[headingLevel];
  const applied = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
  const reported = applied ? (editions ?? []) : [];
  const synthesis = synthesisOf(reported);
  const anyNotice = reported.some((edition) => edition.notice !== undefined);
  const anyUnfinished = reported.some((edition) => edition.state === "failed-with-prior-good-head" || edition.state === "needs-attention");
  const refused = outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : undefined;
  const operationId = outcome.operationId;
  const checkResult = (): void => void onCheckResult(operationId);
  const notes: readonly string[] = [...(outcome.outcome === "alreadyAccepted" ? [REPLAY_NOTE] : []), REVIEW_ROUND_NOTE.approvalIsPerVariant, ...(anyNotice ? [NOTICE_HONESTY_NOTE] : []), ...(anyUnfinished ? [RETRY_INTENT_NOTE] : [])];
  return (
    <div data-slot="publish-results" data-outcome={outcome.outcome} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <OperationResult outcome={outcome} heading={RECEIPT_HEADING[outcome.outcome]} headingLevel={headingLevel} onCheckResult={checkResult} onReapply={onReapply} fieldLabels={fieldLabels} />
      {refused === undefined ? null : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{refused.count === 0 ? REFUSED_WITHOUT_FIELDS : REFUSED_WITH_FIELDS}</p>}
      {!applied ? null : reported.length === 0 ? (
        <StateNotice kind="empty" title={NO_EDITIONS_TITLE} description={NO_EDITIONS_DESCRIPTION} action={UPDATES_LIST} headingLevel={headingLevel} />
      ) : (
        <Card data-slot="publish-editions" className="min-w-0">
          <CardHeader>
            <CardTitle>
              <Heading id={titleId}>{EDITIONS_HEADING}</Heading>
            </CardTitle>
            <CardDescription>{EDITIONS_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            <ul aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
              {reported.map((edition, index) => (
                <EditionRow key={`${edition.variant.variantId}-${String(index)}`} edition={edition} synthesis={synthesis} renderAction={renderEditionAction} />
              ))}
            </ul>
            <Separator />
            <div className="flex min-w-0 flex-col gap-2">
              {notes.map((note) => (
                <p key={note} className="text-sm text-muted-foreground text-pretty wrap-anywhere">
                  {note}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default PublishResults;
