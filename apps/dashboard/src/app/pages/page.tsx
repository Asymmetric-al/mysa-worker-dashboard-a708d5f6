/**
 * `/pages` — the Worker and Project Pages index (AAP 0.9.1, 0.6.4, 0.10.1 unit 11).
 *
 * **What this file is.** Route composition, nothing else. It reads the two guided family catalogues and the
 * admitted Pages of the active scope through the one service surface, makes both answers plain enough to hand
 * to a client component, and renders the family's own index surface, which owns every row, catalogue entry,
 * notice, simulated-effect label and word. No Page is filtered, counted, sorted or authorised here, no section
 * type is listed here, and no draft, candidate, release or reach value is decided here.
 *
 * **Why the collection is read with `findContentDocuments`.** The named read inventory lists `readPage`, whose
 * shipped signature requires one document identity: it answers one Page with its sections and editions, and it
 * cannot enumerate. The one enumeration the Page job has is `reads.pages.findContentDocuments` — the same
 * listing read the Page handler composes, under the same authorisation — so the index takes the collection from
 * there rather than looping single-Page reads, adding a service method or asking the browser for a list.
 *
 * **Why neither the lifecycle word nor the reach word is derived here.** `lifecycleFor`, over this same listing
 * read, owns the precedence between a withdrawal, a frozen candidate, a current release and a saved draft, so
 * one evaluator states an edition's lifecycle for every surface that lists one. The reach word belongs to the
 * release that reaches readers now, so it travels for a live release only: a withdrawn or superseded head
 * states its lifecycle and no reach, and this route never re-derives either from the other.
 *
 * **Why the frozen candidate's identity travels.** The listing read states, per edition, the candidate that edition
 * holds, and that identity is the only address the candidate's one review step has. The row carries it unchanged, so
 * the index can offer a review exactly where one exists; it is not a lifecycle, a reach word or a review state, and
 * nothing here evaluates it.
 *
 * **Why the answers are handed on rather than re-stated.** A denial, an outage and a refused request each carry
 * no envelope, and an empty index has to stay distinguishable from both. The family surface renders every arm
 * — including the genuine first-use empty state, which leads to the two family catalogues below it — so a second
 * notice here would be a second state surface for one answer. What travels with the envelope (authority,
 * source, revision, as-of instant, coverage, the states the read set for the values it returned, and the
 * advisory actions) is the read's own, unchanged: the data under it is the same collection, in the shape the
 * surface renders.
 */
import type { Metadata } from "next";
import type { ComponentProps, ReactElement } from "react";

import PagesIndex, { type PageIndexRow } from "@/features/ministry-pages/components/pages-index";
import { copy, PAGE_FAMILIES, type PageFamily } from "@/features/ministry-pages/copy";
import { lifecycleFor } from "@/features/updates/roster";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service and from the surface rather than restated
// ---------------------------------------------------------------------------------------------

/** What the catalogues read answers: the envelope, a denial, an outage behind the records, or a refused request. */
type CataloguesResult = Awaited<ReturnType<typeof reads.pages.readPageCatalogues>>;

/** What the listing read answers: every document of the families it was asked for, with its editions. */
type DocumentsResult = Awaited<ReturnType<typeof reads.pages.findContentDocuments>>;

/** One listed document as the read states it. */
type DocumentEntry = Extract<DocumentsResult, { readonly kind: "envelope" }>["envelope"]["data"]["documents"][number];

/** One edition as the read states it: its own draft, candidate and release pointers, never a derived state. */
type EditionEntry = DocumentEntry["editions"][number];

/** What the index surface takes for its Pages and for its catalogues, taken from the component so neither shape is written twice. */
type PagesIndexProps = ComponentProps<typeof PagesIndex>;

type PagesAnswer = PagesIndexProps["pages"];

type CataloguesAnswer = PagesIndexProps["catalogues"];

/** The lifecycle vocabulary the surface renders, taken from the row it states rather than from a second list. */
type EditionLifecycle = PageIndexRow["editions"][number]["lifecycle"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The surface's name: the word the shell's navigation gives this destination, so the page and the link that leads to it carry one name. Every family, section and state word on the surface itself comes from the family's copy module. */
const PAGE_TITLE = "Pages";

/** The document title, which the root layout's template extends with the application name. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** One sentence of orientation above the surface: what the two families are, and where a Page is actually composed. The index states the rest itself. */
const PAGE_LEDE = "A Worker Page and a Project Page are public pages, each composed from the sections its own family admits. This index lists the Pages this ministry holds and describes both catalogues; composing, previewing and releasing an edition happen in the Page's own builder.";

/** The two lifecycles a release word describes: an edition that is published, and one published beside a sibling that kept its earlier release. A withdrawn or superseded head reaches no reader, so it states no reach. */
const LIVE_RELEASE_LIFECYCLES: ReadonlySet<EditionLifecycle> = new Set<EditionLifecycle>(["released", "partially-released"]);

/** The label a Page that no edition has titled yet is listed by. A Page holding no revision is still openable in its builder, so it stays listed — by this statement of what it is rather than by a title invented for it. */
const UNTITLED_PAGE_LABEL = "Untitled";

// ---------------------------------------------------------------------------------------------
// The reads' own answers, in the shapes the surface renders
// ---------------------------------------------------------------------------------------------

/** The title one Page is listed by: the headline a revision states, or the untitled statement that names its family when no edition holds one yet. */
function titleOf(entry: DocumentEntry, family: PageFamily): string {
  return entry.title.status === "stated" ? entry.title.title : `${UNTITLED_PAGE_LABEL} ${copy.families[family].label}`;
}

/**
 * One edition as the index lists it: the language it is read in, the lifecycle the shared evaluator derived, for a
 * release that still reaches readers the reach that release carries, and — while the edition holds one — the frozen
 * candidate the read itself names.
 *
 * The candidate identity travels exactly as the read states it, because it is the only address the edition's one
 * review step has. Nothing is derived from it: no lifecycle, no reach word and no review state are computed here, and
 * an edition the read states no candidate for carries none, which is what keeps the index from offering a review that
 * does not exist.
 */
function editionRowOf(documentId: string, edition: EditionEntry): PageIndexRow["editions"][number] {
  const lifecycle = lifecycleFor(documentId, edition);
  const locale = edition.locale.tag;
  // The read's own pointer, omitted rather than set to `undefined`, so the row states exactly what the read stated.
  const heldCandidate = edition.candidateId === null ? {} : { candidateId: edition.candidateId };
  if (edition.headRelease === null || !LIVE_RELEASE_LIFECYCLES.has(lifecycle)) {
    return { locale, lifecycle, ...heldCandidate };
  }
  return { locale, lifecycle, reach: edition.headRelease.reach, ...heldCandidate };
}

/** One listed document as a row, or nothing when it is not a Page: the read was asked for the two Page families only, so an Update entry is skipped rather than relabelled as one of them. */
function pageRowOf(entry: DocumentEntry): PageIndexRow | undefined {
  const { documentId, family } = entry.document;
  if (family === "update") return undefined;
  return { documentId, family, title: titleOf(entry, family), editions: entry.editions.map((edition) => editionRowOf(documentId, edition)) };
}

/** The listing read's envelope with its documents as rows, or the refusal exactly as the read answered it. */
function pagesAnswerOf(result: DocumentsResult): PagesAnswer {
  if (result.kind !== "envelope") return result;
  const { envelope } = result;
  const rows = envelope.data.documents.flatMap((entry) => {
    const row = pageRowOf(entry);
    return row === undefined ? [] : [row];
  });
  return { ...envelope, data: rows };
}

/** The catalogues read's envelope with the two catalogues themselves as its data, or the refusal exactly as the read answered it. The catalogue entries travel as the read states them: eight admitted section types per family, each with what it is for, its managed flag and its bounded presentation choices. */
function cataloguesAnswerOf(result: CataloguesResult): CataloguesAnswer {
  if (result.kind !== "envelope") return result;
  const { envelope } = result;
  return { ...envelope, data: envelope.data.catalogues };
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** The Pages index: both reads of one scope at one instant, and the family's own surface rendering each answer as it stands. */
export default async function PagesIndexRoute(): Promise<ReactElement> {
  // Neither read depends on the other and both describe the same request, so they are read together rather than one after the other.
  const [catalogues, documents] = await Promise.all([reads.pages.readPageCatalogues(), reads.pages.findContentDocuments({ families: PAGE_FAMILIES })]);
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one h1 on this route: the index and each family catalogue below it open their own sections at level two. */}
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_LEDE}</p>
      </div>
      <PagesIndex pages={pagesAnswerOf(documents)} catalogues={cataloguesAnswerOf(catalogues)} />
    </div>
  );
}
