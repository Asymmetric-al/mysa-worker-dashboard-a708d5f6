/** Criterion 13 — recurring follow-through. */ import type { Locator, Page } from "@playwright/test";
import { arrayAt, expect, fieldAt, jsonOf, newAttemptId, numberAt, outcomeOf, recordAt, recordsAt, setClock, stringAt, test, type JsonRecord } from "../playwright.config"; // The runner's own `test` carries the automatic `seedReset` fixture, which admits this file's seeded identity and restores the deterministic seed before every case: without it a case would assert against the world the one before it left. `expect` and the JSON helpers come from the same module, so one import states the runner this file uses.
const MONTH_END_SERIES = "series-month-end-support-review";
const MONTH_END_TITLE = "Month-end support review";
const MISSED_PLAN_SERIES = "series-missed-plan-review"; // The plan carrying several dates that passed without an action.
const MISSED_PLAN_TITLE = "Monday review of the working list";
const PLANNING_ZONE = "Europe/London";
const TASK_PAGE_SIZE = 200; // How many rows that read admits on one page, mirrored from the documented cap so a truncated answer is refused rather than counted.
const PLAN_REVIEW_HEADING = "Plan needs review";
const FUTURE_PLAN = { title: "QA smoke repeated plan", firstDue: "2027-01-31", endOn: "2027-06-30", profile: "Monthly on a set day", ruleLabel: "Monthly on day 31", revisedProfile: "Every few months", revisedRuleLabel: "Every 2 months on day 15" } as const; // The plan this file creates through that section: a monthly rule whose first due date is still ahead of the scenario's today, which is the case a prospective revision has to be presented a boundary for. The profile names are what the closed chooser states; the rule labels are what the plan itself states, with the rule's own numbers.
const AWAITING_ACTION: ReadonlySet<string> = new Set<string>(["open", "reopened"]);
type PlanSnapshot = { readonly revision: string; readonly scope: JsonRecord; readonly data: JsonRecord }; // One plan's read, as the envelope the surface is rendered from: its revision, its facts and the actions it published.
async function readPlan(page: Page, seriesId: string): Promise<PlanSnapshot> {
  const answer = await page.request.get(`/api/series?seriesId=${encodeURIComponent(seriesId)}`);
  const body = await jsonOf(answer, `GET /api/series?seriesId=${seriesId}`);
  return { revision: stringAt(body, ["revision"], "The plan's own revision"), scope: recordAt(body, ["scope"], "The scope the plan was read in"), data: recordAt(body, ["data"], "The plan's facts") };
}
async function postPlanMutation(page: Page, authority: PlanSnapshot, payload: JsonRecord): Promise<unknown> {
  const answer = await page.request.post("/api/series", { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.revision, payload } }); // Presents one named plan mutation under a stated authority, and answers the one outcome it produced.
  return jsonOf(answer, `POST /api/series ${String(payload.mutation)}`);
}
async function readOccurrences(page: Page, seriesId: string): Promise<readonly JsonRecord[]> {
  const answer = await page.request.get(`/api/tasks?list=all&displayTimeZone=${encodeURIComponent(PLANNING_ZONE)}&pageSize=200`); // Every occurrence of one plan, as the task list the application itself reads states it.
  const body = await jsonOf(answer, "GET /api/tasks");
  const total = numberAt(body, ["data", "total"], "The task list's total");
  const pageCount = numberAt(body, ["data", "pageCount"], "The task list's page count");
  if (pageCount > 1 || total > TASK_PAGE_SIZE) {
    throw new Error(`The task list answered ${String(total)} rows over ${String(pageCount)} page(s), so one page does not hold every row and a count taken from it would not be the plan's own. This file counts occurrences from that read, so it stops rather than reporting a number it cannot stand behind.`);
  }
  return recordsAt(body, ["data", "tasks"], "The task list's rows").filter((row) => fieldAt(row, "seriesId") === seriesId);
}
const datesOf = (rows: readonly JsonRecord[]): readonly string[] => rows.map((row) => stringAt(row, ["dueOn"], "An occurrence's due date")).toSorted(); // The dates one plan's occurrences stand at, in order: one row per date, never a date counted twice.
function statusOn(rows: readonly JsonRecord[], dueOn: string): string | undefined {
  const row = rows.find((candidate) => fieldAt(candidate, "dueOn") === dueOn); // The status one plan recorded for the occurrence on a date, or `undefined` where the plan holds no date there.
  return row === undefined ? undefined : stringAt(row, ["status"], "An occurrence's recorded status");
}
const awaitingAnswer = (rows: readonly JsonRecord[]): readonly JsonRecord[] => rows.filter((row) => AWAITING_ACTION.has(stringAt(row, ["status"], "An occurrence's recorded status")));
async function openPlan(page: Page, seriesId: string, title: string): Promise<void> {
  await page.goto(`/work/series/${encodeURIComponent(seriesId)}`); // Opens one plan's own surface and waits for its record body to state the plan's title.
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}
const previewSection = (page: Page): Locator => page.locator('[data-slot="series-plan-preview"]');
const nextDates = (page: Page): Locator => previewSection(page).getByRole("list", { name: "Next three scheduled dates" });
const datesWithStatus = (page: Page, status: "Actionable" | "Preview"): Locator => nextDates(page).getByRole("listitem").filter({ hasText: status });
const commandReceipt = (page: Page, command: string): Locator => page.locator(`[data-slot="occurrence-command"][data-command="${command}"]`).locator('[data-slot="occurrence-command-result"]');
/** The identifier in a plan's own address, taken from the address the browser is on rather than typed here. */ function seriesIdOf(url: string): string {
  const last = new URL(url).pathname
    .split("/")
    .filter((segment) => segment !== "")
    .at(-1);
  if (last === undefined) throw new Error(`The browser is on ${url}, which names no plan, so nothing this test asserts could describe the plan it created.`);
  return decodeURIComponent(last);
}
type RevisionMarkerHost = { revisionBoundaryMarker?: string }; // What this file leaves in the document before a change: a page load hands back a document holding none of it.
const REVISION_MARKER_VALUE = "kept"; // The value the marker holds while the document that was set it is still the one on screen.
test("a plan states its closed rule, one actionable date among previews, and the final day a month actually has", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(page.getByText("Development data", { exact: true }).first(), "Every record here is synthetic and every external effect simulated, and the shell says so on every surface").toBeVisible();
  const occurrenceGroup = page.locator('[data-slot="occurrence-actions"]');
  await expect(occurrenceGroup).toHaveAttribute("data-occurrence", "actionable");
  await expect(occurrenceGroup.locator('time[datetime="2026-11-30"]')).toBeVisible();
  await expect(previewSection(page).getByRole("heading", { name: "Schedule & upcoming dates" }), "The rule's next three dates. November has no 31st, so the first of them is that month's final day, and the resolution is stated beside the date rather than used silently").toBeVisible();
  await expect(previewSection(page).getByText(/Planning time zone:\s*Europe\/London/u)).toBeVisible();
  await expect(nextDates(page).getByRole("listitem")).toHaveCount(3);
  await expect(datesWithStatus(page, "Actionable")).toHaveCount(1);
  await expect(datesWithStatus(page, "Preview")).toHaveCount(2);
  await expect(datesWithStatus(page, "Actionable").locator('time[datetime="2026-11-30"]')).toBeVisible();
  await expect(previewSection(page).getByText(/Day 31 doesn’t exist in November, so the last day of the month is used/u)).toBeVisible();
  await page.getByRole("button", { name: "Edit this and future", exact: true }).click();
  const revisionForm = page.locator('[data-slot="series-revision-form"]');
  await expect(revisionForm).toBeVisible();
  const profiles = revisionForm.getByRole("combobox", { name: "Repeat", exact: true });
  const chosenProfile = profiles.locator('[data-slot="select-value"]');
  await expect(chosenProfile, "A longer closed choice, so the profile is the styled Select: a combobox whose trigger states the chosen profile's own label, and a listbox holding exactly the five profiles in the order the closed rule offers them").toHaveText("Monthly on a set day");
  await profiles.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["Does not repeat", "Weekly", "Every few weeks", "Monthly on a set day", "Every few months"]);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="select-content"]')).toBeHidden();
  await expect(chosenProfile).toHaveText("Monthly on a set day");
  await expect(revisionForm.getByText("In shorter months (like February), the last day of the month is used and noted clearly."), "A day a month does not have uses that month's final day, and the editor says so where the day is chosen").toBeVisible();
  await expect(revisionForm.getByText("Takes effect from").first(), "The change states the boundary it applies from before it is applied").toBeVisible();
  await expect(revisionForm.locator('time[datetime="2026-11-20"]')).toBeVisible();
  const zone = revisionForm.getByLabel("Planning time zone");
  const refusals = page.locator('[data-slot="form-error-summary"]');
  await zone.fill("");
  await revisionForm.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(refusals).toContainText("Choose the timezone this time is stated in");
  await expect(page.locator('[data-slot="occurrence-command-result"]'), "A refused form submits nothing").toHaveCount(0);
  await zone.fill(PLANNING_ZONE);
  await revisionForm.getByRole("combobox", { name: "Ends", exact: true }).selectOption("on-date");
  await revisionForm.getByLabel("End date").fill("");
  await revisionForm.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(refusals).toContainText("Please check these details");
  await expect(page.locator('[data-slot="occurrence-command-result"]'), "A refused end submits nothing").toHaveCount(0);
  const unchanged = await readPlan(page, MONTH_END_SERIES);
  expect(recordAt(unchanged.data, ["rule"], "The rule in force"), "Neither refusal saved anything").toEqual({ profile: "monthlyOnDay", interval: 1, dayOfMonth: 31, firstDueOn: "2026-08-31", planningTimeZone: PLANNING_ZONE, end: { kind: "ongoing-personal-policy" } });
  expect(recordsAt(unchanged.data, ["effectiveRevisions"], "The rule revisions"), "A refused change revises no rule").toHaveLength(1);
  await revisionForm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(revisionForm).toHaveCount(0);
  await setClock(page.request, "2026-12-01T00:00:00Z");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(nextDates(page).getByRole("listitem")).toHaveCount(3);
  await expect(nextDates(page).locator('time[datetime="2027-02-28"]')).toBeVisible();
  await expect(previewSection(page).getByText(/Day 31 doesn’t exist in February, so the last day of the month is used/u)).toBeVisible();
  expect(arrayAt((await readPlan(page, MONTH_END_SERIES)).data, ["preview", "dates"], "The dates the rule produces next"), "The screen states the dates the read computed").toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
  await page.goto("/settings"); // A due date is a civil date, so a display-zone change moves none of them: the plan's dates are judged in the plan's own zone, and the surface states that zone rather than the browser's.
  await expect(page.getByRole("heading", { name: "Display & time zone" })).toBeVisible();
  const displayZone = page.getByRole("combobox", { name: "Display time zone" });
  await expect(displayZone).toBeVisible();
  await displayZone.selectOption("Pacific/Kiritimati");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(nextDates(page).locator('time[datetime="2026-12-31"]')).toBeVisible();
  await expect(nextDates(page).locator('time[datetime="2027-02-28"]')).toBeVisible();
  await expect(page.locator('[data-slot="occurrence-actions"]').locator('time[datetime="2026-11-30"]')).toBeVisible();
  await expect(previewSection(page).getByText(/Planning time zone:\s*Europe\/London/u)).toBeVisible();
  await setClock(page.request, "2026-11-20T00:00:00Z");
});
test("completing one date admits exactly one successor, and skipping one is not completing it", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  expect(stringAt((await readPlan(page, MONTH_END_SERIES)).data, ["actionableOccurrenceId"], "The date this plan admits an answer for")).toBe("task-series-month-end");
  const seededOccurrences = await readOccurrences(page, MONTH_END_SERIES);
  expect(datesOf(seededOccurrences)).toEqual(["2026-11-30"]);
  expect(statusOn(seededOccurrences, "2026-11-30")).toBe("open");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(commandReceipt(page, "Complete")).toHaveAttribute("data-outcome", "accepted");
  await expect(commandReceipt(page, "Complete")).toContainText("Completed occurrence");
  await expect(page.locator('[data-slot="occurrence-command"][data-command="Complete"]'), "Completing records that the work was closed, and the receipt says what that does not prove").toContainText("without logging an interaction, gift, or email");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const completed = await readOccurrences(page, MONTH_END_SERIES);
  expect(datesOf(completed), "Completing the date admitted exactly one successor").toEqual(["2026-11-30", "2026-12-31"]);
  expect(statusOn(completed, "2026-11-30"), "The answered date is recorded as completed").toBe("completed");
  expect(statusOn(completed, "2026-12-31"), "The successor is the next date the rule produces").toBe("open");
  expect(awaitingAnswer(completed), "Only one date is actionable at a time").toHaveLength(1);
  const afterComplete = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(afterComplete.data, ["currentOccurrence", "dueOn"], "The date the plan now answers for")).toBe("2026-12-31");
  expect(stringAt(afterComplete.data, ["currentOccurrence", "taskId"], "The date the plan now answers for"), "The successor is a new date, not the completed one").not.toBe("task-series-month-end");
  await expect(datesWithStatus(page, "Actionable")).toHaveCount(1);
  await expect(datesWithStatus(page, "Actionable").locator('time[datetime="2026-12-31"]')).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(commandReceipt(page, "Skip")).toHaveAttribute("data-outcome", "accepted");
  await expect(page.locator('[data-slot="occurrence-command"][data-command="Skip"]')).toContainText("without marking the task completed or logging activity");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const skipped = await readOccurrences(page, MONTH_END_SERIES);
  expect(datesOf(skipped), "Skipping the date admitted exactly one successor").toEqual(["2026-11-30", "2026-12-31", "2027-01-31"]);
  expect(statusOn(skipped, "2026-12-31"), "A skipped date is not a completed date").toBe("cancelled");
  expect(statusOn(skipped, "2027-01-31")).toBe("open");
  expect(awaitingAnswer(skipped), "One successor, and no catch-up stack beside it").toHaveLength(1);
  expect(stringAt((await readPlan(page, MONTH_END_SERIES)).data, ["planReview", "state"], "How the plan stands"), "A plan whose dates were answered is not awaiting a review").toBe("on-track");
  await expect(page.getByRole("heading", { name: PLAN_REVIEW_HEADING })).toHaveCount(0);
  await expect(page.locator('[data-slot="plan-needs-review-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="actionable"]')).toHaveCount(1);
});
test("several missed dates open the plan's own review, and its resolution restores one actionable date", async ({ page }) => {
  await openPlan(page, MISSED_PLAN_SERIES, MISSED_PLAN_TITLE);
  const plan = await readPlan(page, MISSED_PLAN_SERIES);
  expect(stringAt(plan.data, ["planReview", "state"], "How the plan stands")).toBe("needs-review");
  const missed = numberAt(plan.data, ["planReview", "missedDateCount"], "The dates that passed without an action");
  expect(missed, "Several dates passed without an action").toBeGreaterThanOrEqual(3);
  const panel = page.locator('[data-slot="plan-needs-review-panel"][data-plan-state="needs-review"]');
  await expect(panel, "The plan, not a backlog: the review states the count the read computed and says the dates are not listed as overdue work to clear one at a time").toHaveCount(1);
  await expect(panel.getByRole("heading", { name: PLAN_REVIEW_HEADING })).toBeVisible();
  for (const said of [`${String(missed)} dates passed without action.`, "Instead of stacking overdue tasks, choose how you’d like this plan to continue."]) await expect(panel).toContainText(said);
  expect(awaitingAnswer(await readOccurrences(page, MISSED_PLAN_SERIES)), "The missed dates are not a stack of copies").toHaveLength(1);
  const resolutions = panel.getByRole("radio");
  await expect(resolutions).toHaveCount(3);
  for (const [index, resolution] of ["Keep this occurrence", "Move next date forward", "Stop plan"].entries()) await expect(resolutions.nth(index)).toHaveAccessibleName(resolution);
  await resolutions.nth(1).click();
  const review = panel.locator('[data-slot="action-review"]');
  await expect(review).toBeVisible();
  await expect(review.getByRole("heading", { name: "Move next date forward" })).toBeVisible();
  for (const said of [`Covers ${String(missed)} missed dates. Updates only this repeating plan without logging contact or marking past tasks done.`]) await expect(review).toContainText(said);
  await review.getByRole("button", { name: "Apply this resolution", exact: true }).click();
  const settledPanel = page.locator('[data-slot="plan-needs-review-panel"]');
  await expect(settledPanel.locator('[data-slot="action-review-result"]'), "The plan is re-read once its resolution settles, so the review states that it is settled and keeps the receipt of what it applied beside it rather than unmounting the review that produced it").toHaveAttribute("data-outcome", "accepted");
  await expect(page.locator('[data-slot="plan-needs-review-panel"][data-plan-state="settled"]'), "The review states that it is settled once its resolution has been applied and the plan re-read.").toHaveCount(1);
  await expect(settledPanel.getByRole("heading", { name: "Plan updated" })).toBeVisible();
  await openPlan(page, MISSED_PLAN_SERIES, MISSED_PLAN_TITLE);
  await expect(page.locator('[data-slot="plan-needs-review-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="actionable"]')).toHaveCount(1);
  const settled = await readPlan(page, MISSED_PLAN_SERIES);
  expect(stringAt(settled.data, ["planReview", "state"], "How the plan stands after its review")).toBe("on-track");
  expect(stringAt(settled.data, ["currentOccurrence", "dueOn"], "The date the plan now answers for"), "The resolution moved the plan's next date forward").toBe("2026-11-26");
  expect(stringAt(settled.data, ["currentOccurrence", "status"], "The date the plan now answers for")).toBe("open");
  await expect(page.locator('[data-slot="occurrence-actions"]').locator('time[datetime="2026-11-26"]')).toBeVisible();
  const settledOccurrences = await readOccurrences(page, MISSED_PLAN_SERIES);
  expect(datesOf(settledOccurrences), "The resolution performed nothing: the plan holds one occurrence, and none of the dates that passed gained a completion or an interaction it never had").toEqual(["2026-11-26"]);
  expect(statusOn(settledOccurrences, "2026-11-26")).toBe("open");
});
test("one date changes on its own, and a change from a boundary revises the rule without rewriting what came before", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const before = await readPlan(page, MONTH_END_SERIES);
  const ruleBefore = recordAt(before.data, ["rule"], "The rule in force");
  expect(ruleBefore).toEqual({ profile: "monthlyOnDay", interval: 1, dayOfMonth: 31, firstDueOn: "2026-08-31", planningTimeZone: PLANNING_ZONE, end: { kind: "ongoing-personal-policy" } });
  expect(recordsAt(before.data, ["effectiveRevisions"], "The rule revisions"), "A seeded plan starts with the rule it was planned under").toHaveLength(1);
  const occurrenceTaskId = stringAt(before.data, ["currentOccurrence", "taskId"], "The occurrence the plan answers for");
  await page.getByRole("button", { name: "Edit this occurrence", exact: true }).click();
  const occurrenceForm = page.locator('[data-slot="occurrence-edit-form"]');
  await expect(occurrenceForm).toBeVisible();
  await occurrenceForm.getByLabel("Title").fill("Month-end support review, this date only");
  await occurrenceForm.getByRole("button", { name: "Save this occurrence", exact: true }).click();
  await expect(occurrenceForm.locator('[data-slot="occurrence-command-result"]')).toHaveAttribute("data-outcome", "accepted");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const edited = await readPlan(page, MONTH_END_SERIES);
  expect(recordAt(edited.data, ["rule"], "The rule in force"), "A change to one date leaves the rule alone").toEqual(ruleBefore);
  expect(recordsAt(edited.data, ["effectiveRevisions"], "The rule revisions"), "A change to one date revises no rule").toHaveLength(1);
  expect(stringAt(edited.data, ["currentOccurrence", "title"], "The title of the date that changed")).toBe("Month-end support review, this date only");
  expect(stringAt(edited.data, ["currentOccurrence", "taskId"], "The date that changed")).toBe(occurrenceTaskId);
  expect(stringAt(edited.data, ["currentOccurrence", "dueOn"], "The date that changed")).toBe("2026-11-30");
  await page.getByRole("button", { name: "Edit this and future", exact: true }).click();
  const revisionForm = page.locator('[data-slot="series-revision-form"]');
  await expect(revisionForm).toBeVisible();
  await expect(revisionForm.locator('time[datetime="2026-11-20"]')).toBeVisible();
  await expect(revisionForm.getByText("This is a prospective revision: the dates before that boundary keep the rule they were planned under, and completed history is untouched.")).toBeVisible();
  await revisionForm.getByRole("combobox", { name: "Ends", exact: true }).selectOption("after-count");
  await revisionForm.getByLabel("Number of occurrences").fill("12");
  await revisionForm.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(revisionForm.locator('[data-slot="occurrence-command-result"]')).toHaveAttribute("data-outcome", "accepted");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const revised = await readPlan(page, MONTH_END_SERIES);
  const revisions = recordsAt(revised.data, ["effectiveRevisions"], "The rule revisions");
  expect(revisions, "The revision is a new rule, not a replacement of the first").toHaveLength(2);
  expect(stringAt(revisions[0], ["effectiveFrom"], "The boundary the first revision applies from")).toBe("2026-08-31");
  expect(recordAt(revisions[0], ["rule"], "The rule the first revision states"), "The earlier rule is preserved exactly").toEqual(ruleBefore);
  expect(stringAt(revisions[1], ["effectiveFrom"], "The boundary the change takes effect from"), "The boundary is the one the surface stated").toBe("2026-11-20");
  expect(recordAt(revisions[1], ["rule", "end"], "The end the new revision states"), "The plan now states a number of occurrences as its end").toEqual({ kind: "after-count", count: 12 });
  expect(stringAt(revisions[1], ["rule", "profile"], "The repeat profile the new revision states")).toBe("monthlyOnDay");
  expect(stringAt(revised.data, ["currentOccurrence", "taskId"], "The date the plan answers for"), "The date that predates the boundary was not rewritten by the revision").toBe(occurrenceTaskId);
  expect(stringAt(revised.data, ["currentOccurrence", "title"], "The date the plan answers for")).toBe("Month-end support review, this date only");
  expect(stringAt(revised.data, ["currentOccurrence", "dueOn"], "The date the plan answers for")).toBe("2026-11-30");
});
test("a plan created with a future first due date is revised from its own boundary rather than from today", async ({ page }) => {
  await page.goto("/work"); // The plan is created only because the Work surface can create one: creation is what puts a rule boundary after the scenario's today, which is the case a prospective revision has to be presented a boundary for.
  await expect(page.getByRole("heading", { name: "Repeating follow-up plans", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "New repeating plan", exact: true }).click();
  const createForm = page.locator('[data-slot="series-editor"][data-mode="create"]');
  await expect(createForm).toBeVisible();
  await createForm.getByRole("textbox", { name: "Title", exact: true }).fill(FUTURE_PLAN.title);
  await createForm.getByRole("textbox", { name: "First due date", exact: true }).fill(FUTURE_PLAN.firstDue);
  await createForm.getByRole("combobox", { name: "Planning time zone", exact: true }).selectOption(PLANNING_ZONE);
  await createForm.getByRole("radio", { name: FUTURE_PLAN.profile, exact: true }).click();
  await createForm.getByRole("spinbutton", { name: "Day of the month", exact: true }).fill("31");
  await expect(createForm.getByRole("radio", { name: "End on a specific date", exact: true })).toBeChecked();
  await createForm.getByRole("textbox", { name: "End date", exact: true }).fill(FUTURE_PLAN.endOn);
  await createForm.getByRole("button", { name: "Create plan", exact: true }).click();
  await page.waitForURL(/\/work\/series\/[^/]+$/u);
  await expect(page.getByRole("heading", { level: 1, name: FUTURE_PLAN.title })).toBeVisible();
  const createdUrl = page.url();
  const seriesId = seriesIdOf(createdUrl);
  const created = await readPlan(page, seriesId);
  const createdRule = recordAt(created.data, ["rule"], "The rule in force");
  expect(stringAt(createdRule, ["profile"], "The rule's repeat profile"), "The plan the read states: one rule revision, whose boundary is the plan's own first due date and still ahead of the plan's today. That ordering is the whole precondition of this test, so it is asserted rather than assumed").toBe("monthlyOnDay");
  expect(stringAt(createdRule, ["firstDueOn"], "The plan's first due date")).toBe(FUTURE_PLAN.firstDue);
  const planToday = stringAt(created.data, ["today"], "The plan's own today");
  expect(FUTURE_PLAN.firstDue > planToday, "The plan's rule begins after its own today, which is the case a prospective boundary has to survive").toBe(true);
  const createdRevisions = recordsAt(created.data, ["effectiveRevisions"], "The rule revisions");
  expect(createdRevisions, "A new plan holds the one revision its rule began with").toHaveLength(1);
  expect(stringAt(createdRevisions[0], ["effectiveFrom"], "The boundary the plan's rule began at"), "The plan's only boundary is its first due date").toBe(FUTURE_PLAN.firstDue);
  await page.evaluate((marker: string) => {
    (globalThis as unknown as RevisionMarkerHost).revisionBoundaryMarker = marker;
  }, REVISION_MARKER_VALUE);
  const navigationsBefore = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await page.getByRole("button", { name: "Edit this and future", exact: true }).click(); // The revision states the boundary it will submit, and that boundary is the plan's own first due date: today is a boundary this plan's rule has already moved past, so the change could not apply from it.
  const revisionForm = page.locator('[data-slot="series-revision-form"]');
  await expect(revisionForm).toBeVisible();
  await expect(revisionForm.getByText("Takes effect from").first()).toBeVisible();
  await expect(revisionForm.locator(`time[datetime="${FUTURE_PLAN.firstDue}"]`), "The boundary stated is the plan's first due date").toBeVisible();
  await expect(revisionForm.locator(`time[datetime="${planToday}"]`), "The boundary stated is not the plan's today, which this plan's rule could not be revised from").toHaveCount(0);
  const profileChoice = revisionForm.getByRole("combobox", { name: "Repeat", exact: true });
  await expect(profileChoice.locator('[data-slot="select-value"]'), "The rule is revised through the one closed set of profiles, chosen from the styled Select that states the profile in force").toHaveText(FUTURE_PLAN.profile);
  await profileChoice.click();
  await page.getByRole("listbox").getByRole("option", { name: FUTURE_PLAN.revisedProfile, exact: true }).click();
  await revisionForm.getByRole("spinbutton", { name: "Repeat every", exact: true }).fill("2");
  await revisionForm.getByRole("spinbutton", { name: "Day of the month", exact: true }).fill("15");
  await revisionForm.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(revisionForm.locator('[data-slot="occurrence-command-result"]'), "The change applies: the boundary the form stated is one this plan's rule can be revised from").toHaveAttribute("data-outcome", "accepted");
  await expect(previewSection(page).getByText(FUTURE_PLAN.revisedRuleLabel, { exact: true }), "The plan re-reads in place: the rule on screen is the revised one, stated with its own numbers, and no document was loaded to show it").toBeVisible();
  await expect(previewSection(page).getByText(FUTURE_PLAN.ruleLabel, { exact: true }), "The rule on screen is the one the change applied").toHaveCount(0);
  await expect(nextDates(page).locator('time[datetime="2027-03-15"]'), "The dates stated are the ones the revised rule produces").toBeVisible();
  expect(await page.evaluate(() => (globalThis as unknown as RevisionMarkerHost).revisionBoundaryMarker ?? null), "The revised rule arrives by re-reading this page, not by loading it again").toBe(REVISION_MARKER_VALUE);
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length), "No document was loaded to show the revised rule").toBe(navigationsBefore);
  expect(page.url(), "The plan is revised on its own page").toBe(createdUrl);
  const revised = await readPlan(page, seriesId);
  const revisedRule = recordAt(revised.data, ["rule"], "The rule in force after the revision");
  expect(stringAt(revisedRule, ["profile"], "The repeat profile in force"), "And the plan the service now holds is that revision: a second rule revision at the boundary the form stated, the new rule in force, the first due date and the one date awaiting an answer untouched").toBe("everyNMonths");
  expect(numberAt(revisedRule, ["interval"], "The interval in force")).toBe(2);
  expect(numberAt(revisedRule, ["dayOfMonth"], "The day of the month in force")).toBe(15);
  expect(stringAt(revisedRule, ["firstDueOn"], "The first due date after the revision"), "A prospective revision keeps the plan's first due date").toBe(FUTURE_PLAN.firstDue);
  const revisedRevisions = recordsAt(revised.data, ["effectiveRevisions"], "The rule revisions after the change");
  expect(revisedRevisions, "The revision is a new rule, not a replacement of the first").toHaveLength(2);
  expect(stringAt(revisedRevisions[0], ["effectiveFrom"], "The boundary the first revision applies from")).toBe(FUTURE_PLAN.firstDue);
  expect(stringAt(revisedRevisions[1], ["effectiveFrom"], "The boundary the change takes effect from"), "The boundary recorded is the one the form stated").toBe(FUTURE_PLAN.firstDue);
  expect(stringAt(revisedRevisions[1], ["rule", "profile"], "The profile the new revision states")).toBe("everyNMonths");
  expect(stringAt(revised.data, ["currentOccurrence", "dueOn"], "The date the plan answers for")).toBe(FUTURE_PLAN.firstDue);
  expect(stringAt(revised.data, ["currentOccurrence", "status"], "The state of the date the plan answers for"), "Revising the plan answers nothing on its behalf").toBe("open");
});
test("a paused plan admits no date, a resumed one does, and an action captured before a stop cannot revive it", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const captured = await readPlan(page, MONTH_END_SERIES);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(commandReceipt(page, "Pause")).toHaveAttribute("data-outcome", "accepted");
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="paused"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="series-plan-preview"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const paused = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(paused.data, ["state"], "The plan's state")).toBe("paused");
  expect(fieldAt(paused.data, "actionableOccurrenceId"), "A paused plan admits no date").toBeNull();
  await expect(page.locator('[data-slot="series-plan-preview"]'), "A paused plan admits no date, so nothing on it is answerable and the preview of dates to answer is absent: the state section states the pause in its own words instead").toHaveCount(0);
  for (const stated of [page.locator('[data-slot="series-state-controls"][data-series-state="paused"]'), page.locator('[data-slot="occurrence-actions"][data-occurrence="absent"]')]) await expect(stated).toHaveCount(1);
  await expect(page.getByText("No active occurrence right now")).toBeVisible();
  expect(statusOn(await readOccurrences(page, MONTH_END_SERIES), "2026-11-30")).toBe("open");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(commandReceipt(page, "Resume")).toHaveAttribute("data-outcome", "accepted");
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="active"]'), "The accepted resume re-reads this route as well, so the state section is already the active one: no reload and no navigation stand between the receipt and the state it produced").toHaveCount(1);
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="active"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="actionable"]')).toHaveCount(1);
  expect(stringAt((await readPlan(page, MONTH_END_SERIES)).data, ["actionableOccurrenceId"], "The date the resumed plan admits an answer for")).toBe("task-series-month-end");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  for (const said of [
    "Stopping ends this repeating plan without completing any open tasks. Choose what should happen to open tasks below.",
    "A stopped plan cannot be resumed — pause it instead if you may want to restart later.",
  ])
    await expect(dialog).toContainText(said);
  const unfinishedWork = dialog.getByRole("radiogroup", { name: "What should happen to open tasks?", exact: true });
  await expect(unfinishedWork.getByRole("radio"), "The stop review states the fate of the unfinished dates, and both fates are reachable from it rather than one being left to the handler's default").toHaveCount(2);
  for (const [index, option] of ["Keep open tasks", "Cancel open tasks"].entries()) await expect(unfinishedWork.getByRole("radio").nth(index)).toHaveAccessibleName(option);
  await expect(unfinishedWork.getByRole("radio", { name: "Keep open tasks", exact: true }), "The review preselects the fate the handler would have applied, so a worker who changes nothing stops the series exactly as before").toBeChecked();
  await dialog.getByRole("button", { name: "Stop plan", exact: true }).click();
  await expect(commandReceipt(page, "Stop")).toHaveAttribute("data-outcome", "accepted");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const stopped = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(stopped.data, ["state"], "The plan's state")).toBe("stopped");
  expect(fieldAt(stopped.data, "actionableOccurrenceId"), "A stopped plan admits no date").toBeNull();
  const leftBehind = recordsAt(stopped.data, ["leftBehind"], "The work the stopped plan left behind");
  expect(leftBehind, "Stopping keeps the unfinished date rather than completing it").toHaveLength(1);
  expect(stringAt(leftBehind[0], ["dueOn"], "The date the stopped plan left behind")).toBe("2026-11-30");
  expect(stringAt(leftBehind[0], ["status"], "The status the stopped plan left behind")).toBe("open");
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="stopped"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Resume", exact: true }), "A stopped plan cannot be resumed").toBeDisabled();
  const stale = await postPlanMutation(page, captured, { mutation: "pauseSeries", seriesId: MONTH_END_SERIES });
  expect(outcomeOf(stale), "A stale action on a stopped plan is a conflict, never a revival; An action captured before the stop cannot undo it. Presented with the revision the plan had then, the same named mutation is a conflict rather than a change..").toBe("conflict");
  const current = await readPlan(page, MONTH_END_SERIES);
  expect(outcomeOf(await postPlanMutation(page, current, { mutation: "pauseSeries", seriesId: MONTH_END_SERIES })), "A current action on a stopped plan changes nothing; ...and presented with the revision the plan holds now it changes nothing, because a stopped plan cannot pause").toBe("unchanged");
  const stillStopped = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(stillStopped.data, ["state"], "The plan's state after both actions"), "Neither action revived the plan").toBe("stopped");
  expect(recordsAt(stillStopped.data, ["leftBehind"], "The work the stopped plan left behind")).toHaveLength(1);
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="stopped"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="absent"]')).toHaveCount(1);
});
