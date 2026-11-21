/**
 * Fixed report 1: monthly and year-to-date received support, with the equal-elapsed-period comparison.
 *
 * What this layout is. It renders one `ReportResult` — the single computation `modules/support/report`
 * performs for one query and one snapshot — as the received-support report: the amount received over
 * the period, that period set against the equal number of days immediately before it, and every month
 * of the period stated as its own row. It is the on-screen member of the six artifacts that must
 * agree, so it renders the figures the result carries and derives none of them: the total here, the
 * chart series, the ledger rows, a drilldown, the CSV and the print view are one figure at six grains
 * (criterion 1), and they agree because nothing in this file computes, rounds, re-filters, re-sorts or
 * re-pages anything.
 *
 * What it refuses, deliberately. No call into the report engine and no runtime import from the support
 * report module: the result arrives as a prop, and the engine is imported for its types only. No
 * arithmetic of any kind — no sum, difference, ratio, percentage, average or currency conversion — so
 * the signed difference is the result's own `differenceMinor`, rendered with the sign it arrived with,
 * and no figure is ever recovered from another. No money formatting, because `AmountValue` is the
 * family's one formatter and this file must not become a second one. No clock read, no ambient locale
 * and no fetch, so the server render, the browser render and the print region produce identical text
 * for identical props.
 *
 * What it keeps apart. One block per currency and never a combined figure: no exchange rate exists in
 * this application, so adding EUR minor units to USD minor units would state a number nobody can
 * know, and the partition is the reason a reader can check any figure against its own currency. A
 * month the source does not cover is a gap row that says so, never a zero row, because a zero would
 * claim the source recorded nothing. A baseline of zero yields `NO_PERCENTAGE` in words, never an
 * infinity, a `0%` or a percentage of a zero. A contributor who gave less — or who gave only in the
 * earlier period — is named as that and never as a lost partner, and the direction of a change is
 * carried by a word beside the figure rather than by a colour.
 *
 * Nothing here is interactive. The report offers no control, no export trigger and no filter: the
 * frame around it owns the query, the export and the print action, and this layout owns the figures.
 * That is also why the table is not wrapped in a scroll container of its own — the application has
 * exactly one horizontal scroll port, the frame's labelled region, and a second `overflow-x-auto` here
 * would take the scrolling away from the element a keyboard user was told about (WCAG 1.4.10, 2.4.11).
 *
 * Text and structure only: a pure function of its props, with every heading nested under the frame's
 * report heading, every amount, date, currency code and opaque identifier isolated in `<bdi>` so a
 * right-to-left partition cannot reorder them, logical spacing utilities throughout, and no colour,
 * radius or shadow stated anywhere.
 */

import type { ReactElement, ReactNode } from "react";

import StateNotice from "@/components/state-notice";
// The application's one status vocabulary. A value state's word is a promise about what a figure is
// ("Unknown", "Withheld", "Incomplete subtotal"), so this surface reads the shared `StatusBadge`
// rather than retyping five words of its own; a second list would let the same fact be spelled two
// ways.
import StatusBadge from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { ValueState } from "@/modules/data-service/envelope";
import type { CurrencySummary, ReportComparison, ReportResult } from "@/modules/support/report";

import {
  CHART_CAPTIONS,
  EMPTY_STATES,
  IN_PROGRESS_NOTE,
  NO_PERCENTAGE,
  REPORT_COPY,
} from "../copy";
import AmountValue from "./amount-value";

// ---------------------------------------------------------------------------------------------
// The shapes this layout reads, taken from the result rather than restated
// ---------------------------------------------------------------------------------------------

/**
 * The period the result covers, with its state. Read from the snapshot so the two civil dates this
 * report prints are the ones the engine resolved and not a pair derived here.
 */
type PeriodState = ReportResult["snapshot"]["period"];

/** One stated amount: the exact minor units and the state that says what kind of value it is. */
type StatedAmount = CurrencySummary["received"];

/** One month of one currency's series: the bucket's civil days, its amount and whether it is a gap. */
type MonthPoint = ReportResult["series"][number];

/** One currency's part of the equal-elapsed comparison, including the signed difference. */
type CurrencyChange = ReportComparison["perCurrency"][number];

/**
 * One contributor's change between the two periods.
 *
 * The amount is signed and carries no value state of its own: a contributor delta inherits the state
 * of its currency's comparison, because that state is derived from coverage and a contributor is not
 * covered differently from the currency they gave in.
 */
type ContributorChange = ReportComparison["contributorDeltas"][number];

/** Props of {@link ReportReceived}. */
export type ReportReceivedProps = {
  /**
   * The one snapshot the frame produced. Every figure, period, state and currency on this surface is
   * read from it; nothing is re-read, re-filtered, re-sorted or re-aggregated here.
   */
  readonly result: ReportResult;
  /** The viewer's display locale, supplied by the route composition; never read from the host. */
  readonly locale: string;
  /** The direction belongs to the block, so a right-to-left locale flows through the whole report. */
  readonly dir?: "ltr" | "rtl";
  /** Layout classes for the report's place in the frame. Never a colour, radius or shadow. */
  readonly className?: string;
};

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

/**
 * The field names this report contributes.
 *
 * Only names live here. Everything that states what a figure means — the report's own title, the
 * in-progress note, the no-percentage sentences, the per-currency rule, the empty state — comes from
 * `../copy`, so this surface cannot paraphrase the family's wording and drift from the overview, the
 * ledger, the CSV header or the print view.
 */
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

/** The four grain facts the monthly table's caption states, in one sentence. */
const MONTHLY_CAPTION = {
  lead: "one row per month of the period, in the order the months occur, at the authorised-allocation grain",
  gap: "a month the source does not cover is a gap rather than a zero",
} as const;

/** The word a month the source recorded nothing in carries, so it never reads as a zero. */
const GAP_WORD = "No gift recorded — a gap, not a zero";

/** The same fact for a currency that has no month in the period at all, stated once for the table. */
const NO_MONTH_WORD =
  "No month of this period is stated in this currency — each one is a gap, not a zero";

/** Why a currency's comparison figures are absent from the result rather than zero. */
const NO_COMPARISON_NOTE =
  "No comparison is stated for this currency, because an amount of a currency with no minor-unit " +
  "exponent cannot be differenced.";

/** Why the comparison is not drawn: the engine reports whether the two spans are the same length. */
const NOT_EQUAL_ELAPSED_NOTE =
  "The two spans this result compared are not the same length, so no difference is drawn from them.";

/** What the contributor deltas do, and what they refuse to do when they do not reconcile. */
const RECONCILES_NOTE = "The contributor changes add up exactly to this difference.";
const DOES_NOT_RECONCILE_NOTE =
  "The contributor changes do not add up to this difference, and no balancing entry is invented to " +
  "hide it.";

/** How one contributor's change is described, by the sign the result supplied. */
const CONTRIBUTOR_MORE = "gave more in this period than in the earlier one.";
const CONTRIBUTOR_LESS =
  "gave less in this period, or gave only in the earlier period — neither is a judgement about them.";

/**
 * How a change reads in words, one entry per direction the result states.
 *
 * An exhaustive `Record` over the result's own union, so a direction added later fails to compile
 * until it is worded. None of the three says a decrease is a problem: a lower figure is a fact about
 * two periods, and a surface that coloured or flagged it would be making a claim about a supporter
 * that the evidence does not support.
 */
const CHANGE_WORDS: Readonly<Record<CurrencyChange["direction"], string>> = {
  increase: "Higher than the earlier period",
  decrease: "Lower than the earlier period",
  unchanged: "Unchanged from the earlier period",
};

/** How support that carries no partner identity is named, without borrowing an identity for it. */
const ANONYMOUS_WORD = "Anonymous support";
const UNATTRIBUTED_WORD = "Unattributed source support";
const PARTNER_WORD = "Partner";

// ---------------------------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------------------------

/** The element id that names a currency's partition; derived from the currency, never generated. */
function partitionId(currency: string): string {
  return `report-received-${currency}`;
}

/**
 * One civil date as the text a reader sees.
 *
 * The engine states its calendar days as `Temporal.PlainDate` values, which are objects and cannot be
 * rendered directly. Their ISO text is the honest form: a civil date has no zone, so it carries no
 * midnight, no offset and no locale-dependent ordering that could differ between two readers of the
 * same snapshot.
 */
function civilDateText(date: PeriodState["from"]): string {
  return String(date);
}

/** A period as one range, both ends civil and both ends stated. */
function periodText(from: PeriodState["from"], to: PeriodState["to"]): string {
  return `${civilDateText(from)} – ${civilDateText(to)}`;
}

/** One month bucket as a range, clipped by the engine to the period it belongs to. */
function monthText(point: MonthPoint): string {
  return periodText(point.bucketStart, point.bucketEnd);
}

/**
 * The state a contributor delta carries.
 *
 * A delta has no state of its own because the state is a property of coverage, not of the
 * contributor: over partial coverage every figure in the comparison is an incomplete subtotal, and
 * over unknown coverage none of them may be stated as a total. `zero` is mapped to `value` because a
 * comparison the engine called a zero has no deltas at all — and if one ever arrived, a zero state
 * would force the formatter to print `0` beside a figure that is not zero.
 */
function contributorValueState(change: CurrencyChange): ValueState {
  const state = change.valueState;
  return state === "unknown" || state === "incomplete-subtotal" ? state : "value";
}

/** Fills one `{placeholder}` slot in a copy template with a value the caller already holds. */
function fillTemplate(template: string, placeholder: string, value: string): string {
  return template.replace(`{${placeholder}}`, value);
}

// ---------------------------------------------------------------------------------------------
// One figure, and one fact about it
// ---------------------------------------------------------------------------------------------

/** Props of {@link StatedFigure}. */
interface StatedFigureProps {
  /** The amount and the state the result recorded for it; neither is chosen here. */
  readonly amount: StatedAmount;
  /** The currency the amount is stated in, which the figure carries beside its digits. */
  readonly currency: string;
  /** The viewer's display locale. */
  readonly locale: string;
  /** `headline` for the period's received figure; `default` everywhere else. */
  readonly emphasis?: "default" | "headline";
}

/**
 * One stated amount: its digits when the result carries a number, and the state's own word when it
 * does not.
 *
 * A `StatedValue` whose amount is absent is a value the source never established or a read whose
 * coverage is unknown, and it must not be rendered as `0`, as a blank cell or as a dash — so rather
 * than feeding the formatter an amount that does not exist, the state is named through the
 * application's one status vocabulary. Both spellings of the same fact therefore come from one place,
 * and `zero`, `unknown`, `withheld`, `unavailable` and `incomplete-subtotal` stay five renderings.
 */
function StatedFigure({
  amount,
  currency,
  locale,
  emphasis = "default",
}: StatedFigureProps): ReactElement {
  const minorUnits = amount.minorUnits;
  if (minorUnits === null) {
    return <StatusBadge label={LABELS.amountWord} valueState={amount.valueState} />;
  }
  return (
    <AmountValue
      money={{ currency, minorUnits }}
      valueState={amount.valueState}
      locale={locale}
      emphasis={emphasis}
    />
  );
}

/**
 * One named fact of the report: the name on the leading edge, the figure the result supplied on the
 * trailing edge, in the reading direction of the block.
 */
function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-2">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The equal-elapsed comparison
// ---------------------------------------------------------------------------------------------

/** Props of {@link ComparisonBlock}. */
interface ComparisonBlockProps {
  /** The comparison the result carries, or none when the engine stated no baseline. */
  readonly comparison: ReportComparison | undefined;
  /** The currency this partition states. */
  readonly currency: string;
  /** The viewer's display locale. */
  readonly locale: string;
  /** The id of this block's heading, which names the region. */
  readonly headingId: string;
}

/**
 * Names one contributor by the attribution the result supplied.
 *
 * A contributor is an attribution and never a name: the report projection carries no name, email
 * address or postal address, so a partner is named by its opaque reference — isolated and set in the
 * identifier utility so a leading zero survives — and support that carries no partner identity is
 * stated as anonymous or unattributed rather than being given an identity to balance a total.
 */
function contributorName(delta: ContributorChange): ReactNode {
  const attribution = delta.attribution;
  if (attribution === undefined) {
    return UNATTRIBUTED_WORD;
  }
  switch (attribution.kind) {
    case "partner":
      return (
        <>
          {`${PARTNER_WORD} `}
          <bdi className="mono-identifier break-all">{attribution.partnerId}</bdi>
        </>
      );
    case "anonymous":
      return ANONYMOUS_WORD;
    case "unresolved":
      return UNATTRIBUTED_WORD;
  }
}

/** A stable key for one contributor's delta: an attribution and a currency appear at most once. */
function contributorKey(delta: ContributorChange): string {
  const attribution = delta.attribution;
  const identity =
    attribution === undefined
      ? "unstated"
      : attribution.kind === "partner"
        ? `${attribution.kind}:${attribution.partnerId}`
        : attribution.kind;
  return `${delta.currency}:${identity}`;
}

/**
 * The baseline sentence beside one currency's change: why no percentage accompanies the difference.
 *
 * A percentage needs a compatible numerator and a positive, known denominator, and this application
 * manufactures neither. The two cases a reader can meet here are a baseline the source stated as zero
 * — a share of zero is undefined, so nothing is put in its place — and a baseline whose extent the
 * source never established, which cannot carry a percentage at all. Where the baseline is a known,
 * positive figure no sentence is added, because this report states a difference and not a
 * percentage, and the family's wording must not imply that one was withheld.
 */
function noPercentageSentence(change: CurrencyChange): string | undefined {
  if (change.valueState === "unknown") {
    return NO_PERCENTAGE["unknown-denominator"];
  }
  return change.baselineMinor === 0 ? NO_PERCENTAGE.default : undefined;
}

/**
 * The equal-elapsed comparison for one currency: the earlier period's figure, the signed difference
 * exactly as the engine computed it, and the contributor changes that reconcile it.
 *
 * Three facts and no fourth. This period's own figure and its civil dates are stated once, in the
 * partition above, so the comparison states the *earlier* span — with its dates, which is what lets a
 * reader see that the two spans are the same length rather than taking it on trust — and the
 * difference between the two. Nothing is subtracted here: `differenceMinor` arrives signed, and it is
 * rendered with that sign. When the engine reports that the two spans are not the same length, no
 * difference is drawn at all rather than being presented as a valid comparison.
 */
function ComparisonBlock({
  comparison,
  currency,
  locale,
  headingId,
}: ComparisonBlockProps): ReactElement {
  const heading = (
    <h4 id={headingId} className="font-medium">
      {LABELS.comparison}
    </h4>
  );

  const change =
    comparison === undefined
      ? undefined
      : comparison.perCurrency.find((entry) => entry.currency === currency);

  if (comparison === undefined || !comparison.equalElapsed || change === undefined) {
    const reason =
      comparison === undefined || change === undefined
        ? NO_COMPARISON_NOTE
        : NOT_EQUAL_ELAPSED_NOTE;
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
          <bdi className="text-sm text-muted-foreground">
            {periodText(comparison.baseline.from, comparison.baseline.to)}
          </bdi>
          <AmountValue
            money={{ currency, minorUnits: change.baselineMinor }}
            valueState={change.valueState}
            locale={locale}
          />
        </Fact>
        <Fact label={LABELS.difference}>
          <AmountValue
            money={{ currency, minorUnits: change.differenceMinor }}
            valueState={change.valueState}
            locale={locale}
            emphasis="headline"
          />
          <StatusBadge label={CHANGE_WORDS[change.direction]} />
        </Fact>
      </dl>
      {percentage === undefined ? null : (
        <p className="text-sm text-muted-foreground">{percentage}</p>
      )}
      {contributors.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">{LABELS.contributors}</p>
          <ul className="flex min-w-0 flex-col gap-2">
            {contributors.map((delta) => (
              <li
                key={contributorKey(delta)}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
              >
                <span className="min-w-0 break-words">{contributorName(delta)}</span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <AmountValue
                    money={{ currency, minorUnits: delta.minorUnits }}
                    valueState={contributorState}
                    locale={locale}
                  />
                  <span className="text-sm text-muted-foreground">
                    {delta.minorUnits > 0 ? CONTRIBUTOR_MORE : CONTRIBUTOR_LESS}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            {comparison.reconciles ? RECONCILES_NOTE : DOES_NOT_RECONCILE_NOTE}
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The monthly table
// ---------------------------------------------------------------------------------------------

/** Props of {@link MonthlyTable}. */
interface MonthlyTableProps {
  /** The month buckets this result states in one currency, in the order the engine produced them. */
  readonly months: readonly MonthPoint[];
  /** The currency every row is stated in; no row mixes two currencies. */
  readonly currency: string;
  /** The viewer's display locale. */
  readonly locale: string;
  /** The id of this block's heading, which names the region. */
  readonly headingId: string;
}

/**
 * Every month of the period as its own row, in one currency.
 *
 * The rows are the result's series points for this currency, in the order the months occur, and each
 * one states what the source recorded in that month. A month the source recorded nothing for is a gap
 * row that says so — never a `0` row and never an interpolated figure — because a zero would state a
 * fact the source never stated. The caption names the report, the currency and the grain, so a cell
 * lifted out of the table still says what it counts.
 *
 * No page window, no sort and no scroll container are applied here: the result's rows are the
 * authorised months of the query, the engine's order is the only order, and the application's single
 * horizontal scroll port belongs to the frame around this report.
 */
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
                <TableCell className="text-end">
                  {point.gap ? (
                    <span className="text-muted-foreground">{GAP_WORD}</span>
                  ) : (
                    <StatedFigure amount={point.value} currency={currency} locale={locale} />
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// One currency's partition
// ---------------------------------------------------------------------------------------------

/** Props of {@link CurrencyPartition}. */
interface CurrencyPartitionProps {
  /** One currency's part of the result: its received amount and the state it carries. */
  readonly summary: CurrencySummary;
  /** That currency's month buckets, already taken from the result's series. */
  readonly months: readonly MonthPoint[];
  /** The comparison the result carries, if any. */
  readonly comparison: ReportComparison | undefined;
  /** The period the result covers, taken from the snapshot and never re-resolved here. */
  readonly period: PeriodState;
  /** The viewer's display locale. */
  readonly locale: string;
}

/**
 * One currency's whole report: the amount received in the period, that period's equal-elapsed
 * comparison, and every month of it.
 *
 * The partition exists so that no figure ever crosses a currency boundary. Each block names its own
 * currency in its heading, states its own amount, comparison and months, and offers no other block's
 * total to add to — which is the only honest arrangement when this application holds no exchange
 * rate.
 */
function CurrencyPartition({
  summary,
  months,
  comparison,
  period,
  locale,
}: CurrencyPartitionProps): ReactElement {
  const currency = summary.currency;
  const headingId = partitionId(currency);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="font-heading text-base font-medium">
          {`${REPORT_COPY.received.title} — `}
          <bdi>{currency}</bdi>
        </h3>
        {summary.exponent === undefined ? (
          <StatusBadge label={LABELS.unidentifiedCurrency} tone="caution" />
        ) : null}
      </div>
      <Card size="sm">
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="grid gap-2">
            <Fact label={LABELS.received}>
              <StatedFigure
                amount={summary.received}
                currency={currency}
                locale={locale}
                emphasis="headline"
              />
            </Fact>
            <Fact label={LABELS.period}>
              <bdi>{periodText(period.from, period.to)}</bdi>
            </Fact>
          </dl>
          <Separator />
          <ComparisonBlock
            comparison={comparison}
            currency={currency}
            locale={locale}
            headingId={`${headingId}-comparison`}
          />
        </CardContent>
      </Card>
      <MonthlyTable
        months={months}
        currency={currency}
        locale={locale}
        headingId={`${headingId}-months`}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

/**
 * Received support for the period, month by month, with the equal-elapsed-period comparison.
 *
 * No fact is stated twice inside this layout. The result's period and its state belong to the
 * snapshot, so the in-progress note appears once above the partitions rather than beside every figure,
 * while each partition states the period the amount under it covers; and a partition states the
 * earlier equal-elapsed figure only, because its own figure and its own dates are already above it. The
 * currencies are partitioned rather than combined, and an empty result is rendered as the empty state
 * it is — a period with no gift in it, which is a different fact from a source that could not be read
 * and from a figure of zero.
 */
export function ReportReceived({
  result,
  locale,
  dir,
  className,
}: ReportReceivedProps): ReactElement {
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
      {currencies.length > 1 ? (
        <p className="text-sm text-muted-foreground">
          {fillTemplate(CHART_CAPTIONS.unit, "currency", currencies.join(", "))}
        </p>
      ) : null}
      {summary.length === 0 ? (
        <StateNotice
          kind="empty"
          title={EMPTY_STATES.gifts.title}
          description={EMPTY_STATES.gifts.body}
          action={EMPTY_STATES.gifts.action}
          headingLevel={3}
        />
      ) : (
        summary.map((entry) => (
          <CurrencyPartition
            key={entry.currency}
            summary={entry}
            months={series.filter((point) => point.currency === entry.currency)}
            comparison={comparison}
            period={snapshot.period}
            locale={locale}
          />
        ))
      )}
    </div>
  );
}

export default ReportReceived;
