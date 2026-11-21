/**
 * `/pages/[pageId]/[locale]/preview` — the worker's exact, currently authorised, inert preview of one
 * locale edition of a Page, independently of any release.
 */
import type { Metadata } from "next";
import { PagePreviewFrame, type PagePreviewView } from "@/features/ministry-pages/components/page-preview-frame";
import { reads } from "@/modules/data-service";
// The preview re-authorises on every request, so a switched persona, a withdrawal or a restriction changes
// this answer in the same read instead of in a cached one.
export const dynamic = "force-dynamic";
/** The surface's own name. The family's copy module names the builder's preview panel and the editions list, but
 *  nothing names a route-level preview of a single edition, so the title is this record-free phrase and no
 *  module gained a constant for it. */
const SURFACE_TITLE = "Language edition preview";
// Metadata renders even when the body refuses the read, so the title is static and names no record: a
// record-derived title would leak a title or an existence hint to a caller the read turns away.
export const metadata: Metadata = { title: SURFACE_TITLE };

const HEADING_ID = "page-locale-preview-heading";

const WRAPPER_CLASS = "flex min-w-0 flex-col gap-6 text-start";

const H1_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
// The three reads' own shapes, taken from the service surface rather than restated
type LocaleEditionsResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;
type LocaleEditionsData = Extract<LocaleEditionsResult, { kind: "envelope" }>["envelope"]["data"];
type LocaleEdition = LocaleEditionsData["editions"][number];
type GivingReadResult = Awaited<ReturnType<typeof reads.pages.readGivingBinding>>;
type GivingBinding = Extract<GivingReadResult, { kind: "envelope" }>["envelope"]["data"]["binding"];
// Reading the route's locale against the editions that exist
function normalisedTag(tag: string): string {
  return tag.trim().toLowerCase();
}
function primarySubtag(tag: string): string {
  return normalisedTag(tag).split("-")[0] ?? "";
}
/** The edition a release serves, named by the variant that release published. */
function editionOfVariant(editions: readonly LocaleEdition[], variantId: string): LocaleEdition | undefined {
  return editions.find((edition) => edition.variantId === variantId);
}
/**
 * The edition whose own locale tag is the requested one, or else the edition in the same primary language.
 * This lookup runs only where the content module's resolver answered *language unavailable*, which is the
 * ordinary case for an edition that holds a draft and has released nothing: a reader cannot be served it,
 * while the worker previewing it can. Matching the requested language here is the preview acknowledging the
 * edition it is composing, not a second fallback for readers, and it never widens to a language the route
 * did not ask for, so one edition can never stand in for an unrelated one.
 */
function editionOfLocale(editions: readonly LocaleEdition[], locale: string): LocaleEdition | undefined {
  const requested = normalisedTag(locale);
  if (requested.length === 0) {
    return undefined;
  }
  const exact = editions.find((edition) => normalisedTag(edition.locale.tag) === requested);
  if (exact !== undefined) {
    return exact;
  }
  const primary = primarySubtag(requested);
  if (primary.length === 0) {
    return undefined;
  }
  return editions.find((edition) => primarySubtag(edition.locale.tag) === primary);
}
// The one preview view the frame renders
/** What the route hands the frame: the one view, and the Give placement's binding when an edition was authorised. */
interface PreviewOutcome {
  readonly view: PagePreviewView;
  readonly givingBinding: GivingBinding | undefined;
}
/** An answer that never named an authorised edition, so it carries no Give placement. */
function withoutGiving(view: PagePreviewView): PreviewOutcome {
  return { view, givingBinding: undefined };
}
/**
 * Maps the service's own answers onto the frame's five arms. The service's preview read acknowledges a
 * variant and a revision rather than a route pair, so this route names the edition the content module's
 * resolver chose and asks the one preview read to authorise that edition's acknowledged revision. The locale
 * decision, reach, the denial reason and the rendering stay the service's: nothing here re-checks them.
 */
async function previewViewOf(pageId: string, locales: LocaleEditionsResult): Promise<PreviewOutcome> {
  if (locales.kind === "denied") {
    return withoutGiving({ status: "denied", reason: locales.denied.reasonCode });
  }
  if (locales.kind === "unavailable") {
    return withoutGiving({ status: "unavailable", source: locales.unavailable.source });
  }
  const { editions, resolution, requestedLocale } = locales.envelope.data;
  // The content module's resolver is the one place locale fallback is decided, so its answer names the
  // edition: a release serves this preview by publishing that release's variant. Only where the resolver
  // reports the language unavailable does this route look the edition up itself, which is how a draft-only
  // edition — one no reader can be served yet — is still previewed in its own language.
  const edition = resolution.status === "resolved" ? editionOfVariant(editions, resolution.release.variantId) : editionOfLocale(editions, requestedLocale);
  if (edition === undefined) {
    // No edition holds this language at all, so the surface states the language it cannot show. Naming the
    // editions that do exist would disclose an edition this route did not ask for.
    return withoutGiving({ status: "language-unavailable", requestedLocale });
  }
  // The acknowledged revision is what the worker is composing when a draft exists, and otherwise the revision
  // the edition's head release published — a release is named by its own id, so the revision comes from the
  // release the edition points at. With neither, the edition has nothing to preview, which is not a refusal.
  const revisionId = edition.draftRevisionId ?? edition.headRelease?.revisionId ?? null;
  if (revisionId === null) {
    return withoutGiving({ status: "unreleased", locale: edition.locale.tag });
  }
  const result = await reads.pages.readPreview({
    variantId: edition.variantId,
    revisionId,
    // The edition's own tag, never the requested one: the read refuses a revision whose edition does not hold
    // the language it is told, which is the guard that stops one edition standing in for another.
    requestedLocale: edition.locale.tag,
  });
  if (result.kind === "denied") {
    return withoutGiving({ status: "denied", reason: result.denied.reasonCode });
  }
  if (result.kind === "unavailable") {
    return withoutGiving({ status: "unavailable", source: result.unavailable.source });
  }
  const data = result.envelope.data;
  if (data.status === "authorised") {
    // The Give placement belongs to the edition rather than to the decoration around it, so the authorised
    // preview reads it: an approved Designation, or the reason there is none. A refusal or an outage of that
    // read reaches the frame as the answer it is, because an exact preview cannot drop the placement.
    const giving = await reads.pages.readGivingBinding({
      documentId: pageId,
      // The release the previewed revision belongs to, and no release while the edition has published none —
      // the read then answers for the page's newest release instead of being told a release it cannot name.
      ...(edition.headRelease === null ? {} : { releaseId: edition.headRelease.releaseId }),
    });
    if (giving.kind === "denied") {
      return withoutGiving({ status: "denied", reason: giving.denied.reasonCode });
    }
    if (giving.kind === "unavailable") {
      return withoutGiving({ status: "unavailable", source: giving.unavailable.source });
    }
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
        inert: true,
        givingAction: "none",
      },
      givingBinding: giving.envelope.data.binding,
    };
  }
  if (data.status === "denied") {
    return withoutGiving({ status: "denied", reason: data.reason });
  }
  // A stored revision the one renderer cannot read is the source failing to supply it, not this caller's
  // refusal, so it is named as the source that could not answer.
  return withoutGiving({ status: "unavailable", source: result.envelope.source });
}
/** The per-locale edition preview: resolve the locale edition, then render the service's own preview of it. */
export default async function PageLocalePreviewRoute({ params }: { params: Promise<{ pageId: string; locale: string }> }) {
  const { pageId, locale } = await params;
  const locales = await reads.pages.readPageLocales({ pageId, requestedLocale: locale });
  const preview = await previewViewOf(pageId, locales);
  return (
    <section aria-labelledby={HEADING_ID} className={WRAPPER_CLASS}>
      {/* The one h1 on this route: the preview frame opens its own sections at level two. */}
      <h1 id={HEADING_ID} className={H1_CLASS}>
        {SURFACE_TITLE}
      </h1>
      <PagePreviewFrame layout="route" preview={preview.view} givingBinding={preview.givingBinding} />
    </section>
  );
}
