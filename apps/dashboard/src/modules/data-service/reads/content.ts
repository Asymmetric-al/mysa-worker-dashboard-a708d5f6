/**
 * The ten content reads: everything the Ministry Updates family and the Worker and Project Page
 * families read, and nothing that changes anything.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { assertNever } from "@/lib/result";
import {
  CONTENT_PROFILE_VERSION,
  PRESENTATION_CHOICES,
  parseDocument,
  serialise,
  type ContentDocumentJson,
  type ContentSection,
  type DocumentIssue,
  type PresentationChoice,
} from "@/modules/content/document";
import { admittedLocales, directionOfTag, resolveLocale, type AdmittedLocale, type ContentLocale, type LocaleResolution } from "@/modules/content/locale";
import { PREVIEW_RENDITION_PURPOSES, authorisePreview, type PreviewDenialReason } from "@/modules/content/preview";
import { REACH_VALUES, isDirectlyReadable, isListedPublicly, reachMetadata, withdrawEdition, type Reach, type ReachMetadata, type Tombstone } from "@/modules/content/reach";
import { renderToHtml, type RenderMediaPlacement, type RenderRendition, type RenderRenditionPurpose, type RenderRenditions } from "@/modules/content/render";
import {
  REVIEW_STEPS_PER_CANDIDATE,
  admittedAudiences,
  translationStaleness,
  type ContentCandidate,
  type ContentDocument,
  type ContentRevision,
  type ContentVariant,
  type Release,
  type TranslationStaleness,
} from "@/modules/content/variant";
import { mediaStateReason, type MediaRenditionPurpose, type MediaStateReason } from "@/modules/media/asset";
import { readSession } from "@/modules/store/repository";
import { instantAt } from "@/modules/time/clock";
import { assertScope, canEdit, canView, readResultOfRefusal, resolveSession, type ResolvedSession, type SessionResolution, type SessionSource } from "../authorize";
import {
  buildEnvelope,
  contentCaptionTrackRecordSchema,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  mediaAssetRecordSchema,
  mediaPlacementRecordSchema,
  principalIdSchema,
  project,
  recordRevisionSchema,
  releaseRecordSchema,
  sharePresentationRecordSchema,
  storedInstantSchema,
  supportProjectionRecordSchema,
  type ContentAudience,
  type ContentCaptionTrackRecord,
  type Coverage,
  type CoverageState,
  type ContentDocumentRecord,
  type ContentFamily,
  type ContentKind,
  type MediaAssetKind,
  type MediaPlacementRecord,
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
import { LOCAL_STORE_SYSTEM, denied, unavailable, type ReadResult } from "../outcome";
// The operation identity a read refusal carries
const READ_ATTEMPT_ID = "read";
// What a read reads: the six content families of one session's state document
const storedContentRevisionSchema = z.object({
  revisionId: z.string().min(1),
  variantId: z.string().min(1),
  body: z.unknown(),
  mediaPlacements: z.array(mediaPlacementRecordSchema),
  captions: z.array(contentCaptionTrackRecordSchema),
  sharePresentation: sharePresentationRecordSchema,
  contentChecksum: z.string().min(1),
  authorPrincipalId: principalIdSchema,
  createdAt: storedInstantSchema,
  revision: recordRevisionSchema,
});
type StoredContentRevision = z.infer<typeof storedContentRevisionSchema>;

const contentWorkspaceSchema = z.object({
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  contentRevisions: z.array(storedContentRevisionSchema),
  releases: z.array(releaseRecordSchema),
  mediaAssets: z.array(mediaAssetRecordSchema),
  supportProjection: supportProjectionRecordSchema.nullable().optional(),
});
type ContentWorkspaceState = z.infer<typeof contentWorkspaceSchema>;

interface ContentWorkspace {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly asOf: Temporal.Instant;
  readonly state: ContentWorkspaceState;
}
type WorkspaceOpen = { readonly ok: true; readonly workspace: ContentWorkspace } | { readonly ok: false; readonly result: ReadResult<never> };

const CONTENT_SOURCE_REFERENCE = "content";

function sourceUnavailable(job: string, reference: string): ReadResult<never> {
  const source: SourceReference = { system: LOCAL_STORE_SYSTEM, reference };
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT_ID,
      source,
      guidance: "The local content store could not be read for this request. Reload the surface to try again; nothing was changed.",
    }),
  };
}
async function openContentWorkspace(job: string, source?: SessionSource): Promise<WorkspaceOpen> {
  let resolution: SessionResolution;
  try {
    resolution = await resolveSession(source);
  } catch {
    // Resolving a session can fail outside a request — no cookie jar, no request scope — and a read
    // answers that with the same refusal an unusable session receives rather than throwing at a
    // caller that asked for data.
    return {
      ok: false,
      result: {
        kind: "denied",
        denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "session-unavailable" }),
      },
    };
  }
  if (!resolution.ok) {
    return { ok: false, result: readResultOfRefusal(resolution.refusal) };
  }
  const session = resolution.session;
  const scope = session.selected;
  if (scope === null) {
    // A session that has chosen no organisation and ministry holds no authority over any of their
    // content, and inventing a scope from the first admitted membership would hand a read a context
    // the caller never selected.
    return {
      ok: false,
      result: {
        kind: "denied",
        denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "not-admitted" }),
      },
    };
  }
  const scopeDecision = assertScope(session, scope);
  if (!scopeDecision.ok) {
    return { ok: false, result: { kind: "denied", denied: scopeDecision.denial } };
  }
  const access = canView(session, { kind: "content-variant", scope });
  if (!access.allowed) {
    return { ok: false, result: { kind: "denied", denied: access.denial } };
  }
  let state: unknown;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return { ok: false, result: sourceUnavailable(job, CONTENT_SOURCE_REFERENCE) };
    }
    state = documents.state;
  } catch {
    // A corrupt or unreadable document is an unavailable source, never an empty workspace: reporting
    // no content would say the ministry has written nothing, which is the opposite of the truth.
    return { ok: false, result: sourceUnavailable(job, CONTENT_SOURCE_REFERENCE) };
  }
  const parsed = contentWorkspaceSchema.safeParse(state);
  if (!parsed.success) {
    return { ok: false, result: sourceUnavailable(job, CONTENT_SOURCE_REFERENCE) };
  }
  return {
    ok: true,
    workspace: {
      session,
      scope,
      // The session's own offset, applied to the one fixed seed anchor. A process-wide `now()` would
      // be the wrong instant for a session whose scenario clock differs from the process default.
      asOf: instantAt(session.clockOffsetMs),
      state: parsed.data,
    },
  };
}
// The envelope every read answers with
function contentSource(reference: string): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference };
}
function contentEnvelope<T>(input: {
  readonly workspace: ContentWorkspace;
  readonly data: T;
  readonly source: SourceReference;
  readonly revision: string;
  readonly valueStates: Readonly<Record<string, RecordedValueState>>;
  readonly actions: readonly ReadAction[];
}): ReadEnvelope<T> {
  return buildEnvelope({
    data: input.data,
    scope: input.workspace.scope,
    source: input.source,
    revision: input.revision,
    asOf: input.workspace.asOf.toString(),
    coverage: { from: null, to: null, state: "complete" },
    valueStates: input.valueStates,
    actions: input.actions,
  });
}
function recordNotFound(): ReadResult<never> {
  return {
    kind: "denied",
    denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "no-permission" }),
  };
}
// Stored records turned into the domain records the surfaces read
//
// The store holds the persisted form: an instant is a string, a locale is a tag plus a direction, and
// a pointer that has not moved is `null`. The surfaces and the shared components read the domain
// form, so this is the one place the two meet.
function localeOf(tag: string, direction: ContentLocale["direction"]): ContentLocale {
  return { tag, direction };
}
function releaseLocaleOf(tag: string): ContentLocale {
  return { tag, direction: directionOfTag(tag) };
}
function variantOf(record: {
  readonly variantId: string;
  readonly documentId: string;
  readonly audience: ContentAudience;
  readonly locale: string;
  readonly direction: ContentLocale["direction"];
  readonly draftRevisionId: string | null;
  readonly candidateId: string | null;
  readonly releaseHeadId: string | null;
  readonly translationSource: { readonly variantId: string; readonly revisionId: string } | null;
}): ContentVariant {
  return {
    variantId: record.variantId,
    documentId: record.documentId,
    audience: record.audience,
    locale: localeOf(record.locale, record.direction),
    ...(record.draftRevisionId === null ? {} : { draftRevisionId: record.draftRevisionId }),
    ...(record.candidateId === null ? {} : { candidateId: record.candidateId }),
    ...(record.releaseHeadId === null ? {} : { releaseHeadId: record.releaseHeadId }),
    ...(record.translationSource === null
      ? {}
      : {
          translationSource: {
            variantId: record.translationSource.variantId,
            revisionId: record.translationSource.revisionId,
          },
        }),
  };
}
function revisionOf(record: StoredContentRevision, document: ContentDocumentJson): ContentRevision {
  const captions: Record<string, string> = {};
  const altText: Record<string, string> = {};
  for (const placement of record.mediaPlacements) {
    altText[placement.placementId] = placement.altText;
    if (placement.caption !== null) {
      captions[placement.placementId] = placement.caption;
    }
  }
  return {
    revisionId: record.revisionId,
    variantId: record.variantId,
    body: document,
    sections: document.sections,
    mediaPlacements: record.mediaPlacements.map((placement) => ({
      placementId: placement.placementId,
      assetId: placement.assetId,
    })),
    captions,
    altText,
    sharePresentation: sharePresentationOf(record.sharePresentation),
    contentChecksum: record.contentChecksum,
    authorPrincipalId: record.authorPrincipalId,
    createdAt: Temporal.Instant.from(record.createdAt),
  };
}
function sharePresentationOf(record: SharePresentationRecord): {
  readonly title?: string;
  readonly description?: string;
  readonly imageAssetId?: string;
} {
  return {
    ...(isNonEmptyString(record.title) ? { title: record.title } : {}),
    ...(isNonEmptyString(record.description) ? { description: record.description } : {}),
    ...(record.imageAssetId === null ? {} : { imageAssetId: record.imageAssetId }),
  };
}
type RevisionChecksums = ReadonlyMap<string, string>;

function checksumsOf(state: ContentWorkspaceState): RevisionChecksums {
  const index = new Map<string, string>();
  for (const revision of state.contentRevisions) {
    index.set(revision.revisionId, revision.contentChecksum);
  }
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
// Lookups over one workspace
type ContentVariantRecordLike = ContentWorkspaceState["contentVariants"][number];

function findDocument(state: ContentWorkspaceState, documentId: string): ContentDocumentRecord | undefined {
  return state.contentDocuments.find((candidate) => candidate.documentId === documentId);
}
function findVariant(state: ContentWorkspaceState, variantId: string): ContentVariantRecordLike | undefined {
  return state.contentVariants.find((candidate) => candidate.variantId === variantId);
}
function variantsOf(state: ContentWorkspaceState, documentId: string): readonly ContentVariantRecordLike[] {
  return state.contentVariants.filter((variant) => variant.documentId === documentId);
}
function findRevision(state: ContentWorkspaceState, revisionId: string): StoredContentRevision | undefined {
  return state.contentRevisions.find((candidate) => candidate.revisionId === revisionId);
}
function releasesOf(state: ContentWorkspaceState, documentId: string): readonly ReleaseRecord[] {
  const variantIds = new Set(variantsOf(state, documentId).map((variant) => variant.variantId));
  return state.releases.filter((release) => variantIds.has(release.variantId));
}
function releasesOfVariant(state: ContentWorkspaceState, variantId: string): readonly ReleaseRecord[] {
  return state.releases.filter((release) => release.variantId === variantId);
}
function headReleaseOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike): ReleaseRecord | undefined {
  const head = variant.releaseHeadId;
  if (head === null) {
    return undefined;
  }
  return releasesOfVariant(state, variant.variantId).find((release) => release.releaseId === head);
}
function newestReleaseOf(releases: readonly ReleaseRecord[]): ReleaseRecord | undefined {
  let newest: ReleaseRecord | undefined;
  for (const release of releases) {
    if (newest === undefined) {
      newest = release;
      continue;
    }
    const comparison = Temporal.Instant.compare(Temporal.Instant.from(release.publishedAt), Temporal.Instant.from(newest.publishedAt));
    if (comparison > 0 || (comparison === 0 && release.releaseId < newest.releaseId)) {
      newest = release;
    }
  }
  return newest;
}
function isWithdrawnRelease(record: ReleaseRecord): boolean {
  return record.withdrawnAt !== null;
}
function documentOf(record: ContentDocumentRecord): ContentDocument {
  return {
    documentId: record.documentId,
    family: record.family,
    kind: record.kind,
    sourceSubject: record.sourceSubject,
    siteId: record.siteId,
    ...(record.givingBinding === null ? {} : { givingBinding: record.givingBinding.designation }),
    // The stored record names the managed fields the composition surface locks; it holds no value
    // for any of them, so none is invented here. Locale resolution reads the identity and the site
    // only, and the page read reports the locked names as names.
    managedFields: {},
  };
}
const NO_DECLARED_SITE_DEFAULT = "";
// Media placements: opaque rendition identities, and a path that re-authorises on every request
function renditionPath(assetId: string, renditionId: string): string {
  return `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(renditionId)}`;
}
/** One rendition a placement may use: its opaque identity, its purpose and the route that serves it. */
export interface ContentRenditionView {
  readonly renditionId: string;
  readonly purpose: MediaRenditionPurpose;
  readonly mimeType: string;
  readonly path: string;
}
/** One placement as a surface meets it: the authored alternative text and caption, the media state, and the rendition identities that may be requested for it. */
export interface ContentPlacementView {
  readonly placementId: string;
  readonly assetId: string;
  readonly kind: MediaAssetKind;
  readonly sectionElement: string | null;
  readonly position: number;
  readonly altText: string;
  readonly caption: string | null;
  readonly credit: string | null;
  readonly state: "ready" | "unavailable";
  readonly reason: MediaStateReason | null;
  readonly renditions: readonly ContentRenditionView[];
  readonly captionTracks: readonly ContentCaptionTrackRecord[];
}
function mainRenditionPurpose(kind: MediaAssetKind): MediaRenditionPurpose {
  switch (kind) {
    case "image":
      return "display";
    case "video":
      return "playback";
  }
  return assertNever(kind);
}
function asRenderPurpose(purpose: MediaRenditionPurpose): RenderRenditionPurpose | undefined {
  switch (purpose) {
    case "display":
    case "playback":
    case "poster":
    case "captions":
      return purpose;
    case "transcript":
      return undefined;
  }
  return assertNever(purpose);
}
const VISIBLE_MEDIA_ASSET_FIELDS = ["assetId", "kind", "profileCheck", "renditions", "tagVerification", "revision"] as const;

function placementViews(workspace: ContentWorkspace, placements: readonly MediaPlacementRecord[], captionTracks: readonly ContentCaptionTrackRecord[]): readonly ContentPlacementView[] {
  return placements.map((placement) => {
    const asset = workspace.state.mediaAssets.find((candidate) => candidate.assetId === placement.assetId);
    const tracks = captionTracks.filter((track) => track.assetId === placement.assetId);
    const reason = mediaStateReason("unavailable");
    if (asset === undefined) {
      return unreadablePlacement(placement, "video", reason, tracks);
    }
    const readable = canView(workspace.session, { kind: "media-asset", scope: asset.scope });
    if (!readable.allowed) {
      return unreadablePlacement(placement, asset.kind, reason, tracks);
    }
    const visible = project(asset, VISIBLE_MEDIA_ASSET_FIELDS);
    const renditions: ContentRenditionView[] = visible.renditions.map((rendition) => ({
      renditionId: rendition.renditionId,
      purpose: rendition.purpose,
      mimeType: rendition.mimeType,
      path: renditionPath(visible.assetId, rendition.renditionId),
    }));
    const main = renditions.some((rendition) => rendition.purpose === mainRenditionPurpose(visible.kind));
    return {
      placementId: placement.placementId,
      assetId: placement.assetId,
      kind: visible.kind,
      sectionElement: placement.sectionElement,
      position: placement.position,
      altText: placement.altText,
      caption: placement.caption,
      credit: placement.credit,
      state: main ? "ready" : "unavailable",
      reason: main ? null : reason,
      renditions,
      captionTracks: tracks,
    };
  });
}
function unreadablePlacement(placement: MediaPlacementRecord, kind: MediaAssetKind, reason: MediaStateReason, tracks: readonly ContentCaptionTrackRecord[]): ContentPlacementView {
  return {
    placementId: placement.placementId,
    assetId: placement.assetId,
    kind,
    sectionElement: placement.sectionElement,
    position: placement.position,
    altText: placement.altText,
    caption: placement.caption,
    credit: placement.credit,
    state: "unavailable",
    reason,
    renditions: [],
    captionTracks: tracks,
  };
}
type RevisionRender =
  | {
      readonly status: "rendered";
      readonly html: string;
      readonly document: ContentDocumentJson;
    }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
function renderRevision(body: unknown, placements: readonly ContentPlacementView[]): RevisionRender {
  const renderedPlacements: RenderMediaPlacement[] = [];
  const renditions: Record<string, RenderRendition> = {};
  for (const placement of placements) {
    const captionTrack = placement.captionTracks.find((track) => track.isDefault) ?? placement.captionTracks[0];
    const mainKey = placement.placementId;
    const posterKey = `${placement.placementId}:poster`;
    const captionsKey = `${placement.placementId}:captions`;
    for (const rendition of placement.renditions) {
      const purpose = asRenderPurpose(rendition.purpose);
      if (purpose === undefined) {
        continue;
      }
      const key = purpose === "poster" ? posterKey : purpose === "captions" ? captionsKey : mainKey;
      renditions[key] = { src: rendition.path, purpose };
    }
    renderedPlacements.push({
      placementId: placement.placementId,
      kind: placement.kind,
      altText: placement.altText,
      ...(placement.caption === null ? {} : { caption: placement.caption }),
      ...(hasRendition(placement, "poster") ? { posterId: posterKey } : {}),
      ...(hasRendition(placement, "captions") ? { captionsId: captionsKey } : {}),
      ...(captionTrack === undefined ? {} : { captionsLanguage: captionTrack.language, captionsLabel: captionTrack.label }),
    });
  }
  const rendered = renderToHtml(body, {
    media: "inline",
    placements: renderedPlacements,
    renditions: renditions as RenderRenditions,
  });
  if (rendered.status === "invalid") {
    return { status: "invalid", issues: rendered.issues };
  }
  const parsed = parseDocument(body);
  if (parsed.status === "invalid") {
    return { status: "invalid", issues: parsed.issues };
  }
  return { status: "rendered", html: rendered.html, document: parsed.document };
}
function hasRendition(placement: ContentPlacementView, purpose: MediaRenditionPurpose): boolean {
  return placement.renditions.some((rendition) => rendition.purpose === purpose);
}
// The facts a surface derives an edition's state from
/** How a manual translation stands against its source, with instants stated as the stored ISO strings an envelope carries rather than as `Temporal` values. */
export type ContentTranslationView =
  | { readonly status: "none" }
  | {
      readonly status: "fresh";
      readonly sourceRevisionId: string;
      readonly sourceUpdatedAt: string;
    }
  | {
      readonly status: "stale";
      readonly sourceRevisionId: string;
      readonly sourceUpdatedAt: string;
      readonly translatedFromRevisionId: string;
    }
  | { readonly status: "unresolved"; readonly translatedFromRevisionId: string };
function translationViewOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike): ContentTranslationView {
  const recorded = variant.translationSource;
  if (recorded === null) {
    return { status: "none" };
  }
  const sourceVariant = findVariant(state, recorded.variantId);
  const sourceRevision = sourceVariant === undefined ? undefined : currentRevisionOf(state, sourceVariant);
  if (sourceVariant === undefined || sourceRevision === undefined) {
    return { status: "unresolved", translatedFromRevisionId: recorded.revisionId };
  }
  const parsed = parseDocument(sourceRevision.body);
  if (parsed.status === "invalid") {
    return { status: "unresolved", translatedFromRevisionId: recorded.revisionId };
  }
  const staleness: TranslationStaleness = translationStaleness(variantOf(variant), {
    sourceVariant: variantOf(sourceVariant),
    sourceRevision: revisionOf(sourceRevision, parsed.document),
  });
  switch (staleness.status) {
    case "none":
      return { status: "none" };
    case "fresh":
      return {
        status: "fresh",
        sourceRevisionId: staleness.sourceRevisionId,
        sourceUpdatedAt: staleness.sourceUpdatedAt.toString(),
      };
    case "stale":
      return {
        status: "stale",
        sourceRevisionId: staleness.sourceRevisionId,
        sourceUpdatedAt: staleness.sourceUpdatedAt.toString(),
        translatedFromRevisionId: staleness.translatedFromRevisionId,
      };
  }
  return assertNever(staleness);
}
function currentRevisionOf(state: ContentWorkspaceState, variant: ContentVariantRecordLike): StoredContentRevision | undefined {
  if (variant.draftRevisionId !== null) {
    return findRevision(state, variant.draftRevisionId);
  }
  const head = headReleaseOf(state, variant);
  return head === undefined ? undefined : findRevision(state, head.revisionId);
}
/** One edition as the variant matrix lists it: its audience and exact locale, its three independent pointers, the release standing at its head with everything reach reaches, and how its. */
export interface ContentEditionView {
  readonly variantId: string;
  readonly audience: ContentAudience;
  readonly locale: ContentLocale;
  readonly draftRevisionId: string | null;
  readonly candidateId: string | null;
  readonly releaseHeadId: string | null;
  readonly recordRevision: string;
  readonly headRelease: Release | null;
  readonly reach: ReachMetadata | null;
  readonly lastReleaseAt: string | null;
  readonly translation: ContentTranslationView;
}
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
    releaseHeadId: variant.releaseHeadId,
    recordRevision: variant.revision,
    headRelease: head === undefined ? null : releaseOf(head, checksums),
    reach: head === undefined ? null : reachMetadata({ reach: head.reach, withdrawnAt: head.withdrawnAt }),
    lastReleaseAt: newest === undefined ? null : newest.publishedAt,
    translation: translationViewOf(state, variant),
  };
}
// The canonical document, as every content read states it
/** One canonical content identity as a surface reads it: the Update or Page itself, apart from any of its editions. */
export interface ContentDocumentView {
  readonly documentId: string;
  readonly family: ContentFamily;
  readonly kind: ContentKind;
  readonly siteId: string;
  readonly sourceSubject: SourceReference;
  readonly givingBinding: { readonly designation: SourceReference; readonly label: string } | null;
  readonly managedFieldKeys: readonly string[];
  readonly recordRevision: string;
}
function documentViewOf(record: ContentDocumentRecord): ContentDocumentView {
  return {
    documentId: record.documentId,
    family: record.family,
    kind: record.kind,
    siteId: record.siteId,
    sourceSubject: record.sourceSubject,
    givingBinding: record.givingBinding === null ? null : { designation: record.givingBinding.designation, label: record.givingBinding.label },
    managedFieldKeys: [...record.managedFields],
    recordRevision: record.revision,
  };
}
/** The four bounded presentation choices, as the content profile declares them and no second time. */
export type ContentPresentationChoices = typeof PRESENTATION_CHOICES;
// readVariantOverview — the variant matrix of one document
/** The variant matrix of one Update or Page. */
export interface VariantOverviewData {
  readonly document: ContentDocumentView;
  readonly audiences: readonly ContentAudience[];
  readonly editions: readonly ContentEditionView[];
  readonly awaitingRelease: readonly string[];
}
/** Reads the variant matrix of one document: every edition with its audience, exact locale, three independent pointers, head release and translation state. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readVariantOverview(input: { readonly documentId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<VariantOverviewData>>> {
  const opened = await openContentWorkspace("readVariantOverview", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.documentId)) {
    return recordNotFound();
  }
  const document = findDocument(workspace.state, input.documentId);
  if (document === undefined) {
    return recordNotFound();
  }
  const checksums = checksumsOf(workspace.state);
  const editions = variantsOf(workspace.state, document.documentId).map((variant) => editionViewOf(workspace.state, variant, checksums));
  const awaitingRelease = editions.filter((edition) => edition.candidateId !== null && edition.releaseHeadId === null).map((edition) => edition.variantId);
  const data: VariantOverviewData = {
    document: documentViewOf(document),
    audiences: admittedAudiences(document.family),
    editions,
    awaitingRelease,
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(document.documentId),
      revision: document.revision,
      valueStates: {
        editions: editions.length === 0 ? "zero" : "value",
        awaitingRelease: awaitingRelease.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "create-variant", available: true },
        {
          name: "open-draft",
          available: editions.some((edition) => edition.draftRevisionId !== null),
          ...(editions.some((edition) => edition.draftRevisionId !== null) ? {} : { reason: "No edition of this document has a saved draft yet." }),
        },
        {
          name: "review-candidate",
          available: awaitingRelease.length > 0,
          ...(awaitingRelease.length > 0 ? {} : { reason: "No edition of this document has a candidate awaiting review." }),
        },
        {
          name: "publish-variants",
          available: editions.some((edition) => edition.candidateId !== null),
          ...(editions.some((edition) => edition.candidateId !== null) ? {} : { reason: "Only a frozen candidate can be published; no edition has one." }),
        },
      ],
    }),
  };
}
// readDraft — the one working revision of one edition
/** What a draft read states: the working revision, its absence, or a stored document it cannot read. */
export type ContentDraftData =
  | {
      readonly status: "draft";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly revision: ContentRevision;
      readonly recordRevision: string;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly captionTracks: readonly ContentCaptionTrackRecord[];
      readonly translation: ContentTranslationView;
    }
  | {
      readonly status: "no-draft";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly recordRevision: string;
      readonly translation: ContentTranslationView;
    }
  | {
      readonly status: "invalid";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly revisionId: string;
      readonly recordRevision: string;
      readonly issues: readonly DocumentIssue[];
    };
/** Reads one edition's working revision: its stored body, its sections, its placements with their opaque rendition identities, its rendered HTML, and the record revision a save must present. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readDraft(input: { readonly variantId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<ContentDraftData>>> {
  const opened = await openContentWorkspace("readDraft", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }
  const document = documentViewOf(documentRecord);
  const variant = variantOf(record);
  const audience = record.audience;
  const locale = localeOf(record.locale, record.direction);
  const translation = translationViewOf(workspace.state, record);
  const pointer = record.draftRevisionId;
  if (pointer === null) {
    const data: ContentDraftData = {
      status: "no-draft",
      document,
      variant,
      audience,
      locale,
      recordRevision: record.revision,
      translation,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { sections: "zero", placements: "zero" },
        actions: [
          { name: "save-draft", available: true },
          {
            name: "submit-for-review",
            available: false,
            reason: "There is no saved draft to submit yet.",
          },
        ],
      }),
    };
  }
  const revision = findRevision(workspace.state, pointer);
  if (revision === undefined) {
    const data: ContentDraftData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      revisionId: pointer,
      recordRevision: record.revision,
      issues: [
        {
          path: "revisionId",
          message: "The draft this edition points at is not in the store, so no content can be shown for it.",
        },
      ],
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { sections: "unknown", placements: "unknown" },
        actions: [
          {
            name: "save-draft",
            available: true,
            reason: "A save replaces the broken draft pointer with a new revision of this edition.",
          },
        ],
      }),
    };
  }
  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  const rendered = renderRevision(revision.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentDraftData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      revisionId: revision.revisionId,
      recordRevision: record.revision,
      issues: rendered.issues,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        // The stored document could not be read as content, so nothing about its sections or its
        // placements is established. `unknown` says exactly that; `zero` would claim there are none.
        valueStates: { sections: "unknown", placements: "unknown" },
        actions: [
          {
            name: "save-draft",
            available: true,
            reason: "A fresh save writes an admitted document and replaces the unreadable revision.",
          },
        ],
      }),
    };
  }
  const data: ContentDraftData = {
    status: "draft",
    document,
    variant,
    audience,
    locale,
    revision: revisionOf(revision, rendered.document),
    recordRevision: record.revision,
    renderedHtml: rendered.html,
    placements,
    captionTracks: revision.captions,
    translation,
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        sections: rendered.document.sections.length === 0 ? "zero" : "value",
        placements: placements.length === 0 ? "zero" : "value",
        captionTracks: revision.captions.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "save-draft", available: true },
        { name: "submit-for-review", available: true },
        { name: "restore-revision-as-draft", available: true },
        { name: "preview-revision", available: true },
      ],
    }),
  };
}
// readCandidate — the frozen revision a reviewer answers
/** One section's change between the frozen candidate and the release it would replace. */
export interface CandidateSectionChange {
  readonly position: number;
  readonly element: string;
  readonly change: "added" | "removed" | "changed";
}
/** One placement's change between the frozen candidate and the release it would replace. */
export interface CandidatePlacementChange {
  readonly placementId: string;
  readonly assetId: string;
  readonly change: "added" | "removed" | "changed";
}
/** The reviewer-visible difference between the frozen candidate and the release standing at the head. */
export interface CandidateDiffView {
  readonly against: {
    readonly releaseId: string;
    readonly revisionId: string;
    readonly contentChecksum: string;
  } | null;
  readonly unchanged: boolean;
  readonly proseChanged: boolean;
  readonly directionChanged: boolean;
  readonly sections: readonly CandidateSectionChange[];
  readonly placements: readonly CandidatePlacementChange[];
}
/** What a candidate read states: frozen and reviewable, absent, unreadable, or not resolvable. */
export type ContentCandidateData =
  | {
      readonly status: "reviewable";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly candidate: ContentCandidate;
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly diff: CandidateDiffView;
      readonly review: {
        readonly steps: typeof REVIEW_STEPS_PER_CANDIDATE;
        readonly round: typeof REVIEW_STEPS_PER_CANDIDATE;
        readonly decision: null;
        readonly approvalScope: "this-variant-only";
      };
      readonly recordRevision: string;
    }
  | {
      readonly status: "none";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly recordRevision: string;
    }
  | {
      readonly status: "invalid";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly candidateId: string;
      readonly issues: readonly DocumentIssue[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "unavailable";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly candidateId: string;
      readonly reason: string;
      readonly recordRevision: string;
    };
/** Reads the candidate frozen for one edition: the exact revision it froze, its rendered HTML, the difference from the current release and the single review step it may receive. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCandidate(input: { readonly variantId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<ContentCandidateData>>> {
  const opened = await openContentWorkspace("readCandidate", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }
  const document = documentViewOf(documentRecord);
  const variant = variantOf(record);
  const audience = record.audience;
  const locale = localeOf(record.locale, record.direction);
  const candidateId = record.candidateId;
  if (candidateId === null) {
    const data: ContentCandidateData = {
      status: "none",
      document,
      variant,
      audience,
      locale,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { changedSections: "zero", changedPlacements: "zero" },
        actions: [
          {
            name: "submit-for-review",
            available: true,
            reason: "A submitted revision becomes the candidate a reviewer answers.",
          },
        ],
      }),
    };
  }
  // The store holds no separate candidate family: a frozen candidate is identified by the revision it
  // froze, so `candidateId` names that revision and is resolved by identity rather than guessed at.
  const frozen = findRevision(workspace.state, candidateId);
  if (frozen === undefined) {
    const data: ContentCandidateData = {
      status: "unavailable",
      document,
      variant,
      audience,
      locale,
      candidateId,
      reason: "The candidate this edition holds names a revision that is not in the store, so what the reviewer would approve cannot be shown.",
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { changedSections: "unavailable", changedPlacements: "unavailable" },
        actions: [
          {
            name: "submit-for-review",
            available: true,
            reason: "A fresh submission replaces the candidate that cannot be resolved.",
          },
        ],
      }),
    };
  }
  const placements = placementViews(workspace, frozen.mediaPlacements, frozen.captions);
  const rendered = renderRevision(frozen.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentCandidateData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      candidateId,
      issues: rendered.issues,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { changedSections: "unknown", changedPlacements: "unknown" },
        actions: [
          {
            name: "request-changes",
            available: true,
            reason: "The frozen revision cannot be approved as it stands.",
          },
        ],
      }),
    };
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
  const data: ContentCandidateData = {
    status: "reviewable",
    document,
    variant,
    audience,
    locale,
    candidate: {
      candidateId,
      variantId: frozen.variantId,
      revisionId: frozen.revisionId,
      contentChecksum: frozen.contentChecksum,
      frozenAt: Temporal.Instant.from(frozen.createdAt),
      reviewRound: REVIEW_STEPS_PER_CANDIDATE,
    },
    revision: revisionOf(frozen, rendered.document),
    renderedHtml: rendered.html,
    placements,
    diff,
    review: {
      steps: REVIEW_STEPS_PER_CANDIDATE,
      round: REVIEW_STEPS_PER_CANDIDATE,
      decision: null,
      approvalScope: "this-variant-only",
    },
    recordRevision: record.revision,
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        changedSections: diff.sections.length === 0 ? "zero" : "value",
        changedPlacements: diff.placements.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "approve", available: true },
        { name: "request-changes", available: true },
        { name: "reject", available: true },
        {
          name: "publish-only",
          available: true,
          reason: "Releasing this candidate sends no message; notification is a separate decision.",
        },
        {
          name: "publish-and-notify-now",
          available: true,
          reason: "Only a reviewer who chooses it turns a release into a notification request.",
        },
      ],
    }),
  };
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
  const against =
    input.head === undefined
      ? null
      : {
          releaseId: input.head.releaseId,
          revisionId: input.head.revisionId,
          contentChecksum: input.releaseChecksum ?? "",
        };
  if (release === undefined) {
    return {
      against,
      unchanged: false,
      proseChanged: true,
      directionChanged: false,
      sections: [],
      placements: [],
    };
  }
  const proseChanged = serialise({ ...candidate, sections: [] }) !== serialise({ ...release, sections: [] });
  const directionChanged = candidate.direction !== release.direction;
  const sections: CandidateSectionChange[] = [];
  const positions = Math.max(candidate.sections.length, release.sections.length);
  for (let position = 0; position < positions; position += 1) {
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
    if (next !== undefined && previous !== undefined) {
      if (sectionSignature(next) !== sectionSignature(previous)) {
        sections.push({ position, element: next.element, change: "changed" });
      }
    }
  }
  const placements = placementChanges(input.candidatePlacements, input.releasePlacements);
  return {
    against,
    unchanged: input.releaseChecksum !== undefined && input.releaseChecksum === input.candidateChecksum,
    proseChanged,
    directionChanged,
    sections,
    placements,
  };
}
function sectionSignature(section: ContentSection): string {
  return serialise({
    type: "doc",
    profileVersion: CONTENT_PROFILE_VERSION,
    direction: "ltr",
    content: [],
    sections: [section],
  });
}
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
    if (JSON.stringify(before) !== JSON.stringify(placement)) {
      changes.push({ placementId, assetId: placement.assetId, change: "changed" });
    }
  }
  for (const [placementId, placement] of previous) {
    if (!next.has(placementId)) {
      changes.push({ placementId, assetId: placement.assetId, change: "removed" });
    }
  }
  return changes;
}
// readRelease — the release standing at one edition's head
/** A withdrawn release as the tombstone surface states it: identity and dates, and no content. */
export interface WithdrawnReleaseView {
  readonly releaseId: string;
  readonly variantId: string;
  readonly publishedAt: string;
  readonly withdrawnAt: string;
  readonly reach: Reach;
  readonly recordRevision: string;
}
/** What a release read states: served, withdrawn, unreadable, or absent. */
export type ContentReleaseData =
  | {
      readonly status: "released";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly release: Release;
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly reach: {
        readonly value: Reach;
        readonly metadata: ReachMetadata;
        readonly listed: boolean;
        readonly directlyReadable: boolean;
      };
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "withdrawn";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly release: WithdrawnReleaseView;
      readonly tombstone: Tombstone;
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "invalid";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly releaseId: string;
      readonly issues: readonly DocumentIssue[];
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "no-release";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    };
/** Reads the release standing at one edition's head, or the release a caller names from its history. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readRelease(input: { readonly variantId: string; readonly releaseId?: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<ContentReleaseData>>> {
  const opened = await openContentWorkspace("readRelease", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }
  const document = documentViewOf(documentRecord);
  const variant = variantOf(record);
  const audience = record.audience;
  const locale = localeOf(record.locale, record.direction);
  const checksums = checksumsOf(workspace.state);
  const siblingHeads = variantsOf(workspace.state, documentRecord.documentId)
    .filter((sibling) => sibling.variantId !== record.variantId)
    .map((sibling) => editionViewOf(workspace.state, sibling, checksums));
  const requestedReleaseId = input.releaseId;
  if (requestedReleaseId !== undefined && !isNonEmptyString(requestedReleaseId)) {
    return recordNotFound();
  }
  const named =
    requestedReleaseId === undefined ? headReleaseOf(workspace.state, record) : releasesOfVariant(workspace.state, record.variantId).find((release) => release.releaseId === requestedReleaseId);
  if (named === undefined) {
    const data: ContentReleaseData = {
      status: "no-release",
      document,
      variant,
      audience,
      locale,
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {
          placements: "zero",
          siblingHeads: siblingHeads.length === 0 ? "zero" : "value",
        },
        actions: [
          {
            name: "publish-variants",
            available: record.candidateId !== null,
            ...(record.candidateId === null ? { reason: "This edition has no frozen candidate, so there is nothing to release." } : {}),
          },
          {
            name: "set-reach",
            available: false,
            reason: "Reach is a property of a released edition, and this edition has none.",
          },
          {
            name: "withdraw-release",
            available: false,
            reason: "There is no publication to withdraw.",
          },
        ],
      }),
    };
  }
  if (isWithdrawnRelease(named)) {
    const withdrawnAt = named.withdrawnAt ?? "";
    const data: ContentReleaseData = {
      status: "withdrawn",
      document,
      variant,
      audience,
      locale,
      release: {
        releaseId: named.releaseId,
        variantId: named.variantId,
        publishedAt: named.publishedAt,
        withdrawnAt,
        reach: named.reach,
        recordRevision: named.revision,
      },
      tombstone: tombstoneFor(workspace, named),
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {
          placements: "zero",
          siblingHeads: siblingHeads.length === 0 ? "zero" : "value",
        },
        actions: [
          {
            name: "publish-variants",
            available: record.candidateId !== null,
            ...(record.candidateId === null ? { reason: "A withdrawn edition is republished by releasing a new candidate." } : {}),
          },
        ],
      }),
    };
  }
  const revision = findRevision(workspace.state, named.revisionId);
  if (revision === undefined) {
    const data: ContentReleaseData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      releaseId: named.releaseId,
      issues: [
        {
          path: "release.revisionId",
          message: "The revision this release published is not in the store, so what readers were given cannot be shown.",
        },
      ],
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown", siblingHeads: "value" },
        actions: [{ name: "withdraw-release", available: true }],
      }),
    };
  }
  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  const rendered = renderRevision(revision.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentReleaseData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      releaseId: named.releaseId,
      issues: rendered.issues,
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown", siblingHeads: "value" },
        actions: [{ name: "withdraw-release", available: true }],
      }),
    };
  }
  const edition = { reach: named.reach, withdrawnAt: named.withdrawnAt };
  const data: ContentReleaseData = {
    status: "released",
    document,
    variant,
    audience,
    locale,
    release: releaseOf(named, checksums),
    revision: revisionOf(revision, rendered.document),
    renderedHtml: rendered.html,
    placements,
    reach: {
      value: named.reach,
      metadata: reachMetadata(edition),
      listed: isListedPublicly(edition),
      directlyReadable: isDirectlyReadable(edition),
    },
    siblingHeads,
    recordRevision: record.revision,
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        placements: placements.length === 0 ? "zero" : "value",
        siblingHeads: siblingHeads.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "withdraw-release", available: true },
        { name: "set-reach", available: true },
        {
          name: "stop-showing-publicly",
          available: named.reach !== "not-public",
          ...(named.reach === "not-public" ? { reason: "This edition is already Not public, so it shows nowhere publicly." } : {}),
        },
        {
          name: "preview-release",
          available: true,
          reason: "A preview renders the exact released revision and starts nothing.",
        },
      ],
    }),
  };
}
function tombstoneFor(workspace: ContentWorkspace, record: ReleaseRecord): Tombstone {
  return withdrawEdition(releaseOf(record, new Map<string, string>()), { at: workspace.asOf }).tombstone;
}
// readPreview — one definition, both families, inert by construction
/** What a preview states: an authorised rendering of the acknowledged revision, a stored document the profile cannot read, or the content module's own refusal reason. */
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
      readonly inert: true;
      readonly givingAction: "none";
    }
  | {
      readonly status: "invalid";
      readonly variantId: string;
      readonly revisionId: string;
      readonly issues: readonly DocumentIssue[];
    }
  | {
      readonly status: "denied";
      readonly reason: PreviewDenialReason;
    };
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
export async function readPreview(input: {
  readonly variantId: string;
  readonly revisionId: string;
  readonly candidateId?: string;
  readonly requestedLocale?: string;
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<ContentPreviewData>>> {
  const opened = await openContentWorkspace("readPreview", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId) || !isNonEmptyString(input.revisionId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }
  // A preview is a worker-side surface: drafting, reviewing and inspecting an edition. Editorial
  // authority over the edition is the fact this read uses in place of a supporter's reader grant, and
  // it is passed to the decision as `canReadProtected` because a colleague who may change the edition
  // may inspect the exact revision they are reviewing. No supporter's grant is consulted or invented,
  // and a principal without that authority is refused before anything is enumerated.
  const editorialAccess = canEdit(workspace.session, {
    kind: "content-variant",
    scope: workspace.scope,
  });
  if (!editorialAccess.allowed) {
    return { kind: "denied", denied: editorialAccess.denial };
  }
  const document = documentViewOf(documentRecord);
  const checksums = checksumsOf(workspace.state);
  const variant = variantOf(record);
  const releases = releasesOf(workspace.state, documentRecord.documentId).map((release) => releaseOf(release, checksums));
  const acknowledgedRevision = findRevision(workspace.state, input.revisionId);
  const acknowledgedPlacements = acknowledgedRevision === undefined ? [] : placementViews(workspace, acknowledgedRevision.mediaPlacements, acknowledgedRevision.captions);
  // The decision admits renditions for exactly the five purposes a preview serves, and all of them or
  // none: a caption or transcript address admitted on its own would become a way to ask about a
  // protected video without opening it.
  const renditionIds = acknowledgedPlacements.flatMap((placement) =>
    placement.state === "ready" ? placement.renditions.filter((rendition) => PREVIEW_RENDITION_PURPOSES.includes(rendition.purpose)).map((rendition) => rendition.renditionId) : [],
  );
  const candidate = candidateFor(workspace.state, record, input.candidateId);
  const isAuthor = acknowledgedRevision !== undefined && acknowledgedRevision.authorPrincipalId === workspace.session.principalId;
  const decision = authorisePreview({
    principal: { principalId: workspace.session.principalId },
    variant,
    acknowledgement: {
      revisionId: input.revisionId,
      ...(candidate === undefined ? {} : { candidate }),
    },
    requestedLocale: input.requestedLocale ?? "",
    releases,
    renditionIds,
    canReadProtected: editorialAccess.allowed,
    isAuthor,
  });
  if (decision.status === "denied") {
    const data: ContentPreviewData = { status: "denied", reason: decision.reason };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        // A refusal states one reason code. It carries no count and no candidate for a value, because
        // the only fact it reports is the caller's relationship to the request.
        valueStates: {},
        actions: [],
      }),
    };
  }
  const admitted = findRevision(workspace.state, decision.revisionId);
  if (admitted === undefined) {
    const data: ContentPreviewData = {
      status: "invalid",
      variantId: record.variantId,
      revisionId: decision.revisionId,
      issues: [
        {
          path: "revisionId",
          message: "The acknowledged revision is no longer in the store, so nothing can be rendered.",
        },
      ],
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown" },
        actions: [],
      }),
    };
  }
  const placements = placementViews(workspace, admitted.mediaPlacements, admitted.captions);
  const rendered = renderRevision(admitted.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentPreviewData = {
      status: "invalid",
      variantId: record.variantId,
      revisionId: admitted.revisionId,
      issues: rendered.issues,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown" },
        actions: [],
      }),
    };
  }
  const data: ContentPreviewData = {
    status: "authorised",
    variantId: record.variantId,
    document,
    variant,
    audience: record.audience,
    locale: {
      tag: decision.servedLocale,
      direction: decision.direction,
    },
    revision: revisionOf(admitted, rendered.document),
    renderedHtml: rendered.html,
    placements,
    renditionIds: decision.renditionIds,
    inert: decision.inert,
    givingAction: decision.givingAction,
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        placements: placements.length === 0 ? "zero" : "value",
        renditionIds: decision.renditionIds.length === 0 ? "zero" : "value",
      },
      // A preview offers no effect at all: rendering it sends no message, subscribes nobody, publishes
      // nothing and starts no checkout, so there is no action to offer here — and no way for a surface
      // to present one.
      actions: [],
    }),
  };
}
function candidateFor(state: ContentWorkspaceState, record: ContentVariantRecordLike, candidateId: string | undefined): ContentCandidate | undefined {
  if (candidateId === undefined || !isNonEmptyString(candidateId)) {
    return undefined;
  }
  if (record.candidateId !== candidateId) {
    return undefined;
  }
  const frozen = findRevision(state, candidateId);
  if (frozen === undefined || frozen.variantId !== record.variantId) {
    return undefined;
  }
  return {
    candidateId,
    variantId: frozen.variantId,
    revisionId: frozen.revisionId,
    contentChecksum: frozen.contentChecksum,
    frozenAt: Temporal.Instant.from(frozen.createdAt),
    reviewRound: REVIEW_STEPS_PER_CANDIDATE,
  };
}
// readSharePresentation — the card a shared link shows
/** The image a share card shows: the asset's opaque identity, the display rendition this caller may request, and the state of that rendition. */
export interface ShareImageView {
  readonly assetId: string;
  readonly renditionId: string | null;
  readonly path: string | null;
  readonly altText: string | null;
  readonly state: "ready" | "unavailable";
  readonly reason: MediaStateReason | null;
}
/** What a share presentation states: a card, or the tombstone a withdrawn edition answers with. */
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
  | {
      readonly status: "withdrawn";
      readonly variantId: string;
      readonly documentId: string;
      readonly canonicalPath: string;
      readonly tombstone: Tombstone;
    }
  | {
      readonly status: "no-presentation";
      readonly variantId: string;
      readonly documentId: string;
      readonly family: ContentFamily;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly reason: string;
    };
/** Reads the share card of one edition: its title, its description, its chosen share image as an opaque rendition identity, the canonical path for its family and its direction metadata. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSharePresentation(input: { readonly variantId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<SharePresentationData>>> {
  const opened = await openContentWorkspace("readSharePresentation", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }
  if (record.audience === "approved-supporter") {
    // A protected edition's very title is protected: the card is answered only to the principal who
    // may change the edition, and refused with the one code a missing edition answers with.
    const editorialAccess = canEdit(workspace.session, {
      kind: "content-variant",
      scope: workspace.scope,
    });
    if (!editorialAccess.allowed) {
      return { kind: "denied", denied: editorialAccess.denial };
    }
  }
  const family = documentRecord.family;
  const locale = localeOf(record.locale, record.direction);
  const canonicalPath = canonicalPathOf(family, documentRecord.documentId, record.locale);
  const head = headReleaseOf(workspace.state, record);
  if (head !== undefined && isWithdrawnRelease(head)) {
    const data: SharePresentationData = {
      status: "withdrawn",
      variantId: record.variantId,
      documentId: documentRecord.documentId,
      canonicalPath,
      tombstone: tombstoneFor(workspace, head),
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {},
        actions: [],
      }),
    };
  }
  // A shared link points at what readers are given, so the release's revision is the card's source.
  // An edition with no release yet is still being composed, and its draft is what its author is
  // preparing to share.
  const source = head !== undefined ? findRevision(workspace.state, head.revisionId) : undefined;
  const composing = record.draftRevisionId === null ? undefined : findRevision(workspace.state, record.draftRevisionId);
  const presentationSource = source ?? composing;
  if (presentationSource === undefined) {
    const data: SharePresentationData = {
      status: "no-presentation",
      variantId: record.variantId,
      documentId: documentRecord.documentId,
      family,
      audience: record.audience,
      locale,
      reason: "This edition has neither a released revision nor a saved draft, so there is nothing to present.",
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {},
        actions: [],
      }),
    };
  }
  const share = presentationSource.sharePresentation;
  // The revision states the card's own title. The managed title of the document is not stored by this
  // release, so it is never substituted here: a card that invented a heading would be describing the
  // edition with words the source never supplied.
  const image = shareImageView(workspace, share);
  const reach = head === undefined ? undefined : reachMetadata({ reach: head.reach, withdrawnAt: head.withdrawnAt });
  const data: SharePresentationData = {
    status: "shareable",
    variantId: record.variantId,
    documentId: documentRecord.documentId,
    family,
    audience: record.audience,
    locale,
    title: share.title,
    description: share.description,
    image,
    canonicalPath,
    robots: reach?.robots ?? null,
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        image: image === null ? "zero" : image.state === "ready" ? "value" : "unavailable",
      },
      actions: [{ name: "open-canonical-address", available: true }],
    }),
  };
}
function shareImageView(workspace: ContentWorkspace, share: SharePresentationRecord): ShareImageView | null {
  if (share.imageAssetId === null) {
    return null;
  }
  const asset = workspace.state.mediaAssets.find((candidate) => candidate.assetId === share.imageAssetId);
  const unavailable: ShareImageView = {
    assetId: share.imageAssetId,
    renditionId: null,
    path: null,
    altText: share.imageAltText,
    state: "unavailable",
    reason: mediaStateReason("unavailable"),
  };
  if (asset === undefined) {
    return unavailable;
  }
  const readable = canView(workspace.session, { kind: "media-asset", scope: asset.scope });
  if (!readable.allowed) {
    return unavailable;
  }
  const visible = project(asset, VISIBLE_MEDIA_ASSET_FIELDS);
  const display = visible.renditions.find((rendition) => rendition.purpose === mainRenditionPurpose(visible.kind));
  if (display === undefined) {
    return unavailable;
  }
  return {
    assetId: visible.assetId,
    renditionId: display.renditionId,
    path: renditionPath(visible.assetId, display.renditionId),
    altText: share.imageAltText,
    state: "ready",
    reason: null,
  };
}
// readPageCatalogues — the two guided family catalogues
const PAGE_SECTION_TYPES = ["introduction", "story", "prayer", "milestone", "image", "video", "giving", "progress"] as const;
/** One section type a page catalogue offers. */
export type PageSectionType = (typeof PAGE_SECTION_TYPES)[number];

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

const SECTION_LOCK_REASON_KEYS: Readonly<Record<string, string>> = {
  giving: "giving-binding",
  progress: "support-progress",
};
const MANAGED_FIELD_LOCK_REASON_KEYS: Readonly<Record<string, string>> = {
  title: "page-subject",
  givingBinding: "giving-binding",
  legalIdentity: "legal-identity",
  supportProgress: "support-progress",
};
const SOURCE_SUPPLIED_LOCK_REASON_KEY = "source-supplied-section";

const PAGE_FAMILIES = ["worker-page", "project-page"] as const;

const PAGE_STRUCTURAL_OPERATIONS = ["add", "move-up", "move-down", "move-to-position", "duplicate", "remove"] as const;
/** One structural change a section can be given. */
export type PageStructuralOperation = (typeof PAGE_STRUCTURAL_OPERATIONS)[number];
/** One preset: a proposed composition that produces a reviewable draft and releases nothing. */
export interface PagePresetView {
  readonly presetId: string;
  readonly sections: readonly PageSectionType[];
  readonly creates: "reviewable-draft";
}
const PAGE_PRESETS: readonly PagePresetView[] = [
  {
    presetId: "preset-opening-and-story",
    sections: ["introduction", "story"],
    creates: "reviewable-draft",
  },
  {
    presetId: "preset-story-and-prayer",
    sections: ["story", "prayer"],
    creates: "reviewable-draft",
  },
];
/** One section type as a catalogue lists it. */
export interface PageCatalogueSectionView {
  readonly key: PageSectionType;
  readonly labelKey: string;
  readonly managed: boolean;
  readonly lockReasonKey: string | null;
  readonly fields: readonly string[];
  readonly presentation: ContentPresentationChoices;
}
/** One family's catalogue. */
export interface PageCatalogueView {
  readonly family: ContentFamily;
  readonly labelKey: string;
  readonly sections: readonly PageCatalogueSectionView[];
}
/** What a catalogue read states: both families' catalogues and the operations they permit. */
export interface PageCataloguesData {
  readonly catalogues: readonly PageCatalogueView[];
  readonly presentation: ContentPresentationChoices;
  readonly structuralOperations: readonly PageStructuralOperation[];
  readonly presets: readonly PagePresetView[];
}
/** Reads the two guided family catalogues: the eight admitted section types each offers, the fields and presentation choices each admits, which are managed and why, the structural operations. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPageCatalogues(input: { readonly session?: SessionSource } = {}): Promise<ReadResult<ReadEnvelope<PageCataloguesData>>> {
  const opened = await openContentWorkspace("readPageCatalogues", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  const sections: readonly PageCatalogueSectionView[] = PAGE_SECTION_TYPES.map((key) => ({
    key,
    labelKey: `catalogue.${key}`,
    managed: MANAGED_SECTION_TYPES.has(key),
    lockReasonKey: SECTION_LOCK_REASON_KEYS[key] ?? null,
    fields: SECTION_FIELD_KEYS[key],
    presentation: PRESENTATION_CHOICES,
  }));
  const data: PageCataloguesData = {
    catalogues: PAGE_FAMILIES.map((family) => ({
      family,
      labelKey: `catalogue.family.${family}`,
      sections,
    })),
    presentation: PRESENTATION_CHOICES,
    structuralOperations: PAGE_STRUCTURAL_OPERATIONS,
    presets: PAGE_PRESETS,
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource("page-catalogues"),
      revision: PAGE_CATALOGUE_REVISION,
      valueStates: {
        catalogues: "value",
        sectionTypes: "value",
        presets: PAGE_PRESETS.length === 0 ? "zero" : "value",
      },
      actions: [{ name: "add-section", available: true }],
    }),
  };
}
// readPage — one Page, its locked fields, its ordered sections and its editions
/** One field a source owns, stated as locked rather than hidden and with the reason key it carries. */
export interface PageManagedFieldView {
  readonly key: string;
  readonly locked: true;
  readonly lockReasonKey: string;
}
/** One composed section as the builder lists it: its catalogue key, its fields and its media. */
export interface PageSectionView {
  readonly position: number;
  readonly element: string;
  readonly inCatalogue: boolean;
  readonly managed: boolean;
  readonly lockReasonKey: string | null;
  readonly fields: Readonly<Record<string, string>>;
  readonly presentation: PresentationChoice;
  readonly direction: string | null;
  readonly placements: readonly ContentPlacementView[];
}
/** What a page read states about the edition being composed. */
export interface PageDocumentData {
  readonly document: ContentDocumentView;
  readonly family: ContentFamily;
  readonly kind: ContentKind;
  readonly managedFields: readonly PageManagedFieldView[];
  readonly givingBinding: { readonly designation: SourceReference; readonly label: string } | null;
  readonly draft: {
    readonly variantId: string;
    readonly revisionId: string;
    readonly recordRevision: string;
  } | null;
  readonly sections: readonly PageSectionView[];
  readonly presets: readonly PagePresetView[];
  readonly editions: readonly ContentEditionView[];
  readonly reachOptions: readonly Reach[];
}
/** Reads one Page: its family and kind, the fields a source locks with the reason for each, its giving binding, the ordered sections of the edition being composed, the presets, every locale. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPage(input: { readonly pageId: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<PageDocumentData>>> {
  const opened = await openContentWorkspace("readPage", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.pageId)) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, input.pageId);
  if (documentRecord === undefined || documentRecord.family === "update") {
    // An Update is not a Page: it has no section catalogue, no reach setting and no locale edition of
    // its own, so it is refused exactly as a document this session does not hold.
    return recordNotFound();
  }
  const checksums = checksumsOf(workspace.state);
  const editions = variantsOf(workspace.state, documentRecord.documentId).map((variant) => editionViewOf(workspace.state, variant, checksums));
  const variantRecords = variantsOf(workspace.state, documentRecord.documentId);
  // The edition being composed is the one holding a draft. With no draft anywhere, the first edition
  // is the one a builder opens, so a page is never refused merely because nothing is saved yet.
  const draftVariant = variantRecords.find((variant) => variant.draftRevisionId !== null) ?? variantRecords[0];
  const draftRevision = draftVariant === undefined || draftVariant.draftRevisionId === null ? undefined : findRevision(workspace.state, draftVariant.draftRevisionId);
  const parsedDraft = draftRevision === undefined ? undefined : parseDocument(draftRevision.body);
  const sections = draftRevision !== undefined && parsedDraft !== undefined && parsedDraft.status === "valid" ? sectionViewsOf(workspace, parsedDraft.document, draftRevision) : [];
  const data: PageDocumentData = {
    document: documentViewOf(documentRecord),
    family: documentRecord.family,
    kind: documentRecord.kind,
    managedFields: documentRecord.managedFields.map((key) => ({
      key,
      locked: true,
      lockReasonKey: MANAGED_FIELD_LOCK_REASON_KEYS[key] ?? SOURCE_SUPPLIED_LOCK_REASON_KEY,
    })),
    givingBinding:
      documentRecord.givingBinding === null
        ? null
        : {
            designation: documentRecord.givingBinding.designation,
            label: documentRecord.givingBinding.label,
          },
    draft:
      draftVariant === undefined || draftVariant.draftRevisionId === null
        ? null
        : {
            variantId: draftVariant.variantId,
            revisionId: draftVariant.draftRevisionId,
            recordRevision: draftVariant.revision,
          },
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
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: documentRecord.revision,
      valueStates: {
        sections: hasSection ? "value" : "zero",
        placements: sections.some((section) => section.placements.length > 0) ? "value" : "zero",
        editions: editions.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "add-section", available: true },
        {
          name: "move-section-up",
          available: hasOrder,
          ...(hasOrder ? {} : { reason: "A single section has no order to change." }),
        },
        {
          name: "move-section-down",
          available: hasOrder,
          ...(hasOrder ? {} : { reason: "A single section has no order to change." }),
        },
        {
          name: "move-section-to-position",
          available: hasOrder,
          ...(hasOrder ? {} : { reason: "A single section has no position to move to." }),
        },
        {
          name: "duplicate-section",
          available: hasSection,
          ...(hasSection ? {} : { reason: "There is no section to duplicate yet." }),
        },
        {
          name: "remove-section",
          available: hasSection,
          ...(hasSection ? {} : { reason: "There is no section to remove yet." }),
        },
        {
          name: "save-section-fields",
          available: hasSection,
          ...(hasSection ? {} : { reason: "There is no section whose fields could be saved." }),
        },
        { name: "apply-preset", available: true },
        { name: "save-draft", available: true },
        { name: "submit-for-review", available: true },
        {
          name: "publish-variants",
          available: hasCandidate,
          ...(hasCandidate ? {} : { reason: "No edition has a frozen candidate to release." }),
        },
        {
          name: "set-reach",
          available: hasRelease,
          ...(hasRelease ? {} : { reason: "Reach belongs to a released edition, and none exists yet." }),
        },
        {
          name: "stop-showing-publicly",
          available: showsPublicly,
          ...(showsPublicly
            ? {}
            : {
                reason: "No edition of this page is public or listed, so there is nothing to contain.",
              }),
        },
        {
          name: "withdraw-page",
          available: hasRelease,
          ...(hasRelease ? {} : { reason: "There is no publication to withdraw." }),
        },
      ],
    }),
  };
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
// readPageLocales — the locale editions, the fallback and *Language unavailable*
/** Where the locale a read resolved against came from: the caller, or the document's own default. */
export type RequestedLocaleSource = "caller" | "document-default";
/** What a locale read states: the resolution, the editions, and the locales a reader may choose. */
export interface PageLocalesData {
  readonly document: ContentDocumentView;
  readonly requestedLocale: string;
  readonly requestedLocaleSource: RequestedLocaleSource;
  readonly resolution: LocaleResolution;
  readonly editions: readonly ContentEditionView[];
  readonly admittedLocales: readonly AdmittedLocale[];
}
/** Reads the locale editions of one Page: the requested language, the editions that exist with their own pointers, the resolution `locale.ts` answers, and the locales a reader may choose. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPageLocales(input: { readonly pageId: string; readonly requestedLocale?: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<PageLocalesData>>> {
  const opened = await openContentWorkspace("readPageLocales", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.pageId)) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, input.pageId);
  if (documentRecord === undefined || documentRecord.family === "update") {
    return recordNotFound();
  }
  const checksums = checksumsOf(workspace.state);
  const variantRecords = variantsOf(workspace.state, documentRecord.documentId);
  const editions = variantRecords.map((variant) => editionViewOf(workspace.state, variant, checksums));
  const newest = newestReleaseOf(releasesOf(workspace.state, documentRecord.documentId));
  const documentDefault = newest?.locale ?? variantRecords[0]?.locale ?? "";
  const asked = input.requestedLocale;
  const requestedLocale = isNonEmptyString(asked) ? asked : documentDefault;
  const requestedLocaleSource: RequestedLocaleSource = isNonEmptyString(asked) ? "caller" : "document-default";
  // A Page edition is public: the approved-supporter audience belongs to an Update, so the public
  // audience is the only one this resolution ever reads, and no audience x locale cross-product is
  // even representable here.
  const releases: readonly (Release & { readonly documentId: string; readonly siteId: string })[] = releasesOf(workspace.state, documentRecord.documentId).map((release) => ({
    ...releaseOf(release, checksums),
    documentId: documentRecord.documentId,
    siteId: documentRecord.siteId,
  }));
  const query = {
    document: documentOf(documentRecord),
    siteDefaultLocale: NO_DECLARED_SITE_DEFAULT,
    audience: "public" as const,
    releases,
  };
  const resolution = resolveLocale({ ...query, requestedLocale });
  const data: PageLocalesData = {
    document: documentViewOf(documentRecord),
    requestedLocale,
    requestedLocaleSource,
    resolution,
    editions,
    admittedLocales: admittedLocales(query),
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: documentRecord.revision,
      valueStates: {
        editions: editions.length === 0 ? "zero" : "value",
        admittedLocales: admittedLocales(query).length === 0 ? "zero" : "value",
        "resolution.servedLocale": resolution.status === "resolved" ? "value" : "unavailable",
      },
      actions: [
        { name: "add-locale-edition", available: true },
        {
          name: "open-edition",
          available: resolution.status === "resolved",
          ...(resolution.status === "resolved"
            ? {}
            : {
                reason: "No permitted edition serves this language, so there is nothing to open.",
              }),
        },
      ],
    }),
  };
}
// readGivingBinding — one approved Designation, or *Giving unavailable*, and a qualified progress
/** The closed set of reasons a release can show no giving at all. */
export type GivingUnavailableCause = "missing" | "revoked" | "incompatible";
/** What a Give placement receives: the one approved Designation with its identity, or the reason there is none. */
export type GivingBindingView =
  | {
      readonly state: "approved";
      readonly designationLabel: string;
      readonly designationRef: SourceReference;
    }
  | { readonly state: "unavailable"; readonly cause: GivingUnavailableCause };
/** The qualified progress a page may show: the goal the source states, the measure it counts, the currency, the period and how much of that period the source covers. */
export interface GivingProgressView {
  readonly measure: SupportGoalMeasure;
  readonly basis: SupportBasis;
  readonly goal: { readonly currency: string; readonly minorUnits: number };
  readonly currency: string;
  readonly currencyExponent: number;
  readonly period: Coverage;
  readonly coverage: CoverageState;
  readonly source: SourceReference;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
}
/** What a giving read states: the placement's binding, the release it belongs to, and its progress. */
export interface GivingBindingData {
  readonly document: ContentDocumentView;
  readonly release: {
    readonly releaseId: string;
    readonly variantId: string;
    readonly locale: ContentLocale;
    readonly publishedAt: string;
    readonly reach: Reach;
    readonly withdrawnAt: string | null;
  } | null;
  readonly binding: GivingBindingView;
  readonly detail: string | null;
  readonly progress: GivingProgressView | null;
  readonly inert: true;
  readonly givingAction: "none";
}
/** Reads the one approved giving Designation a page release may place, or states *Giving unavailable* with its reason, together with the progress module when the source qualifies one. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readGivingBinding(input: { readonly documentId: string; readonly releaseId?: string; readonly session?: SessionSource }): Promise<ReadResult<ReadEnvelope<GivingBindingData>>> {
  const opened = await openContentWorkspace("readGivingBinding", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.documentId)) {
    return recordNotFound();
  }
  const requestedReleaseId = input.releaseId;
  if (requestedReleaseId !== undefined && !isNonEmptyString(requestedReleaseId)) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, input.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }
  const releases = releasesOf(workspace.state, documentRecord.documentId);
  const named = requestedReleaseId === undefined ? newestReleaseOf(releases) : releases.find((release) => release.releaseId === requestedReleaseId);
  if (requestedReleaseId !== undefined && named === undefined) {
    return recordNotFound();
  }
  const document = documentViewOf(documentRecord);
  const placement = givingPlacementOf(documentRecord, named);
  // Progress is its own catalogue section, not part of the giving designation: a page whose giving
  // destination is unavailable can still show how support is going, and one whose destination is
  // approved may still have no qualified progress. The two states are independent.
  const progress = documentRecord.family === "update" ? null : progressOf(workspace);
  const data: GivingBindingData = {
    document,
    release:
      named === undefined
        ? null
        : {
            releaseId: named.releaseId,
            variantId: named.variantId,
            locale: releaseLocaleOf(named.locale),
            publishedAt: named.publishedAt,
            reach: named.reach,
            withdrawnAt: named.withdrawnAt,
          },
    binding: placement.binding,
    detail: placement.detail,
    progress,
    inert: true,
    givingAction: "none",
  };
  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: documentRecord.revision,
      valueStates: {
        "binding.designation": placement.binding.state === "approved" ? "value" : "unavailable",
        // A page whose source qualifies no progress states none at all, which is `unknown`: the source
        // never established a figure, and that is not the same fact as a progress of zero.
        progress: progress === null ? "unknown" : "value",
        "progress.goal": progress === null ? "unknown" : "value",
      },
      actions: [
        {
          name: "start-giving",
          available: false,
          reason: "Giving is a simulated destination: no payment is taken, no checkout is started and no fund can be chosen on a page.",
        },
      ],
    }),
  };
}
function givingPlacementOf(document: ContentDocumentRecord, release: ReleaseRecord | undefined): { readonly binding: GivingBindingView; readonly detail: string | null } {
  if (document.family === "update") {
    return {
      binding: { state: "unavailable", cause: "incompatible" },
      detail: "A Give placement belongs to a Worker or Project Page. An Update carries none, so there is no designation to show.",
    };
  }
  if (release !== undefined && release.withdrawnAt !== null) {
    return {
      binding: { state: "unavailable", cause: "incompatible" },
      detail: "This edition has been withdrawn, so its address serves a tombstone and no giving destination.",
    };
  }
  if (document.givingBinding === null) {
    return {
      binding: { state: "unavailable", cause: "missing" },
      detail: "No giving designation is approved for this page, and no default destination stands in its place.",
    };
  }
  return {
    binding: {
      state: "approved",
      designationLabel: document.givingBinding.label,
      designationRef: document.givingBinding.designation,
    },
    detail: null,
  };
}
function progressOf(workspace: ContentWorkspace): GivingProgressView | null {
  const projection: SupportProjectionRecord | null | undefined = workspace.state.supportProjection;
  if (projection === null || projection === undefined) {
    return null;
  }
  const goal = projection.goal;
  if (goal === null) {
    return null;
  }
  if (goal.measure !== "received-support" || projection.basis !== "effective_cash_allocation") {
    return null;
  }
  const exponent = projection.currencyExponents[goal.amount.currency];
  if (exponent === undefined) {
    return null;
  }
  if (projection.coverage.state === "unknown") {
    return null;
  }
  return {
    measure: goal.measure,
    basis: projection.basis,
    goal: { currency: goal.amount.currency, minorUnits: goal.amount.minorUnits },
    currency: goal.amount.currency,
    currencyExponent: exponent,
    period: projection.coverage,
    coverage: projection.coverage.state,
    source: projection.source,
    asOf: projection.asOf,
    lastSourceUpdate: projection.lastSourceUpdate,
  };
}
