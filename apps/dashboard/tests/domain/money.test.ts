/** Proves the money module's exact-integer contract at the currency boundary: an amount whose currency has no exponent is refused by every operation the module header names — negation included. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ValueState } from "@/modules/data-service/envelope";
import { MoneyOperationError, addMinor, allocateMinor, compareMinor, minorUnitsOf, negateMinor, sumMinor, type MinorUnits, type Money, type MoneyOperationErrorCode } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY, exponentOf, isKnownCurrency } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";
function money(currency: string, minorUnits: number): Money {
  return { currency, minorUnits: minorUnitsOf(minorUnits) };
}
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
function renderEveryState(amount: Money): ReadonlyMap<ValueState, Rendering> {
  return new Map<ValueState, Rendering>(VALUE_STATE_ORDER.map((state) => [state, formatMinor(amount, state, "en-US")] as const));
}
function renderingOf(renderings: ReadonlyMap<ValueState, Rendering>, state: ValueState): Rendering {
  const rendering = renderings.get(state);
  if (rendering === undefined) throw new Error(`no rendering was produced for the value state "${state}"`);
  return rendering;
}
function fractionalDigitsOf(rendering: Rendering): number {
  const amount = rendering.plain.split(" ")[0] ?? "";
  const separator = amount.indexOf(".");
  return separator === -1 ? 0 : amount.length - separator - 1;
}
function carriesDigits(rendering: Rendering): boolean {
  return /\d/.test(rendering.text);
}
type Refusal = { readonly operation: string; readonly run: (amount: Money) => unknown };

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
    expect(exponentOf(currency)).toBe(exponent);
    expect(isKnownCurrency(currency)).toBe(true);
  });
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
    expect(totals).toEqual([{ currency: "USD", minorUnits: 1200 }]);
    expect(unsurmmed.map((amount) => amount.currency)).toEqual([UNKNOWN_CURRENCY, UNLISTED_CURRENCY]);
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
    expect(refusalCode(() => addMinor(money("USD", Number.MAX_SAFE_INTEGER), money("USD", 1)))).toBe("unsafe-minor-units");
  });
  it("orders amounts through compareMinor's -1, 0 and 1, and sorts by it", () => {
    expect(compareMinor(money("USD", 1250), money("USD", 1250))).toBe(0);
    expect(compareMinor(money("USD", 1200), money("USD", 1250))).toBe(-1);
    expect(compareMinor(money("USD", 1250), money("USD", 1200))).toBe(1);
    // The extremes are where a subtraction-based comparison would overflow into a wrong sign.
    expect(compareMinor(money("USD", Number.MAX_SAFE_INTEGER), money("USD", -Number.MAX_SAFE_INTEGER))).toBe(1);
    expect(compareMinor(money("USD", -Number.MAX_SAFE_INTEGER), money("USD", Number.MAX_SAFE_INTEGER))).toBe(-1);
    const sorted = [money("JPY", 900), money("JPY", -100), money("JPY", 0), money("JPY", 5)].sort((left, right) => compareMinor(left, right)).map((amount) => amount.minorUnits);
    expect(sorted).toEqual([-100, 0, 5, 900]);
  });
  it("refuses KWD against JPY rather than truncating one to the other's exponent", () => {
    const kwd = money("KWD", 1250);
    const jpy = money("JPY", 1250);
    expect(refusalCode(() => addMinor(kwd, jpy))).toBe("currency-mismatch");
    expect(refusalCode(() => compareMinor(kwd, jpy))).toBe("currency-mismatch");
    expect(kwd.minorUnits).toBe(1250);
    expect(jpy.minorUnits).toBe(1250);
    expect(exponentOf(kwd.currency)).toBe(3);
    expect(exponentOf(jpy.currency)).toBe(0);
  });
  it("partitions a mixed-currency sum per currency and never totals across them", () => {
    const result = sumMinor([money("USD", 500), money("EUR", 300), money("USD", 700)]);
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
    expect(exponentOf("JPY")).toBe(0);
    const result = negateMinor(money("JPY", 0));
    expect(result.currency).toBe("JPY");
    // `toBe(0)` would pass for `-0`, which every downstream equality on canonical minor units
    // would then reject, so the zero is asserted through `Object.is`.
    expect(Object.is(result.minorUnits, 0)).toBe(true);
  });
  it("keeps a KWD amount on its own three-decimal code", () => {
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
    expect(formatMinor(money("EUR", 1250), "value", "en-US").plain).toBe("12.50 EUR");
    expect(formatMinor(money("USD", 1250), "value", "en-US").plain).toBe("12.50 USD");
    expect(formatMinor(money("KWD", 1250), "value", "en-US").plain).toBe("1.250 KWD");
    expect(formatMinor(money("JPY", 1250), "value", "en-US").plain).toBe("1250 JPY");
  });
});
describe("a locale's separators", () => {
  const SEPARATOR_LOCALE = "de-DE";
  const SEPARATOR_BATCH_SIZE = 50;
  function separatorBatch(): readonly Rendering[] {
    return Array.from({ length: SEPARATOR_BATCH_SIZE }, (_, position) => formatMinor(money("USD", 123_456 + position), "value", SEPARATOR_LOCALE));
  }
  it("are computed once for the locale and reused by every later amount in it", () => {
    const constructions = vi.spyOn(Intl, "NumberFormat");
    try {
      const first = separatorBatch();
      // Fifty renderings, one construction: the separators are a function of the locale tag alone, so a second
      // construction for the same tag would be work whose answer the formatter already holds.
      expect(constructions).toHaveBeenCalledTimes(1);
      const second = separatorBatch();
      expect(second).toEqual(first);
      expect(constructions).toHaveBeenCalledTimes(1);
      // The reused separators are the locale's own and not the fallback the formatter keeps for a tag it cannot
      // use, which is what makes holding them worth anything.
      expect(first[0]?.text).toBe("1.234,56 USD");
    } finally {
      constructions.mockRestore();
    }
  });
  it("are held for a bounded number of tags, so a stream of tags cannot grow module state for ever", () => {
    const firstTag = "x-money01";
    const original = formatMinor(money("USD", 123_456), "value", firstTag);
    // More distinct tags than the separators are kept for, then the first one again: the bound empties the cache, so
    // that tag is computed once more instead of being answered from a map that would otherwise grow without limit.
    const tags = Array.from({ length: 40 }, (_, position) => `x-money${String(position + 2).padStart(2, "0")}`);
    const constructions = vi.spyOn(Intl, "NumberFormat");
    try {
      for (const tag of tags) formatMinor(money("USD", 123_456), "value", tag);
      expect(constructions.mock.calls.length).toBeGreaterThan(0);
      const beforeRepeat = constructions.mock.calls.length;
      const repeated = formatMinor(money("USD", 123_456), "value", firstTag);
      expect(constructions.mock.calls.length).toBe(beforeRepeat + 1);
      expect(repeated).toEqual(original);
    } finally {
      constructions.mockRestore();
    }
  });
  it("keep the fallback for a malformed tag, on every rendering of it, instead of throwing", () => {
    const malformed = "en_US";
    const render = (): Rendering => formatMinor(money("USD", 123_456), "value", malformed);
    expect(render).not.toThrow();
    const first = render();
    const second = render();
    expect(second).toEqual(first);
    // The fallback groups with a comma every three digits and puts a dot before the cents, and the plain form
    // carries no grouping at all, so a refused tag renders exactly as it did before the separators were held.
    expect(first.text).toBe("1,234.56 USD");
    expect(first.plain).toBe("1234.56 USD");
  });
});
describe("every value state renders as its own fact", () => {
  const renderings = renderEveryState(money("KWD", 1250));
  it("covers all six members of the read envelope's union, and no seventh", () => {
    expect(VALUE_STATE_ORDER).toHaveLength(6);
  });
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
      expect(rendering.text.length).toBeGreaterThan(0);
      expect(rendering.plain.length).toBeGreaterThan(0);
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
    expect(totals).toEqual([{ currency: "USD", minorUnits: 500 }]);
    expect(unsurmmed).toEqual([amount]);
    expect(refusalCode(() => addMinor(amount, known))).toBe("unknown-currency");
    expect(refusalCode(() => compareMinor(amount, known))).toBe("unknown-currency");
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
