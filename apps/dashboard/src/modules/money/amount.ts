/**
 * The only place in this application where money is added, compared, negated, summed or
 * split, and the only place a financial value acquires its type. Every amount is an
 * integer count of a currency's minor units paired with the ISO 4217 code whose exponent
 * `./currency` owns, so no major-unit decimal and no floating-point value enters a
 * financial path. The screen total, chart series, table rows, drilldown, CSV and print
 * must agree exactly in minor units per currency, and that is only possible when all six
 * take their numbers from here, from integers.
 *
 * Four properties this module holds:
 *
 * - `minorUnitsOf` is the only constructor of `MinorUnits`. It accepts a safe integer and
 *   refuses a fractional value, `NaN`, `±Infinity`, a magnitude beyond
 *   `Number.MAX_SAFE_INTEGER` and negative zero, because rounding, truncating or coercing
 *   any of those would change a financial amount silently.
 * - The brand is compile-time only; at runtime a `MinorUnits` is an ordinary `number`.
 *   Every operation therefore re-checks `Number.isSafeInteger` on each input and on every
 *   result, so a value that arrives through JSON or through a type assertion is refused
 *   rather than trusted.
 * - Two currencies are never combined. Addition and comparison require the same known
 *   code — KWD against JPY is a refusal, not a rebasing to the smaller exponent — and
 *   `sumMinor` returns a partition per currency, never one figure across them.
 * - An amount whose currency has no exponent is a distinct fact rather than a zero and
 *   rather than an omission: `sumMinor` hands it back in `unsurmmed`, and every other
 *   function refuses it. Nothing here may merge received cash with a commitment, a
 *   monthly equivalent or a support goal.
 *
 * A refusal is always a thrown {@link MoneyOperationError} carrying one code from a
 * closed set and naming the currency codes involved. No function returns `undefined`, `0`
 * or `NaN` to signal a refusal, because a falsy result would be indistinguishable from a
 * genuine zero amount. The service validates requests before it calls in, so these
 * refusals are the last line of defence against a programming error, not the user-facing
 * validation.
 *
 * `allocateMinor` allocates a negative total — a refund correction — by magnitude and
 * reapplies the sign to each part, so the parts still sum exactly to the total and no
 * part carries a sign the total does not have.
 */

import { exponentOf, isKnownCurrency } from "./currency";

/**
 * An exact amount: an integer count of a currency's minor units, branded so a bare
 * `number` cannot reach an amount field. `1250` is `12.50 USD` and also `1250 JPY`; the
 * currency code beside it decides which, which is why the code always travels with it.
 */
export type MinorUnits = number & { readonly __brand: "MinorUnits" };

/**
 * A currency code and an integer count of that currency's minor units. `currency` is a
 * plain string because records are stored as JSON that carries the code directly, and
 * the only brand in this module is on the amount — the brand is what stops a raw
 * `number` reaching a financial field.
 */
export interface Money {
  readonly currency: string;
  readonly minorUnits: MinorUnits;
}

/**
 * The closed set of reasons a money operation is refused.
 *
 * - `fractional-minor-units`: a number of minor units that is not a whole number.
 * - `unsafe-minor-units`: a minor-unit count that is not a canonical safe integer —
 *   `NaN`, `±Infinity`, a magnitude beyond `Number.MAX_SAFE_INTEGER`, or negative zero.
 * - `currency-mismatch`: two different currency codes in one operation.
 * - `unknown-currency`: a code `./currency` holds no exponent for, including the
 *   `UNKNOWN` sentinel a source uses when it did not identify a currency.
 * - `allocation-mismatch`: a split whose weights cannot divide the amount exactly.
 */
export type MoneyOperationErrorCode =
  | "fractional-minor-units"
  | "unsafe-minor-units"
  | "currency-mismatch"
  | "unknown-currency"
  | "allocation-mismatch";

/**
 * The single refusal this module raises, so a caller maps one error type to the closed
 * outcome set instead of guessing from a message. `code` is safe to branch on and to
 * present as an honest reason; `message` names the operation and every currency code
 * involved, and never carries an amount.
 */
export class MoneyOperationError extends Error {
  readonly code: MoneyOperationErrorCode;

  constructor(code: MoneyOperationErrorCode, message: string) {
    super(message);
    this.name = "MoneyOperationError";
    this.code = code;
  }
}

/**
 * Refuses an operation. Declared with an explicit `never` return type so TypeScript knows
 * control cannot continue past a call, which keeps the checks below flat.
 */
function refuse(code: MoneyOperationErrorCode, message: string): never {
  throw new MoneyOperationError(code, message);
}

/**
 * Narrows `minorUnitsOf`'s parameter so a fractional *literal* — `minorUnitsOf(12.5)` —
 * is a compile error, while any `number` value is accepted, because type inference cannot
 * inspect one and `minorUnitsOf` checks it at runtime. Without the literal check the most
 * common mistake this module exists to prevent would surface only when it ran.
 *
 * The diagnostic such a call produces reads "Argument of type '12.5' is not assignable to
 * parameter of type 'never'": `never` here is the compiler stating that no whole number
 * matches the literal passed.
 */
type WholeNumber<T extends number> = number extends T
  ? number
  : `${T}` extends `${string}.${string}`
    ? never
    : T;

/**
 * True only for a value that can be a minor-unit count: a safe integer that is not
 * negative zero. It is a type predicate rather than a boolean so `minorUnitsOf` can
 * return the narrowed value without a type assertion anywhere in this module.
 */
function isMinorUnitsAmount(value: number): value is MinorUnits {
  return Number.isSafeInteger(value) && !Object.is(value, -0);
}

/**
 * Validates a minor-unit count and returns it branded, refusing anything that is not a
 * canonical safe integer. Every function here runs it on its inputs as well as on its
 * results: the brand is erased at runtime, so this check is the guarantee rather than a
 * formality.
 */
function assertMinorUnits(value: number, operation: string): MinorUnits {
  if (isMinorUnitsAmount(value)) {
    return value;
  }
  if (Number.isFinite(value) && !Number.isInteger(value)) {
    return refuse(
      "fractional-minor-units",
      `${operation}: a fractional value is refused as a count of minor units rather than rounded or truncated, because either would change a financial amount. Minor units are whole numbers.`,
    );
  }
  return refuse(
    "unsafe-minor-units",
    `${operation}: minor units must be a safe integer (at most ${Number.MAX_SAFE_INTEGER} in magnitude, and never negative zero), so this value is refused rather than used at a precision that would drift.`,
  );
}

/**
 * Refuses a currency code that `./currency` holds no exponent for. Such an amount is a
 * distinct fact: it is never defaulted to two decimals, never treated as zero, and never
 * combined with a currency that does have an exponent.
 */
function assertKnownCurrency(currencyCode: string, operation: string): void {
  if (exponentOf(currencyCode) === undefined) {
    refuse(
      "unknown-currency",
      `${operation}: currency "${currencyCode}" has no minor-unit exponent, so its amounts are never summed, compared, split or defaulted to two decimals; it stays an unknown-currency amount.`,
    );
  }
}

/**
 * Refuses an operation over two amounts that are not in the same known currency. There is
 * no conversion, no rate table and no truncation to the smaller exponent in this
 * application, so this is the only honest answer.
 */
function assertSameKnownCurrency(a: Money, b: Money, operation: string): void {
  assertKnownCurrency(a.currency, operation);
  assertKnownCurrency(b.currency, operation);
  if (a.currency !== b.currency) {
    refuse(
      "currency-mismatch",
      `${operation}: "${a.currency}" and "${b.currency}" are different currencies, so their amounts are never added or compared — this application holds no exchange rate and converts nothing.`,
    );
  }
}

/**
 * Returns `value` as `MinorUnits` when it is a safe integer, refusing it otherwise. The
 * only way to construct a `MinorUnits`; the parameter type additionally rejects a
 * fractional literal at compile time.
 */
export function minorUnitsOf<T extends number>(value: WholeNumber<T>): MinorUnits;
export function minorUnitsOf(value: number): MinorUnits {
  return assertMinorUnits(value, "minorUnitsOf");
}

/**
 * Adds two amounts of the same currency. Both must carry the same known code — a KWD
 * amount is never added to a JPY one — and the total must remain a safe integer, so a sum
 * that would drift in precision is refused rather than returned approximately. Adding an
 * amount to its own negation yields a genuine zero, which formats as a zero value and
 * never as an unknown one.
 */
export function addMinor(a: Money, b: Money): Money {
  assertSameKnownCurrency(a, b, "addMinor");
  const left = assertMinorUnits(a.minorUnits, "addMinor");
  const right = assertMinorUnits(b.minorUnits, "addMinor");
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    return refuse(
      "unsafe-minor-units",
      `addMinor: the total of these ${a.currency} amounts is beyond the safe-integer range, so it is refused rather than kept at a precision that would drift.`,
    );
  }
  return { currency: a.currency, minorUnits: minorUnitsOf(total) };
}

/**
 * Compares two amounts of the same currency, returning `-1`, `0` or `1`. Deliberately not
 * the raw difference: a caller handed a difference would do its own arithmetic on it, and
 * amounts of two currencies have no ordering at all. Sorting rows stays the caller's job;
 * this is the rule it sorts by.
 */
export function compareMinor(a: Money, b: Money): -1 | 0 | 1 {
  assertSameKnownCurrency(a, b, "compareMinor");
  const left = assertMinorUnits(a.minorUnits, "compareMinor");
  const right = assertMinorUnits(b.minorUnits, "compareMinor");
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Reverses the sign of an amount, keeping its currency — the correction case, such as a
 * refund that offsets a gift. Negation of a safe integer cannot overflow, and a zero
 * amount stays a canonical zero instead of becoming negative zero.
 */
export function negateMinor(a: Money): Money {
  const amount = assertMinorUnits(a.minorUnits, "negateMinor");
  if (amount === 0) {
    return { currency: a.currency, minorUnits: minorUnitsOf(0) };
  }
  return { currency: a.currency, minorUnits: minorUnitsOf(-amount) };
}

/**
 * Sums amounts into one total per currency, plus the amounts that could not be summed at
 * all.
 *
 * `totals` is ordered by currency code in code-unit order — not with a locale-sensitive
 * comparison, which would order the same rows differently on two machines and let an
 * exported file depend on the reader's locale. There is deliberately no figure across
 * currencies: a caller that wants to show overall support must present the partition,
 * because adding EUR to USD states a number this application cannot know.
 *
 * An amount whose currency has no exponent cannot be summed. It comes back in `unsurmmed`
 * in input order, so the caller renders it as an unknown-currency amount rather than
 * dropping it, folding it into a known currency or showing it as zero.
 */
export function sumMinor(items: readonly Money[]): {
  readonly totals: readonly Money[];
  readonly unsurmmed: readonly Money[];
} {
  const running = new Map<string, Money>();
  const unsurmmed: Money[] = [];

  for (const item of items) {
    const amount = assertMinorUnits(item.minorUnits, "sumMinor");
    if (!isKnownCurrency(item.currency)) {
      unsurmmed.push({ currency: item.currency, minorUnits: amount });
      continue;
    }
    const current = running.get(item.currency);
    running.set(
      item.currency,
      current === undefined
        ? { currency: item.currency, minorUnits: amount }
        : addMinor(current, { currency: item.currency, minorUnits: amount }),
    );
  }

  const totals = [...running.values()].sort((left, right) => {
    if (left.currency === right.currency) {
      return 0;
    }
    return left.currency < right.currency ? -1 : 1;
  });

  return { totals, unsurmmed };
}

/**
 * Splits an amount across integer weights so the parts sum exactly to the total — no unit
 * created, none lost, none rounded away and no fractional monetary value formed at any
 * point. The weights are counts, not money: each must be a non-negative safe integer and
 * they must not sum to zero.
 *
 * Every part starts at the floor of its exact share, and the units those floors leave over
 * go one each to the largest fractional remainders, ties resolved by ascending position.
 * Quotient-and-remainder arithmetic computes both from integers, so the division never
 * produces an amount.
 *
 * A split of 100 by weights `[40, 60]` yields 40 and 60 — which is how a gift that shows
 * only its authorised allocation and a view holding both grain levels still counts 100
 * once. A negative total, a refund correction, is allocated by magnitude with the sign
 * reapplied to every part.
 */
export function allocateMinor(total: Money, weights: readonly number[]): readonly Money[] {
  const totalUnits = assertMinorUnits(total.minorUnits, "allocateMinor");
  assertKnownCurrency(total.currency, "allocateMinor");

  if (weights.length === 0) {
    return refuse(
      "allocation-mismatch",
      "allocateMinor: at least one weight is needed to split an amount, so an empty weight list is refused rather than yielding no parts.",
    );
  }

  let weightTotal = 0;
  let largestWeight = 0;
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      return refuse(
        "allocation-mismatch",
        `allocateMinor: every weight must be a non-negative whole number, so a fractional, negative or non-finite weight cannot divide these ${total.currency} amounts exactly.`,
      );
    }
    if (weight > largestWeight) {
      largestWeight = weight;
    }
    weightTotal += weight;
    if (!Number.isSafeInteger(weightTotal)) {
      return refuse(
        "allocation-mismatch",
        `allocateMinor: these weights sum beyond the safe-integer range, so their ${total.currency} amounts cannot be apportioned exactly.`,
      );
    }
  }
  if (weightTotal === 0) {
    return refuse(
      "allocation-mismatch",
      `allocateMinor: weights summing to zero cannot divide an amount, so these ${total.currency} amounts are not split into empty parts.`,
    );
  }
  // Keeps `weightTotal * largestWeight` — and so every product below — within the safe range.
  if (!Number.isSafeInteger(weightTotal * largestWeight)) {
    return refuse(
      "allocation-mismatch",
      `allocateMinor: these weights are too large to apportion ${total.currency} amounts exactly in integer arithmetic, so the split is refused rather than rounded.`,
    );
  }

  const magnitude = Math.abs(totalUnits);
  const share = Math.floor(magnitude / weightTotal);
  const remainder = magnitude - share * weightTotal;

  const parts = weights.map((weight, index) => {
    const wholeShare = share * weight;
    const scaledRemainder = remainder * weight;
    const extra = Math.floor(scaledRemainder / weightTotal);
    return {
      index,
      units: wholeShare + extra,
      fraction: scaledRemainder - extra * weightTotal,
    };
  });

  const floored = parts.reduce((sum, part) => sum + part.units, 0);
  const leftover = magnitude - floored;
  if (leftover < 0 || leftover >= parts.length) {
    return refuse(
      "allocation-mismatch",
      `allocateMinor: these ${total.currency} amounts could not be apportioned exactly, so no parts are returned.`,
    );
  }
  if (leftover > 0) {
    const byLargestFraction = [...parts].sort((left, right) => {
      if (left.fraction === right.fraction) {
        return left.index - right.index;
      }
      return right.fraction > left.fraction ? 1 : -1;
    });
    for (const part of byLargestFraction.slice(0, leftover)) {
      part.units += 1;
    }
  }

  const allocated = parts.reduce((sum, part) => sum + part.units, 0);
  if (allocated !== magnitude) {
    return refuse(
      "allocation-mismatch",
      `allocateMinor: these ${total.currency} amounts could not be apportioned exactly, so no parts are returned.`,
    );
  }

  const negative = totalUnits < 0;
  return parts.map((part) => ({
    currency: total.currency,
    minorUnits: negative && part.units !== 0 ? minorUnitsOf(-part.units) : minorUnitsOf(part.units),
  }));
}
