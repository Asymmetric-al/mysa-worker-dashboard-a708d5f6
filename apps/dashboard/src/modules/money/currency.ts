/** ISO 4217 code → decimal places of its minor unit. */
const EXPONENTS: ReadonlyMap<string, number> = new Map<string, number>([
  ["USD", 2],
  ["EUR", 2],
  ["KWD", 3],
  ["JPY", 0],
]);
export const UNKNOWN_CURRENCY = "UNKNOWN";
/** Returns the number of decimal places in `code`'s minor unit, or `undefined` when this table does not hold the code. */
export const exponentOf = (code: string): number | undefined => EXPONENTS.get(code);
/** True only when {@link exponentOf} resolves an exponent for `code`. */
export const isKnownCurrency = (code: string): boolean => exponentOf(code) !== undefined;
