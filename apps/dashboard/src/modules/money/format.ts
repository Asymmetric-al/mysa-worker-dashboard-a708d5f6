/**
 * The single money formatter in this application, and the place where a value's state becomes
 * visible text.
 *
 * `formatMinor` turns an exact amount and its {@link ValueState} into the three strings a surface
 * needs, in one call, so no surface recomputes a format and drifts from the others:
 *
 * - `text` is the display form for a card, a tooltip or a table cell, grouped and punctuated for the
 *   caller-supplied locale.
 * - `plain` is the machine-stable form for a CSV cell and for the print model: no grouping, a `.`
 *   decimal separator, and every digit the currency's exponent carries.
 * - `accessibleLabel` is a full sentence naming the state, so a screen-reader user learns the same
 *   fact a sighted user reads from the words beside the number.
 *
 * Digits are always built from the integer count of minor units and the currency's exponent, never
 * by converting the amount to a major-unit floating-point number: that conversion rounds a large
 * total and would break the exact agreement the screen, the chart, the table, the drilldown, the CSV
 * and the print view must keep. `Intl.NumberFormat` is consulted only for the locale's separators
 * and grouping sizes, through `formatToParts` of a small integer probe; it never formats an amount.
 * The ISO code is always shown exactly as stored, and no currency symbol, currency name or
 * locale→separator table exists here, because `./currency` holds the only currency table.
 *
 * The states a value can be in stay distinct renderings everywhere: `value` and `zero` carry digits,
 * `unknown`, `withheld` and `unavailable` carry words instead of a number, and `incomplete-subtotal`
 * carries its digits with a mandatory incompleteness marker. No state yields an empty string, and
 * only `value`, `zero` and `incomplete-subtotal` ever yield a digit.
 *
 * A currency `./currency` holds no exponent for is rendered as its exact integer minor units, the
 * code and an explicit unknown-currency statement: such an amount is never given two decimals, never
 * replaced by a default currency and never dropped.
 *
 * The locale comes from the caller and is never read from the environment. A tag `Intl` rejects, and
 * a structurally valid tag no locale data matches — where `Intl` would otherwise silently substitute
 * the host's default locale, which is ambient state — both fall back to `en`-style separators, `,`
 * for grouping and `.` for the decimal, so the same arguments always produce the same strings.
 *
 * Nothing here states a colour, a type size or an alignment, and no output carries a bidi control
 * character: direction is a property of the block the amount sits in, applied with `dir` and `<bdi>`
 * isolation at the component layer, and these strings are safe inside such an isolation element.
 */

import type { ValueState } from "@/modules/data-service/envelope";

import { minorUnitsOf, type Money } from "./amount";
import { exponentOf } from "./currency";

/**
 * The three renderings one amount needs. None of them is ever empty: a state that carries no number
 * says so in words rather than returning an empty cell or a zero.
 */
export interface MinorFormatting {
  /** Locale-formatted display value, or the state's own words. Never empty. */
  readonly text: string;
  /** Machine-stable rendering for CSV and print: no grouping, "." decimal, exponent digits. Never empty. */
  readonly plain: string;
  /** Full accessible label naming the state (and the incompleteness or unknown currency where it applies). Never empty. */
  readonly accessibleLabel: string;
}

/**
 * How {@link MinorFormatting.text} is rendered. `machine` makes `text` identical to `plain`, for a
 * caller that wants one grouping-free string in every medium; `display` keeps the locale's grouping.
 */
export interface MinorFormatOptions {
  readonly style?: "display" | "machine";
}

/** The three states that carry a number, and so the only states that need the currency's exponent. */
type AmountValueState = Exclude<ValueState, "unknown" | "withheld" | "unavailable">;

/** The separators and grouping sizes one locale uses, read from a probe on the caller's locale. */
interface LocaleSeparators {
  /** The grouping separator, or `""` when the locale does not group the probe's digits. */
  readonly group: string;
  /** Group sizes from the right: the primary size first, the repeated size second. Empty means no grouping. */
  readonly groupSizes: readonly number[];
  /** The decimal separator. */
  readonly decimal: string;
}

/**
 * The integer the separator probe formats. It is exact in IEEE-754, it is not a monetary value, and
 * ten digits is large enough that a locale whose grouping only starts above four digits still groups
 * it — which is what reveals the separator and the group sizes together.
 */
const PROBE_INTEGER = 1234567890;

/**
 * What a tag `Intl` rejects, or one no locale data matches, falls back to: `en`-style separators in
 * every three digits. Fixed rather than taken from the host default, so output never depends on the
 * machine it runs on.
 */
const FALLBACK_SEPARATORS: LocaleSeparators = {
  group: ",",
  groupSizes: [3, 3],
  decimal: ".",
};

/**
 * The words the three non-numeric states render. Product copy, identical on every surface and in
 * every locale: a translation table would be a second copy source, and these labels exist to state
 * one fact unambiguously rather than to be localised prose.
 */
const UNKNOWN_TEXT = "Unknown amount";
const WITHHELD_TEXT = "Withheld";
const UNAVAILABLE_TEXT = "Source unavailable";

/** The marker that keeps a partial subtotal from ever reading as a bare number. */
const INCOMPLETE_MARKER = "incomplete";

/** The marker that keeps an amount of an unidentified currency from reading as a major-unit total. */
const UNKNOWN_CURRENCY_MARKER = "currency unknown";

/**
 * Renders one amount and its state as display text, machine-stable text and an accessible label.
 *
 * `valueState` has no default: a default would silently turn an `unknown` value into a number, so
 * every caller states the state it holds. The locale is likewise required, because an ambient one
 * would make the same amount render differently on two machines.
 */
export function formatMinor(
  money: Money,
  valueState: ValueState,
  locale: string,
  options?: MinorFormatOptions,
): MinorFormatting {
  switch (valueState) {
    case "unknown":
      return {
        text: UNKNOWN_TEXT,
        plain: UNKNOWN_TEXT,
        accessibleLabel:
          "Unknown amount. The source did not establish a value, so this must not be read as zero or as an absence of giving.",
      };
    case "withheld":
      return {
        text: WITHHELD_TEXT,
        plain: WITHHELD_TEXT,
        accessibleLabel:
          "Withheld. A value exists within this scope but is withheld here, and it must not be inferred by subtraction from any total or from any other figure.",
      };
    case "unavailable":
      return {
        text: UNAVAILABLE_TEXT,
        plain: UNAVAILABLE_TEXT,
        accessibleLabel:
          "Source unavailable. The source behind this amount is unavailable, so no amount can be shown: this is not zero and not an empty value.",
      };
    case "value":
    case "zero":
    case "incomplete-subtotal":
      return formatAmount(
        amountOf(money),
        money.currency,
        valueState,
        locale,
        options?.style ?? "display",
      );
  }
}

/**
 * Reduces an amount to the safe integer its digits are built from.
 *
 * `-0 === 0` holds, so the first line maps a negative zero to the plain zero `minorUnitsOf` accepts
 * and `-0.00` can never be rendered. Every other value is then checked by `minorUnitsOf`, the one
 * constructor of a minor-unit count, so a fractional or out-of-range value arriving through JSON or
 * a type assertion is refused instead of being turned into digits that look like an amount.
 */
function amountOf(money: Money): number {
  const recorded: number = money.minorUnits === 0 ? 0 : money.minorUnits;
  return minorUnitsOf(recorded);
}

/**
 * Renders the three states that carry a number, through the currency's exponent.
 *
 * `zero` renders a genuine zero in the currency's precision, because the state is the fact that the
 * amount is zero; the digits of a recorded number are rendered for `value` and, with an
 * incompleteness marker, for `incomplete-subtotal`.
 *
 * An unknown currency is handled first, because the exponent its major-unit rendering would need does
 * not exist: the integer minor units are shown with the code and an explicit statement instead of
 * being given two decimals, replaced by a default currency or dropped.
 */
function formatAmount(
  amount: number,
  currency: string,
  valueState: AmountValueState,
  locale: string,
  style: "display" | "machine",
): MinorFormatting {
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

/**
 * Reads the separators and grouping sizes a locale uses from one probe on {@link PROBE_INTEGER}.
 *
 * `minimumFractionDigits: 1` is what makes the probe report the decimal separator without a
 * fractional amount ever being formed, and the probe's own integer grouping is what reports the
 * grouping separator and the sizes to group by. Nothing about the amount being rendered reaches the
 * probe, so no monetary value is converted to a major-unit number anywhere.
 *
 * A tag `Intl` throws a `RangeError` for, and a structurally valid tag that resolves to a different
 * language — `Intl`'s silent substitution of the host's default locale, which would make the same
 * arguments render differently on two machines — both use {@link FALLBACK_SEPARATORS}.
 */
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

/** The probe's grouping separator, or `""` when the locale does not group its digits. */
function groupSeparatorOf(parts: readonly Intl.NumberFormatPart[]): string {
  return parts.find((part) => part.type === "group")?.value ?? "";
}

/**
 * Derives group sizes from the probe's integer parts, from the right: the primary size first, the
 * repeated size second — `[3, 3]` for `en`, `[3, 2]` for `en-IN`. Empty when the probe shows no
 * grouping, which is also when no separator should be inserted.
 */
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

/**
 * The primary language subtag of a BCP-47 tag, lower-cased.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`, because the latter's result depends on the host's
 * locale and this comparison must not.
 */
function primaryLanguage(tag: string): string {
  const [base] = tag.split("-");
  return (base ?? "").toLowerCase();
}

/**
 * Inserts the locale's grouping separator into an integer digit string, using the sizes the probe
 * reported. A string no longer than the primary size is returned unchanged, and a locale that does
 * not group keeps its digits as they are.
 */
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

/**
 * Splits an amount's digits at the currency's exponent: the sign, the integer digits and exactly
 * `exponent` fractional digits, the fraction padded with leading zeros when the amount holds fewer
 * minor units than the exponent needs.
 *
 * `String` on a safe integer is always the plain decimal form — exponential notation starts at
 * 1e21, far above `Number.MAX_SAFE_INTEGER` — so no rounding, truncation or major-unit division
 * happens anywhere in it.
 */
function digitsOf(
  amount: number,
  exponent: number,
): { readonly sign: string; readonly integer: string; readonly fraction: string } {
  const padded = String(Math.abs(amount)).padStart(exponent + 1, "0");
  const integer = exponent === 0 ? padded : padded.slice(0, padded.length - exponent);
  const fraction = exponent === 0 ? "" : padded.slice(padded.length - exponent);
  return { sign: amount < 0 ? "-" : "", integer, fraction };
}

/** What the label says about a known amount beyond its digits, one clause per state. */
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

/**
 * What the label says about an amount whose currency has no exponent: the amount cannot become a
 * major-unit total, so it can be neither totalled, compared nor given a default precision.
 */
function unknownCurrencyClause(currency: string): string {
  return `The currency ${currency} is unknown, so its minor-unit exponent is unknown as well: this amount cannot be totalled, compared with another amount, or defaulted to a two-decimal currency.`;
}
