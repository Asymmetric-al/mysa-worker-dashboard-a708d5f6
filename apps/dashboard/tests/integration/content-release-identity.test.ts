/** Proves that a release pins the revision it published (criterion 9's freeze), that a submitted candidate stays frozen when a later save names its revision, that a first Update release reaches a reader (criterion 12's reach rule on the receiving list), and that the revision a Page read states is one a change from that read presents. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type MutationOutcome, type Scope } from "@/modules/data-service";
import { resolveSession } from "@/modules/data-service/authorize";
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments } from "@/modules/dev-runtime/seed";
import { resetSession } from "@/modules/store/repository";
import { expectEnvelope, firstSaying, requiredSaying, throwing } from "../helpers/answers";
/** This file's own session: a private id, so no other suite's seeded world is shared, disturbed or stranded. */ const SESSION_ID = "it-content-release-identity";
const SESSION = { sessionId: SESSION_ID };
/** The published world a reader persona crosses into, and the persona that crosses: a reader admitted to no membership reads the Updates the publisher's own session released. */ const PUBLISHER_SESSION = { sessionId: DEFAULT_SESSION_ID };
const PUBLIC_READER = { sessionId: "reader-public" };
const KITCHEN_PAGE = "doc-page-harbour-kitchen";
const KITCHEN_EDITION = "variant-page-harbour-kitchen-en-public";
const SEEDED_KITCHEN_DRAFT = "rev-page-harbour-kitchen-en-draft-1";
const SEEDED_KITCHEN_HEADING = "The new cooker arrived";
const LATER_HEADING = "UNREVIEWED-DRAFT-PROBE";
const LATER_BODY = "Text written after the release, and never submitted for review.";
const SECOND_BODY = "Text written by the save that superseded the revision the earlier save presented.";
const AUTUMN_UPDATE = "doc-update-autumn";
const ARABIC_EDITION = "variant-update-autumn-ar-public";
const SEEDED_ARABIC_CANDIDATE = "rev-update-ar-candidate-1";
const LINK_PUBLIC = "link-public" as const;
const describeOutcome = (outcome: MutationOutcome): string => JSON.stringify(outcome);
const acceptedOutcome = (outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "accepted" }> => (outcome.outcome === "accepted" ? outcome : throwing(`This change must be accepted, and the service answered ${describeOutcome(outcome)}.`));
async function scopeOf(source: { readonly sessionId: string }): Promise<Scope> {
  const resolution = await resolveSession(source);
  if (!resolution.ok) throw new Error(`The seeded session ${JSON.stringify(source.sessionId)} could not be resolved: ${JSON.stringify(resolution.refusal)}`);
  return requiredSaying(resolution.session.selected, `The session ${JSON.stringify(source.sessionId)} selects no context, so no content change could be authorised in it.`);
}
const pageView = async (pageId: string, source: { readonly sessionId: string } = SESSION) => expectEnvelope(await reads.pages.readPage({ pageId, session: source }), `the Page ${pageId}`);
async function pageEdition(variantId: string, source: { readonly sessionId: string } = SESSION) {
  return firstSaying((await pageView(KITCHEN_PAGE, source)).data.editions, "variantId", variantId, `The Page ${KITCHEN_PAGE} holds no edition ${JSON.stringify(variantId)}.`);
}
async function updateEdition(variantId: string, source: { readonly sessionId: string }) {
  const matrix = expectEnvelope(await reads.updates.readVariantOverview({ documentId: AUTUMN_UPDATE, session: source }), `the variant matrix of ${AUTUMN_UPDATE}`);
  return { matrix, edition: firstSaying(matrix.data.editions, "variantId", variantId, `The Update ${AUTUMN_UPDATE} holds no edition ${JSON.stringify(variantId)}.`) };
}
let seededDocuments: SeededSessionDocuments | undefined;
let readerDocuments: SeededSessionDocuments | undefined;
const publishedWorld = (): SeededSessionDocuments => requiredSaying(seededDocuments, `The deterministic seed laid no documents down for this suite, so no world can be reset.`);
const readerWorld = (): SeededSessionDocuments => requiredSaying(readerDocuments, `The deterministic seed laid no reader documents down for this suite, so no public reader could read what it publishes.`);
beforeAll(async () => {
  const sessions = await seed();
  seededDocuments = firstSaying(sessions, "sessionId", DEFAULT_SESSION_ID, `The deterministic seed lays down no session ${JSON.stringify(DEFAULT_SESSION_ID)}, so this suite has no world to start from.`).documents;
  readerDocuments = firstSaying(sessions, "sessionId", PUBLIC_READER.sessionId, `The deterministic seed lays down no reader session ${JSON.stringify(PUBLIC_READER.sessionId)}, so no public reader could read what this suite publishes.`).documents;
});
beforeEach(async () => {
  await resetSession(SESSION_ID, publishedWorld()); // Every case starts from the seed itself, so an earlier case's effects cannot strand it.
});
afterAll(async () => {
  await resetSession(SESSION_ID);
  await resetSession(PUBLISHER_SESSION.sessionId, publishedWorld()); // The published world and the reader who crosses into it are left exactly as the seed lays them down.
  await resetSession(PUBLIC_READER.sessionId, readerWorld());
});
describe("a release pins the revision it published", () => {
  it("holds that revision still when its draft is edited afterwards, and serves the released text at the live address", async () => {
    const scope = await scopeOf(SESSION);
    // An approved Page edition, made readable at its own address by the owner's reach control, exactly as the builder releases one.
    const seeded = await pageEdition(KITCHEN_EDITION);
    expect(seeded.draftRevisionId, "The case releases the seeded draft, so the revision the release pins is the one the edit below names").toBe(SEEDED_KITCHEN_DRAFT);
    acceptedOutcome(await mutations.pages.submitForReview(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: seeded.recordRevision, payload: { variantId: KITCHEN_EDITION, revisionId: SEEDED_KITCHEN_DRAFT } }));
    const candidate = expectEnvelope(await reads.updates.readCandidate({ variantId: KITCHEN_EDITION, session: SESSION }), `the candidate of ${KITCHEN_EDITION}`);
    acceptedOutcome(await mutations.pages.approveCandidate(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: candidate.revision, payload: { candidateId: SEEDED_KITCHEN_DRAFT } }));
    const approved = await pageView(KITCHEN_PAGE);
    acceptedOutcome(await mutations.pages.publishVariants(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: approved.revision, payload: { documentId: KITCHEN_PAGE, variants: [{ variantId: KITCHEN_EDITION }] } }));
    const releasedPage = await pageView(KITCHEN_PAGE);
    acceptedOutcome(await mutations.pages.setReach(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: releasedPage.revision, payload: { documentId: KITCHEN_PAGE, reach: LINK_PUBLIC } }));
    const released = await pageEdition(KITCHEN_EDITION);
    const head = requiredSaying(released.headRelease, `The Page edition ${KITCHEN_EDITION} published no head, so this case has no release to hold still.`);
    expect([head.revisionId, head.reach]).toEqual([SEEDED_KITCHEN_DRAFT, LINK_PUBLIC]);
    const served = expectEnvelope(await reads.audience.readReceivingPage({ pageId: KITCHEN_PAGE }, SESSION), `the live address of ${KITCHEN_PAGE}`);
    expect([served.data.state, served.data.html?.includes(SEEDED_KITCHEN_HEADING)]).toEqual(["served", true]);
    // The edit a builder save makes on the edition's own draft, which is the revision the release pinned.
    acceptedOutcome(await mutations.pages.saveSectionFields(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: released.recordRevision, payload: { variantId: KITCHEN_EDITION, draftRevisionId: SEEDED_KITCHEN_DRAFT, sectionId: "section-0", fields: { heading: LATER_HEADING, body: LATER_BODY } } }));
    // The draft continued into a revision of its own, so the edition is still composing after a release…
    const after = await pageEdition(KITCHEN_EDITION);
    expect(after.draftRevisionId, "The edited draft continues under a new revision instead of rewriting the one the release pins").not.toBe(SEEDED_KITCHEN_DRAFT);
    const composed = await pageView(KITCHEN_PAGE);
    expect(composed.data.sections[0]?.fields.heading).toBe(LATER_HEADING);
    // …and the release, its digest and what a reader is given did not move: no submission, review or release stands behind that text.
    expect([after.headRelease?.releaseId, after.headRelease?.revisionId, after.headRelease?.contentChecksum]).toEqual([head.releaseId, head.revisionId, head.contentChecksum]);
    const held = expectEnvelope(await reads.updates.readRelease({ variantId: KITCHEN_EDITION, session: SESSION }), `the release of ${KITCHEN_EDITION}`);
    if (held.data.status !== "released") throw new Error(`The edition ${KITCHEN_EDITION} must still hold the release this case recorded, and the read answered ${JSON.stringify(held.data.status)}.`);
    expect([held.data.release.revisionId, held.data.release.contentChecksum]).toEqual([SEEDED_KITCHEN_DRAFT, head.contentChecksum]);
    expect([held.data.renderedHtml.includes(SEEDED_KITCHEN_HEADING), held.data.renderedHtml.includes(LATER_HEADING)]).toEqual([true, false]);
    const servedAfter = expectEnvelope(await reads.audience.readReceivingPage({ pageId: KITCHEN_PAGE }, SESSION), `the live address of ${KITCHEN_PAGE} after the edit`);
    expect([servedAfter.data.html, servedAfter.data.html?.includes(LATER_HEADING), servedAfter.data.html?.includes(LATER_BODY)]).toEqual([served.data.html, false, false]);
  });
  it("gives a first Update release a reach a public reader can open, and lists the edition for that reader", async () => {
    await resetSession(PUBLISHER_SESSION.sessionId, publishedWorld()); // The published world and the reader crossing into it are this case's own setup, and are put back below.
    await resetSession(PUBLIC_READER.sessionId, readerWorld());
    try {
      const scope = await scopeOf(PUBLISHER_SESSION);
      const first = await updateEdition(ARABIC_EDITION, PUBLISHER_SESSION);
      expect(first.edition.releaseHeadId, "The Arabic edition is this case's first release: it publishes nothing yet, so it has no head to inherit reach from").toBeNull();
      const candidate = expectEnvelope(await reads.updates.readCandidate({ variantId: ARABIC_EDITION, session: PUBLISHER_SESSION }), `the candidate of ${ARABIC_EDITION}`);
      acceptedOutcome(await mutations.updates.approveCandidate(PUBLISHER_SESSION.sessionId, { operationId: newOperationId(), scope, expectedRevision: candidate.revision, payload: { candidateId: SEEDED_ARABIC_CANDIDATE } }));
      const approved = await updateEdition(ARABIC_EDITION, PUBLISHER_SESSION);
      const released = acceptedOutcome(await mutations.updates.publishVariants(PUBLISHER_SESSION.sessionId, { operationId: newOperationId(), scope, expectedRevision: approved.matrix.revision, payload: { documentId: AUTUMN_UPDATE, variants: [{ variantId: ARABIC_EDITION }] } }));
      expect(released.items?.map((item) => [item.targetId, item.state])).toEqual([[ARABIC_EDITION, "released"]]);
      const published = requiredSaying((await updateEdition(ARABIC_EDITION, PUBLISHER_SESSION)).edition.headRelease, `The Arabic edition reported a release and holds no head, so no reach can be read for it.`);
      // Public by link and unlisted with noindex: one of the two reaches a reader can open at all, and the narrower of them.
      expect([published.revisionId, published.reach]).toEqual([SEEDED_ARABIC_CANDIDATE, LINK_PUBLIC]);
      const receiving = expectEnvelope(await reads.audience.readReceivingList({}, PUBLIC_READER), "the receiving list a public reader reads");
      const listed = receiving.data.editions.filter((row) => row.variantId === ARABIC_EDITION).map((row) => [row.releaseId, row.reach, row.audience]);
      expect(listed, "The edition the publisher reported Published is the one this reader is offered, so publication and reading are not two different facts").toEqual([[published.releaseId, LINK_PUBLIC, "public"]]);
    } finally {
      await resetSession(PUBLISHER_SESSION.sessionId, publishedWorld());
      await resetSession(PUBLIC_READER.sessionId, readerWorld());
    }
  });
});
describe("a submitted candidate stays frozen", () => {
  it("holds the submitted revision still when a save names it after submission, and releases the revision that was submitted", async () => {
    const scope = await scopeOf(SESSION);
    const seeded = await pageEdition(KITCHEN_EDITION);
    expect(seeded.draftRevisionId, "The case submits the seeded draft, so the revision the review freezes is the one the save below names").toBe(SEEDED_KITCHEN_DRAFT);
    acceptedOutcome(await mutations.pages.submitForReview(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: seeded.recordRevision, payload: { variantId: KITCHEN_EDITION, revisionId: SEEDED_KITCHEN_DRAFT } }));
    const submittedEnvelope = expectEnvelope(await reads.updates.readCandidate({ variantId: KITCHEN_EDITION, session: SESSION }), `the submitted candidate of ${KITCHEN_EDITION}`);
    const submitted = submittedEnvelope.data;
    if (submitted.status !== "reviewable") throw new Error(`The edition ${KITCHEN_EDITION} must hold the candidate this case submitted, and the read answered ${JSON.stringify(submitted.status)}.`);
    const frozen = submitted.candidate;
    expect([frozen.candidateId, frozen.revisionId, submitted.renderedHtml.includes(SEEDED_KITCHEN_HEADING)]).toEqual([SEEDED_KITCHEN_DRAFT, SEEDED_KITCHEN_DRAFT, true]);
    // The builder save an author makes after submitting, naming the very revision the reviewer holds.
    const saved = acceptedOutcome(
      await mutations.pages.saveSectionFields(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: submittedEnvelope.revision, payload: { variantId: KITCHEN_EDITION, draftRevisionId: SEEDED_KITCHEN_DRAFT, sectionId: "section-0", fields: { heading: LATER_HEADING, body: LATER_BODY } } }),
    );
    const forked = requiredSaying(saved.changed?.at(0), `The save on a submitted revision was accepted and named no revision it wrote, so the case cannot tell the draft it continued from the candidate it left alone.`);
    expect(forked, "The draft continues under a revision of its own, so the submitted revision is never rewritten").not.toBe(SEEDED_KITCHEN_DRAFT);
    const continued = await pageEdition(KITCHEN_EDITION);
    expect([continued.draftRevisionId, continued.headRelease], "The edition composes on the forked draft, and the submission has released nothing").toEqual([forked, null]);
    // A save that states what the draft already holds writes nothing, so nothing is forked for it either.
    const noop = await mutations.pages.saveSectionFields(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: continued.recordRevision, payload: { variantId: KITCHEN_EDITION, draftRevisionId: forked, sectionId: "section-0", fields: { heading: LATER_HEADING, body: LATER_BODY } } });
    expect([noop.outcome, (await pageEdition(KITCHEN_EDITION)).draftRevisionId], "A save that changes nothing answers `unchanged` and leaves the draft on the revision it holds").toEqual(["unchanged", forked]);
    // The candidate the reviewer holds: the same identity, the same frozen instant, the same digest and the same rendition, with the probe nowhere in it.
    const rereadEnvelope = expectEnvelope(await reads.updates.readCandidate({ variantId: KITCHEN_EDITION, session: SESSION }), `the submitted candidate of ${KITCHEN_EDITION} after the save`);
    const reread = rereadEnvelope.data;
    if (reread.status !== "reviewable") throw new Error(`The submitted candidate must still be reviewable after a later save, and the read answered ${JSON.stringify(reread.status)}.`);
    expect([reread.candidate.candidateId, reread.candidate.revisionId, reread.candidate.contentChecksum, reread.candidate.frozenAt.toString()]).toEqual([frozen.candidateId, frozen.revisionId, frozen.contentChecksum, frozen.frozenAt.toString()]);
    expect([reread.renderedHtml, reread.renderedHtml.includes(LATER_HEADING), reread.renderedHtml.includes(LATER_BODY)]).toEqual([submitted.renderedHtml, false, false]);
    // What the reviewer approves is what a reader is given, and the address serves the submitted text and never the probe.
    acceptedOutcome(await mutations.pages.approveCandidate(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: rereadEnvelope.revision, payload: { candidateId: frozen.candidateId } }));
    const approved = await pageView(KITCHEN_PAGE);
    const published = acceptedOutcome(await mutations.pages.publishVariants(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: approved.revision, payload: { documentId: KITCHEN_PAGE, variants: [{ variantId: KITCHEN_EDITION }] } }));
    expect(published.items?.map((item) => [item.targetId, item.state])).toEqual([[KITCHEN_EDITION, "released"]]);
    const released = await pageEdition(KITCHEN_EDITION);
    expect([released.headRelease?.revisionId, released.headRelease?.contentChecksum]).toEqual([SEEDED_KITCHEN_DRAFT, frozen.contentChecksum]);
    const held = expectEnvelope(await reads.updates.readRelease({ variantId: KITCHEN_EDITION, session: SESSION }), `the release of ${KITCHEN_EDITION}`);
    if (held.data.status !== "released") throw new Error(`The edition ${KITCHEN_EDITION} must hold the release this case recorded, and the read answered ${JSON.stringify(held.data.status)}.`);
    expect([held.data.release.revisionId, held.data.renderedHtml.includes(SEEDED_KITCHEN_HEADING), held.data.renderedHtml.includes(LATER_HEADING), held.data.renderedHtml.includes(LATER_BODY)]).toEqual([SEEDED_KITCHEN_DRAFT, true, false, false]);
    const reachable = await pageView(KITCHEN_PAGE);
    acceptedOutcome(await mutations.pages.setReach(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: reachable.revision, payload: { documentId: KITCHEN_PAGE, reach: LINK_PUBLIC } }));
    const served = expectEnvelope(await reads.audience.readReceivingPage({ pageId: KITCHEN_PAGE }, SESSION), `the live address of ${KITCHEN_PAGE}`);
    expect([served.data.state, served.data.html?.includes(SEEDED_KITCHEN_HEADING), served.data.html?.includes(LATER_HEADING), served.data.html?.includes(LATER_BODY)]).toEqual(["served", true, false, false]);
  });
  it("still edits a draft in place when neither a release nor a review record names its revision", async () => {
    const scope = await scopeOf(SESSION);
    const seeded = await pageEdition(KITCHEN_EDITION);
    expect([seeded.draftRevisionId, seeded.headRelease], "The edition this case edits carries a draft, and nothing outside that draft names it: no release and no submission").toEqual([SEEDED_KITCHEN_DRAFT, null]);
    const saved = acceptedOutcome(
      await mutations.pages.saveSectionFields(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: seeded.recordRevision, payload: { variantId: KITCHEN_EDITION, draftRevisionId: SEEDED_KITCHEN_DRAFT, sectionId: "section-0", fields: { heading: LATER_HEADING, body: LATER_BODY } } }),
    );
    expect([saved.changed, (await pageEdition(KITCHEN_EDITION)).draftRevisionId], "An unreleased, unsubmitted draft keeps the identity it already holds, so one save makes no second revision").toEqual([[SEEDED_KITCHEN_DRAFT], SEEDED_KITCHEN_DRAFT]);
    expect((await pageView(KITCHEN_PAGE)).data.sections[0]?.fields.heading).toBe(LATER_HEADING);
  });
});

describe("the Page read states the revision its own changes present", () => {
  it("accepts the envelope revision a Page read states, refuses it once a save has superseded it even where the edition's own revision has reached its ordinal, and accepts the revision the next read states", async () => {
    const scope = await scopeOf(SESSION);
    const seeded = await pageView(KITCHEN_PAGE);
    // Two document-level changes leave the Page's own revision two steps ahead of the edition being composed, so the read below states a token of the document whose ordinal the edition reaches only after two saves.
    const extended = acceptedOutcome(await mutations.pages.createVariant(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: seeded.revision, payload: { documentId: KITCHEN_PAGE, locale: "fr" } }));
    acceptedOutcome(await mutations.pages.createVariant(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: extended.revision, payload: { documentId: KITCHEN_PAGE, locale: "de" } }));
    const read = await pageView(KITCHEN_PAGE);
    const draft = requiredSaying(read.data.draft, `The Page ${KITCHEN_PAGE} states no draft, so this case has no draft to compose into.`);
    // The envelope states the document's revision and the draft states the edition's own, and the two are different tokens: a revision of the document is never a revision of the edition, however alike the two look.
    expect(draft.recordRevision, "The Page read states the document's revision, while the edition it composes carries one of its own").not.toBe(read.revision);
    const payload = { variantId: draft.variantId, draftRevisionId: draft.revisionId, sectionId: "section-0", fields: { heading: LATER_HEADING, body: LATER_BODY } };
    // The revision the read published is the revision a change originating from that read presents, and the section save accepts it although the section lands on the edition the Page composes.
    acceptedOutcome(await mutations.pages.saveSectionFields(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: read.revision, payload }));
    // The next read states the revision that save left behind, and the save presenting it is accepted in its turn.
    const reread = await pageView(KITCHEN_PAGE);
    expect(reread.revision, "The revision the Page read publishes moves with the change it reflects").not.toBe(read.revision);
    acceptedOutcome(await mutations.pages.saveSectionFields(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: reread.revision, payload: { ...payload, fields: { heading: LATER_HEADING, body: SECOND_BODY } } }));
    // The revision the first save superseded is presented again, by now the same ordinal the edition's own revision has reached: it stays a revision of the document, so the attempt is refused as stale with the caller's own input handed back rather than applied as the edition's own revision.
    const composing = requiredSaying((await pageView(KITCHEN_PAGE)).data.draft, `The Page ${KITCHEN_PAGE} states no draft after the saves, so the refusal below cannot be compared with the edition's revision.`);
    const stale = await mutations.pages.saveSectionFields(SESSION_ID, { operationId: newOperationId(), scope, expectedRevision: read.revision, payload });
    if (stale.outcome !== "conflict") throw new Error(`A revision the first save has already superseded must be refused as a conflict, and the service answered ${describeOutcome(stale)}.`);
    expect([stale.reason, stale.preservedInput]).toEqual(["stale-revision", payload]);
    expect(stale.currentRevision, "The refusal names the edition's own revision, which the superseded token of the document never was").toBe(composing.recordRevision);
  });
});
