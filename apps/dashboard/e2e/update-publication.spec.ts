/** Criterion 9 — Update publication. */ import type { Locator, Page } from "@playwright/test";
import { test, expect, actAs, devStateOf, fieldAt, fixturePathOf, jpegSizeOf, jsonOf, messagesAt, newAttemptId, outcomeOf, sessionCookie, type JsonRecord } from "../playwright.config";
const CONTRIBUTOR_SESSION = "established-worker"; // The name of the development-session cookie, mirrored once from `modules/store/sessions.ts`, where the
const REVIEWER_SESSION = "content-reviewer";
const PUBLIC_READER_SESSION = "reader-public";
const UPDATE_DOCUMENT = "doc-update-autumn";
const PUBLIC_ENGLISH_EDITION = "variant-update-autumn-en-public";
const FROZEN_ARABIC_EDITION = "variant-update-autumn-ar-public"; // The Arabic edition whose frozen candidate stands unanswered, so a candidate can be shown as not a release.
const FROZEN_ARABIC_CANDIDATE = "rev-update-ar-candidate-1";
const SEEDED_NOTICE_INTENT = "intent-update-autumn-en";
const SEEDED_NOTICE_RELEASE = "release-update-en-1";
const SEEDED_NOTICE_RECIPIENTS = 5;
const EXIF_FIXTURE = "IMG_20260814-harbour-youth-group.jpg";
const EXIF_SOURCE_STRINGS = ["Exif", "Harbour Test Body", "Synthetic Camera Co.", "private original", "IMG_20260814"] as const;
const DISPLAY_EDGE_PX = 2000;
const ALT_TEXT = "The youth group gathered in the church hall after a Friday meal.";
const CAPTION = "A Friday meal this term.";
const MAIL_SIMULATION = "Simulated — no email leaves this workspace."; // The sentence every simulated mail boundary states: a publish-only submission involves no notice, so this is stated only where one is submitted.
const LOCAL_PROCESSING = "Processed locally — not production media scanning or transcoding."; // What the picker states about its own processing, so local work is never presented as production scanning.
const PUBLISH_ONLY_BADGE = "Publish only"; // The author's choice the review surface states as a fact, and the sentence that it cannot be flipped.
const REVIEWER_CANNOT_FLIP = "Reviewers can’t switch between Publish only and Publish and notify partners";
const NOTIFY_NOW_CHOICE = "Publish and notify partners"; // The other choice the editor offers: the two journeys that publish only never record it, and the third records it deliberately.
const CEILING_HEADING = "Who a notice could reach"; // The heading and the count label the release review states for the audience the notice it would submit could reach.
const NOTICE_RESULTS_LINK = "View send history";
const NOTICE_LINK_LABEL = "Open the update";
const RELEASE_ACTION = "Publish selected editions"; // The one release step the overview route composes, the confirmation inside its dialog, and the receipt it renders.
const RELEASE_RECEIPT = '[data-slot="publish-review-result"]';
const ENGLISH_LOCALE_NAME = "English"; // The locale name the release review and its receipt state for the edition this file releases, and what a receipt rows a release under.
const RELEASE_RESULT = "Publishing results";
const ONE_DECISION_ONCE = "Decisions are final for this submission. Any revisions require a new submission."; // What a release of an edition whose submission is still unanswered is refused with, in the service's words.
const CANDIDATE_APPROVED = "This revision is approved.";
const PUBLISHED_PROSE = "This term the Friday group met every week, and six new faces joined us at the long table."; // The prose this file publishes, and the later draft text that must never reach a reader.
const LATER_DRAFT_PROSE = "A later draft paragraph that no reader has been served, written after the release.";
const editorPath = (variantId: string): string => `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}/${encodeURIComponent(variantId)}`;
const reviewPath = (variantId: string): string => `/communication/review/${encodeURIComponent(variantId)}`;
const overviewPath = (): string => `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}`;
const deliveryPath = (intentId: string): string => `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
const PUBLISH_API = "/api/publish";
const NOTIFY_API = "/api/notify";
const INBOX_API = "/api/inbox";
async function getAs(page: Page, sessionId: string, url: string): Promise<{ readonly status: number; readonly body: unknown }> {
  const answer = await page.request.get(url, { headers: { cookie: sessionCookie(sessionId) } }); // Reads one address as one stated identity, answering the status and the parsed body.
  return { status: answer.status(), body: await jsonOf(answer, `GET ${url} as ${sessionId}`) };
}
type DevState = { readonly scope: JsonRecord; readonly revision: string }; // What one session's development state states: the authority a control runs under and the revision it saw.
async function postRelease(page: Page, sessionId: string, attempt: { readonly operationId: string; readonly state: DevState; readonly variants: readonly JsonRecord[] }): Promise<unknown> {
  const answer = await page.request.post(PUBLISH_API, { headers: { cookie: sessionCookie(sessionId) }, data: { operationId: attempt.operationId, scope: attempt.state.scope, expectedRevision: attempt.state.revision, payload: { documentId: UPDATE_DOCUMENT, variants: attempt.variants } } }); // Posts one release attempt under one stated identity and returns the outcome the service answered.
  return jsonOf(answer, `POST ${PUBLISH_API} as ${sessionId}`);
}
type PhaseRecorderHost = { __mediaPickerPhases?: string[] }; // The window member the simulated phase recorder appends to, read back by {@link pickerPhases}.
/** Starts recording every phase the media picker reports, before the file is chosen. */ const recordPickerPhases = async (page: Page): Promise<void> =>
  void (await page.evaluate(() => {
    const host = globalThis as unknown as PhaseRecorderHost & { MutationObserver: typeof MutationObserver };
    const phases: string[] = [];
    host.__mediaPickerPhases = phases;
    const collect = (): void => {
      const picker = document.querySelector('[data-slot="media-picker"]');
      const phase = picker?.getAttribute("data-phase") ?? "";
      if (phase !== "" && phases[phases.length - 1] !== phase) phases.push(phase);
    };
    collect();
    new MutationObserver(collect).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-phase"] });
  }));
const pickerPhases = async (page: Page): Promise<readonly string[]> => page.evaluate(() => (globalThis as unknown as PhaseRecorderHost).__mediaPickerPhases ?? []);
function responseTextOf(bytes: Buffer, headers: Readonly<Record<string, string>>, status: number): string {
  const stated = Object.entries(headers).map(([name, value]) => `${name}: ${value}`); // Everything a rendition response states, as text: its status line, every header and the body's own bytes
  return [`HTTP ${String(status)}`, ...stated, bytes.toString("latin1")].join("\n");
}
const editorOf = (page: Page) => page.locator('[data-slot="editor-shell"]');
const proseOf = (page: Page) => page.getByRole("textbox", { name: "The text of this Update edition", exact: true }); // The text of one edition, through the one prose surface, by the name a reader hears for it.
const autosaveOf = (page: Page) => page.locator('[data-slot="autosave-status"]'); // The durable status line of the autosave, whose own state word is what a save is judged by.
async function draftRevisionOnEditor(page: Page): Promise<string> {
  const stated = page.locator('[data-slot="editor-shell-body"] dl dd .mono-identifier').first(); // The revision identity the editor states for the saved draft in front of the worker.
  await expect(stated).toBeVisible();
  const text = (await stated.innerText()).trim();
  if (text === "") throw new Error("The editor stated no draft revision, so the submission could not be compared with the revision it freezes.");
  return text;
}
function editionFactOf(page: Page, variantId: string, term: string) {
  const cell = page.locator(`[data-slot="edition-cell"][data-variant-id="${variantId}"]`); // One fact of one edition on the variant matrix: the row a reader finds under the term the matrix states
  return cell.locator("dl > div").filter({ hasText: term });
}
async function identityOfFact(page: Page, variantId: string, term: string): Promise<string> {
  const stated = editionFactOf(page, variantId, term).locator(".mono-identifier").first(); // The identity one edition's fact states, which is the value the row carries rather than a count of rows.
  await expect(stated).toBeVisible();
  const text = (await stated.innerText()).trim();
  if (text === "") throw new Error(`The ${term} fact of ${variantId} stated no identity, so nothing could be compared with it.`);
  return text;
}
const releaseReviewOf = (page: Page): Locator => page.locator('[data-slot="publish-review"]'); // The release review one Update's overview route composes, and one edition's row inside it, named by the matrix's own identity.
const releaseEditionOf = (page: Page, variantId: string): Locator => page.locator(`[data-slot="publish-review-edition"][data-variant-id="${variantId}"]`);
// Pressing the release: the review the overview route composes below the variant matrix
async function selectForRelease(page: Page, variantId: string): Promise<void> {
  const row = releaseEditionOf(page, variantId); // Selects one edition for release the way a person does: the checkbox the edition's own row names. An edition with no frozen candidate offers none, so a selection that finds none fails here.
  await expect(row).toBeVisible();
  await row.getByRole("checkbox").click();
  await expect(row).toHaveAttribute("data-selected", "true");
}
async function pressRelease(page: Page): Promise<void> {
  await releaseReviewOf(page).getByRole("button", { name: RELEASE_ACTION, exact: true }).click(); // Presses the one release step and the confirmation inside the dialog it opens: the attempt's identity, the recorded modes and any notice are the surface's own business.
  await page.getByRole("alertdialog").getByRole("button", { name: RELEASE_ACTION, exact: true }).click();
}
async function publicationIdentityOf(page: Page, variantId: string): Promise<string> {
  const stated = (await editionFactOf(page, variantId, "Published version").innerText()).trim(); // The publication identity one edition's own release facts name, which changes exactly once per release of it.
  const publication = /Release ID\s+(\S+)/u.exec(stated);
  if (publication === null || publication[1] === undefined) throw new Error(`The ${variantId} edition stated no publication identity, so nothing could be compared with it: ${stated.slice(0, 300)}`);
  return publication[1];
}
async function noticeOfResultRow(row: Locator): Promise<{ readonly intentId: string; readonly href: string }> {
  const notice = row.locator('[data-slot="publish-edition-notice"]'); // The notice one released edition's result row states: the identity it was submitted under and the address the row renders for the outcomes recorded under it.
  await expect(notice, "One released edition's row states the notice that went with it").toHaveCount(1);
  await expect(notice).toHaveAttribute("data-notice-state", "accepted");
  await expect(notice).toContainText("Accepted (not delivered)");
  const stated = notice.locator(".mono-identifier").first();
  await expect(stated).toBeVisible();
  const intentId = (await stated.innerText()).trim();
  if (intentId === "") throw new Error("The result row named no notice identity, so the outcomes recorded under it could not be read back.");
  const link = notice.getByRole("link", { name: NOTICE_RESULTS_LINK, exact: true });
  await expect(link, "The result names the notice it submitted and links the outcomes recorded under it").toBeVisible();
  const href = (await link.getAttribute("href"))?.trim() ?? "";
  if (href === "") throw new Error(`The notice's own link carried no address, so the screen it opens could name no notice: ${intentId}`);
  return { intentId, href };
}
// 1. The whole publication: prose and an image, the exact candidate, one review step, the release, and a later draft edit that moves nothing a reader is served
test("an Update is composed with an image, previewed, reviewed once and released at the exact revision it submitted, and a later draft edit leaves that release standing", async ({ page }) => {
  await actAs(page, CONTRIBUTOR_SESSION);
  const noticeBefore = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`); // The baseline every "no notice was created" assertion is compared with: the one notice the seed recorded, read by the publisher it belongs to (a reader is refused those outcomes, which is why this read acts as the ministry), and the inbox the recipient side holds.
  expect(noticeBefore.status, "The seeded notice's recorded outcomes are the baseline this file compares against").toBe(200);
  expect(fieldAt(noticeBefore.body, "data", "releaseId"), "The baseline is the notice the seed recorded, pinned to the release it was submitted for").toBe(SEEDED_NOTICE_RELEASE);
  expect(fieldAt(noticeBefore.body, "data", "rows")).toHaveLength(SEEDED_NOTICE_RECIPIENTS);
  const inboxBefore = await getAs(page, PUBLIC_READER_SESSION, INBOX_API);
  expect(inboxBefore.status, "The recipient-side inbox is readable by the reader whose inbox it is").toBe(200);
  expect(fieldAt(inboxBefore.body, "data", "messages"), "The seeded world puts no message in this reader's inbox").toHaveLength(0);
  await page.goto(editorPath(PUBLIC_ENGLISH_EDITION));
  const editor = editorOf(page);
  await expect(editor.getByRole("heading", { name: "Edit update", exact: true })).toBeVisible();
  await expect(page.getByText("Development data", { exact: true })).toBeVisible();
  for (const said of ["No draft saved yet — start writing to create one. Nothing is published until you release it.", "Saved drafts and review copies aren’t visible to partners until published."]) await expect(editor).toContainText(said);
  const prose = proseOf(page);
  await prose.click();
  await page.keyboard.type(PUBLISHED_PROSE);
  await expect(autosaveOf(page)).toHaveAttribute("data-autosave-state", "saved");
  expect(await draftRevisionOnEditor(page), "The first save records a revision of its own").not.toBe("");
  await page.locator('[data-slot="editor-media-pane"]').getByRole("button", { name: "Add image", exact: true }).click();
  const picker = page.locator('[data-slot="media-picker"][data-kind="image"]');
  await expect(picker).toHaveAttribute("data-phase", "choosing");
  for (const said of ["No more than 10 MiB.", "No more than 8,000 pixels on either side.", LOCAL_PROCESSING]) await expect(picker).toContainText(said);
  await recordPickerPhases(page);
  await picker.locator('input[type="file"]').setInputFiles(fixturePathOf(EXIF_FIXTURE));
  await expect(picker).toHaveAttribute("data-phase", "described");
  await picker.getByRole("button", { name: "Add this image", exact: true }).click();
  await expect(picker.getByText("Describe what this image shows for screen readers.", { exact: true }).first()).toBeVisible();
  await expect(picker).toHaveAttribute("data-phase", "described");
  await picker.getByRole("textbox", { name: "Alt text", exact: true }).fill(ALT_TEXT);
  await picker.getByRole("textbox", { name: /^Caption/u }).fill(CAPTION);
  await picker.getByRole("button", { name: "Add this image", exact: true }).click();
  await expect(picker.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
  await expect(picker.getByText(LOCAL_PROCESSING, { exact: true })).toBeVisible();
  const phases = await pickerPhases(page);
  expect(phases, "The picker passed through each of its own states in order; The picker reported preparation before it reported an answer, which is what makes the receipt the end of a process rather than a substitute for one").toEqual(expect.arrayContaining(["choosing", "preparing", "described", "settled"]));
  expect(phases.indexOf("preparing"), "Preparation started before the description form was shown").toBeLessThan(phases.indexOf("described"));
  expect(phases.lastIndexOf("preparing"), "The attempt was shown as preparing before its answer arrived").toBeGreaterThan(phases.indexOf("described"));
  expect(phases.indexOf("settled"), "The answer arrived after the attempt it answers").toBeGreaterThan(phases.lastIndexOf("preparing"));
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('[data-slot="media-picker"]')).toHaveCount(0);
  const placement = page.locator('[data-slot="placement-row"][data-kind="image"]').first(); // The placement carries the description the reader hears and never the file's own name: the record holds an opaque identity, so nothing of the machine the file came from is echoed back.
  for (const said of [ALT_TEXT, CAPTION, "Ready"]) await expect(placement).toContainText(said);
  await expect(placement).not.toContainText(EXIF_FIXTURE);
  await expect(editor).not.toContainText(EXIF_FIXTURE);
  const submitStep = editor.locator('[data-slot="action-review"]');
  await expect(submitStep, "--- the exact candidate is previewed, inertly ---------------------------------------------").toContainText("Submit edition for review");
  const submittedDraft = await draftRevisionOnEditor(page);
  await expect(submitStep, "The step names the exact revision it freezes, so the submission is a stated identity rather than a guess").toContainText(submittedDraft);
  const releaseChoice = submitStep.locator('[data-slot="submission-release-mode"]');
  await releaseChoice.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true }).click();
  await expect(releaseChoice.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true })).toBeChecked();
  await expect(releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).not.toBeChecked();
  await submitStep.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(submitStep.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await page.getByRole("link", { name: "Preview edition", exact: true }).click();
  const frame = page.locator('[data-slot="preview-frame"]');
  await expect(frame).toHaveAttribute("data-preview-status", "authorised");
  const revision = (await frame.getAttribute("data-preview-revision"))?.trim() ?? "";
  if (revision === "") throw new Error("The preview named no revision, so the release could not be compared with the revision a reviewer answered.");
  expect(revision, "The preview renders the revision the submission froze").toBe(submittedDraft);
  await expect(frame, "The preview is the one renderer's output for that exact revision: the prose and the placement both appear, and the revision it renders is stated as a fact rather than implied").toContainText(PUBLISHED_PROSE);
  await expect(frame.getByRole("img", { name: ALT_TEXT })).toBeVisible();
  await expect(frame).toContainText(revision);
  await expect(frame.locator('[data-slot="preview-inert"]')).toBeVisible();
  await expect(frame.getByRole("button", { name: /publish|notify|send|subscribe|pay|donate/iu })).toHaveCount(0);
  await expect(frame.getByText("Simulated publishing — preview how readers see it in Reader preview.", { exact: true })).toBeVisible();
  const unseenByReviewer = await getAs(page, REVIEWER_SESSION, `/api/review?variantId=${encodeURIComponent(PUBLIC_ENGLISH_EDITION)}`); // --- one review step, then the release of exactly that revision ---------------------------- A seeded session holds its own copy of the world (AAP 0.7.2: a session sees only its own files), so a candidate written here is this session's to answer and not another seat's: the reviewer identity answers the seeded candidate in the second test of this file, and this journey's review step is opened where the candidate lives. That isolation is asserted rather than assumed, so a reader sees why one seat writes, reviews and releases here instead of handing the submission to a second seat.
  expect(fieldAt(unseenByReviewer.body, "data", "status"), "Another session holds its own copy of the world, so this candidate is not its frozen revision").toBe("none");
  await page.goto(reviewPath(PUBLIC_ENGLISH_EDITION));
  await expect(page.getByRole("heading", { name: "Review update", level: 1 })).toBeVisible();
  const panel = page.locator('[data-slot="review-panel"]');
  const frozen = panel.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen).toHaveCount(1);
  await expect(frozen).toContainText(revision);
  await expect(frozen).toContainText(PUBLIC_ENGLISH_EDITION);
  const authorIntent = panel.locator('[data-slot="review-publish-intent"]'); // The author's Publish only choice is a fact on this screen, and the reviewer holds no control that could change it: the sentence and the absence of a notice control are the proof, not a disabled button.
  for (const value of ["radio", "checkbox", "switch"] as const) await expect(authorIntent.getByRole(value)).toHaveCount(0);
  const decision = panel.locator('[data-slot="review-decision"]');
  await expect(decision).toHaveCount(1);
  await expect(decision).toContainText(ONE_DECISION_ONCE);
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve revision", exact: true }).click();
  const recorded = page.locator('[data-slot="review-recorded-decision"]');
  await expect(recorded).toHaveAttribute("data-decision", "approved");
  await expect(recorded).toContainText(CANDIDATE_APPROVED);
  await expect(recorded).toContainText("Reviewed by");
  const releaseState = await devStateOf(page.request, CONTRIBUTOR_SESSION); // The release is the separate act the approval is not. The mode a release may take is the mode the submission recorded, and no composed control can name another, so that refusal is asserted at the boundary that enforces it — the one attempt in this file a press cannot make.
  const flipped = await postRelease(page, CONTRIBUTOR_SESSION, { operationId: newAttemptId(), state: releaseState, variants: [{ variantId: PUBLIC_ENGLISH_EDITION, revisionId: revision, mode: "publish-and-notify-now" }] });
  expect(outcomeOf(flipped), "A release cannot take a mode the submission never asked for").toBe("invalid");
  expect(messagesAt(flipped, "variants.0").join(" ")).toMatch(/mode the submission did not ask for/u);
  await page.goto(overviewPath());
  const releaseRow = releaseEditionOf(page, PUBLIC_ENGLISH_EDITION);
  await expect(
    releaseRow,
    "The edition the submission froze is the one the release offers, at the exact revision the preview rendered, and its word is Approved because the review record on this frozen candidate is an approval — an approval publishes nothing, so only the release below reaches a reader",
  ).toHaveAttribute("data-lifecycle-state", "approved");
  await expect(releaseRow).toHaveAttribute("data-mode", "publish-only");
  await expect(releaseRow).toContainText(revision);
  await selectForRelease(page, PUBLIC_ENGLISH_EDITION);
  const releaseMode = releaseRow.locator('[data-slot="publish-mode"]');
  await expect(releaseMode, "Selecting it states the mode the submission fixed, and the choice the author did not make is the one it refuses").toHaveAttribute("data-mode", "publish-only");
  await expect(releaseMode.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true })).toBeChecked();
  await expect(releaseMode.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).not.toBeChecked();
  await expect(releaseRow.locator('[data-slot="publish-mode-reason"]')).toContainText("A reviewer cannot release this edition with a mode the submission did not ask for, so a new submission is required.");
  await pressRelease(page);
  const receipt = page.locator(RELEASE_RECEIPT);
  await expect(receipt, "The answer is the release's own receipt: one edition, released, reported one at a time").toHaveAttribute("data-outcome", "accepted");
  await expect(receipt).toContainText(RELEASE_RESULT);
  const releasedRow = receipt.locator('[data-slot="publish-edition"]');
  await expect(releasedRow).toHaveCount(1);
  await expect(releasedRow).toHaveAttribute("data-edition-state", "released");
  await expect(releasedRow).toContainText(ENGLISH_LOCALE_NAME);
  await page.goto(overviewPath());
  expect(await identityOfFact(page, PUBLIC_ENGLISH_EDITION, "Published version"), "The release publishes exactly the revision the submission froze").toBe(revision);
  const releaseId = await publicationIdentityOf(page, PUBLIC_ENGLISH_EDITION);
  expect(releaseId, "The release is a publication of its own rather than the seeded one").not.toBe(SEEDED_NOTICE_RELEASE);
  const noticeAfter = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`);
  expect(fieldAt(noticeAfter.body, "data", "releaseId"), "Publish only is not Notify: the one notice the application recorded is still the seeded one, still pinned to the release it was submitted for, with the same recipients and the same outcomes").toBe(SEEDED_NOTICE_RELEASE);
  expect(fieldAt(noticeAfter.body, "data", "counts")).toEqual(fieldAt(noticeBefore.body, "data", "counts"));
  expect(fieldAt(noticeAfter.body, "data", "rows")).toHaveLength(SEEDED_NOTICE_RECIPIENTS);
  expect(fieldAt((await getAs(page, PUBLIC_READER_SESSION, INBOX_API)).body, "data", "intentCount"), "The release put no message in a reader's inbox").toBe(fieldAt(inboxBefore.body, "data", "intentCount"));
  await actAs(page, CONTRIBUTOR_SESSION);
  await page.goto(deliveryPath(SEEDED_NOTICE_INTENT));
  const delivery = page.locator('[data-slot="delivery-results"]');
  await expect(delivery).toBeVisible();
  await expect(delivery.locator("table tbody tr")).toHaveCount(SEEDED_NOTICE_RECIPIENTS);
  await expect(delivery).not.toContainText(releaseId);
  await page.goto(editorPath(PUBLIC_ENGLISH_EDITION));
  const reloadedProse = proseOf(page);
  await expect(reloadedProse, "What the worker returns to is the revision the release published, not an empty editor").toContainText(PUBLISHED_PROSE);
  await reloadedProse.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(LATER_DRAFT_PROSE);
  await expect(autosaveOf(page)).toHaveAttribute("data-autosave-state", "saved");
  await expect(page.locator('[data-slot="editor-shell-body"] dl dd .mono-identifier').first()).not.toHaveText(revision);
  const laterDraft = await draftRevisionOnEditor(page);
  expect(laterDraft, "A later save is a different revision from the one that was published").not.toBe(revision);
  await page.goto(overviewPath());
  expect(await identityOfFact(page, PUBLIC_ENGLISH_EDITION, "Saved draft"), "The new draft stands on its own identity").toBe(laterDraft);
  expect(await identityOfFact(page, PUBLIC_ENGLISH_EDITION, "Published version"), "The release head did not move with the draft").toBe(revision);
  await actAs(page, PUBLIC_READER_SESSION);
  await page.goto(`/preview/${encodeURIComponent(UPDATE_DOCUMENT)}?locale=en`);
  const post = page.locator('[data-slot="receiving-post"]');
  await expect(post, "The published text, and never the later draft: a draft is not something any reader is served").toContainText(PUBLISHED_PROSE);
  await expect(post).not.toContainText(LATER_DRAFT_PROSE);
  const servedImage = post.getByRole("img", { name: ALT_TEXT });
  await expect(servedImage).toBeVisible();
  const src = (await servedImage.getAttribute("src"))?.trim() ?? "";
  if (!src.startsWith("/api/media/")) throw new Error(`The published image is not served from the one scoped rendition address, so its bytes cannot be asserted here: ${JSON.stringify(src)}`);
  const rendition = await page.request.get(src);
  expect(rendition.status(), `GET ${src} as the reader the edition admits`).toBe(200); // The served bytes are re-encoded, carry no source metadata and no source file name, and are bounded to the display profile's longest edge — inspected as bytes, never decoded with a library
  const renditionHeaders = rendition.headers();
  expect(renditionHeaders["content-type"]).toMatch(/^image\//u);
  const servedBytes = Buffer.from(await rendition.body());
  const servedText = responseTextOf(servedBytes, renditionHeaders, rendition.status());
  for (const source of EXIF_SOURCE_STRINGS) expect(servedText.includes(source), `The served image still stated ${JSON.stringify(source)}, so the source's own file name or metadata escaped the local pipeline: ${src}`).toBe(false);
  expect(servedText).not.toMatch(/media-originals|\.data\//u);
  const servedSize = jpegSizeOf(servedBytes);
  expect(Math.max(servedSize.width, servedSize.height), `The served rendition is ${String(servedSize.width)}x${String(servedSize.height)}, and a source larger than ${String(DISPLAY_EDGE_PX)} px is bounded to that edge`).toBe(DISPLAY_EDGE_PX);
  const assetSegment = src.split("/")[3] ?? ""; // Another ministry's worker asks for the same rendition and is refused — with the same answer a rendition that never existed earns, so the refusal states nothing about what is there.
  await actAs(page, "second-worker");
  const refused = await page.request.get(src);
  const unknown = await page.request.get("/api/media/asset-not-in-this-scope/rendition-not-in-this-scope");
  expect(refused.status(), "A persona outside the asset's scope is refused the rendition").toBe(403);
  expect(unknown.status(), "An address naming no asset's rendition is refused identically").toBe(refused.status());
  const refusedBody = await jsonOf(refused, `GET ${src} as a second worker`);
  expect(refusedBody, "A refusal of an existing rendition is indistinguishable from a refusal of one that never existed").toEqual(await jsonOf(unknown, "GET a rendition no asset holds"));
  expect(JSON.stringify(refusedBody)).not.toContain(assetSegment);
});
test("a frozen candidate is answered by one review step and is not a release, so an unreviewed submission cannot be published", async ({ page }) => {
  await actAs(page, REVIEWER_SESSION);
  await page.goto(reviewPath(FROZEN_ARABIC_EDITION));
  await expect(page.getByRole("heading", { name: "Review update", level: 1 })).toBeVisible();
  const panel = page.locator('[data-slot="review-panel"]');
  const frozen = panel.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen, "The seeded candidate is the revision the review answers, and it is the only one here").toHaveCount(1);
  await expect(frozen).toContainText(FROZEN_ARABIC_CANDIDATE);
  await expect(panel.locator('[data-slot="review-decision"]')).toHaveCount(1);
  const authorIntent = panel.locator('[data-slot="review-publish-intent"]');
  await expect(authorIntent, "The submission asked for no notices, and the reviewer cannot add them").toHaveAttribute("data-notify-requested", "false");
  await expect(authorIntent).toContainText(PUBLISH_ONLY_BADGE);
  await expect(authorIntent).toContainText(REVIEWER_CANNOT_FLIP);
  await page.goto(overviewPath()); // No decision is given here: the candidate stays frozen and unanswered, which is exactly the state a release must refuse. Approval is not publication, and an unapproved candidate is not a release either — so the release is pressed on the surface that composes it, and refused there.
  const unreviewedRow = releaseEditionOf(page, FROZEN_ARABIC_EDITION);
  await expect(unreviewedRow).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(unreviewedRow).toContainText(FROZEN_ARABIC_CANDIDATE);
  await selectForRelease(page, FROZEN_ARABIC_EDITION);
  await pressRelease(page);
  const refusal = page.locator(RELEASE_RECEIPT);
  await expect(refusal).toHaveAttribute("data-outcome", "invalid");
  await expect(refusal).toContainText("This edition is still awaiting its one review, so it cannot be released yet.");
  await page.goto(overviewPath());
  await expect(editionFactOf(page, FROZEN_ARABIC_EDITION, "Published version")).toContainText("Not published yet.");
});
test("an edition whose author chose Publish and notify now is released through the same control, and the notice its result names opens on the delivery screen with both renderings of its message", async ({ page }) => {
  await actAs(page, CONTRIBUTOR_SESSION);
  const noticeBefore = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`); // The one notice the seed recorded is the baseline this journey compares against, read by the publisher it belongs to: a notice this publication submits is a new intent, and it never rewrites that one.
  expect(noticeBefore.status, "The seeded notice's recorded outcomes are readable by the ministry that submitted it").toBe(200);
  expect(fieldAt(noticeBefore.body, "data", "releaseId"), "The baseline is the notice the seed recorded, pinned to the release it was submitted for").toBe(SEEDED_NOTICE_RELEASE);
  await page.goto(editorPath(PUBLIC_ENGLISH_EDITION));
  const editor = editorOf(page);
  const prose = proseOf(page);
  await prose.click();
  await page.keyboard.type(PUBLISHED_PROSE);
  await expect(autosaveOf(page)).toHaveAttribute("data-autosave-state", "saved");
  const submittedDraft = await draftRevisionOnEditor(page);
  const submitStep = editor.locator('[data-slot="action-review"]');
  const releaseChoice = submitStep.locator('[data-slot="submission-release-mode"]');
  await expect(releaseChoice, "The mode is the author's decision, taken on the one step that records it: both choices are offered with what each does, publish-only starts selected, and choosing to notify is a deliberate act").toHaveAttribute("data-mode", "publish-only");
  await expect(releaseChoice.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true })).toBeChecked();
  await expect(releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).not.toBeChecked();
  await releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true }).click();
  await expect(releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).toBeChecked();
  await expect(releaseChoice).toHaveAttribute("data-mode", "publish-and-notify");
  await expect(submitStep).toContainText(submittedDraft);
  await submitStep.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(submitStep.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await page.goto(reviewPath(PUBLIC_ENGLISH_EDITION));
  await expect(page.getByRole("heading", { name: "Review update", level: 1 })).toBeVisible();
  const panel = page.locator('[data-slot="review-panel"]');
  const frozen = panel.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen).toHaveCount(1);
  await expect(frozen).toContainText(submittedDraft);
  const authorIntent = panel.locator('[data-slot="review-publish-intent"]');
  await expect(authorIntent, "The recorded mode is the author's, and the reviewer holds no control that could turn it into its opposite: the absence of every such control is the proof, not a disabled button").toHaveAttribute("data-notify-requested", "true");
  for (const said of [NOTIFY_NOW_CHOICE, REVIEWER_CANNOT_FLIP]) await expect(authorIntent).toContainText(said);
  for (const value of ["radio", "checkbox", "switch"] as const) await expect(authorIntent.getByRole(value)).toHaveCount(0);
  await expect(authorIntent.getByText(MAIL_SIMULATION, { exact: true }), "A notice is part of this release, so the simulated mail boundary is labelled where the choice is read").toBeVisible();
  await expect(panel.locator('[data-slot="review-decision"]')).toContainText(ONE_DECISION_ONCE);
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve revision", exact: true }).click();
  const recordedDecision = page.locator('[data-slot="review-recorded-decision"]');
  await expect(recordedDecision).toHaveAttribute("data-decision", "approved");
  await expect(recordedDecision).toContainText(CANDIDATE_APPROVED);
  await page.goto(overviewPath());
  const review = releaseReviewOf(page);
  const releaseRow = releaseEditionOf(page, PUBLIC_ENGLISH_EDITION);
  await expect(releaseRow, "The row states the mode the submission fixed and the exact revision the review answered, and it names that revision Approved because the review record on it is an approval, which publishes nothing by itself").toHaveAttribute("data-lifecycle-state", "approved");
  await expect(releaseRow).toHaveAttribute("data-mode", "publish-and-notify-now");
  await expect(releaseRow).toContainText(submittedDraft);
  await selectForRelease(page, PUBLIC_ENGLISH_EDITION);
  await expect(review, "One selected edition asked for a notice, and the review states that count itself").toHaveAttribute("data-notify-editions", "1");
  const ceilingBlock = review.locator('[data-slot="publish-ceiling"]');
  await expect(ceilingBlock, "The ceiling the notice is acknowledged against is the count the audience read stated, and the number a person can read beside that label is the number the release would carry").toHaveAttribute("data-state", "stated");
  const eligible = (await ceilingBlock.getAttribute("data-eligible"))?.trim() ?? "";
  if (!/^\d+$/u.test(eligible)) throw new Error(`The release review stated no eligible ceiling for the notice it would submit, so nothing could be acknowledged: ${JSON.stringify(eligible)}`);
  for (const said of [CEILING_HEADING, "Eligible partners"]) await expect(ceilingBlock).toContainText(said);
  await expect(ceilingBlock.locator("bdi").first()).toHaveText(eligible);
  const noticeTarget = review.locator('[data-slot="publish-notice"]');
  await expect(noticeTarget, "The notice's own target is read before the release is pressed: the edition it points at and the simulated boundary it crosses").toHaveAttribute("data-notice-edition", PUBLIC_ENGLISH_EDITION);
  await expect(noticeTarget).toContainText("Email link");
  await expect(noticeTarget.getByText(MAIL_SIMULATION, { exact: true })).toBeVisible();
  await pressRelease(page);
  const receipt = page.locator(RELEASE_RECEIPT);
  await expect(receipt, "--- the per-edition result, and the one notice it names -------------------------------------").toHaveAttribute("data-outcome", "accepted");
  await expect(receipt).toContainText(RELEASE_RESULT);
  await expect(receipt.locator('[data-slot="publish-edition"]')).toHaveCount(1);
  const releasedRow = receipt.locator(`[data-slot="publish-edition"][data-variant-id="${PUBLIC_ENGLISH_EDITION}"]`);
  await expect(releasedRow).toHaveAttribute("data-edition-state", "released");
  await expect(releasedRow, "The write answer names the release's own identity and no content revision, so the revision this release published is read from the edition's durable fact below rather than asserted from this row").toContainText(ENGLISH_LOCALE_NAME);
  await expect(receipt.locator('[data-slot="publish-edition-notice"]'), "One release of one notifying edition submits one notice; One release of one notifying edition submits one notice, and the row names it rather than describing whichever was submitted last").toHaveCount(1);
  await expect(receipt.locator('[data-slot="publish-edition-notice"]'), "One release of one notifying edition submits one notice").toHaveCount(1);
  const notice = await noticeOfResultRow(releasedRow);
  expect(notice.intentId, "The notice is this publication's own rather than the one the seed recorded").not.toBe(SEEDED_NOTICE_INTENT);
  expect(notice.href, "The link the result renders is the delivery address for that notice and no other").toBe(deliveryPath(notice.intentId));
  await expect(releasedRow.getByRole("link", { name: NOTICE_RESULTS_LINK, exact: true })).toHaveAttribute("href", notice.href); // The result row re-renders while the page it sits on settles, so the address the row renders is followed rather than clicked: the row's own href is the assertion here, and the screen a person reaches from it is the one below.
  await page.goto(notice.href);
  const landed = new URL(page.url());
  expect(`${landed.pathname}${landed.search}`, "The result's link opens the recorded outcomes of the notice it names").toBe(notice.href);
  const delivery = page.locator('[data-slot="delivery-results"]');
  await expect(delivery).toBeVisible();
  await expect(delivery).toContainText(notice.intentId);
  const recordedNotice = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(notice.intentId)}`);
  expect(recordedNotice.status, "The notice this publication submitted is readable by the ministry that submitted it; The record the screen renders is read as the check behind the assertion: every outcome it holds is one row, and no row it holds is missing from the page").toBe(200);
  expect(fieldAt(recordedNotice.body, "data", "intentId")).toBe(notice.intentId);
  const heldRows = fieldAt(recordedNotice.body, "data", "rows");
  const heldCount = Array.isArray(heldRows) ? heldRows.length : 0;
  expect(heldCount, "The notice served at least one eligible recipient, so its outcomes are recorded rows rather than none").toBeGreaterThan(0);
  await expect(delivery.locator("table tbody tr"), "The screen renders one row for each outcome the record holds").toHaveCount(heldCount);
  await expect(delivery.getByText(MAIL_SIMULATION, { exact: true }).first(), "Acceptance is neither delivery nor reading, and the simulated boundary is labelled where the outcomes are read").toBeVisible();
  const noticeBlock = delivery.locator('[data-slot="delivery-notice"]');
  await expect(noticeBlock, "Exactly one notice accompanies this publication's outcomes; --- the message itself, in both renderings the one notice presentation carries --------------").toHaveCount(1);
  await expect(noticeBlock).toHaveAttribute("data-notice-state", "stated");
  await expect(noticeBlock.getByRole("heading", { name: "Email message sent", level: 3 })).toBeVisible();
  const presentation = noticeBlock.locator('[data-slot="notice-presentation"]');
  await expect(presentation).toHaveAttribute("data-notice-rendering", "both");
  const messageLink = presentation.getByRole("link", { name: NOTICE_LINK_LABEL, exact: true });
  await expect(messageLink, "The HTML rendering is the real markup, and its link is the address the message carries").toBeVisible();
  const linkTarget = (await messageLink.getAttribute("href"))?.trim() ?? "";
  if (linkTarget === "") throw new Error("The rendered notice carried a link with no address, so the plain-text alternative could not be compared with it.");
  await presentation.getByRole("tab", { name: "Plain text", exact: true }).click();
  await expect(presentation.locator("pre")).toContainText(linkTarget);
  await presentation.getByRole("tab", { name: "HTML", exact: true }).click();
  await expect(presentation.getByRole("link", { name: NOTICE_LINK_LABEL, exact: true })).toBeVisible();
  const noticeAfter = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`); // --- the seeded notice is untouched by this publication -------------------------------------- A second publication of the document is a new intent, not a rewrite of the one the seed recorded: it still names its own release and still holds the same outcomes for the same recipients.
  expect(fieldAt(noticeAfter.body, "data", "releaseId")).toBe(SEEDED_NOTICE_RELEASE);
  expect(fieldAt(noticeAfter.body, "data", "counts")).toEqual(fieldAt(noticeBefore.body, "data", "counts"));
  await page.goto(overviewPath());
  await expect(editionFactOf(page, PUBLIC_ENGLISH_EDITION, "Published version"), "The release published the exact revision the submission froze").toContainText(submittedDraft);
});
