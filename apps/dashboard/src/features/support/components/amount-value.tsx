import type { ReactElement } from "react";
import { cn } from "@/lib/cn";
import type { ValueState } from "@/modules/data-service/envelope";
import type { Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
export type AmountValueProps = { readonly money: Money; readonly valueState: ValueState; readonly locale: string; readonly className?: string; readonly emphasis?: "default" | "headline" };
const EMPHASIS: Readonly<Record<NonNullable<AmountValueProps["emphasis"]>, string>> = { default: "text-sm", headline: "text-2xl font-semibold tracking-tight" };
/** Renders one exact minor-unit amount with the value state its read declared; performs no arithmetic, chooses no state and appends no coverage claim. */ export function AmountValue({ money, valueState, locale, className, emphasis = "default" }: AmountValueProps): ReactElement {
  const { text, accessibleLabel } = formatMinor(money, valueState, locale);
  return (
    <span className={cn("tabular-figures", EMPHASIS[emphasis], className)} title={accessibleLabel}>
      <bdi>{text}</bdi>
      {accessibleLabel === text ? null : <span className="sr-only">{accessibleLabel}</span>}
    </span>
  );
}
export default AmountValue;
