/** Criterion 18 — video. */
import type { Locator, Page, Route } from "@playwright/test";
import { actAs, arrayAt, chooseFile, expect, fieldAt, fixturePathOf, isRecord, jsonOf, newAttemptId, numberAt, operateDevControl, outcomeOf, renditionAddressOf, requestRendition, scopeAt, SEEDED_PERSONAS, stringAt, test, type JsonRecord, type PersonaName } from "../playwright.config";
const CONTRIBUTOR_PERSONA: PersonaName = "established-worker"; // The contributor who composes the protected edition: the runner's own default persona, named here so the file states whose authority it acts under.
const OUTSIDE_WORKER_PERSONA: PersonaName = "second-worker"; // A worker in another ministry, whose scope shares nothing with this one: the persona every direct rendition request is refused for.
const OUTSIDE_READER_PERSONA: PersonaName = "reader-unauthorized"; // A reader holding no protected-reading grant: the persona the protected media and the protected prose are refused for.
const UPDATE_DOCUMENT = "doc-update-autumn";
const PROTECTED_VARIANT = "variant-update-autumn-en-approved-supporter";
const EDITOR_PATH = `/communication/${UPDATE_DOCUMENT}/${PROTECTED_VARIANT}`;
const PUBLIC_EDITIONS = ["variant-update-autumn-en-public", "variant-update-autumn-fr-public"] as const; // This Update's two public editions: withdrawing both leaves the protected edition as the only one the link can serve.
const PAGE_READING_PATH = "/preview/pages/doc-page-harbour-youth/en";
const UPDATE_READING_PATH = `/preview/${UPDATE_DOCUMENT}`;
const SEEDED_VIDEO = { assetId: "asset-video-welcome", playback: "rendition-video-welcome-playback", poster: "rendition-video-welcome-poster", captions: "rendition-video-welcome-captions", transcript: "rendition-video-welcome-transcript" } as const;
const DEVELOPMENT_LABEL = "Development data";
const LOCAL_PROCESSING = "local processing; not production scanning or transcoding"; // The sentence every simulated media boundary states, in the specification's own words.
const PROTECTED_PROSE = "the monthly costs rose in September"; // The protected sentence the approved-supporter edition carries and the public edition deliberately does not.
const PUBLIC_PROSE = "Thank you for praying with us"; // A public sentence from the same Update, so the reading view below is proved to have rendered an edition rather than nothing.
const TYPED_PROSE = "A note for the people who support this work."; // What this file types into the editor, so "the prose is untouched" is an assertion about text only this test put there.
const TRANSCRIPT_TEXT = "Hello and welcome from the youth group."; // What this file types into the transcript field of the video it places: the text alternative a reader who cannot play it receives.
const PLACEMENT_TEXT = { altText: "The youth group's welcome message", caption: "A short welcome for supporters", credit: "Harbour Youth", language: "en" } as const; // The credit and language the placement records, both stated by the person who placed it rather than derived from the file.
const POSTER_FIXTURE = "poster.jpg"; // The committed poster image criterion 18 asks an uploaded video to carry.
const CAPTIONS_FIXTURE = "sample.vtt"; // The committed WebVTT caption track criterion 18 asks an uploaded video to carry.
const TRACK_LABEL = "English"; // The label the player's caption menu shows for the uploaded track.
const EDITOR_NAME = "The text of this Update edition";
const CONTAINER_REFUSAL = /which this profile does not admit/u; // The one sentence the engine reports a rejected container with, taken from the profile's own refusal rather than restated in full: the container is named and the admitted alternatives are offered.
/** The next step the same refusal offers, which is what makes it actionable rather than merely negative. */
const FIRST_KIB_BYTES = 1024; // The `Range` this file asks for: the first kibibyte of the rendition, which is what a browser's player starts with.
const BYTE_RANGE_HEADER = `bytes=0-${String(FIRST_KIB_BYTES - 1)}`;
const PRIVATE_MEDIA_MARKERS = ["welcome-sunday-raw.mp4", "evening-talk-raw.mp4", "media-originals", "public/fixtures", "IMG_20260814"] as const; // The addresses a media response may never carry: the opaque source reference of the seeded original, and the store's own custody paths.
/** What a rendition address is never: a static file under the application's public directory, a blob URL, a data URL, or another origin. */
const MEDIA_ROUTE = /^\/api\/media\/[A-Za-z0-9][A-Za-z0-9._:-]*\/[A-Za-z0-9][A-Za-z0-9._:%-]*$/u; // The address every rendition is served from, and the only shape a rendition address may have.
const MEDIA_IN_MARKUP = [/<img\b/iu, /<video\b/iu, /<audio\b/iu, /<source\b/iu, /<track\b/iu, /<iframe\b/iu, /<object\b/iu, /<embed\b/iu, /autoplay/iu, /poster=/iu] as const; // The measure of the criterion's "no media in the notice": every element that would carry an image, a video, a player, a poster or a track.
const actAsPersona = async (page: Page, persona: PersonaName): Promise<void> => actAs(page, SEEDED_PERSONAS[persona].sessionId); // Puts one seeded persona's session in the browser context's jar, which is the whole of the identity a request is authorised as.
const switchScenario = (page: Page, scenarioId: string): Promise<JsonRecord> => operateDevControl(page.request, "setScenario", { scenarioId }); // Puts this session in one named scenario, which is how a source that is down is exercised without waiting for one.
type EditionAuthority = { readonly scope: JsonRecord; readonly recordRevision: string }; // The authority one edition's writes run under: the scope the overview stated, and the edition's own record revision.
function editionRowOf(overview: unknown, variantId: string): JsonRecord {
  const editions = arrayAt(overview, ["data", "editions"], "The Update overview's editions"); // One edition's row inside the Update overview, which is where its own revision and release head are stated.
  const row = editions.find((entry) => isRecord(entry) && entry.variantId === variantId);
  if (!isRecord(row)) throw new Error(`The Update overview does not list ${variantId}, so this file cannot name the edition it writes: ${JSON.stringify(overview).slice(0, 400)}`);
  return row;
}
async function readEditionOverview(page: Page, variantId: string = PROTECTED_VARIANT): Promise<{ readonly authority: EditionAuthority; readonly row: JsonRecord }> {
  const overview = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`), "GET /api/updates"); // Reads one edition's overview entry, which states the scope, its own revision and its release head.
  const scope = scopeAt(overview, "The Update overview");
  const row = editionRowOf(overview, variantId);
  return { authority: { scope, recordRevision: stringAt(row, ["recordRevision"], `The record revision of ${variantId}`) }, row };
}
async function mutateEdition(page: Page, path: string, payload: JsonRecord, name: string, variantId: string = PROTECTED_VARIANT): Promise<unknown> {
  const { authority } = await readEditionOverview(page, variantId);
  const answer = await page.request.post(path, { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.recordRevision, payload } });
  const body = await jsonOf(answer, `POST ${path} (${name})`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "alreadyAccepted" && outcome !== "unchanged") throw new Error(`${name} was refused, so the state this test names was never reached: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
}
async function mutateDocument(page: Page, path: string, payload: JsonRecord, name: string): Promise<unknown> {
  const overview = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`), "GET /api/updates"); // Posts one named write whose target is the Update document itself, presenting the document's own revision.
  const scope = fieldAt(overview, "scope");
  if (!isRecord(scope)) throw new Error(`The Update overview answered without the scope it ran under: ${JSON.stringify(overview).slice(0, 400)}`);
  const answer = await page.request.post(path, { data: { operationId: newAttemptId(), scope, expectedRevision: stringAt(overview, ["revision"], "The Update document's revision"), payload } });
  const body = await jsonOf(answer, `POST ${path} (${name})`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "alreadyAccepted" && outcome !== "unchanged") throw new Error(`${name} was refused, so the state this test names was never reached: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
}
// Preparing a real MP4 is the heaviest work this application does on this device: the file is decoded, checked, re-encoded or re-muxed and
// stored before any receipt exists, and that takes seconds rather than milliseconds on a loaded machine, so the wait for a receipt is stated
// rather than left to the default an assertion assumes.
const PREPARATION_TIMEOUT_MS = 120_000;
const POLLED_CLICK_TIMEOUT_MS = 2_000; // How long one attempt to switch the media pane's list may wait for the control to answer.
const SHOW_PLACEMENTS_TIMEOUT_MS = 30_000; // How long the video list may take to be the panel on screen, which covers a reload's own hydration.
const SHOW_PLACEMENTS_INTERVALS_MS = [250, 500, 1_000, 2_000]; // How often the list is asked for again, so a surface still settling is not clicked in a tight loop.
const mediaPaneOf = (page: Page): Locator => page.locator('[data-slot="editor-media-pane"]');
async function openEditor(page: Page): Promise<void> {
  await page.goto(EDITOR_PATH); // Opens the protected edition's editor and waits for the editing surface itself rather than for a spinner.
  await expect(page.getByRole("heading", { level: 1, name: "Update edition", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: EDITOR_NAME, exact: true })).toBeVisible();
}
async function openPicker(page: Page, kind: "image" | "video"): Promise<Locator> {
  await mediaPaneOf(page) // Opens the picker for one kind of media from the editor's own add action, and waits for its first step.
    .getByRole("button", { name: kind === "video" ? "Add a video" : "Add an image", exact: true })
    .click();
  const picker = page.locator(`[data-slot="media-picker"][data-kind="${kind}"]`);
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute("data-phase", "choosing");
  return picker;
}
async function showVideoPlacements(page: Page): Promise<void> {
  const pane = mediaPaneOf(page);
  const videoTab = pane.getByRole("tab", { name: "Videos", exact: true }); // The media pane's video list, which is the panel a video placement is stated in: the pane opens on images.
  const videoPanel = pane.getByRole("tabpanel", { name: "Videos", exact: true });
  await expect(videoTab).toBeVisible();
  // This control is clicked within moments of a full reload as well as mid-journey, and a reloaded surface answers with its server rendering
  // before it has attached its own handlers, so a click can reach a tab that is not listening yet. The click is therefore repeated while the
  // panel it selects is not the one on screen, and what this helper asserts is that panel rather than the click that asked for it.
  await expect
    .poll(
      async () => {
        if (await videoPanel.isVisible()) return true;
        await videoTab.click({ timeout: POLLED_CLICK_TIMEOUT_MS }).catch(() => undefined);
        return videoPanel.isVisible();
      },
      { message: "the media pane's video list is the panel on screen", timeout: SHOW_PLACEMENTS_TIMEOUT_MS, intervals: SHOW_PLACEMENTS_INTERVALS_MS },
    )
    .toBe(true);
}
type VideoPlacementInput = { readonly file: string; readonly altText?: string; readonly caption?: string; readonly credit?: string; readonly language?: string; readonly transcript?: string; readonly poster?: string | null; readonly captions?: string | null; readonly trackLabel?: string };
/** The placement's caption field, told apart from the caption-track file input the video picker offers beside it. */
async function describePlacement(picker: Locator, input: VideoPlacementInput): Promise<void> {
  await picker.getByLabel(/^Alternative text/u).fill(input.altText ?? PLACEMENT_TEXT.altText); // The labels carry a required marker or an "(optional)" suffix, so each field is addressed by the start of the label a person reads rather than by text that would have to guess which of the two it is.
  await picker.getByLabel(/^Caption(?! track)/u).fill(input.caption ?? PLACEMENT_TEXT.caption);
  await picker.getByLabel(/^Credit/u).fill(input.credit ?? PLACEMENT_TEXT.credit);
  await picker.getByLabel(/^Language/u).fill(input.language ?? PLACEMENT_TEXT.language);
  await picker.getByLabel(/^Transcript/u).fill(input.transcript ?? TRANSCRIPT_TEXT);
}
/** Attaches the poster image and the WebVTT caption track beside the video, which is what an uploaded video carries unless the case is about leaving one out. */
async function attachTracks(picker: Locator, input: VideoPlacementInput): Promise<void> {
  const poster = input.poster === undefined ? POSTER_FIXTURE : input.poster;
  const captions = input.captions === undefined ? CAPTIONS_FIXTURE : input.captions;
  if (poster !== null) await picker.getByLabel(/^Poster image/u).setInputFiles(fixturePathOf(poster));
  if (captions === null) return;
  await picker.getByLabel(/^Caption track/u).setInputFiles(fixturePathOf(captions));
  await picker.getByLabel(/^Track label/u).fill(input.trackLabel ?? TRACK_LABEL);
}
async function placeVideo(page: Page, input: VideoPlacementInput): Promise<void> {
  const picker = await openPicker(page, "video"); // Adds one video through the picker, closes it on its durable receipt, and reports the answer the service gave.
  await chooseFile(picker, input.file);
  await describePlacement(picker, input);
  await attachTracks(picker, input);
  await picker.getByRole("button", { name: "Add this video", exact: true }).click();
  await expect(picker.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: PREPARATION_TIMEOUT_MS });
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(picker).toBeHidden();
}
async function readDraftEdition(page: Page): Promise<{ readonly revisionId: string; readonly assetId: string }> {
  const draft = await jsonOf(await page.request.get(`/api/drafts?view=draft&variantId=${encodeURIComponent(PROTECTED_VARIANT)}`), "GET /api/drafts?view=draft"); // Reads the protected edition's saved draft, which is where a placement's asset identity and the revision a review freezes are stated.
  return { revisionId: stringAt(draft, ["data", "revision", "revisionId"], "The draft edition's revision"), assetId: stringAt(draft, ["data", "placements", "0", "assetId"], "The draft's first placement's asset") };
}
async function readHeadRelease(page: Page): Promise<{ readonly releaseId: string; readonly revisionId: string }> {
  const { row } = await readEditionOverview(page);
  return { releaseId: stringAt(row, ["headRelease", "releaseId"], "The protected edition's head release"), revisionId: stringAt(row, ["headRelease", "revisionId"], "The revision that head release published") };
}
async function releaseProtectedEdition(page: Page): Promise<{ readonly releaseId: string; readonly revisionId: string; readonly previousReleaseId: string }> {
  const before = await readHeadRelease(page); // Sends the draft that holds the placed video through its one review step and releases it.
  const draft = await readDraftEdition(page);
  await mutateEdition(page, "/api/review", { operation: "submitForReview", variantId: PROTECTED_VARIANT, revisionId: draft.revisionId }, "submitForReview");
  await mutateEdition(page, "/api/review", { operation: "approveCandidate", candidateId: draft.revisionId }, "approveCandidate");
  const released = await mutateEdition(page, "/api/publish", { documentId: UPDATE_DOCUMENT, variants: [{ variantId: PROTECTED_VARIANT }] }, "publishVariants");
  const item = arrayAt(released, ["items"], "The release's per-edition results").find((entry) => isRecord(entry) && entry.targetId === PROTECTED_VARIANT);
  if (!isRecord(item) || item.state !== "released") throw new Error(`The release did not report this edition as released, so nothing protected was published: ${JSON.stringify(released).slice(0, 600)}`);
  const head = await readHeadRelease(page);
  if (head.revisionId !== draft.revisionId) throw new Error(`The released head stands on ${head.revisionId} rather than the revision the draft placed the video in (${draft.revisionId}).`);
  return { releaseId: head.releaseId, revisionId: head.revisionId, previousReleaseId: before.releaseId };
}
async function openAndConfirmOwnMembership(page: Page): Promise<string> {
  const { authority } = await readEditionOverview(page); // Opens the acting person's own Update-email membership and confirms it, which is what makes them a recipient and a holder of a protected-reading grant.
  const signup = await page.request.post("/api/audience", { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.recordRevision, payload: { publisherId: "publisher-harbour", purpose: "update-email", email: "established.worker@example.org" } } });
  const signed = await jsonOf(signup, "POST /api/audience");
  if (outcomeOf(signed) !== "accepted") throw new Error(`Opening the acting person's own membership was refused: ${JSON.stringify(signed).slice(0, 400)}`);
  const membershipId = stringAt(signed, ["created", "0"], "The membership a signup minted");
  const confirmed = await jsonOf(await page.request.post("/api/confirm", { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: stringAt(signed, ["revision"], "The minted membership's own revision"), payload: { membershipId } } }), "POST /api/confirm");
  if (outcomeOf(confirmed) !== "accepted") throw new Error(`Confirming that membership inside its window was refused: ${JSON.stringify(confirmed).slice(0, 400)}`);
  return membershipId;
}
async function submitNotice(page: Page, releaseId: string): Promise<unknown> {
  const { authority } = await readEditionOverview(page); // Submits one notice for one released edition, which is the act a publish-and-notify control would perform.
  const answer = await page.request.post("/api/notify", { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.recordRevision, payload: { documentId: UPDATE_DOCUMENT, releaseId } } });
  const body = await jsonOf(answer, "POST /api/notify");
  if (outcomeOf(body) !== "accepted") throw new Error(`The notice was not submitted, so the inbox this test reads would hold nothing: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
}
const placementFact = async (row: Locator, label: string): Promise<string> => (await row.locator(`dt:text-is("${label}") + dd`).innerText()).trim(); // The value the placement row states for one label, so "the video carries no caption track" is read rather than inferred.
async function holdNextRegistration(page: Page): Promise<{ readonly reached: Promise<void>; readonly release: () => void }> {
  let signalReached = (): void => {}; // Holds the next registration request open, so the picker's *preparing* state is observed while it lasts rather than
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  let unblock = (): void => {};
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  await page.route("**/api/media", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    signalReached();
    await blocked;
    await route.continue();
  });
  return { reached, release: unblock };
}
test("a chosen video is checked by its own content, prepared on this device, and each state it can be in stays distinct", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first(), "The shell's development label is present on the surface the whole journey runs on: every effect below is simulated, and a person who mistook this for production would read a local preparation as production scanning").toBeVisible();
  const editor = page.getByRole("textbox", { name: EDITOR_NAME, exact: true }); // Prose this test puts there, so "the text around the placement is untouched" is an assertion about a sentence only this test wrote. The editor's own status line reports the save; nothing here reads a timer.
  await editor.click();
  await editor.pressSequentially(TYPED_PROSE);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  const picker = await openPicker(page, "video");
  await expect(picker.getByText("What this placement admits", { exact: true }), "--- the picker states what it admits before any work begins ------------------------------").toBeVisible();
  await expect(picker.getByText(/MP4 with H\.264 video and AAC audio, or WebM with VP8 or VP9 video and Vorbis or Opus audio/u).first()).toBeVisible();
  for (const value of ["No more than 100 MiB.", "No longer than 3 minutes.", "No larger than 1,920 × 1,080 pixels."]) await expect(picker.getByText(value, { exact: true })).toBeVisible();
  await expect(picker.getByText(/This application checks the file.s content itself, so a name or an extension never decides what a file is/u)).toBeVisible();
  await expect(picker.locator('[data-slot="simulation-label"][data-simulation-effect="media-preparation"]')).toContainText(LOCAL_PROCESSING);
  const held = await holdNextRegistration(page);
  await chooseFile(picker, "sample-h264.mp4");
  await describePlacement(picker, { file: "sample-h264.mp4" });
  // A video is placed with a poster image and a WebVTT caption track of its own, so both controls are offered here and the
  // registration that follows carries what they collect: an image placement offers neither.
  await expect(picker.getByLabel(/^Poster image/u), "A video placement offers its own poster image").toBeVisible();
  await expect(picker.getByLabel(/^Caption track/u), "A video placement offers its own WebVTT caption track").toBeVisible();
  await attachTracks(picker, { file: "sample-h264.mp4", trackLabel: TRACK_LABEL });
  await picker.getByRole("button", { name: "Add this video", exact: true }).click();
  await held.reached;
  await expect(picker).toHaveAttribute("data-phase", "preparing");
  await expect(picker.locator('[aria-label="Preparing this video"]')).toBeVisible();
  await expect(picker.getByText("Preparing…", { exact: true })).toBeVisible();
  await expect(picker.getByText(/Preparing this file with the local media pipeline: it is decoded, checked, re-encoded so its metadata is removed, and stored\. Nothing is published\./u)).toBeVisible();
  await expect(picker.getByRole("button", { name: "Stop waiting", exact: true })).toBeVisible();
  held.release();
  const receipt = picker.locator('[data-slot="operation-result"]');
  await expect(receipt).toHaveAttribute("data-outcome", "accepted", { timeout: PREPARATION_TIMEOUT_MS });
  await expect(receipt, "The receipt states that one effect was applied and that it is recorded, and it repeats that this was local processing rather than production scanning").toContainText("The change was applied once");
  await expect(picker.locator('[data-simulation-context="block"][data-simulation-effect="media-preparation"]')).toContainText(LOCAL_PROCESSING);
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(picker).toBeHidden();
  await page.unroute("**/api/media");
  await showVideoPlacements(page);
  const videos = page.locator('[data-slot="placement-row"][data-kind="video"]');
  await expect(videos).toHaveCount(1);
  const placed = videos.first();
  await expect(placed).toHaveAttribute("data-state", "ready");
  await expect(placed).toContainText("Ready");
  const placedFor = await placementFact(placed, "Placed for");
  for (const purpose of ["playback", "poster", "captions", "transcript"]) expect(placedFor, `the placement is placed for its ${purpose} rendition`).toContain(purpose);
  expect(await placementFact(placed, "Alternative text")).toBe(PLACEMENT_TEXT.altText);
  expect(await placementFact(placed, "Credit")).toBe(PLACEMENT_TEXT.credit);
  expect(await placementFact(placed, "Transcript")).toBe("Present"); // The record states what this asset really carries: registering the chosen files sends their own bytes and text, so the asset holds the playback, poster, caption and transcript renditions prepared for it.
  expect(await placementFact(placed, "Caption track")).toBe("Present");
  expect(await placementFact(placed, "Poster")).toBe("Present");
  await placeVideo(page, { file: "sample-vp9.webm", altText: "A second short clip for supporters", caption: "Another welcome" });
  await showVideoPlacements(page);
  await expect(videos).toHaveCount(2);
  const rejecting = await openPicker(page, "video");
  await chooseFile(rejecting, "sample-unsupported.mkv");
  await describePlacement(rejecting, { file: "sample-unsupported.mkv", altText: "A clip that will not be admitted" });
  await rejecting.getByRole("button", { name: "Add this video", exact: true }).click();
  await expect(rejecting.getByText(CONTAINER_REFUSAL), "The refusal states why this content was refused and what to do instead; it is not a bare failure").toBeVisible({ timeout: PREPARATION_TIMEOUT_MS });
  await expect(rejecting.getByText(/Upload an MP4 \(avc video with aac audio\) or a WebM \(vp8 or vp9 video/u)).toBeVisible();
  await expect(rejecting, "An invalid attempt changes nothing, so it stays on the form rather than presenting a receipt as if something had been registered").toHaveAttribute("data-phase", "described");
  await expect(rejecting.locator('[data-slot="operation-result"]')).toHaveCount(0);
  await expect(mediaPaneOf(page).getByText("This media was not placed", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rejecting).toBeHidden();
  await showVideoPlacements(page);
  await expect(videos).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: EDITOR_NAME, exact: true })).toContainText(TYPED_PROSE);
  const cancelling = await holdNextRegistration(page);
  const cancelledPicker = await openPicker(page, "video");
  await chooseFile(cancelledPicker, "sample-h264.mp4");
  await describePlacement(cancelledPicker, { file: "sample-h264.mp4", altText: "A clip the worker stops waiting for" });
  await cancelledPicker.getByRole("button", { name: "Add this video", exact: true }).click();
  await cancelling.reached;
  await cancelledPicker.getByRole("button", { name: "Stop waiting", exact: true }).click();
  await expect(cancelledPicker, "Cancelled is its own state, worded as the wait it stopped rather than as a failure of the file").toHaveAttribute("data-phase", "cancelled");
  await expect(cancelledPicker.getByText("No media added", { exact: true })).toBeVisible();
  await expect(cancelledPicker.getByText(/You stopped waiting\. The request had already been sent, so its result appears here when it arrives\. Nothing in your draft was changed\./u)).toBeVisible();
  cancelling.release();
  await expect(cancelledPicker.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted", { timeout: PREPARATION_TIMEOUT_MS });
  await cancelledPicker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(cancelledPicker).toBeHidden();
  await page.unroute("**/api/media");
  await expect(page.getByRole("textbox", { name: EDITOR_NAME, exact: true })).toContainText(TYPED_PROSE);
  await showVideoPlacements(page);
  await expect(videos).toHaveCount(3);
  await switchScenario(page, "media-unavailable"); // --- unavailable: the source is down, and the answer says so instead of serving nothing -------- A source that is down is its own answer: not a zero-length rendition, not an empty list and not the neutral refusal an unauthorised caller receives. The record keeps the media it holds, and the prose
  const downed = await requestRendition(page, renditionAddressOf(SEEDED_VIDEO.assetId, SEEDED_VIDEO.playback), BYTE_RANGE_HEADER);
  expect(downed.status, "an asset whose source is down is not served").toBeGreaterThanOrEqual(500);
  const outage = JSON.parse(downed.body) as Record<string, unknown>;
  expect(outage.outcome, "an outage is the read's own unavailable outcome").toBe("unavailable");
  expect(fieldAt(outage, "source", "system"), "the outage names the source that did not answer").toBe("media-source");
  expect(stringAt(outage, ["guidance"], "The outage's guidance")).toMatch(/could not be read from their source right now/u);
  expect(downed.body, "an outage is never worded as a refusal of permission").not.toContain("no-permission");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Update edition", exact: true })).toBeVisible();
  await showVideoPlacements(page);
  await expect(page.locator('[data-slot="placement-row"][data-kind="video"]'), "the draft still holds every placement it held").toHaveCount(3);
  await expect(page.getByRole("textbox", { name: EDITOR_NAME, exact: true })).toContainText(TYPED_PROSE);
  await switchScenario(page, "baseline");
});
test("a released edition plays its MP4 with a poster and a WebVTT caption track, and never starts by itself with sound", async ({ page }) => {
  await page.goto(PAGE_READING_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Page edition", exact: true })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();
  const video = page.locator("video").first();
  await expect(video, "The one player the application renders: native semantic HTML with its own controls, so the browser's accessible player is what a reader meets rather than a reimplementation of one").toBeVisible();
  await expect(video).toHaveAttribute("controls", "");
  const src = await video.getAttribute("src");
  const poster = await video.getAttribute("poster");
  expect(src, "the player streams the seeded asset's playback rendition from the application's own route").toMatch(MEDIA_ROUTE);
  expect(src).toContain(SEEDED_VIDEO.assetId);
  expect(src).toContain(SEEDED_VIDEO.playback);
  expect(poster, "the poster is the asset's own poster rendition, served by the same route").toMatch(MEDIA_ROUTE);
  expect(poster).toContain(SEEDED_VIDEO.poster);
  await expect(video).not.toHaveAttribute("autoplay", /.*/u); // Nothing starts by itself: the element carries no autoplay attribute, and the state read below states that it is paused. Both assertions are on the player's own properties, never on a picture of it.
  await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).readyState), { message: "the player reaches a playable readyState" }).toBeGreaterThanOrEqual(1);
  const state = await video.evaluate((element) => {
    const player = element as HTMLVideoElement;
    return { paused: player.paused, readyState: player.readyState, duration: player.duration, muted: player.muted, controls: player.controls, autoplay: player.autoplay };
  });
  expect(state.controls, "the player keeps the browser's own controls").toBe(true);
  expect(state.autoplay, "the player does not start by itself").toBe(false);
  expect(state.paused, "a player that does not autoplay is paused on first render").toBe(true);
  if (state.autoplay) expect(state.readyState, "the browser has the media's own metadata").toBeGreaterThanOrEqual(1);
  expect(Math.round(state.duration), "the two-second fixture is the media the player holds").toBe(2);
  const captions = video.locator('track[kind="captions"]');
  await expect(captions).toHaveCount(1);
  await expect(captions).toHaveAttribute("srclang", "en");
  await expect(captions).toHaveAttribute("label", "English");
  const captionsSrc = await captions.getAttribute("src");
  expect(captionsSrc, "the caption track is a rendition of this application, not a file on a public path").toMatch(MEDIA_ROUTE);
  expect(captionsSrc).toContain(SEEDED_VIDEO.captions);
  const posterAnswer = await requestRendition(page, poster ?? "");
  expect(posterAnswer.status, "the poster rendition is served to the contributor").toBe(200);
  expect(posterAnswer.contentType).toContain("image/jpeg");
  const captionsAnswer = await requestRendition(page, captionsSrc ?? "");
  expect(captionsAnswer.status, "the caption rendition is served to the contributor").toBe(200);
  expect(captionsAnswer.contentType).toContain("text/vtt");
  expect(captionsAnswer.body.trimStart().startsWith("WEBVTT"), "the caption track is WebVTT rather than any text that happened to be there").toBe(true);
  const transcriptLink = page
    .locator("figure")
    .filter({ has: page.locator("video") })
    .first()
    .getByRole("link", { name: /Read the transcript/u });
  await expect(transcriptLink, "the placement offers the transcript alternative the catalogue promises").toHaveCount(1);
  const transcriptSrc = (await transcriptLink.getAttribute("href")) ?? "";
  expect(transcriptSrc, "the transcript alternative is a rendition of this application, not a file on a public path").toMatch(MEDIA_ROUTE);
  expect(transcriptSrc).toContain(SEEDED_VIDEO.transcript);
  const transcriptAnswer = await requestRendition(page, transcriptSrc);
  expect(transcriptAnswer.status, "the transcript rendition is served to the contributor").toBe(200);
  expect(transcriptAnswer.contentType).toContain("text/vtt");
  await expect(page.getByText("simulated publication; reach is demonstrated in the receiving preview", { exact: true }).first(), "The surface states that its reach is demonstrated rather than pushed to a real audience").toBeVisible();
});
test("every rendition is served by the application's own scoped route, and a byte range returns a partial response", async ({ page }) => {
  await page.goto(PAGE_READING_PATH); // The addresses the released edition emitted, read from the player itself rather than composed here: a test that built its own addresses would prove what the route admits, not what the application serves.
  const seededPlayer = page.locator("video").first();
  await expect(seededPlayer).toBeVisible();
  const seededPlayback = await seededPlayer.getAttribute("src");
  const seededPoster = await seededPlayer.getAttribute("poster");
  const seededCaptions = await seededPlayer.locator('track[kind="captions"]').getAttribute("src");
  for (const [what, address] of [
    ["playback", seededPlayback],
    ["poster", seededPoster],
    ["caption track", seededCaptions],
  ] as const) {
    expect(address ?? "", `the ${what} address is this application's own rendition route`).toMatch(MEDIA_ROUTE);
    for (const marker of ["/fixtures/", "/public/", "blob:", "data:", "http://", "https://"] as const) expect(address ?? "", `the ${what} address is never a static public path (${marker})`).not.toContain(marker);
  }
  const whole = await requestRendition(page, seededPlayback ?? "");
  expect(whole.status, "the whole playback rendition is served to the contributor").toBe(200);
  expect(whole.contentType).toContain("video/mp4");
  expect(whole.headers["accept-ranges"], "the route states that it accepts byte ranges").toBe("bytes");
  expect(whole.headers["cache-control"], "a rendition is never stored or shared").toBe("private, no-store");
  expect(whole.headers["x-content-type-options"], "a rendition is never sniffed into another type").toBe("nosniff");
  const partial = await requestRendition(page, seededPlayback ?? "", BYTE_RANGE_HEADER);
  expect(partial.status, "a byte range is answered as partial content; The range a player starts with: the first kibibyte, answered as a partial response whose own window states the entity's size, so the size is read from the answer rather than assumed").toBe(206);
  const contentRange = partial.headers["content-range"] ?? "";
  expect(contentRange, "a partial response states the window it carries and the entity's size").toMatch(/^bytes 0-1023\/\d+$/u);
  const totalBytes = Number(contentRange.split("/")[1]);
  expect(Number.isSafeInteger(totalBytes) && totalBytes > FIRST_KIB_BYTES, `the fixture is larger than the range asked for (${String(totalBytes)} bytes)`).toBe(true);
  expect(partial.body.length, "the partial response carries the window rather than the whole entity").toBeLessThan(whole.body.length);
  const beyond = await requestRendition(page, seededPlayback ?? "", `bytes=${String(totalBytes)}-`);
  expect(beyond.status, "a range past the end is not satisfied; A window that names no byte of the entity is refused as unsatisfiable rather than answered with the whole file").toBe(416);
  expect(beyond.headers["content-range"], "the refusal states the entity's size and no window").toBe(`bytes */${String(totalBytes)}`);
  await openEditor(page);
  await placeVideo(page, { file: "sample-h264.mp4" });
  const draft = await readDraftEdition(page);
  const uploadedPlayback = renditionAddressOf(draft.assetId, "playback");
  const uploadedTranscript = renditionAddressOf(draft.assetId, "transcript");
  const uploadedPartial = await requestRendition(page, uploadedPlayback, BYTE_RANGE_HEADER);
  expect(uploadedPartial.status, "the uploaded asset's playback rendition answers a range as partial content").toBe(206);
  expect(uploadedPartial.headers["content-range"]).toMatch(/^bytes 0-1023\/\d+$/u);
  expect(uploadedPartial.contentType).toContain("video/mp4");
  const transcript = await requestRendition(page, uploadedTranscript);
  expect(transcript.status, "the transcript is a rendition of the same asset").toBe(200);
  expect(transcript.contentType).toContain("text/plain");
  expect(transcript.body.trim(), "the transcript is the text that was placed, stored as content rather than as metadata").toBe(TRANSCRIPT_TEXT);
  for (const answer of [whole, partial, beyond, uploadedPartial, transcript]) {
    const headers = JSON.stringify(answer.headers);
    for (const marker of PRIVATE_MEDIA_MARKERS) {
      expect(headers, `no response header names ${marker}`).not.toContain(marker);
      expect(answer.body, `no response body names ${marker}`).not.toContain(marker);
    }
  }
});
test("another persona's direct request for playback, poster, captions and transcript is denied, with and without a byte range", async ({ page }) => {
  await page.goto(PAGE_READING_PATH); // The public asset's three addresses, as the reading view emitted them, and the protected edition's own after it is released: six addresses that really exist and one that never did.
  const seededPlayer = page.locator("video").first();
  const seededPlayback = (await seededPlayer.getAttribute("src")) ?? "";
  const seededPoster = (await seededPlayer.getAttribute("poster")) ?? "";
  const seededCaptions = (await seededPlayer.locator('track[kind="captions"]').getAttribute("src")) ?? "";
  await openEditor(page);
  await placeVideo(page, { file: "sample-h264.mp4", altText: "A welcome only supporters may see" });
  const released = await releaseProtectedEdition(page);
  const draft = await readDraftEdition(page);
  await page.goto(`${EDITOR_PATH}/preview`);
  const protectedPlayback = (await page.locator("video").first().getAttribute("src")) ?? "";
  const transcriptLink = page
    .locator("figure")
    .filter({ has: page.locator("video") })
    .getByRole("link", { name: /Read the transcript for/u });
  await expect(transcriptLink).toBeVisible();
  const protectedTranscript = (await transcriptLink.getAttribute("href")) ?? "";
  const protectedPoster = renditionAddressOf(draft.assetId, "poster");
  const protectedCaptions = renditionAddressOf(draft.assetId, "captions");
  const protectedMedia = [protectedPlayback, protectedPoster, protectedCaptions, protectedTranscript];
  for (const address of [protectedPlayback, protectedTranscript]) expect(address, "the protected edition's own addresses are this application's rendition route").toMatch(MEDIA_ROUTE);
  expect(released.releaseId, "the release published a new head rather than restating the seeded one").not.toBe(released.previousReleaseId); // The positive control, on the same address the denials below are measured against: the scope that owns the asset reads it, so a refusal is about the caller rather than about an address nothing serves. The release really moved the edition's head, which is what makes the asset one a live protected
  const mine = await requestRendition(page, protectedPlayback, BYTE_RANGE_HEADER);
  expect(mine.status, "the contributor reads the protected asset they placed").toBe(206);
  expect(mine.headers["content-range"]).toBeDefined();
  await actAsPersona(page, OUTSIDE_WORKER_PERSONA);
  const workerDenied = await expectDenied(page, [...protectedMedia, seededPlayback, seededPoster, seededCaptions], "the outside worker");
  const unminted = await requestRendition(page, renditionAddressOf("asset-never-registered", "playback"));
  expect(unminted.status, "an address naming no asset is refused exactly as an unauthorised one is; The same answer for an address naming no asset this application ever minted, which is what keeps a refusal from disclosing whether something exists behind it").toBe(workerDenied.status);
  expect(unminted.body.trim(), "an unauthorised address and one that never existed are indistinguishable").toBe(workerDenied.body.trim());
  await actAsPersona(page, OUTSIDE_READER_PERSONA);
  expect((await requestRendition(page, seededPlayback)).status, "a reader without a grant still reads the public edition's media").toBe(200); // The public edition's playback rendition is readable by this reader, which is what makes the refusal below a decision about the grant rather than a reader being refused everything.
  await expectDenied(page, protectedMedia, "a reader holding no grant");
  const captionsOnly = await requestRendition(page, protectedCaptions, BYTE_RANGE_HEADER);
  expect(captionsOnly.status, "the caption track is refused exactly as the playback is; The caption track is not a route around the denied video, and neither is the poster or the transcript: all four are refused with one answer, with and without a byte range").toBe(workerDenied.status);
  expect(captionsOnly.body.trim()).toBe(workerDenied.body.trim());
  expect(captionsOnly.headers["content-range"], "a refused range states no window").toBeUndefined();
  expect(captionsOnly.headers["accept-ranges"], "a refused range offers no accept-ranges").toBeUndefined();
  await actAsPersona(page, CONTRIBUTOR_PERSONA); // --- the contributor again ------------------------------------------------------------------- Restoring the owner proves the refusals above were decisions about those callers rather than a restriction the requests themselves caused: the same address answers the scope that owns the asset,
  const ownerAgain = await requestRendition(page, protectedPlayback);
  expect(ownerAgain.status, "the protected asset is still served to the scope that owns it").toBe(200);
  expect(ownerAgain.body.length, "the whole rendition is served, not a fragment of it").toBeGreaterThan(FIRST_KIB_BYTES);
});
async function expectDenied(page: Page, addresses: readonly string[], who: string): Promise<{ readonly status: number; readonly body: string }> {
  const answers: { readonly status: number; readonly body: string }[] = []; // Asserts every one of the given addresses is refused for the persona the context now holds, with and without a byte
  for (const address of addresses) {
    for (const range of [undefined, BYTE_RANGE_HEADER]) {
      const answer = await requestRendition(page, address, range);
      expect(answer.status, `${who} is refused ${address}${range === undefined ? "" : " with a byte range"}`).toBe(403);
      expect(answer.contentType, "a refusal is the read's own answer, not a media type").toContain("application/json");
      expect(answer.headers["content-range"], "a refusal carries no content window").toBeUndefined();
      expect(answer.headers["accept-ranges"], "a refusal offers no byte ranges").toBeUndefined();
      const parsed = JSON.parse(answer.body) as Record<string, unknown>;
      expect(parsed.outcome, "a refusal is the closed outcome, not an empty rendition").toBe("denied");
      expect(parsed.reasonCode, "a refusal carries one reason code that names no record").toBe("no-permission");
      expect(answer.body, "a refusal discloses no asset identity").not.toContain("asset-");
      for (const marker of PRIVATE_MEDIA_MARKERS) expect(answer.body, `a refusal names no source file (${marker})`).not.toContain(marker);
      answers.push({ status: answer.status, body: answer.body.trim() });
    }
  }
  const distinct = new Set(answers.map((answer) => `${String(answer.status)} ${answer.body}`));
  expect([...distinct], "every refusal is the same answer, so none of them distinguishes one address from another").toHaveLength(1);
  const [first] = answers;
  if (first === undefined) throw new Error("No address was asserted: this helper needs at least one rendition address to refuse.");
  return first;
}
test("a protected notice carries no protected prose or media, and the link it carries re-checks access", async ({ page }) => {
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.getByText(PUBLIC_PROSE).first()).toBeVisible();
  await expect(page.getByText(PROTECTED_PROSE), "a reader without a grant is never served the protected prose").toHaveCount(0);
  const membershipId = await openAndConfirmOwnMembership(page);
  expect(membershipId.length, "the membership the proof step confirmed has an identity").toBeGreaterThan(0);
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.getByText(PROTECTED_PROSE).first(), "the link re-checks access, so the protected edition is served now").toBeVisible();
  await expect(page.getByText(PUBLIC_PROSE)).toHaveCount(0);
  await openEditor(page);
  const editor = page.getByRole("textbox", { name: EDITOR_NAME, exact: true });
  await editor.click();
  await editor.pressSequentially(PROTECTED_PROSE);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  await placeVideo(page, { file: "sample-h264.mp4", altText: "A welcome for supporters only" });
  const released = await releaseProtectedEdition(page);
  const draft = await readDraftEdition(page);
  expect(released.revisionId, "the release published the revision that carries the video").toBe(draft.revisionId);
  const intentId = stringAt(await submitNotice(page, released.releaseId), ["created", "0"], "The intent the notice created");
  const inbox = await jsonOf(await page.request.get("/api/inbox"), "GET /api/inbox");
  expect(numberAt(inbox, ["data", "intentCount"], "Messages in this inbox"), "--- what the message really is: a sender, a subject and a link ------------------------------; --- the notice, submitted through its own handler -------------------------------------------").toBe(1);
  const messages = arrayAt(inbox, ["data", "messages"], "The inbox's messages");
  expect(messages).toHaveLength(1);
  const message = messages[0];
  expect(fieldAt(message, "intentId"), "the message is the notice this test submitted").toBe(intentId);
  expect(fieldAt(message, "releaseId"), "the message is pinned to the release that carries the video").toBe(released.releaseId);
  expect(fieldAt(message, "audience"), "the edition served is the protected one").toBe("approved-supporter");
  expect(fieldAt(message, "protectedNotice"), "the message is a protected notice").toBe(true);
  expect(fieldAt(message, "reading", "state"), "a protected notice is read at its link rather than rendered in the message").toBe("link-only");
  expect(fieldAt(message, "link"), "the link is the surface a reader follows").toBe(UPDATE_READING_PATH);
  expect(fieldAt(message, "simulated"), "the message states that no mail left the application").toEqual(["mail-submission"]);
  const html = stringAt(message, ["html"], "The message's HTML body");
  const plain = stringAt(message, ["plainText"], "The message's plain-text body");
  for (const markup of MEDIA_IN_MARKUP) {
    expect(html, `a protected notice carries no ${String(markup)}`).not.toMatch(markup);
    expect(plain, `the plain-text notice carries no ${String(markup)}`).not.toMatch(markup);
  }
  for (const leak of [PROTECTED_PROSE, TRANSCRIPT_TEXT, PLACEMENT_TEXT.altText, PLACEMENT_TEXT.caption]) {
    expect(html, `the notice carries no protected text: ${leak}`).not.toContain(leak);
    expect(plain, `the plain-text notice carries no protected text: ${leak}`).not.toContain(leak);
  }
  expect(stringAt(message, ["subject"], "The notice's subject")).toBe("New update");
  expect(stringAt(message, ["sender"], "The notice's sender")).toContain("update-notice@example.invalid");
  expect(html, "the notice points at the receiving surface").toContain(UPDATE_READING_PATH);
  expect(plain, "the plain-text notice points at the receiving surface").toContain(UPDATE_READING_PATH);
  await page.goto("/communication/inbox");
  await expect(page.getByRole("heading", { level: 2, name: "Messages produced for this membership" })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();
  for (const said of [/Send outcome: Accepted — not delivered/u, /It is not a delivered message and not a read one/u]) await expect(page.getByText(said).first()).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Notice body: Protected notice", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Open the message/u }).click();
  await expect(page.getByRole("heading", { level: 3, name: "The message as it was produced for this recipient" })).toBeVisible();
  await expect(page.getByText("A protected Update arrives as a link, not as the Update itself", { exact: true })).toBeVisible();
  await expect(page.getByText(/It holds no protected prose, no image, no location, no poster, no transcript and no caption/u)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the protected Update", exact: true })).toHaveAttribute("href", UPDATE_READING_PATH);
  await expect(page.getByRole("tab", { name: "HTML", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Plain text", exact: true })).toHaveCount(0);
  for (const absent of [page.locator("video"), page.getByText(PROTECTED_PROSE), page.getByText(TRANSCRIPT_TEXT), page.getByText(PLACEMENT_TEXT.altText)]) await expect(absent).toHaveCount(0);
  await expect(page.getByText("simulated — no mail leaves this application", { exact: true }).first()).toBeVisible();
  await page.goto(`${EDITOR_PATH}/preview`);
  const transcriptLink = page
    .locator("figure")
    .filter({ has: page.locator("video") })
    .getByRole("link", { name: /Read the transcript for/u });
  await expect(transcriptLink, "the released edition offers its transcript as the text alternative").toBeVisible();
  const transcriptAnswer = await requestRendition(page, (await transcriptLink.getAttribute("href")) ?? "");
  expect(transcriptAnswer.status, "the transcript rendition is readable where the edition is").toBe(200);
  expect(transcriptAnswer.body.trim()).toBe(TRANSCRIPT_TEXT);
  // --- the link decides access at the moment it is followed ------------------------------------- Withdrawing this Update's two public editions leaves the protected edition as the only one it serves, which is where "opening the link" has one honest answer for each reader rather than a public
  for (const variantId of PUBLIC_EDITIONS) await mutateDocument(page, "/api/withdraw", { operation: "withdrawLocale", variantId }, "withdrawLocale");
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.getByText(PROTECTED_PROSE).first(), "the grant holder still reads the protected edition at the link").toBeVisible();
  await expect(page.locator("video").first(), "and still plays the edition's own video").toBeVisible();
  await actAsPersona(page, OUTSIDE_READER_PERSONA);
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.locator('[data-slot="receiving-post-denied"]'), "a reader without the grant is refused at the same link").toBeVisible();
  await expect(page.getByRole("heading", { name: "This edition cannot be read here", exact: true })).toBeVisible();
  await expect(page.getByText(PROTECTED_PROSE), "the refusal discloses no protected prose").toHaveCount(0);
  await expect(page.locator("video"), "and no protected media").toHaveCount(0);
});
