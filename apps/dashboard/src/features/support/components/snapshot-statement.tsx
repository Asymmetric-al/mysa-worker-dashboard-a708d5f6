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
type Variant = NonNullable<SnapshotStatementProps["variant"]>;
const FIELD_LABELS = { basis: "Basis", grain: "Grain", period: "Period", currencies: "Currencies", coverage: "Coverage", asOf: "As of" } as const;
const NOT_STATED = "Not stated by this read";
const UNSTATED_BOUNDARY = "a date the source does not state";
const VARIANT_TYPOGRAPHY: Readonly<Record<Variant, string>> = { screen: "type-body", print: "type-body print:text-xs print:leading-snug print:break-inside-avoid" };
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
    <section aria-label="Snapshot statement" data-snapshot-statement={variant} className={cn("flex flex-col gap-2", VARIANT_TYPOGRAPHY[variant], className)}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-start sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className={label}>{FIELD_LABELS.basis}</dt>
        <dd className="min-w-0 break-words">
          <data value={basis}>{SUPPORT_BASIS_STATEMENT}</data>
        </dd>
        <dt className={label}>{FIELD_LABELS.grain}</dt>
        <dd className="min-w-0 break-words">{SUPPORT_GRAIN_STATEMENT}</dd>
        <dt className={label}>{FIELD_LABELS.period}</dt>
        <dd className="min-w-0 break-words">
          {period === null ? (
            NOT_STATED
          ) : (
            <>
              <bdi>{period.from}</bdi> to <bdi>{period.to}</bdi>
            </>
          )}
        </dd>
        <dt className={label}>{FIELD_LABELS.currencies}</dt>
        <dd className="min-w-0 break-words">{currencies.length === 0 ? NOT_STATED : currencies.length === 1 ? <bdi>{partition}</bdi> : isolatedTemplate(CHART_CAPTIONS.unit, { currency: partition })}</dd>
        <dt className={label}>{FIELD_LABELS.coverage}</dt>
        <dd className="min-w-0 break-words">{isolatedTemplate(COVERAGE_TEMPLATES[coverage.state], { from: coverage.from ?? UNSTATED_BOUNDARY, to: coverage.to ?? UNSTATED_BOUNDARY })}</dd>
        <dt className={label}>{FIELD_LABELS.asOf}</dt>
        <dd className="min-w-0 break-words">{isolatedTemplate(AS_OF_TEMPLATE, { asOf })}</dd>
      </dl>
      {isCurrentPeriod ? <p className="type-supporting min-w-0 break-words">{IN_PROGRESS_NOTE}</p> : null}
    </section>
  );
}
export default SnapshotStatement;
