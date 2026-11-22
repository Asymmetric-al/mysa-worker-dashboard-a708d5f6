/**
 * Criterion 12 — Worker and Project pages.
 *
 * One contributor composes a Page from the sections its family catalogue admits, reorders them with the
 * keyboard alone, previews the exact revision that is on screen, sends it through its one review step,
 * releases that same revision, states how far it reaches, and then stops showing it publicly — all through
 * the real application, from a freshly reset seed.
 *
 * **The scenario this file drives.** The deterministic seed lays one Worker Page (`doc-page-harbour-youth`)
 * down for the established worker: an English edition released and listed publicly, and an Arabic edition
 * holding nothing but a saved draft that was never submitted for review. The Page carries no approved
 * giving designation, which is what makes *Giving unavailable* reachable rather than a branch nobody can
 * see. A Project Page document is not seeded and the application deliberately offers no way to invent one
 * (`createVariant` resolves the document it edits and never creates one), so the second family is asserted
 * where it really is reachable — its catalogue on the Pages index, which lists all eight admitted section
 * types and the bounded presentation choices each one admits — and the composition assertions are made on
 * the one Page the seed holds. Both facts are stated rather than papered over, because a criterion that
 * claimed to compose a Project Page would be claiming a journey the application has no route for.
 *
 * **What each test proves, and against which surface.** The composition test drives the builder's own
 * outline, field form, catalogue and media picker. The release test drives the builder's release controls
 * and the Pages family's one review route, and it compares the revision identity the preview named with
 * the revision the release published. The reach test drives the reach control and then both public
 * addresses the application really serves — the discovery index at `/preview/pages` and the direct reading
 * view at `/preview/pages/[pageId]/[locale]` — so a reach value is demonstrated by what the application
 * serves rather than asserted from the control that set it. The containment test drives
 * `Stop showing me publicly` while a sibling draft that was never submitted still stands, and asserts that
 * every address answers a tombstone afterwards. The access test asks for a published address, for the
 * language the Page only drafts, and for an address naming no Page the published world holds — all as a
 * reader with no grant — and then proves the lost-acknowledgement recovery of a release: the
 * acknowledgement is withheld, the step claims nothing either way, and replaying the identity that step
 * minted returns the stored result instead of publishing a second time.
 *
 * **What is reused rather than rebuilt.** The page builder, the section outline's own move controls, the
 * media picker, the shared review panel, the exact preview renderer and the receiving surfaces. This file
 * composes no control, mints no record and derives no reach, revision or lifecycle value: every value it
 * compares is one the application stated, captured from the screen that stated it.
 *
 * **What it never does.** No drag: every reorder is the move control activated from the keyboard, and the
 * outline is asserted to hold no draggable element at all. No fixed wait: every assertion is a web-first
 * expectation on a role, an accessible name or a stated word. No snapshot, no `.data/` read, and no
 * shortcut around a surface the application offers.
 */
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { resetSeed, SESSION_COOKIE } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded world this file acts in
// ---------------------------------------------------------------------------------------------

/** The one Page the deterministic seed lays down, and the Worker Page family it belongs to. */
const PAGE_DOCUMENT = "doc-page-harbour-youth";
const PAGE_FAMILY = "worker-page";
const PAGE_FAMILY_LABEL = "Worker Page";
const PAGE_TITLE = "Harbour Youth";

/** The two language editions the Page carries, in the order the switcher lists them. */
const ENGLISH = "en";
const ARABIC = "ar";

/**
 * The Arabic draft's own prose, captured from the seeded revision.
 *
 * The access test asks for a language the Page publishes nothing in, and asserts that not one word of this
 * draft is served in its place: a draft is not a release, so no address may fall through to it.
 */
const ARABIC_DRAFT_PROSE = "أمسيات الجمعة";

/** The eight section types the family catalogues admit, in the words the catalogue states for them. */
const ADMITTED_SECTION_TYPES = ["Introduction", "Story", "Prayer", "Milestone", "Image", "Video", "Giving", "Support progress"] as const;

/**
 * The reach vocabulary, exactly as the three values are worded on the control, the reading view and the
 * index. `link-public` says *Shared by link: public*, which is the form that states reach in words rather
 * than by colour or by an icon.
 */
const REACH = { notPublic: "Not public", linkPublic: "Shared by link: public", listed: "Listed publicly" } as const;

/** The word the shared receipt states for an accepted attempt; every other outcome is read from the receipt's own `data-outcome`. */
const RECEIPT_SAVED = "Saved";

/** The sentence the one simulation label for a giving placement states, and the one a release states. */
const GIVING_SIMULATION = "simulated giving destination; no payment is taken";
const REACH_SIMULATION = "simulated publication; reach is demonstrated in the receiving preview";

/** The tombstone sentence a withdrawn edition's address answers with. */
const TOMBSTONE = "This page is no longer available.";

/** Where each surface lives. The Page's own addresses are the application's, composed here the way a link would be. */
const PAGES_INDEX = "/pages";
const builderPath = (documentId: string): string => `/pages/${encodeURIComponent(documentId)}`;
const discoveryIndexPath = (): string => "/preview/pages";
const readingPath = (documentId: string, locale: string): string => `/preview/pages/${encodeURIComponent(documentId)}/${encodeURIComponent(locale)}`;

// ---------------------------------------------------------------------------------------------
// Small helpers over the application's own JSON, used only to read a development control's answer
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The answer as a value, or `undefined` for a body that is not JSON. */
function parsed(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
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

/** A string a capture depends on, refusing an absent or blank one rather than comparing nothing. */
function stringAt(value: unknown, path: readonly string[], what: string): string {
  const found = fieldAt(value, ...path);
  if (typeof found !== "string" || found.trim() === "") {
    throw new Error(`${what} is not at ${path.join(".")} of the answer this file read, so the assertion would have compared nothing: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** The identifier a caller mints for one attempt: the identity every replay of that attempt is recognised by. */
function newAttemptId(): string {
  return crypto.randomUUID();
}

/** One answer, parsed, with the request that produced it named so a failure states what failed. */
async function jsonOf(response: { readonly text: () => Promise<string> }, label: string): Promise<unknown> {
  const text = await response.text();
  const body = parsed(text);
  if (body === undefined) {
    throw new Error(`${label} did not answer with JSON: ${text.slice(0, 400)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------------------------
// The development controls: the one armed failure this file uses
// ---------------------------------------------------------------------------------------------

/** What this session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: Record<string, unknown>;
  readonly revision: string;
}

/**
 * Reads this session's development state.
 *
 * Every control presents the scope and the revision it read, exactly as the runner's own reset does,
 * because the service re-authorises the scope and answers `conflict` for a revision that no longer stands.
 */
async function readDevState(page: Page): Promise<DevState> {
  const body = await jsonOf(await page.request.get("/api/dev"), "GET /api/dev");
  const scope = fieldAt(body, "scope");
  if (!isRecord(scope)) {
    throw new Error(`GET /api/dev answered without the scope a development control runs under: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { scope, revision: stringAt(body, ["revision"], "The development state's revision") };
}

/** Operates exactly one named development control and returns the outcome it answered with. */
async function operateDevControl(page: Page, action: string, payload: Record<string, unknown>): Promise<void> {
  const state = await readDevState(page);
  const answer = await page.request.post("/api/dev", { data: { action, operationId: newAttemptId(), scope: state.scope, expectedRevision: state.revision, payload } });
  const body = await jsonOf(answer, `POST /api/dev ${action}`);
  const outcome = fieldAt(body, "outcome");
  if (outcome !== "accepted" && outcome !== "unchanged" && outcome !== "alreadyAccepted") {
    throw new Error(`The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A spec that could not arm the failure it names would assert against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`);
  }
}

/**
 * Withholds the acknowledgement of a Page release.
 *
 * The effect and its ledger entry are stored and only the response is withheld, so the attempt leaves
 * exactly one release behind: that is what makes the recovery the test then performs a recovery rather
 * than a second publication.
 */
async function armLostReleaseAcknowledgement(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { mode: "unknown", target: { kind: "mutation", name: "publishVariants" } });
}

/** Disarms whatever failure stands armed: a plan lives in the session document until something clears it. */
async function clearFailurePlan(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { plan: null });
}

// ---------------------------------------------------------------------------------------------
// Reading the Page surfaces the way a person does
// ---------------------------------------------------------------------------------------------

/** The builder's own region, which every composition assertion is scoped to. */
function builderOf(page: Page) {
  return page.locator('[data-slot="page-builder"]');
}

/** Escapes the characters a regular expression would otherwise read as syntax. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The accessible name a composite control states: a label and a position, separated by a comma.
 *
 * The label and the position are separate inline elements, and an inline boundary is spoken as a space, so
 * the name a browser computes reads "Story , Position 1". The matcher tolerates that boundary, because the
 * words and their order are what the control states rather than the spacing between them.
 */
function nameOfLabelAtPosition(label: string, position: number): RegExp {
  return new RegExp(`^${escaped(label)}\\s*,\\s*Position ${String(position)}$`, "u");
}

/** The accessible name of one section's move control, which names the section and the position it stands at. */
function nameOfMove(direction: "up" | "down", label: string, position: number): RegExp {
  return new RegExp(`^Move ${direction} for ${escaped(label)}\\s*,\\s*Position ${String(position)}$`, "u");
}

/** The accessible name of one catalogue entry's add action, which names its type and the seat it will take. */
function nameOfCatalogueEntry(label: string): RegExp {
  return new RegExp(`^Add a section\\s*:\\s*${escaped(label)}\\s*,\\s*Position \\d+$`, "u");
}

/** The accessible name of the index row that opens this Page's builder. */
const BUILDER_LINK_NAME = new RegExp(`^${escaped(PAGE_TITLE)}\\s*,\\s*Open the ${escaped(PAGE_FAMILY_LABEL)} builder$`, "u");

/** The accessible name of the review entry one frozen candidate holds, which also names the edition it belongs to. */
function reviewLinkName(locale: string): RegExp {
  return new RegExp(`^Review this candidate\\s*,\\s*for the ${escaped(locale)} language edition$`, "u");
}

/** The three panes the builder shows on a wide screen, so an assertion names the pane it reads rather than the page. */
function paneOf(page: Page, pane: "outline" | "fields" | "preview") {
  return page.locator(`[data-pane="${pane}"]`);
}

/** Opens one Page's builder and waits for the builder itself, which carries the family and the open edition. */
async function openBuilder(page: Page): Promise<void> {
  await page.goto(builderPath(PAGE_DOCUMENT));
  await expect(builderOf(page)).toHaveAttribute("data-family", PAGE_FAMILY);
}

/**
 * The revision identity the preview states it is rendering.
 *
 * The preview names the exact revision it renders beside the language it renders it in, and that name is
 * the whole of what the release test compares: the release must publish the revision that was on screen.
 */
async function previewRevisionOf(page: Page): Promise<string> {
  const preview = page.locator('[data-slot="page-preview-frame"]');
  await expect(preview).toHaveAttribute("data-preview-status", "authorised");
  const stated = (await preview.locator("dd .mono-identifier").first().innerText()).trim();
  if (stated === "") {
    throw new Error("The preview stated no revision identity, so the release could not be compared with the revision it rendered.");
  }
  return stated;
}

/** Chooses a section in the outline by the name it is listed and positioned by. */
async function selectSection(page: Page, position: number, label: string): Promise<void> {
  const row = page.getByRole("button", { name: nameOfLabelAtPosition(label, position) });
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
}

/**
 * Adds one section of a catalogue type.
 *
 * The catalogue's own entry names the type and the seat it will take, so the click states which entry was
 * chosen; the review step that follows is the shared one, and its confirmation label is the catalogue's
 * one add action.
 */
async function addSection(page: Page, label: string): Promise<void> {
  const entry = page.getByRole("button", { name: nameOfCatalogueEntry(label) });
  await entry.click();
  const catalogue = page.locator('[data-slot="family-catalogue"]');
  await expect(catalogue.getByRole("heading", { name: `Add a section: ${label}`, exact: true })).toBeVisible();
  await catalogue.getByRole("button", { name: "Add a section", exact: true }).click();
  await expect(catalogue.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
}

/**
 * The absolute address of one committed media fixture.
 *
 * The picker is handed a real file, and the path is resolved upwards from the working directory because
 * the runner may be started from either the repository root or the application package: the first
 * ancestor holding the fixture under `public/fixtures/media` is the one this returns.
 */
function fixturePathOf(name: string): string {
  const suffixes = [`apps/dashboard/public/fixtures/media/${name}`, `public/fixtures/media/${name}`];
  let directory = process.cwd();
  for (;;) {
    for (const suffix of suffixes) {
      const candidate = `${directory}/${suffix}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`No ancestor of ${process.cwd()} holds public/fixtures/media/${name}, so the media picker has no file to place.`);
    }
    directory = parent;
  }
}

/** Switches the builder to one language edition, through the one locale control the surface offers. */
async function selectEdition(page: Page, locale: string): Promise<void> {
  const switcher = page.locator('[data-slot="locale-switcher"]');
  await switcher.getByLabel("Language", { exact: true }).selectOption(locale);
  await expect(builderOf(page)).toHaveAttribute("data-locale", locale);
}

/** Sets reach to one of the three values and confirms the review the control opens. */
async function setReachTo(page: Page, words: string): Promise<void> {
  const reach = page.locator('[data-slot="reach-control"]');
  await reach.getByRole("radio", { name: words, exact: true }).click();
  await reach.getByRole("button", { name: "Save reach", exact: true }).click();
  await expect(reach.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await reach.getByRole("button", { name: "Done", exact: true }).click();
}

/** Submits the drafted edition for its one review step, from the row that edition holds. */
async function submitDraftForReview(page: Page, locale: string): Promise<void> {
  const row = page.locator(`[data-slot="release-edition"][data-lifecycle-state="draft"]`).filter({ has: page.getByRole("checkbox", { name: `Language ${locale}` }) });
  await row.getByRole("button", { name: "Submit for review", exact: true }).click();
  const step = page.locator('[data-slot="release-edition-step"][data-step="submit"]');
  await expect(step).toBeVisible();
  await step.getByRole("button", { name: "Submit for review", exact: true }).click();
  // The durable receipt states the outcome in words, which is the proof this submission is not a send.
  const receipt = step.locator('[data-slot="action-review-result"]');
  await expect(receipt).toHaveAttribute("data-outcome", "accepted");
  await expect(receipt.getByRole("heading", { name: RECEIPT_SAVED, exact: true })).toBeVisible();
}

/** Ticks one edition in the release list and submits the release step that follows. */
async function releaseSelectedEditions(page: Page, locale: string): Promise<void> {
  await page.getByRole("checkbox", { name: `Language ${locale}` }).check();
  await page.getByRole("button", { name: "Release this edition", exact: true }).click();
}

/** Puts one seeded session in the browser context's cookie jar, which is the whole of the identity a request is authorised as. */
async function actAs(context: BrowserContext, origin: string, sessionId: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, url: origin }]);
}

/** The origin the application is served from, taken from an answer the browser's own request context received. */
async function originOf(page: Page): Promise<string> {
  return new URL((await page.request.get("/api/session")).url()).origin;
}

// ---------------------------------------------------------------------------------------------
// 1. Both catalogues are admitted, and a Page is composed and reordered from the keyboard alone
// ---------------------------------------------------------------------------------------------

test("both family catalogues are admitted, and a Page is composed and reordered from the keyboard alone", async ({ page }) => {
  await page.goto(PAGES_INDEX);
  await expect(page.getByRole("heading", { name: "Your Pages", exact: true })).toBeVisible();

  // Both families are catalogues the worker is offered, and each lists the eight admitted section
  // types. This is the whole of what a Project Page can be shown to admit today: the family's
  // catalogue is real and reachable, while the seed holds no Project Page document to compose.
  for (const family of [
    { key: PAGE_FAMILY, label: PAGE_FAMILY_LABEL },
    { key: "project-page", label: "Project Page" },
  ] as const) {
    const catalogue = page.locator(`[data-slot="family-catalogue"][data-family="${family.key}"]`);
    await expect(catalogue.getByRole("heading", { name: `Sections for your ${family.label}`, exact: true })).toBeVisible();
    for (const sectionType of ADMITTED_SECTION_TYPES) {
      await expect(catalogue.getByRole("heading", { name: sectionType, exact: true })).toBeVisible();
    }
  }

  // The one Page the seed holds is reached from the index by its own link, not by typing an address.
  const openBuilderLink = page.getByRole("link", { name: BUILDER_LINK_NAME });
  await expect(openBuilderLink).toBeVisible();
  await openBuilderLink.click();

  const builder = builderOf(page);
  // The builder opens on the edition that holds the draft, and says so with the language it composes.
  await expect(builder).toHaveAttribute("data-locale", ARABIC);
  await expect(builder).toHaveAttribute("data-composing", "true");
  // The Development data label is present on the surface the whole journey runs on.
  await expect(page.getByText("Development data", { exact: true })).toBeVisible();

  // Each edition states its own lifecycle; one is published and one is a draft nobody has reviewed.
  await expect(builder.locator('[data-slot="locale-edition"]')).toHaveCount(2);
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "draft");

  // The outline is an ordered list of the sections a reader meets, and the draft holds one of them.
  await expect(page.getByRole("list", { name: "Sections", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="section-outline-row"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Story", 1) })).toBeVisible();

  // --- a text section, composed in the builder's own field form ------------------------------
  await addSection(page, "Prayer");
  // The read is the evidence the write happened: the outline lists the section it just composed.
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Prayer", 2) })).toBeVisible();
  await expect(page.locator('[data-slot="section-outline-row"]')).toHaveCount(2);
  await selectSection(page, 2, "Prayer");

  const fields = paneOf(page, "fields");
  await expect(fields.getByRole("heading", { name: "Prayer — Section fields", exact: true })).toBeVisible();
  await fields.getByLabel("Heading", { exact: true }).fill("A prayer for this term");
  await fields.getByLabel("Body", { exact: true }).fill("Give thanks for the six new faces who joined us, and pray for the leaders who welcome them each Friday.");
  await fields.getByRole("button", { name: "Save this section", exact: true }).click();
  // The exact preview renders the draft the save wrote to, so the sentence appearing there is the record's
  // own statement that the text was written — not the form's echo of what was typed into it.
  await expect(paneOf(page, "preview")).toContainText("A prayer for this term");
  await expect(paneOf(page, "preview")).toContainText("Give thanks for the six new faces who joined us");

  // The section exposes exactly the four bounded presentation choices, and nothing that could style a page.
  const chosenFields = paneOf(page, "fields");
  await expect(chosenFields.getByRole("radio")).toHaveCount(4);
  for (const option of ["Normal", "Emphasized", "Single column", "Two columns with image and text"]) {
    await expect(chosenFields.getByRole("radio", { name: option, exact: true })).toBeVisible();
  }
  await expect(chosenFields.getByLabel("Alignment", { exact: true })).toHaveValue("start");
  expect(await chosenFields.getByLabel("Alignment", { exact: true }).locator("option").allInnerTexts()).toEqual(["Start", "Center"]);
  // A section that places no media offers no image fit: the choice belongs to the media the section shows.
  await expect(chosenFields.getByLabel("Image fit", { exact: true })).toHaveCount(0);
  for (const forbidden of [/raw html/iu, /custom css/iu, /stylesheet/iu, /embed/iu, /pixel/iu, /per-page theme/iu]) {
    await expect(chosenFields.getByLabel(forbidden)).toHaveCount(0);
  }
  await expect(chosenFields.getByText("Presentation is limited to the options a section offers; a page has no styles of its own.", { exact: true })).toBeVisible();

  // --- a media section, with an image prepared through the one media picker -------------------
  await addSection(page, "Image");
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Image", 3) })).toBeVisible();
  await expect(page.locator('[data-slot="section-outline-row"]')).toHaveCount(3);
  await selectSection(page, 3, "Image");
  const mediaFields = paneOf(page, "fields");
  // A section that shows media offers the image-fit choice, and exactly the two admitted fits.
  await expect(mediaFields.getByLabel("Image fit", { exact: true })).toHaveValue("cover");
  expect(await mediaFields.getByLabel("Image fit", { exact: true }).locator("option").allInnerTexts()).toEqual(["Fill the frame", "Fit inside the frame"]);

  await mediaFields.getByRole("button", { name: "Add an image", exact: true }).click();
  const picker = page.locator('[data-slot="media-picker"][data-kind="image"]');
  await expect(picker).toBeVisible();
  await picker.locator('input[type="file"]').setInputFiles(fixturePathOf("poster.jpg"));
  // The dialog marks alternative text as required, so its label carries a required marker the label-text
  // matcher would have to guess at; the control is addressed by the name a reader actually hears.
  await picker.getByRole("textbox", { name: "Alternative text", exact: true }).fill("The youth group gathered in the church hall after a Friday meal.");
  await picker.getByRole("button", { name: "Add this image", exact: true }).click();
  // The picker reports the attempt as the durable receipt it is, names the asset it registered, and states
  // that preparation is local processing rather than production scanning.
  const registration = picker.locator('[data-slot="operation-result"]');
  await expect(registration).toHaveAttribute("data-outcome", "accepted");
  await expect(registration).toContainText(/asset-/u);
  await expect(picker.getByText("local processing; not production scanning or transcoding", { exact: true }).first()).toBeVisible();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  // Attaching a registered asset to a section's placement is a separate write this surface does not offer,
  // so the section states its own placement honestly instead of showing a file it has not placed.
  const mediaAfterRegistration = paneOf(page, "fields");
  await expect(mediaAfterRegistration).toContainText("No media is placed in this section yet.");
  await expect(mediaAfterRegistration.getByRole("button", { name: "Add an image", exact: true })).toBeVisible();

  // --- the reorder, from the keyboard alone ---------------------------------------------------
  // A fresh read of the Page, so the order change presents the revision that now stands rather than one a
  // write in flight has already replaced.
  await openBuilder(page);
  const moveUpName = nameOfMove("up", "Image", 3);
  const moveUp = page.getByRole("button", { name: moveUpName });
  // The ordering controls are buttons with accessible names that state the section and its position; no
  // operation in this file drags anything, and the outline holds nothing draggable at all.
  await expect(moveUp).toHaveAccessibleName(moveUpName);
  await expect(page.locator('[data-slot="section-outline"] [draggable="true"]')).toHaveCount(0);
  // A move control states, before it can act, that the edition's context has not been read yet. The reorder
  // therefore starts once that state is gone rather than on a guess about when the read lands.
  await expect(moveUp).not.toHaveAttribute("aria-disabled", "true");
  await moveUp.focus();
  await expect(moveUp).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-slot="section-outline-announcement"]')).toContainText("now stands at Position 2");
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Image", 2) })).toBeVisible();
  await expect(page.getByRole("button", { name: nameOfLabelAtPosition("Prayer", 3) })).toBeVisible();
  await expect(page.getByRole("button", { name: nameOfMove("down", "Image", 2) })).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// 2. The preview names the revision it renders, and that same revision is reviewed and released
// ---------------------------------------------------------------------------------------------

test("the preview names the revision it renders, and that same revision is reviewed once and released", async ({ page }) => {
  await openBuilder(page);
  const revision = await previewRevisionOf(page);
  const preview = page.locator('[data-slot="page-preview-frame"]');
  await expect(preview).toContainText(revision);
  await expect(preview.getByText("This preview is exact and inert: it starts no payment, sends no mail, subscribes nobody and releases nothing.", { exact: true })).toBeVisible();
  // The preview shows the giving placement as a display only: no payment control, no field that takes money.
  await expect(preview.getByRole("button", { name: /pay|donate|checkout|give now|purchase|subscribe/iu })).toHaveCount(0);
  await expect(preview.locator('input[type="number"], input[name*="card" i], form[action*="checkout" i]')).toHaveCount(0);
  await expect(preview.getByText(GIVING_SIMULATION, { exact: true })).toBeVisible();

  // --- the one review step --------------------------------------------------------------------
  await submitDraftForReview(page, ARABIC);
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "candidate");

  await page.goto(PAGES_INDEX);
  const reviewLink = page.getByRole("link", { name: reviewLinkName(ARABIC) });
  await expect(reviewLink).toBeVisible();
  await reviewLink.click();

  await expect(page.getByRole("heading", { name: "Page review", level: 1 })).toBeVisible();
  await expect(page.locator('[data-slot="page-review-surface"]')).toHaveAttribute("data-page-family", PAGE_FAMILY);
  // The frozen revision the reviewer answers is the revision the preview named, and approving it approves
  // no other edition.
  const frozen = page.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen).toBeVisible();
  await expect(frozen).toContainText(revision);
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-decision"] [data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  await expect(page.getByText("This candidate is answered, so its decision is fixed. Anything further comes from the author as a new submission with a new revision.", { exact: true })).toBeVisible();

  // --- release the edition that was reviewed --------------------------------------------------
  await openBuilder(page);
  // The builder states the edition's own pointers, so it reports the frozen candidate it still holds; the
  // decision the reviewer gave it is the review surface's fact, and only a release reaches a reader.
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "candidate");
  await releaseSelectedEditions(page, ARABIC);

  const controls = page.locator('[data-slot="release-controls"]');
  await expect(controls.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  // Each edition reports its own result, and this attempt released exactly the edition it was asked to.
  await expect(controls.locator('[data-slot="release-variant-results"] li[data-edition-state="released"]')).toHaveCount(1);
  // A Page release sends no notice at all, so no sending control exists on this surface, and the one
  // simulated effect it does have is labelled beside it.
  await expect(controls.getByRole("button", { name: /notify|send/iu })).toHaveCount(0);
  await expect(controls.getByText(REACH_SIMULATION, { exact: true }).first()).toBeVisible();

  // The release published the very revision the preview named: the preview still names it, the Page now
  // states two published editions, and the edition that was released carries a reach to set.
  expect(await previewRevisionOf(page)).toBe(revision);
  await expect(controls).toContainText("Withdraw 2 released editions?");
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-reach-set", "true");

  // The release of one edition left the other edition's publication exactly as it was.
  await expect(builderOf(page).locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "released");
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view-edition"]')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// 3. The three reach values are stated in words and demonstrated at both public addresses
// ---------------------------------------------------------------------------------------------

test("each reach value is stated in words and demonstrated at the discovery index and the direct address", async ({ page }) => {
  await openBuilder(page);
  await selectEdition(page, ENGLISH);

  const reach = page.locator('[data-slot="reach-control"]');
  await expect(reach).toHaveAttribute("data-current-reach", "listed");
  // Reach is exactly three values, and each is named in words rather than shown by a colour or an icon.
  for (const words of [REACH.notPublic, REACH.linkPublic, REACH.listed]) {
    await expect(reach.getByRole("radio", { name: words, exact: true })).toBeVisible();
  }

  // Listed publicly: the discovery index enumerates the edition and the address is indexable.
  await page.goto(discoveryIndexPath());
  await expect(page.getByRole("heading", { name: "Pages listed publicly", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="discovery-edition"]')).toContainText(PAGE_TITLE);
  await expect(page.locator('[data-slot="discovery-edition"]')).toContainText(REACH.listed);

  // Shared by link: public — served at its own address, absent from the index, and asked not to be indexed.
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

  // Listed again: back in the index, and indexable once more.
  await openBuilder(page);
  await selectEdition(page, ENGLISH);
  await setReachTo(page, REACH.listed);
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);

  // Not public: no address serves the edition, and the refusal names no title.
  await openBuilder(page);
  await selectEdition(page, ENGLISH);
  await setReachTo(page, REACH.notPublic);
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-current-reach", "not-public");
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view"][data-read-kind="denied"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "This address cannot be read", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(PAGE_TITLE);
});

// ---------------------------------------------------------------------------------------------
// 4. Giving unavailable stands as it is, and containment hides every address without touching a draft
// ---------------------------------------------------------------------------------------------

test("Giving unavailable stands with no fallback fund, and containment hides every address without touching the draft", async ({ page }) => {
  await openBuilder(page);

  // The Page carries no approved designation, so the placement states *Giving unavailable*: no other fund,
  // no default destination and no amount, rather than a zero or an empty figure.
  const giving = page.locator('[data-slot="giving-designation"][data-giving-state="unavailable"][data-layout="panel"]');
  await expect(giving).toBeVisible();
  await expect(giving.getByRole("heading", { name: "Giving unavailable", exact: true })).toBeVisible();
  await expect(giving).toContainText("No other fund and no default designation is used in its place, and no amount is shown.");
  await expect(giving).toContainText("Giving unavailable is stated in words: the page never shows a zero, an empty figure or a placeholder amount instead.");
  await expect(giving.getByText(GIVING_SIMULATION, { exact: true })).toBeVisible();
  await expect(giving.getByText("This preview shows where giving would go. It cannot start a payment.", { exact: true })).toBeVisible();
  await expect(giving.getByRole("button", { name: /pay|donate|give/iu })).toHaveCount(0);
  await expect(giving).not.toContainText(/[$€£¥]/u);

  // The two sections a source owns are listed as read-only, so no worker-entered amount can be composed
  // into a Page at all: a progress module appears only where the source qualifies one.
  const catalogue = page.locator('[data-slot="family-catalogue"]');
  for (const managed of [
    { sectionType: "giving", reason: "Managed by the giving designation approved for this page" },
    { sectionType: "progress", reason: "Managed by the received-support source" },
  ] as const) {
    const entry = catalogue.locator(`[data-section-type="${managed.sectionType}"]`);
    await expect(entry).toHaveAttribute("data-managed", "true");
    await expect(entry).toContainText("Read-only");
    await expect(entry).toContainText(managed.reason);
  }

  // The edition is listed publicly as the seed left it, so the index really does enumerate it before it is
  // contained: the reach control states that recorded reach rather than this test setting it again.
  await selectEdition(page, ENGLISH);
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-current-reach", "listed");
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);

  // --- Stop showing me publicly --------------------------------------------------------------
  await openBuilder(page);
  const stop = page.locator('[data-slot="stop-showing-publicly"]');
  await expect(stop).toHaveAttribute("data-state", "review");
  await expect(stop).toHaveAttribute("data-edition-count", "2");
  // Containment is a reach change, not an editorial one: it is offered while the Arabic edition still
  // holds a draft that was never submitted, and nothing asks for that draft to be fixed first.
  await stop.getByRole("button", { name: "Stop showing me publicly", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Stop showing this Page publicly?", exact: true })).toBeVisible();
  await expect(dialog).toContainText("This covers all 2 language editions of this Page.");
  // Withdrawal stops this application serving the page; it recalls nothing already received or sent.
  await expect(dialog).toContainText("A copy someone already received, saved or shared stays where it is.");
  await expect(dialog).toContainText("A message already sent");
  await dialog.getByRole("button", { name: "Stop showing me publicly", exact: true }).click();

  await expect(page.locator('[data-slot="stop-showing-publicly-result"]')).toHaveAttribute("data-outcome", "accepted");
  const containment = page.locator('[data-slot="stop-showing-publicly-containment"]');
  await expect(containment).toContainText("Every language edition is contained");
  await expect(containment).toContainText("Stop showing publicly applies to all 2 language editions of this Page.");
  await expect(containment).toContainText("This is a reach change and not an editorial one");

  // Every edition is contained, and the draft that was never submitted is exactly as it was.
  const builder = builderOf(page);
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ENGLISH}"]`)).toHaveAttribute("data-lifecycle-state", "withdrawn");
  await expect(builder.locator(`[data-slot="locale-edition"][data-locale="${ARABIC}"]`)).toHaveAttribute("data-lifecycle-state", "draft");

  // The index leaves the edition out, and every address answers the tombstone — carrying no title.
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(0);
  await expect(page.getByText("Nothing is listed publicly yet", { exact: true })).toBeVisible();

  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view-withdrawn"]')).toBeVisible();
  await expect(page.getByText(TOMBSTONE, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(PAGE_TITLE);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
});

// ---------------------------------------------------------------------------------------------
// 5. Another reader is refused, and a release whose acknowledgement was lost recovers exactly once
// ---------------------------------------------------------------------------------------------

test("a public edition serves what it published while its draft stays shut, and a release whose acknowledgement was lost recovers exactly once", async ({ page, context }) => {
  // A language this Page publishes nothing in is not served from its draft: the Arabic edition holds a
  // saved draft and no release, so no address may render that draft in its place.
  await page.goto(readingPath(PAGE_DOCUMENT, ARABIC));
  await expect(page.locator('[data-slot="public-reading-view-language-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(ARABIC_DRAFT_PROSE);

  // A reader holding no grant of any kind asks for the same Page. A listed public edition is public, so
  // this reader is served it — that is the public reading experience, and what it must never become is a
  // route to the draft, to another edition, or to a record the published world does not hold.
  const origin = await originOf(page);
  await actAs(context, origin, "reader-unauthorized");
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  const publicEdition = page.locator('[data-slot="public-reading-view-edition"]');
  await expect(publicEdition).toBeVisible();
  await expect(publicEdition).toContainText(PAGE_TITLE);
  // The reading view states that access is rechecked on every open, and that reading changes nothing.
  await expect(page.locator('[data-slot="public-reading-view"]')).toContainText("Reading an edition changes nothing.");
  await expect(page.locator('[data-slot="public-reading-view"]')).toContainText("Access is checked again every time this edition is opened");

  // Switching the language in the address cannot fall through to the draft the Page also holds.
  await page.goto(readingPath(PAGE_DOCUMENT, ARABIC));
  await expect(page.locator('[data-slot="public-reading-view-language-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(ARABIC_DRAFT_PROSE);

  // An address naming a Page the published world does not hold is refused, and the refusal is the same
  // whether or not such a Page exists: it carries no title, no prose and no existence hint.
  await page.goto("/preview/pages/doc-page-not-in-this-scope/en");
  await expect(page.locator('[data-slot="public-reading-view"][data-read-kind="denied"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "This address cannot be read", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(PAGE_TITLE);
  await expect(page.locator('[data-slot="public-reading-view"]')).not.toContainText(ARABIC_DRAFT_PROSE);
  // The discovery index is the published world's own list, and it is the same list this reader is shown.
  await page.goto(discoveryIndexPath());
  await expect(page.locator('[data-slot="discovery-edition"]')).toHaveCount(1);
  await actAs(context, origin, "established-worker");

  // --- the same publication, with its acknowledgement withheld --------------------------------
  await openBuilder(page);
  await submitDraftForReview(page, ARABIC);
  await page.goto(PAGES_INDEX);
  const reviewLink = page.getByRole("link", { name: reviewLinkName(ARABIC) });
  const reviewHref = (await reviewLink.getAttribute("href")) ?? "";
  // The candidate this review answers is the identity its own address names; nothing here composes one.
  const candidateId = decodeURIComponent(reviewHref.slice(reviewHref.lastIndexOf("/") + 1));
  if (candidateId === "") {
    throw new Error(`The review entry held no candidate identity in its address (${reviewHref}), so the release could not name the candidate it publishes.`);
  }
  await reviewLink.click();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.locator('[data-slot="review-decision"] [data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  await openBuilder(page);
  const controls = page.locator('[data-slot="release-controls"]');
  // One edition is published before the attempt, and the Page states that count in its own words.
  await expect(controls).toContainText("Withdraw 1 released edition?");

  await armLostReleaseAcknowledgement(page);
  await page.getByRole("checkbox", { name: `Language ${ARABIC}` }).check();
  const releaseStep = controls.locator('[data-slot="action-review"]').filter({ has: page.getByRole("heading", { name: "Release this edition", exact: true }) });
  await releaseStep.getByRole("button", { name: "Release this edition", exact: true }).click();
  // The identity the surface minted for this one attempt: the operation a recovery replays.
  const operationId = (await releaseStep.getAttribute("data-operation-id")) ?? "";
  if (operationId === "") {
    throw new Error("The release step stated no operation identity, so the attempt could not be replayed as the same work.");
  }

  // The acknowledgement never arrived, so the step claims nothing either way: the attempt is followed by a
  // re-read, which returns the release step to its review state with no result beside it. What the attempt
  // did is on the record, and that is where the recovery reads it from — the same operation, not a new one.
  const publishedPage = await jsonOf(await page.request.get(`/api/pages?view=page&documentId=${encodeURIComponent(PAGE_DOCUMENT)}`), "GET /api/pages view=page");
  const scope = fieldAt(publishedPage, "scope");
  if (!isRecord(scope)) {
    throw new Error(`The Page read answered without the scope it ran under, so no attempt could be replayed: ${JSON.stringify(publishedPage).slice(0, 400)}`);
  }
  const pageRevision = stringAt(publishedPage, ["revision"], "The Page record's revision");
  const replay = await jsonOf(await page.request.post("/api/pages/release", { data: { operationId, scope, expectedRevision: pageRevision, payload: { operation: "publishVariants", documentId: PAGE_DOCUMENT, candidateIds: [candidateId] } } }), "POST /api/pages/release replaying the lost acknowledgement");
  expect(fieldAt(replay, "outcome")).toBe("alreadyAccepted");
  const items = fieldAt(replay, "items");
  if (!Array.isArray(items)) {
    throw new Error(`The replayed attempt answered without the per-edition results it stored: ${JSON.stringify(replay).slice(0, 400)}`);
  }
  // The stored result names exactly one edition, published — so the attempt produced one effect and the
  // recovery produced none.
  expect(items).toHaveLength(1);
  expect(fieldAt(items[0], "state")).toBe("released");

  // The Page now holds exactly two published editions: the seeded English one and this one, and the
  // edition this attempt released now carries a reach of its own to set.
  await openBuilder(page);
  const published = page.locator('[data-slot="release-controls"]');
  await expect(published).toContainText("Withdraw 2 released editions?");
  await expect(page.locator('[data-slot="reach-control"]')).toHaveAttribute("data-reach-set", "true");

  // A fresh attempt at the same work changes nothing: the edition already publishes exactly that revision.
  await page.getByRole("checkbox", { name: `Language ${ARABIC}` }).check();
  await page.getByRole("button", { name: "Release this edition", exact: true }).click();
  await expect(page.locator('[data-slot="release-controls"] [data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "unchanged");

  // The edition that was already published still serves, so the uncertain attempt took no other edition's
  // publication with it.
  await page.goto(readingPath(PAGE_DOCUMENT, ENGLISH));
  await expect(page.locator('[data-slot="public-reading-view-edition"]')).toBeVisible();
  await clearFailurePlan(page);
});
