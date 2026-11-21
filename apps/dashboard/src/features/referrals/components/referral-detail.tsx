"use client";
/**
 * The one referral detail body: the introduction a cycle records, where its window stands, what the
 * permitted projection carries and whether the one continuation the cycle can hold is on offer.
 *
 * It renders through the application's single record detail body, so the canonical route, the desktop
 * panel beside a list and the phone sheet are one implementation whose chrome changes and whose facts
 * and order do not. Every value below is the envelope's own: no date, deadline, instant, window or
 * succession is computed, reformatted, compared or re-derived here — a date the read resolved is
 * printed exactly as it was resolved, and a fact the read does not carry is shown as not carried
 * rather than filled in.
 */
import { useCallback, useId, type ReactElement, type ReactNode } from "react";
import RecordDetail, { type RecordDetailBreadcrumbEntry, type RecordDetailIdentity, type RecordDetailLayout, type RecordDetailSectionSlots } from "@/components/record-detail";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusTone } from "@/components/status-badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { ReadAction, Scope, reads } from "@/modules/data-service";
import { CONTINUATION_WINDOW_COPY, EXPIRED_HISTORY_COPY, INTRODUCED_BY_COPY, LIST_COPY, PRECISION_COPY, STATUS_COPY, WINDOW_COPY, type ReferralStatusWord } from "../copy";
import { useReferral } from "../hooks/use-referral";
import ContinueReferralAction from "./continue-referral-action";
import ExpiredReferralHistory from "./expired-referral-history";
import ReferralWindowPanel from "./referral-window-panel";
// What the service read answers, taken from its own signature so a member that moves reaches this file
// as a compile error rather than as a second restatement of the shape it answers with.
type ReferralReadResult = Awaited<ReturnType<typeof reads.referrals.readReferral>>;
type ReferralEnvelope = Extract<ReferralReadResult, { readonly kind: "envelope" }>["envelope"];
type ReferralDetailData = ReferralEnvelope["data"];
type ReferralView = Extract<ReferralDetailData, { readonly view: "detail" }>;
type ReferralRow = ReferralView["referral"];
type ContinuationPolicyFacts = ReferralView["continuationPolicy"];
type ReferralStatus = ReferralRow["status"];
/**
 * The one referral detail body. It reads one cycle under `scope` and presents the envelope it
 * answers with; it never takes a record from a list envelope, because the narrow permitted Expired
 * projection and the list row are two different projections of a cycle and neither may stand in for
 * the other.
 */
export type ReferralDetailProps = {
  /** The exact authority this record is read under. The service re-derives scope from the session on every read, so this is a claim the caller makes and never an authority it grants. */
  readonly scope: Scope;
  /** The cycle's opaque identifier, taken from the route or from the list row that was opened. */
  readonly referralId: string;
  /** The presentation this body is rendered in: the route's page, the desktop panel beside a list, or the phone sheet. Only the chrome and the heading levels differ between them. */
  readonly layout: RecordDetailLayout;
  /** The reading direction of the surrounding document, set on the block this body renders rather than on any fact inside it. */
  readonly dir?: "ltr" | "rtl";
  /** Where the worker returns to, and the list context that will still be filtered when they do. Defaults to the referral list the shell links to, so a direct visit still has a way back. */
  readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[];
  readonly className?: string;
};
/** The list address the shell's own navigation links to, so a body opened by direct link still returns to the family it belongs to. */
const REFERRALS_LIST_ROUTE = "/partners/referrals";
const DEFAULT_BREADCRUMB: readonly RecordDetailBreadcrumbEntry[] = [{ label: LIST_COPY.heading, href: REFERRALS_LIST_ROUTE }];
/**
 * The label a re-request of this read carries. The family's copy owns the sentences a referral states
 * about itself and no label for a retry, so the one this surface shows is the label the family's own
 * list surface uses rather than a second wording of the same control.
 */
const RETRY_LABEL = "Try again";
/** The value state a permitted fact the read does not carry renders as, from the shared vocabulary, so it is never an empty gap and never a zero. */
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
/**
 * The tone each status word carries. Colour never stands alone — the word itself is always rendered
 * beside it — and each closure the source can record (`withdrawn`, `revoked`, `erased`, `departed`)
 * carries its own tone and its own sentence saying it is not an ordinary expiry, so the two halves of
 * the vocabulary never read as one.
 */
const STATUS_TONE: Readonly<Record<ReferralStatusWord, StatusTone>> = { active: "positive", expired: "neutral", "no-deadline": "caution", refused: "caution", withdrawn: "danger", revoked: "danger", erased: "danger", departed: "danger" };
/** The heading each section of this body takes in each presentation, one level below the heading the shared body gives the group it renders in. */
const BODY_HEADING: Readonly<Record<RecordDetailLayout, "h3" | "h4">> = { page: "h3", panel: "h4", sheet: "h4" };
/** The level the review step's own heading takes: the body's own level, so the step nests under the section it belongs to. */
const REVIEW_HEADING: Readonly<Record<RecordDetailLayout, 3 | 4>> = { page: 3, panel: 4, sheet: 4 };
/** The level the permitted Expired history's title takes: it is the only content of that presentation, so it takes the surface's own highest level. */
const EXPIRED_HEADING: Readonly<Record<RecordDetailLayout, 2 | 3 | 4>> = { page: 2, panel: 3, sheet: 3 };
/** The level a state notice takes where this body renders one instead of a record: the route's page has no other heading, a panel or sheet nests under its own title. */
const NOTICE_HEADING: Readonly<Record<RecordDetailLayout, NoticeHeadingLevel>> = { page: 1, panel: 2, sheet: 2 };
const HELP_CLASS = "text-xs text-muted-foreground text-pretty wrap-anywhere";
const VALUE_CLASS = "min-w-0 wrap-anywhere";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
/** One date or instant exactly as the envelope supplied it, isolated because a date is weak-direction text that must never reorder the runs around it. */
function EnvelopeDate({ value }: { readonly value: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={value}>
        {value}
      </time>
    </bdi>
  );
}
/** The word a permitted value the read does not carry renders as, rather than an empty gap or a dash a reader would read as zero. */
function NotRecorded(): ReactElement {
  return <StatusBadge label={NOT_RECORDED.label} tone={NOT_RECORDED.tone} />;
}
/** One labelled fact of a fact list. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-1 break-words">{children}</dd>
    </div>
  );
}
type BodySectionProps = { readonly headingId: string; readonly level: "h3" | "h4"; readonly slot: string; readonly title: string; readonly children: ReactNode };
/** One named section of this body, so every section states its own heading, its own landmark and its own position in the order the family fixes. */
function BodySection({ headingId, level, slot, title, children }: BodySectionProps): ReactElement {
  const Heading = level === "h3" ? "h3" : "h4";
  return (
    <section aria-labelledby={headingId} data-slot={slot} className="flex min-w-0 flex-col gap-2">
      <Heading id={headingId} className="font-heading text-sm font-medium text-pretty wrap-anywhere">
        {title}
      </Heading>
      {children}
    </section>
  );
}
/**
 * The original introduction: the date the introduction happened, the precision that date is known to,
 * the zone it is known in, and the entry time as its own fact.
 *
 * The two dates are never merged into one statement. A late entry is common — a first entry can
 * already be Expired — so a surface that showed the entry time in the introduction's place would
 * report a window that had not started on the day it started, and might briefly activate a cycle the
 * evidence already closed.
 */
function IntroductionFacts({ referral }: { readonly referral: ReferralRow }): ReactElement {
  const precision = PRECISION_COPY[referral.datePrecision];
  const introducedOn = referral.originalIntroductionOn;
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <Fact term={INTRODUCED_BY_COPY.originalIntroductionOnLabel}>
        <span className={VALUE_CLASS}>{introducedOn === null ? <NotRecorded /> : <EnvelopeDate value={introducedOn} />}</span>
        <p className={HELP_CLASS}>{INTRODUCED_BY_COPY.originalIntroductionOnHelp}</p>
      </Fact>
      <Fact term={INTRODUCED_BY_COPY.datePrecisionLabel}>
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <StatusBadge label={precision.label} tone={referral.datePrecision === "date" ? "info" : "caution"} />
        </span>
        <p className={HELP_CLASS}>{precision.hint}</p>
      </Fact>
      <Fact term={INTRODUCED_BY_COPY.sourceZoneLabel}>
        <span className={VALUE_CLASS}>
          <bdi className="break-all">{referral.sourceZone}</bdi>
        </span>
        <p className={HELP_CLASS}>{INTRODUCED_BY_COPY.sourceZoneHelp}</p>
      </Fact>
      {/*
        Entry time is stated as a fact of its own and never as the introduction date. This read does
        not carry one — the cycle the service answers with holds the introduction and the window
        resolved from it, and no entry instant — so the fact is shown as not carried rather than
        borrowed from a neighbouring value such as the window's start, which is counted from the
        introduction date and is not the day the record was entered.
      */}
      <Fact term={INTRODUCED_BY_COPY.entryTimeLabel}>
        <span className={VALUE_CLASS}>
          <NotRecorded />
        </span>
        <p className={HELP_CLASS}>{INTRODUCED_BY_COPY.entryTimeNote}</p>
      </Fact>
    </dl>
  );
}
/**
 * Where this cycle stands. The word is always present as text and the sentence beneath it says what
 * the word means, so an ordinary expiry and a closure the source recorded are told apart by wording
 * and not by colour.
 */
function StatusFacts({ status }: { readonly status: ReferralStatus }): ReactElement {
  const copy = STATUS_COPY[status.status];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StatusBadge label={copy.label} tone={STATUS_TONE[status.status]} />
      </span>
      <p className="min-w-0 text-sm text-pretty wrap-anywhere text-muted-foreground">{copy.description}</p>
    </div>
  );
}
/**
 * Exactly the dates the envelope permits, each printed as the read supplied it. A date the projection
 * does not carry is stated as such: an absent window end is the family's own wording for a fact about
 * the evidence rather than a missing number, and an absent start or introduction date is the value
 * state the shared vocabulary gives it.
 */
function PermittedDatesFacts({ referral }: { readonly referral: ReferralRow }): ReactElement {
  const labels = EXPIRED_HISTORY_COPY.fieldLabels;
  return (
    <dl className="flex min-w-0 flex-col gap-2 text-sm">
      <Fact term={labels.originalIntroductionOn}>
        <span className={VALUE_CLASS}>{referral.originalIntroductionOn === null ? <NotRecorded /> : <EnvelopeDate value={referral.originalIntroductionOn} />}</span>
      </Fact>
      <Fact term={labels.windowStart}>
        <span className={VALUE_CLASS}>{referral.windowStart === null ? <NotRecorded /> : <EnvelopeDate value={referral.windowStart} />}</span>
      </Fact>
      <Fact term={labels.windowEnd}>
        <span className={VALUE_CLASS}>{referral.windowEnd === null ? <span className="text-muted-foreground">{LIST_COPY.noWindowEndLabel}</span> : <EnvelopeDate value={referral.windowEnd} />}</span>
      </Fact>
    </dl>
  );
}
/**
 * The cycle this record is: its index, the kind of window it carries, the cycle it was continued
 * from and the one it was continued into.
 *
 * Both references are opaque identifiers printed exactly as the read supplied them. They are never
 * rebuilt from a date or an index, and never turned into a link: this envelope admitted this cycle
 * and stated the identifiers, and a link would offer a record the read did not answer with.
 */
function CycleReferenceFacts({ referral }: { readonly referral: ReferralRow }): ReactElement {
  const labels = EXPIRED_HISTORY_COPY.fieldLabels;
  const continued = referral.windowKind === "continued";
  return (
    <dl className="flex min-w-0 flex-col gap-2 text-sm">
      <Fact term={labels.cycleIndex}>
        <span className={VALUE_CLASS}>
          <bdi className="tabular-figures">{String(referral.cycleIndex)}</bdi>
        </span>
      </Fact>
      <Fact term={labels.windowKind}>{continued ? CONTINUATION_WINDOW_COPY.heading : WINDOW_COPY.newWindowHeading}</Fact>
      {referral.predecessorId === null ? null : (
        <Fact term={CONTINUATION_WINDOW_COPY.predecessorLabel}>
          <bdi className={IDENTIFIER_CLASS}>{referral.predecessorId}</bdi>
        </Fact>
      )}
      <Fact term={labels.consumed}>
        <span>{referral.consumed ? EXPIRED_HISTORY_COPY.consumedLabels.continued : EXPIRED_HISTORY_COPY.consumedLabels.notContinued}</span>
        {referral.successorId === null ? null : <bdi className={IDENTIFIER_CLASS}>{referral.successorId}</bdi>}
      </Fact>
    </dl>
  );
}
type ReferralBodyProps = {
  readonly scope: Scope;
  readonly referral: ReferralRow;
  readonly continuationPolicy: ContinuationPolicyFacts;
  /** The `actions` the envelope published. Continue is offered only where one of them admits it, so this body never derives eligibility of its own. */
  readonly actions: readonly ReadAction[];
  readonly layout: RecordDetailLayout;
  readonly dir?: "ltr" | "rtl";
  /** Re-reads this record after a continuation whose acknowledgement was lost. Recovery is by operation identity, so this reads the result rather than re-sending the work. */
  readonly onCheckResult: () => void;
};
/**
 * Every section of one referral cycle, in the only order they render: the introduction, where the
 * cycle stands, its window, the dates the projection permits, the one continuation it can carry and
 * its place in the chain of cycles.
 *
 * The order and the facts are identical in all three presentations; only the heading levels, which
 * belong to the surface the body lands in, differ. Nothing here is conditional on the layout.
 */
function ReferralBody({ scope, referral, continuationPolicy, actions, layout, dir, onCheckResult }: ReferralBodyProps): ReactElement {
  const generatedId = useId();
  const level = BODY_HEADING[layout];
  const idOf = (section: string): string => `referral-detail-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}-${section}`;
  return (
    <div dir={dir} data-slot="referral-detail" className="flex min-w-0 flex-col gap-4">
      <BodySection headingId={idOf("introduction")} level={level} slot="referral-detail-introduction" title={INTRODUCED_BY_COPY.sectionHeading}>
        <IntroductionFacts referral={referral} />
      </BodySection>
      <Separator />
      <BodySection headingId={idOf("status")} level={level} slot="referral-detail-status" title={LIST_COPY.columns.status}>
        <StatusFacts status={referral.status} />
      </BodySection>
      <Separator />
      {/*
        The window panel owns the resolved New window, the calendar wording shown beside the resolved
        instant, and the disclosure that a date which is only approximate or unknown supports no
        deadline and no Active or Expired judgement. This body adds no endpoint of its own beside it.
        The panel states its own heading level, so in the panel and sheet presentations its title sits
        beside this body's group heading rather than below it; that level belongs to the panel and is
        not restated here.
      */}
      <ReferralWindowPanel referral={referral} dir={dir} />
      <Separator />
      <BodySection headingId={idOf("permitted-dates")} level={level} slot="referral-detail-permitted-dates" title={WINDOW_COPY.heading}>
        <PermittedDatesFacts referral={referral} />
      </BodySection>
      <Separator />
      <ContinueReferralAction scope={scope} referral={referral} continuationPolicy={continuationPolicy} actions={actions} onCheckResult={onCheckResult} headingLevel={REVIEW_HEADING[layout]} dir={dir} />
      <Separator />
      <BodySection headingId={idOf("cycle")} level={level} slot="referral-detail-cycle" title={EXPIRED_HISTORY_COPY.fieldLabels.cycleIndex}>
        <CycleReferenceFacts referral={referral} />
      </BodySection>
    </div>
  );
}
/** The field-keyed refusals a refused read carries, joined into the one line a notice shows beneath its title, so a refusal this view raised is stated in the words the delivering module already wrote rather than re-worded here. */
function refusalSummary(fields: Readonly<Record<string, readonly string[]>>): string | undefined {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? undefined : messages.join(" ");
}
/** The one referral detail body. */
export function ReferralDetail({ scope, referralId, layout, dir, breadcrumb, className }: ReferralDetailProps): ReactElement {
  const requestedId = referralId.trim();
  const referral = useReferral({ scope, referralId: requestedId });
  const { refetch } = referral;
  // One handler answers both the re-request of a failed read and the recovery of a continuation whose
  // acknowledgement was lost: each re-reads this record, and neither re-sends a change.
  const reread = useCallback((): void => {
    void refetch();
  }, [refetch]);
  const noticeHeading = NOTICE_HEADING[layout];
  const noticeClass = cn("text-start", className);
  const retry = { label: RETRY_LABEL, onClick: reread };
  if (requestedId === "") {
    // No cycle is named, so nothing was read and nothing is shown in its place. The request this
    // surface could serve is the missing one, which is a refusal rather than an outage and never an
    // empty record.
    return <StateNotice kind="refused" title={LIST_COPY.heading} headingLevel={noticeHeading} className={noticeClass} />;
  }
  if (referral.isPending) {
    // The read has not answered yet. A loading body is never an empty one: no fact, no deadline and
    // no "not recorded" word is rendered while the answer is still on its way.
    return <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={noticeHeading} loadingLines={5} className={noticeClass} />;
  }
  const read = referral.data;
  if (read === undefined) {
    // No read result came back at all, which is an outage with a re-request rather than a record that
    // holds nothing.
    return <StateNotice kind="unavailable" title={LIST_COPY.heading} retry={retry} headingLevel={noticeHeading} className={noticeClass} />;
  }
  switch (read.kind) {
    case "denied":
      // A denial states no count, title, existence flag or size, so the answer is identical whether or
      // not a cycle exists in the scope this session may not read.
      return <StateNotice kind="denied" title={LIST_COPY.heading} reasonCode={read.denied.reasonCode} headingLevel={noticeHeading} className={noticeClass} />;
    case "unavailable":
      // The outcome's own source and guidance are shown rather than a sentence written here, so the
      // outage names what failed and what to do about it.
      return <StateNotice kind="unavailable" title={LIST_COPY.heading} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={noticeHeading} className={noticeClass} />;
    case "refused":
      // This view's own request was refused, so nothing was read and no source failed.
      return <StateNotice kind="refused" title={LIST_COPY.heading} description={refusalSummary(read.refused.fields)} headingLevel={noticeHeading} className={noticeClass} />;
    case "envelope": {
      const { envelope } = read;
      const data = envelope.data;
      if (data.view === "expired-history") {
        /*
          The read answers an expired cycle in its narrow permitted projection, and that projection is
          the whole of what this presentation shows. It is rendered on its own rather than through the
          record detail body, because that body's identity card and section headings describe a
          partner record while this is a permission over history: an approved identity, its source
          reference, its status and its permitted dates, and nothing wider. The discriminant is the
          `view` the read supplies, never a comparison of dates here.
        */
        return <ExpiredReferralHistory referral={data.referral} status={data.referral.status.status} headingLevel={EXPIRED_HEADING[layout]} dir={dir} className={className} />;
      }
      const record = data.referral;
      const identity: RecordDetailIdentity = {
        displayName: record.partnerDisplayName,
        // The record's own kind, as the envelope states it. The family's copy owns no label map for
        // partner kinds, and a second one written here would be a user-visible word outside copy.ts.
        kind: record.partnerKind,
        ...(record.sourceReference === null ? {} : { reference: record.sourceReference }),
      };
      /*
        The shared body offers one slot per section of a partner record, and a referral cycle is not a
        partner record: its introduction, status, window, permitted dates, continuation and cycle
        reference have no partner-shaped slot to land in. The referral body is therefore carried in the
        relationship-context slot — the one section of the shared body whose meaning covers this
        record's own context — and each fact keeps its own nested heading, order and wording inside it.
        This is a gap in the shared component, which lives outside this folder: a body that is not a
        partner record needs a section slot of its own rather than borrowing this one.
      */
      const sections: RecordDetailSectionSlots = { relationshipContext: <ReferralBody scope={scope} referral={record} continuationPolicy={data.continuationPolicy} actions={envelope.actions} layout={layout} dir={dir} onCheckResult={reread} /> };
      // The breadcrumb names the list context the visitor returns to. A caller that came from a filtered
      // list supplies that address itself, so the filter, the sort and the scroll position survive the
      // visit; a direct visit falls back to the list the shell links to.
      return <RecordDetail layout={layout} identity={identity} sections={sections} breadcrumb={breadcrumb ?? DEFAULT_BREADCRUMB} className={className} />;
    }
  }
}
export default ReferralDetail;
