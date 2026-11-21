import { Fragment, useId, type ReactElement, type ReactNode } from "react";
import { DraftStatus, lifecycleOf } from "@/components/draft-status";
import RenderedContent from "@/components/rendered-content";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice, type NoticeHeadingLevel, type NoticeRetry } from "@/components/state-notice";
import StatusBadge, { valueStateWord } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { isReleaseUnchanged, type ContentRevision, type ContentVariant, type Release } from "@/modules/content/variant";
import type { ValueState } from "@/modules/data-service/envelope";
import { AUDIENCE_LABELS, DRAFT_VS_RELEASED, LOCALE_DISPLAY_NAMES } from "../copy/updates-copy";
export type ComparisonRevisionSide = { readonly revision: ContentRevision; readonly renderedHtml: string; readonly asOf: string; readonly author: string };
export type ComparisonSide<TRevision> = ({ readonly status: "revision" } & ComparisonRevisionSide & TRevision) | { readonly status: "none" } | { readonly status: "withheld" } | { readonly status: "unavailable"; readonly source?: SourceReference; readonly onRetry?: () => void | Promise<void> };
export type ComparisonDraftSide = ComparisonSide<Record<never, never>>;
export type ComparisonReleaseSide = ComparisonSide<{ readonly release: Release }>;
export const COMPARISON_CHANGE_KINDS = ["section", "media"] as const;
export type ComparisonChangeKind = (typeof COMPARISON_CHANGE_KINDS)[number];
export type ComparisonSectionChange = { readonly kind: "section"; readonly element: string; readonly headingPath: readonly string[]; readonly state?: ValueState };
export type ComparisonMediaChange = { readonly kind: "media"; readonly placementId: string; readonly renditionPurpose: string; readonly state?: ValueState };
export type ComparisonChange = ComparisonSectionChange | ComparisonMediaChange;
const COMPARISON_HEADING = "Compare with the last release";
const COMPARISON_MEANING_TITLE = "What this comparison shows";
const CHANGES_HEADING = "What the read reported as changed";
const DRAFT_PANE_TITLE = "Working draft";
const RELEASE_PANE_TITLE = "Last release";
const TAB_LIST_LABEL = "Choose which revision to read";
const RETRY_LABEL = "Try this read again";
const METADATA_LABELS = { revision: "Revision", checksum: "Checksum", author: "Author", asOf: "Read at" } as const;
const ABSENCE_COPY = {
  draftNone: { title: "No acknowledged revision yet", description: "Nothing has been saved and acknowledged for this edition, so there is no working revision to " + "compare with the last release. A save whose acknowledgement never arrived leaves nothing " + "acknowledged here." },
  releaseNone: { title: "No prior release", description: "Nothing has been published for this audience and language yet, so there is no released " + "revision to compare the draft with. This is an absence of a release, not a draft with no " + "changes." },
  withheld: { title: "This comparison cannot show the released revision", description: "The comparison shows the working draft on its own and states no fact about the released " + "revision — not its title, its checksum, its size or its content." },
  unavailable: { title: "The content source could not be read", description: "The other side is shown as it was read, so the comparison stays usable while this side is " + "unreadable, and nothing on this pane stands in for what the source holds." },
} as const;
const NO_CHANGE_LIST_NOTE = "This comparison shows the two revisions, their checksums and their authors. The read supplied no " + "change list, so no difference is claimed here.";
const NO_CHANGES_NOTE = "No changes were reported between these revisions.";
const SAME_CHECKSUM_NOTE = "The two checksums are identical, so the last release publishes exactly the revision shown as the " + "working draft.";
const RELEASE_UNCHANGED_BY_DRAFT_NOTE = "The last release still publishes the revision shown beside it. A draft edit changes nothing a " + "reader can open until a new release is published.";
const CHANGE_KIND_WORDS: Readonly<Record<ComparisonChangeKind, string>> = { section: "Section", media: "Media placement" };
const VALUE_STATE_PREFIX = "Value state";
const HEADING_TAG: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
const NESTED_HEADING_LEVEL: Readonly<Record<NoticeHeadingLevel, 2 | 3 | 4>> = { 1: 2, 2: 3, 3: 4, 4: 4 };
const RENDERED_COMPARISON = cn("flex min-w-0 flex-col gap-3 text-sm text-pretty wrap-anywhere", "[&_p]:mb-3 [&_p:last-child]:mb-0", "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4", "[&_img]:h-auto [&_img]:max-w-full [&_video]:max-w-full");
type ContentTextDirection = ContentVariant["locale"]["direction"];
function Heading({ level, id, className, children }: { readonly level: NoticeHeadingLevel; readonly id: string; readonly className: string; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}
const changeStateWord = (state: ValueState | undefined): string | undefined => (state === undefined ? undefined : valueStateWord(state)?.label);
const changeIdentifier = (change: ComparisonChange): string => (change.kind === "section" ? change.element : change.placementId);
const headingPathText = (change: ComparisonSectionChange): string =>
  change.headingPath
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .join(" › ");
function changeDetail(change: ComparisonChange): ReactNode {
  if (change.kind === "section") {
    const path = headingPathText(change);
    return path.length === 0 ? null : (
      <>
        {"under "}
        <bdi className="wrap-anywhere">{path}</bdi>
      </>
    );
  }
  return (
    <>
      <bdi>{change.renditionPurpose}</bdi>
      {" rendition"}
    </>
  );
}
function ChangeItem({ change }: { readonly change: ComparisonChange }): ReactElement {
  const word = changeStateWord(change.state);
  const detail = changeDetail(change);
  return (
    <li data-comparison-change={change.kind} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="font-medium">{CHANGE_KIND_WORDS[change.kind]}</span>
      <bdi className="mono-identifier wrap-anywhere">{changeIdentifier(change)}</bdi>
      {detail === null ? null : <span className="text-muted-foreground">{detail}</span>}
      {word === undefined ? null : (
        <span className="text-muted-foreground">
          <span className="sr-only">{`${VALUE_STATE_PREFIX}: `}</span>
          <bdi>{word}</bdi>
        </span>
      )}
    </li>
  );
}
type ChangeListProps = { readonly changes: readonly ComparisonChange[] | undefined; readonly unchanged: boolean; readonly headingLevel: NoticeHeadingLevel; readonly headingId: string };
function ChangeList({ changes, unchanged, headingLevel, headingId }: ChangeListProps): ReactElement {
  const body =
    changes === undefined ? (
      <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{NO_CHANGE_LIST_NOTE}</p>
    ) : changes.length === 0 ? (
      <p className="text-sm text-pretty wrap-anywhere">{NO_CHANGES_NOTE}</p>
    ) : (
      <ul className="flex min-w-0 list-none flex-col gap-1 p-0">
        {changes.map((change, index) => (
          <ChangeItem key={`${change.kind}:${changeIdentifier(change)}:${index}`} change={change} />
        ))}
      </ul>
    );
  return (
    <section data-slot="comparison-changes" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <Heading level={headingLevel} id={headingId} className="text-sm font-medium">
        {CHANGES_HEADING}
      </Heading>
      {body}
      <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{unchanged ? SAME_CHECKSUM_NOTE : RELEASE_UNCHANGED_BY_DRAFT_NOTE}</p>
    </section>
  );
}
type SideNoticeProps = { readonly side: "draft" | "release"; readonly reading: Exclude<ComparisonDraftSide, { readonly status: "revision" }>; readonly headingLevel: NoticeHeadingLevel };
function SideNotice({ side, reading, headingLevel }: SideNoticeProps): ReactElement {
  if (reading.status === "none") {
    const copy = side === "draft" ? ABSENCE_COPY.draftNone : ABSENCE_COPY.releaseNone;
    return <StateNotice kind="empty" title={copy.title} description={copy.description} headingLevel={headingLevel} className="min-w-0" />;
  }
  if (reading.status === "withheld") return <StateNotice kind="denied" title={ABSENCE_COPY.withheld.title} description={ABSENCE_COPY.withheld.description} headingLevel={headingLevel} className="min-w-0" />;
  const retry: NoticeRetry | undefined = reading.onRetry === undefined ? undefined : { label: RETRY_LABEL, onClick: reading.onRetry };
  return <StateNotice kind="unavailable" title={ABSENCE_COPY.unavailable.title} description={ABSENCE_COPY.unavailable.description} source={reading.source} retry={retry} headingLevel={headingLevel} className="min-w-0" />;
}
type ComparisonPaneProps = { readonly side: "draft" | "release"; readonly title: string; readonly headingId: string; readonly headingLevel: NoticeHeadingLevel; readonly direction: ContentTextDirection; readonly lang: string; readonly scrollLabel: string; readonly reading: ComparisonDraftSide };
function ComparisonPane({ side, title, headingId, headingLevel, direction, lang, scrollLabel, reading }: ComparisonPaneProps): ReactElement {
  if (reading.status !== "revision") return <SideNotice side={side} reading={reading} headingLevel={headingLevel} />;
  return (
    <Card data-comparison-pane={side} aria-labelledby={headingId} dir={direction} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Heading level={headingLevel} id={headingId} className="text-base font-medium text-pretty">
            {title}
          </Heading>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {(
            [
              ["revision", reading.revision.revisionId, true],
              ["checksum", reading.revision.contentChecksum, true],
              ["author", reading.author, false],
              ["asOf", reading.asOf, false],
            ] as const
          ).map(([label, value, mono]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{METADATA_LABELS[label]}</dt>
              <dd className="min-w-0 wrap-anywhere">{mono ? <bdi className="mono-identifier">{value}</bdi> : <bdi>{value}</bdi>}</dd>
            </Fragment>
          ))}
        </dl>
        <ScrollRegion label={scrollLabel} className="rounded-lg">
          {/* This side's only insertion point: the revision's server-rendered HTML, handed unchanged to the application's single rendering boundary. */}
          <RenderedContent html={reading.renderedHtml} direction={direction} lang={lang} slot="comparison-content" className={RENDERED_COMPARISON} />
        </ScrollRegion>
      </CardContent>
    </Card>
  );
}
export type CompareWithReleaseProps = { readonly variant: ContentVariant; readonly draft: ComparisonDraftSide; readonly release: ComparisonReleaseSide; readonly changes?: readonly ComparisonChange[]; readonly headingLevel?: NoticeHeadingLevel; readonly className?: string };
export function CompareWithRelease({ variant, draft, release, changes, headingLevel = 2, className }: CompareWithReleaseProps): ReactElement {
  // One id per heading this surface owns, so no two labelled regions collide.
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const changesId = `${baseId}-changes`;
  const nestedLevel = NESTED_HEADING_LEVEL[headingLevel];
  const direction = variant.locale.direction;
  const audienceLabel = AUDIENCE_LABELS[variant.audience].label;
  const localeName = LOCALE_DISPLAY_NAMES[variant.locale.tag] ?? variant.locale.tag;
  // The edition's own lifecycle: a refused or unreadable release side contributes no release.
  const lifecycle = lifecycleOf(variant, release.status === "revision" ? release.release : undefined);
  // Asked of the variant module, and only when both sides are readable: no pair, no claim.
  let releaseStillCurrent: boolean | undefined;
  if (draft.status === "revision" && release.status === "revision") releaseStillCurrent = isReleaseUnchanged(release.release, draft.revision);
  const draftPane = (composition: "narrow" | "wide"): ReactElement => <ComparisonPane side="draft" title={DRAFT_PANE_TITLE} headingId={`${baseId}-draft-${composition}`} headingLevel={nestedLevel} direction={direction} lang={variant.locale.tag} scrollLabel={`${DRAFT_PANE_TITLE} content, scrollable`} reading={draft} />;
  const releasePane = (composition: "narrow" | "wide"): ReactElement => (
    <ComparisonPane side="release" title={RELEASE_PANE_TITLE} headingId={`${baseId}-release-${composition}`} headingLevel={nestedLevel} direction={direction} lang={variant.locale.tag} scrollLabel={`${RELEASE_PANE_TITLE} content, scrollable`} reading={release} />
  );
  return (
    <section data-slot="compare-with-release" aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <header className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Heading level={headingLevel} id={titleId} className="text-base font-medium text-pretty">
            {COMPARISON_HEADING}
          </Heading>
          <StatusBadge label={audienceLabel} srPrefix="Audience" />
          <span className="text-sm text-muted-foreground">
            <bdi>{localeName}</bdi>
          </span>
        </div>
        <DraftStatus state={lifecycle} />
        {/* A static explanation, not an alarm: the pass leaves the announcing region to the notices that report a change of condition. */}
        <Alert role={undefined}>
          <AlertTitle>{COMPARISON_MEANING_TITLE}</AlertTitle>
          <AlertDescription>
            <p>{DRAFT_VS_RELEASED.draftIsNotWhatReadersSee}</p>
            <p>{DRAFT_VS_RELEASED.releaseIsWhatRecipientsReceive}</p>
          </AlertDescription>
        </Alert>
      </header>
      {releaseStillCurrent === undefined ? null : <ChangeList changes={changes} unchanged={releaseStillCurrent} headingLevel={nestedLevel} headingId={changesId} />}
      <div className="md:hidden">
        <Tabs defaultValue="draft" className="gap-3">
          <TabsList aria-label={TAB_LIST_LABEL}>
            <TabsTrigger value="draft">{DRAFT_PANE_TITLE}</TabsTrigger>
            <TabsTrigger value="release">{RELEASE_PANE_TITLE}</TabsTrigger>
          </TabsList>
          {/* Each panel is named as well as by its tab: the label keeps it identifiable before the tab primitive links it, so a reader is never placed in an unnamed region. */}
          <TabsContent value="draft" aria-label={DRAFT_PANE_TITLE}>
            {draftPane("narrow")}
          </TabsContent>
          <TabsContent value="release" aria-label={RELEASE_PANE_TITLE}>
            {releasePane("narrow")}
          </TabsContent>
        </Tabs>
      </div>
      <div className="hidden min-w-0 gap-4 md:grid md:grid-cols-2 md:items-start">
        {draftPane("wide")}
        {releasePane("wide")}
      </div>
    </section>
  );
}
export default CompareWithRelease;
