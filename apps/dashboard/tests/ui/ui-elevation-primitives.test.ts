import { describe, expect, it } from "vitest";
import {
  buildColumnOrder,
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  moveColumnId,
  pinnedSideOf,
  shouldVirtualizeRows,
  stepColumnWidth,
  togglePinnedColumn,
  type LogicalColumnPinning,
} from "@/lib/data-grid-utils";
import {
  buildCivilMonthGrid,
  formatCivilMonthTitle,
  isDateInRange,
  monthFromIsoDate,
  parseIsoCivilDate,
  shiftCivilMonth,
  validateCivilDateRange,
  weekdayLabels,
} from "@/lib/civil-calendar";
import { filterAndRankItems, normaliseSearchQuery, scoreSearchItem, type SearchableCommandItem } from "@/lib/command-search";
import { computeReadingProgress, countEditorialWords, estimateReadingMinutes, extractPlainTextFromHtml } from "@/lib/editorial-metrics";
import { buildRouteBreadcrumbs } from "@/lib/route-breadcrumbs";
import { pickActiveSectionId, type ScrollspyVisibility } from "@/lib/scrollspy";
import { groupTasksByStatus, TASK_BOARD_STATUS_ORDER } from "@/lib/task-board";
import { inferFileTypeKind, pickSingleFile } from "@/hooks/use-file-upload";
import { clampSplitRatio, shouldSnapCountUp } from "@/lib/ui-motion";

describe("ReUI Data Grid utilities", () => {
  it("moves columns cleanly toward start and end without mutating the source array", () => {
    const initial = ["gift", "date", "amount", "currency"] as const;
    expect(moveColumnId(initial, "amount", "start")).toEqual(["gift", "amount", "date", "currency"]);
    expect(moveColumnId(initial, "date", "end")).toEqual(["gift", "amount", "date", "currency"]);
    expect(moveColumnId(initial, "gift", "start")).toEqual(initial);
    expect(moveColumnId(initial, "currency", "end")).toEqual(initial);
    expect(moveColumnId(initial, "missing", "start")).toEqual(initial);
  });

  it("toggles logical column pinning without duplicating column ids across edges", () => {
    const startState: LogicalColumnPinning = { start: ["gift"], end: ["actions"] };
    const movedToEnd = togglePinnedColumn(startState, "gift", "end");
    expect(movedToEnd).toEqual({ start: [], end: ["actions", "gift"] });
    expect(pinnedSideOf(movedToEnd, "gift")).toBe("end");

    const unpinned = togglePinnedColumn(movedToEnd, "gift", false);
    expect(unpinned).toEqual({ start: [], end: ["actions"] });
    expect(pinnedSideOf(unpinned, "gift")).toBe(false);
  });

  it("clamps column width steps to declared min/max bounds", () => {
    expect(stepColumnWidth(180, 24)).toBe(204);
    expect(stepColumnWidth(100, -50)).toBe(COLUMN_WIDTH_MIN);
    expect(stepColumnWidth(620, 50)).toBe(COLUMN_WIDTH_MAX);
    expect(stepColumnWidth(Number.NaN, 24)).toBe(204);
  });

  it("keeps fixed leading/trailing system columns anchored around movable data columns", () => {
    const order = buildColumnOrder(
      ["gift", "date", "amount", "designation"],
      ["amount", "gift", "stale_removed_col"],
      ["__expand", "__select"],
      ["__actions"],
    );
    expect(order).toEqual(["__expand", "__select", "amount", "gift", "date", "designation", "__actions"]);
  });

  it("activates virtualization strictly when opt-in is enabled and row count exceeds threshold", () => {
    expect(shouldVirtualizeRows(200, false)).toBe(false);
    expect(shouldVirtualizeRows(30, true)).toBe(false);
    expect(shouldVirtualizeRows(40, true)).toBe(false);
    expect(shouldVirtualizeRows(41, true)).toBe(true);
    expect(shouldVirtualizeRows(200, true)).toBe(true);
  });
});

describe("Civil-date calendar engine (DateSelector & Agenda Calendar)", () => {
  it("parses valid civil ISO dates and strictly refuses invalid calendar days", () => {
    expect(parseIsoCivilDate("2024-02-29")?.toString()).toBe("2024-02-29");
    expect(parseIsoCivilDate("2026-02-29")).toBeNull();
    expect(parseIsoCivilDate("2026-02-30")).toBeNull();
    expect(parseIsoCivilDate("2026-13-01")).toBeNull();
    expect(parseIsoCivilDate("not-a-date")).toBeNull();
  });

  it("validates civil date ranges and rejects inverted ranges", () => {
    const valid = validateCivilDateRange("2026-03-01", "2026-03-31");
    expect(valid).toEqual({ ok: true, range: { from: "2026-03-01", to: "2026-03-31" } });

    const singleDay = validateCivilDateRange("2026-03-15", "2026-03-15");
    expect(singleDay).toEqual({ ok: true, range: { from: "2026-03-15", to: "2026-03-15" } });

    const inverted = validateCivilDateRange("2026-04-01", "2026-03-31");
    expect(inverted.ok).toBe(false);

    const malformed = validateCivilDateRange("2026-02-30", "2026-03-31");
    expect(malformed.ok).toBe(false);
  });

  it("shifts months cleanly across year boundaries", () => {
    expect(shiftCivilMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftCivilMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(monthFromIsoDate("2026-07-19", { year: 2026, month: 1 })).toEqual({ year: 2026, month: 7 });
    expect(monthFromIsoDate("bad", { year: 2026, month: 1 })).toEqual({ year: 2026, month: 1 });
  });

  it("builds a complete 42-cell civil grid with exact in-month boundaries", () => {
    const grid = buildCivilMonthGrid({ year: 2026, month: 2 }, "sunday");
    expect(grid).toHaveLength(42);
    const inMonth = grid.filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[0]?.iso).toBe("2026-02-01");
    expect(inMonth[inMonth.length - 1]?.iso).toBe("2026-02-28");
    expect(grid[0]?.iso).toBe("2026-02-01"); // 2026-02-01 is a Sunday
  });

  it("formats month titles, weekday labels, and inclusive range checks", () => {
    expect(formatCivilMonthTitle({ year: 2026, month: 3 }, "en-US")).toContain("2026");
    expect(weekdayLabels("en-US", "sunday")).toHaveLength(7);
    expect(weekdayLabels("en-US", "monday")).toHaveLength(7);
    expect(isDateInRange("2026-03-10", "2026-03-01", "2026-03-31")).toBe(true);
    expect(isDateInRange("2026-04-01", "2026-03-01", "2026-03-31")).toBe(false);
    expect(isDateInRange("2026-03-10", null, "2026-03-31")).toBe(false);
  });
});

describe("Command Palette & Help search ranking", () => {
  const catalog: readonly SearchableCommandItem[] = [
    { id: "gifts", label: "Support — Gifts", group: "Support", keywords: ["ledger", "donations", "csv"] },
    { id: "partners", label: "Partners", group: "Workspace", keywords: ["contacts", "roster"] },
    { id: "import", label: "Partners — Import contacts", group: "Partners", keywords: ["csv", "upload"] },
    { id: "settings", label: "Settings", group: "System", keywords: ["theme", "time zone"] },
  ];

  it("normalises whitespace and casing consistently", () => {
    expect(normaliseSearchQuery("  Import   CSV  ")).toBe("import csv");
  });

  it("ranks prefix matches above substring and keyword matches", () => {
    expect(scoreSearchItem(catalog[1]!, "part")).toBe(3);
    expect(scoreSearchItem(catalog[0]!, "gifts")).toBe(2);
    expect(scoreSearchItem(catalog[0]!, "ledger")).toBe(1);
    expect(scoreSearchItem(catalog[0]!, "time zone")).toBe(0);

    const ranked = filterAndRankItems(catalog, "partners");
    expect(ranked.map((item) => item.id)).toEqual(["partners", "import"]);
  });

  it("supports multi-token AND filtering across label, group, and keywords", () => {
    const csvMatches = filterAndRankItems(catalog, "csv upload");
    expect(csvMatches.map((item) => item.id)).toEqual(["import"]);
    expect(filterAndRankItems(catalog, "")).toHaveLength(catalog.length);
  });
});

describe("File upload, Resizable split pane, and CountUp reduced-motion guards", () => {
  it("infers UI file type badges accurately without mutating filenames", () => {
    expect(inferFileTypeKind("contacts-example.CSV")).toBe("csv");
    expect(inferFileTypeKind("portrait.jpeg")).toBe("image");
    expect(inferFileTypeKind("update-clip.mp4")).toBe("video");
    expect(inferFileTypeKind("captions-en.vtt")).toBe("captions");
    expect(inferFileTypeKind("readme.txt")).toBe("document");
  });

  it("extracts a single dropped file safely from empty or populated lists", () => {
    expect(pickSingleFile(null)).toBeNull();
    expect(pickSingleFile([])).toBeNull();
    const fakeFile = { name: "test.csv", size: 42 } as File;
    expect(pickSingleFile([fakeFile])).toBe(fakeFile);
  });

  it("clamps resizable split ratios safely", () => {
    expect(clampSplitRatio(55.6, 25, 75)).toBe(56);
    expect(clampSplitRatio(10, 25, 75)).toBe(25);
    expect(clampSplitRatio(95, 25, 75)).toBe(75);
    expect(clampSplitRatio(Number.NaN, 25, 75)).toBe(25);
  });

  it("forces CountUp to snap immediately under prefers-reduced-motion or zero/invalid values", () => {
    expect(shouldSnapCountUp(12, true)).toBe(true);
    expect(shouldSnapCountUp(0, false)).toBe(true);
    expect(shouldSnapCountUp(-3, false)).toBe(true);
    expect(shouldSnapCountUp(Number.NaN, false)).toBe(true);
    expect(shouldSnapCountUp(12, false)).toBe(false);
    expect(shouldSnapCountUp(12, null)).toBe(false);
  });
});

describe("Wave 2 primitives: Breadcrumbs, Scrollspy, Editorial Metrics & Task Board", () => {
  it("builds accurate shell breadcrumbs across top-level, static, and dynamic nested routes", () => {
    expect(buildRouteBreadcrumbs("/")).toEqual([]);
    expect(buildRouteBreadcrumbs("/partners")).toEqual([]);
    expect(buildRouteBreadcrumbs("/support/gifts?period=this-year")).toEqual([
      { label: "Support", href: "/support" },
      { label: "Gifts" },
    ]);
    expect(buildRouteBreadcrumbs("/partners/partner-jo-mbeki/edit")).toEqual([
      { label: "Partners", href: "/partners" },
      { label: "Partner record", href: "/partners/partner-jo-mbeki" },
      { label: "Edit contact" },
    ]);
    expect(buildRouteBreadcrumbs("/pages/doc-page-harbour-youth/en/preview/")).toEqual([
      { label: "Pages", href: "/pages" },
      { label: "Page builder", href: "/pages/doc-page-harbour-youth" },
      { label: "Preview" },
    ]);
    expect(buildRouteBreadcrumbs("/preview/pages/doc-page-harbour-youth/en")).toEqual([
      { label: "Communication", href: "/communication" },
      { label: "Published pages", href: "/preview/pages" },
      { label: "Public reading" },
    ]);
  });

  it("picks the right active Scrollspy section without flicker", () => {
    const ordered = ["sec-1", "sec-2", "sec-3"] as const;
    const intersecting = new Map<string, ScrollspyVisibility>([
      ["sec-1", { id: "sec-1", isIntersecting: true, top: -40 }],
      ["sec-2", { id: "sec-2", isIntersecting: true, top: 115 }],
      ["sec-3", { id: "sec-3", isIntersecting: false, top: 640 }],
    ]);
    expect(pickActiveSectionId(ordered, intersecting, "sec-1")).toBe("sec-2");

    const scrolledPast = new Map<string, ScrollspyVisibility>([
      ["sec-1", { id: "sec-1", isIntersecting: false, top: -600 }],
      ["sec-2", { id: "sec-2", isIntersecting: false, top: -80 }],
      ["sec-3", { id: "sec-3", isIntersecting: false, top: 520 }],
    ]);
    expect(pickActiveSectionId(ordered, scrolledPast, "sec-1")).toBe("sec-2");
    expect(pickActiveSectionId([], new Map(), "fallback")).toBe("fallback");
  });

  it("computes editorial reading time across Unicode scripts and clamps scroll reading progress", () => {
    expect(extractPlainTextFromHtml("<p>Hello&nbsp;world</p><p>مرحبا بالعالم</p>")).toBe("Hello world مرحبا بالعالم");
    expect(countEditorialWords("<p>One two three</p>")).toBe(3);
    expect(estimateReadingMinutes("   <p></p>  ")).toBeNull();
    expect(estimateReadingMinutes("<p>Short update</p>")).toBe(1);
    const longHtml = `<p>${Array.from({ length: 420 }, (_, i) => `word${String(i)}`).join(" ")}</p>`;
    expect(estimateReadingMinutes(longHtml)).toBe(3);

    expect(computeReadingProgress(0, 2000, 800)).toBe(0);
    expect(computeReadingProgress(600, 2000, 800)).toBe(0.5);
    expect(computeReadingProgress(1500, 2000, 800)).toBe(1);
    expect(computeReadingProgress(100, 600, 800)).toBe(0);
    expect(computeReadingProgress(Number.NaN, 2000, 800)).toBe(0);
  });

  it("groups tasks into stable status lanes while preserving exact server order", () => {
    const tasks = [
      { id: "t1", status: "open" as const },
      { id: "t2", status: "completed" as const },
      { id: "t3", status: "open" as const },
      { id: "t4", status: "reopened" as const },
    ];
    const columns = groupTasksByStatus(tasks);
    expect(columns.map((column) => column.status)).toEqual([...TASK_BOARD_STATUS_ORDER]);
    expect(columns[0]?.items.map((item) => item.id)).toEqual(["t1", "t3"]);
    expect(columns[1]?.items.map((item) => item.id)).toEqual(["t4"]);
    expect(columns[2]?.items.map((item) => item.id)).toEqual(["t2"]);
    expect(columns[3]?.items).toEqual([]);
  });
});
