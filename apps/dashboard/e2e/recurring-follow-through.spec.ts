/**
 * Criterion 13 — recurring follow-through.
 *
 * A plan that repeats monthly on day 31 resolves a date to the last day of a month that has no 31st, and says so;
 * completing or skipping one date admits exactly one successor; several dates that passed without an action open
 * the plan's own review instead of piling up as overdue work; and an action captured before a plan was stopped
 * cannot revive it.
 *
 * **The scenario this file drives, from the deterministic seed.**
 * - The seeded established worker — the application's own default session — holds the repeating plan
 *   `series-month-end-support-review`, which repeats monthly on day 31 from 2026-08-31 in Europe/London and states
 *   the qualified ongoing-personal-series policy as its end. Its one actionable date is `2026-11-30`: November has
 *   no 31st, so that date is the plan's resolution of day 31, and the plan discloses the resolution rather than
 *   using the month's final day silently.
 * - The same session holds `series-missed-plan-review`, a weekly plan from 2026-09-24 whose current date is
 *   2026-10-22 with several dates passed since, so its plan is awaiting a decision rather than carrying a stack of
 *   overdue copies.
 * - The scenario instant is 2026-11-20T00:00:00Z. London is on GMT in November, so "today" in the plan's own
 *   planning zone is 2026-11-20 and the rule's next three dates are 2026-11-30, 2026-12-31 and 2027-01-31.
 * - `/work/series/[seriesId]` is the plan's surface: the rule and the dates it produces next, the one date the plan
 *   admits an answer for, the review several missed dates open, and pause, resume or stop. `/api/series` is that
 *   read plus the eight named mutations the handler forwards, `/api/tasks` is the task list read, and `/api/dev` is
 *   the one development control that moves the scenario clock. Every boundary here is read at request time from
 *   that clock, so no scheduler, reminder or background job exists for this file to wait on.
 *
 * **How a fact the surface does not render is read.** The series read publishes the rule, the state, the next three
 * dates, the one actionable date and the plan review, but it does not enumerate every occurrence of a running plan.
 * "Exactly one successor" is therefore counted from the task list the application itself reads, filtered to the one
 * plan: one row per date, each with the status it was recorded with. That is the same durable store the surface is
 * rendered from, so the count is the application's own answer rather than a restatement of what the screen says.
 *
 * **What is asserted through which surface.** The closed repeat rule — the five profiles, the required planning
 * zone and the explicit end — is asserted through the one editor form that composes it, the this-and-future
 * revision, which reads the same closed sets and the same schema the create path uses. Creation has no route of its
 * own in this release, so nothing here depends on one: every assertion below is satisfied by the seeded plans and
 * by the mutations the plan's own surface offers.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

// The one runner entry to this suite's seed: `resetSeed` restores the deterministic world through the application's
// own control, as the persona whose session it names. The browser's own context needs no import of its own —
// `src/proxy.ts` mints the default session cookie, and every read below is authorised again from it per request.
import { resetSeed } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded world this file asserts against, named once
// ---------------------------------------------------------------------------------------------

/** The plan whose rule repeats monthly on a day not every month has. */
const MONTH_END_SERIES = "series-month-end-support-review";

/** That plan's own title, as the record body states it. */
const MONTH_END_TITLE = "Month-end support review";

/** The plan carrying several dates that passed without an action. */
const MISSED_PLAN_SERIES = "series-missed-plan-review";

/** That plan's own title. */
const MISSED_PLAN_TITLE = "Monday review of the working list";

/** The scenario instant every seed lays down; a clock this file moved is returned to it before the test ends. */
const SEED_INSTANT = "2026-11-20T00:00:00Z";

/**
 * An instant at which the month-end plan's next three dates include February: 2026-12-31, 2027-01-31 and
 * 2027-02-28. February 2027 has 28 days, so the third of those dates is day 31 resolved to the month's final day.
 */
const FEBRUARY_IN_PREVIEW = "2026-12-01T00:00:00Z";

/** The zone the month-end plan is planned in, which is the zone its dates are judged in. */
const PLANNING_ZONE = "Europe/London";

/** A display zone far from the plan's own, chosen only to prove that a display change moves no date the plan states. */
const OTHER_DISPLAY_ZONE = "Pacific/Kiritimati";

/** The address of the plan's own surface. */
const planPath = (seriesId: string): string => `/work/series/${encodeURIComponent(seriesId)}`;

/** The task list read, asked for every row of one page so a whole-plan count is a whole-plan count. */
const TASK_LIST_PATH = `/api/tasks?list=all&displayTimeZone=${encodeURIComponent(PLANNING_ZONE)}&pageSize=200`;

/** How many rows that read admits on one page, mirrored from the documented cap so a truncated answer is refused rather than counted. */
const TASK_PAGE_SIZE = 200;

/** The addresses of the series read, its mutations and the development control. */
const SERIES_ENDPOINT = "/api/series";
const DEV_ENDPOINT = "/api/dev";

/** The persistent development-data label the shell states on every surface. */
const DEVELOPMENT_LABEL = "Development data";

/** The headings and labels this file reads by name rather than by position. */
const PREVIEW_HEADING = "The rule and its next dates";
const NEXT_DATES_HEADING = "Next three dates";
const PLAN_REVIEW_HEADING = "Plan needs review";

/** The five repeat profiles the closed rule admits, in the order the editor offers them. */
const CLOSED_PROFILES = ["Does not repeat", "Weekly", "Every N weeks", "Monthly on day N", "Every N months on day N"];

/** The statuses that mean a date is still waiting for an answer. */
const AWAITING_ACTION: ReadonlySet<string> = new Set<string>(["open", "reopened"]);

// ---------------------------------------------------------------------------------------------
// Reading a JSON answer: the envelope, the closed outcome, and the members asserted on
// ---------------------------------------------------------------------------------------------

/** One parsed JSON object, as an untyped record whose members are read through the helpers below. */
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A response body as JSON, refusing a body that is not one: an HTML error page is not an answer. */
async function jsonOf(answer: { text(): Promise<string> }, what: string): Promise<unknown> {
  const text = await answer.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} did not answer with JSON, so nothing about it can be asserted: ${text.slice(0, 400)}`);
  }
}

/** One member inside a parsed answer, by path, or `undefined` where the path holds nothing. */
function fieldAt(value: unknown, ...path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** A string a capture depends on, refusing an absent or blank one with the path it looked at. */
function stringAt(value: unknown, path: readonly string[], what: string): string {
  const found = fieldAt(value, ...path);
  if (typeof found !== "string" || found.trim() === "") {
    throw new Error(`${what} is not at ${path.join(".")} of the answer this file read, so the assertion would have compared nothing: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** A whole number a capture depends on, refusing anything else with the path it looked at. */
function numberOf(value: unknown, path: readonly string[], what: string): number {
  const found = fieldAt(value, ...path);
  if (typeof found !== "number" || !Number.isSafeInteger(found)) {
    throw new Error(`${what} is not a whole number at ${path.join(".")} of the answer this file read: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** An object a capture depends on, refusing anything else with the path it looked at. */
function recordAt(value: unknown, path: readonly string[], what: string): JsonRecord {
  const found = fieldAt(value, ...path);
  if (!isRecord(found)) {
    throw new Error(`${what} is not an object at ${path.join(".")} of the answer this file read: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** A list a capture depends on, refusing anything else with the path it looked at. */
function arrayAt(value: unknown, path: readonly string[], what: string): readonly unknown[] {
  const found = fieldAt(value, ...path);
  if (!Array.isArray(found)) {
    throw new Error(`${what} is not a list at ${path.join(".")} of the answer this file read: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** One list of objects: the shape every collection this file counts arrives in. */
function recordsAt(value: unknown, path: readonly string[], what: string): readonly JsonRecord[] {
  return arrayAt(value, path, what).map((entry, index) => recordAt(entry, [], `${what} at index ${String(index)}`));
}

/** The one outcome a mutation answered with, which is the only member that describes what happened. */
function outcomeOf(body: unknown): string {
  return stringAt(body, ["outcome"], "A mutation's outcome");
}

/** The identifier a caller mints for one attempt: the identity every replay of that attempt is recognised by. */
function newAttemptId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------------------------
// The development control: the one way this file moves the scenario clock
// ---------------------------------------------------------------------------------------------

/** What one session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/**
 * Reads this session's development state.
 *
 * Every control presents the scope and the revision it read, because the service re-authorises the scope and
 * answers `conflict` for a revision that no longer stands; reading the state immediately before each control is
 * what keeps a second control in one test from presenting a revision the first one moved.
 */
async function readDevState(page: Page): Promise<DevState> {
  const answer = await page.request.get(DEV_ENDPOINT);
  const body = await jsonOf(answer, "GET /api/dev");
  return { scope: recordAt(body, ["scope"], "The scope a development control runs under"), revision: stringAt(body, ["revision"], "The development state's revision") };
}

/** Operates exactly one named development control and returns the one outcome it answered with. */
async function operateDevControl(page: Page, action: string, payload: JsonRecord): Promise<void> {
  const state = await readDevState(page);
  const answer = await page.request.post(DEV_ENDPOINT, { data: { action, operationId: newAttemptId(), scope: state.scope, expectedRevision: state.revision, payload } });
  const body = await jsonOf(answer, `POST /api/dev ${action}`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "unchanged") {
    throw new Error(`The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A spec that could not move the scenario clock would assert against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`);
  }
}

/**
 * Moves this session's scenario clock to one instant.
 *
 * Every boundary in this family — which date is actionable, which dates have passed, which dates a rule produces
 * next — is a pure function of the plan and that instant, evaluated at read time. Moving the control is therefore
 * the whole of what a test needs to reach a boundary; waiting, sleeping or a fake timer would assert against a
 * clock the application never used.
 */
async function setClock(page: Page, instant: string): Promise<void> {
  await operateDevControl(page, "setClock", { offsetIso: instant });
}

// ---------------------------------------------------------------------------------------------
// The application's own reads and mutations, called the way the browser calls them
// ---------------------------------------------------------------------------------------------

/** One plan's read, as the envelope the surface is rendered from: its revision, its facts and the actions it published. */
interface PlanSnapshot {
  readonly revision: string;
  readonly scope: JsonRecord;
  readonly data: JsonRecord;
}

/** Reads one plan through the same handler the surface is rendered from. */
async function readPlan(page: Page, seriesId: string): Promise<PlanSnapshot> {
  const answer = await page.request.get(`${SERIES_ENDPOINT}?seriesId=${encodeURIComponent(seriesId)}`);
  const body = await jsonOf(answer, `GET /api/series?seriesId=${seriesId}`);
  return { revision: stringAt(body, ["revision"], "The plan's own revision"), scope: recordAt(body, ["scope"], "The scope the plan was read in"), data: recordAt(body, ["data"], "The plan's facts") };
}

/** Presents one named plan mutation under a stated authority, and answers the one outcome it produced. */
async function postPlanMutation(page: Page, authority: PlanSnapshot, payload: JsonRecord): Promise<unknown> {
  const answer = await page.request.post(SERIES_ENDPOINT, { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.revision, payload } });
  return jsonOf(answer, `POST /api/series ${String(payload.mutation)}`);
}

/**
 * Every occurrence of one plan, as the task list the application itself reads states it.
 *
 * The read refuses to answer across more than one page rather than silently counting a window: a count taken from a
 * truncated page would not be the plan's own count, and "exactly one successor" would then be unfalsifiable.
 */
async function readOccurrences(page: Page, seriesId: string): Promise<readonly JsonRecord[]> {
  const answer = await page.request.get(TASK_LIST_PATH);
  const body = await jsonOf(answer, "GET /api/tasks");
  const total = numberOf(body, ["data", "total"], "The task list's total");
  const pageCount = numberOf(body, ["data", "pageCount"], "The task list's page count");
  if (pageCount > 1 || total > TASK_PAGE_SIZE) {
    throw new Error(`The task list answered ${String(total)} rows over ${String(pageCount)} page(s), so one page does not hold every row and a count taken from it would not be the plan's own. This file counts occurrences from that read, so it stops rather than reporting a number it cannot stand behind.`);
  }
  return recordsAt(body, ["data", "tasks"], "The task list's rows").filter((row) => fieldAt(row, "seriesId") === seriesId);
}

/** The dates one plan's occurrences stand at, in order: one row per date, never a date counted twice. */
function datesOf(rows: readonly JsonRecord[]): readonly string[] {
  return rows.map((row) => stringAt(row, ["dueOn"], "An occurrence's due date")).toSorted();
}

/** The status one plan recorded for the occurrence on a date, or `undefined` where the plan holds no date there. */
function statusOn(rows: readonly JsonRecord[], dueOn: string): string | undefined {
  const row = rows.find((candidate) => fieldAt(candidate, "dueOn") === dueOn);
  return row === undefined ? undefined : stringAt(row, ["status"], "An occurrence's recorded status");
}

/** The occurrences still waiting for an answer: the plan admits at most one of these at a time. */
function awaitingAnswer(rows: readonly JsonRecord[]): readonly JsonRecord[] {
  return rows.filter((row) => AWAITING_ACTION.has(stringAt(row, ["status"], "An occurrence's recorded status")));
}

// ---------------------------------------------------------------------------------------------
// The plan's surface, located by the roles, names and slots it publishes
// ---------------------------------------------------------------------------------------------

/** Opens one plan's own surface and waits for its record body to state the plan's title. */
async function openPlan(page: Page, seriesId: string, title: string): Promise<void> {
  await page.goto(planPath(seriesId));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** The section that states the plan's rule and the dates it produces next. */
function previewSection(page: Page): Locator {
  return page.locator('[data-slot="series-plan-preview"]');
}

/** The ordered list of dates that section states. */
function nextDates(page: Page): Locator {
  return previewSection(page).getByRole("list", { name: NEXT_DATES_HEADING });
}

/** The dates a preview lists, by the status each one carries: the one actionable date and the previews after it. */
function datesWithStatus(page: Page, status: "Actionable" | "Preview"): Locator {
  return nextDates(page).getByRole("listitem").filter({ hasText: status });
}

/** The one durable receipt of a named command from the plan's date group, or its state group. */
function commandReceipt(page: Page, command: string): Locator {
  return page.locator(`[data-slot="occurrence-command"][data-command="${command}"]`).locator('[data-slot="occurrence-command-result"]');
}

// ---------------------------------------------------------------------------------------------
// The closed rule, the one actionable date, and the month-day resolution the plan discloses
// ---------------------------------------------------------------------------------------------

test("a plan states its closed rule, one actionable date among previews, and the final day a month actually has", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);

  // Every record here is synthetic and every external effect simulated, and the shell says so on every surface.
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();

  // One date is waiting for an answer, and it is the date the read named.
  const occurrenceGroup = page.locator('[data-slot="occurrence-actions"]');
  await expect(occurrenceGroup).toHaveAttribute("data-occurrence", "actionable");
  await expect(occurrenceGroup.locator('time[datetime="2026-11-30"]')).toBeVisible();

  // The rule's next three dates. November has no 31st, so the first of them is that month's final day, and the
  // resolution is stated beside the date rather than used silently.
  await expect(previewSection(page).getByRole("heading", { name: PREVIEW_HEADING })).toBeVisible();
  await expect(previewSection(page).getByText(/Planning timezone:\s*Europe\/London/u)).toBeVisible();
  await expect(nextDates(page).getByRole("listitem")).toHaveCount(3);
  await expect(datesWithStatus(page, "Actionable")).toHaveCount(1);
  await expect(datesWithStatus(page, "Preview")).toHaveCount(2);
  await expect(datesWithStatus(page, "Actionable").locator('time[datetime="2026-11-30"]')).toBeVisible();
  await expect(previewSection(page).getByText(/Day 31 does not exist in November, so the final day of that month is used/u)).toBeVisible();

  // The closed repeat rule, stated by the one editor that composes it: five profiles and no sixth, a required
  // planning zone, and an end that is always stated. Every control below is read by the name its own label gives it.
  await page.getByRole("button", { name: "Edit this and future", exact: true }).click();
  const revisionForm = page.locator('[data-slot="series-revision-form"]');
  await expect(revisionForm).toBeVisible();
  const profiles = revisionForm.getByRole("combobox", { name: "Repeat", exact: true });
  await expect(profiles.locator("option")).toHaveText([...CLOSED_PROFILES]);
  await expect(profiles).toHaveValue("monthlyOnDay");
  // A day a month does not have uses that month's final day, and the editor says so where the day is chosen.
  await expect(revisionForm.getByText("For missing monthly dates, use and disclose the final day of that month.")).toBeVisible();
  // The change states the boundary it applies from before it is applied.
  await expect(revisionForm.getByText("Takes effect from").first()).toBeVisible();
  await expect(revisionForm.locator('time[datetime="2026-11-20"]')).toBeVisible();

  // A planning zone is required: leaving it empty refuses the change with the field named, and nothing is sent.
  const zone = revisionForm.getByLabel("Planning timezone");
  const refusals = page.locator('[data-slot="form-error-summary"]');
  await zone.fill("");
  await revisionForm.getByRole("button", { name: "Apply this revision", exact: true }).click();
  await expect(refusals).toContainText("Choose the timezone this time is stated in");
  await expect(page.locator('[data-slot="occurrence-command-result"]'), "A refused form submits nothing").toHaveCount(0);

  // An end is required too: an end date with no date stated is refused the same way, and the plan is untouched.
  await zone.fill(PLANNING_ZONE);
  await revisionForm.getByRole("combobox", { name: "End", exact: true }).selectOption("on-date");
  await revisionForm.getByLabel("End date").fill("");
  await revisionForm.getByRole("button", { name: "Apply this revision", exact: true }).click();
  await expect(refusals).toContainText("Check the details of this change");
  await expect(page.locator('[data-slot="occurrence-command-result"]'), "A refused end submits nothing").toHaveCount(0);
  const unchanged = await readPlan(page, MONTH_END_SERIES);
  expect(recordAt(unchanged.data, ["rule"], "The rule in force"), "Neither refusal saved anything").toEqual({ profile: "monthlyOnDay", interval: 1, dayOfMonth: 31, firstDueOn: "2026-08-31", planningTimeZone: PLANNING_ZONE, end: { kind: "ongoing-personal-policy" } });
  expect(recordsAt(unchanged.data, ["effectiveRevisions"], "The rule revisions"), "A refused change revises no rule").toHaveLength(1);
  await revisionForm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(revisionForm).toHaveCount(0);

  // February has no 31st either. Move the scenario clock so the rule's next three dates include it, then read the
  // resolution the plan discloses for that date.
  await setClock(page, FEBRUARY_IN_PREVIEW);
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(nextDates(page).getByRole("listitem")).toHaveCount(3);
  await expect(nextDates(page).locator('time[datetime="2027-02-28"]')).toBeVisible();
  await expect(previewSection(page).getByText(/Day 31 does not exist in February, so the final day of that month is used/u)).toBeVisible();
  const february = await readPlan(page, MONTH_END_SERIES);
  expect(arrayAt(february.data, ["preview", "dates"], "The dates the rule produces next"), "The screen states the dates the read computed").toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);

  // A due date is a civil date, so a display-zone change moves none of them: the plan's dates are judged in the
  // plan's own zone, and the surface states that zone rather than the browser's.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Appearance, language and time zone" })).toBeVisible();
  const displayZone = page.getByRole("combobox", { name: "Display time zone" });
  await expect(displayZone).toBeVisible();
  await displayZone.selectOption(OTHER_DISPLAY_ZONE);
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(nextDates(page).locator('time[datetime="2026-12-31"]')).toBeVisible();
  await expect(nextDates(page).locator('time[datetime="2027-02-28"]')).toBeVisible();
  await expect(page.locator('[data-slot="occurrence-actions"]').locator('time[datetime="2026-11-30"]')).toBeVisible();
  await expect(previewSection(page).getByText(/Planning timezone:\s*Europe\/London/u)).toBeVisible();

  // The clock this test moved is returned to the seed instant, so the next spec starts where the seed says.
  await setClock(page, SEED_INSTANT);
});

// ---------------------------------------------------------------------------------------------
// One successor per completion or skip
// ---------------------------------------------------------------------------------------------

test("completing one date admits exactly one successor, and skipping one is not completing it", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);

  // One date is waiting for an answer, and the plan holds exactly the one occurrence the seed laid down.
  const seeded = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(seeded.data, ["actionableOccurrenceId"], "The date this plan admits an answer for")).toBe("task-series-month-end");
  const seededOccurrences = await readOccurrences(page, MONTH_END_SERIES);
  expect(datesOf(seededOccurrences)).toEqual(["2026-11-30"]);
  expect(statusOn(seededOccurrences, "2026-11-30")).toBe("open");

  // Completing the date is one reviewed change whose durable receipt is its own record.
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(commandReceipt(page, "Complete")).toHaveAttribute("data-outcome", "accepted");
  await expect(commandReceipt(page, "Complete")).toContainText("Completing this date");
  // Completing records that the work was closed, and the receipt says what that does not prove.
  await expect(page.locator('[data-slot="occurrence-command"][data-command="Complete"]')).toContainText("records no contact, payment, fulfilment or message");

  // Read again: exactly one successor is actionable, and no second date was admitted beside it.
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

  // Skipping answers the next date without performing it: one successor again, and the skipped date is recorded as
  // answered rather than performed.
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(commandReceipt(page, "Skip")).toHaveAttribute("data-outcome", "accepted");
  await expect(page.locator('[data-slot="occurrence-command"][data-command="Skip"]')).toContainText("skipping is not completing");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const skipped = await readOccurrences(page, MONTH_END_SERIES);
  expect(datesOf(skipped), "Skipping the date admitted exactly one successor").toEqual(["2026-11-30", "2026-12-31", "2027-01-31"]);
  expect(statusOn(skipped, "2026-12-31"), "A skipped date is not a completed date").toBe("cancelled");
  expect(statusOn(skipped, "2027-01-31")).toBe("open");
  expect(awaitingAnswer(skipped), "One successor, and no catch-up stack beside it").toHaveLength(1);

  // No catch-up stack: the plan is on track, states no review, and the dates that passed were not materialised as
  // extra work to clear one at a time.
  const onTrack = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(onTrack.data, ["planReview", "state"], "How the plan stands"), "A plan whose dates were answered is not awaiting a review").toBe("on-track");
  await expect(page.getByRole("heading", { name: PLAN_REVIEW_HEADING })).toHaveCount(0);
  await expect(page.locator('[data-slot="plan-needs-review-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="actionable"]')).toHaveCount(1);
});

// ---------------------------------------------------------------------------------------------
// Several missed dates: a decision about the plan, not a backlog to clear
// ---------------------------------------------------------------------------------------------

test("several missed dates open the plan's own review, and its resolution restores one actionable date", async ({ page }) => {
  await openPlan(page, MISSED_PLAN_SERIES, MISSED_PLAN_TITLE);

  const plan = await readPlan(page, MISSED_PLAN_SERIES);
  expect(stringAt(plan.data, ["planReview", "state"], "How the plan stands")).toBe("needs-review");
  const missed = numberOf(plan.data, ["planReview", "missedDateCount"], "The dates that passed without an action");
  expect(missed, "Several dates passed without an action").toBeGreaterThanOrEqual(3);

  // The plan, not a backlog: the review states the count the read computed and says the dates are not listed as
  // overdue work to clear one at a time.
  const panel = page.locator('[data-slot="plan-needs-review-panel"][data-plan-state="needs-review"]');
  await expect(panel).toHaveCount(1);
  await expect(panel.getByRole("heading", { name: PLAN_REVIEW_HEADING })).toBeVisible();
  await expect(panel).toContainText(`This plan carries ${String(missed)} dates that passed without an action.`);
  await expect(panel).toContainText("They are not listed here as overdue work to clear one at a time");
  // The plan still holds a single occurrence: the dates that passed were not copied out as separate work.
  expect(awaitingAnswer(await readOccurrences(page, MISSED_PLAN_SERIES)), "The missed dates are not a stack of copies").toHaveLength(1);

  // Exactly three resolutions, in the closed order the recurrence engine publishes, each naming its own effect.
  const resolutions = panel.getByRole("radio");
  await expect(resolutions).toHaveCount(3);
  await expect(resolutions.nth(0)).toHaveAccessibleName("Keep this occurrence");
  await expect(resolutions.nth(1)).toHaveAccessibleName("Move the next date forward");
  await expect(resolutions.nth(2)).toHaveAccessibleName("Stop series");

  // Choosing one opens the one review step, which states what it applies and what it leaves alone.
  await resolutions.nth(1).click();
  const review = panel.locator('[data-slot="action-review"]');
  await expect(review).toBeVisible();
  await expect(review.getByRole("heading", { name: "Move the next date forward" })).toBeVisible();
  await expect(review).toContainText(`This review covers ${String(missed)} dates that passed without an action.`);
  await expect(review).toContainText("It changes this series only, and it records no contact and no completion on your behalf.");
  await review.getByRole("button", { name: "Apply this resolution", exact: true }).click();
  await expect(panel.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  // Read again, the plan admits one date and is no longer awaiting a decision.
  await openPlan(page, MISSED_PLAN_SERIES, MISSED_PLAN_TITLE);
  await expect(page.locator('[data-slot="plan-needs-review-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="actionable"]')).toHaveCount(1);
  const settled = await readPlan(page, MISSED_PLAN_SERIES);
  expect(stringAt(settled.data, ["planReview", "state"], "How the plan stands after its review")).toBe("on-track");
  expect(stringAt(settled.data, ["currentOccurrence", "dueOn"], "The date the plan now answers for"), "The resolution moved the plan's next date forward").toBe("2026-11-26");
  expect(stringAt(settled.data, ["currentOccurrence", "status"], "The date the plan now answers for")).toBe("open");
  await expect(page.locator('[data-slot="occurrence-actions"]').locator('time[datetime="2026-11-26"]')).toBeVisible();
  // The resolution performed nothing: the plan holds one occurrence, and none of the dates that passed gained a
  // completion or an interaction it never had.
  const settledOccurrences = await readOccurrences(page, MISSED_PLAN_SERIES);
  expect(datesOf(settledOccurrences)).toEqual(["2026-11-26"]);
  expect(statusOn(settledOccurrences, "2026-11-26")).toBe("open");
});

// ---------------------------------------------------------------------------------------------
// One date on its own, and a prospective revision of the rule
// ---------------------------------------------------------------------------------------------

test("one date changes on its own, and a change from a boundary revises the rule without rewriting what came before", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const before = await readPlan(page, MONTH_END_SERIES);
  const ruleBefore = recordAt(before.data, ["rule"], "The rule in force");
  expect(ruleBefore).toEqual({ profile: "monthlyOnDay", interval: 1, dayOfMonth: 31, firstDueOn: "2026-08-31", planningTimeZone: PLANNING_ZONE, end: { kind: "ongoing-personal-policy" } });
  expect(recordsAt(before.data, ["effectiveRevisions"], "The rule revisions"), "A seeded plan starts with the rule it was planned under").toHaveLength(1);
  const occurrenceTaskId = stringAt(before.data, ["currentOccurrence", "taskId"], "The occurrence the plan answers for");

  // This occurrence only: the date's own work changes, and the rule that produces every other date does not.
  await page.getByRole("button", { name: "Edit this occurrence", exact: true }).click();
  const occurrenceForm = page.locator('[data-slot="occurrence-edit-form"]');
  await expect(occurrenceForm).toBeVisible();
  await occurrenceForm.getByLabel("Title").fill("Month-end support review, this date only");
  await occurrenceForm.getByRole("button", { name: "Apply to this date", exact: true }).click();
  await expect(occurrenceForm.locator('[data-slot="occurrence-command-result"]')).toHaveAttribute("data-outcome", "accepted");

  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const edited = await readPlan(page, MONTH_END_SERIES);
  expect(recordAt(edited.data, ["rule"], "The rule in force"), "A change to one date leaves the rule alone").toEqual(ruleBefore);
  expect(recordsAt(edited.data, ["effectiveRevisions"], "The rule revisions"), "A change to one date revises no rule").toHaveLength(1);
  expect(stringAt(edited.data, ["currentOccurrence", "title"], "The title of the date that changed")).toBe("Month-end support review, this date only");
  expect(stringAt(edited.data, ["currentOccurrence", "taskId"], "The date that changed")).toBe(occurrenceTaskId);
  expect(stringAt(edited.data, ["currentOccurrence", "dueOn"], "The date that changed")).toBe("2026-11-30");

  // This and future: a prospective revision from a stated boundary, with completed history left alone.
  await page.getByRole("button", { name: "Edit this and future", exact: true }).click();
  const revisionForm = page.locator('[data-slot="series-revision-form"]');
  await expect(revisionForm).toBeVisible();
  await expect(revisionForm.locator('time[datetime="2026-11-20"]')).toBeVisible();
  await expect(revisionForm.getByText("This is a prospective revision: the dates before that boundary keep the rule they were planned under, and completed history is untouched.")).toBeVisible();
  // An end is always stated: from that boundary the plan stops after a number of occurrences.
  await revisionForm.getByRole("combobox", { name: "End", exact: true }).selectOption("after-count");
  await revisionForm.getByLabel("Number of occurrences").fill("12");
  await revisionForm.getByRole("button", { name: "Apply this revision", exact: true }).click();
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
  // The date that predates the boundary was not rewritten by the revision.
  expect(stringAt(revised.data, ["currentOccurrence", "taskId"], "The date the plan answers for")).toBe(occurrenceTaskId);
  expect(stringAt(revised.data, ["currentOccurrence", "title"], "The date the plan answers for")).toBe("Month-end support review, this date only");
  expect(stringAt(revised.data, ["currentOccurrence", "dueOn"], "The date the plan answers for")).toBe("2026-11-30");
});

// ---------------------------------------------------------------------------------------------
// Pause, resume, stop, and an action captured before the stop
// ---------------------------------------------------------------------------------------------

test("a paused plan admits no date, a resumed one does, and an action captured before a stop cannot revive it", async ({ page }) => {
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  // The authority a stale action presents: the plan as it stood before anything below changed it.
  const captured = await readPlan(page, MONTH_END_SERIES);

  // Pausing holds the plan without closing it: no date is admitted while it is on hold.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(commandReceipt(page, "Pause")).toHaveAttribute("data-outcome", "accepted");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const paused = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(paused.data, ["state"], "The plan's state")).toBe("paused");
  expect(fieldAt(paused.data, "actionableOccurrenceId"), "A paused plan admits no date").toBeNull();
  // A paused plan admits no date, so nothing on it is answerable and the preview of dates to answer is absent: the
  // state section states the pause in its own words instead.
  await expect(page.locator('[data-slot="series-plan-preview"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="paused"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="absent"]')).toHaveCount(1);
  await expect(page.getByText("No date on this series is waiting for an answer")).toBeVisible();
  // Pausing completes nothing: the date it held is still waiting for an answer.
  expect(statusOn(await readOccurrences(page, MONTH_END_SERIES), "2026-11-30")).toBe("open");

  // Resuming admits the next date again.
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(commandReceipt(page, "Resume")).toHaveAttribute("data-outcome", "accepted");
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="active"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="actionable"]')).toHaveCount(1);
  const resumed = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(resumed.data, ["actionableOccurrenceId"], "The date the resumed plan admits an answer for")).toBe("task-series-month-end");

  // Stopping is final, and it says what happens to the unfinished work before it is confirmed.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Stopping admits no further dates. Every date already on the series stays exactly where it is, unfinished: stopping completes nothing on your behalf and records no contact.");
  await expect(dialog).toContainText("A stopped series is not paused and cannot be resumed, so plan anything still needed after this as new work.");
  await dialog.getByRole("button", { name: "Stop the series", exact: true }).click();
  await expect(commandReceipt(page, "Stop")).toHaveAttribute("data-outcome", "accepted");

  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  const stopped = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(stopped.data, ["state"], "The plan's state")).toBe("stopped");
  expect(fieldAt(stopped.data, "actionableOccurrenceId"), "A stopped plan admits no date").toBeNull();
  // The work it left behind is kept and unfinished, not completed on the worker's behalf.
  const leftBehind = recordsAt(stopped.data, ["leftBehind"], "The work the stopped plan left behind");
  expect(leftBehind, "Stopping keeps the unfinished date rather than completing it").toHaveLength(1);
  expect(stringAt(leftBehind[0], ["dueOn"], "The date the stopped plan left behind")).toBe("2026-11-30");
  expect(stringAt(leftBehind[0], ["status"], "The status the stopped plan left behind")).toBe("open");
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="stopped"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Resume", exact: true }), "A stopped plan cannot be resumed").toBeDisabled();

  // An action captured before the stop cannot undo it. Presented with the revision the plan had then, the same named
  // mutation is a conflict rather than a change...
  const stale = await postPlanMutation(page, captured, { mutation: "pauseSeries", seriesId: MONTH_END_SERIES });
  expect(outcomeOf(stale), "A stale action on a stopped plan is a conflict, never a revival").toBe("conflict");
  // ...and presented with the revision the plan holds now it changes nothing, because a stopped plan cannot pause.
  const current = await readPlan(page, MONTH_END_SERIES);
  const futile = await postPlanMutation(page, current, { mutation: "pauseSeries", seriesId: MONTH_END_SERIES });
  expect(outcomeOf(futile), "A current action on a stopped plan changes nothing").toBe("unchanged");
  const stillStopped = await readPlan(page, MONTH_END_SERIES);
  expect(stringAt(stillStopped.data, ["state"], "The plan's state after both actions"), "Neither action revived the plan").toBe("stopped");
  expect(recordsAt(stillStopped.data, ["leftBehind"], "The work the stopped plan left behind")).toHaveLength(1);
  await openPlan(page, MONTH_END_SERIES, MONTH_END_TITLE);
  await expect(page.locator('[data-slot="series-state-controls"][data-series-state="stopped"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="occurrence-actions"][data-occurrence="absent"]')).toHaveCount(1);
});
