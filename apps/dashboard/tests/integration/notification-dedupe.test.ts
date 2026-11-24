/** Success criterion 11: one notification intent is submitted once, and what happened to it is never guessed. */ import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import { SEND_OUTCOME_STATES, dedupeKey } from "@/modules/audience/consent";
import { UPDATE_EMAIL_PURPOSE, type AudiencePurpose } from "@/modules/audience/membership";
import { buildNotice, resolveRendition, type RenditionCandidate } from "@/modules/content/notice";
import { mutations, reads, NOTIFICATION_UNSERVED_REASONS, type MutationOutcome, type NotificationIntentRecord, type NotificationSendResultRecord, type ReadResult, type Scope } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { DEFAULT_SESSION_ID, seedSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { parseSessionMeta } from "@/modules/dev-runtime/scenario";
import type { SessionDocuments } from "@/modules/store/paths";
import { readSession, resetSession } from "@/modules/store/repository";
import { SEED_INSTANT } from "@/modules/time/clock";
import { notificationDeadline } from "@/modules/time/window";
import { expectEnvelope, throwing } from "../helpers/answers";
import { layDownSeededSession, scopeOf } from "../helpers/fixtures";
const PUBLISHER_SESSION_ID = "it-notification-dedupe";
const READER_SESSION_ID = "it-notification-dedupe-reader";
const PUBLISHER_SOURCE: SessionSource = { sessionId: PUBLISHER_SESSION_ID };
const READER_SOURCE: SessionSource = { sessionId: READER_SESSION_ID };
const UPDATE_DOCUMENT_ID = "doc-update-autumn";
const PUBLIC_ENGLISH_RELEASE = "release-update-en-1";
const SUPPORTER_ENGLISH_RELEASE = "release-update-en-approved-supporter-1";
const PUBLIC_FRENCH_RELEASE = "release-update-fr-1";
const SEEDED_INTENT_ID = "intent-update-autumn-en";
const RECIPIENT_ID = "membership-ada-active";
const FAILED_RECIPIENT_ID = "membership-jonas-active";
const UNSUBSCRIBED_MEMBERSHIP_ID = "membership-unsubscribed";
const RESTRICTED_MEMBERSHIP_ID = "membership-restricted";
const AWAITING_PROOF_MEMBERSHIP_ID = "membership-awaiting-proof";
const SUBSCRIBED_COLUMN_MEMBERSHIP_ID = "membership-subscribed-column";
/** The seat the seed lays the publisher's own audience under: the world a previewing reader's page reads across to, and the one its consent changes are written to. */ const PUBLISHED_SESSION_ID = DEFAULT_SESSION_ID;
const PUBLISHED_SOURCE: SessionSource = { sessionId: PUBLISHED_SESSION_ID };
/** The approved-supporter reader, holding no admitted membership of any ministry: its one membership row is the publisher's own. */ const SUPPORTER_READER_SESSION_ID = "reader-approved-supporter";
const SUPPORTER_SOURCE: SessionSource = { sessionId: SUPPORTER_READER_SESSION_ID };
const SUPPORTER_MEMBERSHIP_ID = "principal-reader-approved-supporter";
const SEEDED_INTENDED_AT = Temporal.Instant.from("2026-11-10T09:05:00Z");
const USEFULNESS_ENDS = notificationDeadline({ intendedAt: SEEDED_INTENDED_AT, now: SEEDED_INTENDED_AT }).deadlineInstant;
let scope: Scope;
function principalOf(documents: SessionDocuments): string {
  const meta = parseSessionMeta(documents.meta);
  if (!meta.ok) throw new Error(`The seeded workspace's meta document is unreadable (${meta.error.code}), so no session can be laid down from it.`);
  return meta.value.principalId;
}
function documentsFor(template: SessionDocuments, sessionId: string, principalId: string): SessionDocuments {
  const meta = parseSessionMeta(template.meta);
  if (!meta.ok) throw new Error(`The seeded workspace's meta document is unreadable (${meta.error.code}), so no session can be laid down from it.`);
  // The state document left the seed's builder as a `SessionStateDocument`, which is the shape the store persists and the shape named in `envelope.ts`; a session's own id and principal are restated in the header it carries so the record set states the session that owns it.
  const state = template.state as SessionStateDocument;
  return { state: { ...state, context: { ...state.context, sessionId, principalId } }, operations: template.operations, meta: { ...meta.value, principalId } };
}
async function layDownSessions(): Promise<void> {
  const template = seedSessionDocuments(DEFAULT_SESSION_ID); // The seed builds its documents in memory, so laying two of this file's own sessions down writes nothing another suite reads and starts every case from the same bytes.
  await resetSession(PUBLISHER_SESSION_ID, documentsFor(template, PUBLISHER_SESSION_ID, principalOf(template)));
  await resetSession(READER_SESSION_ID, documentsFor(template, READER_SESSION_ID, RECIPIENT_ID));
  // The two seats the cross-world case acts as are the seed's own, laid down under the ids it gives them: a reader's page and the publisher's audience read one world only where the seed puts it.
  await layDownSeededSession(PUBLISHED_SESSION_ID, PUBLISHED_SESSION_ID);
  await layDownSeededSession(SUPPORTER_READER_SESSION_ID, SUPPORTER_READER_SESSION_ID);
}
async function mirrorPublisherWorld(recipientId: string): Promise<void> {
  const documents = (await readSession(PUBLISHER_SESSION_ID)) ?? throwing(`The store holds no publisher session "${PUBLISHER_SESSION_ID}", so there is no world for the recipient to read.`);
  const meta = parseSessionMeta(documents.meta);
  if (!meta.ok) throw new Error(`The publisher session's meta document is unreadable (${meta.error.code}), so the recipient cannot read its world.`);
  const state = documents.state as SessionStateDocument;
  await resetSession(READER_SESSION_ID, { state: { ...state, context: { ...state.context, sessionId: READER_SESSION_ID, principalId: recipientId } }, operations: documents.operations, meta: { ...meta.value, principalId: recipientId } });
}
type StoredDocuments = { readonly state: SessionStateDocument; readonly operations: unknown };
async function storedDocuments(): Promise<StoredDocuments> {
  const documents = (await readSession(PUBLISHER_SESSION_ID)) ?? throwing(`The store holds no publisher session "${PUBLISHER_SESSION_ID}", so there is no fixture to measure.`);
  return { state: documents.state as SessionStateDocument, operations: documents.operations };
}
const intentsFor = (state: SessionStateDocument, documentId: string, releaseId: string): readonly NotificationIntentRecord[] => state.notificationIntents.filter((intent) => intent.documentId === documentId && intent.releaseId === releaseId);
const sendResultsFor = (state: SessionStateDocument, intentId: string): readonly NotificationSendResultRecord[] => state.notificationResults.filter((result) => result.intentId === intentId);
function ledgerRecordsFor(operations: unknown, operationId: string): readonly unknown[] {
  if (!isRecord(operations)) return [];
  const keyed = isRecord(operations.records) ? Object.keys(operations.records).filter((key) => key === operationId) : [];
  const listed = Array.isArray(operations.entries) ? operations.entries.filter((entry) => isRecord(entry) && entry.operationId === operationId) : [];
  return [...keyed, ...listed];
}
const renditionCandidatesOf = (state: SessionStateDocument, releaseIds: readonly string[]): readonly RenditionCandidate[] =>
  releaseIds.map((releaseId) => {
    const release = state.releases.find((row) => row.releaseId === releaseId);
    const variant = release === undefined ? undefined : state.contentVariants.find((row) => row.variantId === release.variantId);
    const revision = release === undefined ? undefined : state.contentRevisions.find((row) => row.revisionId === release.revisionId);
    if (release === undefined || variant === undefined || revision === undefined) throw new Error(`The seeded publication holds no complete edition "${releaseId}", so this case has no candidate to pin.`);
    return { variantId: release.variantId, releaseId: release.releaseId, revisionId: release.revisionId, audience: release.audience, locale: { tag: release.locale, direction: variant.direction }, publishedAt: Temporal.Instant.from(release.publishedAt), contentChecksum: revision.contentChecksum };
  });
/** The envelope a read answers with, or the failure it reported instead. */ const envelopeOf = async <T>(read: () => Promise<ReadResult<T>>, what: string): Promise<T> => expectEnvelope(await read(), what);
const audienceOf = () => envelopeOf(() => reads.audience.readAudience({}, PUBLISHER_SOURCE), "readAudience");
const sendResultOf = (intentId: string) => envelopeOf(() => reads.audience.readSendResult({ intentId }, PUBLISHER_SOURCE), `readSendResult(${intentId})`);
const inboxOf = (source: SessionSource) => envelopeOf(() => reads.audience.readInbox({}, source), `readInbox as ${source.sessionId}`);
const preferencesOf = (source: SessionSource) => envelopeOf(() => reads.audience.readPreferences(source), `readPreferences as ${source.sessionId}`);
const publishedAudienceOf = () => envelopeOf(() => reads.audience.readAudience({}, PUBLISHED_SOURCE), "readAudience as the established worker");
const supporterPreferencesOf = () => envelopeOf(() => reads.audience.readPreferences(SUPPORTER_SOURCE), "readPreferences as the approved-supporter reader");
type NotificationPayload = { readonly documentId: string; readonly releaseId: string; readonly intendedAt?: string };
type NotificationAttempt = { readonly operationId: string; readonly input: { readonly operationId: string; readonly scope: Scope; readonly expectedRevision: string; readonly payload: NotificationPayload } };
function notificationAttempt(payload: NotificationPayload): NotificationAttempt {
  const operationId = newOperationId();
  return { operationId, input: { operationId, scope, expectedRevision: "rev-1", payload } };
}
const notify = async (attempt: NotificationAttempt): Promise<MutationOutcome> => mutations.updates.requestNotification(PUBLISHER_SESSION_ID, attempt.input);
async function devRevision(): Promise<string> {
  const envelope = await envelopeOf(() => reads.dev.readDevState(PUBLISHER_SOURCE), "readDevState");
  return envelope.revision;
}
const armLostAcknowledgement = async (): Promise<MutationOutcome> => mutations.dev.setFailurePlan({ operationId: newOperationId(), scope, expectedRevision: await devRevision(), payload: { mode: "unknown", target: { kind: "mutation", name: "requestNotification" } } }, PUBLISHER_SOURCE);
async function disarmFailurePlan(): Promise<void> {
  await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope, expectedRevision: await devRevision(), payload: { plan: null } }, PUBLISHER_SOURCE);
}
async function moveClockTo(instant: Temporal.Instant): Promise<void> {
  const outcome = await mutations.dev.setClock({ operationId: newOperationId(), scope, expectedRevision: await devRevision(), payload: { offsetIso: instant.toString() } }, PUBLISHER_SOURCE);
  if (outcome.outcome !== "accepted" && outcome.outcome !== "unchanged") throw new Error(`The scenario clock could not be moved to ${instant.toString()}: ${outcome.outcome}.`);
}
async function advanceClockBy(seconds: number): Promise<void> {
  const outcome = await mutations.dev.advanceClock({ operationId: newOperationId(), scope, expectedRevision: await devRevision(), payload: { bySeconds: seconds } }, PUBLISHER_SOURCE);
  if (outcome.outcome !== "accepted") throw new Error(`The scenario clock could not be advanced by ${String(seconds)} seconds: ${outcome.outcome}.`);
}
function intentIdOfStoredResult(outcome: MutationOutcome, what: string): string {
  if (outcome.outcome !== "alreadyAccepted") throw new Error(`${what} answered "${outcome.outcome}" instead of the stored result a replay returns.`);
  const result: unknown = outcome.result;
  const intentId = isRecord(result) ? result.intentId : undefined;
  if (typeof intentId !== "string" || intentId.length === 0) throw new Error(`${what} returned a stored result that names no notification intent.`);
  return intentId;
}
const refusedFieldNames = (outcome: MutationOutcome, what: string): readonly string[] => (outcome.outcome !== "invalid" ? throwing(`${what} answered "${outcome.outcome}" instead of a validation refusal.`) : Object.keys(outcome.fields));
/** A second purpose, which this release's membership type does not admit because it keeps memberships for one purpose only. */ const secondPurpose = (): AudiencePurpose => "prayer-email" as unknown as AudiencePurpose;
beforeAll(() => {
  vi.stubEnv("NODE_ENV", "development"); // The development controls are gated on the build, never on a caller's claim, so the gate is set here and restored rather than bypassed.
});
beforeEach(async () => {
  await layDownSessions();
  scope = await scopeOf(PUBLISHER_SOURCE);
});
afterEach(async () => {
  await disarmFailurePlan(); // The failure plan and the clock are scenario inputs: both are returned to the seed state so a later case never inherits them, and a case that failed midway is left with nothing armed.
  await moveClockTo(SEED_INSTANT);
});
afterAll(async () => {
  for (const sessionId of [PUBLISHER_SESSION_ID, READER_SESSION_ID, PUBLISHED_SESSION_ID, SUPPORTER_READER_SESSION_ID]) await resetSession(sessionId);
  vi.unstubAllEnvs();
});
it("1. the dedupe identity is exactly four facts: returns one key for one publisher, purpose, recipient and intent, and a different key when any one of the four moves", () => {
  const identity = { publisherId: "publisher-harbour", purpose: UPDATE_EMAIL_PURPOSE, recipientId: RECIPIENT_ID, intentId: SEEDED_INTENT_ID };
  const key = dedupeKey(identity);
  expect(dedupeKey({ ...identity })).toBe(key);
  expect(dedupeKey({ ...identity, publisherId: "publisher-other-ministry" })).not.toBe(key);
  expect(dedupeKey({ ...identity, purpose: secondPurpose() })).not.toBe(key);
  expect(dedupeKey({ ...identity, recipientId: FAILED_RECIPIENT_ID })).not.toBe(key);
  expect(dedupeKey({ ...identity, intentId: "intent-second-publication" })).not.toBe(key);
  // Two different identities that differ in two facts are still two different keys, so neither fact can be cancelling the other out of the identity.
  expect(dedupeKey({ ...identity, recipientId: FAILED_RECIPIENT_ID, intentId: "intent-second-publication" })).not.toBe(dedupeKey({ ...identity, recipientId: FAILED_RECIPIENT_ID }));
});
it("2. a lost acknowledgement keeps the attempt unknown and recoverable: answers unknown with the operation id alone, and every recorded per-recipient state stays in the closed set", async () => {
  expect((await armLostAcknowledgement()).outcome).toBe("accepted");
  const attempt = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
  const outcome = await notify(attempt);
  // The attempt's identity and nothing else: no success, no failure, no revision and no result is claimed, which is what leaves the caller a lookup rather than a resend.
  expect([[outcome.outcome, outcome.operationId], Object.keys(outcome).sort()]).toEqual([
    ["unknown", attempt.operationId],
    ["operationId", "outcome"],
  ]);
  expect(outcome.outcome).not.toBe("accepted");
  const { state } = await storedDocuments();
  const [intent] = intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
  if (intent === undefined) throw new Error("The lost acknowledgement left no intent behind, so the send result it may have written cannot be read.");
  const sendResult = await sendResultOf(intent.intentId);
  expect(SEND_OUTCOME_STATES).toEqual(["accepted", "failed", "unknown"]);
  expect(sendResult.data.rows.length).toBeGreaterThan(0);
  for (const row of sendResult.data.rows) {
    expect(SEND_OUTCOME_STATES).toContain(row.state);
    expect(Object.keys(row).sort()).toEqual(["dedupeKey", "recipientId", "recordedAt", "recovery", "renditionId", "retry", "state"]); // A row records what the local stand-in did with one copy. It carries no delivery or reading receipt, because provider acceptance, delivery and reading are three separate outcomes.
    expect(row.recovery.intentId).toBe(intent.intentId);
    expect(row.retry.reason.length).toBeGreaterThan(0);
  }
  // The effect was taken for every eligible recipient, and the window is still open — so the absence of a retry below is the rule that accepted work is never sent again, not a closed window.
  expect([sendResult.data.usefulness.state, sendResult.data.rows.every((row) => row.state === "accepted"), sendResult.data.rows.every((row) => !row.retry.available)]).toEqual(["within-usefulness", true, true]);
  expect(sendResult.data.counts.accepted + sendResult.data.counts.failed + sendResult.data.counts.unknown).toBe(sendResult.data.rows.length);
  expect(JSON.stringify(sendResult.data)).not.toMatch(/delivered|delivery|was read|has been read|opened at/iu);
});
it("3. a replay recovers the stored result with no second effect: returns alreadyAccepted for the same operation id, with one ledger record, one send result and one message", async () => {
  expect((await armLostAcknowledgement()).outcome).toBe("accepted");
  const attempt = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
  expect((await notify(attempt)).outcome).toBe("unknown");
  const replay = await notify(attempt);
  expect([replay.outcome, replay.operationId]).toEqual(["alreadyAccepted", attempt.operationId]);
  const intentId = intentIdOfStoredResult(replay, "the replay");
  const { state, operations } = await storedDocuments();
  const intents = intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
  expect(intents).toHaveLength(1);
  expect(intents[0]?.intentId).toBe(intentId);
  expect(ledgerRecordsFor(operations, attempt.operationId)).toHaveLength(1); // One attempt identity holds one ledger record: a second replay would be answered from it, never appended.
  const results = sendResultsFor(state, intentId);
  expect(results).toHaveLength(1);
  const [result] = results;
  const copies = result === undefined ? [] : result.recipients.filter((copy) => copy.recipientId === FAILED_RECIPIENT_ID);
  expect(copies).toHaveLength(1);
  await mirrorPublisherWorld(FAILED_RECIPIENT_ID);
  const inbox = await inboxOf(READER_SOURCE);
  const messages = inbox.data.messages.filter((message) => message.intentId === intentId);
  expect(messages).toHaveLength(1);
  expect([messages[0]?.renditionId, inbox.data.intentCount]).toEqual([copies[0]?.renditionId, 2]);
});
it("4. a fresh operation key never sends the same intent twice: suppresses a second submission under a new operation id: no second intent, send result or message", async () => {
  const first = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
  expect((await notify(first)).outcome).toBe("accepted");
  const { state: afterFirst } = await storedDocuments();
  const [intent] = intentsFor(afterFirst, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
  if (intent === undefined) throw new Error("The first submission recorded no intent, so this case has no notification to attempt again.");
  const second = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
  expect(second.operationId).not.toBe(first.operationId);
  const suppressed = await notify(second);
  expect(suppressed.outcome).toBe("unchanged");
  expect(suppressed.outcome).not.toBe("accepted");
  const { state, operations } = await storedDocuments();
  expect(intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE)).toHaveLength(1);
  expect(sendResultsFor(state, intent.intentId)).toHaveLength(1);
  expect(ledgerRecordsFor(operations, second.operationId)).toHaveLength(0); // Nothing was recorded for the second attempt, so it neither sent nor became recoverable work.
  await mirrorPublisherWorld(FAILED_RECIPIENT_ID);
  const messages = (await inboxOf(READER_SOURCE)).data.messages.filter((message) => message.intentId === intent.intentId);
  expect(messages).toHaveLength(1);
});
it("5. one recipient receives exactly one copy of one Update: gives a recipient eligible for both audiences one message, under the one rendition the accepted intent recorded", async () => {
  const seeded = await sendResultOf(SEEDED_INTENT_ID);
  const seededRows = seeded.data.rows.filter((row) => row.recipientId === RECIPIENT_ID);
  expect(seededRows).toHaveLength(1);
  const audience = await audienceOf(); // She is eligible for the protected edition of the same Update as well, so nothing but the dedupe identity stands between her and a second copy.
  expect(audience.data.members.find((row) => row.recipientId === RECIPIENT_ID)?.eligible).toBe(true);
  const supporter = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: SUPPORTER_ENGLISH_RELEASE });
  expect((await notify(supporter)).outcome).toBe("accepted");
  const { state } = await storedDocuments();
  const [intent] = intentsFor(state, UPDATE_DOCUMENT_ID, SUPPORTER_ENGLISH_RELEASE);
  if (intent === undefined) throw new Error("The protected edition's notice recorded no intent, so its recipients cannot be counted.");
  const sendResult = await sendResultOf(intent.intentId);
  expect(sendResult.data.rows.some((row) => row.recipientId === RECIPIENT_ID)).toBe(false);
  await mirrorPublisherWorld(RECIPIENT_ID);
  const inbox = await inboxOf(READER_SOURCE);
  expect(inbox.data.messages).toHaveLength(1);
  const [message] = inbox.data.messages;
  if (message === undefined) throw new Error("The recipient's inbox holds no message for the Update she was notified about.");
  expect([message.intentId, message.releaseId, message.renditionId]).toEqual([SEEDED_INTENT_ID, PUBLIC_ENGLISH_RELEASE, seededRows[0]?.renditionId]);
  expect(message.simulated).toContain("mail-submission");
  const preferences = await preferencesOf(READER_SOURCE);
  expect(preferences.data.pinnedCopies).toHaveLength(1);
  expect([preferences.data.pinnedCopies[0]?.releaseId, preferences.data.pinnedCopies[0]?.renditionId]).toEqual([PUBLIC_ENGLISH_RELEASE, seededRows[0]?.renditionId]);
  // The resolver the submission used, offered both editions of the same Update at once, answers with one pin rather than one per audience.
  const pinned = resolveRendition({ recipient: { recipientId: RECIPIENT_ID, admittedAudiences: ["public", "approved-supporter"], languagePreference: "en" }, candidates: renditionCandidatesOf(state, [PUBLIC_ENGLISH_RELEASE, SUPPORTER_ENGLISH_RELEASE]), siteDefaultLocale: "en" });
  expect(pinned.status).toBe("pinned");
  if (pinned.status !== "pinned") throw new Error(`Both editions of one Update resolved to no pin: ${pinned.reason}.`);
  expect([pinned.rendition.audience, pinned.rendition.releaseId]).toEqual(["approved-supporter", SUPPORTER_ENGLISH_RELEASE]);
  // The message built from that pin carries exactly that one pin and points at the copy rather than embedding it: a notice carries no protected prose, image, poster or transcript.
  const notice = buildNotice({ publisher: { displayName: "Harbour Youth" }, purpose: UPDATE_EMAIL_PURPOSE, pinned: pinned.rendition, sender: { name: "Update notices", address: "update-notice@example.invalid" }, link: `/preview/${UPDATE_DOCUMENT_ID}` });
  expect(notice.pinned).toEqual(pinned.rendition);
  expect(notice.link).toBe(`/preview/${UPDATE_DOCUMENT_ID}`);
  expect(notice.htmlBody).not.toMatch(/<(img|video|audio|iframe)\b/iu);
});
it("6. a definite failure comes from real input and retries only while the notice is useful: excludes every membership that cannot accept a notice, with its reason, and issues a copy to none of them", async () => {
  const audience = await audienceOf();
  const member = (membershipId: string) => audience.data.members.find((row) => row.recipientId === membershipId);
  expect([member(UNSUBSCRIBED_MEMBERSHIP_ID)?.eligible, member(UNSUBSCRIBED_MEMBERSHIP_ID)?.exclusionReason, member(RESTRICTED_MEMBERSHIP_ID)?.eligible, member(RESTRICTED_MEMBERSHIP_ID)?.exclusionReason]).toEqual([false, "unsubscribed", false, "restricted"]);
  expect([member(AWAITING_PROOF_MEMBERSHIP_ID)?.exclusionReason, member(SUBSCRIBED_COLUMN_MEMBERSHIP_ID)?.state, member(SUBSCRIBED_COLUMN_MEMBERSHIP_ID)?.exclusionReason]).toEqual(["awaiting-proof", "off", "off"]);
  for (const value of [audience.data.excludedByReason.unsubscribed, audience.data.counts.eligible]) expect(value).toBeGreaterThan(0);
  expect((await notify(notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE }))).outcome).toBe("accepted");
  const { state } = await storedDocuments();
  const [intent] = intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
  if (intent === undefined) throw new Error("The submission recorded no intent, so the copies it produced cannot be read.");
  const sendResult = await sendResultOf(intent.intentId);
  for (const membershipId of [UNSUBSCRIBED_MEMBERSHIP_ID, RESTRICTED_MEMBERSHIP_ID, AWAITING_PROOF_MEMBERSHIP_ID, SUBSCRIBED_COLUMN_MEMBERSHIP_ID]) expect(sendResult.data.rows.some((row) => row.recipientId === membershipId)).toBe(false);
  const seededFailure = (await sendResultOf(SEEDED_INTENT_ID)).data.rows.find((row) => row.recipientId === FAILED_RECIPIENT_ID);
  expect(seededFailure?.state).toBe("failed");
});
it("6. a definite failure comes from real input and retries only while the notice is useful: retries a failed copy only inside 24 elapsed hours from the instant it was intended for, strict at equality", async () => {
  // The boundary itself, from the one function that computes it: 24 elapsed hours, and a request at exactly the deadline is already too late.
  expect([USEFULNESS_ENDS.toString(), notificationDeadline({ intendedAt: SEEDED_INTENDED_AT, now: USEFULNESS_ENDS.subtract({ nanoseconds: 1 }) }).status]).toEqual([SEEDED_INTENDED_AT.add({ hours: 24 }).toString(), "within-usefulness"]);
  expect(notificationDeadline({ intendedAt: SEEDED_INTENDED_AT, now: USEFULNESS_ENDS }).status).toBe("past-usefulness");
  const expired = await sendResultOf(SEEDED_INTENT_ID);
  expect(expired.data.usefulness.state).toBe("past-usefulness");
  const expiredFailure = expired.data.rows.find((row) => row.recipientId === FAILED_RECIPIENT_ID);
  expect([expiredFailure?.state, expiredFailure?.retry.available]).toEqual(["failed", false]);
  expect(expiredFailure?.retry.reason).toMatch(/usefulness window has closed/iu);
  await moveClockTo(USEFULNESS_ENDS.subtract({ hours: 1 }));
  const open = await sendResultOf(SEEDED_INTENT_ID);
  expect([open.data.usefulness.state, open.data.usefulness.deadline, open.data.rows.find((row) => row.recipientId === FAILED_RECIPIENT_ID)?.retry.available]).toEqual(["within-usefulness", USEFULNESS_ENDS.toString(), true]);
  await advanceClockBy(3600);
  const closed = await sendResultOf(SEEDED_INTENT_ID);
  expect(closed.data.usefulness.state).toBe("past-usefulness");
  expect(closed.data.usefulness.remainingMilliseconds).toBeNull();
  expect(closed.data.rows.find((row) => row.recipientId === FAILED_RECIPIENT_ID)?.retry.available).toBe(false);
  const revival = await notify(notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_ENGLISH_RELEASE, intendedAt: SEEDED_INTENDED_AT.toString() }));
  expect(refusedFieldNames(revival, "a notice reviving an expired intent")).toContain("intendedAt");
  const { state } = await storedDocuments();
  const intents = intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_ENGLISH_RELEASE);
  expect(intents).toHaveLength(1);
  expect(intents[0]?.intentId).toBe(SEEDED_INTENT_ID);
});
it("7. a second edition accounts for every eligible recipient: names each recipient the earlier intent already covered, and issues no second copy", async () => {
  // The seeded notice of this Update recorded a copy for all four eligible recipients, so the protected edition of the same Update owes a copy only to the one whose copy failed. The others are eligible all the same, and the ceiling the intent is accepted for counts them.
  expect((await notify(notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: SUPPORTER_ENGLISH_RELEASE }))).outcome).toBe("accepted");
  const { state } = await storedDocuments();
  const [intent] = intentsFor(state, UPDATE_DOCUMENT_ID, SUPPORTER_ENGLISH_RELEASE);
  if (intent === undefined) throw new Error("The protected edition's notice recorded no intent, so what it recorded cannot be accounted for.");
  const audience = await audienceOf();
  const eligibleIds = audience.data.members
    .filter((row) => row.eligible)
    .map((row) => row.recipientId)
    .toSorted();
  const sendResult = await sendResultOf(intent.intentId);
  const copies = sendResult.data.counts.accepted + sendResult.data.counts.failed + sendResult.data.counts.unknown;
  const unservedIds = sendResult.data.unserved.map((entry) => entry.recipientId);
  expect([[sendResult.data.rows.length, sendResult.data.page.total, sendResult.data.ceilingCount, sendResult.data.ceilingCount], [...sendResult.data.rows.map((row) => row.recipientId), ...unservedIds].toSorted()]).toEqual([[copies, copies, eligibleIds.length, copies + sendResult.data.unserved.length], eligibleIds]);
  expect(sendResult.valueStates.unserved).toBe("value"); // An exclusion is a value the surface can render rather than a missing number, and its reason comes from the closed set the record declares.
  expect([...NOTIFICATION_UNSERVED_REASONS]).toEqual(["already-covered", "no-eligible-rendition"]);
  for (const entry of sendResult.data.unserved) expect(NOTIFICATION_UNSERVED_REASONS).toContain(entry.reason);
  const [recorded] = sendResultsFor(state, intent.intentId); // The stored record states the same account, so the read is publishing what was written rather than reconstructing it.
  expect(recorded?.unserved.map((entry) => entry.recipientId)).toEqual(unservedIds);
  const seeded = await sendResultOf(SEEDED_INTENT_ID);
  for (const entry of sendResult.data.unserved) {
    expect(entry.reason).toBe("already-covered");
    if (entry.reason !== "already-covered") throw new Error(`The recipient "${entry.recipientId}" was recorded unserved for ${entry.reason}, which this seeded audience does not produce.`);
    expect(entry.coveredByIntentId).toBe(SEEDED_INTENT_ID);
    const earlier = seeded.data.rows.find((row) => row.recipientId === entry.recipientId) ?? throwing(`The recipient "${entry.recipientId}" is named as already covered, and the seeded intent records no copy for them.`);
    expect([entry.coveredByRenditionId, sendResult.data.rows.some((row) => row.recipientId === entry.recipientId)]).toEqual([earlier.renditionId, false]);
  }
  await mirrorPublisherWorld(RECIPIENT_ID);
  const inbox = await inboxOf(READER_SOURCE);
  expect(inbox.data.messages).toHaveLength(1);
  expect(inbox.data.messages[0]?.intentId).toBe(SEEDED_INTENT_ID);
});
it("8. an unsubscribe reaches the publisher's own audience: the membership a reader turns off is the one the publisher's audience read reports off, ineligible and unsubscribed", async () => {
  const before = await publishedAudienceOf(); // The publisher's own audience, read by the seat whose world holds it, before the reader acts on its copy of the fact.
  const preferences = await supporterPreferencesOf(); // The reader's own page holds no rows of its own, so the membership it states is read across from that same publisher world.
  expect([preferences.data.membershipId, preferences.data.state]).toEqual([SUPPORTER_MEMBERSHIP_ID, "active"]);
  const unsubscribe = await mutations.audience.unsubscribe({ operationId: newOperationId(), scope: preferences.scope, expectedRevision: preferences.revision, payload: { publisherId: "publisher-harbour", purpose: UPDATE_EMAIL_PURPOSE } }, SUPPORTER_SOURCE);
  expect(unsubscribe.outcome).toBe("accepted");
  expect((await supporterPreferencesOf()).data.state).toBe("off"); // The reader's own page states the choice its own act made.
  const after = await publishedAudienceOf();
  const row = after.data.members.find((member) => member.recipientId === SUPPORTER_MEMBERSHIP_ID) ?? throwing(`The publisher's audience holds no row for ${SUPPORTER_MEMBERSHIP_ID}, so the membership the reader turned off is not the one this read reports.`);
  expect([row.state, row.eligible, row.exclusionReason]).toEqual(["off", false, "unsubscribed"]); // One row with one owner: the publisher reports the fact the reader's page states, never the opposite of it.
  expect([after.data.counts.eligible, after.data.excludedByReason.unsubscribed]).toEqual([before.data.counts.eligible - 1, before.data.excludedByReason.unsubscribed + 1]);
  expect([after.data.memberStates.active, after.data.memberStates.off]).toEqual([before.data.memberStates.active - 1, before.data.memberStates.off + 1]);
});
