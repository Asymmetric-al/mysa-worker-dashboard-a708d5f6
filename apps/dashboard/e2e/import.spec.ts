/** Criterion 4 — contact import. */ import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { armLostAcknowledgement, clearFailurePlan, expect, repositoryRootFrom, test } from "../playwright.config";
const EXAMPLE_FILE = "contacts-example.csv";
const FIXTURE_SEGMENTS = ["public", "fixtures", EXAMPLE_FILE] as const;
const FIXTURE = { dataRows: 25, columns: 12 } as const;
const ROW = { duplicateLooking: 9, skipped: 10, invalidValue: 12, restriction: 14 } as const;
const ROW_MARKER = { duplicateLooking: "ruth.okafor@example.org", skipped: "tomas.rivera@example.org", invalidValue: "nadia.rahman@@example", restriction: "hilary.beckett@example.org" } as const;
const CORRECTED_EMAIL = "nadia.rahman@example.org"; // The corrected address row 12 is given: the row's own value with one `@`, which is its only problem.
const RESTRICTED_NAME = "Hilary Beckett";
const CARRIED_RESTRICTION = "Do not contact"; // The restriction row 14 carries in the file, which acceptance must keep exactly as written.
const OVERSIZE_FILE = { name: "contacts-over-the-size-limit.csv", bytes: 5_242_907 } as const; // QA's own reproduction at step 1: three bytes past the 5 MiB the limits state, so the chooser's own measurement of the file is what refuses it.
const REVIEW_TABLE = "Rows awaiting a decision";
const DECISIONS = { create: 2, reuse: 1, skip: 1 } as const;
const UNDECIDED_ROWS = FIXTURE.dataRows - DECISIONS.create - DECISIONS.reuse - DECISIONS.skip;
function exampleFixturePath(): string {
  const root = repositoryRootFrom(process.cwd()); // The checkout this runner belongs to, whose committed example CSV is the one file this journey imports.
  const path = join(root, "apps", "dashboard", ...FIXTURE_SEGMENTS);
  if (!existsSync(path)) throw new Error(`The checkout at ${root} holds no ${join("apps", "dashboard", ...FIXTURE_SEGMENTS)}. This file imports the committed example CSV and never fabricates one, so the fixture has to be in the repository the spec runs against.`);
  return path;
}
function writeRefusalInputs(outputPath: (name: string) => string): { readonly tooManyRows: string; readonly workbook: string } {
  const tooManyRowsStated = 5_001; // Writes the two files the refusal test needs, into that test's own output directory.
  const lines = ["First name,Last name,Email"];
  for (let rowNumber = 1; rowNumber <= tooManyRowsStated; rowNumber += 1) lines.push(`Sweep${String(rowNumber)},Contact${String(rowNumber)},sweep.${String(rowNumber)}@example.org`);
  const tooManyRows = outputPath("contacts-over-the-row-limit.csv");
  writeFileSync(tooManyRows, `${lines.join("\n")}\n`, "utf8");
  const workbook = outputPath("contacts.xlsx"); // A real ZIP local-file header, which is what every `.xlsx` is underneath: the importer types a file by its bytes, so this is refused as a workbook rather than parsed as text that merely looks odd.
  writeFileSync(workbook, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]), Buffer.from("not text this importer parses", "utf8")]));
  return { tooManyRows, workbook };
}
function writeOversizeFile(outputPath: (name: string) => string): string {
  const path = outputPath(OVERSIZE_FILE.name); // Writes the file QA chose at step 1, of exactly the size it stated: many data rows of text, every character ASCII so a string's length is the file's byte count.
  const header = "First name,Last name,Email,Notes\n";
  const row = "Sweep,Contact,sweep@example.org,note\n";
  const rows = Math.floor((OVERSIZE_FILE.bytes - header.length) / row.length) - 1; // One row fewer than the file has room for, so the closing row below carries the padding that lands the file on the exact byte count rather than a rounded one.
  const opening = "Sweep,Contact,sweep@example.org,";
  const closing = OVERSIZE_FILE.bytes - header.length - rows * row.length; // The closing row's own length, newline included: the remainder the repeated rows left, which here is between one and two rows' worth.
  writeFileSync(path, `${header}${row.repeat(rows)}${opening}${"x".repeat(closing - opening.length - 1)}\n`, "utf8");
  return path;
}
const armLostAcknowledgementOnAcceptance = async (page: Page): Promise<void> => armLostAcknowledgement(page.request, "acceptImportRows"); // Arms the lost acknowledgement on the acceptance itself: the acceptance is applied and recorded and only its
const stepHeading = (page: Page, step: string): Locator => page.getByRole("heading", { level: 2, name: step });
const reviewTable = (page: Page): Locator => page.getByRole("table", { name: REVIEW_TABLE });
const reviewRow = (page: Page, marker: string): Locator => reviewTable(page).getByRole("row").filter({ hasText: marker }); // One row of the review, found by a value only that row of the fixture carries.
const resultsTable = (page: Page): Locator => page.getByRole("table", { name: "Per-row import results" });
const resultsRow = (page: Page, rowNumber: number): Locator =>
  resultsTable(page)
    .getByRole("row")
    .filter({ hasText: `Row ${String(rowNumber)}` }); // One row of the receipt, by the file's own row number, which is the row header it states.
const rowsReporting = (page: Page, state: string): Locator =>
  resultsTable(page)
    .getByRole("row")
    .filter({ has: page.getByText(state, { exact: true }) }); // Every row of the receipt that reports one state, read from the word the row's badge carries.
const audienceTable = (page: Page): Locator => page.getByRole("table", { name: "Memberships of this publisher's Update email for this purpose" });
async function openJourney(page: Page): Promise<void> {
  await page.goto("/partners/import"); // Opens the journey and states that it starts, as it always starts, at an unchosen file.
  await expect(page.getByRole("heading", { level: 1, name: "Import contacts" })).toBeVisible();
  await expect(stepHeading(page, "Choose file")).toBeVisible();
}
async function chooseFile(page: Page, path: string, name: string): Promise<void> {
  await page.getByLabel("CSV file").setInputFiles(path); // Chooses one file from disk and continues to the mapping step, which is the first step that reads it.
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Map" }).click();
}
async function confirmSuggestedMapping(page: Page): Promise<void> {
  await expect(stepHeading(page, "Map")).toBeVisible(); // Confirms the mapping the file's own headings suggest, which is the mapping this fixture needs unaltered.
  await page.getByRole("button", { name: "Confirm the column mapping" }).click();
  await expect(stepHeading(page, "Validate and review")).toBeVisible();
}
async function recordDecision(page: Page, marker: string, choice: RegExp, fill?: (row: Locator) => Promise<void>): Promise<void> {
  const row = reviewRow(page, marker);
  await row.getByRole("radio", { name: choice }).click();
  if (fill !== undefined) await fill(row);
  await row.getByRole("button", { name: /^Record the decision about row /u }).click();
  await expect(row.getByText("No decision recorded")).toHaveCount(0);
}
async function reachAcceptance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue to Selectively accept" }).click(); // Moves from the review to the acceptance, which the recorded decisions are what opens.
  await expect(stepHeading(page, "Selectively accept")).toBeVisible();
}
async function acceptReviewedRows(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Accept the reviewed rows" }).click(); // Presses the one acceptance control and waits for the receipt the step moves to once it settles.
  await expect(stepHeading(page, "Results")).toBeVisible();
}
function operationNamedByAddress(page: Page): string {
  const operation = new URL(page.url()).searchParams.get("operation"); // The operation this page's address names, which is the identity the surface shows its receipt under.
  if (operation === null || operation.length === 0) throw new Error(`The import surface at ${page.url()} names no operation, so the identity a reload would recover cannot be asserted. The surface writes it into the address once a proposal read has named it.`);
  return operation;
}
async function membershipRows(page: Page): Promise<number> {
  await page.goto("/communication/audience"); // Reads the audience's memberships, which is how "this import subscribed nobody" is counted.
  await expect(page.getByRole("heading", { level: 1, name: "Update email audience" })).toBeVisible();
  await expect(audienceTable(page)).toBeVisible();
  return audienceTable(page).getByRole("row").count();
}
test("the example file is mapped, reviewed, decided and accepted, and its receipt states what became of every row", async ({ page }) => {
  const membershipsBefore = await membershipRows(page); // The audience before the import: the memberships the seed laid down. Nothing this test does may add one, because an imported row is a contact and never a subscription (AAP 0.8.5).
  await expect(page.getByText("A subscribed-style flag, an imported row, a contact edit or an existing partner record is not consent to receive this publisher's Update email for this purpose.", { exact: true })).toBeVisible();
  await openJourney(page);
  await expect(page.getByText("Development data", { exact: true }).first()).toBeVisible();
  const limits = page.getByRole("list", { name: "Limits this file is measured against" }); // Step 1 — Choose file. The four limits are stated before a file is chosen, and the simulated boundary is stated beside the control that triggers it, before anything is parsed.
  for (const value of ["5 MiB", "5,000 nonblank data rows", "60 columns", "2,000 characters per cell"]) await expect(limits).toContainText(value);
  await chooseFile(page, exampleFixturePath(), EXAMPLE_FILE);
  await expect(stepHeading(page, "Map")).toBeVisible();
  await expect(page.getByText(new RegExp(`${String(FIXTURE.dataRows)} rows · ${String(FIXTURE.columns)} columns`, "u"))).toBeVisible();
  const mapping = page.getByRole("region", { name: "Imported columns and field mapping" });
  const mappingGrid = page.getByRole("table", { name: "Imported columns and field mapping" });
  for (const column of ["Column 5", "Column 7"]) await expect(mappingGrid.getByRole("rowheader", { name: column })).toBeVisible();
  const repeatedEmailColumns = mappingGrid.getByRole("row").filter({ hasText: "of 2" });
  await expect(repeatedEmailColumns).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) await expect(repeatedEmailColumns.nth(index)).toContainText("Email");
  for (const text of ["1 of 2", "2 of 2"]) await expect(mapping).toContainText(text);
  for (const column of ["5", "7"]) await expect(mappingGrid.getByLabel(`Field for column ${column}`).getByRole("option", { name: "Email", exact: true })).toHaveCount(1);
  const subscribedColumn = mappingGrid.getByRole("row").filter({ hasText: "Kept as data, not interpreted" }); // The "Subscribed" column: kept exactly as it arrived, never mapped, with no control offering it a field.
  await expect(subscribedColumn).toHaveCount(1);
  for (const text of ["Subscribed", "Not mapped"]) await expect(subscribedColumn).toContainText(text);
  await expect(mappingGrid.getByLabel("Field for column 10")).toHaveCount(0);
  await expect(mappingGrid.getByRole("option", { name: /consent|subscri|permission|opt.?in/iu })).toHaveCount(0);
  await confirmSuggestedMapping(page);
  await expect(reviewTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  const invalidRow = reviewRow(page, ROW_MARKER.invalidValue);
  await expect(invalidRow).toContainText("Needs correction");
  await expect(invalidRow).toContainText("is not a complete email address");
  const duplicateRow = reviewRow(page, ROW_MARKER.duplicateLooking);
  await expect(duplicateRow).toContainText("Existing value");
  await expect(duplicateRow).toContainText("This row's value");
  await expect(duplicateRow.getByRole("radio", { name: /Reuse an authorized identity/u })).toBeEnabled();
  await expect(duplicateRow.getByText("No decision recorded")).toBeVisible();
  const restrictionRow = reviewRow(page, ROW_MARKER.restriction); // A negative restriction is stated in the row's own words, and no control on this surface can clear it.
  await expect(restrictionRow).toContainText(CARRIED_RESTRICTION);
  await expect(restrictionRow).toContainText("Kept exactly as written.");
  // The four decisions of this file: reuse the contact row 9 looks like, skip row 10, correct row 12 and create it, and create row 14 with its restriction exactly as the file states it.
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
  await reachAcceptance(page); // Step 4 — Selectively accept. The summary states the decision counts the read computed, before anything is accepted, and the notice states what acceptance never does.
  const division = page.getByRole("region", { name: "How this file's rows divide" });
  await expect(division).toContainText(
    new RegExp([`Created as a new private entry\\s*${String(DECISIONS.create)}`, `Attached to a contact you reuse\\s*${String(DECISIONS.reuse)}`, `Skipped\\s*${String(DECISIONS.skip)}`, `Left undecided\\s*${String(UNDECIDED_ROWS)}`, `Data rows in the file\\s*${String(FIXTURE.dataRows)}`].join("\\s*"), "u"),
  );
  for (const value of ["No one is subscribed", "A consent-looking column stays as data", "A suggested contact is a proposal, not a merge"]) await expect(page.getByText(value, { exact: true })).toBeVisible();
  await acceptReviewedRows(page);
  await expect(resultsTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  for (const [state, count] of Object.entries({ Accepted: DECISIONS.create + DECISIONS.reuse, Skipped: DECISIONS.skip, "Needs review": UNDECIDED_ROWS, Failed: 0 })) await expect(rowsReporting(page, state)).toHaveCount(count);
  await expect(resultsRow(page, ROW.invalidValue)).toContainText("Accepted");
  await expect(resultsRow(page, ROW.duplicateLooking)).toContainText("Accepted");
  await expect(resultsRow(page, ROW.duplicateLooking)).toContainText("that contact itself was not changed");
  for (const text of ["Skipped", "Skipped by the worker's own decision"]) await expect(resultsRow(page, ROW.skipped)).toContainText(text);
  await expect(resultsRow(page, ROW.skipped).getByRole("link")).toHaveCount(0);
  const correctedHref = await resultsRow(page, ROW.invalidValue) // this build and is not rendered here, so the contacts this import created are counted and opened where the receipt itself points — each applied row's own destination — rather than through a list this file cannot read.
    .getByRole("link", { name: `Open the contact that row ${String(ROW.invalidValue)} became` })
    .getAttribute("href");
  const restrictedHref = await resultsRow(page, ROW.restriction)
    .getByRole("link", { name: `Open the contact that row ${String(ROW.restriction)} became` })
    .getAttribute("href");
  expect(correctedHref, "the corrected row leads to the contact it became").not.toBeNull();
  expect(restrictedHref, "the restricted row leads to the contact it became").not.toBeNull();
  expect(correctedHref).not.toBe(restrictedHref);
  if (correctedHref === null || restrictedHref === null) throw new Error("Both applied rows state where they lead, so neither destination can be absent here.");
  await page.goto(correctedHref);
  await expect(page.getByRole("heading", { level: 1, name: "Nadia Rahman" })).toBeVisible();
  await page.goto(restrictedHref);
  await expect(page.getByRole("heading", { level: 1, name: RESTRICTED_NAME })).toBeVisible();
  await expect(page.getByRole("region", { name: "Restrictions" })).toContainText(CARRIED_RESTRICTION);
  expect(await membershipRows(page)).toBe(membershipsBefore);
});
test("a lost acknowledgement is recovered by the operation's own identity, with no second contact and no subscription", async ({ page }) => {
  const membershipsBefore = await membershipRows(page);
  await openJourney(page);
  await chooseFile(page, exampleFixturePath(), EXAMPLE_FILE);
  await confirmSuggestedMapping(page);
  await recordDecision(page, ROW_MARKER.restriction, /Create a new private entry/u);
  const operation = operationNamedByAddress(page); // The identity the surface is showing this import under, read before the acceptance so the recovery can be compared with it: the address names the import, and a reload reads that same operation back.
  await armLostAcknowledgementOnAcceptance(page);
  await reachAcceptance(page);
  await page.getByRole("button", { name: "Accept the reviewed rows" }).click();
  await expect(page.getByRole("heading", { name: "Result not confirmed" })).toBeVisible();
  await expect(page.getByText("The acceptance's acknowledgement was lost", { exact: true })).toBeVisible();
  await expect(page.getByText(/Operation [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry the same request" })).toBeVisible();
  await expect(page.getByText(/Nothing here starts a second attempt: retrying sends this same operation, which answers with its original result instead of repeating the effect\./u).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /resend|send again|send it again|send a new one/iu })).toHaveCount(0);
  await page.getByRole("button", { name: "Check whether this import was accepted" }).click(); // Checking that same operation reads back what happened and applies nothing, which is the recovery the criterion asks for: one accepted row, no second contact, and no decision sent again.
  await expect(stepHeading(page, "Results")).toBeVisible();
  await expect(resultsTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  for (const [state, count] of Object.entries({ Accepted: 1, "Accepted earlier": 0, "Needs review": FIXTURE.dataRows - 1 })) await expect(rowsReporting(page, state)).toHaveCount(count);
  expect(operationNamedByAddress(page)).toBe(operation);
  await page.reload();
  await expect(page.getByText("This import has already finished", { exact: true })).toBeVisible();
  expect(operationNamedByAddress(page)).toBe(operation);
  await expect(resultsTable(page).getByRole("row")).toHaveCount(FIXTURE.dataRows + 1);
  for (const [state, count] of Object.entries({ Accepted: 1, "Accepted earlier": 0 })) await expect(rowsReporting(page, state)).toHaveCount(count);
  await expect(resultsTable(page).getByRole("link", { name: /^Open the contact that row /u })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Accept the reviewed rows" })).toHaveCount(0);
  expect(await membershipRows(page)).toBe(membershipsBefore);
  await clearFailurePlan(page.request);
});
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
  await expect(page.getByText(/Stopping applies nothing further: a row this import already applied keeps the record it became, and every row it has not applied is stopped\./u).first()).toBeVisible();
  await expect(page.getByText(/It withdraws no contact this import created and recalls no message, because an import sends none\./u).first()).toBeVisible();
  await page.getByRole("button", { name: "Stop the rows not yet applied" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Stop this import");
  await expect(dialog).toContainText("Confirming applies this change once.");
  await dialog.getByRole("button", { name: "Stop the rows not yet applied" }).click();
  await expect(rowsReporting(page, "Accepted")).toHaveCount(1);
  await expect(rowsReporting(page, "Skipped")).toHaveCount(FIXTURE.dataRows - 1);
  await expect(resultsRow(page, ROW.restriction)).toContainText("Accepted");
  await expect(resultsTable(page).getByText("Stopped by the cancellation before acceptance").first()).toBeVisible();
  const keptHref = await resultsRow(page, ROW.restriction)
    .getByRole("link", { name: `Open the contact that row ${String(ROW.restriction)} became` })
    .getAttribute("href");
  expect(keptHref, "the accepted row still leads to the contact it became").not.toBeNull();
  if (keptHref === null) throw new Error("The accepted row keeps its destination after the cancellation, so it cannot be absent here.");
  await page.goto(keptHref);
  await expect(page.getByRole("heading", { level: 1, name: RESTRICTED_NAME })).toBeVisible();
  await expect(page.getByRole("region", { name: "Restrictions" })).toContainText(CARRIED_RESTRICTION);
  expect(await membershipRows(page)).toBe(membershipsBefore);
});
test("a file over the row limit and a workbook are each refused before a single row is read", async ({ page }, testInfo) => {
  const inputs = writeRefusalInputs((name) => testInfo.outputPath(name));
  await openJourney(page);
  await chooseFile(page, inputs.tooManyRows, "contacts-over-the-row-limit.csv");
  await expect(page.getByText("This file was not processed", { exact: true })).toBeVisible();
  await expect(page.getByText(/at least 5001 nonblank data rows/u)).toBeVisible();
  await expect(page.getByText(/the limit is 5000 nonblank data rows/u)).toBeVisible();
  await expect(stepHeading(page, "Choose file")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm the column mapping" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: REVIEW_TABLE })).toHaveCount(0);
  await expect(page.getByText("synthetic files only; a successful local parse is not a safety qualification", { exact: true })).toBeVisible();
  await chooseFile(page, inputs.workbook, "contacts.xlsx"); // The workbook: a file whose own bytes say it is a ZIP container, whatever its name suggests. A filename or an extension never establishes type, so this is refused as a workbook rather than parsed as text.
  await expect(page.getByText(/spreadsheet workbook, not a CSV/u)).toBeVisible();
  await expect(stepHeading(page, "Choose file")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm the column mapping" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: REVIEW_TABLE })).toHaveCount(0);
});
test("a file over the size limit is refused in the browser, before its bytes are read or sent", async ({ page }, testInfo) => {
  const path = writeOversizeFile((name) => testInfo.outputPath(name));
  const posted: string[] = []; // Every POST this page addresses to the import route, so "nothing was sent" is counted rather than taken from the screen.
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/import") posted.push(request.url());
  });
  await openJourney(page);
  const input = page.getByLabel("CSV file"); // Step 1 — the only step this file reaches: its own size is measured here, before a byte of it is read.
  await input.setInputFiles(path);
  await expect(input, "The refusal is stated at the control the file was chosen with, and that control is marked invalid as it is after a failed read.").toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/This file is 5242907 bytes; the limit is 5242880 bytes \(5 MiB\)/u), "The refusal names the size this file measures and the 5 MiB limit it passes.").toBeVisible();
  await expect(page.getByText(/did not read that file and sent nothing/u), "The chooser states what happened here: the file was not read, and nothing from it was sent to the importer.").toBeVisible();
  await expect(page.getByText(/^No file chosen yet\./u), "No file stands as the chosen one, so the step says none is chosen rather than naming a file the importer would refuse.").toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Map" })).toBeDisabled();
  await expect(input, "Another file can be chosen at once: nothing is left reading, because nothing was read.").toBeEnabled();
  await expect(stepHeading(page, "Choose file")).toBeVisible();
  await expect(stepHeading(page, "Map"), "The journey stays at the step that refused the file, so no later step is reached with it.").toHaveCount(0);
  await page.getByLabel("CSV file").setInputFiles(exampleFixturePath()); // A file the importer accepts, chosen after the refusal: the step reads it as it reads any other, so the guard has cost the worker nothing.
  await expect(page.getByText(EXAMPLE_FILE, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Map" })).toBeEnabled();
  await input.setInputFiles(path); // The over-limit file again, now that an accepted file stands: the refusal is stated and that file stays exactly as it was chosen, rather than being cleared by a file the browser read nothing from.
  await expect(page.getByText(/did not read that file and sent nothing/u)).toBeVisible();
  await expect(page.getByText(EXAMPLE_FILE, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Map" })).toBeEnabled();
  expect(posted, "The over-limit file never became a request, so the service was asked to judge no body at all.").toEqual([]);
});
test("a decision whose revision moved on states the conflict beside the decision it kept, and the reread rows let it be recorded", async ({ page }) => {
  await openJourney(page);
  await chooseFile(page, exampleFixturePath(), EXAMPLE_FILE);
  await confirmSuggestedMapping(page);
  const statuses: number[] = []; // The two answers this test reads, so the refusal it asserts on is the service's own and not an armed one.
  page.on("response", (response) => {
    if (response.url().includes("/api/import/decisions")) statuses.push(response.status());
  });
  // Two decisions pressed back to back, both presenting the revision the review was read at: the first is held at the transport until the second has been sent, so exactly one reaches the service at the revision it presented and the other is refused as stale. Nothing is injected — the refusal is the service's own `conflict`, which is why this case can assert on it.
  let sent = 0;
  let secondSent: () => void = () => {};
  const secondArrived = new Promise<void>((resolve) => {
    secondSent = resolve;
  });
  await page.route("**/api/import/decisions", async (route) => {
    sent += 1;
    if (sent === 1) await secondArrived;
    else secondSent();
    await route.continue();
  });
  const press = async (row: Locator): Promise<void> => {
    await row.getByRole("radio", { name: "Create a new private entry" }).click();
    await row.getByRole("button", { name: /^Record the decision about row /u }).click();
  };
  const firstRow = reviewRow(page, ROW_MARKER.duplicateLooking);
  const secondRow = reviewRow(page, ROW_MARKER.restriction);
  await press(firstRow);
  await expect(firstRow.getByRole("button", { name: `Recording the decision about row ${String(ROW.duplicateLooking)}…` }), "A row whose own decision is in flight states that it is recording it, rather than looking idle while it waits.").toBeVisible();
  await press(secondRow);
  await expect(page.getByRole("button", { name: /^Recording the decision about row /u }), "Every attempt settles, so no row is left reading as if its decision were still being recorded.").toHaveCount(0);
  const conflict = page.locator('[role="alert"]').filter({ hasText: "the review changed before it arrived" });
  await expect(conflict, "A stale revision is answered on the row it refused with the conflict outcome, rather than with silence or a changed decision.").toBeVisible();
  const panel = (await conflict.innerText()).replace(/\s+/gu, " ");
  const named = /Decision about row (\d+)/u.exec(panel);
  expect(named, "The conflict names the row whose decision it refused.").not.toBeNull();
  const refusedRowNumber = Number(named?.[1] ?? "");
  expect([ROW.duplicateLooking, ROW.restriction], "The conflict is about one of the two rows this test pressed back to back.").toContain(refusedRowNumber);
  // Which of the two rows was refused is read off the rows themselves — the refused row recorded nothing, so it is the one still stating that no decision is recorded — and the conflict's own title is checked against it rather than trusted on its own.
  const firstStillUndecided = (await firstRow.getByText("No decision recorded").count()) > 0;
  const refusedRow = firstStillUndecided ? firstRow : secondRow;
  const recordedRow = firstStillUndecided ? secondRow : firstRow;
  expect(refusedRowNumber, "The row the conflict names is the row whose decision recorded nothing.").toBe(firstStillUndecided ? ROW.duplicateLooking : ROW.restriction);
  // The conflict states the record's current value beside the caller's preserved input (AAP 0.7.1): the revision the review now stands at, the decision this attempt posted, and the decision the review now holds for that row.
  for (const stated of ["Current revision", "rev-", "The decision you recorded", "Create a new private entry", "The decision the review now holds"]) expect(panel, `The conflict states ${JSON.stringify(stated)}.`).toContain(stated);
  expect(statuses.slice().sort(), "One decision was accepted at the revision both presented, and the other was refused as stale.").toEqual([200, 409]);
  await expect(recordedRow.getByText("No decision recorded"), "The decision that reached the service first is recorded, so this row no longer states that none is.").toHaveCount(0);
  await expect(refusedRow.getByText("No decision recorded"), "The refused row recorded nothing, so it still states that no decision is recorded for it.").toBeVisible();
  await refusedRow.getByRole("button", { name: /^Record the decision about row /u }).click(); // The recovery the panel promises: the row kept the decision, and pressing it again submits against the revision the reread rows state.
  await expect(refusedRow.getByText("No decision recorded"), "The kept decision is recorded once the row is pressed against the revision the review now stands at.").toHaveCount(0);
  await expect(page.locator('[role="alert"]').filter({ hasText: "the review changed before it arrived" }), "Recording the decision again clears the conflict it was refused with.").toHaveCount(0);
  await expect(refusedRow.getByText(new RegExp(`already recorded for row ${String(refusedRowNumber)}`, "u")), "The row reports the decision it now holds rather than offering the same one again.").toBeVisible();
  await page.unroute("**/api/import/decisions");
});
