"use client";
/**
 * The public discovery index: the page editions a public listing reaches, exactly as the service
 * decided that list. This surface enumerates what the read returned, explains why it is shorter than
 * every released edition, and links to each listed edition's own reading view.
 */
import Link from "next/link";
import { useId, type ReactElement } from "react";
import SimulationLabel from "@/components/simulation-label";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS, statusBadgeProps } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DISCOVERY_INDEX_COPY, RECEIVING_SIMULATION_EFFECT } from "@/features/audience/copy/receiving";
import { useDiscoveryIndex, type DiscoveryIndexEnvelope } from "@/features/audience/hooks/use-audience-reads";
import { cn } from "@/lib/cn";
import type { ReleaseReach } from "@/modules/content/variant";
import type { Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";

/** One edition the index lists, typed from the read's own answer rather than restated here. */
type ListedEdition = DiscoveryIndexEnvelope["data"]["entries"][number];

export interface DiscoveryIndexProps {
  /** The exact authority the index was read under, so the browser re-reads it in the same scope. */
  readonly scope: Scope;
  /** The envelope the Server Component read: the index this surface renders. */
  readonly initialEnvelope: ReadResult<DiscoveryIndexEnvelope>;
  /** The heading level the composed route needs; the default 1 is the route's one `h1`. */
  readonly headingLevel?: NoticeHeadingLevel;
  readonly className?: string;
}

const HEADING_TAGS: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };

/**
 * The reach word every row carries. The read lists only editions that reach a public listing, so the
 * word is the one the reach vocabulary states for `listed` rather than a second label written here.
 */
const LISTED_REACH: ReleaseReach = "listed";
const LISTED_STATUS = statusBadgeProps(REACH_STATUS, LISTED_REACH);

const EDITION_LINK_CLASS = "flex min-h-11 min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-sm p-2 text-start underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const ROW_TEXT_CLASS = "flex min-w-0 flex-1 flex-col gap-0.5";
const TITLE_CLASS = "text-sm font-medium text-pretty wrap-anywhere";
const LOCALE_CLASS = "text-xs text-muted-foreground wrap-anywhere";
const LIST_CLASS = "flex min-w-0 flex-col divide-y divide-border";

const RETRY_LABEL = "Read this index again";
const DENIED_TITLE = "This index is not available in this context";
const DENIED_DESCRIPTION = "The read was refused before it listed anything, so nothing here states how many editions are listed publicly, what they are called or whether any exists at all.";
const UNAVAILABLE_TITLE = `${DISCOVERY_INDEX_COPY.heading} could not be read`;
const REFUSED_TITLE = "This index's own request was refused";
const REFUSED_DESCRIPTION = "The request this index was read with is not one the read admits, so nothing was read and nothing is shown in its place. Open the index at its own address and the same job runs unchanged.";

/**
 * The heading level a notice takes: one below the surface's own heading, so the two never compete for
 * the same outline depth and no level is skipped.
 */
function noticeLevelOf(headingLevel: NoticeHeadingLevel): NoticeHeadingLevel {
  return headingLevel === 1 ? 2 : headingLevel === 2 ? 3 : 4;
}

/** The language's own name for itself, which is how a reader recognises the language an edition is written in. */
function endonymOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") {
    return "";
  }
  try {
    const name = new Intl.DisplayNames([trimmed], { type: "language" }).of(trimmed);
    const word = name?.trim() ?? "";
    return word === "" ? trimmed : word;
  } catch {
    // A tag the platform cannot resolve is shown as the edition itself states it, never translated or hidden.
    return trimmed;
  }
}

/** One listed edition as a link: the page's own title, the language it is written in and how it is reachable. */
function ListedEditionRow({ edition }: { readonly edition: ListedEdition }): ReactElement {
  const title = edition.title.trim();
  return (
    <li data-slot="discovery-edition" className="min-w-0">
      {/* The address comes from the read, composed there from this edition's own page id and locale tag, so the route grammar has one owner. */}
      <Link href={edition.href} className={EDITION_LINK_CLASS}>
        <span className={ROW_TEXT_CLASS}>
          {title === "" ? null : (
            <span className={TITLE_CLASS}>
              <bdi>{title}</bdi>
            </span>
          )}
          <span className={LOCALE_CLASS}>
            <span className="sr-only">Language: </span>
            <bdi lang={edition.locale.tag}>{endonymOf(edition.locale.tag)}</bdi>
          </span>
        </span>
        <StatusBadge label={LISTED_STATUS.label} tone={LISTED_STATUS.tone} srPrefix="Reach" />
      </Link>
    </li>
  );
}

/** The whole-result count, stated only where the index holds more editions than this page lists. */
function PagingStatement({ shown, total }: { readonly shown: number; readonly total: number }): ReactElement | null {
  if (total <= shown) {
    return null;
  }
  return (
    <p className="text-xs text-muted-foreground">
      {"Showing the first "}
      <bdi>{shown}</bdi>
      {" of "}
      <bdi>{total}</bdi>
      {" editions listed publicly."}
    </p>
  );
}

interface IndexBodyProps {
  readonly result: ReadResult<DiscoveryIndexEnvelope>;
  readonly headingLevel: NoticeHeadingLevel;
  readonly onRetry: () => void;
}

/**
 * What the read answered. Every row here is an edition the service decided is listed publicly: this
 * surface neither filters that decision nor states anything about the editions it does not hold, so a
 * link-only or withdrawn edition leaves no row, no count and no hint behind.
 */
function IndexBody({ result, headingLevel, onRetry }: IndexBodyProps): ReactElement {
  const noticeLevel = noticeLevelOf(headingLevel);
  switch (result.kind) {
    case "envelope": {
      const { entries, page } = result.envelope.data;
      if (entries.length === 0) {
        return <StateNotice kind="empty" headingLevel={noticeLevel} title={DISCOVERY_INDEX_COPY.emptyTitle} description={DISCOVERY_INDEX_COPY.emptyDescription} />;
      }
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <ul className={LIST_CLASS}>
            {entries.map((edition) => (
              <ListedEditionRow key={edition.href} edition={edition} />
            ))}
          </ul>
          <PagingStatement shown={entries.length} total={page.total} />
        </div>
      );
    }
    case "denied":
      // No count, no title and no empty list: the answer is the same whether or not any edition is listed in a scope this session may not read.
      return <StateNotice kind="denied" headingLevel={noticeLevel} title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      // The read's own guidance names the condition; the source identity keeps an outage from reading as an empty index.
      return <StateNotice kind="unavailable" headingLevel={noticeLevel} title={UNAVAILABLE_TITLE} description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: RETRY_LABEL, onClick: onRetry }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={noticeLevel} title={REFUSED_TITLE} description={REFUSED_DESCRIPTION} />;
  }
}

/** The public discovery index of released Page editions that are listed publicly. */
export function DiscoveryIndex({ scope, initialEnvelope, headingLevel = 1, className }: DiscoveryIndexProps): ReactElement {
  const { result, refresh } = useDiscoveryIndex({ scope, initialEnvelope });
  const headingId = useId();
  const Heading = HEADING_TAGS[headingLevel];
  return (
    <section data-slot="discovery-index" aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <Card>
        <CardHeader>
          <CardTitle>
            <Heading id={headingId} className="text-balance">
              {DISCOVERY_INDEX_COPY.heading}
            </Heading>
          </CardTitle>
          {/* The statement is part of the surface: a released edition absent from this list is explained rather than left to look missing. */}
          <CardDescription className="max-w-prose text-pretty">{DISCOVERY_INDEX_COPY.description}</CardDescription>
          <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} />
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <IndexBody result={result} headingLevel={headingLevel} onRetry={refresh} />
        </CardContent>
      </Card>
    </section>
  );
}

export default DiscoveryIndex;
