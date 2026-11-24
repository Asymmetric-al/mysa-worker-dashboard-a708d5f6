/** Proves the money module's exact-integer contract at the currency boundary: an amount whose currency has no exponent is refused by every operation the module header names — negation included. */ import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ValueState } from "@/modules/data-service/envelope";
import { MoneyOperationError, addMinor, allocateMinor, compareMinor, minorUnitsOf, negateMinor, sumMinor, type MinorUnits, type Money, type MoneyOperationErrorCode } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY, exponentOf, isKnownCurrency } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";
import { throwing } from "../helpers/answers";
const money = (currency: string, minorUnits: number): Money => ({ currency, minorUnits: minorUnitsOf(minorUnits) });
function refusalCode(operation: () => unknown): MoneyOperationErrorCode {
  try {
    operation();
  } catch (error) {
    if (error instanceof MoneyOperationError) return error.code;
    throw error;
  }
  throw new Error("expected the operation to be refused, but it returned a value");
}
const UNLISTED_CURRENCY = "ZZZ";
type Rendering = ReturnType<typeof formatMinor>;
const ALL_VALUE_STATES: Readonly<Record<ValueState, true>> = { value: true, zero: true, unknown: true, withheld: true, unavailable: true, "incomplete-subtotal": true };
const VALUE_STATE_ORDER = Object.keys(ALL_VALUE_STATES) as readonly ValueState[];
const renderEveryState = (amount: Money): ReadonlyMap<ValueState, Rendering> => new Map<ValueState, Rendering>(VALUE_STATE_ORDER.map((state) => [state, formatMinor(amount, state, "en-US")] as const));
const renderingOf = (renderings: ReadonlyMap<ValueState, Rendering>, state: ValueState): Rendering => renderings.get(state) ?? throwing(`no rendering was produced for the value state "${state}"`);
function fractionalDigitsOf(rendering: Rendering): number {
  const amount = rendering.plain.split(" ")[0] ?? "";
  const separator = amount.indexOf(".");
  return separator === -1 ? 0 : amount.length - separator - 1;
}
const carriesDigits = (rendering: Rendering): boolean => /\d/.test(rendering.text);
type Refusal = { readonly operation: string; readonly run: (amount: Money) => unknown };
const REFUSALS: readonly Refusal[] = [
  { operation: "negateMinor", run: (amount) => negateMinor(amount) },
  { operation: "addMinor", run: (amount) => addMinor(amount, money("USD", 100)) },
  { operation: "compareMinor", run: (amount) => compareMinor(amount, money("USD", 100)) },
  { operation: "allocateMinor", run: (amount) => allocateMinor(amount, [40, 60]) },
];
type CurrencyExponent = { readonly currency: string; readonly exponent: number };
const CURRENCY_EXPONENTS: readonly CurrencyExponent[] = [
  { currency: "KWD", exponent: 3 },
  { currency: "JPY", exponent: 0 },
  { currency: "USD", exponent: 2 },
  { currency: "EUR", exponent: 2 },
];
describe("the currency table", () => {
  it.each(CURRENCY_EXPONENTS)("resolves $currency to $exponent decimal places", ({ currency, exponent }) => expect([exponentOf(currency), isKnownCurrency(currency)]).toEqual([exponent, true]));
  it("keeps an exponent of zero distinct from an absent exponent", () => {
    expect(exponentOf("JPY")).toBe(0);
    expect(exponentOf("JPY")).not.toBeUndefined();
    expect(isKnownCurrency("JPY")).toBe(true);
  });
  it.each([UNKNOWN_CURRENCY, UNLISTED_CURRENCY, "usd", ""])('holds no exponent and no recognition for "$currency"', (currency) => {
    expect(exponentOf(currency)).toBeUndefined();
    expect(isKnownCurrency(currency)).toBe(false);
  });
});
describe("an amount whose currency has no exponent", () => {
  it.each([UNKNOWN_CURRENCY, UNLISTED_CURRENCY].flatMap((currency) => REFUSALS.map(({ operation, run }) => ({ operation, currency, run }))))("refuses $operation for a $currency amount", ({ currency, run }) => {
    const amount = money(currency, 1250);
    expect(() => run(amount)).toThrow(MoneyOperationError);
    expect(refusalCode(() => run(amount))).toBe("unknown-currency");
  });
  it("survives only in sumMinor's unsurmmed list, in input order beside the known total", () => {
    const { totals, unsurmmed } = sumMinor([money("USD", 500), money(UNKNOWN_CURRENCY, 1250), money("USD", 700), money(UNLISTED_CURRENCY, 40)]);
    expect([totals, unsurmmed.map((amount) => amount.currency), unsurmmed.map((amount) => amount.minorUnits)]).toEqual([[{ currency: "USD", minorUnits: 1200 }], [UNKNOWN_CURRENCY, UNLISTED_CURRENCY], [1250, 40]]);
  });
});
it("exact integer arithmetic: sums five KWD amounts into the exact integer", () => {
  const parts = [1, 2, 3, 4, 5].map((units) => money("KWD", units));
  const total = parts.reduce((running, part) => addMinor(running, part), money("KWD", 0));
  expect([total.currency, total.minorUnits, Number.isInteger(total.minorUnits)]).toEqual(["KWD", 15, true]);
});
it("exact integer arithmetic: stays exact over a hundred repeated additions", () => {
  let running = money("USD", 0);
  for (let index = 0; index < 100; index += 1) running = addMinor(running, money("USD", 1));
  expect([running.minorUnits, Number.isInteger(running.minorUnits), addMinor(money("USD", 10), money("USD", 20)).minorUnits]).toEqual([100, true, 30]);
});
it("exact integer arithmetic: keeps a total at the top of the safe range exact and refuses one beyond it", () => {
  const total = addMinor(money("USD", Number.MAX_SAFE_INTEGER - 1), money("USD", 1));
  expect([total.minorUnits, Number.isInteger(total.minorUnits), refusalCode(() => addMinor(money("USD", Number.MAX_SAFE_INTEGER), money("USD", 1)))]).toEqual([Number.MAX_SAFE_INTEGER, true, "unsafe-minor-units"]);
});
it("exact integer arithmetic: orders amounts through compareMinor's -1, 0 and 1, and sorts by it", () => {
  expect([compareMinor(money("USD", 1250), money("USD", 1250)), compareMinor(money("USD", 1200), money("USD", 1250)), compareMinor(money("USD", 1250), money("USD", 1200))]).toEqual([0, -1, 1]);
  expect([compareMinor(money("USD", Number.MAX_SAFE_INTEGER), money("USD", -Number.MAX_SAFE_INTEGER)), compareMinor(money("USD", -Number.MAX_SAFE_INTEGER), money("USD", Number.MAX_SAFE_INTEGER))]).toEqual([1, -1]); // The extremes are where a subtraction-based comparison would overflow into a wrong sign.
  const sorted = [money("JPY", 900), money("JPY", -100), money("JPY", 0), money("JPY", 5)].sort((left, right) => compareMinor(left, right)).map((amount) => amount.minorUnits);
  expect(sorted).toEqual([-100, 0, 5, 900]);
});
it("exact integer arithmetic: refuses KWD against JPY rather than truncating one to the other's exponent", () => {
  const kwd = money("KWD", 1250);
  const jpy = money("JPY", 1250);
  expect([refusalCode(() => addMinor(kwd, jpy)), refusalCode(() => compareMinor(kwd, jpy)), kwd.minorUnits, jpy.minorUnits, exponentOf(kwd.currency), exponentOf(jpy.currency)]).toEqual(["currency-mismatch", "currency-mismatch", 1250, 1250, 3, 0]);
});
it("exact integer arithmetic: partitions a mixed-currency sum per currency and never totals across them", () => {
  const result = sumMinor([money("USD", 500), money("EUR", 300), money("USD", 700)]);
  expect(result.totals).toEqual([
    { currency: "EUR", minorUnits: 300 },
    { currency: "USD", minorUnits: 1200 },
  ]);
  expect([result.unsurmmed, ["total" in result, result.totals.every((total) => Number.isInteger(total.minorUnits))]]).toEqual([[], [false, true]]);
});
describe("negating a known currency", () => {
  it.each([
    { currency: "USD", exponent: 2, minorUnits: 1250, expected: -1250 },
    { currency: "KWD", exponent: 3, minorUnits: 12_500, expected: -12_500 },
    { currency: "JPY", exponent: 0, minorUnits: 0, expected: 0 },
    { currency: "KWD", exponent: 3, minorUnits: 1250, expected: -1250 },
  ])("reverses a $currency amount by exact minor units, on the code's own exponent and with no negative zero", ({ currency, exponent, minorUnits, expected }) => {
    const result = negateMinor(money(currency, minorUnits));
    // The zero is asserted through `Object.is`, because `toBe(0)` would pass for `-0`, which every downstream equality on canonical minor units would then reject.
    expect([exponentOf(currency), result.currency, result.minorUnits, Object.is(result.minorUnits, expected)]).toEqual([exponent, currency, expected, true]);
  });
});
it("splitting an amount: splits 100 minor units 40/60 with nothing created and nothing lost", () => {
  const total = money("USD", 100);
  const parts = allocateMinor(total, [40, 60]);
  expect([parts.map((part) => part.minorUnits), [parts.every((part) => part.currency === "USD"), parts.reduce((sum, part) => sum + part.minorUnits, 0)], sumMinor(parts).totals, sumMinor(parts).unsurmmed]).toEqual([[40, 60], [true, total.minorUnits], [{ currency: "USD", minorUnits: 100 }], []]);
});
it("splitting an amount: assigns the remainder of a three-way split rather than losing it", () => {
  const total = money("KWD", 100);
  const parts = allocateMinor(total, [1, 1, 1]);
  // 100 units cannot divide into three, so one part takes the odd unit: the alternative — three parts of 33 — would drop a unit of a real gift from every surface that shows the parts.
  expect([parts.map((part) => part.minorUnits), [parts.every((part) => part.currency === "KWD"), parts.reduce((sum, part) => sum + part.minorUnits, 0), parts.every((part) => Number.isInteger(part.minorUnits))]]).toEqual([
    [34, 33, 33],
    [true, total.minorUnits, true],
  ]);
});
describe("rendering an amount through its currency exponent", () => {
  it.each(CURRENCY_EXPONENTS)("writes $currency with exactly $exponent fractional digits", ({ currency, exponent }) => {
    const rendering = formatMinor(money(currency, 1250), "value", "en-US");
    expect([fractionalDigitsOf(rendering), fractionalDigitsOf(rendering)]).toEqual([exponent, exponentOf(currency)]);
  });
  it("keeps every digit of an amount a floating-point scale would round away", () => {
    const rendering = formatMinor(money("KWD", 1_000_005), "value", "en-US");
    // 1000.005 KWD. The trailing fils survive because the digits are cut from the integer and the exponent; converting the same amount to a major-unit number is not exact in binary, so this is the case that catches a float scale or a rounding call in the formatter.
    expect([rendering.plain.split(" ")[0], fractionalDigitsOf(rendering), rendering.plain.endsWith("KWD")]).toEqual(["1000.005", 3, true]);
  });
  it("pads an amount smaller than one minor unit to the currency's precision", () =>
    expect([formatMinor(money("KWD", 5), "value", "en-US").plain.split(" ")[0], formatMinor(money("USD", 5), "value", "en-US").plain.split(" ")[0], formatMinor(money("JPY", 5), "value", "en-US").plain.split(" ")[0]]).toEqual(["0.005", "0.05", "5"]));
  it("states the currency code it was given rather than a symbol of its own choosing", () => {
    expect([formatMinor(money("EUR", 1250), "value", "en-US").plain, formatMinor(money("USD", 1250), "value", "en-US").plain, formatMinor(money("KWD", 1250), "value", "en-US").plain]).toEqual(["12.50 EUR", "12.50 USD", "1.250 KWD"]);
    expect(formatMinor(money("JPY", 1250), "value", "en-US").plain).toBe("1250 JPY");
  });
});
describe("a locale's separators", () => {
  const separatorBatch = (): readonly Rendering[] => Array.from({ length: 50 }, (_unused, position) => formatMinor(money("USD", 123_456 + position), "value", "de-DE"));
  it("are computed once for the locale and reused by every later amount in it", () => {
    const constructions = vi.spyOn(Intl, "NumberFormat");
    try {
      const first = separatorBatch();
      expect(constructions).toHaveBeenCalledTimes(1); // Fifty renderings, one construction: the separators are a function of the locale tag alone, so a second construction for the same tag would be work whose answer the formatter already holds.
      expect(separatorBatch()).toEqual(first);
      expect(constructions).toHaveBeenCalledTimes(1);
      expect(first[0]?.text).toBe("1.234,56 USD"); // The reused separators are the locale's own and not the fallback the formatter keeps for a tag it cannot use, which is what makes holding them worth anything.
    } finally {
      constructions.mockRestore();
    }
  });
  it("are held for a bounded number of tags, so a stream of tags cannot grow module state for ever", () => {
    const firstTag = "x-money01";
    const original = formatMinor(money("USD", 123_456), "value", firstTag);
    const tags = Array.from({ length: 40 }, (_unused, position) => `x-money${String(position + 2).padStart(2, "0")}`);
    const constructions = vi.spyOn(Intl, "NumberFormat");
    try {
      for (const tag of tags) formatMinor(money("USD", 123_456), "value", tag);
      expect(constructions.mock.calls.length).toBeGreaterThan(0);
      const beforeRepeat = constructions.mock.calls.length;
      const repeated = formatMinor(money("USD", 123_456), "value", firstTag);
      expect([constructions.mock.calls.length, repeated]).toEqual([beforeRepeat + 1, original]); // More distinct tags than the separators are kept for empties the cache, so the first tag is computed once more rather than answered from a map that would grow without limit.
    } finally {
      constructions.mockRestore();
    }
  });
  it("keep the fallback for a malformed tag, on every rendering of it, instead of throwing", () => {
    const render = (): Rendering => formatMinor(money("USD", 123_456), "value", "en_US");
    expect(render).not.toThrow();
    const first = render();
    expect([render(), first.text, first.plain]).toEqual([first, "1,234.56 USD", "1234.56 USD"]); // The fallback groups with a comma every three digits and puts a dot before the cents, and the plain form carries no grouping at all, so a refused tag renders exactly as it did before the separators were held.
  });
});
describe("every value state renders as its own fact", () => {
  const renderings = renderEveryState(money("KWD", 1250));
  it("covers all six members of the read envelope's union, and no seventh", () => expect(VALUE_STATE_ORDER).toHaveLength(6));
  it("keeps the six states distinct as text and as accessible labels", () => {
    for (const [index, leftState] of VALUE_STATE_ORDER.entries()) {
      for (const rightState of VALUE_STATE_ORDER.slice(index + 1)) {
        const left = renderingOf(renderings, leftState);
        const right = renderingOf(renderings, rightState);
        expect(left.text).not.toBe(right.text);
        expect(left.accessibleLabel).not.toBe(right.accessibleLabel);
      }
    }
  });
  it("never renders a state as an empty or single-word cell", () => {
    for (const state of VALUE_STATE_ORDER) {
      const rendering = renderingOf(renderings, state);
      for (const value of [rendering.text.length, rendering.plain.length]) expect(value).toBeGreaterThan(0);
      expect(rendering.accessibleLabel.length).toBeGreaterThan(rendering.text.length);
    }
  });
  it("renders a genuine zero as digits while unknown, withheld and unavailable carry none", () => {
    // The two commonest defects are `unknown` shown as `0` and `unavailable` shown as an empty cell; both are caught by asserting the absence of any digit, on the machine-stable form as well as the display form, because `plain` is what reaches a CSV cell and the print model.
    const zero = renderingOf(renderings, "zero");
    expect([carriesDigits(zero), zero.plain.split(" ")[0]]).toEqual([true, "0.000"]);
    for (const state of ["unknown", "withheld", "unavailable"] as const) {
      const rendering = renderingOf(renderings, state);
      expect([carriesDigits(rendering), /\d/.test(rendering.plain)]).toEqual([false, false]);
      expect(rendering.text).not.toBe(renderingOf(renderings, "zero").text);
    }
  });
  it("marks an incomplete subtotal as a number that is not a complete total", () => {
    const incomplete = renderingOf(renderings, "incomplete-subtotal");
    expect(carriesDigits(incomplete)).toBe(true);
    expect(incomplete.text).not.toBe(renderingOf(renderings, "value").text);
    expect(incomplete.text.toLowerCase()).toContain("incomplete");
    expect(incomplete.accessibleLabel.toLowerCase()).toContain("incomplete");
  });
});
describe("an amount of an unknown currency", () => {
  const amount = money(UNKNOWN_CURRENCY, 1250);
  it("renders as an unknown-currency amount rather than a two-decimal one", () => {
    const rendering = formatMinor(amount, "value", "en-US");
    expect(rendering.plain).not.toMatch(/^\d+\.\d{2}\b/);
    for (const needle of ["1250", UNKNOWN_CURRENCY, "currency unknown"]) expect(rendering.plain).toContain(needle);
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
    expect([totals, unsurmmed, [refusalCode(() => addMinor(amount, known)), refusalCode(() => compareMinor(amount, known))]]).toEqual([[{ currency: "USD", minorUnits: 500 }], [amount], ["unknown-currency", "unknown-currency"]]);
  });
});
describe("the financial modules' source", () => {
  const FINANCIAL_MODULES = ["../../src/modules/support/report.ts", "../../src/modules/support/goal.ts", "../../src/modules/support/buckets.ts", "../../src/modules/support/basis.ts", "../../src/modules/data-service/reads/support.ts", "../../src/modules/export/csv.ts", "../../src/modules/export/neutralize.ts"] as const;
  const REQUIRED_FILES = ["currency.ts", "amount.ts", "format.ts", "report.ts", "goal.ts", "buckets.ts", "basis.ts", "support.ts", "csv.ts", "neutralize.ts"] as const;
  const FLOATING_POINT_SHAPES: readonly RegExp[] = [/\bparseFloat\b/, /\.\s*toFixed\s*\(/, /\bNumber\s*\([^()]*\)\s*\/\s*100\b/];
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
    for (const required of REQUIRED_FILES) expect(names).toContain(required); // A base URL that resolved to the wrong directory would make this scan pass vacuously, so the files it means to read are named before any of them is read.
    const offenders = files.flatMap((file) => {
      const path = fileURLToPath(file);
      const source = readFileSync(file, "utf8");
      return FLOATING_POINT_SHAPES.flatMap((shape) => {
        const match = shape.exec(source);
        return match === null ? [] : [`${path} matches ${shape.source} at "${match[0]}"`];
      });
    });
    expect(offenders).toEqual([]); // AAP 0.8.1's rule that no floating-point arithmetic touches a financial value holds only where it is checked, and Rule 1 clause 3 asks for that check and nothing beyond it. The failure names the offending file, so the defect is a line to open rather than a hunt.
  });
});
it("the test environment: loads no DOM, which is what keeps this a domain test", () => {
  expect(typeof document).toBe("undefined"); // `tests/domain` imports the modules directly, so a component claim belongs to the Playwright specs instead. This single assertion is the folder's proof that no DOM was loaded to make one: it is the only assertion of its kind in the suite (AAP 0.11.1).
});
it("the minor-unit brand: is enforced by the compiler rather than by convention", () => {
  // AAP 0.15.2 permits a documented, justified suppression, and this directive is the file's single one: the suppression is the assertion. If `MinorUnits` ever loses its brand the directive becomes an unused one, which is itself a compile error, so the check cannot rot.
  // @ts-expect-error a bare number is not a branded minor-unit count
  const unbranded: MinorUnits = 100;
  expect(unbranded).toBe(100);
});
