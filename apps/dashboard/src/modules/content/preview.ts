/**
 * The one preview authorisation decision: whether this principal may render the revision it acknowledges of
 * this edition, which revision that is, and which renditions travel with the answer — exact, currently
 * authorised and inert.
 *
 * Plan items that put this file in scope:
 * - AAP 0.11.1, the seventh of the seven `apps/dashboard/src/modules/content/*` deliverables.
 * - AAP 0.6.1 "Content module" row: the content module owns preview, and its consumers are
 *   `data-service/reads/content.ts` (`readPreview`) and `data-service/reads/audience.ts`
 *   (`readReceivingPage`).
 * - AAP 0.8.6 preview rule, in full: preview is "exact, currently authorised and inert" across document,
 *   image, video, poster, caption and transcript requests, and "a copied URL or switched locale cannot grant
 *   access or fall through to another draft or release".
 * - AAP 0.3.2 security architecture and 0.6.3 thin route handlers: this module answers a decision, never a
 *   response. The route layer owns the status code, the redirect, the framework metadata object and the
 *   rendered page — which is why nothing here imports a framework, states a header or produces markup.
 * - Evidence: success criteria 12, 9 and 18 through `e2e/pages-release-withdraw.spec.ts`,
 *   `e2e/update-publication.spec.ts` and `e2e/video.spec.ts`, and the denial path of
 *   `tests/domain/scope-redaction.test.ts`.
 *
 * The gates run in one fixed order, and each is where it is because of what the gate before it makes safe:
 *
 * 1. A principal must be resolved. A preview is never anonymous, and no part of the request — a locale, a
 *    token, a cookie value, a query string — is ever consulted for authority. Everything this module learns
 *    about authority arrives already resolved by the data service for this principal and this edition:
 *    `isAuthor` is its answer about authoring authority over the variant's own document and source subject,
 *    and `canReadProtected` is its answer about a protected-content reader grant. A copied preview address
 *    re-enters this same decision, so copying it cannot grant anything its holder does not already hold.
 * 2. The variant handed in must be readable as a variant. A record with no identity or no readable locale
 *    cannot state what would be previewed, so it answers `unavailable` — a source failure reported honestly,
 *    rather than a denial that would misdescribe a damaged record as a permission decision.
 * 3. One revision is admitted, and only one. For the author of the edition it is the variant's current
 *    `draftRevisionId`; for a reviewer it is the revision the variant's frozen candidate froze. A superseded,
 *    restored-away or arbitrary historical revision answers `revision-not-acknowledged`: there is no
 *    "preview any revision" path and no revision-history fallback. A principal whose working authority does not
 *    admit the acknowledged revision — or who holds none over this edition — is offered the reading path
 *    instead: a publication of this edition, at exactly the revision the request acknowledges, that a reader in
 *    this audience may read. The publisher reading their own released edition is therefore served, while an
 *    arbitrary older draft is not.
 * 4. The locale must be the edition's own. A preview of one edition never serves another edition's content, so
 *    a request naming a different locale answers `locale-not-admitted` rather than being resolved to a
 *    fallback. Choosing among released editions is `locale.ts`'s job, performed before this decision, so a
 *    locale switch here can never become a way to reach another draft or another release.
 * 5. Withdrawal wins. The publication standing at the variant's head is consulted last: if it carries a
 *    withdrawal the answer is `withdrawn`, even for the author, because a withdrawn publication is not
 *    previewable — while an archived draft was never a publication and is not one. A `not-public` reach
 *    changes nothing for the author, because preview is exactly what it is for: reach decides what a route
 *    serves the public, and reach never substitutes for authorisation.
 *
 * Four properties hold of every answer:
 *
 * - A denial reveals nothing. `PreviewDenied` carries a status and a reason code and no other key, so no
 *   title, existence flag, revision count, audience name or hint that a draft exists can reach a caller from
 *   a refusal. The reason exists so the route layer can word its own honest, generic message, and the route
 *   layer never renders the code itself.
 * - The decision is inert by type. `inert: true` and `givingAction: "none"` are literal types, so no caller
 *   can render a live giving control from a preview decision; and this module performs no write, opens no
 *   transaction, sends nothing, subscribes nobody, publishes nothing and starts no checkout.
 * - Media is admitted in the same decision, never on its own. `renditionIds` are the identities the caller
 *   resolved for the pinned revision's placements, and they appear only in an authorised answer, so a denial
 *   carries no rendition at all. This is not a bearer grant: `modules/media/serve.ts` re-authorises every
 *   later play, poster, caption or transcript request, and an admitted rendition proves only that the
 *   revision may be rendered — never that any byte was delivered, played or read.
 * - Nothing is remembered. The function reads no clock, takes no randomness, performs no I/O, holds no
 *   module-level state and caches nothing, so the same input always yields an equal answer and a withdrawal or
 *   a restriction takes effect on the very next call.
 *
 * Layering: a framework-free domain module, importable by a Server Component, a Route Handler and a
 * Node-environment test alike. It imports the variant, candidate and release records from `variant.ts`, the
 * direct-link predicate from `reach.ts`, the direction vocabulary of `locale.ts`, and the rendition-purpose
 * type of `media/asset.ts`. It imports no store, no data service, no audience module, no media serving module,
 * no renderer, no feature, no component and no framework, so the service imports this module and never the
 * reverse.
 */
import { directionOfTag, type ContentLocale } from "@/modules/content/locale";
import { isDirectlyReadable } from "@/modules/content/reach";
import type {
  ContentCandidate,
  ContentVariant,
  Release,
  VariantLocale,
} from "@/modules/content/variant";
import type { MediaRenditionPurpose } from "@/modules/media/asset";

// ---------------------------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------------------------

/**
 * The six reasons a preview is refused, and the only ones: the route layer and the tests reference this list
 * instead of restating a literal.
 *
 * - `not-authorised` — this principal holds no authority over this edition: no authoring authority, no
 *   reviewer authority, and no publication a reader in its audience may read.
 * - `revision-not-acknowledged` — the acknowledged revision is not the one that may be rendered: not the
 *   current draft, not the frozen candidate, not the publication at this address, or already superseded.
 * - `locale-not-admitted` — the request names a locale this edition does not serve.
 * - `unreleased` — the edition's publication serves nobody by link, because its reach is Not public.
 * - `withdrawn` — the publication standing at the variant's head carries a withdrawal, so the edition is no
 *   longer previewable by anybody, its author included.
 * - `unavailable` — the record the decision would read cannot be read as that record.
 */
export const PREVIEW_DENIAL_REASONS = [
  "not-authorised",
  "revision-not-acknowledged",
  "locale-not-admitted",
  "unreleased",
  "withdrawn",
  "unavailable",
] as const;

/** One preview refusal, derived from {@link PREVIEW_DENIAL_REASONS} so a new member cannot appear alone. */
export type PreviewDenialReason = (typeof PREVIEW_DENIAL_REASONS)[number];

/**
 * The rendition purposes a preview admits, in the order a placement offers them: a still image carries
 * `display`, a video carries `playback` with its `poster`, `captions` and `transcript`.
 *
 * The caller resolves rendition identities for exactly these purposes of the pinned revision's placements, and
 * the decision admits all of them or none — there is deliberately no per-purpose preview decision, because a
 * caption or transcript address that could be admitted on its own would become a way to ask about a protected
 * video without opening it.
 */
export const PREVIEW_RENDITION_PURPOSES: readonly MediaRenditionPurpose[] = [
  "display",
  "playback",
  "poster",
  "captions",
  "transcript",
];

// ---------------------------------------------------------------------------------------------
// What a preview decision reads
// ---------------------------------------------------------------------------------------------

/**
 * Who is previewing: the principal identity the development session resolved, and nothing else.
 *
 * The identity is here so that a preview without one is refused structurally, and so a caller's own
 * diagnostics can name the actor. It carries no permission of its own — a principal id is not authority, and
 * two principals whose identifiers look alike remain two principals.
 */
export interface PreviewPrincipal {
  /** The acting principal's identity, as the session resolved it; a blank identity authorises nothing. */
  readonly principalId: string;
}

/**
 * What the previewing surface says it is showing: the exact revision it believes it is rendering, and — when
 * the preview answers a review step — the frozen candidate record that revision belongs to.
 *
 * The acknowledgement is a claim to be checked, never a permission: the decision compares it against the
 * variant's current draft and against the candidate the variant still holds, so a stale tab, an older draft or
 * a candidate that was replaced cannot become a preview of something else.
 */
export interface PreviewAcknowledgement {
  /** The exact revision the surface says it is rendering. */
  readonly revisionId: string;
  /**
   * The frozen candidate a reviewer is answering, when the preview comes from the review step. Its presence
   * is what makes reviewer authority available at all, and its `revisionId` is the revision that may be
   * rendered.
   */
  readonly candidate?: ContentCandidate;
}

/**
 * Everything one preview decision needs, every field already resolved server-side for this request alone.
 *
 * No field is authority by itself. `isAuthor` and `canReadProtected` are the service's resolved answers about
 * this principal, `releases` are the release records it resolved for this edition, and `renditionIds` are the
 * renditions it resolved for the pinned revision's placements — this module trusts none of them as a
 * permission statement it can skip a gate for, which is why each is checked against the records it belongs to.
 */
export interface PreviewInput {
  /** The principal the development session resolved. */
  readonly principal: PreviewPrincipal;
  /** The edition whose acknowledged revision is being previewed. */
  readonly variant: ContentVariant;
  /** The revision the surface says it is showing, and the candidate it answers when it is a review. */
  readonly acknowledgement: PreviewAcknowledgement;
  /** The BCP-47 tag the surface asked for; a blank value asks for the edition's own locale. */
  readonly requestedLocale: string;
  /** The release records the caller resolved for this edition, in any order. */
  readonly releases: readonly Release[];
  /** The rendition identities the caller resolved for the pinned revision's placements. */
  readonly renditionIds: readonly string[];
  /** Whether this principal holds a protected-content reader grant, resolved by the service. */
  readonly canReadProtected: boolean;
  /** Whether this principal holds authoring authority over the variant's document and source subject. */
  readonly isAuthor: boolean;
}

// ---------------------------------------------------------------------------------------------
// What a preview decision answers
// ---------------------------------------------------------------------------------------------

/**
 * A preview that may be rendered: the exact revision, the locale and direction it is read in, and the
 * renditions admitted with it.
 *
 * `inert` and `givingAction` are literals rather than booleans or strings, so the type itself states that a
 * preview can never carry a live effect: a caller cannot render a working giving control from this answer, and
 * no branch of this module can produce one.
 */
export interface PreviewAuthorised {
  /** The preview may be rendered. */
  readonly status: "authorised";
  /** The edition whose revision may be rendered. */
  readonly variantId: string;
  /** The exact revision that may be rendered — the revision that was acknowledged. */
  readonly revisionId: string;
  /** The BCP-47 tag the preview serves, which is the edition's own. */
  readonly servedLocale: string;
  /** The direction the served edition is authored and read in, taken from the edition and its tag. */
  readonly direction: ContentLocale["direction"];
  /** The rendition identities admitted with this preview, de-duplicated; empty when none resolved. */
  readonly renditionIds: readonly string[];
  /** Always true: a preview decision describes an inert surface and cannot describe anything else. */
  readonly inert: true;
  /** Always `none`: a preview never offers a live giving action, whatever Designation the document holds. */
  readonly givingAction: "none";
}

/**
 * A preview that may not be rendered: one reason code and nothing else.
 *
 * The absence of every other key is the contract, not an omission. No title, audience, locale, count, size or
 * existence flag travels with a refusal, so a caller cannot build a message — or a timing, or a status — that
 * tells a refused reader whether a draft exists at all.
 */
export interface PreviewDenied {
  /** The preview may not be rendered. */
  readonly status: "denied";
  /** Which gate refused it, for the route layer's own honest and generic message. */
  readonly reason: PreviewDenialReason;
}

/** Every answer a preview decision gives. A caller switches on `status`; these two cases are all of them. */
export type PreviewDecision = PreviewAuthorised | PreviewDenied;

// ---------------------------------------------------------------------------------------------
// Reading the records fail-closed
//
// Every helper here answers about the value it is given and holds nothing between calls, so a damaged record
// can only narrow what is admitted and never widen it.
// ---------------------------------------------------------------------------------------------

/** A string field read as trimmed text, so an absent or non-string value is blank rather than a guess. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The one refusal constructor, so every refusal is the same two-field shape. */
function deny(reason: PreviewDenialReason): PreviewDenied {
  return { status: "denied", reason };
}

/**
 * Whether an edition carries a withdrawal, in whichever form a stored record states the instant.
 *
 * Absent, `undefined` and `null` mean it still serves; a present instant or a stored string means it does not.
 * The value is read through `unknown` so a persisted record and a domain record answer the same way.
 */
function isWithdrawn(edition: { readonly withdrawnAt?: unknown }): boolean {
  const withdrawnAt: unknown = edition.withdrawnAt;
  return withdrawnAt !== undefined && withdrawnAt !== null;
}

/** Whether a release was replaced as its variant's head, which ends what it serves at its own address. */
function isSuperseded(release: Release): boolean {
  return text(release.supersededBy).length > 0;
}

/**
 * Whether a release record can be reasoned about at all: it needs its own identity, the edition it publishes
 * and the revision it published. A record missing any of the three is skipped rather than guessed at, so one
 * damaged release cannot authorise a read and cannot break a sibling that is intact.
 */
function isUsableRelease(candidate: Release | null | undefined): candidate is Release {
  if (candidate === undefined || candidate === null) {
    return false;
  }
  return (
    text(candidate.releaseId).length > 0 &&
    text(candidate.variantId).length > 0 &&
    text(candidate.revisionId).length > 0
  );
}

/**
 * Whether two BCP-47 tags name the same locale. Case carries no meaning in a language tag, so the comparison
 * folds case and trims; it deliberately does not fall back from `fr-CA` to `fr`, because that would serve a
 * different edition — rewriting a fallback is `locale.ts`'s job, before this decision, and never here.
 */
function sameTag(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The direction the served edition is read in: `rtl` when the edition declares it, and otherwise the direction
 * the tag itself states, from `locale.ts`. A record that declares nothing usable therefore states no direction
 * of its own and cannot contradict its tag.
 */
function directionFor(locale: VariantLocale | null | undefined): ContentLocale["direction"] {
  const declared: unknown = locale?.direction;
  return declared === "rtl" ? "rtl" : directionOfTag(text(locale?.tag));
}

/**
 * Whether a candidate is the one this variant is currently holding for review: the candidate the variant names,
 * the variant the candidate answers, and a frozen revision to render.
 *
 * A candidate that was replaced, that belongs to another edition or that names no revision is not this variant's
 * candidate, so reviewer authority cannot be claimed with a record the variant no longer holds.
 */
function candidateIsCurrentFor(variant: ContentVariant, candidate: ContentCandidate): boolean {
  const candidateId = text(variant.candidateId);
  return (
    candidateId.length > 0 &&
    text(candidate.candidateId) === candidateId &&
    text(candidate.variantId) === text(variant.variantId) &&
    text(candidate.revisionId).length > 0
  );
}

// ---------------------------------------------------------------------------------------------
// The reading path: a publication of this edition, at the revision a request acknowledges
// ---------------------------------------------------------------------------------------------

/** What the release records a decision reads, stated once so the reading path takes one argument. */
interface ReadingQuery {
  /** The edition whose publications are read. */
  readonly variantId: string;
  /** Whether the edition serves a protected audience, which a grant rather than reach governs. */
  readonly protectedEdition: boolean;
  /** Whether the principal holds a protected-content reader grant. */
  readonly canReadProtected: boolean;
  /** Whether the principal authored the content a grant would let them read. */
  readonly isAuthor: boolean;
  /** The exact revision the request acknowledges. */
  readonly acknowledgedRevisionId: string;
  /** The usable release records the caller resolved for this edition. */
  readonly releases: readonly Release[];
}

/** What the reading path admits: the revision it serves, or the reason nothing serves. */
type ReadingAdmission =
  | { readonly status: "admitted"; readonly revisionId: string }
  | { readonly status: "refused"; readonly reason: PreviewDenialReason };

/**
 * Whether a publication of this edition may serve the request, and which revision it serves.
 *
 * The gates are the reading half of the decision: a publication of this edition must exist at all, a protected
 * edition needs a grant (or its own author), the acknowledged revision must be the one that publication
 * published and must not have been superseded, the publication must not have been withdrawn, and a public
 * edition must still be directly readable rather than set to Not public. Every step refuses by name so the
 * caller can word one honest message, and no step enumerates anything a refusal would then have to hide.
 */
function admitReading(query: ReadingQuery): ReadingAdmission {
  const editionReleases = query.releases.filter(
    (release) => text(release.variantId) === query.variantId,
  );
  if (editionReleases.length === 0) {
    return { status: "refused", reason: "not-authorised" };
  }
  if (query.protectedEdition && query.canReadProtected !== true && !query.isAuthor) {
    return { status: "refused", reason: "not-authorised" };
  }
  const published = editionReleases.filter(
    (release) =>
      text(release.revisionId) === query.acknowledgedRevisionId && !isSuperseded(release),
  )[0];
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

/** The rendition identities admitted with one preview: trimmed, in the caller's order, without repetitions. */
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

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

/**
 * Decides one preview: whether the acknowledged revision of this edition may be rendered by this principal, and
 * what that answer admits.
 *
 * It answers `authorised` with the revision, the served locale and its direction, the admitted rendition
 * identities and the literal `inert: true` / `givingAction: "none"`; or `denied` with one of
 * {@link PREVIEW_DENIAL_REASONS} and nothing else. The gates, and why each precedes the next, are described at
 * the top of this module; nothing here reads a clock, writes anything, sends anything or remembers an answer.
 */
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
  const reviewerAuthority =
    candidate !== undefined &&
    candidate !== null &&
    candidateIsCurrentFor(variant, candidate) &&
    (!protectedEdition || input.canReadProtected === true || isAuthor);

  const releaseRecords: readonly Release[] | null | undefined = input.releases;
  const releases =
    releaseRecords === null || releaseRecords === undefined
      ? []
      : releaseRecords.filter(isUsableRelease);
  const workingAuthority = isAuthor || reviewerAuthority;
  let admittedRevisionId: string | undefined;

  if (workingAuthority) {
    if (
      isAuthor &&
      acknowledgedRevisionId.length > 0 &&
      acknowledgedRevisionId === text(variant.draftRevisionId)
    ) {
      admittedRevisionId = acknowledgedRevisionId;
    } else if (
      reviewerAuthority &&
      candidate !== undefined &&
      candidate !== null &&
      acknowledgedRevisionId.length > 0 &&
      acknowledgedRevisionId === text(candidate.revisionId)
    ) {
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
  const headRelease = releases.filter(
    (release) => text(release.releaseId) === text(variant.releaseHeadId),
  )[0];
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
