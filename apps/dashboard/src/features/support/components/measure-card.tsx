import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { factFrame } from "@/components/fact-list";
import SectionCard from "@/components/section-card";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import type { Money } from "@/modules/money/amount";
import type { SupportMeasure } from "@/modules/support/basis";
import { AS_OF_TEMPLATE, COVERAGE_TEMPLATES, IN_PROGRESS_NOTE, MEASURE_LABELS, fillTemplate } from "../copy";
import AmountValue from "./amount-value";
export type MeasureCardProps = { measure: SupportMeasure; money: Money; valueState: ValueState; unit: string; period: { from: string; to: string } | null; coverage: Coverage; asOf: string; isCurrentPeriod: boolean; locale: string; emphasis?: "primary" | "secondary"; detail?: ReactNode; className?: string };
const REPORTS_RECEIVED_CASH: Readonly<Record<SupportMeasure, boolean>> = { "received-gifts": true, "recurring-collection-outcomes": true, commitments: false, "monthly-equivalent-support": false, "support-goal": false };
const FACT_LABELS = { period: "Period", coverage: "Coverage", asOf: "As of" } as const;
const coverageSentence = ({ from, to, state }: Coverage): string => (from === null || to === null || state === "unknown" ? COVERAGE_TEMPLATES.unknown : fillTemplate(COVERAGE_TEMPLATES[state], { from, to }));
const Fact = factFrame({ rowClassName: "flex flex-wrap items-baseline gap-x-1.5", termClassName: "font-medium", valueClassName: "min-w-0 break-words" });
/** Presents one measure with its exact amount, unit, period, coverage and as-of; never combines it with another measure. */ export function MeasureCard({ measure, money, valueState, unit, period, coverage, asOf, isCurrentPeriod, locale, emphasis = "primary", detail, className }: MeasureCardProps): ReactElement {
  const secondary = emphasis === "secondary";
  const hasDetail = detail !== undefined && detail !== null;
  const headingId = `measure-card-${measure}-${money.currency}`;
  return (
    <SectionCard
      title={MEASURE_LABELS[measure]}
      headingLevel={3}
      headingId={headingId}
      titleClassName={cn(secondary && "text-sm")}
      cardSize={secondary ? "sm" : "default"}
      cardClassName={cn(secondary && "bg-muted/40 ring-border")}
      contentClassName="flex min-w-0 flex-col gap-3"
      action={REPORTS_RECEIVED_CASH[measure] ? undefined : <Badge variant="outline">Not received cash</Badge>}
      region={{ id: headingId, className: cn("min-w-0", className) }}
    >
      <p className="flex flex-wrap items-baseline gap-x-2">
        <AmountValue money={money} valueState={valueState} locale={locale} emphasis={secondary ? "default" : "headline"} />
        <bdi className="text-sm text-muted-foreground">{unit}</bdi>
      </p>
      {hasDetail ? <div className="break-words text-sm text-muted-foreground">{detail}</div> : null}
      {isCurrentPeriod ? <p className="text-xs text-muted-foreground">{IN_PROGRESS_NOTE}</p> : null}
      <dl className="grid gap-1 text-xs text-muted-foreground">
        {period === null ? null : <Fact term={FACT_LABELS.period} value={<bdi>{`${period.from} – ${period.to}`}</bdi>} />}
        <Fact term={FACT_LABELS.coverage} value={<bdi>{coverageSentence(coverage)}</bdi>} />
        <Fact term={FACT_LABELS.asOf} value={<bdi>{fillTemplate(AS_OF_TEMPLATE, { asOf })}</bdi>} />
      </dl>
    </SectionCard>
  );
}
export default MeasureCard;
