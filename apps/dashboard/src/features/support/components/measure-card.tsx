/**
 * One support measure, presented alone: its exact amount, the unit it counts, the period it
 * belongs to, the coverage behind it and the instant it was read at.
 *
 * One card per measure, and nothing else. Received gifts, recurring collection outcomes,
 * commitments, monthly-equivalent support and the support goal measure five different facts, and
 * this application never adds them into a "total support" (AAP 0.8.1), so a card receives one
 * `measure`, one amount and one value state, renders them, and offers no total, no sparkline, no
 * trend arrow and no comparison the envelope did not compute. The heading is `MEASURE_LABELS`'s
 * entry for that measure, so the five measure names have exactly one spelling in the family.
 *
 * It derives nothing. No sum, difference, percentage, average, monthly equivalent or currency
 * conversion is computed here, and the amount is rendered through `AmountValue`, the family's one
 * formatter. `valueState` arrives from the read envelope's `valueStates`, so a genuine zero, an
 * unknown value, a withheld value, an unavailable source and an incomplete subtotal keep five
 * distinct renderings instead of collapsing into a figure — and an amount whose currency has no
 * exponent stays an unknown-currency fact rather than acquiring a code it does not have.
 *
 * Cash stays apart from everything that is not cash. A commitment is never received money and a
 * monthly-equivalent figure is the source's own qualification rather than a division of gifts, so
 * every measure that does not report received cash carries a visible "not received cash" word —
 * text, never colour alone — and, when the parent composes it as the secondary comparison, a
 * quieter surface and a smaller heading than the cash figures.
 *
 * Facts are stated once. The unit stands beside the amount as its label, while the definition list
 * carries the three facts the envelope supplies — period, coverage and as-of — so no fact is
 * printed twice. Where the envelope states no period, the period row is absent rather than filled
 * with a boundary the read never named. The full basis and grain statement belongs to the page's
 * snapshot statement and is deliberately not repeated here.
 *
 * A pure function of its props: no `"use client"`, no hook, no state, no clock and no fetch, so the
 * server render, the client render and the print region produce identical text. Direction comes
 * from the block it sits in, every amount and every interpolated date or currency code is
 * `<bdi>`-isolated, and every class is a design-system or spacing token — never a colour literal.
 */

import type { ReactElement, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import type { Money } from "@/modules/money/amount";
import type { SupportMeasure } from "@/modules/support/basis";

import {
  AS_OF_TEMPLATE,
  COVERAGE_TEMPLATES,
  IN_PROGRESS_NOTE,
  MEASURE_LABELS,
  fillTemplate,
} from "../copy";
import AmountValue from "./amount-value";

/** Props of {@link MeasureCard}. */
export type MeasureCardProps = {
  /** The one measure this card presents. Keys `MEASURE_LABELS`; it decides the heading and nothing else. */
  measure: SupportMeasure;
  /** The exact amount: an integer count of `currency`'s minor units. Never recomputed here. */
  money: Money;
  /** The state the read recorded for this amount, taken from `envelope.valueStates` and never chosen here. */
  valueState: ValueState;
  /** What the amount counts — "gifts received", "recurring collections" — in the family's wording. */
  unit: string;
  /** The civil dates this measure covers, or `null` when the read states no period for it. */
  period: { from: string; to: string } | null;
  /** How much of the period the source holds, which the coverage sentence states in words. */
  coverage: Coverage;
  /** The scenario instant this read was evaluated at, which is not when the source last changed. */
  asOf: string;
  /** The envelope's judgement that the period is still running. Never derived from a date here. */
  isCurrentPeriod: boolean;
  /** The viewer's display locale, from the route composition; never read from the host. */
  locale: string;
  /** `primary` for the cash figures; `secondary` for the quieter committed-versus-goal comparison. */
  emphasis?: "primary" | "secondary";
  /** An already-composed supporting line the parent supplies. Never used to add a second amount. */
  detail?: ReactNode;
  /** Layout classes for the card's place in the overview. Never a colour, radius or shadow. */
  className?: string;
};

/**
 * Which measures report received cash. The two that do are the cash-first summary; the other three
 * are not cash and each says so in the card. An exhaustive `Record` over the measure union, so a
 * measure added later fails to compile until someone decides which side of this line it falls on.
 */
const REPORTS_RECEIVED_CASH: Readonly<Record<SupportMeasure, boolean>> = {
  "received-gifts": true,
  "recurring-collection-outcomes": true,
  commitments: false,
  "monthly-equivalent-support": false,
  "support-goal": false,
};

/**
 * The visible qualifier a non-cash measure always shows. A commitment, a monthly equivalent and a
 * goal are figures a reader could otherwise mistake for money that arrived, so the distinction is
 * carried in words beside the amount rather than by a tone or a position.
 */
const NOT_RECEIVED_CASH_LABEL = "Not received cash";

/** The terms of the definition list, names only — the facts themselves come from the read. */
const FACT_LABELS = {
  period: "Period",
  coverage: "Coverage",
  asOf: "As of",
} as const;

/**
 * The coverage sentence for the state this read recorded.
 *
 * The sentences that name a range interpolate both boundaries, so a state that claims a range the
 * envelope did not supply falls back to the `unknown` sentence: naming a boundary the source never
 * stated would assert a date, and no date is worth inventing for a caption.
 */
function coverageSentence(coverage: Coverage): string {
  const { from, to, state } = coverage;
  if (from === null || to === null || state === "unknown") {
    return COVERAGE_TEMPLATES.unknown;
  }
  return fillTemplate(COVERAGE_TEMPLATES[state], { from, to });
}

/** One term and its fact, so a row of the definition list is one line at the call site. */
function Fact({ term, children }: { term: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * Presents one measure with its exact amount, unit, period, coverage and as-of; never combines it
 * with another measure.
 */
export function MeasureCard({
  measure,
  money,
  valueState,
  unit,
  period,
  coverage,
  asOf,
  isCurrentPeriod,
  locale,
  emphasis = "primary",
  detail,
  className,
}: MeasureCardProps): ReactElement {
  const secondary = emphasis === "secondary";
  const hasDetail = detail !== undefined && detail !== null;
  // Derived rather than hook-generated: the same measure in the same currency always yields the
  // same id, so the server render and the browser render agree and no `useId` is required.
  const headingId = `measure-card-${measure}-${money.currency}`;

  return (
    // A named section rather than a bare div: the heading names the region, so a screen-reader user
    // can reach "Received gifts" directly without a `role` attribute standing in for the element.
    <section aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <Card
        size={secondary ? "sm" : "default"}
        className={cn(secondary && "bg-muted/40 ring-border")}
      >
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
            <AmountValue
              money={money}
              valueState={valueState}
              locale={locale}
              emphasis={secondary ? "default" : "headline"}
            />
            <span className="text-sm text-muted-foreground">
              <bdi>{unit}</bdi>
            </span>
          </p>
          {hasDetail ? (
            <div className="break-words text-sm text-muted-foreground">{detail}</div>
          ) : null}
          {isCurrentPeriod ? (
            <p className="text-xs text-muted-foreground">{IN_PROGRESS_NOTE}</p>
          ) : null}
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
