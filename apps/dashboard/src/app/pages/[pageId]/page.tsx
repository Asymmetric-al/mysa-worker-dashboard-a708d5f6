import type { Metadata } from "next";
import type { ComponentProps, ReactElement } from "react";
import { PageBuilder } from "@/features/ministry-pages/components/page-builder";
import { reads } from "@/modules/data-service";
import { PageSurface, pageRefusalOf, wireFormOf, type PageHeadingContent, type ReadNoticeCopy } from "../../page-frame";
export const dynamic = "force-dynamic";
const SURFACE_TITLE = "Page builder";
export const metadata: Metadata = { title: SURFACE_TITLE };
type PageResult = Awaited<ReturnType<typeof reads.pages.readPage>>;
type LocalesResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;
type BuilderProps = ComponentProps<typeof PageBuilder>;
type PageEnvelope = BuilderProps["page"];
type LocalesEnvelope = BuilderProps["locales"];
type PageLocaleEdition = Extract<LocalesResult, { readonly kind: "envelope" }>["envelope"]["data"]["editions"][number];
const editionViewOf = (documentId: string, edition: PageLocaleEdition): LocalesEnvelope["data"][number] => ({
  locale: edition.locale.tag,
  direction: edition.locale.direction,
  variant: {
    variantId: edition.variantId,
    documentId,
    audience: edition.audience,
    locale: { tag: edition.locale.tag, direction: edition.locale.direction },
    ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
  },
  ...(edition.headRelease === null ? {} : { release: edition.headRelease }),
  ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
  ...(edition.candidate === null ? {} : { candidateDecision: edition.candidate.decision }),
});
const editionViewsOf = (documentId: string, editions: readonly PageLocaleEdition[]): LocalesEnvelope["data"] => editions.map((edition) => editionViewOf(documentId, edition));
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 2,
  denied: { title: "This ministry page isn’t available in this session", body: "Your current session doesn’t have permission to view or edit this page." },
  unavailable: {
    title: "Couldn’t load Page builder",
    body: "Couldn’t load this page’s sections and language editions right now. Try again in a moment.",
  },
  refused: { title: "Couldn’t open Page builder" },
};
const PAGE_HEADING: PageHeadingContent = { title: SURFACE_TITLE };
/** A refusal keeps the page's own title and states what could not be read beneath it, so the screen still says which page it is. */ const failureNoticeOf = (result: Exclude<PageResult, { readonly kind: "envelope" }>): ReactElement => pageRefusalOf(result, NOTICE_COPY, 6, PAGE_HEADING);
/** One Page's builder: three reads of one address at one instant, and the honest notice that replaces the builder when any of them answers without an envelope. */ export default async function PageBuilderPage({ params }: { readonly params: Promise<{ pageId: string }> }): Promise<ReactElement> {
  const { pageId } = await params;
  const [page, locales, giving]: readonly [PageResult, LocalesResult, Awaited<ReturnType<typeof reads.pages.readGivingBinding>>] = await Promise.all([reads.pages.readPage({ pageId }), reads.pages.readPageLocales({ pageId }), reads.pages.readGivingBinding({ documentId: pageId })]);
  if (page.kind !== "envelope") return failureNoticeOf(page);
  if (locales.kind !== "envelope") return failureNoticeOf(locales);
  if (giving.kind !== "envelope") return failureNoticeOf(giving);
  const { documentId } = page.envelope.data.document;
  return (
    <PageSurface headingId="page-builder-heading" title={SURFACE_TITLE}>
      <PageBuilder page={wireFormOf<PageEnvelope>(page.envelope)} locales={wireFormOf<LocalesEnvelope>({ ...locales.envelope, data: editionViewsOf(documentId, locales.envelope.data.editions) })} givingBinding={wireFormOf<BuilderProps["givingBinding"]>({ ...giving.envelope, data: giving.envelope.data.binding })} />
    </PageSurface>
  );
}
