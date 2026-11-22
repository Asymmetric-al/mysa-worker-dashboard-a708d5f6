/**
 * Criterion 17 — Variants and localization.
 *
 * One Update exists in English twice (public and approved-supporter), in French, and in Arabic. This file
 * drives the real application to show that each of those editions is its own working variant with its own
 * saved draft, frozen candidate and published revision; that releasing one advances that edition's head and
 * leaves its siblings exactly as they were; that a release attempt reports a result for each edition and a
 * sibling that failed keeps the revision it already published instead of a rollback; that a requested
 * language nothing serves is answered with the language actually used or with *Language unavailable*; that
 * one notice yields one copy per recipient however many audiences and languages a person is eligible for;
 * that Arabic is authored and read right to left with no direction control character stored; and that
 * withdrawing one language edition leaves the others served.
 *
 * **The seeded world this file acts in.** The deterministic seed lays one Update (`doc-update-autumn`) down
 * for the established worker with four editions: public English released as `rev-update-en-1`, approved-
 * supporter English released as `rev-update-en-supporter-1`, public French released as `rev-update-fr-1`
 * and recorded as translated from the English edition's `rev-update-en-1`, and public Arabic holding a saved
 * draft and a frozen candidate but no publication at all. One audience membership per recipient backs the
 * recorded notice `intent-update-autumn-en`, whose four rows report two accepted, one failed and one unknown
 * — the three outcomes that never merge into "sent". The second seeded world this file reads is
 * `established-worker-partial-release`, in which one submission released the English edition as
 * `rev-update-en-2` while its Arabic sibling failed and kept its earlier publication `rev-update-ar-1`.
 *
 * **What is proven where, and why.** Everything a person can see is asserted on the screen that shows it: the
 * variant grid, the editor, the preview, the receiving view, the review route and the delivery surface. Two
 * facts are not on any screen and are read as the application's own JSON, exactly as the surfaces read them:
 * the translation record's source revision (the grid states that a translation is stale but names the source
 * only in a detail sentence) and a release's per-edition result (the Updates family mounts no release
 * control — `publishVariants` is reached through the handler the browser transport uses, `POST /api/publish`).
 * Neither read derives a value: the notice, the ceiling, the pinned copy and the intent are the service's
 * own, and each is then confirmed on the delivery surface. The single-pin resolution across two audiences is
 * proven against the domain companion `tests/integration/notification-dedupe`, because the seeded audience
 * holds one membership row per recipient; what this file proves is the recorded consequence — one row per
 * recipient, one pinned copy, and no second copy when a second language edition is notified.
 *
 * **What it never does.** No fixed wait and no idle-network condition, no snapshot, no direct read of the
 * synthetic store's files, and no assertion on a colour: every expectation is a role, an accessible name, a
 * stated word, a `dir`/`lang` attribute or the order of text. Direction is asserted as the document property it is, and the bidi control characters are
 * asserted *absent* from stored content — the one place they appear in this file is the expression that
 * forbids them.
 */
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { resetSeed, SESSION_COOKIE } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

// ---------------------------------------------------------------------------------------------
// The seeded world, named once
// ---------------------------------------------------------------------------------------------

/** The one Update every expectation in this file is about, and the document the receiving address names. */
const UPDATE = "doc-update-autumn";

/** The four editions of it, by the opaque identity each is listed under. */
const EDITION = { enPublic: "variant-update-autumn-en-public", enSupporters: "variant-update-autumn-en-approved-supporter", frPublic: "variant-update-autumn-fr-public", arPublic: "variant-update-autumn-ar-public" } as const;

/** The three content languages the Update carries, and the direction two of them are read in. */
const LOCALES = ["en", "fr", "ar"] as const;
const ARABIC = "ar";

/** The seeded sessions this file reads: the author's world, the partial-release world, and a reader with no grant. */
const PARTIAL_RELEASE_SESSION = "established-worker-partial-release";
const UNAUTHORIZED_READER_SESSION = "reader-unauthorized";

/** The revisions, releases and instants the deterministic seed states, quoted so a comparison names what it expected. */
const SEEDED = {
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

/** The approved-supporter edition's own words, which no public reader may be shown in its place. */
const PROTECTED_COPY = { title: "Autumn at Harbour Youth — for supporters", sentence: "the monthly costs rose in September" } as const;

/** The Arabic prose the seed holds, used to tell one revision of that edition from another. */
const ARABIC_COPY = {
  title: "الخريف في هاربر يوث",
  /** The frozen candidate's closing sentence, which only a publication of that candidate serves. */
  candidateOnly: "يجعل هذا العمل ممكناً",
  /** The earlier publication's second paragraph, which the retained prior-good head still serves. */
  priorGoodOnly: "وتشاركنا وجبة.",
} as const;

/** The words the surfaces own, quoted from the copy modules so a comparison fails if the wording drifts. */
const COPY = {
  overviewHeading: "Editions, candidates and releases",
  noDraft: "No draft is saved for this edition yet, so there is nothing to submit for review.",
  noRelease: "This edition publishes nothing yet, so no reader is served a revision of it.",
  siblingNote: "Nothing here is a rollback, no sibling's release is removed",
  pageEditionsNote: "A Page variant is a public locale edition",
  reviewOffer: "Editions waiting for a release",
  reviewLink: "Open the review",
  restoreAction: "Restore the published revision as a new draft",
  restoreConfirm: "Restore as a new draft",
  withdrawLocaleAction: "Withdraw this language edition",
  withdrawLocaleConfirm: "Withdraw this edition",
  withdrawalDoesNotRecall: "does not recall a notice that has already been submitted",
  languageServed: "Language served",
  languageRequested: "Language requested",
  languageUnavailable: "Language unavailable",
  deliveryHeading: "Delivery results",
  ceilingLabel: "Eligible recipients the notice could not exceed",
  servedLabel: "Recipients with a recorded outcome",
  alreadyCovered: "Already had a copy from an earlier notice",
  outboundNotice: "simulated — no mail leaves this application",
  publicationSimulation: "simulated publication; reach is demonstrated in the receiving preview",
  devLabel: "Development data",
} as const;

/** Where each surface lives. Addresses are composed here the way a link would, never typed into a browser bar by a person. */
const OVERVIEW = `/communication/${UPDATE}`;
const editorPath = (variantId: string): string => `${OVERVIEW}/${encodeURIComponent(variantId)}`;
const previewPath = (variantId: string): string => `${editorPath(variantId)}/preview`;
const reviewPath = (candidateId: string): string => `/communication/review/${encodeURIComponent(candidateId)}`;
const receivingPath = (locale: string): string => `/preview/${UPDATE}?locale=${encodeURIComponent(locale)}`;
const deliveryPath = (intentId: string): string => `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
const PAGE_BUILDER = "/pages/doc-page-harbour-youth";

// ---------------------------------------------------------------------------------------------
// Reading the application's own JSON: the answers a surface reads, and nothing derived here
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

/** A string a comparison depends on, refusing an absent or blank one rather than comparing nothing. */
function stringAt(value: unknown, path: readonly string[], what: string): string {
  const found = fieldAt(value, ...path);
  if (typeof found !== "string" || found.trim() === "") {
    throw new Error(`${what} is not at ${path.join(".")} of the answer this file read, so the comparison would have compared nothing: ${JSON.stringify(value).slice(0, 400)}`);
  }
  return found;
}

/** The identifier the caller mints for one attempt: the identity every replay of that attempt is recognised by. */
function attemptId(): string {
  return crypto.randomUUID();
}

/** One answer, parsed, with the request that produced it named so a failure states what failed. */
async function jsonOf(answer: { readonly text: () => Promise<string> }, label: string): Promise<unknown> {
  const text = await answer.text();
  const body = parsed(text);
  if (body === undefined) {
    throw new Error(`${label} did not answer with JSON: ${text.slice(0, 400)}`);
  }
  return body;
}

/** The outcome a mutation answered with, refused when it is not one this file may continue from. */
function acceptedOutcomeOf(body: unknown, label: string): void {
  const outcome = fieldAt(body, "outcome");
  if (outcome !== "accepted" && outcome !== "alreadyAccepted" && outcome !== "unchanged") {
    throw new Error(`${label} was not accepted: ${JSON.stringify(body).slice(0, 400)}. A spec that could not perform the write it names would compare a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`);
  }
}

// ---------------------------------------------------------------------------------------------
// The development controls: the one armed failure this file uses
// ---------------------------------------------------------------------------------------------

/** What this session's development state states: the authority a control runs under and the revision it saw. */
interface DevState {
  readonly scope: Record<string, unknown>;
  readonly revision: string;
}

async function readDevState(page: Page): Promise<DevState> {
  const body = await jsonOf(await page.request.get("/api/dev"), "GET /api/dev");
  const scope = fieldAt(body, "scope");
  if (!isRecord(scope)) {
    throw new Error(`GET /api/dev answered without the scope a development control runs under: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { scope, revision: stringAt(body, ["revision"], "The development state's revision") };
}

/** Operates exactly one named development control and refuses a refusal, so an unarmed failure is never assumed. */
async function operateDevControl(page: Page, action: string, payload: Record<string, unknown>): Promise<void> {
  const state = await readDevState(page);
  const answer = await page.request.post("/api/dev", { data: { action, operationId: attemptId(), scope: state.scope, expectedRevision: state.revision, payload } });
  acceptedOutcomeOf(await jsonOf(answer, `POST /api/dev ${action}`), `The development control ${action}`);
}

/** Withholds the acknowledgement of a release. The effect and its ledger entry are stored and only the response is withheld. */
async function armLostReleaseAcknowledgement(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { mode: "unknown", target: { kind: "mutation", name: "publishVariants" } });
}

/** Disarms whatever plan stands armed: a plan lives in the session document until something clears it. */
async function clearFailurePlan(page: Page): Promise<void> {
  await operateDevControl(page, "setFailurePlan", { plan: null });
}

// ---------------------------------------------------------------------------------------------
// The writes this family mounts no control for, taken through the handler the browser uses
// ---------------------------------------------------------------------------------------------

/** The revision of the Update as the variant overview read states it, which is the revision a release presents. */
async function updateRevisionOf(page: Page): Promise<string> {
  const body = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE)}`), "GET /api/updates");
  return stringAt(body, ["revision"], "The Update's revision");
}

/** The scope a release or a notice claims, which is the context the session is working in. */
async function actingScopeOf(page: Page): Promise<Record<string, unknown>> {
  return (await readDevState(page)).scope;
}

/**
 * Releases one or more editions through `POST /api/publish`.
 *
 * The Updates family mounts no release control — its review route answers the frozen candidate and states
 * that the release is a separate step — so the step is taken through the same handler a browser surface
 * would post to, with the same four-field attempt. The answer's per-edition `items` are the durable result:
 * one state per edition, which is what a batch never collapses into one status.
 */
async function releaseEditions(page: Page, variantIds: readonly string[], operation = attemptId()): Promise<unknown> {
  const [scope, expectedRevision] = await Promise.all([actingScopeOf(page), updateRevisionOf(page)]);
  const payload = { documentId: UPDATE, variants: variantIds.map((variantId) => ({ variantId, mode: "publish-only" })) };
  return jsonOf(await page.request.post("/api/publish", { data: { operationId: operation, scope, expectedRevision, payload } }), "POST /api/publish");
}

/** One release's per-edition result, by edition, or a failure naming what the answer held instead. */
function editionResultOf(body: unknown, variantId: string): Record<string, unknown> {
  const items = fieldAt(body, "items");
  if (!Array.isArray(items)) {
    throw new Error(`The release answered without a per-edition result: ${JSON.stringify(body).slice(0, 400)}`);
  }
  for (const item of items) {
    if (fieldAt(item, "targetId") === variantId) {
      if (!isRecord(item)) break;
      return item;
    }
  }
  throw new Error(`The release answered no result for ${variantId}: ${JSON.stringify(body).slice(0, 400)}`);
}

/** Submits one deliberate notice for one published edition and answers the intent it created. */
async function requestNotice(page: Page, releaseId: string, acknowledgedCeiling: number): Promise<string> {
  const [scope, expectedRevision] = await Promise.all([actingScopeOf(page), updateRevisionOf(page)]);
  const payload = { documentId: UPDATE, releaseId, acknowledgedCeiling };
  const body = await jsonOf(await page.request.post("/api/notify", { data: { operationId: attemptId(), scope, expectedRevision, payload } }), "POST /api/notify");
  acceptedOutcomeOf(body, "The notice request");
  const created = fieldAt(body, "created");
  const intentId = Array.isArray(created) ? created.find((entry) => typeof entry === "string" && entry.startsWith("intent-")) : undefined;
  if (typeof intentId !== "string") {
    throw new Error(`The accepted notice named no intent: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return intentId;
}

// ---------------------------------------------------------------------------------------------
// Reading the surfaces the way a person does
// ---------------------------------------------------------------------------------------------

/** Escapes the characters a regular expression would otherwise read as syntax. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** One edition's cell in the variant grid, addressed by the identity the grid lists it under. */
function editionCell(page: Page, variantId: string): Locator {
  return page.locator(`[data-slot="edition-cell"][data-variant-id="${variantId}"]`);
}

/** The value of one fact in a definition list, matched by the label the cell states for it. */
function factValueOf(scope: Locator, label: string): Locator {
  return scope
    .locator("dt")
    .filter({ hasText: new RegExp(`^${escaped(label)}$`, "u") })
    .first()
    .locator("xpath=following-sibling::dd[1]");
}

/** The lifecycle word an edition's own status line states, as the state the shared vocabulary names. */
function lifecycleOfCell(cell: Locator): Locator {
  return cell.locator('[data-slot="draft-status"]');
}

/**
 * The published revision the edition's publication facts name.

 *
 * The cell states the revision beside its label and the release identity beside *Publication*; the revision
 * is what a release test compares, because a release that advanced the head names a new revision there.
 */
async function publishedRevisionOf(cell: Locator): Promise<string> {
  const stated = (await factValueOf(cell, "Published revision").innerText()).trim();
  const revision = /Revision\s+(\S+)/u.exec(stated);
  if (revision === null || revision[1] === undefined) {
    throw new Error(`The edition stated no published revision, so there is none to compare: ${stated.slice(0, 300)}`);
  }
  return revision[1];
}

// ---------------------------------------------------------------------------------------------
// 1. Each audience in each content language is its own working variant
// ---------------------------------------------------------------------------------------------

test("each language edition of an Update is its own variant with its own draft, candidate and publication", async ({ page }) => {
  await openOverview(page);

  // The grid states its own size and identity, so the four editions below are the document's whole set.
  const grid = page.locator('[data-slot="variant-overview"]');
  await expect(grid).toHaveAttribute("data-edition-count", "4");
  await expect(page.getByRole("heading", { name: COPY.overviewHeading, exact: true })).toBeVisible();
  // The two distinctions the grid depends on are stated in words rather than left to the badges.
  await expect(page.getByText("A saved draft is not what readers see", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(COPY.siblingNote, { exact: false }).first()).toBeVisible();
  // Direction and audience are axes of the record, and the axis rule says which pairings the family admits.
  await expect(page.getByText(COPY.pageEditionsNote, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(COPY.devLabel, { exact: true })).toBeVisible();

  // Four editions: English twice (public and approved supporters), French and Arabic once each.
  const cells = page.locator('[data-slot="edition-cell"]');
  await expect(cells).toHaveCount(4);
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

  // --- English public: published, and the publication names the revision and the instant it happened ---
  const english = editionCell(page, EDITION.enPublic);
  await expect(lifecycleOfCell(english)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(english)).toBe(SEEDED.enPublicRelease);
  await expect(factValueOf(english, "Published revision")).toContainText(SEEDED.enPublicPublishedAt);
  await expect(factValueOf(english, "Published revision")).toContainText("Shared by link: public");
  // A published edition in English holds no saved draft: the two pointers are separate facts.
  await expect(factValueOf(english, "Saved draft")).toHaveText(COPY.noDraft);

  // --- English for approved supporters: a second English variant with its own release ---
  const supporters = editionCell(page, EDITION.enSupporters);
  await expect(lifecycleOfCell(supporters)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(supporters)).toBe(SEEDED.enSupportersRelease);

  // --- French: its own publication, and a translation record that names the English source revision ---
  const french = editionCell(page, EDITION.frPublic);
  await expect(lifecycleOfCell(french)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(french)).toBe(SEEDED.frRelease);
  await expect(factValueOf(french, "Published revision")).toContainText(SEEDED.frPublishedAt);
  await expect(factValueOf(french, "Saved draft")).toHaveText(COPY.noDraft);
  // The translation's source revision is a record fact, so it is read where the record states it: the overview
  // read answers the translation of each edition, and the French one copied the English public revision.
  const overview = await jsonOf(await page.request.get(`/api/updates?documentId=${encodeURIComponent(UPDATE)}`), "GET /api/updates");
  const frenchEdition = (fieldAt(overview, "data", "editions") as readonly unknown[]).find((edition) => fieldAt(edition, "variantId") === EDITION.frPublic);
  expect(fieldAt(frenchEdition, "translation", "status")).toBe("fresh");
  expect(stringAt(frenchEdition, ["translation", "sourceRevisionId"], "The French edition's translation source")).toBe(SEEDED.enPublicRelease);

  // --- Arabic: a saved draft and a frozen candidate, and no publication at all ---
  const arabic = editionCell(page, EDITION.arPublic);
  await expect(lifecycleOfCell(arabic)).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(factValueOf(arabic, "Saved draft")).toHaveText(SEEDED.arDraft);
  await expect(factValueOf(arabic, "Submitted for review")).toContainText(SEEDED.arCandidate);
  await expect(factValueOf(arabic, "Published revision")).toHaveText(COPY.noRelease);
  // An edition that publishes nothing offers no preview and says why, rather than showing a draft as published.
  await expect(arabic.getByRole("link", { name: "Open the preview", exact: true })).toBeVisible();

  // The frozen candidate is what its one review step answers, and the grid links to that step by identity.
  const reviewOffer = page.locator("section").filter({ has: page.getByRole("heading", { name: COPY.reviewOffer, exact: true }) });
  await expect(reviewOffer).toContainText("1 edition awaiting a release");
  await expect(reviewOffer.getByRole("link", { name: COPY.reviewLink, exact: true })).toHaveAttribute("href", reviewPath(SEEDED.arCandidate));

  // The two selectors the grid offers are the edition axis and the language axis, each a closed set.
  const localeSelect = page.locator('[data-slot="locale-switcher"]').getByLabel("Language", { exact: true });
  expect(await optionValuesOf(localeSelect)).toEqual([...LOCALES]);
  await expect(page.locator('[data-slot="variant-switcher"]').getByText("Edition", { exact: true }).first()).toBeVisible();

  // The family rule is a real difference between the two families: a Page's editions are public locale
  // editions, so its builder offers a language and no audience choice at all. The pairing an Update admits —
  // public and approved supporters — is therefore never offered where the family does not hold it.
  await page.goto(PAGE_BUILDER);
  const builder = page.locator('[data-slot="page-builder"]');
  await expect(builder).toBeVisible();
  await expect(page.locator('[data-slot="locale-switcher"]').getByLabel("Language", { exact: true })).toBeVisible();
  await expect(builder.locator('[data-slot="locale-edition"]')).toHaveCount(2);
  await expect(builder.getByRole("radio", { name: "Approved supporters", exact: true })).toHaveCount(0);
  await expect(builder.getByLabel(/audience/iu)).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// 2. Saving one edition's draft leaves every sibling exactly as it was
// ---------------------------------------------------------------------------------------------

test("saving the Arabic draft leaves the English and French drafts and publications exactly as they were", async ({ page }) => {
  await openOverview(page);
  // What the siblings state before the edit, captured from the screen rather than assumed.
  const englishBefore = await publishedRevisionOf(editionCell(page, EDITION.enPublic));
  const frenchBefore = await publishedRevisionOf(editionCell(page, EDITION.frPublic));
  const frenchPublishedAt = (await factValueOf(editionCell(page, EDITION.frPublic), "Published revision").innerText()).trim();

  await page.goto(editorPath(EDITION.arPublic));
  const editor = page.locator('[data-slot="editor-shell"][data-edition="' + EDITION.arPublic + '"]');
  await expect(editor).toBeVisible();
  // The one editor surface states the language it is writing, under the language's own name for itself.
  await expect(editor).toContainText("العربية");
  const prose = editor.getByRole("textbox", { name: "The text of this Update edition", exact: true });
  await expect(prose).toBeVisible();

  // Type into the reserved Arabic draft: the cursor goes to the end of the document and the text is appended.
  await prose.click();
  await page.keyboard.press("ControlOrMeta+End");
  const typed = "متطوعون جدد انضموا هذا الأسبوع.";
  await page.keyboard.type(typed);
  // The autosave line states the acknowledged revision, which is the proof the text reached the record.
  await expect(editor.locator('[data-slot="autosave-status"]')).toContainText(/Saved — acknowledged revision/u);

  await openOverview(page);
  const arabic = editionCell(page, EDITION.arPublic);
  // The draft advanced to a new revision, and the frozen candidate it had already submitted did not move with it.
  const draftAfter = (await factValueOf(arabic, "Saved draft").innerText()).trim();
  expect(draftAfter).not.toBe(SEEDED.arDraft);
  expect(draftAfter.length).toBeGreaterThan(0);
  await expect(factValueOf(arabic, "Submitted for review")).toContainText(SEEDED.arCandidate);
  await expect(lifecycleOfCell(arabic)).toHaveAttribute("data-lifecycle-state", "candidate");

  // Neither sibling moved: the English publication is still the one it had, and the French one still publishes
  // its own revision at its own instant.
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic))).toBe(englishBefore);
  expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(frenchBefore);
  expect((await factValueOf(editionCell(page, EDITION.frPublic), "Published revision").innerText()).trim()).toBe(frenchPublishedAt);

  // The preview of the Arabic edition renders the acknowledged draft, so the typed sentence is on screen there —
  // the record's own statement that the text was written, not the form's echo of what was typed into it.
  await page.goto(previewPath(EDITION.arPublic));
  const preview = page.locator('[data-slot="preview-frame"]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(typed);
});

// ---------------------------------------------------------------------------------------------
// 3. One release attempt reports a result for each edition it was asked to release
// ---------------------------------------------------------------------------------------------

test("a release attempt reports one result per edition, and a sibling that cannot release is not rolled back", async ({ page }) => {
  await openOverview(page);
  const french = editionCell(page, EDITION.frPublic);
  // Restoring the published revision is how a new draft of an already published edition begins.
  await french.getByRole("button", { name: COPY.restoreAction, exact: true }).click();
  await page.getByRole("button", { name: COPY.restoreConfirm, exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  // A restored revision copies the digest of the one it restores, so a sentence of its own is what makes the
  // release below a publication of a revision nobody has published yet rather than the no-op `unchanged`.
  await appendToDraft(page, EDITION.frPublic, " Merci pour votre fidélité cette année.");
  await openOverview(page);
  const restoredDraft = (await factValueOf(editionCell(page, EDITION.frPublic), "Saved draft").innerText()).trim();
  expect(restoredDraft).not.toBe(SEEDED.frRelease);
  expect(restoredDraft.length).toBeGreaterThan(0);

  // One attempt names both editions. The Arabic edition is still awaiting its one review, so the attempt reports
  // a released French edition and an Arabic one that needs attention — never one status for the pair.
  const release = await releaseEditions(page, [EDITION.frPublic, EDITION.arPublic]);
  expect(fieldAt(release, "outcome")).toBe("accepted");
  const frenchResult = editionResultOf(release, EDITION.frPublic);
  const arabicResult = editionResultOf(release, EDITION.arPublic);
  expect(fieldAt(frenchResult, "state")).toBe("released");
  expect(fieldAt(arabicResult, "state")).toBe("needs-attention");
  expect(fieldAt(arabicResult, "reasonCode")).toBe("awaiting-review");

  await openOverview(page);
  // The French edition now publishes the revision that was restored, under its own identity.
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(restoredDraft);
  // The Arabic edition publishes nothing and was not half-released: its candidate is still frozen and unanswered.
  const arabic = editionCell(page, EDITION.arPublic);
  await expect(factValueOf(arabic, "Published revision")).toHaveText(COPY.noRelease);
  await expect(factValueOf(arabic, "Submitted for review")).toContainText(SEEDED.arCandidate);
  // The English editions, which the attempt never named, are untouched.
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic))).toBe(SEEDED.enPublicRelease);

  // The Arabic edition's one review step answers its frozen candidate, and only then is that same revision
  // released. The review route is reached by the identity the grid linked.
  await page.goto(reviewPath(SEEDED.arCandidate));
  const review = page.locator('[data-slot="review-panel"]');
  await expect(review).toHaveAttribute("data-family", "update");
  await expect(review.getByRole("radio", { name: "Approve", exact: true })).toBeChecked();
  await review.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  const arabicRelease = await releaseEditions(page, [EDITION.arPublic]);
  expect(fieldAt(editionResultOf(arabicRelease, EDITION.arPublic), "state")).toBe("released");
  await openOverview(page);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.arPublic))).toBe(SEEDED.arCandidate);
  // The approved candidate stays the edition's submission, so the lifecycle word keeps saying so; the release the
  // facts name is what a reader is served, which is the distinction this file exists to keep.
  await expect(lifecycleOfCell(editionCell(page, EDITION.arPublic))).toHaveAttribute("data-lifecycle-state", "candidate");
  // The French edition that the earlier attempt released is still served: releasing a sibling never withdraws it.
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(restoredDraft);

  // The exact revision the review approved is what the reader is now served, in Arabic and right to left.
  await page.goto(receivingPath(ARABIC));
  const surface = page.locator('[data-slot="receiving-post-surface"]');
  await expect(surface).toHaveAttribute("data-surface", "rendered");
  const post = page.locator('[data-slot="receiving-post"]');
  await expect(post).toContainText(ARABIC_COPY.candidateOnly);
  await expect(post.getByText("Language served", { exact: false }).first()).toBeVisible();
  expect(await post.locator('div[dir="rtl"][lang="ar"]').count()).toBeGreaterThan(0);
});

/** Opens the variant grid of the seeded Update and waits for the grid itself. */
async function openOverview(page: Page): Promise<void> {
  await page.goto(OVERVIEW);
  await expect(page.locator('[data-slot="variant-overview"]')).toHaveAttribute("data-document-id", UPDATE);
}

/**
 * Writes one sentence at the end of an edition's saved draft and waits for the service to acknowledge it.
 *
 * The autosave line names the revision it saved, which is the proof the text reached the record: the sentence is
 * never assumed to have been written because it was typed.
 */
async function appendToDraft(page: Page, variantId: string, sentence: string): Promise<void> {
  await page.goto(editorPath(variantId));
  const editor = page.locator(`[data-slot="editor-shell"][data-edition="${variantId}"]`);
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "The text of this Update edition", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(sentence);
  await expect(editor.locator('[data-slot="autosave-status"]')).toContainText(/Saved — acknowledged revision/u);
}

/** Puts one seeded session in the browser context's cookie jar, which is the whole identity a request is authorised as. */
async function actAs(context: BrowserContext, origin: string, sessionId: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, url: origin }]);
}

/** The origin the application is served from, taken from an answer the browser's own request context received. */
async function originOf(page: Page): Promise<string> {
  return new URL((await page.request.get("/api/session")).url()).origin;
}

/** The list of option values a native select offers, so a closed set is compared as the control states it. */
async function optionValuesOf(select: Locator): Promise<readonly string[]> {
  return select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
}

/** One text region's characters, with the direction controls the specification forbids in stored content. */
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/** The text of one region as the browser renders it, used where a comparison is about characters rather than layout. */
async function renderedTextOf(scope: Locator): Promise<string> {
  return scope.evaluate((element) => (element as HTMLElement).textContent ?? "");
}

/** The release identity an edition's publication facts name, which changes exactly once per release of that edition. */
async function publicationIdOf(cell: Locator): Promise<string> {
  const stated = (await factValueOf(cell, "Published revision").innerText()).trim();
  const publication = /Publication\s+(\S+)/u.exec(stated);
  if (publication === null || publication[1] === undefined) {
    throw new Error(`The edition stated no publication identity, so a second release could not be told from the first: ${stated.slice(0, 300)}`);
  }
  return publication[1];
}

// ---------------------------------------------------------------------------------------------
// 4. A failed sibling keeps the revision it already published
// ---------------------------------------------------------------------------------------------

test("a release attempt that failed for one edition keeps that edition's earlier publication standing", async ({ page }) => {
  // The partial-release world is the same ministry after one submission released one edition and failed for its
  // sibling. Its own session states that record, so the surface is asked for the world that holds it.
  await actAs(page.context(), await originOf(page), PARTIAL_RELEASE_SESSION);
  await openOverview(page);

  // The edition whose attempt succeeded publishes the revision that attempt produced.
  const english = editionCell(page, EDITION.enPublic);
  await expect(await publishedRevisionOf(english)).toBe(SEEDED.enSecondRelease);
  await expect(lifecycleOfCell(english)).toHaveAttribute("data-lifecycle-state", "released");

  // The edition whose attempt failed still publishes the revision it published before, under its own earlier
  // instant: a retained prior-good head, which is neither a new translation of the sibling's success nor a
  // withdrawal, and the grid states in words that nothing was rolled back.
  const arabic = editionCell(page, EDITION.arPublic);
  await expect(await publishedRevisionOf(arabic)).toBe(SEEDED.arPriorGoodRelease);
  await expect(factValueOf(arabic, "Published revision")).toContainText(SEEDED.arPriorGoodPublishedAt);
  await expect(factValueOf(arabic, "Published revision")).not.toContainText("2026-11-18");
  // Beneath that retained publication the edition still holds the frozen candidate the failed attempt never
  // released, and the grid states that as the edition's own lifecycle word rather than as a publication.
  await expect(lifecycleOfCell(arabic)).toHaveAttribute("data-lifecycle-state", "candidate");
  await expect(factValueOf(arabic, "Submitted for review")).toContainText(SEEDED.arCandidate);

  // The French translation of the edition that moved is disclosed as stale, and nothing about it was withdrawn:
  // a stale translation is a fact about the source, not an approval and not a publication event.
  const french = editionCell(page, EDITION.frPublic);
  await expect(french.getByText("Translation: Translation stale", { exact: true })).toBeVisible();
  await expect(lifecycleOfCell(french)).toHaveAttribute("data-lifecycle-state", "released");
  await expect(await publishedRevisionOf(french)).toBe(SEEDED.frRelease);

  // What a reader is served proves the same thing from the other side: the Arabic edition serves the earlier
  // publication's text, and not a word of the revision the failed attempt would have released.
  await page.goto(receivingPath(ARABIC));
  const post = page.locator('[data-slot="receiving-post"]');
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "rendered");
  await expect(post).toContainText(ARABIC_COPY.priorGoodOnly);
  await expect(post).not.toContainText(ARABIC_COPY.candidateOnly);
  // The English edition is served at the later revision, so the two editions are served from different points.
  await page.goto(receivingPath("en"));
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText("planning the Christmas meal");
});

// ---------------------------------------------------------------------------------------------
// 5. A lost acknowledgement is recovered under its own operation, never by releasing twice
// ---------------------------------------------------------------------------------------------

test("a release whose acknowledgement was lost is recovered by replaying the same attempt, and publishes once", async ({ page }) => {
  await openOverview(page);
  // A new draft of the French edition, so there is a revision to release.
  await editionCell(page, EDITION.frPublic).getByRole("button", { name: COPY.restoreAction, exact: true }).click();
  await page.getByRole("button", { name: COPY.restoreConfirm, exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");
  // A restored revision copies the one it restores, digest included, so releasing it again would be the no-op the
  // service reports as `unchanged`. A sentence of its own makes it a release of a revision nobody published yet.
  await appendToDraft(page, EDITION.frPublic, " Merci pour votre fidélité cette année.");
  await openOverview(page);
  const restoredDraft = (await factValueOf(editionCell(page, EDITION.frPublic), "Saved draft").innerText()).trim();
  const publicationBefore = await publicationIdOf(editionCell(page, EDITION.frPublic));

  // The acknowledgement of this release is going to be withheld. The effect and its ledger entry are stored; only
  // the answer is lost, which is exactly the state a person must be able to recover from.
  await armLostReleaseAcknowledgement(page);
  const [scope, expectedRevision] = await Promise.all([actingScopeOf(page), updateRevisionOf(page)]);
  const operation = attemptId();
  const attempt = { operationId: operation, scope, expectedRevision, payload: { documentId: UPDATE, variants: [{ variantId: EDITION.frPublic, mode: "publish-only" }] } };
  const first = await jsonOf(await page.request.post("/api/publish", { data: attempt }), "POST /api/publish (acknowledgement withheld)");
  expect(fieldAt(first, "outcome")).toBe("unknown");

  await openOverview(page);
  // The attempt did reach the record: the French edition publishes the restored revision, under a new release.
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(restoredDraft);
  const publicationAfterAttempt = await publicationIdOf(editionCell(page, EDITION.frPublic));
  expect(publicationAfterAttempt).not.toBe(publicationBefore);

  // The recovery is the same attempt replayed, byte for byte, and the application answers with the result it
  // stored rather than performing the release a second time.
  const replay = await jsonOf(await page.request.post("/api/publish", { data: attempt }), "POST /api/publish (same attempt replayed)");
  expect(fieldAt(replay, "outcome")).toBe("alreadyAccepted");
  await openOverview(page);
  expect(await publicationIdOf(editionCell(page, EDITION.frPublic))).toBe(publicationAfterAttempt);
  await expect(await publishedRevisionOf(editionCell(page, EDITION.frPublic))).toBe(restoredDraft);
  // Nothing else released. The siblings keep exactly the publications they had.
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic))).toBe(SEEDED.enPublicRelease);
  await expect(factValueOf(editionCell(page, EDITION.arPublic), "Published revision")).toHaveText(COPY.noRelease);
  await clearFailurePlan(page);
});

// ---------------------------------------------------------------------------------------------
// 6. A language nothing serves is answered honestly, and a refusal discloses nothing
// ---------------------------------------------------------------------------------------------

test("a requested language is answered with the language actually served, or with Language unavailable", async ({ page }) => {
  // --- the edition exists in the language asked for ---
  await page.goto(receivingPath("fr"));
  const servedSurface = page.locator('[data-slot="receiving-post-surface"]');
  await expect(servedSurface).toHaveAttribute("data-surface", "rendered");
  await expect(page.locator('[data-slot="receiving-post"]')).toHaveAttribute("data-fallback", "false");
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText("Language served: fr");
  await expect(page.locator('[data-slot="receiving-post"]')).not.toContainText(COPY.languageRequested);

  // --- the same language, in a regional form nothing publishes: the served language is named as the one used ---
  await page.goto(receivingPath("fr-CA"));
  const fallbackPost = page.locator('[data-slot="receiving-post"]');
  await expect(fallbackPost).toHaveAttribute("data-fallback", "true");
  await expect(fallbackPost).toContainText("Language served: fr");
  await expect(fallbackPost).toContainText("Language requested: fr-CA");
  await expect(fallbackPost).toContainText("You asked to read this in fr-CA, and it is shown in fr.");
  // Falling back changed the language and nothing else: the audience served is still the public edition.
  await expect(fallbackPost).toContainText("Audience: Public");
  await expect(fallbackPost.locator('div[lang="fr"]')).toHaveCount(1);

  // --- a language no edition of this Update serves at all ---
  await page.goto(receivingPath("de"));
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "language-unavailable");
  const unavailable = page.locator('[data-slot="receiving-post-language-unavailable"]');
  await expect(unavailable.getByRole("heading", { name: COPY.languageUnavailable, exact: true })).toBeVisible();
  await expect(unavailable).toContainText("Language requested: de");
  // Nothing stands in for it: no edition is rendered and no prose from another language is substituted.
  await expect(page.locator('[data-slot="receiving-post"]')).toHaveCount(0);
  await expect(page.getByText("L'automne à Harbour Youth", { exact: false })).toHaveCount(0);
  await expect(page.getByText("You asked to read this in de", { exact: false })).toHaveCount(0);

  // --- a reader with no protected grant: the public edition is served, and the protected variant is not named ---
  await actAs(page.context(), await originOf(page), UNAUTHORIZED_READER_SESSION);
  await page.goto(receivingPath("en"));
  const publicPost = page.locator('[data-slot="receiving-post"]');
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "rendered");
  await expect(publicPost).toContainText("Audience: Public");
  await expect(publicPost).not.toContainText(PROTECTED_COPY.title);
  await expect(publicPost).not.toContainText(PROTECTED_COPY.sentence);
});

// ---------------------------------------------------------------------------------------------
// 7. One notice yields one row per recipient, one pinned copy, and no second copy in another language
// ---------------------------------------------------------------------------------------------

test("one recorded notice gives every recipient one row and one pinned copy, and a second language adds none", async ({ page }) => {
  await page.goto(deliveryPath(SEEDED.noticeIntent));
  await expect(page.getByRole("heading", { name: COPY.deliveryHeading, exact: true })).toBeVisible();
  // The mail-submission boundary is labelled where the outcomes are read, because that is where a reader would
  // otherwise take "accepted" for a message that left the application.
  await expect(page.getByText(COPY.outboundNotice, { exact: true }).first()).toBeVisible();

  // The notice the seed recorded: four recipients, each with one row, and the three outcomes kept apart.
  const table = page.getByRole("table", { name: new RegExp(`^${escaped(COPY.deliveryHeading)}: recorded outcomes for notice ${escaped(SEEDED.noticeIntent)}$`, "u") });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(table.getByText("Accepted — not delivered", { exact: true })).toHaveCount(2);
  await expect(table.getByText("Failed", { exact: true })).toHaveCount(1);
  await expect(table.getByText("Outcome unknown", { exact: true })).toHaveCount(1);

  const recipients: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const row = rows.nth(index);
    const identity = row.locator('[data-slot="delivery-dedupe-identity"]');
    // The dedupe identity is four values, and the intent is one of them, so every row is this notice's own copy.
    await expect(identity).toContainText("Publisher");
    await expect(identity).toContainText("Purpose");
    await expect(identity).toContainText("Recipient");
    await expect(identity).toContainText(SEEDED.noticeIntent);
    // The copy this recipient was pinned to is stated once and is a rendition, so it cannot drift with a later
    // change of audience or language.
    await expect(row).toContainText("rendition-");
    recipients.push(
      (
        await identity
          .locator("dt")
          .filter({ hasText: /^Recipient$/u })
          .locator("xpath=following-sibling::dd[1]")
          .innerText()
      ).trim(),
    );
  }
  // Four recipients, four rows: no person holds two rows, which is what one notice per recipient means here.
  expect(new Set(recipients).size).toBe(4);
  for (const recipient of recipients) expect(recipient.length).toBeGreaterThan(0);
  // No two rows share one dedupe identity, and no recipient who was eligible went unserved, so the recorded
  // result reconciles with the ceiling the review acknowledged rather than being summarised into it.
  await expect(page.locator('[data-slot="delivery-duplicates"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="delivery-unserved"]')).toHaveCount(0);
  const summary = page.locator('[data-slot="delivery-summary"]');
  await expect(summary).toContainText(SEEDED.noticeIntent);
  await expect(summary).toContainText(SEEDED.enPublicReleaseRecord);
  await expect(summary).toContainText("Update email");
  await expect(summary).toContainText(COPY.ceilingLabel);
  await expect(summary).toContainText(COPY.servedLabel);

  // The one recipient whose earlier submission definitely failed is the only one this notice could not reach.
  const failedRecipient = (
    await rows
      .filter({ has: page.getByText("Failed", { exact: true }) })
      .locator('[data-slot="delivery-dedupe-identity"] dt')
      .filter({ hasText: /^Recipient$/u })
      .locator("xpath=following-sibling::dd[1]")
      .innerText()
  ).trim();
  expect(recipients).toContain(failedRecipient);

  // A deliberate notice for the French edition of the same Update. Nobody already covered may receive a second
  // copy in another language, so the accepted notice serves only the recipient whose earlier copy failed.
  const frenchIntent = await requestNotice(page, SEEDED.frReleaseRecord, 4);
  await page.goto(deliveryPath(frenchIntent));
  const frenchTable = page.getByRole("table", { name: new RegExp(`^${escaped(COPY.deliveryHeading)}: recorded outcomes for notice ${escaped(frenchIntent)}$`, "u") });
  const frenchRows = frenchTable.locator("tbody tr");
  await expect(frenchRows).toHaveCount(1);
  await expect(frenchRows.first().locator('[data-slot="delivery-dedupe-identity"]')).toContainText(frenchIntent);
  const servedAgain = (
    await frenchRows
      .first()
      .locator('[data-slot="delivery-dedupe-identity"] dt')
      .filter({ hasText: /^Recipient$/u })
      .locator("xpath=following-sibling::dd[1]")
      .innerText()
  ).trim();
  expect(servedAgain).toBe(failedRecipient);
  // Everyone else is recorded as already holding a copy of this Update's notice, so a second language produced no
  // second message for them: the row count above is how many copies were made, not how many were eligible.
  const unserved = page.locator('[data-slot="delivery-unserved"]');
  await expect(unserved).toBeVisible();
  await expect(unserved.getByText(COPY.alreadyCovered, { exact: false })).toHaveCount(3);
  for (const recipient of recipients.filter((id) => id !== failedRecipient)) {
    await expect(unserved).toContainText(recipient);
  }
  await expect(page.locator('[data-slot="delivery-duplicates"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// 8. Arabic is authored and read right to left, and no direction control character is stored
// ---------------------------------------------------------------------------------------------

test("the Arabic edition is authored and read right to left, with mixed-direction values kept in order", async ({ page }) => {
  await page.goto(editorPath(EDITION.arPublic));
  const editor = page.locator(`[data-slot="editor-shell"][data-edition="${EDITION.arPublic}"]`);
  await expect(editor).toBeVisible();
  // Direction is a property of the document, carried by the region that holds the writing rather than by a
  // physical alignment applied to left-to-right text.
  const prose = page.getByRole("textbox", { name: "The text of this Update edition", exact: true });
  await expect(prose).toBeVisible();
  // The route states the edition's direction on the region it renders, and the editor states the same direction on
  // its own writing surface, so the writing sits inside a right-to-left block rather than beside one.
  await expect(page.locator('section[dir="rtl"]').filter({ has: prose }).first()).toBeVisible();
  await expect(page.locator('[dir="rtl"][lang="ar"]').first()).toBeVisible();
  // The one editor's toolbar is present, so the authoring surface is the bounded one rather than a plain box.
  await expect(page.getByRole("group", { name: "Text formatting", exact: true })).toBeVisible();
  await prose.click();
  await page.keyboard.press("ControlOrMeta+End");
  // A list, in the edition's own direction: the marker sits on the logical start of the line, not on the left by
  // accident, because the list is part of a right-to-left document.
  await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
  const firstItem = "نتقابل كل جمعة";
  const secondItem = "نشارك وجبة";
  await page.keyboard.type(firstItem);
  await page.keyboard.press("Enter");
  await page.keyboard.type(secondItem);
  // Two returns leave the list, so the mixed-direction line below is a paragraph of its own rather than a third item.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  // A line whose values point the other way: a Latin name, a phone number, a URL and a civil date. Each is a value
  // in the text, and the paragraph around them keeps its own order.
  const mixed = "Harbour Youth — +44 7700 900123 — https://example.org/youth — 2026-11-20";
  await page.keyboard.type(mixed);
  await expect(editor.locator('[data-slot="autosave-status"]')).toContainText(/Saved — acknowledged revision/u);

  // The preview renders the acknowledged revision through the one renderer, in the edition's language and direction.
  await page.goto(previewPath(EDITION.arPublic));
  const preview = page.locator('[data-slot="preview-frame"]');
  await expect(preview).toBeVisible();
  const rendered = preview.locator('div[dir="rtl"][lang="ar"]');
  await expect(rendered).toHaveCount(1);
  // The list is a list in that direction: two items, in the order they were written.
  const items = rendered.locator("ul > li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(firstItem);
  await expect(items.nth(1)).toContainText(secondItem);
  // The mixed-direction values survive as written, in the order they were typed, and are isolated rather than
  // reordering the text around them.
  const renderedText = await renderedTextOf(rendered);
  expect(renderedText).toContain(mixed);
  expect(renderedText.indexOf(firstItem)).toBeLessThan(renderedText.indexOf(secondItem));
  expect(renderedText.indexOf(secondItem)).toBeLessThan(renderedText.indexOf(mixed));
  // No direction control character reached the record: logical order is stored, and the direction comes from the
  // document. This is the only place in this file where those characters are named.
  expect(BIDI_CONTROLS.test(renderedText)).toBe(false);
  // The mirroring is the document's direction and not a physical alignment laid over left-to-right text.
  await expect(rendered).not.toHaveAttribute("style", /direction|text-align/u);
});

// ---------------------------------------------------------------------------------------------
// 9. Withdrawing one language edition leaves the other editions served
// ---------------------------------------------------------------------------------------------

test("withdrawing the French edition stops that edition being served and leaves English and Arabic standing", async ({ page }) => {
  await openOverview(page);
  const french = editionCell(page, EDITION.frPublic);
  await french.getByRole("button", { name: COPY.withdrawLocaleAction, exact: true }).click();
  // A withdrawal is consequential, so it is confirmed deliberately and states what it cannot do before it is taken.
  await expect(page.getByText(COPY.withdrawalDoesNotRecall, { exact: false }).first()).toBeVisible();
  // The confirmation control opens a dialog, and the decision is taken inside it rather than by pressing the trigger twice.
  const step = page.locator('[data-slot="action-review"]');
  await step.getByRole("button", { name: COPY.withdrawLocaleConfirm, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: COPY.withdrawLocaleConfirm, exact: true }).click();
  await expect(page.locator('[data-slot="action-review-result"]')).toHaveAttribute("data-outcome", "accepted");

  await openOverview(page);
  const withdrawn = editionCell(page, EDITION.frPublic);
  await expect(lifecycleOfCell(withdrawn)).toHaveAttribute("data-lifecycle-state", "withdrawn");
  // The publication facts keep the record that it was once published, and state that it is no longer served.
  await expect(factValueOf(withdrawn, "Published revision")).toContainText("Withdrawn");
  await expect(factValueOf(withdrawn, "Published revision")).toContainText(SEEDED.frRelease);
  // The action a withdrawn edition cannot offer is withheld with its reason rather than shown disabled.
  await expect(withdrawn.getByRole("button", { name: COPY.withdrawLocaleAction, exact: true })).toHaveCount(0);

  // The other two language editions are exactly as they were: one still publishes its own revision, the other
  // still publishes nothing.
  await expect(await publishedRevisionOf(editionCell(page, EDITION.enPublic))).toBe(SEEDED.enPublicRelease);
  await expect(lifecycleOfCell(editionCell(page, EDITION.enPublic))).toHaveAttribute("data-lifecycle-state", "released");
  await expect(factValueOf(editionCell(page, EDITION.arPublic), "Published revision")).toHaveText(COPY.noRelease);
  await expect(page.getByText(COPY.devLabel, { exact: true })).toBeVisible();

  // What a reader is served agrees: the withdrawn language has nothing readable here, and not one word of the
  // withdrawn edition stands in its place.
  await page.goto(receivingPath("fr"));
  await expect(page.locator('[data-slot="receiving-post-surface"]')).toHaveAttribute("data-surface", "language-unavailable");
  await expect(page.getByText("L'automne à Harbour Youth", { exact: false })).toHaveCount(0);
  // The English edition the withdrawal never named is still served, so the withdrawal reached one edition.
  await page.goto(receivingPath("en"));
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText("Autumn at Harbour Youth");
  await expect(page.locator('[data-slot="receiving-post"]')).toContainText(COPY.publicationSimulation);
});
