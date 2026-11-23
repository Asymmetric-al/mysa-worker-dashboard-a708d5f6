"use client";
import Link from "next/link";
import { useId, type ReactElement } from "react";
import SimulationLabel from "@/components/simulation-label";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS, statusBadgeProps } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DISCOVERY_INDEX_COPY, RECEIVING_SIMULATION_EFFECT } from "@/features/audience/copy/receiving";
import { useDiscoveryIndex, type DiscoveryIndexEnvelope } from "@/features/audience/hooks/use-audience-reads";
import { cn } from "@/lib/cn";
import { languageNameOf } from "@/lib/language-name";
import type { Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
type ListedEdition = DiscoveryIndexEnvelope["data"]["entries"][number];
export type DiscoveryIndexProps = { readonly scope: Scope; readonly initialEnvelope: ReadResult<DiscoveryIndexEnvelope>; readonly headingLevel?: NoticeHeadingLevel; readonly className?: string };
const HEADING_TAGS: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's heading utility for each level, so this surface's heading takes the measure of the level the composing page gives it rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<NoticeHeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const LISTED_STATUS = statusBadgeProps(REACH_STATUS, "listed");
const UNAVAILABLE_TITLE = `${DISCOVERY_INDEX_COPY.heading} could not be read`;
const noticeLevelOf = (headingLevel: NoticeHeadingLevel): NoticeHeadingLevel => (headingLevel === 1 ? 2 : headingLevel === 2 ? 3 : 4);
function ListedEditionRow({ edition }: { readonly edition: ListedEdition }): ReactElement {
  const title = edition.title.trim();
  return (
    <li data-slot="discovery-edition" className="min-w-0">
      <Link href={edition.href} className="inline-link flex min-h-11 min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-sm p-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title === "" ? null : <bdi className="text-sm font-medium text-pretty wrap-anywhere">{title}</bdi>}
          <span className="text-xs text-muted-foreground wrap-anywhere">
            <span className="sr-only">Language: </span>
            <bdi lang={edition.locale.tag}>{languageNameOf(edition.locale.tag)}</bdi>
          </span>
        </span>
        <StatusBadge label={LISTED_STATUS.label} tone={LISTED_STATUS.tone} srPrefix="Reach" />
      </Link>
    </li>
  );
}
function PagingStatement({ shown, total }: { readonly shown: number; readonly total: number }): ReactElement | null {
  if (total <= shown) return null;
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
type IndexBodyProps = { readonly result: ReadResult<DiscoveryIndexEnvelope>; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: () => void };
function IndexBody({ result, headingLevel, onRetry }: IndexBodyProps): ReactElement {
  const noticeLevel = noticeLevelOf(headingLevel);
  switch (result.kind) {
    case "envelope": {
      const { entries, page } = result.envelope.data;
      if (entries.length === 0) return <StateNotice kind="empty" headingLevel={noticeLevel} title={DISCOVERY_INDEX_COPY.emptyTitle} description={DISCOVERY_INDEX_COPY.emptyDescription} />;
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <ul className="flex min-w-0 flex-col divide-y divide-border">
            {entries.map((edition) => (
              <ListedEditionRow key={edition.href} edition={edition} />
            ))}
          </ul>
          <PagingStatement shown={entries.length} total={page.total} />
        </div>
      );
    }
    case "denied":
      return (
        <StateNotice
          kind="denied"
          headingLevel={noticeLevel}
          title="This index is not available in this context"
          description="The read was refused before it listed anything, so nothing here states how many editions are listed publicly, what they are called or whether any exists at all."
          reasonCode={result.denied.reasonCode}
        />
      );
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={noticeLevel} title={UNAVAILABLE_TITLE} description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: "Read this index again", onClick: onRetry }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={noticeLevel} title="This index's own request was refused" description="The request this index was read with is not one the read admits, so nothing was read and nothing is shown in its place. Open the index at its own address and the same job runs unchanged." />;
  }
}
/** The public discovery index of released Page editions that are listed publicly. */ export function DiscoveryIndex({ scope, initialEnvelope, headingLevel = 1, className }: DiscoveryIndexProps): ReactElement {
  const { result, refresh } = useDiscoveryIndex({ scope, initialEnvelope });
  const headingId = useId();
  const Heading = HEADING_TAGS[headingLevel];
  return (
    <section data-slot="discovery-index" aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <Card>
        <CardHeader>
          <CardTitle>
            <Heading id={headingId} className={cn(HEADING_SCALE[headingLevel], "text-balance")}>
              {DISCOVERY_INDEX_COPY.heading}
            </Heading>
          </CardTitle>
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
