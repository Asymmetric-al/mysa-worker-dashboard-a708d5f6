import type { ReactElement, ReactNode } from "react";
import { BanknoteIcon, ReceiptTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
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
const FACT_LABELS = { period: "Period", coverage: "Coverage", asOf: "Updated" } as const;
const Fact = factFrame({ rowClassName: "flex flex-wrap items-baseline gap-x-1.5", termClassName: "font-medium text-foreground/80", valueClassName: "min-w-0 break-words" });
/** Presents one measure with its exact amount, unit, period, coverage and as-of; never combines it with another measure. */ export function MeasureCard({ measure, money, valueState, unit, period, coverage, asOf, isCurrentPeriod, locale, emphasis = "primary", detail, className }: MeasureCardProps): ReactElement {
  const secondary = emphasis === "secondary";
  const headingId = `measure-card-${measure}-${money.currency}`;
  const isCash = REPORTS_RECEIVED_CASH[measure];
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2.5">
          <IconTile variant={isCash ? "positive" : "soft"} size="sm">
            {isCash ? <BanknoteIcon /> : <ReceiptTextIcon />}
          </IconTile>
          <span>{MEASURE_LABELS[measure]}</span>
        </span>
      }
      headingLevel={3}
      headingId={headingId}
      titleClassName={cn(secondary && "text-sm")}
      headerClassName="border-b border-border/70"
      cardVariant={secondary ? "soft" : "default"}
      contentClassName="flex min-w-0 flex-col gap-4"
      action={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Badge variant="outline" className="mono-identifier">
            {money.currency}
          </Badge>
          {isCash ? null : <Badge variant="secondary">Not received cash</Badge>}
        </div>
      }
      region={{ id: headingId, className: cn("min-w-0", className) }}
    >
      <p className="flex flex-wrap items-baseline gap-x-2.5">
        <AmountValue money={money} valueState={valueState} locale={locale} emphasis={secondary ? "default" : "headline"} />
        <bdi className="text-sm text-muted-foreground">{unit}</bdi>
      </p>
      {detail !== undefined && detail !== null ? <div className="break-words text-sm text-muted-foreground">{detail}</div> : null}
      {isCurrentPeriod ? <p className="text-xs text-muted-foreground">{IN_PROGRESS_NOTE}</p> : null}
      <dl className="grid gap-1.5 rounded-xl border border-border/70 bg-surface-subtle p-3 text-xs text-muted-foreground">
        {period === null ? null : <Fact term={FACT_LABELS.period} value={<bdi>{`${period.from} – ${period.to}`}</bdi>} />}
        <Fact term={FACT_LABELS.coverage} value={<bdi>{(({ from, to, state }: Coverage): string => (from === null || to === null || state === "unknown" ? COVERAGE_TEMPLATES.unknown : fillTemplate(COVERAGE_TEMPLATES[state], { from, to })))(coverage)}</bdi>} />
        <Fact term={FACT_LABELS.asOf} value={<bdi>{fillTemplate(AS_OF_TEMPLATE, { asOf })}</bdi>} />
      </dl>
    </SectionCard>
  );
}
export default MeasureCard;
