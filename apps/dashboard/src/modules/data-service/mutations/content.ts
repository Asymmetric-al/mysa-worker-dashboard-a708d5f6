/**
 * The twenty-three content and media mutations: everything the Ministry Updates family and the Worker
 * and Project Page families change, and nothing that only reads.
 *
 * Plan items this file serves: AAP 0.6.1's row "Mutations: content and media"
 * (`createVariant`, `saveDraft`, `submitForReview`, `approveCandidate`, `requestChanges`,
 * `rejectCandidate`, `publishVariants`, `requestNotification`, `withdrawUpdate`, `withdrawPage`,
 * `withdrawLocale`, `setReach`, `stopShowingPublicly`, `restoreRevisionAsDraft`, `addSection`,
 * `moveSection`, `duplicateSection`, `removeSection`, `saveSectionFields`, `applyPreset`,
 * `registerMediaAsset`, `replacePlacement`, `removePlacement`); AAP 0.7.1's job rows "Write and
 * release an Update", "Build and release a Page" and "Attach media"; AAP 0.8.5 (publication,
 * notification, consent), 0.8.6 (pages, giving, localization, media) and 0.8.7 (media limits, review
 * steps, notification usefulness); and success criteria 9, 10, 11, 12, 17 and 18.
 *
 * **The three media mutations live here because the release has no `mutations/media.ts`.** A
 * sixth file would be a second write path over the same records and one more place the runner's
 * order could be restated, so registering an asset, replacing a placement and removing one are
 * mutations of the content record like the rest.
 *
 * **One runner, one ledger, one schema per mutation.** Every export below hands `runMutation` its own
 * concrete Zod payload schema and its own concrete apply function, and answers with the closed
 * outcome set from `../outcome`: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`,
 * `invalid`, `unavailable` or `unknown`. Nothing here validates the four-field envelope, compares a
 * revision, opens a transaction or writes a ledger entry — `../operations` owns that order, and a
 * mutation that repeated any of it would be a second implementation of the same contract.
 *
 * **The distinctions this file exists to keep.**
 *
 * - A draft, a candidate, a release and a withdrawal are four states of one edition. Saving a draft
 *   moves `draftRevisionId` and touches neither `candidateId` nor `releaseHeadId`; freezing a
 *   candidate records one exact revision; only publishing creates a release; only withdrawal stops
 *   serving one. No CMS-style status saves a draft *as* a release.
 * - A candidate is reviewed exactly once. Its identity is the frozen revision's identity, so the
 *   candidate a reviewer read is the copy a release publishes, and a later edit cannot become what
 *   was approved.
 * - A reviewer cannot turn "Publish only" into "Publish and notify now". The submission's mode is the
 *   recorded one, and a request to change it is refused with "a new submission is required".
 * - A release is reported per variant. One edition releasing while a sibling fails preserves both: the
 *   success stands and the failed edition keeps its prior-good head, and there is no batch rollback.
 * - Publication is not notification, and neither is acceptance, delivery or reading. This file
 *   produces the first two and models the third only as a recorded per-recipient state; it claims
 *   nothing about a mailbox or an open, and an uncertain submission is recovered by its
 *   `operationId` rather than by sending again under a fresh identity.
 * - Reach is exactly `not-public`, `link-public` or `listed`; the second is public but unlisted and
 *   `noindex`. *Stop showing me publicly* contains every locale edition immediately and completes
 *   while an unrelated draft is invalid, because containment never waits for editorial cleanup.
 * - A placement carries required alternative text and an optional caption; the original upload is
 *   never served, the original file name never reaches a consumer, and every rendition read
 *   re-authorises on its own — nothing here creates a public address.
 *
 * **Why a revision token is compared where it is.** Each mutation states the record whose revision it
 * expects, and that record is the one the initiating surface read: the document for document-level
 * actions (creating a variant, publishing, reach, withdrawal, notification), the revision record for
 * editorial actions (saving a draft, submitting, reviewing, section edits), and the variant for a
 * single edition's withdrawal. A draft save deliberately does not advance the document's revision, so
 * a structural action taken from a document envelope is not invalidated by ordinary writing.
 *
 * **Where a content decision lives.** Every rule about identity, freeze, reach, locale and rendition
 * belongs to `@/modules/content/*`, and every rule about a media profile belongs to
 * `@/modules/media/*`. This file calls those modules; it never re-implements a schema, a freeze, a
 * reach rule, a locale fallback, a rendition resolution or a profile check. Two narrow bridges are
 * restated here because they are private to the reads that own them and this file may not import a
 * read: the stored-to-domain membership and release adapters the receiving read also keeps, and the
 * eight-key page catalogue the page read also keeps. Each is data, not a rule.
 *
 * Layering: `app` -> `features` -> `components` -> `modules/data-service` -> `modules/store`. This is
 * a `mutations/*` member of the data service: it is reached by a thin route handler and by the domain
 * and integration tests, and it imports no component, feature or application route. It reads the
 * scenario clock through `@/modules/time/clock` and every deadline through `@/modules/time/window`; no
 * machine clock is read anywhere in it. The one exception to the service's no-I/O rule is stated at
 * {@link persistRenditionBytes}, and it exists because a prepared rendition has to become bytes a
 * scope-checked route can serve.
 *
 * Rule 1 obligations this file keeps. Clause 1: no CMS adapter, second editor, provider client,
 * scheduler, queue or outbox appears here, and every external effect stays simulated and is labelled
 * by the surface that triggers it. Clause 2: one runner, one ledger, one schema per mutation, one
 * content model and one media model, all called rather than copied. Clause 3: draft, candidate,
 * release and withdrawn stay distinct, publication is never notification or delivery, and an
 * undetermined effect stays `unknown` and is recovered by identity.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { isRecord } from "@/lib/guards";
import {
  UPDATE_EMAIL_PURPOSE,
  type MemberChoice,
  type MembershipRecord as DomainMembership,
} from "@/modules/audience/membership";
import {
  eligibleRecipients,
  type EligibilityResult,
  type NotificationIntent as EligibilityIntent,
} from "@/modules/audience/resolve";
import {
  parseDocument,
  presentationChoiceSchema,
  type ContentDocumentJson,
  type ContentSection,
  type DocumentIssue,
  type PresentationChoice,
} from "@/modules/content/document";
import { directionOfTag } from "@/modules/content/locale";
import {
  buildNotice,
  resolveRendition,
  type NoticeRecipient,
  type RenditionCandidate as NoticeRenditionCandidate,
} from "@/modules/content/notice";
import { containEditions, decideReach, withdrawEdition } from "@/modules/content/reach";
import {
  admittedAudiences,
  applyDraftRevision,
  applyReleaseOutcome,
  applyReviewDecision,
  createRelease,
  createRevision,
  createVariant as buildVariant,
  freezeCandidate,
  isReleaseUnchanged,
  restoreAsNewDraft,
  revisionChecksum,
  variantKeyAllowed,
  type ContentRevision,
  type ContentVariant,
  type MediaPlacement,
  type Release,
  type SharePresentation,
  type VariantAudience,
  type VariantFamily,
} from "@/modules/content/variant";
import { DATA_ROOT } from "@/modules/store/paths";
import {
  acceptImage,
  acceptVideo,
  mediaStateReason,
  prepareRendition,
  type MediaAcceptanceSuccess,
  type MediaAssetScope,
  type MediaProfileCheck,
  type MediaRefusal,
  type MediaRendition,
  type MediaTagVerification,
} from "@/modules/media/asset";
import { instantAt } from "@/modules/time/clock";
import { notificationDeadline } from "@/modules/time/window";

import { canEdit, type ResolvedSession, type ScopeDecision } from "../authorize";
import {
  CONTENT_AUDIENCES,
  CONTENT_FAMILIES,
  contentCaptionTrackRecordSchema,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  mediaAssetRecordSchema,
  mediaPlacementRecordSchema,
  membershipRecordSchema,
  notificationIntentRecordSchema,
  notificationSendResultRecordSchema,
  principalIdSchema,
  recordRevisionSchema,
  releaseRecordSchema,
  releaseReachSchema,
  sharePresentationRecordSchema,
  storedInstantSchema,
  type ContentCaptionTrackRecord,
  type ContentDocumentRecord,
  type ContentFamily,
  type ContentVariantRecord,
  type MediaAssetRecord,
  type MediaAssetRenditionPurpose,
  type MediaPlacementRecord,
  type MembershipRecord as StoredMembership,
  type MutationInput,
  type PrincipalId,
  type NotificationIntentRecord,
  type NotificationRecipientOutcomeRecord,
  type NotificationSendResultRecord,
  type ReleaseReach,
  type ReleaseRecord,
  type Scope,
  type SharePresentationRecord,
} from "../envelope";
import { type MutationOutcome, type PerItemResult } from "../outcome";
import { runMutation, type ApplyResult, type CurrentTarget } from "../operations";

// ---------------------------------------------------------------------------------------------
// Closed vocabularies this file owns
// ---------------------------------------------------------------------------------------------

/**
 * How a candidate is meant to be released. The pair is closed because the choice is the submitter's
 * and the reviewer's, and because a third value would silently become a second way to notify.
 */
export const PUBLISH_MODES = ["publish-only", "publish-and-notify"] as const;

/** One release mode, derived from {@link PUBLISH_MODES}. */
export type PublishMode = (typeof PUBLISH_MODES)[number];

/**
 * What one release attempt produced for one edition.
 *
 * Three states, because they say three different things: the edition released; it did not, and the
 * revision it had already published is still what readers are served; or it needs attention before it
 * can release. None of them is a lifecycle word — that is derived from the records by the surface —
 * and a sibling's failure is never reported as a rollback of the editions that did release.
 */
export const PER_VARIANT_RELEASE_STATES = [
  "released",
  "failed-prior-good-head",
  "needs-attention",
] as const;

/** One per-variant release state, derived from {@link PER_VARIANT_RELEASE_STATES}. */
export type PerVariantReleaseState = (typeof PER_VARIANT_RELEASE_STATES)[number];

/**
 * The decision a review of one frozen candidate has reached. `submitted` is a review that has not
 * been answered yet; the other three are the reviewer's three answers, and a candidate that receives
 * one is never re-reviewed — a second round is a new submission with a new revision.
 */
export const REVIEW_DECISIONS = ["submitted", "approved", "changes-requested", "rejected"] as const;

/** One review decision, derived from {@link REVIEW_DECISIONS}. */
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * The eight section types a page catalogue offers, declared once for both Page families.
 *
 * These are the catalogue keys a stored section's `element` names, and there are exactly eight. The
 * words for them — labels, descriptions and the lock sentences — belong to
 * `features/ministry-pages/copy.ts`, which must not be imported from the service, so the keys are
 * declared here as data and this file states no sentence of them. The page read declares the same
 * eight for the catalogue it serves.
 */
const PAGE_SECTION_TYPES = [
  "introduction",
  "story",
  "prayer",
  "milestone",
  "image",
  "video",
  "giving",
  "progress",
] as const;

/** One section type a page builder may add. */
type PageSectionType = (typeof PAGE_SECTION_TYPES)[number];

/**
 * The field keys each section type edits. A `giving` and a `progress` section edit no field at all:
 * the source supplies both, so the builder shows them locked rather than empty and this file refuses
 * a field they do not have.
 */
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

/**
 * The two section types a source owns. They are locked with a reason and are never added, moved,
 * duplicated or removed by an author, because their content is the source's.
 */
const MANAGED_SECTION_TYPES: ReadonlySet<string> = new Set<string>(["giving", "progress"]);

/** The presentation a newly added section starts from: the profile's first admitted value of each pair. */
const DEFAULT_PRESENTATION: PresentationChoice = {
  treatment: "normal",
  layout: "single-column",
  alignment: "start",
  imageFit: "cover",
};

/**
 * The two presets a catalogue proposes. A preset composes admitted sections into the draft and
 * publishes nothing, so applying one always produces something for review rather than a release.
 */
const PAGE_PRESETS: Readonly<Record<string, readonly PageSectionType[]>> = {
  "preset-opening-and-story": ["introduction", "story"],
  "preset-story-and-prayer": ["story", "prayer"],
};

const PAGE_PRESET_IDS = ["preset-opening-and-story", "preset-story-and-prayer"] as const;

/**
 * The publisher's own configured sending identity, as this synthetic release can state it.
 *
 * No provider credential exists and no mail leaves the application, so the sender is the
 * application's labelled stand-in in the reserved `.invalid` domain, which can never reach a real
 * mailbox. It mirrors the stand-in the receiving read states beside the message it renders, because
 * one notice must not be described two ways.
 */
const NOTICE_SENDER = Object.freeze({
  name: "Update notices",
  address: "update-notice@example.invalid",
});

/**
 * The display name a notice speaks for when this file cannot establish one.
 *
 * A blank value makes the notice builder state its anonymous wording, which is the honest form: a
 * stored content document carries a source reference and never a display name.
 */
const UNNAMED_PUBLISHER = "";

// ---------------------------------------------------------------------------------------------
// Stored records this file reads and writes
// ---------------------------------------------------------------------------------------------

/**
 * One stored content revision.
 *
 * `body` is `unknown` on purpose: the content profile — its admitted nodes, marks, heading levels and
 * bounded presentation choices — is owned by `modules/content/document`, and its validator is what
 * refuses a document the profile does not admit. Parsing the envelope here (identity, checksum,
 * placements, share presentation) is what lets a missing or malformed revision be reported rather
 * than half-read.
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

/** One stored content revision as this file reads it. */
type StoredContentRevision = z.infer<typeof storedContentRevisionSchema>;

/**
 * One recorded review: the evidence that a frozen candidate was submitted, and the answer a reviewer
 * gave it.
 *
 * The candidate record itself is immutable and carries the exact revision it froze, so the decision
 * is recorded beside it rather than on it. `notifyMode` is the submitter's choice and is the mode a
 * release may carry; a reviewer's request for a different mode is refused rather than recorded here.
 */
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

/** One recorded review as this file reads it. */
type ContentReviewRecord = z.infer<typeof contentReviewRecordSchema>;

/**
 * What one registered asset says about itself to a placement: the text a reader is given when the
 * media cannot be seen, and the descriptive fields a placement inherits.
 *
 * The media asset record states bytes, profile facts and renditions and deliberately states no prose,
 * so the description a registration validated is kept beside it. A placement written later therefore
 * has required alternative text without the caller restating it, and an image cannot arrive in a
 * draft undescribed.
 */
const mediaAssetDescriptorRecordSchema = z.object({
  assetId: z.string().min(1),
  altText: z.string().min(1).nullable(),
  caption: z.string().min(1).nullable(),
  credit: z.string().min(1).nullable(),
  language: z.string().min(1).nullable(),
  revision: recordRevisionSchema,
});

/** One registered asset's descriptor, as this file reads it. */
type MediaAssetDescriptorRecord = z.infer<typeof mediaAssetDescriptorRecordSchema>;

/**
 * The record families of one session's state document that these mutations read or change.
 *
 * The families are required rather than optional: the store's own document builder writes every one
 * of them, so a document that has lost one is a document this build cannot read, and reporting that
 * as `unavailable` is the honest answer — reading it as an empty collection would let a write replace
 * records it never saw. The two families this file adds are optional, so a session seeded before they
 * existed still reads.
 */
const contentMutationStateSchema = z.object({
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  contentRevisions: z.array(storedContentRevisionSchema),
  releases: z.array(releaseRecordSchema),
  mediaAssets: z.array(mediaAssetRecordSchema),
  memberships: z.array(membershipRecordSchema),
  notificationIntents: z.array(notificationIntentRecordSchema),
  notificationResults: z.array(notificationSendResultRecordSchema),
  contentReviews: z.array(contentReviewRecordSchema).optional(),
  mediaAssetDescriptors: z.array(mediaAssetDescriptorRecordSchema).optional(),
});

/**
 * The content families of one state document, as this file reads them.
 *
 * Every collection is readonly: a mutation assembles the next value of the families it changes and
 * hands them to `writeState`, so no code here can mutate a record a decision did not produce.
 */
interface ContentMutationState {
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
}

// ---------------------------------------------------------------------------------------------
// Shared primitives: identity, revisions, instants, and the stored/domain bridge
// ---------------------------------------------------------------------------------------------

/** The suffix a freshly minted revision token advances from, so a record's first token is readable. */
const INITIAL_REVISION_TOKEN = "rev-1";

/**
 * Mints the identity of one new record.
 *
 * The value is random rather than derived: no identity here is built from a title, a locale, a name,
 * a date or a counter, so two editions that look alike still have two identities, and a replay never
 * mints a second one because a replay does not reach an apply function at all.
 */
function newRecordId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

/**
 * The next optimistic-concurrency token for one record.
 *
 * A token is opaque: callers state it and compare it, and nothing parses its parts. The trailing
 * number is advanced when a stored token has one so a reader can see that a record moved, and a token
 * without one gains a suffix rather than being replaced by an unrelated value.
 */
function nextRevision(current: string): string {
  const digits = /^(.*?)(\d+)$/u.exec(current);
  if (digits === null) {
    return `${current}.1`;
  }
  const stem = digits[1] ?? "";
  const ordinal = Number.parseInt(digits[2] ?? "", 10);
  return `${stem}${Number.isFinite(ordinal) ? ordinal + 1 : 1}`;
}

/** The change counter a stored membership token states, read as the ordinal its domain record carries. */
function revisionOrdinal(revision: string): number {
  const digits = /(\d+)\s*$/u.exec(revision);
  if (digits === null) {
    return 1;
  }
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * The scenario instant this request runs at.
 *
 * It is the session's own offset applied to the one fixed seed anchor, which is the same instant the
 * reads evaluate a window against: a mutation stamped from a process-wide default would disagree with
 * the read that judged the same boundary, and a session that moved its clock would record an instant
 * its own surfaces do not share.
 */
function scenarioInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}

/** Reads a stored instant, or `undefined` when the stored value is absent or unreadable. */
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

/** Raises a validation refusal from inside an apply function, at the paths a form already addresses. */
function invalidAt(issues: readonly DocumentIssue[]): z.ZodError {
  return new z.ZodError(
    issues.map((issue) => ({
      code: "custom" as const,
      path: issue.path.split("."),
      message: issue.message,
    })),
  );
}

/** The refusal for one field, as the apply function raises it. */
function invalidField(path: string, message: string): z.ZodError {
  return invalidAt([{ path, message }]);
}

/**
 * The stored document as the domain document the variant model validates.
 *
 * The two shapes state the same identity and differ in one member: the stored record names the fields
 * the source manages, while the domain record carries their values. A variant key is decided from
 * identity alone, so no managed value is needed here and none is invented.
 */
function domainDocumentOf(record: ContentDocumentRecord): {
  readonly documentId: string;
  readonly family: VariantFamily;
  readonly kind: ContentDocumentRecord["kind"];
  readonly sourceSubject: ContentDocumentRecord["sourceSubject"];
  readonly siteId: string;
  readonly givingBinding?: ContentDocumentRecord["sourceSubject"];
  readonly managedFields: Readonly<Record<string, string>>;
} {
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

/** One stored variant as the domain variant, with an unmoved pointer left absent. */
function domainVariantOf(record: ContentVariantRecord): ContentVariant {
  return {
    variantId: record.variantId,
    documentId: record.documentId,
    audience: record.audience,
    locale: { tag: record.locale, direction: record.direction },
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

/**
 * One stored variant as the record a write persists, from the domain variant a decision produced.
 *
 * `revision` is the token this write advances; every other field is carried from the domain value, and
 * an absent pointer is written as `null` because that is how the stored form says "not yet".
 */
function storedVariantOf(variant: ContentVariant, revision: string): ContentVariantRecord {
  return {
    variantId: variant.variantId,
    documentId: variant.documentId,
    audience: variant.audience,
    locale: variant.locale.tag,
    direction: variant.locale.direction,
    draftRevisionId: variant.draftRevisionId ?? null,
    candidateId: variant.candidateId ?? null,
    releaseHeadId: variant.releaseHeadId ?? null,
    translationSource:
      variant.translationSource === undefined
        ? null
        : {
            variantId: variant.translationSource.variantId,
            revisionId: variant.translationSource.revisionId,
          },
    revision,
  };
}

/** One stored revision as the domain revision, from the record and the document the profile admits. */
function domainRevisionOf(
  record: StoredContentRevision,
  document: ContentDocumentJson,
): ContentRevision {
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
    sharePresentation: {
      ...(record.sharePresentation.title.length === 0
        ? {}
        : { title: record.sharePresentation.title }),
      ...(record.sharePresentation.description.length === 0
        ? {}
        : { description: record.sharePresentation.description }),
      ...(record.sharePresentation.imageAssetId === null
        ? {}
        : { imageAssetId: record.sharePresentation.imageAssetId }),
    },
    contentChecksum: record.contentChecksum,
    authorPrincipalId: record.authorPrincipalId,
    createdAt: Temporal.Instant.from(record.createdAt),
  };
}

/** One stored release as the domain release a withdrawal or reach decision reads. */
function domainReleaseOf(
  record: ReleaseRecord,
  variant: ContentVariantRecord | undefined,
  checksum: string,
): Release {
  const withdrawnAt = instantOf(record.withdrawnAt);
  return {
    releaseId: record.releaseId,
    variantId: record.variantId,
    revisionId: record.revisionId,
    audience: record.audience,
    locale: { tag: record.locale, direction: variant?.direction ?? directionOfTag(record.locale) },
    publishedAt: Temporal.Instant.from(record.publishedAt),
    reach: record.reach,
    contentChecksum: checksum,
    ...(withdrawnAt === undefined ? {} : { withdrawnAt }),
    ...(record.supersededBy === null ? {} : { supersededBy: record.supersededBy }),
  };
}

/**
 * Adapts one stored membership to the record the audience module decides from.
 *
 * The stored form and the domain record state the same facts in different shapes, and this is the one
 * place this file bridges them: a person's identity is the membership's own identifier (never an
 * address), the Off/Immediate choice follows the state, a row that is not awaiting proof and recorded
 * an acceptance has passed the proof step, and the scope is the ministry whose documents hold the row.
 * The receiving read keeps the same bridge because it is private to its own file.
 */
function domainMembershipOf(record: StoredMembership, scope: Scope): DomainMembership {
  const acceptedAt = instantOf(record.acceptedAt);
  const confirmation = instantOf(record.confirmationDeadline);
  const choice: MemberChoice =
    record.state === "off" || record.state === "restricted" ? "off" : "immediate";
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
    ...(acceptedAt !== undefined && record.state !== "awaiting-proof"
      ? { confirmedAt: acceptedAt }
      : {}),
    ...(confirmation === undefined ? {} : { confirmationDeadline: confirmation }),
    revision: revisionOrdinal(record.revision),
  };
}

/** The editorial authority every mutation in this file asks first. */
function editorialDecision(session: ResolvedSession, scope: Scope): ScopeDecision {
  const access = canEdit(session, { kind: "content-variant", scope });
  return access.allowed ? { ok: true } : { ok: false, denial: access.denial };
}

/**
 * The revision a caller named that this document does not hold.
 *
 * A stale expectation is the honest answer for a record the caller named and this scope cannot
 * resolve: it is not a creation, it is not "nothing changed", and it carries no title, count or size
 * of anything — only that what the caller read is no longer what this scope holds.
 */
const UNRESOLVED_TARGET_REVISION = "no-such-record";

/** The target of a change whose record this scope does not hold. */
function unresolvedTarget(): CurrentTarget {
  return { kind: "record", revision: UNRESOLVED_TARGET_REVISION, value: null };
}

/** The target of a change to one existing record. */
function recordTarget(revision: string, value: unknown): CurrentTarget {
  return { kind: "record", revision, value };
}

/**
 * A refusal raised when the session's state document cannot be read as the record families this file
 * writes.
 *
 * The name is the store's own corrupt-document fault name, so the runner's single error mapping
 * answers `unavailable` for the local store rather than `unknown`: a document that cannot be decoded
 * is a source that could not answer, and a write that guessed at its contents would replace records
 * it never read.
 */
class ContentStateReadError extends Error {
  constructor() {
    super(
      "The content records in this session's state document cannot be read, so nothing was written and no record was guessed at.",
    );
    this.name = "CorruptJsonError";
    Object.setPrototypeOf(this, ContentStateReadError.prototype);
  }
}

/** One opened state document: the stored object, and the record families validated out of it. */
interface OpenedState {
  /** The stored object exactly as it was read, so a write replaces only the families it changed. */
  readonly raw: Record<string, unknown>;
  /** The validated content families. */
  readonly state: ContentMutationState;
}

/** Opens a session's state document, refusing a document this build cannot read. */
function openState(docs: { readonly state: unknown }): OpenedState {
  if (!isRecord(docs.state)) {
    throw new ContentStateReadError();
  }
  const parsed = contentMutationStateSchema.safeParse(docs.state);
  if (!parsed.success) {
    throw new ContentStateReadError();
  }
  return {
    raw: docs.state,
    state: {
      ...parsed.data,
      // A session seeded before these two families existed still reads: the absent collection is a
      // session with no recorded review and no registered description yet, not a damaged document.
      contentReviews: parsed.data.contentReviews ?? [],
      mediaAssetDescriptors: parsed.data.mediaAssetDescriptors ?? [],
    },
  };
}

/**
 * Writes the families a mutation changed back into the transaction's draft document.
 *
 * Only the named families are replaced: every other record family the session holds — partners, gifts,
 * tasks, coaching, an import proposal — is carried through untouched, because a write that rebuilt the
 * document from this file's own schema would silently drop the families it does not read.
 */
function writeState(
  docs: { state: unknown },
  opened: OpenedState,
  next: Partial<ContentMutationState>,
): void {
  docs.state = { ...opened.raw, ...next };
}

/** The document, variant or revision a payload names, or the refusal its absence answers. */
function requireDocument(state: ContentMutationState, documentId: string): ContentDocumentRecord {
  const record = state.contentDocuments.find((candidate) => candidate.documentId === documentId);
  if (record === undefined) {
    throw invalidField("documentId", "This action applies to a document this context does not hold.");
  }
  return record;
}

/** One stored variant, or the refusal its absence answers. */
function requireVariant(state: ContentMutationState, variantId: string): ContentVariantRecord {
  const record = state.contentVariants.find((candidate) => candidate.variantId === variantId);
  if (record === undefined) {
    throw invalidField("variantId", "This action applies to an edition this context does not hold.");
  }
  return record;
}

/** One stored revision, or the refusal its absence answers. */
function requireRevision(state: ContentMutationState, revisionId: string): StoredContentRevision {
  const record = state.contentRevisions.find((candidate) => candidate.revisionId === revisionId);
  if (record === undefined) {
    throw invalidField("revisionId", "This action applies to a revision this edition does not hold.");
  }
  return record;
}

/** The head release a variant currently publishes, when it publishes one. */
function headReleaseOf(
  state: ContentMutationState,
  variant: ContentVariantRecord,
): ReleaseRecord | undefined {
  if (variant.releaseHeadId === null) {
    return undefined;
  }
  return state.releases.find((candidate) => candidate.releaseId === variant.releaseHeadId);
}

/** Every release one document's editions hold, in a stable order. */
function releasesOfDocument(
  state: ContentMutationState,
  documentId: string,
): readonly ReleaseRecord[] {
  const variantIds = new Set(
    state.contentVariants
      .filter((variant) => variant.documentId === documentId)
      .map((variant) => variant.variantId),
  );
  return state.releases.filter((release) => variantIds.has(release.variantId));
}

/** Replaces one stored variant by identity, leaving the collection's order as it was. */
function replaceVariant(
  variants: readonly ContentVariantRecord[],
  next: ContentVariantRecord,
): readonly ContentVariantRecord[] {
  return variants.map((variant) => (variant.variantId === next.variantId ? next : variant));
}

/** Replaces one stored release by identity, leaving the collection's order as it was. */
function replaceRelease(
  releases: readonly ReleaseRecord[],
  next: ReleaseRecord,
): readonly ReleaseRecord[] {
  return releases.map((release) => (release.releaseId === next.releaseId ? next : release));
}

/** The stored form of one domain release, with the token this write advances. */
function storedReleaseOf(
  release: Release,
  revision: string,
  previous: ReleaseRecord | undefined,
): ReleaseRecord {
  const withdrawnAt = release.withdrawnAt ?? previous?.withdrawnAt ?? null;
  return {
    releaseId: release.releaseId,
    variantId: release.variantId,
    revisionId: release.revisionId,
    audience: release.audience,
    locale: release.locale.tag,
    publishedAt: release.publishedAt.toString(),
    reach: release.reach,
    withdrawnAt: withdrawnAt === null ? null : withdrawnAt.toString(),
    supersededBy: release.supersededBy ?? previous?.supersededBy ?? null,
    revision,
  };
}

/** The member of a closed vocabulary a stored value names, or the refusal when it names none. */
function requireSectionType(value: string): PageSectionType {
  const admitted = PAGE_SECTION_TYPES.find((type) => type === value);
  if (admitted === undefined) {
    throw invalidField(
      "sectionType",
      "A section type is one the page catalogue admits, and this one is not in it.",
    );
  }
  return admitted;
}

// ---------------------------------------------------------------------------------------------
// The payload schema primitives
// ---------------------------------------------------------------------------------------------

/** The message a malformed record reference carries, stated once for every payload. */
const RECORD_REFERENCE_MESSAGE =
  "This action applies to one record, so open the record again and retry rather than pasting an address.";

/** One opaque record identity: carried, never parsed, and bounded so a paragraph cannot be one. */
const recordIdSchema = z
  .string({ error: RECORD_REFERENCE_MESSAGE })
  .trim()
  .min(1, RECORD_REFERENCE_MESSAGE)
  .max(160, RECORD_REFERENCE_MESSAGE);

/** One content-locale tag: a language subtag followed by hyphen-separated subtags. */
const localeTagSchema = z
  .string({ error: "State the content locale this edition is written in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u,
    "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.",
  );

/** One content family, from the closed trio the record model declares. */
const familySchema = z.enum(CONTENT_FAMILIES, {
  error: "A content document is an update, a worker page or a project page.",
});

/** One variant audience, from the closed pair the record model declares. */
const audienceSchema = z.enum(CONTENT_AUDIENCES, {
  error: "Choose the audience this edition serves: public or approved supporters.",
});

/** How a candidate is to be released, from the closed pair this file declares. */
const publishModeSchema = z.enum(PUBLISH_MODES, {
  error: "Choose how this edition is released: publish only, or publish and notify now.",
});

/** One reach value, from the closed trio the record model declares. */
const reachSchema = releaseReachSchema;

/** Longest free text one placement field may carry, in characters. */
const PLACEMENT_TEXT_MAX_CHARS = 4_000;

/** One optional placement text field: trimmed, bounded, and absent when it was not supplied. */
const optionalPlacementTextSchema = z
  .string()
  .trim()
  .max(
    PLACEMENT_TEXT_MAX_CHARS,
    `A placement field holds at most ${PLACEMENT_TEXT_MAX_CHARS} characters, so shorten it.`,
  )
  .optional();

/** The descriptor one placement carries: required alternative text, everything else optional. */
const placementTextSchema = z.strictObject({
  altText: z
    .string({ error: "Describe what this image or video shows." })
    .trim()
    .min(1, "Describe what this image or video shows.")
    .max(PLACEMENT_TEXT_MAX_CHARS, "Shorten the alternative text for this placement."),
  caption: optionalPlacementTextSchema,
  credit: optionalPlacementTextSchema,
});

/**
 * One reference from a draft to an already-registered asset.
 *
 * Nothing about the asset's bytes travels here: its type, size, dimensions, duration, renditions and
 * scope belong to the record `registerMediaAsset` created, and a placement is never a route around
 * the authorisation every rendition read performs.
 */
const placementRefSchema = z.strictObject({
  placementId: recordIdSchema.optional(),
  assetId: recordIdSchema,
  purpose: z
    .enum(["display", "playback", "poster", "captions", "transcript"])
    .optional(),
  altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional(),
  caption: optionalPlacementTextSchema,
  credit: optionalPlacementTextSchema,
  sectionElement: z.string().trim().min(1).optional(),
  position: z.int().nonnegative().optional(),
});

/** One caption track a draft states: the caption rendition of one admitted asset, in one language. */
const captionTrackPayloadSchema = z.strictObject({
  assetId: recordIdSchema,
  language: localeTagSchema,
  label: z.string().trim().min(1).max(120).optional(),
  isDefault: z.boolean().optional(),
});

/** How a link to the revision presents itself, as the payload may state it. */
const sharePresentationPayloadSchema = z.strictObject({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(600).optional(),
  imageAssetId: recordIdSchema.nullable().optional(),
  imageAltText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).nullable().optional(),
});

/** The section fields a page builder may save: only the keys the section type edits. */
const sectionFieldsSchema = z.record(z.string(), z.string());

/**
 * One composed section as a payload states it: the catalogue element, its plain-text fields and its
 * bounded presentation choices.
 *
 * The presentation object is the profile's own schema, so a value outside the admitted pair — a
 * colour, a spacing, a theme, a pixel position — is `invalid` rather than styled a second time, and
 * the rule lives in `modules/content/document` rather than here.
 */
const sectionPayloadSchema = z.strictObject({
  element: z.string().trim().min(1, "A section states the catalogue element it was composed from."),
  fields: sectionFieldsSchema,
  presentation: presentationChoiceSchema,
  direction: z.enum(["ltr", "rtl"]).optional(),
});

/** The draft target every section mutation names: the draft revision, or the variant that holds it. */
const draftTargetShape = {
  draftRevisionId: recordIdSchema.optional(),
  variantId: recordIdSchema.optional(),
} as const;

/** Whether a payload named a draft to edit, by revision or by the variant holding it. */
function namesDraftTarget(payload: {
  readonly draftRevisionId?: string;
  readonly variantId?: string;
}): boolean {
  return payload.draftRevisionId !== undefined || payload.variantId !== undefined;
}

/** The refusal a section payload answers when it names no draft at all. */
const NO_DRAFT_TARGET_MESSAGE =
  "Open the page's draft first: a section change names the draft revision it edits.";

// ---------------------------------------------------------------------------------------------
// Shared apply-time helpers: the authored document, placements, and the stored revision
// ---------------------------------------------------------------------------------------------

/**
 * The document a draft payload describes: the body, with the payload's own sections joined in when it
 * states them.
 *
 * Sections have one authoritative copy, inside the document, so a payload that states them separately
 * has them joined into that copy rather than stored beside it. The joined document is re-validated by
 * the content profile, which is what refuses a section whose presentation choice is outside the
 * admitted set; the refusal is a value, and nothing here repairs or coerces a value the profile does
 * not admit.
 */
function resolveDraftDocument(input: {
  readonly body: unknown;
  readonly sections: readonly ContentSection[] | undefined;
}):
  | { readonly status: "valid"; readonly document: ContentDocumentJson }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] } {
  const parsed = parseDocument(input.body);
  if (parsed.status === "invalid" || input.sections === undefined) {
    return parsed;
  }
  return parseDocument({ ...parsed.document, sections: input.sections });
}

/**
 * The title a stored share presentation carries when its author stated none.
 *
 * A stored card requires a title, while a share presentation is optional content, so a revision that
 * states none stores this word rather than failing to save. The surface shows the document's managed
 * title when the source supplies one, and this value is never presented as that title.
 */
const UNTITLED_SHARE_TITLE = "Untitled";

/** One stored share presentation, from the domain value a revision carries. */
function storedShareOf(
  share: SharePresentation,
  previous: SharePresentationRecord | undefined,
): SharePresentationRecord {
  return {
    title: share.title ?? UNTITLED_SHARE_TITLE,
    description: share.description ?? "",
    imageAssetId: share.imageAssetId ?? null,
    imageAltText: previous?.imageAltText ?? null,
  };
}

/**
 * Whether two stored revisions hold the same content.
 *
 * Identity, authorship, creation and the revision token are outside the comparison: what makes a save a
 * no-op is that the body, the placements, the caption tracks and the share presentation would stand
 * exactly as they already do. Comparing the whole record rather than the digest alone also catches a
 * change to a field the digest does not cover, such as a share image's alternative text.
 */
function storedContentEquals(left: StoredContentRevision, right: StoredContentRevision): boolean {
  return (
    left.contentChecksum === right.contentChecksum &&
    JSON.stringify(left.mediaPlacements) === JSON.stringify(right.mediaPlacements) &&
    JSON.stringify(left.captions) === JSON.stringify(right.captions) &&
    JSON.stringify(left.sharePresentation) === JSON.stringify(right.sharePresentation) &&
    JSON.stringify(left.body) === JSON.stringify(right.body)
  );
}

/** What resolving one draft payload's placements produced. */
interface ResolvedPlacements {
  /** The placements as the stored revision records them, in authored order. */
  readonly placements: readonly MediaPlacementRecord[];
  /** The alternative text of each placement, keyed by placement identity. */
  readonly altText: Readonly<Record<string, string>>;
  /** The visible caption of each placement that states one, keyed by placement identity. */
  readonly captions: Readonly<Record<string, string>>;
  /** The caption tracks this draft admits, one per captioned video asset. */
  readonly tracks: readonly ContentCaptionTrackRecord[];
  /** The placements as the domain revision states them, in authored order. */
  readonly domain: readonly MediaPlacement[];
}

/** Why a placement reference cannot be used, stated without disclosing anything about the asset. */
const UNPLACEABLE_ASSET =
  "This media asset is not one this edition may place, so choose an asset registered in this ministry.";

/**
 * Resolves a draft's placement references against the assets this scope holds.
 *
 * Every reference must name an asset the caller may place: an asset this context does not hold, and an
 * asset whose own recorded scope refuses the caller, are answered alike, so a placement can never be
 * used to learn that another ministry's asset exists. Alternative text is required and is taken from
 * the registration's descriptor when the placement does not restate it, which is what keeps an image
 * from arriving in a draft undescribed. A purpose the asset has no rendition for is refused here
 * rather than left for a reader to discover as an unavailable player.
 */
function resolvePlacements(input: {
  readonly state: ContentMutationState;
  readonly session: ResolvedSession;
  readonly previous: readonly MediaPlacementRecord[];
  readonly requested: readonly z.infer<typeof placementRefSchema>[];
}): ResolvedPlacements {
  const placements: MediaPlacementRecord[] = [];
  const altText: Record<string, string> = {};
  const captions: Record<string, string> = {};
  const tracks: ContentCaptionTrackRecord[] = [];
  const domain: MediaPlacement[] = [];
  const usedPlacementIds = new Set<string>();

  input.requested.forEach((requested, index) => {
    const field = `mediaPlacements.${String(index)}.assetId`;
    const asset = input.state.mediaAssets.find((candidate) => candidate.assetId === requested.assetId);
    if (asset === undefined) {
      throw invalidField(field, UNPLACEABLE_ASSET);
    }
    const descriptor = input.state.mediaAssetDescriptors.find(
      (candidate) => candidate.assetId === requested.assetId,
    );
    const readable = canEdit(input.session, { kind: "media-asset", scope: asset.scope });
    if (!readable.allowed) {
      throw invalidField(field, UNPLACEABLE_ASSET);
    }

    const purpose = requested.purpose ?? (asset.kind === "image" ? "display" : "playback");
    if (!asset.renditions.some((entry) => entry.purpose === purpose)) {
      throw invalidField(
        field,
        `This asset has no ${purpose} rendition yet, so it cannot be placed for that purpose.`,
      );
    }

    const description = requested.altText ?? descriptor?.altText ?? undefined;
    if (description === undefined) {
      throw invalidField(
        field,
        "Describe what this image or video shows, because every placement states the alternative text a reader is given.",
      );
    }
    const caption = requested.caption ?? descriptor?.caption ?? null;
    const credit = requested.credit ?? descriptor?.credit ?? null;

    const previousAtPosition = input.previous[index];
    const reusableId =
      previousAtPosition !== undefined && previousAtPosition.assetId === asset.assetId
        ? previousAtPosition.placementId
        : undefined;
    const placementId = requested.placementId ?? reusableId ?? newRecordId("placement");
    if (usedPlacementIds.has(placementId)) {
      throw invalidField(
        `mediaPlacements.${String(index)}.placementId`,
        "Two placements of this draft share one identity, so each placement needs its own.",
      );
    }
    usedPlacementIds.add(placementId);

    placements.push({
      placementId,
      assetId: asset.assetId,
      sectionElement: requested.sectionElement ?? null,
      position: requested.position ?? index,
      altText: description,
      caption,
      credit,
    });
    altText[placementId] = description;
    if (caption !== null) {
      captions[placementId] = caption;
    }
    domain.push({ placementId, assetId: asset.assetId });

    const captionRendition = asset.renditions.find((entry) => entry.purpose === "captions");
    const descriptorLanguage = descriptor?.language ?? null;
    if (asset.kind === "video" && captionRendition !== undefined && descriptorLanguage !== null) {
      tracks.push({
        assetId: asset.assetId,
        renditionId: captionRendition.renditionId,
        language: descriptorLanguage,
        label: descriptorLanguage,
        isDefault: tracks.length === 0,
      });
    }
  });

  return { placements, altText, captions, tracks, domain };
}

/** The caption tracks a draft payload states explicitly, each checked against the asset it names. */
function resolveCaptionTracks(input: {
  readonly state: ContentMutationState;
  readonly requested: readonly z.infer<typeof captionTrackPayloadSchema>[];
}): readonly ContentCaptionTrackRecord[] {
  return input.requested.map((requested, index) => {
    const asset = input.state.mediaAssets.find(
      (candidate) => candidate.assetId === requested.assetId,
    );
    const rendition = asset?.renditions.find((entry) => entry.purpose === "captions");
    if (asset === undefined || rendition === undefined) {
      throw invalidField(
        `captions.${String(index)}.assetId`,
        "A caption track belongs to an admitted video that carries a caption rendition.",
      );
    }
    return {
      assetId: asset.assetId,
      renditionId: rendition.renditionId,
      language: requested.language,
      label: requested.label ?? requested.language,
      isDefault: requested.isDefault ?? index === 0,
    };
  });
}

/**
 * One principal identifier in the branded form the stored records state.
 *
 * A domain revision carries its author as a plain string, while a stored record states the branded
 * identifier; the value always arrived from a resolved session or a stored record, so this states that
 * fact in the type rather than re-deriving it. A malformed stored value raises the profile's own
 * refusal rather than being written back unchanged.
 */
function principalIdOf(value: string): PrincipalId {
  return principalIdSchema.parse(value);
}

/** One stored revision record, from a domain revision and the placements it was written with. */
function storedRevisionOf(input: {
  readonly revision: ContentRevision;
  readonly placements: readonly MediaPlacementRecord[];
  readonly tracks: readonly ContentCaptionTrackRecord[];
  readonly previousShare: SharePresentationRecord | undefined;
}): StoredContentRevision {
  return {
    revisionId: input.revision.revisionId,
    variantId: input.revision.variantId,
    body: input.revision.body,
    mediaPlacements: [...input.placements],
    captions: [...input.tracks],
    sharePresentation: storedShareOf(input.revision.sharePresentation, input.previousShare),
    contentChecksum: input.revision.contentChecksum,
    authorPrincipalId: principalIdOf(input.revision.authorPrincipalId),
    createdAt: input.revision.createdAt.toString(),
    revision: INITIAL_REVISION_TOKEN,
  };
}

/** The parsed document of one stored revision, or the refusal that its body no longer validates. */
function requireParsedBody(record: StoredContentRevision): ContentDocumentJson {
  const parsed = parseDocument(record.body);
  if (parsed.status === "invalid") {
    throw invalidAt(parsed.issues);
  }
  return parsed.document;
}

/**
 * The opened state document, or `undefined` when it cannot be read.
 *
 * A concurrency-target lookup runs before the transaction and must not throw: an unreadable document
 * answers "this scope holds no such record", and the apply function then refuses the change itself with
 * the source's own `unavailable` answer. Reading it twice is deliberate — the target is a claim made
 * before the write, and the write re-derives everything it changes.
 */
function contentStateOrUndefined(docs: { readonly state: unknown }): OpenedState | undefined {
  try {
    return openState(docs);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// createVariant — one permitted audience and one exact locale, with its own draft to come
// ---------------------------------------------------------------------------------------------

/** The payload `createVariant` accepts: the document, the audience and the exact content locale. */
const createVariantPayloadSchema = z.strictObject({
  documentId: recordIdSchema,
  family: familySchema.optional(),
  audience: audienceSchema.optional(),
  locale: localeTagSchema,
  direction: z.enum(["ltr", "rtl"]).optional(),
  translationSource: z
    .strictObject({ variantId: recordIdSchema, revisionId: recordIdSchema })
    .optional(),
});

/** The payload `createVariant` accepts, inferred so a form and its hook hold one shape. */
export type CreateVariantPayload = z.infer<typeof createVariantPayloadSchema>;

/**
 * Creates one working edition of one document: an audience the family admits, in one exact content
 * locale, with no draft, candidate or release yet.
 *
 * Each edition owns its own three pointers, which is what stops editing the English edition from
 * overwriting an Arabic draft or advancing a French release, and a manual translation records the source
 * revision it copied so staleness can be reported later without withdrawing anything.
 * Outcomes: `accepted`, `conflict`, `denied`, `invalid`, `alreadyAccepted`, `unavailable`, `unknown`.
 */
export async function createVariant(
  sessionId: string,
  input: MutationInput<CreateVariantPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: createVariantPayloadSchema,
    name: "createVariant",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const record = opened?.state.contentDocuments.find(
        (candidate) => candidate.documentId === input.payload.documentId,
      );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const document = requireDocument(state, input.payload.documentId);

      if (input.payload.family !== undefined && input.payload.family !== document.family) {
        throw invalidField(
          "family",
          "An edition belongs to the family its document is, so choose the family from the document.",
        );
      }
      const audience: VariantAudience = input.payload.audience ?? "public";
      if (!variantKeyAllowed(document.family, audience)) {
        const admitted = admittedAudiences(document.family);
        throw invalidField(
          "audience",
          admitted.length === 0
            ? `"${document.family}" is not a content family, so it admits no audience.`
            : `A ${document.family} admits ${admitted.join(" and ")} editions only.`,
        );
      }

      const locale = {
        tag: input.payload.locale,
        direction: input.payload.direction ?? directionOfTag(input.payload.locale),
      };

      let translationSource:
        | { readonly variant: ContentVariant; readonly revision: ContentRevision }
        | undefined;
      if (input.payload.translationSource !== undefined) {
        const source = requireVariant(state, input.payload.translationSource.variantId);
        const revision = requireRevision(state, input.payload.translationSource.revisionId);
        translationSource = {
          variant: domainVariantOf(source),
          revision: domainRevisionOf(revision, requireParsedBody(revision)),
        };
      }

      const created = buildVariant({
        variantId: newRecordId("variant"),
        document: domainDocumentOf(document),
        audience,
        locale,
        existingVariants: state.contentVariants
          .filter((candidate) => candidate.documentId === document.documentId)
          .map(domainVariantOf),
        ...(translationSource === undefined ? {} : { translationSource }),
      });
      if (created.status === "invalid") {
        throw invalidAt(created.issues);
      }

      writeState(context.docs, opened, {
        contentVariants: [
          ...state.contentVariants,
          storedVariantOf(created.variant, INITIAL_REVISION_TOKEN),
        ],
        contentDocuments: state.contentDocuments.map((candidate) =>
          candidate.documentId === document.documentId
            ? { ...candidate, revision: nextRevision(candidate.revision) }
            : candidate,
        ),
      });

      const result = { variantId: created.variant.variantId, documentId: document.documentId };
      return {
        changed: true,
        revision: nextRevision(document.revision),
        result,
        created: [created.variant.variantId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// saveDraft — the working revision, which moves the draft pointer and nothing else
// ---------------------------------------------------------------------------------------------

/** The payload `saveDraft` accepts: the working document of one variant. */
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
    if (resolved.status === "valid") {
      return;
    }
    for (const issue of resolved.issues) {
      const segments = issue.path.split(".").filter((segment) => segment.length > 0);
      ctx.addIssue({ code: "custom", path: ["body", ...segments], message: issue.message });
    }
  });

/** The payload `saveDraft` accepts, inferred so the editor and its hook read one shape. */
export type SaveDraftPayload = z.infer<typeof saveDraftPayloadSchema>;

/**
 * Saves one variant's working revision, validating the authored document through the content profile.
 *
 * A save moves `draftRevisionId` and nothing else: the candidate pointer and the release head are
 * carried through untouched, because saving a draft never revises what a reviewer froze and never
 * advances what readers are served. A document the profile refuses is `invalid` with the paths the
 * editor's fields already use; a save that would write exactly what already stands is `unchanged` and
 * records no history entry. Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`,
 * `alreadyAccepted`, `unavailable`, `unknown`.
 */
export async function saveDraft(
  sessionId: string,
  input: MutationInput<SaveDraftPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: saveDraftPayloadSchema,
    name: "saveDraft",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      if (opened === undefined) {
        return unresolvedTarget();
      }
      const variant = opened.state.contentVariants.find(
        (candidate) => candidate.variantId === input.payload.variantId,
      );
      const draft =
        variant === undefined || variant.draftRevisionId === null
          ? undefined
          : opened.state.contentRevisions.find(
              (candidate) => candidate.revisionId === variant.draftRevisionId,
            );
      return draft === undefined ? { kind: "absent" } : recordTarget(draft.revision, draft);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const variant = requireVariant(state, input.payload.variantId);
      const previousRevision =
        variant.draftRevisionId === null
          ? undefined
          : state.contentRevisions.find(
              (candidate) => candidate.revisionId === variant.draftRevisionId,
            );

      const resolved = resolveDraftDocument({
        body: input.payload.body,
        sections: input.payload.sections,
      });
      if (resolved.status === "invalid") {
        throw invalidAt(resolved.issues);
      }

      const resolvedPlacements = resolvePlacements({
        state,
        session: context.session,
        previous: previousRevision?.mediaPlacements ?? [],
        requested: input.payload.mediaPlacements ?? [],
      });
      const explicitTracks = resolveCaptionTracks({
        state,
        requested: input.payload.captions ?? [],
      });

      const requestedShare = input.payload.sharePresentation;
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
                ...(requestedShare.description === undefined
                  ? {}
                  : { description: requestedShare.description }),
                ...(requestedShare.imageAssetId === undefined ||
                requestedShare.imageAssetId === null
                  ? {}
                  : { imageAssetId: requestedShare.imageAssetId }),
              },
            }),
        authorPrincipalId: context.session.principalId,
        at: scenarioInstant(context.session),
      });
      if (written.status === "invalid") {
        throw invalidAt(written.issues);
      }

      const storedShare = storedShareOf(
        written.revision.sharePresentation,
        previousRevision?.sharePresentation,
      );
      const nextRecord: StoredContentRevision = {
        ...storedRevisionOf({
          revision: written.revision,
          placements: resolvedPlacements.placements,
          tracks: [...explicitTracks, ...resolvedPlacements.tracks],
          previousShare: previousRevision?.sharePresentation,
        }),
        sharePresentation: {
          ...storedShare,
          ...(requestedShare?.imageAltText === undefined || requestedShare.imageAltText === null
            ? {}
            : { imageAltText: requestedShare.imageAltText }),
        },
      };

      if (previousRevision !== undefined && storedContentEquals(previousRevision, nextRecord)) {
        return { changed: false };
      }

      const pointed = applyDraftRevision(domainVariantOf(variant), written.revision);
      if (pointed.status === "invalid") {
        throw invalidAt(pointed.issues);
      }

      writeState(context.docs, opened, {
        contentRevisions: [...state.contentRevisions, nextRecord],
        contentVariants: replaceVariant(
          state.contentVariants,
          storedVariantOf(pointed.variant, nextRevision(variant.revision)),
        ),
      });

      const result = {
        variantId: variant.variantId,
        revisionId: written.revision.revisionId,
        contentChecksum: written.revision.contentChecksum,
      };
      return {
        changed: true,
        revision: nextRevision(variant.revision),
        result,
        created: [written.revision.revisionId],
        changedIds: [variant.variantId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// submitForReview — one freeze, one review round, and the mode the submitter chose
// ---------------------------------------------------------------------------------------------

/** The payload `submitForReview` accepts: the exact revision, and how it is to be released. */
const submitForReviewPayloadSchema = z.strictObject({
  variantId: recordIdSchema,
  revisionId: recordIdSchema,
  notifyMode: publishModeSchema.optional(),
});

/** The payload `submitForReview` accepts, inferred so the review step cannot restate it. */
export type SubmitForReviewPayload = z.infer<typeof submitForReviewPayloadSchema>;

/**
 * Freezes one exact revision as the candidate under review and records the mode it is to be released in.
 *
 * The candidate is immutable once frozen and is identified by the revision it froze, so the copy a
 * reviewer answers is the copy a release can publish and a later edit cannot become what was approved.
 * Review happens only where contributor policy asks for it, and this is the one submission step: a
 * second round is a new revision and a new candidate, never a re-review of this one.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function submitForReview(
  sessionId: string,
  input: MutationInput<SubmitForReviewPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: submitForReviewPayloadSchema,
    name: "submitForReview",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const record = opened?.state.contentRevisions.find(
        (candidate) => candidate.revisionId === input.payload.revisionId,
      );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const variant = requireVariant(state, input.payload.variantId);
      const revision = requireRevision(state, input.payload.revisionId);
      if (revision.variantId !== variant.variantId) {
        throw invalidField(
          "revisionId",
          "A candidate freezes a revision of its own edition, and this revision belongs to another.",
        );
      }

      const existing = state.contentReviews.find(
        (review) => review.candidateId === revision.revisionId,
      );
      if (existing !== undefined && existing.decision !== "submitted") {
        throw invalidField(
          "revisionId",
          "This revision has already been reviewed, so a second review needs a new submission with a new revision.",
        );
      }
      if (existing !== undefined && variant.candidateId === revision.revisionId) {
        return { changed: false };
      }

      const at = scenarioInstant(context.session);
      const frozen = freezeCandidate(
        domainVariantOf(variant),
        domainRevisionOf(revision, requireParsedBody(revision)),
        { candidateId: revision.revisionId, at },
      );
      if (frozen.status === "invalid") {
        throw invalidAt(frozen.issues);
      }

      const review: ContentReviewRecord = {
        candidateId: frozen.candidate.candidateId,
        variantId: variant.variantId,
        revisionId: revision.revisionId,
        notifyMode: input.payload.notifyMode ?? "publish-only",
        decision: "submitted",
        note: null,
        submittedAt: at.toString(),
        decidedAt: null,
        decidedByPrincipalId: null,
        revision: INITIAL_REVISION_TOKEN,
      };

      writeState(context.docs, opened, {
        contentVariants: replaceVariant(
          state.contentVariants,
          storedVariantOf(frozen.variant, nextRevision(variant.revision)),
        ),
        contentReviews: [...state.contentReviews, review],
      });

      const result = {
        candidateId: frozen.candidate.candidateId,
        variantId: variant.variantId,
        revisionId: revision.revisionId,
        notifyMode: review.notifyMode,
      };
      return {
        changed: true,
        revision: nextRevision(variant.revision),
        result,
        created: [frozen.candidate.candidateId],
        changedIds: [variant.variantId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// One review answer: approve, request changes, reject
// ---------------------------------------------------------------------------------------------

/** The payload the three review answers accept: the candidate, and the answer's own detail. */
const reviewAnswerPayloadSchema = z.strictObject({
  candidateId: recordIdSchema,
  notifyMode: publishModeSchema.optional(),
  note: z.string().trim().max(4_000).optional(),
  reason: z.string().trim().max(4_000).optional(),
});

/** The payload a review answer accepts, inferred so the review panel cannot restate it. */
export type ReviewAnswerPayload = z.infer<typeof reviewAnswerPayloadSchema>;

/** The review record one candidate identity names, or the refusal that no submission is open. */
function requireReview(
  state: ContentMutationState,
  candidateId: string,
  field: string,
): ContentReviewRecord {
  const review = state.contentReviews.find((candidate) => candidate.candidateId === candidateId);
  if (review === undefined) {
    throw invalidField(
      field,
      "No submission is open for review under this identity, so reopen the edition and submit it again.",
    );
  }
  return review;
}

/**
 * Records one reviewer decision on a frozen candidate, sharing the read, the refusal and the mode rule
 * across the three answers so no answer can reach a state another would refuse.
 *
 * The variant pointer moves only for a decision that ends the review: approval keeps the candidate
 * because it is what a release reads, while a request for changes or a rejection clears it so the next
 * submission needs a new revision. Approving one edition approves no other, and the mode stays the
 * submitter's — a reviewer asking for a different one is refused rather than upgraded.
 */
async function answerReview(input: {
  readonly sessionId: string;
  readonly mutation: MutationInput<ReviewAnswerPayload>;
  readonly name: string;
  readonly decision: Exclude<ReviewDecision, "submitted">;
}): Promise<MutationOutcome> {
  return runMutation({
    sessionId: input.sessionId,
    input: input.mutation,
    schema: reviewAnswerPayloadSchema,
    name: input.name,
    authorize: (session) => editorialDecision(session, input.mutation.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const record = opened?.state.contentRevisions.find(
        (candidate) => candidate.revisionId === input.mutation.payload.candidateId,
      );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const review = requireReview(state, input.mutation.payload.candidateId, "candidateId");
      if (review.decision === input.decision) {
        return { changed: false };
      }
      if (review.decision !== "submitted") {
        throw invalidField(
          "candidateId",
          "This candidate has already been answered, so a further review needs a new submission.",
        );
      }
      const requestedMode = input.mutation.payload.notifyMode;
      if (requestedMode !== undefined && requestedMode !== review.notifyMode) {
        throw invalidField(
          "notifyMode",
          "A reviewer cannot change how this edition was submitted to be released, so a new submission is required.",
        );
      }

      const variant = requireVariant(state, review.variantId);
      const decided = applyReviewDecision(domainVariantOf(variant), input.decision);
      if (decided.status === "invalid") {
        throw invalidAt(decided.issues);
      }

      const answered: ContentReviewRecord = {
        ...review,
        decision: input.decision,
        note: input.mutation.payload.note ?? input.mutation.payload.reason ?? null,
        decidedAt: scenarioInstant(context.session).toString(),
        decidedByPrincipalId: context.session.principalId,
        revision: nextRevision(review.revision),
      };

      writeState(context.docs, opened, {
        contentVariants: replaceVariant(
          state.contentVariants,
          storedVariantOf(decided.variant, nextRevision(variant.revision)),
        ),
        contentReviews: state.contentReviews.map((candidate) =>
          candidate.candidateId === answered.candidateId ? answered : candidate,
        ),
      });

      const result = {
        candidateId: review.candidateId,
        variantId: review.variantId,
        revisionId: review.revisionId,
        decision: input.decision,
        notifyMode: review.notifyMode,
      };
      return {
        changed: true,
        revision: nextRevision(variant.revision),
        result,
        changedIds: [review.variantId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

/**
 * Approves one frozen candidate in a single step and keeps its recorded release mode.
 *
 * A reviewer cannot turn Publish only into Publish and notify now: a mismatched mode is `invalid` with
 * the reason that a new submission is required. Approving one candidate approves no other language and
 * no other audience. Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`,
 * `alreadyAccepted`, `unavailable`, `unknown`.
 */
export async function approveCandidate(
  sessionId: string,
  input: MutationInput<ReviewAnswerPayload>,
): Promise<MutationOutcome> {
  return answerReview({
    sessionId,
    mutation: input,
    name: "approveCandidate",
    decision: "approved",
  });
}

/**
 * Asks for changes on one frozen candidate, which clears the variant's submission so a second round is
 * a new revision rather than a silent re-review.
 *
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function requestChanges(
  sessionId: string,
  input: MutationInput<ReviewAnswerPayload>,
): Promise<MutationOutcome> {
  return answerReview({
    sessionId,
    mutation: input,
    name: "requestChanges",
    decision: "changes-requested",
  });
}

/**
 * Rejects one frozen candidate, under the same single-review rule as a request for changes.
 *
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function rejectCandidate(
  sessionId: string,
  input: MutationInput<ReviewAnswerPayload>,
): Promise<MutationOutcome> {
  return answerReview({
    sessionId,
    mutation: input,
    name: "rejectCandidate",
    decision: "rejected",
  });
}


// ---------------------------------------------------------------------------------------------
// publishVariants — one release per selected edition, reported per edition
// ---------------------------------------------------------------------------------------------

/** One edition a release request selects. */
const publishSelectionSchema = z.strictObject({
  variantId: recordIdSchema,
  revisionId: recordIdSchema.optional(),
  mode: publishModeSchema.optional(),
});

/** The payload `publishVariants` accepts: the document, and the editions it releases. */
const publishVariantsPayloadSchema = z
  .strictObject({
    documentId: recordIdSchema.optional(),
    candidateIds: z.array(recordIdSchema).min(1).optional(),
    variants: z.array(publishSelectionSchema).min(1).optional(),
    mode: publishModeSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.candidateIds === undefined && payload.variants === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["candidateIds"],
        message: "Choose at least one edition to release, by its candidate or by the edition itself.",
      });
    }
    if (payload.candidateIds !== undefined && payload.variants !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message:
          "A release names its editions one way, by candidate or by edition, so remove one of the two lists.",
      });
    }
  });

/** The payload `publishVariants` accepts, inferred so the review form and its hook hold one shape. */
export type PublishVariantsPayload = z.infer<typeof publishVariantsPayloadSchema>;

/** One selected edition, resolved from either form of the payload. */
interface ReleaseSelection {
  readonly variantId: string;
  readonly revisionId?: string;
  readonly mode?: PublishMode;
}

/** What one edition's release attempt produced, before it is reduced to a per-item result. */
interface ReleaseAttempt {
  readonly variantId: string;
  readonly state: PerVariantReleaseState;
  readonly releaseId?: string;
  readonly revisionId?: string;
  readonly notifyMode?: PublishMode;
  readonly reasonCode?: string;
  readonly reason?: string;
}

/**
 * The editions a release request selects, in the order the payload names them.
 *
 * A candidate names a frozen revision, so the edition it belongs to is the one whose submission that
 * candidate is; an edition form names the edition directly. Both forms resolve to the same pair, so
 * every attempt below is made for one edition and one revision and no attempt spans two.
 */
function releaseSelectionsOf(
  state: ContentMutationState,
  payload: PublishVariantsPayload,
): readonly ReleaseSelection[] {
  if (payload.variants !== undefined) {
    return payload.variants.map((selection) => ({
      variantId: selection.variantId,
      ...(selection.revisionId === undefined ? {} : { revisionId: selection.revisionId }),
      ...(selection.mode === undefined ? {} : { mode: selection.mode }),
    }));
  }
  const selections: ReleaseSelection[] = [];
  for (const candidateId of payload.candidateIds ?? []) {
    const review = state.contentReviews.find((candidate) => candidate.candidateId === candidateId);
    const byCandidate = state.contentVariants.find(
      (variant) => variant.candidateId === candidateId,
    );
    const variantId = review?.variantId ?? byCandidate?.variantId;
    if (variantId === undefined) {
      throw invalidField(
        "candidateIds",
        "One selected candidate is not a submission this context holds, so reopen the review and choose it again.",
      );
    }
    selections.push({
      variantId,
      revisionId: candidateId,
      ...(payload.mode === undefined ? {} : { mode: payload.mode }),
    });
  }
  return selections;
}

/** The display or playback rendition a notice names for one revision, when it has one. */
function noticeRenditionOf(
  state: ContentMutationState,
  revision: StoredContentRevision,
): string | undefined {
  for (const placement of revision.mediaPlacements) {
    const asset = state.mediaAssets.find((candidate) => candidate.assetId === placement.assetId);
    const rendition = asset?.renditions.find(
      (entry) => entry.purpose === (asset.kind === "image" ? "display" : "playback"),
    );
    if (rendition !== undefined) {
      return rendition.renditionId;
    }
  }
  return undefined;
}

/**
 * Publishes one revision of each selected edition, and reports what each edition's attempt produced.
 *
 * Each edition releases its own revision, so one edition failing leaves its prior-good head in place
 * and the editions that did release keep their releases: there is no batch rollback, and a failed
 * edition recovers by replaying this same operation rather than by starting a second release. An
 * edition whose submission is still awaiting review, or whose frozen revision is gone, needs attention
 * and releases nothing. Publication is not notification: this records releases and no message.
 *
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function publishVariants(
  sessionId: string,
  input: MutationInput<PublishVariantsPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: publishVariantsPayloadSchema,
    name: "publishVariants",
    authorize: (session) => editorialDecision(session, input.scope),
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const selections = releaseSelectionsOf(state, input.payload);
      const firstVariant = requireVariant(state, selections[0]?.variantId ?? "");
      const document = requireDocument(
        state,
        input.payload.documentId ?? firstVariant.documentId,
      );
      const at = scenarioInstant(context.session);

      const attempts: ReleaseAttempt[] = [];
      const createdReleases = new Map<string, ReleaseRecord>();
      const supersededReleases = new Map<string, ReleaseRecord>();
      const updatedVariants = new Map<string, ContentVariantRecord>();

      for (const selection of selections) {
        const variant = state.contentVariants.find(
          (candidate) => candidate.variantId === selection.variantId,
        );
        if (variant === undefined || variant.documentId !== document.documentId) {
          attempts.push({
            variantId: selection.variantId,
            state: "needs-attention",
            reasonCode: "unavailable-edition",
            reason: "This edition is not one the document being released holds.",
          });
          continue;
        }

        const head = headReleaseOf(state, variant);
        const review =
          variant.candidateId === null
            ? undefined
            : state.contentReviews.find(
                (candidate) => candidate.candidateId === variant.candidateId,
              );
        const revisionId =
          selection.revisionId ?? variant.candidateId ?? variant.draftRevisionId ?? undefined;

        if (review !== undefined && review.decision === "submitted") {
          attempts.push({
            variantId: variant.variantId,
            state: "needs-attention",
            reasonCode: "awaiting-review",
            reason: "This edition is still awaiting its one review, so it cannot be released yet.",
          });
          continue;
        }
        if (review !== undefined && review.decision !== "approved") {
          attempts.push({
            variantId: variant.variantId,
            state: "needs-attention",
            reasonCode: review.decision,
            reason:
              review.decision === "rejected"
                ? "The reviewer rejected this submission, so it needs a new revision and a new submission."
                : "The reviewer asked for changes, so this edition needs a new revision and a new submission.",
          });
          continue;
        }

        const requestedMode = selection.mode ?? input.payload.mode ?? review?.notifyMode;
        if (
          review !== undefined &&
          requestedMode !== undefined &&
          requestedMode !== review.notifyMode
        ) {
          attempts.push({
            variantId: variant.variantId,
            state: "needs-attention",
            reasonCode: "notify-mode-not-approved",
            reason:
              "A reviewer cannot release this edition with a mode the submission did not ask for, so a new submission is required.",
          });
          continue;
        }
        const notifyMode: PublishMode = requestedMode ?? "publish-only";

        if (revisionId === undefined) {
          attempts.push({
            variantId: variant.variantId,
            state: "needs-attention",
            reasonCode: "no-revision",
            reason: "This edition has neither a submitted candidate nor a saved draft to release.",
          });
          continue;
        }

        const revision = state.contentRevisions.find(
          (candidate) => candidate.revisionId === revisionId,
        );
        if (revision === undefined || revision.variantId !== variant.variantId) {
          attempts.push({
            variantId: variant.variantId,
            state: "needs-attention",
            reasonCode: "no-revision",
            reason: "The revision this edition would publish is no longer one this edition holds.",
          });
          continue;
        }

        const parsed = parseDocument(revision.body);
        if (parsed.status === "invalid") {
          attempts.push({
            variantId: variant.variantId,
            state: "needs-attention",
            reasonCode: "revision-unreadable",
            reason: "The frozen revision no longer reads as admitted content, so it cannot be released.",
          });
          continue;
        }

        const mediaUnavailable = revision.mediaPlacements.some((placement) => {
          const asset = state.mediaAssets.find(
            (candidate) => candidate.assetId === placement.assetId,
          );
          return asset === undefined;
        });
        if (mediaUnavailable) {
          attempts.push({
            variantId: variant.variantId,
            state: head === undefined ? "needs-attention" : "failed-prior-good-head",
            ...(head === undefined ? {} : { releaseId: head.releaseId }),
            reasonCode: "media-unavailable",
            reason:
              head === undefined
                ? "A media asset this revision places is not available, so nothing was released."
                : "A media asset this revision places is not available, so this edition keeps the revision it already published.",
          });
          continue;
        }

        const domainVariant = domainVariantOf(variant);
        const domainRevision = domainRevisionOf(revision, parsed.document);
        const domainHead = head === undefined ? undefined : domainReleaseOf(head, variant, revision.contentChecksum);
        if (domainHead !== undefined && isReleaseUnchanged(domainHead, domainRevision)) {
          attempts.push({
            variantId: variant.variantId,
            state: "released",
            releaseId: domainHead.releaseId,
            revisionId: domainHead.revisionId,
            notifyMode,
            reasonCode: "already-published",
            reason: "This edition already publishes exactly this revision; no second release was recorded.",
          });
          continue;
        }

        const built = createRelease({
          releaseId: newRecordId("release"),
          variant: domainVariant,
          revision: domainRevision,
          reach: head?.reach ?? "not-public",
          at,
        });
        if (built.status === "invalid") {
          throw invalidAt(built.issues);
        }
        const advanced = applyReleaseOutcome(
          domainVariant,
          { status: "released", release: built.release },
          domainHead,
        );
        if (advanced.status === "invalid") {
          throw invalidAt(advanced.issues);
        }

        createdReleases.set(
          built.release.releaseId,
          storedReleaseOf(built.release, INITIAL_REVISION_TOKEN, undefined),
        );
        if (advanced.supersededRelease !== undefined) {
          const previous = head;
          supersededReleases.set(
            advanced.supersededRelease.releaseId,
            storedReleaseOf(
              advanced.supersededRelease,
              previous === undefined ? INITIAL_REVISION_TOKEN : nextRevision(previous.revision),
              previous,
            ),
          );
        }
        updatedVariants.set(
          variant.variantId,
          storedVariantOf(advanced.variant, nextRevision(variant.revision)),
        );
        attempts.push({
          variantId: variant.variantId,
          state: "released",
          releaseId: built.release.releaseId,
          revisionId: built.release.revisionId,
          notifyMode,
        });
      }

      if (createdReleases.size === 0) {
        // Nothing was released, so nothing is written. The refusal is reported per edition at the path
        // a release form already addresses, which is how each reason reaches the row it belongs to.
        const issues: DocumentIssue[] = attempts.map((attempt, index) => ({
          path: `variants.${String(index)}`,
          message: attempt.reason ?? "This edition could not be released.",
        }));
        throw invalidAt(issues);
      }

      const releases = state.releases.map(
        (release) => supersededReleases.get(release.releaseId) ?? release,
      );
      writeState(context.docs, opened, {
        releases: [...releases, ...createdReleases.values()],
        contentVariants: state.contentVariants.map(
          (variant) => updatedVariants.get(variant.variantId) ?? variant,
        ),
        contentDocuments: state.contentDocuments.map((candidate) =>
          candidate.documentId === document.documentId
            ? { ...candidate, revision: nextRevision(candidate.revision) }
            : candidate,
        ),
      });

      const items: PerItemResult[] = attempts.map((attempt) => ({
        targetId: attempt.variantId,
        state: attempt.state,
        ...(attempt.releaseId === undefined ? {} : { revision: attempt.releaseId }),
        ...(attempt.reasonCode === undefined ? {} : { reasonCode: attempt.reasonCode }),
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
      }));
      const result = {
        documentId: document.documentId,
        editions: attempts.map((attempt) => ({
          variantId: attempt.variantId,
          state: attempt.state,
          releaseId: attempt.releaseId ?? null,
          revisionId: attempt.revisionId ?? null,
          notifyMode: attempt.notifyMode ?? null,
          reasonCode: attempt.reasonCode ?? null,
          reason: attempt.reason ?? null,
        })),
      };
      return {
        changed: true,
        revision: nextRevision(document.revision),
        result,
        created: [...createdReleases.keys()],
        changedIds: [...updatedVariants.keys()],
        items,
      } satisfies ApplyResult<typeof result>;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// requestNotification — one publication intent, one pinned copy per recipient, no second send
// ---------------------------------------------------------------------------------------------

/** The payload `requestNotification` accepts: the published edition, and the ceiling acknowledged. */
const requestNotificationPayloadSchema = z
  .strictObject({
    documentId: recordIdSchema,
    releaseId: recordIdSchema.optional(),
    releaseIds: z.array(recordIdSchema).min(1).optional(),
    variantId: recordIdSchema.optional(),
    purpose: z.enum(["update-email"]).optional(),
    acknowledgedCeiling: z.int().nonnegative().optional(),
    intendedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((payload, ctx) => {
    if (
      payload.releaseId === undefined &&
      payload.releaseIds === undefined &&
      payload.variantId === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["releaseId"],
        message: "A notice names the published edition it is about, so choose one from the release.",
      });
    }
    if (payload.releaseIds !== undefined && payload.releaseIds.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["releaseIds"],
        message:
          "One notice names one published edition, so a second edition is a second notice rather than one copy twice over.",
      });
    }
  });

/** The payload `requestNotification` accepts, inferred so the publish review holds one shape. */
export type RequestNotificationPayload = z.infer<typeof requestNotificationPayloadSchema>;

/**
 * What one submission of a notice produced, per recipient and as a whole.
 *
 * The counts are the intent's own: the ceiling it was accepted for, who was eligible at acceptance, who
 * was excluded, and how many copies were recorded. `accepted` states only that this application took
 * the submission — never that a message arrived or was opened — and `unconfirmed` counts the recipients
 * whose copy could not be pinned to an admitted rendition.
 */
export type NotificationSubmissionView = {
  readonly intentId: string;
  readonly sendResultId: string;
  readonly documentId: string;
  readonly releaseId: string;
  readonly publisherId: string;
  readonly purpose: string;
  readonly ceilingCount: number;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly acceptedCount: number;
  readonly unconfirmedCount: number;
  readonly alreadyCoveredCount: number;
  readonly link: string;
  readonly recipients: readonly { readonly recipientId: string; readonly dedupeKey: string }[];
}

/**
 * The one publisher whose Update audience a notice addresses, or `undefined` when the ministry states
 * none or several.
 *
 * A publisher identity is never invented and never derived from an address, a name or a document: the
 * rows this ministry holds name it, and one unambiguous answer is what a notice may speak for.
 */
function publisherOf(state: ContentMutationState): string | undefined {
  const publishers = [
    ...new Set(
      state.memberships
        .filter((membership) => membership.purpose === UPDATE_EMAIL_PURPOSE)
        .map((membership) => membership.publisherId),
    ),
  ].sort();
  return publishers.length === 1 ? publishers[0] : undefined;
}

/**
 * Whether this person's copy of this publisher's notices was already accepted, or may have been.
 *
 * The dedupe identity is publisher, purpose, recipient and notification intent, and accepted or
 * possibly accepted work is never resent under a fresh intent: this is the check that keeps one person
 * to one copy, and it answers from recorded outcomes rather than from a flag someone could set.
 */
function alreadyAcceptedCopy(
  state: ContentMutationState,
  publisherId: string,
  recipientId: string,
): boolean {
  const intents = new Map(
    state.notificationIntents
      .filter(
        (intent) => intent.publisherId === publisherId && intent.purpose === UPDATE_EMAIL_PURPOSE,
      )
      .map((intent) => [intent.intentId, intent]),
  );
  return state.notificationResults.some((result) => {
    if (!intents.has(result.intentId)) {
      return false;
    }
    return result.recipients.some(
      (copy) =>
        copy.recipientId === recipientId && (copy.state === "accepted" || copy.state === "unknown"),
    );
  });
}

/**
 * Submits one immediate notice for one published edition of this publisher's Update email.
 *
 * Eligibility is resolved here, at request time, from purpose-specific memberships that are active and
 * consented: a restricted, off, unsubscribed, awaiting-proof or held row is excluded, and a row accepted
 * after this intent is excluded too, so a late signup never expands an accepted ceiling. Each eligible
 * person is pinned to exactly one rendition, so a person eligible for two audiences or two languages
 * still receives one copy, and the notice itself is a minimal link-only message carrying no protected
 * prose, image, location, poster, transcript or caption.
 *
 * Usefulness is 24 elapsed hours from the intended instant, strict at equality: a request at exactly the
 * boundary is refused and cannot be revived as a fresh attempt. An uncertain submission answers
 * `unknown` carrying the `operationId`, which is recovered by re-querying it — never by sending again.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function requestNotification(
  sessionId: string,
  input: MutationInput<RequestNotificationPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: requestNotificationPayloadSchema,
    name: "requestNotification",
    authorize: (session) => editorialDecision(session, input.scope),
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const document = requireDocument(state, input.payload.documentId);
      const at = scenarioInstant(context.session);

      const intendedAt =
        input.payload.intendedAt === undefined
          ? at
          : Temporal.Instant.from(input.payload.intendedAt);
      if (notificationDeadline({ intendedAt, now: at }).status === "past-usefulness") {
        throw invalidField(
          "intendedAt",
          "This notice is past the 24 hours it stays useful for, so it cannot be submitted now and a new intent cannot revive it.",
        );
      }

      const variantHead =
        input.payload.variantId === undefined
          ? undefined
          : headReleaseOf(state, requireVariant(state, input.payload.variantId));
      const namedReleaseId =
        input.payload.releaseIds?.[0] ?? input.payload.releaseId ?? variantHead?.releaseId;
      if (namedReleaseId === undefined) {
        throw invalidField(
          "releaseId",
          "This edition publishes no release yet, so there is nothing to notify anyone about.",
        );
      }
      const release = state.releases.find((candidate) => candidate.releaseId === namedReleaseId);
      const releaseVariant =
        release === undefined
          ? undefined
          : state.contentVariants.find((candidate) => candidate.variantId === release.variantId);
      if (
        release === undefined ||
        releaseVariant === undefined ||
        releaseVariant.documentId !== document.documentId
      ) {
        throw invalidField(
          "releaseId",
          "This release is not one this document published, so a notice cannot be submitted for it.",
        );
      }
      if (release.withdrawnAt !== null) {
        throw invalidField(
          "releaseId",
          "This edition is withdrawn, so there is nothing published to notify anyone about.",
        );
      }

      const publisherId = publisherOf(state);
      if (publisherId === undefined) {
        throw invalidField(
          "documentId",
          "This ministry holds no single Update audience, so there is no publisher a notice could speak for.",
        );
      }

      const purpose = input.payload.purpose ?? UPDATE_EMAIL_PURPOSE;
      const existing = state.notificationIntents.find(
        (intent) =>
          intent.documentId === document.documentId &&
          intent.releaseId === release.releaseId &&
          intent.publisherId === publisherId &&
          intent.purpose === purpose,
      );
      if (existing !== undefined) {
        // This publication's notice was already submitted: a second intent would be a second copy.
        return { changed: false };
      }

      const intentId = newRecordId("intent");
      const acknowledged = input.payload.acknowledgedCeiling;
      const eligibility: EligibilityResult = eligibleRecipients({
        memberships: state.memberships
          .filter((membership) => membership.publisherId === publisherId)
          .map((membership) => domainMembershipOf(membership, input.scope)),
        publisherId,
        purpose: UPDATE_EMAIL_PURPOSE,
        intent: {
          intentId,
          acceptedAt: at,
          ...(acknowledged === undefined ? {} : { ceilingCount: acknowledged }),
        } satisfies EligibilityIntent,
        now: at,
      });

      const revision = state.contentRevisions.find(
        (candidate) => candidate.revisionId === release.revisionId,
      );
      const candidates: NoticeRenditionCandidate[] = [
        {
          variantId: release.variantId,
          releaseId: release.releaseId,
          revisionId: release.revisionId,
          audience: release.audience,
          locale: {
            tag: release.locale,
            direction: releaseVariant.direction ?? directionOfTag(release.locale),
          },
          publishedAt: Temporal.Instant.from(release.publishedAt),
          contentChecksum: revision?.contentChecksum ?? "",
          ...(revision === undefined ? {} : { renditionId: noticeRenditionOf(state, revision) }),
        },
      ];

      const copies: NotificationRecipientOutcomeRecord[] = [];
      const recipients: { recipientId: string; dedupeKey: string }[] = [];
      let unconfirmed = 0;
      let alreadyCovered = 0;
      let link = `/preview/${encodeURIComponent(document.documentId)}`;

      for (const recipient of eligibility.eligible) {
        if (alreadyAcceptedCopy(state, publisherId, recipient.recipientId)) {
          alreadyCovered += 1;
          continue;
        }
        const admitted: NoticeRecipient = {
          recipientId: recipient.recipientId,
          admittedAudiences: [release.audience],
          ...(recipient.languagePreference.length === 0
            ? {}
            : { languagePreference: recipient.languagePreference }),
        };
        const pinned = resolveRendition({ recipient: admitted, candidates, siteDefaultLocale: "" });
        if (pinned.status !== "pinned") {
          unconfirmed += 1;
          continue;
        }
        // The message is constructed here, at submission time, so what would be submitted is the
        // minimal link-only notice the receiving read renders — never protected prose, media, a poster,
        // a transcript or an attachment.
        const notice: { readonly link: string } = buildNotice({
          publisher: { displayName: UNNAMED_PUBLISHER },
          purpose,
          pinned: pinned.rendition,
          sender: NOTICE_SENDER,
          link,
          ...(pinned.videoPoster === undefined ? {} : { videoPoster: pinned.videoPoster }),
        });
        link = notice.link.length === 0 ? link : notice.link;
        copies.push({
          recipientId: recipient.recipientId,
          renditionId: pinned.rendition.renditionId ?? `edition:${pinned.rendition.releaseId}`,
          state: "accepted",
          at: at.toString(),
        });
        recipients.push({ recipientId: recipient.recipientId, dedupeKey: recipient.dedupeKey });
      }

      const ceilingCount = acknowledged ?? eligibility.eligible.length;
      const intent: NotificationIntentRecord = {
        intentId,
        publisherId,
        purpose,
        documentId: document.documentId,
        releaseId: release.releaseId,
        intendedAt: intendedAt.toString(),
        ceilingCount,
        revision: INITIAL_REVISION_TOKEN,
      };
      const sendResult: NotificationSendResultRecord = {
        sendResultId: newRecordId("send-result"),
        intentId,
        recipients: copies,
        recordedAt: at.toString(),
        revision: INITIAL_REVISION_TOKEN,
      };

      writeState(context.docs, opened, {
        notificationIntents: [...state.notificationIntents, intent],
        notificationResults: [...state.notificationResults, sendResult],
        contentDocuments: state.contentDocuments.map((candidate) =>
          candidate.documentId === document.documentId
            ? { ...candidate, revision: nextRevision(candidate.revision) }
            : candidate,
        ),
      });

      const result: NotificationSubmissionView = {
        intentId,
        sendResultId: sendResult.sendResultId,
        documentId: document.documentId,
        releaseId: release.releaseId,
        publisherId,
        purpose,
        ceilingCount,
        eligibleCount: eligibility.eligible.length,
        excludedCount: eligibility.excluded.length,
        acceptedCount: copies.length,
        unconfirmedCount: unconfirmed,
        alreadyCoveredCount: alreadyCovered,
        link,
        recipients,
      };
      return {
        changed: true,
        revision: nextRevision(document.revision),
        result,
        created: [intentId, sendResult.sendResultId],
        changedIds: [document.documentId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Withdrawal: one document, one edition, and Stop showing me publicly
// ---------------------------------------------------------------------------------------------

/** The payload the two document withdrawals and containment accept: one document. */
const documentPayloadSchema = z.strictObject({ documentId: recordIdSchema });

/** The payload a document withdrawal accepts, inferred so its confirmation holds one shape. */
export type DocumentPayload = z.infer<typeof documentPayloadSchema>;

/** What one withdrawal or containment produced. */
export type WithdrawalView = {
  readonly documentId: string;
  /** The releases now withdrawn, including those that already were. */
  readonly withdrawnReleaseIds: readonly string[];
  /** How many releases this request withdrew, as opposed to found already withdrawn. */
  readonly newlyWithdrawnCount: number;
}

/**
 * Withdraws every release one document's Update editions hold.
 *
 * A tombstone carries no identifying content and no surface here claims to recall a copy a third party
 * already holds or a message already submitted. Outcomes: `accepted`, `unchanged`, `conflict`,
 * `denied`, `invalid`, `alreadyAccepted`, `unavailable`, `unknown`.
 */
export async function withdrawUpdate(
  sessionId: string,
  input: MutationInput<DocumentPayload>,
): Promise<MutationOutcome> {
  return withdrawDocumentFamily(sessionId, input, "withdrawUpdate", (family) => family === "update");
}

/**
 * Withdraws every release one document's Worker or Project Page editions hold, with the same
 * guarantees as {@link withdrawUpdate} and the page families only.
 *
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function withdrawPage(
  sessionId: string,
  input: MutationInput<DocumentPayload>,
): Promise<MutationOutcome> {
  return withdrawDocumentFamily(
    sessionId,
    input,
    "withdrawPage",
    (family) => family !== "update",
  );
}

/**
 * The one withdrawal of a whole document's releases, shared by the Update and Page families so the
 * tombstone, the instant and the "no recall" rule are stated once.
 */
async function withdrawDocumentFamily(
  sessionId: string,
  input: MutationInput<DocumentPayload>,
  name: string,
  admits: (family: ContentFamily) => boolean,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: documentPayloadSchema,
    name,
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const record = opened?.state.contentDocuments.find(
        (candidate) => candidate.documentId === input.payload.documentId,
      );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const document = requireDocument(state, input.payload.documentId);
      if (!admits(document.family)) {
        throw invalidField(
          "documentId",
          "This document belongs to another content family, so its own withdrawal applies to it.",
        );
      }
      const at = scenarioInstant(context.session);
      const releases = releasesOfDocument(state, document.documentId);

      let newlyWithdrawn = 0;
      const withdrawnIds: string[] = [];
      const nextReleases = releases.map((release) => {
        const variant = state.contentVariants.find(
          (candidate) => candidate.variantId === release.variantId,
        );
        const domain = domainReleaseOf(release, variant, "");
        const withdrawal = withdrawEdition(domain, { at });
        withdrawnIds.push(withdrawal.release.releaseId);
        if (release.withdrawnAt !== null) {
          return release;
        }
        newlyWithdrawn += 1;
        return storedReleaseOf(withdrawal.release, nextRevision(release.revision), release);
      });

      if (newlyWithdrawn === 0) {
        return { changed: false };
      }

      writeState(context.docs, opened, {
        releases: nextReleases,
        contentDocuments: state.contentDocuments.map((candidate) =>
          candidate.documentId === document.documentId
            ? { ...candidate, revision: nextRevision(candidate.revision) }
            : candidate,
        ),
      });

      const result: WithdrawalView = {
        documentId: document.documentId,
        withdrawnReleaseIds: withdrawnIds,
        newlyWithdrawnCount: newlyWithdrawn,
      };
      return {
        changed: true,
        revision: nextRevision(document.revision),
        result,
        changedIds: withdrawnIds,
      } satisfies ApplyResult<typeof result>;
    },
  });
}

/** The payload a single edition's withdrawal accepts: one variant. */
const localeWithdrawalPayloadSchema = z.strictObject({ variantId: recordIdSchema });

/** The payload a single edition's withdrawal accepts, inferred so its confirmation holds one shape. */
export type LocaleWithdrawalPayload = z.infer<typeof localeWithdrawalPayloadSchema>;

/**
 * Withdraws one locale edition and leaves every sibling released.
 *
 * The edition keeps its identity, its reach value and its release record, so a withdrawn edition is not
 * a deleted source and an archived draft is not a withdrawn publication.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function withdrawLocale(
  sessionId: string,
  input: MutationInput<LocaleWithdrawalPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: localeWithdrawalPayloadSchema,
    name: "withdrawLocale",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const variant = opened?.state.contentVariants.find(
        (candidate) => candidate.variantId === input.payload.variantId,
      );
      const document =
        variant === undefined
          ? undefined
          : opened?.state.contentDocuments.find(
              (candidate) => candidate.documentId === variant.documentId,
            );
      return document === undefined ? unresolvedTarget() : recordTarget(document.revision, document);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const variant = requireVariant(state, input.payload.variantId);
      const document = requireDocument(state, variant.documentId);
      const head = headReleaseOf(state, variant);
      if (head === undefined || head.withdrawnAt !== null) {
        return { changed: false };
      }

      const withdrawal = withdrawEdition(domainReleaseOf(head, variant, ""), {
        at: scenarioInstant(context.session),
      });
      const stored = storedReleaseOf(withdrawal.release, nextRevision(head.revision), head);

      writeState(context.docs, opened, {
        releases: replaceRelease(state.releases, stored),
        contentDocuments: state.contentDocuments.map((candidate) =>
          candidate.documentId === document.documentId
            ? { ...candidate, revision: nextRevision(candidate.revision) }
            : candidate,
        ),
      });

      const result: WithdrawalView = {
        documentId: document.documentId,
        withdrawnReleaseIds: [stored.releaseId],
        newlyWithdrawnCount: 1,
      };
      return {
        changed: true,
        revision: nextRevision(document.revision),
        result,
        changedIds: [stored.releaseId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

/** The payload both reach mutations accept: the document and the reach it is to carry. */
const setReachPayloadSchema = z.strictObject({
  documentId: recordIdSchema,
  reach: reachSchema,
});

/** The payload `setReach` accepts, inferred so the reach control holds one shape. */
export type SetReachPayload = z.infer<typeof setReachPayloadSchema>;

/** What a reach change produced, per edition and as a whole. */
export type ReachView = {
  readonly documentId: string;
  readonly reach: ReleaseReach;
  readonly releaseIds: readonly string[];
  readonly changedCount: number;
}

/**
 * Changes how far one document's released editions reach: not public, public by link only, or listed.
 *
 * Reach is a discoverability change and nothing else. `link-public` means public but unlisted and
 * `noindex`, so the discovery index omits it while a direct link still serves it; publishing,
 * withdrawing and notifying stay separate actions that no reach request performs.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function setReach(
  sessionId: string,
  input: MutationInput<SetReachPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: setReachPayloadSchema,
    name: "setReach",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const record = opened?.state.contentDocuments.find(
        (candidate) => candidate.documentId === input.payload.documentId,
      );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const document = requireDocument(state, input.payload.documentId);
      const heads = state.contentVariants
        .filter((variant) => variant.documentId === document.documentId)
        .map((variant) => headReleaseOf(state, variant))
        .filter((release): release is ReleaseRecord => release !== undefined);
      if (heads.length === 0) {
        throw invalidField(
          "documentId",
          "This document publishes no edition yet, so it has no reach to set.",
        );
      }

      const nextReleases: ReleaseRecord[] = [];
      const releaseIds: string[] = [];
      for (const head of heads) {
        const decision = decideReach(head.reach, input.payload.reach);
        if (decision.status === "invalid") {
          throw invalidField("reach", decision.reason);
        }
        if (decision.status === "unchanged") {
          continue;
        }
        nextReleases.push({
          ...head,
          reach: decision.reach,
          revision: nextRevision(head.revision),
        });
        releaseIds.push(head.releaseId);
      }

      if (nextReleases.length === 0) {
        return { changed: false };
      }

      const byId = new Map(nextReleases.map((release) => [release.releaseId, release]));
      writeState(context.docs, opened, {
        releases: state.releases.map((release) => byId.get(release.releaseId) ?? release),
        contentDocuments: state.contentDocuments.map((candidate) =>
          candidate.documentId === document.documentId
            ? { ...candidate, revision: nextRevision(candidate.revision) }
            : candidate,
        ),
      });

      const result: ReachView = {
        documentId: document.documentId,
        reach: input.payload.reach,
        releaseIds,
        changedCount: nextReleases.length,
      };
      return {
        changed: true,
        revision: nextRevision(document.revision),
        result,
        changedIds: releaseIds,
      } satisfies ApplyResult<typeof result>;
    },
  });
}

/**
 * Stops showing one document publicly: every edition, in every locale and audience, is withdrawn at one
 * instant.
 *
 * Containment reads nothing but the releases, so it completes while an unrelated draft of the same
 * document is invalid and never asks the author to repair prose first. It removes the editions from the
 * discovery index and from direct reading in the same read that records the withdrawal, and it deletes
 * no source work and claims no recall of a copy already received.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function stopShowingPublicly(
  sessionId: string,
  input: MutationInput<DocumentPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: documentPayloadSchema,
    name: "stopShowingPublicly",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const record = opened?.state.contentDocuments.find(
        (candidate) => candidate.documentId === input.payload.documentId,
      );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const document = requireDocument(state, input.payload.documentId);
      const at = scenarioInstant(context.session);
      const records = releasesOfDocument(state, document.documentId);

      const domains = records.map((release) =>
        domainReleaseOf(
          release,
          state.contentVariants.find((variant) => variant.variantId === release.variantId),
          "",
        ),
      );
      const contained = containEditions(domains, { at });
      const byId = new Map(contained.withdrawals.map((entry) => [entry.release.releaseId, entry]));

      let newlyWithdrawn = 0;
      const nextReleases = records.map((release) => {
        const withdrawal = byId.get(release.releaseId);
        if (withdrawal === undefined || release.withdrawnAt !== null) {
          return release;
        }
        newlyWithdrawn += 1;
        return storedReleaseOf(withdrawal.release, nextRevision(release.revision), release);
      });

      if (newlyWithdrawn === 0) {
        return { changed: false };
      }

      writeState(context.docs, opened, {
        releases: nextReleases,
        contentDocuments: state.contentDocuments.map((candidate) =>
          candidate.documentId === document.documentId
            ? { ...candidate, revision: nextRevision(candidate.revision) }
            : candidate,
        ),
      });

      const result: WithdrawalView = {
        documentId: document.documentId,
        withdrawnReleaseIds: records.map((release) => release.releaseId),
        newlyWithdrawnCount: newlyWithdrawn,
      };
      return {
        changed: true,
        revision: nextRevision(document.revision),
        result,
        changedIds: records.map((release) => release.releaseId),
      } satisfies ApplyResult<typeof result>;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// restoreRevisionAsDraft — always a new draft, never a revived release
// ---------------------------------------------------------------------------------------------

/** The payload `restoreRevisionAsDraft` accepts: the revision to copy. */
const restoreRevisionPayloadSchema = z.strictObject({ revisionId: recordIdSchema });

/** The payload `restoreRevisionAsDraft` accepts, inferred so the history control holds one shape. */
export type RestoreRevisionPayload = z.infer<typeof restoreRevisionPayloadSchema>;

/**
 * Restores an earlier revision as a new draft, with a new identity, a new author and a new creation
 * instant.
 *
 * A revision identity is never reused, so restoring a released revision leaves every earlier revision,
 * candidate and release exactly where it was: this creates a draft and publishes nothing, and the
 * overwritten content stays in the history that produced it.
 * Outcomes: `accepted`, `conflict`, `denied`, `invalid`, `alreadyAccepted`, `unavailable`, `unknown`.
 */
export async function restoreRevisionAsDraft(
  sessionId: string,
  input: MutationInput<RestoreRevisionPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: restoreRevisionPayloadSchema,
    name: "restoreRevisionAsDraft",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      const record = opened?.state.contentRevisions.find(
        (candidate) => candidate.revisionId === input.payload.revisionId,
      );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const source = requireRevision(state, input.payload.revisionId);
      const variant = requireVariant(state, source.variantId);
      const document = requireDocument(state, variant.documentId);

      const restored = restoreAsNewDraft(
        domainRevisionOf(source, requireParsedBody(source)),
        {
          authorPrincipalId: context.session.principalId,
          revisionId: newRecordId("rev"),
          at: scenarioInstant(context.session),
        },
      );
      const record: StoredContentRevision = {
        ...source,
        revisionId: restored.revisionId,
        authorPrincipalId: principalIdOf(restored.authorPrincipalId),
        createdAt: restored.createdAt.toString(),
        revision: INITIAL_REVISION_TOKEN,
      };

      const pointed = applyDraftRevision(domainVariantOf(variant), restored);
      if (pointed.status === "invalid") {
        throw invalidAt(pointed.issues);
      }

      writeState(context.docs, opened, {
        contentRevisions: [...state.contentRevisions, record],
        contentVariants: replaceVariant(
          state.contentVariants,
          storedVariantOf(pointed.variant, nextRevision(variant.revision)),
        ),
      });

      const result = {
        revisionId: restored.revisionId,
        variantId: variant.variantId,
        documentId: document.documentId,
      };
      return {
        changed: true,
        revision: nextRevision(variant.revision),
        result,
        created: [restored.revisionId],
        changedIds: [variant.variantId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}


// ---------------------------------------------------------------------------------------------
// Sections: one builder for both page families
// ---------------------------------------------------------------------------------------------

/** The draft one section mutation edits: the variant, its draft revision, the document and its sections. */
interface DraftTarget {
  readonly variant: ContentVariantRecord;
  readonly revision: StoredContentRevision;
  readonly document: ContentDocumentRecord;
  readonly body: ContentDocumentJson;
}

/**
 * The draft a section payload names, by revision or by the variant that holds it.
 *
 * A named revision must be the edition's current draft: a revision a later save replaced is history,
 * and composing into history would edit something no reader and no reviewer will ever see. A variant
 * that has never been saved has no draft to compose into, which is stated rather than created here —
 * creating one would need a document body this mutation was never given.
 */
function draftTargetOf(
  state: ContentMutationState,
  payload: { readonly draftRevisionId?: string; readonly variantId?: string },
): DraftTarget {
  let variant: ContentVariantRecord;
  let revision: StoredContentRevision;

  if (payload.draftRevisionId !== undefined) {
    revision = requireRevision(state, payload.draftRevisionId);
    variant = requireVariant(state, revision.variantId);
    if (variant.draftRevisionId !== revision.revisionId) {
      throw invalidField(
        "draftRevisionId",
        "This revision is no longer the edition's draft, so reopen the page and compose into the current draft.",
      );
    }
  } else if (payload.variantId !== undefined) {
    variant = requireVariant(state, payload.variantId);
    if (variant.draftRevisionId === null) {
      throw invalidField(
        "variantId",
        "This edition has no draft yet, so save the draft once before composing its sections.",
      );
    }
    revision = requireRevision(state, variant.draftRevisionId);
  } else {
    throw invalidField(
      "draftRevisionId",
      "A section change names the draft revision it edits, so open the page's draft first.",
    );
  }

  const document = requireDocument(state, variant.documentId);
  if (document.family === "update") {
    throw invalidField(
      "variantId",
      "A section composes a Worker or Project Page; an Update carries prose and its own media placements.",
    );
  }
  return { variant, revision, document, body: requireParsedBody(revision) };
}

/**
 * The position of one section inside a draft.
 *
 * A section states no identity of its own — the profile's section record is its catalogue element, its
 * fields and its presentation — so a builder addresses one by its position, written as a plain number
 * or as `section-<position>`, and an element key is accepted as a convenience that resolves to the
 * first section composed from it. Position is what a move names, which is why no drag payload exists
 * anywhere in this path.
 */
function sectionIndexOf(sections: readonly ContentSection[], sectionId: string): number {
  const prefixed = /^section-(\d+)$/u.exec(sectionId);
  const numericText = prefixed?.[1] ?? (/^\d+$/u.test(sectionId) ? sectionId : undefined);
  if (numericText !== undefined) {
    const index = Number.parseInt(numericText, 10);
    if (index >= 0 && index < sections.length) {
      return index;
    }
    throw invalidField(
      "sectionId",
      "This page holds no section at that position, so reopen it and choose the section again.",
    );
  }
  const byElement = sections.findIndex((section) => section.element === sectionId);
  if (byElement < 0) {
    throw invalidField(
      "sectionId",
      "This page holds no section by that identity, so reopen it and choose the section again.",
    );
  }
  return byElement;
}

/** The lock refusal a source-supplied section answers. */
const MANAGED_SECTION_REFUSAL =
  "This section is supplied by the source, so it is read-only here and cannot be added, moved, duplicated or removed.";

/** The empty field values a newly added section starts from: one blank value per field it edits. */
function emptyFieldsFor(type: PageSectionType): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const key of SECTION_FIELD_KEYS[type]) {
    fields[key] = "";
  }
  return fields;
}

/**
 * Writes one edited draft revision: the body and its sections, the placements and the caption tracks.
 *
 * The revision's digest is recomputed from the edited content, so an edit that changes nothing answers
 * `unchanged` and a change is visible to a later comparison against a release. The revision keeps its
 * identity and advances its token, because a draft is the working copy: what a candidate froze and what
 * a release published stay immutable.
 */
function writeDraftEdit(input: {
  readonly context: { readonly docs: { state: unknown }; readonly session: ResolvedSession };
  readonly opened: OpenedState;
  readonly target: DraftTarget;
  readonly body: ContentDocumentJson;
  readonly placements: readonly MediaPlacementRecord[];
  readonly tracks: readonly ContentCaptionTrackRecord[];
}):
  | { readonly changed: false }
  | {
      readonly changed: true;
      readonly revisionId: string;
      readonly revision: string;
      readonly documentId: string;
      readonly variantId: string;
    } {
  const { target, body, placements, tracks } = input;
  const altText: Record<string, string> = {};
  const captions: Record<string, string> = {};
  for (const placement of placements) {
    altText[placement.placementId] = placement.altText;
    if (placement.caption !== null) {
      captions[placement.placementId] = placement.caption;
    }
  }

  const previous = domainRevisionOf(target.revision, target.body);
  const edited: RevisionContentLike = {
    body,
    sections: body.sections,
    mediaPlacements: placements.map((placement) => ({
      placementId: placement.placementId,
      assetId: placement.assetId,
    })),
    captions,
    altText,
    sharePresentation: previous.sharePresentation,
  };
  const checksum = revisionChecksum(edited);
  const next: StoredContentRevision = {
    ...target.revision,
    body,
    mediaPlacements: [...placements],
    captions: [...tracks],
    contentChecksum: checksum,
    revision: nextRevision(target.revision.revision),
  };

  if (storedContentEquals(target.revision, next)) {
    return { changed: false };
  }

  const nextVariants = replaceVariant(
    input.opened.state.contentVariants,
    storedVariantOf(domainVariantOf(target.variant), nextRevision(target.variant.revision)),
  );
  writeState(input.context.docs, input.opened, {
    contentRevisions: replaceRevision(input.opened.state.contentRevisions, next),
    contentVariants: nextVariants,
  });

  return {
    changed: true,
    revisionId: next.revisionId,
    revision: next.revision,
    documentId: target.document.documentId,
    variantId: target.variant.variantId,
  };
}

/** The authored content `revisionChecksum` reads: the document, its sections and the media it places. */
type RevisionContentLike = Parameters<typeof revisionChecksum>[0];

/** Replaces one stored revision by identity, leaving the collection's order as it was. */
function replaceRevision(
  revisions: readonly StoredContentRevision[],
  next: StoredContentRevision,
): readonly StoredContentRevision[] {
  return revisions.map((revision) =>
    revision.revisionId === next.revisionId ? next : revision,
  );
}

/** What one section edit produced. */
export type SectionEditView = {
  readonly documentId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly revision: string;
  readonly sectionCount: number;
};

/**
 * Runs one section edit inside the one runner, sharing the target resolution, the no-op answer and the
 * per-field refusal across the six builder actions so no action can reach a draft another would refuse.
 */
async function editDraftSections<P extends { readonly draftRevisionId?: string; readonly variantId?: string }>(
  input: {
    readonly sessionId: string;
    readonly mutation: MutationInput<P>;
    readonly schema: z.ZodType<P>;
    readonly name: string;
    readonly change: (target: DraftTarget, payload: P) => readonly ContentSection[];
  },
): Promise<MutationOutcome> {
  return runMutation({
    sessionId: input.sessionId,
    input: input.mutation,
    schema: input.schema,
    name: input.name,
    authorize: (session) => editorialDecision(session, input.mutation.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      if (opened === undefined) {
        return unresolvedTarget();
      }
      const payload = input.mutation.payload;
      const variant =
        payload.draftRevisionId === undefined && payload.variantId !== undefined
          ? opened.state.contentVariants.find(
              (candidate) => candidate.variantId === payload.variantId,
            )
          : undefined;
      const revisionId = payload.draftRevisionId ?? variant?.draftRevisionId ?? undefined;
      const record =
        revisionId === undefined
          ? undefined
          : opened.state.contentRevisions.find(
              (candidate) => candidate.revisionId === revisionId,
            );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const target = draftTargetOf(opened.state, input.mutation.payload);
      const sections = input.change(target, input.mutation.payload);
      const written = writeDraftEdit({
        context,
        opened,
        target,
        body: { ...target.body, sections },
        placements: target.revision.mediaPlacements,
        tracks: target.revision.captions,
      });
      if (!written.changed) {
        return { changed: false };
      }
      const result: SectionEditView = {
        documentId: written.documentId,
        variantId: written.variantId,
        revisionId: written.revisionId,
        revision: written.revision,
        sectionCount: sections.length,
      };
      return {
        changed: true,
        revision: written.revision,
        result,
        changedIds: [written.revisionId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

/** The payload `addSection` accepts: one admitted section type, after an optional section. */
const addSectionPayloadSchema = z
  .strictObject({
    ...draftTargetShape,
    sectionType: z.string().trim().min(1, "Choose the section to add."),
    afterSectionId: recordIdSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (!namesDraftTarget(payload)) {
      ctx.addIssue({
        code: "custom",
        path: ["draftRevisionId"],
        message: NO_DRAFT_TARGET_MESSAGE,
      });
    }
  });

/** The payload `addSection` accepts, inferred so the builder catalogue and its form hold one shape. */
export type AddSectionPayload = z.infer<typeof addSectionPayloadSchema>;

/**
 * Adds one section of an admitted catalogue type to a page draft, after a named section or at the end.
 *
 * A type outside the family catalogue is `invalid`, and a source-supplied section cannot be added by an
 * author: its content is the source's. Composing adds structure and content and nothing else — no
 * subject, consent or giving binding changes because a section was added.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function addSection(
  sessionId: string,
  input: MutationInput<AddSectionPayload>,
): Promise<MutationOutcome> {
  return editDraftSections({
    sessionId,
    mutation: input,
    schema: addSectionPayloadSchema,
    name: "addSection",
    change: (target, payload) => {
      const type = requireSectionType(payload.sectionType);
      if (MANAGED_SECTION_TYPES.has(type)) {
        throw invalidField("sectionType", MANAGED_SECTION_REFUSAL);
      }
      const sections = target.body.sections;
      const after =
        payload.afterSectionId === undefined
          ? sections.length
          : sectionIndexOf(sections, payload.afterSectionId) + 1;
      const added: ContentSection = {
        element: type,
        fields: emptyFieldsFor(type),
        presentation: DEFAULT_PRESENTATION,
      };
      return [...sections.slice(0, after), added, ...sections.slice(after)];
    },
  });
}

/** The payload `moveSection` accepts: one section and the position it moves to. */
const moveSectionPayloadSchema = z
  .strictObject({
    ...draftTargetShape,
    sectionId: recordIdSchema,
    targetIndex: z
      .int({ error: "State the position this section moves to as a whole number." })
      .nonnegative("A position is zero or more, counting from the first section."),
  })
  .superRefine((payload, ctx) => {
    if (!namesDraftTarget(payload)) {
      ctx.addIssue({
        code: "custom",
        path: ["draftRevisionId"],
        message: NO_DRAFT_TARGET_MESSAGE,
      });
    }
  });

/** The payload `moveSection` accepts, inferred so the builder's move controls hold one shape. */
export type MoveSectionPayload = z.infer<typeof moveSectionPayloadSchema>;

/**
 * Moves one section to an explicit position.
 *
 * The position is a number the caller states, so moving never depends on a continuous pointer
 * movement: a move-up button, a move-down button and a move-to-position control all submit this same
 * payload, and a keyboard performs exactly what a pointer does.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function moveSection(
  sessionId: string,
  input: MutationInput<MoveSectionPayload>,
): Promise<MutationOutcome> {
  return editDraftSections({
    sessionId,
    mutation: input,
    schema: moveSectionPayloadSchema,
    name: "moveSection",
    change: (target, payload) => {
      const sections = target.body.sections;
      const from = sectionIndexOf(sections, payload.sectionId);
      const moved = sections[from];
      if (moved === undefined) {
        throw invalidField("sectionId", "This page holds no section by that identity.");
      }
      if (MANAGED_SECTION_TYPES.has(moved.element)) {
        throw invalidField("sectionId", MANAGED_SECTION_REFUSAL);
      }
      const destination = Math.min(payload.targetIndex, sections.length - 1);
      if (destination === from) {
        return sections;
      }
      const rest = sections.filter((_section, index) => index !== from);
      return [...rest.slice(0, destination), moved, ...rest.slice(destination)];
    },
  });
}

/** The payload `duplicateSection` accepts: one section to copy. */
const sectionReferencePayloadSchema = z
  .strictObject({ ...draftTargetShape, sectionId: recordIdSchema })
  .superRefine((payload, ctx) => {
    if (!namesDraftTarget(payload)) {
      ctx.addIssue({
        code: "custom",
        path: ["draftRevisionId"],
        message: NO_DRAFT_TARGET_MESSAGE,
      });
    }
  });

/** The payload `duplicateSection` and `removeSection` accept, inferred so their controls hold one shape. */
export type SectionReferencePayload = z.infer<typeof sectionReferencePayloadSchema>;

/**
 * Copies one section, structure and content, immediately after itself.
 *
 * A copy is a copy: it never changes the page's subject, its consent or its giving binding, and a
 * source-supplied section is refused because the source owns what it supplies.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function duplicateSection(
  sessionId: string,
  input: MutationInput<SectionReferencePayload>,
): Promise<MutationOutcome> {
  return editDraftSections({
    sessionId,
    mutation: input,
    schema: sectionReferencePayloadSchema,
    name: "duplicateSection",
    change: (target, payload) => {
      const sections = target.body.sections;
      const index = sectionIndexOf(sections, payload.sectionId);
      const source = sections[index];
      if (source === undefined) {
        throw invalidField("sectionId", "This page holds no section by that identity.");
      }
      if (MANAGED_SECTION_TYPES.has(source.element)) {
        throw invalidField("sectionId", MANAGED_SECTION_REFUSAL);
      }
      const copy: ContentSection = {
        element: source.element,
        fields: { ...source.fields },
        presentation: { ...source.presentation },
        ...(source.direction === undefined ? {} : { direction: source.direction }),
      };
      return [...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)];
    },
  });
}

/**
 * Removes one section from a page draft.
 *
 * Removing a section removes a reference and nothing beside it: the media it placed stays registered
 * for every other placement and for every release that already served it, and a source-supplied
 * section is refused with the reason it is locked.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function removeSection(
  sessionId: string,
  input: MutationInput<SectionReferencePayload>,
): Promise<MutationOutcome> {
  return editDraftSections({
    sessionId,
    mutation: input,
    schema: sectionReferencePayloadSchema,
    name: "removeSection",
    change: (target, payload) => {
      const sections = target.body.sections;
      const index = sectionIndexOf(sections, payload.sectionId);
      const section = sections[index];
      if (section === undefined) {
        throw invalidField("sectionId", "This page holds no section by that identity.");
      }
      if (MANAGED_SECTION_TYPES.has(section.element)) {
        throw invalidField("sectionId", MANAGED_SECTION_REFUSAL);
      }
      return sections.filter((_value, position) => position !== index);
    },
  });

}
/** The payload `saveSectionFields` accepts: one section's fields and its presentation choices. */
const saveSectionFieldsPayloadSchema = z
  .strictObject({
    ...draftTargetShape,
    sectionId: recordIdSchema,
    fields: sectionFieldsSchema.optional(),
    presentation: presentationChoiceSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (!namesDraftTarget(payload)) {
      ctx.addIssue({
        code: "custom",
        path: ["draftRevisionId"],
        message: NO_DRAFT_TARGET_MESSAGE,
      });
    }
    if (payload.fields === undefined && payload.presentation === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "State the fields this section changes, or the presentation it uses.",
      });
    }
  });

/** The payload `saveSectionFields` accepts, inferred so the builder's field form holds one shape. */
export type SaveSectionFieldsPayload = z.infer<typeof saveSectionFieldsPayloadSchema>;

/**
 * Saves one section's fields and its bounded presentation choices.
 *
 * Only the four admitted presentation choices exist — treatment, layout, alignment and image fit — and
 * only the fields the section type edits are accepted, so no arbitrary CSS, script, embed or per-page
 * theme can be stored. A value outside the admitted set is `invalid` rather than styled a second time.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function saveSectionFields(
  sessionId: string,
  input: MutationInput<SaveSectionFieldsPayload>,
): Promise<MutationOutcome> {
  return editDraftSections({
    sessionId,
    mutation: input,
    schema: saveSectionFieldsPayloadSchema,
    name: "saveSectionFields",
    change: (target, payload) => {
      const sections = target.body.sections;
      const index = sectionIndexOf(sections, payload.sectionId);
      const section = sections[index];
      if (section === undefined) {
        throw invalidField("sectionId", "This page holds no section by that identity.");
      }
      if (MANAGED_SECTION_TYPES.has(section.element)) {
        throw invalidField("sectionId", MANAGED_SECTION_REFUSAL);
      }
      const admitted = SECTION_FIELD_KEYS[section.element as PageSectionType] ?? [];
      for (const key of Object.keys(payload.fields ?? {})) {
        if (!admitted.includes(key)) {
          throw invalidField(
            `fields.${key}`,
            `This section type edits ${admitted.length === 0 ? "no field" : admitted.join(", ")}, so "${key}" is not one of them.`,
          );
        }
      }
      return sections.map((current, position) =>
        position === index
          ? {
              ...current,
              fields: { ...current.fields, ...payload.fields },
              presentation: payload.presentation ?? current.presentation,
            }
          : current,
      );
    },
  });
}

/** The payload `applyPreset` accepts: one preset the catalogue proposes. */
const applyPresetPayloadSchema = z
  .strictObject({
    ...draftTargetShape,
    presetId: z.enum(PAGE_PRESET_IDS, {
      error: "Choose one of the presets this page catalogue proposes.",
    }),
  })
  .superRefine((payload, ctx) => {
    if (!namesDraftTarget(payload)) {
      ctx.addIssue({
        code: "custom",
        path: ["draftRevisionId"],
        message: NO_DRAFT_TARGET_MESSAGE,
      });
    }
  });

/** The payload `applyPreset` accepts, inferred so the preset control holds one shape. */
export type ApplyPresetPayload = z.infer<typeof applyPresetPayloadSchema>;

/**
 * Applies one catalogue preset: the sections it proposes are composed into the draft and nothing is
 * published.
 *
 * A preset is a proposal, so applying one always produces something for review rather than a release,
 * and it changes no subject, consent or giving binding.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function applyPreset(
  sessionId: string,
  input: MutationInput<ApplyPresetPayload>,
): Promise<MutationOutcome> {
  return editDraftSections({
    sessionId,
    mutation: input,
    schema: applyPresetPayloadSchema,
    name: "applyPreset",
    change: (target, payload) => {
      const proposed = PAGE_PRESETS[payload.presetId] ?? [];
      const added: ContentSection[] = proposed.map((type) => ({
        element: type,
        fields: emptyFieldsFor(type),
        presentation: DEFAULT_PRESENTATION,
      }));
      return [...target.body.sections, ...added];
    },
  });
}



// ---------------------------------------------------------------------------------------------
// Media: registering an asset, replacing one placement, removing one
// ---------------------------------------------------------------------------------------------

/**
 * Where a registered upload's prepared bytes are kept: a directory of the git-ignored data tree,
 * beside the session documents and never inside the repository's public files.
 */
const RENDITION_DIRECTORY = join(DATA_ROOT, "media");

/**
 * The extension a stored rendition file carries, so a person reading the directory recognises what it
 * holds. Nothing decides anything from it: the media type served is the record's own `mimeType`, and a
 * request never reaches a file name.
 */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "text/vtt": "vtt",
  "text/plain": "txt",
};

/**
 * Persists one prepared rendition's bytes and answers the reference its record names.
 *
 * **The one I/O in this file, and why it is here.** A rendition is bytes: the media module returns the
 * prepared bytes, the record states a reference, and the scope-checked serving read resolves that
 * reference inside the git-ignored data tree. Nothing else in this application can create those bytes,
 * so this function writes them, under `DATA_ROOT/media/<sessionId>/`, and answers the repository-relative
 * reference the serving read resolves against the repository root. The original upload is never written
 * here: only re-encoded or re-muxed bytes leave the pipeline, which is what keeps the source unreachable
 * and its file name out of every consumer's hands.
 */
async function persistRenditionBytes(
  sessionId: string,
  rendition: MediaRendition,
): Promise<string> {
  const directory = join(RENDITION_DIRECTORY, sessionId);
  await mkdir(directory, { recursive: true });
  const safeId = rendition.renditionId.replace(/[^A-Za-z0-9_-]/gu, "-");
  const extension = MIME_EXTENSIONS[rendition.mimeType] ?? "bin";
  const fileName = `${safeId}.${extension}`;
  await writeFile(join(directory, fileName), rendition.bytes);
  return ["", ".data", "media", sessionId, fileName].join("/");
}

/** Decodes one base64 payload into the bytes the media pipeline inspects, or the refusal it states. */
function decodeBase64Bytes(value: string, field: string): Uint8Array {
  try {
    const decoded = globalThis.atob(value.replace(/\s+/gu, ""));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw invalidField(field, "These bytes could not be read, so choose the file again.");
  }
}

/** One prepared rendition as the stored record states it. */
function storedRenditionOf(rendition: MediaRendition, bytesRef: string): {
  readonly renditionId: string;
  readonly purpose: MediaAssetRenditionPurpose;
  readonly bytesRef: string;
  readonly mimeType: string;
} {
  return {
    renditionId: rendition.renditionId,
    purpose: rendition.purpose,
    bytesRef,
    mimeType: rendition.mimeType,
  };
}

/** One acceptance's profile check as the stored record states it. */
function storedProfileOf(check: MediaProfileCheck): {
  readonly container: string;
  readonly codec: string;
  readonly durationSeconds: number | null;
  readonly width: number;
  readonly height: number;
} {
  return check.kind === "image"
    ? {
        container: check.format,
        codec: check.format,
        durationSeconds: null,
        width: check.width,
        height: check.height,
      }
    : {
        container: check.container,
        codec: check.codec,
        durationSeconds: check.durationS,
        width: check.width,
        height: check.height,
      };
}

/** One delivered-byte verification as the stored record states it. */
function storedVerificationOf(verification: MediaTagVerification): {
  readonly checked: boolean;
  readonly residualTags: readonly string[];
} {
  return { checked: verification.checked, residualTags: [...verification.residualTags] };
}

/** One upload's bytes and the name the pipeline may inspect but never stores. */
const uploadBytesSchema = z.strictObject({
  bytesBase64: z.string().min(1, "Choose a file to upload."),
  name: z.string().min(1).max(255).optional(),
});

/** How a registration chooses the bytes: uploaded content, typed by its bytes and never by its name. */
const registerMediaAssetPayloadSchema = z
  .strictObject({
    kind: z.enum(["image", "video"], {
      error: "Choose whether this file is an image or a video.",
    }),
    source: uploadBytesSchema,
    altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional(),
    caption: optionalPlacementTextSchema,
    credit: optionalPlacementTextSchema,
    language: localeTagSchema.optional(),
    placement: z
      .strictObject({
        altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional(),
        caption: optionalPlacementTextSchema,
        credit: optionalPlacementTextSchema,
        language: localeTagSchema.optional(),
      })
      .optional(),
    poster: z
      .strictObject({
        bytesBase64: z.string().min(1),
        name: z.string().min(1).max(255).optional(),
        altText: z.string().trim().min(1).max(PLACEMENT_TEXT_MAX_CHARS).optional(),
      })
      .optional(),
    captions: z
      .strictObject({
        vtt: z.string().min(1, "Choose a WebVTT caption file."),
        language: localeTagSchema,
        label: z.string().trim().min(1).max(120).optional(),
      })
      .optional(),
    transcript: z
      .strictObject({
        text: z.string().min(1, "State the transcript, or leave it out."),
      })
      .optional(),
  })
  .superRefine((payload, ctx) => {
    const altText = payload.altText ?? payload.placement?.altText;
    if (payload.kind === "image" && altText === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["altText"],
        message:
          "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again.",
      });
    }
    if (payload.kind === "image" && payload.captions !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["captions"],
        message: "A caption track belongs to a video, so an image carries none.",
      });
    }
    if (payload.poster !== undefined && payload.kind !== "video") {
      ctx.addIssue({
        code: "custom",
        path: ["poster"],
        message: "A poster belongs to a video, so an image carries none.",
      });
    }
  });

/** The payload `registerMediaAsset` accepts, inferred so the picker and its hook hold one shape. */
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetPayloadSchema>;

/** One prepared rendition a registration reports: its identity and the purpose it serves. */
export type RegisteredRenditionView = {
  readonly renditionId: string;
  readonly purpose: string;
};

/** What one registration produced: the asset, its renditions and the description a placement inherits. */
export type RegisteredMediaAssetView = {
  readonly assetId: string;
  readonly kind: "image" | "video";
  readonly state: "ready";
  readonly altText: string | null;
  readonly caption: string | null;
  readonly language: string | null;
  readonly renditions: readonly RegisteredRenditionView[];
};

/**
 * Registers one uploaded image or video as a scoped asset with prepared renditions.
 *
 * Nothing is decided from a name: the kind comes from the bytes, the image runs the one image pipeline
 * (decode, orient, bound to 8,000 px, resize to at most 2,000 px on its longest edge, re-encode, strip
 * metadata) and the video runs the one video profile (MP4 H.264/AAC or WebM VP8/VP9, at most 100 MiB,
 * 180 s and 1920×1080, copied with its descriptive tags removed and the delivered bytes re-verified). A
 * refusal is `invalid` with the pipeline's own reason and next step, and it leaves the surrounding draft
 * and every successful placement exactly as they were. The original is never served and its name never
 * reaches a consumer.
 * Outcomes: `accepted`, `denied`, `invalid`, `alreadyAccepted`, `unavailable`, `unknown`.
 */
export async function registerMediaAsset(
  sessionId: string,
  input: MutationInput<RegisterMediaAssetPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: registerMediaAssetPayloadSchema,
    name: "registerMediaAsset",
    authorize: (session) => editorialDecision(session, input.scope),
    apply: async (context) => {
      const opened = openState(context.docs);
      const { state } = opened;
      const payload = input.payload;
      const assetId = newRecordId("asset");
      const scope: MediaAssetScope = {
        organizationId: input.scope.organizationId,
        ministryId: input.scope.ministryId,
      };
      const bytes = decodeBase64Bytes(payload.source.bytesBase64, "source.bytesBase64");
      const altText = payload.altText ?? payload.placement?.altText ?? "";
      const caption = payload.caption ?? payload.placement?.caption ?? null;
      const credit = payload.credit ?? payload.placement?.credit ?? null;
      const language = payload.language ?? payload.placement?.language ?? null;

      const accepted: MediaAcceptanceSuccess<MediaAssetScope> | MediaRefusal =
        payload.kind === "image"
          ? await acceptImage({
              assetId,
              scope,
              sourceOriginalRef: { system: "local-upload", reference: assetId },
              bytes,
              ...(payload.source.name === undefined ? {} : { sourceName: payload.source.name }),
              altText,
              ...(caption === null ? {} : { caption }),
            })
          : await acceptVideo({
              assetId,
              scope,
              sourceOriginalRef: { system: "local-upload", reference: assetId },
              bytes,
              ...(payload.source.name === undefined ? {} : { sourceName: payload.source.name }),
            });

      if (accepted.state === "rejected") {
        const reason = mediaStateReason("rejected", accepted);
        throw invalidField(
          "source",
          reason.action === undefined ? reason.label : `${reason.label} ${reason.action}`,
        );
      }

      const prepared: MediaRendition[] = [...accepted.renditions];
      if (payload.poster !== undefined) {
        const poster = await prepareRendition({
          assetId,
          purpose: "poster",
          bytes: decodeBase64Bytes(payload.poster.bytesBase64, "poster.bytesBase64"),
          altText: payload.poster.altText ?? altText,
          ...(payload.poster.name === undefined ? {} : { sourceName: payload.poster.name }),
        });
        if (poster.state === "rejected") {
          const reason = mediaStateReason("rejected", poster);
          throw invalidField(
            "poster",
            reason.action === undefined ? reason.label : `${reason.label} ${reason.action}`,
          );
        }
        prepared.push(poster.rendition);
      }
      if (payload.captions !== undefined) {
        const captions = await prepareRendition({
          assetId,
          purpose: "captions",
          bytes: new TextEncoder().encode(payload.captions.vtt),
        });
        if (captions.state === "rejected") {
          const reason = mediaStateReason("rejected", captions);
          throw invalidField(
            "captions",
            reason.action === undefined ? reason.label : `${reason.label} ${reason.action}`,
          );
        }
        prepared.push(captions.rendition);
      }
      if (payload.transcript !== undefined) {
        const transcript = await prepareRendition({
          assetId,
          purpose: "transcript",
          bytes: new TextEncoder().encode(payload.transcript.text),
        });
        if (transcript.state === "rejected") {
          const reason = mediaStateReason("rejected", transcript);
          throw invalidField(
            "transcript",
            reason.action === undefined ? reason.label : `${reason.label} ${reason.action}`,
          );
        }
        prepared.push(transcript.rendition);
      }

      const renditions: {
        renditionId: string;
        purpose: MediaAssetRenditionPurpose;
        bytesRef: string;
        mimeType: string;
      }[] = [];
      for (const rendition of prepared) {
        const bytesRef = await persistRenditionBytes(sessionId, rendition);
        renditions.push(storedRenditionOf(rendition, bytesRef));
      }

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
      const descriptor: MediaAssetDescriptorRecord = {
        assetId,
        altText: altText.length === 0 ? null : altText,
        caption,
        credit,
        language,
        revision: INITIAL_REVISION_TOKEN,
      };

      writeState(context.docs, opened, {
        mediaAssets: [...state.mediaAssets, asset],
        mediaAssetDescriptors: [...state.mediaAssetDescriptors, descriptor],
      });

      const result: RegisteredMediaAssetView = {
        assetId,
        kind: accepted.kind,
        state: "ready",
        altText: descriptor.altText,
        caption,
        language,
        renditions: renditions.map((rendition) => ({
          renditionId: rendition.renditionId,
          purpose: rendition.purpose,
        })),
      };
      return {
        changed: true,
        revision: asset.revision,
        result,
        created: [assetId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

/** The payload `replacePlacement` and `removePlacement` accept: one draft and one placement. */
const placementTargetPayloadSchema = z
  .strictObject({
    ...draftTargetShape,
    placementId: recordIdSchema,
    assetId: recordIdSchema.optional(),
    placement: placementTextSchema.partial().optional(),
  })
  .superRefine((payload, ctx) => {
    if (!namesDraftTarget(payload)) {
      ctx.addIssue({
        code: "custom",
        path: ["draftRevisionId"],
        message: NO_DRAFT_TARGET_MESSAGE,
      });
    }
  });

/** The payload `replacePlacement` and `removePlacement` accept, inferred for their controls. */
export type PlacementTargetPayload = z.infer<typeof placementTargetPayloadSchema>;

/** One stored placement as the reference a draft payload states, so an edit reuses the same validation. */
function placementRefOf(placement: MediaPlacementRecord): z.infer<typeof placementRefSchema> {
  return {
    placementId: placement.placementId,
    assetId: placement.assetId,
    ...(placement.sectionElement === null ? {} : { sectionElement: placement.sectionElement }),
    position: placement.position,
    altText: placement.altText,
    ...(placement.caption === null ? {} : { caption: placement.caption }),
    ...(placement.credit === null ? {} : { credit: placement.credit }),
  };
}

/** The placements left once one asset no longer appears, so its caption tracks go with it. */
function withoutTracksOf(
  tracks: readonly ContentCaptionTrackRecord[],
  remaining: readonly MediaPlacementRecord[],
): readonly ContentCaptionTrackRecord[] {
  const placed = new Set(remaining.map((placement) => placement.assetId));
  return tracks.filter((track) => placed.has(track.assetId));
}

/**
 * Replaces one placement of a draft with another admitted asset, or with a new description of the same
 * asset.
 *
 * The replacement is validated exactly as a new placement is — required alternative text included — so
 * swapping a description is never the way an undescribed image or video gets in. The asset keeps its own
 * identity, renditions and scope, so a replacement can neither widen what the asset admits nor move it
 * into another context, and the placement it replaces keeps its position in the draft.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function replacePlacement(
  sessionId: string,
  input: MutationInput<PlacementTargetPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: placementTargetPayloadSchema,
    name: "replacePlacement",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      if (opened === undefined) {
        return unresolvedTarget();
      }
      const payload = input.payload;
      const variant =
        payload.draftRevisionId === undefined && payload.variantId !== undefined
          ? opened.state.contentVariants.find(
              (candidate) => candidate.variantId === payload.variantId,
            )
          : undefined;
      const revisionId = payload.draftRevisionId ?? variant?.draftRevisionId ?? undefined;
      const record =
        revisionId === undefined
          ? undefined
          : opened.state.contentRevisions.find(
              (candidate) => candidate.revisionId === revisionId,
            );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const target = draftTargetOf(opened.state, input.payload);
      const payload = input.payload;
      const placeholder = target.revision.mediaPlacements.find(
        (placement) => placement.placementId === payload.placementId,
      );
      if (placeholder === undefined) {
        throw invalidField(
          "placementId",
          "This draft holds no placement by that identity, so reopen the page and choose the placement again.",
        );
      }

      const requested = target.revision.mediaPlacements.map((placement) => {
        if (placement.placementId !== payload.placementId) {
          return placementRefOf(placement);
        }
        return {
          ...placementRefOf(placement),
          ...(payload.assetId === undefined ? {} : { assetId: payload.assetId }),
          ...(payload.placement?.altText === undefined
            ? {}
            : { altText: payload.placement.altText }),
          ...(payload.placement?.caption === undefined
            ? {}
            : { caption: payload.placement.caption }),
          ...(payload.placement?.credit === undefined
            ? {}
            : { credit: payload.placement.credit }),
        };
      });

      const resolved = resolvePlacements({
        state: opened.state,
        session: context.session,
        previous: target.revision.mediaPlacements,
        requested,
      });

      const written = writeDraftEdit({
        context,
        opened,
        target,
        body: target.body,
        placements: resolved.placements,
        tracks: withoutTracksOf(target.revision.captions, resolved.placements),
      });
      if (!written.changed) {
        return { changed: false };
      }
      const result: SectionEditView = {
        documentId: written.documentId,
        variantId: written.variantId,
        revisionId: written.revisionId,
        revision: written.revision,
        sectionCount: target.body.sections.length,
      };
      return {
        changed: true,
        revision: written.revision,
        result,
        changedIds: [written.revisionId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}

/**
 * Removes one placement from a draft.
 *
 * Removing a placement removes a reference and nothing beside it: the asset stays registered for every
 * other placement that uses it, and a release that already served the media keeps serving it. Neither
 * the asset's bytes nor a published edition is withdrawn by this mutation.
 * Outcomes: `accepted`, `unchanged`, `conflict`, `denied`, `invalid`, `alreadyAccepted`,
 * `unavailable`, `unknown`.
 */
export async function removePlacement(
  sessionId: string,
  input: MutationInput<PlacementTargetPayload>,
): Promise<MutationOutcome> {
  return runMutation({
    sessionId,
    input,
    schema: placementTargetPayloadSchema,
    name: "removePlacement",
    authorize: (session) => editorialDecision(session, input.scope),
    readCurrent: (docs) => {
      const opened = contentStateOrUndefined(docs);
      if (opened === undefined) {
        return unresolvedTarget();
      }
      const payload = input.payload;
      const variant =
        payload.draftRevisionId === undefined && payload.variantId !== undefined
          ? opened.state.contentVariants.find(
              (candidate) => candidate.variantId === payload.variantId,
            )
          : undefined;
      const revisionId = payload.draftRevisionId ?? variant?.draftRevisionId ?? undefined;
      const record =
        revisionId === undefined
          ? undefined
          : opened.state.contentRevisions.find(
              (candidate) => candidate.revisionId === revisionId,
            );
      return record === undefined ? unresolvedTarget() : recordTarget(record.revision, record);
    },
    apply: (context) => {
      const opened = openState(context.docs);
      const target = draftTargetOf(opened.state, input.payload);
      const placementId = input.payload.placementId;
      if (
        !target.revision.mediaPlacements.some(
          (placement) => placement.placementId === placementId,
        )
      ) {
        throw invalidField(
          "placementId",
          "This draft holds no placement by that identity, so reopen the page and choose the placement again.",
        );
      }

      const placements = target.revision.mediaPlacements.filter(
        (placement) => placement.placementId !== placementId,
      );
      const written = writeDraftEdit({
        context,
        opened,
        target,
        body: target.body,
        placements,
        tracks: withoutTracksOf(target.revision.captions, placements),
      });
      if (!written.changed) {
        return { changed: false };
      }
      const result: SectionEditView = {
        documentId: written.documentId,
        variantId: written.variantId,
        revisionId: written.revisionId,
        revision: written.revision,
        sectionCount: target.body.sections.length,
      };
      return {
        changed: true,
        revision: written.revision,
        result,
        changedIds: [written.revisionId],
      } satisfies ApplyResult<typeof result>;
    },
  });
}


