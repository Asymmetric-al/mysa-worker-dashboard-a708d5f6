import type { Temporal } from "temporal-polyfill";
import type { SourceReference } from "@/lib/ids";
import { CONTENT_DIRECTIONS, CONTENT_PROFILE_VERSION, checksum, parseDocument, serialise, type ContentDirection, type ContentDocumentJson, type ContentSection, type DocumentIssue } from "@/modules/content/document";
import { now } from "@/modules/time/clock";
export const VARIANT_FAMILIES = ["update", "worker-page", "project-page"] as const;
export type VariantFamily = (typeof VARIANT_FAMILIES)[number];
export const VARIANT_AUDIENCES = ["public", "approved-supporter"] as const;
export type VariantAudience = (typeof VARIANT_AUDIENCES)[number];
export const CONTENT_KINDS = ["update", "prayer", "story", "milestone"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const RELEASE_REACH_VALUES = ["not-public", "link-public", "listed"] as const;
export type ReleaseReach = (typeof RELEASE_REACH_VALUES)[number];
export const REVIEW_STEPS_PER_CANDIDATE = 1 as const;
export const REVIEW_DECISIONS = ["approved", "changes-requested", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type ContentDocument = { readonly documentId: string; readonly family: VariantFamily; readonly kind: ContentKind; readonly sourceSubject: SourceReference; readonly siteId: string; readonly givingBinding?: SourceReference; readonly managedFields: Readonly<Record<string, string>> };
export type VariantLocale = { readonly tag: string; readonly direction: ContentDirection };
export type TranslationSource = { readonly variantId: string; readonly revisionId: string };
export type ContentVariant = { readonly variantId: string; readonly documentId: string; readonly audience: VariantAudience; readonly locale: VariantLocale; readonly draftRevisionId?: string; readonly candidateId?: string; readonly releaseHeadId?: string; readonly translationSource?: TranslationSource };
export type MediaPlacement = { readonly placementId: string; readonly assetId: string };
export type SharePresentation = { readonly title?: string; readonly description?: string; readonly imageAssetId?: string };
type TextRecord = Readonly<Record<string, string>>;
export type RevisionContent = { readonly body: ContentDocumentJson; readonly sections: readonly ContentSection[]; readonly mediaPlacements: readonly MediaPlacement[]; readonly captions: TextRecord; readonly altText: TextRecord; readonly sharePresentation: SharePresentation };
/** One authored revision of one variant, identified by its `revisionId` and its `variantId`: its `contentChecksum` is 32-bit change detection that can collide, so it is never an identity and never the sole comparison of two renditions. */
export type ContentRevision = RevisionContent & { readonly revisionId: string; readonly variantId: string; readonly contentChecksum: string; readonly authorPrincipalId: string; readonly createdAt: Temporal.Instant };
/** A frozen revision awaiting review, identified by its `candidateId` and the `revisionId` it froze: its `contentChecksum` is 32-bit change detection that can collide, never the sole comparison of two renditions. */
export type ContentCandidate = { readonly candidateId: string; readonly variantId: string; readonly revisionId: string; readonly contentChecksum: string; readonly frozenAt: Temporal.Instant; readonly reviewRound: typeof REVIEW_STEPS_PER_CANDIDATE };
export interface Release {
  readonly releaseId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly publishedAt: Temporal.Instant;
  readonly reach: ReleaseReach;
  /** Change detection only: 32 bits that can collide. The release is identified by `releaseId`, `variantId` and `revisionId`, so a matching digest is never the sole comparison of two renditions. */
  readonly contentChecksum: string;
  readonly withdrawnAt?: Temporal.Instant;
  readonly supersededBy?: string;
}
export type VariantChange = { readonly status: "applied"; readonly variant: ContentVariant; readonly supersededRelease?: Release } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
export type VariantKey = { readonly documentId: string; readonly audience: VariantAudience; readonly locale: VariantLocale };
export type VariantKeyUniqueness = { readonly status: "unique" } | { readonly status: "duplicate"; readonly conflictingVariantId: string };
const isBlank = (value: string): boolean => value.trim().length === 0;
const isOneOf = <T extends string>(allowed: readonly T[], value: unknown): value is T => allowed.some((entry) => entry === value);
const LANGUAGE_SUBTAG = /^[A-Za-z]{2,3}$/u;
const REGISTERED_LANGUAGE_SUBTAG = /^[A-Za-z]{5,8}$/u;
const GENERIC_SUBTAG = /^[A-Za-z0-9]{1,8}$/u;
function localeTagProblem(tag: string): string | undefined {
  if (isBlank(tag)) return "A variant states its content locale as a BCP-47 language tag, for example en, fr-CA or ar.";
  const [language, ...subtags] = tag.split("-");
  if (language === undefined || !(LANGUAGE_SUBTAG.test(language) || REGISTERED_LANGUAGE_SUBTAG.test(language))) return `"${tag}" does not begin with a two- or three-letter language subtag (or a registered five- to eight-letter one), so it is not a BCP-47 language tag.`;
  for (const subtag of subtags) if (!GENERIC_SUBTAG.test(subtag)) return `"${tag}" carries a subtag that is not one to eight alphanumeric characters, so it is not a BCP-47 language tag.`;
  return undefined;
}
const localeTagsMatch = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
const ADMITTED_AUDIENCES: ReadonlyMap<VariantFamily, readonly VariantAudience[]> = new Map<VariantFamily, readonly VariantAudience[]>([
  ["update", ["public", "approved-supporter"]],
  ["worker-page", ["public"]],
  ["project-page", ["public"]],
]);
export const admittedAudiences = (family: VariantFamily): readonly VariantAudience[] => ADMITTED_AUDIENCES.get(family) ?? [];
export const variantKeyAllowed = (family: VariantFamily, audience: VariantAudience): boolean => ADMITTED_AUDIENCES.get(family)?.includes(audience) ?? false;
/** Whether a variant key — one document, one audience, one exact locale tag — is free among the document's existing variants, or which variant already holds it. */
export function assertVariantKeyUnique(existing: readonly ContentVariant[], key: VariantKey): VariantKeyUniqueness {
  const holder = existing.find((variant) => variant.documentId === key.documentId && variant.audience === key.audience && localeTagsMatch(variant.locale.tag, key.locale.tag));
  return holder === undefined ? { status: "unique" } : { status: "duplicate", conflictingVariantId: holder.variantId };
}
export type TranslationSourceEvidence = { readonly variant: ContentVariant; readonly revision: ContentRevision };
export type CreateVariantInput = { readonly variantId: string; readonly document: ContentDocument; readonly audience: VariantAudience; readonly locale: VariantLocale; readonly existingVariants: readonly ContentVariant[]; readonly translationSource?: TranslationSourceEvidence };
export type CreateVariantResult = { readonly status: "created"; readonly variant: ContentVariant } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Creates one working variant of one document, with no draft, candidate or release yet. */ export function createVariant(input: CreateVariantInput): CreateVariantResult {
  const issues: DocumentIssue[] = [];
  const { document } = input;
  if (isBlank(input.variantId)) issues.push({ path: "variantId", message: "A variant states its own identity." });
  if (isBlank(document.documentId)) issues.push({ path: "document.documentId", message: "A variant belongs to a document with its own identity." });
  if (!isOneOf(VARIANT_FAMILIES, document.family)) issues.push({ path: "document.family", message: `A content document is one of ${VARIANT_FAMILIES.join(", ")}.` });
  if (!isOneOf(CONTENT_KINDS, document.kind)) issues.push({ path: "document.kind", message: `An Update is one of ${CONTENT_KINDS.join(", ")}.` });
  if (isBlank(document.siteId)) issues.push({ path: "document.siteId", message: "A document names the site it belongs to, because locale fallback resolves within one site." });
  if (isBlank(document.sourceSubject.system) || isBlank(document.sourceSubject.reference)) issues.push({ path: "document.sourceSubject", message: "A document states the source system and its opaque reference for the subject it belongs to." });
  if (document.givingBinding !== undefined && (isBlank(document.givingBinding.system) || isBlank(document.givingBinding.reference))) issues.push({ path: "document.givingBinding", message: "A giving binding is a source-qualified reference; an unqualified one would name no Designation." });
  if (Object.values(document.managedFields).some((value) => typeof value !== "string")) issues.push({ path: "document.managedFields", message: "A managed field carries the source's text value, stated as a string." });
  if (!isOneOf(VARIANT_AUDIENCES, input.audience)) issues.push({ path: "audience", message: `A variant serves one of ${VARIANT_AUDIENCES.join(", ")}.` });
  else if (!variantKeyAllowed(document.family, input.audience)) {
    const admitted = admittedAudiences(document.family);
    issues.push({ path: "audience", message: admitted.length === 0 ? `"${document.family}" is not a content family, so it admits no audience.` : `A ${document.family} admits ${admitted.join(" and ")} editions only; ${input.audience} is not one of them.` });
  }
  const localeProblem = localeTagProblem(input.locale.tag);
  if (localeProblem !== undefined) issues.push({ path: "locale.tag", message: localeProblem });
  if (!isOneOf(CONTENT_DIRECTIONS, input.locale.direction)) issues.push({ path: "locale.direction", message: `An edition states the direction it is read in: ${CONTENT_DIRECTIONS.join(" or ")}.` });
  const source = input.translationSource;
  if (source !== undefined) {
    if (source.variant.variantId === input.variantId) issues.push({ path: "translationSource", message: "A translation copies another edition of the document; it cannot name itself as its source." });
    if (source.variant.documentId !== document.documentId) issues.push({ path: "translationSource.variantId", message: "A translation copies a revision of the same document; the named source belongs to another document." });
    if (source.revision.variantId !== source.variant.variantId) issues.push({ path: "translationSource.revisionId", message: "The named source revision belongs to another variant, so it is not the revision the translation copies." });
    if (isBlank(source.revision.revisionId)) issues.push({ path: "translationSource.revisionId", message: "A translation records the exact source revision it copied." });
  }
  const uniqueness = assertVariantKeyUnique(input.existingVariants, { documentId: document.documentId, audience: input.audience, locale: input.locale });
  if (uniqueness.status === "duplicate") issues.push({ path: "locale.tag", message: `This document already has a ${input.audience} edition in ${input.locale.tag} (${uniqueness.conflictingVariantId}).` });
  if (issues.length > 0) return { status: "invalid", issues };
  const variant: ContentVariant = {
    variantId: input.variantId,
    documentId: document.documentId,
    audience: input.audience,
    locale: { tag: input.locale.tag, direction: input.locale.direction },
    ...(source === undefined ? {} : { translationSource: { variantId: source.variant.variantId, revisionId: source.revision.revisionId } }),
  };
  return { status: "created", variant };
}
const DIGEST_PART_SEPARATOR = "\u0000";
function sortedEntries(record: Readonly<Record<string, string>>): ReadonlyArray<readonly [string, string]> {
  return Object.keys(record)
    .sort()
    .flatMap((key) => {
      const value = record[key];
      return value === undefined ? [] : [[key, value] as const];
    });
}
const digestCarrier = (canonical: string, direction: ContentDirection): ContentDocumentJson => ({ type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction, content: [{ type: "paragraph", content: [{ type: "text", text: canonical }] }], sections: [] });
/** The change-detection digest of one revision's content: the profile's checksum over the canonical serialisation of the document, the placements in authored order, the alternative text and captions those placements carry, and the share presentation's title, description and image asset. It is 32 bits and collidable, so identities come from `variantId` and `revisionId`, and it is never the sole comparison of two renditions. */
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
export type CreateRevisionResult = { readonly status: "created"; readonly revision: ContentRevision } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Writes one revision: it validates the authored document against the content profile, proves every placement is identified by the revision and carries alternative text, computes the 32-bit change-detection digest it records and returns the created revision. */
export function createRevision(input: CreateRevisionInput): CreateRevisionResult {
  const issues: DocumentIssue[] = [];
  if (isBlank(input.revisionId)) issues.push({ path: "revisionId", message: "A revision states its own identity." });
  if (isBlank(input.variantId)) issues.push({ path: "variantId", message: "A revision belongs to a variant." });
  if (isBlank(input.authorPrincipalId)) issues.push({ path: "authorPrincipalId", message: "A revision names the principal who wrote it." });
  const parsed = parseDocument(input.body);
  if (parsed.status === "invalid") return { status: "invalid", issues: [...issues, ...parsed.issues] };
  const placements = input.mediaPlacements ?? [];
  const altText = input.altText ?? {};
  const captions = input.captions ?? {};
  const placementIds = new Set<string>();
  for (const placement of placements) {
    if (isBlank(placement.placementId)) issues.push({ path: "mediaPlacements", message: "A placement states its own identity, because captions and alternative text key on it." });
    else if (placementIds.has(placement.placementId)) issues.push({ path: `mediaPlacements.${placement.placementId}`, message: `Two placements share the identity "${placement.placementId}".` });
    else placementIds.add(placement.placementId);
    if (isBlank(placement.assetId)) issues.push({ path: `mediaPlacements.${placement.placementId}.assetId`, message: "A placement names the media asset it shows." });
  }
  for (const placementId of placementIds) if (isBlank(altText[placementId] ?? "")) issues.push({ path: `altText.${placementId}`, message: "Every image and video placement states the alternative text a reader is given when the media itself cannot be seen." });
  for (const key of Object.keys(altText)) if (!placementIds.has(key)) issues.push({ path: `altText.${key}`, message: "Alternative text names a placement this revision does not place." });
  for (const key of Object.keys(captions)) if (!placementIds.has(key)) issues.push({ path: `captions.${key}`, message: "A caption names a placement this revision does not place." });
  if (issues.length > 0) return { status: "invalid", issues };
  const content: RevisionContent = { body: parsed.document, sections: parsed.document.sections, mediaPlacements: placements, captions, altText, sharePresentation: input.sharePresentation ?? {} };
  const revision: ContentRevision = { ...content, revisionId: input.revisionId, variantId: input.variantId, contentChecksum: revisionChecksum(content), authorPrincipalId: input.authorPrincipalId, createdAt: input.at ?? now() };
  return { status: "created", revision };
}
export type RestoreDraftInput = { readonly authorPrincipalId: string; readonly revisionId: string; readonly at?: Temporal.Instant };
/** Restores a revision as a new draft: a new identity, a new author and a new creation instant, with the body, sections, placements, captions, alternative text, share presentation and content checksum carried through unchanged. */
export const restoreAsNewDraft = (revision: ContentRevision, restored: RestoreDraftInput): ContentRevision => ({ ...revision, revisionId: restored.revisionId, authorPrincipalId: restored.authorPrincipalId, createdAt: restored.at ?? now() });
/** Points the variant's draft at a revision of that same variant, and changes nothing else: the candidate pointer and the release head are carried through untouched, because saving a draft neither submits it for review nor releases it. */
/** Every archive transition answers the same way: the problems it found, or the change it applied. */
const transition = (issues: readonly DocumentIssue[], applied: () => VariantChange): VariantChange => (issues.length === 0 ? applied() : { status: "invalid", issues });
const revisionProblem = (failed: boolean, path: string, message: string): DocumentIssue[] => (failed ? [{ path, message }] : []);
export function applyDraftRevision(variant: ContentVariant, revision: ContentRevision): VariantChange {
  return transition(
    [...revisionProblem(isBlank(revision.revisionId), "revision.revisionId", "A draft revision states its own identity."), ...revisionProblem(revision.variantId !== variant.variantId, "revision.variantId", "A draft revision belongs to the variant it was written for; this one belongs to another.")],
    () => ({ status: "applied", variant: { ...variant, draftRevisionId: revision.revisionId } }),
  );
}
export type FreezeCandidateInput = { readonly candidateId: string; readonly at?: Temporal.Instant };
export type FreezeCandidateResult = { readonly status: "frozen"; readonly candidate: ContentCandidate; readonly variant: ContentVariant } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Freezes one exact revision for review: the candidate records the identity of the revision it freezes and that revision's 32-bit change-detection digest, so what a reviewer reads cannot drift afterwards, and the variant points at the candidate that froze it. */
export function freezeCandidate(variant: ContentVariant, revision: ContentRevision, input: FreezeCandidateInput): FreezeCandidateResult {
  const issues: DocumentIssue[] = [];
  if (isBlank(input.candidateId)) issues.push({ path: "candidateId", message: "A candidate states its own identity." });
  if (revision.variantId !== variant.variantId) issues.push({ path: "revision.variantId", message: "A candidate freezes a revision of its own variant; this revision belongs to another." });
  const parsed = parseDocument(revision.body);
  if (parsed.status === "invalid") return { status: "invalid", issues: [...issues, ...parsed.issues] };
  if (issues.length > 0) return { status: "invalid", issues };
  const candidate: ContentCandidate = { candidateId: input.candidateId, variantId: variant.variantId, revisionId: revision.revisionId, contentChecksum: revision.contentChecksum, frozenAt: input.at ?? now(), reviewRound: REVIEW_STEPS_PER_CANDIDATE };
  return { status: "frozen", candidate, variant: { ...variant, candidateId: candidate.candidateId } };
}
export function applyReviewDecision(variant: ContentVariant, decision: ReviewDecision): VariantChange {
  const issues = [...revisionProblem(variant.candidateId === undefined, "candidateId", "A review decision answers a frozen candidate, and this variant has nothing under review."), ...revisionProblem(!isOneOf(REVIEW_DECISIONS, decision), "decision", `A review decision is ${REVIEW_DECISIONS.join(", ")}.`)];
  return transition(issues, () => (decision === "approved" ? { status: "applied", variant } : { status: "applied", variant: { ...variant, candidateId: undefined } }));
}
export type CreateReleaseInput = { readonly releaseId: string; readonly variant: ContentVariant; readonly revision: ContentRevision; readonly reach?: ReleaseReach; readonly at?: Temporal.Instant };
export type CreateReleaseResult = { readonly status: "created"; readonly release: Release } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
/** Builds one release of one revision: the variant's own audience and locale are copied onto it, the revision's 32-bit change-detection digest is recorded, and the reach defaults to `not-public` so publishing an edition never reaches a reader by itself; putting an edition in front of readers is a separate, explicit decision. */
export function createRelease(input: CreateReleaseInput): CreateReleaseResult {
  const issues: DocumentIssue[] = [];
  const { variant, revision } = input;
  if (isBlank(input.releaseId)) issues.push({ path: "releaseId", message: "A release states its own identity." });
  if (revision.variantId !== variant.variantId) issues.push({ path: "revision.variantId", message: "A release publishes a revision of its own variant; this revision belongs to another." });
  const reach = input.reach ?? "not-public";
  if (!isOneOf(RELEASE_REACH_VALUES, reach)) issues.push({ path: "reach", message: `Reach is one of ${RELEASE_REACH_VALUES.join(", ")}.` });
  if (issues.length > 0) return { status: "invalid", issues };
  return { status: "created", release: { releaseId: input.releaseId, variantId: variant.variantId, revisionId: revision.revisionId, audience: variant.audience, locale: variant.locale, publishedAt: input.at ?? now(), reach, contentChecksum: revision.contentChecksum } };
}
export type ReleaseOutcome = { readonly status: "released"; readonly release: Release } | { readonly status: "failed"; readonly reason: string };
// A release of the very revision the candidate froze consumes that candidate, because a candidate is identified by the revision it froze; a release of any other revision leaves it untouched, so a newer frozen submission beside an older release still reads as a submission.
const releaseConsumesCandidate = (variant: ContentVariant, release: Release): boolean => variant.candidateId !== undefined && variant.candidateId === release.revisionId;
export function applyReleaseOutcome(variant: ContentVariant, outcome: ReleaseOutcome, currentHead?: Release): VariantChange {
  if (outcome.status === "failed") return { status: "applied", variant };
  const { release } = outcome;
  const issues: DocumentIssue[] = [];
  if (isBlank(release.releaseId)) issues.push({ path: "release.releaseId", message: "A release outcome states the release it produced." });
  if (release.variantId !== variant.variantId) issues.push({ path: "release.variantId", message: "A release belongs to the variant that published it; this one belongs to another variant." });
  if (release.audience !== variant.audience) issues.push({ path: "release.audience", message: "A release serves the audience of the variant it publishes, and this variant serves another." });
  if (!localeTagsMatch(release.locale.tag, variant.locale.tag) || release.locale.direction !== variant.locale.direction) issues.push({ path: "release.locale", message: "A release publishes the exact content locale of its variant, and this variant is another locale." });
  if (!isOneOf(RELEASE_REACH_VALUES, release.reach)) issues.push({ path: "release.reach", message: `Reach is one of ${RELEASE_REACH_VALUES.join(", ")}.` });
  if (issues.length > 0) return { status: "invalid", issues };
  if (currentHead !== undefined && currentHead.releaseId === release.releaseId) return { status: "applied", variant };
  const advanced: ContentVariant = releaseConsumesCandidate(variant, release) ? { ...variant, releaseHeadId: release.releaseId, candidateId: undefined } : { ...variant, releaseHeadId: release.releaseId };
  return currentHead === undefined ? { status: "applied", variant: advanced } : { status: "applied", variant: advanced, supersededRelease: { ...currentHead, supersededBy: release.releaseId } };
}
/** Whether the release publishes the content the revision holds, as change detection for the comparison surface: one variant and one matching 32-bit digest, which can collide, so this answer is never the sole comparison of two renditions — the release's own `releaseId` and `revisionId` are what identify the revision it published. */
export const isReleaseUnchanged = (release: Release, revision: ContentRevision): boolean => release.variantId === revision.variantId && release.contentChecksum === revision.contentChecksum;
export type TranslationSourceContext = { readonly sourceVariant: ContentVariant; readonly sourceRevision: ContentRevision };
export type TranslationStaleness =
  | { readonly status: "none" }
  | { readonly status: "fresh"; readonly sourceRevisionId: string; readonly sourceUpdatedAt: Temporal.Instant }
  | { readonly status: "stale"; readonly sourceRevisionId: string; readonly sourceUpdatedAt: Temporal.Instant; readonly translatedFromRevisionId: string };
export function translationStaleness(variant: ContentVariant, context: TranslationSourceContext): TranslationStaleness {
  const recorded = variant.translationSource;
  if (recorded === undefined) return { status: "none" };
  if (recorded.variantId === context.sourceVariant.variantId && recorded.revisionId === context.sourceRevision.revisionId) return { status: "fresh", sourceRevisionId: context.sourceRevision.revisionId, sourceUpdatedAt: context.sourceRevision.createdAt };
  return { status: "stale", sourceRevisionId: context.sourceRevision.revisionId, sourceUpdatedAt: context.sourceRevision.createdAt, translatedFromRevisionId: recorded.revisionId };
}
