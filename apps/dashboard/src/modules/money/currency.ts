/**
 * The application's only currency table: an ISO 4217 code resolves to the integer
 * number of decimal places in that currency's minor unit — USD 2, EUR 2, KWD 3, JPY 0.
 *
 * Every financial value in this application is an integer count of minor units paired
 * with a currency code and that code's exponent, so the integer `1250` means `12.50 USD`
 * and also means `1250 JPY`. A code this table does not hold has no exponent, which is
 * what stops such an amount from being rendered as a major-unit total, summed, or
 * compared with another currency. There is deliberately no default exponent, no guess
 * from the code's length or a locale, and no fallback to a default code.
 *
 * Matching is exact and case-sensitive against the canonical uppercase ISO form: no
 * trimming and no upper-casing. Normalising would accept `"usd"` or `" usd"` and then
 * render an amount whose stored code differs from the string trusted here, and
 * `String.prototype.toUpperCase` is locale-sensitive (Turkish `i` becomes `İ`), so
 * casing code identity would make it depend on the caller's locale. A non-canonical
 * code is honestly unknown; stored records and seed data carry canonical uppercase codes.
 */

/**
 * ISO 4217 code → decimal places of its minor unit. Module-private and readonly, so an
 * exponent cannot be added, removed or overridden at runtime. It is the only currency
 * table in the repository; no other module may hold one.
 */
const EXPONENTS: ReadonlyMap<string, number> = new Map<string, number>([
  ["USD", 2],
  ["EUR", 2],
  ["KWD", 3],
  ["JPY", 0],
]);

/**
 * Sentinel for an amount whose currency the source did not identify, used in place of a
 * currency code. It is not an ISO 4217 code and is never sent to another system.
 * `exponentOf(UNKNOWN_CURRENCY)` is deliberately `undefined`, so an unidentifiable
 * amount can be neither summed nor rendered as a major-unit total, and it stays a
 * distinct fact from an amount of zero.
 */
export const UNKNOWN_CURRENCY = "UNKNOWN";

/**
 * Returns the number of decimal places in `code`'s minor unit, or `undefined` when this
 * table does not hold the code. `0` is a valid exponent and is returned as `0` (JPY);
 * it is never conflated with an unknown currency.
 */
export function exponentOf(code: string): number | undefined {
  return EXPONENTS.get(code);
}

/**
 * True only when {@link exponentOf} resolves an exponent for `code`. It delegates, so
 * the two answers can never disagree.
 */
export function isKnownCurrency(code: string): boolean {
  return exponentOf(code) !== undefined;
}
