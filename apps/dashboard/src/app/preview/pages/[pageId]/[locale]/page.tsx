import type { Metadata } from "next";
import { PublicReadingView } from "@/features/audience/components/public-reading-view";
import { reachMetadata } from "@/modules/content/reach";
import { reads, type Scope } from "@/modules/data-service";
import { PageSurface } from "../../../../page-frame";
export const dynamic = "force-dynamic";
const SURFACE_TITLE = "Page edition";
const NOINDEX: Metadata["robots"] = { index: false, follow: false };
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };
const UNREADABLE_METADATA: Metadata = { title: SURFACE_TITLE, robots: NOINDEX };
type PublicPageReadingRouteProps = { readonly params: Promise<{ readonly pageId: string; readonly locale: string }> };
/** The document metadata of this address, and the application's only `noindex` site. */ export async function generateMetadata({ params }: PublicPageReadingRouteProps): Promise<Metadata> {
  const { pageId, locale } = await params;
  const result = await reads.audience.readReceivingPage({ pageId, locale });
  if (result.kind !== "envelope") return UNREADABLE_METADATA;
  const { data } = result.envelope;
  if (data.state !== "served" || data.reach === null) return UNREADABLE_METADATA;
  const reach = reachMetadata({ reach: data.reach, withdrawnAt: null });
  const statedTitle = (data.title ?? "").trim();
  return { title: statedTitle.length === 0 ? SURFACE_TITLE : statedTitle, ...(reach.indexable ? {} : { robots: NOINDEX }) };
}
/** The public reading view of one released Page edition, reached by direct link. */ export default async function PublicPageReadingRoute({ params }: PublicPageReadingRouteProps) {
  const { pageId, locale } = await params;
  const result = await reads.audience.readReceivingPage({ pageId, locale });
  const scope = result.kind === "envelope" ? result.envelope.scope : NO_AUTHORITY_SCOPE;
  return (
    <PageSurface headingId="public-page-edition-heading" title={SURFACE_TITLE}>
      <PublicReadingView scope={scope} pageId={pageId} locale={locale} initialEnvelope={result} />
    </PageSurface>
  );
}
