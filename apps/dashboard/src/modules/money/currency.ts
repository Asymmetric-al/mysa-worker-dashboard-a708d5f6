const EXPONENTS: ReadonlyMap<string, number> = new Map<string, number>([
  ["USD", 2],
  ["EUR", 2],
  ["KWD", 3],
  ["JPY", 0],
]);
export const UNKNOWN_CURRENCY = "UNKNOWN";
export const exponentOf = (code: string): number | undefined => EXPONENTS.get(code);
export const isKnownCurrency = (code: string): boolean => exponentOf(code) !== undefined;
