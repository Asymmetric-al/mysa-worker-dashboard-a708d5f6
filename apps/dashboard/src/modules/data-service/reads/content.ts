import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { compareCodeUnits } from "@/lib/ordering";
import { assertNever } from "@/lib/result";
import { CONTENT_PROFILE_VERSION, PRESENTATION_CHOICES, parseDocument, serialise, type ContentDocumentJson, type ContentSection, type DocumentIssue, type PresentationChoice } from "@/modules/content/document";
import { admittedLocales, directionOfTag, resolveLocale, type AdmittedLocale, type ContentLocale, type LocaleResolution } from "@/modules/content/locale";
import { PREVIEW_RENDITION_PURPOSES, authorisePreview, type PreviewDenialReason } from "@/modules/content/preview";
import { REACH_VALUES, isDirectlyReadable, isListedPublicly, reachMetadata, withdrawEdition, type Reach, type ReachMetadata, type Tombstone } from "@/modules/content/reach";
import { renderToHtml, type RenderMediaPlacement, type RenderRendition, type RenderRenditionPurpose, type RenderRenditions } from "@/modules/content/render";
import { REVIEW_DECISIONS, REVIEW_STEPS_PER_CANDIDATE, VARIANT_FAMILIES, admittedAudiences, translationStaleness, type ContentCandidate, type ContentDocument, type ContentRevision, type ContentVariant, type Release, type ReviewDecision, type TranslationStaleness } from "@/modules/content/variant";
import { scenarioMediaServing } from "@/modules/dev-runtime/scenario";
import { mediaStateReason, type MediaRenditionPurpose, type MediaStateReason } from "@/modules/media/asset";
import { GOAL_MEASURE } from "@/modules/support/goal";
import { clampPageSize } from "@/modules/support/report";
import { canEdit, canView, type ResolvedSession, type SessionSource } from "../authorize";
import {
  PAGE_SECTION_TYPES,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  mediaAssetRecordSchema,
  project,
  releaseRecordSchema,
  storedInstantSchema,
  supportProjectionRecordSchema,
  type ContentAudience,
  type ContentCaptionTrackRecord,
  type ContentDocumentRecord,
  type ContentFamily,
  type ContentKind,
  type Coverage,
  type CoverageState,
  type MediaAssetKind,
  type MediaPlacementRecord,
  type PageSectionType,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type ReleaseRecord,
  type Scope,
  type SharePresentationRecord,
  type SupportBasis,
  type SupportGoalMeasure,
  type SupportProjectionRecord,
} from "../envelope";
import { storedContentRevisionRecordSchema } from "../envelope";
import type { StoredContentRevisionRecord } from "../envelope";
import type { ReadResult } from "../outcome";
import type { PageWindow } from "./audience";
import { answerOf, deniedRead, digest, openStatefulRead, readAction, storeSource } from "./frame";
import { contentRevisionOf, contentVariantOf } from "../projection";
type StoredContentRevision = StoredContentRevisionRecord;
const SUBMITTED_RELEASE_MODES = ["publish-only", "publish-and-notify"] as const;
type SubmittedReleaseMode = (typeof SUBMITTED_RELEASE_MODES)[number];
const storedReviewDecisionSchema: z.ZodType<"submitted" | ReviewDecision> = z.union([z.literal("submitted"), z.enum(REVIEW_DECISIONS)]);
const contentReviewRecordSchema = z.object({ candidateId: z.string().min(1), variantId: z.string().min(1), notifyMode: z.enum(SUBMITTED_RELEASE_MODES), decision: storedReviewDecisionSchema, note: z.string().nullable(), decidedAt: storedInstantSchema.nullable(), decidedByPrincipalId: z.string().min(1).nullable() });
type ContentReviewRecord = z.infer<typeof contentReviewRecordSchema>;
const contentWorkspaceSchema = z.object({
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  contentRevisions: z.array(storedContentRevisionRecordSchema),
  contentReviews: z.array(contentReviewRecordSchema).default([]),
  releases: z.array(releaseRecordSchema),
  mediaAssets: z.array(mediaAssetRecordSchema),
  supportProjection: supportProjectionRecordSchema.nullable().optional(),
});
type ContentWorkspaceState = z.infer<typeof contentWorkspaceSchema>;
type ContentWorkspace = { readonly session: ResolvedSession; readonly scope: Scope; readonly asOf: Temporal.Instant; readonly state: ContentWorkspaceState };
type WorkspaceOpen = { readonly ok: true; readonly workspace: ContentWorkspace } | { readonly ok: false; readonly result: ReadResult<never> };
const CONTENT_SOURCE_REFERENCE = "content";
const CONTENT_UNAVAILABLE_GUIDANCE = "The local content store could not be read for this request. Reload the surface to try again; nothing was changed.";
async function openContentWorkspace(job: string, source?: SessionSource): Promise<WorkspaceOpen> {
  const opened = await openStatefulRead({
    source,
    job,
    unselectedReason: "not-admitted",
    sessionFaultReason: "session-unavailable",
    permit: (session, scope) => canView(session, { kind: "content-variant", scope }),
    sourceOf: storeSource(CONTENT_SOURCE_REFERENCE),
    schema: contentWorkspaceSchema,
    guidance: CONTENT_UNAVAILABLE_GUIDANCE,
  });
  return !opened.ok ? { ok: false, result: opened.result } : { ok: true, workspace: { session: opened.session, scope: opened.scope, asOf: opened.instant, state: opened.state } };
}
/** The result a read answers with: the data it states, its recorded value states and its advisory actions, stated at the workspace's own scope and instant. */
function respond<T>(workspace: ContentWorkspace, referenced: string, revision: string, data: T, valueStates: Readonly<Record<string, RecordedValueState>>, actions: readonly ReadAction[]): ReadResult<ReadEnvelope<T>> {
  return answerOf(workspace.scope, workspace.asOf.toString(), { data, source: storeSource(referenced), revision, valueStates, actions });
}
const localeOf = (tag: string, direction: ContentLocale["direction"]): ContentLocale => ({ tag, direction });
const releaseLocaleOf = (tag: string): ContentLocale => ({ tag, direction: directionOfTag(tag) });
type RevisionChecksums = ReadonlyMap<string, string>;
function checksumsOf(state: ContentWorkspaceState): RevisionChecksums {
  const index = new Map<string, string>();
  for (const revision of state.contentRevisions) index.set(revision.revisionId, revision.contentChecksum);
  return index;
}
function releaseOf(record: ReleaseRecord, checksums: RevisionChecksums): Release {
  return {
    releaseId: record.releaseId,
    variantId: record.variantId,
    revisionId: record.revisionId,
    audience: record.audience,
    locale: releaseLocaleOf(record.locale),
    publishedAt: Temporal.Instant.from(record.publishedAt),
    reach: record.reach,
    contentChecksum: checksums.get(record.revisionId) ?? "",
    ...(record.withdrawnAt === null ? {} : { withdrawnAt: Temporal.Instant.from(record.withdrawnAt) }),
    ...(record.supersededBy === null ? {} : { supersededBy: record.supersededBy }),
  };
}
type ContentVariantRecordLike = ContentWorkspaceState["contentVariants"][number];
const findDocument = (state: ContentWorkspaceState, documentId: string): ContentDocumentRecord | undefined => state.contentDocuments.find((candidate) => candidate.documentId === documentId);
const findVariant = (state: ContentWorkspaceState, variantId: string): ContentVariantRecordLike | undefined => state.contentVariants.find((candidate) => candidate.variantId === variantId);
const variantOfFrozenCandidate = (state: ContentWorkspaceState, candidateId: string): ContentVariantRecordLike | undefined => state.contentVariants.find((variant) => variant.candidateId === candidateId);
interface CandidateResolution {
  readonly record: ContentVariantRecordLike;
  readonly candidateId: string | null;
}
function resolveCandidateIdentity(state: ContentWorkspaceState, identity: string): CandidateResolution | undefined {
  const edition = findVariant(state, identity);
  if (edition !== undefined) return { record: edition, candidateId: edition.candidateId };
  const holding = variantOfFrozenCandidate(state, identity);
  if (holding !== undefined) return { record: holding, candidateId: identity };
  const answered = state.contentReviews.find((review) => review.candidateId === identity);
  if (answered === undefined) return undefined;
  const record = findVariant(state, answered.variantId);
  return record === undefined ? undefined : { record, candidateId: identity };
}
const variantsOf = (state: ContentWorkspaceState, documentId: string): readonly ContentVariantRecordLike[] => state.contentVariants.filter((variant) => variant.documentId === documentId);
const findRevision = (state: ContentWorkspaceState, revisionId: string): StoredContentRevision | undefined => state.contentRevisions.find((candidate) => candidate.revisionId === revisionId);
const releasesOf = (state: ContentWorkspaceState, documentId: string): readonly ReleaseRecord[] => state.releases.filter((release) => new Set(variantsOf(state, documentId).map((variant) => variant.variantId)).has(release.variantId));
const releasesOfVariant = (state: ContentWorkspaceState, variantId: string): readonly ReleaseRecord[] => state.releases.filter((release) => release.variantId === variantId);
function headReleaseOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike): ReleaseRecord | undefined {
  const head = variant.releaseHeadId;
  return head === null ? undefined : releasesOfVariant(state, variant.variantId).find((release) => release.releaseId === head);
}
function newestReleaseOf(releases: readonly ReleaseRecord[]): ReleaseRecord | undefined {
  let newest: ReleaseRecord | undefined;
  for (const release of releases) {
    if (newest === undefined) {
      newest = release;
      continue;
    }
    const comparison = Temporal.Instant.compare(Temporal.Instant.from(release.publishedAt), Temporal.Instant.from(newest.publishedAt));
    if (comparison > 0 || (comparison === 0 && release.releaseId < newest.releaseId)) newest = release;
  }
  return newest;
}
const isWithdrawnRelease = (record: ReleaseRecord): boolean => record.withdrawnAt !== null;
function documentOf(record: ContentDocumentRecord): ContentDocument {
  return { documentId: record.documentId, family: record.family, kind: record.kind, sourceSubject: record.sourceSubject, siteId: record.siteId, ...(record.givingBinding === null ? {} : { givingBinding: record.givingBinding.designation }), managedFields: {} };
}
const NO_DECLARED_SITE_DEFAULT = "";
const renditionPath = (assetId: string, renditionId: string): string => `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(renditionId)}`;
export type ContentRenditionView = { readonly renditionId: string; readonly purpose: MediaRenditionPurpose; readonly mimeType: string; readonly path: string };
export type ContentPlacementView = { readonly placementId: string; readonly assetId: string; readonly kind: MediaAssetKind; readonly sectionElement: string | null } & { readonly position: number; readonly altText: string; readonly caption: string | null; readonly credit: string | null } & {
  readonly state: "ready" | "unavailable";
  readonly reason: MediaStateReason | null;
  readonly renditions: readonly ContentRenditionView[];
} & { readonly captionTracks: readonly ContentCaptionTrackRecord[] };
const MAIN_RENDITION_PURPOSES: Readonly<Record<MediaAssetKind, MediaRenditionPurpose>> = { image: "display", video: "playback" };
const mainRenditionPurpose = (kind: MediaAssetKind): MediaRenditionPurpose => MAIN_RENDITION_PURPOSES[kind];
const RENDERABLE_PURPOSES: Readonly<Record<MediaRenditionPurpose, RenderRenditionPurpose>> = { display: "display", playback: "playback", poster: "poster", captions: "captions", transcript: "transcript" };
const asRenderPurpose = (purpose: MediaRenditionPurpose): RenderRenditionPurpose => RENDERABLE_PURPOSES[purpose];
const VISIBLE_MEDIA_ASSET_FIELDS = ["assetId", "kind", "profileCheck", "renditions", "tagVerification", "revision"] as const;
/** One placement as this surface may state it: `ready` only when its main rendition exists and the media source is served, and `unavailable` with the source's own reason otherwise. The full rendition list stays on an unavailable placement, because those records are the facts the editor shows about the asset it still holds. */
function placementViews(workspace: ContentWorkspace, placements: readonly MediaPlacementRecord[], captionTracks: readonly ContentCaptionTrackRecord[]): readonly ContentPlacementView[] {
  const serving = scenarioMediaServing(workspace.session.scenarioId);
  return placements.map((placement) => {
    const asset = workspace.state.mediaAssets.find((candidate) => candidate.assetId === placement.assetId);
    const tracks = captionTracks.filter((track) => track.assetId === placement.assetId);
    const reason = mediaStateReason("unavailable");
    if (asset === undefined) return unreadablePlacement(placement, "video", reason, tracks);
    if (!canView(workspace.session, { kind: "media-asset", scope: asset.scope }).allowed) return unreadablePlacement(placement, asset.kind, reason, tracks);
    const visible = project(asset, VISIBLE_MEDIA_ASSET_FIELDS);
    const renditions: ContentRenditionView[] = visible.renditions.map((rendition) => ({ renditionId: rendition.renditionId, purpose: rendition.purpose, mimeType: rendition.mimeType, path: renditionPath(visible.assetId, rendition.renditionId) }));
    const main = renditions.some((rendition) => rendition.purpose === mainRenditionPurpose(visible.kind));
    const ready = main && serving === "served";
    const { placementId, assetId, sectionElement, position, altText, caption, credit } = placement;
    return { placementId, assetId, kind: visible.kind, sectionElement, position, altText, caption, credit, state: ready ? "ready" : "unavailable", reason: ready ? null : reason, renditions, captionTracks: tracks };
  });
}
function unreadablePlacement(placement: MediaPlacementRecord, kind: MediaAssetKind, reason: MediaStateReason, tracks: readonly ContentCaptionTrackRecord[]): ContentPlacementView {
  return { placementId: placement.placementId, assetId: placement.assetId, kind, sectionElement: placement.sectionElement, position: placement.position, altText: placement.altText, caption: placement.caption, credit: placement.credit, state: "unavailable", reason, renditions: [], captionTracks: tracks };
}
type RevisionRender = { readonly status: "rendered"; readonly html: string; readonly document: ContentDocumentJson } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
// The key each rendition of one placement travels under: the main rendition keeps the placement's own identity and each ancillary purpose gets a key of its own, so a poster, a caption track and a transcript can never stand in for one another.
const renditionKeys = (placementId: string): Readonly<Record<RenderRenditionPurpose, string>> => ({ display: placementId, playback: placementId, poster: `${placementId}:poster`, captions: `${placementId}:captions`, transcript: `${placementId}:transcript` });
function renderRevision(body: unknown, placements: readonly ContentPlacementView[]): RevisionRender {
  const renderedPlacements: RenderMediaPlacement[] = [];
  const renditions: Record<string, RenderRendition> = {};
  for (const placement of placements) {
    const captionTrack = placement.captionTracks.find((track) => track.isDefault) ?? placement.captionTracks[0];
    const keys = renditionKeys(placement.placementId);
    // Only a placement the media source serves reaches the renderer with rendition addresses: an unavailable placement carries none, so the single renderer states its text alternative and caption in the place of a player, and the preview's own rendition list stays empty for it.
    if (placement.state === "ready") {
      for (const rendition of placement.renditions) {
        const purpose = asRenderPurpose(rendition.purpose);
        renditions[keys[purpose]] = { src: rendition.path, purpose };
      }
    }
    renderedPlacements.push({
      placementId: placement.placementId,
      kind: placement.kind,
      altText: placement.altText,
      ...(placement.caption === null ? {} : { caption: placement.caption }),
      ...(placement.sectionElement === null ? {} : { sectionElement: placement.sectionElement }),
      ...(hasRendition(placement, "poster") ? { posterId: keys.poster } : {}),
      ...(hasRendition(placement, "captions") ? { captionsId: keys.captions } : {}),
      ...(hasRendition(placement, "transcript") ? { transcriptId: keys.transcript } : {}),
      ...(captionTrack === undefined ? {} : { captionsLanguage: captionTrack.language, captionsLabel: captionTrack.label }),
    });
  }
  const rendered = renderToHtml(body, { media: "inline", placements: renderedPlacements, renditions: renditions as RenderRenditions });
  if (rendered.status === "invalid") return { status: "invalid", issues: rendered.issues };
  const parsed = parseDocument(body);
  return parsed.status === "invalid" ? { status: "invalid", issues: parsed.issues } : { status: "rendered", html: rendered.html, document: parsed.document };
}
const hasRendition = (placement: ContentPlacementView, purpose: MediaRenditionPurpose): boolean => placement.renditions.some((rendition) => rendition.purpose === purpose);
export type ContentTranslationView =
  | { readonly status: "none" }
  | { readonly status: "fresh"; readonly sourceRevisionId: string; readonly sourceUpdatedAt: string }
  | { readonly status: "stale"; readonly sourceRevisionId: string; readonly sourceUpdatedAt: string; readonly translatedFromRevisionId: string }
  | { readonly status: "unresolved"; readonly translatedFromRevisionId: string };
function translationViewOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike): ContentTranslationView {
  const recorded = variant.translationSource;
  if (recorded === null) return { status: "none" };
  const sourceVariant = findVariant(state, recorded.variantId);
  const sourceRevision = sourceVariant === undefined ? undefined : currentRevisionOf(state, sourceVariant);
  if (sourceVariant === undefined || sourceRevision === undefined) return { status: "unresolved", translatedFromRevisionId: recorded.revisionId };
  const parsed = parseDocument(sourceRevision.body);
  if (parsed.status === "invalid") return { status: "unresolved", translatedFromRevisionId: recorded.revisionId };
  const staleness: TranslationStaleness = translationStaleness(contentVariantOf(variant), { sourceVariant: contentVariantOf(sourceVariant), sourceRevision: contentRevisionOf(sourceRevision, parsed.document) });
  switch (staleness.status) {
    case "none":
      return { status: "none" };
    case "fresh":
      return { status: "fresh", sourceRevisionId: staleness.sourceRevisionId, sourceUpdatedAt: staleness.sourceUpdatedAt.toString() };
    case "stale":
      return { status: "stale", sourceRevisionId: staleness.sourceRevisionId, sourceUpdatedAt: staleness.sourceUpdatedAt.toString(), translatedFromRevisionId: staleness.translatedFromRevisionId };
  }
  return assertNever(staleness);
}
function currentRevisionOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike): StoredContentRevision | undefined {
  if (variant.draftRevisionId !== null) return findRevision(state, variant.draftRevisionId);
  const head = headReleaseOf(state, variant);
  return head === undefined ? undefined : findRevision(state, head.revisionId);
}
/** The frozen candidate one edition holds, as a release surface reads it: the exact revision the candidate froze with its checksum, and whether the submission that froze it asked for a notice — the fact no release surface can state or choose a mode without, because `publishVariants` refuses a mode the submission never asked for. */
export type ContentEditionCandidateView = { readonly candidateId: string; readonly revisionId: string; readonly contentChecksum: string; readonly notifyAdmitted: boolean; readonly notifyRefusal?: string };
export type ContentEditionView = { readonly variantId: string; readonly audience: ContentAudience; readonly locale: ContentLocale; readonly draftRevisionId: string | null } & {
  readonly candidateId: string | null;
  readonly candidate: ContentEditionCandidateView | null;
  readonly releaseHeadId: string | null;
  readonly recordRevision: string;
} & { readonly headRelease: Release | null; readonly reach: ReachMetadata | null; readonly lastReleaseAt: string | null } & { readonly translation: ContentTranslationView };
function editionViewOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike, checksums: RevisionChecksums): ContentEditionView {
  const releases = releasesOfVariant(state, variant.variantId);
  const head = headReleaseOf(state, variant);
  const newest = newestReleaseOf(releases);
  return {
    variantId: variant.variantId,
    audience: variant.audience,
    locale: localeOf(variant.locale, variant.direction),
    draftRevisionId: variant.draftRevisionId,
    candidateId: variant.candidateId,
    candidate: candidateViewOf(state, variant),
    releaseHeadId: variant.releaseHeadId,
    recordRevision: variant.revision,
    headRelease: head === undefined ? null : releaseOf(head, checksums),
    reach: head === undefined ? null : reachMetadata({ reach: head.reach, withdrawnAt: head.withdrawnAt }),
    lastReleaseAt: newest === undefined ? null : newest.publishedAt,
    translation: translationViewOf(state, variant),
  };
}
export type ContentDocumentView = { readonly documentId: string; readonly family: ContentFamily; readonly kind: ContentKind; readonly siteId: string } & { readonly sourceSubject: SourceReference; readonly givingBinding: { readonly designation: SourceReference; readonly label: string } | null } & {
  readonly managedFieldKeys: readonly string[];
  readonly recordRevision: string;
};
function documentViewOf(record: ContentDocumentRecord): ContentDocumentView {
  const { documentId, family, kind, siteId, sourceSubject } = record;
  return { documentId, family, kind, siteId, sourceSubject, givingBinding: record.givingBinding === null ? null : { designation: record.givingBinding.designation, label: record.givingBinding.label }, managedFieldKeys: [...record.managedFields], recordRevision: record.revision };
}
/** The identity every edition read states about one stored edition, so each read names it once rather than restating the same four fields. */
export type EditionSubject = { readonly document: ContentDocumentView; readonly variant: ContentVariant; readonly audience: ContentAudience; readonly locale: ContentLocale };
const subjectOf = (record: ContentVariantRecordLike, documentRecord: ContentDocumentRecord): EditionSubject => ({ document: documentViewOf(documentRecord), variant: contentVariantOf(record), audience: record.audience, locale: localeOf(record.locale, record.direction) });
/** One edition by the identity a read names, with the document it belongs to and the subject both are stated as; nothing when no edition of this workspace holds that identity. */
type EditionResolution = { readonly record: ContentVariantRecordLike; readonly documentRecord: ContentDocumentRecord; readonly subject: EditionSubject };
function editionOf(state: ContentWorkspaceState, variantId: string): EditionResolution | undefined {
  const record = isNonEmptyString(variantId) ? findVariant(state, variantId) : undefined;
  const documentRecord = record === undefined ? undefined : findDocument(state, record.documentId);
  return record === undefined || documentRecord === undefined ? undefined : { record, documentRecord, subject: subjectOf(record, documentRecord) };
}
export type ContentPresentationChoices = typeof PRESENTATION_CHOICES;
// The comparison is between identities, never the presence of a release head: a candidate's identity is the exact revision it froze, so an edition that already published an earlier revision still holds a candidate no release has answered, and only a candidate the head already publishes exactly is answered.
const isCandidateAwaitingRelease = (candidateId: string | null, headRevisionId: string | null): boolean => candidateId !== null && candidateId !== headRevisionId;
const headRevisionIdOf = (state: ContentWorkspaceState, variant: ContentVariantRecordLike): string | null => headReleaseOf(state, variant)?.revisionId ?? null;
export type VariantOverviewData = { readonly document: ContentDocumentView; readonly audiences: readonly ContentAudience[]; readonly editions: readonly ContentEditionView[]; readonly awaitingRelease: readonly string[] };
/** Reads the variant matrix of one document: every edition with its audience, exact locale, three independent pointers, head release and translation state. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readVariantOverview(input: { readonly documentId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<VariantOverviewData>>> {
  const opened = await openContentWorkspace("readVariantOverview", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  if (!isNonEmptyString(input.documentId)) return deniedRead("no-permission");
  const document = findDocument(workspace.state, input.documentId);
  if (document === undefined) return deniedRead("no-permission");
  const checksums = checksumsOf(workspace.state);
  const variants = variantsOf(workspace.state, document.documentId);
  const editions = variants.map((variant) => editionViewOf(workspace.state, variant, checksums));
  const awaitingRelease = variants.filter((variant) => isCandidateAwaitingRelease(variant.candidateId, headRevisionIdOf(workspace.state, variant))).map((variant) => variant.variantId);
  const data: VariantOverviewData = { document: documentViewOf(document), audiences: admittedAudiences(document.family), editions, awaitingRelease };
  const hasDraft = editions.some((edition) => edition.draftRevisionId !== null);
  const hasCandidate = editions.some((edition) => edition.candidateId !== null);
  const actions: readonly ReadAction[] = [
    { name: "create-variant", available: true },
    readAction("open-draft", hasDraft, "No edition of this document has a saved draft yet."),
    readAction("review-candidate", awaitingRelease.length > 0, "No edition of this document holds a frozen candidate waiting for a release."),
    readAction("publish-variants", hasCandidate, "Only a frozen candidate can be published; no edition has one."),
  ];
  return respond(workspace, document.documentId, document.revision, data, { editions: editions.length === 0 ? "zero" : "value", awaitingRelease: awaitingRelease.length === 0 ? "zero" : "value" }, actions);
}
export type ContentDocumentTitleView = { readonly status: "stated"; readonly variantId: string; readonly title: string } | { readonly status: "unstated" };
export type ContentDocumentIndexEntry = { readonly document: ContentDocumentView; readonly title: ContentDocumentTitleView; readonly editions: readonly ContentEditionView[]; readonly awaitingRelease: readonly string[] };
/** One listed row of the content index: one edition of one listed document, because that is the grain both surfaces present — the Updates roster states one row per edition — and a window counted in documents would answer with a page of rows nobody asked for. */
type ContentDocumentIndexRow = { readonly record: ContentDocumentRecord; readonly variant: ContentVariantRecordLike };
type ListedContentDocument = { readonly record: ContentDocumentRecord; readonly variants: readonly ContentVariantRecordLike[] };
export type ContentDocumentIndexData = { readonly families: readonly ContentFamily[]; readonly documents: readonly ContentDocumentIndexEntry[]; readonly page: PageWindow };
export type ContentDocumentIndexQuery = { readonly families?: readonly ContentFamily[]; readonly page?: number; readonly pageSize?: number; readonly session?: SessionSource };
const listedFamiliesOf = (requested: readonly ContentFamily[] | undefined): readonly ContentFamily[] => (requested === undefined ? VARIANT_FAMILIES : VARIANT_FAMILIES.filter((family) => requested.includes(family)));
// The page number a caller's request states, or the first page: a value that is not a whole page number is not one this read can answer with.
const pageOf = (requested: number | undefined): number => (requested !== undefined && Number.isSafeInteger(requested) && requested >= 1 ? requested : 1);
/** One listed document as a page of the index states it: the whole entry when the page carries every one of its editions, and otherwise the entry narrowed to the editions that page carries and to their awaiting-release state, so a row is never listed twice and an entry never states an edition it does not carry. */
function pageEntryOf(whole: ContentDocumentIndexEntry, listedVariantIds: ReadonlySet<string>): ContentDocumentIndexEntry {
  return whole.editions.length === listedVariantIds.size ? whole : { ...whole, editions: whole.editions.filter((edition) => listedVariantIds.has(edition.variantId)), awaitingRelease: whole.awaitingRelease.filter((variantId) => listedVariantIds.has(variantId)) };
}
function collectionRevisionOf(listed: readonly ListedContentDocument[]): string {
  return `content-documents/${String(listed.length)}/${digest(
    listed
      .map(({ record }) => `${record.documentId}@${record.revision}`)
      .toSorted(compareCodeUnits)
      .join("\u0000"),
  )}`;
}
function titleOf(state: ContentWorkspaceState, variants: readonly ContentVariantRecordLike[]): ContentDocumentTitleView {
  for (const variant of variants) {
    const revision = currentRevisionOf(state, variant);
    if (revision !== undefined) return { status: "stated", variantId: variant.variantId, title: revision.sharePresentation.title };
  }
  return { status: "unstated" };
}
function indexEntryOf(state: ContentWorkspaceState, record: ContentDocumentRecord, checksums: RevisionChecksums): ContentDocumentIndexEntry {
  const variants = variantsOf(state, record.documentId);
  const editions = variants.map((variant) => editionViewOf(state, variant, checksums));
  return { document: documentViewOf(record), title: titleOf(state, variants), editions, awaitingRelease: variants.filter((variant) => isCandidateAwaitingRelease(variant.candidateId, headRevisionIdOf(state, variant))).map((variant) => variant.variantId) };
}
// The actions are computed across every edition of every listed document — the whole authorised result, never the page on show, so a page holding no candidate cannot withdraw an action the collection really admits.
function indexActions(state: ContentWorkspaceState, rows: readonly ContentDocumentIndexRow[]): readonly ReadAction[] {
  const hasDraft = rows.some((row) => row.variant.draftRevisionId !== null);
  const awaitingRelease = rows.filter((row) => isCandidateAwaitingRelease(row.variant.candidateId, headRevisionIdOf(state, row.variant))).length;
  const hasCandidate = rows.some((row) => row.variant.candidateId !== null);
  return [
    readAction("open-draft", hasDraft, "No edition of the listed documents has a saved draft yet."),
    readAction("review-candidate", awaitingRelease > 0, "No edition of the listed documents holds a frozen candidate waiting for a release."),
    readAction("publish-variants", hasCandidate, "Only a frozen candidate can be published; no edition of the listed documents has one."),
  ];
}
/** Lists the content documents of the requested families — every family when none is named — each with its title, its editions' own draft, candidate and release state, and the editions waiting for a release. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read content and `unavailable` when the records cannot be read. */
export async function findContentDocuments(query: ContentDocumentIndexQuery = {}): Promise<ReadResult<ReadEnvelope<ContentDocumentIndexData>>> {
  const opened = await openContentWorkspace("findContentDocuments", query.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  const families = listedFamiliesOf(query.families);
  const wanted = new Set<ContentFamily>(families);
  const checksums = checksumsOf(workspace.state);
  const listed: readonly ListedContentDocument[] = workspace.state.contentDocuments
    .filter((record) => wanted.has(record.family))
    .toSorted((left, right) => compareCodeUnits(left.documentId, right.documentId))
    .map((record) => ({ record, variants: variantsOf(workspace.state, record.documentId) }));
  const rows: readonly ContentDocumentIndexRow[] = listed.flatMap(({ record, variants }) => variants.map((variant) => ({ record, variant })));
  // A caller that states no window is answered with the whole listed collection as its one page: the Pages index reads every admitted Page in one answer, and a window applied to a surface that states none would drop rows from a list whose pager nobody asked for.
  const windowed = query.page !== undefined || query.pageSize !== undefined;
  const pageSize = windowed ? clampPageSize(query.pageSize) : Math.max(1, rows.length);
  const page = windowed ? pageOf(query.page) : 1;
  const pageCount = rows.length === 0 ? 0 : Math.ceil(rows.length / pageSize);
  const offset = (page - 1) * pageSize;
  const carried = rows.slice(offset, offset + pageSize);
  const editionsByDocument = new Map<string, Set<string>>();
  for (const { record, variant } of carried) {
    const carriedIds = editionsByDocument.get(record.documentId);
    if (carriedIds === undefined) editionsByDocument.set(record.documentId, new Set([variant.variantId]));
    else carriedIds.add(variant.variantId);
  }
  const documents = listed.flatMap(({ record }) => {
    const carriedIds = editionsByDocument.get(record.documentId);
    // A document whose every edition falls outside this page is not on it: the page lists the rows it carries and no entry for a row it does not.
    return carriedIds === undefined ? [] : [pageEntryOf(indexEntryOf(workspace.state, record, checksums), carriedIds)];
  });
  const data: ContentDocumentIndexData = { families, documents, page: { page, pageSize, total: rows.length, pageCount } };
  // `documents` states whether the whole listed collection holds any document at all rather than how many rows this page carries, and `page.total` the whole-result row count, so a page beyond the last states its own zero without claiming the collection is empty.
  return respond(workspace, CONTENT_SOURCE_REFERENCE, collectionRevisionOf(listed), data, { documents: listed.length === 0 ? "zero" : "value", "page.total": rows.length === 0 ? "zero" : "value" }, indexActions(workspace.state, rows));
}
export type ContentDraftData =
  | (EditionSubject & { readonly status: "draft"; readonly revision: ContentRevision; readonly recordRevision: string; readonly renderedHtml: string; readonly placements: readonly ContentPlacementView[]; readonly captionTracks: readonly ContentCaptionTrackRecord[]; readonly translation: ContentTranslationView })
  | (EditionSubject & { readonly status: "no-draft"; readonly recordRevision: string; readonly translation: ContentTranslationView })
  | (EditionSubject & { readonly status: "invalid"; readonly revisionId: string; readonly recordRevision: string; readonly issues: readonly DocumentIssue[] });
/** Reads one edition's working revision: its stored body, its sections, its placements with their opaque rendition identities, its rendered HTML, and the record revision a save must present. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readDraft(input: { readonly variantId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<ContentDraftData>>> {
  const opened = await openContentWorkspace("readDraft", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  const identified = editionOf(workspace.state, input.variantId);
  if (identified === undefined) return deniedRead("no-permission");
  const { record, documentRecord, subject } = identified;
  const translation = translationViewOf(workspace.state, record);
  const pointer = record.draftRevisionId;
  if (pointer === null) {
    const data: ContentDraftData = { status: "no-draft", ...subject, recordRevision: record.revision, translation };
    const actions: readonly ReadAction[] = [
      { name: "save-draft", available: true },
      { name: "submit-for-review", available: false, reason: "There is no saved draft to submit yet." },
    ];
    return respond(workspace, documentRecord.documentId, record.revision, data, { sections: "zero", placements: "zero" }, actions);
  }
  const revision = findRevision(workspace.state, pointer);
  if (revision === undefined) {
    const data: ContentDraftData = { status: "invalid", ...subject, revisionId: pointer, recordRevision: record.revision, issues: [{ path: "revisionId", message: "The draft this edition points at is not in the store, so no content can be shown for it." }] };
    return respond(workspace, documentRecord.documentId, record.revision, data, { sections: "unknown", placements: "unknown" }, [{ name: "save-draft", available: true, reason: "A save replaces the broken draft pointer with a new revision of this edition." }]);
  }
  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  const rendered = renderRevision(revision.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentDraftData = { status: "invalid", ...subject, revisionId: revision.revisionId, recordRevision: record.revision, issues: rendered.issues };
    return respond(workspace, documentRecord.documentId, record.revision, data, { sections: "unknown", placements: "unknown" }, [{ name: "save-draft", available: true, reason: "A fresh save writes an admitted document and replaces the unreadable revision." }]);
  }
  const data: ContentDraftData = { status: "draft", ...subject, revision: contentRevisionOf(revision, rendered.document), recordRevision: record.revision, renderedHtml: rendered.html, placements, captionTracks: revision.captions, translation };
  const actions: readonly ReadAction[] = [
    { name: "save-draft", available: true },
    { name: "submit-for-review", available: true },
    { name: "restore-revision-as-draft", available: true },
    { name: "preview-revision", available: true },
  ];
  return respond(workspace, documentRecord.documentId, record.revision, data, { sections: rendered.document.sections.length === 0 ? "zero" : "value", placements: placements.length === 0 ? "zero" : "value", captionTracks: revision.captions.length === 0 ? "zero" : "value" }, actions);
}
export type CandidateSectionChange = { readonly position: number; readonly element: string; readonly change: "added" | "removed" | "changed" };
export type CandidatePlacementChange = { readonly placementId: string; readonly assetId: string; readonly change: "added" | "removed" | "changed" };
export type CandidateDiffView = { readonly against: { readonly releaseId: string; readonly revisionId: string; readonly contentChecksum: string } | null } & { readonly unchanged: boolean; readonly proseChanged: boolean; readonly directionChanged: boolean } & {
  readonly sections: readonly CandidateSectionChange[];
  readonly placements: readonly CandidatePlacementChange[];
};
export interface CandidateDecisionRecord {
  readonly decision: ReviewDecision;
  readonly decidedByPrincipalId: string | null;
  // Whether the recorded principal is the author of the frozen revision this answer was given to: the one fact that separates an author's own answer from an independent reviewer's, derived here so no surface compares principals.
  readonly decidedByAuthor: boolean;
  readonly decidedAt: string | null;
  readonly note: string | null;
}
export type ContentCandidateData =
  | (EditionSubject & {
      readonly status: "reviewable";
      readonly candidate: ContentCandidate;
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly diff: CandidateDiffView;
      readonly headRelease: Release | null;
      readonly review: {
        readonly steps: typeof REVIEW_STEPS_PER_CANDIDATE;
        readonly round: typeof REVIEW_STEPS_PER_CANDIDATE;
        readonly decision: ReviewDecision | null;
        readonly recorded: CandidateDecisionRecord | null;
        // The release mode the same record states, in the vocabulary the review mutations store: `publish-and-notify` is the only value that asks for a notice, and a reviewer cannot change it.
        readonly notifyMode: SubmittedReleaseMode | null;
        // Whether the principal reading this candidate wrote the revision it froze, stated as a fact about the two identities rather than as an authority: an author's own answer is recorded exactly as any other, naming the principal who gave it.
        readonly reviewedByAuthor: boolean;
        readonly approvalScope: "this-variant-only";
      };
      readonly recordRevision: string;
    })
  | (EditionSubject & { readonly status: "none"; readonly recordRevision: string })
  | (EditionSubject & { readonly status: "invalid"; readonly candidateId: string; readonly issues: readonly DocumentIssue[]; readonly recordRevision: string })
  | (EditionSubject & { readonly status: "unavailable"; readonly candidateId: string; readonly reason: string; readonly recordRevision: string });
/** Reads the candidate frozen for one edition: the exact revision it froze, its rendered HTML, the difference from the current release and the single review step it may receive. */
export async function readCandidate(input: { readonly variantId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<ContentCandidateData>>> {
  const opened = await openContentWorkspace("readCandidate", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  const resolution = isNonEmptyString(input.variantId) ? resolveCandidateIdentity(workspace.state, input.variantId) : undefined;
  const documentRecord = resolution === undefined ? undefined : findDocument(workspace.state, resolution.record.documentId);
  if (resolution === undefined || documentRecord === undefined) return deniedRead("no-permission");
  const { record } = resolution;
  const subject = subjectOf(record, documentRecord);
  const candidateId = resolution.candidateId;
  if (candidateId === null) {
    const data: ContentCandidateData = { status: "none", ...subject, recordRevision: record.revision };
    return respond(workspace, documentRecord.documentId, record.revision, data, { changedSections: "zero", changedPlacements: "zero" }, [{ name: "submit-for-review", available: true, reason: "A submitted revision becomes the candidate a reviewer answers." }]);
  }
  const frozen = findRevision(workspace.state, candidateId);
  if (frozen === undefined) {
    const data: ContentCandidateData = { status: "unavailable", ...subject, candidateId, reason: "The candidate this edition holds names a revision that is not in the store, so what the reviewer would approve cannot be shown.", recordRevision: record.revision };
    return respond(workspace, documentRecord.documentId, record.revision, data, { changedSections: "unavailable", changedPlacements: "unavailable" }, [{ name: "submit-for-review", available: true, reason: "A fresh submission replaces the candidate that cannot be resolved." }]);
  }
  const placements = placementViews(workspace, frozen.mediaPlacements, frozen.captions);
  const rendered = renderRevision(frozen.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentCandidateData = { status: "invalid", ...subject, candidateId, issues: rendered.issues, recordRevision: record.revision };
    return respond(workspace, documentRecord.documentId, record.revision, data, { changedSections: "unknown", changedPlacements: "unknown" }, [{ name: "request-changes", available: true, reason: "The frozen revision cannot be approved as it stands." }]);
  }
  const checksums = checksumsOf(workspace.state);
  const head = headReleaseOf(workspace.state, record);
  const headRevision = head === undefined ? undefined : findRevision(workspace.state, head.revisionId);
  const headDocument = headRevision === undefined ? undefined : parseDocument(headRevision.body);
  const releaseDocument = headDocument !== undefined && headDocument.status === "valid" ? headDocument.document : undefined;
  const diff = candidateDiff({
    candidate: rendered.document,
    candidateChecksum: frozen.contentChecksum,
    release: releaseDocument,
    releaseChecksum: head === undefined ? undefined : checksums.get(head.revisionId),
    head,
    candidatePlacements: frozen.mediaPlacements,
    releasePlacements: headRevision === undefined ? [] : headRevision.mediaPlacements,
  });
  const reviewRecord = workspace.state.contentReviews.find((candidate) => candidate.candidateId === candidateId);
  const decision = recordedDecisionOf(reviewRecord);
  const data: ContentCandidateData = {
    status: "reviewable",
    ...subject,
    candidate: { candidateId, variantId: frozen.variantId, revisionId: frozen.revisionId, contentChecksum: frozen.contentChecksum, frozenAt: Temporal.Instant.from(frozen.createdAt), reviewRound: REVIEW_STEPS_PER_CANDIDATE },
    revision: contentRevisionOf(frozen, rendered.document),
    renderedHtml: rendered.html,
    placements,
    diff,
    headRelease: head === undefined ? null : releaseOf(head, checksums),
    review: {
      steps: REVIEW_STEPS_PER_CANDIDATE,
      round: REVIEW_STEPS_PER_CANDIDATE,
      decision,
      recorded: recordedDecisionRecordOf(reviewRecord, frozen.authorPrincipalId),
      notifyMode: reviewRecord === undefined ? null : reviewRecord.notifyMode,
      reviewedByAuthor: frozen.authorPrincipalId === workspace.scope.principalId,
      approvalScope: "this-variant-only",
    },
    recordRevision: record.revision,
  };
  return respond(workspace, documentRecord.documentId, record.revision, data, { changedSections: diff.sections.length === 0 ? "zero" : "value", changedPlacements: diff.placements.length === 0 ? "zero" : "value" }, candidateReviewActions(reviewRecord));
}
const recordedDecisionOf = (review: ContentReviewRecord | undefined): ReviewDecision | null => (review === undefined || review.decision === "submitted" ? null : review.decision);
// The author is the frozen revision's own recorded author, so whether an answer was the author's own is a comparison the record makes against the revision it answered rather than one a surface infers.
function recordedDecisionRecordOf(review: ContentReviewRecord | undefined, authorPrincipalId: string): CandidateDecisionRecord | null {
  const decision = recordedDecisionOf(review);
  return review === undefined || decision === null ? null : { decision, decidedByPrincipalId: review.decidedByPrincipalId, decidedByAuthor: review.decidedByPrincipalId === authorPrincipalId, decidedAt: review.decidedAt, note: review.note };
}
const NO_SUBMISSION_REASON = "No submission is open for review under this identity, so reopen the edition and submit it again.";
const ALREADY_ANSWERED_REASON = "This candidate has already been answered, so a further review needs a new submission.";
const AWAITING_REVIEW_REASON = "This edition is still awaiting its one review, so it cannot be released yet.";
const CHANGES_REQUESTED_REASON = "The reviewer asked for changes, so this edition needs a new revision and a new submission.";
const REJECTED_REASON = "The reviewer rejected this submission, so it needs a new revision and a new submission.";
const PUBLISH_ONLY_REASON = "Releasing this candidate sends no message; notification is a separate decision.";
const NOTIFY_NOW_REASON = "Only a reviewer who chooses it turns a release into a notification request.";
const NOT_ASKED_FOR_REASON = "A reviewer cannot release this edition with a mode the submission did not ask for, so a new submission is required.";
type ReleaseActionOffer = { readonly name: string; readonly mode: SubmittedReleaseMode; readonly meaning: string };
const NOTIFY_NOW_OFFER: ReleaseActionOffer = { name: "publish-and-notify-now", mode: "publish-and-notify", meaning: NOTIFY_NOW_REASON };
const RELEASE_ACTION_OFFERS: readonly ReleaseActionOffer[] = [{ name: "publish-only", mode: "publish-only", meaning: PUBLISH_ONLY_REASON }, NOTIFY_NOW_OFFER];
function releaseRefusalOf(review: ContentReviewRecord | undefined, decision: ReviewDecision | null): string | null {
  if (review === undefined) return NO_SUBMISSION_REASON;
  switch (decision) {
    case "approved":
      return null;
    case null:
      return AWAITING_REVIEW_REASON;
    case "changes-requested":
      return CHANGES_REQUESTED_REASON;
    case "rejected":
      return REJECTED_REASON;
  }
}
function candidateReviewActions(review: ContentReviewRecord | undefined): readonly ReadAction[] {
  const decision = recordedDecisionOf(review);
  const answerable = review !== undefined && decision === null;
  const answerReason = review === undefined ? NO_SUBMISSION_REASON : ALREADY_ANSWERED_REASON;
  const releaseRefusal = releaseRefusalOf(review, decision);
  return [
    { name: "approve", available: answerable, ...(answerable ? {} : { reason: answerReason }) },
    { name: "request-changes", available: answerable, ...(answerable ? {} : { reason: answerReason }) },
    { name: "reject", available: answerable, ...(answerable ? {} : { reason: answerReason }) },
    ...RELEASE_ACTION_OFFERS.map((offer) => releaseActionOf(offer, review, releaseRefusal)),
  ];
}
function releaseActionOf(offer: ReleaseActionOffer, review: ContentReviewRecord | undefined, releaseRefusal: string | null): ReadAction {
  return review !== undefined && offer.mode !== review.notifyMode ? { name: offer.name, available: false, reason: NOT_ASKED_FOR_REASON } : releaseRefusal !== null ? { name: offer.name, available: false, reason: releaseRefusal } : { name: offer.name, available: true, reason: offer.meaning };
}
/** One edition's frozen candidate as a release surface reads it: the frozen revision gives the checksum and the candidate's own review record the recorded mode, and the notify fact is decided by the very action the review step offers, so no surface states a notification policy the service would refuse. */
function candidateViewOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike): ContentEditionCandidateView | null {
  const candidateId = variant.candidateId;
  if (candidateId === null) return null;
  const frozen = findRevision(state, candidateId);
  const review = state.contentReviews.find((candidate) => candidate.candidateId === candidateId);
  const notifyAction = releaseActionOf(NOTIFY_NOW_OFFER, review, releaseRefusalOf(review, recordedDecisionOf(review)));
  return { candidateId, revisionId: candidateId, contentChecksum: frozen === undefined ? "" : frozen.contentChecksum, notifyAdmitted: notifyAction.available, ...(notifyAction.available || notifyAction.reason === undefined ? {} : { notifyRefusal: notifyAction.reason }) };
}
function candidateDiff(input: {
  readonly candidate: ContentDocumentJson;
  readonly candidateChecksum: string;
  readonly release: ContentDocumentJson | undefined;
  readonly releaseChecksum: string | undefined;
  readonly head: ReleaseRecord | undefined;
  readonly candidatePlacements: readonly MediaPlacementRecord[];
  readonly releasePlacements: readonly MediaPlacementRecord[];
}): CandidateDiffView {
  const { candidate, release } = input;
  const against = input.head === undefined ? null : { releaseId: input.head.releaseId, revisionId: input.head.revisionId, contentChecksum: input.releaseChecksum ?? "" };
  if (release === undefined) return { against, unchanged: false, proseChanged: true, directionChanged: false, sections: [], placements: [] };
  const proseChanged = serialise({ ...candidate, sections: [] }) !== serialise({ ...release, sections: [] });
  const directionChanged = candidate.direction !== release.direction;
  const sections: CandidateSectionChange[] = [];
  for (let position = 0; position < Math.max(candidate.sections.length, release.sections.length); position += 1) {
    const next = candidate.sections[position];
    const previous = release.sections[position];
    if (next !== undefined && previous === undefined) {
      sections.push({ position, element: next.element, change: "added" });
      continue;
    }
    if (next === undefined && previous !== undefined) {
      sections.push({ position, element: previous.element, change: "removed" });
      continue;
    }
    if (next !== undefined && previous !== undefined) if (sectionSignature(next) !== sectionSignature(previous)) sections.push({ position, element: next.element, change: "changed" });
  }
  const placements = placementChanges(input.candidatePlacements, input.releasePlacements);
  return { against, unchanged: input.releaseChecksum !== undefined && input.releaseChecksum === input.candidateChecksum, proseChanged, directionChanged, sections, placements };
}
const sectionSignature = (section: ContentSection): string => serialise({ type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction: "ltr", content: [], sections: [section] });
function placementChanges(candidate: readonly MediaPlacementRecord[], release: readonly MediaPlacementRecord[]): readonly CandidatePlacementChange[] {
  const previous = new Map(release.map((placement) => [placement.placementId, placement]));
  const next = new Map(candidate.map((placement) => [placement.placementId, placement]));
  const changes: CandidatePlacementChange[] = [];
  for (const [placementId, placement] of next) {
    const before = previous.get(placementId);
    if (before === undefined) {
      changes.push({ placementId, assetId: placement.assetId, change: "added" });
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(placement)) changes.push({ placementId, assetId: placement.assetId, change: "changed" });
  }
  for (const [placementId, placement] of previous) if (!next.has(placementId)) changes.push({ placementId, assetId: placement.assetId, change: "removed" });
  return changes;
}
export type WithdrawnReleaseView = { readonly releaseId: string; readonly variantId: string; readonly publishedAt: string; readonly withdrawnAt: string; readonly reach: Reach; readonly recordRevision: string };
export type ContentReleaseData =
  | (EditionSubject & {
      readonly status: "released";
      readonly release: Release;
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly reach: { readonly value: Reach; readonly metadata: ReachMetadata; readonly listed: boolean; readonly directlyReadable: boolean };
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    })
  | (EditionSubject & { readonly status: "withdrawn"; readonly release: WithdrawnReleaseView; readonly tombstone: Tombstone; readonly siblingHeads: readonly ContentEditionView[]; readonly recordRevision: string })
  | (EditionSubject & { readonly status: "invalid"; readonly releaseId: string; readonly issues: readonly DocumentIssue[]; readonly siblingHeads: readonly ContentEditionView[]; readonly recordRevision: string })
  | (EditionSubject & { readonly status: "no-release"; readonly siblingHeads: readonly ContentEditionView[]; readonly recordRevision: string });
/** Reads the release standing at one edition's head, or the release a caller names from its history. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readRelease(input: { readonly variantId: string; readonly releaseId?: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<ContentReleaseData>>> {
  const opened = await openContentWorkspace("readRelease", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  const identified = editionOf(workspace.state, input.variantId);
  if (identified === undefined) return deniedRead("no-permission");
  const { record, documentRecord, subject } = identified;
  const checksums = checksumsOf(workspace.state);
  const siblingHeads = variantsOf(workspace.state, documentRecord.documentId)
    .filter((sibling) => sibling.variantId !== record.variantId)
    .map((sibling) => editionViewOf(workspace.state, sibling, checksums));
  const requestedReleaseId = input.releaseId;
  if (requestedReleaseId !== undefined && !isNonEmptyString(requestedReleaseId)) return deniedRead("no-permission");
  const named = requestedReleaseId === undefined ? headReleaseOf(workspace.state, record) : releasesOfVariant(workspace.state, record.variantId).find((release) => release.releaseId === requestedReleaseId);
  if (named === undefined) {
    const data: ContentReleaseData = { status: "no-release", ...subject, siblingHeads, recordRevision: record.revision };
    const actions: readonly ReadAction[] = [
      { name: "publish-variants", available: record.candidateId !== null, ...(record.candidateId === null ? { reason: "This edition has no frozen candidate, so there is nothing to release." } : {}) },
      { name: "set-reach", available: false, reason: "Reach is a property of a released edition, and this edition has none." },
      { name: "withdraw-release", available: false, reason: "There is no publication to withdraw." },
    ];
    return respond(workspace, documentRecord.documentId, record.revision, data, { placements: "zero", siblingHeads: siblingHeads.length === 0 ? "zero" : "value" }, actions);
  }
  if (isWithdrawnRelease(named)) {
    const withdrawnAt = named.withdrawnAt ?? "";
    const data: ContentReleaseData = {
      status: "withdrawn",
      ...subject,
      release: { releaseId: named.releaseId, variantId: named.variantId, publishedAt: named.publishedAt, withdrawnAt, reach: named.reach, recordRevision: named.revision },
      tombstone: tombstoneFor(workspace, named),
      siblingHeads,
      recordRevision: record.revision,
    };
    return respond(workspace, documentRecord.documentId, record.revision, data, { placements: "zero", siblingHeads: siblingHeads.length === 0 ? "zero" : "value" }, [
      { name: "publish-variants", available: record.candidateId !== null, ...(record.candidateId === null ? { reason: "A withdrawn edition is republished by releasing a new candidate." } : {}) },
    ]);
  }
  const revision = findRevision(workspace.state, named.revisionId);
  if (revision === undefined) {
    const data: ContentReleaseData = { status: "invalid", ...subject, releaseId: named.releaseId, issues: [{ path: "release.revisionId", message: "The revision this release published is not in the store, so what readers were given cannot be shown." }], siblingHeads, recordRevision: record.revision };
    return respond(workspace, documentRecord.documentId, record.revision, data, { placements: "unknown", siblingHeads: "value" }, [{ name: "withdraw-release", available: true }]);
  }
  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  const rendered = renderRevision(revision.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentReleaseData = { status: "invalid", ...subject, releaseId: named.releaseId, issues: rendered.issues, siblingHeads, recordRevision: record.revision };
    return respond(workspace, documentRecord.documentId, record.revision, data, { placements: "unknown", siblingHeads: "value" }, [{ name: "withdraw-release", available: true }]);
  }
  const edition = { reach: named.reach, withdrawnAt: named.withdrawnAt };
  const data: ContentReleaseData = {
    status: "released",
    ...subject,
    release: releaseOf(named, checksums),
    revision: contentRevisionOf(revision, rendered.document),
    renderedHtml: rendered.html,
    placements,
    reach: { value: named.reach, metadata: reachMetadata(edition), listed: isListedPublicly(edition), directlyReadable: isDirectlyReadable(edition) },
    siblingHeads,
    recordRevision: record.revision,
  };
  const actions: readonly ReadAction[] = [
    { name: "withdraw-release", available: true },
    { name: "set-reach", available: true },
    { name: "stop-showing-publicly", available: named.reach !== "not-public", ...(named.reach === "not-public" ? { reason: "This edition is already Not public, so it shows nowhere publicly." } : {}) },
    { name: "preview-release", available: true, reason: "A preview renders the exact released revision and starts nothing." },
  ];
  return respond(workspace, documentRecord.documentId, record.revision, data, { placements: placements.length === 0 ? "zero" : "value", siblingHeads: siblingHeads.length === 0 ? "zero" : "value" }, actions);
}
const tombstoneFor = (workspace: ContentWorkspace, record: ReleaseRecord): Tombstone => withdrawEdition(releaseOf(record, new Map<string, string>()), { at: workspace.asOf }).tombstone;
export type ContentPreviewData =
  | {
      readonly status: "authorised";
      readonly variantId: string;
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly renditionIds: readonly string[];
      /** Every placement this rendering could not reach, with its own kind, words and the source's reason, so the surface states each one as unavailable instead of showing a frame that cannot load. Empty when every placement is ready, and empty when the revision places no media at all. */
      readonly unreadyMedia: readonly ContentPlacementView[];
      readonly inert: true;
      readonly givingAction: "none";
    }
  | { readonly status: "invalid"; readonly variantId: string; readonly revisionId: string; readonly issues: readonly DocumentIssue[] }
  | { readonly status: "denied"; readonly reason: PreviewDenialReason };
function canonicalPathOf(family: ContentFamily, documentId: string, localeTag: string): string {
  switch (family) {
    case "worker-page":
    case "project-page":
      return `/preview/pages/${encodeURIComponent(documentId)}/${encodeURIComponent(localeTag)}`;
    case "update":
      return `/preview/${encodeURIComponent(documentId)}`;
  }
  return assertNever(family);
}
/** Reads an exact, currently authorised, inert preview of the revision a surface acknowledges. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPreview(input: { readonly variantId: string; readonly revisionId: string; readonly candidateId?: string; readonly requestedLocale?: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<ContentPreviewData>>> {
  const opened = await openContentWorkspace("readPreview", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId) || !isNonEmptyString(input.revisionId)) return deniedRead("no-permission");
  const identified = editionOf(workspace.state, input.variantId);
  if (identified === undefined) return deniedRead("no-permission");
  const { record, documentRecord } = identified;
  const editorialAccess = canEdit(workspace.session, { kind: "content-variant", scope: workspace.scope });
  if (!editorialAccess.allowed) return { kind: "denied", denied: editorialAccess.denial };
  const document = documentViewOf(documentRecord);
  const checksums = checksumsOf(workspace.state);
  const variant = contentVariantOf(record);
  const releases = releasesOf(workspace.state, documentRecord.documentId).map((release) => releaseOf(release, checksums));
  const acknowledgedRevision = findRevision(workspace.state, input.revisionId);
  const acknowledgedPlacements = acknowledgedRevision === undefined ? [] : placementViews(workspace, acknowledgedRevision.mediaPlacements, acknowledgedRevision.captions);
  const renditionIds = acknowledgedPlacements.flatMap((placement) => (placement.state === "ready" ? placement.renditions.filter((rendition) => PREVIEW_RENDITION_PURPOSES.includes(rendition.purpose)).map((rendition) => rendition.renditionId) : []));
  const candidate = candidateFor(workspace.state, record, input.candidateId);
  const isAuthor = acknowledgedRevision !== undefined && acknowledgedRevision.authorPrincipalId === workspace.session.principalId;
  const decision = authorisePreview({
    principal: { principalId: workspace.session.principalId },
    variant,
    acknowledgement: { revisionId: input.revisionId, ...(candidate === undefined ? {} : { candidate }) },
    requestedLocale: input.requestedLocale ?? "",
    releases,
    renditionIds,
    canReadProtected: editorialAccess.allowed,
    isAuthor,
  });
  if (decision.status === "denied") {
    const data: ContentPreviewData = { status: "denied", reason: decision.reason };
    return respond(workspace, documentRecord.documentId, record.revision, data, {}, []);
  }
  const admitted = findRevision(workspace.state, decision.revisionId);
  if (admitted === undefined) {
    const data: ContentPreviewData = { status: "invalid", variantId: record.variantId, revisionId: decision.revisionId, issues: [{ path: "revisionId", message: "The acknowledged revision is no longer in the store, so nothing can be rendered." }] };
    return respond(workspace, documentRecord.documentId, record.revision, data, { placements: "unknown" }, []);
  }
  const placements = placementViews(workspace, admitted.mediaPlacements, admitted.captions);
  const rendered = renderRevision(admitted.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentPreviewData = { status: "invalid", variantId: record.variantId, revisionId: admitted.revisionId, issues: rendered.issues };
    return respond(workspace, documentRecord.documentId, record.revision, data, { placements: "unknown" }, []);
  }
  const unreadyMedia = placements.filter((placement) => placement.state !== "ready");
  const data: ContentPreviewData = {
    status: "authorised",
    variantId: record.variantId,
    document,
    variant,
    audience: record.audience,
    locale: { tag: decision.servedLocale, direction: decision.direction },
    revision: contentRevisionOf(admitted, rendered.document),
    renderedHtml: rendered.html,
    placements,
    renditionIds: decision.renditionIds,
    unreadyMedia,
    inert: decision.inert,
    givingAction: decision.givingAction,
  };
  return respond(workspace, documentRecord.documentId, record.revision, data, { placements: placements.length === 0 ? "zero" : "value", renditionIds: decision.renditionIds.length === 0 ? "zero" : "value", unreadyMedia: unreadyMedia.length === 0 ? "zero" : "value" }, []);
}
function candidateFor(state: ContentWorkspaceState, record: ContentVariantRecordLike, candidateId: string | undefined): ContentCandidate | undefined {
  if (candidateId === undefined || !isNonEmptyString(candidateId)) return undefined;
  if (record.candidateId !== candidateId) return undefined;
  const frozen = findRevision(state, candidateId);
  return frozen === undefined || frozen.variantId !== record.variantId ? undefined : { candidateId, variantId: frozen.variantId, revisionId: frozen.revisionId, contentChecksum: frozen.contentChecksum, frozenAt: Temporal.Instant.from(frozen.createdAt), reviewRound: REVIEW_STEPS_PER_CANDIDATE };
}
export type ShareImageView = { readonly assetId: string; readonly renditionId: string | null; readonly path: string | null; readonly altText: string | null; readonly state: "ready" | "unavailable"; readonly reason: MediaStateReason | null };
export type SharePresentationData =
  | {
      readonly status: "shareable";
      readonly variantId: string;
      readonly documentId: string;
      readonly family: ContentFamily;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly title: string;
      readonly description: string;
      readonly image: ShareImageView | null;
      readonly canonicalPath: string;
      readonly robots: "noindex" | null;
    }
  | { readonly status: "withdrawn"; readonly variantId: string; readonly documentId: string; readonly canonicalPath: string; readonly tombstone: Tombstone }
  | { readonly status: "no-presentation"; readonly variantId: string; readonly documentId: string; readonly family: ContentFamily; readonly audience: ContentAudience; readonly locale: ContentLocale; readonly reason: string };
/** Reads the share card of one edition: its title, its description, its chosen share image as an opaque rendition identity, the canonical path for its family and its direction metadata. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSharePresentation(input: { readonly variantId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<SharePresentationData>>> {
  const opened = await openContentWorkspace("readSharePresentation", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  const identified = editionOf(workspace.state, input.variantId);
  if (identified === undefined) return deniedRead("no-permission");
  const { record, documentRecord } = identified;
  if (record.audience === "approved-supporter") {
    const editorialAccess = canEdit(workspace.session, { kind: "content-variant", scope: workspace.scope });
    if (!editorialAccess.allowed) return { kind: "denied", denied: editorialAccess.denial };
  }
  const family = documentRecord.family;
  const locale = localeOf(record.locale, record.direction);
  const canonicalPath = canonicalPathOf(family, documentRecord.documentId, record.locale);
  const head = headReleaseOf(workspace.state, record);
  if (head !== undefined && isWithdrawnRelease(head)) {
    const data: SharePresentationData = { status: "withdrawn", variantId: record.variantId, documentId: documentRecord.documentId, canonicalPath, tombstone: tombstoneFor(workspace, head) };
    return respond(workspace, documentRecord.documentId, record.revision, data, {}, []);
  }
  const source = head !== undefined ? findRevision(workspace.state, head.revisionId) : undefined;
  const presentationSource = source ?? (record.draftRevisionId === null ? undefined : findRevision(workspace.state, record.draftRevisionId));
  if (presentationSource === undefined) {
    const data: SharePresentationData = { status: "no-presentation", variantId: record.variantId, documentId: documentRecord.documentId, family, audience: record.audience, locale, reason: "This edition has neither a released revision nor a saved draft, so there is nothing to present." };
    return respond(workspace, documentRecord.documentId, record.revision, data, {}, []);
  }
  const share = presentationSource.sharePresentation;
  const image = shareImageView(workspace, share);
  const reach = head === undefined ? undefined : reachMetadata({ reach: head.reach, withdrawnAt: head.withdrawnAt });
  const data: SharePresentationData = { status: "shareable", variantId: record.variantId, documentId: documentRecord.documentId, family, audience: record.audience, locale, title: share.title, description: share.description, image, canonicalPath, robots: reach?.robots ?? null };
  return respond(workspace, documentRecord.documentId, record.revision, data, { image: image === null ? "zero" : image.state === "ready" ? "value" : "unavailable" }, [{ name: "open-canonical-address", available: true }]);
}
function shareImageView(workspace: ContentWorkspace, share: SharePresentationRecord): ShareImageView | null {
  if (share.imageAssetId === null) return null;
  const asset = workspace.state.mediaAssets.find((candidate) => candidate.assetId === share.imageAssetId);
  const unavailable: ShareImageView = { assetId: share.imageAssetId, renditionId: null, path: null, altText: share.imageAltText, state: "unavailable", reason: mediaStateReason("unavailable") };
  if (asset === undefined) return unavailable;
  if (!canView(workspace.session, { kind: "media-asset", scope: asset.scope }).allowed) return unavailable;
  const visible = project(asset, VISIBLE_MEDIA_ASSET_FIELDS);
  const display = visible.renditions.find((rendition) => rendition.purpose === mainRenditionPurpose(visible.kind));
  return display === undefined ? unavailable : { assetId: visible.assetId, renditionId: display.renditionId, path: renditionPath(visible.assetId, display.renditionId), altText: share.imageAltText, state: "ready", reason: null };
}
const PAGE_CATALOGUE_REVISION = "page-catalogue-1";
const SECTION_FIELD_KEYS: Readonly<Record<PageSectionType, readonly string[]>> = {
  introduction: ["heading", "body"],
  story: ["heading", "body"],
  prayer: ["heading", "body"],
  milestone: ["heading", "date", "body"],
  image: ["altText", "caption", "credit"],
  video: ["altText", "caption", "credit", "language"],
  giving: [],
  progress: [],
};
const MANAGED_SECTION_TYPES: ReadonlySet<string> = new Set<string>(["giving", "progress"]);
const SECTION_LOCK_REASON_KEYS: Readonly<Record<string, string>> = { giving: "giving-binding", progress: "support-progress" };
const MANAGED_FIELD_LOCK_REASON_KEYS: Readonly<Record<string, string>> = { title: "page-subject", givingBinding: "giving-binding", legalIdentity: "legal-identity", supportProgress: "support-progress" };
const SOURCE_SUPPLIED_LOCK_REASON_KEY = "source-supplied-section";
const PAGE_FAMILIES = ["worker-page", "project-page"] as const;
const PAGE_STRUCTURAL_OPERATIONS = ["add", "move-up", "move-down", "move-to-position", "duplicate", "remove"] as const;
export type PageStructuralOperation = (typeof PAGE_STRUCTURAL_OPERATIONS)[number];
export type PagePresetView = { readonly presetId: string; readonly sections: readonly PageSectionType[]; readonly creates: "reviewable-draft" };
const PAGE_PRESETS: readonly PagePresetView[] = [
  { presetId: "preset-opening-and-story", sections: ["introduction", "story"], creates: "reviewable-draft" },
  { presetId: "preset-story-and-prayer", sections: ["story", "prayer"], creates: "reviewable-draft" },
];
export type PageCatalogueSectionView = { readonly key: PageSectionType; readonly labelKey: string; readonly managed: boolean; readonly lockReasonKey: string | null; readonly fields: readonly string[]; readonly presentation: ContentPresentationChoices };
export type PageCatalogueView = { readonly family: ContentFamily; readonly labelKey: string; readonly sections: readonly PageCatalogueSectionView[] };
export type PageCataloguesData = { readonly catalogues: readonly PageCatalogueView[]; readonly presentation: ContentPresentationChoices; readonly structuralOperations: readonly PageStructuralOperation[]; readonly presets: readonly PagePresetView[] };
/** Reads the two guided family catalogues: the eight admitted section types each offers, the fields and presentation choices each admits, which are managed and why, the structural operations. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPageCatalogues(input: { readonly session?: SessionSource } = {}): Promise<ReadResult<ReadEnvelope<PageCataloguesData>>> {
  const opened = await openContentWorkspace("readPageCatalogues", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  const sections: readonly PageCatalogueSectionView[] = PAGE_SECTION_TYPES.map((key) => ({ key, labelKey: `catalogue.${key}`, managed: MANAGED_SECTION_TYPES.has(key), lockReasonKey: SECTION_LOCK_REASON_KEYS[key] ?? null, fields: SECTION_FIELD_KEYS[key], presentation: PRESENTATION_CHOICES }));
  const data: PageCataloguesData = { catalogues: PAGE_FAMILIES.map((family) => ({ family, labelKey: `catalogue.family.${family}`, sections })), presentation: PRESENTATION_CHOICES, structuralOperations: PAGE_STRUCTURAL_OPERATIONS, presets: PAGE_PRESETS };
  return respond(workspace, "page-catalogues", PAGE_CATALOGUE_REVISION, data, { catalogues: "value", sectionTypes: "value", presets: PAGE_PRESETS.length === 0 ? "zero" : "value" }, [{ name: "add-section", available: true }]);
}
export type PageManagedFieldView = { readonly key: string; readonly locked: true; readonly lockReasonKey: string };
export type PageSectionView = { readonly position: number; readonly element: string; readonly inCatalogue: boolean; readonly managed: boolean } & { readonly lockReasonKey: string | null; readonly fields: Readonly<Record<string, string>>; readonly presentation: PresentationChoice } & {
  readonly direction: string | null;
  readonly placements: readonly ContentPlacementView[];
};
export type PageDocumentData = { readonly document: ContentDocumentView; readonly family: ContentFamily; readonly kind: ContentKind } & { readonly managedFields: readonly PageManagedFieldView[] } & { readonly givingBinding: { readonly designation: SourceReference; readonly label: string } | null } & {
  readonly draft: { readonly variantId: string; readonly revisionId: string; readonly recordRevision: string } | null;
} & { readonly sections: readonly PageSectionView[]; readonly presets: readonly PagePresetView[]; readonly editions: readonly ContentEditionView[] } & { readonly reachOptions: readonly Reach[] };
/** Reads one Page: its family and kind, the fields a source locks with the reason for each, its giving binding, the ordered sections of the edition being composed, the presets, every locale. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPage(input: { readonly pageId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<PageDocumentData>>> {
  const opened = await openContentWorkspace("readPage", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  if (!isNonEmptyString(input.pageId)) return deniedRead("no-permission");
  const documentRecord = findDocument(workspace.state, input.pageId);
  if (documentRecord === undefined || documentRecord.family === "update") return deniedRead("no-permission");
  const checksums = checksumsOf(workspace.state);
  const variantRecords = variantsOf(workspace.state, documentRecord.documentId);
  const editions = variantRecords.map((variant) => editionViewOf(workspace.state, variant, checksums));
  const draftVariant = variantRecords.find((variant) => variant.draftRevisionId !== null) ?? variantRecords[0];
  const draftRevision = draftVariant === undefined || draftVariant.draftRevisionId === null ? undefined : findRevision(workspace.state, draftVariant.draftRevisionId);
  const parsedDraft = draftRevision === undefined ? undefined : parseDocument(draftRevision.body);
  const sections = draftRevision !== undefined && parsedDraft !== undefined && parsedDraft.status === "valid" ? sectionViewsOf(workspace, parsedDraft.document, draftRevision) : [];
  const data: PageDocumentData = {
    document: documentViewOf(documentRecord),
    family: documentRecord.family,
    kind: documentRecord.kind,
    managedFields: documentRecord.managedFields.map((key) => ({ key, locked: true, lockReasonKey: MANAGED_FIELD_LOCK_REASON_KEYS[key] ?? SOURCE_SUPPLIED_LOCK_REASON_KEY })),
    givingBinding: documentRecord.givingBinding === null ? null : { designation: documentRecord.givingBinding.designation, label: documentRecord.givingBinding.label },
    draft: draftVariant === undefined || draftVariant.draftRevisionId === null ? null : { variantId: draftVariant.variantId, revisionId: draftVariant.draftRevisionId, recordRevision: draftVariant.revision },
    sections,
    presets: PAGE_PRESETS,
    editions,
    reachOptions: REACH_VALUES,
  };
  const hasOrder = sections.length > 1;
  const hasSection = sections.length > 0;
  const hasCandidate = editions.some((edition) => edition.candidateId !== null);
  const hasRelease = editions.some((edition) => edition.releaseHeadId !== null);
  const showsPublicly = editions.some((edition) => edition.headRelease !== null && edition.headRelease.reach !== "not-public");
  const actions: readonly ReadAction[] = [
    { name: "add-section", available: true },
    readAction("move-section-up", hasOrder, "A single section has no order to change."),
    readAction("move-section-down", hasOrder, "A single section has no order to change."),
    readAction("move-section-to-position", hasOrder, "A single section has no position to move to."),
    readAction("duplicate-section", hasSection, "There is no section to duplicate yet."),
    readAction("remove-section", hasSection, "There is no section to remove yet."),
    readAction("save-section-fields", hasSection, "There is no section whose fields could be saved."),
    { name: "apply-preset", available: true },
    { name: "save-draft", available: true },
    { name: "submit-for-review", available: true },
    readAction("publish-variants", hasCandidate, "No edition has a frozen candidate to release."),
    readAction("set-reach", hasRelease, "Reach belongs to a released edition, and none exists yet."),
    readAction("stop-showing-publicly", showsPublicly, "No edition of this page is public or listed, so there is nothing to contain."),
    readAction("withdraw-page", hasRelease, "There is no publication to withdraw."),
  ];
  return respond(workspace, documentRecord.documentId, documentRecord.revision, data, { sections: hasSection ? "value" : "zero", placements: sections.some((section) => section.placements.length > 0) ? "value" : "zero", editions: editions.length === 0 ? "zero" : "value" }, actions);
}
function sectionViewsOf(workspace: ContentWorkspace, document: ContentDocumentJson, revision: StoredContentRevision): readonly PageSectionView[] {
  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  return document.sections.map((section, position) => {
    const managed = MANAGED_SECTION_TYPES.has(section.element);
    return {
      position,
      element: section.element,
      inCatalogue: (PAGE_SECTION_TYPES as readonly string[]).includes(section.element),
      managed,
      lockReasonKey: managed ? (SECTION_LOCK_REASON_KEYS[section.element] ?? null) : null,
      fields: section.fields,
      presentation: section.presentation,
      direction: section.direction ?? null,
      placements: placements.filter((placement) => placement.sectionElement === section.element),
    };
  });
}
export type RequestedLocaleSource = "caller" | "document-default";
export type PageLocalesData = { readonly document: ContentDocumentView; readonly requestedLocale: string; readonly requestedLocaleSource: RequestedLocaleSource; readonly resolution: LocaleResolution; readonly editions: readonly ContentEditionView[]; readonly admittedLocales: readonly AdmittedLocale[] };
/** Reads the locale editions of one Page: the requested language, the editions that exist with their own pointers, the resolution `locale.ts` answers, and the locales a reader may choose. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPageLocales(input: { readonly pageId: string; readonly requestedLocale?: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<PageLocalesData>>> {
  const opened = await openContentWorkspace("readPageLocales", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  if (!isNonEmptyString(input.pageId)) return deniedRead("no-permission");
  const documentRecord = findDocument(workspace.state, input.pageId);
  if (documentRecord === undefined || documentRecord.family === "update") return deniedRead("no-permission");
  const checksums = checksumsOf(workspace.state);
  const variantRecords = variantsOf(workspace.state, documentRecord.documentId);
  const editions = variantRecords.map((variant) => editionViewOf(workspace.state, variant, checksums));
  const newest = newestReleaseOf(releasesOf(workspace.state, documentRecord.documentId));
  const asked = input.requestedLocale;
  const requestedLocale = isNonEmptyString(asked) ? asked : (newest?.locale ?? variantRecords[0]?.locale ?? "");
  const requestedLocaleSource: RequestedLocaleSource = isNonEmptyString(asked) ? "caller" : "document-default";
  const releases: readonly (Release & { readonly documentId: string; readonly siteId: string })[] = releasesOf(workspace.state, documentRecord.documentId).map((release) => ({ ...releaseOf(release, checksums), documentId: documentRecord.documentId, siteId: documentRecord.siteId }));
  const query = { document: documentOf(documentRecord), siteDefaultLocale: NO_DECLARED_SITE_DEFAULT, audience: "public" as const, releases };
  const resolution = resolveLocale({ ...query, requestedLocale });
  const data: PageLocalesData = { document: documentViewOf(documentRecord), requestedLocale, requestedLocaleSource, resolution, editions, admittedLocales: admittedLocales(query) };
  const actions: readonly ReadAction[] = [{ name: "add-locale-edition", available: true }, readAction("open-edition", resolution.status === "resolved", "No permitted edition serves this language, so there is nothing to open.")];
  return respond(workspace, documentRecord.documentId, documentRecord.revision, data, { editions: editions.length === 0 ? "zero" : "value", admittedLocales: admittedLocales(query).length === 0 ? "zero" : "value", "resolution.servedLocale": resolution.status === "resolved" ? "value" : "unavailable" }, actions);
}
export type GivingUnavailableCause = "missing" | "revoked" | "incompatible";
export type GivingBindingView = { readonly state: "approved"; readonly designationLabel: string; readonly designationRef: SourceReference } | { readonly state: "unavailable"; readonly cause: GivingUnavailableCause };
export type GivingProgressView = { readonly measure: SupportGoalMeasure; readonly basis: SupportBasis; readonly goal: { readonly currency: string; readonly minorUnits: number } } & { readonly currency: string; readonly currencyExponent: number; readonly period: Coverage; readonly coverage: CoverageState } & {
  readonly source: SourceReference;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
};
export type GivingBindingData = { readonly document: ContentDocumentView } & { readonly release: { readonly releaseId: string; readonly variantId: string; readonly locale: ContentLocale; readonly publishedAt: string; readonly reach: Reach; readonly withdrawnAt: string | null } | null } & {
  readonly binding: GivingBindingView;
  readonly detail: string | null;
  readonly progress: GivingProgressView | null;
  readonly inert: true;
} & { readonly givingAction: "none" };
/** Reads the one approved giving Designation a page release may place, or states *Giving unavailable* with its reason, together with the progress module when the source qualifies one. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readGivingBinding(input: { readonly documentId: string; readonly releaseId?: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<GivingBindingData>>> {
  const opened = await openContentWorkspace("readGivingBinding", input.session);
  if (!opened.ok) return opened.result;
  const { workspace } = opened;
  if (!isNonEmptyString(input.documentId)) return deniedRead("no-permission");
  const requestedReleaseId = input.releaseId;
  if (requestedReleaseId !== undefined && !isNonEmptyString(requestedReleaseId)) return deniedRead("no-permission");
  const documentRecord = findDocument(workspace.state, input.documentId);
  if (documentRecord === undefined) return deniedRead("no-permission");
  const releases = releasesOf(workspace.state, documentRecord.documentId);
  const named = requestedReleaseId === undefined ? newestReleaseOf(releases) : releases.find((release) => release.releaseId === requestedReleaseId);
  if (requestedReleaseId !== undefined && named === undefined) return deniedRead("no-permission");
  const document = documentViewOf(documentRecord);
  const placement = givingPlacementOf(documentRecord, named);
  const progress = documentRecord.family === "update" ? null : progressOf(workspace);
  const data: GivingBindingData = {
    document,
    release: named === undefined ? null : { releaseId: named.releaseId, variantId: named.variantId, locale: releaseLocaleOf(named.locale), publishedAt: named.publishedAt, reach: named.reach, withdrawnAt: named.withdrawnAt },
    binding: placement.binding,
    detail: placement.detail,
    progress,
    inert: true,
    givingAction: "none",
  };
  const actions: readonly ReadAction[] = [{ name: "start-giving", available: false, reason: "Giving is a simulated destination: no payment is taken, no checkout is started and no fund can be chosen on a page." }];
  return respond(workspace, documentRecord.documentId, documentRecord.revision, data, { "binding.designation": placement.binding.state === "approved" ? "value" : "unavailable", progress: progress === null ? "unknown" : "value", "progress.goal": progress === null ? "unknown" : "value" }, actions);
}
function givingPlacementOf(document: ContentDocumentRecord, release: ReleaseRecord | undefined): { readonly binding: GivingBindingView; readonly detail: string | null } {
  if (document.family === "update") return { binding: { state: "unavailable", cause: "incompatible" }, detail: "A Give placement belongs to a Worker or Project Page. An Update carries none, so there is no designation to show." };
  if (release !== undefined && release.withdrawnAt !== null) return { binding: { state: "unavailable", cause: "incompatible" }, detail: "This edition has been withdrawn, so its address serves a tombstone and no giving destination." };
  if (document.givingBinding === null) return { binding: { state: "unavailable", cause: "missing" }, detail: "No giving designation is approved for this page, and no default destination stands in its place." };
  return { binding: { state: "approved", designationLabel: document.givingBinding.label, designationRef: document.givingBinding.designation }, detail: null };
}
function progressOf(workspace: ContentWorkspace): GivingProgressView | null {
  const projection: SupportProjectionRecord | null | undefined = workspace.state.supportProjection;
  if (projection === null || projection === undefined) return null;
  const goal = projection.goal;
  if (goal === null) return null;
  if (goal.measure !== GOAL_MEASURE || projection.basis !== "effective_cash_allocation") return null;
  const exponent = projection.currencyExponents[goal.amount.currency];
  if (exponent === undefined) return null;
  if (projection.coverage.state === "unknown") return null;
  const { basis, source, asOf, lastSourceUpdate } = projection;
  return { measure: goal.measure, basis, goal: { currency: goal.amount.currency, minorUnits: goal.amount.minorUnits }, currency: goal.amount.currency, currencyExponent: exponent, period: projection.coverage, coverage: projection.coverage.state, source, asOf, lastSourceUpdate };
}
