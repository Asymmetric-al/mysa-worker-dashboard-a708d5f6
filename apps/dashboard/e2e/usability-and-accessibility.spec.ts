/**
 * Criterion 20 — usability and recovery: the retained jobs complete at 320 CSS pixels with the keyboard alone, at
 * 200 % zoom and with motion suppressed, no page scrolls sideways except a table's own labelled scroll region, the
 * WCAG 2.2 AA audit carries no serious or critical violation on any of the five surfaces it names, and a save that is
 * refused keeps every word the worker typed.
 *
 * **The scenario, from the deterministic seed.** Two seeded identities carry the three representative jobs the
 * criterion names. The **new worker** holds criterion 2's jobs — a private contact created from a name alone and a
 * one-off task — and is the only identity whose workspace begins almost empty, so the narrow layout is read where the
 * page is at its plainest. The **established worker** holds criterion 3's job — open a partner, read its restrictions,
 * log an interaction and create the next task — and criterion 9's job — place an image in an Update draft and open its
 * preview — because it is the identity whose edition already carries a release and a share image, so the placement this
 * job adds and the preview it opens are compared against content that exists rather than against an empty edition. The
 * same identity carries the
 * armed failures: one `conflict` on `saveContactEdits`, one `conflict` on `saveDraft` and one lost acknowledgement on
 * `logInteraction`, each armed, disarmed and recovered inside the test that arms it, so no test inherits a failure plan
 * it did not set.
 *
 * **How the keyboard requirement is met, and the two places a browser owns the control.** Every action this file takes
 * is taken without a pointer: a control is focused and then operated by `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`
 * or typed characters, and a sweep of `Tab` presses proves each surface's controls are reachable, visible and not
 * covered by the sticky shell (WCAG 2.4.11). Three interactions are the platform's own and are therefore addressed
 * programmatically, which is stated here rather than left to be discovered: a native `<select>`'s option list and the
 * browser's date editor are owned by the browser, so their value is set the way a browser sets it, while the tab sweep
 * still proves both are reachable and operable from the keyboard; and a file chooser cannot be operated from a script
 * at all, so the picker's input is handed its file. Nothing else in this file clicks, taps or drags.
 *
 * **What the reflow pass measures.** `documentElement.scrollWidth` against `clientWidth` on every route visited: the
 * page itself never scrolls horizontally at 320 CSS px, and the one exception the specification permits — a table's
 * own labelled scroll region — is proven to be the only horizontal scroll port by measuring every ancestor of it too.
 * The partner-by-month matrix is read at that width as well, where it must switch to its period-first, labelled
 * presentation instead of asking a reader to drag a wide table sideways.
 *
 * **What the audit reports.** The five surfaces are audited with the WCAG 2.2 AA tag set the runner states, serious
 * and critical violations fail the test, and every moderate or minor finding is attached to the report with its rule,
 * its impact and the nodes it broke on, so a finding is either fixed or recorded rather than silently dropped. No rule
 * is disabled, no page is audited twice in place of another, and the count of audited surfaces is asserted so a
 * surface that quietly stopped running cannot pass.
 */
import { fileURLToPath } from "node:url";

// The runner is imported for its `test` and `expect`, not the bare framework: its `test` carries the seeded persona and
// the automatic reset every journey below starts from, and `blockingAccessibilityViolations` is the one rule that
// decides what a failed audit is — so this file states the WCAG 2.2 AA tag set once and reuses that judgement rather
// than keeping a second copy of it. The types come from `@playwright/test`, which is what the runner is built on.
import { AxeBuilder } from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";

import { SEEDED_PERSONAS, SESSION_COOKIE, blockingAccessibilityViolations, expect, resetSeed, test, type AccessibilityAudit, type AccessibilityViolation, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded world this file acts in
// ---------------------------------------------------------------------------------------------

/** The identity whose workspace begins almost empty, so criterion 2's jobs are read where the narrowest layout is at its plainest. */
const NEW_WORKER: PersonaName = "new-worker";

/** The identity that holds criterion 3's partner, criterion 9's Update edition and the permitted-field edit this file refuses. */
const ESTABLISHED_WORKER: PersonaName = "established-worker";

/**
 * The session the development controls are operated as.
 *
 * One reset lays every seeded session down and the control answers whichever admitted membership carries it, so the
 * established worker is the identity the failure plan is armed and disarmed as, exactly as the runner resets the seed.
 */
const CONTROL_SESSION = SEEDED_PERSONAS[ESTABLISHED_WORKER].sessionId;

/** The seeded partner this file opens: identity and history enough to be worth reading at 320 CSS px. */
const SEEDED_PARTNER_ID = "partner-jo-mbeki";

const SEEDED_PARTNER_NAME = "Jo Mbeki";

/** The private contact the new worker creates: a name and nothing else, which is the whole record a private contact needs. */
const NEW_CONTACT_NAME = "Ruth Okafor (met at the school gate)";

/** The one-off task the new worker adds, and the follow-up work criterion 3 creates after an interaction. */
const NEW_WORKER_TASK_TITLE = "Phone the venue about Saturday";
const FOLLOW_UP_TASK_TITLE = "Send Jo the visit notes";

/** What the interaction records: something that actually happened, on a day it happened, and how the contact took part. */
const INTERACTION_OUTCOME = "Agreed to meet after the service next week";
const INTERACTION_DATE = "2026-11-18";
const INTERACTION_ROLE = "Spoke on the phone with me";

/** The two text values this file types into the permitted-field edit, and the one it leaves empty to be refused. */
const EDITED_DISPLAY_NAME = "Jo Mbeki (Harbour)";
const EDITED_GIVEN_NAME = "Josephine";
const CLEARED_DISPLAY_NAME = "";

/** The Update edition the editor, the media picker and the preview all serve for the established worker. */
const SEEDED_UPDATE_ID = "doc-update-autumn";
const SEEDED_VARIANT_ID = "variant-update-autumn-en-public";

/** The committed fixture the picker is handed: a real JPEG whose own filename and EXIF must never reach the output. */
const IMAGE_FIXTURE_PATH = fileURLToPath(new URL("../public/fixtures/media/IMG_20260814-harbour-youth-group.jpg", import.meta.url));

/** The alternative text every placement needs, because an image with no text alternative is a state this application refuses. */
const IMAGE_ALT_TEXT = "Six young people around a table in the church hall";

/** The paragraph this file types into the one prose editor, in the edition's own direction. */
const TYPED_PROSE = "We met on Friday and shared a meal together.";

// ---------------------------------------------------------------------------------------------
// The routes, the labels and the fixed values the assertions are made against
// ---------------------------------------------------------------------------------------------

const ROUTES = {
  partners: "/partners",
  work: "/work",
  matrixReport: "/support/reports/matrix",
  editor: `/communication/${SEEDED_UPDATE_ID}/${SEEDED_VARIANT_ID}`,
  partnerRecord: `/partners/${SEEDED_PARTNER_ID}`,
  partnerEdit: `/partners/${SEEDED_PARTNER_ID}/edit`,
  interactionForm: `/partners/${SEEDED_PARTNER_ID}/interactions/new`,
} as const;

/** The two viewports the criterion names: the narrowest retained width, and the desktop width the zoom pass is taken at. */
const NARROW_VIEWPORT = { width: 320, height: 800 } as const;
const ZOOM_VIEWPORT = { width: 1280, height: 800 } as const;

/** The zoom factor the browser-zoom pass emulates, applied to the root element so the whole layout reflows at half the width. */
const ZOOM_FACTOR = 2;

/** The label the shell renders on every surface, so no screen of this application can be mistaken for production. */
const DEVELOPMENT_DATA_LABEL = "Development data";

/** The 24×24 CSS px floor of WCAG 2.2 Target Size Minimum (2.5.8), and the diameter its spacing exception is measured in. */
const TARGET_FLOOR_PX = 24;
const TARGET_SPACING_PX = 24;

/**
 * The smallest box that counts as a control a person can target.
 *
 * The design system renders a one-pixel proxy input behind several styled controls (the native input behind a
 * checkbox, a combobox or a switch). The proxy is not the target: the styled control beside it is, and it is measured
 * in the same scope, so a box this small is excluded rather than reported as an undersized target.
 */
const PROXY_CONTROL_BOX_PX = 4;

/**
 * The ceiling a suppressed transition may take.
 *
 * The stylesheet collapses motion to 0.01 ms rather than removing it, so a state change still completes — it simply
 * completes at once. The ceiling is stated generously above that value so a browser reporting it as `1e-05s`,
 * `0.01ms` or `0s` all pass, and anything a reader would perceive as motion fails.
 */
const MOTION_CEILING_SECONDS = 0.05;

/** How many `Tab` presses a sweep takes before it gives up, so a surface that traps focus is reported rather than hung on. */
const TAB_SWEEP_STEPS = 40;

/** How many frames a settle waits at most, so a control that never stops moving is reported rather than waited on forever. */
const SETTLE_ATTEMPT_LIMIT = 12;

/** How many settled readings a focus check takes before it reports the control as obscured. */
const FOCUS_READ_ATTEMPTS = 3;

/** The shorter sweep the zoomed layout takes: the expanded navigation is ahead of the surface, so a smaller window of stops is read there. */
const ZOOM_TAB_SWEEP_STEPS = 20;

/** The text the zoomed roster is searched with, so the list is proved operable rather than merely reachable at that zoom. */
const ROSTER_SEARCH_TEXT = "mbeki";

/** The axe-core tag set the audit runs: WCAG 2.2 level AA, with the level A and 2.1 rules it builds on. */
const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/** How many offending nodes one attached finding names, so the report is readable rather than exhaustive. */
const ATTACHED_NODE_LIMIT = 5;

/** The development control's own address (AAP 0.6.3): the one named control a failure is armed and disarmed through. */
const DEV_CONTROL_URL = "/api/dev";

const SET_FAILURE_PLAN_ACTION = "setFailurePlan";

/** The two named calls whose refusal this file proves, and the one whose acknowledgement is lost: the permitted-field edit, the editor's own draft save, and the interaction. */
const CONTACT_EDIT_MUTATION = "saveContactEdits";
const DRAFT_SAVE_MUTATION = "saveDraft";
const LOST_ACKNOWLEDGEMENT_MUTATION = "logInteraction";

/** How much of a response body an error quotes, so a failure is readable without pasting a whole envelope. */
const DETAIL_LIMIT = 400;

// ---------------------------------------------------------------------------------------------
// Reading a surface the way an assistive-technology user meets it
// ---------------------------------------------------------------------------------------------

/** The persistent label this application states on every surface, asserted wherever a surface is read. */
async function expectDevelopmentData(page: Page, surface: string): Promise<void> {
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first(), `${surface} states the persistent Development data label, so no screen of this application can be mistaken for production.`).toBeVisible();
}

/** What one look at the focused element answers: whether a keyboard user can see it and reach it, and what it is called. */
interface FocusReading {
  readonly ok: boolean;
  readonly name: string;
  readonly reason: string;
}

/**
 * Reads the element that currently holds focus.
 *
 * The element is looked at the way WCAG 2.4.11 requires: it must have a rendered box, sit inside the viewport, and a
 * point inside it must reach it rather than anything layered over it. A sticky shell banner, a sticky table header or
 * an open overlay that covered the focused control would answer with the element that stands over it, so the reading
 * names the blocker instead of claiming the control was fine. Its name is resolved the way an accessible name is —
 * `aria-label`, then `aria-labelledby`, then the `<label>` bound to it, then its own text — so a control labelled by an
 * associated label is reported by the words a screen reader would say.
 */
async function readFocus(page: Page): Promise<FocusReading> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) {
      return { ok: false, name: "", reason: "no control holds focus" };
    }
    const labelledBy = active.getAttribute("aria-labelledby");
    const labelledByText = labelledBy === null ? "" : (document.getElementById(labelledBy)?.textContent ?? "");
    const boundLabel = active.id === "" ? "" : (document.querySelector(`label[for="${CSS.escape(active.id)}"]`)?.textContent ?? "");
    const stated = active.getAttribute("aria-label") ?? (labelledByText.trim() === "" ? "" : labelledByText);
    const own = active.textContent ?? "";
    const name = (stated.trim() === "" ? boundLabel.trim() || own.replace(/\s+/gu, " ").trim() : stated.trim()) || active.getAttribute("placeholder") || "";
    const shortened = name.length > 80 ? `${name.slice(0, 80)}…` : name;
    const tag = active.tagName.toLowerCase();
    const rect = active.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { ok: false, name: shortened, reason: `${tag} has no rendered box` };
    }
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      return { ok: false, name: shortened, reason: `${tag} sits outside the viewport` };
    }
    // A grid of five points inside the element: at least one of them must reach the element itself, so a control that is
    // partly overlapped is still reported as reachable while one that is covered is not.
    const samples: readonly (readonly [number, number])[] = [
      [0.5, 0.5],
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
    ];
    const reachable = samples.some(([across, down]) => {
      const x = Math.min(Math.max(rect.left + rect.width * across, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height * down, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === active || active.contains(hit) || hit.contains(active));
    });
    if (!reachable) {
      const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      const blocker = hit === null ? "nothing" : `${hit.tagName.toLowerCase()}${hit.id === "" ? "" : `#${hit.id}`}`;
      return { ok: false, name: shortened, reason: `${tag} is covered by ${blocker}` };
    }
    return { ok: true, name: shortened, reason: "" };
  });
}

/** Asserts the focused control is visible and not covered, naming the step that left focus where it is. */
async function expectFocusVisibleAndUnobscured(page: Page, step: string): Promise<FocusReading> {
  let reading = await readFocus(page);
  for (let attempt = 2; attempt <= FOCUS_READ_ATTEMPTS && !reading.ok; attempt += 1) {
    // A focus change and the style it brings are applied asynchronously, so a control that is still arriving is not yet a
    // control a reader cannot see. The reading is taken again once the layout has settled, a bounded number of times, and
    // a control that stays covered fails on the last of them.
    await settleLayout(page);
    reading = await readFocus(page);
  }
  expect(reading.ok, `${step}: the focused control must be visible and unobscured (WCAG 2.4.11), and ${reading.name === "" ? "no control" : JSON.stringify(reading.name)} was ${reading.reason}.`).toBe(true);
  return reading;
}

/**
 * Asserts every scroll container carries the offset that keeps a focused control clear of the sticky shell.
 *
 * The declaration lives once in the token stylesheet and reaches every element, so a container that lost it would be
 * the one place a focused cell could end up behind the banner; the scroll ports this file reads are checked for it.
 */
async function expectScrollPaddingSet(page: Page, surface: string): Promise<void> {
  const paddings = await page.evaluate(() => {
    const ports = [document.documentElement, document.getElementById("main-content")].filter((element): element is HTMLElement => element instanceof HTMLElement);
    return ports.map((element) => window.getComputedStyle(element).scrollPaddingBlockStart);
  });
  expect(paddings.length, `${surface} states the scroll ports whose padding is read.`).toBeGreaterThan(0);
  for (const padding of paddings) {
    expect(Number.parseFloat(padding), `${surface}: every scroll port states a scroll-padding-block-start (${JSON.stringify(padding)}), so a focused control is scrolled clear of the sticky shell rather than under it.`).toBeGreaterThan(0);
  }
}

/**
 * Waits for the layout to settle after a state change, so a reading describes the page a person actually sees.
 *
 * The wait is on the focused control's own geometry rather than on a duration: after two frames, which is where a focus
 * change and the style it brings are applied, the loop stops as soon as that control's box has been the same for two
 * consecutive frames. A transition that is still moving the control is therefore waited out, and a surface with an
 * unrelated animation elsewhere does not hold the reading up.
 */
async function settleLayout(page: Page): Promise<void> {
  // The frame limit travels as an argument rather than as a closure over a module constant: this function is serialised
  // and run inside the page, where the module's own bindings do not exist and a closure over them would throw.
  await page.evaluate(
    (limit: number) =>
      new Promise<void>((resolve) => {
        let previous = "";
        let stableFrames = 0;
        const step = (attempt: number): void => {
          const active = document.activeElement;
          const box = active instanceof Element ? active.getBoundingClientRect() : null;
          const signature = box === null ? "" : `${box.x.toFixed(1)},${box.y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}`;
          stableFrames = signature !== "" && signature === previous ? stableFrames + 1 : 0;
          previous = signature;
          if (stableFrames >= 2 || attempt >= limit) {
            resolve();
            return;
          }
          requestAnimationFrame(() => {
            step(attempt + 1);
          });
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            step(0);
          });
        });
      }),
    SETTLE_ATTEMPT_LIMIT,
  );
}

/** Focuses a control without a pointer, proves the focus landed, and then operates it from the keyboard alone. */
async function pressFromKeyboard(page: Page, control: Locator, step: string, key: "Enter" | " " = "Enter"): Promise<void> {
  // A keyboard user reaches a control by tabbing to it, and the browser scrolls it into view on the way. That scroll is
  // what this asks for, so the control is checked where a keyboard user would meet it, not where it happened to be.
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect(control, `${step}: the control takes focus, so the keyboard is enough to reach it.`).toBeFocused();
  await settleLayout(page);
  await expectFocusVisibleAndUnobscured(page, step);
  await page.keyboard.press(key);
}

/** Focuses a text control and types into it a character at a time, replacing whatever it held. */
async function typeFromKeyboard(page: Page, control: Locator, text: string, step: string): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect(control, `${step}: the field takes focus, so the keyboard is enough to fill it.`).toBeFocused();
  await settleLayout(page);
  await expectFocusVisibleAndUnobscured(page, step);
  await page.keyboard.press("ControlOrMeta+a");
  if (text === "") {
    await page.keyboard.press("Delete");
    return;
  }
  await page.keyboard.type(text);
  await expect(control, `${step}: the field holds the characters the keyboard typed.`).toHaveValue(text);
}

/**
 * Walks the tab order of the surface on screen, proving each stop is visible and unobscured.
 *
 * This is the half of the keyboard requirement a filled-in form cannot prove on its own: `Tab` reaches the controls,
 * focus moves in reading order, nothing covers what it reaches, and `Shift+Tab` returns along the same path. The names
 * of the stops are collected so an assertion can state that the sweep met the controls it was meant to meet.
 */
async function sweepTabOrder(page: Page, surface: string, steps: number): Promise<readonly string[]> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  const names: string[] = [];
  for (let step = 1; step <= steps; step += 1) {
    await page.keyboard.press("Tab");
    await settleLayout(page);
    const reading = await expectFocusVisibleAndUnobscured(page, `${surface}: Tab stop ${String(step)}`);
    names.push(reading.name);
  }
  // One `Shift+Tab` proves the path runs backwards too, and lands on a control the forward sweep already met.
  await page.keyboard.press("Shift+Tab");
  await settleLayout(page);
  await expectFocusVisibleAndUnobscured(page, `${surface}: Shift+Tab returns along the same path`);
  return names;
}

/**
 * Asserts focus is still inside the open dialog's own layer.
 *
 * The dialog is portalled, so its layer is the element it is rendered into: a focus guard inside that layer is the
 * mechanism that keeps focus in, and reaching one is not the same as reaching a control behind the overlay. What the
 * assertion rules out is focus escaping to the surface the dialog was opened over.
 */
async function expectFocusInsideDialog(picker: Locator, step: string): Promise<void> {
  const inside = await picker.evaluate((dialog: Element) => {
    const active = document.activeElement;
    const layer = dialog.parentElement?.closest("[data-slot$='-portal']") ?? dialog;
    return active !== null && (layer === active || layer.contains(active));
  });
  expect(inside, step).toBe(true);
}

// ---------------------------------------------------------------------------------------------
// Reflow: the page never scrolls sideways, and a table's own region is the only port that may
// ---------------------------------------------------------------------------------------------
/** What the document's own scroller states: the content it holds, the width it shows, and the viewport it is in. */
interface ReflowReading {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly viewportWidth: number;
}

async function readReflow(page: Page): Promise<ReflowReading> {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, viewportWidth: window.innerWidth }));
}

/** Asserts the page itself does not scroll horizontally, which is the reflow obligation at 320 CSS px and at 200 % zoom. */
async function expectNoHorizontalPageScroll(page: Page, surface: string): Promise<void> {
  const reading = await readReflow(page);
  expect(
    reading.scrollWidth,
    `${surface} must not scroll horizontally (WCAG 1.4.10 Reflow): the document holds ${String(reading.scrollWidth)} CSS px of content in a ${String(reading.clientWidth)} px viewport (${String(reading.viewportWidth)} px of window), so ${String(reading.scrollWidth - reading.clientWidth)} px would have to be reached by scrolling sideways.`,
  ).toBeLessThanOrEqual(reading.clientWidth + 1);
}

/** One element between the page and a scroll region: what it is, and how much of it overflows sideways. */
interface AncestorOverflow {
  readonly element: string;
  readonly overflowX: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/**
 * Asserts one named table region is the only horizontal scroll port on the surface.
 *
 * The region must be a labelled, focusable `region` whose own overflow is horizontal, and every element between it and
 * the document must fit what it shows — including the document itself, which the reflow assertion has already read. A
 * second scroller anywhere on that path is what makes a page drag sideways, so it is a failure here rather than a note.
 */
async function expectSoleHorizontalScroller(page: Page, region: Locator, surface: string): Promise<void> {
  await expect(region, `${surface} renders its table inside the one scroll region.`).toHaveAttribute("tabindex", "0");
  await expect(region, `${surface} names the scroll region it renders, so it is a labelled landmark.`).toHaveAttribute("aria-label", /, scrollable$/u);
  const measured = await region.evaluate((element: Element) => {
    const style = window.getComputedStyle(element);
    const ancestors: AncestorOverflow[] = [];
    let current = element.parentElement;
    while (current !== null) {
      const ancestorStyle = window.getComputedStyle(current);
      ancestors.push({ element: current.tagName.toLowerCase(), overflowX: ancestorStyle.overflowX, scrollWidth: current.scrollWidth, clientWidth: current.clientWidth });
      current = current.parentElement;
    }
    return { overflowX: style.overflowX, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, ancestors };
  });
  expect(measured.overflowX, `${surface}: the scroll region is the element that owns the horizontal gesture.`).toMatch(/^(?:auto|scroll)$/u);
  for (const ancestor of measured.ancestors) {
    expect(ancestor.scrollWidth, `${surface}: no ancestor outside the table's own region may scroll horizontally, and ${ancestor.element} (overflow-x: ${ancestor.overflowX}) holds ${String(ancestor.scrollWidth)} px of content in ${String(ancestor.clientWidth)} px.`).toBeLessThanOrEqual(ancestor.clientWidth + 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Target size (2.5.8) and motion (2.3.3 / reduced motion): the two floors a control can miss
// ---------------------------------------------------------------------------------------------

/** One control that rendered below the 24×24 CSS px floor, with whether its spacing saves it. */
interface UndersizedTarget {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly spaced: boolean;
}

/**
 * Measures every control inside one named scope against the 24×24 CSS px floor.
 *
 * A control smaller than the floor passes only by the spacing exception: a 24 px diameter circle centred on its box
 * must not intersect the circle for any other control, which is measured here as a centre-to-centre distance of at
 * least 24 px to every other control in the same scope. A control with no rendered box is not a target: a hidden
 * panel's buttons, an element the narrow layout removes, and the one-pixel proxy input a component renders behind the
 * styled control that carries the interaction are all excluded by their box, and the control a person actually points
 * at is measured in the same scope. Nothing is exempted for its role.
 */
async function measureUndersizedTargets(scope: Locator, floor: number): Promise<readonly UndersizedTarget[]> {
  return scope.evaluate(
    (root: Element, limits: { readonly floor: number; readonly minimumBox: number }) => {
      const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="checkbox"], [role="radio"], [role="tab"], [role="switch"], [tabindex="0"]';
      const boxes = Array.from(root.querySelectorAll(selector))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const stated = element.getAttribute("aria-label") ?? element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
          const label = stated.length > 60 ? `${stated.slice(0, 60)}…` : stated === "" ? element.tagName.toLowerCase() : stated;
          return { rect, label, measurable: style.visibility !== "hidden" && style.display !== "none" && rect.width >= limits.minimumBox && rect.height >= limits.minimumBox };
        })
        .filter((entry) => entry.measurable);
      const centre = (rect: DOMRect): { readonly x: number; readonly y: number } => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      const undersized: UndersizedTarget[] = [];
      for (const entry of boxes) {
        if (entry.rect.width >= limits.floor && entry.rect.height >= limits.floor) {
          continue;
        }
        const own = centre(entry.rect);
        const spaced = boxes.every((other) => {
          if (other.rect === entry.rect) {
            return true;
          }
          const theirs = centre(other.rect);
          return Math.hypot(theirs.x - own.x, theirs.y - own.y) >= limits.floor - 0.5;
        });
        undersized.push({ label: entry.label, width: Math.round(entry.rect.width * 10) / 10, height: Math.round(entry.rect.height * 10) / 10, spaced });
      }
      return undersized;
    },
    { floor, minimumBox: PROXY_CONTROL_BOX_PX },
  );
}

/** Asserts no control in the scope is below the target floor without the spacing exception, and reports the ones the exception saves. */
async function expectTargetSizeFloor(page: Page, scope: Locator, surface: string, testInfo: TestInfo): Promise<void> {
  const undersized = await measureUndersizedTargets(scope, TARGET_FLOOR_PX);
  const failing = undersized.filter((target) => !target.spaced);
  const saved = undersized.filter((target) => target.spaced);
  if (saved.length > 0) {
    // Reported rather than loosened: a control under the floor relied on the spacing exception, and the shape of that
    // reliance belongs in the report so a later change to the layout re-measures it instead of quietly widening it.
    await testInfo.attach(`${surface} — controls under 24 px saved by spacing`, { body: JSON.stringify({ surface, floor: TARGET_FLOOR_PX, spacing: TARGET_SPACING_PX, saved }, null, 2), contentType: "application/json" });
  }
  expect(
    failing.map((target) => `${target.label} (${String(target.width)}×${String(target.height)} px)`),
    `${surface}: every control is at least ${String(TARGET_FLOOR_PX)}×${String(TARGET_FLOOR_PX)} CSS px or satisfies the spacing exception (WCAG 2.5.8)${saved.length === 0 ? "" : `, and ${String(saved.length)} control(s) below the floor relied on the spacing exception`}.`,
  ).toEqual([]);
}

/** The slowest motion one scope's controls declare, in seconds, with the control that declares it. */
interface MotionReading {
  readonly slowestSeconds: number;
  readonly control: string;
}

/**
 * Reads the longest transition and animation a scope's controls declare.
 *
 * Under `prefers-reduced-motion: reduce` the stylesheet collapses both durations to 0.01 ms, so a reading above a
 * perceptible length means a control is animating past the reader's stated preference. The value is read from the
 * computed style rather than from the class list, because that is what the browser actually runs.
 */
async function readLongestMotion(scope: Locator): Promise<MotionReading> {
  return scope.evaluate((root: Element) => {
    const secondsOf = (value: string): number => {
      let longest = 0;
      for (const part of value.split(",")) {
        const text = part.trim();
        const parsed = Number.parseFloat(text);
        if (!Number.isFinite(parsed)) {
          continue;
        }
        longest = Math.max(longest, text.endsWith("ms") ? parsed / 1000 : parsed);
      }
      return longest;
    };
    let slowest = 0;
    let control = "";
    const controls = Array.from(root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')).slice(0, 60);
    for (const element of controls) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const style = window.getComputedStyle(element);
      const duration = Math.max(secondsOf(style.transitionDuration), secondsOf(style.animationDuration));
      if (duration > slowest) {
        slowest = duration;
        const stated = element.getAttribute("aria-label") ?? element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
        control = stated.length > 60 ? `${stated.slice(0, 60)}…` : stated === "" ? element.tagName.toLowerCase() : stated;
      }
    }
    return { slowestSeconds: slowest, control };
  });
}

// ---------------------------------------------------------------------------------------------
// The WCAG 2.2 AA audit
// ---------------------------------------------------------------------------------------------

/** One audited surface, so the report names what was read and the test can assert all five ran. */
const auditedSurfaces: string[] = [];

/** The readable account one attached finding carries: the rule, its impact, the nodes and the help it points at. */
function violationSummary(violations: readonly AccessibilityViolation[]): string {
  return JSON.stringify(
    violations.map((violation) => ({ id: violation.id, impact: violation.impact ?? "unstated", help: violation.help, helpUrl: violation.helpUrl, nodes: violation.nodes.slice(0, ATTACHED_NODE_LIMIT).map((node) => ({ target: node.target, summary: node.failureSummary })), nodeCount: violation.nodes.length })),
    null,
    2,
  );
}

/**
 * Audits one surface against WCAG 2.2 AA as the runner states the tag set, fails on anything serious or critical, and
 * attaches everything it found.
 *
 * The audit is of the surface as the test has driven it into being — a form that has been filled, a dialog that is open
 * — rather than of a page loaded and left alone. Nothing is excluded and no rule is disabled: a rule that produced a
 * finding is fixed or, where a limitation is genuine, recorded in the report with its impact.
 */
async function auditSurface(page: Page, testInfo: TestInfo, surface: string): Promise<void> {
  const audit: AccessibilityAudit = await new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]).analyze();
  const url = page.url();
  const blocking = blockingAccessibilityViolations(audit);
  await testInfo.attach(`axe — ${surface}`, { body: JSON.stringify({ surface, url, tags: [...WCAG_22_AA_TAGS], blocking: violationSummary(blocking), all: violationSummary(audit.violations), passes: audit.passes.length }, null, 2), contentType: "application/json" });
  expect(
    blocking.map((violation) => `${violation.id} (${violation.impact ?? "unstated"}) at ${String(violation.nodes.length)} node(s) — ${violation.help}`),
    `${surface} (${url}) must hold no serious or critical WCAG 2.2 AA violation. Findings of any impact were attached to this report.`,
  ).toEqual([]);
  auditedSurfaces.push(surface);
  // The audit's outcome is recorded on the test as well as attached, so the report states which surface was read, how many
  // rules passed and what was found at any impact — a run that audited nothing cannot be mistaken for a clean one.
  testInfo.annotations.push({ type: `axe ${surface}`, description: `${url} — ${String(blocking.length)} serious or critical violation(s), ${String(audit.violations.length)} finding(s) at any impact across ${String(audit.passes.length)} passing rule(s).` });
}

// ---------------------------------------------------------------------------------------------
// The development control: the one failure plan this file arms and disarms
// ---------------------------------------------------------------------------------------------

/** What a development read states: the authority it ran under, and the revision the control must present. */
interface DevState {
  readonly scope: Readonly<Record<string, string>>;
  readonly revision: string;
}

/** One plan the control accepts: a mode, and the named call the mode is demonstrated on. */
interface FailurePlanRequestBody {
  readonly mode: "conflict" | "unknown" | "denied";
  readonly target: { readonly kind: "read" | "mutation"; readonly name: string };
}

/** The one identity header every control request carries: the session the service authorises. */
function authorisedAs(sessionId: string): Readonly<Record<string, string>> {
  return { cookie: `${SESSION_COOKIE}=${sessionId}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a response body, answering `undefined` for anything that is not JSON rather than throwing on the way to a message. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The outcome a mutation answered with, or `undefined` for a body that carries none. */
function outcomeOf(text: string): string | undefined {
  const body = parseJson(text);
  return isRecord(body) && typeof body.outcome === "string" ? body.outcome : undefined;
}

function detailOf(text: string): string {
  const collapsed = text.trim().replace(/\s+/gu, " ");
  return collapsed.length > DETAIL_LIMIT ? `${collapsed.slice(0, DETAIL_LIMIT)}…` : collapsed;
}

/** Reads the development state the control is about to be operated against. */
async function readDevState(request: APIRequestContext): Promise<DevState> {
  const response = await request.get(DEV_CONTROL_URL, { headers: authorisedAs(CONTROL_SESSION) });
  const text = await response.text();
  const body = parseJson(text);
  if (!response.ok() || !isRecord(body) || !isRecord(body.scope) || typeof body.revision !== "string") {
    throw new Error(`The development state could not be read as the ${SEEDED_PERSONAS[ESTABLISHED_WORKER].label} persona from ${DEV_CONTROL_URL}: HTTP ${String(response.status())} — ${detailOf(text)}. A failure this file cannot arm is not a recovery it can prove.`);
  }
  const scope: Record<string, string> = {};
  for (const [name, value] of Object.entries(body.scope)) {
    if (typeof value === "string") {
      scope[name] = value;
    }
  }
  return { scope, revision: body.revision };
}

/**
 * Arms one failure on one named call, or disarms the armed plan with `null`.
 *
 * The request is the same four-member mutation the Settings reset and the development panel send, so the failure a test
 * proves is the one a person can arm from the panel — not a stub installed behind the application's back.
 */
async function setFailurePlan(request: APIRequestContext, plan: FailurePlanRequestBody | null): Promise<void> {
  const state = await readDevState(request);
  const response = await request.post(DEV_CONTROL_URL, { headers: authorisedAs(CONTROL_SESSION), data: { action: SET_FAILURE_PLAN_ACTION, operationId: crypto.randomUUID(), scope: state.scope, expectedRevision: state.revision, payload: plan === null ? { plan: null } : plan } });
  const text = await response.text();
  const outcome = outcomeOf(text);
  if (!response.ok() || outcome !== "accepted") {
    throw new Error(`Arming ${plan === null ? "nothing (disarm)" : `${plan.mode} on ${plan.target.name}`} was refused: HTTP ${String(response.status())} ${outcome ?? "no readable outcome"} — ${detailOf(text)}.`);
  }
}

/** Arms the armed-conflict failure the two refused saves are proven against. */
async function armConflictOn(request: APIRequestContext, mutationName: string): Promise<void> {
  await setFailurePlan(request, { mode: "conflict", target: { kind: "mutation", name: mutationName } });
}

/** Disarms whatever plan is armed, so the retry a test proves runs against the application's own behaviour. */
async function disarmFailurePlan(request: APIRequestContext): Promise<void> {
  await setFailurePlan(request, null);
}

// ---------------------------------------------------------------------------------------------
// The narrow layout: 320 CSS pixels, keyboard only, motion suppressed
// ---------------------------------------------------------------------------------------------

/**
 * Every test starts from the deterministic seed.
 *
 * The runner has already admitted this file's persona and restored the seed before the body runs; the call below states
 * that requirement where this file is read, and lays the identical documents down again through the same control the
 * Settings reset submits, so a criterion that starts "from a freshly reset seed" starts from it here too.
 */
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

test.describe("at 320 CSS pixels, with motion suppressed", () => {
  test.use({ viewport: NARROW_VIEWPORT });

  test("the shell and the roster meet the target-size floor, and no control animates past the reader's preference", async ({ page }, testInfo) => {
    await page.goto(ROUTES.partners);
    await expect(page.getByRole("heading", { name: "Partners", level: 1 }), "The narrow layout reaches the roster through the shell's own navigation.").toBeVisible();
    await expectDevelopmentData(page, "The partner roster");

    // The runner states reduced motion for the whole project, so a run in which the preference had not reached the
    // page would be a run whose later motion reading means nothing.
    const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(reduced, "The run states `prefers-reduced-motion: reduce`, so the motion assertions below are made under the preference a reader would set.").toBe(true);

    // The slowest transition any control on the surface declares, read from the computed style rather than the class
    // list: motion collapses to 0.01 ms, so a perceptible duration means a control ignoring the preference.
    const motion = await readLongestMotion(page.locator("body"));
    expect(motion.slowestSeconds, `No control animates for longer than ${String(MOTION_CEILING_SECONDS)} s with motion suppressed, and the slowest was ${String(motion.slowestSeconds)} s on ${JSON.stringify(motion.control)}.`).toBeLessThanOrEqual(MOTION_CEILING_SECONDS);

    // The target floor, measured on the three families of control the narrow layout is built from.
    await expectTargetSizeFloor(page, page.locator('[data-slot="query-toolbar"]'), "The roster toolbar and its facet toggles", testInfo);
    const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
    await expect(roster, "The roster renders the one table pattern, named so it can be found as a landmark.").toBeVisible();
    await expectTargetSizeFloor(page, roster, "The roster's row controls", testInfo);

    // Ordering is a control rather than a gesture: each sortable column offers its ordering as a button with its own
    // name, and nothing on the surface is draggable, so no retained job here depends on dragging (WCAG 2.5.7).
    const sortButtons = roster.getByRole("columnheader").getByRole("button");
    const sortCount = await sortButtons.count();
    expect(sortCount, "Each sortable column offers its ordering as a button, so sorting never depends on a gesture.").toBeGreaterThan(0);
    for (let index = 0; index < sortCount; index += 1) {
      const sortButton = sortButtons.nth(index);
      const name = ((await sortButton.getAttribute("aria-label")) ?? (await sortButton.innerText())).replace(/\s+/gu, " ").trim();
      expect(name.length, `Every ordering control states what it orders, and control ${String(index + 1)} of ${String(sortCount)} stated no name.`).toBeGreaterThan(0);
    }
    await expect(roster.locator('[draggable="true"]'), "Nothing on the roster is draggable, so reordering and resizing are never a drag-only path.").toHaveCount(0);

    // One table region, one horizontal port: the page itself never scrolls sideways at this width.
    await expectNoHorizontalPageScroll(page, "The partner roster at 320 CSS px");
    await expectSoleHorizontalScroller(page, roster, "The partner roster at 320 CSS px");
    await expectScrollPaddingSet(page, "The partner roster at 320 CSS px");
    await expectDevelopmentData(page, "The partner roster");
  });

  test.describe("the new worker's first session", () => {
    // The identity criterion 2 names: a workspace with no gifts, goal, subscription or integration, so the two jobs
    // below are the first things this worker does rather than edits of seeded work.
    test.use({ persona: NEW_WORKER });

    test("the first session's two jobs complete with the keyboard alone: a private contact from a name, and a one-off task", async ({ page }, testInfo) => {
      // -----------------------------------------------------------------------------------------
      // Criterion 2, first job: a private contact that needs only a name
      // -----------------------------------------------------------------------------------------
      await page.goto(ROUTES.partners);
      await expect(page.getByRole("heading", { name: "Partners", level: 1 })).toBeVisible();
      const preparation = page.locator('[data-slot="private-preparation-form"]');
      await expect(preparation.getByRole("heading", { name: "Add a private contact", level: 2 }), "The private-contact form is mounted once, below the roster, with its own heading.").toBeVisible();

      // The narrow layout must not need a desktop drawer to reach the job: the form is on the page, in reading order.
      await expectNoHorizontalPageScroll(page, "The private-contact form at 320 CSS px");
      await typeFromKeyboard(page, preparation.getByRole("textbox", { name: /^Name/u }), NEW_CONTACT_NAME, "The private contact's name");
      await pressFromKeyboard(page, preparation.getByRole("button", { name: "Add a private contact" }), "Submitting the private contact");
      const created = preparation.locator('[data-slot="private-preparation-outcome"]');
      await expect(created, "The accepted result is stated in the form that submitted it, not in a toast that disappears.").toHaveAttribute("data-outcome", "accepted");
      await expect(created.getByText("Created: one private preparation record", { exact: false }), "The receipt states what was created: one private preparation record, and nothing beside it.").toBeVisible();
      await expect(created.getByRole("link", { name: "Open the private contact" }), "The receipt names where the record it created now lives, so the contact is findable from the result itself.").toBeVisible();
      await expectNoHorizontalPageScroll(page, "The private-contact form's result at 320 CSS px");

      // -----------------------------------------------------------------------------------------
      // Criterion 2, second job: a one-off task, created from the Work surface
      // -----------------------------------------------------------------------------------------
      await page.goto(ROUTES.work);
      await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
      await expectDevelopmentData(page, "The Work surface");
      await pressFromKeyboard(page, page.getByRole("button", { name: "New task" }).first(), "Opening the task composer");
      const composer = page.getByRole("region", { name: "New task" });
      await expect(composer, "Creating a task happens in the one composer that owns the task form.").toBeVisible();
      await typeFromKeyboard(page, composer.getByRole("textbox", { name: /^Title/u }), NEW_WORKER_TASK_TITLE, "The task's title");
      await pressFromKeyboard(page, composer.getByRole("button", { name: "Create task" }), "Creating the task");
      const taskReceipt = composer.locator('[data-slot="operation-result"]');
      await expect(taskReceipt, "Creating a task is accepted, and its receipt stays in the composer that submitted it.").toHaveAttribute("data-outcome", "accepted");
      await pressFromKeyboard(page, composer.getByRole("button", { name: "Done" }), "Dismissing the task composer's receipt");
      await expect(page.locator('[data-slot="task-composer"]'), "Dismissing the receipt closes the composer rather than leaving a second, settled form open.").toHaveCount(0);
      await expectNoHorizontalPageScroll(page, "The Work surface at 320 CSS px");

      // -----------------------------------------------------------------------------------------
      // The tab order, proven where the two jobs started
      // -----------------------------------------------------------------------------------------
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
      // ---------------------------------------------------------------------------------------
      // Criterion 3: find the record, read its restrictions, log what happened, plan the next step
      // ---------------------------------------------------------------------------------------
      await page.goto(ROUTES.partners);
      const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
      await expect(roster, "The roster is the way into a record at this width, and the only horizontal scroll port.").toBeVisible();
      await pressFromKeyboard(page, roster.getByRole("link", { name: `Open ${SEEDED_PARTNER_NAME}` }), "Opening the seeded partner's record");
      await expect(page.getByRole("heading", { name: SEEDED_PARTNER_NAME, level: 1 }), "The record opens as a full page at 320 CSS px, not as a panel a phone cannot show.").toBeVisible();
      await expect(page.getByRole("dialog"), "The record is the page itself at this width: opening it never depends on a panel only a wide screen can show.").toHaveCount(0);
      await expectDevelopmentData(page, "The partner's record");
      await expectNoHorizontalPageScroll(page, "The partner's record at 320 CSS px");

      // The restrictions section is read before anything is recorded: a limit the source recorded is part of what the
      // worker must know before acting, and it is stated on the record rather than in a tooltip.
      const restrictions = page.getByRole("region", { name: "Restrictions" });
      await expect(restrictions, "The record states the restrictions recorded against this relationship.").toBeVisible();
      const recordedRestrictions = await restrictions.locator("li").count();

      await pressFromKeyboard(page, page.getByRole("link", { name: "Log an interaction" }), "Opening the interaction form");
      const form = page.locator('[data-slot="interaction-form"]');
      await expect(form.getByRole("heading", { name: "Log an interaction", level: 2 }), "The interaction is logged in the family's one record form.").toBeVisible();
      await expectNoHorizontalPageScroll(page, "The interaction form at 320 CSS px");

      // The kind of contact is a native list owned by the platform, and the day is a date editor owned by the browser,
      // so both are set the way a browser sets them; the tab sweep at the end reaches both from the keyboard.
      await form.getByRole("combobox", { name: /^Kind of contact/u }).selectOption("call");
      await form.getByRole("textbox", { name: /^The day it happened/u }).fill(INTERACTION_DATE);
      await typeFromKeyboard(page, form.getByRole("textbox", { name: /^How they took part/u }), INTERACTION_ROLE, "How the contact took part");
      await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What came of it/u }), INTERACTION_OUTCOME, "What came of the contact");
      await pressFromKeyboard(page, form.getByRole("radio", { name: /^Create a follow-up task/u }), "Choosing the follow-up task", " ");
      await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What needs doing/u }), FOLLOW_UP_TASK_TITLE, "The follow-up task's title");
      await form.getByRole("textbox", { name: /^Due on/u }).fill(INTERACTION_DATE);
      await pressFromKeyboard(page, form.getByRole("button", { name: "Log the interaction" }), "Submitting the interaction");

      // Two receipts, because the interaction and the task are two changes with two identities: a task that failed
      // could not otherwise be told apart from an interaction that was recorded twice.
      const receipts = form.locator('[data-slot="operation-result"][data-outcome="accepted"]');
      await expect(receipts, "The interaction and the follow-up task are each accepted as their own change.").toHaveCount(2);

      // The next task is open work on the record it was filed against, and the restriction count is untouched.
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
      // ---------------------------------------------------------------------------------------
      // Criterion 9: place an image with the keyboard, then read the exact preview
      // ---------------------------------------------------------------------------------------
      await page.goto(ROUTES.editor);
      await expect(page.getByRole("heading", { name: "Update edition", level: 1 }), "The one editor of one edition is the only way in at this width.").toBeVisible();
      await expectDevelopmentData(page, "The Update editor");
      await expectNoHorizontalPageScroll(page, "The Update editor at 320 CSS px");

      // The narrow layout offers the two panes as pressed buttons, so the media pane is reached without a pointer and
      // without a drag: writing and media are two panes of one editor, not two routes. The text typed in the writing
      // pane stays in it while the other pane is used, which is what makes the two panes one surface rather than two.
      const body = page.getByRole("textbox", { name: "The text of this Update edition" });
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

      // Focus containment: every Tab stays inside the dialog while it is open, so the page behind it is unreachable.
      for (let step = 1; step <= 8; step += 1) {
        await page.keyboard.press("Tab");
        await settleLayout(page);
        await expectFocusInsideDialog(picker, `The picker keeps the ${String(step)}th Tab inside the dialog, so an open dialog never lets focus escape behind it.`);
      }

      // The file chooser belongs to the browser and cannot be operated from a script, so the input is handed the file.
      // Everything after it — the alternative text, the confirmation and the close — is done from the keyboard.
      await picker.getByLabel(/^File/u).setInputFiles(IMAGE_FIXTURE_PATH);
      const described = page.locator('[data-slot="media-picker"][data-phase="described"]');
      await expect(described, "A measured file reaches the step that describes it, where alternative text is required.").toBeVisible();
      await typeFromKeyboard(page, described.getByRole("textbox", { name: /^Alternative text/u }), IMAGE_ALT_TEXT, "The image's alternative text");
      await pressFromKeyboard(page, described.getByRole("button", { name: "Add this image" }), "Placing the image");
      const settled = page.locator('[data-slot="media-picker"][data-phase="settled"]');
      await expect(settled, "The placement is settled inside the picker, which states what the attempt answered.").toBeVisible();

      // Escape closes the dialog and returns focus to the control that opened it (2.4.3 Focus Order).
      await page.keyboard.press("Escape");
      await expect(picker, "Escape closes the picker rather than leaving an open dialog behind.").toHaveCount(0);
      await expect(opener, "Closing the picker returns focus to the control that opened it.").toBeFocused();

      const images = page.getByRole("region", { name: "Images in this draft, scrollable" });
      await expect(images.getByText(IMAGE_ALT_TEXT, { exact: false }), "The draft's media pane states the placement the draft now holds.").toBeVisible();

      // The preview: the exact revision the edition acknowledges, read from the same route at this width.
      await pressFromKeyboard(page, page.getByRole("link", { name: "Preview this edition" }), "Opening the preview");
      await expect(page.getByRole("heading", { name: "Preview", level: 1 }), "The preview is a destination of its own, one step from the editor.").toBeVisible();
      await expect(page.getByRole("img", { name: IMAGE_ALT_TEXT }).first(), "The preview renders the placement with its own text alternative, so the image is described to a reader who cannot see it.").toBeVisible();
      await expectNoHorizontalPageScroll(page, "The Update preview at 320 CSS px");
      await expectDevelopmentData(page, "The Update preview");
    });

    test("every route this file visits fits 320 CSS px, and the matrix answers with its period-first presentation", async ({ page }) => {
      // ---------------------------------------------------------------------------------------
      // Reflow across the routes the three jobs pass through, one of them a deliberately wide table
      // ---------------------------------------------------------------------------------------
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

      // The partner-by-month matrix is the widest thing this application renders. At this width it must answer with its
      // period-first, labelled presentation instead of a table a reader would have to drag sideways to read a cell.
      await page.goto(ROUTES.matrixReport);
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
});

// ---------------------------------------------------------------------------------------------
// 200 % zoom: the same obligations at half the CSS width
// ---------------------------------------------------------------------------------------------

/** Applies the browser-zoom equivalent the criterion names: the root is scaled, so the layout reflows into half the width. */
async function applyBrowserZoom(page: Page): Promise<void> {
  await page.evaluate((factor: number) => {
    document.documentElement.style.zoom = String(factor);
  }, ZOOM_FACTOR);
  // The zoom is a layout change, so it is read back before anything is measured through it: a reading taken before the
  // browser had applied it would describe the unzoomed page.
  await expect.poll(async () => page.evaluate(() => window.getComputedStyle(document.documentElement).zoom), "The root zoom the criterion states is applied before anything is measured through it.").toBe(String(ZOOM_FACTOR));
}

/** Asserts a text element renders all of its own content, rather than clipping it to a fixed box. */
async function expectTextNotClipped(scope: Locator, surface: string): Promise<void> {
  const clipped = await scope.evaluate((root: Element) => {
    const elements = [root, ...Array.from(root.querySelectorAll("h1, h2, p, output, label"))].filter((element): element is HTMLElement => element instanceof HTMLElement).slice(0, 40);
    const findings: { readonly element: string; readonly overflow: number }[] = [];
    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) {
        // A visually hidden element (the `sr-only` technique) is a one-pixel clipped box on purpose: it is text written
        // for a screen reader rather than text a zoomed reader reads, so it is not a clipping finding.
        continue;
      }
      const hidesOverflow = style.overflowX === "hidden" || style.overflowX === "clip";
      if (!hidesOverflow) {
        continue;
      }
      const overflow = element.scrollWidth - element.clientWidth;
      if (overflow > 1) {
        findings.push({ element: `${element.tagName.toLowerCase()}: ${element.textContent?.replace(/\s+/gu, " ").trim().slice(0, 40) ?? ""}`, overflow });
      }
    }
    return findings;
  });
  expect(
    clipped.map((finding) => `${finding.element} (+${String(finding.overflow)} px)`),
    `${surface}: text is wrapped or reflowed rather than clipped, so a zoomed reader is not shown a cut-off line.`,
  ).toEqual([]);
}

test.describe("at 200 % zoom", () => {
  test.use({ viewport: ZOOM_VIEWPORT, persona: ESTABLISHED_WORKER });

  test("a list, a form and the editor stay readable and operable, and an overlay still traps and returns focus", async ({ page }, testInfo) => {
    // -----------------------------------------------------------------------------------------
    // The list
    // -----------------------------------------------------------------------------------------
    await page.goto(ROUTES.partners);
    const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
    await expect(roster).toBeVisible();
    await applyBrowserZoom(page);
    await expectNoHorizontalPageScroll(page, "The partner roster at 200 % zoom");
    await expectTextNotClipped(page.locator('[data-slot="query-toolbar"]'), "The roster toolbar at 200 % zoom");
    await expectTargetSizeFloor(page, page.locator('[data-slot="query-toolbar"]'), "The roster toolbar at 200 % zoom", testInfo);
    // The zoomed layout renders the expanded navigation ahead of the surface, so the sweep is read as a count of named
    // stops — each of them visible and unobscured — rather than as one particular stop, and the surface's own
    // operability is proved below by typing into its search field.
    const stops = await sweepTabOrder(page, "The partner roster at 200 % zoom", ZOOM_TAB_SWEEP_STEPS);
    expect(stops.filter((name) => name !== "").length, `Tab walks the surface's own controls at 200 % zoom with every stop visible and unobscured, and the sweep met ${JSON.stringify(stops.slice(0, 12))}.`).toBeGreaterThanOrEqual(12);
    // The search field is operated from the keyboard at this zoom, so the list is not merely reachable: it works.
    await typeFromKeyboard(page, page.getByRole("searchbox", { name: "Search" }), ROSTER_SEARCH_TEXT, "The roster search at 200 % zoom");
    await expectNoHorizontalPageScroll(page, "The roster with a search typed at 200 % zoom");
    await expectDevelopmentData(page, "The partner roster at 200 % zoom");

    // -----------------------------------------------------------------------------------------
    // The form: typed into, not submitted, so the record is left exactly as the seed laid it down
    // -----------------------------------------------------------------------------------------
    await page.goto(ROUTES.partnerEdit);
    const form = page.locator('[data-slot="partner-edit-form"]');
    await expect(form).toBeVisible();
    await applyBrowserZoom(page);
    await expectNoHorizontalPageScroll(page, "The contact edit form at 200 % zoom");
    await expectTextNotClipped(form, "The contact edit form at 200 % zoom");
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^Display name/u }), EDITED_DISPLAY_NAME, "The display name at 200 % zoom");
    await expectNoHorizontalPageScroll(page, "The contact edit form with text typed at 200 % zoom");

    // -----------------------------------------------------------------------------------------
    // The editor, and the overlay it opens
    // -----------------------------------------------------------------------------------------
    await page.goto(ROUTES.editor);
    await expect(page.getByRole("heading", { name: "Update edition", level: 1 })).toBeVisible();
    await applyBrowserZoom(page);
    await expectNoHorizontalPageScroll(page, "The Update editor at 200 % zoom");
    await expectTextNotClipped(page.getByRole("region", { name: "Write this Update edition" }), "The Update editor at 200 % zoom");

    const mediaPane = page.getByRole("region", { name: "Media in this draft" });
    const opener = mediaPane.getByRole("button", { name: "Add an image" });
    await pressFromKeyboard(page, opener, "Opening the image picker at 200 % zoom");
    const picker = page.locator('[data-slot="media-picker"]');
    await expect(picker).toBeVisible();
    await expectNoHorizontalPageScroll(page, "The image picker at 200 % zoom");
    // An overlay is fully operable at this zoom: focus is contained while it is open, Escape closes it, and focus
    // returns to the control that opened it rather than to the top of the document.
    for (let step = 1; step <= 6; step += 1) {
      await page.keyboard.press("Tab");
      await settleLayout(page);
      await expectFocusInsideDialog(picker, `The open picker keeps the ${String(step)}th Tab inside itself at 200 % zoom.`);
    }
    await page.keyboard.press("Escape");
    await expect(picker, "Escape closes the picker at 200 % zoom.").toHaveCount(0);
    await expect(opener, "Closing the picker returns focus to the control that opened it at 200 % zoom.").toBeFocused();
    await expectDevelopmentData(page, "The Update editor at 200 % zoom");
  });
});

// ---------------------------------------------------------------------------------------------
// The accessibility audit: five surfaces, one tag set, no serious or critical finding
// ---------------------------------------------------------------------------------------------

test.describe("the WCAG 2.2 AA audit", () => {
  test.use({ viewport: ZOOM_VIEWPORT, persona: ESTABLISHED_WORKER });

  test("the shell, a form, an open dialog, the partners table and the prose editor carry no serious or critical violation", async ({ page }, testInfo) => {
    auditedSurfaces.length = 0;

    // 1. The shell's own navigation, which every surface renders inside.
    await page.goto(ROUTES.partners);
    await expect(page.getByRole("navigation", { name: "Primary" }), "The shell's navigation is a named landmark, so it can be audited as the surface it is.").toBeVisible();
    await auditSurface(page, testInfo, "the shell navigation");

    // 2. The partners table, with its toolbar, its header controls and its pager.
    const roster = page.getByRole("region", { name: "Partner roster, scrollable" });
    await expect(roster.getByRole("table")).toBeVisible();
    await auditSurface(page, testInfo, "the partners table");

    // 3. A real form, filled to the state a person would submit it in, and not yet submitted.
    await page.goto(ROUTES.interactionForm);
    const form = page.locator('[data-slot="interaction-form"]');
    await expect(form.getByRole("heading", { name: "Log an interaction", level: 2 })).toBeVisible();
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What came of it/u }), INTERACTION_OUTCOME, "What came of the contact");
    await auditSurface(page, testInfo, "the interaction form");

    // 4. An open dialog. The picker is audited while it is open, because a closed dialog is not a surface a person can
    //    meet and an open one is where focus containment, labelling and the file input all have to hold.
    await page.goto(ROUTES.editor);
    const mediaPane = page.getByRole("region", { name: "Media in this draft" });
    await pressFromKeyboard(page, mediaPane.getByRole("button", { name: "Add an image" }), "Opening the image picker for the audit");
    const picker = page.locator('[data-slot="media-picker"]');
    await expect(picker, "The dialog is open when it is audited.").toBeVisible();
    await auditSurface(page, testInfo, "the open media picker");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    // 5. The prose editor, with its bounded toolbar and its own editing surface.
    await expect(page.getByRole("textbox", { name: "The text of this Update edition" }), "The one prose editor is the surface audited here.").toBeVisible();
    await auditSurface(page, testInfo, "the prose editor");

    expect(auditedSurfaces, "All five surfaces the criterion names were audited, so a surface that stopped running could not pass.").toEqual(["the shell navigation", "the partners table", "the interaction form", "the open media picker", "the prose editor"]);
    await expectDevelopmentData(page, "The audited editor");
  });
});

// ---------------------------------------------------------------------------------------------
// A save that fails: the error is stated where the form states errors, and nothing typed is lost
// ---------------------------------------------------------------------------------------------

test.describe("a save that is refused", () => {
  test.use({ viewport: ZOOM_VIEWPORT, persona: ESTABLISHED_WORKER });

  test("a refusal the service produces is stated in the field's own error slot, and the corrected save is accepted", async ({ page }) => {
    await page.goto(ROUTES.partnerEdit);
    const form = page.locator('[data-slot="partner-edit-form"]');
    const displayName = form.getByRole("textbox", { name: /^Display name/u });
    const givenName = form.getByRole("textbox", { name: /^Given name/u });
    await expect(form, "The permitted-field edit is offered to the identity that may change this record.").toBeVisible();

    await typeFromKeyboard(page, givenName, EDITED_GIVEN_NAME, "The given name");
    await typeFromKeyboard(page, displayName, CLEARED_DISPLAY_NAME, "Clearing the display name");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Save these changes" }), "Saving an empty display name");

    // The one error presentation this application has: the control carries the message, is marked invalid for assistive
    // technology, and is described by the message rather than only coloured beside it.
    const fieldError = page.locator("#field-displayName-error");
    await expect(fieldError, "The refused field states its own message in the control's error slot.").toBeVisible();
    await expect(displayName, "The control is marked invalid for assistive technology, not only coloured.").toHaveAttribute("aria-invalid", "true");
    await expect(displayName, "The invalid control is described by its own message, so a screen reader reads why it was refused.").toHaveAttribute("aria-describedby", /field-displayName-error/u);
    await expect(givenName, "The refusal loses nothing else the worker typed.").toHaveValue(EDITED_GIVEN_NAME);

    // The retry succeeds once the field it refused is corrected: the failure changed nothing, so nothing has to be
    // re-entered beyond the one value the refusal named.
    await typeFromKeyboard(page, displayName, EDITED_DISPLAY_NAME, "Correcting the display name");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Save these changes" }), "Saving the corrected change");
    await expect(page.locator('[data-slot="partner-edit-outcome"][data-outcome="accepted"]'), "The corrected change is accepted, so a refused save is recoverable without re-entering the form.").toBeVisible();
    await expect(page.locator("#field-displayName-error"), "The corrected field no longer states an error.").toHaveCount(0);
    await expectDevelopmentData(page, "The permitted-field edit");
  });

  test("a stale revision shows the current value beside the preserved input and offers a deliberate choice", async ({ page, request }) => {
    await armConflictOn(request, CONTACT_EDIT_MUTATION);
    await page.goto(ROUTES.partnerEdit);
    const form = page.locator('[data-slot="partner-edit-form"]');
    const displayName = form.getByRole("textbox", { name: /^Display name/u });
    const givenName = form.getByRole("textbox", { name: /^Given name/u });
    await expect(form).toBeVisible();

    await typeFromKeyboard(page, givenName, EDITED_GIVEN_NAME, "The given name");
    await typeFromKeyboard(page, displayName, EDITED_DISPLAY_NAME, "The display name");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Save these changes" }), "Saving against a revision that has moved");

    // A stale revision is answered with the conflict panel rather than with a lost change: the input is preserved, the
    // record's own value is stated beside it, and re-applying or discarding is the worker's decision.
    const conflict = page.locator('[data-slot="partner-edit-conflict"]');
    await expect(conflict, "A stale revision is answered with the conflict panel rather than a silently lost change.").toBeVisible();
    await expect(conflict.getByRole("button", { name: "Apply my changes" }), "The panel offers re-applying the preserved input.").toBeVisible();
    await expect(conflict.getByRole("button", { name: "Discard mine" }), "The panel offers discarding the input deliberately, rather than discarding it by default.").toBeVisible();
    await expect(conflict.getByText(/revision/u).first(), "The panel states the revision the record stands at, so the refusal is stated in the record's own terms.").toBeVisible();
    await expect(displayName, "Every value the worker typed is still in its own field after the refusal.").toHaveValue(EDITED_DISPLAY_NAME);
    await expect(givenName, "Every value the worker typed is still in its own field after the refusal.").toHaveValue(EDITED_GIVEN_NAME);
    await expect(page.locator('[data-slot="partner-edit-outcome"][data-outcome="accepted"]'), "The refused attempt applied nothing, so no accepted change is claimed.").toHaveCount(0);

    // The condition behind the conflict is cleared and the same change is recovered by re-reading the record it belongs
    // to — which is what reopening the record's own edit page does — and saving the value the worker typed.
    await disarmFailurePlan(request);
    await page.goto(ROUTES.partnerEdit);
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^Given name/u }), EDITED_GIVEN_NAME, "The given name, re-entered");
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^Display name/u }), EDITED_DISPLAY_NAME, "The display name, re-entered");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Save these changes" }), "Saving the same change against the revision now standing");
    await expect(page.locator('[data-slot="partner-edit-outcome"][data-outcome="accepted"]'), "The change the conflict preserved is applied once the revision it presents is the one the record stands at.").toBeVisible();
    await expectDevelopmentData(page, "The permitted-field edit after recovery");
  });

  test("a lost acknowledgement keeps every typed value and recovers the same attempt by its own identity", async ({ page, request }) => {
    await setFailurePlan(request, { mode: "unknown", target: { kind: "mutation", name: LOST_ACKNOWLEDGEMENT_MUTATION } });
    await page.goto(ROUTES.interactionForm);
    const form = page.locator('[data-slot="interaction-form"]');
    await expect(form.getByRole("heading", { name: "Log an interaction", level: 2 })).toBeVisible();

    await form.getByRole("combobox", { name: /^Kind of contact/u }).selectOption("call");
    await form.getByRole("textbox", { name: /^The day it happened/u }).fill(INTERACTION_DATE);
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^How they took part/u }), INTERACTION_ROLE, "How the contact took part");
    await typeFromKeyboard(page, form.getByRole("textbox", { name: /^What came of it/u }), INTERACTION_OUTCOME, "What came of the contact");
    await pressFromKeyboard(page, form.getByRole("button", { name: "Log the interaction" }), "Submitting the interaction");

    // The acknowledgement was lost, so the receipt claims neither success nor failure, keeps every typed value on
    // screen, and offers no second submit.
    const receipt = form.locator('[data-slot="operation-result"]');
    await expect(receipt, "A lost acknowledgement is stated as unknown rather than claimed as saved or refused.").toHaveAttribute("data-outcome", "unknown");
    await expect(receipt.getByRole("button", { name: "Check the result" }), "The receipt offers checking this same attempt rather than sending the work again.").toBeVisible();
    await expect(form.getByRole("textbox", { name: /^What came of it/u }), "Every value the worker typed is still on screen while the result is unconfirmed.").toHaveValue(INTERACTION_OUTCOME);
    await expect(form.getByRole("button", { name: "Log the interaction" }), "No second submit is offered for work that may already exist.").toHaveCount(0);

    await disarmFailurePlan(request);
    await pressFromKeyboard(page, receipt.getByRole("button", { name: "Check the result" }), "Checking the same attempt's result");
    await expect(form.locator('[data-slot="operation-result"][data-outcome="alreadyAccepted"]'), "The same attempt's result is recovered by its own identity, so exactly one effect exists.").toBeVisible();

    // One interaction, not two: the record states what happened once.
    await page.goto(ROUTES.partnerRecord);
    const activity = page.getByRole("region", { name: "Actual activity" });
    await expect(activity.getByText(INTERACTION_OUTCOME, { exact: false }), "The recovered attempt recorded the contact once, and the record states it.").toHaveCount(1);
    await expectDevelopmentData(page, "The partner's record after a recovered interaction");
  });

  test("a refused autosave keeps the readable text, says it is not acknowledged, and the kept copy saves once the condition is gone", async ({ page, request }) => {
    await armConflictOn(request, DRAFT_SAVE_MUTATION);
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

    // The condition is cleared, and the editor is re-read: the text this browser kept is offered as exactly what it is —
    // the text the service never acknowledged — and adopting it begins an ordinary change against the revision the
    // record now stands at.
    await disarmFailurePlan(request);
    await page.reload();
    const kept = page.getByRole("button", { name: "Use the text this browser kept" });
    await expect(kept, "After the editor is re-read, the text this browser kept is offered and labelled as existing only in this browser.").toBeVisible();
    await pressFromKeyboard(page, kept, "Adopting the text this browser kept");
    await expect(page.locator('[data-slot="autosave-status"]'), "The adopted text saves as an ordinary change once the condition behind the refusal is gone.").toHaveAttribute("data-autosave-state", "saved");
    await expect(page.getByRole("textbox", { name: "The text of this Update edition" }), "The saved text is the text still on screen.").toContainText(TYPED_PROSE);
    await expectDevelopmentData(page, "The Update editor after a recovered save");
  });
});
