"use client";
/**
 * The commitment detail body: one commitment as the source states it — its kind, cadence and
 * per-occurrence amount, the outcome it currently sits in together with what that outcome means, the
 * dates the source reports for it, a fixed total's four figures, the outcome partition this read
 * states, its provenance and the snapshot it was read in.
 *
 * The surface is read-only by construction, not by convention: it holds no control that posts,
 * retries, pauses, resumes or corrects a payment, so nothing here can change a commitment, and a
 * commitment is never presented as received cash.
 */
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, type ReactElement, type ReactNode } from "react";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { BUCKET_STATUS, statusBadgeProps, valueStateWord, type StatusTone } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatSourceReference } from "@/lib/ids";
// The one basis declaration this application names: the detail states it rather than writing a second
// spelling of the basis beside it.
import { SUPPORT_BASES, type Scope, type ValueState } from "@/modules/data-service/envelope";
import { OUTSIDE_PARTITION, type CommitmentKind, type RecurringBucket } from "@/modules/support/buckets";
import { BUCKET_MEANING, EMPTY_STATES, MEASURE_LABELS } from "../copy";
import { parseCommitmentsQuery, toCommitmentsParams, useCommitments, type CommitmentsEnvelope, type CommitmentsQuery } from "../hooks/use-commitments";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
// The shapes this surface reads, taken from the read rather than restated
/** One commitment as the commitments read states it. */
type CommitmentRowFigure = CommitmentsEnvelope["data"]["commitments"][number];
/** The four amounts a fixed total states. */
type FixedTotalFigure = NonNullable<CommitmentRowFigure["fixedTotal"]>;
/** One of those four amounts, named rather than numbered. */
type FixedTotalField = keyof FixedTotalFigure;
/** One entry of the outcome partition the read states beside the commitments themselves. */
type OutcomeBucketFigure = CommitmentsEnvelope["data"]["buckets"][number];
// What a caller passes
/** Props of {@link CommitmentDetail}. */
export type CommitmentDetailProps = {
  readonly scope: Scope;
  /** The opaque identifier the route names; it is compared, never parsed. */
  readonly commitmentId: string;
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  /** The list state the worker came from, so the return link restores the same page and facets. */
  readonly listQuery?: CommitmentsQuery;
  readonly className?: string;
};
// The words this surface owns, and no state vocabulary it would duplicate
/**
 * The three commitment kinds, in the source's own terms. No other file words these, so the map lives
 * here rather than in the family's copy module; a fourth kind fails to compile until it is worded.
 */
export const COMMITMENT_KIND_LABELS: Readonly<Record<CommitmentKind, string>> = {
  "automatic-recurring": "Automatic recurring commitment",
  "manual-recurring": "Manual recurring commitment",
  "fixed-total": "Fixed-total commitment",
};
const UNRECOGNISED_KIND_WORD = "A kind of commitment this read does not name";

const FIXED_TOTAL_FIELDS = ["promised", "fulfilled", "released", "remaining"] as const satisfies readonly FixedTotalField[];
/** The source's four fixed-total figures, each its own fact: nothing here sums, subtracts or shares them. */
const FIXED_TOTAL_LABELS: Readonly<Record<FixedTotalField, string>> = {
  promised: "Promised",
  fulfilled: "Fulfilled",
  released: "Released",
  remaining: "Remaining",
};
const LIST_ROUTE = "/support/commitments";

const OVERVIEW_HEADING_ID = "commitment-overview-heading";
const DATES_HEADING_ID = "commitment-dates-heading";
const FIXED_TOTAL_HEADING_ID = "commitment-fixed-total-heading";
const OUTCOME_HEADING_ID = "commitment-outcome-heading";
const PROVENANCE_HEADING_ID = "commitment-provenance-heading";

const LABELS = {
  cadence: "Cadence",
  perOccurrence: "Per occurrence",
  currentOutcome: "Current outcome",
  outcome: "Outcome",
  lastSuccessful: "Last successful collection",
  nextEligible: "Next eligible date",
  pause: "Pause",
  resumeOn: "Resumes on",
  source: "Source",
  organization: "Organization",
  ministry: "Ministry",
  supportSubject: "Support subject",
  principal: "Acting principal",
} as const;

const HEADINGS = {
  dates: "Live dates",
  fixedTotal: "Fixed total",
  outcomes: "Outcome history",
  provenance: "Provenance and snapshot",
} as const;

const RETURN_LABEL = "Commitments";
const RETURN_ACCESSIBLE_NAME = "Return to the commitments list with the filters and page you came from";
const LIST_ACTION_LABEL = "Open the commitments list";
const READING_LABEL = "Reading this commitment…";
const CURRENT_ROW_MARKER = "This commitment's outcome";
const NOT_STATED_DATE = "The source states no date";

const READ_ONLY_STATEMENT = "This page is read-only: it cannot post, retry, pause, resume or correct a payment, and no control on it changes anything at the source.";
const NOT_CASH_STATEMENT =
  "A commitment is the source's standing arrangement, not received cash: this amount is never counted as " +
  "money received, and the outcome beside it states where the collection stands rather than what arrived.";
const FIXED_TOTAL_STATEMENT =
  "These are the four amounts the source states for this fixed total, each shown as its own fact: this page " +
  "does not subtract one from another, does not state a fifth figure and does not present a share of the total.";
const OUTCOME_LEAD =
  "The source states this commitment's current outcome, and one count per outcome across every commitment " +
  "this read states in this context. It states no occurrence-by-occurrence history, so no history row is " +
  "written to stand in for one: a date the source did not state stays a gap rather than becoming a received, " +
  "processing or upcoming occurrence.";

const DENIED_TITLE = "This commitment is not shown in this context";
const DENIED_DESCRIPTION = "The read was refused for the context this session is admitted to. Nothing here states whether a commitment carries that identifier, what it would be, or how large it is.";

const UNAVAILABLE_TITLE = "This commitment could not be read";
const UNAVAILABLE_RETRY_LABEL = "Read this commitment again";

const NO_ANSWER_TITLE = "This commitment has no answer to state";
const NO_ANSWER_DESCRIPTION =
  "The request for this commitment did not come back as an answer this page can present, so nothing is shown " + "and no amount stands in for it: this is not zero and not an empty result.";

const NOT_IN_PAGE_TITLE = "No commitment in this read carries that identifier";
const NOT_IN_PAGE_DESCRIPTION =
  "The commitments read states one page of the source's commitments, and no commitment in the page it " +
  "returned carries this identifier. Either no commitment in this context carries it, or it stands on a page " +
  "this read did not return. Nothing is filled in for it either way.";

const UNSTATED_PAUSE_WORD = "State not stated";
// Reading one fact out of the read's own vocabularies
function kindLabelOf(kind: CommitmentKind): string {
  return Object.hasOwn(COMMITMENT_KIND_LABELS, kind) ? COMMITMENT_KIND_LABELS[kind] : UNRECOGNISED_KIND_WORD;
}
/**
 * The state the read declared for one value. A path the read did not state is `unknown` rather than a
 * plain number: an unstated value is never presented as a value.
 */
function valueStateAt(valueStates: Readonly<Record<string, ValueState>>, path: string): ValueState {
  return valueStates[path] ?? "unknown";
}
/** The path the commitments read records one fixed-total amount's state under. */
function fixedTotalStatePath(commitmentId: string, field: FixedTotalField): string {
  return `commitments.${commitmentId}.fixedTotal.${field}`;
}
function integerText(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
function commitmentCountText(count: number, locale: string): string {
  const formatted = integerText(count, locale);
  return count === 1 ? `${formatted} commitment` : `${formatted} commitments`;
}
/** The currencies this record's amounts are stated in, in the order the source states them and never combined. */
function currenciesOf(row: CommitmentRowFigure): readonly string[] {
  const seen = new Set<string>();
  seen.add(row.perOccurrence.currency);
  if (row.fixedTotal !== null) {
    for (const field of FIXED_TOTAL_FIELDS) {
      seen.add(row.fixedTotal[field].currency);
    }
  }
  return [...seen];
}
/** The list state to return to: the same page and facet answer, without the narrowed commitment. */
function returnPathOf(listQuery: CommitmentsQuery): string {
  const params = toCommitmentsParams({ showAdditionalTypes: listQuery.showAdditionalTypes, page: listQuery.page });
  return `${LIST_ROUTE}?${params.toString()}`;
}
// One reading of the pause state
interface PauseReading {
  readonly label: string;
  readonly tone: StatusTone;
  readonly sentence: string;
  readonly resumeOn: string | null;
}
function pauseReadingOf(pause: CommitmentRowFigure["pause"]): PauseReading {
  switch (pause.state) {
    case "active":
      return { label: "Running", tone: "positive", sentence: "The source reports this commitment running, so no pause stands in front of the next date it states.", resumeOn: null };
    case "paused":
      return {
        label: "Paused",
        tone: "caution",
        resumeOn: pause.resumeOn,
        sentence:
          pause.resumeOn === null
            ? "The source reports this commitment paused and states no date for resuming."
            : "The source reports this commitment paused; the date it states for resuming is stated below.",
      };
    default:
      // The stored union has two members, so this arm only runs for a value this build does not know:
      // it states that honestly instead of guessing which of the two it might have meant.
      return {
        label: UNSTATED_PAUSE_WORD,
        tone: "muted",
        sentence: "The state the source reported for this commitment is not one this page can present, so no pause or active reading is given to it.",
        resumeOn: null,
      };
  }
}
// Small presentational pieces
function ReturnPath({ href }: { readonly href: string }): ReactElement {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <Link href={href} aria-label={RETURN_ACCESSIBLE_NAME} className="inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground">
        <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0 rtl:-scale-x-100" />
        <span className="min-w-0 break-words">{RETURN_LABEL}</span>
      </Link>
    </nav>
  );
}
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <dt className="font-medium text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
function Identifier({ value }: { readonly value: string }): ReactElement {
  return <bdi className="mono-identifier break-all">{value}</bdi>;
}
/** One civil date exactly as the read supplied it, or the honest statement that the source stated none. */
function SourceDate({ value }: { readonly value: string | null }): ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground">{NOT_STATED_DATE}</span>;
  }
  return (
    <bdi>
      <time dateTime={value} className="mono-identifier">
        {value}
      </time>
    </bdi>
  );
}
/** One count the read states, together with the word for its state when it is not a plain value. */
function CountFigure({ count, valueState, locale }: { readonly count: number; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  const word = valueStateWord(valueState);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="tabular-figures text-sm font-medium">{commitmentCountText(count, locale)}</span>
      {word === undefined ? null : <StatusBadge label={word.label} tone={word.tone} />}
    </span>
  );
}
function CommitmentDetailSkeleton({ dir, className }: { readonly dir?: "ltr" | "rtl"; readonly className?: string }): ReactElement {
  return (
    <div dir={dir} aria-busy={true} className={cn("flex min-w-0 flex-col gap-4", className)}>
      {/* `<output>` is the busiest-state line's semantic element: it carries the status role itself, so
          the busy state needs no role attribute standing in for an element that already means this. */}
      <output className="flex items-center gap-2 text-sm text-muted-foreground">{READING_LABEL}</output>
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
}

// The record's own facts: what it is, where it stands, and the dates the source reports
interface OverviewCardProps {
  readonly row: CommitmentRowFigure;
  readonly locale: string;
}
function OverviewCard({ row, locale }: OverviewCardProps): ReactElement {
  const pause = pauseReadingOf(row.pause);
  return (
    <section aria-labelledby={OVERVIEW_HEADING_ID} className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={OVERVIEW_HEADING_ID}>{kindLabelOf(row.kind)}</h2>
          </CardTitle>
          <CardDescription>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span>{LABELS.cadence}</span>
              <bdi className="mono-identifier break-all">{row.cadence}</bdi>
            </span>
          </CardDescription>
          {/*
            The measure this record belongs to, named from the one measure vocabulary: commitments are
            one of the five support measures and are never read as received cash.
          */}
          <CardAction>
            <Badge variant="outline">{MEASURE_LABELS.commitments}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="flex min-w-0 flex-col gap-1">
            <dt className="text-sm font-medium text-muted-foreground">{LABELS.perOccurrence}</dt>
            <dd className="min-w-0">
              <AmountValue money={row.perOccurrence} valueState={row.perOccurrenceState} locale={locale} emphasis="headline" />
            </dd>
          </dl>
          <p className="text-sm text-pretty text-muted-foreground">{NOT_CASH_STATEMENT}</p>
          <Separator />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{LABELS.currentOutcome}</span>
              {/*
                Every outcome word comes from the one status vocabulary, whose labels are the support
                module's `BUCKET_LABELS`, so the same outcome is never spelled two ways.
              */}
              <StatusBadge {...statusBadgeProps(BUCKET_STATUS, row.bucket)} srPrefix={LABELS.currentOutcome} />
            </p>
            <p className="text-sm text-pretty text-muted-foreground">{BUCKET_MEANING[row.bucket]}</p>
          </div>
          <Separator />
          <p className="text-sm text-pretty">{READ_ONLY_STATEMENT}</p>
          <Separator />
          <section aria-labelledby={DATES_HEADING_ID} className="flex min-w-0 flex-col gap-2">
            <h3 id={DATES_HEADING_ID} className="text-sm font-semibold">
              {HEADINGS.dates}
            </h3>
            <dl className="flex min-w-0 flex-col gap-2 text-sm">
              <Fact term={LABELS.lastSuccessful}>
                <SourceDate value={row.lastSuccessfulOn} />
              </Fact>
              <Fact term={LABELS.nextEligible}>
                <SourceDate value={row.nextEligibleOn} />
              </Fact>
              <Fact term={LABELS.pause}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                    <StatusBadge label={pause.label} tone={pause.tone} srPrefix={LABELS.pause} />
                    <span className="min-w-0 break-words text-muted-foreground">{pause.sentence}</span>
                  </span>
                  {pause.resumeOn === null ? null : (
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                      <span className="font-medium text-muted-foreground">{LABELS.resumeOn}</span>
                      <SourceDate value={pause.resumeOn} />
                    </span>
                  )}
                </span>
              </Fact>
            </dl>
          </section>
        </CardContent>
      </Card>
    </section>
  );
}
// A fixed total's four figures, each its own value with its own state
interface FixedTotalCardProps {
  readonly commitmentId: string;
  readonly fixedTotal: FixedTotalFigure;
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly locale: string;
}
function FixedTotalCard({ commitmentId, fixedTotal, valueStates, locale }: FixedTotalCardProps): ReactElement {
  return (
    <section aria-labelledby={FIXED_TOTAL_HEADING_ID} className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={FIXED_TOTAL_HEADING_ID}>{HEADINGS.fixedTotal}</h2>
          </CardTitle>
          <CardDescription>{FIXED_TOTAL_STATEMENT}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {FIXED_TOTAL_FIELDS.map((field) => (
              <div key={field} className="flex min-w-0 flex-col gap-1">
                <dt className="text-sm font-medium text-muted-foreground">{FIXED_TOTAL_LABELS[field]}</dt>
                <dd className="min-w-0">
                  <AmountValue money={fixedTotal[field]} valueState={valueStateAt(valueStates, fixedTotalStatePath(commitmentId, field))} locale={locale} />
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
// The outcome partition the read states, in the service's order
interface OutcomeHistoryProps {
  readonly buckets: readonly OutcomeBucketFigure[];
  readonly total: number;
  readonly current: RecurringBucket;
  readonly locale: string;
}
function OutcomeHistoryCard({ buckets, total, current, locale }: OutcomeHistoryProps): ReactElement {
  return (
    <section aria-labelledby={OUTCOME_HEADING_ID} className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={OUTCOME_HEADING_ID}>{HEADINGS.outcomes}</h2>
          </CardTitle>
          <CardDescription>{OUTCOME_LEAD}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-muted-foreground">{`The read states ${commitmentCountText(total, locale)} in this context.`}</p>
          {/*
            Mapped in the order the service states them and never re-sorted: the five outcomes first and
            `outside-partition` last. Each keeps its own count, its own state word and its own meaning, so a
            processing or upcoming entry can never read as a receipt.
          */}
          <ul className="flex min-w-0 flex-col gap-2">
            {buckets.map((figure) => {
              const isCurrent = figure.bucket === current;
              const isOutside = figure.bucket === OUTSIDE_PARTITION;
              return (
                <li
                  key={figure.bucket}
                  data-outcome={figure.bucket}
                  className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-3", isOutside && "bg-muted/40", isCurrent && "ring-1 ring-ring")}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusBadge {...statusBadgeProps(BUCKET_STATUS, figure.bucket)} srPrefix={LABELS.outcome} />
                    <CountFigure count={figure.count} valueState={figure.valueState} locale={locale} />
                    {isCurrent ? <span className="text-xs font-medium">{CURRENT_ROW_MARKER}</span> : null}
                  </div>
                  <p className="text-sm text-pretty text-muted-foreground">{BUCKET_MEANING[figure.bucket]}</p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
// Where the record came from and the snapshot it was read in
interface ProvenanceCardProps {
  readonly envelope: CommitmentsEnvelope;
  readonly row: CommitmentRowFigure;
  readonly locale: string;
}
function ProvenanceCard({ envelope, row, locale }: ProvenanceCardProps): ReactElement {
  return (
    <section aria-labelledby={PROVENANCE_HEADING_ID} className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={PROVENANCE_HEADING_ID}>{HEADINGS.provenance}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="flex min-w-0 flex-col gap-2 text-sm">
            <Fact term={LABELS.source}>
              <bdi className="mono-identifier break-all">{formatSourceReference(envelope.source)}</bdi>
            </Fact>
            <Fact term={LABELS.organization}>
              <Identifier value={envelope.scope.organizationId} />
            </Fact>
            <Fact term={LABELS.ministry}>
              <Identifier value={envelope.scope.ministryId} />
            </Fact>
            <Fact term={LABELS.supportSubject}>
              <Identifier value={envelope.scope.supportSubjectId} />
            </Fact>
            <Fact term={LABELS.principal}>
              <Identifier value={envelope.scope.principalId} />
            </Fact>
          </dl>
          <Separator />
          {/*
            One statement, from the component that owns the wording: the basis this application measures,
            this record's own currencies, the coverage behind it and the instant the read was evaluated. A
            commitment has no period, so the period is stated as not stated rather than invented.
          */}
          <SnapshotStatement basis={SUPPORT_BASES[0]} currencies={currenciesOf(row)} period={null} coverage={envelope.coverage} asOf={envelope.asOf} isCurrentPeriod={false} locale={locale} />
        </CardContent>
      </Card>
    </section>
  );
}

// The body once the read has answered
interface EnvelopeBodyProps {
  readonly envelope: CommitmentsEnvelope;
  readonly commitmentId: string;
  readonly locale: string;
  readonly returnHref: string;
}
function EnvelopeBody({ envelope, commitmentId, locale, returnHref }: EnvelopeBodyProps): ReactElement {
  const { commitments, buckets, total } = envelope.data;
  const row = commitments.find((candidate) => candidate.commitmentRowId === commitmentId);
  // A context in which the source reports no commitment at all is the family's own empty surface.
  if (total === 0) {
    return <StateNotice kind="empty" headingLevel={2} title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />;
  }
  // An identifier this page's read did not return is stated as that, and no record is invented for it.
  if (row === undefined) {
    return <StateNotice kind="empty" headingLevel={2} title={NOT_IN_PAGE_TITLE} description={NOT_IN_PAGE_DESCRIPTION} action={{ label: LIST_ACTION_LABEL, href: returnHref }} />;
  }
  return (
    <>
      <OverviewCard row={row} locale={locale} />
      {row.fixedTotal === null ? null : <FixedTotalCard commitmentId={row.commitmentRowId} fixedTotal={row.fixedTotal} valueStates={envelope.valueStates} locale={locale} />}
      <OutcomeHistoryCard buckets={buckets} total={total} current={row.bucket} locale={locale} />
      <ProvenanceCard envelope={envelope} row={row} locale={locale} />
    </>
  );
}
// The detail, once the list state is known
interface CommitmentDetailBodyProps extends CommitmentDetailProps {
  readonly listQuery: CommitmentsQuery;
}
function CommitmentDetailBody({ scope, commitmentId, locale, dir, listQuery, className }: CommitmentDetailBodyProps): ReactElement {
  // The narrowed read the closed inventory already offers: the commitments read, asked for this
  // commitment's row. No second read exists for one commitment, so none is invented here.
  const readQuery = useMemo<CommitmentsQuery>(() => ({ showAdditionalTypes: listQuery.showAdditionalTypes, page: listQuery.page, commitmentId }), [listQuery, commitmentId]);
  const returnHref = useMemo(() => returnPathOf(listQuery), [listQuery]);
  const { data: answer, isError, isPending, refetch } = useCommitments({ scope, query: readQuery });
  let content: ReactElement;
  if (isPending) {
    content = <CommitmentDetailSkeleton />;
  } else if (isError || answer === undefined) {
    // The read answers its own refusals as results, so a rejected request is a transport fault: it is
    // reported as unavailable work with the operation to re-request, never as an empty commitment.
    content = (
      <StateNotice
        kind="unavailable"
        headingLevel={2}
        title={NO_ANSWER_TITLE}
        description={NO_ANSWER_DESCRIPTION}
        retry={{
          label: UNAVAILABLE_RETRY_LABEL,
          onClick: () => {
            void refetch();
          },
        }}
      />
    );
  } else if (answer.kind === "denied") {
    // No identifier, count, title or size reaches this notice: the answer is the same whether or not a
    // commitment carries the identifier the address named.
    content = (
      <StateNotice kind="denied" headingLevel={2} title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} action={{ label: LIST_ACTION_LABEL, href: returnHref }} />
    );
  } else if (answer.kind === "unavailable") {
    content = (
      <StateNotice
        kind="unavailable"
        headingLevel={2}
        title={UNAVAILABLE_TITLE}
        description={answer.unavailable.guidance}
        source={answer.unavailable.source}
        action={{ label: LIST_ACTION_LABEL, href: returnHref }}
        retry={{
          label: UNAVAILABLE_RETRY_LABEL,
          onClick: () => {
            void refetch();
          },
        }}
      />
    );
  } else {
    content = <EnvelopeBody envelope={answer.envelope} commitmentId={commitmentId} locale={locale} returnHref={returnHref} />;
  }
  return (
    <div dir={dir} className={cn("flex min-w-0 flex-col gap-4", className)}>
      {/* The way back is stated before anything else and stays in every arm, so no state strands the worker here. */}
      <ReturnPath href={returnHref} />
      {content}
    </div>
  );
}
/**
 * The detail for a route that hands over no parsed list state: the return path is read back out of the
 * address, so the list reopens with the same page and the same facet answer it was left in.
 */
function UrlDerivedDetail(props: CommitmentDetailProps): ReactElement {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const listQuery = useMemo(() => parseCommitmentsQuery(new URLSearchParams(search)), [search]);
  return <CommitmentDetailBody {...props} listQuery={listQuery} />;
}
/**
 * One commitment, read-only: its kind, cadence, per-occurrence amount, the outcome it sits in and what
 * that outcome means, the dates the source states, a fixed total's four figures, the outcome partition
 * this read states, its provenance and the snapshot it was read in. It cannot post, retry, pause,
 * resume or correct a payment.
 */
export function CommitmentDetail(props: CommitmentDetailProps): ReactElement {
  const { listQuery } = props;
  if (listQuery !== undefined) {
    return <CommitmentDetailBody {...props} listQuery={listQuery} />;
  }
  // The search-params arm sits behind its own boundary: the address is read inside it, and the detail
  // renders before it arrives, so a route that hands over nothing still states the record.
  return (
    <Suspense fallback={<CommitmentDetailSkeleton dir={props.dir} className={props.className} />}>
      <UrlDerivedDetail {...props} />
    </Suspense>
  );
}
export default CommitmentDetail;
