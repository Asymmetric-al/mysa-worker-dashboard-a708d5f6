/**
 * The receiving job's named reads: the publisher's audience, a reader's own preference, the synthetic
 * inbox, the Updates a reader may open, the page discovery index, the public reading view, and the
 * per-send results of one notification intent.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Reads: audience and inbox" row and 0.7.1's job group *Reach readers*: `readAudience`,
 *   `readPreferences`, `readInbox`, `readReceivingList`, `readReceivingPost`, `readDiscoveryIndex`,
 *   `readReceivingPage`, `readSendResult`.
 * - AAP 0.8.5 (publication, notification, consent and the language preference stay separate facts) and
 *   0.8.6 (reach, withdrawal, *Giving unavailable*, locale fallback, media reference only through a
 *   scoped request), carried by success criteria 10, 11, 12 and 17.
 * - AAP 0.7.1's read envelope: every answer is a `ReadResult<ReadEnvelope<T>>`, never a bare list, a
 *   record, a number or a boolean; a denial carries no count, title, existence flag or size; an absent
 *   source is `unavailable` with its identity rather than an empty list or a zero.
 *
 * What this file is, and is not. It is the only place a receiving surface's data is assembled: it
 * re-derives scope from the development session, authorises before it enumerates, filters, sorts, pages
 * and counts over the whole authorised set, and builds the envelope once. It renders nothing itself: the
 * one static renderer (`modules/content/render`) produces every HTML string, the one notice builder
 * (`modules/content/notice`) produces the message, the one reach rule (`modules/content/reach`) decides
 * what a route may serve, the one locale chain (`modules/content/locale`) resolves fallback, and the one
 * audience module decides membership, consent and eligibility. Any second implementation of one of those
 * — a cached audience, a second eligibility test, a re-composed dedupe key, a hand-built notice — would
 * be the defect this file exists to prevent.
 *
 * Four facts stay four facts, and none is inferred from another:
 * 1. Contactability — whether a stored contact method may be used at all. It is not read here at all.
 * 2. Communication consent for one publisher and one purpose — the Off/Immediate choice, plus proof of
 *    the address (`audience/consent.ts#hasConsent`).
 * 3. A protected-content reader grant — whether a reader may open an approved-supporter edition, decided
 *    now by `authorize.ts#canReadProtected` from the membership rows themselves.
 * 4. The language preference — a reading choice that neither subscribes, nor unsubscribes, nor proves
 *    possession of an address, nor substitutes the copy already pinned on an earlier intent.
 * A membership record is not consent, a `subscribed`-looking column is not consent, and a delivered copy
 * grants no reading entitlement: the inbox shows a message that was produced, and the edition behind it
 * is re-authorised on every open.
 *
 * Five outcomes stay five outcomes: publication, notification submission, provider acceptance, reaching
 * a mailbox, and reading it. Only the middle three are modelled here, as the closed `accepted | failed |
 * unknown` states, and none of the three may be presented as either of the last two.
 *
 * Two worlds, one authority. A session's own documents are the records it may read. A reader persona
 * holds no ministry membership and its session documents are empty, so its published world is resolved
 * from the seeded publisher session, in a development build only: the synthetic receiving preview is a
 * development affordance, and a production build never crosses sessions — it answers from the caller's
 * own documents, which hold nothing to fabricate. The reader's own rows are what the grant is decided
 * from, in both builds.
 *
 * Time is a parameter, never a local computation: `now()` from `modules/time/clock` supplies the scenario
 * instant, and the 24-hour usefulness window and the 168-hour confirmation window come from
 * `modules/time/window`, which own their strict-at-equality boundaries.
 *
 * Layering: a data-service read module. It imports the store's one read function, the authorisation
 * module, the envelope and outcome contracts, the audience and content domain modules, the clock and the
 * window boundaries, and three `lib` helpers. It imports no component, no feature, no application route,
 * no provider package, no store internals beyond `repository.ts`, and it never writes: no transaction, no
 * file, no identifier, no log line carrying an address or a list of recipients.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { isDevelopment } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import {
  MEMBER_CHOICES,
  UPDATE_EMAIL_PURPOSE,
  type AudiencePurpose,
  type MemberChoice,
  type MembershipRecord as DomainMembership,
  type MembershipState as DomainMembershipState,
} from "@/modules/audience/membership";
import { dedupeKey, mayRepeatIntent, type SendOutcomeState } from "@/modules/audience/consent";
import {
  EXCLUSION_REASONS,
  membershipAccessAt,
  type ContentAudience,
  type ExclusionReason,
} from "@/modules/audience/resolve";
import { directionOfTag, resolveLocale, type ContentLocale } from "@/modules/content/locale";
import { buildNotice, type PinnedRendition as NoticePinnedRendition } from "@/modules/content/notice";
import {
  isListedPublicly,
  reachMetadata,
  withdrawEdition,
  type ReachMetadata,
  type Tombstone,
} from "@/modules/content/reach";
import {
  renderToHtml,
  type RenderMediaPlacement,
  type RenderRendition,
  type RenderRenditions,
} from "@/modules/content/render";
import type { ContentDocument, Release } from "@/modules/content/variant";
import { readSession } from "@/modules/store/repository";
import { instantAt } from "@/modules/time/clock";
import { confirmationDeadline, notificationDeadline } from "@/modules/time/window";

import { assertScope, canReadProtected, resolveSession, type ResolvedSession } from "../authorize";
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
  type ReadEnvelope,
  type RecordedValueState,
  type ReleaseReach,
  type ReleaseRecord,
  type Scope,
} from "../envelope";
import {
  denied,
  LOCAL_STORE_SYSTEM,
  unavailable,
  type DenialReason,
  type ReadResult,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// The session marker, the development preview world, and the sizes every list obeys
// ---------------------------------------------------------------------------------------------

/**
 * The operation identity a read refusal carries.
 *
 * A read has no attempt identity: nothing was asked to change, so nothing can be replayed. The value
 * states that rather than inventing one, and it keeps a refusal's shape identical to a mutation's, so a
 * client reads one contract whether the refusal came from a read or a write.
 */
const READ_ATTEMPT_ID = "read";

/**
 * The session whose documents hold the seeded published world, used only by a receiving read asked for
 * by a session that holds no ministry membership and only in a development build.
 *
 * A reader persona is admitted by the persona it previews rather than by a membership, and its own
 * documents are therefore empty; the published editions, the notification intents and the recorded send
 * results exist in the publisher's session. Reading across sessions is exactly the synthetic preview, so
 * it is gated on the development boundary: in a production build this constant is never consulted and a
 * reader is answered from its own documents alone.
 */
const PREVIEW_PUBLISHER_SESSION_ID = "established-worker";

/** The retry guidance an unreadable session document carries, naming the safe action and no path. */
const STORE_READ_GUIDANCE =
  "The local synthetic store could not be read for this request. Retry the same request; if it keeps failing, reset the development data from Settings and reopen the session.";

/** The default and maximum page sizes every list here uses: 50 rows, capped at 200 (AAP 0.8.7). */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * The first page number. Pages are one-based because the pagination control states "page 2 of 7", and a
 * zero-based number in the data would have to be converted by every surface.
 */
const FIRST_PAGE = 1;

/**
 * The publisher's own configured sending identity, as this synthetic release can state it.
 *
 * No provider credential exists and no mail leaves the application, so the sender is the application's
 * own labelled stand-in: a display name and an address in the reserved `.invalid` domain, which can
 * never be mistaken for, or reach, a real mailbox. It is never the recipient's address and never derived
 * from a message field.
 */
const NOTICE_SENDER = Object.freeze({
  name: "Update notices",
  address: "update-notice@example.invalid",
});

/**
 * The display name of the publisher a notice speaks for, when this read cannot establish one.
 *
 * A blank value makes the notice builder state its anonymous wording ("An update has been published.")
 * instead of guessing a publisher name, and a generic subject is the honest form: the stored content
 * records carry a source reference, never a display name, and the receiving preview is not a reason to
 * invent one.
 */
const UNNAMED_PUBLISHER = "";

/**
 * The names of the simulated effects this job triggers, mirroring the vocabulary
 * `src/components/simulation-label` declares. They travel as data so the surface that composes the label
 * states the sentence the specification fixes, and this module imports no component.
 */
const SIMULATED_MAIL_SUBMISSION = "mail-submission";
const SIMULATED_PUBLICATION_REACH = "publication-reach";
const SIMULATED_GIVING_DESTINATION = "giving-destination";

/** The application's receiving route for one Update, and for one page edition. */
function updateHref(documentId: string): string {
  return `/preview/${encodeURIComponent(documentId)}`;
}

function pageHref(documentId: string, localeTag: string): string {
  return `/preview/pages/${encodeURIComponent(documentId)}/${encodeURIComponent(localeTag)}`;
}

/**
 * The application path that serves one rendition of one asset.
 *
 * It is a path, not a grant: the media route re-authorises every request for playback, poster, captions,
 * a transcript and a byte range, so nothing here opens the asset, and no original bytes are ever behind
 * this address.
 */
function renditionPath(assetId: string, renditionId: string): string {
  return `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(renditionId)}`;
}

// ---------------------------------------------------------------------------------------------
// The data each read answers with
// ---------------------------------------------------------------------------------------------

/** One page of a whole-result count, stated the way every list states it. */
export interface PageWindow {
  /** The one-based page this data covers. */
  readonly page: number;
  /** The page size this data was cut at, after the cap was applied. */
  readonly pageSize: number;
  /** The whole-result count, never the number of rows in this page. */
  readonly total: number;
  /** The whole-result page count. */
  readonly pageCount: number;
}

/** One member of the publisher's audience, projected without the address the record holds. */
export interface AudienceMember {
  /** The person's own opaque identifier for this publisher and purpose; never an address, never a name. */
  readonly recipientId: string;
  /** The name the membership records for display, when it records one. */
  readonly displayName: string | null;
  /** Which of the four membership states this row stands in. */
  readonly state: DomainMembershipState;
  /** The Off/Immediate choice this row carries. It is not consent on its own. */
  readonly choice: MemberChoice;
  /** The BCP-47 tag this person reads in; a reading choice, not consent and not proof. */
  readonly languagePreference: string;
  /** The instant the person accepted, when the record carries one; the proof window starts here. */
  readonly acceptedOn: string | null;
  /** Whether this row may receive a notice for this purpose at `asOf`. */
  readonly eligible: boolean;
  /** Why it may not, when it may not; one reason per row, from the closed published set. */
  readonly exclusionReason: ExclusionReason | null;
}

/** The publisher's audience view for one purpose, whole-result counts plus one page of members. */
export interface AudienceView {
  /** The publisher whose Update email this view is for, or `null` when the ministry holds no audience. */
  readonly publisherId: string | null;
  /** The one purpose this release keeps memberships for; no second purpose is expressible. */
  readonly purpose: AudiencePurpose;
  /** The two choices the audience offers, off and immediate, in the order a surface lists them. */
  readonly choiceOptions: readonly MemberChoice[];
  /** Eligible and excluded counts over the whole audience, never over the visible page. */
  readonly counts: { readonly eligible: number; readonly excluded: number; readonly total: number };
  /** How many rows stand in each of the four states. */
  readonly memberStates: Readonly<Record<DomainMembershipState, number>>;
  /** Why each excluded row is excluded, one count per reason, so no reason hides inside a total. */
  readonly excludedByReason: Readonly<Record<ExclusionReason, number>>;
  /** Rows the source supplied and this application will never activate; counted apart from the rest. */
  readonly sourceSuppliedRows: number;
  /** One page of the audience, ordered by the person's own identifier. */
  readonly members: readonly AudienceMember[];
  /** The page this data covers and the whole-result count behind it. */
  readonly page: PageWindow;
}

/** One copy already pinned for this reader, kept as recorded so a later change cannot substitute it. */
export interface PinnedCopy {
  /** The notification intent this copy belongs to. */
  readonly intentId: string;
  /** The recorded send result the copy was accepted under. */
  readonly sendResultId: string;
  /** The release that was pinned when the intent was accepted. */
  readonly releaseId: string;
  /** The one rendition pinned for this person and this intent. */
  readonly renditionId: string;
  /** What was recorded for this copy: accepted, failed or unknown, and nothing beyond acceptance. */
  readonly state: SendOutcomeState;
  /** When the outcome was recorded. */
  readonly recordedAt: string;
}

/** The confirmation window of one acceptance, stated at the instant this read ran. */
export interface ConfirmationWindowView {
  /** `not-awaiting-proof` when no acceptance is waiting, otherwise whether the window is open. */
  readonly state: "not-awaiting-proof" | "open" | "expired";
  /** The exclusive deadline the window computed from the recorded acceptance, when there is one. */
  readonly deadline: string | null;
  /** How much of the window is left; `null` once it has closed or when there is none. */
  readonly remainingMilliseconds: number | null;
}

/** A reader's own preference record for one publisher and one purpose. */
export interface PreferencesView {
  /** `none` when this person holds no membership for this publisher and purpose. */
  readonly state: "none" | DomainMembershipState;
  /** The membership's own identity, or `null` when there is none. */
  readonly membershipId: string | null;
  /** The publisher this membership is for, or `null` when there is none. */
  readonly publisherId: string | null;
  /** The purpose, which is the only purpose this release keeps memberships for. */
  readonly purpose: AudiencePurpose;
  /** The Off/Immediate choice, or `null` before any choice exists. Never a cadence, never a third value. */
  readonly choice: MemberChoice | null;
  /** The two choices this read offers, and the complete set of them. */
  readonly choiceOptions: readonly MemberChoice[];
  /** The BCP-47 tag this person chose to read in, or `null` when none was chosen. */
  readonly languagePreference: string | null;
  /**
   * The address this person gave for these notices, as an opaque value on their own record only.
   *
   * It is never a join key, never compared with a partner record, never logged and never carried by a
   * denial; an equal-looking address elsewhere establishes neither identity nor consent.
   */
  readonly email: string | null;
  /** The acceptance instant the proof window is measured from, when the record carries one. */
  readonly acceptedOn: string | null;
  /** The 168-hour confirmation window, evaluated strictly at this read's instant. */
  readonly confirmation: ConfirmationWindowView;
  /** The neutral pending result the proof step renders, present only while the address is unproven. */
  readonly pending: { readonly claimsMailSent: false; readonly nextStep: string } | null;
  /** The protected-reading grant, decided now from this person's own rows and nothing else. */
  readonly readingGrant: { readonly granted: boolean; readonly audience: ContentAudience };
  /** What this person's Off decision addresses: one publisher and one purpose, and no wider scope. */
  readonly unsubscribeScope: { readonly publisherId: string; readonly purpose: AudiencePurpose } | null;
  /** The copies already pinned for this person, as recorded. A language change cannot replace one. */
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
  /** An opaque identity for this message: its send result plus the recipient it addresses. */
  readonly messageId: string;
  /** The notification intent this message belongs to; exactly one message exists per intent. */
  readonly intentId: string;
  /** The release pinned when the intent was accepted. */
  readonly releaseId: string;
  /** The variant that release publishes, when the record still resolves. */
  readonly variantId: string | null;
  /** The one rendition pinned for this person and this intent. */
  readonly renditionId: string;
  /** What was recorded for this copy; never a claim that a mailbox received it or a person read it. */
  readonly state: SendOutcomeState;
  /** The audience the pinned copy serves, when the record still resolves. */
  readonly audience: ContentAudience | null;
  /** The exact locale the pinned copy was published in, when the record still resolves. */
  readonly locale: ContentLocale | null;
  /** The instant the notification was intended for; the usefulness window is measured from it. */
  readonly intendedAt: string;
  /** When the outcome was recorded. */
  readonly recordedAt: string;
  /** The subject the message carries: the publisher and the fact of a publication, never a title. */
  readonly subject: string;
  /** The sender line the message carries. */
  readonly sender: string;
  /** The receiving path the message points at. */
  readonly link: string;
  /** Whether this is a protected notice, whose body is a link and a sentence and nothing else. */
  readonly protectedNotice: boolean;
  /** The message's HTML rendering, produced by the one notice builder. */
  readonly html: string;
  /** The same wording as plain text, a real alternative rather than a note that one exists. */
  readonly plainText: string;
  /** What the reader may open from this message, re-authorised when they ask for it. */
  readonly reading: InboxReading;
  /** The simulated effects this message embodies, so the surface labels them where it shows it. */
  readonly simulated: readonly string[];
}

/** A reader's synthetic inbox: one message per recipient and intent, plus what was recorded. */
export interface InboxView {
  /** One page of messages, newest first. */
  readonly messages: readonly InboxMessage[];
  /** The distinct notification intents behind those messages, so a duplicate would be visible. */
  readonly intentCount: number;
  /** How many messages stand in each send state. */
  readonly sendStates: Readonly<Record<SendOutcomeState, number>>;
  /**
   * How many recorded copies this inbox could not present because the intent they belong to is absent.
   *
   * A copy without its intent names no release and no edition, so it is reported as this count rather
   * than shown as a message whose reading goes nowhere.
   */
  readonly unresolvedIntents: number;
  /** The page this data covers and the whole-result count behind it. */
  readonly page: PageWindow;
}

/** One edition a receiving reader may open. */
export interface ReceivingEdition {
  /** The canonical document the edition publishes. */
  readonly documentId: string;
  /** The audience-and-locale variant the edition belongs to. */
  readonly variantId: string;
  /** The exact release. */
  readonly releaseId: string;
  /** Which audience this edition serves. */
  readonly audience: ContentAudience;
  /** The exact locale it is published in, with the direction it is read in. */
  readonly locale: ContentLocale;
  /** When it was published. */
  readonly publishedAt: string;
  /** How far it reaches, so a surface can state it without re-deriving it. */
  readonly reach: ReleaseReach;
  /** The title its own share presentation states, when it states one. */
  readonly title: string | null;
  /** The short description its share presentation states, when it states one. */
  readonly description: string | null;
  /** The exact-post destination for this edition. */
  readonly href: string;
}

/** The Updates a reader may open now, re-authorised at this read's instant. */
export interface ReceivingListView {
  /** One page of editions, public before protected and newest first within each. */
  readonly editions: readonly ReceivingEdition[];
  /** The reader's own language preference, which orders and labels but never widens access. */
  readonly languagePreference: string | null;
  /** The page this data covers and the whole-result count behind it. */
  readonly page: PageWindow;
}

/** One media reference a reading surface may place, reachable only through its scoped request. */
export interface MediaReference {
  /** The asset the rendition belongs to. */
  readonly assetId: string;
  /** The rendition's own identity. */
  readonly renditionId: string;
  /** What the rendition serves: a display image, a playback stream, a poster or a caption track. */
  readonly purpose: string;
  /** The application path that serves it; every request for it re-authorises. */
  readonly path: string;
}

/** What a Give placement resolves to. There is no third value and no fallback fund. */
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
  /** `rendered` when an admitted edition serves this reader, `language-unavailable` when none does. */
  readonly state: "rendered" | "language-unavailable";
  /** The canonical document this post is an edition of. */
  readonly documentId: string;
  /** The variant, release and audience served, or `null` when the language is unavailable. */
  readonly variantId: string | null;
  readonly releaseId: string | null;
  readonly audience: ContentAudience | null;
  /** The language the reader asked for. */
  readonly requestedLocale: string;
  /** The language actually served, which is what the surface must state. */
  readonly servedLocale: ContentLocale | null;
  /** Whether the served edition is a different language from the one requested. */
  readonly fallbackOccurred: boolean;
  /** When the edition was published. */
  readonly publishedAt: string | null;
  /** The title the edition's share presentation states, when it states one. */
  readonly title: string | null;
  /** The rendered body, from the one static renderer. */
  readonly html: string | null;
  /** The media placements the body may show, each reachable only through its scoped request. */
  readonly renditions: readonly MediaReference[];
  /** The simulated effects this surface embodies. */
  readonly simulated: readonly string[];
}

/** One edition the discovery index lists publicly. */
export interface DiscoveryEntry {
  /** The canonical document the edition publishes. */
  readonly documentId: string;
  /** The exact locale, with the direction it is read in. */
  readonly locale: ContentLocale;
  /** The title the edition's share presentation states. */
  readonly title: string;
  /** The canonical path of the edition. */
  readonly href: string;
  /** Whether the route must answer `noindex`; false for a listed edition. */
  readonly noindex: boolean;
}

/** The pages the discovery index lists: only editions that reach a public listing. */
export interface DiscoveryIndexView {
  /** One page of listed editions, ordered by title and then path. */
  readonly entries: readonly DiscoveryEntry[];
  /** The page this data covers and the whole-result count behind it. */
  readonly page: PageWindow;
}

/** One published page edition served by direct link. */
export interface ReceivingPageView {
  /** `served` for an admitted edition, `withdrawn` for a tombstone, `language-unavailable` for neither. */
  readonly state: "served" | "withdrawn" | "language-unavailable";
  /** The canonical document the edition publishes, absent from a tombstone. */
  readonly documentId: string | null;
  /** The content family, so a surface knows which catalogue composed it. */
  readonly family: ContentFamily | null;
  /** The exact release served. */
  readonly releaseId: string | null;
  /** The language the reader asked for. */
  readonly requestedLocale: string;
  /** The language actually served, which the surface must state when it differs. */
  readonly servedLocale: ContentLocale | null;
  /** Whether the served edition is a different language from the one requested. */
  readonly fallbackOccurred: boolean;
  /** How far the served edition reaches. */
  readonly reach: ReleaseReach | null;
  /** The indexing decision the route emits, so no route re-derives reach. */
  readonly metadata: ReachMetadata | null;
  /** The title the edition's share presentation states. */
  readonly title: string | null;
  /** The short description the edition's share presentation states. */
  readonly description: string | null;
  /** The rendered body, from the one static renderer. */
  readonly html: string | null;
  /** The media placements the body may show, each reachable only through its scoped request. */
  readonly renditions: readonly MediaReference[];
  /** The Give placement: one approved designation, or *Giving unavailable* and no fallback. */
  readonly giving: GivingPlacement | null;
  /** The non-identifying tombstone a withdrawn edition answers with, and nothing else. */
  readonly tombstone: Tombstone | null;
  /** The simulated effects this surface embodies. */
  readonly simulated: readonly string[];
}

/** One recipient's recorded outcome within a send result. */
export interface SendResultRow {
  /** The person this row addresses. */
  readonly recipientId: string;
  /** The one rendition pinned for this person and this intent. */
  readonly renditionId: string;
  /** What was recorded: accepted, failed or unknown, and nothing beyond acceptance. */
  readonly state: SendOutcomeState;
  /** When the outcome was recorded. */
  readonly recordedAt: string;
  /** The identity this notice is deduplicated under, so a duplicate would be visible as one identity. */
  readonly dedupeKey: string;
  /** Whether the same work may be retried, and why it may or may not. */
  readonly retry: { readonly available: boolean; readonly reason: string };
  /** The only recovery an accepted or uncertain row offers: re-query the same intent. */
  readonly recovery: { readonly intentId: string };
}

/** The per-send results of one notification intent. */
export interface SendResultView {
  /** The intent these results belong to. */
  readonly intentId: string;
  /** The release pinned when the intent was accepted. */
  readonly releaseId: string;
  /** The publisher whose audience this intent addressed. */
  readonly publisherId: string;
  /** The purpose the intent served. */
  readonly purpose: AudiencePurpose;
  /** The instant the notification was intended for. */
  readonly intendedAt: string;
  /** When these results were recorded, or `null` while no outcome exists. */
  readonly recordedAt: string | null;
  /** The ceiling the accepted intent promised, which a later signup never expands. */
  readonly ceilingCount: number;
  /** How many rows stand in each of the three send states. */
  readonly counts: Readonly<Record<SendOutcomeState, number>>;
  /** One page of per-recipient rows, ordered by the person's own identifier. */
  readonly rows: readonly SendResultRow[];
  /** The 24-hour usefulness window, evaluated strictly at this read's instant. */
  readonly usefulness: {
    readonly state: "within-usefulness" | "past-usefulness";
    readonly deadline: string;
    readonly remainingMilliseconds: number | null;
  };
  /** The page this data covers and the whole-result count behind it. */
  readonly page: PageWindow;
}


// ---------------------------------------------------------------------------------------------
// The stored document this read parses, and the two worlds a session may be answered from
// ---------------------------------------------------------------------------------------------

/**
 * One stored content revision, as far as this job reads it.
 *
 * `body` is `unknown` on purpose: the content profile — its admitted nodes, marks, heading levels and
 * bounded presentation choices — is owned by `modules/content/document`, and the body reaches the one
 * static renderer as `unknown`, where that validator refuses anything the profile does not admit. Parsing
 * the body here would be a second copy of the profile; parsing its envelope (identity, checksum, media
 * placements, share presentation) is what lets a missing or malformed revision be reported as an outage
 * instead of being rendered from a half-read record.
 */
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

/** The selected context a state document states, in the branded identifiers the envelope uses. */
const storedContextSchema = z.object({
  selectedOrganizationId: organizationIdSchema.nullable(),
  selectedMinistryId: ministryIdSchema.nullable(),
  selectedSupportSubjectId: supportSubjectIdSchema.nullable(),
});

/**
 * The record families this job reads out of a session's state document.
 *
 * The parse is strict and total: every member is required, because the store's own document builder
 * writes every family (an empty collection where a workspace holds none). A document that has lost a
 * family is not a session with no content but a document this build cannot read, so it is reported as
 * `unavailable` rather than answered as an empty list — the distinction the envelope exists to keep.
 * Families this job never reads (partners, gifts, tasks, coaching) are left unparsed and unreported.
 */
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

/** The state document as this job reads it. */
type StoredState = z.infer<typeof storedStateSchema>;

/** One content revision as this job reads it. */
type StoredRevision = z.infer<typeof storedContentRevisionSchema>;

/** One world: a session's identifier and the records its state document states. */
interface World {
  readonly sessionId: string;
  readonly state: StoredState;
}

/** The two worlds a read may answer from: the caller's own, and the world it publishes or reads in. */
type WorldResolution =
  | {
      readonly ok: true;
      readonly session: ResolvedSession;
      readonly own: World;
      readonly published: World;
    }
  | { readonly ok: false; readonly result: ReadResult<never> };

/** The refusal a read answers with when the caller holds no authority for it. */
function deniedRead(reason: DenialReason): ReadResult<never> {
  return { kind: "denied", denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }) };
}

/**
 * The answer when a source behind a read cannot be read at all.
 *
 * It carries the source's identity and retry guidance, so a surface states the outage rather than
 * rendering an empty list or a zero. The reference is the fault's own name or the missing-session marker,
 * never a path and never a fragment of a record, and the diagnostic line names the job and the source and
 * nothing else — no address, no message body, no recipient list.
 */
function sourceUnavailableRead(
  job: string,
  reference: string,
  system: string = LOCAL_STORE_SYSTEM,
): ReadResult<never> {
  const source: SourceReference = { system, reference };
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance: STORE_READ_GUIDANCE }),
  };
}

/**
 * Loads one session's state document, or the marker that says why it could not be read.
 *
 * A session the store does not hold and a document that cannot be decoded answer with different markers,
 * because they are different faults; neither is answered as an empty session, since an empty session is
 * a real state this release keeps for a reader persona and must not be confused with a fault.
 */
async function loadWorld(
  sessionId: string,
): Promise<{ readonly ok: true; readonly world: World } | { readonly ok: false; readonly reference: string }> {
  let documents;
  try {
    documents = await readSession(sessionId);
  } catch (error) {
    const name: unknown = error instanceof Error ? error.name : undefined;
    return { ok: false, reference: typeof name === "string" && name.length > 0 ? name : "unreadable-session" };
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

/**
 * Resolves the two worlds one read answers from: the caller's own documents, and the published world.
 *
 * The published world is the caller's own documents unless the caller holds no ministry membership and
 * the build is a development build, in which case it is the seeded publisher session's documents — the
 * synthetic receiving preview's published editions, intents and recorded outcomes. A production build
 * never crosses sessions, so production can only answer from records the caller's own session holds.
 *
 * A published world that exists but cannot be read is an outage, not an empty publication list: the
 * receiving surface must say so rather than claim nothing was ever published.
 */
async function resolveWorlds(job: string): Promise<WorldResolution> {
  const resolved = await resolveSession();
  if (!resolved.ok) {
    return { ok: false, result: { kind: "denied", denied: resolved.denial } };
  }
  const { session } = resolved;

  const own = await loadWorld(session.sessionId);
  if (!own.ok) {
    return { ok: false, result: sourceUnavailableRead(job, own.reference) };
  }

  const crossesSessions =
    isDevelopment() &&
    session.admittedMemberships.length === 0 &&
    session.sessionId !== PREVIEW_PUBLISHER_SESSION_ID;
  if (!crossesSessions) {
    return { ok: true, session, own: own.world, published: own.world };
  }

  const publisher = await loadWorld(PREVIEW_PUBLISHER_SESSION_ID);
  if (!publisher.ok) {
    return { ok: false, result: sourceUnavailableRead(job, publisher.reference) };
  }
  return { ok: true, session, own: own.world, published: publisher.world };
}

// ---------------------------------------------------------------------------------------------
// Scope: the authority a read states, and whether the caller holds it
// ---------------------------------------------------------------------------------------------

/**
 * The scope a read states: the caller's own selected context, else the context the published world was
 * written in, with the caller's own principal.
 *
 * A reader holds no ministry membership and has selected no context, so its envelope cannot claim one.
 * What the read did run under is stated instead: the context whose editions it read, plus the reader's own
 * principal as the acting identity. A worker's own selected context is used unchanged, so the two are the
 * same shape without either pretending to the other's authority.
 */
function scopeOf(session: ResolvedSession, world: World): Scope | undefined {
  if (session.selected !== null) {
    return session.selected;
  }
  const { context } = world.state;
  if (
    context.selectedOrganizationId === null ||
    context.selectedMinistryId === null ||
    context.selectedSupportSubjectId === null
  ) {
    return undefined;
  }
  return {
    organizationId: context.selectedOrganizationId,
    ministryId: context.selectedMinistryId,
    supportSubjectId: context.selectedSupportSubjectId,
    principalId: session.principalId,
  };
}

/**
 * Whether the caller is admitted to the world it is reading, asked through the one scope check.
 *
 * A reader that holds no membership is refused here, which is why the receiving reads authorise each
 * edition through `canReadProtected` instead: reading a public edition is not membership of anything.
 */
function admittedToWorld(session: ResolvedSession, world: World): boolean {
  const scope = scopeOf(session, world);
  return scope !== undefined && assertScope(session, scope).ok;
}

// ---------------------------------------------------------------------------------------------
// Stored record to domain record: the one adapter each shape needs
// ---------------------------------------------------------------------------------------------

/** Reads a stored instant, or `undefined` when the value is not one this build can resolve. */
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

/**
 * Reads a stored revision token as the ordinal the domain record carries.
 *
 * The stored form states its change counter as a token (`"rev-1"`), while the domain membership record
 * carries a number that only its own transitions advance. This job never writes a membership, so the
 * number is a statement of how many changes the record has seen rather than a token to present back: the
 * digits of the token are read, and a token with none counts as its first state.
 */
function revisionOrdinal(revision: string): number {
  const digits = /(\d+)\s*$/u.exec(revision);
  if (digits === null) {
    return 1;
  }
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Adapts one stored membership to the record the audience module decides from.
 *
 * The stored form and the domain record state the same facts in different shapes, and this is the single
 * place the difference is bridged:
 * - The person's identity is the membership's own identifier. Outcome records address recipients by it,
 *   it is opaque, and it is never an address or a name.
 * - The Off/Immediate choice follows the state: a row that is `off` or `restricted` carries Off, and every
 *   other row carries Immediate. The stored form keeps one field, because a state's off-ness already is
 *   that choice.
 * - A confirmation instant is present for every row that is not waiting for proof and that recorded an
 *   acceptance: such a row passed the proof step at some point, which is what distinguishes a person who
 *   turned these notices off after receiving them from one who only ever chose Off. A row still awaiting
 *   proof has accepted and is not confirmed, and the stored form keeps one instant for both facts.
 * - The scope is the ministry whose documents hold the row, because the stored form addresses a
 *   membership by publisher and purpose and leaves its context to the session that holds it.
 * - No source disposition is invented: the stored form records a source-supplied row as an `off` row with
 *   no acceptance, and it is reported as `off`, which is what the record states.
 */
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

/** The locale a stored release serves, read from the record and its variant's stated direction. */
function localeOfRelease(record: ReleaseRecord, variant: ContentVariantRecord | undefined): ContentLocale {
  return {
    tag: record.locale,
    direction: variant?.direction ?? directionOfTag(record.locale),
  };
}

/**
 * Adapts one stored release to the domain release the locale chain resolves over.
 *
 * The stored form states the locale as a tag and the publication as an instant string; the domain record
 * states the locale whole, because direction is content rather than interface language. The checksum is
 * the published revision's, so an unchanged copy is a comparison rather than a guess, and a release whose
 * revision is missing answers `undefined` — such a record cannot be rendered, and pretending it can would
 * put a blank edition in front of a reader.
 */
function domainReleaseOf(
  record: ReleaseRecord,
  variant: ContentVariantRecord | undefined,
  revision: StoredRevision | undefined,
): Release | undefined {
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

/**
 * Adapts one stored content document to the domain document the locale chain scopes by.
 *
 * Only the identity the chain reads is carried: the canonical document, its family and kind, the source
 * subject it is written for, and the Site it belongs to. The managed fields are stated empty because the
 * stored record keeps the *names* of the fields the source owns and no values, and a value invented here
 * would be a fabricated managed field. Fallback resolution reads none of them, and the title a receiving
 * surface states comes from the edition's own share presentation.
 */
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

// ---------------------------------------------------------------------------------------------
// Small shared helpers: paging, value states, collection identity and rendering
// ---------------------------------------------------------------------------------------------

/** A caller's requested page window, before the cap and the defaults are applied. */
interface PageQuery {
  readonly page?: number;
  readonly pageSize?: number;
}

/** The page size actually used: the default when unstated, and never above the cap. */
function pageSizeOf(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  const whole = Math.trunc(requested);
  if (whole < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return whole > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : whole;
}

/** The one-based page actually used, which is the first page when the request names none. */
function pageNumberOf(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return FIRST_PAGE;
  }
  const whole = Math.trunc(requested);
  return whole < FIRST_PAGE ? FIRST_PAGE : whole;
}

/** The page window a read states, always measured against the whole authorised result. */
function pageWindowOf(total: number, query: PageQuery): { readonly window: PageWindow; readonly offset: number; readonly limit: number } {
  const pageSize = pageSizeOf(query.pageSize);
  const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = pageNumberOf(query.page);
  return {
    window: { page, pageSize, total, pageCount },
    offset: (page - FIRST_PAGE) * pageSize,
    limit: pageSize,
  };
}

/** One page of an already filtered and sorted collection. */
function sliceOf<T>(items: readonly T[], offset: number, limit: number): readonly T[] {
  return items.slice(offset, offset + limit);
}

/** The state of a count: a known zero is `zero`, and any other known count is `value`. */
function countState(count: number): RecordedValueState {
  return count === 0 ? "zero" : "value";
}

/** The state of a text value: absent is `unknown`, and a stated value is `value`. */
function textState(value: string | null | undefined): RecordedValueState {
  return value === null || value === undefined || value.length === 0 ? "unknown" : "value";
}

/**
 * A stable identity for the collection a read returned: a hash of the members' own identities and
 * revisions.
 *
 * The store keeps no collection revision, and a read still has to state one, so it is derived: the same
 * members at the same revisions always produce the same value, and any addition, removal or change of a
 * member produces a different one. The fold is a 32-bit FNV-1a hash over the sorted parts, written as
 * eight hexadecimal characters; it uses integer operations only, so it is identical on every host and
 * reads no clock.
 */
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

/** The placements, renditions and references one revision's media contribute to a rendering. */
interface RenderingMedia {
  readonly placements: readonly RenderMediaPlacement[];
  readonly renditions: RenderRenditions;
  readonly references: readonly MediaReference[];
}

/**
 * Builds the media a revision's body may show, from the placements it states and the assets the world
 * holds.
 *
 * A placement contributes its main rendition — a display image or a playback stream — and, for a video,
 * the poster and caption renditions the revision's caption tracks name. Every path is an application path
 * that re-authorises on request, so a reference here is a place to ask, never a grant: a caption URL
 * cannot become a route around a denied playback, and the original bytes are never behind any of them.
 */
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

    const main = asset.renditions.find((rendition) =>
      asset.kind === "video" ? rendition.purpose === "playback" : rendition.purpose === "display",
    );
    const poster = asset.renditions.find((rendition) => rendition.purpose === "poster");
    const captions = revision.captions.find((track) => track.assetId === placement.assetId);
    const captionRendition = captions === undefined
      ? undefined
      : asset.renditions.find((rendition) => rendition.renditionId === captions.renditionId);

    if (main !== undefined) {
      const path = renditionPath(asset.assetId, main.renditionId);
      renditions[placement.placementId] = { src: path, purpose: main.purpose === "playback" ? "playback" : "display" };
      references.push({ assetId: asset.assetId, renditionId: main.renditionId, purpose: main.purpose, path });
    }
    if (poster !== undefined) {
      const posterKey = `${placement.placementId}:poster`;
      const path = renditionPath(asset.assetId, poster.renditionId);
      renditions[posterKey] = { src: path, purpose: "poster" };
      references.push({ assetId: asset.assetId, renditionId: poster.renditionId, purpose: poster.purpose, path });
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

/** The outcome of rendering one revision: its HTML, or the reason it cannot be shown. */
type RevisionRendering =
  | { readonly ok: true; readonly html: string; readonly media: RenderingMedia }
  | { readonly ok: false; readonly reason: string };

/**
 * Renders one stored revision through the application's single static renderer.
 *
 * A revision the content profile refuses is not rendered partially: the surface is told it cannot be
 * shown, which is a different fact from an edition that does not exist, and neither is presented as an
 * empty page.
 */
function renderingOf(revision: StoredRevision, assets: readonly MediaAssetRecord[]): RevisionRendering {
  const media = renderingMediaOf(revision, assets);
  const rendered = renderToHtml(revision.body, {
    placements: media.placements,
    renditions: media.renditions,
  });
  if (rendered.status === "invalid") {
    return { ok: false, reason: "The edition's content does not satisfy the content profile this build renders." };
  }
  return { ok: true, html: rendered.html, media };
}

/** The stored variant, revision and document a release names, resolved once for the reads below. */
interface ResolvedRelease {
  readonly record: ReleaseRecord;
  readonly variant: ContentVariantRecord | undefined;
  readonly revision: StoredRevision | undefined;
  readonly document: ContentDocumentRecord | undefined;
  readonly domain: Release | undefined;
}

/** Resolves the records one stored release names, so every read joins by identity rather than by name. */
function resolveRelease(record: ReleaseRecord, state: StoredState): ResolvedRelease {
  const variant = state.contentVariants.find((candidate) => candidate.variantId === record.variantId);
  const revision = state.contentRevisions.find((candidate) => candidate.revisionId === record.revisionId);
  const document =
    variant === undefined
      ? undefined
      : state.contentDocuments.find((candidate) => candidate.documentId === variant.documentId);
  return { record, variant, revision, document, domain: domainReleaseOf(record, variant, revision) };
}



/** A count per membership state, all four present so a surface never has to guess an absent key. */
function zeroMemberStates(): Record<DomainMembershipState, number> {
  return { active: 0, "awaiting-proof": 0, off: 0, restricted: 0 };
}

/** A count per exclusion reason, all eight present so no reason hides inside one "excluded" number. */
function zeroExclusionCounts(): Record<ExclusionReason, number> {
  const counts = {} as Record<ExclusionReason, number>;
  for (const reason of EXCLUSION_REASONS) {
    counts[reason] = 0;
  }
  return counts;
}

/** A count per send state, all three present so accepted, failed and unknown never merge. */
function zeroSendStates(): Record<SendOutcomeState, number> {
  return { accepted: 0, failed: 0, unknown: 0 };
}

/** Orders two identifiers by UTF-16 code unit, the one order every host and locale agrees on. */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The scenario instant this request runs at, derived from the session's own persisted clock offset.
 *
 * The offset lives in the session's meta document because sessions in different scenarios run at the same
 * time, so a read acting for one session must not read the process clock: two browsers may be on either
 * side of the same boundary at once. `instantAt` applies the one formula the clock module owns.
 */
function scenarioInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}

/** The one publisher a set of rows names, or `undefined` when the set names none or several. */
function singlePublisherOf(rows: readonly StoredMembership[]): string | undefined {
  const publishers = [...new Set(rows.map((row) => row.publisherId))].sort(compareCodeUnits);
  return publishers.length === 1 ? publishers[0] : undefined;
}

/**
 * The memberships that belong to the caller as a reader: the rows a person may see as their own.
 *
 * A session that holds no ministry membership is a person's own session — a reader persona — and every
 * membership in it is theirs, because nothing else writes there. A session that holds a ministry
 * membership holds the ministry's audience, and the caller's own row is the one addressed to the
 * caller's identity, which the stored form states as the membership's own identifier.
 *
 * The published world contributes only rows addressed to the caller, and duplicates are collapsed by
 * membership identity, so the same row read from both worlds is one membership.
 */
function readerOwnedMemberships(
  session: ResolvedSession,
  own: World,
  published: World,
): readonly StoredMembership[] {
  const fromOwn =
    session.admittedMemberships.length === 0
      ? own.state.memberships
      : own.state.memberships.filter((row) => row.membershipId === session.principalId);
  const addressedElsewhere = published.state.memberships.filter(
    (row) => row.membershipId === session.principalId,
  );

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
  /** One publisher's audience; unstated means the single publisher the ministry's rows name. */
  readonly publisherId?: string;
  /** The one-based page of members to return. */
  readonly page?: number;
  /** The page size to cut the member list at, capped at 200. */
  readonly pageSize?: number;
}

/**
 * The publisher's audience for the one purpose this release keeps memberships for.
 *
 * Eligible and excluded counts are whole-audience values with a count per exclusion reason, so a
 * restriction, a person's own Off, a never-proven address and an address that was turned off after
 * proof stay four different facts. The two choices offered are Off and Immediate and the read states
 * them from the one closed vocabulary; the language preference is a separate field on every member and
 * is never folded into consent. No address is projected: an address is a value on a person's own record
 * and is never a matching key in a list.
 */
export async function readAudience(
  query: AudienceQuery = {},
): Promise<ReadResult<ReadEnvelope<AudienceView>>> {
  const worlds = await resolveWorlds("readAudience");
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
    "sourceSuppliedRows": countState(sourceSuppliedRows),
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
          reason:
            "The Off and Immediate decision is the person's own: a worker may read this audience and may not change anyone's choice.",
        },
        {
          name: "unsubscribe",
          available: false,
          reason:
            "An unsubscribe acts on one publisher and one purpose and only from the person whose membership it is.",
        },
        {
          name: "signupForPurpose",
          available: false,
          reason:
            "Importing or editing a contact subscribes nobody: only the person's own deliberate signup creates a membership.",
        },
      ],
    }),
  };
}

/**
 * The reader's own preference record for the one purpose this release keeps memberships for.
 *
 * The four facts are four fields and none is derived from another: the Off/Immediate choice, the
 * language preference, the membership state and the protected-reading grant. A language change cannot
 * alter the choice or the state, because this read states them from separate places, and the grant is
 * decided now from the reader's own rows rather than from a delivered copy.
 *
 * A `GET` of this read confirms nothing: the confirmation window is reported, never advanced, and the
 * pending state stays neutral — signup claims no message was sent, and possession of the address is not
 * proven by this read. A copy already accepted or left uncertain keeps the rendition it was pinned to,
 * which is reported as recorded rather than recomputed.
 */
export async function readPreferences(): Promise<ReadResult<ReadEnvelope<PreferencesView>>> {
  const worlds = await resolveWorlds("readPreferences");
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
      const intent = published.state.notificationIntents.find(
        (candidate) => candidate.intentId === result.intentId,
      );
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
    pending: awaitingProof
      ? { claimsMailSent: false, nextStep: "confirm-from-the-rendered-message" }
      : null,
    readingGrant: { granted: readingGrant, audience: "approved-supporter" },
    unsubscribeScope:
      publisherId === null ? null : { publisherId, purpose: UPDATE_EMAIL_PURPOSE },
    pinnedCopies,
  };

  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: "audience-memberships", reference: publisherId ?? "no-membership" },
      revision: collectionRevision(
        domains.map((row) => `${row.membershipId}@${String(row.revision)}`),
      ),
      asOf: at.toString(),
      coverage: { from: null, to: null, state: "complete" },
      valueStates: {
        "confirmation.deadline": textState(data.confirmation.deadline),
        "confirmation.remainingMilliseconds":
          data.confirmation.remainingMilliseconds === null
            ? "unknown"
            : countState(data.confirmation.remainingMilliseconds),
        "pinnedCopies": countState(pinnedCopies.length),
      },
      actions: [
        {
          name: "setPreference",
          available: domain !== undefined && domain.state !== "restricted",
          ...(domain === undefined
            ? { reason: "No membership exists yet: choose Immediate to begin the proof step." }
            : {}),
        },
        {
          name: "setLanguagePreference",
          available: domain !== undefined,
          ...(domain === undefined
            ? { reason: "No membership exists yet, so there is no preference to change." }
            : {}),
        },
        {
          name: "confirmMembership",
          available: data.confirmation.state === "open",
          ...(data.confirmation.state === "open"
            ? {}
            : { reason: "Nothing is waiting for confirmation at this instant." }),
        },
        {
          name: "unsubscribe",
          available: domain !== undefined && domain.state !== "restricted",
          ...(domain === undefined
            ? { reason: "No membership exists yet, so there is nothing to turn off." }
            : {}),
        },
      ],
    }),
  };
}

/**
 * Whether the reader holds a protected-reading grant, decided by the audience authority itself.
 *
 * The question is asked per publisher, because identity for consent and for reading is publisher plus
 * purpose plus the person's own identifier, and a person may hold rows for more than one publisher. A
 * reader with no row at all holds nothing: a delivered copy and an equal-looking address establish no
 * entitlement, which is why neither is consulted here.
 */
function readingGrantOf(
  session: ResolvedSession,
  memberships: readonly DomainMembership[],
  recipientId: string,
): boolean {
  const publishers = [...new Set(memberships.map((row) => row.publisherId))].sort(compareCodeUnits);
  return publishers.some(
    (publisherId) =>
      canReadProtected(session, {
        audience: "approved-supporter",
        reader: { recipientId, publisherId, purpose: UPDATE_EMAIL_PURPOSE, memberships },
      }).allowed,
  );
}

/**
 * The 168-hour confirmation window of one acceptance, evaluated at `at` and never advanced.
 *
 * The deadline is recomputed from the recorded acceptance by the module that owns the window, so a
 * stored deadline cannot widen it, and the boundary is strict: a confirmation at the deadline instant is
 * too late. A row with no acceptance has no window, which is a different answer from a closed one.
 */
function confirmationWindowOf(
  membership: DomainMembership | undefined,
  at: Temporal.Instant,
): ConfirmationWindowView {
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
    : { state: "expired", deadline: window.deadlineInstant.toString(), remainingMilliseconds: null };
}

/** The query the synthetic inbox accepts. */
export interface InboxQuery {
  /** The one-based page of messages to return. */
  readonly page?: number;
  /** The page size to cut the message list at, capped at 200. */
  readonly pageSize?: number;
}

/**
 * The synthetic inbox of the receiving persona: one message per recipient and notification intent.
 *
 * Each message carries the two renderings the notice builder produced — HTML and a real plain-text
 * alternative — its subject, its safe sender, the copy it pinned and what was recorded for it. A
 * protected notice is a link and a sentence: the builder never receives the Update, so there is nothing
 * for it to excerpt, and the edition behind the link is re-authorised when the reader asks for it. A
 * public message additionally offers the pinned edition as it renders, which is what the reader would
 * see at the link.
 *
 * The dedupe identity is publisher, purpose, recipient and intent, so a second recorded row for one
 * recipient and one intent is dropped rather than shown twice, and the count of distinct intents is
 * reported beside the messages so a duplicate would be visible. Only messages addressed to the caller
 * are enumerated: another person's inbox is not this read's subject and cannot be named by it.
 */
export async function readInbox(query: InboxQuery = {}): Promise<ReadResult<ReadEnvelope<InboxView>>> {
  const worlds = await resolveWorlds("readInbox");
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

    const intent = published.state.notificationIntents.find(
      (candidate) => candidate.intentId === result.intentId,
    );
    const release =
      intent === undefined
        ? undefined
        : published.state.releases.find((candidate) => candidate.releaseId === intent.releaseId);
    const resolved = release === undefined ? undefined : resolveRelease(release, published.state);
    const copy = copies[0];

    if (
      intent === undefined ||
      release === undefined ||
      resolved === undefined ||
      resolved.revision === undefined ||
      resolved.domain === undefined ||
      copy === undefined
    ) {
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
        ? { state: "rendered", href, title: resolved.revision.sharePresentation.title, html: rendered.html }
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
      revision: collectionRevision(
        messages.map((message) => `${message.intentId}@${message.state}`),
      ),
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        "intentCount": countState(data.intentCount),
        "unresolvedIntents": countState(unresolvedIntents),
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
                reason:
                  "No message in this inbox points at an edition this reader may open directly; a protected notice is followed at its link, where access is rechecked.",
              }),
        },
        {
          name: "readSendResult",
          available: messages.length > 0,
          ...(messages.length > 0
            ? {}
            : { reason: "This inbox holds no message, so it has no intent to report results for." }),
        },
        {
          name: "confirmMembership",
          available: false,
          reason:
            "Confirming an address is an explicit action on the preference surface, never a consequence of reading a message or of a page loading.",
        },
      ],
    }),
  };
}


/** The reader's own language preference, from their own rows, or `null` when none is recorded. */
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

/** Whether the caller holds a protected-reading grant for any publisher it holds a row for. */
function grantHeldFor(session: ResolvedSession, scope: Scope, own: World, published: World): boolean {
  return readingGrantOf(
    session,
    readerOwnedMemberships(session, own, published).map((row) => domainMembershipOf(row, scope)),
    session.principalId,
  );
}

/** One release resolved for reading: the domain release, its stored record and its stored revision. */
interface AdmittedEdition {
  readonly record: ReleaseRecord;
  readonly revision: StoredRevision;
  readonly document: ContentDocumentRecord;
  readonly domain: Release;
}

/**
 * The editions of one document this reader could be served, newest first, with everything the locale
 * chain and the reach rule need.
 *
 * A release whose variant, revision, document or instant cannot be resolved is left out: it cannot be
 * rendered, and an edition that cannot be rendered is not an edition a reader is served. Withdrawal and
 * supersession are the locale chain's own filters, applied there rather than repeated here.
 */
function editionsOf(documentId: string, state: StoredState): readonly AdmittedEdition[] {
  const editions: AdmittedEdition[] = [];
  for (const record of state.releases) {
    const resolved = resolveRelease(record, state);
    if (
      resolved.revision === undefined ||
      resolved.document === undefined ||
      resolved.domain === undefined ||
      resolved.document.documentId !== documentId
    ) {
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
    return byPublication === 0
      ? compareCodeUnits(left.record.releaseId, right.record.releaseId)
      : byPublication;
  });
}

/**
 * The language to request when the reader names none: their own preference, else the newest admitted
 * edition's own language.
 *
 * The second answer is a stated default rather than a silent substitution: the read reports the language
 * it served, so a reader who asked for nothing is told which language they were given instead of being
 * told their request was met.
 */
function requestedLocaleOf(
  requested: string | undefined,
  preference: string | null,
  editions: readonly AdmittedEdition[],
): string {
  if (requested !== undefined && requested.length > 0) {
    return requested;
  }
  if (preference !== null && preference.length > 0) {
    return preference;
  }
  return editions[0]?.domain.locale.tag ?? "";
}

/** What resolving one request against one document decided. */
type EditionResolution =
  | {
      readonly status: "served";
      readonly edition: AdmittedEdition;
      readonly locale: ContentLocale;
      readonly fallbackOccurred: boolean;
    }
  | { readonly status: "protected-not-permitted" }
  | { readonly status: "unavailable" };

/**
 * The single resolution a receiving read runs: which edition, in which language, serves this request now.
 *
 * The order is the whole security rule, and it is stated once for both the exact post and the public page:
 * - A reader whose grant holds is offered the approved-supporter edition first, because it is the more
 *   specific edition of this document, and falls back to the public one only when no protected edition
 *   serves the request.
 * - A reader whose grant does not hold is offered the public editions first, so a language published
 *   publicly is served without disclosing anything; only when nothing public serves the request is the
 *   protected audience consulted, and a request it would satisfy becomes `protected-not-permitted`. That
 *   is the one case where the grant decision is the reason, and a language that exists in neither audience
 *   stays `unavailable`, so a refusal never advertises an edition the reader was not asking for.
 */
function resolveEditionFor(input: {
  readonly document: ContentDocumentRecord;
  readonly editions: readonly AdmittedEdition[];
  readonly requestedLocale: string;
  readonly grantHeld: boolean;
}): EditionResolution {
  const attempt = (
    audience: ContentAudience,
  ): { readonly edition: AdmittedEdition; readonly locale: ContentLocale; readonly fallbackOccurred: boolean } | undefined => {
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
    const chosen = candidates.find(
      (edition) => edition.record.releaseId === resolution.release.releaseId,
    );
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
  return attempt("approved-supporter") === undefined
    ? { status: "unavailable" }
    : { status: "protected-not-permitted" };
}

/** The query the receiving list accepts. */
export interface ReceivingListQuery {
  /** The language the reader asks for, which orders and labels the list and never widens access. */
  readonly locale?: string;
  /** The one-based page of editions to return. */
  readonly page?: number;
  /** The page size to cut the list at, capped at 200. */
  readonly pageSize?: number;
}

/**
 * The Updates a receiving reader may open now.
 *
 * Access is rechecked at this instant against the current releases, never against a cached membership or
 * a stale release pointer: an edition that was withdrawn, superseded or narrowed since the last visit is
 * absent from this read, and no count of the editions this reader may not see is returned — the total is
 * the authorised count, because a count of hidden editions would let a refusal be measured.
 *
 * A public edition is readable by anyone. A protected edition appears only for a reader whose grant holds
 * now, so an unauthorised reader receives the authorised list and learns nothing about the protected
 * editions beside it: no title, no locale, no count.
 */
export async function readReceivingList(
  query: ReceivingListQuery = {},
): Promise<ReadResult<ReadEnvelope<ReceivingListView>>> {
  const worlds = await resolveWorlds("readReceivingList");
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
    if (
      resolved.domain === undefined ||
      resolved.revision === undefined ||
      resolved.document === undefined ||
      resolved.document.family !== "update"
    ) {
      continue;
    }
    // Withdrawal and supersession end an edition's service, and a `not-public` edition serves nobody on
    // this list. The reach rule is the one authority for what a release may serve.
    if (resolved.domain.withdrawnAt !== undefined || resolved.domain.supersededBy !== undefined) {
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
      revision: collectionRevision(
        editions.map((edition) => `${edition.releaseId}@${edition.reach}`),
      ),
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        "page.total": countState(window.total),
        "page.pageCount": countState(window.pageCount),
        "languagePreference": textState(preference),
      },
      actions: [
        {
          name: "readEdition",
          available: editions.length > 0,
          ...(editions.length > 0
            ? {}
            : {
                reason:
                  "No edition is available to this reader at this instant; an edition published later appears here without changing this reader's entitlements.",
              }),
        },
      ],
    }),
  };
}

/** The query the exact-post view accepts. */
export interface ReceivingPostQuery {
  /** The canonical Update to open. */
  readonly updateId: string;
  /** The language the reader asks for; the read states the language actually served. */
  readonly locale?: string;
}

/**
 * One Update at its exact post, re-authorised on every open.
 *
 * The audience is decided now: a protected edition is served only to a reader whose grant holds at this
 * instant, so a copied URL, a switched locale or a copy already received cannot admit anyone. Fallback
 * resolves within this document, this Site and this audience using admitted releases only, and the
 * language actually served is stated: when no admitted edition can serve the request the state is
 * `language-unavailable`, which is a distinct answer rather than an empty page or a substituted edition.
 */
export async function readReceivingPost(
  query: ReceivingPostQuery,
): Promise<ReadResult<ReadEnvelope<ReceivingPostView>>> {
  const worlds = await resolveWorlds("readReceivingPost");
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, own, published } = worlds;

  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }

  const at = scenarioInstant(session);
  const document = published.state.contentDocuments.find(
    (candidate) => candidate.documentId === query.updateId && candidate.family === "update",
  );
  if (document === undefined) {
    // A refused document and a document that does not exist answer alike, because a distinguishable
    // refusal would let a caller enumerate what it may not read.
    return deniedRead("no-permission");
  }

  const grantHeld = grantHeldFor(session, scope, own, published);
  const editions = editionsOf(document.documentId, published.state).filter(
    (edition) => edition.domain.withdrawnAt === undefined && edition.domain.supersededBy === undefined,
  );
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
        valueStates: { "requestedLocale": textState(requestedLocale) },
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
        "title": textState(data.title),
        "servedLocale.tag": textState(served.locale.tag),
        "publishedAt": textState(data.publishedAt),
        "renditions": countState(data.renditions.length),
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
  /** The one-based page of listed editions to return. */
  readonly page?: number;
  /** The page size to cut the index at, capped at 200. */
  readonly pageSize?: number;
}

/**
 * The discovery index: the page editions that reach a public listing, and nothing else.
 *
 * The index is a projection over the current releases, not a claim about them: a `not-public` edition is
 * absent, a `link-public` edition is absent because it is public but unlisted, and an edition withdrawn a
 * moment ago is absent from the same read that records the withdrawal — no cache outlives the rule.
 * Each entry carries the indexing decision the route emits, so no route re-derives reach, and no count of
 * the editions that are not listed is returned.
 */
export async function readDiscoveryIndex(
  query: DiscoveryIndexQuery = {},
): Promise<ReadResult<ReadEnvelope<DiscoveryIndexView>>> {
  const worlds = await resolveWorlds("readDiscoveryIndex");
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
    if (
      resolved.document === undefined ||
      resolved.revision === undefined ||
      resolved.domain === undefined ||
      resolved.document.family === "update"
    ) {
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
          ...(entries.length > 0
            ? {}
            : { reason: "No page edition is listed publicly at this instant." }),
        },
      ],
    }),
  };
}

/** The query the public reading view accepts. */
export interface ReceivingPageQuery {
  /** The canonical Page the link names. */
  readonly pageId: string;
  /** The language the link asks for; the read states the language actually served. */
  readonly locale?: string;
}

/**
 * One page edition served by direct link, re-authorised on every request.
 *
 * Reach decides what this route may serve: a `listed` edition is served normally, a `link-public` edition
 * is served with the `noindex` decision in the data so the route sets its metadata without re-deriving
 * reach, and a `not-public` edition is refused. A withdrawn edition answers a non-identifying tombstone
 * for every locale — no title, no excerpt, no media reference — because containment is immediate and
 * total, and a link already shared must not read as "this never existed" or as "try again".
 *
 * The Give placement states the one approved designation the release binds, or *Giving unavailable*: there
 * is no fallback fund, and the surface is inert, so no action here can start a payment.
 */
export async function readReceivingPage(
  query: ReceivingPageQuery,
): Promise<ReadResult<ReadEnvelope<ReceivingPageView>>> {
  const worlds = await resolveWorlds("readReceivingPage");
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, own, published } = worlds;

  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }

  const at = scenarioInstant(session);
  const document = published.state.contentDocuments.find(
    (candidate) => candidate.documentId === query.pageId && candidate.family !== "update",
  );
  if (document === undefined) {
    return deniedRead("no-permission");
  }

  const grantHeld = grantHeldFor(session, scope, own, published);
  const editions = editionsOf(document.documentId, published.state);
  const live = editions.filter(
    (edition) =>
      edition.domain.withdrawnAt === undefined && edition.domain.supersededBy === undefined,
  );
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
            valueStates: { "requestedLocale": textState(requestedLocale) },
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
        valueStates: { "requestedLocale": textState(requestedLocale) },
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
        "title": textState(data.title),
        "servedLocale.tag": textState(served.locale.tag),
        "renditions": countState(data.renditions.length),
        "giving.state": textState(giving.state),
      },
      // A public reading view offers no action: it is inert, and a Give placement is a labelled simulation
      // that starts no payment, so no checkout action can appear here.
      actions: [],
    }),
  };
}


/**
 * Why one recorded outcome may not be attempted again, in the words the surface shows.
 *
 * Each answer is a different fact: acceptance is never repeated, an unknown outcome is recovered by
 * re-querying the same intent rather than by submitting again, and a failure is only retryable while its
 * usefulness window is open.
 */
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
  /** The notification intent whose results are reported. */
  readonly intentId: string;
  /** The one-based page of recipient rows to return. */
  readonly page?: number;
  /** The page size to cut the rows at, capped at 200. */
  readonly pageSize?: number;
}

/**
 * The per-send results of one notification intent.
 *
 * The three states are exactly accepted, failed and unknown, and none of them is a claim that a mailbox
 * received the copy or that anyone read it: there is no field here of that kind and no instant of that
 * kind. Each row carries the one rendition pinned for that person and that intent, so a person eligible for
 * two audiences or two languages has one row and one copy, and the dedupe identity is reported so a second
 * row for the same person would be visible as the same identity.
 *
 * The 24-hour usefulness window is evaluated strictly at this instant by the module that owns it, and the
 * ceiling the intent was accepted for is reported apart from the recorded set: a later signup never expands
 * an accepted ceiling. An accepted or uncertain row offers no second submission: its only action is to re-query the
 * same intent, which returns this record rather than producing a second copy.
 *
 * A worker admitted to the ministry sees every recipient of the intent; a reader sees only their own row,
 * because enumerating an audience to someone who holds no authority over it would disclose it.
 */
export async function readSendResult(
  query: SendResultQuery,
): Promise<ReadResult<ReadEnvelope<SendResultView>>> {
  const worlds = await resolveWorlds("readSendResult");
  if (!worlds.ok) {
    return worlds.result;
  }
  const { session, published } = worlds;

  const scope = scopeOf(session, published);
  if (scope === undefined) {
    return deniedRead("no-membership");
  }

  const at = scenarioInstant(session);
  const intent = published.state.notificationIntents.find(
    (candidate) => candidate.intentId === query.intentId,
  );
  if (intent === undefined) {
    return deniedRead("no-permission");
  }

  const results = published.state.notificationResults.filter(
    (candidate) => candidate.intentId === intent.intentId,
  );
  const admitted = admittedToWorld(session, published);
  const pairs = results.flatMap((result) =>
    result.recipients
      .filter((copy) => admitted || copy.recipientId === session.principalId)
      .map((copy) => ({ result, copy })),
  );
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
  const ordered = [...byRecipient.values()].sort((left, right) =>
    compareCodeUnits(left.copy.recipientId, right.copy.recipientId),
  );

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

  const recordedAt = results
    .map((result) => result.recordedAt)
    .sort((left, right) => compareCodeUnits(right, left))[0] ?? null;

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
      revision: collectionRevision(
        rows.map((row) => `${row.recipientId}@${row.state}@${row.renditionId}`),
      ),
      asOf: at.toString(),
      coverage: { from: null, to: at.toString(), state: "complete" },
      valueStates: {
        "ceilingCount": countState(intent.ceilingCount),
        "counts.accepted": countState(counts.accepted),
        "counts.failed": countState(counts.failed),
        "counts.unknown": countState(counts.unknown),
        "page.total": countState(window.total),
        "page.pageCount": countState(window.pageCount),
        "usefulness.remainingMilliseconds":
          data.usefulness.remainingMilliseconds === null
            ? "unknown"
            : countState(data.usefulness.remainingMilliseconds),
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
          ...(rows.length > 0
            ? {}
            : { reason: "This intent has recorded no recipient outcome yet." }),
        },
      ],
    }),
  };
}

