/** Criterion 19 — context and access. */ import type { APIResponse, Page } from "@playwright/test";
import { test, expect, actAs, fieldAt, isRecord, newAttemptId, parseJson, scopeAt, stringAt } from "../playwright.config"; // The development session cookie is the whole of the identity this application authorises a request as — `src/proxy.ts` mints it and `data-service/authorize.ts` resolves it — so a spec acts as a seeded identity by naming that identity's session in the jar, which is exactly what the runner's own `seedReset` fixture does. Reading the cookie's name from the runner rather than repeating the literal is what keeps this file from silently acting as the default identity if the name ever changes.
const OWNER_SESSION = "established-worker";
const UNAUTHORISED_READER_SESSION = "reader-unauthorized"; // A seeded reader holding no grant of any kind: the persona whose refusal must disclose nothing.
const REFUSED_SESSIONS = [
  { sessionId: "session-denied", label: "a denied session", heading: /You don’t have access to this workspace/u, reason: /Reason:\s*not-admitted/u, guidance: "request-access" },
  { sessionId: "session-expired", label: "an expired session", heading: /Your session has expired/u, reason: /Reason:\s*session-expired/u, guidance: "sign-in-again" },
] as const;
const OWNER_PARTNER_ID = "partner-jo-mbeki";
const OWNER_PARTNER_NAME = "Jo Mbeki";
const OWNER_DRAFT_EDITION = "variant-update-autumn-ar-public";
const PUBLIC_EDITION = { variantId: "variant-update-autumn-en-public", revisionId: "rev-update-en-1" } as const;
const PROTECTED_EDITION = { variantId: "variant-update-autumn-en-approved-supporter", revisionId: "rev-update-en-supporter-1" } as const; // The approved-supporter edition: the protected content an unadmitted caller must never receive.
const OWNER_PAGE_EDITION = { documentId: "doc-page-harbour-youth", locale: "en" } as const;
const OWNER_SUPPORT_SUBJECT = "sup-harbour-youth"; // The owner's finance subject: a second worker's own reads must never report it.
const OWNER_PRINCIPAL = "principal-established-worker";
const EXPORT_QUERY = { reportId: "received-period-and-year-to-date" } as const;
type Probe = { /** The job the call performs, in words a failure message can use. */ readonly label: string; readonly response: APIResponse; readonly body: string }; // One response this file judges: what asked for it, what came back, and the body as text.
/** The values only the owner is entitled to, captured from the owner's own surfaces. */ interface OwnerValues {
  readonly privateNote: string; // The body of the owner's private note, read from the record's own private-notes card.
  readonly giftId: string; // The gift identifier the ledger's row links to, read from that row's own address.
  readonly giftRowId: string; // The gift row's identifier, as the owner's ledger read reports it.
  readonly draftTitle: string; // The share title of the owner's unreleased draft edition.
  readonly protectedTitle: string; // The share title of the approved-supporter edition.
  readonly protectedParagraph: string; // The one paragraph the approved-supporter edition carries and its public sibling does not.
  readonly mediaSrc: string; // The address the owner's own preview player asks the edition's placed video from.
}
interface OutsideCall {
  readonly label: string; // The job the call performs, in words a failure message can use.
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly payload?: () => unknown; // The body a POST sends, built at call time so a captured identifier can be named in it.
  readonly searchesFor?: (values: OwnerValues) => string; // The text this call searches its roster for, where it is a search: the read states what it applied,
  readonly secondWorker: "refused" | "own-scope" | "own-scope-empty-roster"; // What the second worker receives.
}
/** The `<p>`-level lines of a rendered edition, with tags removed and whitespace collapsed. */ const paragraphsOf = (renderedHtml: string): readonly string[] =>
  renderedHtml
    .split(/<\/(?:p|h1|h2|h3|h4|li)>/u)
    .map((chunk) =>
      chunk
        .replace(/<[^>]*>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
/** Makes one GET and states the answer with its body as text, labelled with the job the call performs. */ async function get(page: Page, label: string, path: string): Promise<Probe> {
  const response = await page.request.get(path); // One GET through the browser's own request context, so it carries the cookie jar this test set.
  return { label, response, body: await response.text() };
}
async function post(page: Page, label: string, path: string, body: unknown): Promise<Probe> {
  const response = await page.request.post(path, { data: body });
  return { label, response, body: await response.text() };
}
/** Asserts a response carries none of the values only the owner may see, apart from what the caller itself supplied. */ function expectNoOwnerValue(probe: Probe, ownerOnly: readonly string[], supplied: readonly string[] = []): void {
  for (const value of ownerOnly) {
    if (supplied.includes(value)) continue; // A caller's own search term comes back in the read's own statement of what it applied. That echo is the request's text returning to the request, not a record disclosing itself, so a value this caller supplied is judged by the rows the read answers with instead.
    expect(probe.body, `${probe.label} answered with a value only the owner may see: ${JSON.stringify(value)}`).not.toContain(value);
  }
}
function expectRefused(probe: Probe, ownerOnly: readonly string[]): void {
  expect([401, 403], `${probe.label} must refuse this identity, and answered ${String(probe.response.status())}`).toContain(probe.response.status()); // Asserts one call was refused, and that the refusal discloses nothing about what it refused.
  const body = parseJson(probe.body);
  expect(fieldAt(body, "outcome"), `${probe.label} must answer the closed denied outcome`).toBe("denied");
  expect(Object.keys(isRecord(body) ? body : {}).sort(), `${probe.label} answered a refusal, so its body carries the refusal and nothing about the record: no count, title, size or existence flag`).toEqual(["operationId", "outcome", "reasonCode"]);
  expectNoOwnerValue(probe, ownerOnly);
}
function expectOwnScope(probe: Probe, principalId: string, ownerOnly: readonly string[]): void {
  expect(probe.response.status(), `${probe.label} answers this caller's own scope`).toBe(200); // Asserts one call was answered from the caller's own scope, and that its answer holds none of the
  const body = parseJson(probe.body);
  expect(stringAt(body, ["scope", "principalId"], `${probe.label} scope principal`), `${probe.label} must be read as the calling principal`).toBe(principalId);
  expect(stringAt(body, ["scope", "supportSubjectId"], `${probe.label} scope subject`), `${probe.label} must not report the owner's finance subject`).not.toBe(OWNER_SUPPORT_SUBJECT);
  expectNoOwnerValue(probe, ownerOnly);
}
function rosterOf(probe: Probe): { readonly total: number; readonly rows: number } {
  const body = parseJson(probe.body);
  const total = fieldAt(body, "data", "total");
  const rows = fieldAt(body, "data", "rows");
  if (typeof total !== "number" || !Array.isArray(rows)) throw new Error(`${probe.label} did not answer a roster: expected data.total and data.rows, and its body begins ${JSON.stringify(probe.body.slice(0, 200))}.`);
  return { total, rows: rows.length };
}
function expectEmptyRoster(probe: Probe, ownerOnly: readonly string[], supplied: readonly string[] = []): void {
  expect(probe.response.status(), `${probe.label} answers this caller's own roster`).toBe(200); // Asserts a roster search answered no record at all — no row and a whole-result total of zero.
  const roster = rosterOf(probe);
  expect(roster.total, `${probe.label} must match no record in this scope`).toBe(0);
  expect(roster.rows, `${probe.label} must return no row`).toBe(0);
  expectNoOwnerValue(probe, ownerOnly, supplied);
}
async function captureOwnerValues(page: Page): Promise<OwnerValues> {
  await actAs(page, OWNER_SESSION); // Captures, from the owner's own authorised surfaces, every value another identity must never obtain.
  await page.goto(`/partners/${OWNER_PARTNER_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: OWNER_PARTNER_NAME })).toBeVisible(); // The heading is the record's own stated identity, so a page that renders a different record fails here rather than letting every later assertion compare against the wrong partner.
  const privateNote = (await page.locator('[data-slot="card"]').filter({ hasText: "Your private notes" }).locator("li p.whitespace-pre-line bdi").first().innerText()).trim();
  expect(privateNote.length, "the owner's private note is captured from the record's own private-notes card").toBeGreaterThan(0);
  const ownerRoster = await get(page, "the owner's roster, searched by the record's own display name", `/api/partners?search=${encodeURIComponent(OWNER_PARTNER_NAME)}`); // The owner's own roster finds the record by that display name, which is what makes the outside identities' empty search below a statement about authority rather than about a broken search.
  expect(rosterOf(ownerRoster).total, "the owner's own roster finds the record the outside identities are denied").toBeGreaterThan(0);
  await page.goto("/support/gifts");
  const giftLink = page.getByRole("link", { name: /^Open gift /u }).first();
  await expect(giftLink).toBeVisible();
  const giftId = (await giftLink.getAttribute("href"))?.match(/\/support\/gifts\/([^/?#]+)/u)?.[1] ?? "";
  expect(giftId, "the gifts ledger links each row to its own record by the gift's identifier").not.toBe("");
  const ledger = await get(page, "the owner's gifts ledger", "/api/support/gifts"); // The ledger's own read is the owner's, and it is where the row's identifier (as opposed to the gift's) is stated: both are values the export carries and an outside identity must not receive.
  expect(ledger.response.status(), "the owner reads their own gifts ledger").toBe(200);
  const giftRowId = stringAt(parseJson(ledger.body), ["data", "report", "rows", "0", "giftRowId"], "the owner's first gift row identifier");
  expect(stringAt(parseJson(ledger.body), ["data", "report", "rows", "0", "giftId"], "the owner's first gift identifier"), "the row the ledger links to is the row its own read reports").toBe(giftId);
  await page.goto(`/pages/${OWNER_PAGE_EDITION.documentId}/${OWNER_PAGE_EDITION.locale}/preview`);
  const mediaSrc = (await page.locator("video").first().getAttribute("src"))?.trim() ?? "";
  expect(mediaSrc, "the Page preview plays the video the edition places from its own address").toContain("/api/media/");
  const draft = await get(page, "the owner's draft edition", `/api/drafts?view=draft&variantId=${encodeURIComponent(OWNER_DRAFT_EDITION)}`);
  expect(draft.response.status(), "the owner reads the draft edition of their own Update").toBe(200);
  const draftTitle = stringAt(parseJson(draft.body), ["data", "revision", "sharePresentation", "title"], "the draft edition's share title");
  const publicEdition = await get(page, "the owner's public edition preview", `/api/pages/preview?variantId=${encodeURIComponent(PUBLIC_EDITION.variantId)}&revisionId=${encodeURIComponent(PUBLIC_EDITION.revisionId)}&requestedLocale=en`);
  const protectedEdition = await get(page, "the owner's approved-supporter edition preview", `/api/pages/preview?variantId=${encodeURIComponent(PROTECTED_EDITION.variantId)}&revisionId=${encodeURIComponent(PROTECTED_EDITION.revisionId)}&requestedLocale=en`);
  expect(protectedEdition.response.status(), "the owner previews the protected edition of their own Update").toBe(200);
  const protectedTitle = stringAt(parseJson(protectedEdition.body), ["data", "revision", "sharePresentation", "title"], "the protected edition's share title");
  const publicParagraphs = paragraphsOf(stringAt(parseJson(publicEdition.body), ["data", "renderedHtml"], "the public edition's rendered text"));
  const protectedParagraph = paragraphsOf(stringAt(parseJson(protectedEdition.body), ["data", "renderedHtml"], "the protected edition's rendered text")).find((paragraph) => !publicParagraphs.includes(paragraph)) ?? "";
  expect(protectedParagraph.length, "the protected edition carries prose the public edition does not, which is what makes it protected").toBeGreaterThan(0);
  return { privateNote, giftId, giftRowId, draftTitle, protectedTitle, protectedParagraph, mediaSrc };
}
const ownerOnlyValues = (values: OwnerValues): readonly string[] => [values.privateNote, values.giftId, values.giftRowId, values.draftTitle, values.protectedTitle, values.protectedParagraph, OWNER_PARTNER_ID, OWNER_PARTNER_NAME, OWNER_SUPPORT_SUBJECT, OWNER_PRINCIPAL]; // Every value an outside identity must never receive, gathered from what the owner's own surfaces show.
function outsideCalls(values: OwnerValues): readonly OutsideCall[] {
  const protectedPreview = new URLSearchParams({ variantId: PROTECTED_EDITION.variantId, revisionId: PROTECTED_EDITION.revisionId, requestedLocale: "en" }); // Every call an outside identity makes on the owner's behalf, and what the second worker is entitled
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
const RECEIVING_ADDRESSES = [
  { label: "the public reading address of the owner's Page edition", path: `/preview/pages/${OWNER_PAGE_EDITION.documentId}/${OWNER_PAGE_EDITION.locale}` },
  { label: "the receiving discovery index", path: "/preview/pages" },
] as const;
const READING_SCOPE_IDENTIFIER = OWNER_SUPPORT_SUBJECT;
const issue = async (page: Page, call: OutsideCall): Promise<Probe> => (call.method === "GET" ? await get(page, call.label, call.path) : await post(page, call.label, call.path, call.payload?.() ?? {}));
async function expectSurfaceWithoutOwnerValue(page: Page, label: string, ownerOnly: readonly string[]): Promise<void> {
  const text = await page.locator("main").innerText();
  for (const value of ownerOnly) expect(text, `${label} rendered a value only the owner may see: ${JSON.stringify(value)}`).not.toContain(value);
}
/** Asserts the two receiving addresses carry none of the owner's values, and are not server faults. */ async function expectReceivingAddressesSealed(page: Page, ownerOnly: readonly string[]): Promise<void> {
  const judged = ownerOnly.filter((value) => value !== READING_SCOPE_IDENTIFIER); // The scope a served edition states is the authority its own read ran under, not a record of the owner's.
  for (const address of RECEIVING_ADDRESSES) {
    const probe = await get(page, address.label, address.path);
    expect(probe.response.status(), `${address.label} answered ${String(probe.response.status())}; a surface that renders its own refusal is not a server fault`).toBeLessThan(500);
    expectNoOwnerValue(probe, judged);
  }
}
async function expectEveryCallRefused(page: Page, values: OwnerValues): Promise<void> {
  const ownerOnly = ownerOnlyValues(values); // Asserts every outside call is refused, for an identity that holds no membership at all.
  for (const call of outsideCalls(values)) expectRefused(await issue(page, call), ownerOnly);
  await expectReceivingAddressesSealed(page, ownerOnly);
}
async function expectSecondWorkerSeesOnlyTheirOwnScope(page: Page, values: OwnerValues, principalId: string): Promise<void> {
  const ownerOnly = ownerOnlyValues(values); // Asserts a second worker's own answers are their own scope, and never carry the owner's values.
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
    await expect(page.getByText("Development data", { exact: true })).toHaveCount(1); // The label the specification requires on every screen, asserted where the capture ended: none of the values just read can be mistaken for production data. The exact form is the label itself rather than a mention of it in the development panel's own prose.
    const ownerOnly = ownerOnlyValues(values);
    const blankValues = ownerOnly.filter((value) => value.trim().length === 0);
    expect(blankValues, "every value the outside identities are denied is a value the owner's own surfaces really hold").toEqual([]);
    expect(new Set(ownerOnly).size, "each captured value is distinct, so no assertion compares a value with itself").toBe(ownerOnly.length);
  });
  test("a second worker in another ministry retrieves none of the owner's records", async ({ page }) => {
    const values = await captureOwnerValues(page);
    await actAs(page, "second-worker");
    await page.goto("/support/gifts"); // The same browser, acting as a different identity: the shell states the second worker's own context and offers no choice, because this session is admitted to exactly one ministry.
    await expect(page.getByText("Riverbend Chapel")).toBeVisible();
    await expect(page.getByRole("button", { name: /Switch ministry/u })).toHaveCount(0);
    await expectSurfaceWithoutOwnerValue(page, "the second worker's gifts ledger", ownerOnlyValues(values));
    const ownRecord = await get(page, "the second worker's roster searched by their own partner's name", `/api/partners?search=${encodeURIComponent("Owen Hale")}`); // Their own roster does find their own record, so the empty results below are the owner's record being absent from their scope rather than a search that matches nothing for anybody.
    expect(rosterOf(ownRecord).total, "the second worker's roster holds their own partner").toBeGreaterThan(0);
    await expectSecondWorkerSeesOnlyTheirOwnScope(page, values, "principal-second-worker");
    expectRefused(await get(page, "the owner's published video", values.mediaSrc), ownerOnlyValues(values)); // The owner's video is published to the public, and a worker in another ministry still receives no byte of it: the asset belongs to a scope this session is not admitted to.
  });
  test("an unauthorised reader retrieves nothing and is answered with a refusal rather than an empty list", async ({ page }) => {
    const values = await captureOwnerValues(page);
    await actAs(page, UNAUTHORISED_READER_SESSION);
    await page.goto("/");
    await expect(page.getByText(/doesn’t have access to Home/u)).toBeVisible();
    await expect(page.getByText(/same whether or not a record exists/u)).toBeVisible();
    await expectSurfaceWithoutOwnerValue(page, "the unauthorised reader's Home", ownerOnlyValues(values));
    const session = await get(page, "the unauthorised reader's admission state", "/api/session"); // A reader is signed in as its own principal and holds no ministry context: it acts on records it owns, never inside a worker's context, and no context is fabricated for it.
    expect(session.response.status(), "the reader's own admission state is readable to it").toBe(200);
    expect(fieldAt(parseJson(session.body), "data", "context"), "no ministry context is invented for a reader").toBeNull();
    expectNoOwnerValue(
      session,
      ownerOnlyValues(values).filter((value) => value !== READING_SCOPE_IDENTIFIER), // The scope the admission statement carries is the authority its own read ran under, not a record of the owner's: the same session's preferences read states that same scope.
    );
    await expectEveryCallRefused(page, values);
  });
  for (const refused of REFUSED_SESSIONS) {
    test(`${refused.label} discloses nothing and offers the recovery that fits it`, async ({ page }) => {
      const values = await captureOwnerValues(page);
      await actAs(page, refused.sessionId);
      await page.goto("/support/gifts");
      await expect(page.getByRole("heading", { name: refused.heading })).toBeVisible();
      await expect(page.getByText(refused.reason)).toBeVisible();
      await expectSurfaceWithoutOwnerValue(page, `${refused.label}'s workspace`, ownerOnlyValues(values));
      const session = await get(page, `${refused.label}'s admission state`, "/api/session");
      expect(fieldAt(parseJson(session.body), "data", "guidance"), `${refused.label} is offered its own recovery rather than an empty workspace`).toBe(refused.guidance);
      await expectEveryCallRefused(page, values);
    });
  }
  test("switching context fences the read that was in flight from the context it left", async ({ page }) => {
    await actAs(page, OWNER_SESSION);
    const reads: string[] = []; // Every gifts read the browser issues is recorded, and exactly one of them is held open so the switch happens while it is still in flight. The response is only delayed: what the service answers is the read the application really runs, never a substituted one.
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
        // The fence cancels the read as the switch starts, and a cancelled request cannot be continued. Either way the answer never reaches the surface, which is the fact the assertions below check.
      } finally {
        fence.settled = true;
      }
    });
    await page.goto("/support/gifts");
    const youthGift = page.getByRole("link", { name: /^Open gift /u });
    await expect(page.getByRole("button", { name: /Active ministry: .*Youth Ministry/u })).toBeVisible();
    await expect(youthGift).toHaveCount(1);
    fence.armed = true;
    await page.getByRole("button", { name: "Date given" }).click();
    await expect.poll(() => fence.held, { message: "the ledger's read is still in flight when the context changes" }).toBe(true);
    await page.getByRole("button", { name: /Switch ministry/u }).click();
    await page.getByRole("menuitem").filter({ hasText: "Students Ministry" }).first().click();
    const guard = page.getByRole("alertdialog", { name: "Switch ministry?" });
    await expect(guard).toBeVisible();
    await expect(guard.getByRole("button", { name: "Stay here" })).toBeEnabled(); // The guard is the one place a change of context is decided, and staying is always offered and never disabled. The gifts ledger holds no unsaved work of its own, so this guard offers Stay and Discard alone: a save is offered only for work the surface behind the dialog reports as unsaved, which the edit surface's own case below exercises.
    await guard.getByRole("button", { name: "Discard and switch" }).click();
    await expect(page.getByRole("button", { name: /Active ministry: .*Students Ministry/u })).toBeVisible(); // The new context is stated by the shell, and the surface behind it is that context's own reading: an unavailable finance source, stated as unavailable, rather than the previous context's rows.
    await expect(page.getByRole("heading", { name: "Couldn’t load Gifts" })).toBeVisible();
    await expect(page.getByText(/nothing is replaced with zero or an empty list/u)).toBeVisible();
    await expect(youthGift).toHaveCount(0);
    releaseInFlight(); // The delayed answer arrives after the switch and changes nothing: the fence decided the surface, not the order in which two responses came back.
    await expect.poll(() => fence.settled, { message: "the delayed read settles after the switch" }).toBe(true);
    await expect(page.getByRole("button", { name: /Active ministry: .*Students Ministry/u })).toBeVisible();
    await expect(youthGift).toHaveCount(0);
    const readsBeforeReturn = reads.length; // Returning to the first context reads it again: the cache was cleared with the switch, so the records come back from the service under that scope rather than from the other context's envelope.
    await page.getByRole("button", { name: /Switch ministry/u }).click();
    await page.getByRole("menuitem").filter({ hasText: "Youth Ministry" }).first().click();
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Discard and switch" }).click();
    await expect(page.getByRole("button", { name: /Active ministry: .*Youth Ministry/u })).toBeVisible();
    await expect(youthGift).toHaveCount(1);
    await expect.poll(() => reads.length, { message: "the first context is read again rather than restored from a cached envelope" }).toBeGreaterThan(readsBeforeReturn);
  });
  test("the guard offers to save an unsaved edit or discard it, and discarding clears what was typed", async ({ page }) => {
    await actAs(page, OWNER_SESSION);
    await page.goto(`/partners/${OWNER_PARTNER_ID}/edit`);
    const displayName = page.getByLabel("Display name"); // The one control the record's own edit surface offers for its display name, which is the value this case edits.
    await expect(displayName).toHaveValue(OWNER_PARTNER_NAME); // The form opens on the value the record holds, so the suffix typed below is the whole of the difference the guard is asked about.
    const typedSuffix = " (draft)";
    await displayName.fill(`${OWNER_PARTNER_NAME}${typedSuffix}`);
    await page.getByRole("button", { name: /Switch ministry/u }).click(); // A context change requested from the header, while the edit above is unsaved: the decision the guard must put to the worker.
    await page.getByRole("menuitem").filter({ hasText: "Students Ministry" }).first().click();
    const guard = page.getByRole("alertdialog", { name: "Switch ministry?" });
    await expect(guard).toBeVisible();
    await expect(guard.getByText(/You have unsaved edits on this partner profile/u)).toBeVisible(); // The guard names the work it is asking about in the owning surface's words, so the worker is not deciding about a general warning.
    await expect(guard.getByRole("button", { name: "Save and switch" })).toBeEnabled(); // Saving is offered because the edit surface reported the unsaved edit, and it is the surface's own save that runs rather than one this workspace invents.
    await expect(guard.getByRole("button", { name: "Discard and switch" })).toBeEnabled(); // Discarding is offered beside it, so the choice is the worker's rather than a default applied for them.
    await expect(guard.getByRole("button", { name: "Stay here" })).toBeEnabled(); // Staying is always offered, so the three answers the specification names are all on the dialog at once.
    await guard.getByRole("button", { name: "Discard and switch" }).click();
    await expect(page.getByRole("button", { name: /Active ministry: .*Students Ministry/u })).toBeVisible(); // The switch itself completes and the shell states the context now in force.
    await expect(displayName).toHaveValue(OWNER_PARTNER_NAME); // Discarding is the worker's answer that nothing from the old context is carried over: the typed suffix is gone and the field reads the record's own value again.
  });
  test("a state-changing request another site caused is refused before it reaches the store", async ({ page }) => {
    await actAs(page, OWNER_SESSION);
    await page.goto("/partners"); // Loads the application from its own origin, so the admitted attempt below states the origin this browser really uses rather than one this file assumed.
    const ownOrigin = new URL(page.url()).origin;
    const listPath = "/api/tasks?read=listTasks&list=all&displayTimeZone=UTC&page=1&pageSize=50&sort=dueOn%3Aasc";
    const before = parseJson((await get(page, "the owner's task list before either attempt", listPath)).body);
    const scope = scopeAt(before, "The owner's task list");
    const revision = stringAt(before, ["revision"], "The owner's task list's revision"); // The revision both attempts below present: the first is refused before it can move it, so the second still presents the revision the owner saw.
    const attempt = (title: string) => ({ operationId: newAttemptId(), scope, expectedRevision: revision, payload: { operation: "createTask", title } });
    const crossSite = await page.request.post("/api/tasks", { headers: { origin: "https://another-site.example", "sec-fetch-site": "cross-site" }, data: attempt("QA-CSRF-CROSS-SITE") }); // One page from another origin posting a JSON body: the shape a third-party site uses to change this application's state without a preflight.
    expect(crossSite.status(), "a state-changing request another site caused is refused").toBe(403);
    const refusal = parseJson(await crossSite.text());
    expect(fieldAt(refusal, "outcome"), "the refusal is one of the closed outcomes rather than a bare status").toBe("denied");
    expect(fieldAt(refusal, "reasonCode"), "the refusal states a reason that reveals nothing about a record it never read").toBe("no-permission");
    const afterRefusal = await get(page, "the owner's task list after the cross-site attempt", listPath);
    expect(afterRefusal.body, "the refused attempt created nothing").not.toContain("QA-CSRF-CROSS-SITE");
    const sameOrigin = await page.request.post("/api/tasks", { headers: { origin: ownOrigin, "sec-fetch-site": "same-origin" }, data: attempt("QA-CSRF-SAME-ORIGIN") }); // The same body from the application's own origin, so the refusal above is this request's origin rather than the attempt's shape.
    expect(sameOrigin.status(), "the application's own request is still applied").toBe(200);
    expect(fieldAt(parseJson(await sameOrigin.text()), "outcome"), "the admitted attempt is accepted").toBe("accepted");
    const afterAdmitted = await get(page, "the owner's task list after the admitted attempt", listPath);
    expect(afterAdmitted.body, "the admitted attempt is the one that reached the store").toContain("QA-CSRF-SAME-ORIGIN");
  });
});
