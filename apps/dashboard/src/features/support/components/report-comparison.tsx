/**
 * Fixed report 4 — the period comparison: two periods per currency, stated as the signed difference
 * between them together with the contributor changes that reconcile it.
 *
 * Report 4 of the four fixed reports (AAP 0.8.1). Its job is the one the family's worked example
 * states: 5,000 received in one complete period and 4,600 in another is a 400 decrease. This file
 * presents that difference; it never produces it.
 *
 * It derives nothing. The report engine supplies both period totals, the signed difference, the
 * direction the difference points, the value state of every figure, `equalElapsed` and `reconciles`;
 * the contributor deltas arrive already reconciled with the difference. No subtraction, percentage,
 * ratio, average, conversion or reconciliation sum is performed here, and no figure is adjusted to
 * make a list add up — a comparison the report could not reconcile says so in words instead of
 * gaining a balancing entry. `@/modules/support/report` is imported as a type only: this file renders
 * the result it is handed and cannot become a second computation of it.
 *
 * Per currency, and never across currencies. The result partitions the comparison by currency
 * because no exchange rate exists in this application, so each partition is stated on its own and no
 * combined figure appears anywhere — not in a total, not in a caption, not in a percentage. A
 * currency this application holds no exponent for is absent from the comparison by construction and
 * remains a summary fact elsewhere; nothing here gives it an assumed precision.
 *
 * No percentage is invented. `ReportComparison` states a difference and its direction, not a share
 * of the earlier period, so this surface claims none: a `+`/`-` glyph never carries the meaning on
 * its own, and where a percentage could not exist the family's `NO_PERCENTAGE` sentence says which
 * condition failed. A zero earlier period renders that sentence — never an infinity, never a `0%`,
 * never a figure stood in its place.
 *
 * Contributors are listed, never ranked or blamed. The rows keep the order the report states, carry
 * the report's own sign, and are never summed here. The report omits a contributor whose amount did
 * not change, and its `ContributorDelta` carries no marker for a contributor present only in the
 * earlier period — only a partner or attribution reference, a currency and a signed amount — so this
 * file labels nobody "lost" and guesses no presence from a figure; the reading rule is instead
 * stated once in words beside the figures: a contributor who gave only in the earlier period is an
 * earlier-only contributor and not a lost partner, and a change in a figure says nothing about
 * anyone's intention.
 *
 * Five states stay five. Every figure renders through `AmountValue` with the value state the result
 * recorded for that currency's comparison, so a genuine zero, an unknown value, a withheld value, an
 * unavailable source and an incomplete subtotal keep their own words and marks; a contributor the
 * report leaves out is a gap in the list rather than a row of zeros.
 *
 * A pure function of its props: no `"use client"` directive, no hook, no state, no clock, no fetch
 * and no store, so the server render, a client render and a print region produce identical text.
 * Direction is the document's, applied with `dir` on the block; every date, currency code and opaque
 * reference sits in a `<bdi>` so a number or a leading zero cannot be reordered by a
 * mixed-direction neighbour. Headings nest under the report page's own heading, the contributor table
 * is captioned with the report, the currency and the grain, its header and row cells are scoped, the
 * contributor cell wraps rather than overflowing while an amount keeps its digits and its currency
 * code on one line, and there is no second horizontal scroll container and no
 * interactive control anywhere in the comparison body — the only control on the surface is the empty
 * state's navigation action, which is the family's one way forward.
 */

import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { ReportComparison as ComparisonResult, ReportResult } from "@/modules/support/report";

import { EMPTY_STATES, NO_PERCENTAGE, REPORT_COPY, type NoPercentageReason } from "../copy";
import AmountValue from "./amount-value";

/** Props of {@link ReportComparison}. */
export type ReportComparisonProps = {
  result: ReportResult;
  locale: string;
  dir?: "ltr" | "rtl";
  className?: string;
};

/**
 * One currency's part of the comparison, named once so the helpers below state a type instead of
 * repeating the indexed lookup. Derived from the report rather than restated, so a field the service
 * adds or renames reaches this file as a compile error.
 */
type CurrencyFigure = ComparisonResult["perCurrency"][number];

/** One contributor's change, derived from the report for the same reason. */
type ContributorChange = ComparisonResult["contributorDeltas"][number];

/** The three directions a difference can point, taken from the report instead of rewritten here. */
type DifferenceDirection = CurrencyFigure["direction"];

/** The attribution kinds a change can state, taken from the report's own attribution union. */
type AttributionKind = NonNullable<ContributorChange["attribution"]>["kind"];

/**
 * The visible words that state which way a difference points.
 *
 * The report already names the direction, so this map supplies only the wording: a reader never has
 * to decode a sign, and colour carries nothing. Every member is a preposition, so one sentence shape
 * holds for all three readings — "Decreased by 400.00 USD", "Unchanged at 0.00 USD".
 */
const DIRECTION_WORDS: Readonly<Record<DifferenceDirection, string>> = {
  increase: "Increased by",
  decrease: "Decreased by",
  unchanged: "Unchanged at",
};

/**
 * The three facts one partition states, in the order it states them. These are field names only; the
 * dates, the amounts and their states all come from the report.
 */
const FIELD_LABELS = {
  current: "This period",
  baseline: "Earlier period",
  difference: "Difference",
} as const;

/** The two column headings of the contributor table. A row's own name is its row header. */
const COLUMN_HEADINGS = {
  contributor: "Contributor",
  change: "Change",
} as const;

/** The visible prefix beside a partner's opaque reference, so the reference reads as one. */
const PARTNER_PREFIX = "Partner";

/**
 * How an attribution with no partner reference of its own is named.
 *
 * A partner row names its reference; anonymous support and support the source did not attribute state
 * themselves, because support that carries no partner identity must not be given one in order to
 * balance a list. The exhaustive `Record` over the attribution union means an attribution added later
 * fails to compile until someone decides how it reads.
 */
const ATTRIBUTION_LABELS: Readonly<Record<AttributionKind, string>> = {
  partner: "A partner the report names only by reference",
  anonymous: "Anonymous support",
  unresolved: "Support with no attribution stated",
};

/**
 * The statement shown when the report says the two spans are not the same length.
 *
 * `equalElapsed` is the report's judgement, not this file's, and the report refuses to present an
 * unequal comparison as an equal-elapsed one. The badge carries the warning in a word so the meaning
 * survives without colour, and the sentence states what the flag means for the figures below.
 */
const NOT_LIKE_FOR_LIKE = {
  badge: "Not like-for-like",
  text:
    "The two periods are not the same number of days, so this difference sets a longer span against " +
    "a shorter one. The report states that rather than presenting the figures as an equal-elapsed " +
    "comparison.",
} as const;

/**
 * The statement shown when the contributor changes do not add up to the difference for some currency.
 *
 * The report says so itself rather than inventing a balancing entry; this surface repeats the fact so
 * a reader does not try to reconcile the list by hand, and states plainly that no figure here was
 * adjusted to make the list fit.
 */
const NOT_RECONCILED = {
  badge: "Contributors do not add up",
  text:
    "The contributor changes below and the difference do not agree exactly for at least one currency " +
    "in this comparison. The report says so instead of adding a balancing entry, so no figure on " +
    "this surface has been adjusted to make the list add up.",
} as const;

/**
 * What the report states for a currency whose contributors all gave the same amount in both periods.
 *
 * The report omits an unchanged contributor rather than listing it at zero, so an empty list is the
 * omission rule and not a claim that nobody supports this ministry. Saying which is the case keeps a
 * gap from being read as an absence.
 */
const NO_CONTRIBUTOR_CHANGE =
  "The report states no contributor change in this currency: a contributor whose amount is the same " +
  "in both periods is left out of this list rather than shown as a zero.";

/**
 * The reading rule stated once beneath the figures.
 *
 * A change in received support is a fact about the records of two periods. It is not evidence of a
 * supporter's intention, and a contributor who appears only in the earlier period is not a lost
 * partner: this surface ranks nobody, predicts nobody and infers no motive from an amount.
 */
const CHANGE_MEANING_NOTE =
  "A change here is a fact about the records of two periods, not about anyone's intention. A " +
  "contributor who gave in the earlier period and not in this one is an earlier-only contributor, " +
  "not a lost partner: this report names nobody as lost, ranks nobody and infers no motive from a " +
  "figure.";

/**
 * Which no-percentage sentence a currency's comparison earns, or `null` when none is needed.
 *
 * `ReportComparison` states a difference and its direction, never a share of the earlier period, so a
 * sentence is added only where no share could exist — and it then says why, rather than leaving a
 * blank where a percentage would have been:
 *
 * - an unknown or unavailable earlier period supplies no denominator the source established, which is
 *   `unknown-denominator`;
 * - a recorded zero earlier period, and a withheld one this context may not use, supply no usable
 *   denominator, which is the goal-neutral `default`: a percentage needs a positive, known
 *   denominator, and where one does not exist nothing stands in its place.
 *
 * `zero-denominator`, `no-goal` and `incompatible-measure` are worded for the support goal, and
 * `zero-denominator` names the goal in its first clause. A period comparison holds no goal, so
 * reusing that sentence here would assert a fact this read never established; the goal-neutral
 * sentences of the same table are used instead, and the two figures themselves state the change.
 *
 * Where the earlier period is a stated positive amount the report states no percentage either, and no
 * sentence is added: the signed difference, its direction and the contributor changes are the whole
 * statement here, and this surface claims no share the report did not compute. Nothing in this
 * decision is arithmetic — the facts it reads are the report's own value state and whether the earlier
 * figure is zero.
 */
function noPercentageReason(entry: CurrencyFigure): NoPercentageReason | "default" | null {
  if (entry.valueState === "unknown" || entry.valueState === "unavailable") {
    return "unknown-denominator";
  }
  if (entry.valueState === "withheld" || entry.baselineMinor === 0) {
    return "default";
  }
  return null;
}

/**
 * Names one contributor without giving support an identity it does not have.
 *
 * A partner row renders its opaque reference inside a `<bdi>` with the identifier utility, so a
 * leading zero survives and a mixed-direction neighbour cannot reorder it; the record's display name
 * is deliberately not resolved here, because the comparison carries no name and a surface that can
 * read the partner record shows the name it read. Anonymous and unattributed support name their
 * attribution, never a partner.
 */
function ContributorLabel({ change }: { readonly change: ContributorChange }): ReactElement {
  const partnerId = change.partnerId;
  if (partnerId !== undefined) {
    return (
      <>
        <span className="text-muted-foreground">{PARTNER_PREFIX} </span>
        <bdi className="mono-identifier">{partnerId}</bdi>
      </>
    );
  }
  return <>{ATTRIBUTION_LABELS[change.attribution?.kind ?? "unresolved"]}</>;
}

/**
 * The civil date a comparison states, as the report supplies it.
 *
 * `ReportComparison` carries `Temporal.PlainDate` values, so a date is rendered through its own ISO
 * serialisation and nothing else: no locale format, no date library, no time zone and no calendar
 * arithmetic, which is what keeps a period boundary the source resolved from being re-derived here.
 * The family prints civil dates as `YYYY-MM-DD` — the snapshot statement prints its period the same
 * way — and a date that has already been serialised, as JSON has no calendar type, renders unchanged
 * through the same call.
 */
function civilDateText(date: ComparisonResult["current"]["from"]): string {
  return date.toString();
}

/**
 * Props of the one currency block: its figures, the two periods both partitions state alike, the
 * deltas the report holds for every currency, and the viewer's locale.
 *
 * The two periods live on the comparison rather than on a currency entry — the report compares the
 * same pair of periods for every currency it partitions — so they are passed in instead of being
 * restated per currency.
 */
interface CurrencyPartitionProps {
  readonly entry: CurrencyFigure;
  readonly current: ComparisonResult["current"];
  readonly baseline: ComparisonResult["baseline"];
  readonly deltas: readonly ContributorChange[];
  readonly locale: string;
}

/**
 * One currency's comparison: both periods with their exact figures, the signed difference with the
 * word for its direction, the no-percentage sentence where no share could exist, and the contributor
 * changes the report states for this currency.
 *
 * Every figure is passed through as the report supplied it. `entry.valueState` is the state the
 * report recorded for this currency's comparison figures — the same fact its value-state map holds
 * under `comparison.<currency>.current`, `.baseline` and `.difference` — and it is read from the
 * entry that carries the amounts so an amount can never be paired with another currency's state. The
 * contributor rows take that same state, because a delta is a comparison of two sums over the same
 * coverage and carries no state of its own.
 */
function CurrencyPartition({
  entry,
  current,
  baseline,
  deltas,
  locale,
}: CurrencyPartitionProps): ReactElement {
  // Derived rather than generated: one currency appears once in one comparison, so the server render
  // and a client render agree on the id and no `useId` hook is needed in a pure component.
  const headingId = `report-comparison-${entry.currency}`;
  const percentageReason = noPercentageReason(entry);
  const contributors = deltas.filter((change) => change.currency === entry.currency);

  return (
    // A named section: the heading names the region, so a screen-reader user can reach "Amounts in
    // USD" directly without a `role` attribute standing in for the element.
    <section aria-labelledby={headingId} className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId}>
              {"Amounts in "}
              <bdi>{entry.currency}</bdi>
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-start text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
            <dt className="font-medium">{FIELD_LABELS.current}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <bdi className="text-muted-foreground">
                {civilDateText(current.from)}
                {" – "}
                {civilDateText(current.to)}
              </bdi>
              <AmountValue
                money={{ currency: entry.currency, minorUnits: entry.currentMinor }}
                valueState={entry.valueState}
                locale={locale}
              />
            </dd>

            <dt className="font-medium">{FIELD_LABELS.baseline}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <bdi className="text-muted-foreground">
                {civilDateText(baseline.from)}
                {" – "}
                {civilDateText(baseline.to)}
              </bdi>
              <AmountValue
                money={{ currency: entry.currency, minorUnits: entry.baselineMinor }}
                valueState={entry.valueState}
                locale={locale}
              />
            </dd>

            <dt className="font-medium">{FIELD_LABELS.difference}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-muted-foreground">{DIRECTION_WORDS[entry.direction]}</span>
              <AmountValue
                money={{ currency: entry.currency, minorUnits: entry.differenceMinor }}
                valueState={entry.valueState}
                locale={locale}
                emphasis="headline"
              />
            </dd>
          </dl>

          {percentageReason === null ? null : (
            <p className="min-w-0 break-words text-xs text-muted-foreground">
              {NO_PERCENTAGE[percentageReason]}
            </p>
          )}

          {contributors.length === 0 ? (
            <p className="min-w-0 break-words text-sm text-muted-foreground">
              {NO_CONTRIBUTOR_CHANGE}
            </p>
          ) : (
            <Table>
              <TableCaption>
                {REPORT_COPY.comparison.title}
                {" — contributor changes in "}
                <bdi>{entry.currency}</bdi>
                {", one row per attribution."}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{COLUMN_HEADINGS.contributor}</TableHead>
                  <TableHead scope="col" className="text-end">
                    {COLUMN_HEADINGS.change}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributors.map((change) => (
                  <TableRow
                    key={`${change.currency}:${change.partnerId ?? change.attribution?.kind ?? "unresolved"}`}
                  >
                    {/* A row header rather than a cell: the contributor names the row's change, and
                        the cell wraps instead of overflowing so a long opaque reference never makes
                        the page scroll at a phone width. */}
                    <TableHead scope="row" className="whitespace-normal break-words">
                      <ContributorLabel change={change} />
                    </TableHead>
                    {/* The amount keeps the table's own single-line cell so a figure never breaks
                        between its digits and its currency code; the contributor column above wraps
                        instead, which is the column that can. */}
                    <TableCell className="text-end">
                      <AmountValue
                        money={{ currency: change.currency, minorUnits: change.minorUnits }}
                        valueState={entry.valueState}
                        locale={locale}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Fixed report 4: the two periods of one query, per currency, as the signed difference the report
 * computed plus the contributor changes that reconcile it; never a figure of its own.
 *
 * The body is written by {@link CurrencyPartition} once per currency in the result, in the order the
 * report partitions them. Between and around those blocks the component states only facts the report
 * itself declares — that the two spans are or are not the same length, that the contributor changes do
 * or do not reconcile — and one reading rule, so a difference is never read as a judgement of a
 * supporter. `EMPTY_STATES.reports` is the family's only report-surface empty wording and is used as
 * written: an absent comparison is the report with nothing to state, which is not a difference of
 * zero, and the empty state's action leads to a report that exists.
 */
export function ReportComparison({
  result,
  locale,
  dir,
  className,
}: ReportComparisonProps): ReactElement {
  const comparison = result.comparison;
  const rootClassName = cn("flex min-w-0 flex-col gap-6", className);

  if (comparison === undefined || comparison.perCurrency.length === 0) {
    const empty = EMPTY_STATES.reports;
    return (
      <div dir={dir} data-report="period-comparison" className={rootClassName}>
        <StateNotice
          kind="empty"
          title={empty.title}
          description={empty.body}
          action={{ label: empty.action.label, href: empty.action.href }}
        />
      </div>
    );
  }

  return (
    <div dir={dir} data-report="period-comparison" className={rootClassName}>
      {comparison.equalElapsed ? null : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
          <Badge variant="outline">{NOT_LIKE_FOR_LIKE.badge}</Badge>
          <span className="min-w-0 break-words">{NOT_LIKE_FOR_LIKE.text}</span>
        </p>
      )}
      {comparison.reconciles ? null : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
          <Badge variant="outline">{NOT_RECONCILED.badge}</Badge>
          <span className="min-w-0 break-words">{NOT_RECONCILED.text}</span>
        </p>
      )}

      {comparison.perCurrency.map((entry) => (
        <CurrencyPartition
          key={entry.currency}
          entry={entry}
          current={comparison.current}
          baseline={comparison.baseline}
          deltas={comparison.contributorDeltas}
          locale={locale}
        />
      ))}

      <p className="min-w-0 break-words text-xs text-muted-foreground">{CHANGE_MEANING_NOTE}</p>
    </div>
  );
}

export default ReportComparison;
