/** Criterion 5 — daily follow-through: the work a day asks for, followed through, and never claimed as more. */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { countOf, expect, listOf, objectOf, SEEDED_PERSONAS, sessionCookie, test, type PersonaName } from "../playwright.config";
const recordEvidence = (type: string, description: string): void => void test.info().annotations.push({ type, description });
const PERSONA: PersonaName = "established-worker";
const SESSION = SEEDED_PERSONAS[PERSONA]; // The established worker's seeded session, mirrored from the runner's roster rather than hard-coded.
const WORK_HREF = "/work";
const AGENDA_HREF = "/work/agenda";
const UPCOMING_HREF = `${WORK_HREF}?list=upcoming&sort=title:asc&page=1&pageSize=50`; // The one filtered, ordered page window this journey leaves and returns to, which is the list a reader's place is kept against.
const PARTNER_ROUTE_PREFIX = "/partners"; // The prefix every partner record is served under, from the opaque identifier and never from a name, and the one its own read lives under.
const PARTNER_API_PREFIX = "/api/partners";
const SEEDED_TODAY = "2026-11-20";
const PAGER = { taskNoun: "tasks", titleColumn: "Task", rowsPerPage: "Rows per page", pageSize: "50" } as const;
const AUDIENCE = { href: "/communication/audience", heading: "Update email audience", countsSlot: '[data-slot="membership-counts"]', memberNoun: "members" } as const; // The publisher's audience, which a selection must never become, in the words its own surface states it with.
type TaskListKey = "today" | "upcoming" | "overdue" | "all" | "undated";
const TASK_LISTS: readonly { readonly key: TaskListKey; readonly label: string }[] = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "all", label: "All" },
  { key: "undated", label: "Undated" },
];
const DATED_LIST_KEYS: readonly TaskListKey[] = ["today", "upcoming", "overdue"];
const TODAY_TASK = { title: "Confirm the students' evening venue", category: "Venue" } as const;
const LINKED = { title: "Follow up with Jo after the visit", category: "Care", changedCategory: "Visit follow-up", partner: "partner-jo-mbeki" } as const;
const MEETING = { title: "Talk terms with Grace", date: "2026-11-26", time: "14:30", partner: "partner-grace-adeyemi" } as const;
const PLANNED_MEETING_ZONE = "Europe/London";
const SEEDED_TASK = { overdue: "Send the thank-you note", overdueDate: "2026-11-10", completed: "Introduce Grace to the students' group", undated: "Pray for the students' exam week" } as const;
const BULK = { tagIntent: "Private tag", applyTag: "Apply a private tag", removeTag: "Remove a private tag", followUpIntent: "Create follow-up tasks", completeIntent: "Complete these tasks" } as const;
const REVIEW = { tagField: "Private tag", tag: "venue-chased", followUpTitle: "Chase the venue hire agreement", heading: "Review this bulk action", confirm: "Apply to the selected rows" } as const;
const SECTION = { activity: "Actual activity", openTasks: "Open tasks" } as const;
const RECEIPT = { saved: "Saved", nothingToChange: "Nothing to change", perItem: "Result for each row", accepted: "Accepted" } as const;
const COMPOSER = { newTask: "New task", editHeading: "Edit this task", title: "Title", category: "Category", dueDate: "Due date", create: "Create task", save: "Save task", done: "Done" } as const;
const DETAIL_LIMIT = 400; // How much of an unreadable answer a failure quotes, so a diagnostic is readable without pasting a whole body.
const authorisationHeader = (): Readonly<Record<string, string>> => ({ cookie: sessionCookie(SESSION.sessionId) });
async function readEnvelope(request: APIRequestContext, path: string): Promise<Readonly<Record<string, unknown>>> {
  const response = await request.get(path, { headers: authorisationHeader() }); // Reads one of the application's own browser-facing reads and returns its envelope.
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = undefined;
  }
  if (!response.ok()) throw new Error(`The read ${path} answered HTTP ${String(response.status())}: ${text.slice(0, DETAIL_LIMIT)}. A figure this file cannot read is not a figure it can compare.`);
  if (body === undefined) throw new Error(`The read ${path} answered HTTP ${String(response.status())} with a body this file cannot read as JSON: ${text.slice(0, DETAIL_LIMIT)}.`);
  return objectOf(body, `The read ${path}`);
}
type TaskReading = { readonly taskId: string; readonly status: string; readonly dueOn: string | null };
async function readTaskRow(region: Locator, title: string): Promise<TaskReading> {
  const row = rowOf(region, title); // One row as the list renders it, read off the row itself: the task its actions act on, the status they left it in, and the day it prints — or the words it prints instead of one.
  await expect(row, `The list states the ${JSON.stringify(title)} task, which is what this comparison is about.`).toBeVisible();
  const actions = row.locator('[data-slot="task-actions"]');
  const taskId = await actions.getAttribute("data-task-id");
  const status = await actions.getAttribute("data-status");
  if (taskId === null || status === null) throw new Error(`The row the list renders for ${JSON.stringify(title)} states no task of its own, so nothing is compared against it.`);
  const day = row.getByText(/^\d{4}-\d{2}-\d{2}$/u);
  if ((await day.count()) === 0) {
    await expect(row.getByText("No due date", { exact: true }), `The row for ${JSON.stringify(title)} states the day it stands at, or says it holds none.`).toBeVisible();
    return { taskId, status, dueOn: null };
  }
  return { taskId, status, dueOn: (await day.first().innerText()).trim() };
}
async function readReceiptRevision(receipt: Locator): Promise<string> {
  const fact = receipt.locator("dl > div").filter({ has: receipt.page().getByText("Revision", { exact: true }) }); // The revision a durable receipt states, which is the only place a record's revision is stated: the row, the list and the composer state the record's facts but not the revision they present.
  const stated = fact.locator("bdi");
  await expect(stated, "The receipt states the revision the record it changed now stands at.").toBeVisible();
  return (await stated.innerText()).trim();
}
type Audience = { readonly counts: string; readonly members: number };
async function readAudience(page: Page): Promise<Audience> {
  await page.goto(AUDIENCE.href); // The audience's own statements, read off the page that carries them: a membership that moved state moves one of these.
  await expect(page.getByRole("heading", { name: AUDIENCE.heading, level: 1 }), "The publisher's audience is a destination of its own, reached from the shell.").toBeVisible();
  const counts = page.locator(AUDIENCE.countsSlot);
  await expect(counts, "The audience states its eligible and excluded figures, the four membership states and every exclusion reason.").toBeVisible();
  const members = await readPager(page);
  expect(members.itemNoun, "The audience counts its memberships in its own noun.").toBe(AUDIENCE.memberNoun);
  return { counts: (await counts.textContent())?.replace(/\s+/gu, " ").trim() ?? "", members: members.total };
}
const taskRegion = (page: Page, label: string): Locator => page.getByRole("region", { name: `${label} ${PAGER.taskNoun}, scrollable` }); // The one table pattern's region for one list: named by the list, and the only horizontal scroll port.
const agendaRegion = (page: Page): Locator => page.getByRole("region", { name: "Dated agenda, scrollable" });
async function readPager(page: Page): Promise<{ readonly first: number; readonly last: number; readonly total: number; readonly itemNoun: string; readonly text: string }> {
  const stated = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim();
  const match = /^Showing\s+([\d,]+)\u2013([\d,]+)\s+of\s+([\d,]+)\s+(\S+)$/u.exec(stated);
  if (match === null) throw new Error(`The pager states its whole result as "Showing 1–N of M <noun>", and it read ${JSON.stringify(stated)} instead. A count that cannot be read here would leave the whole result unchecked.`);
  return { first: countOf(match[1] ?? "", "The first row the pager states"), last: countOf(match[2] ?? "", "The last row the pager states"), total: countOf(match[3] ?? "", "The whole result the pager states"), itemNoun: match[4] ?? "", text: stated };
}
async function openList(page: Page, list: { readonly key: TaskListKey; readonly label: string }): Promise<Locator> {
  await page.getByRole("tab", { name: list.label }).click(); // Opens one of the five lists through the switcher the surface offers, and answers its region once it holds rows.
  await expect(page.locator('[data-slot="work-task-lists"]'), `The ${list.label} list is one of the five lists this surface states.`).toHaveAttribute("data-list", list.key);
  const region = taskRegion(page, list.label);
  await expect(region, `The ${list.label} list renders the one table pattern under its own name.`).toBeVisible();
  return region;
}
const rowOf = (region: Locator, title: string): Locator => region.getByRole("row", { name: title }); // A row is named by the title it holds, matched as the text it is rather than as a pattern: a title is a worker's own words, so a bracket or an apostrophe in one must never become selector syntax.
async function statedRows(region: Locator): Promise<number> {
  const rows = region.getByRole("checkbox", { name: /^Select (?!all )/u }); // How many rows one list's table shows, which is the window its pager states for the page on screen.
  await expect(rows.first(), "The list states at least one row, so the window its pager states is a window of rows.").toBeVisible();
  return rows.count();
}
const expectDevelopmentData = async (page: Page): Promise<void> => expect(page.getByText("Development data", { exact: true }).first(), "The surface is labelled as development data, so no screen of this application can be mistaken for production.").toBeVisible();
const openRowActions = async (page: Page, title: string): Promise<void> => page.getByRole("button", { name: `Actions for ${title}` }).click();
async function chooseRowAction(page: Page, title: string, action: "Complete" | "Reopen" | "Edit" | "Cancel"): Promise<void> {
  await openRowActions(page, title);
  await page.getByRole("menuitem", { name: `${action} for ${title}` }).click();
}
test.use({ persona: PERSONA }); // This file acts as the established worker throughout, which is the persona the runner admits the context as.; Every test starts from the deterministic seed.
async function createTaskDueToday(page: Page, dueOn: string): Promise<void> {
  await page.goto(WORK_HREF); // Creates the one task this journey gives the day, through the composer the Work surface owns.
  await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The five lists are a destination of their own, reached from the shell's own navigation.").toBeVisible();
  await expectDevelopmentData(page);
  await page.getByRole("button", { name: COMPOSER.newTask }).first().click();
  const composer = page.getByRole("region", { name: COMPOSER.newTask });
  await expect(composer, "Creating a task happens in the one composer that owns the task form.").toBeVisible();
  for (const field of [
    { label: COMPOSER.title, value: TODAY_TASK.title },
    { label: COMPOSER.category, value: TODAY_TASK.category },
    { label: COMPOSER.dueDate, value: dueOn },
  ]) {
    const control = composer.getByRole("textbox", { name: new RegExp(`^${field.label}`, "u") }); // Each control is named by the form rather than by a placeholder, so every field states what it holds before it is filled; one loop fills the three the day's task needs and nothing else.
    await expect(control, `The composer names its ${JSON.stringify(field.label)} field.`).toBeVisible();
    await control.fill(field.value);
  }
  await composer.getByRole("button", { name: COMPOSER.create }).click();
  const receipt = composer.locator('[data-slot="operation-result"]'); // The durable in-context receipt, never a toast alone: one outcome, in the place the worker returns to. The outcome is read before it is asserted, so a refusal is reported with the words the composer gave it rather than as a missing element.
  await expect(receipt, "Creating the day's task records its outcome in the composer that submitted it.").toBeVisible();
  const outcome = await receipt.getAttribute("data-outcome");
  expect(outcome, `Creating the day's task is accepted. The composer stated ${JSON.stringify(outcome)}: ${(await composer.innerText()).replace(/\s+/gu, " ").slice(0, DETAIL_LIMIT)}`).toBe("accepted");
  await expect(receipt.getByRole("heading", { name: RECEIPT.saved })).toBeVisible();
  await composer.getByRole("button", { name: COMPOSER.done }).click();
  await expect(page.locator('[data-slot="task-composer"]'), "Dismissing the receipt closes the composer rather than leaving a second, settled form open.").toHaveCount(0);
}
async function runBulkIntent(page: Page, intent: string, panel: { readonly menu?: string; readonly region: string; readonly field: RegExp; readonly value: string }): Promise<void> {
  await clearBulkState(page); // Runs one bulk intent over the two selected rows: releasing the previous receipt, ticking the rows, the intent's own panel and the one review step every intent passes before anything is applied.
  await selectRows(page, [LINKED.title, SEEDED_TASK.overdue]);
  await page.getByRole("button", { name: intent }).click();
  if (panel.menu !== undefined) await page.getByRole("menuitem", { name: panel.menu }).click();
  const step = page.getByRole("region", { name: panel.region });
  await expect(step, "The intent opens its own panel, over the selection it will act on.").toBeVisible();
  await step.getByRole("textbox", { name: panel.field }).fill(panel.value);
  await page.getByRole("button", { name: REVIEW.confirm }).click();
}
test("every list states the whole result it holds and its page size, and the agenda groups dated work by the day it is due", async ({ page }) => {
  const today = SEEDED_TODAY;
  await createTaskDueToday(page, today);
  const totals = new Map<TaskListKey, number>();
  const statedTotals: string[] = [];
  for (const list of TASK_LISTS) {
    const region = await openList(page, list);
    const stated = await readPager(page);
    totals.set(list.key, stated.total);
    statedTotals.push(`${list.label} ${String(stated.total)}`);
    expect(stated.itemNoun, `The ${list.label} list counts its rows in the task noun the Work surface uses.`).toBe(PAGER.taskNoun);
    expect(stated.last, `The ${list.label} list states how many of its rows this page holds, and the table renders that many.`).toBe(await statedRows(region));
    expect(stated.total, `The ${list.label} list states a whole result no smaller than the rows its page holds.`).toBeGreaterThanOrEqual(stated.last);
    await expect(page.getByLabel(PAGER.rowsPerPage), `The ${list.label} list states the page size it is paging by, which is the documented default.`).toHaveValue(PAGER.pageSize);
    await expect(page.getByRole("table", { name: `${list.label} ${PAGER.taskNoun}` }), `The ${list.label} list renders the one table pattern under its own name.`).toBeVisible();
    await expectDevelopmentData(page);
  }
  await expect(rowOf(await openList(page, { key: "today", label: "Today" }), TODAY_TASK.title), `The task dated ${today} is the work Today holds, so the surface calls that day today.`).toBeVisible();
  await page.goto(AGENDA_HREF);
  const agenda = agendaRegion(page);
  await expect(agenda, "The dated agenda is a destination of its own, one level beside the lists.").toBeVisible();
  const agendaStated = await readPager(page);
  const dated = DATED_LIST_KEYS.reduce((sum, key) => sum + (totals.get(key) ?? 0), 0); // The dated open work the agenda groups is the same work Today, Upcoming and Overdue count: one partition of the work, read on a second surface.
  expect(agendaStated.itemNoun, "The agenda counts its rows in the same task noun the lists use.").toBe(PAGER.taskNoun);
  expect(agendaStated.total, `The agenda states the same dated open work the Today, Upcoming and Overdue lists count (${String(dated)}).`).toBe(dated);
  await expect(page.getByLabel(PAGER.rowsPerPage), "The agenda states the window it pages at, which is the documented cap.").toHaveValue("200");
  await expectDevelopmentData(page);
  const overdueRow = rowOf(agenda, SEEDED_TASK.overdue); // A row stands under the day it is due: the date it states is that civil day and nothing else, once per group, so no row is grouped by a midnight, an instant or a zone offset.
  await expect(overdueRow, "Work past its date is still open work, so the agenda groups it.").toBeVisible();
  await expect(overdueRow.locator(`time[datetime="${SEEDED_TASK.overdueDate}"]`), "The row states the civil day it is due.").toHaveCount(1);
  await expect(rowOf(agenda, MEETING.title).locator(`time[datetime="${MEETING.date}"]`), "A meeting is grouped by the day it is planned for, stated as that day.").toHaveCount(1);
  await expect(agenda.getByRole("heading", { name: /10 November 2026/u }), "The day that opens a group states the date in words, once for the group.").toHaveCount(1);
  await expect(agenda.locator(`time[datetime="${today}"]`).first(), "The task this journey created for today opens a day of its own.").toBeVisible();
  await expect(agenda.getByText(SEEDED_TASK.undated), "Undated work is never given a day to group it under.").toHaveCount(0);
  await expect(agenda.getByText(SEEDED_TASK.completed), "A completed task is closed work, so the agenda does not group it.").toHaveCount(0);
  recordEvidence(
    "criterion-5 lists and agenda",
    `At ${today}, the day the Work surface judged today, each of the five lists stated its whole result (${statedTotals.join(", ")}) and its page size ${PAGER.pageSize}, and the agenda stated ${String(agendaStated.total)} dated task(s) — the Today, Upcoming and Overdue lists added up — grouped by civil day.`,
  );
});
async function selectRows(page: Page, titles: readonly string[]): Promise<void> {
  for (const title of titles) await page.getByRole("checkbox", { name: `Select ${title}` }).check(); // Selects exactly the rows this file names, through the row controls the table pattern gives each one.
}
async function clearBulkState(page: Page): Promise<void> {
  const clearSelection = page.getByRole("button", { name: "Clear selection" }); // Releases a selection and dismisses a settled receipt, so the next bulk action starts from nothing.
  if ((await clearSelection.count()) > 0) await clearSelection.first().click();
  const dismiss = page.getByRole("button", { name: "Dismiss the result" });
  if ((await dismiss.count()) > 0) await dismiss.first().click();
}
test("completing a task takes it out of Today, reopening returns it, a category change moves only that task, and a planned meeting is never counted as held", async ({ page }) => {
  const today = SEEDED_TODAY;
  await createTaskDueToday(page, today);
  const all = await openList(page, { key: "all", label: "All" });
  const linkedBefore = await readTaskRow(all, LINKED.title); // The seeded task this test changes later, read off its row before anything touches it, so "the same values" is a comparison against what the list states rather than against a phrase in this file.
  await expect(rowOf(all, LINKED.title).getByText(LINKED.category, { exact: true }), "The seeded task carries the worker's own category label, which is the one value this test changes.").toBeVisible();
  const createdRow = rowOf(all, TODAY_TASK.title);
  await expect(createdRow, "The task created for today is the same task in All: one task model feeds every list.").toBeVisible();
  for (const text of [today, TODAY_TASK.category]) await expect(createdRow.getByText(text, { exact: true }), "The row states the civil day it is due and the category the task was given.").toBeVisible();
  await chooseRowAction(page, TODAY_TASK.title, "Complete");
  const completion = page.locator('[data-slot="task-action-result"][data-outcome="accepted"]');
  await expect(completion, "Completing a task is one accepted change, recorded in the row it changed.").toBeVisible();
  await expect(completion.locator('[data-slot="operation-result"][data-outcome="accepted"]'), "The receipt is the durable in-context result, not a toast.").toBeVisible();
  await expect(completion.getByRole("heading", { name: RECEIPT.saved })).toBeVisible();
  expect(await page.getByText("Completing or reopening a task records no contact, payment, fulfilment or message.").count(), "The surface states what completing a task does not prove, beside the action that completes it.").toBeGreaterThan(0);
  const completionRevision = await readReceiptRevision(completion.locator('[data-slot="operation-result"]')); // The revision the receipt states is the record's own, and the reopen below states a different one: an accepted change advances the revision the next change has to present.
  const created = await readTaskRow(all, TODAY_TASK.title);
  const createdActions = page.locator(`[data-slot="task-actions"][data-task-id="${created.taskId}"]`);
  await expect(createdActions, "The accepted change re-reads the list, so the row states the status the task now holds.").toHaveAttribute("data-status", "completed");
  await completion.getByRole("button", { name: "Dismiss this result" }).click();
  await expect(completion).toHaveCount(0);
  await page.getByRole("tab", { name: "Today" }).click(); // Today states the work still due, so completed work leaves it: an empty Today is a state of its own rather than the row it used to hold.
  await expect(page.locator('[data-slot="work-task-lists"]')).toHaveAttribute("data-list", "today");
  await expect(page.getByText("Nothing is due today"), "Today states that nothing is due rather than showing the completed row.").toBeVisible();
  await expect(page.getByRole("row", { name: TODAY_TASK.title }), "A completed task is not work still due today.").toHaveCount(0);
  const allForReopen = await openList(page, { key: "all", label: "All" });
  await chooseRowAction(page, TODAY_TASK.title, "Reopen");
  const reopening = page.locator('[data-slot="task-action-result"][data-outcome="accepted"]');
  await expect(reopening.getByRole("heading", { name: RECEIPT.saved }), "Reopening is accepted as one change and keeps its own receipt.").toBeVisible();
  await expect(createdActions, "The row states that the task is open work again.").toHaveAttribute("data-status", "reopened");
  const reopenedRow = rowOf(allForReopen, TODAY_TASK.title);
  for (const text of [today, TODAY_TASK.category]) await expect(reopenedRow.getByText(text, { exact: true }), "Reopening returns the same task with the same identifying values, and changes no label it carries.").toBeVisible();
  await expect(reopenedRow.getByText("Reopened"), "The row states the reopened status rather than an open one.").toBeVisible();
  const reopeningRevision = await readReceiptRevision(reopening.locator('[data-slot="operation-result"]'));
  expect(reopeningRevision, "An accepted change advances the revision the next change has to present, so the reopen states a different revision than the completion did.").not.toBe(completionRevision);
  await reopening.getByRole("button", { name: "Dismiss this result" }).click();
  await expect(rowOf(await openList(page, { key: "today", label: "Today" }), TODAY_TASK.title), "Reopened work is due today again, so Today holds it.").toBeVisible();
  await page.goto(`${PARTNER_ROUTE_PREFIX}/${LINKED.partner}`); // category changes: a task is work the worker owns, so a change to one must not appear as anything that happened with a partner.
  const activity = page.getByRole("region", { name: SECTION.activity });
  await expect(activity, "The partner's record states the activity that actually happened.").toBeVisible();
  const activityBefore = await activity.getByRole("listitem").count();
  expect(activityBefore, "The seeded partner has recorded activity, which is what makes an unchanged count mean something.").toBeGreaterThan(0);
  await expectDevelopmentData(page);
  await page.goto(WORK_HREF);
  const allForEdit = await openList(page, { key: "all", label: "All" });
  await chooseRowAction(page, LINKED.title, "Edit");
  const editor = page.getByRole("region", { name: COMPOSER.editHeading });
  await expect(editor, "Editing opens the one composer on the task the row names.").toBeVisible();
  await expect(editor.getByRole("textbox", { name: /^Title/u })).toHaveValue(LINKED.title);
  await expect(editor.getByRole("textbox", { name: /^Category/u }), "The composer opens on the values the task holds rather than on blank fields.").toHaveValue(LINKED.category);
  await editor.getByRole("textbox", { name: /^Category/u }).fill(LINKED.changedCategory);
  await editor.getByRole("button", { name: COMPOSER.save }).click();
  const edited = editor.locator('[data-slot="operation-result"][data-outcome="accepted"]');
  await expect(edited, "A category change is one accepted change to that task.").toBeVisible();
  await expect(edited.getByRole("heading", { name: RECEIPT.saved })).toBeVisible();
  const linkedAfter = await readTaskRow(allForEdit, LINKED.title); // The row the list renders after the change is the same task: found by its own title, stating the label the worker typed, at the same day and status it stood at before. No row, list or composer states a revision — the receipt is where that is stated.
  await expect(rowOf(allForEdit, LINKED.title).getByText(LINKED.changedCategory, { exact: true }), "The list states the label the task now carries.").toBeVisible();
  expect(linkedAfter.taskId, "A category is a label on the task and does not rewrite what the task is: the same task, under the same title.").toBe(linkedBefore.taskId);
  expect(linkedAfter.dueOn, "A category change leaves the due date where it was, so no date is invented for it.").toBe(linkedBefore.dueOn);
  expect(linkedAfter.status, "A category change changes no status, and completing or reopening is not implied by it.").toBe(linkedBefore.status);
  const editedRevision = await readReceiptRevision(edited);
  await editor.getByRole("button", { name: COMPOSER.done }).click();
  await page.goto(`${PARTNER_ROUTE_PREFIX}/${LINKED.partner}`);
  const activityAfter = page.getByRole("region", { name: SECTION.activity });
  await expect(activityAfter).toBeVisible();
  expect(await activityAfter.getByRole("listitem").count(), "Changing a task's category records no interaction, so the partner's activity is exactly what it was.").toBe(activityBefore);
  await expect(activityAfter.getByText(LINKED.title), "A task is never listed as activity: only something that happened is.").toHaveCount(0);
  await page.goto(WORK_HREF);
  const meeting = rowOf(await openList(page, { key: "all", label: "All" }), MEETING.title);
  await expect(meeting, "A meeting is one task on the same model as ordinary work.").toBeVisible();
  await expect(meeting.getByText("Meeting", { exact: true }), "The row states the kind of work it is.").toBeVisible();
  for (const text of ["Planned", MEETING.time, "Europe/London"]) await expect(meeting.getByText(text, { exact: true }), "A planned time is stated as planned, in its own clock time and its disclosed zone.").toBeVisible();
  await expect(meeting.getByText("Held", { exact: true }), "Nothing on the surface presents the planned meeting as held.").toHaveCount(0);
  await expect(page.getByText("A planned time is a plan, and a meeting counts as held only once an interaction records that it happened."), "The surface says in its own words what a planned time does and does not mean.").toBeVisible();
  await page.goto(`${PARTNER_ROUTE_PREFIX}/${MEETING.partner}`); // The partner's own measure surfaces count only what happened: the planned meeting is work still to do.
  const meetingActivity = page.getByRole("region", { name: SECTION.activity });
  await expect(meetingActivity).toBeVisible();
  await expect(meetingActivity.getByText(MEETING.title), "A planned meeting is not counted as a meeting that was held.").toHaveCount(0);
  const openWork = page.getByRole("region", { name: SECTION.openTasks });
  await expect(openWork, "The partner's record states the work still open with them.").toBeVisible();
  await expect(openWork.getByText(MEETING.title), "The planned meeting stands as work still to do rather than as something that happened.").toBeVisible();
  await expectDevelopmentData(page);
  recordEvidence(
    "criterion-5 follow-through",
    `Completed and reopened ${JSON.stringify(TODAY_TASK.title)} (${created.taskId}) due ${today}, whose two receipts stated revisions ${completionRevision} and ${reopeningRevision}; the category change on ${JSON.stringify(LINKED.title)} kept the task's day and status and its receipt stated revision ${editedRevision}, and the change left the partner's ${String(activityBefore)} recorded interactions untouched; the planned meeting on ${MEETING.date} at ${MEETING.time} ${PLANNED_MEETING_ZONE} was counted as open work and never as held.`,
  );
});
const SCROLL_PLACE_TOLERANCE_PX = 2; // How far a returned place may sit from the place the reader left: a settled layout can move a row by a pixel between the two readings, while anything larger is a different place on the list.
type ScrollPlace = { readonly offset: number; readonly height: number }; // One reader's place as the page states it: the offset they stand at and the height of the document they stand in, because a place reached only by a document shorter than the one they left is the clamp at its end rather than the place itself.
const scrollPlaceAt = (page: Page): Promise<ScrollPlace> => page.evaluate(() => ({ offset: window.scrollY, height: document.documentElement.scrollHeight }));
/** Reads the place a reader leaves a list at, with the row's own link brought into view exactly as the click requires, once the document has stopped growing. */
async function scrollPlaceOfRow(page: Page, link: Locator, subject: string): Promise<ScrollPlace> {
  await expect(async () => {
    await link.scrollIntoViewIfNeeded();
  }, `${subject} states the row's own link and can bring it into view, which is what makes the place the reader stands at one they can leave from.`).toPass({ timeout: 15_000 });
  let place = await scrollPlaceAt(page); // The height is sampled until it stops growing: a list fills after its first paint, and a place taken on a half-rendered document is not the place the reader leaves at.
  for (let sample = 0; sample < 12; sample += 1) {
    await page.waitForTimeout(250);
    const next = await scrollPlaceAt(page);
    if (next.height === place.height) return next;
    place = next;
  }
  return place;
}
/** Asserts the reader is back at the place they left: inside the list rather than at its top, within the tolerance, on a document at least as tall as the one they left. */
async function expectRestoredScrollPlace(page: Page, place: ScrollPlace, subject: string): Promise<void> {
  const restored = async (): Promise<number | undefined> => {
    const read = await scrollPlaceAt(page);
    return read.height >= place.height && Math.abs(read.offset - place.offset) <= SCROLL_PLACE_TOLERANCE_PX ? read.offset : undefined;
  };
  await expect.poll(restored, { message: `${subject} comes back at the ${String(place.offset)} px place the reader left, within ${String(SCROLL_PLACE_TOLERANCE_PX)} px of it, on a document at least as tall as the ${String(place.height)} px one it was left on.` }).toBeGreaterThan(0);
}
test("a record visit returns to the same filtered view, its same ordering and the reader's same place in it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 }); // A short window, so the list is longer than the viewport and the reader's place in it is a figure to return to rather than a zero on both sides of the visit.
  await page.goto(UPCOMING_HREF);
  await expect(page.locator('[data-slot="work-task-lists"]'), "The filter the address names is the list the surface shows.").toHaveAttribute("data-list", "upcoming");
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  const upcoming = taskRegion(page, "Upcoming");
  await expect(upcoming).toBeVisible();
  const orderedBy = upcoming.getByRole("columnheader", { name: PAGER.titleColumn, exact: true });
  await expect(orderedBy, "The ordering the address names is the ordering the surface shows.").toHaveAttribute("aria-sort", "ascending");
  const workPagerBefore = (await readPager(page)).text;
  const workFirstRowBefore = (await upcoming.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim();
  const visitLink = upcoming.locator('a[href^="/partners/"]').last(); // The last partner row the list states: the record is opened from the row as the reader sees it, so the place they leave is the one they were reading rather than one the click scrolls them away from.
  const visitHref = await visitLink.getAttribute("href"); // The address the row itself states, which is the record the visit has to open.
  if (visitHref === null) throw new Error("The row the reader opens states no destination, so the visit has no record to return from.");
  const workPlaceBefore = await scrollPlaceOfRow(page, visitLink, "The Upcoming list");
  expect(workPlaceBefore.offset, "The filtered list is longer than the window, which is what makes the reader's place in it something to return to.").toBeGreaterThan(0);
  await visitLink.click(); // The visit: the row's own link is the only route to the partner, so the record is a destination.
  await expect(page.getByRole("navigation", { name: "breadcrumb" }), "The record states the list it belongs to, so the visit is a navigation rather than a panel over the list.").toBeVisible();
  expect(new URL(page.url()).pathname, "The visit opens the record the row the reader clicked links to.").toBe(visitHref);
  await page.goBack();
  await expect(page.locator('[data-slot="work-task-lists"]'), "The same list comes back after the visit.").toHaveAttribute("data-list", "upcoming");
  await expect(page, "The address keeps the filter and the ordering the visit started from.").toHaveURL(/list=upcoming/u);
  await expect(page).toHaveURL(/sort=title(:|%3A)asc/u);
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  await expect(orderedBy, "The ordering comes back as it was.").toHaveAttribute("aria-sort", "ascending");
  expect((await readPager(page)).text, "The page window comes back exactly as it was.").toBe(workPagerBefore);
  await expect(upcoming.getByRole("row").nth(1)).toBeVisible();
  expect((await upcoming.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim(), "The same rows are in the same order after the return.").toBe(workFirstRowBefore);
  await expectRestoredScrollPlace(page, workPlaceBefore, "The return to the Upcoming list");
  const workPlaceAfter = await scrollPlaceAt(page);
  await page.goto(WORK_HREF); // The surface, then the list's own address: a fresh arrival rather than a step back through history, which no browser restores a place for, so the place the reader is put back at here is the application's own record of it.
  await page.goto(UPCOMING_HREF);
  await expect(page.locator('[data-slot="work-task-lists"]'), "The list's own address is the filtered view the reader left.").toHaveAttribute("data-list", "upcoming");
  await expectRestoredScrollPlace(page, workPlaceBefore, "Reopening the Upcoming list at its own address");
  await expectDevelopmentData(page);
  await page.goto(AGENDA_HREF);
  const agenda = agendaRegion(page);
  await expect(agenda, "The dated agenda is a list destination of its own.").toBeVisible();
  const agendaPagerBefore = (await readPager(page)).text;
  const agendaFirstRowBefore = (await agenda.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim();
  const agendaVisitLink = agenda.locator('a[href^="/partners/"]').last(); // The last partner row the agenda groups, opened from the row as the reader sees it for the same reason: the place they leave is the one they were reading.
  const agendaPlaceBefore = await scrollPlaceOfRow(page, agendaVisitLink, "The dated agenda");
  expect(agendaPlaceBefore.offset, "The agenda is longer than the window, so its place is something to return to as well.").toBeGreaterThan(0);
  await agendaVisitLink.click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toBeVisible();
  await expect(page).toHaveURL(/\/partners\/[^?/]+/u);
  await page.goBack();
  await expect(page, "The agenda returns at the address it was left at.").toHaveURL(/\/work\/agenda$/u);
  await expect(agenda, "The same agenda comes back after the visit.").toBeVisible();
  expect((await readPager(page)).text, "The agenda's page window comes back exactly as it was.").toBe(agendaPagerBefore);
  await expect(agenda.getByRole("row").nth(1)).toBeVisible();
  expect((await agenda.getByRole("row").nth(1).innerText()).replace(/\s+/gu, " ").trim(), "The same days and rows come back in the same order.").toBe(agendaFirstRowBefore);
  await expectRestoredScrollPlace(page, agendaPlaceBefore, "The return to the dated agenda");
  const agendaPlaceAfter = await scrollPlaceAt(page);
  await page.goto(WORK_HREF); // And the agenda's own address, reached the same way: no history entry holds a place for it, so the place it comes back at is the one the application kept.
  await page.goto(AGENDA_HREF);
  await expect(agenda, "The agenda's own address is the agenda the reader left.").toBeVisible();
  await expectRestoredScrollPlace(page, agendaPlaceBefore, "Reopening the dated agenda at its own address");
  await expectDevelopmentData(page);
  recordEvidence(
    "criterion-5 continuity",
    `A partner-record visit and return restored the Work list's filter (upcoming), its ordering (title ascending), its page window (${workPagerBefore}) and the reader's place ${String(workPlaceAfter.offset)} px down a list they left at ${String(workPlaceBefore.offset)} px in a ${String(workPlaceBefore.height)} px document, and the agenda's window (${agendaPagerBefore}) and the reader's place ${String(agendaPlaceAfter.offset)} px down an agenda they left at ${String(agendaPlaceBefore.offset)} px in a ${String(agendaPlaceBefore.height)} px document. Each return landed within ${String(SCROLL_PLACE_TOLERANCE_PX)} px of the place the reader left, on a document at least as tall as the one it was left on, which is the scroll position the criterion requires to survive the visit, and each place came back again when the list's own address was opened as a fresh arrival rather than a step back through history.`,
  );
});
test("the three bulk actions review the selection first and report each row's own result", async ({ page, request }) => {
  const partnerRecordBefore = await readEnvelope(request, `${PARTNER_API_PREFIX}/${LINKED.partner}?job=record`); // What a selection must never change: a private tag on a task is that task's own label, so the partner's record and the publisher's audience are read before the run and compared against afterwards. The audience is read off the page that states its counts; the partner's tags are the one record read no surface the journey visits states.
  const partnerTagsBefore = listOf(objectOf(objectOf(partnerRecordBefore["data"], "The partner record read's data")["partner"], "The partner's own record")["tags"], "The partner's tags");
  const audienceBefore = await readAudience(page);
  await page.goto(WORK_HREF);
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
  const all = await openList(page, { key: "all", label: "All" });
  const linked = await readTaskRow(all, LINKED.title); // Each row states the task its own actions act on, which is the identity every result below is reported by.
  const thankYou = await readTaskRow(all, SEEDED_TASK.overdue);
  const completed = await readTaskRow(all, SEEDED_TASK.completed);
  await expect(page.locator('[data-slot="bulk-action-bar"]'), "With no row selected the surface offers no bulk action at all.").toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bulk actions" }), "A selection is what a bulk action acts on, so the bar is not there to invite one.").toHaveCount(0);
  await selectRows(page, [LINKED.title, SEEDED_TASK.overdue]);
  await expect(page.getByRole("heading", { name: "Bulk actions" }), "A selection opens the one bulk bar over the rows that were ticked.").toBeVisible();
  await expect(page.getByText(/Rows selected:\s*2\./u), "The bar states how many rows the selection holds, and that only they are affected.").toBeVisible();
  await expect(page.getByText("A selection is not an audience, not a consent and not a campaign", { exact: false }).first(), "The bar says in its own words what a selection is not.").toBeVisible();
  await page.getByRole("button", { name: BULK.tagIntent }).click();
  await page.getByRole("menuitem", { name: BULK.applyTag }).click();
  const tagPanel = page.getByRole("region", { name: BULK.applyTag });
  await expect(tagPanel, "The intent opens its own panel, over the selection it will act on.").toBeVisible();
  await expect(tagPanel.getByRole("textbox", { name: new RegExp(`^${REVIEW.tagField}`, "u") }), "The tag field is named, so the value this action applies is stated before it is applied.").toBeVisible();
  await tagPanel.getByRole("textbox", { name: /^Private tag/u }).fill(REVIEW.tag);
  const tagReview = page.getByRole("region", { name: REVIEW.heading });
  await expect(tagReview, "Each intent passes the one review step before anything is applied.").toBeVisible();
  await expect(tagReview.getByText(/Selected:\s*2\s*rows?\./u), "The review step summarises the selection before anything is applied.").toBeVisible();
  await page.getByRole("button", { name: REVIEW.confirm }).click();
  const tagged = page.locator('[data-slot="operation-result"][data-outcome="accepted"]');
  await expect(tagged, "Applying the tag is one accepted change, reported per row.").toBeVisible();
  await expect(tagged.getByText(RECEIPT.perItem), "The receipt reports one result per selected row.").toBeVisible();
  const taggedRows = tagged.locator("table tbody tr");
  await expect(taggedRows, "The result lists one row per selected task rather than one aggregate outcome.").toHaveCount(2);
  const taggedText = (await taggedRows.allInnerTexts()).join(" | ");
  expect(taggedText, "Each reported row names the task it changed, so the rows are read one at a time.").toContain(linked.taskId);
  expect(taggedText).toContain(thankYou.taskId);
  for (let index = 0; index < 2; index += 1) await expect(taggedRows.nth(index), "Every selected row states its own outcome, and both were accepted.").toContainText(RECEIPT.accepted);
  await runBulkIntent(page, BULK.tagIntent, { menu: BULK.applyTag, region: BULK.applyTag, field: /^Private tag/u, value: REVIEW.tag }); // The rows stay selected while their receipt is on screen — the bar is rendered only over a selection, so releasing them on acceptance would unmount the only record of what the action did — and dismissing the result is what releases them.
  await expect(page.locator('[data-slot="action-review-result"][data-outcome="unchanged"]').getByRole("heading", { name: RECEIPT.nothingToChange }), "Re-applying the same private tag changes nothing, which is how the tag's presence is read back from the application rather than assumed.").toBeVisible();
  await runBulkIntent(page, BULK.tagIntent, { menu: BULK.removeTag, region: BULK.removeTag, field: /^Private tag/u, value: REVIEW.tag });
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]').locator("table tbody tr"), "Removing the tag is reported per row as well.").toHaveCount(2);
  await runBulkIntent(page, BULK.followUpIntent, { region: BULK.followUpIntent, field: /^Title/u, value: REVIEW.followUpTitle });
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]').locator("table tbody tr"), "One follow-up task per selected row, each reported.").toHaveCount(2);
  await expect(all.getByRole("row", { name: REVIEW.followUpTitle }), "The two follow-up tasks are ordinary open work in the same list.").toHaveCount(2);
  await clearBulkState(page);
  await selectRows(page, [SEEDED_TASK.completed]); // only a closed row leaves this action nothing to act on: it is not offered, and the reason is stated beside it rather than left to be discovered by pressing it.
  const completeIntent = page.getByRole("button", { name: BULK.completeIntent });
  await expect(completeIntent, "A closed row cannot be completed on its own, so with only that row selected the action is not offered.").toBeDisabled();
  await expect(page.getByText("A task is completed only while it is open or reopened, so a row that is already completed or cancelled is left as it is."), "The reason a closed row cannot be completed on its own is stated beside the action it belongs to.").toBeVisible();
  await selectRows(page, [SEEDED_TASK.overdue]);
  await expect(completeIntent, "An open row gives the action something to act on.").toBeEnabled();
  await completeIntent.click();
  const completeReview = page.getByRole("region", { name: REVIEW.heading });
  await expect(completeReview.getByText(/Selected:\s*1\s*rows?\./u), "The review step states the rows the action can act on.").toBeVisible();
  await expect(completeReview.getByText(/Excluded before this step:\s*1\s*rows?\./u), "A selected row this action cannot act on is reported as excluded, with its reason, before anything is applied.").toBeVisible();
  await page.getByRole("button", { name: REVIEW.confirm }).click();
  const completedRows = page.locator('[data-slot="operation-result"][data-outcome="accepted"]').locator("table tbody tr"); // The receipt is read wherever the surface states it: once every selected row has been acted on, the review step has nothing left to review and the durable result stands on its own beneath it.
  await expect(completedRows, "The result holds one row for each selected row: the acted-on one accepted, the other excluded.").toHaveCount(2);
  const acceptedRow = completedRows.filter({ hasText: RECEIPT.accepted });
  await expect(acceptedRow, "Exactly one row was acted on.").toHaveCount(1);
  await expect(acceptedRow, "The row the action could act on was accepted.").toContainText(RECEIPT.accepted);
  const completedText = await acceptedRow.innerText();
  expect(completedText, "The row reported is the open task the action acted on.").toContain(thankYou.taskId);
  expect(completedText, "The closed row is not reported as a completed one.").not.toContain(completed.taskId);
  await expect(completedRows.filter({ hasText: completed.taskId }), "The closed row the action could not act on is stated in the result as excluded.").toHaveCount(1);
  await expect(page.locator(`[data-slot="task-actions"][data-task-id="${completed.taskId}"]`), "A row this action could not act on keeps the status it had.").toHaveAttribute("data-status", "completed");
  await expect(page.locator(`[data-slot="task-actions"][data-task-id="${thankYou.taskId}"]`), "The row it did act on states the status the change produced.").toHaveAttribute("data-status", "completed");
  const partnerTagsAfter = listOf(objectOf(objectOf((await readEnvelope(request, `${PARTNER_API_PREFIX}/${LINKED.partner}?job=record`))["data"], "The partner record read's data")["partner"], "The partner's own record")["tags"], "The partner's tags");
  expect(partnerTagsAfter, "A private tag on a task is the task's own label: the partner's record is exactly what it was.").toEqual(partnerTagsBefore);
  expect(partnerTagsAfter, "The tag applied by bulk is nowhere on the partner's record, so it is not a partner tag.").not.toContain(REVIEW.tag);
  expect(await readAudience(page), "A selection is not an audience: no membership was added, confirmed, restricted or switched off.").toEqual(audienceBefore);
  await expectDevelopmentData(page);
  recordEvidence(
    "criterion-5 bulk actions",
    `Three bulk intents over explicitly selected rows: the private tag ${JSON.stringify(REVIEW.tag)} applied twice (accepted, then unchanged) and removed, ${String(2)} follow-up tasks created from ${String(2)} rows, and completion run over a selection holding one closed row — reported as 1 row acted on and 1 excluded before the step, with the closed row left completed. The partner's tags and the audience were unchanged by the selection.`,
  );
});
