/**
 * Criterion 8 — giving follow-up: a gift leads to one ordinary task, and to nothing else.
 *
 * The journey this file walks, from the deterministic seed as the established worker: read the
 * received-support figures, the ledger's whole-result count, the commitment rows, the open work, the
 * delivered messages and the audience, open one gift from the ledger, use the gift record's own action
 * to create a thank-you task, and then read every one of those figures again.
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
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, resetSeed, SEEDED_PERSONAS, SESSION_COOKIE, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded scenario this file acts in
// ---------------------------------------------------------------------------------------------

/**
 * The seeded identity every browser request below is authorised as.
 *
 * The established worker holds years of received support, recurring commitments, partners and open work
 * across two ministries, so a gift, a commitment and a task all exist before this file does anything:
 * the baseline of "before" is a world that already holds figures, and an unchanged figure therefore
 * means something.
 */
const PERSONA: PersonaName = "established-worker";

/** The established worker's seeded session, mirrored from the roster rather than hard-coded. */
const SESSION = SEEDED_PERSONAS[PERSONA];

/** The destinations this journey reads. */
const GIFTS_HREF = "/support/gifts";
const COMMITMENTS_HREF = "/support/commitments";
const WORK_HREF = "/work";
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
 * The display time zone the task read is asked for.
 *
 * The Work read requires one rather than assuming it, because every date it returns is judged in the
 * zone the reader chose. This file states the seed's own source zone, so the count it reads back is the
 * count the Work surface renders.
 */
const DISPLAY_TIME_ZONE = "Europe/London";

/** The list the task read is asked for: every task, which is then narrowed to the open ones here. */
const TASK_LIST = "all";

/** The page size that keeps this workload on one page, so a count read here is the whole result. */
const TASK_PAGE_SIZE = "200";

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

/** One task the read states, as the two facts this journey compares it by. */
interface TaskRow {
  readonly title: string;
  /** The partner record the task is about, or an empty string for a task that names none. */
  readonly partnerId: string;
}

/**
 * The open work the task read states, and the civil day it judges "today" by in the zone asked for.
 */
interface OpenWork {
  readonly open: readonly TaskRow[];
  /** The day the Work surface opens on, taken from the read rather than computed here. */
  readonly today: string;
}

/** The titles of the open work, in one order two reads can be compared by. */
function titlesOf(work: OpenWork): readonly string[] {
  return work.open.map((row) => row.title).sort();
}

/** What the synthetic inbox holds: one message per recipient and notification intent. */
interface Messages {
  readonly messages: number;
  readonly intents: number;
}

/** What the publisher's audience holds, so a subscription nobody consented to cannot pass unnoticed. */
interface Audience {
  readonly total: number;
  readonly eligible: number;
  readonly excluded: number;
  readonly states: string;
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

// ---------------------------------------------------------------------------------------------
// Reading the application's own authorised projections
// ---------------------------------------------------------------------------------------------

/** The one identity header every request below carries: the session cookie the service authorises. */
function authorisationHeader(): Readonly<Record<string, string>> {
  return { cookie: `${SESSION_COOKIE}=${SESSION.sessionId}` };
}

function recordOf(value: unknown, subject: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${subject} is not the read envelope this file expects, so nothing is compared against it.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function arrayOf(value: unknown, subject: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${subject} is not a list, so the count this file reads from it cannot be trusted.`);
  }
  return value;
}

function numberOf(value: unknown, subject: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${subject} is not a whole number, so no count is read from it.`);
  }
  return value;
}

function textOf(value: unknown, subject: string): string {
  if (typeof value !== "string") {
    throw new Error(`${subject} is not text, so nothing is compared against it.`);
  }
  return value;
}

/**
 * Reads one of the application's own browser-facing reads and returns its envelope.
 *
 * These are the same named reads the surfaces render — the Work list's task read, the synthetic inbox
 * and the publisher's audience — reached over the handler the browser itself uses, with the session
 * cookie this file would otherwise carry through the browser. Nothing here opens the synthetic store:
 * a count that could not be read through the application would be a count this file does not know.
 */
async function readEnvelope(request: APIRequestContext, path: string): Promise<Readonly<Record<string, unknown>>> {
  const response = await request.get(path, { headers: authorisationHeader() });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok()) {
    throw new Error(`The read ${path} answered HTTP ${String(response.status())}: ${JSON.stringify(body).slice(0, 400)}. A baseline this file cannot read is not a baseline it can compare.`);
  }
  return recordOf(body, `The read ${path}`);
}

/** The open work the task read states: every task the seeded world holds, narrowed to the ones still open. */
async function readOpenWork(request: APIRequestContext): Promise<OpenWork> {
  const envelope = await readEnvelope(request, `/api/tasks?displayTimeZone=${encodeURIComponent(DISPLAY_TIME_ZONE)}&filter=${TASK_LIST}&pageSize=${TASK_PAGE_SIZE}`);
  const data = recordOf(envelope["data"], "The task read's data");
  const tasks = arrayOf(data["tasks"], "The task read's tasks");
  const open: TaskRow[] = [];
  for (const task of tasks) {
    const record = recordOf(task, "One row of the task read");
    const status = textOf(record["status"], "A task's status");
    // A completed or cancelled task is closed work, and a reopened one is open again: the count this
    // file compares is the work a person still has to do.
    if (status === "completed" || status === "cancelled") {
      continue;
    }
    const partnerId = record["partnerId"];
    open.push({ title: textOf(record["title"], "A task's title"), partnerId: typeof partnerId === "string" ? partnerId : "" });
  }
  // The read states the civil day it judges "today" by, so the task this journey creates can be dated
  // the day the Work surface opens on without this file computing a date of its own.
  return { open, today: textOf(data["today"], "The task read's today") };
}

/** The messages the reader's synthetic inbox holds. */
async function readMessages(request: APIRequestContext): Promise<Messages> {
  const envelope = await readEnvelope(request, "/api/inbox");
  const data = recordOf(envelope["data"], "The inbox read's data");
  return { messages: arrayOf(data["messages"], "The inbox read's messages").length, intents: numberOf(data["intentCount"], "The inbox read's notification-intent count") };
}

/** The publisher's audience, in the states the read counts it. */
async function readAudience(request: APIRequestContext): Promise<Audience> {
  const envelope = await readEnvelope(request, "/api/audience");
  const data = recordOf(envelope["data"], "The audience read's data");
  const counts = recordOf(data["counts"], "The audience read's counts");
  const states = recordOf(data["memberStates"], "The audience read's membership states");
  const ordered = Object.keys(states)
    .sort()
    .map((state) => `${state}=${String(numberOf(states[state], `The ${state} membership count`))}`);
  return { total: numberOf(counts["total"], "The audience's total"), eligible: numberOf(counts["eligible"], "The audience's eligible count"), excluded: numberOf(counts["excluded"], "The audience's excluded count"), states: ordered.join(",") };
}

/**
 * Everything this journey compares, read from the surfaces a worker reads it from.
 *
 * The support figures, the ledger count, the commitment count and the partner's own activity are read
 * from the pages that state them; the task, inbox and audience counts are read from the same named reads
 * those pages render, because the three of them are figures rather than a presentation to inspect.
 */
async function readBaselines(page: Page, request: APIRequestContext): Promise<Baselines> {
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
  return { wholeResult, ledgerTotal, commitmentTotal, openWork: await readOpenWork(request), messages: await readMessages(request), audience: await readAudience(request), partnerActivity };
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
 * The task is dated `dueOn`: the civil day the task read states as today, so the work this creates is due
 * on the day the worker is looking at and the Work surface's own opening list therefore holds it. A due
 * date is a plan the worker keeps and never a promise of contact, so stating one changes nothing about
 * what the follow-up proves.
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

test("the gift's own record creates the follow-up task and names the partner it came from", async ({ page, request }) => {
  // The open work before the change: the title this journey creates is not in it, so finding it there
  // afterwards is evidence of the change rather than of the seed.
  const before = await readOpenWork(request);
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

  await submitFollowUp(page, before.today);
  await expect(page.getByRole("heading", { name: SAVED_HEADING })).toBeVisible();
  // One attempt, one receipt: the region is focusable and its polite status region carries the outcome,
  // so a repeated press cannot look like a second acceptance.
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"] [role="status"]')).toBeVisible();
  // The one review step this journey used reached its settled state; the development panel's own review
  // step is a different region and is not touched by this change.
  await expect(page.getByRole("region", { name: REVIEW_TITLE })).toHaveAttribute("data-state", "settled");

  // The task is open work in Work, dated the day the task read called today, so the list the Work
  // surface opens on holds it rather than filing it where a worker would not look for it.
  await page.goto(WORK_HREF);
  await expect(page.getByText(FOLLOW_UP_TITLE, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  // And it is the partner's open work too, because the gift attributed it to that partner reference.
  await page.goto(PARTNER_HREF);
  const openTasks = page.getByRole("region", { name: OPEN_TASKS_SECTION });
  await expect(openTasks).toBeVisible();
  await expect(openTasks.getByText(FOLLOW_UP_TITLE).first()).toBeVisible();
});

test("the task is the only thing the follow-up creates", async ({ page, request }) => {
  // The "before": every figure a gift could touch, read the way a worker reads it.
  const before = await readBaselines(page, request);
  expect(before.wholeResult.figures.length, "The default period states its received support in at least one currency, so there is a whole-result figure to compare.").toBeGreaterThan(0);
  expect(before.ledgerTotal, "The default period holds the gift this journey thanks the supporter for.").toBeGreaterThan(0);
  expect(before.commitmentTotal, "The source reports commitments, which no task may turn into a promise.").toBeGreaterThan(0);

  await openGiftFromLedger(page);
  const giftBefore = await readGiftRecord(page);
  await submitFollowUp(page, before.openWork.today);

  // The record's own wording, on the surface that triggered the change: a message was not sent and an
  // obligation was not created. The comparisons below are what make that sentence checkable rather
  // than a claim about the interface.
  await expect(page.getByText(NO_MESSAGE_ON_TRIGGER)).toBeVisible();
  await expect(page.getByText(NOTHING_ELSE_ON_RESULT)).toBeVisible();
  // The same gift record, after the change: one row, its own amount and its own provenance references,
  // so no correction, refund or posting was written against it.
  expect(await readGiftRecord(page)).toEqual(giftBefore);

  // The "after": the same reads, compared exactly.
  const after = await readBaselines(page, request);

  // Received support, per currency, in integer minor units and in gift count: a task moves no money.
  expect(after.wholeResult).toEqual(before.wholeResult);
  // The ledger's whole result still holds the same rows, so no gift, allocation or refund row appeared.
  expect(after.ledgerTotal).toBe(before.ledgerTotal);
  // No commitment appeared, so no promise or stewardship obligation was created.
  expect(after.commitmentTotal).toBe(before.commitmentTotal);
  // No message was submitted: the inbox holds exactly what it held, per recipient and per intent.
  expect(after.messages).toEqual(before.messages);
  // No membership changed state, so nothing was subscribed, confirmed or unsubscribed by the follow-up.
  expect(after.audience).toEqual(before.audience);
  // The partner's activity is untouched: a task is not contact, and creating one logged no interaction.
  expect(after.partnerActivity).toBe(before.partnerActivity);
  // Exactly one task was added to the open work, and it is this one.
  expect(titlesOf(after.openWork)).toEqual([...titlesOf(before.openWork), FOLLOW_UP_TITLE].sort());
  expect(after.openWork.open.length).toBe(before.openWork.open.length + 1);
  // The task carries the partner reference the gift was attributed to, so "it came from this gift" is a
  // fact about the record rather than a phrase in a title.
  const created = after.openWork.open.find((row) => row.title === FOLLOW_UP_TITLE);
  expect(created?.partnerId, "The task the follow-up created names the partner the gift was attributed to.").toBe(PARTNER_REFERENCE);
});
