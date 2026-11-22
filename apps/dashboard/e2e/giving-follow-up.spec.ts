/**
 * Criterion 8 — giving follow-up: a gift leads to one ordinary task, and to nothing else.
 *
 * The journey this file walks, from the deterministic seed as the established worker: read the
 * received-support figures, the ledger's and the commitments' whole-result counts, the open work, the synthetic
 * inbox's own count and the publisher's audience, open one gift from the ledger, use the gift record's own action
 * to create a thank-you task, and then read every one of those figures again. Each figure is read off the page that
 * states it — the lists and their counted pagers, the inbox's message count and the audience's counts panel — so
 * every comparison is a comparison of what a worker can see, and no figure is taken from a transport the surface
 * never shows.
 *
 * What the assertions are for. A gift is a financial fact the source reports and this application never
 * writes, corrects or infers (AAP 0.8.1): the only financial mutation in the release is the goal, and
 * only under `canEditGoal`. A task is work the worker owns, and completing it proves nothing about
 * contact, payment or fulfilment (AAP 0.8.2). So the outcome proven here is not "the task was saved" but
 * "the task was saved and no financial record, no message, no subscription and no stewardship obligation
 * came with it" — which is why each baseline is compared exactly rather than sampled, and why the
 * surfaces that carry the claim say what did not happen.
 *
 * Money is never read as a float. Every amount is compared as an integer number of minor units derived
 * from the display and the exponent its own decimal places state, so a cent cannot be lost to rounding
 * and no exponent is assumed.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, resetSeed, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded scenario this file acts in
// ---------------------------------------------------------------------------------------------

/**
 * The seeded identity every page below is read as.
 *
 * The established worker holds years of received support, recurring commitments, partners and open work
 * across two ministries, so a gift, a commitment and a task all exist before this file does anything:
 * the baseline of "before" is a world that already holds figures, and an unchanged figure therefore
 * means something.
 */
const PERSONA: PersonaName = "established-worker";

/** The destinations this journey reads. */
const GIFTS_HREF = "/support/gifts";
const COMMITMENTS_HREF = "/support/commitments";
const WORK_HREF = "/work";
const INBOX_HREF = "/communication/inbox";
const AUDIENCE_HREF = "/communication/audience";
const PARTNER_HREF = "/partners/partner-jo-mbeki";

/**
 * The gift this journey thanks the supporter for: the one received gift the ledger's default period
 * (this month) holds, attributed to `partner-jo-mbeki`, so the task the record creates is about a
 * partner whose own record the run can read back.
 */
const GIFT_ROW_ID = "gift-row-harbour-0001";
const GIFT_ID = "gift-harbour-0001";

/** The partner the gift is attributed to, as an opaque reference: never a name, never an email. */
const PARTNER_REFERENCE = "partner-jo-mbeki";

/** The one task this file creates. Its title names the partner, which is what makes it findable by a person. */
const FOLLOW_UP_TITLE = "Thank Jo Mbeki for the November gift";

/** The words the gift record, its review step and its receipt carry, as the components state them. */
const OPEN_GIFT_LINK = `Open gift ${GIFT_ID}`;
const RECORD_HEADING = "Gift record";
const FOLLOW_UP_SECTION = "Follow up on this gift";
const REVIEW_TITLE = "Review the follow-up task";
const CONFIRM_LABEL = "Create a thank-you task";
const PARTNER_FIELD_LABEL = "Partner reference";
const SAVED_HEADING = "Saved";
const PROVENANCE_SECTION = "Provenance";
const ACTIVITY_SECTION = "Actual activity";
const OPEN_TASKS_SECTION = "Open tasks";
const DEVELOPMENT_DATA_LABEL = "Development data";

/** The honesty sentences the follow-up states, as `features/support/copy.ts` writes them. */
const NO_MESSAGE_ON_TRIGGER = /sends no message and creates no stewardship obligation/u;
const NOTHING_ELSE_ON_RESULT = /no message was sent and no obligation was created/u;

/** The distinct nouns the two lists state their whole-result count with. */
const LEDGER_NOUN = "gifts";
const COMMITMENT_NOUN = "commitments";

/**
 * The civil day the Work surface calls today.
 *
 * The deterministic seed's scenario instant is `2026-11-20T00:00:00Z`, and the Work page states that every date it
 * judges is judged in UTC, so the instant falls on this civil day there. No surface states the day itself — the
 * development panel states the instant and the page states the zone — which is why the day is named once here
 * rather than read back. The Today list is what proves it: a task dated any other day would not be in that list, so
 * the two cannot part without this file failing on the assertion below rather than passing quietly.
 */
const SEEDED_TODAY = "2026-11-20";

/** The noun every task list counts its rows in, and the widest window the Work surface pages a list by. */
const TASK_NOUN = "tasks";
const TASK_PAGE_SIZE = "200";

/**
 * The four lists that hold open work, in the order the surface's switcher offers them, with the words each states
 * when it holds nothing.
 *
 * Every one of these lists holds open work only: the read partitions it by the civil day a task stands at, so the
 * four together are the work a person still has to do, and the All list — the fifth — is the one that also holds
 * closed work.
 */
const OPEN_TASK_LISTS: readonly { readonly key: string; readonly label: string; readonly emptyTitle: string }[] = [
  { key: "today", label: "Today", emptyTitle: "Nothing is due today" },
  { key: "upcoming", label: "Upcoming", emptyTitle: "Nothing is dated ahead" },
  { key: "overdue", label: "Overdue", emptyTitle: "Nothing is past its date" },
  { key: "undated", label: "Undated", emptyTitle: "No task is undated" },
];

/** The prefix a row's own selection control names the task it selects with, and the header control it is told apart from. */
const ROW_SELECTION = /^Select (?!all )/u;
const ROW_SELECTION_PREFIX = "Select ";

/** The partner's name as the roster states it, which is how its record's own link reads on a task row. */
const PARTNER_LABEL = "Jo Mbeki";

/** What the inbox and the audience state their figures with, as their own copy words them. */
const INBOX_HEADING = "Synthetic inbox";
const INBOX_OUTCOMES_LIST = "Send outcomes recorded in this inbox";
const INBOX_COUNT_SENTENCE = /^(?:([\d,]+)|One) messages? (?:have|has) been produced for this membership\.$/u;
const AUDIENCE_HEADING = "Update email audience";
const AUDIENCE_COUNTS_SLOT = '[data-slot="membership-counts"]';
const MEMBER_NOUN = "members";

// ---------------------------------------------------------------------------------------------
// Reading a figure the application states
// ---------------------------------------------------------------------------------------------

/** One currency's part of the whole result, in the integer minor units its display states. */
interface CurrencyFigure {
  readonly currency: string;
  readonly minorUnits: number;
  readonly giftCount: number;
}

/** What the ledger's whole-result summary states: one figure per currency, and the text it stated them in. */
interface WholeResult {
  readonly figures: readonly CurrencyFigure[];
  readonly text: string;
}

/** The amount a figure line states, with the currency code the line names for it. */
const AMOUNT_IN_FIGURE = /(-?\d[\d.,]*)\s+([A-Z]{3})\b/u;

/** The gift count the same line states beside that amount. */
const COUNT_IN_FIGURE = /and\s+([\d,]+)\s+gifts?\b/u;

/** The whole-result sentence a paged list states: `Showing 1–6 of 6 commitments`. The dash is an en dash. */
const SHOWING_LINE = /^Showing\s+([\d,]+)\u2013([\d,]+)\s+of\s+([\d,]+)\s+(\S+)$/u;

/**
 * The integer minor units a displayed amount states.
 *
 * The interface formats every amount for en-GB — `,` groups the thousands, `.` separates the fraction —
 * and pads the fraction to exactly the currency's exponent, so a zero-decimal currency renders no
 * separator at all. Reading the exponent back off the display is what keeps this comparison in integers:
 * no float ever touches the amount and no exponent is assumed here.
 */
function minorUnitsFrom(displayed: string): number {
  const stripped = displayed.replace(/\(incomplete\)/gu, "").trim();
  const negative = stripped.startsWith("-");
  const unsigned = negative ? stripped.slice(1) : stripped;
  const [whole = "", fraction = ""] = unsigned.split(".");
  const integer = whole.replace(/,/gu, "");
  const digits = `${integer}${fraction}`;
  const units = Number(digits);
  if (!/^\d+$/u.test(digits) || !Number.isSafeInteger(units)) {
    throw new Error(`The amount this surface displayed, ${JSON.stringify(displayed)}, is not one this file can read as an exact number of minor units. A figure that cannot be read exactly is not compared approximately.`);
  }
  return negative ? -units : units;
}

/**
 * The figures the ledger's whole-result summary states, read from the text it renders.
 *
 * The summary is the whole result the filters match rather than the rows on the page, so it is the one
 * place a total can be read without paging: a comparison against it is a comparison of the whole query.
 */
async function readWholeResult(page: Page): Promise<WholeResult> {
  const rows = page.locator('[data-slot="whole-result-summary"] li');
  const stated = await rows.count();
  const figures: CurrencyFigure[] = [];
  const lines: string[] = [];
  for (let index = 0; index < stated; index += 1) {
    const text = (await rows.nth(index).innerText()).replace(/\s+/gu, " ").trim();
    lines.push(text);
    const amount = AMOUNT_IN_FIGURE.exec(text);
    const count = COUNT_IN_FIGURE.exec(text);
    if (amount === null || count === null) {
      throw new Error(`The whole-result line ${JSON.stringify(text)} does not state an amount with its currency and a gift count, so this file cannot compare it. Every received-support figure is stated as "<amount> <currency> ... and N gifts".`);
    }
    figures.push({ currency: amount[2] ?? "", minorUnits: minorUnitsFrom(amount[1] ?? ""), giftCount: Number((count[1] ?? "").replace(/,/gu, "")) });
  }
  return { figures, text: lines.join(" | ") };
}

/** The whole-result count a paged list states, as a number this file can compare exactly. */
async function readListTotal(page: Page, noun: string): Promise<number> {
  const line = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  const match = SHOWING_LINE.exec(line);
  if (match === null || match[4] !== noun) {
    throw new Error(`The ${noun} list states its whole result as "Showing 1–N of M ${noun}", and it read ${JSON.stringify(line)} instead. A count that cannot be read here would leave the whole result unchecked.`);
  }
  const total = Number((match[3] ?? "").replace(/,/gu, ""));
  if (!Number.isSafeInteger(total)) {
    throw new Error(`The ${noun} count ${JSON.stringify(line)} is not a whole number of rows.`);
  }
  return total;
}

/** What the gift record states about one row, kept so the same record can be compared after the change. */
interface GiftRecordFigure {
  /** The row's amount, in integer minor units, together with the currency the source named. */
  readonly currency: string;
  readonly minorUnits: number;
  /** The provenance reference this row carries, as one opaque string printed by the record. */
  readonly provenance: readonly string[];
}

/** The gift record's own figures: its amount and the references its provenance section prints. */
async function readGiftRecord(page: Page): Promise<GiftRecordFigure> {
  await expect(page.getByRole("heading", { name: RECORD_HEADING, level: 1 })).toBeVisible();
  const row = page.locator(`[data-gift-row-id="${GIFT_ROW_ID}"]`);
  await expect(row).toBeVisible();
  const displayed = (await row.innerText()).replace(/\s+/gu, " ").trim();
  const amount = AMOUNT_IN_FIGURE.exec(displayed);
  if (amount === null) {
    throw new Error(`The gift record states its amount as ${JSON.stringify(displayed)}, which names no amount and currency this file can read.`);
  }
  // The provenance block is the card titled with its own heading, so the references read here are that
  // block's and not a reference some other part of the record happens to print.
  const provenanceBlock = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: PROVENANCE_SECTION }) });
  await expect(page.getByRole("heading", { name: PROVENANCE_SECTION })).toBeVisible();
  const provenance = (await provenanceBlock.locator("bdi").allInnerTexts()).map((value) => value.trim()).filter((value) => value !== "");
  return { currency: amount[2] ?? "", minorUnits: minorUnitsFrom(amount[1] ?? ""), provenance };
}

// ---------------------------------------------------------------------------------------------
// Reading a figure off the surface that states it
// ---------------------------------------------------------------------------------------------

/** One statement as one comparable line: the whitespace a rendering happens to insert is not a fact. */
function squash(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * The open work the Work surface states: the titles of the rows its open lists hold, and the whole result those
 * lists' pagers count.
 */
interface OpenWork {
  readonly titles: readonly string[];
  readonly total: number;
}

/** The titles of the open work, in one order two reads can be compared by. */
function titlesOf(work: OpenWork): readonly string[] {
  return work.titles;
}

/**
 * The work a person still has to do, as the four open lists state it.
 *
 * Today, Upcoming, Overdue and Undated are the read's own partition of open work by the civil day a task stands at,
 * so the four together are every open task and leaving the All list out is what keeps closed work out of the count.
 * Each list's counted pager states its whole result rather than the rows one page holds, and a list that holds
 * nothing says so in its own words instead of rendering a table.
 */
async function readOpenWork(page: Page): Promise<OpenWork> {
  const titles: string[] = [];
  let total = 0;
  for (const list of OPEN_TASK_LISTS) {
    await page.goto(`${WORK_HREF}?list=${list.key}&pageSize=${TASK_PAGE_SIZE}`);
    await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The five lists are a destination of their own, reached from the shell.").toBeVisible();
    await expect(page.locator('[data-slot="work-task-lists"]'), `The ${list.label} list is the one the address names.`).toHaveAttribute("data-list", list.key);
    const region = page.getByRole("region", { name: `${list.label} ${TASK_NOUN}, scrollable` });
    const empty = page.getByRole("heading", { name: list.emptyTitle });
    await expect(region.or(empty), `The ${list.label} list states its rows, or says in its own words that it holds none.`).toBeVisible();
    if ((await region.count()) === 0) {
      // The list holds nothing, and that is a figure of zero rather than an unreadable page.
      continue;
    }
    total += await readListTotal(page, TASK_NOUN);
    titles.push(...(await statedTitles(region)));
  }
  return { titles: titles.sort(), total };
}

/** Every title a list shows, as each row's own selection control names the task it selects. */
async function statedTitles(region: Locator): Promise<readonly string[]> {
  const rows = region.getByRole("checkbox", { name: ROW_SELECTION });
  await expect(rows.first(), "The list states at least one row, so the work it counts is work it shows.").toBeVisible();
  const labels = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels.filter((label) => label.startsWith(ROW_SELECTION_PREFIX)).map((label) => label.slice(ROW_SELECTION_PREFIX.length));
}

/**
 * What the synthetic inbox states: the whole number of messages this reader's purpose has produced, and how each
 * recorded send outcome counts.
 *
 * Both are the read's whole-result figures rather than the rows one page holds, and the outcome counts are stated
 * beside them: a message that changed from accepted to failed keeps the same total and moves one of these.
 */
interface Messages {
  readonly stated: number;
  readonly outcomes: string;
}

/** The inbox's own statements: the messages it has produced for this membership, and the outcome counts. */
async function readMessages(page: Page): Promise<Messages> {
  await page.goto(INBOX_HREF);
  await expect(page.getByRole("heading", { name: INBOX_HEADING, level: 1 }), "The synthetic inbox is a destination of its own, reached from the shell.").toBeVisible();
  const sentence = page.getByText(INBOX_COUNT_SENTENCE).first();
  await expect(sentence, "The inbox states how many messages this membership's purpose has produced, as its whole result rather than the rows on one page.").toBeVisible();
  const match = INBOX_COUNT_SENTENCE.exec(squash(await sentence.innerText()));
  if (match === null) {
    throw new Error(`The inbox states its whole result, and it read ${JSON.stringify(await sentence.innerText())} instead. A count that cannot be read here would leave the inbox unchecked.`);
  }
  const stated = match[1] === undefined ? 1 : Number((match[1] ?? "").replace(/,/gu, ""));
  if (!Number.isSafeInteger(stated)) {
    throw new Error(`The inbox count ${JSON.stringify(match[1])} is not a whole number of messages.`);
  }
  const outcomes = page.getByRole("list", { name: INBOX_OUTCOMES_LIST });
  await expect(outcomes, "The inbox states how each recorded send outcome counts.").toBeVisible();
  return { stated, outcomes: squash(await outcomes.innerText()) };
}

/**
 * What the publisher's audience states: every figure its counts panel carries — the eligible and excluded totals,
 * each of the four membership states and each exclusion reason — and the whole membership count its pager states.
 *
 * A membership that was added, confirmed, restricted, excluded or switched off moves one of these figures, so no
 * subscription nobody consented to can pass unnoticed.
 */
interface Audience {
  readonly counts: string;
  readonly members: number;
}

/** The audience's own statements: the counts panel as one comparable text, and the whole membership count. */
async function readAudience(page: Page): Promise<Audience> {
  await page.goto(AUDIENCE_HREF);
  await expect(page.getByRole("heading", { name: AUDIENCE_HEADING, level: 1 }), "The publisher's audience is a destination of its own, reached from the shell.").toBeVisible();
  const counts = page.locator(AUDIENCE_COUNTS_SLOT);
  await expect(counts, "The audience states its eligible and excluded figures, the four membership states and every exclusion reason.").toBeVisible();
  return { counts: squash((await counts.textContent()) ?? ""), members: await readListTotal(page, MEMBER_NOUN) };
}

/** Every figure this journey compares before and after the follow-up is created. */
interface Baselines {
  readonly wholeResult: WholeResult;
  readonly ledgerTotal: number;
  readonly commitmentTotal: number;
  readonly openWork: OpenWork;
  readonly messages: Messages;
  readonly audience: Audience;
  readonly partnerActivity: number;
}

/**
 * Everything this journey compares, read from the surfaces a worker reads it from.
 *
 * The support figures, the ledger count, the commitment count, the partner's own activity, the open work, the
 * inbox's count and the audience's counts are each read off the page that states them, so every baseline is a fact
 * a person can look at rather than a figure taken from a transport no surface shows.
 */
async function readBaselines(page: Page): Promise<Baselines> {
  await page.goto(GIFTS_HREF);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const wholeResult = await readWholeResult(page);
  const ledgerTotal = await readListTotal(page, LEDGER_NOUN);
  await page.goto(COMMITMENTS_HREF);
  await expect(page.getByRole("heading", { name: "Commitments", level: 1 })).toBeVisible();
  const commitmentTotal = await readListTotal(page, COMMITMENT_NOUN);
  await page.goto(PARTNER_HREF);
  const activity = page.getByRole("region", { name: ACTIVITY_SECTION });
  await expect(activity).toBeVisible();
  const partnerActivity = await activity.getByRole("listitem").count();
  return { wholeResult, ledgerTotal, commitmentTotal, openWork: await readOpenWork(page), messages: await readMessages(page), audience: await readAudience(page), partnerActivity };
}

// ---------------------------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------------------------

/** This file acts as the established worker throughout, which is the persona the runner admits the context as. */
test.use({ persona: PERSONA });

/**
 * Every test starts from the deterministic seed.
 *
 * The runner's automatic `seedReset` fixture restores the same seed before the test body and puts this
 * persona's session cookie on the context; the call below states that requirement where this file is
 * read, and a second reset lays the identical documents down again — the same control the Settings reset
 * submits, so the state this file asserts against is the state that command produces.
 */
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

/** Opens the ledger and follows the row's own link to the gift record, which is the only route to it. */
async function openGiftFromLedger(page: Page): Promise<void> {
  await page.goto(GIFTS_HREF);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const giftLink = page.getByRole("link", { name: OPEN_GIFT_LINK });
  await expect(giftLink).toBeVisible();
  await giftLink.click();
  await expect(page.getByRole("heading", { name: RECORD_HEADING, level: 1 })).toBeVisible();
}

/**
 * Fills the record's own follow-up form, reviews it, and confirms the one task it describes.
 *
 * The task is dated `dueOn`, the civil day the Work surface calls today, so the work this creates is due on the day
 * the worker is looking at and the list that holds work due today therefore holds it. A due date is a plan the
 * worker keeps and never a promise of contact, so stating one changes nothing about what the follow-up proves.
 */
async function submitFollowUp(page: Page, dueOn: string): Promise<void> {
  await expect(page.getByRole("region", { name: FOLLOW_UP_SECTION })).toBeVisible();
  await page.getByLabel("What the task is for").fill(FOLLOW_UP_TITLE);
  await page.getByLabel("Due date").fill(dueOn);
  // The record carries the gift's own attribution into the task: the partner field is already the
  // reference this gift was attributed to, so the task names that partner without anyone retyping it,
  // and it stays editable rather than being silently pinned.
  await expect(page.getByLabel(PARTNER_FIELD_LABEL)).toHaveValue(PARTNER_REFERENCE);
  // The one review step is present, and the control that applies the change is the one it names.
  const review = page.getByRole("region", { name: REVIEW_TITLE });
  await expect(review).toBeVisible();
  await page.getByRole("button", { name: CONFIRM_LABEL }).click();
  // The durable receipt, not a toast: one outcome, in the place the worker returns to.
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]')).toBeVisible();
}

test("the gift's own record creates the follow-up task and names the partner it came from", async ({ page }) => {
  // The open work before the change: the title this journey creates is not in it, so finding it there
  // afterwards is evidence of the change rather than of the seed.
  const before = await readOpenWork(page);
  expect(titlesOf(before), "The task this journey creates does not exist before it is created.").not.toContain(FOLLOW_UP_TITLE);

  await openGiftFromLedger(page);

  // The record states the grain, the original gift date and the coverage it was read at rather than
  // presenting an amount on its own, which is what makes the figure below a fact about a source.
  const gift = await readGiftRecord(page);
  expect(gift.currency, "The source named the currency of this gift, and this file assumes none in its place.").toBe("USD");
  expect(gift.minorUnits, "A received gift is an amount the source recorded, so its minor units are a positive count.").toBeGreaterThan(0);
  expect(gift.provenance.length, "The record prints the source it came from as opaque references.").toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Basis, coverage and as-of" })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  await submitFollowUp(page, SEEDED_TODAY);
  await expect(page.getByRole("heading", { name: SAVED_HEADING })).toBeVisible();
  // One attempt, one receipt: the region is focusable and its polite status region carries the outcome,
  // so a repeated press cannot look like a second acceptance.
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"] [role="status"]')).toBeVisible();
  // The one review step this journey used reached its settled state; the development panel's own review
  // step is a different region and is not touched by this change.
  await expect(page.getByRole("region", { name: REVIEW_TITLE })).toHaveAttribute("data-state", "settled");

  // The task is open work dated the day the Work surface calls today, so the list that holds that work holds it
  // rather than filing it where a worker would not look for it — and a surface that called a different day today
  // would leave the list empty here instead of passing.
  await page.goto(`${WORK_HREF}?list=today&pageSize=${TASK_PAGE_SIZE}`);
  const todayList = page.getByRole("region", { name: `Today ${TASK_NOUN}, scrollable` });
  await expect(todayList, "Today is one of the five lists, and it is where work due today is read.").toBeVisible();
  await expect(todayList.getByRole("row", { name: FOLLOW_UP_TITLE }), `The task dated ${SEEDED_TODAY} is the work Today holds.`).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  // And it is the partner's open work too, because the gift attributed it to that partner reference.
  await page.goto(PARTNER_HREF);
  const openTasks = page.getByRole("region", { name: OPEN_TASKS_SECTION });
  await expect(openTasks).toBeVisible();
  await expect(openTasks.getByText(FOLLOW_UP_TITLE).first()).toBeVisible();
});

test("the task is the only thing the follow-up creates", async ({ page }) => {
  // The "before": every figure a gift could touch, read the way a worker reads it.
  const before = await readBaselines(page);
  expect(before.wholeResult.figures.length, "The default period states its received support in at least one currency, so there is a whole-result figure to compare.").toBeGreaterThan(0);
  expect(before.ledgerTotal, "The default period holds the gift this journey thanks the supporter for.").toBeGreaterThan(0);
  expect(before.commitmentTotal, "The source reports commitments, which no task may turn into a promise.").toBeGreaterThan(0);

  await openGiftFromLedger(page);
  const giftBefore = await readGiftRecord(page);
  await submitFollowUp(page, SEEDED_TODAY);

  // The record's own wording, on the surface that triggered the change: a message was not sent and an
  // obligation was not created. The comparisons below are what make that sentence checkable rather
  // than a claim about the interface.
  await expect(page.getByText(NO_MESSAGE_ON_TRIGGER)).toBeVisible();
  await expect(page.getByText(NOTHING_ELSE_ON_RESULT)).toBeVisible();
  // The same gift record, after the change: one row, its own amount and its own provenance references,
  // so no correction, refund or posting was written against it.
  expect(await readGiftRecord(page)).toEqual(giftBefore);

  // The "after": the same figures, read off the same surfaces and compared exactly.
  const after = await readBaselines(page);

  // Received support, per currency, in integer minor units and in gift count: a task moves no money.
  expect(after.wholeResult).toEqual(before.wholeResult);
  // The ledger's whole result still holds the same rows, so no gift, allocation or refund row appeared.
  expect(after.ledgerTotal).toBe(before.ledgerTotal);
  // No commitment appeared, so no promise or stewardship obligation was created.
  expect(after.commitmentTotal).toBe(before.commitmentTotal);
  // No message was submitted: the inbox states exactly the count and the outcome figures it stated before.
  expect(after.messages).toEqual(before.messages);
  // No membership changed state, so nothing was subscribed, confirmed or unsubscribed by the follow-up.
  expect(after.audience).toEqual(before.audience);
  // The partner's activity is untouched: a task is not contact, and creating one logged no interaction.
  expect(after.partnerActivity).toBe(before.partnerActivity);
  // Exactly one task was added to the open work, and it is this one.
  expect(titlesOf(after.openWork), "The open work holds every task it held and this one, and nothing else changed.").toEqual([...titlesOf(before.openWork), FOLLOW_UP_TITLE].sort());
  expect(after.openWork.total, "The four open lists count one task more than they counted before the follow-up.").toBe(before.openWork.total + 1);

  // The task carries the partner reference the gift was attributed to, so "it came from this gift" is a fact about
  // the record rather than a phrase in a title: the row's own link names the partner's own record.
  await page.goto(`${WORK_HREF}?list=today&pageSize=${TASK_PAGE_SIZE}`);
  const created = page.getByRole("region", { name: `Today ${TASK_NOUN}, scrollable` }).getByRole("row", { name: FOLLOW_UP_TITLE });
  await expect(created, "The task the follow-up created is open work due today.").toBeVisible();
  await expect(created.getByRole("link", { name: PARTNER_LABEL }), "The task the follow-up created names the partner the gift was attributed to.").toHaveAttribute("href", PARTNER_HREF);
});
