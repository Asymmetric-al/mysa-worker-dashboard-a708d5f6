/** The variant and release identity model (success criterion 17), proven at the service boundary: a draft, a candidate and a release are three separate identities; a candidate freezes the exact … */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type MutationInput, type Scope } from "@/modules/data-service";
import { resolveSession } from "@/modules/data-service/authorize";
import { isOutcome, type InvalidOutcome, type JsonValue, type MutationOutcome, type PerItemResult, type ReadResult } from "@/modules/data-service/outcome";
import { REVIEW_STEPS_PER_CANDIDATE, VARIANT_AUDIENCES, type ContentRevision } from "@/modules/content/variant";
import { DEMONSTRABLE_TARGETS } from "@/modules/dev-runtime/failures";
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { resetSession } from "@/modules/store/repository";
const DOCUMENT_ID = "doc-update-autumn";
const EN_EDITION = "variant-update-autumn-en-public";
const FR_EDITION = "variant-update-autumn-fr-public";
const AR_EDITION = "variant-update-autumn-ar-public";
const AR_DRAFT_REVISION = "rev-update-ar-draft-1";
const AR_CANDIDATE = "rev-update-ar-candidate-1";
const AR_PRIOR_RELEASE = "release-update-ar-1";
const EN_SECOND_RELEASE = "release-update-en-2";
const FR_RELEASE = "release-update-fr-1";
const UNCOMPARED_REVISION = "rev-1";
const CONTROL_SESSION_ID = "domain-variant-release";
const PARTIAL_SESSION_ID = "domain-variant-release-partial";
const REVIEWER_SESSION_ID = "domain-variant-release-reviewer";
const BLIND_SESSION_ID = "domain-variant-release-blind";
const PARTIAL_SEEDED_SESSION = "established-worker-partial-release";
const REVIEWER_SEEDED_SESSION = "content-reviewer";
interface World {
  readonly sessionId: string;
  readonly source: { readonly sessionId: string };
  readonly scope: Scope;
}
function scopeOf(state: SessionStateDocument): Scope {
  const { context } = state;
  if (context.selectedOrganizationId === null || context.selectedMinistryId === null || context.selectedSupportSubjectId === null) throw new Error("The seeded session selects no context, so no edition of it can be read or changed under an authority it never chose.");
  return { organizationId: context.selectedOrganizationId, ministryId: context.selectedMinistryId, supportSubjectId: context.selectedSupportSubjectId, principalId: context.principalId };
}
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The seeded world carries no ${what}, so this case cannot start from it.`);
  return value;
}
async function layDown(sessionId: string, documents: SeededSessionDocuments): Promise<World> {
  await resetSession(sessionId, documents);
  return { sessionId, source: { sessionId }, scope: scopeOf(documents.state) };
}
let control: World;
let partial: World;
let reviewer: World;
let blind: World;
/** The seeded document sets the worlds are laid down from, captured once so every case starts from the same bytes. */
let baselineDocuments: SeededSessionDocuments;
let partialDocuments: SeededSessionDocuments;
let reviewerDocuments: SeededSessionDocuments;
const laidDownSessions = [CONTROL_SESSION_ID, PARTIAL_SESSION_ID, REVIEWER_SESSION_ID, BLIND_SESSION_ID];
async function layDownWorlds(): Promise<void> {
  control = await layDown(CONTROL_SESSION_ID, baselineDocuments);
  partial = await layDown(PARTIAL_SESSION_ID, partialDocuments);
  reviewer = await layDown(REVIEWER_SESSION_ID, reviewerDocuments);
  blind = await layDown(BLIND_SESSION_ID, { ...baselineDocuments, meta: { ...baselineDocuments.meta, sessionState: "denied" } });
}
beforeAll(async () => {
  const sessions = await seed();
  baselineDocuments = required(
    sessions.find((row) => row.sessionId === DEFAULT_SESSION_ID),
    `session "${DEFAULT_SESSION_ID}"`,
  ).documents;
  partialDocuments = required(
    sessions.find((row) => row.sessionId === PARTIAL_SEEDED_SESSION),
    `session "${PARTIAL_SEEDED_SESSION}"`,
  ).documents;
  reviewerDocuments = required(
    sessions.find((row) => row.sessionId === REVIEWER_SEEDED_SESSION),
    `session "${REVIEWER_SEEDED_SESSION}"`,
  ).documents;
  await layDownWorlds();
});
beforeEach(layDownWorlds);
afterEach(async () => {
  // Exactly one failure may be armed at a time, and a world that ended a case with one armed would
  // answer the next case's read or change with it. Disarming is therefore unconditional, and it names
  // the development document's own revision, which is what a change to that document presents.
  for (const world of [control, partial, reviewer]) {
    const { revision } = await devStateOf(world);
    await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: world.scope, expectedRevision: revision, payload: { plan: null } }, world.source);
  }
});
afterAll(async () => {
  for (const sessionId of laidDownSessions) {
    await resetSession(sessionId);
  }
});
function sourceOf(world: World): { readonly sessionId: string } {
  return world.source;
}
function attempt<P>(payload: P, expectedRevision: string, acting: Scope): MutationInput<P> {
  return { operationId: newOperationId(), scope: acting, expectedRevision, payload };
}
function outcomeIs(outcome: MutationOutcome, expected: MutationOutcome["outcome"]): MutationOutcome {
  expect(isOutcome(outcome)).toBe(true);
  expect(outcome.outcome).toBe(expected);
  return outcome;
}
function acceptedOutcome(outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "accepted" }> {
  if (outcome.outcome !== "accepted") throw new Error(`This change was expected to be applied once and was answered with ${JSON.stringify(outcome)}.`);
  return outcome;
}
function alreadyAcceptedOutcome(outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "alreadyAccepted" }> {
  if (outcome.outcome !== "alreadyAccepted") throw new Error(`This attempt was expected to be recognised as a replay and was answered with ${JSON.stringify(outcome)}.`);
  return outcome;
}
function invalidOutcome(outcome: MutationOutcome): InvalidOutcome {
  if (outcome.outcome !== "invalid") throw new Error(`This change was expected to be refused by validation and was answered with ${JSON.stringify(outcome)}.`);
  return outcome;
}
/** The per-edition results of one release, which an aggregate answer would not carry at all. */
function itemsOf(outcome: Extract<MutationOutcome, { outcome: "accepted" }>): readonly PerItemResult[] {
  const items = outcome.items;
  if (items === undefined) throw new Error("This change reports no per-item results, so no edition's own outcome could be asserted.");
  return items;
}
function itemFor(items: readonly PerItemResult[], variantId: string): PerItemResult {
  return required(
    items.find((item) => item.targetId === variantId),
    `per-edition result for ${variantId}`,
  );
}
function isPlainRecord(value: JsonValue): value is { readonly [field: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** The release modes a stored release result states, one per edition: read from the replayed attempt rather than from the surface, because the mode a submission recorded is the fact this file checks … */
function notifyModesOf(result: JsonValue): readonly (string | null)[] {
  if (!isPlainRecord(result)) throw new Error("A release attempt's stored result is an object carrying its per-edition outcomes.");
  const editions = result["editions"];
  if (!Array.isArray(editions)) throw new Error("A release attempt's stored result carries one entry per selected edition.");
  return editions.map((entry) => {
    if (!isPlainRecord(entry)) throw new Error("Every stored per-edition outcome is an object.");
    const mode = entry["notifyMode"];
    return typeof mode === "string" ? mode : null;
  });
}
async function envelopeOf<T>(pending: Promise<ReadResult<T>>, what: string): Promise<T> {
  const result = await pending;
  if (result.kind !== "envelope") throw new Error(`${what} was refused rather than answered: ${JSON.stringify(result)}`);
  return result.envelope;
}
async function overviewOf(world: World) {
  return envelopeOf(reads.updates.readVariantOverview({ documentId: DOCUMENT_ID, session: sourceOf(world) }), `readVariantOverview(${DOCUMENT_ID})`);
}
type OverviewEnvelope = Awaited<ReturnType<typeof overviewOf>>;
type EditionView = OverviewEnvelope["data"]["editions"][number];
function editionOf(overview: OverviewEnvelope, variantId: string): EditionView {
  return required(
    overview.data.editions.find((edition) => edition.variantId === variantId),
    `an edition ${variantId} of ${DOCUMENT_ID}`,
  );
}
async function documentRevision(world: World): Promise<string> {
  return (await overviewOf(world)).revision;
}
async function editionRevision(world: World, variantId: string): Promise<string> {
  return editionOf(await overviewOf(world), variantId).recordRevision;
}
async function draftOf(world: World, variantId: string) {
  return (await envelopeOf(reads.updates.readDraft({ variantId, session: sourceOf(world) }), `readDraft(${variantId})`)).data;
}
type DraftView = Awaited<ReturnType<typeof draftOf>>;
function draftRevisionOf(view: DraftView): ContentRevision {
  if (view.status !== "draft") throw new Error(`This edition was expected to hold a saved draft, and its draft read reported "${view.status}".`);
  return view.revision;
}
async function candidateOf(world: World, variantId: string) {
  return (await envelopeOf(reads.updates.readCandidate({ variantId, session: sourceOf(world) }), `readCandidate(${variantId})`)).data;
}
type CandidateView = Awaited<ReturnType<typeof candidateOf>>;
type FrozenCandidateView = Extract<CandidateView, { status: "reviewable" }>;
function frozenCandidate(view: CandidateView): FrozenCandidateView {
  if (view.status !== "reviewable") throw new Error(`This edition was expected to hold a candidate under review, and its candidate read reported "${view.status}".`);
  return view;
}
async function releaseOf(world: World, variantId: string) {
  return (await envelopeOf(reads.updates.readRelease({ variantId, session: sourceOf(world) }), `readRelease(${variantId})`)).data;
}
type ReleaseView = Awaited<ReturnType<typeof releaseOf>>;
function releasedView(view: ReleaseView): Extract<ReleaseView, { status: "released" }> {
  if (view.status !== "released") throw new Error(`This edition was expected to serve a release at its head, and its release read reported "${view.status}".`);
  return view;
}
function withdrawnReleaseView(view: ReleaseView): Extract<ReleaseView, { status: "withdrawn" }> {
  if (view.status !== "withdrawn") throw new Error(`This edition was expected to hold a withdrawn release, and its release read reported "${view.status}".`);
  return view;
}
async function devStateOf(world: World) {
  return envelopeOf(reads.dev.readDevState(sourceOf(world)), "readDevState");
}
function body(direction: "ltr" | "rtl", paragraphs: readonly string[]): unknown {
  return { type: "doc", profileVersion: 1, direction, content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })), sections: [] };
}
function textOfDocument(content: ContentRevision["body"]): readonly string[] {
  const collected: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (Reflect.get(node, "type") === "text") {
      const text: unknown = Reflect.get(node, "text");
      if (typeof text === "string") {
        collected.push(text);
      }
      return;
    }
    const children: unknown = Reflect.get(node, "content");
    if (Array.isArray(children)) {
      for (const child of children) {
        walk(child);
      }
    }
  };
  walk(content);
  return collected;
}
/** Creates one more edition of the canonical document, so a case that needs a fresh identity never competes for a seeded one. */
async function createEdition(world: World, input: { readonly locale: string; readonly audience?: "public" | "approved-supporter"; readonly translationSource?: { readonly variantId: string; readonly revisionId: string } }): Promise<string> {
  const created = acceptedOutcome(
    await mutations.updates.createVariant(
      world.sessionId,
      attempt({ documentId: DOCUMENT_ID, locale: input.locale, ...(input.audience === undefined ? {} : { audience: input.audience }), ...(input.translationSource === undefined ? {} : { translationSource: input.translationSource }) }, await documentRevision(world), world.scope),
    ),
  );
  return required(created.created?.[0], `the identity of the ${input.locale} edition it created`);
}
async function saveDraftText(world: World, variantId: string, paragraphs: readonly string[], direction: "ltr" | "rtl" = "ltr"): Promise<string> {
  const saved = acceptedOutcome(await mutations.updates.saveDraft(world.sessionId, attempt({ variantId, body: body(direction, paragraphs) }, await editionRevision(world, variantId), world.scope)));
  return required(saved.created?.[0], `the identity of the revision it saved for ${variantId}`);
}
async function submitEdition(world: World, variantId: string, revisionId: string, notifyMode?: "publish-only" | "publish-and-notify"): Promise<string> {
  const submitted = acceptedOutcome(await mutations.updates.submitForReview(world.sessionId, attempt({ variantId, revisionId, ...(notifyMode === undefined ? {} : { notifyMode }) }, await editionRevision(world, variantId), world.scope)));
  return required(submitted.created?.[0], `the candidate ${variantId} submitted`);
}
interface ReleaseSelectionInput {
  readonly variantId: string;
  readonly revisionId?: string;
  readonly mode?: "publish-only" | "publish-and-notify";
}
async function publishEditions(world: World, selections: readonly ReleaseSelectionInput[]): Promise<MutationOutcome> {
  return mutations.updates.publishVariants(world.sessionId, attempt({ documentId: DOCUMENT_ID, variants: [...selections] }, UNCOMPARED_REVISION, world.scope));
}

describe("three identities, never collapsed", () => {
  it("keeps one edition's draft, candidate and release as three records it names separately", async () => {
    const overview = await overviewOf(partial);
    const arabic = editionOf(overview, AR_EDITION);
    expect(overview.data.document.documentId).toBe(DOCUMENT_ID);
    expect([...overview.data.audiences]).toEqual([...VARIANT_AUDIENCES]);
    expect(arabic.audience).toBe("public");
    expect(arabic.locale).toEqual({ tag: "ar", direction: "rtl" });
    expect(arabic.draftRevisionId).toBe(AR_DRAFT_REVISION);
    expect(arabic.candidateId).toBe(AR_CANDIDATE);
    expect(arabic.releaseHeadId).toBe(AR_PRIOR_RELEASE);
    const identities = [arabic.draftRevisionId, arabic.candidateId, arabic.releaseHeadId];
    expect(identities.every((identity) => typeof identity === "string" && identity.length > 0)).toBe(true);
    expect(new Set(identities).size).toBe(3);
    expect(draftRevisionOf(await draftOf(partial, AR_EDITION)).revisionId).toBe(arabic.draftRevisionId);
    expect(frozenCandidate(await candidateOf(partial, AR_EDITION)).candidate.revisionId).toBe(arabic.candidateId);
    expect(releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId).toBe(arabic.releaseHeadId);
  });
  it("gives three locale editions of one document their own draft identity", async () => {
    const spanish = await createEdition(control, { locale: "es" });
    const portuguese = await createEdition(control, { locale: "pt-BR" });
    const dutch = await createEdition(control, { locale: "nl" });
    const spanishRevision = await saveDraftText(control, spanish, ["Edición en español."]);
    const portugueseRevision = await saveDraftText(control, portuguese, ["Edição em português."]);
    const dutchRevision = await saveDraftText(control, dutch, ["Nederlandse editie."]);
    expect(new Set([spanish, portuguese, dutch]).size).toBe(3);
    expect(new Set([spanishRevision, portugueseRevision, dutchRevision]).size).toBe(3);
    const overview = await overviewOf(control);
    expect(editionOf(overview, spanish).draftRevisionId).toBe(spanishRevision);
    expect(editionOf(overview, portuguese).draftRevisionId).toBe(portugueseRevision);
    expect(editionOf(overview, dutch).draftRevisionId).toBe(dutchRevision);
    // The count is stated from the document's own edition list rather than from this case's bookkeeping.
    const drafts = [spanishRevision, portugueseRevision, dutchRevision];
    expect(overview.data.editions.filter((edition) => edition.draftRevisionId !== null && drafts.includes(edition.draftRevisionId)).length).toBe(3);
  });
  it("records the revising principal and the reviewing principal as two identities", async () => {
    const contributor = await resolveSession({ sessionId: control.sessionId });
    const reviewing = await resolveSession({ sessionId: reviewer.sessionId });
    if (!contributor.ok || !reviewing.ok) throw new Error("Both seeded identities were expected to resolve, and one was refused.");
    expect(contributor.session.principalId).not.toBe(reviewing.session.principalId);
    // A revision names the principal who wrote it, so the writer is never inferred from whichever
    // identity happens to approve the candidate afterwards.
    const edition = await createEdition(control, { locale: "cy" });
    await saveDraftText(control, edition, ["Drafft Cymraeg."]);
    const draft = draftRevisionOf(await draftOf(control, edition));
    expect(draft.authorPrincipalId).toBe(contributor.session.principalId);
    expect(draft.authorPrincipalId).not.toBe(reviewing.session.principalId);
  });
});
describe("a candidate freezes the exact revision", () => {
  it("keeps the candidate on the revision it froze after a later draft save", async () => {
    const edition = await createEdition(control, { locale: "sv" });
    const frozen = await saveDraftText(control, edition, ["Svenskt utkast, första versionen."]);
    const candidateId = await submitEdition(control, edition, frozen);
    expect(candidateId).toBe(frozen);
    const first = frozenCandidate(await candidateOf(control, edition));
    expect(first.candidate.revisionId).toBe(frozen);
    expect(REVIEW_STEPS_PER_CANDIDATE).toBe(1);
    expect(first.review.steps).toBe(REVIEW_STEPS_PER_CANDIDATE);
    expect(first.review.round).toBe(REVIEW_STEPS_PER_CANDIDATE);
    const later = await saveDraftText(control, edition, ["Svenskt utkast, andra versionen."]);
    expect(later).not.toBe(frozen);
    const afterSave = frozenCandidate(await candidateOf(control, edition));
    expect(afterSave.candidate.revisionId).toBe(frozen);
    const draft = draftRevisionOf(await draftOf(control, edition));
    expect(draft.revisionId).toBe(later);
    expect(draft.revisionId).not.toBe(afterSave.candidate.revisionId);
    const pointers = editionOf(await overviewOf(control), edition);
    expect(pointers.candidateId).toBe(frozen);
    expect(pointers.draftRevisionId).toBe(later);
  });
  it("approves the frozen revision, not the newest draft", async () => {
    const edition = await createEdition(control, { locale: "is" });
    const frozen = await saveDraftText(control, edition, ["Íslenskt drög, fyrsta útgáfa."]);
    await submitEdition(control, edition, frozen);
    const later = await saveDraftText(control, edition, ["Íslenskt drög, önnur útgáfa."]);
    acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: frozen }, await editionRevision(control, edition), control.scope)));
    const answered = frozenCandidate(await candidateOf(control, edition));
    expect(answered.review.decision).toBe("approved");
    expect(answered.candidate.revisionId).toBe(frozen);
    const draft = draftRevisionOf(await draftOf(control, edition));
    expect(draft.revisionId).toBe(later);
    expect(draft.revisionId).not.toBe(answered.candidate.revisionId);
  });
  it("restores an earlier revision as a new draft identity carrying its prose", async () => {
    const edition = await createEdition(control, { locale: "fo" });
    const first = await saveDraftText(control, edition, ["Fyrsta útgáva."]);
    const second = await saveDraftText(control, edition, ["Onnur útgáva."]);
    const restored = acceptedOutcome(await mutations.updates.restoreRevisionAsDraft(control.sessionId, attempt({ revisionId: first }, await editionRevision(control, edition), control.scope)));
    const restoredId = required(restored.created?.[0], "the identity of the restored draft");
    expect(restoredId).not.toBe(first);
    expect(restoredId).not.toBe(second);
    const draft = draftRevisionOf(await draftOf(control, edition));
    expect(draft.revisionId).toBe(restoredId);
    expect(textOfDocument(draft.body)).toEqual(["Fyrsta útgáva."]);
    expect(editionOf(await overviewOf(control), edition).draftRevisionId).toBe(restoredId);
  });
});
describe("a release consumes the frozen candidate it answers", () => {
  it("leaves an edition with no submission once the revision its candidate froze is published, and a candidate again when a newer revision is frozen beside that release", async () => {
    const edition = await createEdition(control, { locale: "ro" });
    const frozen = await saveDraftText(control, edition, ["Proiect românesc pentru tineret."]);
    const candidateId = await submitEdition(control, edition, frozen);
    expect(candidateId).toBe(frozen);
    acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId }, await editionRevision(control, edition), control.scope)));
    const released = acceptedOutcome(await publishEditions(control, [{ variantId: edition }]));
    expect(itemFor(itemsOf(released), edition).state).toBe("released");
    const published = editionOf(await overviewOf(control), edition);
    expect(published.headRelease?.revisionId).toBe(frozen);
    expect(releasedView(await releaseOf(control, edition)).release.revisionId).toBe(frozen);
    // The release published the very revision the candidate froze, so the edition holds no submission afterwards.
    // The lifecycle word every author surface derives from these pointers is therefore the publication — a live
    // release at the head and no candidate — instead of the candidate word a retained pointer produced.
    expect(published.candidateId).toBeNull();
    // Nothing is left to review, so the edition offers no review step and no longer counts as awaiting one.
    expect((await candidateOf(control, edition)).status).toBe("none");
    // A newer revision frozen beside that publication is a submission again, because the release answered the
    // revision before it and not this one: only a release of the candidate's own revision consumes it.
    const newer = await saveDraftText(control, edition, ["Proiect românesc, a doua versiune."]);
    expect(newer).not.toBe(frozen);
    expect(await submitEdition(control, edition, newer)).toBe(newer);
    const resubmitted = editionOf(await overviewOf(control), edition);
    expect(resubmitted.candidateId).toBe(newer);
    expect(resubmitted.headRelease?.revisionId).toBe(frozen);
    expect(releasedView(await releaseOf(control, edition)).release.revisionId).toBe(frozen);
    expect(frozenCandidate(await candidateOf(control, edition)).candidate.revisionId).toBe(newer);
  });
});
describe("one edition cannot advance or overwrite another", () => {
  it("edits English without moving the French release head or the Arabic draft", async () => {
    const before = await overviewOf(control);
    const frenchBefore = editionOf(before, FR_EDITION);
    expect(frenchBefore.headRelease?.releaseId).toBe(FR_RELEASE);
    expect(frenchBefore.translation.status).toBe("fresh");
    const arabicDraftBefore = editionOf(before, AR_EDITION).draftRevisionId;
    expect(arabicDraftBefore).toBe(AR_DRAFT_REVISION);
    await saveDraftText(control, EN_EDITION, ["Autumn at Harbour Youth, revised for the next release."]);
    const after = await overviewOf(control);
    expect(editionOf(after, FR_EDITION).headRelease?.releaseId).toBe(FR_RELEASE);
    expect(releasedView(await releaseOf(control, FR_EDITION)).release.releaseId).toBe(FR_RELEASE);
    // A shared-draft implementation would move this pointer as well.
    expect(editionOf(after, AR_EDITION).draftRevisionId).toBe(arabicDraftBefore);
    expect(editionOf(after, FR_EDITION).translation.status).toBe("stale");
  });
  it("records the source revision a manual translation copied, and reports staleness without withdrawing it", async () => {
    const source = await createEdition(control, { locale: "nb" });
    const sourceRevision = await saveDraftText(control, source, ["Norsk bokmål, første utkast."]);
    const translation = await createEdition(control, { locale: "nn", translationSource: { variantId: source, revisionId: sourceRevision } });
    await saveDraftText(control, translation, ["Nynorsk omsetjing."]);
    const published = acceptedOutcome(await publishEditions(control, [{ variantId: translation }]));
    const translationRelease = required(itemFor(itemsOf(published), translation).revision, `the release identity of ${translation}`);
    const fresh = editionOf(await overviewOf(control), translation);
    if (fresh.translation.status !== "fresh") throw new Error(`A translation of the current source revision was expected to read fresh, and it read "${fresh.translation.status}".`);
    expect(fresh.translation.sourceRevisionId).toBe(sourceRevision);
    const revisedSource = await saveDraftText(control, source, ["Norsk bokmål, andre utkast."]);
    expect(revisedSource).not.toBe(sourceRevision);
    const stale = editionOf(await overviewOf(control), translation);
    if (stale.translation.status !== "stale") throw new Error(`A translation of a superseded source revision was expected to read stale, and it read "${stale.translation.status}".`);
    expect(stale.translation.sourceRevisionId).toBe(revisedSource);
    expect(stale.translation.translatedFromRevisionId).toBe(sourceRevision);
    expect(stale.headRelease?.releaseId).toBe(translationRelease);
    expect(stale.headRelease?.withdrawnAt).toBeUndefined();
    expect(releasedView(await releaseOf(control, translation)).release.releaseId).toBe(translationRelease);
  });
});

describe("review is exactly one step, and it cannot be widened", () => {
  it("answers a candidate once, and requires a new submission for a second round", async () => {
    const edition = await createEdition(control, { locale: "da" });
    const first = await saveDraftText(control, edition, ["Dansk udkast."]);
    await submitEdition(control, edition, first);
    const submitted = frozenCandidate(await candidateOf(control, edition));
    expect(submitted.review.steps).toBe(1);
    expect(submitted.review.round).toBe(1);
    expect(submitted.review.decision).toBeNull();
    expect(submitted.review.approvalScope).toBe("this-variant-only");
    acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: first }, await editionRevision(control, edition), control.scope)));
    expect(frozenCandidate(await candidateOf(control, edition)).review.decision).toBe("approved");
    expect(outcomeIs(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: first }, await editionRevision(control, edition), control.scope)), "unchanged").outcome).toBe("unchanged");
    const reanswered = invalidOutcome(await mutations.updates.requestChanges(control.sessionId, attempt({ candidateId: first }, await editionRevision(control, edition), control.scope)));
    expect(Object.keys(reanswered.fields)).toContain("candidateId");
    const resubmitted = invalidOutcome(await mutations.updates.submitForReview(control.sessionId, attempt({ variantId: edition, revisionId: first }, await editionRevision(control, edition), control.scope)));
    expect(Object.keys(resubmitted.fields)).toContain("revisionId");
    const secondRound = await saveDraftText(control, edition, ["Dansk udkast, anden runde."]);
    expect(secondRound).not.toBe(first);
    const nextCandidate = await submitEdition(control, edition, secondRound);
    expect(nextCandidate).not.toBe(first);
    const rereviewable = frozenCandidate(await candidateOf(control, edition));
    expect(rereviewable.candidate.revisionId).toBe(secondRound);
    expect(rereviewable.review.decision).toBeNull();
  });
  it("refuses to turn Publish only into Notify on the reviewer's path", async () => {
    const edition = await createEdition(control, { locale: "el" });
    const revision = await saveDraftText(control, edition, ["Ελληνικό σχέδιο."]);
    await submitEdition(control, edition, revision);
    // The mode belongs to the submission, so the reviewer's own step refuses to widen it.
    const widened = invalidOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: revision, notifyMode: "publish-and-notify" }, await editionRevision(control, edition), control.scope)));
    expect(Object.keys(widened.fields)).toContain("notifyMode");
    acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: revision }, await editionRevision(control, edition), control.scope)));
    // A sibling that needs no review, so the batch does release something and reports per edition.
    const sibling = await createEdition(control, { locale: "he" });
    await saveDraftText(control, sibling, ["טיוטה בעברית."], "rtl");
    const batch = acceptedOutcome(await publishEditions(control, [{ variantId: edition, mode: "publish-and-notify" }, { variantId: sibling }]));
    const entries = itemsOf(batch);
    const refusedEntry = itemFor(entries, edition);
    expect(refusedEntry.state).toBe("needs-attention");
    expect(refusedEntry.reasonCode).toBe("notify-mode-not-approved");
    expect(itemFor(entries, sibling).state).toBe("released");
    const releaseInput = attempt({ documentId: DOCUMENT_ID, variants: [{ variantId: edition }] }, UNCOMPARED_REVISION, control.scope);
    const released = acceptedOutcome(await mutations.updates.publishVariants(control.sessionId, releaseInput));
    expect(itemFor(itemsOf(released), edition).state).toBe("released");
    const replay = alreadyAcceptedOutcome(await mutations.updates.publishVariants(control.sessionId, releaseInput));
    expect(notifyModesOf(replay.result)).toEqual(["publish-only"]);
  });
  it("reviews only the edition whose contributor policy requires a review", async () => {
    const edition = await createEdition(control, { locale: "fi" });
    const draft = await saveDraftText(control, edition, ["Suomalainen luonnos."]);
    expect((await candidateOf(control, edition)).status).toBe("none");
    const released = acceptedOutcome(await publishEditions(control, [{ variantId: edition }]));
    expect(itemFor(itemsOf(released), edition).state).toBe("released");
    expect(releasedView(await releaseOf(control, edition)).release.revisionId).toBe(draft);
  });
  it("approves one edition and leaves every other submission under review", async () => {
    const first = await createEdition(control, { locale: "cs" });
    const second = await createEdition(control, { locale: "sk" });
    const firstRevision = await saveDraftText(control, first, ["Český koncept."]);
    const secondRevision = await saveDraftText(control, second, ["Slovenský koncept."]);
    const firstCandidate = await submitEdition(control, first, firstRevision);
    const secondCandidate = await submitEdition(control, second, secondRevision);
    expect(firstCandidate).not.toBe(secondCandidate);
    acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: firstCandidate }, await editionRevision(control, first), control.scope)));
    expect(frozenCandidate(await candidateOf(control, first)).review.decision).toBe("approved");
    // The sibling is still awaiting its own answer, and so is the seeded Arabic submission.
    const siblingSubmission = frozenCandidate(await candidateOf(control, second));
    expect(siblingSubmission.candidate.revisionId).toBe(secondCandidate);
    expect(siblingSubmission.review.decision).toBeNull();
    const seededSubmission = frozenCandidate(await candidateOf(control, AR_EDITION));
    expect(seededSubmission.candidate.revisionId).toBe(AR_CANDIDATE);
    expect(seededSubmission.review.decision).toBeNull();
  });
});
describe("a decided candidate reads as the decision on record", () => {
  it("answers a requested change with its edition and the record of who gave it, when and with what note, and refuses an unreadable session or an unnamed identity", async () => {
    const edition = await createEdition(control, { locale: "lt" });
    const frozen = await saveDraftText(control, edition, ["Lietuviškas juodraštis."]);
    const candidateId = await submitEdition(control, edition, frozen);
    const note = "Please name the venue in the first paragraph.";
    const contributor = await resolveSession({ sessionId: control.sessionId });
    if (!contributor.ok) throw new Error("The seeded contributor identity was expected to resolve, and it was refused.");
    acceptedOutcome(await mutations.updates.requestChanges(control.sessionId, attempt({ candidateId, note }, await editionRevision(control, edition), control.scope)));
    // A requested change clears the edition's candidate pointer, so the review record is the only place
    // the answered candidate is still paired with its edition. The identity the review surface was
    // opened on therefore reads as that decision, never as a refusal, and it names the principal, the
    // instant and the note the author was asked to act on.
    const decided = frozenCandidate(await candidateOf(control, candidateId));
    expect(decided.variant.variantId).toBe(edition);
    expect(decided.candidate.candidateId).toBe(candidateId);
    expect(decided.candidate.revisionId).toBe(frozen);
    expect(decided.review.decision).toBe("changes-requested");
    const record = decided.review.recorded;
    if (record === null) throw new Error("An answered candidate was expected to carry the record of its answer, and it carried none.");
    expect(record.decision).toBe("changes-requested");
    expect(record.note).toBe(note);
    expect(record.decidedByPrincipalId).toBe(contributor.session.principalId);
    expect(record.decidedAt ?? "").toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    // The edition itself holds no candidate once it has been answered, so the edition's own identity
    // still states exactly that: the two identities answer two different questions.
    expect((await candidateOf(control, edition)).status).toBe("none");
    // Authorisation precedes enumeration: the same candidate identity, read by a session that states it
    // may not act in this ministry, is refused rather than resolved, and the refusal names nothing.
    const blindRead = await reads.updates.readCandidate({ variantId: candidateId, session: sourceOf(blind) });
    if (blindRead.kind !== "denied") throw new Error(`A session that may not read the edition was expected to be refused, and the read answered "${blindRead.kind}".`);
    expect(blindRead.denied.reasonCode).toBe("not-admitted");
    // An identity no record names is refused by the same closed reason the review surface already
    // states, so a decision on record and a candidate that never existed stay indistinguishable.
    const namelessRead = await reads.updates.readCandidate({ variantId: "rev-no-record-names-this", session: sourceOf(control) });
    if (namelessRead.kind !== "denied") throw new Error(`An identity no record names was expected to be refused, and the read answered "${namelessRead.kind}".`);
    expect(namelessRead.denied.reasonCode).toBe("no-permission");
  });
});
describe("independent release heads and the partial failure", () => {
  it("gives every released edition its own head, addressable on its own", async () => {
    const englishHead = releasedView(await releaseOf(partial, EN_EDITION));
    const arabicHead = releasedView(await releaseOf(partial, AR_EDITION));
    expect(englishHead.release.releaseId).toBe(EN_SECOND_RELEASE);
    expect(arabicHead.release.releaseId).toBe(AR_PRIOR_RELEASE);
    expect(englishHead.release.variantId).toBe(EN_EDITION);
    expect(arabicHead.release.variantId).toBe(AR_EDITION);
    expect(englishHead.release.releaseId).not.toBe(arabicHead.release.releaseId);
    // Each read states the sibling's own head, so neither edition resolves through the other.
    const arabicSibling = required(
      englishHead.siblingHeads.find((edition) => edition.variantId === AR_EDITION),
      `the Arabic sibling of ${EN_EDITION}`,
    );
    expect(arabicSibling.headRelease?.releaseId).toBe(AR_PRIOR_RELEASE);
    const englishSibling = required(
      arabicHead.siblingHeads.find((edition) => edition.variantId === EN_EDITION),
      `the English sibling of ${AR_EDITION}`,
    );
    expect(englishSibling.headRelease?.releaseId).toBe(EN_SECOND_RELEASE);
  });
  it("reports a partial release per edition, keeps the failed edition's prior-good head and rolls nothing back", async () => {
    const englishDraft = await saveDraftText(partial, EN_EDITION, ["Autumn at Harbour Youth, ready for the next release."]);
    const published = acceptedOutcome(await publishEditions(partial, [{ variantId: EN_EDITION }, { variantId: AR_EDITION }]));
    const entries = itemsOf(published);
    expect(entries).toHaveLength(2);
    const englishEntry = itemFor(entries, EN_EDITION);
    const arabicEntry = itemFor(entries, AR_EDITION);
    expect(englishEntry.state).toBe("released");
    expect(arabicEntry.state).toBe("needs-attention");
    expect(arabicEntry.reasonCode).toBe("awaiting-review");
    expect(arabicEntry.revision).toBeUndefined();
    expect(new Set(entries.map((entry) => entry.state)).size).toBe(2);
    expect(entries.some((entry) => entry.targetId === AR_EDITION && entry.state === "released")).toBe(false);
    const advancedReleaseId = required(englishEntry.revision, `the release identity of ${EN_EDITION}`);
    const englishHead = releasedView(await releaseOf(partial, EN_EDITION));
    expect(englishHead.release.releaseId).toBe(advancedReleaseId);
    expect(englishHead.release.revisionId).toBe(englishDraft);
    expect(englishHead.release.releaseId).not.toBe(EN_SECOND_RELEASE);
    expect(releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId).toBe(AR_PRIOR_RELEASE);
  });
  it("takes a lost acknowledgement as no claim of success, and still advances only the edition that could release", async () => {
    const registry = required(
      DEMONSTRABLE_TARGETS.find((target) => target.name === "publishVariants"),
      "a demonstration of a lost acknowledgement on publishVariants",
    );
    expect(registry.modes).toContain("unknown");
    const devBefore = await devStateOf(partial);
    acceptedOutcome(await mutations.dev.setFailurePlan(attempt({ mode: "unknown", target: { kind: "mutation", name: "publishVariants" } } as const, devBefore.revision, partial.scope), partial.source));
    const armed = (await devStateOf(partial)).data;
    expect(armed.failurePlan.armed).toBe(true);
    expect(armed.failurePlan.mode).toBe("unknown");
    expect(armed.failurePlan.target?.name).toBe("publishVariants");
    const englishBefore = releasedView(await releaseOf(partial, EN_EDITION)).release.releaseId;
    const arabicBefore = releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId;
    const draft = await saveDraftText(partial, EN_EDITION, ["Autumn at Harbour Youth, after a lost acknowledgement."]);
    const withheld = outcomeIs(await publishEditions(partial, [{ variantId: EN_EDITION }]), "unknown");
    expect("items" in withheld).toBe(false);
    expect("created" in withheld).toBe(false);
    const englishAfter = releasedView(await releaseOf(partial, EN_EDITION));
    expect(englishAfter.release.releaseId).not.toBe(englishBefore);
    expect(englishAfter.release.revisionId).toBe(draft);
    expect(releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId).toBe(arabicBefore);
    // Disarmed here as well as after the case, so the control that clears a plan is itself asserted.
    const armedState = await devStateOf(partial);
    acceptedOutcome(await mutations.dev.setFailurePlan(attempt({ plan: null } as const, armedState.revision, partial.scope), partial.source));
    expect((await devStateOf(partial)).data.failurePlan.armed).toBe(false);
  });
});
describe("withdrawing one locale leaves the others", () => {
  it("withdraws the Arabic edition and leaves the English and French heads standing", async () => {
    const before = await overviewOf(partial);
    const englishHead = required(editionOf(before, EN_EDITION).headRelease?.releaseId, "the English head before the withdrawal");
    const frenchHead = required(editionOf(before, FR_EDITION).headRelease?.releaseId, "the French head before the withdrawal");
    expect(frenchHead).toBe(FR_RELEASE);
    acceptedOutcome(await mutations.updates.withdrawLocale(partial.sessionId, attempt({ variantId: AR_EDITION }, before.revision, partial.scope)));
    const arabic = withdrawnReleaseView(await releaseOf(partial, AR_EDITION));
    expect(arabic.release.releaseId).toBe(AR_PRIOR_RELEASE);
    expect(arabic.release.withdrawnAt.length).toBeGreaterThan(0);
    expect(releasedView(await releaseOf(partial, EN_EDITION)).release.releaseId).toBe(englishHead);
    expect(releasedView(await releaseOf(partial, FR_EDITION)).release.releaseId).toBe(frenchHead);
    expect(draftRevisionOf(await draftOf(partial, AR_EDITION)).revisionId).toBe(AR_DRAFT_REVISION);
    expect(frozenCandidate(await candidateOf(partial, AR_EDITION)).candidate.revisionId).toBe(AR_CANDIDATE);
    const arabicEdition = editionOf(await overviewOf(partial), AR_EDITION);
    expect(arabicEdition.releaseHeadId).toBe(AR_PRIOR_RELEASE);
    expect(arabicEdition.headRelease?.withdrawnAt).toBeDefined();
    const afterWithdrawal = await overviewOf(partial);
    const again = await mutations.updates.withdrawLocale(partial.sessionId, attempt({ variantId: AR_EDITION }, afterWithdrawal.revision, partial.scope));
    expect(outcomeIs(again, "unchanged").outcome).toBe("unchanged");
  });
});
