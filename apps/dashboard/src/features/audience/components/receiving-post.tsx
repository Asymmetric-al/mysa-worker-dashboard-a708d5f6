"use client";
import Link from "next/link";
import { useId, type ReactElement } from "react";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice, type NoticeHeadingLevel, type StateNoticeProps } from "@/components/state-notice";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DirectionProvider } from "@/components/ui/direction";
import { ReadingProgressBar } from "@/components/ui/reading-progress";
import VideoPlayer from "@/components/video-player";
import { PREFERENCES_ENTRY_COPY } from "@/features/audience/copy/preferences";
import { RECEIVING_POST_COPY, RECEIVING_SIMULATION_EFFECT } from "@/features/audience/copy/receiving";
import { useReceivingPost, type ReceivingPostEnvelope } from "@/features/audience/hooks/use-audience-reads";
import { cn } from "@/lib/cn";
import { estimateReadingMinutes } from "@/lib/editorial-metrics";
import type { PreviewDenialReason } from "@/modules/content/preview";
import type { Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { EditionTombstone } from "./edition-tombstone";
import { ServerHtml } from "./message-reader";
type PostData = ReceivingPostEnvelope["data"];
type PostRendition = PostData["renditions"][number];
type DenialSource = NonNullable<StateNoticeProps["source"]>;
type DenialCode = NonNullable<StateNoticeProps["reasonCode"]>;
const LABELS = {
  headingFallback: "Untitled update",
  readingAs: "Previewing as",
  audience: "Audience",
  servedLanguage: "Language",
  requestedLanguage: "Requested language",
  released: "Published",
  asOf: "Checked",
  captions: "Captions",
  undeterminedLanguage: "und",
  videoTitle: "Update video",
  retry: "Try again",
  deniedTitle: "This update isn’t available",
  unavailableTitle: "Couldn’t load this update",
  refusedTitle: "Couldn’t open this update",
} as const;
const AUDIENCE_WORDS: Readonly<Record<NonNullable<PostData["audience"]>, StatusBadgeSpec>> = { public: { label: "Public", tone: "neutral" }, "approved-supporter": { label: "Approved supporters", tone: "info" } };
const HEADING_TAGS: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's heading utility for each level, so this surface's heading takes the measure of the level the composing page gives it rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<NoticeHeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const NOTE_CLASS = "type-supporting text-pretty wrap-anywhere";
type PostSurface =
  | { readonly kind: "rendered"; readonly data: PostData; readonly asOf: string }
  | { readonly kind: "denied"; readonly sentence: string; readonly reasonCode: DenialCode | undefined }
  | { readonly kind: "language-unavailable"; readonly requestedLocale: string }
  | { readonly kind: "withdrawn" }
  | { readonly kind: "unavailable"; readonly source: DenialSource | undefined; readonly guidance: string }
  | { readonly kind: "refused"; readonly messages: readonly string[] };
const REFUSAL_SURFACES: Readonly<Record<PreviewDenialReason, (requestedLocale: string) => PostSurface>> = {
  "not-authorised": () => ({ kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices["not-authorised"], reasonCode: undefined }),
  "revision-not-acknowledged": () => ({ kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices["revision-not-acknowledged"], reasonCode: undefined }),
  unreleased: () => ({ kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices.unreleased, reasonCode: undefined }),
  "locale-not-admitted": (requestedLocale) => ({ kind: "language-unavailable", requestedLocale }),
  withdrawn: () => ({ kind: "withdrawn" }),
  unavailable: () => ({ kind: "unavailable", source: undefined, guidance: RECEIVING_POST_COPY.denialNotices.unavailable }),
};
const refusalMessages = (fields: Readonly<Record<string, readonly string[]>>): readonly string[] => [
  ...new Set(
    Object.keys(fields)
      .sort()
      .flatMap((key) => fields[key] ?? []),
  ),
];
function postSurface(result: ReadResult<ReceivingPostEnvelope>, refusal: { readonly reason: PreviewDenialReason; readonly requestedLocale: string } | undefined): PostSurface {
  const decided = refusal === undefined ? undefined : ((reason: PreviewDenialReason, requestedLocale: string): PostSurface | undefined => (!Object.hasOwn(REFUSAL_SURFACES, reason) ? undefined : REFUSAL_SURFACES[reason](requestedLocale)))(refusal.reason, refusal.requestedLocale);
  if (decided !== undefined) return decided;
  switch (result.kind) {
    case "denied":
      return { kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices["not-authorised"], reasonCode: result.denied.reasonCode };
    case "unavailable":
      return { kind: "unavailable", source: result.unavailable.source, guidance: result.unavailable.guidance };
    case "refused":
      return { kind: "refused", messages: refusalMessages(result.refused.fields) };
    case "envelope": {
      const { data } = result.envelope;
      return data.state === "rendered" ? { kind: "rendered", data, asOf: result.envelope.asOf } : { kind: "language-unavailable", requestedLocale: data.requestedLocale };
    }
  }
}
type MediaGroup = { readonly assetId: string; readonly playback: PostRendition | undefined; readonly poster: PostRendition | undefined; readonly captions: readonly PostRendition[]; readonly state: PostRendition["state"] };
function groupRenditions(renditions: readonly PostRendition[]): readonly MediaGroup[] {
  const grouped = new Map<string, { playback?: PostRendition; poster?: PostRendition; captions: PostRendition[]; state: PostRendition["state"] }>();
  for (const rendition of renditions) {
    // Every rendition of one asset answers with the same state, because one serving rule judges them: the first one this group meets states it for the group.
    const entry = grouped.get(rendition.assetId) ?? { captions: [], state: rendition.state };
    if (rendition.purpose === "playback") entry.playback = rendition;
    else if (rendition.purpose === "poster") entry.poster = rendition;
    else if (rendition.purpose === "captions") entry.captions.push(rendition);
    grouped.set(rendition.assetId, entry);
  }
  return [...grouped].map(([assetId, entry]) => ({ assetId, playback: entry.playback, poster: entry.poster, captions: entry.captions, state: entry.state }));
}
const DeniedSurface = ({ sentence, reasonCode, headingLevel }: { readonly sentence: string; readonly reasonCode: DenialCode | undefined; readonly headingLevel: NoticeHeadingLevel }): ReactElement => (
  <div data-slot="receiving-post-denied">
    <StateNotice kind="denied" title={LABELS.deniedTitle} description={sentence} reasonCode={reasonCode} headingLevel={headingLevel} />
  </div>
);
function LanguageUnavailableSurface({ requestedLocale, headingLevel }: { readonly requestedLocale: string; readonly headingLevel: NoticeHeadingLevel }): ReactElement {
  const requested = requestedLocale.trim();
  return (
    <div data-slot="receiving-post-language-unavailable" data-requested-locale={requested} className="flex min-w-0 flex-col gap-2">
      <StateNotice kind="language-unavailable" title={RECEIVING_POST_COPY.languageUnavailable.title} description={RECEIVING_POST_COPY.languageUnavailable.description} headingLevel={headingLevel} />
      {requested.length === 0 ? null : (
        <p className={NOTE_CLASS}>
          {LABELS.requestedLanguage}: <bdi>{requested}</bdi>
        </p>
      )}
    </div>
  );
}
const UnavailableSurface = ({ source, guidance, headingLevel, onRetry }: { readonly source: DenialSource | undefined; readonly guidance: string; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: () => void }): ReactElement => (
  <StateNotice kind="unavailable" title={LABELS.unavailableTitle} description={guidance} source={source} retry={{ label: LABELS.retry, onClick: onRetry }} headingLevel={headingLevel} />
);
const RefusedSurface = ({ messages, headingLevel }: { readonly messages: readonly string[]; readonly headingLevel: NoticeHeadingLevel }): ReactElement => <StateNotice kind="refused" title={LABELS.refusedTitle} description={messages.length === 0 ? undefined : messages.join(" ")} headingLevel={headingLevel} />;
function RenderedPost({ data, asOf, persona, headingLevel, onRefresh }: { readonly data: PostData; readonly asOf: string; readonly persona: string; readonly headingLevel: NoticeHeadingLevel; readonly onRefresh: () => void }): ReactElement {
  const titleId = useId();
  const servedTag = data.servedLocale?.tag.trim() ?? "";
  const direction = data.servedLocale?.direction ?? "ltr";
  const requested = data.requestedLocale.trim();
  const fallback = data.fallbackOccurred && requested.length > 0 && requested !== servedTag;
  const audience = ((audience: PostData["audience"]): StatusBadgeSpec | undefined => (audience === null ? undefined : Object.hasOwn(AUDIENCE_WORDS, audience) ? AUDIENCE_WORDS[audience] : { label: audience, tone: "muted" }))(data.audience);
  const publishedAt = data.publishedAt?.trim() ?? "";
  // A group is stated here when this reading cannot play it: its playback rendition is absent, or the source that rendition points at could not be read.
  const unplayableVideos = groupRenditions(data.renditions).filter((group) => (group.playback === undefined ? group.poster !== undefined || group.captions.length > 0 : group.state === "unavailable"));
  const Heading = HEADING_TAGS[headingLevel];
  const readingMinutes = estimateReadingMinutes(data.html ?? "");
  return (
    <DirectionProvider direction={direction}>
      <article data-slot="receiving-post" data-fallback={fallback ? "true" : "false"} aria-labelledby={titleId} className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 text-start">
        <ReadingProgressBar />
        <header className="relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border/80 bg-surface-subtle p-5 sm:p-6">
          <div aria-hidden="true" className="bg-dot-grid bg-dot-grid-fade pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative flex min-w-0 flex-wrap items-center gap-2">
            {audience === undefined ? null : <StatusBadge label={audience.label} tone={audience.tone} srPrefix={LABELS.audience} />}
            {servedTag.length === 0 ? null : <StatusBadge label={servedTag} srPrefix={LABELS.servedLanguage} />}
            {fallback ? <StatusBadge label={requested} tone="muted" srPrefix={LABELS.requestedLanguage} /> : null}
            {readingMinutes === null ? null : (
              <Badge variant="secondary" data-slot="reading-time-badge" className="tabular-figures">
                {`${String(readingMinutes)} min read`}
              </Badge>
            )}
          </div>
          <Heading {...{ id: titleId, dir: direction, className: cn("relative", HEADING_SCALE[headingLevel], "break-words text-balance") }}>{(data.title ?? "").trim().length === 0 ? LABELS.headingFallback : (data.title ?? "").trim()}</Heading>
          <dl className="relative flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {[{ label: LABELS.readingAs, value: persona }, ...(publishedAt.length === 0 ? [] : [{ label: LABELS.released, value: publishedAt }]), { label: LABELS.asOf, value: asOf }].map((pair) => (
              <div key={pair.label} className="flex items-baseline gap-1.5">
                <dt className="font-medium text-foreground/80">{pair.label}</dt>
                <dd>
                  <bdi>{pair.value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </header>
        <Card className="min-w-0 shadow-xs">
          <CardContent className="editorial-reading px-5 py-6 sm:px-8 sm:py-7">
            <ServerHtml html={data.html ?? ""} direction={direction} lang={servedTag.length === 0 ? undefined : servedTag} />
          </CardContent>
        </Card>
        {unplayableVideos.map((group) => {
          // A group whose source is down is stated in words and offers the retry this surface re-reads with, and is given none of the addresses it cannot fetch: its poster and its caption track stay unrequested.
          const unreadable = group.state === "unavailable";
          const captions = unreadable ? undefined : group.captions.map((track) => ({ src: track.path, srcLang: servedTag.length === 0 ? LABELS.undeterminedLanguage : servedTag, label: LABELS.captions }));
          return <VideoPlayer key={group.assetId} title={LABELS.videoTitle} poster={unreadable ? undefined : group.poster?.path} captions={captions} state="unavailable" direction={direction} onRetry={onRefresh} />;
        })}
        <footer className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/80 bg-surface-subtle/60 p-4">
          {fallback ? <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.languageFallbackStatement(requested, servedTag)}</p> : null}
          <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.recheckStatement}</p>
          <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.inertStatement}</p>
          <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} context="block" />
        </footer>
      </article>
    </DirectionProvider>
  );
}
const PreferencesEntryPoint = (): ReactElement => (
  <footer data-slot="receiving-post-preferences" className="mt-4 flex min-w-0 flex-col gap-1.5">
    <p className={NOTE_CLASS}>{PREFERENCES_ENTRY_COPY.description}</p>
    <Link {...{ href: "/preview/preferences", className: "inline-link inline-flex min-h-6 max-w-full items-center break-words text-start hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" }}>{PREFERENCES_ENTRY_COPY.linkLabel}</Link>
  </footer>
);
/** Props of {@link ReceivingPost}. */ export interface ReceivingPostProps {
  readonly scope: Scope;
  readonly params: { readonly updateId: string; readonly locale?: string; readonly variant?: string };
  readonly initialEnvelope: ReadResult<ReceivingPostEnvelope>;
  readonly persona: string;
  readonly denialReason?: PreviewDenialReason;
  readonly headingLevel?: NoticeHeadingLevel;
  readonly className?: string;
}
function surfaceView(surface: PostSurface, context: { readonly persona: string; readonly headingLevel: NoticeHeadingLevel; readonly refresh: () => void }): ReactElement {
  switch (surface.kind) {
    case "rendered":
      return <RenderedPost data={surface.data} asOf={surface.asOf} persona={context.persona} headingLevel={context.headingLevel} onRefresh={context.refresh} />;
    case "denied":
      return <DeniedSurface sentence={surface.sentence} reasonCode={surface.reasonCode} headingLevel={context.headingLevel} />;
    case "language-unavailable":
      return <LanguageUnavailableSurface requestedLocale={surface.requestedLocale} headingLevel={context.headingLevel} />;
    case "withdrawn":
      return <EditionTombstone />;
    case "unavailable":
      return <UnavailableSurface source={surface.source} guidance={surface.guidance} headingLevel={context.headingLevel} onRetry={context.refresh} />;
    case "refused":
      return <RefusedSurface messages={surface.messages} headingLevel={context.headingLevel} />;
  }
}
/** Renders one published Update at its exact post. */ export function ReceivingPost({ scope, params, initialEnvelope, persona, denialReason, headingLevel = 1, className }: ReceivingPostProps): ReactElement {
  const { result, refresh, isFetching } = useReceivingPost({ scope, params, initialEnvelope });
  const requestedLocale = (params.locale ?? "").trim();
  const surface = postSurface(result, denialReason === undefined ? undefined : { reason: denialReason, requestedLocale });
  return (
    <section data-slot="receiving-post-surface" data-surface={surface.kind} aria-busy={isFetching ? true : undefined} className={cn("min-w-0", className)}>
      {surfaceView(surface, { persona, headingLevel, refresh })}
      <PreferencesEntryPoint />
    </section>
  );
}
export default ReceivingPost;
