import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isDevelopment } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { compareCodeUnits } from "@/lib/ordering";
import { MEMBER_CHOICES, UPDATE_EMAIL_PURPOSE, type MembershipRecord as DomainMembership, type MembershipState as DomainMembershipState, type AudiencePurpose, type MemberChoice } from "@/modules/audience/membership";
import { dedupeKey, mayRepeatIntent, type SendOutcomeState } from "@/modules/audience/consent";
import { EXCLUSION_REASONS, membershipAccessAt, type ContentAudience, type ExclusionReason } from "@/modules/audience/resolve";
import { directionOfTag, resolveLocale, type ContentLocale } from "@/modules/content/locale";
import { buildNotice, type Notice, type PinnedRendition as NoticePinnedRendition } from "@/modules/content/notice";
import { isDirectlyReadable, isListedPublicly, reachMetadata, withdrawEdition, type ReachMetadata, type Tombstone } from "@/modules/content/reach";
import { renderToHtml, type RenderMediaPlacement, type RenderRendition, type RenderRenditions } from "@/modules/content/render";
import type { Release } from "@/modules/content/variant";
import { scenarioMediaServing } from "@/modules/dev-runtime/scenario";
import { readSession } from "@/modules/store/repository";
import { clampPageSize } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { confirmationDeadline, notificationDeadline } from "@/modules/time/window";
import { assertScope, canReadProtected, readResultOfRefusal, recordRefusalOutage, resolveSession, sessionStateRefusal, type ResolvedSession, type SessionSource } from "../authorize";
import {
  buildEnvelope,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  mediaAssetRecordSchema,
  membershipRecordSchema,
  ministryIdSchema,
  notificationIntentRecordSchema,
  notificationSendResultRecordSchema,
  organizationIdSchema,
  releaseRecordSchema,
  supportSubjectIdSchema,
  type MembershipRecord as StoredMembership,
  StoredContentRevisionRecord,
  type ContentDocumentRecord,
  type ContentFamily,
  type ContentVariantRecord,
  type MediaAssetRecord,
  type NotificationSendResultRecord,
  type NotificationUnservedRecipientRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type ReleaseReach,
  type ReleaseRecord,
  type Scope,
} from "../envelope";
import type { ReadResult } from "../outcome";
import { storedContentRevisionRecordSchema } from "../envelope";
import { answerOf, countState, deniedRead, hashedRevision, instantOf, readAction, sourceUnavailableRead, storeUnavailableRead } from "./frame";
import { contentDocumentOf, membershipOf } from "../projection";
const PREVIEW_PUBLISHER_SESSION_ID = "established-worker";
const STORE_READ_GUIDANCE = "The local synthetic store could not be read for this request. Retry the same request; if it keeps failing, reset the development data from Settings and reopen the session.";
const FIRST_PAGE = 1;
const NOTICE_SENDER = Object.freeze({ name: "Update notices", address: "update-notice@example.invalid" });
const UNNAMED_PUBLISHER = "";
const SIMULATED_MAIL_SUBMISSION = "mail-submission";
const SIMULATED_PUBLICATION_REACH = "publication-reach";
const SIMULATED_GIVING_DESTINATION = "giving-destination";
const updateHref = (documentId: string): string => `/preview/${encodeURIComponent(documentId)}`;
const pageHref = (documentId: string, localeTag: string): string => `/preview/pages/${encodeURIComponent(documentId)}/${encodeURIComponent(localeTag)}`;
const renditionPath = (assetId: string, renditionId: string): string => `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(renditionId)}`;
export type PageWindow = { readonly page: number; readonly pageSize: number; readonly total: number; readonly pageCount: number };
export interface AudienceMember {
  readonly membershipId: string;
  readonly recipientId: string;
  readonly displayName: string | null;
  readonly state: DomainMembershipState;
  readonly choice: MemberChoice;
  readonly languagePreference: string;
  readonly acceptedOn: string | null;
  readonly eligible: boolean;
  readonly exclusionReason: ExclusionReason | null;
}
export type AudienceView = { readonly publisherId: string | null; readonly purpose: AudiencePurpose; readonly choiceOptions: readonly MemberChoice[] } & { readonly counts: { readonly eligible: number; readonly excluded: number; readonly total: number } } & {
  readonly memberStates: Readonly<Record<DomainMembershipState, number>>;
  readonly excludedByReason: Readonly<Record<ExclusionReason, number>>;
} & { readonly sourceSuppliedRows: number; readonly members: readonly AudienceMember[]; readonly page: PageWindow };
export type PinnedCopy = { readonly intentId: string; readonly sendResultId: string; readonly releaseId: string; readonly renditionId: string; readonly state: SendOutcomeState; readonly recordedAt: string };
export type ConfirmationWindowView = { readonly state: "not-awaiting-proof" | "open" | "expired"; readonly deadline: string | null; readonly remainingMilliseconds: number | null };
/** One language this publisher releases its Updates in, as the reader's own language choice offers it: the tag a save records, that language's name in itself, and the direction it is read in. */
export type OfferedLanguage = ContentLocale & { readonly label: string };
// The reader's own preference record for one publisher and one purpose: `publisherId` is the membership's own publisher when the session holds one and otherwise the one publisher the Update-email records this read was answered from name, and it stays null when those records name none or several.
export type PreferencesView = { readonly state: "none" | DomainMembershipState; readonly membershipId: string | null; readonly publisherId: string | null } & { readonly purpose: AudiencePurpose; readonly choice: MemberChoice | null; readonly choiceOptions: readonly MemberChoice[] } & {
  readonly languagePreference: string | null;
  /** The languages this publisher currently offers this reader, and never one whose every edition this reader may not open. */ readonly languageOptions: readonly OfferedLanguage[];
  readonly email: string | null;
  readonly acceptedOn: string | null;
} & { readonly confirmation: ConfirmationWindowView; readonly pending: { readonly claimsMailSent: false; readonly nextStep: string } | null } & { readonly readingGrant: { readonly granted: boolean; readonly audience: ContentAudience } } & {
  readonly unsubscribeScope: { readonly publisherId: string; readonly purpose: AudiencePurpose } | null;
} & { readonly pinnedCopies: readonly PinnedCopy[] };
export type InboxReading = { readonly state: "link-only"; readonly href: string } | { readonly state: "rendered"; readonly href: string; readonly title: string | null; readonly html: string } | { readonly state: "unavailable"; readonly href: string; readonly reason: string };
export type InboxMessage = { readonly messageId: string; readonly intentId: string; readonly releaseId: string; readonly variantId: string | null } & { readonly renditionId: string; readonly state: SendOutcomeState; readonly audience: ContentAudience | null } & {
  readonly locale: ContentLocale | null;
  readonly intendedAt: string;
  readonly recordedAt: string;
  readonly subject: string;
} & { readonly sender: string; readonly link: string; readonly protectedNotice: boolean; readonly html: string; readonly plainText: string } & { readonly reading: InboxReading; readonly simulated: readonly string[] };
export type InboxView = { readonly messages: readonly InboxMessage[]; readonly intentCount: number; readonly sendStates: Readonly<Record<SendOutcomeState, number>>; readonly unresolvedIntents: number; readonly page: PageWindow };
export type ReceivingEdition = { readonly documentId: string; readonly variantId: string; readonly releaseId: string; readonly audience: ContentAudience } & { readonly locale: ContentLocale; readonly publishedAt: string; readonly reach: ReleaseReach; readonly title: string | null } & {
  readonly description: string | null;
  readonly href: string;
};
export type ReceivingListView = { readonly editions: readonly ReceivingEdition[]; readonly languagePreference: string | null; readonly page: PageWindow };
// One rendition of one asset as a reading surface receives it. `state` is the media source's own answer for this session's scenario, so a surface states an unreadable rendition as unavailable rather than linking to bytes the serving route refuses.
export type MediaReference = { readonly assetId: string; readonly renditionId: string; readonly purpose: string; readonly path: string; readonly state: "served" | "unavailable" };
export type GivingPlacement = { readonly state: "available"; readonly designation: SourceReference; readonly label: string; readonly simulated: string } | { readonly state: "giving-unavailable" };
export type ReceivingPostView = { readonly state: "rendered" | "language-unavailable"; readonly documentId: string; readonly variantId: string | null } & { readonly releaseId: string | null; readonly audience: ContentAudience | null; readonly requestedLocale: string } & {
  readonly servedLocale: ContentLocale | null;
  readonly fallbackOccurred: boolean;
  readonly publishedAt: string | null;
} & { readonly title: string | null; readonly html: string | null; readonly renditions: readonly MediaReference[] } & { readonly simulated: readonly string[] };
export type DiscoveryEntry = { readonly documentId: string; readonly locale: ContentLocale; readonly title: string; readonly href: string; readonly noindex: boolean };
export type DiscoveryIndexView = { readonly entries: readonly DiscoveryEntry[]; readonly page: PageWindow };
export type ReceivingPageView = { readonly state: "served" | "withdrawn" | "language-unavailable"; readonly documentId: string | null; readonly family: ContentFamily | null } & { readonly releaseId: string | null; readonly requestedLocale: string; readonly servedLocale: ContentLocale | null } & {
  readonly fallbackOccurred: boolean;
  readonly reach: ReleaseReach | null;
  readonly metadata: ReachMetadata | null;
} & { readonly title: string | null; readonly description: string | null; readonly html: string | null } & { readonly renditions: readonly MediaReference[]; readonly giving: GivingPlacement | null; readonly tombstone: Tombstone | null } & { readonly simulated: readonly string[] };
export type SendResultRow = { readonly recipientId: string; readonly renditionId: string; readonly state: SendOutcomeState; readonly recordedAt: string; readonly dedupeKey: string; readonly retry: { readonly available: boolean; readonly reason: string }; readonly recovery: { readonly intentId: string } };
/** The per-send results of one notification intent: `documentId` and `variantId` are the publication and the edition the intent was recorded for, so a surface repeating a definite failure states the edition it repeats, and `notice` is the message the intent submitted. */
export type SendResultView = { readonly intentId: string; readonly releaseId: string; readonly publisherId: string; readonly purpose: AudiencePurpose } & { readonly documentId: string; readonly variantId: string } & { readonly intendedAt: string; readonly recordedAt: string | null; readonly ceilingCount: number } & {
  readonly counts: Readonly<Record<SendOutcomeState, number>>;
  readonly rows: readonly SendResultRow[];
} & { readonly unserved: readonly NotificationUnservedRecipientRecord[] } & { readonly usefulness: { readonly state: "within-usefulness" | "past-usefulness"; readonly deadline: string; readonly remainingMilliseconds: number | null } } & { readonly notice: Notice | null } & { readonly page: PageWindow };
const storedContextSchema = z.object({ selectedOrganizationId: organizationIdSchema.nullable(), selectedMinistryId: ministryIdSchema.nullable(), selectedSupportSubjectId: supportSubjectIdSchema.nullable() });
const storedStateSchema = z.object({
  context: storedContextSchema,
  memberships: z.array(membershipRecordSchema),
  notificationIntents: z.array(notificationIntentRecordSchema),
  notificationResults: z.array(notificationSendResultRecordSchema),
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  contentRevisions: z.array(storedContentRevisionRecordSchema),
  releases: z.array(releaseRecordSchema),
  mediaAssets: z.array(mediaAssetRecordSchema),
});
type StoredState = z.infer<typeof storedStateSchema>;
type StoredRevision = StoredContentRevisionRecord;
export type World = { readonly sessionId: string; readonly state: StoredState };
type WorldResolution = { readonly ok: true; readonly session: ResolvedSession; readonly own: World; readonly published: World } | { readonly ok: false; readonly result: ReadResult<never> };
async function loadWorld(sessionId: string): Promise<{ readonly ok: true; readonly world: World } | { readonly ok: false; readonly reference: string }> {
  let documents;
  try {
    documents = await readSession(sessionId);
  } catch (error) {
    const name: unknown = error instanceof Error ? error.name : undefined;
    return { ok: false, reference: typeof name === "string" && name.length > 0 ? name : "unreadable-session" };
  }
  if (documents === undefined) return { ok: false, reference: "session-not-in-store" };
  const parsed = storedStateSchema.safeParse(documents.state);
  return !parsed.success ? { ok: false, reference: "unreadable-state-document" } : { ok: true, world: { sessionId, state: parsed.data } };
}
/** Resolves the session this read acts for and the two worlds it may answer from — the caller's own, and the published world the reader crossing reaches — or the read's own refusal. */
export async function resolveWorlds(job: string, source?: SessionSource): Promise<WorldResolution> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    recordRefusalOutage(job, resolved.refusal);
    return { ok: false, result: readResultOfRefusal(resolved.refusal) };
  }
  const { session } = resolved;
  const own = await loadWorld(session.sessionId);
  if (!own.ok) return { ok: false, result: storeUnavailableRead(job, own.reference, STORE_READ_GUIDANCE) };
  if (!(isDevelopment() && session.admittedMemberships.length === 0 && session.sessionId !== PREVIEW_PUBLISHER_SESSION_ID)) return { ok: true, session, own: own.world, published: own.world };
  const publisher = await loadWorld(PREVIEW_PUBLISHER_SESSION_ID);
  return !publisher.ok ? { ok: false, result: storeUnavailableRead(job, publisher.reference, STORE_READ_GUIDANCE) } : { ok: true, session, own: own.world, published: publisher.world };
}
/** The scope a read states in one world: the context the caller selected, the context the world holds, or nothing when neither names one. */ export function scopeOf(session: ResolvedSession, world: World): Scope | undefined {
  if (session.selected !== null) return session.selected;
  const { context } = world.state;
  if (context.selectedOrganizationId === null || context.selectedMinistryId === null || context.selectedSupportSubjectId === null) return undefined;
  return { organizationId: context.selectedOrganizationId, ministryId: context.selectedMinistryId, supportSubjectId: context.selectedSupportSubjectId, principalId: session.principalId };
}
function admittedToWorld(session: ResolvedSession, world: World): boolean {
  const scope = scopeOf(session, world);
  return scope !== undefined && assertScope(session, scope).ok;
}
const localeOfRelease = (record: ReleaseRecord, variant: ContentVariantRecord | undefined): ContentLocale => ({ tag: record.locale, direction: variant?.direction ?? directionOfTag(record.locale) });
function domainReleaseOf(record: ReleaseRecord, variant: ContentVariantRecord | undefined, revision: StoredRevision | undefined): Release | undefined {
  const publishedAt = instantOf(record.publishedAt);
  if (publishedAt === undefined || revision === undefined) return undefined;
  const withdrawnAt = instantOf(record.withdrawnAt);
  const { releaseId, variantId, revisionId, audience, reach } = record;
  return { releaseId, variantId, revisionId, audience, locale: localeOfRelease(record, variant), publishedAt, reach, contentChecksum: revision.contentChecksum, ...(withdrawnAt === undefined ? {} : { withdrawnAt }), ...(record.supersededBy === null ? {} : { supersededBy: record.supersededBy }) };
}
type PageQuery = { readonly page?: number; readonly pageSize?: number };
function pageNumberOf(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return FIRST_PAGE;
  const whole = Math.trunc(requested);
  return whole < FIRST_PAGE ? FIRST_PAGE : whole;
}
function pageWindowOf(total: number, query: PageQuery): { readonly window: PageWindow; readonly offset: number; readonly limit: number } {
  const pageSize = clampPageSize(query.pageSize);
  const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = pageNumberOf(query.page);
  return { window: { page, pageSize, total, pageCount }, offset: (page - FIRST_PAGE) * pageSize, limit: pageSize };
}
const sliceOf = <T>(items: readonly T[], offset: number, limit: number): readonly T[] => items.slice(offset, offset + limit);
const textState = (value: string | null | undefined): RecordedValueState => (value === null || value === undefined || value.length === 0 ? "unknown" : "value");
const collectionRevision = (parts: readonly string[]): string => hashedRevision("col", [...parts].sort());
type OpenedRead = { readonly ok: true; readonly session: ResolvedSession; readonly own: World; readonly published: World; readonly scope: Scope; readonly at: Temporal.Instant } | { readonly ok: false; readonly result: ReadResult<never> };
/** Opens the worlds one read answers from and resolves the scope and instant it states, or answers the read's own refusal. The session's own state is decided first, before any scope is consulted: a session that is denied, without access, expired or unavailable is refused here by every read that opens through this one, so no read states a scope, a count or an edition to a session its own state has ended. */
async function openRead(job: string, source: SessionSource | undefined, requireAdmitted = false): Promise<OpenedRead> {
  const worlds = await resolveWorlds(job, source);
  if (!worlds.ok) return worlds;
  const stateRefusal = sessionStateRefusal(worlds.session);
  if (stateRefusal !== undefined) return { ok: false, result: { kind: "denied", denied: stateRefusal } };
  const scope = scopeOf(worlds.session, worlds.published);
  return scope === undefined || (requireAdmitted && !admittedToWorld(worlds.session, worlds.published)) ? { ok: false, result: deniedRead("no-membership") } : { ok: true, session: worlds.session, own: worlds.own, published: worlds.published, scope, at: scenarioInstant(worlds.session) };
}
type EnvelopeFields<T> = { readonly source: Parameters<typeof buildEnvelope>[0]["source"]; readonly revision: string; readonly data: T; readonly valueStates: Readonly<Record<string, RecordedValueState>>; readonly actions: readonly ReadAction[]; readonly to?: string | null };
/** The result a read answers with, assembled through this file's own envelope builder. */ function respond<T>(scope: Scope, at: Temporal.Instant, fields: EnvelopeFields<T>): ReadResult<ReadEnvelope<T>> {
  return answerOf(scope, at.toString(), { data: fields.data, source: fields.source, revision: fields.revision, coverage: { from: null, to: fields.to === undefined ? at.toString() : fields.to, state: "complete" }, valueStates: fields.valueStates, actions: fields.actions });
}
/** The state a rendition count is stated in: a source that is down states `unavailable`, because an unreadable rendition set is never a number. */
const renditionCountState = (serving: "served" | "unavailable", count: number): RecordedValueState => (serving === "served" ? countState(count) : "unavailable");
type RenderingMedia = { readonly placements: readonly RenderMediaPlacement[]; readonly renditions: RenderRenditions; readonly references: readonly MediaReference[] };
/** One revision's media as a rendering surface receives it. While the scenario's media source is down no rendition address reaches the renderer, so the single renderer states each placement's own text alternative and caption in the place of a player it cannot make loadable, and every rendition is still named to the surface with `state: "unavailable"` so the surface can say so and offer a retry. */
function renderingMediaOf(revision: StoredRevision, assets: readonly MediaAssetRecord[], serving: "served" | "unavailable"): RenderingMedia {
  const byId = new Map(assets.map((asset) => [asset.assetId, asset] as const));
  const placementList: RenderMediaPlacement[] = [];
  const renditions: Record<string, RenderRendition> = {};
  const references: MediaReference[] = [];
  const readable = serving === "served";
  for (const placement of [...revision.mediaPlacements].sort((left, right) => left.position - right.position)) {
    const asset = byId.get(placement.assetId);
    if (asset === undefined) {
      placementList.push({ placementId: placement.placementId, kind: "image", altText: placement.altText, ...(placement.caption === null ? {} : { caption: placement.caption }), ...(placement.sectionElement === null ? {} : { sectionElement: placement.sectionElement }) });
      continue;
    }
    const main = asset.renditions.find((rendition) => (asset.kind === "video" ? rendition.purpose === "playback" : rendition.purpose === "display"));
    const poster = asset.renditions.find((rendition) => rendition.purpose === "poster");
    const transcript = asset.renditions.find((rendition) => rendition.purpose === "transcript");
    const captions = revision.captions.find((track) => track.assetId === placement.assetId);
    const captionRendition = captions === undefined ? undefined : asset.renditions.find((rendition) => rendition.renditionId === captions.renditionId);
    if (main !== undefined) {
      const path = renditionPath(asset.assetId, main.renditionId);
      if (readable) renditions[placement.placementId] = { src: path, purpose: main.purpose === "playback" ? "playback" : "display" };
      references.push({ assetId: asset.assetId, renditionId: main.renditionId, purpose: main.purpose, path, state: serving });
    }
    if (poster !== undefined) {
      const path = renditionPath(asset.assetId, poster.renditionId);
      if (readable) renditions[`${placement.placementId}:poster`] = { src: path, purpose: "poster" };
      references.push({ assetId: asset.assetId, renditionId: poster.renditionId, purpose: poster.purpose, path, state: serving });
    }
    if (captionRendition !== undefined && captions !== undefined) {
      const path = renditionPath(asset.assetId, captionRendition.renditionId);
      if (readable) renditions[`${placement.placementId}:captions`] = { src: path, purpose: "captions" };
      references.push({ assetId: asset.assetId, renditionId: captionRendition.renditionId, purpose: captionRendition.purpose, path, state: serving });
    }
    // The transcript is the video's own admitted rendition, keyed like the poster and the caption track and supplied to the renderer under a key of its own, so the reading alternative points at the address this read authorised.
    if (transcript !== undefined) {
      const transcriptKey = `${placement.placementId}:transcript`;
      const path = renditionPath(asset.assetId, transcript.renditionId);
      if (readable) renditions[transcriptKey] = { src: path, purpose: "transcript" };
      references.push({ assetId: asset.assetId, renditionId: transcript.renditionId, purpose: transcript.purpose, path, state: serving });
    }
    placementList.push({
      placementId: placement.placementId,
      kind: asset.kind,
      altText: placement.altText,
      ...(placement.caption === null ? {} : { caption: placement.caption }),
      ...(placement.sectionElement === null ? {} : { sectionElement: placement.sectionElement }),
      ...(poster === undefined ? {} : { posterId: `${placement.placementId}:poster` }),
      ...(captions === undefined ? {} : { captionsId: `${placement.placementId}:captions`, captionsLanguage: captions.language, captionsLabel: captions.label }),
      ...(transcript === undefined ? {} : { transcriptId: `${placement.placementId}:transcript` }),
    });
  }
  return { placements: placementList, renditions, references };
}
type RevisionRendering = { readonly ok: true; readonly html: string; readonly media: RenderingMedia } | { readonly ok: false; readonly reason: string };
function renderingOf(revision: StoredRevision, assets: readonly MediaAssetRecord[], serving: "served" | "unavailable"): RevisionRendering {
  const media = renderingMediaOf(revision, assets, serving);
  const rendered = renderToHtml(revision.body, { placements: media.placements, renditions: media.renditions });
  return rendered.status === "invalid" ? { ok: false, reason: "The edition's content does not satisfy the content profile this build renders." } : { ok: true, html: rendered.html, media };
}
type ResolvedRelease = { readonly record: ReleaseRecord; readonly variant: ContentVariantRecord | undefined; readonly revision: StoredRevision | undefined; readonly document: ContentDocumentRecord | undefined; readonly domain: Release | undefined };
/** Resolves one stored release against the state it lives in: its variant, revision, document and domain release. */ export function resolveRelease(record: ReleaseRecord, state: StoredState): ResolvedRelease {
  const variant = state.contentVariants.find((candidate) => candidate.variantId === record.variantId);
  const revision = state.contentRevisions.find((candidate) => candidate.revisionId === record.revisionId);
  const document = variant === undefined ? undefined : state.contentDocuments.find((candidate) => candidate.documentId === variant.documentId);
  return { record, variant, revision, document, domain: domainReleaseOf(record, variant, revision) };
}
/** Reports whether a release still serves its readers: a release that has been withdrawn or superseded serves nobody. */
export const releaseStillServes = (release: Release): boolean => release.withdrawnAt === undefined && release.supersededBy === undefined;
const zeroMemberStates = (): Record<DomainMembershipState, number> => ({ active: 0, "awaiting-proof": 0, off: 0, restricted: 0 });
function zeroExclusionCounts(): Record<ExclusionReason, number> {
  const counts = {} as Record<ExclusionReason, number>;
  for (const reason of EXCLUSION_REASONS) counts[reason] = 0;
  return counts;
}
const zeroSendStates = (): Record<SendOutcomeState, number> => ({ accepted: 0, failed: 0, unknown: 0 });
const scenarioInstant = (session: ResolvedSession): Temporal.Instant => instantAt(session.clockOffsetMs);
function singlePublisherOf(rows: readonly StoredMembership[]): string | undefined {
  const publishers = [...new Set(rows.map((row) => row.publisherId))].sort(compareCodeUnits);
  return publishers.length === 1 ? publishers[0] : undefined;
}
function readerOwnedMemberships(session: ResolvedSession, own: World, published: World): readonly StoredMembership[] {
  // The rows are the reader's own whatever the session holds: a seat carrying no admitted membership still reads only the memberships recorded for its own principal, never a row its world holds for somebody else.
  const fromOwn = own.state.memberships.filter((row) => row.membershipId === session.principalId);
  const byId = new Map<string, StoredMembership>();
  for (const row of [...fromOwn, ...published.state.memberships.filter((row) => row.membershipId === session.principalId)]) if (row.purpose === UPDATE_EMAIL_PURPOSE && !byId.has(row.membershipId)) byId.set(row.membershipId, row);
  return [...byId.values()].sort((left, right) => compareCodeUnits(left.membershipId, right.membershipId));
}
export type AudienceQuery = { readonly publisherId?: string; readonly page?: number; readonly pageSize?: number };
/** The publisher's audience for the one purpose this release keeps memberships for. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readAudience(query: AudienceQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<AudienceView>>> {
  const opened = await openRead("readAudience", source, true);
  if (!opened.ok) return opened.result;
  const { published, scope, at } = opened;
  const addressed = published.state.memberships.filter((row) => row.purpose === UPDATE_EMAIL_PURPOSE);
  const publisherId = query.publisherId ?? singlePublisherOf(addressed);
  const rows = publisherId === undefined ? [] : addressed.filter((row) => row.publisherId === publisherId);
  const members = rows
    .map((record) => {
      const domain = membershipOf(record, scope);
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
    if (member.domain.sourceDisposition !== undefined) sourceSuppliedRows += 1;
    const reason = member.access.reason;
    if (member.access.admitted) {
      eligible += 1;
    } else {
      excluded += 1;
      if (reason !== undefined) excludedByReason[reason] += 1;
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
  const data: AudienceView = { publisherId: publisherId ?? null, purpose: UPDATE_EMAIL_PURPOSE, choiceOptions: MEMBER_CHOICES, counts: { eligible, excluded, total: members.length }, memberStates, excludedByReason, sourceSuppliedRows, members: visible, page: window };
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
  for (const reason of EXCLUSION_REASONS) valueStates[`excludedByReason.${reason}`] = countState(excludedByReason[reason]);
  const actions = [
    { name: "setPreference", available: false, reason: "The Off and Immediate decision is the person's own: a worker may read this audience and may not change anyone's choice." },
    { name: "unsubscribe", available: false, reason: "An unsubscribe acts on one publisher and one purpose and only from the person whose membership it is." },
    { name: "signupForPurpose", available: false, reason: "Importing or editing a contact subscribes nobody: only the person's own deliberate signup creates a membership." },
  ];
  return respond(scope, at, { to: null, data, source: { system: "audience-memberships", reference: publisherId ?? "no-publisher" }, revision: collectionRevision(rows.map((row) => `${row.membershipId}@${row.revision}`)), valueStates, actions });
}
/** The reader's own preference record for the one purpose this release keeps memberships for. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPreferences(source?: SessionSource): Promise<ReadResult<ReadEnvelope<PreferencesView>>> {
  const opened = await openRead("readPreferences", source);
  if (!opened.ok) return opened.result;
  const { session, own, published, scope, at } = opened;
  const rows = readerOwnedMemberships(session, own, published);
  const domains = rows.map((row) => membershipOf(row, scope));
  const membership = rows[0];
  const domain = domains[0];
  const readingGrant = readingGrantOf(session, domains, session.principalId);
  // `readingGrant` is the same protected-reading grant `grantHeldFor` reports — decided once, from the reader's own rows — so the languages offered here are withheld on exactly the fact the receiving reads decide access by.
  const languageOptions = languageOptionsOf(published.state, readingGrant);
  const pinnedCopies: PinnedCopy[] = [];
  if (rows.length > 0) {
    // Built once, so this read is linear in the results it reports rather than in results × intents.
    const intentsById = new Map(published.state.notificationIntents.map((intent) => [intent.intentId, intent] as const));
    for (const result of published.state.notificationResults) {
      const intent = intentsById.get(result.intentId);
      if (intent === undefined) continue;
      for (const copy of result.recipients) {
        if (copy.recipientId !== session.principalId) continue;
        pinnedCopies.push({ intentId: intent.intentId, sendResultId: result.sendResultId, releaseId: intent.releaseId, renditionId: copy.renditionId, state: copy.state, recordedAt: copy.at });
      }
    }
  }
  pinnedCopies.sort((left, right) => compareCodeUnits(left.intentId, right.intentId));
  const confirmation = confirmationWindowOf(domain, at);
  // A session holding no membership names no publisher on its own record, so the one publisher the Update-email records name is stated instead: it is read out of those records rather than typed in here, and stays null whenever they name none or more than one.
  const publisherId = membership?.publisherId ?? singlePublisherOf(published.state.memberships.filter((row) => row.purpose === UPDATE_EMAIL_PURPOSE)) ?? null;
  const data: PreferencesView = {
    state: domain?.state ?? "none",
    membershipId: membership?.membershipId ?? null,
    publisherId,
    purpose: UPDATE_EMAIL_PURPOSE,
    choice: domain?.choice ?? null,
    choiceOptions: MEMBER_CHOICES,
    languagePreference: membership?.languagePreference ?? null,
    languageOptions,
    email: membership?.email ?? null,
    acceptedOn: membership?.acceptedAt ?? null,
    confirmation,
    pending: domain !== undefined && domain.state === "awaiting-proof" ? { claimsMailSent: false, nextStep: "confirm-from-the-rendered-message" } : null,
    readingGrant: { granted: readingGrant, audience: "approved-supporter" },
    // The scope an unsubscribe addresses is the membership's own publisher and purpose: a session that holds no membership has nothing to turn off, so it states none here even where the view names the publisher a request step would address.
    unsubscribeScope: membership === undefined ? null : { publisherId: membership.publisherId, purpose: UPDATE_EMAIL_PURPOSE },
    pinnedCopies,
  };
  const valueStates: Readonly<Record<string, RecordedValueState>> = {
    "confirmation.deadline": textState(data.confirmation.deadline),
    "confirmation.remainingMilliseconds": data.confirmation.remainingMilliseconds === null ? "unknown" : countState(data.confirmation.remainingMilliseconds),
    pinnedCopies: countState(pinnedCopies.length),
    languageOptions: countState(data.languageOptions.length),
  };
  const actions = [
    { name: "setPreference", available: domain !== undefined && domain.state !== "restricted", ...(domain === undefined ? { reason: "No membership exists yet: choose Immediate to begin the proof step." } : {}) },
    { name: "setLanguagePreference", available: domain !== undefined, ...(domain === undefined ? { reason: "No membership exists yet, so there is no preference to change." } : {}) },
    readAction("confirmMembership", data.confirmation.state === "open", "Nothing is waiting for confirmation at this instant."),
    { name: "unsubscribe", available: domain !== undefined && domain.state !== "restricted", ...(domain === undefined ? { reason: "No membership exists yet, so there is nothing to turn off." } : {}) },
  ];
  return respond(scope, at, { to: null, data, source: { system: "audience-memberships", reference: publisherId ?? "no-membership" }, revision: membership?.revision ?? collectionRevision(domains.map((row) => `${row.membershipId}@${String(row.revision)}`)), valueStates, actions });
}
function readingGrantOf(session: ResolvedSession, memberships: readonly DomainMembership[], recipientId: string): boolean {
  return [...new Set(memberships.map((row) => row.publisherId))].sort(compareCodeUnits).some((publisherId) => canReadProtected(session, { audience: "approved-supporter", reader: { recipientId, publisherId, purpose: UPDATE_EMAIL_PURPOSE, memberships } }).allowed);
}
function confirmationWindowOf(membership: DomainMembership | undefined, at: Temporal.Instant): ConfirmationWindowView {
  if (membership === undefined || membership.state !== "awaiting-proof") return { state: "not-awaiting-proof", deadline: null, remainingMilliseconds: null };
  const acceptedAt = membership.acceptedAt;
  if (acceptedAt === undefined) return { state: "not-awaiting-proof", deadline: null, remainingMilliseconds: null };
  const window = confirmationDeadline({ acceptedAt, now: at });
  return window.status === "within-window" ? { state: "open", deadline: window.deadlineInstant.toString(), remainingMilliseconds: window.remainingMilliseconds } : { state: "expired", deadline: window.deadlineInstant.toString(), remainingMilliseconds: null };
}
export type InboxQuery = { readonly page?: number; readonly pageSize?: number };
/** The synthetic inbox of the receiving persona: one message per recipient and notification intent. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readInbox(query: InboxQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<InboxView>>> {
  const opened = await openRead("readInbox", source);
  if (!opened.ok) return opened.result;
  const { session, published, scope, at } = opened;
  const messages: InboxMessage[] = [];
  const seenIntents = new Set<string>();
  let unresolvedIntents = 0;
  // Built once, so this read is linear in the results it reports rather than in results × (intents + releases).
  const intentsById = new Map(published.state.notificationIntents.map((intent) => [intent.intentId, intent] as const));
  const releasesById = new Map(published.state.releases.map((release) => [release.releaseId, release] as const));
  for (const result of published.state.notificationResults) {
    const copies = result.recipients.filter((copy) => copy.recipientId === session.principalId);
    if (copies.length === 0) continue;
    if (seenIntents.has(result.intentId)) continue;
    seenIntents.add(result.intentId);
    const intent = intentsById.get(result.intentId);
    const release = intent === undefined ? undefined : releasesById.get(intent.releaseId);
    const resolved = release === undefined ? undefined : resolveRelease(release, published.state);
    const copy = copies[0];
    if (intent === undefined || release === undefined || resolved === undefined || resolved.revision === undefined || resolved.domain === undefined || copy === undefined) {
      unresolvedIntents += 1;
      continue;
    }
    const href = updateHref(intent.documentId);
    const pinned: NoticePinnedRendition = { variantId: release.variantId, releaseId: release.releaseId, revisionId: release.revisionId, audience: release.audience, locale: resolved.domain.locale, renditionId: copy.renditionId, checksum: resolved.revision.contentChecksum };
    const notice = buildNotice({ publisher: { displayName: UNNAMED_PUBLISHER }, purpose: intent.purpose, pinned, sender: NOTICE_SENDER, link: href });
    const protectedNotice = release.audience === "approved-supporter";
    const rendered = protectedNotice ? undefined : renderingOf(resolved.revision, published.state.mediaAssets, scenarioMediaServing(session.scenarioId));
    const reading: InboxReading = rendered === undefined ? { state: "link-only", href } : rendered.ok ? { state: "rendered", href, title: resolved.revision.sharePresentation.title, html: rendered.html } : { state: "unavailable", href, reason: rendered.reason };
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
  for (const message of messages) sendStates[message.state] += 1;
  const { window, offset, limit } = pageWindowOf(messages.length, query);
  const data: InboxView = { messages: sliceOf(messages, offset, limit), intentCount: messages.length, sendStates, unresolvedIntents, page: window };
  const valueStates = {
    intentCount: countState(data.intentCount),
    unresolvedIntents: countState(unresolvedIntents),
    "sendStates.accepted": countState(sendStates.accepted),
    "sendStates.failed": countState(sendStates.failed),
    "sendStates.unknown": countState(sendStates.unknown),
    "page.total": countState(window.total),
    "page.pageCount": countState(window.pageCount),
  };
  const rendered = messages.some((message) => message.reading.state === "rendered");
  const actions = [
    { name: "readPinnedEdition", available: rendered, ...(rendered ? {} : { reason: "No message in this inbox points at an edition this reader may open directly; a protected notice is followed at its link, where access is rechecked." }) },
    readAction("readSendResult", messages.length > 0, "This inbox holds no message, so it has no intent to report results for."),
    { name: "confirmMembership", available: false, reason: "Confirming an address is an explicit action on the preference surface, never a consequence of reading a message or of a page loading." },
  ];
  return respond(scope, at, { data, source: { system: "notification-results", reference: "synthetic-inbox" }, revision: collectionRevision(messages.map((message) => `${message.intentId}@${message.state}`)), valueStates, actions });
}
function languagePreferenceOf(session: ResolvedSession, own: World, published: World): string | null {
  for (const row of readerOwnedMemberships(session, own, published)) {
    const preference = row.languagePreference;
    if (preference !== null && preference.length > 0) return preference;
  }
  return null;
}
/** Reports whether the caller holds a protected-reading grant for this publisher, decided now from the reader's own membership rows. */
export function grantHeldFor(session: ResolvedSession, scope: Scope, own: World, published: World): boolean {
  return readingGrantOf(
    session,
    readerOwnedMemberships(session, own, published).map((row) => membershipOf(row, scope)),
    session.principalId,
  );
}
/** A language's name in that language, or the tag itself where the runtime cannot name it. */ function languageNameOf(tag: string): string {
  try {
    const named = new Intl.DisplayNames([tag], { type: "language" }).of(tag)?.trim() ?? "";
    return named.length === 0 ? tag : named;
  } catch {
    return tag;
  }
}
/** The languages this publisher releases Updates in that this reader may read them in, named and ordered once so the choice offers exactly what a save can act on. */
function languageOptionsOf(state: StoredState, grantHeld: boolean): readonly OfferedLanguage[] {
  const byTag = new Map<string, OfferedLanguage>();
  for (const record of state.releases) {
    const resolved = resolveRelease(record, state);
    if (resolved.domain === undefined || resolved.document === undefined || resolved.document.family !== "update") continue;
    // The reach rule and the release's own service decide what this list may name, exactly as the receiving list decides what it may serve.
    if (!releaseStillServes(resolved.domain)) continue;
    if (record.reach === "not-public") continue;
    // A protected edition's language is withheld without the grant: naming it would state that a variant this reader may not read exists, and choosing it could only record a language none of the editions open to them is written in.
    if (record.audience === "approved-supporter" && !grantHeld) continue;
    // BCP-47 tags are case-insensitive, so two spellings of one language are one offered language.
    const { tag, direction } = resolved.domain.locale;
    const key = tag.toLowerCase();
    if (!byTag.has(key)) byTag.set(key, { tag, label: languageNameOf(tag), direction });
  }
  return [...byTag.values()].sort((left, right) => compareCodeUnits(left.tag, right.tag));
}
type AdmittedEdition = { readonly record: ReleaseRecord; readonly revision: StoredRevision; readonly document: ContentDocumentRecord; readonly domain: Release };
function editionsOf(documentId: string, state: StoredState): readonly AdmittedEdition[] {
  const editions: AdmittedEdition[] = [];
  for (const record of state.releases) {
    const resolved = resolveRelease(record, state);
    if (resolved.revision === undefined || resolved.document === undefined || resolved.domain === undefined || resolved.document.documentId !== documentId) continue;
    editions.push({ record, revision: resolved.revision, document: resolved.document, domain: resolved.domain });
  }
  return editions.sort((left, right) => {
    const byPublication = Temporal.Instant.compare(right.domain.publishedAt, left.domain.publishedAt);
    return byPublication === 0 ? compareCodeUnits(left.record.releaseId, right.record.releaseId) : byPublication;
  });
}
const requestedLocaleOf = (requested: string | undefined, preference: string | null, editions: readonly AdmittedEdition[]): string => (requested !== undefined && requested.length > 0 ? requested : preference !== null && preference.length > 0 ? preference : (editions[0]?.domain.locale.tag ?? ""));
type EditionResolution = { readonly status: "served"; readonly edition: AdmittedEdition; readonly locale: ContentLocale; readonly fallbackOccurred: boolean } | { readonly status: "protected-not-permitted" } | { readonly status: "unavailable" };
function resolveEditionFor(input: { readonly document: ContentDocumentRecord; readonly editions: readonly AdmittedEdition[]; readonly requestedLocale: string; readonly grantHeld: boolean }): EditionResolution {
  const attempt = (audience: ContentAudience): { readonly edition: AdmittedEdition; readonly locale: ContentLocale; readonly fallbackOccurred: boolean } | undefined => {
    const candidates = input.editions.filter((edition) => edition.record.audience === audience);
    if (candidates.length === 0) return undefined;
    const resolution = resolveLocale({ document: contentDocumentOf(input.document), siteDefaultLocale: "", audience, releases: candidates.map((edition) => ({ ...edition.domain, documentId: input.document.documentId, siteId: input.document.siteId })), requestedLocale: input.requestedLocale });
    if (resolution.status !== "resolved") return undefined;
    const chosen = candidates.find((edition) => edition.record.releaseId === resolution.release.releaseId);
    return chosen === undefined ? undefined : { edition: chosen, locale: resolution.servedLocale, fallbackOccurred: resolution.fallbackOccurred };
  };
  if (input.grantHeld) {
    const preferred = attempt("approved-supporter") ?? attempt("public");
    return preferred === undefined ? { status: "unavailable" } : { status: "served", ...preferred };
  }
  const publicEdition = attempt("public");
  return publicEdition !== undefined ? { status: "served", ...publicEdition } : attempt("approved-supporter") === undefined ? { status: "unavailable" } : { status: "protected-not-permitted" };
}
export type ReceivingListQuery = { readonly locale?: string; readonly page?: number; readonly pageSize?: number };
/** The Updates a receiving reader may open now. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReceivingList(query: ReceivingListQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReceivingListView>>> {
  const opened = await openRead("readReceivingList", source);
  if (!opened.ok) return opened.result;
  const { session, own, published, scope, at } = opened;
  const preference = languagePreferenceOf(session, own, published);
  const grantHeld = grantHeldFor(session, scope, own, published);
  const requested = requestedLocaleOf(query.locale, preference, []);
  const editions: ReceivingEdition[] = [];
  for (const record of published.state.releases) {
    const resolved = resolveRelease(record, published.state);
    if (resolved.domain === undefined || resolved.revision === undefined || resolved.document === undefined || resolved.document.family !== "update") continue;
    if (!releaseStillServes(resolved.domain)) continue;
    if (record.reach === "not-public") continue;
    if (record.audience === "approved-supporter" && !grantHeld) continue;
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
      // The row's address names the edition itself, not only its document and language: two editions of one Update differ in audience or locale, so a variant-identified address opens exactly the edition the row lists.
      href: `${updateHref(resolved.document.documentId)}?variant=${encodeURIComponent(record.variantId)}&locale=${encodeURIComponent(resolved.domain.locale.tag)}`,
    });
  }
  editions.sort((left, right) => {
    if (left.audience !== right.audience) return left.audience === "public" ? -1 : 1;
    const leftExact = requested.length > 0 && left.locale.tag === requested ? 0 : 1;
    const rightExact = requested.length > 0 && right.locale.tag === requested ? 0 : 1;
    if (leftExact !== rightExact) return leftExact - rightExact;
    const byPublication = compareCodeUnits(right.publishedAt, left.publishedAt);
    if (byPublication !== 0) return byPublication;
    const byDocument = compareCodeUnits(left.documentId, right.documentId);
    return byDocument === 0 ? compareCodeUnits(left.locale.tag, right.locale.tag) : byDocument;
  });
  const { window, offset, limit } = pageWindowOf(editions.length, query);
  const data: ReceivingListView = { editions: sliceOf(editions, offset, limit), languagePreference: preference, page: window };
  const valueStates = { "page.total": countState(window.total), "page.pageCount": countState(window.pageCount), languagePreference: textState(preference) };
  const actions = [readAction("readEdition", editions.length > 0, "No edition is available to this reader at this instant; an edition published later appears here without changing this reader's entitlements.")];
  return respond(scope, at, { data, source: { system: "published-releases", reference: "updates" }, revision: collectionRevision(editions.map((edition) => `${edition.releaseId}@${edition.reach}`)), valueStates, actions });
}
export type ReceivingPostQuery = { readonly updateId: string; readonly locale?: string; readonly variant?: string };
/** The unserved half of a post view: no edition is served, so every edition and rendition field states none. */
const UNSERVED_POST_FIELDS: Omit<ReceivingPostView, "state" | "documentId" | "requestedLocale" | "simulated"> = { variantId: null, releaseId: null, audience: null, servedLocale: null, fallbackOccurred: false, publishedAt: null, title: null, html: null, renditions: [] };
/** One Update at its exact post, re-authorised on every open. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReceivingPost(query: ReceivingPostQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReceivingPostView>>> {
  const opened = await openRead("readReceivingPost", source);
  if (!opened.ok) return opened.result;
  const { session, own, published, scope, at } = opened;
  const document = published.state.contentDocuments.find((candidate) => candidate.documentId === query.updateId && candidate.family === "update");
  if (document === undefined) return deniedRead("no-permission");
  const grantHeld = grantHeldFor(session, scope, own, published);
  const admitted = editionsOf(document.documentId, published.state).filter((edition) => releaseStillServes(edition.domain));
  // A pinned address names one edition, so the pin narrows the candidates before the language chooses among them: the reader's language still selects within that edition rather than across its siblings.
  const pinned = (query.variant ?? "").trim();
  const editions = pinned.length === 0 ? admitted : admitted.filter((edition) => edition.record.variantId === pinned && (edition.record.audience === "public" || grantHeld));
  // A pin that leaves no edition this reader may open answers exactly as an address naming no Update does — unknown, in another scope, withdrawn, superseded, or protected without the grant — because naming which would state that the edition exists.
  if (pinned.length > 0 && editions.length === 0) return deniedRead("no-permission");
  const preference = languagePreferenceOf(session, own, published);
  const requestedLocale = requestedLocaleOf(query.locale, preference, editions);
  const resolution = resolveEditionFor({ document, editions, requestedLocale, grantHeld });
  if (resolution.status === "protected-not-permitted") return deniedRead("no-protected-grant");
  if (resolution.status === "unavailable") {
    const unavailableData: ReceivingPostView = { ...UNSERVED_POST_FIELDS, state: "language-unavailable", documentId: document.documentId, requestedLocale, simulated: [SIMULATED_PUBLICATION_REACH] };
    return respond(scope, at, { data: unavailableData, source: { system: "published-releases", reference: document.documentId }, revision: collectionRevision(editions.map((edition) => edition.record.releaseId)), valueStates: { requestedLocale: textState(requestedLocale) }, actions: [] });
  }
  const served = resolution;
  const serving = scenarioMediaServing(session.scenarioId);
  const rendered = renderingOf(served.edition.revision, published.state.mediaAssets, serving);
  if (!rendered.ok) return sourceUnavailableRead({ job: "readReceivingPost", source: { system: "content-render", reference: "unrenderable-edition" }, guidance: STORE_READ_GUIDANCE });
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
  const valueStates = { title: textState(data.title), "servedLocale.tag": textState(served.locale.tag), publishedAt: textState(data.publishedAt), renditions: renditionCountState(serving, data.renditions.length) };
  return respond(scope, at, { data, source: { system: "published-releases", reference: document.documentId }, revision: served.edition.record.revision, valueStates, actions: [{ name: "followLink", available: true }] });
}
export type DiscoveryIndexQuery = { readonly page?: number; readonly pageSize?: number };
/** The discovery index: the page editions that reach a public listing, and nothing else. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readDiscoveryIndex(query: DiscoveryIndexQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<DiscoveryIndexView>>> {
  const opened = await openRead("readDiscoveryIndex", source);
  if (!opened.ok) return opened.result;
  const { published, scope, at } = opened;
  const entries: DiscoveryEntry[] = [];
  for (const record of published.state.releases) {
    if (record.audience !== "public") continue;
    const resolved = resolveRelease(record, published.state);
    if (resolved.document === undefined || resolved.revision === undefined || resolved.domain === undefined || resolved.document.family === "update") continue;
    if (!isListedPublicly({ reach: record.reach, withdrawnAt: record.withdrawnAt })) continue;
    const metadata = reachMetadata({ reach: record.reach, withdrawnAt: record.withdrawnAt });
    entries.push({ documentId: resolved.document.documentId, locale: resolved.domain.locale, title: resolved.revision.sharePresentation.title, href: pageHref(resolved.document.documentId, resolved.domain.locale.tag), noindex: metadata.robots === "noindex" });
  }
  entries.sort((left, right) => {
    const byTitle = compareCodeUnits(left.title, right.title);
    return byTitle === 0 ? compareCodeUnits(left.href, right.href) : byTitle;
  });
  const { window, offset, limit } = pageWindowOf(entries.length, query);
  const data: DiscoveryIndexView = { entries: sliceOf(entries, offset, limit), page: window };
  const valueStates = { "page.total": countState(window.total), "page.pageCount": countState(window.pageCount) };
  return respond(scope, at, { data, source: { system: "published-releases", reference: "listed-pages" }, revision: collectionRevision(entries.map((entry) => `${entry.href}@${entry.title}`)), valueStates, actions: [readAction("readEdition", entries.length > 0, "No page edition is listed publicly at this instant.")] });
}
export type ReceivingPageQuery = { readonly pageId: string; readonly locale?: string };
/** The unserved half of a page view: no edition is served, so every edition and giving field states none. */
const UNSERVED_PAGE_FIELDS: Omit<ReceivingPageView, "state" | "documentId" | "family" | "requestedLocale" | "metadata" | "tombstone" | "simulated"> = { releaseId: null, servedLocale: null, fallbackOccurred: false, reach: null, title: null, description: null, html: null, renditions: [], giving: null };
/** One page edition served by direct link, re-authorised on every request, where a Not public edition is served to the caller whose own world holds it and refused to every caller reading across the reading crossing. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReceivingPage(query: ReceivingPageQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReceivingPageView>>> {
  const opened = await openRead("readReceivingPage", source);
  if (!opened.ok) return opened.result;
  const { session, own, published, scope, at } = opened;
  const document = published.state.contentDocuments.find((candidate) => candidate.documentId === query.pageId && candidate.family !== "update");
  if (document === undefined) return deniedRead("no-permission");
  const grantHeld = grantHeldFor(session, scope, own, published);
  const editions = editionsOf(document.documentId, published.state);
  const live = editions.filter((edition) => releaseStillServes(edition.domain));
  const preference = languagePreferenceOf(session, own, published);
  const requestedLocale = requestedLocaleOf(query.locale, preference, editions);
  const resolution = resolveEditionFor({ document, editions: live, requestedLocale, grantHeld });
  if (resolution.status === "protected-not-permitted") return deniedRead("no-protected-grant");
  if (resolution.status === "unavailable") {
    const withdrawn = editions.filter((edition) => edition.domain.withdrawnAt !== undefined);
    const first = withdrawn[0];
    if (first !== undefined) {
      const tombstoneData: ReceivingPageView = { ...UNSERVED_PAGE_FIELDS, state: "withdrawn", documentId: null, family: null, requestedLocale, metadata: { listed: false, indexable: false, robots: "noindex" }, tombstone: withdrawEdition(first.domain, { at }).tombstone, simulated: [] };
      return respond(scope, at, { data: tombstoneData, source: { system: "published-releases", reference: "withdrawn-edition" }, revision: collectionRevision(withdrawn.map((edition) => edition.record.releaseId)), valueStates: { requestedLocale: textState(requestedLocale) }, actions: [] });
    }
    const unavailableData: ReceivingPageView = { ...UNSERVED_PAGE_FIELDS, state: "language-unavailable", documentId: document.documentId, family: document.family, requestedLocale, metadata: null, tombstone: null, simulated: [SIMULATED_PUBLICATION_REACH] };
    return respond(scope, at, { data: unavailableData, source: { system: "published-releases", reference: document.documentId }, revision: collectionRevision(live.map((edition) => edition.record.releaseId)), valueStates: { requestedLocale: textState(requestedLocale) }, actions: [] });
  }
  const served = resolution;
  const edition = served.edition;
  const reading = published.sessionId !== own.sessionId;
  // Reach decides what a direct link serves for this caller: the reach control's own words say only the owner can open a Not public edition, so the world that holds the edition serves it, while a caller reading across the reading crossing is served a link for a `link-public` or `listed` edition alone and is otherwise refused the neutral answer an address that was never recorded receives.
  if (reading && !isDirectlyReadable({ reach: edition.record.reach, withdrawnAt: edition.domain.withdrawnAt })) return deniedRead("no-permission");
  const serving = scenarioMediaServing(session.scenarioId);
  const rendered = renderingOf(edition.revision, published.state.mediaAssets, serving);
  if (!rendered.ok) return sourceUnavailableRead({ job: "readReceivingPage", source: { system: "content-render", reference: "unrenderable-edition" }, guidance: STORE_READ_GUIDANCE });
  const giving: GivingPlacement = document.givingBinding === null ? { state: "giving-unavailable" } : { state: "available", designation: document.givingBinding.designation, label: document.givingBinding.label, simulated: SIMULATED_GIVING_DESTINATION };
  const data: ReceivingPageView = {
    state: "served",
    documentId: document.documentId,
    family: document.family,
    releaseId: edition.record.releaseId,
    requestedLocale,
    servedLocale: served.locale,
    fallbackOccurred: served.fallbackOccurred,
    reach: edition.record.reach,
    metadata: reachMetadata({ reach: edition.record.reach, withdrawnAt: edition.record.withdrawnAt }),
    title: edition.revision.sharePresentation.title,
    description: edition.revision.sharePresentation.description,
    html: rendered.html,
    renditions: rendered.media.references,
    giving,
    tombstone: null,
    simulated: [SIMULATED_PUBLICATION_REACH, SIMULATED_GIVING_DESTINATION],
  };
  const valueStates = { title: textState(data.title), "servedLocale.tag": textState(served.locale.tag), renditions: renditionCountState(serving, data.renditions.length), "giving.state": textState(giving.state) };
  return respond(scope, at, { data, source: { system: "published-releases", reference: document.documentId }, revision: edition.record.revision, valueStates, actions: [] });
}
function retryReason(state: SendOutcomeState, withinUsefulness: boolean): string {
  if (state === "accepted") return "The local stand-in for a provider already took this copy for this intent, so it is never submitted again under a new identity.";
  if (state === "unknown") return "The acknowledgement was lost, so whether the effect happened is not known. Re-query this same intent instead of submitting again.";
  return withinUsefulness ? "The attempt failed and may be retried under the same intent while the usefulness window is open." : "The attempt failed, and its 24-hour usefulness window has closed, so it cannot be revived as a fresh attempt.";
}
/** The notice one intent submitted, rebuilt from the records it was submitted for: the release it names, that release's own revision and the rendition the first recorded copy was pinned to. Answers `null` when the release or its revision cannot be resolved, so a surface reports the absence rather than inventing a message, and it is the one notice implementation's — never a second construction of it. */
function noticeOfIntent(state: StoredState, intent: StoredState["notificationIntents"][number], rows: readonly SendResultRow[]): Notice | null {
  const release = state.releases.find((candidate) => candidate.releaseId === intent.releaseId);
  if (release === undefined) return null;
  const resolved = resolveRelease(release, state);
  if (resolved.revision === undefined || resolved.domain === undefined) return null;
  const renditionId = rows[0]?.renditionId;
  const pinned: NoticePinnedRendition = { variantId: release.variantId, releaseId: release.releaseId, revisionId: release.revisionId, audience: release.audience, locale: resolved.domain.locale, ...(renditionId === undefined ? {} : { renditionId }), checksum: resolved.revision.contentChecksum };
  return buildNotice({ publisher: { displayName: UNNAMED_PUBLISHER }, purpose: intent.purpose, pinned, sender: NOTICE_SENDER, link: updateHref(intent.documentId) });
}
export type SendResultQuery = { readonly intentId: string; readonly page?: number; readonly pageSize?: number };
/** The per-send results of one notification intent. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSendResult(query: SendResultQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<SendResultView>>> {
  const opened = await openRead("readSendResult", source);
  if (!opened.ok) return opened.result;
  const { session, published, scope, at } = opened;
  const intent = published.state.notificationIntents.find((candidate) => candidate.intentId === query.intentId);
  if (intent === undefined) return deniedRead("no-permission");
  const results = published.state.notificationResults.filter((candidate) => candidate.intentId === intent.intentId);
  const admitted = admittedToWorld(session, published);
  const pairs = results.flatMap((result) => result.recipients.filter((copy) => admitted || copy.recipientId === session.principalId).map((copy) => ({ result, copy })));
  if (!admitted && pairs.length === 0) return deniedRead("no-permission");
  const byRecipient = new Map<string, { readonly result: NotificationSendResultRecord; readonly copy: (typeof pairs)[number]["copy"] }>();
  for (const pair of pairs) if (!byRecipient.has(pair.copy.recipientId)) byRecipient.set(pair.copy.recipientId, pair);
  const unservedByRecipient = new Map<string, NotificationUnservedRecipientRecord>();
  for (const entry of results.flatMap((result) => result.unserved)) {
    if (!admitted && entry.recipientId !== session.principalId) continue;
    if (byRecipient.has(entry.recipientId) || unservedByRecipient.has(entry.recipientId)) continue;
    unservedByRecipient.set(entry.recipientId, entry);
  }
  const unserved = [...unservedByRecipient.values()].sort((left, right) => compareCodeUnits(left.recipientId, right.recipientId));
  const intendedAt = instantOf(intent.intendedAt);
  if (intendedAt === undefined) return storeUnavailableRead("readSendResult", "unreadable-intent-instant", STORE_READ_GUIDANCE);
  const usefulness = notificationDeadline({ intendedAt, now: at });
  const withinUsefulness = usefulness.status === "within-usefulness";
  const counts = zeroSendStates();
  const rows: SendResultRow[] = [];
  for (const pair of [...byRecipient.values()].sort((left, right) => compareCodeUnits(left.copy.recipientId, right.copy.recipientId))) {
    counts[pair.copy.state] += 1;
    rows.push({
      recipientId: pair.copy.recipientId,
      renditionId: pair.copy.renditionId,
      state: pair.copy.state,
      recordedAt: pair.copy.at,
      dedupeKey: dedupeKey({ publisherId: intent.publisherId, purpose: intent.purpose, recipientId: pair.copy.recipientId, intentId: intent.intentId }),
      retry: { available: mayRepeatIntent(pair.copy.state) && withinUsefulness, reason: retryReason(pair.copy.state, withinUsefulness) },
      recovery: { intentId: intent.intentId },
    });
  }
  const recordedAt = results.map((result) => result.recordedAt).sort((left, right) => compareCodeUnits(right, left))[0] ?? null;
  const { window, offset, limit } = pageWindowOf(rows.length, query);
  // The edition the intent names, read from the release it was recorded for: an intent states a release, and the variant is that release's own identity rather than anything inferred from the rendition a recipient was pinned to.
  const intentRelease = published.state.releases.find((candidate) => candidate.releaseId === intent.releaseId);
  const data: SendResultView = {
    intentId: intent.intentId,
    releaseId: intent.releaseId,
    publisherId: intent.publisherId,
    purpose: intent.purpose,
    documentId: intent.documentId,
    variantId: intentRelease?.variantId ?? "",
    intendedAt: intent.intendedAt,
    recordedAt,
    ceilingCount: intent.ceilingCount,
    counts,
    rows: sliceOf(rows, offset, limit),
    unserved,
    usefulness: usefulness.status === "within-usefulness" ? { state: "within-usefulness", deadline: usefulness.deadlineInstant.toString(), remainingMilliseconds: usefulness.remainingMilliseconds } : { state: "past-usefulness", deadline: usefulness.deadlineInstant.toString(), remainingMilliseconds: null },
    notice: noticeOfIntent(published.state, intent, rows),
    page: window,
  };
  const valueStates = {
    ceilingCount: countState(intent.ceilingCount),
    "counts.accepted": countState(counts.accepted),
    "counts.failed": countState(counts.failed),
    "counts.unknown": countState(counts.unknown),
    unserved: countState(unserved.length),
    "page.total": countState(window.total),
    "page.pageCount": countState(window.pageCount),
    "usefulness.remainingMilliseconds": data.usefulness.remainingMilliseconds === null ? "unknown" : countState(data.usefulness.remainingMilliseconds),
  };
  const retryable = rows.some((row) => row.retry.available);
  const actions = [
    { name: "retryRecipient", available: retryable, ...(retryable ? {} : { reason: "No recorded row may be submitted again: acceptance is never repeated, an uncertain outcome is recovered by re-querying the same intent, and a failure outside its usefulness window cannot be revived." }) },
    readAction("recoverByIntent", rows.length > 0, "This intent has recorded no recipient outcome yet."),
  ];
  return respond(scope, at, { data, source: { system: "notification-results", reference: intent.intentId }, revision: collectionRevision([...rows.map((row) => `${row.recipientId}@${row.state}@${row.renditionId}`), ...unserved.map((entry) => `${entry.recipientId}@${entry.reason}`)]), valueStates, actions });
}
