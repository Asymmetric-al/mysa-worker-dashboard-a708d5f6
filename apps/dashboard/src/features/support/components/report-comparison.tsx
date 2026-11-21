import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { ScrollRegion } from "@/components/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { ReportComparison as ComparisonResult, ReportResult } from "@/modules/support/report";
import { EMPTY_STATES, NO_PERCENTAGE, REPORT_COPY, type NoPercentageReason } from "../copy";
import AmountValue from "./amount-value";
export type ReportComparisonProps = { result: ReportResult; locale: string; dir?: "ltr" | "rtl"; className?: string };
type CurrencyFigure = ComparisonResult["perCurrency"][number];
type ContributorChange = ComparisonResult["contributorDeltas"][number];
type DifferenceDirection = CurrencyFigure["direction"];
type AttributionKind = NonNullable<ContributorChange["attribution"]>["kind"];
const DIRECTION_WORDS: Readonly<Record<DifferenceDirection, string>> = { increase: "Increased by", decrease: "Decreased by", unchanged: "Unchanged at" };
const FIELD_LABELS = { current: "This period", baseline: "Earlier period", difference: "Difference" } as const;
const COLUMN_HEADINGS = { contributor: "Contributor", change: "Change" } as const;
const ATTRIBUTION_LABELS: Readonly<Record<AttributionKind, string>> = { partner: "A partner the report names only by reference", anonymous: "Anonymous support", unresolved: "Support with no attribution stated" };
const NOT_LIKE_FOR_LIKE = { badge: "Not like-for-like", text: "The two periods are not the same number of days, so this difference sets a longer span against " + "a shorter one. The report states that rather than presenting the figures as an equal-elapsed " + "comparison." } as const;
const NOT_RECONCILED = {
  badge: "Contributors do not add up",
  text: "The contributor changes below and the difference do not agree exactly for at least one currency " + "in this comparison. The report says so instead of adding a balancing entry, so no figure on " + "this surface has been adjusted to make the list add up.",
} as const;
const NO_CONTRIBUTOR_CHANGE = "The report states no contributor change in this currency: a contributor whose amount is the same " + "in both periods is left out of this list rather than shown as a zero.";
const CHANGE_MEANING_NOTE =
  "A change here is a fact about the records of two periods, not about anyone's intention. A " + "contributor who gave in the earlier period and not in this one is an earlier-only contributor, " + "not a lost partner: this report names nobody as lost, ranks nobody and infers no motive from a " + "figure.";
function noPercentageReason(entry: CurrencyFigure): NoPercentageReason | "default" | null {
  if (entry.valueState === "unknown" || entry.valueState === "unavailable") return "unknown-denominator";
  if (entry.valueState === "withheld" || entry.baselineMinor === 0) return "default";
  return null;
}
function ContributorLabel({ change }: { readonly change: ContributorChange }): ReactElement {
  const partnerId = change.partnerId;
  if (partnerId !== undefined) {
    return (
      <>
        <span className="text-muted-foreground">{"Partner"} </span>
        <bdi className="mono-identifier">{partnerId}</bdi>
      </>
    );
  }
  return <>{ATTRIBUTION_LABELS[change.attribution?.kind ?? "unresolved"]}</>;
}
function civilDateText(date: ComparisonResult["current"]["from"]): string {
  return date.toString();
}
interface CurrencyPartitionProps {
  readonly entry: CurrencyFigure;
  readonly current: ComparisonResult["current"];
  readonly baseline: ComparisonResult["baseline"];
  readonly deltas: readonly ContributorChange[];
  readonly locale: string;
}
function CurrencyPartition({ entry, current, baseline, deltas, locale }: CurrencyPartitionProps): ReactElement {
  const headingId = `report-comparison-${entry.currency}`;
  const percentageReason = noPercentageReason(entry);
  const contributors = deltas.filter((change) => change.currency === entry.currency);
  return (
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
              <AmountValue money={{ currency: entry.currency, minorUnits: entry.currentMinor }} valueState={entry.valueState} locale={locale} />
            </dd>
            <dt className="font-medium">{FIELD_LABELS.baseline}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <bdi className="text-muted-foreground">
                {civilDateText(baseline.from)}
                {" – "}
                {civilDateText(baseline.to)}
              </bdi>
              <AmountValue money={{ currency: entry.currency, minorUnits: entry.baselineMinor }} valueState={entry.valueState} locale={locale} />
            </dd>
            <dt className="font-medium">{FIELD_LABELS.difference}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-muted-foreground">{DIRECTION_WORDS[entry.direction]}</span>
              <AmountValue money={{ currency: entry.currency, minorUnits: entry.differenceMinor }} valueState={entry.valueState} locale={locale} emphasis="headline" />
            </dd>
          </dl>
          {percentageReason === null ? null : <p className="min-w-0 break-words text-xs text-muted-foreground">{NO_PERCENTAGE[percentageReason]}</p>}
          {contributors.length === 0 ? (
            <p className="min-w-0 break-words text-sm text-muted-foreground">{NO_CONTRIBUTOR_CHANGE}</p>
          ) : (
            // The contributor table is the widest thing in a partition, so it is the one labelled scroll region: at phone
            // widths the columns scroll inside this region instead of being clipped by the card around it.
            <ScrollRegion label={`${REPORT_COPY.comparison.title} in ${entry.currency}, contributor changes, scrollable`}>
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
                    <TableRow key={`${change.currency}:${change.partnerId ?? change.attribution?.kind ?? "unresolved"}`}>
                      <TableHead scope="row" className="whitespace-normal break-words">
                        <ContributorLabel change={change} />
                      </TableHead>
                      <TableCell className="text-end">
                        <AmountValue money={{ currency: change.currency, minorUnits: change.minorUnits }} valueState={entry.valueState} locale={locale} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
/** Fixed report 4: the two periods of one query, per currency, as the signed difference the report computed plus the contributor changes that reconcile it; never a figure of its own. */
export function ReportComparison({ result, locale, dir, className }: ReportComparisonProps): ReactElement {
  const comparison = result.comparison;
  const rootClassName = cn("flex min-w-0 flex-col gap-6", className);
  if (comparison === undefined || comparison.perCurrency.length === 0) {
    const empty = EMPTY_STATES.reports;
    return (
      <div dir={dir} data-report="period-comparison" className={rootClassName}>
        <StateNotice kind="empty" title={empty.title} description={empty.body} action={{ label: empty.action.label, href: empty.action.href }} />
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
        <CurrencyPartition key={entry.currency} entry={entry} current={comparison.current} baseline={comparison.baseline} deltas={comparison.contributorDeltas} locale={locale} />
      ))}
      <p className="min-w-0 break-words text-xs text-muted-foreground">{CHANGE_MEANING_NOTE}</p>
    </div>
  );
}
export default ReportComparison;
