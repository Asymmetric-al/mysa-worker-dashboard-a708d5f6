"use client";
/**
 * The exact-post receiving view of one published Update: the revision the service admitted for this
 * reader when this page was opened, placed unchanged through the one static renderer, inert, and
 * labelled as a simulated publication.
 *
 * This surface adjudicates nothing. The read behind it re-authorises on every open, and every sentence
 * it produces comes from the receiving copy module, so a denial, an unreadable source, a withdrawal and
 * a missing language each stay distinct and none of them is shown as an empty edition.
 */
import { useId, type ReactElement } from "react";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice, type NoticeHeadingLevel, type StateNoticeProps } from "@/components/state-notice";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import VideoPlayer from "@/components/video-player";
import { RECEIVING_POST_COPY, RECEIVING_SIMULATION_EFFECT } from "@/features/audience/copy/receiving";
import { useReceivingPost, type ReceivingPostEnvelope } from "@/features/audience/hooks/use-audience-reads";
import { cn } from "@/lib/cn";
import type { PreviewDenialReason } from "@/modules/content/preview";
import type { Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { EditionTombstone } from "./edition-tombstone";
import { ServerHtml } from "./message-reader";

// What the read hands this surface, taken from the read's own types so this file describes nothing twice
/** One edition as the read admitted it, with the language and direction it is served in. */
type PostData = ReceivingPostEnvelope["data"];
/** One admitted media reference: an opaque rendition identity and the scoped address it is read from. */
type PostRendition = PostData["renditions"][number];
/** The audience a released edition serves. */
type PostAudience = NonNullable<PostData["audience"]>;
/** The source identity the shared notice states when a read reports an outage. */
type DenialSource = NonNullable<StateNoticeProps["source"]>;
/** The reason code the shared notice states when a read refuses. */
type DenialCode = NonNullable<StateNoticeProps["reasonCode"]>;

/** The words this surface states in its own voice. Every sentence about access, language and simulation comes from the copy module. */
const LABELS = {
  headingFallback: "Update with no recorded title",
  readingAs: "Reading as",
  audience: "Audience",
  servedLanguage: "Language served",
  requestedLanguage: "Language requested",
  released: "Released",
  asOf: "As of",
  captions: "Captions",
  undeterminedLanguage: "und",
  videoTitle: "Video placed in this Update",
  retry: "Check this edition again",
  deniedTitle: "This edition cannot be read here",
  unavailableTitle: "This edition cannot be read at the moment",
  refusedTitle: "This request was refused",
} as const;

/** The audience word of each edition class, so the badge states which edition was served rather than only its title. */
const AUDIENCE_WORDS: Readonly<Record<PostAudience, StatusBadgeSpec>> = { public: { label: "Public", tone: "neutral" }, "approved-supporter": { label: "Approved supporters", tone: "info" } };
const HEADING_TAGS: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
const META_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground";
const META_PAIR_CLASS = "flex items-baseline gap-1.5";
const NOTE_CLASS = "text-sm text-muted-foreground text-pretty wrap-anywhere";

/** Every answer this surface renders. A denial, an unreadable source, a withdrawal and a missing language are four answers, never one. */
type PostSurface =
  | { readonly kind: "rendered"; readonly data: PostData; readonly asOf: string }
  | { readonly kind: "denied"; readonly sentence: string; readonly reasonCode: DenialCode | undefined }
  | { readonly kind: "language-unavailable"; readonly requestedLocale: string }
  | { readonly kind: "withdrawn" }
  | { readonly kind: "unavailable"; readonly source: DenialSource | undefined; readonly guidance: string }
  | { readonly kind: "refused"; readonly messages: readonly string[] };

/**
 * The closed preview vocabulary, each member placed on the one answer it renders. The record type is
 * what keeps this exhaustive: a seventh reason would fail to compile until it is placed here, and the
 * guard in {@link refusalSurface} makes a value from outside the set fail closed rather than fall
 * through to the reading view.
 */
const REFUSAL_SURFACES: Readonly<Record<PreviewDenialReason, (requestedLocale: string) => PostSurface>> = {
  "not-authorised": () => ({ kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices["not-authorised"], reasonCode: undefined }),
  "revision-not-acknowledged": () => ({ kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices["revision-not-acknowledged"], reasonCode: undefined }),
  unreleased: () => ({ kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices.unreleased, reasonCode: undefined }),
  "locale-not-admitted": (requestedLocale) => ({ kind: "language-unavailable", requestedLocale }),
  withdrawn: () => ({ kind: "withdrawn" }),
  unavailable: () => ({ kind: "unavailable", source: undefined, guidance: RECEIVING_POST_COPY.denialNotices.unavailable }),
};

function refusalSurface(reason: PreviewDenialReason, requestedLocale: string): PostSurface | undefined {
  if (!Object.hasOwn(REFUSAL_SURFACES, reason)) return undefined;
  return REFUSAL_SURFACES[reason](requestedLocale);
}

/** Reads one refusal's field messages as plain sentences, in the order the refusal stated them. */
function refusalMessages(fields: Readonly<Record<string, readonly string[]>>): readonly string[] {
  const messages: string[] = [];
  for (const key of Object.keys(fields).sort()) {
    const stated = fields[key];
    if (stated === undefined) continue;
    for (const message of stated) {
      if (!messages.includes(message)) messages.push(message);
    }
  }
  return messages;
}

/** The one answer this surface renders: the refusal the opening surface already holds, or the arm the read answered with. */
function postSurface(result: ReadResult<ReceivingPostEnvelope>, refusal: { readonly reason: PreviewDenialReason; readonly requestedLocale: string } | undefined): PostSurface {
  if (refusal !== undefined) {
    const decided = refusalSurface(refusal.reason, refusal.requestedLocale);
    if (decided !== undefined) return decided;
  }
  switch (result.kind) {
    case "denied":
      // The read refused before it enumerated anything, so the words say only that this access cannot
      // read this address: no title, no edition identity and no hint that something exists here.
      return { kind: "denied", sentence: RECEIVING_POST_COPY.denialNotices["not-authorised"], reasonCode: result.denied.reasonCode };
    case "unavailable":
      return { kind: "unavailable", source: result.unavailable.source, guidance: result.unavailable.guidance };
    case "refused":
      return { kind: "refused", messages: refusalMessages(result.refused.fields) };
    case "envelope": {
      const { data } = result.envelope;
      if (data.state === "rendered") return { kind: "rendered", data, asOf: result.envelope.asOf };
      return { kind: "language-unavailable", requestedLocale: data.requestedLocale };
    }
  }
}

/** The audience word of the edition that was served, or nothing when the read stated no audience. */
function audienceWordOf(audience: PostData["audience"]): StatusBadgeSpec | undefined {
  if (audience === null) return undefined;
  return Object.hasOwn(AUDIENCE_WORDS, audience) ? AUDIENCE_WORDS[audience] : { label: audience, tone: "muted" };
}

/** One asset's admitted renditions, grouped so a placement is decided once rather than three times. */
interface MediaGroup {
  readonly assetId: string;
  readonly playback: PostRendition | undefined;
  readonly poster: PostRendition | undefined;
  readonly captions: readonly PostRendition[];
}
function groupRenditions(renditions: readonly PostRendition[]): readonly MediaGroup[] {
  const grouped = new Map<string, { playback?: PostRendition; poster?: PostRendition; captions: PostRendition[] }>();
  for (const rendition of renditions) {
    const entry = grouped.get(rendition.assetId) ?? { captions: [] };
    if (rendition.purpose === "playback") entry.playback = rendition;
    else if (rendition.purpose === "poster") entry.poster = rendition;
    else if (rendition.purpose === "captions") entry.captions.push(rendition);
    grouped.set(rendition.assetId, entry);
  }
  return [...grouped].map(([assetId, entry]) => ({ assetId, playback: entry.playback, poster: entry.poster, captions: entry.captions }));
}

/** The words for a value the edition recorded nothing for, so an absent title is stated rather than rendered as "null". */
function titleWordsOf(data: PostData): string {
  const title = (data.title ?? "").trim();
  return title.length === 0 ? LABELS.headingFallback : title;
}

function DeniedSurface({ sentence, reasonCode, headingLevel }: { readonly sentence: string; readonly reasonCode: DenialCode | undefined; readonly headingLevel: NoticeHeadingLevel }): ReactElement {
  return (
    <div data-slot="receiving-post-denied">
      <StateNotice kind="denied" title={LABELS.deniedTitle} description={sentence} reasonCode={reasonCode} headingLevel={headingLevel} />
    </div>
  );
}

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

function UnavailableSurface({ source, guidance, headingLevel, onRetry }: { readonly source: DenialSource | undefined; readonly guidance: string; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: () => void }): ReactElement {
  return <StateNotice kind="unavailable" title={LABELS.unavailableTitle} description={guidance} source={source} retry={{ label: LABELS.retry, onClick: onRetry }} headingLevel={headingLevel} />;
}

function RefusedSurface({ messages, headingLevel }: { readonly messages: readonly string[]; readonly headingLevel: NoticeHeadingLevel }): ReactElement {
  return <StateNotice kind="refused" title={LABELS.refusedTitle} description={messages.length === 0 ? undefined : messages.join(" ")} headingLevel={headingLevel} />;
}

interface RenderedPostProps {
  readonly data: PostData;
  readonly asOf: string;
  readonly persona: string;
  readonly headingLevel: NoticeHeadingLevel;
  readonly onRefresh: () => void;
}
function RenderedPost({ data, asOf, persona, headingLevel, onRefresh }: RenderedPostProps): ReactElement {
  const titleId = useId();
  const servedTag = data.servedLocale?.tag.trim() ?? "";
  const direction = data.servedLocale?.direction ?? "ltr";
  const requested = data.requestedLocale.trim();
  const fallback = data.fallbackOccurred && requested.length > 0 && requested !== servedTag;
  const audience = audienceWordOf(data.audience);
  const publishedAt = data.publishedAt?.trim() ?? "";
  // The one renderer already places every admitted image and video exactly once inside the body it
  // produced, so this surface adds a player only for a video whose edition supplied no playback
  // rendition: a second player for an admitted one would stream and announce the same rendition twice.
  const unplayableVideos = groupRenditions(data.renditions).filter((group) => group.playback === undefined && (group.poster !== undefined || group.captions.length > 0));
  const Heading = HEADING_TAGS[headingLevel];
  return (
    <article data-slot="receiving-post" data-fallback={fallback ? "true" : "false"} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4 text-start">
      <header className="flex min-w-0 flex-col gap-2">
        <Heading id={titleId} dir={direction} className="font-heading text-xl font-medium break-words text-balance">
          {titleWordsOf(data)}
        </Heading>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {audience === undefined ? null : <StatusBadge label={audience.label} tone={audience.tone} srPrefix={LABELS.audience} />}
          {servedTag.length === 0 ? null : <StatusBadge label={servedTag} srPrefix={LABELS.servedLanguage} />}
          {fallback ? <StatusBadge label={requested} tone="muted" srPrefix={LABELS.requestedLanguage} /> : null}
        </div>
        <dl className={META_CLASS}>
          <div className={META_PAIR_CLASS}>
            <dt>{LABELS.readingAs}</dt>
            <dd>
              <bdi>{persona}</bdi>
            </dd>
          </div>
          {publishedAt.length === 0 ? null : (
            <div className={META_PAIR_CLASS}>
              <dt>{LABELS.released}</dt>
              <dd>
                <bdi>{publishedAt}</bdi>
              </dd>
            </div>
          )}
          <div className={META_PAIR_CLASS}>
            <dt>{LABELS.asOf}</dt>
            <dd>
              <bdi>{asOf}</bdi>
            </dd>
          </div>
        </dl>
      </header>
      <Card className="min-w-0">
        <CardContent>
          <ServerHtml html={data.html ?? ""} direction={direction} lang={servedTag.length === 0 ? undefined : servedTag} />
        </CardContent>
      </Card>
      {unplayableVideos.map((group) => (
        <VideoPlayer
          key={group.assetId}
          title={LABELS.videoTitle}
          poster={group.poster?.path}
          captions={group.captions.map((track) => ({ src: track.path, srcLang: servedTag.length === 0 ? LABELS.undeterminedLanguage : servedTag, label: LABELS.captions }))}
          state="unavailable"
          direction={direction}
          onRetry={onRefresh}
        />
      ))}
      <footer className="flex min-w-0 flex-col gap-2">
        {fallback ? <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.languageFallbackStatement(requested, servedTag)}</p> : null}
        <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.recheckStatement}</p>
        <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.inertStatement}</p>
        <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} context="block" />
      </footer>
    </article>
  );
}

/** Props of {@link ReceivingPost}. */
export interface ReceivingPostProps {
  /** The authority the server read this edition under. */
  readonly scope: Scope;
  /** The edition this address names, and the language it was asked for. */
  readonly params: { readonly updateId: string; readonly locale?: string };
  /** What the server's read answered: an envelope, a denial, an outage or a refusal. */
  readonly initialEnvelope: ReadResult<ReceivingPostEnvelope>;
  /** The seeded receiving persona this view is opened as, stated so the surface says whose access was checked. */
  readonly persona: string;
  /** The refusal the opening surface already holds, when it holds one: the closed preview vocabulary decides which answer is rendered. */
  readonly denialReason?: PreviewDenialReason;
  /** The page's own heading level, which the post title and every notice it renders instead of one inherit. */
  readonly headingLevel?: NoticeHeadingLevel;
  readonly className?: string;
}

/**
 * Renders one published Update at its exact post. The server re-authorises on every open, the surface
 * re-requests the route rather than deciding anything itself, and nothing here can post, subscribe,
 * publish or start a checkout.
 */
export function ReceivingPost({ scope, params, initialEnvelope, persona, denialReason, headingLevel = 1, className }: ReceivingPostProps): ReactElement {
  const { result, refresh, isFetching } = useReceivingPost({ scope, params, initialEnvelope });
  const requestedLocale = (params.locale ?? "").trim();
  const surface = postSurface(result, denialReason === undefined ? undefined : { reason: denialReason, requestedLocale });
  let content: ReactElement;
  switch (surface.kind) {
    case "rendered":
      content = <RenderedPost data={surface.data} asOf={surface.asOf} persona={persona} headingLevel={headingLevel} onRefresh={refresh} />;
      break;
    case "denied":
      content = <DeniedSurface sentence={surface.sentence} reasonCode={surface.reasonCode} headingLevel={headingLevel} />;
      break;
    case "language-unavailable":
      content = <LanguageUnavailableSurface requestedLocale={surface.requestedLocale} headingLevel={headingLevel} />;
      break;
    case "withdrawn":
      content = <EditionTombstone />;
      break;
    case "unavailable":
      content = <UnavailableSurface source={surface.source} guidance={surface.guidance} headingLevel={headingLevel} onRetry={refresh} />;
      break;
    case "refused":
      content = <RefusedSurface messages={surface.messages} headingLevel={headingLevel} />;
      break;
  }
  return (
    <section data-slot="receiving-post-surface" data-surface={surface.kind} aria-busy={isFetching ? true : undefined} className={cn("min-w-0", className)}>
      {content}
    </section>
  );
}

export default ReceivingPost;
