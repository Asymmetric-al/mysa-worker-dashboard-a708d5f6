import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { compareCodeUnits } from "@/lib/ordering";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
import { eligibleRecipients, type NotificationIntent as EligibilityIntent, type EligibilityResult } from "@/modules/audience/resolve";
import { parseDocument, presentationChoiceSchema, type ContentDocumentJson, type ContentSection, type DocumentIssue, type PresentationChoice } from "@/modules/content/document";
import { directionOfTag } from "@/modules/content/locale";
import { buildNotice, resolveRendition, type RenditionCandidate as NoticeRenditionCandidate, type NoticeRecipient } from "@/modules/content/notice";
import { containEditions, decideReach, withdrawEdition } from "@/modules/content/reach";
import { VARIANT_AUDIENCES, VARIANT_FAMILIES, admittedAudiences, applyDraftRevision, applyReleaseOutcome, applyReviewDecision, createRelease, createRevision, createVariant as buildVariant, freezeCandidate, isReleaseUnchanged, restoreAsNewDraft, revisionChecksum, variantKeyAllowed } from "@/modules/content/variant";
import type { ContentRevision, ContentVariant, MediaPlacement, Release, VariantAudience, VariantFamily } from "@/modules/content/variant";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import { canonicalJson } from "@/modules/import/receipt";
import { uploadedMediaReference, writeMediaBytes } from "@/modules/store/media";
import { RENDITION_PURPOSES, acceptImage, acceptVideo, mediaStateReason, prepareRendition, type MediaAcceptanceSuccess, type MediaAssetScope, type MediaProfileCheck, type MediaRefusal, type MediaRendition, type MediaTagVerification } from "@/modules/media/asset";
import { instantAt } from "@/modules/time/clock";
import { notificationDeadline } from "@/modules/time/window";
import { canEdit, type ResolvedSession, type ScopeDecision } from "../authorize";
import { PAGE_PRESET_IDS, PAGE_SECTION_TYPES, contentDocumentRecordSchema, contentVariantRecordSchema, mediaAssetRecordSchema, membershipRecordSchema, notificationIntentRecordSchema, notificationSendResultRecordSchema, principalIdSchema } from "../envelope";
import { recordRevisionSchema, releaseRecordSchema, storedContentRevisionRecordSchema, releaseReachSchema, storedInstantSchema } from "../envelope";
import type { ContentCaptionTrackRecord, ContentDocumentRecord, ContentFamily, ContentVariantRecord, MediaAssetRecord, MediaAssetRenditionPurpose, MediaPlacementRecord, MembershipRecord as StoredMembership, MutationInput, PagePresetId, PageSectionType, PrincipalId, NotificationIntentRecord } from "../envelope";
import type { NotificationRecipientOutcomeRecord, NotificationSendResultRecord, NotificationUnservedRecipientRecord, ReleaseReach, ReleaseRecord, Scope, SharePresentationRecord, StoredContentRevisionRecord, StoredRecord } from "../envelope";
import { unknown, type MutationOutcome, type MutationResult, type PerItemResult } from "../outcome";
import { runMutation, type ApplyResult, type CurrentTarget, type MutationContext, type MutationName } from "../operations";
import { contentRevisionOf, contentVariantOf, membershipOf, storedInstantOf } from "../projection";
export const PUBLISH_MODES = ["publish-only", "publish-and-notify"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];
export const PER_VARIANT_RELEASE_STATES = ["released", "failed-prior-good-head", "needs-attention"] as const;
export type PerVariantReleaseState = (typeof PER_VARIANT_RELEASE_STATES)[number];
export const REVIEW_DECISIONS = ["submitted", "approved", "changes-requested", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
type SectionFieldKeys = Readonly<Record<PageSectionType, readonly string[]>>;
const SECTION_FIELD_KEYS: SectionFieldKeys = { introduction: ["heading", "body"], story: ["heading", "body"], prayer: ["heading", "body"], milestone: ["heading", "date", "body"], image: ["altText", "caption", "credit"], video: ["altText", "caption", "credit", "language"], giving: [], progress: [] };
const MANAGED_SECTION_TYPES: ReadonlySet<string> = new Set<string>(["giving", "progress"]);
const DEFAULT_PRESENTATION: PresentationChoice = { treatment: "normal", layout: "single-column", alignment: "start", imageFit: "cover" };
const PAGE_PRESETS: Readonly<Record<PagePresetId, readonly PageSectionType[]>> = { "preset-opening-and-story": ["introduction", "story"], "preset-story-and-prayer": ["story", "prayer"] };
const NOTICE_SENDER = Object.freeze({ name: "Update notices", address: "update-notice@example.invalid" });
const UNNAMED_PUBLISHER = "";
type StoredContentRevision = StoredContentRevisionRecord;
const contentReviewRecordSchema = z.object({
  candidateId: z.string().min(1),
  variantId: z.string().min(1),
  revisionId: z.string().min(1),
  notifyMode: z.enum(PUBLISH_MODES),
  decision: z.enum(REVIEW_DECISIONS),
  note: z.string().nullable(),
  submittedAt: storedInstantSchema,
  decidedAt: storedInstantSchema.nullable(),
  decidedByPrincipalId: z.string().min(1).nullable(),
  revision: recordRevisionSchema,
});
type ContentReviewRecord = StoredRecord<z.infer<typeof contentReviewRecordSchema>>;
const mediaAssetDescriptorRecordSchema = z.object({
  assetId: z.string().min(1),
  altText: z.string().min(1).nullable(),
  caption: z.string().min(1).nullable(),
  credit: z.string().min(1).nullable(),
  language: z.string().min(1).nullable(),
  captionLabel: z.string().min(1).max(120).nullable().optional(),
  revision: recordRevisionSchema,
});
type MediaAssetDescriptorRecord = StoredRecord<z.infer<typeof mediaAssetDescriptorRecordSchema>>;
const contentMutationStateSchema = z.object({
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  contentRevisions: z.array(storedContentRevisionRecordSchema),
  releases: z.array(releaseRecordSchema),
  mediaAssets: z.array(mediaAssetRecordSchema),
  memberships: z.array(membershipRecordSchema),
  notificationIntents: z.array(notificationIntentRecordSchema),
  notificationResults: z.array(notificationSendResultRecordSchema),
  contentReviews: z.array(contentReviewRecordSchema).optional(),
  mediaAssetDescriptors: z.array(mediaAssetDescriptorRecordSchema).optional(),
});
type ContentMutationState = {
  readonly contentDocuments: readonly ContentDocumentRecord[];
  readonly contentVariants: readonly ContentVariantRecord[];
  readonly contentRevisions: readonly StoredContentRevision[];
  readonly releases: readonly ReleaseRecord[];
  readonly mediaAssets: readonly MediaAssetRecord[];
  readonly memberships: readonly StoredMembership[];
  readonly notificationIntents: readonly NotificationIntentRecord[];
  readonly notificationResults: readonly NotificationSendResultRecord[];
  readonly contentReviews: readonly ContentReviewRecord[];
  readonly mediaAssetDescriptors: readonly MediaAssetDescriptorRecord[];
};
const INITIAL_REVISION_TOKEN = "rev-1";
const newRecordId = (prefix: string): string => `${prefix}-${globalThis.crypto.randomUUID()}`;
function nextRevision(current: string): string {
  const digits = /^(.*?)(\d+)$/u.exec(current);
  if (digits === null) return `${current}.1`;
  const stem = digits[1] ?? "";
  const ordinal = Number.parseInt(digits[2] ?? "", 10);
  return `${stem}${Number.isFinite(ordinal) ? ordinal + 1 : 1}`;
}
const scenarioInstant = (session: ResolvedSession): Temporal.Instant => instantAt(session.clockOffsetMs);
const invalidAt = (issues: readonly DocumentIssue[]): z.ZodError => new z.ZodError(issues.map((issue) => ({ code: "custom" as const, path: issue.path.split("."), message: issue.message })));
const invalidField = (path: string, message: string): z.ZodError => invalidAt([{ path, message }]);
function domainDocumentOf(record: ContentDocumentRecord): {
  readonly documentId: string;
  readonly family: VariantFamily;
  readonly kind: ContentDocumentRecord["kind"];
  readonly sourceSubject: ContentDocumentRecord["sourceSubject"];
  readonly siteId: string;
  readonly givingBinding?: ContentDocumentRecord["sourceSubject"];
  readonly managedFields: Readonly<Record<string, string>>;
} {
  return { documentId: record.documentId, family: record.family, kind: record.kind, sourceSubject: record.sourceSubject, siteId: record.siteId, ...(record.givingBinding === null ? {} : { givingBinding: record.givingBinding.designation }), managedFields: {} };
}
function storedVariantOf(variant: ContentVariant, revision: string): ContentVariantRecord {
  const translationSource = variant.translationSource === undefined ? null : { variantId: variant.translationSource.variantId, revisionId: variant.translationSource.revisionId };
  const draftRevisionId = variant.draftRevisionId ?? null;
  return { variantId: variant.variantId, documentId: variant.documentId, audience: variant.audience, locale: variant.locale.tag, direction: variant.locale.direction, draftRevisionId, candidateId: variant.candidateId ?? null, releaseHeadId: variant.releaseHeadId ?? null, translationSource, revision };
}
function domainReleaseOf(record: ReleaseRecord, variant: ContentVariantRecord | undefined, state: ContentMutationState): Release {
  const released = state.contentRevisions.find((candidate) => candidate.revisionId === record.revisionId);
  const withdrawnAt = storedInstantOf(record.withdrawnAt);
  return {
    releaseId: record.releaseId,
    variantId: record.variantId,
    revisionId: record.revisionId,
    audience: record.audience,
    locale: { tag: record.locale, direction: variant?.direction ?? directionOfTag(record.locale) },
    publishedAt: Temporal.Instant.from(record.publishedAt),
    reach: record.reach,
    contentChecksum: released?.contentChecksum ?? "",
    ...(withdrawnAt === undefined ? {} : { withdrawnAt }),
    ...(record.supersededBy === null ? {} : { supersededBy: record.supersededBy }),
  };
}
function editorialDecision(session: ResolvedSession, scope: Scope): ScopeDecision {
  const access = canEdit(session, { kind: "content-variant", scope });
  return access.allowed ? { ok: true } : { ok: false, denial: access.denial };
}
type EditorialSpec<P, R extends MutationResult> = { readonly readCurrent?: (documents: MutationContext["docs"], payload: P) => CurrentTarget; readonly apply: (context: MutationContext, payload: P) => ApplyResult<R> };
function runEditorial<P, R extends MutationResult>(sessionId: string, input: MutationInput<P>, schema: z.ZodType<P>, name: MutationName, spec: EditorialSpec<P, R>): Promise<MutationOutcome> {
  const { payload } = input;
  const read = spec.readCurrent;
  return runMutation<P, R>({ sessionId, input, schema, name, authorize: (session) => editorialDecision(session, input.scope), ...(read === undefined ? {} : { readCurrent: (documents: MutationContext["docs"]) => read(documents, payload) }), apply: (context) => spec.apply(context, payload) });
}
const UNRESOLVED_TARGET_REVISION = "no-such-record";
const unresolvedTarget = (): CurrentTarget => ({ kind: "record", revision: UNRESOLVED_TARGET_REVISION, value: null });
const recordTarget = (revision: string, value: unknown): CurrentTarget => ({ kind: "record", revision, value });
class ContentStateReadError extends Error {
  constructor() {
    super("The content records in this session's state document cannot be read, so nothing was written and no record was guessed at.");
    this.name = "CorruptJsonError";
    Object.setPrototypeOf(this, ContentStateReadError.prototype);
  }
}
type OpenedState = { readonly raw: Record<string, unknown>; readonly state: ContentMutationState };
function openState(docs: { readonly state: unknown }): OpenedState {
  if (!isRecord(docs.state)) throw new ContentStateReadError();
  const parsed = contentMutationStateSchema.safeParse(docs.state);
  if (!parsed.success) throw new ContentStateReadError();
  return { raw: docs.state, state: { ...parsed.data, contentReviews: parsed.data.contentReviews ?? [], mediaAssetDescriptors: parsed.data.mediaAssetDescriptors ?? [] } };
}
function writeState(docs: { state: unknown }, raw: Record<string, unknown>, next: Partial<ContentMutationState>): void {
  docs.state = { ...raw, ...next };
}
/** The one record of a stored family this action names, refused against the field it named when the context holds no such record. */
function requireRecord<T>(records: readonly T[], matches: (record: T) => boolean, field: string, message: string): T {
  const record = records.find(matches);
  if (record === undefined) throw invalidField(field, message);
  return record;
}
const requireDocument = (state: ContentMutationState, documentId: string): ContentDocumentRecord => requireRecord(state.contentDocuments, (candidate) => candidate.documentId === documentId, "documentId", "This action applies to a document this context does not hold.");
const requireVariant = (state: ContentMutationState, variantId: string): ContentVariantRecord => requireRecord(state.contentVariants, (candidate) => candidate.variantId === variantId, "variantId", "This action applies to an edition this context does not hold.");
const requireRevision = (state: ContentMutationState, revisionId: string): StoredContentRevision => requireRecord(state.contentRevisions, (candidate) => candidate.revisionId === revisionId, "revisionId", "This action applies to a revision this edition does not hold.");
const headReleaseOf = (state: ContentMutationState, variant: ContentVariantRecord): ReleaseRecord | undefined => (variant.releaseHeadId === null ? undefined : state.releases.find((candidate) => candidate.releaseId === variant.releaseHeadId));
const releasesOfDocument = (state: ContentMutationState, documentId: string): readonly ReleaseRecord[] => state.releases.filter((release) => new Set(state.contentVariants.filter((variant) => variant.documentId === documentId).map((variant) => variant.variantId)).has(release.variantId));
const replaceVariant = (variants: readonly ContentVariantRecord[], next: ContentVariantRecord): readonly ContentVariantRecord[] => variants.map((variant) => (variant.variantId === next.variantId ? next : variant));
const replaceRelease = (releases: readonly ReleaseRecord[], next: ReleaseRecord): readonly ReleaseRecord[] => releases.map((release) => (release.releaseId === next.releaseId ? next : release));
function storedReleaseOf(release: Release, revision: string, previous: ReleaseRecord | undefined): ReleaseRecord {
  const withdrawnAt = release.withdrawnAt ?? previous?.withdrawnAt ?? null;
  const supersededBy = release.supersededBy ?? previous?.supersededBy ?? null;
  const publishedAt = release.publishedAt.toString();
  return { releaseId: release.releaseId, variantId: release.variantId, revisionId: release.revisionId, audience: release.audience, locale: release.locale.tag, publishedAt, reach: release.reach, withdrawnAt: withdrawnAt === null ? null : withdrawnAt.toString(), supersededBy, revision };
}
function requireEditableSection(sections: readonly ContentSection[], sectionId: string): { readonly sections: readonly ContentSection[]; readonly index: number; readonly section: ContentSection } {
  const index = sectionIndexOf(sections, sectionId);
  const section = sections[index];
  if (section === undefined) throw invalidField("sectionId", "This page holds no section by that identity.");
  if (MANAGED_SECTION_TYPES.has(section.element)) throw invalidField("sectionId", MANAGED_SECTION_REFUSAL);
  return { sections, index, section };
}
function requireSectionType(value: string): PageSectionType {
  const admitted = PAGE_SECTION_TYPES.find((type) => type === value);
  if (admitted === undefined) throw invalidField("sectionType", "A section type is one the page catalogue admits, and this one is not in it.");
  return admitted;
}
const RECORD_REFERENCE_MESSAGE = "This action applies to one record, so open the record again and retry rather than pasting an address.";
const recordIdSchema = z.string({ error: RECORD_REFERENCE_MESSAGE }).trim().min(1, RECORD_REFERENCE_MESSAGE).max(160, RECORD_REFERENCE_MESSAGE);
const localeTagSchema = z
  .string({ error: "State the content locale this edition is written in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u, "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.");
const familySchema = z.enum(VARIANT_FAMILIES, { error: "A content document is an update, a worker page or a project page." });
const audienceSchema = z.enum(VARIANT_AUDIENCES, { error: "Choose the audience this edition serves: public or approved supporters." });
const publishModeSchema = z.enum(PUBLISH_MODES, { error: "Choose how this edition is released: publish only, or publish and notify now." });
const reachSchema = releaseReachSchema;
const PLACEMENT_TEXT_MAX_CHARS = 4_000;
const optionalPlacementTextSchema = z.string().trim().max(PLACEMENT_TEXT_MAX_CHARS, `A placement field holds at most ${PLACEMENT_TEXT_MAX_CHARS} characters, so shorten it.`).optional();
const placementTextSchema = z.strictObject({
  altText: z.string({ error: "Describe what this image or video shows." }).trim().min(1, "Describe what this image or video shows.").max(PLACEMENT_TEXT_MAX_CHARS, "Shorten the alternative text for this placement."),
  caption: optionalPlacementTextSchema,
  credit: optionalPlacementTextSchema,
});
const placementRefSchema = z.strictObject({
  placementId: recordIdSchema.optional(),
  assetId: recordIdSchema,
  purpose: z.enum(RENDITION_PURPOSES).optional(),
  altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional(),
  caption: optionalPlacementTextSchema,
  credit: optionalPlacementTextSchema,
  sectionElement: z.string().trim().min(1).optional(),
  position: z.int().nonnegative().optional(),
});
const captionTrackPayloadSchema = z.strictObject({ assetId: recordIdSchema, language: localeTagSchema, label: z.string().trim().min(1).max(120).optional(), isDefault: z.boolean().optional() });
const sharePresentationPayloadSchema = z.strictObject({ title: z.string().trim().max(200).optional(), description: z.string().trim().max(600).optional(), imageAssetId: recordIdSchema.nullable().optional(), imageAltText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).nullable().optional() });
const sectionFieldsSchema = z.record(z.string(), z.string());
const sectionPayloadSchema = z.strictObject({ element: z.string().trim().min(1, "A section states the catalogue element it was composed from."), fields: sectionFieldsSchema, presentation: presentationChoiceSchema, direction: z.enum(["ltr", "rtl"]).optional() });
const draftTargetShape = { draftRevisionId: recordIdSchema.optional(), variantId: recordIdSchema.optional() } as const;
const namesDraftTarget = (payload: { readonly draftRevisionId?: string; readonly variantId?: string }): boolean => payload.draftRevisionId !== undefined || payload.variantId !== undefined;
const refuseUnnamedDraftTarget = (payload: { readonly draftRevisionId?: string; readonly variantId?: string }, ctx: z.RefinementCtx): void => {
  if (!namesDraftTarget(payload)) ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: NO_DRAFT_TARGET_MESSAGE });
};
const NO_DRAFT_TARGET_MESSAGE = "Open the page's draft first: a section change names the draft revision it edits.";
function resolveDraftDocument(input: { readonly body: unknown; readonly sections: readonly ContentSection[] | undefined }): { readonly status: "valid"; readonly document: ContentDocumentJson } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] } {
  const parsed = parseDocument(input.body);
  return parsed.status === "invalid" || input.sections === undefined ? parsed : parseDocument({ ...parsed.document, sections: input.sections });
}
const UNTITLED_SHARE_TITLE = "Untitled";
// The share presentation one save states, where a stated `null` image is the author clearing it rather than the save leaving it unstated.
type StatedShare = { readonly title?: string; readonly description?: string; readonly imageAssetId?: string | null; readonly imageAltText?: string | null };
// The text one save states for a share field: a blank field is the author leaving the field out rather than emptying it.
const statedShareTextOf = (value: string | undefined): string | undefined => (value === undefined || value.trim().length === 0 ? undefined : value);
/** The share presentation one revision stores. */
function storedShareOf(share: StatedShare, previous: SharePresentationRecord | undefined): SharePresentationRecord {
  return {
    title: statedShareTextOf(share.title) ?? statedShareTextOf(previous?.title) ?? UNTITLED_SHARE_TITLE,
    description: statedShareTextOf(share.description) ?? previous?.description ?? "",
    imageAssetId: share.imageAssetId === undefined ? (previous?.imageAssetId ?? null) : share.imageAssetId,
    imageAltText: share.imageAltText ?? previous?.imageAltText ?? null,
  };
}
const COMPARED_REVISION_MEMBERS = ["mediaPlacements", "captions", "sharePresentation", "body"] as const;
// A save writes nothing when every member below already states what the save states, whatever order either side was assembled in: a stored body is canonicalised when it is written, while a freshly parsed one carries the profile's own member order. These members are the whole of what the revision digest is derived from — the body, the placements in authored order, the alternative text and captions those placements carry, and the share presentation — so comparing them is not weaker than comparing the digest, and it does not depend on a stored digest having been produced by the same formula.
const storedContentEquals = (left: StoredContentRevision, right: StoredContentRevision): boolean => COMPARED_REVISION_MEMBERS.every((member) => canonicalJson(left[member]) === canonicalJson(right[member]));
type ResolvedPlacements = { readonly placements: readonly MediaPlacementRecord[]; readonly altText: Readonly<Record<string, string>>; readonly captions: Readonly<Record<string, string>>; readonly tracks: readonly ContentCaptionTrackRecord[]; readonly domain: readonly MediaPlacement[] };
const UNPLACEABLE_ASSET = "This media asset is not one this edition may place, so choose an asset registered in this ministry.";
function resolvePlacements(input: { readonly state: ContentMutationState; readonly session: ResolvedSession; readonly previous: readonly MediaPlacementRecord[]; readonly requested: readonly z.infer<typeof placementRefSchema>[] }): ResolvedPlacements {
  const placements: MediaPlacementRecord[] = [];
  const altText: Record<string, string> = {};
  const captions: Record<string, string> = {};
  const tracks: ContentCaptionTrackRecord[] = [];
  const domain: MediaPlacement[] = [];
  const usedPlacementIds = new Set<string>();
  input.requested.forEach((requested, index) => {
    const field = `mediaPlacements.${String(index)}.assetId`;
    const asset = input.state.mediaAssets.find((candidate) => candidate.assetId === requested.assetId);
    if (asset === undefined) throw invalidField(field, UNPLACEABLE_ASSET);
    const descriptor = input.state.mediaAssetDescriptors.find((candidate) => candidate.assetId === requested.assetId);
    if (!canEdit(input.session, { kind: "media-asset", scope: asset.scope }).allowed) throw invalidField(field, UNPLACEABLE_ASSET);
    const purpose = requested.purpose ?? (asset.kind === "image" ? "display" : "playback");
    if (!asset.renditions.some((entry) => entry.purpose === purpose)) throw invalidField(field, `This asset has no ${purpose} rendition yet, so it cannot be placed for that purpose.`);
    const description = requested.altText ?? descriptor?.altText ?? undefined;
    if (description === undefined) throw invalidField(field, "Describe what this image or video shows, because every placement states the alternative text a reader is given.");
    const caption = requested.caption ?? descriptor?.caption ?? null;
    const credit = requested.credit ?? descriptor?.credit ?? null;
    const previousAtPosition = input.previous[index];
    const placementId = requested.placementId ?? (previousAtPosition !== undefined && previousAtPosition.assetId === asset.assetId ? previousAtPosition.placementId : undefined) ?? newRecordId("placement");
    if (usedPlacementIds.has(placementId)) throw invalidField(`mediaPlacements.${String(index)}.placementId`, "Two placements of this draft share one identity, so each placement needs its own.");
    usedPlacementIds.add(placementId);
    placements.push({ placementId, assetId: asset.assetId, sectionElement: requested.sectionElement ?? null, position: requested.position ?? index, altText: description, caption, credit });
    altText[placementId] = description;
    if (caption !== null) captions[placementId] = caption;
    domain.push({ placementId, assetId: asset.assetId });
    const captionRendition = asset.renditions.find((entry) => entry.purpose === "captions");
    const descriptorLanguage = descriptor?.language ?? null;
    // The track is named by the label the person who placed it stated, and falls back to the media's own language when they left one out.
    const descriptorLabel = descriptor?.captionLabel ?? null;
    if (asset.kind === "video" && captionRendition !== undefined && descriptorLanguage !== null) tracks.push({ assetId: asset.assetId, renditionId: captionRendition.renditionId, language: descriptorLanguage, label: descriptorLabel ?? descriptorLanguage, isDefault: tracks.length === 0 });
  });
  return { placements, altText, captions, tracks, domain };
}
function resolveCaptionTracks(input: { readonly state: ContentMutationState; readonly requested: readonly z.infer<typeof captionTrackPayloadSchema>[] }): readonly ContentCaptionTrackRecord[] {
  return input.requested.map((requested, index) => {
    const asset = input.state.mediaAssets.find((candidate) => candidate.assetId === requested.assetId);
    const rendition = asset?.renditions.find((entry) => entry.purpose === "captions");
    if (asset === undefined || rendition === undefined) throw invalidField(`captions.${String(index)}.assetId`, "A caption track belongs to an admitted video that carries a caption rendition.");
    return { assetId: asset.assetId, renditionId: rendition.renditionId, language: requested.language, label: requested.label ?? requested.language, isDefault: requested.isDefault ?? index === 0 };
  });
}
const principalIdOf = (value: string): PrincipalId => principalIdSchema.parse(value);
function storedRevisionOf(input: { readonly revision: ContentRevision; readonly placements: readonly MediaPlacementRecord[]; readonly tracks: readonly ContentCaptionTrackRecord[]; readonly statedShare: StatedShare; readonly previousShare: SharePresentationRecord | undefined }): StoredContentRevision {
  const sharePresentation = storedShareOf(input.statedShare, input.previousShare);
  const authorPrincipalId = principalIdOf(input.revision.authorPrincipalId);
  const createdAt = input.revision.createdAt.toString();
  return { revisionId: input.revision.revisionId, variantId: input.revision.variantId, body: input.revision.body, mediaPlacements: [...input.placements], captions: [...input.tracks], sharePresentation, contentChecksum: input.revision.contentChecksum, authorPrincipalId, createdAt, revision: INITIAL_REVISION_TOKEN };
}
function requireParsedBody(record: StoredContentRevision): ContentDocumentJson {
  const parsed = parseDocument(record.body);
  if (parsed.status === "invalid") throw invalidAt(parsed.issues);
  return parsed.document;
}
function contentStateOrUndefined(docs: { readonly state: unknown }): OpenedState | undefined {
  try {
    return openState(docs);
  } catch {
    return undefined;
  }
}
const recordTargetOf = <T extends { readonly revision: string }>(record: T | undefined): CurrentTarget => (record === undefined ? unresolvedTarget() : recordTarget(record.revision, record));
const currentDocumentTarget = (documents: { readonly state: unknown }, documentId: string | undefined): CurrentTarget => recordTargetOf(contentStateOrUndefined(documents)?.state.contentDocuments.find((candidate) => candidate.documentId === documentId));
const currentVariantTarget = (documents: { readonly state: unknown }, variantId: string | undefined): CurrentTarget => recordTargetOf(contentStateOrUndefined(documents)?.state.contentVariants.find((candidate) => candidate.variantId === variantId));
function currentRevisionTarget(documents: { readonly state: unknown }, revisionId: string | undefined): CurrentTarget {
  const state = contentStateOrUndefined(documents)?.state;
  const revision = revisionId === undefined ? undefined : state?.contentRevisions.find((candidate) => candidate.revisionId === revisionId);
  return recordTargetOf(revision === undefined ? undefined : state?.contentVariants.find((candidate) => candidate.variantId === revision.variantId));
}
function currentVariantDocumentTarget(documents: { readonly state: unknown }, variantId: string | undefined): CurrentTarget {
  const opened = contentStateOrUndefined(documents);
  const variant = opened?.state.contentVariants.find((candidate) => candidate.variantId === variantId);
  return recordTargetOf(variant === undefined ? undefined : opened?.state.contentDocuments.find((candidate) => candidate.documentId === variant.documentId));
}
function currentDraftTarget(documents: { readonly state: unknown }, payload: { readonly draftRevisionId?: string; readonly variantId?: string }): CurrentTarget {
  const opened = contentStateOrUndefined(documents);
  const variantId = payload.variantId ?? opened?.state.contentRevisions.find((candidate) => candidate.revisionId === payload.draftRevisionId)?.variantId;
  return recordTargetOf(variantId === undefined ? undefined : opened?.state.contentVariants.find((candidate) => candidate.variantId === variantId));
}
type EditorialDocuments = MutationContext["docs"];
const documentTarget = (documents: EditorialDocuments, payload: { readonly documentId: string }): CurrentTarget => currentDocumentTarget(documents, payload.documentId);
const variantTarget = (documents: EditorialDocuments, payload: { readonly variantId: string }): CurrentTarget => currentVariantTarget(documents, payload.variantId);
const variantDocumentTarget = (documents: EditorialDocuments, payload: { readonly variantId: string }): CurrentTarget => currentVariantDocumentTarget(documents, payload.variantId);
const revisionTarget = (documents: EditorialDocuments, payload: { readonly revisionId: string }): CurrentTarget => currentRevisionTarget(documents, payload.revisionId);
const draftTarget = (documents: EditorialDocuments, payload: { readonly draftRevisionId?: string; readonly variantId?: string }): CurrentTarget => currentDraftTarget(documents, payload);
const createVariantPayloadSchema = z.strictObject({
  documentId: recordIdSchema,
  family: familySchema.optional(),
  audience: audienceSchema.optional(),
  locale: localeTagSchema,
  direction: z.enum(["ltr", "rtl"]).optional(),
  translationSource: z.strictObject({ variantId: recordIdSchema, revisionId: recordIdSchema }).optional(),
});
export type CreateVariantPayload = z.infer<typeof createVariantPayloadSchema>;
/** Creates one working edition of one document: an audience the family admits, in one exact content locale, with no draft, candidate or release yet. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const createVariant = async (sessionId: string, input: MutationInput<CreateVariantPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, createVariantPayloadSchema, "createVariant", { readCurrent: documentTarget, apply: applyCreateVariant });
function applyCreateVariant(context: MutationContext, payload: CreateVariantPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const document = requireDocument(state, payload.documentId);
  if (payload.family !== undefined && payload.family !== document.family) throw invalidField("family", "An edition belongs to the family its document is, so choose the family from the document.");
  const audience: VariantAudience = payload.audience ?? "public";
  if (!variantKeyAllowed(document.family, audience)) {
    const admitted = admittedAudiences(document.family);
    throw invalidField("audience", admitted.length === 0 ? `"${document.family}" is not a content family, so it admits no audience.` : `A ${document.family} admits ${admitted.join(" and ")} editions only.`);
  }
  const locale = { tag: payload.locale, direction: payload.direction ?? directionOfTag(payload.locale) };
  let translationSource: { readonly variant: ContentVariant; readonly revision: ContentRevision } | undefined;
  if (payload.translationSource !== undefined) {
    const source = requireVariant(state, payload.translationSource.variantId);
    const revision = requireRevision(state, payload.translationSource.revisionId);
    translationSource = { variant: contentVariantOf(source), revision: contentRevisionOf(revision, requireParsedBody(revision)) };
  }
  const created = buildVariant({
    variantId: newRecordId("variant"),
    document: domainDocumentOf(document),
    audience,
    locale,
    existingVariants: state.contentVariants.filter((candidate) => candidate.documentId === document.documentId).map(contentVariantOf),
    ...(translationSource === undefined ? {} : { translationSource }),
  });
  if (created.status === "invalid") throw invalidAt(created.issues);
  writeState(context.docs, raw, {
    contentVariants: [...state.contentVariants, storedVariantOf(created.variant, INITIAL_REVISION_TOKEN)],
    contentDocuments: state.contentDocuments.map((candidate) => (candidate.documentId === document.documentId ? { ...candidate, revision: nextRevision(candidate.revision) } : candidate)),
  });
  return { changed: true, revision: nextRevision(document.revision), result: { variantId: created.variant.variantId, documentId: document.documentId }, created: [created.variant.variantId] } satisfies ApplyResult<{ variantId: string; documentId: string }>;
}
const saveDraftPayloadSchema = z
  .strictObject({
    variantId: recordIdSchema,
    body: z.unknown(),
    sections: z.array(sectionPayloadSchema).optional(),
    contentChecksum: z.string().trim().min(1).max(96).optional(),
    mediaPlacements: z.array(placementRefSchema).optional(),
    captions: z.array(captionTrackPayloadSchema).optional(),
    sharePresentation: sharePresentationPayloadSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    const resolved = resolveDraftDocument({ body: payload.body, sections: payload.sections });
    if (resolved.status === "valid") return;
    for (const issue of resolved.issues) ctx.addIssue({ code: "custom", path: ["body", ...issue.path.split(".").filter((segment) => segment.length > 0)], message: issue.message });
  });
export type SaveDraftPayload = z.infer<typeof saveDraftPayloadSchema>;
/** Saves one variant's working revision, validating the authored document through the content profile. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const saveDraft = async (sessionId: string, input: MutationInput<SaveDraftPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, saveDraftPayloadSchema, "saveDraft", { readCurrent: variantTarget, apply: applySaveDraft });
function applySaveDraft(context: MutationContext, payload: SaveDraftPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const variant = requireVariant(state, payload.variantId);
  const draftRevision = variant.draftRevisionId === null ? undefined : state.contentRevisions.find((candidate) => candidate.revisionId === variant.draftRevisionId);
  // The revision this save supersedes: the edition's own draft, or the revision standing at its release head when the edition has no draft yet, because that is where a published edition's stated title, description and image live.
  const headRevisionId = headReleaseOf(state, variant)?.revisionId;
  const supersededRevision = draftRevision ?? (headRevisionId === undefined ? undefined : state.contentRevisions.find((candidate) => candidate.revisionId === headRevisionId));
  const resolved = resolveDraftDocument({ body: payload.body, sections: payload.sections });
  if (resolved.status === "invalid") throw invalidAt(resolved.issues);
  const resolvedPlacements = resolvePlacements({ state, session: context.session, previous: draftRevision?.mediaPlacements ?? [], requested: payload.mediaPlacements ?? [] });
  const explicitTracks = resolveCaptionTracks({ state, requested: payload.captions ?? [] });
  const requestedShare = payload.sharePresentation;
  const written = createRevision({
    revisionId: newRecordId("rev"),
    variantId: variant.variantId,
    body: resolved.document,
    mediaPlacements: resolvedPlacements.domain,
    altText: resolvedPlacements.altText,
    captions: resolvedPlacements.captions,
    ...(requestedShare === undefined
      ? {}
      : {
          sharePresentation: {
            ...(requestedShare.title === undefined ? {} : { title: requestedShare.title }),
            ...(requestedShare.description === undefined ? {} : { description: requestedShare.description }),
            ...(requestedShare.imageAssetId === undefined || requestedShare.imageAssetId === null ? {} : { imageAssetId: requestedShare.imageAssetId }),
          },
        }),
    authorPrincipalId: context.session.principalId,
    at: scenarioInstant(context.session),
  });
  if (written.status === "invalid") throw invalidAt(written.issues);
  const statedShare: StatedShare = requestedShare ?? written.revision.sharePresentation;
  const nextRecord: StoredContentRevision = storedRevisionOf({ revision: written.revision, placements: resolvedPlacements.placements, tracks: [...explicitTracks, ...resolvedPlacements.tracks], statedShare, previousShare: supersededRevision?.sharePresentation });
  if (draftRevision !== undefined && storedContentEquals(draftRevision, nextRecord)) return { changed: false };
  const pointed = applyDraftRevision(contentVariantOf(variant), written.revision);
  if (pointed.status === "invalid") throw invalidAt(pointed.issues);
  writeState(context.docs, raw, { contentRevisions: [...state.contentRevisions, nextRecord], contentVariants: replaceVariant(state.contentVariants, storedVariantOf(pointed.variant, nextRevision(variant.revision))) });
  const result = { variantId: variant.variantId, revisionId: written.revision.revisionId, contentChecksum: written.revision.contentChecksum };
  return { changed: true, revision: nextRevision(variant.revision), result, created: [written.revision.revisionId], changedIds: [variant.variantId] } satisfies ApplyResult<typeof result>;
}
const submitForReviewPayloadSchema = z.strictObject({ variantId: recordIdSchema, revisionId: recordIdSchema, notifyMode: publishModeSchema.optional() });
export type SubmitForReviewPayload = z.infer<typeof submitForReviewPayloadSchema>;
/** Freezes one exact revision as the candidate under review and records the mode it is to be released in. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const submitForReview = async (sessionId: string, input: MutationInput<SubmitForReviewPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, submitForReviewPayloadSchema, "submitForReview", { readCurrent: variantTarget, apply: applySubmitForReview });
function applySubmitForReview(context: MutationContext, payload: SubmitForReviewPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const variant = requireVariant(state, payload.variantId);
  const revision = requireRevision(state, payload.revisionId);
  if (revision.variantId !== variant.variantId) throw invalidField("revisionId", "A candidate freezes a revision of its own edition, and this revision belongs to another.");
  const existing = state.contentReviews.find((review) => review.candidateId === revision.revisionId);
  if (existing !== undefined && existing.decision !== "submitted") throw invalidField("revisionId", "This revision has already been reviewed, so a second review needs a new submission with a new revision.");
  if (existing !== undefined && variant.candidateId === revision.revisionId) return { changed: false };
  const at = scenarioInstant(context.session);
  const frozen = freezeCandidate(contentVariantOf(variant), contentRevisionOf(revision, requireParsedBody(revision)), { candidateId: revision.revisionId, at });
  if (frozen.status === "invalid") throw invalidAt(frozen.issues);
  const notifyMode = payload.notifyMode ?? "publish-only";
  const review: ContentReviewRecord = { candidateId: frozen.candidate.candidateId, variantId: variant.variantId, revisionId: revision.revisionId, notifyMode, decision: "submitted", note: null, submittedAt: at.toString(), decidedAt: null, decidedByPrincipalId: null, revision: INITIAL_REVISION_TOKEN };
  writeState(context.docs, raw, { contentVariants: replaceVariant(state.contentVariants, storedVariantOf(frozen.variant, nextRevision(variant.revision))), contentReviews: [...state.contentReviews, review] });
  const result = { candidateId: frozen.candidate.candidateId, variantId: variant.variantId, revisionId: revision.revisionId, notifyMode: review.notifyMode };
  return { changed: true, revision: nextRevision(variant.revision), result, created: [frozen.candidate.candidateId], changedIds: [variant.variantId] } satisfies ApplyResult<typeof result>;
}
const reviewAnswerPayloadSchema = z.strictObject({ candidateId: recordIdSchema, notifyMode: publishModeSchema.optional(), note: z.string().trim().max(4_000).optional(), reason: z.string().trim().max(4_000).optional() });
export type ReviewAnswerPayload = z.infer<typeof reviewAnswerPayloadSchema>;
function requireReview(state: ContentMutationState, candidateId: string, field: string): ContentReviewRecord {
  const review = state.contentReviews.find((candidate) => candidate.candidateId === candidateId);
  if (review === undefined) throw invalidField(field, "No submission is open for review under this identity, so reopen the edition and submit it again.");
  return review;
}
async function answerReview(input: { readonly sessionId: string; readonly mutation: MutationInput<ReviewAnswerPayload>; readonly name: string; readonly decision: Exclude<ReviewDecision, "submitted"> }): Promise<MutationOutcome> {
  return runMutation({
    sessionId: input.sessionId,
    input: input.mutation,
    schema: reviewAnswerPayloadSchema,
    name: input.name,
    authorize: (session) => editorialDecision(session, input.mutation.scope),
    readCurrent: (documents) => currentRevisionTarget(documents, input.mutation.payload.candidateId),
    apply: (context) => {
      const { raw, state } = openState(context.docs);
      const review = requireReview(state, input.mutation.payload.candidateId, "candidateId");
      if (review.decision === input.decision) return { changed: false };
      if (review.decision !== "submitted") throw invalidField("candidateId", "This candidate has already been answered, so a further review needs a new submission.");
      const requestedMode = input.mutation.payload.notifyMode;
      if (requestedMode !== undefined && requestedMode !== review.notifyMode) throw invalidField("notifyMode", "A reviewer cannot change how this edition was submitted to be released, so a new submission is required.");
      const variant = requireVariant(state, review.variantId);
      const decided = applyReviewDecision(contentVariantOf(variant), input.decision);
      if (decided.status === "invalid") throw invalidAt(decided.issues);
      const answered: ContentReviewRecord = { ...review, decision: input.decision, note: input.mutation.payload.note ?? input.mutation.payload.reason ?? null, decidedAt: scenarioInstant(context.session).toString(), decidedByPrincipalId: context.session.principalId, revision: nextRevision(review.revision) };
      writeState(context.docs, raw, { contentVariants: replaceVariant(state.contentVariants, storedVariantOf(decided.variant, nextRevision(variant.revision))), contentReviews: state.contentReviews.map((candidate) => (candidate.candidateId === answered.candidateId ? answered : candidate)) });
      const result = { candidateId: review.candidateId, variantId: review.variantId, revisionId: review.revisionId, decision: input.decision, notifyMode: review.notifyMode };
      return { changed: true, revision: nextRevision(variant.revision), result, changedIds: [review.variantId] } satisfies ApplyResult<typeof result>;
    },
  });
}
/** Approves one frozen candidate in a single step and keeps its recorded release mode. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const approveCandidate = async (sessionId: string, input: MutationInput<ReviewAnswerPayload>): Promise<MutationOutcome> => answerReview({ sessionId, mutation: input, name: "approveCandidate", decision: "approved" });
/** Asks for changes on one frozen candidate, which clears the variant's submission so a second round is a new revision rather than a silent re-review. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const requestChanges = async (sessionId: string, input: MutationInput<ReviewAnswerPayload>): Promise<MutationOutcome> => answerReview({ sessionId, mutation: input, name: "requestChanges", decision: "changes-requested" });
/** Rejects one frozen candidate, under the same single-review rule as a request for changes. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const rejectCandidate = async (sessionId: string, input: MutationInput<ReviewAnswerPayload>): Promise<MutationOutcome> => answerReview({ sessionId, mutation: input, name: "rejectCandidate", decision: "rejected" });
const publishSelectionSchema = z.strictObject({ variantId: recordIdSchema, revisionId: recordIdSchema.optional(), mode: publishModeSchema.optional() });
const publishVariantsPayloadSchema = z.strictObject({ documentId: recordIdSchema.optional(), candidateIds: z.array(recordIdSchema).min(1).optional(), variants: z.array(publishSelectionSchema).min(1).optional(), mode: publishModeSchema.optional() }).superRefine((payload, ctx) => {
  if (payload.candidateIds === undefined && payload.variants === undefined) ctx.addIssue({ code: "custom", path: ["candidateIds"], message: "Choose at least one edition to release, by its candidate or by the edition itself." });
  if (payload.candidateIds !== undefined && payload.variants !== undefined) ctx.addIssue({ code: "custom", path: ["variants"], message: "A release names its editions one way, by candidate or by edition, so remove one of the two lists." });
});
export type PublishVariantsPayload = z.infer<typeof publishVariantsPayloadSchema>;
type ReleaseSelection = { readonly variantId: string; readonly revisionId?: string; readonly mode?: PublishMode };
type ReleaseAttempt = { readonly variantId: string; readonly state: PerVariantReleaseState; readonly releaseId?: string; readonly revisionId?: string; readonly notifyMode?: PublishMode; readonly reasonCode?: string; readonly reason?: string };
function releaseSelectionsOf(state: ContentMutationState, payload: PublishVariantsPayload): readonly ReleaseSelection[] {
  if (payload.variants !== undefined) return payload.variants.map((selection) => ({ variantId: selection.variantId, ...(selection.revisionId === undefined ? {} : { revisionId: selection.revisionId }), ...(selection.mode === undefined ? {} : { mode: selection.mode }) }));
  const selections: ReleaseSelection[] = [];
  for (const candidateId of payload.candidateIds ?? []) {
    const review = state.contentReviews.find((candidate) => candidate.candidateId === candidateId);
    const variantId = review?.variantId ?? state.contentVariants.find((variant) => variant.candidateId === candidateId)?.variantId;
    if (variantId === undefined) throw invalidField("candidateIds", "One selected candidate is not a submission this context holds, so reopen the review and choose it again.");
    selections.push({ variantId, revisionId: candidateId, ...(payload.mode === undefined ? {} : { mode: payload.mode }) });
  }
  return selections;
}
function noticeRenditionOf(state: ContentMutationState, revision: StoredContentRevision): string | undefined {
  for (const placement of revision.mediaPlacements) {
    const asset = state.mediaAssets.find((candidate) => candidate.assetId === placement.assetId);
    const rendition = asset?.renditions.find((entry) => entry.purpose === (asset.kind === "image" ? "display" : "playback"));
    if (rendition !== undefined) return rendition.renditionId;
  }
  return undefined;
}
/** Publishes one revision of each selected edition, and reports what each edition's attempt produced. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const publishVariants = async (sessionId: string, input: MutationInput<PublishVariantsPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, publishVariantsPayloadSchema, "publishVariants", { apply: applyPublishVariants });
/** What a later edition of one simulated partial release answers: no release is recorded for it, the release head it already held stays the published revision, and the release a sibling recorded in the same call stands. */
function simulatedSiblingAttempt(variant: ContentVariantRecord, head: ReleaseRecord | undefined): ReleaseAttempt {
  return {
    variantId: variant.variantId,
    state: head === undefined ? "needs-attention" : "failed-prior-good-head",
    ...(head === undefined ? {} : { releaseId: head.releaseId }),
    reasonCode: "simulated-partial-release",
    reason:
      head === undefined
        ? "This scenario simulates a partial release, so no release was recorded for this edition and it still needs attention; the sibling edition's release stands rather than being rolled back."
        : "This scenario simulates a partial release, so no release was recorded for this edition and the revision it already published stays the head; the sibling edition's release stands rather than being rolled back.",
  };
}
function applyPublishVariants(context: MutationContext, payload: PublishVariantsPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const selections = releaseSelectionsOf(state, payload);
  const document = requireDocument(state, payload.documentId ?? requireVariant(state, selections[0]?.variantId ?? "").documentId);
  const at = scenarioInstant(context.session);
  // A development scenario can simulate the partial release the seeded example demonstrates for real, and one call selecting a single edition has no sibling to fail.
  const simulatedPartialRelease = isScenarioId(context.session.scenarioId) && scenarioFlagsFor(context.session.scenarioId).releaseSynthesis === "one-sibling-fails" && selections.length > 1;
  let releasedEdition: string | undefined;
  const attempts: ReleaseAttempt[] = [];
  const createdReleases = new Map<string, ReleaseRecord>();
  const supersededReleases = new Map<string, ReleaseRecord>();
  const updatedVariants = new Map<string, ContentVariantRecord>();
  for (const selection of selections) {
    const variant = state.contentVariants.find((candidate) => candidate.variantId === selection.variantId);
    if (variant === undefined || variant.documentId !== document.documentId) {
      attempts.push({ variantId: selection.variantId, state: "needs-attention", reasonCode: "unavailable-edition", reason: "This edition is not one the document being released holds." });
      continue;
    }
    const head = headReleaseOf(state, variant);
    const heldReview = variant.candidateId === null ? undefined : state.contentReviews.find((candidate) => candidate.candidateId === variant.candidateId);
    const revisionId = selection.revisionId ?? variant.candidateId ?? variant.draftRevisionId ?? undefined;
    // A release is authorised by the approval of the revision it publishes. Once a release consumes the candidate for its own revision the edition holds no pointer, so the approval on record is found by the released revision itself: that record still states the mode the submission asked for, which keeps a Publish-only approval from being widened to Notify afterwards.
    const review = heldReview ?? (revisionId === undefined ? undefined : state.contentReviews.find((candidate) => candidate.candidateId === revisionId && candidate.decision === "approved"));
    if (review !== undefined && review.decision === "submitted") {
      attempts.push({ variantId: variant.variantId, state: "needs-attention", reasonCode: "awaiting-review", reason: "This edition is still awaiting its one review, so it cannot be released yet." });
      continue;
    }
    if (review !== undefined && review.decision !== "approved") {
      attempts.push({
        variantId: variant.variantId,
        state: "needs-attention",
        reasonCode: review.decision,
        reason: review.decision === "rejected" ? "The reviewer rejected this submission, so it needs a new revision and a new submission." : "The reviewer asked for changes, so this edition needs a new revision and a new submission.",
      });
      continue;
    }
    const requestedMode = selection.mode ?? payload.mode ?? review?.notifyMode;
    if (review !== undefined && requestedMode !== undefined && requestedMode !== review.notifyMode) {
      attempts.push({ variantId: variant.variantId, state: "needs-attention", reasonCode: "notify-mode-not-approved", reason: "A reviewer cannot release this edition with a mode the submission did not ask for, so a new submission is required." });
      continue;
    }
    const notifyMode: PublishMode = requestedMode ?? "publish-only";
    if (revisionId === undefined) {
      attempts.push({ variantId: variant.variantId, state: "needs-attention", reasonCode: "no-revision", reason: "This edition has neither a submitted candidate nor a saved draft to release." });
      continue;
    }
    const revision = state.contentRevisions.find((candidate) => candidate.revisionId === revisionId);
    if (revision === undefined || revision.variantId !== variant.variantId) {
      attempts.push({ variantId: variant.variantId, state: "needs-attention", reasonCode: "no-revision", reason: "The revision this edition would publish is no longer one this edition holds." });
      continue;
    }
    const parsed = parseDocument(revision.body);
    if (parsed.status === "invalid") {
      attempts.push({ variantId: variant.variantId, state: "needs-attention", reasonCode: "revision-unreadable", reason: "The frozen revision no longer reads as admitted content, so it cannot be released." });
      continue;
    }
    const mediaUnavailable = revision.mediaPlacements.some((placement) => {
      return state.mediaAssets.find((candidate) => candidate.assetId === placement.assetId) === undefined;
    });
    if (mediaUnavailable) {
      attempts.push({
        variantId: variant.variantId,
        state: head === undefined ? "needs-attention" : "failed-prior-good-head",
        ...(head === undefined ? {} : { releaseId: head.releaseId }),
        reasonCode: "media-unavailable",
        reason: head === undefined ? "A media asset this revision places is not available, so nothing was released." : "A media asset this revision places is not available, so this edition keeps the revision it already published.",
      });
      continue;
    }
    // The first edition of a simulated partial release that can release goes on to release exactly as it does in every other scenario; each later one answers here, before a release is built or a head is touched.
    if (simulatedPartialRelease && releasedEdition !== undefined) {
      attempts.push(simulatedSiblingAttempt(variant, head));
      continue;
    }
    const domainVariant = contentVariantOf(variant);
    const domainRevision = contentRevisionOf(revision, parsed.document);
    const domainHead = head === undefined ? undefined : domainReleaseOf(head, variant, state);
    if (domainHead !== undefined && isReleaseUnchanged(domainHead, domainRevision)) {
      releasedEdition = variant.variantId;
      attempts.push({ variantId: variant.variantId, state: "released", releaseId: domainHead.releaseId, revisionId: domainHead.revisionId, notifyMode, reasonCode: "already-published", reason: "This edition already publishes exactly this revision; no second release was recorded." });
      continue;
    }
    const built = createRelease({ releaseId: newRecordId("release"), variant: domainVariant, revision: domainRevision, reach: head?.reach ?? "not-public", at });
    if (built.status === "invalid") throw invalidAt(built.issues);
    const advanced = applyReleaseOutcome(domainVariant, { status: "released", release: built.release }, domainHead);
    if (advanced.status === "invalid") throw invalidAt(advanced.issues);
    createdReleases.set(built.release.releaseId, storedReleaseOf(built.release, INITIAL_REVISION_TOKEN, undefined));
    if (advanced.supersededRelease !== undefined) {
      const previous = head;
      supersededReleases.set(advanced.supersededRelease.releaseId, storedReleaseOf(advanced.supersededRelease, previous === undefined ? INITIAL_REVISION_TOKEN : nextRevision(previous.revision), previous));
    }
    updatedVariants.set(variant.variantId, storedVariantOf(advanced.variant, nextRevision(variant.revision)));
    releasedEdition = variant.variantId;
    attempts.push({ variantId: variant.variantId, state: "released", releaseId: built.release.releaseId, revisionId: built.release.revisionId, notifyMode });
  }
  if (createdReleases.size === 0) {
    const refusing = attempts.map((attempt, index) => ({ attempt, index })).filter(({ attempt }) => attempt.reasonCode !== "already-published");
    if (refusing.length === 0) return { changed: false };
    const issues: DocumentIssue[] = refusing.map(({ attempt, index }) => ({ path: `variants.${String(index)}`, message: attempt.reason ?? "This edition could not be released." }));
    throw invalidAt(issues);
  }
  writeState(context.docs, raw, {
    releases: [...state.releases.map((release) => supersededReleases.get(release.releaseId) ?? release), ...createdReleases.values()],
    contentVariants: state.contentVariants.map((variant) => updatedVariants.get(variant.variantId) ?? variant),
    contentDocuments: state.contentDocuments.map((candidate) => (candidate.documentId === document.documentId ? { ...candidate, revision: nextRevision(candidate.revision) } : candidate)),
  });
  const items: PerItemResult[] = attempts.map((attempt) => ({
    targetId: attempt.variantId,
    state: attempt.state,
    ...(attempt.releaseId === undefined ? {} : { revision: attempt.releaseId }),
    ...(attempt.reasonCode === undefined ? {} : { reasonCode: attempt.reasonCode }),
    ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
  }));
  const editions = attempts.map((attempt) => ({ variantId: attempt.variantId, state: attempt.state, releaseId: attempt.releaseId ?? null, revisionId: attempt.revisionId ?? null, notifyMode: attempt.notifyMode ?? null, reasonCode: attempt.reasonCode ?? null, reason: attempt.reason ?? null }));
  const result = { documentId: document.documentId, editions };
  return { changed: true, revision: nextRevision(document.revision), result, created: [...createdReleases.keys()], changedIds: [...updatedVariants.keys()], items } satisfies ApplyResult<typeof result>;
}
const requestNotificationPayloadSchema = z
  .strictObject({
    documentId: recordIdSchema,
    releaseId: recordIdSchema.optional(),
    releaseIds: z.array(recordIdSchema).min(1).optional(),
    variantId: recordIdSchema.optional(),
    purpose: z.enum(["update-email"]).optional(),
    acknowledgedCeiling: z.int().nonnegative().optional(),
    intendedAt: z.iso.datetime({ offset: true }).optional(),
    repeatOfIntentId: recordIdSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.releaseId === undefined && payload.releaseIds === undefined && payload.variantId === undefined) ctx.addIssue({ code: "custom", path: ["releaseId"], message: "A notice names the published edition it is about, so choose one from the release." });
    if (payload.releaseIds !== undefined && payload.releaseIds.length > 1) ctx.addIssue({ code: "custom", path: ["releaseIds"], message: "One notice names one published edition, so a second edition is a second notice rather than one copy twice over." });
  });
export type RequestNotificationPayload = z.infer<typeof requestNotificationPayloadSchema>;
export type NotificationSubmissionView = {
  readonly intentId: string;
  readonly sendResultId: string;
  readonly documentId: string;
  readonly releaseId: string;
  readonly publisherId: string;
  readonly purpose: string;
  readonly ceilingCount: number;
  readonly acknowledgedCeilingCount: number | null;
  readonly ceilingSaturated: boolean;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly acceptedCount: number;
  readonly unconfirmedCount: number;
  readonly alreadyCoveredCount: number;
  readonly link: string;
  readonly recipients: readonly { readonly recipientId: string; readonly dedupeKey: string }[];
};
function publisherOf(state: ContentMutationState): string | undefined {
  const publishers = [...new Set(state.memberships.filter((membership) => membership.purpose === UPDATE_EMAIL_PURPOSE).map((membership) => membership.publisherId))].sort();
  return publishers.length === 1 ? publishers[0] : undefined;
}
type CoveringCopy = { readonly intentId: string; readonly renditionId: string };
function alreadyCoveredOnDocument(state: ContentMutationState, publisherId: string, documentId: string, recipientId: string): CoveringCopy | undefined {
  const intents = new Set(state.notificationIntents.filter((intent) => intent.publisherId === publisherId && intent.purpose === UPDATE_EMAIL_PURPOSE && intent.documentId === documentId).map((intent) => intent.intentId));
  const covers: CoveringCopy[] = [];
  for (const result of state.notificationResults) {
    if (!intents.has(result.intentId)) continue;
    for (const copy of result.recipients) {
      if (copy.recipientId !== recipientId || (copy.state !== "accepted" && copy.state !== "unknown")) continue;
      covers.push({ intentId: result.intentId, renditionId: copy.renditionId });
    }
  }
  covers.sort((left, right) => compareCodeUnits(left.intentId, right.intentId) || compareCodeUnits(left.renditionId, right.renditionId));
  return covers[0];
}
/** Submits one immediate notice for one published edition of this publisher's Update email. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const requestNotification = async (sessionId: string, input: MutationInput<RequestNotificationPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, requestNotificationPayloadSchema, "requestNotification", { apply: (context, payload) => applyRequestNotification(context, payload, input.scope) });
function applyRequestNotification(context: MutationContext, payload: RequestNotificationPayload, scope: Scope): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const document = requireDocument(state, payload.documentId);
  const at = scenarioInstant(context.session);
  // A repeat names the notice it repeats, so the instant that notice was meant for is the record's own and a repeat can never move the window it stands in; the same window then refuses it once the 24 useful hours are spent.
  const repeatRequested = payload.repeatOfIntentId !== undefined;
  const repeated = repeatRequested ? state.notificationIntents.find((intent) => intent.intentId === payload.repeatOfIntentId) : undefined;
  if (repeatRequested && repeated === undefined) throw invalidField("repeatOfIntentId", "This request names no notice of this ministry, so there is no recorded failure for it to submit again.");
  const intendedAt = repeated === undefined ? (payload.intendedAt === undefined ? at : Temporal.Instant.from(payload.intendedAt)) : Temporal.Instant.from(repeated.intendedAt);
  if (notificationDeadline({ intendedAt, now: at }).status === "past-usefulness") throw invalidField("intendedAt", "This notice is past the 24 hours it stays useful for, so it cannot be submitted now and a new intent cannot revive it.");
  const namedReleaseId = payload.releaseIds?.[0] ?? payload.releaseId ?? (payload.variantId === undefined ? undefined : headReleaseOf(state, requireVariant(state, payload.variantId)))?.releaseId;
  if (namedReleaseId === undefined) throw invalidField("releaseId", "This edition publishes no release yet, so there is nothing to notify anyone about.");
  const release = state.releases.find((candidate) => candidate.releaseId === namedReleaseId);
  const releaseVariant = release === undefined ? undefined : state.contentVariants.find((candidate) => candidate.variantId === release.variantId);
  if (release === undefined || releaseVariant === undefined || releaseVariant.documentId !== document.documentId) throw invalidField("releaseId", "This release is not one this document published, so a notice cannot be submitted for it.");
  if (release.withdrawnAt !== null) throw invalidField("releaseId", "This edition is withdrawn, so there is nothing published to notify anyone about.");
  const publisherId = publisherOf(state);
  if (publisherId === undefined) throw invalidField("documentId", "This ministry holds no single Update audience, so there is no publisher a notice could speak for.");
  const purpose = payload.purpose ?? UPDATE_EMAIL_PURPOSE;
  const existing = state.notificationIntents.find((intent) => intent.documentId === document.documentId && intent.releaseId === release.releaseId && intent.publisherId === publisherId && intent.purpose === purpose);
  if (repeated !== undefined && (repeated.documentId !== document.documentId || repeated.releaseId !== release.releaseId || repeated.publisherId !== publisherId || repeated.purpose !== purpose))
    throw invalidField("repeatOfIntentId", "This repeat names a notice of another edition or another publisher, so there is nothing here for it to submit again.");
  if (existing !== undefined && repeated === undefined) return { changed: false };
  // A repeat with nothing to repeat changes nothing: no intent is recorded for work that was never a definite failure.
  if (repeated !== undefined && !state.notificationResults.some((result) => result.intentId === repeated.intentId && result.recipients.some((copy) => copy.state === "failed"))) return { changed: false };
  const intentId = newRecordId("intent");
  const acknowledged = payload.acknowledgedCeiling;
  const eligibility: EligibilityResult = eligibleRecipients({
    memberships: state.memberships.filter((membership) => membership.publisherId === publisherId).map((membership) => membershipOf(membership, scope)),
    publisherId,
    purpose: UPDATE_EMAIL_PURPOSE,
    intent: { intentId, acceptedAt: at, ...(acknowledged === undefined ? {} : { ceilingCount: acknowledged }) } satisfies EligibilityIntent,
    now: at,
  });
  const revision = state.contentRevisions.find((candidate) => candidate.revisionId === release.revisionId);
  const candidates: NoticeRenditionCandidate[] = [
    {
      variantId: release.variantId,
      releaseId: release.releaseId,
      revisionId: release.revisionId,
      audience: release.audience,
      locale: { tag: release.locale, direction: releaseVariant.direction ?? directionOfTag(release.locale) },
      publishedAt: Temporal.Instant.from(release.publishedAt),
      contentChecksum: revision?.contentChecksum ?? "",
      ...(revision === undefined ? {} : { renditionId: noticeRenditionOf(state, revision) }),
    },
  ];
  const copies: NotificationRecipientOutcomeRecord[] = [];
  const unserved: NotificationUnservedRecipientRecord[] = [];
  const recipients: { recipientId: string; dedupeKey: string }[] = [];
  let unconfirmed = 0;
  let alreadyCovered = 0;
  let link = `/preview/${encodeURIComponent(document.documentId)}`;
  for (const recipient of eligibility.eligible) {
    const covering = alreadyCoveredOnDocument(state, publisherId, document.documentId, recipient.recipientId);
    if (covering !== undefined) {
      alreadyCovered += 1;
      unserved.push({ recipientId: recipient.recipientId, reason: "already-covered", coveredByIntentId: covering.intentId, coveredByRenditionId: covering.renditionId });
      continue;
    }
    const admitted: NoticeRecipient = { recipientId: recipient.recipientId, admittedAudiences: [release.audience], ...(recipient.languagePreference.length === 0 ? {} : { languagePreference: recipient.languagePreference }) };
    const pinned = resolveRendition({ recipient: admitted, candidates, siteDefaultLocale: "" });
    if (pinned.status !== "pinned") {
      unconfirmed += 1;
      unserved.push({ recipientId: recipient.recipientId, reason: "no-eligible-rendition", renditionRefusal: pinned.reason });
      continue;
    }
    const notice: { readonly link: string } = buildNotice({ publisher: { displayName: UNNAMED_PUBLISHER }, purpose, pinned: pinned.rendition, sender: NOTICE_SENDER, link, ...(pinned.videoPoster === undefined ? {} : { videoPoster: pinned.videoPoster }) });
    link = notice.link.length === 0 ? link : notice.link;
    copies.push({ recipientId: recipient.recipientId, renditionId: pinned.rendition.renditionId ?? `edition:${pinned.rendition.releaseId}`, state: "accepted", at: at.toString() });
    recipients.push({ recipientId: recipient.recipientId, dedupeKey: recipient.dedupeKey });
  }
  // A repeat that served nobody changes nothing: every failed copy of the notice it names is already covered by an accepted or uncertain one, so a second press records no notice that reached anyone.
  if (repeated !== undefined && copies.length === 0) return { changed: false };
  const ceilingCount = eligibility.eligible.length;
  const intent: NotificationIntentRecord = { intentId, publisherId, purpose, documentId: document.documentId, releaseId: release.releaseId, intendedAt: intendedAt.toString(), ceilingCount, revision: INITIAL_REVISION_TOKEN };
  const sendResult: NotificationSendResultRecord = { sendResultId: newRecordId("send-result"), intentId, recipients: copies, unserved, recordedAt: at.toString(), revision: INITIAL_REVISION_TOKEN };
  writeState(context.docs, raw, {
    notificationIntents: [...state.notificationIntents, intent],
    notificationResults: [...state.notificationResults, sendResult],
    contentDocuments: state.contentDocuments.map((candidate) => (candidate.documentId === document.documentId ? { ...candidate, revision: nextRevision(candidate.revision) } : candidate)),
  });
  const result: NotificationSubmissionView = {
    intentId,
    sendResultId: sendResult.sendResultId,
    documentId: document.documentId,
    releaseId: release.releaseId,
    publisherId,
    purpose,
    ceilingCount,
    acknowledgedCeilingCount: acknowledged ?? null,
    ceilingSaturated: eligibility.ceilingSaturated,
    eligibleCount: eligibility.eligible.length,
    excludedCount: eligibility.excluded.length,
    acceptedCount: copies.length,
    unconfirmedCount: unconfirmed,
    alreadyCoveredCount: alreadyCovered,
    link,
    recipients,
  };
  return { changed: true, revision: nextRevision(document.revision), result, created: [intentId, sendResult.sendResultId], changedIds: [document.documentId] } satisfies ApplyResult<typeof result>;
}
const documentPayloadSchema = z.strictObject({ documentId: recordIdSchema });
export type DocumentPayload = z.infer<typeof documentPayloadSchema>;
export type WithdrawalView = { readonly documentId: string; readonly withdrawnReleaseIds: readonly string[]; readonly newlyWithdrawnCount: number };
/** Withdraws every release one document's Update editions hold. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const withdrawUpdate = async (sessionId: string, input: MutationInput<DocumentPayload>): Promise<MutationOutcome> => withdrawDocumentFamily(sessionId, input, "withdrawUpdate", (family) => family === "update");
/** Withdraws every release one document's Worker or Project Page editions hold, with the same guarantees as {@link withdrawUpdate} and the page families only. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const withdrawPage = async (sessionId: string, input: MutationInput<DocumentPayload>): Promise<MutationOutcome> => withdrawDocumentFamily(sessionId, input, "withdrawPage", (family) => family !== "update");
async function withdrawDocumentFamily(sessionId: string, input: MutationInput<DocumentPayload>, name: string, admits: (family: ContentFamily) => boolean): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: documentPayloadSchema,
    name,
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (documents) => currentDocumentTarget(documents, input.payload.documentId),
    apply: (context) => {
      const { raw, state } = openState(context.docs);
      const document = requireDocument(state, input.payload.documentId);
      if (!admits(document.family)) throw invalidField("documentId", "This document belongs to another content family, so its own withdrawal applies to it.");
      const at = scenarioInstant(context.session);
      const releases = releasesOfDocument(state, document.documentId);
      let newlyWithdrawn = 0;
      const withdrawnIds: string[] = [];
      const nextReleases = releases.map((release) => {
        const variant = state.contentVariants.find((candidate) => candidate.variantId === release.variantId);
        const withdrawal = withdrawEdition(domainReleaseOf(release, variant, state), { at });
        withdrawnIds.push(withdrawal.release.releaseId);
        if (release.withdrawnAt !== null) return release;
        newlyWithdrawn += 1;
        return storedReleaseOf(withdrawal.release, nextRevision(release.revision), release);
      });
      if (newlyWithdrawn === 0) return { changed: false };
      const nextById = new Map(nextReleases.map((release) => [release.releaseId, release]));
      writeState(context.docs, raw, { releases: state.releases.map((release) => nextById.get(release.releaseId) ?? release), contentDocuments: state.contentDocuments.map((candidate) => (candidate.documentId === document.documentId ? { ...candidate, revision: nextRevision(candidate.revision) } : candidate)) });
      const result: WithdrawalView = { documentId: document.documentId, withdrawnReleaseIds: withdrawnIds, newlyWithdrawnCount: newlyWithdrawn };
      return { changed: true, revision: nextRevision(document.revision), result, changedIds: withdrawnIds } satisfies ApplyResult<typeof result>;
    },
  });
}
const localeWithdrawalPayloadSchema = z.strictObject({ variantId: recordIdSchema });
export type LocaleWithdrawalPayload = z.infer<typeof localeWithdrawalPayloadSchema>;
/** Withdraws one locale edition and leaves every sibling released. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const withdrawLocale = async (sessionId: string, input: MutationInput<LocaleWithdrawalPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, localeWithdrawalPayloadSchema, "withdrawLocale", { readCurrent: variantDocumentTarget, apply: applyWithdrawLocale });
function applyWithdrawLocale(context: MutationContext, payload: LocaleWithdrawalPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const variant = requireVariant(state, payload.variantId);
  const document = requireDocument(state, variant.documentId);
  const head = headReleaseOf(state, variant);
  if (head === undefined || head.withdrawnAt !== null) return { changed: false };
  const stored = storedReleaseOf(withdrawEdition(domainReleaseOf(head, variant, state), { at: scenarioInstant(context.session) }).release, nextRevision(head.revision), head);
  writeState(context.docs, raw, { releases: replaceRelease(state.releases, stored), contentDocuments: state.contentDocuments.map((candidate) => (candidate.documentId === document.documentId ? { ...candidate, revision: nextRevision(candidate.revision) } : candidate)) });
  const result: WithdrawalView = { documentId: document.documentId, withdrawnReleaseIds: [stored.releaseId], newlyWithdrawnCount: 1 };
  return { changed: true, revision: nextRevision(document.revision), result, changedIds: [stored.releaseId] } satisfies ApplyResult<typeof result>;
}
const setReachPayloadSchema = z.strictObject({ documentId: recordIdSchema, reach: reachSchema });
export type SetReachPayload = z.infer<typeof setReachPayloadSchema>;
export type ReachView = { readonly documentId: string; readonly reach: ReleaseReach; readonly releaseIds: readonly string[]; readonly changedCount: number };
/** Changes how far one document's released editions reach: not public, public by link only, or listed. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const setReach = async (sessionId: string, input: MutationInput<SetReachPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, setReachPayloadSchema, "setReach", { readCurrent: documentTarget, apply: applySetReach });
function applySetReach(context: MutationContext, payload: SetReachPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const document = requireDocument(state, payload.documentId);
  const heads = state.contentVariants
    .filter((variant) => variant.documentId === document.documentId)
    .map((variant) => headReleaseOf(state, variant))
    .filter((release): release is ReleaseRecord => release !== undefined);
  if (heads.length === 0) throw invalidField("documentId", "This document publishes no edition yet, so it has no reach to set.");
  const nextReleases: ReleaseRecord[] = [];
  const releaseIds: string[] = [];
  for (const head of heads) {
    const decision = decideReach(head.reach, payload.reach);
    if (decision.status === "invalid") throw invalidField("reach", decision.reason);
    if (decision.status === "unchanged") continue;
    nextReleases.push({ ...head, reach: decision.reach, revision: nextRevision(head.revision) });
    releaseIds.push(head.releaseId);
  }
  if (nextReleases.length === 0) return { changed: false };
  const byId = new Map(nextReleases.map((release) => [release.releaseId, release]));
  writeState(context.docs, raw, { releases: state.releases.map((release) => byId.get(release.releaseId) ?? release), contentDocuments: state.contentDocuments.map((candidate) => (candidate.documentId === document.documentId ? { ...candidate, revision: nextRevision(candidate.revision) } : candidate)) });
  const result: ReachView = { documentId: document.documentId, reach: payload.reach, releaseIds, changedCount: nextReleases.length };
  return { changed: true, revision: nextRevision(document.revision), result, changedIds: releaseIds } satisfies ApplyResult<typeof result>;
}
/** Stops showing one document publicly: every edition, in every locale and audience, is withdrawn at one instant. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const stopShowingPublicly = async (sessionId: string, input: MutationInput<DocumentPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, documentPayloadSchema, "stopShowingPublicly", { readCurrent: documentTarget, apply: applyStopShowingPublicly });
function applyStopShowingPublicly(context: MutationContext, payload: DocumentPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const document = requireDocument(state, payload.documentId);
  const at = scenarioInstant(context.session);
  const records = releasesOfDocument(state, document.documentId);
  const domains = records.map((release) =>
    domainReleaseOf(
      release,
      state.contentVariants.find((variant) => variant.variantId === release.variantId),
      state,
    ),
  );
  const byId = new Map(containEditions(domains, { at }).withdrawals.map((entry) => [entry.release.releaseId, entry]));
  let newlyWithdrawn = 0;
  const nextReleases = records.map((release) => {
    const withdrawal = byId.get(release.releaseId);
    if (withdrawal === undefined || release.withdrawnAt !== null) return release;
    newlyWithdrawn += 1;
    return storedReleaseOf(withdrawal.release, nextRevision(release.revision), release);
  });
  if (newlyWithdrawn === 0) return { changed: false };
  const nextById = new Map(nextReleases.map((release) => [release.releaseId, release]));
  writeState(context.docs, raw, { releases: state.releases.map((release) => nextById.get(release.releaseId) ?? release), contentDocuments: state.contentDocuments.map((candidate) => (candidate.documentId === document.documentId ? { ...candidate, revision: nextRevision(candidate.revision) } : candidate)) });
  const result: WithdrawalView = { documentId: document.documentId, withdrawnReleaseIds: records.map((release) => release.releaseId), newlyWithdrawnCount: newlyWithdrawn };
  return { changed: true, revision: nextRevision(document.revision), result, changedIds: records.map((release) => release.releaseId) } satisfies ApplyResult<typeof result>;
}
const restoreRevisionPayloadSchema = z.strictObject({ revisionId: recordIdSchema });
export type RestoreRevisionPayload = z.infer<typeof restoreRevisionPayloadSchema>;
/** Restores an earlier revision as a new draft, with a new identity, a new author and a new creation instant. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const restoreRevisionAsDraft = async (sessionId: string, input: MutationInput<RestoreRevisionPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, restoreRevisionPayloadSchema, "restoreRevisionAsDraft", { readCurrent: revisionTarget, apply: applyRestoreRevisionAsDraft });
function applyRestoreRevisionAsDraft(context: MutationContext, payload: RestoreRevisionPayload): ApplyResult<MutationResult> {
  const { raw, state } = openState(context.docs);
  const source = requireRevision(state, payload.revisionId);
  const variant = requireVariant(state, source.variantId);
  const document = requireDocument(state, variant.documentId);
  const restored = restoreAsNewDraft(contentRevisionOf(source, requireParsedBody(source)), { authorPrincipalId: context.session.principalId, revisionId: newRecordId("rev"), at: scenarioInstant(context.session) });
  const record: StoredContentRevision = { ...source, revisionId: restored.revisionId, authorPrincipalId: principalIdOf(restored.authorPrincipalId), createdAt: restored.createdAt.toString(), revision: INITIAL_REVISION_TOKEN };
  const pointed = applyDraftRevision(contentVariantOf(variant), restored);
  if (pointed.status === "invalid") throw invalidAt(pointed.issues);
  writeState(context.docs, raw, { contentRevisions: [...state.contentRevisions, record], contentVariants: replaceVariant(state.contentVariants, storedVariantOf(pointed.variant, nextRevision(variant.revision))) });
  const result = { revisionId: restored.revisionId, variantId: variant.variantId, documentId: document.documentId };
  return { changed: true, revision: nextRevision(variant.revision), result, created: [restored.revisionId], changedIds: [variant.variantId] } satisfies ApplyResult<typeof result>;
}
type DraftTarget = { readonly variant: ContentVariantRecord; readonly revision: StoredContentRevision; readonly document: ContentDocumentRecord; readonly body: ContentDocumentJson };
// The draft one editorial change edits, resolved from the identity the payload names. A section change and a media placement change both edit the edition's own draft, so both resolve it here and cannot disagree about which revision an edition is editing.
function resolveDraftTarget(state: ContentMutationState, payload: { readonly draftRevisionId?: string; readonly variantId?: string }): DraftTarget {
  let variant: ContentVariantRecord;
  let revision: StoredContentRevision;
  if (payload.draftRevisionId !== undefined) {
    revision = requireRevision(state, payload.draftRevisionId);
    variant = requireVariant(state, revision.variantId);
    if (variant.draftRevisionId !== revision.revisionId) throw invalidField("draftRevisionId", "This revision is no longer the edition's draft, so reopen the page and compose into the current draft.");
  } else if (payload.variantId !== undefined) {
    variant = requireVariant(state, payload.variantId);
    if (variant.draftRevisionId === null) throw invalidField("variantId", "This edition has no draft yet, so save its draft once before changing what it holds.");
    revision = requireRevision(state, variant.draftRevisionId);
  } else {
    throw invalidField("draftRevisionId", "This change names the draft revision it edits, so open the edition's draft first.");
  }
  const document = requireDocument(state, variant.documentId);
  return { variant, revision, document, body: requireParsedBody(revision) };
}
// A section composes a Worker or Project Page, so a section change on an Update draft is refused instead of writing a structure that family renders nowhere.
function draftTargetOf(state: ContentMutationState, payload: { readonly draftRevisionId?: string; readonly variantId?: string }): DraftTarget {
  const target = resolveDraftTarget(state, payload);
  if (target.document.family === "update") throw invalidField("variantId", "A section composes a Worker or Project Page; an Update carries prose and its own media placements.");
  return target;
}
// The draft a media placement change edits: an Update carries prose and its own media placements exactly as a Page composes its own sections, so this reader states no family guard and both families place media on their draft.
function placementTargetOf(state: ContentMutationState, payload: { readonly draftRevisionId?: string; readonly variantId?: string }): DraftTarget {
  return resolveDraftTarget(state, payload);
}
function sectionIndexOf(sections: readonly ContentSection[], sectionId: string): number {
  const numericText = /^section-(\d+)$/u.exec(sectionId)?.[1] ?? (/^\d+$/u.test(sectionId) ? sectionId : undefined);
  if (numericText !== undefined) {
    const index = Number.parseInt(numericText, 10);
    if (index >= 0 && index < sections.length) return index;
    throw invalidField("sectionId", "This page holds no section at that position, so reopen it and choose the section again.");
  }
  const byElement = sections.findIndex((section) => section.element === sectionId);
  if (byElement < 0) throw invalidField("sectionId", "This page holds no section by that identity, so reopen it and choose the section again.");
  return byElement;
}
const MANAGED_SECTION_REFUSAL = "This section is supplied by the source, so it is read-only here and cannot be added, moved, duplicated or removed.";
function emptyFieldsFor(type: PageSectionType): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const key of SECTION_FIELD_KEYS[type]) fields[key] = "";
  return fields;
}
function writeDraftEdit(input: {
  readonly context: { readonly docs: { state: unknown }; readonly session: ResolvedSession };
  readonly opened: OpenedState;
  readonly target: DraftTarget;
  readonly body: ContentDocumentJson;
  readonly placements: readonly MediaPlacementRecord[];
  readonly tracks: readonly ContentCaptionTrackRecord[];
}): { readonly changed: false } | { readonly changed: true; readonly revisionId: string; readonly revision: string; readonly documentId: string; readonly variantId: string } {
  const { target, body, placements, tracks } = input;
  const altText: Record<string, string> = {};
  const captions: Record<string, string> = {};
  for (const placement of placements) {
    altText[placement.placementId] = placement.altText;
    if (placement.caption !== null) captions[placement.placementId] = placement.caption;
  }
  const checksum = revisionChecksum({ body, sections: body.sections, mediaPlacements: placements.map((placement) => ({ placementId: placement.placementId, assetId: placement.assetId })), captions, altText, sharePresentation: contentRevisionOf(target.revision, target.body).sharePresentation });
  const next: StoredContentRevision = { ...target.revision, body, mediaPlacements: [...placements], captions: [...tracks], contentChecksum: checksum, revision: nextRevision(target.revision.revision) };
  if (storedContentEquals(target.revision, next)) return { changed: false };
  const nextVariants = replaceVariant(input.opened.state.contentVariants, storedVariantOf(contentVariantOf(target.variant), nextRevision(target.variant.revision)));
  writeState(input.context.docs, input.opened.raw, { contentRevisions: replaceRevision(input.opened.state.contentRevisions, next), contentVariants: nextVariants });
  return { changed: true, revisionId: next.revisionId, revision: next.revision, documentId: target.document.documentId, variantId: target.variant.variantId };
}
const replaceRevision = (revisions: readonly StoredContentRevision[], next: StoredContentRevision): readonly StoredContentRevision[] => revisions.map((revision) => (revision.revisionId === next.revisionId ? next : revision));
export type SectionEditView = { readonly documentId: string; readonly variantId: string; readonly revisionId: string; readonly revision: string; readonly sectionCount: number };
type DraftTargetSelector = { readonly draftRevisionId?: string; readonly variantId?: string };
type SectionChange<P> = (target: DraftTarget, payload: P) => readonly ContentSection[];
async function editDraftSections<P extends DraftTargetSelector>(sessionId: string, mutation: MutationInput<P>, schema: z.ZodType<P>, name: string, change: SectionChange<P>): Promise<MutationOutcome> {
  return runEditorial(sessionId, mutation, schema, name, {
    readCurrent: draftTarget,
    apply: (context) => {
      const opened = openState(context.docs);
      const target = draftTargetOf(opened.state, mutation.payload);
      const sections = change(target, mutation.payload);
      const written = writeDraftEdit({ context, opened, target, body: { ...target.body, sections }, placements: target.revision.mediaPlacements, tracks: target.revision.captions });
      if (!written.changed) return { changed: false };
      const result: SectionEditView = { documentId: written.documentId, variantId: written.variantId, revisionId: written.revisionId, revision: written.revision, sectionCount: sections.length };
      return { changed: true, revision: written.revision, result, changedIds: [written.revisionId] } satisfies ApplyResult<typeof result>;
    },
  });
}
const addSectionPayloadSchema = z.strictObject({ ...draftTargetShape, sectionType: z.string().trim().min(1, "Choose the section to add."), afterSectionId: recordIdSchema.optional() }).superRefine(refuseUnnamedDraftTarget);
export type AddSectionPayload = z.infer<typeof addSectionPayloadSchema>;
/** Adds one section of an admitted catalogue type to a page draft, after a named section or at the end. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function addSection(sessionId: string, input: MutationInput<AddSectionPayload>): Promise<MutationOutcome> {
  return editDraftSections(sessionId, input, addSectionPayloadSchema, "addSection", (target, payload) => {
    const type = requireSectionType(payload.sectionType);
    if (MANAGED_SECTION_TYPES.has(type)) throw invalidField("sectionType", MANAGED_SECTION_REFUSAL);
    const sections = target.body.sections;
    const after = payload.afterSectionId === undefined ? sections.length : sectionIndexOf(sections, payload.afterSectionId) + 1;
    const added: ContentSection = { element: type, fields: emptyFieldsFor(type), presentation: DEFAULT_PRESENTATION };
    return [...sections.slice(0, after), added, ...sections.slice(after)];
  });
}
const moveSectionPayloadSchema = z.strictObject({ ...draftTargetShape, sectionId: recordIdSchema, targetIndex: z.int({ error: "State the position this section moves to as a whole number." }).nonnegative("A position is zero or more, counting from the first section.") }).superRefine(refuseUnnamedDraftTarget);
export type MoveSectionPayload = z.infer<typeof moveSectionPayloadSchema>;
/** Moves one section to an explicit position. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function moveSection(sessionId: string, input: MutationInput<MoveSectionPayload>): Promise<MutationOutcome> {
  return editDraftSections(sessionId, input, moveSectionPayloadSchema, "moveSection", (target, payload) => {
    const { sections, index: from, section: moved } = requireEditableSection(target.body.sections, payload.sectionId);
    const destination = Math.min(payload.targetIndex, sections.length - 1);
    if (destination === from) return sections;
    const rest = sections.filter((_section, index) => index !== from);
    return [...rest.slice(0, destination), moved, ...rest.slice(destination)];
  });
}
const sectionReferencePayloadSchema = z.strictObject({ ...draftTargetShape, sectionId: recordIdSchema }).superRefine(refuseUnnamedDraftTarget);
export type SectionReferencePayload = z.infer<typeof sectionReferencePayloadSchema>;
/** Copies one section, structure and content, immediately after itself. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function duplicateSection(sessionId: string, input: MutationInput<SectionReferencePayload>): Promise<MutationOutcome> {
  return editDraftSections(sessionId, input, sectionReferencePayloadSchema, "duplicateSection", (target, payload) => {
    const { sections, index, section: source } = requireEditableSection(target.body.sections, payload.sectionId);
    const copy: ContentSection = { element: source.element, fields: { ...source.fields }, presentation: { ...source.presentation }, ...(source.direction === undefined ? {} : { direction: source.direction }) };
    return [...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)];
  });
}
/** Removes one section from a page draft. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function removeSection(sessionId: string, input: MutationInput<SectionReferencePayload>): Promise<MutationOutcome> {
  return editDraftSections(sessionId, input, sectionReferencePayloadSchema, "removeSection", (target, payload) => {
    const { sections, index } = requireEditableSection(target.body.sections, payload.sectionId);
    return sections.filter((_value, position) => position !== index);
  });
}
const saveSectionFieldsPayloadSchema = z.strictObject({ ...draftTargetShape, sectionId: recordIdSchema, fields: sectionFieldsSchema.optional(), presentation: presentationChoiceSchema.optional() }).superRefine((payload, ctx) => {
  if (!namesDraftTarget(payload)) ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: NO_DRAFT_TARGET_MESSAGE });
  if (payload.fields === undefined && payload.presentation === undefined) ctx.addIssue({ code: "custom", path: ["fields"], message: "State the fields this section changes, or the presentation it uses." });
});
export type SaveSectionFieldsPayload = z.infer<typeof saveSectionFieldsPayloadSchema>;
/** Saves one section's fields and its bounded presentation choices. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function saveSectionFields(sessionId: string, input: MutationInput<SaveSectionFieldsPayload>): Promise<MutationOutcome> {
  return editDraftSections(sessionId, input, saveSectionFieldsPayloadSchema, "saveSectionFields", (target, payload) => {
    const { sections, index, section } = requireEditableSection(target.body.sections, payload.sectionId);
    const admitted = SECTION_FIELD_KEYS[section.element as PageSectionType] ?? [];
    for (const key of Object.keys(payload.fields ?? {})) if (!admitted.includes(key)) throw invalidField(`fields.${key}`, `This section type edits ${admitted.length === 0 ? "no field" : admitted.join(", ")}, so "${key}" is not one of them.`);
    return sections.map((current, position) => (position === index ? { ...current, fields: { ...current.fields, ...payload.fields }, presentation: payload.presentation ?? current.presentation } : current));
  });
}
const applyPresetPayloadSchema = z.strictObject({ ...draftTargetShape, presetId: z.enum(PAGE_PRESET_IDS, { error: "Choose one of the presets this page catalogue proposes." }) }).superRefine(refuseUnnamedDraftTarget);
export type ApplyPresetPayload = z.infer<typeof applyPresetPayloadSchema>;
/** Applies one catalogue preset: the sections it proposes are composed into the draft and nothing is published. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function applyPreset(sessionId: string, input: MutationInput<ApplyPresetPayload>): Promise<MutationOutcome> {
  return editDraftSections(sessionId, input, applyPresetPayloadSchema, "applyPreset", (target, payload) => {
    const added: ContentSection[] = (PAGE_PRESETS[payload.presetId] ?? []).map((type) => ({ element: type, fields: emptyFieldsFor(type), presentation: DEFAULT_PRESENTATION }));
    return [...target.body.sections, ...added];
  });
}
function decodeBase64Bytes(value: string, field: string): Uint8Array {
  try {
    const decoded = globalThis.atob(value.replace(/\s+/gu, ""));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  } catch {
    throw invalidField(field, "These bytes could not be read, so choose the file again.");
  }
}
function refusalText(refusal: MediaRefusal): string {
  const reason = mediaStateReason("rejected", refusal);
  return reason.action === undefined ? reason.label : `${reason.label} ${reason.action}`;
}
const storedRenditionOf = (rendition: MediaRendition, bytesRef: string): { readonly renditionId: string; readonly purpose: MediaAssetRenditionPurpose; readonly bytesRef: string; readonly mimeType: string } => ({ renditionId: rendition.renditionId, purpose: rendition.purpose, bytesRef, mimeType: rendition.mimeType });
function storedProfileOf(check: MediaProfileCheck): { readonly container: string; readonly codec: string; readonly durationSeconds: number | null; readonly width: number; readonly height: number } {
  return check.kind === "image" ? { container: check.format, codec: check.format, durationSeconds: null, width: check.width, height: check.height } : { container: check.container, codec: check.codec, durationSeconds: check.durationS, width: check.width, height: check.height };
}
const storedVerificationOf = (verification: MediaTagVerification): { readonly checked: boolean; readonly residualTags: readonly string[] } => ({ checked: verification.checked, residualTags: [...verification.residualTags] });
const uploadBytesSchema = z.strictObject({ bytesBase64: z.string().min(1, "Choose a file to upload."), name: z.string().min(1).max(255).optional() });
// The section one registration places its asset into: a Page composes media into a section, so an attempt that binds states the draft edition it composes and the catalogue element the page read keys that section's placements by.
const sectionPlacementPayloadSchema = z
  .strictObject({
    draftRevisionId: recordIdSchema.optional(),
    variantId: recordIdSchema.optional(),
    sectionElement: z.string({ error: "State the section this media is placed in." }).trim().min(1, "State the section this media is placed in."),
    position: z.int({ error: "State the position this placement takes as a whole number." }).nonnegative("A position is zero or more, counting from the first placement.").optional(),
  })
  .superRefine(refuseUnnamedDraftTarget);
const registerMediaAssetPayloadSchema = z
  .strictObject({
    kind: z.enum(["image", "video"], { error: "Choose whether this file is an image or a video." }),
    source: uploadBytesSchema,
    altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional(),
    caption: optionalPlacementTextSchema,
    credit: optionalPlacementTextSchema,
    language: localeTagSchema.optional(),
    placement: z.strictObject({ altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional(), caption: optionalPlacementTextSchema, credit: optionalPlacementTextSchema, language: localeTagSchema.optional() }).optional(),
    poster: z.strictObject({ bytesBase64: z.string().min(1), name: z.string().min(1).max(255).optional(), altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional() }).optional(),
    captions: z.strictObject({ vtt: z.string().min(1, "Choose a WebVTT caption file."), language: localeTagSchema, label: z.string().trim().min(1).max(120).optional() }).optional(),
    transcript: z.strictObject({ text: z.string().min(1, "State the transcript, or leave it out.") }).optional(),
    sectionPlacement: sectionPlacementPayloadSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    const altText = payload.altText ?? payload.placement?.altText;
    if (payload.kind === "image" && altText === undefined) ctx.addIssue({ code: "custom", path: ["altText"], message: "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again." });
    if (payload.kind === "image" && payload.captions !== undefined) ctx.addIssue({ code: "custom", path: ["captions"], message: "A caption track belongs to a video, so an image carries none." });
    if (payload.poster !== undefined && payload.kind !== "video") ctx.addIssue({ code: "custom", path: ["poster"], message: "A poster belongs to a video, so an image carries none." });
  });
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetPayloadSchema>;
export type RegisteredRenditionView = { readonly renditionId: string; readonly purpose: string };
export type RegisteredMediaAssetView = { readonly assetId: string; readonly kind: "image" | "video"; readonly state: "ready"; readonly altText: string | null; readonly caption: string | null; readonly language: string | null; readonly renditions: readonly RegisteredRenditionView[] };
type PendingRenditionBytes = { readonly bytesRef: string; readonly bytes: Uint8Array };
type PreparedRegistration = { readonly accepted: MediaAcceptanceSuccess<MediaAssetScope>; readonly renditions: readonly MediaRendition[]; readonly altText: string; readonly caption: string | null };
async function prepareRegisteredRenditions(payload: RegisterMediaAssetPayload, assetId: string, scope: MediaAssetScope): Promise<PreparedRegistration> {
  const bytes = decodeBase64Bytes(payload.source.bytesBase64, "source.bytesBase64");
  const altText = payload.altText ?? payload.placement?.altText ?? "";
  const caption = payload.caption ?? payload.placement?.caption ?? null;
  const accepted: MediaAcceptanceSuccess<MediaAssetScope> | MediaRefusal =
    payload.kind === "image"
      ? await acceptImage({ assetId, scope, sourceOriginalRef: { system: "local-upload", reference: assetId }, bytes, ...(payload.source.name === undefined ? {} : { sourceName: payload.source.name }), altText, ...(caption === null ? {} : { caption }) })
      : await acceptVideo({ assetId, scope, sourceOriginalRef: { system: "local-upload", reference: assetId }, bytes, ...(payload.source.name === undefined ? {} : { sourceName: payload.source.name }) });
  if (accepted.state === "rejected") throw invalidField("source", refusalText(accepted));
  const renditions: MediaRendition[] = [...accepted.renditions];
  if (payload.poster !== undefined) {
    const poster = await prepareRendition({ assetId, purpose: "poster", bytes: decodeBase64Bytes(payload.poster.bytesBase64, "poster.bytesBase64"), altText: payload.poster.altText ?? altText, ...(payload.poster.name === undefined ? {} : { sourceName: payload.poster.name }) });
    if (poster.state === "rejected") throw invalidField("poster", refusalText(poster));
    renditions.push(poster.rendition);
  }
  if (payload.captions !== undefined) {
    const captions = await prepareRendition({ assetId, purpose: "captions", bytes: new TextEncoder().encode(payload.captions.vtt) });
    if (captions.state === "rejected") throw invalidField("captions", refusalText(captions));
    renditions.push(captions.rendition);
  }
  if (payload.transcript !== undefined) {
    const transcript = await prepareRendition({ assetId, purpose: "transcript", bytes: new TextEncoder().encode(payload.transcript.text) });
    if (transcript.state === "rejected") throw invalidField("transcript", refusalText(transcript));
    renditions.push(transcript.rendition);
  }
  return { accepted, renditions, altText, caption };
}
async function writeReplayedRegistration(sessionId: string, payload: RegisterMediaAssetPayload, scope: MediaAssetScope, result: MutationResult): Promise<void> {
  const assetId = isRecord(result) && typeof result.assetId === "string" ? result.assetId : undefined;
  if (assetId === undefined) return;
  const replayed = await prepareRegisteredRenditions(payload, assetId, scope);
  for (const rendition of replayed.renditions) await writeMediaBytes(uploadedMediaReference(sessionId, assetId, rendition.renditionId, rendition.mimeType), rendition.bytes);
}
// The revision a registration presents: none for an Updates registration, which registers the asset here and places it through its own draft save, and the draft edition's own revision for a Page registration, which writes the placement itself.
function registrationTargetOf(documents: MutationContext["docs"], sectionPlacement: RegisterMediaAssetPayload["sectionPlacement"]): CurrentTarget {
  return sectionPlacement === undefined ? { kind: "absent" } : draftTarget(documents, sectionPlacement);
}
function storeRegisteredAsset(documents: MutationContext["docs"], opened: OpenedState, asset: MediaAssetRecord, descriptor: MediaAssetDescriptorRecord): string {
  writeState(documents, opened.raw, { mediaAssets: [...opened.state.mediaAssets, asset], mediaAssetDescriptors: [...opened.state.mediaAssetDescriptors, descriptor] });
  return asset.revision;
}
// One registration of a Page's section writes the asset, its descriptor and the draft revision that places it in that section, so an accepted attempt never leaves a stored asset no draft refers to.
function placeRegisteredAsset(input: {
  readonly context: MutationContext;
  readonly opened: OpenedState;
  readonly asset: MediaAssetRecord;
  readonly descriptor: MediaAssetDescriptorRecord;
  readonly altText: string;
  readonly caption: string | null;
  readonly credit: string | null;
  readonly sectionPlacement: NonNullable<RegisterMediaAssetPayload["sectionPlacement"]>;
}): string {
  const { context, opened, asset, descriptor, altText, caption, credit, sectionPlacement } = input;
  const mediaAssets = [...opened.state.mediaAssets, asset];
  const mediaAssetDescriptors = [...opened.state.mediaAssetDescriptors, descriptor];
  // A section composes a Worker or Project Page only, so a registration that names one on an Update is refused with the message a section change gets.
  const target = draftTargetOf(opened.state, sectionPlacement);
  // A placement is read back by the section it names, so a registration that names a section this draft does not hold is refused rather than stored where nothing would render it.
  if (!target.body.sections.some((section) => section.element === sectionPlacement.sectionElement)) throw invalidField("sectionPlacement.sectionElement", "This draft holds no section of that type, so reopen the edition and choose the section again.");
  const requested: readonly z.infer<typeof placementRefSchema>[] = [
    ...target.revision.mediaPlacements.map(placementRefOf),
    {
      assetId: asset.assetId,
      purpose: asset.kind === "image" ? "display" : "playback",
      ...(altText.length === 0 ? {} : { altText }),
      ...(caption === null ? {} : { caption }),
      ...(credit === null ? {} : { credit }),
      sectionElement: sectionPlacement.sectionElement,
      ...(sectionPlacement.position === undefined ? {} : { position: sectionPlacement.position }),
    },
  ];
  const placed: OpenedState = { raw: { ...opened.raw, mediaAssets, mediaAssetDescriptors }, state: { ...opened.state, mediaAssets, mediaAssetDescriptors } };
  const resolved = resolvePlacements({ state: placed.state, session: context.session, previous: target.revision.mediaPlacements, requested });
  const written = writeDraftEdit({ context, opened: placed, target, body: target.body, placements: resolved.placements, tracks: resolved.tracks });
  if (written.changed) return written.revision;
  // A placement list that already stated this entry changes no revision, so the asset and its descriptor are written on their own rather than appended twice.
  writeState(context.docs, placed.raw, { mediaAssets, mediaAssetDescriptors });
  return asset.revision;
}
/** Registers one uploaded image or video as a scoped asset with prepared renditions, and places it in the section a Page registration names. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function registerMediaAsset(sessionId: string, input: MutationInput<RegisterMediaAssetPayload>): Promise<MutationOutcome> {
  const scope: MediaAssetScope = { organizationId: input.scope.organizationId, ministryId: input.scope.ministryId };
  const pending: PendingRenditionBytes[] = [];
  const outcome = await runMutation({
    sessionId,
    input,
    schema: registerMediaAssetPayloadSchema,
    name: "registerMediaAsset",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (documents) => registrationTargetOf(documents, input.payload.sectionPlacement),
    apply: async (context) => {
      const { raw, state } = openState(context.docs);
      const payload = input.payload;
      const assetId = newRecordId("asset");
      const { accepted, renditions: preparedRenditions, altText, caption } = await prepareRegisteredRenditions(payload, assetId, scope);
      const credit = payload.credit ?? payload.placement?.credit ?? null;
      const language = payload.language ?? payload.placement?.language ?? null;
      const renditions = preparedRenditions.map((rendition) => {
        const bytesRef = uploadedMediaReference(sessionId, assetId, rendition.renditionId, rendition.mimeType);
        pending.push({ bytesRef, bytes: rendition.bytes });
        return storedRenditionOf(rendition, bytesRef);
      });
      const asset: MediaAssetRecord = {
        assetId,
        kind: accepted.kind,
        profileCheck: storedProfileOf(accepted.profileCheck),
        sourceOriginalRef: `${accepted.sourceOriginalRef.system}:${accepted.sourceOriginalRef.reference}`,
        renditions,
        scope: input.scope,
        tagVerification: storedVerificationOf(accepted.tagVerification),
        revision: INITIAL_REVISION_TOKEN,
      };
      const descriptor: MediaAssetDescriptorRecord = { assetId, altText: altText.length === 0 ? null : altText, caption, credit, language, captionLabel: payload.captions?.label ?? null, revision: INITIAL_REVISION_TOKEN };
      const sectionPlacement = payload.sectionPlacement;
      const revision = sectionPlacement === undefined ? storeRegisteredAsset(context.docs, { raw, state }, asset, descriptor) : placeRegisteredAsset({ context, opened: { raw, state }, asset, descriptor, altText, caption, credit, sectionPlacement });
      const result: RegisteredMediaAssetView = { assetId, kind: accepted.kind, state: "ready", altText: descriptor.altText, caption, language, renditions: renditions.map((rendition) => ({ renditionId: rendition.renditionId, purpose: rendition.purpose })) };
      return { changed: true, revision, result, created: [assetId] } satisfies ApplyResult<typeof result>;
    },
  });
  try {
    if (outcome.outcome === "accepted") {
      for (const item of pending) await writeMediaBytes(item.bytesRef, item.bytes);
    } else if (outcome.outcome === "alreadyAccepted") await writeReplayedRegistration(sessionId, input.payload, scope, outcome.result);
  } catch {
    return unknown({ operationId: input.operationId });
  }
  return outcome;
}
const placementTargetPayloadSchema = z.strictObject({ ...draftTargetShape, placementId: recordIdSchema, assetId: recordIdSchema.optional(), placement: placementTextSchema.partial().optional() }).superRefine(refuseUnnamedDraftTarget);
export type PlacementTargetPayload = z.infer<typeof placementTargetPayloadSchema>;
function placementRefOf(placement: MediaPlacementRecord): z.infer<typeof placementRefSchema> {
  const { placementId, assetId, position, altText } = placement;
  return { placementId, assetId, ...(placement.sectionElement === null ? {} : { sectionElement: placement.sectionElement }), position, altText, ...(placement.caption === null ? {} : { caption: placement.caption }), ...(placement.credit === null ? {} : { credit: placement.credit }) };
}
const withoutTracksOf = (tracks: readonly ContentCaptionTrackRecord[], remaining: readonly MediaPlacementRecord[]): readonly ContentCaptionTrackRecord[] => tracks.filter((track) => new Set(remaining.map((placement) => placement.assetId)).has(track.assetId));
/** Replaces one placement of a draft with another admitted asset, or with a new description of the same asset. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const replacePlacement = async (sessionId: string, input: MutationInput<PlacementTargetPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, placementTargetPayloadSchema, "replacePlacement", { readCurrent: draftTarget, apply: applyReplacePlacement });
function applyReplacePlacement(context: MutationContext, payload: PlacementTargetPayload): ApplyResult<MutationResult> {
  const opened = openState(context.docs);
  const target = placementTargetOf(opened.state, payload);
  if (target.revision.mediaPlacements.find((placement) => placement.placementId === payload.placementId) === undefined) throw invalidField("placementId", "This draft holds no placement by that identity, so reopen the page and choose the placement again.");
  const requested = target.revision.mediaPlacements.map((placement) => {
    if (placement.placementId !== payload.placementId) return placementRefOf(placement);
    return {
      ...placementRefOf(placement),
      ...(payload.assetId === undefined ? {} : { assetId: payload.assetId }),
      ...(payload.placement?.altText === undefined ? {} : { altText: payload.placement.altText }),
      ...(payload.placement?.caption === undefined ? {} : { caption: payload.placement.caption }),
      ...(payload.placement?.credit === undefined ? {} : { credit: payload.placement.credit }),
    };
  });
  const resolved = resolvePlacements({ state: opened.state, session: context.session, previous: target.revision.mediaPlacements, requested });
  const written = writeDraftEdit({ context, opened, target, body: target.body, placements: resolved.placements, tracks: withoutTracksOf(target.revision.captions, resolved.placements) });
  if (!written.changed) return { changed: false };
  const result: SectionEditView = { documentId: written.documentId, variantId: written.variantId, revisionId: written.revisionId, revision: written.revision, sectionCount: target.body.sections.length };
  return { changed: true, revision: written.revision, result, changedIds: [written.revisionId] } satisfies ApplyResult<typeof result>;
}
/** Removes one placement from a draft. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const removePlacement = async (sessionId: string, input: MutationInput<PlacementTargetPayload>): Promise<MutationOutcome> => runEditorial(sessionId, input, placementTargetPayloadSchema, "removePlacement", { readCurrent: draftTarget, apply: applyRemovePlacement });
function applyRemovePlacement(context: MutationContext, payload: PlacementTargetPayload): ApplyResult<MutationResult> {
  const opened = openState(context.docs);
  const target = placementTargetOf(opened.state, payload);
  const placementId = payload.placementId;
  if (!target.revision.mediaPlacements.some((placement) => placement.placementId === placementId)) throw invalidField("placementId", "This draft holds no placement by that identity, so reopen the page and choose the placement again.");
  const placements = target.revision.mediaPlacements.filter((placement) => placement.placementId !== placementId);
  const written = writeDraftEdit({ context, opened, target, body: target.body, placements, tracks: withoutTracksOf(target.revision.captions, placements) });
  if (!written.changed) return { changed: false };
  const result: SectionEditView = { documentId: written.documentId, variantId: written.variantId, revisionId: written.revisionId, revision: written.revision, sectionCount: target.body.sections.length };
  return { changed: true, revision: written.revision, result, changedIds: [written.revisionId] } satisfies ApplyResult<typeof result>;
}
