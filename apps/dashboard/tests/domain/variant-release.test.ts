/** The variant and release identity model (success criterion 17), proven at the service boundary: a draft, a candidate and a release are three separate identities; a candidate freezes the exact revision under review. */ import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type MutationInput, type Scope } from "@/modules/data-service";
import { resolveSession } from "@/modules/data-service/authorize";
import { isOutcome, type InvalidOutcome, type JsonValue, type MutationOutcome, type PerItemResult, type ReadResult } from "@/modules/data-service/outcome";
import { REVIEW_STEPS_PER_CANDIDATE, VARIANT_AUDIENCES, type ContentRevision } from "@/modules/content/variant";
import { DEMONSTRABLE_TARGETS } from "@/modules/dev-runtime/failures";
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { resetSession } from "@/modules/store/repository";
import { expectEnvelope, firstWhere, requiredSaying, throwing } from "../helpers/answers";
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
type World = { readonly sessionId: string; readonly source: { readonly sessionId: string }; readonly scope: Scope };
function scopeOf(state: SessionStateDocument): Scope {
  const { context } = state;
  if (context.selectedOrganizationId === null || context.selectedMinistryId === null || context.selectedSupportSubjectId === null) throw new Error("The seeded session selects no context, so no edition of it can be read or changed under an authority it never chose.");
  return { organizationId: context.selectedOrganizationId, ministryId: context.selectedMinistryId, supportSubjectId: context.selectedSupportSubjectId, principalId: context.principalId };
}
const required = <T>(value: T | undefined, what: string): T => requiredSaying(value, `The seeded world carries no ${what}, so this case cannot start from it.`);
async function layDown(sessionId: string, documents: SeededSessionDocuments): Promise<World> {
  await resetSession(sessionId, documents);
  return { sessionId, source: { sessionId }, scope: scopeOf(documents.state) };
}
let control: World;
let partial: World;
let reviewer: World;
let blind: World;
/** The seeded document sets the worlds are laid down from, captured once so every case starts from the same bytes. */ let baselineDocuments: SeededSessionDocuments;
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
  baselineDocuments = (sessions.find((row) => row.sessionId === DEFAULT_SESSION_ID) ?? throwing(`session "${DEFAULT_SESSION_ID}"`)).documents;
  partialDocuments = (sessions.find((row) => row.sessionId === PARTIAL_SEEDED_SESSION) ?? throwing(`session "${PARTIAL_SEEDED_SESSION}"`)).documents;
  reviewerDocuments = (sessions.find((row) => row.sessionId === REVIEWER_SEEDED_SESSION) ?? throwing(`session "${REVIEWER_SEEDED_SESSION}"`)).documents;
  await layDownWorlds();
});
beforeEach(layDownWorlds);
afterEach(async () => {
  // Exactly one failure may be armed at a time, and a world that ended a case with one armed would answer the next case's read or change with it. Disarming is therefore unconditional, and it names the development document's own revision, which is what a change to that document presents.
  for (const world of [control, partial, reviewer]) {
    const { revision } = await devStateOf(world);
    await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: world.scope, expectedRevision: revision, payload: { plan: null } }, world.source);
  }
});
afterAll(async () => {
  for (const sessionId of laidDownSessions) await resetSession(sessionId);
});
const sourceOf = (world: World): { readonly sessionId: string } => world.source;
const attempt = <P>(payload: P, expectedRevision: string, acting: Scope): MutationInput<P> => ({ operationId: newOperationId(), scope: acting, expectedRevision, payload });
function outcomeIs(outcome: MutationOutcome, expected: MutationOutcome["outcome"]): MutationOutcome {
  expect([isOutcome(outcome), outcome.outcome]).toEqual([true, expected]);
  return outcome;
}
const acceptedOutcome = (outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "accepted" }> => (outcome.outcome === "accepted" ? outcome : throwing(`This change was expected to be applied once and was answered with ${JSON.stringify(outcome)}.`));
function alreadyAcceptedOutcome(outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "alreadyAccepted" }> {
  if (outcome.outcome !== "alreadyAccepted") throw new Error(`This attempt was expected to be recognised as a replay and was answered with ${JSON.stringify(outcome)}.`);
  return outcome;
}
const invalidOutcome = (outcome: MutationOutcome): InvalidOutcome => (outcome.outcome !== "invalid" ? throwing(`This change was expected to be refused by validation and was answered with ${JSON.stringify(outcome)}.`) : outcome);
const unchangedOutcome = (outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "unchanged" }> => (outcome.outcome !== "unchanged" ? throwing(`This change was expected to answer that the record already said it, and it answered with ${JSON.stringify(outcome)}.`) : outcome);
/** The per-edition results of one release, which an aggregate answer would not carry at all. */ function itemsOf(outcome: Extract<MutationOutcome, { outcome: "accepted" }>): readonly PerItemResult[] {
  const items = requiredSaying(outcome.items, "This change reports no per-item results, so no edition's own outcome could be asserted.");
  return items;
}
const itemFor = (items: readonly PerItemResult[], variantId: string): PerItemResult => firstWhere(items, "targetId", variantId, `per-edition result for ${variantId}`);
const isPlainRecord = (value: JsonValue): value is { readonly [field: string]: JsonValue } => typeof value === "object" && value !== null && !Array.isArray(value);
/** The release modes a stored release result states, one per edition: read from the replayed attempt rather than from the surface, because the mode a submission recorded is the fact this file checks against the record. */ function notifyModesOf(result: JsonValue): readonly (string | null)[] {
  if (!isPlainRecord(result)) throw new Error("A release attempt's stored result is an object carrying its per-edition outcomes.");
  const editions = result["editions"];
  if (!Array.isArray(editions)) throw new Error("A release attempt's stored result carries one entry per selected edition.");
  return editions.map((entry) => {
    if (!isPlainRecord(entry)) throw new Error("Every stored per-edition outcome is an object.");
    const mode = entry["notifyMode"];
    return typeof mode === "string" ? mode : null;
  });
}
const envelopeOf = async <T>(pending: Promise<ReadResult<T>>, what: string): Promise<T> => expectEnvelope(await pending, what);
const overviewOf = async (world: World) => envelopeOf(reads.updates.readVariantOverview({ documentId: DOCUMENT_ID, session: sourceOf(world) }), `readVariantOverview(${DOCUMENT_ID})`);
type OverviewEnvelope = Awaited<ReturnType<typeof overviewOf>>;
type EditionView = OverviewEnvelope["data"]["editions"][number];
const editionOf = (overview: OverviewEnvelope, variantId: string): EditionView => firstWhere(overview.data.editions, "variantId", variantId, `an edition ${variantId} of ${DOCUMENT_ID}`);
const documentRevision = async (world: World): Promise<string> => (await overviewOf(world)).revision;
const editionRevision = async (world: World, variantId: string): Promise<string> => editionOf(await overviewOf(world), variantId).recordRevision;
const draftOf = async (world: World, variantId: string) => (await envelopeOf(reads.updates.readDraft({ variantId, session: sourceOf(world) }), `readDraft(${variantId})`)).data;
type DraftView = Awaited<ReturnType<typeof draftOf>>;
const draftRevisionOf = (view: DraftView): ContentRevision => (view.status !== "draft" ? throwing(`This edition was expected to hold a saved draft, and its draft read reported "${view.status}".`) : view.revision);
const candidateOf = async (world: World, variantId: string) => (await envelopeOf(reads.updates.readCandidate({ variantId, session: sourceOf(world) }), `readCandidate(${variantId})`)).data;
type CandidateView = Awaited<ReturnType<typeof candidateOf>>;
type FrozenCandidateView = Extract<CandidateView, { status: "reviewable" }>;
const frozenCandidate = (view: CandidateView): FrozenCandidateView => (view.status !== "reviewable" ? throwing(`This edition was expected to hold a candidate under review, and its candidate read reported "${view.status}".`) : view);
const releaseOf = async (world: World, variantId: string) => (await envelopeOf(reads.updates.readRelease({ variantId, session: sourceOf(world) }), `readRelease(${variantId})`)).data;
type ReleaseView = Awaited<ReturnType<typeof releaseOf>>;
const releasedView = (view: ReleaseView): Extract<ReleaseView, { status: "released" }> => (view.status === "released" ? view : throwing(`This edition was expected to serve a release at its head, and its release read reported "${view.status}".`));
const withdrawnReleaseView = (view: ReleaseView): Extract<ReleaseView, { status: "withdrawn" }> => (view.status === "withdrawn" ? view : throwing(`This edition was expected to hold a withdrawn release, and its release read reported "${view.status}".`));
const PAGE_ID = "doc-page-harbour-kitchen";
const pageOf = async (world: World) => envelopeOf(reads.pages.readPage({ pageId: PAGE_ID, session: sourceOf(world) }), `readPage(${PAGE_ID})`);
type PageView = Awaited<ReturnType<typeof pageOf>>;
type PageDraftView = NonNullable<PageView["data"]["draft"]>;
const pageDraftOf = (view: PageView): PageDraftView => (view.data.draft === null ? throwing(`The seeded Page ${PAGE_ID} was expected to hold a saved draft, and its read reported none.`) : view.data.draft);
const pageSectionOf = (view: PageView, position: number) => required(view.data.sections[position], `section ${String(position)} of ${PAGE_ID}`);
const devStateOf = async (world: World) => envelopeOf(reads.dev.readDevState(sourceOf(world)), "readDevState");
const body = (direction: "ltr" | "rtl", paragraphs: readonly string[]): unknown => ({ type: "doc", profileVersion: 1, direction, content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })), sections: [] });
function textOfDocument(content: ContentRevision["body"]): readonly string[] {
  const collected: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (Reflect.get(node, "type") === "text") {
      const text: unknown = Reflect.get(node, "text");
      if (typeof text === "string") collected.push(text);
      return;
    }
    const children: unknown = Reflect.get(node, "content");
    if (Array.isArray(children)) for (const child of children) walk(child);
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
type ReleaseSelectionInput = { readonly variantId: string; readonly revisionId?: string; readonly mode?: "publish-only" | "publish-and-notify" };
const publishEditions = async (world: World, selections: readonly ReleaseSelectionInput[]): Promise<MutationOutcome> => mutations.updates.publishVariants(world.sessionId, attempt({ documentId: DOCUMENT_ID, variants: [...selections] }, UNCOMPARED_REVISION, world.scope));
it("three identities, never collapsed: keeps one edition's draft, candidate and release as three records it names separately", async () => {
  const overview = await overviewOf(partial);
  const arabic = editionOf(overview, AR_EDITION);
  expect(overview.data.document.documentId).toBe(DOCUMENT_ID);
  expect([...overview.data.audiences]).toEqual([...VARIANT_AUDIENCES]);
  expect(arabic.audience).toBe("public");
  expect([arabic.locale, [arabic.draftRevisionId, arabic.candidateId, arabic.releaseHeadId]]).toEqual([{ tag: "ar", direction: "rtl" }, [AR_DRAFT_REVISION, AR_CANDIDATE, AR_PRIOR_RELEASE]]);
  const identities = [arabic.draftRevisionId, arabic.candidateId, arabic.releaseHeadId];
  expect([identities.every((identity) => typeof identity === "string" && identity.length > 0), new Set(identities).size, draftRevisionOf(await draftOf(partial, AR_EDITION)).revisionId]).toEqual([true, 3, arabic.draftRevisionId]);
  expect([frozenCandidate(await candidateOf(partial, AR_EDITION)).candidate.revisionId, releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId]).toEqual([arabic.candidateId, arabic.releaseHeadId]);
});
it("three identities, never collapsed: gives three locale editions of one document their own draft identity", async () => {
  const spanish = await createEdition(control, { locale: "es" });
  const portuguese = await createEdition(control, { locale: "pt-BR" });
  const dutch = await createEdition(control, { locale: "nl" });
  const spanishRevision = await saveDraftText(control, spanish, ["Edición en español."]);
  const portugueseRevision = await saveDraftText(control, portuguese, ["Edição em português."]);
  const dutchRevision = await saveDraftText(control, dutch, ["Nederlandse editie."]);
  expect([new Set([spanish, portuguese, dutch]).size, new Set([spanishRevision, portugueseRevision, dutchRevision]).size]).toEqual([3, 3]);
  const overview = await overviewOf(control);
  expect([editionOf(overview, spanish).draftRevisionId, editionOf(overview, portuguese).draftRevisionId, editionOf(overview, dutch).draftRevisionId]).toEqual([spanishRevision, portugueseRevision, dutchRevision]);
  const drafts = [spanishRevision, portugueseRevision, dutchRevision]; // The count is stated from the document's own edition list rather than from this case's bookkeeping.
  expect(overview.data.editions.filter((edition) => edition.draftRevisionId !== null && drafts.includes(edition.draftRevisionId)).length).toBe(3);
});
it("three identities, never collapsed: records the revising principal and the reviewing principal as two identities", async () => {
  const contributor = await resolveSession({ sessionId: control.sessionId });
  const reviewing = await resolveSession({ sessionId: reviewer.sessionId });
  if (!contributor.ok || !reviewing.ok) throw new Error("Both seeded identities were expected to resolve, and one was refused.");
  expect(contributor.session.principalId).not.toBe(reviewing.session.principalId);
  const edition = await createEdition(control, { locale: "cy" }); // A revision names the principal who wrote it, so the writer is never inferred from whichever identity happens to approve the candidate afterwards.
  await saveDraftText(control, edition, ["Drafft Cymraeg."]);
  const draft = draftRevisionOf(await draftOf(control, edition));
  expect(draft.authorPrincipalId).toBe(contributor.session.principalId);
  expect(draft.authorPrincipalId).not.toBe(reviewing.session.principalId);
});
it("a candidate freezes the exact revision: keeps the candidate on the revision it froze after a later draft save", async () => {
  const edition = await createEdition(control, { locale: "sv" });
  const frozen = await saveDraftText(control, edition, ["Svenskt utkast, första versionen."]);
  const candidateId = await submitEdition(control, edition, frozen);
  expect(candidateId).toBe(frozen);
  const first = frozenCandidate(await candidateOf(control, edition));
  expect([first.candidate.revisionId, REVIEW_STEPS_PER_CANDIDATE, first.review.steps, first.review.round]).toEqual([frozen, 1, REVIEW_STEPS_PER_CANDIDATE, REVIEW_STEPS_PER_CANDIDATE]);
  const later = await saveDraftText(control, edition, ["Svenskt utkast, andra versionen."]);
  expect(later).not.toBe(frozen);
  const afterSave = frozenCandidate(await candidateOf(control, edition));
  expect(afterSave.candidate.revisionId).toBe(frozen);
  const draft = draftRevisionOf(await draftOf(control, edition));
  expect(draft.revisionId).toBe(later);
  expect(draft.revisionId).not.toBe(afterSave.candidate.revisionId);
  const pointers = editionOf(await overviewOf(control), edition);
  expect([pointers.candidateId, pointers.draftRevisionId]).toEqual([frozen, later]);
});
it("a candidate freezes the exact revision: approves the frozen revision, not the newest draft", async () => {
  const edition = await createEdition(control, { locale: "is" });
  const frozen = await saveDraftText(control, edition, ["Íslenskt drög, fyrsta útgáfa."]);
  await submitEdition(control, edition, frozen);
  const later = await saveDraftText(control, edition, ["Íslenskt drög, önnur útgáfa."]);
  acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: frozen }, await editionRevision(control, edition), control.scope)));
  const answered = frozenCandidate(await candidateOf(control, edition));
  expect([answered.review.decision, answered.candidate.revisionId]).toEqual(["approved", frozen]);
  const draft = draftRevisionOf(await draftOf(control, edition));
  expect(draft.revisionId).toBe(later);
  expect(draft.revisionId).not.toBe(answered.candidate.revisionId);
});
it("a candidate freezes the exact revision: restores an earlier revision as a new draft identity carrying its prose", async () => {
  const edition = await createEdition(control, { locale: "fo" });
  const first = await saveDraftText(control, edition, ["Fyrsta útgáva."]);
  const second = await saveDraftText(control, edition, ["Onnur útgáva."]);
  const restored = acceptedOutcome(await mutations.updates.restoreRevisionAsDraft(control.sessionId, attempt({ revisionId: first }, await editionRevision(control, edition), control.scope)));
  const restoredId = required(restored.created?.[0], "the identity of the restored draft");
  for (const expected of [first, second]) expect(restoredId).not.toBe(expected);
  const draft = draftRevisionOf(await draftOf(control, edition));
  expect(draft.revisionId).toBe(restoredId);
  expect(textOfDocument(draft.body)).toEqual(["Fyrsta útgáva."]);
  expect(editionOf(await overviewOf(control), edition).draftRevisionId).toBe(restoredId);
});
it("a release consumes the frozen candidate it answers: leaves an edition with no submission once the revision its candidate froze is published, and a candidate again when a newer revision is frozen beside that release", async () => {
  const edition = await createEdition(control, { locale: "ro" });
  const frozen = await saveDraftText(control, edition, ["Proiect românesc pentru tineret."]);
  const candidateId = await submitEdition(control, edition, frozen);
  expect(candidateId).toBe(frozen);
  acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId }, await editionRevision(control, edition), control.scope)));
  const released = acceptedOutcome(await publishEditions(control, [{ variantId: edition }]));
  expect(itemFor(itemsOf(released), edition).state).toBe("released");
  const published = editionOf(await overviewOf(control), edition);
  // The release published the very revision the candidate froze, so the edition holds no submission afterwards and offers no review step.
  expect([published.headRelease?.revisionId, releasedView(await releaseOf(control, edition)).release.revisionId, published.candidateId, (await candidateOf(control, edition)).status]).toEqual([frozen, frozen, null, "none"]);
  const newer = await saveDraftText(control, edition, ["Proiect românesc, a doua versiune."]); // A newer revision frozen beside that publication is a submission again, because the release answered the revision before it: only a release of the candidate's own revision consumes it.
  expect(newer).not.toBe(frozen);
  expect(await submitEdition(control, edition, newer)).toBe(newer);
  const resubmitted = editionOf(await overviewOf(control), edition);
  expect([resubmitted.candidateId, resubmitted.headRelease?.revisionId, releasedView(await releaseOf(control, edition)).release.revisionId, frozenCandidate(await candidateOf(control, edition)).candidate.revisionId]).toEqual([newer, frozen, frozen, newer]);
});
it("one edition cannot advance or overwrite another: edits English without moving the French release head or the Arabic draft", async () => {
  const before = await overviewOf(control);
  const frenchBefore = editionOf(before, FR_EDITION);
  expect([frenchBefore.headRelease?.releaseId, frenchBefore.translation.status]).toEqual([FR_RELEASE, "fresh"]);
  const arabicDraftBefore = editionOf(before, AR_EDITION).draftRevisionId;
  expect(arabicDraftBefore).toBe(AR_DRAFT_REVISION);
  await saveDraftText(control, EN_EDITION, ["Autumn at Harbour Youth, revised for the next release."]);
  const after = await overviewOf(control);
  expect([editionOf(after, FR_EDITION).headRelease?.releaseId, releasedView(await releaseOf(control, FR_EDITION)).release.releaseId]).toEqual([FR_RELEASE, FR_RELEASE]);
  expect([editionOf(after, AR_EDITION).draftRevisionId, editionOf(after, FR_EDITION).translation.status]).toEqual([arabicDraftBefore, "stale"]); // A shared-draft implementation would move this pointer as well.
});
it("one edition cannot advance or overwrite another: records the source revision a manual translation copied, and reports staleness without withdrawing it", async () => {
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
  expect([stale.translation.sourceRevisionId, stale.translation.translatedFromRevisionId, stale.headRelease?.releaseId]).toEqual([revisedSource, sourceRevision, translationRelease]);
  expect(stale.headRelease?.withdrawnAt).toBeUndefined();
  expect(releasedView(await releaseOf(control, translation)).release.releaseId).toBe(translationRelease);
});
it("review is exactly one step, and it cannot be widened: answers a candidate once, and requires a new submission for a second round", async () => {
  const edition = await createEdition(control, { locale: "da" });
  const first = await saveDraftText(control, edition, ["Dansk udkast."]);
  await submitEdition(control, edition, first);
  const submitted = frozenCandidate(await candidateOf(control, edition));
  expect([submitted.review.steps, submitted.review.round]).toEqual([1, 1]);
  expect(submitted.review.decision).toBeNull();
  expect(submitted.review.approvalScope).toBe("this-variant-only");
  acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: first }, await editionRevision(control, edition), control.scope)));
  expect([frozenCandidate(await candidateOf(control, edition)).review.decision, outcomeIs(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: first }, await editionRevision(control, edition), control.scope)), "unchanged").outcome]).toEqual(["approved", "unchanged"]);
  expect(Object.keys(invalidOutcome(await mutations.updates.requestChanges(control.sessionId, attempt({ candidateId: first }, await editionRevision(control, edition), control.scope))).fields)).toContain("candidateId");
  const resubmitted = invalidOutcome(await mutations.updates.submitForReview(control.sessionId, attempt({ variantId: edition, revisionId: first }, await editionRevision(control, edition), control.scope)));
  expect(Object.keys(resubmitted.fields)).toContain("revisionId");
  const secondRound = await saveDraftText(control, edition, ["Dansk udkast, anden runde."]);
  expect(secondRound).not.toBe(first);
  expect(await submitEdition(control, edition, secondRound)).not.toBe(first);
  const rereviewable = frozenCandidate(await candidateOf(control, edition));
  expect(rereviewable.candidate.revisionId).toBe(secondRound);
  expect(rereviewable.review.decision).toBeNull();
});
it("review is exactly one step, and it cannot be widened: refuses to turn Publish only into Notify on the reviewer's path", async () => {
  const edition = await createEdition(control, { locale: "el" });
  const revision = await saveDraftText(control, edition, ["Ελληνικό σχέδιο."]);
  await submitEdition(control, edition, revision);
  const widened = invalidOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: revision, notifyMode: "publish-and-notify" }, await editionRevision(control, edition), control.scope))); // The mode belongs to the submission, so the reviewer's own step refuses to widen it.
  expect(Object.keys(widened.fields)).toContain("notifyMode");
  acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: revision }, await editionRevision(control, edition), control.scope)));
  const sibling = await createEdition(control, { locale: "he" }); // A sibling that needs no review, so the batch does release something and reports per edition.
  await saveDraftText(control, sibling, ["טיוטה בעברית."], "rtl");
  const batch = acceptedOutcome(await publishEditions(control, [{ variantId: edition, mode: "publish-and-notify" }, { variantId: sibling }]));
  const entries = itemsOf(batch);
  const refusedEntry = itemFor(entries, edition);
  expect([refusedEntry.state, refusedEntry.reasonCode, itemFor(entries, sibling).state]).toEqual(["needs-attention", "notify-mode-not-approved", "released"]);
  const releaseInput = attempt({ documentId: DOCUMENT_ID, variants: [{ variantId: edition }] }, UNCOMPARED_REVISION, control.scope);
  const released = acceptedOutcome(await mutations.updates.publishVariants(control.sessionId, releaseInput));
  expect(itemFor(itemsOf(released), edition).state).toBe("released");
  expect(notifyModesOf(alreadyAcceptedOutcome(await mutations.updates.publishVariants(control.sessionId, releaseInput)).result)).toEqual(["publish-only"]);
});
it("review is exactly one step, and it cannot be widened: reviews only the edition whose contributor policy requires a review", async () => {
  const edition = await createEdition(control, { locale: "fi" });
  const draft = await saveDraftText(control, edition, ["Suomalainen luonnos."]);
  expect((await candidateOf(control, edition)).status).toBe("none");
  const released = acceptedOutcome(await publishEditions(control, [{ variantId: edition }]));
  expect([itemFor(itemsOf(released), edition).state, releasedView(await releaseOf(control, edition)).release.revisionId]).toEqual(["released", draft]);
});
it("review is exactly one step, and it cannot be widened: approves one edition and leaves every other submission under review", async () => {
  const first = await createEdition(control, { locale: "cs" });
  const second = await createEdition(control, { locale: "sk" });
  const firstRevision = await saveDraftText(control, first, ["Český koncept."]);
  const secondRevision = await saveDraftText(control, second, ["Slovenský koncept."]);
  const firstCandidate = await submitEdition(control, first, firstRevision);
  const secondCandidate = await submitEdition(control, second, secondRevision);
  expect(firstCandidate).not.toBe(secondCandidate);
  acceptedOutcome(await mutations.updates.approveCandidate(control.sessionId, attempt({ candidateId: firstCandidate }, await editionRevision(control, first), control.scope)));
  expect(frozenCandidate(await candidateOf(control, first)).review.decision).toBe("approved");
  const siblingSubmission = frozenCandidate(await candidateOf(control, second)); // The sibling is still awaiting its own answer, and so is the seeded Arabic submission.
  expect(siblingSubmission.candidate.revisionId).toBe(secondCandidate);
  expect(siblingSubmission.review.decision).toBeNull();
  const seededSubmission = frozenCandidate(await candidateOf(control, AR_EDITION));
  expect(seededSubmission.candidate.revisionId).toBe(AR_CANDIDATE);
  expect(seededSubmission.review.decision).toBeNull();
});
it("a decided candidate reads as the decision on record: answers a requested change with its edition and the record of who gave it, when and with what note, and refuses an unreadable session or an unnamed identity", async () => {
  const edition = await createEdition(control, { locale: "lt" });
  const frozen = await saveDraftText(control, edition, ["Lietuviškas juodraštis."]);
  const candidateId = await submitEdition(control, edition, frozen);
  const note = "Please name the venue in the first paragraph.";
  const contributor = await resolveSession({ sessionId: control.sessionId });
  if (!contributor.ok) throw new Error("The seeded contributor identity was expected to resolve, and it was refused.");
  acceptedOutcome(await mutations.updates.requestChanges(control.sessionId, attempt({ candidateId, note }, await editionRevision(control, edition), control.scope)));
  // A requested change clears the edition's candidate pointer, so the review record is the only place the answered candidate is still paired with its edition. The identity the review surface was opened on therefore reads as that decision, never as a refusal, and it names the principal, the
  const decided = frozenCandidate(await candidateOf(control, candidateId)); // instant and the note the author was asked to act on.
  expect([decided.variant.variantId, decided.candidate.candidateId, decided.candidate.revisionId, decided.review.decision]).toEqual([edition, candidateId, frozen, "changes-requested"]);
  const record = decided.review.recorded;
  if (record === null) throw new Error("An answered candidate was expected to carry the record of its answer, and it carried none.");
  expect([record.decision, record.note, record.decidedByPrincipalId]).toEqual(["changes-requested", note, contributor.session.principalId]);
  expect(record.decidedAt ?? "").toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  expect((await candidateOf(control, edition)).status).toBe("none"); // The edition itself holds no candidate once it has been answered, so the edition's own identity still states exactly that: the two identities answer two different questions.
  const blindRead = await reads.updates.readCandidate({ variantId: candidateId, session: sourceOf(blind) }); // Authorisation precedes enumeration: the same candidate identity, read by a session that states it may not act in this ministry, is refused rather than resolved, and the refusal names nothing.
  if (blindRead.kind !== "denied") throw new Error(`A session that may not read the edition was expected to be refused, and the read answered "${blindRead.kind}".`);
  expect(blindRead.denied.reasonCode).toBe("not-admitted");
  const namelessRead = await reads.updates.readCandidate({ variantId: "rev-no-record-names-this", session: sourceOf(control) }); // An identity no record names is refused by the same closed reason the review surface already states, so a decision on record and a candidate that never existed stay indistinguishable.
  if (namelessRead.kind !== "denied") throw new Error(`An identity no record names was expected to be refused, and the read answered "${namelessRead.kind}".`);
  expect(namelessRead.denied.reasonCode).toBe("no-permission");
});
it("independent release heads and the partial failure: gives every released edition its own head, addressable on its own", async () => {
  const englishHead = releasedView(await releaseOf(partial, EN_EDITION));
  const arabicHead = releasedView(await releaseOf(partial, AR_EDITION));
  expect([englishHead.release.releaseId, arabicHead.release.releaseId, englishHead.release.variantId, arabicHead.release.variantId]).toEqual([EN_SECOND_RELEASE, AR_PRIOR_RELEASE, EN_EDITION, AR_EDITION]);
  expect(englishHead.release.releaseId).not.toBe(arabicHead.release.releaseId);
  const arabicSibling = firstWhere(englishHead.siblingHeads, "variantId", AR_EDITION, `the Arabic sibling of ${EN_EDITION}`); // Each read states the sibling's own head, so neither edition resolves through the other.
  expect(arabicSibling.headRelease?.releaseId).toBe(AR_PRIOR_RELEASE);
  expect(firstWhere(arabicHead.siblingHeads, "variantId", EN_EDITION, `the English sibling of ${AR_EDITION}`).headRelease?.releaseId).toBe(EN_SECOND_RELEASE);
});
it("independent release heads and the partial failure: reports a partial release per edition, keeps the failed edition's prior-good head and rolls nothing back", async () => {
  const englishDraft = await saveDraftText(partial, EN_EDITION, ["Autumn at Harbour Youth, ready for the next release."]);
  const published = acceptedOutcome(await publishEditions(partial, [{ variantId: EN_EDITION }, { variantId: AR_EDITION }]));
  const entries = itemsOf(published);
  expect(entries).toHaveLength(2);
  const englishEntry = itemFor(entries, EN_EDITION);
  const arabicEntry = itemFor(entries, AR_EDITION);
  expect([englishEntry.state, arabicEntry.state, arabicEntry.reasonCode]).toEqual(["released", "needs-attention", "awaiting-review"]);
  expect(arabicEntry.revision).toBeUndefined();
  expect([new Set(entries.map((entry) => entry.state)).size, entries.some((entry) => entry.targetId === AR_EDITION && entry.state === "released")]).toEqual([2, false]);
  const advancedReleaseId = required(englishEntry.revision, `the release identity of ${EN_EDITION}`);
  const englishHead = releasedView(await releaseOf(partial, EN_EDITION));
  expect([englishHead.release.releaseId, englishHead.release.revisionId]).toEqual([advancedReleaseId, englishDraft]);
  expect(englishHead.release.releaseId).not.toBe(EN_SECOND_RELEASE);
  expect(releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId).toBe(AR_PRIOR_RELEASE);
});
it("independent release heads and the partial failure: takes a lost acknowledgement as no claim of success, and still advances only the edition that could release", async () => {
  expect(firstWhere(DEMONSTRABLE_TARGETS, "name", "publishVariants", "a demonstration of a lost acknowledgement on publishVariants").modes).toContain("unknown");
  acceptedOutcome(await mutations.dev.setFailurePlan(attempt({ mode: "unknown", target: { kind: "mutation", name: "publishVariants" } } as const, (await devStateOf(partial)).revision, partial.scope), partial.source));
  const armed = (await devStateOf(partial)).data;
  expect([armed.failurePlan.armed, armed.failurePlan.mode, armed.failurePlan.target?.name]).toEqual([true, "unknown", "publishVariants"]);
  const englishBefore = releasedView(await releaseOf(partial, EN_EDITION)).release.releaseId;
  const arabicBefore = releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId;
  const draft = await saveDraftText(partial, EN_EDITION, ["Autumn at Harbour Youth, after a lost acknowledgement."]);
  const withheld = outcomeIs(await publishEditions(partial, [{ variantId: EN_EDITION }]), "unknown");
  expect(["items" in withheld, "created" in withheld]).toEqual([false, false]);
  const englishAfter = releasedView(await releaseOf(partial, EN_EDITION));
  expect(englishAfter.release.releaseId).not.toBe(englishBefore);
  expect([englishAfter.release.revisionId, releasedView(await releaseOf(partial, AR_EDITION)).release.releaseId]).toEqual([draft, arabicBefore]);
  const armedState = await devStateOf(partial); // Disarmed here as well as after the case, so the control that clears a plan is itself asserted.
  acceptedOutcome(await mutations.dev.setFailurePlan(attempt({ plan: null } as const, armedState.revision, partial.scope), partial.source));
  expect((await devStateOf(partial)).data.failurePlan.armed).toBe(false);
});
it("withdrawing one locale leaves the others: withdraws the Arabic edition and leaves the English and French heads standing", async () => {
  const before = await overviewOf(partial);
  const englishHead = required(editionOf(before, EN_EDITION).headRelease?.releaseId, "the English head before the withdrawal");
  const frenchHead = required(editionOf(before, FR_EDITION).headRelease?.releaseId, "the French head before the withdrawal");
  expect(frenchHead).toBe(FR_RELEASE);
  acceptedOutcome(await mutations.updates.withdrawLocale(partial.sessionId, attempt({ variantId: AR_EDITION }, before.revision, partial.scope)));
  const arabic = withdrawnReleaseView(await releaseOf(partial, AR_EDITION));
  expect(arabic.release.releaseId).toBe(AR_PRIOR_RELEASE);
  expect(arabic.release.withdrawnAt.length).toBeGreaterThan(0);
  expect([releasedView(await releaseOf(partial, EN_EDITION)).release.releaseId, releasedView(await releaseOf(partial, FR_EDITION)).release.releaseId, draftRevisionOf(await draftOf(partial, AR_EDITION)).revisionId]).toEqual([englishHead, frenchHead, AR_DRAFT_REVISION]);
  expect(frozenCandidate(await candidateOf(partial, AR_EDITION)).candidate.revisionId).toBe(AR_CANDIDATE);
  const arabicEdition = editionOf(await overviewOf(partial), AR_EDITION);
  expect(arabicEdition.releaseHeadId).toBe(AR_PRIOR_RELEASE);
  expect(arabicEdition.headRelease?.withdrawnAt).toBeDefined();
  const again = await mutations.updates.withdrawLocale(partial.sessionId, attempt({ variantId: AR_EDITION }, (await overviewOf(partial)).revision, partial.scope));
  expect(outcomeIs(again, "unchanged").outcome).toBe("unchanged");
});
it("a section save that writes nothing is not an acceptance: answers unchanged with the revision on the record and writes the same section once one presentation choice differs", async () => {
  const before = await pageOf(control);
  const draft = pageDraftOf(before);
  const section = pageSectionOf(before, 0);
  const sectionId = `section-${String(section.position)}`;
  // This save states exactly what the draft on the record already holds, so it is answered with the revision it found rather than accepted: nothing is written, no record revision advances and the stored section stands as it did.
  const repeated = unchangedOutcome(await mutations.pages.saveSectionFields(control.sessionId, attempt({ variantId: draft.variantId, sectionId, fields: section.fields, presentation: section.presentation }, draft.recordRevision, control.scope)));
  const unchanged = await pageOf(control);
  expect([repeated.revision, pageDraftOf(unchanged)]).toEqual([draft.recordRevision, draft]);
  expect(pageSectionOf(unchanged, 0)).toEqual(section);
  // One presentation choice moved is one thing said differently, so the same section saved again is a change the service has to write as a new revision of the same draft.
  const moved = { ...section.presentation, alignment: section.presentation.alignment === "start" ? ("center" as const) : ("start" as const) };
  const accepted = acceptedOutcome(await mutations.pages.saveSectionFields(control.sessionId, attempt({ variantId: draft.variantId, sectionId, presentation: moved }, draft.recordRevision, control.scope)));
  const advanced = await pageOf(control);
  expect(accepted.revision).not.toBe(draft.recordRevision);
  expect([pageDraftOf(advanced).recordRevision, pageDraftOf(advanced).revisionId, pageSectionOf(advanced, 0).presentation]).toEqual([accepted.revision, draft.revisionId, moved]);
});
it("a preset composes the draft edition: replaces the sections the draft held with its own, releases nothing and answers unchanged when it is applied again", async () => {
  const before = await pageOf(control);
  const draft = pageDraftOf(before);
  const presetId = "preset-opening-and-story" as const;
  const preset = required(
    before.data.presets.find((entry) => entry.presetId === presetId),
    `the opening-and-story preset of ${PAGE_ID}`,
  );
  expect(preset.sections).toEqual(["introduction", "story"]);
  // The seeded draft of this Page holds exactly one section, and a preset composes the edition it describes: the composed draft holds the preset's sections in their order, and the section the draft held is gone rather than shifted down the list.
  const accepted = acceptedOutcome(await mutations.pages.applyPreset(control.sessionId, attempt({ variantId: draft.variantId, presetId }, draft.recordRevision, control.scope)));
  const composed = await pageOf(control);
  expect(composed.data.sections.map((section) => section.element)).toEqual([...preset.sections]);
  expect(pageDraftOf(composed).recordRevision).toBe(accepted.revision);
  // Composing a draft releases nothing: every edition of this Page states the same release head, released edition, reach and last release it stated before the preset.
  const releaseFacts = (view: PageView): readonly unknown[] => view.data.editions.map((edition) => [edition.variantId, edition.releaseHeadId, edition.headRelease, edition.reach, edition.lastReleaseAt]);
  expect(releaseFacts(composed)).toEqual(releaseFacts(before));
  // The composed draft already states what the preset proposes, so applying the same preset again is answered with the revision on the record instead of a new one.
  const repeated = unchangedOutcome(await mutations.pages.applyPreset(control.sessionId, attempt({ variantId: draft.variantId, presetId }, accepted.revision, control.scope)));
  expect([repeated.revision, pageDraftOf(await pageOf(control))]).toEqual([accepted.revision, pageDraftOf(composed)]);
});
