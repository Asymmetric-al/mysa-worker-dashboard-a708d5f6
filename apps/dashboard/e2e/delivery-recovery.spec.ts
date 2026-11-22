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
 *   purpose: four active memberships, one awaiting proof, two off (one of them unsubscribed) and one
 *   restricted.
 * - One notice was already recorded for that Update: `intent-update-autumn-en`, meant for
 *   2026-11-10T09:05:00Z and closing 24 elapsed hours later. It carries all three outcomes this
 *   criterion must keep apart — two accepted copies, one definite failure and one unknown result — so the
 *   delivery surface reports them side by side without the file inventing a failure of its own.
 * - `/communication/delivery?intentId=…` is the delivery surface, `/communication/inbox` is the
 *   synthetic inbox of the reader who acts, and `/api/dev` is the development control that arms one
 *   failure plan and moves the scenario clock.
 *
 * **How the notice is submitted, and why.** The seeded world's only frozen candidate was submitted for
 * *Publish only*, and a reviewer may not turn that into *Publish and notify now* — a rule this file must
 * not break to reach a control. The lost-acknowledgement demonstration therefore submits the notice
 * through `POST /api/notify`: the same handler, with the same four-field input and the same zero-based
 * decision-making, that the publish-and-notify control posts to. Every outcome it produces is then read
 * off the durable surfaces a person returns to — the delivery results and the synthetic inbox — rather
 * than off an ephemeral notification, and the stored result is compared by operation identity rather than
 * by text that could coincidentally match.
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
const SEEDED_NOTICE = {
  intentId: "intent-update-autumn-en",
  releaseId: "release-update-en-1",
  intendedAt: "2026-11-10T09:05:00Z",
  deadline: "2026-11-11T09:05:00Z",
} as const;

/**
 * A released edition of the same Update that carries no notice yet, so a notice submitted for it is a
 * genuinely new intent rather than a replay of the seeded one. Its siblings are deliberately not named
 * here: each intent is submitted once per reset, and a release a test has already notified cannot serve
 * as a second test's fresh edition.
 */
const NOT_YET_NOTIFIED_RELEASE = "release-update-fr-1";

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
  const answer = await page.request.post("/api/dev", {
    data: { action, operationId: newAttemptId(), scope: state.scope, expectedRevision: state.revision, payload },
  });
  const body = await jsonOf(answer, `POST /api/dev ${action}`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "unchanged") {
    throw new Error(
      `The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A spec that could not move the clock or arm the failure it names would assert against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`,
    );
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

/** The one publisher this ministry's Update email speaks for, as the audience read states it. */
async function readPublisher(page: Page): Promise<string> {
  return stringAt(await readAudience(page), ["data", "publisherId"], "The publisher of this ministry's Update email");
}

/** Reads one intent's per-recipient results: the same read the delivery surface renders. */
async function readSendResult(page: Page, intentId: string): Promise<unknown> {
  return jsonOf(await page.request.get(`/api/notify?intentId=${encodeURIComponent(intentId)}`), "GET /api/notify");
}

/** Reads the synthetic inbox of whichever reader acts: one message per recipient and notification intent. */
async function readInbox(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get("/api/inbox"), "GET /api/inbox");
}

/**
 * Opens the acting person's own purpose-specific membership and leaves it awaiting proof.
 *
 * This is the application's own signup request — the one the preference surface submits — and it exists
 * here for one reason: a message is addressed to a membership, so the only inbox this file may read is one
 * belonging to a recipient. The membership the signup mints is keyed by the acting principal, which is what
 * makes the notice below address a copy to the person whose inbox is then read, instead of the file
 * asserting a duplicate count on a list the recipient never sees.
 */
async function signUpForPurpose(page: Page, authority: ContentAuthority): Promise<unknown> {
  const answer = await page.request.post("/api/audience", {
    data: {
      operationId: newAttemptId(),
      scope: authority.scope,
      // A signup creates the record it addresses, and a creation compares no stored revision, so the token
      // it presents is the one it just read rather than a revision of a membership that does not exist yet.
      expectedRevision: authority.revision,
      payload: { publisherId: await readPublisher(page), purpose: "update-email", email: "established.worker@example.org" },
    },
  });
  return jsonOf(answer, "POST /api/audience");
}

/** Confirms that membership inside its 168-hour window, which is what makes it eligible rather than merely requested. */
async function confirmMembership(page: Page, authority: ContentAuthority, membershipId: string, revision: string): Promise<unknown> {
  const answer = await page.request.post("/api/confirm", {
    data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: revision, payload: { membershipId } },
  });
  return jsonOf(answer, "POST /api/confirm");
}

/**
 * Submits one notice for one released edition, under a stated attempt identity.
 *
 * Presenting the *same* `operationId` again is a replay: the service answers with the result already
 * recorded for that attempt and applies nothing a second time. Minting a new one is a fresh attempt, and
 * the difference between the two answers is exactly the distinction this criterion turns on: an uncertain
 * outcome is recovered under its own identity, never by sending the same work under a new one.
 */
async function submitNotice(page: Page, input: { readonly authority: ContentAuthority; readonly releaseId: string; readonly intendedAt?: string; readonly operationId?: string }): Promise<NoticeSubmission> {
  const operationId = input.operationId ?? newAttemptId();
  const answer = await page.request.post("/api/notify", {
    data: {
      operationId,
      scope: input.authority.scope,
      expectedRevision: input.authority.revision,
      payload: { documentId: UPDATE_DOCUMENT, releaseId: input.releaseId, ...(input.intendedAt === undefined ? {} : { intendedAt: input.intendedAt }) },
    },
  });
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

  const authority = await readUpdateAuthority(page);

  // The reader whose inbox this test counts is a recipient in the application's own terms: the publisher's
  // own address, opened through the proof step and confirmed inside its window. Nothing here subscribes a
  // partner or imports consent — the membership is the acting person's own act on their own address.
  const signup = await signUpForPurpose(page, authority);
  expect(outcomeOf(signup), "Opening the acting person's own Update-email membership").toBe("accepted");
  const membershipId = stringAt(signup, ["created", "0"], "The membership a signup minted");
  const confirmation = await confirmMembership(page, authority, membershipId, stringAt(signup, ["revision"], "The minted membership's own revision"));
  expect(outcomeOf(confirmation), "Confirming that membership inside its window").toBe("accepted");

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

  // The lost acknowledgement: the plan withholds the response of the notification request itself.
  await armLostAcknowledgement(page);
  const uncertain = await submitNotice(page, { authority, releaseId: NOT_YET_NOTIFIED_RELEASE });
  expect(outcomeOf(uncertain.body), "A notification request whose acknowledgement was lost").toBe("unknown");
  // An unknown outcome states the attempt and nothing else: no created identifier, no result and no claim
  // that the notice was or was not submitted.
  expect(stringAt(uncertain.body, ["operationId"], "The attempt identity an unknown outcome carries")).toBe(uncertain.operationId);
  expect(uncertain.body, "An unknown outcome claims neither a result nor a created identifier").not.toHaveProperty("result");
  expect(uncertain.body, "An unknown outcome claims no created identifier").not.toHaveProperty("created");

  // Checking the result is done under the attempt's own identity, which is the one fact the unknown
  // outcome carries. The answer is the result stored for that attempt: the notice the first submission
  // had already recorded, with its revision and the identifiers it created.
  const recovered = await submitNotice(page, { authority, releaseId: NOT_YET_NOTIFIED_RELEASE, operationId: uncertain.operationId });
  expect(outcomeOf(recovered.body), "Replaying the same attempt identity").toBe("alreadyAccepted");
  const intentId = stringAt(recovered.body, ["result", "intentId"], "The intent the stored result names");
  const sendResultId = stringAt(recovered.body, ["result", "sendResultId"], "The send result the stored result names");
  expect(arrayAt(recovered.body, ["created"], "The identifiers the stored result created"), "A recovery names the identifiers the first submission created").toEqual(expect.arrayContaining([intentId, sendResultId]));
  // Submitting the same work a second time without changing a field answers with the identical result,
  // compared by identity rather than by text that could coincidentally match.
  const recoveredAgain = await submitNotice(page, { authority, releaseId: NOT_YET_NOTIFIED_RELEASE, operationId: uncertain.operationId });
  expect(outcomeOf(recoveredAgain.body), "Replaying it again").toBe("alreadyAccepted");
  expect(stringAt(recoveredAgain.body, ["result", "intentId"], "The intent the second recovery names")).toBe(intentId);
  expect(stringAt(recoveredAgain.body, ["result", "sendResultId"], "The send result the second recovery names")).toBe(sendResultId);
  expect(fieldAt(recoveredAgain.body, "revision"), "A replay advances no revision").toBe(fieldAt(recovered.body, "revision"));

  // The durable surface: the delivery results of that intent, read by the browser, with this person's own
  // row on it. "Check the result" is the surface's only control — reading the same notice again, which can
  // reveal an outcome and can never repeat a submission.
  await openDelivery(page, intentId);
  // The recovery card is the surface's own statement of what a recovery is; its title is a plain card
  // heading rather than an outline entry, so it is read as the card's text.
  const recovery = page.locator('[data-slot="delivery-recovery"]');
  await expect(recovery.getByText("Checking the result", { exact: true })).toBeVisible();
  const checkTheResult = recovery.getByRole("button", { name: "Check the result" });
  await expect(checkTheResult).toBeVisible();
  await expect(recovery.getByRole("button"), "Checking the result is the one control this surface offers").toHaveCount(1);
  await expect(page.getByRole("button", { name: RESEND_CONTROL }), "No control may send this work again under a new key").toHaveCount(0);
  await expect(page.getByRole("link", { name: RESEND_CONTROL }), "No link may send this work again under a new key").toHaveCount(0);
  await expect(page.getByText("Two recorded rows share one dedupe identity")).toHaveCount(0);
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: membershipId })).toHaveCount(1);
  // The three recipients an earlier notice had already covered are recorded as unserved rather than served
  // again, which is the same rule one intent further out: accepted work is never resent under a fresh key.
  await expect(page.getByText("Already had a copy from an earlier notice")).toHaveCount(3);
  // Reading the same notice again performs no effect, so the recovery the surface offers cannot repeat one:
  // the service's own reason for withholding a repeat is stated beside the control, not decided here.
  await checkTheResult.click();
  await expect(recovery.getByText(/No recorded row may be submitted again/u)).toBeVisible();
  await expect(recovery.getByText("A repeat under the same identity")).toBeVisible();

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

  // A fresh attempt at the same work is not a second message: the publication's intent already answers for
  // it, so the service reports that nothing needed doing.
  const freshKey = await submitNotice(page, { authority, releaseId: NOT_YET_NOTIFIED_RELEASE });
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
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: "Repeat permitted" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Repeat not permitted" })).toHaveCount(3);
  await expect(page.getByText(/may be retried under the same intent while the usefulness window is open/u)).toBeVisible();
  await expect(page.getByText(/at least one recorded recipient may be submitted again under this same identity/u)).toBeVisible();
  // The window being open permits a repeat; it never offers one here. The control that would submit belongs
  // to the screen that submitted the notice, and this surface states the permission without providing it.
  await expect(page.getByRole("button", { name: RESEND_CONTROL })).toHaveCount(0);
  await expect(page.getByRole("link", { name: RESEND_CONTROL })).toHaveCount(0);

  // Inside the window, the same work presented again is not refused by the window: it reaches the
  // publication's own rule, which reports that this notice already answers for it. Nothing was submitted
  // and the recorded results did not move, which is what makes the closure below a window boundary rather
  // than a change in the notice.
  const insideWindow = await submitNotice(page, { authority, releaseId: SEEDED_NOTICE.releaseId, intendedAt: SEEDED_NOTICE.intendedAt });
  expect(outcomeOf(insideWindow.body), "The same notice inside its usefulness window").toBe("unchanged");
  expect(fieldAt(await readSendResult(page, SEEDED_NOTICE.intentId), "revision"), "A repeat answered as unchanged records nothing").toBe(fieldAt(before, "revision"));

  // At the closes-at instant exactly: closed. Reading the surface again is the whole of the recovery, and
  // the surface states the service's own reason rather than deciding from the browser's clock.
  await setClock(page, SEEDED_NOTICE.deadline);
  await openDelivery(page, SEEDED_NOTICE.intentId);
  await expect(page.getByText("Past its usefulness window")).toBeVisible();
  await expect(rows.filter({ hasText: "Repeat permitted" })).toHaveCount(0);
  await expect(page.getByText(/24-hour usefulness window has closed, so it cannot be revived as a fresh attempt/u)).toBeVisible();
  await expect(page.getByText("No recorded row may be submitted again: acceptance is never repeated, an uncertain outcome is recovered by re-querying the same intent, and a failure outside its usefulness window cannot be revived.")).toBeVisible();

  // A fresh attempt carrying the notice's own intended instant is refused by the window itself, and a new
  // intent cannot revive it: the refusal names the field and states that the window is what decided.
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

  // One row per recipient, each carrying its own outcome: two accepted, one definite failure and one
  // unknown, which is every outcome the seeded notice recorded and no fourth state beside them.
  await expect(page.getByText("Outcomes recorded for this notice")).toBeVisible();
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: "Accepted — not delivered" })).toHaveCount(2);
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
  // ever read from an ephemeral notification: the receipt is the durable surface or it is nothing.
  await expect(page.getByText(SIMULATED_MAIL)).toBeVisible();
  await expect(page.getByRole("button", { name: RESEND_CONTROL })).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast], [data-toast], [role='log']"), "No ephemeral notification may stand in for a durable result").toHaveCount(0);

  // The audience keeps the four membership states apart from any send outcome: an address awaiting proof, a
  // person who chose Off and a restricted membership are excluded with their own reason, and none of them is
  // a failed message. The counts are the read's own, so the page and the read cannot disagree.
  const audience = await readAudience(page);
  expect(fieldAt(audience, "data", "counts", "eligible"), "Eligible memberships in the seeded audience").toBe(4);
  expect(fieldAt(audience, "data", "counts", "excluded"), "Excluded memberships in the seeded audience").toBe(4);
  expect(fieldAt(audience, "data", "memberStates"), "The four membership states the seed lays down").toEqual({ active: 4, "awaiting-proof": 1, off: 2, restricted: 1 });
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
