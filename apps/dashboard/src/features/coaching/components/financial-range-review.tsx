"use client";
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
export type SharedFinancialRange = { readonly from: CivilDate | string; readonly to: CivilDate | string; readonly currency: string; readonly money: Money | null; readonly valueState: ValueState; readonly coverage: Coverage; readonly asOf: string };
export type FinancialRangeReviewProps = { readonly range: SharedFinancialRange | null; readonly reviewedAt?: string | null; readonly reviewedByRole?: "worker" | null; readonly locale: string };
const STATE_LABELS: Readonly<Record<ValueState, string>> = { value: "Recorded amount", zero: "Genuine zero", unknown: "Unknown", withheld: "Withheld", unavailable: "Unavailable", "incomplete-subtotal": "Incomplete subtotal" };
const NUMERIC_STATES: ReadonlySet<ValueState> = new Set<ValueState>(["value", "zero", "incomplete-subtotal"]);
const FIELD_LABELS = { from: "Range from", to: "Range to", currency: "Currency", basis: "Basis", reviewed: "Reviewed" } as const;
const TERM_CLASS = "font-medium";
const ISO_VALUE_CLASS = "whitespace-nowrap";
const isoValue = (value: string): ReactElement => <bdi className={ISO_VALUE_CLASS}>{value}</bdi>;
const isoDay = (date: CivilDate | string): string => (typeof date === "string" ? date : serialiseCivilDate(date));
function coverageStatement(coverage: Coverage): ReactNode {
  switch (coverage.state) {
    case "complete":
      return "Complete coverage for this period.";
    case "partial":
      return COACHING_COPY.coachSubject.partial;
    case "unknown":
      return "Coverage for this range is unknown, so no figure is presented as a complete total.";
  }
}
function coverageBounds(coverage: Coverage): ReactNode {
  const { from, to } = coverage;
  if (from !== null && to !== null) {
    return (
      <>
        Coverage: {isoValue(from)} to {isoValue(to)}.
      </>
    );
  }
  if (from !== null) return <>Coverage starts {isoValue(from)}.</>;
  if (to !== null) return <>Coverage ends {isoValue(to)}.</>;
  return null;
}
const RangeCardHeader = (): ReactElement => (
  <CardHeader>
    <CardTitle>
      <h2 className="type-section-title">{FINANCIAL_RANGE_COPY.heading}</h2>
    </CardTitle>
    <CardDescription>{FINANCIAL_RANGE_COPY.purpose}</CardDescription>
  </CardHeader>
);
export function FinancialRangeReview({ range, reviewedAt, reviewedByRole, locale }: FinancialRangeReviewProps): ReactElement {
  if (range === null) {
    return (
      <Card dir="ltr">
        <RangeCardHeader />
        <CardContent className="flex flex-col items-start gap-2">
          <Badge variant="outline">Not shared</Badge>
          <p className="type-supporting break-words">No financial range shared yet. Choose dates and review them here before anything from Support becomes visible to your coach.</p>
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
      <RangeCardHeader />
      <CardContent className="flex flex-col gap-4">
        <figure className="flex flex-col gap-2">
          <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <span>Received support in this range</span>
            <Badge variant={carriesDigits ? "secondary" : "outline"}>{STATE_LABELS[range.valueState]}</Badge>
          </figcaption>
          <p className={cn("tabular-figures text-2xl font-semibold text-end break-words", carriesDigits ? null : "text-muted-foreground")}>
            {formatting === null ? (
              <>
                No amount shared
                <span className="sr-only">No amount was shared for this range.</span>
              </>
            ) : (
              <>
                <bdi>{formatting.text}</bdi>
                {formatting.accessibleLabel === formatting.text ? null : <span className="sr-only">{formatting.accessibleLabel}</span>}
              </>
            )}
          </p>
          <p className="type-supporting">
            {coverageStatement(range.coverage)}
            {bounds === null ? null : <span className="block">{bounds}</span>}
          </p>
          <p className="type-supporting">
            As of <bdi className={cn("mono-identifier", ISO_VALUE_CLASS)}>{range.asOf}</bdi>.
          </p>
        </figure>
        {range.valueState === "unavailable" ? <StateNotice kind="unavailable" title="Couldn’t load this financial range" description={FINANCIAL_RANGE_COPY.unavailable} headingLevel={3} /> : null}
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
            <data value={SUPPORT_BASIS}>Effective cash allocation</data>
          </dd>
          {reviewed === null ? null : (
            <>
              <dt className={TERM_CLASS}>{FIELD_LABELS.reviewed}</dt>
              <dd className="min-w-0 break-words">
                {reviewedByRole === "worker" ? "Reviewed by missionary at " : "Reviewed at "}
                <bdi className={cn("mono-identifier", ISO_VALUE_CLASS)}>{reviewed}</bdi>
              </dd>
            </>
          )}
        </dl>
        <section className="flex flex-col gap-1">
          <h3 className="type-subsection-title">How this figure is calculated</h3>
          <p className="type-supporting">{BASIS_DESCRIPTION}</p>
        </section>
        <p className="type-supporting">{FINANCIAL_RANGE_COPY.rangeStatement}</p>
        <Alert role={undefined}>
          <AlertTitle>What stays private</AlertTitle>
          <AlertDescription>{FINANCIAL_RANGE_COPY.exclusions}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
export default FinancialRangeReview;
