/** A media placement change on an Update's own draft (attachment and removal of media in a Ministry Update), proven at the service boundary: an Update carries prose and its own media placements, so removing or replacing one edits the draft exactly as it does on a Page, while a section change on that same draft stays refused there. */
import { beforeEach, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type MutationInput, type Scope } from "@/modules/data-service";
import type { ResolvedSession, SessionSource } from "@/modules/data-service/authorize";
import { resetSeed } from "@/modules/dev-runtime/reset";
import { expectEnvelope, expectOutcome, first, required } from "../helpers/answers";
import { sessionOf } from "../helpers/fixtures";
// The identities this file acts as, and the seeded records it acts on
/** The seated worker: author of the seeded Update and the identity admitted to place media in its ministry. */
const HERO: SessionSource = { sessionId: "established-worker" };
/** The seeded Update edition whose release this file starts its own draft from. */
const SUPPORTER_EDITION = "variant-update-autumn-en-approved-supporter";
/** A seeded image of the same ministry, so the placement names an asset the service admits. */
const SEEDED_IMAGE = "asset-image-portrait";
/** The alternative text the placement under test states, which every placement has to carry. */
const PLACEMENT_ALT_TEXT = "The youth group gathered in the church hall.";
/** The replacement description the second case states. */
const REPLACEMENT_ALT_TEXT = "The group around one table at Friday's shared meal.";
/** The Section change a Page admits and an Update does not: a section composes a Page, and an Update carries prose and its own media placements. */
const SECTION_REFUSAL = "A section composes a Worker or Project Page; an Update carries prose and its own media placements.";
/** Builds the four-field input every named mutation presents, with a fresh attempt identity. */
const attempt = <P>(scope: Scope, expectedRevision: string, payload: P): MutationInput<P> => ({ operationId: newOperationId(), expectedRevision, payload, scope });
let session: ResolvedSession; // The world, resolved once per case: the seed lays the same sessions and the same selection down before every one
let scope: Scope;
/** Lays the seeded world down before every case, so a placement written here is never read by the case after it. */
beforeEach(async () => {
  await resetSeed();
  session = await sessionOf(HERO);
  scope = required(session.selected, `the selected context of ${HERO.sessionId}`);
});
const readDraftData = async () => expectEnvelope(await reads.updates.readDraft({ variantId: SUPPORTER_EDITION, session: HERO }), `readDraft(${SUPPORTER_EDITION})`).data;
type DraftData = Awaited<ReturnType<typeof readDraftData>>;
/** Narrows a draft read to the saved draft it is meant to have answered with, rather than reading an absent draft as an empty one. */
function savedDraftOf(data: DraftData): Extract<DraftData, { readonly status: "draft" }> {
  if (data.status !== "draft") throw new Error(`This Update edition was expected to hold a saved draft, and its draft read reported "${data.status}".`);
  return data;
}
/** Places one seeded image on the edition's own draft through the public save, answering the placement it wrote and the record revision the edition now stands at. */
async function placeOneImage(): Promise<{ readonly placementId: string; readonly recordRevision: string }> {
  const release = expectEnvelope(await reads.updates.readRelease({ variantId: SUPPORTER_EDITION, session: HERO }), `readRelease(${SUPPORTER_EDITION})`).data;
  if (release.status !== "released") throw new Error(`This edition was expected to serve the release its draft starts from, and its release read reported "${release.status}".`);
  expectOutcome(await mutations.updates.saveDraft(session.sessionId, attempt(scope, release.recordRevision, { variantId: SUPPORTER_EDITION, body: release.revision.body, mediaPlacements: [{ assetId: SEEDED_IMAGE, altText: PLACEMENT_ALT_TEXT }] })), "accepted");
  const draft = savedDraftOf(await readDraftData());
  expect(draft.placements).toHaveLength(1); // The placement exists before either change below, so a change that left it in place would not pass as the change.
  return { placementId: first(draft.placements, "placement of the Update draft").placementId, recordRevision: draft.recordRevision };
}
it("a media placement change on an Update draft: removes one placement from the Update edition's own draft", async () => {
  const placed = await placeOneImage();
  expectOutcome(await mutations.media.removePlacement(session.sessionId, attempt(scope, placed.recordRevision, { variantId: SUPPORTER_EDITION, placementId: placed.placementId })), "accepted");
  const after = savedDraftOf(await readDraftData());
  expect(after.placements).toEqual([]); // The placement is gone from the draft itself, not merely refused on the way out.
  expect(after.recordRevision).not.toBe(placed.recordRevision); // The removal advanced the edition, which a refused attempt cannot do.
});
it("a media placement change on an Update draft: replaces one placement of the Update edition's own draft", async () => {
  const placed = await placeOneImage();
  expectOutcome(await mutations.media.replacePlacement(session.sessionId, attempt(scope, placed.recordRevision, { variantId: SUPPORTER_EDITION, placementId: placed.placementId, placement: { altText: REPLACEMENT_ALT_TEXT } })), "accepted");
  const after = savedDraftOf(await readDraftData());
  expect([after.placements.length, after.placements.at(0)?.altText, after.placements.at(0)?.placementId]).toEqual([1, REPLACEMENT_ALT_TEXT, placed.placementId]); // One placement, described afresh and still the placement the caller named.
});
it("a media placement change on an Update draft: still refuses a section change on that same Update draft, leaving the placement it holds untouched", async () => {
  const placed = await placeOneImage();
  const refused = expectOutcome(await mutations.pages.addSection(session.sessionId, attempt(scope, placed.recordRevision, { variantId: SUPPORTER_EDITION, sectionType: "story" })), "invalid");
  expect(refused.fields["variantId"]).toEqual([SECTION_REFUSAL]); // The refusal names the field the caller named, with the sentence the section path states.
  const after = savedDraftOf(await readDraftData());
  expect([after.recordRevision, after.placements.map((placement) => placement.placementId)]).toEqual([placed.recordRevision, [placed.placementId]]); // A refused section change writes nothing: same edition revision, same placement.
});
