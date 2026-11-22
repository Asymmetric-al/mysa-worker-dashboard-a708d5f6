/**
 * Criterion 9 — Update publication.
 *
 * One Update edition is composed with prose and an image, its exact submitted revision is previewed
 * inertly, one review step answers that frozen revision, the release publishes the revision the preview
 * named, and a later draft edit leaves that release standing while the served image carries no source
 * file name and no source metadata (AAP 0.12.1 criterion 9; AAP 0.8.5 for the one review step and the
 * Publish-only/Publish-and-notify pair; AAP 0.8.6 and 0.8.7 for the image profile, the metadata strip and
 * the 2,000 px display rendition).
 *
 * **The scenario this file drives, from the deterministic seed.**
 * - `doc-update-autumn` holds four editions of one canonical Update. The public English edition
 *   (`variant-update-autumn-en-public`) is the one composed here: it carries a published revision
 *   (`release-update-en-1`) and no saved draft, so the whole journey starts from an empty editor and the
 *   release this file publishes is genuinely a second release of that edition.
 * - The Arabic edition (`variant-update-autumn-ar-public`) already holds a draft
 *   (`rev-update-ar-draft-1`) and a frozen candidate (`rev-update-ar-candidate-1`) whose review record
 *   stands at `submitted`. That candidate is what the second test answers: it proves a frozen candidate
 *   is not a release without approving anything the first test depends on.
 * - The third journey takes the same English edition down the other branch of the author's one choice: its
 *   submission records *Publish and notify now*, the review states that decision as a fact it holds no control to
 *   change, and the release acknowledges the recipient ceiling the audience read stated while submitting exactly one
 *   notice. The notice's own identity is read from the release result's own link, which opens
 *   `/communication/delivery`, where the outcomes that notice recorded are stated beside both renderings of the
 *   message it carries.
 * - The faces are separate seats, as the seed states them: `established-worker` composes, submits and
 *   publishes inside the ministry it is admitted to, `content-reviewer` answers the *seeded* frozen
 *   candidate, `reader-public` is admitted to the published public edition and to nothing else, and
 *   `second-worker` belongs to another ministry entirely and must be refused the first scope's rendition.
 * - One session is one copy of the world (AAP 0.7.2: a session sees only its own files), which is what puts
 *   the reviewer seat on the candidate the seed gave it: a submission written in a session is that
 *   session's to answer, and this file asserts that isolation rather than assuming it. Both seats answer the
 *   same review surface, and approval is not publication on either.
 * - The image is the one seeded with source metadata: `public/fixtures/media/IMG_20260814-harbour-youth-group.jpg`
 *   is a 2,400 px JPEG carrying an Exif description, a camera maker and model, a GPS block and an
 *   orientation tag, and its own file name is the revealing part. It is chosen from `public/fixtures/media`
 *   — no image is added to the repository by this file — and it is the fixture the seed itself feeds
 *   through the local image pipeline for `asset-image-portrait`.
 *
 * **How every step is taken: on the surface the criterion describes.** The release is the separate act the
 * specification keeps distinct from the review, and it is pressed where the application composes it: the
 * editor's submit step freezes the exact revision under the author's own choice of *Publish only* or
 * *Publish and notify now*, the review route answers that frozen candidate, and `/communication/[updateId]`
 * composes the release review below the variant matrix, where the contributor ticks the edition and presses
 * the one *Release these editions* step. Each fact the criterion asks for is then read from the surface that
 * states it — the release head from the matrix's own publication facts, the mode the submission fixed from
 * the release review, the notice from the delivery surface — and never from a payload this file assembled.
 *
 * **The one attempt no surface offers.** `publishVariants` refuses a release mode the submission never asked
 * for, and no composed control can ask for one: the release review renders the recorded mode read-only, shows
 * the other choice with what it would have meant, and states in the service's words why it is refused. That
 * refusal is therefore asserted at the boundary that enforces it, under the contributor's own session, as the
 * only transport step in this file; everything else it writes is a control a person presses. The replay of one
 * recorded attempt — the other half of the release contract — is proven in `variants-and-rtl.spec.ts`, where an
 * uncertain result makes the surface state the attempt's own identity for the recovery to be read back under.
 *
 * **What it never does.** No committed image, no second editor, no second renderer and no new dependency:
 * the prose goes through the one Tiptap surface, the preview and the receiving post are the one static
 * renderer's output, the image is chosen through the one media picker, and the served bytes are inspected
 * as bytes rather than decoded with a library. No `.data/` read, no fixed wait and no snapshot: every
 * assertion on a page is a web-first expectation on a role, an accessible name or a stated word, and the
 * rest read an answer's own JSON or the artefact's own bytes, because those are the evidence this criterion
 * is decided on — which is also what the recorder over the picker's own phase attribute and the byte scan
 * are for.
 */
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { resetSeed } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded identities this file acts as
// ---------------------------------------------------------------------------------------------

/**
 * The name of the development-session cookie, mirrored once from `modules/store/sessions.ts`, where the
 * store declares it, and from the runner's own `SESSION_COOKIE`.
 *
 * Mirrored rather than imported because this file is handed the runner's reset and nothing else: a cookie
 * name is a value, not a contract, and stating it here keeps the runner's surface exactly as the file's
 * brief fixes it. The runner resolves a session from this cookie on every request, so a name that drifted
 * would fail loudly at the first admission rather than pass silently.
 */
const SESSION_COOKIE = "dashboard_session";

/** The worker who composes the edition, owns the release and is admitted to this ministry. */
const CONTRIBUTOR_SESSION = "established-worker";

/** The reviewer who answers the frozen candidate, admitted to the same ministry and nothing broader. */
const REVIEWER_SESSION = "content-reviewer";

/** A public reader: admitted to the published public edition, holding no ministry membership at all. */
const PUBLIC_READER_SESSION = "reader-public";

/** A worker in another ministry, whose scope shares nothing with this one: the isolation proof. */
const OUTSIDER_SESSION = "second-worker";

// ---------------------------------------------------------------------------------------------
// The seeded records this file compares against, each an identity the seed states
// ---------------------------------------------------------------------------------------------

/** The one Update this file composes, previews, reviews and releases. */
const UPDATE_DOCUMENT = "doc-update-autumn";

/** The public English edition that is composed and released here: published, and holding no saved draft. */
const PUBLIC_ENGLISH_EDITION = "variant-update-autumn-en-public";

/** The Arabic edition whose frozen candidate stands unanswered, so a candidate can be shown as not a release. */
const FROZEN_ARABIC_EDITION = "variant-update-autumn-ar-public";

/** The exact revision that edition's candidate froze, named by the seed and by its review record. */
const FROZEN_ARABIC_CANDIDATE = "rev-update-ar-candidate-1";

/** The one notice the seed recorded, and the release it was submitted for: it stays pinned to that release. */
const SEEDED_NOTICE_INTENT = "intent-update-autumn-en";
const SEEDED_NOTICE_RELEASE = "release-update-en-1";

/** How many recipients that notice recorded: one each of accepted, failed and unknown, plus two more accepted. */
const SEEDED_NOTICE_RECIPIENTS = 5;

// ---------------------------------------------------------------------------------------------
// The image, its source properties and the profile the application states for it
// ---------------------------------------------------------------------------------------------

/** The committed fixture this file chooses: the seeded image, whose own name is the revealing part. */
const EXIF_FIXTURE = "IMG_20260814-harbour-youth-group.jpg";

/** The distinct strings the source image carries in its Exif block, so their absence proves the strip. */
const EXIF_SOURCE_STRINGS = ["Exif", "Harbour Test Body", "Synthetic Camera Co.", "private original", "IMG_20260814"] as const;

/** The longest edge the display rendition is bounded to, from the one media profile (AAP 0.8.7). */
const DISPLAY_EDGE_PX = 2000;

/** The alternative text the picker requires, and the optional caption that travels beside it. */
const ALT_TEXT = "The youth group gathered in the church hall after a Friday meal.";
const CAPTION = "A Friday meal this term.";

// ---------------------------------------------------------------------------------------------
// The words the surfaces state, quoted so an assertion fails when the wording a reader depends on moves
// ---------------------------------------------------------------------------------------------

/** The label the shell states on every surface of this development build. */
const DEVELOPMENT_LABEL = "Development data";

/** The one sentence every simulated publication states, in the specification's own words (AAP 0.7.2). */
const PUBLICATION_SIMULATION = "simulated publication; reach is demonstrated in the receiving preview";

/** The sentence a notice states, which a publish-only release must never show. */
const MAIL_SIMULATION = "simulated — no mail leaves this application";

/** What the picker states about its own processing, so local work is never presented as production scanning. */
const LOCAL_PROCESSING = "local processing; not production scanning or transcoding";

/** The author's choice the review surface states as a fact, and the sentence that it cannot be flipped. */
const PUBLISH_ONLY_BADGE = "Publish only";
const REVIEWER_CANNOT_FLIP = "A reviewer cannot turn Publish only into Publish and notify now";

/** The other choice the editor offers: the two journeys that publish only never record it, and the third records it deliberately. */
const NOTIFY_NOW_CHOICE = "Publish and notify now";

/** Why the release review refuses the mode this submission never asked for, in the surface's own words. */
const MODE_NOT_ASKED_FOR = "A reviewer cannot release this edition with a mode the submission did not ask for, so a new submission is required.";

/** The heading and the count label the release review states for the audience the notice it would submit could reach. */
const CEILING_HEADING = "Who a notice could reach";
const CEILING_ELIGIBLE_LABEL = "Eligible recipients";

/** What the release review states its notice would point at, and what a result row calls the notice it submitted. */
const NOTICE_TARGET_LABEL = "The notice links to";
const NOTICE_IDENTITY_LABEL = "Notice submitted";
const NOTICE_RESULTS_LINK = "Open the recorded results for this notice";

/** The heading the delivery screen gives the message one notice carries, and the wording of that message's own link. */
const DELIVERY_MESSAGE_HEADING = "The message this notice carries";
const NOTICE_LINK_LABEL = "Open the update";

/** The one release step the overview route composes, and the confirmation inside the dialog it opens. */
const RELEASE_ACTION = "Release these editions";

/** The locale name the release review and its receipt state for the edition this file releases. */
const ENGLISH_LOCALE_NAME = "English";

/** What the release review's receipt heads one edition's row of a release with. */
const RELEASE_RESULT = "Release result";

/** What a release of an edition whose submission is still unanswered is refused with, in the service's words. */
const AWAITING_ITS_REVIEW = "This edition is still awaiting its one review, so it cannot be released yet.";

/** What the review surface states about the number of decisions a candidate gets. */
const ONE_DECISION_ONCE = "One decision, given once.";

/** What the variant matrix states for an edition that publishes nothing yet. */
const NOTHING_PUBLISHED = "This edition publishes nothing yet";

/** The durable word the review surface gives an approved candidate. */
const CANDIDATE_APPROVED = "This candidate is approved";

/** What the picker requires before it will place an image, stated in its own words. */
const MISSING_ALT_TEXT = "Describe what this image shows. It is read aloud in place of the picture.";

/** The prose this file publishes, and the later draft text that must never reach a reader. */
const PUBLISHED_PROSE = "This term the Friday group met every week, and six new faces joined us at the long table.";
const LATER_DRAFT_PROSE = "A later draft paragraph that no reader has been served, written after the release.";

// ---------------------------------------------------------------------------------------------
// The addresses this file drives, composed here the way a link composes them
// ---------------------------------------------------------------------------------------------

const editorPath = (variantId: string): string => `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}/${encodeURIComponent(variantId)}`;
const reviewPath = (variantId: string): string => `/communication/review/${encodeURIComponent(variantId)}`;
const overviewPath = (): string => `/communication/${encodeURIComponent(UPDATE_DOCUMENT)}`;
const deliveryPath = (intentId: string): string => `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
const receivingPostPath = (): string => `/preview/${encodeURIComponent(UPDATE_DOCUMENT)}?locale=en`;

const PUBLISH_API = "/api/publish";
const NOTIFY_API = "/api/notify";
const INBOX_API = "/api/inbox";
const DEV_API = "/api/dev";
const SESSION_API = "/api/session";

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

/** A string a capture depends on, refusing an absent or blank one rather than comparing nothing. */
function stringAt(value: unknown, path: readonly string[], what: string): string {
  const found = fieldAt(value, ...path);
  if (typeof found !== "string" || found.trim() === "") {
    throw new Error(`${what} is not at ${path.join(".")} of the answer this file read, so the assertion would have compared nothing: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** The outcome a mutation answered with, which is the only statement of what happened. */
function outcomeOf(body: unknown): string | undefined {
  const found = fieldAt(body, "outcome");
  return typeof found === "string" ? found : undefined;
}

/** The messages a refusal keyed at one field path, joined for matching, or an empty string where it keyed none. */
function messagesAt(body: unknown, path: string): string {
  const found = fieldAt(body, "fields", path);
  return Array.isArray(found) ? found.filter((message): message is string => typeof message === "string").join(" ") : "";
}

/** The identifier a caller mints for one attempt: the identity every replay of that attempt is recognised by. */
function newAttemptId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------------------------
// Acting as a seeded identity, and reading as one without disturbing the browser's own session
// ---------------------------------------------------------------------------------------------

/** The origin the application is served from, taken from an answer the browser's own request context received. */
async function originOf(page: Page): Promise<string> {
  return new URL((await page.request.get(SESSION_API)).url()).origin;
}

/**
 * Puts one seeded session in the browser context's cookie jar, which is the whole of the identity a request
 * is authorised as. The jar is cleared first, so a page driven after this switch is admitted as exactly the
 * persona named and never as the one before it.
 */
async function actAs(page: Page, origin: string, sessionId: string): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: SESSION_COOKIE, value: sessionId, url: origin }]);
}

/** The `Cookie` header one identity's request carries, for a read that states who it acts as without a page. */
function cookieOf(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}`;
}

/** Reads one address as one stated identity, answering the status and the parsed body. */
async function getAs(page: Page, sessionId: string, url: string): Promise<{ readonly status: number; readonly body: unknown }> {
  const answer = await page.request.get(url, { headers: { cookie: cookieOf(sessionId) } });
  return { status: answer.status(), body: await jsonOf(answer, `GET ${url} as ${sessionId}`) };
}

/** What one session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: JsonRecord;
  readonly revision: string;
}

/** Reads one session's development state, which is the scope and revision a mutation presents. */
async function readDevState(page: Page, sessionId: string): Promise<DevState> {
  const answer = await getAs(page, sessionId, DEV_API);
  const scope = fieldAt(answer.body, "scope");
  if (answer.status !== 200 || !isRecord(scope)) {
    throw new Error(`GET ${DEV_API} as ${sessionId} answered without the scope a mutation runs under: HTTP ${String(answer.status)} ${JSON.stringify(answer.body).slice(0, 400)}`);
  }
  return { scope, revision: stringAt(answer.body, ["revision"], "The development state's revision") };
}

/**
 * Posts one release attempt under one stated identity and returns the outcome the service answered.
 *
 * This is the only release request this file sends, and it sends it for the one attempt no composed control can
 * make: a release naming a mode the submission never asked for. The release review states the recorded mode
 * read-only and refuses the other choice, so a press cannot produce that payload — the refusal is asserted at the
 * boundary that enforces it rather than through an interface a person has no way to reach.
 */
async function postRelease(page: Page, sessionId: string, attempt: { readonly operationId: string; readonly state: DevState; readonly variants: readonly JsonRecord[] }): Promise<unknown> {
  const answer = await page.request.post(PUBLISH_API, { headers: { cookie: cookieOf(sessionId) }, data: { operationId: attempt.operationId, scope: attempt.state.scope, expectedRevision: attempt.state.revision, payload: { documentId: UPDATE_DOCUMENT, variants: attempt.variants } } });
  return jsonOf(answer, `POST ${PUBLISH_API} as ${sessionId}`);
}

// ---------------------------------------------------------------------------------------------
// Pressing the release: the review the overview route composes below the variant matrix
// ---------------------------------------------------------------------------------------------

/** The release review one Update's overview route composes: the editions, their modes, the ceiling and the step. */
function releaseReviewOf(page: Page) {
  return page.locator('[data-slot="publish-review"]');
}

/** One edition's row inside that review, named by the identity the variant matrix lists it under. */
function releaseEditionOf(page: Page, variantId: string) {
  return page.locator(`[data-slot="publish-review-edition"][data-variant-id="${variantId}"]`);
}

/**
 * Selects one edition for release, the way a person does: the checkbox the edition's own row names.
 *
 * An edition with no frozen candidate offers no checkbox at all — the row states why it cannot be released — so a
 * selection that finds none fails here rather than releasing a selection nobody made.
 */
async function selectForRelease(page: Page, variantId: string): Promise<void> {
  const row = releaseEditionOf(page, variantId);
  await expect(row).toBeVisible();
  await row.getByRole("checkbox").click();
  await expect(row).toHaveAttribute("data-selected", "true");
}

/**
 * Presses the one release step and the confirmation inside the dialog it opens.
 *
 * The attempt's identity, the release mode each submission fixed and the notice a notifying submission asks for are
 * the surface's own business: nothing here mints an operation id, assembles a payload or chooses a mode.
 */
async function pressRelease(page: Page): Promise<void> {
  const review = releaseReviewOf(page);
  await review.getByRole("button", { name: RELEASE_ACTION, exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: RELEASE_ACTION, exact: true }).click();
}

/** The publication identity one edition's own release facts name, which changes exactly once per release of it. */
async function publicationIdentityOf(page: Page, variantId: string): Promise<string> {
  const stated = (await editionFactOf(page, variantId, "Published revision").innerText()).trim();
  const publication = /Publication\s+(\S+)/u.exec(stated);
  if (publication === null || publication[1] === undefined) {
    throw new Error(`The ${variantId} edition stated no publication identity, so nothing could be compared with it: ${stated.slice(0, 300)}`);
  }
  return publication[1];
}

/**
 * The notice one released edition's result row states: the identity it was submitted under and the address the row
 * itself renders for the outcomes recorded under that identity.
 *
 * Both are read from the row, so the screen a person is sent to is the notice the result names rather than whichever
 * was submitted last. An edition whose notice was withheld states no identity and offers no link, so this fails there
 * instead of following an address the surface never composed.
 */
async function noticeOfResultRow(row: Locator): Promise<{ readonly intentId: string; readonly href: string }> {
  const notice = row.locator('[data-slot="publish-edition-notice"]');
  await expect(notice, "One released edition's row states the notice that went with it").toHaveCount(1);
  await expect(notice).toHaveAttribute("data-notice-state", "accepted");
  await expect(notice).toContainText(NOTICE_IDENTITY_LABEL);
  const stated = notice.locator(".mono-identifier").first();
  await expect(stated).toBeVisible();
  const intentId = (await stated.innerText()).trim();
  if (intentId === "") {
    throw new Error("The result row named no notice identity, so the outcomes recorded under it could not be read back.");
  }
  const link = notice.getByRole("link", { name: NOTICE_RESULTS_LINK, exact: true });
  await expect(link, "The result names the notice it submitted and links the outcomes recorded under it").toBeVisible();
  const href = (await link.getAttribute("href"))?.trim() ?? "";
  if (href === "") {
    throw new Error(`The notice's own link carried no address, so the screen it opens could name no notice: ${intentId}`);
  }
  return { intentId, href };
}

// ---------------------------------------------------------------------------------------------
// The filesystem and the picker: the one committed image, and the states the picker reported
// ---------------------------------------------------------------------------------------------

/**
 * The absolute address of one committed media fixture.
 *
 * The picker is handed a real file, and the path is resolved upwards from the working directory because
 * the runner may be started from either the repository root or the application package: the first
 * ancestor holding the fixture under `public/fixtures/media` is the one this returns. Nothing is written
 * here — the fixture is read from where the repository already keeps it.
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

/** The window member the simulated phase recorder appends to, read back by {@link pickerPhases}. */
interface PhaseRecorderHost {
  __mediaPickerPhases?: string[];
}

/**
 * Starts recording every phase the media picker reports, before the file is chosen.
 *
 * The picker states its own phase on the dialog it renders (`data-phase`), and a preparation that is fast
 * still passes through each one. Recording the attribute the surface itself sets is what lets the journey
 * assert that preparation was shown *before* the answer arrived, without a fixed wait and without asking
 * the application for anything a person could not see.
 */
async function recordPickerPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = globalThis as unknown as PhaseRecorderHost & { MutationObserver: typeof MutationObserver };
    const phases: string[] = [];
    host.__mediaPickerPhases = phases;
    const collect = (): void => {
      const picker = document.querySelector('[data-slot="media-picker"]');
      const phase = picker?.getAttribute("data-phase") ?? "";
      if (phase !== "" && phases[phases.length - 1] !== phase) phases.push(phase);
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-phase"] });
  });
}

/** Every phase the picker reported since {@link recordPickerPhases}, in the order it reported them. */
async function pickerPhases(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => (globalThis as unknown as PhaseRecorderHost).__mediaPickerPhases ?? []);
}

// ---------------------------------------------------------------------------------------------
// The served image, measured from its bytes rather than decoded
// ---------------------------------------------------------------------------------------------

/**
 * The pixel size a JPEG's start-of-frame marker states.
 *
 * Reading the frame header is the whole of what this file needs to know about the delivered image: it is
 * four bytes of the artefact itself, so the 2,000 px bound is asserted against what the application sent
 * rather than against what a pipeline reported about it.
 */
function jpegSizeOf(bytes: Buffer): { readonly width: number; readonly height: number } {
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // A fill byte repeats the marker prefix, and the standalone markers carry no length field.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const startsFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startsFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("The served image carried no start-of-frame marker, so the size of the bytes this application sent could not be read.");
}

/**
 * Everything a rendition response states, as text: its status line, every header and the body's own bytes
 * read one character per byte, so an ASCII marker, path or file name is found wherever it sits.
 */
function responseTextOf(bytes: Buffer, headers: Readonly<Record<string, string>>, status: number): string {
  const stated = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  return [`HTTP ${String(status)}`, ...stated, bytes.toString("latin1")].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Reading the surfaces the journey drives
// ---------------------------------------------------------------------------------------------

/** The editor of one edition, which is where prose and media are written. */
function editorOf(page: Page) {
  return page.locator('[data-slot="editor-shell"]');
}

/** The text of one edition, through the one prose surface, by the name a reader hears for it. */
function proseOf(page: Page) {
  return page.getByRole("textbox", { name: "The text of this Update edition", exact: true });
}

/** The durable status line of the autosave, whose own state word is what a save is judged by. */
function autosaveOf(page: Page) {
  return page.locator('[data-slot="autosave-status"]');
}

/** The revision identity the editor states for the saved draft in front of the worker. */
async function draftRevisionOnEditor(page: Page): Promise<string> {
  const stated = page.locator('[data-slot="editor-shell-body"] dl dd .mono-identifier').first();
  await expect(stated).toBeVisible();
  const text = (await stated.innerText()).trim();
  if (text === "") {
    throw new Error("The editor stated no draft revision, so the submission could not be compared with the revision it freezes.");
  }
  return text;
}

/**
 * One fact of one edition on the variant matrix: the row a reader finds under the term the matrix states
 * for it. The matrix keeps a saved draft, a frozen candidate and a published revision apart, so each is
 * read from its own row rather than from the edition as a whole.
 */
function editionFactOf(page: Page, variantId: string, term: string) {
  const cell = page.locator(`[data-slot="edition-cell"][data-variant-id="${variantId}"]`);
  return cell.locator("dl > div").filter({ hasText: term });
}

/** The identity one edition's fact states, which is the value the row carries rather than a count of rows. */
async function identityOfFact(page: Page, variantId: string, term: string): Promise<string> {
  const stated = editionFactOf(page, variantId, term).locator(".mono-identifier").first();
  await expect(stated).toBeVisible();
  const text = (await stated.innerText()).trim();
  if (text === "") {
    throw new Error(`The ${term} fact of ${variantId} stated no identity, so nothing could be compared with it.`);
  }
  return text;
}

// ---------------------------------------------------------------------------------------------
// 1. The whole publication: prose and an image, the exact candidate, one review step, the release,
//    and a later draft edit that moves nothing a reader is served
// ---------------------------------------------------------------------------------------------

test("an Update is composed with an image, previewed, reviewed once and released at the exact revision it submitted, and a later draft edit leaves that release standing", async ({ page }) => {
  const origin = await originOf(page);
  await actAs(page, origin, CONTRIBUTOR_SESSION);

  // The baseline every "no notice was created" assertion is compared with: the one notice the seed recorded,
  // read by the publisher it belongs to (a reader is refused those outcomes, which is why this read acts as
  // the ministry), and the inbox the recipient side holds.
  const noticeBefore = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`);
  expect(noticeBefore.status, "The seeded notice's recorded outcomes are the baseline this file compares against").toBe(200);
  expect(fieldAt(noticeBefore.body, "data", "releaseId"), "The baseline is the notice the seed recorded, pinned to the release it was submitted for").toBe(SEEDED_NOTICE_RELEASE);
  expect(fieldAt(noticeBefore.body, "data", "rows")).toHaveLength(SEEDED_NOTICE_RECIPIENTS);
  const inboxBefore = await getAs(page, PUBLIC_READER_SESSION, INBOX_API);
  expect(inboxBefore.status, "The recipient-side inbox is readable by the reader whose inbox it is").toBe(200);
  expect(fieldAt(inboxBefore.body, "data", "messages"), "The seeded world puts no message in this reader's inbox").toHaveLength(0);

  // --- the edition is composed, and the seeded image is prepared and placed -------------------
  await page.goto(editorPath(PUBLIC_ENGLISH_EDITION));
  const editor = editorOf(page);
  await expect(editor.getByRole("heading", { name: "Write this Update edition", exact: true })).toBeVisible();
  // The shell says on every screen that this is a development build, so nothing here reads as production data.
  await expect(page.getByText(DEVELOPMENT_LABEL, { exact: true })).toBeVisible();
  await expect(editor).toContainText("Nothing has been saved for this edition yet.");
  // A draft is not a release, which this surface states rather than leaves to the reader to infer.
  await expect(editor).toContainText("A saved draft is not a release, and a release is not a message");

  // The prose travels through the one Tiptap surface, and the save it produces is acknowledged.
  const prose = proseOf(page);
  await prose.click();
  await page.keyboard.type(PUBLISHED_PROSE);
  await expect(autosaveOf(page)).toHaveAttribute("data-autosave-state", "saved");
  const composedDraft = await draftRevisionOnEditor(page);
  expect(composedDraft, "The first save records a revision of its own").not.toBe("");

  // The image: chosen from the committed seed fixture through the one media picker, described, placed.
  const mediaPane = page.locator('[data-slot="editor-media-pane"]');
  await mediaPane.getByRole("button", { name: "Add an image", exact: true }).click();
  const picker = page.locator('[data-slot="media-picker"][data-kind="image"]');
  await expect(picker).toHaveAttribute("data-phase", "choosing");
  // The limits are stated before any work begins, and the local nature of the processing is disclosed.
  await expect(picker).toContainText("No more than 10 MiB.");
  await expect(picker).toContainText("No more than 8,000 pixels on either side.");
  await expect(picker).toContainText(LOCAL_PROCESSING);

  await recordPickerPhases(page);
  await picker.locator('input[type="file"]').setInputFiles(fixturePathOf(EXIF_FIXTURE));
  await expect(picker).toHaveAttribute("data-phase", "described");

  // Local validation comes before anything is sent: an image with no alternative text is not placed, and
  // the picker stays on the form rather than opening an attempt.
  await picker.getByRole("button", { name: "Add this image", exact: true }).click();
  await expect(picker.getByText(MISSING_ALT_TEXT, { exact: true })).toBeVisible();
  await expect(picker).toHaveAttribute("data-phase", "described");

  await picker.getByRole("textbox", { name: "Alternative text", exact: true }).fill(ALT_TEXT);
  await picker.getByRole("textbox", { name: /^Caption/u }).fill(CAPTION);
  await picker.getByRole("button", { name: "Add this image", exact: true }).click();
  await expect(picker.locator('[data-slot="operation-result"]')).toHaveAttribute("data-outcome", "accepted");
  await expect(picker.getByText(LOCAL_PROCESSING, { exact: true })).toBeVisible();

  // The picker reported preparation before it reported an answer, which is what makes the receipt the end
  // of a process rather than a substitute for one.
  const phases = await pickerPhases(page);
  expect(phases, "The picker passed through each of its own states in order").toEqual(expect.arrayContaining(["choosing", "preparing", "described", "settled"]));
  expect(phases.indexOf("preparing"), "Preparation started before the description form was shown").toBeLessThan(phases.indexOf("described"));
  expect(phases.lastIndexOf("preparing"), "The attempt was shown as preparing before its answer arrived").toBeGreaterThan(phases.indexOf("described"));
  expect(phases.indexOf("settled"), "The answer arrived after the attempt it answers").toBeGreaterThan(phases.lastIndexOf("preparing"));

  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('[data-slot="media-picker"]')).toHaveCount(0);

  // The placement carries the description the reader hears and never the file's own name: the record holds
  // an opaque identity, so nothing of the machine the file came from is echoed back.
  const placement = page.locator('[data-slot="placement-row"][data-kind="image"]').first();
  await expect(placement).toContainText(ALT_TEXT);
  await expect(placement).toContainText(CAPTION);
  await expect(placement).toContainText("Ready");
  await expect(placement).not.toContainText(EXIF_FIXTURE);
  await expect(editor).not.toContainText(EXIF_FIXTURE);

  // --- the exact candidate is previewed, inertly ---------------------------------------------
  const submitStep = editor.locator('[data-slot="action-review"]');
  await expect(submitStep).toContainText("Submit this edition for review");
  const submittedDraft = await draftRevisionOnEditor(page);
  // The step names the exact revision it freezes, so the submission is a stated identity rather than a guess.
  await expect(submitStep).toContainText(submittedDraft);
  // The mode this case needs is chosen on the step that records it: Publish only, which the review then reads as the
  // author's own decision and no reviewer can turn into a notice.
  const releaseChoice = submitStep.locator('[data-slot="submission-release-mode"]');
  await releaseChoice.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true }).click();
  await expect(releaseChoice.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true })).toBeChecked();
  await expect(releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).not.toBeChecked();
  await submitStep.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(submitStep.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  await page.getByRole("link", { name: "Preview this edition", exact: true }).click();
  const frame = page.locator('[data-slot="preview-frame"]');
  await expect(frame).toHaveAttribute("data-preview-status", "authorised");
  const revision = (await frame.getAttribute("data-preview-revision"))?.trim() ?? "";
  if (revision === "") {
    throw new Error("The preview named no revision, so the release could not be compared with the revision a reviewer answered.");
  }
  expect(revision, "The preview renders the revision the submission froze").toBe(submittedDraft);
  // The preview is the one renderer's output for that exact revision: the prose and the placement both appear,
  // and the revision it renders is stated as a fact rather than implied.
  await expect(frame).toContainText(PUBLISHED_PROSE);
  await expect(frame.getByRole("img", { name: ALT_TEXT })).toBeVisible();
  await expect(frame).toContainText(revision);
  // Inert: nothing in a preview can publish, notify, subscribe or take money.
  await expect(frame.locator('[data-slot="preview-inert"]')).toBeVisible();
  await expect(frame.getByRole("button", { name: /publish|notify|send|subscribe|pay|donate/iu })).toHaveCount(0);
  await expect(frame.getByText(PUBLICATION_SIMULATION, { exact: true })).toBeVisible();

  // --- one review step, then the release of exactly that revision ----------------------------
  // A seeded session holds its own copy of the world (AAP 0.7.2: a session sees only its own files), so a
  // candidate written here is this session's to answer and not another seat's: the reviewer identity answers
  // the seeded candidate in the second test of this file, and this journey's review step is opened where the
  // candidate lives. That isolation is asserted rather than assumed, so a reader sees why one seat writes,
  // reviews and releases here instead of handing the submission to a second seat.
  const unseenByReviewer = await getAs(page, REVIEWER_SESSION, `/api/review?variantId=${encodeURIComponent(PUBLIC_ENGLISH_EDITION)}`);
  expect(fieldAt(unseenByReviewer.body, "data", "status"), "Another session holds its own copy of the world, so this candidate is not its frozen revision").toBe("none");
  await page.goto(reviewPath(PUBLIC_ENGLISH_EDITION));
  await expect(page.getByRole("heading", { name: "Review this Update", level: 1 })).toBeVisible();
  const panel = page.locator('[data-slot="review-panel"]');
  const frozen = panel.locator('[data-slot="review-frozen-revision"]');
  // Exactly one candidate is under review here, and it is the exact revision the preview rendered.
  await expect(frozen).toHaveCount(1);
  await expect(frozen).toContainText(revision);
  await expect(frozen).toContainText(PUBLIC_ENGLISH_EDITION);

  // The author's Publish only choice is a fact on this screen, and the reviewer holds no control that could
  // change it: the sentence and the absence of a notice control are the proof, not a disabled button.
  const authorIntent = panel.locator('[data-slot="review-publish-intent"]');
  await expect(authorIntent).toHaveAttribute("data-notify-requested", "false");
  await expect(authorIntent).toContainText(PUBLISH_ONLY_BADGE);
  await expect(authorIntent).toContainText(REVIEWER_CANNOT_FLIP);
  await expect(authorIntent.getByRole("radio")).toHaveCount(0);
  await expect(authorIntent.getByRole("checkbox")).toHaveCount(0);
  await expect(authorIntent.getByRole("switch")).toHaveCount(0);
  // A publish-only submission involves no notice, so the mail simulation is not stated anywhere on this review.
  await expect(panel.getByText(MAIL_SIMULATION, { exact: true })).toHaveCount(0);
  await expect(panel.getByText(PUBLICATION_SIMULATION, { exact: true }).first()).toBeVisible();

  // One review step, given once.
  const decision = panel.locator('[data-slot="review-decision"]');
  await expect(decision).toHaveCount(1);
  await expect(decision).toContainText(ONE_DECISION_ONCE);
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  // The durable answer is the recorded decision, which outlives the receipt that reported it.
  const recorded = page.locator('[data-slot="review-recorded-decision"]');
  await expect(recorded).toHaveAttribute("data-decision", "approved");
  await expect(recorded).toContainText(CANDIDATE_APPROVED);
  await expect(recorded).toContainText("Decided by");

  // The release is the separate act the approval is not. The mode a release may take is the mode the submission
  // recorded, and no composed control can name another: the release review renders it read-only and states why the
  // other choice is refused. So that refusal is asserted at the boundary that enforces it, under the contributor's
  // own session, as the one attempt in this file a press cannot make.
  const releaseState = await readDevState(page, CONTRIBUTOR_SESSION);
  const flipped = await postRelease(page, CONTRIBUTOR_SESSION, { operationId: newAttemptId(), state: releaseState, variants: [{ variantId: PUBLIC_ENGLISH_EDITION, revisionId: revision, mode: "publish-and-notify-now" }] });
  expect(outcomeOf(flipped), "A release cannot take a mode the submission never asked for").toBe("invalid");
  expect(messagesAt(flipped, "variants.0")).toMatch(/mode the submission did not ask for/u);

  // --- the release, pressed on the review the overview route composes -------------------------
  await page.goto(overviewPath());
  const releaseRow = releaseEditionOf(page, PUBLIC_ENGLISH_EDITION);
  // The edition the submission froze is the one the release offers, at the exact revision the preview rendered.
  await expect(releaseRow).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(releaseRow).toHaveAttribute("data-mode", "publish-only");
  await expect(releaseRow).toContainText(revision);
  await selectForRelease(page, PUBLIC_ENGLISH_EDITION);
  // Selecting it states the mode the submission fixed, and the choice the author did not make is the one it refuses.
  const releaseMode = releaseRow.locator('[data-slot="publish-mode"]');
  await expect(releaseMode).toHaveAttribute("data-mode", "publish-only");
  await expect(releaseMode.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true })).toBeChecked();
  await expect(releaseMode.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).not.toBeChecked();
  await expect(releaseRow.locator('[data-slot="publish-mode-reason"]')).toContainText(MODE_NOT_ASKED_FOR);
  await pressRelease(page);

  // The answer is the release's own receipt: one edition, released, reported one at a time.
  const receipt = page.locator('[data-slot="publish-review-result"]');
  await expect(receipt).toHaveAttribute("data-outcome", "accepted");
  await expect(receipt).toContainText(RELEASE_RESULT);
  const releasedRow = receipt.locator('[data-slot="publish-edition"]');
  await expect(releasedRow).toHaveCount(1);
  await expect(releasedRow).toHaveAttribute("data-edition-state", "released");
  await expect(releasedRow).toContainText(ENGLISH_LOCALE_NAME);

  // The release head the matrix states is the exact revision the submission froze, and the publication it names is a
  // new one rather than the release the seed laid down — so the release names the preview's revision, not a draft.
  await page.goto(overviewPath());
  expect(await identityOfFact(page, PUBLIC_ENGLISH_EDITION, "Published revision"), "The release publishes exactly the revision the submission froze").toBe(revision);
  const releaseId = await publicationIdentityOf(page, PUBLIC_ENGLISH_EDITION);
  expect(releaseId, "The release is a publication of its own rather than the seeded one").not.toBe(SEEDED_NOTICE_RELEASE);

  // Publish only is not Notify: the one notice the application recorded is still the seeded one, still pinned
  // to the release it was submitted for, with the same recipients and the same outcomes.
  const noticeAfter = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`);
  expect(fieldAt(noticeAfter.body, "data", "releaseId")).toBe(SEEDED_NOTICE_RELEASE);
  expect(fieldAt(noticeAfter.body, "data", "counts")).toEqual(fieldAt(noticeBefore.body, "data", "counts"));
  expect(fieldAt(noticeAfter.body, "data", "rows")).toHaveLength(SEEDED_NOTICE_RECIPIENTS);
  const inboxAfter = await getAs(page, PUBLIC_READER_SESSION, INBOX_API);
  expect(fieldAt(inboxAfter.body, "data", "intentCount"), "The release put no message in a reader's inbox").toBe(fieldAt(inboxBefore.body, "data", "intentCount"));

  // The delivery surface a person opens reports that same one notice and nothing about the new release.
  await actAs(page, origin, CONTRIBUTOR_SESSION);
  await page.goto(deliveryPath(SEEDED_NOTICE_INTENT));
  const delivery = page.locator('[data-slot="delivery-results"]');
  await expect(delivery).toBeVisible();
  await expect(page.locator('[data-slot="delivery-row"]')).toHaveCount(SEEDED_NOTICE_RECIPIENTS);
  await expect(delivery).not.toContainText(releaseId);

  // --- a later draft edit leaves the release where it was ------------------------------------
  await page.goto(editorPath(PUBLIC_ENGLISH_EDITION));
  const reloadedProse = proseOf(page);
  // What the worker returns to is the revision the release published, not an empty editor.
  await expect(reloadedProse).toContainText(PUBLISHED_PROSE);
  await reloadedProse.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(LATER_DRAFT_PROSE);
  await expect(autosaveOf(page)).toHaveAttribute("data-autosave-state", "saved");
  await expect(page.locator('[data-slot="editor-shell-body"] dl dd .mono-identifier').first()).not.toHaveText(revision);
  const laterDraft = await draftRevisionOnEditor(page);
  expect(laterDraft, "A later save is a different revision from the one that was published").not.toBe(revision);

  // The matrix keeps the saved draft and the published revision apart, and the published revision is still
  // the one the review answered.
  await page.goto(overviewPath());
  expect(await identityOfFact(page, PUBLIC_ENGLISH_EDITION, "Saved draft"), "The new draft stands on its own identity").toBe(laterDraft);
  expect(await identityOfFact(page, PUBLIC_ENGLISH_EDITION, "Published revision"), "The release head did not move with the draft").toBe(revision);

  // --- what a reader is served, and the bytes behind it --------------------------------------
  await actAs(page, origin, PUBLIC_READER_SESSION);
  await page.goto(receivingPostPath());
  const post = page.locator('[data-slot="receiving-post"]');
  // The published text, and never the later draft: a draft is not something any reader is served.
  await expect(post).toContainText(PUBLISHED_PROSE);
  await expect(post).not.toContainText(LATER_DRAFT_PROSE);
  const servedImage = post.getByRole("img", { name: ALT_TEXT });
  await expect(servedImage).toBeVisible();
  const src = (await servedImage.getAttribute("src"))?.trim() ?? "";
  if (!src.startsWith("/api/media/")) {
    throw new Error(`The published image is not served from the one scoped rendition address, so its bytes cannot be asserted here: ${JSON.stringify(src)}`);
  }

  // The served bytes are re-encoded, carry no source metadata and no source file name, and are bounded to the
  // display profile's longest edge — inspected as bytes, never decoded with a library.
  const rendition = await page.request.get(src);
  expect(rendition.status(), `GET ${src} as the reader the edition admits`).toBe(200);
  const renditionHeaders = rendition.headers();
  expect(renditionHeaders["content-type"]).toMatch(/^image\//u);
  const servedBytes = Buffer.from(await rendition.body());
  const servedText = responseTextOf(servedBytes, renditionHeaders, rendition.status());
  for (const source of EXIF_SOURCE_STRINGS) {
    expect(servedText.includes(source), `The served image still stated ${JSON.stringify(source)}, so the source's own file name or metadata escaped the local pipeline: ${src}`).toBe(false);
  }
  expect(servedText).not.toMatch(/media-originals|\.data\//u);
  const servedSize = jpegSizeOf(servedBytes);
  expect(Math.max(servedSize.width, servedSize.height), `The served rendition is ${String(servedSize.width)}x${String(servedSize.height)}, and a source larger than ${String(DISPLAY_EDGE_PX)} px is bounded to that edge`).toBe(DISPLAY_EDGE_PX);

  // Another ministry's worker asks for the same rendition and is refused — with the same answer a rendition
  // that never existed earns, so the refusal states nothing about what is there.
  const assetSegment = src.split("/")[3] ?? "";
  await actAs(page, origin, OUTSIDER_SESSION);
  const refused = await page.request.get(src);
  const unknown = await page.request.get("/api/media/asset-not-in-this-scope/rendition-not-in-this-scope");
  expect(refused.status(), "A persona outside the asset's scope is refused the rendition").toBe(403);
  expect(unknown.status(), "An address naming no asset's rendition is refused identically").toBe(refused.status());
  const refusedBody = await jsonOf(refused, `GET ${src} as a second worker`);
  const unknownBody = await jsonOf(unknown, "GET a rendition no asset holds");
  expect(refusedBody, "A refusal of an existing rendition is indistinguishable from a refusal of one that never existed").toEqual(unknownBody);
  expect(JSON.stringify(refusedBody)).not.toContain(assetSegment);
});

// ---------------------------------------------------------------------------------------------
// 2. A frozen candidate is not a release, and an unreviewed submission cannot be published
// ---------------------------------------------------------------------------------------------

test("a frozen candidate is answered by one review step and is not a release, so an unreviewed submission cannot be published", async ({ page }) => {
  const origin = await originOf(page);
  await actAs(page, origin, REVIEWER_SESSION);
  await page.goto(reviewPath(FROZEN_ARABIC_EDITION));

  await expect(page.getByRole("heading", { name: "Review this Update", level: 1 })).toBeVisible();
  const panel = page.locator('[data-slot="review-panel"]');
  // The seeded candidate is the revision the review answers, and it is the only one here.
  const frozen = panel.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen).toHaveCount(1);
  await expect(frozen).toContainText(FROZEN_ARABIC_CANDIDATE);
  await expect(panel.locator('[data-slot="review-decision"]')).toHaveCount(1);
  // The submission asked for no notices, and the reviewer cannot add them.
  const authorIntent = panel.locator('[data-slot="review-publish-intent"]');
  await expect(authorIntent).toHaveAttribute("data-notify-requested", "false");
  await expect(authorIntent).toContainText(PUBLISH_ONLY_BADGE);
  await expect(authorIntent).toContainText(REVIEWER_CANNOT_FLIP);

  // No decision is given here: the candidate stays frozen and unanswered, which is exactly the state a release
  // must refuse. Approval is not publication, and an unapproved candidate is not a release either — so the release
  // is pressed on the surface that composes it, and refused there.
  await page.goto(overviewPath());
  const unreviewedRow = releaseEditionOf(page, FROZEN_ARABIC_EDITION);
  await expect(unreviewedRow).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(unreviewedRow).toContainText(FROZEN_ARABIC_CANDIDATE);
  await selectForRelease(page, FROZEN_ARABIC_EDITION);
  await pressRelease(page);
  const refusal = page.locator('[data-slot="publish-review-result"]');
  await expect(refusal).toHaveAttribute("data-outcome", "invalid");
  await expect(refusal).toContainText(AWAITING_ITS_REVIEW);

  // And the edition states the same fact on its own surface: it publishes nothing, so no reader is served a
  // revision of it, and the frozen candidate is not presented as one.
  await page.goto(overviewPath());
  await expect(editionFactOf(page, FROZEN_ARABIC_EDITION, "Published revision")).toContainText(NOTHING_PUBLISHED);
});

// ---------------------------------------------------------------------------------------------
// 3. The other branch of the pair: Publish and notify now, the notice that release submits, and the
//    outcomes its own link opens
// ---------------------------------------------------------------------------------------------

test("an edition whose author chose Publish and notify now is released through the same control, and the notice its result names opens on the delivery screen with both renderings of its message", async ({ page }) => {
  const origin = await originOf(page);
  await actAs(page, origin, CONTRIBUTOR_SESSION);

  // The one notice the seed recorded is the baseline this journey compares against, read by the publisher it belongs
  // to: a notice this publication submits is a new intent, and it never rewrites that one.
  const noticeBefore = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`);
  expect(noticeBefore.status, "The seeded notice's recorded outcomes are readable by the ministry that submitted it").toBe(200);
  expect(fieldAt(noticeBefore.body, "data", "releaseId"), "The baseline is the notice the seed recorded, pinned to the release it was submitted for").toBe(SEEDED_NOTICE_RELEASE);

  // --- the author composes the edition and records how it is to be released --------------------
  await page.goto(editorPath(PUBLIC_ENGLISH_EDITION));
  const editor = editorOf(page);
  const prose = proseOf(page);
  await prose.click();
  await page.keyboard.type(PUBLISHED_PROSE);
  await expect(autosaveOf(page)).toHaveAttribute("data-autosave-state", "saved");
  const submittedDraft = await draftRevisionOnEditor(page);

  // The mode is the author's decision, taken on the one step that records it: both choices are offered with what each
  // one does, publish-only starts selected, and the group states the mode it holds in the vocabulary the submission
  // writes. Choosing to notify is a deliberate act, so a notice is never the answer nobody gave.
  const submitStep = editor.locator('[data-slot="action-review"]');
  const releaseChoice = submitStep.locator('[data-slot="submission-release-mode"]');
  await expect(releaseChoice).toHaveAttribute("data-mode", "publish-only");
  await expect(releaseChoice.getByRole("radio", { name: PUBLISH_ONLY_BADGE, exact: true })).toBeChecked();
  await expect(releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).not.toBeChecked();
  await releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true }).click();
  await expect(releaseChoice.getByRole("radio", { name: NOTIFY_NOW_CHOICE, exact: true })).toBeChecked();
  await expect(releaseChoice).toHaveAttribute("data-mode", "publish-and-notify");
  await expect(submitStep).toContainText(submittedDraft);
  await submitStep.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(submitStep.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  // --- the one review step states that decision as a fact and offers no control to change it ----
  // A seeded session holds its own copy of the world (AAP 0.7.2: a session sees only its own files), so the submission
  // written here is this session's to answer; the reviewer seat answers the seeded candidate in this file's second
  // test. Both seats answer the same review surface, and approval is not publication on either.
  await page.goto(reviewPath(PUBLIC_ENGLISH_EDITION));
  await expect(page.getByRole("heading", { name: "Review this Update", level: 1 })).toBeVisible();
  const panel = page.locator('[data-slot="review-panel"]');
  const frozen = panel.locator('[data-slot="review-frozen-revision"]');
  await expect(frozen).toHaveCount(1);
  await expect(frozen).toContainText(submittedDraft);
  // The recorded mode is the author's, and the reviewer holds no control that could turn it into its opposite: the
  // absence of every such control is the proof, not a disabled button.
  const authorIntent = panel.locator('[data-slot="review-publish-intent"]');
  await expect(authorIntent).toHaveAttribute("data-notify-requested", "true");
  await expect(authorIntent).toContainText(NOTIFY_NOW_CHOICE);
  await expect(authorIntent).toContainText(REVIEWER_CANNOT_FLIP);
  await expect(authorIntent.getByRole("radio")).toHaveCount(0);
  await expect(authorIntent.getByRole("checkbox")).toHaveCount(0);
  await expect(authorIntent.getByRole("switch")).toHaveCount(0);
  // A notice is part of this release, so the simulated mail boundary is labelled where the choice is read.
  await expect(authorIntent.getByText(MAIL_SIMULATION, { exact: true })).toBeVisible();
  await expect(panel.locator('[data-slot="review-decision"]')).toContainText(ONE_DECISION_ONCE);
  await expect(page.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  const recordedDecision = page.locator('[data-slot="review-recorded-decision"]');
  await expect(recordedDecision).toHaveAttribute("data-decision", "approved");
  await expect(recordedDecision).toContainText(CANDIDATE_APPROVED);

  // --- the release the approval is not, pressed on the same control ---------------------------------
  await page.goto(overviewPath());
  const review = releaseReviewOf(page);
  const releaseRow = releaseEditionOf(page, PUBLIC_ENGLISH_EDITION);
  // The row states the mode the submission fixed and the exact revision the review answered.
  await expect(releaseRow).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(releaseRow).toHaveAttribute("data-mode", "publish-and-notify-now");
  await expect(releaseRow).toContainText(submittedDraft);
  await selectForRelease(page, PUBLIC_ENGLISH_EDITION);
  // One selected edition asked for a notice, and the review states that count itself.
  await expect(review).toHaveAttribute("data-notify-editions", "1");
  // The ceiling the notice is acknowledged against is the count the audience read stated, and the number a person can
  // read beside that label is the number the release would carry.
  const ceilingBlock = review.locator('[data-slot="publish-ceiling"]');
  await expect(ceilingBlock).toHaveAttribute("data-state", "stated");
  const eligible = (await ceilingBlock.getAttribute("data-eligible"))?.trim() ?? "";
  if (!/^\d+$/u.test(eligible)) {
    throw new Error(`The release review stated no eligible ceiling for the notice it would submit, so nothing could be acknowledged: ${JSON.stringify(eligible)}`);
  }
  await expect(ceilingBlock).toContainText(CEILING_HEADING);
  await expect(ceilingBlock).toContainText(CEILING_ELIGIBLE_LABEL);
  await expect(ceilingBlock.locator("bdi").first()).toHaveText(eligible);
  // The notice's own target is read before the release is pressed: the edition it points at, the address it would
  // carry, and the simulated boundary it crosses.
  const noticeTarget = review.locator('[data-slot="publish-notice"]');
  await expect(noticeTarget).toHaveAttribute("data-notice-edition", PUBLIC_ENGLISH_EDITION);
  await expect(noticeTarget).toContainText(NOTICE_TARGET_LABEL);
  await expect(noticeTarget.getByText(MAIL_SIMULATION, { exact: true })).toBeVisible();
  await pressRelease(page);

  // --- the per-edition result, and the one notice it names --------------------------------------
  const receipt = page.locator('[data-slot="publish-review-result"]');
  await expect(receipt).toHaveAttribute("data-outcome", "accepted");
  await expect(receipt).toContainText(RELEASE_RESULT);
  await expect(receipt.locator('[data-slot="publish-edition"]')).toHaveCount(1);
  const releasedRow = receipt.locator(`[data-slot="publish-edition"][data-variant-id="${PUBLIC_ENGLISH_EDITION}"]`);
  await expect(releasedRow).toHaveAttribute("data-edition-state", "released");
  // The write answer names the release's own identity and no content revision, so the revision this release published is
  // read from the edition's durable "Published revision" fact below rather than asserted from this row.
  await expect(releasedRow).toContainText(ENGLISH_LOCALE_NAME);
  // One release of one notifying edition submits one notice, and the row names it rather than describing whichever
  // was submitted last.
  await expect(receipt.locator('[data-slot="publish-edition-notice"]'), "One release of one notifying edition submits one notice").toHaveCount(1);
  const notice = await noticeOfResultRow(releasedRow);
  expect(notice.intentId, "The notice is this publication's own rather than the one the seed recorded").not.toBe(SEEDED_NOTICE_INTENT);
  expect(notice.href, "The link the result renders is the delivery address for that notice and no other").toBe(deliveryPath(notice.intentId));

  // --- the outcomes that notice recorded, on the screen its own link opens ----------------------
  // The result row re-renders while the page it sits on settles, so the address the row renders is followed rather
  // than clicked: the row's own href is the assertion here, and the screen a person reaches from it is the one below.
  await expect(releasedRow.getByRole("link", { name: NOTICE_RESULTS_LINK, exact: true })).toHaveAttribute("href", notice.href);
  await page.goto(`${origin}${notice.href}`);
  await expect(page, "The result's link opens the recorded outcomes of the notice it names").toHaveURL(`${origin}${notice.href}`);
  const delivery = page.locator('[data-slot="delivery-results"]');
  await expect(delivery).toBeVisible();
  await expect(delivery).toContainText(notice.intentId);
  // The record the screen renders is read as the check behind the assertion: every outcome it holds is one row, and
  // no row it holds is missing from the page.
  const recordedNotice = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(notice.intentId)}`);
  expect(recordedNotice.status, "The notice this publication submitted is readable by the ministry that submitted it").toBe(200);
  expect(fieldAt(recordedNotice.body, "data", "intentId")).toBe(notice.intentId);
  const heldRows = fieldAt(recordedNotice.body, "data", "rows");
  const heldCount = Array.isArray(heldRows) ? heldRows.length : 0;
  expect(heldCount, "The notice served at least one eligible recipient, so its outcomes are recorded rows rather than none").toBeGreaterThan(0);
  await expect(page.locator('[data-slot="delivery-row"]'), "The screen renders one row for each outcome the record holds").toHaveCount(heldCount);
  // Acceptance is neither delivery nor reading, and the simulated boundary is labelled where the outcomes are read.
  await expect(delivery.getByText(MAIL_SIMULATION, { exact: true }).first()).toBeVisible();

  // --- the message itself, in both renderings the one notice presentation carries ----------------
  const noticeBlock = delivery.locator('[data-slot="delivery-notice"]');
  await expect(noticeBlock, "Exactly one notice accompanies this publication's outcomes").toHaveCount(1);
  await expect(noticeBlock).toHaveAttribute("data-notice-state", "stated");
  await expect(noticeBlock.getByRole("heading", { name: DELIVERY_MESSAGE_HEADING, level: 3 })).toBeVisible();
  const presentation = noticeBlock.locator('[data-slot="notice-presentation"]');
  await expect(presentation).toHaveAttribute("data-notice-rendering", "both");
  // The HTML rendering is the real markup, and its link is the address the message carries.
  const messageLink = presentation.getByRole("link", { name: NOTICE_LINK_LABEL, exact: true });
  await expect(messageLink).toBeVisible();
  const linkTarget = (await messageLink.getAttribute("href"))?.trim() ?? "";
  if (linkTarget === "") {
    throw new Error("The rendered notice carried a link with no address, so the plain-text alternative could not be compared with it.");
  }
  // The plain-text alternative is the same message in the same words, carrying the same address.
  await presentation.getByRole("tab", { name: "Plain text", exact: true }).click();
  await expect(presentation.locator("pre")).toContainText(linkTarget);
  await presentation.getByRole("tab", { name: "HTML", exact: true }).click();
  await expect(presentation.getByRole("link", { name: NOTICE_LINK_LABEL, exact: true })).toBeVisible();

  // --- the seeded notice is untouched by this publication ---------------------------------------
  // A second publication of the document is a new intent, not a rewrite of the one the seed recorded: it still names
  // its own release and still holds the same outcomes for the same recipients.
  const noticeAfter = await getAs(page, CONTRIBUTOR_SESSION, `${NOTIFY_API}?intentId=${encodeURIComponent(SEEDED_NOTICE_INTENT)}`);
  expect(fieldAt(noticeAfter.body, "data", "releaseId")).toBe(SEEDED_NOTICE_RELEASE);
  expect(fieldAt(noticeAfter.body, "data", "counts")).toEqual(fieldAt(noticeBefore.body, "data", "counts"));

  // --- the revision the release published, on the edition's own durable fact --------------------
  // The release's write answer names the release identity and no content revision, so the exact revision this release
  // made readable is read where a reader's access is decided: the edition's "Published revision" fact on the matrix.
  await page.goto(overviewPath());
  await expect(editionFactOf(page, PUBLIC_ENGLISH_EDITION, "Published revision"), "The release published the exact revision the submission froze").toContainText(submittedDraft);
});
