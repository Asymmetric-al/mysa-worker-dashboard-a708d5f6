/** Criterion 11 — delivery recovery. */ import type { Page } from "@playwright/test";
import { test, expect, arrayAt, sendResultFingerprint, armLostAcknowledgement, authorityOf, clearFailurePlan, fieldAt, jsonOf, messagesAt, newAttemptId, numberAt, outcomeOf, readJson, setClock, stringAt, type DevStateEnvelope } from "../playwright.config";
const UPDATE_DOCUMENT = "doc-update-autumn";
const SEEDED_NOTICE = { intentId: "intent-update-autumn-en", releaseId: "release-update-en-1", intendedAt: "2026-11-10T09:05:00Z", deadline: "2026-11-11T09:05:00Z" } as const;
const LAST_USEFUL_SECOND = "2026-11-11T09:04:59Z"; // One second before the seeded notice's window closes: still inside it, because the boundary is strict at equality.
const SEEDED_AUDIENCE_COUNTS = { eligible: 5, excluded: 5 } as const; // The seed's own audience figures, read from the publisher's rows on a freshly reset store: five active memberships are eligible, and five are excluded — two addresses awaiting proof, two Off choices and one restriction.
const SEEDED_MEMBER_STATES = { active: 5, "awaiting-proof": 2, off: 2, restricted: 1 } as const; // The same seeded rows counted by state, so the two statements about one audience sit together and the seed's figures stay the only place either comes from.
const INBOX_PATH = "/communication/inbox";
const PREFERENCES_PATH = "/preview/preferences"; // The preferences surface's proof flow, which is where a person opens and confirms their own membership, and the address they give for it — a value on the record and never a key.
const PROOF_FLOW = '[data-slot="proof-flow"]';
const NOTIFY_EDITION = { variantId: "variant-update-autumn-fr-public", audience: "Public", locale: "Français" } as const; // The edition a fresh notice is driven through, with the words its own release control carries: the composed release mints the identity, so this file never assumes it.
const editorPathOf = (variantId: string): string => `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}/${encodeURIComponent(variantId)}`;
const RELEASE_PATH = `/communication/${UPDATE_DOCUMENT}`;
const RELEASE_RESULT = '[data-slot="publish-review-result"]';
const SIMULATED_MAIL = "Simulated — no email leaves this workspace.";
const RESEND_CONTROL = /resend|send again|send it again|send a new one|new send/iu;
const deliveryPathOf = (intentId: string): string => `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
const readSendResult = (page: Page, intentId: string): Promise<unknown> => readJson(page.request, `/api/notify?intentId=${encodeURIComponent(intentId)}`);
const readPreferences = (page: Page): Promise<unknown> => readJson(page.request, "/api/preferences");
type NoticeSubmission = { readonly operationId: string; readonly body: unknown };
async function readUpdateAuthority(page: Page): Promise<DevStateEnvelope> {
  const body = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`), "GET /api/updates"); // Reads one Update's variant overview, which states the document's own revision and the scope it was read in.
  return authorityOf(body, "The Update read");
}
async function requestNoticesThroughProof(page: Page): Promise<void> {
  await page.goto(PREFERENCES_PATH); // Opens the acting person's own purpose-specific membership through the proof flow the preferences route composes, leaving it awaiting proof.
  await expect(page.getByRole("heading", { level: 1, name: "Reader preferences" })).toBeVisible();
  const proof = page.locator(PROOF_FLOW);
  await expect(proof.getByRole("heading", { level: 2, name: "Confirm your email address" })).toBeVisible();
  await proof.getByRole("textbox", { name: /Email address/u }).fill("established.worker@example.org");
  await proof.getByRole("button", { name: "Request update emails", exact: true }).click();
  await expect(proof.getByRole("button", { name: /Confirm email address/u }), "The request is recorded, so the confirmation control appears in place").toBeVisible();
  expect(fieldAt(await readPreferences(page), "data", "state"), "A request opens the proof step and nothing more").toBe("awaiting-proof");
}
async function confirmThroughProof(page: Page): Promise<void> {
  const proof = page.locator(PROOF_FLOW); // Confirms the address the proof flow holds, inside the window its own acceptance recorded.
  await proof.getByRole("button", { name: /Confirm email address/u }).click();
  await expect(proof.getByText("Saved", { exact: true })).toBeVisible();
  expect(fieldAt(await readPreferences(page), "data", "state"), "The person's own act makes the membership active").toBe("active");
}
async function submitNotice(page: Page, input: { readonly authority: DevStateEnvelope; readonly releaseId: string; readonly intendedAt?: string; readonly operationId?: string }): Promise<NoticeSubmission> {
  const operationId = input.operationId ?? newAttemptId(); // Submits one notice at the transport its handler answers, which is how the two answers no control can produce are probed: a fresh attempt at the same work, and a request whose intended instant is past the 24 useful hours.
  const answer = await page.request.post("/api/notify", { data: { operationId, scope: input.authority.scope, expectedRevision: input.authority.revision, payload: { documentId: UPDATE_DOCUMENT, releaseId: input.releaseId, ...(input.intendedAt === undefined ? {} : { intendedAt: input.intendedAt }) } } });
  return { operationId, body: await jsonOf(answer, "POST /api/notify") };
}
function onlyIntentIn(inbox: unknown): string {
  const messages = arrayAt(inbox, ["data", "messages"], "The inbox's messages"); // The one intent the acting person's own inbox holds, which is the notice a fresh send recorded for them.
  expect(messages, "One notice produced one message for this recipient").toHaveLength(1);
  return stringAt(messages[0], ["intentId"], "The intent the message belongs to");
}
async function releaseAndNotify(page: Page): Promise<void> {
  await page.goto(editorPathOf(NOTIFY_EDITION.variantId)); // Drives one fresh notice through the composed controls in the order a person meets them: the editor's saved draft, the author's publish-and-notify choice, the reviewer's one decision, and the release that publishes the edition and submits the notice.
  const editor = page.locator('[data-slot="editor-shell"]');
  await expect(editor).toBeVisible();
  await page.getByRole("textbox", { name: "The text of this Update edition", exact: true }).click();
  await page.keyboard.type("Autumn at Harbour Youth: a note from this edition, written for the one review step.");
  await expect(page.locator('[data-slot="autosave-status"]')).toHaveAttribute("data-autosave-state", "saved");
  const submitStep = editor.locator('[data-slot="action-review"]'); // The author's choice is recorded with the submission, and the reviewer cannot change it afterwards.
  await expect(submitStep).toContainText("Submit edition for review");
  const modeGroup = submitStep.locator('[data-slot="submission-release-mode"]'); // The mode group is controlled and states the mode this submission will record in its own `data-mode`, so the click is read back from that group and made again if it still states the other mode.
  await expect(modeGroup).toBeVisible();
  await expect(async () => {
    await submitStep.getByRole("radio", { name: "Publish and notify partners", exact: true }).click();
    await expect(modeGroup).toHaveAttribute("data-mode", "publish-and-notify", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await submitStep.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(submitStep.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await page.goto(`/communication/review/${encodeURIComponent(NOTIFY_EDITION.variantId)}`);
  await expect(page.getByRole("heading", { name: "Review update", level: 1 })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-recorded-decision"]')).toHaveAttribute("data-decision", "approved");
  await page.goto(RELEASE_PATH); // The release review publishes the edition and, because its submission asked for one, submits the notice.
  await expect(page.getByRole("heading", { level: 2, name: "Publish approved editions" })).toBeVisible();
  await page.getByRole("checkbox", { name: `Release ${NOTIFY_EDITION.audience} — ${NOTIFY_EDITION.locale}`, exact: true }).click();
  await page.getByRole("button", { name: "Publish selected editions", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish selected editions", exact: true }).click();
  await expect(page.locator(RELEASE_RESULT), "The release was applied and says so").toHaveAttribute("data-outcome", "accepted");
}
async function openDelivery(page: Page, intentId: string): Promise<void> {
  await page.goto(deliveryPathOf(intentId)); // Opens one intent's delivery results in the browser and waits for the surface itself, not for a spinner.
  await expect(page.getByRole("heading", { level: 1, name: "Send history" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Send results" })).toBeVisible();
}
const deliveryRows = (page: Page) => page.getByRole("row");
test("a lost acknowledgement is recovered by identity, and one intent yields one message per recipient", async ({ page }) => {
  await page.goto("/"); // The shell's development label is asserted once in this file, here, because every outcome below is read off surfaces of a development build: a reader who mistook them for production would read a recorded acceptance as a delivered message.
  await expect(page.getByText("Development data", { exact: true }).first()).toBeVisible();
  const authority = await readUpdateAuthority(page);
  await requestNoticesThroughProof(page);
  await confirmThroughProof(page);
  const opened = await readPreferences(page);
  expect(fieldAt(opened, "data", "state"), "The person's own act makes the membership active").toBe("active");
  const membershipId = stringAt(opened, ["data", "membershipId"], "The membership the proof flow opened");
  expect(membershipId, "The membership the flow opened is keyed by the principal that opened it").toBe("principal-established-worker");
  const inboxBefore = await readJson(page.request, "/api/inbox"); // The inbox before the send: no message for this membership, stated as an absence of a message rather than as a zero, and with the one-copy rule on screen from the start. The count is taken per recipient — this membership's own list — and as the whole total it reports beside it.
  expect(numberAt(inboxBefore, ["data", "intentCount"], "Messages in the inbox before the send")).toBe(0);
  expect(arrayAt(inboxBefore, ["data", "messages"], "The inbox's messages before the send")).toHaveLength(0);
  await page.goto(INBOX_PATH);
  await expect(page.getByRole("heading", { level: 2, name: "Simulated emails" })).toBeVisible();
  await expect(page.getByText("No test emails yet")).toBeVisible();
  await expect(page.getByText(SIMULATED_MAIL)).toBeVisible();
  await armLostAcknowledgement(page.request, "requestNotification");
  await releaseAndNotify(page);
  const receipt = page.locator(RELEASE_RESULT);
  await expect(receipt, "The release itself was applied and says so").toHaveAttribute("data-outcome", "accepted");
  await expect(receipt, "The notice's own outcome is stated as uncertain, neither accepted nor failed").toContainText("Unconfirmed");
  await expect(page.getByText(SIMULATED_MAIL, { exact: true }).first()).toBeVisible();
  const intentId = onlyIntentIn(await readJson(page.request, "/api/inbox")); // The outcome is recovered by reading it back, not by sending anything again: the recipient's own inbox holds the one message that notice produced, and its intent is the identity every surface below is read under.
  await openDelivery(page, intentId); // The durable surface: the delivery results of that intent, read by the browser, with this person's own row on it. "Check the result" is the surface's only control — reading the same notice again, which can reveal an outcome and can never repeat a submission.
  const recovery = page.locator('[data-slot="delivery-recovery"]'); // The recovery card is the surface's own statement of what a recovery is; its title is a plain card heading rather than an outline entry, so it is read as the card's text.
  await expect(recovery.getByText("Refresh & retry", { exact: true })).toBeVisible();
  const checkTheResult = recovery.getByRole("button", { name: "Refresh status" });
  await expect(checkTheResult).toBeVisible();
  await expect(recovery.getByRole("button"), "Checking the result is the one control an accepted notice is offered").toHaveCount(1);
  for (const role of ["button", "link"] as const) await expect(page.getByRole(role, { name: RESEND_CONTROL }), "No control or link may send this work again under a new key").toHaveCount(0);
  await expect(page.getByText("Multiple rows share one send key")).toHaveCount(0);
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: membershipId })).toHaveCount(1);
  await expect(page.getByText("Already received a copy from an earlier notification for this update.")).toHaveCount(4);
  await checkTheResult.click(); // Reading the same notice again performs no effect, so the recovery the surface offers cannot repeat one: the service's own reason for withholding a repeat is stated beside the control, not decided here.
  await expect(recovery.getByText(/No recorded row may be submitted again/u)).toBeVisible();
  await expect(recovery.getByText("Retry failed sends")).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Retry failed sends", exact: true }), "Every copy this notice recorded was accepted, so no repeat is offered").toHaveCount(0);
  const inboxAfter = await readJson(page.request, "/api/inbox");
  expect(numberAt(inboxAfter, ["data", "intentCount"], "Messages in the inbox after the send")).toBe(1);
  const messages = arrayAt(inboxAfter, ["data", "messages"], "The inbox's messages");
  expect(messages, "One intent produced one message for this recipient").toHaveLength(1);
  expect(fieldAt(messages[0], "intentId"), "The message is the intent that was submitted").toBe(intentId);
  expect(fieldAt(messages[0], "state"), "The message carries the outcome that was recorded").toBe("accepted");
  await page.goto(INBOX_PATH);
  await expect(page.getByText("1 simulated email")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("Duplicate messages detected for one send")).toHaveCount(0);
  expect(outcomeOf((await submitNotice(page, { authority, releaseId: SEEDED_NOTICE.releaseId })).body), "The same work submitted under a fresh attempt identity").toBe("unchanged");
  const inboxAfterRepeat = await readJson(page.request, "/api/inbox");
  expect(numberAt(inboxAfterRepeat, ["data", "intentCount"], "Messages in the inbox after a fresh-key repeat")).toBe(1);
  expect(arrayAt(inboxAfterRepeat, ["data", "messages"], "The inbox's messages after a fresh-key repeat")).toHaveLength(1);
  await clearFailurePlan(page.request); // The armed failure is cleared before the test ends, so the plan a later test starts from is the one the reset lays down rather than the one this test left behind.
});
test("a definite failure may be repeated only inside the notice's usefulness window", async ({ page }) => {
  const authority = await readUpdateAuthority(page);
  const before = await readSendResult(page, SEEDED_NOTICE.intentId);
  await setClock(page.request, LAST_USEFUL_SECOND); // One second before the window closes: inside it, because the boundary is strict at equality. The one definite failure the seed recorded is the one recipient a repeat is permitted for; every accepted or uncertain copy is never repeated, whatever the window says.
  await openDelivery(page, SEEDED_NOTICE.intentId);
  await expect(page.getByText("Retry window open")).toBeVisible();
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(6);
  for (const [text, count] of Object.entries({ "Repeat permitted": 1, "Repeat not permitted": 4 })) await expect(rows.filter({ hasText: text })).toHaveCount(count);
  await expect(page.getByText(/may be retried under the same intent while the usefulness window is open/u)).toBeVisible();
  await expect(page.getByText(/Retries only the recipients whose send failed while the 24-hour window is open/u)).toBeVisible();
  const repeatControl = page.getByRole("button", { name: "Retry failed sends", exact: true }); // The window being open is what puts the repeat control on this surface: the read permits it, its own action names it, and the control submits only the copies the service recorded as definite failures. It is never a resend under a new key.
  await expect(repeatControl, "Inside the window the read permits a repeat, so the surface offers the control").toBeVisible();
  for (const role of ["button", "link"] as const) await expect(page.getByRole(role, { name: RESEND_CONTROL })).toHaveCount(0);
  const seededFingerprint = sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)); // The eligible repeat, performed from this surface: the one recipient whose copy definitely failed is submitted again, and the outcome renders in place through the surface's own receipt.
  await repeatControl.click();
  const repeatResult = page.locator('[data-slot="delivery-repeat-result"]');
  await expect(repeatResult.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
  const repeatedNotice = repeatResult.getByRole("link", { name: "View retry send results" });
  await expect(repeatedNotice).toBeVisible();
  const repeatedHref = (await repeatedNotice.getAttribute("href")) ?? ""; // The repeat is a notice of its own, so its results are read under its own identity: one accepted row for the recipient whose copy failed, and every other eligible recipient already covered rather than served twice.
  const repeatedIntentId = new URL(repeatedHref, "http://127.0.0.1").searchParams.get("intentId") ?? "";
  expect(repeatedIntentId, "The repeat recorded a notice of its own rather than rewriting the one it repeated").not.toBe(SEEDED_NOTICE.intentId);
  await repeatedNotice.click();
  await expect(page.getByRole("heading", { level: 2, name: "Send results" })).toBeVisible();
  await expect(page, "The surface reports the repeated notice's own results").toHaveURL(new RegExp(`[?&]intentId=${repeatedIntentId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:&|$)`, "u"));
  const repeatedRows = deliveryRows(page);
  await expect(repeatedRows, "One served recipient, and the table's own head").toHaveCount(2);
  await expect(repeatedRows.filter({ hasText: "membership-jonas-active" })).toHaveCount(1);
  await expect(repeatedRows.filter({ hasText: "Accepted (not delivered)" })).toHaveCount(1);
  await expect(page.getByText("Already received a copy from an earlier notification for this update."), "An accepted copy is never sent a second time").toHaveCount(4);
  expect(sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)), "A repeat leaves the notice it repeated untouched").toBe(seededFingerprint);
  await setClock(page.request, SEEDED_NOTICE.deadline); // At the closes-at instant exactly: closed. Reading the surface again is the whole of the recovery, and the surface states the service's own reason rather than deciding from the browser's clock.
  await openDelivery(page, SEEDED_NOTICE.intentId);
  await expect(page.getByText("Retry window closed")).toBeVisible();
  await expect(deliveryRows(page).filter({ hasText: "Repeat permitted" })).toHaveCount(0);
  await expect(page.getByText(/24-hour usefulness window has closed, so it cannot be revived as a fresh attempt/u)).toBeVisible();
  await expect(page.getByText("No recorded row may be submitted again: acceptance is never repeated, an uncertain outcome is recovered by re-querying the same intent, and a failure outside its usefulness window cannot be revived.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry failed sends", exact: true }), "A closed window offers no repeat").toHaveCount(0);
  await expect(page.locator('[data-slot="delivery-repeat-result"]')).toHaveCount(0);
  expect(sendResultFingerprint(await readSendResult(page, SEEDED_NOTICE.intentId)), "Nothing was recorded at the boundary").toBe(seededFingerprint);
  const refused = await submitNotice(page, { authority, releaseId: SEEDED_NOTICE.releaseId, intendedAt: SEEDED_NOTICE.intendedAt }); // A fresh attempt carrying the notice's own intended instant is refused by the window itself, and a new intent cannot revive it: the refusal names the field and states that the window is what decided.
  expect(outcomeOf(refused.body), "A fresh attempt at exactly 24 elapsed hours").toBe("invalid");
  const windowRefusal = messagesAt(refused.body, "intendedAt").join(" ");
  expect(windowRefusal, "The refusal is the usefulness window's, not the dedupe rule's").toMatch(/past the 24 hours it stays useful for/u);
  expect(windowRefusal, "A new intent cannot revive a notice past its window").toMatch(/and a new intent cannot revive it/u);
  expect(fieldAt(await readSendResult(page, SEEDED_NOTICE.intentId), "revision"), "The refused attempt recorded nothing").toBe(fieldAt(before, "revision"));
  await setClock(page.request, "2026-11-20T00:00:00Z");
});
test("acceptance, definite failure and uncertainty stay three outcomes, and an excluded membership is not a failure", async ({ page }) => {
  await openDelivery(page, SEEDED_NOTICE.intentId);
  await expect(page.getByText("What these statuses mean")).toBeVisible();
  const rows = deliveryRows(page);
  await expect(rows).toHaveCount(6);
  for (const [state, count] of Object.entries({ "Accepted (not delivered)": 3, Failed: 1, Unconfirmed: 1 })) await expect(rows.filter({ hasText: state })).toHaveCount(count);
  await expect(page.getByText("Multiple rows share one send key")).toHaveCount(0);
  for (const description of [/doesn’t prove external delivery or opens/u, /wasn’t queued\. Can be retried once/u, /confirmation was lost\. Refresh results rather than resending/u]) await expect(page.getByText(description)).toBeVisible();
  const failedRow = rows.filter({ hasText: "Failed" }); // Per-item detail: the failed recipient's row names the copy it was pinned to and its whole dedupe identity, so the one message it is recognised by is four stated values rather than an opaque token.
  await expect(failedRow.getByText("membership-jonas-active").first()).toBeVisible();
  for (const value of ["rendition-update-en-notice", SEEDED_NOTICE.intentId]) await expect(failedRow.getByText(value)).toBeVisible();
  for (const value of ["Publisher", "Purpose", "Intent"]) await expect(failedRow.getByText(value, { exact: true })).toBeVisible();
  await expect(failedRow.getByText("Repeat not permitted", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="delivery-results"]').getByText(SIMULATED_MAIL, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: RESEND_CONTROL })).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast], [data-toast], [role='log']"), "No ephemeral notification may stand in for a durable result").toHaveCount(0);
  const audience = await readJson(page.request, "/api/audience"); // The audience keeps the four membership states apart from any send outcome: an address awaiting proof, a person who chose Off and a restricted membership are excluded with their own reason, and none of them is a failed message. The counts are the read's own, so the page and the read cannot
  expect(fieldAt(audience, "data", "counts", "eligible"), "Eligible memberships in the seeded audience").toBe(SEEDED_AUDIENCE_COUNTS.eligible);
  expect(fieldAt(audience, "data", "counts", "excluded"), "Excluded memberships in the seeded audience: two addresses awaiting proof, two Off choices and one restriction").toBe(SEEDED_AUDIENCE_COUNTS.excluded);
  expect(fieldAt(audience, "data", "memberStates"), "The four membership states the seed lays down").toEqual(SEEDED_MEMBER_STATES);
  await page.goto("/communication/audience");
  await expect(page.getByRole("heading", { level: 1, name: "Email audience" })).toBeVisible();
  for (const value of ["Active", "Awaiting confirmation", "Off", "Restricted"]) await expect(page.getByText(value, { exact: true }).first()).toBeVisible();
  for (const value of ["Email address hasn’t been confirmed yet.", "Turned off by the subscriber for your update emails.", "Excluded by a restriction (not a subscriber choice)."])
    await expect(page.getByText(value).first()).toBeVisible();
  for (const state of ["Failed", "Accepted (not delivered)", "Unconfirmed"]) await expect(page.getByRole("row").filter({ hasText: state }), "An excluded membership is never reported as a sent, failed or uncertain message").toHaveCount(0);
  await page.goto(INBOX_PATH); // A reader who is not a recipient: the inbox states that no message exists rather than a zero, keeps the one-copy rule on screen, labels the simulated boundary, and claims no outcome it did not record.
  await expect(page.getByText("No test emails yet")).toBeVisible();
  await expect(page.getByText(/Each notification produces at most one email per recipient/u)).toBeVisible();
  await expect(page.getByText(SIMULATED_MAIL)).toBeVisible();
  for (const word of ["Failed", "Unconfirmed"]) await expect(page.getByText(word, { exact: true })).toHaveCount(0);
});
