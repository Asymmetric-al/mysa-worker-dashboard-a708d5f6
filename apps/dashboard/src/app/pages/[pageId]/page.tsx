import type { Metadata } from "next";
import type { ComponentProps, ReactElement } from "react";
import { PageBuilder } from "@/features/ministry-pages/components/page-builder";
import { reads } from "@/modules/data-service";
import { PageSurface, ReadNotices, wireFormOf, type ReadNoticeCopy } from "../../page-frame";
export const dynamic = "force-dynamic";
const SURFACE_TITLE = "Page builder";
export const metadata: Metadata = { title: SURFACE_TITLE };
type PageResult = Awaited<ReturnType<typeof reads.pages.readPage>>;
type LocalesResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;
type GivingResult = Awaited<ReturnType<typeof reads.pages.readGivingBinding>>;
type BuilderProps = ComponentProps<typeof PageBuilder>;
type PageEnvelope = BuilderProps["page"];
type LocalesEnvelope = BuilderProps["locales"];
type GivingEnvelope = BuilderProps["givingBinding"];
type PageLocaleEdition = Extract<LocalesResult, { readonly kind: "envelope" }>["envelope"]["data"]["editions"][number];
type FailedRead = Exclude<PageResult, { readonly kind: "envelope" }>;
function editionViewOf(documentId: string, edition: PageLocaleEdition): LocalesEnvelope["data"][number] {
  return {
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
  };
}
const editionViewsOf = (documentId: string, editions: readonly PageLocaleEdition[]): LocalesEnvelope["data"] => editions.map((edition) => editionViewOf(documentId, edition));
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: "This Page is not available in this session", body: "This session may not read the Page this address names, so no edition, section, draft or giving destination is stated here. " + "A refusal is not a Page with nothing composed." },
  unavailable: {
    title: "This Page's builder could not be composed",
    body: "The records the builder is composed from could not be read, so no section, edition or giving destination is shown in their place. " + "No control is offered until the read succeeds: an empty builder would state that nothing is composed yet, " + "which a failed read does not say.",
  },
  refused: { title: "This builder's request was refused" },
};
const failureNoticeOf = (result: FailedRead): ReactElement => <ReadNotices failure={result} copy={NOTICE_COPY} />;
/** One Page's builder: three reads of one address at one instant, and the honest notice that replaces the builder when any of them answers without an envelope. */
export default async function PageBuilderPage({ params }: { readonly params: Promise<{ pageId: string }> }): Promise<ReactElement> {
  const { pageId } = await params;
  const [page, locales, giving]: readonly [PageResult, LocalesResult, GivingResult] = await Promise.all([reads.pages.readPage({ pageId }), reads.pages.readPageLocales({ pageId }), reads.pages.readGivingBinding({ documentId: pageId })]);
  if (page.kind !== "envelope") return failureNoticeOf(page);
  if (locales.kind !== "envelope") return failureNoticeOf(locales);
  if (giving.kind !== "envelope") return failureNoticeOf(giving);
  const { documentId } = page.envelope.data.document;
  return (
    <PageSurface headingId="page-builder-heading" title={SURFACE_TITLE}>
      <PageBuilder page={wireFormOf<PageEnvelope>(page.envelope)} locales={wireFormOf<LocalesEnvelope>({ ...locales.envelope, data: editionViewsOf(documentId, locales.envelope.data.editions) })} givingBinding={wireFormOf<GivingEnvelope>({ ...giving.envelope, data: giving.envelope.data.binding })} />
    </PageSurface>
  );
}
