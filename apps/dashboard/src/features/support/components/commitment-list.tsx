"use client";
/** `/support/commitments` — the recurring outcomes and commitments the source reports, read-only. **What a row states.** One commitment per row, in the source's own terms: which of the three kinds it … */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { refusalSummary } from "@/components/form-field";
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
type CommitmentView = CommitmentsEnvelope["data"]["commitments"][number];
type BucketFigure = CommitmentsEnvelope["data"]["buckets"][number];
type KindFigure = CommitmentsEnvelope["data"]["commitmentKinds"][number];
type MonthlyEquivalentView = NonNullable<CommitmentView["monthlyEquivalent"]>;
type FixedTotalView = NonNullable<CommitmentView["fixedTotal"]>;
type PauseState = CommitmentView["pause"]["state"];
type ColumnVisibility = RecordListQueryState["columnVisibility"];
// Props
/** Props of {@link CommitmentList}. */
/** The one optional display choice this list offers, as the read names it. */
const SHOW_ADDITIONAL_TYPES_ACTION = "showAdditionalTypes";

export type CommitmentListProps = { readonly scope: Scope; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly initialEnvelope?: ReadEnvelope<unknown>; readonly className?: string };
// Fixed values
const SURFACE_LABEL = "Commitments";
const ITEM_NOUN = "commitments";
const DETAILS_PATH = "/support/commitments";
/** The word the outcome badge carries before the bucket's own label, so a badge is never just a colour. */
const OUTCOME_SR_PREFIX = "Recurring outcome";
const SHOW_ADDITIONAL_TYPES_LABEL = "Show additional source-supplied commitment types";
/** What the choice does, in the one thing this surface can honestly promise about it. */
const SHOW_ADDITIONAL_TYPES_NOTE = "The choice is carried with the request to the source, so the list below states exactly the commitments the read answers with.";
/** The statement that this surface changes nothing, and why that is a fact rather than a warning. */
const READ_ONLY_TITLE = "Commitments are read-only";
const READ_ONLY_BODY = [
  "Commitments come from the source that owns them. This screen reads them and cannot post, retry, pause, resume, cancel or correct a payment, and no control here creates a gift, a message or a task.",
  "A commitment is not received cash. A settled occurrence is stated as the source's own outcome, a collection in flight is not counted as received, and nothing on this surface is added to a received-support figure.",
] as const;
const SNAPSHOT_TITLE = "The family basis, the coverage and the read instant";
/** The framing sentence that keeps the received-support basis and these commitment rows apart. */
const SNAPSHOT_FRAMING =
  "A commitment is not received cash: these rows state the source's own cadence, currency and occurrence state, and none is counted in a received-support figure. The statement below names the one received-support basis and grain this application reports on — the measure these rows are deliberately kept outside of — with the coverage of the records behind this read and the instant it was evaluated at.";
const PARTITION_INTRO = "Every commitment the source reports sits in exactly one of five recurring outcomes, or outside all five when the evidence behind it is unknown or stale. These figures cover the whole list rather than the page shown.";
const PARTITION_GROUP_LABELS = { outcomes: "Recurring outcomes", kinds: "Commitment kinds" } as const;
const READ_FAILED_DESCRIPTION = "The read answered in a form this surface cannot state as a result, so no commitment, count or empty list stands in its place.";
const RETRY_LABEL = "Try again";
/** The word a kind the three do not cover is stated as, instead of a blank cell. */
const UNRECOGNISED_KIND = "Unrecognised commitment type";
/** Pause is two states, and neither is left to colour: each carries its own word. */
const PAUSE_STATUS: Readonly<Record<PauseState, { readonly label: string; readonly tone: StatusTone }>> = { active: { label: "Active", tone: "positive" }, paused: { label: "Paused", tone: "neutral" } };
const NO_DATE_STATED = "No date stated";
/** The text a fixed total's absence is rendered as, for the reader who cannot see the dash. */
const NO_FIXED_TOTAL = "No fixed total on this commitment";
const NO_MONTHLY_EQUIVALENT = "Not stated by the source";
const RESUME_LABEL = "Resumes";
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
const IDENTIFIER_LINK_CLASS = "inline-flex min-h-6 max-w-full items-center break-words underline underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** A bucket badge inside the count panel, allowed to wrap. */
const PARTITION_BADGE_CLASS = "h-auto min-h-5 max-w-full py-0.5 text-start whitespace-normal";
/** The monthly equivalent's column heading, named from the one measure vocabulary rather than written again. */
const MONTHLY_EQUIVALENT_HEADER = MEASURE_LABELS["monthly-equivalent-support"];
// Reading the envelope's own statements
function recordedState(valueStates: Readonly<Record<string, ValueState>>, commitmentRowId: string, field: string): ValueState | undefined {
  return valueStates[`commitments.${commitmentRowId}.${field}`];
}
/** Reads an amount back as the exact minor units the amount component renders; the value state decides what is shown, so an unstated count never reaches the screen as an amount. */
function moneyOf(amount: MonthlyEquivalentView): Money {
  const { minorUnits } = amount;
  return { currency: amount.currency, minorUnits: minorUnits !== null && Number.isSafeInteger(minorUnits) ? minorUnitsOf(minorUnits) : minorUnitsOf(0) };
}
function detailHref(commitmentRowId: string, query: CommitmentsQuery): string {
  const search = toCommitmentsParams(query).toString();
  const path = `${DETAILS_PATH}/${encodeURIComponent(commitmentRowId)}`;
  return search.length === 0 ? path : `${path}?${search}`;
}
/** A row's identity is the commitment's own source-qualified id, never its position on the page. */
function rowIdOf(row: CommitmentView): string {
  return row.commitmentRowId;
}
/** Admits a server render's envelope as a seed only when it carries the members this surface reads. */
function seedOf(candidate: ReadEnvelope<unknown> | undefined): CommitmentsEnvelope | undefined {
  if (candidate === undefined) return undefined;
  const { data } = candidate;
  if (typeof data !== "object" || data === null) return undefined;
  if (!("commitments" in data) || !("total" in data) || !("page" in data) || !("buckets" in data) || !("commitmentKinds" in data)) return undefined;
  if (!Array.isArray(data.commitments) || typeof data.total !== "number" || !Array.isArray(data.buckets) || !Array.isArray(data.commitmentKinds)) return undefined;
  if (typeof data.page !== "object" || data.page === null) return undefined;
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
function PauseFigure({ pause }: { readonly pause: CommitmentView["pause"] }): ReactElement {
  const status = PAUSE_STATUS[pause.state];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <StatusBadge label={status.label} tone={status.tone} />
      {pause.state === "paused" ? (
        <span className="text-xs text-muted-foreground">
          {pause.resumeOn === null ? (
            "No resume date stated"
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
function FixedTotalFigures({ commitmentRowId, fixedTotal, valueStates, locale }: { readonly commitmentRowId: string; readonly fixedTotal: FixedTotalView; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement {
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
/** The recurring outcomes and commitments the source reports, read-only, with every figure rendered from its own value state and every bucket stated in words rather than by colour. */
export function CommitmentList({ scope, locale, dir, initialEnvelope, className }: CommitmentListProps): ReactElement {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const revealFieldId = useId();
  const revealReasonId = useId();
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
      { id: "kind", header: "Kind", enableSorting: false, cell: ({ row }) => <>{COMMITMENT_KIND_LABELS[row.original.kind] ?? UNRECOGNISED_KIND}</> },
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
      { id: "perOccurrence", header: "Per occurrence", enableSorting: false, cell: ({ row }) => <AmountValue money={row.original.perOccurrence} valueState={recordedState(valueStates, row.original.commitmentRowId, "perOccurrence") ?? UNSTATED_VALUE_STATE} locale={locale} /> },
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
      { id: "lastSuccessful", header: "Last successful", enableSorting: false, cell: ({ row }) => <StatedDate value={row.original.lastSuccessfulOn} /> },
      { id: "nextEligible", header: "Next eligible", enableSorting: false, cell: ({ row }) => <StatedDate value={row.original.nextEligibleOn} /> },
      { id: "pause", header: "Pause state", enableSorting: false, cell: ({ row }) => <PauseFigure pause={row.original.pause} /> },
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
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: NO_SORT, page: query.page.index + 1, pageSize: query.page.size, columnVisibility }), [query.page.index, query.page.size, columnVisibility]);
  /** Replaces the list state in the URL, so the browser back button does not step through every page. */
  function commitQuery(next: CommitmentsQuery): void {
    const search = toCommitmentsParams(next).toString();
    router.replace(search.length === 0 ? pathname : `${pathname}?${search}`, { scroll: false });
  }
  function handleQueryStateChange(next: RecordListQueryState): void {
    if (next.columnVisibility !== columnVisibility) setColumnVisibility(next.columnVisibility);
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
    return surface(<StateNotice kind="unavailable" headingLevel={2} title={`${SURFACE_LABEL} could not be read`} description={READ_FAILED_DESCRIPTION} retry={{ label: RETRY_LABEL, onClick: retry }} />);
  }
  if (result === undefined) {
    // The preset's own loading state: a skeleton table under the same statement, never an empty list.
    return surface(
      <>
        <ReadOnlyStatement />
        <RecordList label={SURFACE_LABEL} columns={columns} rows={NO_ROWS} rowCount={0} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={rowIdOf} isLoading itemNoun={ITEM_NOUN} />
      </>,
    );
  }
  if (result.kind === "denied") {
    // No count, no title and no empty list: the answer is the same whether or not a commitment exists.
    return surface(<StateNotice kind="denied" headingLevel={2} title={SURFACE_LABEL} reasonCode={result.denied.reasonCode} />);
  }
  if (result.kind === "unavailable") {
    return surface(<StateNotice kind="unavailable" headingLevel={2} title={`${SURFACE_LABEL} could not be read`} description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: RETRY_LABEL, onClick: retry }} />);
  }
  if (result.kind === "refused") {
    // The filters this list sent are ones the read does not admit: the field-keyed refusal is the answer,
    // and no source behind the commitments failed.
    return surface(<StateNotice kind="refused" headingLevel={2} title="This list's request was refused" description={refusalSummary(result.refused)} />);
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
  const additionalTypesAction = actions.find((action) => action.name === SHOW_ADDITIONAL_TYPES_ACTION);
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
          {additionalTypesAction === undefined ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={revealFieldId} className={cn("items-start leading-snug font-normal", additionalTypesAction.available && "cursor-pointer")}>
                <Checkbox
                  id={revealFieldId}
                  className="mt-0.5"
                  checked={query.showAdditionalTypes}
                  disabled={!additionalTypesAction.available}
                  aria-describedby={additionalTypesAction.reason === undefined ? undefined : revealReasonId}
                  onCheckedChange={(checked: boolean) => {
                    // A changed facet starts the list at its first page rather than stranding the
                    // reader on a page the narrower result may not have.
                    commitQuery({ ...query, showAdditionalTypes: checked, page: { index: 0, size: query.page.size } });
                  }}
                />
                <span className="min-w-0 break-words">{SHOW_ADDITIONAL_TYPES_LABEL}</span>
              </Label>
              <p className="text-xs text-muted-foreground">{SHOW_ADDITIONAL_TYPES_NOTE}</p>
              {additionalTypesAction.reason === undefined ? null : (
                <p id={revealReasonId} className="text-xs text-muted-foreground">
                  {additionalTypesAction.reason}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{PARTITION_INTRO}</p>
        <PartitionFigures buckets={data.buckets} kinds={data.commitmentKinds} outsideMeaning={BUCKET_MEANING["outside-partition"]} />
      </div>
      <RecordList label={SURFACE_LABEL} columns={columns} rows={data.commitments} rowCount={data.total} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={rowIdOf} itemNoun={ITEM_NOUN} />
    </>,
  );
}
export default CommitmentList;
