/**
 * Criterion 19 — context and access.
 *
 * Two identities that share nothing with the owner call the application's own browser-facing data
 * surface directly, without operating the interface to reach the record: the second worker, admitted
 * to another organisation, and a reader holding no grant. Neither obtains the owner's private note,
 * gift identifiers, draft title, protected edition, protected media bytes or export. A denied or
 * expired session is answered with recovery guidance and never with an empty surface, and a context
 * switch fences the read that was in flight when it began.
 *
 * The scenario this file drives, from the deterministic seed:
 * - the primary worker (session `established-worker`) in the Harbour youth ministry, holding a private
 *   note on one partner, an unreleased Arabic draft, an approved-supporter edition that carries prose
 *   the public edition does not, a protected video placement and exportable gifts;
 * - a second worker in another organisation (`second-worker`), whose scope shares nothing with it;
 * - an unauthorised reader (`reader-unauthorized`), whose refusal discloses no count, title, size or
 *   existence hint;
 * - a denied session and an expired session (`session-denied`, `session-expired`), each of which
 *   offers a way back in rather than a blank page.
 *
 * Every value the outside identities must never obtain is captured from the owner's own surfaces
 * first, so the assertions name what the application really holds rather than a guess about it.
 */
import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";

// The development session cookie is the whole of the identity this application authorises a request as
// — `src/proxy.ts` mints it and `data-service/authorize.ts` resolves it — so a spec acts as a seeded
// identity by naming that identity's session in the jar, which is exactly what the runner's own
// `seedReset` fixture does. Reading the cookie's name from the runner rather than repeating the literal
// is what keeps this file from silently acting as the default identity if the name ever changes.
import { resetSeed, SESSION_COOKIE } from "../playwright.config";

test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

/** The seeded session that owns every record this file protects. */
const OWNER_SESSION = "established-worker";

/** The seeded session admitted to another organisation, whose scope shares nothing with the owner's. */
const SECOND_WORKER_SESSION = "second-worker";

/** A seeded reader holding no grant of any kind: the persona whose refusal must disclose nothing. */
const UNAUTHORISED_READER_SESSION = "reader-unauthorized";

/**
 * The two seeded session states that admit nothing, each with the exact recovery sentence the shell
 * renders for it. They are kept apart from the reader because a session that was never admitted and one
 * that has ended are different facts, and neither may render as an empty workspace.
 */
const REFUSED_SESSIONS = [
  { sessionId: "session-denied", label: "a denied session", heading: /This workspace is not available to this session/u, reason: /Reason not-admitted/u, guidance: "request-access" },
  { sessionId: "session-expired", label: "an expired session", heading: /This session has expired/u, reason: /Reason session-expired/u, guidance: "sign-in-again" },
] as const;

/**
 * The owner's partner record, draft edition and two content editions, named by the identifiers the
 * deterministic seed lays down.
 *
 * They are fixtures rather than values read off a screen because this file *attacks* them: the address
 * it asks for has to be the one the owner's own surface shows. Each one is confirmed against the
 * owner's authorised screens in {@link captureOwnerValues} before any other identity is asked for it, so
 * a seed change breaks the capture with a readable message instead of quietly weakening an assertion.
 */
const OWNER_PARTNER_ID = "partner-jo-mbeki";
const OWNER_PARTNER_NAME = "Jo Mbeki";
const OWNER_DRAFT_EDITION = "variant-update-autumn-ar-public";
/** The released public edition of the same Update, which the protected edition is compared against. */
const PUBLIC_EDITION = { variantId: "variant-update-autumn-en-public", revisionId: "rev-update-en-1" } as const;
/** The approved-supporter edition: the protected content an unadmitted caller must never receive. */
const PROTECTED_EDITION = { variantId: "variant-update-autumn-en-approved-supporter", revisionId: "rev-update-en-supporter-1" } as const;
/** The released Worker Page whose preview placement publishes the video, so its `src` is a real address. */
const OWNER_PAGE_EDITION = { documentId: "doc-page-harbour-youth", locale: "en" } as const;
/** The owner's finance subject: a second worker's own reads must never report it. */
const OWNER_SUPPORT_SUBJECT = "sup-harbour-youth";
/** The owner's principal: no response an outside identity receives may name it as the acting principal. */
const OWNER_PRINCIPAL = "principal-established-worker";
/** The report query the owner exports, repeated verbatim by each outside identity. */
const EXPORT_QUERY = { reportId: "received-period-and-year-to-date" } as const;

/** One response this file judges: what asked for it, what came back, and the body as text. */
interface Probe {
  /** The job the call performs, in words a failure message can use. */
  readonly label: string;
  readonly response: APIResponse;
  readonly body: string;
}

/** The values only the owner is entitled to, captured from the owner's own surfaces. */
interface OwnerValues {
  /** The body of the owner's private note, read from the record's own private-notes card. */
  readonly privateNote: string;
  /** The gift identifier the ledger's row links to, read from that row's own address. */
  readonly giftId: string;
  /** The gift row's identifier, as the owner's ledger read reports it. */
  readonly giftRowId: string;
  /** The share title of the owner's unreleased draft edition. */
  readonly draftTitle: string;
  /** The share title of the approved-supporter edition. */
  readonly protectedTitle: string;
  /** The one paragraph the approved-supporter edition carries and its public sibling does not. */
  readonly protectedParagraph: string;
  /** The address the owner's own preview player asks the protected video from. */
  readonly mediaSrc: string;
}

/** One call an outside identity makes, and what it is entitled to receive from it. */
interface OutsideCall {
  /** The job the call performs, in words a failure message can use. */
  readonly label: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  /** The body a POST sends, built at call time so a captured identifier can be named in it. */
  readonly payload?: () => unknown;
  /**
   * The text this call searches its roster for, where it is a search: the read states what it applied,
   * so the caller's own words come back in the answer and are judged by the rows rather than by the echo.
   */
  readonly searchesFor?: (values: OwnerValues) => string;
  /**
   * What the second worker receives. `refused` is the only answer the readers, the denied session and
   * the expired session get for every one of these calls; the second worker holds its own membership,
   * so its own reads answer its own scope — which is exactly what must contain none of the owner's
   * values.
   */
  readonly secondWorker: "refused" | "own-scope" | "own-scope-empty-roster";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body as a value, or `undefined` for a body that is not JSON — a refusal is always JSON here. */
function parsed(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** One value inside a parsed body, by path, or `undefined` where the path does not hold. */
function fieldAt(value: unknown, ...path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      // A list is indexed by its position, so the segment is read as one; anything else names no member
      // of a list and resolves to nothing rather than to a property the list does not carry.
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** A string a capture depends on, refusing an absent or blank one with the path it looked at. */
function stringAt(value: unknown, path: readonly string[], what: string): string {
  const found = fieldAt(value, ...path);
  if (typeof found !== "string" || found.trim().length === 0) {
    throw new Error(`${what} is not at ${path.join(".")} of the response this file read. The seeded fixture this file attacks has moved, so the assertion would have compared nothing; restore the seed's own value or name the new one here.`);
  }
  return found;
}

/** The `<p>`-level lines of a rendered edition, with tags removed and whitespace collapsed. */
function paragraphsOf(renderedHtml: string): readonly string[] {
  return renderedHtml
    .split(/<\/(?:p|h1|h2|h3|h4|li)>/u)
    .map((chunk) =>
      chunk
        .replace(/<[^>]*>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

/**
 * The origin the application is served from, taken from a response the browser's own request context
 * received, so a cookie is set on the address it is actually read from rather than on a guess.
 */
async function originOf(page: Page): Promise<string> {
  const response = await page.request.get("/api/session");
  return new URL(response.url()).origin;
}

/**
 * Puts one seeded session in the browser context's cookie jar, which is the whole of the identity the
 * application authorises a request as.
 *
 * The jar is cleared first so a cookie left by an earlier identity cannot be sent alongside this one:
 * one request, one identity. Every read that follows is authorised again from this value, so nothing
 * the previous identity fetched is what makes the next answer correct.
 */
async function actAs(context: BrowserContext, origin: string, sessionId: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, url: origin }]);
}

/** One GET through the browser's own request context, so it carries the cookie jar this test set. */
async function get(page: Page, label: string, path: string): Promise<Probe> {
  const response = await page.request.get(path);
  return { label, response, body: await response.text() };
}

/** One POST through the browser's own request context, carrying a JSON body. */
async function post(page: Page, label: string, path: string, body: unknown): Promise<Probe> {
  const response = await page.request.post(path, { data: body });
  return { label, response, body: await response.text() };
}

/** Asserts a response carries none of the values only the owner may see, apart from what the caller itself supplied. */
function expectNoOwnerValue(probe: Probe, ownerOnly: readonly string[], supplied: readonly string[] = []): void {
  for (const value of ownerOnly) {
    // A caller's own search term comes back in the read's own statement of what it applied. That echo
    // is the request's text returning to the request, not a record disclosing itself, so a value this
    // caller supplied is judged by the rows the read answers with instead.
    if (supplied.includes(value)) continue;
    expect(probe.body, `${probe.label} answered with a value only the owner may see: ${JSON.stringify(value)}`).not.toContain(value);
  }
}

/**
 * Asserts one call was refused, and that the refusal discloses nothing about what it refused.
 *
 * The body of a refusal here is the closed `denied` outcome and nothing else — the attempt's identity
 * and a reason code — so the assertion is made on the key set rather than by looking for the fields a
 * leak might carry. A count, a title, a size or an existence flag could not be added to that shape
 * without failing this, and searching the text for the owner's own values covers a leak smuggled into
 * a message.
 */
function expectRefused(probe: Probe, ownerOnly: readonly string[]): void {
  expect([401, 403], `${probe.label} must refuse this identity, and answered ${String(probe.response.status())}`).toContain(probe.response.status());
  const body = parsed(probe.body);
  expect(fieldAt(body, "outcome"), `${probe.label} must answer the closed denied outcome`).toBe("denied");
  expect(Object.keys(isRecord(body) ? body : {}).sort(), `${probe.label} answered a refusal, so its body carries the refusal and nothing about the record: no count, title, size or existence flag`).toEqual(["operationId", "outcome", "reasonCode"]);
  expectNoOwnerValue(probe, ownerOnly);
}

/**
 * Asserts one call was answered from the caller's own scope, and that its answer holds none of the
 * owner's values.
 *
 * The scope the envelope states is the authority the read ran under, so this is the assertion that a
 * second worker's own list is *their* list: a different principal, and a finance subject that is not
 * the owner's.
 */
function expectOwnScope(probe: Probe, principalId: string, ownerOnly: readonly string[]): void {
  expect(probe.response.status(), `${probe.label} answers this caller's own scope`).toBe(200);
  const body = parsed(probe.body);
  expect(stringAt(body, ["scope", "principalId"], `${probe.label} scope principal`), `${probe.label} must be read as the calling principal`).toBe(principalId);
  expect(stringAt(body, ["scope", "supportSubjectId"], `${probe.label} scope subject`), `${probe.label} must not report the owner's finance subject`).not.toBe(OWNER_SUPPORT_SUBJECT);
  expectNoOwnerValue(probe, ownerOnly);
}

/** The rows and total a roster read answered, refusing a body that carries neither. */
function rosterOf(probe: Probe): { readonly total: number; readonly rows: number } {
  const body = parsed(probe.body);
  const total = fieldAt(body, "data", "total");
  const rows = fieldAt(body, "data", "rows");
  if (typeof total !== "number" || !Array.isArray(rows)) {
    throw new Error(`${probe.label} did not answer a roster: expected data.total and data.rows, and its body begins ${JSON.stringify(probe.body.slice(0, 200))}.`);
  }
  return { total, rows: rows.length };
}

/**
 * Asserts a roster search answered no record at all — no row and a whole-result total of zero.
 *
 * A search over another scope's own words is answered by the caller's own roster, so the empty answer
 * is the proof that the searched record is not in this scope, provided the same search does find a
 * record the caller does hold; each test that relies on this makes that second check beside it.
 */
function expectEmptyRoster(probe: Probe, ownerOnly: readonly string[], supplied: readonly string[] = []): void {
  expect(probe.response.status(), `${probe.label} answers this caller's own roster`).toBe(200);
  const roster = rosterOf(probe);
  expect(roster.total, `${probe.label} must match no record in this scope`).toBe(0);
  expect(roster.rows, `${probe.label} must return no row`).toBe(0);
  expectNoOwnerValue(probe, ownerOnly, supplied);
}

/**
 * Captures, from the owner's own authorised surfaces, every value another identity must never obtain.
 *
 * The owner's surfaces are read as the owner: the partner's record route, with the identity heading it
 * states and the private note inside its own private-notes card, and the roster search that finds that
 * record by the same display name; the gifts ledger, with the identifier its row links to and the row
 * identifier its read reports; the protected video's address, taken from the Page preview's own player;
 * and two previews of the same Update — the released public edition and the approved-supporter edition —
 * whose difference is exactly the prose the protected edition adds. Reading all of them is what makes
 * every asserted value a fact this application really holds rather than a constant copied from the seed.
 */
async function captureOwnerValues(page: Page): Promise<OwnerValues> {
  const origin = await originOf(page);
  await actAs(page.context(), origin, OWNER_SESSION);

  await page.goto(`/partners/${OWNER_PARTNER_ID}`);
  // The heading is the record's own stated identity, so a page that renders a different record fails
  // here rather than letting every later assertion compare against the wrong partner.
  await expect(page.getByRole("heading", { level: 1, name: OWNER_PARTNER_NAME })).toBeVisible();
  const notesCard = page.locator('[data-slot="card"]').filter({ hasText: "What you wrote" });
  const privateNote = (await notesCard.locator("li p.whitespace-pre-line bdi").first().innerText()).trim();
  expect(privateNote.length, "the owner's private note is captured from the record's own private-notes card").toBeGreaterThan(0);

  // The owner's own roster finds the record by that display name, which is what makes the outside
  // identities' empty search below a statement about authority rather than about a broken search.
  const ownerRoster = await get(page, "the owner's roster, searched by the record's own display name", `/api/partners?search=${encodeURIComponent(OWNER_PARTNER_NAME)}`);
  expect(rosterOf(ownerRoster).total, "the owner's own roster finds the record the outside identities are denied").toBeGreaterThan(0);

  await page.goto("/support/gifts");
  const giftLink = page.getByRole("link", { name: /^Open gift /u }).first();
  await expect(giftLink).toBeVisible();
  const giftHref = await giftLink.getAttribute("href");
  const giftId = giftHref?.match(/\/support\/gifts\/([^/?#]+)/u)?.[1] ?? "";
  expect(giftId, "the gifts ledger links each row to its own record by the gift's identifier").not.toBe("");

  // The ledger's own read is the owner's, and it is where the row's identifier (as opposed to the
  // gift's) is stated: both are values the export carries and an outside identity must not receive.
  const ledger = await get(page, "the owner's gifts ledger", "/api/support/gifts");
  expect(ledger.response.status(), "the owner reads their own gifts ledger").toBe(200);
  const giftRowId = stringAt(parsed(ledger.body), ["data", "report", "rows", "0", "giftRowId"], "the owner's first gift row identifier");
  expect(stringAt(parsed(ledger.body), ["data", "report", "rows", "0", "giftId"], "the owner's first gift identifier"), "the row the ledger links to is the row its own read reports").toBe(giftId);

  await page.goto(`/pages/${OWNER_PAGE_EDITION.documentId}/${OWNER_PAGE_EDITION.locale}/preview`);
  const mediaSrc = (await page.locator("video").first().getAttribute("src"))?.trim() ?? "";
  expect(mediaSrc, "the Page preview plays the protected video from its own address").toContain("/api/media/");

  const draft = await get(page, "the owner's draft edition", `/api/drafts?view=draft&variantId=${encodeURIComponent(OWNER_DRAFT_EDITION)}`);
  expect(draft.response.status(), "the owner reads the draft edition of their own Update").toBe(200);
  const draftTitle = stringAt(parsed(draft.body), ["data", "revision", "sharePresentation", "title"], "the draft edition's share title");

  const publicEdition = await get(page, "the owner's public edition preview", `/api/pages/preview?variantId=${encodeURIComponent(PUBLIC_EDITION.variantId)}&revisionId=${encodeURIComponent(PUBLIC_EDITION.revisionId)}&requestedLocale=en`);
  const protectedEdition = await get(page, "the owner's approved-supporter edition preview", `/api/pages/preview?variantId=${encodeURIComponent(PROTECTED_EDITION.variantId)}&revisionId=${encodeURIComponent(PROTECTED_EDITION.revisionId)}&requestedLocale=en`);
  expect(protectedEdition.response.status(), "the owner previews the protected edition of their own Update").toBe(200);
  const protectedTitle = stringAt(parsed(protectedEdition.body), ["data", "revision", "sharePresentation", "title"], "the protected edition's share title");
  const publicParagraphs = paragraphsOf(stringAt(parsed(publicEdition.body), ["data", "renderedHtml"], "the public edition's rendered text"));
  const protectedParagraphs = paragraphsOf(stringAt(parsed(protectedEdition.body), ["data", "renderedHtml"], "the protected edition's rendered text"));
  const protectedParagraph = protectedParagraphs.find((paragraph) => !publicParagraphs.includes(paragraph)) ?? "";
  expect(protectedParagraph.length, "the protected edition carries prose the public edition does not, which is what makes it protected").toBeGreaterThan(0);

  return { privateNote, giftId, giftRowId, draftTitle, protectedTitle, protectedParagraph, mediaSrc };
}

/** Every value an outside identity must never receive, gathered from what the owner's own surfaces show. */
function ownerOnlyValues(values: OwnerValues): readonly string[] {
  return [values.privateNote, values.giftId, values.giftRowId, values.draftTitle, values.protectedTitle, values.protectedParagraph, values.mediaSrc, OWNER_PARTNER_ID, OWNER_PARTNER_NAME, OWNER_SUPPORT_SUBJECT, OWNER_PRINCIPAL];
}

/**
 * Every call an outside identity makes on the owner's behalf, and what the second worker is entitled
 * to from it.
 *
 * The readers and the two refused sessions are answered `denied` for every row: a reader holds no
 * ministry membership and an ended session holds no authority at all, so the same demand is refused to
 * both. The second worker holds a membership of their own, so its own reads answer their own scope —
 * which is exactly where the owner's values must be absent, and where a list that merely looked
 * filtered would show the owner's records under another heading.
 */
function outsideCalls(values: OwnerValues): readonly OutsideCall[] {
  const protectedPreview = new URLSearchParams({ variantId: PROTECTED_EDITION.variantId, revisionId: PROTECTED_EDITION.revisionId, requestedLocale: "en" });
  return [
    { label: "the owner's partner record", method: "GET", path: `/api/partners/${encodeURIComponent(OWNER_PARTNER_ID)}`, secondWorker: "refused" },
    { label: "the owner's roster, searched by the record's own display name", method: "GET", path: `/api/partners?search=${encodeURIComponent(OWNER_PARTNER_NAME)}`, searchesFor: () => OWNER_PARTNER_NAME, secondWorker: "own-scope-empty-roster" },
    { label: "the owner's roster, searched by the words of their private note", method: "GET", path: `/api/partners?search=${encodeURIComponent(values.privateNote)}`, searchesFor: (owner) => owner.privateNote, secondWorker: "own-scope-empty-roster" },
    { label: "the owner's support overview", method: "GET", path: "/api/support", secondWorker: "own-scope" },
    { label: "the owner's gifts ledger", method: "GET", path: "/api/support/gifts", secondWorker: "own-scope" },
    { label: "the owner's content list", method: "GET", path: "/api/updates", secondWorker: "own-scope" },
    { label: "the owner's publisher audience", method: "GET", path: "/api/audience", secondWorker: "own-scope" },
    { label: "the owner's draft edition", method: "GET", path: `/api/drafts?view=draft&variantId=${encodeURIComponent(OWNER_DRAFT_EDITION)}`, secondWorker: "refused" },
    { label: "the owner's protected edition preview", method: "GET", path: `/api/pages/preview?${protectedPreview.toString()}`, secondWorker: "refused" },
    { label: "the protected media asset no edition this caller is admitted to places", method: "GET", path: "/api/media/asset-image-portrait/rendition-image-portrait-display", secondWorker: "refused" },
    { label: "the owner's whole-query export", method: "POST", path: "/api/export", payload: () => ({ query: EXPORT_QUERY }), secondWorker: "own-scope" },
  ];
}

/**
 * The two receiving addresses, asked of every outside identity.
 *
 * What they answer is judged only on what they carry: the reading address of a Page edition and the
 * discovery index answer nothing to a caller holding no grant, and where such an address is not served
 * at all its refusal still carries none of the owner's values. The assertion that matters is the one
 * about content — a protected edition's paragraph, a draft's title or a private note may not reach a
 * reader through a receiving surface — and it holds against a served edition and against a refusal
 * alike, which is why no particular status is required here.
 */
const RECEIVING_ADDRESSES = [
  { label: "the public reading address of the owner's Page edition", path: `/preview/pages/${OWNER_PAGE_EDITION.documentId}/${OWNER_PAGE_EDITION.locale}` },
  { label: "the receiving discovery index", path: "/preview/pages" },
] as const;

/** Issues one outside call through the browser's own request context. */
async function issue(page: Page, call: OutsideCall): Promise<Probe> {
  return call.method === "GET" ? await get(page, call.label, call.path) : await post(page, call.label, call.path, call.payload?.() ?? {});
}

/** Asserts a rendered surface carries none of the owner's values. */
async function expectSurfaceWithoutOwnerValue(page: Page, label: string, ownerOnly: readonly string[]): Promise<void> {
  const text = await page.locator("main").innerText();
  for (const value of ownerOnly) {
    expect(text, `${label} rendered a value only the owner may see: ${JSON.stringify(value)}`).not.toContain(value);
  }
}

/** Asserts the two receiving addresses carry none of the owner's values, and are not server faults. */
async function expectReceivingAddressesSealed(page: Page, ownerOnly: readonly string[]): Promise<void> {
  for (const address of RECEIVING_ADDRESSES) {
    const probe = await get(page, address.label, address.path);
    expect(probe.response.status(), `${address.label} answered ${String(probe.response.status())}; a surface that renders its own refusal is not a server fault`).toBeLessThan(500);
    expectNoOwnerValue(probe, ownerOnly);
  }
}

/** Asserts every outside call is refused, for an identity that holds no membership at all. */
async function expectEveryCallRefused(page: Page, values: OwnerValues): Promise<void> {
  const ownerOnly = ownerOnlyValues(values);
  for (const call of outsideCalls(values)) {
    expectRefused(await issue(page, call), ownerOnly);
  }
  await expectReceivingAddressesSealed(page, ownerOnly);
}

/** Asserts a second worker's own answers are their own scope, and never carry the owner's values. */
async function expectSecondWorkerSeesOnlyTheirOwnScope(page: Page, values: OwnerValues, principalId: string): Promise<void> {
  const ownerOnly = ownerOnlyValues(values);
  for (const call of outsideCalls(values)) {
    const probe = await issue(page, call);
    switch (call.secondWorker) {
      case "refused":
        expectRefused(probe, ownerOnly);
        break;
      case "own-scope":
        expectOwnScope(probe, principalId, ownerOnly);
        break;
      case "own-scope-empty-roster":
        expectEmptyRoster(probe, ownerOnly, call.searchesFor === undefined ? [] : [call.searchesFor(values)]);
        break;
      default:
        throw new Error(`Unhandled expectation for ${call.label}: this file judges every call it makes.`);
    }
  }
  await expectReceivingAddressesSealed(page, ownerOnly);
}

test.describe("criterion 19 — context and access", () => {
  test("the owner's own surfaces are where their private note, gifts, draft, protected edition and video appear", async ({ page }) => {
    const values = await captureOwnerValues(page);
    // The label the specification requires on every screen, asserted where the capture ended: none of
    // the values just read can be mistaken for production data. The exact form is the label itself
    // rather than a mention of it in the development panel's own prose.
    await expect(page.getByText("Development data", { exact: true })).toHaveCount(1);
    const ownerOnly = ownerOnlyValues(values);
    expect(
      ownerOnly.filter((value) => value.trim().length === 0),
      "every value the outside identities are denied is a value the owner's own surfaces really hold",
    ).toEqual([]);
    expect(new Set(ownerOnly).size, "each captured value is distinct, so no assertion compares a value with itself").toBe(ownerOnly.length);
  });

  test("a second worker in another ministry retrieves none of the owner's records", async ({ page }) => {
    const values = await captureOwnerValues(page);
    const origin = await originOf(page);
    await actAs(page.context(), origin, SECOND_WORKER_SESSION);

    // The same browser, acting as a different identity: the shell states the second worker's own
    // context and offers no choice, because this session is admitted to exactly one ministry.
    await page.goto("/support/gifts");
    await expect(page.getByText("Riverbend Chapel")).toBeVisible();
    await expect(page.getByRole("button", { name: /Change context/u })).toHaveCount(0);
    await expectSurfaceWithoutOwnerValue(page, "the second worker's gifts ledger", ownerOnlyValues(values));

    // Their own roster does find their own record, so the empty results below are the owner's record
    // being absent from their scope rather than a search that matches nothing for anybody.
    const ownRecord = await get(page, "the second worker's roster searched by their own partner's name", `/api/partners?search=${encodeURIComponent("Owen Hale")}`);
    expect(rosterOf(ownRecord).total, "the second worker's roster holds their own partner").toBeGreaterThan(0);

    await expectSecondWorkerSeesOnlyTheirOwnScope(page, values, "principal-second-worker");

    // The owner's video is published to the public, and a worker in another ministry still receives no
    // byte of it: the asset belongs to a scope this session is not admitted to.
    expectRefused(await get(page, "the owner's published video", values.mediaSrc), ownerOnlyValues(values));
  });

  test("an unauthorised reader retrieves nothing and is answered with a refusal rather than an empty list", async ({ page }) => {
    const values = await captureOwnerValues(page);
    const origin = await originOf(page);
    await actAs(page.context(), origin, UNAUTHORISED_READER_SESSION);

    await page.goto("/");
    await expect(page.getByText(/could not be read for this session/u)).toBeVisible();
    await expect(page.getByText(/a refusal is not a quiet day/u)).toBeVisible();
    await expectSurfaceWithoutOwnerValue(page, "the unauthorised reader's Home", ownerOnlyValues(values));

    // A reader is signed in as its own principal and holds no ministry context: it acts on records it
    // owns, never inside a worker's context, and no context is fabricated for it.
    const session = await get(page, "the unauthorised reader's admission state", "/api/session");
    expect(session.response.status(), "the reader's own admission state is readable to it").toBe(200);
    expect(fieldAt(parsed(session.body), "data", "context"), "no ministry context is invented for a reader").toBeNull();
    expectNoOwnerValue(session, ownerOnlyValues(values));

    await expectEveryCallRefused(page, values);
  });

  for (const refused of REFUSED_SESSIONS) {
    test(`${refused.label} discloses nothing and offers the recovery that fits it`, async ({ page }) => {
      const values = await captureOwnerValues(page);
      const origin = await originOf(page);
      await actAs(page.context(), origin, refused.sessionId);

      await page.goto("/support/gifts");
      await expect(page.getByRole("heading", { name: refused.heading })).toBeVisible();
      await expect(page.getByText(refused.reason)).toBeVisible();
      await expectSurfaceWithoutOwnerValue(page, `${refused.label}'s workspace`, ownerOnlyValues(values));

      // The recovery is the guidance the admission state states, and it is what a person is offered
      // instead of a workspace that merely looked empty.
      const session = await get(page, `${refused.label}'s admission state`, "/api/session");
      expect(fieldAt(parsed(session.body), "data", "guidance"), `${refused.label} is offered its own recovery rather than an empty workspace`).toBe(refused.guidance);

      await expectEveryCallRefused(page, values);
    });
  }

  test("switching context fences the read that was in flight from the context it left", async ({ page }) => {
    const origin = await originOf(page);
    await actAs(page.context(), origin, OWNER_SESSION);

    // Every gifts read the browser issues is recorded, and exactly one of them is held open so the
    // switch happens while it is still in flight. The response is only delayed: what the service answers
    // is the read the application really runs, never a substituted one.
    const reads: string[] = [];
    let releaseInFlight: () => void = () => undefined;
    const heldOpen = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    const fence = { armed: false, held: false, settled: false };
    await page.route("**/api/support/gifts*", async (route) => {
      reads.push(route.request().url());
      if (!fence.armed) {
        await route.continue();
        return;
      }
      fence.armed = false;
      fence.held = true;
      await heldOpen;
      try {
        await route.continue();
      } catch {
        // The fence cancels the read as the switch starts, and a cancelled request cannot be continued.
        // Either way the answer never reaches the surface, which is the fact the assertions below check.
      } finally {
        fence.settled = true;
      }
    });

    await page.goto("/support/gifts");
    const youthGift = page.getByRole("link", { name: /^Open gift /u });
    await expect(page.getByRole("button", { name: /Active context: .*Youth Ministry/u })).toBeVisible();
    await expect(youthGift).toHaveCount(1);

    // A sort is the ledger's own read: changing it asks the service for the same view in a new order.
    fence.armed = true;
    await page.getByRole("button", { name: "Gift date" }).click();
    await expect.poll(() => fence.held, { message: "the ledger's read is still in flight when the context changes" }).toBe(true);

    await page.getByRole("button", { name: /Change context/u }).click();
    await page.getByRole("menuitem").filter({ hasText: "Students Ministry" }).first().click();
    const guard = page.getByRole("alertdialog", { name: "Switch context?" });
    await expect(guard).toBeVisible();
    // The guard is the one place a change of context is decided, and staying is always offered and
    // never disabled. No save is offered on this surface: the workspace never saves on the worker's
    // behalf, so the only decision it can put here is whether to discard what is on screen.
    await expect(guard.getByRole("button", { name: "Stay here" })).toBeEnabled();
    await guard.getByRole("button", { name: "Discard and switch" }).click();

    // The new context is stated by the shell, and the surface behind it is that context's own reading:
    // an unavailable finance source, stated as unavailable, rather than the previous context's rows.
    await expect(page.getByRole("button", { name: /Active context: .*Students Ministry/u })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The gifts ledger could not be read" })).toBeVisible();
    await expect(page.getByText(/not zero and not an empty result/u)).toBeVisible();
    await expect(youthGift).toHaveCount(0);

    // The delayed answer arrives after the switch and changes nothing: the fence decided the surface,
    // not the order in which two responses came back.
    releaseInFlight();
    await expect.poll(() => fence.settled, { message: "the delayed read settles after the switch" }).toBe(true);
    await expect(page.getByRole("button", { name: /Active context: .*Students Ministry/u })).toBeVisible();
    await expect(youthGift).toHaveCount(0);

    // Returning to the first context reads it again: the cache was cleared with the switch, so the
    // records come back from the service under that scope rather than from the other context's envelope.
    const readsBeforeReturn = reads.length;
    await page.getByRole("button", { name: /Change context/u }).click();
    await page.getByRole("menuitem").filter({ hasText: "Youth Ministry" }).first().click();
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Discard and switch" }).click();
    await expect(page.getByRole("button", { name: /Active context: .*Youth Ministry/u })).toBeVisible();
    await expect(youthGift).toHaveCount(1);
    await expect.poll(() => reads.length, { message: "the first context is read again rather than restored from a cached envelope" }).toBeGreaterThan(readsBeforeReturn);
  });
});
