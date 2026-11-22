/**
 * Criterion 15 — referral continuity.
 *
 * For a date-only introduction, Active ends at the exclusive endpoint (verified across a DST case); an
 * unknown or approximate date shows no deadline, no judgement and no Continue; the permitted Expired
 * history omits channels, notes and precise location; Continue ends at `A + N × 86,400 s`; a racing
 * second Continue yields no second successor; and Continue is absent while the worker-continuation
 * setting is off.
 *
 * **The scenario this file drives, from the deterministic seed.**
 * - The seeded established worker, in the Harbour youth ministry, holds six referral cycles: a
 *   date-only cycle still inside its New window (`referral-kenji-active`, introduced 12 November 2026,
 *   whose exclusive endpoint is 26 November 2026 at midnight in `Europe/London`), an already-ended
 *   date-only cycle (`referral-jo-expired`, introduced 4 May 2026), a consumed cycle and its continued
 *   successor (`referral-ruth-new` → `referral-ruth-continued`), an approximate introduction
 *   (`referral-hana-approximate`, 10 September 2026) and one that states no date at all
 *   (`referral-sara-unknown`).
 * - The scenario clock starts at the seed instant, `2026-11-20T00:00:00Z`, and is moved only through the
 *   development control at `/api/dev` — never by this file's own arithmetic. Every boundary is therefore
 *   judged by the application at an instant this file chose.
 * - The worker-continuation setting is a **scenario flag**, not a stored preference: the seed runs
 *   `baseline`, whose `continuationSetting` is off, and the scenario `continuation-on` is the world in
 *   which an ordinarily expired cycle offers its single continuation. Settings carries no control for it,
 *   so the setting is switched the way the application owns it — through the development control — and the
 *   offer is then read where the application publishes it: the envelope's `actions` and each row's
 *   `continuation` eligibility.
 *
 * **Why the two referral writes are driven through the application's own routes, and what that proves.**
 * The seed carries no window that crosses a daylight-saving transition, so the gap case is recorded here:
 * `POST /api/referrals` with the original date `2026-08-23` in `America/Santiago`, whose New window ends
 * at the first valid instant after a midnight that does not exist. And an expired cycle is answered by
 * `readReferral` in the narrow permitted projection whichever route reached it — the projection that
 * carries identity, source reference, status and permitted dates and no control of its own — so Continue
 * is submitted through `POST /api/referrals/continue`, the browser-facing transport of the one named
 * mutation, and its outcome is then read off the durable surfaces a person returns to: the lists, the
 * successor's own record and the figures that must not have moved.
 *
 * **What a fresh acceptance reports, and how the elapsed-second endpoint is proven.** `accepted` reports
 * the identifiers it created and changed, and no stored result; the stored result — the successor, its
 * endpoint and the elapsed seconds it was counted in — is what a replay of the *same* attempt answers. So
 * the arithmetic is proven by replaying the attempt identity, which is exactly the recovery the release
 * promises, and no figure is recomputed here.
 */
import type { Locator, Page } from "@playwright/test";

// The runner's own entry points: `test` carries the seeded-persona fixture and `expect` the web-first
// matchers, and `resetSeed` restores the deterministic world through the application's own control.
import { expect, resetSeed, test } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The addresses, identifiers and words this file asserts against
// ---------------------------------------------------------------------------------------------

/** The referral lists: the surface the three lists share. */
const REFERRALS_PATH = "/partners/referrals";

/** The detail route one cycle is read at, which is the same body the list opens. */
function referralDetailPath(referralId: string): string {
  return `${REFERRALS_PATH}/${encodeURIComponent(referralId)}`;
}

/** The lists' read and the one parameter that names a single cycle on the same route. */
const REFERRALS_READ_PATH = "/api/referrals";

function referralListReadPath(list: "active" | "incomplete-date" | "expired", search = ""): string {
  const params = new URLSearchParams({ list, pageSize: "200" });
  if (search !== "") {
    params.set("search", search);
  }
  return `${REFERRALS_READ_PATH}?${params.toString()}`;
}

function referralDetailReadPath(referralId: string): string {
  return `${REFERRALS_READ_PATH}?referralId=${encodeURIComponent(referralId)}`;
}

/** The development control's one address, the settings surface, and the record a continuation must leave alone. */
const DEV_CONTROL_PATH = "/api/dev";
const SETTINGS_PATH = "/settings";
const CONTINUE_PATH = "/api/referrals/continue";

/** The instant the seed lays down; a clock this file moved is returned to it before the test ends. */
const SEED_INSTANT = "2026-11-20T00:00:00Z";

/** The persistent development-data label the shell states on every surface. */
const DEVELOPMENT_LABEL = "Development data";

/** The seeded cycle whose introduction date is unknown: no date, so no window and no judgement. */
const UNKNOWN_CYCLE = { referralId: "referral-sara-unknown", displayName: "سارة الحسن" } as const;

/** The seeded cycle whose introduction date is approximate: a date is remembered, but it is not deadline-grade. */
const APPROXIMATE_CYCLE = { referralId: "referral-hana-approximate", displayName: "Hana Nakamura", introducedOn: "2026-09-10" } as const;

/**
 * The seeded date-only cycle that is still inside its New window at the seed instant.
 *
 * D is day one, so a fourteen-day window opened on 12 November 2026 includes 25 November and ends at the
 * first instant of 26 November in `Europe/London`, which is `2026-11-26T00:00:00Z` because the source
 * zone is on standard time by then.
 */
const DATE_ONLY_CYCLE = {
  referralId: "referral-kenji-active",
  displayName: "Kenji Nakamura",
  introducedOn: "2026-11-12",
  lastIncludedOn: "2026-11-25",
  nominalWording: "Active through 25 November 2026",
  endpoint: "2026-11-26T00:00:00Z",
  zone: "Europe/London",
} as const;

/** The seeded cycle whose window has already ended and which carries no successor: the one ordinary expiry Continue acts on. */
const EXPIRED_CYCLE = {
  referralId: "referral-jo-expired",
  displayName: "Jo Mbeki",
  sourceReference: "crm:intro-4411",
  introducedOn: "2026-05-04",
  /** The value the permitted history prints for the reference, in the shape the surface composes it. */
  reference: "crm:intro-4411",
} as const;

/**
 * The two facts a permitted Expired history may never carry, taken from the seeded partner behind the
 * expired cycle: the permitted contact channel and the body of the worker's private note. Neither is a
 * matching clue, and neither may appear in a history projection.
 */
const HIDDEN_EMAIL = "jo.mbeki@example.org";
const PRIVATE_NOTE_BODY = "Prefers a call after 6pm";

/** The scenario the worker-continuation setting lives in, and the value each scenario states. */
const CONTINUATION_ON_SCENARIO = "continuation-on";

/** Where the continuation is accepted, and what the release fixes for it: `A + 30 × 86,400` elapsed seconds. */
const CONTINUATION_ACCEPTED_AT = "2026-10-10T00:00:00Z";
const CONTINUATION_ELAPSED_SECONDS = 2_592_000;
const CONTINUATION_ENDPOINT = "2026-11-09T00:00:00Z";
/**
 * The counterfactual the elapsed-second rule rules out. Thirty *calendar* days added to 10 October in
 * `Europe/London` cross the end of daylight saving on 25 October, so a calendar-day reading would land an
 * hour later, at 09 November 01:00 local — `2026-11-09T01:00:00Z`. The stored endpoint must not be that.
 */
const CALENDAR_DAY_COUNTERFACTUAL = "2026-11-09T01:00:00Z";

/** The identifier the service derives for a cycle's single successor: the predecessor's id, suffixed. */
const CONTINUED_CYCLE_ID = `${EXPIRED_CYCLE.referralId}-continued`;

/** The introduction recorded for the daylight-saving case: one date, one precision, one declared zone. */
const DST_INTRODUCTION = {
  date: "2026-08-23",
  zone: "America/Santiago",
  sourceReference: { system: "crm", reference: "intro-dst-gap-shift" },
} as const;

/**
 * What the gap at local midnight resolves to. `America/Santiago` starts daylight saving at 00:00 on
 * Sunday 6 September 2026, so that wall time does not exist: the window's exclusive endpoint is the first
 * valid instant after it, 01:00 (−03) — `2026-09-06T04:00:00Z` — and the calendar wording, which names the
 * last included day, no longer matches the instant it resolved to.
 */
const DST_ENDPOINT = "2026-09-06T04:00:00Z";
const DST_LAST_INCLUDED_ON = "2026-09-05";
const DST_NOMINAL_WORDING = "Active through 5 September 2026";
const DST_INSIDE_WINDOW = "2026-09-01T00:00:00Z";
const DST_LAST_SECOND_INSIDE = "2026-09-06T03:59:59Z";

/** The display time zone this file switches to, proving a reader's own zone cannot move a resolved endpoint. */
const OTHER_DISPLAY_ZONE = "Asia/Tokyo";

/**
 * The family's own words, quoted from `features/referrals/copy.ts` and `features/coaching/copy.ts`'s sibling
 * modules rather than imported: a spec asserts what the interface says, so it states the sentence it
 * expects to read and fails when the wording a person sees changes.
 */
const COPY = {
  introductionHeading: "Original introduction",
  introducedOnLabel: "Original introduction date",
  precisionLabel: "How precisely is this date known?",
  entryTimeLabel: "Entered in this application",
  entryTimeNote: "Entry time is never shown as the introduction date, and a late entry does not start the window again.",
  noDeadline: "Without a known introduction date there is no deadline, no Active or Expired judgement and no Continue action; this referral is shown exactly as far as its evidence carries.",
  precisionUnknownLabel: "Unknown",
  precisionUnknownHint: "No date is established for this introduction, so none is stored and none is implied.",
  precisionApproximateLabel: "Approximate",
  precisionApproximateHint: "Recorded as it was remembered. An approximation is never turned into a precise date, so no deadline is derived from it.",
  statusIncomplete: "Incomplete date",
  statusActive: "Active",
  statusExpired: "Expired",
  window: "Window",
  newWindow: "New window",
  noWindowEnd: "No window end",
  calendarVsResolved: "Calendar wording and resolved end",
  nominalLabel: "Dates as written",
  resolvedLabel: "When the window ends",
  disagreementNote: "The calendar wording and the resolved moment disagree here. Both are shown: the resolved moment is what decides whether the window is Active or Expired, and the wording stands as it was written rather than being rewritten to match.",
  endpointResolvedOnce: "The end is resolved once and kept, so changing where you are or how dates are displayed does not move it.",
  continueHeading: "Continue is not offered",
  continueLabel: "Continue this referral",
  continueNotExpired: "This referral's window has not ended, so there is nothing to continue.",
  continueNoPrecision: "The introduction date is not precise enough to have had a window, so there is nothing to continue.",
  continueSettingOff: "Worker continuation is off, so an ordinarily expired referral offers no Continue action.",
  expiredHistoryHeading: "Permitted Expired history",
  expiredPermission: "This list shows identity, source reference, status and permitted dates only.",
  expiredReadOnly: "Nothing here can be changed. A permitted history is read-only, and the referral it describes is kept where it belongs.",
  expiredAbsentHeading: "Not included here",
  expiredNoMatchingHint: "A search here matches only the facts this list is permitted to show. No hidden field is ever used as a matching clue, so a search that finds nothing has told you nothing about what was withheld.",
  searchEmptyTitle: "No referral matches this search",
  continuedWindow: "Continued window",
  continuedFrom: "Continued from",
  elapsedNotCalendar: "This window is measured in elapsed seconds rather than calendar days, so a change of clocks neither lengthens nor shortens it.",
  oneSuccessor: "A cycle carries at most one continuation, so continuing it once is the whole of what it offers.",
} as const;

/** The five facts a permitted Expired history names as withheld, each with the label the surface prints. */
const ABSENT_FACTS = ["Contact details", "What the referrer said", "Precise location", "Notes", "Financial information"] as const;

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

/** A list a capture depends on, refusing anything else with the path it looked at. */
function arrayAt(value: unknown, path: readonly string[], what: string): readonly unknown[] {
  const found = fieldAt(value, ...path);
  if (!Array.isArray(found)) {
    throw new Error(`${what} is not a list at ${path.join(".")} of the answer this file read: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** The one outcome a mutation answered with, which is the only member that describes what happened. */
function outcomeOf(body: unknown): string {
  return stringAt(body, ["outcome"], "A mutation's outcome");
}

/** The identifier a caller mints for one attempt: the identity every replay of that attempt is recognised by. */
function newAttemptId(): string {
  return crypto.randomUUID();
}

/**
 * The read envelope a referral read answered with.
 *
 * A referral read answers either an envelope or the read's own refusal — `denied`, `unavailable` — and a
 * refusal is not a body any assertion below can compare, so it is reported as the failure it would
 * otherwise disguise: an empty roster, a missing date or a zero count that the application never stated.
 */
function envelopeOf(body: unknown, what: string): JsonRecord {
  const refusal = fieldAt(body, "outcome");
  if (typeof refusal === "string") {
    throw new Error(`${what} was refused with the ${refusal} outcome rather than answered from the caller's own scope: ${JSON.stringify(body).slice(0, 400)}`);
  }
  for (const member of ["scope", "revision", "data", "actions", "asOf"]) {
    if (!Object.hasOwn(isRecord(body) ? body : {}, member)) {
      throw new Error(`${what} did not answer a read envelope: it carries no ${member}. ${JSON.stringify(body).slice(0, 400)}`);
    }
  }
  return body as JsonRecord;
}

/** The names of the actions an envelope publishes, so an offer is read where the application states it. */
function actionNames(envelope: JsonRecord): readonly string[] {
  return arrayAt(envelope, ["actions"], "The envelope's actions").map((action) => stringAt(action, ["name"], "An action's name"));
}

/** Whether the envelope publishes one named action as available, which is how the read offers work. */
function actionOffered(envelope: JsonRecord, name: string): boolean {
  return arrayAt(envelope, ["actions"], "The envelope's actions").some((action) => fieldAt(action, "name") === name && fieldAt(action, "available") === true);
}

// ---------------------------------------------------------------------------------------------
// The development controls: the scenario and the clock
// ---------------------------------------------------------------------------------------------

/** What one session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/** Reads this session's development state, immediately before each control so no revision it presents is stale. */
async function readDevState(page: Page): Promise<DevState> {
  const answer = await page.request.get(DEV_CONTROL_PATH);
  const body = await jsonOf(answer, "GET /api/dev");
  const scope = fieldAt(body, "scope");
  if (!isRecord(scope)) {
    throw new Error(`GET /api/dev answered without the scope a development control runs under: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { scope, revision: stringAt(body, ["revision"], "The development state's revision") };
}

/** Operates exactly one named development control and requires it to have been applied. */
async function operateDevControl(page: Page, action: string, payload: JsonRecord): Promise<unknown> {
  const state = await readDevState(page);
  const answer = await page.request.post(DEV_CONTROL_PATH, {
    data: { action, operationId: newAttemptId(), scope: state.scope, expectedRevision: state.revision, payload },
  });
  const body = await jsonOf(answer, `POST /api/dev ${action}`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "unchanged") {
    throw new Error(
      `The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A spec that could not move the clock or select the scenario it names would assert against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`,
    );
  }
  return body;
}

/** Moves this session's scenario clock to one instant, which is how an exact boundary is reached without waiting. */
async function setClock(page: Page, instant: string): Promise<void> {
  await operateDevControl(page, "setClock", { offsetIso: instant });
}

/** Selects the seeded world this session runs in: the setting the referral journey is under is one of its flags. */
async function switchScenario(page: Page, scenarioId: string): Promise<void> {
  await operateDevControl(page, "setScenario", { scenarioId });
}

// ---------------------------------------------------------------------------------------------
// The referral reads and the two named changes
// ---------------------------------------------------------------------------------------------

/** One cycle's detail, read from the caller's own scope, with its envelope as the assertions compare it. */
async function readReferral(page: Page, referralId: string): Promise<JsonRecord> {
  const answer = await page.request.get(referralDetailReadPath(referralId));
  return envelopeOf(await jsonOf(answer, `GET /api/referrals?referralId=${referralId}`), `The read of ${referralId}`);
}

/** One page of one referral list, read over the whole authorised result. */
async function readReferralList(page: Page, list: "active" | "incomplete-date" | "expired", search = ""): Promise<JsonRecord> {
  const answer = await page.request.get(referralListReadPath(list, search));
  return envelopeOf(await jsonOf(answer, `GET /api/referrals?list=${list}`), `The ${list} referral list`);
}

/** The whole-result count one list states, which is the count of the authorised result rather than of a page. */
async function listTotal(envelope: JsonRecord): Promise<number> {
  return numberOf(envelope, ["data", "total"], "The list's whole-result count");
}

/** One reported outcome, kept with its body so both the closed word and the members it carried are asserted. */
interface ReportedOutcome {
  readonly body: JsonRecord;
  readonly outcome: string;
}

/**
 * Submits the one named continuation for a cycle, through the browser-facing route the application serves
 * it on, and reports whichever of the eight outcomes answered.
 *
 * The attempt identity is the caller's: replaying it is what recovers an acknowledgement that was lost, so
 * it is passed in rather than minted here.
 */
async function submitContinue(page: Page, envelope: JsonRecord, referralId: string, operationId: string): Promise<ReportedOutcome> {
  const scope = fieldAt(envelope, "scope");
  if (!isRecord(scope)) {
    throw new Error(`The read of ${referralId} carried no scope, so the change it would authorise has no authority to present: ${JSON.stringify(envelope).slice(0, 400)}`);
  }
  const answer = await page.request.post(CONTINUE_PATH, {
    data: { operationId, scope, expectedRevision: stringAt(envelope, ["revision"], "The cycle's revision"), payload: { referralId } },
  });
  const body = await jsonOf(answer, `POST ${CONTINUE_PATH}`);
  if (!isRecord(body)) {
    throw new Error(`POST ${CONTINUE_PATH} did not answer an object: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { body, outcome: outcomeOf(body) };
}

/**
 * Records one original introduction date through the application's own route, and answers the identifier
 * the service derived for the cycle it created.
 *
 * The two facts a window is counted from — the date and the zone it is known in — are the whole payload:
 * every other value a cycle carries is resolved by the service from them, which is why the gap case below
 * proves anything at all.
 */
async function recordIntroduction(page: Page, payload: JsonRecord): Promise<string> {
  const list = await readReferralList(page, "active");
  const scope = fieldAt(list, "scope");
  if (!isRecord(scope)) {
    throw new Error(`The referral list read carried no scope, so an introduction cannot be recorded under it: ${JSON.stringify(list).slice(0, 400)}`);
  }
  const answer = await page.request.post(REFERRALS_READ_PATH, {
    data: { operationId: newAttemptId(), scope, expectedRevision: stringAt(list, ["revision"], "The referral list's revision"), payload },
  });
  const body = await jsonOf(answer, `POST ${REFERRALS_READ_PATH}`);
  expect(outcomeOf(body), `Recording the introduction ${JSON.stringify(payload)} was refused: ${JSON.stringify(body).slice(0, 400)}`).toBe("accepted");
  return stringAt(body, ["created", "0"], "The cycle the introduction created");
}

// ---------------------------------------------------------------------------------------------
// The figures a continuation must leave alone
// ---------------------------------------------------------------------------------------------

/** What one partner record states about the work and the activity attached to it, as counts. */
interface PartnerFigures {
  /** The open tasks the record carries: a continuation creates no follow-up work. */
  readonly openTasks: number;
  /** The interactions recorded against the partner: a continuation credits no contact and no conversation. */
  readonly interactions: number;
}

/**
 * Reads the work and activity a continuation must not change.
 *
 * Both are read through the partner's own record, because they are the two facts a continuation could
 * plausibly have created — a duplicate follow-up task, or an interaction credited from the act of
 * continuing — and neither is derived here: each is the count the application states.
 */
async function readPartnerFigures(page: Page, partnerId: string): Promise<PartnerFigures> {
  const recordAnswer = await page.request.get(`/api/partners/${encodeURIComponent(partnerId)}?job=record`);
  const record = envelopeOf(await jsonOf(recordAnswer, "The partner record read"), "The partner's own record");
  const interactionsAnswer = await page.request.get(`/api/partners/${encodeURIComponent(partnerId)}?job=interactions`);
  const interactions = envelopeOf(await jsonOf(interactionsAnswer, "The partner activity read"), "The partner's recorded activity");
  return { openTasks: arrayAt(record, ["data", "openTasks"], "The record's open tasks").length, interactions: numberOf(interactions, ["data", "total"], "The partner's interaction count") };
}

/**
 * Asserts one region states a status word as text.
 *
 * The word is the label itself rather than a colour, so this is the assertion that a state can be read
 * without seeing the badge it is printed in.
 */
async function expectStatusWord(scope: Locator, word: string): Promise<void> {
  await expect(scope.getByText(word, { exact: true }).first()).toBeVisible();
}

// ---------------------------------------------------------------------------------------------
// Precision: an introduction date that cannot carry a deadline carries none
// ---------------------------------------------------------------------------------------------

test("an unknown introduction date states no date, so it carries no deadline, no judgement and no Continue", async ({ page }) => {
  // The shell states the development-data label on every surface, and this journey reads a real record:
  // one assertion of it, on the first surface this file opens, is what keeps the whole file honest.
  await page.goto(`${REFERRALS_PATH}?list=incomplete-date`);
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true })).toBeVisible();

  // The list holds the two introductions whose evidence cannot support a deadline, and it says so once for
  // the whole view rather than per row.
  await expect(page.getByRole("heading", { name: COPY.statusIncomplete, level: 2 })).toBeVisible();
  await expect(page.getByText(COPY.noDeadline)).toBeVisible();

  await page.goto(referralDetailPath(UNKNOWN_CYCLE.referralId));

  // The identity is the cycle's own approved name, rendered in its own direction inside the page heading.
  await expect(page.getByRole("heading", { name: UNKNOWN_CYCLE.displayName, level: 1 })).toBeVisible();

  // No date is stored, so the original introduction date is the shared "unknown" value state and the
  // precision is stated as unknown rather than inferred from anything else on the record.
  const introduction = page.locator('[data-slot="referral-detail-introduction"]');
  await expect(introduction.getByRole("heading", { name: COPY.introductionHeading })).toBeVisible();
  await expect(introduction.getByText(COPY.introducedOnLabel)).toBeVisible();
  await expect(introduction.getByText(COPY.precisionLabel)).toBeVisible();
  await expect(introduction.getByText(COPY.precisionUnknownLabel, { exact: true }).first()).toBeVisible();
  await expect(introduction.getByText(COPY.precisionUnknownHint)).toBeVisible();

  // Entry time is a fact of its own and is never shown in the introduction date's place: the read carries
  // none, so it is stated as not carried, beside the sentence that says why the two are different facts.
  await expect(introduction.getByText(COPY.entryTimeLabel)).toBeVisible();
  await expect(introduction.getByText(COPY.entryTimeNote)).toBeVisible();

  // No Active or Expired judgement is made, because no window exists to make one about. The status word is
  // the family's third word for exactly this state, and no badge in the record says Active or Expired.
  const status = page.locator('[data-slot="referral-detail-status"]');
  await expectStatusWord(status, COPY.statusIncomplete);
  await expect(status.getByText(COPY.statusActive, { exact: true })).toHaveCount(0);
  await expect(status.getByText(COPY.statusExpired, { exact: true })).toHaveCount(0);

  // The window panel states the rule once, in the family's own words, and shows no endpoint at all.
  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.window })).toBeVisible();
  await expect(windowPanel.getByText(COPY.noDeadline)).toBeVisible();
  await expect(windowPanel.getByText(COPY.precisionUnknownHint)).toBeVisible();
  await expect(page.getByText(COPY.noWindowEnd)).toBeVisible();

  // No deadline and no Continue: the offer is absent, not disabled, and the surface states the condition.
  await expect(page.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);
  const notOffered = page.locator('[data-slot="continue-referral-unavailable"]');
  await expect(notOffered.getByRole("heading", { name: COPY.continueHeading })).toBeVisible();
  await expect(notOffered.getByText(COPY.continueNoPrecision)).toBeVisible();

  // The read publishes the same withholding: no continuation is available on the cycle, and the record
  // offers no action at all, so the absence above is the application's own answer rather than a rendering
  // accident.
  const detail = await readReferral(page, UNKNOWN_CYCLE.referralId);
  expect(fieldAt(detail, "data", "referral", "datePrecision")).toBe("unknown");
  expect(fieldAt(detail, "data", "referral", "originalIntroductionOn")).toBeNull();
  expect(fieldAt(detail, "data", "referral", "windowEnd")).toBeNull();
  expect(fieldAt(detail, "data", "referral", "deadline")).toBeNull();
  expect(fieldAt(detail, "data", "referral", "continuation", "available")).toBe(false);
  expect(actionOffered(detail, "continueReferral")).toBe(false);
});

test("an approximate introduction date is shown as approximate and is never turned into a deadline", async ({ page }) => {
  await page.goto(referralDetailPath(APPROXIMATE_CYCLE.referralId));
  await expect(page.getByRole("heading", { name: APPROXIMATE_CYCLE.displayName, level: 1 })).toBeVisible();

  // The remembered date is stated as it was recorded — the day the introduction was remembered to have
  // happened — and the badge beside it says how precisely that is known, so no reader mistakes it for a
  // measured date.
  const introduction = page.locator('[data-slot="referral-detail-introduction"]');
  await expect(introduction.getByText(APPROXIMATE_CYCLE.introducedOn, { exact: true })).toBeVisible();
  await expect(introduction.getByText(COPY.precisionApproximateLabel, { exact: true }).first()).toBeVisible();
  await expect(introduction.getByText(COPY.precisionApproximateHint)).toBeVisible();
  await expect(introduction.getByText(COPY.entryTimeLabel)).toBeVisible();
  await expect(introduction.getByText(COPY.entryTimeNote)).toBeVisible();

  const status = page.locator('[data-slot="referral-detail-status"]');
  await expectStatusWord(status, COPY.statusIncomplete);
  await expect(status.getByText(COPY.statusActive, { exact: true })).toHaveCount(0);
  await expect(status.getByText(COPY.statusExpired, { exact: true })).toHaveCount(0);

  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.window })).toBeVisible();
  await expect(windowPanel.getByText(COPY.noDeadline)).toBeVisible();
  await expect(windowPanel.getByText(COPY.precisionApproximateHint)).toBeVisible();
  // Nothing on this record is presented as an instant: the approximation produced no calendar wording and
  // no resolved end, which is the difference between a date that is known and one that is only remembered.
  await expect(windowPanel.getByText(COPY.calendarVsResolved)).toHaveCount(0);
  await expect(page.getByText(COPY.noWindowEnd)).toBeVisible();

  await expect(page.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);
  await expect(page.locator('[data-slot="continue-referral-unavailable"]').getByText(COPY.continueNoPrecision)).toBeVisible();

  const detail = await readReferral(page, APPROXIMATE_CYCLE.referralId);
  expect(fieldAt(detail, "data", "referral", "datePrecision")).toBe("approximate");
  expect(fieldAt(detail, "data", "referral", "originalIntroductionOn")).toBe(APPROXIMATE_CYCLE.introducedOn);
  // The window the evidence cannot support is absent from the cycle itself, not merely withheld by the
  // surface: an approximate date stores no start and no end.
  expect(fieldAt(detail, "data", "referral", "windowStart")).toBeNull();
  expect(fieldAt(detail, "data", "referral", "windowEnd")).toBeNull();
  expect(fieldAt(detail, "data", "referral", "status", "status")).toBe("no-deadline");
  expect(fieldAt(detail, "data", "referral", "continuation", "available")).toBe(false);
});

// ---------------------------------------------------------------------------------------------
// The exclusive endpoint: Active ends at it, and an instant before it is still Active
// ---------------------------------------------------------------------------------------------

/** The caption a list states its whole result with, in the shape `features/referrals/copy.ts` composes it. */
function countCaption(heading: string, total: number): string {
  return `${heading}: ${String(total)} ${total === 1 ? "referral" : "referrals"} in the whole result.`;
}

test("the seeded date-only cycle is Active until its exclusive endpoint and Expired at it", async ({ page }) => {
  // Inside the window the resolved endpoint stands beside the calendar wording it was read from, and the
  // two agree, so the disagreement note is absent.
  await page.goto(referralDetailPath(DATE_ONLY_CYCLE.referralId));
  await expect(page.getByRole("heading", { name: DATE_ONLY_CYCLE.displayName, level: 1 })).toBeVisible();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);

  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.newWindow })).toBeVisible();
  await expect(windowPanel.getByText(DATE_ONLY_CYCLE.nominalWording)).toBeVisible();
  await expect(windowPanel.getByText(`The introduction date, ${DATE_ONLY_CYCLE.introducedOn}, is day one.`)).toBeVisible();
  await expect(windowPanel.getByText(`The last date the window includes is ${DATE_ONLY_CYCLE.lastIncludedOn}.`)).toBeVisible();
  await expect(windowPanel.getByText(DATE_ONLY_CYCLE.endpoint, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(DATE_ONLY_CYCLE.zone, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(COPY.endpointResolvedOnce)).toBeVisible();
  await expect(windowPanel.getByText(COPY.disagreementNote)).toHaveCount(0);

  // One second before the endpoint the whole of the last included day is still inside the window.
  await setClock(page, "2026-11-25T23:59:59Z");
  await page.reload();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  await expect(page.locator('[data-slot="referral-window-panel"]').getByText(DATE_ONLY_CYCLE.endpoint, { exact: true }).first()).toBeVisible();

  // At the endpoint itself the cycle is Expired rather than Active, and it is answered in the narrow
  // permitted projection, which states the dates it may show and no record beyond them.
  await setClock(page, DATE_ONLY_CYCLE.endpoint);
  await page.reload();
  const expiredCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: COPY.expiredHistoryHeading }) });
  await expect(expiredCard).toBeVisible();
  await expect(expiredCard.getByText(COPY.statusExpired, { exact: true }).first()).toBeVisible();
  await expect(expiredCard.getByText(DATE_ONLY_CYCLE.endpoint, { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-slot="referral-detail"]')).toHaveCount(0);

  // The read drew the same line, in the same direction: expired at equality, not a moment later.
  const atEndpoint = await readReferral(page, DATE_ONLY_CYCLE.referralId);
  expect(fieldAt(atEndpoint, "data", "view")).toBe("expired-history");
  expect(fieldAt(atEndpoint, "data", "referral", "status", "status")).toBe("expired");
  expect(fieldAt(atEndpoint, "data", "referral", "windowEnd")).toBe(DATE_ONLY_CYCLE.endpoint);

  await setClock(page, SEED_INSTANT);
});

// ---------------------------------------------------------------------------------------------
// The daylight-saving case: a midday that does not exist, and a resolved end that stays put
// ---------------------------------------------------------------------------------------------

test("a New window across a daylight-saving transition ends at the first valid instant after the gap, and that end does not move", async ({ page }) => {
  await setClock(page, DST_INSIDE_WINDOW);
  // The introduction is recorded through the application's own route: one original date, its precision and
  // the zone it is known in. Everything else the window is counted from is resolved by the service.
  const referralId = await recordIntroduction(page, {
    partnerId: "partner-kenji-nakamura",
    originalIntroductionOn: DST_INTRODUCTION.date,
    datePrecision: "date",
    sourceZone: DST_INTRODUCTION.zone,
    sourceReference: DST_INTRODUCTION.sourceReference,
  });

  const detail = await readReferral(page, referralId);
  const deadline = ["data", "referral", "deadline"] as const;
  expect(fieldAt(detail, ...deadline, "end")).toBe(DST_ENDPOINT);
  expect(fieldAt(detail, ...deadline, "nominal", "lastIncludedOn")).toBe(DST_LAST_INCLUDED_ON);
  expect(fieldAt(detail, ...deadline, "nominal", "wording")).toBe(DST_NOMINAL_WORDING);
  // The two facts the gap produces: how midnight resolved, and that the calendar wording no longer matches
  // the instant it resolved to.
  expect(fieldAt(detail, ...deadline, "nominal", "resolution")).toBe("gap-shifted");
  expect(fieldAt(detail, ...deadline, "nominal", "disagreesWithResolved")).toBe(true);
  expect(fieldAt(detail, "data", "referral", "status", "status")).toBe("active");
  expect(fieldAt(detail, "data", "referral", "sourceZone")).toBe(DST_INTRODUCTION.zone);

  // The surface states both facts under their own labels: the calendar wording as written, and the resolved
  // moment that decides where the window stands — never one rewritten to look like the other.
  await page.goto(referralDetailPath(referralId));
  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.newWindow })).toBeVisible();
  await expect(windowPanel.getByRole("heading", { name: COPY.calendarVsResolved })).toBeVisible();
  await expect(windowPanel.getByText(COPY.nominalLabel)).toBeVisible();
  await expect(windowPanel.getByText(DST_LAST_INCLUDED_ON, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(DST_NOMINAL_WORDING)).toBeVisible();
  await expect(windowPanel.getByText(COPY.resolvedLabel)).toBeVisible();
  await expect(windowPanel.getByText(DST_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(DST_INTRODUCTION.zone, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(COPY.disagreementNote)).toBeVisible();
  await expect(windowPanel.getByText(COPY.endpointResolvedOnce)).toBeVisible();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);

  // At exactly the resolved endpoint — 01:00 local, the first instant that exists that day — the cycle is
  // Expired, so the gap's resolution is what the boundary is judged against.
  await setClock(page, DST_ENDPOINT);
  await page.reload();
  const expiredCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: COPY.expiredHistoryHeading }) });
  await expect(expiredCard).toBeVisible();
  await expect(expiredCard.getByText(COPY.statusExpired, { exact: true }).first()).toBeVisible();
  await expect(expiredCard.getByText(DST_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-slot="referral-detail"]')).toHaveCount(0);

  // One second earlier it is Active again, and the endpoint it is judged against has not shifted.
  await setClock(page, DST_LAST_SECOND_INSIDE);
  await page.reload();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  const revivedPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(revivedPanel.getByText(DST_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(revivedPanel.getByText(DST_NOMINAL_WORDING)).toBeVisible();

  // A reader's own display zone is a presentation choice, and it moves nothing: the resolved endpoint, the
  // zone it was resolved in and the calendar wording are the same after the change.
  await page.goto(SETTINGS_PATH);
  await page.getByLabel("Display time zone").selectOption(OTHER_DISPLAY_ZONE);
  await expect(page.getByText(/no deadline moves/u)).toBeVisible();
  await page.goto(referralDetailPath(referralId));
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  const unchangedPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(unchangedPanel.getByText(DST_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(unchangedPanel.getByText(DST_INTRODUCTION.zone, { exact: true }).first()).toBeVisible();
  await expect(unchangedPanel.getByText(DST_NOMINAL_WORDING)).toBeVisible();
  const afterTravelling = await readReferral(page, referralId);
  expect(fieldAt(afterTravelling, ...deadline, "end")).toBe(DST_ENDPOINT);
  expect(fieldAt(afterTravelling, ...deadline, "nominal", "lastIncludedOn")).toBe(DST_LAST_INCLUDED_ON);

  await setClock(page, SEED_INSTANT);
});

// ---------------------------------------------------------------------------------------------
// The permitted Expired history: a narrow permission over history, not access to the record
// ---------------------------------------------------------------------------------------------

test("the permitted Expired history carries identity, source reference, status and permitted dates only", async ({ page }) => {
  await page.goto(`${REFERRALS_PATH}?list=expired`);
  const list = page.locator('[data-slot="referral-list"]');
  const read = await readReferralList(page, "expired");
  const total = await listTotal(read);
  expect(total).toBeGreaterThan(0);
  await expect(list.getByText(countCaption(COPY.expiredHistoryHeading, total))).toBeVisible();

  // The permission is stated before the facts it covers, so nothing below it is read as wider access, and
  // the page says outright that it cannot be changed.
  // One permission card accompanies each permitted record, so the statement is read once rather than counted.
  await expect(list.getByText(COPY.expiredPermission).first()).toBeVisible();
  await expect(list.getByText(COPY.expiredReadOnly).first()).toBeVisible();

  // The approved identity, the source reference the source issued, and the status: the three facts this
  // permission is allowed to recognise.
  await expect(list.getByRole("heading", { name: EXPIRED_CYCLE.displayName })).toBeVisible();
  await expect(list.getByText(EXPIRED_CYCLE.reference, { exact: true }).first()).toBeVisible();
  await expect(list.getByText(COPY.statusExpired, { exact: true }).first()).toBeVisible();

  // Every fact the permission withholds is named, with the reason it is absent, rather than left as a gap a
  // reader could mistake for missing data.
  await expect(list.getByText(COPY.expiredAbsentHeading).first()).toBeVisible();
  for (const absent of ABSENT_FACTS) {
    await expect(list.getByText(absent, { exact: true }).first()).toBeVisible();
  }

  // And none of them is present in substance: no contact channel, no note body, no amount, no currency.
  await expect(list).not.toContainText(HIDDEN_EMAIL);
  await expect(list).not.toContainText(PRIVATE_NOTE_BODY);
  for (const currency of ["USD", "EUR", "KWD", "JPY"]) {
    await expect(list).not.toContainText(currency);
  }

  // A hidden field is never a matching clue: searching the permitted history for the address the record
  // carries finds nothing, and the surface says that finding nothing has told the searcher nothing.
  const search = list.getByRole("searchbox");
  await search.fill(HIDDEN_EMAIL);
  await search.press("Enter");
  await expect(list.getByText(COPY.searchEmptyTitle)).toBeVisible();
  await expect(list.getByText(COPY.expiredNoMatchingHint)).toBeVisible();
  await expect(list.getByText(countCaption(COPY.expiredHistoryHeading, 0))).toBeVisible();
  expect(await listTotal(await readReferralList(page, "expired", HIDDEN_EMAIL))).toBe(0);

  // One expired cycle's own route answers the same narrow projection, and no control of any kind is offered
  // on it: a permission over history never reopens the record, and it never offers an action.
  await page.goto(referralDetailPath(EXPIRED_CYCLE.referralId));
  await expect(page.getByRole("heading", { name: COPY.expiredHistoryHeading, level: 2 })).toBeVisible();
  await expect(page.getByText(COPY.expiredPermission)).toBeVisible();
  await expect(page.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);
  await expect(page.getByText(EXPIRED_CYCLE.reference, { exact: true }).first()).toBeVisible();

  const detail = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(detail, "data", "view")).toBe("expired-history");
  const projected = fieldAt(detail, "data", "referral");
  const projectedKeys = Object.keys(isRecord(projected) ? projected : {});
  // The projection is narrower than the record by construction: not one of these members travels with it,
  // so no hidden field could be used as a clue even by a surface that tried to.
  for (const withheld of ["contactMethods", "notes", "referrerContext", "preciseLocation", "partnerId", "supportHistory"]) {
    expect(projectedKeys, `The permitted projection carries ${withheld}, which is a wider permission than history.`).not.toContain(withheld);
  }
  expect(projectedKeys).toContain("partnerDisplayName");
  expect(projectedKeys).toContain("sourceReference");
  expect(projectedKeys).toContain("windowEnd");
});


// ---------------------------------------------------------------------------------------------
// The worker-continuation setting: absent while it is off, offered once it is on
// ---------------------------------------------------------------------------------------------

test("Continue is absent while the worker-continuation setting is off, and the same expired cycle offers it once the setting is on", async ({ page }) => {
  // The setting off: the cycle is eligible in every other respect — it is a new cycle, ordinarily expired,
  // with a known date and no successor — and it still offers nothing, because the setting is a capability
  // this session does not hold rather than a reason withheld from one cycle.
  const off = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(off, "data", "view")).toBe("expired-history");
  expect(fieldAt(off, "data", "continuationPolicy", "setting")).toBe("off");
  expect(fieldAt(off, "data", "referral", "continuation", "available")).toBe(false);
  expect(String(fieldAt(off, "data", "referral", "continuation", "reason"))).toBe(COPY.continueSettingOff);
  expect(actionNames(off)).toEqual([]);
  expect(actionOffered(off, "continueReferral")).toBe(false);

  // A submission in this world is refused as a capability the session does not hold, and the refusal names
  // the capability and nothing about the cycle.
  const refused = await submitContinue(page, off, EXPIRED_CYCLE.referralId, newAttemptId());
  expect(refused.outcome).toBe("denied");
  expect(fieldAt(refused.body, "reasonCode")).toBe("capability-absent");
  expect(Object.keys(refused.body).sort()).toEqual(["operationId", "outcome", "reasonCode"]);

  // Nothing was created by the refusal: no successor exists, and the list the worker reads states the same
  // single expired cycle it held before the attempt.
  const notCreated = await page.request.get(referralDetailReadPath(CONTINUED_CYCLE_ID));
  expect(fieldAt(await jsonOf(notCreated, "The read of a cycle the refusal did not create"), "outcome")).toBe("denied");
  expect(await listTotal(await readReferralList(page, "expired", EXPIRED_CYCLE.displayName))).toBe(1);
  expect(await listTotal(await readReferralList(page, "active", EXPIRED_CYCLE.displayName))).toBe(0);

  await page.goto(`${REFERRALS_PATH}?list=expired`);
  const list = page.locator('[data-slot="referral-list"]');
  await expect(list.getByRole("heading", { name: EXPIRED_CYCLE.displayName })).toHaveCount(1);
  await expect(list.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);

  // With the setting on, the same cycle offers its single continuation — in the cycle's own eligibility and
  // in the actions the list and detail reads publish, which is where both surfaces read it from.
  await switchScenario(page, CONTINUATION_ON_SCENARIO);
  const on = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(on, "data", "continuationPolicy", "setting")).toBe("on");
  expect(fieldAt(on, "data", "referral", "continuation", "available")).toBe(true);
  expect(fieldAt(on, "data", "referral", "continuation", "reason")).toBeNull();
  expect(actionOffered(on, "continueReferral")).toBe(true);
  expect(actionOffered(await readReferralList(page, "expired"), "continueReferral")).toBe(true);

  // The offer is eligibility, not the setting alone: a cycle whose window has not ended is still not
  // continuable, and its surface states that reason in its own words.
  const unended = await readReferral(page, DATE_ONLY_CYCLE.referralId);
  expect(fieldAt(unended, "data", "referral", "continuation", "available")).toBe(false);
  expect(String(fieldAt(unended, "data", "referral", "continuation", "reason"))).toBe(COPY.continueNotExpired);
  await page.goto(referralDetailPath(DATE_ONLY_CYCLE.referralId));
  const notOffered = page.locator('[data-slot="continue-referral-unavailable"]');
  await expect(notOffered.getByRole("heading", { name: COPY.continueHeading })).toBeVisible();
  await expect(notOffered.getByText(COPY.continueNotExpired)).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// The continued window: elapsed seconds, one successor, and nothing else granted
// ---------------------------------------------------------------------------------------------

test("a continued window ends in elapsed seconds, and a racing second Continue yields no second successor", async ({ page }) => {
  await switchScenario(page, CONTINUATION_ON_SCENARIO);
  await setClock(page, CONTINUATION_ACCEPTED_AT);

  // The figures a continuation must leave alone, read before it: the partner's open work and the activity
  // recorded against them. Neither is derived here; each is the count the application states.
  const before = await readPartnerFigures(page, "partner-jo-mbeki");
  const cycle = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(cycle, "data", "referral", "status", "status")).toBe("expired");
  expect(fieldAt(cycle, "data", "referral", "continuation", "available")).toBe(true);

  // One attempt, one identity: the acknowledgement is recovered by replaying this, never by a new attempt.
  const attemptId = newAttemptId();
  const accepted = await submitContinue(page, cycle, EXPIRED_CYCLE.referralId, attemptId);
  expect(accepted.outcome).toBe("accepted");
  expect(fieldAt(accepted.body, "created")).toEqual([CONTINUED_CYCLE_ID]);
  expect(fieldAt(accepted.body, "changed")).toEqual([EXPIRED_CYCLE.referralId]);

  // The stored result is what the same attempt answers when it is replayed: the successor, the instant its
  // window ends, and the elapsed seconds that window is counted in. Thirty days of elapsed seconds is
  // 2,592,000 of them, and the instant they reach is 09 November at 00:00 UTC — not the calendar-day
  // reading of the same day, which would have crossed the end of daylight saving an hour later.
  const replayed = await submitContinue(page, cycle, EXPIRED_CYCLE.referralId, attemptId);
  expect(replayed.outcome).toBe("alreadyAccepted");
  expect(fieldAt(replayed.body, "result", "successorId")).toBe(CONTINUED_CYCLE_ID);
  expect(fieldAt(replayed.body, "result", "windowEnd")).toBe(CONTINUATION_ENDPOINT);
  expect(numberOf(replayed.body, ["result", "elapsedSeconds"], "The continuation's elapsed seconds")).toBe(CONTINUATION_ELAPSED_SECONDS);
  expect(fieldAt(replayed.body, "result", "windowEnd")).not.toBe(CALENDAR_DAY_COUNTERFACTUAL);
  expect(fieldAt(replayed.body, "created")).toEqual([CONTINUED_CYCLE_ID]);

  // Two racing attempts, each stated the way a racing client would state one: the first presents the
  // revision it read before the acceptance and is refused as a conflict; the second re-reads the cycle and
  // is told nothing changed. Neither opens a second window.
  const stale = await submitContinue(page, cycle, EXPIRED_CYCLE.referralId, newAttemptId());
  expect(stale.outcome).toBe("conflict");
  const current = await readReferral(page, EXPIRED_CYCLE.referralId);
  const raced = await submitContinue(page, current, EXPIRED_CYCLE.referralId, newAttemptId());
  expect(raced.outcome).toBe("unchanged");

  // Exactly one successor, in each list that could show one.
  expect(await listTotal(await readReferralList(page, "active", EXPIRED_CYCLE.displayName))).toBe(1);
  expect(await listTotal(await readReferralList(page, "expired", EXPIRED_CYCLE.displayName))).toBe(1);

  // The successor keeps the original introduction date and states the predecessor it came from: a
  // continuation is one further window on the same introduction, not a second introduction.
  const successor = await readReferral(page, CONTINUED_CYCLE_ID);
  expect(fieldAt(successor, "data", "referral", "predecessorId")).toBe(EXPIRED_CYCLE.referralId);
  expect(fieldAt(successor, "data", "referral", "cycleIndex")).toBe(1);
  expect(fieldAt(successor, "data", "referral", "originalIntroductionOn")).toBe(EXPIRED_CYCLE.introducedOn);
  expect(fieldAt(successor, "data", "referral", "windowStart")).toBe(CONTINUATION_ACCEPTED_AT);
  expect(fieldAt(successor, "data", "referral", "windowEnd")).toBe(CONTINUATION_ENDPOINT);
  expect(fieldAt(successor, "data", "referral", "status", "status")).toBe("active");

  // The surface says what the window is measured in and that it is the only one the cycle carries, and it
  // prints the instant exactly as the read resolved it.
  await page.goto(referralDetailPath(CONTINUED_CYCLE_ID));
  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.continuedWindow })).toBeVisible();
  await expect(windowPanel.getByText(COPY.elapsedNotCalendar)).toBeVisible();
  await expect(windowPanel.getByText(COPY.oneSuccessor)).toBeVisible();
  await expect(windowPanel.getByText(CONTINUATION_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(COPY.continuedFrom, { exact: true })).toBeVisible();
  await expect(windowPanel.getByText(EXPIRED_CYCLE.referralId, { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-slot="referral-detail-introduction"]').getByText(EXPIRED_CYCLE.introducedOn, { exact: true })).toBeVisible();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);

  // The list a worker returns to shows one successor and nothing beside it.
  await page.goto(`${REFERRALS_PATH}?list=active&search=${encodeURIComponent(EXPIRED_CYCLE.displayName)}`);
  const list = page.locator('[data-slot="referral-list"]');
  await expect(list.getByRole("link", { name: EXPIRED_CYCLE.displayName })).toHaveCount(1);
  await expect(list.getByRole("link", { name: EXPIRED_CYCLE.displayName }).first()).toHaveAttribute("href", /referral-jo-expired-continued/u);

  // And it granted nothing else: no follow-up task, no interaction credit, and no consent, interest, send or
  // further introduction, which is the whole of what a continuation may claim.
  expect(await readPartnerFigures(page, "partner-jo-mbeki")).toEqual(before);

  await setClock(page, SEED_INSTANT);
});

