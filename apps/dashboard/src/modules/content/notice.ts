/**
 * The notification notice: which single rendition an already-eligible recipient is pinned to, and what
 * the message that points at it may say.
 *
 * Plan items that put this file in scope:
 * - AAP 0.3.4 "Notice recipient and rendition resolution": one module resolves the rendition and one
 *   builds the message, consumed by *Publish and notify now*, the delivery results and the synthetic
 *   inbox.
 * - AAP 0.6.1's content-module row fixes both exported names, `resolveRendition()` and
 *   `buildNotice()`; AAP 0.11.1 lists this file among the content module's seven.
 * - AAP 0.8.5 notice rules, which are the whole of the contract held here: a protected notice is a
 *   minimal link-only message with a safe sender, subject and wording, and it carries no protected
 *   prose, image, location, poster, transcript, caption or hidden alternative; opening the link
 *   rechecks current access; a public video notice may carry an admitted safe poster and a link and
 *   never an embedded player, autoplay or attachment; each eligible recipient receives exactly one
 *   pinned rendition, even when admitted to two audiences or two languages; a late signup never
 *   expands an accepted ceiling; an `unknown` outcome offers recovery rather than a second attempt.
 *
 * What this file owns is exactly two decisions: which one rendition a recipient receives, resolved
 * once and then pinned, and what the message contains. What it does not own is everything around
 * them, and each omission is deliberate:
 *
 * - Eligibility. Who may receive a notice — membership state, consent per publisher and purpose, the
 *   acknowledgement ceiling, the dedupe key and the 24-hour usefulness window — belongs to
 *   `modules/audience`, which hands this module a recipient it has already admitted. This module reads
 *   no membership, defines no dedupe identity, submits nothing again and decides nothing about who is
 *   eligible: a second owner of that decision is the duplicate state ownership the whole architecture
 *   rules out.
 * - Publication and reach. Which releases exist, which is a variant's head and what a reach value
 *   permits are `variant.ts` and `reach.ts`'s answers; the caller states the candidates, and this
 *   module only chooses among them.
 * - Locale fallback. The three-step language preference is applied here over the candidate set in the
 *   order `locale.ts` fixes for a reader's edition. `resolveLocale()` itself is not called, because it
 *   resolves one *document's* admitted releases for one audience and therefore requires the
 *   `ContentDocument` identity this function is never given; the tag's own meaning — which direction a
 *   language reads in — is `directionOfTag()`'s, so that is imported rather than restated.
 * - Transport and outcome. This module produces a message string and never a claim about it. Whether
 *   a notice was submitted, accepted, delivered or read are four further facts owned by the audience
 *   module and the data service; nothing returned here can mean any of them, and no send state is
 *   held.
 *
 * Five properties are held by construction rather than by review:
 *
 * - One rendition, deterministically. The tie-break is stated once, in `resolveRendition()`'s order:
 *   the most specific admitted audience first, then the recipient's language, then the most recent
 *   publication, then the variant identity. The result is one `PinnedRendition` or one refusal — never
 *   an array, never "the first match" and never two copies for two audiences.
 * - Pinned at request time. `buildNotice()` receives the pin and never re-resolves it, so a later
 *   unsubscribe, a later restriction or a later language change cannot substitute the copy of an
 *   intent that was already accepted.
 * - Link-only. The body is a short generic sentence and a link to the application's own receiving
 *   route. The builder is never given a title, a body or a summary, so it cannot disclose one; the
 *   link is checked to be a same-origin path with no query and no fragment, so nothing per-recipient
 *   can travel in it and the message grants nothing on its own.
 * - No clock, no randomness, no I/O. Nothing here reads `now`, generates an identifier or touches a
 *   network: the same input always produces the same pin and the same message, which is what makes a
 *   replay comparable. Every boundary that depends on time (24 hours of usefulness, 168 hours of
 *   confirmation) is evaluated by `time/window.ts` at read or command time, not here.
 * - No secret and no original. The notice carries no provider credential, no recipient token, no media
 *   byte, no filename and no original URL: a rendition is named by an application path the media route
 *   re-authorises on every request, byte ranges included.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. It
 * imports the content profile's locale and reach rules, the one HTML escaper of `modules/content`, the
 * variant and release vocabulary, and the media module's rendition-purpose union as a type. It
 * imports no store, no data service, no audience module (which imports this folder — the reverse edge
 * would close a cycle), no feature, no component, no framework and no provider client.
 */
import { Temporal } from "temporal-polyfill";

import { isNonEmptyString } from "@/lib/guards";
import { directionOfTag } from "@/modules/content/locale";
import { isDirectlyReadable, type ReachableEdition } from "@/modules/content/reach";
import { escapeHtml, isolateValue } from "@/modules/content/render";
import {
  VARIANT_AUDIENCES,
  type VariantAudience,
  type VariantLocale,
} from "@/modules/content/variant";
import type { MediaRenditionPurpose } from "@/modules/media/asset";

// ---------------------------------------------------------------------------------------------
// The recipient, the candidate and the poster a notice may carry
// ---------------------------------------------------------------------------------------------

/**
 * One recipient a notice may be produced for, as the audience module admitted them.
 *
 * `admittedAudiences` is the audience set the authorisation service decided for this person at this
 * read, not a claim the recipient makes and not something this module derives from a contact record, a
 * gift or an address being present: protected reading is a grant, and being subscribed to a publisher's
 * updates never establishes it. `languagePreference` is the language they read in, which is separate
 * from their consent and from any proof of the address.
 */
export interface NoticeRecipient {
  /** The person's own identifier inside the scope; an equal-looking address or name is never this. */
  readonly recipientId: string;
  /** The audiences the person is admitted to at this read; an empty set admits no edition. */
  readonly admittedAudiences: readonly VariantAudience[];
  /** The BCP-47 tag the person reads in, when the membership records one. */
  readonly languagePreference?: string;
}

/**
 * The poster of a public video placement, with the evidence that admits it in a notice.
 *
 * A notice may carry a poster only when all four facts hold: the pinned edition is `public`, the
 * poster rendition is admitted for public reading, the release that places it is at least directly
 * readable, and the poster belongs to the same release as the pinned copy. A poster is a still, never
 * a player: the notice names it as an image and links to the edition, so it embeds nothing, autoplays
 * nothing and attaches nothing.
 */
export interface NoticeVideoPoster {
  /** The release that places this poster; it must be the release the notice pins. */
  readonly releaseId: string;
  /** The rendition's own identity in `modules/media`; the notice never reads its bytes. */
  readonly renditionId: string;
  /** The purpose the rendition serves; only a `poster` may stand in a notice. */
  readonly purpose: MediaRenditionPurpose;
  /** The application path that serves the poster, re-authorised on every request. */
  readonly path: string;
  /** Whether the asset's scope admits public reading, decided by the media module. */
  readonly admittedPublic: boolean;
  /** The reach and withdrawal of the release placing it, so readability is evidence rather than trust. */
  readonly release: ReachableEdition;
}

/**
 * One rendition a recipient could be given: an admitted, non-withdrawn release of one variant, as the
 * caller enumerated it for one publication intent.
 *
 * The caller owns publication, reach and identity; this module never decides what was published. The
 * locale travels whole rather than as a bare tag, because a pin states the edition's tag and the
 * direction it reads in. `contentChecksum` is the revision's change-detection digest, computed by
 * `revisionChecksum()` when the revision was written, so the pin carries an identity that a replay can
 * compare without reading the content.
 */
export interface RenditionCandidate {
  /** The variant this release publishes. */
  readonly variantId: string;
  /** The release itself; the identity a pin records and a replay compares. */
  readonly releaseId: string;
  /** The exact revision published, so a pin names the copy rather than the variant's current state. */
  readonly revisionId: string;
  /** The audience the release serves; a recipient must be admitted to it to be pinned to it. */
  readonly audience: VariantAudience;
  /** The exact content locale of the release. */
  readonly locale: VariantLocale;
  /** The publication instant, in the record's form or the stored one, which orders two candidates. */
  readonly publishedAt: Temporal.Instant | string;
  /** The published revision's change-detection digest, carried through to the pin. */
  readonly contentChecksum: string;
  /** The display rendition a reader would be served, when the edition has one. */
  readonly renditionId?: string;
  /** The instant the release was withdrawn, in whichever form the caller stores it. */
  readonly withdrawnAt?: Temporal.Instant | string | null;
  /** The poster of a video placement in this release, when the caller holds its evidence. */
  readonly videoPoster?: NoticeVideoPoster;
}

/**
 * The one rendition a recipient is pinned to: the identity a caller stores on the send record.
 *
 * Storing it is what keeps a later restriction, a later signup or a replay from silently substituting
 * a different copy. The pin states no recipient, no send outcome and no instant: it is the copy's
 * identity, and the caller holds it against the person and the notification intent it belongs to.
 */
export interface PinnedRendition {
  /** The pinned variant. */
  readonly variantId: string;
  /** The pinned release. */
  readonly releaseId: string;
  /** The pinned revision, so a later revision of the same variant is not this copy. */
  readonly revisionId: string;
  /** The audience this copy serves. */
  readonly audience: VariantAudience;
  /** The exact locale of this copy, whose direction follows from its tag. */
  readonly locale: VariantLocale;
  /** The display rendition of this copy, when the edition has one. */
  readonly renditionId?: string;
  /** The published revision's change-detection digest, so an unchanged copy is a comparison. */
  readonly checksum: string;
}

/**
 * Why a recipient could not be pinned to any rendition. Each reason is a different fact, and the
 * delivery surface states which one it received rather than collapsing them into "no message":
 *
 * - `no-candidates` — the caller offered nothing for this intent.
 * - `no-readable-edition` — everything offered was withdrawn, or named no usable edition.
 * - `audience-not-admitted` — readable editions exist, but none serves an audience this person holds.
 *
 * There is deliberately no "language unavailable" member: the language preference orders the
 * candidates of the audience this person is admitted to, it never removes them, so a copy in another
 * language is still the copy of this intent — and the pin records that language, which is how the
 * surface states the one it served instead of implying the preference was met.
 */
export const RENDITION_REFUSAL_REASONS = [
  "no-candidates",
  "no-readable-edition",
  "audience-not-admitted",
] as const;

/** One refusal reason, derived from {@link RENDITION_REFUSAL_REASONS}. */
export type RenditionRefusalReason = (typeof RENDITION_REFUSAL_REASONS)[number];

/**
 * The answer one pinning question gives: exactly one pin with the poster the message may carry, or one
 * refusal with its reason. There is no third shape, no array and no null — a caller handed two
 * renditions would have two copies to send, which is the defect this shape prevents.
 */
export type NoticeRenditionResolution =
  | {
      /** One rendition was pinned for this recipient. */
      readonly status: "pinned";
      /** The copy the caller stores on the send record. */
      readonly rendition: PinnedRendition;
      /** The admitted public poster the message may carry, absent unless every condition holds. */
      readonly videoPoster?: NoticeVideoPoster;
    }
  | {
      /** No rendition can be pinned, and the reason says which fact refused it. */
      readonly status: "no-eligible-rendition";
      /** The one reason this recipient receives nothing. */
      readonly reason: RenditionRefusalReason;
    };

/** Everything one pinning question needs: the admitted recipient, the candidates and the Site default. */
export interface ResolveRenditionInput {
  /** The recipient the audience module already admitted, with the language they read in. */
  readonly recipient: NoticeRecipient;
  /** The admitted, published releases of this publication intent, in any order. */
  readonly candidates: readonly RenditionCandidate[];
  /** The BCP-47 tag of the Site's declared default edition, or a blank string when it declares none. */
  readonly siteDefaultLocale: string;
}

// ---------------------------------------------------------------------------------------------
// Guards: one identity stated, one instant read, one tag compared
// ---------------------------------------------------------------------------------------------

/**
 * How specific each admitted audience is, lower being more specific. Declared as a total record over
 * the closed audience union, so a third audience fails to compile here and forces a precedence
 * decision instead of silently landing on the `public` rank.
 */
const AUDIENCE_SPECIFICITY: Record<VariantAudience, number> = {
  "approved-supporter": 0,
  public: 1,
};

/**
 * The audiences a pin tries, most specific first, derived from the variant module's own tuple so this
 * is an order over the declared vocabulary rather than a second list of it. The sort is stable, so two
 * audiences that ever shared a rank would still resolve in declaration order.
 */
const AUDIENCE_ORDER: readonly VariantAudience[] = [...VARIANT_AUDIENCES].sort(
  (left, right) => AUDIENCE_SPECIFICITY[left] - AUDIENCE_SPECIFICITY[right],
);

/** Reads one identity: the trimmed value, or `undefined` when it names nothing. */
function identityOf(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Reads one publication instant, from the record's own form or from the string a stored document
 * carries, and answers `undefined` when the value states no instant this module can order by.
 */
function instantOf(value: Temporal.Instant | string): Temporal.Instant | undefined {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * The form a tag is compared by: trimmed and case-folded, because case carries no meaning in BCP-47,
 * so `fr-ca`, `FR-CA` and `fr-CA` are one locale. The tag's own validity was established when the
 * edition was created, so nothing here re-parses it; the tag's *meaning* — which direction a language
 * reads in — is `locale.ts`'s answer, reached through `directionOfTag()`.
 */
function comparableTag(value: unknown): string | undefined {
  return identityOf(value)?.toLowerCase();
}

/** The primary language of a comparable tag: its first subtag. */
function primaryLanguage(comparable: string): string {
  const [language] = comparable.split("-");
  return language ?? comparable;
}

/** Whether a release states a withdrawal, in whichever form the caller stores the instant. */
function isWithdrawn(candidate: RenditionCandidate): boolean {
  const withdrawnAt: unknown = candidate.withdrawnAt;
  return withdrawnAt !== undefined && withdrawnAt !== null;
}

/** Compares two identifiers by UTF-16 code unit: the same order on every host and in every language. */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The locale tag one candidate states, read defensively: a candidate read back from JSON can lose its
 * locale entirely, and a record that states no tag names no edition rather than one this module would
 * have to guess at.
 */
function statedTagOf(candidate: RenditionCandidate): unknown {
  const locale: unknown = candidate.locale;
  if (typeof locale !== "object" || locale === null) {
    return undefined;
  }
  return (locale as { readonly tag?: unknown }).tag;
}

// ---------------------------------------------------------------------------------------------
// The candidates a pin may be chosen from
// ---------------------------------------------------------------------------------------------

/** One candidate that names a usable edition, with the facts a pin and an ordering read from it. */
interface ReadableCandidate {
  /** The candidate exactly as the caller handed it in. */
  readonly candidate: RenditionCandidate;
  /** The tag in the form the language preference compares by. */
  readonly tag: string;
  /** The primary language of that tag. */
  readonly language: string;
  /** The publication instant this candidate is ordered by. */
  readonly publishedAt: Temporal.Instant;
}

/**
 * The candidates that name a usable edition, in the order they were handed in, with two entries naming
 * the same release counted once.
 *
 * A candidate names an edition when it states every identity a pin records — the variant, the release,
 * the revision and the revision's digest — a readable locale tag and a publication instant, and when
 * the release is not withdrawn, because a withdrawn edition receives no notice. Everything else is
 * refused here rather than by a caller, so no later step can pin an edition that states no copy.
 */
function readableCandidates(candidates: readonly RenditionCandidate[]): ReadableCandidate[] {
  const seenReleases = new Set<string>();
  const readable: ReadableCandidate[] = [];
  for (const candidate of candidates) {
    const releaseId = identityOf(candidate.releaseId);
    if (
      releaseId === undefined ||
      identityOf(candidate.variantId) === undefined ||
      identityOf(candidate.revisionId) === undefined ||
      identityOf(candidate.contentChecksum) === undefined
    ) {
      continue;
    }
    if (isWithdrawn(candidate) || seenReleases.has(releaseId)) {
      continue;
    }
    const tag = comparableTag(statedTagOf(candidate));
    const publishedAt = instantOf(candidate.publishedAt);
    if (tag === undefined || publishedAt === undefined) {
      continue;
    }
    seenReleases.add(releaseId);
    readable.push({ candidate, tag, language: primaryLanguage(tag), publishedAt });
  }
  return readable;
}

/**
 * Orders two candidates of one language step: the most recent publication first, then the variant
 * identity ascending, then the release identity ascending.
 *
 * Identities are compared by code unit rather than by a locale-aware collation, so the order is the
 * same on every host and in every interface language, and the final release comparison makes the order
 * total, so two candidates sharing a variant and an instant still resolve the same way twice.
 */
function comparePreference(left: ReadableCandidate, right: ReadableCandidate): number {
  const byPublication = Temporal.Instant.compare(right.publishedAt, left.publishedAt);
  if (byPublication !== 0) {
    return byPublication;
  }
  const byVariant = compareCodeUnits(left.candidate.variantId, right.candidate.variantId);
  if (byVariant !== 0) {
    return byVariant;
  }
  return compareCodeUnits(left.candidate.releaseId, right.candidate.releaseId);
}

/**
 * How near one candidate is to the language the person reads, lower being nearer: `0` for the exact
 * tag, `1` for the same primary language, `2` for the Site's declared default edition, and `3` for
 * anything else.
 *
 * It is a rank rather than a filter on purpose. The copy of an intent has to be one the recipient is
 * admitted to, and a copy in another language is still that copy — so an unreadable-language edition
 * is served last, with the language it actually is recorded on the pin, instead of nothing being sent.
 */
function languageRank(
  entry: ReadableCandidate,
  preference: string | undefined,
  siteDefault: string | undefined,
): number {
  if (preference !== undefined) {
    if (entry.tag === preference) {
      return 0;
    }
    if (entry.language === primaryLanguage(preference)) {
      return 1;
    }
  }
  if (siteDefault !== undefined && entry.tag === siteDefault) {
    return 2;
  }
  return 3;
}

/**
 * The candidate one audience group serves this recipient: nearest in their language, then the most
 * recent publication, then the variant and release identities.
 *
 * The group is never emptied by the language preference, so a group that holds any readable candidate
 * always answers with one and the caller always has exactly one rendition to pin.
 */
function chooseInGroup(
  group: readonly ReadableCandidate[],
  preference: string | undefined,
  siteDefault: string | undefined,
): ReadableCandidate | undefined {
  const ranked = group
    .map((entry) => ({ entry, rank: languageRank(entry, preference, siteDefault) }))
    .sort((left, right) => left.rank - right.rank || comparePreference(left.entry, right.entry));
  return ranked[0]?.entry;
}

/** The audiences this recipient holds, narrowed to the closed vocabulary so a junk value admits nothing. */
function admittedAudiencesOf(recipient: NoticeRecipient): ReadonlySet<VariantAudience> {
  const admitted = new Set<VariantAudience>();
  const stated: unknown = recipient.admittedAudiences;
  if (!Array.isArray(stated)) {
    return admitted;
  }
  for (const value of stated) {
    const audience = VARIANT_AUDIENCES.find((candidate) => candidate === value);
    if (audience !== undefined) {
      admitted.add(audience);
    }
  }
  return admitted;
}

/**
 * The poster the notice may carry for one pinned candidate, or `undefined` when any of its conditions
 * fails: the copy must be `public`, the rendition must be a poster admitted for public reading, and the
 * release placing it must be at least directly readable. The poster must also belong to the release
 * being pinned, so a poster of another edition can never travel with this copy.
 *
 * A poster is a still of a video, never the video: this returns a path to one image, and the message
 * builder embeds no player, no autoplay and no attachment — and for a protected copy it returns
 * nothing at all, because a protected notice carries no media.
 */
function admittedPoster(candidate: RenditionCandidate): NoticeVideoPoster | undefined {
  if (candidate.audience !== "public") {
    return undefined;
  }
  const poster = candidate.videoPoster;
  if (poster === undefined || poster.purpose !== "poster" || !poster.admittedPublic) {
    return undefined;
  }
  if (identityOf(poster.releaseId) !== identityOf(candidate.releaseId)) {
    return undefined;
  }
  if (!isDirectlyReadable(poster.release)) {
    return undefined;
  }
  return poster;
}

// ---------------------------------------------------------------------------------------------
// The pin: one candidate in, one identity out
// ---------------------------------------------------------------------------------------------

/**
 * Pins one candidate: its identity as the record a caller stores on the send and compares on a replay,
 * or `undefined` when the candidate names no usable edition.
 *
 * The locale's direction is derived from its tag rather than copied from the record, so the identity is
 * reproducible from the tag alone: two copies whose tags agree are the same copy even when one record
 * states no direction. Nothing is re-resolved here, so a caller that pins at request time and a caller
 * that reads the pin back later hold the same identity.
 */
export function pinRendition(candidate: RenditionCandidate): PinnedRendition | undefined {
  const variantId = identityOf(candidate.variantId);
  const releaseId = identityOf(candidate.releaseId);
  const revisionId = identityOf(candidate.revisionId);
  const checksum = identityOf(candidate.contentChecksum);
  const tag = identityOf(statedTagOf(candidate));
  const audience = VARIANT_AUDIENCES.find((value) => value === candidate.audience);
  if (
    variantId === undefined ||
    releaseId === undefined ||
    revisionId === undefined ||
    checksum === undefined ||
    tag === undefined ||
    audience === undefined
  ) {
    return undefined;
  }
  return {
    variantId,
    releaseId,
    revisionId,
    audience,
    locale: { tag, direction: directionOfTag(tag) },
    renditionId: identityOf(candidate.renditionId),
    checksum,
  };
}

// ---------------------------------------------------------------------------------------------
// Resolution: exactly one rendition for one admitted recipient
// ---------------------------------------------------------------------------------------------

/**
 * Resolves the one rendition an already-eligible recipient receives, and the poster the message may
 * carry with it.
 *
 * The order is fixed and total, so the same inputs always pin the same copy:
 *
 * 1. the most specific audience the recipient is admitted to, `approved-supporter` before `public`, so
 *    a protected reader never receives the public copy in its place or as well;
 * 2. within that audience, the recipient's language preference — the exact tag, then the same primary
 *    language, then the Site's declared default edition, and only then a copy in another language,
 *    because a copy this person is admitted to is still the copy of this intent and the pin records the
 *    language actually served;
 * 3. then the most recent publication;
 * 4. then the variant identity ascending, and the release identity for two copies that still tie.
 *
 * Exactly one rendition comes back: never two for two audiences, never two for two languages, never
 * "the first match" of an unordered list. A recipient nothing can serve receives one of
 * {@link RENDITION_REFUSAL_REASONS} rather than an empty list, because "nothing was offered" and
 * "everything offered is another audience's" are different facts for the delivery surface to state.
 *
 * The result is a function of its input alone. No clock is read, so a recipient whose restriction
 * arrives with the next read is excluded by the caller's next eligibility question rather than by a
 * timer here; no identifier is generated, so a pin is comparable by identity; and no candidate is
 * re-read, so the copy a send record was created with stays the copy it names.
 */
export function resolveRendition(input: ResolveRenditionInput): NoticeRenditionResolution {
  const { recipient, candidates, siteDefaultLocale } = input;

  if (candidates.length === 0) {
    return { status: "no-eligible-rendition", reason: "no-candidates" };
  }

  const readable = readableCandidates(candidates);
  if (readable.length === 0) {
    return { status: "no-eligible-rendition", reason: "no-readable-edition" };
  }

  const admitted = admittedAudiencesOf(recipient);
  const served = readable.filter((entry) => admitted.has(entry.candidate.audience));
  if (served.length === 0) {
    return { status: "no-eligible-rendition", reason: "audience-not-admitted" };
  }

  const preference = comparableTag(recipient.languagePreference);
  const siteDefault = comparableTag(siteDefaultLocale);

  for (const audience of AUDIENCE_ORDER) {
    const group = served.filter((entry) => entry.candidate.audience === audience);
    if (group.length === 0) {
      continue;
    }
    const chosen = chooseInGroup(group, preference, siteDefault);
    if (chosen === undefined) {
      continue;
    }
    const rendition = pinRendition(chosen.candidate);
    if (rendition === undefined) {
      continue;
    }
    const videoPoster = admittedPoster(chosen.candidate);
    return videoPoster === undefined
      ? { status: "pinned", rendition }
      : { status: "pinned", rendition, videoPoster };
  }

  // Unreachable: a non-empty admitted set always has a group, and every candidate in it already proved
  // the identities `pinRendition` re-checks. Stated so the return is total under
  // `noUncheckedIndexedAccess` instead of asserting a value the guards above proved.
  return { status: "no-eligible-rendition", reason: "no-readable-edition" };
}

// ---------------------------------------------------------------------------------------------
// The message: a minimal, link-only notice
// ---------------------------------------------------------------------------------------------

/**
 * The publisher a notice speaks for: the ministry identity whose updates the recipient asked to hear
 * about.
 *
 * It is stated by the caller and never derived here, and it is the one publisher fact the message may
 * name. The object is deliberately a record with a named field rather than a bare string, because a
 * later owner attaches a publisher identity behind the same seam without changing a call site.
 */
export interface NoticePublisher {
  /** The publisher's display name as the recipient knows it; the only publisher fact the message states. */
  readonly displayName: string;
}

/**
 * The sender a notice is produced from: the publisher's own configured sending identity.
 *
 * A sender is never the recipient's address, never a second publisher's and never derived from a
 * message field; a notice that appeared to come from someone else would be a defect of this boundary.
 * The notice carries the pair as one line and nothing of it is used as a key.
 */
export interface NoticeSender {
  /** The display name of the sending identity. */
  readonly name: string;
  /** The address of the sending identity, which must be the publisher's own. */
  readonly address: string;
}

/**
 * Everything one notice is built from: the pinned copy, the publisher and sender it speaks for, the
 * receiving link and, for a public video placement, the admitted poster.
 *
 * The pinned rendition is an input rather than something re-resolved here, which is what keeps an
 * accepted or uncertain copy on the edition it was accepted with. `purpose` is the audience purpose
 * this notice serves, carried so the message says why it was sent; this module keeps no vocabulary of
 * purposes and states an unknown one in generic words instead of guessing.
 */
export interface NoticeInput {
  /** The publisher the notice speaks for. */
  readonly publisher: NoticePublisher;
  /** The audience purpose this notice serves, as the audience module names it. */
  readonly purpose: string;
  /** The rendition this recipient was pinned to; never re-resolved here. */
  readonly pinned: PinnedRendition;
  /** The publisher's own configured sending identity. */
  readonly sender: NoticeSender;
  /** The application's receiving route for the pinned edition, with no per-recipient detail in it. */
  readonly link: string;
  /** The poster the pin admitted for a public video placement, when there is one. */
  readonly videoPoster?: NoticeVideoPoster;
}

/**
 * The message a recipient is sent: who it is from, what it says, and the copy it points at.
 *
 * `htmlBody` is a string this module returns and never injects; `textBody` is a real rendering of the
 * same wording rather than a note about the HTML, so a reader who takes only the text view loses
 * nothing. `pinned` is the identity of the copy the message points at, carried on the notice so the
 * send record and the inbox can state which edition a message pinned rather than assuming it.
 */
export interface Notice {
  /** The sender line, as `Name <address>` or whichever of the two the caller stated usable. */
  readonly sender: string;
  /** The generic subject, naming the publisher and never a protected edition's title. */
  readonly subject: string;
  /** The plain-text rendering of the message. */
  readonly textBody: string;
  /** The HTML rendering of the same wording, with no protected artefact in it. */
  readonly htmlBody: string;
  /** The receiving path the message points at, or a blank string when the caller's link was unusable. */
  readonly link: string;
  /** The pinned copy this message is about. */
  readonly pinned: PinnedRendition;
}

/** The fixed wording of the message. One declaration, so the text and HTML renderings cannot diverge. */
const NOTICE_COPY = {
  subjectLead: "New update from",
  anonymousSubject: "New update",
  publicLead: "has published an update.",
  protectedLead: "has published an update for approved supporters.",
  anonymousPublicLead: "An update has been published.",
  anonymousProtectedLead: "An update has been published for approved supporters.",
  linkLabel: "Open the update",
  noLink: "Open the application to read the update.",
  signIn: "Opening the link checks that you are signed in.",
  preferences: "You can turn these notices off in your notification preferences.",
} as const;

/**
 * How the one purpose this application notifies for is named in the message, keyed by the identifier
 * the audience module uses. It is a wording table rather than a vocabulary: this module owns no set of
 * purposes, and a purpose it does not name is stated in generic words instead of being printed raw.
 */
const PURPOSE_PHRASES: Readonly<Record<string, string>> = {
  "update-email": "updates by email",
};

/** What an unnamed purpose is called in the message. */
const DEFAULT_PURPOSE_PHRASE = "notices";

/** The HTML language of the fixed wording, so a reader's assistive technology pronounces it correctly. */
const NOTICE_LANGUAGE = "en";

/** The direction the fixed wording reads in; a publisher name of another direction is isolated inline. */
const NOTICE_DIRECTION = "ltr";

/** Renders one interpolated value, and one receiving link, for a given body format. */
interface NoticePresenters {
  /** Renders a value of unknown direction inside a sentence. */
  readonly value: (text: string) => string;
  /** Renders the receiving path as a sentence fragment. */
  readonly link: (path: string) => string;
  /** Renders the admitted poster as its own paragraph, where the format has one. */
  readonly image?: (path: string) => string;
}

/** The plain-text presenters: values stand as they are, and the link is stated as an address. */
const TEXT_PRESENTERS: NoticePresenters = {
  value: (text) => text,
  link: (path) => `${NOTICE_COPY.linkLabel}: ${path}`,
};

/** The HTML presenters: every value is isolated and escaped, and the link is a real anchor. */
const HTML_PRESENTERS: NoticePresenters = {
  value: isolateValue,
  link: (path) => `<a href="${escapeHtml(path)}">${NOTICE_COPY.linkLabel}</a>`,
  image: (path) => `<img src="${escapeHtml(path)}" alt="" />`,
};

/**
 * Whether one character is a space or a control character, and so never allowed inside a single-line
 * value or a receiving path. Written as a code-point test rather than a regular-expression range so the
 * intent is legible: the characters being excluded are exactly the ones that would break a line or a
 * header apart.
 */
function isControlOrSpace(codePoint: number): boolean {
  return codePoint <= 0x20 || codePoint === 0x7f;
}

/** Whether a value holds a space or a control character anywhere. */
function hasControlOrSpace(value: string): boolean {
  for (const character of value) {
    if (isControlOrSpace(character.codePointAt(0) ?? 0)) {
      return true;
    }
  }
  return false;
}

/**
 * Reads one value as a single line: control characters become spaces, runs of whitespace collapse and
 * the result is trimmed, so a value can never break out of the line it stands on — a subject or a
 * sender line assembled from stored text cannot be split by an embedded newline. A value that states
 * nothing answers `undefined` rather than an empty string.
 */
function singleLine(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  let flattened = "";
  for (const character of value) {
    flattened += isControlOrSpace(character.codePointAt(0) ?? 0) ? " " : character;
  }
  const collapsed = flattened.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? undefined : collapsed;
}

/**
 * Reads one sending address, answering `undefined` unless it can stand in a sender line: it must be a
 * single line, hold exactly one `@` with text on both sides and carry none of the display-name
 * punctuation that would let it restructure the line around it.
 */
function addressOf(value: unknown): string | undefined {
  const address = singleLine(value);
  if (address === undefined) {
    return undefined;
  }
  if (address.includes("<") || address.includes(">") || address.includes(",")) {
    return undefined;
  }
  if (address.includes(";")) {
    return undefined;
  }
  const at = address.indexOf("@");
  if (at < 1 || at === address.length - 1) {
    return undefined;
  }
  return address.indexOf("@", at + 1) === -1 ? address : undefined;
}

/**
 * The sender line one notice carries: `Name <address>` when both parts are usable, whichever part is
 * usable otherwise, and a blank line when neither is.
 *
 * Nothing is repaired here. A blank or unusable sender is a configuration fault at the boundary that
 * owns the sending identity, and inventing a name or an address here would hide it; what this function
 * guarantees is only that no unusable part reaches the message.
 */
function senderLineOf(sender: NoticeSender): string {
  const stated: unknown = sender;
  if (typeof stated !== "object" || stated === null) {
    return "";
  }
  const record = stated as { readonly name?: unknown; readonly address?: unknown };
  const name = singleLine(record.name);
  const address = addressOf(record.address);
  if (name !== undefined && address !== undefined) {
    return `${name} <${address}>`;
  }
  return address ?? name ?? "";
}

/** The publisher's display name, or `undefined` when the caller stated none this message may name. */
function publisherNameOf(publisher: NoticePublisher): string | undefined {
  const stated: unknown = publisher;
  if (typeof stated !== "object" || stated === null) {
    return undefined;
  }
  return singleLine((stated as { readonly displayName?: unknown }).displayName);
}

/** How the message names the purpose it was sent for, in generic words when the purpose is unnamed. */
function purposePhraseOf(purpose: unknown): string {
  const key = singleLine(purpose)?.toLowerCase();
  if (key === undefined) {
    return DEFAULT_PURPOSE_PHRASE;
  }
  return PURPOSE_PHRASES[key] ?? DEFAULT_PURPOSE_PHRASE;
}

/**
 * The receiving path a notice may point at, or `undefined` when the caller supplied something a
 * message must not link to.
 *
 * Only a same-origin path qualifies: an absolute URL, a protocol-relative address, a backslash, a
 * query string and a fragment are all refused. That is what keeps a per-recipient token out of the
 * link — the receiving route identifies the edition, not the person, and re-checks the reader's access
 * when the link is opened — and it keeps a notice from pointing anywhere this application does not
 * serve.
 */
function sameOriginPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return undefined;
  }
  if (trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("\\")) {
    return undefined;
  }
  return hasControlOrSpace(trimmed) ? undefined : trimmed;
}

/**
 * The poster path the notice may carry, or `undefined` when any condition of an admitted public poster
 * fails.
 *
 * The checks are the resolve step's, applied again at the message boundary, because a caller may
 * assemble a poster itself: the copy must be public, the rendition must be a poster admitted for public
 * reading, it must belong to the pinned release, that release must be at least directly readable, and
 * the path must be one this application serves.
 */
function posterPathOf(
  pinned: PinnedRendition,
  poster: NoticeVideoPoster | undefined,
): string | undefined {
  if (poster === undefined || pinned.audience !== "public") {
    return undefined;
  }
  if (poster.purpose !== "poster" || !poster.admittedPublic) {
    return undefined;
  }
  if (identityOf(poster.releaseId) !== identityOf(pinned.releaseId)) {
    return undefined;
  }
  if (!isDirectlyReadable(poster.release)) {
    return undefined;
  }
  return sameOriginPath(poster.path);
}

/** The subject one notice carries: the publisher and the fact of a publication, and no title. */
function subjectOf(publisher: string | undefined): string {
  return publisher === undefined
    ? NOTICE_COPY.anonymousSubject
    : `${NOTICE_COPY.subjectLead} ${publisher}`;
}

/**
 * The paragraphs of the message, in the one wording both bodies render.
 *
 * `presenters` decides only how a value, a link and an image are written, so the plain-text and HTML
 * bodies say exactly the same thing and a sentence added here reaches both. A protected copy adds the
 * sentence that opening the link checks the reader's access; that is the only difference between the
 * two audiences, because a protected notice is still a link and a sentence — never the Update.
 */
function composeParagraphs(input: {
  readonly publisher: string | undefined;
  readonly phrase: string;
  readonly link: string | undefined;
  readonly posterPath: string | undefined;
  readonly protectedCopy: boolean;
  readonly presenters: NoticePresenters;
}): readonly string[] {
  const { publisher, phrase, link, posterPath, protectedCopy, presenters } = input;

  const lead = protectedCopy ? NOTICE_COPY.protectedLead : NOTICE_COPY.publicLead;
  const anonymousLead = protectedCopy
    ? NOTICE_COPY.anonymousProtectedLead
    : NOTICE_COPY.anonymousPublicLead;
  const headline =
    publisher === undefined ? anonymousLead : `${presenters.value(publisher)} ${lead}`;

  const reason =
    publisher === undefined
      ? `You are receiving ${phrase} because you asked to hear from this publisher.`
      : `You are receiving ${phrase} from ${presenters.value(publisher)} because you asked to ` +
        "hear from them.";

  const paragraphs: string[] = [
    headline,
    link === undefined ? NOTICE_COPY.noLink : presenters.link(link),
  ];
  if (posterPath !== undefined && presenters.image !== undefined) {
    paragraphs.push(presenters.image(posterPath));
  }
  paragraphs.push(
    `${protectedCopy ? `${NOTICE_COPY.signIn} ` : ""}${reason} ${NOTICE_COPY.preferences}`,
  );
  return paragraphs;
}

/**
 * Builds the notice one recipient receives for the copy they were pinned to: a sender, a generic
 * subject, and the same short wording in plain text and in HTML, pointing at the receiving route.
 *
 * The message cannot disclose protected content because it is never given any: `buildNotice` receives
 * no title, no body, no summary, no caption and no transcript, so there is nothing for it to excerpt,
 * and the single image it can carry is the admitted public poster of a public video placement. It
 * states no location, attaches nothing, embeds no player and adds no tracking pixel. Nothing here
 * claims the message was submitted, accepted, delivered or read — it is a string, and those four
 * outcomes belong to the send record the caller keeps.
 *
 * The pin is used, never recomputed: a recipient who unsubscribes next moment, or changes their
 * language next week, keeps the copy this notice names.
 */
export function buildNotice(input: NoticeInput): Notice {
  const pinned = input.pinned;
  const publisher = publisherNameOf(input.publisher);
  const phrase = purposePhraseOf(input.purpose);
  const link = sameOriginPath(input.link);
  const posterPath = posterPathOf(pinned, input.videoPoster);
  const protectedCopy = pinned.audience === "approved-supporter";

  const shared = { publisher, phrase, link, posterPath, protectedCopy };
  const htmlParagraphs = composeParagraphs({ ...shared, presenters: HTML_PRESENTERS })
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("\n");

  return {
    sender: senderLineOf(input.sender),
    subject: subjectOf(publisher),
    textBody: composeParagraphs({ ...shared, presenters: TEXT_PRESENTERS }).join("\n\n"),
    htmlBody: `<div lang="${NOTICE_LANGUAGE}" dir="${NOTICE_DIRECTION}">\n${htmlParagraphs}\n</div>`,
    link: link ?? "",
    pinned,
  };
}
