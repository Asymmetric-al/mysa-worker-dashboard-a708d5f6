"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { FactList, type FactSpec } from "@/components/fact-list";
import { refusalSummary } from "@/components/form-field";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { BUCKET_STATUS, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { SUPPORT_BASIS } from "@/modules/support/basis";
import { BUCKET_MEANING, COMMITMENT_KIND_LABELS, EMPTY_STATES, FIXED_TOTAL_FIELDS, MEASURE_LABELS } from "../copy";
import { parseCommitmentsQuery, toCommitmentsParams, useCommitments, type CommitmentsEnvelope, type CommitmentsQuery } from "../hooks/use-commitments";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
type CommitmentView = CommitmentsEnvelope["data"]["commitments"][number];
type ColumnVisibility = RecordListQueryState["columnVisibility"];
export type CommitmentListProps = { readonly scope: Scope; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly initialEnvelope?: ReadEnvelope<unknown>; readonly className?: string };
const SURFACE_LABEL = "Commitments";
const OUTCOME_SR_PREFIX = "Recurring status";
const READ_ONLY_BODY = [
  "Commitments are read-only and come directly from your giving source. Mysa can’t pause, edit, retry, or cancel payments.",
  "Commitments aren’t counted as received cash — in-flight collections stay separate until settled.",
] as const;
const SNAPSHOT_FRAMING =
  "Commitments stay separate from received cash. Below is the snapshot coverage and read time for this list.";
const UNRECOGNISED_KIND = "Other commitment type";
const PAUSE_STATUS: Readonly<Record<CommitmentView["pause"]["state"], { readonly label: string; readonly tone: StatusTone }>> = { active: { label: "Active", tone: "positive" }, paused: { label: "Paused", tone: "neutral" } };
const UNSTATED_VALUE_STATE: ValueState = "unknown";
const NOTHING_HIDDEN: ColumnVisibility = {};
const NO_ROWS: readonly CommitmentView[] = [];
const NO_VALUE_STATES: Readonly<Record<string, ValueState>> = {};
const NO_CURRENCIES: readonly string[] = [];
const recordedState = (valueStates: Readonly<Record<string, ValueState>>, commitmentRowId: string, field: string): ValueState | undefined => valueStates[`commitments.${commitmentRowId}.${field}`];
const moneyOf = (amount: NonNullable<CommitmentView["monthlyEquivalent"]>): Money => ({ currency: amount.currency, minorUnits: amount.minorUnits !== null && Number.isSafeInteger(amount.minorUnits) ? minorUnitsOf(amount.minorUnits) : minorUnitsOf(0) });
const detailHref = (commitmentRowId: string, query: CommitmentsQuery): string => {
  const search = toCommitmentsParams(query).toString();
  const path = `/support/commitments/${encodeURIComponent(commitmentRowId)}`;
  return search.length === 0 ? path : `${path}?${search}`;
};
const rowIdOf = (row: CommitmentView): string => row.commitmentRowId;
function seedOf(candidate: ReadEnvelope<unknown> | undefined): CommitmentsEnvelope | undefined {
  if (candidate === undefined) return undefined;
  const { data } = candidate;
  if (typeof data !== "object" || data === null) return undefined;
  if (!("commitments" in data) || !("total" in data) || !("page" in data) || !("buckets" in data) || !("commitmentKinds" in data)) return undefined;
  return !Array.isArray(data.commitments) || typeof data.total !== "number" || !Array.isArray(data.buckets) || !Array.isArray(data.commitmentKinds) ? undefined : typeof data.page !== "object" || data.page === null ? undefined : (candidate as CommitmentsEnvelope);
}
function StatedDate({ value }: { readonly value: string | null }): ReactElement {
  if (value === null) return <span className="text-muted-foreground">None</span>;
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
            "No resume date"
          ) : (
            <>
              Resumes <StatedDate value={pause.resumeOn} />
            </>
          )}
        </span>
      ) : null}
    </div>
  );
}
function FixedTotalFigures({ commitmentRowId, fixedTotal, valueStates, locale }: { readonly commitmentRowId: string; readonly fixedTotal: NonNullable<CommitmentView["fixedTotal"]>; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement {
  const facts: readonly FactSpec[] = FIXED_TOTAL_FIELDS.map(({ field, label }) => ({ term: label, value: <AmountValue money={fixedTotal[field]} valueState={recordedState(valueStates, commitmentRowId, `fixedTotal.${field}`) ?? UNSTATED_VALUE_STATE} locale={locale} /> }));
  return <FactList className="flex min-w-0 flex-col gap-1" facts={facts} rowClassName="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2" termClassName="text-xs text-muted-foreground" />;
}
const CountValue = ({ count, valueState }: { readonly count: number; readonly valueState: ValueState }): ReactElement => (valueState === "value" ? <span className="tabular-figures text-sm">{String(count)}</span> : <StatusBadge label={String(count)} valueState={valueState} />);
type BucketFigure = CommitmentsEnvelope["data"]["buckets"][number];
type KindFigure = CommitmentsEnvelope["data"]["commitmentKinds"][number];
type PartitionGroup = { readonly key: string; readonly heading: string; readonly note?: string; readonly termClassName: string; readonly valueClassName: string; readonly rows: readonly { readonly key: string; readonly term: ReactNode; readonly count: number; readonly valueState: ValueState }[] };
function PartitionFigures({ buckets, kinds, outsideMeaning }: { readonly buckets: readonly BucketFigure[]; readonly kinds: readonly KindFigure[]; readonly outsideMeaning: string }): ReactElement {
  const labelBase = useId();
  const groups: readonly PartitionGroup[] = [
    {
      key: "outcomes",
      heading: "Recurring status",
      note: outsideMeaning,
      termClassName: "min-w-0",
      valueClassName: "min-w-0 tabular-figures",
      rows: buckets.map((figure) => ({ key: figure.bucket, term: <StatusBadge {...BUCKET_STATUS[figure.bucket]} srPrefix={OUTCOME_SR_PREFIX} className="h-auto min-h-5 max-w-full py-0.5 text-start whitespace-normal" />, count: figure.count, valueState: figure.valueState })),
    },
    { key: "kinds", heading: "Commitment types", termClassName: "min-w-0 break-words", valueClassName: "min-w-0", rows: kinds.map((figure) => ({ key: figure.kind, term: COMMITMENT_KIND_LABELS[figure.kind] ?? UNRECOGNISED_KIND, count: figure.count, valueState: figure.valueState })) },
  ];
  return (
    <div className="grid min-w-0 gap-4 @2xl/main:grid-cols-2">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`${labelBase}-${group.key}`} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <p {...{ id: `${labelBase}-${group.key}`, className: "type-group-title border-b border-border/70 pb-2" }}>{group.heading}</p>
          <dl className="flex min-w-0 flex-col gap-2">
            {group.rows.map((row) => (
              <div key={row.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2">
                <dt className={group.termClassName}>{row.term}</dt>
                <dd className={cn(group.valueClassName, "font-semibold")}>
                  <CountValue count={row.count} valueState={row.valueState} />
                </dd>
              </div>
            ))}
          </dl>
          {group.note === undefined ? null : <p className="text-xs text-muted-foreground">{group.note}</p>}
        </section>
      ))}
    </div>
  );
}
const ReadOnlyStatement = (): ReactElement => (
  <Alert variant="info" role="note">
    <AlertTitle>Commitments are read-only</AlertTitle>
    <AlertDescription>
      {READ_ONLY_BODY.map((sentence) => (
        <p key={sentence} className="type-supporting text-foreground/85">
          {sentence}
        </p>
      ))}
    </AlertDescription>
  </Alert>
);
/** The recurring outcomes and commitments the source reports, read-only, with every figure rendered from its own value state and every bucket stated in words rather than by colour. */ export function CommitmentList({ scope, locale, dir, initialEnvelope, className }: CommitmentListProps): ReactElement {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(NOTHING_HIDDEN);
  const query = useMemo(() => parseCommitmentsQuery(searchParams.toString()), [searchParams]);
  const seeded = useMemo(() => seedOf(initialEnvelope), [initialEnvelope]);
  const read = useCommitments({ scope, query, ...(seeded === undefined ? {} : { initialEnvelope: seeded }) });
  const result = read.data;
  const valueStates = result !== undefined && result.kind === "envelope" ? result.envelope.valueStates : NO_VALUE_STATES;
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<CommitmentView>>>(() => {
    const list: RecordListColumnDef<CommitmentView>[] = [
      {
        id: "commitment",
        header: "Commitment",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={detailHref(row.original.commitmentRowId, query)} className="inline-link inline-flex min-h-6 max-w-full items-center break-words hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <bdi className="mono-identifier">{row.original.commitmentRowId}</bdi>
          </Link>
        ),
      },
      { id: "kind", header: "Type", enableSorting: false, cell: ({ row }) => <>{COMMITMENT_KIND_LABELS[row.original.kind] ?? UNRECOGNISED_KIND}</> },
      { id: "cadence", header: "Schedule", enableSorting: false, cell: ({ row }) => <bdi className="break-words">{row.original.cadence}</bdi> },
      { id: "perOccurrence", header: "Amount per gift", enableSorting: false, cell: ({ row }) => <AmountValue money={row.original.perOccurrence} valueState={recordedState(valueStates, row.original.commitmentRowId, "perOccurrence") ?? UNSTATED_VALUE_STATE} locale={locale} /> },
      {
        id: "outcome",
        header: OUTCOME_SR_PREFIX,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <StatusBadge {...BUCKET_STATUS[row.original.bucket]} srPrefix={OUTCOME_SR_PREFIX} />
            <span className="sr-only">{BUCKET_MEANING[row.original.bucket]}</span>
          </div>
        ),
      },
      { id: "lastSuccessful", header: "Last received", enableSorting: false, cell: ({ row }) => <StatedDate value={row.original.lastSuccessfulOn} /> },
      { id: "nextEligible", header: "Next expected", enableSorting: false, cell: ({ row }) => <StatedDate value={row.original.nextEligibleOn} /> },
      { id: "pause", header: "Status", enableSorting: false, cell: ({ row }) => <PauseFigure pause={row.original.pause} /> },
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
                <span className="sr-only">No fixed total</span>
              </>
            );
          }
          return <FixedTotalFigures commitmentRowId={row.original.commitmentRowId} fixedTotal={fixedTotal} valueStates={valueStates} locale={locale} />;
        },
      },
      {
        // The measure is stated for every row, whether or not the source supplies a figure for it: a row without one says so in the state vocabulary rather than hiding the column and the measure with it.
        id: "monthlyEquivalent",
        header: MEASURE_LABELS["monthly-equivalent-support"],
        enableSorting: false,
        cell: ({ row }) => {
          const monthly = row.original.monthlyEquivalent;
          const recorded = recordedState(valueStates, row.original.commitmentRowId, "monthlyEquivalent");
          return monthly === null ? <StatusBadge label="Not supplied" valueState={recorded ?? UNSTATED_VALUE_STATE} srPrefix={MEASURE_LABELS["monthly-equivalent-support"]} /> : <AmountValue money={moneyOf(monthly)} valueState={recorded ?? monthly.valueState} locale={locale} />;
        },
      },
    ];
    return list;
  }, [locale, query, valueStates]);
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: [], page: query.page.index + 1, pageSize: query.page.size, columnVisibility }), [query.page.index, query.page.size, columnVisibility]);
  const commitQuery = (next: CommitmentsQuery): void => {
    const search = toCommitmentsParams(next).toString();
    router.replace(search.length === 0 ? pathname : `${pathname}?${search}`, { scroll: false });
  };
  const handleQueryStateChange = (next: RecordListQueryState): void => {
    if (next.columnVisibility !== columnVisibility) setColumnVisibility(next.columnVisibility);
    if (next.page - 1 !== query.page.index || next.pageSize !== query.page.size) commitQuery({ ...query, page: { index: Math.max(0, next.page - 1), size: next.pageSize } });
  };
  const retry = (): void => void read.refetch();
  const surface = (children: ReactNode, readOnly = false): ReactElement => (
    <div data-surface="support-commitments" {...(dir === undefined ? {} : { dir })} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      {readOnly ? <ReadOnlyStatement /> : null}
      {children}
    </div>
  );
  const failure = { label: "Try again", onClick: retry };
  if (result === undefined && read.error !== null) return surface(<StateNotice kind="unavailable" headingLevel={2} title={`Couldn’t load ${SURFACE_LABEL}`} description="Couldn’t reach the giving source right now. Try again in a moment." retry={failure} />);
  if (result === undefined) return surface(<RecordList label={SURFACE_LABEL} columns={columns} rows={NO_ROWS} rowCount={0} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={rowIdOf} isLoading itemNoun="commitments" />, true);
  if (result.kind === "denied") return surface(<StateNotice kind="denied" headingLevel={2} title={SURFACE_LABEL} reasonCode={result.denied.reasonCode} />);
  if (result.kind === "unavailable") return surface(<StateNotice kind="unavailable" headingLevel={2} title={`Couldn’t load ${SURFACE_LABEL}`} description={result.unavailable.guidance} source={result.unavailable.source} retry={failure} />);
  if (result.kind === "refused") return surface(<StateNotice kind="refused" headingLevel={2} title="Couldn’t load Commitments" description={refusalSummary(result.refused)} />);
  const { data, actions, asOf, coverage } = result.envelope;
  if (data.total === 0) return surface(<StateNotice kind="empty" headingLevel={2} title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />, true);
  const additionalTypesAction = actions.find((action) => action.name === "showAdditionalTypes");
  return surface(
    <>
      <ReadOnlyStatement />
      <Card>
        <CardHeader>
          <CardTitle>Snapshot &amp; coverage</CardTitle>
          <CardDescription>{SNAPSHOT_FRAMING}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SnapshotStatement basis={SUPPORT_BASIS} currencies={NO_CURRENCIES} period={null} coverage={coverage} asOf={asOf} isCurrentPeriod={false} locale={locale} />
          {additionalTypesAction === undefined ? null : (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">Additional commitment types</p>
              <p className="text-xs text-muted-foreground">{additionalTypesAction.reason ?? "All commitment types reported by your giving source are already shown below."}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="type-supporting">Counts below cover all commitments from your giving source, grouped by recurring status and type.</p>
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
        rowLabel={(row) => row.commitmentRowId}
        initialPinnedColumns={{ start: ["commitment"] }}
        renderExpandedRow={(row) => (
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-muted-foreground">Status meaning</span>
              <p className="text-pretty text-foreground">{BUCKET_MEANING[row.bucket]}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-muted-foreground">Schedule</span>
              <span className="text-foreground">
                Cadence: <bdi>{row.cadence}</bdi>
              </span>
              <span className="text-muted-foreground">
                Last received: <StatedDate value={row.lastSuccessfulOn} /> · Next expected: <StatedDate value={row.nextEligibleOn} />
              </span>
            </div>
            <div className="flex flex-col items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-muted-foreground">Commitment type</span>
                <span className="text-foreground">{COMMITMENT_KIND_LABELS[row.kind] ?? UNRECOGNISED_KIND}</span>
              </div>
              <Link href={detailHref(row.commitmentRowId, query)} className="inline-link inline-flex min-h-6 items-center font-medium text-foreground">
                View commitment details
              </Link>
            </div>
          </div>
        )}
        itemNoun="commitments"
        locale={locale}
      />
    </>,
  );
}
export default CommitmentList;
