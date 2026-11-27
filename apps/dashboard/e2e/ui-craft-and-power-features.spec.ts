import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  actAs,
  blockingAccessibilityViolations,
  expectNoHorizontalPageScroll,
  resetSeed,
} from "../playwright.config";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("UI/UX Elevation — Complete Multi-Ecosystem Craft, Power Features & Accessibility", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetSeed(request, "established-worker");
    await actAs(page, "established-worker");
  });

  test("Phase 1 & ReUI Data Grid: inline column header menus, pinning, Expand All, density, civil Date Selector & File Upload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/support/gifts?period=this-year");

    // Verify dynamic shell breadcrumb on nested route.
    await expect(page.locator('[data-slot="shell-breadcrumb"]')).toBeVisible();
    await expect(page.locator('[data-slot="shell-breadcrumb"]')).toContainText("Gifts");

    const table = page.getByRole("table", { name: "Received gifts" });
    await expect(table).toBeVisible();

    // Verify logical start pinning on the leading Gift column and zero HTML5 draggable attributes.
    await expect(table.locator('[data-pinned="start"]').first()).toBeVisible();
    await expect(table.locator('[draggable="true"]')).toHaveCount(0);

    const rowsBeforeExpand = await table.locator("tbody tr").count();
    expect(rowsBeforeExpand).toBeGreaterThan(0);

    // Expand the first gift row inline, inspect details, then collapse back to exact row count.
    const firstExpandToggle = table.locator('[data-slot="data-grid-expand-toggle"]').first();
    await firstExpandToggle.click();
    await expect(firstExpandToggle).toHaveAttribute("aria-expanded", "true");
    await expect(table.locator('[data-slot="data-grid-expanded-row"]')).toHaveCount(1);
    await expect(table.locator('[data-slot="data-grid-expanded-row"]')).toContainText("Type & allocation");

    // ReUI Expand All / Collapse All toggle in DataGridHeader.
    const expandAll = page.locator('[data-slot="data-grid-expand-all"]');
    await expect(expandAll).toBeVisible();
    await expandAll.click();
    await expect(expandAll).toHaveAttribute("aria-pressed", "true");
    await expect(table.locator('[data-slot="data-grid-expanded-row"]')).toHaveCount(rowsBeforeExpand);
    await expandAll.click();
    await expect(expandAll).toHaveAttribute("aria-pressed", "false");
    await expect(table.locator("tbody tr")).toHaveCount(rowsBeforeExpand);

    // ReUI inline DataGridColumnHeaderMenu on desktop header (widen / pin).
    const firstColumnMenu = table.locator('[data-slot="data-grid-column-menu"]').first();
    await expect(firstColumnMenu).toBeVisible();
    await firstColumnMenu.click();
    await page.getByRole("menuitem", { name: "Widen column", exact: true }).click();

    // Open ReUI Grid View & Columns popover, switch to Compact density, then reset.
    await page.locator('[data-slot="data-grid-view-trigger"]').click();
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.locator('[data-slot="data-grid"]')).toHaveAttribute("data-density", "dense");

    await page.getByRole("button", { name: "Reset grid", exact: true }).click();
    await expect(page.locator('[data-slot="data-grid"]')).toHaveAttribute("data-density", "default");
    await page.keyboard.press("Escape");

    // ReUI Date Selector: pick a custom civil date range via explicit ISO inputs and verify URL sync.
    await page.locator('[data-slot="date-selector-trigger"]').click();
    await page.getByLabel("Start date").fill("2026-01-01");
    await page.getByLabel("End date").fill("2026-12-31");
    await page.getByRole("button", { name: "Apply range", exact: true }).click();
    await expect(page).toHaveURL(/from=2026-01-01/u);
    await expect(page).toHaveURL(/to=2026-12-31/u);

    // ReUI Connected Stepper & File Upload Dropzone on /partners/import.
    await page.goto("/partners/import");
    await expect(page.locator('[data-slot="import-stepper-list"]')).toBeVisible();
    await expect(page.locator('[data-slot="file-upload-dropzone"]')).toBeVisible();
    await expect(page.locator('[data-slot="file-type-badge"]').first()).toBeVisible();
  });

  test("Phase 2 & Multi-View Workspaces: Home Pulse, Command Palette, Partners Expand/Scrollspy, Work Board, Updates Cards, Agenda Calendar, Settings Scrollspy & Help", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    // Home Workspace Pulse banner, CountUp counters, and proportional SegmentedMeter.
    await expect(page.locator('[data-slot="home-pulse-banner"]')).toBeVisible();
    await expect(page.locator('[data-slot="count-up"]').first()).toBeVisible();

    // Open Global Command Palette via header trigger, search for "Agenda", and navigate.
    await page.locator('[data-slot="command-palette-trigger"]').click();
    const palette = page.locator('[data-slot="command-palette"]');
    await expect(palette).toBeVisible();
    await page.getByLabel("Search pages and actions").fill("Agenda");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/work\/agenda/u);

    // Agenda multi-view toggle: switch to read-only Calendar view and inspect day detail + month count badge.
    await page.getByRole("radio", { name: "Calendar view" }).click();
    await expect(page.locator('[data-slot="calendar-grid"]')).toBeVisible();
    await expect(page.locator('[data-slot="calendar-day-detail"]')).toBeVisible();
    await page.getByRole("radio", { name: "List view" }).click();

    // Work surface: Table | Board view switcher with zero HTML5 draggable attributes.
    await page.goto("/work");
    await page.getByRole("radio", { name: "Board view" }).click();
    const taskBoard = page.locator('[data-slot="task-status-board"]');
    await expect(taskBoard).toBeVisible();
    await expect(taskBoard.locator('[draggable="true"]')).toHaveCount(0);
    await page.getByRole("radio", { name: "Table view" }).click();

    // Partners Roster expandable row + Partner Detail horizontal Scrollspy & CopyButton.
    await page.goto("/partners");
    const rosterTable = page.getByRole("table", { name: "Partners" });
    await expect(rosterTable).toBeVisible();
    await rosterTable.locator('[data-slot="data-grid-expand-toggle"]').first().click();
    await expect(rosterTable.locator('[data-slot="data-grid-expanded-row"]')).toHaveCount(1);
    await rosterTable.locator('[data-slot="data-grid-expanded-row"]').getByRole("link", { name: "Open full profile" }).click();
    await expect(page.locator('[data-slot="scrollspy-nav"]')).toBeVisible();
    await expect(page.locator('[data-slot="copy-button"]').first()).toBeVisible();

    // Communication Updates: Table | Cards view switcher and expandable edition details.
    await page.goto("/communication");
    await page.getByRole("radio", { name: "Cards view" }).click();
    await expect(page.locator('[data-slot="updates-cards-grid"]')).toBeVisible();
    await page.getByRole("radio", { name: "Table view" }).click();
    await page.getByRole("table", { name: "Updates and editions" }).locator('[data-slot="data-grid-expand-toggle"]').first().click();
    await expect(page.locator('[data-slot="data-grid-expanded-row"]')).toHaveCount(1);

    // Open Keyboard Shortcuts Sheet via Command Palette quick action.
    await page.locator('[data-slot="command-palette-trigger"]').click();
    await page.getByLabel("Search pages and actions").fill("shortcuts");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-slot="shortcuts-sheet"]')).toBeVisible();
    await page.keyboard.press("Escape");

    // Support Overview: sparklines, segmented recurring outcomes bar, and SpotlightCard destinations.
    await page.goto("/support");
    await expect(page.locator('[data-slot="segmented-meter"]').first()).toBeVisible();
    await expect(page.locator('[data-slot="spotlight-card"]').first()).toBeVisible();

    // Settings: live ReUI Scrollspy section jump rail.
    await page.goto("/settings");
    const settingsSpy = page.locator('[data-slot="scrollspy-nav"]');
    await expect(settingsSpy).toBeVisible();
    await expect(settingsSpy.locator('a[aria-current="location"]')).toHaveCount(1);

    // Help: live search narrows topics and clears cleanly back to all 5 sections.
    await page.goto("/help");
    const helpSearch = page.getByLabel("Search help topics");
    await expect(helpSearch).toBeVisible();
    await helpSearch.fill("development data");
    await expect(page.getByText("2 of 5 topics")).toBeVisible();
    await page.getByRole("button", { name: "Clear help search" }).click();
    await expect(page.getByText("5 of 5 topics")).toBeVisible();
  });

  test("Phase 3 & Craft Verification: Page Builder Split Pane & Viewport Stage, Editorial Reading Progress, 320px Reflow & WCAG 2.2 AA", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/pages");
    const firstPageLink = page.locator("main a[href^='/pages/']").first();
    if ((await firstPageLink.count()) > 0) {
      await firstPageLink.click();
      const splitter = page.locator('[data-slot="resizable-handle"]').first();
      await expect(splitter).toBeVisible();
      const before = Number(await splitter.getAttribute("aria-valuenow"));
      await splitter.focus();
      await page.keyboard.press("ArrowRight");
      const after = Number(await splitter.getAttribute("aria-valuenow"));
      expect(after).toBeGreaterThan(before);
      await expect(page.locator('[data-pane="outline"] [draggable="true"]')).toHaveCount(0);

      // Shadcn Studio Viewport Preview Stage switcher (Desktop -> Tablet -> Mobile).
      const viewportStage = page.locator('[data-slot="viewport-preview-stage"]');
      await expect(viewportStage).toBeVisible();
      await viewportStage.getByRole("radio", { name: "Tablet" }).click();
      await expect(viewportStage).toHaveAttribute("data-viewport-mode", "tablet");
      await viewportStage.getByRole("radio", { name: "Mobile" }).click();
      await expect(viewportStage).toHaveAttribute("data-viewport-mode", "mobile");
      await viewportStage.getByRole("radio", { name: "Desktop" }).click();
      await expect(viewportStage).toHaveAttribute("data-viewport-mode", "desktop");
    }

    // Public discovery index & direct public reading view with ReadingProgressBar + estimated reading time.
    await page.goto("/preview/pages");
    await expect(page.locator('[data-slot="discovery-index"]')).toBeVisible();
    await page.goto("/preview/pages/doc-page-harbour-youth/en");
    await expect(page.locator('[data-slot="reading-progress"]')).toBeAttached();
    await expect(page.locator('[data-slot="reading-time-badge"]')).toBeVisible();

    // Accessibility audit (WCAG 2.2 AA) across enhanced surfaces on desktop.
    for (const route of [
      "/",
      "/partners",
      "/partners/partner-jo-mbeki",
      "/work",
      "/work/agenda",
      "/support",
      "/support/gifts?period=this-year",
      "/communication",
      "/help",
      "/settings",
      "/preview/pages/doc-page-harbour-youth/en",
    ]) {
      await page.goto(route);
      const audit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(blockingAccessibilityViolations(audit), `${route} must carry zero serious or critical WCAG 2.2 AA violations.`).toEqual([]);
    }

    // Narrow 320px reflow + reduced motion check across enhanced surfaces.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 640 });
    for (const route of ["/", "/partners", "/work", "/support/gifts?period=this-year", "/communication", "/help", "/settings", "/preview/pages/doc-page-harbour-youth/en"]) {
      await page.goto(route);
      await expectNoHorizontalPageScroll(page, `320px reflow on ${route}`);
    }
  });

  test("Design Engineering ergonomics: persisted Command Palette theme switch, DateSelector Enter submit & zero-dead-zone DataGrid labels", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    // Toggle dark theme via Command Palette and verify it persists across full reload and syncs with Settings.
    await page.locator('[data-slot="command-palette-trigger"]').click();
    await page.getByLabel("Search pages and actions").fill("Switch light");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/u);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/u);

    // Dark-mode WCAG 2.2 AA check on Home & Support with quiet Zinc borders.
    const darkAudit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(blockingAccessibilityViolations(darkAudit), "Dark-mode Home must carry zero serious or critical WCAG 2.2 AA violations.").toEqual([]);

    // Switch back to light via Command Palette so preference stays deterministic.
    await page.locator('[data-slot="command-palette-trigger"]').click();
    await page.getByLabel("Search pages and actions").fill("Switch light");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/u);

    // DateSelector supports Enter submission directly inside the custom range inputs.
    await page.goto("/support/gifts?period=this-year");
    await page.locator('[data-slot="date-selector-trigger"]').click();
    await page.getByLabel("Start date").fill("2026-01-01");
    await page.getByLabel("End date").fill("2026-12-31");
    await page.getByLabel("End date").press("Enter");
    await expect(page).toHaveURL(/from=2026-01-01/u);
    await expect(page).toHaveURL(/to=2026-12-31/u);

    // DataGrid column label wraps checkbox cleanly (clicking label text toggles visibility with zero dead zone).
    await page.locator('[data-slot="data-grid-view-trigger"]').click();
    const methodCheckbox = page.getByRole("checkbox", { name: /Show .* column/i }).last();
    const initialChecked = await methodCheckbox.getAttribute("aria-checked");
    const enclosingLabel = methodCheckbox.locator("xpath=ancestor::label[1]");
    await enclosingLabel.locator("span").first().click();
    await expect(methodCheckbox).toHaveAttribute("aria-checked", initialChecked === "true" ? "false" : "true");
    await page.getByRole("button", { name: "Reset grid", exact: true }).click();
    await page.keyboard.press("Escape");
  });
});
