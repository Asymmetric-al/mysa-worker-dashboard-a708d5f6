/**
 * The Ministry Updates roster as a view: the listing read's own facts, made plain so a Server Component
 * may hand them to a client component, plus the one lifecycle word each edition holds.
 *
 * This module is not a client module on purpose. The mapping has to run where the read runs — the service
 * states a release instant as a `Temporal.Instant`, and a class instance cannot cross into a client
 * component — so the Server Component that reads the roster calls {@link rosterOf} here and passes the
 * result to `components/updates-list`. The types and the evaluator it uses are pure, so the same module is
 * also safe to import from the client surface itself.
 */
import { lifecycleOf } from "@/components/draft-status";
import type { ContentLifecycleState } from "@/components/draft-status";
import type { reads } from "@/modules/data-service";
import type { ReadAction, ReadEnvelope, ValueState } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// The read's own shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** The listing read's envelope: every Update this ministry's content holds, with each edition's pointers. */
type RosterEnvelope = Extract<Awaited<ReturnType<typeof reads.updates.findContentDocuments>>, { readonly kind: "envelope" }>["envelope"];

/** One Update as the listing read states it. */
type IndexEntry = RosterEnvelope["data"]["documents"][number];

/** The canonical document behind one entry. */
type DocumentView = IndexEntry["document"];

/** One edition as the read states it: its own draft, candidate and release pointers. */
type EditionView = IndexEntry["editions"][number];

/** The audience an Update edition may serve. */
export type EditionAudience = EditionView["audience"];

/** How far a release reaches. */
type ReachView = NonNullable<EditionView["headRelease"]>["reach"];

/** The two directions a content locale carries. */
type ContentDirection = EditionView["locale"]["direction"];

/** What the service resolved about a manual translation: a fact this surface states rather than recomputes. */
type TranslationStatus = EditionView["translation"]["status"];

/** The variant evaluator's own parameter types, taken from the evaluator so the domain shapes are never restated here. */
type DomainVariant = Parameters<typeof lifecycleOf>[0];

// ---------------------------------------------------------------------------------------------
// The plain view: the read's eight facts, with every stored instant as the string it is
// ---------------------------------------------------------------------------------------------

/** The authority a roster was read under: the exact context every action on this surface is reviewed in. */
export type UpdatesRosterScope = ReadEnvelope<unknown>["scope"];

/** The source system and opaque reference the roster came from, shown as text when the source cannot be read. */
export type UpdatesRosterSource = ReadEnvelope<unknown>["source"];

/** How much of the past the roster covers. */
export type UpdatesRosterCoverage = ReadEnvelope<unknown>["coverage"];

/** The release standing at one edition's head, as this surface states it. */
export interface RosterRelease {
  readonly releaseId: string;
  readonly revisionId: string;
  /** The published instant exactly as the read supplied it. This surface never formats, derives or compares it. */
  readonly publishedAt: string;
  readonly reach: ReachView;
  /** The withdrawal instant, or `null` when the release has not been withdrawn. Distinct from `null` release. */
  readonly withdrawnAt: string | null;
}

/** One edition of one Update, with the lifecycle word the shared evaluator derived from the read's own facts. */
export interface RosterEdition {
  readonly variantId: string;
  readonly audience: EditionAudience;
  readonly localeTag: string;
  readonly direction: ContentDirection;
  readonly draftRevisionId: string | null;
  /** The frozen candidate's revision identity, or `null` when nothing is awaiting review. */
  readonly candidateId: string | null;
  readonly releaseHeadId: string | null;
  /** The read's own statement that this edition holds a frozen candidate and no release at its head. */
  readonly awaitingRelease: boolean;
  readonly lifecycle: ContentLifecycleState;
  /** When the source of a stale translation last changed, or `null` when the translation is not stale. */
  readonly staleSince: string | null;
  readonly translationStatus: TranslationStatus;
  readonly release: RosterRelease | null;
  /** The most recent release this edition ever carried, or `null` when it was never released. */
  readonly lastReleaseAt: string | null;
}

/** One canonical Update with its editions, as this surface lists it. */
export interface RosterDocument {
  readonly documentId: string;
  readonly kind: DocumentView["kind"];
  readonly siteId: string;
  readonly recordRevision: string;
  readonly sourceSubject: DocumentView["sourceSubject"];
  /** The headline a revision states, or `null` when no edition holds one yet. */
  readonly title: string | null;
  readonly editions: readonly RosterEdition[];
}

/** Everything this surface renders: the listing read's envelope, made plain so it can be handed to a client component. */
export interface UpdatesRoster {
  readonly documents: readonly RosterDocument[];
  readonly scope: UpdatesRosterScope;
  readonly source: UpdatesRosterSource;
  readonly revision: string;
  readonly asOf: string;
  readonly coverage: UpdatesRosterCoverage;
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly actions: readonly ReadAction[];
}

/** One edition as the evaluator takes it: the read's own pointers, so a lifecycle word is derived and never written here. */
function domainVariantOf(documentId: string, edition: EditionView): DomainVariant {
  return {
    variantId: edition.variantId,
    documentId,
    audience: edition.audience,
    locale: { tag: edition.locale.tag, direction: edition.locale.direction },
    ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
  };
}

/**
 * The lifecycle word of one edition.
 *
 * `lifecycleOf` owns the precedence between a withdrawal, a frozen candidate, a release and a draft, so
 * this function only feeds it the read's pointers. Translation staleness is the one state the evaluator
 * needs the source revision's body to reach, and the listing read has already resolved it from that body:
 * the read's own answer is therefore used, and only where the evaluator would otherwise report a plain
 * draft or nothing written. A candidate or a release still wins over staleness, exactly as it does there.
 */
export function lifecycleFor(documentId: string, edition: EditionView): ContentLifecycleState {
  const derived = lifecycleOf(domainVariantOf(documentId, edition), edition.headRelease ?? undefined);
  if (edition.translation.status === "stale" && (derived === "draft" || derived === "not-started")) {
    return "stale-translation";
  }
  return derived;
}

function releaseOf(edition: EditionView): RosterRelease | null {
  const head = edition.headRelease;
  if (head === null) {
    return null;
  }
  return { releaseId: head.releaseId, revisionId: head.revisionId, publishedAt: String(head.publishedAt), reach: head.reach, withdrawnAt: head.withdrawnAt === undefined ? null : String(head.withdrawnAt) };
}

function editionRosterOf(documentId: string, edition: EditionView, awaitingRelease: boolean): RosterEdition {
  return {
    variantId: edition.variantId,
    audience: edition.audience,
    localeTag: edition.locale.tag,
    direction: edition.locale.direction,
    draftRevisionId: edition.draftRevisionId,
    candidateId: edition.candidateId,
    releaseHeadId: edition.releaseHeadId,
    awaitingRelease,
    lifecycle: lifecycleFor(documentId, edition),
    staleSince: edition.translation.status === "stale" ? edition.translation.sourceUpdatedAt : null,
    translationStatus: edition.translation.status,
    release: releaseOf(edition),
    lastReleaseAt: edition.lastReleaseAt === null ? null : String(edition.lastReleaseAt),
  };
}

function documentRosterOf(entry: IndexEntry): RosterDocument {
  const documentId = entry.document.documentId;
  return {
    documentId,
    kind: entry.document.kind,
    siteId: entry.document.siteId,
    recordRevision: entry.document.recordRevision,
    sourceSubject: entry.document.sourceSubject,
    title: entry.title.status === "stated" ? entry.title.title : null,
    editions: entry.editions.map((edition) => editionRosterOf(documentId, edition, entry.awaitingRelease.includes(edition.variantId))),
  };
}

/**
 * Makes the listing read plain, so the Server Component that reads it can hand it to this client component.
 *
 * The service states a release instant as a `Temporal.Instant`. A class instance cannot cross from a
 * Server Component to a client one, so the read is converted once, here, and every consumer of the roster
 * afterwards holds strings. The envelope's other facts travel unchanged: they are scalar values, frozen
 * records and opaque references, and this file states no opinion about any of them.
 */
export function rosterOf(envelope: RosterEnvelope): UpdatesRoster {
  return { documents: envelope.data.documents.map(documentRosterOf), scope: envelope.scope, source: envelope.source, revision: envelope.revision, asOf: envelope.asOf, coverage: envelope.coverage, valueStates: envelope.valueStates, actions: envelope.actions };
}
