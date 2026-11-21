/** The one preview authorisation decision: whether this principal may render the revision it acknowledges of this edition, which revision that is, and which renditions travel with the answer. */
import { directionOfTag, type ContentLocale } from "@/modules/content/locale";
import { isDirectlyReadable } from "@/modules/content/reach";
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
// Every helper here answers about the value it is given and holds nothing between calls, so a damaged record can only narrow what is admitted and never widen it.
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const deny = (reason: PreviewDenialReason): PreviewDenied => ({ status: "denied", reason });
function isWithdrawn(edition: { readonly withdrawnAt?: unknown }): boolean {
  const withdrawnAt: unknown = edition.withdrawnAt;
  return withdrawnAt !== undefined && withdrawnAt !== null;
}
const isSuperseded = (release: Release): boolean => text(release.supersededBy).length > 0;
function isUsableRelease(candidate: Release | null | undefined): candidate is Release {
  if (candidate === undefined || candidate === null) return false;
  return text(candidate.releaseId).length > 0 && text(candidate.variantId).length > 0 && text(candidate.revisionId).length > 0;
}
const sameTag = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase();
function directionFor(locale: VariantLocale | null | undefined): ContentLocale["direction"] {
  const declared: unknown = locale?.direction;
  return declared === "rtl" ? "rtl" : directionOfTag(text(locale?.tag));
}
function candidateIsCurrentFor(variant: ContentVariant, candidate: ContentCandidate): boolean {
  const candidateId = text(variant.candidateId);
  return candidateId.length > 0 && text(candidate.candidateId) === candidateId && text(candidate.variantId) === text(variant.variantId) && text(candidate.revisionId).length > 0;
}
type ReadingQuery = { readonly variantId: string; readonly protectedEdition: boolean; readonly canReadProtected: boolean; readonly isAuthor: boolean; readonly acknowledgedRevisionId: string; readonly releases: readonly Release[] };
type ReadingAdmission = { readonly status: "admitted"; readonly revisionId: string } | { readonly status: "refused"; readonly reason: PreviewDenialReason };

function admitReading(query: ReadingQuery): ReadingAdmission {
  const editionReleases = query.releases.filter((release) => text(release.variantId) === query.variantId);
  if (editionReleases.length === 0) return { status: "refused", reason: "not-authorised" };
  if (query.protectedEdition && query.canReadProtected !== true && !query.isAuthor) return { status: "refused", reason: "not-authorised" };
  const published = editionReleases.filter((release) => text(release.revisionId) === query.acknowledgedRevisionId && !isSuperseded(release))[0];
  if (published === undefined) return { status: "refused", reason: "revision-not-acknowledged" };
  if (isWithdrawn(published)) return { status: "refused", reason: "withdrawn" };
  if (!query.protectedEdition && !isDirectlyReadable(published)) {
    // A Not public edition serves nobody by link, so its address is not a reading address; reach never stands in for the audience check above.
    return { status: "refused", reason: "unreleased" };
  }
  return { status: "admitted", revisionId: text(published.revisionId) };
}
function admittedRenditionIds(renditionIds: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(renditionIds)) return [];
  const admitted: string[] = [];
  for (const renditionId of renditionIds) {
    const id = text(renditionId);
    if (id.length === 0 || admitted.includes(id)) continue;
    admitted.push(id);
  }
  return admitted;
}
/** Decides one preview: whether the acknowledged revision of this edition may be rendered by this principal, and what that answer admits. */
export function authorisePreview(input: PreviewInput): PreviewDecision {
  // A caller outside the type system can reach this boundary with nothing at all; failing closed is the only answer a decision may give to an absent request.
  const submitted: unknown = input;
  if (submitted === undefined || submitted === null) return deny("not-authorised");
  // 1. A principal, and nothing else, begins a preview.
  const principalId = text(input.principal?.principalId);
  if (principalId.length === 0) return deny("not-authorised");
  // 2. The edition must be readable as an edition before anything is decided about it.
  const variant: ContentVariant | null | undefined = input.variant;
  if (variant === undefined || variant === null) return deny("unavailable");
  const variantId = text(variant.variantId);
  const documentId = text(variant.documentId);
  const editionTag = text(variant.locale?.tag);
  if (variantId.length === 0 || documentId.length === 0 || editionTag.length === 0) return deny("unavailable");
  // 3. Which revision may be rendered, and under whose authority.
  const acknowledgedRevisionId = text(input.acknowledgement?.revisionId);
  const candidate: ContentCandidate | null | undefined = input.acknowledgement?.candidate;
  const isAuthor = input.isAuthor === true;
  const protectedEdition = variant.audience === "approved-supporter";
  // A protected edition is examined only by a reviewer holding a protected-content reader grant, or by the author of the content itself.
  const reviewerAuthority = candidate !== undefined && candidate !== null && candidateIsCurrentFor(variant, candidate) && (!protectedEdition || input.canReadProtected === true || isAuthor);
  const releaseRecords: readonly Release[] | null | undefined = input.releases;
  const releases = releaseRecords === null || releaseRecords === undefined ? [] : releaseRecords.filter(isUsableRelease);
  const workingAuthority = isAuthor || reviewerAuthority;
  let admittedRevisionId: string | undefined;
  if (workingAuthority) {
    if (isAuthor && acknowledgedRevisionId.length > 0 && acknowledgedRevisionId === text(variant.draftRevisionId)) {
      admittedRevisionId = acknowledgedRevisionId;
    } else if (reviewerAuthority && candidate !== undefined && candidate !== null && acknowledgedRevisionId.length > 0 && acknowledgedRevisionId === text(candidate.revisionId)) admittedRevisionId = acknowledgedRevisionId;
  }
  // Working authority that does not admit the acknowledged revision falls through to the reading path, which serves a publication at the acknowledged revision or nothing at all — never a history fallback.
  let readingRefusal: PreviewDenialReason | undefined;
  if (admittedRevisionId === undefined) {
    const reading = admitReading({ variantId, protectedEdition, canReadProtected: input.canReadProtected === true, isAuthor, acknowledgedRevisionId, releases });
    if (reading.status === "admitted") admittedRevisionId = reading.revisionId;
    else readingRefusal = reading.reason;
  }
  if (admittedRevisionId === undefined) {
    // Withdrawal is a fact about the edition rather than about this principal; any other refusal of a principal holding authority is about the revision it acknowledged — a superseded draft, a replaced candidate or a restored-away revision — and none falls back to the current one.
    if (readingRefusal === "withdrawn") return deny("withdrawn");
    if (workingAuthority) return deny("revision-not-acknowledged");
    return deny(readingRefusal === undefined ? "not-authorised" : readingRefusal);
  }
  // 4. The locale, after authority, because choosing an edition is never choosing a permission: a blank request takes the edition's own locale and any other tag is another edition's.
  const requestedLocale = text(input.requestedLocale);
  if (requestedLocale.length > 0 && !sameTag(requestedLocale, editionTag)) return deny("locale-not-admitted");
  // 5. Withdrawal wins over preview, for its author as much as for a reader.
  const headRelease = releases.filter((release) => text(release.releaseId) === text(variant.releaseHeadId))[0];
  if (headRelease !== undefined && isWithdrawn(headRelease)) return deny("withdrawn");
  return { status: "authorised", variantId, revisionId: admittedRevisionId, servedLocale: editionTag, direction: directionFor(variant.locale), renditionIds: admittedRenditionIds(input.renditionIds), inert: true, givingAction: "none" };
}
