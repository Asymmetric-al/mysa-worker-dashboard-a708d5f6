/**
 * Criterion 2 — **First useful session** (AAP 0.12.1) and the opening of journey 1: as the new worker,
 * create a private contact with only a name, add a one-off task and save an Update draft, and find all
 * three still there after navigation away and back and after a full refresh.
 *
 * **Seed identity.** This spec acts as `new-worker` (session `new-worker`) in the `signed-in` session
 * state. The seed gives that person no gift, no goal, no subscription and no integration: one private
 * preparation record, one dated task to follow up, and one Update whose single public English edition has
 * never held a draft. Everything this journey reads back it wrote here, beside those seeded records rather
 * than in place of them, and the financial, goal and subscription surfaces are deliberately not asserted:
 * emptiness there belongs to another criterion, and a claim about it would be a claim this journey never
 * makes.
 *
 * **What it proves, and how.** Each of the three records is written through the surface a worker uses and
 * then read again from the real application: the durable in-context receipt states that the attempt was
 * `accepted` (never a toast, never a bare address change), the record is visible in its own list, it is
 * still in its list after navigating away and back, and it is still readable after a hard reload on each
 * of the three surfaces. A private preparation record is not a shared identity, so the contact's own page
 * is read for the facts it does *not* claim: no contact method, no consent, no invented detail.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

import { resetSeed, SEEDED_PERSONAS, SESSION_COOKIE } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded identity, the records this journey writes, and the words the application states
// ---------------------------------------------------------------------------------------------

/** The seeded identity this spec acts as: the new worker's own session, whose cookie is the whole authority. */
const NEW_WORKER = SEEDED_PERSONAS["new-worker"];

/** The private contact this journey creates. A name is the only field it fills, which is what the criterion asks. */
const CONTACT_NAME = "Rosa Delgado";

/**
 * The one private preparation record the seed already holds, named here so the roster is compared against a
 * known world rather than against a count: this journey must add a record, not replace the seeded one.
 */
const SEEDED_CONTACT_NAME = "Ada Quinn (met on Sunday)";

/** The one-off task this journey creates: a title and nothing else, so the task has no due date of its own. */
const TASK_TITLE = "Send Rosa a first note";

/** The sentence this journey writes into the Update's first draft, read back after a reload to prove the save. */
const DRAFT_TEXT = "Thank you for the welcome on Sunday. This is the first note from the youth ministry.";

/** The seeded Update this journey writes its first draft into. The seed creates it; the spec never pastes an address to reach it. */
const UPDATE_DOCUMENT_ID = "doc-update-first-note";

/** The shell's persistent label: every surface of this application states that its records are synthetic. */
const DEVELOPMENT_DATA_LABEL = "Development data";

/** The heading the one receipt for a settled mutation carries when the change was applied (`operation-result.tsx`). */
const SAVED_HEADING = "Saved";

/** The private-contact form's heading, which is also its submit button's name: this file's own words for one action. */
const ADD_PRIVATE_CONTACT = "Add a private contact";

/** The reason Home gives for the undated task this journey creates, and the destination it offers for it. */
const UNDATED_TASK_REASON = "This task has no date the calendar can read, so the Work list is where its date is decided.";
const UNDATED_TASK_DESTINATION = "Open Work";

/** The lifecycle sentence that keeps a saved draft distinct from a published release (`draft-status.tsx`). */
const DRAFT_IS_NOT_A_RELEASE = "Saved and unpublished. A saved draft is not a release, so no audience can read it.";

/** The record's own fact for an edition with no draft, and its fact for an edition with no release head. */
const NO_DRAFT_YET = "No draft is saved for this edition yet, so there is nothing to submit for review.";
const NO_RELEASE_YET = "This edition publishes nothing yet, so no reader is served a revision of it.";

/** The one edition this journey writes: the seeded Update's public English edition, named by the article the matrix gives it. */
const DRAFT_EDITION = /Public English/u;

/** Home's third partition, whose heading states how many items it holds. */
const UNFINISHED_WORK = /^Unfinished work/u;

/** The shell's own navigation, named by the labels it states rather than by an address this spec types. */
const NAV = {
  home: "Home",
  partners: "Partners",
  work: "Work",
  communication: "Communication",
} as const;

// ---------------------------------------------------------------------------------------------
// Reaching the application as the new worker
// ---------------------------------------------------------------------------------------------

/**
 * The origin this clone's server answers on, taken from the runner's own `baseURL` rather than assumed:
 * the cookie has to be scoped to the origin Playwright drives, and a second checkout runs on another port.
 */
function originOf(): string {
  const stated = test.info().project.use.baseURL;
  if (typeof stated !== "string" || stated.trim() === "") {
    throw new Error("This runner states no baseURL, so the new worker's session cookie has no origin to belong to. Run the spec through apps/dashboard/playwright.config.ts, which states one.");
  }
  return stated;
}

// Every journey starts from the deterministic seed, restored through the application's own development
// control so the scenario clock returns to the seed instant as well as the records.
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// The new worker's own session is the identity every request in this spec is authorised as. The cookie is
// the whole identity: the service resolves it into a principal and its admitted memberships, so nothing
// here invents a scope and no session file is committed.
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: SESSION_COOKIE, value: NEW_WORKER.sessionId, url: originOf() }]);
});

// ---------------------------------------------------------------------------------------------
// Reading and writing one surface at a time
// ---------------------------------------------------------------------------------------------

/** Opens one surface by operating the shell's own navigation, and states that the surface it opened is the one expected. */
async function openSurface(page: Page, linkName: string, heading: string): Promise<void> {
  await page.getByRole("link", { name: linkName, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading }), `The shell's ${linkName} link opens the ${heading} surface.`).toBeVisible();
}

/** Asserts the persistent Development data label is on the surface in view. */
async function expectDevelopmentDataLabel(page: Page): Promise<void> {
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }), "Every surface states that its records are synthetic development data.").toBeVisible();
}

/**
 * Asserts one mutation's durable receipt reports `accepted`.
 *
 * The receipt is the in-context record of what happened (`operation-result.tsx`): its own outcome attribute
 * carries the closed vocabulary of the service, and its heading is the word a person reads. A toast would
 * satisfy neither, and a bare address change would satisfy nothing.
 */
async function expectAcceptedReceipt(receiptScope: Locator, where: string): Promise<void> {
  const receipt = receiptScope.locator('[data-slot="operation-result"]');
  await expect(receipt, `The ${where} reports its own outcome, and it is the durable receipt rather than a toast.`).toHaveAttribute("data-outcome", "accepted");
  await expect(receipt.getByRole("heading", { name: SAVED_HEADING, exact: true })).toBeVisible();
}

/** Creates one private preparation record from a name alone, through the form the roster's first action offers. */
async function createPrivateContact(page: Page): Promise<void> {
  const form = page.getByRole("region", { name: ADD_PRIVATE_CONTACT });
  await expect(form, "The roster offers the private-contact form as a real action rather than a typed address.").toBeVisible();
  await form.getByRole("textbox", { name: "Name", exact: true }).fill(CONTACT_NAME);
  await form.getByRole("button", { name: ADD_PRIVATE_CONTACT }).click();
  await expectAcceptedReceipt(form, "private-contact form");
}

/**
 * Asserts the created private contact is its own record class and carries nothing this journey did not write.
 *
 * Read on the contact's own page, reached from the receipt's own link: a name-only private preparation
 * records no contact method, no consent to hear from the ministry and no reader grant, and it claims
 * nothing about a person's identity that a name does not establish.
 */
async function expectPrivateContactCarriesNothingElse(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: CONTACT_NAME })).toBeVisible();
  await expect(page.getByText("No contact method on this record is permitted.", { exact: true })).toBeVisible();
  // Consent is stated as a fact of its own and never claimed from a name: the record says contactability is a
  // separate fact, and nothing on the page records consent for this ministry and purpose.
  await expect(page.getByText("No consent is recorded for this ministry and purpose.")).toHaveCount(0);
  await expect(page.getByText(/Contactability only — Consent to hear from this ministry/u)).toBeVisible();
  // The two labelled kinds this journey never supplied: a contact method of either kind would state one.
  await expect(page.getByText("Email address", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Phone number", { exact: true })).toHaveCount(0);
  await expectDevelopmentDataLabel(page);
}

/** Creates one one-off task from a title alone, through the composer the Work surface opens. */
async function createUndatedTask(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const composer = page.getByRole("region", { name: "New task" });
  await expect(composer, "The composer states its own heading, so the form is a region a reader can name.").toBeVisible();
  await composer.getByRole("textbox", { name: "Title", exact: true }).fill(TASK_TITLE);
  await composer.getByRole("button", { name: "Create task", exact: true }).click();
  await expectAcceptedReceipt(composer, "task composer");
}

/** Selects one of the five task lists by operating the switcher the surface states. */
async function openTaskList(page: Page, listName: string): Promise<void> {
  await page.getByRole("tab", { name: listName, exact: true }).click();
}

/** Asserts one task is listed in the list on screen, in the column a worker reads its title from. */
async function expectTaskListed(page: Page, listName: string): Promise<void> {
  await expect(page.getByRole("cell", { name: TASK_TITLE, exact: true }), `The ${listName} list states the task this journey created.`).toBeVisible();
}

/**
 * Writes and saves the first draft of the seeded Update's public English edition.
 *
 * The journey is the worker's own: the Updates list, the Update it holds, the edition's editor, the text,
 * and the autosave that states the revision the service acknowledged. Nothing is typed into an address bar.
 */
async function saveFirstDraft(page: Page): Promise<void> {
  await page.getByRole("link", { name: new RegExp(UPDATE_DOCUMENT_ID, "u") }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Update" })).toBeVisible();
  await page.getByRole("link", { name: "Open the editor", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Update edition" })).toBeVisible();
  const prose = page.getByRole("textbox", { name: "The text of this Update edition", exact: true });
  await expect(prose).toBeVisible();
  await prose.click();
  await page.keyboard.type(DRAFT_TEXT);
  // The save is the editor's own autosave, and it states the revision the service acknowledged only once
  // the service has answered: waiting on that word is what makes the text recorded rather than typed.
  const autosave = page.locator('[data-slot="autosave-status"]');
  await expect(autosave).toHaveAttribute("data-autosave-state", "saved");
  await expect(autosave.getByText(/acknowledged revision/u)).toBeVisible();
}

/** Opens the seeded Update's own record from the Updates list, by way of the link the list states. */
async function openUpdateRecord(page: Page): Promise<void> {
  await page.getByRole("link", { name: new RegExp(UPDATE_DOCUMENT_ID, "u") }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Update" })).toBeVisible();
}

/**
 * Asserts the edition this journey wrote states itself as a saved draft rather than as a release.
 *
 * The lifecycle word and its sentence are read from the record, so the distinction is stated in words a
 * screen reader announces: a draft is "unpublished", and the matrix states that no release stands at the
 * edition's head. Neither is carried by colour.
 */
async function expectSavedDraftIsNotARelease(page: Page): Promise<void> {
  const edition = page.getByRole("article", { name: DRAFT_EDITION });
  await expect(edition, "The matrix states one article per edition, named by its audience and language.").toBeVisible();
  // The lifecycle sentence is read from the record, so the distinction is stated in words a screen reader
  // announces rather than carried by colour: a held draft is unpublished, and nothing here is a release.
  await expect(edition.getByText(DRAFT_IS_NOT_A_RELEASE, { exact: true })).toBeVisible();
  // A draft is held and no release stands at the edition's head, and the record states each fact itself.
  await expect(edition.getByText(NO_DRAFT_YET, { exact: true })).toHaveCount(0);
  await expect(edition.getByText(NO_RELEASE_YET, { exact: true })).toBeVisible();
}

// ---------------------------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------------------------

test("the new worker's private contact, undated task and Update draft are each still there after navigation and a full refresh", async ({ page }) => {
  // (a) Home is where the session lands, and the shell states what kind of data this is before anything is read.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: NAV.home })).toBeVisible();
  await expectDevelopmentDataLabel(page);

  // (b) A private contact from a name alone. The roster's own first action opens the form; the receipt is
  // the record of what the attempt did, and the created record is read on its own page afterwards.
  await openSurface(page, NAV.partners, "Partners");
  await createPrivateContact(page);
  // The record this journey created is added beside the seeded one rather than in place of it.
  await expect(page.getByRole("link", { name: SEEDED_CONTACT_NAME, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open the private contact", exact: true }).click();
  await expectPrivateContactCarriesNothingElse(page);

  // (c) One one-off task from a title alone: no due date, so the Work surface files it as undated work.
  await openSurface(page, NAV.work, "Work");
  await createUndatedTask(page);
  await openTaskList(page, "Undated");
  await expectTaskListed(page, "Undated");
  await openTaskList(page, "All");
  await expectTaskListed(page, "All");

  // (d) One Update draft: written in the edition's one editor and saved by the editor's own autosave.
  await openSurface(page, NAV.communication, "Updates");
  await saveFirstDraft(page);
  // The record states the draft as a draft: saved, unpublished, and distinct from a release.
  await openSurface(page, NAV.communication, "Updates");
  await openUpdateRecord(page);
  await expectSavedDraftIsNotARelease(page);

  // (e) Home states the unfinished work this journey left open, each item with its reason and its destination.
  await openSurface(page, NAV.home, NAV.home);
  const unfinishedWork = page.getByRole("region", { name: UNFINISHED_WORK });
  await expect(unfinishedWork.getByText(UNDATED_TASK_REASON, { exact: true })).toBeVisible();
  // The destination is the item's own: the link states the task this journey created and where it opens.
  await expect(unfinishedWork.getByRole("link", { name: `${TASK_TITLE} ${UNDATED_TASK_DESTINATION}`, exact: true })).toBeVisible();
  await expect(unfinishedWork.getByText("Draft saved", { exact: true })).toBeVisible();

  // (f) Away and back, then a hard refresh on each of the three surfaces: what was saved is read again from
  // the service rather than remembered by the page the worker never left.
  await openSurface(page, NAV.partners, "Partners");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Partners" })).toBeVisible();
  await expectDevelopmentDataLabel(page);
  await expect(page.getByRole("link", { name: CONTACT_NAME, exact: true }), "The private contact survives a full refresh of the roster.").toBeVisible();

  await openSurface(page, NAV.work, "Work");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: NAV.work })).toBeVisible();
  await openTaskList(page, "Undated");
  await expectTaskListed(page, "Undated");
  await openTaskList(page, "All");
  await expectTaskListed(page, "All");

  await openSurface(page, NAV.communication, "Updates");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Updates" })).toBeVisible();
  await expectDevelopmentDataLabel(page);
  await openUpdateRecord(page);
  await expectSavedDraftIsNotARelease(page);
  // The text itself survives, read from the draft the service holds: the save, not the tab, kept it.
  await page.getByRole("link", { name: "Open the editor", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "The text of this Update edition", exact: true })).toContainText(DRAFT_TEXT);
});
