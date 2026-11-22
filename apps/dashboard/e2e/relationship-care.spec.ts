/**
 * Criterion 3 — relationship care: find a person and a church, read what their records honestly say, log
 * something that actually happened, and create the next piece of work — with the interaction recorded
 * exactly once even when the acknowledgement is lost or the task that follows it fails.
 *
 * **The journey, from the deterministic seed as the established worker.** Search the whole roster and
 * narrow it with a faceted filter; open a person's record and read its restrictions and its activity
 * history; open a church's record and confirm it is a record of its own that holds none of the person's
 * private text; log an interaction with a date, a stated precision, an outcome, a participant and an
 * audience-labelled note; recover that interaction's result after a lost acknowledgement; watch a
 * follow-up task be refused and then accepted without the interaction being sent again; complete a task
 * and create the next one and confirm that neither touches the activity history.
 *
 * **Why the lost acknowledgement is armed rather than simulated in the browser.** The development
 * runtime's one failure plan applies the change and withholds the answer, so the store holds exactly one
 * effect while this browser knows nothing. That is what makes the recovery below a recovery rather than a
 * second submission: "Check the result" replays the same operation identity and the service answers with
 * the result it stored.
 *
 * **What the handoff proves, and what it deliberately does not.** A permitted contact method is offered as a
 * handoff: an email method as a `mailto:` link carrying the record's own address, a phone method as a `tel:` link
 * carrying its own number. Following one leaves this application for another program, so it sends nothing to this
 * service and the activity history beside it stays exactly as it was — which is what "opening email creates no
 * interaction" looks like on a surface that offers the handoff. A handoff still proves nothing about contact, and
 * neither does the completed task below. And the failure armed for the interaction is the only one this criterion
 * injects: a task creation is not one of the calls the development runtime can arm a failure on, so the task that
 * fails here is refused by the application itself, for input it really refuses, which preserves the caller's input
 * and proves the same property.
 *
 * **What every assertion is for.** A task needs only a title and a completed task records that work was
 * closed rather than that anyone was contacted; an interaction records something that actually happened
 * and is recorded once; a private note belongs to one record and never appears in another record's
 * audience, even where two records share a name, an address or an email. So the journey is asserted as
 * exactly that: the same figures before and after an action that must not move them, and a durable
 * in-context receipt — never a toast — for every outcome.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, resetSeed, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded world this journey acts in
// ---------------------------------------------------------------------------------------------

/**
 * The seeded identity every read and every browser request below is authorised as.
 *
 * The established worker holds years of gifts, recurring support, partners, drafts and two ministries,
 * which is what makes its partner records worth reading: a restricted person whose number is recorded and
 * refused, a church that is a record of its own, and a person whose record already holds a private note, a
 * recorded interaction and open work.
 */
const PERSONA: PersonaName = "established-worker";

/** The two destinations this journey reads: the roster, and the work surface the next task is created on. */
const ROSTER_HREF = "/partners";

const WORK_HREF = "/work";

/** The persistent label the shell renders on every surface, so no screen can be mistaken for production. */
const DEVELOPMENT_DATA_LABEL = "Development data";

// ---------------------------------------------------------------------------------------------
// The roster's own vocabulary
// ---------------------------------------------------------------------------------------------

/** The visually-hidden label of the one search field the toolbar owns. */
const SEARCH_LABEL = "Search";

/**
 * The name the roster states its filter surface under.
 *
 * The list itself and its filter bar both carry the roster's name — the bar as its own region, the list as the
 * scrollable table region — so the bar is addressed by the exact name it states and nothing inside the list is
 * mistaken for a filter control.
 */
const ROSTER_LABEL = "Partner roster";

/** The faceted filter this journey applies, and the one value it selects in it. */
const CONTACT_TYPE_FACET = "Contact type";
const PERSON_FACET_VALUE = "Person";

/** The person whose restriction and refusal of a contact method this journey reads. */
const RESTRICTED_PERSON = "Marcus Webb";

/** The person whose private note, activity history and open work this journey reads and adds to. */
const CARE_PERSON = "Jo Mbeki";

/** The church that must stay a record of its own, holding none of that person's text. */
const CHURCH = "St Aidan's Church";

/** The record kind the church states about itself, in the identity block's own words. */
const CHURCH_KIND = "Church";

// ---------------------------------------------------------------------------------------------
// What one partner record states, in the words its own sections use
// ---------------------------------------------------------------------------------------------

/** The record body's section titles, as the one detail body names them. */
const CONTACT_METHODS_SECTION = "Permitted contact methods";
const RESTRICTIONS_SECTION = "Restrictions";
const ACTIVITY_SECTION = "Actual activity";
const PRIVATE_NOTES_SECTION = "Private notes";
const OPEN_TASKS_SECTION = "Open tasks";

/** The restriction the seed records for the restricted person, and the state a contact method this session may use carries. */
const RESTRICTION_KIND = "no-phone";
const RESTRICTION_DETAIL = "Asked that we never telephone, and confirmed it in writing.";
const PERMITTED_METHOD = "Permitted on this record";

/**
 * The number the restricted record holds and does not offer, the address the same record does offer, and the
 * address the person this journey cares for permits.
 *
 * A contact method this session may not use is left off the record rather than shown blank or disabled, so the
 * refusal is proven by the restriction's own sentence beside the number's absence — a stated restriction, not an
 * empty field — and by the method that is offered still reading as permitted.
 */
const RESTRICTED_NUMBER = "+44 20 7946 0958";
const RESTRICTED_PERSON_EMAIL = "marcus.webb@example.org";
const CARE_PERSON_EMAIL = "jo.mbeki@example.org";

/**
 * The person whose record permits a telephone number, and the number it permits.
 *
 * The person this journey cares for holds a permitted address and no number in the seed, so the dialler handoff is
 * read on a record that really holds a number rather than asserted on a record with nothing to open.
 */
const PHONE_PERSON = "Kenji Nakamura";
const PHONE_PERSON_NUMBER = "+44 20 7946 0421";

/** The private note the seed writes on that person's record, which no other record may show. */
const CARE_PERSON_PRIVATE_NOTE = "Prefers a call after 6pm, and asked for nothing to be posted to the shared house address.";

/** The audience label a private note carries wherever it is rendered, so its audience is never inferred from a heading. */
const PRIVATE_NOTE_AUDIENCE_LABEL = "Private note — only you";

/** The interaction the seed already records against that person, and the empty state a record with none states. */
const SEEDED_INTERACTION_OUTCOME = "Left a voicemail";
const NO_INTERACTION_RECORDED = "No interaction recorded for this partner";

// ---------------------------------------------------------------------------------------------
// The one receipt component's own words
// ---------------------------------------------------------------------------------------------

/** The four headings this journey reads off the durable in-context result. */
const UNCONFIRMED_HEADING = "Result not confirmed";
const ALREADY_SAVED_HEADING = "Already saved";
const SAVED_HEADING = "Saved";
const CHECK_THE_DETAILS_HEADING = "Check the details";

/** The two controls an unconfirmed outcome offers, and no third: neither of them sends the work again. */
const CHECK_RESULT_LABEL = "Check the result";
const RETRY_SAME_WORK_LABEL = "Retry the same request";

/** The wording a resend control would use, asserted absent wherever an outcome is unconfirmed. */
const RESEND_WORDING = /resend|send again|send it again/iu;

// ---------------------------------------------------------------------------------------------
// The interaction this journey logs, and the work that follows it
// ---------------------------------------------------------------------------------------------

/** The form's own labels, taken from the one interaction form rather than restated in its own words. */
const KIND_OF_CONTACT_LABEL = "Kind of contact";
const THE_DAY_LABEL = "The day it happened";
const WHAT_CAME_OF_IT_LABEL = "What came of it";
const HOW_THEY_TOOK_PART_LABEL = "How they took part";
/**
 * The note's own label, matched as a prefix because an optional field states "(optional)" beside it.
 *
 * A prefix rather than the whole name keeps this file correct whether or not the field states that marker, and it
 * cannot collide with the precision control whose hint text mentions the day it happened.
 */
const NOTE_FIELD_NAME = /^A note about this contact/u;
const SUBMIT_LABEL = "Log the interaction";
const TASK_INTENT_LABEL = "Create a follow-up task";
const TASK_TITLE_LABEL = "What needs doing";
const SAVE_TASK_LABEL = "Save the follow-up task";
const BACK_TO_RECORD_LABEL = "Back to the record";

/** The visit this journey records: a kind, a civil day, an outcome, a participant role and an audience-labelled note. */
const LOGGED_KIND_LABEL = "A visit";
const LOGGED_DAY = "2026-11-18";
const LOGGED_OUTCOME = "Talked through the Christmas plan and agreed a visit in December";
const LOGGED_ROLE = "Worker";
const LOGGED_NOTE = "Agreed to bring the rota on the next visit.";

/** The seeded task this journey completes, and the two tasks it creates: one after the interaction, one from the record. */
const SEEDED_TASK_TITLE = "Follow up with Jo after the visit";
const FOLLOW_UP_TASK_TITLE = "Send Jo the Christmas rota";
const NEXT_TASK_TITLE = "Book the December visit with Jo";

/**
 * A task title the transport refuses and the form's own schema accepts.
 *
 * The interaction form's task schema states no maximum length while the transport that creates the task
 * refuses a title longer than 200 code points, so this is a real refusal of real input rather than a
 * fabricated one: the composer keeps what was typed, states the message beside the field, and the
 * interaction already recorded is not sent again.
 */
const TITLE_TOO_LONG_TASK = "Collect the Christmas rota from the church office, confirm the December visit with the students' group, check the venue booking with the warden and agree who brings the refreshments on the day of the visit. ".repeat(2);
const TITLE_TOO_LONG_MESSAGE = "Shorten the title to a phrase, so it reads at a glance in a list.";

/** The work composer's own labels, which differ from the interaction form's because it is a different form. */
const NEW_TASK_LABEL = "New task";
const COMPOSER_TITLE_LABEL = "Title";
/** The composer's link field, matched as a prefix because an optional field states "(optional)" beside it. */
const LINKED_RECORD_NAME = /^Linked record/u;
const CREATE_TASK_LABEL = "Create task";

/** The record's own action that opens the composer already linked to it. */
const CREATE_FOLLOW_UP_TASK_LABEL = "Create a follow-up task";

/** The record's own action that opens the interaction form. */
const LOG_INTERACTION_LABEL = "Log an interaction";

/** How much of an unreadable answer a failure quotes, so a diagnostic is readable without pasting a whole body. */
const DETAIL_LIMIT = 400;

// ---------------------------------------------------------------------------------------------
// Reading answers back without trusting a shape
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A body's own `outcome`, or `undefined` for a body that carries none. */
function outcomeOf(body: unknown): string | undefined {
  return isRecord(body) && typeof body.outcome === "string" ? body.outcome : undefined;
}

function detailOf(text: string): string {
  const collapsed = text.trim().replace(/\s+/gu, " ");
  return collapsed.length > DETAIL_LIMIT ? `${collapsed.slice(0, DETAIL_LIMIT)}…` : collapsed;
}

// ---------------------------------------------------------------------------------------------
// The persistent development label, and the roster's own search and filters
// ---------------------------------------------------------------------------------------------

/** Asserts the label that says this application shows synthetic data, so no outcome read here is mistaken for a production one. */
async function expectDevelopmentData(page: Page): Promise<void> {
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first(), "Every surface this journey reads states that its data is development data, so a recorded acceptance is never mistaken for a production effect.").toBeVisible();
}

/** The roster's one filter surface: the query toolbar the list states under its own name. */
function rosterToolbar(page: Page): Locator {
  return page.getByRole("region", { name: ROSTER_LABEL, exact: true });
}

/**
 * Opens the roster and answers the list every row this journey finds is read from.
 *
 * The route's own heading, the persistent development label, the filter surface and the one list pattern are all
 * asserted here, so a journey that began on a stale page or a missing toolbar fails before it reads a record.
 */
async function openRoster(page: Page): Promise<Locator> {
  await page.goto(ROSTER_HREF);
  await expect(page.getByRole("heading", { name: "Partners", level: 1 }), "The roster is a destination of the shell's own navigation.").toBeVisible();
  await expectDevelopmentData(page);
  await expect(rosterToolbar(page), "The roster states one filter surface, which is where every search and filter below is applied.").toBeVisible();
  const list = page.locator('[data-slot="record-list"]');
  await expect(list, "The roster renders the one list pattern, which is where every row below is read.").toBeVisible();
  return list;
}

/**
 * Searches the whole roster through its own field.
 *
 * The field is committed with Enter rather than left to the typing debounce, so the query the assertions
 * read is the query that was asked for, and no assertion waits on a timer this file would have to guess.
 *
 * The address is awaited after that, because the roster keeps its query in the address itself and writes it
 * back with a router transition that commits a moment after the last keystroke. A record opened inside that
 * pending commit cancels it, and the entry the browser's back button then returns to holds no search at all,
 * so this journey waits for the address to state the search before it opens anything out of the result.
 */
async function searchRoster(page: Page, text: string): Promise<void> {
  const field = page.getByLabel(SEARCH_LABEL, { exact: true });
  await expect(field, "The roster states one search field, and it is the one this journey types in.").toBeVisible();
  await field.fill(text);
  await field.press("Enter");
  await expect.poll(() => [...new URL(page.url()).searchParams.values()].includes(text), { message: `The roster's own address carries the search ${JSON.stringify(text)}, so reading a record and coming back returns to this result rather than to an unfiltered one.` }).toBe(true);
}

/**
 * Applies one value of one faceted filter, and answers once the filter states itself as applied.
 *
 * The facet's own trigger carries the label the read gave the filter and lives on the filter surface, so the
 * control a person uses is the one this journey operates: the same label also names a sortable column inside the
 * list, and that column is not a filter.
 */
async function selectFacetValue(page: Page, facetLabel: string, valueLabel: string): Promise<void> {
  const toolbar = rosterToolbar(page);
  await toolbar.getByRole("button", { name: facetLabel, exact: true }).click();
  const option = page.getByRole("checkbox", { name: valueLabel, exact: true });
  await expect(option, `The filter ${facetLabel} offers the value ${valueLabel} in this context.`).toBeVisible();
  await option.click();
  await expect(option, `Choosing ${valueLabel} selects it rather than merely closing the filter.`).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(toolbar.getByRole("button", { name: `${facetLabel}, 1 selected` }), "The applied filter states itself on its own trigger, so the list on screen is the list the filter described.").toBeVisible();
}

/**
 * Removes one applied filter through the chip it states itself on.
 *
 * The toolbar keeps the search text and the facet selections as two different things, so a filtered view is
 * widened by removing each one where it states itself rather than by a single control that could clear only one
 * of them and leave the other narrowing the list invisibly.
 */
async function removeFacetValue(page: Page, facetLabel: string, valueLabel: string): Promise<void> {
  const toolbar = rosterToolbar(page);
  await toolbar.getByRole("button", { name: `Remove this filter: ${facetLabel}: ${valueLabel}` }).click();
  await expect(toolbar.getByRole("button", { name: facetLabel, exact: true }), "Removing the filter leaves its control stating no selection, so the list widens again.").toBeVisible();
}

/** Clears the search through the field's own control, so the list returns to the whole authorised result. */
async function clearSearch(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Clear the search text", exact: true }).click();
  await expect(page.getByLabel(SEARCH_LABEL, { exact: true }), "Clearing the search leaves the field empty.").toHaveValue("");
}

/** The address of one record, read from the roster's own row link rather than composed here. */
async function recordAddress(page: Page, name: string): Promise<string> {
  const link = page.getByRole("link", { name: `Open ${name}`, exact: true }).first();
  await expect(link, `The roster offers a way into ${JSON.stringify(name)} from the row itself.`).toBeVisible();
  const href = await link.getAttribute("href");
  if (href === null || href === "") {
    throw new Error(`The roster's link to ${JSON.stringify(name)} carries no address, so this file has no record to read.`);
  }
  return href;
}

/** Opens one record through the roster's own link and answers once its identity heading is on screen. */
async function openRecord(page: Page, name: string): Promise<void> {
  await page
    .getByRole("link", { name: `Open ${name}`, exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name, level: 1 }), `The record ${JSON.stringify(name)} opens at its own address with its own identity as the page heading.`).toBeVisible();
  await expectDevelopmentData(page);
}

// ---------------------------------------------------------------------------------------------
// One record's own sections
// ---------------------------------------------------------------------------------------------

/** One named section of the one record detail body, addressed by the heading it is labelled by. */
function section(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title, exact: true });
}

/**
 * The activity rows one record states, in order, read by their own list-item role.
 *
 * Each row's text is compared as a whole afterwards, so "the same rows" is a comparison against what the
 * surface actually rendered rather than against a count that could be met by different rows.
 */
async function activityRows(page: Page): Promise<readonly string[]> {
  const activity = section(page, ACTIVITY_SECTION);
  await expect(activity, "A partner record states its actual activity in a section of its own.").toBeVisible();
  const rows = await activity.getByRole("listitem").allInnerTexts();
  return rows.map((text) => text.replace(/\s+/gu, " ").trim());
}

// ---------------------------------------------------------------------------------------------
// The whole-result line a paged list states
// ---------------------------------------------------------------------------------------------

/**
 * The sentence a pager states, e.g. `Showing 1–50 of 13 partners`.
 *
 * The dash is an en dash and the noun is the list's own, so a count read here is the size of the whole result
 * rather than the number of rows one page happens to show.
 */
const SHOWING_LINE = /^Showing\s+([\d,]+)\u2013([\d,]+)\s+of\s+([\d,]+)\s+(\S+)$/u;

/** How many rows the whole result holds, as the pager of the list on screen states it. */
async function wholeResultCount(page: Page): Promise<number> {
  const pager = page.locator('[data-slot="pagination-bar"] output').first();
  await expect(pager, "A list states the size of its whole result beside its own rows, so a filtered count is never the size of one page.").toBeVisible();
  const stated = (await pager.innerText()).replace(/\s+/gu, " ").trim();
  const total = SHOWING_LINE.exec(stated)?.[3];
  if (total === undefined) {
    throw new Error(`The pager states its whole result as "Showing 1–N of M <noun>", and it read ${JSON.stringify(stated)} instead. A roster size this file cannot read would leave the filter's effect unproven.`);
  }
  const value = Number(total.replace(/,/gu, ""));
  if (!Number.isSafeInteger(value)) {
    throw new Error(`The pager's whole-result count is not a whole number: ${JSON.stringify(stated)}.`);
  }
  return value;
}

/** The opaque record identifier one address names, taken from the roster's own link rather than composed here. */
function partnerIdOf(href: string): string {
  const [path] = href.split("?");
  const segments = (path ?? "").split("/").filter((segment) => segment !== "");
  const last = segments[segments.length - 1];
  if (last === undefined || last === "") {
    throw new Error(`The roster link ${JSON.stringify(href)} names no record, so no task can be linked to it.`);
  }
  return decodeURIComponent(last);
}

/** One durable outcome receipt, addressed by the outcome it reports rather than by its position on the page. */
function receipt(page: Page, outcome: string): Locator {
  return page.locator(`[data-slot="operation-result"][data-outcome="${outcome}"]`);
}

// ---------------------------------------------------------------------------------------------
// The development runtime: the one armed failure this criterion injects
// ---------------------------------------------------------------------------------------------

/** What one session's development state states: the authority a control runs under and the revision it saw. */
interface DevelopmentState {
  readonly scope: Readonly<Record<string, unknown>>;
  readonly revision: string;
}

/**
 * Reads this session's development state.
 *
 * Every control presents the scope and the revision it read, exactly as the runner's own reset does, because
 * the service re-authorises the scope and answers `conflict` for a revision that no longer stands.
 */
async function readDevelopmentState(page: Page): Promise<DevelopmentState> {
  const answer = await page.request.get("/api/dev");
  const text = await answer.text();
  const body = parseJson(text);
  const scope = isRecord(body) ? body.scope : undefined;
  const revision = isRecord(body) ? body.revision : undefined;
  if (!answer.ok() || !isRecord(scope) || typeof revision !== "string" || revision === "") {
    throw new Error(`GET /api/dev did not answer with the development state this file arms a failure through: HTTP ${String(answer.status())} ${detailOf(text)}.`);
  }
  return { scope, revision };
}

/** Operates exactly one named development control, and refuses to carry on if it was not applied. */
async function operateDevelopmentControl(page: Page, action: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
  const state = await readDevelopmentState(page);
  const answer = await page.request.post("/api/dev", { data: { action, operationId: crypto.randomUUID(), scope: state.scope, expectedRevision: state.revision, payload } });
  const text = await answer.text();
  const outcome = outcomeOf(parseJson(text));
  if (!answer.ok() || (outcome !== "accepted" && outcome !== "unchanged")) {
    throw new Error(`The development control ${action} was refused: ${detailOf(text)}. A test that could not arm the failure it names would assert a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`);
  }
}

/**
 * Arms the lost acknowledgement on the interaction itself.
 *
 * The effect is applied and recorded and only the answer is withheld, so the attempt leaves exactly one
 * interaction behind: that is what makes the recovery below a recovery rather than a second record.
 */
async function armLostAcknowledgementOnInteraction(page: Page): Promise<void> {
  await operateDevelopmentControl(page, "setFailurePlan", { mode: "unknown", target: { kind: "mutation", name: "logInteraction" } });
}

/**
 * Disarms the one armed failure.
 *
 * A plan lives in the session document until something clears it, so a test that armed one clears it before the
 * assertions that must run against the application's own behaviour, and the reset in `beforeEach` is then the
 * second guarantee rather than the only one.
 */
async function clearArmedFailure(page: Page): Promise<void> {
  await operateDevelopmentControl(page, "setFailurePlan", { plan: null });
}

// ---------------------------------------------------------------------------------------------
// The one interaction form
// ---------------------------------------------------------------------------------------------

/** Opens the interaction form from the record's own action and answers once the form states the record it writes to. */
async function openInteractionForm(page: Page, name: string): Promise<void> {
  await page.getByRole("link", { name: LOG_INTERACTION_LABEL, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: `Log an interaction with ${name}` }), "The form is opened from the record it is recorded against, and it names that record in its own heading.").toBeVisible();
  await expectDevelopmentData(page);
}

/**
 * Fills the one interaction form with something that actually happened.
 *
 * Every control is addressed by the role and accessible name the form gives it, so the entry this journey
 * records is the entry the form states: a kind of contact, the civil day it happened, what came of it, how the
 * person took part, and a note that carries its audience. The accessible name is used rather than the label's
 * text because a required field marks itself with a character the reader never hears.
 */
async function fillLoggedInteraction(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: KIND_OF_CONTACT_LABEL, exact: true }).selectOption({ label: LOGGED_KIND_LABEL });
  await page.getByRole("textbox", { name: THE_DAY_LABEL, exact: true }).fill(LOGGED_DAY);
  await page.getByRole("textbox", { name: WHAT_CAME_OF_IT_LABEL, exact: true }).fill(LOGGED_OUTCOME);
  await page.getByRole("textbox", { name: HOW_THEY_TOOK_PART_LABEL, exact: true }).fill(LOGGED_ROLE);
  await page.getByRole("textbox", { name: NOTE_FIELD_NAME }).fill(LOGGED_NOTE);
}

// ---------------------------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------------------------

/** This file acts as the established worker throughout, which is the persona the runner admits the context as. */
test.use({ persona: PERSONA });

/**
 * Every test starts from the deterministic seed.
 *
 * The runner restores the same seed before the test body and puts this persona's session cookie on the context;
 * the call below states that requirement where this file is read, and a second reset lays the identical documents
 * down again through the same control the Settings reset submits.
 */
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

test("a person and a church are found by searching the whole roster and filtering it, and each record states its own restrictions, activity and private text", async ({ page }) => {
  const roster = await openRoster(page);
  const wholeRoster = await wholeResultCount(page);

  // -----------------------------------------------------------------------------------------
  // Narrow the whole result with one faceted filter, then with a search
  // -----------------------------------------------------------------------------------------

  await selectFacetValue(page, CONTACT_TYPE_FACET, PERSON_FACET_VALUE);
  await expect.poll(async () => wholeResultCount(page), { message: "The faceted filter is applied to the whole result rather than to the page on screen, so the size it states falls." }).toBeLessThan(wholeRoster);
  await expect(roster.getByRole("row", { name: CHURCH }), "A church is not a person, so the filter that admits persons only leaves it out.").toHaveCount(0);
  await expect(roster.getByRole("row", { name: RESTRICTED_PERSON }), "The person this journey reads is still in the result the filter admitted.").toBeVisible();

  await searchRoster(page, RESTRICTED_PERSON);
  await expect(roster.getByRole("row", { name: RESTRICTED_PERSON }), "The search and the filter are combined: the person matches both, so the row stands.").toBeVisible();
  await expect(roster.getByRole("row", { name: "Hana Nakamura" }), "A person the filter admits but the search excludes is not in the result, so every selected filter must match.").toHaveCount(0);
  await expect.poll(async () => wholeResultCount(page), { message: "Searching one name over the filtered result leaves exactly one record in the whole result." }).toBe(1);

  // -----------------------------------------------------------------------------------------
  // Read a restricted person's record
  // -----------------------------------------------------------------------------------------

  const restrictedAddress = await recordAddress(page, RESTRICTED_PERSON);
  await openRecord(page, RESTRICTED_PERSON);

  const restrictions = section(page, RESTRICTIONS_SECTION);
  await expect(restrictions.getByText(RESTRICTION_KIND), "The restriction is stated in its own words, so what must not happen is a recorded fact rather than a missing control.").toBeVisible();
  await expect(restrictions.getByText(RESTRICTION_DETAIL), "The restriction carries the detail the record holds, which is what a worker acts on.").toBeVisible();

  const contactMethods = section(page, CONTACT_METHODS_SECTION);
  await expect(contactMethods.getByText(RESTRICTED_PERSON_EMAIL, { exact: true }), "The method this record permits is offered.").toBeVisible();
  await expect(contactMethods.getByText(PERMITTED_METHOD), "The offered method states that this session may use it.").toBeVisible();
  await expect(contactMethods.getByText(RESTRICTED_NUMBER), "The refused number is not on the record at all: the refusal is a restriction recorded beside it, not a disabled control or a blank field.").toHaveCount(0);
  await expect(section(page, ACTIVITY_SECTION).getByText(NO_INTERACTION_RECORDED, { exact: true }), "A record nothing has happened on says so, rather than reading as an outage or as a zero.").toBeVisible();

  // -----------------------------------------------------------------------------------------
  // Return to the list the record was opened from
  // -----------------------------------------------------------------------------------------

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Partners", level: 1 }), "The roster is where the visit began, and returning re-reads it.").toBeVisible();
  await expect(page.getByLabel(SEARCH_LABEL, { exact: true }), "The search the worker typed survives the visit, because the list's query lives in its own address.").toHaveValue(RESTRICTED_PERSON);
  await expect(page.getByRole("button", { name: `${CONTACT_TYPE_FACET}, 1 selected` }), "The applied filter survives the visit for the same reason.").toBeVisible();

  // -----------------------------------------------------------------------------------------
  // Read the record the journey cares for, then the church
  // -----------------------------------------------------------------------------------------

  // The list is widened one filter at a time, and the whole result returns to the size it held before it.
  await removeFacetValue(page, CONTACT_TYPE_FACET, PERSON_FACET_VALUE);
  await clearSearch(page);
  await expect.poll(async () => wholeResultCount(page), { message: "With the filter and the search both removed, the list states the whole roster again." }).toBe(wholeRoster);
  await searchRoster(page, CARE_PERSON);
  const careAddress = await recordAddress(page, CARE_PERSON);
  await openRecord(page, CARE_PERSON);

  const seededActivity = await activityRows(page);
  expect(seededActivity.length, "The seeded record already holds one interaction, so 'exactly one' below is a comparison against real history.").toBe(1);
  expect(seededActivity[0], "The activity history states what the source recorded, in the record's own words.").toContain(SEEDED_INTERACTION_OUTCOME);

  const privateNotes = section(page, PRIVATE_NOTES_SECTION);
  await expect(privateNotes.getByText(CARE_PERSON_PRIVATE_NOTE, { exact: true }), "The worker's own note is read on the record it belongs to.").toBeVisible();
  await expect(privateNotes.getByText(PRIVATE_NOTE_AUDIENCE_LABEL), "The note states its audience where it is read, so private text is never mistaken for shared activity.").toBeVisible();

  await page.goBack();
  await expect(page.getByLabel(SEARCH_LABEL, { exact: true })).toHaveValue(CARE_PERSON);
  await searchRoster(page, CHURCH);
  await openRecord(page, CHURCH);

  await expect(page.getByText(CHURCH_KIND, { exact: true }).first(), "The church states its own record kind, which is a record kind no person shares.").toBeVisible();
  await expect(page.getByText(CARE_PERSON_PRIVATE_NOTE, { exact: false }), "The person's private note appears nowhere on the church's record: a shared name, address or email address is not a join between two records.").toHaveCount(0);
  await expect(page.getByText(SEEDED_INTERACTION_OUTCOME, { exact: false }), "What was recorded against the person is not recorded against the church, because activity belongs to the record it was written on.").toHaveCount(0);
  await expect(section(page, ACTIVITY_SECTION).getByText(NO_INTERACTION_RECORDED, { exact: true }), "The church's own record states that nothing has been recorded on it yet.").toBeVisible();

  await page.goBack();
  await expect(page.getByLabel(SEARCH_LABEL, { exact: true }), "Returning from the church restores the search that found it.").toHaveValue(CHURCH);
  // Two records that share nothing are addressed by their own opaque identifiers, never by a name, an email
  // address or a postal address: an address built from identifiable text would fail here.
  expect(restrictedAddress, "The two records this journey read are addressed separately, so neither address stands in for the other.").not.toBe(careAddress);
  expect(careAddress, "The record's address carries an opaque identifier rather than the person's email address.").not.toContain(CARE_PERSON_EMAIL);
  expect(restrictedAddress, "The restricted person's address carries an opaque identifier rather than the church's name.").not.toContain("Aidan");
});

test("an interaction whose acknowledgement is lost is recovered once, and a follow-up task the application refuses never sends it again", async ({ page }) => {
  await openRoster(page);
  await searchRoster(page, CARE_PERSON);
  await openRecord(page, CARE_PERSON);
  const before = await activityRows(page);
  expect(before.length, "The seeded record holds one interaction, which is the figure every count below is compared against.").toBe(1);

  // -----------------------------------------------------------------------------------------
  // Log the interaction while its acknowledgement is withheld
  // -----------------------------------------------------------------------------------------

  await armLostAcknowledgementOnInteraction(page);
  await openInteractionForm(page, CARE_PERSON);
  await fillLoggedInteraction(page);
  await page.getByRole("button", { name: SUBMIT_LABEL, exact: true }).click();

  const unconfirmed = receipt(page, "unknown");
  await expect(unconfirmed.getByRole("heading", { name: UNCONFIRMED_HEADING }), "A lost acknowledgement is reported as neither success nor failure, which is the only honest answer for a fate nobody knows.").toBeVisible();
  // The receipt offers exactly the two controls an unconfirmed outcome may offer, in that order: checking the
  // result, and replaying this same request. A third control that sent the work again would record it twice.
  const unconfirmedActions = unconfirmed.getByRole("button");
  await expect(unconfirmedActions, "An unconfirmed outcome offers two controls and no more.").toHaveCount(2);
  await expect(unconfirmedActions.nth(0)).toHaveText(CHECK_RESULT_LABEL);
  await expect(unconfirmedActions.nth(1)).toHaveText(RETRY_SAME_WORK_LABEL);
  await expect(page.getByRole("button", { name: RESEND_WORDING }), "Uncertainty never becomes a resend: nothing on this page sends the same work under a fresh identity.").toHaveCount(0);
  await expect(page.getByRole("button", { name: SUBMIT_LABEL, exact: true }), "While the result stands unconfirmed there is no control that submits the entry again.").toHaveCount(0);

  // -----------------------------------------------------------------------------------------
  // Recover the original result by its operation identity
  // -----------------------------------------------------------------------------------------

  await unconfirmedActions.nth(0).click();
  await expect(receipt(page, "alreadyAccepted").getByRole("heading", { name: ALREADY_SAVED_HEADING }), "Checking the result replays the same operation identity, so the service answers with the result it stored instead of recording the contact a second time.").toBeVisible();

  // -----------------------------------------------------------------------------------------
  // Create the follow-up task on the same form, and watch the application refuse it
  // -----------------------------------------------------------------------------------------

  await page.getByRole("radio", { name: TASK_INTENT_LABEL }).click();
  const taskTitle = page.getByRole("textbox", { name: TASK_TITLE_LABEL, exact: true });
  await taskTitle.fill(TITLE_TOO_LONG_TASK);
  await page.getByRole("button", { name: SAVE_TASK_LABEL, exact: true }).click();

  // The development runtime arms a failure on the calls it names, and creating a task is not one of them, so the
  // task that fails here is refused by the application itself for a title it really will not accept: real input
  // rather than a fabricated state. It proves the same property — the refusal keeps what was typed, and the
  // interaction already recorded is never sent again.
  await expect(page.getByRole("heading", { name: CHECK_THE_DETAILS_HEADING }), "The refused task reports its own outcome, separate from the interaction's.").toBeVisible();
  await expect(page.getByText(TITLE_TOO_LONG_MESSAGE).first(), "The refusal names the field to correct, in the transport's own words.").toBeVisible();
  await expect(taskTitle, "The caller's input is kept exactly as it was typed, so the work is recoverable rather than retyped.").toHaveValue(TITLE_TOO_LONG_TASK);
  await expect(receipt(page, "alreadyAccepted").getByRole("heading", { name: ALREADY_SAVED_HEADING }), "The interaction's own receipt is untouched: a failed task never re-sends the change it followed.").toBeVisible();

  await taskTitle.fill(FOLLOW_UP_TASK_TITLE);
  await page.getByRole("button", { name: SAVE_TASK_LABEL, exact: true }).click();
  await expect(receipt(page, "accepted").getByRole("heading", { name: SAVED_HEADING }), "The same work, corrected, is accepted as one task.").toBeVisible();

  // -----------------------------------------------------------------------------------------
  // Read the record back: the interaction was recorded exactly once
  // -----------------------------------------------------------------------------------------

  await clearArmedFailure(page);
  await page.getByRole("link", { name: BACK_TO_RECORD_LABEL }).click();
  await expect(page.getByRole("heading", { name: CARE_PERSON, level: 1 })).toBeVisible();

  const after = await activityRows(page);
  expect(after.length, "The interaction was recorded once: the withheld answer, the recovery and the refused task attempt left exactly one new activity row.").toBe(before.length + 1);
  expect(after.filter((row) => row.includes(LOGGED_OUTCOME)).length, "Exactly one row carries the outcome this journey recorded, so no replay recorded the contact twice.").toBe(1);
  expect(after.filter((row) => row.includes(SEEDED_INTERACTION_OUTCOME)).length, "The seeded interaction is still there once, unchanged by anything above.").toBe(1);

  const loggedRow = after.find((row) => row.includes(LOGGED_OUTCOME)) ?? "";
  expect(loggedRow, "The row states the day it happened, the outcome, the participant's role and the note it was given.").toContain(LOGGED_DAY);
  expect(loggedRow).toContain(LOGGED_ROLE);
  expect(loggedRow, "The note the interaction carries is labelled with its audience on the row itself, so its text is never read as a shared activity line.").toContain("Private");
  await expect(section(page, OPEN_TASKS_SECTION).getByText(FOLLOW_UP_TASK_TITLE, { exact: true }), "The follow-up task, once accepted, is open work on the record the interaction was logged against.").toBeVisible();
});

test("completing a task and creating the next one close work and change nothing about what was recorded", async ({ page }) => {
  await openRoster(page);
  await searchRoster(page, CARE_PERSON);
  const careAddress = await recordAddress(page, CARE_PERSON);
  await openRecord(page, CARE_PERSON);

  // -----------------------------------------------------------------------------------------
  // The contact method is a fact with a permission state, offered as a handoff that proves nothing
  // -----------------------------------------------------------------------------------------

  const contactMethods = section(page, CONTACT_METHODS_SECTION);
  await expect(contactMethods.getByText(CARE_PERSON_EMAIL, { exact: true }), "The record states the address this session may use.").toBeVisible();
  await expect(contactMethods.getByText(PERMITTED_METHOD)).toBeVisible();
  const emailHandoff = contactMethods.getByRole("link", { name: /^Email\b/u });
  await expect(emailHandoff, "The permitted address is offered as a handoff whose visible word names the app it opens, and whose hidden half names the address so the row's control is never a bare word.").toHaveAttribute("href", `mailto:${CARE_PERSON_EMAIL}`);
  await expect(emailHandoff, "The handoff keeps the record's own address as the only thing it would open.").toContainText(CARE_PERSON_EMAIL);

  const before = await activityRows(page);
  // Following the handoff hands the address to another program: this application is never asked to record anything,
  // which is why the activity history below is the evidence that a handoff is not an interaction.
  await emailHandoff.click();
  expect(await activityRows(page), "Following the mail handoff records nothing about contact: the activity history holds exactly the rows it held before the link was followed.").toEqual([...before]);

  // The person this journey cares for holds no number in the seed, so the dialler half of the same control is read on
  // a record that really holds one: the link carries that record's own text under the dialler scheme.
  await page.goto(ROSTER_HREF);
  await searchRoster(page, PHONE_PERSON);
  await openRecord(page, PHONE_PERSON);
  await expect(section(page, CONTACT_METHODS_SECTION).getByRole("link", { name: /^Call\b/u }), "A permitted number is offered as a dialler handoff carrying the number the record stores.").toHaveAttribute("href", `tel:${PHONE_PERSON_NUMBER}`);
  await page.goto(careAddress);
  await expect(page.getByRole("heading", { name: CARE_PERSON, level: 1 }), "The record this journey acts on is reopened, so the reading above did not move the worker off it.").toBeVisible();
  const openTasksBefore = await section(page, OPEN_TASKS_SECTION).getByRole("listitem").allInnerTexts();
  expect(
    openTasksBefore.some((item) => item.includes(SEEDED_TASK_TITLE)),
    "The seeded task is open work on this record before the journey completes it.",
  ).toBe(true);

  // -----------------------------------------------------------------------------------------
  // Complete the seeded task on the work surface
  // -----------------------------------------------------------------------------------------

  await page.goto(WORK_HREF);
  await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The five task lists are a destination of the shell's own navigation.").toBeVisible();
  await expectDevelopmentData(page);
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.getByRole("row", { name: SEEDED_TASK_TITLE }), "The seeded task is one row of the widest list.").toBeVisible();
  await page.getByRole("button", { name: `Actions for ${SEEDED_TASK_TITLE}` }).click();
  await page.getByRole("menuitem", { name: `Complete for ${SEEDED_TASK_TITLE}` }).click();
  await expect(page.locator('[data-slot="task-action-result"][data-outcome="accepted"]').getByRole("heading", { name: SAVED_HEADING }), "Completing a task is one accepted change, recorded in the durable result rather than announced in a toast.").toBeVisible();

  // -----------------------------------------------------------------------------------------
  // The activity history did not move, because closing work is not contact
  // -----------------------------------------------------------------------------------------

  await page.goto(careAddress);
  await expect(page.getByRole("heading", { name: CARE_PERSON, level: 1 })).toBeVisible();
  expect(await activityRows(page), "Completing a task records that the work was closed: the activity history holds exactly the rows it held before, in the same order.").toEqual([...before]);
  await expect(section(page, OPEN_TASKS_SECTION).getByText(SEEDED_TASK_TITLE, { exact: true }), "The completed task is no longer open work on the record it was linked to.").toHaveCount(0);

  // -----------------------------------------------------------------------------------------
  // Create the separate next task from the record itself
  // -----------------------------------------------------------------------------------------

  await page.getByRole("link", { name: CREATE_FOLLOW_UP_TASK_LABEL, exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Work", level: 1 }), "The record's own next-task action opens the work surface rather than a second task form.").toBeVisible();
  await page.getByRole("button", { name: NEW_TASK_LABEL, exact: true }).click();
  const composer = page.getByRole("region", { name: NEW_TASK_LABEL, exact: true });
  await expect(composer, "The task is created in the one composer that owns the task form.").toBeVisible();
  await expect(page.getByRole("combobox", { name: LINKED_RECORD_NAME }), "The record this task was created from is already stated as its link, so the work is filed against the same record.").toHaveValue(`partner:${partnerIdOf(careAddress)}`);
  await page.getByRole("textbox", { name: COMPOSER_TITLE_LABEL, exact: true }).fill(NEXT_TASK_TITLE);
  await page.getByRole("button", { name: CREATE_TASK_LABEL, exact: true }).click();
  await expect(receipt(page, "accepted").getByRole("heading", { name: SAVED_HEADING }), "A task needs only a title, and creating it is one accepted change with its own receipt.").toBeVisible();

  // -----------------------------------------------------------------------------------------
  // The next task is in Work and on the record, and the history is still untouched
  // -----------------------------------------------------------------------------------------

  await page.goto(WORK_HREF);
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.getByRole("row", { name: NEXT_TASK_TITLE }), "The task created from the record is the same task in the Work list: one task model feeds both.").toBeVisible();

  await page.goto(careAddress);
  await expect(page.getByRole("heading", { name: CARE_PERSON, level: 1 })).toBeVisible();
  await expect(section(page, OPEN_TASKS_SECTION).getByText(NEXT_TASK_TITLE, { exact: true }), "The next task is open work on the record it was created from.").toBeVisible();
  expect(await activityRows(page), "Creating the next piece of work records no interaction, so the activity history is still exactly what it was.").toEqual([...before]);
});
