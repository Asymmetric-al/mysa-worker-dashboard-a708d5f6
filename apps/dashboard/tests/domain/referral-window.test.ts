/** Success criterion 15: the two referral windows keep two different semantics on purpose. */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type Scope } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { isOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { advanceClock, setClock, setScenario } from "@/modules/dev-runtime/scenario";
import { resetSession } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";
import { continuedWindowEnd, newWindowEnd, referralWindowState } from "@/modules/time/window";
import { expectEnvelope, firstSaying, requiredSaying, throwing } from "../helpers/answers";
import { layDownSeededSession, scopeOf, storedStateOf } from "../helpers/fixtures";
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
async function layDownSession(sessionId: string, workspace: string): Promise<void> {
  await layDownSeededSession(sessionId, workspace);
  const clock = await setClock(sessionId, 0);
  if (!clock.ok) throw new Error(`The scenario clock of "${sessionId}" could not be set to the seed instant: ${clock.error.code}.`);
}
beforeEach(async () => {
  await layDownSession(SESSION_ID, DEFAULT_SESSION_ID);
  await layDownSession(SECOND_SESSION_ID, "second-worker");
  scope = await scopeOf(SOURCE);
  secondScope = await scopeOf(SECOND_SOURCE);
});
afterEach(async () => {
  for (const sessionId of [SESSION_ID, SECOND_SESSION_ID]) {
    const restored = await setClock(sessionId, 0);
    if (!restored.ok) throw new Error(`The scenario clock of "${sessionId}" could not be restored to the seed instant: ${restored.error.code}.`);
  }
});
afterAll(async () => {
  for (const sessionId of [SESSION_ID, SECOND_SESSION_ID]) await resetSession(sessionId);
});
const instant = (value: string): Temporal.Instant => Temporal.Instant.from(value);
const civilDay = (value: string): Temporal.PlainDate => Temporal.PlainDate.from(value);
async function switchedToContinuationOn(): Promise<void> {
  const switched = await setScenario(SESSION_ID, "continuation-on");
  if (!switched.ok) throw new Error(`The continuation-on scenario could not be selected: ${switched.error.code}.`);
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
const referralList = async (query: ReferralListQuery, source: SessionSource = SOURCE) => expectEnvelope(await reads.referrals.readReferrals(query, source), "the referral list");
const referralDetail = async (referralId: string, source: SessionSource = SOURCE) => expectEnvelope(await reads.referrals.readReferral(referralId, source), `the referral "${referralId}"`);
function referralIdsOf(envelope: Awaited<ReturnType<typeof referralList>>): readonly string[] {
  const items: readonly { readonly referralId: string }[] = envelope.data.items;
  return items.map((row) => row.referralId);
}
const accepted = async (outcome: MutationOutcome, what: string): Promise<Extract<MutationOutcome, { outcome: "accepted" }>> => (outcome.outcome === "accepted" ? outcome : throwing(`${what} answered "${outcome.outcome}" instead of an acceptance.`));
const refusedFieldsOf = (outcome: MutationOutcome, what: string): readonly string[] => (outcome.outcome !== "invalid" ? throwing(`${what} answered "${outcome.outcome}" instead of a validation refusal.`) : Object.keys(outcome.fields));
const denialReasonOf = (outcome: MutationOutcome, what: string): string => (outcome.outcome !== "denied" ? throwing(`${what} answered "${outcome.outcome}" instead of a denial.`) : outcome.reasonCode);
const continueReferral = async (referralId: string, expectedRevision: string, options: { readonly scope?: Scope; readonly source?: SessionSource } = {}): Promise<MutationOutcome> =>
  mutations.referrals.continueReferral({ operationId: newOperationId(), scope: options.scope ?? scope, expectedRevision, payload: { referralId } }, options.source ?? SOURCE);
type IntroductionPayload = { readonly partnerId: string; readonly originalIntroductionOn?: string; readonly datePrecision: string; readonly sourceZone: string; readonly sourceReference: { readonly system: string; readonly reference: string } };
const recordIntroduction = async (payload: IntroductionPayload): Promise<MutationOutcome> => mutations.referrals.recordIntroduction({ operationId: newOperationId(), scope, expectedRevision: FIRST_REVISION, payload }, SOURCE);
type StoredRecords = Pick<SessionStateDocument, "interactions" | "tasks" | "memberships" | "notificationIntents" | "gifts" | "referrals">;
const successorsOf = (referrals: StoredRecords["referrals"], predecessorId: string): StoredRecords["referrals"] => referrals.filter((cycle) => cycle.predecessorId === predecessorId);
type NewWindowCase = { readonly shown: string; readonly openedOn: string; readonly zone: string; readonly endInstant: string; readonly resolution: string; readonly disagrees: boolean };
const NEW_WINDOW_CASES: readonly NewWindowCase[] = [
  { shown: "takes the original introduction date as day one and names the last included day", openedOn: "2026-11-12", zone: SOURCE_ZONE, endInstant: "2026-11-26T00:00:00Z", resolution: "aligned", disagrees: false },
  { shown: "moves the endpoint past a gap at local midnight and flags that the wording no longer matches", openedOn: "2026-08-23", zone: "America/Santiago", endInstant: "2026-09-06T04:00:00Z", resolution: "gap-shifted", disagrees: true },
  { shown: "uses the earlier of two offsets when midnight happens twice", openedOn: "2026-10-18", zone: "America/Havana", endInstant: "2026-11-01T04:00:00Z", resolution: "overlap-earlier", disagrees: false },
  { shown: "uses the next existing date when the civil date itself was skipped", openedOn: "2011-12-16", zone: "Pacific/Apia", endInstant: "2011-12-30T10:00:00Z", resolution: "gap-shifted", disagrees: true },
];
const WORDING_CASES: readonly { readonly shown: string; readonly openedOn: string; readonly zone: string; readonly wording: string }[] = [
  { shown: "states the calendar-day wording an aligned endpoint matches", openedOn: "2026-11-12", zone: SOURCE_ZONE, wording: "Active through 25 November 2026" },
  { shown: "states the calendar-day wording beside an endpoint a transition moved", openedOn: "2026-08-23", zone: "America/Santiago", wording: "Active through 5 September 2026" },
];
it.each(NEW_WINDOW_CASES)("$shown", ({ openedOn, zone, endInstant, resolution, disagrees }) => {
  const window = newWindowFor(openedOn, zone, NEW_WINDOW_DAYS);
  const nominalLastIncludedOn = civilDay(openedOn).add({ days: NEW_WINDOW_DAYS - 1 });
  expect(window.nominalLastIncludedOn.toString()).toBe(nominalLastIncludedOn.toString()); // D is day one, so a fourteen-day window's last nominal included day is D + 13 and never D + 14.
  expect([window.resolvedEndInstant.toString(), window.resolution]).toEqual([endInstant, resolution]);
  expect(window.nominalDisagreesWithResolved).toBe(disagrees);
});
it.each(WORDING_CASES)("$shown", ({ openedOn, zone, wording }) => expect(newWindowFor(openedOn, zone, NEW_WINDOW_DAYS).nominalWording).toBe(wording));
it("the New window is counted in calendar days in the source zone: expires at the exclusive endpoint and is still Active one millisecond before it", () => {
  const endpoint = newWindowFor("2026-11-12", SOURCE_ZONE, NEW_WINDOW_DAYS).resolvedEndInstant;
  const readings: readonly (readonly [Temporal.Instant, string])[] = [
    [instant("2026-11-25T00:00:00Z"), "active"],
    [instant("2026-11-25T23:59:59.999Z"), "active"],
    [endpoint, "expired"],
    [endpoint.add({ milliseconds: 1 }), "expired"],
    [
      civilDay("2026-11-12")
        .add({ days: NEW_WINDOW_DAYS - 1 })
        .toZonedDateTime(SOURCE_ZONE)
        .toInstant(),
      "active",
    ],
    [civilDay("2026-11-12").add({ days: NEW_WINDOW_DAYS }).toZonedDateTime(SOURCE_ZONE).toInstant(), "expired"],
  ];
  for (const [reading, status] of readings) expect(referralWindowState({ windowEnd: endpoint, now: reading })).toEqual({ status });
});
it("the New window is counted in calendar days in the source zone: uses the first valid instant after a gap at local midnight", () => {
  const gap = newWindowFor("2026-08-23", "America/Santiago", NEW_WINDOW_DAYS); // America/Santiago begins daylight saving at 00:00 local on 2026-09-06, so that wall time does not exist and the day starts at 01:00 (−03) = 04:00 UTC.
  expect(gap.resolvedEndInstant.toZonedDateTimeISO("America/Santiago").toPlainDateTime().toString()).toBe("2026-09-06T01:00:00");
  const laterReading = Temporal.PlainDateTime.from("2026-09-06T00:00").toZonedDateTime("America/Santiago", { disambiguation: "later" }).toInstant();
  const earlierReading = Temporal.PlainDateTime.from("2026-09-06T00:00").toZonedDateTime("America/Santiago", { disambiguation: "earlier" }).toInstant();
  expect(laterReading.toString()).toBe(gap.resolvedEndInstant.toString());
  expect(Temporal.Instant.compare(earlierReading, gap.resolvedEndInstant)).toBeLessThan(0);
});
it("the New window is counted in calendar days in the source zone: uses the earlier of two offsets when midnight happens twice", () => {
  const overlap = newWindowFor("2026-10-18", "America/Havana", NEW_WINDOW_DAYS); // America/Havana ends daylight saving at 01:00 local on 2026-11-01, so 00:00 happens twice; the earlier occurrence (−04) is the reader's.
  const laterOffsetReading = Temporal.PlainDateTime.from("2026-11-01T00:00").toZonedDateTime("America/Havana", { disambiguation: "later" }).toInstant();
  expect([laterOffsetReading.toString(), overlap.resolvedEndInstant.until(laterOffsetReading, { largestUnit: "seconds" }).seconds]).toEqual(["2026-11-01T05:00:00Z", 3_600]);
});
it("the New window is counted in calendar days in the source zone: uses the next existing date when the civil date itself was skipped", () => {
  const skipped = newWindowFor("2011-12-16", "Pacific/Apia", NEW_WINDOW_DAYS); // Pacific/Apia skipped 2011-12-30 entirely, so the endpoint lands on the next existing date rather than a fabricated one.
  expect([skipped.resolvedEndInstant.toZonedDateTimeISO("Pacific/Apia").toPlainDate().toString(), newWindowFor("2011-12-17", "Pacific/Apia", NEW_WINDOW_DAYS).resolvedEndInstant.toString()]).toEqual(["2011-12-31", skipped.resolvedEndInstant.toString()]);
});
it("the resolved endpoint is a value, not a recomputation: reports the same endpoint after the scenario clock travels", async () => {
  const before = await referralDetail("referral-kenji-active");
  if (before.data.view !== "detail") throw new Error("A referral inside its window was read as expired history.");
  const deadline = before.data.referral.deadline;
  if (deadline === null) throw new Error("A referral inside its window states no deadline.");
  expect([deadline.end, deadline.nominal?.wording, deadline.nominal?.disagreesWithResolved]).toEqual(["2026-11-26T00:00:00Z", "Active through 25 November 2026", false]);
  expect((await advanceClock(SESSION_ID, 9 * MILLISECONDS_PER_DAY)).ok).toBe(true); // Nine days later the window has ended: the read's `asOf` moves while the endpoint it reports is still the stored instant.
  const after = await referralDetail("referral-kenji-active");
  expect(after.asOf).not.toBe(before.asOf);
  if (after.data.view !== "expired-history") throw new Error("The referral whose window had ended was still read in full.");
  expect([[after.data.referral.windowEnd, after.data.referral.windowStart], after.data.referral.status]).toEqual([[deadline.end, "2026-11-12T00:00:00Z"], { status: "expired" }]);
});
it("the resolved endpoint is a value, not a recomputation: derives the endpoint from the original date, so a late first entry is already Expired", async () => {
  const outcome = await accepted(await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-01-05", datePrecision: "date", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-late-first-entry" } }), "Recording the late introduction");
  const referralId = requiredSaying(outcome.created?.[0], "The accepted introduction named no referral.");
  const read = await referralDetail(referralId);
  if (read.data.view !== "expired-history") throw new Error("A late first entry was briefly activated instead of being read as already Expired.");
  const window = newWindowFor("2026-01-05", SOURCE_ZONE, NEW_WINDOW_DAYS);
  expect([[read.data.referral.windowStart, read.data.referral.windowEnd], read.data.referral.status]).toEqual([["2026-01-05T00:00:00Z", window.resolvedEndInstant.toString()], { status: "expired" }]);
  expect(read.data.referral.windowStart).not.toBe(now().toString());
  // A window that started today would end fourteen elapsed days from now, which is not this endpoint.
  expect(read.data.referral.windowEnd).not.toBe(
    now()
      .add({ hours: NEW_WINDOW_DAYS * 24 })
      .toString(),
  );
  expect(Temporal.Instant.compare(window.resolvedEndInstant, now())).toBeLessThan(0);
  expect(referralIdsOf(await referralList({ list: "active" }))).not.toContain(referralId);
  expect(referralIdsOf(await referralList({ list: "expired" }))).toContain(referralId);
});
type ImpreciseCase = { readonly shown: string; readonly referralId: string; readonly precision: string; readonly originalIntroductionOn: string | null };
const IMPRECISE_CASES: readonly ImpreciseCase[] = [
  { shown: "gives an unknown date no deadline, no judgement and no Continue", referralId: "referral-sara-unknown", precision: "unknown", originalIntroductionOn: null },
  { shown: "gives an approximate date no deadline, no judgement and no Continue", referralId: "referral-hana-approximate", precision: "approximate", originalIntroductionOn: "2026-09-10" },
];
it.each(IMPRECISE_CASES)("$shown", async ({ referralId, precision, originalIntroductionOn }) => {
  const read = await referralDetail(referralId);
  if (read.data.view !== "detail") throw new Error("An imprecise referral was read as expired history.");
  const referral = read.data.referral;
  expect([[referral.datePrecision, referral.originalIntroductionOn], referral.status]).toEqual([[precision, originalIntroductionOn], { status: "no-deadline" }]);
  expect(referral.windowStart).toBeNull();
  expect(referral.windowEnd).toBeNull();
  expect(referral.deadline).toBeNull();
  expect(referral.continuation.available).toBe(false);
  expect(read.actions).toEqual([]);
});
it("an imprecise introduction date has no deadline: refuses the deadline at the boundary function as well, for an unknown precision and for an absent endpoint", () => {
  expect([newWindowEnd({ originalIntroductionOn: civilDay("2026-09-10"), datePrecision: "unknown", sourceZone: SOURCE_ZONE, days: NEW_WINDOW_DAYS }), referralWindowState({ windowEnd: undefined, now: now() })]).toEqual([{ status: "no-deadline", reason: "imprecise-date" }, { status: "no-deadline" }]);
});
it("an imprecise introduction date has no deadline: records an approximate introduction that carries the date it states and still no window", async () => {
  const outcome = await accepted(await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-09-10", datePrecision: "approximate", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-approximate-entry" } }), "Recording the approximate introduction");
  const created = await referralDetail(requiredSaying(outcome.created?.[0], "The accepted introduction named no referral."));
  if (created.data.view !== "detail") throw new Error("A newly recorded approximate introduction was read as expired history.");
  expect(created.data.referral.windowStart).toBeNull();
  expect(created.data.referral.windowEnd).toBeNull();
  expect(created.data.referral.status).toEqual({ status: "no-deadline" });
});
it("an imprecise introduction date has no deadline: keeps an imprecise introduction out of both judged lists", async () => {
  const incomplete = referralIdsOf(await referralList({ list: "incomplete-date" }));
  const active = referralIdsOf(await referralList({ list: "active" }));
  const expired = referralIdsOf(await referralList({ list: "expired" }));
  expect(incomplete).toEqual(expect.arrayContaining(["referral-hana-approximate", "referral-sara-unknown"]));
  for (const referralId of ["referral-hana-approximate", "referral-sara-unknown"]) {
    expect([
      { referralId, active: active.includes(referralId) },
      { referralId, expired: expired.includes(referralId) },
    ]).toEqual([
      { referralId, active: false },
      { referralId, expired: false },
    ]);
  }
});
it("an imprecise introduction date has no deadline: closes the precision vocabulary at date, approximate and unknown", async () => {
  const observed = [...new Set(((await storedStateOf(SESSION_ID)) as StoredRecords).referrals.map((cycle) => cycle.datePrecision))].sort();
  expect(observed).toHaveLength(3);
  expect(observed).toEqual(["approximate", "date", "unknown"]);
  // A fourth precision cannot be added silently: the schema that would have to accept it refuses it, and an unknown date states no date at all.
  const fourth = await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-01-05", datePrecision: "guess", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-fourth-precision" } });
  expect(fourth.outcome).toBe("invalid");
  expect(refusedFieldsOf(fourth, "A fourth date precision")).toEqual(["datePrecision"]);
  const guessed = await recordIntroduction({ partnerId: "partner-jo-mbeki", originalIntroductionOn: "2026-01-05", datePrecision: "unknown", sourceZone: SOURCE_ZONE, sourceReference: { system: "crm", reference: "intro-unknown-with-a-date" } });
  expect(guessed.outcome).toBe("invalid");
  expect(refusedFieldsOf(guessed, "An unknown date carrying a day")).toEqual(["originalIntroductionOn"]);
});
it("a continuation is counted in elapsed seconds: spans the same whole number of elapsed days as the seeded continuation", async () => {
  const rows: readonly { readonly referralId: string; readonly windowStart: string | null; readonly windowEnd: string | null }[] = (await referralList({ list: "active" })).data.items;
  const continued = rows.find((row) => row.referralId === "referral-ruth-continued");
  if (continued === undefined || continued.windowStart === null || continued.windowEnd === null) throw new Error("The seeded continuation states no window, so no elapsed period can be measured from it.");
  const elapsed = instant(continued.windowEnd).since(instant(continued.windowStart), { largestUnit: "seconds" });
  expect([elapsed.nanoseconds, elapsed.seconds]).toEqual([0, CONTINUATION_DAYS * SECONDS_PER_DAY]);
});
it("a continuation is counted in elapsed seconds: ends exactly the stated number of elapsed seconds after acceptance", () => {
  const acceptedAt = now();
  const window = continuedWindowFor(acceptedAt, CONTINUATION_DAYS);
  expect([window.endInstant.toString(), window.elapsedSeconds]).toEqual([acceptedAt.add({ seconds: CONTINUATION_DAYS * SECONDS_PER_DAY }).toString(), CONTINUATION_DAYS * SECONDS_PER_DAY]);
  const elapsed = window.endInstant.since(acceptedAt, { largestUnit: "seconds" });
  expect([elapsed.seconds, elapsed.nanoseconds]).toEqual([2_592_000, 0]);
});
it("a continuation is counted in elapsed seconds: is not the calendar-day reading when the window crosses a transition", () => {
  const acceptedAt = instant("2026-03-01T00:00:00Z");
  const continued = continuedWindowFor(acceptedAt, CONTINUATION_DAYS);
  expect(continued.endInstant.toString()).toBe("2026-03-31T00:00:00Z");
  const calendarReading = newWindowFor(acceptedAt.toZonedDateTimeISO(SOURCE_ZONE).toPlainDate().toString(), SOURCE_ZONE, CONTINUATION_DAYS);
  expect([calendarReading.resolvedEndInstant.toString(), continued.endInstant.equals(calendarReading.resolvedEndInstant), continued.endInstant.since(calendarReading.resolvedEndInstant, { largestUnit: "seconds" }).seconds]).toEqual(["2026-03-30T23:00:00Z", false, 3_600]);
});
it("a continuation is counted in elapsed seconds: refuses a cycle that is already continued, and a period that is not a whole number of days", () => {
  const refusals: readonly (readonly [Parameters<typeof continuedWindowEnd>[0], string])[] = [
    [{ acceptedAt: now(), days: CONTINUATION_DAYS, cycle: { consumed: true } }, "already-consumed"],
    [{ acceptedAt: now(), days: CONTINUATION_DAYS, cycle: { consumed: false, successorId: "referral-jo-expired-continued" } }, "already-consumed"],
    [{ acceptedAt: now(), days: 0, cycle: { consumed: false } }, "invalid-days"],
    [{ acceptedAt: now(), days: -1, cycle: { consumed: false } }, "invalid-days"],
  ];
  for (const [input, reason] of refusals) expect(continuedWindowEnd(input)).toEqual({ status: "refused", reason });
});
it("a continuation is counted in elapsed seconds: is absent while the worker-continuation setting is off, which is the default", async () => {
  const detail = await referralDetail("referral-jo-expired");
  expect(detail.data.continuationPolicy.setting).toBe("off");
  expect(detail.data.continuationPolicy.reason).not.toBeNull();
  expect(detail.actions).toEqual([]); // Absent rather than disabled: the expired read offers no Continue action at all.
  const expired = await referralList({ list: "expired" });
  expect(expired.actions.map((action) => action.name)).not.toContain("continueReferral");
  expect(expired.data.continuationPolicy.setting).toBe("off");
  const refused = await continueReferral("referral-jo-expired", FIRST_REVISION);
  expect([isOutcome(refused), refused.outcome, denialReasonOf(refused, "Continuing while the setting is off")]).toEqual([true, "denied", "capability-absent"]);
});
it("a continuation is counted in elapsed seconds: refuses a cycle that has not expired and one that is itself a continuation", async () => {
  await switchedToContinuationOn();
  const active = await continueReferral("referral-kenji-active", FIRST_REVISION);
  expect(active.outcome).toBe("invalid");
  expect(refusedFieldsOf(active, "Continuing a cycle still inside its window")).toEqual(["referralId"]);
  const continuation = await continueReferral("referral-ruth-continued", FIRST_REVISION);
  expect(continuation.outcome).toBe("invalid");
  expect(refusedFieldsOf(continuation, "Continuing a cycle that is itself a continuation")).toEqual(["referralId"]);
});
it("a continuation is counted in elapsed seconds: refuses a caller with no membership in the context", async () => {
  await switchedToContinuationOn();
  const claim: Scope = { ...scope, principalId: secondScope.principalId };
  const refused = await continueReferral("referral-jo-expired", FIRST_REVISION, { scope: claim, source: SECOND_SOURCE });
  expect([refused.outcome, denialReasonOf(refused, "Continuing in a ministry the caller is not admitted to"), (await reads.referrals.readReferral("referral-jo-expired", SECOND_SOURCE)).kind]).toEqual(["denied", "no-membership", "denied"]);
});
it("one cycle yields exactly one successor: accepts one continuation and creates exactly one successor", async () => {
  await switchedToContinuationOn();
  const outcome = await accepted(await continueReferral("referral-jo-expired", FIRST_REVISION), "Continuing the expired cycle");
  expect([[isOutcome(outcome), outcome.revision], outcome.created, outcome.changed]).toEqual([[true, "rev-2"], ["referral-jo-expired-continued"], ["referral-jo-expired"]]);
  expect(successorsOf(((await storedStateOf(SESSION_ID)) as StoredRecords).referrals, "referral-jo-expired")).toHaveLength(1);
  const consumed = await referralDetail("referral-jo-expired");
  if (consumed.data.view !== "expired-history") throw new Error("A continued cycle was still read in full.");
  expect(consumed.data.referral.consumed).toBe(true);
  const rows: readonly { readonly referralId: string; readonly windowKind: string; readonly originalIntroductionOn: string | null; readonly cycleIndex: number }[] = (await referralList({ list: "active" })).data.items;
  const successor = firstSaying(rows, "referralId", "referral-jo-expired-continued", "The accepted continuation is not in the Active list.");
  expect([successor.windowKind, successor.originalIntroductionOn, successor.cycleIndex]).toEqual(["continued", "2026-05-04", 1]);
});
it("one cycle yields exactly one successor: creates no second successor when a racing second Continue arrives", async () => {
  await switchedToContinuationOn();
  if ((await continueReferral("referral-jo-expired", FIRST_REVISION)).outcome !== "accepted") throw new Error("The first continuation was not accepted.");
  const race = await continueReferral("referral-jo-expired", FIRST_REVISION);
  expect(race.outcome).toBe("conflict");
  if (race.outcome !== "conflict") throw new Error(`The racing second Continue answered "${race.outcome}" instead of a conflict.`);
  expect([[race.reason, race.currentRevision], race.preservedInput]).toEqual([["stale-revision", "rev-2"], { referralId: "referral-jo-expired" }]);
  expect((await continueReferral("referral-jo-expired", "rev-2")).outcome).toBe("unchanged");
  expect(successorsOf(((await storedStateOf(SESSION_ID)) as StoredRecords).referrals, "referral-jo-expired")).toHaveLength(1);
});
it("one cycle yields exactly one successor: grants no consent, interest, introduction, interaction, send or task", async () => {
  const before = (await storedStateOf(SESSION_ID)) as StoredRecords;
  await switchedToContinuationOn();
  expect((await continueReferral("referral-jo-expired", FIRST_REVISION)).outcome).toBe("accepted");
  const after = (await storedStateOf(SESSION_ID)) as StoredRecords;
  expect([after.interactions, after.tasks, after.memberships, after.notificationIntents, after.gifts]).toEqual([before.interactions, before.tasks, before.memberships, before.notificationIntents, before.gifts]);
  expect(after.referrals).toHaveLength(before.referrals.length + 1);
  const added = successorsOf(after.referrals, "referral-jo-expired");
  expect(added).toHaveLength(1);
  expect([added[0]?.originalIntroductionOn, added[0]?.cycleIndex, added[0]?.windowKind]).toEqual(["2026-05-04", 1, "continued"]); // The successor carries the original introduction date, so the continuation is not a new one.
});
const PERMITTED_EXPIRED_FIELDS = ["consumed", "continuation", "cycleIndex", "datePrecision", "originalIntroductionOn", "partnerDisplayName", "referralId", "sourceReference", "status", "windowEnd", "windowKind", "windowStart"];
const WITHHELD_FROM_EXPIRED_HISTORY = "partnerId partnerKind contactMethods contactPermission email phone postalAddress location preciseLocation notes privateNote privateNotes referrer referrerContext gifts giftRows designation support consent deadline successorId predecessorId revision sourceZone".split(" ");
it("the permitted Expired history is narrow: exposes identity, status and permitted dates, and omits each withheld field", async () => {
  const read = await referralDetail("referral-jo-expired");
  if (read.data.view !== "expired-history") throw new Error("An expired referral was read in full rather than as permitted history.");
  const row = read.data.referral;
  expect(Object.keys(row).sort()).toEqual(PERMITTED_EXPIRED_FIELDS);
  for (const field of WITHHELD_FROM_EXPIRED_HISTORY) expect({ field, present: Object.hasOwn(row, field) }).toEqual({ field, present: false });
  expect(row.partnerDisplayName).toBe("Jo Mbeki");
  expect([row.sourceReference, [row.originalIntroductionOn, row.windowStart, row.windowEnd], row.status]).toEqual([{ system: "crm", reference: "intro-4411" }, ["2026-05-04", "2026-05-03T23:00:00Z", "2026-05-17T23:00:00Z"], { status: "expired" }]);
});
it("the permitted Expired history is narrow: gives the Expired list rows the same narrow shape", async () => {
  const expired = await referralList({ list: "expired" });
  if (expired.data.list !== "expired") throw new Error("The Expired list answered with another list.");
  expect(expired.data.items.length).toBeGreaterThan(0);
  for (const row of expired.data.items) {
    expect(Object.keys(row).sort()).toEqual(PERMITTED_EXPIRED_FIELDS);
    for (const field of WITHHELD_FROM_EXPIRED_HISTORY) expect({ referralId: row.referralId, field, present: Object.hasOwn(row, field) }).toEqual({ referralId: row.referralId, field, present: false });
  }
});
