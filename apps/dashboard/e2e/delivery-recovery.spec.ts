/**
 * Criterion 11 — delivery recovery.
 *
 * A lost acknowledgement and a repeated submit both recover the same operation; an unknown outcome offers
 * recovery only, never a resend under a new key; a definite failure may be repeated only inside its
 * usefulness window; and one notification intent yields exactly one message per recipient.
 *
 * **The scenario this file drives, from the deterministic seed.**
 * - A publisher — the seeded established worker, the application's own default session — holds the
 *   released Update `doc-update-autumn` and the audience `publisher-harbour` for the `update-email`
 *   purpose: five active memberships, one awaiting proof, two off (one of them unsubscribed) and one
 *   restricted.
 * - One notice was already recorded for that Update: `intent-update-autumn-en`, meant for
 *   2026-11-10T09:05:00Z and closing 24 elapsed hours later. It carries all three outcomes this
 *   criterion must keep apart — three accepted copies, one definite failure and one unknown result — so the
 *   delivery surface reports them side by side without the file inventing a failure of its own.
 * - `/communication/delivery?intentId=…` is the delivery surface, `/communication/inbox` is the
 *   synthetic inbox of the reader who acts, and `/api/dev` is the development control that arms one
 *   failure plan and moves the scenario clock.
 *
 * **How a membership and a notice are produced.** Both are driven through the surfaces that own them. The acting
 * person's own membership is opened from the preferences surface's proof flow — the request step, then the Confirm
 * control the page re-reads into place — so the reader whose inbox is counted below is a recipient in the
 * application's own terms. A notice is submitted by the composed release: the French edition's editor saves a draft
 * and freezes it with the author's *Publish and notify now* choice, the review route answers that candidate in its one
 * step, and the Update's release review publishes the edition and submits the notice its submission asked for. The
 * seeded world's only frozen candidate was submitted for *Publish only*, and a reviewer may not turn that into a
 * notice, so the composed path starts from a fresh edition rather than from that candidate: the rule is not broken to
 * reach a control.
 *
 * **The repeat, and where it is pressed.** A definite failure is repeated from the delivery surface's own control,
 * which the read opens only while the notice is inside its usefulness window, and the service submits only the copies
 * it recorded as definite failures. At the boundary the read states its own past-usefulness reason and offers no
 * control at all.
 *
 * **What is still stated at the transport.** A fresh attempt at the same work under a new attempt identity, and a
 * request whose intended instant is past the 24 useful hours. The reviewed step keeps one identity for one intent by
 * design, so it cannot produce a second identity for the same work, and the release control cannot be reached for an
 * instant that is already spent; both are probed on the handler the controls post to, and both are dedupe answers or
 * refusals rather than journeys.
 *
 * **What the development failure plan can and cannot arm.** `modules/dev-runtime/failures.ts` declares
 * `requestNotification` with exactly one demonstrable mode, the lost acknowledgement. There is no armed
 * *definite* failure for this mutation, so the definite-failure half of this criterion is demonstrated
 * against the failure the seed itself records — the one recipient whose submission failed — rather than
 * by a fabricated one, and the file states that in the assertions it makes.
 */
import { expect, test, type Page } from "@playwright/test";

// The one runner entry to this suite's seed: `resetSeed` restores the deterministic world through the
// application's own control, as the persona whose session it names. The browser's own context needs no
// import of its own — `src/proxy.ts` mints the default session cookie, and every read below is authorised
// again from it per request.
import { resetSeed } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded world this file asserts against, named once
// ---------------------------------------------------------------------------------------------

/** The one Update the seeded notice is about. */
const UPDATE_DOCUMENT = "doc-update-autumn";

/** The notice the seed already recorded: the edition it was submitted for, its intent, the instant it was meant for and the instant it stops being useful. */
const SEEDED_NOTICE = { intentId: "intent-update-autumn-en", releaseId: "release-update-en-1", intendedAt: "2026-11-10T09:05:00Z", deadline: "2026-11-11T09:05:00Z" } as const;

/**
 * The one recipient the seed recorded a definite failure for, so the repeat this file performs has exactly one copy to
 * submit again and every other recorded copy is one the service must leave alone.
 */
const FAILED_RECIPIENT = "membership-jonas-active";

/** The scenario instant every seed lays down; a clock this file moved is returned to it before the test ends. */
const SEED_INSTANT = "2026-11-20T00:00:00Z";

/** One second before the seeded notice's window closes: still inside it, because the boundary is strict at equality. */
const LAST_USEFUL_SECOND = "2026-11-11T09:04:59Z";

/** The address of the publisher's Update-email audience, which states each membership's state and exclusion reason. */
const AUDIENCE_PATH = "/communication/audience";

/** The address of the synthetic inbox of whichever reader acts. */
const INBOX_PATH = "/communication/inbox";

/** The persistent development-data label the shell states on every surface. */
const DEVELOPMENT_LABEL = "Development data";

/** The one sentence every simulated mail boundary states, in the specification's own words. */
const SIMULATED_MAIL = "simulated — no mail leaves this application";

/**
 * The words a resend control would carry, if the application ever grew one. The criterion is that it has
 * not: an unknown outcome is recovered by reading the same operation or the same notice, never by sending
 * anything under a fresh identity, so every assertion on this pattern is an assertion that the control is
 * absent rather than that it is disabled.
 */
const RESEND_CONTROL = /resend|send again|send it again|send a new one|new send/iu;

/** The address of one intent's delivery results. */
function deliveryPathOf(intentId: string): string {
  return `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
}

// ---------------------------------------------------------------------------------------------
// Reading a JSON answer: the four-field envelope, the closed outcome, and the members asserted on
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

/** The per-field messages an `invalid` outcome keyed at one field path, as the flat list the receipt prints. */
function messagesAt(body: unknown, field: string): readonly string[] {
  const stated = fieldAt(body, "fields", field);
  return Array.isArray(stated) ? stated.filter((message): message is string => typeof message === "string") : [];
}

/** The identifier a caller mints for one attempt: the identity every replay of that attempt is recognised by. */
function newAttemptId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------------------------
// The development controls: the clock and the one armed failure
// ---------------------------------------------------------------------------------------------

/** What one session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/**
 * Reads this session's development state.
 *
 * Every control presents the scope and the revision it read, exactly as `resetSeed` does, because the
 * service re-authorises the scope and answers `conflict` for a revision that no longer stands. Reading the
 * state immediately before each control is what keeps a second control in one test from presenting a
 * revision the first one moved.
 */
async function readDevState(page: Page): Promise<DevState> {
  const answer = await page.request.get("/api/dev");
  const body = await jsonOf(answer, "GET /api/dev");
  const scope = fieldAt(body, "scope");
  if (!isRecord(scope)) {
    throw new Error(`GET /api/dev answered without the scope a development control runs under: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { scope, revision: stringAt(body, ["revision"], "The development state's revision") };
}

/** Operates exactly one named development control and returns the one outcome it answered with. */
async function operateDevControl(page: Page, action: string, payload: JsonRecord): Promise<unknown> {
  const state = await readDevState(page);
  const answer = await page.request.post("/api/dev", { data: { action, operationId: newAttemptId(), scope: state.scope, expectedRevision: state.revision, payload } });
  const body = await jsonOf(answer, `POST /api/dev ${action}`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "unchanged") {
    throw new Error(`The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A spec that could not move the clock or arm the failure it names would assert against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`);
  }
  return body;
}

/** Moves this session's scenario clock to one instant, which is how a window boundary is reached without waiting. */
async function setClock(page: Page, instant: string): Promise<void> {
  await operateDevControl(page, "setClock", { offsetIso: instant });
}

/**
 * Arms the lost acknowledgement on the notification request itself.
 *
 * The effect is applied and recorded and only the response is withheld, so the attempt leaves exactly one
 * effect behind: that is what makes the recovery below a recovery rather than a second send.
 */
async function armLostAcknowledgement(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { mode: "unknown", target: { kind: "mutation", name: "requestNotification" } });
}

/**
 * Disarms the armed failure.
 *
 * A plan outlives a test — it lives in the session document until something clears it — so a test that
 * armed one clears it before it ends, and the reset in `beforeEach` is then the second guarantee rather
 * than the only one.
 */
async function clearFailurePlan(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { plan: null });
}

// ---------------------------------------------------------------------------------------------
// The application's own reads and writes, called the way the browser calls them
// ---------------------------------------------------------------------------------------------

/** The authority one content read states: the scope it ran under and the revision it saw. */
interface ContentAuthority {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/** One submitted notice: the identity of the attempt and the answer the service gave it. */
interface NoticeSubmission {
  readonly operationId: string;
  readonly body: unknown;
}

/** Reads one Update's variant overview, which states the document's own revision and the scope it was read in. */
async function readUpdateAuthority(page: Page): Promise<ContentAuthority> {
  const answer = await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`);
  const body = await jsonOf(answer, "GET /api/updates");
  const scope = fieldAt(body, "scope");
  if (!isRecord(scope)) {
    throw new Error(`The Update read answered without the scope it ran under: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { scope, revision: stringAt(body, ["revision"], "The Update document's revision") };
}

/** Reads the publisher's Update-email audience, from which every membership state and exclusion reason is taken. */
async function readAudience(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get("/api/audience"), "GET /api/audience");
}

/** Every recipient identifier, outcome, rendition and dedupe key a send result states, so "nothing moved" is compared exactly. */
function sendResultFingerprint(body: unknown): string {
  const rows = arrayAt(body, ["data", "rows"], "A send result's rows").map((row) => [fieldAt(row, "recipientId"), fieldAt(row, "state"), fieldAt(row, "renditionId"), fieldAt(row, "dedupeKey")].join("|"));
  return rows.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join("\n");
}

/** Reads one intent's per-recipient results: the same read the delivery surface renders. */
async function readSendResult(page: Page, intentId: string): Promise<unknown> {
  return jsonOf(await page.request.get(`/api/notify?intentId=${encodeURIComponent(intentId)}`), "GET /api/notify");
}

/** Reads the synthetic inbox of whichever reader acts: one message per recipient and notification intent. */
async function readInbox(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get("/api/inbox"), "GET /api/inbox");
}

/** The preferences surface's proof flow, which is where a person opens and confirms their own membership. */
const PREFERENCES_PATH = "/preview/preferences";

/** The proof flow's own slot, so every assertion inside the flow is scoped to it rather than to the page. */
const PROOF_FLOW = '[data-slot="proof-flow"]';

/** The address the acting person gives for its own membership. It is a value on the record and never a key. */
const OWN_EMAIL = "established.worker@example.org";

/** The prose a fresh edition is given, so the draft the submission freezes is this file's own text. */
const EDITION_PROSE = "Autumn at Harbour Youth: a note from this edition, written for the one review step.";

/**
 * The edition a fresh notice is driven through, with the words its own release control carries. The composed path
 * releases the edition again, so the release the notice names is the one that release produced: this file never
 * assumes the identity the service mints, and reads the notice's identity off the recipient's own inbox instead.
 */
const NOTIFY_EDITION = { variantId: "variant-update-autumn-fr-public", audience: "Public", locale: "Français" } as const;

/** Where one edition's editor is composed, which is where a draft is written and frozen for review. */
function editorPathOf(variantId: string): string {
  return `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}/${encodeURIComponent(variantId)}`;
}

/** Where one edition's frozen candidate is answered by the single review step. */
function reviewPathOf(variantId: string): string {
  return `/communication/review/${encodeURIComponent(variantId)}`;
}

/** The Update's own release review, which publishes the editions selected there and submits a notice for any that asked. */
const RELEASE_PATH = `/communication/${UPDATE_DOCUMENT}`;

/** The status line the editor's autosave keeps, whose own state word is what a save is judged by. */
const AUTOSAVE = '[data-slot="autosave-status"]';

/** The receipt the release review renders once it has an answer, which is where a release and its notice are read. */
const RELEASE_RESULT = '[data-slot="publish-review-result"]';

/**
 * Opens the acting person's own purpose-specific membership through the proof flow the preferences route composes.
 *
 * The request is the person's own act: the address is typed into the flow's own field and the control the flow offers
 * submits it. Once the service has recorded the membership the page re-reads it, so the confirmation control appears in
 * place — which is what makes the membership keyed by the acting principal, and the person a recipient of the notice
 * below rather than a bystander to it.
 */
async function requestNoticesThroughProof(page: Page): Promise<void> {
  await page.goto(PREFERENCES_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Your preferences" })).toBeVisible();
  const proof = page.locator(PROOF_FLOW);
  await expect(proof.getByRole("heading", { level: 2, name: "Confirm this address for notices" })).toBeVisible();
  await proof.getByRole("textbox", { name: /Email address/u }).fill(OWN_EMAIL);
  await proof.getByRole("button", { name: "Request notices from this publisher", exact: true }).click();
  // The request is recorded once the page has re-read the membership it opened: the confirmation control appears in
  // place, and the read states the membership as awaiting proof rather than as an address anyone may write to.
  await expect(proof.getByRole("button", { name: /Confirm this address/u }), "The request is recorded, so the confirmation control appears in place").toBeVisible();
  const opened = await readPreferences(page);
  expect(fieldAt(opened, "data", "state"), "A request opens the proof step and nothing more").toBe("awaiting-proof");
}

/** Confirms the address the proof flow holds, inside the window its own acceptance recorded. */
async function confirmThroughProof(page: Page): Promise<void> {
  const proof = page.locator(PROOF_FLOW);
  await proof.getByRole("button", { name: /Confirm this address/u }).click();
  // The receipt is the durable record of the act, and it stays on the surface the act was made from.
  await expect(proof.getByText("Saved", { exact: true })).toBeVisible();
  const confirmed = await readPreferences(page);
  expect(fieldAt(confirmed, "data", "state"), "The person's own act makes the membership active").toBe("active");
}

/** The reader's own preference record: the membership state, its identity and the window its acceptance fixed. */
async function readPreferences(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get("/api/preferences"), "GET /api/preferences");
}

/**
 * Drives one fresh notice through the composed controls, in the order a person meets them: the editor's saved draft,
 * the author's *Publish and notify now* choice, the reviewer's one decision, and the release that publishes the edition
 * and submits the notice. Nothing here names a release, an instant or a ceiling: the release mints its own identity.
 */
async function releaseAndNotify(page: Page): Promise<void> {
  await page.goto(editorPathOf(NOTIFY_EDITION.variantId));
  const editor = page.locator('[data-slot="editor-shell"]');
  await expect(editor).toBeVisible();
  const prose = page.getByRole("textbox", { name: "The text of this Update edition", exact: true });
  await prose.click();
  await page.keyboard.type(EDITION_PROSE);
  await expect(page.locator(AUTOSAVE)).toHaveAttribute("data-autosave-state", "saved");

  // The author's choice is recorded with the submission, and the reviewer cannot change it afterwards.
  const submitStep = editor.locator('[data-slot="action-review"]');
  await expect(submitStep).toContainText("Submit this edition for review");
  // The author's choice has to reach the step's own state, not only the radio's DOM: the mode group is React-controlled
  // and states the mode this submission will record in its own `data-mode`, so the click is read back from that group
  // and made again if the group still states the other mode, rather than leaving the release below to be refused for a
  // mode the submission never asked for.
  const modeGroup = submitStep.locator('[data-slot="submission-release-mode"]');
  await expect(modeGroup).toBeVisible();
  await expect(async () => {
    await submitStep.getByRole("radio", { name: "Publish and notify now", exact: true }).click();
    await expect(modeGroup).toHaveAttribute("data-mode", "publish-and-notify", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await submitStep.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(submitStep.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  // One review step, given once: the candidate is approved for this audience and this language and nothing else.
  await page.goto(reviewPathOf(NOTIFY_EDITION.variantId));
  await expect(page.getByRole("heading", { name: "Review this Update", level: 1 })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  // The decision is awaited where the panel records it, so the release below reads a candidate that is already approved:
  // the release review derives the edition's release mode from that recorded decision, and a release that ran before it
  // was recorded would be refused as a mode the submission never asked for.
  await expect(page.locator('[data-slot="review-recorded-decision"]')).toHaveAttribute("data-decision", "approved");

  // The release review publishes the edition and, because its submission asked for one, submits the notice.
  await page.goto(RELEASE_PATH);
  await expect(page.getByRole("heading", { level: 2, name: "Release the selected editions" })).toBeVisible();
  await page.getByRole("checkbox", { name: `Release ${NOTIFY_EDITION.audience} — ${NOTIFY_EDITION.locale}`, exact: true }).click();
  await page.getByRole("button", { name: "Release these editions", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Release these editions", exact: true }).click();
  await expect(page.locator(RELEASE_RESULT)).toHaveAttribute("data-outcome", "accepted");
}

/** The release review's receipt, once it has answered: the record of what the release and its notice produced. */
function releaseReceipt(page: Page) {
  return page.locator(RELEASE_RESULT);
}

/** The one intent the acting person's own inbox holds, which is the notice a fresh send recorded for them. */
function onlyIntentIn(inbox: unknown): string {
  const messages = arrayAt(inbox, ["data", "messages"], "The inbox's messages");
  expect(messages, "One notice produced one message for this recipient").toHaveLength(1);
  return stringAt(messages[0], ["intentId"], "The intent the message belongs to");
}

/**
 * Submits one notice at the transport its handler answers, which is how the two answers no control can produce are
 * probed: a fresh attempt at the same work under a new identity (the reviewed step keeps one identity for one intent,
 * so it cannot mint a second), and a request whose intended instant is past the 24 useful hours (no control can be
 * reached for an instant that is already spent). Both are assertions about the service's own answer, never a
 * substitute for a journey.
 *
 * Presenting the *same* `operationId` again is a replay: the service answers with the result already recorded for that
 * attempt and applies nothing a second time. Minting a new one is a fresh attempt, and the difference between the two
 * answers is exactly the distinction this criterion turns on: an uncertain outcome is recovered under its own
 * identity, never by sending the same work under a new one.
 */
async function submitNotice(page: Page, input: { readonly authority: ContentAuthority; readonly releaseId: string; readonly intendedAt?: string; readonly operationId?: string }): Promise<NoticeSubmission> {
  const operationId = input.operationId ?? newAttemptId();
  const answer = await page.request.post("/api/notify", { data: { operationId, scope: input.authority.scope, expectedRevision: input.authority.revision, payload: { documentId: UPDATE_DOCUMENT, releaseId: input.releaseId, ...(input.intendedAt === undefined ? {} : { intendedAt: input.intendedAt }) } } });
  return { operationId, body: await jsonOf(answer, "POST /api/notify") };
}

/** Opens one intent's delivery results in the browser and waits for the surface itself, not for a spinner. */
async function openDelivery(page: Page, intentId: string): Promise<void> {
  await page.goto(deliveryPathOf(intentId));
  await expect(page.getByRole("heading", { level: 1, name: "Delivery" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Delivery results" })).toBeVisible();
}

/**
 * The rows of the delivery table, which is the surface's one per-recipient composition at this width.
 *
 * The phone composition renders the same facts as a list of cards and is removed from the accessibility
 * tree by `display: none` at the desktop width the runner uses, so counting rows counts each recipient
 * once rather than once per composition.
 */
function deliveryRows(page: Page) {
  return page.getByRole("row");
}

// ---------------------------------------------------------------------------------------------
// Criterion 11, first half: a lost acknowledgement recovered by identity, and one message per recipient
// ---------------------------------------------------------------------------------------------

test("a lost acknowledgement is recovered by identity, and one intent yields one message per recipient", async ({ page }) => {
  // The shell's development label is asserted once in this file, here, because every outcome below is read
  // off surfaces of a development build: a reader who mistook them for production would read a recorded
  // acceptance as a delivered message.
  await page.goto("/");
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();

  // The reader whose inbox this test counts is a recipient in the application's own terms: the publisher's own
  // address, opened through the proof flow on the preferences surface and confirmed inside its window. Nothing here
  // subscribes a partner or imports consent — the membership is the acting person's own act on their own address.
  await requestNoticesThroughProof(page);
  await confirmThroughProof(page);
  const opened = await jsonOf(await page.request.get("/api/preferences"), "GET /api/preferences");
  expect(fieldAt(opened, "data", "state"), "The person's own act makes the membership active").toBe("active");
  const membershipId = stringAt(opened, ["data", "membershipId"], "The membership the proof flow opened");
  expect(membershipId, "The membership the flow opened is keyed by the principal that opened it").toBe("principal-established-worker");

  // The inbox before the send: no message for this membership, stated as an absence of a message rather
  // than as a zero, and with the one-copy rule on screen from the start. The count is taken per recipient —
  // this membership's own list — and as the whole total it reports beside it.
  const inboxBefore = await readInbox(page);
  expect(numberOf(inboxBefore, ["data", "intentCount"], "Messages in the inbox before the send")).toBe(0);
  expect(arrayAt(inboxBefore, ["data", "messages"], "The inbox's messages before the send")).toHaveLength(0);
  await page.goto(INBOX_PATH);
  await expect(page.getByRole("heading", { level: 2, name: "Messages produced for this membership" })).toBeVisible();
  await expect(page.getByText("No message has been produced for this membership yet")).toBeVisible();
  await expect(page.getByText(SIMULATED_MAIL)).toBeVisible();

  // The lost acknowledgement: the plan withholds the response of the notification request itself, and the notice is
  // then submitted by the composed release a person drives. The effect is applied and its copies are recorded; what is
  // lost is the answer, which is exactly the state the surface has to report honestly.
  await armLostAcknowledgement(page);
  await releaseAndNotify(page);
  const receipt = releaseReceipt(page);
  await expect(receipt, "The release itself was applied and says so").toHaveAttribute("data-outcome", "accepted");
  await expect(receipt, "The notice's own outcome is stated as uncertain, neither accepted nor failed").toContainText("Outcome unknown");
  // Every simulated boundary is labelled where the effect would leave the application, at the control that crosses it.
  await expect(page.getByText(SIMULATED_MAIL, { exact: true }).first()).toBeVisible();

  // The outcome is recovered by reading it back, not by sending anything again: the recipient's own inbox holds the
  // one message that notice produced, and its intent is the identity every surface below is read under.
  const intentId = onlyIntentIn(await readInbox(page));

  // The durable surface: the delivery results of that intent, read by the browser, with this person's own
  // row on it. "Check the result" is the recovery an uncertain outcome is given here — reading the same notice
  // again, which can reveal an outcome and can never repeat a submission.
  await openDelivery(page, intentId);
  // The recovery card is the surface's own statement of what a recovery is; its title is a plain card
  // heading rather than an outline entry, so it is read as the card's text.
  const recovery = page.locator('[data-slot="delivery-recovery"]');
  await expect(recovery.getByText("Checking the result", { exact: true })).toBeVisible();
  const checkTheResult = recovery.getByRole("button", { name: "Check the result" });
  await expect(checkTheResult).toBeVisible();
  await expect(recovery.getByRole("button"), "Checking the result is the one control an accepted notice is offered").toHaveCount(1);
  await expect(page.getByRole("button", { name: RESEND_CONTROL }), "No control may send this work again under a new key").toHaveCount(0);
  await expect(page.getByRole("link", { name: RESEND_CONTROL }), "No link may send this work again under a new key").toHaveCount(0);
  await expect(page.getByText("Two recorded rows share one dedupe identity")).toHaveCount(0);
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: membershipId })).toHaveCount(1);
  // The four recipients an earlier notice had already covered are recorded as unserved rather than served
  // again, which is the same rule one intent further out: accepted work is never resent under a fresh key.
  await expect(page.getByText("Already had a copy from an earlier notice")).toHaveCount(4);
  // Reading the same notice again performs no effect, so the recovery the surface offers cannot repeat one:
  // the service's own reason for withholding a repeat is stated beside the control, not decided here.
  await checkTheResult.click();
  await expect(recovery.getByText(/No recorded row may be submitted again/u)).toBeVisible();
  await expect(recovery.getByText("A repeat under the same identity")).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Repeat the failed copies", exact: true }), "Every copy this notice recorded was accepted, so no repeat is offered").toHaveCount(0);

  // One message per recipient and intent, in the recipient's own inbox, counted by role.
  const inboxAfter = await readInbox(page);
  expect(numberOf(inboxAfter, ["data", "intentCount"], "Messages in the inbox after the send")).toBe(1);
  const messages = arrayAt(inboxAfter, ["data", "messages"], "The inbox's messages");
  expect(messages, "One intent produced one message for this recipient").toHaveLength(1);
  expect(fieldAt(messages[0], "intentId"), "The message is the intent that was submitted").toBe(intentId);
  expect(fieldAt(messages[0], "state"), "The message carries the outcome that was recorded").toBe("accepted");
  await page.goto(INBOX_PATH);
  await expect(page.getByText("One message has been produced for this membership.")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("Two messages share one recipient and one notification intent")).toHaveCount(0);

  // A fresh attempt at the same work is not a second message: the publication's intent already answers for it, so the
  // service reports that nothing needed doing. This is the one request this file makes at the transport, because the
  // reviewed step keeps one attempt identity for one intent by design and so cannot mint a second identity for the
  // same work; the notice it names is the seeded publication, whose intent the service already holds.
  const authority = await readUpdateAuthority(page);
  const freshKey = await submitNotice(page, { authority, releaseId: SEEDED_NOTICE.releaseId });
  expect(outcomeOf(freshKey.body), "The same work submitted under a fresh attempt identity").toBe("unchanged");
  const inboxAfterRepeat = await readInbox(page);
  expect(numberOf(inboxAfterRepeat, ["data", "intentCount"], "Messages in the inbox after a fresh-key repeat")).toBe(1);
  expect(arrayAt(inboxAfterRepeat, ["data", "messages"], "The inbox's messages after a fresh-key repeat")).toHaveLength(1);

  // The armed failure is cleared before the test ends, so the plan a later test starts from is the one the
  // reset lays down rather than the one this test left behind.
  await clearFailurePlan(page);
});

// ---------------------------------------------------------------------------------------------
// Criterion 11, second half: a definite failure, and the window a repeat is permitted by
// ---------------------------------------------------------------------------------------------

test("a definite failure may be repeated only inside the notice's usefulness window", async ({ page }) => {
  const authority = await readUpdateAuthority(page);
  const before = await readSendResult(page, SEEDED_NOTICE.intentId);

  // One second before the window closes: inside it, because the boundary is strict at equality. The one
  // definite failure the seed recorded is the one recipient a repeat is permitted for; every accepted or
  // uncertain copy is never repeated, whatever the window says.
  await setClock(page, LAST_USEFUL_SECOND);
  await openDelivery(page, SEEDED_NOTICE.intentId);
  await expect(page.getByText("Within its usefulness window")).toBeVisible();
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(6);
  await expect(rows.filter({ hasText: "Repeat permitted" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Repeat not permitted" })).toHaveCount(4);
  await expect(page.getByText(/may be retried under the same intent while the usefulness window is open/u)).toBeVisible();
  await expect(page.getByText(/the copies the service recorded as definite failures may be submitted again under this same notice/u)).toBeVisible();
  // The window being open is what puts the repeat control on this surface: the read permits it, its own action names
  // it, and the control submits only the copies the service recorded as definite failures. It is never a resend under
  // a new key, so nothing here matches the words a resend control would carry.
  const repeatControl = page.getByRole("button", { name: "Repeat the failed copies", exact: true });
  await expect(repeatControl, "Inside the window the read permits a repeat, so the surface offers the control").toBeVisible();
  await expect(page.getByRole("button", { name: RESEND_CONTROL })).toHaveCount(0);
  await expect(page.getByRole("link", { name: RESEND_CONTROL })).toHaveCount(0);

  // The eligible repeat, performed from this surface: the one recipient whose copy definitely failed is submitted
  // again, and the outcome renders in place through the surface's own receipt rather than as an ephemeral note.
  const seededFingerprint = sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId));
  await repeatControl.click();
  const repeatResult = page.locator('[data-slot="delivery-repeat-result"]');
  await expect(repeatResult.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
  const repeatedNotice = repeatResult.getByRole("link", { name: "Open the repeated notice's results" });
  await expect(repeatedNotice).toBeVisible();

  // The repeat is a notice of its own, so its results are read under its own identity: one accepted row, for the
  // recipient whose copy failed, and every other eligible recipient recorded as already covered rather than served a
  // second copy.
  const repeatedHref = (await repeatedNotice.getAttribute("href")) ?? "";
  const repeatedIntentId = new URL(repeatedHref, "http://127.0.0.1").searchParams.get("intentId") ?? "";
  expect(repeatedIntentId, "The repeat recorded a notice of its own rather than rewriting the one it repeated").not.toBe(SEEDED_NOTICE.intentId);
  await repeatedNotice.click();
  await expect(page.getByRole("heading", { level: 2, name: "Delivery results" })).toBeVisible();
  // The address is asserted web-first: the heading above is the one the notice just left also carries, so a plain read
  // of the URL here would sample it before the client navigation committed and could name the notice being left.
  await expect(page, "The surface reports the repeated notice's own results").toHaveURL(new RegExp(`[?&]intentId=${repeatedIntentId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:&|$)`, "u"));
  const repeatedRows = deliveryRows(page);
  await expect(repeatedRows, "One served recipient, and the table's own head").toHaveCount(2);
  await expect(repeatedRows.filter({ hasText: FAILED_RECIPIENT })).toHaveCount(1);
  await expect(repeatedRows.filter({ hasText: "Accepted — not delivered" })).toHaveCount(1);
  // The audience holds five eligible members: the one whose copy definitely failed is served again, and the other
  // four state that they already had a copy rather than receiving another.
  await expect(page.getByText("Already had a copy from an earlier notice"), "An accepted copy is never sent a second time").toHaveCount(4);

  // The earlier failure is exactly what it was: the repeat recorded a copy of its own instead of rewriting the record
  // it retried, so the notice that failed still states that failure.
  expect(sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)), "A repeat leaves the notice it repeated untouched").toBe(seededFingerprint);

  // At the closes-at instant exactly: closed. Reading the surface again is the whole of the recovery, and
  // the surface states the service's own reason rather than deciding from the browser's clock.
  await setClock(page, SEEDED_NOTICE.deadline);
  await openDelivery(page, SEEDED_NOTICE.intentId);
  await expect(page.getByText("Past its usefulness window")).toBeVisible();
  await expect(deliveryRows(page).filter({ hasText: "Repeat permitted" })).toHaveCount(0);
  await expect(page.getByText(/24-hour usefulness window has closed, so it cannot be revived as a fresh attempt/u)).toBeVisible();
  await expect(page.getByText("No recorded row may be submitted again: acceptance is never repeated, an uncertain outcome is recovered by re-querying the same intent, and a failure outside its usefulness window cannot be revived.")).toBeVisible();
  // At the boundary the surface offers no repeat at all, and no copy exists that it could have made.
  await expect(page.getByRole("button", { name: "Repeat the failed copies", exact: true }), "A closed window offers no repeat").toHaveCount(0);
  await expect(page.locator('[data-slot="delivery-repeat-result"]')).toHaveCount(0);
  expect(sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)), "Nothing was recorded at the boundary").toBe(seededFingerprint);

  // A request carrying the notice's own intended instant is refused by the window itself, and a new intent cannot
  // revive it: the refusal names the field and states that the window is what decided. This is a probe of the
  // service's own refusal, because the surface offers no control to press at that instant.
  const refused = await submitNotice(page, { authority, releaseId: SEEDED_NOTICE.releaseId, intendedAt: SEEDED_NOTICE.intendedAt });
  expect(outcomeOf(refused.body), "A fresh attempt at exactly 24 elapsed hours").toBe("invalid");
  const windowRefusal = messagesAt(refused.body, "intendedAt").join(" ");
  expect(windowRefusal, "The refusal is the usefulness window's, not the dedupe rule's").toMatch(/past the 24 hours it stays useful for/u);
  expect(windowRefusal, "A new intent cannot revive a notice past its window").toMatch(/and a new intent cannot revive it/u);
  expect(fieldAt(await readSendResult(page, SEEDED_NOTICE.intentId), "revision"), "The refused attempt recorded nothing").toBe(fieldAt(before, "revision"));

  // The clock this test moved is returned to the seed instant, so the next test starts where the seed says.
  await setClock(page, SEED_INSTANT);
});

// ---------------------------------------------------------------------------------------------
// The three outcomes kept apart, and an excluded membership that is not a failure
// ---------------------------------------------------------------------------------------------

test("acceptance, definite failure and uncertainty stay three outcomes, and an excluded membership is not a failure", async ({ page }) => {
  await openDelivery(page, SEEDED_NOTICE.intentId);

  // One row per recipient, each carrying its own outcome: three accepted, one definite failure and one
  // unknown, which is every outcome the seeded notice recorded and no fourth state beside them.
  await expect(page.getByText("Outcomes recorded for this notice")).toBeVisible();
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(6);
  await expect(rows.filter({ hasText: "Accepted — not delivered" })).toHaveCount(3);
  await expect(rows.filter({ hasText: "Failed" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Outcome unknown" })).toHaveCount(1);
  await expect(page.getByText("Two recorded rows share one dedupe identity")).toHaveCount(0);

  // Each outcome is described with what it does not mean: acceptance is not delivery and not reading, a
  // failure is definite, and an unknown result is neither of them and starts no second attempt.
  await expect(page.getByText(/It is not delivery and it is not reading/u)).toBeVisible();
  await expect(page.getByText(/Failed is a definite failure for this recipient/u)).toBeVisible();
  await expect(page.getByText(/It is neither a success nor a failure/u)).toBeVisible();

  // Per-item detail: the failed recipient's row names the copy it was pinned to and its whole dedupe
  // identity, so the one message it is recognised by is four stated values rather than an opaque token.
  const failedRow = rows.filter({ hasText: "Failed" });
  // The row states its recipient twice by design — once as the row's own label so a screen reader announces
  // which recipient a row describes, and once in the recipient column — so the reference is asserted as
  // present rather than counted.
  await expect(failedRow.getByText("membership-jonas-active").first()).toBeVisible();
  await expect(failedRow.getByText("rendition-update-en-notice")).toBeVisible();
  await expect(failedRow.getByText("Publisher", { exact: true })).toBeVisible();
  await expect(failedRow.getByText("Purpose", { exact: true })).toBeVisible();
  await expect(failedRow.getByText("Intent", { exact: true })).toBeVisible();
  await expect(failedRow.getByText(SEEDED_NOTICE.intentId)).toBeVisible();
  await expect(failedRow.getByText("Repeat not permitted", { exact: true })).toBeVisible();

  // Every simulated boundary is labelled where the effect would leave the application, and no outcome is
  // ever read from an ephemeral notification: the receipt is the durable surface or it is nothing. The label is
  // read inside the outcomes surface itself: the message's own presentation carries the same boundary sentence,
  // so the page holds two of them and neither is more true than the other.
  await expect(page.locator('[data-slot="delivery-results"]').getByText(SIMULATED_MAIL, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: RESEND_CONTROL })).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast], [data-toast], [role='log']"), "No ephemeral notification may stand in for a durable result").toHaveCount(0);

  // The audience keeps the four membership states apart from any send outcome: an address awaiting proof, a
  // person who chose Off and a restricted membership are excluded with their own reason, and none of them is
  // a failed message. The counts are the read's own, so the page and the read cannot disagree.
  const audience = await readAudience(page);
  expect(fieldAt(audience, "data", "counts", "eligible"), "Eligible memberships in the seeded audience").toBe(5);
  expect(fieldAt(audience, "data", "counts", "excluded"), "Excluded memberships in the seeded audience").toBe(4);
  expect(fieldAt(audience, "data", "memberStates"), "The four membership states the seed lays down").toEqual({ active: 5, "awaiting-proof": 1, off: 2, restricted: 1 });
  await page.goto(AUDIENCE_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Update email audience" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Awaiting proof", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Off", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Restricted", { exact: true }).first()).toBeVisible();
  // Each statement appears twice by design — once in the counts block that summarises the reason and once in
  // the member row the reason applies to — so each is asserted as present rather than counted. They are
  // matched as plain text rather than as a pattern, because the copy carries apostrophes and a text matcher
  // is not a place to escape them.
  await expect(page.getByText("The address is unconfirmed, so there is no consent and no eligibility yet").first()).toBeVisible();
  await expect(page.getByText("The person's own Off choice for this publisher and this purpose excludes this membership").first()).toBeVisible();
  await expect(page.getByText("A restriction excludes this person from this publisher's Update email for this purpose").first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Failed" }), "An excluded membership is never reported as a failed send").toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Accepted — not delivered" })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Outcome unknown" })).toHaveCount(0);

  // A reader who is not a recipient: the inbox states that no message exists rather than a zero, keeps the
  // one-copy rule on screen, labels the simulated boundary, and claims no outcome it did not record.
  await page.goto(INBOX_PATH);
  await expect(page.getByText("No message has been produced for this membership yet")).toBeVisible();
  await expect(page.getByText(/One notification intent produces one message for one recipient/u)).toBeVisible();
  await expect(page.getByText(SIMULATED_MAIL)).toBeVisible();
  await expect(page.getByText("Failed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Outcome unknown", { exact: true })).toHaveCount(0);
});
