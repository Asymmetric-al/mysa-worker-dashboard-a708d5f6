/**
 * One support measure, presented alone: its exact amount, the unit it counts, the period it belongs
 * to, the coverage behind it and the instant it was read at.
 */
import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import type { Money } from "@/modules/money/amount";
import type { SupportMeasure } from "@/modules/support/basis";
import { AS_OF_TEMPLATE, COVERAGE_TEMPLATES, IN_PROGRESS_NOTE, MEASURE_LABELS, fillTemplate } from "../copy";
import AmountValue from "./amount-value";
/** Props of {@link MeasureCard}. */
export type MeasureCardProps = {
  measure: SupportMeasure;
  money: Money;
  valueState: ValueState;
  unit: string;
  period: { from: string; to: string } | null;
  coverage: Coverage;
  asOf: string;
  isCurrentPeriod: boolean;
  locale: string;
  emphasis?: "primary" | "secondary";
  detail?: ReactNode;
  className?: string;
};
const REPORTS_RECEIVED_CASH: Readonly<Record<SupportMeasure, boolean>> = {
  "received-gifts": true,
  "recurring-collection-outcomes": true,
  commitments: false,
  "monthly-equivalent-support": false,
  "support-goal": false,
};
const NOT_RECEIVED_CASH_LABEL = "Not received cash";

const FACT_LABELS = {
  period: "Period",
  coverage: "Coverage",
  asOf: "As of",
} as const;
function coverageSentence(coverage: Coverage): string {
  const { from, to, state } = coverage;
  if (from === null || to === null || state === "unknown") {
    return COVERAGE_TEMPLATES.unknown;
  }
  return fillTemplate(COVERAGE_TEMPLATES[state], { from, to });
}
function Fact({ term, children }: { term: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
/** Presents one measure with its exact amount, unit, period, coverage and as-of; never combines it with another measure. */
export function MeasureCard({ measure, money, valueState, unit, period, coverage, asOf, isCurrentPeriod, locale, emphasis = "primary", detail, className }: MeasureCardProps): ReactElement {
  const secondary = emphasis === "secondary";
  const hasDetail = detail !== undefined && detail !== null;
  // Derived rather than hook-generated: the same measure in the same currency always yields the
  // same id, so the server render and the browser render agree and no `useId` is required.
  const headingId = `measure-card-${measure}-${money.currency}`;
  return (
    // A named section rather than a bare div: the heading names the region, so a screen-reader user
    // can reach "Received gifts" directly without a `role` attribute standing in for the element.
    <section aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <Card size={secondary ? "sm" : "default"} className={cn(secondary && "bg-muted/40 ring-border")}>
        <CardHeader>
          <CardTitle className={cn(secondary && "text-sm")}>
            <h3 id={headingId}>{MEASURE_LABELS[measure]}</h3>
          </CardTitle>
          {REPORTS_RECEIVED_CASH[measure] ? null : (
            <CardAction>
              <Badge variant="outline">{NOT_RECEIVED_CASH_LABEL}</Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <AmountValue money={money} valueState={valueState} locale={locale} emphasis={secondary ? "default" : "headline"} />
            <span className="text-sm text-muted-foreground">
              <bdi>{unit}</bdi>
            </span>
          </p>
          {hasDetail ? <div className="break-words text-sm text-muted-foreground">{detail}</div> : null}
          {isCurrentPeriod ? <p className="text-xs text-muted-foreground">{IN_PROGRESS_NOTE}</p> : null}
          <dl className="grid gap-1 text-xs text-muted-foreground">
            {period === null ? null : (
              <Fact term={FACT_LABELS.period}>
                <bdi>{`${period.from} – ${period.to}`}</bdi>
              </Fact>
            )}
            <Fact term={FACT_LABELS.coverage}>
              <bdi>{coverageSentence(coverage)}</bdi>
            </Fact>
            <Fact term={FACT_LABELS.asOf}>
              <bdi>{fillTemplate(AS_OF_TEMPLATE, { asOf })}</bdi>
            </Fact>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
export default MeasureCard;
