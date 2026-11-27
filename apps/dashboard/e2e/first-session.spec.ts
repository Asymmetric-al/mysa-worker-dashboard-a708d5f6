/** Criterion 2 — **First useful session** (AAP 0.12.1) and the opening of journey 1: as the new worker, a private contact, a task and a draft each survive a reload. */ import type { Page } from "@playwright/test";
import { actAs, expect, expectAcceptedReceipt, expectDevelopmentData, openSurface, SEEDED_PERSONAS, test } from "../playwright.config";
const CONTACT_NAME = "Rosa Delgado"; // The private contact this journey creates. A name is the only field it fills, which is what the criterion asks.
const TASK_TITLE = "Send Rosa a first note";
const DRAFT_TEXT = "Thank you for the welcome on Sunday. This is the first note from the youth ministry.";
const UPDATE_DOCUMENT_ID = "doc-update-first-note"; // The seeded Update this journey writes its first draft into. The seed creates it; the spec never pastes an address to reach it.
const ADD_PRIVATE_CONTACT = "Add private contact";
const DRAFT_EDITION = /Public English/u; // The one edition this journey writes: the seeded Update's public English edition, named by the article the matrix gives it.
const NAV = { home: "Home", partners: "Partners", work: "Tasks", communication: "Updates" } as const; // The shell's own navigation, named by the labels it states rather than by an address this spec types.
// The new worker's own session is the identity every request in this spec is authorised as. The cookie is the whole identity — the service resolves it into a principal and its admitted memberships — so the runner's own `actAs` puts it on the context and nothing here invents a scope or commits a session file.
test.beforeEach(async ({ page }) => {
  await actAs(page, SEEDED_PERSONAS["new-worker"].sessionId);
});
async function createPrivateContact(page: Page): Promise<void> {
  const form = page.getByRole("region", { name: ADD_PRIVATE_CONTACT }); // Creates one private preparation record from a name alone, through the form the roster's first action offers.
  await expect(form, "The roster offers the private-contact form as a real action rather than a typed address.").toBeVisible();
  await form.getByRole("textbox", { name: "Name", exact: true }).fill(CONTACT_NAME);
  await form.getByRole("button", { name: ADD_PRIVATE_CONTACT }).click();
  await expectAcceptedReceipt(form, "private-contact form");
}
async function expectPrivateContactCarriesNothingElse(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: CONTACT_NAME })).toBeVisible(); // Asserts the created private contact is its own record class and carries nothing this journey did not write.
  await expect(page.getByText("No permitted contact details on file.", { exact: true })).toBeVisible();
  await expect(page.getByText("No email consent recorded for this ministry."), "Consent is stated as a fact of its own and never claimed from a name: the record says contactability is a separate fact, and nothing on the page records consent for this ministry and purpose").toHaveCount(0);
  await expect(page.getByText(/Contact details are separate from email update consent/u)).toBeVisible();
  await expect(page.getByText("Email", { exact: true }), "The two labelled kinds this journey never supplied: a contact method of either kind would state one").toHaveCount(0);
  await expect(page.getByText("Phone", { exact: true })).toHaveCount(0);
  await expectDevelopmentData(page, "The private contact's own page");
}
async function createUndatedTask(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New task", exact: true }).click(); // Creates one one-off task from a title alone, through the composer the Work surface opens.
  const composer = page.getByRole("region", { name: "New task" });
  await expect(composer, "The composer states its own heading, so the form is a region a reader can name.").toBeVisible();
  await composer.getByRole("textbox", { name: "Title", exact: true }).fill(TASK_TITLE);
  await composer.getByRole("button", { name: "Create task", exact: true }).click();
  await expectAcceptedReceipt(composer, "task composer");
}
const TASK_LISTS = ["Undated", "All"] as const;
async function expectTaskInList(page: Page, listName: string): Promise<void> {
  await page.getByRole("tab", { name: listName, exact: true }).click(); // Selects one task list by operating the surface's own switcher, and asserts the created task is listed in it.
  await expect(page.getByRole("cell", { name: TASK_TITLE, exact: true }), `The ${listName} list states the task this journey created.`).toBeVisible();
}
async function saveFirstDraft(page: Page): Promise<void> {
  await page.getByRole("link", { name: new RegExp(UPDATE_DOCUMENT_ID, "u") }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Update" })).toBeVisible();
  await page.getByRole("link", { name: "Edit draft", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Update edition" })).toBeVisible();
  const prose = page.getByRole("textbox", { name: "The text of this Update edition", exact: true });
  await expect(prose).toBeVisible();
  await prose.click();
  await page.keyboard.type(DRAFT_TEXT);
  const autosave = page.locator('[data-slot="autosave-status"]');
  await expect(autosave, "The save is the editor's own autosave, and it states the revision the service acknowledged only once the service has answered: waiting on that word is what makes the text recorded rather than typed").toHaveAttribute("data-autosave-state", "saved");
  await expect(autosave.getByText(/Draft saved \(revision /u)).toBeVisible();
}
async function openUpdateRecord(page: Page): Promise<void> {
  await page.getByRole("link", { name: new RegExp(UPDATE_DOCUMENT_ID, "u") }).click(); // Opens the seeded Update's own record from the Updates list, by way of the link the list states.
  await expect(page.getByRole("heading", { level: 1, name: "Update" })).toBeVisible();
}
async function expectSavedDraftIsNotARelease(page: Page): Promise<void> {
  const edition = page.getByRole("article", { name: DRAFT_EDITION }); // Asserts the edition this journey wrote states itself as a saved draft rather than as a release.
  await expect(edition, "The matrix states one article per edition, named by its audience and language.").toBeVisible();
  await expect(edition.getByText("Saved privately — not visible to readers until published.", { exact: true })).toBeVisible(); // The lifecycle sentence is read from the record, so the distinction is stated in words a screen reader announces rather than carried by colour: a held draft is unpublished, and nothing here is a release.
  await expect(edition.getByText("Save a draft first to submit for review.", { exact: true })).toHaveCount(0);
  await expect(edition.getByText("Not published yet.", { exact: true })).toBeVisible();
}
test("the new worker's private contact, undated task and Update draft are each still there after navigation and a full refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: NAV.home })).toBeVisible();
  await expectDevelopmentData(page, "Home");
  await openSurface(page, NAV.partners, "Partners");
  await createPrivateContact(page);
  await expect(page.getByRole("link", { name: "Ada Quinn (met on Sunday)", exact: true }), "The record this journey created is added beside the seeded one rather than in place of it").toBeVisible();
  await page.getByRole("link", { name: "Open contact", exact: true }).click();
  await expectPrivateContactCarriesNothingElse(page);
  await openSurface(page, NAV.work, "Tasks");
  await createUndatedTask(page);
  for (const list of TASK_LISTS) await expectTaskInList(page, list);
  await openSurface(page, NAV.communication, "Updates");
  await saveFirstDraft(page);
  await openSurface(page, NAV.communication, "Updates");
  await openUpdateRecord(page);
  await expectSavedDraftIsNotARelease(page);
  await openSurface(page, NAV.home, NAV.home);
  const unfinishedWork = page.getByRole("region", { name: /^In progress/u });
  await expect(unfinishedWork.getByText("This task doesn’t have a due date yet.", { exact: true })).toBeVisible();
  await expect(unfinishedWork.getByRole("link", { name: `${TASK_TITLE} Open Tasks`, exact: true })).toBeVisible();
  await expect(unfinishedWork.getByText("Draft saved", { exact: true })).toBeVisible();
  await openSurface(page, NAV.partners, "Partners");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Partners" })).toBeVisible();
  await expectDevelopmentData(page, "The partners roster, after a full refresh");
  await expect(page.getByRole("link", { name: CONTACT_NAME, exact: true }), "The private contact survives a full refresh of the roster.").toBeVisible();
  await openSurface(page, NAV.work, "Tasks");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: NAV.work })).toBeVisible();
  for (const list of TASK_LISTS) await expectTaskInList(page, list);
  await openSurface(page, NAV.communication, "Updates");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Updates" })).toBeVisible();
  await expectDevelopmentData(page, "The Updates list, after a full refresh");
  await openUpdateRecord(page);
  await expectSavedDraftIsNotARelease(page);
  await page.getByRole("link", { name: "Edit draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "The text of this Update edition", exact: true })).toContainText(DRAFT_TEXT);
});
