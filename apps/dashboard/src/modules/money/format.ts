import type { ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "./amount";
import { exponentOf } from "./currency";
export type MinorFormatting = { readonly text: string; readonly plain: string; readonly accessibleLabel: string };
export type MinorFormatOptions = { readonly style?: "display" | "machine" };
type AmountValueState = Exclude<ValueState, "unknown" | "withheld" | "unavailable">;
type LocaleSeparators = { readonly group: string; readonly groupSizes: readonly number[]; readonly decimal: string };
const PROBE_INTEGER = 1234567890;
const FALLBACK_SEPARATORS: LocaleSeparators = { group: ",", groupSizes: [3, 3], decimal: "." };
const UNKNOWN_TEXT = "Unknown amount";
const WITHHELD_TEXT = "Withheld";
const UNAVAILABLE_TEXT = "Source unavailable";
const INCOMPLETE_MARKER = "incomplete";
const UNKNOWN_CURRENCY_MARKER = "currency unknown";
const MARKER_FORMATS: Readonly<Record<"unknown" | "withheld" | "unavailable", MinorFormatting>> = {
  unknown: { text: UNKNOWN_TEXT, plain: UNKNOWN_TEXT, accessibleLabel: "Unknown amount. The source did not establish a value, so this must not be read as zero or as an absence of giving." },
  withheld: { text: WITHHELD_TEXT, plain: WITHHELD_TEXT, accessibleLabel: "Withheld. A value exists within this scope but is withheld here, and it must not be inferred by subtraction from any total or from any other figure." },
  unavailable: { text: UNAVAILABLE_TEXT, plain: UNAVAILABLE_TEXT, accessibleLabel: "Source unavailable. The source behind this amount is unavailable, so no amount can be shown: this is not zero and not an empty value." },
};
export const formatMinor = (money: Money, valueState: ValueState, locale: string, options?: MinorFormatOptions): MinorFormatting =>
  valueState === "unknown" || valueState === "withheld" || valueState === "unavailable" ? MARKER_FORMATS[valueState] : formatAmount(amountOf(money), money.currency, valueState, locale, options?.style ?? "display");
const amountOf = (money: Money): number => minorUnitsOf(money.minorUnits === 0 ? 0 : money.minorUnits);
function formatAmount(amount: number, currency: string, valueState: AmountValueState, locale: string, style: "display" | "machine"): MinorFormatting {
  const marker = valueState === "incomplete-subtotal" ? ` (${INCOMPLETE_MARKER})` : "";
  const shown = valueState === "zero" ? 0 : amount;
  const exponent = exponentOf(currency);
  if (exponent === undefined) {
    const rendered = `${String(shown)} ${currency} minor units (${UNKNOWN_CURRENCY_MARKER})`;
    return { text: `${rendered}${marker}`, plain: `${rendered}${marker}`, accessibleLabel: `${rendered}${marker}. ${stateClause(valueState)} ${unknownCurrencyClause(currency)}` };
  }
  const digits = digitsOf(shown, exponent);
  const separators = localeSeparators(locale);
  const displayAmount = `${digits.sign}${groupDigits(digits.integer, separators)}${digits.fraction === "" ? "" : `${separators.decimal}${digits.fraction}`}`;
  const plainAmount = `${digits.sign}${digits.integer}${digits.fraction === "" ? "" : `.${digits.fraction}`}`;
  return { text: style === "machine" ? `${plainAmount} ${currency}${marker}` : `${displayAmount} ${currency}${marker}`, plain: `${plainAmount} ${currency}${marker}`, accessibleLabel: `${style === "machine" ? plainAmount : displayAmount} ${currency}${marker}. ${stateClause(valueState)}` };
}
const SEPARATOR_CACHE_LIMIT = 32;
const SEPARATOR_CACHE = new Map<string, LocaleSeparators>(); // The separators are a pure function of the locale argument, so one computed entry serves every later amount in that locale, and the bound stops a generated or hostile tag from growing module state without limit.
function localeSeparators(locale: string): LocaleSeparators {
  const cached = SEPARATOR_CACHE.get(locale);
  if (cached !== undefined) return cached;
  const computed = computeLocaleSeparators(locale);
  if (SEPARATOR_CACHE.size >= SEPARATOR_CACHE_LIMIT) SEPARATOR_CACHE.clear();
  SEPARATOR_CACHE.set(locale, computed);
  return computed;
}
function computeLocaleSeparators(locale: string): LocaleSeparators {
  try {
    const probe = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (primaryLanguage(probe.resolvedOptions().locale) !== primaryLanguage(locale)) return FALLBACK_SEPARATORS;
    const parts = probe.formatToParts(PROBE_INTEGER);
    const decimal = parts.find((part) => part.type === "decimal")?.value;
    return decimal === undefined ? FALLBACK_SEPARATORS : { group: groupSeparatorOf(parts), groupSizes: groupSizesOf(parts), decimal };
  } catch {
    return FALLBACK_SEPARATORS;
  }
}
const groupSeparatorOf = (parts: readonly Intl.NumberFormatPart[]): string => parts.find((part) => part.type === "group")?.value ?? "";
function groupSizesOf(parts: readonly Intl.NumberFormatPart[]): readonly number[] {
  const integerSizes: number[] = parts.filter((part) => part.type === "integer").map((part) => part.value.length);
  if (integerSizes.length < 2) return [];
  const fromRight = [...integerSizes].reverse();
  const primary = fromRight[0] ?? 0;
  const secondary = fromRight[1] ?? primary;
  return primary > 0 && secondary > 0 ? [primary, secondary] : [];
}
const primaryLanguage = (tag: string): string => (tag.split("-")[0] ?? "").toLowerCase();
function groupDigits(digits: string, separators: LocaleSeparators): string {
  const primary = separators.groupSizes[0] ?? 0;
  const secondary = separators.groupSizes[1] ?? primary;
  if (primary <= 0 || secondary <= 0 || separators.group === "" || digits.length <= primary) return digits;
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
const INCOMPLETE_SUBTOTAL_CLAUSE = "Incomplete subtotal: coverage of this period is partial, so this figure is not a complete total and must not be read as one.";
const STATE_CLAUSES: Readonly<Record<AmountValueState, string>> = { value: "A recorded amount.", zero: "Zero: no amount was recorded, so this is a genuine zero rather than an unknown value.", "incomplete-subtotal": INCOMPLETE_SUBTOTAL_CLAUSE };
const stateClause = (valueState: AmountValueState): string => STATE_CLAUSES[valueState];
const unknownCurrencyClause = (currency: string): string => `The currency ${currency} is unknown, so its minor-unit exponent is unknown as well: this amount cannot be totalled, compared with another amount, or defaulted to a two-decimal currency.`;
