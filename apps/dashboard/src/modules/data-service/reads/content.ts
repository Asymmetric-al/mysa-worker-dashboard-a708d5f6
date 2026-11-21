/**
 * The ten content reads: everything the Ministry Updates family and the Worker and Project Page
 * families read, and nothing that changes anything.
 *
 * Plan items this file serves: AAP 0.6.1's "Reads: content" row (`readVariantOverview`, `readDraft`,
 * `readCandidate`, `readRelease`, `readPreview`, and the page family's `readPageCatalogues`,
 * `readPage`, `readPageLocales`, `readGivingBinding`), AAP 0.7.1's job groups "Write and release an
 * Update" and "Build and release a Page", AAP 0.8.5 and 0.8.6, and success criteria 9, 12, 17 and 18.
 * The evidence files are `tests/domain/variant-release.test.ts`, `tests/domain/locale-fallback.test.ts`,
 * `tests/integration/publish-partial-failure.test.ts` and the browser specs
 * `e2e/{update-publication,pages-release-withdraw,variants-and-rtl}.spec.ts`.
 *
 * Every read here answers with a `ReadEnvelope` and never with a bare record, a list, a count or a
 * boolean: `envelope.ts` is where a value says whether it is known, zero, unknown, withheld,
 * unavailable or an incomplete subtotal, and a surface that received a bare record could not. A read
 * that cannot answer says why through `ReadResult`: `denied` carries one closed reason code and no
 * count, title, size or existence flag, and `unavailable` names the source that could not be read
 * instead of rendering an empty list.
 *
 * The distinctions this file exists to keep, none of which may be collapsed:
 *
 * - Draft, candidate, release and withdrawal are four states of one edition. Each variant and each
 *   locale edition owns its own three pointers, so editing one edition moves nothing else.
 * - A candidate freezes an exact revision; a later draft edit cannot reach it, and restoring an
 *   earlier revision produces a new draft rather than reviving a release.
 * - A saved draft is not a release. Nothing here derives a release from a draft pointer or from a
 *   store default.
 * - Publication, notification, provider acceptance, delivery and reading are five separate facts.
 *   These reads report publication only; the recipient outcomes belong to the audience reads.
 * - Reach is exactly Not public, Shared by link (public, unlisted, noindex) or Listed publicly, and a
 *   withdrawal is a fourth fact about a release rather than a fourth reach setting.
 * - A private draft preview is not a public bearer link: every preview re-authorises, and its answer
 *   carries `inert` and `givingAction: "none"` from the content module's own decision.
 * - A withdrawn publication is not a deleted media asset, and an unavailable rendition is not a zero.
 * - *Giving unavailable* is not a default fund: with no approved Designation there is no giving
 *   placement at all beyond the honest statement that giving is unavailable.
 * - A stale translation is not an unapproved one. Staleness is reported and never withdraws.
 *
 * One implementation per shared concern (Rule 1 clause 2). The content profile, its validator, its
 * canonical serialiser and its static renderer are `@/modules/content/*` and are used here rather
 * than restated; locale fallback, reach, the preview decision and the media state vocabulary likewise.
 * This file imports no Tiptap package, builds no HTML of its own, keeps no second copy of the reach or
 * locale rules, and states no reader-facing sentence: wording belongs to the feature that shows it.
 * The eight section keys a page catalogue offers are the one exception, and they are data rather than
 * wording: a feature module may not be imported from the service, so the keys are declared here as the
 * catalogue the read serves, and the feature's copy module supplies the words for those keys.
 *
 * The lifecycle word — draft, submitted for review, published, partially released, withdrawn,
 * superseded, stale translation — is deliberately not computed here. `components/draft-status.tsx`
 * owns the single derivation from a variant and its release, and a second vocabulary inside the
 * service would let the same edition be one word on one screen and another elsewhere. These reads
 * state the facts that derivation reads: the three pointers, the head release with its withdrawal and
 * supersession, and the translation's staleness.
 *
 * Layering: `app` -> `features` -> `components` -> `modules/data-service` -> `modules/store`. This file
 * is one member of the service, so it reads the store through the store's own read function, resolves
 * scope through `authorize.ts`, and is imported by feature code and route handlers rather than
 * importing them. It reads no clock of its own (`time/clock.ts` supplies the session's instant), holds
 * no state, writes nothing and sends nothing.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { isNonEmptyString } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { assertNever } from "@/lib/result";
import {
  CONTENT_PROFILE_VERSION,
  PRESENTATION_CHOICES,
  parseDocument,
  serialise,
  type ContentDocumentJson,
  type ContentSection,
  type DocumentIssue,
  type PresentationChoice,
} from "@/modules/content/document";
import {
  admittedLocales,
  directionOfTag,
  resolveLocale,
  type AdmittedLocale,
  type ContentLocale,
  type LocaleResolution,
} from "@/modules/content/locale";
import {
  PREVIEW_RENDITION_PURPOSES,
  authorisePreview,
  type PreviewDenialReason,
} from "@/modules/content/preview";
import {
  REACH_VALUES,
  isDirectlyReadable,
  isListedPublicly,
  reachMetadata,
  withdrawEdition,
  type Reach,
  type ReachMetadata,
  type Tombstone,
} from "@/modules/content/reach";
import {
  renderToHtml,
  type RenderMediaPlacement,
  type RenderRendition,
  type RenderRenditionPurpose,
  type RenderRenditions,
} from "@/modules/content/render";
import {
  REVIEW_STEPS_PER_CANDIDATE,
  admittedAudiences,
  translationStaleness,
  type ContentCandidate,
  type ContentDocument,
  type ContentRevision,
  type ContentVariant,
  type Release,
  type TranslationStaleness,
} from "@/modules/content/variant";
import {
  mediaStateReason,
  type MediaRenditionPurpose,
  type MediaStateReason,
} from "@/modules/media/asset";
import { readSession } from "@/modules/store/repository";
import { instantAt } from "@/modules/time/clock";

import {
  assertScope,
  canEdit,
  canView,
  readResultOfRefusal,
  resolveSession,
  type ResolvedSession,
  type SessionResolution,
  type SessionSource,
} from "../authorize";
import {
  buildEnvelope,
  contentCaptionTrackRecordSchema,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  mediaAssetRecordSchema,
  mediaPlacementRecordSchema,
  principalIdSchema,
  project,
  recordRevisionSchema,
  releaseRecordSchema,
  sharePresentationRecordSchema,
  storedInstantSchema,
  supportProjectionRecordSchema,
  type ContentAudience,
  type ContentCaptionTrackRecord,
  type Coverage,
  type CoverageState,
  type ContentDocumentRecord,
  type ContentFamily,
  type ContentKind,
  type MediaAssetKind,
  type MediaPlacementRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type ReleaseRecord,
  type Scope,
  type SharePresentationRecord,
  type SupportBasis,
  type SupportGoalMeasure,
  type SupportProjectionRecord,
} from "../envelope";
import { LOCAL_STORE_SYSTEM, denied, unavailable, type ReadResult } from "../outcome";

// ---------------------------------------------------------------------------------------------
// The operation identity a read refusal carries
// ---------------------------------------------------------------------------------------------

/**
 * What a read refusal states in a mutation outcome's `operationId` field.
 *
 * A read has no attempt identity — nothing was asked to change, so nothing can be replayed — and
 * `authorize.ts` states the same value for the same reason. Spelling it here keeps a refusal from a
 * content read byte-identical to a refusal from any other read, so a surface renders one notice for
 * all of them.
 */
const READ_ATTEMPT_ID = "read";

// ---------------------------------------------------------------------------------------------
// What a read reads: the six content families of one session's state document
// ---------------------------------------------------------------------------------------------

/**
 * One stored content revision, with its body held as `unknown`.
 *
 * The body is deliberately not validated by this schema. A stored document that no longer matches the
 * content profile is a real state — a profile version moved on, or a record was written by something
 * that did not go through `parseDocument` — and it has to be reported per field by the read that
 * shows it, not turned into "the store cannot be read at all". Every other member is validated here,
 * because a revision without its identity, its placements or its checksum cannot be reasoned about.
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

/** One stored revision record as this module reads it: `body` unvalidated, everything else exact. */
type StoredContentRevision = z.infer<typeof storedContentRevisionSchema>;

/**
 * The content families of a session's state document.
 *
 * The six collections are required: a session whose state document has lost one of them is a damaged
 * document rather than a session with no content, and reporting it as `unavailable` is the honest
 * answer. `supportProjection` is optional and nullable because a session with no support subject at
 * all legitimately holds none, and a giving placement needs it only when it can show progress.
 */
const contentWorkspaceSchema = z.object({
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  contentRevisions: z.array(storedContentRevisionSchema),
  releases: z.array(releaseRecordSchema),
  mediaAssets: z.array(mediaAssetRecordSchema),
  supportProjection: supportProjectionRecordSchema.nullable().optional(),
});

/** The validated content families of one session's state document. */
type ContentWorkspaceState = z.infer<typeof contentWorkspaceSchema>;

/**
 * Everything one content read needs that is the same for all ten: the session it acts for, the scope
 * it is authorised in, the scenario instant it is evaluated at, and the content records themselves.
 */
interface ContentWorkspace {
  /** The resolved session: the principal, its admission state and its admitted memberships. */
  readonly session: ResolvedSession;
  /** The selected context, already authorised: every read below runs inside exactly this scope. */
  readonly scope: Scope;
  /** The session's scenario instant, from its own persisted clock offset. */
  readonly asOf: Temporal.Instant;
  /** The content records, validated out of the opaque state document. */
  readonly state: ContentWorkspaceState;
}

/** Either an opened workspace, or the refusal a read returns instead of an envelope. */
type WorkspaceOpen =
  | { readonly ok: true; readonly workspace: ContentWorkspace }
  | { readonly ok: false; readonly result: ReadResult<never> };

/**
 * The store's reference for the content family, reported when this session's records cannot be read.
 *
 * The reference is a fixed opaque marker naming the record family a reader would ask for. It is never
 * the session's identity: the session id is the value of the development cookie, so it is a
 * credential, and a credential has no place in a refusal a browser receives or in a log line.
 */
const CONTENT_SOURCE_REFERENCE = "content";

/**
 * The one refusal a source that cannot be read answers with, logged once so a reader can find the
 * owner without any of the values the read could not return.
 */
function sourceUnavailable(job: string, reference: string): ReadResult<never> {
  const source: SourceReference = { system: LOCAL_STORE_SYSTEM, reference };
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT_ID,
      source,
      guidance:
        "The local content store could not be read for this request. Reload the surface to try again; nothing was changed.",
    }),
  };
}

/**
 * Opens the content workspace every read in this file works from.
 *
 * `source` is the explicit session identity `authorize.ts` provides for a development caller — the
 * domain and integration tests that prove isolation by naming a seeded session, and the operational
 * scripts. A browser request never supplies it, and `resolveSession` itself refuses it in a
 * production build, so this parameter cannot become a path that names its own identity.
 *
 * The order is the authorisation order and is not interchangeable: resolve the development session,
 * refuse a session that selected no context, assert the scope, ask the one permission question the
 * content family has (may this principal read a variant of this ministry), and only then read the
 * session's state document. Nothing is enumerated before an authority exists, so a refusal cannot be
 * used to learn whether a document, a variant or a revision exists.
 */
async function openContentWorkspace(job: string, source?: SessionSource): Promise<WorkspaceOpen> {
  let resolution: SessionResolution;
  try {
    resolution = await resolveSession(source);
  } catch {
    // Resolving a session can fail outside a request — no cookie jar, no request scope — and a read
    // answers that with the same refusal an unusable session receives rather than throwing at a
    // caller that asked for data.
    return {
      ok: false,
      result: {
        kind: "denied",
        denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "session-unavailable" }),
      },
    };
  }
  if (!resolution.ok) {
    return { ok: false, result: readResultOfRefusal(resolution.refusal) };
  }
  const session = resolution.session;

  const scope = session.selected;
  if (scope === null) {
    // A session that has chosen no organisation and ministry holds no authority over any of their
    // content, and inventing a scope from the first admitted membership would hand a read a context
    // the caller never selected.
    return {
      ok: false,
      result: {
        kind: "denied",
        denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "not-admitted" }),
      },
    };
  }

  const scopeDecision = assertScope(session, scope);
  if (!scopeDecision.ok) {
    return { ok: false, result: { kind: "denied", denied: scopeDecision.denial } };
  }

  const access = canView(session, { kind: "content-variant", scope });
  if (!access.allowed) {
    return { ok: false, result: { kind: "denied", denied: access.denial } };
  }

  let state: unknown;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return { ok: false, result: sourceUnavailable(job, CONTENT_SOURCE_REFERENCE) };
    }
    state = documents.state;
  } catch {
    // A corrupt or unreadable document is an unavailable source, never an empty workspace: reporting
    // no content would say the ministry has written nothing, which is the opposite of the truth.
    return { ok: false, result: sourceUnavailable(job, CONTENT_SOURCE_REFERENCE) };
  }

  const parsed = contentWorkspaceSchema.safeParse(state);
  if (!parsed.success) {
    return { ok: false, result: sourceUnavailable(job, CONTENT_SOURCE_REFERENCE) };
  }

  return {
    ok: true,
    workspace: {
      session,
      scope,
      // The session's own offset, applied to the one fixed seed anchor. A process-wide `now()` would
      // be the wrong instant for a session whose scenario clock differs from the process default.
      asOf: instantAt(session.clockOffsetMs),
      state: parsed.data,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The envelope every read answers with
// ---------------------------------------------------------------------------------------------

/**
 * The source a content read reports: the local store that holds the records, addressed by the
 * document the caller asked about.
 *
 * The reference is opaque — never parsed, never a join key — and it names the record family rather
 * than a path, so a reader learns which owner to ask without learning where its bytes live.
 */
function contentSource(reference: string): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference };
}

/**
 * Builds the envelope one content read returns.
 *
 * Coverage is `complete` with no period, and that is a statement rather than a default: a session's
 * state document holds the whole of the content that session can read, and a set of content records
 * has no period behind it. No content read here computes a financial value, so no read states a
 * currency or a date basis and `incomplete-subtotal` can never be derived from this coverage.
 */
function contentEnvelope<T>(input: {
  readonly workspace: ContentWorkspace;
  readonly data: T;
  readonly source: SourceReference;
  readonly revision: string;
  readonly valueStates: Readonly<Record<string, RecordedValueState>>;
  readonly actions: readonly ReadAction[];
}): ReadEnvelope<T> {
  return buildEnvelope({
    data: input.data,
    scope: input.workspace.scope,
    source: input.source,
    revision: input.revision,
    asOf: input.workspace.asOf.toString(),
    coverage: { from: null, to: null, state: "complete" },
    valueStates: input.valueStates,
    actions: input.actions,
  });
}

/**
 * The refusal a read returns when a record the caller named cannot be resolved.
 *
 * One reason code and nothing else, identical for a record that does not exist and one in another
 * organisation, ministry or support subject: a caller that could tell the two apart from the answer
 * would have an existence oracle over records it may not read.
 */
function recordNotFound(): ReadResult<never> {
  return {
    kind: "denied",
    denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "no-permission" }),
  };
}

// ---------------------------------------------------------------------------------------------
// Stored records turned into the domain records the surfaces read
//
// The store holds the persisted form: an instant is a string, a locale is a tag plus a direction, and
// a pointer that has not moved is `null`. The surfaces and the shared components read the domain
// form, so this is the one place the two meet.
// ---------------------------------------------------------------------------------------------

/** The locale an edition states: its tag exactly as stored, with the direction it is read in. */
function localeOf(tag: string, direction: ContentLocale["direction"]): ContentLocale {
  return { tag, direction };
}

/** The locale of a stored release record, which states a tag and no direction of its own. */
function releaseLocaleOf(tag: string): ContentLocale {
  return { tag, direction: directionOfTag(tag) };
}

/** One stored variant as the domain variant a surface reads, with an unmoved pointer left absent. */
function variantOf(record: {
  readonly variantId: string;
  readonly documentId: string;
  readonly audience: ContentAudience;
  readonly locale: string;
  readonly direction: ContentLocale["direction"];
  readonly draftRevisionId: string | null;
  readonly candidateId: string | null;
  readonly releaseHeadId: string | null;
  readonly translationSource: { readonly variantId: string; readonly revisionId: string } | null;
}): ContentVariant {
  return {
    variantId: record.variantId,
    documentId: record.documentId,
    audience: record.audience,
    locale: localeOf(record.locale, record.direction),
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
 * One stored revision as the domain revision, from the revision record and the document the content
 * profile admitted.
 *
 * The composed sections are taken from the document's own `sections`, which is their one
 * authoritative copy: a stored revision holds no second list that could disagree with the body. The
 * per-placement caption and alternative-text maps are built from the placements themselves, because
 * a caption is a property of the placement a reader meets rather than of the revision as a whole.
 */
function revisionOf(record: StoredContentRevision, document: ContentDocumentJson): ContentRevision {
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
    sharePresentation: sharePresentationOf(record.sharePresentation),
    contentChecksum: record.contentChecksum,
    authorPrincipalId: record.authorPrincipalId,
    createdAt: Temporal.Instant.from(record.createdAt),
  };
}

/** One stored share presentation as the domain shape, omitting the fields the record left unset. */
function sharePresentationOf(record: SharePresentationRecord): {
  readonly title?: string;
  readonly description?: string;
  readonly imageAssetId?: string;
} {
  return {
    ...(isNonEmptyString(record.title) ? { title: record.title } : {}),
    ...(isNonEmptyString(record.description) ? { description: record.description } : {}),
    ...(record.imageAssetId === null ? {} : { imageAssetId: record.imageAssetId }),
  };
}

/**
 * The checksum of every revision one read could resolve, keyed by revision identity.
 *
 * A release record names the revision it published and does not repeat that revision's digest, so a
 * comparison of a release against a draft needs the digest from the revision itself. Building the
 * index once per read, and passing it in, keeps the resolution a pure function of the records the
 * caller holds: nothing is cached between reads and two concurrent reads cannot see each other's
 * documents.
 */
type RevisionChecksums = ReadonlyMap<string, string>;

/** The checksum index of one workspace's revisions. */
function checksumsOf(state: ContentWorkspaceState): RevisionChecksums {
  const index = new Map<string, string>();
  for (const revision of state.contentRevisions) {
    index.set(revision.revisionId, revision.contentChecksum);
  }
  return index;
}

/**
 * One stored release as the domain release a surface reads and compares.
 *
 * The checksum is the published revision's own, looked up in the index the caller built. When that
 * revision is no longer in the store the release answers with an empty string, which no digest can
 * equal: an absent checksum reads as "not comparable" rather than as a match, so an unchanged release
 * is never asserted on a comparison the store cannot support.
 */
function releaseOf(record: ReleaseRecord, checksums: RevisionChecksums): Release {
  return {
    releaseId: record.releaseId,
    variantId: record.variantId,
    revisionId: record.revisionId,
    audience: record.audience,
    locale: releaseLocaleOf(record.locale),
    publishedAt: Temporal.Instant.from(record.publishedAt),
    reach: record.reach,
    contentChecksum: checksums.get(record.revisionId) ?? "",
    ...(record.withdrawnAt === null
      ? {}
      : { withdrawnAt: Temporal.Instant.from(record.withdrawnAt) }),
    ...(record.supersededBy === null ? {} : { supersededBy: record.supersededBy }),
  };
}

// ---------------------------------------------------------------------------------------------
// Lookups over one workspace
// ---------------------------------------------------------------------------------------------

/** The stored variant record, named so a lookup's answer can be used without a second declaration. */
type ContentVariantRecordLike = ContentWorkspaceState["contentVariants"][number];

/** The document one identifier names, or `undefined` when this session holds none. */
function findDocument(
  state: ContentWorkspaceState,
  documentId: string,
): ContentDocumentRecord | undefined {
  return state.contentDocuments.find((candidate) => candidate.documentId === documentId);
}

/** The variant one identifier names, or `undefined` when this session holds none. */
function findVariant(
  state: ContentWorkspaceState,
  variantId: string,
): ContentVariantRecordLike | undefined {
  return state.contentVariants.find((candidate) => candidate.variantId === variantId);
}

/** Every variant of one document, in the order the store lists them. */
function variantsOf(
  state: ContentWorkspaceState,
  documentId: string,
): readonly ContentVariantRecordLike[] {
  return state.contentVariants.filter((variant) => variant.documentId === documentId);
}

/** One stored revision by identity, or `undefined` when this session holds none. */
function findRevision(
  state: ContentWorkspaceState,
  revisionId: string,
): StoredContentRevision | undefined {
  return state.contentRevisions.find((candidate) => candidate.revisionId === revisionId);
}

/** Every release of one document's variants, in the order the store lists them. */
function releasesOf(state: ContentWorkspaceState, documentId: string): readonly ReleaseRecord[] {
  const variantIds = new Set(variantsOf(state, documentId).map((variant) => variant.variantId));
  return state.releases.filter((release) => variantIds.has(release.variantId));
}

/** Every release of one variant. */
function releasesOfVariant(
  state: ContentWorkspaceState,
  variantId: string,
): readonly ReleaseRecord[] {
  return state.releases.filter((release) => release.variantId === variantId);
}

/**
 * The release standing at a variant's head, or `undefined` when the variant publishes nothing.
 *
 * The head pointer is the only thing consulted: a release record for the variant that the pointer
 * does not name is history, and presenting it as the current publication would be a false statement
 * about what a reader can open.
 */
function headReleaseOf(
  state: ContentWorkspaceState,
  variant: ContentVariantRecordLike,
): ReleaseRecord | undefined {
  const head = variant.releaseHeadId;
  if (head === null) {
    return undefined;
  }
  return releasesOfVariant(state, variant.variantId).find((release) => release.releaseId === head);
}

/**
 * The newest release of a variant by publication instant, used where a surface names a past release.
 *
 * Publication order is the only order releases have; two releases of one variant published at the
 * same instant are ordered by identity, so the answer is total and a test can rely on it.
 */
function newestReleaseOf(releases: readonly ReleaseRecord[]): ReleaseRecord | undefined {
  let newest: ReleaseRecord | undefined;
  for (const release of releases) {
    if (newest === undefined) {
      newest = release;
      continue;
    }
    const comparison = Temporal.Instant.compare(
      Temporal.Instant.from(release.publishedAt),
      Temporal.Instant.from(newest.publishedAt),
    );
    if (comparison > 0 || (comparison === 0 && release.releaseId < newest.releaseId)) {
      newest = release;
    }
  }
  return newest;
}

/** Whether a stored release has been withdrawn, read from the record rather than inferred. */
function isWithdrawnRelease(record: ReleaseRecord): boolean {
  return record.withdrawnAt !== null;
}

/** The canonical document the content module's locale resolution takes, built from the stored record. */
function documentOf(record: ContentDocumentRecord): ContentDocument {
  return {
    documentId: record.documentId,
    family: record.family,
    kind: record.kind,
    sourceSubject: record.sourceSubject,
    siteId: record.siteId,
    ...(record.givingBinding === null ? {} : { givingBinding: record.givingBinding.designation }),
    // The stored record names the managed fields the composition surface locks; it holds no value
    // for any of them, so none is invented here. Locale resolution reads the identity and the site
    // only, and the page read reports the locked names as names.
    managedFields: {},
  };
}

/**
 * The site's declared default edition, which this store does not hold.
 *
 * A blank string is the honest answer, and `locale.ts` reads it as "this site declares no default",
 * so the fallback chain ends after the same-language step. Inventing `en` would serve an edition the
 * worker never chose as a default, and would make a page whose only edition is French answer an
 * English request instead of stating that the language is unavailable.
 */
const NO_DECLARED_SITE_DEFAULT = "";

// ---------------------------------------------------------------------------------------------
// Media placements: opaque rendition identities, and a path that re-authorises on every request
// ---------------------------------------------------------------------------------------------

/** The application path one rendition is served from. Never a file path and never an original. */
function renditionPath(assetId: string, renditionId: string): string {
  return `/api/media/${encodeURIComponent(assetId)}/${encodeURIComponent(renditionId)}`;
}

/** One rendition a placement may use: its opaque identity, its purpose and the route that serves it. */
export interface ContentRenditionView {
  /** The rendition's opaque identity, resolved from the asset record and never a stored path. */
  readonly renditionId: string;
  /** What the rendition is for, so it can only be used as the kind of media it holds. */
  readonly purpose: MediaRenditionPurpose;
  /** The MIME type the media pipeline admitted, never a guess from a file name. */
  readonly mimeType: string;
  /** The application route that serves these bytes, re-authorising on every request. */
  readonly path: string;
}

/**
 * One placement as a surface meets it: the authored alternative text and caption, the media state,
 * and the rendition identities that may be requested for it.
 *
 * `state` is `unavailable` for a placement whose asset is missing, whose bytes were never prepared
 * or whose asset this caller may not read — one rendering for all three, because telling them apart
 * would let a placement become a question about another context's media. An unavailable placement
 * still carries its alternative text, and it carries any poster or caption rendition that *is*
 * admitted, which is how a video with no prepared playback shows its poster rather than an empty
 * player.
 */
export interface ContentPlacementView {
  /** The placement's identity inside the revision; caption maps and rendition keys use it. */
  readonly placementId: string;
  /** The opaque identity of the asset in `modules/media`. */
  readonly assetId: string;
  /** Whether the asset is an image or a video, established by its content when it was admitted. */
  readonly kind: MediaAssetKind;
  /** The catalogue element the placement belongs to, when the author placed it inside one. */
  readonly sectionElement: string | null;
  /** The builder's own order, so reordering is an explicit move rather than a drag. */
  readonly position: number;
  /** The required alternative text: never empty, never derived from a file name. */
  readonly altText: string;
  /** The visible caption, when the author wrote one. */
  readonly caption: string | null;
  /** The credit line the author stated, when any. */
  readonly credit: string | null;
  /** Whether the placement's main rendition can be shown or played. */
  readonly state: "ready" | "unavailable";
  /** The media module's own words for an unavailable placement: a label and a next step. */
  readonly reason: MediaStateReason | null;
  /** The rendition identities this caller may request for the placement, in the asset's order. */
  readonly renditions: readonly ContentRenditionView[];
  /** The admitted caption tracks for a video, each named by its own caption rendition identity. */
  readonly captionTracks: readonly ContentCaptionTrackRecord[];
}

/** The rendition purpose a placement's main media serves: a still image, or a video's playback. */
function mainRenditionPurpose(kind: MediaAssetKind): MediaRenditionPurpose {
  switch (kind) {
    case "image":
      return "display";
    case "video":
      return "playback";
  }
  return assertNever(kind);
}

/** A purpose the static renderer can embed; a transcript is read on its own rather than embedded. */
function asRenderPurpose(purpose: MediaRenditionPurpose): RenderRenditionPurpose | undefined {
  switch (purpose) {
    case "display":
    case "playback":
    case "poster":
    case "captions":
      return purpose;
    case "transcript":
      return undefined;
  }
  return assertNever(purpose);
}

/** The fields of a stored media asset a consumer may see: everything except the private original. */
const VISIBLE_MEDIA_ASSET_FIELDS = [
  "assetId",
  "kind",
  "profileCheck",
  "renditions",
  "tagVerification",
  "revision",
] as const;

/**
 * The placement views of one revision.
 *
 * Every asset is re-authorised here, against the asset's own recorded scope, so a rendition of
 * another context's media never reaches a surface even when a revision names its identity. The
 * original bytes are dropped by `project`, which is the mechanism for "a projection never contains a
 * field the caller may not see": the private original reference and the asset's scope are absent
 * from the view rather than hidden by a component.
 */
function placementViews(
  workspace: ContentWorkspace,
  placements: readonly MediaPlacementRecord[],
  captionTracks: readonly ContentCaptionTrackRecord[],
): readonly ContentPlacementView[] {
  return placements.map((placement) => {
    const asset = workspace.state.mediaAssets.find(
      (candidate) => candidate.assetId === placement.assetId,
    );
    const tracks = captionTracks.filter((track) => track.assetId === placement.assetId);
    const reason = mediaStateReason("unavailable");

    if (asset === undefined) {
      return unreadablePlacement(placement, "video", reason, tracks);
    }

    const readable = canView(workspace.session, { kind: "media-asset", scope: asset.scope });
    if (!readable.allowed) {
      return unreadablePlacement(placement, asset.kind, reason, tracks);
    }

    const visible = project(asset, VISIBLE_MEDIA_ASSET_FIELDS);
    const renditions: ContentRenditionView[] = visible.renditions.map((rendition) => ({
      renditionId: rendition.renditionId,
      purpose: rendition.purpose,
      mimeType: rendition.mimeType,
      path: renditionPath(visible.assetId, rendition.renditionId),
    }));
    const main = renditions.some(
      (rendition) => rendition.purpose === mainRenditionPurpose(visible.kind),
    );
    return {
      placementId: placement.placementId,
      assetId: placement.assetId,
      kind: visible.kind,
      sectionElement: placement.sectionElement,
      position: placement.position,
      altText: placement.altText,
      caption: placement.caption,
      credit: placement.credit,
      state: main ? "ready" : "unavailable",
      reason: main ? null : reason,
      renditions,
      captionTracks: tracks,
    };
  });
}

/**
 * A placement whose asset cannot be read: no renditions at all, the alternative text kept, and the
 * media module's own unavailable wording.
 *
 * The kind defaults to `video` only because a video without an admitted playback still shows its
 * text alternative; a caller reading `state` never needs the kind to decide what to render.
 */
function unreadablePlacement(
  placement: MediaPlacementRecord,
  kind: MediaAssetKind,
  reason: MediaStateReason,
  tracks: readonly ContentCaptionTrackRecord[],
): ContentPlacementView {
  return {
    placementId: placement.placementId,
    assetId: placement.assetId,
    kind,
    sectionElement: placement.sectionElement,
    position: placement.position,
    altText: placement.altText,
    caption: placement.caption,
    credit: placement.credit,
    state: "unavailable",
    reason,
    renditions: [],
    captionTracks: tracks,
  };
}

/**
 * What one render answers: the HTML and the admitted document it was produced from, or the profile's
 * issues and no HTML at all.
 *
 * The document is returned beside the HTML because the caller needs both and must never see one
 * without the other: a caller holding markup for a document it could not read would be one decision
 * away from rendering a partially read revision to a reader.
 */
type RevisionRender =
  | {
      readonly status: "rendered";
      readonly html: string;
      readonly document: ContentDocumentJson;
    }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };

/**
 * One revision rendered to HTML through the one static renderer.
 *
 * The renderer, the profile and the placements are the same for preview, the receiving view, print
 * and a message, so this function has no per-surface branch: the reading surfaces pass the document
 * and the rendition identities they resolved, and receive the HTML the renderer produced. Nothing
 * here composes markup, sanitises markup or inspects a rendered string.
 */
function renderRevision(
  body: unknown,
  placements: readonly ContentPlacementView[],
): RevisionRender {
  const renderedPlacements: RenderMediaPlacement[] = [];
  const renditions: Record<string, RenderRendition> = {};

  for (const placement of placements) {
    const captionTrack =
      placement.captionTracks.find((track) => track.isDefault) ?? placement.captionTracks[0];
    const mainKey = placement.placementId;
    const posterKey = `${placement.placementId}:poster`;
    const captionsKey = `${placement.placementId}:captions`;

    for (const rendition of placement.renditions) {
      const purpose = asRenderPurpose(rendition.purpose);
      if (purpose === undefined) {
        continue;
      }
      const key = purpose === "poster" ? posterKey : purpose === "captions" ? captionsKey : mainKey;
      renditions[key] = { src: rendition.path, purpose };
    }

    renderedPlacements.push({
      placementId: placement.placementId,
      kind: placement.kind,
      altText: placement.altText,
      ...(placement.caption === null ? {} : { caption: placement.caption }),
      ...(hasRendition(placement, "poster") ? { posterId: posterKey } : {}),
      ...(hasRendition(placement, "captions") ? { captionsId: captionsKey } : {}),
      ...(captionTrack === undefined
        ? {}
        : { captionsLanguage: captionTrack.language, captionsLabel: captionTrack.label }),
    });
  }

  const rendered = renderToHtml(body, {
    media: "inline",
    placements: renderedPlacements,
    renditions: renditions as RenderRenditions,
  });
  if (rendered.status === "invalid") {
    return { status: "invalid", issues: rendered.issues };
  }
  const parsed = parseDocument(body);
  if (parsed.status === "invalid") {
    return { status: "invalid", issues: parsed.issues };
  }
  return { status: "rendered", html: rendered.html, document: parsed.document };
}

/** Whether a placement carries a rendition of one purpose, which decides a renderer reference. */
function hasRendition(placement: ContentPlacementView, purpose: MediaRenditionPurpose): boolean {
  return placement.renditions.some((rendition) => rendition.purpose === purpose);
}

// ---------------------------------------------------------------------------------------------
// The facts a surface derives an edition's state from
// ---------------------------------------------------------------------------------------------

/**
 * How a manual translation stands against its source, with instants stated as the stored ISO strings
 * an envelope carries rather than as `Temporal` values.
 *
 * `unresolved` is the fourth answer and is not one of `translationStaleness`'s three: it means the
 * recorded source variant or revision is no longer in the store, so neither "fresh" nor "stale" can
 * be stated. Reporting it as `fresh` would vouch for a comparison nobody made, and reporting it as
 * `stale` would claim the source moved when it is the record that is missing.
 */
export type ContentTranslationView =
  | { readonly status: "none" }
  | {
      readonly status: "fresh";
      readonly sourceRevisionId: string;
      readonly sourceUpdatedAt: string;
    }
  | {
      readonly status: "stale";
      readonly sourceRevisionId: string;
      readonly sourceUpdatedAt: string;
      readonly translatedFromRevisionId: string;
    }
  | { readonly status: "unresolved"; readonly translatedFromRevisionId: string };

/**
 * Converts `translationStaleness`'s answer into the envelope's form, or states `unresolved` when the
 * recorded source no longer resolves.
 *
 * Staleness is asked of the content module's one function rather than re-derived, so the two content
 * families and the domain module cannot disagree about whether a translation is behind.
 */
function translationViewOf(
  state: ContentWorkspaceState,
  variant: ContentVariantRecordLike,
): ContentTranslationView {
  const recorded = variant.translationSource;
  if (recorded === null) {
    return { status: "none" };
  }
  const sourceVariant = findVariant(state, recorded.variantId);
  const sourceRevision =
    sourceVariant === undefined ? undefined : currentRevisionOf(state, sourceVariant);
  if (sourceVariant === undefined || sourceRevision === undefined) {
    return { status: "unresolved", translatedFromRevisionId: recorded.revisionId };
  }
  const parsed = parseDocument(sourceRevision.body);
  if (parsed.status === "invalid") {
    return { status: "unresolved", translatedFromRevisionId: recorded.revisionId };
  }
  const staleness: TranslationStaleness = translationStaleness(variantOf(variant), {
    sourceVariant: variantOf(sourceVariant),
    sourceRevision: revisionOf(sourceRevision, parsed.document),
  });
  switch (staleness.status) {
    case "none":
      return { status: "none" };
    case "fresh":
      return {
        status: "fresh",
        sourceRevisionId: staleness.sourceRevisionId,
        sourceUpdatedAt: staleness.sourceUpdatedAt.toString(),
      };
    case "stale":
      return {
        status: "stale",
        sourceRevisionId: staleness.sourceRevisionId,
        sourceUpdatedAt: staleness.sourceUpdatedAt.toString(),
        translatedFromRevisionId: staleness.translatedFromRevisionId,
      };
  }
  return assertNever(staleness);
}

/**
 * The revision a variant currently shows: its draft when it has one, else the revision its head release
 * published.
 *
 * The two pointers name different things — `draftRevisionId` names a revision and `releaseHeadId` names
 * a release — so the head is resolved to the release record and then to the revision that record
 * published. Reading the head pointer as a revision identity would silently fail to resolve, which is
 * how a translation would be reported as having lost its source.
 */
function currentRevisionOf(
  state: ContentWorkspaceState,
  variant: ContentVariantRecordLike,
): StoredContentRevision | undefined {
  if (variant.draftRevisionId !== null) {
    return findRevision(state, variant.draftRevisionId);
  }
  const head = headReleaseOf(state, variant);
  return head === undefined ? undefined : findRevision(state, head.revisionId);
}

/**
 * One edition as the variant matrix lists it: its audience and exact locale, its three independent
 * pointers, the release standing at its head with everything reach reaches, and how its translation
 * stands.
 *
 * The three pointers are stated as themselves rather than collapsed into one status word, because
 * each moves independently: a draft save moves `draftRevisionId` and touches neither of the others,
 * and the lifecycle word a surface shows is derived from these facts by `components/draft-status.tsx`
 * so one edition cannot be called two things on two screens.
 */
export interface ContentEditionView {
  /** The identity of this audience-and-locale edition. */
  readonly variantId: string;
  /** The audience the edition serves: an Update may be public or approved-supporter; a Page public. */
  readonly audience: ContentAudience;
  /** The exact content locale, with the direction it is authored and read in. */
  readonly locale: ContentLocale;
  /** The revision the editor is working on, or `null` when nothing is saved. */
  readonly draftRevisionId: string | null;
  /** The frozen candidate awaiting its one review step, or `null`. */
  readonly candidateId: string | null;
  /** The release standing at the variant's head, or `null`. */
  readonly releaseHeadId: string | null;
  /** The variant record's own revision, which a change to any pointer must present. */
  readonly recordRevision: string;
  /** The head release as a record, with its withdrawal and supersession stated as facts. */
  readonly headRelease: Release | null;
  /** What the head release's reach permits on the discovery index, or `null` with no head. */
  readonly reach: ReachMetadata | null;
  /** When the variant last published anything, or `null` when it never has. */
  readonly lastReleaseAt: string | null;
  /** How a manual translation of this edition stands against the source it copied. */
  readonly translation: ContentTranslationView;
}

/** Builds one edition's view from the stored variant, the stored releases and the checksum index. */
function editionViewOf(
  state: ContentWorkspaceState,
  variant: ContentVariantRecordLike,
  checksums: RevisionChecksums,
): ContentEditionView {
  const releases = releasesOfVariant(state, variant.variantId);
  const head = headReleaseOf(state, variant);
  const newest = newestReleaseOf(releases);
  return {
    variantId: variant.variantId,
    audience: variant.audience,
    locale: localeOf(variant.locale, variant.direction),
    draftRevisionId: variant.draftRevisionId,
    candidateId: variant.candidateId,
    releaseHeadId: variant.releaseHeadId,
    recordRevision: variant.revision,
    headRelease: head === undefined ? null : releaseOf(head, checksums),
    reach:
      head === undefined
        ? null
        : reachMetadata({ reach: head.reach, withdrawnAt: head.withdrawnAt }),
    lastReleaseAt: newest === undefined ? null : newest.publishedAt,
    translation: translationViewOf(state, variant),
  };
}

// ---------------------------------------------------------------------------------------------
// The canonical document, as every content read states it
// ---------------------------------------------------------------------------------------------

/**
 * One canonical content identity as a surface reads it: the Update or Page itself, apart from any of
 * its editions.
 *
 * `sourceSubject` and `givingBinding` are opaque, source-qualified references, so no name, address or
 * numeric id fragment can stand in for the identity another system owns. `managedFieldKeys` names the
 * fields the composition surface locks — the values are the source's and this release stores none of
 * them — so a page read can say which facts are read-only without inventing a value for any.
 */
export interface ContentDocumentView {
  readonly documentId: string;
  readonly family: ContentFamily;
  readonly kind: ContentKind;
  readonly siteId: string;
  readonly sourceSubject: SourceReference;
  readonly givingBinding: { readonly designation: SourceReference; readonly label: string } | null;
  readonly managedFieldKeys: readonly string[];
  readonly recordRevision: string;
}

/** One stored document as the canonical view above. */
function documentViewOf(record: ContentDocumentRecord): ContentDocumentView {
  return {
    documentId: record.documentId,
    family: record.family,
    kind: record.kind,
    siteId: record.siteId,
    sourceSubject: record.sourceSubject,
    givingBinding:
      record.givingBinding === null
        ? null
        : { designation: record.givingBinding.designation, label: record.givingBinding.label },
    managedFieldKeys: [...record.managedFields],
    recordRevision: record.revision,
  };
}

/** The four bounded presentation choices, as the content profile declares them and no second time. */
export type ContentPresentationChoices = typeof PRESENTATION_CHOICES;

// ---------------------------------------------------------------------------------------------
// readVariantOverview — the variant matrix of one document
// ---------------------------------------------------------------------------------------------

/**
 * The variant matrix of one Update or Page.
 *
 * `audiences` states the audiences the family permits, which is what stops a full audience x locale
 * cross-product from existing: an Update offers both audiences and a Page offers `public` alone, so a
 * surface never offers a Page an approved-supporter edition it could not release.
 */
export interface VariantOverviewData {
  readonly document: ContentDocumentView;
  /** The audiences this family admits, in the order a surface lists them. */
  readonly audiences: readonly ContentAudience[];
  /** Every edition, each with its own draft, candidate and release head. */
  readonly editions: readonly ContentEditionView[];
  /**
   * The editions that hold an unreleased candidate while a sibling publishes.
   *
   * A partial release is not a rollback: the sibling's prior-good publication still stands, and this
   * list is how a surface says which edition is the one needing attention rather than presenting the
   * sibling's head as a newly released translation.
   */
  readonly awaitingRelease: readonly string[];
}

/**
 * Reads the variant matrix of one document: every edition with its audience, exact locale, three
 * independent pointers, head release and translation state.
 *
 * A document this session does not hold answers `denied` with one reason code, exactly as a document
 * in another organisation does, so the read is never an existence oracle.
 */
export async function readVariantOverview(input: {
  readonly documentId: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<VariantOverviewData>>> {
  const opened = await openContentWorkspace("readVariantOverview", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.documentId)) {
    return recordNotFound();
  }
  const document = findDocument(workspace.state, input.documentId);
  if (document === undefined) {
    return recordNotFound();
  }

  const checksums = checksumsOf(workspace.state);
  const editions = variantsOf(workspace.state, document.documentId).map((variant) =>
    editionViewOf(workspace.state, variant, checksums),
  );
  const awaitingRelease = editions
    .filter((edition) => edition.candidateId !== null && edition.releaseHeadId === null)
    .map((edition) => edition.variantId);

  const data: VariantOverviewData = {
    document: documentViewOf(document),
    audiences: admittedAudiences(document.family),
    editions,
    awaitingRelease,
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(document.documentId),
      revision: document.revision,
      valueStates: {
        editions: editions.length === 0 ? "zero" : "value",
        awaitingRelease: awaitingRelease.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "create-variant", available: true },
        {
          name: "open-draft",
          available: editions.some((edition) => edition.draftRevisionId !== null),
          ...(editions.some((edition) => edition.draftRevisionId !== null)
            ? {}
            : { reason: "No edition of this document has a saved draft yet." }),
        },
        {
          name: "review-candidate",
          available: awaitingRelease.length > 0,
          ...(awaitingRelease.length > 0
            ? {}
            : { reason: "No edition of this document has a candidate awaiting review." }),
        },
        {
          name: "publish-variants",
          available: editions.some((edition) => edition.candidateId !== null),
          ...(editions.some((edition) => edition.candidateId !== null)
            ? {}
            : { reason: "Only a frozen candidate can be published; no edition has one." }),
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// readDraft — the one working revision of one edition
// ---------------------------------------------------------------------------------------------

/** What a draft read states: the working revision, its absence, or a stored document it cannot read. */
export type ContentDraftData =
  | {
      /** A saved draft exists and the content profile admitted it. */
      readonly status: "draft";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      /** The exact working revision, its sections and its placements. */
      readonly revision: ContentRevision;
      /** The variant record's revision, to present as `expectedRevision` on a draft save. */
      readonly recordRevision: string;
      /** The working revision rendered by the one static renderer. */
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly captionTracks: readonly ContentCaptionTrackRecord[];
      readonly translation: ContentTranslationView;
    }
  | {
      /** Nothing is saved for this edition yet: a working edition, not a damaged one. */
      readonly status: "no-draft";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly recordRevision: string;
      readonly translation: ContentTranslationView;
    }
  | {
      /** The stored body is not a document this content profile admits; it is reported, not repaired. */
      readonly status: "invalid";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly revisionId: string;
      readonly recordRevision: string;
      readonly issues: readonly DocumentIssue[];
    };

/**
 * Reads one edition's working revision: its stored body, its sections, its placements with their
 * opaque rendition identities, its rendered HTML, and the record revision a save must present.
 *
 * The body is validated by the content profile on the way out and never repaired: a stored document
 * this profile does not admit answers `invalid` with the issues at the paths the authoring form uses,
 * so an author sees what is wrong rather than a silently emptied editor. A missing draft is `no-draft`
 * — a working edition nobody has saved — and is never merged with a refusal.
 */
export async function readDraft(input: {
  readonly variantId: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<ContentDraftData>>> {
  const opened = await openContentWorkspace("readDraft", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }

  const document = documentViewOf(documentRecord);
  const variant = variantOf(record);
  const audience = record.audience;
  const locale = localeOf(record.locale, record.direction);
  const translation = translationViewOf(workspace.state, record);
  const pointer = record.draftRevisionId;

  if (pointer === null) {
    const data: ContentDraftData = {
      status: "no-draft",
      document,
      variant,
      audience,
      locale,
      recordRevision: record.revision,
      translation,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { sections: "zero", placements: "zero" },
        actions: [
          { name: "save-draft", available: true },
          {
            name: "submit-for-review",
            available: false,
            reason: "There is no saved draft to submit yet.",
          },
        ],
      }),
    };
  }

  const revision = findRevision(workspace.state, pointer);
  if (revision === undefined) {
    const data: ContentDraftData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      revisionId: pointer,
      recordRevision: record.revision,
      issues: [
        {
          path: "revisionId",
          message:
            "The draft this edition points at is not in the store, so no content can be shown for it.",
        },
      ],
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { sections: "unknown", placements: "unknown" },
        actions: [
          {
            name: "save-draft",
            available: true,
            reason: "A save replaces the broken draft pointer with a new revision of this edition.",
          },
        ],
      }),
    };
  }

  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  const rendered = renderRevision(revision.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentDraftData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      revisionId: revision.revisionId,
      recordRevision: record.revision,
      issues: rendered.issues,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        // The stored document could not be read as content, so nothing about its sections or its
        // placements is established. `unknown` says exactly that; `zero` would claim there are none.
        valueStates: { sections: "unknown", placements: "unknown" },
        actions: [
          {
            name: "save-draft",
            available: true,
            reason:
              "A fresh save writes an admitted document and replaces the unreadable revision.",
          },
        ],
      }),
    };
  }

  const data: ContentDraftData = {
    status: "draft",
    document,
    variant,
    audience,
    locale,
    revision: revisionOf(revision, rendered.document),
    recordRevision: record.revision,
    renderedHtml: rendered.html,
    placements,
    captionTracks: revision.captions,
    translation,
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        sections: rendered.document.sections.length === 0 ? "zero" : "value",
        placements: placements.length === 0 ? "zero" : "value",
        captionTracks: revision.captions.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "save-draft", available: true },
        { name: "submit-for-review", available: true },
        { name: "restore-revision-as-draft", available: true },
        { name: "preview-revision", available: true },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// readCandidate — the frozen revision a reviewer answers
// ---------------------------------------------------------------------------------------------

/** One section's change between the frozen candidate and the release it would replace. */
export interface CandidateSectionChange {
  readonly position: number;
  readonly element: string;
  readonly change: "added" | "removed" | "changed";
}

/** One placement's change between the frozen candidate and the release it would replace. */
export interface CandidatePlacementChange {
  readonly placementId: string;
  readonly assetId: string;
  readonly change: "added" | "removed" | "changed";
}

/**
 * The reviewer-visible difference between the frozen candidate and the release standing at the head.
 *
 * It is computed from structured records — the canonical body, the ordered sections, the placements —
 * and never by diffing two HTML strings, so a difference is named by the catalogue element or the
 * placement identity a reviewer can act on. `against: null` is a first publication rather than no
 * difference at all, and `unchanged` compares the two content checksums rather than guessing.
 */
export interface CandidateDiffView {
  /** The release the candidate would replace, or `null` when this edition has never published. */
  readonly against: {
    readonly releaseId: string;
    readonly revisionId: string;
    readonly contentChecksum: string;
  } | null;
  /** Whether the candidate's content is identical to the current release's. */
  readonly unchanged: boolean;
  /** Whether the prose body differs; sections and placements are reported separately below. */
  readonly proseChanged: boolean;
  /** Whether the direction the edition reads in differs. */
  readonly directionChanged: boolean;
  readonly sections: readonly CandidateSectionChange[];
  readonly placements: readonly CandidatePlacementChange[];
}

/** What a candidate read states: frozen and reviewable, absent, unreadable, or not resolvable. */
export type ContentCandidateData =
  | {
      readonly status: "reviewable";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly candidate: ContentCandidate;
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      readonly diff: CandidateDiffView;
      readonly review: {
        readonly steps: typeof REVIEW_STEPS_PER_CANDIDATE;
        readonly round: typeof REVIEW_STEPS_PER_CANDIDATE;
        readonly decision: null;
        readonly approvalScope: "this-variant-only";
      };
      readonly recordRevision: string;
    }
  | {
      readonly status: "none";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly recordRevision: string;
    }
  | {
      readonly status: "invalid";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly candidateId: string;
      readonly issues: readonly DocumentIssue[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "unavailable";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly candidateId: string;
      readonly reason: string;
      readonly recordRevision: string;
    };

/**
 * Reads the candidate frozen for one edition: the exact revision it froze, its rendered HTML, the
 * difference from the current release and the single review step it may receive.
 *
 * `review.approvalScope` states in the data what the policy requires of every surface: this decision
 * approves one audience in one language and no other. `review.decision` is `null` because the store
 * records no reviewer answer until one is made — a pending review is the absence of a decision, not a
 * decision word this read would have to invent.
 */
export async function readCandidate(input: {
  readonly variantId: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<ContentCandidateData>>> {
  const opened = await openContentWorkspace("readCandidate", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }

  const document = documentViewOf(documentRecord);
  const variant = variantOf(record);
  const audience = record.audience;
  const locale = localeOf(record.locale, record.direction);
  const candidateId = record.candidateId;

  if (candidateId === null) {
    const data: ContentCandidateData = {
      status: "none",
      document,
      variant,
      audience,
      locale,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { changedSections: "zero", changedPlacements: "zero" },
        actions: [
          {
            name: "submit-for-review",
            available: true,
            reason: "A submitted revision becomes the candidate a reviewer answers.",
          },
        ],
      }),
    };
  }

  // The store holds no separate candidate family: a frozen candidate is identified by the revision it
  // froze, so `candidateId` names that revision and is resolved by identity rather than guessed at.
  const frozen = findRevision(workspace.state, candidateId);
  if (frozen === undefined) {
    const data: ContentCandidateData = {
      status: "unavailable",
      document,
      variant,
      audience,
      locale,
      candidateId,
      reason:
        "The candidate this edition holds names a revision that is not in the store, so what the reviewer would approve cannot be shown.",
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { changedSections: "unavailable", changedPlacements: "unavailable" },
        actions: [
          {
            name: "submit-for-review",
            available: true,
            reason: "A fresh submission replaces the candidate that cannot be resolved.",
          },
        ],
      }),
    };
  }

  const placements = placementViews(workspace, frozen.mediaPlacements, frozen.captions);
  const rendered = renderRevision(frozen.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentCandidateData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      candidateId,
      issues: rendered.issues,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { changedSections: "unknown", changedPlacements: "unknown" },
        actions: [
          {
            name: "request-changes",
            available: true,
            reason: "The frozen revision cannot be approved as it stands.",
          },
        ],
      }),
    };
  }

  const checksums = checksumsOf(workspace.state);
  const head = headReleaseOf(workspace.state, record);
  const headRevision =
    head === undefined ? undefined : findRevision(workspace.state, head.revisionId);
  const headDocument = headRevision === undefined ? undefined : parseDocument(headRevision.body);
  const releaseDocument =
    headDocument !== undefined && headDocument.status === "valid"
      ? headDocument.document
      : undefined;

  const diff = candidateDiff({
    candidate: rendered.document,
    candidateChecksum: frozen.contentChecksum,
    release: releaseDocument,
    releaseChecksum: head === undefined ? undefined : checksums.get(head.revisionId),
    head,
    candidatePlacements: frozen.mediaPlacements,
    releasePlacements: headRevision === undefined ? [] : headRevision.mediaPlacements,
  });

  const data: ContentCandidateData = {
    status: "reviewable",
    document,
    variant,
    audience,
    locale,
    candidate: {
      candidateId,
      variantId: frozen.variantId,
      revisionId: frozen.revisionId,
      contentChecksum: frozen.contentChecksum,
      frozenAt: Temporal.Instant.from(frozen.createdAt),
      reviewRound: REVIEW_STEPS_PER_CANDIDATE,
    },
    revision: revisionOf(frozen, rendered.document),
    renderedHtml: rendered.html,
    placements,
    diff,
    review: {
      steps: REVIEW_STEPS_PER_CANDIDATE,
      round: REVIEW_STEPS_PER_CANDIDATE,
      decision: null,
      approvalScope: "this-variant-only",
    },
    recordRevision: record.revision,
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        changedSections: diff.sections.length === 0 ? "zero" : "value",
        changedPlacements: diff.placements.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "approve", available: true },
        { name: "request-changes", available: true },
        { name: "reject", available: true },
        {
          name: "publish-only",
          available: true,
          reason: "Releasing this candidate sends no message; notification is a separate decision.",
        },
        {
          name: "publish-and-notify-now",
          available: true,
          reason: "Only a reviewer who chooses it turns a release into a notification request.",
        },
      ],
    }),
  };
}

/**
 * The difference between a frozen candidate and the release it would replace.
 *
 * Comparison is by canonical serialisation of one section at a time, reusing the profile's own
 * serialiser wrapped in a single-section document, so there is no second canonicalisation to disagree
 * with it. A placement is compared by its stored fields, which the schema has already put in a fixed
 * order, and a changed placement is named by the identity a reviewer can act on.
 */
function candidateDiff(input: {
  readonly candidate: ContentDocumentJson;
  readonly candidateChecksum: string;
  readonly release: ContentDocumentJson | undefined;
  readonly releaseChecksum: string | undefined;
  readonly head: ReleaseRecord | undefined;
  readonly candidatePlacements: readonly MediaPlacementRecord[];
  readonly releasePlacements: readonly MediaPlacementRecord[];
}): CandidateDiffView {
  const { candidate, release } = input;
  const against =
    input.head === undefined
      ? null
      : {
          releaseId: input.head.releaseId,
          revisionId: input.head.revisionId,
          contentChecksum: input.releaseChecksum ?? "",
        };

  if (release === undefined) {
    return {
      against,
      unchanged: false,
      proseChanged: true,
      directionChanged: false,
      sections: [],
      placements: [],
    };
  }

  const proseChanged =
    serialise({ ...candidate, sections: [] }) !== serialise({ ...release, sections: [] });
  const directionChanged = candidate.direction !== release.direction;

  const sections: CandidateSectionChange[] = [];
  const positions = Math.max(candidate.sections.length, release.sections.length);
  for (let position = 0; position < positions; position += 1) {
    const next = candidate.sections[position];
    const previous = release.sections[position];
    if (next !== undefined && previous === undefined) {
      sections.push({ position, element: next.element, change: "added" });
      continue;
    }
    if (next === undefined && previous !== undefined) {
      sections.push({ position, element: previous.element, change: "removed" });
      continue;
    }
    if (next !== undefined && previous !== undefined) {
      if (sectionSignature(next) !== sectionSignature(previous)) {
        sections.push({ position, element: next.element, change: "changed" });
      }
    }
  }

  const placements = placementChanges(input.candidatePlacements, input.releasePlacements);

  return {
    against,
    unchanged:
      input.releaseChecksum !== undefined && input.releaseChecksum === input.candidateChecksum,
    proseChanged,
    directionChanged,
    sections,
    placements,
  };
}

/** One section's canonical form, produced by the content profile's own serialiser. */
function sectionSignature(section: ContentSection): string {
  return serialise({
    type: "doc",
    profileVersion: CONTENT_PROFILE_VERSION,
    direction: "ltr",
    content: [],
    sections: [section],
  });
}

/** The placement changes between two revisions, by placement identity. */
function placementChanges(
  candidate: readonly MediaPlacementRecord[],
  release: readonly MediaPlacementRecord[],
): readonly CandidatePlacementChange[] {
  const previous = new Map(release.map((placement) => [placement.placementId, placement]));
  const next = new Map(candidate.map((placement) => [placement.placementId, placement]));
  const changes: CandidatePlacementChange[] = [];

  for (const [placementId, placement] of next) {
    const before = previous.get(placementId);
    if (before === undefined) {
      changes.push({ placementId, assetId: placement.assetId, change: "added" });
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(placement)) {
      changes.push({ placementId, assetId: placement.assetId, change: "changed" });
    }
  }
  for (const [placementId, placement] of previous) {
    if (!next.has(placementId)) {
      changes.push({ placementId, assetId: placement.assetId, change: "removed" });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------------------------
// readRelease — the release standing at one edition's head
// ---------------------------------------------------------------------------------------------

/**
 * A withdrawn release as the tombstone surface states it: identity and dates, and no content.
 *
 * There is no revision identity, checksum, title, excerpt or media reference here, because a tombstone
 * that identified what stood at the address would be the disclosure a withdrawal exists to prevent.
 * The reach value is kept so a surface can say what the edition's discoverability had been.
 */
export interface WithdrawnReleaseView {
  readonly releaseId: string;
  readonly variantId: string;
  readonly publishedAt: string;
  readonly withdrawnAt: string;
  readonly reach: Reach;
  readonly recordRevision: string;
}

/** What a release read states: served, withdrawn, unreadable, or absent. */
export type ContentReleaseData =
  | {
      readonly status: "released";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly release: Release;
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      /** The reach value, and what it permits on the index and to a crawler. */
      readonly reach: {
        readonly value: Reach;
        readonly metadata: ReachMetadata;
        readonly listed: boolean;
        readonly directlyReadable: boolean;
      };
      /** The other editions' heads of the same document, presented separately and never merged. */
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "withdrawn";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly release: WithdrawnReleaseView;
      readonly tombstone: Tombstone;
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "invalid";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly releaseId: string;
      readonly issues: readonly DocumentIssue[];
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    }
  | {
      readonly status: "no-release";
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly siblingHeads: readonly ContentEditionView[];
      readonly recordRevision: string;
    };

/**
 * Reads the release standing at one edition's head, or the release a caller names from its history.
 *
 * Releases are independent per edition, so the sibling heads are returned beside this one rather than
 * folded into it: a partial release keeps each variant's own head, and this read never presents a
 * prior-good head as a newly released translation. A withdrawn release answers with a tombstone that
 * carries no identifying content.
 */
export async function readRelease(input: {
  readonly variantId: string;
  readonly releaseId?: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<ContentReleaseData>>> {
  const opened = await openContentWorkspace("readRelease", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }

  const document = documentViewOf(documentRecord);
  const variant = variantOf(record);
  const audience = record.audience;
  const locale = localeOf(record.locale, record.direction);
  const checksums = checksumsOf(workspace.state);
  const siblingHeads = variantsOf(workspace.state, documentRecord.documentId)
    .filter((sibling) => sibling.variantId !== record.variantId)
    .map((sibling) => editionViewOf(workspace.state, sibling, checksums));

  const requestedReleaseId = input.releaseId;
  if (requestedReleaseId !== undefined && !isNonEmptyString(requestedReleaseId)) {
    return recordNotFound();
  }
  const named =
    requestedReleaseId === undefined
      ? headReleaseOf(workspace.state, record)
      : releasesOfVariant(workspace.state, record.variantId).find(
          (release) => release.releaseId === requestedReleaseId,
        );
  if (named === undefined) {
    const data: ContentReleaseData = {
      status: "no-release",
      document,
      variant,
      audience,
      locale,
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {
          placements: "zero",
          siblingHeads: siblingHeads.length === 0 ? "zero" : "value",
        },
        actions: [
          {
            name: "publish-variants",
            available: record.candidateId !== null,
            ...(record.candidateId === null
              ? { reason: "This edition has no frozen candidate, so there is nothing to release." }
              : {}),
          },
          {
            name: "set-reach",
            available: false,
            reason: "Reach is a property of a released edition, and this edition has none.",
          },
          {
            name: "withdraw-release",
            available: false,
            reason: "There is no publication to withdraw.",
          },
        ],
      }),
    };
  }

  if (isWithdrawnRelease(named)) {
    const withdrawnAt = named.withdrawnAt ?? "";
    const data: ContentReleaseData = {
      status: "withdrawn",
      document,
      variant,
      audience,
      locale,
      release: {
        releaseId: named.releaseId,
        variantId: named.variantId,
        publishedAt: named.publishedAt,
        withdrawnAt,
        reach: named.reach,
        recordRevision: named.revision,
      },
      tombstone: tombstoneFor(workspace, named),
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {
          placements: "zero",
          siblingHeads: siblingHeads.length === 0 ? "zero" : "value",
        },
        actions: [
          {
            name: "publish-variants",
            available: record.candidateId !== null,
            ...(record.candidateId === null
              ? { reason: "A withdrawn edition is republished by releasing a new candidate." }
              : {}),
          },
        ],
      }),
    };
  }

  const revision = findRevision(workspace.state, named.revisionId);
  if (revision === undefined) {
    const data: ContentReleaseData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      releaseId: named.releaseId,
      issues: [
        {
          path: "release.revisionId",
          message:
            "The revision this release published is not in the store, so what readers were given cannot be shown.",
        },
      ],
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown", siblingHeads: "value" },
        actions: [{ name: "withdraw-release", available: true }],
      }),
    };
  }

  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  const rendered = renderRevision(revision.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentReleaseData = {
      status: "invalid",
      document,
      variant,
      audience,
      locale,
      releaseId: named.releaseId,
      issues: rendered.issues,
      siblingHeads,
      recordRevision: record.revision,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown", siblingHeads: "value" },
        actions: [{ name: "withdraw-release", available: true }],
      }),
    };
  }

  const edition = { reach: named.reach, withdrawnAt: named.withdrawnAt };
  const data: ContentReleaseData = {
    status: "released",
    document,
    variant,
    audience,
    locale,
    release: releaseOf(named, checksums),
    revision: revisionOf(revision, rendered.document),
    renderedHtml: rendered.html,
    placements,
    reach: {
      value: named.reach,
      metadata: reachMetadata(edition),
      listed: isListedPublicly(edition),
      directlyReadable: isDirectlyReadable(edition),
    },
    siblingHeads,
    recordRevision: record.revision,
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        placements: placements.length === 0 ? "zero" : "value",
        siblingHeads: siblingHeads.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "withdraw-release", available: true },
        { name: "set-reach", available: true },
        {
          name: "stop-showing-publicly",
          available: named.reach !== "not-public",
          ...(named.reach === "not-public"
            ? { reason: "This edition is already Not public, so it shows nowhere publicly." }
            : {}),
        },
        {
          name: "preview-release",
          available: true,
          reason: "A preview renders the exact released revision and starts nothing.",
        },
      ],
    }),
  };
}

/**
 * The tombstone a withdrawn edition answers with, taken from the reach module so the fixed message has
 * one author and cannot be made to name the edition it replaced.
 *
 * `withdrawEdition` pairs a withdrawal with its non-identifying tombstone, and records the instant it
 * is given; the session's own scenario instant is supplied so this read never touches the process
 * clock, and the returned release is discarded because nothing here writes.
 */
function tombstoneFor(workspace: ContentWorkspace, record: ReleaseRecord): Tombstone {
  return withdrawEdition(releaseOf(record, new Map<string, string>()), { at: workspace.asOf })
    .tombstone;
}

// ---------------------------------------------------------------------------------------------
// readPreview — one definition, both families, inert by construction
// ---------------------------------------------------------------------------------------------

/**
 * What a preview states: an authorised rendering of the acknowledged revision, a stored document the
 * profile cannot read, or the content module's own refusal reason.
 *
 * `inert` and `givingAction: "none"` come from the preview decision's literals rather than from a flag
 * this read could set, so no branch here can describe a preview that sends mail, subscribes a reader,
 * publishes anything or starts a checkout.
 */
export type ContentPreviewData =
  | {
      readonly status: "authorised";
      readonly variantId: string;
      readonly document: ContentDocumentView;
      readonly variant: ContentVariant;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      /** The exact revision rendered: the acknowledged one, never a fallback to the current head. */
      readonly revision: ContentRevision;
      readonly renderedHtml: string;
      readonly placements: readonly ContentPlacementView[];
      /** The opaque rendition identities admitted with this preview, de-duplicated. */
      readonly renditionIds: readonly string[];
      readonly inert: true;
      readonly givingAction: "none";
    }
  | {
      readonly status: "invalid";
      readonly variantId: string;
      readonly revisionId: string;
      readonly issues: readonly DocumentIssue[];
    }
  | {
      /** Refused by the content module's own decision: one reason code and nothing else. */
      readonly status: "denied";
      readonly reason: PreviewDenialReason;
    };

/**
 * The canonical reading address of one edition, by family: a page edition is read at its own public
 * address, and an Update at the receiving post for its document.
 *
 * The path names the edition, not a caller: a copied address authorises nothing on its own, because
 * every request that serves it re-derives the session and the scope it is read in.
 */
function canonicalPathOf(family: ContentFamily, documentId: string, localeTag: string): string {
  switch (family) {
    case "worker-page":
    case "project-page":
      return `/preview/pages/${encodeURIComponent(documentId)}/${encodeURIComponent(localeTag)}`;
    case "update":
      return `/preview/${encodeURIComponent(documentId)}`;
  }
  return assertNever(family);
}

/**
 * Reads an exact, currently authorised, inert preview of the revision a surface acknowledges.
 *
 * One definition serves both families: the family is a property of the document the identifier
 * resolves, and every rule the preview obeys — which revision may be rendered, whose authority admits
 * it, which locale is served, which renditions travel with it — is the content module's own decision.
 * The read supplies the facts that decision reads and never restates a gate.
 *
 * A preview is re-authorised on every call. The session is resolved again, the scope is asserted
 * again, editorial authority is asked again, and the content module compares the acknowledged revision
 * against the variant's current draft, its frozen candidate and the publication at this address. A
 * stale tab, a copied address and a switched locale therefore obtain a refusal rather than somebody
 * else's revision, and no refusal falls through to a sibling edition.
 */
export async function readPreview(input: {
  readonly variantId: string;
  readonly revisionId: string;
  readonly candidateId?: string;
  readonly requestedLocale?: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<ContentPreviewData>>> {
  const opened = await openContentWorkspace("readPreview", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId) || !isNonEmptyString(input.revisionId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }

  // A preview is a worker-side surface: drafting, reviewing and inspecting an edition. Editorial
  // authority over the edition is the fact this read uses in place of a supporter's reader grant, and
  // it is passed to the decision as `canReadProtected` because a colleague who may change the edition
  // may inspect the exact revision they are reviewing. No supporter's grant is consulted or invented,
  // and a principal without that authority is refused before anything is enumerated.
  const editorialAccess = canEdit(workspace.session, {
    kind: "content-variant",
    scope: workspace.scope,
  });
  if (!editorialAccess.allowed) {
    return { kind: "denied", denied: editorialAccess.denial };
  }

  const document = documentViewOf(documentRecord);
  const checksums = checksumsOf(workspace.state);
  const variant = variantOf(record);
  const releases = releasesOf(workspace.state, documentRecord.documentId).map((release) =>
    releaseOf(release, checksums),
  );

  const acknowledgedRevision = findRevision(workspace.state, input.revisionId);
  const acknowledgedPlacements =
    acknowledgedRevision === undefined
      ? []
      : placementViews(
          workspace,
          acknowledgedRevision.mediaPlacements,
          acknowledgedRevision.captions,
        );
  // The decision admits renditions for exactly the five purposes a preview serves, and all of them or
  // none: a caption or transcript address admitted on its own would become a way to ask about a
  // protected video without opening it.
  const renditionIds = acknowledgedPlacements.flatMap((placement) =>
    placement.state === "ready"
      ? placement.renditions
          .filter((rendition) => PREVIEW_RENDITION_PURPOSES.includes(rendition.purpose))
          .map((rendition) => rendition.renditionId)
      : [],
  );

  const candidate = candidateFor(workspace.state, record, input.candidateId);
  const isAuthor =
    acknowledgedRevision !== undefined &&
    acknowledgedRevision.authorPrincipalId === workspace.session.principalId;

  const decision = authorisePreview({
    principal: { principalId: workspace.session.principalId },
    variant,
    acknowledgement: {
      revisionId: input.revisionId,
      ...(candidate === undefined ? {} : { candidate }),
    },
    requestedLocale: input.requestedLocale ?? "",
    releases,
    renditionIds,
    canReadProtected: editorialAccess.allowed,
    isAuthor,
  });

  if (decision.status === "denied") {
    const data: ContentPreviewData = { status: "denied", reason: decision.reason };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        // A refusal states one reason code. It carries no count and no candidate for a value, because
        // the only fact it reports is the caller's relationship to the request.
        valueStates: {},
        actions: [],
      }),
    };
  }

  const admitted = findRevision(workspace.state, decision.revisionId);
  if (admitted === undefined) {
    const data: ContentPreviewData = {
      status: "invalid",
      variantId: record.variantId,
      revisionId: decision.revisionId,
      issues: [
        {
          path: "revisionId",
          message:
            "The acknowledged revision is no longer in the store, so nothing can be rendered.",
        },
      ],
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown" },
        actions: [],
      }),
    };
  }

  const placements = placementViews(workspace, admitted.mediaPlacements, admitted.captions);
  const rendered = renderRevision(admitted.body, placements);
  if (rendered.status === "invalid") {
    const data: ContentPreviewData = {
      status: "invalid",
      variantId: record.variantId,
      revisionId: admitted.revisionId,
      issues: rendered.issues,
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: { placements: "unknown" },
        actions: [],
      }),
    };
  }

  const data: ContentPreviewData = {
    status: "authorised",
    variantId: record.variantId,
    document,
    variant,
    audience: record.audience,
    locale: {
      tag: decision.servedLocale,
      direction: decision.direction,
    },
    revision: revisionOf(admitted, rendered.document),
    renderedHtml: rendered.html,
    placements,
    renditionIds: decision.renditionIds,
    inert: decision.inert,
    givingAction: decision.givingAction,
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        placements: placements.length === 0 ? "zero" : "value",
        renditionIds: decision.renditionIds.length === 0 ? "zero" : "value",
      },
      // A preview offers no effect at all: rendering it sends no message, subscribes nobody, publishes
      // nothing and starts no checkout, so there is no action to offer here — and no way for a surface
      // to present one.
      actions: [],
    }),
  };
}

/**
 * The candidate a preview answers, when the caller names one this edition still holds.
 *
 * A candidate that is not the variant's current one, that belongs to another edition, or that names a
 * revision the store cannot produce is not returned at all: reviewer authority is never claimed with a
 * record the variant no longer holds, and the preview decision then falls to the reading path.
 */
function candidateFor(
  state: ContentWorkspaceState,
  record: ContentVariantRecordLike,
  candidateId: string | undefined,
): ContentCandidate | undefined {
  if (candidateId === undefined || !isNonEmptyString(candidateId)) {
    return undefined;
  }
  if (record.candidateId !== candidateId) {
    return undefined;
  }
  const frozen = findRevision(state, candidateId);
  if (frozen === undefined || frozen.variantId !== record.variantId) {
    return undefined;
  }
  return {
    candidateId,
    variantId: frozen.variantId,
    revisionId: frozen.revisionId,
    contentChecksum: frozen.contentChecksum,
    frozenAt: Temporal.Instant.from(frozen.createdAt),
    reviewRound: REVIEW_STEPS_PER_CANDIDATE,
  };
}

// ---------------------------------------------------------------------------------------------
// readSharePresentation — the card a shared link shows
// ---------------------------------------------------------------------------------------------

/**
 * The image a share card shows: the asset's opaque identity, the display rendition this caller may
 * request, and the state of that rendition.
 *
 * A share image whose asset cannot be read is `unavailable` with the media module's own wording and no
 * rendition identity at all — never a fallback picture and never the private original, which no
 * consumer of this shape can name because it is not in it.
 */
export interface ShareImageView {
  readonly assetId: string;
  readonly renditionId: string | null;
  readonly path: string | null;
  readonly altText: string | null;
  readonly state: "ready" | "unavailable";
  readonly reason: MediaStateReason | null;
}

/** What a share presentation states: a card, or the tombstone a withdrawn edition answers with. */
export type SharePresentationData =
  | {
      readonly status: "shareable";
      readonly variantId: string;
      readonly documentId: string;
      readonly family: ContentFamily;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      /** The title the card states: its own, when the revision chose one, else the managed title. */
      readonly title: string;
      readonly description: string;
      readonly image: ShareImageView | null;
      readonly canonicalPath: string;
      /** Present exactly when the edition must stay out of a search index. */
      readonly robots: "noindex" | null;
    }
  | {
      readonly status: "withdrawn";
      readonly variantId: string;
      readonly documentId: string;
      readonly canonicalPath: string;
      readonly tombstone: Tombstone;
    }
  | {
      readonly status: "no-presentation";
      readonly variantId: string;
      readonly documentId: string;
      readonly family: ContentFamily;
      readonly audience: ContentAudience;
      readonly locale: ContentLocale;
      readonly reason: string;
    };

/**
 * Reads the share card of one edition: its title, its description, its chosen share image as an opaque
 * rendition identity, the canonical path for its family and its direction metadata.
 *
 * A protected edition's title is not disclosed to a principal that may not read it: an approved-
 * supporter edition answers only to a principal holding editorial authority over it, and every other
 * caller receives the same refusal a missing edition receives. A withdrawn edition answers with the
 * reach module's non-identifying tombstone instead of a card, so a share never outlives the edition it
 * described.
 */
export async function readSharePresentation(input: {
  readonly variantId: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<SharePresentationData>>> {
  const opened = await openContentWorkspace("readSharePresentation", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.variantId)) {
    return recordNotFound();
  }
  const record = findVariant(workspace.state, input.variantId);
  if (record === undefined) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, record.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }

  if (record.audience === "approved-supporter") {
    // A protected edition's very title is protected: the card is answered only to the principal who
    // may change the edition, and refused with the one code a missing edition answers with.
    const editorialAccess = canEdit(workspace.session, {
      kind: "content-variant",
      scope: workspace.scope,
    });
    if (!editorialAccess.allowed) {
      return { kind: "denied", denied: editorialAccess.denial };
    }
  }

  const family = documentRecord.family;
  const locale = localeOf(record.locale, record.direction);
  const canonicalPath = canonicalPathOf(family, documentRecord.documentId, record.locale);
  const head = headReleaseOf(workspace.state, record);

  if (head !== undefined && isWithdrawnRelease(head)) {
    const data: SharePresentationData = {
      status: "withdrawn",
      variantId: record.variantId,
      documentId: documentRecord.documentId,
      canonicalPath,
      tombstone: tombstoneFor(workspace, head),
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {},
        actions: [],
      }),
    };
  }

  // A shared link points at what readers are given, so the release's revision is the card's source.
  // An edition with no release yet is still being composed, and its draft is what its author is
  // preparing to share.
  const source = head !== undefined ? findRevision(workspace.state, head.revisionId) : undefined;
  const composing =
    record.draftRevisionId === null
      ? undefined
      : findRevision(workspace.state, record.draftRevisionId);
  const presentationSource = source ?? composing;

  if (presentationSource === undefined) {
    const data: SharePresentationData = {
      status: "no-presentation",
      variantId: record.variantId,
      documentId: documentRecord.documentId,
      family,
      audience: record.audience,
      locale,
      reason:
        "This edition has neither a released revision nor a saved draft, so there is nothing to present.",
    };
    return {
      kind: "envelope",
      envelope: contentEnvelope({
        workspace,
        data,
        source: contentSource(documentRecord.documentId),
        revision: record.revision,
        valueStates: {},
        actions: [],
      }),
    };
  }

  const share = presentationSource.sharePresentation;
  // The revision states the card's own title. The managed title of the document is not stored by this
  // release, so it is never substituted here: a card that invented a heading would be describing the
  // edition with words the source never supplied.
  const image = shareImageView(workspace, share);
  const reach =
    head === undefined
      ? undefined
      : reachMetadata({ reach: head.reach, withdrawnAt: head.withdrawnAt });

  const data: SharePresentationData = {
    status: "shareable",
    variantId: record.variantId,
    documentId: documentRecord.documentId,
    family,
    audience: record.audience,
    locale,
    title: share.title,
    description: share.description,
    image,
    canonicalPath,
    robots: reach?.robots ?? null,
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: record.revision,
      valueStates: {
        image: image === null ? "zero" : image.state === "ready" ? "value" : "unavailable",
      },
      actions: [{ name: "open-canonical-address", available: true }],
    }),
  };
}

/**
 * The share image of one revision, authorised against its own asset scope.
 *
 * The display rendition is the only one a card can use, so an asset without one is `unavailable` even
 * though its identity is stated: a card cannot show a playback rendition as a picture, and it never
 * falls back to another asset.
 */
function shareImageView(
  workspace: ContentWorkspace,
  share: SharePresentationRecord,
): ShareImageView | null {
  if (share.imageAssetId === null) {
    return null;
  }
  const asset = workspace.state.mediaAssets.find(
    (candidate) => candidate.assetId === share.imageAssetId,
  );
  const unavailable: ShareImageView = {
    assetId: share.imageAssetId,
    renditionId: null,
    path: null,
    altText: share.imageAltText,
    state: "unavailable",
    reason: mediaStateReason("unavailable"),
  };
  if (asset === undefined) {
    return unavailable;
  }
  const readable = canView(workspace.session, { kind: "media-asset", scope: asset.scope });
  if (!readable.allowed) {
    return unavailable;
  }
  const visible = project(asset, VISIBLE_MEDIA_ASSET_FIELDS);
  const display = visible.renditions.find(
    (rendition) => rendition.purpose === mainRenditionPurpose(visible.kind),
  );
  if (display === undefined) {
    return unavailable;
  }
  return {
    assetId: visible.assetId,
    renditionId: display.renditionId,
    path: renditionPath(visible.assetId, display.renditionId),
    altText: share.imageAltText,
    state: "ready",
    reason: null,
  };
}

// ---------------------------------------------------------------------------------------------
// readPageCatalogues — the two guided family catalogues
// ---------------------------------------------------------------------------------------------

/**
 * The eight section types a guided catalogue offers, declared once for both families.
 *
 * These are the catalogue keys a stored section's `element` names, and there are exactly eight: a
 * ninth type cannot appear without joining this tuple, and a stored element outside it is reported as
 * outside the catalogue rather than rendered in another style. The words for these keys — labels,
 * descriptions, field labels and the lock sentences — belong to `features/ministry-pages/copy.ts`,
 * which declares the same eight keys; a feature module may not be imported from the service, so the
 * keys are declared here as the catalogue the read serves and this file states no sentence of them.
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

/** One section type a page catalogue offers. */
export type PageSectionType = (typeof PAGE_SECTION_TYPES)[number];

/** The catalogue's version, stated as the envelope's revision for a declaration rather than a record. */
const PAGE_CATALOGUE_REVISION = "page-catalogue-1";

/**
 * The fields each section type edits, by key. A `giving` and a `progress` section edit no field at
 * all: the source supplies both, so the builder shows them locked rather than empty.
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

/** The two section types a source owns. They are locked with a reason, never hidden. */
const MANAGED_SECTION_TYPES: ReadonlySet<string> = new Set<string>(["giving", "progress"]);

/**
 * The lock reason a managed section carries, named on the vocabulary
 * `features/ministry-pages/copy.ts` declares for managed fields: the read supplies the key and the
 * family's wording module supplies the sentence, so one lock sentence serves the field and the section
 * that depends on it.
 */
const SECTION_LOCK_REASON_KEYS: Readonly<Record<string, string>> = {
  giving: "giving-binding",
  progress: "support-progress",
};

/** The lock reason key for a stored managed field, with the source-supplied fallback the copy declares. */
const MANAGED_FIELD_LOCK_REASON_KEYS: Readonly<Record<string, string>> = {
  title: "page-subject",
  givingBinding: "giving-binding",
  legalIdentity: "legal-identity",
  supportProgress: "support-progress",
};

/** The generic lock reason a managed field the map above does not name carries. */
const SOURCE_SUPPLIED_LOCK_REASON_KEY = "source-supplied-section";

/** The families a catalogue is offered for: both Page families, and never the Update family. */
const PAGE_FAMILIES = ["worker-page", "project-page"] as const;

/**
 * The structural changes a section can be given, listed so a surface can offer every one of them as a
 * button. There is deliberately no drag operation: reordering is a move up, a move down or a move to a
 * position, so composing a page never depends on a continuous pointer movement (WCAG 2.2 2.5.7).
 */
const PAGE_STRUCTURAL_OPERATIONS = [
  "add",
  "move-up",
  "move-down",
  "move-to-position",
  "duplicate",
  "remove",
] as const;

/** One structural change a section can be given. */
export type PageStructuralOperation = (typeof PAGE_STRUCTURAL_OPERATIONS)[number];

/** One preset: a proposed composition that produces a reviewable draft and releases nothing. */
export interface PagePresetView {
  readonly presetId: string;
  /** The catalogue keys the preset proposes, in the order it proposes them. */
  readonly sections: readonly PageSectionType[];
  /** A preset is a proposal: it creates a draft for review and never a release. */
  readonly creates: "reviewable-draft";
}

/** The presets every page catalogue proposes. They name no section outside the catalogue. */
const PAGE_PRESETS: readonly PagePresetView[] = [
  {
    presetId: "preset-opening-and-story",
    sections: ["introduction", "story"],
    creates: "reviewable-draft",
  },
  {
    presetId: "preset-story-and-prayer",
    sections: ["story", "prayer"],
    creates: "reviewable-draft",
  },
];

/** One section type as a catalogue lists it. */
export interface PageCatalogueSectionView {
  readonly key: PageSectionType;
  /** The key the family's wording module answers with this section's label and description. */
  readonly labelKey: string;
  /** Whether a source supplies this section, so the builder shows it read-only. */
  readonly managed: boolean;
  /** The lock reason key for a managed section, or `null` for one the author edits. */
  readonly lockReasonKey: string | null;
  /** The field keys this section edits; empty for a source-supplied section. */
  readonly fields: readonly string[];
  /** The bounded presentation choices this section offers. */
  readonly presentation: ContentPresentationChoices;
}

/** One family's catalogue. */
export interface PageCatalogueView {
  readonly family: ContentFamily;
  /** The key the family's wording module answers with this catalogue's label. */
  readonly labelKey: string;
  /** Exactly the eight admitted section types, in the order a builder lists them. */
  readonly sections: readonly PageCatalogueSectionView[];
}

/** What a catalogue read states: both families' catalogues and the operations they permit. */
export interface PageCataloguesData {
  readonly catalogues: readonly PageCatalogueView[];
  readonly presentation: ContentPresentationChoices;
  readonly structuralOperations: readonly PageStructuralOperation[];
  readonly presets: readonly PagePresetView[];
}

/**
 * Reads the two guided family catalogues: the eight admitted section types each offers, the fields and
 * presentation choices each admits, which are managed and why, the structural operations that stand in
 * for dragging, and the presets that propose a composition.
 *
 * There are exactly eight section types per family and no ninth, and a section states only the four
 * bounded presentation choices: no colour, spacing, theme, script, embed or pixel position is offered
 * because none is stored. The catalogue is a declaration rather than a record, so it needs no session
 * authority beyond the admission every content read requires.
 */
export async function readPageCatalogues(
  input: { readonly session?: SessionSource } = {},
): Promise<ReadResult<ReadEnvelope<PageCataloguesData>>> {
  const opened = await openContentWorkspace("readPageCatalogues", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;

  const sections: readonly PageCatalogueSectionView[] = PAGE_SECTION_TYPES.map((key) => ({
    key,
    labelKey: `catalogue.${key}`,
    managed: MANAGED_SECTION_TYPES.has(key),
    lockReasonKey: SECTION_LOCK_REASON_KEYS[key] ?? null,
    fields: SECTION_FIELD_KEYS[key],
    presentation: PRESENTATION_CHOICES,
  }));

  const data: PageCataloguesData = {
    catalogues: PAGE_FAMILIES.map((family) => ({
      family,
      labelKey: `catalogue.family.${family}`,
      sections,
    })),
    presentation: PRESENTATION_CHOICES,
    structuralOperations: PAGE_STRUCTURAL_OPERATIONS,
    presets: PAGE_PRESETS,
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource("page-catalogues"),
      revision: PAGE_CATALOGUE_REVISION,
      valueStates: {
        catalogues: "value",
        sectionTypes: "value",
        presets: PAGE_PRESETS.length === 0 ? "zero" : "value",
      },
      actions: [{ name: "add-section", available: true }],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// readPage — one Page, its locked fields, its ordered sections and its editions
// ---------------------------------------------------------------------------------------------

/** One field a source owns, stated as locked rather than hidden and with the reason key it carries. */
export interface PageManagedFieldView {
  /** The field name the document records, exactly as stored. */
  readonly key: string;
  /** Locked is the literal `true`: no managed field has an edit path in this release. */
  readonly locked: true;
  /** The lock reason key the family's wording module answers with. */
  readonly lockReasonKey: string;
}

/** One composed section as the builder lists it: its catalogue key, its fields and its media. */
export interface PageSectionView {
  /** The section's position in the edition, from zero, so a move is an explicit change of order. */
  readonly position: number;
  /** The catalogue element the section was composed from, exactly as stored. */
  readonly element: string;
  /** Whether that element is one of this family's eight admitted types. */
  readonly inCatalogue: boolean;
  /** Whether the section is source-supplied, and therefore locked with a reason. */
  readonly managed: boolean;
  readonly lockReasonKey: string | null;
  readonly fields: Readonly<Record<string, string>>;
  /** The bounded presentation this section states, validated by the content profile. */
  readonly presentation: PresentationChoice;
  /** The direction the section is read in, when it differs from the document's. */
  readonly direction: string | null;
  /** The media this section places, with the opaque rendition identities a surface may request. */
  readonly placements: readonly ContentPlacementView[];
}

/** What a page read states about the edition being composed. */
export interface PageDocumentData {
  readonly document: ContentDocumentView;
  readonly family: ContentFamily;
  readonly kind: ContentKind;
  /** The fields the source owns, each locked with the reason key for its wording. */
  readonly managedFields: readonly PageManagedFieldView[];
  /** The one approved giving designation the document holds, or `null` for *Giving unavailable*. */
  readonly givingBinding: { readonly designation: SourceReference; readonly label: string } | null;
  /** The draft edition being composed, or `null` when nothing is saved for it yet. */
  readonly draft: {
    readonly variantId: string;
    readonly revisionId: string;
    readonly recordRevision: string;
  } | null;
  /** The composed sections in the order a reader meets them, from the draft edition. */
  readonly sections: readonly PageSectionView[];
  readonly presets: readonly PagePresetView[];
  /** Every locale and audience edition with its own draft, candidate and release head. */
  readonly editions: readonly ContentEditionView[];
  /** The three reach values, so a surface offers exactly them and no fourth setting. */
  readonly reachOptions: readonly Reach[];
}

/**
 * Reads one Page: its family and kind, the fields a source locks with the reason for each, its giving
 * binding, the ordered sections of the edition being composed, the presets, every locale edition's own
 * pointers and the reach values a release may carry.
 *
 * Composing happens in a draft edition, so the sections are the draft's: a released edition keeps the
 * sections it was released with, and adding, moving, duplicating or removing one changes this draft
 * only. A stored element outside the eight admitted types is reported as outside the catalogue rather
 * than dropped, so an author can see what a stored document holds.
 */
export async function readPage(input: {
  readonly pageId: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<PageDocumentData>>> {
  const opened = await openContentWorkspace("readPage", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.pageId)) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, input.pageId);
  if (documentRecord === undefined || documentRecord.family === "update") {
    // An Update is not a Page: it has no section catalogue, no reach setting and no locale edition of
    // its own, so it is refused exactly as a document this session does not hold.
    return recordNotFound();
  }

  const checksums = checksumsOf(workspace.state);
  const editions = variantsOf(workspace.state, documentRecord.documentId).map((variant) =>
    editionViewOf(workspace.state, variant, checksums),
  );
  const variantRecords = variantsOf(workspace.state, documentRecord.documentId);
  // The edition being composed is the one holding a draft. With no draft anywhere, the first edition
  // is the one a builder opens, so a page is never refused merely because nothing is saved yet.
  const draftVariant =
    variantRecords.find((variant) => variant.draftRevisionId !== null) ?? variantRecords[0];
  const draftRevision =
    draftVariant === undefined || draftVariant.draftRevisionId === null
      ? undefined
      : findRevision(workspace.state, draftVariant.draftRevisionId);
  const parsedDraft = draftRevision === undefined ? undefined : parseDocument(draftRevision.body);

  const sections =
    draftRevision !== undefined && parsedDraft !== undefined && parsedDraft.status === "valid"
      ? sectionViewsOf(workspace, parsedDraft.document, draftRevision)
      : [];

  const data: PageDocumentData = {
    document: documentViewOf(documentRecord),
    family: documentRecord.family,
    kind: documentRecord.kind,
    managedFields: documentRecord.managedFields.map((key) => ({
      key,
      locked: true,
      lockReasonKey: MANAGED_FIELD_LOCK_REASON_KEYS[key] ?? SOURCE_SUPPLIED_LOCK_REASON_KEY,
    })),
    givingBinding:
      documentRecord.givingBinding === null
        ? null
        : {
            designation: documentRecord.givingBinding.designation,
            label: documentRecord.givingBinding.label,
          },
    draft:
      draftVariant === undefined || draftVariant.draftRevisionId === null
        ? null
        : {
            variantId: draftVariant.variantId,
            revisionId: draftVariant.draftRevisionId,
            recordRevision: draftVariant.revision,
          },
    sections,
    presets: PAGE_PRESETS,
    editions,
    reachOptions: REACH_VALUES,
  };

  const hasOrder = sections.length > 1;
  const hasSection = sections.length > 0;
  const hasCandidate = editions.some((edition) => edition.candidateId !== null);
  const hasRelease = editions.some((edition) => edition.releaseHeadId !== null);
  const showsPublicly = editions.some(
    (edition) => edition.headRelease !== null && edition.headRelease.reach !== "not-public",
  );

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: documentRecord.revision,
      valueStates: {
        sections: hasSection ? "value" : "zero",
        placements: sections.some((section) => section.placements.length > 0) ? "value" : "zero",
        editions: editions.length === 0 ? "zero" : "value",
      },
      actions: [
        { name: "add-section", available: true },
        {
          name: "move-section-up",
          available: hasOrder,
          ...(hasOrder ? {} : { reason: "A single section has no order to change." }),
        },
        {
          name: "move-section-down",
          available: hasOrder,
          ...(hasOrder ? {} : { reason: "A single section has no order to change." }),
        },
        {
          name: "move-section-to-position",
          available: hasOrder,
          ...(hasOrder ? {} : { reason: "A single section has no position to move to." }),
        },
        {
          name: "duplicate-section",
          available: hasSection,
          ...(hasSection ? {} : { reason: "There is no section to duplicate yet." }),
        },
        {
          name: "remove-section",
          available: hasSection,
          ...(hasSection ? {} : { reason: "There is no section to remove yet." }),
        },
        {
          name: "save-section-fields",
          available: hasSection,
          ...(hasSection ? {} : { reason: "There is no section whose fields could be saved." }),
        },
        { name: "apply-preset", available: true },
        { name: "save-draft", available: true },
        { name: "submit-for-review", available: true },
        {
          name: "publish-variants",
          available: hasCandidate,
          ...(hasCandidate ? {} : { reason: "No edition has a frozen candidate to release." }),
        },
        {
          name: "set-reach",
          available: hasRelease,
          ...(hasRelease
            ? {}
            : { reason: "Reach belongs to a released edition, and none exists yet." }),
        },
        {
          name: "stop-showing-publicly",
          available: showsPublicly,
          ...(showsPublicly
            ? {}
            : {
                reason:
                  "No edition of this page is public or listed, so there is nothing to contain.",
              }),
        },
        {
          name: "withdraw-page",
          available: hasRelease,
          ...(hasRelease ? {} : { reason: "There is no publication to withdraw." }),
        },
      ],
    }),
  };
}

/**
 * The sections of one edition as the builder lists them.
 *
 * Each section's media is resolved through the same placement read every other surface uses, filtered
 * to the placements the author attached to that section, so a section's video carries the same opaque
 * rendition identities and the same unavailable state as it does in the preview.
 */
function sectionViewsOf(
  workspace: ContentWorkspace,
  document: ContentDocumentJson,
  revision: StoredContentRevision,
): readonly PageSectionView[] {
  const placements = placementViews(workspace, revision.mediaPlacements, revision.captions);
  return document.sections.map((section, position) => {
    const managed = MANAGED_SECTION_TYPES.has(section.element);
    return {
      position,
      element: section.element,
      inCatalogue: (PAGE_SECTION_TYPES as readonly string[]).includes(section.element),
      managed,
      lockReasonKey: managed ? (SECTION_LOCK_REASON_KEYS[section.element] ?? null) : null,
      fields: section.fields,
      presentation: section.presentation,
      direction: section.direction ?? null,
      placements: placements.filter((placement) => placement.sectionElement === section.element),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// readPageLocales — the locale editions, the fallback and *Language unavailable*
// ---------------------------------------------------------------------------------------------

/** Where the locale a read resolved against came from: the caller, or the document's own default. */
export type RequestedLocaleSource = "caller" | "document-default";

/** What a locale read states: the resolution, the editions, and the locales a reader may choose. */
export interface PageLocalesData {
  readonly document: ContentDocumentView;
  /** The language the resolution ran for, stated as it was asked or as defaulted above. */
  readonly requestedLocale: string;
  /** Whether the caller named that language or the document's own default supplied it. */
  readonly requestedLocaleSource: RequestedLocaleSource;
  /**
   * The resolution: a served edition with the language actually served and whether a fallback
   * occurred, or `language-unavailable` carrying the requested language and nothing else.
   */
  readonly resolution: LocaleResolution;
  /** Every edition with its own draft, candidate and release head, whatever its language. */
  readonly editions: readonly ContentEditionView[];
  /** The locales a reader may actually open, for the switcher: admitted releases only. */
  readonly admittedLocales: readonly AdmittedLocale[];
}

/**
 * Reads the locale editions of one Page: the requested language, the editions that exist with their own
 * pointers, the resolution `locale.ts` answers, and the locales a reader may choose.
 *
 * `resolution.status === "language-unavailable"` is the surface's *Language unavailable*: a distinct
 * state that is never an empty list and never a silent substitution of English. When a fallback does
 * occur, `resolution.servedLocale` states the actual language served beside the one requested, so a
 * reader is never told they were given a language they were not. Fallback never changes the audience
 * and never reveals a denied edition's existence or title: the resolution is computed over admitted
 * releases of the public audience only, and an unavailable language carries no other fact.
 */
export async function readPageLocales(input: {
  readonly pageId: string;
  readonly requestedLocale?: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<PageLocalesData>>> {
  const opened = await openContentWorkspace("readPageLocales", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.pageId)) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, input.pageId);
  if (documentRecord === undefined || documentRecord.family === "update") {
    return recordNotFound();
  }

  const checksums = checksumsOf(workspace.state);
  const variantRecords = variantsOf(workspace.state, documentRecord.documentId);
  const editions = variantRecords.map((variant) =>
    editionViewOf(workspace.state, variant, checksums),
  );

  const newest = newestReleaseOf(releasesOf(workspace.state, documentRecord.documentId));
  const documentDefault = newest?.locale ?? variantRecords[0]?.locale ?? "";
  const asked = input.requestedLocale;
  const requestedLocale = isNonEmptyString(asked) ? asked : documentDefault;
  const requestedLocaleSource: RequestedLocaleSource = isNonEmptyString(asked)
    ? "caller"
    : "document-default";

  // A Page edition is public: the approved-supporter audience belongs to an Update, so the public
  // audience is the only one this resolution ever reads, and no audience x locale cross-product is
  // even representable here.
  const releases: readonly (Release & { readonly documentId: string; readonly siteId: string })[] =
    releasesOf(workspace.state, documentRecord.documentId).map((release) => ({
      ...releaseOf(release, checksums),
      documentId: documentRecord.documentId,
      siteId: documentRecord.siteId,
    }));

  const query = {
    document: documentOf(documentRecord),
    siteDefaultLocale: NO_DECLARED_SITE_DEFAULT,
    audience: "public" as const,
    releases,
  };
  const resolution = resolveLocale({ ...query, requestedLocale });

  const data: PageLocalesData = {
    document: documentViewOf(documentRecord),
    requestedLocale,
    requestedLocaleSource,
    resolution,
    editions,
    admittedLocales: admittedLocales(query),
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: documentRecord.revision,
      valueStates: {
        editions: editions.length === 0 ? "zero" : "value",
        admittedLocales: admittedLocales(query).length === 0 ? "zero" : "value",
        "resolution.servedLocale": resolution.status === "resolved" ? "value" : "unavailable",
      },
      actions: [
        { name: "add-locale-edition", available: true },
        {
          name: "open-edition",
          available: resolution.status === "resolved",
          ...(resolution.status === "resolved"
            ? {}
            : {
                reason: "No permitted edition serves this language, so there is nothing to open.",
              }),
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// readGivingBinding — one approved Designation, or *Giving unavailable*, and a qualified progress
// ---------------------------------------------------------------------------------------------

/**
 * The closed set of reasons a release can show no giving at all.
 *
 * `missing` is a page with no approved Designation bound, `incompatible` is an edition a Give
 * placement cannot belong to — an Update, or a release that has been withdrawn — and `revoked` is an
 * approval withdrawn in the source. The stored document cannot express a revocation, so this read
 * never answers `revoked`: the member exists because the placement's own vocabulary has it, and a
 * release whose approval was withdrawn arrives here as `missing`, exactly as an approval that never
 * existed does. Naming a cause this read cannot establish would be a fabrication.
 */
export type GivingUnavailableCause = "missing" | "revoked" | "incompatible";

/**
 * What a Give placement receives: the one approved Designation with its identity, or the reason there
 * is none.
 *
 * There is deliberately no fallback designation, no fund list and no amount here. A placement that
 * cannot see the destination must not be able to imply a figure either, and the label is display text
 * supplied by the source rather than an identity.
 */
export type GivingBindingView =
  | {
      readonly state: "approved";
      /** The approved Designation's display name, exactly as the source supplied it. */
      readonly designationLabel: string;
      /** The opaque, source-qualified identity of that Designation. Never parsed, never a join key. */
      readonly designationRef: SourceReference;
    }
  | { readonly state: "unavailable"; readonly cause: GivingUnavailableCause };

/**
 * The qualified progress a page may show: the goal the source states, the measure it counts, the
 * currency, the period and how much of that period the source covers.
 *
 * The received figure itself is not in this shape and is not computed here. A financial total has
 * exactly one computation in this application — the report function — and a second path summing gifts
 * for a page is the failure that rule exists to prevent. This view therefore carries the four facts
 * that make a report qualified and the two instants that make it attributable, and the surface reads
 * the figure from the report for exactly this basis, currency and period. A worker-entered amount and
 * an account balance are not progress and never appear here.
 */
export interface GivingProgressView {
  /** The measure the qualified figure counts. */
  readonly measure: SupportGoalMeasure;
  /** The named received-support basis every support surface reports on. */
  readonly basis: SupportBasis;
  /** The goal the source states, as exact minor units in its own currency. */
  readonly goal: { readonly currency: string; readonly minorUnits: number };
  /** The currency the goal and the qualified figure are stated in. */
  readonly currency: string;
  /** That currency's minor-unit exponent, so a surface formats the exact units it was given. */
  readonly currencyExponent: number;
  /** The period the figure covers, as the source states it; `null` bounds state no boundary. */
  readonly period: Coverage;
  /** How much of that period the source covers: the qualification, never a value's own state. */
  readonly coverage: CoverageState;
  /** The provenance of the projection the goal came from. */
  readonly source: SourceReference;
  /** When the projection was evaluated, and when its source last changed: two different facts. */
  readonly asOf: string;
  readonly lastSourceUpdate: string;
}

/** What a giving read states: the placement's binding, the release it belongs to, and its progress. */
export interface GivingBindingData {
  readonly document: ContentDocumentView;
  /** The release the placement belongs to, or `null` when the caller asked about a page with none. */
  readonly release: {
    readonly releaseId: string;
    readonly variantId: string;
    readonly locale: ContentLocale;
    readonly publishedAt: string;
    readonly reach: Reach;
    readonly withdrawnAt: string | null;
  } | null;
  /** The one approved Designation, or the reason there is none. */
  readonly binding: GivingBindingView;
  /** One factual sentence about the state, for a surface's own wording; never reader copy. */
  readonly detail: string | null;
  /** The progress module, present only when every fact it needs is qualified. */
  readonly progress: GivingProgressView | null;
  /** Always true: the placement describes a destination and starts nothing. */
  readonly inert: true;
  /** Always `none`: no placement offers a live giving action, whatever Designation it holds. */
  readonly givingAction: "none";
}

/**
 * Reads the one approved giving Designation a page release may place, or states *Giving unavailable*
 * with its reason, together with the progress module when the source qualifies one.
 *
 * Giving is a destination an organization approves in a source. This read therefore never invents a
 * designation, never falls back to another fund and never treats a worker-entered amount or an account
 * balance as progress. The progress module is present only when the support projection states a goal,
 * a measure, a currency with a known exponent, a period and a coverage: with any of them absent there
 * is no module at all rather than a zero or a dash, and a partial coverage travels as `partial` so the
 * figure is labelled as covering part of its period.
 */
export async function readGivingBinding(input: {
  readonly documentId: string;
  readonly releaseId?: string;
  /**
   * The explicit session identity a development caller may name, exactly as `authorize.ts` provides
   * it: the domain and integration tests proving isolation, and the operational scripts. A browser
   * route never supplies it, and `resolveSession` refuses it in a production build.
   */
  readonly session?: SessionSource;
}): Promise<ReadResult<ReadEnvelope<GivingBindingData>>> {
  const opened = await openContentWorkspace("readGivingBinding", input.session);
  if (!opened.ok) {
    return opened.result;
  }
  const { workspace } = opened;
  if (!isNonEmptyString(input.documentId)) {
    return recordNotFound();
  }
  const requestedReleaseId = input.releaseId;
  if (requestedReleaseId !== undefined && !isNonEmptyString(requestedReleaseId)) {
    return recordNotFound();
  }
  const documentRecord = findDocument(workspace.state, input.documentId);
  if (documentRecord === undefined) {
    return recordNotFound();
  }

  const releases = releasesOf(workspace.state, documentRecord.documentId);
  const named =
    requestedReleaseId === undefined
      ? newestReleaseOf(releases)
      : releases.find((release) => release.releaseId === requestedReleaseId);
  if (requestedReleaseId !== undefined && named === undefined) {
    return recordNotFound();
  }

  const document = documentViewOf(documentRecord);
  const placement = givingPlacementOf(documentRecord, named);
  // Progress is its own catalogue section, not part of the giving designation: a page whose giving
  // destination is unavailable can still show how support is going, and one whose destination is
  // approved may still have no qualified progress. The two states are independent.
  const progress = documentRecord.family === "update" ? null : progressOf(workspace);

  const data: GivingBindingData = {
    document,
    release:
      named === undefined
        ? null
        : {
            releaseId: named.releaseId,
            variantId: named.variantId,
            locale: releaseLocaleOf(named.locale),
            publishedAt: named.publishedAt,
            reach: named.reach,
            withdrawnAt: named.withdrawnAt,
          },
    binding: placement.binding,
    detail: placement.detail,
    progress,
    inert: true,
    givingAction: "none",
  };

  return {
    kind: "envelope",
    envelope: contentEnvelope({
      workspace,
      data,
      source: contentSource(documentRecord.documentId),
      revision: documentRecord.revision,
      valueStates: {
        "binding.designation": placement.binding.state === "approved" ? "value" : "unavailable",
        // A page whose source qualifies no progress states none at all, which is `unknown`: the source
        // never established a figure, and that is not the same fact as a progress of zero.
        progress: progress === null ? "unknown" : "value",
        "progress.goal": progress === null ? "unknown" : "value",
      },
      actions: [
        {
          name: "start-giving",
          available: false,
          reason:
            "Giving is a simulated destination: no payment is taken, no checkout is started and no fund can be chosen on a page.",
        },
      ],
    }),
  };
}

/**
 * The binding of one Give placement: the document's one approved designation, or the reason there is
 * none, with one factual sentence about the state.
 *
 * A designation is placed only on a Page release, so an Update answers `incompatible`; a withdrawn
 * release answers `incompatible` too, because its address serves a tombstone rather than a placement.
 * With no approved designation bound, the answer is `missing` and no other fund stands in its place.
 */
function givingPlacementOf(
  document: ContentDocumentRecord,
  release: ReleaseRecord | undefined,
): { readonly binding: GivingBindingView; readonly detail: string | null } {
  if (document.family === "update") {
    return {
      binding: { state: "unavailable", cause: "incompatible" },
      detail:
        "A Give placement belongs to a Worker or Project Page. An Update carries none, so there is no designation to show.",
    };
  }
  if (release !== undefined && release.withdrawnAt !== null) {
    return {
      binding: { state: "unavailable", cause: "incompatible" },
      detail:
        "This edition has been withdrawn, so its address serves a tombstone and no giving destination.",
    };
  }
  if (document.givingBinding === null) {
    return {
      binding: { state: "unavailable", cause: "missing" },
      detail:
        "No giving designation is approved for this page, and no default destination stands in its place.",
    };
  }
  return {
    binding: {
      state: "approved",
      designationLabel: document.givingBinding.label,
      designationRef: document.givingBinding.designation,
    },
    detail: null,
  };
}

/**
 * The progress module of one workspace, or `null` when the source qualifies none.
 *
 * Every condition is required: a projection must exist, it must state a goal on the named
 * received-support basis, the goal's currency must have a known exponent, and the projection must
 * state a period with a coverage that is not `unknown`. A currency with no exponent cannot be summed
 * or formatted as a total, and an unknown coverage cannot state a period, so neither qualifies — and
 * neither is defaulted to two decimals or to a closed period.
 */
function progressOf(workspace: ContentWorkspace): GivingProgressView | null {
  const projection: SupportProjectionRecord | null | undefined = workspace.state.supportProjection;
  if (projection === null || projection === undefined) {
    return null;
  }
  const goal = projection.goal;
  if (goal === null) {
    return null;
  }
  if (goal.measure !== "received-support" || projection.basis !== "effective_cash_allocation") {
    return null;
  }
  const exponent = projection.currencyExponents[goal.amount.currency];
  if (exponent === undefined) {
    return null;
  }
  if (projection.coverage.state === "unknown") {
    return null;
  }
  return {
    measure: goal.measure,
    basis: projection.basis,
    goal: { currency: goal.amount.currency, minorUnits: goal.amount.minorUnits },
    currency: goal.amount.currency,
    currencyExponent: exponent,
    period: projection.coverage,
    coverage: projection.coverage.state,
    source: projection.source,
    asOf: projection.asOf,
    lastSourceUpdate: projection.lastSourceUpdate,
  };
}
