"use client";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, type ReactElement } from "react";
import { factFrame } from "@/components/fact-list";
import { refusalSummary } from "@/components/form-field";
import SectionCard from "@/components/section-card";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { BUCKET_STATUS, statusBadgeProps, valueStateWord, type StatusTone } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { countTextOf } from "@/lib/count-format";
import { formatSourceReference } from "@/lib/ids";
import { SUPPORT_BASES, type Scope, type ValueState } from "@/modules/data-service/envelope";
import { OUTSIDE_PARTITION, type RecurringBucket } from "@/modules/support/buckets";
import { BUCKET_MEANING, COMMITMENT_KIND_LABELS, EMPTY_STATES, FIXED_TOTAL_FIELDS, MEASURE_LABELS } from "../copy";
import { parseCommitmentsQuery, toCommitmentsParams, useCommitments, type CommitmentsEnvelope, type CommitmentsQuery } from "../hooks/use-commitments";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
type CommitmentRowFigure = CommitmentsEnvelope["data"]["commitments"][number];
type FixedTotalFigure = NonNullable<CommitmentRowFigure["fixedTotal"]>;
export type CommitmentDetailProps = { readonly scope: Scope; readonly commitmentId: string; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly listQuery?: CommitmentsQuery; readonly className?: string };
const LABELS = {
  cadence: "Cadence",
  perOccurrence: "Per occurrence",
  currentOutcome: "Current outcome",
  lastSuccessful: "Last successful collection",
  nextEligible: "Next eligible date",
  resumeOn: "Resumes on",
  source: "Source",
  organization: "Organization",
  ministry: "Ministry",
  supportSubject: "Support subject",
  principal: "Acting principal",
} as const;
const LIST_ACTION_LABEL = "Open the commitments list";
const WRAPPING_BADGE_CLASS = "h-auto max-w-full shrink whitespace-normal text-start";
const OUTCOME_LEAD =
  "The source states this commitment's current outcome, and one count per outcome across every commitment " +
  "this read states in this context. It states no occurrence-by-occurrence history, so no history row is " +
  "written to stand in for one: a date the source did not state stays a gap rather than becoming a received, " +
  "processing or upcoming occurrence.";
const NOT_IN_PAGE_DESCRIPTION = "The commitments read states one page of the source's commitments, and no commitment in the page it " + "returned carries this identifier. Either no commitment in this context carries it, or it stands on a page " + "this read did not return. Nothing is filled in for it either way.";
const DENIED_DESCRIPTION = "The read was refused for the context this session is admitted to. Nothing here states whether a commitment carries that identifier, what it would be, or how large it is.";
const NO_ANSWER_DESCRIPTION = "The request for this commitment did not come back as an answer this page can present, so nothing is shown and no amount stands in for it: this is not zero and not an empty result.";
const valueStateAt = (valueStates: Readonly<Record<string, ValueState>>, path: string): ValueState => valueStates[path] ?? "unknown";
const fixedTotalStatePath = (commitmentId: string, field: keyof FixedTotalFigure): string => `commitments.${commitmentId}.fixedTotal.${field}`;
const perOccurrenceStatePath = (commitmentId: string): string => `commitments.${commitmentId}.perOccurrence`;
const commitmentCountText = (count: number, locale: string): string => `${countTextOf(count, locale)} ${count === 1 ? "commitment" : "commitments"}`;
function currenciesOf(row: CommitmentRowFigure): readonly string[] {
  const seen = new Set<string>([row.perOccurrence.currency]);
  if (row.fixedTotal !== null) for (const { field } of FIXED_TOTAL_FIELDS) seen.add(row.fixedTotal[field].currency);
  return [...seen];
}
const returnPathOf = (listQuery: CommitmentsQuery): string => `/support/commitments?${toCommitmentsParams({ page: listQuery.page }).toString()}`;
function pauseReadingOf(pause: CommitmentRowFigure["pause"]): { readonly label: string; readonly tone: StatusTone; readonly sentence: string; readonly resumeOn: string | null } {
  if (pause.state === "active") return { label: "Running", tone: "positive", sentence: "The source reports this commitment running, so no pause stands in front of the next date it states.", resumeOn: null };
  if (pause.state === "paused") return { label: "Paused", tone: "caution", resumeOn: pause.resumeOn, sentence: pause.resumeOn === null ? "The source reports this commitment paused and states no date for resuming." : "The source reports this commitment paused; the date it states for resuming is stated below." };
  return { label: "State not stated", tone: "muted", sentence: "The state the source reported for this commitment is not one this page can present, so no pause or active reading is given to it.", resumeOn: null };
}
const ReturnPath = ({ href }: { readonly href: string }): ReactElement => (
  <nav aria-label="Breadcrumb" className="min-w-0">
    <Link href={href} aria-label="Return to the commitments list with the filters and page you came from" className="inline-link inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground">
      <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0 rtl:-scale-x-100" />
      <span className="min-w-0 break-words">Commitments</span>
    </Link>
  </nav>
);
const Fact = factFrame({ rowClassName: "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1", termClassName: "font-medium text-muted-foreground", valueClassName: "min-w-0 break-words" });
const Identifier = ({ value }: { readonly value: string }): ReactElement => <bdi className="mono-identifier break-all">{value}</bdi>;
function SourceDate({ value }: { readonly value: string | null }): ReactElement {
  if (value === null) return <span className="text-muted-foreground">{"The source states no date"}</span>;
  return (
    <bdi>
      <time {...{ dateTime: value, className: "mono-identifier" }}>{value}</time>
    </bdi>
  );
}
function CountFigure({ count, valueState, locale }: { readonly count: number; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  const word = valueStateWord(valueState);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="tabular-figures text-sm font-medium">{commitmentCountText(count, locale)}</span>
      {word === undefined ? null : <StatusBadge label={word.label} tone={word.tone} />}
    </span>
  );
}
const CommitmentDetailSkeleton = ({ dir, className }: { readonly dir?: "ltr" | "rtl"; readonly className?: string }): ReactElement => (
  <div dir={dir} aria-busy={true} className={cn("flex min-w-0 flex-col gap-4", className)}>
    <output className="flex items-center gap-2 text-sm text-muted-foreground">Reading this commitment…</output>
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-2/3 rounded-md" />
        <Skeleton className="h-4 w-1/3 rounded-md" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-8 w-1/2 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-4/5 rounded-md" />
        <Skeleton className="h-4 w-3/5 rounded-md" />
      </CardContent>
    </Card>
  </div>
);
function OverviewCard({ row, valueStates, locale }: { readonly row: CommitmentRowFigure; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement {
  const pause = pauseReadingOf(row.pause);
  return (
    <SectionCard
      title={Object.hasOwn(COMMITMENT_KIND_LABELS, row.kind) ? COMMITMENT_KIND_LABELS[row.kind] : "A kind of commitment this read does not name"}
      headingLevel={1}
      headingId="commitment-overview-heading"
      description={
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span>{LABELS.cadence}</span>
          <bdi className="mono-identifier break-all">{row.cadence}</bdi>
        </span>
      }
      action={<Badge variant="outline">{MEASURE_LABELS.commitments}</Badge>}
      contentClassName="flex min-w-0 flex-col gap-4"
      region={{ id: "commitment-overview-heading", className: "min-w-0" }}
    >
      <dl className="flex min-w-0 flex-col gap-1">
        <dt className="text-sm font-medium text-muted-foreground">{LABELS.perOccurrence}</dt>
        <dd className="min-w-0">
          <AmountValue money={row.perOccurrence} valueState={valueStateAt(valueStates, perOccurrenceStatePath(row.commitmentRowId))} locale={locale} emphasis="headline" />
        </dd>
      </dl>
      <p className="type-supporting text-pretty">{"A commitment is the source's standing arrangement, not received cash: this amount is never counted as money received, and the outcome beside it states where the collection stands rather than what arrived."}</p>
      <Separator />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{LABELS.currentOutcome}</span>
          <StatusBadge {...statusBadgeProps(BUCKET_STATUS, row.bucket)} srPrefix={LABELS.currentOutcome} className={WRAPPING_BADGE_CLASS} />
        </p>
        <p className="type-supporting text-pretty">{BUCKET_MEANING[row.bucket]}</p>
      </div>
      <Separator />
      <p className="type-supporting text-pretty">{"This page is read-only: it cannot post, retry, pause, resume or correct a payment, and no control on it changes anything at the source."}</p>
      <Separator />
      <section aria-labelledby="commitment-dates-heading" className="flex min-w-0 flex-col gap-2">
        <h2 {...{ id: "commitment-dates-heading", className: "type-section-title" }}>Live dates</h2>
        <dl className="flex min-w-0 flex-col gap-2 text-sm">
          <Fact term={LABELS.lastSuccessful} value={<SourceDate value={row.lastSuccessfulOn} />} />
          <Fact term={LABELS.nextEligible} value={<SourceDate value={row.nextEligibleOn} />} />
          <Fact
            term="Pause"
            value={
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <StatusBadge label={pause.label} tone={pause.tone} srPrefix="Pause" />
                  <span className="min-w-0 break-words text-muted-foreground">{pause.sentence}</span>
                </span>
                {pause.resumeOn === null ? null : (
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <span className="font-medium text-muted-foreground">{LABELS.resumeOn}</span>
                    <SourceDate value={pause.resumeOn} />
                  </span>
                )}
              </span>
            }
          />
        </dl>
      </section>
    </SectionCard>
  );
}
const FIXED_TOTAL_DESCRIPTION = "These are the four amounts the source states for this fixed total, each shown as its own fact: this page does not subtract one from another, does not state a fifth figure and does not present a share of the total.";
const FixedTotalCard = ({ commitmentId, fixedTotal, valueStates, locale }: { readonly commitmentId: string; readonly fixedTotal: FixedTotalFigure; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement => (
  <SectionCard headingId="commitment-fixed-total-heading" region={{ id: "commitment-fixed-total-heading", className: "min-w-0" }} title="Fixed total progress" description={FIXED_TOTAL_DESCRIPTION}>
    <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {FIXED_TOTAL_FIELDS.map(({ field, label }) => (
        <div key={field} className="flex min-w-0 flex-col gap-1">
          <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
          <dd className="min-w-0">
            <AmountValue money={fixedTotal[field]} valueState={valueStateAt(valueStates, fixedTotalStatePath(commitmentId, field))} locale={locale} />
          </dd>
        </div>
      ))}
    </dl>
  </SectionCard>
);
const OutcomeHistoryCard = ({ buckets, total, current, locale }: { readonly buckets: readonly CommitmentsEnvelope["data"]["buckets"][number][]; readonly total: number; readonly current: RecurringBucket; readonly locale: string }): ReactElement => (
  <SectionCard headingId="commitment-outcome-heading" region={{ id: "commitment-outcome-heading", className: "min-w-0" }} title="Outcome history" description={OUTCOME_LEAD} contentClassName="flex min-w-0 flex-col gap-3">
    <p className="type-supporting">{`The read states ${commitmentCountText(total, locale)} in this context.`}</p>
    <ul className="flex min-w-0 flex-col gap-2">
      {buckets.map((figure) => {
        const isCurrent = figure.bucket === current;
        return (
          <li key={figure.bucket} data-outcome={figure.bucket} className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-3", figure.bucket === OUTSIDE_PARTITION && "bg-muted/40", isCurrent && "ring-1 ring-ring")}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusBadge {...statusBadgeProps(BUCKET_STATUS, figure.bucket)} srPrefix="Outcome" className={WRAPPING_BADGE_CLASS} />
              <CountFigure count={figure.count} valueState={figure.valueState} locale={locale} />
              {isCurrent ? <span className="text-xs font-medium">{"This commitment's outcome"}</span> : null}
            </div>
            <p className="type-supporting text-pretty">{BUCKET_MEANING[figure.bucket]}</p>
          </li>
        );
      })}
    </ul>
  </SectionCard>
);
function ProvenanceCard({ envelope, row, locale }: { readonly envelope: CommitmentsEnvelope; readonly row: CommitmentRowFigure; readonly locale: string }): ReactElement {
  const scoped: readonly [string, string][] = [
    [LABELS.organization, envelope.scope.organizationId],
    [LABELS.ministry, envelope.scope.ministryId],
    [LABELS.supportSubject, envelope.scope.supportSubjectId],
    [LABELS.principal, envelope.scope.principalId],
  ];
  return (
    <SectionCard headingId="commitment-provenance-heading" region={{ id: "commitment-provenance-heading", className: "min-w-0" }} title="Provenance and snapshot" contentClassName="flex min-w-0 flex-col gap-4">
      <dl className="flex min-w-0 flex-col gap-2 text-sm">
        <Fact term={LABELS.source} value={<bdi className="mono-identifier break-all">{formatSourceReference(envelope.source)}</bdi>} />
        {scoped.map(([term, value]) => (
          <Fact key={term} term={term} value={<Identifier value={value} />} />
        ))}
      </dl>
      <Separator />
      <SnapshotStatement basis={SUPPORT_BASES[0]} currencies={currenciesOf(row)} period={null} coverage={envelope.coverage} asOf={envelope.asOf} isCurrentPeriod={false} locale={locale} />
    </SectionCard>
  );
}
function EnvelopeBody({ envelope, commitmentId, locale, returnHref }: { readonly envelope: CommitmentsEnvelope; readonly commitmentId: string; readonly locale: string; readonly returnHref: string }): ReactElement {
  const { commitments, buckets, total } = envelope.data;
  const row = commitments.find((candidate) => candidate.commitmentRowId === commitmentId);
  if (total === 0) return <StateNotice kind="empty" headingLevel={1} title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />;
  if (row === undefined) return <StateNotice kind="empty" headingLevel={1} title="No commitment in this read carries that identifier" description={NOT_IN_PAGE_DESCRIPTION} action={{ label: LIST_ACTION_LABEL, href: returnHref }} />;
  return (
    <>
      <OverviewCard row={row} valueStates={envelope.valueStates} locale={locale} />
      {row.fixedTotal === null ? null : <FixedTotalCard commitmentId={row.commitmentRowId} fixedTotal={row.fixedTotal} valueStates={envelope.valueStates} locale={locale} />}
      <OutcomeHistoryCard buckets={buckets} total={total} current={row.bucket} locale={locale} />
      <ProvenanceCard envelope={envelope} row={row} locale={locale} />
    </>
  );
}
type CommitmentDetailBodyProps = CommitmentDetailProps & { readonly listQuery: CommitmentsQuery };
function CommitmentDetailBody({ scope, commitmentId, locale, dir, listQuery, className }: CommitmentDetailBodyProps): ReactElement {
  const returnHref = useMemo(() => returnPathOf(listQuery), [listQuery]);
  const { data: answer, isError, isPending, refetch } = useCommitments({ scope, query: useMemo<CommitmentsQuery>(() => ({ page: listQuery.page, commitmentId }), [listQuery, commitmentId]) });
  const retry = { label: "Read this commitment again", onClick: (): void => void refetch() };
  const listAction = { label: LIST_ACTION_LABEL, href: returnHref };
  const framed = (content: ReactElement): ReactElement => (
    <div dir={dir} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <ReturnPath href={returnHref} />
      {content}
    </div>
  );
  if (isPending) return framed(<CommitmentDetailSkeleton />);
  if (isError || answer === undefined) return framed(<StateNotice kind="unavailable" headingLevel={1} title="This commitment has no answer to state" description={NO_ANSWER_DESCRIPTION} retry={retry} />);
  if (answer.kind === "denied") return framed(<StateNotice kind="denied" headingLevel={1} title="This commitment is not shown in this context" description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} action={listAction} />);
  if (answer.kind === "unavailable") return framed(<StateNotice kind="unavailable" headingLevel={1} title="This commitment could not be read" description={answer.unavailable.guidance} source={answer.unavailable.source} action={listAction} retry={retry} />);
  if (answer.kind === "refused") return framed(<StateNotice kind="refused" headingLevel={1} title="This commitment's request was refused" description={refusalSummary(answer.refused)} action={listAction} />);
  return framed(<EnvelopeBody envelope={answer.envelope} commitmentId={commitmentId} locale={locale} returnHref={returnHref} />);
}
function UrlDerivedDetail(props: CommitmentDetailProps): ReactElement {
  const searchParams = useSearchParams();
  const listQuery = useMemo(() => parseCommitmentsQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  return <CommitmentDetailBody {...props} listQuery={listQuery} />;
} /** One commitment, read-only: its kind, cadence, per-occurrence amount, the outcome it sits in and what that outcome means, the dates the source states, a fixed total's four figures, the outcome partition and its provenance. */
export function CommitmentDetail(props: CommitmentDetailProps): ReactElement {
  const { listQuery } = props;
  if (listQuery !== undefined) return <CommitmentDetailBody {...props} listQuery={listQuery} />;
  return (
    <Suspense fallback={<CommitmentDetailSkeleton dir={props.dir} className={props.className} />}>
      <UrlDerivedDetail {...props} />
    </Suspense>
  );
}
export default CommitmentDetail;
