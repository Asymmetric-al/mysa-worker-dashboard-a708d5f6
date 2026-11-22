/**
 * Criterion 18 — video.
 *
 * A real local MP4 is chosen through the one media picker, checked by its own content, prepared on this
 * device, and placed with its description, credit and language; each state a placement can be in is
 * stated apart from the others; a video already served by a released edition plays with its poster and its
 * WebVTT caption track and never starts by itself with sound; an unsupported container is refused with a
 * reason that names what this profile admits; cancelling stops the wait without discarding a request that
 * was already sent; every rendition address is the application's own scoped route, so a byte range returns
 * a partial response; another persona's direct request for the playback, poster, caption track and
 * transcript is denied with nothing that distinguishes an asset from one that never existed; and a
 * protected notice carries no protected prose, image, poster, caption, transcript or attachment, because it
 * is a link whose access is re-checked when it is followed (AAP 0.12.1 criterion 18; AAP 0.8.5 for the
 * protected notice and the distinction between publication, provider acceptance, delivery and reading;
 * AAP 0.8.6 for the image and video profiles, the six preparation states and the scoped serving rule; AAP
 * 0.8.7 for the profile limits; AAP 0.12.4 for the committed media fixtures).
 *
 * **The scenario this file drives, from the deterministic seed.**
 * - The contributor is the established worker, and the edition under composition is the approved-supporter
 *   edition of `doc-update-autumn` — protected content, so the media placed in it is readable by the scope
 *   that owns it and by a reader holding a protected-reading grant, and by nobody else.
 * - `asset-video-welcome` is the seeded video whose four renditions are the committed fixtures: an MP4
 *   playback rendition, a poster image, a WebVTT caption track, and a transcript — the committed WebVTT text
 *   served as a rendition of its own, so the reading alternative is an admitted rendition rather than a second
 *   copy of the placement's words. The listed public Page edition `release-page-en-1` places it, so
 *   `/preview/pages/doc-page-harbour-youth/en` is where a real player, poster, caption track and transcript are
 *   served — the one place in this world where all four exist at once.
 * - The reader personas are sessions with their own cookies: `second-worker` belongs to another ministry
 *   and shares no scope with this one, and `reader-unauthorized` is a reader holding no grant.
 * - The committed media fixtures are the inputs: `sample-h264.mp4` and `sample-vp9.webm` are the two
 *   admitted containers, `sample-unsupported.mkv` is the rejection case (Matroska, HEVC), `poster.jpg` is
 *   the poster image the seeded asset serves and the still image this picker admits, and `sample.vtt` is
 *   the caption track the seeded asset serves. No fixture is created here and none is needed beside them.
 *
 * **What this build really offers, stated rather than papered over.** Three facts shape what this file can
 * assert, and each is a property of the application rather than a gap in the journey:
 * - The picker that adds media to an Update edition collects the file, its alternative text, an optional
 *   caption, credit, language, transcript and a poster chosen from images already registered in the draft.
 *   It offers no control that uploads a WebVTT file, and the request it sends carries the file's own bytes
 *   with the placement's text and no poster bytes, so a *newly uploaded* video asset holds a playback and a
 *   transcript rendition. The caption track and the poster belong to the seeded asset, whose released Page
 *   edition is the surface that plays them; the assertions below therefore split the criterion where the
 *   application splits it — upload and preparation in the editor, playback, poster and captions in the
 *   reading view the application actually serves.
 * - No route composes a publish-and-notify control (the review step, its panel and its hooks exist, but the
 *   submission handler records *Publish only* and refuses a release mode the submission did not ask for, so
 *   *Publish and notify now* is unreachable through the composed screens). The notice is therefore
 *   submitted through `POST /api/notify` — the same handler, with the same four-field input and the same
 *   closed outcome set the control would post to — and every outcome is read off the durable surfaces a
 *   person returns to: the inbox and the receiving view. `consent-notification.spec.ts` and
 *   `delivery-recovery.spec.ts` reach the same endpoint for the same reason.
 * - Six preparation states are declared once in `modules/media/profile.ts`. Five of them are rendered by a
 *   surface this world reaches; the sixth, *selected*, is the moment between choosing a file and the browser
 *   measuring it, which the picker passes through on its way into *preparing* rather than presenting as a
 *   state of its own. The test below asserts the five that a person can be shown and states the sixth
 *   plainly, because a state invented for the test would be worse evidence than the absence recorded here.
 *
 * **What is reused rather than rebuilt.** The one media picker, the one video player, the one scoped media
 * route, the reading views, the synthetic inbox and the development controls. This file composes no
 * control, mints no record and derives no limit: every address it requests is one the application stated,
 * and every value it compares is one a surface or an answer supplied.
 *
 * **What it never does.** No fixed wait, no idle-network wait, no snapshot, no reading of the synthetic store's own
 * files, no skipped or focused test, and no new fixture. Media state is read from DOM properties (`paused`,
 * `readyState`, `duration`) rather than from a picture, and every refusal is asserted at the boundary the application
 * enforces rather than inferred from the absence of a screen.
 */
import { basename, join, resolve } from "node:path";

import type { BrowserContext, Locator, Page, Route } from "@playwright/test";

import { expect, resetSeed, SEEDED_PERSONAS, SESSION_COOKIE, test, type PersonaName } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded world this file acts in
// ---------------------------------------------------------------------------------------------

/** The contributor who composes the protected edition: the runner's own default persona, named here so the file states whose authority it acts under. */
const CONTRIBUTOR_PERSONA: PersonaName = "established-worker";

/** A worker in another ministry, whose scope shares nothing with this one: the persona every direct rendition request is refused for. */
const OUTSIDE_WORKER_PERSONA: PersonaName = "second-worker";

/** A reader holding no protected-reading grant: the persona the protected media and the protected prose are refused for. */
const OUTSIDE_READER_PERSONA: PersonaName = "reader-unauthorized";

/** The one Update this file composes and notifies. */
const UPDATE_DOCUMENT = "doc-update-autumn";

/** The protected edition under composition: content for approved supporters, in English. */
const PROTECTED_VARIANT = "variant-update-autumn-en-approved-supporter";

/** The editor of that edition, as the shell links to it. */
const EDITOR_PATH = `/communication/${UPDATE_DOCUMENT}/${PROTECTED_VARIANT}`;

/** This Update's two public editions: withdrawing both leaves the protected edition as the only one the link can serve. */
const PUBLIC_EDITIONS = ["variant-update-autumn-en-public", "variant-update-autumn-fr-public"] as const;

/** The listed public Page edition that places the seeded video, and therefore serves a real player, poster and caption track. */
const PAGE_READING_PATH = "/preview/pages/doc-page-harbour-youth/en";

/** The address the protected notice points at: one Update, served in the language the reader asks for. */
const UPDATE_READING_PATH = `/preview/${UPDATE_DOCUMENT}`;

/** The synthetic inbox of whichever reader acts. */
const INBOX_PATH = "/communication/inbox";

/** The seeded video, and the four renditions its record holds: playback, poster, captions and the transcript alternative. */
const SEEDED_VIDEO = { assetId: "asset-video-welcome", playback: "rendition-video-welcome-playback", poster: "rendition-video-welcome-poster", captions: "rendition-video-welcome-captions", transcript: "rendition-video-welcome-transcript" } as const;

/** The publisher this ministry's Update email speaks for, as every membership of the seeded audience records it. */
const PUBLISHER = "publisher-harbour";

/** The purpose a membership is opened for: the only one the audience offers, and the only one a notice is submitted for. */
const UPDATE_EMAIL_PURPOSE = "update-email";

/** The address the acting worker opens a membership on: their own, which is the one address the proof step confirms without first inventing a contact. */
const OWN_ADDRESS = "established.worker@example.org";

/** The persistent development-data label the shell states on every surface. */
const DEVELOPMENT_LABEL = "Development data";

/** The sentence every simulated media boundary states, in the specification's own words. */
const LOCAL_PROCESSING = "local processing; not production scanning or transcoding";

/** The sentence every simulated mail boundary states. */
const SIMULATED_MAIL = "simulated — no mail leaves this application";

/** The protected sentence the approved-supporter edition carries and the public edition deliberately does not. */
const PROTECTED_PROSE = "the monthly costs rose in September";

/** A public sentence from the same Update, so the reading view below is proved to have rendered an edition rather than nothing. */
const PUBLIC_PROSE = "Thank you for praying with us";

/** What this file types into the editor, so "the prose is untouched" is an assertion about text only this test put there. */
const TYPED_PROSE = "A note for the people who support this work.";

/** What this file types into the transcript field of the video it places: the text alternative a reader who cannot play it receives. */
const TRANSCRIPT_TEXT = "Hello and welcome from the youth group.";

/** The credit and language the placement records, both stated by the person who placed it rather than derived from the file. */
const PLACEMENT_TEXT = { altText: "The youth group's welcome message", caption: "A short welcome for supporters", credit: "Harbour Youth", language: "en" } as const;

/** The editable region of the one prose editor, by the name a reader hears. */
const EDITOR_NAME = "The text of this Update edition";

/** The one sentence the engine reports a rejected container with, taken from the profile's own refusal rather than restated in full: the container is named and the admitted alternatives are offered. */
const CONTAINER_REFUSAL = /which this profile does not admit/u;

/** The next step the same refusal offers, which is what makes it actionable rather than merely negative. */
const CONTAINER_NEXT_STEP = /Upload an MP4 \(avc video with aac audio\) or a WebM \(vp8 or vp9 video/u;

/** The `Range` this file asks for: the first kibibyte of the rendition, which is what a browser's player starts with. */
const FIRST_KIB_BYTES = 1024;
const BYTE_RANGE_HEADER = `bytes=0-${String(FIRST_KIB_BYTES - 1)}`;

/** The addresses a media response may never carry: the opaque source reference of the seeded original, and the store's own custody paths. */
const PRIVATE_MEDIA_MARKERS = ["welcome-sunday-raw.mp4", "evening-talk-raw.mp4", "media-originals", "public/fixtures", "IMG_20260814"] as const;

/** What a rendition address is never: a static file under the application's public directory, a blob URL, a data URL, or another origin. */
const PUBLIC_PATH_MARKERS = ["/fixtures/", "/public/", "blob:", "data:", "http://", "https://"] as const;

/** The address every rendition is served from, and the only shape a rendition address may have. */
const MEDIA_ROUTE = /^\/api\/media\/[A-Za-z0-9][A-Za-z0-9._:-]*\/[A-Za-z0-9][A-Za-z0-9._:%-]*$/u;

/** The measure of the criterion's "no media in the notice": every element that would carry an image, a video, a player, a poster or a track. */
const MEDIA_IN_MARKUP = [/<img\b/iu, /<video\b/iu, /<audio\b/iu, /<source\b/iu, /<track\b/iu, /<iframe\b/iu, /<object\b/iu, /<embed\b/iu, /autoplay/iu, /poster=/iu] as const;

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

/** The identifier a caller mints for one attempt: the identity every replay of that attempt is recognised by. */
function newAttemptId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------------------------
// The seeded identities, and the cookie that is the whole of an identity
// ---------------------------------------------------------------------------------------------

/** The origin the application is served from, taken from an answer the browser's own request context received. */
async function originOf(page: Page): Promise<string> {
  return new URL((await page.request.get("/api/session")).url()).origin;
}

/** Puts one seeded session in the browser context's cookie jar, which is the whole of the identity a request is authorised as. */
async function actAs(context: BrowserContext, origin: string, persona: PersonaName): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: SESSION_COOKIE, value: SEEDED_PERSONAS[persona].sessionId, url: origin }]);
}

// ---------------------------------------------------------------------------------------------
// The development controls: the scenario a session is in
// ---------------------------------------------------------------------------------------------

/** What one session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/**
 * Reads this session's development state.
 *
 * Every control presents the scope and the revision it read, exactly as `resetSeed` does, because the service
 * re-authorises the scope and answers `conflict` for a revision that no longer stands. Reading the state
 * immediately before each control is what keeps a second control in one test from presenting a revision the
 * first one moved.
 */
async function readDevState(page: Page): Promise<DevState> {
  const body = await jsonOf(await page.request.get("/api/dev"), "GET /api/dev");
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
    throw new Error(`The development control ${action} was refused: ${JSON.stringify(body).slice(0, 400)}. A spec that could not reach the scenario it names would assert against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`);
  }
  return body;
}

/** Puts this session in one named scenario, which is how a source that is down is exercised without waiting for one. */
async function setScenario(page: Page, scenarioId: string): Promise<void> {
  await operateDevControl(page, "setScenario", { scenarioId });
}

// ---------------------------------------------------------------------------------------------
// The application's own reads and writes, called the way the browser calls them
// ---------------------------------------------------------------------------------------------

/** The authority one edition's writes run under: the scope the overview stated, and the edition's own record revision. */
interface EditionAuthority {
  readonly scope: JsonRecord;
  readonly recordRevision: string;
}

/** One edition's row inside the Update overview, which is where its own revision and release head are stated. */
function editionRowOf(overview: unknown, variantId: string): JsonRecord {
  const editions = arrayAt(overview, ["data", "editions"], "The Update overview's editions");
  const row = editions.find((entry) => isRecord(entry) && entry.variantId === variantId);
  if (!isRecord(row)) {
    throw new Error(`The Update overview does not list ${variantId}, so this file cannot name the edition it writes: ${JSON.stringify(overview).slice(0, 400)}`);
  }
  return row;
}

/** Reads one edition's overview entry, which states the scope, its own revision and its release head. */
async function readEditionOverview(page: Page, variantId: string = PROTECTED_VARIANT): Promise<{ readonly authority: EditionAuthority; readonly row: JsonRecord }> {
  const overview = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`), "GET /api/updates");
  const scope = fieldAt(overview, "scope");
  if (!isRecord(scope)) {
    throw new Error(`The Update overview answered without the scope it ran under: ${JSON.stringify(overview).slice(0, 400)}`);
  }
  const row = editionRowOf(overview, variantId);
  return { authority: { scope, recordRevision: stringAt(row, ["recordRevision"], `The record revision of ${variantId}`) }, row };
}

/**
 * Posts one named write against one edition and returns the answer.
 *
 * The revision is read immediately before the write rather than captured once, because each of the writes below moves
 * the edition's own revision: a submission, an approval and a release are three answers, and the second presenting the
 * first's revision would be answered `conflict` instead of applying.
 */
async function mutateEdition(page: Page, path: string, payload: JsonRecord, name: string, variantId: string = PROTECTED_VARIANT): Promise<unknown> {
  const { authority } = await readEditionOverview(page, variantId);
  const answer = await page.request.post(path, { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.recordRevision, payload } });
  const body = await jsonOf(answer, `POST ${path} (${name})`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "alreadyAccepted" && outcome !== "unchanged") {
    throw new Error(`${name} was refused, so the state this test names was never reached: ${JSON.stringify(body).slice(0, 600)}`);
  }
  return body;
}

/**
 * Posts one named write whose target is the Update document itself, presenting the document's own revision.
 *
 * A withdrawal of one edition is recorded against the document, so the revision it must present is the document's
 * rather than the edition's: the two move independently, and presenting the wrong one is answered `conflict` instead of
 * withdrawing anything.
 */
async function mutateDocument(page: Page, path: string, payload: JsonRecord, name: string): Promise<unknown> {
  const overview = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE_DOCUMENT)}`), "GET /api/updates");
  const scope = fieldAt(overview, "scope");
  if (!isRecord(scope)) {
    throw new Error(`The Update overview answered without the scope it ran under: ${JSON.stringify(overview).slice(0, 400)}`);
  }
  const answer = await page.request.post(path, { data: { operationId: newAttemptId(), scope, expectedRevision: stringAt(overview, ["revision"], "The Update document's revision"), payload } });
  const body = await jsonOf(answer, `POST ${path} (${name})`);
  const outcome = outcomeOf(body);
  if (outcome !== "accepted" && outcome !== "alreadyAccepted" && outcome !== "unchanged") {
    throw new Error(`${name} was refused, so the state this test names was never reached: ${JSON.stringify(body).slice(0, 600)}`);
  }
  return body;
}

/** One rendition response's status and headers, which is all a serving assertion needs from it. */
interface RenditionAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly contentType: string;
}

/** Requests one rendition of one asset, optionally as a byte range, and reports exactly what the response carried. The request travels as the persona the context currently holds. */
async function requestRendition(page: Page, address: string, range?: string): Promise<RenditionAnswer> {
  const answer = await page.request.get(address, range === undefined ? {} : { headers: { range } });
  const headers = answer.headers();
  return { status: answer.status(), headers, body: await answer.text(), contentType: headers["content-type"] ?? "" };
}

/** The address of one rendition of one asset, as the application emits it. */
function renditionAddressOf(assetId: string, rendition: string): string {
  return `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(rendition)}`;
}

// ---------------------------------------------------------------------------------------------
// The committed fixtures, and the one media picker every placement travels through
// ---------------------------------------------------------------------------------------------

/**
 * The absolute address of one committed media fixture.
 *
 * The picker is handed a real file, and the runner may be started from the repository root or from the application
 * package: the fixture sits under `apps/dashboard/public/fixtures/media` in the first case and
 * `public/fixtures/media` in the second. The path is therefore built from the directory the runner reports rather
 * than searched for, so a missing fixture fails with the address that was tried instead of sending the test looking
 * for a file nobody committed.
 */
function fixturePathOf(name: string): string {
  const packagePath = resolve(process.cwd(), join("public", "fixtures", "media", name));
  const checkoutPath = resolve(process.cwd(), join("apps", "dashboard", "public", "fixtures", "media", name));
  return basename(process.cwd()) === "dashboard" ? packagePath : checkoutPath;
}

/** The one media picker, as the dialog the application opens for a kind of media. */
function pickerOf(page: Page, kind: "image" | "video"): Locator {
  return page.locator(`[data-slot="media-picker"][data-kind="${kind}"]`);
}

/** The media pane of the editor, where the two add actions live and where a placement's own state is stated. */
function mediaPaneOf(page: Page): Locator {
  return page.locator('[data-slot="editor-media-pane"]');
}

/** Opens the protected edition's editor and waits for the editing surface itself rather than for a spinner. */
async function openEditor(page: Page): Promise<void> {
  await page.goto(EDITOR_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Update edition", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: EDITOR_NAME, exact: true })).toBeVisible();
}

/** Opens the picker for one kind of media from the editor's own add action, and waits for its first step. */
async function openPicker(page: Page, kind: "image" | "video"): Promise<Locator> {
  await mediaPaneOf(page)
    .getByRole("button", { name: kind === "video" ? "Add a video" : "Add an image", exact: true })
    .click();
  const picker = pickerOf(page, kind);
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute("data-phase", "choosing");
  return picker;
}

/** Shows the media pane's video list, which is the panel a video placement is stated in: the pane opens on images. */
async function showVideoPlacements(page: Page): Promise<void> {
  await mediaPaneOf(page).getByRole("tab", { name: "Videos", exact: true }).click();
  await expect(mediaPaneOf(page).getByRole("tabpanel", { name: "Videos", exact: true })).toBeVisible();
}

/** A video this file places, and the words it describes it with. */
interface VideoPlacementInput {
  readonly file: string;
  readonly altText?: string;
  readonly caption?: string;
  readonly credit?: string;
  readonly language?: string;
  readonly transcript?: string;
}

/**
 * Chooses one file in an open picker and waits for the picker's own description step, which is where the browser has
 * measured the file and the placement's words are entered.
 */
async function chooseFile(picker: Locator, file: string): Promise<void> {
  await picker.locator('input[type="file"]').setInputFiles(fixturePathOf(file));
  await expect(picker).toHaveAttribute("data-phase", "described");
}

/** Fills the placement's own words, each by the label a person reads above it. */
async function describePlacement(picker: Locator, input: VideoPlacementInput): Promise<void> {
  // The labels carry a required marker or an "(optional)" suffix, so each field is addressed by the start of the label
  // a person reads rather than by text that would have to guess which of the two it is.
  await picker.getByLabel(/^Alternative text/u).fill(input.altText ?? PLACEMENT_TEXT.altText);
  await picker.getByLabel(/^Caption/u).fill(input.caption ?? PLACEMENT_TEXT.caption);
  await picker.getByLabel(/^Credit/u).fill(input.credit ?? PLACEMENT_TEXT.credit);
  await picker.getByLabel(/^Language/u).fill(input.language ?? PLACEMENT_TEXT.language);
  await picker.getByLabel(/^Transcript/u).fill(input.transcript ?? TRANSCRIPT_TEXT);
}

/** Adds one video through the picker, closes it on its durable receipt, and reports the answer the service gave. */
async function placeVideo(page: Page, input: VideoPlacementInput): Promise<void> {
  const picker = await openPicker(page, "video");
  await chooseFile(picker, input.file);
  await describePlacement(picker, input);
  await picker.getByRole("button", { name: "Add this video", exact: true }).click();
  await expect(picker.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(picker).toBeHidden();
}

/** Reads the protected edition's saved draft, which is where a placement's asset identity and the revision a review freezes are stated. */
async function readDraftEdition(page: Page): Promise<{ readonly revisionId: string; readonly assetId: string }> {
  const draft = await jsonOf(await page.request.get(`/api/drafts?view=draft&variantId=${encodeURIComponent(PROTECTED_VARIANT)}`), "GET /api/drafts?view=draft");
  return { revisionId: stringAt(draft, ["data", "revision", "revisionId"], "The draft edition's revision"), assetId: stringAt(draft, ["data", "placements", "0", "assetId"], "The draft's first placement's asset") };
}

/** The release standing at the protected edition's head, as the overview states it. */
async function readHeadRelease(page: Page): Promise<{ readonly releaseId: string; readonly revisionId: string }> {
  const { row } = await readEditionOverview(page);
  return { releaseId: stringAt(row, ["headRelease", "releaseId"], "The protected edition's head release"), revisionId: stringAt(row, ["headRelease", "revisionId"], "The revision that head release published") };
}

/**
 * Sends the draft that holds the placed video through its one review step and releases it.
 *
 * This is the application's own path for content that carries media: a submission freezes the exact revision under
 * review, one approval answers it, and a release publishes that same revision. The three writes travel over their own
 * handlers because this build composes no release control (there is no publish-and-notify surface either, which the
 * file states where it notifies), and every answer is asserted rather than assumed, so the protected edition this test
 * then reads is really released rather than merely drafted.
 */
async function releaseProtectedEdition(page: Page): Promise<{ readonly releaseId: string; readonly revisionId: string; readonly previousReleaseId: string }> {
  const before = await readHeadRelease(page);
  const draft = await readDraftEdition(page);
  await mutateEdition(page, "/api/review", { operation: "submitForReview", variantId: PROTECTED_VARIANT, revisionId: draft.revisionId }, "submitForReview");
  await mutateEdition(page, "/api/review", { operation: "approveCandidate", candidateId: draft.revisionId }, "approveCandidate");
  const released = await mutateEdition(page, "/api/publish", { documentId: UPDATE_DOCUMENT, variants: [{ variantId: PROTECTED_VARIANT }] }, "publishVariants");
  const items = arrayAt(released, ["items"], "The release's per-edition results");
  const item = items.find((entry) => isRecord(entry) && entry.targetId === PROTECTED_VARIANT);
  if (!isRecord(item) || item.state !== "released") {
    throw new Error(`The release did not report this edition as released, so nothing protected was published: ${JSON.stringify(released).slice(0, 600)}`);
  }
  const head = await readHeadRelease(page);
  if (head.revisionId !== draft.revisionId) {
    throw new Error(`The released head stands on ${head.revisionId} rather than the revision the draft placed the video in (${draft.revisionId}).`);
  }
  return { releaseId: head.releaseId, revisionId: head.revisionId, previousReleaseId: before.releaseId };
}

// ---------------------------------------------------------------------------------------------
// The audience, the notice, and the inbox it arrives in
// ---------------------------------------------------------------------------------------------

/** Opens the acting person's own Update-email membership and confirms it, which is what makes them a recipient and a holder of a protected-reading grant. */
async function openAndConfirmOwnMembership(page: Page): Promise<string> {
  const { authority } = await readEditionOverview(page);
  const signup = await page.request.post("/api/audience", { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.recordRevision, payload: { publisherId: PUBLISHER, purpose: UPDATE_EMAIL_PURPOSE, email: OWN_ADDRESS } } });
  const signed = await jsonOf(signup, "POST /api/audience");
  if (outcomeOf(signed) !== "accepted") {
    throw new Error(`Opening the acting person's own membership was refused: ${JSON.stringify(signed).slice(0, 400)}`);
  }
  const membershipId = stringAt(signed, ["created", "0"], "The membership a signup minted");
  const confirmation = await page.request.post("/api/confirm", { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: stringAt(signed, ["revision"], "The minted membership's own revision"), payload: { membershipId } } });
  const confirmed = await jsonOf(confirmation, "POST /api/confirm");
  if (outcomeOf(confirmed) !== "accepted") {
    throw new Error(`Confirming that membership inside its window was refused: ${JSON.stringify(confirmed).slice(0, 400)}`);
  }
  return membershipId;
}

/** Submits one notice for one released edition, which is the act a publish-and-notify control would perform. */
async function submitNotice(page: Page, releaseId: string): Promise<unknown> {
  const { authority } = await readEditionOverview(page);
  const answer = await page.request.post("/api/notify", { data: { operationId: newAttemptId(), scope: authority.scope, expectedRevision: authority.recordRevision, payload: { documentId: UPDATE_DOCUMENT, releaseId } } });
  const body = await jsonOf(answer, "POST /api/notify");
  if (outcomeOf(body) !== "accepted") {
    throw new Error(`The notice was not submitted, so the inbox this test reads would hold nothing: ${JSON.stringify(body).slice(0, 600)}`);
  }
  return body;
}

/** The inbox of whichever membership acts, read the way the inbox surface reads it. */
async function readInbox(page: Page): Promise<unknown> {
  return jsonOf(await page.request.get("/api/inbox"), "GET /api/inbox");
}

// ---------------------------------------------------------------------------------------------
// One placement's stated facts, read off the row that states them
// ---------------------------------------------------------------------------------------------

/** The value the placement row states for one label, so "the video carries no caption track" is read rather than inferred. */
async function placementFact(row: Locator, label: string): Promise<string> {
  return (await row.locator(`dt:text-is("${label}") + dd`).innerText()).trim();
}

/**
 * Holds the next registration request open, so the picker's *preparing* state is observed while it lasts rather than
 * caught by luck.
 *
 * This delays one response; it does not skip an effect. The handler is the browser's, the request is the one the
 * picker really sends, and releasing the hold lets it complete unchanged. A state that exists for as long as a local
 * decode takes is otherwise unobservable, and a test that could only ever see the states either side of it would
 * assert less than the criterion asks.
 */
async function holdNextRegistration(page: Page): Promise<{ readonly reached: Promise<void>; readonly release: () => void }> {
  let signalReached = (): void => {};
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

// ---------------------------------------------------------------------------------------------
// 1. A chosen video is checked by its content, prepared here, and each state stays distinct
// ---------------------------------------------------------------------------------------------

test("a chosen video is checked by its own content, prepared on this device, and each state it can be in stays distinct", async ({ page }) => {
  await openEditor(page);
  // The shell's development label is present on the surface the whole journey runs on: every effect below is
  // simulated, and a person who mistook this for production would read a local preparation as production scanning.
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();

  // Prose this test puts there, so "the text around the placement is untouched" is an assertion about a sentence
  // only this test wrote. The editor's own status line reports the save; nothing here reads a timer.
  const editor = page.getByRole("textbox", { name: EDITOR_NAME, exact: true });
  await editor.click();
  await editor.pressSequentially(TYPED_PROSE);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();

  // --- the picker states what it admits before any work begins ------------------------------
  const picker = await openPicker(page, "video");
  await expect(picker.getByText("What this placement admits", { exact: true })).toBeVisible();
  await expect(picker.getByText(/MP4 with H\.264 video and AAC audio, or WebM with VP8 or VP9 video and Vorbis or Opus audio/u).first()).toBeVisible();
  await expect(picker.getByText("No more than 100 MiB.", { exact: true })).toBeVisible();
  await expect(picker.getByText("No longer than 3 minutes.", { exact: true })).toBeVisible();
  await expect(picker.getByText("No larger than 1,920 × 1,080 pixels.", { exact: true })).toBeVisible();
  // The one sentence that makes a filename irrelevant: the file is typed by its content, never by its name.
  await expect(picker.getByText(/This application checks the file.s content itself, so a name or an extension never decides what a file is/u)).toBeVisible();
  // The simulated boundary is labelled where the upload is triggered, not only in the result.
  await expect(picker.locator('[data-slot="simulation-label"][data-simulation-effect="media-preparation"]')).toContainText(LOCAL_PROCESSING);

  // --- preparing, observed while it lasts ---------------------------------------------------
  const held = await holdNextRegistration(page);
  await chooseFile(picker, "sample-h264.mp4");
  await describePlacement(picker, { file: "sample-h264.mp4" });
  // No poster is offered for this placement: a poster is an image already registered in this draft, and this draft
  // holds none. The picker states the absence rather than offering a choice that would resolve to nothing, and the
  // poster a player shows is the asset's own rendition, asserted on the released page edition below.
  await expect(picker.getByText("Poster", { exact: true })).toHaveCount(0);
  await picker.getByRole("button", { name: "Add this video", exact: true }).click();
  await held.reached;
  await expect(picker).toHaveAttribute("data-phase", "preparing");
  await expect(picker.locator('[aria-label="Preparing this video"]')).toBeVisible();
  await expect(picker.getByText("Preparing…", { exact: true })).toBeVisible();
  await expect(picker.getByText(/Preparing this file with the local media pipeline: it is decoded, checked, re-encoded so its metadata is removed, and stored\. Nothing is published\./u)).toBeVisible();
  await expect(picker.getByRole("button", { name: "Stop waiting", exact: true })).toBeVisible();

  // --- ready --------------------------------------------------------------------------------
  held.release();
  const receipt = picker.locator('[data-slot="operation-result"]');
  await expect(receipt).toHaveAttribute("data-outcome", "accepted");
  // The receipt states that one effect was applied and that it is recorded, and it repeats that this was local
  // processing rather than production scanning.
  await expect(receipt).toContainText("The change was applied once");
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
  expect(await placementFact(placed, "Placed for")).toBe("playback, transcript");
  expect(await placementFact(placed, "Alternative text")).toBe(PLACEMENT_TEXT.altText);
  expect(await placementFact(placed, "Credit")).toBe(PLACEMENT_TEXT.credit);
  // The record states what this asset really carries. Registering a file sends that file's own bytes, so the asset
  // holds the playback and transcript renditions prepared for it and a poster and caption track it does not have —
  // and the row says "None" rather than implying media nothing would serve.
  expect(await placementFact(placed, "Transcript")).toBe("Present");
  expect(await placementFact(placed, "Caption track")).toBe("None");
  expect(await placementFact(placed, "Poster")).toBe("None");

  // --- the second admitted container: a WebM is accepted by the same profile check ------------
  await placeVideo(page, { file: "sample-vp9.webm", altText: "A second short clip for supporters", caption: "Another welcome" });
  await showVideoPlacements(page);
  await expect(videos).toHaveCount(2);

  // --- rejected: a container the profile does not admit, with a reason and a next step -------
  const rejecting = await openPicker(page, "video");
  await chooseFile(rejecting, "sample-unsupported.mkv");
  await describePlacement(rejecting, { file: "sample-unsupported.mkv", altText: "A clip that will not be admitted" });
  await rejecting.getByRole("button", { name: "Add this video", exact: true }).click();
  // The refusal states why this content was refused and what to do instead; it is not a bare failure.
  await expect(rejecting.getByText(CONTAINER_REFUSAL)).toBeVisible();
  await expect(rejecting.getByText(CONTAINER_NEXT_STEP)).toBeVisible();
  // An invalid attempt changes nothing, so it stays on the form rather than presenting a receipt as if something had
  // been registered.
  await expect(rejecting).toHaveAttribute("data-phase", "described");
  await expect(rejecting.locator('[data-slot="operation-result"]')).toHaveCount(0);
  // The editor states the same refusal in its own summary, beside the media it applies to.
  await expect(mediaPaneOf(page).getByText("This media was not placed", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rejecting).toBeHidden();
  // No placement was added, and the text and the two successful media are exactly as they were.
  await showVideoPlacements(page);
  await expect(videos).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: EDITOR_NAME, exact: true })).toContainText(TYPED_PROSE);

  // --- cancelled: stopping the wait, with the prose untouched --------------------------------
  const cancelling = await holdNextRegistration(page);
  const cancelledPicker = await openPicker(page, "video");
  await chooseFile(cancelledPicker, "sample-h264.mp4");
  await describePlacement(cancelledPicker, { file: "sample-h264.mp4", altText: "A clip the worker stops waiting for" });
  await cancelledPicker.getByRole("button", { name: "Add this video", exact: true }).click();
  await cancelling.reached;
  await cancelledPicker.getByRole("button", { name: "Stop waiting", exact: true }).click();
  // Cancelled is its own state, worded as the wait it stopped rather than as a failure of the file.
  await expect(cancelledPicker).toHaveAttribute("data-phase", "cancelled");
  await expect(cancelledPicker.getByText("No media added", { exact: true })).toBeVisible();
  await expect(cancelledPicker.getByText(/You stopped waiting\. The request had already been sent, so its result appears here when it arrives\. Nothing in your draft was changed\./u)).toBeVisible();
  // The request that was already sent is answered rather than discarded: it states what happened, and it never
  // presents a sent request as a failed one.
  cancelling.release();
  await expect(cancelledPicker.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
  await cancelledPicker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(cancelledPicker).toBeHidden();
  await page.unroute("**/api/media");
  // The prose the picker covered is the text this test typed, untouched by the cancelled attempt, and the media
  // placed before it is still there.
  await expect(page.getByRole("textbox", { name: EDITOR_NAME, exact: true })).toContainText(TYPED_PROSE);
  await showVideoPlacements(page);
  await expect(videos).toHaveCount(3);

  // --- unavailable: the source is down, and the answer says so instead of serving nothing --------
  // A source that is down is its own answer: not a zero-length rendition, not an empty list and not the neutral
  // refusal an unauthorised caller receives. The record keeps the media it holds, and the prose beside it is untouched.
  await setScenario(page, "media-unavailable");
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
  await setScenario(page, "baseline");
});

// ---------------------------------------------------------------------------------------------
// 2. The released edition plays its MP4 with a poster and a WebVTT caption track
// ---------------------------------------------------------------------------------------------

test("a released edition plays its MP4 with a poster and a WebVTT caption track, and never starts by itself with sound", async ({ page }) => {
  await page.goto(PAGE_READING_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Page edition", exact: true })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();

  // The one player the application renders: native semantic HTML with its own controls, so the browser's accessible
  // player is what a reader meets rather than a reimplementation of one.
  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("controls", "");

  const src = await video.getAttribute("src");
  const poster = await video.getAttribute("poster");
  expect(src, "the player streams the seeded asset's playback rendition from the application's own route").toMatch(MEDIA_ROUTE);
  expect(src).toContain(SEEDED_VIDEO.assetId);
  expect(src).toContain(SEEDED_VIDEO.playback);
  expect(poster, "the poster is the asset's own poster rendition, served by the same route").toMatch(MEDIA_ROUTE);
  expect(poster).toContain(SEEDED_VIDEO.poster);

  // Nothing starts by itself: the element carries no autoplay attribute, and the state read below states that it is
  // paused. Both assertions are on the player's own properties, never on a picture of it.
  await expect(video).not.toHaveAttribute("autoplay", /.*/u);
  await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).readyState), { message: "the player reaches a playable readyState" }).toBeGreaterThanOrEqual(1);
  const state = await video.evaluate((element) => {
    const player = element as HTMLVideoElement;
    return { paused: player.paused, readyState: player.readyState, duration: player.duration, muted: player.muted, controls: player.controls, autoplay: player.autoplay };
  });
  expect(state.controls, "the player keeps the browser's own controls").toBe(true);
  expect(state.autoplay, "the player does not start by itself").toBe(false);
  expect(state.paused, "a player that does not autoplay is paused on first render").toBe(true);
  if (state.autoplay) {
    // The other half of the same rule: a player that did start by itself would have to be silent.
    expect(state.muted, "a player that starts by itself must be silent").toBe(true);
  }
  expect(state.readyState, "the browser has the media's own metadata").toBeGreaterThanOrEqual(1);
  expect(Math.round(state.duration), "the two-second fixture is the media the player holds").toBe(2);

  // The caption track is a caption track: its own kind, language and label, served from the scoped route.
  const captions = video.locator('track[kind="captions"]');
  await expect(captions).toHaveCount(1);
  await expect(captions).toHaveAttribute("srclang", "en");
  await expect(captions).toHaveAttribute("label", "English");
  const captionsSrc = await captions.getAttribute("src");
  expect(captionsSrc, "the caption track is a rendition of this application, not a file on a public path").toMatch(MEDIA_ROUTE);
  expect(captionsSrc).toContain(SEEDED_VIDEO.captions);

  // What those two addresses really serve: a JPEG poster and a WebVTT caption file, both read as the contributor.
  const posterAnswer = await requestRendition(page, poster ?? "");
  expect(posterAnswer.status, "the poster rendition is served to the contributor").toBe(200);
  expect(posterAnswer.contentType).toContain("image/jpeg");
  const captionsAnswer = await requestRendition(page, captionsSrc ?? "");
  expect(captionsAnswer.status, "the caption rendition is served to the contributor").toBe(200);
  expect(captionsAnswer.contentType).toContain("text/vtt");
  expect(captionsAnswer.body.trimStart().startsWith("WEBVTT"), "the caption track is WebVTT rather than any text that happened to be there").toBe(true);

  // The transcript is the placement's reading alternative: an anchor in the same figure as the player, pointing at
  // that asset's own transcript rendition, which the same route serves as WebVTT.
  const playerFigure = page
    .locator("figure")
    .filter({ has: page.locator("video") })
    .first();
  const transcriptLink = playerFigure.getByRole("link", { name: /Read the transcript/u });
  await expect(transcriptLink, "the placement offers the transcript alternative the catalogue promises").toHaveCount(1);
  const transcriptSrc = await transcriptLink.getAttribute("href");
  expect(transcriptSrc, "the transcript alternative is a rendition of this application, not a file on a public path").toMatch(MEDIA_ROUTE);
  expect(transcriptSrc).toContain(SEEDED_VIDEO.transcript);
  const transcriptAnswer = await requestRendition(page, transcriptSrc ?? "");
  expect(transcriptAnswer.status, "the transcript rendition is served to the contributor").toBe(200);
  expect(transcriptAnswer.contentType).toContain("text/vtt");

  // The surface states that its reach is demonstrated rather than pushed to a real audience.
  await expect(page.getByText("simulated publication; reach is demonstrated in the receiving preview", { exact: true }).first()).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// 3. Every rendition address is the application's own scoped route, and a byte range is partial
// ---------------------------------------------------------------------------------------------

test("every rendition is served by the application's own scoped route, and a byte range returns a partial response", async ({ page }) => {
  // The addresses the released edition emitted, read from the player itself rather than composed here: a test that
  // built its own addresses would prove what the route admits, not what the application serves.
  await page.goto(PAGE_READING_PATH);
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
    for (const marker of PUBLIC_PATH_MARKERS) {
      expect(address ?? "", `the ${what} address is never a static public path (${marker})`).not.toContain(marker);
    }
  }

  // The whole rendition first, because the partial one is measured against it.
  const whole = await requestRendition(page, seededPlayback ?? "");
  expect(whole.status, "the whole playback rendition is served to the contributor").toBe(200);
  expect(whole.contentType).toContain("video/mp4");
  expect(whole.headers["accept-ranges"], "the route states that it accepts byte ranges").toBe("bytes");
  expect(whole.headers["cache-control"], "a rendition is never stored or shared").toBe("private, no-store");
  expect(whole.headers["x-content-type-options"], "a rendition is never sniffed into another type").toBe("nosniff");

  // The range a player starts with: the first kibibyte, answered as a partial response whose own window states the
  // entity's size, so the size is read from the answer rather than assumed.
  const partial = await requestRendition(page, seededPlayback ?? "", BYTE_RANGE_HEADER);
  expect(partial.status, "a byte range is answered as partial content").toBe(206);
  const contentRange = partial.headers["content-range"] ?? "";
  expect(contentRange, "a partial response states the window it carries and the entity's size").toMatch(/^bytes 0-1023\/\d+$/u);
  const totalBytes = Number(contentRange.split("/")[1]);
  expect(Number.isSafeInteger(totalBytes) && totalBytes > FIRST_KIB_BYTES, `the fixture is larger than the range asked for (${String(totalBytes)} bytes)`).toBe(true);
  expect(partial.body.length, "the partial response carries the window rather than the whole entity").toBeLessThan(whole.body.length);

  // A window that names no byte of the entity is refused as unsatisfiable rather than answered with the whole file.
  const beyond = await requestRendition(page, seededPlayback ?? "", `bytes=${String(totalBytes)}-`);
  expect(beyond.status, "a range past the end is not satisfied").toBe(416);
  expect(beyond.headers["content-range"], "the refusal states the entity's size and no window").toBe(`bytes */${String(totalBytes)}`);

  // --- the asset this file uploads is served by the same route, with its own transcript ---------
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

  // No response states where the bytes came from: the store's custody path and the source original's name are the
  // two things a rendition response could leak, and neither appears in a header or a body.
  for (const answer of [whole, partial, beyond, uploadedPartial, transcript]) {
    const headers = JSON.stringify(answer.headers);
    for (const marker of PRIVATE_MEDIA_MARKERS) {
      expect(headers, `no response header names ${marker}`).not.toContain(marker);
      expect(answer.body, `no response body names ${marker}`).not.toContain(marker);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 4. Another persona's direct request for the playback, poster, captions and transcript is denied
// ---------------------------------------------------------------------------------------------

test("another persona's direct request for playback, poster, captions and transcript is denied, with and without a byte range", async ({ page, context }) => {
  const origin = await originOf(page);

  // The public asset's three addresses, as the reading view emitted them, and the protected edition's own after it is
  // released: six addresses that really exist and one that never did.
  await page.goto(PAGE_READING_PATH);
  const seededPlayer = page.locator("video").first();
  const seededPlayback = (await seededPlayer.getAttribute("src")) ?? "";
  const seededPoster = (await seededPlayer.getAttribute("poster")) ?? "";
  const seededCaptions = (await seededPlayer.locator('track[kind="captions"]').getAttribute("src")) ?? "";

  await openEditor(page);
  await placeVideo(page, { file: "sample-h264.mp4", altText: "A welcome only supporters may see" });
  const released = await releaseProtectedEdition(page);
  const draft = await readDraftEdition(page);
  // The preview renders the released revision, so both addresses below are ones the application emitted.
  await page.goto(`${EDITOR_PATH}/preview`);
  const protectedPlayback = (await page.locator("video").first().getAttribute("src")) ?? "";
  // The placement's own transcript link, read from the figure the player stands in: the preview also lists the same
  // rendition in its media region, and the alternative this address is taken from is the one beside the player.
  const transcriptLink = page
    .locator("figure")
    .filter({ has: page.locator("video") })
    .getByRole("link", { name: /Read the transcript for/u });
  await expect(transcriptLink).toBeVisible();
  const protectedTranscript = (await transcriptLink.getAttribute("href")) ?? "";
  const protectedPoster = renditionAddressOf(draft.assetId, "poster");
  const protectedCaptions = renditionAddressOf(draft.assetId, "captions");
  const protectedMedia = [protectedPlayback, protectedPoster, protectedCaptions, protectedTranscript];
  for (const address of [protectedPlayback, protectedTranscript]) {
    expect(address, "the protected edition's own addresses are this application's rendition route").toMatch(MEDIA_ROUTE);
  }

  // The positive control, on the same address the denials below are measured against: the scope that owns the asset
  // reads it, so a refusal is about the caller rather than about an address nothing serves. The release really moved
  // the edition's head, which is what makes the asset one a live protected edition places.
  expect(released.releaseId, "the release published a new head rather than restating the seeded one").not.toBe(released.previousReleaseId);
  const mine = await requestRendition(page, protectedPlayback, BYTE_RANGE_HEADER);
  expect(mine.status, "the contributor reads the protected asset they placed").toBe(206);
  expect(mine.headers["content-range"]).toBeDefined();

  // --- the outside worker: another ministry, which shares no scope with this one -------------
  await actAs(context, origin, OUTSIDE_WORKER_PERSONA);
  const workerAnswers = [...protectedMedia, seededPlayback, seededPoster, seededCaptions];
  const workerDenied = await expectDenied(page, workerAnswers, "the outside worker");
  // The same answer for an address naming no asset this application ever minted, which is what keeps a refusal from
  // disclosing whether something exists behind it.
  const unminted = await requestRendition(page, renditionAddressOf("asset-never-registered", "playback"));
  expect(unminted.status, "an address naming no asset is refused exactly as an unauthorised one is").toBe(workerDenied.status);
  expect(unminted.body.trim(), "an unauthorised address and one that never existed are indistinguishable").toBe(workerDenied.body.trim());

  // --- a reader with no protected-reading grant ----------------------------------------------
  await actAs(context, origin, OUTSIDE_READER_PERSONA);
  // The public edition's playback rendition is readable by this reader, which is what makes the refusal below a
  // decision about the grant rather than a reader being refused everything.
  const publicForReader = await requestRendition(page, seededPlayback);
  expect(publicForReader.status, "a reader without a grant still reads the public edition's media").toBe(200);
  await expectDenied(page, protectedMedia, "a reader holding no grant");
  // The caption track is not a route around the denied video, and neither is the poster or the transcript: all four
  // are refused with one answer, with and without a byte range.
  const captionsOnly = await requestRendition(page, protectedCaptions, BYTE_RANGE_HEADER);
  expect(captionsOnly.status, "the caption track is refused exactly as the playback is").toBe(workerDenied.status);
  expect(captionsOnly.body.trim()).toBe(workerDenied.body.trim());
  expect(captionsOnly.headers["content-range"], "a refused range states no window").toBeUndefined();
  expect(captionsOnly.headers["accept-ranges"], "a refused range offers no accept-ranges").toBeUndefined();

  // --- the contributor again -------------------------------------------------------------------
  // Restoring the owner proves the refusals above were decisions about those callers rather than a restriction the
  // requests themselves caused: the same address answers the scope that owns the asset, unchanged.
  await actAs(context, origin, CONTRIBUTOR_PERSONA);
  const ownerAgain = await requestRendition(page, protectedPlayback);
  expect(ownerAgain.status, "the protected asset is still served to the scope that owns it").toBe(200);
  expect(ownerAgain.body.length, "the whole rendition is served, not a fragment of it").toBeGreaterThan(FIRST_KIB_BYTES);
});

/**
 * Asserts every one of the given addresses is refused for the persona the context now holds, with and without a byte
 * range, and that every refusal is the same one answer: no bytes, no length, no window and no existence hint.
 */
async function expectDenied(page: Page, addresses: readonly string[], who: string): Promise<{ readonly status: number; readonly body: string }> {
  const answers: { readonly status: number; readonly body: string }[] = [];
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
      for (const marker of PRIVATE_MEDIA_MARKERS) {
        expect(answer.body, `a refusal names no source file (${marker})`).not.toContain(marker);
      }
      answers.push({ status: answer.status, body: answer.body.trim() });
    }
  }
  const distinct = new Set(answers.map((answer) => `${String(answer.status)} ${answer.body}`));
  expect([...distinct], "every refusal is the same answer, so none of them distinguishes one address from another").toHaveLength(1);
  const [first] = answers;
  if (first === undefined) {
    throw new Error("No address was asserted: this helper needs at least one rendition address to refuse.");
  }
  return first;
}

// ---------------------------------------------------------------------------------------------
// 5. The protected notice carries no protected prose or media, and its link re-checks access
// ---------------------------------------------------------------------------------------------

test("a protected notice carries no protected prose or media, and the link it carries re-checks access", async ({ page, context }) => {
  const origin = await originOf(page);

  // --- the link before any grant: the public edition, and no protected sentence anywhere on it ----
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.getByText(PUBLIC_PROSE).first()).toBeVisible();
  await expect(page.getByText(PROTECTED_PROSE), "a reader without a grant is never served the protected prose").toHaveCount(0);

  // --- the same session, after opening and confirming its own membership ------------------------
  // This is a deliberate act on the acting person's own address, through the application's own signup and proof
  // steps; nothing here imports consent or subscribes a partner. Once it is confirmed, the very same link serves the
  // protected edition — the grant is decided when the address is opened, not taken from anything received earlier.
  const membershipId = await openAndConfirmOwnMembership(page);
  expect(membershipId.length, "the membership the proof step confirmed has an identity").toBeGreaterThan(0);
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.getByText(PROTECTED_PROSE).first(), "the link re-checks access, so the protected edition is served now").toBeVisible();
  await expect(page.getByText(PUBLIC_PROSE)).toHaveCount(0);

  // --- the edition this test notifies: its own prose, and a video that is prepared here --------
  await openEditor(page);
  const editor = page.getByRole("textbox", { name: EDITOR_NAME, exact: true });
  await editor.click();
  await editor.pressSequentially(PROTECTED_PROSE);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  await placeVideo(page, { file: "sample-h264.mp4", altText: "A welcome for supporters only" });
  const released = await releaseProtectedEdition(page);
  const draft = await readDraftEdition(page);
  expect(released.revisionId, "the release published the revision that carries the video").toBe(draft.revisionId);

  // --- the notice, submitted through its own handler -------------------------------------------
  const notice = await submitNotice(page, released.releaseId);
  const intentId = stringAt(notice, ["created", "0"], "The intent the notice created");

  // --- what the message really is: a sender, a subject and a link ------------------------------
  const inbox = await readInbox(page);
  expect(numberOf(inbox, ["data", "intentCount"], "Messages in this inbox")).toBe(1);
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
  // What it does carry: the sender, a generic subject and the link, which is the whole of the message.
  expect(stringAt(message, ["subject"], "The notice's subject")).toBe("New update");
  expect(stringAt(message, ["sender"], "The notice's sender")).toContain("update-notice@example.invalid");
  expect(html, "the notice points at the receiving surface").toContain(UPDATE_READING_PATH);
  expect(plain, "the plain-text notice points at the receiving surface").toContain(UPDATE_READING_PATH);

  // --- the synthetic inbox, as a reader meets it ------------------------------------------------
  await page.goto(INBOX_PATH);
  await expect(page.getByRole("heading", { level: 2, name: "Messages produced for this membership" })).toBeVisible();
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true }).first()).toBeVisible();
  // The recorded outcome is stated as acceptance, and the surface says in its own words that acceptance is neither a
  // delivered message nor a read one.
  await expect(page.getByText(/Send outcome: Accepted — not delivered/u).first()).toBeVisible();
  await expect(page.getByText(/It is not a delivered message and not a read one/u)).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toHaveCount(0);
  // The row states the body this message carries: a protected notice, not the Update.
  await expect(page.getByText("Notice body: Protected notice", { exact: true })).toBeVisible();
  // The message itself is opened from the inbox's own row, which is the act a recipient performs.
  await page.getByRole("button", { name: /^Open the message/u }).click();
  await expect(page.getByRole("heading", { level: 3, name: "The message as it was produced for this recipient" })).toBeVisible();
  await expect(page.getByText("A protected Update arrives as a link, not as the Update itself", { exact: true })).toBeVisible();
  await expect(page.getByText(/It holds no protected prose, no image, no location, no poster, no transcript and no caption/u)).toBeVisible();
  const openProtected = page.getByRole("link", { name: "Open the protected Update", exact: true });
  await expect(openProtected).toHaveAttribute("href", UPDATE_READING_PATH);
  // A protected notice is not the Update, so there is no rendering of it to switch between.
  await expect(page.getByRole("tab", { name: "HTML", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Plain text", exact: true })).toHaveCount(0);
  // Nothing that could carry the edition's own media or its own words is on this screen.
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByText(PROTECTED_PROSE)).toHaveCount(0);
  await expect(page.getByText(TRANSCRIPT_TEXT)).toHaveCount(0);
  await expect(page.getByText(PLACEMENT_TEXT.altText)).toHaveCount(0);
  await expect(page.getByText(SIMULATED_MAIL, { exact: true }).first()).toBeVisible();

  // --- the transcript is on the edition, where the link leads, not in the message ----------------
  await page.goto(`${EDITOR_PATH}/preview`);
  // The placement's own alternative, read from the figure the player stands in rather than from the preview's media
  // region, which lists the same rendition beside it.
  const transcriptLink = page
    .locator("figure")
    .filter({ has: page.locator("video") })
    .getByRole("link", { name: /Read the transcript for/u });
  await expect(transcriptLink, "the released edition offers its transcript as the text alternative").toBeVisible();
  const transcriptAnswer = await requestRendition(page, (await transcriptLink.getAttribute("href")) ?? "");
  expect(transcriptAnswer.status, "the transcript rendition is readable where the edition is").toBe(200);
  expect(transcriptAnswer.body.trim()).toBe(TRANSCRIPT_TEXT);

  // --- the link decides access at the moment it is followed -------------------------------------
  // Withdrawing this Update's two public editions leaves the protected edition as the only one it serves, which is
  // where "opening the link" has one honest answer for each reader rather than a public edition standing in for the
  // protected one. Withdrawal recalls nothing; it ends access from now on.
  for (const variantId of PUBLIC_EDITIONS) {
    await mutateDocument(page, "/api/withdraw", { operation: "withdrawLocale", variantId }, "withdrawLocale");
  }
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.getByText(PROTECTED_PROSE).first(), "the grant holder still reads the protected edition at the link").toBeVisible();
  await expect(page.locator("video").first(), "and still plays the edition's own video").toBeVisible();

  await actAs(context, origin, OUTSIDE_READER_PERSONA);
  await page.goto(`${UPDATE_READING_PATH}?locale=en`);
  await expect(page.locator('[data-slot="receiving-post-denied"]'), "a reader without the grant is refused at the same link").toBeVisible();
  await expect(page.getByRole("heading", { name: "This edition cannot be read here", exact: true })).toBeVisible();
  await expect(page.getByText(PROTECTED_PROSE), "the refusal discloses no protected prose").toHaveCount(0);
  await expect(page.locator("video"), "and no protected media").toHaveCount(0);
});
