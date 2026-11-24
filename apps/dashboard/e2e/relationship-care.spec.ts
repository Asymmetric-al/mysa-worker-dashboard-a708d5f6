/** Criterion 3 — relationship care: find a person and a church, read what their records honestly say, log an interaction, then create a separate task. */ import type { Locator, Page } from "@playwright/test";
import { armLostAcknowledgement, clearFailurePlan, expect, expectDevelopmentData, test } from "../playwright.config";
const HREF = { roster: "/partners", work: "/work" } as const;
const ROSTER = { search: "Search", label: "Partner roster", facet: "Contact type", facetValue: "Person" } as const;
const PERSON = { restricted: "Marcus Webb", care: "Jo Mbeki", church: "St Aidan's Church", churchKind: "Church", phone: "Kenji Nakamura" } as const;
const SECTION = { contactMethods: "Permitted contact methods", restrictions: "Restrictions", activity: "Actual activity", privateNotes: "Private notes", openTasks: "Open tasks" } as const;
const RESTRICTION = { kind: "no-phone", detail: "Asked that we never telephone, and confirmed it in writing.", permittedMethod: "Permitted on this record" } as const;
const CONTACT = { restrictedNumber: "+44 20 7946 0958", restrictedEmail: "marcus.webb@example.org", careEmail: "jo.mbeki@example.org", phoneNumber: "+44 20 7946 0421", noteAudience: "Private note — only you", seededInteraction: "Left a voicemail", noneRecorded: "No interaction recorded for this partner" } as const;
const CARE_PERSON_PRIVATE_NOTE = "Prefers a call after 6pm, and asked for nothing to be posted to the shared house address.";
const RECEIPT = { unconfirmed: "Result not confirmed", alreadySaved: "Already saved", saved: "Saved", checkTheDetails: "Check the details", checkResult: "Check the result", retrySameWork: "Retry the same request", resendWording: /resend|send again|send it again/iu } as const; // The four headings this journey reads off the durable in-context result, the two controls an unconfirmed outcome offers, and the resend wording it never states.
const FORM = { kindOfContact: "Kind of contact", theDay: "The day it happened", whatCameOfIt: "What came of it", howTheyTookPart: "How they took part", noteField: /^A note about this contact/u, submit: "Log the interaction" } as const; // The interaction form's own labels, taken from the one form rather than restated in this file's words.
const VISIT = { kind: "A visit", day: "2026-11-18", outcome: "Talked through the Christmas plan and agreed a visit in December", role: "Worker", note: "Agreed to bring the rota on the next visit." } as const;
const FOLLOW_UP = { taskIntent: "Create a follow-up task", taskTitle: "What needs doing", saveTask: "Save the follow-up task", backToRecord: "Back to the record", createFollowUpTask: "Create a follow-up task", logInteraction: "Log an interaction" } as const;
const TASK = { seeded: "Follow up with Jo after the visit", followUp: "Send Jo the Christmas rota", next: "Book the December visit with Jo", tooLongMessage: "Shorten the title to a phrase, so it reads at a glance in a list." } as const;
const TITLE_TOO_LONG_TASK = "Collect the Christmas rota from the church office, confirm the December visit with the students' group, check the venue booking with the warden and agree who brings the refreshments on the day of the visit. ".repeat(2);
const COMPOSER = { newTask: "New task", title: "Title", linkedRecord: /^Linked record/u, create: "Create task" } as const;
const rosterToolbar = (page: Page): Locator => page.getByRole("region", { name: ROSTER.label, exact: true });
async function openRoster(page: Page): Promise<Locator> {
  await page.goto(HREF.roster);
  await expect(page.getByRole("heading", { name: "Partners", level: 1 }), "The roster is a destination of the shell's own navigation.").toBeVisible();
  await expectDevelopmentData(page, "The partner roster");
  await expect(rosterToolbar(page), "The roster states one filter surface, which is where every search and filter below is applied.").toBeVisible();
  const list = page.locator('[data-slot="record-list"]');
  await expect(list, "The roster renders the one list pattern, which is where every row below is read.").toBeVisible();
  return list;
}
async function searchRoster(page: Page, text: string): Promise<void> {
  const field = page.getByLabel(ROSTER.search, { exact: true });
  await expect(field, "The roster states one search field, and it is the one this journey types in.").toBeVisible();
  await field.fill(text);
  await field.press("Enter");
  await expect.poll(() => [...new URL(page.url()).searchParams.values()].includes(text), { message: `The roster's own address carries the search ${JSON.stringify(text)}, so reading a record and coming back returns to this result rather than to an unfiltered one.` }).toBe(true);
}
async function selectFacetValue(page: Page, facetLabel: string, valueLabel: string): Promise<void> {
  const toolbar = rosterToolbar(page); // Applies one value of one faceted filter, and answers once the filter states itself as applied.
  await toolbar.getByRole("button", { name: facetLabel, exact: true }).click();
  const option = page.getByRole("checkbox", { name: valueLabel, exact: true });
  await expect(option, `The filter ${facetLabel} offers the value ${valueLabel} in this context.`).toBeVisible();
  await option.click();
  await expect(option, `Choosing ${valueLabel} selects it rather than merely closing the filter.`).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(toolbar.getByRole("button", { name: `${facetLabel}, 1 selected` }), "The applied filter states itself on its own trigger, so the list on screen is the list the filter described.").toBeVisible();
}
async function removeFacetValue(page: Page, facetLabel: string, valueLabel: string): Promise<void> {
  const toolbar = rosterToolbar(page);
  await toolbar.getByRole("button", { name: `Remove this filter: ${facetLabel}: ${valueLabel}` }).click();
  await expect(toolbar.getByRole("button", { name: facetLabel, exact: true }), "Removing the filter leaves its control stating no selection, so the list widens again.").toBeVisible();
}
async function clearSearch(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Clear the search text", exact: true }).click(); // Clears the search through the field's own control, so the list returns to the whole authorised result.
  await expect(page.getByLabel(ROSTER.search, { exact: true }), "Clearing the search leaves the field empty.").toHaveValue("");
}
async function recordAddress(page: Page, name: string): Promise<string> {
  const link = page.getByRole("link", { name: `Open ${name}`, exact: true }).first(); // The address of one record, read from the roster's own row link rather than composed here.
  await expect(link, `The roster offers a way into ${JSON.stringify(name)} from the row itself.`).toBeVisible();
  const href = await link.getAttribute("href");
  if (href === null || href === "") throw new Error(`The roster's link to ${JSON.stringify(name)} carries no address, so this file has no record to read.`);
  return href;
}
async function openRecord(page: Page, name: string): Promise<void> {
  const link = page.getByRole("link", { name: `Open ${name}`, exact: true }); // Opens one record through the roster's own link and answers once its identity heading is on screen.
  await link.first().click();
  await expect(page.getByRole("heading", { name, level: 1 }), `The record ${JSON.stringify(name)} opens at its own address with its own identity as the page heading.`).toBeVisible();
  await expectDevelopmentData(page, "The partner record");
}
const section = (page: Page, title: string): Locator => page.getByRole("region", { name: title, exact: true });
async function activityRows(page: Page): Promise<readonly string[]> {
  const activity = section(page, SECTION.activity);
  await expect(activity, "A partner record states its actual activity in a section of its own.").toBeVisible();
  const rows = await activity.getByRole("listitem").allInnerTexts();
  return rows.map((text) => text.replace(/\s+/gu, " ").trim());
}
async function wholeResultCount(page: Page): Promise<number> {
  const pager = page.locator('[data-slot="pagination-bar"] output').first(); // How many rows the whole result holds, as the pager of the list on screen states it.
  await expect(pager, "A list states the size of its whole result beside its own rows, so a filtered count is never the size of one page.").toBeVisible();
  const stated = (await pager.innerText()).replace(/\s+/gu, " ").trim();
  const total = /^Showing\s+([\d,]+)\u2013([\d,]+)\s+of\s+([\d,]+)\s+(\S+)$/u.exec(stated)?.[3];
  if (total === undefined) throw new Error(`The pager states its whole result as "Showing 1–N of M <noun>", and it read ${JSON.stringify(stated)} instead. A roster size this file cannot read would leave the filter's effect unproven.`);
  const value = Number(total.replace(/,/gu, ""));
  if (!Number.isSafeInteger(value)) throw new Error(`The pager's whole-result count is not a whole number: ${JSON.stringify(stated)}.`);
  return value;
}
function partnerIdOf(href: string): string {
  const [path] = href.split("?"); // The opaque record identifier one address names, taken from the roster's own link rather than composed here.
  const segments = (path ?? "").split("/").filter((segment) => segment !== "");
  const last = segments[segments.length - 1];
  if (last === undefined || last === "") throw new Error(`The roster link ${JSON.stringify(href)} names no record, so no task can be linked to it.`);
  return decodeURIComponent(last);
}
const receipt = (page: Page, outcome: string): Locator => page.locator(`[data-slot="operation-result"][data-outcome="${outcome}"]`); // One durable outcome receipt, addressed by the outcome it reports rather than by its position on the page.
async function openInteractionForm(page: Page, name: string): Promise<void> {
  await page.getByRole("link", { name: FOLLOW_UP.logInteraction, exact: true }).first().click(); // Opens the interaction form from the record's own action and answers once the form states the record it writes to.
  await expect(page.getByRole("heading", { level: 1, name: `Log an interaction with ${name}` }), "The form is opened from the record it is recorded against, and it names that record in its own heading.").toBeVisible();
  await expectDevelopmentData(page, "The interaction form");
}
async function fillLoggedInteraction(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: FORM.kindOfContact, exact: true }).selectOption({ label: VISIT.kind });
  await page.getByRole("textbox", { name: FORM.theDay, exact: true }).fill(VISIT.day);
  await page.getByRole("textbox", { name: FORM.whatCameOfIt, exact: true }).fill(VISIT.outcome);
  await page.getByRole("textbox", { name: FORM.howTheyTookPart, exact: true }).fill(VISIT.role);
  await page.getByRole("textbox", { name: FORM.noteField }).fill(VISIT.note);
}
test.use({ persona: "established-worker" }); // This file acts as the established worker throughout, which is the persona the runner admits the context as, and the runner's automatic fixture restores the deterministic seed before each test.
test("a person and a church are found by searching the whole roster and filtering it, and each record states its own restrictions, activity and private text", async ({ page }) => {
  const roster = await openRoster(page);
  const wholeRoster = await wholeResultCount(page);
  await selectFacetValue(page, ROSTER.facet, ROSTER.facetValue);
  await expect.poll(async () => wholeResultCount(page), { message: "The faceted filter is applied to the whole result rather than to the page on screen, so the size it states falls." }).toBeLessThan(wholeRoster);
  await expect(roster.getByRole("row", { name: PERSON.church }), "A church is not a person, so the filter that admits persons only leaves it out.").toHaveCount(0);
  await expect(roster.getByRole("row", { name: PERSON.restricted }), "The person this journey reads is still in the result the filter admitted.").toBeVisible();
  await searchRoster(page, PERSON.restricted);
  await expect(roster.getByRole("row", { name: PERSON.restricted }), "The search and the filter are combined: the person matches both, so the row stands.").toBeVisible();
  await expect(roster.getByRole("row", { name: "Hana Nakamura" }), "A person the filter admits but the search excludes is not in the result, so every selected filter must match.").toHaveCount(0);
  await expect.poll(async () => wholeResultCount(page), { message: "Searching one name over the filtered result leaves exactly one record in the whole result." }).toBe(1);
  const restrictedAddress = await recordAddress(page, PERSON.restricted);
  await openRecord(page, PERSON.restricted);
  const restrictions = section(page, SECTION.restrictions);
  await expect(restrictions.getByText(RESTRICTION.kind), "The restriction is stated in its own words, so what must not happen is a recorded fact rather than a missing control.").toBeVisible();
  await expect(restrictions.getByText(RESTRICTION.detail), "The restriction carries the detail the record holds, which is what a worker acts on.").toBeVisible();
  const contactMethods = section(page, SECTION.contactMethods);
  await expect(contactMethods.getByText(CONTACT.restrictedEmail, { exact: true }), "The method this record permits is offered.").toBeVisible();
  await expect(contactMethods.getByText(RESTRICTION.permittedMethod), "The offered method states that this session may use it.").toBeVisible();
  await expect(contactMethods.getByText(CONTACT.restrictedNumber), "The refused number is not on the record at all: the refusal is a restriction recorded beside it, not a disabled control or a blank field.").toHaveCount(0);
  await expect(section(page, SECTION.activity).getByText(CONTACT.noneRecorded, { exact: true }), "A record nothing has happened on says so, rather than reading as an outage or as a zero.").toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Partners", level: 1 }), "The roster is where the visit began, and returning re-reads it.").toBeVisible();
  await expect(page.getByLabel(ROSTER.search, { exact: true }), "The search the worker typed survives the visit, because the list's query lives in its own address.").toHaveValue(PERSON.restricted);
  await expect(page.getByRole("button", { name: `${ROSTER.facet}, 1 selected` }), "The applied filter survives the visit for the same reason.").toBeVisible();
  await removeFacetValue(page, ROSTER.facet, ROSTER.facetValue);
  await clearSearch(page);
  await expect.poll(async () => wholeResultCount(page), { message: "With the filter and the search both removed, the list states the whole roster again." }).toBe(wholeRoster);
  await searchRoster(page, PERSON.care);
  const careAddress = await recordAddress(page, PERSON.care);
  await openRecord(page, PERSON.care);
  const seededActivity = await activityRows(page);
  expect(seededActivity.length, "The seeded record already holds one interaction, so 'exactly one' below is a comparison against real history.").toBe(1);
  expect(seededActivity[0], "The activity history states what the source recorded, in the record's own words.").toContain(CONTACT.seededInteraction);
  const privateNotes = section(page, SECTION.privateNotes);
  await expect(privateNotes.getByText(CARE_PERSON_PRIVATE_NOTE, { exact: true }), "The worker's own note is read on the record it belongs to.").toBeVisible();
  await expect(privateNotes.getByText(CONTACT.noteAudience), "The note states its audience where it is read, so private text is never mistaken for shared activity.").toBeVisible();
  await page.goBack();
  await expect(page.getByLabel(ROSTER.search, { exact: true })).toHaveValue(PERSON.care);
  await searchRoster(page, PERSON.church);
  await openRecord(page, PERSON.church);
  await expect(page.getByText(PERSON.churchKind, { exact: true }).first(), "The church states its own record kind, which is a record kind no person shares.").toBeVisible();
  await expect(page.getByText(CARE_PERSON_PRIVATE_NOTE, { exact: false }), "The person's private note appears nowhere on the church's record: a shared name, address or email address is not a join between two records.").toHaveCount(0);
  await expect(page.getByText(CONTACT.seededInteraction, { exact: false }), "What was recorded against the person is not recorded against the church, because activity belongs to the record it was written on.").toHaveCount(0);
  await expect(section(page, SECTION.activity).getByText(CONTACT.noneRecorded, { exact: true }), "The church's own record states that nothing has been recorded on it yet.").toBeVisible();
  await page.goBack();
  await expect(page.getByLabel(ROSTER.search, { exact: true }), "Returning from the church restores the search that found it.").toHaveValue(PERSON.church);
  expect(restrictedAddress, "The two records this journey read are addressed separately, so neither address stands in for the other.").not.toBe(careAddress);
  expect(careAddress, "The record's address carries an opaque identifier rather than the person's email address.").not.toContain(CONTACT.careEmail);
  expect(restrictedAddress, "The restricted person's address carries an opaque identifier rather than the church's name.").not.toContain("Aidan");
});
test("an interaction whose acknowledgement is lost is recovered once, and a follow-up task the application refuses never sends it again", async ({ page }) => {
  await openRoster(page);
  await searchRoster(page, PERSON.care);
  await openRecord(page, PERSON.care);
  const before = await activityRows(page);
  expect(before.length, "The seeded record holds one interaction, which is the figure every count below is compared against.").toBe(1);
  await armLostAcknowledgement(page.request, "logInteraction");
  await openInteractionForm(page, PERSON.care);
  await fillLoggedInteraction(page);
  await page.getByRole("button", { name: FORM.submit, exact: true }).click();
  const unconfirmed = receipt(page, "unknown");
  await expect(unconfirmed.getByRole("heading", { name: RECEIPT.unconfirmed }), "A lost acknowledgement is reported as neither success nor failure, which is the only honest answer for a fate nobody knows.").toBeVisible();
  const unconfirmedActions = unconfirmed.getByRole("button"); // The receipt offers exactly the two controls an unconfirmed outcome may offer, in that order: checking the result, and replaying this same request. A third control that sent the work again would record it twice.
  await expect(unconfirmedActions, "An unconfirmed outcome offers two controls and no more.").toHaveCount(2);
  await expect(unconfirmedActions.nth(0)).toHaveText(RECEIPT.checkResult);
  await expect(unconfirmedActions.nth(1)).toHaveText(RECEIPT.retrySameWork);
  await expect(page.getByRole("button", { name: RECEIPT.resendWording }), "Uncertainty never becomes a resend: nothing on this page sends the same work under a fresh identity.").toHaveCount(0);
  await expect(page.getByRole("button", { name: FORM.submit, exact: true }), "While the result stands unconfirmed there is no control that submits the entry again.").toHaveCount(0);
  await unconfirmedActions.nth(0).click();
  await expect(receipt(page, "alreadyAccepted").getByRole("heading", { name: RECEIPT.alreadySaved }), "Checking the result replays the same operation identity, so the service answers with the result it stored instead of recording the contact a second time.").toBeVisible();
  await page.getByRole("radio", { name: FOLLOW_UP.taskIntent }).click();
  const taskTitle = page.getByRole("textbox", { name: FOLLOW_UP.taskTitle, exact: true });
  await taskTitle.fill(TITLE_TOO_LONG_TASK);
  await page.getByRole("button", { name: FOLLOW_UP.saveTask, exact: true }).click();
  await expect(page.getByRole("heading", { name: RECEIPT.checkTheDetails }), "The refused task reports its own outcome, separate from the interaction's.").toBeVisible(); // The development runtime arms a failure on the calls it names, and creating a task is not one of them, so the task that fails here is refused by the application itself for a title it really will not accept: real input rather than a fabricated state. It proves the same property — the refusal
  await expect(page.getByText(TASK.tooLongMessage).first(), "The refusal names the field to correct, in the transport's own words.").toBeVisible();
  await expect(taskTitle, "The caller's input is kept exactly as it was typed, so the work is recoverable rather than retyped.").toHaveValue(TITLE_TOO_LONG_TASK);
  await expect(receipt(page, "alreadyAccepted").getByRole("heading", { name: RECEIPT.alreadySaved }), "The interaction's own receipt is untouched: a failed task never re-sends the change it followed.").toBeVisible();
  await taskTitle.fill(TASK.followUp);
  await page.getByRole("button", { name: FOLLOW_UP.saveTask, exact: true }).click();
  await expect(receipt(page, "accepted").getByRole("heading", { name: RECEIPT.saved }), "The same work, corrected, is accepted as one task.").toBeVisible();
  await clearFailurePlan(page.request);
  await page.getByRole("link", { name: FOLLOW_UP.backToRecord }).click();
  await expect(page.getByRole("heading", { name: PERSON.care, level: 1 })).toBeVisible();
  const after = await activityRows(page);
  expect(after.length, "The interaction was recorded once: the withheld answer, the recovery and the refused task attempt left exactly one new activity row.").toBe(before.length + 1);
  expect(after.filter((row) => row.includes(VISIT.outcome)).length, "Exactly one row carries the outcome this journey recorded, so no replay recorded the contact twice.").toBe(1);
  expect(after.filter((row) => row.includes(CONTACT.seededInteraction)).length, "The seeded interaction is still there once, unchanged by anything above.").toBe(1);
  const loggedRow = after.find((row) => row.includes(VISIT.outcome)) ?? "";
  expect(loggedRow, "The row states the day it happened, the outcome, the participant's role and the note it was given.").toContain(VISIT.day);
  expect(loggedRow).toContain(VISIT.role);
  expect(loggedRow, "The note the interaction carries is labelled with its audience on the row itself, so its text is never read as a shared activity line.").toContain("Private");
  await expect(section(page, SECTION.openTasks).getByText(TASK.followUp, { exact: true }), "The follow-up task, once accepted, is open work on the record the interaction was logged against.").toBeVisible();
});
test("completing a task and creating the next one close work and change nothing about what was recorded", async ({ page }) => {
  await openRoster(page);
  await searchRoster(page, PERSON.care);
  const careAddress = await recordAddress(page, PERSON.care);
  await openRecord(page, PERSON.care);
  const contactMethods = section(page, SECTION.contactMethods);
  await expect(contactMethods.getByText(CONTACT.careEmail, { exact: true }), "The record states the address this session may use.").toBeVisible();
  await expect(contactMethods.getByText(RESTRICTION.permittedMethod)).toBeVisible();
  const emailHandoff = contactMethods.getByRole("link", { name: /^Email\b/u });
  await expect(emailHandoff, "The permitted address is offered as a handoff whose visible word names the app it opens, and whose hidden half names the address so the row's control is never a bare word.").toHaveAttribute("href", `mailto:${CONTACT.careEmail}`);
  await expect(emailHandoff, "The handoff keeps the record's own address as the only thing it would open.").toContainText(CONTACT.careEmail);
  const before = await activityRows(page);
  await emailHandoff.click(); // Following the handoff hands the address to another program: this application is never asked to record anything, which is why the activity history is the evidence that a handoff is not an interaction.
  expect(await activityRows(page), "Following the mail handoff records nothing about contact: the activity history holds exactly the rows it held before the link was followed.").toEqual([...before]);
  await page.goto(HREF.roster);
  await searchRoster(page, PERSON.phone);
  await openRecord(page, PERSON.phone);
  await expect(section(page, SECTION.contactMethods).getByRole("link", { name: /^Call\b/u }), "A permitted number is offered as a dialler handoff carrying the number the record stores.").toHaveAttribute("href", `tel:${CONTACT.phoneNumber}`);
  await page.goto(careAddress);
  await expect(page.getByRole("heading", { name: PERSON.care, level: 1 }), "The record this journey acts on is reopened, so the reading above did not move the worker off it.").toBeVisible();
  const openTasksBefore = await section(page, SECTION.openTasks).getByRole("listitem").allInnerTexts();
  const seededTaskOpen = openTasksBefore.some((item) => item.includes(TASK.seeded));
  expect(seededTaskOpen, "The seeded task is open work on this record before the journey completes it.").toBe(true);
  await page.goto(HREF.work);
  await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The five task lists are a destination of the shell's own navigation.").toBeVisible();
  await expectDevelopmentData(page, "The Work surface");
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.getByRole("row", { name: TASK.seeded }), "The seeded task is one row of the widest list.").toBeVisible();
  await page.getByRole("button", { name: `Actions for ${TASK.seeded}` }).click();
  await page.getByRole("menuitem", { name: `Complete for ${TASK.seeded}` }).click();
  await expect(page.locator('[data-slot="task-action-result"][data-outcome="accepted"]').getByRole("heading", { name: RECEIPT.saved }), "Completing a task is one accepted change, recorded in the durable result rather than announced in a toast.").toBeVisible();
  await page.goto(careAddress);
  await expect(page.getByRole("heading", { name: PERSON.care, level: 1 })).toBeVisible();
  expect(await activityRows(page), "Completing a task records that the work was closed: the activity history holds exactly the rows it held before, in the same order.").toEqual([...before]);
  await expect(section(page, SECTION.openTasks).getByText(TASK.seeded, { exact: true }), "The completed task is no longer open work on the record it was linked to.").toHaveCount(0);
  await page.getByRole("link", { name: FOLLOW_UP.createFollowUpTask, exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The record's own next-task action opens the work surface rather than a second task form.").toBeVisible();
  await page.getByRole("button", { name: COMPOSER.newTask, exact: true }).click();
  await expect(page.getByRole("region", { name: COMPOSER.newTask, exact: true }), "The task is created in the one composer that owns the task form.").toBeVisible();
  await expect(page.getByRole("combobox", { name: COMPOSER.linkedRecord }), "The record this task was created from is already stated as its link, so the work is filed against the same record.").toHaveValue(`partner:${partnerIdOf(careAddress)}`);
  await page.getByRole("textbox", { name: COMPOSER.title, exact: true }).fill(TASK.next);
  await page.getByRole("button", { name: COMPOSER.create, exact: true }).click();
  await expect(receipt(page, "accepted").getByRole("heading", { name: RECEIPT.saved }), "A task needs only a title, and creating it is one accepted change with its own receipt.").toBeVisible();
  await page.goto(HREF.work);
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.getByRole("row", { name: TASK.next }), "The task created from the record is the same task in the Work list: one task model feeds both.").toBeVisible();
  await page.goto(careAddress);
  await expect(page.getByRole("heading", { name: PERSON.care, level: 1 })).toBeVisible();
  await expect(section(page, SECTION.openTasks).getByText(TASK.next, { exact: true }), "The next task is open work on the record it was created from.").toBeVisible();
  expect(await activityRows(page), "Creating the next piece of work records no interaction, so the activity history is still exactly what it was.").toEqual([...before]);
});
