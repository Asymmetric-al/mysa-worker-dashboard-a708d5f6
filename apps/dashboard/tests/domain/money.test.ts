/**
 * Proves the money module's exact-integer contract at the currency boundary: an amount whose
 * currency has no exponent is refused by every operation the module header names — negation
 * included — and survives only as the distinct fact `sumMinor` hands back in `unsurmmed`, while a
 * known currency is negated, summed and split with no unit created, lost or defaulted.
 *
 * Plan items that put this file in scope: the AAP 0.11.1 deliverable row `tests/domain/*.test.ts`
 * naming `money` for success criterion 6, and AAP 0.8.1's rules that money is an exact integer in
 * minor units paired with its currency exponent, that an unknown currency is never defaulted, and
 * that the module is proven on a 3-decimal and a 0-decimal currency. The invariant under test is
 * the one the module header states at `amount.ts:23-26`: every function refuses a currency that has
 * no exponent, and `sumMinor` alone hands such an amount back.
 */
import { describe, expect, it } from "vitest";

import {
  MoneyOperationError,
  addMinor,
  allocateMinor,
  compareMinor,
  minorUnitsOf,
  negateMinor,
  sumMinor,
  type Money,
  type MoneyOperationErrorCode,
} from "@/modules/money/amount";
import { UNKNOWN_CURRENCY, exponentOf } from "@/modules/money/currency";

/**
 * An exact amount built through the module's own constructor, so every case below carries a
 * checked `MinorUnits` rather than a cast.
 */
function money(currency: string, minorUnits: number): Money {
  return { currency, minorUnits: minorUnitsOf(minorUnits) };
}

/**
 * The `code` the refusal of `operation` carries. The code is asserted rather than the message
 * because the code is the closed value a caller maps to an outcome, while the message is prose
 * that may be reworded without the contract changing. A rejection that is not this module's own
 * error type is rethrown, so a case cannot pass by catching an unrelated fault.
 */
function refusalCode(operation: () => unknown): MoneyOperationErrorCode {
  try {
    operation();
  } catch (error) {
    if (error instanceof MoneyOperationError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected the operation to be refused, but it returned a value");
}

/** A currency code `@/modules/money/currency` holds no exponent for, distinct from the sentinel. */
const UNLISTED_CURRENCY = "ZZZ";

/** One operation that must refuse an amount whose currency has no exponent. */
type Refusal = { readonly operation: string; readonly run: (amount: Money) => unknown };

/**
 * Every operation the module header names as refusing an amount whose currency has no exponent.
 * `addMinor` and `compareMinor` take a known USD amount as their second operand — the case that
 * would otherwise fold the unknown amount into a known currency — and `allocateMinor` a 40/60
 * split of it.
 */
const REFUSALS: readonly Refusal[] = [
  { operation: "negateMinor", run: (amount) => negateMinor(amount) },
  { operation: "addMinor", run: (amount) => addMinor(amount, money("USD", 100)) },
  { operation: "compareMinor", run: (amount) => compareMinor(amount, money("USD", 100)) },
  { operation: "allocateMinor", run: (amount) => allocateMinor(amount, [40, 60]) },
];

describe("an amount whose currency has no exponent", () => {
  it.each(
    [UNKNOWN_CURRENCY, UNLISTED_CURRENCY].flatMap((currency) =>
      REFUSALS.map(({ operation, run }) => ({ operation, currency, run })),
    ),
  )("refuses $operation for a $currency amount", ({ currency, run }) => {
    const amount = money(currency, 1250);
    // Both assertions matter: the refusal is this module's one error type, and `unknown-currency`
    // is the reason a caller can map to an honest outcome instead of reading a message.
    expect(() => run(amount)).toThrow(MoneyOperationError);
    expect(refusalCode(() => run(amount))).toBe("unknown-currency");
  });

  it("survives only in sumMinor's unsurmmed list, in input order beside the known total", () => {
    const { totals, unsurmmed } = sumMinor([
      money("USD", 500),
      money(UNKNOWN_CURRENCY, 1250),
      money("USD", 700),
      money(UNLISTED_CURRENCY, 40),
    ]);
    // The known currency folds into one total and nothing unknown is folded into it, so the
    // unknown facts are never presented as part of a USD figure.
    expect(totals).toEqual([{ currency: "USD", minorUnits: 1200 }]);
    expect(unsurmmed.map((amount) => amount.currency)).toEqual([
      UNKNOWN_CURRENCY,
      UNLISTED_CURRENCY,
    ]);
    expect(unsurmmed.map((amount) => amount.minorUnits)).toEqual([1250, 40]);
  });
});

describe("negating a known currency", () => {
  it.each([
    { currency: "USD", minorUnits: 1250, expected: -1250 },
    { currency: "KWD", minorUnits: 12_500, expected: -12_500 },
  ])("reverses a $currency amount by exact minor units", ({ currency, minorUnits, expected }) => {
    const result = negateMinor(money(currency, minorUnits));
    expect(result.currency).toBe(currency);
    expect(result.minorUnits).toBe(expected);
  });

  it("keeps a zero JPY amount a canonical zero rather than a negative zero", () => {
    // A 0-decimal currency is the case where an exponent of `0` must not be read as "unknown".
    expect(exponentOf("JPY")).toBe(0);
    const result = negateMinor(money("JPY", 0));
    expect(result.currency).toBe("JPY");
    // `toBe(0)` would pass for `-0`, which every downstream equality on canonical minor units
    // would then reject, so the zero is asserted through `Object.is`.
    expect(Object.is(result.minorUnits, 0)).toBe(true);
  });

  it("keeps a KWD amount on its own three-decimal code", () => {
    // The negation re-bases nothing: the amount keeps the currency whose exponent gives it
    // meaning, rather than being restated at another currency's precision.
    expect(exponentOf("KWD")).toBe(3);
    const result = negateMinor(money("KWD", 1250));
    expect(result.currency).toBe("KWD");
    expect(result.minorUnits).toBe(-1250);
  });
});

describe("splitting an amount", () => {
  it("splits 100 minor units 40/60 with nothing created and nothing lost", () => {
    const total = money("USD", 100);
    const parts = allocateMinor(total, [40, 60]);
    expect(parts.map((part) => part.minorUnits)).toEqual([40, 60]);
    expect(parts.every((part) => part.currency === "USD")).toBe(true);
    // The parts recombine to the original total through the module's own arithmetic, which is what
    // lets a view holding both grain levels count the gift once.
    expect(parts.reduce((sum, part) => sum + part.minorUnits, 0)).toBe(total.minorUnits);
    expect(sumMinor(parts).totals).toEqual([{ currency: "USD", minorUnits: 100 }]);
    expect(sumMinor(parts).unsurmmed).toEqual([]);
  });
});
