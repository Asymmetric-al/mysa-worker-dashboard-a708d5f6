/** Criterion 10 — consent and notification. */ import type { Page } from "@playwright/test";
import { arrayAt, devStateOf, expect, sendResultFingerprint, fieldAt, jsonOf, messagesAt, newAttemptId, numberAt, outcomeOf, setClock, stringAt, test, type DevStateEnvelope } from "../playwright.config";
const SEED_INSTANT = "2026-11-20T00:00:00Z";
const UPDATE_DOCUMENT = "doc-update-autumn";
const CONFIRMATION_WINDOW_HOURS = 168;
const NOTIFICATION_USEFULNESS_HOURS = 24;
const SEEDED_WINDOW = { acceptedAt: "2026-11-16T12:00:00Z", deadline: "2026-11-23T12:00:00Z", lastConfirmableSecond: "2026-11-23T11:59:59Z" } as const;
const SIGNUP_WINDOW = { acceptedAt: SEED_INSTANT, deadline: "2026-11-27T00:00:00Z", lastConfirmableSecond: "2026-11-26T23:59:59Z" } as const;
const SEEDED_NOTICE = { intentId: "intent-update-autumn-en", releaseId: "release-update-en-1", intendedAt: "2026-11-10T09:05:00Z", deadline: "2026-11-11T09:05:00Z", lastUsefulSecond: "2026-11-11T09:04:59Z" } as const; // The seeded notice: the edition it was submitted for, the instant it was meant for and the instant it stops being useful.
const SEEDED_MEMBERSHIPS = { awaitingProof: "membership-awaiting-proof", off: "membership-unsubscribed", restricted: "membership-restricted" } as const; // The seeded membership states this file counts, so an excluded membership can be shown as excluded rather than missing.
const SEEDED_AUDIENCE_COUNTS = { eligible: 5, excluded: 5 } as const;
const SEEDED_MEMBER_STATES = { active: 5, "awaiting-proof": 2, off: 2, restricted: 1 } as const;
const EDITION = { publicFrench: { variantId: "variant-update-autumn-fr-public", audience: "Public", locale: "Français" }, approvedSupporter: { variantId: "variant-update-autumn-en-approved-supporter", audience: "Approved supporters", locale: "English" } } as const; // The editions a fresh notice is driven through, each with the words its own release control carries: the composed path releases the edition again, so the release a notice names is the one that release produced rather than the seeded head.
const UNRELEASED_VARIANT = "variant-update-autumn-ar-public";
const OWN_MEMBERSHIP = "principal-established-worker";
const SIMULATED_MAIL = "simulated — no mail leaves this application"; // The one sentence every simulated mail boundary states, in the specification's own words (AAP 0.7.2).
const RESEND_CONTROL = /resend|send again|send it again|send a new one|new send/iu;
const PREFERENCES_PATH = "/preview/preferences";
const CONFIRM_API = "/api/confirm";
const NOTIFY_API = "/api/notify";
const UPDATES_API = "/api/updates";
const editorPathOf = (variantId: string): string => `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}/${encodeURIComponent(variantId)}`; // Where one edition's editor is composed, where its frozen candidate is answered, and the Update's own release review.
const reviewPathOf = (variantId: string): string => `/communication/review/${encodeURIComponent(variantId)}`;
const RELEASE_PATH = `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}`;
const AUTOSAVE = '[data-slot="autosave-status"]'; // The status line the editor's autosave keeps, whose own state word is what a save is judged by, and the receipt the release review renders once it has an answer.
const PROOF_FLOW = '[data-slot="proof-flow"]'; // The proof surface's own slot, so every assertion inside the flow is scoped to the flow rather than the page.
const controlAuthority = (page: Page): Promise<DevStateEnvelope> => devStateOf(page.request);
const readPreferences = async (page: Page): Promise<unknown> => jsonOf(await page.request.get("/api/preferences"), "GET /api/preferences");
const readAudience = async (page: Page): Promise<unknown> => jsonOf(await page.request.get("/api/audience"), "GET /api/audience");
const readInbox = async (page: Page): Promise<unknown> => jsonOf(await page.request.get("/api/inbox"), "GET /api/inbox");
const readSendResult = async (page: Page, intentId: string): Promise<unknown> => jsonOf(await page.request.get(`${NOTIFY_API}?intentId=${encodeURIComponent(intentId)}`), `GET ${NOTIFY_API}`);
const readSupport = async (page: Page): Promise<unknown> => jsonOf(await page.request.get("/api/support"), "GET /api/support"); // The publisher's support read, which no consent change may touch: the comparator for "no financial fact changed".
const readReviewOffer = async (page: Page, variantId: string): Promise<unknown> => jsonOf(await page.request.get(`/api/review?variantId=${encodeURIComponent(variantId)}`), "GET /api/review");
async function readDocumentRevision(page: Page): Promise<string> {
  const body = await jsonOf(await page.request.get(`${UPDATES_API}?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`), `GET ${UPDATES_API}`); // The Update document's own revision, which a content mutation presents as the revision it read.
  return stringAt(body, ["revision"], "The Update document's revision");
}
function actionOf(body: unknown, name: string): { readonly available: boolean; readonly reason: string } {
  const action = arrayAt(body, ["actions"], "The read's advisory actions").find((candidate) => fieldAt(candidate, "name") === name); // One release action's availability and the reason the service states for it, by name.
  if (action === undefined) throw new Error(`The read states no action named ${JSON.stringify(name)}: ${JSON.stringify(fieldAt(body, "actions")).slice(0, 400)}`);
  return { available: fieldAt(action, "available") === true, reason: typeof fieldAt(action, "reason") === "string" ? (fieldAt(action, "reason") as string) : "" };
}
async function requestNoticesThroughProof(page: Page): Promise<void> {
  await openPreferences(page); // Opens the acting person's own purpose-specific membership through the proof flow the preferences route composes, which leaves it awaiting proof.
  const proof = page.locator(PROOF_FLOW);
  await expect(proof.getByRole("heading", { level: 2, name: "Confirm this address for notices" })).toBeVisible();
  await proof.getByRole("textbox", { name: /Email address/u }).fill("established.worker@example.org");
  await proof.getByRole("button", { name: "Request notices from this publisher", exact: true }).click();
  await expect(proof.getByRole("button", { name: /Confirm this address/u }), "The request is recorded, so the confirmation control appears in place").toBeVisible(); // The request is recorded once the page has re-read the membership it opened: the confirmation control appears in place, so the membership is keyed by the acting principal rather than by a value this file minted.
  const opened = await readPreferences(page);
  expect(fieldAt(opened, "data", "state"), "A request opens the proof step and nothing more").toBe("awaiting-proof");
}
async function confirmThroughProof(page: Page): Promise<void> {
  const proof = page.locator(PROOF_FLOW); // Confirms the address the proof flow holds, inside the window its own acceptance recorded.
  await proof.getByRole("button", { name: /Confirm this address/u }).click();
  await expect(proof.getByText("Saved", { exact: true }), "The receipt is the durable record of the act, and it stays on the surface the act was made from").toBeVisible();
  const confirmed = await readPreferences(page);
  expect(fieldAt(confirmed, "data", "state"), "The person's own act makes the membership active").toBe("active");
}
async function submitNotice(page: Page, input: { readonly releaseId?: string; readonly variantId?: string; readonly intendedAt?: string }): Promise<{ readonly operationId: string; readonly body: unknown }> {
  const authority = await controlAuthority(page); // Submits one notice at the transport its handler answers, for the two answers a composed control cannot produce: an edition that publishes no release, and an intent past its 24 useful hours.
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
async function submitConfirmation(page: Page, membershipId: string): Promise<unknown> {
  const authority = await controlAuthority(page); // Submits one confirmation of one membership, presenting the revision the preferences read states.
  return jsonOf(await page.request.post(CONFIRM_API, { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: stringAt(await readPreferences(page), ["revision"], "The preferences read's revision"), payload: { membershipId } } }), `POST ${CONFIRM_API}`);
}
async function releaseAndNotify(page: Page, edition: (typeof EDITION)[keyof typeof EDITION]): Promise<{ readonly intentId: string }> {
  await page.goto(editorPathOf(edition.variantId)); // Drives one fresh notice through the composed controls, in the order a person meets them, and answers with the notice the receipt names.
  const editor = page.locator('[data-slot="editor-shell"]');
  await expect(editor).toBeVisible();
  await page.getByRole("textbox", { name: "The text of this Update edition", exact: true }).click();
  await page.keyboard.type("Autumn at Harbour Youth: a note from this edition, written for the one review step.");
  await expect(page.locator(AUTOSAVE)).toHaveAttribute("data-autosave-state", "saved");
  const submitStep = editor.locator('[data-slot="action-review"]'); // The author's choice is recorded with the submission, and the reviewer cannot change it afterwards. It has to reach the step's own state and not only the radio's DOM, so the click is read back from the mode group and made again while that group still states the other mode.
  await expect(submitStep).toContainText("Submit this edition for review");
  const modeGroup = submitStep.locator('[data-slot="submission-release-mode"]');
  await expect(modeGroup).toBeVisible();
  await expect(async () => {
    await submitStep.getByRole("radio", { name: "Publish and notify now", exact: true }).click();
    await expect(modeGroup).toHaveAttribute("data-mode", "publish-and-notify", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await submitStep.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(submitStep.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await page.goto(reviewPathOf(edition.variantId)); // One review step, given once: the candidate is approved for this audience and this language and nothing else, and the reviewer reads the mode the submission recorded.
  await expect(page.getByRole("heading", { name: "Review this Update", level: 1 })).toBeVisible();
  await expect(page.locator('[data-slot="review-publish-intent"]')).toHaveAttribute("data-notify-requested", "true");
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-recorded-decision"]'), "The decision is awaited where the panel records it, so the release below reads a candidate that is already approved rather than one it ran ahead of").toHaveAttribute("data-decision", "approved");
  await page.goto(RELEASE_PATH); // The release review publishes the edition and, because its submission asked for one, submits the notice.
  await expect(page.getByRole("heading", { level: 2, name: "Release the selected editions" })).toBeVisible();
  await page.getByRole("checkbox", { name: `Release ${edition.audience} — ${edition.locale}`, exact: true }).click();
  await page.getByRole("button", { name: "Release these editions", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Release these editions", exact: true }).click();
  const receipt = page.locator('[data-slot="publish-review-result"]');
  await expect(receipt).toHaveAttribute("data-outcome", "accepted");
  await expect(receipt, "The recorded mode asked for a notice, so the release submitted one").toContainText("Notice for this edition:");
  const noticeResults = receipt.getByRole("link", { name: "Open the recorded results for this notice", exact: true });
  await expect(noticeResults, "The receipt links to the results of the notice it submitted; The receipt names the notice it submitted and links to that notice's own results, so the identity is the link's own `intentId` rather than one read off the transport or off a message").toBeVisible();
  const intentId = new URL((await noticeResults.getAttribute("href")) ?? "", "http://127.0.0.1").searchParams.get("intentId") ?? "";
  expect(intentId, "The link names the notice the release submitted").toMatch(/^intent-/u);
  return { intentId };
}
async function openPreferences(page: Page): Promise<void> {
  await page.goto(PREFERENCES_PATH); // Opens the reader's own preference-and-consent surface, and waits for the page's own heading.
  await expect(page.getByRole("heading", { level: 1, name: "Your preferences" })).toBeVisible();
}
async function openInbox(page: Page): Promise<void> {
  await page.goto("/communication/inbox"); // Opens the synthetic inbox and waits for the surface itself rather than for a spinner.
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic inbox" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Messages produced for this membership" })).toBeVisible();
}
async function openDelivery(page: Page, intentId: string): Promise<void> {
  await page.goto(deliveryPathOf(intentId)); // Opens one intent's delivery results, which is where a recorded outcome and its window are read.
  await expect(page.getByRole("heading", { level: 1, name: "Delivery" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Delivery results" })).toBeVisible();
}
async function openAudience(page: Page): Promise<void> {
  await page.goto("/communication/audience"); // Opens the publisher's audience, which states each membership's state and why it is excluded.
  await expect(page.getByRole("heading", { level: 1, name: "Update email audience" })).toBeVisible();
}
const deliveryPathOf = (intentId: string): string => `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
test.describe("a reader's own proof flow", () => {
  test.use({ persona: "subscriber" }); // The seeded subscriber holds one membership awaiting proof, keyed by its own principal, so the proof surface below is the one a reader sees: no membership has to be created for the flow to be walked.
  test("an address is confirmed only by the person's own act, never by rendering or reloading the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Development data", { exact: true }).first()).toBeVisible();
    await openPreferences(page);
    const proof = page.locator(PROOF_FLOW);
    await expect(proof).toBeVisible();
    await expect(proof.getByRole("heading", { level: 2, name: "Confirm this address for notices" })).toBeVisible();
    await expect(proof.getByText("Awaiting proof", { exact: true })).toBeVisible();
    await expect(proof.getByText("This address is still waiting for confirmation", { exact: true }), "The pending result is neutral: it says the address is waiting, that rendering the page is not a confirmation, and that the notice is simulated — which is where the confirmation message is rendered").toBeVisible();
    await expect(proof.getByText(/Opening this page, reloading it or previewing a link here is never a confirmation/u)).toBeVisible();
    await expect(proof.getByText(/Notice sending is simulated — no mail leaves this application/u)).toBeVisible();
    await expect(proof.getByText(new RegExp(`${String(CONFIRMATION_WINDOW_HOURS)} elapsed hours`, "u")), "The window is stated in elapsed hours and carries the deadline the acceptance fixed, not a date range").toBeVisible();
    await expect(proof.getByText(/This address can be confirmed until/u)).toBeVisible();
    await expect(proof.getByText(SEEDED_WINDOW.deadline, { exact: true })).toBeVisible();
    await expect(proof.getByText(/calendar day/u)).toHaveCount(0);
    const pending = await readPreferences(page);
    expect(fieldAt(pending, "data", "state"), "A signup leaves the membership awaiting proof; The read behind the surface: awaiting proof, no claim that a message was sent, the window open, and a state that is not the word a subscribed-style flag would carry").toBe("awaiting-proof");
    expect(fieldAt(pending, "data", "membershipId"), "The membership the read addresses").toBe("principal-subscriber");
    expect(fieldAt(pending, "data", "pending", "claimsMailSent"), "The pending result claims no message was sent").toBe(false);
    expect(fieldAt(pending, "data", "pending", "nextStep"), "The pending result's own next step").toBe("confirm-from-the-rendered-message");
    expect(fieldAt(pending, "data", "confirmation", "state"), "The confirmation window at the seed instant").toBe("open");
    expect(stringAt(pending, ["data", "confirmation", "deadline"], "The confirmation window's deadline"), "The window closes 168 elapsed hours after the acceptance").toBe(SEEDED_WINDOW.deadline);
    expect(stringAt(pending, ["data", "acceptedOn"], "The acceptance the window runs from"), "The acceptance the seed recorded").toBe(SEEDED_WINDOW.acceptedAt);
    const landed = new URL(page.url());
    expect(landed.search, "The confirmation message carries no token a page load could use; The message a reader follows carries no token, and neither does the address it lands on: the confirmation is identified by the membership and the person's own act alone").toBe("");
    expect(landed.pathname, "The message lands on the preferences surface itself").toBe(PREFERENCES_PATH);
    await expect(proof.getByText("Address on this membership", { exact: true })).toBeVisible();
    // The message the pending result points at is rendered here, in every fact a message carries: who it is from, which address it is for, what it is called and what it says. The envelope states the same message, so the wording a reader confirms from is the record's own rather than text this surface composed.
    const table = proof.locator('[data-slot="confirmation-message"]');
    await expect(table, "The confirmation message is rendered on the page the recipient is told to confirm from").toBeVisible();
    for (const label of ["From", "To", "Subject"] as const) await expect(table.getByText(label, { exact: true })).toBeVisible();
    expect(stringAt(pending, ["data", "confirmationMessage", "sender", "address"], "The sender the message is rendered from"), "The one sender this application states for its notices").toMatch(/@example\.invalid$/u);
    expect(stringAt(pending, ["data", "confirmationMessage", "to"], "The address the message is for"), "The address the membership records").toBe("subscriber@example.org");
    expect(stringAt(pending, ["data", "confirmationMessage", "subject"], "The subject the message carries"), "The subject names the membership's own publisher and purpose").toMatch(/Update notices$/u);
    await expect(table.getByText(/This is the confirmation message for your Update-email membership/u), "The message's own wording is rendered, not a sentence about one").toBeVisible();
    await expect(table.getByText(/Confirm this address control/u), "The message names the confirm target: the control on this page, and no link").toBeVisible();
    await expect(table.getByText(/never extends that window/u), "The message carries the 168-hour window's own rule").toBeVisible();
    expect(table.locator("a"), "The message carries nothing to follow: there is no token link a page load or a scanner could confirm from").toHaveCount(0);
    await expect(proof.locator('input[type="password"], input[autocomplete="off"], textarea[onpaste], input[onpaste]'), "No field in the proof flow blocks a paste or asks for a secret").toHaveCount(0);
    expect((await page.request.get(CONFIRM_API)).status(), "A GET to the confirmation transport is not admitted; A GET cannot confirm or unsubscribe: both transports export POST only, which is what makes a link preview, a scanner and a page load harmless").toBe(405);
    expect((await page.request.get(CONFIRM_API)).status(), "A GET to the confirmation transport is not admitted").toBe(405);
    expect((await page.request.get("/api/unsubscribe")).status(), "A GET to the unsubscribe transport is not admitted").toBe(405);
    await page.reload();
    await expect(proof.getByText("This address is still waiting for confirmation", { exact: true })).toBeVisible();
    const afterReload = await readPreferences(page);
    expect(fieldAt(afterReload, "data", "state"), "Reloading the page converts nothing").toBe("awaiting-proof");
    expect(stringAt(afterReload, ["data", "confirmation", "deadline"], "The window after a reload"), "A page load neither extends nor consumes the window").toBe(SEEDED_WINDOW.deadline);
    // An address already waiting for proof can ask for its message again. The answer is `unchanged`: the request the acceptance was made for is the same one, so nothing is created and the window the acceptance fixed cannot move — which is what makes "asking again never extends it" a fact rather than a promise.
    const askAgain = proof.getByRole("button", { name: "Send the message again", exact: true });
    await expect(askAgain, "A membership already awaiting proof is offered the message it is waiting to confirm").toBeEnabled();
    await askAgain.click();
    await expect(proof.locator('[data-slot="operation-result"]').first(), "The answer stays on the surface the request was made from").toHaveAttribute("data-outcome", "unchanged");
    const afterAskingAgain = await readPreferences(page);
    expect([fieldAt(afterAskingAgain, "data", "state"), stringAt(afterAskingAgain, ["data", "confirmation", "deadline"], "The window after asking for the message again")], "Asking again creates no second membership and never extends the acceptance's window").toEqual(["awaiting-proof", SEEDED_WINDOW.deadline]);
    const confirmControl = proof.getByRole("button", { name: /Confirm this address/u });
    await expect(confirmControl, "The control is offered inside the open window; The person's own act, and the only one: the Confirm control").toBeEnabled();
    await confirmControl.click();
    await expect(proof.getByText("Saved", { exact: true }), "The receipt is the durable record of the act, and it stays on the surface rather than passing as a toast").toBeVisible();
    await expect(proof.getByText(/The change was applied once, and it stays on this page as the record of it/u)).toBeVisible();
    const confirmed = await readPreferences(page);
    expect(fieldAt(confirmed, "data", "state"), "The person's own act makes the membership active").toBe("active");
    expect(fieldAt(confirmed, "data", "confirmation", "state"), "Nothing is waiting for confirmation once it is confirmed").toBe("not-awaiting-proof");
    await page.reload();
    await expect(proof.getByText("This address is confirmed", { exact: true })).toBeVisible();
    await expect(proof.getByText("Active", { exact: true })).toBeVisible();
    await expect(proof.getByText(/is not a delivery/u)).toBeVisible();
    await expect(proof.getByText("Address on this membership", { exact: true }), "The address is read back from the record rather than retyped, which is the flow's own answer to Redundant Entry: nothing here asks the person for a value they have already given").toBeVisible();
  });
});
test.describe("the worker who publishes, holds the audience and can be a recipient", () => {
  test.use({ persona: "established-worker" });
  test("a confirmation one second inside the 168-elapsed-hour window is accepted", async ({ page }) => {
    await requestNoticesThroughProof(page);
    const opened = await readPreferences(page);
    expect(fieldAt(opened, "data", "membershipId"), "The membership is keyed by the principal that opened it").toBe(OWN_MEMBERSHIP);
    expect(fieldAt(opened, "data", "state"), "A signup opens the proof step and nothing more").toBe("awaiting-proof");
    expect(stringAt(opened, ["data", "acceptedOn"], "The acceptance a signup recorded"), "The acceptance is the scenario instant").toBe(SIGNUP_WINDOW.acceptedAt);
    expect(stringAt(opened, ["data", "confirmation", "deadline"], "The deadline a signup recorded"), "The window closes 168 elapsed hours after the acceptance").toBe(SIGNUP_WINDOW.deadline);
    await setClock(page.request, SIGNUP_WINDOW.lastConfirmableSecond);
    await openPreferences(page);
    const proof = page.locator(PROOF_FLOW);
    await expect(proof.getByText(SIGNUP_WINDOW.deadline, { exact: true })).toBeVisible();
    expect(fieldAt(await readPreferences(page), "data", "confirmation", "state"), "One second before the deadline is still inside the window").toBe("open");
    const confirmControl = proof.getByRole("button", { name: /Confirm this address/u });
    await expect(confirmControl, "The control is offered inside the open window").toBeEnabled();
    await confirmControl.click();
    await expect(proof.getByText("Saved", { exact: true })).toBeVisible();
    const confirmed = await readPreferences(page);
    expect(fieldAt(confirmed, "data", "state"), "The confirmation inside the window is applied").toBe("active");
    await page.reload();
    await expect(proof.getByText("This address is confirmed", { exact: true })).toBeVisible();
    await setClock(page.request, SEED_INSTANT);
  });
  test("a confirmation at exactly 168 elapsed hours is refused, and nothing revives the window", async ({ page }) => {
    await requestNoticesThroughProof(page);
    const opened = await readPreferences(page);
    const membershipId = stringAt(opened, ["data", "membershipId"], "The membership the signup opened");
    const recordedDeadline = stringAt(opened, ["data", "confirmation", "deadline"], "The deadline a signup recorded");
    expect(recordedDeadline).toBe(SIGNUP_WINDOW.deadline);
    await setClock(page.request, SIGNUP_WINDOW.deadline);
    await openPreferences(page);
    const proof = page.locator(PROOF_FLOW);
    await expect(proof.getByText(/The confirmation window closed at/u)).toBeVisible();
    await expect(proof.getByText(SIGNUP_WINDOW.deadline, { exact: true })).toBeVisible();
    await expect(proof.getByText(/The service reports this window as closed/u)).toBeVisible();
    await expect(proof.getByRole("button", { name: /Confirm this address/u }), "The control stays where it is and is disabled, so a closed window is never mistaken for a missing action").toBeDisabled();
    await expect(proof.getByText(new RegExp(`${String(CONFIRMATION_WINDOW_HOURS)} elapsed hours`, "u")), "The wording is elapsed hours, and it states that reloading, retrying or resending never extends it").toBeVisible();
    await expect(proof.getByText(/never extends it/u)).toBeVisible();
    await expect(proof.getByText(/calendar day/u)).toHaveCount(0);
    const closedWindow = await readPreferences(page);
    expect(fieldAt(closedWindow, "data", "confirmation", "state"), "At the deadline the window is expired").toBe("expired");
    expect(fieldAt(closedWindow, "data", "state"), "An expired window leaves the membership awaiting proof").toBe("awaiting-proof");
    const refused = await submitConfirmation(page, membershipId);
    expect(outcomeOf(refused), "A confirmation at exactly the deadline; The transport refuses the same confirmation at that instant, with the reason the boundary gives").toBe("invalid");
    const refusal = messagesAt(refused, "membershipId").join(" ");
    expect(refusal, "The refusal names the expired confirmation").toMatch(/confirmation-expired/u);
    expect(refusal, "The refusal states the instant the window ended").toContain(SIGNUP_WINDOW.deadline);
    expect(refusal, "The refusal states that a reload, a retry and a resend never extend the window").toMatch(/reload, a retry and a message sent again never extend it/u);
    await page.reload();
    await expect(proof.getByRole("button", { name: /Confirm this address/u })).toBeDisabled();
    const retried = await submitConfirmation(page, membershipId);
    expect(outcomeOf(retried), "A retry at the same instant is refused in the same terms").toBe("invalid");
    expect(messagesAt(retried, "membershipId").join(" ")).toMatch(/confirmation-expired/u);
    const afterRetries = await readPreferences(page);
    expect(stringAt(afterRetries, ["data", "confirmation", "deadline"], "The deadline after two refusals"), "Nothing a person can press extends the window").toBe(recordedDeadline);
    expect(fieldAt(afterRetries, "data", "state"), "A refused confirmation changes nothing").toBe("awaiting-proof");
    for (const role of ["button", "link"] as const) await expect(page.getByRole(role, { name: RESEND_CONTROL }), "Nothing may send the confirmation again as a fresh window").toHaveCount(0);
    await setClock(page.request, SEED_INSTANT);
  });
  test("a publication notifies only the eligible subscribers, and the message claims neither delivery nor reading", async ({ page }) => {
    const offer = await readReviewOffer(page, UNRELEASED_VARIANT);
    const publishOnly = actionOf(offer, "publish-only");
    const notifyNow = actionOf(offer, "publish-and-notify-now");
    expect(publishOnly.available, "This edition is still awaiting its one review; Publish only is not Notify now: the review read states that a reviewer cannot release an edition with a mode its submission did not ask for, so the one cannot silently become the other").toBe(false);
    expect(publishOnly.reason).toMatch(/awaiting its one review/u);
    expect(notifyNow.available, "A reviewer cannot turn a publish-only submission into a notice").toBe(false);
    expect(notifyNow.reason).toMatch(/with a mode the submission did not ask for/u);
    const early = await submitNotice(page, { variantId: UNRELEASED_VARIANT, intendedAt: SEED_INSTANT });
    expect(outcomeOf(early.body), "A notice for an edition that publishes no release; Publication and notification are separate acts: an edition that publishes no release has nothing to notify anyone about, so a notice cannot stand in for a publication that has not happened").toBe("invalid");
    expect(messagesAt(early.body, "releaseId").join(" "), "The refusal states that nothing is published to notify").toMatch(/publishes no release yet/u);
    await requestNoticesThroughProof(page);
    await confirmThroughProof(page);
    const audience = await readAudience(page);
    expect(fieldAt(audience, "data", "counts", "eligible"), "The seeded actives plus the membership just confirmed").toBe(SEEDED_AUDIENCE_COUNTS.eligible + 1);
    expect(fieldAt(audience, "data", "counts", "excluded"), "Two addresses awaiting proof, two Off choices and one restriction").toBe(SEEDED_AUDIENCE_COUNTS.excluded);
    expect(fieldAt(audience, "data", "memberStates"), "The four states stay four").toEqual({ ...SEEDED_MEMBER_STATES, active: SEEDED_MEMBER_STATES.active + 1 });
    const intentId = (await releaseAndNotify(page, EDITION.publicFrench)).intentId;
    const result = await readSendResult(page, intentId);
    expect(numberAt(result, ["data", "ceilingCount"], "The ceiling the accepted notice may not exceed"), "The ceiling is the eligible count it was acknowledged at").toBe(numberAt(audience, ["data", "counts", "eligible"], "The audience's eligible count"));
    expect(fieldAt(result, "data", "usefulness", "state"), "A notice submitted for the scenario instant is still useful").toBe("within-usefulness");
    expect(stringAt(result, ["data", "usefulness", "deadline"], "The notice's usefulness deadline"), `Usefulness runs ${String(NOTIFICATION_USEFULNESS_HOURS)} elapsed hours from the instant it was intended for`).toBe("2026-11-21T00:00:00Z");
    const rows = arrayAt(result, ["data", "rows"], "The intent's per-recipient rows");
    const own = rows.filter((row) => fieldAt(row, "recipientId") === OWN_MEMBERSHIP);
    expect(own, "One row per recipient, so the acting person's own membership appears once").toHaveLength(1);
    const ownRendition = stringAt(own[0], ["renditionId"], "The rendition the acting person was pinned to");
    const statedRecipients = [...rows, ...arrayAt(result, ["data", "unserved"], "The recipients this intent did not serve")].map((row) => fieldAt(row, "recipientId")); // Only eligible memberships are counted: an address awaiting proof, an Off membership and a restricted one appear neither as served nor as unserved, because they were never candidates.
    for (const excluded of Object.values(SEEDED_MEMBERSHIPS)) expect(statedRecipients, `The excluded membership ${excluded} is not a recipient of this notice`).not.toContain(excluded);
    const unservedAlreadyCovered = arrayAt(result, ["data", "unserved"], "The recipients this intent did not serve").every((row) => fieldAt(row, "reason") === "already-covered");
    expect(unservedAlreadyCovered, "Every eligible recipient it did not serve was already covered by an earlier notice").toBe(true);
    const everyServedRowAccepted = arrayAt(result, ["data", "rows"], "The intent's rows").every((row) => fieldAt(row, "state") === "accepted");
    expect(everyServedRowAccepted, "An accepted notice is accepted for every recipient it served").toBe(true);
    await openDelivery(page, intentId); // The durable surface: the trigger's own result states the simulated boundary, the window it stands in, each recorded outcome, and that acceptance is neither delivery nor reading.
    for (const said of [SIMULATED_MAIL, "Within its usefulness window", "Outcomes recorded for this notice"]) await expect(page.getByText(said).first()).toBeVisible();
    await expect(page.getByText("Accepted — not delivered", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/It is not delivery and it is not reading/u).first()).toBeVisible();
    await expect(page.getByRole("button", { name: RESEND_CONTROL }), "An accepted copy is never submitted again").toHaveCount(0);
    await expect(page.locator("[data-sonner-toast], [data-toast], [role='log']"), "No ephemeral notification may stand in for a durable result").toHaveCount(0);
    const inbox = await readInbox(page);
    expect(numberAt(inbox, ["data", "intentCount"], "Messages in the inbox after the send"), "One intent produced one message for this recipient").toBe(1);
    const messages = arrayAt(inbox, ["data", "messages"], "The inbox's messages");
    expect(messages, "One message per recipient and intent").toHaveLength(1);
    const message = messages[0];
    expect(fieldAt(message, "intentId"), "The message is the intent that was submitted").toBe(intentId);
    expect(fieldAt(message, "state"), "The message carries the outcome that was recorded").toBe("accepted");
    expect(stringAt(message, ["renditionId"], "The rendition the message was pinned to"), "The recipient is pinned to the one rendition the send result states").toBe(ownRendition);
    await openInbox(page);
    for (const said of ["One message has been produced for this membership.", SIMULATED_MAIL, /One notification intent produces one message for one recipient/u]) await expect(page.getByText(said).first()).toBeVisible();
    await expect(page.getByText("Two messages share one recipient and one notification intent"), "A second copy of one intent would be a defect stated here").toHaveCount(0);
    const sender = stringAt(message, ["sender"], "The message's sender");
    const subject = stringAt(message, ["subject"], "The message's subject");
    await expect(page.getByText(sender, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(subject, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Open the message/u }).click(); // Both renderings are real: the HTML tab renders the notice, and the plain-text tab renders the same message as a readable alternative in a pre-formatted block rather than as a note about one.
    await expect(page.getByRole("heading", { level: 3, name: "The message as it was produced for this recipient" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "HTML" })).toBeVisible();
    await expect(page.getByText("An update has been published.").first()).toBeVisible();
    await page.getByRole("tab", { name: "Plain text" }).click();
    const plainBody = page.locator("pre").filter({ hasText: "Open the update" });
    await expect(plainBody, "The plain-text tab renders the whole message, not a note about one").toBeVisible();
    await expect(plainBody).toContainText(/You are receiving updates by email because you asked to hear from this publisher/u);
    await expect(page.getByText(/It is not a delivered message and not a read one/u).first(), "The honesty note, and the absence of any claim the application cannot make").toBeVisible();
    for (const claim of [/^Delivered$/u, /^Opened$/u]) await expect(page.getByText(claim), "No surface claims a message was delivered or read").toHaveCount(0);
    await openAudience(page);
    for (const value of ["Active", "Awaiting proof", "Off", "Restricted"]) await expect(page.getByText(value, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/A subscribed-style flag, an imported row, a contact edit or an existing partner record is not consent/u)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Accepted — not delivered" }), "A membership is never reported as a send outcome").toHaveCount(0);
  });
  test("unsubscribing turns off one publisher and one purpose, and a later notice excludes that person", async ({ page }) => {
    await requestNoticesThroughProof(page);
    await confirmThroughProof(page);
    const languageBefore = fieldAt(await readPreferences(page), "data", "languagePreference");
    const supportBefore = await readSupport(page);
    const supportRevisionBefore = stringAt(supportBefore, ["revision"], "The support read's revision");
    const receivedBefore = fieldAt(supportBefore, "data", "report", "summary", "0", "received", "minorUnits");
    const firstIntent = (await releaseAndNotify(page, EDITION.publicFrench)).intentId;
    expect(numberAt(await readInbox(page), ["data", "intentCount"], "Messages in the inbox before unsubscribing")).toBe(1);
    await openPreferences(page);
    const unsubscribe = page.locator('[data-slot="unsubscribe-confirm"]');
    await expect(unsubscribe.getByRole("heading", { name: "Turn off notices from this publisher" })).toBeVisible();
    for (const said of [/This membership today:/u, /changes one membership/u]) await expect(unsubscribe.getByText(said)).toBeVisible();
    await unsubscribe.getByRole("button", { name: /Turn off Update email from/u }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("What turning this off cannot do", { exact: true }), "What the action cannot do is stated before it is confirmed: a submitted notice is not recalled").toBeVisible();
    for (const said of [/A notice that was already submitted cannot be recalled/u, /every other record about you stay as they are/iu]) await expect(dialog.getByText(said)).toBeVisible();
    await dialog.getByRole("button", { name: /Turn off Update email from/u }).click();
    await expect(page.locator('[data-slot="unsubscribe-confirm-result"]')).toBeVisible();
    await expect(unsubscribe.getByText("Saved", { exact: true })).toBeVisible();
    await expect(unsubscribe.getByText(/Only this membership changed/u).first()).toBeVisible();
    const after = await readPreferences(page);
    expect(fieldAt(after, "data", "state"), "The membership is off for this purpose").toBe("off");
    expect(fieldAt(after, "data", "choice"), "The choice the record now holds").toBe("off");
    expect(fieldAt(after, "data", "publisherId"), "The same publisher, and only it").toBe("publisher-harbour");
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
    const laterIntent = (await releaseAndNotify(page, EDITION.approvedSupporter)).intentId;
    expect(laterIntent, "Every notice is its own intent").not.toBe(firstIntent);
    const laterResult = await readSendResult(page, laterIntent);
    expect(numberAt(laterResult, ["data", "ceilingCount"], "The later notice's ceiling"), "The ceiling is the eligible count after the unsubscribe").toBe(SEEDED_AUDIENCE_COUNTS.eligible);
    const laterRecipients = [...arrayAt(laterResult, ["data", "rows"], "The later notice's rows"), ...arrayAt(laterResult, ["data", "unserved"], "The later notice's unserved recipients")].map((row) => fieldAt(row, "recipientId"));
    expect(laterRecipients, "The person who turned notices off is not a recipient of the later notice").not.toContain(OWN_MEMBERSHIP);
    const inboxAfter = await readInbox(page);
    expect(numberAt(inboxAfter, ["data", "intentCount"], "Messages in the inbox after the later notice"), "No second message appears for the person who turned them off").toBe(1);
    const messageIntents = arrayAt(inboxAfter, ["data", "messages"], "The inbox's messages").map((message) => fieldAt(message, "intentId"));
    expect(messageIntents, "The one message is the first intent, not the later one").toEqual([firstIntent]);
  });
  test("a notice is repeatable inside its 24-hour usefulness window and cannot be revived at the boundary", async ({ page }) => {
    const stale = await readSendResult(page, SEEDED_NOTICE.intentId);
    expect(fieldAt(stale, "data", "usefulness", "state"), "The seeded notice is past its window at the seed instant").toBe("past-usefulness");
    const noStaleRowRepeatable = arrayAt(stale, ["data", "rows"], "The seeded notice's rows").every((row) => fieldAt(row, "retry", "available") === false);
    expect(noStaleRowRepeatable, "No row is repeatable past the window").toBe(true);
    await setClock(page.request, SEEDED_NOTICE.lastUsefulSecond); // One second before the window closes: inside it, because the boundary is strict at equality, and the one definite failure the seed recorded is the only row a repeat is permitted for.
    const open = await readSendResult(page, SEEDED_NOTICE.intentId);
    expect(fieldAt(open, "data", "usefulness", "state"), "One second before the deadline is still inside the window").toBe("within-usefulness");
    expect(stringAt(open, ["data", "usefulness", "deadline"], "The notice's usefulness deadline"), `The deadline is the intended instant plus ${String(NOTIFICATION_USEFULNESS_HOURS)} elapsed hours`).toBe(SEEDED_NOTICE.deadline);
    const openRows = arrayAt(open, ["data", "rows"], "The seeded notice's rows inside the window");
    const repeatableRows = openRows.filter((row) => fieldAt(row, "retry", "available") === true);
    expect(repeatableRows, "Only the definite failure may be repeated").toHaveLength(1);
    const everyFailedRowRepeatable = openRows.filter((row) => fieldAt(row, "state") === "failed").every((row) => fieldAt(row, "retry", "available") === true);
    expect(everyFailedRowRepeatable, "The repeatable row is the failed one").toBe(true);
    await openDelivery(page, SEEDED_NOTICE.intentId);
    await expect(page.getByText("Within its usefulness window").first()).toBeVisible();
    const rows = page.getByRole("row");
    await expect(rows.filter({ hasText: "Repeat permitted" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Repeat not permitted" })).toHaveCount(4);
    await expect(page.getByText(SIMULATED_MAIL).first()).toBeVisible();
    const repeatControl = page.getByRole("button", { name: "Repeat the failed copies", exact: true }); // The window being open is what puts the repeat control on this surface: the read permits it, its own action names it, and the control submits the copies the service recorded as definite failures. It is never a resend under a new key.
    await expect(repeatControl, "Inside the window the read permits a repeat, so the surface offers one").toBeVisible();
    await expect(page.getByRole("button", { name: RESEND_CONTROL }), "The window permits a repeat; it never offers a resend").toHaveCount(0);
    const seededFingerprint = sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId));
    await repeatControl.click();
    await expect(page.locator('[data-slot="delivery-repeat-result"] [data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
    await expect(page.locator('[data-slot="delivery-repeat-result"]').getByRole("link", { name: "Open the repeated notice's results" })).toBeVisible();
    expect(sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)), "A repeat leaves the notice it repeated exactly as it was").toBe(seededFingerprint);
    await setClock(page.request, SEEDED_NOTICE.deadline);
    const closed = await readSendResult(page, SEEDED_NOTICE.intentId);
    expect(fieldAt(closed, "data", "usefulness", "state"), "At the deadline the window is closed").toBe("past-usefulness");
    const closedRows = arrayAt(closed, ["data", "rows"], "The seeded notice's rows at the deadline");
    const noClosedRowRepeatable = closedRows.every((row) => fieldAt(row, "retry", "available") === false);
    expect(noClosedRowRepeatable, "No row may be submitted again at the boundary").toBe(true);
    const failedReasons = closedRows
      .filter((row) => fieldAt(row, "state") === "failed")
      .map((row) => fieldAt(row, "retry", "reason"))
      .join(" ");
    expect(failedReasons, "The failed row states that its window closed").toMatch(/usefulness window has closed/u);
    await openDelivery(page, SEEDED_NOTICE.intentId);
    await expect(page.getByText("Past its usefulness window").first()).toBeVisible();
    await expect(page.getByText(/24-hour usefulness window has closed, so it cannot be revived as a fresh attempt/u)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Repeat permitted" })).toHaveCount(0);
    await expect(page.getByText(/No recorded row may be submitted again/u), "At the boundary the surface states the read's own reason for refusing a repeat and offers no control at all").toBeVisible();
    await expect(page.getByRole("button", { name: "Repeat the failed copies", exact: true }), "A closed window offers no repeat").toHaveCount(0);
    await expect(page.locator('[data-slot="delivery-repeat-result"]')).toHaveCount(0);
    const fingerprintBefore = sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId));
    const refused = await submitNotice(page, { releaseId: SEEDED_NOTICE.releaseId, intendedAt: SEEDED_NOTICE.intendedAt });
    expect(outcomeOf(refused.body), "A fresh attempt at exactly 24 elapsed hours; A fresh attempt carrying the notice's own intended instant is rejected by the window, and a new intent cannot revive it: nothing a caller can press turns the refusal into a second send").toBe("invalid");
    const windowRefusal = messagesAt(refused.body, "intendedAt").join(" ");
    expect(windowRefusal, "The refusal is the usefulness window's, not the dedupe rule's").toMatch(/past the 24 hours it stays useful for/u);
    expect(windowRefusal, "A new intent cannot revive a notice past its window").toMatch(/a new intent cannot revive it/u);
    expect(refused.operationId, "The refusal names the attempt it refused").toBe(stringAt(refused.body, ["operationId"], "The refused attempt's identity"));
    expect(sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)), "A refused attempt records no new row and no new dedupe key").toBe(fingerprintBefore);
    expect(numberAt(await readInbox(page), ["data", "intentCount"], "Messages in the acting person's inbox"), "A refused attempt produces no message").toBe(0);
    await setClock(page.request, SEED_INSTANT);
  });
});
