"use client";
/**
 * The reviewed, fixed financial range a worker shares with a coach, stated once and never as a
 * drilldown.
 */
import type { ReactElement, ReactNode } from "react";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import type { Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { BASIS_DESCRIPTION, SUPPORT_BASIS } from "@/modules/support/basis";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, FINANCIAL_RANGE_COPY } from "../copy";
/** One reviewed financial range as a grant discloses it: a fixed period, its currency, and the single figure the read supplied for that currency — with the state that figure was read in and. */
export interface SharedFinancialRange {
  readonly from: CivilDate | string;
  readonly to: CivilDate | string;
  readonly currency: string;
  readonly money: Money | null;
  readonly valueState: ValueState;
  readonly coverage: Coverage;
  readonly asOf: string;
}
/** Props of {@link FinancialRangeReview}. */
export interface FinancialRangeReviewProps {
  readonly range: SharedFinancialRange | null;
  readonly reviewedAt?: string | null;
  readonly reviewedByRole?: "worker" | null;
  readonly locale: string;
}
const STATE_LABELS: Readonly<Record<ValueState, string>> = {
  value: "Recorded amount",
  zero: "Genuine zero",
  unknown: "Unknown",
  withheld: "Withheld",
  unavailable: "Unavailable",
  "incomplete-subtotal": "Incomplete subtotal",
};
const NUMERIC_STATES: ReadonlySet<ValueState> = new Set<ValueState>(["value", "zero", "incomplete-subtotal"]);

const FIGURE_LABEL = "Received support in this range";

const NO_AMOUNT_TEXT = "No amount shared";

const NO_AMOUNT_LABEL = "No amount was shared for this range. This is neither zero nor an unknown amount: the read supplied no figure at all.";

const NO_RANGE_SHARED =
  "No financial range has been shared with a coach yet. Choose the dates and review them on this page " + "first: nothing from your support view becomes readable to a coach until you do.";
const NO_RANGE_BADGE = "Not shared";

const BASIS_HEADING = "What this range measures";

const EXCLUSIONS_HEADING = "What this range does not show";

const UNAVAILABLE_HEADING = "This financial range cannot be read";

const FIELD_LABELS = {
  from: "Range from",
  to: "Range to",
  currency: "Currency",
  basis: "Basis",
  reviewed: "Reviewed",
} as const;
const TERM_CLASS = "font-medium";

const ISO_VALUE_CLASS = "whitespace-nowrap";

function isoValue(value: string): ReactElement {
  return <bdi className={ISO_VALUE_CLASS}>{value}</bdi>;
}
function isoDay(date: CivilDate | string): string {
  return typeof date === "string" ? date : serialiseCivilDate(date);
}
function coverageStatement(coverage: Coverage): ReactNode {
  switch (coverage.state) {
    case "complete":
      return "Coverage is complete for this period, so the figure is a complete total rather than a partial subtotal.";
    case "partial":
      return COACHING_COPY.coachSubject.partial;
    case "unknown":
      return "The source does not state how much of this range it covers, so no figure here is " + "presented as a complete total.";
  }
}
function coverageBounds(coverage: Coverage): ReactNode {
  const { from, to } = coverage;
  if (from !== null && to !== null) {
    return (
      <>
        Stated coverage runs from {isoValue(from)} to {isoValue(to)}.
      </>
    );
  }
  if (from !== null) {
    return <>Stated coverage starts at {isoValue(from)}, with no end the source states.</>;
  }
  if (to !== null) {
    return <>Stated coverage ends at {isoValue(to)}, with no start the source states.</>;
  }
  return null;
}
/** Renders the reviewed financial range a coach may read, under the one named support basis. */
export function FinancialRangeReview({ range, reviewedAt, reviewedByRole, locale }: FinancialRangeReviewProps): ReactElement {
  if (range === null) {
    return (
      <Card dir="ltr">
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-base font-medium">{FINANCIAL_RANGE_COPY.heading}</h2>
          </CardTitle>
          <CardDescription>{FINANCIAL_RANGE_COPY.purpose}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <Badge variant="outline">{NO_RANGE_BADGE}</Badge>
          <p className="text-sm break-words">{NO_RANGE_SHARED}</p>
        </CardContent>
      </Card>
    );
  }
  const formatting = range.money === null ? null : formatMinor(range.money, range.valueState, locale);
  const carriesDigits = formatting !== null && NUMERIC_STATES.has(range.valueState);
  const bounds = coverageBounds(range.coverage);
  const reviewed = reviewedAt ?? null;
  return (
    <Card dir="ltr">
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-base font-medium">{FINANCIAL_RANGE_COPY.heading}</h2>
        </CardTitle>
        <CardDescription>{FINANCIAL_RANGE_COPY.purpose}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <figure className="flex flex-col gap-2">
          <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <span>{FIGURE_LABEL}</span>
            <Badge variant={carriesDigits ? "secondary" : "outline"}>{STATE_LABELS[range.valueState]}</Badge>
          </figcaption>
          <p className={cn("tabular-figures text-2xl font-semibold text-end break-words", carriesDigits ? null : "text-muted-foreground")}>
            {formatting === null ? (
              <>
                {NO_AMOUNT_TEXT}
                <span className="sr-only">{NO_AMOUNT_LABEL}</span>
              </>
            ) : (
              <>
                <bdi>{formatting.text}</bdi>
                {formatting.accessibleLabel === formatting.text ? null : <span className="sr-only">{formatting.accessibleLabel}</span>}
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {coverageStatement(range.coverage)}
            {bounds === null ? null : <span className="block">{bounds}</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            As of <bdi className={cn("mono-identifier", ISO_VALUE_CLASS)}>{range.asOf}</bdi>, which is when these figures were read rather than when the source last changed.
          </p>
        </figure>
        {range.valueState === "unavailable" ? <StateNotice kind="unavailable" title={UNAVAILABLE_HEADING} description={FINANCIAL_RANGE_COPY.unavailable} headingLevel={3} /> : null}
        <Separator />
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className={TERM_CLASS}>{FIELD_LABELS.from}</dt>
          <dd className="min-w-0 break-words">{isoValue(isoDay(range.from))}</dd>
          <dt className={TERM_CLASS}>{FIELD_LABELS.to}</dt>
          <dd className="min-w-0 break-words">{isoValue(isoDay(range.to))}</dd>
          <dt className={TERM_CLASS}>{FIELD_LABELS.currency}</dt>
          <dd className="min-w-0 break-words">
            <bdi className="mono-identifier">{range.currency}</bdi>
          </dd>
          <dt className={TERM_CLASS}>{FIELD_LABELS.basis}</dt>
          <dd className="min-w-0 break-words">
            <data value={SUPPORT_BASIS}>
              <bdi className="mono-identifier">{SUPPORT_BASIS}</bdi>
            </data>
          </dd>
          {reviewed === null ? null : (
            <>
              <dt className={TERM_CLASS}>{FIELD_LABELS.reviewed}</dt>
              <dd className="min-w-0 break-words">
                {reviewedByRole === "worker" ? "By the worker at " : "At "}
                <bdi className={cn("mono-identifier", ISO_VALUE_CLASS)}>{reviewed}</bdi>
              </dd>
            </>
          )}
        </dl>
        <section className="flex flex-col gap-1">
          <h3 className="font-heading text-sm font-medium">{BASIS_HEADING}</h3>
          <p className="text-sm text-muted-foreground">{BASIS_DESCRIPTION}</p>
        </section>
        <p className="text-sm text-muted-foreground">{FINANCIAL_RANGE_COPY.rangeStatement}</p>
        <Alert role={undefined}>
          <AlertTitle>{EXCLUSIONS_HEADING}</AlertTitle>
          <AlertDescription>{FINANCIAL_RANGE_COPY.exclusions}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
export default FinancialRangeReview;
