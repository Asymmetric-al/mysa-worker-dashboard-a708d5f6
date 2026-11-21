/**
 * The one way an amount reaches a Support screen.
 *
 * `AmountValue` renders one exact minor-unit amount together with the `ValueState` the read that
 * produced it recorded, and it does nothing besides: it formats through `modules/money/format`
 * exactly once, and it decides no state, performs no arithmetic and substitutes no placeholder.
 *
 * Those three refusals are the point. A component that tested `minorUnits === 0` could not tell a
 * genuine zero from an unknown amount; one that printed "—" for a missing figure would make an
 * unavailable source look like an empty cell; and one that derived a figure from another would let
 * a withheld amount be recovered by subtraction. Because the state arrives from the read envelope
 * and is only formatted here, `zero`, `unknown`, `withheld`, `unavailable` and
 * `incomplete-subtotal` stay five distinct renderings on every surface — card, tooltip, table
 * cell, matrix cell, drilldown, commitment and print line — and the screen, the chart's table
 * alternative, the CSV and the print view cannot drift from one another.
 *
 * The digits sit in `<bdi>`: a number is direction-weak, so without isolation an amount in a
 * right-to-left table would be reordered against its currency code. Nothing here states an
 * alignment, a colour or a bidi control character — direction belongs to the block the figure sits
 * in, and end-alignment comes from the caller through `className` with logical utilities.
 *
 * There is no `"use client"` directive: the file is a pure function of its props, so the
 * server-rendered overview, the client-rendered ledger and the print region produce identical
 * text. `plain`, the formatter's third member, is the machine-stable form for a CSV cell and the
 * print model, so it is deliberately not rendered here — a display cell shows the locale-formatted
 * figure, never a machine form.
 */

import type { ReactElement } from "react";

import { cn } from "@/lib/cn";
import type { ValueState } from "@/modules/data-service/envelope";
import type { Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";

/** Props of {@link AmountValue}. */
export type AmountValueProps = {
  /** The exact amount: an integer count of `currency`'s minor units. The code may be unknown. */
  readonly money: Money;
  /** The state the read recorded for this path, taken by the caller from `envelope.valueStates`. */
  readonly valueState: ValueState;
  /** The viewer's display locale, supplied by the route composition; never read from the host. */
  readonly locale: string;
  /**
   * Caller-supplied classes, logical utilities only (`text-end`, `ms-*`), so a figure in a
   * right-to-left row keeps its place.
   */
  readonly className?: string;
  /**
   * The quieter figure used inside cards and matrix cells (the default), or the emphasised
   * headline figure.
   */
  readonly emphasis?: "default" | "headline";
};

/** The emphasis a figure can carry, taken from the prop instead of restated. */
type Emphasis = NonNullable<AmountValueProps["emphasis"]>;

/**
 * How each emphasis reads. Sizes and weights resolve to the token scale and no colour is stated,
 * so a figure inherits the surface it sits on and its state is carried by the formatter's words
 * rather than by a tone.
 */
const EMPHASIS: Readonly<Record<Emphasis, string>> = {
  default: "text-sm",
  headline: "text-2xl font-semibold tracking-tight",
};

/**
 * Renders one exact minor-unit amount with the value state its read declared; performs no
 * arithmetic, chooses no state and appends no coverage claim.
 *
 * The accessible label is appended only when it says more than the visible text, so a screen
 * reader hears the state — "unknown", "withheld", "unavailable", "incomplete subtotal" — that a
 * sighted reader takes from the same words. It is never used as an `aria-label`, which would
 * replace the rendered figure instead of adding to it.
 */
export function AmountValue({
  money,
  valueState,
  locale,
  className,
  emphasis = "default",
}: AmountValueProps): ReactElement {
  const { text, accessibleLabel } = formatMinor(money, valueState, locale);

  return (
    <span className={cn("tabular-nums", EMPHASIS[emphasis], className)} title={accessibleLabel}>
      <bdi>{text}</bdi>
      {accessibleLabel === text ? null : <span className="sr-only">{accessibleLabel}</span>}
    </span>
  );
}

export default AmountValue;
