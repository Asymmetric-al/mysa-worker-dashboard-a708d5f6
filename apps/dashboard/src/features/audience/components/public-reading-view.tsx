"use client";
/** The public reading view: the one surface that serves a released Page edition reached by direct link. **Authority.** The read decides reach, language, media and the Give binding; this surface renders that answer and offers no way to change it. */

import type { ReactElement } from "react";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS, statusBadgeProps } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DirectionProvider } from "@/components/ui/direction";
import { Separator } from "@/components/ui/separator";
import { VideoPlayer, type VideoPlayerCaption } from "@/components/video-player";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";
import type { ReleaseReach } from "@/modules/content/variant";
import type { Scope } from "@/modules/data-service/envelope";
import type { DeniedOutcome, ReadResult, UnavailableOutcome } from "@/modules/data-service/outcome";
import { GIVING_SIMULATION_EFFECT, GIVING_UNAVAILABLE_COPY, REACH_COPY, RECEIVING_POST_COPY, RECEIVING_SIMULATION_EFFECT } from "../copy/receiving";
import { useReceivingPage, type ReceivingPageEnvelope } from "../hooks/use-audience-reads";
import EditionTombstone from "./edition-tombstone";
import { ServerHtml } from "./message-reader";

// The read's own shapes, taken from the read rather than restated
/** The edition one reading view renders, and the media and Give placement it carries. */
type ReadingData = ReceivingPageEnvelope["data"];
/** One scoped media reference the served markup may place. */
type PageRendition = ReadingData["renditions"][number];
/** What a Give placement resolves to: an available approved Designation, or the honest unavailable state. */
type PageGiving = NonNullable<ReadingData["giving"]>;

/** The surface's own name, announced before anything it renders. */
const SURFACE_LABEL = "Page edition";

// The few words this surface owns
const FIELD_LABELS = { reach: "Reach", language: "Language", designate: "Designation" } as const;
const NOTICE_TITLES = { denied: "This address cannot be read", refused: "This address is not one this view serves", unavailable: "This edition could not be read", noText: "This edition carries no readable text" } as const;
const NO_TEXT_DESCRIPTION = "The admitted revision of this edition carries no readable text, so nothing is rendered in its place. This is an edition with nothing in it rather than a source that could not be read, and no substitute is supplied for it.";
const RETRY_LABEL = "Check this address again";
const GIVE_HEADING = "Giving";
const GIVE_DESIGNATION_NOTE = "The release names the one designation it was approved to give to. No other fund stands in for it, and no payment is taken in this reading view.";
const VIDEO_TITLE_FALLBACK = "Video in this edition";
const CAPTIONS_LABEL = "Captions";

// The one purpose each reference serves
const PLAYBACK_PURPOSE = "playback";
const POSTER_PURPOSE = "poster";
const CAPTIONS_PURPOSE = "captions";

const META_CLASS = "flex min-w-0 flex-wrap items-center gap-1.5";
const BODY_CLASS = "flex min-w-0 flex-col gap-6";
const NOTE_CLASS = "text-xs text-muted-foreground text-pretty wrap-anywhere";
const TITLE_CLASS = "font-heading text-2xl font-semibold text-pretty wrap-anywhere";

/**
 * The name a language gives itself, with the tag after it when the two differ, so a reader learns both which language
 * served them and which edition it came from. A platform without `Intl.DisplayNames` states the tag alone.
 */
function languageLabelOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.length === 0) return "";
  const language = (trimmed.split("-")[0] ?? trimmed).toLowerCase();
  let endonym = trimmed;
  try {
    const names = new Intl.DisplayNames([language], { type: "language" });
    const name = names.of(language);
    if (name !== undefined && name.trim().length > 0) endonym = name.trim();
  } catch {
    endonym = trimmed;
  }
  return endonym === trimmed ? trimmed : `${endonym} (${trimmed})`;
}

/**
 * The playback renditions the served markup does not already place.
 *
 * The single content renderer places each image and video once, inline, with the poster and caption track the revision
 * carries. A player added for every admitted playback rendition would therefore stream the same video twice and state
 * the edition's media twice, so this surface gives the application's one player only to a rendition the markup did not
 * reference — the case where the edition would otherwise have no player at all.
 */
function unplacedPlayback(renditions: readonly PageRendition[], html: string): readonly PageRendition[] {
  return renditions.filter((rendition) => rendition.purpose === PLAYBACK_PURPOSE && rendition.path.length > 0 && !html.includes(rendition.path));
}

/** The scoped path of one ancillary rendition of the same asset, or `undefined` where the read admitted none. */
function ancillaryPathOf(renditions: readonly PageRendition[], assetId: string, purpose: string): string | undefined {
  const match = renditions.find((rendition) => rendition.assetId === assetId && rendition.purpose === purpose && rendition.path.length > 0);
  return match?.path;
}

/**
 * The caption track a placement carries. The envelope states a caption rendition's purpose and path; the language its
 * record holds travels with the edition that carries it, so the track is tagged with the language being read rather than
 * with a language this surface would have to guess.
 */
function captionsOf(renditions: readonly PageRendition[], assetId: string, languageTag: string): readonly VideoPlayerCaption[] {
  const path = ancillaryPathOf(renditions, assetId, CAPTIONS_PURPOSE);
  if (path === undefined || languageTag.length === 0) return [];
  return [{ src: path, srcLang: languageTag, label: CAPTIONS_LABEL, default: true }];
}

// The answers that are not an edition
/** Access was refused. Nothing about what stands behind the address is stated: no title, no count and no existence hint. */
function DeniedReading({ denied }: { readonly denied: DeniedOutcome }): ReactElement {
  return <StateNotice kind="denied" title={NOTICE_TITLES.denied} description={RECEIVING_POST_COPY.denialNotices["not-authorised"]} reasonCode={denied.reasonCode} headingLevel={2} />;
}

/** The address's own request is not one this view serves: the source answered, and no permission was refused. */
function RefusedReading(): ReactElement {
  return <StateNotice kind="refused" title={NOTICE_TITLES.refused} headingLevel={2} />;
}

/** The source behind the edition could not be read. The outage is reported instead of an empty page or a partial one. */
function UnavailableReading({ unavailable: outage, onRetry }: { readonly unavailable: UnavailableOutcome; readonly onRetry: () => void }): ReactElement {
  return <StateNotice kind="unavailable" title={NOTICE_TITLES.unavailable} description={outage.guidance} source={outage.source} retry={{ label: RETRY_LABEL, onClick: onRetry }} headingLevel={2} />;
}

/** Nothing readable exists in the language asked for, and no permitted edition in another language stands in for it. */
function LanguageUnavailableReading({ requestedLocale }: { readonly requestedLocale: string }): ReactElement {
  return (
    <div data-slot="public-reading-view-language-unavailable" data-requested-locale={requestedLocale}>
      <StateNotice kind="language-unavailable" title={RECEIVING_POST_COPY.languageUnavailable.title} description={RECEIVING_POST_COPY.languageUnavailable.description} headingLevel={2} />
    </div>
  );
}

/** The edition has been withdrawn. The tombstone is the whole answer, and nothing from the edition is stitched back into it. */
function WithdrawnReading(): ReactElement {
  return (
    <div data-slot="public-reading-view-withdrawn">
      <EditionTombstone />
    </div>
  );
}

/** The admitted revision states no prose at all, which is an empty edition rather than an unreadable source. */
function NoTextReading(): ReactElement {
  return <StateNotice kind="empty" title={NOTICE_TITLES.noText} description={NO_TEXT_DESCRIPTION} headingLevel={2} />;
}

// The Give placement
/** The one approved Designation, or the honest unavailable state — never a fallback fund, an amount or a payment control. */
function GivePlacement({ giving }: { readonly giving: PageGiving }): ReactElement {
  if (giving.state === "available") {
    return (
      <Card size="sm" data-slot="give-placement" data-giving-state={giving.state} className="min-w-0">
        <CardHeader>
          <CardTitle>{GIVE_HEADING}</CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-2">
          <p className="break-words">
            <span className="sr-only">{`${FIELD_LABELS.designate}: `}</span>
            <bdi>{giving.label}</bdi>
          </p>
          <p className={NOTE_CLASS}>{GIVE_DESIGNATION_NOTE}</p>
          <SimulationLabel effect={GIVING_SIMULATION_EFFECT} />
        </CardContent>
      </Card>
    );
  }
  return (
    <Alert variant="default" role={undefined} data-slot="give-placement" data-giving-state={giving.state}>
      <AlertTitle>{GIVING_UNAVAILABLE_COPY.heading}</AlertTitle>
      <AlertDescription>
        <p>{GIVING_UNAVAILABLE_COPY.description}</p>
        <SimulationLabel effect={GIVING_SIMULATION_EFFECT} className="mt-2" />
      </AlertDescription>
    </Alert>
  );
}

// The edition's media the served markup did not place
interface EditionMediaProps {
  readonly renditions: readonly PageRendition[];
  readonly html: string;
  readonly title: string;
  readonly direction: ContentLocale["direction"];
  readonly languageTag: string;
}

function EditionMedia({ renditions, html, title, direction, languageTag }: EditionMediaProps): ReactElement | null {
  const unplaced = unplacedPlayback(renditions, html);
  if (unplaced.length === 0) return null;
  return (
    <div data-slot="public-reading-view-media" className="flex min-w-0 flex-col gap-4">
      {unplaced.map((rendition) => {
        const poster = ancillaryPathOf(renditions, rendition.assetId, POSTER_PURPOSE);
        return (
          <VideoPlayer
            key={rendition.renditionId}
            title={title.length === 0 ? VIDEO_TITLE_FALLBACK : title}
            src={rendition.path}
            {...(poster === undefined ? {} : { poster })}
            captions={captionsOf(renditions, rendition.assetId, languageTag)}
            state="ready"
            direction={direction}
            {...(languageTag.length === 0 ? {} : { language: languageTag })}
          />
        );
      })}
    </div>
  );
}

// The admitted edition
interface ServedEditionProps {
  readonly data: ReadingData;
  readonly served: ContentLocale;
}

function ServedEdition({ data, served }: ServedEditionProps): ReactElement {
  const html = data.html ?? "";
  const title = (data.title ?? "").trim();
  const description = (data.description ?? "").trim();
  const reach: ReleaseReach | null = data.reach;
  const languageTag = served.tag.trim();
  const requestedTag = data.requestedLocale.trim();
  // A fallback is disclosed only when the read says it happened and the two tags really differ, so a served edition never
  // contradicts the answer it arrived in.
  const fallbackDisclosed = data.fallbackOccurred && requestedTag.length > 0 && languageTag.length > 0 && requestedTag !== languageTag;
  const reachSpec = reach === null ? undefined : statusBadgeProps(REACH_STATUS, reach);
  const lang = languageTag.length === 0 ? undefined : languageTag;
  return (
    <Card data-slot="public-reading-view-edition" data-reach={reach ?? "unstated"} className="min-w-0">
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-2">
          {title.length === 0 ? null : (
            <CardTitle>
              <h2 className={TITLE_CLASS}>
                <bdi>{title}</bdi>
              </h2>
            </CardTitle>
          )}
          <div className={META_CLASS}>
            {reachSpec === undefined ? null : <StatusBadge label={reachSpec.label} tone={reachSpec.tone} srPrefix={FIELD_LABELS.reach} />}
            {languageTag.length === 0 ? null : (
              <Badge variant="outline">
                <span className="sr-only">{`${FIELD_LABELS.language}: `}</span>
                <bdi lang={lang}>{languageLabelOf(languageTag)}</bdi>
              </Badge>
            )}
          </div>
          {description.length === 0 ? null : <CardDescription className="break-words">{description}</CardDescription>}
        </div>
      </CardHeader>
      <Separator />
      <CardContent className={BODY_CLASS}>
        {/* The reach word the read decided, with what it means for this edition: listed or shared by link only. */}
        {reach === null ? null : <p className={NOTE_CLASS}>{REACH_COPY[reach].description}</p>}
        {fallbackDisclosed ? (
          <p className={NOTE_CLASS}>
            <bdi>{RECEIVING_POST_COPY.languageFallbackStatement(languageLabelOf(requestedTag), languageLabelOf(languageTag))}</bdi>
          </p>
        ) : null}
        {/* The release body through the folder's one raw-markup site, read in the direction the served language states. */}
        <DirectionProvider direction={served.direction}>
          <div dir={served.direction} lang={lang} data-slot="public-reading-view-content" className="min-w-0">
            <ServerHtml html={html} direction={served.direction} lang={lang} />
          </div>
        </DirectionProvider>
        <EditionMedia renditions={data.renditions} html={html} title={title} direction={served.direction} languageTag={languageTag} />
        {data.giving === null ? null : <GivePlacement giving={data.giving} />}
        {/* Where the effect and the recheck are stated: publication reach is simulated, and access is decided on every open. */}
        <div data-slot="public-reading-view-footer" className="flex min-w-0 flex-col gap-2">
          <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} />
          <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.recheckStatement}</p>
          <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.inertStatement}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// The read's answer, as it arrived
function readingOf(result: ReadResult<ReceivingPageEnvelope>, onRetry: () => void): ReactElement {
  switch (result.kind) {
    case "denied":
      return <DeniedReading denied={result.denied} />;
    case "refused":
      return <RefusedReading />;
    case "unavailable":
      return <UnavailableReading unavailable={result.unavailable} onRetry={onRetry} />;
    case "envelope": {
      const data = result.envelope.data;
      if (data.state === "withdrawn") return <WithdrawnReading />;
      // A served edition always states the language and direction it is read in; an answer that names none is the
      // language-unavailable arm, because this surface cannot state a direction it was not given.
      if (data.state !== "served" || data.servedLocale === null) return <LanguageUnavailableReading requestedLocale={data.requestedLocale} />;
      if ((data.html ?? "").trim().length === 0) return <NoTextReading />;
      return <ServedEdition data={data} served={data.servedLocale} />;
    }
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

/** What {@link PublicReadingView} needs: the authority the server read under, the address it answered, and that answer. */
export interface PublicReadingViewProps {
  /** The scope the server read ran under, re-stated so the route can be re-requested under the same authority. */
  readonly scope: Scope;
  /** The Page this address names. */
  readonly pageId: string;
  /** The language the address asked for, absent when it named none. */
  readonly locale?: string;
  /** The answer the server produced for this address, adopted as it stands. */
  readonly initialEnvelope: ReadResult<ReceivingPageEnvelope>;
  readonly className?: string;
}

/** One released Page edition served by direct link: its reach, language, media and Give binding, rendered inert. */
export function PublicReadingView({ scope, pageId, locale, initialEnvelope, className }: PublicReadingViewProps): ReactElement {
  // The server's own answer is adopted unchanged and re-requested through the route on demand, so no cached envelope
  // outlives the authorisation it was read under and this surface never decides reach, readability or fallback itself.
  const { result, refresh } = useReceivingPage({ scope, params: { pageId, locale }, initialEnvelope });
  return (
    <section data-slot="public-reading-view" data-read-kind={result.kind} aria-label={SURFACE_LABEL} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      {readingOf(result, refresh)}
    </section>
  );
}

export default PublicReadingView;
