"use client";
import Link from "next/link";
import { useId, type ReactElement, type ReactNode } from "react";
import { DraftStatus, lifecycleOf, type VariantReleaseOutcome } from "@/components/draft-status";
import { fieldErrorsFromInvalid } from "@/components/form-field";
import OperationResult, { type ReceiptHeadingLevel } from "@/components/operation-result";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, type SendStatus } from "@/components/status-badge";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { AUDIENCE_LABELS, LOCALE_DISPLAY_NAMES, REVIEW_ROUND_NOTE, WITHDRAWAL_WORDING } from "../copy/updates-copy";
export const PUBLISH_EDITION_STATES = ["released", "failed-with-prior-good-head", "needs-attention", "withdrawn"] as const;
export type PublishEditionState = (typeof PUBLISH_EDITION_STATES)[number];
export type PublishedEditionNotice = { readonly state: SendStatus; readonly detail?: string; readonly intentId?: string };
export type PublishedEdition = { readonly variant: Parameters<typeof lifecycleOf>[0]; readonly state: PublishEditionState; readonly release?: NonNullable<Parameters<typeof lifecycleOf>[1]>; readonly reasonCode?: string; readonly reason?: string; readonly notice?: PublishedEditionNotice };
const REPLAY_NOTE = "Showing the stored result from your earlier publish — nothing was published a second time.";
const NOTICE_HONESTY_NOTE = "Accepted means the simulated email notification was queued — not that it was delivered or read.";
const RETRY_INTENT_NOTE = "Retrying safely re-checks this operation so already-published editions aren’t released twice.";
const NO_EDITIONS_DESCRIPTION = "Publishing was recorded, but no per-edition details were returned.";
const UPDATES_LIST = { label: "Back to Updates", href: "/communication" } as const;
const REFUSED_WITHOUT_FIELDS = "No editions were published. Check your selections and try again.";
const RECEIPT_HEADING: Readonly<Partial<Record<MutationOutcome["outcome"], string>>> = { accepted: "Publishing results", alreadyAccepted: "Publishing results (previous attempt)" };
/** The one type scale's utility for each level, so this surface's heading takes the measure of the level the composing page gives it rather than one fixed size. */ const HEADING_SCALE: Readonly<Record<ReceiptHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const PUBLICATION_LABEL: Readonly<Record<PublishEditionState, string>> = { released: "Published revision", "failed-with-prior-good-head": "Previous version still live", "needs-attention": "Previous version still live", withdrawn: "Unpublished revision" };
/** Where the recorded per-send results of one submitted notice are read, named by that notice's own identity rather than by whichever notice was submitted last. */ const DELIVERY_PATH = "/communication/delivery";
const NOTICE_IDENTITY_LABEL = "Notification ID";
const NOTICE_LINK_CLASS = cn(buttonVariants({ variant: "outline", size: "sm" }), BUTTON_WRAP_CLASS);
const publicationOf = (edition: PublishedEdition): { readonly label: string; readonly revisionId: string } | null => {
  const revisionId = edition.release?.revisionId.trim() ?? "";
  return revisionId === "" ? null : { label: PUBLICATION_LABEL[edition.state], revisionId };
};
const NARRATIVES: Readonly<Record<PublishEditionState, { readonly published: string; readonly unpublished: string }>> = {
  released: {
    published: "Published for this audience and language. Readers now see the revision shown above.",
    unpublished: "Marked as published, though no revision ID was returned to confirm which revision readers see.",
  },
  "failed-with-prior-good-head": {
    published: "This edition wasn’t published. The previous published revision above is still live, and other editions that succeeded remain published.",
    unpublished: "This edition wasn’t published and has no prior published version, so readers cannot see it. Other editions were not affected.",
  },
  "needs-attention": {
    published: "This edition needs attention before a new revision can be published. The previous revision above is still live.",
    unpublished: "This edition needs attention before it can be published, so readers cannot see it yet.",
  },
  withdrawn: {
    published: "Nothing was published — this edition is unpublished and no longer shown to readers.",
    unpublished: "Nothing was published — this edition is unpublished and no longer shown to readers.",
  },
};
function EditionRow({ edition, synthesis, renderAction }: { readonly edition: PublishedEdition; readonly synthesis: readonly VariantReleaseOutcome[]; readonly renderAction?: ((edition: PublishedEdition) => ReactNode) | undefined }): ReactElement {
  const { variant, state } = edition;
  const audience = AUDIENCE_LABELS[variant.audience];
  const publication = publicationOf(edition);
  const reason = edition.reason?.trim() ?? "";
  const reasonCode = edition.reasonCode?.trim() ?? "";
  const noticeDetail = edition.notice?.detail?.trim() ?? "";
  const noticeIntentId = edition.notice?.intentId?.trim() ?? "";
  const action = renderAction?.(edition) ?? null;
  return (
    <li data-slot="publish-edition" data-variant-id={variant.variantId} data-edition-state={state} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-supporting">
        <StatusBadge label={audience.label} srPrefix="Audience" />
        <span>
          <span className="sr-only">Language: </span>
          <bdi>{LOCALE_DISPLAY_NAMES[variant.locale.tag] ?? variant.locale.tag}</bdi>
        </span>
      </p>
      <DraftStatus state={lifecycleOf(variant, edition.release, { synthesis })} />
      {publication === null ? (
        <p className="type-supporting text-pretty wrap-anywhere">{"No revision is published for this edition."}</p>
      ) : (
        <p className="min-w-0 type-body text-pretty wrap-anywhere">
          <span className="text-muted-foreground">{`${publication.label}: `}</span>
          <bdi className="mono-identifier">{publication.revisionId}</bdi>
        </p>
      )}
      <p className="type-body text-pretty wrap-anywhere">{((state: PublishEditionState, publishesRevision: boolean): string => (publishesRevision ? NARRATIVES[state].published : NARRATIVES[state].unpublished))(state, publication !== null)}</p>
      {/* A withdrawal never claims a notice was taken back or a copy retrieved, so the Page-shaped withdrawal sentence is deliberately not used here. */}
      {state === "withdrawn" ? <p className="type-supporting text-pretty wrap-anywhere">{WITHDRAWAL_WORDING.whatItDoesNotDo}</p> : null}
      {reason === "" ? null : <p className="type-supporting text-pretty wrap-anywhere">{reason}</p>}
      {reasonCode === "" ? null : (
        <p className="min-w-0 type-supporting wrap-anywhere">
          <span>Reason code: </span>
          <bdi className="mono-identifier">{reasonCode}</bdi>
        </p>
      )}
      {edition.notice === undefined ? null : (
        <div data-slot="publish-edition-notice" data-notice-state={edition.notice.state} className="flex min-w-0 flex-col gap-2">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-supporting">
            <span className="text-muted-foreground">Notice for this edition:</span>
            <StatusBadge {...SEND_STATUS[edition.notice.state]} srPrefix="Notice" />
            {noticeDetail === "" ? null : <span className="min-w-0 text-muted-foreground wrap-anywhere">{noticeDetail}</span>}
          </p>
          {/* The notice's own identity, where the answer stated one: the recorded outcomes are read under it, and acceptance is neither delivery nor reading. */}
          {noticeIntentId === "" ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <p className="min-w-0 type-body wrap-anywhere">
                <span className="text-muted-foreground">{`${NOTICE_IDENTITY_LABEL}: `}</span>
                <bdi className="mono-identifier">{noticeIntentId}</bdi>
              </p>
              <p className="min-w-0 type-body">
                <Link href={((intentId: string): string => `${DELIVERY_PATH}?intentId=${encodeURIComponent(intentId)}`)(noticeIntentId)} data-slot="button" className={NOTICE_LINK_CLASS}>
                  {"View send history"}
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
export type PublishResultsProps = {
  readonly outcome: MutationOutcome;
  readonly editions?: readonly PublishedEdition[];
  readonly onCheckResult: (operationId: string) => void | Promise<void>;
  readonly onReapply?: () => void;
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;
  readonly renderEditionAction?: (edition: PublishedEdition) => ReactNode;
  readonly headingLevel?: ReceiptHeadingLevel;
  readonly className?: string;
};
const synthesisOf = (editions: readonly PublishedEdition[]): readonly VariantReleaseOutcome[] =>
  editions.flatMap((edition): readonly VariantReleaseOutcome[] => {
    if (edition.state === "withdrawn") return [];
    return edition.state !== "released" ? [{ variantId: edition.variant.variantId, outcome: { status: "failed", reason: edition.reason?.trim() ?? "" } }] : edition.release === undefined ? [] : [{ variantId: edition.variant.variantId, outcome: { status: "released", release: edition.release } }];
  });
export function PublishResults({ outcome, editions, onCheckResult, onReapply, fieldLabels, renderEditionAction, headingLevel = 2, className }: PublishResultsProps): ReactElement {
  const titleId = useId();
  const Heading = ({ 2: "h2", 3: "h3", 4: "h4" } as const)[headingLevel];
  const applied = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
  const reported = applied ? (editions ?? []) : [];
  const synthesis = synthesisOf(reported);
  const anyNotice = reported.some((edition) => edition.notice !== undefined);
  const anyUnfinished = reported.some((edition) => edition.state === "failed-with-prior-good-head" || edition.state === "needs-attention");
  const refused = outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : undefined;
  const operationId = outcome.operationId;
  const checkResult = (): void => void onCheckResult(operationId);
  return (
    <div data-slot="publish-results" data-outcome={outcome.outcome} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <OperationResult outcome={outcome} heading={RECEIPT_HEADING[outcome.outcome]} headingLevel={headingLevel} onCheckResult={checkResult} onReapply={onReapply} fieldLabels={fieldLabels} />
      {refused === undefined ? null : <p className="type-supporting text-pretty wrap-anywhere">{refused.count === 0 ? REFUSED_WITHOUT_FIELDS : "No edition was released or attempted: correct the fields the summary above names and submit the release again."}</p>}
      {!applied ? null : reported.length === 0 ? (
        <StateNotice kind="empty" title="No result for each edition was reported" description={NO_EDITIONS_DESCRIPTION} action={UPDATES_LIST} headingLevel={headingLevel} />
      ) : (
        <Card data-slot="publish-editions" className="min-w-0">
          <CardHeader>
            <CardTitle>
              <Heading id={titleId} className={HEADING_SCALE[headingLevel]}>
                {"Results by edition"}
              </Heading>
            </CardTitle>
            <CardDescription>{"Each audience and language edition publishes independently."}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            <ul aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
              {reported.map((edition, index) => (
                <EditionRow key={`${edition.variant.variantId}-${String(index)}`} edition={edition} synthesis={synthesis} renderAction={renderEditionAction} />
              ))}
            </ul>
            <Separator />
            <div className="flex min-w-0 flex-col gap-2">
              {[...(outcome.outcome === "alreadyAccepted" ? [REPLAY_NOTE] : []), REVIEW_ROUND_NOTE.approvalIsPerVariant, ...(anyNotice ? [NOTICE_HONESTY_NOTE] : []), ...(anyUnfinished ? [RETRY_INTENT_NOTE] : [])].map((note) => (
                <p key={note} className="type-supporting text-pretty wrap-anywhere">
                  {note}
                </p>
              ))}
              {/* This result is where a submitted notice is reported, so the simulated effect that produced every row above is stated on it as well as at the control that asked for it: acceptance here is this application taking a submission, never a message leaving it. */}
              {anyNotice ? <SimulationLabel effect="mail-submission" context="block" /> : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default PublishResults;
