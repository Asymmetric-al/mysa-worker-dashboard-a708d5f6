"use client";
import { useCallback, useId, useState, type ReactElement, type ReactNode } from "react";
import { hasSettled } from "@/components/attempt";
import RecordDetail, { type RecordDetailBreadcrumbEntry, type RecordDetailIdentity, type RecordDetailLayout, type RecordDetailSectionSlots } from "@/components/record-detail";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusTone } from "@/components/status-badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationOutcome, ReadAction, Scope, reads } from "@/modules/data-service";
import { CONTINUATION_WINDOW_COPY, EXPIRED_HISTORY_COPY, INTRODUCED_BY_COPY, LIST_COPY, PRECISION_COPY, STATUS_COPY, WINDOW_COPY, type ReferralStatusWord } from "../copy";
import { useReferral } from "../hooks/use-referral";
import ContinueReferralAction from "./continue-referral-action";
import ExpiredReferralHistory from "./expired-referral-history";
import ReferralWindowPanel from "./referral-window-panel";
type ReferralEnvelope = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"];
type ReferralView = Extract<ReferralEnvelope["data"], { readonly view: "detail" }>;
type ReferralRow = ReferralView["referral"];
export type ReferralDetailProps = { readonly scope: Scope; readonly referralId: string; readonly layout: RecordDetailLayout; readonly dir?: "ltr" | "rtl"; readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[]; readonly className?: string };
const DEFAULT_BREADCRUMB: readonly RecordDetailBreadcrumbEntry[] = [{ label: LIST_COPY.heading, href: "/partners/referrals" }];
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
/** The one advisory action this presentation reflects: the read publishing it is what makes Continue appear, and the service re-checks the permission on submit, so a stale envelope can produce a `denied` outcome and never an unauthorised write. */
const STATUS_TONE: Readonly<Record<ReferralStatusWord, StatusTone>> = { active: "positive", expired: "neutral", "no-deadline": "caution", refused: "caution", withdrawn: "danger", revoked: "danger", erased: "danger", departed: "danger" };
const BODY_HEADING: Readonly<Record<RecordDetailLayout, "h3" | "h4">> = { page: "h3", panel: "h4", sheet: "h4" };
const REVIEW_HEADING: Readonly<Record<RecordDetailLayout, 3 | 4>> = { page: 3, panel: 4, sheet: 4 };
const EXPIRED_HEADING: Readonly<Record<RecordDetailLayout, 2 | 3 | 4>> = { page: 2, panel: 3, sheet: 3 };
const NOTICE_HEADING: Readonly<Record<RecordDetailLayout, NoticeHeadingLevel>> = { page: 1, panel: 2, sheet: 2 };
const VALUE_CLASS = "min-w-0 wrap-anywhere";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
const EnvelopeDate = ({ value }: { readonly value: string }): ReactElement => (
  <bdi>
    <time {...{ className: "tabular-figures", dateTime: value }}>{value}</time>
  </bdi>
);
const NotRecorded = (): ReactElement => <StatusBadge label={NOT_RECORDED.label} tone={NOT_RECORDED.tone} />;
const Fact = ({ term, value, help, valueClass, trailing }: { readonly term: string; readonly value: ReactNode; readonly help?: string; readonly valueClass?: string; readonly trailing?: ReactNode }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <dt className="text-muted-foreground">{term}</dt>
    <dd className="flex min-w-0 flex-col gap-1 break-words">
      {valueClass === undefined ? value : <span className={valueClass}>{value}</span>}
      {trailing}
      {help === undefined ? null : <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{help}</p>}
    </dd>
  </div>
);
const BODY_HEADING_SCALE: Readonly<Record<"h3" | "h4", string>> = { h3: "type-subsection-title", h4: "type-group-title" };
function BodySection({ headingId, level, slot, title, children }: { readonly headingId: string; readonly level: "h3" | "h4"; readonly slot: string; readonly title: string; readonly children: ReactNode }): ReactElement {
  const Heading = level === "h3" ? "h3" : "h4";
  return (
    <section aria-labelledby={headingId} data-slot={slot} className="flex min-w-0 flex-col gap-2">
      <Heading {...{ id: headingId, className: cn(BODY_HEADING_SCALE[level], "text-pretty wrap-anywhere") }}>{title}</Heading>
      {children}
    </section>
  );
}
function IntroductionFacts({ referral }: { readonly referral: ReferralRow }): ReactElement {
  const precision = PRECISION_COPY[referral.datePrecision];
  const introducedOn = referral.originalIntroductionOn;
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <Fact term={INTRODUCED_BY_COPY.originalIntroductionOnLabel} valueClass={VALUE_CLASS} help={INTRODUCED_BY_COPY.originalIntroductionOnHelp} value={introducedOn === null ? <NotRecorded /> : <EnvelopeDate value={introducedOn} />} />
      <Fact term={INTRODUCED_BY_COPY.datePrecisionLabel} valueClass="flex min-w-0 flex-wrap items-baseline gap-2" help={precision.hint} value={<StatusBadge label={precision.label} tone={referral.datePrecision === "date" ? "info" : "caution"} />} />
      <Fact term={INTRODUCED_BY_COPY.sourceZoneLabel} valueClass={VALUE_CLASS} help={INTRODUCED_BY_COPY.sourceZoneHelp} value={<bdi className="break-all">{referral.sourceZone}</bdi>} />
      <Fact term={INTRODUCED_BY_COPY.entryTimeLabel} valueClass={VALUE_CLASS} help={INTRODUCED_BY_COPY.entryTimeNote} value={<NotRecorded />} />
    </dl>
  );
}
function StatusFacts({ status }: { readonly status: ReferralRow["status"] }): ReactElement {
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
function PermittedDatesFacts({ referral }: { readonly referral: ReferralRow }): ReactElement {
  const labels = EXPIRED_HISTORY_COPY.fieldLabels;
  return (
    <dl className="flex min-w-0 flex-col gap-2 text-sm">
      <Fact term={labels.originalIntroductionOn} valueClass={VALUE_CLASS} value={referral.originalIntroductionOn === null ? <NotRecorded /> : <EnvelopeDate value={referral.originalIntroductionOn} />} />
      <Fact term={labels.windowStart} valueClass={VALUE_CLASS} value={referral.windowStart === null ? <NotRecorded /> : <EnvelopeDate value={referral.windowStart} />} />
      <Fact term={labels.windowEnd} valueClass={VALUE_CLASS} value={referral.windowEnd === null ? <span className="text-muted-foreground">{LIST_COPY.noWindowEndLabel}</span> : <EnvelopeDate value={referral.windowEnd} />} />
    </dl>
  );
}
function CycleReferenceFacts({ referral }: { readonly referral: ReferralRow }): ReactElement {
  const labels = EXPIRED_HISTORY_COPY.fieldLabels;
  const continued = referral.windowKind === "continued";
  return (
    <dl className="flex min-w-0 flex-col gap-2 text-sm">
      <Fact term={labels.cycleIndex} valueClass={VALUE_CLASS} value={<bdi className="tabular-figures">{String(referral.cycleIndex)}</bdi>} />
      <Fact term={labels.windowKind} value={continued ? CONTINUATION_WINDOW_COPY.heading : WINDOW_COPY.newWindowHeading} />
      {referral.predecessorId === null ? null : <Fact term={CONTINUATION_WINDOW_COPY.predecessorLabel} value={<bdi className={IDENTIFIER_CLASS}>{referral.predecessorId}</bdi>} />}
      <Fact term={labels.consumed} value={<span>{referral.consumed ? EXPIRED_HISTORY_COPY.consumedLabels.continued : EXPIRED_HISTORY_COPY.consumedLabels.notContinued}</span>} trailing={referral.successorId === null ? null : <bdi className={IDENTIFIER_CLASS}>{referral.successorId}</bdi>} />
    </dl>
  );
}
/** Whether the read admits the one continuation an expired cycle can hold. Both conditions are the envelope's own facts: the action it published for this cycle, which the service re-checks on submit, and the worker-continuation setting the same read resolved, which withholds that action entirely when it is off. */
const continueOffered = (actions: readonly ReadAction[], policy: ReferralView["continuationPolicy"]): boolean => policy.setting === "on" && actions.some((action) => action.name === "continueReferral" && action.available);
type ReferralBodyProps = {
  readonly scope: Scope;
  readonly referral: ReferralRow;
  readonly continuationPolicy: ReferralView["continuationPolicy"];
  readonly actions: readonly ReadAction[];
  readonly expectedRevision: string;
  readonly layout: RecordDetailLayout;
  readonly dir?: "ltr" | "rtl";
  readonly onCheckResult: () => void;
};
function ReferralBody({ scope, referral, continuationPolicy, actions, expectedRevision, layout, dir, onCheckResult }: ReferralBodyProps): ReactElement {
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
      <ReferralWindowPanel referral={referral} dir={dir} />
      <Separator />
      <BodySection headingId={idOf("permitted-dates")} level={level} slot="referral-detail-permitted-dates" title={WINDOW_COPY.heading}>
        <PermittedDatesFacts referral={referral} />
      </BodySection>
      <Separator />
      <ContinueReferralAction scope={scope} referral={referral} expectedRevision={expectedRevision} continuationPolicy={continuationPolicy} actions={actions} onCheckResult={onCheckResult} headingLevel={REVIEW_HEADING[layout]} dir={dir} />
      <Separator />
      <BodySection headingId={idOf("cycle")} level={level} slot="referral-detail-cycle" title={EXPIRED_HISTORY_COPY.fieldLabels.cycleIndex}>
        <CycleReferenceFacts referral={referral} />
      </BodySection>
    </div>
  );
}
function refusalSummary(fields: Readonly<Record<string, readonly string[]>>): string | undefined {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? undefined : messages.join(" ");
}
/** The one referral detail body. */
export function ReferralDetail({ scope, referralId, layout, dir, breadcrumb, className }: ReferralDetailProps): ReactElement {
  const requestedId = referralId.trim();
  const referral = useReferral({ scope, referralId: requestedId });
  const { refetch } = referral;
  const reread = useCallback((): void => {
    void refetch();
  }, [refetch]);
  const [settledCycleId, setSettledCycleId] = useState<string | null>(null);
  const noticeHeading = NOTICE_HEADING[layout];
  const noticeClass = cn("text-start", className);
  const retry = { label: "Try again", onClick: reread };
  if (requestedId === "") return <StateNotice kind="refused" title={LIST_COPY.heading} headingLevel={noticeHeading} className={noticeClass} />;
  if (referral.isPending) return <StateNotice kind="loading" title={LIST_COPY.heading} headingLevel={noticeHeading} loadingLines={5} className={noticeClass} />;
  const read = referral.data;
  if (read === undefined) return <StateNotice kind="unavailable" title={LIST_COPY.heading} retry={retry} headingLevel={noticeHeading} className={noticeClass} />;
  switch (read.kind) {
    case "denied":
      return <StateNotice kind="denied" title={LIST_COPY.heading} reasonCode={read.denied.reasonCode} headingLevel={noticeHeading} className={noticeClass} />;
    case "unavailable":
      return <StateNotice kind="unavailable" title={LIST_COPY.heading} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={noticeHeading} className={noticeClass} />;
    case "refused":
      return <StateNotice kind="refused" title={LIST_COPY.heading} description={refusalSummary(read.refused.fields)} headingLevel={noticeHeading} className={noticeClass} />;
    case "envelope": {
      const { envelope } = read;
      const data = envelope.data;
      // The one continuation an eligible cycle can hold is offered beside that card and never inside it: the card states a read-only permission over facts a continuation leaves exactly as it carries them, and a cycle that has not ended, one already continued and a setting that is off all render the history alone. A continuation this visit has already taken stands beside that card too, because the reread that follows it no longer offers the action it took and the receipt is the only record of what it produced.
      if (data.view === "expired-history") {
        const cycleId = data.referral.referralId;
        const keepReceipt = (outcome: MutationOutcome): void => {
          if (hasSettled(outcome)) setSettledCycleId(cycleId);
        };
        return (
          <div dir={dir} className={cn("flex min-w-0 flex-col gap-4", className)}>
            <ExpiredReferralHistory referral={data.referral} status={data.referral.status.status} headingLevel={EXPIRED_HEADING[layout]} dir={dir} />
            {continueOffered(envelope.actions, data.continuationPolicy) || settledCycleId === cycleId ? (
              <ContinueReferralAction scope={scope} referral={data.referral} expectedRevision={envelope.revision} continuationPolicy={data.continuationPolicy} actions={envelope.actions} onCheckResult={reread} onSettled={keepReceipt} headingLevel={REVIEW_HEADING[layout]} dir={dir} />
            ) : null}
          </div>
        );
      }
      const record = data.referral;
      const identity: RecordDetailIdentity = { displayName: record.partnerDisplayName, kind: record.partnerKind, ...(record.sourceReference === null ? {} : { reference: record.sourceReference }) };
      const sections: RecordDetailSectionSlots = { relationshipContext: <ReferralBody scope={scope} referral={record} continuationPolicy={data.continuationPolicy} actions={envelope.actions} expectedRevision={envelope.revision} layout={layout} dir={dir} onCheckResult={reread} /> };
      return <RecordDetail layout={layout} identity={identity} sections={sections} breadcrumb={breadcrumb ?? DEFAULT_BREADCRUMB} className={className} />;
    }
  }
}
export default ReferralDetail;
