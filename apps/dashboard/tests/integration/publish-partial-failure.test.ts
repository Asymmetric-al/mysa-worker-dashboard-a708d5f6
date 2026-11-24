/** Proves a partial release, and the one review step that authorises a release at all (success criteria 9 and 17). */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type MutationOutcome, type Scope } from "@/modules/data-service";
import { resolveSession } from "@/modules/data-service/authorize";
import { DEFAULT_SCENARIO_ID, type ScenarioId } from "@/modules/dev-runtime/scenario";
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { readSession, resetSession } from "@/modules/store/repository";
import { SEED_INSTANT } from "@/modules/time/clock";
import { expectEnvelope, firstSaying, requiredSaying, throwing } from "../helpers/answers";
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
const SIMULATED_PARTIAL_RELEASE_CODE = "simulated-partial-release";
const PARTIAL_RELEASE_SCENARIO = "partial-release-failure" as const;
const PUBLISH_ONLY = "publish-only" as const;
const PUBLISH_AND_NOTIFY = "publish-and-notify" as const;
const describeOutcome = (outcome: MutationOutcome): string => JSON.stringify(outcome);
const documentBody = (prose: readonly string[], direction: "ltr" | "rtl" = "ltr") => ({ type: "doc", profileVersion: 1, direction, sections: [], content: prose.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
let seededDocuments: SeededSessionDocuments | undefined;
let resolvedScope: Scope | undefined;
const scope = (): Scope => requiredSaying(resolvedScope, "This case ran before the seeded session's own scope was resolved, so no change can be authorised.");
const storedState = async (): Promise<SessionStateDocument> => requiredSaying(await readSession(SESSION_ID), `The store holds no session ${JSON.stringify(SESSION_ID)}, which every case lays down before it runs.`).state as SessionStateDocument;
type StoredOperation = { readonly operationId: string; readonly result: unknown; readonly items: unknown };
async function storedOperations(): Promise<readonly StoredOperation[]> {
  const documents = requiredSaying(await readSession(SESSION_ID), `The store holds no session ${JSON.stringify(SESSION_ID)}, so no ledger can be read for it.`);
  const ledger = documents.operations;
  if (!isRecord(ledger)) throw new Error("The session's operations document is not the operation ledger this suite reads, so no attempt can be counted.");
  const operations: StoredOperation[] = [];
  const collect = (value: unknown): void => {
    if (isRecord(value) && typeof value.operationId === "string") operations.push({ operationId: value.operationId, result: value.result, items: value.items });
  };
  const records = ledger["records"];
  if (isRecord(records)) Object.values(records).forEach(collect);
  const entries = ledger["entries"];
  if (Array.isArray(entries)) entries.forEach(collect);
  return operations;
}
const storedOperationsFor = async (operationId: string): Promise<readonly StoredOperation[]> => (await storedOperations()).filter((operation) => operation.operationId === operationId);
type NotificationCounts = { readonly intentIds: readonly string[]; readonly sendResultIds: readonly string[]; readonly recipientCopies: number };
async function notificationCounts(): Promise<NotificationCounts> {
  const state = await storedState();
  return { intentIds: state.notificationIntents.map((intent) => intent.intentId), sendResultIds: state.notificationResults.map((result) => result.sendResultId), recipientCopies: state.notificationResults.reduce((total, result) => total + result.recipients.length, 0) };
}
const variantMatrix = async () => expectEnvelope(await reads.updates.readVariantOverview({ documentId: DOCUMENT_ID, session: SESSION }), `the variant matrix of ${DOCUMENT_ID}`);
async function editionView(variantId: string) {
  const matrix = await variantMatrix();
  const edition = firstSaying(matrix.data.editions, "variantId", variantId, `The variant matrix of ${DOCUMENT_ID} holds no edition ${JSON.stringify(variantId)}.`);
  return edition;
}
const candidateView = async (variantId: string) => expectEnvelope(await reads.updates.readCandidate({ variantId, session: SESSION }), `the candidate of ${variantId}`);
const releaseView = async (variantId: string, releaseId?: string) => expectEnvelope(await reads.updates.readRelease({ variantId, ...(releaseId === undefined ? {} : { releaseId }), session: SESSION }), `the release of ${variantId}`);
async function draftEnvelopeRevision(variantId: string): Promise<string> {
  const result = expectEnvelope(await reads.updates.readDraft({ variantId, session: SESSION }), `the draft of ${variantId}`);
  return result.revision;
}
const acceptedOutcome = (outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "accepted" }> => (outcome.outcome === "accepted" ? outcome : throwing(`This change must be accepted, and the service answered ${describeOutcome(outcome)}.`));
function createdId(outcome: Extract<MutationOutcome, { outcome: "accepted" }>, what: string): string {
  const created = requiredSaying(outcome.created?.[0], `An accepted ${what} must report the record it created, and this answer reported none: ${describeOutcome(outcome)}`);
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
type ApprovedEdition = { readonly draftRevisionId: string; readonly candidateId: string; readonly contentChecksum: string };
/** The three writes criterion 9 names — save, submit, approve — made through the named mutations and nothing else. */
async function draftSubmitAndApprove(variantId: string, prose: readonly string[], direction: "ltr" | "rtl" = "ltr"): Promise<ApprovedEdition> {
  const written = await saveDraftAndSubmit(variantId, prose, direction);
  await answerReviewAsApproved(variantId, written.candidateId);
  const candidate = await candidateView(variantId);
  if (candidate.data.status !== "reviewable") throw new Error(`The approved edition ${JSON.stringify(variantId)} holds no readable candidate, so the review step did not complete.`);
  return { draftRevisionId: written.draftRevisionId, candidateId: written.candidateId, contentChecksum: candidate.data.candidate.contentChecksum };
}
type EditionSelection = { readonly variantId: string; readonly mode?: typeof PUBLISH_ONLY | typeof PUBLISH_AND_NOTIFY };
type PublicationInput = Parameters<typeof mutations.updates.publishVariants>[1];
/** One publication request, built once, so a replay can present the identical operation identity and payload. */
async function publicationInput(selections: readonly EditionSelection[], operationId: string = newOperationId()): Promise<PublicationInput> {
  const matrix = await variantMatrix();
  return { operationId, scope: scope(), expectedRevision: matrix.revision, payload: { documentId: DOCUMENT_ID, variants: selections.map((selection) => ({ variantId: selection.variantId, ...(selection.mode === undefined ? {} : { mode: selection.mode }) })) } };
}
async function developmentRevision(): Promise<string> {
  const state = expectEnvelope(await reads.dev.readDevState(SESSION), "this session's development state");
  return state.revision;
}
async function armLostAcknowledgement(): Promise<void> {
  acceptedOutcome(await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: scope(), expectedRevision: await developmentRevision(), payload: { mode: "unknown", target: { kind: "mutation", name: "publishVariants" } } }, SESSION));
}
async function disarmFailure(): Promise<void> {
  await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: scope(), expectedRevision: await developmentRevision(), payload: { plan: null } }, SESSION);
}
async function selectScenario(scenarioId: ScenarioId): Promise<void> {
  acceptedOutcome(await mutations.dev.setScenario({ operationId: newOperationId(), scope: scope(), expectedRevision: await developmentRevision(), payload: { scenarioId } }, SESSION));
}
/** Puts this session back on the baseline scenario, so a case that selected another one leaves nothing behind for the case after it. */
async function restoreScenario(): Promise<void> {
  const state = expectEnvelope(await reads.dev.readDevState(SESSION), "this session's development state");
  if (state.data.scenario.id === DEFAULT_SCENARIO_ID) return;
  await selectScenario(DEFAULT_SCENARIO_ID);
}
beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "development"); // The failure plan is a development control, gated on the build rather than on admission.
  const seeded = firstSaying(await seed(), "sessionId", DEFAULT_SESSION_ID, `The deterministic seed lays down no session ${JSON.stringify(DEFAULT_SESSION_ID)}, so this suite has no world to start from.`);
  seededDocuments = seeded.documents;
});
beforeEach(async () => {
  if (seededDocuments === undefined) throw new Error("The seeded world was not laid down before this case ran.");
  await resetSession(SESSION_ID, seededDocuments); // Every case starts from the seed itself, so an earlier case's effects cannot strand it.
  const resolution = await resolveSession(SESSION);
  if (!resolution.ok) throw new Error(`The seeded session ${JSON.stringify(SESSION_ID)} could not be resolved: ${JSON.stringify(resolution.refusal)}`);
  if (resolution.session.selected === null) throw new Error("The seeded session selects no context, so no content change could be authorised in it.");
  resolvedScope = resolution.session.selected;
});
afterEach(async () => {
  if (resolvedScope === undefined) return;
  await disarmFailure(); // A case that armed a failure plan disarms it, so the next case starts from the seed's own plan.
  await restoreScenario(); // A case that selected another scenario puts the session back on the baseline one, on the same terms.
});
afterAll(async () => {
  await resetSession(SESSION_ID);
  vi.unstubAllEnvs(); // The environment goes back to what this runner set, so a later suite sees the same NODE_ENV it would have had.
});
it("publishing one submission whose editions do not share a fate: reports one result per selected edition instead of a batch verdict", async () => {
  const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "The term closes with a shared meal."]);
  // The Arabic edition's seeded submission is still awaiting its review, so its attempt must fail while the English edition's attempt succeeds — in one call, over one submission.
  const published = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])));
  const items = published.items ?? [];
  expect(items.map((item) => item.targetId)).toEqual([PUBLIC_EN_EDITION, PUBLIC_AR_EDITION]);
  const released = items.filter((item) => item.state === "released");
  const failed = items.filter((item) => item.state === "needs-attention");
  expect([released.map((item) => item.targetId), failed.map((item) => item.targetId)]).toEqual([[PUBLIC_EN_EDITION], [PUBLIC_AR_EDITION]]);
  const sibling = failed[0];
  expect(sibling?.reasonCode).toBe(AWAITING_REVIEW_CODE);
  expect(sibling?.reason ?? "").toMatch(/review/i);
  expect((sibling?.reason ?? "").length).toBeGreaterThan(20);
  expect(sibling?.revision).toBeUndefined();
  expect(published.changed).toContain(PUBLIC_EN_EDITION); // The answer names the edition it changed, so no caller has to read a success off the absence of an error.
  expect(published.changed).not.toContain(PUBLIC_AR_EDITION);
  expect(released[0]?.revision).toEqual(expect.any(String));
  expect(approved.candidateId).toBe(approved.draftRevisionId);
});
it("publishing one submission whose editions do not share a fate: keeps the sibling's success rather than rolling the batch back", async () => {
  const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
  const published = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])));
  const head = await releaseView(PUBLIC_EN_EDITION);
  expect(head.data.status).toBe("released");
  if (head.data.status !== "released") throw new Error("The English edition must still publish a release after its sibling failed.");
  const release = head.data.release;
  expect(release.releaseId).not.toBe(SEEDED_EN_RELEASE);
  expect([release.revisionId, release.contentChecksum, release.publishedAt.toString()]).toEqual([approved.candidateId, approved.contentChecksum, SEED_INSTANT.toString()]);
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
it("publishing one submission whose editions do not share a fate: keeps the failing sibling's prior-good head and records no release at the failed revision", async () => {
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
  expect([sibling?.state, sibling?.reasonCode]).toEqual(["needs-attention", AWAITING_REVIEW_CODE]);
  expect(sibling?.revision).toBeUndefined();
  expect((await editionView(PUBLIC_EN_EDITION)).headRelease?.revisionId).toBe(approvedEnglish.candidateId); // The English sibling really did release, so this is a partial outcome rather than an empty one.
  const after = await editionView(PUBLIC_AR_EDITION);
  expect([after.releaseHeadId, after.headRelease?.releaseId, after.headRelease?.revisionId, after.headRelease?.publishedAt.toString()]).toEqual([before.releaseHeadId, before.headRelease.releaseId, before.headRelease.revisionId, before.headRelease.publishedAt.toString()]);
  expect(after.candidateId).toBe(failing.candidateId);
  const held = await releaseView(PUBLIC_AR_EDITION);
  expect(held.data.status).toBe("released");
  if (held.data.status !== "released") throw new Error("A failed sibling is not a withdrawn publication: its prior-good head must still be readable.");
  expect(held.data.release.releaseId).toBe(before.headRelease.releaseId);
  expect(held.data.release.withdrawnAt).toBeUndefined();
  expect(held.data.release.supersededBy).toBeUndefined();
  const arabicReleases = (await storedState()).releases.filter((release) => release.variantId === PUBLIC_AR_EDITION); // No release exists at the revision the failed attempt would have published, and no second head either.
  expect(arabicReleases.map((release) => release.releaseId)).toEqual([before.headRelease.releaseId]);
  expect(arabicReleases.filter((release) => release.revisionId === failing.candidateId)).toHaveLength(0);
});
it("publishing one submission whose editions do not share a fate: simulates the partial failure when the partial-release-failure scenario is selected", async () => {
  const seededCandidate = await candidateView(PUBLIC_AR_EDITION);
  if (seededCandidate.data.status !== "reviewable") throw new Error("The seeded Arabic edition must hold a frozen candidate for this case to release it before the simulated partial release.");
  await answerReviewAsApproved(PUBLIC_AR_EDITION, seededCandidate.data.candidate.candidateId);
  const firstRelease = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_AR_EDITION }])));
  expect(firstRelease.items?.[0]?.state).toBe("released");
  const priorGood = await editionView(PUBLIC_AR_EDITION); // The head the simulated failure has to keep, laid down by the same mutation every other case releases through.
  if (priorGood.releaseHeadId === null || priorGood.headRelease === null) throw new Error("The Arabic edition must hold the release head the simulated failure keeps before this case starts.");
  const failing = await draftSubmitAndApprove(PUBLIC_AR_EDITION, ["الخريف في هاربر يوث", "نص أحدث ينتظر إصداره."], "rtl");
  const approvedEnglish = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "The wording the reviewer approved."]);
  await selectScenario(PARTIAL_RELEASE_SCENARIO);
  const armed = expectEnvelope(await reads.dev.readDevState(SESSION), "this session's development state");
  expect([armed.data.scenario.id, armed.data.scenario.flags.releaseSynthesis]).toEqual([PARTIAL_RELEASE_SCENARIO, "one-sibling-fails"]);
  const published = acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }])));
  const items = published.items ?? [];
  expect(items.map((item) => item.targetId)).toEqual([PUBLIC_EN_EDITION, PUBLIC_AR_EDITION]);
  const released = items.filter((item) => item.state === "released");
  const failed = items.filter((item) => item.state === "failed-prior-good-head");
  expect([released.map((item) => item.targetId), failed.map((item) => item.targetId)]).toEqual([[PUBLIC_EN_EDITION], [PUBLIC_AR_EDITION]]);
  const sibling = failed[0];
  expect(sibling?.reasonCode).toBe(SIMULATED_PARTIAL_RELEASE_CODE);
  expect(sibling?.reason ?? "").toMatch(/simulates a partial release/);
  expect(sibling?.reason ?? "").toMatch(/no release was recorded for this edition/);
  expect(sibling?.reason ?? "").toMatch(/stands rather than being rolled back/);
  expect(sibling?.revision).toBe(priorGood.headRelease.releaseId); // The withheld edition answers with the head that stays published, never with a release it made.
  const englishHead = await editionView(PUBLIC_EN_EDITION);
  expect([englishHead.headRelease?.revisionId, englishHead.headRelease?.releaseId]).toEqual([approvedEnglish.candidateId, released[0]?.revision]);
  expect(englishHead.headRelease?.revisionId).not.toBe(SEEDED_EN_RELEASE);
  const after = await editionView(PUBLIC_AR_EDITION);
  expect([after.releaseHeadId, after.headRelease?.releaseId, after.headRelease?.revisionId]).toEqual([priorGood.releaseHeadId, priorGood.headRelease.releaseId, priorGood.headRelease.revisionId]);
  expect(after.candidateId).toBe(failing.candidateId);
  const arabicReleases = (await storedState()).releases.filter((release) => release.variantId === PUBLIC_AR_EDITION); // Nothing was released at the revision the simulation withheld, and the prior-good head is the only release the edition holds.
  expect(arabicReleases.map((release) => release.releaseId)).toEqual([priorGood.headRelease.releaseId]);
  expect(arabicReleases.filter((release) => release.revisionId === failing.candidateId)).toHaveLength(0);
  expect(published.changed).toEqual([PUBLIC_EN_EDITION]);
});
it("publishing one submission whose editions do not share a fate: recovers a lost acknowledgement under the original operation instead of publishing twice", async () => {
  const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
  const notificationsBefore = await notificationCounts();
  const input = await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }, { variantId: PUBLIC_AR_EDITION }]);
  await armLostAcknowledgement();
  const first = await mutations.updates.publishVariants(SESSION_ID, input);
  expect([first.outcome, first.operationId]).toEqual(["unknown", input.operationId]);
  const headAfterFirst = await releaseView(PUBLIC_EN_EDITION); // The effect is real and stored exactly once, which is what makes the uncertainty honest rather than vague.
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
  expect([replay.result, replay.items]).toEqual([stored[0]?.result, stored[0]?.items]);
  expect(await storedOperationsFor(input.operationId)).toHaveLength(1);
  const afterReplay = await storedState();
  expect(afterReplay.releases.filter((release) => release.revisionId === approved.candidateId)).toHaveLength(1);
  expect(afterReplay.releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
  expect((await editionView(PUBLIC_AR_EDITION)).releaseHeadId).toBeNull();
  expect(await notificationCounts()).toEqual(notificationsBefore);
});
it("publishing one submission whose editions do not share a fate: freezes the exact revision a reviewer approved, and a later draft edit changes neither the candidate nor the release", async () => {
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
  expect([afterEdit.candidateId, afterEdit.releaseHeadId]).toEqual([beforeEdit.candidateId, SEEDED_EN_RELEASE]);
  const stillFrozen = await candidateView(PUBLIC_EN_EDITION);
  if (stillFrozen.data.status !== "reviewable") throw new Error("A later draft edit must not disturb the frozen candidate.");
  expect([stillFrozen.data.candidate.revisionId, stillFrozen.data.candidate.contentChecksum, stillFrozen.data.review.decision]).toEqual([approved.candidateId, approvedChecksum, "approved"]);
  acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }])));
  const head = await releaseView(PUBLIC_EN_EDITION);
  expect(head.data.status).toBe("released");
  if (head.data.status !== "released") throw new Error("The edition must publish the approved candidate it holds.");
  expect(head.data.release.revisionId).toBe(approved.candidateId);
  expect(head.data.release.revisionId).not.toBe(laterRevisionId);
  expect(head.data.release.contentChecksum).toBe(approvedChecksum);
});
it("publishing one submission whose editions do not share a fate: completes the review in one step, refuses a second round and never turns Publish only into Notify", async () => {
  const notificationsBefore = await notificationCounts();
  const approved = await draftSubmitAndApprove(PUBLIC_EN_EDITION, ["Autumn at Harbour Youth", "A revised closing paragraph."]);
  const candidate = await candidateView(PUBLIC_EN_EDITION);
  if (candidate.data.status !== "reviewable") throw new Error("The submitted edition must hold a readable frozen candidate.");
  expect([candidate.data.review.steps, candidate.data.review.round, candidate.data.review.decision, candidate.data.review.approvalScope]).toEqual([1, 1, "approved", "this-variant-only"]);
  const sibling = await candidateView(PUBLIC_AR_EDITION);
  if (sibling.data.status !== "reviewable") throw new Error("The seeded Arabic edition must hold the submission this case contrasts with.");
  expect(sibling.data.review.decision).toBeNull();
  const secondAnswer = await mutations.updates.approveCandidate(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: (await candidateView(PUBLIC_EN_EDITION)).revision, payload: { candidateId: approved.candidateId } });
  expect(secondAnswer.outcome).toBe("unchanged"); // The revision presented is the candidate record's own immutable token, which a review never advances, so this answer is the no-op the contract names `unchanged` and never a conflict.
  const resubmission = await mutations.updates.submitForReview(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: await draftEnvelopeRevision(PUBLIC_EN_EDITION), payload: { variantId: PUBLIC_EN_EDITION, revisionId: approved.draftRevisionId } });
  expect(resubmission.outcome).toBe("invalid");
  const publishInput = await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_ONLY }]);
  acceptedOutcome(await mutations.updates.publishVariants(SESSION_ID, publishInput));
  expect((await storedOperationsFor(publishInput.operationId))[0]?.result).toMatchObject({ editions: [{ variantId: PUBLIC_EN_EDITION, state: "released", notifyMode: PUBLISH_ONLY }] });
  expect(await notificationCounts()).toEqual(notificationsBefore);
  const escalated = await mutations.updates.publishVariants(SESSION_ID, await publicationInput([{ variantId: PUBLIC_EN_EDITION, mode: PUBLISH_AND_NOTIFY }]));
  expect(escalated.outcome).toBe("invalid");
  expect(await notificationCounts()).toEqual(notificationsBefore);
  const state = await storedState();
  expect(state.releases.filter((release) => release.variantId === PUBLIC_EN_EDITION)).toHaveLength(2);
  expect(state.releases.filter((release) => release.revisionId === approved.candidateId)).toHaveLength(1);
});
it("the revision a draft read publishes: accepts a save presenting it and conflicts on the superseded one, keeping the caller's input", async () => {
  const matrix = await variantMatrix();
  const published = firstSaying(matrix.data.editions, "variantId", PUBLIC_EN_EDITION, `The variant matrix of ${DOCUMENT_ID} holds no edition ${JSON.stringify(PUBLIC_EN_EDITION)}.`);
  const envelopeRevision = await draftEnvelopeRevision(PUBLIC_EN_EDITION);
  expect(envelopeRevision).toBe(published.recordRevision);
  const firstBody = documentBody(["Autumn at Harbour Youth", "A save presenting the revision the read published."]);
  const saved = acceptedOutcome(await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: envelopeRevision, payload: { variantId: PUBLIC_EN_EDITION, body: firstBody } }));
  expect(saved.revision).not.toBe(envelopeRevision);
  const advanced = await draftEnvelopeRevision(PUBLIC_EN_EDITION);
  expect(advanced).toBe(saved.revision);
  const supersededBody = documentBody(LATER_PROSE); // The revision the first read published is superseded, so a save presenting it is a conflict that states the current revision and hands back the payload it refused to apply.
  const refused = await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: envelopeRevision, payload: { variantId: PUBLIC_EN_EDITION, body: supersededBody } });
  expect(refused.outcome).toBe("conflict");
  if (refused.outcome !== "conflict") throw new Error(`A save on a superseded revision must be a conflict, and the service answered ${describeOutcome(refused)}.`);
  expect([[refused.reason, refused.currentRevision], refused.preservedInput]).toEqual([["stale-revision", advanced], { variantId: PUBLIC_EN_EDITION, body: supersededBody }]);
  expect((await editionView(PUBLIC_EN_EDITION)).draftRevisionId).toBe(createdId(saved, "draft save"));
  const second = acceptedOutcome(await mutations.updates.saveDraft(SESSION_ID, { operationId: newOperationId(), scope: scope(), expectedRevision: advanced, payload: { variantId: PUBLIC_EN_EDITION, body: documentBody(["Autumn at Harbour Youth", "A second save, on the revision the read now publishes."]) } }));
  expect(second.revision).not.toBe(advanced);
  expect([(await editionView(PUBLIC_EN_EDITION)).draftRevisionId, await draftEnvelopeRevision(PUBLIC_EN_EDITION)]).toEqual([createdId(second, "second save"), second.revision]);
});
