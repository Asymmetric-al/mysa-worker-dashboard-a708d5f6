/** Criterion 14 — outreach and Requests. */
import type { Page } from "@playwright/test";
import { expect, test } from "../playwright.config"; // The runner's own entry points: `test` carries the seeded-persona fixture and `expect` the web-first matchers, and `resetSeed` restores the deterministic world through the application's own control.
const INITIATIVES_PATH = "/partners/initiatives";
const initiativePath = (initiativeId: string): string => `${INITIATIVES_PATH}/${encodeURIComponent(initiativeId)}`;
const SEEDED_INITIATIVE = { initiativeId: "initiative-autumn-appeal", name: "Autumn appeal" } as const; // The seeded initiative: the one whose working list carries all three states and whose Request has moved on a version.
const NEW_INITIATIVE = { name: "Spring partner conversations", purpose: "Invite the partners we already know to a spring conversation." } as const;
const SEEDED_REQUEST = { presentedVersion: "terms-v1", currentVersion: "terms-v2", amount: "50.00 USD", currency: "USD", cadence: "Monthly", term: "12 months", respondent: "partner-grace-adeyemi", recordedAt: "2026-11-06T16:20:00Z" } as const; // The seeded Request: presented at version 1, carrying version 2 now, answered against the version that was presented.
const MEMBERSHIP_LABEL = { included: "On the working list", removed: "Removed", excluded: "Not eligible" } as const;
const ADMITTED_STAGES = ["Not yet asked", "Asked", "Answered", "Follow up due", "Paused"] as const;
const RESPONSE_KINDS = ["Agreed", "Agreed with conditions", "Agreed in part", "Deferred", "Declined", "Unanswered", "Needs clarification"] as const;
const PRESENTED_ON = "2026-11-20";
const COPY = {
  notAsked: "Adding a partner to the working list is not the same as having asked them.",
  notConsent: "Inclusion gives no consent for contact or Updates, and none is recorded here.",
  notAudience: "A working-list partner is not an Update audience member, and this list enables no notice.",
  explicitSelection: "Only partners you select join the working list; a later filter match never adds anyone.",
  countsOnTheirOwn: "Each state is counted on its own: nothing here is summed, and no state stands in for another.",
  removalKeepsHistory: "Removing a partner keeps its history and any obligation recorded elsewhere.",
  returnGrantsNothing: "Returning a partner restores eligible planning only and grants no permission.",
  notReceivedSupport: "These are the terms the worker asked for, not received support.",
  agreementCreatesNothing: "Agreement creates no pledge, gift, commitment, subscription, notification or task.",
  bindsToVersion: "A response binds to the terms version it answers, and earlier versions are kept.",
  sameStage: "No change: the stage already holds this value.",
  noTaskFromStage: "Changing a stage creates no task and pauses or resumes nothing.",
  exclusionIsSourceFact: "A partner the source marks not eligible is never re-included from this surface: the reason in their history comes from the source, and no control here overrides it.",
  dispositionRequired: "Say how this initiative closes: choose a disposition, or name who takes over the unfinished work.",
  handoffRequired: "Say how the work this initiative still owns is dealt with: covered by the disposition, or handed to someone eligible.",
  lateAnswerNote: "A late response that actually arrives stays recordable without reopening.",
  reopenKeepsHistory: "Reopening keeps the closure history and the exclusions that are current.",
} as const;
type Counts = { readonly gifts: number; readonly commitments: number; readonly tasks: number; readonly messages: number }; // The four whole-result counts that a recorded answer, a presentation and a stage change must all leave exactly as they found them.
const countsOf = async (page: Page): Promise<Counts> => ({ gifts: await pagerTotal(page, "/support/gifts", "gifts"), commitments: await pagerTotal(page, "/support/commitments", "commitments"), tasks: await pagerTotal(page, "/work", "tasks"), messages: await inboxMessageCount(page) }); // The four whole-result counts a recorded answer must leave exactly as it found them.
async function inboxMessageCount(page: Page): Promise<number> {
  await page.goto("/communication/inbox"); // The synthetic inbox's own whole-result count: `N messages have been produced for this membership.`
  const statement = page.getByText(/^\d+ messages? have been produced for this membership\.$/u).first();
  await expect(statement).toBeVisible();
  return Number(/^(\d+)/u.exec((await statement.textContent()) ?? "")?.[1] ?? "0");
}
async function pagerTotal(page: Page, path: string, noun: string): Promise<number> {
  await page.goto(path); // The whole-result total one list states: `Showing 1–50 of 312 gifts`, or `No gifts` for an empty result.
  const pager = page.getByText(new RegExp(`^(?:Showing [\\d,]+[–-][\\d,]+ of [\\d,]+ ${noun}|No ${noun})$`, "u")).first();
  await expect(pager).toBeVisible();
  const text = (await pager.textContent()) ?? "";
  const total = /of ([\d,]+)/u.exec(text);
  if (total === null) {
    expect(text.trim(), "`No <noun>` is a stated zero, and it is the only text besides `Showing … of …` this pattern matches").toBe(`No ${noun}`);
    return 0;
  }
  return Number((total[1] ?? "").replaceAll(",", ""));
}
function initiativeIdOf(page: Page): string {
  const match = /\/partners\/initiatives\/(?<initiativeId>[^/?#]+)/u.exec(new URL(page.url()).pathname); // The identifier a detail route states in its own address, so the page's answer is the record this file acts on.
  if (match?.groups?.initiativeId === undefined) throw new Error(`The address ${page.url()} names no initiative, so no record can be acted on.`);
  return decodeURIComponent(match.groups.initiativeId);
}
async function openInitiative(page: Page, initiativeId: string): Promise<string> {
  await page.goto(initiativePath(initiativeId));
  await expect(page.locator('[data-slot="initiative-detail"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: SEEDED_INITIATIVE.name }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Working list" })).toBeVisible();
  return initiativeIdOf(page);
}
const recordBody = (page: Page) => page.locator('[data-slot="initiative-detail"]'); // The record body itself, which states the initiative's current state as an attribute the read answered
const panel = (page: Page, section: string) => page.getByRole("tabpanel", { name: section }); // The active section of the initiative, so a locator never reaches into a panel the reader is not looking
async function openSection(page: Page, section: string): Promise<void> {
  await page.getByRole("tab", { name: section }).click();
  await expect(page.getByRole("tab", { name: section })).toHaveAttribute("aria-selected", "true");
}
async function createInitiative(page: Page, name: string, purpose: string): Promise<string> {
  await page.goto(INITIATIVES_PATH); // Creates one initiative through the list's own composer and returns the identity the application opened.
  await page.getByRole("button", { name: "Create an initiative" }).click();
  const dialog = page.getByRole("dialog", { name: "Create an initiative" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await dialog.getByRole("textbox", { name: "Purpose", exact: true }).fill(purpose);
  await dialog.getByRole("button", { name: "Review and create" }).click();
  await expect(dialog.getByRole("region", { name: "Review this new initiative" })).toBeVisible();
  await dialog.getByRole("button", { name: "Create initiative" }).click();
  await expect(dialog.getByRole("button", { name: "Open the initiative" }), "The composer's own receipt: the created record, and the one way onward from it. Its confirmation of the attempt is what makes the identity the page opens the identity this file then acts on").toBeVisible();
  await dialog.getByRole("button", { name: "Open the initiative" }).click();
  await expect(page.getByRole("heading", { name }).first()).toBeVisible();
  return initiativeIdOf(page);
}
const ADD_PARTNERS_LABEL = "Add partners to the working list";
async function addPartners(page: Page, names: readonly string[]): Promise<void> {
  await page.getByRole("button", { name: ADD_PARTNERS_LABEL }).click(); // Adds the named partners through the picker: the eligible set is opened, each partner is selected by
  const options = page.getByRole("listbox", { name: "Eligible partners" });
  await expect(options).toBeVisible();
  for (const name of names) await options.getByRole("option", { name }).click();
  await expect(page.getByText("Selected for this addition"), "The selection is stated before it is reviewed, and dismissing the popover leaves the review step as the only surface the pointer can reach — the layer's own dismissal is what closes it, as a keyboard user does").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await page.getByRole("button", { name: "Add to the working list" }).click();
  await expect(page.getByText("What each partner's result was")).toBeVisible();
}
const memberRow = (page: Page, partnerName: string) => page.getByRole("row").filter({ hasText: partnerName }).first(); // One member row of the working list, addressed by the partner's own name rather than by a row position.
async function historyEntries(page: Page): Promise<readonly string[]> {
  await openSection(page, "History");
  const items = panel(page, "History").getByRole("listitem");
  await expect(items.first()).toBeVisible();
  return await items.allTextContents();
}
test("creates an initiative and builds its reviewed working list by explicit selection", async ({ page }) => {
  await page.goto(INITIATIVES_PATH);
  await expect(page.getByText("Development data", { exact: true }), "The one statement that this whole application shows synthetic development data, on the surface the journey starts from: nothing below can be mistaken for a production record").toBeVisible();
  const initiativeId = await createInitiative(page, NEW_INITIATIVE.name, NEW_INITIATIVE.purpose);
  await openSection(page, "Working list");
  const workingList = panel(page, "Working list");
  await expect(workingList.getByRole("heading", { name: "No partners on the working list yet" })).toBeVisible();
  for (const state of [MEMBERSHIP_LABEL.included, MEMBERSHIP_LABEL.removed, MEMBERSHIP_LABEL.excluded]) await expect(workingList.getByText(state, { exact: true }).first()).toBeHidden();
  await expect(workingList.getByText(COPY.explicitSelection).first(), "What a working-list place is not, stated where the list is read rather than only in Help").toBeVisible();
  await expect(workingList.getByText(COPY.notAsked).first()).toBeVisible();
  await expect(workingList.getByText(COPY.notConsent).first()).toBeVisible();
  await expect(workingList.getByText(COPY.notAudience).first()).toBeVisible();
  await addPartners(page, ["Jo Mbeki", "Ruth Okafor"]);
  await expect(page.getByText("Accepted", { exact: true }).filter({ visible: true }).first(), "One row per partner in the durable result, read from the composition the wide surface shows: the same result is also rendered as a narrow card list, which `display: none` keeps out of a reader's way").toBeVisible();
  await expect(workingList.getByText("Showing 1–2 of 2 working-list members")).toBeVisible();
  await expect(memberRow(page, "Jo Mbeki").getByText(MEMBERSHIP_LABEL.included, { exact: true }).first()).toBeVisible();
  await expect(memberRow(page, "Ruth Okafor").getByText(MEMBERSHIP_LABEL.included, { exact: true }).first()).toBeVisible();
  const removalReason = "Asked for no contact until the new year.";
  await page.getByRole("button", { name: "Remove Ruth Okafor from the working list" }).click();
  const removal = page.getByRole("dialog", { name: "Remove from the working list: Ruth Okafor" });
  await expect(removal).toBeVisible();
  await removal.getByRole("textbox", { name: "Reason" }).fill(removalReason);
  await removal.getByRole("button", { name: "Remove this partner" }).click();
  await expect(removal.getByRole("heading", { name: "Saved" })).toBeVisible();
  await expect(removal.getByText("Result for this member")).toBeVisible();
  await removal.getByRole("button", { name: "Done" }).click();
  await expect(removal).toBeHidden();
  await expect(memberRow(page, "Ruth Okafor").getByText(MEMBERSHIP_LABEL.removed, { exact: true }).first()).toBeVisible();
  await expect(memberRow(page, "Ruth Okafor").getByText(removalReason)).toBeVisible();
  await expect(memberRow(page, "Ruth Okafor").getByText("Added from the reviewed working list.")).toBeVisible();
  await expect(workingList.getByText(COPY.removalKeepsHistory).first()).toBeVisible();
  await expect(workingList.getByText(COPY.countsOnTheirOwn).first()).toBeVisible();
  await page.getByRole("button", { name: "Return Ruth Okafor to the working list" }).click();
  const restore = page.getByRole("dialog", { name: "Return to the working list: Ruth Okafor" });
  await expect(restore).toBeVisible();
  await expect(restore.getByText(COPY.returnGrantsNothing)).toBeVisible();
  await restore.getByRole("button", { name: "Return this partner" }).click();
  await expect(restore.getByRole("heading", { name: "Saved" })).toBeVisible();
  await restore.getByRole("button", { name: "Done" }).click();
  await expect(restore).toBeHidden();
  await expect(memberRow(page, "Ruth Okafor").getByText(MEMBERSHIP_LABEL.included, { exact: true }).first()).toBeVisible();
  await expect(memberRow(page, "Ruth Okafor").getByText("Returned to the reviewed working list.")).toBeVisible();
  await expect(workingList.getByText("Showing 1–2 of 2 working-list members")).toBeVisible();
  expect(initiativeIdOf(page)).toBe(initiativeId);
  await expect(recordBody(page)).toHaveAttribute("data-initiative-state", "open");
});
test("keeps the three working-list states distinct and never re-includes a partner the source marks not eligible", async ({ page }) => {
  await openInitiative(page, SEEDED_INITIATIVE.initiativeId);
  await openSection(page, "Working list");
  const workingList = panel(page, "Working list");
  await expect(workingList.getByText(COPY.countsOnTheirOwn).first()).toBeVisible();
  const summaryItem = (label: string) => workingList.getByRole("listitem").filter({ hasText: label }).first();
  await expect(summaryItem(MEMBERSHIP_LABEL.included).getByText("2", { exact: true })).toBeVisible();
  await expect(summaryItem(MEMBERSHIP_LABEL.removed).getByText("1", { exact: true })).toBeVisible();
  await expect(summaryItem(MEMBERSHIP_LABEL.excluded).getByText("1", { exact: true })).toBeVisible();
  await expect(workingList.getByText("Showing 1–4 of 4 working-list members")).toBeVisible();
  await expect(memberRow(page, "Grace Adeyemi").getByText(MEMBERSHIP_LABEL.included, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Grace Adeyemi from the working list" })).toBeVisible();
  const removed = memberRow(page, "Priya Raman");
  await expect(removed.getByText(MEMBERSHIP_LABEL.removed, { exact: true }).first(), "Removed: its own state, the reason the removal recorded, the earlier inclusion beside it, and the one action that returns the partner — retaining the history is not the same as forgetting the removal").toBeVisible();
  await expect(removed.getByText("Volunteers rather than gives, and asked not to be asked.")).toBeVisible();
  await expect(removed.getByText("Added from the reviewed working list.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Return Priya Raman to the working list" })).toBeVisible();
  const excluded = memberRow(page, "Marcus Webb");
  await expect(excluded.getByText(MEMBERSHIP_LABEL.excluded, { exact: true }).first()).toBeVisible();
  await expect(excluded.getByText("Asked not to be approached; the restriction stays recorded.")).toBeVisible();
  await expect(excluded.getByText(COPY.exclusionIsSourceFact)).toBeVisible();
  await expect(excluded.getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: ADD_PARTNERS_LABEL }).click(); // The picker offers no partner who already holds a membership: an included, a removed and an excluded partner are all left out of the choices rather than offered as a row whose only answer is "unchanged".
  const options = page.getByRole("listbox", { name: "Eligible partners" });
  await expect(options).toBeVisible();
  for (const name of ["Jo Mbeki", "Grace Adeyemi", "Priya Raman", "Marcus Webb"]) await expect(options.getByRole("option", { name })).toHaveCount(0);
  await expect(options.getByRole("option", { name: "Ruth Okafor" }), "An eligible partner is still offered, so the empty choices are the roster's own answer and not an outage").toBeVisible();
});
test("records a stage from the approved list, treats the same choice as no change, and clears it explicitly", async ({ page }) => {
  const tasksBefore = await pagerTotal(page, "/work", "tasks");
  await openInitiative(page, SEEDED_INITIATIVE.initiativeId);
  await openSection(page, "Working list");
  const graceStage = page
    .locator('[data-slot="stage-selector"]')
    .filter({ has: page.getByRole("combobox", { name: "Stage for Grace Adeyemi" }) })
    .first();
  const stageSelect = page.getByRole("combobox", { name: "Stage for Grace Adeyemi" });
  await expect(stageSelect).toBeVisible();
  const offered = await stageSelect.locator("option").allTextContents();
  expect(offered.filter((option) => option.trim() !== "")).toEqual([...ADMITTED_STAGES]);
  await expect(graceStage.locator("input")).toHaveCount(0);
  await expect(page.locator('[data-slot="working-list"] [draggable="true"]')).toHaveCount(0);
  await expect(graceStage.getByText(COPY.noTaskFromStage)).toBeVisible();
  await stageSelect.selectOption("Follow up due");
  await expect(graceStage.getByText("Recorded stage")).toBeVisible();
  await expect(graceStage.getByText("Stage after this change")).toBeVisible();
  await graceStage.getByRole("button", { name: "Record this stage" }).click();
  await expect(memberRow(page, "Grace Adeyemi").getByText("Stage recorded as Follow up due.")).toBeVisible();
  await expect(graceStage.getByText("Recorded", { exact: true })).toBeVisible();
  await expect(stageSelect).toHaveValue("Follow up due");
  const historyAfterChange = await memberRow(page, "Grace Adeyemi").getByRole("listitem").allTextContents();
  await stageSelect.selectOption("Follow up due");
  await expect(graceStage.getByRole("status")).toHaveText(COPY.sameStage);
  await expect(graceStage.getByRole("button", { name: "Record this stage" })).toHaveCount(0);
  await expect(memberRow(page, "Grace Adeyemi").getByRole("listitem")).toHaveCount(historyAfterChange.length);
  await page.getByRole("button", { name: "Stage actions for Grace Adeyemi" }).click();
  await page.getByRole("menuitem", { name: "Clear stage" }).click();
  await graceStage.getByRole("button", { name: "Clear stage" }).click();
  await expect(memberRow(page, "Grace Adeyemi").getByText("Stage cleared.")).toBeVisible();
  await expect(stageSelect).toHaveValue("");
  expect(await pagerTotal(page, "/work", "tasks")).toBe(tasksBefore);
});
const SEEDED_PURPOSE = "Support the youth programme through the autumn appeal.";
const FIRST_PURPOSE = "Consider a monthly gift towards the youth programme.";
const SECOND_PURPOSE = "Prayer support through the winter months.";
const LATE_PURPOSE = "Consider helping with the spring residential weekend.";
const requestEntry = (page: Page, purpose: string) => panel(page, "Requests").getByRole("listitem").filter({ hasText: purpose }).first(); // One recorded Request, addressed by the purpose it states rather than by its position in the list.
const requestSection = (page: Page, purpose: string) => requestEntry(page, purpose).locator('section[data-slot="request-presentation"]'); // One Request's presentation record: the version it presented, the day, the manner and its requested terms.
const responseSection = (page: Page, purpose: string) => requestEntry(page, purpose).locator('section[data-slot="request-response-form"]');
type RequestDraft = { readonly recipient: string; readonly purpose: string; readonly version: string; readonly currency?: string; readonly minorUnits?: string; readonly cadence?: string; readonly term?: string; readonly nonFinancial?: string }; // What one drafted Request states, so a caller names only the values it changes.
const requestComposer = (page: Page) => page.locator('[data-slot="request-composer"]').locator("form").first(); // The composer's own form: the one form in the requests section offering a Recipient choice.
async function openRequestComposer(page: Page): Promise<void> {
  const composer = requestComposer(page); // Opens the composer, sticking with the one already on screen rather than minting a second one.
  if (await composer.isVisible()) return;
  const another = page.getByRole("button", { name: "Draft another request" });
  if (await another.isVisible()) {
    await another.click();
  } else await page.getByRole("button", { name: "Draft a Request" }).click();
  await expect(composer).toBeVisible();
}
async function draftRequest(page: Page, draft: RequestDraft): Promise<void> {
  await openRequestComposer(page); // Drafts one Request through the composer and returns once its own section states the draft.
  const composer = requestComposer(page);
  await composer.getByRole("combobox", { name: "Recipient" }).selectOption({ label: draft.recipient });
  await composer.getByRole("textbox", { name: "Purpose" }).fill(draft.purpose);
  await composer.getByRole("spinbutton", { name: "Terms version" }).fill(draft.version);
  if (draft.nonFinancial !== undefined) {
    await composer.getByRole("radio", { name: "No amount requested" }).click();
    await composer.getByRole("textbox", { name: "No amount requested" }).fill(draft.nonFinancial);
  } else {
    await composer.getByRole("radio", { name: "An amount" }).click();
    await composer.getByRole("textbox", { name: "Currency" }).fill(draft.currency ?? "");
    await composer.getByRole("textbox", { name: "Amount requested" }).fill(draft.minorUnits ?? "");
    await composer.getByRole("textbox", { name: "Cadence" }).fill(draft.cadence ?? "");
    await composer.getByRole("textbox", { name: "Term" }).fill(draft.term ?? "");
  }
  await composer.getByRole("button", { name: "Review and draft" }).click();
  await page.getByRole("button", { name: "Save draft request" }).click();
  await expect(requestSection(page, draft.purpose).getByText("No presentation recorded yet"), "The drafted Request's own section is the result: it states the terms version and its requested terms, and that nothing has been presented yet").toBeVisible();
}
async function presentRequest(page: Page, purpose: string, manner: string): Promise<void> {
  const section = requestSection(page, purpose); // Records the actual presentation of one Request: the civil day it happened and how it was given.
  await section.getByRole("button", { name: "Record this presentation" }).click();
  await section.getByLabel("Presented on", { exact: false }).fill(PRESENTED_ON);
  await section.getByRole("textbox", { name: "How it was presented" }).fill(manner);
  await section.getByRole("button", { name: "Review this presentation" }).click();
  await section.getByRole("button", { name: "Record this presentation" }).last().click();
  await expect(section.getByText(PRESENTED_ON, { exact: true })).toBeVisible();
  await expect(section.getByText(manner, { exact: true })).toBeVisible();
  await expect(section.getByText("A recorded presentation is never overwritten, so no recording control is offered once one exists.")).toBeVisible();
}
async function recordAnswer(page: Page, purpose: string, kind: string, evidence: string): Promise<void> {
  const section = responseSection(page, purpose); // Records the named respondent's own answer, from the seven kinds, bound to the version that was presented.
  for (const label of RESPONSE_KINDS) await expect(section.getByRole("radio", { name: label, exact: true })).toBeVisible();
  await section.getByRole("radio", { name: kind, exact: true }).click();
  await section.getByRole("button", { name: "Use the recipient's reference" }).click();
  await section.getByRole("textbox", { name: "What stands behind this answer" }).fill(evidence);
  await section.getByRole("button", { name: "Review this answer" }).click();
  await section.getByRole("button", { name: "Record this answer" }).click();
  await expect(section.getByText("Recorded answer", { exact: true })).toBeVisible();
}
test("presents a Request and records a late answer bound to the terms version it answers, creating nothing else", async ({ page }) => {
  const before = await countsOf(page);
  await openInitiative(page, SEEDED_INITIATIVE.initiativeId);
  await openSection(page, "Requests");
  const seeded = requestSection(page, SEEDED_PURPOSE);
  await expect(seeded.getByText("Terms version presented").first(), "The seeded Request was presented at version 1 and carries version 2 now, and its recorded answer is bound to the version that was presented rather than to the terms the Request carries today").toBeVisible();
  await expect(seeded.getByText(SEEDED_REQUEST.presentedVersion, { exact: true }).first()).toBeVisible();
  await expect(seeded.getByText("Earlier terms version").first()).toBeVisible();
  await expect(seeded.getByText(/The version presented is earlier than the terms this Request carries now/u)).toBeVisible();
  await expect(seeded.getByText("Earlier presented versions are kept.")).toBeVisible();
  const seededAnswer = responseSection(page, SEEDED_PURPOSE);
  await expect(seededAnswer.getByText("Recorded answer", { exact: true })).toBeVisible();
  await expect(seededAnswer.getByText(/Agreed with conditions/u).first()).toBeVisible();
  await expect(seededAnswer.getByText(SEEDED_REQUEST.presentedVersion, { exact: true }).first()).toBeVisible();
  await expect(seededAnswer.getByText(/earlier than the version this Request carries now/u)).toBeVisible();
  await expect(seededAnswer.getByText(SEEDED_REQUEST.respondent, { exact: true }).first(), "The answer is the named respondent's own, stated by its opaque reference rather than by a name").toBeVisible();
  await expect(seeded.getByText(COPY.notReceivedSupport), "Requested terms are what the worker asked for, and are never presented as received support: the exact requested amount in minor units beside its currency, its cadence and its term, with version 2 as the version the Request carries now").toBeVisible();
  await expect(seeded.getByText(SEEDED_REQUEST.amount, { exact: true }).first()).toBeVisible();
  await expect(seeded.getByText(SEEDED_REQUEST.currency, { exact: true }).first()).toBeVisible();
  await expect(seeded.getByText(SEEDED_REQUEST.cadence, { exact: true })).toBeVisible();
  await expect(seeded.getByText(SEEDED_REQUEST.term, { exact: true })).toBeVisible();
  await expect(seeded.getByText(SEEDED_REQUEST.currentVersion, { exact: true }).first()).toBeVisible();
  await expect(seeded.getByText(COPY.agreementCreatesNothing).first()).toBeVisible();
  await expect(seeded.getByText(COPY.bindsToVersion).first()).toBeVisible();
  await draftRequest(page, { recipient: "Jo Mbeki", purpose: FIRST_PURPOSE, version: "1", currency: "USD", minorUnits: "2500", cadence: "Monthly", term: "6 months" });
  const first = requestSection(page, FIRST_PURPOSE);
  await expect(first.getByText("terms-v1", { exact: true }).first()).toBeVisible();
  await expect(first.getByText("25.00 USD", { exact: true }).first()).toBeVisible();
  await draftRequest(page, { recipient: "Grace Adeyemi", purpose: SECOND_PURPOSE, version: "2", nonFinancial: "Prayer support through the winter months." });
  const second = requestSection(page, SECOND_PURPOSE);
  await expect(second.getByText("No amount requested", { exact: true })).toBeVisible();
  await expect(second.getByText("terms-v2", { exact: true }).first()).toBeVisible();
  await expect(second.getByText("Currency", { exact: true })).toHaveCount(0);
  await expect(second.getByText(SEEDED_REQUEST.amount)).toHaveCount(0);
  await presentRequest(page, FIRST_PURPOSE, "In person, at the church office.");
  await expect(first.getByText("Current terms version").first()).toBeVisible();
  await recordAnswer(page, FIRST_PURPOSE, "Agreed", "Jo confirmed by phone on 20 November."); // The late answer: recorded after the initiative already carries a Request at version 2, and bound to the version this Request presented rather than to the newest terms in the initiative.
  const answered = responseSection(page, FIRST_PURPOSE);
  await expect(answered.getByText("Terms version answered").first()).toBeVisible();
  await expect(answered.getByText("terms-v1", { exact: true }).first()).toBeVisible();
  await expect(answered.getByText("Current terms version").first()).toBeVisible();
  await expect(answered.getByText(/This Request already carries the named respondent's answer/u)).toBeVisible();
  await expect(requestSection(page, SECOND_PURPOSE).getByText("No presentation recorded yet")).toBeVisible();
  await expect(recordBody(page)).toHaveAttribute("data-initiative-state", "open");
  expect(await countsOf(page), "Agreement created no gift, no commitment, no task and no message: the four whole-result counts are the same integers they were before the journey began").toEqual(before);
});
test("states every result count against the denominator it is measured by", async ({ page }) => {
  await openInitiative(page, SEEDED_INITIATIVE.initiativeId);
  await openSection(page, "Results");
  const results = panel(page, "Results");
  await expect(results.getByText("Counted against").filter({ visible: true }).first()).toBeVisible();
  await expect(results.getByText("1 Requests recorded for this initiative").filter({ visible: true })).toHaveCount(RESPONSE_KINDS.length);
  await expect(results.getByText(COPY.agreementCreatesNothing).first()).toBeVisible();
  await expect(results.getByText("Agreed with conditions", { exact: true }).filter({ visible: true }).first(), "The one recorded answer is 1 of that 1, so its share is stated rather than computed here").toBeVisible();
  await expect(results.getByText("100%", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  for (const said of ["Superseded by a later version", "Current terms version"]) await expect(results.getByText(said).first()).toBeVisible();
  await expect(results.getByText("Requests that stated or answered this terms version").filter({ visible: true }).first()).toBeVisible();
  await expect(results.getByText(SEEDED_REQUEST.presentedVersion, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(results.getByText(SEEDED_REQUEST.currentVersion, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await openSection(page, "Requests"); // One more presented Request moves the whole base and its shares: the denominator is the whole result, and every kind is counted against it rather than against the page on screen.
  await draftRequest(page, { recipient: "Grace Adeyemi", purpose: SECOND_PURPOSE, version: "1", currency: "EUR", minorUnits: "1500", cadence: "Monthly", term: "12 months" });
  await presentRequest(page, SECOND_PURPOSE, "By email, on 20 November.");
  await page.reload(); // The results section states the counts the page's own read composed, so the journey returns to this address and the section reads the initiative again rather than a snapshot taken before the second ask.
  await expect(page.getByRole("tab", { name: "Results" })).toBeVisible();
  await openSection(page, "Results");
  await expect(results.getByText("2 Requests recorded for this initiative").filter({ visible: true })).toHaveCount(RESPONSE_KINDS.length);
  const unansweredRow = results.getByRole("row").filter({ hasText: "Unanswered" }).first();
  await expect(unansweredRow.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(unansweredRow.getByText("2 Requests recorded for this initiative")).toBeVisible();
  await expect(unansweredRow.getByText("50%", { exact: true })).toBeVisible();
});
const CLOSURE_DISPOSITION = "Invited by phone; no further asks this year."; // The disposition, the account of the work the closure does not complete, and the reason it was reopened.
const CLOSURE_NOTE = "Every open item was a call already made.";
test("requires a disposition to close, keeps a late answer recordable while closed, and preserves history and exclusions on reopen", async ({ page }) => {
  await openInitiative(page, SEEDED_INITIATIVE.initiativeId);
  await openSection(page, "Requests");
  await draftRequest(page, { recipient: "Jo Mbeki", purpose: LATE_PURPOSE, version: "2", currency: "USD", minorUnits: "4000", cadence: "One-off", term: "3 months" });
  await presentRequest(page, LATE_PURPOSE, "By letter, posted on 19 November.");
  await openSection(page, "Overview");
  await page.getByRole("button", { name: "Close initiative" }).first().click();
  const closeDialog = page.getByRole("dialog", { name: "Close initiative" });
  await expect(closeDialog).toBeVisible();
  await closeDialog.getByRole("button", { name: "Review this closure" }).click();
  await expect(closeDialog.getByText("There is a problem with this form")).toBeVisible();
  await expect(closeDialog.getByText(COPY.dispositionRequired).first()).toBeVisible();
  await expect(closeDialog.getByText(COPY.handoffRequired).first()).toBeVisible();
  await expect(closeDialog.getByText(COPY.lateAnswerNote).first(), "The closure states, where it is taken, that a late answer stays recordable without reopening").toBeVisible();
  await closeDialog.getByRole("textbox", { name: "Disposition" }).fill(CLOSURE_DISPOSITION);
  await closeDialog.getByRole("radio", { name: "The disposition above covers this work" }).click();
  await closeDialog.getByRole("textbox", { name: "How the disposition covers this work" }).fill(CLOSURE_NOTE);
  await closeDialog.getByRole("button", { name: "Review this closure" }).click();
  await closeDialog.getByRole("button", { name: "Close initiative" }).click();
  const confirmClose = page.getByRole("alertdialog");
  await expect(confirmClose).toBeVisible();
  await confirmClose.getByRole("button", { name: "Close initiative" }).click();
  await expect(closeDialog).toBeHidden();
  await expect(recordBody(page)).toHaveAttribute("data-initiative-state", "closed");
  await expect(page.getByText(CLOSURE_DISPOSITION)).toBeVisible();
  await expect(page.getByText(CLOSURE_NOTE, { exact: false })).toBeVisible();
  await openSection(page, "Requests");
  await recordAnswer(page, LATE_PURPOSE, "Deferred", "Asked to talk again in January.");
  const late = responseSection(page, LATE_PURPOSE);
  await expect(late.getByText(/Deferred/u).first()).toBeVisible();
  await expect(late.getByText("terms-v2", { exact: true }).first()).toBeVisible();
  await expect(recordBody(page)).toHaveAttribute("data-initiative-state", "closed");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen initiative" }).first().click();
  const reopenDialog = page.getByRole("dialog", { name: "Reopen initiative" });
  await expect(reopenDialog).toBeVisible();
  await reopenDialog.getByRole("textbox", { name: "Reason" }).fill("A late reply arrived and asks for another conversation.");
  await reopenDialog.getByRole("button", { name: "Reopen initiative" }).click();
  const confirmReopen = page.getByRole("alertdialog");
  await expect(confirmReopen).toBeVisible();
  await confirmReopen.getByRole("button", { name: "Reopen initiative" }).click();
  await expect(reopenDialog).toBeHidden();
  await expect(recordBody(page)).toHaveAttribute("data-initiative-state", "open");
  await expect(page.getByText(COPY.reopenKeepsHistory).first()).toBeVisible();
  await expect(page.getByText(CLOSURE_DISPOSITION)).toBeVisible();
  await openSection(page, "Working list");
  await expect(memberRow(page, "Marcus Webb").getByText(MEMBERSHIP_LABEL.excluded, { exact: true }).first()).toBeVisible();
  await expect(memberRow(page, "Priya Raman").getByText(MEMBERSHIP_LABEL.removed, { exact: true }).first()).toBeVisible();
  await expect(memberRow(page, "Priya Raman").getByText("Volunteers rather than gives, and asked not to be asked.")).toBeVisible();
  const history = await historyEntries(page);
  expect(history).toHaveLength(7);
  for (const instant of ["2026-09-02T09:00:00Z", "2026-09-02T09:05:00Z", "2026-09-02T09:10:00Z", "2026-09-02T09:15:00Z", "2026-10-01T10:00:00Z", SEEDED_REQUEST.recordedAt, "2026-11-20T00:00:00Z"]) expect(history.some((entry) => entry.includes(instant))).toBe(true);
  expect(history.some((entry) => entry.includes("Asked not to be approached; the restriction stays recorded."))).toBe(true);
  expect(history.some((entry) => entry.includes("Agreed with conditions"))).toBe(true);
});
