import type { Metadata } from "next";
import type { ComponentProps, ReactElement } from "react";
import PagesIndex, { type PageIndexRow } from "@/features/ministry-pages/components/pages-index";
import { copy, PAGE_FAMILIES, type PageFamily } from "@/features/ministry-pages/copy";
import { lifecycleFor } from "@/features/updates/roster";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading } from "../page-frame";
type CataloguesResult = Awaited<ReturnType<typeof reads.pages.readPageCatalogues>>;
type DocumentsResult = Awaited<ReturnType<typeof reads.pages.findContentDocuments>>;
type DocumentEntry = Extract<DocumentsResult, { readonly kind: "envelope" }>["envelope"]["data"]["documents"][number];
type EditionEntry = DocumentEntry["editions"][number];
type PagesIndexProps = ComponentProps<typeof PagesIndex>;
type PagesAnswer = PagesIndexProps["pages"];
type CataloguesAnswer = PagesIndexProps["catalogues"];
type EditionLifecycle = PageIndexRow["editions"][number]["lifecycle"];
const PAGE_TITLE = "Pages";
export const metadata: Metadata = { title: PAGE_TITLE };
const PAGE_LEDE = "A Worker Page and a Project Page are public pages, each composed from the sections its own family admits. This index lists the Pages this ministry holds and describes both catalogues; composing, previewing and releasing an edition happen in the Page's own builder.";
const LIVE_RELEASE_LIFECYCLES: ReadonlySet<EditionLifecycle> = new Set<EditionLifecycle>(["released", "partially-released"]);
const titleOf = (entry: DocumentEntry, family: PageFamily): string => (entry.title.status === "stated" ? entry.title.title : `${"Untitled"} ${copy.families[family].label}`);
function editionRowOf(documentId: string, edition: EditionEntry): PageIndexRow["editions"][number] {
  const lifecycle = lifecycleFor(documentId, edition);
  const locale = edition.locale.tag;
  const heldCandidate = edition.candidateId === null ? {} : { candidateId: edition.candidateId };
  if (edition.headRelease === null || !LIVE_RELEASE_LIFECYCLES.has(lifecycle)) return { locale, lifecycle, ...heldCandidate };
  return { locale, lifecycle, reach: edition.headRelease.reach, ...heldCandidate };
}
function pageRowOf(entry: DocumentEntry): PageIndexRow | undefined {
  const { documentId, family } = entry.document;
  if (family === "update") return undefined;
  return { documentId, family, title: titleOf(entry, family), editions: entry.editions.map((edition) => editionRowOf(documentId, edition)) };
}
function pagesAnswerOf(result: DocumentsResult): PagesAnswer {
  if (result.kind !== "envelope") return result;
  const { envelope } = result;
  const rows = envelope.data.documents.flatMap((entry) => {
    const row = pageRowOf(entry);
    return row === undefined ? [] : [row];
  });
  return { ...envelope, data: rows };
}
function cataloguesAnswerOf(result: CataloguesResult): CataloguesAnswer {
  if (result.kind !== "envelope") return result;
  const { envelope } = result;
  return { ...envelope, data: envelope.data.catalogues };
}
/** The Pages index: both reads of one scope at one instant, and the family's own surface rendering each answer as it stands. */
export default async function PagesIndexRoute(): Promise<ReactElement> {
  const [catalogues, documents] = await Promise.all([reads.pages.readPageCatalogues(), reads.pages.findContentDocuments({ families: PAGE_FAMILIES })]);
  return (
    <PageColumn>
      <PageHeading title={PAGE_TITLE} paragraphs={[PAGE_LEDE]} />
      <PagesIndex pages={pagesAnswerOf(documents)} catalogues={cataloguesAnswerOf(catalogues)} />
    </PageColumn>
  );
}
