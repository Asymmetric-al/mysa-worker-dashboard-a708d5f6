import type { Metadata } from "next";
import { PagePreviewFrame, previewRefusalViewOf, type PagePreviewView } from "@/features/ministry-pages/components/page-preview-frame";
import { copy } from "@/features/ministry-pages/copy";
import { reads } from "@/modules/data-service";
import { PageSurface } from "../../../../page-frame";
export const dynamic = "force-dynamic";
const SURFACE_TITLE = "Language edition preview";
export const metadata: Metadata = { title: SURFACE_TITLE };
type LocaleEditionsResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;
type LocaleEditionsData = Extract<LocaleEditionsResult, { kind: "envelope" }>["envelope"]["data"];
type LocaleEdition = LocaleEditionsData["editions"][number];
type GivingBinding = Extract<Awaited<ReturnType<typeof reads.pages.readGivingBinding>>, { kind: "envelope" }>["envelope"]["data"]["binding"];
const normalisedTag = (tag: string): string => tag.trim().toLowerCase();
const primarySubtag = (tag: string): string => normalisedTag(tag).split("-")[0] ?? "";
/** This edition's own preview address, which answers the same exact revision again: the retry a route surface offers without holding a read of its own. */ const previewAddressOf = (pageId: string, locale: string): string => `/pages/${encodeURIComponent(pageId)}/${encodeURIComponent(locale)}/preview`;
function editionOfLocale(editions: readonly LocaleEdition[], locale: string): LocaleEdition | undefined {
  const requested = normalisedTag(locale);
  if (requested.length === 0) return undefined;
  const exact = editions.find((edition) => normalisedTag(edition.locale.tag) === requested);
  if (exact !== undefined) return exact;
  const primary = primarySubtag(requested);
  if (primary.length === 0) return undefined;
  return editions.find((edition) => primarySubtag(edition.locale.tag) === primary);
}
type PreviewOutcome = { readonly view: PagePreviewView; readonly givingBinding: GivingBinding | undefined };
const withoutGiving = (view: PagePreviewView): PreviewOutcome => ({ view, givingBinding: undefined });
function refusalOutcome(result: Extract<LocaleEditionsResult, { kind: "denied" }> | Extract<LocaleEditionsResult, { kind: "unavailable" }> | Extract<LocaleEditionsResult, { kind: "refused" }>): PreviewOutcome {
  if (result.kind === "denied") return withoutGiving({ status: "denied", reason: result.denied.reasonCode });
  return result.kind === "unavailable" ? withoutGiving({ status: "unavailable", source: result.unavailable.source }) : withoutGiving({ status: "refused" });
}
async function previewViewOf(pageId: string, locales: LocaleEditionsResult): Promise<PreviewOutcome> {
  if (locales.kind !== "envelope") return refusalOutcome(locales);
  const { editions, resolution, requestedLocale } = locales.envelope.data;
  const edition = resolution.status === "resolved" ? editions.find((candidate) => candidate.variantId === resolution.release.variantId) : editionOfLocale(editions, requestedLocale);
  if (edition === undefined) return withoutGiving({ status: "language-unavailable", requestedLocale });
  const revisionId = edition.draftRevisionId ?? edition.headRelease?.revisionId ?? null;
  if (revisionId === null) return withoutGiving({ status: "unreleased", locale: edition.locale.tag });
  const result = await reads.pages.readPreview({ variantId: edition.variantId, revisionId, requestedLocale: edition.locale.tag });
  if (result.kind !== "envelope") return refusalOutcome(result);
  const data = result.envelope.data;
  if (data.status === "authorised") {
    const giving = await reads.pages.readGivingBinding({ documentId: pageId, ...(edition.headRelease === null ? {} : { releaseId: edition.headRelease.releaseId }) });
    if (giving.kind !== "envelope") return refusalOutcome(giving);
    const served = normalisedTag(data.locale.tag);
    return {
      view: {
        status: "authorised",
        variantId: data.variantId,
        revisionId: data.revision.revisionId,
        servedLocale: data.locale.tag,
        ...(normalisedTag(requestedLocale) === served ? {} : { requestedLocale }),
        direction: data.locale.direction,
        html: data.renderedHtml,
        unreadyMedia: data.unreadyMedia,
        inert: true,
        givingAction: "none",
      },
      givingBinding: giving.envelope.data.binding,
    };
  }
  if (data.status === "denied") return withoutGiving(previewRefusalViewOf(data.reason));
  return withoutGiving({ status: "unavailable", source: result.envelope.source });
}
/** The per-locale edition preview: resolve the locale edition, then render the service's own preview of it. */ export default async function PageLocalePreviewRoute({ params }: { params: Promise<{ pageId: string; locale: string }> }) {
  const { pageId, locale } = await params;
  const locales = await reads.pages.readPageLocales({ pageId, requestedLocale: locale });
  const preview = await previewViewOf(pageId, locales);
  return (
    <PageSurface headingId="page-locale-preview-heading" title={SURFACE_TITLE}>
      <PagePreviewFrame layout="route" preview={preview.view} givingBinding={preview.givingBinding} retry={{ label: copy.preview.mediaRetryLabel, href: previewAddressOf(pageId, locale) }} />
    </PageSurface>
  );
}
