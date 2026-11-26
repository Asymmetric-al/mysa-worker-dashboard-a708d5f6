import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Coverage } from "@/modules/data-service/envelope";
import type { SupportBasis } from "@/modules/support/basis";
import { AS_OF_TEMPLATE, CHART_CAPTIONS, COVERAGE_TEMPLATES, IN_PROGRESS_NOTE, SUPPORT_BASIS_STATEMENT, SUPPORT_GRAIN_STATEMENT, templateSegments } from "../copy";
export type SnapshotStatementProps = {
  readonly basis: SupportBasis;
  readonly currencies: readonly string[];
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly isCurrentPeriod: boolean;
  readonly locale: string;
  readonly variant?: "screen" | "print";
  readonly className?: string;
};
const FIELD_LABELS = { basis: "Basis", grain: "Counting rule", period: "Period", currencies: "Currencies", coverage: "Coverage", asOf: "Updated" } as const;
const NOT_STATED = "Not specified";
const VARIANT_TYPOGRAPHY: Readonly<Record<NonNullable<SnapshotStatementProps["variant"]>, string>> = { screen: "text-xs leading-relaxed text-foreground", print: "type-body print:text-xs print:leading-snug print:break-inside-avoid" };
const isolatedTemplate = (template: string, values: Readonly<Record<string, string>>): ReactNode[] => templateSegments(template, values).map((segment, index) => (typeof segment === "string" ? segment : segment.value === undefined ? `{${segment.slot}}` : <bdi key={index}>{segment.value}</bdi>));
function listCurrencies(currencies: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(currencies);
  } catch {
    return currencies.join(", ");
  }
}
/** States the grain, basis, currencies, period, coverage and as-of of the envelope it is given; never decides any of them. */ export function SnapshotStatement({ basis, currencies, period, coverage, asOf, isCurrentPeriod, locale, variant = "screen", className }: SnapshotStatementProps): ReactElement {
  const partition = listCurrencies(currencies, locale);
  const label = "font-medium";
  return (
    <section
      aria-label="Snapshot statement"
      data-snapshot-statement={variant}
      className={cn("flex flex-col gap-2", variant === "screen" && "rounded-2xl border border-border/80 bg-surface-subtle px-4 py-3 shadow-xs print:rounded-none print:border-0 print:bg-transparent print:p-0 print:shadow-none", VARIANT_TYPOGRAPHY[variant], className)}
    >
      <dl className="grid grid-cols-1 gap-x-5 gap-y-1.5 text-start sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className={cn(label, "text-muted-foreground")}>{FIELD_LABELS.basis}</dt>
        <dd className="min-w-0 break-words">
          <data value={basis}>{SUPPORT_BASIS_STATEMENT}</data>
        </dd>
        <dt className={cn(label, "text-muted-foreground")}>{FIELD_LABELS.grain}</dt>
        <dd className="min-w-0 break-words">{SUPPORT_GRAIN_STATEMENT}</dd>
        <dt className={cn(label, "text-muted-foreground")}>{FIELD_LABELS.period}</dt>
        <dd className="min-w-0 break-words">
          {period === null ? (
            NOT_STATED
          ) : (
            <>
              <bdi>{period.from}</bdi> to <bdi>{period.to}</bdi>
            </>
          )}
        </dd>
        <dt className={cn(label, "text-muted-foreground")}>{FIELD_LABELS.currencies}</dt>
        <dd className="min-w-0 break-words">{currencies.length === 0 ? NOT_STATED : currencies.length === 1 ? <bdi>{partition}</bdi> : isolatedTemplate(CHART_CAPTIONS.unit, { currency: partition })}</dd>
        <dt className={cn(label, "text-muted-foreground")}>{FIELD_LABELS.coverage}</dt>
        <dd className="min-w-0 break-words">{isolatedTemplate(COVERAGE_TEMPLATES[coverage.state], { from: coverage.from ?? "an unspecified date", to: coverage.to ?? "an unspecified date" })}</dd>
        <dt className={cn(label, "text-muted-foreground")}>{FIELD_LABELS.asOf}</dt>
        <dd className="min-w-0 break-words">{isolatedTemplate(AS_OF_TEMPLATE, { asOf })}</dd>
      </dl>
      {isCurrentPeriod ? <p className="type-supporting min-w-0 border-t border-border/70 pt-2.5 break-words">{IN_PROGRESS_NOTE}</p> : null}
    </section>
  );
}
export default SnapshotStatement;
