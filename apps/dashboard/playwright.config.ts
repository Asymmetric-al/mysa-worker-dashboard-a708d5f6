/** The browser journey runner: one Chromium project driving the real application through the same */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { defineConfig, devices, expect, test as base, type APIRequestContext, type Download, type Locator, type Page, type TestInfo } from "@playwright/test";
import { parse } from "csv-parse/sync";
const DEFAULT_PORT = 3000;
const port = portFrom(process.env); // This clone's development server port, which `PORT` states so simultaneous checkouts never collide.
/** The origin the journeys drive: this clone's server and nothing else, because there is no deployment. */
export const BASE_URL = `http://127.0.0.1:${port}`;
const READY_URL = `${BASE_URL}/icon.svg`; // One committed asset the application serves with no store and no session, which is what readiness is judged on.
export const RESET_URL = `${BASE_URL}/api/dev`; // The development-control handler (AAP 0.6.3): the one named control a spec operates before it reads.
const RESET_ACTION = "resetSeed";
const SCOPE_MEMBERS = ["organizationId", "ministryId", "supportSubjectId", "principalId"] as const;
const REPOSITORY_ROOT_MARKERS = ["turbo.json", "bun.lock"] as const; // The two workspace manifests that only the checkout's root holds, which is what makes the root findable from any directory inside it.
const SEED_TIMEOUT_MS = 120_000;
const WORKLOAD_SCRIPT = "scripts/generate-workload.ts"; // The script that generates the published validation workload, which the measurement specs regenerate before they read anything.
const DETAIL_LIMIT = 400; // How much of a response body an error quotes, so a failure is readable without pasting a whole envelope.
export const SESSION_COOKIE = "dashboard_session"; // The development-session cookie's name, mirrored from `modules/store/sessions.ts`: the cookie is the whole identity a request is authorised as.
export type SeededPersonaKind = "coach" | "reader" | "reviewer" | "worker"; // The kinds of seeded identity the roster holds, as a session's persisted persona record states them.
export type PersonaName = "new-worker" | "established-worker" | "second-worker" | "fundraiser" | "coach" | "reviewer" | "reader-public" | "reader-approved-supporter" | "reader-unauthorized" | "subscriber"; // The ten seeded identities a spec may act as, named the way the seed's persona roster names them.
/** One seeded identity: the session its cookie names, and the words the application uses for it. */
export interface SeededPersona {
  readonly sessionId: string; // The seeded session id this persona's `dashboard_session` cookie carries: the identity a spec acts as.
  readonly resetSessionId: string; // The session this runner operates the development reset as for this persona.
  readonly label: string; // The label the development panel and the seeded documents use for this identity.
  readonly kind: SeededPersonaKind;
  readonly description: string; // What this identity is admitted to and may do, in the seed's own words.
}
/** The seeded persona roster, mirrored from `modules/dev-runtime/seed.ts`: one row per persona of that */
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
export const DEFAULT_PERSONA: PersonaName = "established-worker"; // The persona a spec acts as when it names none: the established worker, which the seed makes its default session.
export interface ResetScope extends Record<string, string> {
  readonly organizationId: string; // The four identifiers a mutation claims, in the shape the read envelope states them.
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
}
export interface DevStateEnvelope {
  readonly scope: ResetScope; // The two members of a `GET /api/dev` envelope a reset presents: the authority it ran under and the revision it saw.
  readonly revision: string;
}
type DevStateRead = { readonly kind: "state"; readonly state: DevStateEnvelope } | { readonly kind: "refused"; readonly status: number; readonly outcome: string; readonly detail: string };
export async function resetSeed(request: APIRequestContext, persona: PersonaName = DEFAULT_PERSONA): Promise<void> {
  const resetSessionId = seededPersona(persona).resetSessionId; // Restores the deterministic seed, as the persona the spec names, before a spec reads anything.
  const cookie = cookieHeaderFor(resetSessionId);
  let read = await readDevState(request, cookie);
  if (read.kind === "refused" && read.outcome === "unavailable") {
    seedStoreFromRepository(); // A checkout never seeded holds no session document, so the store is laid down once and the read repeated; any other refusal is reported as it stands.
    read = await readDevState(request, cookie);
  }
  if (read.kind === "refused") throw new Error(`resetSeed could not read the development state as the ${seededPersona(persona).label} persona, whose reset runs as ${resetSessionId}, from ${RESET_URL}: HTTP ${String(read.status)} ${read.outcome} — ${read.detail}`);
  const response = await request.post(RESET_URL, { headers: { cookie }, data: { action: RESET_ACTION, operationId: crypto.randomUUID(), scope: read.state.scope, expectedRevision: read.state.revision, payload: {} } }); // `scope` and `expectedRevision` are the envelope's own and the principal is the session cookie's, so a request never nominates the person it acts for; one fresh operationId per call, because each reset is its own attempt rather than a replay of the last one.
  const text = await response.text();
  const outcome = outcomeOrUndefined(parseJson(text));
  if (!response.ok() || (outcome !== "accepted" && outcome !== "alreadyAccepted")) {
    throw new Error(
      `resetSeed was refused as the ${seededPersona(persona).label} persona, whose reset runs as ${resetSessionId}: HTTP ${String(response.status())} ${outcome ?? "no readable outcome"} — ${detailOf(text)}. A spec that could not restore the seed asserts against a world it did not choose, so it stops here instead of reporting a failure the application did not cause.`,
    );
  }
}
function cookieHeaderFor(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}`; // The `Cookie` header a control's requests carry: the one identity this application authorises a control as.
}
function seededPersona(persona: PersonaName): SeededPersona {
  if (!Object.hasOwn(SEEDED_PERSONAS, persona)) throw new Error(`No seeded persona is named ${JSON.stringify(persona)}. This runner seeds ${Object.keys(SEEDED_PERSONAS).join(", ")}, so a spec states one of those and the reset acts for the session that persona's cookie names.`); // The roster row a persona names, refusing a name the roster does not hold so a mistyped persona cannot reset a session no spec asked for.
  return SEEDED_PERSONAS[persona];
}
async function readDevState(request: APIRequestContext, cookie: string): Promise<DevStateRead> {
  const response = await request.get(RESET_URL, { headers: { cookie } }); // Reads the named persona's development state, reporting a refusal as the outcome it carried.
  const text = await response.text();
  const body = parseJson(text);
  const state = devStateEnvelopeOf(body);
  if (response.ok() && state !== undefined) return { kind: "state", state };
  return { kind: "refused", status: response.status(), outcome: outcomeOrUndefined(body) ?? "unreadable", detail: detailOf(text) };
}
function seedStoreFromRepository(): void {
  const root = repositoryRootFrom(process.cwd()); // Lays the deterministic seed down through the repository's own reset command.
  const seeded = spawnSync("bun", ["run", "reset"], { cwd: root, encoding: "utf8", timeout: SEED_TIMEOUT_MS });
  if (seeded.error !== undefined) throw new Error(`Seeding the synthetic store with \`bun run reset\` could not run: ${seeded.error.message}`);
  if (seeded.status !== 0) throw new Error(`Seeding the synthetic store with \`bun run reset\` exited ${String(seeded.status)}: ${detailOf(seeded.stderr ?? "")}`);
}
export function repositoryRootFrom(startDirectory: string): string {
  let current = startDirectory; // The checkout this runner belongs to: the nearest ancestor of the working directory holding both workspace manifests.
  for (;;) {
    if (REPOSITORY_ROOT_MARKERS.every((marker) => existsSync(join(current, marker)))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`No directory up to the filesystem root from ${JSON.stringify(startDirectory)} holds both ${REPOSITORY_ROOT_MARKERS.join(" and ")}, so this runner cannot find the checkout whose store it has to seed. Run the specs from inside the checkout.`);
    current = parent;
  }
}
/** Regenerates the published validation workload into the established worker's session, refusing a document that does not report the published counts. */
export function ensureWorkload(): void {
  const root = repositoryRootFrom(process.cwd());
  const script = join(root, WORKLOAD_SCRIPT);
  if (!existsSync(script)) throw new Error(`The workload this measurement is taken over is produced by ${WORKLOAD_SCRIPT}, and no such file stands in ${JSON.stringify(root)}. The published dataset is generated rather than committed, so the script is part of the checkout.`);
  let stdout: string;
  try {
    stdout = execFileSync("bun", ["run", "seed:workload"], { cwd: root, encoding: "utf8", stdio: "pipe", timeout: SEED_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`\`bun run seed:workload\` could not generate the published dataset, so nothing is measured or compared over it: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [pattern, stated] of [
    [/partners\s*:\s*10000\b/u, "10,000 partners"],
    [/gifts\s*:\s*100000\b/u, "100,000 gift rows"],
  ] as const) {
    if (!pattern.test(stdout)) throw new Error(`\`bun run seed:workload\` did not report the published ${stated}, so the document behind these figures is not the one the plan names. It reported: ${stdout.replace(/\s+/gu, " ").slice(0, DETAIL_LIMIT)}`);
  }
}
function portFrom(environment: Readonly<Record<string, string | undefined>>): number {
  const stated = environment.PORT;
  if (stated === undefined || stated.trim().length === 0) return DEFAULT_PORT;
  const parsed = Number(stated);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`PORT must be a whole TCP port between 1 and 65535, and this run states ${JSON.stringify(stated)}. State the port this clone was given, so the runner drives the server it starts.`);
  return parsed;
}
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
function isResetScope(value: unknown): value is ResetScope {
  return isRecord(value) && SCOPE_MEMBERS.every((member) => typeof value[member] === "string" && value[member].length > 0);
}
function devStateEnvelopeOf(body: unknown): DevStateEnvelope | undefined {
  if (!isRecord(body) || !isResetScope(body.scope) || typeof body.revision !== "string" || body.revision.length === 0) return undefined;
  return { scope: body.scope, revision: body.revision };
}
export function detailOf(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > DETAIL_LIMIT ? `${collapsed.slice(0, DETAIL_LIMIT)}…` : collapsed;
}
/** One parsed JSON object, as an untyped record whose members are read through the helpers below. */ // Reading the JSON answers every spec captures its evidence from
export type JsonRecord = Record<string, unknown>;
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value); // Whether a parsed answer is a JSON object, which is the shape every envelope this suite reads states.
}
export async function jsonOf(answer: { text(): Promise<string> }, what: string): Promise<unknown> {
  const text = await answer.text(); // A response body as JSON, refusing a body that is not one: an HTML error page is not an answer.
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} did not answer with JSON, so nothing about it can be asserted: ${detailOf(text)}`);
  }
}
export function fieldAt(value: unknown, ...path: readonly string[]): unknown {
  let current: unknown = value; // One member inside a parsed answer, by path, or `undefined` where the path holds nothing.
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}
function envelopeAt(value: unknown, path: readonly string[], what: string): string {
  return `${what} is not at ${path.join(".")} of the answer this runner read, so the assertion would have compared nothing: ${detailOf(JSON.stringify(value))}`; // The members a caller looked for in an answer, quoted compactly, so a refusal names an empty envelope rather than its whole body.
}
export function stringAt(value: unknown, path: readonly string[], what: string): string {
  const found = fieldAt(value, ...path); // A string a capture depends on, refusing an absent or blank one with the path it looked at.
  if (typeof found !== "string" || found.trim() === "") throw new Error(envelopeAt(value, path, what));
  return found;
}
export function numberAt(value: unknown, path: readonly string[], what: string): number {
  const found = fieldAt(value, ...path); // A whole number a capture depends on, refusing anything else with the path it looked at.
  if (typeof found !== "number" || !Number.isSafeInteger(found)) throw new Error(envelopeAt(value, path, what));
  return found;
}
export function recordAt(value: unknown, path: readonly string[], what: string): JsonRecord {
  const found = fieldAt(value, ...path); // An object a capture depends on, refusing anything else with the path it looked at.
  if (!isRecord(found)) throw new Error(envelopeAt(value, path, what));
  return found;
}
export function recordsAt(value: unknown, path: readonly string[], what: string): readonly JsonRecord[] {
  return arrayAt(value, path, what).map((entry, index) => recordAt(entry, [], `${what} at index ${String(index)}`)); // One list of objects: the shape every collection this suite counts arrives in.
}
export function objectOf(value: unknown, subject: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${subject} is not the object this suite expects, so nothing is compared against it.`); // An object a capture is handed directly, refusing anything else with what it was meant to be.
  return value;
}
export function listOf(value: unknown, subject: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${subject} is not a list, so the count this suite reads from it cannot be trusted.`); // A list a capture is handed directly, refusing anything else with what it was meant to be.
  return value;
}
export function textOf(value: unknown, subject: string): string {
  if (typeof value !== "string") throw new Error(`${subject} is not text, so nothing is compared against it.`); // Text a capture is handed directly, refusing anything that is not text.
  return value;
}
export function resetScopeOf(value: unknown): ResetScope {
  const record = objectOf(value, "A scope"); // The four identifiers a scope object states, refusing one that leaves any of them out.
  return {
    organizationId: textOf(record["organizationId"], "A scope's organization reference"),
    ministryId: textOf(record["ministryId"], "A scope's ministry reference"),
    supportSubjectId: textOf(record["supportSubjectId"], "A scope's support-subject reference"),
    principalId: textOf(record["principalId"], "A scope's principal reference"),
  };
}
export function numberOf(value: unknown, subject: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${subject} is not a whole number, so no count is read from it and nothing is compared against it.`); // A whole number a capture is handed directly rather than by path, refusing anything else with what it was meant to be.
  return value;
}
export function arrayAt(value: unknown, path: readonly string[], what: string): readonly unknown[] {
  const found = fieldAt(value, ...path); // A list a capture depends on, refusing anything else with the path it looked at.
  if (!Array.isArray(found)) throw new Error(envelopeAt(value, path, what));
  return found;
}
export function outcomeOf(body: unknown): string {
  return stringAt(body, ["outcome"], "A mutation's outcome"); // The one outcome a mutation answered with, which is the only member that describes what happened.
}
export function outcomeOrUndefined(body: unknown): string | undefined {
  const found = fieldAt(body, "outcome"); // The outcome a body carries, or `undefined` for a body that carries none: the reading of an answer a spec tolerates either way.
  return typeof found === "string" ? found : undefined;
}
export function sendResultFingerprint(body: unknown): string {
  const rows = arrayAt(body, ["data", "rows"], "A send result's rows").map((row) => [fieldAt(row, "recipientId"), fieldAt(row, "state"), fieldAt(row, "renditionId"), fieldAt(row, "dedupeKey")].join("|")); // Every recipient identifier, outcome, rendition and dedupe key a send result states, so "nothing moved" is compared exactly.
  return rows.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join("\n");
}
export function messagesAt(body: unknown, field: string): readonly string[] {
  const stated = fieldAt(body, "fields", field); // The per-field messages an `invalid` outcome keyed at one field path, as the flat list a receipt prints.
  return Array.isArray(stated) ? stated.filter((message): message is string => typeof message === "string") : [];
}
export function newAttemptId(): string {
  return crypto.randomUUID(); // The identifier a caller mints for one attempt: the identity every replay of that attempt is recognised by.
}
function sessionHeaders(sessionId: string | undefined): Readonly<Record<string, string>> | undefined {
  return sessionId === undefined ? undefined : { cookie: cookieHeaderFor(sessionId) }; // The headers a request made for one stated session carries, or none where the context's own cookies are the identity.
}
export function scopeAt(body: unknown, what: string): ResetScope {
  const scope = fieldAt(body, "scope"); // The authority a read or a mutation states it ran under, refusing an answer that names none.
  if (!isResetScope(scope)) throw new Error(`${what} answered without the scope it ran under, so no control or comparison may present it: ${detailOf(JSON.stringify(body))}`);
  return scope;
}
export function authorityOf(body: unknown, what: string): DevStateEnvelope {
  return { scope: scopeAt(body, what), revision: stringAt(body, ["revision"], `${what}'s revision`) }; // The scope and revision a content read presents, which every later compare-and-set on that content repeats.
}
export async function devStateOf(context: APIRequestContext, sessionId?: string): Promise<DevStateEnvelope> {
  const response = await context.get(RESET_URL, { headers: sessionHeaders(sessionId) }); // Reads one session's development state: the scope a control runs under and the revision it saw.
  const body = await jsonOf(response, "GET /api/dev");
  const state = devStateEnvelopeOf(body);
  if (!response.ok() || state === undefined) {
    throw new Error(`GET /api/dev answered HTTP ${String(response.status())} ${outcomeOrUndefined(body) ?? "without an outcome"} for ${sessionId ?? "this context's own session"}, and no control runs without the scope and revision it presents: ${detailOf(JSON.stringify(body))}`);
  }
  return state;
}
export async function operateDevControl(context: APIRequestContext, action: string, payload: JsonRecord, sessionId?: string): Promise<JsonRecord> {
  const state = await devStateOf(context, sessionId); // Operates exactly one named development control, as one stated session, and returns the answer it gave.
  const response = await context.post(RESET_URL, { headers: sessionHeaders(sessionId), data: { action, operationId: newAttemptId(), scope: state.scope, expectedRevision: state.revision, payload } });
  const body = await jsonOf(response, `POST /api/dev ${action}`);
  const outcome = outcomeOrUndefined(body);
  if (outcome !== "accepted" && outcome !== "unchanged" && outcome !== "alreadyAccepted") throw new Error(`The development control ${action} was refused as ${sessionId ?? "this context's own session"}: HTTP ${String(response.status())} ${outcome ?? "no readable outcome"} — ${detailOf(JSON.stringify(body))}`);
  return isRecord(body) ? body : {};
}
export async function setClock(context: APIRequestContext, offsetIso: string, sessionId?: string): Promise<void> {
  await operateDevControl(context, "setClock", { offsetIso }, sessionId); // Moves one session's scenario clock to one instant, which is how a window boundary is reached without waiting.
}
export async function setFailurePlan(context: APIRequestContext, plan: JsonRecord, sessionId?: string): Promise<void> {
  await operateDevControl(context, "setFailurePlan", plan, sessionId); // Arms or clears one session's failure plan, which is how a lost acknowledgement is demonstrated.
}
export async function clearFailurePlan(context: APIRequestContext, sessionId?: string): Promise<void> {
  await setFailurePlan(context, { plan: null }, sessionId); // Clears one session's failure plan, so the plan a later test starts from is the one the reset lays down.
}
export async function armLostAcknowledgement(context: APIRequestContext, mutationName: string, sessionId?: string): Promise<void> {
  await setFailurePlan(context, { mode: "unknown", target: { kind: "mutation", name: mutationName } }, sessionId); // Arms the lost acknowledgement on one named mutation.
}
export async function readJson(context: APIRequestContext, path: string, sessionId?: string): Promise<unknown> {
  const response = await context.get(path, { headers: sessionHeaders(sessionId) }); // Reads one of the application's own browser-facing reads as one stated session, refusing a refusal.
  const body = await jsonOf(response, `GET ${path}`);
  if (!response.ok()) throw new Error(`The read ${path} answered HTTP ${String(response.status())}: ${detailOf(JSON.stringify(body))}. A figure no read states is a figure no spec can compare.`);
  return body;
}
/** The persistent label the shell states on every surface: the records a spec reads are synthetic. */ // The surfaces every spec reaches through the shell
export const DEVELOPMENT_DATA_LABEL = "Development data";
/** Admits one seeded session on the page's own context: the cookie is the whole identity every request is authorised as. */
export async function actAs(page: Page, sessionId: string): Promise<void> {
  await page.context().clearCookies(); // The jar is cleared first, so a cookie left by another identity is never sent beside this one: one request, one identity, and every later read is authorised again from this value.
  await page.context().addCookies([{ name: SESSION_COOKIE, value: sessionId, url: BASE_URL }]);
}
export function sessionCookie(sessionId: string): string {
  return cookieHeaderFor(sessionId); // The `Cookie` header one seeded session's request carries, for a read made without a page.
}
export async function openSurface(page: Page, linkName: string, heading: string): Promise<void> {
  await page.getByRole("link", { name: linkName, exact: true }).click(); // Opens one surface by operating the shell's own navigation, and states that the surface it opened is the one expected.
  await expect(page.getByRole("heading", { level: 1, name: heading }), `The shell's ${linkName} link opens the ${heading} surface.`).toBeVisible();
}
export function receiptIn(scope: Page | Locator): Locator {
  return scope.locator('[data-slot="operation-result"]'); // The durable receipt of one settled mutation, as the component inside a stated scope states it.
}
export async function expectAcceptedReceipt(scope: Page | Locator, where: string): Promise<void> {
  const receipt = receiptIn(scope); // Asserts one settled mutation left the durable `accepted` receipt rather than a toast.
  await expect(receipt, `The ${where} reports its own outcome, and it is the durable receipt rather than a toast.`).toHaveAttribute("data-outcome", "accepted");
  await expect(receipt.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
}
const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const; // The tag set the audit runs: WCAG 2.2 level AA, with the level A and 2.1 rules it builds on.
export type AccessibilityAudit = Awaited<ReturnType<AxeBuilder["analyze"]>>; // What one accessibility audit answers, in the shape `@axe-core/playwright` produces it.
export type AccessibilityViolation = AccessibilityAudit["violations"][number]; // One rule an audit found a page violating, with the nodes that broke it.
export function blockingAccessibilityViolations(audit: AccessibilityAudit): readonly AccessibilityViolation[] {
  return audit.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious"); // The serious and critical violations of an audit: the ones a pass may not carry, minor and moderate findings excluded.
}
/** The persistent label this application states on every surface, asserted wherever a surface is read. */ // The keyboard, reflow, target-size, motion, zoom and audit harness criterion 20 measures with
export async function expectDevelopmentData(page: Page, surface: string): Promise<void> {
  await expect(page.getByText(DEVELOPMENT_DATA_LABEL, { exact: true }).first(), `${surface} states the persistent Development data label, so no screen of this application can be mistaken for production.`).toBeVisible();
}
export interface FocusReading {
  readonly ok: boolean; // What one look at the focused element answers: whether a keyboard user can see it and reach it, and what it is called.
  readonly name: string;
  readonly reason: string;
}
/** Reads the element that currently holds focus. */
export async function readFocus(page: Page): Promise<FocusReading> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) return { ok: false, name: "", reason: "no control holds focus" };
    const labelledBy = active.getAttribute("aria-labelledby");
    const labelledByText = labelledBy === null ? "" : (document.getElementById(labelledBy)?.textContent ?? "");
    const boundLabel = active.id === "" ? "" : (document.querySelector(`label[for="${CSS.escape(active.id)}"]`)?.textContent ?? "");
    const stated = active.getAttribute("aria-label") ?? (labelledByText.trim() === "" ? "" : labelledByText);
    const own = active.textContent ?? "";
    const name = (stated.trim() === "" ? boundLabel.trim() || own.replace(/\s+/gu, " ").trim() : stated.trim()) || active.getAttribute("placeholder") || "";
    const shortened = name.length > 80 ? `${name.slice(0, 80)}…` : name;
    const tag = active.tagName.toLowerCase();
    const rect = active.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { ok: false, name: shortened, reason: `${tag} has no rendered box` };
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return { ok: false, name: shortened, reason: `${tag} sits outside the viewport` };
    // Five points inside the element: one of them must reach it, so a partly overlapped control is still reported as reachable while a covered one is not.
    const samples: readonly (readonly [number, number])[] = [
      [0.5, 0.5],
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
    ];
    const reachable = samples.some(([across, down]) => {
      const x = Math.min(Math.max(rect.left + rect.width * across, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height * down, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === active || active.contains(hit) || hit.contains(active));
    });
    if (!reachable) {
      const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      const blocker = hit === null ? "nothing" : `${hit.tagName.toLowerCase()}${hit.id === "" ? "" : `#${hit.id}`}`;
      return { ok: false, name: shortened, reason: `${tag} is covered by ${blocker}` };
    }
    return { ok: true, name: shortened, reason: "" };
  });
}
export async function expectFocusVisibleAndUnobscured(page: Page, step: string): Promise<FocusReading> {
  let reading = await readFocus(page); // Asserts the focused control is visible and not covered, naming the step that left focus where it is.
  for (let attempt = 2; attempt <= FOCUS_READ_ATTEMPTS && !reading.ok; attempt += 1) {
    await settleLayout(page); // A focus change and its style apply asynchronously, so the reading is retaken once the layout settles, a bounded number of times; a control that stays covered fails on the last.
    reading = await readFocus(page);
  }
  expect(reading.ok, `${step}: the focused control must be visible and unobscured (WCAG 2.4.11), and ${reading.name === "" ? "no control" : JSON.stringify(reading.name)} was ${reading.reason}.`).toBe(true);
  return reading;
}
/** Asserts every scroll container carries the offset that keeps a focused control clear of the sticky shell. */
export async function expectScrollPaddingSet(page: Page, surface: string): Promise<void> {
  const paddings = await page.evaluate(() => {
    const ports = [document.documentElement, document.getElementById("main-content")].filter((element): element is HTMLElement => element instanceof HTMLElement);
    return ports.map((element) => window.getComputedStyle(element).scrollPaddingBlockStart);
  });
  expect(paddings.length, `${surface} states the scroll ports whose padding is read.`).toBeGreaterThan(0);
  for (const padding of paddings) expect(Number.parseFloat(padding), `${surface}: every scroll port states a scroll-padding-block-start (${JSON.stringify(padding)}), so a focused control is scrolled clear of the sticky shell rather than under it.`).toBeGreaterThan(0);
}
/** Waits for the layout to settle after a state change, so a reading describes the page a person actually sees. */
export async function settleLayout(page: Page): Promise<void> {
  // The frame limit travels as an argument, not as a closure over a module constant: this function is serialised into the page, where the module's bindings do not exist.
  await page.evaluate(
    (limit: number) =>
      new Promise<void>((resolve) => {
        let previous = "";
        let stableFrames = 0;
        const step = (attempt: number): void => {
          const active = document.activeElement;
          const box = active instanceof Element ? active.getBoundingClientRect() : null;
          const signature = box === null ? "" : `${box.x.toFixed(1)},${box.y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}`;
          stableFrames = signature !== "" && signature === previous ? stableFrames + 1 : 0;
          previous = signature;
          if (stableFrames >= 2 || attempt >= limit) {
            resolve();
            return;
          }
          requestAnimationFrame(() => {
            step(attempt + 1);
          });
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            step(0);
          });
        });
      }),
    SETTLE_ATTEMPT_LIMIT,
  );
}
/** Focuses a control without a pointer, proves the focus landed, and then operates it from the keyboard alone. */
export async function pressFromKeyboard(page: Page, control: Locator, step: string, key: "Enter" | " " = "Enter"): Promise<void> {
  await control.scrollIntoViewIfNeeded(); // A keyboard user reaches a control by tabbing to it and the browser scrolls it into view, so it is checked where a keyboard user would meet it.
  await control.focus();
  await expect(control, `${step}: the control takes focus, so the keyboard is enough to reach it.`).toBeFocused();
  await settleLayout(page);
  await expectFocusVisibleAndUnobscured(page, step);
  await page.keyboard.press(key);
}
export async function typeFromKeyboard(page: Page, control: Locator, text: string, step: string): Promise<void> {
  await control.scrollIntoViewIfNeeded(); // Focuses a text control and types into it a character at a time, replacing whatever it held.
  await control.focus();
  await expect(control, `${step}: the field takes focus, so the keyboard is enough to fill it.`).toBeFocused();
  await settleLayout(page);
  await expectFocusVisibleAndUnobscured(page, step);
  await page.keyboard.press("ControlOrMeta+a");
  if (text === "") {
    await page.keyboard.press("Delete");
    return;
  }
  await page.keyboard.type(text);
  await expect(control, `${step}: the field holds the characters the keyboard typed.`).toHaveValue(text);
}
/** Walks the tab order of the surface on screen, proving each stop is visible and unobscured, and ending early on the control a caller names. */
export async function sweepTabOrder(page: Page, surface: string, steps: number, until?: string): Promise<readonly string[]> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const names: string[] = [];
  for (let step = 1; step <= steps; step += 1) {
    await page.keyboard.press("Tab");
    await settleLayout(page);
    const reading = await expectFocusVisibleAndUnobscured(page, `${surface}: Tab stop ${String(step)}`);
    names.push(reading.name);
    if (until !== undefined && reading.name === until) break;
  }
  await page.keyboard.press("Shift+Tab"); // One `Shift+Tab` proves the path runs backwards too, and lands on a control the forward sweep already met.
  await settleLayout(page);
  await expectFocusVisibleAndUnobscured(page, `${surface}: Shift+Tab returns along the same path`);
  return names;
}
/** Asserts focus is still inside the open dialog's own layer. */
export async function expectFocusInsideDialog(picker: Locator, step: string): Promise<void> {
  const inside = await picker.evaluate((dialog: Element) => {
    const active = document.activeElement;
    const layer = dialog.parentElement?.closest("[data-slot$='-portal']") ?? dialog;
    return active !== null && (layer === active || layer.contains(active));
  });
  expect(inside, step).toBe(true);
}
// Reflow: the page never scrolls sideways, and a table's own region is the only port that may
export interface ReflowReading {
  readonly scrollWidth: number; // What the document's own scroller states: the content it holds, the width it shows, and the viewport it is in.
  readonly clientWidth: number;
  readonly viewportWidth: number;
}
export async function readReflow(page: Page): Promise<ReflowReading> {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, viewportWidth: window.innerWidth }));
}
export async function expectNoHorizontalPageScroll(page: Page, surface: string): Promise<void> {
  const reading = await readReflow(page); // Asserts the page itself does not scroll horizontally, which is the reflow obligation at 320 CSS px and at 200 % zoom.
  expect(
    reading.scrollWidth,
    `${surface} must not scroll horizontally (WCAG 1.4.10 Reflow): the document holds ${String(reading.scrollWidth)} CSS px of content in a ${String(reading.clientWidth)} px viewport (${String(reading.viewportWidth)} px of window), so ${String(reading.scrollWidth - reading.clientWidth)} px would have to be reached by scrolling sideways.`,
  ).toBeLessThanOrEqual(reading.clientWidth + 1);
}
export interface AncestorOverflow {
  readonly element: string; // One element between the page and a scroll region: what it is, and how much of it overflows sideways.
  readonly overflowX: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}
export async function expectSoleHorizontalScroller(page: Page, region: Locator, surface: string): Promise<void> {
  await expect(region, `${surface} renders its table inside the one scroll region.`).toHaveAttribute("tabindex", "0"); // Asserts one named table region is the only horizontal scroll port on the surface.
  await expect(region, `${surface} names the scroll region it renders, so it is a labelled landmark.`).toHaveAttribute("aria-label", /, scrollable$/u);
  const measured = await region.evaluate((element: Element) => {
    const style = window.getComputedStyle(element);
    const ancestors: AncestorOverflow[] = [];
    let current = element.parentElement;
    while (current !== null) {
      const ancestorStyle = window.getComputedStyle(current);
      ancestors.push({ element: current.tagName.toLowerCase(), overflowX: ancestorStyle.overflowX, scrollWidth: current.scrollWidth, clientWidth: current.clientWidth });
      current = current.parentElement;
    }
    return { overflowX: style.overflowX, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, ancestors };
  });
  expect(measured.overflowX, `${surface}: the scroll region is the element that owns the horizontal gesture.`).toMatch(/^(?:auto|scroll)$/u);
  for (const ancestor of measured.ancestors) {
    expect(ancestor.scrollWidth, `${surface}: no ancestor outside the table's own region may scroll horizontally, and ${ancestor.element} (overflow-x: ${ancestor.overflowX}) holds ${String(ancestor.scrollWidth)} px of content in ${String(ancestor.clientWidth)} px.`).toBeLessThanOrEqual(ancestor.clientWidth + 1);
  }
}
/** One control that rendered below the 24×24 CSS px floor, with whether its spacing saves it. */ // Target size (2.5.8) and motion (2.3.3 / reduced motion): the two floors a control can miss
export interface UndersizedTarget {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly spaced: boolean;
}
/** Measures every control inside one named scope against the 24×24 CSS px floor. */
export async function measureUndersizedTargets(scope: Locator, floor: number): Promise<readonly UndersizedTarget[]> {
  return scope.evaluate(
    (root: Element, limits: { readonly floor: number; readonly minimumBox: number }) => {
      const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="checkbox"], [role="radio"], [role="tab"], [role="switch"], [tabindex="0"]';
      const boxes = Array.from(root.querySelectorAll(selector))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const stated = element.getAttribute("aria-label") ?? element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
          const label = stated.length > 60 ? `${stated.slice(0, 60)}…` : stated === "" ? element.tagName.toLowerCase() : stated;
          return { rect, label, measurable: style.visibility !== "hidden" && style.display !== "none" && rect.width >= limits.minimumBox && rect.height >= limits.minimumBox };
        })
        .filter((entry) => entry.measurable);
      const centre = (rect: DOMRect): { readonly x: number; readonly y: number } => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      const undersized: UndersizedTarget[] = [];
      for (const entry of boxes) {
        if (entry.rect.width >= limits.floor && entry.rect.height >= limits.floor) continue;
        const own = centre(entry.rect);
        const spaced = boxes.every((other) => {
          if (other.rect === entry.rect) return true;
          const theirs = centre(other.rect);
          return Math.hypot(theirs.x - own.x, theirs.y - own.y) >= limits.floor - 0.5;
        });
        undersized.push({ label: entry.label, width: Math.round(entry.rect.width * 10) / 10, height: Math.round(entry.rect.height * 10) / 10, spaced });
      }
      return undersized;
    },
    { floor, minimumBox: PROXY_CONTROL_BOX_PX },
  );
}
export async function expectTargetSizeFloor(page: Page, scope: Locator, surface: string, testInfo: TestInfo): Promise<void> {
  const undersized = await measureUndersizedTargets(scope, TARGET_FLOOR_PX); // Asserts no control in the scope is below the target floor without the spacing exception, and reports the ones the exception saves.
  const failing = undersized.filter((target) => !target.spaced);
  const saved = undersized.filter((target) => target.spaced);
  if (saved.length > 0) {
    await testInfo.attach(`${surface} — controls under 24 px saved by spacing`, { body: JSON.stringify({ surface, floor: TARGET_FLOOR_PX, spacing: TARGET_SPACING_PX, saved }, null, 2), contentType: "application/json" }); // Reported rather than loosened: a control under the floor relied on the spacing exception, and that reliance belongs in the report so a later layout change re-measures it.
  }
  expect(
    failing.map((target) => `${target.label} (${String(target.width)}×${String(target.height)} px)`),
    `${surface}: every control is at least ${String(TARGET_FLOOR_PX)}×${String(TARGET_FLOOR_PX)} CSS px or satisfies the spacing exception (WCAG 2.5.8)${saved.length === 0 ? "" : `, and ${String(saved.length)} control(s) below the floor relied on the spacing exception`}.`,
  ).toEqual([]);
}
export interface MotionReading {
  readonly slowestSeconds: number; // The slowest motion one scope's controls declare, in seconds, with the control that declares it.
  readonly control: string;
}
/** Reads the longest transition and animation a scope's controls declare. */
export async function readLongestMotion(scope: Locator): Promise<MotionReading> {
  return scope.evaluate((root: Element) => {
    const secondsOf = (value: string): number => {
      let longest = 0;
      for (const part of value.split(",")) {
        const text = part.trim();
        const parsed = Number.parseFloat(text);
        if (!Number.isFinite(parsed)) continue;
        longest = Math.max(longest, text.endsWith("ms") ? parsed / 1000 : parsed);
      }
      return longest;
    };
    let slowest = 0;
    let control = "";
    const controls = Array.from(root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')).slice(0, 60);
    for (const element of controls) {
      if (!(element instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(element);
      const duration = Math.max(secondsOf(style.transitionDuration), secondsOf(style.animationDuration));
      if (duration > slowest) {
        slowest = duration;
        const stated = element.getAttribute("aria-label") ?? element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
        control = stated.length > 60 ? `${stated.slice(0, 60)}…` : stated === "" ? element.tagName.toLowerCase() : stated;
      }
    }
    return { slowestSeconds: slowest, control };
  });
}
/** One audited surface, so the report names what was read and the test can assert all five ran. */ // The WCAG 2.2 AA audit
export const auditedSurfaces: string[] = [];
/** The readable account one attached finding carries: the rule, its impact, the nodes and the help it points at. */
export function violationSummary(violations: readonly AccessibilityViolation[]): string {
  return JSON.stringify(
    violations.map((violation) => ({ id: violation.id, impact: violation.impact ?? "unstated", help: violation.help, helpUrl: violation.helpUrl, nodes: violation.nodes.slice(0, ATTACHED_NODE_LIMIT).map((node) => ({ target: node.target, summary: node.failureSummary })), nodeCount: violation.nodes.length })),
    null,
    2,
  );
}
export async function auditSurface(page: Page, testInfo: TestInfo, surface: string): Promise<void> {
  const audit: AccessibilityAudit = await new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]).analyze(); // Audits one surface against WCAG 2.2 AA, attaches every finding of any impact, and fails on anything serious or critical.
  const url = page.url();
  const blocking = blockingAccessibilityViolations(audit);
  await testInfo.attach(`axe — ${surface}`, { body: JSON.stringify({ surface, url, tags: [...WCAG_22_AA_TAGS], blocking: violationSummary(blocking), all: violationSummary(audit.violations), passes: audit.passes.length }, null, 2), contentType: "application/json" });
  expect(
    blocking.map((violation) => `${violation.id} (${violation.impact ?? "unstated"}) at ${String(violation.nodes.length)} node(s) — ${violation.help}`),
    `${surface} (${url}) must hold no serious or critical WCAG 2.2 AA violation. Findings of any impact were attached to this report.`,
  ).toEqual([]);
  auditedSurfaces.push(surface);
  testInfo.annotations.push({ type: `axe ${surface}`, description: `${url} — ${String(blocking.length)} serious or critical violation(s), ${String(audit.violations.length)} finding(s) at any impact across ${String(audit.passes.length)} passing rule(s).` }); // The outcome is recorded on the test as well as attached, so the report states which surface was read, how many rules passed and what was found at any impact.
}
/** Asserts a text element renders all of its own content, rather than clipping it to a fixed box. */
export async function expectTextNotClipped(scope: Locator, surface: string): Promise<void> {
  const clipped = await scope.evaluate((root: Element) => {
    const elements = [root, ...Array.from(root.querySelectorAll("h1, h2, p, output, label"))].filter((element): element is HTMLElement => element instanceof HTMLElement).slice(0, 40);
    const findings: { readonly element: string; readonly overflow: number }[] = [];
    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) {
        continue; // A visually hidden element (the `sr-only` technique) is a one-pixel clipped box on purpose: it is written for a screen reader, not for a zoomed reader.
      }
      const hidesOverflow = style.overflowX === "hidden" || style.overflowX === "clip";
      if (!hidesOverflow) continue;
      const overflow = element.scrollWidth - element.clientWidth;
      if (overflow > 1) findings.push({ element: `${element.tagName.toLowerCase()}: ${element.textContent?.replace(/\s+/gu, " ").trim().slice(0, 40) ?? ""}`, overflow });
    }
    return findings;
  });
  expect(
    clipped.map((finding) => `${finding.element} (+${String(finding.overflow)} px)`),
    `${surface}: text is wrapped or reflowed rather than clipped, so a zoomed reader is not shown a cut-off line.`,
  ).toEqual([]);
}
const TARGET_FLOOR_PX = 24; // The 24×24 CSS px floor of WCAG 2.2 Target Size Minimum (2.5.8), and the diameter its spacing exception is measured in.
const TARGET_SPACING_PX = 24;
const PROXY_CONTROL_BOX_PX = 4; // The smallest box that counts as a control a person can target: the design system's one-pixel proxy is not it.
const FOCUS_READ_ATTEMPTS = 3; // How many settled readings a focus check takes before it reports the control as obscured.
const SETTLE_ATTEMPT_LIMIT = 12; // How many frames a settle waits at most, so a control that never stops moving is reported rather than waited on forever.
const ATTACHED_NODE_LIMIT = 5; // How many offending nodes one attached finding names, so the report is readable rather than exhaustive.
/** The fixtures a spec reaches the application through. */
type RunnerFixtures = {
  persona: PersonaName; // The seeded identity this test acts as.
  seedReset: void; // The automatic fixture that admits the persona and restores the seed before the test body runs.
};
/** The runner every spec imports, carrying the seeded persona and the reset it is admitted under. */
export const test = base.extend<RunnerFixtures>({
  persona: [DEFAULT_PERSONA, { option: true }],
  seedReset: [
    async ({ persona, context, request }, use) => {
      const seeded = seededPersona(persona);
      await context.addCookies([{ name: SESSION_COOKIE, value: seeded.sessionId, url: BASE_URL }]); // The cookie is the whole identity: `src/proxy.ts` mints it and `data-service/authorize.ts` resolves it into a principal and its memberships, so a context carrying this persona's session id makes the page act as that persona.
      await resetSeed(request, persona);
      await use();
    },
    { auto: true },
  ],
});
export { expect };
const PAGE_FILE = "page.tsx"; // The file the app router turns into a page address.
const UNROUTED_SEGMENT = /^(?:\([^)]*\)|_.*|@.*)$/u; // A router segment that is part of no URL: a route group, a private folder or a parallel slot.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  globalSetup: "./e2e/route-warmup.ts", // Every route is asked for once, before the first test: the development server compiles a route on its first request and answers it by reloading, which would race a journey whose first navigation is that compile.
  fullyParallel: false, // One stateful store carries the scenario, the clock offset and the armed failure plan, so two specs beside each other would race on all three: serial execution is what makes the browser tests evidence.
  workers: 1,
  retries: 0, // A retry turns a determinism defect into a passing run, and every criterion is meant to pass on its first attempt from a reset seed.
  forbidOnly: !!process.env.CI, // A focused or skipped test committed to the branch would silently narrow the suite, so CI refuses one.
  reporter: [["list"], ["html", { open: "never" }]], // The list keeps a failing spec readable in the terminal; the HTML report holds the attachments a failure is diagnosed from, under a git-ignored directory.
  timeout: 180_000, // The whole-query criterion runs a full 100,000-row export inside one test, so a journey is bounded well above the default 30 s rather than imposing a limit the export would fail.
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure", // The evidence a failure is read from, kept only when something failed. No video: no criterion is verified from one.
    screenshot: "only-on-failure",
    video: "off",
    reducedMotion: "reduce", // Criterion 20's reduced-motion pass: every retained job still completes with motion suppressed.
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }], // One project, one browser (AAP 0.9.2). The 320 px, keyboard, 200% zoom and reduced-motion passes are set per test inside the accessibility spec.
  webServer: {
    command: "bun run dev", // The application as the workspace runs it, so the suite exercises the command a person runs.
    url: READY_URL, // Readiness is one committed asset rather than a page or a read: a read answers 503 until the store is seeded and a route may be mid-compile, so probing either would stall startup on the state the first spec's reset exists to create.
    env: { PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" },
    reuseExistingServer: !process.env.CI, // Outside CI a server already listening on this clone's port is reused; in CI it never is, so a stale server cannot stand in for the build under test.
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
export function statedAmountOf(text: string, subject: string): StatedAmount {
  const collapsed = text.replace(/\s+/gu, " ").trim(); // The exact minor units a displayed amount states.
  const state = AMOUNT_STATE_WORDS.find((word) => collapsed.includes(word));
  if (state !== undefined) throw new Error(`${subject} states ${JSON.stringify(state)} rather than an amount (${JSON.stringify(collapsed.slice(0, 200))}). That is a state, not a zero, so this file does not total it.`);
  const match = AMOUNT_IN_TEXT.exec(collapsed);
  if (match === null) throw new Error(`${subject} states ${JSON.stringify(collapsed.slice(0, 200))}, which is not an amount with a currency this file can read. No exponent is assumed in its place.`);
  const [, whole = "", fraction = "", currency = ""] = match;
  const digits = `${whole.replace(/,/gu, "")}${fraction}`;
  const negative = digits.startsWith("-");
  const units = Number(negative ? digits.slice(1) : digits);
  if (!/^-?\d+$/u.test(digits) || !Number.isSafeInteger(units)) throw new Error(`${subject} states ${JSON.stringify(collapsed.slice(0, 200))}, whose digits are not an exact count of minor units. An amount that cannot be read exactly is not compared approximately.`);
  return { currency, minorUnits: negative ? -units : units };
}
export async function listTotalOf(page: Page, noun: string): Promise<number> {
  const line = (await page.locator('[data-slot="pagination-bar"] output').first().innerText()).replace(/\s+/gu, " ").trim(); // The whole-result count one list's pager states, read from the "Showing 1–N of M <noun>" line it renders.
  const match = /^Showing\s+([\d,]+)\s*\u2013\s*[\d,]+\s+of\s+([\d,]+)\s+(\S+)$/u.exec(line);
  if (match === null || match[3] !== noun) throw new Error(`The ${noun} list states its whole result as "Showing 1–N of M ${noun}", and it read ${JSON.stringify(line)} instead. A count this suite cannot read would leave the whole query unchecked.`);
  return countOf(match[2] ?? "", `The whole-result ${noun} count`);
}
export function countOf(text: string, subject: string): number {
  const digits = text.replace(/,/gu, "").trim(); // A whole count a surface states, with the grouping its locale formats it in removed and nothing else changed.
  const value = Number(digits);
  if (!/^\d+$/u.test(digits) || !Number.isSafeInteger(value)) throw new Error(`${subject} states ${JSON.stringify(text)}, which is not a whole count this file can compare.`);
  return value;
}
export function sumOf(amounts: readonly number[], subject: string): number {
  let total = 0; // The exact sum of some minor-unit counts, refused rather than silently rounded past the range of an exact integer.
  for (const amount of amounts) {
    total += amount;
    if (!Number.isSafeInteger(total)) throw new Error(`${subject} sums past the range of an exact integer, so no total is stated for it.`);
  }
  return total;
}
export function expectSameAmount(actual: StatedAmount, expected: StatedAmount, comparison: string): void {
  expect({ currency: actual.currency, minorUnits: actual.minorUnits }, comparison).toEqual({ currency: expected.currency, minorUnits: expected.minorUnits }); // States one comparison of two exact amounts so that a failure quotes both surfaces rather than two numbers.
}
export function isInert(cell: string): boolean {
  const [first] = cell; // Whether a CSV cell is inert: it does not begin with a character a spreadsheet would open as a formula, or it carries the writer's neutralising tab.
  if (first === undefined) return true;
  return first === NEUTRALISER || !DANGEROUS_LEADING_CHARS.includes(first);
}
export function withoutNeutraliser(cell: string): string {
  return cell.startsWith(NEUTRALISER) ? cell.slice(NEUTRALISER.length) : cell; // A CSV cell with the writer's neutralising tab removed, so a number it holds is read as the writer stated it.
}
export async function csvTextOf(download: Download): Promise<string> {
  const stream = await download.createReadStream(); // The text of one downloaded file, decoded as the UTF-8 the writer states in its own content type.
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(new Uint8Array(chunk as Uint8Array));
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
export function csvFileOf(text: string, subject: string): CsvFile {
  const records: string[][] = parse(text, { bom: true, relax_column_count: true }); // One CSV download parsed with the one parser the application fixes.
  const metadata = new Map<string, string>();
  let header: readonly string[] | undefined;
  const body: string[][] = [];
  for (const record of records) {
    const [first, second, third] = record;
    if (first === undefined || first.trim() === "") continue;
    if (first === CSV_META) {
      if (second === undefined || third === undefined) throw new Error(`${subject} holds a metadata record that does not state a field and a value: ${JSON.stringify(record)}`);
      metadata.set(second, third);
      continue;
    }
    if (header === undefined) {
      header = record;
      continue;
    }
    body.push(record);
  }
  const columns = header;
  if (columns === undefined) throw new Error(`${subject} holds no column header record, so no row of it can be read by name.`);
  const rows: Record<string, string>[] = [];
  for (const record of body) {
    if (record.length !== columns.length) throw new Error(`${subject} holds a row of ${String(record.length)} fields where its header states ${String(columns.length)}: ${JSON.stringify(record).slice(0, DETAIL_LIMIT)}`);
    const row: Record<string, string> = {};
    for (const [index, name] of columns.entries()) row[name] = record[index] ?? "";
    rows.push(row);
  }
  return { metadata, header: columns, rows };
}
export function metadataOf(file: CsvFile, field: string, subject: string): string {
  const value = file.metadata.get(field); // One metadata record of a CSV file, refused rather than defaulted when the file does not state it.
  if (value === undefined) throw new Error(`${subject} states no ${JSON.stringify(field)} metadata record, so the snapshot it holds cannot be identified. It states ${[...file.metadata.keys()].join(", ")}.`);
  return value;
}
export async function printedColumnAmounts(region: Locator, columnLabel: string): Promise<readonly number[]> {
  const headers = (await region.locator("table thead th").allInnerTexts()).map((text) => text.replace(/\s+/gu, " ").trim()); // The signed minor-unit amounts of one column of a printed table, read from the exponent each amount displays.
  const column = headers.indexOf(columnLabel);
  if (column === -1) throw new Error(`The printed table states no ${JSON.stringify(columnLabel)} column, so its rows cannot be summed: it states ${headers.join(", ")}.`);
  const rows = region.locator("table tbody tr");
  const stated = await rows.count();
  const amounts: number[] = [];
  for (let row = 0; row < stated; row += 1) {
    const cell = (await rows.nth(row).locator("td").nth(column).innerText()).replace(/\s+/gu, " ").trim();
    amounts.push(statedAmountOf(cell, `The printed page's ${columnLabel} cell of row ${String(row)}`).minorUnits);
  }
  return amounts;
}
export function rowMinorUnitsOf(file: CsvFile, row: Readonly<Record<string, string>>, index: number): number {
  const cell = row["amount_minor_units"]; // The exact minor units one CSV row states, read from the column the writer states them in.
  if (cell === undefined) throw new Error(`The CSV header states no amount_minor_units column, so no row's amount is read exactly: ${file.header.join(", ")}`);
  const stated = withoutNeutraliser(cell).trim();
  const value = Number(stated);
  if (!/^-?\d+$/u.test(stated) || !Number.isSafeInteger(value)) {
    throw new Error(`Row ${String(index)} of the export states ${JSON.stringify(cell)} as its amount_minor_units, which is not an exact count of minor units. A value that is not a number is stated as its own word, and this file does not read a word as a zero.`);
  }
  return value;
}
export const CSV_META = "#meta"; // The one document key the CSV writer puts on every metadata record (`export/csv.ts`).
/** The metadata field names this file reads, each stated once so a renamed field fails one assertion rather than five. */
export const CSV_FIELD = {
  grain: "grain",
  basis: "basis",
  currency: "currency",
  periodFrom: "period_from",
  periodTo: "period_to",
  periodState: "period_state",
  coverageState: "coverage_state",
  snapshotAsOf: "snapshot_as_of",
  snapshotQuery: "snapshot_query",
  rowTotal: "row_total",
  amountUnit: "amount_unit",
  page: "page",
} as const;
export const DANGEROUS_LEADING_CHARS: readonly string[] = ["=", "+", "-", "@", "\t", "\r", "\n", "\uFF1D", "\uFF0B", "\uFF0D", "\uFF20"]; // The characters a spreadsheet may treat as the start of a formula, plus the neutraliser the writer
export const NEUTRALISER = "\t";
export interface StatedAmount {
  readonly currency: string; // One exact amount as a surface states it: the currency the source named, and its integer minor units.
  readonly minorUnits: number;
}
export interface CsvFile {
  readonly metadata: ReadonlyMap<string, string>; // One parsed CSV file: its metadata records, its one column header record and its authorised rows.
  readonly header: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}
export const AMOUNT_IN_TEXT = /(-?\d[\d,]*)(?:[.,](\d+))?\s+([A-Z]{2,})\b/u; // An amount as a surface displays it: an optional sign, thousands groups, an optional fraction whose
export const AMOUNT_STATE_WORDS: readonly string[] = ["Unknown amount", "Withheld", "Source unavailable", "No recorded value"]; // The words a surface uses where a value is not a number. They are states, and never read as a zero.
const TRANSPORT_SEGMENT = "api"; // The one router segment that answers requests rather than documents.
const ORIGIN = new URL(RESET_URL).origin; // The origin the router inventory judges addresses against: this clone's own server.
export function pageRoutesUnder(directory: string, segments: readonly string[]): readonly string[] {
  const entries = readdirSync(directory, { withFileTypes: true }); // Every page template the router serves, read from the router itself.
  const routed = segments.filter((segment) => !UNROUTED_SEGMENT.test(segment));
  const here = entries.some((entry) => entry.isFile() && entry.name === PAGE_FILE) ? [`/${routed.join("/")}`] : [];
  const nested = entries.filter((entry) => entry.isDirectory() && !UNROUTED_SEGMENT.test(entry.name) && entry.name !== TRANSPORT_SEGMENT).flatMap((entry) => pageRoutesUnder(join(directory, entry.name), [...segments, entry.name]));
  return [...here, ...nested];
}
export function segmentsOf(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment !== ""); // The segments of an address, with the separators and any trailing slash dropped.
}
export function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]"); // Whether a template segment accepts any value: the router's own `[name]` form, and nothing else.
}
export function matchesTemplate(template: string, path: string): boolean {
  const expected = segmentsOf(template); // Whether one concrete address is an instance of one template: same depth, and a literal match wherever the template is literal.
  const actual = segmentsOf(path);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => isDynamicSegment(segment) || segment === actual[index]);
}
export function templateOf(path: string, templates: readonly string[]): string | undefined {
  let match: { readonly template: string; readonly literals: number } | undefined; // The template a concrete address instantiates, or nothing when it instantiates none of them.
  for (const template of templates) {
    if (!matchesTemplate(template, path)) continue;
    const literals = segmentsOf(template).filter((segment) => !isDynamicSegment(segment)).length;
    if (match === undefined || literals > match.literals) match = { template, literals };
  }
  return match?.template;
}
export function pathnameOf(address: string): string {
  const parsed = new URL(address, ORIGIN); // The path an address names, without its origin, its query or its trailing slash: the key a visit is recorded under.
  const trimmed = parsed.pathname.replace(/\/+$/u, "");
  return trimmed === "" ? "/" : trimmed;
}
export function describeInventoryDifference(expected: readonly string[], served: readonly string[]): string {
  const missing = expected.filter((template) => !served.includes(template)); // The difference between the inventory and the router, as a message a reader can act on.
  const unexpected = served.filter((template) => !expected.includes(template));
  if (missing.length === 0 && unexpected.length === 0) return "";
  const lines = [`The route inventory and the router disagree: ${String(expected.length)} template(s) named, ${String(served.length)} served.`];
  if (missing.length > 0) lines.push(`  Named and not served by src/app: ${missing.join(", ")}`);
  if (unexpected.length > 0) lines.push(`  Served by src/app and named by no inventory row: ${unexpected.join(", ")}`);
  return lines.join("\n");
}
export interface RenditionAnswer {
  readonly status: number; // One rendition response's status and headers, which is all a serving assertion needs from it.
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly contentType: string;
}
export async function requestRendition(page: Page, address: string, range?: string): Promise<RenditionAnswer> {
  const answer = await page.request.get(address, range === undefined ? {} : { headers: { range } }); // Requests one rendition of one asset, optionally as a byte range, and reports exactly what the response carried. The request travels as the persona the context currently holds.
  const headers = answer.headers();
  return { status: answer.status(), headers, body: await answer.text(), contentType: headers["content-type"] ?? "" };
}
export function renditionAddressOf(assetId: string, rendition: string): string {
  return `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(rendition)}`; // The address of one rendition of one asset, as the application emits it.
}
export async function chooseFile(picker: Locator, file: string): Promise<void> {
  await picker.locator('input[type="file"]').setInputFiles(fixturePathOf(file)); // Chooses one file in an open picker and waits for the picker's own description step, which is where the browser has
  await expect(picker).toHaveAttribute("data-phase", "described");
}
export function fixturePathOf(name: string): string {
  const suffixes = [`apps/dashboard/public/fixtures/media/${name}`, `public/fixtures/media/${name}`]; // The absolute address of one committed media fixture.
  let directory = process.cwd();
  for (;;) {
    for (const suffix of suffixes) {
      const candidate = `${directory}/${suffix}`;
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`No ancestor of ${process.cwd()} holds public/fixtures/media/${name}, so the media picker has no file to place.`);
    directory = parent;
  }
}
export function jpegSizeOf(bytes: Buffer): { readonly width: number; readonly height: number } {
  let offset = 2; // The pixel size a JPEG's start-of-frame marker states.
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // A fill byte repeats the marker prefix, and the standalone markers carry no length field.
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const startsFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startsFrame) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  throw new Error("The served image carried no start-of-frame marker, so the size of the bytes this application sent could not be read.");
}
