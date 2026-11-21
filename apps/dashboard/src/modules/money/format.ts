/**
 * The single money formatter in this application, and the place where a value's state becomes visible
 * text.
 */
import type { ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "./amount";
import { exponentOf } from "./currency";
/** The three renderings one amount needs. */
export interface MinorFormatting {
  readonly text: string;
  readonly plain: string;
  readonly accessibleLabel: string;
}
/** How {@link MinorFormatting.text} is rendered. */
export interface MinorFormatOptions {
  readonly style?: "display" | "machine";
}
type AmountValueState = Exclude<ValueState, "unknown" | "withheld" | "unavailable">;

interface LocaleSeparators {
  readonly group: string;
  readonly groupSizes: readonly number[];
  readonly decimal: string;
}
const PROBE_INTEGER = 1234567890;

const FALLBACK_SEPARATORS: LocaleSeparators = {
  group: ",",
  groupSizes: [3, 3],
  decimal: ".",
};
const UNKNOWN_TEXT = "Unknown amount";
const WITHHELD_TEXT = "Withheld";
const UNAVAILABLE_TEXT = "Source unavailable";

const INCOMPLETE_MARKER = "incomplete";

const UNKNOWN_CURRENCY_MARKER = "currency unknown";
/** Renders one amount and its state as display text, machine-stable text and an accessible label. */
export function formatMinor(money: Money, valueState: ValueState, locale: string, options?: MinorFormatOptions): MinorFormatting {
  switch (valueState) {
    case "unknown":
      return {
        text: UNKNOWN_TEXT,
        plain: UNKNOWN_TEXT,
        accessibleLabel: "Unknown amount. The source did not establish a value, so this must not be read as zero or as an absence of giving.",
      };
    case "withheld":
      return {
        text: WITHHELD_TEXT,
        plain: WITHHELD_TEXT,
        accessibleLabel: "Withheld. A value exists within this scope but is withheld here, and it must not be inferred by subtraction from any total or from any other figure.",
      };
    case "unavailable":
      return {
        text: UNAVAILABLE_TEXT,
        plain: UNAVAILABLE_TEXT,
        accessibleLabel: "Source unavailable. The source behind this amount is unavailable, so no amount can be shown: this is not zero and not an empty value.",
      };
    case "value":
    case "zero":
    case "incomplete-subtotal":
      return formatAmount(amountOf(money), money.currency, valueState, locale, options?.style ?? "display");
  }
}
function amountOf(money: Money): number {
  const recorded: number = money.minorUnits === 0 ? 0 : money.minorUnits;
  return minorUnitsOf(recorded);
}
function formatAmount(amount: number, currency: string, valueState: AmountValueState, locale: string, style: "display" | "machine"): MinorFormatting {
  const marker = valueState === "incomplete-subtotal" ? ` (${INCOMPLETE_MARKER})` : "";
  // `zero` is the state of a genuine zero, so a zero is what it renders: a contradictory minor-unit
  // count beside that state can never make a zero look like a recorded amount.
  const shown = valueState === "zero" ? 0 : amount;
  const exponent = exponentOf(currency);
  if (exponent === undefined) {
    const rendered = `${String(shown)} ${currency} minor units (${UNKNOWN_CURRENCY_MARKER})`;
    return {
      text: `${rendered}${marker}`,
      plain: `${rendered}${marker}`,
      accessibleLabel: `${rendered}${marker}. ${stateClause(valueState)} ${unknownCurrencyClause(currency)}`,
    };
  }
  const digits = digitsOf(shown, exponent);
  const separators = localeSeparators(locale);
  const fraction = digits.fraction === "" ? "" : `${separators.decimal}${digits.fraction}`;
  const plainFraction = digits.fraction === "" ? "" : `.${digits.fraction}`;
  const displayAmount = `${digits.sign}${groupDigits(digits.integer, separators)}${fraction}`;
  const plainAmount = `${digits.sign}${digits.integer}${plainFraction}`;
  const plain = `${plainAmount} ${currency}${marker}`;
  const spoken = style === "machine" ? plainAmount : displayAmount;
  return {
    text: style === "machine" ? plain : `${displayAmount} ${currency}${marker}`,
    plain,
    accessibleLabel: `${spoken} ${currency}${marker}. ${stateClause(valueState)}`,
  };
}
function localeSeparators(locale: string): LocaleSeparators {
  try {
    const probe = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    if (primaryLanguage(probe.resolvedOptions().locale) !== primaryLanguage(locale)) {
      return FALLBACK_SEPARATORS;
    }
    const parts = probe.formatToParts(PROBE_INTEGER);
    const decimal = parts.find((part) => part.type === "decimal")?.value;
    if (decimal === undefined) {
      return FALLBACK_SEPARATORS;
    }
    return { group: groupSeparatorOf(parts), groupSizes: groupSizesOf(parts), decimal };
  } catch {
    return FALLBACK_SEPARATORS;
  }
}
function groupSeparatorOf(parts: readonly Intl.NumberFormatPart[]): string {
  return parts.find((part) => part.type === "group")?.value ?? "";
}
function groupSizesOf(parts: readonly Intl.NumberFormatPart[]): readonly number[] {
  const integerSizes: number[] = [];
  for (const part of parts) {
    if (part.type === "integer") {
      integerSizes.push(part.value.length);
    }
  }
  if (integerSizes.length < 2) {
    return [];
  }
  const fromRight = [...integerSizes].reverse();
  const primary = fromRight[0] ?? 0;
  const secondary = fromRight[1] ?? primary;
  return primary > 0 && secondary > 0 ? [primary, secondary] : [];
}
function primaryLanguage(tag: string): string {
  const [base] = tag.split("-");
  return (base ?? "").toLowerCase();
}
function groupDigits(digits: string, separators: LocaleSeparators): string {
  const primary = separators.groupSizes[0] ?? 0;
  const secondary = separators.groupSizes[1] ?? primary;
  if (primary <= 0 || secondary <= 0 || separators.group === "" || digits.length <= primary) {
    return digits;
  }
  const groups: string[] = [];
  let end = digits.length;
  let size = primary;
  while (end > 0) {
    const start = Math.max(0, end - size);
    groups.unshift(digits.slice(start, end));
    end = start;
    size = secondary;
  }
  return groups.join(separators.group);
}
function digitsOf(amount: number, exponent: number): { readonly sign: string; readonly integer: string; readonly fraction: string } {
  const padded = String(Math.abs(amount)).padStart(exponent + 1, "0");
  const integer = exponent === 0 ? padded : padded.slice(0, padded.length - exponent);
  const fraction = exponent === 0 ? "" : padded.slice(padded.length - exponent);
  return { sign: amount < 0 ? "-" : "", integer, fraction };
}
function stateClause(valueState: AmountValueState): string {
  switch (valueState) {
    case "value":
      return "A recorded amount.";
    case "zero":
      return "Zero: no amount was recorded, so this is a genuine zero rather than an unknown value.";
    case "incomplete-subtotal":
      return "Incomplete subtotal: coverage of this period is partial, so this figure is not a complete total and must not be read as one.";
  }
}
function unknownCurrencyClause(currency: string): string {
  return `The currency ${currency} is unknown, so its minor-unit exponent is unknown as well: this amount cannot be totalled, compared with another amount, or defaulted to a two-decimal currency.`;
}
