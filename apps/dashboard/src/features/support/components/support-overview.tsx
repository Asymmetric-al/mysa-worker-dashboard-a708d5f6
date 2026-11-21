"use client";
/**
 * The Support overview: the cash-first summary of one period, the recurring outcomes that are not cash,
 * the committed measures kept visibly secondary, the monthly history drawn through the one chart
 * pattern, the goal on its own read, and the destinations these figures lead to.
 *
 * Nothing on this surface computes a figure. One read answers one report result, one recurring-outcome
 * partition and one monthly-equivalent list, and every number rendered here is that read's own —
 * together with the `ValueState` that says whether it is a value, a genuine zero, an unknown, a
 * withheld value, an unavailable source or an incomplete subtotal. A month the source recorded nothing
 * in is a gap rather than a zero, an unavailable source is reported as unavailable and never as `0` or
 * as an empty list, and the cash figures lead while the committed measures stay secondary.
 */
import Link from "next/link";
import { useMemo, type ReactElement } from "react";
import ChartFigure, { type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import StateNotice from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { CoverageState, ReadEnvelope, Scope, ValueState } from "@/modules/data-service/envelope";
import { isReadResult } from "@/modules/data-service/outcome";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { BUCKET_MEANING, CHART_CAPTIONS, COMMITMENT_KIND_LABELS, EMPTY_STATES, MEASURE_LABELS, NO_PERCENTAGE, fillTemplate } from "../copy";
import { useSupportOverview, type SupportOverviewRead } from "../hooks/use-support-overview";
import { REPORT_CATALOG, REPORT_ORDER, reportHref } from "../report-catalog";
import AmountValue from "./amount-value";
import GoalPanel from "./goal-panel";
import MeasureCard from "./measure-card";
import SnapshotStatement from "./snapshot-statement";
/** What the route composes this surface with. */
export type SupportOverviewProps = {
  /** The exact authority this overview is read under; the service re-derives scope from it on every read. */
  readonly scope: Scope;
  /** The locale amounts and list separators are formatted for. */
  readonly locale: string;
  /** The writing direction of the content this surface renders, never a property of its styling. */
  readonly dir?: "ltr" | "rtl";
  /** The envelope a Server Component already read, offered to the read as its initial data so the first paint issues no second request. */
  readonly initialEnvelope?: ReadEnvelope<unknown>;
  readonly className?: string;
};
// The three facts the read answers with, derived from the hook rather than restated here
type SupportOverviewEnvelope = Extract<SupportOverviewRead, { readonly kind: "envelope" }>["envelope"];
type SupportOverviewReport = SupportOverviewEnvelope["data"]["report"];
type CurrencySummaryView = SupportOverviewReport["summary"][number];
type StatedAmount = CurrencySummaryView["received"];
type RecurringPointView = SupportOverviewReport["series"][number];
type MonthlyEquivalentView = SupportOverviewEnvelope["data"]["monthlyEquivalent"][number];
type GoalStateView = NonNullable<SupportOverviewReport["goal"]>["state"];
/** A period as the surface states it: two civil dates, formatted for display and never re-derived. */
interface PeriodText {
  readonly from: string;
  readonly to: string;
}
// The surface's own wording. The family's measure names, chart captions, empty states and
// no-percentage sentences come from ../copy instead, so this file adds only what it alone states.
const SURFACE_TITLE = "Received support";
const SURFACE_LEDE =
  "Cash received on the one named basis this application measures, then the recurring outcomes that are " +
  "not cash and the committed measures kept separate from both. Every figure states its period, its " +
  "coverage and the instant it was read at, and a currency is never combined with another.";
const CASH_REGION_TITLE = "Cash received";
const CASH_REGION_LABEL = "Cash received in this period";
const CASH_UNIT = "received cash, one row per authorised allocation";
const GIFT_COUNT_LABEL = "Gifts";
const ALLOCATION_COUNT_LABEL = "Allocations";
const DONOR_COUNT_LABEL = "Donors";
const GRAIN_NOTE =
  "Each count is stated at its own grain and the three are never added together: a gift split between two " +
  "allocations is one gift, two allocations and one donor, and a view that legitimately holds both grain " +
  "levels counts the amount once.";
const RECURRING_NOT_CASH =
  "These are not received cash. Each occurrence the source reports sits in one of the five outcomes and is " +
  "counted at its own state, so a collection in flight is not cash, an absent receipt is not donor debt, and " +
  "no outcome here is added to an amount.";
const SECONDARY_REGION_TITLE = "Committed support";
const SECONDARY_REGION_LABEL = "Committed support and the goal it is read beside";
const SECONDARY_REGION_LEDE =
  "Commitments, committed amounts and the goal are measures of their own. They are read beside received " + "support and are never added to it, divided by it, or presented as one combined figure.";
const SECONDARY_TABS_LABEL = "Committed support and monthly equivalents";
const COMMITTED_TAB_LABEL = "Committed versus goal";
const MONTHLY_TAB_LABEL = "Monthly equivalents";
const COMMITMENTS_MEANING =
  "Commitments are facts the source reports and this application never writes. Each is counted in its own " + "kind and in its own outcome bucket, and no commitment is counted as cash.";
const MONTHLY_EQUIVALENT_MEANING =
  "Each monthly equivalent is the qualified source's own calculation for one commitment, in the currency " +
  "the source states it in. They are stated one by one and are never averaged or summed into one figure.";
/*
 * The one shortened tab label, kept short enough that the pill row fits a 320 CSS px viewport: the tab
 * list is a single non-wrapping row of pills, so two full measure names push the document wider than the
 * screen. The panel labels above keep their full wording, and each panel's own heading states the
 * measure it presents.
 */
const COMMITTED_TAB_TEXT = "Committed";
const GOAL_COMPARISON_LEAD =
  "The goal is compared with received support on the goal's own read, and its progress figure is stated once, " +
  "in the Support goal section below. It is never recomputed, re-rounded or capped here.";
const GOAL_STATED_ELSEWHERE = "A progress figure exists for this period and is stated in the Support goal section below, exactly as the " + "goal's own read computed it.";
const GOAL_UNSTATED = "This read states no goal, so there is no committed-versus-goal comparison to state and none is invented.";
const GOAL_UNAVAILABLE = "The source behind the goal could not be read, so no comparison is stated here. This is not a goal of zero " + "and no figure stands in its place.";
const GOAL_PAUSED = "The goal is paused, so no progress figure is stated for it and nothing is put in its place.";
const GOAL_ENDED = "The goal has ended, so no progress figure is stated for it; an ended goal never rewrites an earlier period.";
const GOAL_STATE_SENTENCE: Readonly<Record<GoalStateView, string>> = {
  value: GOAL_STATED_ELSEWHERE,
  zero: GOAL_STATED_ELSEWHERE,
  "no-goal": NO_PERCENTAGE["no-goal"],
  "no-percentage": NO_PERCENTAGE.default,
  incompatible: NO_PERCENTAGE["incompatible-measure"],
  paused: GOAL_PAUSED,
  ended: GOAL_ENDED,
  unavailable: GOAL_UNAVAILABLE,
};
const SERIES_LABEL: string = MEASURE_LABELS["received-gifts"];
const CHART_TITLE = "Received support by month";
const CHART_ALT = "Monthly received support, one plot per currency.";
const CHART_TAKEAWAY = "each month is drawn from the amount the source recorded in it, and a month it recorded nothing in is left " + "undrawn and named below rather than drawn at zero";
const TABLE_CAPTION = `${SERIES_LABEL} by month, one row per month and one column per currency: a month the source recorded ` + "nothing in states that rather than a zero.";
const MONTH_COLUMN_KEY = "month";
const MONTH_COLUMN_LABEL = "Month";
const CURRENCY_COLUMN_PREFIX = "currency:";
const MONTH_TEXT_LENGTH = 7;
const GAP_CELL_WORD = "No recorded value";
const NO_CURRENCY_TEXT = "no currency stated";
const PERIOD_LEAD = "Counted for";
const COVERAGE_TAIL = "coverage";
const DESTINATIONS_TITLE = "Read the whole ledger, the commitments and the four reports";
const DESTINATIONS_REGION = "Destinations";
const DESTINATIONS_NOTE = "Each destination reads the same report result as this overview, so a figure there repeats the figure " + "stated here rather than computing a second set of them.";
const LEDGER_HREF = "/support/gifts";
const COMMITMENTS_HREF = "/support/commitments";
const LEDGER_LINK_LABEL = "Read the whole gifts ledger";
const COMMITMENTS_LINK_LABEL = "Read the commitments";
const LOADING_TITLE = "Reading this period's support";
const LOADING_BODY = "One answer carries the report result, the recurring outcomes and the monthly equivalents, so no figure " + "is shown until that answer arrives.";
const READ_FAILED_TITLE = "The support read could not be completed";
const READ_UNAVAILABLE_TITLE = "The financial source could not be read";
const RETRY_LABEL = "Read this period again";
const DENIED_TITLE = "Support is not available in this scope";
const DENIED_BODY = "This read is refused for the context this session is acting in. The refusal is the same whether or not " + "records exist, so nothing here states a count, a title or a size.";
const UNKNOWN_DATE_TEXT = "a date this read did not state";

// Reading a value the read already decided
/**
 * The ISO text of a civil date this read carries.
 *
 * The same envelope reaches this component either as a JSON body — where a civil date is its ISO
 * string — or as a Server Component's forwarded envelope. Both answer with their ISO text, and a value
 * that answers with neither is reported as unstated rather than rendered as a made-up date.
 */
function civilDateText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value !== null && typeof value === "object") {
    const text = String(value);
    if (text !== "[object Object]") {
      return text;
    }
  }
  return UNKNOWN_DATE_TEXT;
}
/** The month a series point belongs to, as ISO year and month: sortable, unambiguous and direction-neutral. */
function monthText(bucketStart: unknown): string {
  const text = civilDateText(bucketStart);
  return text.length >= MONTH_TEXT_LENGTH ? text.slice(0, MONTH_TEXT_LENGTH) : text;
}
/** The period the read resolved, as the surface states it. */
function periodOf(report: SupportOverviewReport): PeriodText {
  return { from: civilDateText(report.snapshot.period.from), to: civilDateText(report.snapshot.period.to) };
}
/** Whether the period the read resolved has not closed, which every figure states as the *In progress* note. */
function isCurrentPeriodOf(report: SupportOverviewReport): boolean {
  return report.snapshot.period.state === "in-progress";
}
/**
 * The exact amount a stated value carries.
 *
 * A state whose rendering is text rather than an amount — unknown, withheld or unavailable — states no
 * minor units, so a zero stands in a field that formatter never reads: it is never a zero the surface
 * presents as a figure.
 */
function moneyOf(currency: string, stated: StatedAmount): Money {
  return { currency, minorUnits: stated.minorUnits ?? minorUnitsOf(0) };
}
/** The state the read recorded for one path, falling back to the state the member itself carries. */
function stateOf(envelope: SupportOverviewEnvelope, path: string, fallback: ValueState): ValueState {
  return envelope.valueStates[path] ?? fallback;
}
/**
 * The one word each count state adds beside its number, keyed by the envelope's union so a seventh state
 * cannot be invented or left worded by omission. `null` is a plain recorded value, which needs no word.
 */
const COUNT_STATE_NOTE: Readonly<Record<ValueState, string | null>> = {
  value: null,
  zero: "a recorded zero",
  unknown: "unknown",
  withheld: "withheld",
  unavailable: "source unavailable",
  "incomplete-subtotal": "counted over partial coverage",
};
/** The comparison statement the goal's own progress state supports, and no ratio this surface computes. */
function goalComparisonSentence(goal: SupportOverviewReport["goal"]): string {
  return goal === undefined ? GOAL_UNSTATED : GOAL_STATE_SENTENCE[goal.state];
}
// The monthly history, prepared for the one chart pattern
interface ChartPartition {
  readonly currency: string;
  readonly points: readonly RecurringPointView[];
  readonly byMonth: ReadonlyMap<string, RecurringPointView>;
}
/** The series split by currency: two currencies are never drawn as one line and never combined into one figure. */
function chartPartitions(series: readonly RecurringPointView[]): readonly ChartPartition[] {
  const order: string[] = [];
  const byCurrency = new Map<string, RecurringPointView[]>();
  for (const point of series) {
    const existing = byCurrency.get(point.currency);
    if (existing === undefined) {
      byCurrency.set(point.currency, [point]);
      order.push(point.currency);
    } else {
      existing.push(point);
    }
  }
  return order.map((currency) => {
    const points = byCurrency.get(currency) ?? [];
    const byMonth = new Map<string, RecurringPointView>();
    for (const point of points) {
      byMonth.set(monthText(point.bucketStart), point);
    }
    return { currency, points, byMonth };
  });
}
function chartPointsOf(partition: ChartPartition): readonly ChartPoint[] {
  return partition.points.map((point) => ({
    bucket: monthText(point.bucketStart),
    value: point.value.minorUnits,
    state: point.value.valueState,
    gap: point.gap,
  }));
}
function chartSeriesOf(partition: ChartPartition): ChartSeries {
  return { key: `${partition.currency}-received`, label: SERIES_LABEL, currency: partition.currency, points: chartPointsOf(partition) };
}
/** One cell of the chart's data table: the amount the source recorded, or the gap it recorded nothing in. */
function amountCell(value: StatedAmount, currency: string, gap: boolean, locale: string): string {
  if (gap && value.minorUnits === null) {
    return GAP_CELL_WORD;
  }
  return formatMinor(moneyOf(currency, value), value.valueState, locale).text;
}
/** The chart's own data-table alternative: the same series, month by month and currency by currency. */
function chartTable(partitions: readonly ChartPartition[], locale: string): ChartTable {
  const columns = [{ key: MONTH_COLUMN_KEY, label: MONTH_COLUMN_LABEL }, ...partitions.map((partition) => ({ key: `${CURRENCY_COLUMN_PREFIX}${partition.currency}`, label: partition.currency }))];
  const months: string[] = [];
  for (const partition of partitions) {
    for (const month of partition.byMonth.keys()) {
      if (!months.includes(month)) {
        months.push(month);
      }
    }
  }
  const rows = months.map((month) => {
    const row: Record<string, string> = { [MONTH_COLUMN_KEY]: month };
    for (const partition of partitions) {
      const point = partition.byMonth.get(month);
      row[`${CURRENCY_COLUMN_PREFIX}${partition.currency}`] = point === undefined ? GAP_CELL_WORD : amountCell(point.value, partition.currency, point.gap, locale);
    }
    return row;
  });
  return { caption: TABLE_CAPTION, columns, rows };
}
// The envelope a Server Component may forward
/**
 * The read this surface can render from the envelope a Server Component forwarded.
 *
 * A caller that hands over the read's own answer passes the outcome union, which is used unchanged; a
 * caller that hands over one envelope passes it only when it carries the three members this read
 * answers with, so an envelope from another read is never rendered as an overview and no figure is
 * invented in its place.
 */
function overviewReadOf(candidate: ReadEnvelope<unknown> | undefined): SupportOverviewRead | undefined {
  if (candidate === undefined) {
    return undefined;
  }
  const stated: unknown = candidate;
  if (isReadResult(stated)) {
    return stated as SupportOverviewRead;
  }
  return isOverviewEnvelope(stated) ? { kind: "envelope", envelope: stated } : undefined;
}
function isOverviewEnvelope(value: unknown): value is SupportOverviewEnvelope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (!("data" in value) || !("valueStates" in value) || !("coverage" in value) || !("asOf" in value)) {
    return false;
  }
  const { data } = value;
  return data !== null && typeof data === "object" && "report" in data && "monthlyEquivalent" in data && "buckets" in data && "commitmentKinds" in data;
}
const MONTHLY_EQUIVALENT_NO_TOTAL =
  "No combined monthly figure is stated: these equivalents belong to individual commitments, in the " +
  "currencies the source states them in, and summing them would state a number no source computed.";
/** The amount one monthly equivalent states, in the currency its own source states it in. */
function monthlyMoneyOf(entry: MonthlyEquivalentView): Money {
  return { currency: entry.amount.currency, minorUnits: entry.amount.minorUnits === null ? minorUnitsOf(0) : minorUnitsOf(entry.amount.minorUnits) };
}
// The small pieces every region reuses
function CountRow({ label, count, state }: { readonly label: string; readonly count: number; readonly state: ValueState }): ReactElement {
  const note = COUNT_STATE_NOTE[state];
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-1 font-medium">
        <bdi className="tabular-figures">{count}</bdi>
        {note === null ? null : <span className="text-xs font-normal text-muted-foreground">{note}</span>}
      </dd>
    </div>
  );
}
/** The period and coverage a count partition was read over, stated by every region that shows one. */
function PeriodNote({ period, coverage }: { readonly period: PeriodText; readonly coverage: CoverageState }): ReactElement {
  return (
    <p className="text-xs text-muted-foreground">
      {PERIOD_LEAD} <bdi>{period.from}</bdi> to <bdi>{period.to}</bdi>, over <bdi>{coverage}</bdi> {COVERAGE_TAIL}.
    </p>
  );
}
/** The three counts one currency's received support carries, each at its own grain. */
function CashCounts({ envelope, entry }: { readonly envelope: SupportOverviewEnvelope; readonly entry: CurrencySummaryView }): ReactElement {
  const path = `summary.${entry.currency}`;
  return (
    <div className="flex flex-col gap-1">
      <dl className="flex flex-wrap gap-x-4 gap-y-1">
        <CountRow label={GIFT_COUNT_LABEL} count={entry.giftCount.count} state={stateOf(envelope, `${path}.giftCount`, entry.giftCount.valueState)} />
        <CountRow label={ALLOCATION_COUNT_LABEL} count={entry.allocationCount.count} state={stateOf(envelope, `${path}.allocationCount`, entry.allocationCount.valueState)} />
        <CountRow label={DONOR_COUNT_LABEL} count={entry.donorCount.count} state={stateOf(envelope, `${path}.donorCount`, entry.donorCount.valueState)} />
      </dl>
      <p>{GRAIN_NOTE}</p>
    </div>
  );
}
// The regions, in the order the surface presents them
/** Cash first: one card per currency, because two currencies are never combined into one figure and no card aggregates them. */
function CashSummary({ envelope, locale }: { readonly envelope: SupportOverviewEnvelope; readonly locale: string }): ReactElement {
  const report = envelope.data.report;
  if (report.summary.length === 0) {
    return <StateNotice kind="empty" title={EMPTY_STATES.gifts.title} description={EMPTY_STATES.gifts.body} action={EMPTY_STATES.gifts.action} />;
  }
  const period = periodOf(report);
  const isCurrentPeriod = isCurrentPeriodOf(report);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {report.summary.map((entry) => (
        <MeasureCard
          key={entry.currency}
          measure="received-gifts"
          money={moneyOf(entry.currency, entry.received)}
          valueState={stateOf(envelope, `summary.${entry.currency}.received`, entry.received.valueState)}
          unit={CASH_UNIT}
          period={period}
          coverage={envelope.coverage}
          asOf={report.snapshot.asOf}
          isCurrentPeriod={isCurrentPeriod}
          locale={locale}
          emphasis="primary"
          detail={<CashCounts envelope={envelope} entry={entry} />}
        />
      ))}
    </div>
  );
}
/** The recurring outcomes, counted in their own buckets and never read as cash. */
function RecurringOutcomes({ envelope }: { readonly envelope: SupportOverviewEnvelope }): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>{MEASURE_LABELS["recurring-collection-outcomes"]}</h3>
        </CardTitle>
        <CardDescription>{RECURRING_NOT_CASH}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <PeriodNote period={periodOf(envelope.data.report)} coverage={envelope.coverage.state} />
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {envelope.data.buckets.map((bucket) => (
            <CountRow key={bucket.bucket} label={bucket.label} count={bucket.count} state={stateOf(envelope, `buckets.${bucket.bucket}.count`, bucket.valueState)} />
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{BUCKET_MEANING["outside-partition"]}</p>
      </CardContent>
    </Card>
  );
}
/** The three commitment kinds, each counted on its own. */
function CommitmentKinds({ envelope, period }: { readonly envelope: SupportOverviewEnvelope; readonly period: PeriodText }): ReactElement {
  return (
    <Card size="sm" className="bg-muted/40 ring-border">
      <CardHeader>
        <CardTitle>
          <h3>{MEASURE_LABELS.commitments}</h3>
        </CardTitle>
        <CardDescription>{COMMITMENTS_MEANING}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <PeriodNote period={period} coverage={envelope.coverage.state} />
        <dl className="grid gap-2 sm:grid-cols-3">
          {envelope.data.commitmentKinds.map((kind) => (
            <CountRow key={kind.kind} label={COMMITMENT_KIND_LABELS[kind.kind]} count={kind.count} state={stateOf(envelope, `commitmentKinds.${kind.kind}.count`, kind.valueState)} />
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
/** The monthly equivalents, one per commitment, never averaged and never summed. */
function MonthlyEquivalents({ envelope, period, locale }: { readonly envelope: SupportOverviewEnvelope; readonly period: PeriodText; readonly locale: string }): ReactElement {
  return (
    <Card size="sm" className="bg-muted/40 ring-border">
      <CardHeader>
        <CardTitle>
          <h3>{MEASURE_LABELS["monthly-equivalent-support"]}</h3>
        </CardTitle>
        <CardDescription>{MONTHLY_EQUIVALENT_MEANING}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <PeriodNote period={period} coverage={envelope.coverage.state} />
        <dl className="flex flex-col gap-2">
          {envelope.data.monthlyEquivalent.map((entry) => (
            <div key={entry.commitmentRowId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <dt className="min-w-0 break-words text-muted-foreground">
                <bdi className="mono-identifier">{entry.commitmentRowId}</bdi>
                <span className="ms-2 text-xs">{entry.cadence}</span>
              </dt>
              <dd>
                <AmountValue money={monthlyMoneyOf(entry)} valueState={stateOf(envelope, `monthlyEquivalent.${entry.commitmentRowId}.amount`, entry.amount.valueState)} locale={locale} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{MONTHLY_EQUIVALENT_NO_TOTAL}</p>
      </CardContent>
    </Card>
  );
}
/** The committed measures, kept visibly secondary and never combined with cash. */
function CommittedSupport({ envelope, locale }: { readonly envelope: SupportOverviewEnvelope; readonly locale: string }): ReactElement {
  const report = envelope.data.report;
  const period = periodOf(report);
  const hasCommitments = envelope.data.commitmentKinds.some((kind) => kind.count > 0);
  const hasMonthlyEquivalents = envelope.data.monthlyEquivalent.length > 0;
  return (
    <Tabs defaultValue="committed" className="min-w-0 gap-4">
      <TabsList aria-label={SECONDARY_TABS_LABEL} className="max-w-full">
        <TabsTrigger value="committed">{COMMITTED_TAB_TEXT}</TabsTrigger>
        <TabsTrigger value="monthly">{MONTHLY_TAB_LABEL}</TabsTrigger>
      </TabsList>
      <TabsContent value="committed" aria-label={COMMITTED_TAB_LABEL} className="flex flex-col gap-3">
        {hasCommitments ? (
          <CommitmentKinds envelope={envelope} period={period} />
        ) : (
          <StateNotice kind="empty" title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />
        )}
        <p className="max-w-prose text-sm text-muted-foreground">{GOAL_COMPARISON_LEAD}</p>
        <p className="max-w-prose text-sm">{goalComparisonSentence(report.goal)}</p>
      </TabsContent>
      <TabsContent value="monthly" aria-label={MONTHLY_TAB_LABEL} className="flex flex-col gap-3">
        {hasMonthlyEquivalents ? (
          <MonthlyEquivalents envelope={envelope} period={period} locale={locale} />
        ) : (
          <StateNotice kind="empty" title={EMPTY_STATES.commitments.title} description={EMPTY_STATES.commitments.body} action={EMPTY_STATES.commitments.action} />
        )}
      </TabsContent>
    </Tabs>
  );
}
/** The monthly history, drawn through the one chart pattern, whose own data table is its alternative. */
function MonthlyHistory({ report, locale }: { readonly report: SupportOverviewReport; readonly locale: string }): ReactElement {
  const partitions = chartPartitions(report.series);
  const partitionText = partitions.length === 0 ? NO_CURRENCY_TEXT : partitions.map((partition) => partition.currency).join(", ");
  return (
    <ChartFigure
      title={CHART_TITLE}
      summary={fillTemplate(CHART_CAPTIONS.summaryOpener, { series: SERIES_LABEL, currency: partitionText, takeaway: CHART_TAKEAWAY })}
      caption={CHART_ALT}
      kind="bar"
      series={partitions.map(chartSeriesOf)}
      units={fillTemplate(CHART_CAPTIONS.unit, { currency: partitionText })}
      coverage={report.snapshot.coverage}
      asOf={fillTemplate(CHART_CAPTIONS.asOf, { asOf: report.snapshot.asOf })}
      table={chartTable(partitions, locale)}
      locale={locale}
    />
  );
}
/** The destinations these figures lead to: the ledger, the commitments and the four fixed reports. */
function Destinations(): ReactElement {
  const linkClass = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <section aria-label={DESTINATIONS_REGION} className="flex flex-col gap-3">
      <h3>{DESTINATIONS_TITLE}</h3>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link href={LEDGER_HREF} className={linkClass}>
            {LEDGER_LINK_LABEL}
          </Link>
        </li>
        <li>
          <Link href={COMMITMENTS_HREF} className={linkClass}>
            {COMMITMENTS_LINK_LABEL}
          </Link>
        </li>
        {REPORT_ORDER.map((id) => (
          <li key={id}>
            <Link href={reportHref(id)} className={linkClass}>
              {REPORT_CATALOG[id].title}
            </Link>
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-xs text-muted-foreground">{DESTINATIONS_NOTE}</p>
    </section>
  );
}
// The surface
interface OverviewFiguresProps {
  readonly envelope: SupportOverviewEnvelope;
  readonly scope: Scope;
  readonly locale: string;
  readonly dir: "ltr" | "rtl" | undefined;
}
/** The whole answer, in the order the surface presents it: statement, cash, outcomes, committed measures, history, goal, destinations. */
function OverviewFigures({ envelope, scope, locale, dir }: OverviewFiguresProps): ReactElement {
  const report = envelope.data.report;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <SnapshotStatement
        basis={report.snapshot.basis}
        currencies={report.snapshot.currencies}
        period={periodOf(report)}
        coverage={envelope.coverage}
        asOf={report.snapshot.asOf}
        isCurrentPeriod={isCurrentPeriodOf(report)}
        locale={locale}
      />
      <section aria-label={CASH_REGION_LABEL} className="flex min-w-0 flex-col gap-3">
        <h3>{CASH_REGION_TITLE}</h3>
        <CashSummary envelope={envelope} locale={locale} />
      </section>
      <RecurringOutcomes envelope={envelope} />
      <section aria-label={SECONDARY_REGION_LABEL} className="flex min-w-0 flex-col gap-3">
        <h3>{SECONDARY_REGION_TITLE}</h3>
        <p className="max-w-prose text-sm text-muted-foreground">{SECONDARY_REGION_LEDE}</p>
        <CommittedSupport envelope={envelope} locale={locale} />
      </section>
      <MonthlyHistory report={report} locale={locale} />
      <GoalPanel scope={scope} locale={locale} dir={dir} />
      <Separator />
      <Destinations />
    </div>
  );
}
interface OverviewAnswerProps {
  readonly result: SupportOverviewRead | undefined;
  readonly error: Error | null;
  readonly retry: () => void;
  readonly scope: Scope;
  readonly locale: string;
  readonly dir: "ltr" | "rtl" | undefined;
}
/** The five answers this read can give, and the one figure set each of them renders. */
function OverviewAnswer({ result, error, retry, scope, locale, dir }: OverviewAnswerProps): ReactElement {
  const retryAction = { label: RETRY_LABEL, onClick: retry };
  if (result === undefined) {
    if (error === null) {
      return <StateNotice kind="loading" title={LOADING_TITLE} description={LOADING_BODY} loadingLines={6} />;
    }
    return <StateNotice kind="unavailable" title={READ_FAILED_TITLE} description={error.message} retry={retryAction} />;
  }
  if (result.kind === "denied") {
    return <StateNotice kind="denied" title={DENIED_TITLE} description={DENIED_BODY} reasonCode={result.denied.reasonCode} />;
  }
  if (result.kind === "unavailable") {
    return <StateNotice kind="unavailable" title={READ_UNAVAILABLE_TITLE} description={result.unavailable.guidance} source={result.unavailable.source} retry={retryAction} />;
  }
  return <OverviewFigures envelope={result.envelope} scope={scope} locale={locale} dir={dir} />;
}
/** The Support overview: one read's cash-first figures, its recurring outcomes, its committed measures and its destinations. */
export function SupportOverview({ scope, locale, dir, initialEnvelope, className }: SupportOverviewProps): ReactElement {
  const initialRead = useMemo(() => overviewReadOf(initialEnvelope), [initialEnvelope]);
  const query = useSupportOverview({ scope, initialEnvelope: initialRead });
  const retry = (): void => {
    void query.refetch();
  };
  return (
    <div dir={dir} className={cn("flex w-full min-w-0 flex-col gap-6", className)}>
      <header className="flex min-w-0 flex-col gap-2">
        <h2 className="font-heading text-xl font-semibold tracking-tight text-pretty wrap-anywhere">{SURFACE_TITLE}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{SURFACE_LEDE}</p>
      </header>
      <OverviewAnswer result={query.data} error={query.error} retry={retry} scope={scope} locale={locale} dir={dir} />
    </div>
  );
}
export default SupportOverview;
