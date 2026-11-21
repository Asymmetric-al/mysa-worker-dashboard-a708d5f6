import type { ReactElement, ReactNode } from "react";
import StateNotice from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { ValueState } from "@/modules/data-service/envelope";
import type { CurrencySummary, ReportComparison, ReportResult } from "@/modules/support/report";
import { CHART_CAPTIONS, EMPTY_STATES, IN_PROGRESS_NOTE, NO_PERCENTAGE, REPORT_COPY, fillTemplate } from "../copy";
import AmountValue from "./amount-value";
type PeriodState = ReportResult["snapshot"]["period"];
type StatedAmount = CurrencySummary["received"];
type MonthPoint = ReportResult["series"][number];
type CurrencyChange = ReportComparison["perCurrency"][number];
type ContributorChange = ReportComparison["contributorDeltas"][number];
export type ReportReceivedProps = { readonly result: ReportResult; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const LABELS = {
  received: "Received in the period",
  period: "Period",
  comparison: "Compared with the preceding equal-elapsed period",
  earlierPeriod: "Earlier equal-elapsed period",
  difference: "Difference (this period minus the earlier one)",
  contributors: "Contributors that changed",
  months: "Each month of the period",
  month: "Month",
  amount: "Received support",
  amountWord: "Amount",
  inProgress: "In progress",
  unidentifiedCurrency: "Currency not identified",
} as const;
const MONTHLY_CAPTION = { lead: "one row per month of the period, in the order the months occur, at the authorised-allocation grain", gap: "a month the source does not cover is a gap rather than a zero" } as const;
const GAP_WORD = "No gift recorded — a gap, not a zero";
const NO_MONTH_WORD = "No month of this period is stated in this currency — each one is a gap, not a zero";
const NO_COMPARISON_NOTE = "No comparison is stated for this currency, because an amount of a currency with no minor-unit " + "exponent cannot be differenced.";
const DOES_NOT_RECONCILE_NOTE = "The contributor changes do not add up to this difference, and no balancing entry is invented to " + "hide it.";
const CHANGE_WORDS: Readonly<Record<CurrencyChange["direction"], string>> = { increase: "Higher than the earlier period", decrease: "Lower than the earlier period", unchanged: "Unchanged from the earlier period" };
const UNATTRIBUTED_WORD = "Unattributed source support";
const PARTNER_WORD = "Partner";
function partitionId(currency: string): string {
  return `report-received-${currency}`;
}
function civilDateText(date: PeriodState["from"]): string {
  return String(date);
}
function periodText(from: PeriodState["from"], to: PeriodState["to"]): string {
  return `${civilDateText(from)} – ${civilDateText(to)}`;
}
function monthText(point: MonthPoint): string {
  return periodText(point.bucketStart, point.bucketEnd);
}
function contributorValueState(change: CurrencyChange): ValueState {
  const state = change.valueState;
  return state === "unknown" || state === "incomplete-subtotal" ? state : "value";
}
interface StatedFigureProps {
  readonly amount: StatedAmount;
  readonly currency: string;
  readonly locale: string;
  readonly emphasis?: "default" | "headline";
}
function StatedFigure({ amount, currency, locale, emphasis = "default" }: StatedFigureProps): ReactElement {
  const minorUnits = amount.minorUnits;
  if (minorUnits === null) {
    return <StatusBadge label={LABELS.amountWord} valueState={amount.valueState} />;
  }
  return <AmountValue money={{ currency, minorUnits }} valueState={amount.valueState} locale={locale} emphasis={emphasis} />;
}
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-2">{children}</dd>
    </div>
  );
}
interface ComparisonBlockProps {
  readonly comparison: ReportComparison | undefined;
  readonly currency: string;
  readonly locale: string;
  readonly headingId: string;
}
function contributorName(delta: ContributorChange): ReactNode {
  const attribution = delta.attribution;
  if (attribution === undefined) return UNATTRIBUTED_WORD;
  switch (attribution.kind) {
    case "partner":
      return (
        <>
          {`${PARTNER_WORD} `}
          <bdi className="mono-identifier break-all">{attribution.partnerId}</bdi>
        </>
      );
    case "anonymous":
      return "Anonymous support";
    case "unresolved":
      return UNATTRIBUTED_WORD;
  }
}
function contributorKey(delta: ContributorChange): string {
  const attribution = delta.attribution;
  const identity = attribution === undefined ? "unstated" : attribution.kind === "partner" ? `${attribution.kind}:${attribution.partnerId}` : attribution.kind;
  return `${delta.currency}:${identity}`;
}
function noPercentageSentence(change: CurrencyChange): string | undefined {
  if (change.valueState === "unknown") return NO_PERCENTAGE["unknown-denominator"];
  return change.baselineMinor === 0 ? NO_PERCENTAGE.default : undefined;
}
function ComparisonBlock({ comparison, currency, locale, headingId }: ComparisonBlockProps): ReactElement {
  const heading = (
    <h4 id={headingId} className="font-medium">
      {LABELS.comparison}
    </h4>
  );
  const change = comparison === undefined ? undefined : comparison.perCurrency.find((entry) => entry.currency === currency);
  if (comparison === undefined || !comparison.equalElapsed || change === undefined) {
    const reason = comparison === undefined || change === undefined ? NO_COMPARISON_NOTE : "The two spans this result compared are not the same length, so no difference is drawn from them.";
    return (
      <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
        {heading}
        <p className="text-sm text-muted-foreground">{reason}</p>
      </section>
    );
  }
  const contributors = comparison.contributorDeltas.filter((delta) => delta.currency === currency);
  const contributorState = contributorValueState(change);
  const percentage = noPercentageSentence(change);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      {heading}
      <dl className="grid gap-2">
        <Fact label={LABELS.earlierPeriod}>
          <bdi className="text-sm text-muted-foreground">{periodText(comparison.baseline.from, comparison.baseline.to)}</bdi>
          <AmountValue money={{ currency, minorUnits: change.baselineMinor }} valueState={change.valueState} locale={locale} />
        </Fact>
        <Fact label={LABELS.difference}>
          <AmountValue money={{ currency, minorUnits: change.differenceMinor }} valueState={change.valueState} locale={locale} emphasis="headline" />
          <StatusBadge label={CHANGE_WORDS[change.direction]} />
        </Fact>
      </dl>
      {percentage === undefined ? null : <p className="text-sm text-muted-foreground">{percentage}</p>}
      {contributors.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">{LABELS.contributors}</p>
          <ul className="flex min-w-0 flex-col gap-2">
            {contributors.map((delta) => (
              <li key={contributorKey(delta)} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words">{contributorName(delta)}</span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <AmountValue money={{ currency, minorUnits: delta.minorUnits }} valueState={contributorState} locale={locale} />
                  <span className="text-sm text-muted-foreground">{delta.minorUnits > 0 ? "gave more in this period than in the earlier one." : "gave less in this period, or gave only in the earlier period — neither is a judgement about them."}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{comparison.reconciles ? "The contributor changes add up exactly to this difference." : DOES_NOT_RECONCILE_NOTE}</p>
        </div>
      )}
    </section>
  );
}
interface MonthlyTableProps {
  readonly months: readonly MonthPoint[];
  readonly currency: string;
  readonly locale: string;
  readonly headingId: string;
}
function MonthlyTable({ months, currency, locale, headingId }: MonthlyTableProps): ReactElement {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h4 id={headingId} className="font-medium">
        {LABELS.months}
      </h4>
      <Table>
        <TableCaption className="text-start">
          {`${REPORT_COPY.received.title} — `}
          <bdi>{currency}</bdi>
          {` — ${MONTHLY_CAPTION.lead}; ${MONTHLY_CAPTION.gap}.`}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{LABELS.month}</TableHead>
            <TableHead scope="col" className="text-end">
              {LABELS.amount}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {months.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="whitespace-normal text-muted-foreground">
                {NO_MONTH_WORD}
              </TableCell>
            </TableRow>
          ) : (
            months.map((point) => (
              <TableRow key={civilDateText(point.bucketStart)}>
                <TableCell className="whitespace-normal">
                  <bdi>{monthText(point)}</bdi>
                </TableCell>
                <TableCell className="text-end">{point.gap ? <span className="text-muted-foreground">{GAP_WORD}</span> : <StatedFigure amount={point.value} currency={currency} locale={locale} />}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}
interface CurrencyPartitionProps {
  readonly summary: CurrencySummary;
  readonly months: readonly MonthPoint[];
  readonly comparison: ReportComparison | undefined;
  readonly period: PeriodState;
  readonly locale: string;
}
function CurrencyPartition({ summary, months, comparison, period, locale }: CurrencyPartitionProps): ReactElement {
  const currency = summary.currency;
  const headingId = partitionId(currency);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="font-heading text-base font-medium">
          {`${REPORT_COPY.received.title} — `}
          <bdi>{currency}</bdi>
        </h3>
        {summary.exponent === undefined ? <StatusBadge label={LABELS.unidentifiedCurrency} tone="caution" /> : null}
      </div>
      <Card size="sm">
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="grid gap-2">
            <Fact label={LABELS.received}>
              <StatedFigure amount={summary.received} currency={currency} locale={locale} emphasis="headline" />
            </Fact>
            <Fact label={LABELS.period}>
              <bdi>{periodText(period.from, period.to)}</bdi>
            </Fact>
          </dl>
          <Separator />
          <ComparisonBlock comparison={comparison} currency={currency} locale={locale} headingId={`${headingId}-comparison`} />
        </CardContent>
      </Card>
      <MonthlyTable months={months} currency={currency} locale={locale} headingId={`${headingId}-months`} />
    </section>
  );
}
/** Received support for the period, month by month, with the equal-elapsed-period comparison. */
export function ReportReceived({ result, locale, dir, className }: ReportReceivedProps): ReactElement {
  const { summary, series, comparison, snapshot } = result;
  const currencies = summary.map((entry) => entry.currency);
  return (
    <div dir={dir} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {snapshot.period.state === "in-progress" ? (
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge label={LABELS.inProgress} tone="info" srPrefix={LABELS.period} />
          <span>{IN_PROGRESS_NOTE}</span>
        </p>
      ) : null}
      {currencies.length > 1 ? <p className="text-sm text-muted-foreground">{fillTemplate(CHART_CAPTIONS.unit, { currency: currencies.join(", ") })}</p> : null}
      {summary.length === 0 ? (
        <StateNotice kind="empty" title={EMPTY_STATES.gifts.title} description={EMPTY_STATES.gifts.body} action={EMPTY_STATES.gifts.action} headingLevel={3} />
      ) : (
        summary.map((entry) => <CurrencyPartition key={entry.currency} summary={entry} months={series.filter((point) => point.currency === entry.currency)} comparison={comparison} period={snapshot.period} locale={locale} />)
      )}
    </div>
  );
}
export default ReportReceived;
