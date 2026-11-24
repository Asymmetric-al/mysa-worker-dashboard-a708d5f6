/** Criterion 21 — reachability and commands: every destination the application serves is one a person can reach by operating the shell. */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { RESET_URL, SEEDED_PERSONAS, SESSION_COOKIE, describeInventoryDifference, expect, matchesTemplate, pageRoutesUnder, pathnameOf, templateOf, test, type PersonaName } from "../playwright.config";
const ENTRY_PATH = "/"; // Where every crawl starts, and where each identity hop begins: the entry route, never a destination.
const ORIGIN = new URL(RESET_URL).origin; // The origin the session cookie is set on, taken from the runner's own control address rather than restated.
const MAIN_LANDMARK = "#main-content";
const APPLICATION_DIRECTORY = join(import.meta.dirname, "..");
const REPOSITORY_DIRECTORY = join(APPLICATION_DIRECTORY, "..", "..");
const ALIAS_PATH = "/feed"; // The legacy alias, named once so the exception list, its probe and the sweep cannot disagree about which address it is.
const ROUTE_EXCEPTIONS: readonly string[] = [ALIAS_PATH]; // The single declared exception to the inventory: the legacy alias, which resolves rather than renders.
const EXPECTED_ROUTES: readonly string[] = [
  "/",
  "/feed",
  "/settings",
  "/help",
  "/partners",
  "/partners/[partnerId]",
  "/partners/[partnerId]/edit",
  "/partners/[partnerId]/interactions/new",
  "/partners/import",
  "/partners/initiatives",
  "/partners/initiatives/[initiativeId]",
  "/partners/referrals",
  "/partners/referrals/[referralId]",
  "/work",
  "/work/agenda",
  "/work/series/[seriesId]",
  "/support",
  "/support/gifts",
  "/support/gifts/[giftId]",
  "/support/commitments",
  "/support/commitments/[commitmentId]",
  "/support/reports/[reportId]",
  "/communication",
  "/communication/[updateId]",
  "/communication/[updateId]/[variantId]",
  "/communication/[updateId]/[variantId]/preview",
  "/communication/review/[candidateId]",
  "/communication/audience",
  "/communication/delivery",
  "/communication/inbox",
  "/pages",
  "/pages/[pageId]",
  "/pages/[pageId]/[locale]/preview",
  "/pages/review/[candidateId]",
  "/coaching", // Coaching — the worker's preparation, its three shared surfaces, and the coach's read-only view of one subject.
  "/coaching/targets",
  "/coaching/check-ins",
  "/coaching/sharing",
  "/coaching/coach",
  "/coaching/coach/[subjectId]",
  "/preview",
  "/preview/[updateId]",
  "/preview/pages",
  "/preview/pages/[pageId]/[locale]",
  "/preview/preferences",
];
const DOCUMENTED_ROOT_SCRIPTS: readonly string[] = ["dev", "build", "typecheck", "lint", "test", "reset", "seed:workload", "fixtures:media", "lines"];
const DOCUMENTED_APPLICATION_SCRIPTS: readonly string[] = ["dev", "build", "typecheck", "lint", "test"];
/** The provider variables this release must start without, named exactly. */
const ABSENT_PROVIDER_VARIABLES: readonly string[] = [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "PAYLOAD_SECRET",
  "PAYLOAD_DATABASE_URI",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "POSTGRES_URL",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "SENDGRID_API_KEY",
  "POSTMARK_SERVER_TOKEN",
  "SMTP_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];
const COMMAND_TIMEOUT_MS = 300_000;
type Visit = { readonly path: string; readonly url: string; readonly via: string; readonly from: string };
type SweepReport = { readonly visits: readonly Visit[]; readonly ignored: readonly string[] }; // What one sweep found: the destinations it reached, and every link it did not follow because it addresses no page.
const NO_PAGE = "(nothing above it)"; // What the entry route has above it, stated rather than left blank.
const DESTINATION_TIMEOUT_MS = 30_000;
const SECTION_TOGGLE_LIMIT = 32;
const PAGE_SUBMIT_LABEL = "Submit for review";
const HYDRATED_WORKSPACE = '[data-slot="dev-controls"]:not([data-state="loading"])'; // The development panel in the state it reaches only after the browser has run the application's own code.
const anchorSelector = (href: string): string => `a[href="${href.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`;
async function expandCollapsedSections(page: Page): Promise<void> {
  for (let expanded = 0; expanded < SECTION_TOGGLE_LIMIT; expanded += 1) {
    const toggle = page
      .getByRole("button", { name: /^Expand /u })
      .filter({ visible: true })
      .first();
    if ((await toggle.count()) === 0) return;
    await toggle.click();
  }
  throw new Error(`The rail still offered a collapsed section after ${String(SECTION_TOGGLE_LIMIT)} expansions on ${pathnameOf(page.url())}, so this sweep cannot tell a reachable destination from one hidden behind a toggle.`);
}
async function navigationTargetsOn(page: Page): Promise<readonly string[]> {
  await expandCollapsedSections(page); // Every internal address the page currently offers, once each and in a stable order.
  let settled: readonly string[] = [];
  let previous: string | undefined;
  let agreements = 0;
  await expect
    .poll(
      async () => {
        const sample = (await internalAddressesOn(page)).join("\n");
        agreements = sample === previous ? agreements + 1 : 0;
        previous = sample;
        settled = sample === "" ? [] : sample.split("\n");
        return agreements >= 3 - 1;
      },
      { message: `The links ${pathnameOf(page.url())} offers never stopped changing, so this sweep cannot tell which destinations the page really leads to.`, timeout: DESTINATION_TIMEOUT_MS, intervals: [400, 400] },
    )
    .toBe(true);
  return settled;
}
/** One reading of the page's visible internal addresses, de-duplicated and in a stable order. */
async function internalAddressesOn(page: Page): Promise<readonly string[]> {
  const hrefs = await page
    .locator("a[href]")
    .filter({ visible: true })
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
  // Only same-origin addresses can be a destination of this application: a protocol-relative address belongs to another site, and the framework's own asset prefix is not a page. Everything else is kept and matched against the inventory, so an address the application serves but the inventory omits
  // is reported rather than dropped.
  const internal = hrefs.filter((href) => href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/_next/"));
  return [...new Set(internal)].sort((left, right) => left.localeCompare(right));
}
async function followAnchor(page: Page, href: string): Promise<void> {
  const from = pathnameOf(page.url());
  const target = pathnameOf(href);
  let link = page.locator(anchorSelector(href)).filter({ visible: true }).first();
  if ((await link.count()) === 0) {
    await expandCollapsedSections(page);
    link = page.locator(anchorSelector(href)).filter({ visible: true }).first();
  }
  await expect(link, `${from} offered ${href} a moment ago, and no visible anchor carries it now, so this sweep cannot follow it.`).toHaveCount(1);
  await link.click();
  await expect.poll(() => pathnameOf(page.url()), { message: `Following ${href} from ${from} did not land on ${target}.`, timeout: DESTINATION_TIMEOUT_MS }).toBe(target);
  await expect(page.locator(MAIN_LANDMARK), `The destination ${target} rendered no main landmark, so it stated no page.`).toBeVisible();
}
async function returnTo(page: Page, path: string): Promise<void> {
  await page.goBack(); // Returns to the page a link was followed from, and asserts the return before the next link is touched.
  await expect.poll(() => pathnameOf(page.url()), { message: `Stepping back from ${pathnameOf(page.url())} did not return to ${path}.`, timeout: DESTINATION_TIMEOUT_MS }).toBe(path);
  await expect(page.locator(MAIN_LANDMARK)).toBeVisible();
  await expandCollapsedSections(page);
}
async function openShellDestination(page: Page, label: string): Promise<void> {
  await expandCollapsedSections(page); // Operates one of the rail's own entries or sub-entries by the words it is named with.
  const link = page.getByRole("link", { name: label, exact: true }).filter({ visible: true }).first();
  await expect(link, `The shell offers no visible navigation entry named ${JSON.stringify(label)} on ${pathnameOf(page.url())}.`).toHaveCount(1);
  await link.click();
  await expect(page.locator(MAIN_LANDMARK)).toBeVisible();
}
async function awaitInteractiveWorkspace(page: Page, subject: string): Promise<void> {
  await expect(page.getByText("Development data", { exact: true }).first(), `${subject} did not state the persistent Development data label, so this sweep would not know the screen was synthetic data.`).toBeVisible();
  await expect(page.locator(HYDRATED_WORKSPACE).first(), `${subject} never became interactive: the development panel stayed in its server-rendered loading state, so a control would swallow the click that follows.`).toBeVisible();
}
const RECEIVED_EDITION_LINK = /^\/preview\/(?!pages(?:\/|$)|preferences$)[^/?#]+(?:[?#]|$)/u; // The received-edition address a reader's list offers: one Update's post, and never the discovery index or the preferences.
async function sweepTheShell(page: Page, templates: readonly string[]): Promise<SweepReport> {
  const visits = new Map<string, Visit>(); // Sweeps the application from `/` by operating nothing but the shell, then reaches the three surfaces that
  const ignored = new Set<string>();
  function record(via: string, from: string): Visit {
    const path = pathnameOf(page.url()); // Records the destination the browser is on now, once per path, and answers the record either way.
    const known = visits.get(path);
    if (known !== undefined) return known;
    const visit: Visit = { path, url: page.url(), via, from };
    visits.set(path, visit);
    return visit;
  }
  async function followOnly(selector: string, subject: string, via: string, from: string): Promise<void> {
    const link = page.locator(selector).filter({ visible: true }).first(); // Follows the one link a surface offers towards the destination it names, refusing a surface that offers none, and records the destination it reached.
    await expect(link, subject).toHaveCount(1);
    const href = await link.getAttribute("href");
    if (href === null) throw new Error(`${subject} carried no href, so this sweep cannot follow it.`);
    await followAnchor(page, href);
    record(via, from);
  }
  function isNewDestination(path: string): boolean {
    if (visits.has(path)) return false; // Whether a destination is worth following: a page the inventory names, which nothing has visited yet.
    if (templateOf(path, templates) === undefined) {
      ignored.add(path);
      return false;
    }
    return true;
  }
  /** Follows every link this page offers that leads somewhere new, stepping back to this page between each. */
  async function explore(from: string): Promise<void> {
    for (const href of await navigationTargetsOn(page)) {
      if (!isNewDestination(pathnameOf(href))) continue;
      await followAnchor(page, href);
      const visit = record(href, from);
      await explore(visit.path);
      await returnTo(page, from);
    }
  }
  async function actAs(persona: PersonaName): Promise<void> {
    await page.context().addCookies([{ name: SESSION_COOKIE, value: SEEDED_PERSONAS[persona].sessionId, url: ORIGIN }]); // Opens the entry route as one of the seeded identities, which is the whole of how identity is switched here.
    await page.goto(ENTRY_PATH);
    await awaitInteractiveWorkspace(page, `The ${SEEDED_PERSONAS[persona].label} session's entry route`);
  }
  async function visitPageReview(): Promise<void> {
    await openShellDestination(page, "Pages"); // The Page review step, which exists only once a candidate does.
    await expect(page).toHaveURL(/\/pages$/u, { timeout: DESTINATION_TIMEOUT_MS });
    await followOnly('a[href^="/pages/"]:not([href^="/pages/review/"])', "The Pages index offers no Page to open, so the review step below it cannot be reached.", "A Page row on the index", "/pages");
    const submit = page.getByRole("button", { name: PAGE_SUBMIT_LABEL }).filter({ visible: true }).first();
    await expect(submit, "The seeded Page's composed edition holds a draft, so the builder offers the one review step this release has.").toHaveCount(1);
    await submit.click();
    const step = page
      .locator('[data-slot="action-review"]')
      .filter({ has: page.getByRole("heading", { name: PAGE_SUBMIT_LABEL }) })
      .first();
    await expect(step, "The builder offered no review step for the draft it composes.").toBeVisible();
    await step.getByRole("button", { name: PAGE_SUBMIT_LABEL }).click();
    await expect(step.locator('[data-slot="action-review-result"][data-outcome="accepted"]'), "Submitting the seeded draft for review was not accepted, so no candidate exists for the review step to answer.").toBeVisible();
    await openShellDestination(page, "Pages"); // And the index's own answer is the second proof: the review link it renders exists only for a candidate the service holds, so a refused submission would leave the index as it was and fail here.
    await expect(page).toHaveURL(/\/pages$/u, { timeout: DESTINATION_TIMEOUT_MS });
    await followOnly('a[href^="/pages/review/"]', "The Pages index renders a review link once an edition carries a frozen candidate, and it grew none after the draft was submitted.", "The review link on the Pages index", "/pages");
  }
  await page.goto(ENTRY_PATH);
  await awaitInteractiveWorkspace(page, "The entry route as the established worker");
  await explore(record("the entry route", NO_PAGE).path);
  await visitPageReview();
  await actAs("coach"); // The coach's two destinations. A coach's authority is a grant rather than a membership, so the portfolio and the subject it admits are readable only as the coach, and no other identity's sweep could reach them.
  await openShellDestination(page, "Coaching");
  await expect(page).toHaveURL(/\/coaching$/u, { timeout: DESTINATION_TIMEOUT_MS });
  await openShellDestination(page, "Coach view");
  await expect(page).toHaveURL(/\/coaching\/coach$/u, { timeout: DESTINATION_TIMEOUT_MS });
  record("Coach view (shell navigation)", "/coaching");
  await followOnly('a[href^="/coaching/coach/"]', "The seeded coach holds an admitted grant, so its portfolio lists at least one subject to open.", "A portfolio subject row", "/coaching/coach");
  await actAs("reviewer");
  await openShellDestination(page, "Communication");
  await expect(page).toHaveURL(/\/communication$/u, { timeout: DESTINATION_TIMEOUT_MS });
  await followOnly('a[href^="/communication/review/"]', "The seeded Update awaiting review is linked from the Updates list for the reviewer who answers it, and no such link was offered.", "The review link on the Updates list", "/communication");
  await actAs("reader-public");
  await openShellDestination(page, "Communication");
  await openShellDestination(page, "Receiving preview");
  await expect(page).toHaveURL(/\/preview$/u, { timeout: DESTINATION_TIMEOUT_MS });
  record("Receiving preview (shell navigation)", "/communication");
  const post = (await navigationTargetsOn(page)).find((href) => RECEIVED_EDITION_LINK.test(href));
  expect(post, "The public reader's receiving list holds a released edition, and it offered no post to open.").toBeDefined();
  await followAnchor(page, post ?? "");
  record("A receiving-list row", "/preview");
  return { visits: [...visits.values()], ignored: [...ignored].sort((left, right) => left.localeCompare(right)) };
}
function describeUnreached(unreached: readonly string[], visits: readonly Visit[]): string {
  if (unreached.length === 0) return "Every template the router serves received a concrete visit."; // The templates the sweep never instantiated, as a message naming each one so the missing path is the first thing a reader sees.
  const rows = unreached.map((template) => `  ${template}`);
  return `The sweep recorded ${String(visits.length)} destination(s), and none of them was an instance of ${String(unreached.length)} template(s) the router serves:\n${rows.join("\n")}\nA route no control leads to cannot be reached by a person, so this fails rather than being noted.`;
}
function routeMappingReport(visits: readonly Visit[]): string {
  const firstByTemplate = new Map<string, Visit>(); // How each template was reached, printed once so the run's own record of the navigation graph can be cited.
  for (const visit of visits) {
    const template = templateOf(visit.path, EXPECTED_ROUTES) ?? "(outside the inventory)";
    if (!firstByTemplate.has(template)) firstByTemplate.set(template, visit);
  }
  const rows: string[] = [];
  for (const template of [...firstByTemplate.keys()].sort((left, right) => left.localeCompare(right))) {
    const visit = firstByTemplate.get(template);
    if (visit === undefined) continue;
    rows.push(`  ${template}  <-  ${visit.url}  (via ${visit.via}, from ${visit.from})`);
  }
  return [`Reachability sweep: ${String(visits.length)} destination(s) over ${String(firstByTemplate.size)} template(s).`, ...rows].join("\n");
}
function readManifest(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`The manifest ${path} could not be read as JSON, so the commands the documentation names cannot be checked: ${String(error)}`);
  }
}
function scriptNamesOf(manifest: unknown, subject: string): readonly string[] {
  if (typeof manifest !== "object" || manifest === null) throw new Error(`${subject} is not a JSON object, so the commands it should document cannot be read from it.`); // The script names one manifest declares, refusing a manifest that declares none rather than reporting an empty success.
  const scripts = (manifest as Readonly<Record<string, unknown>>)["scripts"];
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) throw new Error(`${subject} declares no scripts object, and every documented command is one of its entries.`);
  return Object.keys(scripts);
}
const envFilesIn = (directory: string): readonly string[] => readdirSync(directory).filter((name) => /^\.env(?:\.|$)/u.test(name));
function describeCommandFailure(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error); // What a failed command said, in enough detail to act on: its exit status, its message and the tail of both streams.
  const failure = error as Readonly<Record<string, unknown>>;
  const status = typeof failure["status"] === "number" ? `exit ${String(failure["status"])}` : typeof failure["signal"] === "string" ? `signal ${failure["signal"]}` : "no exit status";
  const tail = (value: unknown, limit: number): string => (typeof value === "string" && value.trim() !== "" ? value.trim().slice(-limit) : "");
  return [status, typeof failure["message"] === "string" ? failure["message"] : "", tail(failure["stderr"], 4_000), tail(failure["stdout"], 2_000)].filter((part) => part !== "").join(" — ");
}
/** Runs one documented command in the application directory, failing with what it said if it does not exit 0. */
function runDocumentedCommand(args: readonly string[]): void {
  try {
    execFileSync("bun", [...args], { cwd: APPLICATION_DIRECTORY, encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  } catch (error) {
    throw new Error(`\`bun ${args.join(" ")}\` run in ${APPLICATION_DIRECTORY} did not exit 0: ${describeCommandFailure(error)}`);
  }
}
test.use({ persona: "established-worker" }); // Every test here acts as the established worker; the sweep switches session only for the three surfaces that belong to another identity.; Every test starts from the deterministic seed.
test("every page route is a destination the shell reaches, and no route exists without a path to it", async ({ page }) => {
  test.setTimeout(600_000);
  const served = pageRoutesUnder(join(import.meta.dirname, "..", "src", "app"), []);
  expect(describeInventoryDifference(EXPECTED_ROUTES, served), "The route inventory this file states and the router it sweeps must describe the same application, or the sweep proves coverage of a set nobody serves.").toBe("");
  expect(ROUTE_EXCEPTIONS, "Exactly one address may be excepted from the sweep, and it is the legacy alias that resolves instead of rendering.").toEqual(["/feed"]);
  const report = await sweepTheShell(page, served);
  const unreached = served.filter((template) => (ROUTE_EXCEPTIONS.includes(template) ? false : !report.visits.some((visit) => matchesTemplate(template, visit.path))));
  expect(unreached, describeUnreached(unreached, report.visits)).toEqual([]);
  const outsideInventory = report.visits.filter((visit) => templateOf(visit.path, served) === undefined); // The other direction: nothing the sweep landed on may be outside the inventory. A redirect that carried it somewhere the inventory does not name is exactly the kind of orphan this assertion exists to catch.
  const outsideUrls = outsideInventory.map((visit) => visit.url);
  expect(outsideUrls, "The sweep reached an address the router's own page templates do not account for, so a destination exists that the inventory never described.").toEqual([]);
  const pageShaped = report.ignored.filter((href) => templateOf(pathnameOf(href), served) !== undefined); // And the links it did not follow must address no page at all: a static fixture, an icon or another asset.
  expect(pageShaped, "A link the sweep skipped actually addresses a page route, which would mean the inventory and the crawl disagree about what a destination is.").toEqual([]);
  process.stdout.write(`${routeMappingReport(report.visits)}\nLinks followed by nothing because they address no page: ${report.ignored.length === 0 ? "none" : report.ignored.join(", ")}\n`);
});
test("the one declared exception resolves to Communication, and no navigation entry names it", async ({ page }) => {
  await page.goto(ALIAS_PATH); // The alias is asked for directly on purpose: the claim is that a request to it resolves, which is the one thing about this address the shell can never show by navigating to it.
  await expect(page).toHaveURL(/\/communication$/u, { timeout: DESTINATION_TIMEOUT_MS });
  await expect(page.getByRole("heading", { level: 1, name: "Updates" }), "The alias must resolve to the Updates surface rather than to a notice, an empty page or a refusal.").toBeVisible();
  await expect(page.locator('a[href="/feed"]'), "The alias is an address that resolves, never an entry the rail offers.").toHaveCount(0);
  await page.goto(ENTRY_PATH);
  await expandCollapsedSections(page);
  await expect(page.locator('a[href="/feed"]'), "The alias is an address that resolves, never an entry the rail offers.").toHaveCount(0);
});
test("the documented commands exist, and the checks that can run beside the development server pass", async () => {
  test.setTimeout(COMMAND_TIMEOUT_MS);
  for (const command of DOCUMENTED_ROOT_SCRIPTS) expect(scriptNamesOf(readManifest(join(REPOSITORY_DIRECTORY, "package.json")), "The root manifest"), `The documentation names \`bun run ${command}\` at the repository root, and the root manifest declares no such script.`).toContain(command);
  const applicationScripts = scriptNamesOf(readManifest(join(APPLICATION_DIRECTORY, "package.json")), "The application manifest");
  for (const command of DOCUMENTED_APPLICATION_SCRIPTS) expect(applicationScripts, `The documentation names \`bun run ${command}\` inside the application package, and its manifest declares no such script.`).toContain(command);
  runDocumentedCommand(["run", "typecheck"]);
  runDocumentedCommand(["run", "lint"]);
  expect(envFilesIn(REPOSITORY_DIRECTORY), "The checkout ships no .env or .env.* file: the application starts with no provider secret, so nothing needs configuring.").toEqual([]);
  expect(envFilesIn(APPLICATION_DIRECTORY), "The application package ships no .env or .env.* file either, for the same reason.").toEqual([]);
  const supplied = ABSENT_PROVIDER_VARIABLES.filter((name) => (process.env[name] ?? "").trim() !== "");
  expect(supplied, "A provider credential was present in the environment this run started in, so the claim that the application needs none was not tested.").toEqual([]);
});
test("a destination the rail offers on a wide screen is also a full page at 320 CSS px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(ENTRY_PATH);
  await awaitInteractiveWorkspace(page, "The entry route at 320 CSS px");
  const drawerToggle = page
    .getByRole("button", { name: /toggle sidebar/iu })
    .filter({ visible: true })
    .first();
  await expect(drawerToggle, "At 320 CSS px the rail collapses, and the toggle that opens it is the only way into navigation.").toHaveCount(1);
  await drawerToggle.click();
  const partners = page.getByRole("link", { name: "Partners", exact: true }).filter({ visible: true }).first();
  await expect(partners, "The drawer holds the same destinations the wide rail does.").toHaveCount(1);
  await partners.click();
  await expect(page).toHaveURL(/\/partners$/u, { timeout: DESTINATION_TIMEOUT_MS });
  const row = page.locator('a[href^="/partners/partner-"]').filter({ visible: true }).first(); // A record opened from the roster arrives as the page it is, not as a panel only a wide screen can host.
  await expect(row, "The roster offers a record to open at 320 CSS px, as it does on a wide screen.").toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(/\/partners\/[^/?]+(?:\?.*)?$/u, { timeout: DESTINATION_TIMEOUT_MS });
  await expect(page.getByRole("heading", { level: 1 }), "The record states its own heading on the page the phone opened.").toBeVisible();
  await expect(page.locator('[role="dialog"]').filter({ visible: true }), "The record is the page itself: no drawer or dialog stands between a phone and the destination.").toHaveCount(0);
});
