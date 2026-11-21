"use client";
/**
 * The admitted Pages index: every Page this scope holds, one row each, with the family it belongs to, the
 * language editions it carries, each edition's lifecycle, the reach word a released edition reaches, and the
 * entry to its builder. Below the rows, both guided family catalogues state what a Worker Page and a Project
 * Page admit, so a worker who holds no Page yet meets the two families rather than an apology.
 *
 * The rows arrive as props. The service has no Pages enumeration read — `readPage` reads one Page and
 * `readPageCatalogues` reads the catalogues — so this surface renders the envelope the route hands it and
 * fetches nothing. Adding a Pages read is a service change, not a change here: it must not be worked around
 * with a loop of single-Page reads, a bespoke endpoint or a second hook.
 */
import Link from "next/link";
import { useId, type ReactElement } from "react";
import DraftStatus, { type ContentLifecycleState } from "@/components/draft-status";
import SimulationLabel from "@/components/simulation-label";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS, statusBadgeProps } from "@/components/status-badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { Reach } from "@/modules/content/reach";
import type { ReadEnvelope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { copy, type PageFamily } from "../copy";
import FamilyCatalogue, { type FamilyCatalogueView } from "./family-catalogue";
/** One language edition of one Page as the index states it: the language it is read in, the lifecycle it is in, and — once it is released — the reach that release carries. */
export type PageIndexEdition = { readonly locale: string; readonly lifecycle: ContentLifecycleState; readonly reach?: Reach };
/** One Page as the index lists it: its identity, its family and its editions, exactly as the reads state them. No count, title or lifecycle is derived here. */
export type PageIndexRow = { readonly documentId: string; readonly family: PageFamily; readonly title: string; readonly editions: readonly PageIndexEdition[] };
/**
 * One read this surface renders: the envelope the service answered with, or the refusal that stands in its
 * place. A denial and an outage have no envelope to hand over, and an empty index has to stay distinguishable
 * from both, so the refusals are carried rather than collapsed into an empty list.
 */
export type PagesIndexAnswer<T> = ReadEnvelope<T> | ReadResult<ReadEnvelope<T>>;
/** Every refusal a read can answer with, discriminated on `kind`. */
type ReadRefusal = Exclude<ReadResult<ReadEnvelope<unknown>>, { readonly kind: "envelope" }>;
/** Props of {@link PagesIndex}. */
export interface PagesIndexProps {
  /** The Page rows, route-supplied. Arrays are typed read-only so a route may pass what a read returned unchanged. */
  readonly pages: PagesIndexAnswer<readonly PageIndexRow[]>;
  /** Both families' catalogues, exactly as `readPageCatalogues` states them; the eight admitted section types come from here and are never listed a second time. */
  readonly catalogues: PagesIndexAnswer<readonly FamilyCatalogueView[]>;
  /** Called once the service accepts a started edition, so the route can re-read the index it owns. */
  readonly onStarted?: (documentId: string) => void;
  readonly className?: string;
}
/** Where one Page's builder lives. The route is composed by `src/app/pages/[pageId]`, which owns the address. */
const BUILDER_PATH_PREFIX = "/pages/";
/** The in-page address of the two family catalogues, so an empty index leads to where a Page is started. */
const FAMILIES_ANCHOR = "pages-index-families";
/** The one simulated effect this surface discloses: a released edition's reach is simulated publication state, and a Page never notifies. */
const REACH_SIMULATION_EFFECT = "publication-reach";
const INDEX_HEADING = "Your Pages";
const INDEX_DESCRIPTION = "Every Page this ministry admits, with the language editions each one carries. A row opens that Page's builder, where an edition is composed as a draft and nothing is released.";
const EMPTY_TITLE = "No Pages yet";
const EMPTY_DESCRIPTION = `${copy.states.emptyPages} Both families are described below — what a Worker Page holds and what a Project Page holds — and a Page is started from its own catalogue. Starting one releases nothing and notifies nobody.`;
const EMPTY_ACTION_LABEL = "Choose a Page family";
const PAGES_UNAVAILABLE_TITLE = "Your Pages could not be read";
const CATALOGUES_UNAVAILABLE_TITLE = "The Page catalogues could not be read";
const DENIED_TITLE = "You do not have access to these Pages";
const DENIED_DESCRIPTION = "The answer is the same whether or not a Page exists here, so nothing on this surface states a Page, a family, an edition or how many of either there are.";
const REFUSED_TITLE = "This index's own request was refused";
const REFUSED_DESCRIPTION = "The request this index was read with is not one the read admits, so nothing was read here and nothing stands in its place.";
const MISSING_CATALOGUE_TITLE = "This family's catalogue was not supplied";
const EDITIONS_LABEL = copy.editions.heading;
const EDITION_LOCALE_LABEL = copy.editions.localeLabel;
const REACH_PREFIX = "Reach";
const ROW_CLASS = "flex min-w-0 flex-col gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0";
const LIST_CLASS = "flex min-w-0 flex-col gap-4";
const EDITION_LIST_CLASS = "flex min-w-0 flex-col gap-3";
const EDITION_ITEM_CLASS = "flex min-w-0 flex-col gap-1";
const IDENTITY_ROW_CLASS = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1";
const BUILDER_LINK_CLASS = "inline-flex min-h-6 max-w-full min-w-0 items-center text-start font-medium underline-offset-4 text-pretty wrap-anywhere hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const FAMILY_CLASS = "text-sm text-muted-foreground wrap-anywhere";
const LOCALE_CLASS = "text-sm text-muted-foreground wrap-anywhere";
const NOTE_CLASS = "text-sm text-muted-foreground text-pretty wrap-anywhere";
const HEADING_CLASS = "font-heading text-lg font-medium text-pretty wrap-anywhere";
const SECTION_CLASS = "flex min-w-0 flex-col gap-4";
const FAMILIES_CLASS = "flex min-w-0 flex-col gap-6";
/** The envelope a read answered with, or nothing when it refused. */
function envelopeOf<T>(answer: PagesIndexAnswer<T>): ReadEnvelope<T> | undefined {
  if (!("kind" in answer)) return answer;
  return answer.kind === "envelope" ? answer.envelope : undefined;
}
/** The refusal a read answered with, or nothing when it returned an envelope. */
function refusalOf<T>(answer: PagesIndexAnswer<T>): ReadRefusal | undefined {
  if (!("kind" in answer) || answer.kind === "envelope") return undefined;
  return answer;
}
/** The address of one Page's builder, with its identity encoded rather than pasted into the path. */
function builderPathOf(documentId: string): string {
  return `${BUILDER_PATH_PREFIX}${encodeURIComponent(documentId)}`;
}
/** What a row's builder link also names, so two Pages that share a title still answer with distinct accessible names. */
function builderLinkHintOf(family: PageFamily): string {
  return `Open the ${copy.families[family].label} builder`;
}
/** Why no catalogue came back for a family, without inventing an entry in its place. */
function missingCatalogueDescriptionOf(family: PageFamily): string {
  return `The catalogue read answered without a ${copy.families[family].label} catalogue, so this family lists no section type here. None is invented in its place, and the other family is unaffected.`;
}
/** One read's refusal, rendered by the one surface that states a state rather than a result. */
function RefusalNotice({ answer, headingLevel, unavailableTitle }: { readonly answer: ReadRefusal; readonly headingLevel: NoticeHeadingLevel; readonly unavailableTitle: string }): ReactElement {
  switch (answer.kind) {
    case "denied":
      // No count, no title, no family and no existence hint: the notice says what happened and nothing about what it could not read.
      return <StateNotice kind="denied" headingLevel={headingLevel} title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={headingLevel} title={unavailableTitle} description={answer.unavailable.guidance} source={answer.unavailable.source} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={headingLevel} title={REFUSED_TITLE} description={REFUSED_DESCRIPTION} />;
  }
}
/** One Page's row: its title as the entry to the builder, its family in this family's own words, and one entry per language edition. */
function PageRow({ row }: { readonly row: PageIndexRow }): ReactElement {
  return (
    <li data-slot="pages-index-row" data-family={row.family} data-document-id={row.documentId} className={ROW_CLASS}>
      <div className="flex min-w-0 flex-col gap-1">
        <Link href={builderPathOf(row.documentId)} className={BUILDER_LINK_CLASS}>
          <bdi>{row.title}</bdi>
          <span className="sr-only">{`, ${builderLinkHintOf(row.family)}`}</span>
        </Link>
        <p className={FAMILY_CLASS}>
          <bdi>{copy.families[row.family].label}</bdi>
        </p>
      </div>
      {row.editions.length === 0 ? (
        <p className={NOTE_CLASS}>{copy.states.emptyEditions}</p>
      ) : (
        <ul aria-label={EDITIONS_LABEL} className={EDITION_LIST_CLASS}>
          {row.editions.map((edition, position) => (
            <li key={`${edition.locale}:${String(position)}`} data-slot="pages-index-edition" data-locale={edition.locale} data-lifecycle={edition.lifecycle} className={EDITION_ITEM_CLASS}>
              <div className={IDENTITY_ROW_CLASS}>
                <span className={LOCALE_CLASS}>
                  {EDITION_LOCALE_LABEL}
                  {": "}
                  <bdi>{edition.locale}</bdi>
                </span>
                {/*
                  A reach word belongs to a released edition only, so an edition that has not been released
                  states its lifecycle below and no reach here — never a default or invented reach value.
                */}
                {edition.reach === undefined ? null : <StatusBadge label={copy.reach[edition.reach].label} tone={statusBadgeProps(REACH_STATUS, edition.reach).tone} srPrefix={REACH_PREFIX} />}
              </div>
              <DraftStatus state={edition.lifecycle} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
/** The admitted Pages index, with both family catalogues beneath it. */
export function PagesIndex({ pages, catalogues, onStarted, className }: PagesIndexProps): ReactElement {
  const headingId = useId();
  const pagesEnvelope = envelopeOf(pages);
  const pagesRefusal = refusalOf(pages);
  // A denial precedes enumeration, so a denied index offers no catalogue either: the same answer whether or not a Page exists here.
  const pagesDenied = pagesRefusal !== undefined && pagesRefusal.kind === "denied";
  const cataloguesEnvelope = envelopeOf(catalogues);
  const cataloguesRefusal = refusalOf(catalogues);
  const workerCatalogue = cataloguesEnvelope?.data.find((entry) => entry.family === "worker-page");
  const projectCatalogue = cataloguesEnvelope?.data.find((entry) => entry.family === "project-page");
  return (
    <div data-slot="pages-index" className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <section aria-labelledby={headingId} className={SECTION_CLASS}>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className={HEADING_CLASS}>
            {INDEX_HEADING}
          </h2>
          <p className={NOTE_CLASS}>{INDEX_DESCRIPTION}</p>
        </div>
        {/*
          One disclosure for the surface: the reach this index shows is simulated publication state, and a
          Page release never notifies. It is stated only where an index was readable, because a denied or
          failed read shows no reach to disclose.
        */}
        {pagesEnvelope === undefined ? null : <SimulationLabel effect={REACH_SIMULATION_EFFECT} />}
        {pagesRefusal === undefined ? null : <RefusalNotice answer={pagesRefusal} headingLevel={3} unavailableTitle={PAGES_UNAVAILABLE_TITLE} />}
        {pagesEnvelope === undefined ? null : pagesEnvelope.data.length === 0 ? (
          // An empty index is a real first action: the two families below are where a Page is chosen, and each states what its Pages hold.
          <StateNotice kind="empty" headingLevel={3} title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} action={{ label: EMPTY_ACTION_LABEL, href: `#${FAMILIES_ANCHOR}` }} />
        ) : (
          <ul aria-labelledby={headingId} className={LIST_CLASS}>
            {pagesEnvelope.data.map((row) => (
              <PageRow key={row.documentId} row={row} />
            ))}
          </ul>
        )}
      </section>
      {pagesDenied ? null : (
        <>
          <Separator />
          <div id={FAMILIES_ANCHOR} className={FAMILIES_CLASS}>
            {cataloguesRefusal === undefined ? null : <RefusalNotice answer={cataloguesRefusal} headingLevel={2} unavailableTitle={CATALOGUES_UNAVAILABLE_TITLE} />}
            {cataloguesEnvelope === undefined ? null : (
              <>
                {workerCatalogue === undefined ? (
                  <StateNotice kind="unavailable" headingLevel={2} title={MISSING_CATALOGUE_TITLE} description={missingCatalogueDescriptionOf("worker-page")} source={cataloguesEnvelope.source} />
                ) : (
                  // The catalogue's scope is the one that read ran under, so a started edition is judged in the context it was offered in.
                  <FamilyCatalogue family="worker-page" catalogue={workerCatalogue} scope={cataloguesEnvelope.scope} onStarted={onStarted} />
                )}
                {projectCatalogue === undefined ? (
                  <StateNotice kind="unavailable" headingLevel={2} title={MISSING_CATALOGUE_TITLE} description={missingCatalogueDescriptionOf("project-page")} source={cataloguesEnvelope.source} />
                ) : (
                  <FamilyCatalogue family="project-page" catalogue={projectCatalogue} scope={cataloguesEnvelope.scope} onStarted={onStarted} />
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
export default PagesIndex;
