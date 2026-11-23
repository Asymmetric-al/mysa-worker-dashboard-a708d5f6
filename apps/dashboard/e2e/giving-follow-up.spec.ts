/** Criterion 8 — giving follow-up: a gift leads to one ordinary task, and to nothing else. */
import type { Locator, Page } from "@playwright/test";
import { expect, listTotalOf, test, type PersonaName } from "../playwright.config";
const PERSONA: PersonaName = "established-worker";
const GIFTS_HREF = "/support/gifts";
const WORK_HREF = "/work";
const PARTNER_HREF = "/partners/partner-jo-mbeki";
const GIFT_ROW_ID = "gift-row-harbour-0001";
const GIFT_ID = "gift-harbour-0001";
const PARTNER_REFERENCE = "partner-jo-mbeki"; // The partner the gift is attributed to, as an opaque reference: never a name, never an email.
const FOLLOW_UP_TITLE = "Thank Jo Mbeki for the November gift";
const TASK_NOUN = "tasks";
const OPEN_GIFT_LINK = `Open gift ${GIFT_ID}`;
const RECORD_HEADING = "Gift record";
const REVIEW_TITLE = "Review the follow-up task";
const PROVENANCE_SECTION = "Provenance";
const DEVELOPMENT_DATA_LABEL = "Development data";
const SEEDED_TODAY = "2026-11-20";
const TASK_PAGE_SIZE = "200";
const OPEN_TASK_LISTS: readonly { readonly key: string; readonly label: string; readonly emptyTitle: string }[] = [
  { key: "today", label: "Today", emptyTitle: "Nothing is due today" },
  { key: "upcoming", label: "Upcoming", emptyTitle: "Nothing is dated ahead" },
  { key: "overdue", label: "Overdue", emptyTitle: "Nothing is past its date" },
  { key: "undated", label: "Undated", emptyTitle: "No task is undated" },
];
const ROW_SELECTION = /^Select (?!all )/u;
const ROW_SELECTION_PREFIX = "Select ";
const PARTNER_LABEL = "Jo Mbeki";
const INBOX = { heading: "Synthetic inbox", outcomes: "Send outcomes recorded in this inbox", count: /^(?:([\d,]+)|One) messages? (?:have|has) been produced for this membership\.$/u } as const;
const AUDIENCE = { heading: "Update email audience", countsSlot: '[data-slot="membership-counts"]', memberNoun: "members" } as const;
type CurrencyFigure = { readonly currency: string; readonly minorUnits: number; readonly giftCount: number };
type WholeResult = { readonly figures: readonly CurrencyFigure[]; readonly text: string };
const AMOUNT_IN_FIGURE = /(-?\d[\d.,]*)\s+([A-Z]{3})\b/u;
const COUNT_IN_FIGURE = /and\s+([\d,]+)\s+gifts?\b/u;
function minorUnitsFrom(displayed: string): number {
  const stripped = displayed.replace(/\(incomplete\)/gu, "").trim();
  const negative = stripped.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? stripped.slice(1) : stripped).split(".");
  const integer = whole.replace(/,/gu, "");
  const digits = `${integer}${fraction}`;
  const units = Number(digits);
  if (!/^\d+$/u.test(digits) || !Number.isSafeInteger(units)) throw new Error(`The amount this surface displayed, ${JSON.stringify(displayed)}, is not one this file can read as an exact number of minor units. A figure that cannot be read exactly is not compared approximately.`);
  return negative ? -units : units;
}
async function readWholeResult(page: Page): Promise<WholeResult> {
  const rows = page.locator('[data-slot="whole-result-summary"] li'); // The figures the ledger's whole-result summary states, read from the text it renders.
  const stated = await rows.count();
  const figures: CurrencyFigure[] = [];
  const lines: string[] = [];
  for (let index = 0; index < stated; index += 1) {
    const text = (await rows.nth(index).innerText()).replace(/\s+/gu, " ").trim();
    lines.push(text);
    const amount = AMOUNT_IN_FIGURE.exec(text);
    const count = COUNT_IN_FIGURE.exec(text);
    if (amount === null || count === null) throw new Error(`The whole-result line ${JSON.stringify(text)} does not state an amount with its currency and a gift count, so this file cannot compare it. Every received-support figure is stated as "<amount> <currency> ... and N gifts".`);
    figures.push({ currency: amount[2] ?? "", minorUnits: minorUnitsFrom(amount[1] ?? ""), giftCount: Number((count[1] ?? "").replace(/,/gu, "")) });
  }
  return { figures, text: lines.join(" | ") };
}
interface GiftRecordFigure {
  readonly currency: string;
  readonly minorUnits: number;
  readonly provenance: readonly string[];
}
async function readGiftRecord(page: Page): Promise<GiftRecordFigure> {
  await expect(page.getByRole("heading", { name: RECORD_HEADING, level: 1 })).toBeVisible(); // The gift record's own figures: its amount and the references its provenance section prints.
  const row = page.locator(`[data-gift-row-id="${GIFT_ROW_ID}"]`);
  await expect(row).toBeVisible();
  const displayed = (await row.innerText()).replace(/\s+/gu, " ").trim();
  const amount = AMOUNT_IN_FIGURE.exec(displayed);
  if (amount === null) throw new Error(`The gift record states its amount as ${JSON.stringify(displayed)}, which names no amount and currency this file can read.`);
  const provenanceBlock = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: PROVENANCE_SECTION }) }); // The provenance block is the card titled with its own heading, so the references read here are that block's and not a reference some other part of the record happens to print.
  await expect(page.getByRole("heading", { name: PROVENANCE_SECTION })).toBeVisible();
  const provenance = (await provenanceBlock.locator("bdi").allInnerTexts()).map((value) => value.trim()).filter((value) => value !== "");
  return { currency: amount[2] ?? "", minorUnits: minorUnitsFrom(amount[1] ?? ""), provenance };
}
const squash = (text: string): string => text.replace(/\s+/gu, " ").trim(); // One statement as one comparable line: the whitespace a rendering happens to insert is not a fact.
type OpenWork = { readonly titles: readonly string[]; readonly total: number };
const titlesOf = (work: OpenWork): readonly string[] => work.titles;
type Messages = { readonly stated: number; readonly outcomes: string };
type Audience = { readonly counts: string; readonly members: number };
type Baselines = { readonly wholeResult: WholeResult; readonly ledgerTotal: number; readonly commitmentTotal: number; readonly openWork: OpenWork; readonly messages: Messages; readonly audience: Audience; readonly partnerActivity: number };
async function readOpenWork(page: Page): Promise<OpenWork> {
  const titles: string[] = []; // The work a person still has to do, as the four open lists state it: each list's counted pager states its whole result rather than one page, and a list that holds nothing says so in its own words.
  let total = 0;
  for (const list of OPEN_TASK_LISTS) {
    await page.goto(`${WORK_HREF}?list=${list.key}&pageSize=${TASK_PAGE_SIZE}`);
    await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The five lists are a destination of their own, reached from the shell.").toBeVisible();
    await expect(page.locator('[data-slot="work-task-lists"]'), `The ${list.label} list is the one the address names.`).toHaveAttribute("data-list", list.key);
    const region = page.getByRole("region", { name: `${list.label} ${TASK_NOUN}, scrollable` });
    await expect(region.or(page.getByRole("heading", { name: list.emptyTitle })), `The ${list.label} list states its rows, or says in its own words that it holds none.`).toBeVisible();
    if ((await region.count()) === 0) continue; // The list holds nothing, and that is a figure of zero rather than an unreadable page.
    total += await listTotalOf(page, "tasks");
    titles.push(...(await statedTitles(region)));
  }
  return { titles: titles.sort(), total };
}
async function statedTitles(region: Locator): Promise<readonly string[]> {
  const rows = region.getByRole("checkbox", { name: ROW_SELECTION }); // Every title a list shows, as each row's own selection control names the task it selects.
  await expect(rows.first(), "The list states at least one row, so the work it counts is work it shows.").toBeVisible();
  const labels = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels.filter((label) => label.startsWith(ROW_SELECTION_PREFIX)).map((label) => label.slice(ROW_SELECTION_PREFIX.length));
}
async function readMessages(page: Page): Promise<Messages> {
  await page.goto("/communication/inbox"); // The inbox's own statements: the messages it has produced for this membership, and the outcome counts beside them.
  await expect(page.getByRole("heading", { name: INBOX.heading, level: 1 }), "The synthetic inbox is a destination of its own, reached from the shell.").toBeVisible();
  const sentence = page.getByText(INBOX.count).first();
  await expect(sentence, "The inbox states how many messages this membership's purpose has produced, as its whole result rather than the rows on one page.").toBeVisible();
  const match = INBOX.count.exec(squash(await sentence.innerText()));
  if (match === null) throw new Error(`The inbox states its whole result, and it read ${JSON.stringify(await sentence.innerText())} instead. A count that cannot be read here would leave the inbox unchecked.`);
  const stated = match[1] === undefined ? 1 : Number((match[1] ?? "").replace(/,/gu, ""));
  if (!Number.isSafeInteger(stated)) throw new Error(`The inbox count ${JSON.stringify(match[1])} is not a whole number of messages.`);
  const outcomes = page.getByRole("list", { name: INBOX.outcomes });
  await expect(outcomes, "The inbox states how each recorded send outcome counts.").toBeVisible();
  return { stated, outcomes: squash(await outcomes.innerText()) };
}
async function readAudience(page: Page): Promise<Audience> {
  await page.goto("/communication/audience"); // The audience's own statements: the counts panel as one comparable text, and the whole membership count.
  await expect(page.getByRole("heading", { name: AUDIENCE.heading, level: 1 }), "The publisher's audience is a destination of its own, reached from the shell.").toBeVisible();
  const counts = page.locator(AUDIENCE.countsSlot);
  await expect(counts, "The audience states its eligible and excluded figures, the four membership states and every exclusion reason.").toBeVisible();
  return { counts: squash((await counts.textContent()) ?? ""), members: await listTotalOf(page, AUDIENCE.memberNoun) };
}
async function readBaselines(page: Page): Promise<Baselines> {
  await page.goto(GIFTS_HREF);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const wholeResult = await readWholeResult(page);
  const ledgerTotal = await listTotalOf(page, "gifts");
  await page.goto("/support/commitments");
  await expect(page.getByRole("heading", { name: "Commitments", level: 1 })).toBeVisible();
  const commitmentTotal = await listTotalOf(page, "commitments");
  await page.goto(PARTNER_HREF);
  const activity = page.getByRole("region", { name: "Actual activity" });
  await expect(activity).toBeVisible();
  const partnerActivity = await activity.getByRole("listitem").count();
  return { wholeResult, ledgerTotal, commitmentTotal, openWork: await readOpenWork(page), messages: await readMessages(page), audience: await readAudience(page), partnerActivity };
}
test.use({ persona: PERSONA }); // This file acts as the established worker throughout, which is the persona the runner admits the context as.
async function openGiftFromLedger(page: Page): Promise<void> {
  await page.goto(GIFTS_HREF); // Opens the ledger and follows the row's own link to the gift record, which is the only route to it.
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const giftLink = page.getByRole("link", { name: OPEN_GIFT_LINK });
  await expect(giftLink).toBeVisible();
  await giftLink.click();
  await expect(page.getByRole("heading", { name: RECORD_HEADING, level: 1 })).toBeVisible();
}
async function submitFollowUp(page: Page, dueOn: string): Promise<void> {
  await expect(page.getByRole("region", { name: "Follow up on this gift" })).toBeVisible(); // Fills the record's own follow-up form, reviews it, and confirms the one task it describes.
  await page.getByLabel("What the task is for").fill(FOLLOW_UP_TITLE);
  await page.getByLabel("Due date").fill(dueOn);
  await expect(page.getByLabel("Partner reference")).toHaveValue(PARTNER_REFERENCE);
  await expect(page.getByRole("region", { name: REVIEW_TITLE })).toBeVisible();
  await page.getByRole("button", { name: "Create a thank-you task" }).click();
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]')).toBeVisible();
}
test("the gift's own record creates the follow-up task and names the partner it came from", async ({ page }) => {
  const before = await readOpenWork(page); // The open work before the change: the title this journey creates is not in it, so finding it there afterwards is evidence of the change rather than of the seed.
  expect(titlesOf(before), "The task this journey creates does not exist before it is created.").not.toContain(FOLLOW_UP_TITLE);
  await openGiftFromLedger(page);
  const gift = await readGiftRecord(page); // The record states the grain, the original gift date and the coverage it was read at rather than presenting an amount on its own, which is what makes the figure below a fact about a source.
  expect(gift.currency, "The source named the currency of this gift, and this file assumes none in its place.").toBe("USD");
  expect(gift.minorUnits, "A received gift is an amount the source recorded, so its minor units are a positive count.").toBeGreaterThan(0);
  expect(gift.provenance.length, "The record prints the source it came from as opaque references.").toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Basis, coverage and as-of" })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  await submitFollowUp(page, SEEDED_TODAY);
  await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"] [role="status"]')).toBeVisible();
  await expect(page.getByRole("region", { name: REVIEW_TITLE })).toHaveAttribute("data-state", "settled");
  await page.goto(`${WORK_HREF}?list=today&pageSize=${TASK_PAGE_SIZE}`);
  const todayList = page.getByRole("region", { name: `Today ${TASK_NOUN}, scrollable` });
  await expect(todayList, "Today is one of the five lists, and it is where work due today is read.").toBeVisible();
  await expect(todayList.getByRole("row", { name: FOLLOW_UP_TITLE }), `The task dated ${SEEDED_TODAY} is the work Today holds.`).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  await page.goto(PARTNER_HREF);
  const openTasks = page.getByRole("region", { name: "Open tasks" });
  await expect(openTasks).toBeVisible();
  await expect(openTasks.getByText(FOLLOW_UP_TITLE).first()).toBeVisible();
});
test("the task is the only thing the follow-up creates", async ({ page }) => {
  const before = await readBaselines(page);
  expect(before.wholeResult.figures.length, "The default period states its received support in at least one currency, so there is a whole-result figure to compare.").toBeGreaterThan(0);
  expect(before.ledgerTotal, "The default period holds the gift this journey thanks the supporter for.").toBeGreaterThan(0);
  expect(before.commitmentTotal, "The source reports commitments, which no task may turn into a promise.").toBeGreaterThan(0);
  await openGiftFromLedger(page);
  const giftBefore = await readGiftRecord(page);
  await submitFollowUp(page, SEEDED_TODAY);
  await expect(page.getByText(/sends no message and creates no stewardship obligation/u)).toBeVisible();
  await expect(page.getByText(/no message was sent and no obligation was created/u)).toBeVisible();
  expect(await readGiftRecord(page)).toEqual(giftBefore);
  const after = await readBaselines(page);
  expect(after.wholeResult).toEqual(before.wholeResult);
  expect(after.ledgerTotal).toBe(before.ledgerTotal);
  expect(after.commitmentTotal).toBe(before.commitmentTotal);
  expect(after.messages).toEqual(before.messages);
  expect(after.audience).toEqual(before.audience);
  expect(after.partnerActivity).toBe(before.partnerActivity);
  expect(titlesOf(after.openWork), "The open work holds every task it held and this one, and nothing else changed.").toEqual([...titlesOf(before.openWork), FOLLOW_UP_TITLE].sort());
  expect(after.openWork.total, "The four open lists count one task more than they counted before the follow-up.").toBe(before.openWork.total + 1);
  await page.goto(`${WORK_HREF}?list=today&pageSize=${TASK_PAGE_SIZE}`); // The task carries the partner reference the gift was attributed to, so "it came from this gift" is a fact about the record rather than a phrase in a title: the row's own link names the partner's own record.
  const created = page.getByRole("region", { name: `Today ${TASK_NOUN}, scrollable` }).getByRole("row", { name: FOLLOW_UP_TITLE });
  await expect(created, "The task the follow-up created is open work due today.").toBeVisible();
  await expect(created.getByRole("link", { name: PARTNER_LABEL }), "The task the follow-up created names the partner the gift was attributed to.").toHaveAttribute("href", PARTNER_HREF);
});
