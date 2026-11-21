"use client";
/**
 * `/support/commitments` — the recurring outcomes and commitments the source reports, read-only.
 *
 * **What a row states.** One commitment per row, in the source's own terms: which of the three kinds
 * it is, its cadence, the amount it collects per occurrence, the recurring outcome the source places
 * the occurrence in, the day it last collected, the day it is next eligible and whether it is paused.
 * A fixed total states its four amounts — promised, fulfilled, released and remaining — each from its
 * own minor units and its own value state, and the four are never added together or turned into a
 * percentage here.
 *
 * **The partition this surface must not blur.** An occurrence sits in exactly one of the five
 * recurring outcomes — Received, Processing, Upcoming, Recovery needs attention and Not received — or
 * outside all five when the evidence behind it is unknown or stale. The sixth badge is not a sixth
 * outcome: its own words say it sits outside the five, and the sentence beside it says it is counted
 * in none of them. The figures above the list are the read's whole-result partition rather than a
 * count of the page, so no badge can be read as a share of the rows on screen.
 *
 * **Why no control here changes anything.** Commitments belong to the finance owner behind the seam,
 * so nothing on this surface posts, retries, pauses, resumes, cancels or corrects a payment, and no
 * action here creates a gift, a message or a task. The list says so in words rather than leaving the
 * reader to infer it from the absence of buttons.
 *
 * **What it never computes.** Every amount arrives as exact minor units with a currency exponent and
 * is rendered by the one amount component from its own value state, so a zero, an unknown, a withheld
 * value, an unavailable source and an incomplete subtotal stay five different renderings here as they
 * do everywhere else. A commitment is not received cash: the family's received-support basis and
 * grain are stated once, framed as the measure these rows are deliberately kept outside of, so the
 * two are never read as one figure.
 *
 * **Where its state lives.** The one optional choice — whether the source's additional
 * source-supplied commitment types are asked for — is carried in the URL, so a commitment-detail
 * visit returns to the same list state, and it is answered by `useCommitments`, which wraps the same
 * service read the server render uses.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { BUCKET_STATUS, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import type { ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { SUPPORT_BASIS } from "@/modules/support/basis";
import { BUCKET_MEANING, COMMITMENT_KIND_LABELS, EMPTY_STATES, FIXED_TOTAL_FIELDS, MEASURE_LABELS } from "../copy";
import { parseCommitmentsQuery, toCommitmentsParams, useCommitments, type CommitmentsEnvelope, type CommitmentsQuery } from "../hooks/use-commitments";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
// The envelope's own shapes, taken from the read rather than restated
/** One commitment exactly as the read states it. */
type CommitmentView = CommitmentsEnvelope["data"]["commitments"][number];
/** One recurring-outcome figure of the whole-result partition. */
type BucketFigure = CommitmentsEnvelope["data"]["buckets"][number];
/** One commitment-kind figure of the whole-result partition. */
type KindFigure = CommitmentsEnvelope["data"]["commitmentKinds"][number];
/** One commitment's source-stated monthly equivalent. */
type MonthlyEquivalentView = NonNullable<CommitmentView["monthlyEquivalent"]>;
/** The four amounts a fixed total states. */
type FixedTotalView = NonNullable<CommitmentView["fixedTotal"]>;
/** Whether a commitment is running or paused. */
type PauseState = CommitmentView["pause"]["state"];
/** The column-visibility slice the list preset controls, named from its own query state. */
type ColumnVisibility = RecordListQueryState["columnVisibility"];
// Props
/** Props of {@link CommitmentList}. */
export type CommitmentListProps = {
  readonly scope: Scope;
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  readonly initialEnvelope?: ReadEnvelope<unknown>;
  readonly className?: string;
};
// Fixed values
/** The list's own name: the table caption, the scroll region's label and the heading of every state. */
const SURFACE_LABEL = "Commitments";
/** What one row is called, in the count line and in the empty state. */
const ITEM_NOUN = "commitments";
/** Where a commitment's own detail route lives, so the list state travels with the visit. */
const DETAILS_PATH = "/support/commitments";
/** The word the outcome badge carries before the bucket's own label, so a badge is never just a colour. */
const OUTCOME_SR_PREFIX = "Recurring outcome";
/**
 * The capability the envelope must state as available before this surface offers the one optional
 * choice. No read states it today, so no control renders and nothing explains a capability the
 * envelope does not claim — a control that cannot change what the source returns would be a promise
 * this surface cannot keep.
 */
const SHOW_ADDITIONAL_TYPES_ACTION = "showAdditionalTypes";
/** The label of that one choice, stated in the source's own terms. */
const SHOW_ADDITIONAL_TYPES_LABEL = "Show additional source-supplied commitment types";
/** What the choice does, in the one thing this surface can honestly promise about it. */
const SHOW_ADDITIONAL_TYPES_NOTE = "The choice is carried with the request to the source, so the list below states exactly the commitments the read answers with.";
/** The statement that this surface changes nothing, and why that is a fact rather than a warning. */
const READ_ONLY_TITLE = "Commitments are read-only";
const READ_ONLY_BODY = [
  "Commitments come from the source that owns them. This screen reads them and cannot post, retry, pause, resume, cancel or correct a payment, and no control here creates a gift, a message or a task.",
  "A commitment is not received cash. A settled occurrence is stated as the source's own outcome, a collection in flight is not counted as received, and nothing on this surface is added to a received-support figure.",
] as const;
/** The heading of the panel that states the shared basis, coverage and read instant. */
const SNAPSHOT_TITLE = "The family basis, the coverage and the read instant";
/** The framing sentence that keeps the received-support basis and these commitment rows apart. */
const SNAPSHOT_FRAMING =
  "A commitment is not received cash: these rows state the source's own cadence, currency and occurrence state, and none is counted in a received-support figure. The statement below names the one received-support basis and grain this application reports on — the measure these rows are deliberately kept outside of — with the coverage of the records behind this read and the instant it was evaluated at.";
/** The sentence that introduces the whole-result partition. */
const PARTITION_INTRO =
  "Every commitment the source reports sits in exactly one of five recurring outcomes, or outside all five when the evidence behind it is unknown or stale. These figures cover the whole list rather than the page shown.";
/** The two group labels of the partition panel. */
const PARTITION_GROUP_LABELS = { outcomes: "Recurring outcomes", kinds: "Commitment kinds" } as const;
/** What this surface says about a source it could not read at all. */
const READ_FAILED_DESCRIPTION = "The read answered in a form this surface cannot state as a result, so no commitment, count or empty list stands in its place.";
const RETRY_LABEL = "Try again";
/** The word a kind the three do not cover is stated as, instead of a blank cell. */
const UNRECOGNISED_KIND = "Unrecognised commitment type";
/** Pause is two states, and neither is left to colour: each carries its own word. */
const PAUSE_STATUS: Readonly<Record<PauseState, { readonly label: string; readonly tone: StatusTone }>> = {
  active: { label: "Active", tone: "positive" },
  paused: { label: "Paused", tone: "neutral" },
};
/** The text a date the source did not state is rendered as. */
const NO_DATE_STATED = "No date stated";
/** The text a fixed total's absence is rendered as, for the reader who cannot see the dash. */
const NO_FIXED_TOTAL = "No fixed total on this commitment";
/** The text a monthly equivalent the source does not state is rendered as. */
const NO_MONTHLY_EQUIVALENT = "Not stated by the source";
/** The resume line, stated whether or not the source named a day to resume on. */
const RESUME_LABEL = "Resumes";
const NO_RESUME_DATE = "No resume date stated";
/** The state a value the read states nothing about is rendered as: never a plain number. */
const UNSTATED_VALUE_STATE: ValueState = "unknown";
/** The list never sorts in the browser, because the service states the order of every commitment. */
const NO_SORT: RecordListQueryState["sort"] = [];
/** Nothing is hidden before the reader hides it. */
const NOTHING_HIDDEN: ColumnVisibility = {};
/** No row and no value state is stated yet: the first read has not answered, so nothing stands in for it. */
const NO_ROWS: readonly CommitmentView[] = [];
const NO_VALUE_STATES: Readonly<Record<string, ValueState>> = {};
/** The read states each commitment's own currency and no list-wide currency, so the snapshot states none rather than deriving one from the loaded page. */
const NO_CURRENCIES: readonly string[] = [];
/** The identity column's link, sized so the target is at least 24 CSS px tall (WCAG 2.5.8). */
const IDENTIFIER_LINK_CLASS =
  "inline-flex min-h-6 max-w-full items-center break-words underline underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/**
 * A bucket badge inside the count panel, allowed to wrap. The badge's own shape holds one line and
 * clips what does not fit, and the longest outcome name ("Unknown or stale — outside the five
 * outcomes") is wider than a 320 CSS px column, so at phone width the label wraps inside the badge
 * rather than poking out of the panel that states it.
 */
const PARTITION_BADGE_CLASS = "h-auto min-h-5 max-w-full py-0.5 text-start whitespace-normal";
/** The monthly equivalent's column heading, named from the one measure vocabulary rather than written again. */
const MONTHLY_EQUIVALENT_HEADER = MEASURE_LABELS["monthly-equivalent-support"];
// Reading the envelope's own statements
/** The value state the read records for one field of one commitment, or `undefined` when it states none. */
function recordedState(valueStates: Readonly<Record<string, ValueState>>, commitmentRowId: string, field: string): ValueState | undefined {
  return valueStates[`commitments.${commitmentRowId}.${field}`];
}
/** Reads an amount back as the exact minor units the amount component renders; the value state decides what is shown, so an unstated count never reaches the screen as an amount. */
function moneyOf(amount: MonthlyEquivalentView): Money {
  const { minorUnits } = amount;
  return { currency: amount.currency, minorUnits: minorUnits !== null && Number.isSafeInteger(minorUnits) ? minorUnitsOf(minorUnits) : minorUnitsOf(0) };
}
/** The one URL a row opens, carrying the list state so the detail can return to the same page and choice. */
function detailHref(commitmentRowId: string, query: CommitmentsQuery): string {
  const search = toCommitmentsParams(query).toString();
  const path = `${DETAILS_PATH}/${encodeURIComponent(commitmentRowId)}`;
  return search.length === 0 ? path : `${path}?${search}`;
}
/** A row's identity is the commitment's own source-qualified id, never its position on the page. */
function rowIdOf(row: CommitmentView): string {
  return row.commitmentRowId;
}
/**
 * Admits a server render's envelope as a seed only when it carries the members this surface reads.
 * The prop is deliberately untyped — a route may pass anything it has — so the guard is the contract,
 * and an envelope that is not this read's seeds nothing rather than poisoning the cache with it.
 */
function seedOf(candidate: ReadEnvelope<unknown> | undefined): CommitmentsEnvelope | undefined {
  if (candidate === undefined) {
    return undefined;
  }
  const { data } = candidate;
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  if (!("commitments" in data) || !("total" in data) || !("page" in data) || !("buckets" in data) || !("commitmentKinds" in data)) {
    return undefined;
  }
  if (!Array.isArray(data.commitments) || typeof data.total !== "number" || !Array.isArray(data.buckets) || !Array.isArray(data.commitmentKinds)) {
    return undefined;
  }
  if (typeof data.page !== "object" || data.page === null) {
    return undefined;
  }
  return candidate as CommitmentsEnvelope;
}
// The small figures a cell is made of
/** One civil date exactly as the source stated it: never rebased into another zone, and never presented as an instant. */
function StatedDate({ value }: { readonly value: string | null }): ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground">{NO_DATE_STATED}</span>;
  }
  return (
    <time dateTime={value} className="tabular-figures">
      <bdi>{value}</bdi>
    </time>
  );
}
/** Whether a commitment is running or paused, with the day the source says it resumes when it says one. */
function PauseFigure({ pause }: { readonly pause: CommitmentView["pause"] }): ReactElement {
  const status = PAUSE_STATUS[pause.state];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <StatusBadge label={status.label} tone={status.tone} />
      {pause.state === "paused" ? (
        <span className="text-xs text-muted-foreground">
          {pause.resumeOn === null ? (
            NO_RESUME_DATE
          ) : (
            <>
              {RESUME_LABEL} <StatedDate value={pause.resumeOn} />
            </>
          )}
        </span>
      ) : null}
    </div>
  );
}
/** A fixed total's four amounts, each from its own minor units and its own value state, and the four never combined. */
function FixedTotalFigures({
  commitmentRowId,
  fixedTotal,
  valueStates,
  locale,
}: {
  readonly commitmentRowId: string;
  readonly fixedTotal: FixedTotalView;
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly locale: string;
}): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-1">
      {FIXED_TOTAL_FIELDS.map(({ field, label }) => (
        <div key={field} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="min-w-0">
            <AmountValue money={fixedTotal[field]} valueState={recordedState(valueStates, commitmentRowId, `fixedTotal.${field}`) ?? UNSTATED_VALUE_STATE} locale={locale} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
/** One whole-result count, rendered as a plain number only when the read states it as a recorded value. */
function CountValue({ count, valueState }: { readonly count: number; readonly valueState: ValueState }): ReactElement {
  if (valueState === "value") {
    return <span className="tabular-figures text-sm">{String(count)}</span>;
  }
  // Every other state carries its own word beside the count, so a recorded zero and an incomplete
  // subtotal are never read as ordinary numbers.
  return <StatusBadge label={String(count)} valueState={valueState} />;
}
/** The whole-result partition: the five outcomes plus `outside-partition`, and the three kinds. */
function PartitionFigures({ buckets, kinds, outsideMeaning }: { readonly buckets: readonly BucketFigure[]; readonly kinds: readonly KindFigure[]; readonly outsideMeaning: string }): ReactElement {
  const labelBase = useId();
  const outcomesLabelId = `${labelBase}-outcomes`;
  const kindsLabelId = `${labelBase}-kinds`;
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <section aria-labelledby={outcomesLabelId} className="flex min-w-0 flex-col gap-2 border border-border p-3">
        <p id={outcomesLabelId} className="text-sm font-medium">
          {PARTITION_GROUP_LABELS.outcomes}
        </p>
        <dl className="flex min-w-0 flex-col gap-2">
          {buckets.map((figure) => (
            <div key={figure.bucket} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <dt className="min-w-0">
                <StatusBadge {...BUCKET_STATUS[figure.bucket]} srPrefix={OUTCOME_SR_PREFIX} className={PARTITION_BADGE_CLASS} />
              </dt>
              <dd className="min-w-0 tabular-figures">
                <CountValue count={figure.count} valueState={figure.valueState} />
              </dd>
            </div>
          ))}
        </dl>
        {/* The sixth value's own meaning, so no reader can take it for a sixth outcome. */}
        <p className="text-xs text-muted-foreground">{outsideMeaning}</p>
      </section>
      <section aria-labelledby={kindsLabelId} className="flex min-w-0 flex-col gap-2 border border-border p-3">
        <p id={kindsLabelId} className="text-sm font-medium">
          {PARTITION_GROUP_LABELS.kinds}
        </p>
        <dl className="flex min-w-0 flex-col gap-2">
          {kinds.map((figure) => (
            <div key={figure.kind} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <dt className="min-w-0 break-words">{COMMITMENT_KIND_LABELS[figure.kind] ?? UNRECOGNISED_KIND}</dt>
              <dd className="min-w-0">
                <CountValue count={figure.count} valueState={figure.valueState} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
/** The statement that this surface changes nothing about a commitment, and why that is a fact rather than a warning. */
function ReadOnlyStatement(): ReactElement {
  return (
    // A note rather than an alert: the statement is true for the whole surface, so it is read in
    // order instead of being announced over whatever the reader is doing.
    <Alert role="note">
      <AlertTitle>{READ_ONLY_TITLE}</AlertTitle>
      <AlertDescription>
        {READ_ONLY_BODY.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

// The surface
/**
 * The recurring outcomes and commitments the source reports, read-only, with every figure rendered
 * from its own value state and every bucket stated in words rather than by colour.
 */
export function CommitmentList({ scope, locale, dir, initialEnvelope, className }: CommitmentListProps): ReactElement {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const revealFieldId = useId();
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(NOTHING_HIDDEN);
  // The URL is the list's state, so a detail visit, a refresh and a shared link all return to the same
  // page and the same answer to the one optional choice.
  const query = useMemo(() => parseCommitmentsQuery(searchParams.toString()), [searchParams]);
  // A server render may hand its own envelope down; an envelope that is not this read's seeds nothing.
  const seeded = useMemo(() => seedOf(initialEnvelope), [initialEnvelope]);
  const read = useCommitments({ scope, query, ...(seeded === undefined ? {} : { initialEnvelope: seeded }) });
  const result = read.data;
  const rows = result !== undefined && result.kind === "envelope" ? result.envelope.data.commitments : NO_ROWS;
  const valueStates = result !== undefined && result.kind === "envelope" ? result.envelope.valueStates : NO_VALUE_STATES;
  // Built once per locale, list state and read, because the table preset rebuilds its column instances
  // whenever the column array's identity changes.
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<CommitmentView>>>(() => {
    const monthlyEquivalentStated = rows.some((row) => row.monthlyEquivalent !== null);
    const list: RecordListColumnDef<CommitmentView>[] = [
      {
        id: "commitment",
        header: "Commitment",
        // The source states the order of this list, so no column offers a sort the service would ignore.
        enableSorting: false,
        // The row's identity stays visible: hiding it would leave a row of figures naming nothing.
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={detailHref(row.original.commitmentRowId, query)} className={IDENTIFIER_LINK_CLASS}>
            <bdi className="mono-identifier">{row.original.commitmentRowId}</bdi>
          </Link>
        ),
      },
      {
        id: "kind",
        header: "Kind",
        enableSorting: false,
        cell: ({ row }) => <>{COMMITMENT_KIND_LABELS[row.original.kind] ?? UNRECOGNISED_KIND}</>,
      },
      {
        id: "cadence",
        header: "Cadence",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="break-words">
            <bdi>{row.original.cadence}</bdi>
          </span>
        ),
      },
      {
        id: "perOccurrence",
        header: "Per occurrence",
        enableSorting: false,
        cell: ({ row }) => (
          <AmountValue money={row.original.perOccurrence} valueState={recordedState(valueStates, row.original.commitmentRowId, "perOccurrence") ?? row.original.perOccurrenceState} locale={locale} />
        ),
      },
      {
        id: "outcome",
        header: OUTCOME_SR_PREFIX,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <StatusBadge {...BUCKET_STATUS[row.original.bucket]} srPrefix={OUTCOME_SR_PREFIX} />
            {/* The bucket's meaning travels with the row, so `outside-partition` is explained where it
                is read rather than left to a legend somewhere else on the page. */}
            <span className="sr-only">{BUCKET_MEANING[row.original.bucket]}</span>
          </div>
        ),
      },
      {
        id: "lastSuccessful",
        header: "Last successful",
        enableSorting: false,
        cell: ({ row }) => <StatedDate value={row.original.lastSuccessfulOn} />,
      },
      {
        id: "nextEligible",
        header: "Next eligible",
        enableSorting: false,
        cell: ({ row }) => <StatedDate value={row.original.nextEligibleOn} />,
      },
      {
        id: "pause",
        header: "Pause state",
        enableSorting: false,
        cell: ({ row }) => <PauseFigure pause={row.original.pause} />,
      },
      {
        id: "fixedTotal",
        header: "Fixed total",
        enableSorting: false,
        cell: ({ row }) => {
          const { fixedTotal } = row.original;
          if (fixedTotal === null) {
            return (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">{NO_FIXED_TOTAL}</span>
              </>
            );
          }
          return <FixedTotalFigures commitmentRowId={row.original.commitmentRowId} fixedTotal={fixedTotal} valueStates={valueStates} locale={locale} />;
        },
      },
    ];
    // The monthly equivalent is its own column only when the source states one for at least one row:
    // an always-present empty column would claim the source was asked and answered nothing.
    if (monthlyEquivalentStated) {
      list.push({
        id: "monthlyEquivalent",
        header: MONTHLY_EQUIVALENT_HEADER,
        enableSorting: false,
        cell: ({ row }) => {
          const monthly = row.original.monthlyEquivalent;
          if (monthly === null) {
            return <span className="text-muted-foreground">{NO_MONTHLY_EQUIVALENT}</span>;
          }
          return <AmountValue money={moneyOf(monthly)} valueState={recordedState(valueStates, row.original.commitmentRowId, "monthlyEquivalent") ?? monthly.valueState} locale={locale} />;
        },
      });
    }
    return list;
  }, [locale, query, rows, valueStates]);
  // The preset's page is one-based while the URL's index is zero-based, so the two are converted here
  // once rather than in the pager and in the read.
  const listQueryState = useMemo<RecordListQueryState>(
    () => ({ sort: NO_SORT, page: query.page.index + 1, pageSize: query.page.size, columnVisibility }),
    [query.page.index, query.page.size, columnVisibility],
  );
  /** Replaces the list state in the URL, so the browser back button does not step through every page. */
  function commitQuery(next: CommitmentsQuery): void {
    const search = toCommitmentsParams(next).toString();
    router.replace(search.length === 0 ? pathname : `${pathname}?${search}`, { scroll: false });
  }
  /**
   * Applies the two changes the preset can raise. Column visibility is presentation and stays in this
   * component; a page or page-size change belongs to the service, so it is committed to the URL. A
   * sort is never dispatched, because every column refuses one.
   */
  function handleQueryStateChange(next: RecordListQueryState): void {
    if (next.columnVisibility !== columnVisibility) {
      setColumnVisibility(next.columnVisibility);
    }
    const pageIndex = Math.max(0, next.page - 1);
    if (pageIndex !== query.page.index || next.pageSize !== query.page.size) {
      commitQuery({ ...query, page: { index: pageIndex, size: next.pageSize } });
    }
  }
  /** Re-requests this read. Nothing is retried on the source's behalf and no amount stands in for one that could not be read. */
  function retry(): void {
    void read.refetch();
  }
  function surface(children: ReactNode): ReactElement {
    return (
      <div data-surface="support-commitments" {...(dir === undefined ? {} : { dir })} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
        {children}
      </div>
    );
  }
  if (result === undefined && read.error !== null) {
    // A read that answered in a form this surface cannot state is reported as such: never as an
    // empty list, and never with a zero or a count standing in for what could not be read.
    return surface(
      <StateNotice kind="unavailable" headingLevel={2} title={`${SURFACE_LABEL} could not be read`} description={READ_FAILED_DESCRIPTION} retry={{ label: RETRY_LABEL, onClick: retry }} />,
    );
  }
  if (result === undefined) {
    // The preset's own loading state: a skeleton table under the same statement, never an empty list.
    return surface(
      <>
        <ReadOnlyStatement />
        <RecordList
          label={SURFACE_LABEL}
          columns={columns}
          rows={NO_ROWS}
          rowCount={0}
          queryState={listQueryState}
          onQueryStateChange={handleQueryStateChange}
          getRowId={rowIdOf}
          isLoading
          itemNoun={ITEM_NOUN}
        />
      </>,
    );
  }
  if (result.kind === "denied") {
    // No count, no title and no empty list: the answer is the same whether or not a commitment exists.
    return surface(<StateNotice kind="denied" headingLevel={2} title={SURFACE_LABEL} reasonCode={result.denied.reasonCode} />);
  }
  if (result.kind === "unavailable") {
    return surface(
      <StateNotice
        kind="unavailable"
        headingLevel={2}
        title={`${SURFACE_LABEL} could not be read`}
        description={result.unavailable.guidance}
        source={result.unavailable.source}
        retry={{ label: RETRY_LABEL, onClick: retry }}
      />,
    );
  }
  const { data, actions, asOf, coverage } = result.envelope;
  if (data.total === 0) {
    // An empty list is a real first action, not an illustration and not an apology.
    return surface(
      <>
        <ReadOnlyStatement />
        <StateNotice kind="empty" headingLevel={2} title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />
      </>,
    );
  }
  const admitsAdditionalTypes = actions.some((action) => action.name === SHOW_ADDITIONAL_TYPES_ACTION && action.available);
  return surface(
    <>
      <ReadOnlyStatement />
      <Card>
        <CardHeader>
          <CardTitle>{SNAPSHOT_TITLE}</CardTitle>
          <CardDescription>{SNAPSHOT_FRAMING}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SnapshotStatement basis={SUPPORT_BASIS} currencies={NO_CURRENCIES} period={null} coverage={coverage} asOf={asOf} isCurrentPeriod={false} locale={locale} />
          {admitsAdditionalTypes ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={revealFieldId} className="cursor-pointer items-start leading-snug font-normal">
                <Checkbox
                  id={revealFieldId}
                  className="mt-0.5"
                  checked={query.showAdditionalTypes}
                  onCheckedChange={(checked: boolean) => {
                    // A changed facet starts the list at its first page rather than stranding the
                    // reader on a page the narrower result may not have.
                    commitQuery({ ...query, showAdditionalTypes: checked, page: { index: 0, size: query.page.size } });
                  }}
                />
                <span className="min-w-0 break-words">{SHOW_ADDITIONAL_TYPES_LABEL}</span>
              </Label>
              <p className="text-xs text-muted-foreground">{SHOW_ADDITIONAL_TYPES_NOTE}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{PARTITION_INTRO}</p>
        <PartitionFigures buckets={data.buckets} kinds={data.commitmentKinds} outsideMeaning={BUCKET_MEANING["outside-partition"]} />
      </div>
      <RecordList
        label={SURFACE_LABEL}
        columns={columns}
        rows={data.commitments}
        rowCount={data.total}
        queryState={listQueryState}
        onQueryStateChange={handleQueryStateChange}
        getRowId={rowIdOf}
        itemNoun={ITEM_NOUN}
      />
    </>,
  );
}
export default CommitmentList;
