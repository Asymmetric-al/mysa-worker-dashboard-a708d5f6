/** Criterion 16 — voluntary coaching: what a coach is invited to, may read, and loses. */
import type { Locator, Page } from "@playwright/test";
import { test, expect, actAs, devStateOf, isRecord, newAttemptId, operateDevControl, parseJson, setClock, type JsonRecord } from "../playwright.config"; // The development-session cookie is the whole of the identity this application authorises a request as, and the reset restores the seeded world the assertions name. Both are the runner's own, read from it rather than repeated here, so this file cannot silently act as an identity or a seed the runner no longer means.
const WORKER_SESSION = "established-worker";
const COACH_SESSION = "coach"; // The coach admitted read-only to exactly the modules and periods the worker switched on.
const PRIMARY_GRANT = "grant-established-coach";
const FINANCIAL_GRANT = "grant-established-coach-support";
const COACH_PRINCIPAL = "principal-coach"; // The principal that coach acts as, which every relationship section names beside the grant it discloses.
const REVOKED_GRANT = "grant-revoked-coach"; // An episode the worker revoked: the coach may no longer read it, and revoking never recalled what was seen.
const ENDED_GRANT = "grant-ended-coach"; // An episode the worker ended: a later action cannot reopen it, so the coach's read is refused.
const CUTOFF_INSTANT = "2026-12-31T00:00:00Z";
const FROZEN_ZONE = "Europe/London";
const FIVE_MODULES = ["Support goal", "Support results", "Targets", "Check-ins", "Task summaries"] as const;
const UNSHARED_MODULES = ["Support goal", "Support results", "Task summaries"] as const; // The three modules the primary grant does not share: their names must appear nowhere in that coach's view.
const MAX_QUESTIONS = 5;
const MAX_ANSWER_SCALARS = 4000;
const FULL_ANSWER = "a".repeat(MAX_ANSWER_SCALARS); // An answer of exactly the maximum length: the value that must be accepted intact, never shortened.
const OVER_LIMIT_ANSWER = "a".repeat(MAX_ANSWER_SCALARS + 1); // One character past the maximum: the value that must be refused with its count and left in the field.
const SIXTH_QUESTION = "What should change next week?"; // A sixth question, offered to a set that already holds the maximum: it is refused, and nothing is dropped.
const ACCEPTED_QUESTIONS = ["What went well?", "What was hard?"] as const;
const COACH_WRITE_QUESTION = "A question only a coach could write"; // What the coach identity attempts to write, so the worker's own surfaces can show it never arrived.
const COACH_WRITE_ANSWER = "An answer only a coach could write";
const CHECK_INS_PATH = "/api/coaching/checkins"; // The development control's two verbs, which this file operates as values rather than re-deriving URLs.
const relationshipSection = (page: Page, grantId: string): Locator => page.locator(`[data-slot="coaching-relationship"][data-grant="${grantId}"]`); // The section the sharing surface opens for one relationship, addressed by the grant reference it is disclosed under: every relationship the read returns is disclosed, so a module row, a switch or a stop review belongs to the grant whose section holds them.
async function revokeGrant(page: Page, grantId: string, reviewTexts: readonly string[] = ["Revoke this coach's access?"]): Promise<void> {
  const section = relationshipSection(page, grantId); // Revokes one relationship through its own review, which states what stops and what stays, and the confirmation behind it, then waits for that section's receipt.
  await section.getByRole("button", { name: `Revoke the grant for ${grantId}` }).click();
  const review = section.getByRole("region", { name: "Revoke the grant" });
  for (const stated of reviewTexts) await expect(review.getByText(stated)).toBeVisible();
  await review.getByRole("button", { name: "Revoke the grant" }).click();
  const confirmation = page.locator('[role="alertdialog"]');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Revoke the grant" }).click();
  await expect(section.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
}
const GRANT_STATES: Readonly<Record<string, string>> = { [PRIMARY_GRANT]: "active", [FINANCIAL_GRANT]: "active", [REVOKED_GRANT]: "revoked", [ENDED_GRANT]: "ended" }; // The lifecycle each seeded relationship's own record stands in, in the read the sharing surface composes.
function textAt(value: unknown, member: string): string | undefined {
  const found = isRecord(value) ? value[member] : undefined; // One optional string a record states, so a field the read omits is read as absent rather than as a failure.
  return typeof found === "string" && found.length > 0 ? found : undefined;
}
const setClockTo = async (page: Page, instant: string): Promise<void> => setClock(page.request, instant); // Stands this session's scenario clock at one absolute instant, which is how a boundary is reached exactly.
const advanceClockBy = (page: Page, bySeconds: number): Promise<JsonRecord> => operateDevControl(page.request, "advanceClock", { bySeconds });
const setScenarioTo = (page: Page, scenarioId: string): Promise<JsonRecord> => operateDevControl(page.request, "setScenario", { scenarioId });
const scalarCount = (text: string): number => [...text].length;
async function fillUntilCounted(field: Locator, value: string, counter: Locator): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(counter).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(field).toHaveValue(value);
}
type Attempt = { readonly label: string; readonly response: { readonly status: () => number }; readonly body: unknown }; // A mutation attempt through the application's own transport: the verb it used, the body it sent, and what came back.
async function submitCheckIn(page: Page, label: string, payload: Readonly<Record<string, unknown>>): Promise<Attempt> {
  const { scope, revision } = await devStateOf(page.request); // Submits one named coaching mutation as the identity the cookie jar currently holds.
  const response = await page.request.post(CHECK_INS_PATH, { data: { operationId: newAttemptId(), scope, expectedRevision: revision, payload } });
  return { label, response, body: parseJson(await response.text()) };
}
function storedAnswerLengths(value: unknown, checkInId: string): readonly number[] {
  const checkIns = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.checkIns) ? value.data.checkIns : []; // The answers a stored check-in holds, read back from the list so a length is measured on what the service kept.
  const stored = checkIns.find((candidate) => isRecord(candidate) && candidate.checkInId === checkInId);
  if (!isRecord(stored) || !isRecord(stored.privateDraft) || !Array.isArray(stored.privateDraft.answers)) {
    throw new Error(`The check-in ${JSON.stringify(checkInId)} is not in the list this read returned, so the length of the answers it kept could not be measured. A saved check-in has to be readable from its own list; if the read no longer states one, name what it states instead.`);
  }
  return stored.privateDraft.answers.map((answer) => (isRecord(answer) && typeof answer.text === "string" ? scalarCount(answer.text) : -1));
}
test("records an invitation that names the person, the ministry, the five unselected modules and a duration — and claims only the first of four outcomes", async ({ page }) => {
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/sharing");
  await expect(page.getByText("Development data", { exact: true })).toBeVisible();
  await expect(page.getByText("These four things are separate outcomes, and recording an invitation reaches only the first: it sends no message, verifies nobody and makes nothing readable.")).toBeVisible();
  for (const outcome of ["Invitation recorded", "Identity verified", "Accepted deliberately", "Access live"]) await expect(page.getByText(outcome, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("A matching address, an existing relationship or a staff title verifies nobody on its own.").first()).toBeVisible();
  await expect(page.getByText(/no mail leaves this application/u).first(), "The invitation is a record in this application, and the surface labels the message it does not send").toBeVisible();
  const form = page.locator('[data-slot="invitation-form"]');
  const review = form.locator('[data-slot="action-review"]');
  await expect(form.getByText("Every module is recorded as switched off when the invitation is created. You choose which ones to switch on once the person has accepted, so nothing here pre-selects a module and no module can be read before then.")).toBeVisible();
  await expect(review.getByText("— Starts unselected")).toHaveCount(FIVE_MODULES.length);
  await expect(form.getByText("A typed name or address would establish nothing: an address that looks the same verifies nobody.")).toBeVisible();
  const recipient = form.getByRole("combobox", { name: /^Coach/u });
  const invitable = invitableCoachesOf(await readOverview(page));
  expect(invitable, "The people an invitation can name are the ones the service's own identity records hold — one entry per principal with a signed-in session, the person acting left out — stated by the opaque reference the record carries rather than a name resolved from another record").toContain(COACH_PRINCIPAL);
  await expect(recipient.locator("option")).toHaveText(["Choose the person to invite", ...invitable]);
  const organization = form.getByRole("combobox", { name: /^Organization/u });
  await expect(organization.locator("option")).toHaveText(["Choose the organization", "Harbour Community Church"]);
  const ministry = form.getByRole("combobox", { name: /^Ministry/u });
  await expect(ministry.locator("option")).toHaveText(["Choose the ministry", "Youth Ministry", "Students Ministry"]);
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
  await form.getByRole("radio", { name: "Through a date you choose" }).check();
  await form.getByLabel(/^Share through/u).fill("2027-01-31");
  await review.getByRole("button", { name: "Record invitation" }).click();
  await expect(review.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
  await expect(review.getByText(/^coaching-grant-\S+$/u)).toBeVisible();
  await expect(review.getByText("This step is complete for this attempt, and the result below is its record. Changing what this step would apply begins a new attempt with its own identity.")).toBeVisible();
  await expect(form.getByText("Recording an invitation reached the first of the four outcomes above and no further: identity verification, deliberate acceptance and live access have not happened.")).toBeVisible();
});
test("shows a coach only the modules switched on and offers no write of any kind, while the worker's own work stays untouched", async ({ page }) => {
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/sharing");
  const overview = await readOverview(page); // Every relationship the read returns is disclosed, each in its own section named by the grant it carries: a surface that showed only the live one it named first would leave the others — and the access a coach still holds through them — unnamed.
  const disclosed = grantIdsOf(overview);
  const readable = readableGrantIdsOf(overview);
  expect(readable).toEqual(expect.arrayContaining([PRIMARY_GRANT, FINANCIAL_GRANT]));
  await expect(page.locator('[data-slot="coaching-relationship"]')).toHaveCount(disclosed.length);
  for (const grantId of disclosed) {
    const section = relationshipSection(page, grantId);
    await expect(section).toHaveCount(1);
    await expect(section.locator('[data-slot="module-toggle-row"]'), "A relationship the read admitted states its five switches; one it refused offers no switch at all, because a module row there would describe sharing the read has already ended").toHaveCount(readable.includes(grantId) ? FIVE_MODULES.length : 0);
    if (!readable.includes(grantId)) await expect(section.getByText(refusalMessageOf(overview, grantId))).toBeVisible();
  }
  for (const seededGrant of [PRIMARY_GRANT, FINANCIAL_GRANT, REVOKED_GRANT, ENDED_GRANT]) {
    expect(disclosed).toContain(seededGrant);
    await expect(relationshipSection(page, seededGrant).getByRole("heading", { level: 2, name: `Sharing with ${COACH_PRINCIPAL} under ${seededGrant}` })).toBeVisible();
  }
  for (const [grantId, state] of Object.entries(GRANT_STATES)) await expect(relationshipSection(page, grantId)).toHaveAttribute("data-state", state);
  const primary = relationshipSection(page, PRIMARY_GRANT);
  await expect(primary.locator('[data-slot="module-toggle-row"]'), "Inside the primary grant's own section, what the worker switched on is stated module by module: a switch reached here is that relationship's own").toHaveCount(FIVE_MODULES.length);
  for (const moduleName of FIVE_MODULES) await expect(primary.getByRole("switch", { name: new RegExp(`^${moduleName} `, "u") })).toHaveCount(1);
  for (const moduleName of UNSHARED_MODULES) await expect(primary.getByRole("switch", { name: new RegExp(`^${moduleName} Switched off$`, "u") })).toHaveAttribute("aria-checked", "false");
  await expect(primary.getByText("This module is switched off, so your coach cannot read it.").first()).toBeVisible();
  await expect(primary.getByText("No financial range has been shared with a coach yet."), "No reviewed financial range is shared under this grant, and its own section states that rather than a zero").toHaveCount(1);
  const reviewed = relationshipSection(page, FINANCIAL_GRANT);
  for (const word of ["2026-10-01", "2026-10-31", "USD"]) await expect(reviewed.getByText(word, { exact: true }).first()).toBeVisible();
  await expect(reviewed.getByText(/40\.00 USD/u).first()).toBeVisible();
  await expect(reviewed.getByText("No financial range has been shared with a coach yet.")).toHaveCount(0);
  await actAs(page, COACH_SESSION);
  await page.goto("/coaching/coach");
  await expect(page.getByText("This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was already read.")).toBeVisible();
  for (const rowName of [/min-harbour-youth Targets Check-ins /u, /min-harbour-youth Support goal Targets Check-ins /u]) await expect(page.getByRole("row", { name: rowName })).toBeVisible();
  await expect(page.getByRole("table", { name: "Coaching relationships" }).getByRole("row")).toHaveCount(3);
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Targets", "Check-ins"]);
  for (const moduleName of UNSHARED_MODULES) for (const absent of [page.getByRole("tab", { name: moduleName }), page.getByText(moduleName, { exact: true })]) await expect(absent).toHaveCount(0);
  await expect(page.getByText(/my own wording/u), "A private target label the worker wrote is never disclosed to a coach; A private target label belongs to the worker and is never disclosed, so half of it is not on this page either").toHaveCount(0);
  await expect(page.getByText(/my own wording/u), "A private target label the worker wrote is never disclosed to a coach").toHaveCount(0);
  await expect(page.locator("main").getByRole("cell", { name: "0 (Zero)" }).first(), "A recorded zero is drawn as a zero and named as one: it is not an empty period, and it is not hidden").toBeVisible();
  const coachMain = page.locator("main");
  await expect(coachMain.getByRole("button", { name: /edit|comment|assign|remind|complete|reopen|export|impersonate/iu }), "No coach write exists here: no control edits, comments, assigns, reminds, completes, reopens or exports, and the one action the coach identity holds is their own departure").toHaveCount(0);
  await expect(coachMain.getByRole("link", { name: /edit|comment|export/iu })).toHaveCount(0);
  await expect(coachMain.getByRole("button", { name: `Leave the coaching relationship for ${PRIMARY_GRANT}` })).toHaveCount(1);
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Support goal", "Targets", "Check-ins"]);
  await expect(page.locator('main a[href^="/support/"], main a[href^="/partners/"]')).toHaveCount(0);
  const attempt = await submitCheckIn(page, "the coach saving a private check-in", { operation: "saveCheckIn", questions: [COACH_WRITE_QUESTION], answers: [COACH_WRITE_ANSWER] });
  expect(attempt.body, "A write attempted through the application's own transport is refused for the identity, so the absence of a control is not what protects the worker's records").toMatchObject({ outcome: "denied" });
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/check-ins");
  await expect(page.getByText(COACH_WRITE_ANSWER)).toHaveCount(0);
  await expect(page.getByText(COACH_WRITE_QUESTION)).toHaveCount(0);
});
async function readOverview(page: Page): Promise<unknown> {
  const response = await page.request.get("/api/coaching"); // The coaching overview the sharing surface itself composes, read through the application's own transport.
  if (!response.ok()) throw new Error(`The coaching overview could not be read: HTTP ${String(response.status())}. The state this file just changed cannot be judged from a read that did not answer.`);
  return await response.json();
}
function activeGrantIdOf(value: unknown): string {
  const active = isRecord(value) && isRecord(value.data) ? value.data.activeGrantId : undefined; // The relationship the surface manages, as the same read reports it: the live one, chosen from records rather
  if (typeof active !== "string" || active.length === 0) throw new Error(`The coaching overview names no live relationship, so the surface has nothing left to manage: ${JSON.stringify(value).slice(0, 300)}.`);
  return active;
}
function invitableCoachesOf(value: unknown): readonly string[] {
  const coaches = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.invitableCoaches) ? value.data.invitableCoaches : []; // The people the coaching overview offers an invitation, in the order it states them: the form's choice is held to this list rather than to a roster written into this file.
  const names = coaches.map((coach) => (isRecord(coach) && typeof coach.displayName === "string" ? coach.displayName : ""));
  if (names.includes("")) throw new Error(`The coaching overview states an invitable person with no name to choose: ${JSON.stringify(value).slice(0, 300)}.`);
  return names;
}
const relationshipsOf = (value: unknown): readonly unknown[] => (isRecord(value) && isRecord(value.data) && Array.isArray(value.data.relationships) ? value.data.relationships : []); // The relationships the coaching overview reports, in the order it states them, or nothing when the read states none.
function grantIdsOf(value: unknown): readonly string[] {
  const ids = relationshipsOf(value).map((candidate) => (isRecord(candidate) && typeof candidate.grantId === "string" ? candidate.grantId : "")); // The grant references the coaching overview reports, in the order it states them: the sharing surface is held to disclosing exactly these.
  if (ids.length === 0 || ids.includes("")) throw new Error(`The coaching overview states no relationship this test can address: ${JSON.stringify(value).slice(0, 300)}.`);
  return ids;
}
const readableGrantIdsOf = (value: unknown): readonly string[] => relationshipsOf(value).flatMap((candidate) => (isRecord(candidate) && typeof candidate.grantId === "string" && candidate.readRefusal === null ? [candidate.grantId] : [])); // The grants the coaching overview admitted, which are the ones a coach can read through right now.
function refusalMessageOf(value: unknown, grantId: string): string {
  const found = relationshipsOf(value).find((candidate) => isRecord(candidate) && candidate.grantId === grantId); // The refusal message the coaching overview states for one relationship, taken from the same read the page composes.
  const message = isRecord(found) && isRecord(found.readRefusal) ? found.readRefusal.message : undefined;
  if (typeof message !== "string" || message.length === 0) throw new Error(`The coaching overview states no refusal for ${JSON.stringify(grantId)}, so the refusal this test expects on the surface cannot be named: ${JSON.stringify(value).slice(0, 300)}.`);
  return message;
}
function relationshipStateOf(value: unknown, grantId: string): string {
  const found = relationshipsOf(value).find((candidate) => isRecord(candidate) && candidate.grantId === grantId); // The lifecycle state one relationship stands in, read from the overview the sharing surface itself composes.
  if (!isRecord(found) || typeof found.state !== "string") throw new Error(`The coaching overview states no relationship ${JSON.stringify(grantId)}, so the state of the record this test acted on could not be read: ${JSON.stringify(value).slice(0, 300)}.`);
  return found.state;
}
function createdIdOf(value: unknown): string {
  const created = isRecord(value) && Array.isArray(value.created) ? value.created[0] : undefined; // The identity an accepted save reports as created, which the list read then has to hold.
  if (typeof created !== "string" || created.length === 0) throw new Error(`The accepted save reported no created identity, so the record it wrote could not be read back: ${JSON.stringify(value).slice(0, 300)}. A save that reports no identity gives a spec nothing to measure the stored text against.`);
  return created;
}
test("refuses a check-in past a limit with the count it reached, keeps an exactly-at-limit value intact, and never shortens what was written", async ({ page }) => {
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/check-ins");
  const editor = page.locator('[data-slot="check-in-editor"]');
  for (const limit of ["At most 5 questions in one check-in.", "At most 500 characters in a question, counted one per Unicode character, so a character outside the basic plane counts once.", "At most 4000 characters in an answer, counted the same way.", "At most 262144 bytes once the whole check-in is sent."]) {
    await expect(editor.getByText(limit, { exact: true })).toBeVisible();
  }
  await expect(editor.getByText("A value that crosses one of these limits is refused with the count it reached, and it is never shortened: nothing you wrote is cut down to fit, and no question leaves the set without you removing it yourself.")).toBeVisible();
  await expect(editor.getByText(`This check-in carries 2 of ${String(MAX_QUESTIONS)} questions.`, { exact: true })).toBeVisible();
  await expect(editor.getByRole("heading", { name: /^Your private draft/u })).toBeVisible();
  await expect(editor.getByRole("heading", { name: /^The shared revision/u })).toBeVisible();
  const firstAnswer = editor.getByRole("textbox", { name: "How did the week go?", exact: true });
  const secondAnswer = editor.getByRole("textbox", { name: "What would help next week?", exact: true });
  await fillUntilCounted(firstAnswer, FULL_ANSWER, editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true }));
  await fillUntilCounted(secondAnswer, FULL_ANSWER, editor.getByText(`Answer 2 is ${String(MAX_ANSWER_SCALARS)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true }));
  const questionField = editor.getByRole("textbox", { name: "The question you want to answer" });
  for (const [index, wording] of ["Who did you speak to this week?", "What did you learn from them?", "What will you do next?"].entries()) {
    await questionField.fill(wording);
    await editor.getByRole("button", { name: "Add question" }).click();
    await editor.getByRole("textbox", { name: wording, exact: true }).fill(FULL_ANSWER);
    await expect(editor.getByText(`Answer ${String(index + 3)} is ${String(MAX_ANSWER_SCALARS)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true })).toBeVisible();
  }
  await expect(editor.getByText(`This check-in carries ${String(MAX_QUESTIONS)} of ${String(MAX_QUESTIONS)} questions.`, { exact: true })).toBeVisible();
  await questionField.fill(SIXTH_QUESTION);
  await editor.getByRole("button", { name: "Add question" }).click();
  await expect(editor.getByText(`This check-in carries ${String(MAX_QUESTIONS)} of ${String(MAX_QUESTIONS)} questions, so a further question is refused rather than added. Take one out first, and nothing here was dropped.`, { exact: true })).toBeVisible();
  await expect(editor.getByRole("textbox", { name: /^Question \d wording$/u })).toHaveCount(MAX_QUESTIONS);
  await expect(questionField).toHaveValue(SIXTH_QUESTION);
  await firstAnswer.fill(OVER_LIMIT_ANSWER);
  await expect(editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS + 1)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true })).toBeVisible();
  await expect(editor.getByRole("alert").filter({ hasText: "Nothing will be sent yet" })).toBeVisible();
  await expect(editor.getByText("One value is outside a limit: it is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped.")).toBeVisible();
  await expect(editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS + 1)} characters long and the limit is ${String(MAX_ANSWER_SCALARS)}. Nothing was dropped: word it within the limit and save again.`, { exact: true })).toBeVisible();
  await expect(firstAnswer).toHaveValue(OVER_LIMIT_ANSWER);
  await expect(editor.getByRole("button", { name: "Save private draft" })).toBeDisabled();
  await expect(editor.getByText("Your private draft and the shared revision hold different text, and the shared revision changes only through Update shared check-in.")).toBeVisible();
  const atLimit = await submitCheckIn(page, "a check-in at both limits", { operation: "saveCheckIn", questions: [...ACCEPTED_QUESTIONS], answers: ACCEPTED_QUESTIONS.map(() => FULL_ANSWER) });
  expect(atLimit.body, "The service is asked the same questions the editor asked, so the boundary is proven where it is enforced: a value at the limit is stored at its full length, and one past it is refused with its count").toMatchObject({ outcome: "accepted" });
  const created = createdIdOf(atLimit.body);
  const list = await page.request.get(CHECK_INS_PATH);
  expect(list.ok()).toBe(true);
  expect(storedAnswerLengths(await list.json(), created)).toEqual(ACCEPTED_QUESTIONS.map(() => MAX_ANSWER_SCALARS));
  expect((await submitCheckIn(page, "a check-in with one answer past the limit", { operation: "saveCheckIn", questions: [ACCEPTED_QUESTIONS[0]], answers: [OVER_LIMIT_ANSWER] })).body).toMatchObject({ outcome: "invalid", fields: { "answers.0": [expect.stringContaining("4001 characters long and the limit is 4000")] } });
  const overQuestions = await submitCheckIn(page, "a check-in with six questions", { operation: "saveCheckIn", questions: Array.from({ length: MAX_QUESTIONS + 1 }, (_, index) => `Question ${String(index + 1)}?`), answers: Array.from({ length: MAX_QUESTIONS + 1 }, () => "An answer.") });
  expect(overQuestions.body).toMatchObject({ outcome: "invalid", fields: { questions: [expect.stringContaining("This check-in carries 6 questions and the limit is 5")] } });
  const oversized = await submitCheckIn(page, "a check-in past the request ceiling", { operation: "saveCheckIn", questions: [...ACCEPTED_QUESTIONS], answers: Array.from({ length: 70 }, () => FULL_ANSWER) });
  expect(oversized.body).toMatchObject({ outcome: "invalid", fields: { _root: [expect.stringContaining("passed the 262144-byte limit")] } });
});
test("admits a coach one second before the frozen cutoff, denies the read at the instant itself, and leaves the cutoff where the acceptance froze it", async ({ page }) => {
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/sharing"); // The cutoff is the exclusive start of the civil day after the share-through date, and it was frozen when the episode began. A display preference changes how dates are shown to this worker and nothing else.
  const primary = relationshipSection(page, PRIMARY_GRANT);
  await expect(primary.getByText(CUTOFF_INSTANT, { exact: true })).toBeVisible();
  await expect(primary.getByText(FROZEN_ZONE, { exact: true })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("combobox", { name: "Display time zone" }).selectOption("Pacific/Auckland");
  await page.goto("/coaching/sharing");
  await expect(primary.getByText(CUTOFF_INSTANT, { exact: true })).toBeVisible();
  await expect(primary.getByText(FROZEN_ZONE, { exact: true })).toBeVisible();
  await actAs(page, COACH_SESSION);
  await setClockTo(page, "2026-12-30T23:59:59Z");
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Targets", "Check-ins"]);
  await advanceClockBy(page, 1); // At the cutoff the very same read is refused — as it would be if a stored status still looked live, because the bound is evaluated when the read runs and not when a label was written.
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  const coachMain = page.locator("main");
  await expect(coachMain.getByText("This request is not permitted in the current scope and session.")).toBeVisible();
  await expect(coachMain.getByText(/Reason no-permission/u)).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  for (const moduleName of ["Targets", "Check-ins"]) await expect(coachMain.getByText(moduleName, { exact: true })).toHaveCount(0);
  await page.goto("/coaching/coach");
  await expect(coachMain.getByText("Nothing is shared with you yet.")).toBeVisible();
  await setClockTo(page, "2026-11-20T00:00:00Z");
  await page.goto(`/coaching/coach/${PRIMARY_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Targets", "Check-ins"]);
});
test("stops each grant through its own review while an unrelated draft is invalid, discloses the second grant the coach can still read through, and leaves the worker's own work in place", async ({ page }) => {
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/check-ins");
  const editor = page.locator('[data-slot="check-in-editor"]');
  await fillUntilCounted(editor.getByRole("textbox", { name: "How did the week go?", exact: true }), OVER_LIMIT_ANSWER, editor.getByText(`Answer 1 is ${String(MAX_ANSWER_SCALARS + 1)} of ${String(MAX_ANSWER_SCALARS)} characters.`, { exact: true }));
  await expect(editor.getByRole("alert").filter({ hasText: "Nothing will be sent yet" })).toBeVisible();
  await page.goto("/coaching/sharing"); // Stopping a module and revoking the grant are two different effects, each with its own question, its own consequence and its own assurance — and stopping a module is a review, not a silently flipped switch. Both act inside the section of the grant they belong to, so a switch reached here is that relationship's own.
  const primary = relationshipSection(page, PRIMARY_GRANT);
  await primary.getByRole("switch", { name: /^Targets /u }).click();
  const moduleStop = primary.getByRole("region", { name: "Stop sharing a module" });
  for (const value of [
    "Stop sharing this module?",
    "The module stops being readable from now on and is no longer part of what the invitation shares. The other modules you switched on are unaffected.",
    "The work in the module is not deleted: your targets, check-ins and task summaries stay exactly as they are. Nothing that was already seen can be recalled.",
  ])
    await expect(moduleStop.getByText(value)).toBeVisible();
  await moduleStop.getByRole("button", { name: "Cancel" }).click();
  await expect(primary.getByRole("region", { name: "Stop sharing a module" })).toHaveCount(0);
  await revokeGrant(page, PRIMARY_GRANT, [
    "Revoke this coach's access?",
    "Access stops from now on for every module, and the invitation that granted it can no longer be used.",
    "Nothing a coach has already read can be recalled, and no message is taken back: this stops what can be read from now on, and it cannot undo what has already been seen.",
  ]);
  await expect(page.getByRole("button", { name: `Revoke the grant for ${FINANCIAL_GRANT}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Revoke the grant for ${PRIMARY_GRANT}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
  const afterRevoke = await readOverview(page); // The read the surface composes is where the revoked record's state is stated, and every relationship the read returns stays disclosed: a revoked grant is not left standing as a readable record, and the other live grant is named beside it with its own controls.
  expect(relationshipStateOf(afterRevoke, PRIMARY_GRANT)).toBe("revoked");
  expect(activeGrantIdOf(afterRevoke)).toBe(FINANCIAL_GRANT);
  await page.goto("/coaching/sharing"); // Read again, the surface still discloses that second grant as a live relationship, with a revoke control of its own: no grant a coach can read through is left unnamed after another one is stopped, and the worker can stop it from this page instead of being left with access they can neither see nor end.
  await expect(primary).toHaveAttribute("data-state", "revoked");
  await expect(primary.getByText("Revoked by the worker").first()).toBeVisible();
  await expect(primary.getByRole("button", { name: `Revoke the grant for ${PRIMARY_GRANT}` })).toHaveCount(0);
  const financial = relationshipSection(page, FINANCIAL_GRANT);
  await expect(financial).toHaveAttribute("data-state", "active");
  await expect(financial.getByRole("button", { name: `Revoke the grant for ${FINANCIAL_GRANT}` })).toBeVisible();
  await page.goto("/coaching/check-ins");
  await expect(page.getByText("Check-in state: Shared")).toBeVisible();
  await expect(page.getByText("Two good conversations and one difficult one.").first()).toBeVisible();
  await page.goto("/coaching/sharing"); // A revoked and an ended episode are both refused to the coach, and each refusal states nothing about what it withheld. The second grant is stopped first, from its own section through the same review: the worker ends the access the page has just disclosed, rather than the first revoke being taken to cover a grant it never named.
  await revokeGrant(page, FINANCIAL_GRANT);
  await page.goto("/coaching/sharing");
  await expect(relationshipSection(page, PRIMARY_GRANT)).toHaveAttribute("data-state", "revoked");
  await expect(relationshipSection(page, FINANCIAL_GRANT)).toHaveAttribute("data-state", "revoked");
  await expect(page.getByRole("button", { name: /^Revoke the grant for /u })).toHaveCount(0);
  await actAs(page, COACH_SESSION); // What a coach is refused is judged on the grants the coach's own session record states — the store keeps one document per development session, so the worker's two revokes above are asserted in the worker's own read, and the coach's refusals are asserted on the revoked and ended episodes that session holds.
  for (const stoppedGrant of [REVOKED_GRANT, ENDED_GRANT]) {
    await page.goto(`/coaching/coach/${stoppedGrant}`);
    await expect(page.locator("main").getByText(/Reason no-permission/u)).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
  }
});
test("closes the last live relationship and keeps the accepted record beside the state the revoke produced", async ({ page }) => {
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/sharing");
  for (const grantId of [PRIMARY_GRANT, FINANCIAL_GRANT]) await revokeGrant(page, grantId);
  for (const revokedGrant of [PRIMARY_GRANT, FINANCIAL_GRANT]) {
    const section = relationshipSection(page, revokedGrant); // Every relationship stays disclosed and each states the state its own record now holds: the two the worker closed in this session read as revoked, and the episode they never acted on keeps its own ended state rather than being rewritten.
    await expect(section).toHaveAttribute("data-state", "revoked");
    await expect(section.getByText("Revoked by the worker", { exact: true }).first()).toBeVisible();
  }
  await expect(relationshipSection(page, ENDED_GRANT)).toHaveAttribute("data-state", "ended");
  await expect(relationshipSection(page, FINANCIAL_GRANT).getByRole("heading", { name: "Saved", exact: true }), "The accepted record is still what stands beside that state — each section keeps the receipt of the change made in it — and nothing is offered for a relationship with no access left").toBeVisible();
  await expect(page.getByRole("button", { name: /^Revoke the grant for /u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^End the coaching relationship for /u })).toHaveCount(0);
});
test("reports one admitted module's source as unavailable while the other admitted modules stay readable", async ({ page }) => {
  await actAs(page, COACH_SESSION);
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);
  await expect(page.getByRole("tab")).toHaveText(["Support goal", "Targets", "Check-ins"]);
  await expect(page.locator("main").getByText("Unavailable right now", { exact: true })).toHaveCount(0);
  await setScenarioTo(page, "coaching-module-unavailable");
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);
  await expect(page.locator("main").getByText("Unavailable right now", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("The source behind this module cannot be read at the moment. This is an outage that ends on its own — not an empty module, and not the end of the relationship.")).toBeVisible();
  await expect(page.locator("main").getByText("Nothing recorded", { exact: true }), "Unavailable is never rendered as empty: the empty statement belongs to a module with nothing recorded").toHaveCount(0);
  await page.getByRole("tab", { name: "Targets" }).click();
  await expect(page.locator("main").getByRole("cell", { name: "0 (Zero)" }).first()).toBeVisible();
  await setScenarioTo(page, "baseline");
  await page.goto(`/coaching/coach/${FINANCIAL_GRANT}`);
  await expect(page.locator("main").getByText("Unavailable right now", { exact: true })).toHaveCount(0);
});
/** The task-summary surface's own words: the read and the changes it admits, the states a share passes through, and the one description this journey writes. */
const SUMMARY = {
  path: "/api/coaching/taskshare",
  maxCodePoints: 240,
  statusWords: { open: "Open", completed: "Completed", reopened: "Reopened", cancelled: "Cancelled" } as Readonly<Record<string, string>>,
  shared: "Shared",
  held: "Held until you review it",
  removed: "No longer shared",
  withheld: "Description withheld",
  noCandidate: "No task to share yet",
  preview: "What your coach will read",
  choice: "Task to share",
  description: "Reviewed description — a coach will read exactly this",
  reviewHeading: "Share this summary with your coach",
  confirm: "Share this summary",
  descriptionText: "Reviewed with the youth team: the next steps for Jo's follow-up and one call afterwards are agreed. Nothing about a donor, an amount or an attachment is part of this summary.",
  revisedTitle: "Follow up with Jo about the youth weekend",
  heldSentence: "The reviewed description changed, so the summary is withheld until you review it again. Nothing new is shown in the meantime, and the task itself keeps working as before.",
  removedSentence: "You stopped sharing this summary. The task itself is untouched: it keeps its title, its due date and its status.",
  stopTitle: "Stop sharing a task summary",
  stopAssurance: "The task is not deleted: stopping the share changes nothing about the work itself. Nothing that was already seen can be recalled.",
  stop: "Stop sharing",
  titleLabel: "Title",
  saveTask: "Save task",
  allList: "All",
} as const;
async function readTaskShares(page: Page): Promise<unknown> {
  const response = await page.request.get(SUMMARY.path); // The worker's own shared task summaries and the tasks they may be shared from, read through the application's own transport, because the surface a decision just changed can still be rendering the payload it was handed before it.
  if (!response.ok()) throw new Error(`The task summaries could not be read from ${SUMMARY.path}: HTTP ${String(response.status())}. The share this journey made cannot be judged from a read that did not answer.`);
  return await response.json();
}
test("shares one task's summary under a reviewed description a coach reads, holds it when the task's meaning changes, and stops sharing without touching the task", async ({ page }) => {
  await actAs(page, WORKER_SESSION);
  await page.goto("/coaching/check-ins");
  const selector = page.locator('[data-slot="task-summary-selector"]');
  const shareList = page.locator('[data-slot="task-share-list"]');
  const opened = await readTaskShares(page);
  const candidates = isRecord(opened) && isRecord(opened.data) && Array.isArray(opened.data.candidates) ? opened.data.candidates : [];
  const candidateIds = candidates.map((candidate) => (isRecord(candidate) && typeof candidate.taskId === "string" ? candidate.taskId : ""));
  const codePointLimit = isRecord(opened) && isRecord(opened.data) ? opened.data.maxCodePoints : undefined;
  expect(candidateIds.length, "The worker's own work is what a summary is shared from, so the read states at least one task.; The candidate set is taken from the read the page itself composes, so this assertion follows the store the runner seeded rather than a list of titles written into this file").toBeGreaterThan(0);
  expect(candidateIds, "Every candidate the read states names the task it is.").not.toContain("");
  expect(codePointLimit, "The read states the reviewed-description limit the surface counts a description against.").toBe(SUMMARY.maxCodePoints);
  await expect(selector.getByText(SUMMARY.noCandidate), "The surface offers the worker's own tasks, so it states no empty arm.; A summary is shared from work this worker already has: the empty arm belongs to a session with no task at all").toHaveCount(0);
  await expect(selector.getByText(SUMMARY.noCandidate), "The surface offers the worker's own tasks, so it states no empty arm.").toHaveCount(0);
  const choice = selector.getByRole("combobox", { name: SUMMARY.choice, exact: true });
  const options = choice.locator("option");
  await expect(options, "One choice per candidate the read states, beside the placeholder that means no choice yet.").toHaveCount(candidateIds.length + 1);
  const optionValues = await options.evaluateAll((entries) => entries.map((entry) => entry.getAttribute("value") ?? ""));
  expect(optionValues, "The list offers exactly the candidate set the read states, in the read's own order.").toEqual(["", ...candidateIds]);
  const optionTexts = await options.evaluateAll((entries) => entries.map((entry) => (entry.textContent ?? "").trim()));
  const chosen = candidates.find((candidate) => isRecord(candidate) && candidate.status === "open" && candidate.isRecurringSuccessor === false); // The one task this journey shares from: an open task that does not repeat. A repeating task's occurrence is shared only after a fresh selection, which is a separate rule with its own domain test.
  const chosenTaskId = isRecord(chosen) ? textAt(chosen, "taskId") : undefined;
  const title = isRecord(chosen) ? textAt(chosen, "safeLabel") : undefined;
  const status = isRecord(chosen) ? textAt(chosen, "status") : undefined;
  const chosenDueDate = isRecord(chosen) ? chosen.dueDate : undefined;
  const dueOn = isRecord(chosenDueDate) && chosenDueDate.kind === "dated" ? textAt(chosenDueDate, "date") : undefined;
  const statusWord = status === undefined ? undefined : SUMMARY.statusWords[status];
  if (chosenTaskId === undefined || title === undefined || dueOn === undefined || statusWord === undefined) throw new Error(`The read states no open task this journey can share a summary of, or states one without a label, a due day or a status this file knows the word for: ${JSON.stringify(opened).slice(0, 300)}.`);
  await expect(async () => {
    await choice.selectOption(chosenTaskId);
    await expect(selector.locator('[data-slot="task-summary-preview"]')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(choice).toHaveValue(chosenTaskId);
  expect(optionTexts[candidateIds.indexOf(chosenTaskId) + 1] ?? "", "The chosen entry states the worker's own label for the task with the day it is due and the status it holds.").toContain(`${title} — ${dueOn} — ${statusWord}`);
  const preview = selector.locator('[data-slot="task-summary-preview"]');
  await expect(preview.getByText(SUMMARY.preview, { exact: true }), "The surface states what a coach will read before anything is shared.").toBeVisible();
  await expect(preview.getByText(dueOn, { exact: true }).first(), "The due date a coach reads is the task's own civil day, not a day this surface invented.").toBeVisible();
  await expect(preview.getByText(`Status: ${statusWord}`, { exact: true }).first(), "The status a coach reads is the one the task holds now.").toBeVisible();
  const description = selector.getByRole("textbox", { name: SUMMARY.description, exact: true });
  await fillUntilCounted(description, SUMMARY.descriptionText, selector.getByText(`Written: ${String(scalarCount(SUMMARY.descriptionText))} / ${String(SUMMARY.maxCodePoints)} code points`, { exact: true }));
  await expect(preview.getByText(SUMMARY.descriptionText, { exact: true }).first(), "The panel states the description as it stands, which is exactly what a coach reads.").toBeVisible();
  await expect(preview.getByText(title, { exact: true }), "A coach reads the reviewed description, never the task's raw title.").toHaveCount(0);
  const review = selector.locator('[data-slot="action-review"]');
  await expect(review.getByRole("heading", { name: SUMMARY.reviewHeading, exact: true }), "Sharing is reviewed before it is written.; One reviewed submission, and the receipt names the share it created").toBeVisible();
  await expect(review.getByText(SUMMARY.descriptionText, { exact: true }), "The review states the description it would share.").toBeVisible();
  await review.getByRole("button", { name: SUMMARY.confirm }).click();
  await expect(review.getByRole("heading", { name: "Saved", exact: true }), "The share is written once, and its own receipt says so.").toBeVisible();
  const shareReceipt = await review
    .getByText(/^coaching-task-share-\S+$/u)
    .first()
    .innerText();
  const createdShareId = shareReceipt.trim();
  const afterShare = await readTaskShares(page);
  const shares = isRecord(afterShare) && isRecord(afterShare.data) && Array.isArray(afterShare.data.shares) ? afterShare.data.shares : [];
  const shareOfTask = shares.filter((share) => isRecord(share) && share.taskId === chosenTaskId);
  expect(shareOfTask, "One share exists for the task this journey selected, under the identity its receipt named.").toHaveLength(1);
  expect(shareOfTask[0], "The share carries the reviewed description with the live due date and status, and it is the record the receipt reported.").toMatchObject({ shareId: createdShareId, taskId: chosenTaskId, state: "shared", description: SUMMARY.descriptionText, status, dueDate: { kind: "dated", date: dueOn } });
  const recordedShare = shareOfTask[0];
  expect(JSON.stringify(recordedShare), "Nothing of the task's own title travels with the share, so no part of it is in the record a coach reads.").not.toContain(title);
  expect(isRecord(recordedShare) ? Object.keys(recordedShare).filter((key) => /title|note|partner|donor|amount|attachment|link|history/iu.test(key)) : ["<unreadable>"], "The record a coach reads carries no field for a title, a note, a partner, a donor, an amount, an attachment, a link or a history.").toEqual([]);
  await page.reload();
  const sharedRow = shareList.getByRole("region", { name: `${SUMMARY.shared}: task summary ${chosenTaskId}` });
  await expect(sharedRow, "The summary this journey shared is the row the list states, in the shared state.").toBeVisible();
  await expect(sharedRow).toHaveAttribute("data-state", "shared");
  await expect(sharedRow.getByText(SUMMARY.descriptionText, { exact: true }), "The row states the description that was reviewed.").toBeVisible();
  await expect(sharedRow.getByText(title, { exact: true }), "The row states the description a coach reads, and never the task's raw title.").toHaveCount(0);
  await page.goto("/work"); // A task's title is part of the meaning its description was reviewed against, and it is changed through the Work surface's own form rather than through a request this file composes.
  await page.getByRole("tab", { name: SUMMARY.allList }).click();
  const actions = page.getByRole("button", { name: `Actions for ${title}` });
  await expect(actions, "The task the summary describes is the worker's own work, on the list that holds every task.").toBeVisible();
  await actions.click();
  await page.getByRole("menuitem", { name: `Edit for ${title}` }).click();
  const composer = page.locator('[data-slot="task-composer"][data-mode="edit"]');
  await expect(composer, "Editing opens the one task form, on the task the row names.").toBeVisible();
  await composer.getByRole("textbox", { name: new RegExp(`^${SUMMARY.titleLabel}`, "u") }).fill(SUMMARY.revisedTitle);
  await composer.getByRole("button", { name: SUMMARY.saveTask }).click();
  await expect(composer.locator('[data-slot="operation-result"][data-outcome="accepted"]'), "A change to the task's own title is one accepted change to that task.").toBeVisible();
  await page.goto("/coaching/check-ins");
  const heldRow = shareList.getByRole("region", { name: `${SUMMARY.held}: task summary ${chosenTaskId}` });
  await expect(heldRow, "The summary is held, and the list names that state rather than an empty or a shared one.").toBeVisible();
  await expect(heldRow).toHaveAttribute("data-state", "needs-review");
  await expect(heldRow, "A held summary states in its own words that the description is withheld and why.").toContainText(`${SUMMARY.withheld}. ${SUMMARY.heldSentence}`);
  await expect(heldRow.getByText(SUMMARY.descriptionText), "A held summary withholds the description it carried until it is reviewed again.").toHaveCount(0);
  const heldRead = await readTaskShares(page);
  const heldShares = isRecord(heldRead) && isRecord(heldRead.data) && Array.isArray(heldRead.data.shares) ? heldRead.data.shares : [];
  const heldShare = heldShares.filter((share) => isRecord(share) && share.taskId === chosenTaskId);
  expect(heldShare, "The withheld summary is one record, and it is still the one this journey shared.").toHaveLength(1);
  expect(heldShare[0], "The read states the summary as held and carries no description, because a changed task withholds it until it is reviewed again.").toMatchObject({ shareId: createdShareId, state: "needs-review", description: null });
  await heldRow.getByRole("button", { name: `${SUMMARY.stop}: task summary ${chosenTaskId}, ${SUMMARY.held}` }).click();
  const stopReview = shareList.locator('[data-slot="action-review"]');
  await expect(stopReview.getByRole("heading", { name: SUMMARY.stopTitle, exact: true }), "Stopping a share is a review of its own, with its own effect.").toBeVisible();
  await expect(stopReview.getByText(`This stops the summary for task summary ${chosenTaskId}, currently held until you review it again.`, { exact: true })).toBeVisible();
  await expect(stopReview.getByText(SUMMARY.stopAssurance, { exact: true }).first(), "The stop states that the task itself is not deleted.").toBeVisible();
  await stopReview.getByRole("button", { name: SUMMARY.stop }).click();
  const confirmStop = page.locator('[role="alertdialog"]');
  await expect(confirmStop).toBeVisible();
  await confirmStop.getByRole("button", { name: SUMMARY.stop }).click();
  await expect(stopReview.getByRole("heading", { name: "Saved", exact: true }), "The stop is written once, and its own receipt says so.").toBeVisible();
  await page.reload();
  const removedRow = shareList.getByRole("region", { name: `${SUMMARY.removed}: task summary ${chosenTaskId}` });
  await expect(removedRow, "The stopped share is stated as no longer shared, not dropped from the list without a word.").toBeVisible();
  await expect(removedRow).toHaveAttribute("data-state", "removed");
  await expect(removedRow.getByText(SUMMARY.removedSentence, { exact: true })).toBeVisible();
  await expect(shareList.getByRole("button", { name: /^Stop sharing: /u }), "A stopped share offers no stop control of its own.").toHaveCount(0);
  await page.goto("/work");
  await page.getByRole("tab", { name: SUMMARY.allList }).click();
  await expect(page.getByRole("button", { name: `Actions for ${SUMMARY.revisedTitle}` }), "Stopping a summary leaves the task itself on the list, with its own title.").toBeVisible();
});
