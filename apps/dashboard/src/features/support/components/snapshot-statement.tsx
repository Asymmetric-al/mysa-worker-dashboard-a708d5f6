/**
 * The one statement of the snapshot a Support figure was read in: its basis, grain, currencies,
 * period, coverage and as-of instant.
 *
 * Why it exists. The overview, the ledger, the gift and commitment details, the four reports, the CSV
 * header set and the print view all describe one report result for one query and one snapshot, and
 * they agree in words only because one component states that snapshot once (AAP 0.8.8; criterion 1).
 * Every sentence here comes from `../copy`, which owns this family's wording: this file interpolates
 * values into those templates in a fixed order and writes no statement of its own, so no surface can
 * paraphrase the basis, the grain or the coverage and drift from the rule.
 *
 * What it never decides. `coverage`, `asOf` and `isCurrentPeriod` arrive from the read envelope and
 * are stated as given: nothing derives "current" from a clock or from a period end, nothing fills an
 * unstated coverage boundary with an assumed date, and nothing computes, rounds or formats an amount
 * — the currencies row states a partition of codes, never a figure. `incomplete-subtotal` is the
 * envelope's derived value state and is never chosen here.
 *
 * Text and structure only. This is a pure function of its props — no `"use client"` directive, no
 * hook, no state — so the server-rendered overview, the client-rendered ledger and the print region
 * produce identical text. That is also why the region is named with `aria-label` rather than a
 * generated id: `useId` would be a hook, and a fixed id would collide when two statements share a
 * page. Every interpolated identifier, currency code and date sits in a `<bdi>`, so a date in a
 * right-to-left block cannot reorder against its neighbours, and no bidi control character is added.
 */

import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { Coverage } from "@/modules/data-service/envelope";
import type { SupportBasis } from "@/modules/support/basis";

import {
  AS_OF_TEMPLATE,
  CHART_CAPTIONS,
  COVERAGE_TEMPLATES,
  IN_PROGRESS_NOTE,
  SUPPORT_BASIS_STATEMENT,
  SUPPORT_GRAIN_STATEMENT,
  templateSegments,
} from "../copy";

/** Props of {@link SnapshotStatement}. Every fact is supplied; none is derived here. */
export type SnapshotStatementProps = {
  /** The one named basis the read was computed on, passed through from the projection. */
  readonly basis: SupportBasis;
  /** The currency partition actually on screen; empty when the read states no currency. */
  readonly currencies: readonly string[];
  /** The civil dates (`YYYY-MM-DD`) the figures cover, or `null` when the read has no period. */
  readonly period: { readonly from: string; readonly to: string } | null;
  /** How much of the past the read covers, taken straight from the envelope. */
  readonly coverage: Coverage;
  /** The envelope's scenario instant: when the read was evaluated, not when the source changed. */
  readonly asOf: string;
  /** The envelope's judgement that the period has not closed; never inferred from `asOf`. */
  readonly isCurrentPeriod: boolean;
  /** The viewer's display locale, supplied by the route composition; never read from the host. */
  readonly locale: string;
  /** `screen` (default) or `print`, which only changes print-media typography. */
  readonly variant?: "screen" | "print";
  /** Caller-supplied classes, logical utilities only (`ms-*`, `text-end`). */
  readonly className?: string;
};

/** The two presentations of the same wording, taken from the prop instead of restated. */
type Variant = NonNullable<SnapshotStatementProps["variant"]>;

/**
 * The name of the region, so a screen-reader user can jump to the statement as a landmark. It names
 * the block and states no fact about the data.
 */
const REGION_LABEL = "Snapshot statement";

/**
 * The label of each fact, in the order the statement states them. A field name labels a fact; the
 * fact's wording is `../copy`'s, so these six short names are the only text this file contributes to
 * the statement and they claim nothing about what was read.
 */
const FIELD_LABELS = {
  basis: "Basis",
  grain: "Grain",
  period: "Period",
  currencies: "Currencies",
  coverage: "Coverage",
  asOf: "As of",
} as const;

/**
 * What a row states when the read supplies no value for a field at all — a `null` period, or no
 * currency in the result. It is a marker rather than a figure so an absent field is never read as a
 * zero, a blank or a dash, and it is deliberately not one of the five `ValueState` renderings: those
 * describe a value, and this describes the absence of the field itself.
 */
const NOT_STATED = "Not stated by this read";

/**
 * What a coverage template's `{from}`/`{to}` slot receives when the read recorded a state but no
 * boundary. `../copy` forbids filling a boundary with an assumed date, so the slot says the date is
 * unstated instead of borrowing the period's own bounds or today.
 */
const UNSTATED_BOUNDARY = "a date the source does not state";

/**
 * How each presentation is set. `print` adds print-media typography only, so the printed statement
 * keeps the screen's wording, order and structure word for word.
 */
const VARIANT_TYPOGRAPHY: Readonly<Record<Variant, string>> = {
  screen: "leading-relaxed",
  print: "leading-relaxed print:text-xs print:leading-snug print:break-inside-avoid",
};

/**
 * Renders a `../copy` template with every filled `{slot}` isolated in a `<bdi>`.
 *
 * The family's copy module owns the substitution rule, so this file does not split a template itself:
 * it takes the segments {@link templateSegments} returns and turns each one into a node. The wording is
 * preserved exactly, because a literal segment renders as its own text and only a slot becomes an
 * element — and that element is a `<bdi>`, so a date, a currency code or an identifier filled into a
 * right-to-left block cannot reorder against its neighbours. A slot this file has no value for keeps its
 * braces instead of vanishing, so a template that grew a new slot is visible rather than silently blank.
 */
function isolatedTemplate(template: string, values: Readonly<Record<string, string>>): ReactNode[] {
  const nodes: ReactNode[] = [];

  for (const [index, segment] of templateSegments(template, values).entries()) {
    if (typeof segment === "string") {
      nodes.push(segment);
      continue;
    }
    const { slot, value } = segment;
    nodes.push(value === undefined ? `{${slot}}` : <bdi key={index}>{value}</bdi>);
  }

  return nodes;
}

/**
 * The currency partition as one readable run, in the viewer's own list convention.
 *
 * `Intl.ListFormat` joins codes and does nothing else — it performs no arithmetic and no currency
 * formatting, because an amount is formatted only by `modules/money`. An unusable locale tag falls
 * back to a comma join: the codes are the fact, and the convention they are joined by is not, so a
 * bad tag must not break the statement.
 */
function listCurrencies(currencies: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(currencies);
  } catch {
    return currencies.join(", ");
  }
}

/**
 * States the grain, basis, currencies, period, coverage and as-of of the envelope it is given; never
 * decides any of them.
 */
export function SnapshotStatement({
  basis,
  currencies,
  period,
  coverage,
  asOf,
  isCurrentPeriod,
  locale,
  variant = "screen",
  className,
}: SnapshotStatementProps): ReactElement {
  const partition = listCurrencies(currencies, locale);
  const label = "font-medium";

  return (
    <section
      aria-label={REGION_LABEL}
      data-snapshot-statement={variant}
      className={cn("flex flex-col gap-2 text-sm", VARIANT_TYPOGRAPHY[variant], className)}
    >
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
        <dd className="min-w-0 break-words">
          {currencies.length === 0 ? (
            NOT_STATED
          ) : currencies.length === 1 ? (
            <bdi>{partition}</bdi>
          ) : (
            isolatedTemplate(CHART_CAPTIONS.unit, { currency: partition })
          )}
        </dd>

        <dt className={label}>{FIELD_LABELS.coverage}</dt>
        <dd className="min-w-0 break-words">
          {isolatedTemplate(COVERAGE_TEMPLATES[coverage.state], {
            from: coverage.from ?? UNSTATED_BOUNDARY,
            to: coverage.to ?? UNSTATED_BOUNDARY,
          })}
        </dd>

        <dt className={label}>{FIELD_LABELS.asOf}</dt>
        <dd className="min-w-0 break-words">{isolatedTemplate(AS_OF_TEMPLATE, { asOf })}</dd>
      </dl>

      {isCurrentPeriod ? <p className="min-w-0 break-words">{IN_PROGRESS_NOTE}</p> : null}
    </section>
  );
}

export default SnapshotStatement;
