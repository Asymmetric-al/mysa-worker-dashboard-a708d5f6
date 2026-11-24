/** Success criterion 10: the 24-hour notification usefulness window, and the honesty of what a submission of a notice reports. */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type NotificationIntentRecord, type NotificationSendResultRecord, type Scope } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { isOutcome, type FieldMessages, type MutationOutcome } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { advanceClock, setClock } from "@/modules/dev-runtime/scenario";
import { readSession, resetSession } from "@/modules/store/repository";
import { SEED_INSTANT, now } from "@/modules/time/clock";
import { NOTIFICATION_USEFULNESS_HOURS, notificationDeadline, type NotificationDeadlineResult } from "@/modules/time/window";
import { expectEnvelope, firstSaying, requiredSaying, throwing } from "../helpers/answers";
import { layDownSeededSession, scopeOf, storedStateOf } from "../helpers/fixtures";
const SESSION_ID = "domain-notification-window";
const SOURCE: SessionSource = { sessionId: SESSION_ID };
const DOCUMENT_ID = "doc-update-autumn";
const PUBLIC_EDITION = "release-update-fr-1";
const SUPPORTER_EDITION = "release-update-en-approved-supporter-1";
/** The one intent the seed already recorded, so every count in this file has a known starting point. */
const SEEDED_INTENT_ID = "intent-update-autumn-en";
const PUBLISHER_ID = "publisher-harbour";
const PURPOSE = "update-email";
const FIRST_REVISION = "rev-1";
const DST_INTENDED_AT = "2026-10-24T12:00:00Z";
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_HOUR = 60 * 60 * MILLISECONDS_PER_SECOND;
/** The window the specification fixes, in elapsed milliseconds: deliberately not a calendar day. */
const USEFULNESS_MILLISECONDS = 24 * MILLISECONDS_PER_HOUR;
/** The closed vocabulary a recorded per-recipient outcome may use, restated here as the assertion's own expectation rather than read back off the implementation: a copy is accepted, failed or unknown, and none of the three claims a delivery or a reading. */
const SEND_RESULT_STATES = ["accepted", "failed", "unknown"] as const;
/** The words that would state a delivery, a reading or a receipt, none of which this release records. */
const DELIVERY_WORDS: ReadonlySet<string> = new Set(["deliver", "delivered", "delivery", "read", "reads", "reading", "open", "opened", "receipt"]);
const claimsDeliveryOrReading = (member: string): boolean => member.split(/(?=[A-Z])/u).some((word) => DELIVERY_WORDS.has(word.toLowerCase()));
let scope: Scope;
async function moveClockToOffset(offsetMilliseconds: number): Promise<void> {
  const moved = await setClock(SESSION_ID, offsetMilliseconds);
  if (!moved.ok) throw new Error(`The scenario clock of "${SESSION_ID}" could not be set to an offset of ${String(offsetMilliseconds)} ms: ${moved.error.code}.`);
}
async function moveClockTo(instant: Temporal.Instant): Promise<void> {
  await moveClockToOffset(instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds);
  // Every boundary is judged against the scenario clock, so a case that thinks it moved the clock reads the instant back instead of assuming the move took effect.
  if (now().epochMilliseconds !== instant.epochMilliseconds) throw new Error(`The scenario clock reads ${now().toString()} rather than ${instant.toString()}.`);
}
async function layDownSession(offsetMilliseconds = 0): Promise<void> {
  await layDownSeededSession(SESSION_ID, DEFAULT_SESSION_ID);
  await moveClockToOffset(offsetMilliseconds);
}
/** Clears an armed simulated failure, so no case inherits one. */
async function disarmAnyArmedFailure(): Promise<void> {
  const documents = await readSession(SESSION_ID);
  const meta: unknown = documents === undefined ? undefined : documents.meta;
  if (typeof meta !== "object" || meta === null) return;
  const plan: unknown = Reflect.get(meta, "failurePlan");
  if (plan === null || plan === undefined) return;
  const dev = await reads.dev.readDevState(SOURCE);
  if (dev.kind !== "envelope") return;
  await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope, expectedRevision: dev.envelope.revision, payload: { plan: null } }, SOURCE);
}
beforeEach(async () => {
  await layDownSession();
  scope = await scopeOf(SOURCE);
});
afterEach(async () => {
  await disarmAnyArmedFailure();
  await moveClockToOffset(0);
});
afterAll(async () => {
  await resetSession(SESSION_ID); // The session is this file's own, so the store is left holding none of its fixtures.
});
type NoticeRequest = { readonly operationId?: string; readonly releaseId?: string; readonly intendedAt?: Temporal.Instant };
async function requestNotice(options: NoticeRequest = {}): Promise<MutationOutcome> {
  const payload: { documentId: string; releaseId: string; intendedAt?: string } = { documentId: DOCUMENT_ID, releaseId: options.releaseId ?? PUBLIC_EDITION };
  if (options.intendedAt !== undefined) payload.intendedAt = options.intendedAt.toString();
  return mutations.updates.requestNotification(SESSION_ID, { operationId: options.operationId ?? newOperationId(), scope, expectedRevision: FIRST_REVISION, payload });
}
type StoredNotificationRecords = Pick<SessionStateDocument, "notificationIntents" | "notificationResults" | "memberships">;
const intentForRelease = (intents: readonly NotificationIntentRecord[], releaseId: string): NotificationIntentRecord => firstSaying(intents, "releaseId", releaseId, `No notification intent was recorded for the edition "${releaseId}".`);
const resultForIntent = (results: readonly NotificationSendResultRecord[], intentId: string): NotificationSendResultRecord => firstSaying(results, "intentId", intentId, `No send result was recorded for the intent "${intentId}".`);
const recipientRowCount = (records: StoredNotificationRecords): number => records.notificationResults.reduce((total, result) => total + result.recipients.length, 0);
const outcomeNameOf = (outcome: MutationOutcome): string => (isOutcome(outcome) ? outcome.outcome : throwing("A mutation answered with a value that is not one of the eight outcomes."));
const acceptanceOf = (outcome: MutationOutcome, what: string): Extract<MutationOutcome, { outcome: "accepted" }> => (isOutcome(outcome) && outcome.outcome === "accepted" ? outcome : throwing(`${what} answered "${outcomeNameOf(outcome)}" instead of an acceptance.`));
const unknownOf = (outcome: MutationOutcome, what: string): Extract<MutationOutcome, { outcome: "unknown" }> => (isOutcome(outcome) && outcome.outcome === "unknown" ? outcome : throwing(`${what} answered "${outcomeNameOf(outcome)}" instead of an uncertain outcome.`));
function alreadyAcceptedOf(outcome: MutationOutcome, what: string): Extract<MutationOutcome, { outcome: "alreadyAccepted" }> {
  if (!isOutcome(outcome) || outcome.outcome !== "alreadyAccepted") throw new Error(`${what} answered "${outcomeNameOf(outcome)}" instead of recovering the stored result.`);
  return outcome;
}
const refusalFieldsOf = (outcome: MutationOutcome, what: string): FieldMessages => (!isOutcome(outcome) || outcome.outcome !== "invalid" ? throwing(`${what} answered "${outcomeNameOf(outcome)}" instead of a validation refusal.`) : outcome.fields);
function usefulnessMessage(fields: FieldMessages, what: string): string {
  const messages = fields.intendedAt;
  if (messages === undefined || messages.length === 0) throw new Error(`${what} was refused for ${Object.keys(fields).join(", ") || "no named field"} rather than for the instant its usefulness window runs from.`);
  return messages.join(" ");
}
const withinUsefulness = (result: NotificationDeadlineResult, what: string): Extract<NotificationDeadlineResult, { status: "within-usefulness" }> => (result.status === "within-usefulness" ? result : throwing(`${what} fell outside the usefulness window.`));
const pastUsefulness = (result: NotificationDeadlineResult, what: string): Extract<NotificationDeadlineResult, { status: "past-usefulness" }> => (result.status === "past-usefulness" ? result : throwing(`${what} was still inside the usefulness window.`));
type SubmissionView = { readonly intentId: string; readonly ceilingCount: number; readonly recipientIds: readonly string[]; readonly members: readonly string[] };
function submissionViewOf(value: unknown): SubmissionView {
  if (typeof value !== "object" || value === null) throw new Error("The recovered result is not the submission view a notice answers with.");
  const intentId: unknown = Reflect.get(value, "intentId");
  const ceilingCount: unknown = Reflect.get(value, "ceilingCount");
  const recipients: unknown = Reflect.get(value, "recipients");
  if (typeof intentId !== "string" || typeof ceilingCount !== "number" || !Array.isArray(recipients)) throw new Error("The recovered result states no intent, ceiling and recipient list, so it is not a submission view.");
  const recipientIds = recipients.map((copy: unknown) => {
    const recipientId: unknown = typeof copy === "object" && copy !== null ? Reflect.get(copy, "recipientId") : undefined;
    if (typeof recipientId !== "string") throw new Error("A recipient of the recovered submission is stated without the identity its copy was pinned to.");
    return recipientId;
  });
  return { intentId, ceilingCount, recipientIds, members: Object.keys(value) };
}
function recipientRenditionsOf(records: StoredNotificationRecords, when: string): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const byIntent = new Map<string, ReadonlyMap<string, string>>();
  for (const result of records.notificationResults) {
    const byRecipient = new Map<string, string>();
    for (const copy of result.recipients) {
      if (copy.renditionId.length === 0) throw new Error(`On ${when}, the copy recorded for "${copy.recipientId}" names no rendition, so it is pinned to nothing.`);
      if (byRecipient.has(copy.recipientId)) throw new Error(`On ${when}, the intent "${result.intentId}" records more than one copy for "${copy.recipientId}", so that person received more than one rendition.`);
      byRecipient.set(copy.recipientId, copy.renditionId);
    }
    byIntent.set(result.intentId, byRecipient);
  }
  return byIntent;
}
it("the deadline is the intended instant plus 24 elapsed hours: places the deadline exactly 86,400 seconds after the instant the notice was meant for", () => {
  expect(NOTIFICATION_USEFULNESS_HOURS).toBe(24); // The fixed value the specification states, pinned here so the arithmetic below cannot drift from it.
  const intendedAt = SEED_INSTANT.subtract({ hours: 5 });
  const atIntended = withinUsefulness(notificationDeadline({ intendedAt, now: intendedAt }), "A notice read at the instant it was intended for");
  expect([atIntended.deadlineInstant.epochMilliseconds - intendedAt.epochMilliseconds, atIntended.remainingMilliseconds]).toEqual([USEFULNESS_MILLISECONDS, USEFULNESS_MILLISECONDS]);
  const justInside = withinUsefulness(notificationDeadline({ intendedAt, now: intendedAt.add({ milliseconds: USEFULNESS_MILLISECONDS - 1 }) }), "A notice read one millisecond inside the window");
  expect(justInside.remainingMilliseconds).toBe(1);
  // The equality case, asserted from the deadline's own side: the same instant either way, so the deadline does not move with the moment it is read at.
  const atDeadline = pastUsefulness(notificationDeadline({ intendedAt, now: intendedAt.add({ milliseconds: USEFULNESS_MILLISECONDS }) }), "A notice read at the deadline itself");
  expect([atDeadline.deadlineInstant.epochMilliseconds, atDeadline.deadlineInstant.epochMilliseconds - intendedAt.epochMilliseconds, "remainingMilliseconds" in atDeadline]).toEqual([atIntended.deadlineInstant.epochMilliseconds, USEFULNESS_MILLISECONDS, false]);
});
it("the deadline is the intended instant plus 24 elapsed hours: derives the deadline from the intended instant rather than from the moment of the request", async () => {
  const intendedAt = SEED_INSTANT.subtract({ hours: 20 });
  // The first submission happens 20 hours after the worker meant to send the notice, the second 23 hours after it, so a window measured from the request would end at two different instants.
  acceptanceOf(await requestNotice({ releaseId: PUBLIC_EDITION, intendedAt }), "The notice requested 20 hours after it was meant for");
  const advanced = await advanceClock(SESSION_ID, 3 * MILLISECONDS_PER_HOUR);
  if (!advanced.ok) throw new Error(`The scenario clock could not be advanced by three hours: ${advanced.error.code}.`);
  acceptanceOf(await requestNotice({ releaseId: SUPPORTER_EDITION, intendedAt }), "The notice requested 23 hours after it was meant for");
  const records = await storedStateOf(SESSION_ID);
  const earlyIntent = intentForRelease(records.notificationIntents, PUBLIC_EDITION);
  const lateIntent = intentForRelease(records.notificationIntents, SUPPORTER_EDITION);
  expect([earlyIntent.intendedAt, lateIntent.intendedAt]).toEqual([intendedAt.toString(), intendedAt.toString()]); // Both records state the instant the worker meant, even though the two submissions are three hours apart, so the window runs from the intent and never from the request.
  const earlyRecordedAt = Temporal.Instant.from(resultForIntent(records.notificationResults, earlyIntent.intentId).recordedAt);
  const lateRecordedAt = Temporal.Instant.from(resultForIntent(records.notificationResults, lateIntent.intentId).recordedAt);
  expect(lateRecordedAt.epochMilliseconds - earlyRecordedAt.epochMilliseconds).toBe(3 * MILLISECONDS_PER_HOUR);
  const deadlineFromEarly = withinUsefulness(notificationDeadline({ intendedAt, now: earlyRecordedAt }), "The notice read at its first submission").deadlineInstant;
  const deadlineFromLate = withinUsefulness(notificationDeadline({ intendedAt, now: lateRecordedAt }), "The notice read at its second submission").deadlineInstant;
  expect([deadlineFromLate.epochMilliseconds, deadlineFromEarly.epochMilliseconds - intendedAt.epochMilliseconds]).toEqual([deadlineFromEarly.epochMilliseconds, USEFULNESS_MILLISECONDS]);
});
it("the window is strict at equality: accepts a request at 24 hours less one second and retries only the copy that definitely failed", async () => {
  const seededResult = resultForIntent((await storedStateOf(SESSION_ID)).notificationResults, SEEDED_INTENT_ID);
  const failedRecipientIds = seededResult.recipients.filter((copy) => copy.state === "failed").map((copy) => copy.recipientId);
  expect(failedRecipientIds.length).toBe(1);
  const [failedRecipientId] = failedRecipientIds;
  if (failedRecipientId === undefined) throw new Error("The seeded send result records no definite failure, so no case here could exercise a retry inside the window.");
  const intendedAt = SEED_INSTANT.subtract({ milliseconds: USEFULNESS_MILLISECONDS - MILLISECONDS_PER_SECOND });
  const accepted = acceptanceOf(await requestNotice({ intendedAt }), "A notice requested one second inside the usefulness window");
  expect(accepted.created?.length).toBe(2);
  expect(accepted.changed).toEqual([DOCUMENT_ID]);
  const after = await storedStateOf(SESSION_ID);
  const intent = intentForRelease(after.notificationIntents, PUBLIC_EDITION);
  const retried = resultForIntent(after.notificationResults, intent.intentId);
  expect([retried.recipients.map((copy) => copy.recipientId), retried.recipients.every((copy) => copy.state === "accepted")]).toEqual([[failedRecipientId], true]);
  // The earlier record is untouched: the retry is a new copy on a new intent rather than a rewrite of the failure it retried, so the original still reads as what it was.
  expect(
    resultForIntent(after.notificationResults, SEEDED_INTENT_ID)
      .recipients.filter((copy) => copy.recipientId === failedRecipientId)
      .map((copy) => copy.state),
  ).toEqual(["failed"]);
});
it("the window is strict at equality: rejects a request at exactly 24 hours and at one second past it", async () => {
  // Both sides of the boundary are asserted against the same intend-then-request shape, so the difference between them is the elapsed time alone and not some other part of the request.
  for (const elapsed of [USEFULNESS_MILLISECONDS, USEFULNESS_MILLISECONDS + MILLISECONDS_PER_SECOND]) {
    const intendedAt = SEED_INSTANT.subtract({ milliseconds: elapsed });
    const fields = refusalFieldsOf(await requestNotice({ intendedAt }), `A notice requested ${String(elapsed)} ms after it was meant for`);
    expect(Object.keys(fields)).toEqual(["intendedAt"]); // The refusal names one field — the instant the window runs from — and its message states the window, so a surface can say why without inventing a second reason.
    for (const expected of [/24 hours/iu, /useful/iu]) expect(usefulnessMessage(fields, "The refused notice")).toMatch(expected);
  }
});
it("a rejected notice cannot be revived as a fresh attempt: rejects a replay and a brand-new operation id with the same reason, and records no message", async () => {
  const before = await storedStateOf(SESSION_ID);
  const intendedAt = SEED_INSTANT.subtract({ milliseconds: USEFULNESS_MILLISECONDS });
  const firstOperationId = newOperationId();
  const first = refusalFieldsOf(await requestNotice({ operationId: firstOperationId, intendedAt }), "The first attempt at an expired intent");
  const replayed = refusalFieldsOf(await requestNotice({ operationId: firstOperationId, intendedAt }), "The replay of the refused attempt"); // The same operation id replays an attempt that was refused, so it is refused again rather than recovered: a rejection is not an acceptance waiting to be acknowledged.
  const freshOperationId = newOperationId();
  expect(freshOperationId).not.toBe(firstOperationId);
  const fresh = refusalFieldsOf(await requestNotice({ operationId: freshOperationId, intendedAt }), "A fresh attempt at the same expired intent");
  const advanced = await advanceClock(SESSION_ID, MILLISECONDS_PER_HOUR); // Later still, and later again after the clock moves on: the window does not extend because someone tried again, so a retry cannot turn an expired intent into a useful one.
  if (!advanced.ok) throw new Error(`The scenario clock could not be advanced by an hour: ${advanced.error.code}.`);
  expect([replayed, fresh, refusalFieldsOf(await requestNotice({ operationId: newOperationId(), intendedAt }), "A retry an hour past the window")]).toEqual([first, first, first]);
  const after = await storedStateOf(SESSION_ID);
  expect([after.notificationIntents.map((intent) => intent.intentId), [after.notificationResults.length, recipientRowCount(after)]]).toEqual([before.notificationIntents.map((intent) => intent.intentId), [before.notificationResults.length, recipientRowCount(before)]]);
});
it("the window is elapsed hours, not calendar days: keeps the deadline at 24 elapsed hours across a daylight-saving transition", () => {
  // Europe/London leaves daylight saving at 02:00 BST on Sunday 25 October 2026, so that civil day lasts 25 hours. A calendar-day reading of "the same time tomorrow" from 13:00 on the 24th is therefore 25 hours away, and only the elapsed reading keeps the window at 24.
  const intendedAt = Temporal.Instant.from(DST_INTENDED_AT);
  const localIntendedAt = intendedAt.toZonedDateTimeISO("Europe/London");
  expect([localIntendedAt.hour, localIntendedAt.offset]).toEqual([13, "+01:00"]);
  const sameWallClockTomorrow = localIntendedAt.add({ days: 1 });
  expect([sameWallClockTomorrow.offset, sameWallClockTomorrow.epochMilliseconds - intendedAt.epochMilliseconds]).toEqual(["+00:00", 25 * MILLISECONDS_PER_HOUR]);
  const deadline = withinUsefulness(notificationDeadline({ intendedAt, now: intendedAt }), "A notice intended across the transition");
  expect(deadline.deadlineInstant.epochMilliseconds - intendedAt.epochMilliseconds).toBe(USEFULNESS_MILLISECONDS);
  expect(sameWallClockTomorrow.epochMilliseconds - deadline.deadlineInstant.epochMilliseconds).toBe(MILLISECONDS_PER_HOUR); // The two readings disagree by exactly the hour the transition adds, and the deadline follows the elapsed one rather than the civil day around it.
});
it("the window is elapsed hours, not calendar days: accepts at 24 hours less one second and rejects at exactly 24 hours across that transition", async () => {
  const intendedAt = Temporal.Instant.from(DST_INTENDED_AT);
  await moveClockTo(intendedAt.add({ milliseconds: USEFULNESS_MILLISECONDS })); // The requests happen at exactly 24 elapsed hours after the intent, an instant a calendar-day reading would still place inside that 25-hour London day.
  const fields = refusalFieldsOf(await requestNotice({ intendedAt }), "A notice requested at exactly 24 elapsed hours across the transition");
  expect(Object.keys(fields)).toEqual(["intendedAt"]);
  expect(usefulnessMessage(fields, "The refused notice")).toMatch(/24 hours/iu);
  // One second nearer, and the same clock accepts it: the boundary is the elapsed instant, whatever the shape of the civil day it falls in.
  const accepted = acceptanceOf(await requestNotice({ releaseId: SUPPORTER_EDITION, intendedAt: intendedAt.add({ milliseconds: MILLISECONDS_PER_SECOND }) }), "A notice requested one second inside the window across the transition");
  expect(accepted.changed).toEqual([DOCUMENT_ID]);
  const records = await storedStateOf(SESSION_ID);
  expect(records.notificationIntents.filter((intent) => intent.releaseId === SUPPORTER_EDITION).length).toBe(1);
});
it("an uncertain outcome is recovered by identity, never resent: answers an uncertain submission with unknown and returns the stored result on replay", async () => {
  const dev = expectEnvelope(await reads.dev.readDevState(SOURCE), "the development document");
  acceptanceOf(await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope, expectedRevision: dev.revision, payload: { mode: "unknown", target: { kind: "mutation", name: "requestNotification" } } }, SOURCE), "Arming the lost acknowledgement on requestNotification");
  const operationId = newOperationId();
  const intendedAt = SEED_INSTANT;
  const uncertain = unknownOf(await requestNotice({ operationId, intendedAt }), "A submission whose acknowledgement was lost");
  expect(uncertain.operationId).toBe(operationId); // The answer carries the attempt's identity and nothing else: it claims neither success nor failure, so the caller's only way forward is to look the operation up.
  expect(Object.keys(uncertain).toSorted()).toEqual(["operationId", "outcome"]);
  const created = intentForRelease((await storedStateOf(SESSION_ID)).notificationIntents, PUBLIC_EDITION);
  // The effect happened even though the answer did not say so, which is the uncertainty the record has to survive: recovering it by identity returns that result instead of repeating the work.
  const recovered = alreadyAcceptedOf(await requestNotice({ operationId, intendedAt }), "The replay of the uncertain submission");
  expect(recovered.operationId).toBe(operationId);
  const view = submissionViewOf(recovered.result);
  expect([view.intentId, view.ceilingCount]).toEqual([created.intentId, created.ceilingCount]);
  const afterReplay = await storedStateOf(SESSION_ID);
  expect([afterReplay.notificationIntents.length, afterReplay.notificationResults.length]).toEqual([2, 2]);
  expect(view.recipientIds.toSorted()).toEqual(
    resultForIntent(afterReplay.notificationResults, created.intentId)
      .recipients.map((copy) => copy.recipientId)
      .toSorted(),
  );
  expect(view.members.filter(claimsDeliveryOrReading)).toEqual([]);
  const armed = expectEnvelope(await reads.dev.readDevState(SOURCE), "the development document"); // The arming is cleared here and again after every case, so no later case inherits it.
  acceptanceOf(await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope, expectedRevision: armed.revision, payload: { plan: null } }, SOURCE), "Disarming the lost acknowledgement");
});
it("an uncertain outcome is recovered by identity, never resent: records only accepted, failed and unknown as per-recipient outcomes", async () => {
  const records = await storedStateOf(SESSION_ID);
  const seededResult = resultForIntent(records.notificationResults, SEEDED_INTENT_ID);
  const observed = [...new Set(seededResult.recipients.map((copy) => copy.state))].toSorted();
  expect(observed.length).toBe(SEND_RESULT_STATES.length);
  expect(observed).toEqual([...SEND_RESULT_STATES]);
  for (const copy of seededResult.recipients) {
    expect(SEND_RESULT_STATES).toContain(copy.state);
    expect(claimsDeliveryOrReading(copy.state)).toBe(false);
  }
  // The stored records state no delivery or reading fact either, so no surface can report one from them: the send result and its copies carry exactly the members the record model allows.
  expect(Object.keys(seededResult).toSorted()).toEqual(["intentId", "recipients", "recordedAt", "revision", "sendResultId", "unserved"]);
  for (const copy of seededResult.recipients) expect(Object.keys(copy).toSorted()).toEqual(["at", "recipientId", "renditionId", "state"]);
  const accepted = acceptanceOf(await requestNotice({}), "A notice submitted for a published edition");
  expect([accepted.outcome, Object.keys(accepted).filter(claimsDeliveryOrReading)]).toEqual(["accepted", []]);
});
it("the accepted ceiling and the pinned rendition: keeps the recorded ceiling when a recipient signs up after the intent", async () => {
  acceptanceOf(await requestNotice({}), "A notice submitted for a published edition");
  const before = await storedStateOf(SESSION_ID);
  const intent = intentForRelease(before.notificationIntents, PUBLIC_EDITION);
  const ceiling = intent.ceilingCount;
  expect([Number.isInteger(ceiling), ceiling]).toEqual([true, 5]); // The seeded notice was accepted for every eligible membership of its audience, the approved-supporter reader's own copy among them.
  const copiesBefore = resultForIntent(before.notificationResults, intent.intentId).recipients.length;
  acceptanceOf(await mutations.audience.signupForPurpose({ operationId: newOperationId(), scope, expectedRevision: FIRST_REVISION, payload: { publisherId: PUBLISHER_ID, purpose: PURPOSE, email: "late.reader@example.org", languagePreference: "fr" } }, SOURCE), "A reader signing up after the notice was submitted");
  const after = await storedStateOf(SESSION_ID);
  expect([after.memberships.length, intentForRelease(after.notificationIntents, PUBLIC_EDITION).ceilingCount, after.notificationIntents.length]).toEqual([before.memberships.length + 1, ceiling, before.notificationIntents.length]);
  expect(resultForIntent(after.notificationResults, intent.intentId).recipients.length).toBe(copiesBefore);
});
it("the accepted ceiling and the pinned rendition: pins exactly one rendition per recipient and keeps it across a re-read", async () => {
  acceptanceOf(await requestNotice({}), "A notice submitted for a published edition");
  const firstPins = recipientRenditionsOf(await storedStateOf(SESSION_ID), "the first read");
  const secondPins = recipientRenditionsOf(await storedStateOf(SESSION_ID), "a second read");
  expect(secondPins).toEqual(firstPins); // A re-read of the recorded copies pins nothing new: the identity a recipient was given is the one that stays recorded, so a later variant cannot be silently substituted for it.
  const seededPins = requiredSaying(firstPins.get(SEEDED_INTENT_ID), "The seeded intent records no pinned copies, so no case here could compare two intents.");
  expect(seededPins.size).toBe(5);
  const records = await storedStateOf(SESSION_ID);
  const created = intentForRelease(records.notificationIntents, PUBLIC_EDITION);
  const createdPins = requiredSaying(firstPins.get(created.intentId), `The intent "${created.intentId}" records no pinned copies.`);
  expect(createdPins.size).toBe(1);
  for (const [recipientId, renditionId] of createdPins) {
    expect(renditionId).not.toBe(seededPins.get(recipientId)); // The pin follows the edition this notice was submitted for, rather than whatever an earlier intent happened to pin for the same person.
  }
});
