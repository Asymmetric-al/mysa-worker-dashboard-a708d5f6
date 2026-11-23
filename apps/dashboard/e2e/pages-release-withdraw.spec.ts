/** Criterion 12 — Worker and Project pages. */
import type { Locator, Page } from "@playwright/test";
import { test, expect, actAs, armLostAcknowledgement, arrayAt, chooseFile, clearFailurePlan, fieldAt, fixturePathOf, isRecord, jsonOf, newAttemptId, requestRendition, stringAt } from "../playwright.config";
const PAGE_DOCUMENT = "doc-page-harbour-youth";
const PAGE_FAMILY = "worker-page";
const PAGE_FAMILY_LABEL = "Worker Page";
const PAGE_TITLE = "Harbour Youth";
const PROJECT_PAGE_DOCUMENT = "doc-page-harbour-kitchen"; // The Project Page the same seed lays down: the second family, whose one public English edition holds a saved draft and nothing else.
const PROJECT_PAGE_FAMILY = "project-page";
const PROJECT_PAGE_FAMILY_LABEL = "Project Page";
const PROJECT_SECTION_HEADING = "A kitchen the whole week uses"; // The prose this file composes into the Project Page, so the preview assertion is about text only this test wrote.
const PROJECT_SECTION_BODY = "On Fridays the hall seats forty, and the kitchen is where every one of those plates begins.";
const ENGLISH = "en";
const ARABIC = "ar";
const ARABIC_DRAFT_PROSE = "أمسيات الجمعة";
const ADMITTED_SECTION_TYPES = ["Introduction", "Story", "Prayer", "Milestone", "Image", "Video", "Giving", "Support progress"] as const;
const REACH = { notPublic: "Not public", linkPublic: "Shared by link: public", listed: "Listed publicly" } as const;
const GIVING_SIMULATION = "simulated giving destination; no payment is taken";
const IMAGE_ALT_TEXT = "The youth group gathered in the church hall after a Friday meal."; // The words this file places an image with, so the placement the section states is one only this test wrote.
const VIDEO_ALT_TEXT = "The youth group's welcome message, filmed in the hall."; // The text alternative criterion 18's video placement carries, written here so the assertion reads the record rather than the form.
const VIDEO_CAPTION = "A short welcome for supporters";
const VIDEO_CREDIT = "Harbour Youth";
const VIDEO_LANGUAGE = "en"; // The media's own language, which is also the language the WebVTT track is offered in: it is never the interface's language.
const VIDEO_TRANSCRIPT = "Hello and welcome from the youth group.";
const VIDEO_TRACK_LABEL = "English";
const VIDEO_FIXTURES = { media: "sample-h264.mp4", poster: "poster.jpg", captions: "sample.vtt" } as const;
const PREPARATION_TIMEOUT_MS = 120_000; // Preparing a real MP4 is the heaviest work this application does on this device: the file is decoded, checked and re-muxed before any receipt exists.
// Every receipt this file awaits is a write that has already reached the service: the store rewrites the whole session document and re-checksums the
// revision, which on a loaded machine has taken sixteen seconds in this very file. The wait is stated rather than left to a default an assertion assumes.
const WRITE_RECEIPT_TIMEOUT_MS = 60_000;
const POLLED_CLICK_TIMEOUT_MS = 2_000; // How long one attempt to choose an option may wait for the control to answer.
const MEDIA_ROUTE = /^\/api\/media\/[A-Za-z0-9][A-Za-z0-9._:%-]*\/[A-Za-z0-9][A-Za-z0-9._:%-]*$/u; // The address every rendition is served from: a rendition of this application, never a file on a public path.
const PAGES_INDEX = "/pages";
const builderPath = (documentId: string): string => `/pages/${encodeURIComponent(documentId)}`;
const discoveryIndexPath = (): string => "/preview/pages";
const readingPath = (documentId: string, locale: string): string => `/preview/pages/${encodeURIComponent(documentId)}/${encodeURIComponent(locale)}`;
const armLostReleaseAcknowledgement = async (page: Page): Promise<void> => armLostAcknowledgement(page.request, "publishVariants"); // Withholds the acknowledgement of a Page release: the effect and its ledger entry are stored and only the response is withheld, so the attempt leaves exactly one release behind and the recovery below is a recovery rather than a second publication.
const builderOf = (page: Page) => page.locator('[data-slot="page-builder"]');
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const ANY_REACH_WORD = new RegExp(`(?:${escaped(REACH.notPublic)}|${escaped(REACH.linkPublic)}|${escaped(REACH.listed)})`, "u"); // Any one of the three reach words, so a released edition's row is asserted to state a reach rather than a particular one.
const nameOfLabelAtPosition = (label: string, position: number): RegExp => new RegExp(`^${escaped(label)}\\s*,\\s*Position ${String(position)}$`, "u");
const nameOfMove = (direction: "up" | "down", label: string, position: number): RegExp => new RegExp(`^Move ${direction} for ${escaped(label)}\\s*,\\s*Position ${String(position)}$`, "u");
const nameOfCatalogueEntry = (label: string): RegExp => new RegExp(`^Add a section\\s*:\\s*${escaped(label)}\\s*,\\s*Position \\d+$`, "u");
function builderLinkNameOf(title: string, familyLabel: string): RegExp {
  return new RegExp(`^${escaped(title)}\\s*,\\s*Open the ${escaped(familyLabel)} builder$`, "u"); // The accessible name of the index row that opens a Page's builder, which names the Page and its family.
}
const BUILDER_LINK_NAME = builderLinkNameOf(PAGE_TITLE, PAGE_FAMILY_LABEL); // The two Pages the seed lays down, each by the name its own index row carries.
const PROJECT_BUILDER_LINK_NAME = builderLinkNameOf("Harbour Youth Kitchen", PROJECT_PAGE_FAMILY_LABEL);
const reviewLinkName = (locale: string): RegExp => new RegExp(`^Review this candidate\\s*,\\s*for the ${escaped(locale)} language edition$`, "u"); // The accessible name of the review entry one frozen candidate holds, which also names the edition it belongs to.
const paneOf = (page: Page, pane: "outline" | "fields" | "preview") => page.locator(`[data-pane="${pane}"]`); // The three panes the builder shows on a wide screen, so an assertion names the pane it reads rather than the page.
type SectionRead = { readonly element: string; readonly placements: readonly Record<string, unknown>[] }; // One section of the Page read: the catalogue element it was composed from, and the placements it holds, which is where a registration's own write is read back from the record.
async function sectionsOfPage(page: Page): Promise<readonly SectionRead[]> {
  const read = await jsonOf(await page.request.get(`/api/pages?view=page&documentId=${encodeURIComponent(PAGE_DOCUMENT)}`), "GET /api/pages view=page");
  return arrayAt(read, ["data", "sections"], "The Page read's sections").map((section) => ({ element: stringAt(section, ["element"], "A section's catalogue element"), placements: arrayAt(section, ["placements"], "A section's placements").filter(isRecord) }));
}
function sectionOfType(sections: readonly SectionRead[], element: string): SectionRead {
  const found = sections.find((section) => section.element === element);
  if (found === undefined) throw new Error(`The Page read holds no ${element} section, so the placement this test wrote could not be read back: ${JSON.stringify(sections.map((section) => section.element))}`);
  return found;
}
async function openBuilder(page: Page): Promise<void> {
  await page.goto(builderPath(PAGE_DOCUMENT)); // Opens one Page's builder and waits for the builder itself, which carries the family and the open edition.
  await expect(builderOf(page)).toHaveAttribute("data-family", PAGE_FAMILY);
}
async function openProjectBuilder(page: Page): Promise<void> {
  await page.goto(PAGES_INDEX); // Opens the Project Page's builder from the Pages index row that names it, which is how a person reaches it rather than by addressing it.
  const link = page.getByRole("link", { name: PROJECT_BUILDER_LINK_NAME });
  await expect(link).toBeVisible();
  await link.click();
  const builder = builderOf(page);
  await expect(builder).toHaveAttribute("data-document-id", PROJECT_PAGE_DOCUMENT);
  await expect(builder).toHaveAttribute("data-family", PROJECT_PAGE_FAMILY);
  await expect(builder).toHaveAttribute("data-composing", "true");
}
async function previewRevisionOf(page: Page): Promise<string> {
  const preview = page.locator('[data-slot="page-preview-frame"]');
  await expect(preview).toHaveAttribute("data-preview-status", "authorised");
  const stated = (await preview.locator("dd .mono-identifier").first().innerText()).trim();
  if (stated === "") throw new Error("The preview stated no revision identity, so the release could not be compared with the revision it rendered.");
  return stated;
}
async function selectSection(page: Page, position: number, label: string): Promise<void> {
  const row = page.getByRole("button", { name: nameOfLabelAtPosition(label, position) });
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
}
async function addSection(page: Page, label: string): Promise<void> {
  const entry = page.getByRole("button", { name: nameOfCatalogueEntry(label) });
  await entry.click();
  const catalogue = page.locator('[data-slot="family-catalogue"]');
  await expect(catalogue.getByRole("heading", { name: `Add a section: ${label}`, exact: true })).toBeVisible();
  await catalogue.getByRole("button", { name: "Add a section", exact: true }).click();
  await expect(catalogue.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
}
/** Selects one radio option of a group and confirms the group states it: a section form is re-initialised whenever the read states a newer record, so a
 * choice made while that re-read lands is discarded, and the control is chosen again until it is the option the group holds. */
async function chooseOption(group: Locator, name: string): Promise<void> {
  const option = group.getByRole("radio", { name, exact: true });
  await expect(option).toBeVisible();
  await expect
    .poll(
      async () => {
        if (await option.isChecked()) return true;
        await option.click({ timeout: POLLED_CLICK_TIMEOUT_MS }).catch(() => undefined);
        return option.isChecked();
      },
      { message: `"${name}" is the option the group holds`, timeout: 30_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe(true);
}
async function selectEdition(page: Page, locale: string): Promise<void> {
  const switcher = page.locator('[data-slot="locale-switcher"]'); // Switches the builder to one language edition, through the one locale control the surface offers.
  await switcher.getByLabel("Language", { exact: true }).selectOption(locale);
  await expect(builderOf(page)).toHaveAttribute("data-locale", locale);
}
async function setReachTo(page: Page, words: string): Promise<void> {
  const reach = page.locator('[data-slot="reach-control"]');
  await reach.getByRole("radio", { name: words, exact: true }).click();
  await reach.getByRole("button", { name: "Save reach", exact: true }).click();
  await expect(reach.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await reach.getByRole("button", { name: "Done", exact: true }).click();
}
async function submitDraftForReview(page: Page, locale: string): Promise<void> {
  const row = page.locator(`[data-slot="release-edition"][data-lifecycle-state="draft"]`).filter({ has: page.getByRole("checkbox", { name: `Language ${locale}` }) }); // Submits the drafted edition for its one review step, from the row that edition holds.
  await row.getByRole("button", { name: "Submit for review", exact: true }).click();
  const step = page.locator('[data-slot="release-edition-step"][data-step="submit"]');
  await expect(step).toBeVisible();
  await step.getByRole("button", { name: "Submit for review", exact: true }).click();
  const receipt = step.locator('[data-slot="action-review-result"]');
  await expect(receipt, "The durable receipt states the outcome in words, which is the proof this submission is not a send").toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await expect(receipt.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
}
async function releaseSelectedEditions(page: Page, locale: string): Promise<void> {
  await page.getByRole("checkbox", { name: `Language ${locale}` }).check();
  await page.getByRole("button", { name: "Release this edition", exact: true }).click();
}
test("both family catalogues are admitted, and a Page is composed and reordered from the keyboard alone", async ({ page }) => {
  await page.goto(PAGES_INDEX);
  await expect(page.getByRole("heading", { name: "Your Pages", exact: true })).toBeVisible();
  for (const family of [
    { key: PAGE_FAMILY, label: PAGE_FAMILY_LABEL },
    { key: PROJECT_PAGE_FAMILY, label: PROJECT_PAGE_FAMILY_LABEL },
  ] as const) {
    const catalogue = page.locator(`[data-slot="family-catalogue"][data-family="${family.key}"]`);
    await expect(catalogue.getByRole("heading", { name: `Sections for your ${family.label}`, exact: true })).toBeVisible();
    for (const sectionType of ADMITTED_SECTION_TYPES) await expect(catalogue.getByRole("heading", { name: sectionType, exact: true })).toBeVisible();
  }
  const openBuilderLink = page.getByRole("link", { name: BUILDER_LINK_NAME });
  await expect(openBuilderLink).toBeVisible();
  await openBuilderLink.click();
  const builder = builderOf(page);
  await expect(builder).toHaveAttribute("data-locale", ARABIC);
  await expect(builder).toHaveAttribute("data-composing", "true");
  await expect(page.getByText("Development data", { exact: true })).toBeVisible();
  await expect(builder.locator('[data-slot="locale-edition"]')).toHaveCount(2);
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "draft");
  await expect(page.getByRole("list", { name: "Sections", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="section-outline-row"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Story", 1) })).toBeVisible();
  await addSection(page, "Prayer");
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Prayer", 2) })).toBeVisible();
  await expect(page.locator('[data-slot="section-outline-row"]')).toHaveCount(2);
  await selectSection(page, 2, "Prayer");
  const fields = paneOf(page, "fields");
  await expect(fields.getByRole("heading", { name: "Prayer — Section fields", exact: true })).toBeVisible();
  await fields.getByLabel("Heading", { exact: true }).fill("A prayer for this term");
  await fields.getByLabel("Body", { exact: true }).fill("Give thanks for the six new faces who joined us, and pray for the leaders who welcome them each Friday.");
  await fields.getByRole("button", { name: "Save this section", exact: true }).click();
  for (const said of ["A prayer for this term", "Give thanks for the six new faces who joined us"]) await expect(paneOf(page, "preview")).toContainText(said);
  const chosenFields = paneOf(page, "fields");
  await expect(chosenFields.getByRole("radio")).toHaveCount(4);
  for (const option of ["Normal", "Emphasized", "Single column", "Two columns with image and text"]) await expect(chosenFields.getByRole("radio", { name: option, exact: true })).toBeVisible();
  await expect(chosenFields.getByLabel("Alignment", { exact: true })).toHaveValue("start");
  expect(await chosenFields.getByLabel("Alignment", { exact: true }).locator("option").allInnerTexts()).toEqual(["Start", "Center"]);
  await expect(chosenFields.getByLabel("Image fit", { exact: true })).toHaveCount(0);
  for (const forbidden of [/raw html/iu, /custom css/iu, /stylesheet/iu, /embed/iu, /pixel/iu, /per-page theme/iu]) await expect(chosenFields.getByLabel(forbidden)).toHaveCount(0);
  await expect(chosenFields.getByText("Presentation is limited to the options a section offers; a page has no styles of its own.", { exact: true })).toBeVisible();
  const renderedPrayer = page.locator('[data-slot="page-preview-frame"]').locator("section.content-section").filter({ hasText: "A prayer for this term" });
  for (const style of [/content-layout-single-column/u, /content-treatment-normal/u]) await expect(renderedPrayer).toHaveClass(style);
  await chooseOption(chosenFields, "Two columns with image and text");
  await chooseOption(chosenFields, "Emphasized");
  await chosenFields.getByRole("button", { name: "Save this section", exact: true }).click();
  await expect(renderedPrayer, "the two-column layout an admitted layout choice sets reaches the rendered section").toHaveClass(/content-layout-two-column-image-text/u);
  await expect(renderedPrayer, "the emphasized treatment an admitted treatment choice sets reaches the rendered section").toHaveClass(/content-treatment-emphasized/u);
  await chooseOption(chosenFields, "Single column");
  await chooseOption(chosenFields, "Normal");
  await chosenFields.getByRole("button", { name: "Save this section", exact: true }).click();
  for (const style of [/content-layout-single-column/u, /content-treatment-normal/u]) await expect(renderedPrayer, "the defaults are what a section is rendered in again").toHaveClass(style);
  const pageRead = await jsonOf(await page.request.get(`/api/pages?view=page&documentId=${encodeURIComponent(PAGE_DOCUMENT)}`), "GET /api/pages view=page"); // --- an out-of-set presentation value is refused rather than styled -------------------------- The four choices are judged by the family's own transport, so the value is posted to the handler the field form posts to, presenting the scope and revision the Page read states.
  const composedScope = fieldAt(pageRead, "scope");
  if (!isRecord(composedScope)) throw new Error(`The Page read answered without the scope its sections are composed under, so no value could be submitted against it: ${JSON.stringify(pageRead).slice(0, 400)}`);
  const pageRevision = stringAt(pageRead, ["revision"], "The Page record's revision");
  const composedVariantId = stringAt(pageRead, ["data", "draft", "variantId"], "The composing edition's variant identity");
  const composedDraftRevision = stringAt(pageRead, ["data", "draft", "revisionId"], "The composing edition's draft revision");
  const outOfSet = await page.request.post("/api/pages/sections", {
    data: { operationId: newAttemptId(), scope: composedScope, expectedRevision: pageRevision, payload: { operation: "saveSectionFields", variantId: composedVariantId, sectionId: "section-0", presentation: { treatment: "normal", layout: "single-column", alignment: "justify", imageFit: "cover" } } }, // The exact preview renders the draft the save wrote to, so the sentence appearing there is the record's own statement that the text was written — not the form's echo of what was typed into it.
  });
  expect(outOfSet.status(), "an alignment outside the admitted set is refused as a request the caller has to correct").toBe(422);
  const refusal = await jsonOf(outOfSet, "POST /api/pages/sections presenting an out-of-set alignment");
  expect(fieldAt(refusal, "outcome"), "a value outside the admitted set is the closed outcome set's invalid, never a styled page").toBe("invalid");
  const alignmentMessages = fieldAt(refusal, "fields", "presentation.alignment");
  if (!Array.isArray(alignmentMessages) || alignmentMessages.length === 0) throw new Error(`The refusal named no field message for the alignment it refused, so the rule it broke could not be read: ${JSON.stringify(refusal).slice(0, 400)}`);
  expect(String(alignmentMessages[0]), "the field message names the alignment rule the submitted value broke").toMatch(/Choose an alignment/iu);
  const afterRefusal = await jsonOf(await page.request.get(`/api/pages?view=page&documentId=${encodeURIComponent(PAGE_DOCUMENT)}`), "GET /api/pages view=page after the refused value");
  expect(stringAt(afterRefusal, ["revision"], "The Page record's revision after the refusal"), "the refused value wrote nothing to the Page; The refusal left nothing behind: the same read states the same document revision and the same draft revision").toBe(pageRevision);
  expect(stringAt(afterRefusal, ["data", "draft", "revisionId"], "The composing edition's draft revision after the refusal"), "the refused value left the edition on the revision it was composing").toBe(composedDraftRevision);
  await addSection(page, "Image");
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Image", 3) })).toBeVisible();
  await expect(page.locator('[data-slot="section-outline-row"]')).toHaveCount(3);
  await selectSection(page, 3, "Image");
  const mediaFields = paneOf(page, "fields");
  await expect(mediaFields.getByLabel("Image fit", { exact: true })).toHaveValue("cover");
  expect(await mediaFields.getByLabel("Image fit", { exact: true }).locator("option").allInnerTexts()).toEqual(["Fill the frame", "Fit inside the frame"]);
  await mediaFields.getByRole("button", { name: "Add an image", exact: true }).click();
  const picker = page.locator('[data-slot="media-picker"][data-kind="image"]');
  await expect(picker).toBeVisible();
  await picker.locator('input[type="file"]').setInputFiles(fixturePathOf("poster.jpg"));
  await picker.getByRole("textbox", { name: "Alternative text", exact: true }).fill(IMAGE_ALT_TEXT);
  await picker.getByRole("button", { name: "Add this image", exact: true }).click();
  const registration = picker.locator('[data-slot="operation-result"]');
  await expect(registration, "The picker reports the attempt as the durable receipt it is, names the asset it registered, and states that preparation is local processing rather than production scanning").toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await expect(registration).toContainText(/asset-/u);
  await expect(picker.getByText("local processing; not production scanning or transcoding", { exact: true }).first()).toBeVisible();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  const mediaAfterRegistration = paneOf(page, "fields");
  await expect(mediaAfterRegistration, "The registration places the image in the section it was added from, so the section states the placement it now holds rather than an empty panel").toContainText("Placed in this section");
  await expect(mediaAfterRegistration).toContainText(IMAGE_ALT_TEXT);
  await expect(mediaAfterRegistration.getByRole("button", { name: "Add an image", exact: true })).toBeVisible();
  const placedImage = page.locator('[data-slot="page-preview-frame"]').locator("img").first();
  await expect(placedImage, "The exact preview renders the placement the image section now holds, so the media a reader meets is the media the record lists").toBeVisible();
  const displaySrc = await placedImage.getAttribute("src");
  expect(displaySrc ?? "", "the placed image is served from this application's own rendition route").toMatch(MEDIA_ROUTE);
  const imagePlacements = sectionOfType(await sectionsOfPage(page), "image").placements;
  expect(imagePlacements, "The Page read lists the one placement this registration wrote into the image section").toHaveLength(1);
  expect(fieldAt(imagePlacements[0], "kind")).toBe("image");
  expect(fieldAt(imagePlacements[0], "state")).toBe("ready");
  expect(fieldAt(imagePlacements[0], "sectionElement")).toBe("image");
  expect(fieldAt(imagePlacements[0], "altText")).toBe(IMAGE_ALT_TEXT);
  await openBuilder(page); // --- the reorder, from the keyboard alone --------------------------------------------------- A fresh read of the Page, so the order change presents the revision that now stands rather than one a write in flight has already replaced.
  const moveUpName = nameOfMove("up", "Image", 3);
  const moveUp = page.getByRole("button", { name: moveUpName });
  await expect(moveUp, "The ordering controls are buttons with accessible names that state the section and its position; no operation in this file drags anything, and the outline holds nothing draggable at all").toHaveAccessibleName(moveUpName);
  await expect(page.locator('[data-slot="section-outline"] [draggable="true"]')).toHaveCount(0);
  await expect(moveUp).not.toHaveAttribute("aria-disabled", "true"); // A move control states, before it can act, that the edition's context has not been read yet. The reorder therefore starts once that state is gone rather than on a guess about when the read lands.
  await moveUp.focus();
  await expect(moveUp).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-slot="section-outline-announcement"]')).toContainText("now stands at Position 2");
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Image", 2) })).toBeVisible();
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Prayer", 3) })).toBeVisible();
  await expect(page.getByRole("button", { name: nameOfMove("down", "Image", 2) })).toBeVisible();
  await expect(page.getByRole("button", { name: nameOfMove("up", "Image", 2) }), "The settled move puts focus back on the control the person pressed, in the row the section now occupies, so a keyboard user carries on from where they are rather than restarting the outline").toBeFocused();
  const moveUpAgain = page.getByRole("button", { name: nameOfMove("up", "Prayer", 3) }); // The section that took the position the move started from asks for the move that section just made: the payload is identical, and only the revision read since the first acceptance tells the two intents apart.
  await moveUpAgain.focus();
  await page.keyboard.press("Enter");
  const announcement = page.locator('[data-slot="section-outline-announcement"]');
  await expect(announcement.locator("bdi").first()).toHaveText("Prayer");
  await expect(announcement).toContainText("now stands at Position 2");
  await expect(announcement, "A second, different move is an operation of its own: it is never answered as a replay of the first").not.toContainText("already");
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Prayer", 2) })).toBeVisible();
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Image", 3) })).toBeVisible();
  await addSection(page, "Video"); // --- the video step: a real MP4 with a poster and a WebVTT caption track, placed and played ------------- The finding's record is that a Page's video section could never hold a placement at all, so the whole player is asserted here rather than only the receipt.
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Video", 4) })).toBeVisible();
  await selectSection(page, 4, "Video");
  const videoFields = paneOf(page, "fields");
  await videoFields.getByRole("button", { name: "Add a video", exact: true }).click();
  const videoPicker = page.locator('[data-slot="media-picker"][data-kind="video"]');
  await expect(videoPicker).toBeVisible();
  await chooseFile(videoPicker, VIDEO_FIXTURES.media);
  await videoPicker.getByLabel(/^Alternative text/u).fill(VIDEO_ALT_TEXT);
  await videoPicker.getByLabel(/^Caption(?! track)/u).fill(VIDEO_CAPTION);
  await videoPicker.getByLabel(/^Credit/u).fill(VIDEO_CREDIT);
  await videoPicker.getByLabel(/^Language/u).fill(VIDEO_LANGUAGE);
  await videoPicker.getByLabel(/^Transcript/u).fill(VIDEO_TRANSCRIPT);
  await videoPicker.getByLabel(/^Poster image/u).setInputFiles(fixturePathOf(VIDEO_FIXTURES.poster));
  await videoPicker.getByLabel(/^Caption track/u).setInputFiles(fixturePathOf(VIDEO_FIXTURES.captions));
  await videoPicker.getByLabel(/^Track label/u).fill(VIDEO_TRACK_LABEL);
  await videoPicker.getByRole("button", { name: "Add this video", exact: true }).click();
  await expect(videoPicker.locator('[data-slot="operation-result"]'), "the real MP4, its poster and its caption track are prepared and registered as one attempt").toHaveAttribute("data-outcome", "accepted", { timeout: PREPARATION_TIMEOUT_MS });
  await videoPicker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(videoPicker).toBeHidden();
  const videoFieldsAfterRegistration = paneOf(page, "fields");
  await expect(videoFieldsAfterRegistration, "the video section states the placement it now holds").toContainText("Placed in this section");
  await expect(videoFieldsAfterRegistration).toContainText(VIDEO_ALT_TEXT);
  const videoPlacements = sectionOfType(await sectionsOfPage(page), "video").placements;
  expect(videoPlacements, "The Page read lists the one placement the video registration wrote into the video section").toHaveLength(1);
  const videoPlacement = videoPlacements[0];
  expect(fieldAt(videoPlacement, "kind")).toBe("video");
  expect(fieldAt(videoPlacement, "state"), "a prepared video placement is ready, which is the state its player is offered in").toBe("ready");
  expect(fieldAt(videoPlacement, "sectionElement")).toBe("video");
  expect(arrayAt(videoPlacement, ["captionTracks"], "The placement's caption tracks")).toHaveLength(1);
  expect(fieldAt(videoPlacement, "captionTracks", "0", "language"), "the caption track carries the video's own language rather than the interface's").toBe(VIDEO_LANGUAGE);
  const renditionPurposes = arrayAt(videoPlacement, ["renditions"], "The placement's renditions").map((rendition) => fieldAt(rendition, "purpose"));
  for (const purpose of ["playback", "poster", "captions", "transcript"] as const) expect(renditionPurposes, `the placement carries its ${purpose} rendition`).toContain(purpose);
  const player = page.locator('[data-slot="page-preview-frame"]').locator("video").first();
  await expect(player, "The exact preview renders the video the section now holds, as the browser's own player rather than a reimplementation of one").toBeVisible();
  await expect(player).toHaveAttribute("controls", "");
  await expect(player).not.toHaveAttribute("autoplay", /.*/u);
  await expect(page.locator('[data-slot="page-preview-frame"] section.content-section').filter({ has: page.locator("video") }), "the player is composed into the video section's own frame rather than left at the end of the document").toHaveCount(1);
  const playbackSrc = await player.getAttribute("src");
  const posterSrc = await player.getAttribute("poster");
  expect(playbackSrc ?? "", "the player streams the placement's playback rendition from this application's own route").toMatch(MEDIA_ROUTE);
  expect(posterSrc ?? "", "the player's poster is the placement's poster rendition, served by the same route").toMatch(MEDIA_ROUTE);
  const captionTrack = player.locator('track[kind="captions"]');
  await expect(captionTrack).toHaveCount(1);
  await expect(captionTrack).toHaveAttribute("srclang", VIDEO_LANGUAGE);
  await expect(captionTrack, "the track is named by the label the person who placed it typed, not by its language tag").toHaveAttribute("label", VIDEO_TRACK_LABEL);
  const captionsSrc = await captionTrack.getAttribute("src");
  expect(captionsSrc ?? "", "the caption track is a rendition of this application, not a file on a public path").toMatch(MEDIA_ROUTE);
  const posterAnswer = await requestRendition(page, posterSrc ?? "");
  expect(posterAnswer.status, "the poster rendition is served to the contributor who placed it").toBe(200);
  expect(posterAnswer.contentType).toContain("image/jpeg");
  const captionsAnswer = await requestRendition(page, captionsSrc ?? "");
  expect(captionsAnswer.status, "the caption rendition is served to the contributor who placed it").toBe(200);
  expect(captionsAnswer.contentType).toContain("text/vtt");
  expect(captionsAnswer.body.trimStart().startsWith("WEBVTT"), "the caption track is WebVTT rather than any text that happened to be there").toBe(true);
});
test("the preview names the revision it renders, and that same revision is reviewed once and released", async ({ page }) => {
  await openBuilder(page);
  const revision = await previewRevisionOf(page);
  const preview = page.locator('[data-slot="page-preview-frame"]');
  await expect(preview).toContainText(revision);
  await expect(preview.getByText("This preview is exact and inert: it starts no payment, sends no mail, subscribes nobody and releases nothing.", { exact: true })).toBeVisible();
  await expect(preview.getByRole("button", { name: /pay|donate|checkout|give now|purchase|subscribe/iu }), "The preview shows the giving placement as a display only: no payment control, no field that takes money").toHaveCount(0);
  await expect(preview.locator('input[type="number"], input[name*="card" i], form[action*="checkout" i]')).toHaveCount(0);
  await expect(preview.getByText(GIVING_SIMULATION, { exact: true })).toBeVisible();
  await submitDraftForReview(page, ARABIC);
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "candidate");
  await page.goto(PAGES_INDEX);
  const reviewLink = page.getByRole("link", { name: reviewLinkName(ARABIC) });
  await expect(reviewLink).toBeVisible();
  await reviewLink.click();
  await expect(page.getByRole("heading", { name: "Page review", level: 1 })).toBeVisible();
  await expect(page.locator('[data-slot="page-review-surface"]')).toHaveAttribute("data-page-family", PAGE_FAMILY);
  const frozen = page.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen, "The frozen revision the reviewer answers is the revision the preview named, and approving it approves no other edition").toBeVisible();
  await expect(frozen).toContainText(revision);
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-decision"] [data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await expect(page.getByText("This candidate is answered, so its decision is fixed. Anything further comes from the author as a new submission with a new revision.", { exact: true })).toBeVisible();
  await openBuilder(page);
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "candidate"); // The builder states the edition's own pointers, so it reports the frozen candidate it still holds; the decision the reviewer gave it is the review surface's fact, and only a release reaches a reader.
  await releaseSelectedEditions(page, ARABIC);
  const controls = page.locator('[data-slot="release-controls"]');
  await expect(controls.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await expect(controls.locator('[data-slot="release-variant-results"] li[data-edition-state="released"]')).toHaveCount(1);
  await expect(controls.getByRole("button", { name: /notify|send/iu }), "A Page release sends no notice at all, so no sending control exists on this surface, and the one simulated effect it does have is labelled beside it").toHaveCount(0);
  await expect(controls.getByText("simulated publication; reach is demonstrated in the receiving preview", { exact: true }).first()).toBeVisible();
  expect(await previewRevisionOf(page), "The release published the very revision the preview named: the preview still names it, the Page now states two published editions, and the edition that was released carries a reach to set").toBe(revision);
  await expect(controls).toContainText("Withdraw 2 released editions?");
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-reach-set", "true");
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "released");
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view-edition"]')).toBeVisible();
});
test("each reach value is stated in words and demonstrated at the discovery index and the direct address", async ({ page }) => {
  await openBuilder(page);
  await selectEdition(page, ENGLISH);
  const reach = page.locator('[data-slot="reach-control"]');
  await expect(reach).toHaveAttribute("data-current-reach", "listed");
  for (const words of [REACH.notPublic, REACH.linkPublic, REACH.listed]) await expect(reach.getByRole("radio", { name: words, exact: true })).toBeVisible();
  await page.goto(discoveryIndexPath());
  await expect(page.getByRole("heading", { name: "Pages listed publicly", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="discovery-edition"]')).toContainText(PAGE_TITLE);
  await expect(page.locator('[data-slot="discovery-edition"]')).toContainText(REACH.listed);
  await openBuilder(page);
  await selectEdition(page, ENGLISH);
  await setReachTo(page, REACH.linkPublic);
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-current-reach", "link-public");
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(0);
  await expect(page.getByText("Nothing is listed publicly yet", { exact: true })).toBeVisible();
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  const edition = page.locator('[data-slot="public-reading-view-edition"]');
  await expect(edition).toHaveAttribute("data-reach", "link-public");
  await expect(edition).toContainText(REACH.linkPublic);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
  await expect(page.locator('[data-slot="public-reading-view"]')).toContainText("Reading an edition changes nothing.");
  await openBuilder(page);
  await selectEdition(page, ENGLISH);
  await setReachTo(page, REACH.listed);
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
  await openBuilder(page);
  await selectEdition(page, ENGLISH);
  await setReachTo(page, REACH.notPublic);
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-current-reach", "not-public");
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view"][data-read-kind="denied"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "This address cannot be read", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(PAGE_TITLE);
});
test("Giving unavailable stands with no fallback fund, and containment hides every address without touching the draft", async ({ page }) => {
  await openBuilder(page);
  const giving = page.locator('[data-slot="giving-designation"][data-giving-state="unavailable"][data-layout="panel"]');
  await expect(giving, "The Page carries no approved designation, so the placement states *Giving unavailable*: no other fund, no default destination and no amount, rather than a zero or an empty figure").toBeVisible();
  await expect(giving.getByRole("heading", { name: "Giving unavailable", exact: true })).toBeVisible();
  await expect(giving).toContainText("No other fund and no default designation is used in its place, and no amount is shown.");
  await expect(giving).toContainText("Giving unavailable is stated in words: the page never shows a zero, an empty figure or a placeholder amount instead.");
  await expect(giving.getByText(GIVING_SIMULATION, { exact: true })).toBeVisible();
  await expect(giving.getByText("This preview shows where giving would go. It cannot start a payment.", { exact: true })).toBeVisible();
  await expect(giving.getByRole("button", { name: /pay|donate|give/iu })).toHaveCount(0);
  await expect(giving).not.toContainText(/[$€£¥]/u);
  const catalogue = page.locator('[data-slot="family-catalogue"]'); // The two sections a source owns are listed as read-only, so no worker-entered amount can be composed into a Page at all: a progress module appears only where the source qualifies one.
  for (const managed of [
    { sectionType: "giving", reason: "Managed by the giving designation approved for this page" },
    { sectionType: "progress", reason: "Managed by the received-support source" },
  ] as const) {
    const entry = catalogue.locator(`[data-section-type="${managed.sectionType}"]`);
    await expect(entry).toHaveAttribute("data-managed", "true");
    await expect(entry).toContainText("Read-only");
    await expect(entry).toContainText(managed.reason);
  }
  await selectEdition(page, ENGLISH); // The edition is listed publicly as the seed left it, so the index really does enumerate it before it is contained: the reach control states that recorded reach rather than this test setting it again.
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-current-reach", "listed");
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);
  await openBuilder(page);
  const stop = page.locator('[data-slot="stop-showing-publicly"]');
  await expect(stop).toHaveAttribute("data-state", "review");
  await expect(stop).toHaveAttribute("data-edition-count", "2");
  await stop.getByRole("button", { name: "Stop showing me publicly", exact: true }).click(); // Containment is a reach change, not an editorial one: it is offered while the Arabic edition still holds a draft that was never submitted, and nothing asks for that draft to be fixed first.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Stop showing this Page publicly?", exact: true })).toBeVisible();
  for (const value of ["This covers all 2 language editions of this Page.", "A copy someone already received, saved or shared stays where it is.", "A message already sent"]) await expect(dialog).toContainText(value);
  await dialog.getByRole("button", { name: "Stop showing me publicly", exact: true }).click();
  await expect(page.locator('[data-slot="stop-showing-publicly-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  for (const value of ["Every language edition is contained", "Stop showing publicly applies to all 2 language editions of this Page.", "This is a reach change and not an editorial one"]) await expect(page.locator('[data-slot="stop-showing-publicly-containment"]')).toContainText(value);
  const builder = builderOf(page);
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`), "Every edition is contained, and the draft that was never submitted is exactly as it was").toHaveAttribute("data-lifecycle-state", "withdrawn");
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "draft");
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(0);
  await expect(page.getByText("Nothing is listed publicly yet", { exact: true })).toBeVisible();
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view-withdrawn"]')).toBeVisible();
  await expect(page.getByText("This page is no longer available.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(PAGE_TITLE);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
});
test("a public edition serves what it published while its draft stays shut, and a release whose acknowledgement was lost recovers exactly once", async ({ page }) => {
  await page.goto(readingPath(PAGE_DOCUMENT, ARABIC)); // A language this Page publishes nothing in is not served from its draft: the Arabic edition holds a saved draft and no release, so no address may render that draft in its place.
  await expect(page.locator('[data-slot="public-reading-view-language-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(ARABIC_DRAFT_PROSE);
  await actAs(page, "reader-unauthorized"); // A reader holding no grant of any kind asks for the same Page. A listed public edition is public, so this reader is served it — that is the public reading experience, and what it must never become is a route to the draft, to another edition, or to a record the published world does not hold.
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  const publicEdition = page.locator('[data-slot="public-reading-view-edition"]');
  await expect(publicEdition).toBeVisible();
  await expect(publicEdition).toContainText(PAGE_TITLE);
  await expect(page.locator('[data-slot="public-reading-view"]')).toContainText("Reading an edition changes nothing.");
  await expect(page.locator('[data-slot="public-reading-view"]')).toContainText("Access is checked again every time this edition is opened");
  await page.goto(readingPath(PAGE_DOCUMENT, ARABIC));
  await expect(page.locator('[data-slot="public-reading-view-language-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(ARABIC_DRAFT_PROSE);
  await page.goto("/preview/pages/doc-page-not-in-this-scope/en"); // An address naming a Page the published world does not hold is refused, and the refusal is the same whether or not such a Page exists: it carries no title, no prose and no existence hint.
  await expect(page.locator('[data-slot="public-reading-view"][data-read-kind="denied"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "This address cannot be read", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(PAGE_TITLE);
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(ARABIC_DRAFT_PROSE);
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);
  await actAs(page, "established-worker");
  await openBuilder(page);
  await submitDraftForReview(page, ARABIC);
  await page.goto(PAGES_INDEX);
  const reviewLink = page.getByRole("link", { name: reviewLinkName(ARABIC) });
  const reviewHref = (await reviewLink.getAttribute("href")) ?? "";
  const candidateId = decodeURIComponent(reviewHref.slice(reviewHref.lastIndexOf("/") + 1));
  if (candidateId === "") throw new Error(`The review entry held no candidate identity in its address (${reviewHref}), so the release could not name the candidate it publishes.`);
  await reviewLink.click();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-decision"] [data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await openBuilder(page);
  const controls = page.locator('[data-slot="release-controls"]');
  await expect(controls).toContainText("Withdraw 1 released edition?");
  await armLostReleaseAcknowledgement(page);
  await page.getByRole("checkbox", { name: `Language ${ARABIC}` }).check();
  const releaseStep = controls.locator('[data-slot="action-review"]').filter({ has: page.getByRole("heading", { name: "Release this edition", exact: true }) });
  // The answer to the release is awaited before the same operation is replayed: the replay below asks the application what this attempt did, so it is only a recovery once this attempt has been answered. A replay that reached the service ahead of the click's own request would be the attempt itself, would earn the armed lost acknowledgement in its place, and would leave the recovery asserting an uncertainty that belongs to the request it was sent to follow.
  const releaseAnswer = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/api/pages/release" && answer.request().method() === "POST", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await releaseStep.getByRole("button", { name: "Release this edition", exact: true }).click();
  const operationId = (await releaseStep.getAttribute("data-operation-id")) ?? "";
  if (operationId === "") throw new Error("The release step stated no operation identity, so the attempt could not be replayed as the same work.");
  const lostAcknowledgement = await releaseAnswer;
  expect(lostAcknowledgement.status(), "The release whose acknowledgement is lost answers 202: the effect is stored and no outcome is claimed over the wire").toBe(202);
  const lostBody = await jsonOf(lostAcknowledgement, "POST /api/pages/release losing its acknowledgement");
  expect(fieldAt(lostBody, "outcome")).toBe("unknown");
  expect(fieldAt(lostBody, "operationId")).toBe(operationId);
  const publishedPage = await jsonOf(await page.request.get(`/api/pages?view=page&documentId=${encodeURIComponent(PAGE_DOCUMENT)}`), "GET /api/pages view=page"); // The acknowledgement never arrived, so the step claims nothing either way: the attempt is followed by a re-read, which returns the release step to its review state with no result beside it. What the attempt did is on the record, and that is where the recovery reads it from — the same operation, not a new one.
  const scope = fieldAt(publishedPage, "scope");
  if (!isRecord(scope)) throw new Error(`The Page read answered without the scope it ran under, so no attempt could be replayed: ${JSON.stringify(publishedPage).slice(0, 400)}`);
  const pageRevision = stringAt(publishedPage, ["revision"], "The Page record's revision");
  const replay = await jsonOf(await page.request.post("/api/pages/release", { data: { operationId, scope, expectedRevision: pageRevision, payload: { operation: "publishVariants", documentId: PAGE_DOCUMENT, candidateIds: [candidateId] } } }), "POST /api/pages/release replaying the lost acknowledgement");
  expect(fieldAt(replay, "outcome")).toBe("alreadyAccepted");
  const items = fieldAt(replay, "items");
  if (!Array.isArray(items)) throw new Error(`The replayed attempt answered without the per-edition results it stored: ${JSON.stringify(replay).slice(0, 400)}`);
  expect(items).toHaveLength(1);
  expect(fieldAt(items[0], "state")).toBe("released");
  await openBuilder(page);
  const published = page.locator('[data-slot="release-controls"]');
  await expect(published).toContainText("Withdraw 2 released editions?");
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-reach-set", "true");
  await page.getByRole("checkbox", { name: `Language ${ARABIC}` }).check();
  const publishStep = published.locator('[data-slot="action-review"]').filter({ has: page.getByRole("heading", { name: "Release this edition", exact: true }) });
  await expect(publishStep.getByRole("button", { name: "Release this edition", exact: true }), "an edition that publishes this revision already holds no frozen candidate, so the step cannot be confirmed").toBeDisabled();
  await expect(publishStep).toContainText("Excluded before this step");
  await expect(publishStep).toContainText("Nothing is selected, so this step has nothing to apply");
  await expect(published.locator(`[data-slot="release-edition"][data-lifecycle-state="released"]`).filter({ has: page.getByRole("checkbox", { name: `Language ${ARABIC}` }) })).toHaveCount(1);
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view-edition"]')).toBeVisible();
  await clearFailurePlan(page.request);
});
test("a Project Page is composed from its own catalogue, reviewed and released, and then reads as published", async ({ page }) => {
  await page.goto(PAGES_INDEX);
  await expect(page.getByRole("heading", { name: "Your Pages", exact: true })).toBeVisible();
  await expect(page.locator(`[data-slot="pages-index-row"][data-family="${PAGE_FAMILY}"]`), "Both families the criterion names hold a Page, and each row states the family it belongs to").toHaveCount(1);
  await expect(page.locator(`[data-slot="pages-index-row"][data-family="${PROJECT_PAGE_FAMILY}"]`)).toHaveCount(1);
  await openProjectBuilder(page);
  const builder = builderOf(page);
  await expect(builder).toHaveAttribute("data-locale", ENGLISH);
  await expect(builder.locator('[data-slot="locale-edition"]'), "Its one edition is a saved draft nobody has submitted: no candidate stands, so no review has been asked for").toHaveCount(1);
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "draft");
  await expect(page.locator('[data-slot="section-outline-row"]'), "The outline holds the section the seeded revision composed, and the catalogue beside it is this family's own").toHaveCount(1);
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Milestone", 1) })).toBeVisible();
  const catalogue = page.locator('[data-slot="family-catalogue"]');
  await expect(catalogue).toHaveAttribute("data-family", PROJECT_PAGE_FAMILY);
  for (const sectionType of ADMITTED_SECTION_TYPES) await expect(catalogue.getByRole("heading", { name: sectionType, exact: true })).toBeVisible();
  await addSection(page, "Introduction");
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Introduction", 2) }), "The read is the evidence the write happened: the outline lists the section it just composed").toBeVisible();
  await expect(page.locator('[data-slot="section-outline-row"]')).toHaveCount(2);
  await selectSection(page, 2, "Introduction");
  const fields = paneOf(page, "fields");
  await expect(fields.getByRole("heading", { name: "Introduction — Section fields", exact: true })).toBeVisible();
  await fields.getByLabel("Heading", { exact: true }).fill(PROJECT_SECTION_HEADING);
  await fields.getByLabel("Body", { exact: true }).fill(PROJECT_SECTION_BODY);
  await fields.getByRole("button", { name: "Save this section", exact: true }).click();
  await expect(paneOf(page, "preview"), "The exact preview renders the draft the save wrote to, so the sentence appearing there is the record's own statement that the text was written rather than the form's echo of what was typed into it").toContainText(PROJECT_SECTION_HEADING);
  await expect(paneOf(page, "preview")).toContainText(PROJECT_SECTION_BODY);
  const revision = await previewRevisionOf(page);
  await submitDraftForReview(page, ENGLISH);
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "candidate");
  await page.goto(PAGES_INDEX);
  const reviewLink = page.getByRole("link", { name: reviewLinkName(ENGLISH) });
  await expect(reviewLink).toBeVisible();
  await reviewLink.click();
  await expect(page.getByRole("heading", { name: "Page review", level: 1 })).toBeVisible();
  await expect(page.locator('[data-slot="page-review-surface"]'), "The review surface states the family of the Page it answers, and the revision it froze is the one on screen").toHaveAttribute("data-page-family", PROJECT_PAGE_FAMILY);
  await expect(page.locator('[data-slot="review-frozen-revision"]')).toContainText(revision);
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-decision"] [data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await openProjectBuilder(page);
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "candidate");
  await releaseSelectedEditions(page, ENGLISH);
  const controls = page.locator('[data-slot="release-controls"]');
  await expect(controls.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: WRITE_RECEIPT_TIMEOUT_MS });
  await expect(controls.locator('[data-slot="release-variant-results"] li[data-edition-state="released"]')).toHaveCount(1);
  expect(await previewRevisionOf(page), "The release published the very revision the preview named, and the preview still names it").toBe(revision);
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "released"); // --- the author state the release leaves, on both author surfaces ---------------------------- The edition states the publication it now has rather than the submission it came from, because the release published exactly the revision its frozen candidate named.
  await expect(builderOf(page), "no author surface still calls this edition a submission").not.toContainText("Submitted for review");
  await page.goto(PAGES_INDEX);
  const listedRow = page.locator(`[data-slot="pages-index-row"][data-document-id="${PROJECT_PAGE_DOCUMENT}"]`);
  const listedEdition = listedRow.locator(`[data-slot="pages-index-edition"][data-locale="${ENGLISH}"]`);
  await expect(listedEdition).toHaveAttribute("data-lifecycle", "released");
  await expect(listedEdition.locator('[data-slot="draft-status"]')).toHaveAttribute("data-lifecycle-state", "released");
  await expect(listedEdition).toContainText("Published");
  await expect(listedEdition, "The reach word belongs to the release that reaches readers now, so it stands beside the lifecycle").toContainText(ANY_REACH_WORD);
  await expect(listedRow.locator('[data-slot="pages-index-review"]'), "No review entry remains for the edition, and nothing on its row still calls it a submission").toHaveCount(0);
  await expect(listedRow, "the index row states the publication the release produced, not the submission it came from").not.toContainText("Submitted for review");
});
test("every reach press and the withdrawal that follow the Page's own accepted writes are accepted in one page load", async ({ page }) => {
  await openBuilder(page); // One page load carries every write below: the builder is never navigated away from, so each press presents the record the previous acceptance left rather than the revision this view was first handed.
  await addSection(page, "Prayer"); // The Page's own accepted write, made before any reach change, so the presses that follow act on a record that has moved on since this view was handed its first revision.
  await selectEdition(page, ENGLISH);
  await setReachTo(page, REACH.linkPublic);
  await setReachTo(page, REACH.listed); // A second change made without reloading: the reach a press presents is the one the acceptance before it produced, and `accepted` here states that a conflict nobody caused is not shown.
  const englishRow = page.locator('[data-slot="release-edition"]').filter({ has: page.getByRole("checkbox", { name: `Language ${ENGLISH}` }) });
  await englishRow.getByRole("button", { name: "Withdraw this language edition", exact: true }).click();
  const step = page.locator('[data-slot="release-edition-step"][data-step="withdraw"]');
  await expect(step).toBeVisible();
  await step.getByRole("button", { name: "Withdraw this language edition", exact: true }).click(); // A withdrawal is consequential, so the step states what it does before it applies it.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Withdraw this language edition", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Withdraw this language edition", exact: true }).click();
  await expect(step.locator('[data-slot="action-review-result"]'), "The withdrawal validates the Page's own record, so its first press presents the revision the accepted changes produced rather than a conflict attributed to someone else").toHaveAttribute("data-outcome", "accepted");
  await expect(
    page.locator('[data-slot="release-edition"][data-lifecycle-state="withdrawn"]').filter({ has: page.getByRole("checkbox", { name: `Language ${ENGLISH}` }) }),
    "The withdrawal the press was accepted for is the one the re-read states: this edition is withdrawn and its sibling keeps its own release",
  ).toHaveCount(1);
});
