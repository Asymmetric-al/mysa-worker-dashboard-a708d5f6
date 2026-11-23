"use client";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
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
import FamilyCatalogue, { builderPathOf, type FamilyCatalogueView } from "./family-catalogue";
/** One language edition of one Page as the index states it: the language it is read in, the lifecycle it is in, — once it is released — the reach that release carries, and — while it holds one — the frozen candidate a reviewer answers. */
export type PageIndexEdition = { readonly locale: string; readonly lifecycle: ContentLifecycleState; readonly reach?: Reach; readonly candidateId?: string };
/** One Page as the index lists it: its identity, its family and its editions, exactly as the reads state them. No count, title or lifecycle is derived here. */
export type PageIndexRow = { readonly documentId: string; readonly family: PageFamily; readonly title: string; readonly editions: readonly PageIndexEdition[] };
/** One read this surface renders: the envelope the service answered with, or the refusal that stands in its place. */
export type PagesIndexAnswer<T> = ReadEnvelope<T> | ReadResult<ReadEnvelope<T>>;
type ReadRefusal = Exclude<ReadResult<ReadEnvelope<unknown>>, { readonly kind: "envelope" }>;
/** Called once the service accepts a started edition, so the route can re-read the index it owns. */
export type PagesIndexProps = { readonly pages: PagesIndexAnswer<readonly PageIndexRow[]>; readonly catalogues: PagesIndexAnswer<readonly FamilyCatalogueView[]>; readonly onStarted?: (documentId: string) => void; readonly className?: string };
const FAMILIES_ANCHOR = "pages-index-families";
const EMPTY_DESCRIPTION = `${copy.states.emptyPages} Both families are described below — what a Worker Page holds and what a Project Page holds — and a Page is started from its own catalogue. Starting one releases nothing and notifies nobody.`;
const DENIED_DESCRIPTION = "The answer is the same whether or not a Page exists here, so nothing on this surface states a Page, a family, an edition or how many of either there are.";
const MISSING_CATALOGUE_TITLE = "This family's catalogue was not supplied";
const EDITIONS_LABEL = copy.editions.heading;
const EDITION_LOCALE_LABEL = copy.editions.localeLabel;
const NOTE_CLASS = "type-supporting text-pretty wrap-anywhere";
/** The one link treatment this surface states, for the index row that opens a Page's builder and for the review link beside it: underlined at rest, so the affordance is carried by neither hover nor colour alone, and keeping the 24 CSS px target (WCAG 2.5.8), the wrapping and the focus ring. */
const PAGE_LINK_CLASS = "inline-flex min-h-6 max-w-full min-w-0 items-center text-start inline-link text-pretty wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const envelopeOf = <T,>(answer: PagesIndexAnswer<T>): ReadEnvelope<T> | undefined => ("kind" in answer ? (answer.kind === "envelope" ? answer.envelope : undefined) : answer);
const refusalOf = <T,>(answer: PagesIndexAnswer<T>): ReadRefusal | undefined => ("kind" in answer && answer.kind !== "envelope" ? answer : undefined);
const reviewHrefOf = (edition: PageIndexEdition): string | undefined => ((edition.candidateId ?? "").trim() === "" ? undefined : `${"/pages/review/"}${encodeURIComponent(edition.candidateId ?? "")}`);
const builderLinkHintOf = (family: PageFamily): string => `Open the ${copy.families[family].label} builder`;
const missingCatalogueDescriptionOf = (family: PageFamily): string => `The catalogue read answered without a ${copy.families[family].label} catalogue, so this family lists no section type here. None is invented in its place, and the other family is unaffected.`;
function RefusalNotice({ answer, headingLevel, unavailableTitle }: { readonly answer: ReadRefusal; readonly headingLevel: NoticeHeadingLevel; readonly unavailableTitle: string }): ReactElement {
  switch (answer.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={headingLevel} title={"You do not have access to these Pages"} description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={headingLevel} title={unavailableTitle} description={answer.unavailable.guidance} source={answer.unavailable.source} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={headingLevel} title={"This index's own request was refused"} description={"The request this index was read with is not one the read admits, so nothing was read here and nothing stands in its place."} />;
  }
}
const PageRow = ({ row }: { readonly row: PageIndexRow }): ReactElement => (
  <li data-slot="pages-index-row" data-family={row.family} data-document-id={row.documentId} className={"flex min-w-0 flex-col gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0"}>
    <div className="flex min-w-0 flex-col gap-1">
      <Link href={builderPathOf(row.documentId)} className={cn(PAGE_LINK_CLASS, "font-medium")}>
        <bdi>{row.title}</bdi>
        <ChevronRightIcon aria-hidden="true" className="ms-1 size-4 shrink-0 rtl:-scale-x-100" />
        <span className="sr-only">{`, ${builderLinkHintOf(row.family)}`}</span>
      </Link>
      <p className={"type-supporting wrap-anywhere"}>
        <bdi>{copy.families[row.family].label}</bdi>
      </p>
    </div>
    {row.editions.length === 0 ? (
      <p className={NOTE_CLASS}>{copy.states.emptyEditions}</p>
    ) : (
      <ul aria-label={EDITIONS_LABEL} className={"flex min-w-0 flex-col gap-3"}>
        {row.editions.map((edition, position) => {
          const reviewHref = reviewHrefOf(edition);
          return (
            <li key={`${edition.locale}:${String(position)}`} data-slot="pages-index-edition" data-locale={edition.locale} data-lifecycle={edition.lifecycle} className={"flex min-w-0 flex-col gap-1"}>
              <div className={"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"}>
                <span className={"type-supporting wrap-anywhere"}>
                  {EDITION_LOCALE_LABEL}
                  {": "}
                  <bdi>{edition.locale}</bdi>
                </span>
                {edition.reach === undefined ? null : <StatusBadge label={copy.reach[edition.reach].label} tone={statusBadgeProps(REACH_STATUS, edition.reach).tone} srPrefix={"Reach"} />}
                {reviewHref === undefined ? null : (
                  <Link href={reviewHref} data-slot="pages-index-review" className={PAGE_LINK_CLASS}>
                    {copy.review.openCandidate}
                    <span className="sr-only">{`, ${copy.review.openCandidateHint(edition.locale)}`}</span>
                  </Link>
                )}
              </div>
              <DraftStatus state={edition.lifecycle} />
            </li>
          );
        })}
      </ul>
    )}
  </li>
);
/** The admitted Pages index, with both family catalogues beneath it. */
export function PagesIndex({ pages, catalogues, onStarted, className }: PagesIndexProps): ReactElement {
  const headingId = useId();
  const pagesEnvelope = envelopeOf(pages);
  const pagesRefusal = refusalOf(pages);
  const cataloguesEnvelope = envelopeOf(catalogues);
  const cataloguesRefusal = refusalOf(catalogues);
  const workerCatalogue = cataloguesEnvelope?.data.find((entry) => entry.family === "worker-page");
  const projectCatalogue = cataloguesEnvelope?.data.find((entry) => entry.family === "project-page");
  return (
    <div data-slot="pages-index" className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <section aria-labelledby={headingId} className={"flex min-w-0 flex-col gap-4"}>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className={"type-section-title text-pretty wrap-anywhere"}>
            {"Your Pages"}
          </h2>
          <p className={NOTE_CLASS}>{"Every Page this ministry admits, with the language editions each one carries. A row opens that Page's builder, where an edition is composed as a draft and nothing is released."}</p>
        </div>
        {pagesEnvelope === undefined ? null : <SimulationLabel effect={"publication-reach"} />}
        {pagesRefusal === undefined ? null : <RefusalNotice answer={pagesRefusal} headingLevel={3} unavailableTitle={"Your Pages could not be read"} />}
        {pagesEnvelope === undefined ? null : pagesEnvelope.data.length === 0 ? (
          <StateNotice kind="empty" headingLevel={3} title={"No Pages yet"} description={EMPTY_DESCRIPTION} action={{ label: "Choose a Page family", href: `#${FAMILIES_ANCHOR}` }} />
        ) : (
          <ul aria-labelledby={headingId} className={"flex min-w-0 flex-col gap-4"}>
            {pagesEnvelope.data.map((row) => (
              <PageRow key={row.documentId} row={row} />
            ))}
          </ul>
        )}
      </section>
      {pagesRefusal !== undefined && pagesRefusal.kind === "denied" ? null : (
        <>
          <Separator />
          <div id={FAMILIES_ANCHOR} className={"flex min-w-0 flex-col gap-6"}>
            {cataloguesRefusal === undefined ? null : <RefusalNotice answer={cataloguesRefusal} headingLevel={2} unavailableTitle={"The Page catalogues could not be read"} />}
            {cataloguesEnvelope === undefined ? null : (
              <>
                {workerCatalogue === undefined ? (
                  <StateNotice kind="unavailable" headingLevel={2} title={MISSING_CATALOGUE_TITLE} description={missingCatalogueDescriptionOf("worker-page")} source={cataloguesEnvelope.source} />
                ) : (
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
