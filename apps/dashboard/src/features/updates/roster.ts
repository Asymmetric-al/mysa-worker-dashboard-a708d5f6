import { lifecycleOf } from "@/components/draft-status";
import type { ContentLifecycleState } from "@/components/draft-status";
import type { reads } from "@/modules/data-service";
import type { ReadAction, ReadEnvelope, ValueState } from "@/modules/data-service/envelope";
/** The listing read's envelope: every Update this ministry's content holds, with each edition's pointers. */ type RosterEnvelope = Extract<Awaited<ReturnType<typeof reads.updates.findContentDocuments>>, { readonly kind: "envelope" }>["envelope"];
type IndexEntry = RosterEnvelope["data"]["documents"][number];
/** The window the read answered in: the page of listed rows, its size, the whole-result count and the pages that count makes. */ type RosterPage = RosterEnvelope["data"]["page"];
type DocumentView = IndexEntry["document"];
/** One edition as the read states it: its own draft, candidate and release pointers. */ type EditionView = IndexEntry["editions"][number];
export type EditionAudience = EditionView["audience"];
export type UpdatesRosterScope = ReadEnvelope<unknown>["scope"];
export type UpdatesRosterSource = ReadEnvelope<unknown>["source"];
export type UpdatesRosterCoverage = ReadEnvelope<unknown>["coverage"];
export type RosterRelease = { readonly releaseId: string; readonly revisionId: string; readonly publishedAt: string; readonly reach: NonNullable<EditionView["headRelease"]>["reach"]; readonly withdrawnAt: string | null };
export type RosterEdition = {
  readonly variantId: string;
  readonly audience: EditionAudience;
  readonly localeTag: string;
  readonly direction: EditionView["locale"]["direction"];
  readonly draftRevisionId: string | null;
  readonly candidateId: string | null;
  readonly releaseHeadId: string | null;
  readonly awaitingRelease: boolean;
  readonly lifecycle: ContentLifecycleState;
  readonly staleSince: string | null;
  readonly translationStatus: EditionView["translation"]["status"];
  readonly release: RosterRelease | null;
  readonly lastReleaseAt: string | null;
};
export type RosterDocument = { readonly documentId: string; readonly kind: DocumentView["kind"]; readonly siteId: string; readonly recordRevision: string; readonly sourceSubject: DocumentView["sourceSubject"]; readonly title: string | null; readonly editions: readonly RosterEdition[] };
export type UpdatesRoster = {
  readonly documents: readonly RosterDocument[];
  /** The window this roster occupies in the whole authorised collection: the page, the size it holds and the whole-result count the surface states beside the rows. */ readonly page: RosterPage;
  readonly scope: UpdatesRosterScope;
  readonly source: UpdatesRosterSource;
  readonly revision: string;
  readonly asOf: string;
  readonly coverage: UpdatesRosterCoverage;
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly actions: readonly ReadAction[];
};
/** One edition as the evaluator takes it: the read's own pointers, so a lifecycle word is derived and never written here. */ function domainVariantOf(documentId: string, edition: EditionView): Parameters<typeof lifecycleOf>[0] {
  const { draftRevisionId, candidateId, releaseHeadId } = edition;
  const stated = { ...(draftRevisionId === null ? {} : { draftRevisionId }), ...(candidateId === null ? {} : { candidateId }), ...(releaseHeadId === null ? {} : { releaseHeadId }) };
  return { variantId: edition.variantId, documentId, audience: edition.audience, locale: { tag: edition.locale.tag, direction: edition.locale.direction }, ...stated };
}
export function lifecycleFor(documentId: string, edition: EditionView): ContentLifecycleState {
  const derived = lifecycleOf(domainVariantOf(documentId, edition), edition.headRelease ?? undefined);
  return edition.translation.status === "stale" && (derived === "draft" || derived === "not-started") ? "stale-translation" : derived;
}
function releaseOf(edition: EditionView): RosterRelease | null {
  const head = edition.headRelease;
  return head === null ? null : { releaseId: head.releaseId, revisionId: head.revisionId, publishedAt: String(head.publishedAt), reach: head.reach, withdrawnAt: head.withdrawnAt === undefined ? null : String(head.withdrawnAt) };
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
  const { documentId, kind, siteId, recordRevision, sourceSubject } = entry.document;
  return { documentId, kind, siteId, recordRevision, sourceSubject, title: entry.title.status === "stated" ? entry.title.title : null, editions: entry.editions.map((edition) => editionRosterOf(documentId, edition, entry.awaitingRelease.includes(edition.variantId))) };
}
export function rosterOf(envelope: RosterEnvelope): UpdatesRoster {
  return { documents: envelope.data.documents.map(documentRosterOf), page: envelope.data.page, scope: envelope.scope, source: envelope.source, revision: envelope.revision, asOf: envelope.asOf, coverage: envelope.coverage, valueStates: envelope.valueStates, actions: envelope.actions };
}
