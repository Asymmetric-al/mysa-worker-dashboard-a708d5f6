/**
 * Criterion 10 — consent and notification.
 *
 * A reader's own deliberate act opens one purpose-specific membership and confirms the address that
 * membership holds inside a 168-elapsed-hour window; a publication notifies only the subscribers who are
 * eligible for this publisher and this purpose at that instant, each pinned to one rendition; the message
 * a recipient receives renders as HTML and as plain text and claims neither delivery nor reading; an
 * unsubscribe turns off exactly one publisher and one purpose, and a later notice excludes that person;
 * and a notice past its 24-hour usefulness window cannot be submitted or revived. A page load, a GET and
 * a reload confirm and unsubscribe nothing (AAP 0.12.1 criterion 10; AAP 0.8.5 for the four membership
 * states, the Off/Immediate pair and the rules that a subscribed-style flag is not consent and that
 * publication is not delivery; AAP 0.8.7 for both boundaries).
 *
 * **The scenario this file drives, from the deterministic seed.**
 * - The publisher is `publisher-harbour`, the Update-email audience of the seeded established worker's
 *   ministry: four active memberships, one awaiting proof (`membership-awaiting-proof`, accepted
 *   2026-11-16T12:00:00Z, so its window closes at 2026-11-23T12:00:00Z), two off (one of them
 *   unsubscribed) and one restricted. Those four states are what makes "eligible" mean something: the
 *   awaiting-proof, off and restricted memberships must never be counted as recipients.
 * - The seeded subscriber session holds its own membership in the awaiting-proof state, keyed by its
 *   principal, with that same window — the address a reader confirms on the preferences surface, and the
 *   only address this file confirms through the browser without first creating one.
 * - The seeded notice `intent-update-autumn-en` was meant for 2026-11-10T09:05:00Z and stopped being
 *   useful 24 elapsed hours later, at 2026-11-11T09:05:00Z. `release-update-fr-1` and
 *   `release-update-en-approved-supporter-1` are released editions that no notice has been submitted for,
 *   so a notice for either of them is a genuinely new intent rather than a replay.
 * - Every reset lays the scenario clock down at the seed instant, 2026-11-20T00:00:00Z. No instant in
 *   this file is read from a clock: each one is a constant of that seed, and every movement of the clock
 *   is the development control's, so the boundaries are reached rather than waited for.
 *
 * **What the two boundaries are, exactly (AAP 0.8.7).** Confirmation expires 168 elapsed hours after the
 * acceptance, strict at equality: a confirmation at acceptance + 168 h − 1 s is accepted and one at
 * exactly acceptance + 168 h is refused, and the refusal states the window that the recorded acceptance
 * fixed — a reload, a retry and a message sent again never extend it. A notice stays useful for 24
 * elapsed hours from the instant it was intended for, strict at equality: at intended + 24 h − 1 s the
 * window does not refuse the attempt and the one definite failure the seed recorded may still be repeated,
 * and at exactly intended + 24 h the request is rejected and a fresh intent cannot revive it.
 *
 * **How a membership is opened, and why through the transport.** The preferences route renders the proof
 * surface only for a membership the session already holds, and no other route composes the signup control,
 * so the deliberate signup below travels over `POST /api/audience` — the handler that control posts to,
 * with the same four-field input and the same closed outcome set. The confirmation and the unsubscribe are
 * driven through the browser on the preferences surface, because those are the acts the criterion is
 * about. `delivery-recovery.spec.ts` reaches the notification request the same way, and for the same
 * reason: a control that is not composed cannot be clicked, and a journey that skipped the assertion would
 * be weaker evidence than one that states the transport it used.
 *
 * **Why the notice is submitted rather than clicked.** `PublishReview` and its hooks exist, but no route
 * composes them, so this build offers no publish-and-notify control to press. What the criterion needs is
 * still asserted at the boundary the application enforces: the review read states that a reviewer cannot
 * release an edition with a mode its submission did not ask for (so Publish only never becomes Notify by
 * itself), a notice for an edition that publishes no release is refused (so publication and notification
 * are separate acts), and the notice itself is submitted under its own operation identity and then read off
 * the durable surfaces — the delivery results and the synthetic inbox — rather than off anything ephemeral.
 */
import type { Page } from "@playwright/test";

import { expect, resetSeed, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded identities this file acts as
// ---------------------------------------------------------------------------------------------

/** The reader whose seeded membership is awaiting proof: the address the proof surface confirms. */
const SUBSCRIBER_PERSONA: PersonaName = "subscriber";

/** The worker who publishes, holds the audience and can be a recipient of their own publication. */
const WORKER_PERSONA: PersonaName = "established-worker";

// ---------------------------------------------------------------------------------------------
// Fixed values, all taken from the deterministic seed and the specification's own constants
// ---------------------------------------------------------------------------------------------

/** The instant every reset lays the scenario clock down at. A clock this file moved is returned to it. */
const SEED_INSTANT = "2026-11-20T00:00:00Z";

/** The one publisher this ministry's Update email speaks for, as the seed records it on every membership. */
const PUBLISHER = "publisher-harbour";

/** The one Update this file notifies editions of. */
const UPDATE_DOCUMENT = "doc-update-autumn";

/** How long a confirmation stays open after its acceptance, in elapsed hours (AAP 0.8.7). */
const CONFIRMATION_WINDOW_HOURS = 168;

/** How long a notice stays useful after the instant it was intended for, in elapsed hours (AAP 0.8.7). */
const NOTIFICATION_USEFULNESS_HOURS = 24;

/**
 * The window the seeded subscriber's membership records: the acceptance the seed stored, the deadline the
 * confirmation window computes from it, and the last second that is still inside it.
 */
const SEEDED_WINDOW = { acceptedAt: "2026-11-16T12:00:00Z", deadline: "2026-11-23T12:00:00Z", lastConfirmableSecond: "2026-11-23T11:59:59Z" } as const;

/**
 * The window a signup opens at the seed instant: accepted at 2026-11-20T00:00:00Z, so it closes 168
 * elapsed hours later, and the second before that instant is the last one that is still inside it.
 */
const SIGNUP_WINDOW = { acceptedAt: SEED_INSTANT, deadline: "2026-11-27T00:00:00Z", lastConfirmableSecond: "2026-11-26T23:59:59Z" } as const;

/** The seeded notice: the edition it was submitted for, the instant it was meant for and the instant it stops being useful. */
const SEEDED_NOTICE = { intentId: "intent-update-autumn-en", releaseId: "release-update-en-1", intendedAt: "2026-11-10T09:05:00Z", deadline: "2026-11-11T09:05:00Z", lastUsefulSecond: "2026-11-11T09:04:59Z" } as const;

/** The seeded membership states this file counts, so an excluded membership can be shown as excluded rather than missing. */
const SEEDED_MEMBERSHIPS = { awaitingProof: "membership-awaiting-proof", off: "membership-unsubscribed", restricted: "membership-restricted" } as const;

/** The seeded audience: four active memberships and four excluded, one for each of the reasons the states carry. */
const SEEDED_AUDIENCE_COUNTS = { eligible: 4, excluded: 4 } as const;

/** The member states the seed lays down, before this file opens one membership of its own. */
const SEEDED_MEMBER_STATES = { active: 4, "awaiting-proof": 1, off: 2, restricted: 1 } as const;

/** The published editions no notice has been submitted for, so a notice for either is a genuinely new intent. */
const NOT_YET_NOTIFIED = { publicFrench: "release-update-fr-1", approvedSupporter: "release-update-en-approved-supporter-1" } as const;

/** The edition whose frozen candidate is under review and which therefore publishes no release yet. */
const UNRELEASED_VARIANT = "variant-update-autumn-ar-public";

/** The acting worker's own membership is keyed by the principal that opened it: the store's ownership convention. */
const OWN_MEMBERSHIP = "principal-established-worker";

/** The seeded subscriber's membership is keyed the same way, by the principal whose inbox and preferences it is. */
const OWN_MEMBERSHIP_OF_SUBSCRIBER = "principal-subscriber";

/** The email the acting worker gives for its own membership. It is a value on the record and never a key. */
const OWN_EMAIL = "established.worker@example.org";

/** The words the shell states on every surface of this development build. */
const DEVELOPMENT_LABEL = "Development data";

/** The one sentence every simulated mail boundary states, in the specification's own words (AAP 0.7.2). */
const SIMULATED_MAIL = "simulated — no mail leaves this application";

/**
 * The words a resend control would carry, if this application ever grew one. The criterion is that it has
 * not: a repeat is permitted under the same identity or it is not permitted at all, and uncertainty is
 * recovered by re-querying the same intent, so every assertion on this pattern asserts absence.
 */
const RESEND_CONTROL = /resend|send again|send it again|send a new one|new send/iu;

/** The addresses this file drives, named once each. */
const HOME_PATH = "/";
const PREFERENCES_PATH = "/preview/preferences";
const INBOX_PATH = "/communication/inbox";
const AUDIENCE_PATH = "/communication/audience";
const AUDIENCE_API = "/api/audience";
const PREFERENCES_API = "/api/preferences";
const CONFIRM_API = "/api/confirm";
const UNSUBSCRIBE_API = "/api/unsubscribe";
const NOTIFY_API = "/api/notify";
const INBOX_API = "/api/inbox";
const SUPPORT_API = "/api/support";
const REVIEW_API = "/api/review";
const UPDATES_API = "/api/updates";
const DEV_CONTROL_PATH = "/api/dev";

/** The proof surface's own slot, so every assertion inside the flow is scoped to the flow rather than the page. */
const PROOF_FLOW = '[data-slot="proof-flow"]';

/** One intent's delivery results, by the identity the notice was recorded under. */

// ---------------------------------------------------------------------------------------------
// Reading an answer: the four-field envelope, the closed outcome, and the members asserted on
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

/** The per-field messages an `invalid` outcome keyed at one field path, joined as one statement. */
function messagesAt(body: unknown, field: string): string {
  const stated = fieldAt(body, "fields", field);
  return Array.isArray(stated) ? stated.filter((message): message is string => typeof message === "string").join(" ") : "";
}

/** The identifier a caller mints for one attempt. Every mutation admits a canonical lowercase UUID only. */
function newAttemptId(): string {
  return crypto.randomUUID();
}

/** Every recipient identifier, dedupe key and rendition a send result states, so a "nothing new" claim can be compared exactly. */
function sendResultFingerprint(body: unknown): string {
  const rows = arrayAt(body, ["data", "rows"], "A send result's rows").map((row) => [fieldAt(row, "recipientId"), fieldAt(row, "state"), fieldAt(row, "renditionId"), fieldAt(row, "dedupeKey")].join("|"));
  return rows.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join("\n");
}

// ---------------------------------------------------------------------------------------------
// The development controls: the one clock this file moves, and the state each control presents
// ---------------------------------------------------------------------------------------------

/** What one session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/**
 * Reads this session's development state.
 *
 * Every control presents the scope and the revision it read, and the service re-authorises the scope and
 * answers `conflict` for a revision that no longer stands, so the state is read immediately before each
 * control rather than once per test.
 */
async function readDevState(page: Page): Promise<DevState> {
  const body = await jsonOf(await page.request.get(DEV_CONTROL_PATH), `GET ${DEV_CONTROL_PATH}`);
  const scope = fieldAt(body, "scope");
  if (!isRecord(scope)) {
    throw new Error(`GET ${DEV_CONTROL_PATH} answered without the scope a development control runs under: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { scope, revision: stringAt(body, ["revision"], "The development state's revision") };
}

/** Operates exactly one named development control and refuses to continue if the control was not applied. */
async function operateDevControl(page: Page, action: string, payload: JsonRecord): Promise<unknown> {
  const state = await readDevState(page);
  const body = await jsonOf(await page.request.post(DEV_CONTROL_PATH, { data: { action, operationId: newAttemptId(), scope: state.scope, expectedRevision: state.revision, payload } }), `POST ${DEV_CONTROL_PATH} ${action}`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "unchanged") {
    throw new Error(`The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A spec that could not reach the instant it names would assert against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`);
  }
  return body;
}

/** Moves this session's scenario clock to one instant, which is how a window boundary is reached without waiting. */
async function setClock(page: Page, instant: string): Promise<void> {
  await operateDevControl(page, "setClock", { offsetIso: instant });
}

/** Puts the scenario clock back where every seed lays it down, so the next test starts from the world it names. */
async function restoreSeedInstant(page: Page): Promise<void> {
  await setClock(page, SEED_INSTANT);
}

// ---------------------------------------------------------------------------------------------
// The application's own reads, called the way the browser calls them
// ---------------------------------------------------------------------------------------------

/** One attempt's authority: the scope it claims, and the revision the record it addresses stands at. */
interface Authority {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/** The authority a development control runs under, which is also the scope every audience mutation claims. */
async function controlAuthority(page: Page): Promise<Authority> {
  const state = await readDevState(page);
  return { scope: state.scope, revision: state.revision };
}

/** The reader's own preference record: the state, the Off/Immediate choice, the language and the proof window. */
async function readPreferences(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get(PREFERENCES_API), `GET ${PREFERENCES_API}`);
}

/** The publisher's Update-email audience, from which every membership state and exclusion reason is taken. */
async function readAudience(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get(AUDIENCE_API), `GET ${AUDIENCE_API}`);
}

/** The synthetic inbox of whichever reader acts: one message per recipient and notification intent. */
async function readInbox(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get(INBOX_API), `GET ${INBOX_API}`);
}

/** One intent's per-recipient results: the same read the delivery surface renders. */
async function readSendResult(page: Page, intentId: string): Promise<unknown> {
  return jsonOf(await page.request.get(`${NOTIFY_API}?intentId=${encodeURIComponent(intentId)}`), `GET ${NOTIFY_API}`);
}

/** The publisher's support read, which no consent change may touch: the comparator for "no financial fact changed". */
async function readSupport(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get(SUPPORT_API), `GET ${SUPPORT_API}`);
}

/** The frozen candidate an edition holds under review, with the release actions the service offers and refuses. */
async function readReviewOffer(page: Page, variantId: string): Promise<unknown> {
  return jsonOf(await page.request.get(`${REVIEW_API}?variantId=${encodeURIComponent(variantId)}`), `GET ${REVIEW_API}`);
}

/** The Update document's own revision, which a content mutation presents as the revision it read. */
async function readDocumentRevision(page: Page): Promise<string> {
  const body = await jsonOf(await page.request.get(`${UPDATES_API}?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`), `GET ${UPDATES_API}`);
  return stringAt(body, ["revision"], "The Update document's revision");
}

/** One release action's availability and the reason the service states for it, by name. */
function actionOf(body: unknown, name: string): { readonly available: boolean; readonly reason: string } {
  const action = arrayAt(body, ["actions"], "The read's advisory actions").find((candidate) => fieldAt(candidate, "name") === name);
  if (action === undefined) {
    throw new Error(`The read states no action named ${JSON.stringify(name)}: ${JSON.stringify(fieldAt(body, "actions")).slice(0, 400)}`);
  }
  return { available: fieldAt(action, "available") === true, reason: typeof fieldAt(action, "reason") === "string" ? (fieldAt(action, "reason") as string) : "" };
}

// ---------------------------------------------------------------------------------------------
// The application's own writes, at the boundary the browser submits them to
// ---------------------------------------------------------------------------------------------

/**
 * Opens the acting person's own purpose-specific membership, which leaves it awaiting proof.
 *
 * This is the application's own signup — the request the preference surface's signup control submits —
 * and it is used here because the preferences route renders the proof surface only for a membership the
 * session already holds. The membership it mints is keyed by the acting principal, which is what makes the
 * notice below address a copy to the person whose inbox is then read.
 */
async function signUpForNotices(page: Page): Promise<string> {
  const authority = await controlAuthority(page);
  const body = await jsonOf(await page.request.post(AUDIENCE_API, { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.revision, payload: { publisherId: PUBLISHER, purpose: "update-email", email: OWN_EMAIL } } }), `POST ${AUDIENCE_API}`);
  expect(outcomeOf(body), "Opening the acting person's own Update-email membership").toBe("accepted");
  return stringAt(body, ["created", "0"], "The membership a signup minted");
}

/** Submits one notice for one published edition, under a stated attempt identity. */
async function submitNotice(page: Page, input: { readonly releaseId?: string; readonly variantId?: string; readonly intendedAt?: string }): Promise<{ readonly operationId: string; readonly body: unknown }> {
  const authority = await controlAuthority(page);
  const operationId = newAttemptId();
  const body = await jsonOf(
    await page.request.post(NOTIFY_API, {
      data: {
        operationId,
        scope: authority.scope,
        expectedRevision: await readDocumentRevision(page),
        payload: { documentId: UPDATE_DOCUMENT, ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }), ...(input.variantId === undefined ? {} : { variantId: input.variantId }), ...(input.intendedAt === undefined ? {} : { intendedAt: input.intendedAt }) },
      },
    }),
    `POST ${NOTIFY_API}`,
  );
  return { operationId, body };
}

/**
 * Submits one confirmation of one membership, presenting the revision the preferences read states.
 *
 * This is the transport the Confirm control posts to, used where the answer itself is the assertion — a
 * refusal at a boundary cannot be clicked, because the surface disables the control at that instant.
 */
async function submitConfirmation(page: Page, membershipId: string): Promise<unknown> {
  const authority = await controlAuthority(page);
  const preferences = await readPreferences(page);
  return jsonOf(await page.request.post(CONFIRM_API, { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: stringAt(preferences, ["revision"], "The preferences read's revision"), payload: { membershipId } } }), `POST ${CONFIRM_API}`);
}

/** The intent and the send result a accepted notice created, in the order the outcome states them. */
function noticeIdentitiesOf(body: unknown): { readonly intentId: string; readonly sendResultId: string } {
  return { intentId: stringAt(body, ["created", "0"], "The intent a notice created"), sendResultId: stringAt(body, ["created", "1"], "The send result a notice created") };
}

// ---------------------------------------------------------------------------------------------
// The surfaces this file reads in the browser
// ---------------------------------------------------------------------------------------------

/** Opens the reader's own preference-and-consent surface, and waits for the page's own heading. */
async function openPreferences(page: Page): Promise<void> {
  await page.goto(PREFERENCES_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Your preferences" })).toBeVisible();
}

/** Opens the synthetic inbox and waits for the surface itself rather than for a spinner. */
async function openInbox(page: Page): Promise<void> {
  await page.goto(INBOX_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic inbox" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Messages produced for this membership" })).toBeVisible();
}

/** Opens one intent's delivery results, which is where a recorded outcome and its window are read. */
async function openDelivery(page: Page, intentId: string): Promise<void> {
  await page.goto(deliveryPathOf(intentId));
  await expect(page.getByRole("heading", { level: 1, name: "Delivery" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Delivery results" })).toBeVisible();
}

/** Opens the publisher's audience, which states each membership's state and why it is excluded. */
async function openAudience(page: Page): Promise<void> {
  await page.goto(AUDIENCE_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Update email audience" })).toBeVisible();
}

function deliveryPathOf(intentId: string): string {
  return `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
}

// ---------------------------------------------------------------------------------------------
// Criterion 10, first half: the reader's own proof flow, and the acts that confirm nothing
// ---------------------------------------------------------------------------------------------

test.describe("a reader's own proof flow", () => {
  // The seeded subscriber holds one membership awaiting proof, keyed by its own principal, so the proof
  // surface below is the one a reader sees: no membership has to be created for the flow to be walked.
  test.use({ persona: SUBSCRIBER_PERSONA });

  test.beforeEach(async ({ request }) => {
    await resetSeed(request, SUBSCRIBER_PERSONA);
  });

  test("an address is confirmed only by the person's own act, never by rendering or reloading the page", async ({ page }) => {
    // The one Development data assertion in this file: every outcome below is read off a development build,
    // and a reader who mistook a recorded acceptance for a delivered message would misread all of them.
    await page.goto(HOME_PATH);
    await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();

    await openPreferences(page);
    const proof = page.locator(PROOF_FLOW);
    await expect(proof).toBeVisible();
    await expect(proof.getByRole("heading", { level: 2, name: "Confirm this address for notices" })).toBeVisible();
    await expect(proof.getByText("Awaiting proof", { exact: true })).toBeVisible();
    // The pending result is neutral: it says the address is waiting, that rendering the page is not a
    // confirmation, and that the notice is simulated — which is where the confirmation message is rendered.
    await expect(proof.getByText("This address is still waiting for confirmation", { exact: true })).toBeVisible();
    await expect(proof.getByText(/Opening this page, reloading it or previewing a link here is never a confirmation/u)).toBeVisible();
    await expect(proof.getByText(/Notice sending is simulated — no mail leaves this application/u)).toBeVisible();
    // The window is stated in elapsed hours and carries the deadline the acceptance fixed, not a date range.
    await expect(proof.getByText(new RegExp(`${String(CONFIRMATION_WINDOW_HOURS)} elapsed hours`, "u"))).toBeVisible();
    await expect(proof.getByText(/This address can be confirmed until/u)).toBeVisible();
    await expect(proof.getByText(SEEDED_WINDOW.deadline, { exact: true })).toBeVisible();
    await expect(proof.getByText(/calendar day/u)).toHaveCount(0);

    // The read behind the surface: awaiting proof, no claim that a message was sent, the window open, and a
    // state that is not the word a subscribed-style flag would carry.
    const pending = await readPreferences(page);
    expect(fieldAt(pending, "data", "state"), "A signup leaves the membership awaiting proof").toBe("awaiting-proof");
    expect(fieldAt(pending, "data", "membershipId"), "The membership the read addresses").toBe(OWN_MEMBERSHIP_OF_SUBSCRIBER);
    expect(fieldAt(pending, "data", "pending", "claimsMailSent"), "The pending result claims no message was sent").toBe(false);
    expect(fieldAt(pending, "data", "pending", "nextStep"), "The pending result's own next step").toBe("confirm-from-the-rendered-message");
    expect(fieldAt(pending, "data", "confirmation", "state"), "The confirmation window at the seed instant").toBe("open");
    expect(stringAt(pending, ["data", "confirmation", "deadline"], "The confirmation window's deadline"), "The window closes 168 elapsed hours after the acceptance").toBe(SEEDED_WINDOW.deadline);
    expect(stringAt(pending, ["data", "acceptedOn"], "The acceptance the window runs from"), "The acceptance the seed recorded").toBe(SEEDED_WINDOW.acceptedAt);

    // The message a reader follows carries no token, and neither does the address it lands on: the
    // confirmation is identified by the membership and the person's own act alone.
    const landed = new URL(page.url());
    expect(landed.search, "The confirmation message carries no token a page load could use").toBe("");
    expect(landed.pathname, "The message lands on the preferences surface itself").toBe(PREFERENCES_PATH);

    // Nothing in the flow is a credential the person has to retype or paste: the address is read back from
    // the record, and no control declares a paste interception or a password field. Accessible
    // Authentication Minimum and Redundant Entry are therefore satisfied by the flow's own shape.
    await expect(proof.getByText("Address on this membership", { exact: true })).toBeVisible();
    await expect(proof.locator('input[type="password"], input[autocomplete="off"], textarea[onpaste], input[onpaste]'), "No field in the proof flow blocks a paste or asks for a secret").toHaveCount(0);

    // A GET cannot confirm or unsubscribe: both transports export POST only, which is what makes a link
    // preview, a scanner and a page load harmless.
    expect((await page.request.get(CONFIRM_API)).status(), "A GET to the confirmation transport is not admitted").toBe(405);
    expect((await page.request.get(UNSUBSCRIBE_API)).status(), "A GET to the unsubscribe transport is not admitted").toBe(405);

    // Reloading the page is a GET navigation, and it confirms nothing: the same refusals and the same
    // deadline are read afterwards.
    await page.reload();
    await expect(proof.getByText("This address is still waiting for confirmation", { exact: true })).toBeVisible();
    const afterReload = await readPreferences(page);
    expect(fieldAt(afterReload, "data", "state"), "Reloading the page converts nothing").toBe("awaiting-proof");
    expect(stringAt(afterReload, ["data", "confirmation", "deadline"], "The window after a reload"), "A page load neither extends nor consumes the window").toBe(SEEDED_WINDOW.deadline);

    // The person's own act, and the only one: the Confirm control.
    const confirmControl = proof.getByRole("button", { name: /Confirm this address/u });
    await expect(confirmControl, "The control is offered inside the open window").toBeEnabled();
    await confirmControl.click();
    // The receipt is the durable record of the act, and it stays on the surface rather than passing as a toast.
    await expect(proof.getByText("Saved", { exact: true })).toBeVisible();
    await expect(proof.getByText(/The change was applied once, and it stays on this page as the record of it/u)).toBeVisible();

    const confirmed = await readPreferences(page);
    expect(fieldAt(confirmed, "data", "state"), "The person's own act makes the membership active").toBe("active");
    expect(fieldAt(confirmed, "data", "confirmation", "state"), "Nothing is waiting for confirmation once it is confirmed").toBe("not-awaiting-proof");

    // Read again after a reload: the confirmed state renders, the window that was recorded is still stated,
    // and a confirmed membership is explicitly not a delivery.
    await page.reload();
    await expect(proof.getByText("This address is confirmed", { exact: true })).toBeVisible();
    await expect(proof.getByText("Active", { exact: true })).toBeVisible();
    await expect(proof.getByText(/is not a delivery/u)).toBeVisible();
    // The address is read back from the record rather than retyped, which is the flow's own answer to
    // Redundant Entry: nothing here asks the person for a value they have already given.
    await expect(proof.getByText("Address on this membership", { exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// Criterion 10, second half: the two boundaries, the notice, the message and the exclusion
// ---------------------------------------------------------------------------------------------

test.describe("the worker who publishes, holds the audience and can be a recipient", () => {
  // The established worker is the publisher of this ministry's Update email, holds the audience the
  // notice is drawn from, and can open its own membership — which is what makes the message below
  // readable in the inbox that acts for it.
  test.use({ persona: WORKER_PERSONA });

  test.beforeEach(async ({ request }) => {
    await resetSeed(request, WORKER_PERSONA);
  });

  test("a confirmation one second inside the 168-elapsed-hour window is accepted", async ({ page }) => {
    const membershipId = await signUpForNotices(page);
    expect(membershipId, "The membership is keyed by the principal that opened it").toBe(OWN_MEMBERSHIP);
    const opened = await readPreferences(page);
    expect(fieldAt(opened, "data", "state"), "A signup opens the proof step and nothing more").toBe("awaiting-proof");
    expect(stringAt(opened, ["data", "acceptedOn"], "The acceptance a signup recorded"), "The acceptance is the scenario instant").toBe(SIGNUP_WINDOW.acceptedAt);
    expect(stringAt(opened, ["data", "confirmation", "deadline"], "The deadline a signup recorded"), "The window closes 168 elapsed hours after the acceptance").toBe(SIGNUP_WINDOW.deadline);

    // One second before the window closes: inside it, because the boundary is strict at equality.
    await setClock(page, SIGNUP_WINDOW.lastConfirmableSecond);
    await openPreferences(page);
    const proof = page.locator(PROOF_FLOW);
    await expect(proof.getByText(SIGNUP_WINDOW.deadline, { exact: true })).toBeVisible();
    const stillOpen = await readPreferences(page);
    expect(fieldAt(stillOpen, "data", "confirmation", "state"), "One second before the deadline is still inside the window").toBe("open");
    const confirmControl = proof.getByRole("button", { name: /Confirm this address/u });
    await expect(confirmControl, "The control is offered inside the open window").toBeEnabled();
    await confirmControl.click();
    await expect(proof.getByText("Saved", { exact: true })).toBeVisible();
    const confirmed = await readPreferences(page);
    expect(fieldAt(confirmed, "data", "state"), "The confirmation inside the window is applied").toBe("active");
    // The page is read again: the confirmed step is what the record now states, and the load confirms nothing.
    await page.reload();
    await expect(proof.getByText("This address is confirmed", { exact: true })).toBeVisible();

    // The clock this test moved is returned to the seed instant, so the next test starts where the seed says.
    await restoreSeedInstant(page);
  });

  test("a confirmation at exactly 168 elapsed hours is refused, and nothing revives the window", async ({ page }) => {
    const membershipId = await signUpForNotices(page);
    const opened = await readPreferences(page);
    const recordedDeadline = stringAt(opened, ["data", "confirmation", "deadline"], "The deadline a signup recorded");
    expect(recordedDeadline).toBe(SIGNUP_WINDOW.deadline);

    // At the deadline exactly: closed, because a read at the boundary is refused rather than admitted.
    await setClock(page, SIGNUP_WINDOW.deadline);
    await openPreferences(page);
    const proof = page.locator(PROOF_FLOW);
    await expect(proof.getByText(/The confirmation window closed at/u)).toBeVisible();
    await expect(proof.getByText(SIGNUP_WINDOW.deadline, { exact: true })).toBeVisible();
    await expect(proof.getByText(/The service reports this window as closed/u)).toBeVisible();
    // The control stays where it is and is disabled, so a closed window is never mistaken for a missing action.
    await expect(proof.getByRole("button", { name: /Confirm this address/u })).toBeDisabled();
    // The wording is elapsed hours, and it states that reloading, retrying or resending never extends it.
    await expect(proof.getByText(new RegExp(`${String(CONFIRMATION_WINDOW_HOURS)} elapsed hours`, "u"))).toBeVisible();
    await expect(proof.getByText(/never extends it/u)).toBeVisible();
    await expect(proof.getByText(/calendar day/u)).toHaveCount(0);
    const closedWindow = await readPreferences(page);
    expect(fieldAt(closedWindow, "data", "confirmation", "state"), "At the deadline the window is expired").toBe("expired");
    expect(fieldAt(closedWindow, "data", "state"), "An expired window leaves the membership awaiting proof").toBe("awaiting-proof");

    // The transport refuses the same confirmation at that instant, with the reason the boundary gives.
    const refused = await submitConfirmation(page, membershipId);
    expect(outcomeOf(refused), "A confirmation at exactly the deadline").toBe("invalid");
    const refusal = messagesAt(refused, "membershipId");
    expect(refusal, "The refusal names the expired confirmation").toMatch(/confirmation-expired/u);
    expect(refusal, "The refusal states the instant the window ended").toContain(SIGNUP_WINDOW.deadline);
    expect(refusal, "The refusal states that a reload, a retry and a resend never extend the window").toMatch(/reload, a retry and a message sent again never extend it/u);

    // Neither a reload nor a second attempt renews it: the deadline the record holds is the one the
    // acceptance fixed, and no control on the surface offers to send the message again.
    await page.reload();
    await expect(proof.getByRole("button", { name: /Confirm this address/u })).toBeDisabled();
    const retried = await submitConfirmation(page, membershipId);
    expect(outcomeOf(retried), "A retry at the same instant is refused in the same terms").toBe("invalid");
    expect(messagesAt(retried, "membershipId")).toMatch(/confirmation-expired/u);
    const afterRetries = await readPreferences(page);
    expect(stringAt(afterRetries, ["data", "confirmation", "deadline"], "The deadline after two refusals"), "Nothing a person can press extends the window").toBe(recordedDeadline);
    expect(fieldAt(afterRetries, "data", "state"), "A refused confirmation changes nothing").toBe("awaiting-proof");
    await expect(page.getByRole("button", { name: RESEND_CONTROL }), "No control may send the confirmation again as a fresh window").toHaveCount(0);
    await expect(page.getByRole("link", { name: RESEND_CONTROL }), "No link may send the confirmation again as a fresh window").toHaveCount(0);

    await restoreSeedInstant(page);
  });

  test("a publication notifies only the eligible subscribers, and the message claims neither delivery nor reading", async ({ page }) => {
    // Publish only is not Notify now: the review read states that a reviewer cannot release an edition
    // with a mode its submission did not ask for, so the one cannot silently become the other.
    const offer = await readReviewOffer(page, UNRELEASED_VARIANT);
    const publishOnly = actionOf(offer, "publish-only");
    const notifyNow = actionOf(offer, "publish-and-notify-now");
    expect(publishOnly.available, "This edition is still awaiting its one review").toBe(false);
    expect(publishOnly.reason).toMatch(/awaiting its one review/u);
    expect(notifyNow.available, "A reviewer cannot turn a publish-only submission into a notice").toBe(false);
    expect(notifyNow.reason).toMatch(/with a mode the submission did not ask for/u);

    // Publication and notification are separate acts: an edition that publishes no release has nothing to
    // notify anyone about, so a notice cannot stand in for a publication that has not happened.
    const early = await submitNotice(page, { variantId: UNRELEASED_VARIANT, intendedAt: SEED_INSTANT });
    expect(outcomeOf(early.body), "A notice for an edition that publishes no release").toBe("invalid");
    expect(messagesAt(early.body, "releaseId"), "The refusal states that nothing is published to notify").toMatch(/publishes no release yet/u);

    // The acting person opens its own membership — the deliberate act, not a subscribed flag — and
    // confirms it, which is what makes it eligible rather than merely requested.
    const membershipId = await signUpForNotices(page);
    const confirmation = await submitConfirmation(page, membershipId);
    expect(outcomeOf(confirmation), "Confirming the address inside its window").toBe("accepted");
    const audience = await readAudience(page);
    expect(fieldAt(audience, "data", "counts", "eligible"), "The seeded actives plus the membership just confirmed").toBe(SEEDED_AUDIENCE_COUNTS.eligible + 1);
    expect(fieldAt(audience, "data", "counts", "excluded"), "An address awaiting proof, two Off choices and one restriction").toBe(SEEDED_AUDIENCE_COUNTS.excluded);
    expect(fieldAt(audience, "data", "memberStates"), "The four states stay four").toEqual({ ...SEEDED_MEMBER_STATES, active: SEEDED_MEMBER_STATES.active + 1 });

    // One deliberate notice for one published edition, under its own attempt identity.
    const submitted = await submitNotice(page, { releaseId: NOT_YET_NOTIFIED.publicFrench, intendedAt: SEED_INSTANT });
    expect(outcomeOf(submitted.body), "Submitting the notice for the published edition").toBe("accepted");
    const { intentId, sendResultId } = noticeIdentitiesOf(submitted.body);
    expect(sendResultId, "A notice records its per-recipient results under its own identity").not.toBe(intentId);

    const result = await readSendResult(page, intentId);
    const eligibleCount = numberOf(audience, ["data", "counts", "eligible"], "The audience's eligible count");
    expect(numberOf(result, ["data", "ceilingCount"], "The ceiling the accepted notice may not exceed"), "The ceiling is the eligible count it was acknowledged at").toBe(eligibleCount);
    expect(fieldAt(result, "data", "usefulness", "state"), "A notice submitted for the scenario instant is still useful").toBe("within-usefulness");
    expect(stringAt(result, ["data", "usefulness", "deadline"], "The notice's usefulness deadline"), `Usefulness runs ${String(NOTIFICATION_USEFULNESS_HOURS)} elapsed hours from the instant it was intended for`).toBe("2026-11-21T00:00:00Z");
    const rows = arrayAt(result, ["data", "rows"], "The intent's per-recipient rows");
    const own = rows.filter((row) => fieldAt(row, "recipientId") === OWN_MEMBERSHIP);
    expect(own, "One row per recipient, so the acting person's own membership appears once").toHaveLength(1);
    const ownRendition = stringAt(own[0], ["renditionId"], "The rendition the acting person was pinned to");
    // Only eligible memberships are counted: an address awaiting proof, an Off membership and a
    // restricted one appear neither as served nor as unserved, because they were never candidates.
    const statedRecipients = [...rows, ...arrayAt(result, ["data", "unserved"], "The recipients this intent did not serve")].map((row) => fieldAt(row, "recipientId"));
    for (const excluded of Object.values(SEEDED_MEMBERSHIPS)) {
      expect(statedRecipients, `The excluded membership ${excluded} is not a recipient of this notice`).not.toContain(excluded);
    }
    expect(
      arrayAt(result, ["data", "unserved"], "The recipients this intent did not serve").every((row) => fieldAt(row, "reason") === "already-covered"),
      "Every eligible recipient it did not serve was already covered by an earlier notice",
    ).toBe(true);
    expect(
      arrayAt(result, ["data", "rows"], "The intent's rows").every((row) => fieldAt(row, "state") === "accepted"),
      "An accepted notice is accepted for every recipient it served",
    ).toBe(true);

    // The durable surface: the trigger's own result states the simulated boundary, the window it stands in,
    // each recorded outcome, and that acceptance is neither delivery nor reading.
    await openDelivery(page, intentId);
    await expect(page.getByText(SIMULATED_MAIL).first()).toBeVisible();
    await expect(page.getByText("Within its usefulness window").first()).toBeVisible();
    await expect(page.getByText("Outcomes recorded for this notice").first()).toBeVisible();
    await expect(page.getByText("Accepted — not delivered", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/It is not delivery and it is not reading/u).first()).toBeVisible();
    await expect(page.getByRole("button", { name: RESEND_CONTROL }), "An accepted copy is never submitted again").toHaveCount(0);
    await expect(page.locator("[data-sonner-toast], [data-toast], [role='log']"), "No ephemeral notification may stand in for a durable result").toHaveCount(0);

    // The message, in the recipient's own inbox, at the copy it was pinned to: one message for one intent.
    const inbox = await readInbox(page);
    expect(numberOf(inbox, ["data", "intentCount"], "Messages in the inbox after the send"), "One intent produced one message for this recipient").toBe(1);
    const messages = arrayAt(inbox, ["data", "messages"], "The inbox's messages");
    expect(messages, "One message per recipient and intent").toHaveLength(1);
    const message = messages[0];
    expect(fieldAt(message, "intentId"), "The message is the intent that was submitted").toBe(intentId);
    expect(fieldAt(message, "state"), "The message carries the outcome that was recorded").toBe("accepted");
    expect(stringAt(message, ["renditionId"], "The rendition the message was pinned to"), "The recipient is pinned to the one rendition the send result states").toBe(ownRendition);

    await openInbox(page);
    await expect(page.getByText("One message has been produced for this membership.").first()).toBeVisible();
    await expect(page.getByText(SIMULATED_MAIL).first()).toBeVisible();
    await expect(page.getByText(/One notification intent produces one message for one recipient/u).first()).toBeVisible();
    await expect(page.getByText("Two messages share one recipient and one notification intent"), "A second copy of one intent would be a defect stated here").toHaveCount(0);
    const sender = stringAt(message, ["sender"], "The message's sender");
    const subject = stringAt(message, ["subject"], "The message's subject");
    await expect(page.getByText(sender, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(subject, { exact: true }).first()).toBeVisible();

    // Both renderings are real: the HTML tab renders the notice, and the plain-text tab renders the same
    // message as a readable alternative in a pre-formatted block rather than as a note about one.
    await page.getByRole("button", { name: /^Open the message/u }).click();
    await expect(page.getByRole("heading", { level: 3, name: "The message as it was produced for this recipient" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "HTML" })).toBeVisible();
    await expect(page.getByText("An update has been published.").first()).toBeVisible();
    await page.getByRole("tab", { name: "Plain text" }).click();
    const plainBody = page.locator("pre").filter({ hasText: "Open the update" });
    await expect(plainBody, "The plain-text tab renders the whole message, not a note about one").toBeVisible();
    await expect(plainBody).toContainText(/You are receiving updates by email because you asked to hear from this publisher/u);
    // The honesty note, and the absence of any claim the application cannot make.
    await expect(page.getByText(/It is not a delivered message and not a read one/u).first()).toBeVisible();
    await expect(page.getByText(/^Delivered$/u), "No surface claims a message was delivered").toHaveCount(0);
    await expect(page.getByText(/^Opened$/u), "No surface claims a message was read").toHaveCount(0);

    // The audience keeps the four states apart from any send outcome, and states that a subscribed-style
    // flag, an imported row, a contact edit or an existing record is not consent.
    await openAudience(page);
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Awaiting proof", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Off", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Restricted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/A subscribed-style flag, an imported row, a contact edit or an existing partner record is not consent/u)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Accepted — not delivered" }), "A membership is never reported as a send outcome").toHaveCount(0);
  });

  test("unsubscribing turns off one publisher and one purpose, and a later notice excludes that person", async ({ page }) => {
    // The membership the reader will turn off, opened and confirmed by that reader's own acts.
    const membershipId = await signUpForNotices(page);
    expect(outcomeOf(await submitConfirmation(page, membershipId)), "Confirming the acting person's own address").toBe("accepted");
    const before = await readPreferences(page);
    const languageBefore = fieldAt(before, "data", "languagePreference");
    const supportBefore = await readSupport(page);
    const supportRevisionBefore = stringAt(supportBefore, ["revision"], "The support read's revision");
    const receivedBefore = fieldAt(supportBefore, "data", "report", "summary", "0", "received", "minorUnits");

    // A notice reaches the eligible recipient, which is the state the unsubscribe then has to change.
    const first = await submitNotice(page, { releaseId: NOT_YET_NOTIFIED.publicFrench, intendedAt: SEED_INSTANT });
    expect(outcomeOf(first.body), "Submitting the notice the recipient is eligible for").toBe("accepted");
    const firstIntent = noticeIdentitiesOf(first.body).intentId;
    expect(numberOf(await readInbox(page), ["data", "intentCount"], "Messages in the inbox before unsubscribing")).toBe(1);

    // The unsubscribe is the message's own action on the reader's own surface, and it names exactly one
    // publisher and one purpose before anything is confirmed.
    await openPreferences(page);
    const unsubscribe = page.locator('[data-slot="unsubscribe-confirm"]');
    await expect(unsubscribe.getByRole("heading", { name: "Turn off notices from this publisher" })).toBeVisible();
    await expect(unsubscribe.getByText(/This membership today:/u)).toBeVisible();
    await expect(unsubscribe.getByText(/changes one membership/u)).toBeVisible();
    await unsubscribe.getByRole("button", { name: /Turn off Update email from/u }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // What the action cannot do is stated before it is confirmed: a submitted notice is not recalled.
    await expect(dialog.getByText("What turning this off cannot do", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/A notice that was already submitted cannot be recalled/u)).toBeVisible();
    await expect(dialog.getByText(/every other record about you stay as they are/iu)).toBeVisible();
    await dialog.getByRole("button", { name: /Turn off Update email from/u }).click();
    await expect(page.locator('[data-slot="unsubscribe-confirm-result"]')).toBeVisible();
    await expect(unsubscribe.getByText("Saved", { exact: true })).toBeVisible();
    await expect(unsubscribe.getByText(/Only this membership changed/u).first()).toBeVisible();

    // One membership changed: this publisher's Update email for this purpose, and nothing beside it.
    const after = await readPreferences(page);
    expect(fieldAt(after, "data", "state"), "The membership is off for this purpose").toBe("off");
    expect(fieldAt(after, "data", "choice"), "The choice the record now holds").toBe("off");
    expect(fieldAt(after, "data", "publisherId"), "The same publisher, and only it").toBe(PUBLISHER);
    expect(fieldAt(after, "data", "languagePreference"), "A language preference is not consent and is untouched").toEqual(languageBefore);
    const supportAfter = await readSupport(page);
    expect(stringAt(supportAfter, ["revision"], "The support read's revision after the unsubscribe"), "No financial fact changed").toBe(supportRevisionBefore);
    expect(fieldAt(supportAfter, "data", "report", "summary", "0", "received", "minorUnits"), "No received amount changed").toEqual(receivedBefore);

    const audience = await readAudience(page);
    expect(fieldAt(audience, "data", "counts", "eligible"), "The person who turned notices off is no longer eligible").toBe(SEEDED_AUDIENCE_COUNTS.eligible);
    expect(fieldAt(audience, "data", "counts", "excluded"), "And is excluded rather than missing").toBe(SEEDED_AUDIENCE_COUNTS.excluded + 1);
    expect(fieldAt(audience, "data", "excludedByReason", "unsubscribed"), "The exclusion is an unsubscribe, kept apart from an Off choice").toBe(2);
    const own = arrayAt(audience, ["data", "members"], "The audience's members").find((member) => fieldAt(member, "membershipId") === OWN_MEMBERSHIP);
    expect(fieldAt(own, "state"), "The membership read back as off").toBe("off");
    expect(fieldAt(own, "exclusionReason"), "The read states why it is excluded").toBe("unsubscribed");
    await openAudience(page);
    await expect(page.getByText(/The person unsubscribed from this publisher and this purpose/u).first()).toBeVisible();

    // A later notice excludes that person: the ceiling is the eligible count without them, no recipient row
    // names them, and no second message appears in their inbox.
    const later = await submitNotice(page, { releaseId: NOT_YET_NOTIFIED.approvedSupporter, intendedAt: SEED_INSTANT });
    expect(outcomeOf(later.body), "A later notice for another published edition").toBe("accepted");
    const laterIntent = noticeIdentitiesOf(later.body).intentId;
    expect(laterIntent, "Every notice is its own intent").not.toBe(firstIntent);
    const laterResult = await readSendResult(page, laterIntent);
    expect(numberOf(laterResult, ["data", "ceilingCount"], "The later notice's ceiling"), "The ceiling is the eligible count after the unsubscribe").toBe(SEEDED_AUDIENCE_COUNTS.eligible);
    const laterRecipients = [...arrayAt(laterResult, ["data", "rows"], "The later notice's rows"), ...arrayAt(laterResult, ["data", "unserved"], "The later notice's unserved recipients")].map((row) => fieldAt(row, "recipientId"));
    expect(laterRecipients, "The person who turned notices off is not a recipient of the later notice").not.toContain(OWN_MEMBERSHIP);
    const inboxAfter = await readInbox(page);
    expect(numberOf(inboxAfter, ["data", "intentCount"], "Messages in the inbox after the later notice"), "No second message appears for the person who turned them off").toBe(1);
    expect(
      arrayAt(inboxAfter, ["data", "messages"], "The inbox's messages").map((message) => fieldAt(message, "intentId")),
      "The one message is the first intent, not the later one",
    ).toEqual([firstIntent]);
  });

  test("a notice is repeatable inside its 24-hour usefulness window and cannot be revived at the boundary", async ({ page }) => {
    // At the seed instant the seeded notice is already past its window, so every recorded row states why it
    // may not be submitted again.
    const stale = await readSendResult(page, SEEDED_NOTICE.intentId);
    expect(fieldAt(stale, "data", "usefulness", "state"), "The seeded notice is past its window at the seed instant").toBe("past-usefulness");
    expect(
      arrayAt(stale, ["data", "rows"], "The seeded notice's rows").every((row) => fieldAt(row, "retry", "available") === false),
      "No row is repeatable past the window",
    ).toBe(true);

    // One second before the window closes: inside it, because the boundary is strict at equality, and the
    // one definite failure the seed recorded is the only row a repeat is permitted for.
    await setClock(page, SEEDED_NOTICE.lastUsefulSecond);
    const open = await readSendResult(page, SEEDED_NOTICE.intentId);
    expect(fieldAt(open, "data", "usefulness", "state"), "One second before the deadline is still inside the window").toBe("within-usefulness");
    expect(stringAt(open, ["data", "usefulness", "deadline"], "The notice's usefulness deadline"), `The deadline is the intended instant plus ${String(NOTIFICATION_USEFULNESS_HOURS)} elapsed hours`).toBe(SEEDED_NOTICE.deadline);
    const openRows = arrayAt(open, ["data", "rows"], "The seeded notice's rows inside the window");
    expect(
      openRows.filter((row) => fieldAt(row, "retry", "available") === true),
      "Only the definite failure may be repeated",
    ).toHaveLength(1);
    expect(
      openRows.filter((row) => fieldAt(row, "state") === "failed").every((row) => fieldAt(row, "retry", "available") === true),
      "The repeatable row is the failed one",
    ).toBe(true);
    await openDelivery(page, SEEDED_NOTICE.intentId);
    await expect(page.getByText("Within its usefulness window").first()).toBeVisible();
    const rows = page.getByRole("row");
    await expect(rows.filter({ hasText: "Repeat permitted" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Repeat not permitted" })).toHaveCount(3);
    await expect(page.getByText(SIMULATED_MAIL).first()).toBeVisible();
    await expect(page.getByRole("button", { name: RESEND_CONTROL }), "The window permits a repeat; it never offers one here").toHaveCount(0);
    // Inside the window the notice's own rule answers — not the window — which is what makes the closure below
    // a boundary rather than a change in the notice.
    const inside = await submitNotice(page, { releaseId: SEEDED_NOTICE.releaseId, intendedAt: SEEDED_NOTICE.intendedAt });
    expect(outcomeOf(inside.body), "The same notice inside its usefulness window").toBe("unchanged");

    // At the deadline exactly: closed. Every row is unrepeatable and the failed row states why.
    await setClock(page, SEEDED_NOTICE.deadline);
    const closed = await readSendResult(page, SEEDED_NOTICE.intentId);
    expect(fieldAt(closed, "data", "usefulness", "state"), "At the deadline the window is closed").toBe("past-usefulness");
    const closedRows = arrayAt(closed, ["data", "rows"], "The seeded notice's rows at the deadline");
    expect(
      closedRows.every((row) => fieldAt(row, "retry", "available") === false),
      "No row may be submitted again at the boundary",
    ).toBe(true);
    expect(
      closedRows
        .filter((row) => fieldAt(row, "state") === "failed")
        .map((row) => fieldAt(row, "retry", "reason"))
        .join(" "),
      "The failed row states that its window closed",
    ).toMatch(/usefulness window has closed/u);
    await openDelivery(page, SEEDED_NOTICE.intentId);
    await expect(page.getByText("Past its usefulness window").first()).toBeVisible();
    await expect(page.getByText(/24-hour usefulness window has closed, so it cannot be revived as a fresh attempt/u)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Repeat permitted" })).toHaveCount(0);

    // A fresh attempt carrying the notice's own intended instant is rejected by the window, and a new intent
    // cannot revive it: nothing a caller can press turns the refusal into a second send.
    const fingerprintBefore = sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId));
    const refused = await submitNotice(page, { releaseId: SEEDED_NOTICE.releaseId, intendedAt: SEEDED_NOTICE.intendedAt });
    expect(outcomeOf(refused.body), "A fresh attempt at exactly 24 elapsed hours").toBe("invalid");
    const windowRefusal = messagesAt(refused.body, "intendedAt");
    expect(windowRefusal, "The refusal is the usefulness window's, not the dedupe rule's").toMatch(/past the 24 hours it stays useful for/u);
    expect(windowRefusal, "A new intent cannot revive a notice past its window").toMatch(/a new intent cannot revive it/u);
    expect(refused.operationId, "The refusal names the attempt it refused").toBe(stringAt(refused.body, ["operationId"], "The refused attempt's identity"));
    // Nothing was recorded: the rows, their dedupe keys and the message count are exactly what they were.
    expect(sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)), "A refused attempt records no new row and no new dedupe key").toBe(fingerprintBefore);
    expect(numberOf(await readInbox(page), ["data", "intentCount"], "Messages in the acting person's inbox"), "A refused attempt produces no message").toBe(0);

    await restoreSeedInstant(page);
  });
});
