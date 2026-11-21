/**
 * Proves a partial release, and the one review step that authorises a release at all (success
 * criteria 9 and 17).
 *
 * AAP 0.8.5 states the rule this suite turns on: synthesis results are reported per selected edition,
 * and when one release succeeds while a sibling fails, the success stands and the sibling keeps the
 * head it had already published — there is no batch rollback. The failed member recovers under its own
 * operation identity, so a caller who lost the acknowledgement re-queries the same attempt instead of
 * publishing again. Criterion 17 names the same outcome from the receiving side ("a partial-release
 * failure keeps the other's prior-good head"); criterion 9 supplies the other half, that a review
 * answers one exact frozen revision, that a later draft edit leaves the released revision alone, and
 * that a reviewer can neither turn Publish only into Notify nor approve a sibling edition.
 *
 * Why this runs over the real store instead of a stub: the publication, its per-edition results and
 * the ledger record that makes a replay return them are written in one transaction. A mock would let
 * those three disagree, which is exactly the failure this suite exists to catch. So the deterministic
 * seed is laid down in this file's own private session through the store, every change is made through
 * the named mutations, and the absences the rule requires — no second release, no second ledger
 * record, no notification intent, no escalated review — are counted from the documents that
 * transaction wrote.
 *
 * Recorded divergence from the brief this file was written against: `reads.readInbox` and
 * `reads.readSendResult` resolve the session from the request cookie, so outside a request scope they
 * throw ("cookies was called outside a request scope") rather than answering. The notification
 * evidence is therefore counted from the same session's stored `notificationIntents` and
 * `notificationResults` — the records those two reads project — which proves the same absence without
 * a second path, a mock or a fabricated request scope.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type MutationOutcome, type Scope } from "@/modules/data-service";
import { resolveSession } from "@/modules/data-service/authorize";
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { readSession, resetSession } from "@/modules/store/repository";
import { SEED_INSTANT } from "@/modules/time/clock";
/** This file's own session: a private id, so no other suite's seeded world is shared, disturbed or stranded. */
const SESSION_ID = "it-publish-partial";

const SESSION = { sessionId: SESSION_ID };
/** The seeded Update whose editions carry a release, an approved-supporter sibling and one submission under review. */
const DOCUMENT_ID = "doc-update-autumn";
/** The edition this suite releases: seeded with the release `release-update-en-1` at its head. */
const PUBLIC_EN_EDITION = "variant-update-autumn-en-public";
/** The sibling whose attempt fails: seeded with a frozen candidate still awaiting its review and no release head. */
const PUBLIC_AR_EDITION = "variant-update-autumn-ar-public";
/** The release the fresh seed leaves at the English edition's head. */
const SEEDED_EN_RELEASE = "release-update-en-1";
/** The prose a later save writes, so a published revision and a newer draft can never be confused. */
const LATER_PROSE = ["Autumn at Harbour Youth", "A later wording, written after the review."];
/** The per-edition state the service reports for an edition that still needs a reviewer's answer. */
const AWAITING_REVIEW_CODE = "awaiting-review";
const PUBLISH_ONLY = "publish-only" as const;
const PUBLISH_AND_NOTIFY = "publish-and-notify" as const;

function describeOutcome(outcome: MutationOutcome): string {
  return JSON.stringify(outcome);
}
/** One admitted content body in the profile's own shape: what the editor writes and a draft save validates. */
function documentBody(prose: readonly string[], direction: "ltr" | "rtl" = "ltr") {
  return {
    type: "doc",
    profileVersion: 1,
    direction,
    sections: [],
    content: prose.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}
// The seeded world, laid down in this file's own session
let seededDocuments: SeededSessionDocuments | undefined;
let resolvedScope: Scope | undefined;

/** The authority the seeded context gives this session: every change below is made under it, and it is never hand-built. */
function scope(): Scope {
  if (resolvedScope === undefined) {
    throw new Error("This case ran before the seeded session's own scope was resolved, so no change can be authorised.");
  }
  return resolvedScope;
}
/** The records a session's state document holds, as the seed's own document type states them. */
async function storedState(): Promise<SessionStateDocument> {
  const documents = await readSession(SESSION_ID);
  if (documents === undefined) {
    throw new Error(`The store holds no session ${JSON.stringify(SESSION_ID)}, which every case lays down before it runs.`);
  }
  return documents.state as SessionStateDocument;
}
/** One attempt as the operation ledger stores it: what the accepted answer reported, kept for the replay. */
interface StoredOperation {
  readonly operationId: string;
  readonly result: unknown;
  readonly items: unknown;
}
/**
 * The attempts this session's ledger holds. A seeded session's ledger is written as `entries` and a
 * mutated one as `records`, so both members are read: a duplicate attempt would appear in whichever
 * member the write used, and the count is what the replay guarantee turns on.
 */
async function storedOperations(): Promise<readonly StoredOperation[]> {
  const documents = await readSession(SESSION_ID);
  if (documents === undefined) {
    throw new Error(`The store holds no session ${JSON.stringify(SESSION_ID)}, so no ledger can be read for it.`);
  }
  const ledger = documents.operations;
  if (!isRecord(ledger)) {
    throw new Error("The session's operations document is not the operation ledger this suite reads, so no attempt can be counted.");
  }
  const operations: StoredOperation[] = [];
  const collect = (value: unknown): void => {
    if (isRecord(value) && typeof value.operationId === "string") {
      operations.push({ operationId: value.operationId, result: value.result, items: value.items });
    }
  };
  const records = ledger["records"];
  if (isRecord(records)) {
    Object.values(records).forEach(collect);
  }
  const entries = ledger["entries"];
  if (Array.isArray(entries)) {
    entries.forEach(collect);
  }
  return operations;
}
async function storedOperationsFor(operationId: string): Promise<readonly StoredOperation[]> {
  return (await storedOperations()).filter((operation) => operation.operationId === operationId);
}
/** What the notification side of the session holds: its intents, its send results and one copy per recipient and intent. */
interface NotificationCounts {
  readonly intentIds: readonly string[];
  readonly sendResultIds: readonly string[];
  readonly recipientCopies: number;
}
async function notificationCounts(): Promise<NotificationCounts> {
  const state = await storedState();
  return {
    intentIds: state.notificationIntents.map((intent) => intent.intentId),
    sendResultIds: state.notificationResults.map((result) => result.sendResultId),
    recipientCopies: state.notificationResults.reduce((total, result) => total + result.recipients.length, 0),
  };
}
/** One document's variant matrix: every edition with its own draft, candidate and release-head pointers. */
async function variantMatrix() {
  const result = await reads.updates.readVariantOverview({ documentId: DOCUMENT_ID, session: SESSION });
  if (result.kind !== "envelope") {
    throw new Error(`The variant matrix of ${DOCUMENT_ID} answered an envelope of kind "${result.kind}" rather than the matrix itself.`);
  }
  return result.envelope;
}
async function editionView(variantId: string) {
  const matrix = await variantMatrix();
  const edition = matrix.data.editions.find((candidate) => candidate.variantId === variantId);
  if (edition === undefined) {
    throw new Error(`The variant matrix of ${DOCUMENT_ID} holds no edition ${JSON.stringify(variantId)}.`);
  }
  return edition;
}
/** The candidate one edition has frozen, with the single review step it may receive. */
async function candidateView(variantId: string) {
  const result = await reads.updates.readCandidate({ variantId, session: SESSION });
  if (result.kind !== "envelope") {
    throw new Error(`The candidate of ${variantId} answered an envelope of kind "${result.kind}" rather than the candidate itself.`);
  }
  return result.envelope;
}
/** The release standing at one edition's head, or one named release from its history. */
async function releaseView(variantId: string, releaseId?: string) {
  const result = await reads.updates.readRelease({ variantId, ...(releaseId === undefined ? {} : { releaseId }), session: SESSION });
  if (result.kind !== "envelope") {
    throw new Error(`The release of ${variantId} answered an envelope of kind "${result.kind}" rather than the release itself.`);
  }
  return result.envelope;
}
/**
 * The revision token a stored revision record stands at. Every mutation that acts on a revision
 * compares the caller's `expectedRevision` against the record it is about to change, so the token is
 * read from that record rather than assumed; a first-time draft has no record to compare against and
 * needs none.
 */
async function storedRevisionToken(revisionId: string): Promise<string> {
  const state = await storedState();
  const record = state.contentRevisions.find((candidate) => candidate.revisionId === revisionId);
  if (record === undefined) {
    throw new Error(`The session's stored content holds no revision ${JSON.stringify(revisionId)}, so a change to it cannot be prepared.`);
  }
  return record.revision;
}
/** The revision a draft save must present: the working revision's own token, or the edition's when it holds no draft yet. */
async function draftSaveExpectation(edition: { readonly draftRevisionId: string | null; readonly recordRevision: string }): Promise<string> {
  return edition.draftRevisionId === null ? edition.recordRevision : storedRevisionToken(edition.draftRevisionId);
}
/** The accepted change, or a failure that names the outcome the service actually answered. */
function acceptedOutcome(outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "accepted" }> {
  if (outcome.outcome !== "accepted") {
    throw new Error(`This change must be accepted, and the service answered ${describeOutcome(outcome)}.`);
  }
  return outcome;
}
/** The identity a change reported creating, which is what every later step addresses it by. */
function createdId(outcome: Extract<MutationOutcome, { outcome: "accepted" }>, what: string): string {
  const created = outcome.created?.[0];
  if (created === undefined) {
    throw new Error(`An accepted ${what} must report the record it created, and this answer reported none: ${describeOutcome(outcome)}`);
  }
  return created;
}
// The named mutations this suite drives, and nothing else
/** Writes one edition's working draft, then freezes it as the single candidate under review. */
async function saveDraftAndSubmit(variantId: string, prose: readonly string[], direction: "ltr" | "rtl" = "ltr"): Promise<{ readonly draftRevisionId: string; readonly candidateId: string }> {
  const edition = await editionView(variantId);
  const saved = acceptedOutcome(
    await mutations.updates.saveDraft(SESSION_ID, {
      operationId: newOperationId(),
      scope: scope(),
      expectedRevision: await draftSaveExpectation(edition),
      payload: { variantId, body: documentBody(prose, direction) },
    }),
  );
  const draftRevisionId = createdId(saved, "draft save");
  const submitted = acceptedOutcome(
    await mutations.updates.submitForReview(SESSION_ID, {
      operationId: newOperationId(),
      scope: scope(),
      expectedRevision: await storedRevisionToken(draftRevisionId),
      payload: { variantId, revisionId: draftRevisionId, notifyMode: PUBLISH_ONLY },
    }),
  );
  return { draftRevisionId, candidateId: createdId(submitted, "submission") };
}
/** Answers one frozen candidate, which is the review's whole and only step. */
async function answerReviewAsApproved(candidateId: string): Promise<void> {
  acceptedOutcome(
    await mutations.updates.approveCandidate(SESSION_ID, {
      operationId: newOperationId(),
      scope: scope(),
      expectedRevision: await storedRevisionToken(candidateId),
      payload: { candidateId },
    }),
  );
}
/** What one approved edition is identified by: the revision its candidate froze, and the digest a release copies from it. */
interface ApprovedEdition {
  readonly draftRevisionId: string;
  readonly candidateId: string;
  readonly contentChecksum: string;
}
/** The three writes criterion 9 names — save, submit, approve — made through the named mutations and nothing else. */
async function draftSubmitAndApprove(variantId: string, prose: readonly string[], direction: "ltr" | "rtl" = "ltr"): Promise<ApprovedEdition> {
  const written = await saveDraftAndSubmit(variantId, prose, direction);
  await answerReviewAsApproved(written.candidateId);
  const candidate = await candidateView(variantId);
  if (candidate.data.status !== "reviewable") {
    throw new Error(`The approved edition ${JSON.stringify(variantId)} holds no readable candidate, so the review step did not complete.`);
  }
  return { draftRevisionId: written.draftRevisionId, candidateId: written.candidateId, contentChecksum: candidate.data.candidate.contentChecksum };
}
interface EditionSelection {
  readonly variantId: string;
  readonly mode?: typeof PUBLISH_ONLY | typeof PUBLISH_AND_NOTIFY;
}
type PublicationInput = Parameters<typeof mutations.updates.publishVariants>[1];
/** One publication request, built once, so a replay can present the identical operation identity and payload. */
async function publicationInput(selections: readonly EditionSelection[], operationId: string = newOperationId()): Promise<PublicationInput> {
  const matrix = await variantMatrix();
  return {
    operationId,
    scope: scope(),
    expectedRevision: matrix.revision,
    payload: {
      documentId: DOCUMENT_ID,
      variants: selections.map((selection) => ({
        variantId: selection.variantId,
        ...(selection.mode === undefined ? {} : { mode: selection.mode }),
      })),
    },
  };
}
// The development runtime: one armed failure at a time, and the session's own revision token
async function developmentRevision(): Promise<string> {
  const state = await reads.dev.readDevState(SESSION);
  if (state.kind !== "envelope") {
    throw new Error(`This session's development state answered an envelope of kind "${state.kind}" rather than the state itself.`);
  }
  return state.envelope.revision;
}
/**
 * Arms the registry's "lost acknowledgement" on the publication. The effect still commits and its
 * ledger record is still written; only the answer is withheld. That is what makes recovery by the
 * original operation identity the only honest way back, because a fresh key would publish again.
 */
async function armLostAcknowledgement(): Promise<void> {
  acceptedOutcome(
    await mutations.dev.setFailurePlan(
      {
        operationId: newOperationId(),
        scope: scope(),
        expectedRevision: await developmentRevision(),
        payload: { mode: "unknown", target: { kind: "mutation", name: "publishVariants" } },
      },
      SESSION,
    ),
  );
}
/** Clears whatever this session has armed: exactly one failure is active at a time, and none outlives its case. */
async function disarmFailure(): Promise<void> {
  await mutations.dev.setFailurePlan(
    {
      operationId: newOperationId(),
      scope: scope(),
      expectedRevision: await developmentRevision(),
      payload: { plan: null },
    },
    SESSION,
  );
}
beforeAll(async () => {
  // The failure plan is a development control, gated on the build rather than on admission.
  vi.stubEnv("NODE_ENV", "development");
  const sessions = await seed();
  const seeded = sessions.find((row) => row.sessionId === DEFAULT_SESSION_ID);
  if (seeded === undefined) {
    throw new Error(`The deterministic seed lays down no session ${JSON.stringify(DEFAULT_SESSION_ID)}, so this suite has no world to start from.`);
  }
  seededDocuments = seeded.documents;
});
beforeEach(async () => {
  if (seededDocuments === undefined) {
    throw new Error("The seeded world was not laid down before this case ran.");
  }
  // Every case starts from the seed itself, so an earlier case's effects cannot strand it.
  await resetSession(SESSION_ID, seededDocuments);
  const resolution = await resolveSession(SESSION);
  if (!resolution.ok) {
    throw new Error(`The seeded session ${JSON.stringify(SESSION_ID)} could not be resolved: ${JSON.stringify(resolution.refusal)}`);
  }
  if (resolution.session.selected === null) {
    throw new Error("The seeded session selects no context, so no content change could be authorised in it.");
  }
  resolvedScope = resolution.session.selected;
});
afterEach(async () => {
  if (resolvedScope !== undefined) {
    await disarmFailure();
  }
});
afterAll(async () => {
  await resetSession(SESSION_ID);
  // The environment goes back to what this runner set, so a later suite sees the same NODE_ENV it would have had.
  vi.unstubAllEnvs();
});

describe("publishing one submission whose editions do not share a fate", () => {
  it("reports one result per selected edition instead of a batch verdict", async () => {
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "The term closes with a shared meal."]);
    // The Arabic edition's seeded submission is still awaiting its review, so its attempt must fail
    // while the English edition's attempt succeeds — in one call, over one submission.
    const published = acceptedOutcome(
      await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])),
    );
    const items = published.items ?? [];
    // One row per selected edition, each addressed by its own edition identity.
    expect(items.map((item) => item.targetId)).toEqual([PUBLIC_EN_EDITION, PUBLIC_AR_EDITION]);
    // The rows disagree, which an aggregate verdict could not express: the two editions did not share a fate.
    const released = items.filter((item) => item.state === "released");
    const failed = items.filter((item) => item.state === "needs-attention");
    expect(released.map((item) => item.targetId)).toEqual([PUBLIC_EN_EDITION]);
    expect(failed.map((item) => item.targetId)).toEqual([PUBLIC_AR_EDITION]);
    // The failing row states a reason somebody can act on, and no release identity it never obtained.
    const sibling = failed[0];
    expect(sibling?.reasonCode).toBe(AWAITING_REVIEW_CODE);
    expect(sibling?.reason ?? "").toMatch(/review/i);
    expect((sibling?.reason ?? "").length).toBeGreaterThan(20);
    expect(sibling?.revision).toBeUndefined();
    // The answer names the edition it changed, so no caller has to read a success off the absence of an error.
    expect(published.changed).toContain(PUBLIC_EN_EDITION);
    expect(published.changed).not.toContain(PUBLIC_AR_EDITION);
    // The released row is the approved candidate's revision, reported as the release it created.
    expect(released[0]?.revision).toEqual(expect.any(String));
    expect(approved.candidateId).toBe(approved.draftRevisionId);
  });

  it("keeps the sibling's success rather than rolling the batch back", async () => {
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
    const published = acceptedOutcome(
      await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])),
    );
    const head = await releaseView(PUBLIC_EN_EDITION);
    expect(head.data.status).toBe("released");
    if (head.data.status !== "released") {
      throw new Error("The English edition must still publish a release after its sibling failed.");
    }
    const release = head.data.release;
    // The head is a new release of exactly the revision the candidate froze and the reviewer approved.
    expect(release.releaseId).not.toBe(SEEDED_EN_RELEASE);
    expect(release.revisionId).toBe(approved.candidateId);
    expect(release.contentChecksum).toBe(approved.contentChecksum);
    // It is stamped with the session's own scenario instant, never with wall-clock time.
    expect(release.publishedAt.toString()).toBe(SEED_INSTANT.toString());
    // The head the seed left is superseded by it and withdrawn by nobody: a sibling's failure is not a withdrawal.
    const superseded = await releaseView(PUBLIC_EN_EDITION, SEEDED_EN_RELEASE);
    expect(superseded.data.status).toBe("released");
    if (superseded.data.status !== "released") {
      throw new Error("The release the seed published must still be readable from its history.");
    }
    expect(superseded.data.release.supersededBy).toBe(release.releaseId);
    expect(superseded.data.release.withdrawnAt).toBeUndefined();
    // The head the answer reported is the head the store holds, and exactly one release was added.
    expect(published.items?.find((item) => item.targetId === PUBLIC_EN_EDITION)?.revision).toBe(release.releaseId);
    const state = await storedState();
    expect(state.contentVariants.find((variant) => variant.variantId === PUBLIC_EN_EDITION)?.releaseHeadId).toBe(release.releaseId);
    expect(state.releases.filter((stored) => stored.variantId === PUBLIC_EN_EDITION).map((stored) => stored.releaseId)).toEqual([SEEDED_EN_RELEASE, release.releaseId]);
  });

  it("keeps the failing sibling's prior-good head and records no release at the failed revision", async () => {
    // First the Arabic edition earns a published head of its own, through the same three writes as any edition.
    const seededCandidate = await candidateView(PUBLIC_AR_EDITION);
    if (seededCandidate.data.status !== "reviewable") {
      throw new Error("The seeded Arabic edition must hold a frozen candidate for this case to start from it.");
    }
    expect(seededCandidate.data.review.decision).toBeNull();
    await answerReviewAsApproved(seededCandidate.data.candidate.candidateId);
    const firstPublication = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_AR_EDITION }])));
    expect(firstPublication.items?.[0]?.state).toBe("released");
    const before = await editionView(PUBLIC_AR_EDITION);
    if (before.releaseHeadId === null || before.headRelease === null) {
      throw new Error("The Arabic edition's first release must stand at its head before the partial attempt.");
    }
    // A second working draft then goes under review and stays there: that unanswered review is this attempt's failure.
    const failing = await saveDraftAndSubmit(PUBLIC_AR_EDITION, ["الخريف في هاربر يوث", "نص أحدث لا يزال قيد المراجعة."], "rtl");
    const approvedEnglish = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
    const published = acceptedOutcome(
      await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])),
    );
    const sibling = (published.items ?? []).find((item) => item.targetId === PUBLIC_AR_EDITION);
    expect(sibling?.state).toBe("needs-attention");
    expect(sibling?.reasonCode).toBe(AWAITING_REVIEW_CODE);
    // No release identity was invented for the failed attempt.
    expect(sibling?.revision).toBeUndefined();
    // The English sibling really did release, so this is a partial outcome rather than an empty one.
    expect((await editionView(PUBLIC_EN_EDITION)).headRelease?.revisionId).toBe(approvedEnglish.candidateId);
    // The Arabic edition still publishes exactly the revision it published before the attempt.
    const after = await editionView(PUBLIC_AR_EDITION);
    expect(after.releaseHeadId).toBe(before.releaseHeadId);
    expect(after.headRelease?.releaseId).toBe(before.headRelease.releaseId);
    expect(after.headRelease?.revisionId).toBe(before.headRelease.revisionId);
    expect(after.headRelease?.publishedAt.toString()).toBe(before.headRelease.publishedAt.toString());
    // The submission under review is the edition's own state; the failure changed nothing about its publication.
    expect(after.candidateId).toBe(failing.candidateId);
    const held = await releaseView(PUBLIC_AR_EDITION);
    expect(held.data.status).toBe("released");
    if (held.data.status !== "released") {
      throw new Error("A failed sibling is not a withdrawn publication: its prior-good head must still be readable.");
    }
    expect(held.data.release.releaseId).toBe(before.headRelease.releaseId);
    expect(held.data.release.withdrawnAt).toBeUndefined();
    expect(held.data.release.supersededBy).toBeUndefined();
    // No release exists at the revision the failed attempt would have published, and no second head either.
    const arabicReleases = (await storedState()).releases.filter((release) => release.variantId === PUBLIC_AR_EDITION);
    expect(arabicReleases.map((release) => release.releaseId)).toEqual([before.headRelease.releaseId]);
    expect(arabicReleases.filter((release) => release.revisionId === failing.candidateId)).toHaveLength(0);
  });

  it("recovers a lost acknowledgement under the original operation instead of publishing twice", async () => {
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
    const notificationsBefore = await notificationCounts();
    const input = await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }]);
    await armLostAcknowledgement();
    const first = await mutations.updates.publishVariants(SESSION_ID, input);
    // The fate is not claimed either way: neither a success nor a failure, under this attempt's own identity.
    expect(first.outcome).toBe("unknown");
    expect(first.operationId).toBe(input.operationId);
    // The effect is real and stored exactly once, which is what makes the uncertainty honest rather than vague.
    const headAfterFirst = await releaseView(PUBLIC_EN_EDITION);
    expect(headAfterFirst.data.status).toBe("released");
    if (headAfterFirst.data.status !== "released") {
      throw new Error("The withheld acknowledgement must still have published the English edition exactly once.");
    }
    expect(headAfterFirst.data.release.revisionId).toBe(approved.candidateId);
    expect((await storedState()).releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
    const stored = await storedOperationsFor(input.operationId);
    expect(stored).toHaveLength(1);
    // The replay is the same attempt, not a second publication: identical identity, identical payload.
    const replay = await mutations.updates.publishVariants(SESSION_ID, input);
    expect(replay.outcome).toBe("alreadyAccepted");
    if (replay.outcome !== "alreadyAccepted") {
      throw new Error("Replaying the same operation must return the stored result, and it answered " + describeOutcome(replay) + ".");
    }
    expect(replay.operationId).toBe(input.operationId);
    expect(replay.result).toEqual(stored[0]?.result);
    expect(replay.items).toEqual(stored[0]?.items);
    // No second ledger record, no second release at that revision, and no third release for the edition.
    expect(await storedOperationsFor(input.operationId)).toHaveLength(1);
    const afterReplay = await storedState();
    expect(afterReplay.releases.filter((release) => release.revisionId === approved.candidateId)).toHaveLength(1);
    expect(afterReplay.releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
    // The sibling that failed is still untouched, and a publication is still not a notification.
    expect((await editionView(PUBLIC_AR_EDITION)).releaseHeadId).toBeNull();
    expect(await notificationCounts()).toEqual(notificationsBefore);
  });

  it("freezes the exact revision a reviewer approved, and a later draft edit changes neither the candidate nor the release", async () => {
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "The wording the reviewer answered."]);
    const frozen = await candidateView(PUBLIC_EN_EDITION);
    if (frozen.data.status !== "reviewable") {
      throw new Error("The approved edition must hold a readable frozen candidate.");
    }
    const approvedChecksum = frozen.data.candidate.contentChecksum;
    expect(frozen.data.review.decision).toBe("approved");
    const beforeEdit = await editionView(PUBLIC_EN_EDITION);
    // A later autosave moves the working revision only.
    const saved = acceptedOutcome(
      await mutations.updates.saveDraft(SESSION_ID, {
        operationId: newOperationId(),
        scope: scope(),
        expectedRevision: await draftSaveExpectation(beforeEdit),
        payload: { variantId: PUBLIC_EN_EDITION, body: documentBody(LATER_PROSE) },
      }),
    );
    const laterRevisionId = createdId(saved, "draft save");
    expect(laterRevisionId).not.toBe(approved.draftRevisionId);
    const afterEdit = await editionView(PUBLIC_EN_EDITION);
    // The draft advanced its own revision; the candidate pointer and the release head did not move.
    expect(afterEdit.draftRevisionId).toBe(laterRevisionId);
    expect(afterEdit.recordRevision).not.toBe(beforeEdit.recordRevision);
    expect(afterEdit.candidateId).toBe(beforeEdit.candidateId);
    expect(afterEdit.releaseHeadId).toBe(SEEDED_EN_RELEASE);
    // The frozen candidate still states the revision and digest the reviewer approved.
    const stillFrozen = await candidateView(PUBLIC_EN_EDITION);
    if (stillFrozen.data.status !== "reviewable") {
      throw new Error("A later draft edit must not disturb the frozen candidate.");
    }
    expect(stillFrozen.data.candidate.revisionId).toBe(approved.candidateId);
    expect(stillFrozen.data.candidate.contentChecksum).toBe(approvedChecksum);
    expect(stillFrozen.data.review.decision).toBe("approved");
    // Releasing publishes the approved revision, never the newer draft.
    acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }])));
    const head = await releaseView(PUBLIC_EN_EDITION);
    expect(head.data.status).toBe("released");
    if (head.data.status !== "released") {
      throw new Error("The edition must publish the approved candidate it holds.");
    }
    expect(head.data.release.revisionId).toBe(approved.candidateId);
    expect(head.data.release.revisionId).not.toBe(laterRevisionId);
    expect(head.data.release.contentChecksum).toBe(approvedChecksum);
  });

  it("completes the review in one step, refuses a second round and never turns Publish only into Notify", async () => {
    const notificationsBefore = await notificationCounts();
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
    const candidate = await candidateView(PUBLIC_EN_EDITION);
    if (candidate.data.status !== "reviewable") {
      throw new Error("The submitted edition must hold a readable frozen candidate.");
    }
    // One submission and one answer complete the review, and the answer covers this edition alone.
    expect(candidate.data.review.steps).toBe(1);
    expect(candidate.data.review.round).toBe(1);
    expect(candidate.data.review.decision).toBe("approved");
    expect(candidate.data.review.approvalScope).toBe("this-variant-only");
    // Approving one edition approved no other: the sibling's submission is still unanswered.
    const sibling = await candidateView(PUBLIC_AR_EDITION);
    if (sibling.data.status !== "reviewable") {
      throw new Error("The seeded Arabic edition must hold the submission this case contrasts with.");
    }
    expect(sibling.data.review.decision).toBeNull();
    // A second answer is not a second review round.
    const secondAnswer = await mutations.updates.approveCandidate(SESSION_ID, {
      operationId: newOperationId(),
      scope: scope(),
      expectedRevision: await storedRevisionToken(approved.candidateId),
      payload: { candidateId: approved.candidateId },
    });
    expect(secondAnswer.outcome).not.toBe("accepted");
    expect(["unchanged", "conflict"]).toContain(secondAnswer.outcome);
    // A second submission of the same revision is refused: a new round needs a new revision.
    const resubmission = await mutations.updates.submitForReview(SESSION_ID, {
      operationId: newOperationId(),
      scope: scope(),
      expectedRevision: await storedRevisionToken(approved.candidateId),
      payload: { variantId: PUBLIC_EN_EDITION, revisionId: approved.draftRevisionId },
    });
    expect(resubmission.outcome).toBe("invalid");
    // Publishing only releases the edition and creates no notification intent, send result or inbox copy.
    const publishInput = await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }]);
    acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, publishInput));
    const storedPublication = (await storedOperationsFor(publishInput.operationId))[0];
    expect(storedPublication?.result).toMatchObject({ editions: [{ variantId: PUBLIC_EN_EDITION, state: "released", notifyMode: PUBLISH_ONLY }] });
    expect(await notificationCounts()).toEqual(notificationsBefore);
    // A reviewer cannot turn Publish only into Notify: the mode the submission never asked for is refused,
    // and the refusal releases nothing.
    const escalated = await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_AND_NOTIFY }]));
    expect(escalated.outcome).toBe("invalid");
    expect(await notificationCounts()).toEqual(notificationsBefore);
    const state = await storedState();
    expect(state.releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
    expect(state.releases.filter((release) => release.revisionId === approved.candidateId)).toHaveLength(1);
  });
});
