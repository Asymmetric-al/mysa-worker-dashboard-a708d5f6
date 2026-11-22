/**
 * `/pages/[pageId]` — one Worker or Project Page's builder: the language editions the Page carries, the section outline
 * and the field form for the edition being composed, the exact inert preview beside them, and the Page-level controls
 * for review, release, reach, containment and giving (AAP 0.9.1, "Section builder with outline, fields and live
 * preview"; AAP 0.6.4, "Compose sections, preview a locale edition, release, set reach, withdraw").
 *
 * **What this route is.** Composition, and nothing else. It reads the Page the address names, the language editions
 * that Page carries and the one approved giving Designation its releases may place, then hands the three answers to
 * this family's builder. The builder owns every control, every state word and every sentence: a preset, a structural
 * change, a field save, a review, a release, a reach value and the containment action all leave that surface through
 * the family's own hooks, each attempt carrying one operation id, the scope it was read in and the revision it saw, so
 * a replay returns its recorded result instead of changing the Page twice. This file therefore mints no operation id,
 * issues no request of its own, holds no copy of a record, derives no lifecycle, reach value, permission or count, and
 * reads nothing twice.
 *
 * **Why the three reads are asked together.** The editions and the giving placement belong to the document the address
 * names, so none of the three reads depends on another's answer and the builder opens on all three: they are
 * requested at one instant rather than serialised behind the Page read. Each re-derives scope from the same session,
 * so a persona switch, a restriction or a withdrawal changes this render in the same request instead of in a cached
 * one.
 *
 * **What a refusal states.** A denial, an outage and a refused request each render the single notice that belongs to
 * them, in this route's own words and carrying no title, edition, section, count or existence hint: a Page this
 * session may not read answers exactly as one the store does not hold, which is what makes an address that resolves
 * to nothing an honest refusal rather than a crash or an invented Page. The builder is composed over three envelopes
 * and never fewer, so an outage is never rendered as an empty builder — an empty builder would state that nothing is
 * composed yet, which a failed read does not say.
 */
import type { Metadata } from "next";
import type { ComponentProps, ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { PageBuilder } from "@/features/ministry-pages/components/page-builder";
import { reads } from "@/modules/data-service";

// The builder re-reads every record it shows and the service re-authorises every edit, so this render is resolved per
// request rather than held: a restriction, a withdrawal or a changed edition reaches it in the same read that produces it.
export const dynamic = "force-dynamic";

/** The surface's own name, which states the job and names no record. */
const SURFACE_TITLE = "Page builder";

// Metadata renders even when the body refuses the read, so the title is static and names no record: a record-derived
// title would leak a title or an existence hint to a caller the read turns away.
export const metadata: Metadata = { title: SURFACE_TITLE };

const HEADING_ID = "page-builder-heading";

const WRAPPER_CLASS = "flex min-w-0 flex-col gap-6 text-start";

const H1_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";

/** The refusal of an answer this session may not see, which states the condition and nothing about what may exist. */
const DENIED_TITLE = "This Page is not available in this session";

const DENIED_DESCRIPTION = "This session may not read the Page this address names, so no edition, section, draft or giving destination is stated here. " + "A refusal is not a Page with nothing composed.";

/** The refusal of a request this read does not admit: the address is the answer, and no record was read. */
const REFUSED_TITLE = "This builder's request was refused";

/** The outage of a read the composition depends on, which is never the same fact as there being nothing composed. */
const UNAVAILABLE_TITLE = "This Page's builder could not be composed";

const UNAVAILABLE_DESCRIPTION = "The records the builder is composed from could not be read, so no section, edition or giving destination is shown in their place. " + "No control is offered until the read succeeds: an empty builder would state that nothing is composed yet, " + "which a failed read does not say.";

// ---------------------------------------------------------------------------------------------
// The reads' own shapes and the builder's own props, taken from them rather than restated
// ---------------------------------------------------------------------------------------------

/** What each of the three reads answers: one envelope, a denial, an outage behind the records, or a refused request. */
type PageResult = Awaited<ReturnType<typeof reads.pages.readPage>>;
type LocalesResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;
type GivingResult = Awaited<ReturnType<typeof reads.pages.readGivingBinding>>;

/** The three envelopes this route composes the builder from, taken from the surface that receives them. */
type BuilderProps = ComponentProps<typeof PageBuilder>;
type PageEnvelope = BuilderProps["page"];
type LocalesEnvelope = BuilderProps["locales"];
type GivingEnvelope = BuilderProps["givingBinding"];

/** One language edition as the locale read states it: the record the builder's edition list is seeded from. */
type PageLocaleEdition = Extract<LocalesResult, { readonly kind: "envelope" }>["envelope"]["data"]["editions"][number];

/** A read that produced no envelope: the denial, the outage and the refused request, none of which carries a record. */
type FailedRead = Exclude<PageResult, { readonly kind: "envelope" }>;

// ---------------------------------------------------------------------------------------------
// The three answers in the encoding a Client Component may receive
// ---------------------------------------------------------------------------------------------

/**
 * One envelope as the browser handler would have answered with. A read states a release's instants as
 * `Temporal.Instant` values, and the builder is a Client Component, so each answer is handed over as the exact bytes
 * the Pages handler would send: the read's own facts, carrying no object the browser could not have received itself.
 * It re-encodes nothing — the payload that reaches the builder is the read's own.
 */
function wireFormOf<T>(value: T): T {
  const wire: unknown = JSON.parse(JSON.stringify(value));
  return wire as T;
}

/**
 * One language edition as the builder's edition list reads it: the language and direction it is read in, the variant
 * record the shared lifecycle evaluator judges, the release that edition published and the candidate it holds while it
 * holds one. The read's own pointers are carried unchanged, and an absent pointer is omitted rather than set to
 * `undefined`, so the seed states exactly what the read stated.
 */
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

/** Every language edition the read stated, in the order it stated them: the list the builder opens on before its own read answers. */
function editionViewsOf(documentId: string, editions: readonly PageLocaleEdition[]): LocalesEnvelope["data"] {
  return editions.map((edition) => editionViewOf(documentId, edition));
}

// ---------------------------------------------------------------------------------------------
// The states that replace the builder
// ---------------------------------------------------------------------------------------------

/** The one notice a read that produced no envelope answers with, carrying no record data in any arm. */
function failureNoticeOf(result: FailedRead): ReactElement {
  switch (result.kind) {
    case "denied":
      // The closed reason code is the whole answer a refusal carries: no record, count, title or size travels with it.
      return <StateNotice kind="denied" headingLevel={1} title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={1} title={UNAVAILABLE_TITLE} description={UNAVAILABLE_DESCRIPTION} source={result.unavailable.source} />;
    case "refused":
      // This route calls the three reads directly, so the request is its own and never one a handler refuses: the arm is
      // stated here rather than thrown, and the notice names the request rather than a source that failed.
      return <StateNotice kind="refused" headingLevel={1} title={REFUSED_TITLE} />;
  }
}

// ---------------------------------------------------------------------------------------------
// The composed route
// ---------------------------------------------------------------------------------------------

/** What this route receives: the segment naming the Page to compose, unresolved. */
export interface PageBuilderPageProps {
  readonly params: Promise<{ pageId: string }>;
}

/** One Page's builder: three reads of one address at one instant, and the honest notice that replaces the builder when any of them answers without an envelope. */
export default async function PageBuilderPage({ params }: PageBuilderPageProps): Promise<ReactElement> {
  const { pageId } = await params;
  // The segment travels to all three reads as the opaque identity it is: it is never parsed, case-folded, trimmed into
  // parts or compared with anything this file can see, and it is never rendered. An identity the service does not hold
  // comes back as the read's own denial rather than as a page that says "not found", so nothing here reveals whether a
  // Page exists.
  const [page, locales, giving]: readonly [PageResult, LocalesResult, GivingResult] = await Promise.all([reads.pages.readPage({ pageId }), reads.pages.readPageLocales({ pageId }), reads.pages.readGivingBinding({ documentId: pageId })]);
  // A refusal is stated in the order the builder needs the answers — the Page, its language editions, the giving
  // placement — so an answer about the Page itself is never pre-empted by a supporting read's outage.
  if (page.kind !== "envelope") return failureNoticeOf(page);
  if (locales.kind !== "envelope") return failureNoticeOf(locales);
  if (giving.kind !== "envelope") return failureNoticeOf(giving);
  const { documentId } = page.envelope.data.document;
  return (
    <section aria-labelledby={HEADING_ID} className={WRAPPER_CLASS}>
      {/* The one h1 on this route: the builder opens its own sections at level two. */}
      <h1 id={HEADING_ID} className={H1_CLASS}>
        {SURFACE_TITLE}
      </h1>
      <PageBuilder page={wireFormOf<PageEnvelope>(page.envelope)} locales={wireFormOf<LocalesEnvelope>({ ...locales.envelope, data: editionViewsOf(documentId, locales.envelope.data.editions) })} givingBinding={wireFormOf<GivingEnvelope>({ ...giving.envelope, data: giving.envelope.data.binding })} />
    </section>
  );
}
