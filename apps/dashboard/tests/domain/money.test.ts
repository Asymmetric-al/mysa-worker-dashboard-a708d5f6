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
 *
 * The rest of the contract is proved here too, because no surface may re-derive any of it:
 *
 * - the exponent a currency carries is looked up per code, so the three seeded decimal widths of
 *   AAP 0.8.7 and assumption A14 — KWD 3, JPY 0, USD 2, EUR 2 — are asserted against the table
 *   rather than against a two-decimal assumption;
 * - arithmetic stays on integers, so a repeated accumulation, a total at the top of the safe range
 *   and a comparison at the extremes all stay exact;
 * - the six members of the read envelope's `ValueState` render as six distinguishable facts with
 *   their own accessible labels, which is what stops a genuine zero, an unknown amount, a withheld
 *   amount and an unavailable source from sharing a rendering in a card, a tooltip, a CSV cell or a
 *   screen reader (AAP 0.8.1). The union is imported as a type and never restated: the state list
 *   below is typed by it, so a member invented here fails to compile.
 * - no financial module parses or rounds a float, which is the rule-mandated source check this file
 *   owns (AAP 0.8.1; Rule 1 clause 3).
 *
 * This is also the `tests/domain` folder's no-DOM proof: it asserts that the runner loads no
 * `document` at all, which is why a claim about rendered components belongs to `e2e/` instead.
 *
 * Where the module's exported surface differs from the shape this file was briefed with: the
 * arithmetic is `negateMinor`, `sumMinor` and `allocateMinor` beside `addMinor` and `compareMinor`;
 * every refusal is a thrown `MoneyOperationError` carrying one code from a closed set rather than an
 * absent, zero or `NaN` result; and `formatMinor(amount, valueState, locale)` returns all three
 * renderings of an amount at once — `text`, `plain` and `accessibleLabel`. No assertion below was
 * weakened to fit those names.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ValueState } from "@/modules/data-service/envelope";
import {
  MoneyOperationError,
  addMinor,
  allocateMinor,
  compareMinor,
  minorUnitsOf,
  negateMinor,
  sumMinor,
  type MinorUnits,
  type Money,
  type MoneyOperationErrorCode,
} from "@/modules/money/amount";
import { UNKNOWN_CURRENCY, exponentOf, isKnownCurrency } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";

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

/** The three renderings `formatMinor` reports for one amount, named from its own return type. */
type Rendering = ReturnType<typeof formatMinor>;

/**
 * The six facts a value can be in, keyed by the union imported from the read envelope.
 *
 * The `Record<ValueState, true>` annotation is what makes this list exhaustive in both directions:
 * a member added to the union fails to compile here for want of a key, and a seventh state invented
 * here fails because the union has no such member. The union itself stays declared once, in
 * `@/modules/data-service/envelope`, and is never restated in this file.
 */
const ALL_VALUE_STATES: Readonly<Record<ValueState, true>> = {
  value: true,
  zero: true,
  unknown: true,
  withheld: true,
  unavailable: true,
  "incomplete-subtotal": true,
};

/**
 * The members of {@link ALL_VALUE_STATES}, in declaration order. `Object.keys` answers `string[]`,
 * so the one cast in this file restores the key type the annotation above already established.
 */
const VALUE_STATE_ORDER = Object.keys(ALL_VALUE_STATES) as readonly ValueState[];

/**
 * Renders one amount under every state, so the cases below compare the same amount across states
 * rather than six unrelated amounts. `en-US` is stated explicitly: `formatMinor` reads no ambient
 * locale, and a case that left it out could not show that.
 */
function renderEveryState(amount: Money): ReadonlyMap<ValueState, Rendering> {
  return new Map<ValueState, Rendering>(
    VALUE_STATE_ORDER.map((state) => [state, formatMinor(amount, state, "en-US")] as const),
  );
}

/** The rendering for `state`, refusing to treat an absent entry as an empty rendering. */
function renderingOf(renderings: ReadonlyMap<ValueState, Rendering>, state: ValueState): Rendering {
  const rendering = renderings.get(state);
  if (rendering === undefined) {
    throw new Error(`no rendering was produced for the value state "${state}"`);
  }
  return rendering;
}

/**
 * How many digits follow the decimal separator in an amount's machine-stable form. `plain` is the
 * form with no grouping and a `.` separator, so the count is the currency exponent made visible:
 * the whole point of the model is that this number equals `exponentOf(currency)`, which a
 * two-decimal assumption cannot satisfy for KWD or JPY.
 */
function fractionalDigitsOf(rendering: Rendering): number {
  const amount = rendering.plain.split(" ")[0] ?? "";
  const separator = amount.indexOf(".");
  return separator === -1 ? 0 : amount.length - separator - 1;
}

/** True when a rendering carries any digit at all — the test for "this is not a number". */
function carriesDigits(rendering: Rendering): boolean {
  return /\d/.test(rendering.text);
}

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

describe("the currency table", () => {
  it.each([
    { currency: "KWD", exponent: 3 },
    { currency: "JPY", exponent: 0 },
    { currency: "USD", exponent: 2 },
    { currency: "EUR", exponent: 2 },
  ])("resolves $currency to $exponent decimal places", ({ currency, exponent }) => {
    // The seeded widths of AAP 0.8.7 and assumption A14 are asserted through the table rather than
    // through a literal rendering, so a table that gained a wrong width cannot hide behind
    // formatting that assumed two decimals everywhere.
    expect(exponentOf(currency)).toBe(exponent);
    expect(isKnownCurrency(currency)).toBe(true);
  });

  it("keeps an exponent of zero distinct from an absent exponent", () => {
    // JPY is the case an `if (!exponent)` shortcut gets wrong: `0` is a resolved exponent, and only
    // an absent one means the currency is unknown. A seven-digit JPY amount would otherwise be
    // rendered as though it were a major-unit figure with no minor unit at all.
    expect(exponentOf("JPY")).toBe(0);
    expect(exponentOf("JPY")).not.toBeUndefined();
    expect(isKnownCurrency("JPY")).toBe(true);
  });

  it.each([UNKNOWN_CURRENCY, UNLISTED_CURRENCY, "usd", ""])(
    'holds no exponent and no recognition for "$currency"',
    (currency) => {
      // A code the table does not hold yields no exponent at all, which is what stops the amount
      // from being rendered, summed or compared as though it had two decimals. The non-canonical
      // `usd` is here because the table matches exactly: normalising it would let a stored code
      // differ from the one trusted at read time.
      expect(exponentOf(currency)).toBeUndefined();
      expect(isKnownCurrency(currency)).toBe(false);
    },
  );
});

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

describe("exact integer arithmetic", () => {
  it("sums five KWD amounts into the exact integer", () => {
    const parts = [1, 2, 3, 4, 5].map((units) => money("KWD", units));
    const total = parts.reduce((running, part) => addMinor(running, part), money("KWD", 0));
    expect(total.currency).toBe("KWD");
    expect(total.minorUnits).toBe(15);
    expect(Number.isInteger(total.minorUnits)).toBe(true);
  });

  it("stays exact over a hundred repeated additions", () => {
    // An accumulator of major-unit floats would leave a binary fraction inside this total, and the
    // fraction would then have to be rounded away somewhere. A count of minor units cannot produce
    // it, so the total is compared against the exact integer rather than against a tolerance.
    let running = money("USD", 0);
    for (let index = 0; index < 100; index += 1) {
      running = addMinor(running, money("USD", 1));
    }
    expect(running.minorUnits).toBe(100);
    expect(Number.isInteger(running.minorUnits)).toBe(true);
    expect(addMinor(money("USD", 10), money("USD", 20)).minorUnits).toBe(30);
  });

  it("keeps a total at the top of the safe range exact and refuses one beyond it", () => {
    const total = addMinor(money("USD", Number.MAX_SAFE_INTEGER - 1), money("USD", 1));
    expect(total.minorUnits).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isInteger(total.minorUnits)).toBe(true);
    // A major-unit number would already have lost a cent at this magnitude and a float well before
    // it, so the total is exact or it is refused — never approximated.
    expect(
      refusalCode(() => addMinor(money("USD", Number.MAX_SAFE_INTEGER), money("USD", 1))),
    ).toBe("unsafe-minor-units");
  });

  it("orders amounts through compareMinor's -1, 0 and 1, and sorts by it", () => {
    expect(compareMinor(money("USD", 1250), money("USD", 1250))).toBe(0);
    expect(compareMinor(money("USD", 1200), money("USD", 1250))).toBe(-1);
    expect(compareMinor(money("USD", 1250), money("USD", 1200))).toBe(1);
    // The extremes are where a subtraction-based comparison would overflow into a wrong sign.
    expect(
      compareMinor(money("USD", Number.MAX_SAFE_INTEGER), money("USD", -Number.MAX_SAFE_INTEGER)),
    ).toBe(1);
    expect(
      compareMinor(money("USD", -Number.MAX_SAFE_INTEGER), money("USD", Number.MAX_SAFE_INTEGER)),
    ).toBe(-1);

    const sorted = [money("JPY", 900), money("JPY", -100), money("JPY", 0), money("JPY", 5)]
      .sort((left, right) => compareMinor(left, right))
      .map((amount) => amount.minorUnits);
    expect(sorted).toEqual([-100, 0, 5, 900]);
  });

  it("refuses KWD against JPY rather than truncating one to the other's exponent", () => {
    const kwd = money("KWD", 1250);
    const jpy = money("JPY", 1250);
    // `1250` means 1.250 KWD and also 1250 JPY, so adding or ordering the two would need a rate
    // this application does not hold. Truncating KWD to whole dinars would silently discard 250
    // fils, which is why the answer is a refusal and not a value.
    expect(refusalCode(() => addMinor(kwd, jpy))).toBe("currency-mismatch");
    expect(refusalCode(() => compareMinor(kwd, jpy))).toBe("currency-mismatch");
    // The refusal returned no value at all, so nothing was rebased on the way: both operands still
    // carry the exact integer their own currency's exponent gives them meaning in.
    expect(kwd.minorUnits).toBe(1250);
    expect(jpy.minorUnits).toBe(1250);
    expect(exponentOf(kwd.currency)).toBe(3);
    expect(exponentOf(jpy.currency)).toBe(0);
  });

  it("partitions a mixed-currency sum per currency and never totals across them", () => {
    const result = sumMinor([money("USD", 500), money("EUR", 300), money("USD", 700)]);
    // One figure across these currencies would state a number this application cannot know, so the
    // partition is the only honest answer — and the result carries no combined field that a
    // surface could present as one.
    expect(result.totals).toEqual([
      { currency: "EUR", minorUnits: 300 },
      { currency: "USD", minorUnits: 1200 },
    ]);
    expect(result.unsurmmed).toEqual([]);
    expect("total" in result).toBe(false);
    expect(result.totals.every((total) => Number.isInteger(total.minorUnits))).toBe(true);
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

  it("assigns the remainder of a three-way split rather than losing it", () => {
    const total = money("KWD", 100);
    const parts = allocateMinor(total, [1, 1, 1]);
    // 100 units cannot divide into three, so one part takes the odd unit: the alternative — three
    // parts of 33 — would drop a unit of a real gift from every surface that shows the parts.
    expect(parts.map((part) => part.minorUnits)).toEqual([34, 33, 33]);
    expect(parts.every((part) => part.currency === "KWD")).toBe(true);
    expect(parts.reduce((sum, part) => sum + part.minorUnits, 0)).toBe(total.minorUnits);
    expect(parts.every((part) => Number.isInteger(part.minorUnits))).toBe(true);
  });
});

describe("rendering an amount through its currency exponent", () => {
  it.each([
    { currency: "KWD", exponent: 3 },
    { currency: "JPY", exponent: 0 },
    { currency: "USD", exponent: 2 },
    { currency: "EUR", exponent: 2 },
  ])("writes $currency with exactly $exponent fractional digits", ({ currency, exponent }) => {
    const rendering = formatMinor(money(currency, 1250), "value", "en-US");
    // The count is compared against the table's own exponent as well as the expected one, so a
    // formatter that assumed two decimals would fail here for KWD and for JPY rather than pass a
    // literal string that happened to match.
    expect(fractionalDigitsOf(rendering)).toBe(exponent);
    expect(fractionalDigitsOf(rendering)).toBe(exponentOf(currency));
  });

  it("keeps every digit of an amount a floating-point scale would round away", () => {
    const rendering = formatMinor(money("KWD", 1_000_005), "value", "en-US");
    // 1000.005 KWD. The trailing fils survive because the digits are cut from the integer and the
    // exponent; converting the same amount to a major-unit number is not exact in binary, so this
    // is the case that catches a float scale or a rounding call in the formatter.
    expect(rendering.plain.split(" ")[0]).toBe("1000.005");
    expect(fractionalDigitsOf(rendering)).toBe(3);
    expect(rendering.plain.endsWith("KWD")).toBe(true);
  });

  it("pads an amount smaller than one minor unit to the currency's precision", () => {
    expect(formatMinor(money("KWD", 5), "value", "en-US").plain.split(" ")[0]).toBe("0.005");
    expect(formatMinor(money("USD", 5), "value", "en-US").plain.split(" ")[0]).toBe("0.05");
    expect(formatMinor(money("JPY", 5), "value", "en-US").plain.split(" ")[0]).toBe("5");
  });

  it("states the currency code it was given rather than a symbol of its own choosing", () => {
    // No symbol table exists beside the currency table, so the code is always shown as stored and
    // two amounts of different currencies can never be made to look alike.
    expect(formatMinor(money("EUR", 1250), "value", "en-US").plain).toBe("12.50 EUR");
    expect(formatMinor(money("USD", 1250), "value", "en-US").plain).toBe("12.50 USD");
    expect(formatMinor(money("KWD", 1250), "value", "en-US").plain).toBe("1.250 KWD");
    expect(formatMinor(money("JPY", 1250), "value", "en-US").plain).toBe("1250 JPY");
  });
});

describe("every value state renders as its own fact", () => {
  const renderings = renderEveryState(money("KWD", 1250));

  it("covers all six members of the read envelope's union, and no seventh", () => {
    // Derived from the `Record<ValueState, true>` annotation, so this number is the union's own
    // size rather than a count written down here.
    expect(VALUE_STATE_ORDER).toHaveLength(6);
  });

  it("keeps the six states distinct as text and as accessible labels", () => {
    for (const [index, leftState] of VALUE_STATE_ORDER.entries()) {
      for (const rightState of VALUE_STATE_ORDER.slice(index + 1)) {
        const left = renderingOf(renderings, leftState);
        const right = renderingOf(renderings, rightState);
        // A genuine zero, an unknown amount, a withheld amount and an unavailable source must
        // never share a rendering: an equality here is the defect the criterion names.
        expect(left.text).not.toBe(right.text);
        // The label carries the distinction for a screen-reader user, so it is asserted separately
        // rather than assumed to follow the visible text.
        expect(left.accessibleLabel).not.toBe(right.accessibleLabel);
      }
    }
  });

  it("never renders a state as an empty or single-word cell", () => {
    for (const state of VALUE_STATE_ORDER) {
      const rendering = renderingOf(renderings, state);
      expect(rendering.text.length).toBeGreaterThan(0);
      expect(rendering.plain.length).toBeGreaterThan(0);
      // The label names the fact in a sentence, so it is always longer than the value it names.
      expect(rendering.accessibleLabel.length).toBeGreaterThan(rendering.text.length);
    }
  });

  it("renders a genuine zero as digits while unknown, withheld and unavailable carry none", () => {
    // The two commonest defects are `unknown` shown as `0` and `unavailable` shown as an empty
    // cell; both are caught by asserting the absence of any digit, on the machine-stable form as
    // well as the display form, because `plain` is what reaches a CSV cell and the print model.
    const zero = renderingOf(renderings, "zero");
    expect(carriesDigits(zero)).toBe(true);
    expect(zero.plain.split(" ")[0]).toBe("0.000");

    for (const state of ["unknown", "withheld", "unavailable"] as const) {
      const rendering = renderingOf(renderings, state);
      expect(carriesDigits(rendering)).toBe(false);
      expect(/\d/.test(rendering.plain)).toBe(false);
      // No other state's words stand in for this one.
      expect(rendering.text).not.toBe(renderingOf(renderings, "zero").text);
    }
  });

  it("marks an incomplete subtotal as a number that is not a complete total", () => {
    const incomplete = renderingOf(renderings, "incomplete-subtotal");
    expect(carriesDigits(incomplete)).toBe(true);
    // The state is derived by the read envelope from a partial period and is never chosen by a
    // caller; this case proves only that, once it arrives, the figure cannot pass as a total.
    expect(incomplete.text).not.toBe(renderingOf(renderings, "value").text);
    expect(incomplete.text.toLowerCase()).toContain("incomplete");
    expect(incomplete.accessibleLabel.toLowerCase()).toContain("incomplete");
  });
});

describe("an amount of an unknown currency", () => {
  const amount = money(UNKNOWN_CURRENCY, 1250);

  it("renders as an unknown-currency amount rather than a two-decimal one", () => {
    const rendering = formatMinor(amount, "value", "en-US");
    // No exponent exists for this code, so there is no fractional part and no default to fall back
    // on: the exact integer minor units, the code as stored, and an explicit statement.
    expect(rendering.plain).not.toMatch(/^\d+\.\d{2}\b/);
    expect(rendering.plain).toContain("1250");
    expect(rendering.plain).toContain(UNKNOWN_CURRENCY);
    expect(rendering.plain).toContain("currency unknown");
    expect(rendering.accessibleLabel).toContain("currency unknown");
  });

  it("substitutes no other currency for it", () => {
    const rendering = formatMinor(amount, "value", "en-US");
    for (const marker of ["$", "€", "USD", "EUR", "KWD", "JPY"]) {
      expect(rendering.text).not.toContain(marker);
      expect(rendering.plain).not.toContain(marker);
    }
  });

  it("cannot be summed or compared with a known currency", () => {
    const known = money("USD", 500);
    const { totals, unsurmmed } = sumMinor([amount, known]);
    // The known amount stands alone and the unknown one is handed back, so it is rendered as an
    // unknown-currency fact rather than folded into — or dropped from — the USD figure.
    expect(totals).toEqual([{ currency: "USD", minorUnits: 500 }]);
    expect(unsurmmed).toEqual([amount]);
    expect(refusalCode(() => addMinor(amount, known))).toBe("unknown-currency");
    expect(refusalCode(() => compareMinor(amount, known))).toBe("unknown-currency");
  });
});

describe("the financial modules' source", () => {
  /** The modules that total an amount or write one into an export, read here rather than imported. */
  const FINANCIAL_MODULES = [
    "../../src/modules/support/report.ts",
    "../../src/modules/export/csv.ts",
    "../../src/modules/export/neutralize.ts",
  ] as const;

  /** The files this scan must actually reach: every money module, plus those three. */
  const REQUIRED_FILES = [
    "currency.ts",
    "amount.ts",
    "format.ts",
    "report.ts",
    "csv.ts",
    "neutralize.ts",
  ] as const;

  /**
   * The identifier shapes a financial path must never contain. Each pattern matches an identifier
   * rather than a whole line, so a comment that names an amount is not mistaken for arithmetic,
   * while a parse, a rounding call or a division of an integer to reach major units is.
   */
  const FLOATING_POINT_SHAPES: readonly RegExp[] = [
    /\bparseFloat\b/,
    /\.\s*toFixed\s*\(/,
    /\bNumber\s*\([^()]*\)\s*\/\s*100\b/,
  ];

  /** Every file under `src/modules/money/` plus the three named financial modules, as URLs. */
  function sourceFiles(): readonly URL[] {
    const moneyDirectory = new URL("../../src/modules/money/", import.meta.url);
    const moneyModules = readdirSync(moneyDirectory)
      .filter((entry) => entry.endsWith(".ts"))
      .sort()
      .map((entry) => new URL(entry, moneyDirectory));
    return [...moneyModules, ...FINANCIAL_MODULES.map((path) => new URL(path, import.meta.url))];
  }

  it("keeps floating-point parsing and rounding out of every money, report and export path", () => {
    const files = sourceFiles();
    const names = files.map((file) => fileURLToPath(file).split("/").pop() ?? "");
    // A base URL that resolved to the wrong directory would make this scan pass vacuously, so the
    // files it means to read are named before any of them is read.
    for (const required of REQUIRED_FILES) {
      expect(names).toContain(required);
    }

    const offenders = files.flatMap((file) => {
      const path = fileURLToPath(file);
      const source = readFileSync(file, "utf8");
      return FLOATING_POINT_SHAPES.flatMap((shape) => {
        const match = shape.exec(source);
        return match === null ? [] : [`${path} matches ${shape.source} at "${match[0]}"`];
      });
    });

    // AAP 0.8.1's rule that no floating-point arithmetic touches a financial value holds only where
    // it is checked, and Rule 1 clause 3 asks for that check and nothing beyond it. The failure
    // names the offending file, so the defect is a line to open rather than a hunt.
    expect(offenders).toEqual([]);
  });
});

describe("the test environment", () => {
  it("loads no DOM, which is what keeps this a domain test", () => {
    // `tests/domain` imports the modules directly, so a component claim belongs to the Playwright
    // specs instead. This single assertion is the folder's proof that no DOM was loaded to make
    // one: it is the only assertion of its kind in the suite (AAP 0.11.1).
    expect(typeof document).toBe("undefined");
  });
});

describe("the minor-unit brand", () => {
  it("is enforced by the compiler rather than by convention", () => {
    // AAP 0.15.2 permits a documented, justified suppression, and this directive is the file's
    // single one: the suppression is the assertion. If `MinorUnits` ever loses its brand the
    // directive becomes an unused one, which is itself a compile error, so the check cannot rot.
    // @ts-expect-error a bare number is not a branded minor-unit count
    const unbranded: MinorUnits = 100;
    expect(unbranded).toBe(100);
  });
});
