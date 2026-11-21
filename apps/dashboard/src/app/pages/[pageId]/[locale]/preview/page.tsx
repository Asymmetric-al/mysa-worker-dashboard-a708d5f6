/**
 * `/pages/[pageId]/[locale]/preview` — the worker's exact, currently authorised, inert preview of one
 * locale edition of a Page, independently of any release.
 */
import type { Metadata } from "next";
import { PagePreviewFrame, type PagePreviewRendition, type PagePreviewView } from "@/features/ministry-pages/components/page-preview-frame";
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
// The two reads' own shapes, taken from the service surface rather than restated
type LocaleEditionsResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;
type LocaleEdition = Extract<LocaleEditionsResult, { kind: "envelope" }>["envelope"]["data"]["editions"][number];
type PreviewReadResult = Awaited<ReturnType<typeof reads.pages.readPreview>>;
type PreviewReadEnvelope = Extract<PreviewReadResult, { kind: "envelope" }>["envelope"];
type AuthorisedPreviewData = Extract<PreviewReadEnvelope["data"], { status: "authorised" }>;
type PlacementView = AuthorisedPreviewData["placements"][number];
// Reading the route's locale against the editions that exist
function normalisedTag(tag: string): string {
  return tag.trim().toLowerCase();
}
function primarySubtag(tag: string): string {
  return normalisedTag(tag).split("-")[0] ?? "";
}
/**
 * The edition the route's locale segment names: the edition whose tag is the requested one, or, when no
 * edition carries that exact tag, the edition in the same primary language. Choosing the edition is this
 * route's job; whether that edition may be rendered is the preview read's, decided after this point.
 */
function editionFor(editions: readonly LocaleEdition[], locale: string): LocaleEdition | undefined {
  const requested = normalisedTag(locale);
  const exact = editions.find((edition) => normalisedTag(edition.locale.tag) === requested);
  if (exact !== undefined) {
    return exact;
  }
  const primary = primarySubtag(locale);
  if (primary.length === 0) {
    return undefined;
  }
  return editions.find((edition) => primarySubtag(edition.locale.tag) === primary);
}
// The renditions the read admitted, named the way the frame's player needs them
function captionOrAltOf(placement: PlacementView): string {
  const caption = placement.caption?.trim() ?? "";
  return caption.length > 0 ? caption : placement.altText.trim();
}
function renditionsOf(preview: AuthorisedPreviewData): readonly PagePreviewRendition[] {
  const admitted = new Set<string>(preview.renditionIds);
  const renditions: PagePreviewRendition[] = [];
  for (const placement of preview.placements) {
    for (const rendition of placement.renditions) {
      if (!admitted.has(rendition.renditionId)) {
        continue;
      }
      const track = placement.captionTracks.find((candidate) => candidate.renditionId === rendition.renditionId);
      const label = track === undefined ? captionOrAltOf(placement) : track.label.trim();
      renditions.push({
        purpose: rendition.purpose,
        renditionId: rendition.renditionId,
        src: rendition.path,
        ...(label.length === 0 ? {} : { label }),
        ...(track === undefined ? {} : { language: track.language }),
      });
    }
  }
  return renditions;
}
// The one preview view the frame renders
/**
 * Maps the service's own answers onto the frame's three arms. The service's preview read acknowledges a
 * variant and a revision rather than a route pair, so this route resolves the locale edition first and then
 * asks the one preview read to authorise that edition's acknowledged revision. Reach, the locale decision,
 * the denial reason and the rendering stay the service's: nothing here re-checks them.
 */
async function previewViewOf(locales: LocaleEditionsResult, locale: string): Promise<PagePreviewView> {
  if (locales.kind === "denied") {
    return { status: "denied", reason: locales.denied.reasonCode };
  }
  if (locales.kind === "unavailable") {
    return { status: "unavailable", source: locales.unavailable.source };
  }
  const edition = editionFor(locales.envelope.data.editions, locale);
  if (edition === undefined) {
    // No edition serves this language. `locale-not-admitted` is the preview vocabulary's own word for it, and
    // it states nothing about the editions that do exist.
    return { status: "denied", reason: "locale-not-admitted" };
  }
  // The acknowledged revision is what the worker is composing when a draft exists, and otherwise the revision
  // the edition's head release published — a release is named by its own id, so the revision comes from the
  // release the edition points at. With neither, the edition has nothing to show yet.
  const revisionId = edition.draftRevisionId ?? edition.headRelease?.revisionId ?? null;
  if (revisionId === null) {
    return { status: "denied", reason: "unreleased" };
  }
  const result = await reads.pages.readPreview({
    variantId: edition.variantId,
    revisionId,
    requestedLocale: edition.locale.tag,
  });
  if (result.kind === "denied") {
    return { status: "denied", reason: result.denied.reasonCode };
  }
  if (result.kind === "unavailable") {
    return { status: "unavailable", source: result.unavailable.source };
  }
  const data = result.envelope.data;
  if (data.status === "authorised") {
    const served = normalisedTag(data.locale.tag);
    return {
      status: "authorised",
      variantId: data.variantId,
      revisionId: data.revision.revisionId,
      servedLocale: data.locale.tag,
      ...(normalisedTag(locale) === served ? {} : { requestedLocale: locale }),
      direction: data.locale.direction,
      html: data.renderedHtml,
      renditionIds: renditionsOf(data),
      inert: true,
      givingAction: "none",
    };
  }
  if (data.status === "denied") {
    return { status: "denied", reason: data.reason };
  }
  // A stored revision the one renderer cannot read is the source failing to supply it, not this caller's
  // refusal, so it is named as the source that could not answer.
  return { status: "unavailable", source: result.envelope.source };
}
/** The per-locale edition preview: resolve the locale edition, then render the service's own preview of it. */
export default async function PageLocalePreviewRoute({ params }: { params: Promise<{ pageId: string; locale: string }> }) {
  const { pageId, locale } = await params;
  const locales = await reads.pages.readPageLocales({ pageId, requestedLocale: locale });
  const preview = await previewViewOf(locales, locale);
  return (
    <section aria-labelledby={HEADING_ID} className={WRAPPER_CLASS}>
      {/* The one h1 on this route: the preview frame opens its own sections at level two. */}
      <h1 id={HEADING_ID} className={H1_CLASS}>
        {SURFACE_TITLE}
      </h1>
      <PagePreviewFrame layout="route" preview={preview} />
    </section>
  );
}
