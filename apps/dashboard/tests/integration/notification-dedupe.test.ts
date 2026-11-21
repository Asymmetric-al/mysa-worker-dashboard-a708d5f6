/**
 * Success criterion 11: one notification intent is submitted once, and what happened to it is never
 * guessed.
 *
 * AAP 0.8.5 fixes the identity a notice is deduplicated under — publisher + purpose + recipient +
 * notification intent — and three consequences this file proves against the real store and the real
 * operation ledger rather than against a mock: accepted or possibly accepted work is never resent under
 * a fresh key, an `unknown` answer is recovered by re-querying the same operation id, and one recipient
 * receives exactly one copy of one Update, however many audiences and languages of it they are eligible
 * for. A definite failure is retried only while the notice is still useful, which is 24 elapsed hours
 * from the instant it was intended for, strict at equality.
 *
 * The store is the subject, not a stand-in for it. The effect and its ledger entry are one write, so
 * `alreadyAccepted` and "exactly one message" are facts about bytes on disk; a fake would have proved
 * only that the test can repeat itself. Two private sessions are laid down from the seeded
 * established-worker workspace — a publisher, and the recipient Ada Quinn reading as her own membership
 * — so no case depends on another suite's records or on the shared seeded session ids. The recipient's
 * session is re-laid from the publisher's world after each submission, which is how the receiving
 * preview reads one document across sessions.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import { SEND_OUTCOME_STATES, dedupeKey } from "@/modules/audience/consent";
import { UPDATE_EMAIL_PURPOSE, type AudiencePurpose } from "@/modules/audience/membership";
import { buildNotice, resolveRendition, type RenditionCandidate } from "@/modules/content/notice";
import { mutations, reads, type MutationOutcome, type NotificationIntentRecord, type NotificationSendResultRecord, type ReadResult, type Scope } from "@/modules/data-service";
import { resolveSession, type SessionSource } from "@/modules/data-service/authorize";
import { DEFAULT_SESSION_ID, seedSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { parseSessionMeta } from "@/modules/dev-runtime/scenario";
import type { SessionDocuments } from "@/modules/store/paths";
import { readSession, resetSession } from "@/modules/store/repository";
import { SEED_INSTANT } from "@/modules/time/clock";
import { notificationDeadline } from "@/modules/time/window";
// The two private sessions, and the publisher world they are both laid down from
const PUBLISHER_SESSION_ID = "it-notification-dedupe";

const READER_SESSION_ID = "it-notification-dedupe-reader";

const PUBLISHER_SOURCE: SessionSource = { sessionId: PUBLISHER_SESSION_ID };

const READER_SOURCE: SessionSource = { sessionId: READER_SESSION_ID };
// The seeded publication this file notifies about, and the one recipient it reads as
const PUBLISHER_ID = "publisher-harbour";

const UPDATE_DOCUMENT_ID = "doc-update-autumn";

/** The public English edition the seed already issued one notice for. */
const PUBLIC_ENGLISH_RELEASE = "release-update-en-1";

/** The approved-supporter edition of the same Update: the same document, a second audience. */
const SUPPORTER_ENGLISH_RELEASE = "release-update-en-approved-supporter-1";

/** A public edition of the same Update in another language, with no notice issued for it yet. */
const PUBLIC_FRENCH_RELEASE = "release-update-fr-1";

const SEEDED_INTENT_ID = "intent-update-autumn-en";

/** Ada Quinn: active, confirmed, reading in English, and eligible for the protected edition as well as the public one. */
const RECIPIENT_ID = "membership-ada-active";

/** Jonas Oyelaran: his copy of the seeded notice failed, which is the definite failure this file retries. */
const FAILED_RECIPIENT_ID = "membership-jonas-active";

/** Four seeded memberships that cannot accept a notice, one per reason the audience states. */
const UNSUBSCRIBED_MEMBERSHIP_ID = "membership-unsubscribed";

const RESTRICTED_MEMBERSHIP_ID = "membership-restricted";

const AWAITING_PROOF_MEMBERSHIP_ID = "membership-awaiting-proof";

/** A row whose source supplied a `subscribed`-looking column: a flag that is not consent. */
const SUBSCRIBED_COLUMN_MEMBERSHIP_ID = "membership-subscribed-column";

/** The instant the seeded notice was intended for, and the 24 elapsed hours that follow it. */
const SEEDED_INTENDED_AT = Temporal.Instant.from("2026-11-10T09:05:00Z");

const USEFULNESS_ENDS = notificationDeadline({ intendedAt: SEEDED_INTENDED_AT, now: SEEDED_INTENDED_AT }).deadlineInstant;

/**
 * The revision token a submission states. `requestNotification` compares no record revision — the
 * publication it names is identified by its release, and the attempt by its own operation id — so the
 * token exists only to make one attempt's intent distinguishable from another's.
 */
const DOCUMENT_REVISION_SEEN = "rev-1";

let scope: Scope;

let environmentBefore: string | undefined;
// The documents a private session is laid down from
function principalOf(documents: SessionDocuments): string {
  const meta = parseSessionMeta(documents.meta);
  if (!meta.ok) {
    throw new Error(`The seeded workspace's meta document is unreadable (${meta.error.code}), so no session can be laid down from it.`);
  }
  return meta.value.principalId;
}
/** The seeded documents, restated as one stated session's and one stated principal's. */
function documentsFor(template: SessionDocuments, sessionId: string, principalId: string): SessionDocuments {
  const meta = parseSessionMeta(template.meta);
  if (!meta.ok) {
    throw new Error(`The seeded workspace's meta document is unreadable (${meta.error.code}), so no session can be laid down from it.`);
  }
  // The state document left the seed's builder as a `SessionStateDocument`, which is the shape the
  // store persists and the shape named in `envelope.ts`; a session's own id and principal are restated
  // in the header it carries so the record set states the session that owns it.
  const state = template.state as SessionStateDocument;
  return {
    state: { ...state, context: { ...state.context, sessionId, principalId } },
    operations: template.operations,
    meta: { ...meta.value, principalId },
  };
}
async function layDownSessions(): Promise<void> {
  // The seed builds its documents in memory, so laying two of this file's own sessions down writes
  // nothing another suite reads and starts every case from the same bytes.
  const template = seedSessionDocuments(DEFAULT_SESSION_ID);
  await resetSession(PUBLISHER_SESSION_ID, documentsFor(template, PUBLISHER_SESSION_ID, principalOf(template)));
  await resetSession(READER_SESSION_ID, documentsFor(template, READER_SESSION_ID, RECIPIENT_ID));
}
/** Re-lays the recipient's session from the publisher's world as it now stands, reading as one stated recipient: the receiving preview reads one document, across sessions. */
async function mirrorPublisherWorld(recipientId: string): Promise<void> {
  const documents = await readSession(PUBLISHER_SESSION_ID);
  if (documents === undefined) {
    throw new Error(`The store holds no publisher session "${PUBLISHER_SESSION_ID}", so there is no world for the recipient to read.`);
  }
  const meta = parseSessionMeta(documents.meta);
  if (!meta.ok) {
    throw new Error(`The publisher session's meta document is unreadable (${meta.error.code}), so the recipient cannot read its world.`);
  }
  const state = documents.state as SessionStateDocument;
  await resetSession(READER_SESSION_ID, {
    state: { ...state, context: { ...state.context, sessionId: READER_SESSION_ID, principalId: recipientId } },
    operations: documents.operations,
    meta: { ...meta.value, principalId: recipientId },
  });
}
async function scopeOf(source: SessionSource): Promise<Scope> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    throw new Error(`The session "${source.sessionId}" could not be resolved, so no case in this file can act in it.`);
  }
  const selected = resolved.session.selected;
  if (selected === null) {
    throw new Error(`The session "${source.sessionId}" has selected no context, so it holds no scope to notify in.`);
  }
  return selected;
}
// The stored fixture, measured through the store's own documents
interface StoredDocuments {
  readonly state: SessionStateDocument;
  readonly operations: unknown;
}
async function storedDocuments(): Promise<StoredDocuments> {
  const documents = await readSession(PUBLISHER_SESSION_ID);
  if (documents === undefined) {
    throw new Error(`The store holds no publisher session "${PUBLISHER_SESSION_ID}", so there is no fixture to measure.`);
  }
  // Reading the document here measures the fixture — how many intents, results and ledger entries a
  // case left behind — and decides no rule: every rule under test is the one the service applies.
  return { state: documents.state as SessionStateDocument, operations: documents.operations };
}
/** Every notice intent recorded for one document and one release of it. */
function intentsFor(state: SessionStateDocument, documentId: string, releaseId: string): readonly NotificationIntentRecord[] {
  return state.notificationIntents.filter((intent) => intent.documentId === documentId && intent.releaseId === releaseId);
}
/** Every send result recorded for one intent. */
function sendResultsFor(state: SessionStateDocument, intentId: string): readonly NotificationSendResultRecord[] {
  return state.notificationResults.filter((result) => result.intentId === intentId);
}
/**
 * The ledger records one operation id holds, in either arrangement the store persists a ledger in: the
 * seeded `entries` list, and the `records` map a committed mutation leaves.
 */
function ledgerRecordsFor(operations: unknown, operationId: string): readonly unknown[] {
  if (!isRecord(operations)) {
    return [];
  }
  const keyed = isRecord(operations.records) ? Object.keys(operations.records).filter((key) => key === operationId) : [];
  const listed = Array.isArray(operations.entries) ? operations.entries.filter((entry) => isRecord(entry) && entry.operationId === operationId) : [];
  return [...keyed, ...listed];
}
// The world a notice is pinned from: the seeded editions, as the publication records them
function renditionCandidatesOf(state: SessionStateDocument, releaseIds: readonly string[]): readonly RenditionCandidate[] {
  return releaseIds.map((releaseId) => {
    const release = state.releases.find((row) => row.releaseId === releaseId);
    const variant = release === undefined ? undefined : state.contentVariants.find((row) => row.variantId === release.variantId);
    const revision = release === undefined ? undefined : state.contentRevisions.find((row) => row.revisionId === release.revisionId);
    if (release === undefined || variant === undefined || revision === undefined) {
      throw new Error(`The seeded publication holds no complete edition "${releaseId}", so this case has no candidate to pin.`);
    }
    return {
      variantId: release.variantId,
      releaseId: release.releaseId,
      revisionId: release.revisionId,
      audience: release.audience,
      locale: { tag: release.locale, direction: variant.direction },
      publishedAt: Temporal.Instant.from(release.publishedAt),
      contentChecksum: revision.contentChecksum,
    };
  });
}
// Reads, and the answers they may give
/** The envelope a read answers with, or the failure it reported instead. */
async function envelopeOf<T>(read: () => Promise<ReadResult<T>>, what: string): Promise<T> {
  const result = await read();
  if (result.kind !== "envelope") {
    throw new Error(`${what} answered "${result.kind}" instead of an envelope.`);
  }
  return result.envelope;
}
function audienceOf() {
  return envelopeOf(() => reads.audience.readAudience({}, PUBLISHER_SOURCE), "readAudience");
}
function sendResultOf(intentId: string) {
  return envelopeOf(() => reads.audience.readSendResult({ intentId }, PUBLISHER_SOURCE), `readSendResult(${intentId})`);
}
function inboxOf(source: SessionSource) {
  return envelopeOf(() => reads.audience.readInbox({}, source), `readInbox as ${source.sessionId}`);
}
function preferencesOf(source: SessionSource) {
  return envelopeOf(() => reads.audience.readPreferences(source), `readPreferences as ${source.sessionId}`);
}
// Attempts at the one mutation this file submits
interface NotificationPayload {
  readonly documentId: string;
  readonly releaseId: string;
  readonly intendedAt?: string;
}
interface NotificationAttempt {
  readonly operationId: string;
  readonly input: {
    readonly operationId: string;
    readonly scope: Scope;
    readonly expectedRevision: string;
    readonly payload: NotificationPayload;
  };
}
function notificationAttempt(payload: NotificationPayload): NotificationAttempt {
  const operationId = newOperationId();
  return { operationId, input: { operationId, scope, expectedRevision: DOCUMENT_REVISION_SEEN, payload } };
}
async function notify(attempt: NotificationAttempt): Promise<MutationOutcome> {
  return mutations.updates.requestNotification(PUBLISHER_SESSION_ID, attempt.input);
}
/** The development document's own revision, which each development control states as the revision it read before it changed anything. */
async function devRevision(): Promise<string> {
  const envelope = await envelopeOf(() => reads.dev.readDevState(PUBLISHER_SOURCE), "readDevState");
  return envelope.revision;
}
async function armLostAcknowledgement(): Promise<MutationOutcome> {
  return mutations.dev.setFailurePlan(
    {
      operationId: newOperationId(),
      scope,
      expectedRevision: await devRevision(),
      payload: { mode: "unknown", target: { kind: "mutation", name: "requestNotification" } },
    },
    PUBLISHER_SOURCE,
  );
}
async function disarmFailurePlan(): Promise<void> {
  await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope, expectedRevision: await devRevision(), payload: { plan: null } }, PUBLISHER_SOURCE);
}
async function moveClockTo(instant: Temporal.Instant): Promise<void> {
  const outcome = await mutations.dev.setClock({ operationId: newOperationId(), scope, expectedRevision: await devRevision(), payload: { offsetIso: instant.toString() } }, PUBLISHER_SOURCE);
  if (outcome.outcome !== "accepted" && outcome.outcome !== "unchanged") {
    throw new Error(`The scenario clock could not be moved to ${instant.toString()}: ${outcome.outcome}.`);
  }
}
async function advanceClockBy(seconds: number): Promise<void> {
  const outcome = await mutations.dev.advanceClock({ operationId: newOperationId(), scope, expectedRevision: await devRevision(), payload: { bySeconds: seconds } }, PUBLISHER_SOURCE);
  if (outcome.outcome !== "accepted") {
    throw new Error(`The scenario clock could not be advanced by ${String(seconds)} seconds: ${outcome.outcome}.`);
  }
}
// Outcomes, narrowed
function intentIdOfStoredResult(outcome: MutationOutcome, what: string): string {
  if (outcome.outcome !== "alreadyAccepted") {
    throw new Error(`${what} answered "${outcome.outcome}" instead of the stored result a replay returns.`);
  }
  const result: unknown = outcome.result;
  const intentId = isRecord(result) ? result.intentId : undefined;
  if (typeof intentId !== "string" || intentId.length === 0) {
    throw new Error(`${what} returned a stored result that names no notification intent.`);
  }
  return intentId;
}
function refusedFieldNames(outcome: MutationOutcome, what: string): readonly string[] {
  if (outcome.outcome !== "invalid") {
    throw new Error(`${what} answered "${outcome.outcome}" instead of a validation refusal.`);
  }
  return Object.keys(outcome.fields);
}
/**
 * A second purpose, which this release's membership type does not admit because it keeps memberships
 * for one purpose only. The assertion it serves is that the purpose is a component of the dedupe
 * identity, so the value is forced through the same function rather than the test assuming what the
 * key is made of.
 */
function secondPurpose(): AudiencePurpose {
  return "prayer-email" as unknown as AudiencePurpose;
}
/**
 * Sets the build the development gate reads. `process.env.NODE_ENV` is declared read-only by the
 * framework's types and the gate reads its value at call time, so the value is written through the
 * environment record rather than by an assignment the compiler rejects.
 */
function setNodeEnvironment(value: string): void {
  Object.assign(process.env, { NODE_ENV: value });
}
beforeAll(() => {
  // The development controls are gated on the build, never on a caller's claim, so the gate is set here
  // and restored rather than bypassed.
  environmentBefore = process.env.NODE_ENV;
  setNodeEnvironment("development");
});
beforeEach(async () => {
  await layDownSessions();
  scope = await scopeOf(PUBLISHER_SOURCE);
});
afterEach(async () => {
  // The failure plan and the clock are scenario inputs: both are returned to the seed state so a later
  // case never inherits them, and a case that failed midway is left with nothing armed.
  await disarmFailurePlan();
  await moveClockTo(SEED_INSTANT);
});
afterAll(async () => {
  for (const sessionId of [PUBLISHER_SESSION_ID, READER_SESSION_ID]) {
    await resetSession(sessionId);
  }
  setNodeEnvironment(environmentBefore ?? "test");
});

describe("1. the dedupe identity is exactly four facts", () => {
  it("returns one key for one publisher, purpose, recipient and intent, and a different key when any one of the four moves", () => {
    const identity = {
      publisherId: PUBLISHER_ID,
      purpose: UPDATE_EMAIL_PURPOSE,
      recipientId: RECIPIENT_ID,
      intentId: SEEDED_INTENT_ID,
    };
    const key = dedupeKey(identity);
    expect(dedupeKey({ ...identity })).toBe(key);
    expect(dedupeKey({ ...identity, publisherId: "publisher-other-ministry" })).not.toBe(key);
    expect(dedupeKey({ ...identity, purpose: secondPurpose() })).not.toBe(key);
    expect(dedupeKey({ ...identity, recipientId: FAILED_RECIPIENT_ID })).not.toBe(key);
    expect(dedupeKey({ ...identity, intentId: "intent-second-publication" })).not.toBe(key);
    // Two different identities that differ in two facts are still two different keys, so neither fact
    // can be cancelling the other out of the identity.
    expect(dedupeKey({ ...identity, recipientId: FAILED_RECIPIENT_ID, intentId: "intent-second-publication" })).not.toBe(dedupeKey({ ...identity, recipientId: FAILED_RECIPIENT_ID }));
  });
});

describe("2. a lost acknowledgement keeps the attempt unknown and recoverable", () => {
  it("answers unknown with the operation id alone, and every recorded per-recipient state stays in the closed set", async () => {
    expect((await armLostAcknowledgement()).outcome).toBe("accepted");
    const attempt = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
    const outcome = await notify(attempt);
    // The attempt's identity and nothing else: no success, no failure, no revision and no result is
    // claimed, which is what leaves the caller a lookup rather than a resend.
    expect(outcome.outcome).toBe("unknown");
    expect(outcome.operationId).toBe(attempt.operationId);
    expect(Object.keys(outcome).sort()).toEqual(["operationId", "outcome"]);
    expect(outcome.outcome).not.toBe("accepted");

    // What the attempt recorded is readable, and every per-recipient state comes from the closed set.
    const { state } = await storedDocuments();
    const [intent] = intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
    if (intent === undefined) {
      throw new Error("The lost acknowledgement left no intent behind, so the send result it may have written cannot be read.");
    }
    const sendResult = await sendResultOf(intent.intentId);
    expect(SEND_OUTCOME_STATES).toEqual(["accepted", "failed", "unknown"]);
    expect(sendResult.data.rows.length).toBeGreaterThan(0);
    for (const row of sendResult.data.rows) {
      expect(SEND_OUTCOME_STATES).toContain(row.state);
      // A row records what the local stand-in did with one copy. It carries no delivery or reading
      // receipt, because provider acceptance, delivery and reading are three separate outcomes.
      expect(Object.keys(row).sort()).toEqual(["dedupeKey", "recipientId", "recordedAt", "recovery", "renditionId", "retry", "state"]);
      expect(row.recovery.intentId).toBe(intent.intentId);
      expect(row.retry.reason.length).toBeGreaterThan(0);
    }
    // The effect was taken for every eligible recipient, and the window is still open — so the absence
    // of a retry below is the rule that accepted work is never sent again, not a closed window.
    expect(sendResult.data.usefulness.state).toBe("within-usefulness");
    expect(sendResult.data.rows.every((row) => row.state === "accepted")).toBe(true);
    expect(sendResult.data.rows.every((row) => !row.retry.available)).toBe(true);
    expect(sendResult.data.counts.accepted + sendResult.data.counts.failed + sendResult.data.counts.unknown).toBe(sendResult.data.rows.length);
    expect(JSON.stringify(sendResult.data)).not.toMatch(/delivered|delivery|was read|has been read|opened at/iu);
  });
});

describe("3. a replay recovers the stored result with no second effect", () => {
  it("returns alreadyAccepted for the same operation id, with one ledger record, one send result and one message", async () => {
    expect((await armLostAcknowledgement()).outcome).toBe("accepted");
    const attempt = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
    expect((await notify(attempt)).outcome).toBe("unknown");

    const replay = await notify(attempt);
    expect(replay.outcome).toBe("alreadyAccepted");
    expect(replay.operationId).toBe(attempt.operationId);
    const intentId = intentIdOfStoredResult(replay, "the replay");

    const { state, operations } = await storedDocuments();
    const intents = intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.intentId).toBe(intentId);
    // One attempt identity holds one ledger record: a second replay would be answered from it, never appended.
    expect(ledgerRecordsFor(operations, attempt.operationId)).toHaveLength(1);
    const results = sendResultsFor(state, intentId);
    expect(results).toHaveLength(1);
    const [result] = results;
    // One copy, to the one recipient this second edition of the Update still owes a notice: everyone
    // else already holds a copy of this document. A replay adds no further copy.
    const copies = result === undefined ? [] : result.recipients.filter((copy) => copy.recipientId === FAILED_RECIPIENT_ID);
    expect(copies).toHaveLength(1);

    await mirrorPublisherWorld(FAILED_RECIPIENT_ID);
    const inbox = await inboxOf(READER_SOURCE);
    const messages = inbox.data.messages.filter((message) => message.intentId === intentId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.renditionId).toBe(copies[0]?.renditionId);
    // The seeded publication's notice and this one: a replay added no third message.
    expect(inbox.data.intentCount).toBe(2);
  });
});

describe("4. a fresh operation key never sends the same intent twice", () => {
  it("suppresses a second submission under a new operation id: no second intent, send result or message", async () => {
    const first = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
    expect((await notify(first)).outcome).toBe("accepted");
    const { state: afterFirst } = await storedDocuments();
    const [intent] = intentsFor(afterFirst, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
    if (intent === undefined) {
      throw new Error("The first submission recorded no intent, so this case has no notification to attempt again.");
    }
    // The same notification intent under a freshly minted attempt identity: the naive retry.
    const second = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
    expect(second.operationId).not.toBe(first.operationId);
    const suppressed = await notify(second);
    expect(suppressed.outcome).toBe("unchanged");
    expect(suppressed.outcome).not.toBe("accepted");

    const { state, operations } = await storedDocuments();
    expect(intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE)).toHaveLength(1);
    expect(sendResultsFor(state, intent.intentId)).toHaveLength(1);
    // Nothing was recorded for the second attempt, so it neither sent nor became recoverable work.
    expect(ledgerRecordsFor(operations, second.operationId)).toHaveLength(0);

    await mirrorPublisherWorld(FAILED_RECIPIENT_ID);
    const messages = (await inboxOf(READER_SOURCE)).data.messages.filter((message) => message.intentId === intent.intentId);
    expect(messages).toHaveLength(1);
  });
});

describe("5. one recipient receives exactly one copy of one Update", () => {
  it("gives a recipient eligible for both audiences one message, under the one rendition the accepted intent recorded", async () => {
    // Ada holds one copy of the seeded public notice of this Update.
    const seeded = await sendResultOf(SEEDED_INTENT_ID);
    const seededRows = seeded.data.rows.filter((row) => row.recipientId === RECIPIENT_ID);
    expect(seededRows).toHaveLength(1);
    // She is eligible for the protected edition of the same Update as well, so nothing but the dedupe
    // identity stands between her and a second copy.
    const audience = await audienceOf();
    expect(audience.data.members.find((row) => row.recipientId === RECIPIENT_ID)?.eligible).toBe(true);

    // The protected edition is notified: one copy of this Update already exists for her.
    const supporter = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: SUPPORTER_ENGLISH_RELEASE });
    expect((await notify(supporter)).outcome).toBe("accepted");
    const { state } = await storedDocuments();
    const [intent] = intentsFor(state, UPDATE_DOCUMENT_ID, SUPPORTER_ENGLISH_RELEASE);
    if (intent === undefined) {
      throw new Error("The protected edition's notice recorded no intent, so its recipients cannot be counted.");
    }
    const sendResult = await sendResultOf(intent.intentId);
    // Two audiences of one publication, and one copy: not the public edition and the protected one.
    expect(sendResult.data.rows.some((row) => row.recipientId === RECIPIENT_ID)).toBe(false);

    await mirrorPublisherWorld(RECIPIENT_ID);
    const inbox = await inboxOf(READER_SOURCE);
    expect(inbox.data.messages).toHaveLength(1);
    const [message] = inbox.data.messages;
    if (message === undefined) {
      throw new Error("The recipient's inbox holds no message for the Update she was notified about.");
    }
    // The one message is the pin the accepted intent recorded, in that edition and language alone.
    expect(message.intentId).toBe(SEEDED_INTENT_ID);
    expect(message.releaseId).toBe(PUBLIC_ENGLISH_RELEASE);
    expect(message.renditionId).toBe(seededRows[0]?.renditionId);
    // A simulated submission is labelled where the reader sees it, and it claims no delivery.
    expect(message.simulated).toContain("mail-submission");
    const preferences = await preferencesOf(READER_SOURCE);
    expect(preferences.data.pinnedCopies).toHaveLength(1);
    expect(preferences.data.pinnedCopies[0]?.releaseId).toBe(PUBLIC_ENGLISH_RELEASE);
    expect(preferences.data.pinnedCopies[0]?.renditionId).toBe(seededRows[0]?.renditionId);

    // The resolver the submission used, offered both editions of the same Update at once, answers with
    // one pin rather than one per audience.
    const pinned = resolveRendition({
      recipient: { recipientId: RECIPIENT_ID, admittedAudiences: ["public", "approved-supporter"], languagePreference: "en" },
      candidates: renditionCandidatesOf(state, [PUBLIC_ENGLISH_RELEASE, SUPPORTER_ENGLISH_RELEASE]),
      siteDefaultLocale: "en",
    });
    expect(pinned.status).toBe("pinned");
    if (pinned.status !== "pinned") {
      throw new Error(`Both editions of one Update resolved to no pin: ${pinned.reason}.`);
    }
    expect(pinned.rendition.audience).toBe("approved-supporter");
    expect(pinned.rendition.releaseId).toBe(SUPPORTER_ENGLISH_RELEASE);
    // The message built from that pin carries exactly that one pin and points at the copy rather than
    // embedding it: a notice carries no protected prose, image, poster or transcript.
    const notice = buildNotice({
      publisher: { displayName: "Harbour Youth" },
      purpose: UPDATE_EMAIL_PURPOSE,
      pinned: pinned.rendition,
      sender: { name: "Update notices", address: "update-notice@example.invalid" },
      link: `/preview/${UPDATE_DOCUMENT_ID}`,
    });
    expect(notice.pinned).toEqual(pinned.rendition);
    expect(notice.link).toBe(`/preview/${UPDATE_DOCUMENT_ID}`);
    expect(notice.htmlBody).not.toMatch(/<(img|video|audio|iframe)\b/iu);
  });
});

describe("6. a definite failure comes from real input and retries only while the notice is useful", () => {
  it("excludes every membership that cannot accept a notice, with its reason, and issues a copy to none of them", async () => {
    const audience = await audienceOf();
    const member = (membershipId: string) => audience.data.members.find((row) => row.recipientId === membershipId);
    expect(member(UNSUBSCRIBED_MEMBERSHIP_ID)?.eligible).toBe(false);
    expect(member(UNSUBSCRIBED_MEMBERSHIP_ID)?.exclusionReason).toBe("unsubscribed");
    expect(member(RESTRICTED_MEMBERSHIP_ID)?.eligible).toBe(false);
    expect(member(RESTRICTED_MEMBERSHIP_ID)?.exclusionReason).toBe("restricted");
    expect(member(AWAITING_PROOF_MEMBERSHIP_ID)?.exclusionReason).toBe("awaiting-proof");
    // A source-supplied `subscribed` column is a flag and not a choice: the row stays off and receives nothing.
    expect(member(SUBSCRIBED_COLUMN_MEMBERSHIP_ID)?.state).toBe("off");
    expect(member(SUBSCRIBED_COLUMN_MEMBERSHIP_ID)?.exclusionReason).toBe("off");
    expect(audience.data.excludedByReason.unsubscribed).toBeGreaterThan(0);
    expect(audience.data.counts.eligible).toBeGreaterThan(0);

    const attempt = notificationAttempt({ documentId: UPDATE_DOCUMENT_ID, releaseId: PUBLIC_FRENCH_RELEASE });
    expect((await notify(attempt)).outcome).toBe("accepted");
    const { state } = await storedDocuments();
    const [intent] = intentsFor(state, UPDATE_DOCUMENT_ID, PUBLIC_FRENCH_RELEASE);
    if (intent === undefined) {
      throw new Error("The submission recorded no intent, so the copies it produced cannot be read.");
    }
    const sendResult = await sendResultOf(intent.intentId);
    for (const membershipId of [UNSUBSCRIBED_MEMBERSHIP_ID, RESTRICTED_MEMBERSHIP_ID, AWAITING_PROOF_MEMBERSHIP_ID, SUBSCRIBED_COLUMN_MEMBERSHIP_ID]) {
      expect(sendResult.data.rows.some((row) => row.recipientId === membershipId)).toBe(false);
    }
    // The definite failure this file retries is the seeded one: a copy the local stand-in did not take.
    const seededFailure = (await sendResultOf(SEEDED_INTENT_ID)).data.rows.find((row) => row.recipientId === FAILED_RECIPIENT_ID);
    expect(seededFailure?.state).toBe("failed");
  });

  it("retries a failed copy only inside 24 elapsed hours from the instant it was intended for, strict at equality", async () => {
    // The boundary itself, from the one function that computes it: 24 elapsed hours, and a request at
    // exactly the deadline is already too late.
    expect(USEFULNESS_ENDS.toString()).toBe(SEEDED_INTENDED_AT.add({ hours: 24 }).toString());
    expect(notificationDeadline({ intendedAt: SEEDED_INTENDED_AT, now: USEFULNESS_ENDS.subtract({ nanoseconds: 1 }) }).status).toBe("within-usefulness");
    expect(notificationDeadline({ intendedAt: SEEDED_INTENDED_AT, now: USEFULNESS_ENDS }).status).toBe("past-usefulness");

    const expired = await sendResultOf(SEEDED_INTENT_ID);
    expect(expired.data.usefulness.state).toBe("past-usefulness");
    const expiredFailure = expired.data.rows.find((row) => row.recipientId === FAILED_RECIPIENT_ID);
    expect(expiredFailure?.state).toBe("failed");
    expect(expiredFailure?.retry.available).toBe(false);
    expect(expiredFailure?.retry.reason).toMatch(/usefulness window has closed/iu);

    // Inside the window the same definite failure may be attempted again under this same intent.
    await moveClockTo(USEFULNESS_ENDS.subtract({ hours: 1 }));
    const open = await sendResultOf(SEEDED_INTENT_ID);
    expect(open.data.usefulness.state).toBe("within-usefulness");
    expect(open.data.usefulness.deadline).toBe(USEFULNESS_ENDS.toString());
    expect(open.data.rows.find((row) => row.recipientId === FAILED_RECIPIENT_ID)?.retry.available).toBe(true);

    // At the deadline, to the instant: the window closes, and stating the instant it was intended for
    // cannot revive the intent as a fresh attempt.
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
});
