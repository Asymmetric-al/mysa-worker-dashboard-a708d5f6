/**
 * Criterion 4 — contact import.
 *
 * One UTF-8 CSV file of contacts is chosen, its columns are mapped, every row is reviewed and decided on
 * its own, the rows the worker decided are accepted, and the receipt states what became of every row. The
 * file the delivered fixture supplies carries the three shapes the criterion names: a row that is new, a
 * row whose own value is invalid and states a readable reason, and a row that looks like a contact the
 * worker already holds — which is only ever *suggested* for reuse, never merged. It also carries a
 * `Subscribed` column that is kept as data and never read as consent (AAP 0.8.5: "a `subscribed` flag is
 * not consent"), and two rows carrying a negative contact restriction, which acceptance must preserve.
 *
 * **What this file proves, in the criterion's own order (AAP 0.12.1 criterion 4).**
 * 1. The example CSV is imported with new, invalid and duplicate-looking rows; one row is corrected, one
 *    is skipped, one reuses an existing identity, and the rest are left undecided.
 * 2. After a lost acknowledgement and a reload, the results are the *same operation*, read back by its own
 *    identity, with no duplicated contact and no subscription for anyone imported.
 * 3. Stopping an import after it accepted rows stops only the rows nothing was applied to and leaves the
 *    accepted contacts exactly as they are.
 * 4. A file of 5,001 data rows and a workbook are each refused *before* processing, with a readable
 *    reason, and the journey never reaches a mapping or a row.
 *
 * **The scenario, from the deterministic seed.** The acting identity is the seeded established worker
 * (`established-worker`), the one persona whose partners make an imported row look like a contact that
 * already exists: row 9 of the fixture is Ruth Okafor, whose address `ruth.okafor@example.org` is the
 * address the seeded partner `partner-ruth-okafor` holds. Nothing else in the file matches a seeded
 * record, and no imported person holds a subscription: the audience is made of the memberships the seed
 * laid down, so an import that grew it would show up on the audience surface as a new member. The runner
 * restores that world before every test, and the `beforeEach` below restores it again by name so each
 * test's starting world is stated where the test reads it.
 *
 * **The fixture is one committed file, read from disk at upload time.** It is served at
 * `/fixtures/contacts-example.csv` and read here from `public/fixtures/`, so the bytes the journey reads
 * are the bytes in the repository and nothing is fetched from outside it. The two refusal cases are
 * *built* here, in this test's own output directory, because neither belongs in the repository: a file
 * over the row limit is 200 kB of synthetic rows, and the workbook case needs only a real local-file
 * header to be a workbook rather than text.
 *
 * **Every assertion is about the application's own words.** A row of the review is found by a value only
 * that row carries, a row of the receipt by its own row number, a state by the word on its badge, and a
 * count by counting the rows that report it. Each of the two per-row compositions the family renders — the
 * wide table and the narrow cards, one of which is hidden at any width — carries the same controls, so
 * every control inside a row is reached from that row, and every control read from a table is scoped to
 * that table. No assertion treats a transient message as evidence: the durable record is the receipt, and
 * every claim below reads it. Nothing here reads the store, calls the import module directly, or asserts on
 * a CSS class or a screenshot.
 *
 * **What this file deliberately never says.** An accepted row is not a subscriber, a suggested contact is
 * not a merge, and a stopped import is not a rollback: each is asserted as the distinction it is, because
 * a receipt that blurred them would pass a weaker test.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, resetSeed, test } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  // The world every test in this file starts from: the established worker's seeded data, restored through
  // the application's own control. The runner's automatic fixture also restores it for the persona a test
  // acts as; this call states the same restoration beside the tests that depend on it, and a second reset
  // over a just-reset seed changes nothing.
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded world this file acts in, and the fixed values it reads the application by
// ---------------------------------------------------------------------------------------------

/** The contact-import journey's address (AAP 0.9.1: `/partners/import`). */
const IMPORT_PATH = "/partners/import";

/** The publisher's Update-email audience: the surface that would show a membership an import created. */
const AUDIENCE_PATH = "/communication/audience";

/** The development control every armed failure travels through (AAP 0.6.3: `/api/dev`). */
const DEV_CONTROL_PATH = "/api/dev";

/** The words the shell states on every surface of this development build. */
const DEVELOPMENT_LABEL = "Development data";

/** The importer's simulated boundary, in the specification's own words (AAP 0.7.2). */
const IMPORTER_SIMULATION = "synthetic files only; a successful local parse is not a safety qualification";

/** The one committed example file, by the name the application shows once it is chosen. */
const EXAMPLE_FILE = "contacts-example.csv";

/** Where that file lives inside the checkout, relative to the application package. */
const FIXTURE_SEGMENTS = ["public", "fixtures", EXAMPLE_FILE] as const;

/**
 * The fixture's own structure, as the importer measures it: the number of nonblank data rows and the
 * number of columns its header names. Its one blank row is counted and never becomes a data row, which is
 * why its 27 lines and a header produce 25 rows.
 */
const FIXTURE = { dataRows: 25, columns: 12 } as const;

/**
 * The data-row numbers this file decides about, in the fixture's own order. `parse.ts` numbers a row by
 * its 1-based position among nonblank data rows, so these are the file's numbers rather than line numbers.
 */
const ROW = { duplicateLooking: 9, skipped: 10, invalidValue: 12, restriction: 14 } as const;

/**
 * The text that finds each of those rows in the review's table. Each value appears in exactly one row of
 * the fixture, so a row is always the row this criterion means.
 */
const ROW_MARKER = { duplicateLooking: "ruth.okafor@example.org", skipped: "tomas.rivera@example.org", invalidValue: "nadia.rahman@@example", restriction: "hilary.beckett@example.org" } as const;

/** The corrected address row 12 is given: the row's own value with one `@`, which is its only problem. */
const CORRECTED_EMAIL = "nadia.rahman@example.org";

/** The name the corrected row's contact is created under, composed from the given and family names. */
const CORRECTED_NAME = "Nadia Rahman";

/** The name row 14's contact keeps: the file's own values, unchanged by the restriction it carries. */
const RESTRICTED_NAME = "Hilary Beckett";

/** The restriction row 14 carries in the file, which acceptance must keep exactly as written. */
const CARRIED_RESTRICTION = "Do not contact";

/** What the review's rows are read from: the family's own name for its one per-row table. */
const REVIEW_TABLE = "Rows awaiting a decision";

/** What the receipt's rows are read from: the family's own name for its one per-row table. */
const RESULTS_TABLE = "Per-row import results";

/** The audience's one table, named by its own caption. */
const AUDIENCE_TABLE = "Memberships of this publisher's Update email for this purpose";

/** What the audience surface states a subscribed-style flag is not. */
const NOT_CONSENT_STATEMENT = "A subscribed-style flag, an imported row, a contact edit or an existing partner record is not consent to receive this publisher's Update email for this purpose.";

/** How many decisions of each kind this file records before it accepts. */
const DECISIONS = { create: 2, reuse: 1, skip: 1 } as const;

/** The rows this file leaves undecided: every row but the four it decides. */
const UNDECIDED_ROWS = FIXTURE.dataRows - DECISIONS.create - DECISIONS.reuse - DECISIONS.skip;

/** The wording a control would carry if this application ever let an uncertain result be sent again. */
const RESEND_CONTROL = /resend|send again|send it again|send a new one/iu;

/** The identity an `unknown` receipt states, so the recovery can be read back under it (AAP 0.7.1). */
const STATED_OPERATION = /Operation [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;

// ---------------------------------------------------------------------------------------------
// The fixture, read from the checkout the runner belongs to
// ---------------------------------------------------------------------------------------------

const REPOSITORY_ROOT_MARKERS = ["turbo.json", "bun.lock"] as const;

/**
 * The absolute path of the committed example file.
 *
 * A spec is run from inside the application package and, through turbo, from the repository root, so the
 * file is found by walking up to the nearest ancestor holding both workspace manifests and then descending
 * into the application package. Walking rather than assuming one working directory is what lets the same
 * spec pass wherever it is started from.
 */
function exampleFixturePath(): string {
  let current = process.cwd();
  for (;;) {
    if (REPOSITORY_ROOT_MARKERS.every((marker) => existsSync(join(current, marker)))) {
      const path = join(current, "apps", "dashboard", ...FIXTURE_SEGMENTS);
      if (existsSync(path)) {
        return path;
      }
      throw new Error(`The checkout at ${current} holds no ${join("apps", "dashboard", ...FIXTURE_SEGMENTS)}. This file imports the committed example CSV and never fabricates one, so the fixture has to be in the repository the spec runs against.`);
    }
    const parent = join(current, "..");
    if (parent === current) {
      throw new Error(`No directory up to the filesystem root from ${JSON.stringify(process.cwd())} holds both ${REPOSITORY_ROOT_MARKERS.join(" and ")}, so this file cannot find the checkout whose fixture it uploads. Run the specs from inside the checkout.`);
    }
    current = parent;
  }
}

/**
 * Writes the two files the refusal test needs, into that test's own output directory.
 *
 * Neither belongs in `public/fixtures`: one is 200 kB of synthetic rows that exists only to be over the row
 * limit, and the other is not a CSV at all. Both are produced here, so the repository keeps exactly one
 * example file and no fixture that only a refusal case reads.
 */
function writeRefusalInputs(outputPath: (name: string) => string): { readonly tooManyRows: string; readonly workbook: string } {
  const tooManyRowsStated = 5_001;
  const lines = ["First name,Last name,Email"];
  for (let rowNumber = 1; rowNumber <= tooManyRowsStated; rowNumber += 1) {
    lines.push(`Sweep${String(rowNumber)},Contact${String(rowNumber)},sweep.${String(rowNumber)}@example.org`);
  }
  const tooManyRows = outputPath("contacts-over-the-row-limit.csv");
  writeFileSync(tooManyRows, `${lines.join("\n")}\n`, "utf8");
  // A real ZIP local-file header, which is what every `.xlsx` is underneath: the importer types a file by
  // its bytes, so this is refused as a workbook rather than parsed as text that merely looks odd.
  const workbook = outputPath("contacts.xlsx");
  writeFileSync(workbook, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]), Buffer.from("not text this importer parses", "utf8")]));
  return { tooManyRows, workbook };
}

// ---------------------------------------------------------------------------------------------
// The development control: the one armed failure, and nothing else
// ---------------------------------------------------------------------------------------------

/** One parsed JSON body, read through the members the control's own envelope states. */
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

/** One member of a parsed answer, or `undefined` where the path holds nothing. */
function fieldAt(value: unknown, ...path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** The authority a control runs under and the revision it saw, read immediately before it is operated. */
async function readDevState(page: Page): Promise<{ readonly scope: JsonRecord; readonly revision: string }> {
  const body = await jsonOf(await page.request.get(DEV_CONTROL_PATH), `GET ${DEV_CONTROL_PATH}`);
  const scope = fieldAt(body, "scope");
  const revision = fieldAt(body, "revision");
  if (!isRecord(scope) || typeof revision !== "string" || revision.length === 0) {
    throw new Error(`GET ${DEV_CONTROL_PATH} answered without the authority and revision a control runs under: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { scope, revision };
}

/** Operates exactly one named development control, and refuses an answer that did not apply it. */
async function operateDevControl(page: Page, action: string, payload: JsonRecord): Promise<void> {
  const state = await readDevState(page);
  const body = await jsonOf(await page.request.post(DEV_CONTROL_PATH, { data: { action, operationId: crypto.randomUUID(), scope: state.scope, expectedRevision: state.revision, payload } }), `POST ${DEV_CONTROL_PATH} ${action}`);
  const outcome = fieldAt(body, "outcome");
  if (outcome !== "accepted" && outcome !== "unchanged") {
    throw new Error(`The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A test that could not arm the failure it names would assert against a world it did not choose, so it stops here rather than reporting a failure the application did not cause.`);
  }
}

/**
 * Arms the lost acknowledgement on the acceptance itself.
 *
 * The acceptance is applied and recorded and only its answer is withheld (AAP 0.7.1: `unknown` carries the
 * operation identity and no claim either way), which is what makes the recovery below a recovery rather
 * than a second import: the same operation answers with the result it already stored.
 */
async function armLostAcknowledgement(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { mode: "unknown", target: { kind: "mutation", name: "acceptImportRows" } });
}

/** Disarms the armed failure, so no later test in this file inherits a plan an earlier one armed. */
async function clearFailurePlan(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { plan: null });
}

// ---------------------------------------------------------------------------------------------
// The application's own surfaces, named by the accessible names its components give them
// ---------------------------------------------------------------------------------------------

/** The journey's current step: the one heading of level two the step body states. */
function stepHeading(page: Page, step: string): Locator {
  return page.getByRole("heading", { level: 2, name: step });
}

/** The one per-row review table, by the name its own caption gives it. */
function reviewTable(page: Page): Locator {
  return page.getByRole("table", { name: REVIEW_TABLE });
}

/** One row of the review, found by a value only that row of the fixture carries. */
function reviewRow(page: Page, marker: string): Locator {
  return reviewTable(page).getByRole("row").filter({ hasText: marker });
}

/** The one per-row receipt table of a completed import. */
function resultsTable(page: Page): Locator {
  return page.getByRole("table", { name: RESULTS_TABLE });
}

/** One row of that receipt, by the file's own row number, which is the row header it states. */
function resultsRow(page: Page, rowNumber: number): Locator {
  return resultsTable(page)
    .getByRole("row")
    .filter({ hasText: `Row ${String(rowNumber)}` });
}

/** Every row of the receipt that reports one state, read from the word the row's badge carries. */
function rowsReporting(page: Page, state: string): Locator {
  return resultsTable(page)
    .getByRole("row")
    .filter({ has: page.getByText(state, { exact: true }) });
}

/** The audience's one table: the surface a membership created by an import would appear on. */
function audienceTable(page: Page): Locator {
  return page.getByRole("table", { name: AUDIENCE_TABLE });
}

// ---------------------------------------------------------------------------------------------
// The five steps, one helper each
// ---------------------------------------------------------------------------------------------

/** Opens the journey and states that it starts, as it always starts, at an unchosen file. */
async function openJourney(page: Page): Promise<void> {
  await page.goto(IMPORT_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Import contacts" })).toBeVisible();
  await expect(stepHeading(page, "Choose file")).toBeVisible();
}

/** Chooses one file from disk and continues to the mapping step, which is the first step that reads it. */
async function chooseFile(page: Page, path: string, name: string): Promise<void> {
  await page.getByLabel("CSV file").setInputFiles(path);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Map" }).click();
}

/**
 * Confirms the mapping the file's own headings suggest, which is the mapping this fixture needs unaltered.
 *
 * The confirm control sits in a labelled field, so the label is the control's accessible name while its
 * visible text states the action; the label is what is asserted here, because it is the name a screen
 * reader announces.
 */
async function confirmSuggestedMapping(page: Page): Promise<void> {
  await expect(stepHeading(page, "Map")).toBeVisible();
  await page.getByRole("button", { name: "Confirm the column mapping" }).click();
  await expect(stepHeading(page, "Validate and review")).toBeVisible();
}

/**
 * Records one row's decision, after whatever that decision needs filling in first.
 *
 * A decision is recorded, never applied: the acceptance is the only step that creates anything, which is
 * why the row's own "no decision recorded" marker disappearing is the whole of what this helper asserts.
 */
async function recordDecision(page: Page, marker: string, choice: RegExp, fill?: (row: Locator) => Promise<void>): Promise<void> {
  const row = reviewRow(page, marker);
  await row.getByRole("radio", { name: choice }).click();
  if (fill !== undefined) {
    await fill(row);
  }
  await row.getByRole("button", { name: /^Record the decision about row /u }).click();
  await expect(row.getByText("No decision recorded")).toHaveCount(0);
}

/** Moves from the review to the acceptance, which the recorded decisions are what opens. */
async function reachAcceptance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue to Selectively accept" }).click();
  await expect(stepHeading(page, "Selectively accept")).toBeVisible();
}

/** Presses the one acceptance control and waits for the receipt the step moves to once it settles. */
async function acceptReviewedRows(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Accept the reviewed rows" }).click();
  await expect(stepHeading(page, "Results")).toBeVisible();
}

/** The operation this page's address names, which is the identity the surface shows its receipt under. */
function operationNamedByAddress(page: Page): string {
  const operation = new URL(page.url()).searchParams.get("operation");
  if (operation === null || operation.length === 0) {
    throw new Error(`The import surface at ${page.url()} names no operation, so the identity a reload would recover cannot be asserted. The surface writes it into the address once a proposal read has named it.`);
  }
  return operation;
}

/** Reads the audience's memberships, which is how "this import subscribed nobody" is counted. */
async function membershipRows(page: Page): Promise<number> {
  await page.goto(AUDIENCE_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Update email audience" })).toBeVisible();
  await expect(audienceTable(page)).toBeVisible();
  return audienceTable(page).getByRole("row").count();
}

// ---------------------------------------------------------------------------------------------
// Criterion 4, first part: the five steps, from one chosen file to its receipt
// ---------------------------------------------------------------------------------------------

test("the example file is mapped, reviewed, decided and accepted, and its receipt states what became of every row", async ({ page }) => {
  // The audience before the import: the memberships the seed laid down. Nothing this test does may add one,
  // because an imported row is a contact and never a subscription (AAP 0.8.5).
  const membershipsBefore = await membershipRows(page);
  await expect(page.getByText(NOT_CONSENT_STATEMENT, { exact: true })).toBeVisible();

  await openJourney(page);
  // The shell's development label is asserted once in this file, here: everything below is read off a
  // development build's surfaces, and a reader who mistook them for production would read a stored private
  // preparation entry as a real contact record.
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();

  // Step 1 — Choose file. The four limits are stated before a file is chosen, and the simulated boundary is
  // stated beside the control that triggers it, before anything is parsed.
  const limits = page.getByRole("list", { name: "Limits this file is measured against" });
  await expect(limits).toContainText("5 MiB");
  await expect(limits).toContainText("5,000 nonblank data rows");
  await expect(limits).toContainText("60 columns");
  await expect(limits).toContainText("2,000 characters per cell");
  await expect(page.getByText(IMPORTER_SIMULATION, { exact: true })).toBeVisible();
  await chooseFile(page, exampleFixturePath(), EXAMPLE_FILE);

  // Step 2 — Map. The file's measured structure, then the two columns that carry the same heading: they stay
  // two separate columns, each able to supply the email field, and the consent-looking column is offered
  // none at all.
  await expect(stepHeading(page, "Map")).toBeVisible();
  await expect(page.getByText(new RegExp(`${String(FIXTURE.dataRows)} rows · ${String(FIXTURE.columns)} columns`, "u"))).toBeVisible();
  const mapping = page.getByRole("region", { name: "Imported columns and field mapping" });
  const mappingGrid = page.getByRole("table", { name: "Imported columns and field mapping" });
  await expect(mappingGrid.getByRole("rowheader", { name: "Column 5" })).toBeVisible();
  await expect(mappingGrid.getByRole("rowheader", { name: "Column 7" })).toBeVisible();
  const repeatedEmailColumns = mappingGrid.getByRole("row").filter({ hasText: "of 2" });
  await expect(repeatedEmailColumns).toHaveCount(2);
  await expect(repeatedEmailColumns.first()).toContainText("Email");
  await expect(repeatedEmailColumns.nth(1)).toContainText("Email");
  await expect(mapping).toContainText("1 of 2");
  await expect(mapping).toContainText("2 of 2");
  // Each repeated column keeps its own control, and that control can supply the email field: the repeated
  // heading is not merely visible but mappable.
  await expect(mappingGrid.getByLabel("Field for column 5").getByRole("option", { name: "Email", exact: true })).toHaveCount(1);
  await expect(mappingGrid.getByLabel("Field for column 7").getByRole("option", { name: "Email", exact: true })).toHaveCount(1);
  // The "Subscribed" column: kept exactly as it arrived, never mapped, with no control offering it a field.
  const subscribedColumn = mappingGrid.getByRole("row").filter({ hasText: "Kept as data, not interpreted" });
  await expect(subscribedColumn).toHaveCount(1);
  await expect(subscribedColumn).toContainText("Subscribed");
  await expect(subscribedColumn).toContainText("Not mapped");
  await expect(mappingGrid.getByLabel("Field for column 10")).toHaveCount(0);
  // The vocabulary a column may supply is the contact fields and nothing else: no field on this surface can
  // be read as consent, subscription or permission for any publisher or purpose.
  await expect(page.getByRole("option", { name: /consent|subscri|permission|opt.?in/iu })).toHaveCount(0);
  await confirmSuggestedMapping(page);

  // Step 3 — Validate and review. Every row of the file is stated once, its verdict is the domain's, and the
  // duplicate-looking row carries a suggestion that shows the existing value beside the incoming one.
  await expect(reviewTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  const invalidRow = reviewRow(page, ROW_MARKER.invalidValue);
  await expect(invalidRow).toContainText("Needs correction");
  await expect(invalidRow).toContainText("is not a complete email address");
  const duplicateRow = reviewRow(page, ROW_MARKER.duplicateLooking);
  await expect(duplicateRow).toContainText("Existing value");
  await expect(duplicateRow).toContainText("This row's value");
  await expect(duplicateRow.getByRole("radio", { name: /Reuse an authorized identity/u })).toBeEnabled();
  // Suggested, not merged: the row states no recorded decision yet, and the contact it is compared with is
  // untouched until the worker decides to reuse it.
  await expect(duplicateRow.getByText("No decision recorded")).toBeVisible();
  // A negative restriction is stated in the row's own words, and no control on this surface can clear it.
  const restrictionRow = reviewRow(page, ROW_MARKER.restriction);
  await expect(restrictionRow).toContainText(CARRIED_RESTRICTION);
  await expect(restrictionRow).toContainText("Kept exactly as written.");

  // The four decisions of this file: reuse the contact row 9 looks like, skip row 10, correct row 12 and
  // create it, and create row 14 with its restriction exactly as the file states it.
  await recordDecision(page, ROW_MARKER.duplicateLooking, /Reuse an authorized identity/u, async (row) => {
    await row.getByLabel(`Contact row ${String(ROW.duplicateLooking)} would reuse`).selectOption({ index: 0 });
  });
  await recordDecision(page, ROW_MARKER.skipped, /Skip this row/u, async (row) => {
    await row.getByLabel(`Why row ${String(ROW.skipped)} is skipped (optional)`).fill("The same person is already carried by row 11 of this file.");
  });
  await recordDecision(page, ROW_MARKER.invalidValue, /Create a new private entry/u, async (row) => {
    await row.getByLabel(/corrected value for "Email"/u).fill(CORRECTED_EMAIL);
  });
  await recordDecision(page, ROW_MARKER.restriction, /Create a new private entry/u);

  // Step 4 — Selectively accept. The summary states the decision counts the read computed, before anything
  // is accepted, and the notice states what acceptance never does.
  await reachAcceptance(page);
  const division = page.getByRole("region", { name: "How this file's rows divide" });
  await expect(division).toContainText(
    new RegExp([`Created as a new private entry\\s*${String(DECISIONS.create)}`, `Attached to a contact you reuse\\s*${String(DECISIONS.reuse)}`, `Skipped\\s*${String(DECISIONS.skip)}`, `Left undecided\\s*${String(UNDECIDED_ROWS)}`, `Data rows in the file\\s*${String(FIXTURE.dataRows)}`].join("\\s*"), "u"),
  );
  await expect(page.getByText("No one is subscribed", { exact: true })).toBeVisible();
  await expect(page.getByText("A consent-looking column stays as data", { exact: true })).toBeVisible();
  await expect(page.getByText("A suggested contact is a proposal, not a merge", { exact: true })).toBeVisible();
  await acceptReviewedRows(page);

  // Step 5 — Results. Every row of the file reports what became of it, and the counts are the rows' own:
  // the three applied rows, the one skipped by the worker, and the rows nothing was decided about.
  await expect(resultsTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  await expect(rowsReporting(page, "Accepted")).toHaveCount(DECISIONS.create + DECISIONS.reuse);
  await expect(rowsReporting(page, "Skipped")).toHaveCount(DECISIONS.skip);
  await expect(rowsReporting(page, "Needs review")).toHaveCount(UNDECIDED_ROWS);
  await expect(rowsReporting(page, "Failed")).toHaveCount(0);
  // The corrected row was applied under the address the worker typed, and the reused row states that the
  // contact it points at was not changed — a suggestion reused is still not a merge.
  await expect(resultsRow(page, ROW.invalidValue)).toContainText("Accepted");
  await expect(resultsRow(page, ROW.duplicateLooking)).toContainText("Accepted");
  await expect(resultsRow(page, ROW.duplicateLooking)).toContainText("that contact itself was not changed");
  // A row the worker skipped was never applied, and says so rather than offering a destination or a control.
  await expect(resultsRow(page, ROW.skipped)).toContainText("Skipped");
  await expect(resultsRow(page, ROW.skipped)).toContainText("Skipped by the worker's own decision");
  await expect(resultsRow(page, ROW.skipped).getByRole("link")).toHaveCount(0);

  // The rows that were applied each lead to the contact they became, and two applied rows are two distinct
  // contacts: the corrected row keeps the name the file gives it, and the restricted row keeps the
  // restriction the file states.
  // out-of-scope: the roster at `/partners` belongs to another lane of this build and is not rendered here,
  // so the contacts this import created are counted and opened where the receipt itself points — each
  // applied row's own destination — rather than through a list this file cannot read.
  const correctedHref = await resultsRow(page, ROW.invalidValue)
    .getByRole("link", { name: `Open the contact that row ${String(ROW.invalidValue)} became` })
    .getAttribute("href");
  const restrictedHref = await resultsRow(page, ROW.restriction)
    .getByRole("link", { name: `Open the contact that row ${String(ROW.restriction)} became` })
    .getAttribute("href");
  expect(correctedHref, "the corrected row leads to the contact it became").not.toBeNull();
  expect(restrictedHref, "the restricted row leads to the contact it became").not.toBeNull();
  expect(correctedHref).not.toBe(restrictedHref);
  if (correctedHref === null || restrictedHref === null) {
    throw new Error("Both applied rows state where they lead, so neither destination can be absent here.");
  }
  await page.goto(correctedHref);
  await expect(page.getByRole("heading", { level: 1, name: CORRECTED_NAME })).toBeVisible();
  await page.goto(restrictedHref);
  await expect(page.getByRole("heading", { level: 1, name: RESTRICTED_NAME })).toBeVisible();
  await expect(page.getByRole("region", { name: "Restrictions" })).toContainText(CARRIED_RESTRICTION);

  // No subscription, no membership, no consent: the audience holds exactly the memberships the seed laid
  // down, so accepting rows subscribed nobody, whatever the file's own "Subscribed" column said.
  expect(await membershipRows(page)).toBe(membershipsBefore);
});

// ---------------------------------------------------------------------------------------------
// Criterion 4, second part: a lost acknowledgement recovered by operation identity
// ---------------------------------------------------------------------------------------------

test("a lost acknowledgement is recovered by the operation's own identity, with no second contact and no subscription", async ({ page }) => {
  const membershipsBefore = await membershipRows(page);

  await openJourney(page);
  await chooseFile(page, exampleFixturePath(), EXAMPLE_FILE);
  await confirmSuggestedMapping(page);
  await recordDecision(page, ROW_MARKER.restriction, /Create a new private entry/u);
  // The identity the surface is showing this import under, read before the acceptance so the recovery can
  // be compared with it: the address names the import, and a reload reads that same operation back.
  const operation = operationNamedByAddress(page);
  await armLostAcknowledgement(page);
  await reachAcceptance(page);
  await page.getByRole("button", { name: "Accept the reviewed rows" }).click();

  // An `unknown` answer is neither a success nor a failure. It names the operation it may be checked by,
  // offers the read that resolves it, and offers nothing that would send the work a second time.
  await expect(page.getByRole("heading", { name: "Result not confirmed" })).toBeVisible();
  await expect(page.getByText("The acceptance's acknowledgement was lost", { exact: true })).toBeVisible();
  await expect(page.getByText(STATED_OPERATION).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry the same request" })).toBeVisible();
  await expect(page.getByText(/Nothing here starts a second attempt: retrying sends this same operation, which answers with its original result instead of repeating the effect\./u).first()).toBeVisible();
  await expect(page.getByRole("button", { name: RESEND_CONTROL })).toHaveCount(0);

  // Checking that same operation reads back what happened and applies nothing, which is the recovery the
  // criterion asks for: one accepted row, no second contact, and no decision sent again.
  await page.getByRole("button", { name: "Check whether this import was accepted" }).click();
  await expect(stepHeading(page, "Results")).toBeVisible();
  await expect(resultsTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  await expect(rowsReporting(page, "Accepted")).toHaveCount(1);
  await expect(rowsReporting(page, "Accepted earlier")).toHaveCount(0);
  await expect(rowsReporting(page, "Needs review")).toHaveCount(FIXTURE.dataRows - 1);
  expect(operationNamedByAddress(page)).toBe(operation);

  // A reload of the address reads the same operation back: the receipt is the original result, not a new
  // import, and no control on the reloaded page starts a second acceptance.
  await page.reload();
  await expect(page.getByText("This import has already finished", { exact: true })).toBeVisible();
  expect(operationNamedByAddress(page)).toBe(operation);
  await expect(resultsTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  await expect(rowsReporting(page, "Accepted")).toHaveCount(1);
  await expect(rowsReporting(page, "Accepted earlier")).toHaveCount(0);
  await expect(resultsTable(page).getByRole("link", { name: /^Open the contact that row /u })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Accept the reviewed rows" })).toHaveCount(0);

  // No subscription, no membership and no consent came out of the import, even though it was accepted.
  expect(await membershipRows(page)).toBe(membershipsBefore);
  await clearFailurePlan(page);
});

// ---------------------------------------------------------------------------------------------
// Criterion 4, third part: stopping after an acceptance stops only the rows nothing was applied to
// ---------------------------------------------------------------------------------------------

test("stopping an import after it accepted a row leaves that contact and stops only the rows nothing was applied to", async ({ page }) => {
  const membershipsBefore = await membershipRows(page);

  await openJourney(page);
  await chooseFile(page, exampleFixturePath(), EXAMPLE_FILE);
  await confirmSuggestedMapping(page);
  await recordDecision(page, ROW_MARKER.restriction, /Create a new private entry/u);
  await reachAcceptance(page);
  await acceptReviewedRows(page);
  await expect(rowsReporting(page, "Accepted")).toHaveCount(1);
  await expect(rowsReporting(page, "Skipped")).toHaveCount(0);

  // The stop control, and the confirmation a consequential change goes through. The control itself states
  // what stopping does and what it leaves alone, and the confirmation repeats that nothing outside the
  // summary changes before anything is stopped.
  await expect(page.getByText(/Stopping applies nothing further: a row this import already applied keeps the record it became, and every row it has not applied is stopped\./u).first()).toBeVisible();
  await expect(page.getByText(/It withdraws no contact this import created and recalls no message, because an import sends none\./u).first()).toBeVisible();
  await page.getByRole("button", { name: "Stop the rows not yet applied" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Stop this import");
  await expect(dialog).toContainText("Confirming applies this change once.");
  await dialog.getByRole("button", { name: "Stop the rows not yet applied" }).click();

  // Cancellation stops the rows nothing was applied to. The accepted contact keeps the record it became,
  // and its own row keeps pointing at it: a stop is not a rollback.
  await expect(rowsReporting(page, "Accepted")).toHaveCount(1);
  await expect(rowsReporting(page, "Skipped")).toHaveCount(FIXTURE.dataRows - 1);
  await expect(resultsRow(page, ROW.restriction)).toContainText("Accepted");
  await expect(resultsTable(page).getByText("Stopped by the cancellation before acceptance").first()).toBeVisible();
  const keptHref = await resultsRow(page, ROW.restriction)
    .getByRole("link", { name: `Open the contact that row ${String(ROW.restriction)} became` })
    .getAttribute("href");
  expect(keptHref, "the accepted row still leads to the contact it became").not.toBeNull();
  if (keptHref === null) {
    throw new Error("The accepted row keeps its destination after the cancellation, so it cannot be absent here.");
  }
  await page.goto(keptHref);
  await expect(page.getByRole("heading", { level: 1, name: RESTRICTED_NAME })).toBeVisible();
  await expect(page.getByRole("region", { name: "Restrictions" })).toContainText(CARRIED_RESTRICTION);

  // Nothing was subscribed by the import or by stopping it.
  expect(await membershipRows(page)).toBe(membershipsBefore);
});

// ---------------------------------------------------------------------------------------------
// Criterion 4, fourth part: both refusal cases, refused before anything is read
// ---------------------------------------------------------------------------------------------

test("a file over the row limit and a workbook are each refused before a single row is read", async ({ page }, testInfo) => {
  const inputs = writeRefusalInputs((name) => testInfo.outputPath(name));

  await openJourney(page);
  // The row limit: a file that is a perfectly readable CSV with one row too many.
  await chooseFile(page, inputs.tooManyRows, "contacts-over-the-row-limit.csv");
  await expect(page.getByText("This file was not processed", { exact: true })).toBeVisible();
  await expect(page.getByText(/at least 5001 nonblank data rows/u)).toBeVisible();
  await expect(page.getByText(/the limit is 5000 nonblank data rows/u)).toBeVisible();
  // Refused before processing: the journey stays on its first step, where no mapping, no row and no
  // decision exists, and the importer's own limits are still the only thing stated about a file.
  await expect(stepHeading(page, "Choose file")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm the column mapping" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: REVIEW_TABLE })).toHaveCount(0);
  await expect(page.getByText(IMPORTER_SIMULATION, { exact: true })).toBeVisible();

  // The workbook: a file whose own bytes say it is a ZIP container, whatever its name suggests. A filename
  // or an extension never establishes type, so this is refused as a workbook rather than parsed as text.
  await chooseFile(page, inputs.workbook, "contacts.xlsx");
  await expect(page.getByText(/spreadsheet workbook, not a CSV/u)).toBeVisible();
  await expect(stepHeading(page, "Choose file")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm the column mapping" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: REVIEW_TABLE })).toHaveCount(0);
});
