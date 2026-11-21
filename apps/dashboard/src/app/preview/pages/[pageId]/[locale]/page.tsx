/** `/preview/pages/[pageId]/[locale]` — one released Page edition at its public address: served by direct link, unindexed when it is shared by link only, and answered by an opaque tombstone once it is withdrawn. */
import type { Metadata } from "next";
import { PublicReadingView } from "@/features/audience/components/public-reading-view";
import { reachMetadata } from "@/modules/content/reach";
import { reads, type Scope } from "@/modules/data-service";

// A persona switch, a withdrawal, a reach change or a restriction has to take effect in the same read that answers this
// address, so no edition may be cached across requests.
export const dynamic = "force-dynamic";

/** The surface's own name: the reading view opens its notices and the edition title below this heading. */
const SURFACE_TITLE = "Page edition";
const HEADING_ID = "public-page-edition-heading";
const WRAPPER_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const H1_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
const NOINDEX: Metadata["robots"] = { index: false, follow: false };

// A denial, a refusal or an outage states no scope, and an invented context would claim authority the service never
// stated: the reading view is given a scope that claims none. It only ever names a cache entry, and the read that would
// fill that entry re-checks the session before it answers.
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };

// Document metadata is rendered even where the body refuses the address, so every answer that served no edition states
// the surface's own generic title and asks not to be indexed. A title taken from the record there would disclose a title
// or an existence hint to the very caller the read turned away.
const UNREADABLE_METADATA: Metadata = { title: SURFACE_TITLE, robots: NOINDEX };

type PublicPageReadingRouteProps = { readonly params: Promise<{ readonly pageId: string; readonly locale: string }> };

/**
 * The document metadata of this address, and the application's only `noindex` site.
 *
 * The same authorised in-process read the page runs supplies the answer, because metadata is generated before the body
 * and a title taken from an edition may only come from an edition this read actually served. Reach is not re-derived
 * here: the content module's own rule decides it from the reach value the envelope carries.
 */
export async function generateMetadata({ params }: PublicPageReadingRouteProps): Promise<Metadata> {
  const { pageId, locale } = await params;
  const result = await reads.audience.readReceivingPage({ pageId, locale });
  if (result.kind !== "envelope") return UNREADABLE_METADATA;
  const { data } = result.envelope;
  // A withdrawn edition, a language with nothing to serve, or an answer that named no reach never states a title. A
  // served edition carries no withdrawal instant by definition — the read admits only editions still serving — so the
  // reach rule is asked about the reach it names and no withdrawal.
  if (data.state !== "served" || data.reach === null) return UNREADABLE_METADATA;
  const reach = reachMetadata({ reach: data.reach, withdrawnAt: null });
  const statedTitle = (data.title ?? "").trim();
  // Only a listed edition is indexable, and only it states no robots directive at all; every other reach value is asked
  // not to be indexed. Failing closed on the flag is what keeps a reach value added later from becoming indexable by
  // omission.
  return { title: statedTitle.length === 0 ? SURFACE_TITLE : statedTitle, ...(reach.indexable ? {} : { robots: NOINDEX }) };
}

/** The public reading view of one released Page edition, reached by direct link. */
export default async function PublicPageReadingRoute({ params }: PublicPageReadingRouteProps) {
  const { pageId, locale } = await params;
  const result = await reads.audience.readReceivingPage({ pageId, locale });
  // The read's own arms answer this address. Nothing here turns a denial, a refusal or an outage into a not-found page:
  // a missing-looking page would state that this address holds no edition, which is what the read withheld.
  const scope = result.kind === "envelope" ? result.envelope.scope : NO_AUTHORITY_SCOPE;
  return (
    <section aria-labelledby={HEADING_ID} className={WRAPPER_CLASS}>
      <h1 id={HEADING_ID} className={H1_CLASS}>
        {SURFACE_TITLE}
      </h1>
      {/* The view adopts the read's answer unchanged and owns the edition, the tombstone, the refusal and the outage. */}
      <PublicReadingView scope={scope} pageId={pageId} locale={locale} initialEnvelope={result} />
    </section>
  );
}
