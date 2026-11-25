"use client";
import Link from "next/link";
import { ChevronRightIcon, FileSpreadsheetIcon } from "lucide-react";
import { useMemo, type ReactElement, type ReactNode } from "react";
import ChartFigure, { type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import { refusalSummary } from "@/components/form-field";
import SectionCard from "@/components/section-card";
import StateNotice from "@/components/state-notice";
import { IconTile } from "@/components/ui/icon-tile";
import { MiniSparkline, type SparklinePoint } from "@/components/ui/mini-sparkline";
import { SegmentedMeter, type MeterSegmentTone } from "@/components/ui/segmented-meter";
import { Separator } from "@/components/ui/separator";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { CoverageState, ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import { isReadResult } from "@/modules/data-service/outcome";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { BUCKET_MEANING, CHART_CAPTIONS, COMMITMENT_KIND_LABELS, COUNT_STATE_NOTE, EMPTY_STATES, MEASURE_LABELS, MONTHLY_EQUIVALENT_NO_COMMITMENTS, NO_PERCENTAGE, fillTemplate } from "../copy";
import { useSupportOverview, type SupportOverviewRead } from "../hooks/use-support-overview";
import { REPORT_CATALOG, REPORT_ORDER, reportHref } from "../report-catalog";
import AmountValue from "./amount-value";
import GoalPanel from "./goal-panel";
import MeasureCard from "./measure-card";
import SnapshotStatement from "./snapshot-statement";
export type SupportOverviewProps = { readonly scope: Scope; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly initialEnvelope?: ReadEnvelope<unknown>; readonly className?: string };
type SupportOverviewEnvelope = Extract<SupportOverviewRead, { readonly kind: "envelope" }>["envelope"];
type SupportOverviewReport = SupportOverviewEnvelope["data"]["report"];
type CurrencySummaryView = SupportOverviewReport["summary"][number];
type StatedAmount = CurrencySummaryView["received"];
type RecurringPointView = SupportOverviewReport["series"][number];
type PeriodText = { readonly from: string; readonly to: string };
const GOAL_STATED_ELSEWHERE = "A progress figure exists for this period and is stated in the Support goal section below, exactly as the goal's own read computed it.";
const GOAL_STATE_SENTENCE: Readonly<Record<NonNullable<SupportOverviewReport["goal"]>["state"], string>> = {
  value: GOAL_STATED_ELSEWHERE,
  zero: GOAL_STATED_ELSEWHERE,
  "no-goal": NO_PERCENTAGE["no-goal"],
  "no-percentage": NO_PERCENTAGE.default,
  incompatible: NO_PERCENTAGE["incompatible-measure"],
  paused: "The goal is paused, so no progress figure is stated for it and nothing is put in its place.",
  ended: "The goal has ended, so no progress figure is stated for it; an ended goal never rewrites an earlier period.",
  unavailable: "The source behind the goal could not be read, so no comparison is stated here. This is not a goal of zero and no figure stands in its place.",
};
const SERIES_LABEL: string = MEASURE_LABELS["received-gifts"];
const RECEIVED_CASH_UNIT = "received cash, one row per authorised allocation";
const MONTHLY_EQUIVALENT_DESCRIPTION = "Each monthly equivalent is the qualified source's own calculation for one commitment, in the currency the source states it in. They are stated one by one and are never averaged or summed into one figure.";
const MONTH_COLUMN_KEY = "month";
const CURRENCY_COLUMN_PREFIX = "currency:";
const GAP_CELL_WORD = "No recorded value";
function civilDateText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const text = String(value);
    if (text !== "[object Object]") return text;
  }
  return "a date this read did not state";
}
const monthText = (bucketStart: unknown): string => {
  const text = civilDateText(bucketStart);
  return text.length >= 7 ? text.slice(0, 7) : text;
};
const periodOf = (report: SupportOverviewReport): PeriodText => ({ from: civilDateText(report.snapshot.period.from), to: civilDateText(report.snapshot.period.to) });
const isCurrentPeriodOf = (report: SupportOverviewReport): boolean => report.snapshot.period.state === "in-progress";
const moneyOf = (currency: string, stated: StatedAmount): Money => ({ currency, minorUnits: stated.minorUnits ?? minorUnitsOf(0) });
const stateOf = (envelope: SupportOverviewEnvelope, path: string, fallback: ValueState): ValueState => envelope.valueStates[path] ?? fallback;
const monthlyMoneyOf = (entry: SupportOverviewEnvelope["data"]["monthlyEquivalent"][number]): Money => ({ currency: entry.amount.currency, minorUnits: entry.amount.minorUnits === null ? minorUnitsOf(0) : minorUnitsOf(entry.amount.minorUnits) });
function chartPartitions(series: readonly RecurringPointView[]): readonly { readonly currency: string; readonly points: readonly RecurringPointView[]; readonly byMonth: ReadonlyMap<string, RecurringPointView> }[] {
  const byCurrency = new Map<string, RecurringPointView[]>();
  for (const point of series) byCurrency.set(point.currency, [...(byCurrency.get(point.currency) ?? []), point]);
  return [...byCurrency].map(([currency, points]) => ({ currency, points, byMonth: new Map(points.map((point): [string, RecurringPointView] => [monthText(point.bucketStart), point])) }));
}
type ChartPartition = ReturnType<typeof chartPartitions>[number];
const chartPointsOf = (partition: ChartPartition): readonly ChartPoint[] => partition.points.map((point) => ({ bucket: monthText(point.bucketStart), value: point.value.minorUnits, state: point.value.valueState, gap: point.gap }));
const chartSeriesOf = (partition: ChartPartition): ChartSeries => ({ key: `${partition.currency}-received`, label: SERIES_LABEL, currency: partition.currency, points: chartPointsOf(partition) });
const amountCell = (value: StatedAmount, currency: string, gap: boolean, locale: string): string => (gap && value.minorUnits === null ? GAP_CELL_WORD : formatMinor(moneyOf(currency, value), value.valueState, locale).text);
function chartTable(partitions: readonly ChartPartition[], locale: string): ChartTable {
  const columns = [{ key: MONTH_COLUMN_KEY, label: "Month" }, ...partitions.map((partition) => ({ key: `${CURRENCY_COLUMN_PREFIX}${partition.currency}`, label: partition.currency }))];
  const months = [...new Set(partitions.flatMap((partition) => [...partition.byMonth.keys()]))];
  const rows = months.map((month) => {
    const row: Record<string, string> = { [MONTH_COLUMN_KEY]: month };
    for (const partition of partitions) {
      const point = partition.byMonth.get(month);
      row[`${CURRENCY_COLUMN_PREFIX}${partition.currency}`] = point === undefined ? GAP_CELL_WORD : amountCell(point.value, partition.currency, point.gap, locale);
    }
    return row;
  });
  return { caption: `${SERIES_LABEL} by month, one row per month and one column per currency: a month the source recorded nothing in states that rather than a zero.`, columns, rows };
}
function overviewReadOf(candidate: ReadEnvelope<unknown> | undefined): SupportOverviewRead | undefined {
  if (candidate === undefined) return undefined;
  const stated: unknown = candidate;
  return isReadResult(stated) ? (stated as SupportOverviewRead) : isOverviewEnvelope(stated) ? { kind: "envelope", envelope: stated } : undefined;
}
function isOverviewEnvelope(value: unknown): value is SupportOverviewEnvelope {
  if (value === null || typeof value !== "object") return false;
  if (!("data" in value) || !("valueStates" in value) || !("coverage" in value) || !("asOf" in value)) return false;
  const { data } = value;
  return data !== null && typeof data === "object" && "report" in data && "monthlyEquivalent" in data && "buckets" in data && "commitmentKinds" in data;
}
const CountRow = ({ label, count, state }: { readonly label: string; readonly count: number; readonly state: ValueState }): ReactElement => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded-xl border border-border/80 bg-surface-subtle px-3 py-2">
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="flex flex-wrap items-baseline gap-x-1 text-base font-semibold text-foreground">
      <bdi className="tabular-figures">{count}</bdi>
      {COUNT_STATE_NOTE[state] === null ? null : <span className="text-xs font-normal text-muted-foreground">{COUNT_STATE_NOTE[state]}</span>}
    </dd>
  </div>
);
const PeriodNote = ({ period, coverage }: { readonly period: PeriodText; readonly coverage: CoverageState }): ReactElement => (
  <p className="text-xs text-muted-foreground">
    Counted for <bdi>{period.from}</bdi> to <bdi>{period.to}</bdi>, over <bdi>{coverage}</bdi> coverage.
  </p>
);
const MeasureSection = ({ title, description, period, coverage, children }: { readonly title: string; readonly description: string; readonly period: PeriodText; readonly coverage: CoverageState; readonly children: ReactNode }): ReactElement => (
  <SectionCard title={title} description={description} headingLevel={3} cardVariant="muted" contentClassName="flex flex-col gap-3">
    <PeriodNote period={period} coverage={coverage} />
    {children}
  </SectionCard>
);
function CashCounts({ envelope, entry }: { readonly envelope: SupportOverviewEnvelope; readonly entry: CurrencySummaryView }): ReactElement {
  const path = `summary.${entry.currency}`;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <CountRow label="Gifts" count={entry.giftCount.count} state={stateOf(envelope, `${path}.giftCount`, entry.giftCount.valueState)} />
        <CountRow label="Allocations" count={entry.allocationCount.count} state={stateOf(envelope, `${path}.allocationCount`, entry.allocationCount.valueState)} />
        <CountRow label="Donors" count={entry.donorCount.count} state={stateOf(envelope, `${path}.donorCount`, entry.donorCount.valueState)} />
      </dl>
      <p className="type-supporting">{"Each count is stated at its own grain and the three are never added together: a gift split between two allocations is one gift, two allocations and one donor, and a view that legitimately holds both grain levels counts the amount once."}</p>
    </div>
  );
}
function sparklinePointsForCurrency(series: readonly RecurringPointView[], currency: string, locale: string): readonly SparklinePoint[] {
  return series
    .filter((point) => point.currency === currency)
    .map((point) => {
      const label = monthText(point.bucketStart);
      if (point.gap || point.value.minorUnits === null) {
        return { label, value: null, formatted: GAP_CELL_WORD };
      }
      return {
        label,
        value: Number(point.value.minorUnits),
        formatted: formatMinor(moneyOf(currency, point.value), point.value.valueState, locale).text,
      };
    });
}

function CashSummary({ envelope, locale }: { readonly envelope: SupportOverviewEnvelope; readonly locale: string }): ReactElement {
  const report = envelope.data.report;
  if (report.summary.length === 0) return <StateNotice kind="empty" title={EMPTY_STATES.gifts.title} description={EMPTY_STATES.gifts.body} action={EMPTY_STATES.gifts.action} />;
  const period = periodOf(report);
  const isCurrentPeriod = isCurrentPeriodOf(report);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {report.summary.map((entry) => {
        const money = moneyOf(entry.currency, entry.received);
        const valueState = stateOf(envelope, `summary.${entry.currency}.received`, entry.received.valueState);
        const sparkData = sparklinePointsForCurrency(report.series, entry.currency, locale);
        const detail = (
          <div className="flex flex-col gap-3">
            {sparkData.length >= 2 ? <MiniSparkline data={sparkData} label={`${entry.currency} monthly received trend`} /> : null}
            <CashCounts envelope={envelope} entry={entry} />
          </div>
        );
        return <MeasureCard key={entry.currency} measure="received-gifts" money={money} valueState={valueState} unit={RECEIVED_CASH_UNIT} period={period} coverage={envelope.coverage} asOf={report.snapshot.asOf} isCurrentPeriod={isCurrentPeriod} locale={locale} emphasis="primary" detail={detail} />;
      })}
    </div>
  );
}
const RECURRING_OUTCOMES_DESCRIPTION = "These are not received cash. Each occurrence the source reports sits in one of the five outcomes and is counted at its own state, so a collection in flight is not cash, an absent receipt is not donor debt, and no outcome here is added to an amount.";
const RECURRING_BUCKET_TONE: Readonly<Record<string, MeterSegmentTone>> = {
  succeeded: "positive",
  "in-flight": "info",
  "failed-retrying": "warning",
  "failed-stopped": "destructive",
  "skipped-or-paused": "muted",
};
const RecurringOutcomes = ({ envelope }: { readonly envelope: SupportOverviewEnvelope }): ReactElement => {
  const segments = envelope.data.buckets.map((bucket) => ({
    key: bucket.bucket,
    label: bucket.label,
    count: bucket.count,
    tone: RECURRING_BUCKET_TONE[bucket.bucket] ?? "muted",
  }));
  return (
    <SectionCard title={MEASURE_LABELS["recurring-collection-outcomes"]} headingLevel={3} description={RECURRING_OUTCOMES_DESCRIPTION} contentClassName="flex flex-col gap-3">
      <PeriodNote period={periodOf(envelope.data.report)} coverage={envelope.coverage.state} />
      <SegmentedMeter segments={segments} label="Recurring collection outcomes distribution" />
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {envelope.data.buckets.map((bucket) => (
          <CountRow key={bucket.bucket} label={bucket.label} count={bucket.count} state={stateOf(envelope, `buckets.${bucket.bucket}.count`, bucket.valueState)} />
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{BUCKET_MEANING["outside-partition"]}</p>
    </SectionCard>
  );
};
const CommitmentKinds = ({ envelope, period }: { readonly envelope: SupportOverviewEnvelope; readonly period: PeriodText }): ReactElement => (
  <MeasureSection title={MEASURE_LABELS.commitments} description="Commitments are facts the source reports and this application never writes. Each is counted in its own kind and in its own outcome bucket, and no commitment is counted as cash." period={period} coverage={envelope.coverage.state}>
    <dl className="grid gap-2 sm:grid-cols-3">
      {envelope.data.commitmentKinds.map((kind) => (
        <CountRow key={kind.kind} label={COMMITMENT_KIND_LABELS[kind.kind]} count={kind.count} state={stateOf(envelope, `commitmentKinds.${kind.kind}.count`, kind.valueState)} />
      ))}
    </dl>
  </MeasureSection>
);
const MonthlyEquivalents = ({ envelope, period, locale }: { readonly envelope: SupportOverviewEnvelope; readonly period: PeriodText; readonly locale: string }): ReactElement => (
  <MeasureSection title={MEASURE_LABELS["monthly-equivalent-support"]} description={MONTHLY_EQUIVALENT_DESCRIPTION} period={period} coverage={envelope.coverage.state}>
    <dl className="flex flex-col gap-2">
      {envelope.data.monthlyEquivalent.map((entry) => (
        <div key={entry.commitmentRowId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <dt className="min-w-0 break-words text-muted-foreground">
            <bdi className="mono-identifier">{entry.commitmentRowId}</bdi>
            <span className="ms-2 text-xs">{entry.cadence}</span>
          </dt>
          <dd>
            <AmountValue money={monthlyMoneyOf(entry)} valueState={stateOf(envelope, `monthlyEquivalent.${entry.commitmentRowId}.amount`, entry.amount.valueState)} locale={locale} />{" "}
          </dd>
        </div>
      ))}
    </dl>
    <p className="text-xs text-muted-foreground">{"No combined monthly figure is stated: these equivalents belong to individual commitments, in the currencies the source states them in, and summing them would state a number no source computed."}</p>
  </MeasureSection>
);
function CommittedSupport({ envelope, locale }: { readonly envelope: SupportOverviewEnvelope; readonly locale: string }): ReactElement {
  const report = envelope.data.report;
  const period = periodOf(report);
  const commitmentCount = envelope.data.commitmentKinds.reduce((total, kind) => total + kind.count, 0);
  const hasCommitments = commitmentCount > 0;
  const hasMonthlyEquivalents = envelope.data.monthlyEquivalent.length > 0;
  const commitmentsEmpty = <StateNotice kind="empty" title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />;
  // Two tabs, two measures: an empty monthly-equivalent list states that the source calculated no monthly equivalent, and says how many commitments it does report, because the absence of this measure is not an absence of commitments.
  const monthlyEquivalentsEmpty = <StateNotice kind="empty" title={EMPTY_STATES.monthlyEquivalents.title} description={commitmentCount === 0 ? MONTHLY_EQUIVALENT_NO_COMMITMENTS : fillTemplate(EMPTY_STATES.monthlyEquivalents.body, { count: String(commitmentCount) })} action={EMPTY_STATES.monthlyEquivalents.action} />;
  return (
    <Tabs defaultValue="committed" className="min-w-0 gap-4">
      <TabsList aria-label="Committed support and monthly equivalents" className="max-w-full">
        <TabsTrigger value="committed">Committed</TabsTrigger>
        <TabsTrigger value="monthly">Monthly equivalents</TabsTrigger>
      </TabsList>
      <TabsContent value="committed" aria-label="Committed versus goal" className="flex flex-col gap-3">
        {hasCommitments ? <CommitmentKinds envelope={envelope} period={period} /> : commitmentsEmpty}
        <p className="max-w-prose type-supporting">{"The goal is compared with received support on the goal's own read, and its progress figure is stated once, in the Support goal section below. It is never recomputed, re-rounded or capped here."}</p>
        <p className="max-w-prose type-body">{report.goal === undefined ? "This read states no goal, so there is no committed-versus-goal comparison to state and none is invented." : GOAL_STATE_SENTENCE[report.goal.state]}</p>
      </TabsContent>
      <TabsContent value="monthly" aria-label="Monthly equivalents" className="flex flex-col gap-3">
        {hasMonthlyEquivalents ? <MonthlyEquivalents envelope={envelope} period={period} locale={locale} /> : monthlyEquivalentsEmpty}
      </TabsContent>
    </Tabs>
  );
}
function MonthlyHistory({ report, locale }: { readonly report: SupportOverviewReport; readonly locale: string }): ReactElement {
  const partitions = useMemo(() => chartPartitions(report.series), [report]); // The partitions and the series drawn from them are derived once per answered report, so a re-render for another reason redraws nothing.
  const series = useMemo(() => partitions.map(chartSeriesOf), [partitions]);
  const partitionText = partitions.length === 0 ? "no currency stated" : partitions.map((partition) => partition.currency).join(", ");
  const summary = fillTemplate(CHART_CAPTIONS.summaryOpener, { series: SERIES_LABEL, currency: partitionText, takeaway: "each month is drawn from the amount the source recorded in it, and a month it recorded nothing in is left undrawn and named below rather than drawn at zero" });
  const units = fillTemplate(CHART_CAPTIONS.unit, { currency: partitionText });
  const asOf = fillTemplate(CHART_CAPTIONS.asOf, { asOf: report.snapshot.asOf });
  return <ChartFigure title="Received support by month" summary={summary} caption="Monthly received support, one plot per currency." kind="bar" series={series} units={units} coverage={report.snapshot.coverage} asOf={asOf} table={chartTable(partitions, locale)} locale={locale} />;
}
function Destinations(): ReactElement {
  const links = [{ href: "/support/gifts", label: "Read the whole gifts ledger" }, { href: "/support/commitments", label: "Read the commitments" }, ...REPORT_ORDER.map((id) => ({ href: reportHref(id), label: REPORT_CATALOG[id].title }))];
  return (
    <section aria-label="Destinations" className="flex flex-col gap-3">
      <h3 className="type-subsection-title">Read the whole ledger, the commitments and the four reports</h3>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <li key={link.href}>
            <SpotlightCard className="rounded-2xl">
              <Link
                href={link.href}
                data-slot="button"
                className="group/dest flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border/80 bg-card px-3.5 py-2.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-input/60 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
              >
                <IconTile variant="soft" size="sm">
                  <FileSpreadsheetIcon />
                </IconTile>
                <span className="min-w-0 flex-1 text-pretty">{link.label}</span>
                <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/dest:translate-x-0.5 rtl:-scale-x-100" />
              </Link>
            </SpotlightCard>
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-xs text-muted-foreground">Each destination reads the same report result as this overview, so a figure there repeats the figure stated here rather than computing a second set of them.</p>
    </section>
  );
}
function OverviewFigures({ envelope, scope, locale, dir }: { readonly envelope: SupportOverviewEnvelope; readonly scope: Scope; readonly locale: string; readonly dir: "ltr" | "rtl" | undefined }): ReactElement {
  const report = envelope.data.report;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <SnapshotStatement basis={report.snapshot.basis} currencies={report.snapshot.currencies} period={periodOf(report)} coverage={envelope.coverage} asOf={report.snapshot.asOf} isCurrentPeriod={isCurrentPeriodOf(report)} locale={locale} />
      <section aria-label="Cash received in this period" className="flex min-w-0 flex-col gap-3">
        <h3 className="type-subsection-title">Cash received</h3>
        <CashSummary envelope={envelope} locale={locale} />
      </section>
      <RecurringOutcomes envelope={envelope} />
      <section aria-label="Committed support and the goal it is read beside" className="flex min-w-0 flex-col gap-3">
        <h3 className="type-subsection-title">Committed support</h3>
        <p className="type-supporting max-w-prose">{"Commitments, committed amounts and the goal are measures of their own. They are read beside received support and are never added to it, divided by it, or presented as one combined figure."}</p>
        <CommittedSupport envelope={envelope} locale={locale} />
      </section>
      <MonthlyHistory report={report} locale={locale} />
      <GoalPanel scope={scope} locale={locale} dir={dir} />
      <Separator />
      <Destinations />
    </div>
  );
}
function OverviewAnswer({ result, error, retry, scope, locale, dir }: { readonly result: SupportOverviewRead | undefined; readonly error: Error | null; readonly retry: () => void; readonly scope: Scope; readonly locale: string; readonly dir: "ltr" | "rtl" | undefined }): ReactElement {
  const retryAction = { label: "Read this period again", onClick: retry };
  if (result === undefined) {
    return error === null ? (
      <StateNotice kind="loading" title="Reading this period's support" description="One answer carries the report result, the recurring outcomes and the monthly equivalents, so no figure is shown until that answer arrives." loadingLines={6} />
    ) : (
      <StateNotice kind="unavailable" title="The support read could not be completed" description={error.message} retry={retryAction} />
    );
  }
  if (result.kind === "denied")
    return <StateNotice kind="denied" title="Support is not available in this scope" description="This read is refused for the context this session is acting in. The refusal is the same whether or not records exist, so nothing here states a count, a title or a size." reasonCode={result.denied.reasonCode} />;
  if (result.kind === "unavailable") return <StateNotice kind="unavailable" title="The financial source could not be read" description={result.unavailable.guidance} source={result.unavailable.source} retry={retryAction} />;
  return result.kind === "refused" ? <StateNotice kind="refused" title="This period's request was refused" description={refusalSummary(result.refused)} /> : <OverviewFigures envelope={result.envelope} scope={scope} locale={locale} dir={dir} />;
}
export function SupportOverview({ scope, locale, dir, initialEnvelope, className }: SupportOverviewProps): ReactElement {
  const initialRead = useMemo(() => overviewReadOf(initialEnvelope), [initialEnvelope]);
  const query = useSupportOverview({ scope, initialEnvelope: initialRead });
  const retry = (): void => void query.refetch();
  return (
    <div dir={dir} className={cn("flex w-full min-w-0 flex-col gap-6", className)}>
      <header className="flex min-w-0 flex-col gap-2">
        <h2 className="type-section-title text-pretty wrap-anywhere">Received support</h2>
        <p className="type-supporting max-w-prose">
          {"Cash received on the one named basis this application measures, then the recurring outcomes that are not cash and the committed measures kept separate from both. Every figure states its period, its coverage and the instant it was read at, and a currency is never combined with another."}
        </p>
      </header>
      <OverviewAnswer result={query.data} error={query.error} retry={retry} scope={scope} locale={locale} dir={dir} />
    </div>
  );
}
export default SupportOverview;
