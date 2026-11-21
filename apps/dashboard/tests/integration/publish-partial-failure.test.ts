/** Proves a partial release, and the one review step that authorises a release at all (success criteria 9 and 17). */
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
const DOCUMENT_ID = "doc-update-autumn";
const PUBLIC_EN_EDITION = "variant-update-autumn-en-public";
const PUBLIC_AR_EDITION = "variant-update-autumn-ar-public";
const SEEDED_EN_RELEASE = "release-update-en-1";
/** The prose a later save writes, so a published revision and a newer draft can never be confused. */
const LATER_PROSE = ["Autumn at Harbour Youth", "A later wording, written after the review."];
const AWAITING_REVIEW_CODE = "awaiting-review";
const PUBLISH_ONLY = "publish-only" as const;
const PUBLISH_AND_NOTIFY = "publish-and-notify" as const;
function describeOutcome(outcome: MutationOutcome): string {
  return JSON.stringify(outcome);
}
function documentBody(prose: readonly string[], direction: "ltr" | "rtl" = "ltr") {
  return { type: "doc", profileVersion: 1, direction, sections: [], content: prose.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) };
}
let seededDocuments: SeededSessionDocuments | undefined;
let resolvedScope: Scope | undefined;
function scope(): Scope {
  if (resolvedScope === undefined) throw new Error("This case ran before the seeded session's own scope was resolved, so no change can be authorised.");
  return resolvedScope;
}
async function storedState(): Promise<SessionStateDocument> {
  const documents = await readSession(SESSION_ID);
  if (documents === undefined) throw new Error(`The store holds no session ${JSON.stringify(SESSION_ID)}, which every case lays down before it runs.`);
  return documents.state as SessionStateDocument;
}
interface StoredOperation {
  readonly operationId: string;
  readonly result: unknown;
  readonly items: unknown;
}
async function storedOperations(): Promise<readonly StoredOperation[]> {
  const documents = await readSession(SESSION_ID);
  if (documents === undefined) throw new Error(`The store holds no session ${JSON.stringify(SESSION_ID)}, so no ledger can be read for it.`);
  const ledger = documents.operations;
  if (!isRecord(ledger)) throw new Error("The session's operations document is not the operation ledger this suite reads, so no attempt can be counted.");
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
interface NotificationCounts {
  readonly intentIds: readonly string[];
  readonly sendResultIds: readonly string[];
  readonly recipientCopies: number;
}
async function notificationCounts(): Promise<NotificationCounts> {
  const state = await storedState();
  return { intentIds: state.notificationIntents.map((intent) => intent.intentId), sendResultIds: state.notificationResults.map((result) => result.sendResultId), recipientCopies: state.notificationResults.reduce((total, result) => total + result.recipients.length, 0) };
}
async function variantMatrix() {
  const result = await reads.updates.readVariantOverview({ documentId: DOCUMENT_ID, session: SESSION });
  if (result.kind !== "envelope") throw new Error(`The variant matrix of ${DOCUMENT_ID} answered an envelope of kind "${result.kind}" rather than the matrix itself.`);
  return result.envelope;
}
async function editionView(variantId: string) {
  const matrix = await variantMatrix();
  const edition = matrix.data.editions.find((candidate) => candidate.variantId === variantId);
  if (edition === undefined) throw new Error(`The variant matrix of ${DOCUMENT_ID} holds no edition ${JSON.stringify(variantId)}.`);
  return edition;
}
async function candidateView(variantId: string) {
  const result = await reads.updates.readCandidate({ variantId, session: SESSION });
  if (result.kind !== "envelope") throw new Error(`The candidate of ${variantId} answered an envelope of kind "${result.kind}" rather than the candidate itself.`);
  return result.envelope;
}
async function releaseView(variantId: string, releaseId?: string) {
  const result = await reads.updates.readRelease({ variantId, ...(releaseId === undefined ? {} : { releaseId }), session: SESSION });
  if (result.kind !== "envelope") throw new Error(`The release of ${variantId} answered an envelope of kind "${result.kind}" rather than the release itself.`);
  return result.envelope;
}
async function draftEnvelopeRevision(variantId: string): Promise<string> {
  const result = await reads.updates.readDraft({ variantId, session: SESSION });
  if (result.kind !== "envelope") throw new Error(`The draft of ${variantId} answered an envelope of kind "${result.kind}" rather than the draft itself.`);
  return result.envelope.revision;
}
function acceptedOutcome(outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "accepted" }> {
  if (outcome.outcome !== "accepted") throw new Error(`This change must be accepted, and the service answered ${describeOutcome(outcome)}.`);
  return outcome;
}
function createdId(outcome: Extract<MutationOutcome, { outcome: "accepted" }>, what: string): string {
  const created = outcome.created?.[0];
  if (created === undefined) throw new Error(`An accepted ${what} must report the record it created, and this answer reported none: ${describeOutcome(outcome)}`);
  return created;
}
async function saveDraftAndSubmit(variantId: string, prose: readonly string[], direction: "ltr" | "rtl" = "ltr"): Promise<{ readonly draftRevisionId: string; readonly candidateId: string }> {
  const saved = acceptedOutcome(await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: await draftEnvelopeRevision(variantId), payload: { variantId, body: documentBody(prose, direction) } }));
  const draftRevisionId = createdId(saved, "draft save");
  const submitted = acceptedOutcome(await mutations.updates.submitForReview(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: await draftEnvelopeRevision(variantId), payload: { variantId, revisionId: draftRevisionId, notifyMode: PUBLISH_ONLY } }));
  return { draftRevisionId, candidateId: createdId(submitted, "submission") };
}
async function answerReviewAsApproved(variantId: string, candidateId: string): Promise<void> {
  const candidate = await candidateView(variantId);
  acceptedOutcome(await mutations.updates.approveCandidate(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: candidate.revision, payload: { candidateId } }));
}
interface ApprovedEdition {
  readonly draftRevisionId: string;
  readonly candidateId: string;
  readonly contentChecksum: string;
}
/** The three writes criterion 9 names — save, submit, approve — made through the named mutations and nothing else. */
async function draftSubmitAndApprove(variantId: string, prose: readonly string[], direction: "ltr" | "rtl" = "ltr"): Promise<ApprovedEdition> {
  const written = await saveDraftAndSubmit(variantId, prose, direction);
  await answerReviewAsApproved(variantId, written.candidateId);
  const candidate = await candidateView(variantId);
  if (candidate.data.status !== "reviewable") throw new Error(`The approved edition ${JSON.stringify(variantId)} holds no readable candidate, so the review step did not complete.`);
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
  return { operationId, scope: scope(), expectedRevision: matrix.revision, payload: { documentId: DOCUMENT_ID, variants: selections.map((selection) => ({ variantId: selection.variantId, ...(selection.mode === undefined ? {} : { mode: selection.mode }) })) } };
}
async function developmentRevision(): Promise<string> {
  const state = await reads.dev.readDevState(SESSION);
  if (state.kind !== "envelope") throw new Error(`This session's development state answered an envelope of kind "${state.kind}" rather than the state itself.`);
  return state.envelope.revision;
}
async function armLostAcknowledgement(): Promise<void> {
  acceptedOutcome(await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: scope(), expectedRevision: await developmentRevision(), payload: { mode: "unknown", target: { kind: "mutation", name: "publishVariants" } } }, SESSION));
}
async function disarmFailure(): Promise<void> {
  await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: scope(), expectedRevision: await developmentRevision(), payload: { plan: null } }, SESSION);
}
beforeAll(async () => {
  // The failure plan is a development control, gated on the build rather than on admission.
  vi.stubEnv("NODE_ENV", "development");
  const sessions = await seed();
  const seeded = sessions.find((row) => row.sessionId === DEFAULT_SESSION_ID);
  if (seeded === undefined) throw new Error(`The deterministic seed lays down no session ${JSON.stringify(DEFAULT_SESSION_ID)}, so this suite has no world to start from.`);
  seededDocuments = seeded.documents;
});
beforeEach(async () => {
  if (seededDocuments === undefined) throw new Error("The seeded world was not laid down before this case ran.");
  // Every case starts from the seed itself, so an earlier case's effects cannot strand it.
  await resetSession(SESSION_ID, seededDocuments);
  const resolution = await resolveSession(SESSION);
  if (!resolution.ok) throw new Error(`The seeded session ${JSON.stringify(SESSION_ID)} could not be resolved: ${JSON.stringify(resolution.refusal)}`);
  if (resolution.session.selected === null) throw new Error("The seeded session selects no context, so no content change could be authorised in it.");
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
    const published = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])));
    const items = published.items ?? [];
    expect(items.map((item) => item.targetId)).toEqual([PUBLIC_EN_EDITION, PUBLIC_AR_EDITION]);
    const released = items.filter((item) => item.state === "released");
    const failed = items.filter((item) => item.state === "needs-attention");
    expect(released.map((item) => item.targetId)).toEqual([PUBLIC_EN_EDITION]);
    expect(failed.map((item) => item.targetId)).toEqual([PUBLIC_AR_EDITION]);
    const sibling = failed[0];
    expect(sibling?.reasonCode).toBe(AWAITING_REVIEW_CODE);
    expect(sibling?.reason ?? "").toMatch(/review/i);
    expect((sibling?.reason ?? "").length).toBeGreaterThan(20);
    expect(sibling?.revision).toBeUndefined();
    // The answer names the edition it changed, so no caller has to read a success off the absence of an error.
    expect(published.changed).toContain(PUBLIC_EN_EDITION);
    expect(published.changed).not.toContain(PUBLIC_AR_EDITION);
    expect(released[0]?.revision).toEqual(expect.any(String));
    expect(approved.candidateId).toBe(approved.draftRevisionId);
  });
  it("keeps the sibling's success rather than rolling the batch back", async () => {
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
    const published = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])));
    const head = await releaseView(PUBLIC_EN_EDITION);
    expect(head.data.status).toBe("released");
    if (head.data.status !== "released") throw new Error("The English edition must still publish a release after its sibling failed.");
    const release = head.data.release;
    expect(release.releaseId).not.toBe(SEEDED_EN_RELEASE);
    expect(release.revisionId).toBe(approved.candidateId);
    expect(release.contentChecksum).toBe(approved.contentChecksum);
    expect(release.publishedAt.toString()).toBe(SEED_INSTANT.toString());
    const superseded = await releaseView(PUBLIC_EN_EDITION, SEEDED_EN_RELEASE);
    expect(superseded.data.status).toBe("released");
    if (superseded.data.status !== "released") throw new Error("The release the seed published must still be readable from its history.");
    expect(superseded.data.release.supersededBy).toBe(release.releaseId);
    expect(superseded.data.release.withdrawnAt).toBeUndefined();
    expect(published.items?.find((item) => item.targetId === PUBLIC_EN_EDITION)?.revision).toBe(release.releaseId);
    const state = await storedState();
    expect(state.contentVariants.find((variant) => variant.variantId === PUBLIC_EN_EDITION)?.releaseHeadId).toBe(release.releaseId);
    expect(state.releases.filter((stored) => stored.variantId === PUBLIC_EN_EDITION).map((stored) => stored.releaseId)).toEqual([SEEDED_EN_RELEASE, release.releaseId]);
  });
  it("keeps the failing sibling's prior-good head and records no release at the failed revision", async () => {
    const seededCandidate = await candidateView(PUBLIC_AR_EDITION);
    if (seededCandidate.data.status !== "reviewable") throw new Error("The seeded Arabic edition must hold a frozen candidate for this case to start from it.");
    expect(seededCandidate.data.review.decision).toBeNull();
    await answerReviewAsApproved(PUBLIC_AR_EDITION, seededCandidate.data.candidate.candidateId);
    const firstPublication = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_AR_EDITION }])));
    expect(firstPublication.items?.[0]?.state).toBe("released");
    const before = await editionView(PUBLIC_AR_EDITION);
    if (before.releaseHeadId === null || before.headRelease === null) throw new Error("The Arabic edition's first release must stand at its head before the partial attempt.");
    const failing = await saveDraftAndSubmit(PUBLIC_AR_EDITION, ["الخريف في هاربر يوث", "نص أحدث لا يزال قيد المراجعة."], "rtl");
    const approvedEnglish = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
    const published = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])));
    const sibling = (published.items ?? []).find((item) => item.targetId === PUBLIC_AR_EDITION);
    expect(sibling?.state).toBe("needs-attention");
    expect(sibling?.reasonCode).toBe(AWAITING_REVIEW_CODE);
    expect(sibling?.revision).toBeUndefined();
    // The English sibling really did release, so this is a partial outcome rather than an empty one.
    expect((await editionView(PUBLIC_EN_EDITION)).headRelease?.revisionId).toBe(approvedEnglish.candidateId);
    const after = await editionView(PUBLIC_AR_EDITION);
    expect(after.releaseHeadId).toBe(before.releaseHeadId);
    expect(after.headRelease?.releaseId).toBe(before.headRelease.releaseId);
    expect(after.headRelease?.revisionId).toBe(before.headRelease.revisionId);
    expect(after.headRelease?.publishedAt.toString()).toBe(before.headRelease.publishedAt.toString());
    expect(after.candidateId).toBe(failing.candidateId);
    const held = await releaseView(PUBLIC_AR_EDITION);
    expect(held.data.status).toBe("released");
    if (held.data.status !== "released") throw new Error("A failed sibling is not a withdrawn publication: its prior-good head must still be readable.");
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
    expect(first.outcome).toBe("unknown");
    expect(first.operationId).toBe(input.operationId);
    // The effect is real and stored exactly once, which is what makes the uncertainty honest rather than vague.
    const headAfterFirst = await releaseView(PUBLIC_EN_EDITION);
    expect(headAfterFirst.data.status).toBe("released");
    if (headAfterFirst.data.status !== "released") throw new Error("The withheld acknowledgement must still have published the English edition exactly once.");
    expect(headAfterFirst.data.release.revisionId).toBe(approved.candidateId);
    expect((await storedState()).releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
    const stored = await storedOperationsFor(input.operationId);
    expect(stored).toHaveLength(1);
    const replay = await mutations.updates.publishVariants(SESSION_ID, input);
    expect(replay.outcome).toBe("alreadyAccepted");
    if (replay.outcome !== "alreadyAccepted") throw new Error("Replaying the same operation must return the stored result, and it answered " + describeOutcome(replay) + ".");
    expect(replay.operationId).toBe(input.operationId);
    expect(replay.result).toEqual(stored[0]?.result);
    expect(replay.items).toEqual(stored[0]?.items);
    expect(await storedOperationsFor(input.operationId)).toHaveLength(1);
    const afterReplay = await storedState();
    expect(afterReplay.releases.filter((release) => release.revisionId === approved.candidateId)).toHaveLength(1);
    expect(afterReplay.releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
    expect((await editionView(PUBLIC_AR_EDITION)).releaseHeadId).toBeNull();
    expect(await notificationCounts()).toEqual(notificationsBefore);
  });
  it("freezes the exact revision a reviewer approved, and a later draft edit changes neither the candidate nor the release", async () => {
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "The wording the reviewer answered."]);
    const frozen = await candidateView(PUBLIC_EN_EDITION);
    if (frozen.data.status !== "reviewable") throw new Error("The approved edition must hold a readable frozen candidate.");
    const approvedChecksum = frozen.data.candidate.contentChecksum;
    expect(frozen.data.review.decision).toBe("approved");
    const beforeEdit = await editionView(PUBLIC_EN_EDITION);
    const saved = acceptedOutcome(await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: await draftEnvelopeRevision(PUBLIC_EN_EDITION), payload: { variantId: PUBLIC_EN_EDITION, body: documentBody(LATER_PROSE) } }));
    const laterRevisionId = createdId(saved, "draft save");
    expect(laterRevisionId).not.toBe(approved.draftRevisionId);
    const afterEdit = await editionView(PUBLIC_EN_EDITION);
    expect(afterEdit.draftRevisionId).toBe(laterRevisionId);
    expect(afterEdit.recordRevision).not.toBe(beforeEdit.recordRevision);
    expect(afterEdit.candidateId).toBe(beforeEdit.candidateId);
    expect(afterEdit.releaseHeadId).toBe(SEEDED_EN_RELEASE);
    const stillFrozen = await candidateView(PUBLIC_EN_EDITION);
    if (stillFrozen.data.status !== "reviewable") throw new Error("A later draft edit must not disturb the frozen candidate.");
    expect(stillFrozen.data.candidate.revisionId).toBe(approved.candidateId);
    expect(stillFrozen.data.candidate.contentChecksum).toBe(approvedChecksum);
    expect(stillFrozen.data.review.decision).toBe("approved");
    acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }])));
    const head = await releaseView(PUBLIC_EN_EDITION);
    expect(head.data.status).toBe("released");
    if (head.data.status !== "released") throw new Error("The edition must publish the approved candidate it holds.");
    expect(head.data.release.revisionId).toBe(approved.candidateId);
    expect(head.data.release.revisionId).not.toBe(laterRevisionId);
    expect(head.data.release.contentChecksum).toBe(approvedChecksum);
  });
  it("completes the review in one step, refuses a second round and never turns Publish only into Notify", async () => {
    const notificationsBefore = await notificationCounts();
    const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
    const candidate = await candidateView(PUBLIC_EN_EDITION);
    if (candidate.data.status !== "reviewable") throw new Error("The submitted edition must hold a readable frozen candidate.");
    expect(candidate.data.review.steps).toBe(1);
    expect(candidate.data.review.round).toBe(1);
    expect(candidate.data.review.decision).toBe("approved");
    expect(candidate.data.review.approvalScope).toBe("this-variant-only");
    const sibling = await candidateView(PUBLIC_AR_EDITION);
    if (sibling.data.status !== "reviewable") throw new Error("The seeded Arabic edition must hold the submission this case contrasts with.");
    expect(sibling.data.review.decision).toBeNull();
    const secondAnswer = await mutations.updates.approveCandidate(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: (await candidateView(PUBLIC_EN_EDITION)).revision, payload: { candidateId: approved.candidateId } });
    // The revision presented is the candidate record's own immutable token, which a review never advances, so this answer is the no-op the contract names `unchanged` and never a conflict.
    expect(secondAnswer.outcome).toBe("unchanged");
    const resubmission = await mutations.updates.submitForReview(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: await draftEnvelopeRevision(PUBLIC_EN_EDITION), payload: { variantId: PUBLIC_EN_EDITION, revisionId: approved.draftRevisionId } });
    expect(resubmission.outcome).toBe("invalid");
    const publishInput = await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }]);
    acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, publishInput));
    const storedPublication = (await storedOperationsFor(publishInput.operationId))[0];
    expect(storedPublication?.result).toMatchObject({ editions: [{ variantId: PUBLIC_EN_EDITION, state: "released", notifyMode: PUBLISH_ONLY }] });
    expect(await notificationCounts()).toEqual(notificationsBefore);
    const escalated = await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_AND_NOTIFY }]));
    expect(escalated.outcome).toBe("invalid");
    expect(await notificationCounts()).toEqual(notificationsBefore);
    const state = await storedState();
    expect(state.releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
    expect(state.releases.filter((release) => release.revisionId === approved.candidateId)).toHaveLength(1);
  });
});

describe("the revision a draft read publishes", () => {
  it("accepts a save presenting it and conflicts on the superseded one, keeping the caller's input", async () => {
    const matrix = await variantMatrix();
    const published = matrix.data.editions.find((edition) => edition.variantId === PUBLIC_EN_EDITION);
    if (published === undefined) throw new Error(`The variant matrix of ${DOCUMENT_ID} holds no edition ${JSON.stringify(PUBLIC_EN_EDITION)}.`);
    const envelopeRevision = await draftEnvelopeRevision(PUBLIC_EN_EDITION);
    expect(envelopeRevision).toBe(published.recordRevision);
    const firstBody = documentBody(["Autumn at Harbour Youth", "A save presenting the revision the read published."]);
    const saved = acceptedOutcome(await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: envelopeRevision, payload: { variantId: PUBLIC_EN_EDITION, body: firstBody } }));
    expect(saved.revision).not.toBe(envelopeRevision);
    const advanced = await draftEnvelopeRevision(PUBLIC_EN_EDITION);
    expect(advanced).toBe(saved.revision);
    // The revision the first read published is superseded, so a save presenting it is a conflict that
    // states the current revision and hands back the payload it refused to apply.
    const supersededBody = documentBody(LATER_PROSE);
    const refused = await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: envelopeRevision, payload: { variantId: PUBLIC_EN_EDITION, body: supersededBody } });
    expect(refused.outcome).toBe("conflict");
    if (refused.outcome !== "conflict") throw new Error(`A save on a superseded revision must be a conflict, and the service answered ${describeOutcome(refused)}.`);
    expect(refused.reason).toBe("stale-revision");
    expect(refused.currentRevision).toBe(advanced);
    expect(refused.preservedInput).toEqual({ variantId: PUBLIC_EN_EDITION, body: supersededBody });
    const firstRevisionId = createdId(saved, "draft save");
    expect((await editionView(PUBLIC_EN_EDITION)).draftRevisionId).toBe(firstRevisionId);
    const second = acceptedOutcome(await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: advanced, payload: { variantId: PUBLIC_EN_EDITION, body: documentBody(["Autumn at Harbour Youth", "A second save, on the revision the read now publishes."]) } }));
    expect(second.revision).not.toBe(advanced);
    const secondRevisionId = createdId(second, "second save");
    expect((await editionView(PUBLIC_EN_EDITION)).draftRevisionId).toBe(secondRevisionId);
    expect(await draftEnvelopeRevision(PUBLIC_EN_EDITION)).toBe(second.revision);
  });
});
