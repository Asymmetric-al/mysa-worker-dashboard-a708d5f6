/**
 * Draft, candidate and release identity for every Update and every Worker or Project Page: the one
 * place in the application that decides what a variant is, that a candidate freezes an exact
 * revision, that a release supersedes a prior head, and that a manual translation has gone stale.
 *
 * One content identity, never two. A document owns its identity; a variant identifies one permitted
 * audience and one exact content locale of that document; a revision is one immutable authored
 * state of a variant; a candidate freezes one revision for review; a release publishes one revision
 * to one audience and locale. Draft, candidate, release and withdrawal therefore never merge: a
 * draft save moves `draftRevisionId` and touches neither `candidateId` nor `releaseHeadId`, and a
 * release is a record of its own rather than a status flag on a revision. Nothing here stores the
 * reach of a publication, builds a notice, authorises a preview or renders content — `reach.ts`,
 * `notice.ts`, `preview.ts` and `render.ts` own those jobs — and the `Release` record carries `reach`
 * through unchanged.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Content module" row: `src/modules/content/*` with the key interfaces
 *   `createVariant()` and `freezeCandidate()`, and the responsibilities "document schema, validation,
 *   serialisation, static rendering, variants, reach, locale fallback, notice resolution".
 * - AAP 0.6.2 records *Content document*, *Content variant*, *Content revision*, *Content candidate*
 *   and *Release*, whose field names are reproduced verbatim so the data service's own declarations
 *   stay structurally assignable.
 * - AAP 0.8.5: "One canonical content identity per Update or Page; a working variant identifies
 *   document, permitted audience, exact content locale and revision; a candidate freezes the exact
 *   revisions and later edits cannot alter it"; "Synthesis results are reported per selected variant;
 *   if one release succeeds and a sibling fails, the success and the sibling's prior-good permitted
 *   head are both preserved"; "a CMS-style save is not a release".
 * - AAP 0.8.6: "Each locale edition and each Update variant has its own draft, candidate and release;
 *   editing English does not overwrite an Arabic draft or advance a French release; a manually
 *   translated draft records its source revision and staleness is shown without auto-withdrawal."
 * - AAP 0.8.7: "Review steps per candidate: exactly 1 review step, and only where contributor policy
 *   requires review — a second round happens only as a new submission, never as a silent re-review".
 * - AAP 0.9.2 (`modules/content/variant.ts` as the identity model) and criteria 9, 12 and 17, whose
 *   domain and integration tests are `tests/domain/variant-release.test.ts` and
 *   `tests/integration/publish-partial-failure.test.ts`.
 *
 * Independence is structural, not a promise. Every function here takes one variant (or one revision,
 * one candidate, one release) and answers for that one thing. There is deliberately no batch release,
 * no cross-variant loop and no rollback, so one variant's failure cannot move another variant's head:
 * a partial release keeps the sibling's prior-good head by construction.
 *
 * A release recorded here is a record of an action, not an effect. Nothing in this file sends,
 * schedules or claims to deliver anything, and publication is never presented as notification:
 * `notice.ts` and `audience/` keep provider acceptance, delivery and reading apart, and a simulated
 * publication is labelled at the point the worker triggers it, by `components/simulation-label.tsx`,
 * rather than being described here as real.
 *
 * Time is a parameter. A caller that wants an exact boundary supplies `at`; a caller that omits it
 * gets `now()` from `time/clock.ts`, the only clock in the application. This file therefore never
 * reads a machine clock, takes no seed and produces no randomness: the identity strings it stores
 * are minted by its callers through `lib/ids`.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. It
 * imports only the content profile (`document.ts`, for validation, canonical serialisation and the
 * profile's checksum), the scenario clock, and `lib`'s opaque-source-reference type. It imports no
 * store, no data service, no feature, no component and no framework — the service imports this
 * module, and the reverse import would be a cycle — and it holds no state, performs no I/O and
 * states no money, media byte or rendition.
 *
 * What arrives here is already shaped: the service validates a mutation's input with its schema
 * before calling, so the decisions this module makes are about identity — who a variant belongs to,
 * which key is free, which revision is frozen, which release is a variant's head — rather than about
 * shape. The authored document is the exception and is validated here, by the content profile, on
 * every revision it is written into and every candidate it is frozen as.
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

// ---------------------------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------------------------

/**
 * The three content families. An Update is a ministry post; a Worker Page and a Project Page are
 * guided public pages, and they are separate families because their section catalogues differ.
 */
export const VARIANT_FAMILIES = ["update", "worker-page", "project-page"] as const;

/** One content family, derived from {@link VARIANT_FAMILIES}. */
export type VariantFamily = (typeof VARIANT_FAMILIES)[number];

/**
 * The two audiences a variant may serve. An approved-supporter audience is a protected reading
 * audience: eligibility for it is resolved by `audience/` at read time and is never inferred from a
 * contact record, a gift or an email address being present.
 */
export const VARIANT_AUDIENCES = ["public", "approved-supporter"] as const;

/** One content audience, derived from {@link VARIANT_AUDIENCES}. */
export type VariantAudience = (typeof VARIANT_AUDIENCES)[number];

/** The kinds an Update may declare, as the specification names them. */
export const CONTENT_KINDS = ["update", "prayer", "story", "milestone"] as const;

/** One content kind, derived from {@link CONTENT_KINDS}. */
export type ContentKind = (typeof CONTENT_KINDS)[number];

/**
 * The three reach values a released edition may carry: not public, public but unlisted, and listed
 * publicly. The values are declared here because the `Release` record stores them; how each one is
 * enforced on a route belongs to `reach.ts`.
 */
export const RELEASE_REACH_VALUES = ["not-public", "link-public", "listed"] as const;

/** One reach value, derived from {@link RELEASE_REACH_VALUES}. */
export type ReleaseReach = (typeof RELEASE_REACH_VALUES)[number];

/**
 * How many review rounds a candidate may receive: exactly one. A candidate is frozen by review and
 * never re-reviewed, so a second round is a new submission with a new revision and a new candidate —
 * which is why the candidate record types this as the literal `1` rather than as a number.
 */
export const REVIEW_STEPS_PER_CANDIDATE = 1 as const;

/** The answers a reviewer may give to one frozen candidate. */
export const REVIEW_DECISIONS = ["approved", "changes-requested", "rejected"] as const;

/** One review answer, derived from {@link REVIEW_DECISIONS}. */
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

// ---------------------------------------------------------------------------------------------
// The records of AAP 0.6.2, with their field names verbatim
// ---------------------------------------------------------------------------------------------

/**
 * The canonical content identity: one Update or one Page, owning the facts that prose may never
 * rewrite. `sourceSubject` and `givingBinding` are opaque, source-qualified references, so no name,
 * email address or numeric id fragment can stand in for the identity another system owns.
 */
export interface ContentDocument {
  /** The canonical identity of this Update or Page. */
  readonly documentId: string;
  /** The family, which decides the permitted audiences and the admitted section catalogue. */
  readonly family: VariantFamily;
  /** The kind of Update this document is; it changes no rule below. */
  readonly kind: ContentKind;
  /** The subject the source system owns, as an opaque reference. */
  readonly sourceSubject: SourceReference;
  /** The site this document belongs to; locale fallback resolves within it. */
  readonly siteId: string;
  /**
   * The one approved giving Designation a Give placement resolves to, when the source qualifies one.
   * Absent, revoked or incompatible means *Giving unavailable* at the page surface — never a
   * fallback fund, and never a value this module invents.
   */
  readonly givingBinding?: SourceReference;
  /**
   * The managed fields the source owns — a title, a summary, a legal entity name — which are carried
   * on the record and are not rewritable through prose. Stored verbatim, never derived here.
   */
  readonly managedFields: Readonly<Record<string, string>>;
}

/**
 * One exact content locale: a BCP-47 language tag and the direction that locale is authored and read
 * in. Direction is content, not interface language, so it travels with the edition rather than being
 * inferred from the interface at render time; the language-to-direction vocabulary is `locale.ts`'s,
 * and this module does not build a second copy of it.
 */
export interface VariantLocale {
  /** The BCP-47 tag of the edition, for example `en`, `fr-CA` or `ar`. */
  readonly tag: string;
  /** The direction the edition is authored and read in. */
  readonly direction: ContentDirection;
}

/**
 * The source a manual translation was made from: the source variant and the exact revision copied.
 * It is recorded rather than resolved so staleness can be reported later without guessing which
 * revision the translator actually read.
 */
export interface TranslationSource {
  /** The variant the translation copies. */
  readonly variantId: string;
  /** The exact revision of that variant the translation copied. */
  readonly revisionId: string;
}

/**
 * One working variant: an exact (document, permitted audience, locale) key with its own pointers to a
 * draft revision, a frozen candidate and a released head. The pointers are absent until the step they
 * name has happened, so "not yet submitted" and "approved" are different states rather than one
 * nullable status.
 */
export interface ContentVariant {
  /** The identity of this audience-and-locale edition of the document. */
  readonly variantId: string;
  /** The canonical document this variant is an edition of. */
  readonly documentId: string;
  /** The audience the edition serves, which the family must permit. */
  readonly audience: VariantAudience;
  /** The exact content locale of the edition. */
  readonly locale: VariantLocale;
  /** The revision the editor is working on; a draft save moves only this pointer. */
  readonly draftRevisionId?: string;
  /** The candidate currently under review, if any; absent once a review asked for changes. */
  readonly candidateId?: string;
  /** The head release this variant currently publishes, if any; only a release moves it. */
  readonly releaseHeadId?: string;
  /** The source of a manual translation, recorded when the edition was created. */
  readonly translationSource?: TranslationSource;
}

/**
 * One media placement: the identity of the placement inside a revision and the opaque identity of the
 * asset `modules/media` owns. No rendition, byte, filename or MIME type is stored here, and a
 * placement is never a prose node, so every read of the asset still re-authorises on its own.
 */
export interface MediaPlacement {
  /** The identity this revision gives the placement; captions and alternative text key on it. */
  readonly placementId: string;
  /** The opaque identity of the asset in `modules/media`. */
  readonly assetId: string;
}

/**
 * How a released edition presents itself in a link preview. Every field is optional because the
 * managed title of the document is a valid fallback; nothing here is required to publish.
 */
export interface SharePresentation {
  /** The title a link preview states, when it differs from the managed title. */
  readonly title?: string;
  /** A short description for a link preview. */
  readonly description?: string;
  /** The opaque identity of the image a link preview uses, when one is chosen. */
  readonly imageAssetId?: string;
}

/** The authored content of one revision: exactly what the candidate freezes and the release publishes. */
export interface RevisionContent {
  /** The validated content-profile document: prose and composed sections. */
  readonly body: ContentDocumentJson;
  /** The composed sections of that document, stated on the revision as AAP 0.6.2 names them. */
  readonly sections: readonly ContentSection[];
  /** The media placed by this revision, in authored order. */
  readonly mediaPlacements: readonly MediaPlacement[];
  /** Optional visible caption per placement, keyed by `placementId`. */
  readonly captions: Readonly<Record<string, string>>;
  /** Required alternative text per placement, keyed by `placementId`. */
  readonly altText: Readonly<Record<string, string>>;
  /** How a link to this revision presents itself. */
  readonly sharePresentation: SharePresentation;
}

/**
 * One immutable authored state of one variant. A revision is never edited: a change produces a new
 * revision with its own identity, which is what lets a candidate freeze exactly what a reviewer read.
 */
export interface ContentRevision extends RevisionContent {
  /** The identity of this revision; never reused, never reissued. */
  readonly revisionId: string;
  /** The variant this revision belongs to. */
  readonly variantId: string;
  /** The change-detection digest of {@link RevisionContent}, computed by {@link revisionChecksum}. */
  readonly contentChecksum: string;
  /** The principal who authored this revision. */
  readonly authorPrincipalId: string;
  /** The scenario instant the revision was created at. */
  readonly createdAt: Temporal.Instant;
}

/**
 * One frozen candidate: the exact revision a reviewer is answering, and nothing that can drift from
 * it. It carries the revision's own checksum, so a later draft cannot silently become what was
 * approved, and its `reviewRound` is the literal `1` because a candidate is reviewed once.
 */
export interface ContentCandidate {
  /** The identity of this review submission. */
  readonly candidateId: string;
  /** The variant under review. */
  readonly variantId: string;
  /** The exact revision frozen for review. */
  readonly revisionId: string;
  /** The checksum recorded on that revision, so the frozen content is identifiable without a read. */
  readonly contentChecksum: string;
  /** The scenario instant the candidate was frozen at. */
  readonly frozenAt: Temporal.Instant;
  /** The one and only review round this candidate receives. */
  readonly reviewRound: typeof REVIEW_STEPS_PER_CANDIDATE;
}

/**
 * One publication of one revision to one audience and locale. A release is its own record, never a
 * status on a revision: withdrawing it, superseding it or publishing a sibling edition leaves the
 * revision exactly as it was.
 */
export interface Release {
  /** The identity of this publication. */
  readonly releaseId: string;
  /** The variant this release publishes. */
  readonly variantId: string;
  /** The exact revision published. */
  readonly revisionId: string;
  /** The audience this release is available to. */
  readonly audience: VariantAudience;
  /** The exact content locale published. */
  readonly locale: VariantLocale;
  /** The scenario instant the release was published at. */
  readonly publishedAt: Temporal.Instant;
  /** The reach carried through from the release; `reach.ts` decides what each value means on a route. */
  readonly reach: ReleaseReach;
  /** The published revision's checksum, so an unchanged release is a comparison rather than a guess. */
  readonly contentChecksum: string;
  /** When the edition stopped being available, if it has; a withdrawn release keeps its identity. */
  readonly withdrawnAt?: Temporal.Instant;
  /** The release that replaced this one as the variant's head, when a later release superseded it. */
  readonly supersededBy?: string;
}

// ---------------------------------------------------------------------------------------------
// The neutral outcomes this module answers with
// ---------------------------------------------------------------------------------------------

/**
 * An applied change to one variant, or the issues that refused it. Nothing here returns a bare
 * boolean: a caller that must know why a change did not happen reads the same issue shape
 * `document.ts` reports, so the authoring form presents one error vocabulary.
 */
export type VariantChange =
  | {
      readonly status: "applied";
      /** The variant after the change; on a refusal-free no-op it is the variant handed in. */
      readonly variant: ContentVariant;
      /** The prior head a release replaced, now marked `supersededBy`, for the caller to persist. */
      readonly supersededRelease?: Release;
    }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };

/** The identity a variant must hold uniquely within its document: audience and exact locale. */
export interface VariantKey {
  /** The document the variant belongs to. */
  readonly documentId: string;
  /** The audience the variant serves. */
  readonly audience: VariantAudience;
  /** The exact content locale of the variant. */
  readonly locale: VariantLocale;
}

/** Whether a variant key is free, or which existing variant already holds it. */
export type VariantKeyUniqueness =
  | { readonly status: "unique" }
  | { readonly status: "duplicate"; readonly conflictingVariantId: string };

// ---------------------------------------------------------------------------------------------
// Identity guards: a closed value, a plausible locale tag, one key per edition
// ---------------------------------------------------------------------------------------------

/** Whether a string carries nothing but whitespace, and therefore states no identity. */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Narrows a value that may have arrived from stored JSON to one member of a closed vocabulary, so a
 * value outside the vocabulary is refused by name rather than coerced to a default.
 */
function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return allowed.some((entry) => entry === value);
}

/** A language subtag: an ISO 639 two- or three-letter code. */
const LANGUAGE_SUBTAG = /^[A-Za-z]{2,3}$/u;

/** A registered language subtag: the five- to eight-letter range RFC 5646 reserves for them. */
const REGISTERED_LANGUAGE_SUBTAG = /^[A-Za-z]{5,8}$/u;

/** Any other subtag these editions state: one to eight alphanumeric characters. */
const GENERIC_SUBTAG = /^[A-Za-z0-9]{1,8}$/u;

/**
 * Why a stored or submitted locale tag is not a plausible BCP-47 language tag, or `undefined` when it
 * is. This is a shape check — a language subtag followed by hyphen-separated subtags of one to eight
 * alphanumeric characters, with no empty subtag — and deliberately not a direction check: which
 * languages are usually read right to left is `locale.ts`'s vocabulary, and a second copy of it here
 * would let the two disagree about a reader's edition.
 */
function localeTagProblem(tag: string): string | undefined {
  if (isBlank(tag)) {
    return "A variant states its content locale as a BCP-47 language tag, for example en, fr-CA or ar.";
  }
  const [language, ...subtags] = tag.split("-");
  if (
    language === undefined ||
    !(LANGUAGE_SUBTAG.test(language) || REGISTERED_LANGUAGE_SUBTAG.test(language))
  ) {
    return `"${tag}" does not begin with a two- or three-letter language subtag (or a registered five- to eight-letter one), so it is not a BCP-47 language tag.`;
  }
  for (const subtag of subtags) {
    if (!GENERIC_SUBTAG.test(subtag)) {
      return `"${tag}" carries a subtag that is not one to eight alphanumeric characters, so it is not a BCP-47 language tag.`;
    }
  }
  return undefined;
}

/**
 * Whether two locale tags name the same edition. BCP-47 tags are case-insensitive, so `ar` and `AR`
 * are one key: a document cannot hold two public variants that differ only in the case of the tag.
 */
function localeTagsMatch(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * The audiences each family permits. An Update is published publicly and to approved supporters; a
 * Worker Page or a Project Page is a public locale edition and carries no audience choice at all.
 * This table is what stops a full audience × locale cross-product from existing.
 */
const ADMITTED_AUDIENCES: ReadonlyMap<VariantFamily, readonly VariantAudience[]> = new Map<
  VariantFamily,
  readonly VariantAudience[]
>([
  ["update", ["public", "approved-supporter"]],
  ["worker-page", ["public"]],
  ["project-page", ["public"]],
]);

/**
 * The audiences one family admits, in the order a surface lists them. An Update answers both
 * audiences; a Page answers `public` alone. A family the table does not know answers nothing, so a
 * value that reached here from stored JSON is refused rather than treated as permissive.
 */
export function admittedAudiences(family: VariantFamily): readonly VariantAudience[] {
  return ADMITTED_AUDIENCES.get(family) ?? [];
}

/**
 * Whether a family permits an audience. `update` permits `public` and `approved-supporter`;
 * `worker-page` and `project-page` permit `public` only, because they are public locale editions.
 * An audience outside its family's set is refused by `createVariant`, never coerced.
 */
export function variantKeyAllowed(family: VariantFamily, audience: VariantAudience): boolean {
  const admitted = ADMITTED_AUDIENCES.get(family);
  return admitted !== undefined && admitted.includes(audience);
}

/**
 * Whether a variant key — one document, one audience, one exact locale tag — is free among the
 * document's existing variants, or which variant already holds it. At most one variant may hold a
 * key, which is what makes every edition independently addressable.
 */
export function assertVariantKeyUnique(
  existing: readonly ContentVariant[],
  key: VariantKey,
): VariantKeyUniqueness {
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

// ---------------------------------------------------------------------------------------------
// Creating a variant
// ---------------------------------------------------------------------------------------------

/**
 * The source of a manual translation, with the records it names so the same-document rule can be
 * checked. The variant that results from it stores only the two identities, which is what staleness
 * later compares.
 */
export interface TranslationSourceEvidence {
  /** The variant the translation copies. */
  readonly variant: ContentVariant;
  /** The exact revision of that variant the translator read. */
  readonly revision: ContentRevision;
}

/** What a caller supplies to create one variant of one document. */
export interface CreateVariantInput {
  /** The identity of the variant, minted by the caller through `lib/ids`. */
  readonly variantId: string;
  /** The canonical document this variant is an edition of, whose identity and family are checked. */
  readonly document: ContentDocument;
  /** The audience to serve, which the family must permit. */
  readonly audience: VariantAudience;
  /** The exact content locale of the edition. */
  readonly locale: VariantLocale;
  /** Every variant that already exists for this document, so the key can be proven free. */
  readonly existingVariants: readonly ContentVariant[];
  /** The source edition, when this variant is a manual translation of another edition. */
  readonly translationSource?: TranslationSourceEvidence;
}

/**
 * The outcome of creating a variant: the variant itself, or every issue that refused it. A refusal
 * returns no partially built variant, so a caller cannot persist one by accident.
 */
export type CreateVariantResult =
  | { readonly status: "created"; readonly variant: ContentVariant }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };

/**
 * Creates one working variant of one document, with no draft, candidate or release yet.
 *
 * It refuses, rather than repairs, a blank variant identity, a document whose own identity is
 * incomplete, an audience the family does not admit, a locale tag that is not a plausible BCP-47 tag,
 * a key another variant already holds, and a translation source that names another document, another
 * variant's revision, or the variant being created. Every refusal is a value rather than a thrown
 * error, and it mints no identity of its own: the caller supplies `variantId`.
 */
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
      message:
        "A document names the site it belongs to, because locale fallback resolves within one site.",
    });
  }
  if (isBlank(document.sourceSubject.system) || isBlank(document.sourceSubject.reference)) {
    issues.push({
      path: "document.sourceSubject",
      message:
        "A document states the source system and its opaque reference for the subject it belongs to.",
    });
  }
  if (
    document.givingBinding !== undefined &&
    (isBlank(document.givingBinding.system) || isBlank(document.givingBinding.reference))
  ) {
    issues.push({
      path: "document.givingBinding",
      message:
        "A giving binding is a source-qualified reference; an unqualified one would name no Designation.",
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
        message:
          "A translation copies another edition of the document; it cannot name itself as its source.",
      });
    }
    if (source.variant.documentId !== document.documentId) {
      issues.push({
        path: "translationSource.variantId",
        message:
          "A translation copies a revision of the same document; the named source belongs to another document.",
      });
    }
    if (source.revision.variantId !== source.variant.variantId) {
      issues.push({
        path: "translationSource.revisionId",
        message:
          "The named source revision belongs to another variant, so it is not the revision the translation copies.",
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

// ---------------------------------------------------------------------------------------------
// Revisions: one immutable authored state, the digest that identifies it, and the draft pointer
// ---------------------------------------------------------------------------------------------

/**
 * The separator between a digest's parts. A raw NUL cannot occur inside any part, because every part
 * is JSON and JSON escapes U+0000, so the boundary between two parts is never ambiguous.
 */
const DIGEST_PART_SEPARATOR = "\u0000";

/** A record's entries in sorted key order, so two equal records always serialise identically. */
function sortedEntries(
  record: Readonly<Record<string, string>>,
): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (value !== undefined) {
      entries.push([key, value]);
    }
  }
  return entries;
}

/**
 * A profile-valid document whose single text node carries the revision's canonical serialisation.
 *
 * `document.ts` owns the repository's only hash and it hashes a document, so folding the revision's
 * canonical form into one text node lets that same checksum cover prose, sections, placements,
 * captions, alternative text and share presentation without a second hash implementation. The
 * carrier is never stored, rendered or validated — it exists for the length of one checksum call.
 */
function digestCarrier(canonical: string, direction: ContentDirection): ContentDocumentJson {
  return {
    type: "doc",
    profileVersion: CONTENT_PROFILE_VERSION,
    direction,
    content: [{ type: "paragraph", content: [{ type: "text", text: canonical }] }],
    sections: [],
  };
}

/**
 * The change-detection digest of one revision's content: the profile's checksum over the canonical
 * serialisation of the document, the placements in authored order, the alternative-text and caption
 * records in key order, and the share presentation. Two revisions with equal content have equal
 * digests, and a change to prose, a section, a placement, a caption, alternative text or the share
 * presentation changes the digest — which is what makes `isReleaseUnchanged` a comparison rather
 * than a comment.
 *
 * The revision's `sections` field, its identities, its checksum and its timestamps are outside the
 * digest: the sections are the document's own sections, and identity is not content.
 */
export function revisionChecksum(content: RevisionContent): string {
  const canonical = [
    serialise(content.body),
    JSON.stringify(
      content.mediaPlacements.map((placement) => [placement.placementId, placement.assetId]),
    ),
    JSON.stringify(sortedEntries(content.altText)),
    JSON.stringify(sortedEntries(content.captions)),
    JSON.stringify([
      content.sharePresentation.title ?? "",
      content.sharePresentation.description ?? "",
      content.sharePresentation.imageAssetId ?? "",
    ]),
  ].join(DIGEST_PART_SEPARATOR);
  return checksum(digestCarrier(canonical, content.body.direction));
}

/** What a caller supplies to write one revision of one variant. */
export interface CreateRevisionInput {
  /** The identity of the revision, minted by the caller; a revision identity is never reused. */
  readonly revisionId: string;
  /** The variant the revision belongs to. */
  readonly variantId: string;
  /** The authored document, validated by the content profile before it is stored. */
  readonly body: unknown;
  /** The media this revision places, in authored order. */
  readonly mediaPlacements?: readonly MediaPlacement[];
  /** Required alternative text per placement, keyed by `placementId`. */
  readonly altText?: Readonly<Record<string, string>>;
  /** Optional visible caption per placement, keyed by `placementId`. */
  readonly captions?: Readonly<Record<string, string>>;
  /** How a link to this revision presents itself. */
  readonly sharePresentation?: SharePresentation;
  /** The principal authoring this revision. */
  readonly authorPrincipalId: string;
  /** The scenario instant to record; the clock is read only when it is omitted. */
  readonly at?: Temporal.Instant;
}

/** The outcome of writing a revision: the stored revision, or every issue that refused it. */
export type CreateRevisionResult =
  | { readonly status: "created"; readonly revision: ContentRevision }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };

/**
 * Writes one revision: it validates the authored document against the content profile, proves every
 * placement is identified by the revision and carries alternative text, computes the revision's
 * digest, and stamps the author and the scenario instant.
 *
 * It refuses rather than repairs. A refused revision is not partly stored: the caller receives the
 * issues at the paths its form uses and no revision at all, so a rejected draft cannot become the
 * variant's draft pointer. `sections` is derived from the validated document, so the revision and
 * its document cannot disagree about which sections were composed.
 */
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
        message:
          "A placement states its own identity, because captions and alternative text key on it.",
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
        message:
          "Every image and video placement states the alternative text a reader is given when the media itself cannot be seen.",
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
  /** The principal the restored draft is authored by; the person restoring it, not the original author. */
  readonly authorPrincipalId: string;
  /** The identity of the restored revision, minted by the caller; never the source's identity. */
  readonly revisionId: string;
  /** The scenario instant to record; the clock is read only when it is omitted. */
  readonly at?: Temporal.Instant;
}

/**
 * Restores a revision as a new draft: a new identity, a new author and a new creation instant, with
 * the body, sections, placements, captions, alternative text, share presentation and content digest
 * carried through unchanged. A revision identity is never reused, so restoring an older release
 * leaves every earlier revision, candidate and release exactly where it was.
 */
export function restoreAsNewDraft(
  revision: ContentRevision,
  restored: RestoreDraftInput,
): ContentRevision {
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

/**
 * Points the variant's draft at a revision of that same variant, and changes nothing else: the
 * candidate pointer and the release head are carried through untouched, because saving a draft never
 * revises a candidate and never advances a release. A revision of another variant is refused, since
 * accepting it would write across editions.
 */
export function applyDraftRevision(
  variant: ContentVariant,
  revision: ContentRevision,
): VariantChange {
  if (isBlank(revision.revisionId)) {
    return {
      status: "invalid",
      issues: [
        { path: "revision.revisionId", message: "A draft revision states its own identity." },
      ],
    };
  }
  if (revision.variantId !== variant.variantId) {
    return {
      status: "invalid",
      issues: [
        {
          path: "revision.variantId",
          message:
            "A draft revision belongs to the variant it was written for; this one belongs to another.",
        },
      ],
    };
  }
  return { status: "applied", variant: { ...variant, draftRevisionId: revision.revisionId } };
}

// ---------------------------------------------------------------------------------------------
// Candidates: one freeze, one review round, no re-review
// ---------------------------------------------------------------------------------------------

/** What a caller supplies to freeze a revision for review. */
export interface FreezeCandidateInput {
  /** The identity of this review submission, minted by the caller; a fresh one per submission. */
  readonly candidateId: string;
  /** The scenario instant to record; the clock is read only when it is omitted. */
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

/**
 * Freezes one exact revision for review: the candidate records that revision's identity and its own
 * content digest, so what a reviewer reads cannot drift afterwards, and the variant points at the
 * candidate.
 *
 * The candidate is immutable once returned — there is no re-review and no way to revise it — because
 * a stored candidate is the evidence a release was reviewed. Any change after review therefore needs
 * a new revision and a new candidate with a fresh identity, which is what "exactly one review step"
 * means. A revision of another variant, and a revision whose body no longer validates against the
 * content profile, are refused rather than frozen.
 */
export function freezeCandidate(
  variant: ContentVariant,
  revision: ContentRevision,
  input: FreezeCandidateInput,
): FreezeCandidateResult {
  const issues: DocumentIssue[] = [];

  if (isBlank(input.candidateId)) {
    issues.push({ path: "candidateId", message: "A candidate states its own identity." });
  }
  if (revision.variantId !== variant.variantId) {
    issues.push({
      path: "revision.variantId",
      message:
        "A candidate freezes a revision of its own variant; this revision belongs to another.",
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

/**
 * Applies a reviewer's answer to the frozen candidate. Approval keeps the candidate, because it is
 * what a release reads; a request for changes or a rejection clears the pointer, so the next
 * submission needs a new revision and a new candidate instead of a second review of the frozen one.
 * A decision on a variant with nothing under review is refused rather than silently recorded.
 */
export function applyReviewDecision(
  variant: ContentVariant,
  decision: ReviewDecision,
): VariantChange {
  if (variant.candidateId === undefined) {
    return {
      status: "invalid",
      issues: [
        {
          path: "candidateId",
          message:
            "A review decision answers a frozen candidate, and this variant has nothing under review.",
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

// ---------------------------------------------------------------------------------------------
// Releases: one publication of one revision, and the head it advances
// ---------------------------------------------------------------------------------------------

/** What a caller supplies to publish one revision of one variant. */
export interface CreateReleaseInput {
  /** The identity of the release, minted by the caller. */
  readonly releaseId: string;
  /** The variant being published; its audience and locale are the release's own. */
  readonly variant: ContentVariant;
  /** The exact revision being published. */
  readonly revision: ContentRevision;
  /** The reach to publish with; omitted means `not-public`, because publication is not visibility. */
  readonly reach?: ReleaseReach;
  /** The scenario instant to record; the clock is read only when it is omitted. */
  readonly at?: Temporal.Instant;
}

/** The outcome of publishing a revision: the release, or every issue that refused it. */
export type CreateReleaseResult =
  | { readonly status: "created"; readonly release: Release }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };

/**
 * Builds one release of one revision: the variant's own audience and locale are copied onto it, the
 * revision's digest is recorded, and the reach defaults to `not-public` so publishing an edition
 * never makes it publicly reachable by itself.
 *
 * A revision of another variant is refused, because a release is a statement that *this* edition
 * published *that* revision. Whether the revision was reviewed, and whether review was required at
 * all, is the service's policy gate rather than this record's: a contributor policy that needs no
 * review publishes without a candidate, and this function does not invent one.
 */
export function createRelease(input: CreateReleaseInput): CreateReleaseResult {
  const issues: DocumentIssue[] = [];
  const { variant, revision } = input;

  if (isBlank(input.releaseId)) {
    issues.push({ path: "releaseId", message: "A release states its own identity." });
  }
  if (revision.variantId !== variant.variantId) {
    issues.push({
      path: "revision.variantId",
      message:
        "A release publishes a revision of its own variant; this revision belongs to another.",
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

/**
 * What happened to one variant's attempt to release: this variant's release, or the reason this
 * variant did not release. One outcome per variant, reported for that variant alone.
 */
export type ReleaseOutcome =
  | { readonly status: "released"; readonly release: Release }
  | { readonly status: "failed"; readonly reason: string };

/**
 * Applies one variant's release outcome to that variant.
 *
 * On `released` the variant's head becomes the new release, and the head it replaced — when the
 * caller hands it in, so it can be persisted already marked — is returned as `supersededRelease`
 * with `supersededBy` set.
 *
 * On `failed` the variant is returned exactly as it was passed in: the head is not cleared, not
 * rolled back and not replaced, so a sibling edition that released successfully keeps its release and
 * a failing edition keeps its prior-good head. There is no batch form of this function and no
 * rollback, which is what makes a partial release structurally incapable of disturbing another
 * variant.
 *
 * A release that belongs to another variant, serves another audience or states another locale is
 * refused rather than applied, so no call can write one edition's publication onto another's head.
 */
export function applyReleaseOutcome(
  variant: ContentVariant,
  outcome: ReleaseOutcome,
  currentHead?: Release,
): VariantChange {
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
      message:
        "A release belongs to the variant that published it; this one belongs to another variant.",
    });
  }
  if (release.audience !== variant.audience) {
    issues.push({
      path: "release.audience",
      message:
        "A release serves the audience of the variant it publishes, and this variant serves another.",
    });
  }
  if (
    !localeTagsMatch(release.locale.tag, variant.locale.tag) ||
    release.locale.direction !== variant.locale.direction
  ) {
    issues.push({
      path: "release.locale",
      message:
        "A release publishes the exact content locale of its variant, and this variant is another locale.",
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

/**
 * Whether a release still publishes exactly what a revision holds: true only when the revision
 * belongs to the released variant and carries the released digest. A later draft edit produces a
 * revision with a different digest, so the release reads as changed rather than as silently updated,
 * and a byte-identical re-save reads as unchanged rather than as a new publication.
 */
export function isReleaseUnchanged(release: Release, revision: ContentRevision): boolean {
  return (
    release.variantId === revision.variantId && release.contentChecksum === revision.contentChecksum
  );
}

// ---------------------------------------------------------------------------------------------
// Translation staleness: reported, never acted on
// ---------------------------------------------------------------------------------------------

/**
 * The source edition a translation is compared against: the source variant, and the revision that
 * variant currently holds as the caller resolved it. Both are handed in, so this module reads no
 * store and the comparison is exact.
 */
export interface TranslationSourceContext {
  /** The variant the translation copies, as the caller resolved the recorded source. */
  readonly sourceVariant: ContentVariant;
  /** The revision that source variant currently holds. */
  readonly sourceRevision: ContentRevision;
}

/**
 * The three answers {@link translationStaleness} gives. `fresh` and `stale` name the source revision
 * and when it was written; `stale` also names the revision the translation was made from.
 */
export type TranslationStaleness =
  | { readonly status: "none" }
  | {
      readonly status: "fresh";
      /** The source variant's current revision. */
      readonly sourceRevisionId: string;
      /** When that revision was written. */
      readonly sourceUpdatedAt: Temporal.Instant;
    }
  | {
      readonly status: "stale";
      /** The source variant's current revision, which the translation does not reflect. */
      readonly sourceRevisionId: string;
      /** When that revision was written. */
      readonly sourceUpdatedAt: Temporal.Instant;
      /** The revision the translation was actually made from. */
      readonly translatedFromRevisionId: string;
    };

/**
 * Whether a manual translation still reflects its source.
 *
 * `none` means the variant is not a translation. `fresh` means the revision the translator copied is
 * still the source variant's current revision. `stale` means it is not — the source has moved on, or
 * the recorded source no longer resolves to the variant handed in — and it carries both the source's
 * current revision and the one the translation was made from, so a surface can say which edition
 * moved.
 *
 * Staleness is a report: nothing here withdraws, resets or re-approves the translation, because a
 * source change is not a publication decision and a stale translation may still be the honest one a
 * reader needs today.
 */
export function translationStaleness(
  variant: ContentVariant,
  context: TranslationSourceContext,
): TranslationStaleness {
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
