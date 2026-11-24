/** Criterion 20 — usability and recovery: the retained jobs complete at 320 CSS pixels with the keyboard alone, at 200 % zoom and with reduced motion. */ import { fileURLToPath } from "node:url";
import {} from "@axe-core/playwright"; // AA tag set once and reuses that judgement rather than keeping a second copy of it. The types come from `@playwright/test`, which is what the runner is built on.
import type { Locator, Page } from "@playwright/test";
import {
  armLostAcknowledgement,
  auditSurface,
  auditedSurfaces,
  clearFailurePlan,
  expect,
  expectDevelopmentData,
  expectFocusInsideDialog,
  expectFocusVisibleAndUnobscured,
  expectNoHorizontalPageScroll,
  expectScrollPaddingSet,
  expectSoleHorizontalScroller,
  expectTargetSizeFloor,
  expectTextNotClipped,
  pressFromKeyboard,
  readLongestMotion,
  setFailurePlan,
  settleLayout,
  sweepTabOrder,
  test,
  typeFromKeyboard,
  type JsonRecord,
  type PersonaName,
} from "../playwright.config";
const ESTABLISHED_WORKER: PersonaName = "established-worker";
const SEEDED_PARTNER_ID = "partner-jo-mbeki";
const SEEDED_PARTNER_NAME = "Jo Mbeki";
const FOLLOW_UP_TASK_TITLE = "Send Jo the visit notes";
const INTERACTION_OUTCOME = "Agreed to meet after the service next week";
const INTERACTION_DATE = "2026-11-18";
const INTERACTION_ROLE = "Spoke on the phone with me";
const EDITED_DISPLAY_NAME = "Jo Mbeki (Harbour)";
const EDITED_GIVEN_NAME = "Josephine";
const IMAGE_FIXTURE_PATH = fileURLToPath(new URL("../public/fixtures/media/IMG_20260814-harbour-youth-group.jpg", import.meta.url)); // The committed fixture the picker is handed: a real JPEG whose own filename and EXIF must never reach the output.
const IMAGE_ALT_TEXT = "Six young people around a table in the church hall";
const TYPED_PROSE = "We met on Friday and shared a meal together.";
/** The longest any control may animate with motion suppressed, in seconds. */ const MOTION_CEILING_SECONDS = 0.05;
const TYPED_ELSEWHERE = "The second tab wrote this line about the harbour meal."; // The line a second tab saves, which is what leaves a first tab holding a revision the record has moved past.
const TYPED_STALE = "The first tab wrote this line before the record moved on."; // The line the first tab writes against the revision it read, so its save is genuinely refused as a conflict.
const TYPED_AFTER_RECOVERY = "The line written after the conflict was recovered."; // The two edits that follow the recovery, each of which must reach the service.
const TYPED_AFTER_RECOVERY_TOO = " And a second line written after that, which a reload must still find.";
const ROUTES = {
  partners: "/partners",
  work: "/work",
  matrixReport: "/support/reports/matrix",
  editor: "/communication/doc-update-autumn/variant-update-autumn-en-public",
  partnerRecord: `/partners/${SEEDED_PARTNER_ID}`,
  partnerEdit: `/partners/${SEEDED_PARTNER_ID}/edit`,
  interactionForm: `/partners/${SEEDED_PARTNER_ID}/interactions/new`,
} as const;
const ZOOM_VIEWPORT = { width: 640, height: 400 } as const;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const TAB_SWEEP_STEPS = 40; // How many `Tab` presses a sweep takes before it gives up, so a surface that traps focus is reported rather than hung on.
const ZOOM_TAB_LAST_STOP = "Rows per page";
const ROSTER_SEARCH_TEXT = "mbeki"; // The text the zoomed roster is searched with, so the list is proved operable rather than merely reachable at that zoom.
const conflictOn = (name: string): JsonRecord => ({ mode: "conflict", target: { kind: "mutation", name } });
async function openPartnerEdit(page: Page): Promise<{ readonly form: Locator; readonly displayName: Locator; readonly givenName: Locator }> {
  await page.goto(ROUTES.partnerEdit); // Opens the permitted-field edit and answers it with the form and the two named fields every refusal below is read from.
  const form = page.locator('[data-slot="partner-edit-form"]');
  return { form, displayName: form.getByRole("textbox", { name: /^Display name/u }), givenName: form.getByRole("textbox", { name: /^Given name/u }) };
}
test.describe("at 320 CSS pixels, with motion suppressed", () => {
  test.use({ viewport: { width: 320, height: 800 } });
  test("the shell and the roster meet the target-size floor, and no control animates past the reader's preference", async ({ page }, testInfo) => {
    await page.goto(ROUTES.partners);
    await expect(page.getByRole("heading", { name: "Partners", level: 1 }), "The narrow layout reaches the roster through the shell's own navigation.").toBeVisible();
    await expectDevelopmentData(page, "The partner roster");
    const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches); // The runner states reduced motion for the whole project, so a run in which the preference had not reached the page would be a run whose later motion reading means nothing.
    expect(reduced, "The run states `prefers-reduced-motion: reduce`, so the motion assertions below are made under the preference a reader would set.").toBe(true);
    const motion = await readLongestMotion(page.locator("body")); // The slowest transition any control on the surface declares, read from the computed style rather than the class list: motion collapses to 0.01 ms, so a perceptible duration means a control ignoring the preference.
    expect(motion.slowestSeconds, `No control animates for longer than ${String(MOTION_CEILING_SECONDS)} s with motion suppressed, and the slowest was ${String(motion.slowestSeconds)} s on ${JSON.stringify(motion.control)}.`).toBeLessThanOrEqual(MOTION_CEILING_SECONDS);
    await expectTargetSizeFloor(page, page.locator('[data-slot="query-toolbar"]'), "The roster toolbar and its facet toggles", testInfo);
    const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
    await expect(roster, "The roster renders the one table pattern, named so it can be found as a landmark.").toBeVisible();
    await expectTargetSizeFloor(page, roster, "The roster's row controls", testInfo);
    const sortButtons = roster.getByRole("columnheader").getByRole("button"); // Ordering is a control rather than a gesture: each sortable column offers its ordering as a button with its own name, and nothing on the surface is draggable, so no retained job here depends on dragging (WCAG 2.5.7).
    const sortCount = await sortButtons.count();
    expect(sortCount, "Each sortable column offers its ordering as a button, so sorting never depends on a gesture.").toBeGreaterThan(0);
    for (let index = 0; index < sortCount; index += 1) {
      const sortButton = sortButtons.nth(index);
      const name = ((await sortButton.getAttribute("aria-label")) ?? (await sortButton.innerText())).replace(/\s+/gu, " ").trim();
      expect(name.length, `Every ordering control states what it orders, and control ${String(index + 1)} of ${String(sortCount)} stated no name.`).toBeGreaterThan(0);
    }
    await expect(roster.locator('[draggable="true"]'), "Nothing on the roster is draggable, so reordering and resizing are never a drag-only path.").toHaveCount(0);
    await expectNoHorizontalPageScroll(page, "The partner roster at 320 CSS px"); // One table region, one horizontal port: the page itself never scrolls sideways at this width.
    await expectSoleHorizontalScroller(page, roster, "The partner roster at 320 CSS px");
    await expectScrollPaddingSet(page, "The partner roster at 320 CSS px");
    await expectDevelopmentData(page, "The partner roster");
  });
  test.describe("the new worker's first session", () => {
    test.use({ persona: "new-worker" }); // The identity criterion 2 names: a workspace with no gifts, goal, subscription or integration, so the two jobs below are the first things this worker does rather than edits of seeded work.
    test("the first session's two jobs complete with the keyboard alone: a private contact from a name, and a one-off task", async ({ page }, testInfo) => {
      await page.goto(ROUTES.partners);
      await expect(page.getByRole("heading", { name: "Partners", level: 1 })).toBeVisible();
      const preparation = page.locator('[data-slot="private-preparation-form"]');
      await expect(preparation.getByRole("heading", { name: "Add a private contact", level: 2 }), "The private-contact form is mounted once, below the roster, with its own heading.").toBeVisible();
      await expectNoHorizontalPageScroll(page, "The private-contact form at 320 CSS px"); // The narrow layout must not need a desktop drawer to reach the job: the form is on the page, in reading order.
      await typeFromKeyboard(page, preparation.getByRole("textbox", { name: /^Name/u }), "Ruth Okafor (met at the school gate)", "The private contact's name");
      await pressFromKeyboard(page, preparation.getByRole("button", { name: "Add a private contact" }), "Submitting the private contact");
      const created = preparation.locator('[data-slot="private-preparation-outcome"]');
      await expect(created, "The accepted result is stated in the form that submitted it, not in a toast that disappears.").toHaveAttribute("data-outcome", "accepted");
      await expect(created.getByText("Created: one private preparation record", { exact: false }), "The receipt states what was created: one private preparation record, and nothing beside it.").toBeVisible();
      await expect(created.getByRole("link", { name: "Open the private contact" }), "The receipt names where the record it created now lives, so the contact is findable from the result itself.").toBeVisible();
      await expectNoHorizontalPageScroll(page, "The private-contact form's result at 320 CSS px");
      await page.goto(ROUTES.work);
      await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
      await expectDevelopmentData(page, "The Work surface");
      await pressFromKeyboard(page, page.getByRole("button", { name: "New task" }).first(), "Opening the task composer");
      const composer = page.getByRole("region", { name: "New task" });
      await expect(composer, "Creating a task happens in the one composer that owns the task form.").toBeVisible();
      await typeFromKeyboard(page, composer.getByRole("textbox", { name: /^Title/u }), "Phone the venue about Saturday", "The task's title");
      await pressFromKeyboard(page, composer.getByRole("button", { name: "Create task" }), "Creating the task");
      await expect(composer.locator('[data-slot="operation-result"]'), "Creating a task is accepted, and its receipt stays in the composer that submitted it.").toHaveAttribute("data-outcome", "accepted");
      await pressFromKeyboard(page, composer.getByRole("button", { name: "Done" }), "Dismissing the task composer's receipt");
      await expect(page.locator('[data-slot="task-composer"]'), "Dismissing the receipt closes the composer rather than leaving a second, settled form open.").toHaveCount(0);
      await expectNoHorizontalPageScroll(page, "The Work surface at 320 CSS px");
      await page.goto(ROUTES.partners);
      const stops = await sweepTabOrder(page, "The partner roster at 320 CSS px", TAB_SWEEP_STEPS);
      const searchStop = stops.findIndex((name) => name === "Search");
      const rowStop = stops.findIndex((name) => name.startsWith("Open "));
      expect(searchStop, `Tab reaches the roster's search field, and the sweep met ${JSON.stringify(stops.slice(0, 12))}.`).toBeGreaterThanOrEqual(0);
      expect(rowStop, `Tab reaches a record's own action, so the list is operable without a pointer${searchStop < 0 ? "" : ` (the search field was stop ${String(searchStop + 1)})`}.`).toBeGreaterThanOrEqual(0);
      await expectDevelopmentData(page, "The partner roster's tab order");
      await testInfo.attach("tab order — partner roster at 320 px", { body: JSON.stringify({ stops }, null, 2), contentType: "application/json" });
    });
  });
  test.describe("the established worker's retained jobs", () => {
    test.use({ persona: ESTABLISHED_WORKER });
    test("a partner's record is read, an interaction is logged and the next task created, with the keyboard alone", async ({ page }) => {
      await page.goto(ROUTES.partners);
      const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
      await expect(roster, "The roster is the way into a record at this width, and the only horizontal scroll port.").toBeVisible();
      await pressFromKeyboard(page, roster.getByRole("link", { name: `Open ${SEEDED_PARTNER_NAME}` }), "Opening the seeded partner's record");
      await expect(page.getByRole("heading", { name: SEEDED_PARTNER_NAME, level: 1 }), "The record opens as a full page at 320 CSS px, not as a panel a phone cannot show.").toBeVisible();
      await expect(page.getByRole("dialog"), "The record is the page itself at this width: opening it never depends on a panel only a wide screen can show.").toHaveCount(0);
      await expectDevelopmentData(page, "The partner's record");
      await expectNoHorizontalPageScroll(page, "The partner's record at 320 CSS px");
      const restrictions = page.getByRole("region", { name: "Restrictions" }); // The restrictions section is read before anything is recorded: a limit the source recorded is part of what the worker must know before acting, and it is stated on the record rather than in a tooltip.
      await expect(restrictions, "The record states the restrictions recorded against this relationship.").toBeVisible();
      const recordedRestrictions = await restrictions.locator("li").count();
      await pressFromKeyboard(page, page.getByRole("link", { name: "Log an interaction" }), "Opening the interaction form");
      const form = page.locator('[data-slot="interaction-form"]');
      await expect(form.getByRole("heading", { name: "Log an interaction", level: 2 }), "The interaction is logged in the family's one record form.").toBeVisible();
      await expectNoHorizontalPageScroll(page, "The interaction form at 320 CSS px");
      await form.getByRole("combobox", { name: /^Kind of contact/u }).selectOption("call");
      await form.getByRole("textbox", { name: /^The day it happened/u }).fill(INTERACTION_DATE);
      await typeFromKeyboard(page, form.getByRole("textbox", { name: /^How they took part/u }), INTERACTION_ROLE, "How the contact took part");
      await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What came of it/u }), INTERACTION_OUTCOME, "What came of the contact");
      await pressFromKeyboard(page, form.getByRole("radio", { name: /^Create a follow-up task/u }), "Choosing the follow-up task", " ");
      await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What needs doing/u }), FOLLOW_UP_TASK_TITLE, "The follow-up task's title");
      await form.getByRole("textbox", { name: /^Due on/u }).fill(INTERACTION_DATE);
      await pressFromKeyboard(page, form.getByRole("button", { name: "Log the interaction" }), "Submitting the interaction");
      const receipts = form.locator('[data-slot="operation-result"][data-outcome="accepted"]'); // Two receipts, because the interaction and the task are two changes with two identities: a task that failed could not otherwise be told apart from an interaction that was recorded twice.
      await expect(receipts, "The interaction and the follow-up task are each accepted as their own change.").toHaveCount(2);
      await page.goto(ROUTES.partnerRecord);
      const openTasks = page.getByRole("region", { name: "Open tasks" });
      await expect(openTasks, "The recorded work is stated on the record it was filed against.").toBeVisible();
      await expect(openTasks.getByText(FOLLOW_UP_TASK_TITLE, { exact: false }), "The follow-up task the interaction created is open work on this record.").toBeVisible();
      await expect(page.getByRole("region", { name: "Actual activity" }).getByText(INTERACTION_OUTCOME, { exact: false }), "What happened is stated as activity, because the interaction recorded something that did.").toBeVisible();
      await expect(page.getByRole("region", { name: "Restrictions" }).locator("li"), "Logging an interaction neither adds nor removes a restriction.").toHaveCount(recordedRestrictions);
      await expectNoHorizontalPageScroll(page, "The partner's record after the interaction at 320 CSS px");
      await expectDevelopmentData(page, "The partner's record");
    });
    test("an image is placed in the Update edition and its preview opened, and the picker traps focus and returns it", async ({ page }, testInfo) => {
      await page.goto(ROUTES.editor);
      await expect(page.getByRole("heading", { name: "Update edition", level: 1 }), "The one editor of one edition is the only way in at this width.").toBeVisible();
      await expectDevelopmentData(page, "The Update editor");
      await expectNoHorizontalPageScroll(page, "The Update editor at 320 CSS px");
      const body = page.getByRole("textbox", { name: "The text of this Update edition" }); // two panes one surface rather than two.
      await expect(body, "The writing pane is the one editing surface this edition has.").toBeVisible();
      await body.focus();
      await page.keyboard.type(TYPED_PROSE);
      await expect(body, "The characters the keyboard typed are in the edition's own text.").toContainText(TYPED_PROSE);
      await pressFromKeyboard(page, page.getByRole("button", { name: "Media", exact: true }), "Switching to the media pane", " ");
      const mediaPane = page.getByRole("region", { name: "Media in this draft" });
      await expect(mediaPane, "The media pane states the draft's placements and the place a new one is added.").toBeVisible();
      await expectTargetSizeFloor(page, mediaPane, "The media pane's controls", testInfo);
      await pressFromKeyboard(page, page.getByRole("button", { name: "Write", exact: true }), "Returning to the writing pane", " ");
      await expect(page.getByRole("textbox", { name: "The text of this Update edition" }), "Returning to the writing pane keeps the text that was typed in it.").toContainText(TYPED_PROSE);
      await pressFromKeyboard(page, page.getByRole("button", { name: "Media", exact: true }), "Returning to the media pane", " ");
      const opener = mediaPane.getByRole("button", { name: "Add an image" });
      await pressFromKeyboard(page, opener, "Opening the image picker");
      const picker = page.locator('[data-slot="media-picker"]');
      await expect(picker, "The picker opens as one dialog whatever the pane behind it is doing.").toBeVisible();
      await expect(picker.getByRole("heading", { name: "Add an image" }), "The dialog names the job it does.").toBeVisible();
      await expect(picker, "The open dialog states its modality, so assistive technology knows the page behind it is inert.").toHaveAttribute("aria-modal", "true");
      for (let step = 1; step <= 8; step += 1) {
        await page.keyboard.press("Tab");
        await settleLayout(page);
        await expectFocusInsideDialog(picker, `The picker keeps the ${String(step)}th Tab inside the dialog, so an open dialog never lets focus escape behind it.`);
      }
      await picker.getByLabel(/^File/u).setInputFiles(IMAGE_FIXTURE_PATH); // The file chooser belongs to the browser and cannot be operated from a script, so the input is handed the file. Everything after it — the alternative text, the confirmation and the close — is done from the keyboard.
      const described = page.locator('[data-slot="media-picker"][data-phase="described"]');
      await expect(described, "A measured file reaches the step that describes it, where alternative text is required.").toBeVisible();
      await typeFromKeyboard(page, described.getByRole("textbox", { name: /^Alternative text/u }), IMAGE_ALT_TEXT, "The image's alternative text");
      await pressFromKeyboard(page, described.getByRole("button", { name: "Add this image" }), "Placing the image");
      await expect(page.locator('[data-slot="media-picker"][data-phase="settled"]'), "The placement is settled inside the picker, which states what the attempt answered.").toBeVisible();
      await page.keyboard.press("Escape");
      await expect(picker, "Escape closes the picker rather than leaving an open dialog behind.").toHaveCount(0);
      await expect(opener, "Closing the picker returns focus to the control that opened it.").toBeFocused();
      await expect(page.getByRole("region", { name: "Images in this draft, scrollable" }).getByText(IMAGE_ALT_TEXT, { exact: false }), "The draft's media pane states the placement the draft now holds.").toBeVisible();
      await pressFromKeyboard(page, page.getByRole("link", { name: "Preview this edition" }), "Opening the preview");
      await expect(page.getByRole("heading", { name: "Preview", level: 1 }), "The preview is a destination of its own, one step from the editor.").toBeVisible();
      await expect(page.getByRole("img", { name: IMAGE_ALT_TEXT }).first(), "The preview renders the placement with its own text alternative, so the image is described to a reader who cannot see it.").toBeVisible();
      await expectNoHorizontalPageScroll(page, "The Update preview at 320 CSS px");
      await expectDevelopmentData(page, "The Update preview");
    });
    test("every route this file visits fits 320 CSS px, and the matrix answers with its period-first presentation", async ({ page }) => {
      const surfaces: readonly { readonly route: string; readonly heading: string }[] = [
        { route: ROUTES.partners, heading: "Partners" },
        { route: ROUTES.work, heading: "Work" },
        { route: ROUTES.partnerRecord, heading: SEEDED_PARTNER_NAME },
        { route: ROUTES.partnerEdit, heading: `Edit ${SEEDED_PARTNER_NAME}` },
        { route: ROUTES.editor, heading: "Update edition" },
      ];
      for (const surface of surfaces) {
        await page.goto(surface.route);
        await expect(page.getByRole("heading", { name: surface.heading, level: 1 }), `${surface.route} states its own heading, so the reflow reading below is of the surface it names.`).toBeVisible();
        await expectNoHorizontalPageScroll(page, `${surface.route} at 320 CSS px`);
        await expectDevelopmentData(page, surface.route);
        await expectScrollPaddingSet(page, surface.route);
      }
      await page.goto(ROUTES.matrixReport); // The partner-by-month matrix is the widest thing this application renders. At this width it must answer with its period-first, labelled presentation instead of a table a reader would have to drag sideways to read a cell.
      const matrix = page.locator('[data-slot="report-matrix"]').first();
      await expect(matrix, "The matrix report states the matrix it computed for its query.").toBeVisible();
      const periodFirst = matrix.locator('[data-slot="report-matrix-periods"]').first();
      await expect(periodFirst, "At 320 CSS px the matrix is stated period by period, each period heading a labelled list.").toBeVisible();
      await expect(periodFirst.getByRole("heading", { level: 3 }).first(), "Each period the matrix states is headed by its own long label, so no cell needs a column header kept in mind.").toBeVisible();
      await expect(matrix.locator("table:visible"), "The wide matrix table is not offered at this width, because reading it would mean dragging it sideways.").toHaveCount(0);
      await expectNoHorizontalPageScroll(page, "The matrix report at 320 CSS px");
      await expectDevelopmentData(page, "The matrix report");
    });
  });
  test.describe("the review surface's frozen revision", () => {
    test.use({ persona: ESTABLISHED_WORKER }); // The reviewer a candidate is answered by: the frozen frame exists on the review surface alone, so the stop measured here is the one that surface gives.
    test("the frozen revision's frame takes focus with a visible indicator, and the frame is scrolled clear of the shell", async ({ page }) => {
      await page.goto("/communication/review/rev-update-ar-candidate-1"); // The Arabic candidate the surface was reported on, so the frame measured is the one whose focus a keyboard user could not see.
      await expect(page.locator('[data-slot="review-panel"]'), "The review surface renders the frozen candidate whose frame is the tab stop under test.").toBeVisible();
      const frame = page.locator('[data-slot="review-candidate-frame"]');
      let reachedAtStep = -1;
      for (let step = 1; step <= TAB_SWEEP_STEPS && reachedAtStep < 0; step += 1) {
        await page.keyboard.press("Tab");
        await settleLayout(page);
        if (await frame.evaluate((element) => element === document.activeElement)) reachedAtStep = step;
      }
      expect(reachedAtStep, `Tab reaches the frozen revision's frame within ${String(TAB_SWEEP_STEPS)} presses, so the preview is a keyboard stop rather than a view only a pointer can reach.`).toBeGreaterThan(0);
      await expect(frame, "The frame itself holds focus, so every reading below describes the stop a keyboard user lands on.").toBeFocused();
      await settleLayout(page);
      await expectFocusVisibleAndUnobscured(page, "The frozen revision's frame at 320 CSS px"); // The frame is in view and clear of the sticky shell once it holds focus, because focus is never moved to content a reader cannot see (WCAG 2.4.11).
      const indicator = await frame.evaluate((element) => {
        const readings: string[] = [];
        for (let current: Element | null = element; current !== null; current = current.parentElement) {
          const style = window.getComputedStyle(current);
          const outlineWidth = Number.parseFloat(style.outlineWidth);
          const drawn = style.boxShadow !== "none" || (style.outlineStyle !== "none" && Number.isFinite(outlineWidth) && outlineWidth > 0);
          readings.push(`${current.getAttribute("data-slot") ?? current.tagName.toLowerCase()}: box-shadow ${style.boxShadow}, outline ${style.outlineStyle} ${style.outlineWidth}`);
          if (drawn) return { drawn, readings };
          if (current.matches('[data-slot="review-preview"]')) break;
        }
        return { drawn: false, readings };
      });
      expect(indicator.drawn, `A visible focus indicator is drawn on the frame or on the element that holds it, because a keyboard user needs to see where focus is; the computed values read were ${JSON.stringify(indicator.readings)}.`).toBe(true);
    });
  });
});
test.describe("at 200 % zoom", () => {
  test.use({ viewport: ZOOM_VIEWPORT, deviceScaleFactor: 2, persona: ESTABLISHED_WORKER });
  test("a list, a form and the editor stay readable and operable, and an overlay still traps and returns focus", async ({ page }, testInfo) => {
    await page.goto(ROUTES.partners);
    const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
    await expect(roster).toBeVisible();
    const zoomed = await page.evaluate(() => ({ narrowQueryMatches: window.matchMedia("(max-width: 767px)").matches, innerWidth: window.innerWidth })); // The pass has to be a real browser zoom rather than a scaled root: what a zoomed reader meets is the layout's own breakpoints switched.
    expect(zoomed.narrowQueryMatches, "At 200 % zoom the layout's own breakpoints switch as they do in a browser: below 768 px the shell composes its mobile navigation, so the (max-width: 767px) query the responsive composition declares resolves true on this pass.").toBe(true);
    expect(zoomed.innerWidth, "At 200 % zoom the CSS viewport is half the 1280 px width of the desktop window the reader is looking at, and window.innerWidth is the width every media query and the layout itself resolve against.").toBe(ZOOM_VIEWPORT.width);
    await expectNoHorizontalPageScroll(page, "The partner roster at 200 % zoom");
    await expectTextNotClipped(page.locator('[data-slot="query-toolbar"]'), "The roster toolbar at 200 % zoom");
    await expectTargetSizeFloor(page, page.locator('[data-slot="query-toolbar"]'), "The roster toolbar at 200 % zoom", testInfo);
    const stops = await sweepTabOrder(page, "The partner roster at 200 % zoom", 96, ZOOM_TAB_LAST_STOP); // At this zoom the shell is below its 768 px breakpoint, so the sweep's stops are the surface's own controls: each is proved visible and unobscured by the sweep itself, and the families of control the job needs are named in the order they must come.
    await testInfo.attach("tab order — partner roster at 200 % zoom", { body: JSON.stringify({ stops }, null, 2), contentType: "application/json" });
    const reachable: readonly { readonly name: string; readonly control: string }[] = [
      { name: "Search", control: "the roster's search field" },
      { name: "Contact type", control: "a facet toggle" },
      { name: "Name", control: "the sortable column headers" },
      { name: `Open ${SEEDED_PARTNER_NAME}`, control: "a record's own action" },
      { name: ZOOM_TAB_LAST_STOP, control: "the pager" },
    ];
    let previous = -1;
    for (const row of reachable) {
      const at = stops.indexOf(row.name);
      expect(at, `Tab reaches ${row.control} at 200 % zoom, after every control before it and with each stop visible and unobscured (the sweep read ${JSON.stringify(stops.slice(0, 6))}).`).toBeGreaterThan(previous);
      previous = at;
    }
    await typeFromKeyboard(page, page.getByRole("searchbox", { name: "Search" }), ROSTER_SEARCH_TEXT, "The roster search at 200 % zoom");
    await expectNoHorizontalPageScroll(page, "The roster with a search typed at 200 % zoom");
    await expectDevelopmentData(page, "The partner roster at 200 % zoom");
    const { form } = await openPartnerEdit(page);
    await expect(form).toBeVisible();
    await expectNoHorizontalPageScroll(page, "The contact edit form at 200 % zoom");
    await expectTextNotClipped(form, "The contact edit form at 200 % zoom");
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^Display name/u }), EDITED_DISPLAY_NAME, "The display name at 200 % zoom");
    await expectNoHorizontalPageScroll(page, "The contact edit form with text typed at 200 % zoom");
    await page.goto(ROUTES.editor);
    await expect(page.getByRole("heading", { name: "Update edition", level: 1 })).toBeVisible();
    await expectNoHorizontalPageScroll(page, "The Update editor at 200 % zoom");
    await expectTextNotClipped(page.getByRole("region", { name: "Write this Update edition" }), "The Update editor at 200 % zoom");
    await pressFromKeyboard(page, page.getByRole("button", { name: "Media", exact: true }), "Switching to the media pane at 200 % zoom", " "); // Below the 768 px breakpoint the editor offers its two panes as pressed buttons, so the media pane is reached from the keyboard the way the 320 px pass reaches it rather than standing beside the writing pane.
    const mediaPane = page.getByRole("region", { name: "Media in this draft" });
    const opener = mediaPane.getByRole("button", { name: "Add an image" });
    await pressFromKeyboard(page, opener, "Opening the image picker at 200 % zoom");
    const picker = page.locator('[data-slot="media-picker"]');
    await expect(picker).toBeVisible();
    await expectNoHorizontalPageScroll(page, "The image picker at 200 % zoom");
    for (let step = 1; step <= 6; step += 1) {
      await page.keyboard.press("Tab"); // An overlay is fully operable at this zoom: focus is contained while it is open, Escape closes it, and focus returns to the control that opened it rather than to the top of the document.
      await settleLayout(page);
      await expectFocusInsideDialog(picker, `The open picker keeps the ${String(step)}th Tab inside itself at 200 % zoom.`);
    }
    await page.keyboard.press("Escape");
    await expect(picker, "Escape closes the picker at 200 % zoom.").toHaveCount(0);
    await expect(opener, "Closing the picker returns focus to the control that opened it at 200 % zoom.").toBeFocused();
    await expectDevelopmentData(page, "The Update editor at 200 % zoom");
  });
});
test.describe("the WCAG 2.2 AA audit", () => {
  test.use({ viewport: DESKTOP_VIEWPORT, persona: ESTABLISHED_WORKER });
  test("the shell, a form, an open dialog, the partners table and the prose editor carry no serious or critical violation", async ({ page }, testInfo) => {
    auditedSurfaces.length = 0;
    await page.goto(ROUTES.partners);
    await expect(page.getByRole("navigation", { name: "Primary" }), "The shell's navigation is a named landmark, so it can be audited as the surface it is.").toBeVisible();
    await auditSurface(page, testInfo, "the shell navigation");
    const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
    await expect(roster.getByRole("table")).toBeVisible();
    await auditSurface(page, testInfo, "the partners table");
    await page.goto(ROUTES.interactionForm);
    const form = page.locator('[data-slot="interaction-form"]');
    await expect(form.getByRole("heading", { name: "Log an interaction", level: 2 })).toBeVisible();
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What came of it/u }), INTERACTION_OUTCOME, "What came of the contact");
    await auditSurface(page, testInfo, "the interaction form");
    await page.goto(ROUTES.editor); // 4. An open dialog. The picker is audited while it is open, because a closed dialog is not a surface a person can meet and an open one is where focus containment, labelling and the file input all have to hold.
    const mediaPane = page.getByRole("region", { name: "Media in this draft" });
    await pressFromKeyboard(page, mediaPane.getByRole("button", { name: "Add an image" }), "Opening the image picker for the audit");
    const picker = page.locator('[data-slot="media-picker"]');
    await expect(picker, "The dialog is open when it is audited.").toBeVisible();
    await auditSurface(page, testInfo, "the open media picker");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "The text of this Update edition" }), "The one prose editor is the surface audited here.").toBeVisible();
    await auditSurface(page, testInfo, "the prose editor");
    expect(auditedSurfaces, "All five surfaces the criterion names were audited, so a surface that stopped running could not pass.").toEqual(["the shell navigation", "the partners table", "the interaction form", "the open media picker", "the prose editor"]);
    await expectDevelopmentData(page, "The audited editor");
  });
});
test.describe("a save that is refused", () => {
  test.use({ viewport: DESKTOP_VIEWPORT, persona: ESTABLISHED_WORKER });
  test("a refusal is stated in the field's own error slot before anything is sent, and the corrected save is accepted", async ({ page }) => {
    const { form, displayName, givenName } = await openPartnerEdit(page);
    await expect(form, "The permitted-field edit is offered to the identity that may change this record.").toBeVisible();
    const save = form.getByRole("button", { name: "Save these changes" });
    await expect(save, "A pristine form is still offered for sending, so the save that changes nothing stays reachable.").toBeEnabled();
    await expect(page.locator("#field-displayName-error"), "A pristine form states no refusal, because no field has been edited yet.").toHaveCount(0);
    await typeFromKeyboard(page, givenName, EDITED_GIVEN_NAME, "The given name");
    await typeFromKeyboard(page, displayName, "", "Clearing the display name");
    await expect(page.locator("#field-displayName-error"), "The required field states its own message as soon as it is emptied, without waiting for a save.").toBeVisible();
    await expect(displayName, "The control is marked invalid for assistive technology, not only coloured.").toHaveAttribute("aria-invalid", "true");
    await expect(displayName, "The invalid control is described by its own message, so a screen reader reads why it was refused.").toHaveAttribute("aria-describedby", /field-displayName-error/u);
    await expect(save, "The primary action is withheld while the field it would send states what it needs.").toBeDisabled();
    await expect(form.getByText(/^Saving cannot start while a field above states what it needs\./u), "The action states why it is withheld and that nothing typed was discarded.").toBeVisible();
    await expect(givenName, "The refusal loses nothing else the worker typed.").toHaveValue(EDITED_GIVEN_NAME);
    await typeFromKeyboard(page, displayName, EDITED_DISPLAY_NAME, "Correcting the display name"); // The retry succeeds once the field it refused is corrected: the refusal changed nothing, so nothing has to be re-entered beyond the one value it named.
    await expect(page.locator("#field-displayName-error"), "The corrected field no longer states an error.").toHaveCount(0);
    await expect(save, "The primary action is offered again once nothing above needs correcting.").toBeEnabled();
    await pressFromKeyboard(page, save, "Saving the corrected change");
    await expect(page.locator('[data-slot="partner-edit-outcome"][data-outcome="accepted"]'), "The corrected change is accepted, so a refused save is recoverable without re-entering the form.").toBeVisible();
    await expectDevelopmentData(page, "The permitted-field edit");
  });
  test("a stale revision shows the current value beside the preserved input and offers a deliberate choice", async ({ page, request }) => {
    await setFailurePlan(request, conflictOn("saveContactEdits"));
    const { form, displayName, givenName } = await openPartnerEdit(page);
    await expect(form).toBeVisible();
    await typeFromKeyboard(page, givenName, EDITED_GIVEN_NAME, "The given name");
    await typeFromKeyboard(page, displayName, EDITED_DISPLAY_NAME, "The display name");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Save these changes" }), "Saving against a revision that has moved");
    const conflict = page.locator('[data-slot="partner-edit-conflict"]'); // A stale revision is answered with the conflict panel rather than with a lost change: the input is preserved, the record's own value is stated beside it, and re-applying or discarding is the worker's decision.
    await expect(conflict, "A stale revision is answered with the conflict panel rather than a silently lost change.").toBeVisible();
    for (const name of ["Apply my changes", "Discard mine"]) await expect(conflict.getByRole("button", { name }), `The panel offers ${name} deliberately rather than deciding for the worker.`).toBeVisible();
    await expect(conflict.getByText(/revision/u).first(), "The panel states the revision the record stands at, so the refusal is stated in the record's own terms.").toBeVisible();
    const conflictText = (await conflict.innerText()).replace(/\s+/gu, " "); // The panel's own words, read once: a conflict states the fields that differ rather than the two whole records, so a worker reads what the other change actually touched.
    expect(conflictText, "The panel lists the fields the record and this edit disagree on.").toContain("Fields that differ");
    expect(conflictText, "The display name this edit changed is named by the form's own label for it.").toContain("Display name");
    expect(conflictText, "The given name this edit changed is named by the label the form gives that field, not as a nested record.").toContain("Given name");
    expect(conflictText, "No whole record is printed: the panel states no JSON object and restates none of the record's untouched fields - its revision, audience, source reference, tags or contact methods.").not.toMatch(/[{}]|"(?:revision|audience|source|tags|favourite|restrictions|contactMethods)"|ownerPrincipalId/u);
    await expect(displayName, "Every value the worker typed is still in its own field after the refusal.").toHaveValue(EDITED_DISPLAY_NAME);
    await expect(givenName, "Every value the worker typed is still in its own field after the refusal.").toHaveValue(EDITED_GIVEN_NAME);
    await expect(page.locator('[data-slot="partner-edit-outcome"][data-outcome="accepted"]'), "The refused attempt applied nothing, so no accepted change is claimed.").toHaveCount(0);
    await page.goto(ROUTES.partnerEdit); // An armed conflict refuses a save that changes nothing too, because the revision is compared before anything is applied, so the panel must say that no field differs rather than fall back to printing the record.
    await pressFromKeyboard(page, form.getByRole("button", { name: "Save these changes" }), "Saving with no field changed against a revision that has moved");
    await expect(conflict, "A save whose input differs on no field is still refused as a conflict rather than silently applied.").toBeVisible();
    const unchangedText = (await conflict.innerText()).replace(/\s+/gu, " ");
    expect(unchangedText, "A conflict that disagrees on no field says so, naming the revision as what it refuses.").toContain("Your input states no value the record holds differently");
    expect(unchangedText, "Even then no whole record is printed: no JSON object and none of the record's untouched fields reach the worker.").not.toMatch(/[{}]|"(?:revision|audience|source|tags|favourite|restrictions|contactMethods|displayName|nameParts)"|ownerPrincipalId/u);
    await clearFailurePlan(request);
    await page.goto(ROUTES.partnerEdit);
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^Given name/u }), EDITED_GIVEN_NAME, "The given name, re-entered");
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^Display name/u }), EDITED_DISPLAY_NAME, "The display name, re-entered");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Save these changes" }), "Saving the same change against the revision now standing");
    await expect(page.locator('[data-slot="partner-edit-outcome"][data-outcome="accepted"]'), "The change the conflict preserved is applied once the revision it presents is the one the record stands at.").toBeVisible();
    await expectDevelopmentData(page, "The permitted-field edit after recovery");
  });
  test("a lost acknowledgement keeps every typed value and recovers the same attempt by its own identity", async ({ page, request }) => {
    await armLostAcknowledgement(request, "logInteraction");
    await page.goto(ROUTES.interactionForm);
    const form = page.locator('[data-slot="interaction-form"]');
    await expect(form.getByRole("heading", { name: "Log an interaction", level: 2 })).toBeVisible();
    await form.getByRole("combobox", { name: /^Kind of contact/u }).selectOption("call");
    await form.getByRole("textbox", { name: /^The day it happened/u }).fill(INTERACTION_DATE);
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^How they took part/u }), INTERACTION_ROLE, "How the contact took part");
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What came of it/u }), INTERACTION_OUTCOME, "What came of the contact");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Log the interaction" }), "Submitting the interaction");
    const receipt = form.locator('[data-slot="operation-result"]'); // The acknowledgement was lost, so the receipt claims neither success nor failure, keeps every typed value on screen, and offers no second submit.
    await expect(receipt, "A lost acknowledgement is stated as unknown rather than claimed as saved or refused.").toHaveAttribute("data-outcome", "unknown");
    await expect(receipt.getByRole("button", { name: "Check the result" }), "The receipt offers checking this same attempt rather than sending the work again.").toBeVisible();
    await expect(form.getByRole("textbox", { name: /^What came of it/u }), "Every value the worker typed is still on screen while the result is unconfirmed.").toHaveValue(INTERACTION_OUTCOME);
    await expect(form.getByRole("button", { name: "Log the interaction" }), "No second submit is offered for work that may already exist.").toHaveCount(0);
    await clearFailurePlan(request);
    await pressFromKeyboard(page, receipt.getByRole("button", { name: "Check the result" }), "Checking the same attempt's result");
    await expect(form.locator('[data-slot="operation-result"][data-outcome="alreadyAccepted"]'), "The same attempt's result is recovered by its own identity, so exactly one effect exists.").toBeVisible();
    await page.goto(ROUTES.partnerRecord);
    await expect(page.getByRole("region", { name: "Actual activity" }).getByText(INTERACTION_OUTCOME, { exact: false }), "The recovered attempt recorded the contact once, and the record states it.").toHaveCount(1);
    await expectDevelopmentData(page, "The partner's record after a recovered interaction");
  });
  test("a refused autosave keeps the readable text, says it is not acknowledged, and the kept copy saves once the condition is gone", async ({ page, request }) => {
    await setFailurePlan(request, conflictOn("saveDraft"));
    await page.goto(ROUTES.editor);
    const editor = page.getByRole("textbox", { name: "The text of this Update edition" });
    await expect(editor, "The edition's own text is the one editing surface this family has.").toBeVisible();
    await editor.focus();
    await expect(editor).toBeFocused();
    await page.keyboard.type(TYPED_PROSE);
    await expect(editor, "The characters the keyboard typed are in the editor the worker is reading.").toContainText(TYPED_PROSE);
    const status = page.locator('[data-slot="autosave-status"]');
    await expect(status, "The refused save is stated as a conflict rather than as an empty editor or a silent failure.").toHaveAttribute("data-autosave-state", "conflict");
    await expect(editor, "A refused save keeps the readable text on screen: nothing the worker wrote is discarded by a failure.").toContainText(TYPED_PROSE);
    await expect(status.getByRole("button", { name: "Retry the same work" }), "The status offers re-sending this same attempt rather than a second save under a new identity.").toBeVisible();
    await clearFailurePlan(request); // The condition is cleared, and the editor is re-read: the text this browser kept is offered as exactly what it is — the text the service never acknowledged — and adopting it begins an ordinary change against the revision the record now stands at.
    await page.reload();
    const kept = page.getByRole("button", { name: "Use the text this browser kept" });
    await expect(kept, "After the editor is re-read, the text this browser kept is offered and labelled as existing only in this browser.").toBeVisible();
    await pressFromKeyboard(page, kept, "Adopting the text this browser kept");
    await expect(page.locator('[data-slot="autosave-status"]'), "The adopted text saves as an ordinary change once the condition behind the refusal is gone.").toHaveAttribute("data-autosave-state", "saved");
    await expect(page.getByRole("textbox", { name: "The text of this Update edition" }), "The saved text is the text still on screen.").toContainText(TYPED_PROSE);
    await expectDevelopmentData(page, "The Update editor after a recovered save");
  });
  test("a conflict recovered from a second tab leaves one saved state, and every edit after it reaches the record", async ({ page, context }) => {
    await page.goto(ROUTES.editor); // This tab reads the edition at the revision it holds, so a save from a second tab leaves it behind.
    const editor = page.getByRole("textbox", { name: "The text of this Update edition" });
    await expect(editor, "The edition's own text is the one editing surface this family has.").toBeVisible();
    const status = page.locator('[data-slot="autosave-status"]');
    const other = await context.newPage(); // A second tab of this same browser and session, so the conflict is a real one between two writers rather than an injected failure.
    await other.goto(ROUTES.editor);
    const otherEditor = other.getByRole("textbox", { name: "The text of this Update edition" });
    await expect(otherEditor, "The second tab opens the same edition's own editing surface.").toBeVisible();
    await otherEditor.focus();
    await other.keyboard.type(TYPED_ELSEWHERE);
    await expect(other.locator('[data-slot="autosave-status"]'), "The second tab's save is acknowledged first, so the record has genuinely moved past the revision the first tab holds.").toHaveAttribute("data-autosave-state", "saved");
    await editor.focus();
    await page.keyboard.type(TYPED_STALE);
    await expect(status, "The first tab's save is refused as a conflict with the revision the record now stands at.").toHaveAttribute("data-autosave-state", "conflict");
    await other.close(); // The second tab has done its work: resolving the conflict belongs to the first tab.
    await pressFromKeyboard(page, status.getByRole("button", { name: "Retry the same work" }), "Retrying the same work after the conflict");
    await expect(status, "The retried save is acknowledged, so the one owner of the draft's save state states one saved outcome.").toHaveAttribute("data-autosave-state", "saved");
    await expect(page.getByText(/Not saved/u), "Nothing on the page still says the text is unsaved: one owner of that state is what leaves one state on screen.").toHaveCount(0);
    const revisionFact = page.locator('[data-slot="editor-shell-body"] dl dd .mono-identifier').first(); // The draft revision the editor states: the fact a save moves, and so the proof a later edit reached the service.
    await expect(revisionFact, "The editor states the revision the recovered draft now stands at.").toBeVisible();
    const recovered = (await revisionFact.innerText()).trim();
    await editor.focus();
    await page.keyboard.type(TYPED_AFTER_RECOVERY);
    await expect(status, "The first edit after the recovered conflict is saved rather than silently held back.").toHaveAttribute("data-autosave-state", "saved");
    await expect(revisionFact, "The first edit after the recovered conflict reached the service: the stated draft revision moved.").not.toHaveText(recovered);
    const afterFirstEdit = (await revisionFact.innerText()).trim();
    await editor.focus();
    await page.keyboard.type(TYPED_AFTER_RECOVERY_TOO);
    await expect(status, "The second edit is saved as well, so recovering a conflict never halts the autosave.").toHaveAttribute("data-autosave-state", "saved");
    await expect(revisionFact, "The second edit reached the service too: the stated draft revision moved again.").not.toHaveText(afterFirstEdit);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "The text of this Update edition" }), "The text written after the recovered conflict is stored, so a reload still finds it in the editor.").toContainText(TYPED_AFTER_RECOVERY_TOO);
    await expectDevelopmentData(page, "The Update editor after a recovered conflict");
  });
});
