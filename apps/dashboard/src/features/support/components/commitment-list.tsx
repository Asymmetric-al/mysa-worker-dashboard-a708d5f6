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
type CommitmentView = CommitmentsEnvelope["data"]["commitments"][number];
type BucketFigure = CommitmentsEnvelope["data"]["buckets"][number];
type KindFigure = CommitmentsEnvelope["data"]["commitmentKinds"][number];
type MonthlyEquivalentView = NonNullable<CommitmentView["monthlyEquivalent"]>;
type FixedTotalView = NonNullable<CommitmentView["fixedTotal"]>;
type PauseState = CommitmentView["pause"]["state"];
type ColumnVisibility = RecordListQueryState["columnVisibility"];
export type CommitmentListProps = { readonly scope: Scope; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly initialEnvelope?: ReadEnvelope<unknown>; readonly className?: string };
const SURFACE_LABEL = "Commitments";
const OUTCOME_SR_PREFIX = "Recurring outcome";
const READ_ONLY_BODY = [
  "Commitments come from the source that owns them. This screen reads them and cannot post, retry, pause, resume, cancel or correct a payment, and no control here creates a gift, a message or a task.",
  "A commitment is not received cash. A settled occurrence is stated as the source's own outcome, a collection in flight is not counted as received, and nothing on this surface is added to a received-support figure.",
] as const;
const SNAPSHOT_FRAMING =
  "A commitment is not received cash: these rows state the source's own cadence, currency and occurrence state, and none is counted in a received-support figure. The statement below names the one received-support basis and grain this application reports on — the measure these rows are deliberately kept outside of — with the coverage of the records behind this read and the instant it was evaluated at.";
const UNRECOGNISED_KIND = "Unrecognised commitment type";
const PAUSE_STATUS: Readonly<Record<PauseState, { readonly label: string; readonly tone: StatusTone }>> = { active: { label: "Active", tone: "positive" }, paused: { label: "Paused", tone: "neutral" } };
const UNSTATED_VALUE_STATE: ValueState = "unknown";
const NOTHING_HIDDEN: ColumnVisibility = {};
const NO_ROWS: readonly CommitmentView[] = [];
const NO_VALUE_STATES: Readonly<Record<string, ValueState>> = {};
const NO_CURRENCIES: readonly string[] = [];
const recordedState = (valueStates: Readonly<Record<string, ValueState>>, commitmentRowId: string, field: string): ValueState | undefined => valueStates[`commitments.${commitmentRowId}.${field}`];
const moneyOf = (amount: MonthlyEquivalentView): Money => ({ currency: amount.currency, minorUnits: amount.minorUnits !== null && Number.isSafeInteger(amount.minorUnits) ? minorUnitsOf(amount.minorUnits) : minorUnitsOf(0) });
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
  if (value === null) return <span className="text-muted-foreground">No date stated</span>;
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
              Resumes <StatedDate value={pause.resumeOn} />
            </>
          )}
        </span>
      ) : null}
    </div>
  );
}
function FixedTotalFigures({ commitmentRowId, fixedTotal, valueStates, locale }: { readonly commitmentRowId: string; readonly fixedTotal: FixedTotalView; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement {
  const facts: readonly FactSpec[] = FIXED_TOTAL_FIELDS.map(({ field, label }) => ({ term: label, value: <AmountValue money={fixedTotal[field]} valueState={recordedState(valueStates, commitmentRowId, `fixedTotal.${field}`) ?? UNSTATED_VALUE_STATE} locale={locale} /> }));
  return <FactList className="flex min-w-0 flex-col gap-1" facts={facts} rowClassName="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2" termClassName="text-xs text-muted-foreground" />;
}
function CountValue({ count, valueState }: { readonly count: number; readonly valueState: ValueState }): ReactElement {
  return valueState === "value" ? <span className="tabular-figures text-sm">{String(count)}</span> : <StatusBadge label={String(count)} valueState={valueState} />;
}
type PartitionGroup = { readonly key: string; readonly heading: string; readonly note?: string; readonly termClassName: string; readonly valueClassName: string; readonly rows: readonly { readonly key: string; readonly term: ReactNode; readonly count: number; readonly valueState: ValueState }[] };
function PartitionFigures({ buckets, kinds, outsideMeaning }: { readonly buckets: readonly BucketFigure[]; readonly kinds: readonly KindFigure[]; readonly outsideMeaning: string }): ReactElement {
  const labelBase = useId();
  const groups: readonly PartitionGroup[] = [
    {
      key: "outcomes",
      heading: "Recurring outcomes",
      note: outsideMeaning,
      termClassName: "min-w-0",
      valueClassName: "min-w-0 tabular-figures",
      rows: buckets.map((figure) => ({ key: figure.bucket, term: <StatusBadge {...BUCKET_STATUS[figure.bucket]} srPrefix={OUTCOME_SR_PREFIX} className="h-auto min-h-5 max-w-full py-0.5 text-start whitespace-normal" />, count: figure.count, valueState: figure.valueState })),
    },
    { key: "kinds", heading: "Commitment kinds", termClassName: "min-w-0 break-words", valueClassName: "min-w-0", rows: kinds.map((figure) => ({ key: figure.kind, term: COMMITMENT_KIND_LABELS[figure.kind] ?? UNRECOGNISED_KIND, count: figure.count, valueState: figure.valueState })) },
  ];
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`${labelBase}-${group.key}`} className="flex min-w-0 flex-col gap-2 border border-border p-3">
          <p id={`${labelBase}-${group.key}`} className="text-sm font-medium">
            {group.heading}
          </p>
          <dl className="flex min-w-0 flex-col gap-2">
            {group.rows.map((row) => (
              <div key={row.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <dt className={group.termClassName}>{row.term}</dt>
                <dd className={group.valueClassName}>
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
function ReadOnlyStatement(): ReactElement {
  return (
    <Alert role="note">
      <AlertTitle>Commitments are read-only</AlertTitle>
      <AlertDescription>
        {READ_ONLY_BODY.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}
/** The recurring outcomes and commitments the source reports, read-only, with every figure rendered from its own value state and every bucket stated in words rather than by colour. */ export function CommitmentList({ scope, locale, dir, initialEnvelope, className }: CommitmentListProps): ReactElement {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const revealFieldId = useId();
  const revealReasonId = useId();
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(NOTHING_HIDDEN);
  const query = useMemo(() => parseCommitmentsQuery(searchParams.toString()), [searchParams]);
  const seeded = useMemo(() => seedOf(initialEnvelope), [initialEnvelope]);
  const read = useCommitments({ scope, query, ...(seeded === undefined ? {} : { initialEnvelope: seeded }) });
  const result = read.data;
  const rows = result !== undefined && result.kind === "envelope" ? result.envelope.data.commitments : NO_ROWS;
  const valueStates = result !== undefined && result.kind === "envelope" ? result.envelope.valueStates : NO_VALUE_STATES;
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<CommitmentView>>>(() => {
    const monthlyEquivalentStated = rows.some((row) => row.monthlyEquivalent !== null);
    const list: RecordListColumnDef<CommitmentView>[] = [
      {
        id: "commitment",
        header: "Commitment",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={detailHref(row.original.commitmentRowId, query)} className="inline-flex min-h-6 max-w-full items-center break-words underline underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <bdi className="mono-identifier">{row.original.commitmentRowId}</bdi>
          </Link>
        ),
      },
      { id: "kind", header: "Kind", enableSorting: false, cell: ({ row }) => <>{COMMITMENT_KIND_LABELS[row.original.kind] ?? UNRECOGNISED_KIND}</> },
      { id: "cadence", header: "Cadence", enableSorting: false, cell: ({ row }) => <bdi className="break-words">{row.original.cadence}</bdi> },
      { id: "perOccurrence", header: "Per occurrence", enableSorting: false, cell: ({ row }) => <AmountValue money={row.original.perOccurrence} valueState={recordedState(valueStates, row.original.commitmentRowId, "perOccurrence") ?? UNSTATED_VALUE_STATE} locale={locale} /> },
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
                <span className="sr-only">No fixed total on this commitment</span>
              </>
            );
          }
          return <FixedTotalFigures commitmentRowId={row.original.commitmentRowId} fixedTotal={fixedTotal} valueStates={valueStates} locale={locale} />;
        },
      },
    ];
    if (monthlyEquivalentStated) {
      list.push({
        id: "monthlyEquivalent",
        header: MEASURE_LABELS["monthly-equivalent-support"],
        enableSorting: false,
        cell: ({ row }) => {
          const monthly = row.original.monthlyEquivalent;
          return monthly === null ? <span className="text-muted-foreground">Not stated by the source</span> : <AmountValue money={moneyOf(monthly)} valueState={recordedState(valueStates, row.original.commitmentRowId, "monthlyEquivalent") ?? monthly.valueState} locale={locale} />;
        },
      });
    }
    return list;
  }, [locale, query, rows, valueStates]);
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: [], page: query.page.index + 1, pageSize: query.page.size, columnVisibility }), [query.page.index, query.page.size, columnVisibility]);
  const commitQuery = (next: CommitmentsQuery): void => {
    const search = toCommitmentsParams(next).toString();
    router.replace(search.length === 0 ? pathname : `${pathname}?${search}`, { scroll: false });
  };
  const handleQueryStateChange = (next: RecordListQueryState): void => {
    if (next.columnVisibility !== columnVisibility) setColumnVisibility(next.columnVisibility);
    const pageIndex = Math.max(0, next.page - 1);
    if (pageIndex !== query.page.index || next.pageSize !== query.page.size) commitQuery({ ...query, page: { index: pageIndex, size: next.pageSize } });
  };
  const retry = (): void => void read.refetch();
  const surface = (children: ReactNode): ReactElement => (
    <div data-surface="support-commitments" {...(dir === undefined ? {} : { dir })} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      {children}
    </div>
  );
  const failure = { label: "Try again", onClick: retry };
  if (result === undefined && read.error !== null) return surface(<StateNotice kind="unavailable" headingLevel={2} title={`${SURFACE_LABEL} could not be read`} description="The read answered in a form this surface cannot state as a result, so no commitment, count or empty list stands in its place." retry={failure} />);
  if (result === undefined) {
    return surface(
      <>
        <ReadOnlyStatement />
        <RecordList label={SURFACE_LABEL} columns={columns} rows={NO_ROWS} rowCount={0} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={rowIdOf} isLoading itemNoun="commitments" />
      </>,
    );
  }
  if (result.kind === "denied") return surface(<StateNotice kind="denied" headingLevel={2} title={SURFACE_LABEL} reasonCode={result.denied.reasonCode} />);
  if (result.kind === "unavailable") return surface(<StateNotice kind="unavailable" headingLevel={2} title={`${SURFACE_LABEL} could not be read`} description={result.unavailable.guidance} source={result.unavailable.source} retry={failure} />);
  if (result.kind === "refused") return surface(<StateNotice kind="refused" headingLevel={2} title="This list's request was refused" description={refusalSummary(result.refused)} />);
  const { data, actions, asOf, coverage } = result.envelope;
  if (data.total === 0) {
    return surface(
      <>
        <ReadOnlyStatement />
        <StateNotice kind="empty" headingLevel={2} title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />
      </>,
    );
  }
  const additionalTypesAction = actions.find((action) => action.name === "showAdditionalTypes");
  const onAdditionalTypes = (checked: boolean): void => commitQuery({ ...query, showAdditionalTypes: checked, page: { index: 0, size: query.page.size } });
  return surface(
    <>
      <ReadOnlyStatement />
      <Card>
        <CardHeader>
          <CardTitle>The family basis, the coverage and the read instant</CardTitle>
          <CardDescription>{SNAPSHOT_FRAMING}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SnapshotStatement basis={SUPPORT_BASIS} currencies={NO_CURRENCIES} period={null} coverage={coverage} asOf={asOf} isCurrentPeriod={false} locale={locale} />
          {additionalTypesAction === undefined ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={revealFieldId} className={cn("items-start leading-snug font-normal", additionalTypesAction.available && "cursor-pointer")}>
                <Checkbox id={revealFieldId} className="mt-0.5" checked={query.showAdditionalTypes} disabled={!additionalTypesAction.available} aria-describedby={additionalTypesAction.reason === undefined ? undefined : revealReasonId} onCheckedChange={onAdditionalTypes} />
                <span className="min-w-0 break-words">Show additional source-supplied commitment types</span>
              </Label>
              <p className="text-xs text-muted-foreground">The choice is carried with the request to the source, so the list below states exactly the commitments the read answers with.</p>
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
        <p className="text-sm text-muted-foreground">Every commitment the source reports sits in exactly one of five recurring outcomes, or outside all five when the evidence behind it is unknown or stale. These figures cover the whole list rather than the page shown.</p>
        <PartitionFigures buckets={data.buckets} kinds={data.commitmentKinds} outsideMeaning={BUCKET_MEANING["outside-partition"]} />
      </div>
      <RecordList label={SURFACE_LABEL} columns={columns} rows={data.commitments} rowCount={data.total} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={rowIdOf} itemNoun="commitments" />
    </>,
  );
}
export default CommitmentList;
