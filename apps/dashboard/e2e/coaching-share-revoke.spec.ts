/**
 * Criterion 16 — voluntary coaching: what a coach is invited to, may read, and loses.
 *
 * **The scenario this file drives, from the deterministic seed.** A worker (`established-worker`) in the
 * Harbour youth ministry who has invited one coach (`coach`) to a working relationship; a grant that is
 * active with two of the five modules switched on and a *through-date* duration whose cutoff was frozen at
 * acceptance (`2026-12-31T00:00:00Z`, in `Europe/London`); a second grant between the same two people that
 * shares a reviewed financial range instead; an episode the worker revoked and one they ended; and the
 * development runtime, whose clock, scenario and reset are the only things this file moves.
 *
 * **What it proves.** An invitation names the recipient, the organization, the ministry, the five modules —
 * each starting unselected — and a duration, and recording it reaches the first of four separate outcomes and
 * no further; a missing duration is a validation error and never permission. The coach's portfolio authorises
 * before it enumerates and states only the modules switched on, so an unshared module yields no count, title
 * or existence hint; a private target label never reaches the coach; and no coach write of any kind succeeds,
 * whether it is offered as a control or attempted through the application's own transport. A check-in within
 * its limits is accepted intact and one past them is refused with the count it reached and never shortened.
 * The exclusive cutoff denies a read at the instant itself and a display-timezone change cannot move it.
 * The sharing surface discloses every relationship the read returns, so revoking one grant cannot stand in for
 * stopping another: revocation stops access to the grant it names, survives an unrelated invalid draft, leaves the
 * second grant the coach can still read through disclosed and stoppable on its own, and takes nothing away from the
 * worker's own work. One admitted module whose source is down reports itself unavailable while the others stay readable.
 *
 * **How time and sources move.** Only through the development control (`/api/dev`) — the same control the
 * Settings reset and the development panel operate. The scenario clock is session state inside the running
 * server, so no reading here derives a boundary from a wall clock; every boundary is compared at the instant
 * the control was set to, which is what makes the assertions evidence rather than a coincidence of timing.
 */
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

// The development-session cookie is the whole of the identity this application authorises a request as, and
// the reset restores the seeded world the assertions name. Both are the runner's own, read from it rather
// than repeated here, so this file cannot silently act as an identity or a seed the runner no longer means.
import { resetSeed, SESSION_COOKIE } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded world this file names
// ---------------------------------------------------------------------------------------------

/** The worker who owns every record here, and the identity every worker-side control acts as. */
const WORKER_SESSION = "established-worker";

/** The coach admitted read-only to exactly the modules and periods the worker switched on. */
const COACH_SESSION = "coach";

/** The principal that coach acts as, which every relationship section names beside the grant it discloses. */
const COACH_PRINCIPAL = "principal-coach";

/** The active grant behind the worker's sharing surface: targets and check-ins on, the financial modules off. */
const PRIMARY_GRANT = "grant-established-coach";

/** The active grant that shares a reviewed financial range, so the financial modules are exercised admitted. */
const FINANCIAL_GRANT = "grant-established-coach-support";

/** The fixed period that grant records, and the one currency it was reviewed in. */
const REVIEWED_RANGE_FROM = "2026-10-01";
const REVIEWED_RANGE_TO = "2026-10-31";
const REVIEWED_RANGE_CURRENCY = "USD";

/**
 * The received support the reviewed range carries, as the one report path reads it: the harbour allocation into youth
 * for its own original gift date in that period — the parent gift row counts once at the allocation's grain, so the
 * period sums to this allocation and not to the gift it came from. The state the figure carries is its own, because the
 * seeded projection states partial coverage.
 */
const REVIEWED_RANGE_FIGURE = /40\.00 USD/u;

/** An episode the worker revoked: the coach may no longer read it, and revoking never recalled what was seen. */
const REVOKED_GRANT = "grant-revoked-coach";

/** An episode the worker ended: a later action cannot reopen it, so the coach's read is refused. */
const ENDED_GRANT = "grant-ended-coach";

/** The seed instant every scenario offset is measured from, which is also the offset this file restores. */
const SEED_INSTANT = "2026-11-20T00:00:00Z";

/** The frozen, exclusive end of the primary grant: the first instant of the civil day after the share date. */
const CUTOFF_INSTANT = "2026-12-31T00:00:00Z";

/** One second before that instant, which is inside the window: the last moment that stays readable is the one before the cutoff. */
const ONE_SECOND_BEFORE_CUTOFF = "2026-12-30T23:59:59Z";

/** The zone the cutoff was frozen in, which no display preference may move. */
const FROZEN_ZONE = "Europe/London";

/** A display zone deliberately unlike the frozen one, chosen to show that a display change leaves the stored cutoff alone. */
const OTHER_DISPLAY_ZONE = "Pacific/Auckland";

/** The five modules a grant may share, in the domain's own order, with the words the surfaces use for them. */
const FIVE_MODULES = ["Support goal", "Support results", "Targets", "Check-ins", "Task summaries"] as const;

/** The three modules the primary grant does not share: their names must appear nowhere in that coach's view. */
const UNSHARED_MODULES = ["Support goal", "Support results", "Task summaries"] as const;

/**
 * A private target label from the seed, which names the worker's own wording and says it is never shared.
 * Half of it is enough to detect the label: the words are the worker's and a coach reading them would be the
 * defect this assertion exists to catch, whatever the surrounding sentence became.
 */
const PRIVATE_TARGET_LABEL = /my own wording/u;

/** The check-in limits (AAP 0.8.7), stated here as the numbers the surfaces display and the service enforces. */
const MAX_QUESTIONS = 5;
const MAX_ANSWER_SCALARS = 4000;

/** An answer of exactly the maximum length: the value that must be accepted intact, never shortened. */
const FULL_ANSWER = "a".repeat(MAX_ANSWER_SCALARS);

/** One character past the maximum: the value that must be refused with its count and left in the field. */
const OVER_LIMIT_ANSWER = "a".repeat(MAX_ANSWER_SCALARS + 1);

/** The questions this file adds to the seeded check-in, which reach the five-question limit exactly. */
const ADDED_QUESTIONS = ["Who did you speak to this week?", "What did you learn from them?", "What will you do next?"] as const;

/** A sixth question, offered to a set that already holds the maximum: it is refused, and nothing is dropped. */
const SIXTH_QUESTION = "What should change next week?";

/** The two questions a fresh check-in is saved with through the application's own transport. */
const ACCEPTED_QUESTIONS = ["What went well?", "What was hard?"] as const;

/** What the coach identity attempts to write, so the worker's own surfaces can show it never arrived. */
const COACH_WRITE_QUESTION = "A question only a coach could write";

/** The answer the same attempt carries, kept distinct so it is findable in the worker's own records. */
const COACH_WRITE_ANSWER = "An answer only a coach could write";

/** The message a limit refusal carries on the wire, which names the count it reached and the limit it crossed. */
const ANSWER_LIMIT_MESSAGE = "4001 characters long and the limit is 4000";

/** The message the question-set limit carries when a sixth question is offered to a full set. */
const QUESTION_SET_MESSAGE = "This check-in carries 6 questions and the limit is 5";

/** The message the request ceiling carries, which names the bytes that had arrived. */
const REQUEST_CEILING_MESSAGE = "passed the 262144-byte limit";

/** How many answers one request carries to cross the 256 KiB ceiling while every field stays inside its own limit. */
const OVERSIZED_ANSWER_COUNT = 70;

/** The development control's two verbs, which this file operates as values rather than re-deriving URLs. */
const DEV_PATH = "/api/dev";
const CHECK_INS_PATH = "/api/coaching/checkins";

// ---------------------------------------------------------------------------------------------
// The identity a request is authorised as
// ---------------------------------------------------------------------------------------------

/**
 * The origin the application is served from, taken from a response the browser's own request context
 * received, so a cookie is set on the address it is actually read from rather than on a guess.
 */
async function originOf(page: Page): Promise<string> {
  const response = await page.request.get("/");
  return new URL(response.url()).origin;
}

/**
 * Puts one seeded session in the browser context's cookie jar, which is the whole of the identity the
 * application authorises a request as.
 *
 * The jar is cleared first so a cookie left by another identity cannot be sent beside this one: one request,
 * one identity. Every read that follows is authorised again from this value, so nothing the previous identity
 * fetched is what makes the next answer correct.
 */
async function actAs(context: BrowserContext, origin: string, sessionId: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, url: origin }]);
}

// ---------------------------------------------------------------------------------------------
// One relationship's own section on the sharing surface
// ---------------------------------------------------------------------------------------------

/**
 * The section the sharing surface opens for one relationship, addressed by the grant reference it is
 * disclosed under.
 *
 * The surface discloses every relationship the coaching read returns, so a locator that is not scoped to one
 * of them is a question about the whole page: a count of module rows, a switch and a stop review each belong
 * to the grant whose section holds them, and this file means one grant at a time.
 */
function relationshipSection(page: Page, grantId: string): Locator {
  return page.locator(`[data-slot="coaching-relationship"][data-grant="${grantId}"]`);
}

// ---------------------------------------------------------------------------------------------
// The development control: the only thing this file uses to move time or a source
// ---------------------------------------------------------------------------------------------

/** The four identifiers a development request claims, in the shape the read envelope states them. */
interface DevScope {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
}

/** What one `GET /api/dev` answer must carry for a control to be operated: the authority and the revision it saw. */
interface DevState {
  readonly scope: DevScope;
  readonly revision: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textAt(value: unknown, member: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[member];
  return typeof found === "string" && found.length > 0 ? found : undefined;
}

function devScopeOf(value: unknown): DevScope | undefined {
  if (!isRecord(value)) return undefined;
  const organizationId = textAt(value, "organizationId");
  const ministryId = textAt(value, "ministryId");
  const supportSubjectId = textAt(value, "supportSubjectId");
  const principalId = textAt(value, "principalId");
  return organizationId === undefined || ministryId === undefined || supportSubjectId === undefined || principalId === undefined ? undefined : { organizationId, ministryId, supportSubjectId, principalId };
}

/**
 * Reads this session's development state: the scope and revision a control presents.
 *
 * A refusal here is reported as itself rather than asserted around, because a spec that could not reach the
 * control would otherwise judge the boundary at whatever instant the previous test left behind.
 */
async function devState(page: Page): Promise<DevState> {
  const response = await page.request.get(DEV_PATH);
  const text = await response.text();
  const body: unknown = parseJson(text);
  const scope = devScopeOf(isRecord(body) ? body.scope : undefined);
  const revision = textAt(body, "revision");
  if (!response.ok() || scope === undefined || revision === undefined) {
    throw new Error(`The development state could not be read from ${DEV_PATH}: HTTP ${String(response.status())} — ${text.slice(0, 300)}. This file moves time and source availability through that control, so it stops here rather than judging a boundary at an instant it did not choose.`);
  }
  return { scope, revision };
}

/**
 * Operates one named development control and requires it to be applied.
 *
 * `setClock` states the instant to stand at, `advanceClock` moves by elapsed seconds, and `setScenario`
 * selects the seeded world — the same three the development panel submits, with a fresh `operationId` per
 * attempt because each is its own attempt rather than a replay of the last one.
 */
async function devControl(page: Page, action: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
  const state = await devState(page);
  const response = await page.request.post(DEV_PATH, { data: { action, operationId: crypto.randomUUID(), scope: state.scope, expectedRevision: state.revision, payload } });
  const text = await response.text();
  const body: unknown = parseJson(text);
  const outcome = textAt(body, "outcome");
  if (!response.ok() || (outcome !== "accepted" && outcome !== "alreadyAccepted" && outcome !== "unchanged")) {
    throw new Error(`The ${action} development control was refused: HTTP ${String(response.status())} — ${text.slice(0, 300)}. Nothing this file asserts about time or a source can be trusted if the control did not apply.`);
  }
}

/** Stands this session's scenario clock at one absolute instant, which is how a boundary is reached exactly. */
async function setClockTo(page: Page, instant: string): Promise<void> {
  await devControl(page, "setClock", { offsetIso: instant });
}

/** Moves this session's scenario clock forward by whole elapsed seconds. */
async function advanceClockBy(page: Page, bySeconds: number): Promise<void> {
  await devControl(page, "advanceClock", { bySeconds });
}

/** Selects the seeded world this session runs in, which is how one module's source is reported down. */
async function setScenarioTo(page: Page, scenarioId: string): Promise<void> {
  await devControl(page, "setScenario", { scenarioId });
}

/** A response body as a value, or `undefined` for a body that is not JSON — every outcome here is JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** How many Unicode scalar values a value holds: the unit both the editor and the service count a limit in. */
function scalarCount(text: string): number {
  return [...text].length;
}

/**
 * Makes the first keystroke of a journey until the surface answers it.
 *
 * A route's browser bundle takes hold after its server-rendered document is on screen, and a fill that lands
 * before that writes the value into the field without reaching the editor's own state. Repeating the fill
 * until the counter it drives states the value is how this file is certain the surface took the interaction
 * rather than the browser alone — and it asserts nothing about how long anything took.
 */
async function fillUntilCounted(field: Locator, value: string, counter: Locator): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(counter).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(field).toHaveValue(value);
}

// ---------------------------------------------------------------------------------------------
// One response this file judges
// ---------------------------------------------------------------------------------------------

/** A mutation attempt through the application's own transport: the verb it used, the body it sent, and what came back. */
interface Attempt {
  readonly label: string;
  readonly response: { readonly status: () => number };
  readonly body: unknown;
}

/**
 * Submits one named coaching mutation as the identity the cookie jar currently holds.
 *
 * The scope and revision are the development read's own, because the assertions below judge what the service
 * does with a well-formed request: a refused write has to be refused for the identity, not for a malformed
 * body, which is exactly the distinction a coach attempting the worker's own work turns on.
 */
async function submitCheckIn(page: Page, label: string, payload: Readonly<Record<string, unknown>>): Promise<Attempt> {
  const state = await devState(page);
  const response = await page.request.post(CHECK_INS_PATH, { data: { operationId: crypto.randomUUID(), scope: state.scope, expectedRevision: state.revision, payload } });
  return { label, response, body: parseJson(await response.text()) };
}

/** The answers a stored check-in holds, read back from the list so a length is measured on what the service kept. */
function storedAnswerLengths(value: unknown, checkInId: string): readonly number[] {
  const checkIns = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.checkIns) ? value.data.checkIns : [];
  const stored = checkIns.find((candidate) => isRecord(candidate) && candidate.checkInId === checkInId);
  if (!isRecord(stored) || !isRecord(stored.privateDraft) || !Array.isArray(stored.privateDraft.answers)) {
    throw new Error(`The check-in ${JSON.stringify(checkInId)} is not in the list this read returned, so the length of the answers it kept could not be measured. A saved check-in has to be readable from its own list; if the read no longer states one, name what it states instead.`);
  }
  return stored.privateDraft.answers.map((answer) => (isRecord(answer) && typeof answer.text === "string" ? scalarCount(answer.text) : -1));
}

// ---------------------------------------------------------------------------------------------
// The invitation: everything named, four outcomes kept apart, a missing duration refused
// ---------------------------------------------------------------------------------------------

test("records an invitation that names the person, the ministry, the five unselected modules and a duration — and claims only the first of four outcomes", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, WORKER_SESSION);
  await page.goto("/coaching/sharing");

  // The shell's Development data label is always present, so no screen here can be mistaken for production.
  await expect(page.getByText("Development data", { exact: true })).toBeVisible();

  // Delivery, identity verification, deliberate acceptance and live access are four separate facts, and the
  // surface says which one an invitation reaches: the first, and no other.
  await expect(page.getByText("These four things are separate outcomes, and recording an invitation reaches only the first: it sends no message, verifies nobody and makes nothing readable.")).toBeVisible();
  for (const outcome of ["Invitation recorded", "Identity verified", "Accepted deliberately", "Access live"]) {
    await expect(page.getByText(outcome, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("A matching address, an existing relationship or a staff title verifies nobody on its own.").first()).toBeVisible();
  // The invitation is a record in this application, and the surface labels the message it does not send.
  await expect(page.getByText(/no mail leaves this application/u).first()).toBeVisible();

  const form = page.locator('[data-slot="invitation-form"]');
  const review = form.locator('[data-slot="action-review"]');

  // Five modules, each recorded as switched off when the invitation is created: nothing pre-selects one.
  await expect(form.getByText("Every module is recorded as switched off when the invitation is created. You choose which ones to switch on once the person has accepted, so nothing here pre-selects a module and no module can be read before then.")).toBeVisible();
  await expect(review.getByText("— Starts unselected")).toHaveCount(FIVE_MODULES.length);

  // The three choices are admitted lists, not typed values: a typed address would establish nothing.
  await expect(form.getByText("A typed name or address would establish nothing: an address that looks the same verifies nobody.")).toBeVisible();
  const recipient = form.getByRole("combobox", { name: /^Coach/u });
  // The people an invitation can name are the ones the service's own identity records hold — one entry per principal
  // with a signed-in session, the person acting left out — stated by the opaque reference the record carries rather
  // than a name resolved from another record. The list is taken from the same read the page composes, so this
  // assertion follows the store the runner seeded instead of a roster written into this file.
  const invitable = invitableCoachesOf(await readOverview(page));
  expect(invitable).toContain(COACH_PRINCIPAL);
  await expect(recipient.locator("option")).toHaveText(["Choose the person to invite", ...invitable]);
  const organization = form.getByRole("combobox", { name: /^Organization/u });
  await expect(organization.locator("option")).toHaveText(["Choose the organization", "Harbour Community Church"]);
  const ministry = form.getByRole("combobox", { name: /^Ministry/u });
  await expect(ministry.locator("option")).toHaveText(["Choose the ministry", "Youth Ministry", "Students Ministry"]);

  // A duration is required, and the surface says so before anything is submitted: a missing duration is a
  // validation error rather than permission to share.
  await recipient.selectOption({ label: COACH_PRINCIPAL });
  await organization.selectOption({ label: "Harbour Community Church" });
  await ministry.selectOption({ label: "Youth Ministry" });
  await expect(form.getByText("Still needed before this invitation can be recorded: How long sharing runs.")).toBeVisible();
  await expect(review.getByText("No duration is chosen yet, and a missing duration is not permission to share: the invitation cannot be submitted until one is chosen.")).toBeVisible();

  await review.getByRole("button", { name: "Record invitation" }).click();
  const refusal = review.getByRole("alert");
  await expect(refusal.getByRole("heading", { name: "Check the details" })).toBeVisible();
  await expect(refusal.getByRole("link", { name: /^Share through/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved", exact: true })).toHaveCount(0);

  // With a date chosen the invitation is recorded, and the receipt names the relationship it created.
  await form.getByRole("radio", { name: "Through a date you choose" }).check();
  await form.getByLabel(/^Share through/u).fill("2027-01-31");
  await review.getByRole("button", { name: "Record invitation" }).click();
  await expect(review.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
  await expect(review.getByText(/^coaching-grant-\S+$/u)).toBeVisible();
  await expect(review.getByText("This step is complete for this attempt, and the result below is its record. Changing what this step would apply begins a new attempt with its own identity.")).toBeVisible();
  // The settled step states what it reached and what it did not: the other three outcomes have not happened.
  await expect(form.getByText("Recording an invitation reached the first of the four outcomes above and no further: identity verification, deliberate acceptance and live access have not happened.")).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// The coach's read: admitted modules only, no private label, and no write of any kind
// ---------------------------------------------------------------------------------------------

test("shows a coach only the modules switched on and offers no write of any kind, while the worker's own work stays untouched", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, WORKER_SESSION);
  await page.goto("/coaching/sharing");

  // Every relationship the read returns is disclosed, each in its own section named by the grant it carries and by
  // the principal the coach acts as. A surface that showed only the live one it named first would leave the others —
  // and the access a coach still holds through them — unnamed, which is what this assertion exists to catch.
  const overview = await readOverview(page);
  const disclosed = grantIdsOf(overview);
  const readable = readableGrantIdsOf(overview);
  expect(readable).toEqual(expect.arrayContaining([PRIMARY_GRANT, FINANCIAL_GRANT]));
  await expect(page.locator('[data-slot="coaching-relationship"]')).toHaveCount(disclosed.length);
  for (const grantId of disclosed) {
    const section = relationshipSection(page, grantId);
    await expect(section).toHaveCount(1);
    // A relationship the read admitted states its five switches; one it refused states that refusal and offers no
    // switch at all, because a module row there would describe sharing the read has already ended.
    await expect(section.locator('[data-slot="module-toggle-row"]')).toHaveCount(readable.includes(grantId) ? FIVE_MODULES.length : 0);
    // A refused relationship states the read's own refusal in the read's own words, and no count, module or
    // sharing claim of its own: the section is unreadable and says why.
    if (!readable.includes(grantId)) {
      await expect(section.getByText(refusalMessageOf(overview, grantId))).toBeVisible();
    }
  }
  // The two live grants the seed holds, the episode the worker revoked and the one they ended are all among the
  // disclosed set, and each names its coach and its own grant in its heading.
  for (const seededGrant of [PRIMARY_GRANT, FINANCIAL_GRANT, REVOKED_GRANT, ENDED_GRANT]) {
    expect(disclosed).toContain(seededGrant);
    await expect(relationshipSection(page, seededGrant).getByRole("heading", { level: 2, name: `Sharing with ${COACH_PRINCIPAL} under ${seededGrant}` })).toBeVisible();
  }
  // Each section states the lifecycle of its own record, and no two of them state one another's.
  await expect(relationshipSection(page, PRIMARY_GRANT)).toHaveAttribute("data-state", "active");
  await expect(relationshipSection(page, FINANCIAL_GRANT)).toHaveAttribute("data-state", "active");
  await expect(relationshipSection(page, REVOKED_GRANT)).toHaveAttribute("data-state", "revoked");
  await expect(relationshipSection(page, ENDED_GRANT)).toHaveAttribute("data-state", "ended");

  // Inside the primary grant's own section, what the worker switched on is stated module by module: a count of five
  // rows is a statement about one grant at a time, and a switch reached here is that relationship's own.
  const primary = relationshipSection(page, PRIMARY_GRANT);
  const rows = primary.locator('[data-slot="module-toggle-row"]');
  await expect(rows).toHaveCount(FIVE_MODULES.length);
  for (const moduleName of FIVE_MODULES) {
    await expect(primary.getByRole("switch", { name: new RegExp(`^${moduleName} `, "u") })).toHaveCount(1);
  }
  await expect(primary.getByRole("switch", { name: /^Support goal Switched off$/u })).toHaveAttribute("aria-checked", "false");
  await expect(primary.getByRole("switch", { name: /^Support results Switched off$/u })).toHaveAttribute("aria-checked", "false");
  await expect(primary.getByRole("switch", { name: /^Task summaries Switched off$/u })).toHaveAttribute("aria-checked", "false");
  await expect(primary.getByText("This module is switched off, so your coach cannot read it.").first()).toBeVisible();
  // No reviewed financial range is shared under this grant, and its own section states that rather than a zero: the
  // statement belongs to the relationship whose record carries no range, so it is read inside that relationship's
  // section instead of as a fact about the page.
  await expect(primary.getByText("No financial range has been shared with a coach yet.")).toHaveCount(1);
  // The other live grant records a reviewed range, and its own section states the period, the one currency and the
  // figure the one report path reads for that period — which is what makes the range a fact a worker and a coach can
  // both read rather than a capability with no surface.
  const reviewed = relationshipSection(page, FINANCIAL_GRANT);
  await expect(reviewed.getByText(REVIEWED_RANGE_FROM, { exact: true }).first()).toBeVisible();
  await expect(reviewed.getByText(REVIEWED_RANGE_TO, { exact: true }).first()).toBeVisible();
  await expect(reviewed.getByText(REVIEWED_RANGE_CURRENCY, { exact: true }).first()).toBeVisible();
  await expect(reviewed.getByText(REVIEWED_RANGE_FIGURE).first()).toBeVisible();
  await expect(reviewed.getByText("No financial range has been shared with a coach yet.")).toHaveCount(0);

  // The coach's portfolio: two relationships, each listing only the modules the worker switched on.
  await actAs(context, origin, COACH_SESSION);
  await page.goto("/coaching/coach");
  await expect(page.getByText("This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was already read.")).toBeVisible();
  // The first row shares the two non-financial modules and the second shares those beside the support goal, so
  // each relationship states exactly what was switched on for it.
  await expect(page.getByRole("row", { name: /min-harbour-youth Targets Check-ins /u })).toBeVisible();
  await expect(page.getByRole("row", { name: /min-harbour-youth Support goal Targets Check-ins /u })).toBeVisible();
  await expect(page.getByRole("table", { name: "Coaching relationships" }).getByRole("row")).toHaveCount(3);

  // One admitted subject: the tabs are exactly the modules switched on for that relationship.
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Targets", "Check-ins"]);
  for (const moduleName of UNSHARED_MODULES) {
    await expect(page.getByRole("tab", { name: moduleName })).toHaveCount(0);
    await expect(page.getByText(moduleName, { exact: true })).toHaveCount(0);
  }
  // A private target label belongs to the worker and is never disclosed, so half of it is not on this page either.
  await expect(page.getByText(PRIVATE_TARGET_LABEL)).toHaveCount(0);
  // A recorded zero is drawn as a zero and named as one: it is not an empty period, and it is not hidden.
  await expect(page.locator("main").getByRole("cell", { name: "0 (Zero)" }).first()).toBeVisible();

  // No coach write exists here: no control edits, comments, assigns, reminds, completes, reopens or exports,
  // and the one action the coach identity holds is their own departure.
  const coachMain = page.locator("main");
  await expect(coachMain.getByRole("button", { name: /edit|comment|assign|remind|complete|reopen|export|impersonate/iu })).toHaveCount(0);
  await expect(coachMain.getByRole("link", { name: /edit|comment|export/iu })).toHaveCount(0);
  await expect(coachMain.getByRole("button", { name: `Leave the coaching relationship for ${PRIMARY_GRANT}` })).toHaveCount(1);

  // The financial relationship is admitted, and even there no donor, gift or commitment record is reachable:
  // the surface carries no drilldown into a financial record, in any currency.
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Support goal", "Targets", "Check-ins"]);
  await expect(page.locator('main a[href^="/support/"], main a[href^="/partners/"]')).toHaveCount(0);

  // A write attempted through the application's own transport is refused for the identity, so the absence of
  // a control is not what protects the worker's records.
  const attempt = await submitCheckIn(page, "the coach saving a private check-in", { operation: "saveCheckIn", questions: [COACH_WRITE_QUESTION], answers: [COACH_WRITE_ANSWER] });
  expect(attempt.body).toMatchObject({ outcome: "denied" });

  // And the worker's own work holds none of what the coach tried to write.
  await actAs(context, origin, WORKER_SESSION);
  await page.goto("/coaching/check-ins");
  await expect(page.getByText(COACH_WRITE_ANSWER)).toHaveCount(0);
  await expect(page.getByText(COACH_WRITE_QUESTION)).toHaveCount(0);
});

/**
 * The coaching overview the sharing surface itself composes, read through the application's own transport.
 *
 * A surface shown after a mutation can still be rendering the payload it was handed before it, so the record
 * a decision produced is judged here, in the read that decision changed.
 */
async function readOverview(page: Page): Promise<unknown> {
  const response = await page.request.get("/api/coaching");
  if (!response.ok()) {
    throw new Error(`The coaching overview could not be read: HTTP ${String(response.status())}. The state this file just changed cannot be judged from a read that did not answer.`);
  }
  return await response.json();
}

/**
 * The relationship the surface manages, as the same read reports it: the live one, chosen from records rather
 * than from a label a page happened to render.
 */
function activeGrantIdOf(value: unknown): string {
  const active = isRecord(value) && isRecord(value.data) ? value.data.activeGrantId : undefined;
  if (typeof active !== "string" || active.length === 0) {
    throw new Error(`The coaching overview names no live relationship, so the surface has nothing left to manage: ${JSON.stringify(value).slice(0, 300)}.`);
  }
  return active;
}

/**
 * The people the coaching overview offers an invitation, in the order it states them.
 *
 * The invitation form's recipient choice is held to exactly this list: it is taken from the read the page composes,
 * so the assertion follows the store the runner seeded and the records this service holds rather than a roster
 * written into this file.
 */
function invitableCoachesOf(value: unknown): readonly string[] {
  const coaches = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.invitableCoaches) ? value.data.invitableCoaches : [];
  const names = coaches.map((coach) => (isRecord(coach) && typeof coach.displayName === "string" ? coach.displayName : ""));
  if (names.includes("")) {
    throw new Error(`The coaching overview states an invitable person with no name to choose: ${JSON.stringify(value).slice(0, 300)}.`);
  }
  return names;
}

/**
 * The grant references the coaching overview reports, in the order it states them.
 *
 * The sharing surface is held to disclosing exactly these: the set is taken from the read the page composes, so
 * the assertion follows the seed the runner restores rather than a count written into this file.
 */
function grantIdsOf(value: unknown): readonly string[] {
  const relationships = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.relationships) ? value.data.relationships : [];
  const ids = relationships.map((candidate) => (isRecord(candidate) && typeof candidate.grantId === "string" ? candidate.grantId : ""));
  if (ids.length === 0 || ids.includes("")) {
    throw new Error(`The coaching overview states no relationship this test can address: ${JSON.stringify(value).slice(0, 300)}.`);
  }
  return ids;
}

/**
 * The grants the coaching overview admitted, which are the ones a coach can read through right now.
 *
 * A relationship the read refused carries that refusal, so the read itself is what separates a grant this
 * surface may switch modules on for from one it can only state as unreadable.
 */
function readableGrantIdsOf(value: unknown): readonly string[] {
  const relationships = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.relationships) ? value.data.relationships : [];
  return relationships.flatMap((candidate) => (isRecord(candidate) && typeof candidate.grantId === "string" && candidate.readRefusal === null ? [candidate.grantId] : []));
}

/** The refusal message the coaching overview states for one relationship, taken from the same read the page composes. */
function refusalMessageOf(value: unknown, grantId: string): string {
  const relationships = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.relationships) ? value.data.relationships : [];
  const found = relationships.find((candidate) => isRecord(candidate) && candidate.grantId === grantId);
  const message = isRecord(found) && isRecord(found.readRefusal) ? found.readRefusal.message : undefined;
  if (typeof message !== "string" || message.length === 0) {
    throw new Error(`The coaching overview states no refusal for ${JSON.stringify(grantId)}, so the refusal this test expects on the surface cannot be named: ${JSON.stringify(value).slice(0, 300)}.`);
  }
  return message;
}

/**
 * The lifecycle state one relationship stands in, read from the overview the sharing surface itself composes.
 *
 * The surface discloses every relationship the read returns, so the state a section shows is the state of the
 * grant that section names; this reading takes the same read the page composes by identity, so the assertion is
 * about the record this file acted on rather than about a label the page happened to render.
 */
function relationshipStateOf(value: unknown, grantId: string): string {
  const relationships = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.relationships) ? value.data.relationships : [];
  const found = relationships.find((candidate) => isRecord(candidate) && candidate.grantId === grantId);
  if (!isRecord(found) || typeof found.state !== "string") {
    throw new Error(`The coaching overview states no relationship ${JSON.stringify(grantId)}, so the state of the record this test acted on could not be read: ${JSON.stringify(value).slice(0, 300)}.`);
  }
  return found.state;
}

/** The identity an accepted save reports as created, which the list read then has to hold. */
function createdIdOf(value: unknown): string {
  const created = isRecord(value) && Array.isArray(value.created) ? value.created[0] : undefined;
  if (typeof created !== "string" || created.length === 0) {
    throw new Error(`The accepted save reported no created identity, so the record it wrote could not be read back: ${JSON.stringify(value).slice(0, 300)}. A save that reports no identity gives a spec nothing to measure the stored text against.`);
  }
  return created;
}

// ---------------------------------------------------------------------------------------------
// Check-in limits: refused with the count, never shortened
// ---------------------------------------------------------------------------------------------

test("refuses a check-in past a limit with the count it reached, keeps an exactly-at-limit value intact, and never shortens what was written", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, WORKER_SESSION);
  await page.goto("/coaching/check-ins");

  const editor = page.locator('[data-slot="check-in-editor"]');
  // The four limits are stated before the first keystroke, in the units they are counted in.
  for (const limit of ["At most 5 questions in one check-in.", "At most 500 characters in a question, counted one per Unicode character, so a character outside the basic plane counts once.", "At most 4000 characters in an answer, counted the same way.", "At most 262144 bytes once the whole check-in is sent."]) {
    await expect(editor.getByText(limit, { exact: true })).toBeVisible();
  }
  await expect(editor.getByText("A value that crosses one of these limits is refused with the count it reached, and it is never shortened: nothing you wrote is cut down to fit, and no question leaves the set without you removing it yourself.")).toBeVisible();
  await expect(editor.getByText(`This check-in carries 2 of ${String(MAX_QUESTIONS)} questions.`, { exact: true })).toBeVisible();
  // The private draft and the shared revision are two visible things, and the writing is one of them.
  await expect(editor.getByRole("heading", { name: /^Your private draft/u })).toBeVisible();
  await expect(editor.getByRole("heading", { name: /^The shared revision/u })).toBeVisible();

  // An answer of exactly the maximum length is accepted by the editor at its full length: the counter states
  // what was typed rather than what would fit, and nothing is trimmed.
  const firstAnswer = editor.getByRole("textbox", { name: "How did the week go?", exact: true });
  const secondAnswer = editor.getByRole("textbox", { name: "What would help next week?", exact: true });
  await fillUntilCounted(firstAnswer, FULL_ANSWER, editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true }));
  await fillUntilCounted(secondAnswer, FULL_ANSWER, editor.getByText(`Answer 2 is ${String(MAX_ANSWER_SCALARS)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true }));

  // Three more questions reach the five-question limit exactly, each with a full-length answer.
  const questionField = editor.getByRole("textbox", { name: "The question you want to answer" });
  for (const [index, wording] of ADDED_QUESTIONS.entries()) {
    await questionField.fill(wording);
    await editor.getByRole("button", { name: "Add question" }).click();
    await editor.getByRole("textbox", { name: wording, exact: true }).fill(FULL_ANSWER);
    await expect(editor.getByText(`Answer ${String(index + 3)} is ${String(MAX_ANSWER_SCALARS)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true })).toBeVisible();
  }
  await expect(editor.getByText(`This check-in carries ${String(MAX_QUESTIONS)} of ${String(MAX_QUESTIONS)} questions.`, { exact: true })).toBeVisible();

  // A sixth question is refused with the count it reached, and the set is left exactly as it was.
  await questionField.fill(SIXTH_QUESTION);
  await editor.getByRole("button", { name: "Add question" }).click();
  await expect(editor.getByText(`This check-in carries ${String(MAX_QUESTIONS)} of ${String(MAX_QUESTIONS)} questions, so a further question is refused rather than added. Take one out first, and nothing here was dropped.`, { exact: true })).toBeVisible();
  await expect(editor.getByRole("textbox", { name: /^Question \d wording$/u })).toHaveCount(MAX_QUESTIONS);
  await expect(questionField).toHaveValue(SIXTH_QUESTION);

  // One character past the answer limit is refused with the count, the field keeps every character typed, and
  // the save is held rather than shortening the text to fit.
  await firstAnswer.fill(OVER_LIMIT_ANSWER);
  await expect(editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS + 1)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true })).toBeVisible();
  await expect(editor.getByRole("alert").filter({ hasText: "Nothing will be sent yet" })).toBeVisible();
  await expect(editor.getByText("One value is outside a limit: it is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped.")).toBeVisible();
  await expect(editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS + 1)} characters long and the limit is ${String(MAX_ANSWER_SCALARS)}. Nothing was dropped: word it within the limit and save again.`, { exact: true })).toBeVisible();
  await expect(firstAnswer).toHaveValue(OVER_LIMIT_ANSWER);
  await expect(editor.getByRole("button", { name: "Save private draft" })).toBeDisabled();
  // The shared revision is a separate revision, and the surface says which action alone changes it.
  await expect(editor.getByText("Your private draft and the shared revision hold different text, and the shared revision changes only through Update shared check-in.")).toBeVisible();

  // The service is asked the same questions the editor asked, so the boundary is proven where it is enforced:
  // a value at the limit is stored at its full length, and one past it is refused with its count.
  const atLimit = await submitCheckIn(page, "a check-in at both limits", { operation: "saveCheckIn", questions: [...ACCEPTED_QUESTIONS], answers: ACCEPTED_QUESTIONS.map(() => FULL_ANSWER) });
  expect(atLimit.body).toMatchObject({ outcome: "accepted" });
  const created = createdIdOf(atLimit.body);
  const list = await page.request.get(CHECK_INS_PATH);
  expect(list.ok()).toBe(true);
  expect(storedAnswerLengths(await list.json(), created)).toEqual(ACCEPTED_QUESTIONS.map(() => MAX_ANSWER_SCALARS));

  const overAnswer = await submitCheckIn(page, "a check-in with one answer past the limit", { operation: "saveCheckIn", questions: [ACCEPTED_QUESTIONS[0]], answers: [OVER_LIMIT_ANSWER] });
  expect(overAnswer.body).toMatchObject({ outcome: "invalid", fields: { "answers.0": [expect.stringContaining(ANSWER_LIMIT_MESSAGE)] } });

  const overQuestions = await submitCheckIn(page, "a check-in with six questions", { operation: "saveCheckIn", questions: Array.from({ length: MAX_QUESTIONS + 1 }, (_, index) => `Question ${String(index + 1)}?`), answers: Array.from({ length: MAX_QUESTIONS + 1 }, () => "An answer.") });
  expect(overQuestions.body).toMatchObject({ outcome: "invalid", fields: { questions: [expect.stringContaining(QUESTION_SET_MESSAGE)] } });

  // Every field here is inside its own limit and the request as a whole is not: the ceiling is its own refusal.
  const oversized = await submitCheckIn(page, "a check-in past the request ceiling", { operation: "saveCheckIn", questions: [...ACCEPTED_QUESTIONS], answers: Array.from({ length: OVERSIZED_ANSWER_COUNT }, () => FULL_ANSWER) });
  expect(oversized.body).toMatchObject({ outcome: "invalid", fields: { _root: [expect.stringContaining(REQUEST_CEILING_MESSAGE)] } });
});

// ---------------------------------------------------------------------------------------------
// The exclusive cutoff: denied at the instant, and no display change moves it
// ---------------------------------------------------------------------------------------------

test("admits a coach one second before the frozen cutoff, denies the read at the instant itself, and leaves the cutoff where the acceptance froze it", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, WORKER_SESSION);

  // The cutoff is the exclusive start of the civil day after the share-through date, and it was frozen when
  // the episode began. A display preference changes how dates are shown to this worker and nothing else.
  await page.goto("/coaching/sharing");
  const primary = relationshipSection(page, PRIMARY_GRANT);
  await expect(primary.getByText(CUTOFF_INSTANT, { exact: true })).toBeVisible();
  await expect(primary.getByText(FROZEN_ZONE, { exact: true })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("combobox", { name: "Display time zone" }).selectOption(OTHER_DISPLAY_ZONE);
  await page.goto("/coaching/sharing");
  await expect(primary.getByText(CUTOFF_INSTANT, { exact: true })).toBeVisible();
  await expect(primary.getByText(FROZEN_ZONE, { exact: true })).toBeVisible();

  // One second before the cutoff the relationship is still readable, so the boundary is a boundary and not
  // the whole day it falls in.
  await actAs(context, origin, COACH_SESSION);
  await setClockTo(page, ONE_SECOND_BEFORE_CUTOFF);
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Targets", "Check-ins"]);

  // At the cutoff the very same read is refused — as it would be if a stored status still looked live,
  // because the bound is evaluated when the read runs and not when a label was written.
  await advanceClockBy(page, 1);
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  const coachMain = page.locator("main");
  await expect(coachMain.getByText("This request is not permitted in the current scope and session.")).toBeVisible();
  await expect(coachMain.getByText(/Reason no-permission/u)).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  // The refusal discloses nothing: no module is named, counted or hinted at.
  for (const moduleName of ["Targets", "Check-ins"]) {
    await expect(coachMain.getByText(moduleName, { exact: true })).toHaveCount(0);
  }
  // And the portfolio states that nothing is shared rather than reporting an outage or an empty list of errors.
  await page.goto("/coaching/coach");
  await expect(coachMain.getByText("Nothing is shared with you yet.")).toBeVisible();

  // The clock is put back where the seed left it, so a later spec reads the boundary it names rather than this one.
  await setClockTo(page, SEED_INSTANT);
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Targets", "Check-ins"]);
});

// ---------------------------------------------------------------------------------------------
// Revocation: an unrelated invalid draft does not block it, and the worker's work is untouched
// ---------------------------------------------------------------------------------------------

test("stops each grant through its own review while an unrelated draft is invalid, discloses the second grant the coach can still read through, and leaves the worker's own work in place", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, WORKER_SESSION);

  // An unrelated invalid draft, left unsaved on the check-in surface: revocation is a separate decision and
  // may not wait for someone else's editing to become valid.
  await page.goto("/coaching/check-ins");
  const editor = page.locator('[data-slot="check-in-editor"]');
  await fillUntilCounted(editor.getByRole("textbox", { name: "How did the week go?", exact: true }), OVER_LIMIT_ANSWER, editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS + 1)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true }));
  await expect(editor.getByRole("alert").filter({ hasText: "Nothing will be sent yet" })).toBeVisible();

  // Stopping a module and revoking the grant are two different effects, each with its own question, its own
  // consequence and its own assurance — and stopping a module is a review, not a silently flipped switch. Both
  // act inside the section of the grant they belong to, so a switch reached here is that relationship's own.
  await page.goto("/coaching/sharing");
  const primary = relationshipSection(page, PRIMARY_GRANT);
  await primary.getByRole("switch", { name: /^Targets /u }).click();
  const moduleStop = primary.getByRole("region", { name: "Stop sharing a module" });
  await expect(moduleStop.getByText("Stop sharing this module?")).toBeVisible();
  await expect(moduleStop.getByText("The module stops being readable from now on and is no longer part of what the invitation shares. The other modules you switched on are unaffected.")).toBeVisible();
  await expect(moduleStop.getByText("The work in the module is not deleted: your targets, check-ins and task summaries stay exactly as they are. Nothing that was already seen can be recalled.")).toBeVisible();
  await moduleStop.getByRole("button", { name: "Cancel" }).click();
  await expect(primary.getByRole("region", { name: "Stop sharing a module" })).toHaveCount(0);

  // Revoking: the review states what stops, that the work behind it stays, and that nothing already read can
  // be recalled; the confirmation is the second, deliberate step.
  await primary.getByRole("button", { name: `Revoke the grant for ${PRIMARY_GRANT}` }).click();
  const revokeReview = primary.getByRole("region", { name: "Revoke the grant" });
  await expect(revokeReview.getByText("Revoke this coach's access?")).toBeVisible();
  await expect(revokeReview.getByText("Access stops from now on for every module, and the invitation that granted it can no longer be used.")).toBeVisible();
  await expect(revokeReview.getByText("Nothing a coach has already read can be recalled, and no message is taken back: this stops what can be read from now on, and it cannot undo what has already been seen.")).toBeVisible();
  await revokeReview.getByRole("button", { name: "Revoke the grant" }).click();
  const confirmation = page.locator('[role="alertdialog"]');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Revoke the grant" }).click();
  await expect(primary.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();

  // The accepted revoke re-reads this route itself, so the surface stops naming the grant it just revoked before
  // anything navigates: the controls name the surviving relationship while the accepted record stays on screen.
  await expect(page.getByRole("button", { name: `Revoke the grant for ${FINANCIAL_GRANT}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Revoke the grant for ${PRIMARY_GRANT}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();

  // The read the surface composes is where the revoked record's state is stated, and the relationship it
  // manages is now the other live one: a revoked grant is not left standing as the record in use.
  // The read the surface composes is where the revoked record's state is stated, and every relationship the read
  // returns stays disclosed: a revoked grant is not left standing as a readable record, and the other live grant is
  // named beside it with its own controls.
  const afterRevoke = await readOverview(page);
  expect(relationshipStateOf(afterRevoke, PRIMARY_GRANT)).toBe("revoked");
  expect(activeGrantIdOf(afterRevoke)).toBe(FINANCIAL_GRANT);

  // Read again, the surface still discloses that second grant as a live relationship, with a revoke control of its
  // own: no grant a coach can read through is left unnamed after another one is stopped, and the worker can stop it
  // from this page instead of being left with access they can neither see nor end. The revoked section offers no
  // revoke control at all, because a stopped episode states its effects rather than offering them again.
  await page.goto("/coaching/sharing");
  await expect(primary).toHaveAttribute("data-state", "revoked");
  await expect(primary.getByText("Revoked by the worker").first()).toBeVisible();
  await expect(primary.getByRole("button", { name: `Revoke the grant for ${PRIMARY_GRANT}` })).toHaveCount(0);
  const financial = relationshipSection(page, FINANCIAL_GRANT);
  await expect(financial).toHaveAttribute("data-state", "active");
  await expect(financial.getByRole("button", { name: `Revoke the grant for ${FINANCIAL_GRANT}` })).toBeVisible();

  // The worker's own work is what revocation never touches: the shared check-in still holds its questions.
  await page.goto("/coaching/check-ins");
  await expect(page.getByText("Check-in state: Shared")).toBeVisible();
  await expect(page.getByText("Two good conversations and one difficult one.").first()).toBeVisible();

  // The second grant is then stopped from its own section through the same review: the worker ends the access the
  // page has just disclosed, rather than the first revoke being taken to cover a grant it never named.
  await page.goto("/coaching/sharing");
  await financial.getByRole("button", { name: `Revoke the grant for ${FINANCIAL_GRANT}` }).click();
  const financialReview = financial.getByRole("region", { name: "Revoke the grant" });
  await expect(financialReview.getByText("Revoke this coach's access?")).toBeVisible();
  await financialReview.getByRole("button", { name: "Revoke the grant" }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Revoke the grant" }).click();
  await expect(financial.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();

  // Read again, each section states the state its own record now holds, and with no live relationship left the
  // envelope publishes no revoke effect, so no section offers one: nothing is left claiming access can be stopped.
  await page.goto("/coaching/sharing");
  await expect(relationshipSection(page, PRIMARY_GRANT)).toHaveAttribute("data-state", "revoked");
  await expect(relationshipSection(page, FINANCIAL_GRANT)).toHaveAttribute("data-state", "revoked");
  await expect(page.getByRole("button", { name: /^Revoke the grant for /u })).toHaveCount(0);

  // A revoked and an ended episode are both refused to the coach, and each refusal states nothing about what it
  // withheld. What a coach is refused is judged on the grants the coach's own session record states — the store keeps
  // one document per development session (AAP 0.7.2 "Isolation": a session sees only its own files), so the worker's
  // two revokes above are asserted in the worker's own read, and the coach's refusals are asserted on the revoked and
  // ended episodes that session holds. Nothing here claims a grant this session's record does not state is refused.
  await actAs(context, origin, COACH_SESSION);
  for (const stoppedGrant of [REVOKED_GRANT, ENDED_GRANT]) {
    await page.goto(`/coaching/coach/${stoppedGrant}`);
    await expect(page.locator("main").getByText(/Reason no-permission/u)).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
  }
});

// ---------------------------------------------------------------------------------------------
// The last live relationship closed: the state the effect produced, and the record it left behind
// ---------------------------------------------------------------------------------------------

test("closes the last live relationship and keeps the accepted record beside the state the revoke produced", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, WORKER_SESSION);
  await page.goto("/coaching/sharing");

  // Both live relationships are closed; the second is the last one live, so the surface is left managing a record with
  // no access and no effect to offer.
  for (const grantId of [PRIMARY_GRANT, FINANCIAL_GRANT]) {
    await page.getByRole("button", { name: `Revoke the grant for ${grantId}`, exact: true }).click();
    const review = page.getByRole("region", { name: "Revoke the grant" });
    await review.getByRole("button", { name: "Revoke the grant", exact: true }).click();
    const confirmation = page.locator('[role="alertdialog"]');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Revoke the grant", exact: true }).click();
    await expect(relationshipSection(page, grantId).getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
  }

  // The route re-reads itself and reports the relationship it manages as revoked: the surface states the state the
  // revoke produced, not an earlier episode the worker never acted on in this session.
  // Every relationship stays disclosed and each states the state its own record now holds: the two the worker closed in
  // this session read as revoked, and the episode they never acted on in this session keeps its own ended state rather
  // than being rewritten. A surface that showed only one relationship would have to pick one and leave the other's
  // access unnamed, which is the defect this disclosure exists to close.
  for (const revokedGrant of [PRIMARY_GRANT, FINANCIAL_GRANT]) {
    const section = relationshipSection(page, revokedGrant);
    await expect(section).toHaveAttribute("data-state", "revoked");
    await expect(section.getByText("Revoked by the worker", { exact: true }).first()).toBeVisible();
  }
  await expect(relationshipSection(page, ENDED_GRANT)).toHaveAttribute("data-state", "ended");
  // And the accepted record is still what stands beside that state: the re-read that reported the closed relationship
  // may not displace the record the change itself left. Nothing is offered for a relationship with no access left.
  // Each section keeps the record of the change made in it: the receipt stands inside the section whose grant it names.
  await expect(relationshipSection(page, FINANCIAL_GRANT).getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Revoke the grant for /u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^End the coaching relationship for /u })).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// One source down: that module says so, and the others stay readable
// ---------------------------------------------------------------------------------------------

test("reports one admitted module's source as unavailable while the other admitted modules stay readable", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, COACH_SESSION);
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);

  // With every source available the financial module is one of the three the worker switched on.
  await expect(page.getByRole("tab")).toHaveText(["Support goal", "Targets", "Check-ins"]);
  await expect(page.locator("main").getByText("Unavailable right now", { exact: true })).toHaveCount(0);

  // One module's source is reported down by the scenario this session runs in, and that module states the outage.
  await setScenarioTo(page, "coaching-module-unavailable");
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);
  await expect(page.locator("main").getByText("Unavailable right now", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("The source behind this module cannot be read at the moment. This is an outage that ends on its own — not an empty module, and not the end of the relationship.")).toBeVisible();
  // Unavailable is never rendered as empty: the empty statement belongs to a module with nothing recorded.
  await expect(page.locator("main").getByText("Nothing recorded", { exact: true })).toHaveCount(0);
  // The modules that do not read that source stay usable beside it, with their own data still on screen.
  await page.getByRole("tab", { name: "Targets" }).click();
  await expect(page.locator("main").getByRole("cell", { name: "0 (Zero)" }).first()).toBeVisible();

  // The scenario is put back, and the same module answers again: an outage is not a state of the relationship.
  await setScenarioTo(page, "baseline");
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);
  await expect(page.locator("main").getByText("Unavailable right now", { exact: true })).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// The task summary: a reviewed description, the withholding rule, and Stop sharing
// ---------------------------------------------------------------------------------------------

/** The task-summary read and the two changes it admits, as the application's own transport names them. */
const TASK_SHARES_PATH = "/api/coaching/taskshare";

/** The reviewed-description limit (AAP 0.8.4: at most 240 Unicode code points), which the read states and the surface counts against. */
const MAX_DESCRIPTION_CODE_POINTS = 240;

/** The four statuses a task holds in the words the surfaces use for them, so a preview is held to the status the read reports. */
const TASK_STATUS_WORDS: Readonly<Record<string, string>> = { open: "Open", completed: "Completed", reopened: "Reopened", cancelled: "Cancelled" };

/** The three states of a share this journey passes through, in the list's own words. */
const SHARED_STATE_WORD = "Shared";
const HELD_STATE_WORD = "Held until you review it";
const REMOVED_STATE_WORD = "No longer shared";

/** The keyword a held summary states before its reason, so the withholding is named as well as explained. */
const WITHHELD_LABEL = "Description withheld";

/** The selector's empty arm, which a surface that offers the worker's own tasks never states. */
const NO_CANDIDATE_HEADING = "No task to share yet";

/** The preview panel's own name for the facts a coach reads, and the two controls the selector is driven by. */
const COACH_PREVIEW_LABEL = "What your coach will read";
const TASK_TO_SHARE_LABEL = "Task to share";
const DESCRIPTION_LABEL = "Reviewed description — a coach will read exactly this";

/** The review step's name and its one commit control. */
const SHARE_REVIEW_HEADING = "Share this summary with your coach";
const SHARE_CONFIRM_LABEL = "Share this summary";

/** The description this journey writes: the worker's own words about the work, carrying none of the task's title. */
const REVIEWED_DESCRIPTION = "Reviewed with the youth team: the next steps for Jo's follow-up and one call afterwards are agreed. Nothing about a donor, an amount or an attachment is part of this summary.";

/** The title the task is given afterwards through the application, which changes the meaning the description was reviewed against. */
const REVISED_TASK_TITLE = "Follow up with Jo about the youth weekend";

/** How the list words the withholding rule, and how it words a share that was stopped. */
const HELD_SENTENCE = "The reviewed description changed, so the summary is withheld until you review it again. Nothing new is shown in the meantime, and the task itself keeps working as before.";
const REMOVED_SENTENCE = "You stopped sharing this summary. The task itself is untouched: it keeps its title, its due date and its status.";

/** The stop step's title and the assurance it gives before it acts, which is what makes stopping distinct from deleting. */
const STOP_REVIEW_TITLE = "Stop sharing a task summary";
const STOP_REVIEW_ASSURANCE = "The task is not deleted: stopping the share changes nothing about the work itself. Nothing that was already seen can be recalled.";
const STOP_LABEL = "Stop sharing";

/** The Work surface's own labels for the two controls this journey changes a task through, and for the list it holds every task. */
const WORK_TITLE_LABEL = "Title";
const SAVE_TASK_LABEL = "Save task";
const ALL_LIST_LABEL = "All";

/**
 * The worker's own shared task summaries and the tasks they may be shared from, read through the application's
 * own transport.
 *
 * The surface a decision just changed can still be rendering the payload it was handed before it, so what a
 * share carries — and what it withholds once the task moves — is judged here, in the read that decision changed.
 */
async function readTaskShares(page: Page): Promise<unknown> {
  const response = await page.request.get(TASK_SHARES_PATH);
  if (!response.ok()) {
    throw new Error(`The task summaries could not be read from ${TASK_SHARES_PATH}: HTTP ${String(response.status())}. The share this journey made cannot be judged from a read that did not answer.`);
  }
  return await response.json();
}

test("shares one task's summary under a reviewed description a coach reads, holds it when the task's meaning changes, and stops sharing without touching the task", async ({ context, page }) => {
  const origin = await originOf(page);
  await actAs(context, origin, WORKER_SESSION);
  await page.goto("/coaching/check-ins");

  const selector = page.locator('[data-slot="task-summary-selector"]');
  const shareList = page.locator('[data-slot="task-share-list"]');

  // -------------------------------------------------------------------------------------------
  // The tasks on offer are the ones the read states, and the surface is not on its empty arm
  // -------------------------------------------------------------------------------------------

  // The candidate set is taken from the read the page itself composes, so this assertion follows the store the
  // runner seeded rather than a list of titles written into this file.
  const opened = await readTaskShares(page);
  const candidates = isRecord(opened) && isRecord(opened.data) && Array.isArray(opened.data.candidates) ? opened.data.candidates : [];
  const candidateIds = candidates.map((candidate) => (isRecord(candidate) && typeof candidate.taskId === "string" ? candidate.taskId : ""));
  const codePointLimit = isRecord(opened) && isRecord(opened.data) ? opened.data.maxCodePoints : undefined;
  expect(candidateIds.length, "The worker's own work is what a summary is shared from, so the read states at least one task.").toBeGreaterThan(0);
  expect(candidateIds, "Every candidate the read states names the task it is.").not.toContain("");
  expect(codePointLimit, "The read states the reviewed-description limit the surface counts a description against.").toBe(MAX_DESCRIPTION_CODE_POINTS);

  // A summary is shared from work this worker already has: the empty arm belongs to a session with no task at all.
  await expect(selector.getByText(NO_CANDIDATE_HEADING), "The surface offers the worker's own tasks, so it states no empty arm.").toHaveCount(0);

  const choice = selector.getByRole("combobox", { name: TASK_TO_SHARE_LABEL, exact: true });
  const options = choice.locator("option");
  await expect(options, "One choice per candidate the read states, beside the placeholder that means no choice yet.").toHaveCount(candidateIds.length + 1);
  const optionValues = await options.evaluateAll((entries) => entries.map((entry) => entry.getAttribute("value") ?? ""));
  expect(optionValues, "The list offers exactly the candidate set the read states, in the read's own order.").toEqual(["", ...candidateIds]);
  const optionTexts = await options.evaluateAll((entries) => entries.map((entry) => (entry.textContent ?? "").trim()));

  // The one task this journey shares from: an open task that does not repeat. A repeating task's occurrence is
  // shared only after a fresh selection, which is a separate rule with its own domain test.
  const chosen = candidates.find((candidate) => isRecord(candidate) && candidate.status === "open" && candidate.isRecurringSuccessor === false);
  const chosenTaskId = isRecord(chosen) ? textAt(chosen, "taskId") : undefined;
  const title = isRecord(chosen) ? textAt(chosen, "safeLabel") : undefined;
  const status = isRecord(chosen) ? textAt(chosen, "status") : undefined;
  const chosenDueDate = isRecord(chosen) ? chosen.dueDate : undefined;
  const dueOn = isRecord(chosenDueDate) && chosenDueDate.kind === "dated" ? textAt(chosenDueDate, "date") : undefined;
  const statusWord = status === undefined ? undefined : TASK_STATUS_WORDS[status];
  if (chosenTaskId === undefined || title === undefined || dueOn === undefined || statusWord === undefined) {
    throw new Error(`The read states no open task this journey can share a summary of, or states one without a label, a due day or a status this file knows the word for: ${JSON.stringify(opened).slice(0, 300)}.`);
  }

  // -------------------------------------------------------------------------------------------
  // A reviewed description, beside the live due date and status a coach will read with it
  // -------------------------------------------------------------------------------------------

  // The route's browser bundle takes hold after its document is on screen, so the choice is made until the panel
  // it drives appears: the panel is the surface's own state, which no server-rendered markup shows.
  await expect(async () => {
    await choice.selectOption(chosenTaskId);
    await expect(selector.locator('[data-slot="task-summary-preview"]')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(choice).toHaveValue(chosenTaskId);
  expect(optionTexts[candidateIds.indexOf(chosenTaskId) + 1] ?? "", "The chosen entry states the worker's own label for the task with the day it is due and the status it holds.").toContain(`${title} — ${dueOn} — ${statusWord}`);

  const preview = selector.locator('[data-slot="task-summary-preview"]');
  await expect(preview.getByText(COACH_PREVIEW_LABEL, { exact: true }), "The surface states what a coach will read before anything is shared.").toBeVisible();
  await expect(preview.getByText(dueOn, { exact: true }).first(), "The due date a coach reads is the task's own civil day, not a day this surface invented.").toBeVisible();
  await expect(preview.getByText(`Status: ${statusWord}`, { exact: true }).first(), "The status a coach reads is the one the task holds now.").toBeVisible();

  const description = selector.getByRole("textbox", { name: DESCRIPTION_LABEL, exact: true });
  await fillUntilCounted(description, REVIEWED_DESCRIPTION, selector.getByText(`Written: ${String(scalarCount(REVIEWED_DESCRIPTION))} / ${String(MAX_DESCRIPTION_CODE_POINTS)} code points`, { exact: true }));
  await expect(preview.getByText(REVIEWED_DESCRIPTION, { exact: true }).first(), "The panel states the description as it stands, which is exactly what a coach reads.").toBeVisible();
  // The task's own title is the worker's label for choosing work, and it stays that: the panel that states what a
  // coach reads carries the reviewed description, the live day and the live status, and no title.
  await expect(preview.getByText(title, { exact: true }), "A coach reads the reviewed description, never the task's raw title.").toHaveCount(0);

  // -------------------------------------------------------------------------------------------
  // One reviewed submission, and the receipt names the share it created
  // -------------------------------------------------------------------------------------------

  const review = selector.locator('[data-slot="action-review"]');
  await expect(review.getByRole("heading", { name: SHARE_REVIEW_HEADING, exact: true }), "Sharing is reviewed before it is written.").toBeVisible();
  await expect(review.getByText(REVIEWED_DESCRIPTION, { exact: true }), "The review states the description it would share.").toBeVisible();
  await review.getByRole("button", { name: SHARE_CONFIRM_LABEL }).click();
  await expect(review.getByRole("heading", { name: "Saved", exact: true }), "The share is written once, and its own receipt says so.").toBeVisible();
  const createdShareId = (
    await review
      .getByText(/^coaching-task-share-\S+$/u)
      .first()
      .innerText()
  ).trim();

  // The share the decision produced, read in the read it changed: the description that was reviewed, the task's
  // live due date and its live status — and nothing else this surface would have had to send to say them.
  const afterShare = await readTaskShares(page);
  const shares = isRecord(afterShare) && isRecord(afterShare.data) && Array.isArray(afterShare.data.shares) ? afterShare.data.shares : [];
  const shareOfTask = shares.filter((share) => isRecord(share) && share.taskId === chosenTaskId);
  expect(shareOfTask, "One share exists for the task this journey selected, under the identity its receipt named.").toHaveLength(1);
  expect(shareOfTask[0], "The share carries the reviewed description with the live due date and status, and it is the record the receipt reported.").toMatchObject({ shareId: createdShareId, taskId: chosenTaskId, state: "shared", description: REVIEWED_DESCRIPTION, status, dueDate: { kind: "dated", date: dueOn } });
  const recordedShare = shareOfTask[0];
  expect(JSON.stringify(recordedShare), "Nothing of the task's own title travels with the share, so no part of it is in the record a coach reads.").not.toContain(title);
  expect(isRecord(recordedShare) ? Object.keys(recordedShare).filter((key) => /title|note|partner|donor|amount|attachment|link|history/iu.test(key)) : ["<unreadable>"], "The record a coach reads carries no field for a title, a note, a partner, a donor, an amount, an attachment, a link or a history.").toEqual([]);

  // -------------------------------------------------------------------------------------------
  // The shared row a coach's read is projected from states the description and no title
  // -------------------------------------------------------------------------------------------

  await page.reload();
  const sharedRow = shareList.getByRole("region", { name: `${SHARED_STATE_WORD}: task summary ${chosenTaskId}` });
  await expect(sharedRow, "The summary this journey shared is the row the list states, in the shared state.").toBeVisible();
  await expect(sharedRow).toHaveAttribute("data-state", "shared");
  await expect(sharedRow.getByText(REVIEWED_DESCRIPTION, { exact: true }), "The row states the description that was reviewed.").toBeVisible();
  await expect(sharedRow.getByText(title, { exact: true }), "The row states the description a coach reads, and never the task's raw title.").toHaveCount(0);

  // -------------------------------------------------------------------------------------------
  // The task's reviewed meaning changes through the application, and the summary is withheld
  // -------------------------------------------------------------------------------------------

  // A task's title is part of the meaning its description was reviewed against, and it is changed through the
  // Work surface's own form rather than through a request this file composes.
  await page.goto("/work");
  await page.getByRole("tab", { name: ALL_LIST_LABEL }).click();
  // The task is reached by the one control the list names it by: the actions menu the row offers for its title.
  const actions = page.getByRole("button", { name: `Actions for ${title}` });
  await expect(actions, "The task the summary describes is the worker's own work, on the list that holds every task.").toBeVisible();
  await actions.click();
  await page.getByRole("menuitem", { name: `Edit for ${title}` }).click();
  const composer = page.locator('[data-slot="task-composer"][data-mode="edit"]');
  await expect(composer, "Editing opens the one task form, on the task the row names.").toBeVisible();
  await composer.getByRole("textbox", { name: new RegExp(`^${WORK_TITLE_LABEL}`, "u") }).fill(REVISED_TASK_TITLE);
  await composer.getByRole("button", { name: SAVE_TASK_LABEL }).click();
  await expect(composer.locator('[data-slot="operation-result"][data-outcome="accepted"]'), "A change to the task's own title is one accepted change to that task.").toBeVisible();

  await page.goto("/coaching/check-ins");
  const heldRow = shareList.getByRole("region", { name: `${HELD_STATE_WORD}: task summary ${chosenTaskId}` });
  await expect(heldRow, "The summary is held, and the list names that state rather than an empty or a shared one.").toBeVisible();
  await expect(heldRow).toHaveAttribute("data-state", "needs-review");
  await expect(heldRow, "A held summary states in its own words that the description is withheld and why.").toContainText(`${WITHHELD_LABEL}. ${HELD_SENTENCE}`);
  await expect(heldRow.getByText(REVIEWED_DESCRIPTION), "A held summary withholds the description it carried until it is reviewed again.").toHaveCount(0);

  const heldRead = await readTaskShares(page);
  const heldShares = isRecord(heldRead) && isRecord(heldRead.data) && Array.isArray(heldRead.data.shares) ? heldRead.data.shares : [];
  const heldShare = heldShares.filter((share) => isRecord(share) && share.taskId === chosenTaskId);
  expect(heldShare, "The withheld summary is one record, and it is still the one this journey shared.").toHaveLength(1);
  expect(heldShare[0], "The read states the summary as held and carries no description, because a changed task withholds it until it is reviewed again.").toMatchObject({ shareId: createdShareId, state: "needs-review", description: null });

  // -------------------------------------------------------------------------------------------
  // Stop sharing: the summary stops, and the task itself is untouched
  // -------------------------------------------------------------------------------------------

  await heldRow.getByRole("button", { name: `${STOP_LABEL}: task summary ${chosenTaskId}, ${HELD_STATE_WORD}` }).click();
  const stopReview = shareList.locator('[data-slot="action-review"]');
  await expect(stopReview.getByRole("heading", { name: STOP_REVIEW_TITLE, exact: true }), "Stopping a share is a review of its own, with its own effect.").toBeVisible();
  await expect(stopReview.getByText(`This stops the summary for task summary ${chosenTaskId}, currently held until you review it again.`, { exact: true })).toBeVisible();
  await expect(stopReview.getByText(STOP_REVIEW_ASSURANCE, { exact: true }).first(), "The stop states that the task itself is not deleted.").toBeVisible();
  await stopReview.getByRole("button", { name: STOP_LABEL }).click();
  const confirmStop = page.locator('[role="alertdialog"]');
  await expect(confirmStop).toBeVisible();
  await confirmStop.getByRole("button", { name: STOP_LABEL }).click();
  await expect(stopReview.getByRole("heading", { name: "Saved", exact: true }), "The stop is written once, and its own receipt says so.").toBeVisible();

  await page.reload();
  const removedRow = shareList.getByRole("region", { name: `${REMOVED_STATE_WORD}: task summary ${chosenTaskId}` });
  await expect(removedRow, "The stopped share is stated as no longer shared, not dropped from the list without a word.").toBeVisible();
  await expect(removedRow).toHaveAttribute("data-state", "removed");
  await expect(removedRow.getByText(REMOVED_SENTENCE, { exact: true })).toBeVisible();
  await expect(shareList.getByRole("button", { name: /^Stop sharing: /u }), "A stopped share offers no stop control of its own.").toHaveCount(0);

  // The source work is what stopping a share never touches: the task is still on the list, with the title it holds.
  await page.goto("/work");
  await page.getByRole("tab", { name: ALL_LIST_LABEL }).click();
  await expect(page.getByRole("button", { name: `Actions for ${REVISED_TASK_TITLE}` }), "Stopping a summary leaves the task itself on the list, with its own title.").toBeVisible();
});
