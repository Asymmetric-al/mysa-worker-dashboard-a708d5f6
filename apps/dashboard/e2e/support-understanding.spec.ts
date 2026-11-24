/** Criterion 6 — financial understanding — and criterion 7 — the goal. */ import type { APIRequestContext, Page } from "@playwright/test";
import { actAs, clearFailurePlan, expect, numberOf, objectOf, operateDevControl, resetScopeOf, SEEDED_PERSONAS, sessionCookie, setFailurePlan, textOf, test, type PersonaName, type ResetScope } from "../playwright.config";
const PERSONA: PersonaName = "established-worker";
const SESSION = SEEDED_PERSONAS[PERSONA]; // That worker's seeded session, mirrored from the runner's roster rather than hard-coded.
const STUDENTS_SESSION_ID = "established-worker-students";
const SUPPORT_HREF = "/support";
const GIFTS_HREF = "/support/gifts";
const RECEIVED_REPORT_HREF = "/support/reports/received";
const LEDGER_YEAR_QUERY = "?period=this-year&page=0&pageSize=200";
const OUTSIDE_PARTITION_LABEL = "Unknown or stale — outside the five outcomes";
const UNKNOWN_AMOUNT_WORD = "Unknown amount"; // The words the one money formatter and the one status label use for a value that is not a plain number.
const DEVELOPMENT_DATA_LABEL = "Development data";
const SPLIT_GIFT_ID = "gift-harbour-0002"; // The seeded gifts this file reads by their own references: opaque strings, never parsed for meaning.
const CORRECTED_GIFT_ROW_ID = "gift-row-harbour-0009";
const HARBOUR_GOAL_INPUT_MINOR = 2_600_000;
const HARBOUR_GOAL_CURRENT_MINOR = 2_500_000;
const STUDENTS_GOAL_EFFECTIVE_FROM = "2026-01-01";
type DisplayedAmount = { readonly currency: string; readonly minorUnits: number };
type CurrencyFigure = { readonly currency: string; /** The exact amount in minor units, or `null` for a line that states no amount at all. */ readonly minorUnits: number | null; readonly giftCount: number; readonly text: string };
const AMOUNT_WITH_CURRENCY = /(-?\d[\d.,]*)\s+([A-Z]{3})\b/u;
function minorUnitsFrom(displayed: string): number {
  const stripped = displayed.replace(/\(incomplete\)/gu, "").trim();
  const negative = stripped.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? stripped.slice(1) : stripped).split(".");
  const digits = `${whole.replace(/,/gu, "")}${fraction}`;
  const units = Number(digits);
  if (!/^\d+$/u.test(digits) || !Number.isSafeInteger(units)) throw new Error(`The amount this surface displayed, ${JSON.stringify(displayed)}, is not one this file can read as an exact number of minor units. A figure that cannot be read exactly is not compared approximately.`);
  return negative ? -units : units;
}
function amountIn(text: string): DisplayedAmount | null {
  const amount = amountTextIn(text); // The amount and currency one text states, or `null` when it states none this file can read.
  if (amount === null) return null;
  const match = AMOUNT_WITH_CURRENCY.exec(amount);
  return match === null ? null : { currency: match[2] ?? "", minorUnits: minorUnitsFrom(match[1] ?? "") };
}
function amountTextIn(text: string): string | null {
  const match = AMOUNT_WITH_CURRENCY.exec(text); // The amount and currency code exactly as one text displays them, or `null` when it displays none.
  return match === null ? null : `${match[1] ?? ""} ${match[2] ?? ""}`;
}
function fractionDigitsOf(displayed: string): number {
  const [whole = ""] = displayed.split(" "); // The fraction digits an amount display states, which is the exponent the surface actually used.
  const [, fraction = ""] = whole.split(".");
  return fraction.length === 0 ? 0 : fraction.length;
}
async function readWholeResult(page: Page): Promise<readonly CurrencyFigure[]> {
  const lines = page.locator('[data-slot="whole-result-summary"] li');
  const stated = await lines.count();
  const figures: CurrencyFigure[] = [];
  for (let index = 0; index < stated; index += 1) {
    const text = (await lines.nth(index).innerText()).replace(/\s+/gu, " ").trim();
    const currency = /^([A-Z]{2,8})\s/u.exec(text);
    if (currency === null) throw new Error(`The whole-result line ${JSON.stringify(text)} does not begin with the currency it states, so this file cannot read its partition.`);
    const count = /and\s+([\d,]+)\s+gifts?\b/u.exec(text);
    if (count === null) throw new Error(`The whole-result line ${JSON.stringify(text)} states no gift count, so the grain of the figure it carries cannot be checked.`);
    const amount = amountIn(text);
    figures.push({ currency: currency[1] ?? "", minorUnits: amount === null ? null : amount.minorUnits, giftCount: Number((count[1] ?? "").replace(/,/gu, "")), text });
  }
  return figures;
}
type LedgerRow = { /** The gift the row belongs to, which is what the row's own link opens. */ readonly giftId: string; /** The row's amount, or `null` when it states no amount this file can read. */ readonly amount: DisplayedAmount | null; readonly text: string };
const OPEN_GIFT_LABEL = /^Open gift (.+)$/u; // The gift identifier one row states, read from the link the row carries rather than from its text.
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
    if (matched === null) throw new Error(`A ledger row states no gift link, so this file cannot name the record it holds: ${JSON.stringify(text)}.`);
    read.push({ giftId: matched[1] ?? "", amount: amountIn(text), text });
  }
  return read;
}
const rowTotalOf = (rows: readonly LedgerRow[], currency: string): number => rows.reduce((total, row) => (row.amount !== null && row.amount.currency === currency ? total + row.amount.minorUnits : total), 0);
function figureFor(figures: readonly CurrencyFigure[], currency: string): CurrencyFigure {
  const figure = figures.find((candidate) => candidate.currency === currency); // One partition's whole-result figure, refusing a currency the summary does not state.
  if (figure === undefined) throw new Error(`The whole-result summary states no ${currency} partition, so nothing here is compared against it. It states ${figures.map((candidate) => candidate.currency).join(", ") || "no currency at all"}.`);
  return figure;
}
function requiredAmount(text: string, subject: string): DisplayedAmount {
  const amount = amountIn(text);
  if (amount === null) throw new Error(`${subject} states no amount and currency this file can read: ${JSON.stringify(text)}.`);
  return amount;
}
async function statedGoalFacts(goal: ReturnType<Page["locator"]>): Promise<string> {
  const facts = goal.locator("dl").first(); // The facts the goal panel states about the goal it holds, read as one list: the amount in its own currency, the measure, the effective day and the revision a change must present.
  await expect(facts, "The goal panel states the goal it holds, so the facts it states about it can be read.").toBeVisible();
  return (await facts.innerText()).replace(/\s+/gu, " ").trim();
}
/** The revision the goal panel states a change must present, with the note the panel states it by. */ function statedRevision(facts: string, subject: string): string {
  const matched = /Revision\s+(\S+)\s+\(the revision a change must present/u.exec(facts); // The revision one statement of the goal panel's facts names, refusing a statement that names none.
  if (matched === null) throw new Error(`${subject} states no revision a change must present, so nothing is compared with it: ${JSON.stringify(facts)}.`);
  return matched[1] ?? "";
}
const authorisationHeader = (sessionId: string): Readonly<Record<string, string>> => ({ cookie: sessionCookie(sessionId) });
/** One support goal as the goal read states it: its exact amount, the revision a change must present — `envelopeRevision` is the token a change has to present, and `absent` when no goal is set — and whether it may be changed at all. */
type GoalRead = { readonly envelopeRevision: string; readonly scope: ResetScope; readonly goalRevision: string | null; readonly minorUnits: number | null; readonly canEditGoal: boolean };
async function readGoal(request: APIRequestContext, sessionId: string): Promise<GoalRead> {
  const response = await request.get("/api/support/goal", { headers: authorisationHeader(sessionId) });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok()) throw new Error(`The goal read answered HTTP ${String(response.status())}: ${JSON.stringify(body).slice(0, 400)}. A figure this file cannot read is not a figure it can compare.`);
  const envelope = objectOf(body, "The goal read");
  const data = objectOf(envelope["data"], "The goal read's data");
  const goal = data["goal"];
  const figure = goal === null ? null : objectOf(goal, "The goal the read states");
  const amount = figure === null ? null : amountOfGoal(figure);
  return { envelopeRevision: textOf(envelope["revision"], "The goal read's revision"), scope: resetScopeOf(envelope["scope"]), goalRevision: figure === null ? null : textOf(figure["revision"], "The goal's revision"), minorUnits: amount === null ? null : amount.minorUnits, canEditGoal: data["canEditGoal"] === true };
}
function amountOfGoal(goal: Readonly<Record<string, unknown>>): DisplayedAmount {
  const amount = objectOf(goal["amount"], "A goal's amount");
  return { currency: textOf(amount["currency"], "A goal's currency"), minorUnits: numberOf(amount["minorUnits"], "A goal's minor units") };
}
type GoalSaveBody = { readonly operationId: string; readonly scope: ResetScope; readonly expectedRevision: string; readonly payload: { readonly currency: string; readonly amount: { readonly currency: string; readonly minorUnits: number }; readonly measure: "received-gifts"; readonly effectiveFrom: string } }; // The body a `saveGoal` attempt carries: the four members the service's own schema states, and no others.
type AnsweredOutcome = { readonly outcome: string; readonly revision: string | null }; // One mutation outcome as the handler answers it, with the revision the answer reports.
async function postGoalSave(request: APIRequestContext, sessionId: string, body: GoalSaveBody): Promise<AnsweredOutcome> {
  const response = await request.post("/api/support/goal", { headers: { ...authorisationHeader(sessionId), "content-type": "application/json" }, data: body }); // Posts one `saveGoal` attempt over the one transport the goal form itself posts to.
  const answered: unknown = await response.json().catch(() => undefined);
  const parsed = objectOf(answered, "The goal save's answer");
  const revision = parsed["revision"];
  return { outcome: textOf(parsed["outcome"], "The goal save's outcome"), revision: typeof revision === "string" ? revision : null };
}
async function topOf(locator: ReturnType<Page["locator"]>, subject: string): Promise<number> {
  const box = await locator.boundingBox(); // The vertical position a locator's box starts at, so reading order can be asserted rather than assumed.
  if (box === null) throw new Error(`${subject} is not rendered with a position, so the order this file asserts cannot be read.`);
  return box.y;
}
test.use({ persona: PERSONA }); // The goal and reporting journeys are walked as the established worker, which is the persona the runner admits the context as.; Every test starts from the deterministic seed.
test("the overview states five separate measures, cash first, and never one combined total", async ({ page }) => {
  await page.goto(SUPPORT_HREF);
  await expect(page.getByRole("heading", { name: "Support", level: 1 })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  const cash = page.getByRole("region", { name: "Cash received in this period" });
  const recurring = page.getByRole("heading", { name: "Recurring collection outcomes" });
  await expect(cash, "The overview states received support, then the recurring outcomes that are not cash, then the committed measures and the goal. The order is the claim: cash is what arrived, and every other measure is read beside it rather than added to it").toBeVisible();
  await expect(recurring).toBeVisible();
  expect(await topOf(cash, "The cash region"), "Received cash is stated before the recurring outcomes that are not cash.").toBeLessThan(await topOf(recurring, "The recurring-outcomes heading"));
  for (const label of ["Received gifts", "Recurring collection outcomes", "Commitments", "Support goal"] as const) await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  const monthlyTab = page.getByRole("tab", { name: "Monthly equivalents" });
  await expect(monthlyTab, "The source behind this seed states no monthly equivalent for any of its commitments, so that view states that it has none rather than inventing a figure or folding one into the received total").toBeVisible();
  await monthlyTab.click();
  const monthlyPanel = page.getByRole("tabpanel", { name: "Monthly equivalents" });
  await expect(monthlyPanel).toBeVisible();
  await expect(monthlyPanel.getByRole("heading", { name: "The source supplies no monthly equivalent here" }), "The panel states the measure's own absence: an empty monthly-equivalent list is not a statement that no commitment exists").toBeVisible();
  await expect(
    monthlyPanel.getByText(/reports \d+ commitments — its own standing count of the commitments it holds, taken over the coverage stated above rather than over this period/u),
    "The panel states how many commitments the source does report, and states that count as the source's own standing count taken over the coverage rather than as a period subtotal",
  ).toBeVisible();
  await expect(monthlyPanel.getByText(/supplies no monthly equivalent for any of them/u), "The panel states that the source supplies no monthly equivalent for any of those commitments, so nothing stands in the measure's place").toBeVisible();
  await expect(monthlyPanel.getByText(/never averaged, summed, or derived from received gifts/u), "A monthly equivalent is the qualified source's own calculation for one commitment, so the panel states that no figure here is derived from gifts or from a per-occurrence amount").toBeVisible();
  await expect(page.getByText(/Commitments, committed amounts and the goal are measures of their own/u)).toBeVisible();
  expect(await page.getByText(/total support/iu).count(), "The overview names no combined 'total support', because the five measures are never one figure.").toBe(0);
  const chart = page.locator('[data-slot="chart-figure"]').first();
  await expect(chart, "The one chart reads the same report result as the table beneath it, and carries that table as its alternative: a figure that states its unit, coverage and as-of time can be checked without reading a picture").toBeVisible();
  await expect(chart.getByRole("img").first()).toBeVisible();
  const chartTable = chart.locator("table").first();
  await expect(chartTable).toBeVisible();
  await expect(chartTable.locator("caption")).toContainText("by month");
  await expect(chartTable.locator("caption"), "The table states the gap rule in its own caption: a month the source recorded nothing in is named rather than stated as a zero").toContainText("a month the source recorded nothing in states that rather than a zero");
  await expect(chartTable.getByRole("columnheader", { name: "Month" })).toBeVisible();
  await expect(chart.locator("figcaption")).toContainText("Amounts are in");
  for (const link of ["Read the whole gifts ledger", "Read the commitments", "Period comparison"]) await expect(page.getByRole("link", { name: link })).toBeVisible();
});
test("the received report compares equal-elapsed periods and a month with no gift is a gap", async ({ page }) => {
  await page.goto(`${RECEIVED_REPORT_HREF}?period=this-year`); // Four of the five measures are stated on the overview under their own names; the fifth — monthly-equivalent support — is read on its own view rather than as a monthly version of the received total.
  await expect(page.getByRole("heading", { name: "Received support", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Period: In progress$/u).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compared with the preceding equal-elapsed period" }).first(), "The comparison is the equal-elapsed period before this one, stated with its own name, and the difference is stated with the direction it has").toBeVisible();
  for (const value of ["Earlier equal-elapsed period", "Difference (this period minus the earlier one)", "Higher than the earlier period"]) await expect(page.getByText(value).first()).toBeVisible();
  expect(await page.getByText("Not like-for-like").count(), "The two spans are the same length, so the report states an equal-elapsed comparison rather than a mis-matched one.").toBe(0);
  await expect(page.getByText("No gift recorded — a gap, not a zero").first()).toBeVisible();
  expect(await page.getByText("0.00 USD", { exact: true }).count(), "A month with no gift is a gap rather than a zero, so no month of the period is printed at 0.00 USD.").toBe(0);
  for (const text of ["Currency not identified", /Amount — Unknown/u, /No comparison is stated for this currency, because an amount of a currency with no minor-unit exponent cannot be differenced\./u] as const) await expect(page.getByText(text).first()).toBeVisible();
});
test("a zero-baseline comparison states its difference and no percentage at all", async ({ page }) => {
  await page.goto(`/support/reports/comparison?from=2026-06-01&to=2026-06-30`);
  await expect(page.getByRole("heading", { name: "Period comparison", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Amounts in USD", exact: true }), "One currency is stated in this period, one is stated in the earlier period, and the difference is stated as a signed amount").toBeVisible();
  const difference = await page.locator("dt").filter({ hasText: "Difference (this period minus the earlier one)" }).first().locator("xpath=following-sibling::dd[1]").innerText(); // The difference this card states, read from the term that names its convention rather than from a direction word the signed amount already carries.
  expect(requiredAmount(difference, "The comparison's difference").minorUnits, "The earlier period holds no gift, so the whole of this period's support is the difference.").toBeGreaterThan(0);
  expect(difference, "The amount states the direction once: no direction word repeats it beside the figure.").not.toMatch(/Increased by|Decreased by/u);
  await expect(page.getByText(/No percentage is shown, because a percentage needs a compatible numerator and a positive, known denominator\./u), "A zero earlier period is no denominator: the surface states no percentage rather than 0% or ∞").toBeVisible();
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
  // One partition per currency the source reports, and one for the currency it never identified. The order is the summary's own, so the partitions can be compared as a whole rather than searched.
  const currencies = figures.map((figure) => figure.currency);
  expect(currencies, "Each currency is its own partition, and the amount whose currency the source never identified is its own partition too.").toEqual(["EUR", "JPY", "KWD", "UNKNOWN", "USD"]);
  const kwd = figureFor(figures, "KWD");
  const jpy = figureFor(figures, "JPY");
  const usdFigure = figureFor(figures, "USD");
  const kwdAmount = amountTextIn(kwd.text) ?? "";
  const jpyAmount = amountTextIn(jpy.text) ?? "";
  const usdAmount = amountTextIn(usdFigure.text) ?? "";
  expect(kwdAmount, "A KWD amount is displayed with its currency code.; The three-decimal amount is read at three decimals and the zero-decimal amount at none: the exponent comes from the currency the source stated, and is never assumed to be two").toMatch(/\d+\.\d{3}\s+KWD/u);
  expect(fractionDigitsOf(kwdAmount), "A KWD amount is displayed with exactly three decimal places, because the source states three.").toBe(3);
  expect(fractionDigitsOf(jpyAmount), "A JPY amount is displayed with no decimal places at all, because the source states none.").toBe(0);
  expect(fractionDigitsOf(usdAmount), "A USD amount is displayed with the two decimal places the source states.").toBe(2);
  expect(kwd.minorUnits, "The seeded KWD gift is 1,250 minor units, which is 1.250 KWD and never 12.50.").toBe(1_250);
  expect(jpy.minorUnits, "The seeded JPY gift is 5,000 minor units, which is 5,000 JPY and never 50.00.").toBe(5_000);
  expect((kwd.minorUnits ?? 0) > 0 && (jpy.minorUnits ?? 0) > 0, "Both non-two-decimal currencies carry a received amount.").toBe(true);
  const unidentified = figureFor(figures, "UNKNOWN");
  expect(unidentified.minorUnits, "The amount whose currency the source never identified carries no amount this surface can state.").toBeNull();
  expect(unidentified.text).toContain(UNKNOWN_AMOUNT_WORD);
  await expect(page.getByText(/nothing here is added across currencies and no combined total is stated\./u)).toBeVisible();
  const rows = await readLedgerRows(page);
  expect(usdFigure.minorUnits, "The USD partition states an amount.").not.toBeNull();
  expect(usdFigure.minorUnits, "The USD subtotal is exactly the sum of the USD rows the same result returns.").toBe(rowTotalOf(rows, "USD"));
  expect(usdFigure.giftCount, "The USD gift count is the number of distinct USD gifts the result holds, which is one per kept row in this fixture.").toBe(rows.filter((row) => row.amount?.currency === "USD").length);
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}&currency=USD`);
  expect(figureFor(await readWholeResult(page), "USD").minorUnits, "The USD subtotal is the same whether or not the other currencies are in the result.").toBe(usdFigure.minorUnits);
});
test("a split gift counts once at its own grain and a refund is explained rather than netted away", async ({ page }) => {
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await expect(page.getByRole("heading", { name: "Received gifts", level: 1 })).toBeVisible();
  const rows = await readLedgerRows(page);
  const splitRows = rows.filter((row) => row.giftId === SPLIT_GIFT_ID);
  expect(splitRows.length, "The split gift is one row in this result: the gift-grain row is replaced by the one allocation this read is authorised to see, rather than shown beside it.").toBe(1);
  const split = splitRows[0];
  expect(split?.text, "The row states the grain it is reported at.").toContain("One allocation of a split gift");
  expect(split?.amount?.minorUnits, "Only the authorised allocation of the split gift is counted, so the row states the allocation rather than the whole gift.").toBe(4_000);
  expect(await page.getByText("100.00 USD", { exact: false }).count(), "The whole gift's amount is nowhere in this view, because the gift is counted once at its allocation grain.").toBe(0);
  const refund = rows.find((row) => row.giftId === "gift-harbour-0010");
  expect(refund?.text, "The refund row names the row it corrects.; The refund is a row of its own, naming the row it corrects, and the original it corrects is still in the result: a correction explains itself instead of replacing what it corrects").toContain(`A refund of ${CORRECTED_GIFT_ROW_ID}`);
  expect(refund?.amount?.minorUnits, "The refund is stated as the negative amount the source recorded.").toBeLessThan(0);
  const correctedRowKept = rows.some((row) => row.text.includes(CORRECTED_GIFT_ROW_ID));
  expect(correctedRowKept, "The row the refund corrects is still in the result, so the correction did not erase it.").toBe(true);
  await page.getByRole("link", { name: `Open gift ${SPLIT_GIFT_ID}` }).click();
  await expect(page.getByRole("heading", { name: "Gift record", level: 1 })).toBeVisible();
  await expect(page.getByText(/This row is one authorised allocation of a gift/u)).toBeVisible();
  for (const heading of ["What this row is", "Provenance", "Basis, coverage and as-of"]) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.getByText("Entered in the source on")).toBeVisible();
  await expect(page.locator('[data-grain="allocation"]')).toBeVisible();
  await expect(page.locator(`[data-gift-row-id="gift-row-harbour-0003"]`), "The record is the allocation row itself, not the gift-grain row the split replaced: the row the gift is counted at is named on the record by its own identifier").toBeVisible();
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await page.getByRole("link", { name: `Open gift gift-harbour-0010` }).click();
  await expect(page.getByRole("heading", { name: "Gift record", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This row is a correction" })).toBeVisible();
  await expect(page.getByText(/This row records a refund or correction against another row/u)).toBeVisible();
  await expect(page.getByText(CORRECTED_GIFT_ROW_ID, { exact: true })).toBeVisible();
  await expect(page.getByText(/it is never netted into the row it corrects/u)).toBeVisible();
  expect(await page.getByText(/whole gift that carries no allocation/u).count(), "The record states what the row is once: the correction is never also called a whole gift that carries no allocation.").toBe(0);
  await expect(page.getByText(/This row is a correction that carries no allocation/u), "The grain section states the correction itself, so the record describes the row the same way in both sections.").toBeVisible();
  expect(requiredAmount(await page.locator('[data-slot="gift-detail"] p[data-value-state]').first().innerText(), "The refund record's amount").minorUnits, "The record states the amount the source recorded, sign included.").toBeLessThan(0);
});
test("the recurring outcomes stay five and stale evidence stays outside them", async ({ page }) => {
  await page.goto("/support/commitments");
  await expect(page.getByRole("heading", { name: "Commitments", level: 1 })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/A commitment is not received cash: these rows state the source's own cadence, currency and occurrence state, and none is counted in a received-support figure\./u)).toBeVisible();
  await expect(page.getByText("Commitments are read-only")).toBeVisible();
  for (const label of ["Received", "Processing", "Upcoming", "Recovery — needs attention", "Not received"] as const) await expect(page.getByText(`Recurring outcome: ${label}`, { exact: true }).first(), `The ${label} outcome is stated by name.`).toBeVisible();
  await expect(page.getByText(OUTSIDE_PARTITION_LABEL).first(), "And the sixth value is not an outcome: it is where evidence that is unknown or stale is kept, so no occurrence is guessed into one of the five").toBeVisible();
  await expect(page.getByText(/it is counted in none of them, is never guessed into one, and is never presented as a sixth outcome\./u).first()).toBeVisible();
  expect(await page.getByText(OUTSIDE_PARTITION_LABEL).count(), "The stale occurrence is stated outside the five outcomes, in the partition and on its row.").toBeGreaterThan(1);
});
test("a goal save against a stale revision is a conflict that keeps the caller's input", async ({ page, request }) => {
  await page.goto(SUPPORT_HREF); // Exactly five outcomes, each with the word that carries it rather than a colour. The badge's accessible name states what the word is the outcome of, so a bare label is never mistaken for something else on the page.
  const goal = page.getByRole("region", { name: "Support goal" });
  await expect(goal).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  await expect(goal.getByRole("button", { name: "Change the goal" }), "The established worker holds the goal-editing capability, so the panel offers the change.").toBeVisible(); // The capability is present for this identity, so the panel offers the change, and the goal it holds is read off the panel itself — the amount in its own currency and the revision a change must present — rather than from the read behind it.
  const statedBefore = await statedGoalFacts(goal);
  const held = requiredAmount(statedBefore, "The goal panel's statement of the goal it holds");
  expect(held.minorUnits, "The seeded goal states its exact amount.").toBe(HARBOUR_GOAL_CURRENT_MINOR);
  expect(held.currency, "The seeded goal states the currency it is held in.").toBe("USD");
  await setFailurePlan(request, { mode: "conflict", target: { kind: "mutation", name: "saveGoal" } }, SESSION.sessionId); // Arm the changed-revision failure on this one mutation, then save through the surface. The save presents the revision the panel opened with, so the answer is a genuine conflict rather than a fabricated one.
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
  expect(receiptText.match(/Current revision/gu)?.length ?? 0, "The receipt states one current revision and no second one, so the record's own revision field is not restated beside it.").toBe(1);
  expect(receiptText, "The receipt lists the field this save would have changed rather than either whole record.").toContain("Fields that differ");
  expect(receiptText, "The current value stated on the receipt carries no revision field of its own.").not.toContain('"revision"');
  expect(receiptText, "The record's fields this save never names, such as its measure, are not restated: no raw record dump remains on the receipt.").not.toContain("received-gifts");
  await clearFailurePlan(request, SESSION.sessionId);
  await page.goto(SUPPORT_HREF);
  const statedAfter = await statedGoalFacts(goal);
  expect(requiredAmount(statedAfter, "The goal panel's statement of the goal it holds").minorUnits, "The conflict wrote nothing, so the goal still holds the amount it held.").toBe(HARBOUR_GOAL_CURRENT_MINOR);
  expect(statedRevision(statedAfter, "The goal panel"), "The conflict advanced no revision, so the token a change must present is the one it was.").toBe(statedRevision(statedBefore, "The goal panel"));
});
test("an accepted goal save replays to its stored result and advances no second revision", async ({ page, request }) => {
  await page.goto(SUPPORT_HREF);
  const goal = page.getByRole("region", { name: "Support goal" });
  await expect(goal).toBeVisible();
  const before = await readGoal(request, SESSION.sessionId); // The attempt this test replays is the one the panel submits: the revision it presents is the one the panel states a change must present, and its identity is the review step's own. The scope is the one member of that attempt no surface states, so it is read from the named read the panel renders.
  const openedRevision = statedRevision(await statedGoalFacts(goal), "The goal panel");
  await goal.getByRole("button", { name: "Change the goal" }).click();
  await goal.getByLabel("Amount").fill("26000.00");
  await goal.getByRole("button", { name: "Save goal" }).click();
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]')).toBeVisible();
  const review = goal.locator('[data-slot="action-review"]');
  const operationId = await review.getAttribute("data-operation-id");
  expect(operationId, "The review step states the identity of the attempt it submitted.").not.toBeNull();
  const saved = await readGoal(request, SESSION.sessionId);
  expect(saved.minorUnits, "The accepted save stored the amount the caller stated.").toBe(HARBOUR_GOAL_INPUT_MINOR);
  const replayed = await postGoalSave(request, SESSION.sessionId, { operationId: operationId ?? "", scope: before.scope, expectedRevision: openedRevision, payload: { currency: "USD", amount: { currency: "USD", minorUnits: HARBOUR_GOAL_INPUT_MINOR }, measure: "received-gifts", effectiveFrom: "2026-01-01" } }); // This leg stays on the transport by its nature rather than by a missing control: a replay is the recovery of an attempt whose acceptance was already recorded, and the surface has no control that repeats a settled attempt — it states the result and closes the step. The four members below are exactly the contract the panel's own submit sends.
  expect(replayed.outcome, "A replayed acceptance is answered as an acceptance that already happened.").toBe("alreadyAccepted");
  expect(replayed.revision, "The replay reports the revision the accepted save produced.").toBe(saved.goalRevision);
  const afterReplay = await readGoal(request, SESSION.sessionId);
  expect(afterReplay.goalRevision, "The replay advanced no revision.").toBe(saved.goalRevision);
  expect(afterReplay.minorUnits, "The replay wrote nothing, so the goal holds the amount the accepted save stored.").toBe(HARBOUR_GOAL_INPUT_MINOR);
});
test("a missing goal states no percentage and a goal met above 100% is stated exactly", async ({ page }) => {
  await page.goto(SUPPORT_HREF);
  await actAs(page, STUDENTS_SESSION_ID);
  await page.goto(SUPPORT_HREF);
  const goal = page.getByRole("region", { name: "Support goal" });
  await expect(goal).toBeVisible();
  await expect(goal.getByText("No support goal is set", { exact: true })).toBeVisible();
  await expect(goal.getByText(/No percentage is shown because no support goal is set\. A missing goal and a goal of zero are different facts, and neither is a denominator\./u)).toBeVisible();
  expect(await goal.getByText("0%", { exact: true }).count(), "A subject with no goal states no percentage at all, so 0% is never shown for it.").toBe(0);
  await goal.getByRole("button", { name: "Set a goal" }).click();
  await expect(goal.getByLabel("Amount")).toBeVisible();
  await expect(goal.getByLabel("Currency"), "One stated currency is stated rather than offered as a choice, so no currency control is rendered.").toHaveCount(0); // This subject's source reports one currency, so the panel states that currency as the fact it is instead of offering a choice of one, and the amount takes the precision that currency carries rather than one this file assumes.
  await expect(goal.getByText(/The currency is EUR and is not a free choice/u)).toBeVisible();
  await goal.getByLabel("Amount").fill("87.50");
  await goal.getByLabel("Effective from").fill(STUDENTS_GOAL_EFFECTIVE_FROM);
  const review = goal.locator('[data-slot="action-review"]');
  await expect(review.getByRole("heading", { name: "Review this goal change", level: 3 }), "The review step states the change before it is applied: the goal the record holds now, the amount and currency this change states, and the day it takes effect on").toBeVisible();
  await expect(review.getByText("No goal is set", { exact: true })).toBeVisible();
  await expect(review.getByText(/^87\.50\s+EUR$/u)).toBeVisible();
  await expect(review.getByText(STUDENTS_GOAL_EFFECTIVE_FROM, { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Save goal" }).click();
  await expect(page.locator('[data-slot="operation-result"][data-outcome="accepted"]'), "The goal is created once, in the currency the subject reports in.").toBeVisible();
  await goal.getByRole("button", { name: "Close" }).click();
  await expect(goal.getByRole("button", { name: "Change the goal" }), "A goal met above 100% is stated exactly as it was computed, with the amount, currency and revision the panel states the created goal holds").toBeVisible();
  const stated = await statedGoalFacts(goal);
  const createdGoal = requiredAmount(stated, "The goal panel's statement of the goal it holds");
  expect(createdGoal.minorUnits, "The panel states the goal in the exact minor units this journey set.").toBe(8_750);
  expect(createdGoal.currency, "The panel states the goal in the currency the subject reports in.").toBe("EUR");
  expect(statedRevision(stated, "The goal panel"), "A created goal starts at the first revision.").toBe("1");
  await expect(goal.getByText("120%", { exact: true })).toBeVisible();
  await expect(goal.getByText(/The goal is 120% met over/u)).toBeVisible();
  await expect(goal.getByText(/A figure above 100% is stated exactly as it was computed and is never capped\./u)).toBeVisible();
  await expect(goal.getByText("87.50 EUR", { exact: false }).first()).toBeVisible();
});
test("a recorded zero, an unknown amount and an incomplete subtotal are told apart in words", async ({ page }) => {
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await expect(page.getByText("How an amount on this page is stated")).toBeVisible();
  await expect(page.getByText(UNKNOWN_AMOUNT_WORD, { exact: true }).first(), "The amount whose currency the source never identified is unknown, and the legend states that in words: a state is never carried by colour, position or an adjacent heading alone").toBeVisible();
  await expect(page.getByText(new RegExp("The source did not establish a value, so this must not be read as zero or as an absence of giving.".replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")).first()).toBeVisible();
  const wholeResult = page.locator('[data-slot="whole-result-summary"]');
  await expect(wholeResult.getByText("(incomplete)", { exact: false }).first(), "Coverage of this period is partial, so every subtotal over it is an incomplete subtotal and says so — in the figure and in its accessible name").toBeVisible();
  await expect(wholeResult.getByText(new RegExp("Incomplete subtotal: coverage of this period is partial", "u")).first()).toBeVisible();
  await actAs(page, STUDENTS_SESSION_ID); // A recorded zero is a different value state, and it is stated as one: the students ministry's November holds no gift against complete coverage, and the surface states the zero it recorded rather than an absence, a gap or an unknown amount.
  await page.goto(`${RECEIVED_REPORT_HREF}?from=2026-11-01&to=2026-11-30&currency=EUR`);
  await expect(page.getByRole("heading", { name: "Received support", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText("0.00 EUR", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp("Zero: no amount was recorded, so this is a genuine zero rather than an unknown value.".replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")).first()).toBeVisible();
  expect(await page.getByText(UNKNOWN_AMOUNT_WORD, { exact: true }).count(), "A recorded zero is never rendered as an unknown amount.").toBe(0);
  await page.goto(SUPPORT_HREF); // And that month is never drawn at zero: with nothing recorded in it for this subject, the one chart invents no series at all and says so. The month-by-month naming of a gap is the received report's table, asserted above, because a single-month overview has no second month to leave out.
  const chart = page.locator('[data-slot="chart-figure"]').first();
  await expect(chart).toBeVisible();
  await expect(chart.getByText("This chart has no series", { exact: true })).toBeVisible();
  await expect(chart.getByText(/None is invented in its place/u)).toBeVisible();
});
test("an unavailable financial source is stated as unavailable while other work continues", async ({ page, request }) => {
  await operateDevControl(request, "setScenario", { scenarioId: "financial-source-unavailable" }, SESSION.sessionId);
  await page.goto(SUPPORT_HREF);
  await expect(page.getByRole("heading", { name: "Support", level: 1 }), "The page keeps its own title above the outage, so the notice is stated inside a named surface rather than in place of its heading").toBeVisible();
  await expect(page.getByRole("heading", { name: "The support overview could not be read", level: 2 }), "The surface reports the outage as its own state, with the source it could not read — never as an overview of zeroes and never as an empty period").toBeVisible();
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
  expect(await page.getByText(/No gift is in this result/u).count(), "An outage is not an empty result.").toBe(0);
  expect(await page.getByText(/\b0\.00\b/u).count(), "An outage is not a zero.").toBe(0);
  expect(await page.getByText(/^Unknown amount$/u).count(), "An outage states the source's unavailability rather than an unknown figure.").toBe(0);
  await page.goto(`${GIFTS_HREF}${LEDGER_YEAR_QUERY}`);
  await expect(page.getByRole("heading", { name: "The gifts ledger could not be read", level: 1 })).toBeVisible();
  await page.goto("/work?list=overdue"); // Work that does not depend on the financial source is unaffected: the same session still reads its own tasks, including the one the seed makes overdue. The five lists are shown one at a time and the address names the one on screen, so the overdue list is opened at its own address, and its own
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
  const overdue = page.getByRole("table", { name: "Overdue tasks" });
  await expect(overdue).toBeVisible();
  await expect(overdue.getByText("Send the thank-you note").first()).toBeVisible();
});
test.describe("the goal without the edit capability", () => {
  test.use({ persona: "reviewer" satisfies PersonaName }); // The content reviewer is admitted to the same ministry as the worker and holds no capability set, so
  test("no goal edit control is rendered at all", async ({ page, request }) => {
    await page.goto(SUPPORT_HREF);
    const goal = page.getByRole("region", { name: "Support goal" });
    await expect(goal).toBeVisible();
    await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first()).toBeVisible();
    const read = await readGoal(request, SEEDED_PERSONAS.reviewer.sessionId);
    expect(read.canEditGoal, "The reviewer's session holds no goal-editing capability.").toBe(false);
    expect(read.minorUnits, "The goal is still stated to an identity that may read it.").toBe(HARBOUR_GOAL_CURRENT_MINOR);
    await expect(goal.getByText("25,000.00 USD", { exact: false }).first()).toBeVisible();
    expect(await goal.getByRole("button", { name: "Change the goal" }).count(), "A session without the capability is offered no way to change the goal: no control is offered — not a disabled one, and not one hidden by styling").toBe(0);
    expect(await goal.getByRole("button", { name: "Set a goal" }).count(), "A session without the capability is offered no way to set one either.").toBe(0);
    expect(await goal.getByLabel("Amount").count(), "No amount field is rendered, so nothing invites an edit that would be refused.").toBe(0);
    await expect(goal.getByText(/no edit control is offered and a save would be refused\./u)).toBeVisible();
  });
});
