/**
 * The application's only currency table: an ISO 4217 code resolves to the integer number of decimal
 * places in that currency's minor unit — USD 2, EUR 2, KWD 3, JPY 0.
 */
/**
 * ISO 4217 code → decimal places of its minor unit. Module-private and readonly, so an exponent cannot
 * be added, removed or overridden at runtime. It is the only currency table in the repository; no
 * other module may hold one.
 */
const EXPONENTS: ReadonlyMap<string, number> = new Map<string, number>([
  ["USD", 2],
  ["EUR", 2],
  ["KWD", 3],
  ["JPY", 0],
]);
/** Sentinel for an amount whose currency the source did not identify, used in place of a currency code. */
export const UNKNOWN_CURRENCY = "UNKNOWN";
/** Returns the number of decimal places in `code`'s minor unit, or `undefined` when this table does not hold the code. */
export function exponentOf(code: string): number | undefined {
  return EXPONENTS.get(code);
}
/** True only when {@link exponentOf} resolves an exponent for `code`. */
export function isKnownCurrency(code: string): boolean {
  return exponentOf(code) !== undefined;
}
