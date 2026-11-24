import { exponentOf, isKnownCurrency } from "./currency";
export type MinorUnits = number & { readonly __brand: "MinorUnits" };
export type Money = { readonly currency: string; readonly minorUnits: MinorUnits };
export type MoneyOperationErrorCode = "fractional-minor-units" | "unsafe-minor-units" | "currency-mismatch" | "unknown-currency" | "allocation-mismatch";
/** The single refusal this module raises, so a caller maps one error type to the closed outcome set instead of guessing from a message. */ export class MoneyOperationError extends Error {
  readonly code: MoneyOperationErrorCode;
  constructor(code: MoneyOperationErrorCode, message: string) {
    super(message);
    this.name = "MoneyOperationError";
    this.code = code;
  }
}
function refuse(code: MoneyOperationErrorCode, message: string): never {
  throw new MoneyOperationError(code, message);
}
type WholeNumber<T extends number> = number extends T ? number : `${T}` extends `${string}.${string}` ? never : T;
const isMinorUnitsAmount = (value: number): value is MinorUnits => Number.isSafeInteger(value) && !Object.is(value, -0);
function assertMinorUnits(value: number, operation: string): MinorUnits {
  if (isMinorUnitsAmount(value)) return value;
  if (Number.isFinite(value) && !Number.isInteger(value)) return refuse("fractional-minor-units", `${operation}: a fractional value is refused as a count of minor units rather than rounded or truncated, because either would change a financial amount. Minor units are whole numbers.`);
  return refuse("unsafe-minor-units", `${operation}: minor units must be a safe integer (at most ${Number.MAX_SAFE_INTEGER} in magnitude, and never negative zero), so this value is refused rather than used at a precision that would drift.`);
}
function assertKnownCurrency(currencyCode: string, operation: string): void {
  if (exponentOf(currencyCode) === undefined) refuse("unknown-currency", `${operation}: currency "${currencyCode}" has no minor-unit exponent, so its amounts are never summed, compared, split or defaulted to two decimals; it stays an unknown-currency amount.`);
}
function assertSameKnownCurrency(a: Money, b: Money, operation: string): void {
  assertKnownCurrency(a.currency, operation);
  assertKnownCurrency(b.currency, operation);
  if (a.currency !== b.currency) refuse("currency-mismatch", `${operation}: "${a.currency}" and "${b.currency}" are different currencies, so their amounts are never added or compared — this application holds no exchange rate and converts nothing.`);
}
export function minorUnitsOf<T extends number>(value: WholeNumber<T>): MinorUnits;
export function minorUnitsOf(value: number): MinorUnits {
  return assertMinorUnits(value, "minorUnitsOf");
}
/** Adds two amounts of the same currency. */ export function addMinor(a: Money, b: Money): Money {
  assertSameKnownCurrency(a, b, "addMinor");
  const left = assertMinorUnits(a.minorUnits, "addMinor");
  const right = assertMinorUnits(b.minorUnits, "addMinor");
  const total = left + right;
  return !Number.isSafeInteger(total) ? refuse("unsafe-minor-units", `addMinor: the total of these ${a.currency} amounts is beyond the safe-integer range, so it is refused rather than kept at a precision that would drift.`) : { currency: a.currency, minorUnits: minorUnitsOf(total) };
}
/** Compares two amounts of the same currency, returning `-1`, `0` or `1`. */ export function compareMinor(a: Money, b: Money): -1 | 0 | 1 {
  assertSameKnownCurrency(a, b, "compareMinor");
  const left = assertMinorUnits(a.minorUnits, "compareMinor");
  const right = assertMinorUnits(b.minorUnits, "compareMinor");
  return left < right ? -1 : left > right ? 1 : 0;
}
/** Reverses the sign of an amount, keeping its currency — the correction case, such as a refund that offsets a gift. */ export function negateMinor(a: Money): Money {
  assertKnownCurrency(a.currency, "negateMinor");
  const amount = assertMinorUnits(a.minorUnits, "negateMinor");
  return amount === 0 ? { currency: a.currency, minorUnits: minorUnitsOf(0) } : { currency: a.currency, minorUnits: minorUnitsOf(-amount) };
}
/** Sums amounts into one total per currency, plus the amounts that could not be summed at all. */ export function sumMinor(items: readonly Money[]): { readonly totals: readonly Money[]; readonly unsurmmed: readonly Money[] } {
  const running = new Map<string, Money>();
  const unsurmmed: Money[] = [];
  for (const item of items) {
    const amount = assertMinorUnits(item.minorUnits, "sumMinor");
    if (!isKnownCurrency(item.currency)) {
      unsurmmed.push({ currency: item.currency, minorUnits: amount });
      continue;
    }
    const current = running.get(item.currency);
    running.set(item.currency, current === undefined ? { currency: item.currency, minorUnits: amount } : addMinor(current, { currency: item.currency, minorUnits: amount }));
  }
  const totals = [...running.values()].sort((left, right) => (left.currency === right.currency ? 0 : left.currency < right.currency ? -1 : 1));
  return { totals, unsurmmed };
}
/** Splits an amount across integer weights so the parts sum exactly to the total — no unit created, none lost, none rounded away and no fractional monetary value formed at any point. */ export function allocateMinor(total: Money, weights: readonly number[]): readonly Money[] {
  const totalUnits = assertMinorUnits(total.minorUnits, "allocateMinor");
  assertKnownCurrency(total.currency, "allocateMinor");
  if (weights.length === 0) return refuse("allocation-mismatch", "allocateMinor: at least one weight is needed to split an amount, so an empty weight list is refused rather than yielding no parts.");
  let weightTotal = 0;
  let largestWeight = 0;
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) return refuse("allocation-mismatch", `allocateMinor: every weight must be a non-negative whole number, so a fractional, negative or non-finite weight cannot divide these ${total.currency} amounts exactly.`);
    if (weight > largestWeight) largestWeight = weight;
    weightTotal += weight;
    if (!Number.isSafeInteger(weightTotal)) return refuse("allocation-mismatch", `allocateMinor: these weights sum beyond the safe-integer range, so their ${total.currency} amounts cannot be apportioned exactly.`);
  }
  if (weightTotal === 0) return refuse("allocation-mismatch", `allocateMinor: weights summing to zero cannot divide an amount, so these ${total.currency} amounts are not split into empty parts.`);
  if (!Number.isSafeInteger(weightTotal * largestWeight)) return refuse("allocation-mismatch", `allocateMinor: these weights are too large to apportion ${total.currency} amounts exactly in integer arithmetic, so the split is refused rather than rounded.`);
  const magnitude = Math.abs(totalUnits);
  const share = Math.floor(magnitude / weightTotal);
  const remainder = magnitude - share * weightTotal;
  const parts = weights.map((weight, index) => {
    const scaledRemainder = remainder * weight;
    const extra = Math.floor(scaledRemainder / weightTotal);
    return { index, units: share * weight + extra, fraction: scaledRemainder - extra * weightTotal };
  });
  const leftover = magnitude - parts.reduce((sum, part) => sum + part.units, 0);
  if (leftover < 0 || leftover >= parts.length) return refuse("allocation-mismatch", `allocateMinor: these ${total.currency} amounts could not be apportioned exactly, so no parts are returned.`);
  if (leftover > 0) {
    const byLargestFraction = [...parts].sort((left, right) => (left.fraction === right.fraction ? left.index - right.index : right.fraction > left.fraction ? 1 : -1));
    for (const part of byLargestFraction.slice(0, leftover)) part.units += 1;
  }
  if (parts.reduce((sum, part) => sum + part.units, 0) !== magnitude) return refuse("allocation-mismatch", `allocateMinor: these ${total.currency} amounts could not be apportioned exactly, so no parts are returned.`);
  return parts.map((part) => ({ currency: total.currency, minorUnits: totalUnits < 0 && part.units !== 0 ? minorUnitsOf(-part.units) : minorUnitsOf(part.units) }));
}
