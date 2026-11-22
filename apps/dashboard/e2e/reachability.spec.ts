/**
 * Criterion 21 — reachability and commands: every destination the application serves is one a person can
 * reach by operating the shell, and every command the documentation names exists and is honest about what
 * this file runs.
 *
 * **What this file proves.** Two things, and nothing wider. First, that the router and the navigation agree
 * in both directions: every `page.tsx` under `src/app` receives a concrete visit during a crawl that starts
 * at `/` and uses only the shell's own controls — the rail, its collapsed section toggles, list rows, record
 * links and the buttons a surface offers — and no visited address falls outside the inventory the router
 * declares. A route with no way in is a defect this file reports as a failure naming the unreached template,
 * not a note beside a passing run. Second, that the root and application manifests carry the scripts the
 * documentation states, and that the two checks which can run while the development server owns `.next` —
 * `bun run typecheck` and `bun run lint` — pass from the application directory.
 *
 * **How reachability is proven, and what it never does.** The addresses are enumerated from disk, so a route
 * added to the router is swept without a second inventory to remember; a hardcoded list of forty-five
 * templates is compared against that enumeration, so a route the inventory does not name fails loudly with a
 * readable diff instead of being skipped. The crawl itself opens `/` once and then only clicks: an anchor is
 * followed, the destination is asserted before anything else is read, and the browser is taken back to the
 * page the link was on. Nothing inside the application is reached by typing an address, because a sweep that
 * navigated directly would prove the router answers rather than that a person can get there.
 *
 * **The three identities whose surfaces belong to them.** A coach's portfolio, one subject it admits, and
 * the reader's receiving view are reached only by the session that holds the grant or the membership, so the
 * crawl switches the development-session cookie to the seeded coach, reviewer and public reader for those
 * hops. That is the same mechanism the runner's own automatic fixture uses, and the only one this release
 * has: the development runtime states that a session id is the identity, and no control switches it. No
 * sign-in, no persona endpoint and no second identity mechanism is invented here.
 *
 * **The one declared exception.** `/feed` is not a destination: `src/app/feed/page.tsx` answers a request
 * with `redirect("/communication")`, so it is never reached by navigation and its own test asserts the
 * resolution positively rather than exempting it silently. It is the only entry the sweep excepts.
 *
 * **What is deliberately not here.** This file audits no dependency and measures no line count — criterion
 * 22's audit owns both — and it never runs `bun run test` from inside a test, because that command starts
 * this very suite, nor `bun run build` while the development server owns `.next`. Those, with `bun install`
 * and `bun run reset`, are verified once from a clean checkout by the command transcript the final report
 * cites; the comment beside the assertions below says so where a reader will look for them.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, resetSeed, RESET_URL, SEEDED_PERSONAS, SESSION_COOKIE, test, type PersonaName } from "../playwright.config";

// ---------------------------------------------------------------------------------------------
// The seeded scenario this file acts in, and the destinations it names
// ---------------------------------------------------------------------------------------------

/**
 * The identity the crawl starts as: the established worker.
 *
 * Two ministries are what make the context chooser and the context indicator reachable, and years of support,
 * partners, open work, drafts, releases and published Pages are what make every list hold at least one row —
 * a sweep cannot follow a row link into a record that no seeded identity owns. The coach, reviewer and
 * public reader are switched to for their own three surfaces, below.
 */
const PERSONA: PersonaName = "established-worker";

/** The label the shell states on every screen, which is the first thing the crawl asserts it is looking at. */
const DEVELOPMENT_DATA_LABEL = "Development data";

/** Where every crawl starts, and where each identity hop begins: the entry route, never a destination. */
const ENTRY_PATH = "/";

/** The origin the session cookie is set on, taken from the runner's own control address rather than restated. */
const ORIGIN = new URL(RESET_URL).origin;

/** The shell's one `main` landmark, which is what "the destination rendered" means after a click. */
const MAIN_LANDMARK = "#main-content";

/** The accessible name every collapsed navigation section's toggle carries; the open ones read "Collapse …". */
const COLLAPSED_SECTION_TOGGLE = /^Expand /u;

/** The router's own directory, and the file name the app router turns into a document. */
const ROUTER_DIRECTORY = join(import.meta.dirname, "..", "src", "app");
const PAGE_FILE = "page.tsx";

/** The application package and the checkout around it: the two manifests and the two `.env` locations the audit reads. */
const APPLICATION_DIRECTORY = join(import.meta.dirname, "..");
const REPOSITORY_DIRECTORY = join(APPLICATION_DIRECTORY, "..", "..");

/** A router segment that is part of no URL: a route group `(name)`, a private folder `_name` and a parallel slot `@name`. */
const UNROUTED_SEGMENT = /^(?:\([^)]*\)|_.*|@.*)$/u;

/** The one router folder whose files are transport rather than destinations, so the sweep never treats one as a page. */
const TRANSPORT_SEGMENT = "api";

/** The 320 CSS px width every retained job has to complete at, and a phone's own height beside it. */
const PHONE_WIDTH = 320;
const PHONE_HEIGHT = 720;

/** The legacy alias, named once so the exception list, its probe and the sweep cannot disagree about which address it is. */
const ALIAS_PATH = "/feed";

/** The single declared exception to the inventory: the legacy alias, which resolves rather than renders. */
const ROUTE_EXCEPTIONS: readonly string[] = [ALIAS_PATH];

/**
 * The route inventory of the release, one row per page the router serves.
 *
 * This is AAP 0.9.1's route tree as a list a test can diff, and it is deliberately a second copy: the
 * enumeration reads the router from disk, this list states what the router is meant to serve, and the
 * comparison between them is what turns "a route nobody can reach" into a failure naming the route. Every
 * entry is grouped by the question its family answers, so a reader can see which destination belongs to
 * which job without opening the router.
 */
const EXPECTED_ROUTES: readonly string[] = [
  // Shell, Home, Settings and Help — the workspace every other family renders inside.
  "/",
  "/feed",
  "/settings",
  "/help",
  // Partners — the roster, one record, its edit form, the interaction form, and the three outreach surfaces.
  "/partners",
  "/partners/[partnerId]",
  "/partners/[partnerId]/edit",
  "/partners/[partnerId]/interactions/new",
  "/partners/import",
  "/partners/initiatives",
  "/partners/initiatives/[initiativeId]",
  "/partners/referrals",
  "/partners/referrals/[referralId]",
  // Work — the task lists, the dated agenda, and one recurring series.
  "/work",
  "/work/agenda",
  "/work/series/[seriesId]",
  // Support — the overview, the ledger and one gift, commitments and one commitment, and the four fixed reports.
  "/support",
  "/support/gifts",
  "/support/gifts/[giftId]",
  "/support/commitments",
  "/support/commitments/[commitmentId]",
  "/support/reports/[reportId]",
  // Communication — Updates, one Update, one edition, that edition's preview, the review step, and the three audience surfaces.
  "/communication",
  "/communication/[updateId]",
  "/communication/[updateId]/[variantId]",
  "/communication/[updateId]/[variantId]/preview",
  "/communication/review/[candidateId]",
  "/communication/audience",
  "/communication/delivery",
  "/communication/inbox",
  // Pages — both family catalogues, one builder, one locale edition's own preview, and the review step.
  "/pages",
  "/pages/[pageId]",
  "/pages/[pageId]/[locale]/preview",
  "/pages/review/[candidateId]",
  // Coaching — the worker's preparation, its three shared surfaces, and the coach's read-only view of one subject.
  "/coaching",
  "/coaching/targets",
  "/coaching/check-ins",
  "/coaching/sharing",
  "/coaching/coach",
  "/coaching/coach/[subjectId]",
  // The receiving preview — the list, one post, the discovery index, one public reading view, and the reader's preferences.
  "/preview",
  "/preview/[updateId]",
  "/preview/pages",
  "/preview/pages/[pageId]/[locale]",
  "/preview/preferences",
];

/** The commands the documentation states, in the root manifest, each of which this file requires to exist. */
const DOCUMENTED_ROOT_SCRIPTS: readonly string[] = ["dev", "build", "typecheck", "lint", "test", "reset", "seed:workload", "fixtures:media", "lines"];

/** The commands the documentation states for the application package itself. */
const DOCUMENTED_APPLICATION_SCRIPTS: readonly string[] = ["dev", "build", "typecheck", "lint", "test"];

/**
 * The provider variables this release must start without, named exactly.
 *
 * A pattern over the whole environment would report the host's own tooling — a CI runner sets no end of
 * variables whose names merely resemble a provider's — so the list is closed and states the credentials a
 * live integration would need: mail submission, the workflow engine, the CMS, the database, the language
 * model, payments and object storage. Each one absent is what "the application starts with no provider
 * secret" means for the run this file performs.
 */
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

/** An environment file, which this checkout ships none of: the application needs no configuration to start. */
const ENV_FILE = /^\.env(?:\.|$)/u;

/**
 * How long the crawl is given.
 *
 * The suite's own budget is 180 s per test, and a sweep of the whole route set — forty-five templates, each
 * destination compiled once by the development server and read through its own authorised service reads —
 * does not fit inside it. The budget is stated here rather than by loosening the runner's for every spec.
 */
const CRAWL_TIMEOUT_MS = 600_000;

/** How long one command run from the application directory is given: a full type check of the workspace is the slow one. */
const COMMAND_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------------------------
// The router as it stands, and the inventory it is compared against
// ---------------------------------------------------------------------------------------------

/**
 * Every page template the router serves, read from the router itself.
 *
 * Walking the directory rather than listing addresses means a route added to the application is swept without
 * a second list to keep, and a route the inventory does not name shows up as an unexpected template in the
 * diff below. Route groups, private folders and parallel slots are dropped because they address nothing, and
 * the transport folder is skipped because a route handler answers a request rather than rendering a document.
 */
function pageRoutesUnder(directory: string, segments: readonly string[]): readonly string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const routed = segments.filter((segment) => !UNROUTED_SEGMENT.test(segment));
  const here = entries.some((entry) => entry.isFile() && entry.name === PAGE_FILE) ? [`/${routed.join("/")}`] : [];
  const nested = entries.filter((entry) => entry.isDirectory() && !UNROUTED_SEGMENT.test(entry.name) && entry.name !== TRANSPORT_SEGMENT).flatMap((entry) => pageRoutesUnder(join(directory, entry.name), [...segments, entry.name]));
  return [...here, ...nested];
}

/** The segments of an address, with the separators and any trailing slash dropped. */
function segmentsOf(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/** Whether a template segment accepts any value: the router's own `[name]` form, and nothing else. */
function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

/** Whether one concrete address is an instance of one template: same depth, and a literal match wherever the template is literal. */
function matchesTemplate(template: string, path: string): boolean {
  const expected = segmentsOf(template);
  const actual = segmentsOf(path);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => isDynamicSegment(segment) || segment === actual[index]);
}

/**
 * The template a concrete address instantiates, or nothing when it instantiates none of them.
 *
 * A literal route and a dynamic sibling can both match one address — `/partners/import` fits
 * `/partners/[partnerId]` as readily as it fits itself — so the most specific match wins: the template with the
 * most literal segments. Without that rule the mapping would credit the import journey to the partner-detail
 * template, and a router that lost its import page would still look fully covered.
 */
function templateOf(path: string, templates: readonly string[]): string | undefined {
  let match: { readonly template: string; readonly literals: number } | undefined;
  for (const template of templates) {
    if (!matchesTemplate(template, path)) continue;
    const literals = segmentsOf(template).filter((segment) => !isDynamicSegment(segment)).length;
    if (match === undefined || literals > match.literals) match = { template, literals };
  }
  return match?.template;
}

/** The path an address names, without its origin, its query or its trailing slash: the key a visit is recorded under. */
function pathnameOf(address: string): string {
  const parsed = new URL(address, ORIGIN);
  const trimmed = parsed.pathname.replace(/\/+$/u, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * The difference between the inventory and the router, as a message a reader can act on.
 *
 * Both directions are reported, because they are two different defects: a route the inventory names and the
 * router no longer serves is a promises-versus-delivery gap, and a route the router serves and the inventory
 * does not name is one nobody audited. An empty string means the two agree.
 */
function describeInventoryDifference(expected: readonly string[], served: readonly string[]): string {
  const missing = expected.filter((template) => !served.includes(template));
  const unexpected = served.filter((template) => !expected.includes(template));
  if (missing.length === 0 && unexpected.length === 0) return "";
  const lines = [`The route inventory and the router disagree: ${String(expected.length)} template(s) named, ${String(served.length)} served.`];
  if (missing.length > 0) lines.push(`  Named and not served by src/app: ${missing.join(", ")}`);
  if (unexpected.length > 0) lines.push(`  Served by src/app and named by no inventory row: ${unexpected.join(", ")}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// One click-only sweep of the shell
// ---------------------------------------------------------------------------------------------

/** One destination the sweep landed on, with the control that took it there and the page that control was on. */
interface Visit {
  /** The path the sweep landed on, without its query: the address a template is matched against. */
  readonly path: string;
  /** The address as the browser held it, query and all, so the mapping prints what was really opened. */
  readonly url: string;
  /** How the destination was reached: the anchor's own href, or the name of the shell control. */
  readonly via: string;
  /** The page the control was operated on. */
  readonly from: string;
}

/** What one sweep found: the destinations it reached, and every link it did not follow because it addresses no page. */
interface SweepReport {
  readonly visits: readonly Visit[];
  readonly ignored: readonly string[];
}

/** How the entry route is recorded: it is the one load the sweep performs, so no control led to it. */
const ENTRY_VIA = "the entry route";

/** What the entry route has above it, stated rather than left blank. */
const NO_PAGE = "(nothing above it)";

/** How long one destination is given to render after its link is clicked, and one step back to settle. */
const DESTINATION_TIMEOUT_MS = 30_000;

/** How many collapsed section toggles one page may need before the sweep decides the rail is fighting it. */
const SECTION_TOGGLE_LIMIT = 32;

/** The word the Page builder's review control carries, on the trigger and on the step's own confirm button alike. */
const PAGE_SUBMIT_LABEL = "Submit for review";

/**
 * The development panel in the state it reaches only after the browser has run the application's own code.
 *
 * The server renders that panel in its `loading` state, so an element in any other state is proof that React has
 * hydrated and answered a client read. That matters for a control that is a `button` with a handler — a rail link
 * survives an unhydrated click as an ordinary document navigation, but a toggle that has not hydrated swallows the
 * click silently, and the pass would then be asserting against a page the browser had not made interactive.
 */
const HYDRATED_WORKSPACE = '[data-slot="dev-controls"]:not([data-state="loading"])';

/**
 * The selector that finds one anchor by its href.
 *
 * Built from the href the page itself rendered, with the two characters CSS would otherwise read as syntax —
 * a backslash and a double quote — escaped. The href is never used as a path, a URL to fetch or a regular
 * expression, so nothing in it is interpreted.
 */
function anchorSelector(href: string): string {
  return `a[href="${href.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`;
}

/**
 * Opens every collapsed section of the rail.
 *
 * A section's sub-surfaces are rendered only while it is open, so a sweep that ignored this would miss every
 * destination below a top-level entry and report them as unreachable. The toggle is the shell's own, named
 * "Expand <section>" while collapsed and "Collapse <section>" while open, so clicking each collapsed one
 * once is idempotent: a second pass finds nothing to expand.
 */
async function expandCollapsedSections(page: Page): Promise<void> {
  for (let expanded = 0; expanded < SECTION_TOGGLE_LIMIT; expanded += 1) {
    const toggle = page.getByRole("button", { name: COLLAPSED_SECTION_TOGGLE }).filter({ visible: true }).first();
    if ((await toggle.count()) === 0) return;
    await toggle.click();
  }
  throw new Error(`The rail still offered a collapsed section after ${String(SECTION_TOGGLE_LIMIT)} expansions on ${pathnameOf(page.url())}, so this sweep cannot tell a reachable destination from one hidden behind a toggle.`);
}

/** How many consecutive identical samples of a page's link set are needed before the sweep treats that set as settled. */
const LINK_SETTLE_SAMPLES = 3;

/** The wait between two samples of a page's link set: long enough for a list's own read to have answered. */
const LINK_SETTLE_INTERVALS: readonly number[] = [400, 400];

/**
 * Every internal address the page currently offers, once each and in a stable order.
 *
 * A list renders its rows in the browser once its own read answers, so a harvest taken the instant a click lands can
 * see the rail and nothing else. A sweep that recorded that answer would reach every record on one timing and none
 * on another, which is the determinism this suite cannot trade away — so the set is sampled until consecutive
 * samples agree. That is an assertion rather than a pause: the sweep waits for the page to stop offering new
 * addresses, not for a fixed number of milliseconds.
 */
async function navigationTargetsOn(page: Page): Promise<readonly string[]> {
  await expandCollapsedSections(page);
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
        return agreements >= LINK_SETTLE_SAMPLES - 1;
      },
      { message: `The links ${pathnameOf(page.url())} offers never stopped changing, so this sweep cannot tell which destinations the page really leads to.`, timeout: DESTINATION_TIMEOUT_MS, intervals: [...LINK_SETTLE_INTERVALS] },
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
  // Only same-origin addresses can be a destination of this application: a protocol-relative address belongs to
  // another site, and the framework's own asset prefix is not a page. Everything else is kept and matched against
  // the inventory, so an address the application serves but the inventory omits is reported rather than dropped.
  const internal = hrefs.filter((href) => href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/_next/"));
  return [...new Set(internal)].sort((left, right) => left.localeCompare(right));
}

/**
 * Follows one anchor, and asserts the destination before anything else is read.
 *
 * A link the rail held a moment ago can be gone when its section has collapsed again after another
 * navigation, so the one retry this helper makes is to re-open the sections and look once more. A link that is
 * still absent is a failure with the page named, because the sweep's claim is that the control exists rather
 * than that it once existed.
 */
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

/** Returns to the page a link was followed from, and asserts the return before the next link is touched. */
async function returnTo(page: Page, path: string): Promise<void> {
  await page.goBack();
  await expect.poll(() => pathnameOf(page.url()), { message: `Stepping back from ${pathnameOf(page.url())} did not return to ${path}.`, timeout: DESTINATION_TIMEOUT_MS }).toBe(path);
  await expect(page.locator(MAIN_LANDMARK)).toBeVisible();
  await expandCollapsedSections(page);
}

/** Operates one of the rail's own entries or sub-entries by the words it is named with. */
async function openShellDestination(page: Page, label: string): Promise<void> {
  await expandCollapsedSections(page);
  const link = page.getByRole("link", { name: label, exact: true }).filter({ visible: true }).first();
  await expect(link, `The shell offers no visible navigation entry named ${JSON.stringify(label)} on ${pathnameOf(page.url())}.`).toHaveCount(1);
  await link.click();
  await expect(page.locator(MAIN_LANDMARK)).toBeVisible();
}

/**
 * Asserts that the workspace is on screen and interactive, in that order.
 *
 * The persistent Development data label is server-rendered and proves the document arrived; the development panel
 * leaving its `loading` state proves the browser ran the application's own code. Both are asserted before a control
 * is operated, so a pass never reports a lost click as an unreachable destination.
 */
async function awaitInteractiveWorkspace(page: Page, subject: string): Promise<void> {
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first(), `${subject} did not state the persistent Development data label, so this sweep would not know the screen was synthetic data.`).toBeVisible();
  await expect(page.locator(HYDRATED_WORKSPACE).first(), `${subject} never became interactive: the development panel stayed in its server-rendered loading state, so a control would swallow the click that follows.`).toBeVisible();
}

/** The received-edition address a reader's list offers: one Update's post, and never the discovery index or the preferences. */
const RECEIVED_EDITION_LINK = /^\/preview\/(?!pages(?:\/|$)|preferences$)[^/?#]+(?:[?#]|$)/u;

/**
 * Sweeps the application from `/` by operating nothing but the shell, then reaches the three surfaces that
 * belong to the coach, the reviewer and the public reader.
 *
 * Every destination the sweep lands on is recorded with the control that reached it, so the closure assertion
 * can name the template that never came back and the mapping can state how the rest were found. Identity hops
 * begin at the entry route with a different seeded session — the same cookie the runner's own fixture sets —
 * and then use the rail like any other visit, which is what keeps "reachable" a claim about the shell rather
 * than about a typed address.
 */
async function sweepTheShell(page: Page, templates: readonly string[]): Promise<SweepReport> {
  const visits = new Map<string, Visit>();
  const ignored = new Set<string>();

  /** Records the destination the browser is on now, once per path, and answers the record either way. */
  function record(via: string, from: string): Visit {
    const path = pathnameOf(page.url());
    const known = visits.get(path);
    if (known !== undefined) return known;
    const visit: Visit = { path, url: page.url(), via, from };
    visits.set(path, visit);
    return visit;
  }

  /** Whether a destination is worth following: a page the inventory names, which nothing has visited yet. */
  function isNewDestination(path: string): boolean {
    if (visits.has(path)) return false;
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

  /** Opens the entry route as one of the seeded identities, which is the whole of how identity is switched here. */
  async function actAs(persona: PersonaName): Promise<void> {
    await page.context().addCookies([{ name: SESSION_COOKIE, value: SEEDED_PERSONAS[persona].sessionId, url: ORIGIN }]);
    await page.goto(ENTRY_PATH);
    await awaitInteractiveWorkspace(page, `The ${SEEDED_PERSONAS[persona].label} session's entry route`);
  }

  /**
   * The Page review step, which exists only once a candidate does.
   *
   * The Pages index renders a review link for an edition that carries a frozen candidate, and the seeded Page
   * carries a draft rather than a candidate — so the step is reached the way a reviewer's queue is filled: the
   * Arabic draft is submitted from the builder's own control, and the index then grows the link the sweep follows.
   * Submitting freezes the exact revision and releases nothing; no notice is prepared and nobody is notified.
   */
  async function visitPageReview(): Promise<void> {
    await openShellDestination(page, "Pages");
    await expect(page).toHaveURL(/\/pages$/u, { timeout: DESTINATION_TIMEOUT_MS });
    const builder = page.locator('a[href^="/pages/"]:not([href^="/pages/review/"])').filter({ visible: true }).first();
    await expect(builder, "The Pages index offers no Page to open, so the review step below it cannot be reached.").toHaveCount(1);
    const builderHref = await builder.getAttribute("href");
    if (builderHref === null) throw new Error("The Page row's link carried no href, so this sweep cannot open the builder.");
    await followAnchor(page, builderHref);
    record("A Page row on the index", "/pages");

    const submit = page.getByRole("button", { name: PAGE_SUBMIT_LABEL }).filter({ visible: true }).first();
    await expect(submit, "The seeded Page's composed edition holds a draft, so the builder offers the one review step this release has.").toHaveCount(1);
    await submit.click();
    const step = page
      .locator('[data-slot="action-review"]')
      .filter({ has: page.getByRole("heading", { name: PAGE_SUBMIT_LABEL }) })
      .first();
    await expect(step, "The builder offered no review step for the draft it composes.").toBeVisible();
    await step.getByRole("button", { name: PAGE_SUBMIT_LABEL }).click();
    // The step's own receipt is awaited before the index is opened: the index's read is invalidated by an accepted
    // submission, so reading it while the mutation is still in flight would show the state before the candidate
    // existed and prove nothing about the route below.
    await expect(step.locator('[data-slot="action-review-result"][data-outcome="accepted"]'), "Submitting the seeded draft for review was not accepted, so no candidate exists for the review step to answer.").toBeVisible();

    // And the index's own answer is the second proof: the review link it renders exists only for a candidate the
    // service holds, so a refused submission would leave the index as it was and fail here.
    await openShellDestination(page, "Pages");
    await expect(page).toHaveURL(/\/pages$/u, { timeout: DESTINATION_TIMEOUT_MS });
    const review = page.locator('a[href^="/pages/review/"]').filter({ visible: true }).first();
    await expect(review, "The Pages index renders a review link once an edition carries a frozen candidate, and it grew none after the draft was submitted.").toHaveCount(1);
    const reviewHref = await review.getAttribute("href");
    if (reviewHref === null) throw new Error("The Page review link carried no href, so this sweep cannot follow it.");
    await followAnchor(page, reviewHref);
    record("The review link on the Pages index", "/pages");
  }

  await page.goto(ENTRY_PATH);
  await awaitInteractiveWorkspace(page, "The entry route as the established worker");
  const entry = record(ENTRY_VIA, NO_PAGE);
  await explore(entry.path);
  await visitPageReview();

  // The coach's two destinations. A coach's authority is a grant rather than a membership, so the portfolio and
  // the subject it admits are readable only as the coach, and no other identity's sweep could reach them.
  await actAs("coach");
  await openShellDestination(page, "Coaching");
  await expect(page).toHaveURL(/\/coaching$/u, { timeout: DESTINATION_TIMEOUT_MS });
  await openShellDestination(page, "Coach view");
  await expect(page).toHaveURL(/\/coaching\/coach$/u, { timeout: DESTINATION_TIMEOUT_MS });
  record("Coach view (shell navigation)", "/coaching");
  const subject = page.locator('a[href^="/coaching/coach/"]').filter({ visible: true }).first();
  await expect(subject, "The seeded coach holds an admitted grant, so its portfolio lists at least one subject to open.").toHaveCount(1);
  const subjectHref = await subject.getAttribute("href");
  if (subjectHref === null) throw new Error("The coach's portfolio rendered a subject link with no href, so this sweep cannot follow it.");
  await followAnchor(page, subjectHref);
  record("A portfolio subject row", "/coaching/coach");

  // The review step. It is one identity's job, and the Update awaiting review is linked from the Updates list.
  await actAs("reviewer");
  await openShellDestination(page, "Communication");
  await expect(page).toHaveURL(/\/communication$/u, { timeout: DESTINATION_TIMEOUT_MS });
  const review = page.locator('a[href^="/communication/review/"]').filter({ visible: true }).first();
  await expect(review, "The seeded Update awaiting review is linked from the Updates list for the reviewer who answers it, and no such link was offered.").toHaveCount(1);
  const reviewHref = await review.getAttribute("href");
  if (reviewHref === null) throw new Error("The review link carried no href, so this sweep cannot follow it.");
  await followAnchor(page, reviewHref);
  record("The review link on the Updates list", "/communication");

  // The reader's receiving view: the list, then one post from it, opened as the reader the post is addressed to.
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

// ---------------------------------------------------------------------------------------------
// Reading what the sweep found
// ---------------------------------------------------------------------------------------------

/** The templates the sweep never instantiated, as a message naming each one so the missing path is the first thing a reader sees. */
function describeUnreached(unreached: readonly string[], visits: readonly Visit[]): string {
  if (unreached.length === 0) return "Every template the router serves received a concrete visit.";
  const rows = unreached.map((template) => `  ${template}`);
  return `The sweep recorded ${String(visits.length)} destination(s), and none of them was an instance of ${String(unreached.length)} template(s) the router serves:\n${rows.join("\n")}\nA route no control leads to cannot be reached by a person, so this fails rather than being noted.`;
}

/**
 * How each template was reached, printed once so the run's own record of the navigation graph can be cited.
 *
 * One row per template rather than one per destination: the mapping answers "which control took the sweep
 * into this family", which is what a reviewer needs, and the concrete address on each row is the instance a
 * reader can open to see the same page.
 */
function routeMappingReport(visits: readonly Visit[]): string {
  const firstByTemplate = new Map<string, Visit>();
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

/** A manifest as JSON, or a failure naming the file that could not be read as one. */
function readManifest(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`The manifest ${path} could not be read as JSON, so the commands the documentation names cannot be checked: ${String(error)}`);
  }
}

/** The script names one manifest declares, refusing a manifest that declares none rather than reporting an empty success. */
function scriptNamesOf(manifest: unknown, subject: string): readonly string[] {
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`${subject} is not a JSON object, so the commands it should document cannot be read from it.`);
  }
  const scripts = (manifest as Readonly<Record<string, unknown>>)["scripts"];
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    throw new Error(`${subject} declares no scripts object, and every documented command is one of its entries.`);
  }
  return Object.keys(scripts);
}

/** The environment files a directory holds, which this checkout ships none of. */
function envFilesIn(directory: string): readonly string[] {
  return readdirSync(directory).filter((name) => ENV_FILE.test(name));
}

/** What a failed command said, in enough detail to act on: its exit status, its message and the tail of both streams. */
function describeCommandFailure(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const failure = error as Readonly<Record<string, unknown>>;
  const status = typeof failure["status"] === "number" ? `exit ${String(failure["status"])}` : typeof failure["signal"] === "string" ? `signal ${failure["signal"]}` : "no exit status";
  const tail = (value: unknown, limit: number): string => (typeof value === "string" && value.trim() !== "" ? value.trim().slice(-limit) : "");
  return [status, typeof failure["message"] === "string" ? failure["message"] : "", tail(failure["stderr"], 4_000), tail(failure["stdout"], 2_000)].filter((part) => part !== "").join(" — ");
}

/**
 * Runs one documented command in the application directory, failing with what it said if it does not exit 0.
 *
 * Only the two commands that can run while the development server owns `.next` are run from here: a type check
 * and the linter, neither of which writes that directory. `bun install`, `bun run build`, `bun run test` and
 * `bun run reset` are verified once from a clean checkout by the command transcript the final report cites —
 * `bun run test` from inside this suite would start the suite again, and a build beside the running server would
 * fight it over the same output directory, so neither is run here and neither is claimed to have been.
 */
function runDocumentedCommand(args: readonly string[]): void {
  try {
    execFileSync("bun", [...args], { cwd: APPLICATION_DIRECTORY, encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  } catch (error) {
    throw new Error(`\`bun ${args.join(" ")}\` run in ${APPLICATION_DIRECTORY} did not exit 0: ${describeCommandFailure(error)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------

/** Every test here acts as the established worker; the sweep switches session only for the three surfaces that belong to another identity. */
test.use({ persona: PERSONA });

/**
 * Every test starts from the deterministic seed.
 *
 * The runner's automatic fixture already restores it before the test body; the call below states the
 * requirement where this file is read, and a second reset lays the identical documents down again through the
 * same control the Settings screen submits.
 */
test.beforeEach(async ({ request }) => {
  await resetSeed(request);
});

test("every page route is a destination the shell reaches, and no route exists without a path to it", async ({ page }) => {
  test.setTimeout(CRAWL_TIMEOUT_MS);
  const served = pageRoutesUnder(ROUTER_DIRECTORY, []);
  expect(describeInventoryDifference(EXPECTED_ROUTES, served), "The route inventory this file states and the router it sweeps must describe the same application, or the sweep proves coverage of a set nobody serves.").toBe("");
  expect(ROUTE_EXCEPTIONS, "Exactly one address may be excepted from the sweep, and it is the legacy alias that resolves instead of rendering.").toEqual(["/feed"]);

  const report = await sweepTheShell(page, served);

  const unreached = served.filter((template) => (ROUTE_EXCEPTIONS.includes(template) ? false : !report.visits.some((visit) => matchesTemplate(template, visit.path))));
  expect(unreached, describeUnreached(unreached, report.visits)).toEqual([]);

  // The other direction: nothing the sweep landed on may be outside the inventory. A redirect that carried it
  // somewhere the inventory does not name is exactly the kind of orphan this assertion exists to catch.
  const outsideInventory = report.visits.filter((visit) => templateOf(visit.path, served) === undefined);
  expect(
    outsideInventory.map((visit) => visit.url),
    "The sweep reached an address the router's own page templates do not account for, so a destination exists that the inventory never described.",
  ).toEqual([]);

  // And the links it did not follow must address no page at all: a static fixture, an icon or another asset.
  const pageShaped = report.ignored.filter((href) => templateOf(pathnameOf(href), served) !== undefined);
  expect(pageShaped, "A link the sweep skipped actually addresses a page route, which would mean the inventory and the crawl disagree about what a destination is.").toEqual([]);

  process.stdout.write(`${routeMappingReport(report.visits)}\nLinks followed by nothing because they address no page: ${report.ignored.length === 0 ? "none" : report.ignored.join(", ")}\n`);
});

test("the one declared exception resolves to Communication, and no navigation entry names it", async ({ page }) => {
  // The alias is asked for directly on purpose: the claim is that a request to it resolves, which is the one
  // thing about this address the shell can never show by navigating to it.
  await page.goto(ALIAS_PATH);
  await expect(page).toHaveURL(/\/communication$/u, { timeout: DESTINATION_TIMEOUT_MS });
  await expect(page.getByRole("heading", { level: 1, name: "Updates" }), "The alias must resolve to the Updates surface rather than to a notice, an empty page or a refusal.").toBeVisible();

  // And it is not a destination: no navigation entry points at it, on the page it resolves to or on the entry route.
  await expect(page.locator('a[href="/feed"]'), "The alias is an address that resolves, never an entry the rail offers.").toHaveCount(0);
  await page.goto(ENTRY_PATH);
  await expandCollapsedSections(page);
  await expect(page.locator('a[href="/feed"]'), "The alias is an address that resolves, never an entry the rail offers.").toHaveCount(0);
});

test("the documented commands exist, and the checks that can run beside the development server pass", async () => {
  test.setTimeout(COMMAND_TIMEOUT_MS);
  const rootScripts = scriptNamesOf(readManifest(join(REPOSITORY_DIRECTORY, "package.json")), "The root manifest");
  for (const command of DOCUMENTED_ROOT_SCRIPTS) {
    expect(rootScripts, `The documentation names \`bun run ${command}\` at the repository root, and the root manifest declares no such script.`).toContain(command);
  }
  const applicationScripts = scriptNamesOf(readManifest(join(APPLICATION_DIRECTORY, "package.json")), "The application manifest");
  for (const command of DOCUMENTED_APPLICATION_SCRIPTS) {
    expect(applicationScripts, `The documentation names \`bun run ${command}\` inside the application package, and its manifest declares no such script.`).toContain(command);
  }

  // The two checks that neither recurse into this suite nor write the output directory the running server owns.
  runDocumentedCommand(["run", "typecheck"]);
  runDocumentedCommand(["run", "lint"]);

  // No environment file: the application starts with nothing configured, and a checked-in one would be a secret's home.
  expect(envFilesIn(REPOSITORY_DIRECTORY), "The checkout ships no .env or .env.* file: the application starts with no provider secret, so nothing needs configuring.").toEqual([]);
  expect(envFilesIn(APPLICATION_DIRECTORY), "The application package ships no .env or .env.* file either, for the same reason.").toEqual([]);

  // And the run itself needed none of the provider credentials a live integration would require.
  const supplied = ABSENT_PROVIDER_VARIABLES.filter((name) => (process.env[name] ?? "").trim() !== "");
  expect(supplied, "A provider credential was present in the environment this run started in, so the claim that the application needs none was not tested.").toEqual([]);
});

test("a destination the rail offers on a wide screen is also a full page at 320 CSS px", async ({ page }) => {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto(ENTRY_PATH);
  await awaitInteractiveWorkspace(page, "The entry route at 320 CSS px");

  // The rail collapses to a drawer at this width, so the shell's own toggle is the one control that opens it.
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

  // A record opened from the roster arrives as the page it is, not as a panel only a wide screen can host.
  const row = page.locator('a[href^="/partners/partner-"]').filter({ visible: true }).first();
  await expect(row, "The roster offers a record to open at 320 CSS px, as it does on a wide screen.").toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(/\/partners\/[^/?]+(?:\?.*)?$/u, { timeout: DESTINATION_TIMEOUT_MS });
  await expect(page.getByRole("heading", { level: 1 }), "The record states its own heading on the page the phone opened.").toBeVisible();
  await expect(page.locator('[role="dialog"]').filter({ visible: true }), "The record is the page itself: no drawer or dialog stands between a phone and the destination.").toHaveCount(0);
});
