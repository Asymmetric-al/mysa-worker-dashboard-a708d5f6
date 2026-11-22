/**
 * The browser journey runner: one Chromium project driving the real application through the same
 * `bun run dev` script the workspace runs, serial, and from the deterministic seed before every spec.
 *
 * This file also owns everything a spec needs before it reads — the seeded personas it can act as, the
 * reset that restores their world, and the accessibility audit criterion 20 runs — because the suite is
 * exactly the specs under `e2e/` and what they share is part of the runner rather than a twenty-first
 * spec or a committed session file. The one thing that belongs before the suite rather than before each
 * spec is `e2e/route-warmup.ts`, wired below as `globalSetup`: the development compiler has to have seen
 * every route once before the first journey opens one, which no per-spec fixture can arrange.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { defineConfig, devices, expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

const DEFAULT_PORT = 3000;

/** This clone's development server port, which `PORT` states so simultaneous checkouts never collide. */
const port = portFrom(process.env);
/** The origin the journeys drive: this clone's server and nothing else, because there is no deployment. */
const BASE_URL = `http://127.0.0.1:${port}`;

/** One committed asset the application serves with no store and no session, which is what readiness is judged on. */
const READY_URL = `${BASE_URL}/icon.svg`;

/** The development-control handler (AAP 0.6.3): the one named control a spec operates before it reads. */
export const RESET_URL = `${BASE_URL}/api/dev`;

const RESET_ACTION = "resetSeed";

const SCOPE_MEMBERS = ["organizationId", "ministryId", "supportSubjectId", "principalId"] as const;

/** The two workspace manifests that only the checkout's root holds, which is what makes the root findable from any directory inside it. */
const REPOSITORY_ROOT_MARKERS = ["turbo.json", "bun.lock"] as const;

const SEED_TIMEOUT_MS = 120_000;

/** How much of a response body an error quotes, so a failure is readable without pasting a whole envelope. */
const DETAIL_LIMIT = 400;

/** The development-session cookie's name, mirrored from `src/lib/session-cookie.ts`: the cookie is the whole identity a request is authorised as. */
export const SESSION_COOKIE = "dashboard_session";

/** The kinds of seeded identity the roster holds, as a session's persisted persona record states them. */
export type SeededPersonaKind = "coach" | "reader" | "reviewer" | "worker";

/** The ten seeded identities a spec may act as, named the way the seed's persona roster names them. */
export type PersonaName = "new-worker" | "established-worker" | "second-worker" | "fundraiser" | "coach" | "reviewer" | "reader-public" | "reader-approved-supporter" | "reader-unauthorized" | "subscriber";

/** One seeded identity: the session its cookie names, and the words the application uses for it. */
export interface SeededPersona {
  /** The seeded session id this persona's `dashboard_session` cookie carries: the identity a spec acts as. */
  readonly sessionId: string;
  /**
   * The session this runner operates the development reset as for this persona.
   *
   * Its own wherever the seeded session admits a membership. The coach and the four readers admit none —
   * their authority is a coaching grant or a curated public edition rather than a membership — so the
   * control answers them `denied no-membership` (observed on each of those five sessions) and the
   * established worker operates the reset instead. One reset lays every seeded session down, and the
   * response names them all, so the world a spec acts in is restored whichever identity carries it.
   */
  readonly resetSessionId: string;
  /** The label the development panel and the seeded documents use for this identity. */
  readonly label: string;
  readonly kind: SeededPersonaKind;
  /** What this identity is admitted to and may do, in the seed's own words. */
  readonly description: string;
}

/**
 * The seeded persona roster, mirrored from `modules/dev-runtime/seed.ts`: one row per persona of that
 * module's `SEEDED_PERSONAS`, carrying the session id its `defaultSessionId` names.
 *
 * Mirrored rather than imported, because this file configures the test runner and must not load the
 * application's service module graph — the store, the native media bindings, `next/headers` — merely to
 * read ten identities the running server already holds. A spec names a persona from this roster, the
 * runner puts that session id in the cookie, and the application resolves the rest.
 */
export const SEEDED_PERSONAS: Readonly<Record<PersonaName, SeededPersona>> = {
  "new-worker": { sessionId: "new-worker", resetSessionId: "new-worker", label: "New worker", kind: "worker", description: "A worker with no gifts, goal, subscription or integration, starting from a private contact, a task and an Update whose first draft is unwritten." },
  "established-worker": { sessionId: "established-worker", resetSessionId: "established-worker", label: "Established worker", kind: "worker", description: "A worker with years of support, recurring gifts, partners, drafts and pages, across two ministries." },
  "second-worker": { sessionId: "second-worker", resetSessionId: "second-worker", label: "Second worker", kind: "worker", description: "A worker in another organization, whose scope shares nothing with the first." },
  fundraiser: { sessionId: "deputized-fundraiser", resetSessionId: "deputized-fundraiser", label: "Deputized fundraiser", kind: "worker", description: "Someone deputized to act inside one admitted ministry, and nowhere else." },
  coach: { sessionId: "coach", resetSessionId: "established-worker", label: "Coach", kind: "coach", description: "A coach admitted read-only to exactly the modules and periods a worker has shared, until the frozen cutoff." },
  reviewer: { sessionId: "content-reviewer", resetSessionId: "content-reviewer", label: "Content reviewer", kind: "reviewer", description: "A reviewer who approves or returns the exact frozen revisions a candidate carries, and nothing else." },
  "reader-public": { sessionId: "reader-public", resetSessionId: "established-worker", label: "Public reader", kind: "reader", description: "A reader of the public edition, appearing only in the in-app receiving preview." },
  "reader-approved-supporter": { sessionId: "reader-approved-supporter", resetSessionId: "established-worker", label: "Approved-supporter reader", kind: "reader", description: "A reader admitted to the approved-supporter edition and refused anything else." },
  "reader-unauthorized": { sessionId: "reader-unauthorized", resetSessionId: "established-worker", label: "Unauthorized reader", kind: "reader", description: "A reader with no grant: the refusal discloses no count, title, size or existence hint." },
  subscriber: { sessionId: "subscriber", resetSessionId: "established-worker", label: "Subscriber", kind: "reader", description: "A reader with a purpose-specific membership, choosing Off or Immediate for that purpose alone." },
};

/** The persona a spec acts as when it names none: the established worker, which the seed makes its default session. */
export const DEFAULT_PERSONA: PersonaName = "established-worker";

/**
 * The four identifiers a mutation claims, in the shape the read envelope states them.
 *
 * Declared structurally rather than imported: this file configures the test runner, which must not load
 * the application's service module graph — the store, the native media bindings, `next/headers` — merely
 * to read a four-string contract the responses already carry.
 */
export interface ResetScope {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
}

/** The two members of a `GET /api/dev` envelope a reset presents: the authority it ran under and the revision it saw. */
interface DevStateEnvelope {
  readonly scope: ResetScope;
  readonly revision: string;
}

type DevStateRead = { readonly kind: "state"; readonly state: DevStateEnvelope } | { readonly kind: "refused"; readonly status: number; readonly outcome: string; readonly detail: string };

/**
 * Restores the deterministic seed, as the persona the spec names, before a spec reads anything.
 *
 * The reset travels through the application's own `resetSeed` control rather than editing the store
 * files, for two reasons. The scenario clock is process state inside the running server, so only a
 * control the server itself applies returns it to the seed instant — a file-level reset would leave a
 * clock an earlier spec advanced still advanced, and every later boundary would be judged at it. And the
 * control is the request the Settings reset submits, so a spec that seeds the world the way a person
 * does proves the path a person uses.
 *
 * Both requests carry one named seeded session's `dashboard_session` cookie — the persona's own, or the
 * established worker's for the five personas whose sessions admit no membership — so the reset is
 * authorised as a stated identity rather than as whatever an empty cookie jar falls back to. Every seeded
 * session is laid down by the one reset, so naming the control's identity never narrows what is restored.
 */
export async function resetSeed(request: APIRequestContext, persona: PersonaName = DEFAULT_PERSONA): Promise<void> {
  const resetSessionId = seededPersona(persona).resetSessionId;
  const cookie = cookieHeaderFor(resetSessionId);
  let read = await readDevState(request, cookie);
  // A checkout that has never been seeded holds no session document, and every control resolves a
  // session before it authorises anything, so the store is laid down once and the read repeated. Any
  // other refusal — a denied persona, an unreadable document — is reported as it stands.
  if (read.kind === "refused" && read.outcome === "unavailable") {
    seedStoreFromRepository();
    read = await readDevState(request, cookie);
  }
  if (read.kind === "refused") {
    throw new Error(`resetSeed could not read the development state as the ${seededPersona(persona).label} persona, whose reset runs as ${resetSessionId}, from ${RESET_URL}: HTTP ${String(read.status)} ${read.outcome} — ${read.detail}`);
  }
  // `scope` and `expectedRevision` are the envelope's own, and the acting principal is the session
  // cookie's: the service re-authorises the scope, answers `conflict` for a revision that no longer
  // stands, and never lets a request nominate the person it acts for. One fresh operationId per call,
  // because each reset is its own attempt rather than a replay of the last one.
  const response = await request.post(RESET_URL, { headers: { cookie }, data: { action: RESET_ACTION, operationId: crypto.randomUUID(), scope: read.state.scope, expectedRevision: read.state.revision, payload: {} } });
  const text = await response.text();
  const outcome = outcomeOf(parseJson(text));
  if (!response.ok() || (outcome !== "accepted" && outcome !== "alreadyAccepted")) {
    throw new Error(
      `resetSeed was refused as the ${seededPersona(persona).label} persona, whose reset runs as ${resetSessionId}: HTTP ${String(response.status())} ${outcome ?? "no readable outcome"} — ${detailOf(text)}. A spec that could not restore the seed asserts against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`,
    );
  }
}

/** The `Cookie` header a control's requests carry: the one identity this application authorises a control as. */
function cookieHeaderFor(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}`;
}

/** The roster row a persona names, refusing a name the roster does not hold so a mistyped persona cannot reset a session no spec asked for. */
function seededPersona(persona: PersonaName): SeededPersona {
  if (!Object.hasOwn(SEEDED_PERSONAS, persona)) {
    throw new Error(`No seeded persona is named ${JSON.stringify(persona)}. This runner seeds ${Object.keys(SEEDED_PERSONAS).join(", ")}, so a spec states one of those and the reset acts for the session that persona's cookie names.`);
  }
  return SEEDED_PERSONAS[persona];
}

/** Reads the named persona's development state, reporting a refusal as the outcome it carried. */
async function readDevState(request: APIRequestContext, cookie: string): Promise<DevStateRead> {
  const response = await request.get(RESET_URL, { headers: { cookie } });
  const text = await response.text();
  const body = parseJson(text);
  const state = devStateEnvelopeOf(body);
  if (response.ok() && state !== undefined) {
    return { kind: "state", state };
  }
  return { kind: "refused", status: response.status(), outcome: outcomeOf(body) ?? "unreadable", detail: detailOf(text) };
}

/**
 * Lays the deterministic seed down through the repository's own reset command.
 *
 * A clean checkout cannot reset itself through the application: the store directory does not exist yet,
 * so the first read answers `unavailable` and there is no session document to authorise a control
 * against. `bun run reset` is the documented command that creates it, and the running server picks the
 * documents up on its next read; the reset in `resetSeed` then runs through the application as usual and
 * returns the clock to the seed instant.
 */
function seedStoreFromRepository(): void {
  const root = repositoryRootFrom(process.cwd());
  const seeded = spawnSync("bun", ["run", "reset"], { cwd: root, encoding: "utf8", timeout: SEED_TIMEOUT_MS });
  if (seeded.error !== undefined) {
    throw new Error(`Seeding the synthetic store with \`bun run reset\` could not run: ${seeded.error.message}`);
  }
  if (seeded.status !== 0) {
    throw new Error(`Seeding the synthetic store with \`bun run reset\` exited ${String(seeded.status)}: ${detailOf(seeded.stderr ?? "")}`);
  }
}

/** The checkout this runner belongs to: the nearest ancestor of the working directory holding both workspace manifests. */
function repositoryRootFrom(startDirectory: string): string {
  let current = startDirectory;
  for (;;) {
    if (REPOSITORY_ROOT_MARKERS.every((marker) => existsSync(join(current, marker)))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`No directory up to the filesystem root from ${JSON.stringify(startDirectory)} holds both ${REPOSITORY_ROOT_MARKERS.join(" and ")}, so this runner cannot find the checkout whose store it has to seed. Run the specs from inside the checkout.`);
    }
    current = parent;
  }
}

function portFrom(environment: Readonly<Record<string, string | undefined>>): number {
  const stated = environment.PORT;
  if (stated === undefined || stated.trim().length === 0) {
    return DEFAULT_PORT;
  }
  const parsed = Number(stated);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`PORT must be a whole TCP port between 1 and 65535, and this run states ${JSON.stringify(stated)}. State the port this clone was given, so the runner drives the server it starts.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The outcome a mutation or a refused read answered with, or `undefined` for a body that carries none. */
function outcomeOf(body: unknown): string | undefined {
  return isRecord(body) && typeof body.outcome === "string" ? body.outcome : undefined;
}

function isResetScope(value: unknown): value is ResetScope {
  return isRecord(value) && SCOPE_MEMBERS.every((member) => typeof value[member] === "string" && value[member].length > 0);
}

function devStateEnvelopeOf(body: unknown): DevStateEnvelope | undefined {
  if (!isRecord(body) || !isResetScope(body.scope) || typeof body.revision !== "string" || body.revision.length === 0) {
    return undefined;
  }
  return { scope: body.scope, revision: body.revision };
}

function detailOf(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > DETAIL_LIMIT ? `${collapsed.slice(0, DETAIL_LIMIT)}…` : collapsed;
}

/** The axe-core tag set the accessibility pass audits: WCAG 2.2 level AA, with the level A and 2.1 rules it builds on. */
const ACCESSIBILITY_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/** How many offending nodes one violation names in a failure message, so a broken page reports rather than floods. */
const VIOLATION_NODE_LIMIT = 3;

/** What one accessibility audit answers, in the shape `@axe-core/playwright` produces it. */
export type AccessibilityAudit = Awaited<ReturnType<AxeBuilder["analyze"]>>;

/** One rule an audit found a page violating, with the nodes that broke it. */
export type AccessibilityViolation = AccessibilityAudit["violations"][number];

/**
 * Audits one page as it stands against the WCAG 2.2 AA tag set.
 *
 * The wrapper is thin on purpose: it fixes the tag set, so every spec that asks for an accessibility pass
 * asks for the same one, and leaves inclusion, exclusion and the moment of the audit to the spec. A spec
 * drives the surface into the state under test, asserts that state is on screen, and then audits it.
 */
export async function auditAccessibility(page: Page): Promise<AccessibilityAudit> {
  return new AxeBuilder({ page }).withTags([...ACCESSIBILITY_TAGS]).analyze();
}

/** The serious and critical violations of an audit: the ones a pass may not carry, minor and moderate findings excluded. */
export function blockingAccessibilityViolations(audit: AccessibilityAudit): readonly AccessibilityViolation[] {
  return audit.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
}

/** Asserts an audit found no serious or critical violation, naming each rule that broke and where. */
export function expectNoBlockingAccessibilityViolations(audit: AccessibilityAudit): void {
  const violations = blockingAccessibilityViolations(audit);
  expect(violations, accessibilityFailureMessage(violations)).toEqual([]);
}

/** The readable account a failed accessibility assertion carries: one line per rule, with its impact, its help link and the nodes it broke on. */
function accessibilityFailureMessage(violations: readonly AccessibilityViolation[]): string {
  if (violations.length === 0) {
    return "The page holds no serious or critical WCAG 2.2 AA violation.";
  }
  const rules = violations.map((violation) => {
    const nodes = violation.nodes.map((node) => node.target.map((selector) => (Array.isArray(selector) ? selector.join(" ") : selector)).join(" "));
    const shown = nodes.slice(0, VIOLATION_NODE_LIMIT).join(" | ");
    const rest = nodes.length > VIOLATION_NODE_LIMIT ? ` and ${String(nodes.length - VIOLATION_NODE_LIMIT)} more node(s)` : "";
    return `- ${violation.id} (${violation.impact ?? "unstated impact"}): ${violation.help} at ${shown}${rest} — ${violation.helpUrl}`;
  });
  return `The page holds ${String(violations.length)} serious or critical WCAG 2.2 AA violation(s):\n${rules.join("\n")}`;
}

/**
 * The fixtures a spec reaches the application through.
 *
 * `persona` states the seeded identity the spec acts as — `test.use({ persona: "coach" })` for a whole
 * file, or the default otherwise — and the automatic `seedReset` then runs before every test: it puts
 * that persona's session cookie on the browser context, so every page the spec opens is admitted as that
 * identity, and it restores the deterministic seed through the application's own control, so the test
 * starts from the world it names rather than from the one the previous test left behind.
 */
type RunnerFixtures = {
  /** The seeded identity this test acts as. */
  persona: PersonaName;
  /** The automatic fixture that admits the persona and restores the seed before the test body runs. */
  seedReset: void;
};

/** The runner every spec imports, carrying the seeded persona and the reset it is admitted under. */
export const test = base.extend<RunnerFixtures>({
  persona: [DEFAULT_PERSONA, { option: true }],
  seedReset: [
    async ({ persona, context, request }, use) => {
      const seeded = seededPersona(persona);
      // The cookie is the whole identity: `src/proxy.ts` mints it and `data-service/authorize.ts`
      // resolves it into a principal and its admitted memberships, so a context carrying this persona's
      // session id is what makes the page the spec drives act as that persona.
      await context.addCookies([{ name: SESSION_COOKIE, value: seeded.sessionId, url: BASE_URL }]);
      await resetSeed(request, persona);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  // The development server compiles a route on its first request, and answers it by reloading or
  // re-rendering the document it just returned. A journey whose first navigation is also that route's
  // first compile therefore races the compiler: the page reloads under it, its in-flight requests are
  // aborted, and the assertion reads a document that no longer exists. Every route is asked for once
  // here, before the first test, so the journeys start against a server that has built them all.
  globalSetup: "./e2e/route-warmup.ts",
  // One stateful synthetic store carries the scenario, the clock offset and the armed failure plan, so
  // two specs beside each other would race on all three and the determinism the journeys claim would be
  // false. Serial execution is what makes the browser tests evidence.
  fullyParallel: false,
  workers: 1,
  // A retry turns a determinism defect into a passing run, and every criterion is meant to pass on its
  // first attempt from a reset seed.
  retries: 0,
  // A focused or skipped test committed to the branch would silently narrow the suite, so CI refuses one.
  forbidOnly: !!process.env.CI,
  // The list keeps a failing spec readable in the terminal; the HTML report holds the attachments a
  // failure is diagnosed from and is written under a git-ignored directory.
  reporter: [["list"], ["html", { open: "never" }]],
  // The development server compiles a route on its first request, and the whole-query criterion runs a
  // full 100,000-row export inside one test, so a journey is bounded well above the default 30 s rather
  // than imposing a limit the export it has to prove would fail.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    // The evidence a failure is read from, kept only when something failed. No video: no criterion is
    // verified from one.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // Criterion 20's reduced-motion pass: every retained job still completes with motion suppressed.
    reducedMotion: "reduce",
  },
  // One project, one browser (AAP 0.9.2). The 320 px, keyboard, 200% zoom and reduced-motion passes are
  // set per test inside the accessibility spec, so no second project and no second engine exists.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The application as the workspace runs it, so the suite exercises the command a person runs.
    command: "bun run dev",
    // Readiness is one committed asset rather than a page or a read. A read answers 503 until the store
    // has been seeded, and a route may be mid-compile or not yet written, so probing either would stall
    // startup on the very state the first spec's reset exists to create; the icon is served from the
    // application's own metadata files and needs neither a store nor a session.
    url: READY_URL,
    env: { PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" },
    // Outside CI a server already listening on this clone's port is reused; in CI it never is, so a stale
    // server cannot stand in for the build under test.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
