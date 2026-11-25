"use client";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { useId, type ReactElement } from "react";
import SimulationLabel from "@/components/simulation-label";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS, statusBadgeProps, VALUE_STATE_WORDS } from "@/components/status-badge";
import { AnimatedListItem } from "@/components/ui/animated-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { DISCOVERY_INDEX_COPY, RECEIVING_SIMULATION_EFFECT } from "@/features/audience/copy/receiving";
import { useDiscoveryIndex, type DiscoveryIndexEnvelope } from "@/features/audience/hooks/use-audience-reads";
import { cn } from "@/lib/cn";
import { languageNameOf } from "@/lib/language-name";
import type { Scope, ValueState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
export type DiscoveryIndexProps = { readonly scope: Scope; readonly initialEnvelope: ReadResult<DiscoveryIndexEnvelope>; readonly headingLevel?: NoticeHeadingLevel; readonly className?: string };
const HEADING_TAGS: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's heading utility for each level, so this surface's heading takes the measure of the level the composing page gives it rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<NoticeHeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const LISTED_STATUS = statusBadgeProps(REACH_STATUS, "listed");
const DENIED_DESCRIPTION = "The read was refused before it listed anything, so nothing here states how many editions are listed publicly, what they are called or whether any exists at all.";
function ListedEditionRow({ edition, index }: { readonly edition: DiscoveryIndexEnvelope["data"]["entries"][number]; readonly index: number }): ReactElement {
  const title = edition.title.trim();
  return (
    <li data-slot="discovery-edition" className="min-w-0">
      <AnimatedListItem index={index} className="h-full">
        <SpotlightCard className="h-full rounded-2xl">
          <Link
            href={edition.href}
            className="group/edition flex h-full min-h-20 min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-4 text-start transition-colors hover:border-foreground/30 hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              {title === "" ? (
                <span className="text-sm font-medium text-muted-foreground">Untitled edition</span>
              ) : (
                <bdi className="inline-link text-sm font-medium text-foreground text-pretty wrap-anywhere">{title}</bdi>
              )}
              <ArrowUpRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/edition:translate-x-0.5 group-hover/edition:-translate-y-0.5 rtl:-scale-x-100" />
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground wrap-anywhere">
                <span className="sr-only">Language: </span>
                <bdi lang={edition.locale.tag}>{languageNameOf(edition.locale.tag)}</bdi>
              </span>
              <StatusBadge label={LISTED_STATUS.label} tone={LISTED_STATUS.tone} srPrefix="Reach" />
            </div>
          </Link>
        </SpotlightCard>
      </AnimatedListItem>
    </li>
  );
}
function EditionCountStatement({ shown, page, state }: { readonly shown: number; readonly page: DiscoveryIndexEnvelope["data"]["page"]; readonly state: ValueState | undefined }): ReactElement {
  if (state !== undefined && state !== "value" && state !== "zero") {
    const word = VALUE_STATE_WORDS[state];
    return (
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <StatusBadge label={word.label} tone={word.tone} srPrefix="Edition count" />
        <span className="text-pretty wrap-anywhere">The read did not state how many editions are listed publicly, so no count is shown here and none is derived from the editions on screen.</span>
      </p>
    );
  }
  const total = page.total;
  if (total === 0) return <p className="text-xs text-muted-foreground">No editions are listed publicly.</p>;
  if (total === 1)
    return (
      <p className="text-xs text-muted-foreground">
        <bdi>{total}</bdi>
        {" edition is listed publicly."}
      </p>
    );
  if (shown < total)
    return (
      <p className="text-xs text-muted-foreground">
        {"Showing the first "}
        <bdi>{shown}</bdi>
        {" of "}
        <bdi>{total}</bdi>
        {" editions listed publicly."}
      </p>
    );
  return (
    <p className="text-xs text-muted-foreground">
      <bdi>{total}</bdi>
      {" editions are listed publicly."}
    </p>
  );
}
function IndexBody({ result, headingLevel, onRetry }: { readonly result: ReadResult<DiscoveryIndexEnvelope>; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: () => void }): ReactElement {
  const noticeLevel = ((headingLevel: NoticeHeadingLevel): NoticeHeadingLevel => (headingLevel === 1 ? 2 : headingLevel === 2 ? 3 : 4))(headingLevel);
  switch (result.kind) {
    case "envelope": {
      const { entries, page } = result.envelope.data;
      const countStatement = <EditionCountStatement shown={entries.length} page={page} state={result.envelope.valueStates["page.total"]} />;
      if (entries.length === 0)
        return (
          <>
            <StateNotice kind="empty" headingLevel={noticeLevel} title={DISCOVERY_INDEX_COPY.emptyTitle} description={DISCOVERY_INDEX_COPY.emptyDescription} />
            {countStatement}
          </>
        );
      return (
        <div className="flex min-w-0 flex-col gap-3">
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            {entries.map((edition, index) => (
              <ListedEditionRow key={edition.href} edition={edition} index={index} />
            ))}
          </ul>
          {countStatement}
        </div>
      );
    }
    case "denied":
      return <StateNotice kind="denied" headingLevel={noticeLevel} title="This index is not available in this context" description={DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={noticeLevel} title={`${DISCOVERY_INDEX_COPY.heading} could not be read`} description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: "Read this index again", onClick: onRetry }} />;
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
      <Card className="overflow-hidden">
        <CardHeader className="relative overflow-hidden bg-surface-subtle/75">
          <div aria-hidden="true" className="bg-dot-grid bg-dot-grid-fade pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative flex min-w-0 flex-col gap-1.5">
            <CardTitle>
              <Heading {...{ id: headingId, className: cn(HEADING_SCALE[headingLevel], "text-balance") }}>{DISCOVERY_INDEX_COPY.heading}</Heading>
            </CardTitle>
            <CardDescription className="max-w-prose text-pretty">{DISCOVERY_INDEX_COPY.description}</CardDescription>
            <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} />
          </div>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <IndexBody result={result} headingLevel={headingLevel} onRetry={refresh} />
        </CardContent>
      </Card>
    </section>
  );
}
export default DiscoveryIndex;
