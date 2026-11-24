import { directionOfTag, type ContentLocale } from "@/modules/content/locale";
import { isDirectlyReadable, isSuperseded, isWithdrawn } from "@/modules/content/reach";
import type { ContentCandidate, ContentVariant, Release, VariantLocale } from "@/modules/content/variant";
import type { MediaRenditionPurpose } from "@/modules/media/asset";
export const PREVIEW_DENIAL_REASONS = ["not-authorised", "revision-not-acknowledged", "locale-not-admitted", "unreleased", "withdrawn", "unavailable"] as const;
export type PreviewDenialReason = (typeof PREVIEW_DENIAL_REASONS)[number];
export const PREVIEW_RENDITION_PURPOSES: readonly MediaRenditionPurpose[] = ["display", "playback", "poster", "captions", "transcript"];
export type PreviewPrincipal = { readonly principalId: string };
export type PreviewAcknowledgement = { readonly revisionId: string; readonly candidate?: ContentCandidate };
export interface PreviewInput {
  readonly principal: PreviewPrincipal;
  readonly variant: ContentVariant;
  readonly acknowledgement: PreviewAcknowledgement;
  readonly requestedLocale: string;
  readonly releases: readonly Release[];
  readonly renditionIds: readonly string[];
  readonly canReadProtected: boolean;
  readonly isAuthor: boolean;
}
export type PreviewAuthorised = { readonly status: "authorised"; readonly variantId: string; readonly revisionId: string; readonly servedLocale: string; readonly direction: ContentLocale["direction"]; readonly renditionIds: readonly string[]; readonly inert: true; readonly givingAction: "none" };
export type PreviewDenied = { readonly status: "denied"; readonly reason: PreviewDenialReason };
export type PreviewDecision = PreviewAuthorised | PreviewDenied;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const deny = (reason: PreviewDenialReason): PreviewDenied => ({ status: "denied", reason });
const isUsableRelease = (candidate: Release | null | undefined): candidate is Release => (candidate === undefined || candidate === null ? false : text(candidate.releaseId).length > 0 && text(candidate.variantId).length > 0 && text(candidate.revisionId).length > 0);
const sameTag = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase();
const directionFor = (locale: VariantLocale | null | undefined): ContentLocale["direction"] => (locale?.direction === "rtl" ? "rtl" : directionOfTag(text(locale?.tag)));
const candidateIsCurrentFor = (variant: ContentVariant, candidate: ContentCandidate): boolean => text(variant.candidateId).length > 0 && text(candidate.candidateId) === text(variant.candidateId) && text(candidate.variantId) === text(variant.variantId) && text(candidate.revisionId).length > 0;
type ReadingQuery = { readonly variantId: string; readonly protectedEdition: boolean; readonly canReadProtected: boolean; readonly isAuthor: boolean; readonly acknowledgedRevisionId: string; readonly releases: readonly Release[] };
type ReadingAdmission = { readonly status: "admitted"; readonly revisionId: string } | { readonly status: "refused"; readonly reason: PreviewDenialReason };
function admitReading(query: ReadingQuery): ReadingAdmission {
  const editionReleases = query.releases.filter((release) => text(release.variantId) === query.variantId);
  if (editionReleases.length === 0) return { status: "refused", reason: "not-authorised" };
  if (query.protectedEdition && query.canReadProtected !== true && !query.isAuthor) return { status: "refused", reason: "not-authorised" };
  const published = editionReleases.filter((release) => text(release.revisionId) === query.acknowledgedRevisionId && !isSuperseded(release))[0];
  if (published === undefined) return { status: "refused", reason: "revision-not-acknowledged" };
  if (isWithdrawn(published)) return { status: "refused", reason: "withdrawn" };
  return !query.protectedEdition && !isDirectlyReadable(published) ? { status: "refused", reason: "unreleased" } : { status: "admitted", revisionId: text(published.revisionId) };
}
const admittedRenditionIds = (renditionIds: readonly string[] | undefined): readonly string[] => (Array.isArray(renditionIds) ? [...new Set(renditionIds.map(text).filter((id) => id.length > 0))] : []);
/** Decides one preview: whether the acknowledged revision of this edition may be rendered by this principal, and what that answer admits. */ export function authorisePreview(input: PreviewInput): PreviewDecision {
  const submitted: unknown = input;
  if (submitted === undefined || submitted === null) return deny("not-authorised");
  const principalId = text(input.principal?.principalId);
  if (principalId.length === 0) return deny("not-authorised");
  const variant: ContentVariant | null | undefined = input.variant;
  if (variant === undefined || variant === null) return deny("unavailable");
  const variantId = text(variant.variantId);
  const documentId = text(variant.documentId);
  const editionTag = text(variant.locale?.tag);
  if (variantId.length === 0 || documentId.length === 0 || editionTag.length === 0) return deny("unavailable");
  const acknowledgedRevisionId = text(input.acknowledgement?.revisionId);
  const candidate: ContentCandidate | null | undefined = input.acknowledgement?.candidate;
  const isAuthor = input.isAuthor === true;
  const protectedEdition = variant.audience === "approved-supporter";
  const reviewerAuthority = candidate !== undefined && candidate !== null && candidateIsCurrentFor(variant, candidate) && (!protectedEdition || input.canReadProtected === true || isAuthor);
  const releaseRecords: readonly Release[] | null | undefined = input.releases;
  const releases = releaseRecords === null || releaseRecords === undefined ? [] : releaseRecords.filter(isUsableRelease);
  const workingAuthority = isAuthor || reviewerAuthority;
  let admittedRevisionId: string | undefined;
  if (workingAuthority) {
    if (isAuthor && acknowledgedRevisionId.length > 0 && acknowledgedRevisionId === text(variant.draftRevisionId)) admittedRevisionId = acknowledgedRevisionId;
    else if (reviewerAuthority && candidate !== undefined && candidate !== null && acknowledgedRevisionId.length > 0 && acknowledgedRevisionId === text(candidate.revisionId)) admittedRevisionId = acknowledgedRevisionId;
  }
  let readingRefusal: PreviewDenialReason | undefined;
  if (admittedRevisionId === undefined) {
    const reading = admitReading({ variantId, protectedEdition, canReadProtected: input.canReadProtected === true, isAuthor, acknowledgedRevisionId, releases });
    if (reading.status === "admitted") admittedRevisionId = reading.revisionId;
    else readingRefusal = reading.reason;
  }
  if (admittedRevisionId === undefined) return readingRefusal === "withdrawn" ? deny("withdrawn") : workingAuthority ? deny("revision-not-acknowledged") : deny(readingRefusal === undefined ? "not-authorised" : readingRefusal);
  const requestedLocale = text(input.requestedLocale);
  if (requestedLocale.length > 0 && !sameTag(requestedLocale, editionTag)) return deny("locale-not-admitted");
  const headRelease = releases.filter((release) => text(release.releaseId) === text(variant.releaseHeadId))[0];
  if (headRelease !== undefined && isWithdrawn(headRelease)) return deny("withdrawn");
  return { status: "authorised", variantId, revisionId: admittedRevisionId, servedLocale: editionTag, direction: directionFor(variant.locale), renditionIds: admittedRenditionIds(input.renditionIds), inert: true, givingAction: "none" };
}
