/** Criterion 17 — Variants and localization. */ import type { Locator, Page } from "@playwright/test";
import { test, expect, actAs, armLostAcknowledgement, clearFailurePlan, devStateOf, fieldAt, jsonOf, stringAt } from "../playwright.config";
const UPDATE = "doc-update-autumn";
const EDITION = { enPublic: "variant-update-autumn-en-public", enSupporters: "variant-update-autumn-en-approved-supporter", frPublic: "variant-update-autumn-fr-public", arPublic: "variant-update-autumn-ar-public" } as const;
const ARABIC = "ar";
/** The revisions, releases and instants the deterministic seed states, quoted so a comparison names what it expected. */ const SEEDED = {
  enPublicRelease: "rev-update-en-1",
  enPublicReleaseRecord: "release-update-en-1",
  enPublicPublishedAt: "2026-11-10T09:00:00Z",
  enSupportersRelease: "rev-update-en-supporter-1",
  frRelease: "rev-update-fr-1",
  frReleaseRecord: "release-update-fr-1",
  frPublishedAt: "2026-11-12T09:00:00Z",
  arDraft: "rev-update-ar-draft-1",
  arCandidate: "rev-update-ar-candidate-1",
  arPriorGoodRelease: "rev-update-ar-1",
  arPriorGoodPublishedAt: "2026-10-24T09:00:00Z",
  enSecondRelease: "rev-update-en-2",
  noticeIntent: "intent-update-autumn-en",
} as const;
const PROTECTED_COPY = { title: "Autumn at Harbour Youth — for supporters", sentence: "the monthly costs rose in September" } as const;
const ARABIC_COPY = {
  title: "الخريف في هاربر يوث",
  /** The frozen candidate's closing sentence, which only a publication of that candidate serves. */ candidateOnly: "يجعل هذا العمل ممكناً",
  /** The earlier publication's second paragraph, which the retained prior-good head still serves. */ priorGoodOnly: "وتشاركنا وجبة.",
} as const;
const COPY = {
  overviewHeading: "Editions & publishing",
  noDraft: "No draft saved yet.",
  noRelease: "Not published yet.",
  siblingNote: "Each edition publishes independently — if one fails, the others remain published without rolling back.",
  pageEditionsNote: "Each edition pairs one audience with one language.",
  reviewOffer: "Waiting for review or publish",
  reviewLink: "Open review",
  restoreAction: "Restore published version to draft",
  restoreConfirm: "Restore to draft",
  withdrawLocaleAction: "Unpublish edition",
  withdrawLocaleConfirm: "Unpublish edition",
  withdrawalDoesNotRecall: "can’t recall emails already sent",
  languageServed: "Language",
  languageRequested: "Requested language",
  languageUnavailable: "Language not available",
  deliveryHeading: "Send results",
  ceilingLabel: "Eligible audience ceiling",
  servedLabel: "Recipients with results",
  alreadyCovered: "Already received a copy from an earlier notification for this update.",
  noticeForEdition: "Notice for this edition:",
  noticeAccepted: "Accepted (not delivered)",
  noticeTarget: "Email link",
  outboundNotice: "Simulated — no email leaves this workspace.",
  publicationSimulation: "Simulated publishing — preview how readers see it in Reader preview.",
  devLabel: "Development data",
} as const;
const OVERVIEW = `/communication/${UPDATE}`; // Where each surface lives. Addresses are composed here the way a link would, never typed into a browser bar by a person.
const editorPath = (variantId: string): string => `${OVERVIEW}/${encodeURIComponent(variantId)}`;
const previewPath = (variantId: string): string => `${editorPath(variantId)}/preview`;
const reviewPath = (candidateId: string): string => `/communication/review/${encodeURIComponent(candidateId)}`;
const receivingPath = (locale: string): string => `/preview/${UPDATE}?locale=${encodeURIComponent(locale)}`;
const deliveryPath = (intentId: string): string => `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
const RELEASE_ACTION = "Publish selected editions"; // The one release step the overview route composes, and the language names a release receipt states an edition by.
const LOCALE_NAME = { fr: "Français", ar: "العربية" } as const;
const RELEASE_MODE = { publishOnly: "Publish only", publishAndNotifyNow: "Publish and notify partners" } as const; // The two release modes the editor's submit step offers, in that step's own words, and the mode each of them records.
type ReleaseMode = (typeof RELEASE_MODE)[keyof typeof RELEASE_MODE];
const MODE_VALUE: Readonly<Record<ReleaseMode, string>> = { [RELEASE_MODE.publishOnly]: "publish-only", [RELEASE_MODE.publishAndNotifyNow]: "publish-and-notify" };
const STATED_OPERATION = /Operation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u; // The operation identity an uncertain result states, so the recovery is read back under the attempt that produced it.
const armLostReleaseAcknowledgement = async (page: Page): Promise<void> => armLostAcknowledgement(page.request, "publishVariants"); // Withholds the acknowledgement of a release: the effect and its ledger entry are stored and only the response is withheld.
async function updateRevisionOf(page: Page): Promise<string> {
  const body = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE)}`), "GET /api/updates"); // The revision of the Update as the variant overview read states it, which is the revision a release presents.
  return stringAt(body, ["revision"], "The Update's revision");
}
async function submitForReview(page: Page, variantId: string, revisionId: string, mode: ReleaseMode = RELEASE_MODE.publishOnly): Promise<void> {
  await page.goto(editorPath(variantId)); // Submits one edition's saved draft for review through the editor's own step, at the mode the journey needs.
  const editor = page.locator(`[data-slot="editor-shell"][data-edition="${variantId}"]`);
  await expect(editor).toBeVisible();
  const step = editor.locator('[data-slot="action-review"]');
  await expect(step).toContainText("Submit edition for review");
  await expect(step, "The step names the exact revision it freezes, so the submission is a stated identity rather than a guess").toContainText(revisionId);
  const modeGroup = step.locator('[data-slot="submission-release-mode"]');
  await expect(modeGroup, "The choice has to reach the step's own state and not only the radio's DOM, so the click is read back from the mode group and made again while that group still states the other mode").toBeVisible();
  await expect(async () => {
    await modeGroup.getByRole("radio", { name: mode, exact: true }).click();
    await expect(modeGroup).toHaveAttribute("data-mode", MODE_VALUE[mode], { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await step.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(step.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
}
async function approveCandidate(page: Page, variantId: string, revisionId: string): Promise<void> {
  await page.goto(reviewPath(variantId)); // Answers one edition's frozen candidate on the review route: the one decision that step offers, given once.
  const panel = page.locator('[data-slot="review-panel"]');
  await expect(panel).toHaveAttribute("data-family", "update");
  const frozen = panel.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen).toHaveCount(1);
  await expect(frozen).toContainText(revisionId);
  await expect(panel.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await panel.getByRole("button", { name: "Approve revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-recorded-decision"]')).toHaveAttribute("data-decision", "approved");
}
const releaseReviewOf = (page: Page): Locator => page.locator('[data-slot="publish-review"]'); // The release review the overview route composes below the variant grid, and one edition's row inside it.
const releaseRowOf = (page: Page, variantId: string): Locator => page.locator(`[data-slot="publish-review-edition"][data-variant-id="${variantId}"]`);
async function selectEditions(page: Page, variantIds: readonly string[]): Promise<void> {
  await expect(releaseReviewOf(page)).toBeVisible(); // Ticks one or more editions in the release review, by the checkbox each edition's own row names.
  for (const variantId of variantIds) {
    const row = releaseRowOf(page, variantId);
    await expect(row).toBeVisible();
    await row.getByRole("checkbox").click();
    await expect(row).toHaveAttribute("data-selected", "true");
  }
}
async function pressRelease(page: Page): Promise<Locator> {
  await releaseReviewOf(page).getByRole("button", { name: RELEASE_ACTION, exact: true }).click(); // Presses the release and its confirmation, and answers the receipt the attempt is reported on.
  await page.getByRole("alertdialog").getByRole("button", { name: RELEASE_ACTION, exact: true }).click();
  return page.locator('[data-slot="publish-review-result"]');
}
async function releaseEditions(page: Page, variantIds: readonly string[]): Promise<Locator> {
  await openOverview(page); // Releases the named editions through the one step the overview route composes, and answers its receipt.
  await selectEditions(page, variantIds);
  return pressRelease(page);
}
const releasedRowOf = (receipt: Locator, localeName: string): Locator => receipt.locator('[data-slot="publish-edition"]').filter({ hasText: localeName }); // One edition's row of a release receipt, named by the language the row states it in.
function isNoticeSubmission(requestUrl: string, method: string): boolean {
  if (method !== "POST") return false; // Whether one observed request is the notice the release review submits for the edition it has just released.
  try {
    return new URL(requestUrl).pathname === "/api/notify";
  } catch {
    return false; // An address this module cannot read is not the submission this file is waiting for.
  }
}
function intentIdentityOf(body: unknown): string {
  const created = fieldAt(body, "created"); // The notification intent an accepted notice created, from the answer the surface that submitted it received.
  const intentId = Array.isArray(created) ? created.find((entry) => typeof entry === "string" && entry.startsWith("intent-")) : undefined;
  if (typeof intentId !== "string") throw new Error(`The notice the release submitted named no intent, so its per-recipient results could not be read: ${JSON.stringify(body).slice(0, 400)}`);
  return intentId;
}
async function releaseNotifyingEdition(page: Page, variantId: string, localeName: string): Promise<{ readonly receipt: Locator; readonly intentId: string }> {
  await openOverview(page); // Releases one edition through the release review and answers the notice the edition's submission asked for.
  await selectEditions(page, [variantId]);
  await expect(page.locator('[data-slot="publish-notice"]'), "A release pressed before the notice's own target is read records the notification as needing attention, so the target is awaited first").toContainText(COPY.noticeTarget);
  const noticeAnswer = page.waitForResponse((answer) => isNoticeSubmission(answer.url(), answer.request().method()));
  const receipt = await pressRelease(page);
  await expect(receipt).toHaveAttribute("data-outcome", "accepted");
  const notified = releasedRowOf(receipt, localeName);
  await expect(notified, "The edition's own row states that this submission's notice was taken and accepted, which is the notice the identity below belongs to").toContainText(COPY.noticeForEdition);
  await expect(notified).toContainText(COPY.noticeAccepted);
  return { receipt, intentId: intentIdentityOf(await jsonOf(await noticeAnswer, "POST /api/notify (submitted by the release review)")) }; // The intent is on no screen — the delivery surface is opened by it — so it is read from the answer that same surface received.
}
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const editionCell = (page: Page, variantId: string): Locator => page.locator(`[data-slot="edition-cell"][data-variant-id="${variantId}"]`);
/** The value of one fact in a definition list, matched by the label the cell states for it. */ const factValueOf = (scope: Locator, label: string): Locator =>
  scope
    .locator("dt")
    .filter({ hasText: new RegExp(`^${escaped(label)}$`, "u") })
    .first()
    .locator("xpath=following-sibling::dd[1]");
const lifecycleOfCell = (cell: Locator): Locator => cell.locator('[data-slot="draft-status"]');
async function identityFactOf(cell: Locator, word: string, subject: string): Promise<string> {
  const stated = (await factValueOf(cell, "Published version").innerText()).trim(); // One identity one edition's publication facts state under a word of its own: the revision it publishes, or the publication that holds it.
  const found = new RegExp(`${word}\\s+(\\S+)`, "u").exec(stated);
  if (found === null || found[1] === undefined) throw new Error(`The edition stated no ${subject}, so there is none to compare: ${stated.slice(0, 300)}`);
  return found[1];
}
const publishedRevisionOf = (cell: Locator): Promise<string> => identityFactOf(cell, "Revision", "published revision");
const publicationIdOf = (cell: Locator): Promise<string> => identityFactOf(cell, "Release ID", "publication identity");
test("each language edition of an Update is its own variant with its own draft, candidate and publication", async ({ page }) => {
  await openOverview(page);
  await expect(page.locator('[data-slot="variant-overview"]')).toHaveAttribute("data-edition-count", "4");
  await expect(page.getByRole("heading", { name: COPY.overviewHeading, exact: true })).toBeVisible();
  for (const said of ["Saved drafts and review copies aren’t visible to partners until published.", COPY.siblingNote, COPY.pageEditionsNote]) await expect(page.getByText(said, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(COPY.devLabel, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="edition-cell"]')).toHaveCount(4);
  for (const [variantId, audience, locale] of [
    [EDITION.enPublic, "public", "en"],
    [EDITION.enSupporters, "approved-supporter", "en"],
    [EDITION.frPublic, "public", "fr"],
    [EDITION.arPublic, "public", "ar"],
  ] as const) {
    const cell = editionCell(page, variantId);
    await expect(cell).toHaveAttribute("data-audience", audience);
    await expect(cell).toHaveAttribute("data-locale", locale);
  }
  const english = editionCell(page, EDITION.enPublic);
  await expect(lifecycleOfCell(english)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(english)).toBe(SEEDED.enPublicRelease);
  await expect(factValueOf(english, "Published version")).toContainText(SEEDED.enPublicPublishedAt);
  await expect(factValueOf(english, "Published version")).toContainText("Unlisted (link only)");
  await expect(factValueOf(english, "Saved draft")).toHaveText(COPY.noDraft);
  const supporters = editionCell(page, EDITION.enSupporters);
  await expect(lifecycleOfCell(supporters)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(supporters)).toBe(SEEDED.enSupportersRelease);
  const french = editionCell(page, EDITION.frPublic);
  await expect(lifecycleOfCell(french)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(french)).toBe(SEEDED.frRelease);
  await expect(factValueOf(french, "Published version")).toContainText(SEEDED.frPublishedAt);
  await expect(factValueOf(french, "Saved draft")).toHaveText(COPY.noDraft);
  const overview = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE)}`), "GET /api/updates");
  const frenchEdition = (fieldAt(overview, "data", "editions") as readonly unknown[]).find((edition) => fieldAt(edition, "variantId") === EDITION.frPublic);
  expect(fieldAt(frenchEdition, "translation", "status"), "The translation's source revision is a record fact, so it is read where the record states it: the overview read answers the translation of each edition, and the French one copied the English public revision").toBe("fresh");
  expect(stringAt(frenchEdition, ["translation", "sourceRevisionId"], "The French edition's translation source")).toBe(SEEDED.enPublicRelease);
  const arabic = editionCell(page, EDITION.arPublic);
  await expect(lifecycleOfCell(arabic)).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(factValueOf(arabic, "Saved draft")).toHaveText(SEEDED.arDraft);
  await expect(factValueOf(arabic, "In review")).toContainText(SEEDED.arCandidate);
  await expect(factValueOf(arabic, "Published version")).toHaveText(COPY.noRelease);
  await expect(arabic.getByRole("link", { name: "Preview", exact: true }), "An edition that publishes nothing offers no preview and says why, rather than showing a draft as published").toBeVisible();
  const reviewOffer = page.locator("section").filter({ has: page.getByRole("heading", { name: COPY.reviewOffer, exact: true }) });
  await expect(reviewOffer).toContainText("1 edition waiting");
  await expect(reviewOffer.getByRole("link", { name: COPY.reviewLink, exact: true })).toHaveAttribute("href", reviewPath(SEEDED.arCandidate));
  expect(await optionValuesOf(page.locator('[data-slot="locale-switcher"]').getByLabel("Language", { exact: true }))).toEqual(["en", "fr", "ar"]);
  await expect(page.locator('[data-slot="variant-switcher"]').getByText("Edition", { exact: true }).first()).toBeVisible();
  await page.goto("/pages/doc-page-harbour-youth"); // The family rule is a real difference between the two families: a Page's editions are public locale editions, so its builder offers a language and no audience choice at all. The pairing an Update admits — public and approved supporters — is therefore never offered where the family does not hold
  const builder = page.locator('[data-slot="page-builder"]');
  await expect(builder).toBeVisible();
  await expect(page.locator('[data-slot="locale-switcher"]').getByLabel("Language", { exact: true })).toBeVisible();
  await expect(builder.locator('[data-slot="locale-edition"]')).toHaveCount(2);
  await expect(builder.getByRole("radio", { name: "Approved supporters", exact: true })).toHaveCount(0);
  await expect(builder.getByLabel(/audience/iu)).toHaveCount(0);
});
test("saving the Arabic draft leaves the English and French drafts and publications exactly as they were", async ({ page }) => {
  await openOverview(page);
  const englishBefore = await publishedRevisionOf(editionCell(page, EDITION.enPublic));
  const frenchBefore = await publishedRevisionOf(editionCell(page, EDITION.frPublic));
  const frenchPublishedAt = (await factValueOf(editionCell(page, EDITION.frPublic), "Published version").innerText()).trim();
  await page.goto(editorPath(EDITION.arPublic));
  const editor = page.locator('[data-slot="editor-shell"][data-edition="' + EDITION.arPublic + '"]');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("العربية");
  const prose = editor.getByRole("textbox", { name: "The text of this Update edition", exact: true });
  await expect(prose).toBeVisible();
  await prose.click();
  await page.keyboard.press("ControlOrMeta+End");
  const typed = "متطوعون جدد انضموا هذا الأسبوع.";
  await page.keyboard.type(typed);
  await expect(editor.locator('[data-slot="autosave-status"]')).toContainText(/Draft saved \(revision/u);
  await openOverview(page);
  const arabic = editionCell(page, EDITION.arPublic);
  const draftAfter = (await factValueOf(arabic, "Saved draft").innerText()).trim();
  expect(draftAfter).not.toBe(SEEDED.arDraft);
  expect(draftAfter.length).toBeGreaterThan(0);
  await expect(factValueOf(arabic, "In review")).toContainText(SEEDED.arCandidate);
  await expect(lifecycleOfCell(arabic)).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic)), "Neither sibling moved: the English publication is still the one it had, and the French one still publishes its own revision at its own instant").toBe(englishBefore);
  expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(frenchBefore);
  expect((await factValueOf(editionCell(page, EDITION.frPublic), "Published version").innerText()).trim()).toBe(frenchPublishedAt);
  await page.goto(previewPath(EDITION.arPublic)); // The preview of the Arabic edition renders the acknowledged draft, so the typed sentence is on screen there — the record's own statement that the text was written, not the form's echo of what was typed into it.
  const preview = page.locator('[data-slot="preview-frame"]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(typed);
});
test("a release attempt reports one result per edition, and a sibling that cannot release is not rolled back", async ({ page }) => {
  await openOverview(page);
  const french = editionCell(page, EDITION.frPublic);
  await french.getByRole("button", { name: COPY.restoreAction, exact: true }).click();
  await page.getByRole("button", { name: COPY.restoreConfirm, exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await appendToDraft(page, EDITION.frPublic, " Merci pour votre fidélité cette année."); // A restored revision copies the digest of the one it restores, so a sentence of its own is what makes the release below a publication of a revision nobody has published yet rather than the no-op `unchanged`.
  await openOverview(page);
  const restoredDraft = (await factValueOf(editionCell(page, EDITION.frPublic), "Saved draft").innerText()).trim();
  expect(restoredDraft).not.toBe(SEEDED.frRelease);
  expect(restoredDraft.length).toBeGreaterThan(0);
  await submitForReview(page, EDITION.frPublic, restoredDraft); // A release publishes a frozen candidate, so the restored draft is submitted and answered first: the submission, the one review step and the release are three separate steps, each taken on the surface that composes it.
  await approveCandidate(page, EDITION.frPublic, restoredDraft);
  const release = await releaseEditions(page, [EDITION.frPublic, EDITION.arPublic]);
  await expect(release, "One attempt names both editions. The Arabic edition is still awaiting its one review, so the receipt reports a released French edition and an Arabic one that needs attention — never one status for the pair").toHaveAttribute("data-outcome", "accepted");
  const frenchResult = releasedRowOf(release, LOCALE_NAME.fr);
  const arabicResult = releasedRowOf(release, LOCALE_NAME.ar);
  await expect(frenchResult).toHaveAttribute("data-edition-state", "released");
  await expect(arabicResult).toHaveAttribute("data-edition-state", "needs-attention");
  await expect(arabicResult).toContainText("awaiting-review");
  await openOverview(page);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(restoredDraft);
  const arabic = editionCell(page, EDITION.arPublic);
  await expect(factValueOf(arabic, "Published version")).toHaveText(COPY.noRelease);
  await expect(factValueOf(arabic, "In review")).toContainText(SEEDED.arCandidate);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic)), "The English editions, which the attempt never named, are untouched").toBe(SEEDED.enPublicRelease);
  await approveCandidate(page, EDITION.arPublic, SEEDED.arCandidate); // The Arabic edition's one review step answers its frozen candidate, and only then is that same revision released — through the same composed release review, at the revision the review answered.
  const arabicRelease = await releaseEditions(page, [EDITION.arPublic]);
  await expect(arabicRelease).toHaveAttribute("data-outcome", "accepted");
  await expect(releasedRowOf(arabicRelease, LOCALE_NAME.ar)).toHaveAttribute("data-edition-state", "released");
  await openOverview(page);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.arPublic))).toBe(SEEDED.arCandidate);
  await expect(lifecycleOfCell(editionCell(page, EDITION.arPublic))).toHaveAttribute("data-lifecycle-state", "released"); // The lifecycle word states the publication that now serves the approved revision: the release took the candidate up, so the edition is released rather than still holding one, and the revision a reader is served is the one the review answered (asserted above).
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic)), "The French edition that the earlier attempt released is still served: releasing a sibling never withdraws it").toBe(restoredDraft);
  await page.goto(receivingPath(ARABIC));
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "rendered");
  const post = page.locator('[data-slot="receiving-post"]');
  await expect(post).toContainText(ARABIC_COPY.candidateOnly);
  await expect(post.getByText("Language", { exact: false }).first()).toBeVisible();
  expect(await post.locator('div[dir="rtl"][lang="ar"]').count()).toBeGreaterThan(0);
});
async function openOverview(page: Page): Promise<void> {
  await page.goto(OVERVIEW);
  await expect(page.locator('[data-slot="variant-overview"]')).toHaveAttribute("data-document-id", UPDATE);
}
async function appendToDraft(page: Page, variantId: string, sentence: string): Promise<void> {
  await page.goto(editorPath(variantId)); // Writes one sentence at the end of an edition's saved draft and waits for the service to acknowledge it.
  const editor = page.locator(`[data-slot="editor-shell"][data-edition="${variantId}"]`);
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "The text of this Update edition", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(sentence);
  await expect(editor.locator('[data-slot="autosave-status"]')).toContainText(/Draft saved \(revision/u);
}
const optionValuesOf = async (select: Locator): Promise<readonly string[]> => select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
const renderedTextOf = async (scope: Locator): Promise<string> => scope.evaluate((element) => (element as HTMLElement).textContent ?? ""); // The text of one region as the browser renders it, used where a comparison is about characters rather than layout.
async function recipientIn(scope: Locator): Promise<string> {
  const stated = scope.locator("dt", { hasText: /^Recipient$/u }).locator("xpath=following-sibling::dd[1]"); // The recipient one delivery row's dedupe identity states, by the label the row prints it under.
  return (await stated.innerText()).trim();
}
test("a release attempt that failed for one edition keeps that edition's earlier publication standing", async ({ page }) => {
  await actAs(page, "established-worker-partial-release");
  await openOverview(page);
  const english = editionCell(page, EDITION.enPublic);
  await expect(await publishedRevisionOf(english)).toBe(SEEDED.enSecondRelease);
  await expect(lifecycleOfCell(english)).toHaveAttribute("data-lifecycle-state", "released");
  const arabic = editionCell(page, EDITION.arPublic);
  await expect(await publishedRevisionOf(arabic)).toBe(SEEDED.arPriorGoodRelease);
  await expect(factValueOf(arabic, "Published version")).toContainText(SEEDED.arPriorGoodPublishedAt);
  await expect(factValueOf(arabic, "Published version")).not.toContainText("2026-11-18");
  await expect(lifecycleOfCell(arabic), "Beneath that retained publication the edition still holds the frozen candidate the failed attempt never released, and the grid states that as the edition's own lifecycle word rather than as a publication").toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(factValueOf(arabic, "In review")).toContainText(SEEDED.arCandidate);
  const french = editionCell(page, EDITION.frPublic);
  await expect(french.getByText("Translation: Translation out of date", { exact: true }), "The French translation of the edition that moved is disclosed as stale, and nothing about it was withdrawn: a stale translation is a fact about the source, not an approval and not a publication event").toBeVisible();
  await expect(lifecycleOfCell(french)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(french)).toBe(SEEDED.frRelease);
  await page.goto(receivingPath(ARABIC)); // What a reader is served proves the same thing from the other side: the Arabic edition serves the earlier publication's text, and not a word of the revision the failed attempt would have released.
  const post = page.locator('[data-slot="receiving-post"]');
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "rendered");
  await expect(post).toContainText(ARABIC_COPY.priorGoodOnly);
  await expect(post).not.toContainText(ARABIC_COPY.candidateOnly);
  await page.goto(receivingPath("en"));
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText("planning the Christmas meal");
});
test("a release whose acknowledgement was lost is recovered by replaying the same attempt, and publishes once", async ({ page }) => {
  await openOverview(page);
  await editionCell(page, EDITION.frPublic).getByRole("button", { name: COPY.restoreAction, exact: true }).click();
  await page.getByRole("button", { name: COPY.restoreConfirm, exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await appendToDraft(page, EDITION.frPublic, " Merci pour votre fidélité cette année.");
  await openOverview(page);
  const restoredDraft = (await factValueOf(editionCell(page, EDITION.frPublic), "Saved draft").innerText()).trim();
  const publicationBefore = await publicationIdOf(editionCell(page, EDITION.frPublic));
  await submitForReview(page, EDITION.frPublic, restoredDraft);
  await approveCandidate(page, EDITION.frPublic, restoredDraft);
  await armLostReleaseAcknowledgement(page); // The acknowledgement of this release is going to be withheld. The effect and its ledger entry are stored; only the answer is lost, which is exactly the state a person must be able to recover from.
  const receipt = await releaseEditions(page, [EDITION.frPublic]);
  await expect(receipt).toHaveAttribute("data-outcome", "unknown");
  await expect(receipt, "The uncertain result names the attempt it may be checked under, and offers nothing that would send the work again").toContainText(STATED_OPERATION);
  const operation = STATED_OPERATION.exec(await receipt.innerText())?.[1];
  if (operation === undefined) throw new Error(`The lost acknowledgement named no operation, so the recovery could not be read back under it: ${(await receipt.innerText()).slice(0, 400)}`);
  await openOverview(page);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(restoredDraft);
  const publicationAfterAttempt = await publicationIdOf(editionCell(page, EDITION.frPublic));
  expect(publicationAfterAttempt).not.toBe(publicationBefore);
  const mode = (await releaseRowOf(page, EDITION.frPublic).getAttribute("data-mode"))?.trim() ?? ""; // The recovery is the same attempt replayed, and the application answers with the result it stored rather than releasing a second time. The surface offers the check and no resend, so replaying this one recorded attempt is the recovery itself: it carries the selection the release review submitted — the revision its candidate froze, and the mode that edition's own row stated — under the identity the receipt named.
  if (mode === "") throw new Error("The release review stated no mode for the French edition, so the replayed attempt would not be the one that was made.");
  const replayInput = { operationId: operation, scope: (await devStateOf(page.request)).scope, expectedRevision: await updateRevisionOf(page), payload: { documentId: UPDATE, variants: [{ variantId: EDITION.frPublic, revisionId: restoredDraft, mode }] } };
  expect(fieldAt(await jsonOf(await page.request.post("/api/publish", { data: replayInput }), "POST /api/publish (same attempt replayed)"), "outcome")).toBe("alreadyAccepted");
  await openOverview(page);
  expect(await publicationIdOf(editionCell(page, EDITION.frPublic))).toBe(publicationAfterAttempt);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(restoredDraft);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic))).toBe(SEEDED.enPublicRelease);
  await expect(factValueOf(editionCell(page, EDITION.arPublic), "Published version")).toHaveText(COPY.noRelease);
  await clearFailurePlan(page.request);
});
test("a requested language is answered with the language actually served: the edition asked for, that language's edition, or this document's most recent admitted one, and Language unavailable only when nothing stands in", async ({ page }) => {
  await page.goto(receivingPath("fr"));
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "rendered");
  await expect(page.locator('[data-slot="receiving-post"]')).toHaveAttribute("data-fallback", "false");
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText("Language: fr");
  await expect(page.locator('[data-slot="receiving-post"]')).not.toContainText(COPY.languageRequested);
  await page.goto(receivingPath("fr-CA"));
  const fallbackPost = page.locator('[data-slot="receiving-post"]');
  await expect(fallbackPost).toHaveAttribute("data-fallback", "true");
  for (const value of ["Language: fr", "Requested language: fr-CA", "Requested in fr-CA — showing the available fr edition instead.", "Audience: Public"]) await expect(fallbackPost).toContainText(value);
  await expect(fallbackPost.locator('div[lang="fr"]')).toHaveCount(1);
  await page.goto(receivingPath("de")); // A language this Update publishes nothing in. No Site declares a default, so the substitute is this document's most recently published admitted public edition — the French one — in the same audience, and the surface names the language actually served beside the one asked for.
  const substitutedPost = page.locator('[data-slot="receiving-post"]');
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "rendered");
  await expect(substitutedPost).toHaveAttribute("data-fallback", "true");
  for (const value of ["Language: fr", "Requested language: de", "Requested in de — showing the available fr edition instead.", "Audience: Public"]) await expect(substitutedPost).toContainText(value);
  await expect(page.locator('[data-slot="receiving-post-language-unavailable"]')).toHaveCount(0);
  await actAs(page, "reader-unauthorized");
  await page.goto(receivingPath("en"));
  const publicPost = page.locator('[data-slot="receiving-post"]');
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "rendered");
  await expect(publicPost).toContainText("Audience: Public");
  await expect(publicPost).not.toContainText(PROTECTED_COPY.title);
  await expect(publicPost).not.toContainText(PROTECTED_COPY.sentence);
});
test("one recorded notice gives every recipient one row and one pinned copy, and a second language adds none", async ({ page }) => {
  await page.goto(deliveryPath(SEEDED.noticeIntent));
  await expect(page.getByRole("heading", { name: COPY.deliveryHeading, exact: true })).toBeVisible();
  await expect(page.getByText(COPY.outboundNotice, { exact: true }).first()).toBeVisible();
  const table = page.getByRole("table", { name: new RegExp(`^${escaped(COPY.deliveryHeading)}: recorded outcomes for notice ${escaped(SEEDED.noticeIntent)}$`, "u") });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(table.getByText("Accepted (not delivered)", { exact: true })).toHaveCount(3);
  await expect(table.getByText("Failed", { exact: true })).toHaveCount(1);
  await expect(table.getByText("Unconfirmed", { exact: true })).toHaveCount(1);
  const recipients: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const row = rows.nth(index);
    const identity = row.locator('[data-slot="delivery-dedupe-identity"]');
    for (const value of ["Publisher", "Purpose", "Recipient"]) await expect(identity).toContainText(value);
    await expect(identity).toContainText(SEEDED.noticeIntent);
    await expect(row, "The copy this recipient was pinned to is stated once and is a rendition, so it cannot drift with a later change of audience or language").toContainText("rendition-");
    recipients.push(await recipientIn(identity));
  }
  expect(new Set(recipients).size, "Five recipients, five rows: no person holds two rows, which is what one notice per recipient means here").toBe(5);
  for (const recipient of recipients) expect(recipient.length).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="delivery-duplicates"]'), "No two rows share one dedupe identity, and no recipient who was eligible went unserved, so the recorded result reconciles with the ceiling the review acknowledged rather than being summarised into it").toHaveCount(0);
  await expect(page.locator('[data-slot="delivery-unserved"]')).toHaveCount(0);
  const summary = page.locator('[data-slot="delivery-summary"]');
  await expect(summary).toContainText(SEEDED.noticeIntent);
  await expect(summary).toContainText(SEEDED.enPublicReleaseRecord);
  await expect(summary).toContainText("Update emails");
  await expect(summary).toContainText(COPY.ceilingLabel);
  await expect(summary).toContainText(COPY.servedLabel);
  const failedRecipient = await recipientIn(rows.filter({ has: page.getByText("Failed", { exact: true }) }).locator('[data-slot="delivery-dedupe-identity"]'));
  expect(recipients, "The one recipient whose earlier submission definitely failed is the only one this notice could not reach").toContain(failedRecipient);
  await openOverview(page); // A second French edition of the same Update, released and notified through the composed controls: the published revision is restored as a new draft, a sentence of this file's own makes it a revision nobody has published yet, the author submits it at Publish and notify now, the reviewer answers it, and the release review publishes it and submits the notice that submission asked for. Nobody already covered may receive a second copy in another language, so the notice that release submitted serves only the recipient whose earlier copy definitely failed.
  await editionCell(page, EDITION.frPublic).getByRole("button", { name: COPY.restoreAction, exact: true }).click();
  await page.getByRole("button", { name: COPY.restoreConfirm, exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await appendToDraft(page, EDITION.frPublic, " Merci pour votre fidélité cette année.");
  await openOverview(page);
  const frenchDraft = (await factValueOf(editionCell(page, EDITION.frPublic), "Saved draft").innerText()).trim();
  expect(frenchDraft).not.toBe(SEEDED.frRelease);
  expect(frenchDraft.length).toBeGreaterThan(0);
  await submitForReview(page, EDITION.frPublic, frenchDraft, RELEASE_MODE.publishAndNotifyNow);
  await approveCandidate(page, EDITION.frPublic, frenchDraft);
  const { receipt: frenchReceipt, intentId: frenchIntent } = await releaseNotifyingEdition(page, EDITION.frPublic, LOCALE_NAME.fr);
  await expect(releasedRowOf(frenchReceipt, LOCALE_NAME.fr), "The receipt reports the edition this notice was submitted for as released, so the notice below belongs to a release this attempt made rather than to one that failed").toHaveAttribute("data-edition-state", "released");
  await openOverview(page); // The publication that attempt produced, read from the edition's own facts on the grid: the notice below is the one for that publication, so its summary is compared against the identity this release minted rather than a constant.
  const frenchPublication = await publicationIdOf(editionCell(page, EDITION.frPublic));
  expect(frenchPublication).not.toBe(SEEDED.frReleaseRecord);
  expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(frenchDraft);
  await page.goto(deliveryPath(frenchIntent));
  const frenchTable = page.getByRole("table", { name: new RegExp(`^${escaped(COPY.deliveryHeading)}: recorded outcomes for notice ${escaped(frenchIntent)}$`, "u") });
  const frenchRows = frenchTable.locator("tbody tr");
  await expect(frenchRows).toHaveCount(1);
  const frenchIdentity = frenchRows.first().locator('[data-slot="delivery-dedupe-identity"]');
  await expect(frenchIdentity).toContainText(frenchIntent);
  for (const value of ["Publisher", "Purpose", "Recipient"]) await expect(frenchIdentity).toContainText(value);
  await expect(frenchRows.first(), "The copy this recipient was pinned to is one opaque identity, so it cannot drift with a later change of audience or language").toContainText(/edition:|rendition-/u);
  await expect(summary, "The summary names this notice and the release this attempt published, so the outcomes below are read under the identities the composed release produced").toContainText(frenchIntent);
  await expect(summary).toContainText(frenchPublication);
  expect(await recipientIn(frenchIdentity)).toBe(failedRecipient);
  const unserved = page.locator('[data-slot="delivery-unserved"]');
  await expect(unserved, "Everyone else is recorded as already holding a copy of this Update's notice, so a second language produced no second message for them: the row count above is how many copies were made, not how many were eligible").toBeVisible();
  await expect(unserved.getByText(COPY.alreadyCovered, { exact: false })).toHaveCount(4);
  for (const recipient of recipients.filter((id) => id !== failedRecipient)) await expect(unserved).toContainText(recipient);
  await expect(page.locator('[data-slot="delivery-duplicates"]')).toHaveCount(0);
});
test("the Arabic edition is authored and read right to left, with mixed-direction values kept in order", async ({ page }) => {
  await page.goto(editorPath(EDITION.arPublic)); // The same four values the seeded notice's rows state — publisher, purpose, recipient and intent — so this row is this notice's own copy rather than a second message for the other audience.
  const editor = page.locator(`[data-slot="editor-shell"][data-edition="${EDITION.arPublic}"]`);
  await expect(editor).toBeVisible();
  const prose = page.getByRole("textbox", { name: "The text of this Update edition", exact: true });
  await expect(prose, "Direction is a property of the document, carried by the region that holds the writing rather than by a physical alignment applied to left-to-right text").toBeVisible();
  await expect(page.locator('section[dir="rtl"]').filter({ has: prose }).first(), "The route states the edition's direction on the region it renders, and the editor states the same direction on its own writing surface, so the writing sits inside a right-to-left block rather than beside one").toBeVisible();
  await expect(page.locator('[dir="rtl"][lang="ar"]').first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Text formatting", exact: true }), "The one editor's toolbar is present, so the authoring surface is the bounded one rather than a plain box").toBeVisible();
  await prose.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
  const firstItem = "نتقابل كل جمعة";
  const secondItem = "نشارك وجبة";
  await page.keyboard.type(firstItem);
  await page.keyboard.press("Enter");
  await page.keyboard.type(secondItem);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const mixed = "Harbour Youth — +44 7700 900123 — https://example.org/youth — 2026-11-20";
  await page.keyboard.type(mixed);
  await expect(editor.locator('[data-slot="autosave-status"]')).toContainText(/Draft saved \(revision/u);
  await page.goto(previewPath(EDITION.arPublic));
  const preview = page.locator('[data-slot="preview-frame"]');
  await expect(preview).toBeVisible();
  const rendered = preview.locator('div[dir="rtl"][lang="ar"]');
  await expect(rendered).toHaveCount(1);
  const items = rendered.locator("ul > li");
  await expect(items).toHaveCount(2);
  for (const [index, item] of [firstItem, secondItem].entries()) await expect(items.nth(index)).toContainText(item);
  const renderedText = await renderedTextOf(rendered);
  expect(renderedText, "The mixed-direction values survive as written, in the order they were typed, and are isolated rather than reordering the text around them").toContain(mixed);
  expect(renderedText.indexOf(firstItem)).toBeLessThan(renderedText.indexOf(secondItem));
  expect(renderedText.indexOf(secondItem)).toBeLessThan(renderedText.indexOf(mixed));
  expect(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/u.test(renderedText), "No direction control character reached the record: logical order is stored, and the direction comes from the document. This is the only place in this file where those characters are named").toBe(false);
  await expect(rendered).not.toHaveAttribute("style", /direction|text-align/u);
  const mixedValues = ["+44 7700 900123", "https://example.org/youth", "2026-11-20"] as const; // The three weak or neutral values the mixed line carries — a telephone number, an address and a civil date — which right-to-left prose cannot place on its own.
  const isolatedValue = (value: string): Locator => rendered.locator("bdi").filter({ hasText: new RegExp(`^${escaped(value)}$`, "u") });
  for (const value of mixedValues) await expect(isolatedValue(value).first(), `the value ${value} sits in an isolation element of its own, so it keeps its direction inside the Arabic prose around it`).toBeVisible();
  expect(await rendered.locator("bdi").count(), "every value the author typed is isolated, not only the first one the renderer met").toBeGreaterThanOrEqual(mixedValues.length);
  const article = rendered.locator("article");
  await expect(article).toHaveAttribute("dir", "rtl");
  await expect(article, "The block that declares the direction of the writing declares the language of the writing too, so assistive technology reading the article alone is told both").toHaveAttribute("lang", ARABIC);
});
test("withdrawing the French edition stops that edition being served and leaves English and Arabic standing", async ({ page }) => {
  await openOverview(page);
  const french = editionCell(page, EDITION.frPublic);
  await french.getByRole("button", { name: COPY.withdrawLocaleAction, exact: true }).click();
  await expect(page.getByText(COPY.withdrawalDoesNotRecall, { exact: false }).first(), "A withdrawal is consequential, so it is confirmed deliberately and states what it cannot do before it is taken").toBeVisible();
  const step = page.locator('[data-slot="action-review"]');
  await step.getByRole("button", { name: COPY.withdrawLocaleConfirm, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: COPY.withdrawLocaleConfirm, exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await openOverview(page);
  const withdrawn = editionCell(page, EDITION.frPublic);
  await expect(lifecycleOfCell(withdrawn)).toHaveAttribute("data-lifecycle-state", "withdrawn");
  for (const said of ["Unpublished", SEEDED.frRelease]) await expect(factValueOf(withdrawn, "Published version")).toContainText(said);
  await expect(withdrawn.getByRole("button", { name: COPY.withdrawLocaleAction, exact: true }), "The action a withdrawn edition cannot offer is withheld with its reason rather than shown disabled").toHaveCount(0);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic))).toBe(SEEDED.enPublicRelease);
  await expect(lifecycleOfCell(editionCell(page, EDITION.enPublic))).toHaveAttribute("data-lifecycle-state", "released");
  await expect(factValueOf(editionCell(page, EDITION.arPublic), "Published version")).toHaveText(COPY.noRelease);
  await expect(page.getByText(COPY.devLabel, { exact: true })).toBeVisible();
  await page.goto(receivingPath("fr"));
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "language-unavailable");
  await expect(page.getByText("L'automne à Harbour Youth", { exact: false })).toHaveCount(0);
  await page.goto(receivingPath("en"));
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText("Autumn at Harbour Youth");
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText(COPY.publicationSimulation);
});
