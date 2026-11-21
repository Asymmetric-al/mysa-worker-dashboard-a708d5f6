/** Success criterion 15: the two referral windows keep two different semantics on purpose. */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type Scope } from "@/modules/data-service";
import { resolveSession, type SessionSource } from "@/modules/data-service/authorize";
import { isOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, seed, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { advanceClock, setClock, setScenario } from "@/modules/dev-runtime/scenario";
import { readSession, resetSession } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";
import { continuedWindowEnd, newWindowEnd, referralWindowState } from "@/modules/time/window";
const SESSION_ID = "domain-referral-window";
const SECOND_SESSION_ID = "domain-referral-window-second";
const SOURCE: SessionSource = { sessionId: SESSION_ID };
const SECOND_SOURCE: SessionSource = { sessionId: SECOND_SESSION_ID };
const SOURCE_ZONE = "Europe/London";
const NEW_WINDOW_DAYS = 14;
const CONTINUATION_DAYS = 30;
const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * 1_000;
const FIRST_REVISION = "rev-1";
let scope: Scope;
let secondScope: Scope;
let seededWorld: Promise<readonly SeededSessionWithDocuments[]> | undefined;
function seededSessions(): Promise<readonly SeededSessionWithDocuments[]> {
  // One build of the seeded world for the whole file: the documents are deterministic, so every case
  // laying its session down again starts from exactly the same bytes.
  seededWorld ??= seed();
  return seededWorld;
}
async function layDownSession(sessionId: string, workspace: string): Promise<void> {
  const sessions = await seededSessions();
  const template = sessions.find((session) => session.sessionId === workspace);
  if (template === undefined) throw new Error(`The seed lays down no "${workspace}" workspace, so no case in this file has a world to start from.`);
  const { documents } = template;
  await resetSession(sessionId, {
    ...documents,
    // A record set states the session that owns it, so the private session's own id is written into
    // the document it holds rather than naming a session that is not the one reading it.
    state: { ...documents.state, context: { ...documents.state.context, sessionId } },
  });
  const clock = await setClock(sessionId, 0);
  if (!clock.ok) throw new Error(`The scenario clock of "${sessionId}" could not be set to the seed instant: ${clock.error.code}.`);
}
async function scopeOf(source: SessionSource): Promise<Scope> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) throw new Error(`The session "${source.sessionId}" could not be resolved, so no referral case can act in it.`);
  const selected = resolved.session.selected;
  if (selected === null) throw new Error(`The session "${source.sessionId}" has selected no context, so it holds no scope to read referrals in.`);
  return selected;
}
beforeEach(async () => {
  await layDownSession(SESSION_ID, DEFAULT_SESSION_ID);
  await layDownSession(SECOND_SESSION_ID, "second-worker");
  scope = await scopeOf(SOURCE);
  secondScope = await scopeOf(SECOND_SOURCE);
});

afterEach(async () => {
  // The clock is a scenario input, so every case leaves it at the seed instant for the next one.
  for (const sessionId of [SESSION_ID, SECOND_SESSION_ID]) {
    const restored = await setClock(sessionId, 0);
    if (!restored.ok) throw new Error(`The scenario clock of "${sessionId}" could not be restored to the seed instant: ${restored.error.code}.`);
  }
});

afterAll(async () => {
  // Both sessions are this file's own, so the store is left holding none of its fixtures.
  for (const sessionId of [SESSION_ID, SECOND_SESSION_ID]) {
    await resetSession(sessionId);
  }
});
function instant(value: string): Temporal.Instant {
  return Temporal.Instant.from(value);
}
function civilDay(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value);
}
function newWindowFor(originalIntroductionOn: string, sourceZone: string, days: number): Extract<ReturnType<typeof newWindowEnd>, { status: "bounded" }> {
  const window = newWindowEnd({ originalIntroductionOn: civilDay(originalIntroductionOn), datePrecision: "date", sourceZone, days });
  if (window.status !== "bounded") throw new Error(`The New window opened on ${originalIntroductionOn} in ${sourceZone} produced no endpoint: ${window.reason}.`);
  return window;
}
function continuedWindowFor(acceptedAt: Temporal.Instant, days: number) {
  const window = continuedWindowEnd({ acceptedAt, days, cycle: { consumed: false } });
  if (window.status !== "bounded") throw new Error(`The continuation accepted at ${acceptedAt.toString()} did not resolve: ${window.reason}.`);
  return window;
}
type ReferralListQuery = NonNullable<Parameters<typeof reads.referrals.readReferrals>[0]>;

async function referralList(query: ReferralListQuery, source: SessionSource = SOURCE) {
  const result = await reads.referrals.readReferrals(query, source);
  if (result.kind !== "envelope") throw new Error(`The referral list answered "${result.kind}" instead of an envelope.`);
  return result.envelope;
}
async function referralDetail(referralId: string, source: SessionSource = SOURCE) {
  const result = await reads.referrals.readReferral(referralId, source);
  if (result.kind !== "envelope") throw new Error(`The referral "${referralId}" answered "${result.kind}" instead of an envelope.`);
  return result.envelope;
}
function referralIdsOf(envelope: Awaited<ReturnType<typeof referralList>>): readonly string[] {
  const items: readonly { readonly referralId: string }[] = envelope.data.items;
  return items.map((row) => row.referralId);
}
function isAccepted(outcome: MutationOutcome): outcome is Extract<MutationOutcome, { outcome: "accepted" }> {
  return outcome.outcome === "accepted";
}
function isConflict(outcome: MutationOutcome): outcome is Extract<MutationOutcome, { outcome: "conflict" }> {
  return outcome.outcome === "conflict";
}
function refusedFieldsOf(outcome: MutationOutcome, what: string): readonly string[] {
  if (outcome.outcome !== "invalid") throw new Error(`${what} answered "${outcome.outcome}" instead of a validation refusal.`);
  return Object.keys(outcome.fields);
}
function denialReasonOf(outcome: MutationOutcome, what: string): string {
  if (outcome.outcome !== "denied") throw new Error(`${what} answered "${outcome.outcome}" instead of a denial.`);
  return outcome.reasonCode;
}
function conflictOf(outcome: MutationOutcome, what: string): Extract<MutationOutcome, { outcome: "conflict" }> {
  if (!isConflict(outcome)) throw new Error(`${what} answered "${outcome.outcome}" instead of a conflict.`);
  return outcome;
}
async function continueReferral(referralId: string, expectedRevision: string, options: { readonly scope?: Scope; readonly source?: SessionSource } = {}): Promise<MutationOutcome> {
  return mutations.referrals.continueReferral({ operationId: newOperationId(), scope: options.scope ?? scope, expectedRevision, payload: { referralId } }, options.source ?? SOURCE);
}
interface IntroductionPayload {
  readonly partnerId: string;
  readonly originalIntroductionOn?: string;
  readonly datePrecision: string;
  readonly sourceZone: string;
  readonly sourceReference: { readonly system: string; readonly reference: string };
}
async function recordIntroduction(payload: IntroductionPayload): Promise<MutationOutcome> {
  return mutations.referrals.recordIntroduction({ operationId: newOperationId(), scope, expectedRevision: FIRST_REVISION, payload }, SOURCE);
}
type StoredRecords = Pick<SessionStateDocument, "interactions" | "tasks" | "memberships" | "notificationIntents" | "gifts" | "referrals">;

async function storedRecords(): Promise<StoredRecords> {
  const documents = await readSession(SESSION_ID);
  if (documents === undefined) throw new Error(`The store holds no session "${SESSION_ID}", so the fixture cannot be measured.`);
  const state = documents.state;
  if (typeof state !== "object" || state === null) throw new Error("The stored session document is not an object, so the fixture cannot be measured.");
  return state as StoredRecords;
}
function successorsOf(referrals: StoredRecords["referrals"], predecessorId: string): StoredRecords["referrals"] {
  return referrals.filter((cycle) => cycle.predecessorId === predecessorId);
}

describe("the New window is counted in calendar days in the source zone", () => {
  it("takes the original introduction date as day one and names the last included day", () => {
    const window = newWindowFor("2026-11-12", SOURCE_ZONE, NEW_WINDOW_DAYS);
    // D is day one, so a fourteen-day window's last nominal included day is D + 13 and never D + 14.
    expect(window.nominalLastIncludedOn.toString()).toBe("2026-11-25");
    expect(window.nominalLastIncludedOn.toString()).toBe(
      civilDay("2026-11-12")
        .add({ days: NEW_WINDOW_DAYS - 1 })
        .toString(),
    );
    expect(window.nominalWording).toBe("Active through 25 November 2026");
    expect(window.resolvedEndInstant.toString()).toBe("2026-11-26T00:00:00Z");
    expect(window.resolution).toBe("aligned");
    expect(window.nominalDisagreesWithResolved).toBe(false);
  });
  it("expires at the exclusive endpoint and is still Active one millisecond before it", () => {
    const window = newWindowFor("2026-11-12", SOURCE_ZONE, NEW_WINDOW_DAYS);
    const endpoint = window.resolvedEndInstant;
    // Both sides of the boundary: the whole of the last included day is inside the window, and the
    // endpoint instant itself is the first instant outside it.
    expect(referralWindowState({ windowEnd: endpoint, now: instant("2026-11-25T00:00:00Z") })).toEqual({ status: "active" });
    expect(referralWindowState({ windowEnd: endpoint, now: instant("2026-11-25T23:59:59.999Z") })).toEqual({ status: "active" });
    expect(referralWindowState({ windowEnd: endpoint, now: endpoint })).toEqual({ status: "expired" });
    expect(referralWindowState({ windowEnd: endpoint, now: endpoint.add({ milliseconds: 1 }) })).toEqual({ status: "expired" });
    expect(
      referralWindowState({
        windowEnd: endpoint,
        now: civilDay("2026-11-12")
          .add({ days: NEW_WINDOW_DAYS - 1 })
          .toZonedDateTime(SOURCE_ZONE)
          .toInstant(),
      }),
    ).toEqual({ status: "active" });
    expect(referralWindowState({ windowEnd: endpoint, now: civilDay("2026-11-12").add({ days: NEW_WINDOW_DAYS }).toZonedDateTime(SOURCE_ZONE).toInstant() })).toEqual({ status: "expired" });
  });
  it("returns the nominal wording and the resolved instant together, and flags when they disagree", () => {
    const agreeing = newWindowFor("2026-11-12", SOURCE_ZONE, NEW_WINDOW_DAYS);
    expect(agreeing.nominalWording).toBe("Active through 25 November 2026");
    expect(agreeing.nominalDisagreesWithResolved).toBe(false);
    // America/Santiago starts daylight saving at local midnight on 6 September 2026, so that wall time
    // does not exist: the endpoint moves to 01:00 local and no longer matches the calendar-day wording,
    // which is exactly what the flag beside it discloses.
    const shifted = newWindowFor("2026-08-23", "America/Santiago", NEW_WINDOW_DAYS);
    expect(shifted.nominalLastIncludedOn.toString()).toBe("2026-09-05");
    expect(shifted.nominalWording).toBe("Active through 5 September 2026");
    expect(shifted.resolvedEndInstant.toString()).toBe("2026-09-06T04:00:00Z");
    expect(shifted.nominalDisagreesWithResolved).toBe(true);
  });
});
describe("a midnight that is missing, repeated or skipped", () => {
  it("uses the first valid instant after a gap at local midnight", () => {
    // Zone and civil date: America/Santiago, Sunday 2026-09-06. Daylight saving begins at 00:00 local,
    // so 00:00 does not exist and the day starts at the first valid instant after the gap, 01:00 (−03),
    // which is 04:00 UTC. A fourteen-day window opened on 2026-08-23 ends there.
    const window = newWindowFor("2026-08-23", "America/Santiago", NEW_WINDOW_DAYS);
    expect(window.resolvedEndInstant.toString()).toBe("2026-09-06T04:00:00Z");
    expect(window.resolution).toBe("gap-shifted");
    expect(window.resolvedEndInstant.toZonedDateTimeISO("America/Santiago").toPlainDateTime().toString()).toBe("2026-09-06T01:00:00");
    const laterReading = Temporal.PlainDateTime.from("2026-09-06T00:00").toZonedDateTime("America/Santiago", { disambiguation: "later" }).toInstant();
    const earlierReading = Temporal.PlainDateTime.from("2026-09-06T00:00").toZonedDateTime("America/Santiago", { disambiguation: "earlier" }).toInstant();
    expect(laterReading.toString()).toBe(window.resolvedEndInstant.toString());
    expect(Temporal.Instant.compare(earlierReading, window.resolvedEndInstant)).toBeLessThan(0);
  });
  it("uses the earlier of two offsets when midnight happens twice", () => {
    // Zone and civil date: America/Havana, Sunday 2026-11-01. Daylight saving ends at 01:00 local, so
    // 00:00 happens twice. A fourteen-day window opened on 2026-10-18 ends at the earlier occurrence,
    // 00:00 (−04) = 04:00 UTC; the same wall time under the later offset (−05) is 05:00 UTC.
    const window = newWindowFor("2026-10-18", "America/Havana", NEW_WINDOW_DAYS);
    expect(window.resolvedEndInstant.toString()).toBe("2026-11-01T04:00:00Z");
    expect(window.resolution).toBe("overlap-earlier");
    const laterReading = Temporal.PlainDateTime.from("2026-11-01T00:00").toZonedDateTime("America/Havana", { disambiguation: "later" }).toInstant();
    expect(laterReading.toString()).toBe("2026-11-01T05:00:00Z");
    expect(window.resolvedEndInstant.until(laterReading, { largestUnit: "seconds" }).seconds).toBe(3_600);
    // The endpoint is still local midnight, so here the wording and the instant agree.
    expect(window.nominalDisagreesWithResolved).toBe(false);
  });
  it("uses the next existing date when the civil date itself was skipped", () => {
    const window = newWindowFor("2011-12-16", "Pacific/Apia", NEW_WINDOW_DAYS);
    expect(window.nominalLastIncludedOn.toString()).toBe("2011-12-29");
    expect(window.resolvedEndInstant.toString()).toBe("2011-12-30T10:00:00Z");
    expect(window.resolution).toBe("gap-shifted");
    expect(window.nominalDisagreesWithResolved).toBe(true);
    expect(window.resolvedEndInstant.toZonedDateTimeISO("Pacific/Apia").toPlainDate().toString()).toBe("2011-12-31");
    // The same instant is what a window whose endpoint is the next existing date resolves to, so the
    // skipped date is answered with that date rather than with a fabricated one.
    const nextExistingDate = newWindowFor("2011-12-17", "Pacific/Apia", NEW_WINDOW_DAYS);
    expect(nextExistingDate.resolvedEndInstant.toString()).toBe(window.resolvedEndInstant.toString());
  });
});

describe("the resolved endpoint is a value, not a recomputation", () => {
  it("reports the same endpoint after the scenario clock travels", async () => {
    const before = await referralDetail("referral-kenji-active");
    if (before.data.view !== "detail") throw new Error("A referral inside its window was read as expired history.");
    const deadline = before.data.referral.deadline;
    if (deadline === null) throw new Error("A referral inside its window states no deadline.");
    expect(deadline.end).toBe("2026-11-26T00:00:00Z");
    expect(deadline.nominal?.wording).toBe("Active through 25 November 2026");
    expect(deadline.nominal?.disagreesWithResolved).toBe(false);
    // Nine days later the window has ended. The read re-evaluates — its `asOf` moves — while the
    // endpoint it reports is still the stored instant rather than one recomputed from today's date.
    const advanced = await advanceClock(SESSION_ID, 9 * MILLISECONDS_PER_DAY);
    expect(advanced.ok).toBe(true);
    const after = await referralDetail("referral-kenji-active");
    expect(after.asOf).not.toBe(before.asOf);
    if (after.data.view !== "expired-history") throw new Error("The referral whose window had ended was still read in full.");
    expect(after.data.referral.windowEnd).toBe(deadline.end);
    expect(after.data.referral.windowStart).toBe("2026-11-12T00:00:00Z");
    expect(after.data.referral.status).toEqual({ status: "expired" });
  });
  it("derives the endpoint from the original date, so a late first entry is already Expired", async () => {
    const outcome = await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-01-05", datePrecision: "date", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-late-first-entry" } });
    expect(isOutcome(outcome)).toBe(true);
    if (!isAccepted(outcome)) throw new Error(`Recording the late introduction answered "${outcome.outcome}".`);
    const referralId = outcome.created?.[0];
    if (referralId === undefined) throw new Error("The accepted introduction named no referral.");
    const read = await referralDetail(referralId);
    if (read.data.view !== "expired-history") throw new Error("A late first entry was briefly activated instead of being read as already Expired.");
    const window = newWindowFor("2026-01-05", SOURCE_ZONE, NEW_WINDOW_DAYS);
    // The window is the one the original date carries: its clock starts on that date and ends where the
    // calendar-day rule puts it, so entering the record late neither restarts it nor shortens it.
    expect(read.data.referral.windowStart).toBe("2026-01-05T00:00:00Z");
    expect(read.data.referral.windowEnd).toBe(window.resolvedEndInstant.toString());
    expect(read.data.referral.status).toEqual({ status: "expired" });
    expect(read.data.referral.windowStart).not.toBe(now().toString());
    // A window that started today would end fourteen elapsed days from now, which is not this endpoint:
    // the entry instant played no part in the window the original date fixes.
    expect(read.data.referral.windowEnd).not.toBe(
      now()
        .add({ hours: NEW_WINDOW_DAYS * 24 })
        .toString(),
    );
    expect(Temporal.Instant.compare(window.resolvedEndInstant, now())).toBeLessThan(0);
    expect(referralIdsOf(await referralList({ list: "active" }))).not.toContain(referralId);
    expect(referralIdsOf(await referralList({ list: "expired" }))).toContain(referralId);
  });
});
describe("an imprecise introduction date has no deadline", () => {
  it("gives an unknown date no deadline, no judgement and no Continue", async () => {
    const read = await referralDetail("referral-sara-unknown");
    if (read.data.view !== "detail") throw new Error("An imprecise referral was read as expired history.");
    const referral = read.data.referral;
    expect(referral.datePrecision).toBe("unknown");
    expect(referral.originalIntroductionOn).toBeNull();
    expect(referral.status).toEqual({ status: "no-deadline" });
    expect(referral.windowStart).toBeNull();
    expect(referral.windowEnd).toBeNull();
    expect(referral.deadline).toBeNull();
    expect(referral.continuation.available).toBe(false);
    expect(read.actions.map((action) => action.name)).not.toContain("continueReferral");
    expect(read.actions).toEqual([]);
    // The boundary function refuses to produce the deadline a known date would have.
    expect(newWindowEnd({ originalIntroductionOn: civilDay("2026-09-10"), datePrecision: "unknown", sourceZone: SOURCE_ZONE, days: NEW_WINDOW_DAYS })).toEqual({ status: "no-deadline", reason: "imprecise-date" });
    expect(referralWindowState({ windowEnd: undefined, now: now() })).toEqual({ status: "no-deadline" });
  });
  it("gives an approximate date no deadline, no judgement and no Continue", async () => {
    const read = await referralDetail("referral-hana-approximate");
    if (read.data.view !== "detail") throw new Error("An imprecise referral was read as expired history.");
    const referral = read.data.referral;
    expect(referral.datePrecision).toBe("approximate");
    expect(referral.originalIntroductionOn).toBe("2026-09-10");
    expect(referral.status).toEqual({ status: "no-deadline" });
    expect(referral.windowStart).toBeNull();
    expect(referral.windowEnd).toBeNull();
    expect(referral.deadline).toBeNull();
    expect(referral.continuation.available).toBe(false);
    expect(read.actions).toEqual([]);
    const outcome = await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-09-10", datePrecision: "approximate", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-approximate-entry" } });
    if (!isAccepted(outcome)) throw new Error(`Recording the approximate introduction answered "${outcome.outcome}".`);
    const createdId = outcome.created?.[0];
    if (createdId === undefined) throw new Error("The accepted introduction named no referral.");
    const created = await referralDetail(createdId);
    if (created.data.view !== "detail") throw new Error("A newly recorded approximate introduction was read as expired history.");
    expect(created.data.referral.windowStart).toBeNull();
    expect(created.data.referral.windowEnd).toBeNull();
    expect(created.data.referral.status).toEqual({ status: "no-deadline" });
  });
  it("keeps an imprecise introduction out of both judged lists", async () => {
    const incomplete = referralIdsOf(await referralList({ list: "incomplete-date" }));
    const active = referralIdsOf(await referralList({ list: "active" }));
    const expired = referralIdsOf(await referralList({ list: "expired" }));
    expect(incomplete).toEqual(expect.arrayContaining(["referral-hana-approximate", "referral-sara-unknown"]));
    for (const referralId of ["referral-hana-approximate", "referral-sara-unknown"]) {
      expect({ referralId, active: active.includes(referralId) }).toEqual({ referralId, active: false });
      expect({ referralId, expired: expired.includes(referralId) }).toEqual({ referralId, expired: false });
    }
  });
  it("closes the precision vocabulary at date, approximate and unknown", async () => {
    const stored = await storedRecords();
    const observed = [...new Set(stored.referrals.map((cycle) => cycle.datePrecision))].sort();
    expect(observed).toHaveLength(3);
    expect(observed).toEqual(["approximate", "date", "unknown"]);
    // A fourth precision cannot be added silently: the schema that would have to accept it refuses it.
    const fourth = await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-01-05", datePrecision: "guess", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-fourth-precision" } });
    expect(fourth.outcome).toBe("invalid");
    expect(refusedFieldsOf(fourth, "A fourth date precision")).toEqual(["datePrecision"]);
    // An unknown date states no date at all rather than a guessed one a later reader would treat as
    // evidence, so it cannot carry one.
    const guessed = await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-01-05", datePrecision: "unknown", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-unknown-with-a-date" } });
    expect(guessed.outcome).toBe("invalid");
    expect(refusedFieldsOf(guessed, "An unknown date carrying a day")).toEqual(["originalIntroductionOn"]);
  });
});

describe("a continuation is counted in elapsed seconds", () => {
  it("spans the same whole number of elapsed days as the seeded continuation", async () => {
    // The period is read from the seeded continuation rather than assumed here, so the elapsed-second
    // arithmetic asserted below is checked against the number the seed itself applied.
    const active = await referralList({ list: "active" });
    const rows: readonly { readonly referralId: string; readonly windowStart: string | null; readonly windowEnd: string | null }[] = active.data.items;
    const continued = rows.find((row) => row.referralId === "referral-ruth-continued");
    if (continued === undefined || continued.windowStart === null || continued.windowEnd === null) throw new Error("The seeded continuation states no window, so no elapsed period can be measured from it.");
    const elapsed = instant(continued.windowEnd).since(instant(continued.windowStart), { largestUnit: "seconds" });
    expect(elapsed.nanoseconds).toBe(0);
    expect(elapsed.seconds).toBe(CONTINUATION_DAYS * SECONDS_PER_DAY);
  });
  it("ends exactly the stated number of elapsed seconds after acceptance", () => {
    const acceptedAt = now();
    const window = continuedWindowFor(acceptedAt, CONTINUATION_DAYS);
    expect(window.endInstant.toString()).toBe(acceptedAt.add({ seconds: CONTINUATION_DAYS * SECONDS_PER_DAY }).toString());
    expect(window.elapsedSeconds).toBe(CONTINUATION_DAYS * SECONDS_PER_DAY);
    const elapsed = window.endInstant.since(acceptedAt, { largestUnit: "seconds" });
    expect(elapsed.seconds).toBe(2_592_000);
    expect(elapsed.nanoseconds).toBe(0);
  });
  it("is not the calendar-day reading when the window crosses a transition", () => {
    const acceptedAt = instant("2026-03-01T00:00:00Z");
    const continued = continuedWindowFor(acceptedAt, CONTINUATION_DAYS);
    expect(continued.endInstant.toString()).toBe("2026-03-31T00:00:00Z");
    const calendarReading = newWindowFor(acceptedAt.toZonedDateTimeISO(SOURCE_ZONE).toPlainDate().toString(), SOURCE_ZONE, CONTINUATION_DAYS);
    expect(calendarReading.resolvedEndInstant.toString()).toBe("2026-03-30T23:00:00Z");
    expect(continued.endInstant.equals(calendarReading.resolvedEndInstant)).toBe(false);
    expect(continued.endInstant.since(calendarReading.resolvedEndInstant, { largestUnit: "seconds" }).seconds).toBe(3_600);
  });
  it("refuses a cycle that is already continued, and a period that is not a whole number of days", () => {
    expect(continuedWindowEnd({ acceptedAt: now(), days: CONTINUATION_DAYS, cycle: { consumed: true } })).toEqual({ status: "refused", reason: "already-consumed" });
    expect(continuedWindowEnd({ acceptedAt: now(), days: CONTINUATION_DAYS, cycle: { consumed: false, successorId: "referral-jo-expired-continued" } })).toEqual({ status: "refused", reason: "already-consumed" });
    expect(continuedWindowEnd({ acceptedAt: now(), days: 0, cycle: { consumed: false } })).toEqual({ status: "refused", reason: "invalid-days" });
    expect(continuedWindowEnd({ acceptedAt: now(), days: -1, cycle: { consumed: false } })).toEqual({ status: "refused", reason: "invalid-days" });
  });
  it("is absent while the worker-continuation setting is off, which is the default", async () => {
    const detail = await referralDetail("referral-jo-expired");
    expect(detail.data.continuationPolicy.setting).toBe("off");
    expect(detail.data.continuationPolicy.reason).not.toBeNull();
    // Absent rather than disabled: the expired read offers no Continue action at all.
    expect(detail.actions).toEqual([]);
    const expired = await referralList({ list: "expired" });
    expect(expired.actions.map((action) => action.name)).not.toContain("continueReferral");
    expect(expired.data.continuationPolicy.setting).toBe("off");
    const refused = await continueReferral("referral-jo-expired", FIRST_REVISION);
    expect(isOutcome(refused)).toBe(true);
    expect(refused.outcome).toBe("denied");
    expect(denialReasonOf(refused, "Continuing while the setting is off")).toBe("capability-absent");
  });
  it("refuses a cycle that has not expired and one that is itself a continuation", async () => {
    const switched = await setScenario(SESSION_ID, "continuation-on");
    expect(switched.ok).toBe(true);
    const active = await continueReferral("referral-kenji-active", FIRST_REVISION);
    expect(active.outcome).toBe("invalid");
    expect(refusedFieldsOf(active, "Continuing a cycle still inside its window")).toEqual(["referralId"]);
    const continuation = await continueReferral("referral-ruth-continued", FIRST_REVISION);
    expect(continuation.outcome).toBe("invalid");
    expect(refusedFieldsOf(continuation, "Continuing a cycle that is itself a continuation")).toEqual(["referralId"]);
  });
  it("refuses a caller with no membership in the context", async () => {
    const switched = await setScenario(SESSION_ID, "continuation-on");
    expect(switched.ok).toBe(true);
    const claim: Scope = { ...scope, principalId: secondScope.principalId };
    const refused = await continueReferral("referral-jo-expired", FIRST_REVISION, { scope: claim, source: SECOND_SOURCE });
    expect(refused.outcome).toBe("denied");
    expect(denialReasonOf(refused, "Continuing in a ministry the caller is not admitted to")).toBe("no-membership");
    const read = await reads.referrals.readReferral("referral-jo-expired", SECOND_SOURCE);
    expect(read.kind).toBe("denied");
  });
});
describe("one cycle yields exactly one successor", () => {
  it("accepts one continuation and creates exactly one successor", async () => {
    const switched = await setScenario(SESSION_ID, "continuation-on");
    expect(switched.ok).toBe(true);
    const outcome = await continueReferral("referral-jo-expired", FIRST_REVISION);
    expect(isOutcome(outcome)).toBe(true);
    if (!isAccepted(outcome)) throw new Error(`Continuing the expired cycle answered "${outcome.outcome}".`);
    expect(outcome.revision).toBe("rev-2");
    expect(outcome.created).toEqual(["referral-jo-expired-continued"]);
    expect(outcome.changed).toEqual(["referral-jo-expired"]);
    const stored = await storedRecords();
    expect(successorsOf(stored.referrals, "referral-jo-expired")).toHaveLength(1);
    const consumed = await referralDetail("referral-jo-expired");
    if (consumed.data.view !== "expired-history") throw new Error("A continued cycle was still read in full.");
    expect(consumed.data.referral.consumed).toBe(true);
    const active = await referralList({ list: "active" });
    const rows: readonly { readonly referralId: string; readonly windowKind: string; readonly originalIntroductionOn: string | null; readonly cycleIndex: number }[] = active.data.items;
    const successor = rows.find((row) => row.referralId === "referral-jo-expired-continued");
    if (successor === undefined) throw new Error("The accepted continuation is not in the Active list.");
    expect(successor.windowKind).toBe("continued");
    expect(successor.originalIntroductionOn).toBe("2026-05-04");
    expect(successor.cycleIndex).toBe(1);
  });
  it("creates no second successor when a racing second Continue arrives", async () => {
    const switched = await setScenario(SESSION_ID, "continuation-on");
    expect(switched.ok).toBe(true);
    const first = await continueReferral("referral-jo-expired", FIRST_REVISION);
    if (!isAccepted(first)) throw new Error(`The first continuation answered "${first.outcome}".`);
    const race = conflictOf(await continueReferral("referral-jo-expired", FIRST_REVISION), "The racing second Continue");
    expect(race.outcome).toBe("conflict");
    expect(race.reason).toBe("stale-revision");
    expect(race.currentRevision).toBe("rev-2");
    expect(race.preservedInput).toEqual({ referralId: "referral-jo-expired" });
    const repeated = await continueReferral("referral-jo-expired", "rev-2");
    expect(repeated.outcome).toBe("unchanged");
    const stored = await storedRecords();
    expect(successorsOf(stored.referrals, "referral-jo-expired")).toHaveLength(1);
  });
  it("grants no consent, interest, introduction, interaction, send or task", async () => {
    const before = await storedRecords();
    const switched = await setScenario(SESSION_ID, "continuation-on");
    expect(switched.ok).toBe(true);
    const outcome = await continueReferral("referral-jo-expired", FIRST_REVISION);
    expect(outcome.outcome).toBe("accepted");
    const after = await storedRecords();
    expect(after.interactions).toEqual(before.interactions);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.notificationIntents).toEqual(before.notificationIntents);
    expect(after.gifts).toEqual(before.gifts);
    expect(after.referrals).toHaveLength(before.referrals.length + 1);
    const added = successorsOf(after.referrals, "referral-jo-expired");
    expect(added).toHaveLength(1);
    // The successor carries the original introduction date, so the continuation is not a new one.
    expect(added[0]?.originalIntroductionOn).toBe("2026-05-04");
    expect(added[0]?.cycleIndex).toBe(1);
    expect(added[0]?.windowKind).toBe("continued");
  });
});
const PERMITTED_EXPIRED_FIELDS = ["consumed", "continuation", "cycleIndex", "datePrecision", "originalIntroductionOn", "partnerDisplayName", "referralId", "sourceReference", "status", "windowEnd", "windowKind", "windowStart"];
const WITHHELD_FROM_EXPIRED_HISTORY = [
  "partnerId",
  "partnerKind",
  "contactMethods",
  "contactPermission",
  "email",
  "phone",
  "postalAddress",
  "location",
  "preciseLocation",
  "notes",
  "privateNote",
  "privateNotes",
  "referrer",
  "referrerContext",
  "gifts",
  "giftRows",
  "designation",
  "support",
  "consent",
  "deadline",
  "successorId",
  "predecessorId",
  "revision",
  "sourceZone",
];
describe("the permitted Expired history is narrow", () => {
  it("exposes identity, status and permitted dates, and omits each withheld field", async () => {
    const read = await referralDetail("referral-jo-expired");
    if (read.data.view !== "expired-history") throw new Error("An expired referral was read in full rather than as permitted history.");
    const row = read.data.referral;
    expect(Object.keys(row).sort()).toEqual(PERMITTED_EXPIRED_FIELDS);
    for (const field of WITHHELD_FROM_EXPIRED_HISTORY) {
      expect({ field, present: Object.hasOwn(row, field) }).toEqual({ field, present: false });
    }
    expect(row.partnerDisplayName).toBe("Jo Mbeki");
    expect(row.sourceReference).toEqual({ system: "crm", reference: "intro-4411" });
    expect(row.originalIntroductionOn).toBe("2026-05-04");
    expect(row.windowStart).toBe("2026-05-03T23:00:00Z");
    expect(row.windowEnd).toBe("2026-05-17T23:00:00Z");
    expect(row.status).toEqual({ status: "expired" });
  });
  it("gives the Expired list rows the same narrow shape", async () => {
    const expired = await referralList({ list: "expired" });
    if (expired.data.list !== "expired") throw new Error("The Expired list answered with another list.");
    expect(expired.data.items.length).toBeGreaterThan(0);
    for (const row of expired.data.items) {
      expect(Object.keys(row).sort()).toEqual(PERMITTED_EXPIRED_FIELDS);
      for (const field of WITHHELD_FROM_EXPIRED_HISTORY) {
        expect({ referralId: row.referralId, field, present: Object.hasOwn(row, field) }).toEqual({ referralId: row.referralId, field, present: false });
      }
    }
  });
});
