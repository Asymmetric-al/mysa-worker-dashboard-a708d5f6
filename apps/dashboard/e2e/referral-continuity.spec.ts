/** Criterion 15 — referral continuity. */ import type { Locator, Page } from "@playwright/test";
import { arrayAt, expect, fieldAt, isRecord, jsonOf, newAttemptId, numberAt, operateDevControl, outcomeOf, setClock, stringAt, test, type JsonRecord } from "../playwright.config"; // The runner's own entry points: `test` carries the seeded-persona fixture and `expect` the web-first matchers, and `resetSeed` restores the deterministic world through the application's own control.
const REFERRALS_PATH = "/partners/referrals";
const REFERRALS_READ_PATH = "/api/referrals";
const referralDetailPath = (referralId: string): string => `${REFERRALS_PATH}/${encodeURIComponent(referralId)}`;
function referralListReadPath(list: "active" | "incomplete-date" | "expired", search = ""): string {
  const params = new URLSearchParams({ list, pageSize: "200" });
  if (search !== "") params.set("search", search);
  return `${REFERRALS_READ_PATH}?${params.toString()}`;
}
const referralDetailReadPath = (referralId: string): string => `${REFERRALS_READ_PATH}?referralId=${encodeURIComponent(referralId)}`;
const SETTINGS_PATH = "/settings"; // The development control's one address, the settings surface, and the record a continuation must leave alone.
const CONTINUE_PATH = "/api/referrals/continue";
const SEED_INSTANT = "2026-11-20T00:00:00Z";
const UNKNOWN_CYCLE = { referralId: "referral-sara-unknown", displayName: "سارة الحسن" } as const;
const APPROXIMATE_CYCLE = { referralId: "referral-hana-approximate", displayName: "Hana Nakamura", introducedOn: "2026-09-10" } as const;
const DATE_ONLY_CYCLE = { referralId: "referral-kenji-active", displayName: "Kenji Nakamura", introducedOn: "2026-11-12", lastIncludedOn: "2026-11-25", nominalWording: "Active through 25 November 2026", endpoint: "2026-11-26T00:00:00Z", zone: "Europe/London" } as const; // The seeded date-only cycle that is still inside its New window at the seed instant.
const EXPIRED_CYCLE = { referralId: "referral-jo-expired", displayName: "Jo Mbeki", sourceReference: "crm:intro-4411", introducedOn: "2026-05-04", reference: "crm:intro-4411" } as const;
const HIDDEN_EMAIL = "jo.mbeki@example.org"; // The two facts a permitted Expired history may never carry, taken from the seeded partner behind the
const CONTINUATION_ON_SCENARIO = "continuation-on";
const CONTINUATION_ACCEPTED_AT = "2026-10-10T00:00:00Z";
const CONTINUATION_ENDPOINT = "2026-11-09T00:00:00Z";
const CONTINUED_CYCLE_ID = `${EXPIRED_CYCLE.referralId}-continued`;
const COMPOSED_INTRODUCTION = { partnerId: "partner-kenji-nakamura", displayName: "Kenji Nakamura", date: "2026-10-18", lastIncludedOn: "2026-10-31", zone: "Europe/London" } as const;
const COMPOSED_WINDOW = { nominalWording: "Active through 31 October 2026", windowStart: "2026-10-17T23:00:00Z", endpoint: "2026-11-01T00:00:00Z", elapsedCounterfactual: "2026-10-31T23:00:00Z", insideWindow: "2026-10-25T12:00:00Z" } as const;
const DST_INTRODUCTION = { partnerId: "partner-kenji-nakamura", date: "2026-08-23", zone: "America/Santiago", sourceReference: { system: "crm", reference: "intro-dst-gap-shift" } } as const;
const DST_ENDPOINT = "2026-09-06T04:00:00Z";
const DST_LAST_INCLUDED_ON = "2026-09-05";
const DST_NOMINAL_WORDING = "Active through 5 September 2026";
const OTHER_DISPLAY_ZONE = "Asia/Tokyo"; // The display time zone this file switches to, proving a reader's own zone cannot move a resolved endpoint.
const COPY = {
  introductionHeading: "Original introduction",
  recordIntroductionHeading: "Record an introduction",
  saveIntroductionLabel: "Save introduction",
  acceptedReceiptHeading: "Saved",
  sourceZoneLabel: "Time zone this date is known in",
  sourceReferenceLabel: "Source reference",
  introducedOnLabel: "Original introduction date",
  precisionLabel: "How precisely is this date known?",
  precisionDateLabel: "Known date",
  entryTimeLabel: "Entered in this application",
  entryTimeNote: "Entry time is never shown as the introduction date, and a late entry does not start the window again.",
  noDeadline: "Without a known introduction date there is no deadline, no Active or Expired judgement and no Continue action; this referral is shown exactly as far as its evidence carries.",
  precisionUnknownLabel: "Unknown",
  precisionUnknownHint: "No date is established for this introduction, so none is stored and none is implied.",
  precisionApproximateLabel: "Approximate",
  precisionApproximateHint: "Recorded as it was remembered. An approximation is never turned into a precise date, so no deadline is derived from it.",
  statusIncomplete: "Incomplete date",
  statusActive: "Active",
  statusExpired: "Expired",
  window: "Window",
  newWindow: "New window",
  noWindowEnd: "No window end",
  calendarVsResolved: "Calendar wording and resolved end",
  nominalLabel: "Dates as written",
  resolvedLabel: "When the window ends",
  disagreementNote: "The calendar wording and the resolved moment disagree here. Both are shown: the resolved moment is what decides whether the window is Active or Expired, and the wording stands as it was written rather than being rewritten to match.",
  endpointResolvedOnce: "The end is resolved once and kept, so changing where you are or how dates are displayed does not move it.",
  continueHeading: "Continue is not offered",
  continueLabel: "Continue this referral",
  continueConfirmTitle: "Continue this referral?",
  cycleTerm: "Cycle",
  continueNotExpired: "This referral's window has not ended, so there is nothing to continue.",
  continueNoPrecision: "The introduction date is not precise enough to have had a window, so there is nothing to continue.",
  continueSettingOff: "Worker continuation is off, so an ordinarily expired referral offers no Continue action.",
  expiredHistoryHeading: "Permitted Expired history",
  expiredPermission: "This list shows identity, source reference, status and permitted dates only.",
  expiredReadOnly: "Nothing here can be changed. A permitted history is read-only, and the referral it describes is kept where it belongs.",
  expiredAbsentHeading: "Not included here",
  expiredNoMatchingHint: "A search here matches only the facts this list is permitted to show. No hidden field is ever used as a matching clue, so a search that finds nothing has told you nothing about what was withheld.",
  searchEmptyTitle: "No referral matches this search",
  continuedWindow: "Continued window",
  continuedFrom: "Continued from",
  elapsedNotCalendar: "This window is measured in elapsed seconds rather than calendar days, so a change of clocks neither lengthens nor shortens it.",
  oneSuccessor: "A cycle carries at most one continuation, so continuing it once is the whole of what it offers.",
} as const;
function envelopeOf(body: unknown, what: string): JsonRecord {
  const refusal = fieldAt(body, "outcome");
  if (typeof refusal === "string") throw new Error(`${what} was refused with the ${refusal} outcome rather than answered from the caller's own scope: ${JSON.stringify(body).slice(0, 400)}`);
  for (const member of ["scope", "revision", "data", "actions", "asOf"]) if (!Object.hasOwn(isRecord(body) ? body : {}, member)) throw new Error(`${what} did not answer a read envelope: it carries no ${member}. ${JSON.stringify(body).slice(0, 400)}`);
  return body as JsonRecord;
}
const actionNames = (envelope: JsonRecord): readonly string[] => arrayAt(envelope, ["actions"], "The envelope's actions").map((action) => stringAt(action, ["name"], "An action's name"));
const actionOffered = (envelope: JsonRecord, name: string): boolean => arrayAt(envelope, ["actions"], "The envelope's actions").some((action) => fieldAt(action, "name") === name && fieldAt(action, "available") === true);
const switchScenario = (page: Page, scenarioId: string): Promise<JsonRecord> => operateDevControl(page.request, "setScenario", { scenarioId });
async function readReferral(page: Page, referralId: string): Promise<JsonRecord> {
  const answer = await page.request.get(referralDetailReadPath(referralId)); // One cycle's detail, read from the caller's own scope, with its envelope as the assertions compare it.
  return envelopeOf(await jsonOf(answer, `GET /api/referrals?referralId=${referralId}`), `The read of ${referralId}`);
}
async function readReferralList(page: Page, list: "active" | "incomplete-date" | "expired", search = ""): Promise<JsonRecord> {
  const answer = await page.request.get(referralListReadPath(list, search));
  return envelopeOf(await jsonOf(answer, `GET /api/referrals?list=${list}`), `The ${list} referral list`);
}
const listTotal = async (envelope: JsonRecord): Promise<number> => numberAt(envelope, ["data", "total"], "The list's whole-result count"); // The whole-result count one list states, which is the count of the authorised result rather than of a page.
type ReportedOutcome = { readonly body: JsonRecord; readonly outcome: string };
function isContinueAttempt(requestUrl: string, method: string): boolean {
  if (method !== "POST") return false; // Whether an answer is the continuation the composed Continue action submits: the one route it posts to, and no other write.
  try {
    return new URL(requestUrl).pathname === CONTINUE_PATH;
  } catch {
    return false; // A body this module cannot read as an address is not the attempt this file is waiting for.
  }
}
async function submitContinueAttempt(page: Page, body: JsonRecord): Promise<ReportedOutcome> {
  const answer = await page.request.post(CONTINUE_PATH, { data: body }); // Submits one continuation over the route the Continue action itself submits to, stated exactly as the caller writes it: what is posted here is an attempt the control made, replayed, or a race no composed surface can produce.
  const answered = await jsonOf(answer, `POST ${CONTINUE_PATH}`);
  if (!isRecord(answered)) throw new Error(`POST ${CONTINUE_PATH} did not answer an object: ${JSON.stringify(answered).slice(0, 400)}`);
  return { body: answered, outcome: outcomeOf(answered) };
}
function continueAttemptFrom(envelope: JsonRecord, referralId: string, operationId: string): JsonRecord {
  const scope = fieldAt(envelope, "scope"); // One continuation stated as the action states it: the attempt's identity, the scope it runs under, the revision it presents and the one cycle it names.
  if (!isRecord(scope)) throw new Error(`The read of ${referralId} carried no scope, so a continuation for it has no authority to present: ${JSON.stringify(envelope).slice(0, 400)}`);
  return { operationId, scope, expectedRevision: stringAt(envelope, ["revision"], "The cycle's revision"), payload: { referralId } };
}
const partnerRecordReadPath = (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}?job=record`;
const readPartnerRecord = async (page: Page, partnerId: string): Promise<JsonRecord> => envelopeOf(await jsonOf(await page.request.get(partnerRecordReadPath(partnerId)), `GET ${partnerRecordReadPath(partnerId)}`), "The partner's own record");
function rowForIntroduction(list: JsonRecord, displayName: string, introducedOn: string): JsonRecord {
  const rows = arrayAt(list, ["data", "items"], "The list's rows").filter((row): row is JsonRecord => isRecord(row) && fieldAt(row, "partnerDisplayName") === displayName && fieldAt(row, "originalIntroductionOn") === introducedOn); // The one row of one referral list that states one partner's introduction on one date, refusing anything but exactly one.
  const [only, ...others] = rows;
  if (only === undefined || others.length > 0) throw new Error(`The introduction stated for ${displayName} on ${introducedOn} is one row of the list in ${String(rows.length)} of them, so the cycle it created cannot be identified: ${JSON.stringify(rows).slice(0, 400)}`);
  return only;
}
async function recordIntroductionThroughTheRecord(page: Page, introduction: { readonly partnerId: string; readonly displayName: string; readonly date: string }): Promise<string> {
  const record = await readPartnerRecord(page, introduction.partnerId); // Records one original introduction through the composed journey on the partner's own record, and answers the cycle it created, read off the list that cycle appears in.
  const zone = stringAt(record, ["data", "referralSourceZone"], "The accepted source zone an introduction to this record is read in");
  const source = fieldAt(record, "source");
  if (!isRecord(source)) throw new Error(`The record read of ${introduction.partnerId} carried no source, so the reference the form states could not be checked: ${JSON.stringify(record).slice(0, 400)}`);
  await page.goto(`/partners/${encodeURIComponent(introduction.partnerId)}`);
  await expect(page.getByRole("heading", { name: introduction.displayName, level: 1 })).toBeVisible();
  const form = page.locator('[data-slot="referral-introduction-form"]');
  await expect(form.getByRole("heading", { name: COPY.introductionHeading })).toBeVisible();
  for (const text of [COPY.sourceZoneLabel, COPY.sourceReferenceLabel]) await expect(form.getByText(text).first()).toBeVisible();
  for (const text of [zone, stringAt(source, ["reference"], "The source reference the record read states")]) await expect(form.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(form.getByText(COPY.entryTimeNote)).toBeVisible();
  await form.getByLabel(COPY.introducedOnLabel).fill(introduction.date);
  await form.getByRole("radio", { name: COPY.precisionDateLabel }).click();
  const review = form.locator('[data-slot="action-review"]'); // The review step states the introduction it is about to record, before it is confirmed.
  await expect(review.getByRole("heading", { name: COPY.recordIntroductionHeading })).toBeVisible();
  await expect(review.getByText(introduction.date, { exact: true })).toBeVisible();
  for (const text of [COPY.precisionDateLabel, zone]) await expect(review.getByText(text, { exact: true }).first()).toBeVisible();
  await review.getByRole("button", { name: COPY.saveIntroductionLabel, exact: true }).click();
  const receipt = review.locator('[data-slot="action-review-result"]');
  await expect(receipt).toHaveAttribute("data-outcome", "accepted");
  await expect(receipt.getByRole("heading", { name: COPY.acceptedReceiptHeading })).toBeVisible();
  const created = stringAt(rowForIntroduction(await readReferralList(page, "active"), introduction.displayName, introduction.date), ["referralId"], "The cycle the introduction created");
  await expect(receipt.getByText(created, { exact: true })).toBeVisible();
  return created;
}
async function recordIntroductionInZone(page: Page, payload: JsonRecord): Promise<string> {
  const list = await readReferralList(page, "active"); // Records one introduction over the route the composed form submits to, for the one case the form cannot state: a date read in a zone whose local midnight does not exist, which no composed form offers.
  const scope = fieldAt(list, "scope");
  if (!isRecord(scope)) throw new Error(`The referral list read carried no scope, so an introduction cannot be recorded under it: ${JSON.stringify(list).slice(0, 400)}`);
  const answer = await page.request.post("/api/referrals", { data: { operationId: newAttemptId(), scope, expectedRevision: stringAt(list, ["revision"], "The referral list's revision"), payload } });
  const body = await jsonOf(answer, `POST ${REFERRALS_READ_PATH}`);
  expect(outcomeOf(body), `Recording the introduction ${JSON.stringify(payload)} was refused: ${JSON.stringify(body).slice(0, 400)}`).toBe("accepted");
  return stringAt(body, ["created", "0"], "The cycle the introduction created");
}
type PartnerFigures = { /** The open tasks the record carries: a continuation creates no follow-up work. */ readonly openTasks: number; /** The interactions recorded against the partner: a continuation credits no contact and no conversation. */ readonly interactions: number };
async function readPartnerFigures(page: Page, partnerId: string): Promise<PartnerFigures> {
  const recordAnswer = await page.request.get(`/api/partners/${encodeURIComponent(partnerId)}?job=record`); // Reads the work and activity a continuation must not change.
  const record = envelopeOf(await jsonOf(recordAnswer, "The partner record read"), "The partner's own record");
  const interactions = envelopeOf(await jsonOf(await page.request.get(`/api/partners/${encodeURIComponent(partnerId)}?job=interactions`), "The partner activity read"), "The partner's recorded activity");
  return { openTasks: arrayAt(record, ["data", "openTasks"], "The record's open tasks").length, interactions: numberAt(interactions, ["data", "total"], "The partner's interaction count") };
}
const expectStatusWord = async (scope: Locator, word: string): Promise<void> => expect(scope.getByText(word, { exact: true }).first()).toBeVisible();
function expectStatedMembers(envelope: JsonRecord, members: Readonly<Record<string, unknown>>, ...prefix: readonly string[]): void {
  for (const [member, value] of Object.entries(members)) expect(fieldAt(envelope, ...prefix, ...member.split("."))).toBe(value); // Asserts each stated member of one read holds the value its row carries, a dotted row naming a nested member.
}
async function expectNoDeadlineSurfaces(page: Page, hint: string, absentHint?: string): Promise<void> {
  const status = page.locator('[data-slot="referral-detail-status"]'); // The judgement a cycle without a known date never carries: no Active or Expired word, the precision's own hint in place of a window end, and no Continue offered for a window that does not exist.
  await expectStatusWord(status, COPY.statusIncomplete);
  for (const word of [COPY.statusActive, COPY.statusExpired]) await expect(status.getByText(word, { exact: true })).toHaveCount(0);
  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.window })).toBeVisible();
  for (const text of [COPY.noDeadline, hint]) await expect(windowPanel.getByText(text)).toBeVisible();
  if (absentHint !== undefined) await expect(windowPanel.getByText(absentHint)).toHaveCount(0);
  await expect(page.getByText(COPY.noWindowEnd)).toBeVisible();
  await expect(page.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);
}
test("an unknown introduction date states no date, so it carries no deadline, no judgement and no Continue", async ({ page }) => {
  await page.goto(`${REFERRALS_PATH}?list=incomplete-date`);
  await expect(page.getByText("Development data", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: COPY.statusIncomplete, level: 2 })).toBeVisible();
  await expect(page.getByText(COPY.noDeadline)).toBeVisible();
  await page.goto(referralDetailPath(UNKNOWN_CYCLE.referralId));
  await expect(page.getByRole("heading", { name: UNKNOWN_CYCLE.displayName, level: 1 })).toBeVisible();
  const introduction = page.locator('[data-slot="referral-detail-introduction"]'); // No date is stored, so the original introduction date is the shared "unknown" value state and the precision is stated as unknown rather than inferred from anything else on the record.
  await expect(introduction.getByRole("heading", { name: COPY.introductionHeading })).toBeVisible();
  for (const text of [COPY.introducedOnLabel, COPY.precisionLabel, COPY.precisionUnknownHint, COPY.entryTimeLabel, COPY.entryTimeNote]) await expect(introduction.getByText(text)).toBeVisible();
  await expect(introduction.getByText(COPY.precisionUnknownLabel, { exact: true }).first()).toBeVisible();
  await expectNoDeadlineSurfaces(page, COPY.precisionUnknownHint); // No Active or Expired judgement is made, because no window exists to make one about. The status word is the family's third word for exactly this state, and no badge in the record says Active or Expired.
  const notOffered = page.locator('[data-slot="continue-referral-unavailable"]');
  await expect(notOffered.getByRole("heading", { name: COPY.continueHeading })).toBeVisible();
  await expect(notOffered.getByText(COPY.continueNoPrecision)).toBeVisible();
  const detail = await readReferral(page, UNKNOWN_CYCLE.referralId); // The read publishes the same withholding: no continuation is available on the cycle, and the record offers no action at all, so the absence above is the application's own answer rather than a rendering accident.
  expect(fieldAt(detail, "data", "referral", "datePrecision")).toBe("unknown");
  for (const member of ["originalIntroductionOn", "windowEnd", "deadline"]) expect(fieldAt(detail, "data", "referral", member)).toBeNull();
  expect(fieldAt(detail, "data", "referral", "continuation", "available")).toBe(false);
  expect(actionOffered(detail, "continueReferral")).toBe(false);
});
test("an approximate introduction date is shown as approximate and is never turned into a deadline", async ({ page }) => {
  await page.goto(referralDetailPath(APPROXIMATE_CYCLE.referralId));
  await expect(page.getByRole("heading", { name: APPROXIMATE_CYCLE.displayName, level: 1 })).toBeVisible();
  const introduction = page.locator('[data-slot="referral-detail-introduction"]'); // The remembered date is stated as it was recorded — the day the introduction was remembered to have happened — and the badge beside it says how precisely that is known, so no reader mistakes it for a measured date.
  await expect(introduction.getByText(APPROXIMATE_CYCLE.introducedOn, { exact: true })).toBeVisible();
  await expect(introduction.getByText(COPY.precisionApproximateLabel, { exact: true }).first()).toBeVisible();
  for (const text of [COPY.precisionApproximateHint, COPY.entryTimeLabel, COPY.entryTimeNote]) await expect(introduction.getByText(text)).toBeVisible();
  await expectNoDeadlineSurfaces(page, COPY.precisionApproximateHint, COPY.calendarVsResolved);
  await expect(page.locator('[data-slot="continue-referral-unavailable"]').getByText(COPY.continueNoPrecision)).toBeVisible();
  const detail = await readReferral(page, APPROXIMATE_CYCLE.referralId);
  expectStatedMembers(detail, { datePrecision: "approximate", originalIntroductionOn: APPROXIMATE_CYCLE.introducedOn, windowStart: null, windowEnd: null }, "data", "referral");
  expectStatedMembers(detail, { "status.status": "no-deadline", "continuation.available": false }, "data", "referral");
});
const countCaption = (heading: string, total: number): string => `${heading}: ${String(total)} ${total === 1 ? "referral" : "referrals"} in the whole result.`;
test("the seeded date-only cycle is Active until its exclusive endpoint and Expired at it", async ({ page }) => {
  await page.goto(referralDetailPath(DATE_ONLY_CYCLE.referralId));
  await expect(page.getByRole("heading", { name: DATE_ONLY_CYCLE.displayName, level: 1 })).toBeVisible();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.newWindow })).toBeVisible();
  for (const text of [DATE_ONLY_CYCLE.nominalWording, `The introduction date, ${DATE_ONLY_CYCLE.introducedOn}, is day one.`, `The last date the window includes is ${DATE_ONLY_CYCLE.lastIncludedOn}.`, COPY.endpointResolvedOnce]) await expect(windowPanel.getByText(text)).toBeVisible();
  for (const text of [DATE_ONLY_CYCLE.endpoint, DATE_ONLY_CYCLE.zone]) await expect(windowPanel.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(COPY.disagreementNote)).toHaveCount(0);
  await setClock(page.request, "2026-11-25T23:59:59Z");
  await page.reload();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  await expect(page.locator('[data-slot="referral-window-panel"]').getByText(DATE_ONLY_CYCLE.endpoint, { exact: true }).first()).toBeVisible();
  await setClock(page.request, DATE_ONLY_CYCLE.endpoint); // At the endpoint itself the cycle is Expired rather than Active, and it is answered in the narrow permitted projection, which states the dates it may show and no record beyond them.
  await page.reload();
  const expiredCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: COPY.expiredHistoryHeading }) });
  await expect(expiredCard).toBeVisible();
  await expect(expiredCard.getByText(COPY.statusExpired, { exact: true }).first()).toBeVisible();
  await expect(expiredCard.getByText(DATE_ONLY_CYCLE.endpoint, { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-slot="referral-detail"]')).toHaveCount(0);
  const atEndpoint = await readReferral(page, DATE_ONLY_CYCLE.referralId); // The read drew the same line, in the same direction: expired at equality, not a moment later.
  expectStatedMembers(atEndpoint, { view: "expired-history", "referral.status.status": "expired", "referral.windowEnd": DATE_ONLY_CYCLE.endpoint }, "data");
  await setClock(page.request, SEED_INSTANT);
});
test("a New window across a daylight-saving transition ends at the first valid instant after the gap, and that end does not move", async ({ page }) => {
  await setClock(page.request, COMPOSED_WINDOW.insideWindow); // The date-only introduction, recorded through the composed journey on the partner's own record: the window it opens crosses the end of daylight saving, so the end it resolves is the first instant of the day after the last included date rather than a fixed span of hours.
  const composedId = await recordIntroductionThroughTheRecord(page, COMPOSED_INTRODUCTION);
  const composed = await readReferral(page, composedId);
  const composedDeadline = ["data", "referral", "deadline"] as const;
  expectStatedMembers(composed, { datePrecision: "date", originalIntroductionOn: COMPOSED_INTRODUCTION.date, sourceZone: COMPOSED_INTRODUCTION.zone, cycleIndex: 0, predecessorId: null, windowStart: COMPOSED_WINDOW.windowStart }, "data", "referral");
  expectStatedMembers(composed, { end: COMPOSED_WINDOW.endpoint, "nominal.lastIncludedOn": COMPOSED_INTRODUCTION.lastIncludedOn, "nominal.wording": COMPOSED_WINDOW.nominalWording, "nominal.resolution": "aligned", "nominal.disagreesWithResolved": false }, ...composedDeadline);
  expect(fieldAt(composed, ...composedDeadline, "end"), "A calendar-day window ends at local midnight, not a fixed span of hours after its start").not.toBe(COMPOSED_WINDOW.elapsedCounterfactual);
  await page.goto(referralDetailPath(composedId));
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  const composedPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(composedPanel.getByRole("heading", { name: COPY.newWindow })).toBeVisible();
  for (const text of [COMPOSED_WINDOW.nominalWording, `The introduction date, ${COMPOSED_INTRODUCTION.date}, is day one.`, `The last date the window includes is ${COMPOSED_INTRODUCTION.lastIncludedOn}.`]) await expect(composedPanel.getByText(text)).toBeVisible();
  for (const text of [COMPOSED_WINDOW.endpoint, COMPOSED_INTRODUCTION.zone]) await expect(composedPanel.getByText(text, { exact: true }).first()).toBeVisible();
  await page.goto(`${REFERRALS_PATH}?list=active&search=${encodeURIComponent(COMPOSED_INTRODUCTION.displayName)}`);
  const composedRow = page.locator('[data-slot="referral-list"]').locator(`a[href*="${composedId}"]`); // The seeded cycle for this partner is on the same list, so the row is found by the cycle the recording created rather than by the partner's name alone.
  await expect(composedRow).toHaveCount(1);
  await expect(composedRow).toHaveText(COMPOSED_INTRODUCTION.displayName);
  await setClock(page.request, "2026-09-01T00:00:00Z"); // The gap case: a date read in a zone whose local midnight does not exist that day, which the composed form cannot state because it fixes the one accepted source zone the referral rules own.
  const referralId = await recordIntroductionInZone(page, { partnerId: DST_INTRODUCTION.partnerId, originalIntroductionOn: DST_INTRODUCTION.date, datePrecision: "date", sourceZone: DST_INTRODUCTION.zone, sourceReference: DST_INTRODUCTION.sourceReference });
  const detail = await readReferral(page, referralId);
  const deadline = ["data", "referral", "deadline"] as const;
  expectStatedMembers(detail, { end: DST_ENDPOINT, "nominal.lastIncludedOn": DST_LAST_INCLUDED_ON, "nominal.wording": DST_NOMINAL_WORDING, "nominal.resolution": "gap-shifted", "nominal.disagreesWithResolved": true }, ...deadline);
  expectStatedMembers(detail, { "status.status": "active", sourceZone: DST_INTRODUCTION.zone }, "data", "referral");
  await page.goto(referralDetailPath(referralId)); // The surface states both facts under their own labels: the calendar wording as written, and the resolved moment that decides where the window stands — never one rewritten to look like the other.
  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  for (const heading of [COPY.newWindow, COPY.calendarVsResolved]) await expect(windowPanel.getByRole("heading", { name: heading })).toBeVisible();
  for (const text of [COPY.nominalLabel, DST_NOMINAL_WORDING, COPY.resolvedLabel, COPY.disagreementNote, COPY.endpointResolvedOnce]) await expect(windowPanel.getByText(text)).toBeVisible();
  for (const text of [DST_LAST_INCLUDED_ON, DST_ENDPOINT, DST_INTRODUCTION.zone]) await expect(windowPanel.getByText(text, { exact: true }).first()).toBeVisible();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  await setClock(page.request, DST_ENDPOINT);
  await page.reload();
  const expiredCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: COPY.expiredHistoryHeading }) });
  await expect(expiredCard).toBeVisible();
  await expect(expiredCard.getByText(COPY.statusExpired, { exact: true }).first()).toBeVisible();
  await expect(expiredCard.getByText(DST_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-slot="referral-detail"]')).toHaveCount(0);
  await setClock(page.request, "2026-09-06T03:59:59Z");
  await page.reload();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  const revivedPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(revivedPanel.getByText(DST_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(revivedPanel.getByText(DST_NOMINAL_WORDING)).toBeVisible();
  await page.goto(SETTINGS_PATH);
  await page.getByLabel("Display time zone").selectOption(OTHER_DISPLAY_ZONE);
  await expect(page.getByText(/no deadline moves/u)).toBeVisible();
  await page.goto(referralDetailPath(referralId));
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  const unchangedPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(unchangedPanel.getByText(DST_ENDPOINT, { exact: true }).first()).toBeVisible();
  await expect(unchangedPanel.getByText(DST_INTRODUCTION.zone, { exact: true }).first()).toBeVisible();
  await expect(unchangedPanel.getByText(DST_NOMINAL_WORDING)).toBeVisible();
  const afterTravelling = await readReferral(page, referralId);
  expect(fieldAt(afterTravelling, ...deadline, "end")).toBe(DST_ENDPOINT);
  expect(fieldAt(afterTravelling, ...deadline, "nominal", "lastIncludedOn")).toBe(DST_LAST_INCLUDED_ON);
  await setClock(page.request, SEED_INSTANT);
});
test("the permitted Expired history carries identity, source reference, status and permitted dates only", async ({ page }) => {
  await page.goto(`${REFERRALS_PATH}?list=expired`);
  const list = page.locator('[data-slot="referral-list"]');
  const total = await listTotal(await readReferralList(page, "expired"));
  expect(total).toBeGreaterThan(0);
  await expect(list.getByText(countCaption(COPY.expiredHistoryHeading, total))).toBeVisible();
  for (const text of [COPY.expiredPermission, COPY.expiredReadOnly, COPY.expiredAbsentHeading]) await expect(list.getByText(text).first()).toBeVisible();
  await expect(list.getByRole("heading", { name: EXPIRED_CYCLE.displayName })).toBeVisible();
  for (const text of [EXPIRED_CYCLE.reference, COPY.statusExpired]) await expect(list.getByText(text, { exact: true }).first()).toBeVisible();
  for (const absent of ["Contact details", "What the referrer said", "Precise location", "Notes", "Financial information"] as const) await expect(list.getByText(absent, { exact: true }).first()).toBeVisible();
  await expect(list).not.toContainText(HIDDEN_EMAIL);
  await expect(list).not.toContainText("Prefers a call after 6pm");
  for (const currency of ["USD", "EUR", "KWD", "JPY"]) await expect(list).not.toContainText(currency);
  const search = list.getByRole("searchbox"); // A hidden field is never a matching clue: searching the permitted history for the address the record carries finds nothing, and the surface says that finding nothing has told the searcher nothing.
  await search.fill(HIDDEN_EMAIL);
  await search.press("Enter");
  await expect(list.getByText(COPY.searchEmptyTitle)).toBeVisible();
  await expect(list.getByText(COPY.expiredNoMatchingHint)).toBeVisible();
  await expect(list.getByText(countCaption(COPY.expiredHistoryHeading, 0))).toBeVisible();
  expect(await listTotal(await readReferralList(page, "expired", HIDDEN_EMAIL))).toBe(0);
  await page.goto(referralDetailPath(EXPIRED_CYCLE.referralId)); // One expired cycle's own route answers the same narrow projection, and no control of any kind is offered on it: a permission over history never reopens the record, and it never offers an action.
  await expect(page.getByRole("heading", { name: COPY.expiredHistoryHeading, level: 2 })).toBeVisible();
  await expect(page.getByText(COPY.expiredPermission)).toBeVisible();
  await expect(page.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);
  await expect(page.getByText(EXPIRED_CYCLE.reference, { exact: true }).first()).toBeVisible();
  const detail = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(detail, "data", "view")).toBe("expired-history");
  const projected = fieldAt(detail, "data", "referral");
  const projectedKeys = Object.keys(isRecord(projected) ? projected : {});
  // The projection is narrower than the record by construction: not one of these members travels with it, so no hidden field could be used as a clue even by a surface that tried to.
  for (const withheld of ["contactMethods", "notes", "referrerContext", "preciseLocation", "partnerId", "supportHistory"]) expect(projectedKeys, `The permitted projection carries ${withheld}, which is a wider permission than history.`).not.toContain(withheld);
  for (const permitted of ["partnerDisplayName", "sourceReference", "windowEnd"]) expect(projectedKeys).toContain(permitted);
});
test("Continue is absent while the worker-continuation setting is off, and the same expired cycle offers it once the setting is on", async ({ page }) => {
  const off = await readReferral(page, EXPIRED_CYCLE.referralId); // The setting off: the cycle is eligible in every other respect — it is a new cycle, ordinarily expired, with a known date and no successor — and it still offers nothing, because the setting is a capability this session does not hold rather than a reason withheld from one cycle.
  expect(fieldAt(off, "data", "view")).toBe("expired-history");
  expect(fieldAt(off, "data", "continuationPolicy", "setting")).toBe("off");
  expect(fieldAt(off, "data", "referral", "continuation", "available")).toBe(false);
  expect(String(fieldAt(off, "data", "referral", "continuation", "reason"))).toBe(COPY.continueSettingOff);
  expect(actionNames(off)).toEqual([]);
  expect(actionOffered(off, "continueReferral")).toBe(false);
  const refused = await submitContinueAttempt(page, continueAttemptFrom(off, EXPIRED_CYCLE.referralId, newAttemptId())); // Nothing is on offer in this world to press, so the refusal is submitted over the route the Continue action itself uses, and it is refused as a capability the session does not hold — naming the capability and nothing about the cycle.
  expect(refused.outcome).toBe("denied");
  expect(fieldAt(refused.body, "reasonCode")).toBe("capability-absent");
  expect(Object.keys(refused.body).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
  expect(fieldAt(await jsonOf(await page.request.get(referralDetailReadPath(CONTINUED_CYCLE_ID)), "The read of a cycle the refusal did not create"), "outcome")).toBe("denied");
  expect(await listTotal(await readReferralList(page, "expired", EXPIRED_CYCLE.displayName))).toBe(1);
  expect(await listTotal(await readReferralList(page, "active", EXPIRED_CYCLE.displayName))).toBe(0);
  await page.goto(`${REFERRALS_PATH}?list=expired`);
  const list = page.locator('[data-slot="referral-list"]');
  await expect(list.getByRole("heading", { name: EXPIRED_CYCLE.displayName })).toHaveCount(1);
  await expect(list.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);
  await switchScenario(page, CONTINUATION_ON_SCENARIO);
  const on = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(on, "data", "continuationPolicy", "setting")).toBe("on");
  expect(fieldAt(on, "data", "referral", "continuation", "available")).toBe(true);
  expect(fieldAt(on, "data", "referral", "continuation", "reason")).toBeNull();
  expect(actionOffered(on, "continueReferral")).toBe(true);
  expect(actionOffered(await readReferralList(page, "expired"), "continueReferral")).toBe(true);
  await page.goto(referralDetailPath(EXPIRED_CYCLE.referralId));
  const continueButton = page.getByRole("button", { name: COPY.continueLabel });
  await expect(continueButton).toHaveCount(1);
  await expect(continueButton).toBeVisible();
  await expect(page.locator('[data-slot="continue-referral-unavailable"]')).toHaveCount(0);
  const unended = await readReferral(page, DATE_ONLY_CYCLE.referralId); // The offer is eligibility, not the setting alone: a cycle whose window has not ended is still not continuable, and its surface states that reason in its own words.
  expect(fieldAt(unended, "data", "referral", "continuation", "available")).toBe(false);
  expect(String(fieldAt(unended, "data", "referral", "continuation", "reason"))).toBe(COPY.continueNotExpired);
  await page.goto(referralDetailPath(DATE_ONLY_CYCLE.referralId));
  const notOffered = page.locator('[data-slot="continue-referral-unavailable"]');
  await expect(notOffered.getByRole("heading", { name: COPY.continueHeading })).toBeVisible();
  await expect(notOffered.getByText(COPY.continueNotExpired)).toBeVisible();
});
test("a continued window ends in elapsed seconds, and a racing second Continue yields no second successor", async ({ page }) => {
  await switchScenario(page, CONTINUATION_ON_SCENARIO);
  await setClock(page.request, CONTINUATION_ACCEPTED_AT);
  const before = await readPartnerFigures(page, "partner-jo-mbeki"); // The figures a continuation must leave alone, read before it: the partner's open work and the activity recorded against them. Neither is derived here; each is the count the application states.
  const cycle = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(cycle, "data", "referral", "status", "status")).toBe("expired");
  expect(fieldAt(cycle, "data", "referral", "continuation", "available")).toBe(true);
  await page.goto(referralDetailPath(EXPIRED_CYCLE.referralId));
  const continueButton = page.getByRole("button", { name: COPY.continueLabel });
  await expect(continueButton).toBeVisible();
  await continueButton.click();
  const confirmStep = page.getByRole("alertdialog");
  await expect(confirmStep).toBeVisible();
  await expect(confirmStep).toContainText(COPY.continueConfirmTitle);
  await expect(confirmStep.getByText(`This continues ${COPY.cycleTerm} 0, the cycle whose window has ended`)).toBeVisible();
  await expect(confirmStep.getByText(EXPIRED_CYCLE.referralId, { exact: true }).first()).toBeVisible();
  // One press, one attempt: the request the control sends is the whole statement of it, and the answer it receives is the outcome — the identifiers the acceptance created and changed.
  const [attemptRequest, attemptAnswer] = await Promise.all([
    page.waitForRequest((request) => isContinueAttempt(request.url(), request.method())),
    page.waitForResponse((answer) => isContinueAttempt(answer.url(), answer.request().method())),
    confirmStep.getByRole("button", { name: COPY.continueLabel, exact: true }).click(),
  ]);
  const attempt: unknown = await attemptRequest.postDataJSON();
  if (!isRecord(attempt)) throw new Error(`The Continue action posted a body this file cannot read, so the attempt it made cannot be replayed: ${JSON.stringify(attempt).slice(0, 400)}`);
  const accepted = await jsonOf(attemptAnswer, "The continuation the control submitted");
  expect(outcomeOf(accepted)).toBe("accepted");
  expect(fieldAt(accepted, "created")).toEqual([CONTINUED_CYCLE_ID]);
  expect(fieldAt(accepted, "changed")).toEqual([EXPIRED_CYCLE.referralId]);
  await expect(page.getByRole("button", { name: COPY.continueLabel })).toHaveCount(0);
  const consumed = await readReferral(page, EXPIRED_CYCLE.referralId);
  expect(fieldAt(consumed, "data", "referral", "continuation", "cycle", "consumed")).toBe(true);
  expect(fieldAt(consumed, "data", "referral", "continuation", "cycle", "successorId")).toBe(CONTINUED_CYCLE_ID);
  const replayed = await submitContinueAttempt(page, attempt); // The stored result is what the same attempt answers when it is replayed, and the replay re-sends exactly the body the control sent: the successor, the instant its window ends and the elapsed seconds it is counted in — 2,592,000 of them, reaching 09 November at 00:00 UTC rather than the calendar-day reading an hour later.
  expect(replayed.outcome).toBe("alreadyAccepted");
  expect(fieldAt(replayed.body, "result", "successorId")).toBe(CONTINUED_CYCLE_ID);
  expect(fieldAt(replayed.body, "result", "windowEnd")).toBe(CONTINUATION_ENDPOINT);
  expect(numberAt(replayed.body, ["result", "elapsedSeconds"], "The continuation's elapsed seconds")).toBe(2_592_000);
  expect(fieldAt(replayed.body, "result", "windowEnd")).not.toBe("2026-11-09T01:00:00Z");
  expect(fieldAt(replayed.body, "created")).toEqual([CONTINUED_CYCLE_ID]);
  expect((await submitContinueAttempt(page, continueAttemptFrom(cycle, EXPIRED_CYCLE.referralId, newAttemptId()))).outcome).toBe("conflict");
  const raced = await submitContinueAttempt(page, continueAttemptFrom(await readReferral(page, EXPIRED_CYCLE.referralId), EXPIRED_CYCLE.referralId, newAttemptId()));
  expect(raced.outcome).toBe("unchanged");
  expect(await listTotal(await readReferralList(page, "active", EXPIRED_CYCLE.displayName))).toBe(1);
  expect(await listTotal(await readReferralList(page, "expired", EXPIRED_CYCLE.displayName))).toBe(1);
  const successor = await readReferral(page, CONTINUED_CYCLE_ID); // The successor keeps the original introduction date and states the predecessor it came from: a continuation is one further window on the same introduction, not a second introduction.
  expectStatedMembers(successor, { predecessorId: EXPIRED_CYCLE.referralId, cycleIndex: 1, originalIntroductionOn: EXPIRED_CYCLE.introducedOn, windowStart: CONTINUATION_ACCEPTED_AT, windowEnd: CONTINUATION_ENDPOINT, "status.status": "active" }, "data", "referral");
  await page.goto(referralDetailPath(CONTINUED_CYCLE_ID)); // The surface says what the window is measured in and that it is the only one the cycle carries, and it prints the instant exactly as the read resolved it.
  const windowPanel = page.locator('[data-slot="referral-window-panel"]');
  await expect(windowPanel.getByRole("heading", { name: COPY.continuedWindow })).toBeVisible();
  for (const text of [COPY.elapsedNotCalendar, COPY.oneSuccessor]) await expect(windowPanel.getByText(text)).toBeVisible();
  for (const text of [CONTINUATION_ENDPOINT, EXPIRED_CYCLE.referralId]) await expect(windowPanel.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(windowPanel.getByText(COPY.continuedFrom, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="referral-detail-introduction"]').getByText(EXPIRED_CYCLE.introducedOn, { exact: true })).toBeVisible();
  await expectStatusWord(page.locator('[data-slot="referral-detail-status"]'), COPY.statusActive);
  await page.goto(`${REFERRALS_PATH}?list=active&search=${encodeURIComponent(EXPIRED_CYCLE.displayName)}`);
  const list = page.locator('[data-slot="referral-list"]');
  await expect(list.getByRole("link", { name: EXPIRED_CYCLE.displayName })).toHaveCount(1);
  await expect(list.getByRole("link", { name: EXPIRED_CYCLE.displayName }).first()).toHaveAttribute("href", /referral-jo-expired-continued/u);
  expect(await readPartnerFigures(page, "partner-jo-mbeki")).toEqual(before);
  await setClock(page.request, SEED_INSTANT);
});
