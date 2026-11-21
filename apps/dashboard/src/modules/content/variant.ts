/**
 * Draft, candidate and release identity for every Update and every Worker or Project Page: the one
 * place in the application that decides what a variant is, that a candidate freezes an exact revision,
 * that a release supersedes a prior head, and that a manual translation has gone stale.
 */
import type { Temporal } from "temporal-polyfill";
import type { SourceReference } from "@/lib/ids";
import {
  CONTENT_DIRECTIONS,
  CONTENT_PROFILE_VERSION,
  checksum,
  parseDocument,
  serialise,
  type ContentDirection,
  type ContentDocumentJson,
  type ContentSection,
  type DocumentIssue,
} from "@/modules/content/document";
import { now } from "@/modules/time/clock";
// The closed vocabularies
/** The three content families. */
export const VARIANT_FAMILIES = ["update", "worker-page", "project-page"] as const;
/** One content family, derived from {@link VARIANT_FAMILIES}. */
export type VariantFamily = (typeof VARIANT_FAMILIES)[number];
/** The two audiences a variant may serve. */
export const VARIANT_AUDIENCES = ["public", "approved-supporter"] as const;
/** One content audience, derived from {@link VARIANT_AUDIENCES}. */
export type VariantAudience = (typeof VARIANT_AUDIENCES)[number];
/** The kinds an Update may declare, as the specification names them. */
export const CONTENT_KINDS = ["update", "prayer", "story", "milestone"] as const;
/** One content kind, derived from {@link CONTENT_KINDS}. */
export type ContentKind = (typeof CONTENT_KINDS)[number];
/** The three reach values a released edition may carry: not public, public but unlisted, and listed publicly. */
export const RELEASE_REACH_VALUES = ["not-public", "link-public", "listed"] as const;
/** One reach value, derived from {@link RELEASE_REACH_VALUES}. */
export type ReleaseReach = (typeof RELEASE_REACH_VALUES)[number];
/** How many review rounds a candidate may receive: exactly one. */
export const REVIEW_STEPS_PER_CANDIDATE = 1 as const;
/** The answers a reviewer may give to one frozen candidate. */
export const REVIEW_DECISIONS = ["approved", "changes-requested", "rejected"] as const;
/** One review answer, derived from {@link REVIEW_DECISIONS}. */
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
// The records of AAP 0.6.2, with their field names verbatim
/** The canonical content identity: one Update or one Page, owning the facts that prose may never rewrite. */
export interface ContentDocument {
  readonly documentId: string;
  readonly family: VariantFamily;
  readonly kind: ContentKind;
  readonly sourceSubject: SourceReference;
  readonly siteId: string;
  readonly givingBinding?: SourceReference;
  readonly managedFields: Readonly<Record<string, string>>;
}
/** One exact content locale: a BCP-47 language tag and the direction that locale is authored and read in. */
export interface VariantLocale {
  readonly tag: string;
  readonly direction: ContentDirection;
}
/** The source a manual translation was made from: the source variant and the exact revision copied. */
export interface TranslationSource {
  readonly variantId: string;
  readonly revisionId: string;
}
/** One working variant: an exact (document, permitted audience, locale) key with its own pointers to a draft revision, a frozen candidate and a released head. */
export interface ContentVariant {
  readonly variantId: string;
  readonly documentId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly draftRevisionId?: string;
  readonly candidateId?: string;
  readonly releaseHeadId?: string;
  readonly translationSource?: TranslationSource;
}
/** One media placement: the identity of the placement inside a revision and the opaque identity of the asset `modules/media` owns. */
export interface MediaPlacement {
  readonly placementId: string;
  readonly assetId: string;
}
/** How a released edition presents itself in a link preview. */
export interface SharePresentation {
  readonly title?: string;
  readonly description?: string;
  readonly imageAssetId?: string;
}
/** The authored content of one revision: exactly what the candidate freezes and the release publishes. */
export interface RevisionContent {
  readonly body: ContentDocumentJson;
  readonly sections: readonly ContentSection[];
  readonly mediaPlacements: readonly MediaPlacement[];
  readonly captions: Readonly<Record<string, string>>;
  readonly altText: Readonly<Record<string, string>>;
  readonly sharePresentation: SharePresentation;
}
/** One immutable authored state of one variant. */
export interface ContentRevision extends RevisionContent {
  readonly revisionId: string;
  readonly variantId: string;
  readonly contentChecksum: string;
  readonly authorPrincipalId: string;
  readonly createdAt: Temporal.Instant;
}
/** One frozen candidate: the exact revision a reviewer is answering, and nothing that can drift from it. */
export interface ContentCandidate {
  readonly candidateId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly contentChecksum: string;
  readonly frozenAt: Temporal.Instant;
  readonly reviewRound: typeof REVIEW_STEPS_PER_CANDIDATE;
}
/** One publication of one revision to one audience and locale. */
export interface Release {
  readonly releaseId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly publishedAt: Temporal.Instant;
  readonly reach: ReleaseReach;
  readonly contentChecksum: string;
  readonly withdrawnAt?: Temporal.Instant;
  readonly supersededBy?: string;
}
// The neutral outcomes this module answers with
/** An applied change to one variant, or the issues that refused it. */
export type VariantChange =
  | {
      readonly status: "applied";
      readonly variant: ContentVariant;
      readonly supersededRelease?: Release;
    }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** The identity a variant must hold uniquely within its document: audience and exact locale. */
export interface VariantKey {
  readonly documentId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
}
/** Whether a variant key is free, or which existing variant already holds it. */
export type VariantKeyUniqueness = { readonly status: "unique" } | { readonly status: "duplicate"; readonly conflictingVariantId: string };
// Identity guards: a closed value, a plausible locale tag, one key per edition
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}
function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return allowed.some((entry) => entry === value);
}
const LANGUAGE_SUBTAG = /^[A-Za-z]{2,3}$/u;

const REGISTERED_LANGUAGE_SUBTAG = /^[A-Za-z]{5,8}$/u;

const GENERIC_SUBTAG = /^[A-Za-z0-9]{1,8}$/u;

function localeTagProblem(tag: string): string | undefined {
  if (isBlank(tag)) {
    return "A variant states its content locale as a BCP-47 language tag, for example en, fr-CA or ar.";
  }
  const [language, ...subtags] = tag.split("-");
  if (language === undefined || !(LANGUAGE_SUBTAG.test(language) || REGISTERED_LANGUAGE_SUBTAG.test(language))) {
    return `"${tag}" does not begin with a two- or three-letter language subtag (or a registered five- to eight-letter one), so it is not a BCP-47 language tag.`;
  }
  for (const subtag of subtags) {
    if (!GENERIC_SUBTAG.test(subtag)) {
      return `"${tag}" carries a subtag that is not one to eight alphanumeric characters, so it is not a BCP-47 language tag.`;
    }
  }
  return undefined;
}
function localeTagsMatch(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
const ADMITTED_AUDIENCES: ReadonlyMap<VariantFamily, readonly VariantAudience[]> = new Map<VariantFamily, readonly VariantAudience[]>([
  ["update", ["public", "approved-supporter"]],
  ["worker-page", ["public"]],
  ["project-page", ["public"]],
]);
/** The audiences one family admits, in the order a surface lists them. */
export function admittedAudiences(family: VariantFamily): readonly VariantAudience[] {
  return ADMITTED_AUDIENCES.get(family) ?? [];
}
/** Whether a family permits an audience. */
export function variantKeyAllowed(family: VariantFamily, audience: VariantAudience): boolean {
  const admitted = ADMITTED_AUDIENCES.get(family);
  return admitted !== undefined && admitted.includes(audience);
}
/** Whether a variant key — one document, one audience, one exact locale tag — is free among the document's existing variants, or which variant already holds it. */
export function assertVariantKeyUnique(existing: readonly ContentVariant[], key: VariantKey): VariantKeyUniqueness {
  for (const variant of existing) {
    if (variant.documentId !== key.documentId) {
      continue;
    }
    if (variant.audience !== key.audience) {
      continue;
    }
    if (localeTagsMatch(variant.locale.tag, key.locale.tag)) {
      return { status: "duplicate", conflictingVariantId: variant.variantId };
    }
  }
  return { status: "unique" };
}
// Creating a variant
/** The source of a manual translation, with the records it names so the same-document rule can be checked. */
export interface TranslationSourceEvidence {
  readonly variant: ContentVariant;
  readonly revision: ContentRevision;
}
/** What a caller supplies to create one variant of one document. */
export interface CreateVariantInput {
  readonly variantId: string;
  readonly document: ContentDocument;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly existingVariants: readonly ContentVariant[];
  readonly translationSource?: TranslationSourceEvidence;
}
/** The outcome of creating a variant: the variant itself, or every issue that refused it. */
export type CreateVariantResult = { readonly status: "created"; readonly variant: ContentVariant } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Creates one working variant of one document, with no draft, candidate or release yet. */
export function createVariant(input: CreateVariantInput): CreateVariantResult {
  const issues: DocumentIssue[] = [];
  const { document } = input;
  if (isBlank(input.variantId)) {
    issues.push({ path: "variantId", message: "A variant states its own identity." });
  }
  if (isBlank(document.documentId)) {
    issues.push({
      path: "document.documentId",
      message: "A variant belongs to a document with its own identity.",
    });
  }
  if (!isOneOf(VARIANT_FAMILIES, document.family)) {
    issues.push({
      path: "document.family",
      message: `A content document is one of ${VARIANT_FAMILIES.join(", ")}.`,
    });
  }
  if (!isOneOf(CONTENT_KINDS, document.kind)) {
    issues.push({
      path: "document.kind",
      message: `An Update is one of ${CONTENT_KINDS.join(", ")}.`,
    });
  }
  if (isBlank(document.siteId)) {
    issues.push({
      path: "document.siteId",
      message: "A document names the site it belongs to, because locale fallback resolves within one site.",
    });
  }
  if (isBlank(document.sourceSubject.system) || isBlank(document.sourceSubject.reference)) {
    issues.push({
      path: "document.sourceSubject",
      message: "A document states the source system and its opaque reference for the subject it belongs to.",
    });
  }
  if (document.givingBinding !== undefined && (isBlank(document.givingBinding.system) || isBlank(document.givingBinding.reference))) {
    issues.push({
      path: "document.givingBinding",
      message: "A giving binding is a source-qualified reference; an unqualified one would name no Designation.",
    });
  }
  for (const value of Object.values(document.managedFields)) {
    if (typeof value !== "string") {
      issues.push({
        path: "document.managedFields",
        message: "A managed field carries the source's text value, stated as a string.",
      });
      break;
    }
  }
  if (!isOneOf(VARIANT_AUDIENCES, input.audience)) {
    issues.push({
      path: "audience",
      message: `A variant serves one of ${VARIANT_AUDIENCES.join(", ")}.`,
    });
  } else if (!variantKeyAllowed(document.family, input.audience)) {
    const admitted = admittedAudiences(document.family);
    issues.push({
      path: "audience",
      message:
        admitted.length === 0
          ? `"${document.family}" is not a content family, so it admits no audience.`
          : `A ${document.family} admits ${admitted.join(" and ")} editions only; ${input.audience} is not one of them.`,
    });
  }
  const localeProblem = localeTagProblem(input.locale.tag);
  if (localeProblem !== undefined) {
    issues.push({ path: "locale.tag", message: localeProblem });
  }
  if (!isOneOf(CONTENT_DIRECTIONS, input.locale.direction)) {
    issues.push({
      path: "locale.direction",
      message: `An edition states the direction it is read in: ${CONTENT_DIRECTIONS.join(" or ")}.`,
    });
  }
  const source = input.translationSource;
  if (source !== undefined) {
    if (source.variant.variantId === input.variantId) {
      issues.push({
        path: "translationSource",
        message: "A translation copies another edition of the document; it cannot name itself as its source.",
      });
    }
    if (source.variant.documentId !== document.documentId) {
      issues.push({
        path: "translationSource.variantId",
        message: "A translation copies a revision of the same document; the named source belongs to another document.",
      });
    }
    if (source.revision.variantId !== source.variant.variantId) {
      issues.push({
        path: "translationSource.revisionId",
        message: "The named source revision belongs to another variant, so it is not the revision the translation copies.",
      });
    }
    if (isBlank(source.revision.revisionId)) {
      issues.push({
        path: "translationSource.revisionId",
        message: "A translation records the exact source revision it copied.",
      });
    }
  }
  const uniqueness = assertVariantKeyUnique(input.existingVariants, {
    documentId: document.documentId,
    audience: input.audience,
    locale: input.locale,
  });
  if (uniqueness.status === "duplicate") {
    issues.push({
      path: "locale.tag",
      message: `This document already has a ${input.audience} edition in ${input.locale.tag} (${uniqueness.conflictingVariantId}).`,
    });
  }
  if (issues.length > 0) {
    return { status: "invalid", issues };
  }
  const variant: ContentVariant = {
    variantId: input.variantId,
    documentId: document.documentId,
    audience: input.audience,
    locale: { tag: input.locale.tag, direction: input.locale.direction },
    ...(source === undefined
      ? {}
      : {
          translationSource: {
            variantId: source.variant.variantId,
            revisionId: source.revision.revisionId,
          },
        }),
  };
  return { status: "created", variant };
}
// Revisions: one immutable authored state, the digest that identifies it, and the draft pointer
const DIGEST_PART_SEPARATOR = "\u0000";

function sortedEntries(record: Readonly<Record<string, string>>): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (value !== undefined) {
      entries.push([key, value]);
    }
  }
  return entries;
}
function digestCarrier(canonical: string, direction: ContentDirection): ContentDocumentJson {
  return {
    type: "doc",
    profileVersion: CONTENT_PROFILE_VERSION,
    direction,
    content: [{ type: "paragraph", content: [{ type: "text", text: canonical }] }],
    sections: [],
  };
}
/** The change-detection digest of one revision's content: the profile's checksum over the canonical serialisation of the document, the placements in authored order, the alternative-text and. */
export function revisionChecksum(content: RevisionContent): string {
  const canonical = [
    serialise(content.body),
    JSON.stringify(content.mediaPlacements.map((placement) => [placement.placementId, placement.assetId])),
    JSON.stringify(sortedEntries(content.altText)),
    JSON.stringify(sortedEntries(content.captions)),
    JSON.stringify([content.sharePresentation.title ?? "", content.sharePresentation.description ?? "", content.sharePresentation.imageAssetId ?? ""]),
  ].join(DIGEST_PART_SEPARATOR);
  return checksum(digestCarrier(canonical, content.body.direction));
}
/** What a caller supplies to write one revision of one variant. */
export interface CreateRevisionInput {
  readonly revisionId: string;
  readonly variantId: string;
  readonly body: unknown;
  readonly mediaPlacements?: readonly MediaPlacement[];
  readonly altText?: Readonly<Record<string, string>>;
  readonly captions?: Readonly<Record<string, string>>;
  readonly sharePresentation?: SharePresentation;
  readonly authorPrincipalId: string;
  readonly at?: Temporal.Instant;
}
/** The outcome of writing a revision: the stored revision, or every issue that refused it. */
export type CreateRevisionResult = { readonly status: "created"; readonly revision: ContentRevision } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Writes one revision: it validates the authored document against the content profile, proves every placement is identified by the revision and carries alternative text, computes the. */
export function createRevision(input: CreateRevisionInput): CreateRevisionResult {
  const issues: DocumentIssue[] = [];
  if (isBlank(input.revisionId)) {
    issues.push({ path: "revisionId", message: "A revision states its own identity." });
  }
  if (isBlank(input.variantId)) {
    issues.push({ path: "variantId", message: "A revision belongs to a variant." });
  }
  if (isBlank(input.authorPrincipalId)) {
    issues.push({
      path: "authorPrincipalId",
      message: "A revision names the principal who wrote it.",
    });
  }
  const parsed = parseDocument(input.body);
  if (parsed.status === "invalid") {
    return { status: "invalid", issues: [...issues, ...parsed.issues] };
  }
  const placements = input.mediaPlacements ?? [];
  const altText = input.altText ?? {};
  const captions = input.captions ?? {};
  const placementIds = new Set<string>();
  for (const placement of placements) {
    if (isBlank(placement.placementId)) {
      issues.push({
        path: "mediaPlacements",
        message: "A placement states its own identity, because captions and alternative text key on it.",
      });
    } else if (placementIds.has(placement.placementId)) {
      issues.push({
        path: `mediaPlacements.${placement.placementId}`,
        message: `Two placements share the identity "${placement.placementId}".`,
      });
    } else {
      placementIds.add(placement.placementId);
    }
    if (isBlank(placement.assetId)) {
      issues.push({
        path: `mediaPlacements.${placement.placementId}.assetId`,
        message: "A placement names the media asset it shows.",
      });
    }
  }
  for (const placementId of placementIds) {
    const alternative = altText[placementId];
    if (alternative === undefined || isBlank(alternative)) {
      issues.push({
        path: `altText.${placementId}`,
        message: "Every image and video placement states the alternative text a reader is given when the media itself cannot be seen.",
      });
    }
  }
  for (const key of Object.keys(altText)) {
    if (!placementIds.has(key)) {
      issues.push({
        path: `altText.${key}`,
        message: "Alternative text names a placement this revision does not place.",
      });
    }
  }
  for (const key of Object.keys(captions)) {
    if (!placementIds.has(key)) {
      issues.push({
        path: `captions.${key}`,
        message: "A caption names a placement this revision does not place.",
      });
    }
  }
  if (issues.length > 0) {
    return { status: "invalid", issues };
  }
  const content: RevisionContent = {
    body: parsed.document,
    sections: parsed.document.sections,
    mediaPlacements: placements,
    captions,
    altText,
    sharePresentation: input.sharePresentation ?? {},
  };
  const revision: ContentRevision = {
    ...content,
    revisionId: input.revisionId,
    variantId: input.variantId,
    contentChecksum: revisionChecksum(content),
    authorPrincipalId: input.authorPrincipalId,
    createdAt: input.at ?? now(),
  };
  return { status: "created", revision };
}
/** The new identity a restore gives the revision it copies. */
export interface RestoreDraftInput {
  readonly authorPrincipalId: string;
  readonly revisionId: string;
  readonly at?: Temporal.Instant;
}
/** Restores a revision as a new draft: a new identity, a new author and a new creation instant, with the body, sections, placements, captions, alternative text, share presentation and content. */
export function restoreAsNewDraft(revision: ContentRevision, restored: RestoreDraftInput): ContentRevision {
  return {
    body: revision.body,
    sections: revision.sections,
    mediaPlacements: revision.mediaPlacements,
    captions: revision.captions,
    altText: revision.altText,
    sharePresentation: revision.sharePresentation,
    revisionId: restored.revisionId,
    variantId: revision.variantId,
    contentChecksum: revision.contentChecksum,
    authorPrincipalId: restored.authorPrincipalId,
    createdAt: restored.at ?? now(),
  };
}
/** Points the variant's draft at a revision of that same variant, and changes nothing else: the candidate pointer and the release head are carried through untouched, because saving a draft. */
export function applyDraftRevision(variant: ContentVariant, revision: ContentRevision): VariantChange {
  if (isBlank(revision.revisionId)) {
    return {
      status: "invalid",
      issues: [{ path: "revision.revisionId", message: "A draft revision states its own identity." }],
    };
  }
  if (revision.variantId !== variant.variantId) {
    return {
      status: "invalid",
      issues: [
        {
          path: "revision.variantId",
          message: "A draft revision belongs to the variant it was written for; this one belongs to another.",
        },
      ],
    };
  }
  return { status: "applied", variant: { ...variant, draftRevisionId: revision.revisionId } };
}
// Candidates: one freeze, one review round, no re-review
/** What a caller supplies to freeze a revision for review. */
export interface FreezeCandidateInput {
  readonly candidateId: string;
  readonly at?: Temporal.Instant;
}
/** The outcome of freezing a revision: the candidate and the variant pointing at it, or the issues. */
export type FreezeCandidateResult =
  | {
      readonly status: "frozen";
      readonly candidate: ContentCandidate;
      readonly variant: ContentVariant;
    }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Freezes one exact revision for review: the candidate records that revision's identity and its own content digest, so what a reviewer reads cannot drift afterwards, and the variant points at. */
export function freezeCandidate(variant: ContentVariant, revision: ContentRevision, input: FreezeCandidateInput): FreezeCandidateResult {
  const issues: DocumentIssue[] = [];
  if (isBlank(input.candidateId)) {
    issues.push({ path: "candidateId", message: "A candidate states its own identity." });
  }
  if (revision.variantId !== variant.variantId) {
    issues.push({
      path: "revision.variantId",
      message: "A candidate freezes a revision of its own variant; this revision belongs to another.",
    });
  }
  const parsed = parseDocument(revision.body);
  if (parsed.status === "invalid") {
    return { status: "invalid", issues: [...issues, ...parsed.issues] };
  }
  if (issues.length > 0) {
    return { status: "invalid", issues };
  }
  const candidate: ContentCandidate = {
    candidateId: input.candidateId,
    variantId: variant.variantId,
    revisionId: revision.revisionId,
    contentChecksum: revision.contentChecksum,
    frozenAt: input.at ?? now(),
    reviewRound: REVIEW_STEPS_PER_CANDIDATE,
  };
  return {
    status: "frozen",
    candidate,
    variant: { ...variant, candidateId: candidate.candidateId },
  };
}
/** Applies a reviewer's answer to the frozen candidate. */
export function applyReviewDecision(variant: ContentVariant, decision: ReviewDecision): VariantChange {
  if (variant.candidateId === undefined) {
    return {
      status: "invalid",
      issues: [
        {
          path: "candidateId",
          message: "A review decision answers a frozen candidate, and this variant has nothing under review.",
        },
      ],
    };
  }
  if (!isOneOf(REVIEW_DECISIONS, decision)) {
    return {
      status: "invalid",
      issues: [
        {
          path: "decision",
          message: `A review decision is ${REVIEW_DECISIONS.join(", ")}.`,
        },
      ],
    };
  }
  if (decision === "approved") {
    return { status: "applied", variant };
  }
  return { status: "applied", variant: { ...variant, candidateId: undefined } };
}
// Releases: one publication of one revision, and the head it advances
/** What a caller supplies to publish one revision of one variant. */
export interface CreateReleaseInput {
  readonly releaseId: string;
  readonly variant: ContentVariant;
  readonly revision: ContentRevision;
  readonly reach?: ReleaseReach;
  readonly at?: Temporal.Instant;
}
/** The outcome of publishing a revision: the release, or every issue that refused it. */
export type CreateReleaseResult = { readonly status: "created"; readonly release: Release } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Builds one release of one revision: the variant's own audience and locale are copied onto it, the revision's digest is recorded, and the reach defaults to `not-public` so publishing an. */
export function createRelease(input: CreateReleaseInput): CreateReleaseResult {
  const issues: DocumentIssue[] = [];
  const { variant, revision } = input;
  if (isBlank(input.releaseId)) {
    issues.push({ path: "releaseId", message: "A release states its own identity." });
  }
  if (revision.variantId !== variant.variantId) {
    issues.push({
      path: "revision.variantId",
      message: "A release publishes a revision of its own variant; this revision belongs to another.",
    });
  }
  const reach = input.reach ?? "not-public";
  if (!isOneOf(RELEASE_REACH_VALUES, reach)) {
    issues.push({
      path: "reach",
      message: `Reach is one of ${RELEASE_REACH_VALUES.join(", ")}.`,
    });
  }
  if (issues.length > 0) {
    return { status: "invalid", issues };
  }
  return {
    status: "created",
    release: {
      releaseId: input.releaseId,
      variantId: variant.variantId,
      revisionId: revision.revisionId,
      audience: variant.audience,
      locale: variant.locale,
      publishedAt: input.at ?? now(),
      reach,
      contentChecksum: revision.contentChecksum,
    },
  };
}
/** What happened to one variant's attempt to release: this variant's release, or the reason this variant did not release. */
export type ReleaseOutcome = { readonly status: "released"; readonly release: Release } | { readonly status: "failed"; readonly reason: string };
/** Applies one variant's release outcome to that variant. */
export function applyReleaseOutcome(variant: ContentVariant, outcome: ReleaseOutcome, currentHead?: Release): VariantChange {
  if (outcome.status === "failed") {
    return { status: "applied", variant };
  }
  const { release } = outcome;
  const issues: DocumentIssue[] = [];
  if (isBlank(release.releaseId)) {
    issues.push({
      path: "release.releaseId",
      message: "A release outcome states the release it produced.",
    });
  }
  if (release.variantId !== variant.variantId) {
    issues.push({
      path: "release.variantId",
      message: "A release belongs to the variant that published it; this one belongs to another variant.",
    });
  }
  if (release.audience !== variant.audience) {
    issues.push({
      path: "release.audience",
      message: "A release serves the audience of the variant it publishes, and this variant serves another.",
    });
  }
  if (!localeTagsMatch(release.locale.tag, variant.locale.tag) || release.locale.direction !== variant.locale.direction) {
    issues.push({
      path: "release.locale",
      message: "A release publishes the exact content locale of its variant, and this variant is another locale.",
    });
  }
  if (!isOneOf(RELEASE_REACH_VALUES, release.reach)) {
    issues.push({
      path: "release.reach",
      message: `Reach is one of ${RELEASE_REACH_VALUES.join(", ")}.`,
    });
  }
  if (issues.length > 0) {
    return { status: "invalid", issues };
  }
  if (currentHead !== undefined && currentHead.releaseId === release.releaseId) {
    return { status: "applied", variant };
  }
  const advanced: ContentVariant = { ...variant, releaseHeadId: release.releaseId };
  if (currentHead === undefined) {
    return { status: "applied", variant: advanced };
  }
  return {
    status: "applied",
    variant: advanced,
    supersededRelease: { ...currentHead, supersededBy: release.releaseId },
  };
}
/** Whether a release still publishes exactly what a revision holds: true only when the revision belongs to the released variant and carries the released digest. */
export function isReleaseUnchanged(release: Release, revision: ContentRevision): boolean {
  return release.variantId === revision.variantId && release.contentChecksum === revision.contentChecksum;
}
// Translation staleness: reported, never acted on
/** The source edition a translation is compared against: the source variant, and the revision that variant currently holds as the caller resolved it. */
export interface TranslationSourceContext {
  readonly sourceVariant: ContentVariant;
  readonly sourceRevision: ContentRevision;
}
/** The three answers {@link translationStaleness} gives. */
export type TranslationStaleness =
  | { readonly status: "none" }
  | {
      readonly status: "fresh";
      readonly sourceRevisionId: string;
      readonly sourceUpdatedAt: Temporal.Instant;
    }
  | {
      readonly status: "stale";
      readonly sourceRevisionId: string;
      readonly sourceUpdatedAt: Temporal.Instant;
      readonly translatedFromRevisionId: string;
    };
/** Whether a manual translation still reflects its source. */
export function translationStaleness(variant: ContentVariant, context: TranslationSourceContext): TranslationStaleness {
  const recorded = variant.translationSource;
  if (recorded === undefined) {
    return { status: "none" };
  }
  const sourceIsNamed = recorded.variantId === context.sourceVariant.variantId;
  const revisionIsCurrent = recorded.revisionId === context.sourceRevision.revisionId;
  if (sourceIsNamed && revisionIsCurrent) {
    return {
      status: "fresh",
      sourceRevisionId: context.sourceRevision.revisionId,
      sourceUpdatedAt: context.sourceRevision.createdAt,
    };
  }
  return {
    status: "stale",
    sourceRevisionId: context.sourceRevision.revisionId,
    sourceUpdatedAt: context.sourceRevision.createdAt,
    translatedFromRevisionId: recorded.revisionId,
  };
}
