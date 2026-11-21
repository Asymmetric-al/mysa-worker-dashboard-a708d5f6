/**
 * The one preview authorisation decision: whether this principal may render the revision it
 * acknowledges of this edition, which revision that is, and which renditions travel with the answer —
 * exact, currently authorised and inert.
 */
import { directionOfTag, type ContentLocale } from "@/modules/content/locale";
import { isDirectlyReadable } from "@/modules/content/reach";
import type { ContentCandidate, ContentVariant, Release, VariantLocale } from "@/modules/content/variant";
import type { MediaRenditionPurpose } from "@/modules/media/asset";
// The closed vocabularies
/** The six reasons a preview is refused, and the only ones: the route layer and the tests reference this list instead of restating a literal. */
export const PREVIEW_DENIAL_REASONS = ["not-authorised", "revision-not-acknowledged", "locale-not-admitted", "unreleased", "withdrawn", "unavailable"] as const;
/** One preview refusal, derived from {@link PREVIEW_DENIAL_REASONS} so a new member cannot appear alone. */
export type PreviewDenialReason = (typeof PREVIEW_DENIAL_REASONS)[number];
/** The rendition purposes a preview admits, in the order a placement offers them: a still image carries `display`, a video carries `playback` with its `poster`, `captions` and `transcript`. */
export const PREVIEW_RENDITION_PURPOSES: readonly MediaRenditionPurpose[] = ["display", "playback", "poster", "captions", "transcript"];
// What a preview decision reads
/** Who is previewing: the principal identity the development session resolved, and nothing else. */
export interface PreviewPrincipal {
  readonly principalId: string;
}
/** What the previewing surface says it is showing: the exact revision it believes it is rendering, and — when the preview answers a review step — the frozen candidate record that revision. */
export interface PreviewAcknowledgement {
  readonly revisionId: string;
  readonly candidate?: ContentCandidate;
}
/** Everything one preview decision needs, every field already resolved server-side for this request alone. */
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
// What a preview decision answers
/** A preview that may be rendered: the exact revision, the locale and direction it is read in, and the renditions admitted with it. */
export interface PreviewAuthorised {
  readonly status: "authorised";
  readonly variantId: string;
  readonly revisionId: string;
  readonly servedLocale: string;
  readonly direction: ContentLocale["direction"];
  readonly renditionIds: readonly string[];
  readonly inert: true;
  readonly givingAction: "none";
}
/** A preview that may not be rendered: one reason code and nothing else. */
export interface PreviewDenied {
  readonly status: "denied";
  readonly reason: PreviewDenialReason;
}
/** Every answer a preview decision gives. */
export type PreviewDecision = PreviewAuthorised | PreviewDenied;
// Reading the records fail-closed
//
// Every helper here answers about the value it is given and holds nothing between calls, so a damaged record
// can only narrow what is admitted and never widen it.
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function deny(reason: PreviewDenialReason): PreviewDenied {
  return { status: "denied", reason };
}
function isWithdrawn(edition: { readonly withdrawnAt?: unknown }): boolean {
  const withdrawnAt: unknown = edition.withdrawnAt;
  return withdrawnAt !== undefined && withdrawnAt !== null;
}
function isSuperseded(release: Release): boolean {
  return text(release.supersededBy).length > 0;
}
function isUsableRelease(candidate: Release | null | undefined): candidate is Release {
  if (candidate === undefined || candidate === null) {
    return false;
  }
  return text(candidate.releaseId).length > 0 && text(candidate.variantId).length > 0 && text(candidate.revisionId).length > 0;
}
function sameTag(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
function directionFor(locale: VariantLocale | null | undefined): ContentLocale["direction"] {
  const declared: unknown = locale?.direction;
  return declared === "rtl" ? "rtl" : directionOfTag(text(locale?.tag));
}
function candidateIsCurrentFor(variant: ContentVariant, candidate: ContentCandidate): boolean {
  const candidateId = text(variant.candidateId);
  return candidateId.length > 0 && text(candidate.candidateId) === candidateId && text(candidate.variantId) === text(variant.variantId) && text(candidate.revisionId).length > 0;
}
// The reading path: a publication of this edition, at the revision a request acknowledges
interface ReadingQuery {
  readonly variantId: string;
  readonly protectedEdition: boolean;
  readonly canReadProtected: boolean;
  readonly isAuthor: boolean;
  readonly acknowledgedRevisionId: string;
  readonly releases: readonly Release[];
}
type ReadingAdmission = { readonly status: "admitted"; readonly revisionId: string } | { readonly status: "refused"; readonly reason: PreviewDenialReason };

function admitReading(query: ReadingQuery): ReadingAdmission {
  const editionReleases = query.releases.filter((release) => text(release.variantId) === query.variantId);
  if (editionReleases.length === 0) {
    return { status: "refused", reason: "not-authorised" };
  }
  if (query.protectedEdition && query.canReadProtected !== true && !query.isAuthor) {
    return { status: "refused", reason: "not-authorised" };
  }
  const published = editionReleases.filter((release) => text(release.revisionId) === query.acknowledgedRevisionId && !isSuperseded(release))[0];
  if (published === undefined) {
    return { status: "refused", reason: "revision-not-acknowledged" };
  }
  if (isWithdrawn(published)) {
    return { status: "refused", reason: "withdrawn" };
  }
  if (!query.protectedEdition && !isDirectlyReadable(published)) {
    // A Not public edition serves nobody by link, so its address is not a reading address. Reach decides what a
    // route serves the public; it never stands in for the audience check above.
    return { status: "refused", reason: "unreleased" };
  }
  return { status: "admitted", revisionId: text(published.revisionId) };
}
function admittedRenditionIds(renditionIds: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(renditionIds)) {
    return [];
  }
  const admitted: string[] = [];
  for (const renditionId of renditionIds) {
    const id = text(renditionId);
    if (id.length === 0 || admitted.includes(id)) {
      continue;
    }
    admitted.push(id);
  }
  return admitted;
}
// The decision
/** Decides one preview: whether the acknowledged revision of this edition may be rendered by this principal, and what that answer admits. */
export function authorisePreview(input: PreviewInput): PreviewDecision {
  // A caller outside the type system can reach this boundary with nothing at all; failing closed is the only
  // answer a decision may give to an absent request.
  const submitted: unknown = input;
  if (submitted === undefined || submitted === null) {
    return deny("not-authorised");
  }
  // 1. A principal, and nothing else, begins a preview.
  const principalId = text(input.principal?.principalId);
  if (principalId.length === 0) {
    return deny("not-authorised");
  }
  // 2. The edition must be readable as an edition before anything is decided about it.
  const variant: ContentVariant | null | undefined = input.variant;
  if (variant === undefined || variant === null) {
    return deny("unavailable");
  }
  const variantId = text(variant.variantId);
  const documentId = text(variant.documentId);
  const editionTag = text(variant.locale?.tag);
  if (variantId.length === 0 || documentId.length === 0 || editionTag.length === 0) {
    return deny("unavailable");
  }
  // 3. Which revision may be rendered, and under whose authority.
  const acknowledgedRevisionId = text(input.acknowledgement?.revisionId);
  const candidate: ContentCandidate | null | undefined = input.acknowledgement?.candidate;
  const isAuthor = input.isAuthor === true;
  const protectedEdition = variant.audience === "approved-supporter";
  // A protected edition is examined only by a reviewer holding a protected-content reader grant, or by the
  // author of the content itself, who authored what a grant would let them read.
  const reviewerAuthority = candidate !== undefined && candidate !== null && candidateIsCurrentFor(variant, candidate) && (!protectedEdition || input.canReadProtected === true || isAuthor);
  const releaseRecords: readonly Release[] | null | undefined = input.releases;
  const releases = releaseRecords === null || releaseRecords === undefined ? [] : releaseRecords.filter(isUsableRelease);
  const workingAuthority = isAuthor || reviewerAuthority;
  let admittedRevisionId: string | undefined;
  if (workingAuthority) {
    if (isAuthor && acknowledgedRevisionId.length > 0 && acknowledgedRevisionId === text(variant.draftRevisionId)) {
      admittedRevisionId = acknowledgedRevisionId;
    } else if (reviewerAuthority && candidate !== undefined && candidate !== null && acknowledgedRevisionId.length > 0 && acknowledgedRevisionId === text(candidate.revisionId)) {
      admittedRevisionId = acknowledgedRevisionId;
    }
  }
  // Working authority that does not admit the acknowledged revision falls through to the reading path instead of
  // refusing outright: the revision a surface acknowledges may be the edition's published one, which is read on
  // exactly the terms every other reader's read is decided on. That is still no history fallback — the reading
  // path serves a publication at the acknowledged revision, or nothing at all.
  let readingRefusal: PreviewDenialReason | undefined;
  if (admittedRevisionId === undefined) {
    const reading = admitReading({
      variantId,
      protectedEdition,
      canReadProtected: input.canReadProtected === true,
      isAuthor,
      acknowledgedRevisionId,
      releases,
    });
    if (reading.status === "admitted") {
      admittedRevisionId = reading.revisionId;
    } else {
      readingRefusal = reading.reason;
    }
  }
  if (admittedRevisionId === undefined) {
    // Withdrawal is a fact about the edition rather than about this principal, so it is answered as itself. Any
    // other refusal of a principal holding authority over the edition is about the revision it acknowledged: a
    // superseded draft, a replaced candidate and a restored-away revision all answer this way, and none of them
    // falls back to the current one.
    if (readingRefusal === "withdrawn") {
      return deny("withdrawn");
    }
    if (workingAuthority) {
      return deny("revision-not-acknowledged");
    }
    return deny(readingRefusal === undefined ? "not-authorised" : readingRefusal);
  }
  // 4. The locale, after authority, because choosing an edition is never choosing a permission. A blank request
  // asks for no other language, so the edition's own locale is served; any other tag is another edition's.
  const requestedLocale = text(input.requestedLocale);
  if (requestedLocale.length > 0 && !sameTag(requestedLocale, editionTag)) {
    return deny("locale-not-admitted");
  }
  // 5. Withdrawal wins over preview, for its author as much as for a reader.
  const headRelease = releases.filter((release) => text(release.releaseId) === text(variant.releaseHeadId))[0];
  if (headRelease !== undefined && isWithdrawn(headRelease)) {
    return deny("withdrawn");
  }
  return {
    status: "authorised",
    variantId,
    revisionId: admittedRevisionId,
    servedLocale: editionTag,
    direction: directionFor(variant.locale),
    renditionIds: admittedRenditionIds(input.renditionIds),
    inert: true,
    givingAction: "none",
  };
}
