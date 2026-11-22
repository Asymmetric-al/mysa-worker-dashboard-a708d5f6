/**
 * Criterion 5 — daily follow-through: the work a day asks for, followed through, and never claimed as more.
 *
 * The journey, from the deterministic seed as the established worker: read the five task lists and the dated
 * agenda, give the day the one task the seed deliberately leaves it without, complete that task, watch it
 * leave Today, reopen it, change a seeded task's free-text category, and then read back the four things a
 * completed task must never be taken to prove — that a planned meeting was held, that a partner was
 * contacted, that an activity record exists, and that a selection became an audience.
 *
 * **Why this file creates the task Today holds.** The seed's clock stands at `SEED_INSTANT`
 * (2026-11-20), and every seeded task is dated away from that day, so Today opens empty on purpose: the
 * empty list is a state this file reads as the seed's own, and the work the criterion follows through is
 * the work a worker actually creates. The task is dated that seeded civil day, named once at `SEEDED_TODAY`
 * because no surface states the day itself — the development panel states the instant and the Work page states the
 * zone it judges in — and the Today list is the assertion that proves the surface still calls that day today.
 *
 * **Where every figure comes from.** Each count and each row fact below is read off the page that states it: the
 * five lists' counted pagers and the rows they render, the dated agenda's own pager, the receipt a change leaves
 * behind, the partner record's activity region and the audience's counts panel. The one exception is a partner's
 * tags, which no surface the journey visits states; that single record read is named where it is made.
 *
 * **The seeded scenario this file asserts against** (AAP 0.7.2's readable seed): an established worker
 * with tasks due ahead, tasks past their date, one undated task, one completed task, one reopened task, a
 * meeting-type task carrying a planned time *and* the zone it is stated in, and partners whose records
 * carry interaction history. Today holds nothing until this file adds one task to it.
 *
 * **What each assertion is for.** A task is work the worker owns: it needs only a title, its optional
 * category is the worker's own short label, a planned time is a plan rather than a held meeting, and
 * completing it records that the work was closed and says nothing about contact, payment, a promise or a
 * message (AAP 0.8.2). So the outcome proven here is never "the row was saved" alone: it is that the row
 * was saved *and* nothing else moved — no interaction was logged, no commitment appeared, no membership
 * changed, and no partner gained a tag. That is why each comparison below is exact rather than sampled.
 *
 * **Two list contexts.** Filters, sort and the reader's place in a long result are part of the view (AAP 0.7.1's
 * continuity requirement), so they are read before a record visit and again after the return, on the Work list and
 * on the dated agenda — the two lists this file drives. The visit itself lands on the partner's own record, reached
 * from the work row that names it, and that record's own breadcrumb is what the return comes back through.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, resetSeed, SEEDED_PERSONAS, SESSION_COOKIE, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded scenario this file acts in
// ---------------------------------------------------------------------------------------------

/**
 * The seeded identity every page below is read as, and the one record request it makes.
 *
 * The established worker holds open work dated ahead, work past its date, undated work, a completed task,
 * a reopened task, a meeting with a planned time and partners with recorded activity — which is what
 * makes "before" a world that already holds figures, and an unchanged figure therefore mean something.
 */
const PERSONA: PersonaName = "established-worker";

/** The established worker's seeded session, mirrored from the runner's roster rather than hard-coded. */
const SESSION = SEEDED_PERSONAS[PERSONA];

/** The two list destinations this journey drives: the five lists, and the dated agenda one level beside them. */
const WORK_HREF = "/work";
const AGENDA_HREF = "/work/agenda";

/** The prefix every partner record is served under, from the opaque identifier and never from a name. */
const PARTNER_ROUTE_PREFIX = "/partners";

/** The one record read that no surface states: a partner's own tags, which the partner's record page does not render. */
const PARTNER_API_PREFIX = "/api/partners";

/** The publisher's audience, which a selection must never become. */
const AUDIENCE_HREF = "/communication/audience";

/**
 * The zone the seeded planned meeting is stated in.
 *
 * A meeting's plan is stated with the zone it was given in, and the seeded meeting was planned in this one; the
 * Work lists judge their dates in the zone the page itself states, which is the read's own default.
 */
const PLANNED_MEETING_ZONE = "Europe/London";

/**
 * The civil day the Work surface calls today.
 *
 * The deterministic seed's scenario instant is `2026-11-20T00:00:00Z`, and the Work page states that every date it
 * judges is judged in UTC, so the instant falls on this civil day there. No surface states the day itself — the
 * development panel states the instant and the page states the zone — which is why the day is named once here. The
 * Today list is what proves it: the task this file dates with it must appear there, so the two cannot part without
 * this file failing rather than passing quietly.
 */
const SEEDED_TODAY = "2026-11-20";

/** The noun the Work surface counts its rows in, the heading of the column it orders by title, and the labels its pager states. */
const TASK_NOUN = "tasks";
const TITLE_COLUMN_LABEL = "Task";
const ROWS_PER_PAGE_LABEL = "Rows per page";
const PAGE_SIZE_DEFAULT = "50";

/** The window the dated agenda pages at, which is the documented cap rather than the lists' default. */
const AGENDA_PAGE_SIZE = "200";

/** A civil day as a row prints it, and the words a row prints when it stands at no day at all. */
const STATES_A_CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const UNDATED_WORD = "No due date";

/** The prefix a row's own selection control names the task it selects with, and the header control it is told apart from. */
const ROW_SELECTION = /^Select (?!all )/u;

/** The label the durable receipt states a revision under. */
const REVISION_LABEL = "Revision";

/** What the audience states its figures with, as its own copy words them. */
const AUDIENCE_HEADING = "Update email audience";
const AUDIENCE_COUNTS_SLOT = '[data-slot="membership-counts"]';
const MEMBER_NOUN = "members";

/** The persistent label the shell renders on every surface, so no screen can be mistaken for production. */
const DEVELOPMENT_DATA_LABEL = "Development data";

/** The five lists, in the order the Work surface's switcher offers them, with the words it names them by. */
const TASK_LISTS: readonly { readonly key: TaskListKey; readonly label: string }[] = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "all", label: "All" },
  { key: "undated", label: "Undated" },
];

type TaskListKey = "today" | "upcoming" | "overdue" | "all" | "undated";

/**
 * The three lists that hold dated open work, which is exactly the work the dated agenda groups.
 *
 * The read partitions open work by the day a task stands at: these three hold the open work that carries a date,
 * `undated` holds the open work that carries none, and `all` is the one list that also holds closed work.
 */
const DATED_LIST_KEYS: readonly TaskListKey[] = ["today", "upcoming", "overdue"];

/** The task this journey creates, and the free-text category it gives that task. */
const TODAY_TASK_TITLE = "Confirm the students' evening venue";
const TODAY_TASK_CATEGORY = "Venue";

/** A seeded task linked to a partner whose record carries activity, and the category this file changes. */
const LINKED_TASK_TITLE = "Follow up with Jo after the visit";
const LINKED_TASK_CATEGORY = "Care";
const CHANGED_TASK_CATEGORY = "Visit follow-up";
const LINKED_PARTNER = "partner-jo-mbeki";

/** The seeded meeting: a plan with a clock time and the zone it is stated in — and no evidence that it happened. */
const MEETING_TASK_TITLE = "Talk terms with Grace";
const MEETING_TASK_DATE = "2026-11-26";
const MEETING_TASK_TIME = "14:30";
const MEETING_PARTNER = "partner-grace-adeyemi";

/** Two seeded tasks this file reads back by name: one past its date, one already completed. */
const OVERDUE_TASK_TITLE = "Send the thank-you note";
const OVERDUE_TASK_DATE = "2026-11-10";
const COMPLETED_TASK_TITLE = "Introduce Grace to the students' group";

/** The seeded task with no date at all: it belongs to no dated group, and no day is invented for it. */
const UNDATED_TASK_TITLE = "Pray for the students' exam week";

/** The three bulk actions' own words, and the two values this file's bulk run puts into them. */
const PRIVATE_TAG_INTENT = "Private tag";
const APPLY_TAG_LABEL = "Apply a private tag";
const REMOVE_TAG_LABEL = "Remove a private tag";
const FOLLOW_UP_INTENT = "Create follow-up tasks";
const COMPLETE_INTENT = "Complete these tasks";
const PRIVATE_TAG_FIELD = "Private tag";
const BULK_TAG = "venue-chased";
const BULK_FOLLOW_UP_TITLE = "Chase the venue hire agreement";
const REVIEW_HEADING = "Review this bulk action";
const REVIEW_CONFIRM_LABEL = "Apply to the selected rows";

/** The statements the surfaces make about what completing, planning and tagging do and do not mean. */
const COMPLETION_MEANS_NOTHING = "Completing or reopening a task records no contact, payment, fulfilment or message.";
const PLANNED_VERSUS_HELD = "A planned time is a plan, and a meeting counts as held only once an interaction records that it happened.";
const CLOSED_ROW_REASON = "A task is completed only while it is open or reopened, so a row that is already completed or cancelled is left as it is.";

/** The record-detail regions a partner's own measure surfaces are read from. */
const ACTIVITY_SECTION = "Actual activity";
const OPEN_TASKS_SECTION = "Open tasks";

/** The receipt headings the shared outcome component states, which are read rather than restated as a toast. */
const SAVED_HEADING = "Saved";
const NOTHING_TO_CHANGE_HEADING = "Nothing to change";
const PER_ITEM_HEADING = "Result for each row";
const PER_ITEM_ACCEPTED = "Accepted";

/** The composer's labels and its two commit controls, exactly as the one task form states them. */
const NEW_TASK_LABEL = "New task";
const EDIT_TASK_HEADING = "Edit this task";
const TITLE_LABEL = "Title";
const CATEGORY_LABEL = "Category";
const DUE_DATE_LABEL = "Due date";
const CREATE_LABEL = "Create task";
const SAVE_LABEL = "Save task";
const DONE_LABEL = "Done";

/**
 * The whole-result line a paged list states, e.g. `Showing 1–6 of 6 tasks`.
 *
 * The dash is an en dash, and the noun is the list's own, so a count read here is the count the surface
 * states rather than the count of rows one page happens to hold.
 */
const SHOWING_LINE = /^Showing\s+([\d,]+)\u2013([\d,]+)\s+of\s+([\d,]+)\s+(\S+)$/u;

/** How much of an unreadable answer a failure quotes, so a diagnostic is readable without pasting a whole body. */
const DETAIL_LIMIT = 400;

/** A count as the surface prints it: grouped thousands, read back as a whole number. */
function countOf(stated: string, subject: string): number {
  const value = Number(stated.replace(/,/gu, ""));
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${subject} is not a whole count, so nothing is compared against it: ${JSON.stringify(stated)}.`);
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Reading a record, a row, a receipt and a count
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

/**
 * Reads one record this journey needs a field set from that no surface states.
 *
 * The one fact read this way is a partner's own tags. The partner's record page states no tags — the section that
 * would ("Tags on this record") is mounted by no route — and the roster's tag column is rendered inside a row whose
 * open-task figures move in this very test, so the fact is read from the record the browser itself asks for with the
 * session cookie it would otherwise carry. Every other figure in this file is read off the page that states it.
 */
async function readEnvelope(request: APIRequestContext, path: string): Promise<Readonly<Record<string, unknown>>> {
  const response = await request.get(path, { headers: authorisationHeader() });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = undefined;
  }
  if (!response.ok()) {
    throw new Error(`The read ${path} answered HTTP ${String(response.status())}: ${text.slice(0, DETAIL_LIMIT)}. A figure this file cannot read is not a figure it can compare.`);
  }
  if (body === undefined) {
    throw new Error(`The read ${path} answered HTTP ${String(response.status())} with a body this file cannot read as JSON: ${text.slice(0, DETAIL_LIMIT)}.`);
  }
  return recordOf(body, `The read ${path}`);
}

/** One task as the Work list states it: the task its own actions act on, the status it holds and the day it stands at. */
interface TaskReading {
  readonly taskId: string;
  readonly status: string;
  readonly dueOn: string | null;
}

/**
 * One row as the list renders it, read off the row itself.
 *
 * The row states the task its own actions act on and the status those actions left it in, and it prints the civil
 * day it stands at — or says it has none. The revision no surface states here is read from the receipt a change
 * leaves behind instead, below.
 */
async function readTaskRow(region: Locator, title: string): Promise<TaskReading> {
  const row = rowOf(region, title);
  await expect(row, `The list states the ${JSON.stringify(title)} task, which is what this comparison is about.`).toBeVisible();
  const actions = row.locator('[data-slot="task-actions"]');
  const taskId = await actions.getAttribute("data-task-id");
  const status = await actions.getAttribute("data-status");
  if (taskId === null || status === null) {
    throw new Error(`The row the list renders for ${JSON.stringify(title)} states no task of its own, so nothing is compared against it.`);
  }
  const day = row.getByText(STATES_A_CIVIL_DAY);
  if ((await day.count()) === 0) {
    // Undated work states that it has no date, which is a fact of its own rather than a date this file fills in.
    await expect(row.getByText(UNDATED_WORD, { exact: true }), `The row for ${JSON.stringify(title)} states the day it stands at, or says it holds none.`).toBeVisible();
    return { taskId, status, dueOn: null };
  }
  return { taskId, status, dueOn: (await day.first().innerText()).trim() };
}

/**
 * The revision a durable receipt states: the revision the record the receipt's change produced now stands at.
 *
 * A revision is stated nowhere else — the row, the list and the composer state the record's own facts but not the
 * revision they present — so the receipt is where this file reads it, and two receipts from two accepted changes are
 * what prove that a change advances it.
 */
async function readReceiptRevision(receipt: Locator): Promise<string> {
  const fact = receipt.locator("dl > div").filter({ has: receipt.page().getByText(REVISION_LABEL, { exact: true }) });
  const stated = fact.locator("bdi");
  await expect(stated, "The receipt states the revision the record it changed now stands at.").toBeVisible();
  return (await stated.innerText()).trim();
}

/**
 * What the publisher's audience states: every figure its counts panel carries — the eligible and excluded totals,
 * each of the four membership states and each exclusion reason — and the whole membership count its pager states.
 *
 * A membership that was added, confirmed, restricted, excluded or switched off moves one of these figures, so a
 * selection that became an audience cannot pass unnoticed.
 */
interface Audience {
  readonly counts: string;
  readonly members: number;
}

/** The audience's own statements, read off the page that carries them. */
async function readAudience(page: Page): Promise<Audience> {
  await page.goto(AUDIENCE_HREF);
  await expect(page.getByRole("heading", { name: AUDIENCE_HEADING, level: 1 }), "The publisher's audience is a destination of its own, reached from the shell.").toBeVisible();
  const counts = page.locator(AUDIENCE_COUNTS_SLOT);
  await expect(counts, "The audience states its eligible and excluded figures, the four membership states and every exclusion reason.").toBeVisible();
  const members = await readPager(page);
  expect(members.itemNoun, "The audience counts its memberships in its own noun.").toBe(MEMBER_NOUN);
  return { counts: (await counts.textContent())?.replace(/\s+/gu, " ").trim() ?? "", members: members.total };
}

// ---------------------------------------------------------------------------------------------
// Reading the surfaces a worker reads
// ---------------------------------------------------------------------------------------------

/** The one table pattern's region for one list: named by the list, and the only horizontal scroll port. */
function taskRegion(page: Page, label: string): Locator {
  return page.getByRole("region", { name: `${label} ${TASK_NOUN}, scrollable` });
}

/** The dated agenda's region: the same table pattern, under the agenda's own name. */
function agendaRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Dated agenda, scrollable" });
}

/** The whole-result line the visible pager states, as one comparable sentence. */
async function readPager(page: Page): Promise<{ readonly first: number; readonly last: number; readonly total: number; readonly itemNoun: string; readonly text: string }> {
  const stated = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  const match = SHOWING_LINE.exec(stated);
  if (match === null) {
    throw new Error(`The pager states its whole result as "Showing 1–N of M <noun>", and it read ${JSON.stringify(stated)} instead. A count that cannot be read here would leave the whole result unchecked.`);
  }
  return { first: countOf(match[1] ?? "", "The first row the pager states"), last: countOf(match[2] ?? "", "The last row the pager states"), total: countOf(match[3] ?? "", "The whole result the pager states"), itemNoun: match[4] ?? "", text: stated };
}

/** Opens one of the five lists through the switcher the surface offers, and answers its region once it holds rows. */
async function openList(page: Page, list: { readonly key: TaskListKey; readonly label: string }): Promise<Locator> {
  await page.getByRole("tab", { name: list.label }).click();
  await expect(page.locator('[data-slot="work-task-lists"]'), `The ${list.label} list is one of the five lists this surface states.`).toHaveAttribute("data-list", list.key);
  const region = taskRegion(page, list.label);
  await expect(region, `The ${list.label} list renders the one table pattern under its own name.`).toBeVisible();
  return region;
}

/** The row holding one task, named by its title in the table's own row role. */
function rowOf(region: Locator, title: string): Locator {
  // A row is named by the title it holds, matched as the text it is rather than as a pattern: a title is
  // a worker's own words, so a bracket or an apostrophe in one must never become selector syntax.
  return region.getByRole("row", { name: title });
}

/** How many rows one list's table shows, which is the window its pager states for the page on screen. */
async function statedRows(region: Locator): Promise<number> {
  const rows = region.getByRole("checkbox", { name: ROW_SELECTION });
  await expect(rows.first(), "The list states at least one row, so the window its pager states is a window of rows.").toBeVisible();
  return rows.count();
}

/** The persistent label that says this application shows synthetic data, asserted on every surface visited. */
async function expectDevelopmentData(page: Page): Promise<void> {
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first(), "The surface is labelled as development data, so no screen of this application can be mistaken for production.").toBeVisible();
}

/** Opens one task's row actions menu, which names the task it acts on. */
async function openRowActions(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${title}` }).click();
}

/** Chooses one action from the open row menu, which also names the task it acts on. */
async function chooseRowAction(page: Page, title: string, action: "Complete" | "Reopen" | "Edit" | "Cancel"): Promise<void> {
  await openRowActions(page, title);
  await page.getByRole("menuitem", { name: `${action} for ${title}` }).click();
}

// ---------------------------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------------------------

/** This file acts as the established worker throughout, which is the persona the runner admits the context as. */
test.use({ persona: PERSONA });

/**
 * Every test starts from the deterministic seed.
 *
 * The runner restores the same seed before the test body and puts this persona's session cookie on the
 * context; the call below states that requirement where this file is read, and a second reset lays the
 * identical documents down again through the same control the Settings reset submits.
 */
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

/**
 * Creates the one task this journey gives the day, through the composer the Work surface owns.
 *
 * The task is dated the seeded civil day the Work surface calls today, which is why it lands in Today without this
 * file computing a date, a zone or a midnight: the surface judges the date, and the Today list below is what proves
 * it judged this one as today. A category is the worker's own short label, so it is filled here to prove that
 * changing it later changes the task and nothing else.
 */
async function createTaskDueToday(page: Page, dueOn: string): Promise<void> {
  await page.goto(WORK_HREF);
  await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The five lists are a destination of their own, reached from the shell's own navigation.").toBeVisible();
  await expectDevelopmentData(page);
  await page.getByRole("button", { name: NEW_TASK_LABEL }).first().click();
  const composer = page.getByRole("region", { name: NEW_TASK_LABEL });
  await expect(composer, "Creating a task happens in the one composer that owns the task form.").toBeVisible();
  // Each control is named by the form rather than by a placeholder, so every field states what it holds
  // before it is filled; one loop fills the three the day's task needs and nothing else.
  for (const field of [
    { label: TITLE_LABEL, value: TODAY_TASK_TITLE },
    { label: CATEGORY_LABEL, value: TODAY_TASK_CATEGORY },
    { label: DUE_DATE_LABEL, value: dueOn },
  ]) {
    const control = composer.getByRole("textbox", { name: new RegExp(`^${field.label}`, "u") });
    await expect(control, `The composer names its ${JSON.stringify(field.label)} field.`).toBeVisible();
    await control.fill(field.value);
  }
  await composer.getByRole("button", { name: CREATE_LABEL }).click();
  // The durable in-context receipt, never a toast alone: one outcome, in the place the worker returns to.
  // The outcome is read before it is asserted, so a refusal is reported with the words the composer gave it
  // rather than as a missing element.
  const receipt = composer.locator('[data-slot="operation-result"]');
  await expect(receipt, "Creating the day's task records its outcome in the composer that submitted it.").toBeVisible();
  const outcome = await receipt.getAttribute("data-outcome");
  expect(outcome, `Creating the day's task is accepted. The composer stated ${JSON.stringify(outcome)}: ${(await composer.innerText()).replace(/\s+/gu, " ").slice(0, DETAIL_LIMIT)}`).toBe("accepted");
  await expect(receipt.getByRole("heading", { name: SAVED_HEADING })).toBeVisible();
  await composer.getByRole("button", { name: DONE_LABEL }).click();
  await expect(page.locator('[data-slot="task-composer"]'), "Dismissing the receipt closes the composer rather than leaving a second, settled form open.").toHaveCount(0);
}

test("every list states the whole result it holds and its page size, and the agenda groups dated work by the day it is due", async ({ page }) => {
  const today = SEEDED_TODAY;
  await createTaskDueToday(page, today);

  // The five lists, one at a time: each counted pager states the noun it counts, the window it is showing and the
  // size of the whole result it holds, and the rows the table renders are the rows that window covers.
  const totals = new Map<TaskListKey, number>();
  const statedTotals: string[] = [];
  for (const list of TASK_LISTS) {
    const region = await openList(page, list);
    const stated = await readPager(page);
    totals.set(list.key, stated.total);
    statedTotals.push(`${list.label} ${String(stated.total)}`);
    expect(stated.itemNoun, `The ${list.label} list counts its rows in the task noun the Work surface uses.`).toBe(TASK_NOUN);
    // The pager's last row is the last row this page holds and the table renders exactly those rows, so the window
    // and the rows agree; the whole result it counts is the same work or more, never a row it does not show.
    expect(stated.last, `The ${list.label} list states how many of its rows this page holds, and the table renders that many.`).toBe(await statedRows(region));
    expect(stated.total, `The ${list.label} list states a whole result no smaller than the rows its page holds.`).toBeGreaterThanOrEqual(stated.last);
    await expect(page.getByLabel(ROWS_PER_PAGE_LABEL), `The ${list.label} list states the page size it is paging by, which is the documented default.`).toHaveValue(PAGE_SIZE_DEFAULT);
    await expect(page.getByRole("table", { name: `${list.label} ${TASK_NOUN}` }), `The ${list.label} list renders the one table pattern under its own name.`).toBeVisible();
    await expectDevelopmentData(page);
  }

  // This journey's own task is in Today, and it is the only reason Today holds anything: the seed dates
  // every task away from the day its clock stands at.
  const todayRegion = await openList(page, { key: "today", label: "Today" });
  await expect(rowOf(todayRegion, TODAY_TASK_TITLE), `The task dated ${today} is the work Today holds, so the surface calls that day today.`).toBeVisible();

  // The dated agenda: the same work, grouped by the civil day each task stands at.
  await page.goto(AGENDA_HREF);
  const agenda = agendaRegion(page);
  await expect(agenda, "The dated agenda is a destination of its own, one level beside the lists.").toBeVisible();
  const agendaStated = await readPager(page);
  // The agenda states the size of the whole dated result rather than one page of days, and the dated open work it
  // groups is the same work the Today, Upcoming and Overdue lists count: one partition of the work, read on a second
  // surface. A pager that reported only its own window would not agree with the lists' pagers it is compared with.
  const dated = DATED_LIST_KEYS.reduce((sum, key) => sum + (totals.get(key) ?? 0), 0);
  expect(agendaStated.itemNoun, "The agenda counts its rows in the same task noun the lists use.").toBe(TASK_NOUN);
  expect(agendaStated.total, `The agenda states the same dated open work the Today, Upcoming and Overdue lists count (${String(dated)}).`).toBe(dated);
  // The agenda pages at its own window, which is the documented cap rather than the lists' default, and it states
  // that window rather than paging by one the read never asked for.
  await expect(page.getByLabel(ROWS_PER_PAGE_LABEL), "The agenda states the window it pages at, which is the documented cap.").toHaveValue(AGENDA_PAGE_SIZE);
  await expectDevelopmentData(page);

  // A row stands under the day it is due: the date it states is that civil day and nothing else, once per
  // group, so no row is grouped by a midnight, an instant or a zone offset.
  const overdueRow = rowOf(agenda, OVERDUE_TASK_TITLE);
  await expect(overdueRow, "Work past its date is still open work, so the agenda groups it.").toBeVisible();
  await expect(overdueRow.locator(`time[datetime="${OVERDUE_TASK_DATE}"]`), "The row states the civil day it is due.").toHaveCount(1);
  const meetingRow = rowOf(agenda, MEETING_TASK_TITLE);
  await expect(meetingRow.locator(`time[datetime="${MEETING_TASK_DATE}"]`), "A meeting is grouped by the day it is planned for, stated as that day.").toHaveCount(1);
  await expect(agenda.getByRole("heading", { name: /10 November 2026/u }), "The day that opens a group states the date in words, once for the group.").toHaveCount(1);
  await expect(agenda.locator(`time[datetime="${today}"]`).first(), "The task this journey created for today opens a day of its own.").toBeVisible();

  // A task with no date is in no dated group, and a completed task is not work waiting on an answer.
  await expect(agenda.getByText(UNDATED_TASK_TITLE), "Undated work is never given a day to group it under.").toHaveCount(0);
  await expect(agenda.getByText(COMPLETED_TASK_TITLE), "A completed task is closed work, so the agenda does not group it.").toHaveCount(0);

  test
    .info()
    .annotations.push({
      type: "criterion-5 lists and agenda",
      description: `At ${today}, the day the Work surface judged today, each of the five lists stated its whole result (${statedTotals.join(", ")}) and its page size ${PAGE_SIZE_DEFAULT}, and the agenda stated ${String(agendaStated.total)} dated task(s) — the Today, Upcoming and Overdue lists added up — grouped by civil day.`,
    });
});

// ---------------------------------------------------------------------------------------------
// Selection over explicit rows
// ---------------------------------------------------------------------------------------------

/**
 * Selects exactly the rows this file names, through the row controls the table pattern gives each one.
 *
 * A bulk action acts on the rows a worker ticked and never on a filter, a saved view or a page, so every
 * bulk run below starts from an explicit tick of a named row.
 */
async function selectRows(page: Page, titles: readonly string[]): Promise<void> {
  for (const title of titles) {
    await page.getByRole("checkbox", { name: `Select ${title}` }).check();
  }
}

/** Releases a selection and dismisses a settled receipt, so the next bulk action starts from nothing. */
async function clearBulkState(page: Page): Promise<void> {
  const clearSelection = page.getByRole("button", { name: "Clear selection" });
  if ((await clearSelection.count()) > 0) {
    await clearSelection.first().click();
  }
  const dismiss = page.getByRole("button", { name: "Dismiss the result" });
  if ((await dismiss.count()) > 0) {
    await dismiss.first().click();
  }
}

test("completing a task takes it out of Today, reopening returns it, a category change moves only that task, and a planned meeting is never counted as held", async ({ page }) => {
  const today = SEEDED_TODAY;
  await createTaskDueToday(page, today);

  // -------------------------------------------------------------------------------------------
  // Complete the day's task
  // -------------------------------------------------------------------------------------------

  const all = await openList(page, { key: "all", label: "All" });
  // The seeded task this test changes later, read off the row before anything touches it, so "the same values" is a
  // comparison against what the list states rather than against a phrase in this file.
  const linkedBefore = await readTaskRow(all, LINKED_TASK_TITLE);
  await expect(rowOf(all, LINKED_TASK_TITLE).getByText(LINKED_TASK_CATEGORY, { exact: true }), "The seeded task carries the worker's own category label, which is the one value this test changes.").toBeVisible();

  const createdRow = rowOf(all, TODAY_TASK_TITLE);
  await expect(createdRow, "The task created for today is the same task in All: one task model feeds every list.").toBeVisible();
  await expect(createdRow.getByText(today, { exact: true }), "The row states the civil day it is due, not a time of day and not a zone.").toBeVisible();
  await expect(createdRow.getByText(TODAY_TASK_CATEGORY, { exact: true }), "The row states the category the task was given.").toBeVisible();

  await chooseRowAction(page, TODAY_TASK_TITLE, "Complete");
  const completion = page.locator('[data-slot="task-action-result"][data-outcome="accepted"]');
  await expect(completion, "Completing a task is one accepted change, recorded in the row it changed.").toBeVisible();
  await expect(completion.locator('[data-slot="operation-result"][data-outcome="accepted"]'), "The receipt is the durable in-context result, not a toast.").toBeVisible();
  await expect(completion.getByRole("heading", { name: SAVED_HEADING })).toBeVisible();
  expect(await page.getByText(COMPLETION_MEANS_NOTHING).count(), "The surface states what completing a task does not prove, beside the action that completes it.").toBeGreaterThan(0);
  // The revision the receipt states is the record's own, and the reopen below states a different one: an accepted
  // change advances the revision the next change has to present.
  const completionRevision = await readReceiptRevision(completion.locator('[data-slot="operation-result"]'));

  const created = await readTaskRow(all, TODAY_TASK_TITLE);
  const createdActions = page.locator(`[data-slot="task-actions"][data-task-id="${created.taskId}"]`);
  await expect(createdActions, "The accepted change re-reads the list, so the row states the status the task now holds.").toHaveAttribute("data-status", "completed");
  // The receipt holds the row's keyboard position while it stands, so it is dismissed before the next action.
  await completion.getByRole("button", { name: "Dismiss this result" }).click();
  await expect(completion).toHaveCount(0);

  // Today states the work still due, so completed work leaves it: an empty Today is a state of its own
  // rather than the row it used to hold.
  await page.getByRole("tab", { name: "Today" }).click();
  await expect(page.locator('[data-slot="work-task-lists"]')).toHaveAttribute("data-list", "today");
  await expect(page.getByText("Nothing is due today"), "Today states that nothing is due rather than showing the completed row.").toBeVisible();
  await expect(page.getByRole("row", { name: TODAY_TASK_TITLE }), "A completed task is not work still due today.").toHaveCount(0);

  // -------------------------------------------------------------------------------------------
  // Reopen it
  // -------------------------------------------------------------------------------------------

  const allForReopen = await openList(page, { key: "all", label: "All" });
  await chooseRowAction(page, TODAY_TASK_TITLE, "Reopen");
  const reopening = page.locator('[data-slot="task-action-result"][data-outcome="accepted"]');
  await expect(reopening.getByRole("heading", { name: SAVED_HEADING }), "Reopening is accepted as one change and keeps its own receipt.").toBeVisible();
  await expect(createdActions, "The row states that the task is open work again.").toHaveAttribute("data-status", "reopened");
  const reopenedRow = rowOf(allForReopen, TODAY_TASK_TITLE);
  await expect(reopenedRow.getByText(today, { exact: true }), "Reopening returns the same task with the same identifying values.").toBeVisible();
  await expect(reopenedRow.getByText(TODAY_TASK_CATEGORY, { exact: true }), "Reopening changes no label the task carries.").toBeVisible();
  await expect(reopenedRow.getByText("Reopened"), "The row states the reopened status rather than an open one.").toBeVisible();
  const reopeningRevision = await readReceiptRevision(reopening.locator('[data-slot="operation-result"]'));
  expect(reopeningRevision, "An accepted change advances the revision the next change has to present, so the reopen states a different revision than the completion did.").not.toBe(completionRevision);
  await reopening.getByRole("button", { name: "Dismiss this result" }).click();

  // Reopened work is work still waiting on an answer, so Today holds it again.
  const todayAgain = await openList(page, { key: "today", label: "Today" });
  await expect(rowOf(todayAgain, TODAY_TASK_TITLE), "Reopened work is due today again, so Today holds it.").toBeVisible();

  // -------------------------------------------------------------------------------------------
  // Change one task's free-text category, and nothing else
  // -------------------------------------------------------------------------------------------

  // The partner's own measure surfaces, read before the category changes: a task is work the worker owns,
  // so a change to one must not appear as anything that happened with a partner.
  await page.goto(`${PARTNER_ROUTE_PREFIX}/${LINKED_PARTNER}`);
  const activity = page.getByRole("region", { name: ACTIVITY_SECTION });
  await expect(activity, "The partner's record states the activity that actually happened.").toBeVisible();
  const activityBefore = await activity.getByRole("listitem").count();
  expect(activityBefore, "The seeded partner has recorded activity, which is what makes an unchanged count mean something.").toBeGreaterThan(0);
  await expectDevelopmentData(page);

  await page.goto(WORK_HREF);
  const allForEdit = await openList(page, { key: "all", label: "All" });
  await chooseRowAction(page, LINKED_TASK_TITLE, "Edit");
  const editor = page.getByRole("region", { name: EDIT_TASK_HEADING });
  await expect(editor, "Editing opens the one composer on the task the row names.").toBeVisible();
  await expect(editor.getByRole("textbox", { name: /^Title/u })).toHaveValue(LINKED_TASK_TITLE);
  await expect(editor.getByRole("textbox", { name: /^Category/u }), "The composer opens on the values the task holds rather than on blank fields.").toHaveValue(LINKED_TASK_CATEGORY);
  await editor.getByRole("textbox", { name: /^Category/u }).fill(CHANGED_TASK_CATEGORY);
  await editor.getByRole("button", { name: SAVE_LABEL }).click();
  const edited = editor.locator('[data-slot="operation-result"][data-outcome="accepted"]');
  await expect(edited, "A category change is one accepted change to that task.").toBeVisible();
  await expect(edited.getByRole("heading", { name: SAVED_HEADING })).toBeVisible();

  // The row the list renders after the change is the same task: it is found by its own title, it states the label
  // the worker typed, and it stands at the same day and the same status it stood at before. No row, list or composer
  // states a record's revision — the receipt is where that is stated, which is why the two receipts from the two
  // accepted changes above are what prove an accepted change advances it.
  const linkedAfter = await readTaskRow(allForEdit, LINKED_TASK_TITLE);
  await expect(rowOf(allForEdit, LINKED_TASK_TITLE).getByText(CHANGED_TASK_CATEGORY, { exact: true }), "The list states the label the task now carries.").toBeVisible();
  expect(linkedAfter.taskId, "A category is a label on the task and does not rewrite what the task is: the same task, under the same title.").toBe(linkedBefore.taskId);
  expect(linkedAfter.dueOn, "A category change leaves the due date where it was, so no date is invented for it.").toBe(linkedBefore.dueOn);
  expect(linkedAfter.status, "A category change changes no status, and completing or reopening is not implied by it.").toBe(linkedBefore.status);
  const editedRevision = await readReceiptRevision(edited);
  await editor.getByRole("button", { name: DONE_LABEL }).click();

  await page.goto(`${PARTNER_ROUTE_PREFIX}/${LINKED_PARTNER}`);
  const activityAfter = page.getByRole("region", { name: ACTIVITY_SECTION });
  await expect(activityAfter).toBeVisible();
  expect(await activityAfter.getByRole("listitem").count(), "Changing a task's category records no interaction, so the partner's activity is exactly what it was.").toBe(activityBefore);
  await expect(activityAfter.getByText(LINKED_TASK_TITLE), "A task is never listed as activity: only something that happened is.").toHaveCount(0);

  // -------------------------------------------------------------------------------------------
  // A planned time is a plan, not a held meeting
  // -------------------------------------------------------------------------------------------

  await page.goto(WORK_HREF);
  const allForMeeting = await openList(page, { key: "all", label: "All" });
  const meeting = rowOf(allForMeeting, MEETING_TASK_TITLE);
  await expect(meeting, "A meeting is one task on the same model as ordinary work.").toBeVisible();
  await expect(meeting.getByText("Meeting", { exact: true }), "The row states the kind of work it is.").toBeVisible();
  await expect(meeting.getByText("Planned", { exact: true }), "A planned time is stated as planned.").toBeVisible();
  await expect(meeting.getByText(MEETING_TASK_TIME, { exact: true }), "The planned clock time is stated.").toBeVisible();
  await expect(meeting.getByText(PLANNED_MEETING_ZONE, { exact: true }), "The zone the planned time is stated in is disclosed rather than assumed.").toBeVisible();
  await expect(meeting.getByText("Held", { exact: true }), "Nothing on the surface presents the planned meeting as held.").toHaveCount(0);
  await expect(page.getByText(PLANNED_VERSUS_HELD), "The surface says in its own words what a planned time does and does not mean.").toBeVisible();

  // The partner's own measure surfaces count only what happened: the planned meeting is work still to do.
  await page.goto(`${PARTNER_ROUTE_PREFIX}/${MEETING_PARTNER}`);
  const meetingActivity = page.getByRole("region", { name: ACTIVITY_SECTION });
  await expect(meetingActivity).toBeVisible();
  await expect(meetingActivity.getByText(MEETING_TASK_TITLE), "A planned meeting is not counted as a meeting that was held.").toHaveCount(0);
  const openWork = page.getByRole("region", { name: OPEN_TASKS_SECTION });
  await expect(openWork, "The partner's record states the work still open with them.").toBeVisible();
  await expect(openWork.getByText(MEETING_TASK_TITLE), "The planned meeting stands as work still to do rather than as something that happened.").toBeVisible();
  await expectDevelopmentData(page);

  test
    .info()
    .annotations.push({
      type: "criterion-5 follow-through",
      description: `Completed and reopened ${JSON.stringify(TODAY_TASK_TITLE)} (${created.taskId}) due ${today}, whose two receipts stated revisions ${completionRevision} and ${reopeningRevision}; the category change on ${JSON.stringify(LINKED_TASK_TITLE)} kept the task's day and status and its receipt stated revision ${editedRevision}, and the change left the partner's ${String(activityBefore)} recorded interactions untouched; the planned meeting on ${MEETING_TASK_DATE} at ${MEETING_TASK_TIME} ${PLANNED_MEETING_ZONE} was counted as open work and never as held.`,
    });
});

test("a record visit returns to the same filtered view, its same ordering and the reader's same place in it", async ({ page }) => {
  // A short window, so the list is longer than the viewport and the reader's place in it is a figure to
  // return to rather than a zero on both sides of the visit.
  await page.setViewportSize({ width: 1280, height: 480 });

  // -------------------------------------------------------------------------------------------
  // The Work list: a filter, an ordering and a place in the result
  // -------------------------------------------------------------------------------------------

  await page.goto(`${WORK_HREF}?list=upcoming&sort=title:asc&page=1&pageSize=50`);
  await expect(page.locator('[data-slot="work-task-lists"]'), "The filter the address names is the list the surface shows.").toHaveAttribute("data-list", "upcoming");
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  const upcoming = taskRegion(page, "Upcoming");
  await expect(upcoming).toBeVisible();
  const orderedBy = upcoming.getByRole("columnheader", { name: TITLE_COLUMN_LABEL, exact: true });
  await expect(orderedBy, "The ordering the address names is the ordering the surface shows.").toHaveAttribute("aria-sort", "ascending");
  const workPagerBefore = (await readPager(page)).text;
  const workFirstRowBefore = (await upcoming.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const workScrollBefore = await page.evaluate(() => window.scrollY);
  expect(workScrollBefore, "The filtered list is longer than the window, which is what makes the reader's place in it something to return to.").toBeGreaterThan(0);

  // The visit: the row's own link is the only route to the partner, so the record is a destination.
  await upcoming.getByRole("link", { name: "Jo Mbeki" }).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" }), "The record states the list it belongs to, so the visit is a navigation rather than a panel over the list.").toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${PARTNER_ROUTE_PREFIX}/${LINKED_PARTNER}`, "u"));

  // The return: the same query, the same window, the same rows in the same order, and the same place.
  await page.goBack();
  await expect(page.locator('[data-slot="work-task-lists"]'), "The same list comes back after the visit.").toHaveAttribute("data-list", "upcoming");
  await expect(page, "The address keeps the filter and the ordering the visit started from.").toHaveURL(/list=upcoming/u);
  await expect(page).toHaveURL(/sort=title(:|%3A)asc/u);
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  await expect(orderedBy, "The ordering comes back as it was.").toHaveAttribute("aria-sort", "ascending");
  expect((await readPager(page)).text, "The page window comes back exactly as it was.").toBe(workPagerBefore);
  await expect(upcoming.getByRole("row").nth(1)).toBeVisible();
  expect((await upcoming.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim(), "The same rows are in the same order after the return.").toBe(workFirstRowBefore);
  // The place the reader left is a non-zero one, which is what makes the return a return rather than a
  // fresh arrival at the top of the list. The application restores a place rather than the same offset:
  // the returned view re-reads its own query, so the document is briefly shorter than the place recorded
  // and the restored offset is bounded by that height. The measurement is stated, not assumed.
  await expect.poll(async () => await page.evaluate(() => window.scrollY), { message: `The return leaves the reader inside the list they left (${String(workScrollBefore)} CSS px down before the visit) rather than dropping them at its top.` }).toBeGreaterThan(0);
  const workScrollAfter = await page.evaluate(() => window.scrollY);
  await expectDevelopmentData(page);

  // -------------------------------------------------------------------------------------------
  // The dated agenda: the same rule, on the second list surface
  // -------------------------------------------------------------------------------------------

  await page.goto(AGENDA_HREF);
  const agenda = agendaRegion(page);
  await expect(agenda, "The dated agenda is a list destination of its own.").toBeVisible();
  const agendaPagerBefore = (await readPager(page)).text;
  const agendaFirstRowBefore = (await agenda.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const agendaScrollBefore = await page.evaluate(() => window.scrollY);
  expect(agendaScrollBefore, "The agenda is longer than the window, so its place is something to return to as well.").toBeGreaterThan(0);

  await agenda.getByRole("link", { name: "Grace Adeyemi" }).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toBeVisible();
  await expect(page).toHaveURL(/\/partners\/[^?/]+/u);

  await page.goBack();
  await expect(page, "The agenda returns at the address it was left at.").toHaveURL(/\/work\/agenda$/u);
  await expect(agenda, "The same agenda comes back after the visit.").toBeVisible();
  expect((await readPager(page)).text, "The agenda's page window comes back exactly as it was.").toBe(agendaPagerBefore);
  await expect(agenda.getByRole("row").nth(1)).toBeVisible();
  expect((await agenda.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim(), "The same days and rows come back in the same order.").toBe(agendaFirstRowBefore);
  await expect.poll(async () => await page.evaluate(() => window.scrollY), { message: `The return leaves the reader inside the agenda they left (${String(agendaScrollBefore)} CSS px down before the visit) rather than at its top.` }).toBeGreaterThan(0);
  const agendaScrollAfter = await page.evaluate(() => window.scrollY);
  await expectDevelopmentData(page);

  test
    .info()
    .annotations.push({
      type: "criterion-5 continuity",
      description: `A partner-record visit and return restored the Work list's filter (upcoming), its ordering (title ascending), its page window (${workPagerBefore}) and a place ${String(workScrollAfter)} px down a list it left ${String(workScrollBefore)} px down, and the agenda's window (${agendaPagerBefore}) and a place ${String(agendaScrollAfter)} px down an agenda it left ${String(agendaScrollBefore)} px down. The return restores a non-zero place rather than the same offset, because the returned view re-reads its own query before the document reaches the height the reader left at.`,
    });
});

test("the three bulk actions review the selection first and report each row's own result", async ({ page, request }) => {
  // What a selection must never change: a private tag on a task is that task's own label, so the partner's record and
  // the publisher's audience are read before the run and compared against afterwards. The audience is read off the
  // page that states its counts; the partner's tags are the one record read no surface the journey visits states.
  const partnerRecordBefore = await readEnvelope(request, `${PARTNER_API_PREFIX}/${LINKED_PARTNER}?job=record`);
  const partnerTagsBefore = arrayOf(recordOf(recordOf(partnerRecordBefore["data"], "The partner record read's data")["partner"], "The partner's own record")["tags"], "The partner's tags");
  const audienceBefore = await readAudience(page);

  await page.goto(WORK_HREF);
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
  const all = await openList(page, { key: "all", label: "All" });
  // Each row states the task its own actions act on, which is the identity every result below is reported by.
  const linked = await readTaskRow(all, LINKED_TASK_TITLE);
  const thankYou = await readTaskRow(all, OVERDUE_TASK_TITLE);
  const completed = await readTaskRow(all, COMPLETED_TASK_TITLE);

  // Nothing selected: a bulk action acts on a selection, so with none there is nothing to offer.
  await expect(page.locator('[data-slot="bulk-action-bar"]'), "With no row selected the surface offers no bulk action at all.").toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bulk actions" }), "A selection is what a bulk action acts on, so the bar is not there to invite one.").toHaveCount(0);

  // -------------------------------------------------------------------------------------------
  // Apply one private tag to two explicitly selected rows
  // -------------------------------------------------------------------------------------------

  await selectRows(page, [LINKED_TASK_TITLE, OVERDUE_TASK_TITLE]);
  await expect(page.getByRole("heading", { name: "Bulk actions" }), "A selection opens the one bulk bar over the rows that were ticked.").toBeVisible();
  await expect(page.getByText(/Rows selected:\s*2\./u), "The bar states how many rows the selection holds, and that only they are affected.").toBeVisible();
  // The sentence is stated twice on this surface — once by the list and once by the bar over the selection —
  // so it is read once rather than asserted twice.
  await expect(page.getByText("A selection is not an audience, not a consent and not a campaign", { exact: false }).first(), "The bar says in its own words what a selection is not.").toBeVisible();

  await page.getByRole("button", { name: PRIVATE_TAG_INTENT }).click();
  await page.getByRole("menuitem", { name: APPLY_TAG_LABEL }).click();
  const tagPanel = page.getByRole("region", { name: APPLY_TAG_LABEL });
  await expect(tagPanel, "The intent opens its own panel, over the selection it will act on.").toBeVisible();
  await expect(tagPanel.getByRole("textbox", { name: new RegExp(`^${PRIVATE_TAG_FIELD}`, "u") }), "The tag field is named, so the value this action applies is stated before it is applied.").toBeVisible();
  await tagPanel.getByRole("textbox", { name: /^Private tag/u }).fill(BULK_TAG);
  const tagReview = page.getByRole("region", { name: REVIEW_HEADING });
  await expect(tagReview, "Each intent passes the one review step before anything is applied.").toBeVisible();
  await expect(tagReview.getByText(/Selected:\s*2\s*rows?\./u), "The review step summarises the selection before anything is applied.").toBeVisible();
  await page.getByRole("button", { name: REVIEW_CONFIRM_LABEL }).click();

  const tagged = page.locator('[data-slot="operation-result"][data-outcome="accepted"]');
  await expect(tagged, "Applying the tag is one accepted change, reported per row.").toBeVisible();
  await expect(tagged.getByText(PER_ITEM_HEADING), "The receipt reports one result per selected row.").toBeVisible();
  const taggedRows = tagged.locator("table tbody tr");
  await expect(taggedRows, "The result lists one row per selected task rather than one aggregate outcome.").toHaveCount(2);
  const taggedText = (await taggedRows.allInnerTexts()).join(" | ");
  expect(taggedText, "Each reported row names the task it changed, so the rows are read one at a time.").toContain(linked.taskId);
  expect(taggedText).toContain(thankYou.taskId);
  for (let index = 0; index < 2; index += 1) {
    await expect(taggedRows.nth(index), "Every selected row states its own outcome, and both were accepted.").toContainText(PER_ITEM_ACCEPTED);
  }
  // The rows stay selected while their receipt is on screen — the bar is rendered only over a selection, so
  // releasing them on acceptance would unmount the only record of what the action did — and dismissing the
  // result is what releases them.
  await clearBulkState(page);

  // -------------------------------------------------------------------------------------------
  // The tag now exists, privately: applying it a second time changes nothing
  // -------------------------------------------------------------------------------------------

  await selectRows(page, [LINKED_TASK_TITLE, OVERDUE_TASK_TITLE]);
  await page.getByRole("button", { name: PRIVATE_TAG_INTENT }).click();
  await page.getByRole("menuitem", { name: APPLY_TAG_LABEL }).click();
  await page
    .getByRole("region", { name: APPLY_TAG_LABEL })
    .getByRole("textbox", { name: /^Private tag/u })
    .fill(BULK_TAG);
  await page.getByRole("button", { name: REVIEW_CONFIRM_LABEL }).click();
  const repeated = page.locator('[data-slot="action-review-result"][data-outcome="unchanged"]');
  await expect(repeated.getByRole("heading", { name: NOTHING_TO_CHANGE_HEADING }), "Re-applying the same private tag changes nothing, which is how the tag's presence is read back from the application rather than assumed.").toBeVisible();
  await clearBulkState(page);

  // -------------------------------------------------------------------------------------------
  // Remove it again
  // -------------------------------------------------------------------------------------------

  await selectRows(page, [LINKED_TASK_TITLE, OVERDUE_TASK_TITLE]);
  await page.getByRole("button", { name: PRIVATE_TAG_INTENT }).click();
  await page.getByRole("menuitem", { name: REMOVE_TAG_LABEL }).click();
  await page
    .getByRole("region", { name: REMOVE_TAG_LABEL })
    .getByRole("textbox", { name: /^Private tag/u })
    .fill(BULK_TAG);
  await page.getByRole("button", { name: REVIEW_CONFIRM_LABEL }).click();
  const untagged = page.locator('[data-slot="operation-result"][data-outcome="accepted"]');
  await expect(untagged.locator("table tbody tr"), "Removing the tag is reported per row as well.").toHaveCount(2);
  await clearBulkState(page);

  // -------------------------------------------------------------------------------------------
  // Create one ordinary follow-up task per selected row
  // -------------------------------------------------------------------------------------------

  await selectRows(page, [LINKED_TASK_TITLE, OVERDUE_TASK_TITLE]);
  await page.getByRole("button", { name: FOLLOW_UP_INTENT }).click();
  const followUpPanel = page.getByRole("region", { name: FOLLOW_UP_INTENT });
  await expect(followUpPanel).toBeVisible();
  await followUpPanel.getByRole("textbox", { name: /^Title/u }).fill(BULK_FOLLOW_UP_TITLE);
  await page.getByRole("button", { name: REVIEW_CONFIRM_LABEL }).click();
  const followUps = page.locator('[data-slot="operation-result"][data-outcome="accepted"]');
  await expect(followUps.locator("table tbody tr"), "One follow-up task per selected row, each reported.").toHaveCount(2);
  await expect(all.getByRole("row", { name: BULK_FOLLOW_UP_TITLE }), "The two follow-up tasks are ordinary open work in the same list.").toHaveCount(2);
  await clearBulkState(page);

  // -------------------------------------------------------------------------------------------
  // Complete the rows that can be completed on their own, and say so about the one that cannot
  // -------------------------------------------------------------------------------------------

  // A selection holding only a closed row leaves this action nothing to act on: it is not offered, and the
  // reason is stated beside it rather than left to be discovered by pressing it.
  await selectRows(page, [COMPLETED_TASK_TITLE]);
  const completeIntent = page.getByRole("button", { name: COMPLETE_INTENT });
  await expect(completeIntent, "A closed row cannot be completed on its own, so with only that row selected the action is not offered.").toBeDisabled();
  await expect(page.getByText(CLOSED_ROW_REASON), "The reason a closed row cannot be completed on its own is stated beside the action it belongs to.").toBeVisible();

  // Adding an open row makes the action available over that row alone.
  await selectRows(page, [OVERDUE_TASK_TITLE]);
  await expect(completeIntent, "An open row gives the action something to act on.").toBeEnabled();
  await completeIntent.click();
  const completeReview = page.getByRole("region", { name: REVIEW_HEADING });
  await expect(completeReview.getByText(/Selected:\s*1\s*rows?\./u), "The review step states the rows the action can act on.").toBeVisible();
  await expect(completeReview.getByText(/Excluded before this step:\s*1\s*rows?\./u), "A selected row this action cannot act on is reported as excluded, with its reason, before anything is applied.").toBeVisible();
  await page.getByRole("button", { name: REVIEW_CONFIRM_LABEL }).click();
  // The receipt is read wherever the surface states it: once every selected row has been acted on, the
  // review step has nothing left to review and the durable result stands on its own beneath it.
  const completedReceipt = page.locator('[data-slot="operation-result"][data-outcome="accepted"]');
  const completedRows = completedReceipt.locator("table tbody tr");
  // The result accounts for every row the step was given: the row the action acted on is accepted, and the row it could
  // not act on is reported as excluded with its reason rather than dropped from the receipt.
  await expect(completedRows, "The result holds one row for each selected row: the acted-on one accepted, the other excluded.").toHaveCount(2);
  const acceptedRow = completedRows.filter({ hasText: PER_ITEM_ACCEPTED });
  await expect(acceptedRow, "Exactly one row was acted on.").toHaveCount(1);
  await expect(acceptedRow, "The row the action could act on was accepted.").toContainText(PER_ITEM_ACCEPTED);
  const completedText = await acceptedRow.innerText();
  expect(completedText, "The row reported is the open task the action acted on.").toContain(thankYou.taskId);
  expect(completedText, "The closed row is not reported as a completed one.").not.toContain(completed.taskId);
  await expect(completedRows.filter({ hasText: completed.taskId }), "The closed row the action could not act on is stated in the result as excluded.").toHaveCount(1);
  await expect(page.locator(`[data-slot="task-actions"][data-task-id="${completed.taskId}"]`), "A row this action could not act on keeps the status it had.").toHaveAttribute("data-status", "completed");
  await expect(page.locator(`[data-slot="task-actions"][data-task-id="${thankYou.taskId}"]`), "The row it did act on states the status the change produced.").toHaveAttribute("data-status", "completed");

  // -------------------------------------------------------------------------------------------
  // What the selection was not
  // -------------------------------------------------------------------------------------------

  const partnerRecordAfter = await readEnvelope(request, `${PARTNER_API_PREFIX}/${LINKED_PARTNER}?job=record`);
  const partnerTagsAfter = arrayOf(recordOf(recordOf(partnerRecordAfter["data"], "The partner record read's data")["partner"], "The partner's own record")["tags"], "The partner's tags");
  expect(partnerTagsAfter, "A private tag on a task is the task's own label: the partner's record is exactly what it was.").toEqual(partnerTagsBefore);
  expect(partnerTagsAfter, "The tag applied by bulk is nowhere on the partner's record, so it is not a partner tag.").not.toContain(BULK_TAG);
  const audienceAfter = await readAudience(page);
  expect(audienceAfter, "A selection is not an audience: no membership was added, confirmed, restricted or switched off.").toEqual(audienceBefore);
  await expectDevelopmentData(page);

  test
    .info()
    .annotations.push({
      type: "criterion-5 bulk actions",
      description: `Three bulk intents over explicitly selected rows: the private tag ${JSON.stringify(BULK_TAG)} applied twice (accepted, then unchanged) and removed, ${String(2)} follow-up tasks created from ${String(2)} rows, and completion run over a selection holding one closed row — reported as 1 row acted on and 1 excluded before the step, with the closed row left completed. The partner's tags and the audience were unchanged by the selection.`,
    });
});
