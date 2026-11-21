/**
 * The receiving job's named reads: the publisher's audience, a reader's own preference, the synthetic
 * inbox, the Updates a reader may open, the page discovery index, the public reading view, and the
 * per-send results of one notification intent.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isDevelopment } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import {
  MEMBER_CHOICES,
  UPDATE_EMAIL_PURPOSE,
  type AudiencePurpose,
  type MemberChoice,
  type MembershipRecord as DomainMembership,
  type MembershipState as DomainMembershipState,
} from "@/modules/audience/membership";
import { dedupeKey, mayRepeatIntent, type SendOutcomeState } from "@/modules/audience/consent";
import { EXCLUSION_REASONS, membershipAccessAt, type ContentAudience, type ExclusionReason } from "@/modules/audience/resolve";
import { directionOfTag, resolveLocale, type ContentLocale } from "@/modules/content/locale";
import { buildNotice, type PinnedRendition as NoticePinnedRendition } from "@/modules/content/notice";
import { isListedPublicly, reachMetadata, withdrawEdition, type ReachMetadata, type Tombstone } from "@/modules/content/reach";
import { renderToHtml, type RenderMediaPlacement, type RenderRendition, type RenderRenditions } from "@/modules/content/render";
import type { ContentDocument, Release } from "@/modules/content/variant";
import { readSession } from "@/modules/store/repository";
import { clampPageSize } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { confirmationDeadline, notificationDeadline } from "@/modules/time/window";
import { assertScope, canReadProtected, readResultOfRefusal, resolveSession, type ResolvedSession, type SessionSource } from "../authorize";
import {
  buildEnvelope,
  contentCaptionTrackRecordSchema,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  mediaAssetRecordSchema,
  mediaPlacementRecordSchema,
  membershipRecordSchema,
  ministryIdSchema,
  notificationIntentRecordSchema,
  notificationSendResultRecordSchema,
  organizationIdSchema,
  principalIdSchema,
  recordRevisionSchema,
  releaseRecordSchema,
  sharePresentationRecordSchema,
  storedInstantSchema,
  supportSubjectIdSchema,
  type ContentDocumentRecord,
  type ContentFamily,
  type ContentVariantRecord,
  type MediaAssetRecord,
  type MembershipRecord as StoredMembership,
  type NotificationSendResultRecord,
  type NotificationUnservedRecipientRecord,
  type ReadEnvelope,
  type RecordedValueState,
  type ReleaseReach,
  type ReleaseRecord,
  type Scope,
} from "../envelope";
import { denied, LOCAL_STORE_SYSTEM, unavailable, type DenialReason, type ReadResult } from "../outcome";
// The session marker and the development preview world
const READ_ATTEMPT_ID = "read";

const PREVIEW_PUBLISHER_SESSION_ID = "established-worker";

const STORE_READ_GUIDANCE =
  "The local synthetic store could not be read for this request. Retry the same request; if it keeps failing, reset the development data from Settings and reopen the session.";
const FIRST_PAGE = 1;

const NOTICE_SENDER = Object.freeze({
  name: "Update notices",
  address: "update-notice@example.invalid",
});
const UNNAMED_PUBLISHER = "";

const SIMULATED_MAIL_SUBMISSION = "mail-submission";
const SIMULATED_PUBLICATION_REACH = "publication-reach";
const SIMULATED_GIVING_DESTINATION = "giving-destination";

function updateHref(documentId: string): string {
  return `/preview/${encodeURIComponent(documentId)}`;
}
function pageHref(documentId: string, localeTag: string): string {
  return `/preview/pages/${encodeURIComponent(documentId)}/${encodeURIComponent(localeTag)}`;
}
function renditionPath(assetId: string, renditionId: string): string {
  return `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(renditionId)}`;
}
// The data each read answers with
/** One page of a whole-result count, stated the way every list states it. */
export interface PageWindow {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly pageCount: number;
}
/**
 * One member of the publisher's audience, projected without the address the record holds.
 *
 * `membershipId` and `recipientId` are the same opaque reference under its two names: the membership
 * the record holds, and the recipient a send result addresses. `membershipId` is the identifier a
 * membership mutation's payload names, so the Off or Immediate choice, the explicit confirmation and
 * the unsubscribe can each be submitted for the member this view shows.
 */
export interface AudienceMember {
  readonly membershipId: string;
  /** The same opaque reference under its send-recipient name, as a notification result records it. */
  readonly recipientId: string;
  readonly displayName: string | null;
  readonly state: DomainMembershipState;
  readonly choice: MemberChoice;
  readonly languagePreference: string;
  readonly acceptedOn: string | null;
  readonly eligible: boolean;
  readonly exclusionReason: ExclusionReason | null;
}
/** The publisher's audience view for one purpose, whole-result counts plus one page of members. */
export interface AudienceView {
  readonly publisherId: string | null;
  readonly purpose: AudiencePurpose;
  readonly choiceOptions: readonly MemberChoice[];
  readonly counts: { readonly eligible: number; readonly excluded: number; readonly total: number };
  readonly memberStates: Readonly<Record<DomainMembershipState, number>>;
  readonly excludedByReason: Readonly<Record<ExclusionReason, number>>;
  readonly sourceSuppliedRows: number;
  readonly members: readonly AudienceMember[];
  readonly page: PageWindow;
}
/** One copy already pinned for this reader, kept as recorded so a later change cannot substitute it. */
export interface PinnedCopy {
  readonly intentId: string;
  readonly sendResultId: string;
  readonly releaseId: string;
  readonly renditionId: string;
  readonly state: SendOutcomeState;
  readonly recordedAt: string;
}
/** The confirmation window of one acceptance, stated at the instant this read ran. */
export interface ConfirmationWindowView {
  readonly state: "not-awaiting-proof" | "open" | "expired";
  readonly deadline: string | null;
  readonly remainingMilliseconds: number | null;
}
/** A reader's own preference record for one publisher and one purpose. */
export interface PreferencesView {
  readonly state: "none" | DomainMembershipState;
  readonly membershipId: string | null;
  readonly publisherId: string | null;
  readonly purpose: AudiencePurpose;
  readonly choice: MemberChoice | null;
  readonly choiceOptions: readonly MemberChoice[];
  readonly languagePreference: string | null;
  readonly email: string | null;
  readonly acceptedOn: string | null;
  readonly confirmation: ConfirmationWindowView;
  readonly pending: { readonly claimsMailSent: false; readonly nextStep: string } | null;
  readonly readingGrant: { readonly granted: boolean; readonly audience: ContentAudience };
  readonly unsubscribeScope: {
    readonly publisherId: string;
    readonly purpose: AudiencePurpose;
  } | null;
  readonly pinnedCopies: readonly PinnedCopy[];
}
/** What a reader may do with the edition a message points at. */
export type InboxReading =
  | { readonly state: "link-only"; readonly href: string }
  | {
      readonly state: "rendered";
      readonly href: string;
      readonly title: string | null;
      readonly html: string;
    }
  | { readonly state: "unavailable"; readonly href: string; readonly reason: string };
/** One produced message in a reader's synthetic inbox. */
export interface InboxMessage {
  readonly messageId: string;
  readonly intentId: string;
  readonly releaseId: string;
  readonly variantId: string | null;
  readonly renditionId: string;
  readonly state: SendOutcomeState;
  readonly audience: ContentAudience | null;
  readonly locale: ContentLocale | null;
  readonly intendedAt: string;
  readonly recordedAt: string;
  readonly subject: string;
  readonly sender: string;
  readonly link: string;
  readonly protectedNotice: boolean;
  readonly html: string;
  readonly plainText: string;
  readonly reading: InboxReading;
  readonly simulated: readonly string[];
}
/** A reader's synthetic inbox: one message per recipient and intent, plus what was recorded. */
export interface InboxView {
  readonly messages: readonly InboxMessage[];
  readonly intentCount: number;
  readonly sendStates: Readonly<Record<SendOutcomeState, number>>;
  readonly unresolvedIntents: number;
  readonly page: PageWindow;
}
/** One edition a receiving reader may open. */
export interface ReceivingEdition {
  readonly documentId: string;
  readonly variantId: string;
  readonly releaseId: string;
  readonly audience: ContentAudience;
  readonly locale: ContentLocale;
  readonly publishedAt: string;
  readonly reach: ReleaseReach;
  readonly title: string | null;
  readonly description: string | null;
  readonly href: string;
}
/** The Updates a reader may open now, re-authorised at this read's instant. */
export interface ReceivingListView {
  readonly editions: readonly ReceivingEdition[];
  readonly languagePreference: string | null;
  readonly page: PageWindow;
}
/** One media reference a reading surface may place, reachable only through its scoped request. */
export interface MediaReference {
  readonly assetId: string;
  readonly renditionId: string;
  readonly purpose: string;
  readonly path: string;
}
/** What a Give placement resolves to. */
export type GivingPlacement =
  | {
      readonly state: "available";
      readonly designation: SourceReference;
      readonly label: string;
      readonly simulated: string;
    }
  | { readonly state: "giving-unavailable" };
/** One Update at its exact post, re-authorised on every open. */
export interface ReceivingPostView {
  readonly state: "rendered" | "language-unavailable";
  readonly documentId: string;
  readonly variantId: string | null;
  readonly releaseId: string | null;
  readonly audience: ContentAudience | null;
  readonly requestedLocale: string;
  readonly servedLocale: ContentLocale | null;
  readonly fallbackOccurred: boolean;
  readonly publishedAt: string | null;
  readonly title: string | null;
  readonly html: string | null;
  readonly renditions: readonly MediaReference[];
  readonly simulated: readonly string[];
}
/** One edition the discovery index lists publicly. */
export interface DiscoveryEntry {
  readonly documentId: string;
  readonly locale: ContentLocale;
  readonly title: string;
  readonly href: string;
  readonly noindex: boolean;
}
/** The pages the discovery index lists: only editions that reach a public listing. */
export interface DiscoveryIndexView {
  readonly entries: readonly DiscoveryEntry[];
  readonly page: PageWindow;
}
/** One published page edition served by direct link. */
export interface ReceivingPageView {
  readonly state: "served" | "withdrawn" | "language-unavailable";
  readonly documentId: string | null;
  readonly family: ContentFamily | null;
  readonly releaseId: string | null;
  readonly requestedLocale: string;
  readonly servedLocale: ContentLocale | null;
  readonly fallbackOccurred: boolean;
  readonly reach: ReleaseReach | null;
  readonly metadata: ReachMetadata | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly html: string | null;
  readonly renditions: readonly MediaReference[];
  readonly giving: GivingPlacement | null;
  readonly tombstone: Tombstone | null;
  readonly simulated: readonly string[];
}
/** One recipient's recorded outcome within a send result. */
export interface SendResultRow {
  readonly recipientId: string;
  readonly renditionId: string;
  readonly state: SendOutcomeState;
  readonly recordedAt: string;
  readonly dedupeKey: string;
  readonly retry: { readonly available: boolean; readonly reason: string };
  readonly recovery: { readonly intentId: string };
}
/**
 * The per-send results of one notification intent: one row per recipient the intent served, and one
 * entry per eligible recipient it did not. The two lists account for the intent's ceiling, so
 * `ceilingCount` equals the copies recorded (`counts.accepted + counts.failed + counts.unknown`) plus
 * `unserved.length` whenever the audience has not changed since the intent was accepted — a ceiling
 * larger than the rows alone says who the notice did not reach and why, never leaving the difference
 * unexplained.
 */
export interface SendResultView {
  readonly intentId: string;
  readonly releaseId: string;
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly intendedAt: string;
  readonly recordedAt: string | null;
  readonly ceilingCount: number;
  readonly counts: Readonly<Record<SendOutcomeState, number>>;
  readonly rows: readonly SendResultRow[];
  readonly unserved: readonly NotificationUnservedRecipientRecord[];
  readonly usefulness: {
    readonly state: "within-usefulness" | "past-usefulness";
    readonly deadline: string;
    readonly remainingMilliseconds: number | null;
  };
  readonly page: PageWindow;
}
// The stored document this read parses, and the two worlds a session may be answered from
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
const storedContextSchema = z.object({
  selectedOrganizationId: organizationIdSchema.nullable(),
  selectedMinistryId: ministryIdSchema.nullable(),
  selectedSupportSubjectId: supportSubjectIdSchema.nullable(),
});
const storedStateSchema = z.object({
  context: storedContextSchema,
  memberships: z.array(membershipRecordSchema),
  notificationIntents: z.array(notificationIntentRecordSchema),
  notificationResults: z.array(notificationSendResultRecordSchema),
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  contentRevisions: z.array(storedContentRevisionSchema),
  releases: z.array(releaseRecordSchema),
  mediaAssets: z.array(mediaAssetRecordSchema),
});
type StoredState = z.infer<typeof storedStateSchema>;

type StoredRevision = z.infer<typeof storedContentRevisionSchema>;

/** One session's parsed store: the unit both worlds a request may be answered from are expressed in. */
export interface World {
  readonly sessionId: string;
  readonly state: StoredState;
}
type WorldResolution =
  | {
      readonly ok: true;
      readonly session: ResolvedSession;
      readonly own: World;
      readonly published: World;
    }
  | { readonly ok: false; readonly result: ReadResult<never> };
function deniedRead(reason: DenialReason): ReadResult<never> {
  return { kind: "denied", denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }) };
}
function sourceUnavailableRead(job: string, reference: string, system: string = LOCAL_STORE_SYSTEM): ReadResult<never> {
  const source: SourceReference = { system, reference };
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT_ID,
      source,
      guidance: STORE_READ_GUIDANCE,
    }),
  };
}
async function loadWorld(sessionId: string): Promise<{ readonly ok: true; readonly world: World } | { readonly ok: false; readonly reference: string }> {
  let documents;
  try {
    documents = await readSession(sessionId);
  } catch (error) {
    const name: unknown = error instanceof Error ? error.name : undefined;
    return {
      ok: false,
      reference: typeof name === "string" && name.length > 0 ? name : "unreadable-session",
    };
  }
  if (documents === undefined) {
    return { ok: false, reference: "session-not-in-store" };
  }
  const parsed = storedStateSchema.safeParse(documents.state);
  if (!parsed.success) {
    return { ok: false, reference: "unreadable-state-document" };
  }
  return { ok: true, world: { sessionId, state: parsed.data } };
}
/** Resolves the session this read acts for and the two worlds it may answer from — the caller's own, and the published world the reader crossing reaches — or the read's own refusal. */
export async function resolveWorlds(job: string, source?: SessionSource): Promise<WorldResolution> {
  // The receiving reads take the same optional session source every other read does, so a test or a
  // script can name the session it reads as instead of there being no request cookie to derive one from.
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    return { ok: false, result: readResultOfRefusal(resolved.refusal) };
  }
  const { session } = resolved;
  const own = await loadWorld(session.sessionId);
  if (!own.ok) {
    return { ok: false, result: sourceUnavailableRead(job, own.reference) };
  }
  const crossesSessions = isDevelopment() && session.admittedMemberships.length === 0 && session.sessionId !== PREVIEW_PUBLISHER_SESSION_ID;
  if (!crossesSessions) {
    return { ok: true, session, own: own.world, published: own.world };
  }
  const publisher = await loadWorld(PREVIEW_PUBLISHER_SESSION_ID);
  if (!publisher.ok) {
    return { ok: false, result: sourceUnavailableRead(job, publisher.reference) };
  }
  return { ok: true, session, own: own.world, published: publisher.world };
}
// Scope: the authority a read states, and whether the caller holds it
/** The scope a read states in one world: the context the caller selected, the context the world holds, or nothing when neither names one. */
export function scopeOf(session: ResolvedSession, world: World): Scope | undefined {
  if (session.selected !== null) {
    return session.selected;
  }
  const { context } = world.state;
  if (context.selectedOrganizationId === null || context.selectedMinistryId === null || context.selectedSupportSubjectId === null) {
    return undefined;
  }
  return {
    organizationId: context.selectedOrganizationId,
    ministryId: context.selectedMinistryId,
    supportSubjectId: context.selectedSupportSubjectId,
    principalId: session.principalId,
  };
}
function admittedToWorld(session: ResolvedSession, world: World): boolean {
  const scope = scopeOf(session, world);
  return scope !== undefined && assertScope(session, scope).ok;
}
// Stored record to domain record: the one adapter each shape needs
function instantOf(value: string | null | undefined): Temporal.Instant | undefined {
  if (value === null || value === undefined || value.length === 0) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}
function revisionOrdinal(revision: string): number {
  const digits = /(\d+)\s*$/u.exec(revision);
  if (digits === null) {
    return 1;
  }
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
function domainMembershipOf(record: StoredMembership, scope: Scope): DomainMembership {
  const acceptedAt = instantOf(record.acceptedAt);
  const confirmation = instantOf(record.confirmationDeadline);
  const choice: MemberChoice = record.state === "off" || record.state === "restricted" ? "off" : "immediate";
  return {
    membershipId: record.membershipId,
    scope: { organizationId: scope.organizationId, ministryId: scope.ministryId },
    publisherId: record.publisherId,
    purpose: record.purpose,
    recipientId: record.membershipId,
    email: record.email,
    state: record.state,
    choice,
    languagePreference: record.languagePreference ?? "",
    ...(acceptedAt === undefined ? {} : { acceptedAt }),
    ...(acceptedAt !== undefined && record.state !== "awaiting-proof" ? { confirmedAt: acceptedAt } : {}),
    ...(confirmation === undefined ? {} : { confirmationDeadline: confirmation }),
    revision: revisionOrdinal(record.revision),
  };
}
function localeOfRelease(record: ReleaseRecord, variant: ContentVariantRecord | undefined): ContentLocale {
  return {
    tag: record.locale,
    direction: variant?.direction ?? directionOfTag(record.locale),
  };
}
function domainReleaseOf(record: ReleaseRecord, variant: ContentVariantRecord | undefined, revision: StoredRevision | undefined): Release | undefined {
  const publishedAt = instantOf(record.publishedAt);
  if (publishedAt === undefined || revision === undefined) {
    return undefined;
  }
  const withdrawnAt = instantOf(record.withdrawnAt);
  return {
    releaseId: record.releaseId,
    variantId: record.variantId,
    revisionId: record.revisionId,
    audience: record.audience,
    locale: localeOfRelease(record, variant),
    publishedAt,
    reach: record.reach,
    contentChecksum: revision.contentChecksum,
    ...(withdrawnAt === undefined ? {} : { withdrawnAt }),
    ...(record.supersededBy === null ? {} : { supersededBy: record.supersededBy }),
  };
}
function domainDocumentOf(record: ContentDocumentRecord): ContentDocument {
  return {
    documentId: record.documentId,
    family: record.family,
    kind: record.kind,
    sourceSubject: record.sourceSubject,
    siteId: record.siteId,
    ...(record.givingBinding === null ? {} : { givingBinding: record.givingBinding.designation }),
    managedFields: {},
  };
}
// Small shared helpers: paging, value states, collection identity and rendering
interface PageQuery {
  readonly page?: number;
  readonly pageSize?: number;
}
function pageNumberOf(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return FIRST_PAGE;
  }
  const whole = Math.trunc(requested);
  return whole < FIRST_PAGE ? FIRST_PAGE : whole;
}
function pageWindowOf(total: number, query: PageQuery): { readonly window: PageWindow; readonly offset: number; readonly limit: number } {
  const pageSize = clampPageSize(query.pageSize);
  const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = pageNumberOf(query.page);
  return {
    window: { page, pageSize, total, pageCount },
    offset: (page - FIRST_PAGE) * pageSize,
    limit: pageSize,
  };
}
function sliceOf<T>(items: readonly T[], offset: number, limit: number): readonly T[] {
  return items.slice(offset, offset + limit);
}
function countState(count: number): RecordedValueState {
  return count === 0 ? "zero" : "value";
}
function textState(value: string | null | undefined): RecordedValueState {
  return value === null || value === undefined || value.length === 0 ? "unknown" : "value";
}
function collectionRevision(parts: readonly string[]): string {
  const sorted = [...parts].sort();
  let hash = 0x811c9dc5;
  for (const part of sorted) {
    for (const character of `${part}\u001f`) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `col-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
interface RenderingMedia {
  readonly placements: readonly RenderMediaPlacement[];
  readonly renditions: RenderRenditions;
  readonly references: readonly MediaReference[];
}
function renderingMediaOf(revision: StoredRevision, assets: readonly MediaAssetRecord[]): RenderingMedia {
  const byId = new Map(assets.map((asset) => [asset.assetId, asset] as const));
  const placementList: RenderMediaPlacement[] = [];
  const renditions: Record<string, RenderRendition> = {};
  const references: MediaReference[] = [];
  for (const placement of [...revision.mediaPlacements].sort((left, right) => left.position - right.position)) {
    const asset = byId.get(placement.assetId);
    if (asset === undefined) {
      placementList.push({
        placementId: placement.placementId,
        kind: "image",
        altText: placement.altText,
        ...(placement.caption === null ? {} : { caption: placement.caption }),
      });
      continue;
    }
    const main = asset.renditions.find((rendition) => (asset.kind === "video" ? rendition.purpose === "playback" : rendition.purpose === "display"));
    const poster = asset.renditions.find((rendition) => rendition.purpose === "poster");
    const captions = revision.captions.find((track) => track.assetId === placement.assetId);
    const captionRendition = captions === undefined ? undefined : asset.renditions.find((rendition) => rendition.renditionId === captions.renditionId);
    if (main !== undefined) {
      const path = renditionPath(asset.assetId, main.renditionId);
      renditions[placement.placementId] = {
        src: path,
        purpose: main.purpose === "playback" ? "playback" : "display",
      };
      references.push({
        assetId: asset.assetId,
        renditionId: main.renditionId,
        purpose: main.purpose,
        path,
      });
    }
    if (poster !== undefined) {
      const posterKey = `${placement.placementId}:poster`;
      const path = renditionPath(asset.assetId, poster.renditionId);
      renditions[posterKey] = { src: path, purpose: "poster" };
      references.push({
        assetId: asset.assetId,
        renditionId: poster.renditionId,
        purpose: poster.purpose,
        path,
      });
    }
    if (captionRendition !== undefined && captions !== undefined) {
      const captionsKey = `${placement.placementId}:captions`;
      const path = renditionPath(asset.assetId, captionRendition.renditionId);
      renditions[captionsKey] = { src: path, purpose: "captions" };
      references.push({
        assetId: asset.assetId,
        renditionId: captionRendition.renditionId,
        purpose: captionRendition.purpose,
        path,
      });
    }
    placementList.push({
      placementId: placement.placementId,
      kind: asset.kind,
      altText: placement.altText,
      ...(placement.caption === null ? {} : { caption: placement.caption }),
      ...(poster === undefined ? {} : { posterId: `${placement.placementId}:poster` }),
      ...(captions === undefined
        ? {}
        : {
            captionsId: `${placement.placementId}:captions`,
            captionsLanguage: captions.language,
            captionsLabel: captions.label,
          }),
    });
  }
  return { placements: placementList, renditions, references };
}
type RevisionRendering = { readonly ok: true; readonly html: string; readonly media: RenderingMedia } | { readonly ok: false; readonly reason: string };

function renderingOf(revision: StoredRevision, assets: readonly MediaAssetRecord[]): RevisionRendering {
  const media = renderingMediaOf(revision, assets);
  const rendered = renderToHtml(revision.body, {
    placements: media.placements,
    renditions: media.renditions,
  });
  if (rendered.status === "invalid") {
    return {
      ok: false,
      reason: "The edition's content does not satisfy the content profile this build renders.",
    };
  }
  return { ok: true, html: rendered.html, media };
}
interface ResolvedRelease {
  readonly record: ReleaseRecord;
  readonly variant: ContentVariantRecord | undefined;
  readonly revision: StoredRevision | undefined;
  readonly document: ContentDocumentRecord | undefined;
  readonly domain: Release | undefined;
}
/** Resolves one stored release against the state it lives in: its variant, revision, document and domain release. */
export function resolveRelease(record: ReleaseRecord, state: StoredState): ResolvedRelease {
  const variant = state.contentVariants.find((candidate) => candidate.variantId === record.variantId);
  const revision = state.contentRevisions.find((candidate) => candidate.revisionId === record.revisionId);
  const document = variant === undefined ? undefined : state.contentDocuments.find((candidate) => candidate.documentId === variant.documentId);
  return {
    record,
    variant,
    revision,
    document,
    domain: domainReleaseOf(record, variant, revision),
  };
}
/** Reports whether a release still serves its readers: a release that has been withdrawn or superseded serves nobody. */
export function releaseStillServes(release: Release): boolean {
  return release.withdrawnAt === undefined && release.supersededBy === undefined;
}
function zeroMemberStates(): Record<DomainMembershipState, number> {
  return { active: 0, "awaiting-proof": 0, off: 0, restricted: 0 };
}
function zeroExclusionCounts(): Record<ExclusionReason, number> {
  const counts = {} as Record<ExclusionReason, number>;
  for (const reason of EXCLUSION_REASONS) {
    counts[reason] = 0;
  }
  return counts;
}
function zeroSendStates(): Record<SendOutcomeState, number> {
  return { accepted: 0, failed: 0, unknown: 0 };
}
// Every text order below comes from the shared code-unit comparator in `@/lib/ordering`.
function scenarioInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}
function singlePublisherOf(rows: readonly StoredMembership[]): string | undefined {
  const publishers = [...new Set(rows.map((row) => row.publisherId))].sort(compareCodeUnits);
  return publishers.length === 1 ? publishers[0] : undefined;
}
function readerOwnedMemberships(session: ResolvedSession, own: World, published: World): readonly StoredMembership[] {
  const fromOwn = session.admittedMemberships.length === 0 ? own.state.memberships : own.state.memberships.filter((row) => row.membershipId === session.principalId);
  const addressedElsewhere = published.state.memberships.filter((row) => row.membershipId === session.principalId);
  const byId = new Map<string, StoredMembership>();
  for (const row of [...fromOwn, ...addressedElsewhere]) {
    if (row.purpose === UPDATE_EMAIL_PURPOSE && !byId.has(row.membershipId)) {
      byId.set(row.membershipId, row);
    }
  }
  return [...byId.values()].sort((left, right) => compareCodeUnits(left.membershipId, right.membershipId));
}
/** The query the publisher's audience view accepts. */
export interface AudienceQuery {
  readonly publisherId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}
/** The publisher's audience for the one purpose this release keeps memberships for. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readAudience(query: AudienceQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<AudienceView>>> {
  const worlds = await resolveWorlds("readAudience", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  if (!admittedToWorld(session, published)) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const addressed = published.state.memberships.filter((row) => row.purpose === UPDATE_EMAIL_PURPOSE);
  const publisherId = query.publisherId ?? singlePublisherOf(addressed);
  const rows = publisherId === undefined ? [] : addressed.filter((row) => row.publisherId === publisherId);
  const members = rows
    .map((record) => {
      const domain = domainMembershipOf(record, scope);
      const access = membershipAccessAt(domain, at);
      return { record, domain, access };
    })
    .sort((left, right) => compareCodeUnits(left.record.membershipId, right.record.membershipId));
  const memberStates = zeroMemberStates();
  const excludedByReason = zeroExclusionCounts();
  let eligible = 0;
  let excluded = 0;
  let sourceSuppliedRows = 0;
  for (const member of members) {
    memberStates[member.access.state] += 1;
    if (member.domain.sourceDisposition !== undefined) {
      sourceSuppliedRows += 1;
    }
    const reason = member.access.reason;
    if (member.access.admitted) {
      eligible += 1;
    } else {
      excluded += 1;
      if (reason !== undefined) {
        excludedByReason[reason] += 1;
      }
    }
  }
  const { window, offset, limit } = pageWindowOf(members.length, query);
  const visible = sliceOf(members, offset, limit).map((member): AudienceMember => ({
    membershipId: member.record.membershipId,
    recipientId: member.record.membershipId,
    displayName: member.record.displayName,
    state: member.access.state,
    choice: member.domain.choice,
    languagePreference: member.domain.languagePreference,
    acceptedOn: member.record.acceptedAt,
    eligible: member.access.admitted,
    exclusionReason: member.access.reason ?? null,
  }));
  const data: AudienceView = {
    publisherId: publisherId ?? null,
    purpose: UPDATE_EMAIL_PURPOSE,
    choiceOptions: MEMBER_CHOICES,
    counts: { eligible, excluded, total: members.length },
    memberStates,
    excludedByReason,
    sourceSuppliedRows,
    members: visible,
    page: window,
  };
  const valueStates: Record<string, RecordedValueState> = {
    "counts.total": countState(data.counts.total),
    "counts.eligible": countState(data.counts.eligible),
    "counts.excluded": countState(data.counts.excluded),
    "memberStates.active": countState(memberStates.active),
    "memberStates.awaiting-proof": countState(memberStates["awaiting-proof"]),
    "memberStates.off": countState(memberStates.off),
    "memberStates.restricted": countState(memberStates.restricted),
    sourceSuppliedRows: countState(sourceSuppliedRows),
    "page.total": countState(window.total),
    "page.pageCount": countState(window.pageCount),
  };
  for (const reason of EXCLUSION_REASONS) {
    valueStates[`excludedByReason.${reason}`] = countState(excludedByReason[reason]);
  }
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "audience-memberships", reference: publisherId ?? "no-publisher" },
      revision: collectionRevision(rows.map((row) => `${row.membershipId}@${row.revision}`)),
      asOf: at.toString(),
      coverage: { from: null, to: null, state: "complete" },
      valueStates,
      actions: [
        {
          name: "setPreference",
          available: false,
          reason: "The Off and Immediate decision is the person's own: a worker may read this audience and may not change anyone's choice.",
        },
        {
          name: "unsubscribe",
          available: false,
          reason: "An unsubscribe acts on one publisher and one purpose and only from the person whose membership it is.",
        },
        {
          name: "signupForPurpose",
          available: false,
          reason: "Importing or editing a contact subscribes nobody: only the person's own deliberate signup creates a membership.",
        },
      ],
    }),
  };
}
/** The reader's own preference record for the one purpose this release keeps memberships for. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPreferences(source?: SessionSource): Promise<ReadResult<ReadEnvelope<PreferencesView>>> {
  const worlds = await resolveWorlds("readPreferences", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, own, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const rows = readerOwnedMemberships(session, own, published);
  const domains = rows.map((row) => domainMembershipOf(row, scope));
  const membership = rows[0];
  const domain = domains[0];
  const readingGrant = readingGrantOf(session, domains, session.principalId);
  const pinnedCopies: PinnedCopy[] = [];
  if (rows.length > 0) {
    for (const result of published.state.notificationResults) {
      const intent = published.state.notificationIntents.find((candidate) => candidate.intentId === result.intentId);
      if (intent === undefined) {
        continue;
      }
      for (const copy of result.recipients) {
        if (copy.recipientId !== session.principalId) {
          continue;
        }
        pinnedCopies.push({
          intentId: intent.intentId,
          sendResultId: result.sendResultId,
          releaseId: intent.releaseId,
          renditionId: copy.renditionId,
          state: copy.state,
          recordedAt: copy.at,
        });
      }
    }
  }
  pinnedCopies.sort((left, right) => compareCodeUnits(left.intentId, right.intentId));
  const confirmation = confirmationWindowOf(domain, at);
  const awaitingProof = domain !== undefined && domain.state === "awaiting-proof";
  const publisherId = membership?.publisherId ?? null;
  const data: PreferencesView = {
    state: domain?.state ?? "none",
    membershipId: membership?.membershipId ?? null,
    publisherId,
    purpose: UPDATE_EMAIL_PURPOSE,
    choice: domain?.choice ?? null,
    choiceOptions: MEMBER_CHOICES,
    languagePreference: membership?.languagePreference ?? null,
    email: membership?.email ?? null,
    acceptedOn: membership?.acceptedAt ?? null,
    confirmation,
    pending: awaitingProof ? { claimsMailSent: false, nextStep: "confirm-from-the-rendered-message" } : null,
    readingGrant: { granted: readingGrant, audience: "approved-supporter" },
    unsubscribeScope: publisherId === null ? null : { publisherId, purpose: UPDATE_EMAIL_PURPOSE },
    pinnedCopies,
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "audience-memberships", reference: publisherId ?? "no-membership" },
      // A membership mutation presents the revision the caller read as its `expectedRevision`, and the
      // token it compares that against is the addressed membership's own stored revision, so this view
      // publishes exactly that instead of a collection hash no mutation accepts. A reader that holds no
      // membership has no record revision to present, so the collection revision stands for it.
      revision: membership?.revision ?? collectionRevision(domains.map((row) => `${row.membershipId}@${String(row.revision)}`)),
      asOf: at.toString(),
      coverage: { from: null, to: null, state: "complete" },
      valueStates: {
        "confirmation.deadline": textState(data.confirmation.deadline),
        "confirmation.remainingMilliseconds": data.confirmation.remainingMilliseconds === null ? "unknown" : countState(data.confirmation.remainingMilliseconds),
        pinnedCopies: countState(pinnedCopies.length),
      },
      actions: [
        {
          name: "setPreference",
          available: domain !== undefined && domain.state !== "restricted",
          ...(domain === undefined ? { reason: "No membership exists yet: choose Immediate to begin the proof step." } : {}),
        },
        {
          name: "setLanguagePreference",
          available: domain !== undefined,
          ...(domain === undefined ? { reason: "No membership exists yet, so there is no preference to change." } : {}),
        },
        {
          name: "confirmMembership",
          available: data.confirmation.state === "open",
          ...(data.confirmation.state === "open" ? {} : { reason: "Nothing is waiting for confirmation at this instant." }),
        },
        {
          name: "unsubscribe",
          available: domain !== undefined && domain.state !== "restricted",
          ...(domain === undefined ? { reason: "No membership exists yet, so there is nothing to turn off." } : {}),
        },
      ],
    }),
  };
}
function readingGrantOf(session: ResolvedSession, memberships: readonly DomainMembership[], recipientId: string): boolean {
  const publishers = [...new Set(memberships.map((row) => row.publisherId))].sort(compareCodeUnits);
  return publishers.some(
    (publisherId) =>
      canReadProtected(session, {
        audience: "approved-supporter",
        reader: { recipientId, publisherId, purpose: UPDATE_EMAIL_PURPOSE, memberships },
      }).allowed,
  );
}
function confirmationWindowOf(membership: DomainMembership | undefined, at: Temporal.Instant): ConfirmationWindowView {
  if (membership === undefined || membership.state !== "awaiting-proof") {
    return { state: "not-awaiting-proof", deadline: null, remainingMilliseconds: null };
  }
  const acceptedAt = membership.acceptedAt;
  if (acceptedAt === undefined) {
    return { state: "not-awaiting-proof", deadline: null, remainingMilliseconds: null };
  }
  const window = confirmationDeadline({ acceptedAt, now: at });
  return window.status === "within-window"
    ? {
        state: "open",
        deadline: window.deadlineInstant.toString(),
        remainingMilliseconds: window.remainingMilliseconds,
      }
    : {
        state: "expired",
        deadline: window.deadlineInstant.toString(),
        remainingMilliseconds: null,
      };
}
/** The query the synthetic inbox accepts. */
export interface InboxQuery {
  readonly page?: number;
  readonly pageSize?: number;
}
/** The synthetic inbox of the receiving persona: one message per recipient and notification intent. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readInbox(query: InboxQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<InboxView>>> {
  const worlds = await resolveWorlds("readInbox", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const messages: InboxMessage[] = [];
  const seenIntents = new Set<string>();
  let unresolvedIntents = 0;
  for (const result of published.state.notificationResults) {
    const copies = result.recipients.filter((copy) => copy.recipientId === session.principalId);
    if (copies.length === 0) {
      continue;
    }
    // One message per recipient and intent: the first recorded copy is the message, and a second row for
    // the same identity is not a second message.
    if (seenIntents.has(result.intentId)) {
      continue;
    }
    seenIntents.add(result.intentId);
    const intent = published.state.notificationIntents.find((candidate) => candidate.intentId === result.intentId);
    const release = intent === undefined ? undefined : published.state.releases.find((candidate) => candidate.releaseId === intent.releaseId);
    const resolved = release === undefined ? undefined : resolveRelease(release, published.state);
    const copy = copies[0];
    if (intent === undefined || release === undefined || resolved === undefined || resolved.revision === undefined || resolved.domain === undefined || copy === undefined) {
      unresolvedIntents += 1;
      continue;
    }
    const href = updateHref(intent.documentId);
    const pinned: NoticePinnedRendition = {
      variantId: release.variantId,
      releaseId: release.releaseId,
      revisionId: release.revisionId,
      audience: release.audience,
      locale: resolved.domain.locale,
      renditionId: copy.renditionId,
      checksum: resolved.revision.contentChecksum,
    };
    const notice = buildNotice({
      publisher: { displayName: UNNAMED_PUBLISHER },
      purpose: intent.purpose,
      pinned,
      sender: NOTICE_SENDER,
      link: href,
    });
    const protectedNotice = release.audience === "approved-supporter";
    let reading: InboxReading;
    if (protectedNotice) {
      // Access is rechecked at the link, and only a holder of a grant is told so; the notice's own body
      // carries no protected prose, image, location, poster, transcript, caption or hidden alternative.
      reading = { state: "link-only", href };
    } else {
      const rendered = renderingOf(resolved.revision, published.state.mediaAssets);
      reading = rendered.ok
        ? {
            state: "rendered",
            href,
            title: resolved.revision.sharePresentation.title,
            html: rendered.html,
          }
        : { state: "unavailable", href, reason: rendered.reason };
    }
    messages.push({
      messageId: `${result.sendResultId}:${copy.recipientId}`,
      intentId: intent.intentId,
      releaseId: release.releaseId,
      variantId: release.variantId,
      renditionId: copy.renditionId,
      state: copy.state,
      audience: release.audience,
      locale: resolved.domain.locale,
      intendedAt: intent.intendedAt,
      recordedAt: copy.at,
      subject: notice.subject,
      sender: notice.sender,
      link: notice.link,
      protectedNotice,
      html: notice.htmlBody,
      plainText: notice.textBody,
      reading,
      simulated: [SIMULATED_MAIL_SUBMISSION],
    });
  }
  messages.sort((left, right) => {
    const byInstant = compareCodeUnits(right.intendedAt, left.intendedAt);
    return byInstant === 0 ? compareCodeUnits(left.messageId, right.messageId) : byInstant;
  });
  const sendStates = zeroSendStates();
  for (const message of messages) {
    sendStates[message.state] += 1;
  }
  const { window, offset, limit } = pageWindowOf(messages.length, query);
  const data: InboxView = {
    messages: sliceOf(messages, offset, limit),
    intentCount: messages.length,
    sendStates,
    unresolvedIntents,
    page: window,
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "notification-results", reference: "synthetic-inbox" },
      revision: collectionRevision(messages.map((message) => `${message.intentId}@${message.state}`)),
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        intentCount: countState(data.intentCount),
        unresolvedIntents: countState(unresolvedIntents),
        "sendStates.accepted": countState(sendStates.accepted),
        "sendStates.failed": countState(sendStates.failed),
        "sendStates.unknown": countState(sendStates.unknown),
        "page.total": countState(window.total),
        "page.pageCount": countState(window.pageCount),
      },
      actions: [
        {
          name: "readPinnedEdition",
          available: messages.some((message) => message.reading.state === "rendered"),
          ...(messages.some((message) => message.reading.state === "rendered")
            ? {}
            : {
                reason: "No message in this inbox points at an edition this reader may open directly; a protected notice is followed at its link, where access is rechecked.",
              }),
        },
        {
          name: "readSendResult",
          available: messages.length > 0,
          ...(messages.length > 0
            ? {}
            : {
                reason: "This inbox holds no message, so it has no intent to report results for.",
              }),
        },
        {
          name: "confirmMembership",
          available: false,
          reason: "Confirming an address is an explicit action on the preference surface, never a consequence of reading a message or of a page loading.",
        },
      ],
    }),
  };
}
function languagePreferenceOf(session: ResolvedSession, own: World, published: World): string | null {
  const rows = readerOwnedMemberships(session, own, published);
  for (const row of rows) {
    const preference = row.languagePreference;
    if (preference !== null && preference.length > 0) {
      return preference;
    }
  }
  return null;
}
/** Reports whether the caller holds a protected-reading grant for this publisher, decided now from the reader's own membership rows. */
export function grantHeldFor(session: ResolvedSession, scope: Scope, own: World, published: World): boolean {
  return readingGrantOf(
    session,
    readerOwnedMemberships(session, own, published).map((row) => domainMembershipOf(row, scope)),
    session.principalId,
  );
}
interface AdmittedEdition {
  readonly record: ReleaseRecord;
  readonly revision: StoredRevision;
  readonly document: ContentDocumentRecord;
  readonly domain: Release;
}
function editionsOf(documentId: string, state: StoredState): readonly AdmittedEdition[] {
  const editions: AdmittedEdition[] = [];
  for (const record of state.releases) {
    const resolved = resolveRelease(record, state);
    if (resolved.revision === undefined || resolved.document === undefined || resolved.domain === undefined || resolved.document.documentId !== documentId) {
      continue;
    }
    editions.push({
      record,
      revision: resolved.revision,
      document: resolved.document,
      domain: resolved.domain,
    });
  }
  return editions.sort((left, right) => {
    const byPublication = Temporal.Instant.compare(right.domain.publishedAt, left.domain.publishedAt);
    return byPublication === 0 ? compareCodeUnits(left.record.releaseId, right.record.releaseId) : byPublication;
  });
}
function requestedLocaleOf(requested: string | undefined, preference: string | null, editions: readonly AdmittedEdition[]): string {
  if (requested !== undefined && requested.length > 0) {
    return requested;
  }
  if (preference !== null && preference.length > 0) {
    return preference;
  }
  return editions[0]?.domain.locale.tag ?? "";
}
type EditionResolution =
  | {
      readonly status: "served";
      readonly edition: AdmittedEdition;
      readonly locale: ContentLocale;
      readonly fallbackOccurred: boolean;
    }
  | { readonly status: "protected-not-permitted" }
  | { readonly status: "unavailable" };
function resolveEditionFor(input: {
  readonly document: ContentDocumentRecord;
  readonly editions: readonly AdmittedEdition[];
  readonly requestedLocale: string;
  readonly grantHeld: boolean;
}): EditionResolution {
  const attempt = (
    audience: ContentAudience,
  ):
    | {
        readonly edition: AdmittedEdition;
        readonly locale: ContentLocale;
        readonly fallbackOccurred: boolean;
      }
    | undefined => {
    const candidates = input.editions.filter((edition) => edition.record.audience === audience);
    if (candidates.length === 0) {
      return undefined;
    }
    const resolution = resolveLocale({
      document: domainDocumentOf(input.document),
      siteDefaultLocale: "",
      audience,
      releases: candidates.map((edition) => ({
        ...edition.domain,
        documentId: input.document.documentId,
        siteId: input.document.siteId,
      })),
      requestedLocale: input.requestedLocale,
    });
    if (resolution.status !== "resolved") {
      return undefined;
    }
    const chosen = candidates.find((edition) => edition.record.releaseId === resolution.release.releaseId);
    if (chosen === undefined) {
      return undefined;
    }
    return {
      edition: chosen,
      locale: resolution.servedLocale,
      fallbackOccurred: resolution.fallbackOccurred,
    };
  };
  if (input.grantHeld) {
    const preferred = attempt("approved-supporter") ?? attempt("public");
    return preferred === undefined ? { status: "unavailable" } : { status: "served", ...preferred };
  }
  const publicEdition = attempt("public");
  if (publicEdition !== undefined) {
    return { status: "served", ...publicEdition };
  }
  return attempt("approved-supporter") === undefined ? { status: "unavailable" } : { status: "protected-not-permitted" };
}
/** The query the receiving list accepts. */
export interface ReceivingListQuery {
  readonly locale?: string;
  readonly page?: number;
  readonly pageSize?: number;
}
/** The Updates a receiving reader may open now. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReceivingList(query: ReceivingListQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReceivingListView>>> {
  const worlds = await resolveWorlds("readReceivingList", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, own, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const preference = languagePreferenceOf(session, own, published);
  const grantHeld = grantHeldFor(session, scope, own, published);
  const requested = requestedLocaleOf(query.locale, preference, []);
  const editions: ReceivingEdition[] = [];
  for (const record of published.state.releases) {
    const resolved = resolveRelease(record, published.state);
    if (resolved.domain === undefined || resolved.revision === undefined || resolved.document === undefined || resolved.document.family !== "update") {
      continue;
    }
    // Withdrawal and supersession end an edition's service, and a `not-public` edition serves nobody on
    // this list. The reach rule is the one authority for what a release may serve.
    if (!releaseStillServes(resolved.domain)) {
      continue;
    }
    if (record.reach === "not-public") {
      continue;
    }
    if (record.audience === "approved-supporter" && !grantHeld) {
      continue;
    }
    editions.push({
      documentId: resolved.document.documentId,
      variantId: record.variantId,
      releaseId: record.releaseId,
      audience: record.audience,
      locale: resolved.domain.locale,
      publishedAt: record.publishedAt,
      reach: record.reach,
      title: resolved.revision.sharePresentation.title,
      description: resolved.revision.sharePresentation.description,
      href: updateHref(resolved.document.documentId),
    });
  }
  editions.sort((left, right) => {
    if (left.audience !== right.audience) {
      return left.audience === "public" ? -1 : 1;
    }
    const leftExact = requested.length > 0 && left.locale.tag === requested ? 0 : 1;
    const rightExact = requested.length > 0 && right.locale.tag === requested ? 0 : 1;
    if (leftExact !== rightExact) {
      return leftExact - rightExact;
    }
    const byPublication = compareCodeUnits(right.publishedAt, left.publishedAt);
    if (byPublication !== 0) {
      return byPublication;
    }
    const byDocument = compareCodeUnits(left.documentId, right.documentId);
    return byDocument === 0 ? compareCodeUnits(left.locale.tag, right.locale.tag) : byDocument;
  });
  const { window, offset, limit } = pageWindowOf(editions.length, query);
  const data: ReceivingListView = {
    editions: sliceOf(editions, offset, limit),
    languagePreference: preference,
    page: window,
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "published-releases", reference: "updates" },
      revision: collectionRevision(editions.map((edition) => `${edition.releaseId}@${edition.reach}`)),
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        "page.total": countState(window.total),
        "page.pageCount": countState(window.pageCount),
        languagePreference: textState(preference),
      },
      actions: [
        {
          name: "readEdition",
          available: editions.length > 0,
          ...(editions.length > 0
            ? {}
            : {
                reason: "No edition is available to this reader at this instant; an edition published later appears here without changing this reader's entitlements.",
              }),
        },
      ],
    }),
  };
}
/** The query the exact-post view accepts. */
export interface ReceivingPostQuery {
  readonly updateId: string;
  readonly locale?: string;
}
/** One Update at its exact post, re-authorised on every open. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReceivingPost(query: ReceivingPostQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReceivingPostView>>> {
  const worlds = await resolveWorlds("readReceivingPost", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, own, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const document = published.state.contentDocuments.find((candidate) => candidate.documentId === query.updateId && candidate.family === "update");
  if (document === undefined) {
    // A refused document and a document that does not exist answer alike, because a distinguishable
    // refusal would let a caller enumerate what it may not read.
    return deniedRead("no-permission");
  }
  const grantHeld = grantHeldFor(session, scope, own, published);
  const editions = editionsOf(document.documentId, published.state).filter((edition) => releaseStillServes(edition.domain));
  const preference = languagePreferenceOf(session, own, published);
  const requestedLocale = requestedLocaleOf(query.locale, preference, editions);
  const resolution = resolveEditionFor({ document, editions, requestedLocale, grantHeld });
  if (resolution.status === "protected-not-permitted") {
    // The only edition serving this request is protected and this reader holds no grant for it. A copy
    // already received grants nothing here: the grant is decided now, from the reader's own rows.
    return deniedRead("no-protected-grant");
  }
  if (resolution.status === "unavailable") {
    const unavailableData: ReceivingPostView = {
      state: "language-unavailable",
      documentId: document.documentId,
      variantId: null,
      releaseId: null,
      audience: null,
      requestedLocale,
      servedLocale: null,
      fallbackOccurred: false,
      publishedAt: null,
      title: null,
      html: null,
      renditions: [],
      simulated: [SIMULATED_PUBLICATION_REACH],
    };
    return {
      kind: "envelope",
      envelope: buildEnvelope({
        data: unavailableData,
        scope,
        source: { system: "published-releases", reference: document.documentId },
        revision: collectionRevision(editions.map((edition) => edition.record.releaseId)),
        asOf: at.toString(),
        coverage: { from: null, to: at.toString(), state: "complete" },
        valueStates: { requestedLocale: textState(requestedLocale) },
        actions: [],
      }),
    };
  }
  const served = resolution;
  const rendered = renderingOf(served.edition.revision, published.state.mediaAssets);
  if (!rendered.ok) {
    // The edition exists and this build cannot produce it: that is an outage of the renderer, not an
    // empty page and not a reason to serve a partial document.
    return sourceUnavailableRead("readReceivingPost", "unrenderable-edition", "content-render");
  }
  const data: ReceivingPostView = {
    state: "rendered",
    documentId: document.documentId,
    variantId: served.edition.record.variantId,
    releaseId: served.edition.record.releaseId,
    audience: served.edition.record.audience,
    requestedLocale,
    servedLocale: served.locale,
    fallbackOccurred: served.fallbackOccurred,
    publishedAt: served.edition.record.publishedAt,
    title: served.edition.revision.sharePresentation.title,
    html: rendered.html,
    renditions: rendered.media.references,
    simulated: [SIMULATED_PUBLICATION_REACH],
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "published-releases", reference: document.documentId },
      revision: served.edition.record.revision,
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        title: textState(data.title),
        "servedLocale.tag": textState(served.locale.tag),
        publishedAt: textState(data.publishedAt),
        renditions: countState(data.renditions.length),
      },
      actions: [
        {
          name: "followLink",
          available: true,
        },
      ],
    }),
  };
}
/** The query the page discovery index accepts. */
export interface DiscoveryIndexQuery {
  readonly page?: number;
  readonly pageSize?: number;
}
/** The discovery index: the page editions that reach a public listing, and nothing else. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readDiscoveryIndex(query: DiscoveryIndexQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<DiscoveryIndexView>>> {
  const worlds = await resolveWorlds("readDiscoveryIndex", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const entries: DiscoveryEntry[] = [];
  for (const record of published.state.releases) {
    if (record.audience !== "public") {
      continue;
    }
    const resolved = resolveRelease(record, published.state);
    if (resolved.document === undefined || resolved.revision === undefined || resolved.domain === undefined || resolved.document.family === "update") {
      continue;
    }
    if (!isListedPublicly({ reach: record.reach, withdrawnAt: record.withdrawnAt })) {
      continue;
    }
    const metadata = reachMetadata({ reach: record.reach, withdrawnAt: record.withdrawnAt });
    entries.push({
      documentId: resolved.document.documentId,
      locale: resolved.domain.locale,
      title: resolved.revision.sharePresentation.title,
      href: pageHref(resolved.document.documentId, resolved.domain.locale.tag),
      noindex: metadata.robots === "noindex",
    });
  }
  entries.sort((left, right) => {
    const byTitle = compareCodeUnits(left.title, right.title);
    return byTitle === 0 ? compareCodeUnits(left.href, right.href) : byTitle;
  });
  const { window, offset, limit } = pageWindowOf(entries.length, query);
  const data: DiscoveryIndexView = { entries: sliceOf(entries, offset, limit), page: window };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "published-releases", reference: "listed-pages" },
      revision: collectionRevision(entries.map((entry) => `${entry.href}@${entry.title}`)),
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        "page.total": countState(window.total),
        "page.pageCount": countState(window.pageCount),
      },
      actions: [
        {
          name: "readEdition",
          available: entries.length > 0,
          ...(entries.length > 0 ? {} : { reason: "No page edition is listed publicly at this instant." }),
        },
      ],
    }),
  };
}
/** The query the public reading view accepts. */
export interface ReceivingPageQuery {
  readonly pageId: string;
  readonly locale?: string;
}
/** One page edition served by direct link, re-authorised on every request. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReceivingPage(query: ReceivingPageQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReceivingPageView>>> {
  const worlds = await resolveWorlds("readReceivingPage", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, own, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const document = published.state.contentDocuments.find((candidate) => candidate.documentId === query.pageId && candidate.family !== "update");
  if (document === undefined) {
    return deniedRead("no-permission");
  }
  const grantHeld = grantHeldFor(session, scope, own, published);
  const editions = editionsOf(document.documentId, published.state);
  const live = editions.filter((edition) => releaseStillServes(edition.domain));
  const preference = languagePreferenceOf(session, own, published);
  const requestedLocale = requestedLocaleOf(query.locale, preference, editions);
  const resolution = resolveEditionFor({ document, editions: live, requestedLocale, grantHeld });
  if (resolution.status === "protected-not-permitted") {
    return deniedRead("no-protected-grant");
  }
  if (resolution.status === "unavailable") {
    const withdrawn = editions.filter((edition) => edition.domain.withdrawnAt !== undefined);
    if (withdrawn.length > 0) {
      const first = withdrawn[0];
      if (first !== undefined) {
        const containment = withdrawEdition(first.domain, { at });
        const tombstoneData: ReceivingPageView = {
          state: "withdrawn",
          documentId: null,
          family: null,
          releaseId: null,
          requestedLocale,
          servedLocale: null,
          fallbackOccurred: false,
          reach: null,
          metadata: { listed: false, indexable: false, robots: "noindex" },
          title: null,
          description: null,
          html: null,
          renditions: [],
          giving: null,
          tombstone: containment.tombstone,
          simulated: [],
        };
        return {
          kind: "envelope",
          envelope: buildEnvelope({
            data: tombstoneData,
            scope,
            source: { system: "published-releases", reference: "withdrawn-edition" },
            revision: collectionRevision(withdrawn.map((edition) => edition.record.releaseId)),
            asOf: at.toString(),
            coverage: { from: null, to: at.toString(), state: "complete" },
            valueStates: { requestedLocale: textState(requestedLocale) },
            actions: [],
          }),
        };
      }
    }
    const unavailableData: ReceivingPageView = {
      state: "language-unavailable",
      documentId: document.documentId,
      family: document.family,
      releaseId: null,
      requestedLocale,
      servedLocale: null,
      fallbackOccurred: false,
      reach: null,
      metadata: null,
      title: null,
      description: null,
      html: null,
      renditions: [],
      giving: null,
      tombstone: null,
      simulated: [SIMULATED_PUBLICATION_REACH],
    };
    return {
      kind: "envelope",
      envelope: buildEnvelope({
        data: unavailableData,
        scope,
        source: { system: "published-releases", reference: document.documentId },
        revision: collectionRevision(live.map((edition) => edition.record.releaseId)),
        asOf: at.toString(),
        coverage: { from: null, to: at.toString(), state: "complete" },
        valueStates: { requestedLocale: textState(requestedLocale) },
        actions: [],
      }),
    };
  }
  const served = resolution;
  const edition = served.edition;
  if (edition.record.reach === "not-public") {
    // Reach decides what a direct link may serve: an edition that reaches nobody is refused here, and the
    // refusal says nothing about what stands behind it.
    return deniedRead("no-permission");
  }
  const rendered = renderingOf(edition.revision, published.state.mediaAssets);
  if (!rendered.ok) {
    return sourceUnavailableRead("readReceivingPage", "unrenderable-edition", "content-render");
  }
  const giving: GivingPlacement =
    document.givingBinding === null
      ? { state: "giving-unavailable" }
      : {
          state: "available",
          designation: document.givingBinding.designation,
          label: document.givingBinding.label,
          simulated: SIMULATED_GIVING_DESTINATION,
        };
  const data: ReceivingPageView = {
    state: "served",
    documentId: document.documentId,
    family: document.family,
    releaseId: edition.record.releaseId,
    requestedLocale,
    servedLocale: served.locale,
    fallbackOccurred: served.fallbackOccurred,
    reach: edition.record.reach,
    metadata: reachMetadata({
      reach: edition.record.reach,
      withdrawnAt: edition.record.withdrawnAt,
    }),
    title: edition.revision.sharePresentation.title,
    description: edition.revision.sharePresentation.description,
    html: rendered.html,
    renditions: rendered.media.references,
    giving,
    tombstone: null,
    simulated: [SIMULATED_PUBLICATION_REACH, SIMULATED_GIVING_DESTINATION],
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "published-releases", reference: document.documentId },
      revision: edition.record.revision,
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        title: textState(data.title),
        "servedLocale.tag": textState(served.locale.tag),
        renditions: countState(data.renditions.length),
        "giving.state": textState(giving.state),
      },
      // A public reading view offers no action: it is inert, and a Give placement is a labelled simulation
      // that starts no payment, so no checkout action can appear here.
      actions: [],
    }),
  };
}
function retryReason(state: SendOutcomeState, withinUsefulness: boolean): string {
  if (state === "accepted") {
    return "The local stand-in for a provider already took this copy for this intent, so it is never submitted again under a new identity.";
  }
  if (state === "unknown") {
    return "The acknowledgement was lost, so whether the effect happened is not known. Re-query this same intent instead of submitting again.";
  }
  return withinUsefulness
    ? "The attempt failed and may be retried under the same intent while the usefulness window is open."
    : "The attempt failed, and its 24-hour usefulness window has closed, so it cannot be revived as a fresh attempt.";
}
/** The query the per-send result view accepts. */
export interface SendResultQuery {
  readonly intentId: string;
  readonly page?: number;
  readonly pageSize?: number;
}
/** The per-send results of one notification intent. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSendResult(query: SendResultQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<SendResultView>>> {
  const worlds = await resolveWorlds("readSendResult", source);
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }
  const at = scenarioInstant(session);
  const intent = published.state.notificationIntents.find((candidate) => candidate.intentId === query.intentId);
  if (intent === undefined) {
    return deniedRead("no-permission");
  }
  const results = published.state.notificationResults.filter((candidate) => candidate.intentId === intent.intentId);
  const admitted = admittedToWorld(session, published);
  const pairs = results.flatMap((result) => result.recipients.filter((copy) => admitted || copy.recipientId === session.principalId).map((copy) => ({ result, copy })));
  if (!admitted && pairs.length === 0) {
    return deniedRead("no-permission");
  }
  // One row per recipient and intent: a duplicated recorded row for the same person is one outcome, not a
  // second copy.
  const byRecipient = new Map<string, { readonly result: NotificationSendResultRecord; readonly copy: (typeof pairs)[number]["copy"] }>();
  for (const pair of pairs) {
    if (!byRecipient.has(pair.copy.recipientId)) {
      byRecipient.set(pair.copy.recipientId, pair);
    }
  }
  const ordered = [...byRecipient.values()].sort((left, right) => compareCodeUnits(left.copy.recipientId, right.copy.recipientId));
  // One entry per eligible recipient this intent did not serve, published as the send result recorded it
  // and visible under the same rule as the rows: a reader admitted to the intent sees every recipient, and
  // anyone else sees only their own accounting. An entry is listed in full rather than paged, because the
  // intent's ceiling bounds it.
  const unservedByRecipient = new Map<string, NotificationUnservedRecipientRecord>();
  for (const entry of results.flatMap((result) => result.unserved)) {
    if (!admitted && entry.recipientId !== session.principalId) {
      continue;
    }
    if (byRecipient.has(entry.recipientId) || unservedByRecipient.has(entry.recipientId)) {
      continue;
    }
    unservedByRecipient.set(entry.recipientId, entry);
  }
  const unserved = [...unservedByRecipient.values()].sort((left, right) => compareCodeUnits(left.recipientId, right.recipientId));
  const intendedAt = instantOf(intent.intendedAt);
  if (intendedAt === undefined) {
    return sourceUnavailableRead("readSendResult", "unreadable-intent-instant");
  }
  const usefulness = notificationDeadline({ intendedAt, now: at });
  const withinUsefulness = usefulness.status === "within-usefulness";
  const counts = zeroSendStates();
  const rows: SendResultRow[] = [];
  for (const pair of ordered) {
    counts[pair.copy.state] += 1;
    rows.push({
      recipientId: pair.copy.recipientId,
      renditionId: pair.copy.renditionId,
      state: pair.copy.state,
      recordedAt: pair.copy.at,
      dedupeKey: dedupeKey({
        publisherId: intent.publisherId,
        purpose: intent.purpose,
        recipientId: pair.copy.recipientId,
        intentId: intent.intentId,
      }),
      retry: {
        available: mayRepeatIntent(pair.copy.state) && withinUsefulness,
        reason: retryReason(pair.copy.state, withinUsefulness),
      },
      recovery: { intentId: intent.intentId },
    });
  }
  const recordedAt = results.map((result) => result.recordedAt).sort((left, right) => compareCodeUnits(right, left))[0] ?? null;
  const { window, offset, limit } = pageWindowOf(rows.length, query);
  const data: SendResultView = {
    intentId: intent.intentId,
    releaseId: intent.releaseId,
    publisherId: intent.publisherId,
    purpose: intent.purpose,
    intendedAt: intent.intendedAt,
    recordedAt,
    ceilingCount: intent.ceilingCount,
    counts,
    rows: sliceOf(rows, offset, limit),
    unserved,
    usefulness:
      usefulness.status === "within-usefulness"
        ? {
            state: "within-usefulness",
            deadline: usefulness.deadlineInstant.toString(),
            remainingMilliseconds: usefulness.remainingMilliseconds,
          }
        : {
            state: "past-usefulness",
            deadline: usefulness.deadlineInstant.toString(),
            remainingMilliseconds: null,
          },
    page: window,
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "notification-results", reference: intent.intentId },
      revision: collectionRevision([...rows.map((row) => `${row.recipientId}@${row.state}@${row.renditionId}`), ...unserved.map((entry) => `${entry.recipientId}@${entry.reason}`)]),
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        ceilingCount: countState(intent.ceilingCount),
        "counts.accepted": countState(counts.accepted),
        "counts.failed": countState(counts.failed),
        "counts.unknown": countState(counts.unknown),
        unserved: countState(unserved.length),
        "page.total": countState(window.total),
        "page.pageCount": countState(window.pageCount),
        "usefulness.remainingMilliseconds": data.usefulness.remainingMilliseconds === null ? "unknown" : countState(data.usefulness.remainingMilliseconds),
      },
      actions: [
        {
          name: "retryRecipient",
          available: rows.some((row) => row.retry.available),
          ...(rows.some((row) => row.retry.available)
            ? {}
            : {
                reason:
                  "No recorded row may be submitted again: acceptance is never repeated, an uncertain outcome is recovered by re-querying the same intent, and a failure outside its usefulness window cannot be revived.",
              }),
        },
        {
          name: "recoverByIntent",
          available: rows.length > 0,
          ...(rows.length > 0 ? {} : { reason: "This intent has recorded no recipient outcome yet." }),
        },
      ],
    }),
  };
}
