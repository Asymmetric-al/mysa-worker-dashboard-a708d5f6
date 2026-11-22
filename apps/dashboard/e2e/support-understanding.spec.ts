/**
 * Criterion 6 — financial understanding — and criterion 7 — the goal.
 *
 * What this file proves, on the real surfaces and from the deterministic seed:
 *
 * - the Support overview keeps five measures five: received gifts, recurring collection outcomes,
 *   commitments, monthly-equivalent support and the goal are each a measure of their own, the four the
 *   overview states are named under their own headings, the fifth is read on its own view, cash is
 *   stated first, and no single "total support" is ever named;
 * - a fixed report compares a period with the equal-elapsed period before it, states its difference
 *   with the direction that difference has, and states no percentage at all where the earlier period
 *   is zero — neither `0%` nor `∞`;
 * - a month the source recorded nothing in is a gap named in the report's monthly table rather than a
 *   zero, and a period that recorded nothing at all draws no point instead of plotting one at zero;
 * - a recorded zero, an unknown amount and an incomplete subtotal are each stated in their own words,
 *   in the figure and in its accessible name, so no two of them read alike and none is carried by
 *   colour alone;
 * - mixed currencies are never combined: each currency keeps its own subtotal, a three-decimal amount
 *   is read at three decimals and a zero-decimal amount at none, and the amount whose currency the
 *   source never identified is never assigned a currency and never summed into another;
 * - a split gift counts once at its own grain, a refund is explained in the open rather than netted
 *   quietly into the row it corrects, and one gift record states its provenance, entry date and the
 *   coverage it was read at;
 * - the five recurring outcomes stay five, and an occurrence whose evidence is unknown or stale is
 *   counted in none of them rather than in a sixth;
 * - the goal is read-only without the explicit `canEditGoal` capability (no control at all, not a
 *   disabled one), a first goal is set through the panel's own control — its amount typed at the
 *   precision the currency the panel states carries, its effective day chosen, and its reviewed submit
 *   confirmed — a save against a stale revision is a conflict that keeps the caller's input beside
 *   the value the record holds, a replayed acceptance changes nothing, and a goal met above 100% is
 *   stated exactly as computed;
 * - an unavailable financial source is stated as unavailable — never as zero and never as an empty
 *   result — while work that does not depend on it stays usable.
 *
 * The scenario this file drives, from the deterministic seed:
 *
 * - the established worker (`established-worker`) in the Harbour youth ministry, whose projection
 *   holds USD and EUR gifts, one KWD (three-decimal) gift, one JPY (zero-decimal) gift, one gift whose
 *   currency the source never identified, a split gift reported as its one authorised allocation, a
 *   refunded gift beside the refund that corrects it, months the source recorded nothing in, and a
 *   partial coverage range so every subtotal over it is an incomplete one;
 * - the same worker with the students ministry selected (`established-worker-students`), whose support
 *   source is complete and carries no goal at all — the "no goal" fact that is not a goal of zero;
 * - the content reviewer (`content-reviewer`), admitted to the same ministry with no capability set,
 *   which is the identity that proves the goal's edit control is gated rather than merely styled.
 *
 * Money is never read as a float. Every amount is compared as an integer number of minor units, read
 * off the display together with the exponent that display states (KWD 3, JPY 0, USD and EUR 2), so a
 * cent cannot be lost to rounding and no exponent is assumed here.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { expect, resetSeed, SEEDED_PERSONAS, SESSION_COOKIE, test, type PersonaName, type ResetScope } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded scenario this file acts in
// ---------------------------------------------------------------------------------------------

/** The identity the goal and reporting journeys are walked as: the worker who holds years of support. */
const PERSONA: PersonaName = "established-worker";

/** That worker's seeded session, mirrored from the runner's roster rather than hard-coded. */
const SESSION = SEEDED_PERSONAS[PERSONA];

/**
 * The same principal's other seeded session, which selects the students ministry.
 *
 * It is a separate session because each seeded session owns its own synthetic documents: the students
 * ministry's support source is complete and carries no goal, which is the one state a surface must
 * render differently from a goal of zero and from an unavailable source. Nothing is written to it
 * except the goal criterion 7 creates, and every test resets the seed before it runs.
 */
const STUDENTS_SESSION_ID = "established-worker-students";

/** The destinations this journey reads. */
const SUPPORT_HREF = "/support";
const GIFTS_HREF = "/support/gifts";
const COMMITMENTS_HREF = "/support/commitments";
const RECEIVED_REPORT_HREF = "/support/reports/received";
const COMPARISON_REPORT_HREF = "/support/reports/comparison";
const WORK_HREF = "/work";

/**
 * The Work family's overdue list, at the address that names it.
 *
 * The five lists are shown one at a time behind a switcher whose control differs by width, and the address
 * carries the list on screen — so this is the view a worker links to, and the one this journey opens.
 */
const WORK_OVERDUE_QUERY = "?list=overdue";

/**
 * The whole of 2026, every currency, on one page.
 *
 * The ledger's own default period is the current month, which holds one gift; a calendar year holds
 * every currency the seed reports, the split gift, the refund and the months with no gift at all, and
 * the 200-row page keeps the whole result on one page so a figure read here is a whole-result figure.
 */
const LEDGER_YEAR_QUERY = "?period=this-year&page=0&pageSize=200";

/** The ledger narrowed to one currency, so a partition can be compared with the result it came from. */
const LEDGER_YEAR_USD_QUERY = `${LEDGER_YEAR_QUERY}&currency=USD`;

/**
 * A month that holds one USD gift and an earlier equal-elapsed period that holds none: the zero
 * baseline a signed difference must be stated against without inventing a percentage.
 */
const COMPARISON_ZERO_BASELINE_QUERY = "?from=2026-06-01&to=2026-06-30";

/**
 * The students ministry's November, stated in its own currency: the month in which the source recorded
 * no gift for that ministry, against complete coverage. A recorded zero is a different fact from an
 * unknown amount and from a gap, so the surface has to say which one it is.
 */
const STUDENTS_EMPTY_MONTH_QUERY = "?from=2026-11-01&to=2026-11-30&currency=EUR";

/** The five measures the support family reports, in the order every surface lists them. */
const MEASURE_LABELS = ["Received gifts", "Recurring collection outcomes", "Commitments", "Monthly-equivalent support", "Support goal"] as const;

/** The five recurring outcomes plus the value that keeps unknown or stale evidence outside them. */
const RECURRING_BUCKET_LABELS = ["Received", "Processing", "Upcoming", "Recovery — needs attention", "Not received"] as const;
const OUTSIDE_PARTITION_LABEL = "Unknown or stale — outside the five outcomes";

/** The words the one money formatter and the one status label use for a value that is not a plain number. */
const UNKNOWN_AMOUNT_WORD = "Unknown amount";
const INCOMPLETE_MARKER = "(incomplete)";
const INCOMPLETE_STATE_CLAUSE = "Incomplete subtotal: coverage of this period is partial";
const ZERO_STATE_CLAUSE = "Zero: no amount was recorded, so this is a genuine zero rather than an unknown value.";
const UNKNOWN_STATE_CLAUSE = "The source did not establish a value, so this must not be read as zero or as an absence of giving.";

/** The report's own word for a month with no gift, in the table that names every month of the period. */
const REPORT_GAP_WORD = "No gift recorded — a gap, not a zero";

/** The persistent label every surface carries, because no figure here is production data. */
const DEVELOPMENT_DATA_LABEL = "Development data";

/** The seeded gifts this file reads by their own references: opaque strings, never parsed for meaning. */
const SPLIT_GIFT_ID = "gift-harbour-0002";
const SPLIT_ALLOCATION_ROW_ID = "gift-row-harbour-0003";
const REFUND_GIFT_ID = "gift-harbour-0010";
const CORRECTED_GIFT_ROW_ID = "gift-row-harbour-0009";

/** The gift the split gift is reported as: one authorised allocation of it, never the whole gift. */
const SPLIT_ALLOCATION_GRAIN_WORD = "One allocation of a split gift";
const SPLIT_ALLOCATION_LEAD = /This row is one authorised allocation of a gift/u;

/** The goal this file saves, in the currency the seeded goal is stated in, and its exact minor units. */
const HARBOUR_GOAL_INPUT_MINOR = 2_600_000;
const HARBOUR_GOAL_CURRENT_MINOR = 2_500_000;

/**
 * The goal the students ministry might be measured against, and the percentage it produces.
 *
 * That ministry's received support for the year to date is 60.00 + 45.00 = 105.00 EUR, so a goal of
 * 87.50 EUR is met at exactly 120%. The arithmetic is stated once, here, as the fixture expectation
 * it is; no percentage is computed by this file, and the figure the surface renders is compared with
 * it exactly.
 */
const STUDENTS_GOAL_MINOR = 8_750;
const STUDENTS_GOAL_EFFECTIVE_FROM = "2026-01-01";
const STUDENTS_GOAL_PERCENTAGE = "120%";
const STUDENTS_GOAL_SENTENCE = /The goal is 120% met over/u;

/** The revision a goal created where none existed starts at, as the goal panel's own fact states it. */
const FIRST_GOAL_REVISION = "1";

/** The development control the runner and this file both operate, and the payload the runner sends. */
const DEV_CONTROL_PATH = "/api/dev";

// ---------------------------------------------------------------------------------------------
// Reading a figure the application states
// ---------------------------------------------------------------------------------------------

/** One amount as a surface displays it, with the currency the display names for it. */
interface DisplayedAmount {
  readonly currency: string;
  readonly minorUnits: number;
}

/** One currency's part of a whole-result summary. */
interface CurrencyFigure {
  readonly currency: string;
  /** The exact amount in minor units, or `null` for a line that states no amount at all. */
  readonly minorUnits: number | null;
  readonly giftCount: number;
  readonly text: string;
}

/** An amount and the currency code the same text states immediately after it. */
const AMOUNT_WITH_CURRENCY = /(-?\d[\d.,]*)\s+([A-Z]{3})\b/u;

/** The gift count a whole-result line states beside that amount. */
const COUNT_IN_FIGURE = /and\s+([\d,]+)\s+gifts?\b/u;

/**
 * The integer minor units a displayed amount states.
 *
 * The interface formats every amount for en-GB — `,` groups the thousands and `.` separates the
 * fraction — and pads the fraction to exactly the currency's exponent, so a zero-decimal currency
 * renders no separator at all. Reading the exponent back off the display is what keeps this
 * comparison in integers: no float ever touches the amount, and no exponent is assumed here.
 */
function minorUnitsFrom(displayed: string): number {
  const stripped = displayed.replace(/\(incomplete\)/gu, "").trim();
  const negative = stripped.startsWith("-");
  const unsigned = negative ? stripped.slice(1) : stripped;
  const [whole = "", fraction = ""] = unsigned.split(".");
  const digits = `${whole.replace(/,/gu, "")}${fraction}`;
  const units = Number(digits);
  if (!/^\d+$/u.test(digits) || !Number.isSafeInteger(units)) {
    throw new Error(`The amount this surface displayed, ${JSON.stringify(displayed)}, is not one this file can read as an exact number of minor units. A figure that cannot be read exactly is not compared approximately.`);
  }
  return negative ? -units : units;
}

/** The amount and currency one text states, or `null` when it states none this file can read. */
function amountIn(text: string): DisplayedAmount | null {
  const amount = amountTextIn(text);
  if (amount === null) {
    return null;
  }
  const match = AMOUNT_WITH_CURRENCY.exec(amount);
  return match === null ? null : { currency: match[2] ?? "", minorUnits: minorUnitsFrom(match[1] ?? "") };
}

/** The amount and currency code exactly as one text displays them, or `null` when it displays none. */
function amountTextIn(text: string): string | null {
  const match = AMOUNT_WITH_CURRENCY.exec(text);
  return match === null ? null : `${match[1] ?? ""} ${match[2] ?? ""}`;
}

/**
 * The fraction digits an amount display states, which is the exponent the surface actually used.
 *
 * A three-decimal currency read at two decimals would still parse to the same digits here, so this is
 * the check that the exponent the source stated is the one the surface displayed.
 */
function fractionDigitsOf(displayed: string): number {
  const [whole = ""] = displayed.split(" ");
  const [, fraction = ""] = whole.split(".");
  return fraction.length === 0 ? 0 : fraction.length;
}

/**
 * The whole-result figures the ledger states for its query, one per currency.
 *
 * The whole-result summary is the result the filters match rather than the rows on the page, so it is
 * the one place a total can be read without paging: a comparison against it is a comparison of the
 * whole query.
 */
async function readWholeResult(page: Page): Promise<readonly CurrencyFigure[]> {
  const lines = page.locator('[data-slot="whole-result-summary"] li');
  const stated = await lines.count();
  const figures: CurrencyFigure[] = [];
  for (let index = 0; index < stated; index += 1) {
    const text = (await lines.nth(index).innerText()).replace(/\s+/gu, " ").trim();
    const currency = /^([A-Z]{2,8})\s/u.exec(text);
    if (currency === null) {
      throw new Error(`The whole-result line ${JSON.stringify(text)} does not begin with the currency it states, so this file cannot read its partition.`);
    }
    const count = COUNT_IN_FIGURE.exec(text);
    if (count === null) {
      throw new Error(`The whole-result line ${JSON.stringify(text)} states no gift count, so the grain of the figure it carries cannot be checked.`);
    }
    const amount = amountIn(text);
    figures.push({ currency: currency[1] ?? "", minorUnits: amount === null ? null : amount.minorUnits, giftCount: Number((count[1] ?? "").replace(/,/gu, "")), text });
  }
  return figures;
}

/** One row of the gifts ledger, as the facts this file compares it by. */
interface LedgerRow {
  /** The gift the row belongs to, which is what the row's own link opens. */
  readonly giftId: string;
  /** The row's amount, or `null` when it states no amount this file can read. */
  readonly amount: DisplayedAmount | null;
  readonly text: string;
}

/** The gift identifier one row states, read from the link the row carries rather than from its text. */
const OPEN_GIFT_LABEL = /^Open gift (.+)$/u;

/** Every row of the ledger the page currently holds. */
async function readLedgerRows(page: Page): Promise<readonly LedgerRow[]> {
  const table = page.getByRole("table", { name: "Received gifts" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  const stated = await rows.count();
  const read: LedgerRow[] = [];
  for (let index = 0; index < stated; index += 1) {
    const row = rows.nth(index);
    const text = (await row.innerText()).replace(/\s+/gu, " ").trim();
    const label = await row.getByRole("link").first().getAttribute("aria-label");
    const matched = label === null ? null : OPEN_GIFT_LABEL.exec(label);
    if (matched === null) {
      throw new Error(`A ledger row states no gift link, so this file cannot name the record it holds: ${JSON.stringify(text)}.`);
    }
    read.push({ giftId: matched[1] ?? "", amount: amountIn(text), text });
  }
  return read;
}

/** The amount rows state for one currency, added as integers so a negative correction is included exactly. */
function rowTotalOf(rows: readonly LedgerRow[], currency: string): number {
  return rows.reduce((total, row) => (row.amount !== null && row.amount.currency === currency ? total + row.amount.minorUnits : total), 0);
}

/** One partition's whole-result figure, refusing a currency the summary does not state. */
function figureFor(figures: readonly CurrencyFigure[], currency: string): CurrencyFigure {
  const figure = figures.find((candidate) => candidate.currency === currency);
  if (figure === undefined) {
    throw new Error(`The whole-result summary states no ${currency} partition, so nothing here is compared against it. It states ${figures.map((candidate) => candidate.currency).join(", ") || "no currency at all"}.`);
  }
  return figure;
}

/** The amount an amount-bearing text states, refusing text that states none. */
function requiredAmount(text: string, subject: string): DisplayedAmount {
  const amount = amountIn(text);
  if (amount === null) {
    throw new Error(`${subject} states no amount and currency this file can read: ${JSON.stringify(text)}.`);
  }
  return amount;
}

/**
 * The facts the goal panel states about the goal it holds.
 *
 * The panel states the amount in its own currency, the measure it counts, the effective day and the
 * revision a change must present as one list, so the list is read whole: the amount and the revision
 * this file compares are then read out of what the panel says, never out of the record behind it.
 */
async function statedGoalFacts(goal: ReturnType<Page["locator"]>): Promise<string> {
  const facts = goal.locator("dl").first();
  await expect(facts, "The goal panel states the goal it holds, so the facts it states about it can be read.").toBeVisible();
  return (await facts.innerText()).replace(/\s+/gu, " ").trim();
}

/** The revision the goal panel states a change must present, with the note the panel states it by. */
const STATED_REVISION = /Revision\s+(\S+)\s+\(the revision a change must present/u;

/** The revision one statement of the goal panel's facts names, refusing a statement that names none. */
function statedRevision(facts: string, subject: string): string {
  const matched = STATED_REVISION.exec(facts);
  if (matched === null) {
    throw new Error(`${subject} states no revision a change must present, so nothing is compared with it: ${JSON.stringify(facts)}.`);
  }
  return matched[1] ?? "";
}

// ---------------------------------------------------------------------------------------------
// The application's own authorised reads, over the handler the browser itself uses
// ---------------------------------------------------------------------------------------------

/** The one identity header every request below carries: the session cookie the service authorises. */
function authorisationHeader(sessionId: string): Readonly<Record<string, string>> {
  return { cookie: `${SESSION_COOKIE}=${sessionId}` };
}

function recordOf(value: unknown, subject: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${subject} is not the object this file expects, so nothing is compared against it.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function textOf(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${subject} is not the non-empty text this file expects, so nothing is compared against it.`);
  }
  return value;
}

function numberOfValue(value: unknown, subject: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${subject} is not a whole number, so no figure is read from it.`);
  }
  return value;
}

function scopeOf(value: unknown): ResetScope {
  const record = recordOf(value, "A scope");
  return {
    organizationId: textOf(record["organizationId"], "A scope's organization reference"),
    ministryId: textOf(record["ministryId"], "A scope's ministry reference"),
    supportSubjectId: textOf(record["supportSubjectId"], "A scope's support-subject reference"),
    principalId: textOf(record["principalId"], "A scope's principal reference"),
  };
}

/** One support goal as the goal read states it: its exact amount, the revision a change must present and whether it may be changed at all. */
interface GoalRead {
  /** The revision the goal read publishes: the token a change has to present, and `absent` when no goal is set. */
  readonly envelopeRevision: string;
  readonly scope: ResetScope;
  readonly goalRevision: string | null;
  readonly minorUnits: number | null;
  readonly canEditGoal: boolean;
}

/** Reads the support goal through the same named read the goal panel renders. */
async function readGoal(request: APIRequestContext, sessionId: string): Promise<GoalRead> {
  const response = await request.get("/api/support/goal", { headers: authorisationHeader(sessionId) });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok()) {
    throw new Error(`The goal read answered HTTP ${String(response.status())}: ${JSON.stringify(body).slice(0, 400)}. A figure this file cannot read is not a figure it can compare.`);
  }
  const envelope = recordOf(body, "The goal read");
  const data = recordOf(envelope["data"], "The goal read's data");
  const goal = data["goal"];
  const figure = goal === null ? null : recordOf(goal, "The goal the read states");
  const amount = figure === null ? null : amountOfGoal(figure);
  return { envelopeRevision: textOf(envelope["revision"], "The goal read's revision"), scope: scopeOf(envelope["scope"]), goalRevision: figure === null ? null : textOf(figure["revision"], "The goal's revision"), minorUnits: amount === null ? null : amount.minorUnits, canEditGoal: data["canEditGoal"] === true };
}

/** The amount a stored goal record states. */
function amountOfGoal(goal: Readonly<Record<string, unknown>>): DisplayedAmount {
  const amount = recordOf(goal["amount"], "A goal's amount");
  return { currency: textOf(amount["currency"], "A goal's currency"), minorUnits: numberOfValue(amount["minorUnits"], "A goal's minor units") };
}

/** The body a `saveGoal` attempt carries: the four members the service's own schema states, and no others. */
interface GoalSaveBody {
  readonly operationId: string;
  readonly scope: ResetScope;
  readonly expectedRevision: string;
  readonly payload: { readonly currency: string; readonly amount: { readonly currency: string; readonly minorUnits: number }; readonly measure: "received-gifts"; readonly effectiveFrom: string };
}

/** One mutation outcome as the handler answers it, with the revision the answer reports. */
interface AnsweredOutcome {
  readonly outcome: string;
  readonly revision: string | null;
}

/** Posts one `saveGoal` attempt over the one transport the goal form itself posts to. */
async function postGoalSave(request: APIRequestContext, sessionId: string, body: GoalSaveBody): Promise<AnsweredOutcome> {
  const response = await request.post("/api/support/goal", { headers: { ...authorisationHeader(sessionId), "content-type": "application/json" }, data: body });
  const answered: unknown = await response.json().catch(() => undefined);
  const parsed = recordOf(answered, "The goal save's answer");
  const revision = parsed["revision"];
  return { outcome: textOf(parsed["outcome"], "The goal save's outcome"), revision: typeof revision === "string" ? revision : null };
}

// ---------------------------------------------------------------------------------------------
// The development controls a boundary needs
// ---------------------------------------------------------------------------------------------

/** This session's development state: the scope a control acts in and the revision it presents. */
async function developmentState(request: APIRequestContext, sessionId: string): Promise<{ readonly scope: ResetScope; readonly revision: string }> {
  const response = await request.get(DEV_CONTROL_PATH, { headers: authorisationHeader(sessionId) });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok()) {
    throw new Error(`The development state could not be read as ${sessionId}: HTTP ${String(response.status())} — ${JSON.stringify(body).slice(0, 400)}.`);
  }
  const record = recordOf(body, "The development state");
  return { scope: scopeOf(record["scope"]), revision: textOf(record["revision"], "The development state's revision") };
}

/**
 * Operates one named development control for this session.
 *
 * The control is the same one the Settings reset and the development panel submit, so a scenario or an
 * armed failure is armed the way a person arms it, and the seed the next test starts from is the one
 * this runner lays down.
 */
async function operateDevelopmentControl(request: APIRequestContext, sessionId: string, action: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
  const state = await developmentState(request, sessionId);
  const response = await request.post(DEV_CONTROL_PATH, { headers: { ...authorisationHeader(sessionId), "content-type": "application/json" }, data: { action, operationId: crypto.randomUUID(), scope: state.scope, expectedRevision: state.revision, payload } });
  const body: unknown = await response.json().catch(() => undefined);
  const outcome = recordOf(body, `The ${action} control's answer`)["outcome"];
  if (!response.ok() || (outcome !== "accepted" && outcome !== "alreadyAccepted" && outcome !== "unchanged")) {
    throw new Error(`The ${action} control answered HTTP ${String(response.status())} ${String(outcome)}: ${JSON.stringify(body).slice(0, 400)}. A spec that could not set the state it asserts against stops here rather than reporting a failure the application did not cause.`);
  }
}

/** Arms one of the three deterministic failures against one named call, for this session only. */
async function armFailure(request: APIRequestContext, sessionId: string, mode: string, kind: string, name: string): Promise<void> {
  await operateDevelopmentControl(request, sessionId, "setFailurePlan", { mode, target: { kind, name } });
}

/** Clears the armed failure, so no later read or mutation in this session inherits it. */
async function clearFailure(request: APIRequestContext, sessionId: string): Promise<void> {
  await operateDevelopmentControl(request, sessionId, "setFailurePlan", { plan: null });
}

/** Selects the seeded scenario the session runs in. */
async function selectScenario(request: APIRequestContext, sessionId: string, scenarioId: string): Promise<void> {
  await operateDevelopmentControl(request, sessionId, "setScenario", { scenarioId });
}

/**
 * Acts as another seeded session in this browser context.
 *
 * The development-session cookie is the whole of the identity the application authorises a browser
 * request as, so naming a seeded session in the jar is how a spec reads the world that session owns.
 * The origin is taken from the page the context is already on rather than from a host this file would
 * otherwise have to assume.
 */
async function actAsSession(context: BrowserContext, page: Page, sessionId: string): Promise<void> {
  const { origin } = new URL(page.url());
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, url: origin }]);
}

/** The vertical position a locator's box starts at, so reading order can be asserted rather than assumed. */
async function topOf(locator: ReturnType<Page["locator"]>, subject: string): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${subject} is not rendered with a position, so the order this file asserts cannot be read.`);
  }
  return box.y;
}

// ---------------------------------------------------------------------------------------------
// The journeys
// ---------------------------------------------------------------------------------------------

/** The goal and reporting journeys are walked as the established worker, which is the persona the runner admits the context as. */
test.use({ persona: PERSONA });

/**
 * Every test starts from the deterministic seed.
 *
 * The runner's automatic `seedReset` fixture restores the seed and admits this persona before the test
 * body; the call below states that requirement where this file is read, and repeats the same control
 * the Settings reset submits, so the world asserted against is the world that command produces.
 */
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

test("the overview states five separate measures, cash first, and never one combined total", async ({ page }) => {
  await page.goto(SUPPORT_HREF);
  await expect(page.getByRole("heading", { name: "Support", level: 1 })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  // The overview states received support, then the recurring outcomes that are not cash, then the
  // committed measures and the goal. The order is the claim: cash is what arrived, and every other
  // measure is read beside it rather than added to it.
  const cash = page.getByRole("region", { name: "Cash received in this period" });
  const recurring = page.getByRole("heading", { name: "Recurring collection outcomes" });
  await expect(cash).toBeVisible();
  await expect(recurring).toBeVisible();
  expect(await topOf(cash, "The cash region"), "Received cash is stated before the recurring outcomes that are not cash.").toBeLessThan(await topOf(recurring, "The recurring-outcomes heading"));

  // Four of the five measures are stated on the overview under their own names; the fifth —
  // monthly-equivalent support — is read on its own view rather than as a monthly version of the
  // received total.
  await expect(page.getByRole("heading", { name: MEASURE_LABELS[0], exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: MEASURE_LABELS[1], exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: MEASURE_LABELS[2], exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: MEASURE_LABELS[4], exact: true })).toBeVisible();
  // The source behind this seed states no monthly equivalent for any of its commitments, so that view
  // states that it has none rather than inventing a figure or folding one into the received total.
  const monthlyTab = page.getByRole("tab", { name: "Monthly equivalents" });
  await expect(monthlyTab).toBeVisible();
  await monthlyTab.click();
  const monthlyPanel = page.getByRole("tabpanel", { name: "Monthly equivalents" });
  await expect(monthlyPanel).toBeVisible();
  await expect(monthlyPanel.getByText(/no commitment is ever counted as cash\./u)).toBeVisible();

  // No combined figure is named anywhere on the surface, in the interface's own words.
  await expect(page.getByText(/Commitments, committed amounts and the goal are measures of their own/u)).toBeVisible();
  expect(await page.getByText(/total support/iu).count(), "The overview names no combined 'total support', because the five measures are never one figure.").toBe(0);

  // The one chart reads the same report result as the table beneath it, and carries that table as its
  // alternative: a figure that states its unit, coverage and as-of time can be checked without reading
  // a picture.
  const chart = page.locator('[data-slot="chart-figure"]').first();
  await expect(chart).toBeVisible();
  await expect(chart.getByRole("img").first()).toBeVisible();
  const chartTable = chart.locator("table").first();
  await expect(chartTable).toBeVisible();
  await expect(chartTable.locator("caption")).toContainText("by month");
  // The table states the gap rule in its own caption: a month the source recorded nothing in is named
  // rather than stated as a zero.
  await expect(chartTable.locator("caption")).toContainText("a month the source recorded nothing in states that rather than a zero");
  await expect(chartTable.getByRole("columnheader", { name: "Month" })).toBeVisible();
  await expect(chart.locator("figcaption")).toContainText("Amounts are in");

  // The destinations each render the same report result rather than a second set of figures.
  await expect(page.getByRole("link", { name: "Read the whole gifts ledger" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the commitments" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Period comparison" })).toBeVisible();
});

test("the received report compares equal-elapsed periods and a month with no gift is a gap", async ({ page }) => {
  await page.goto(`${RECEIVED_REPORT_HREF}?period=this-year`);
  await expect(page.getByRole("heading", { name: "Received support", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  // The period has not closed at the seed instant, so the report says so instead of presenting a part
  // of a year as a whole one.
  await expect(page.getByText(/^Period: In progress$/u).first()).toBeVisible();

  // The comparison is the equal-elapsed period before this one, stated with its own name, and the
  // difference is stated with the direction it has.
  await expect(page.getByRole("heading", { name: "Compared with the preceding equal-elapsed period" }).first()).toBeVisible();
  await expect(page.getByText("Earlier equal-elapsed period").first()).toBeVisible();
  await expect(page.getByText("Difference (this period minus the earlier one)").first()).toBeVisible();
  await expect(page.getByText("Higher than the earlier period").first()).toBeVisible();
  expect(await page.getByText("Not like-for-like").count(), "The two spans are the same length, so the report states an equal-elapsed comparison rather than a mis-matched one.").toBe(0);

  // The month the source recorded nothing in is a gap, named as one, and no amount of that month is a
  // plotted or printed zero.
  await expect(page.getByText(REPORT_GAP_WORD).first()).toBeVisible();
  expect(await page.getByText("0.00 USD", { exact: true }).count(), "A month with no gift is a gap rather than a zero, so no month of the period is printed at 0.00 USD.").toBe(0);

  // The currency the source never identified has no amount to state, and is never given another
  // currency's amount in its place.
  await expect(page.getByText("Currency not identified").first()).toBeVisible();
  await expect(page.getByText(/Amount — Unknown/u).first()).toBeVisible();
  await expect(page.getByText(/No comparison is stated for this currency, because an amount of a currency with no minor-unit exponent cannot be differenced\./u).first()).toBeVisible();
});

test("a zero-baseline comparison states its difference and no percentage at all", async ({ page }) => {
  await page.goto(`${COMPARISON_REPORT_HREF}${COMPARISON_ZERO_BASELINE_QUERY}`);
  await expect(page.getByRole("heading", { name: "Period comparison", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  // One currency is stated in this period, one is stated in the earlier period, and the difference is
  // stated as a signed amount with the word for its direction.
  await expect(page.getByRole("heading", { name: "Amounts in USD", exact: true })).toBeVisible();
  await expect(page.getByText("Increased by")).toBeVisible();
  const difference = await page.locator("dd").filter({ hasText: "Increased by" }).first().innerText();
  expect(requiredAmount(difference, "The comparison's difference").minorUnits, "The earlier period holds no gift, so the whole of this period's support is the increase.").toBeGreaterThan(0);

  // A zero earlier period is no denominator: the surface states no percentage rather than 0% or ∞.
  await expect(page.getByText(/No percentage is shown, because a percentage needs a compatible numerator and a positive, known denominator\./u)).toBeVisible();
  expect(await page.getByText("0%", { exact: true }).count(), "A zero baseline yields no percentage, so 0% is never stated for it.").toBe(0);
  expect(await page.getByText("∞", { exact: true }).count(), "A zero baseline yields no percentage, so an infinite share is never stated for it.").toBe(0);
  expect(await page.getByText("Not like-for-like").count(), "Both spans are 30 days, so the difference is stated as an equal-elapsed one.").toBe(0);
});

test("every currency is stated on its own and the unidentified amount is never summed", async ({ page }) => {
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Whole-result support, by currency")).toBeVisible();

  const figures = await readWholeResult(page);
  // One partition per currency the source reports, and one for the currency it never identified. The
  // order is the summary's own, so the partitions can be compared as a whole rather than searched.
  expect(
    figures.map((figure) => figure.currency),
    "Each currency is its own partition, and the amount whose currency the source never identified is its own partition too.",
  ).toEqual(["EUR", "JPY", "KWD", "UNKNOWN", "USD"]);

  // The three-decimal amount is read at three decimals and the zero-decimal amount at none: the
  // exponent comes from the currency the source stated, and is never assumed to be two.
  const kwd = figureFor(figures, "KWD");
  const jpy = figureFor(figures, "JPY");
  const usdFigure = figureFor(figures, "USD");
  const kwdAmount = amountTextIn(kwd.text) ?? "";
  const jpyAmount = amountTextIn(jpy.text) ?? "";
  const usdAmount = amountTextIn(usdFigure.text) ?? "";
  expect(kwdAmount, "A KWD amount is displayed with its currency code.").toMatch(/\d+\.\d{3}\s+KWD/u);
  expect(fractionDigitsOf(kwdAmount), "A KWD amount is displayed with exactly three decimal places, because the source states three.").toBe(3);
  expect(fractionDigitsOf(jpyAmount), "A JPY amount is displayed with no decimal places at all, because the source states none.").toBe(0);
  expect(fractionDigitsOf(usdAmount), "A USD amount is displayed with the two decimal places the source states.").toBe(2);
  expect(kwd.minorUnits, "The seeded KWD gift is 1,250 minor units, which is 1.250 KWD and never 12.50.").toBe(1_250);
  expect(jpy.minorUnits, "The seeded JPY gift is 5,000 minor units, which is 5,000 JPY and never 50.00.").toBe(5_000);
  expect((kwd.minorUnits ?? 0) > 0 && (jpy.minorUnits ?? 0) > 0, "Both non-two-decimal currencies carry a received amount.").toBe(true);

  // The unidentified currency states no amount, so there is nothing to sum and nothing to compare.
  const unidentified = figureFor(figures, "UNKNOWN");
  expect(unidentified.minorUnits, "The amount whose currency the source never identified carries no amount this surface can state.").toBeNull();
  expect(unidentified.text).toContain(UNKNOWN_AMOUNT_WORD);

  // The summary states the rule in its own words: no figure here is added across currencies.
  await expect(page.getByText(/nothing here is added across currencies and no combined total is stated\./u)).toBeVisible();

  // The whole-result USD figure is the sum of the USD rows on the page, in integer minor units, so the
  // unidentified amount was not folded into it and no row was counted twice.
  const rows = await readLedgerRows(page);
  expect(usdFigure.minorUnits, "The USD partition states an amount.").not.toBeNull();
  expect(usdFigure.minorUnits, "The USD subtotal is exactly the sum of the USD rows the same result returns.").toBe(rowTotalOf(rows, "USD"));
  expect(usdFigure.giftCount, "The USD gift count is the number of distinct USD gifts the result holds, which is one per kept row in this fixture.").toBe(rows.filter((row) => row.amount?.currency === "USD").length);

  // The same query narrowed to USD states the same USD figure: adding another currency's partition to
  // the result changes no currency's own subtotal.
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_USD_QUERY}`);
  const usdOnly = figureFor(await readWholeResult(page), "USD");
  expect(usdOnly.minorUnits, "The USD subtotal is the same whether or not the other currencies are in the result.").toBe(usdFigure.minorUnits);
});

test("a split gift counts once at its own grain and a refund is explained rather than netted away", async ({ page }) => {
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();

  const rows = await readLedgerRows(page);
  const splitRows = rows.filter((row) => row.giftId === SPLIT_GIFT_ID);
  expect(splitRows.length, "The split gift is one row in this result: the gift-grain row is replaced by the one allocation this read is authorised to see, rather than shown beside it.").toBe(1);
  const split = splitRows[0];
  expect(split?.text, "The row states the grain it is reported at.").toContain(SPLIT_ALLOCATION_GRAIN_WORD);
  expect(split?.amount?.minorUnits, "Only the authorised allocation of the split gift is counted, so the row states the allocation rather than the whole gift.").toBe(4_000);
  expect(await page.getByText("100.00 USD", { exact: false }).count(), "The whole gift's amount is nowhere in this view, because the gift is counted once at its allocation grain.").toBe(0);

  // The refund is a row of its own, naming the row it corrects, and the original it corrects is still
  // in the result: a correction explains itself instead of replacing what it corrects.
  const refund = rows.find((row) => row.giftId === REFUND_GIFT_ID);
  expect(refund?.text, "The refund row names the row it corrects.").toContain(`A refund of ${CORRECTED_GIFT_ROW_ID}`);
  expect(refund?.amount?.minorUnits, "The refund is stated as the negative amount the source recorded.").toBeLessThan(0);
  expect(
    rows.some((row) => row.text.includes(CORRECTED_GIFT_ROW_ID)),
    "The row the refund corrects is still in the result, so the correction did not erase it.",
  ).toBe(true);

  // The split gift's own record states its grain, its provenance and the coverage it was read at.
  await page.getByRole("link", { name: `Open gift ${SPLIT_GIFT_ID}` }).click();
  await expect(page.getByRole("heading", { name: "Gift record", level: 1 })).toBeVisible();
  await expect(page.getByText(SPLIT_ALLOCATION_LEAD)).toBeVisible();
  await expect(page.getByRole("heading", { name: "What this row is" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provenance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Basis, coverage and as-of" })).toBeVisible();
  await expect(page.getByText("Entered in the source on")).toBeVisible();
  await expect(page.locator('[data-grain="allocation"]')).toBeVisible();
  // The record is the allocation row itself, not the gift-grain row the split replaced: the row the
  // gift is counted at is named on the record by its own identifier.
  await expect(page.locator(`[data-gift-row-id="${SPLIT_ALLOCATION_ROW_ID}"]`)).toBeVisible();

  // The refund's record explains the correction in the open.
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await page.getByRole("link", { name: `Open gift ${REFUND_GIFT_ID}` }).click();
  await expect(page.getByRole("heading", { name: "Gift record", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This row is a correction" })).toBeVisible();
  await expect(page.getByText(/This row records a refund or correction against another row/u)).toBeVisible();
  await expect(page.getByText(CORRECTED_GIFT_ROW_ID, { exact: true })).toBeVisible();
  await expect(page.getByText(/it is never netted into the row it corrects/u)).toBeVisible();
  const refundAmount = await page.locator('[data-slot="gift-detail"] p[data-value-state]').first().innerText();
  expect(requiredAmount(refundAmount, "The refund record's amount").minorUnits, "The record states the amount the source recorded, sign included.").toBeLessThan(0);
});

test("the recurring outcomes stay five and stale evidence stays outside them", async ({ page }) => {
  await page.goto(COMMITMENTS_HREF);
  await expect(page.getByRole("heading", { name: "Commitments", level: 1 })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  // A commitment is not received cash, and the surface says so before it states a count.
  await expect(page.getByText(/A commitment is not received cash: these rows state the source's own cadence, currency and occurrence state, and none is counted in a received-support figure\./u)).toBeVisible();
  await expect(page.getByText("Commitments are read-only")).toBeVisible();

  // Exactly five outcomes, each with the word that carries it rather than a colour. The badge's
  // accessible name states what the word is the outcome of, so a bare label is never mistaken for
  // something else on the page.
  for (const label of RECURRING_BUCKET_LABELS) {
    await expect(page.getByText(`Recurring outcome: ${label}`, { exact: true }).first(), `The ${label} outcome is stated by name.`).toBeVisible();
  }
  // And the sixth value is not an outcome: it is where evidence that is unknown or stale is kept, so no
  // occurrence is guessed into one of the five.
  await expect(page.getByText(OUTSIDE_PARTITION_LABEL).first()).toBeVisible();
  await expect(page.getByText(/it is counted in none of them, is never guessed into one, and is never presented as a sixth outcome\./u).first()).toBeVisible();

  // The seeded commitment whose evidence is stale is in that sixth value, not in an outcome.
  const outsideRows = page.getByText(OUTSIDE_PARTITION_LABEL);
  expect(await outsideRows.count(), "The stale occurrence is stated outside the five outcomes, in the partition and on its row.").toBeGreaterThan(1);
});

test("a goal save against a stale revision is a conflict that keeps the caller's input", async ({ page, request }) => {
  await page.goto(SUPPORT_HREF);
  const goal = page.getByRole("region", { name: "Support goal" });
  await expect(goal).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

  // The capability is present for this identity, so the panel offers the change, and the goal it holds
  // is read off the panel itself — the amount in its own currency and the revision a change must present
  // — rather than from the read behind it.
  await expect(goal.getByRole("button", { name: "Change the goal" }), "The established worker holds the goal-editing capability, so the panel offers the change.").toBeVisible();
  const statedBefore = await statedGoalFacts(goal);
  const held = requiredAmount(statedBefore, "The goal panel's statement of the goal it holds");
  expect(held.minorUnits, "The seeded goal states its exact amount.").toBe(HARBOUR_GOAL_CURRENT_MINOR);
  expect(held.currency, "The seeded goal states the currency it is held in.").toBe("USD");

  // Arm the changed-revision failure on this one mutation, then save through the surface. The save
  // presents the revision the panel opened with, so the answer is a genuine conflict rather than a
  // fabricated one.
  await armFailure(request, SESSION.sessionId, "conflict", "mutation", "saveGoal");
  await goal.getByRole("button", { name: "Change the goal" }).click();
  await goal.getByLabel("Amount").fill("26000.00");
  await goal.getByRole("button", { name: "Save goal" }).click();

  const receipt = page.locator('[data-slot="operation-result"][data-outcome="conflict"]');
  await expect(receipt).toBeVisible();
  await expect(receipt.getByRole("heading", { name: "Someone else changed this" })).toBeVisible();
  await expect(receipt.getByText(/Your input is kept exactly as you entered it, beside the value the record holds now/u)).toBeVisible();
  await expect(receipt.getByRole("button", { name: "Re-apply my input" })).toBeVisible();
  const receiptText = (await receipt.innerText()).replace(/\s+/gu, " ");
  expect(receiptText, "The value the record holds is stated on the receipt.").toContain("The value the record holds now");
  expect(receiptText, "The caller's input is preserved on the receipt.").toContain("Your input, kept as you entered it");
  expect(receiptText, "The current goal's own minor units are stated beside the preserved input.").toContain(String(HARBOUR_GOAL_CURRENT_MINOR));
  expect(receiptText, "The amount the caller typed is preserved exactly as it was sent.").toContain(String(HARBOUR_GOAL_INPUT_MINOR));

  // Nothing was overwritten in either direction: clear the armed failure, return to the surface and read
  // the facts it states now. They are the facts it stated before the attempt, amount and revision alike.
  await clearFailure(request, SESSION.sessionId);
  await page.goto(SUPPORT_HREF);
  const statedAfter = await statedGoalFacts(goal);
  expect(requiredAmount(statedAfter, "The goal panel's statement of the goal it holds").minorUnits, "The conflict wrote nothing, so the goal still holds the amount it held.").toBe(HARBOUR_GOAL_CURRENT_MINOR);
  expect(statedRevision(statedAfter, "The goal panel"), "The conflict advanced no revision, so the token a change must present is the one it was.").toBe(statedRevision(statedBefore, "The goal panel"));
});

test("an accepted goal save replays to its stored result and advances no second revision", async ({ page, request }) => {
  await page.goto(SUPPORT_HREF);
  const goal = page.getByRole("region", { name: "Support goal" });
  await expect(goal).toBeVisible();

  // The attempt this test replays is the one the panel submits: the revision it presents is the one the
  // panel states a change must present, and its identity is the review step's own. The scope is the one
  // member of that attempt no surface states, so it is read from the named read the panel renders.
  const before = await readGoal(request, SESSION.sessionId);
  const openedRevision = statedRevision(await statedGoalFacts(goal), "The goal panel");

  await goal.getByRole("button", { name: "Change the goal" }).click();
  await goal.getByLabel("Amount").fill("26000.00");
  await goal.getByRole("button", { name: "Save goal" }).click();
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]')).toBeVisible();

  // The identity of the attempt is the receipt's own, so the replay below is the same attempt rather
  // than a second one that happens to ask for the same thing.
  const review = goal.locator('[data-slot="action-review"]');
  const operationId = await review.getAttribute("data-operation-id");
  expect(operationId, "The review step states the identity of the attempt it submitted.").not.toBeNull();
  const saved = await readGoal(request, SESSION.sessionId);
  expect(saved.minorUnits, "The accepted save stored the amount the caller stated.").toBe(HARBOUR_GOAL_INPUT_MINOR);

  // The same attempt, replayed: the stored result comes back and no second effect or revision exists.
  // This leg stays on the transport by its nature rather than by a missing control: a replay is the
  // recovery of an attempt whose acceptance was already recorded, and the surface has no control that
  // repeats a settled attempt — it states the result and closes the step. The four members below are
  // exactly the contract the panel's own submit sends.
  const replayed = await postGoalSave(request, SESSION.sessionId, { operationId: operationId ?? "", scope: before.scope, expectedRevision: openedRevision, payload: { currency: "USD", amount: { currency: "USD", minorUnits: HARBOUR_GOAL_INPUT_MINOR }, measure: "received-gifts", effectiveFrom: "2026-01-01" } });
  expect(replayed.outcome, "A replayed acceptance is answered as an acceptance that already happened.").toBe("alreadyAccepted");
  expect(replayed.revision, "The replay reports the revision the accepted save produced.").toBe(saved.goalRevision);
  const afterReplay = await readGoal(request, SESSION.sessionId);
  expect(afterReplay.goalRevision, "The replay advanced no revision.").toBe(saved.goalRevision);
  expect(afterReplay.minorUnits, "The replay wrote nothing, so the goal holds the amount the accepted save stored.").toBe(HARBOUR_GOAL_INPUT_MINOR);
});

test("a missing goal states no percentage and a goal met above 100% is stated exactly", async ({ page }) => {
  // The students ministry's support source is complete and carries no goal: a missing denominator,
  // which is a different fact from a goal of zero.
  await page.goto(SUPPORT_HREF);
  await actAsSession(page.context(), page, STUDENTS_SESSION_ID);
  await page.goto(SUPPORT_HREF);
  const goal = page.getByRole("region", { name: "Support goal" });
  await expect(goal).toBeVisible();
  await expect(goal.getByText("No support goal is set", { exact: true })).toBeVisible();
  await expect(goal.getByText(/No percentage is shown because no support goal is set\. A missing goal and a goal of zero are different facts, and neither is a denominator\./u)).toBeVisible();
  expect(await goal.getByText("0%", { exact: true }).count(), "A subject with no goal states no percentage at all, so 0% is never shown for it.").toBe(0);

  // The goal is then set through the panel's own control: the capability this identity holds opens the
  // form, the amount is typed into the panel's field, the effective day is chosen, and the reviewed step
  // submits it.
  await goal.getByRole("button", { name: "Set a goal" }).click();
  await expect(goal.getByLabel("Amount")).toBeVisible();
  // This subject's source reports one currency, so the panel states that currency as the fact it is
  // instead of offering a choice of one, and the amount takes the precision that currency carries rather
  // than one this file assumes.
  await expect(goal.getByLabel("Currency"), "One stated currency is stated rather than offered as a choice, so no currency control is rendered.").toHaveCount(0);
  await expect(goal.getByText(/The currency is EUR and is not a free choice/u)).toBeVisible();
  await goal.getByLabel("Amount").fill("87.50");
  await goal.getByLabel("Effective from").fill(STUDENTS_GOAL_EFFECTIVE_FROM);

  // The review step states the change before it is applied: the goal the record holds now, the amount and
  // currency this change states, and the day it takes effect on.
  const review = goal.locator('[data-slot="action-review"]');
  await expect(review.getByRole("heading", { name: "Review this goal change", level: 3 })).toBeVisible();
  await expect(review.getByText("No goal is set", { exact: true })).toBeVisible();
  await expect(review.getByText(/^87\.50\s+EUR$/u)).toBeVisible();
  await expect(review.getByText(STUDENTS_GOAL_EFFECTIVE_FROM, { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Save goal" }).click();

  // The outcome the panel reports is the acceptance itself: the goal is created once, in the currency the
  // subject reports in, and the step it opened closes on the goal the panel then states.
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]'), "The goal is created once, in the currency the subject reports in.").toBeVisible();
  await goal.getByRole("button", { name: "Close" }).click();

  // A goal met above 100% is stated exactly as it was computed, with the amount, currency and revision the
  // panel states the created goal holds.
  await expect(goal.getByRole("button", { name: "Change the goal" })).toBeVisible();
  const stated = await statedGoalFacts(goal);
  const held = requiredAmount(stated, "The goal panel's statement of the goal it holds");
  expect(held.minorUnits, "The panel states the goal in the exact minor units this journey set.").toBe(STUDENTS_GOAL_MINOR);
  expect(held.currency, "The panel states the goal in the currency the subject reports in.").toBe("EUR");
  expect(statedRevision(stated, "The goal panel"), "A created goal starts at the first revision.").toBe(FIRST_GOAL_REVISION);
  await expect(goal.getByText(STUDENTS_GOAL_PERCENTAGE, { exact: true })).toBeVisible();
  await expect(goal.getByText(STUDENTS_GOAL_SENTENCE)).toBeVisible();
  await expect(goal.getByText(/A figure above 100% is stated exactly as it was computed and is never capped\./u)).toBeVisible();
  await expect(goal.getByText("87.50 EUR", { exact: false }).first()).toBeVisible();
});

test("a recorded zero, an unknown amount and an incomplete subtotal are told apart in words", async ({ page }) => {
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await expect(page.getByText("How an amount on this page is stated")).toBeVisible();

  // The amount whose currency the source never identified is unknown, and the legend states that in
  // words: a state is never carried by colour, position or an adjacent heading alone.
  await expect(page.getByText(UNKNOWN_AMOUNT_WORD, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(UNKNOWN_STATE_CLAUSE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")).first()).toBeVisible();

  // Coverage of this period is partial, so every subtotal over it is an incomplete subtotal and says
  // so — in the figure and in its accessible name.
  const wholeResult = page.locator('[data-slot="whole-result-summary"]');
  await expect(wholeResult.getByText(INCOMPLETE_MARKER, { exact: false }).first()).toBeVisible();
  await expect(wholeResult.getByText(new RegExp(INCOMPLETE_STATE_CLAUSE, "u")).first()).toBeVisible();

  // A recorded zero is a different value state, and it is stated as one: the students ministry's
  // November holds no gift against complete coverage, and the surface states the zero it recorded
  // rather than an absence, a gap or an unknown amount.
  await actAsSession(page.context(), page, STUDENTS_SESSION_ID);
  await page.goto(`${RECEIVED_REPORT_HREF}${STUDENTS_EMPTY_MONTH_QUERY}`);
  await expect(page.getByRole("heading", { name: "Received support", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText("0.00 EUR", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(ZERO_STATE_CLAUSE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")).first()).toBeVisible();
  expect(await page.getByText(UNKNOWN_AMOUNT_WORD, { exact: true }).count(), "A recorded zero is never rendered as an unknown amount.").toBe(0);

  // And that month is never drawn at zero: with nothing recorded in it for this subject, the one chart
  // invents no series at all and says so. The month-by-month naming of a gap is the received report's
  // table, asserted above, because a single-month overview has no second month to leave out.
  await page.goto(SUPPORT_HREF);
  const chart = page.locator('[data-slot="chart-figure"]').first();
  await expect(chart).toBeVisible();
  await expect(chart.getByText("This chart has no series", { exact: true })).toBeVisible();
  await expect(chart.getByText(/None is invented in its place/u)).toBeVisible();
});

test("an unavailable financial source is stated as unavailable while other work continues", async ({ page, request }) => {
  // The seeded scenario the specification fixes for this arm: the support source is down, and every
  // other job in the same session keeps working.
  await selectScenario(request, SESSION.sessionId, "financial-source-unavailable");
  await page.goto(SUPPORT_HREF);

  // The surface reports the outage as its own state, with the source it could not read — never as an
  // overview of zeroes and never as an empty period.
  await expect(page.getByRole("heading", { name: "The support overview could not be read", level: 1 })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  expect(await page.getByText(/No gift is in this result/u).count(), "An outage is not an empty result.").toBe(0);
  expect(await page.getByText(/\b0\.00\b/u).count(), "An outage is not a zero.").toBe(0);
  expect(await page.getByText(/^Unknown amount$/u).count(), "An outage states the source's unavailability rather than an unknown figure.").toBe(0);

  // The gifts ledger behind the same source states the same outage rather than an empty ledger.
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await expect(page.getByRole("heading", { name: "The gifts ledger could not be read", level: 1 })).toBeVisible();

  // Work that does not depend on the financial source is unaffected: the same session still reads its own
  // tasks, including the one the seed makes overdue. The five lists are shown one at a time and the address
  // names the one on screen, so the overdue list is opened at its own address, and its own table is what
  // states the rows — the list was read, and the task is a row of that list rather than a string on a page.
  await page.goto(`${WORK_HREF}${WORK_OVERDUE_QUERY}`);
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
  const overdue = page.getByRole("table", { name: "Overdue tasks" });
  await expect(overdue).toBeVisible();
  await expect(overdue.getByText("Send the thank-you note").first()).toBeVisible();
});

test.describe("the goal without the edit capability", () => {
  /**
   * The content reviewer is admitted to the same ministry as the worker and holds no capability set, so
   * the goal is readable and not writable for it. That is the identity that proves the control is gated
   * rather than merely styled.
   */
  test.use({ persona: "reviewer" satisfies PersonaName });

  test("no goal edit control is rendered at all", async ({ page, request }) => {
    await page.goto(SUPPORT_HREF);
    const goal = page.getByRole("region", { name: "Support goal" });
    await expect(goal).toBeVisible();
    await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();

    // The goal itself is readable: the capability governs writing it, not reading it.
    const read = await readGoal(request, SEEDED_PERSONAS.reviewer.sessionId);
    expect(read.canEditGoal, "The reviewer's session holds no goal-editing capability.").toBe(false);
    expect(read.minorUnits, "The goal is still stated to an identity that may read it.").toBe(HARBOUR_GOAL_CURRENT_MINOR);
    await expect(goal.getByText("25,000.00 USD", { exact: false }).first()).toBeVisible();

    // No control is offered — not a disabled one, and not one hidden by styling.
    expect(await goal.getByRole("button", { name: "Change the goal" }).count(), "A session without the capability is offered no way to change the goal.").toBe(0);
    expect(await goal.getByRole("button", { name: "Set a goal" }).count(), "A session without the capability is offered no way to set one either.").toBe(0);
    expect(await goal.getByLabel("Amount").count(), "No amount field is rendered, so nothing invites an edit that would be refused.").toBe(0);
    await expect(goal.getByText(/no edit control is offered and a save would be refused\./u)).toBeVisible();
  });
});
