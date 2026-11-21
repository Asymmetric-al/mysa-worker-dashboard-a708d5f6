/** Proves the owned CSV writer's spreadsheet-formula neutralisation: every cell a spreadsheet would evaluate as a formula is written inert, and every other character of the value survives exactly. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { toCsv } from "@/modules/export/csv";
import * as neutralizer from "@/modules/export/neutralize";
import type { MinorUnits, Money } from "@/modules/money/amount";
import { runReport, type ReportQuery, type ReportResult } from "@/modules/support/report";
const { neutralizeCell } = neutralizer;
const ASCII_TRIGGER_CASES: { readonly trigger: string; readonly name: string; readonly value: string; readonly expected: string }[] = [
  { trigger: "=", name: "an equals sign", value: `=SUM(A1)`, expected: `"\t=SUM(A1)"` },
  { trigger: "+", name: "a plus sign", value: `+SUM(A1)`, expected: `"\t+SUM(A1)"` },
  { trigger: "-", name: "a hyphen-minus", value: `-SUM(A1)`, expected: `"\t-SUM(A1)"` },
  { trigger: "@", name: "a commercial at", value: `@SUM(A1)`, expected: `"\t@SUM(A1)"` },
  { trigger: "\t", name: "a tab", value: `\tSUM(A1)`, expected: `"\t\tSUM(A1)"` },
  { trigger: "\r", name: "a carriage return", value: `\rSUM(A1)`, expected: `"\t\rSUM(A1)"` },
  { trigger: "\n", name: "a line feed", value: `\nSUM(A1)`, expected: `"\t\nSUM(A1)"` },
];
const FULL_WIDTH_TRIGGER_CASES: { readonly trigger: string; readonly name: string; readonly value: string; readonly expected: string }[] = [
  { trigger: "\uFF1D", name: "full-width equals (U+FF1D)", value: `\uFF1DSUM(A1)`, expected: `"\t\uFF1DSUM(A1)"` },
  { trigger: "\uFF0B", name: "full-width plus (U+FF0B)", value: `\uFF0BSUM(A1)`, expected: `"\t\uFF0BSUM(A1)"` },
  { trigger: "\uFF0D", name: "full-width minus (U+FF0D)", value: `\uFF0DSUM(A1)`, expected: `"\t\uFF0DSUM(A1)"` },
  { trigger: "\uFF20", name: "full-width commercial at (U+FF20)", value: `\uFF20SUM(A1)`, expected: `"\t\uFF20SUM(A1)"` },
];
const QUOTED_FIELD_OPENING_WITH_TRIGGER = /(?:^|,|\r\n)"[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;
function fieldText(field: string): string {
  return field.slice(1, -1);
}
describe("every ASCII character a spreadsheet reads as a formula trigger", () => {
  it.each(ASCII_TRIGGER_CASES)("neutralises $name at the cell's first character", ({ value, expected }) => {
    const emitted = neutralizeCell(value);
    expect(emitted).toBe(expected);
    expect(emitted.startsWith(`"`)).toBe(true);
    expect(emitted.endsWith(`"`)).toBe(true);
    expect(fieldText(emitted)).toBe(`\t${value}`);
    expect(neutralizer.requiresNeutralisation(value)).toBe(true);
  });
  it("fixes the trigger set at the eleven characters the export contract names", () => {
    const ascii = ASCII_TRIGGER_CASES.map(({ trigger }) => trigger);
    const fullWidth = FULL_WIDTH_TRIGGER_CASES.map(({ trigger }) => trigger);
    expect([...neutralizer.DANGEROUS_LEADING_CHARS]).toEqual([...ascii, ...fullWidth]);
  });
});
describe("the full-width forms a CJK input method produces", () => {
  it.each(FULL_WIDTH_TRIGGER_CASES)("neutralises $name at the cell's first character", ({ value, expected }) => {
    const emitted = neutralizeCell(value);
    expect(emitted).toBe(expected);
    expect(fieldText(emitted)).toBe(`\t${value}`);
    expect(neutralizer.requiresNeutralisation(value)).toBe(true);
  });
  it("matches on code points rather than on a shared leading byte", () => {
    const fullWidthA = `\uFF21bc`;
    expect(neutralizeCell(fullWidthA)).toBe(`"${fullWidthA}"`);
    expect(fieldText(neutralizeCell(fullWidthA))).toBe(fullWidthA);
    const unicodeMinus = `\u2212USD 5`;
    expect(neutralizeCell(unicodeMinus)).toBe(`"${unicodeMinus}"`);
    expect(fieldText(neutralizeCell(unicodeMinus))).toBe(unicodeMinus);
  });
});
describe("a cell that only becomes first after a separator or a quote", () => {
  it("keeps a formula that follows a quote in the value out of the cell's first position", () => {
    const emitted = neutralizeCell(`"=cmd`);
    expect(emitted).toBe(`"""=cmd"`);
    expect(emitted.startsWith(`""`)).toBe(true);
    expect(emitted.startsWith(`"=`)).toBe(false);
    expect(QUOTED_FIELD_OPENING_WITH_TRIGGER.test(emitted)).toBe(false);
  });
  it("quotes a value whose separator is followed by a formula, so no field opens there", () => {
    const emitted = neutralizeCell(`a,=cmd`);
    expect(emitted).toBe(`"a,=cmd"`);
    expect(fieldText(emitted)).toBe(`a,=cmd`);
    expect(fieldText(emitted).startsWith("=")).toBe(false);
    const record = [neutralizeCell("note"), emitted].join(",");
    expect(record).toBe(`"note","a,=cmd"`);
    expect(QUOTED_FIELD_OPENING_WITH_TRIGGER.test(record)).toBe(false);
  });
  it("quotes a value whose quoted section is followed by a formula", () => {
    const emitted = neutralizeCell(`a""=cmd`);
    expect(emitted).toBe(`"a""""=cmd"`);
    expect(emitted.startsWith(`"=`)).toBe(false);
    expect(QUOTED_FIELD_OPENING_WITH_TRIGGER.test(emitted)).toBe(false);
  });
  it("neutralises a formula at the start of a line inside the value", () => {
    const emitted = neutralizeCell("line one\r\n=SUM(A1)");
    expect(emitted).toBe(`"line one\r\n\t=SUM(A1)"`);
    expect(fieldText(emitted)).toBe("line one\r\n\t=SUM(A1)");
  });
});
describe("ordinary content survives untouched", () => {
  const ORDINARY_CELLS: { readonly label: string; readonly value: string }[] = [
    { label: "an Arabic name", value: "ليلى حسن" },
    { label: "an astral emoji beside a name", value: "😀 Grace Okafor" },
    { label: "a mixed-direction string", value: "مرحبا · Li Wei (李伟) · 12:30" },
    { label: "a cell of spaces only", value: "   " },
  ];
  it.each(ORDINARY_CELLS)("leaves $label byte-for-byte unchanged", ({ value }) => {
    const emitted = neutralizeCell(value);
    expect(emitted).toBe(`"${value}"`);
    expect(fieldText(emitted)).toBe(value);
    expect(Buffer.from(fieldText(emitted), "utf8").equals(Buffer.from(value, "utf8"))).toBe(true);
    expect(emitted).not.toContain("\t");
    expect(neutralizer.requiresNeutralisation(value)).toBe(false);
  });
  it("preserves a leading-zero identifier exactly", () => {
    const emitted = neutralizeCell("000123");
    expect(emitted).toBe(`"000123"`);
    expect(fieldText(emitted)).toBe("000123");
    expect(neutralizer.requiresNeutralisation("000123")).toBe(false);
  });
  it("keeps an empty cell empty rather than giving it a prefix", () => {
    expect(neutralizeCell("")).toBe('""');
    expect(fieldText(neutralizeCell(""))).toBe("");
  });
  it("neutralises a leading tab while leaving a tab later in the value as data", () => {
    expect(neutralizeCell("\tDowning St")).toBe('"\t\tDowning St"');
    expect(neutralizeCell("10\tDowning St")).toBe('"10\tDowning St"');
    expect(fieldText(neutralizeCell("10\tDowning St"))).toBe("10\tDowning St");
  });
});
type SupportProjection = Parameters<typeof runReport>[1];

type ProjectionRow = SupportProjection["gifts"][number];

function usd(minorUnits: number): Money {
  return { currency: "USD", minorUnits: minorUnits as MinorUnits };
}
function civilDay(isoDate: string): ProjectionRow["entryOn"] {
  return Temporal.PlainDate.from(isoDate);
}
const PROJECTION: SupportProjection = {
  supportSubjectId: "support-subject-0001",
  basis: "effective_cash_allocation",
  currencyExponents: { USD: 2 },
  coverage: { from: "2025-01-01", to: "2026-11-19", state: "complete" },
  asOf: "2026-11-20T09:00:00Z",
  lastSourceUpdate: "2026-11-19T22:15:00Z",
  source: { system: "synthetic-finance", reference: "projection-0001" },
  gifts: [
    {
      giftRowId: "000123",
      giftId: "gift-0001",
      amount: usd(5000),
      originalGiftOn: civilDay("2026-03-04"),
      datePrecision: "date",
      designation: "=SUM(A1)-cmd",
      attribution: { kind: "partner", partnerId: "partner-0042" },
      provenance: { system: "synthetic-finance", reference: "@provenance-0001" },
      entryOn: civilDay("2026-03-05"),
    },
    { giftRowId: "gift-row-0002", giftId: "gift-0002", amount: usd(2500), originalGiftOn: civilDay("2026-02-10"), datePrecision: "date", designation: "General Fund", attribution: { kind: "anonymous" }, provenance: { system: "synthetic-finance", reference: "gift-0002" }, entryOn: civilDay("2026-02-11") },
  ],
  commitments: [],
};
const QUERY: ReportQuery = {
  reportId: "received-period-and-year-to-date",
  scope: { organizationId: "organization-0001", ministryId: "ministry-0001", supportSubjectId: "support-subject-0001", principalId: "principal-0001" },
  period: { kind: "explicit", from: civilDay("2026-01-01"), to: civilDay("2026-11-19") },
  currency: { kind: "all" },
};
function receivedSupportReport(): ReportResult {
  return runReport(QUERY, PROJECTION);
}
describe("the writer neutralises every cell of a real result", () => {
  it("neutralises the trigger-leading cells and leaves ordinary rows intact", () => {
    const result = receivedSupportReport();
    const document = toCsv(result);
    expect(result.rows).toHaveLength(2);
    expect(document).toContain('"\t=SUM(A1)-cmd"');
    expect(document).not.toContain('"=SUM(A1)-cmd"');
    expect(document).toContain('"\t@provenance-0001"');
    expect(document).not.toContain('"@provenance-0001"');
    expect(document).toContain('"000123"');
    expect(document).not.toContain('"\t000123"');
    expect(document).toContain('"General Fund"');
    expect(document).toContain('"gift-row-0002"');
  });
  it("leaves no field in the document opening with a formula trigger", () => {
    const document = toCsv(receivedSupportReport());
    expect(document).not.toMatch(QUOTED_FIELD_OPENING_WITH_TRIGGER);
    expect(document).not.toMatch(/(?:^|,|\r\n)[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/);
  });
  it("writes no byte-order mark", () => {
    const document = toCsv(receivedSupportReport());
    const bytes = Buffer.from(document, "utf8");
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(document.codePointAt(0)).toBe(0x22);
  });
  it("keeps the neutralising tab in the data, the residual A8 discloses", () => {
    const document = toCsv(receivedSupportReport());
    const [neutralised] = /"\t=SUM\(A1\)-cmd"/.exec(document) ?? [];
    expect(neutralised).toBeDefined();
    expect(fieldText(neutralised ?? "")).toBe("\t=SUM(A1)-cmd");
  });
});
const EXPORT_MODULE_DIR = fileURLToPath(new URL("../../src/modules/export/", import.meta.url));
const EXPORTED_DECLARATION = /\bexport\s+(?:async\s+)?(function|const|class)\s+([A-Za-z_$][\w$]*)/g;
const ESCAPING_HELPER_NAME = /neutrali[sz]|escape|sanit(?:is|iz)e|defang/i;
describe("one neutraliser, one writer", () => {
  it("exposes exactly one neutraliser and the quoting helper it is built from", () => {
    expect(Object.keys(neutralizer).sort()).toEqual(["DANGEROUS_LEADING_CHARS", "NEUTRALISER_PREFIX", "neutralizeCell", "quoteField", "requiresNeutralisation"]);
  });
  it("declares no second escaping path in any export module", () => {
    const declared = readdirSync(EXPORT_MODULE_DIR)
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) =>
        [...readFileSync(join(EXPORT_MODULE_DIR, name), "utf8").matchAll(EXPORTED_DECLARATION)]
          .filter(([, kind]) => kind === "function" || kind === "class")
          .map(([, , exported]) => exported ?? "")
          .filter((exported) => ESCAPING_HELPER_NAME.test(exported))
          .map((exported) => `${name}:${exported}`),
      )
      .sort();
    expect(declared).toEqual(["neutralize.ts:neutralizeCell", "neutralize.ts:requiresNeutralisation"]);
  });
});
