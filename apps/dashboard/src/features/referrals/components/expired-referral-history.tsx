import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import { CONTINUE_COPY, EXPIRED_HISTORY_COPY, EXPIRY_VS_CLOSURE, FORBIDDEN_FIELDS, LIST_COPY, PRECISION_COPY, STATUS_COPY, WINDOW_COPY, type ReferralStatusWord } from "../copy";
type ReferralDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"];
type ExpiredHistoryRow = Extract<ReferralDetailEnvelope["data"], { readonly view: "expired-history" }>["referral"];
const STATUS_TONE: Readonly<Record<ReferralStatusWord, StatusTone>> = { active: "positive", expired: "neutral", "no-deadline": "caution", refused: "caution", withdrawn: "danger", revoked: "danger", erased: "danger", departed: "danger" };
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
export type ExpiredHistoryHeadingLevel = 2 | 3 | 4;
const HEADINGS: Readonly<Record<ExpiredHistoryHeadingLevel, { readonly title: "h2" | "h3" | "h4"; readonly section: "h3" | "h4"; readonly notice: 3 | 4 }>> = { 2: { title: "h2", section: "h3", notice: 3 }, 3: { title: "h3", section: "h4", notice: 4 }, 4: { title: "h4", section: "h4", notice: 4 } };
const HEADING_SCALE: Readonly<Record<"h2" | "h3" | "h4", string>> = { h2: "type-section-title", h3: "type-subsection-title", h4: "type-group-title" };
export type ExpiredReferralHistoryProps = { readonly referral: ExpiredHistoryRow | null; readonly status?: ReferralStatusWord; readonly searchEmpty?: boolean; readonly headingLevel?: ExpiredHistoryHeadingLevel; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const NotRecorded = (): ReactElement => <StatusBadge label={NOT_RECORDED.label} tone={NOT_RECORDED.tone} />;
const PermittedDate = ({ value }: { readonly value: string | null }): ReactElement => <dd className="min-w-0 wrap-anywhere text-muted-foreground">{value === null ? <NotRecorded /> : <bdi className="tabular-figures">{value}</bdi>}</dd>;
function PermittedFacts({ referral, status }: { readonly referral: ExpiredHistoryRow; readonly status: ReferralStatusWord }): ReactElement {
  const labels = EXPIRED_HISTORY_COPY.fieldLabels;
  const statusCopy = STATUS_COPY[status];
  const reference = referral.sourceReference;
  const separatesClosures = status === "expired" || statusCopy.closureRecordedBySource;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-start text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      <dt className="font-medium">{labels.partner}</dt>
      <dd className="min-w-0 wrap-anywhere text-muted-foreground">
        <bdi>{referral.partnerDisplayName}</bdi>
      </dd>
      <dt className="font-medium">{labels.sourceReference}</dt>
      <dd className="min-w-0 wrap-anywhere text-muted-foreground">{reference === null ? <NotRecorded /> : <bdi className="mono-identifier">{`${reference.system}:${reference.reference}`}</bdi>}</dd>
      <dt className="font-medium">{labels.status}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <StatusBadge label={statusCopy.label} tone={STATUS_TONE[status]} />
        <p className="min-w-0 text-pretty wrap-anywhere text-muted-foreground">{statusCopy.description}</p>
        {separatesClosures ? <p className="min-w-0 text-pretty wrap-anywhere text-muted-foreground">{EXPIRY_VS_CLOSURE}</p> : null}
      </dd>
      <dt className="font-medium">{WINDOW_COPY.heading}</dt>
      <dd className="min-w-0">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-start sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="font-medium">{labels.originalIntroductionOn}</dt>
          <PermittedDate value={referral.originalIntroductionOn} />
          <dt className="font-medium">{labels.datePrecision}</dt>
          <dd className="min-w-0 wrap-anywhere text-muted-foreground">{PRECISION_COPY[referral.datePrecision].label}</dd>
          <dt className="font-medium">{labels.windowStart}</dt>
          <PermittedDate value={referral.windowStart} />
          <dt className="font-medium">{labels.windowEnd}</dt>
          <PermittedDate value={referral.windowEnd} />
        </dl>
      </dd>
    </dl>
  );
}
const AbsentFacts = (): ReactElement => (
  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-start text-sm">
    {FORBIDDEN_FIELDS.map((absent) => (
      <div key={absent.field} className="flex min-w-0 flex-col gap-0.5">
        <dt className="font-medium">{absent.label}</dt>
        <dd className="min-w-0 text-pretty wrap-anywhere text-muted-foreground">{absent.reason}</dd>
      </div>
    ))}
  </dl>
);
export default function ExpiredReferralHistory({ referral, status, searchEmpty = false, headingLevel = 2, dir, className }: ExpiredReferralHistoryProps): ReactElement {
  const headings = HEADINGS[headingLevel];
  const TitleTag = headings.title;
  const SectionTag = headings.section;
  const emptyNotice = searchEmpty ? (
    <StateNotice kind="empty" headingLevel={headings.notice} title={LIST_COPY.search.empty.title} description={EXPIRED_HISTORY_COPY.noMatchingHint} />
  ) : (
    <StateNotice kind="empty" headingLevel={headings.notice} title={LIST_COPY.views.expired.empty.title} description={LIST_COPY.views.expired.empty.body} />
  );
  return (
    <Card dir={dir} className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>
          <TitleTag className={HEADING_SCALE[headings.title]}>{EXPIRED_HISTORY_COPY.heading}</TitleTag>
        </CardTitle>
        <CardDescription className="text-pretty wrap-anywhere">{EXPIRED_HISTORY_COPY.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <Alert>
          <AlertTitle>{EXPIRED_HISTORY_COPY.permissionStatement}</AlertTitle>
          <AlertDescription>{EXPIRED_HISTORY_COPY.readOnlyNote}</AlertDescription>
        </Alert>
        {referral === null || searchEmpty ? (
          emptyNotice
        ) : (
          <>
            <PermittedFacts referral={referral} status={status ?? referral.status.status} />
            {/* The read this card renders already publishes why no Continue action stands for the cycle, and the panel that states that reason is not composed when the setting withholds the action, so the reason is disclosed here instead: this card is the one expired presentation the list and the detail both render, and the reason the read published belongs on both. */}
            {referral.continuation.reason === null ? null : (
              <div className="flex min-w-0 flex-col gap-2" data-slot="continue-referral-unavailable">
                <SectionTag className={HEADING_SCALE[headings.section]}>{CONTINUE_COPY.unavailableHeading}</SectionTag>
                <p className="min-w-0 text-pretty wrap-anywhere text-muted-foreground">{referral.continuation.reason}</p>
              </div>
            )}
          </>
        )}
        <Separator />
        <div className="flex min-w-0 flex-col gap-2">
          <SectionTag className={HEADING_SCALE[headings.section]}>{EXPIRED_HISTORY_COPY.absentHeading}</SectionTag>
          <AbsentFacts />
        </div>
      </CardContent>
    </Card>
  );
}
