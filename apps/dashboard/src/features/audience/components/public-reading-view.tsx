"use client";
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
import { languageNameOf } from "@/lib/language-name";
import type { ContentLocale } from "@/modules/content/locale";
import type { ReleaseReach } from "@/modules/content/variant";
import type { Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { GIVING_SIMULATION_EFFECT, GIVING_UNAVAILABLE_COPY, REACH_COPY, RECEIVING_POST_COPY, RECEIVING_SIMULATION_EFFECT } from "../copy/receiving";
import { useReceivingPage, type ReceivingPageEnvelope } from "../hooks/use-audience-reads";
import EditionTombstone from "./edition-tombstone";
import { ServerHtml } from "./message-reader";
type ReadingData = ReceivingPageEnvelope["data"];
type PageRendition = ReadingData["renditions"][number];
type PageGiving = NonNullable<ReadingData["giving"]>;
const FIELD_LABELS = { reach: "Reach", language: "Language", designate: "Designation" } as const;
const NOTICE_TITLES = { denied: "This address cannot be read", refused: "This address is not one this view serves", unavailable: "This edition could not be read", noText: "This edition carries no readable text" } as const;
const NO_TEXT_DESCRIPTION = "The admitted revision of this edition carries no readable text, so nothing is rendered in its place. This is an edition with nothing in it rather than a source that could not be read, and no substitute is supplied for it.";
const VIDEO_TITLE_FALLBACK = "Video in this edition";
const PLAYBACK_PURPOSE = "playback";
const NOTE_CLASS = "text-xs text-muted-foreground text-pretty wrap-anywhere";
function languageLabelOf(tag: string): string {
  const trimmed = tag.trim();
  const endonym = languageNameOf(tag).trim();
  return endonym === trimmed ? trimmed : `${endonym} (${trimmed})`;
}
const unplacedPlayback = (renditions: readonly PageRendition[], html: string): readonly PageRendition[] => renditions.filter((rendition) => rendition.purpose === PLAYBACK_PURPOSE && rendition.path.length > 0 && !html.includes(rendition.path));
const ancillaryPathOf = (renditions: readonly PageRendition[], assetId: string, purpose: string): string | undefined => renditions.find((rendition) => rendition.assetId === assetId && rendition.purpose === purpose && rendition.path.length > 0)?.path;
function captionsOf(renditions: readonly PageRendition[], assetId: string, languageTag: string): readonly VideoPlayerCaption[] {
  const path = ancillaryPathOf(renditions, assetId, "captions");
  return path === undefined || languageTag.length === 0 ? [] : [{ src: path, srcLang: languageTag, label: "Captions", default: true }];
}
const LanguageUnavailableReading = ({ requestedLocale }: { readonly requestedLocale: string }): ReactElement => (
  <div data-slot="public-reading-view-language-unavailable" data-requested-locale={requestedLocale}>
    <StateNotice kind="language-unavailable" title={RECEIVING_POST_COPY.languageUnavailable.title} description={RECEIVING_POST_COPY.languageUnavailable.description} headingLevel={2} />
  </div>
);
function GivePlacement({ giving }: { readonly giving: PageGiving }): ReactElement {
  return giving.state === "available" ? (
    <Card size="sm" data-slot="give-placement" data-giving-state={giving.state} className="min-w-0">
      <CardHeader>
        <CardTitle>Giving</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2">
        <p className="break-words">
          <span className="sr-only">{`${FIELD_LABELS.designate}: `}</span>
          <bdi>{giving.label}</bdi>
        </p>
        <p className={NOTE_CLASS}>The release names the one designation it was approved to give to. No other fund stands in for it, and no payment is taken in this reading view.</p>
        <SimulationLabel effect={GIVING_SIMULATION_EFFECT} />
      </CardContent>
    </Card>
  ) : (
    <Alert variant="default" role={undefined} data-slot="give-placement" data-giving-state={giving.state}>
      <AlertTitle>{GIVING_UNAVAILABLE_COPY.heading}</AlertTitle>
      <AlertDescription>
        <p>{GIVING_UNAVAILABLE_COPY.description}</p>
        <SimulationLabel effect={GIVING_SIMULATION_EFFECT} className="mt-2" />
      </AlertDescription>
    </Alert>
  );
}
type EditionMediaProps = { readonly renditions: readonly PageRendition[]; readonly html: string; readonly title: string; readonly direction: ContentLocale["direction"]; readonly languageTag: string };
function EditionMedia({ renditions, html, title, direction, languageTag }: EditionMediaProps): ReactElement | null {
  const unplaced = unplacedPlayback(renditions, html);
  if (unplaced.length === 0) return null;
  return (
    <div data-slot="public-reading-view-media" className="flex min-w-0 flex-col gap-4">
      {unplaced.map((rendition) => {
        const poster = ancillaryPathOf(renditions, rendition.assetId, "poster");
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
type ServedEditionProps = { readonly data: ReadingData; readonly served: ContentLocale };
function ServedEdition({ data, served }: ServedEditionProps): ReactElement {
  const html = data.html ?? "";
  const title = (data.title ?? "").trim();
  const description = (data.description ?? "").trim();
  const reach: ReleaseReach | null = data.reach;
  const languageTag = served.tag.trim();
  const requestedTag = data.requestedLocale.trim();
  const reachSpec = reach === null ? undefined : statusBadgeProps(REACH_STATUS, reach);
  const lang = languageTag.length === 0 ? undefined : languageTag;
  return (
    <Card data-slot="public-reading-view-edition" data-reach={reach ?? "unstated"} className="min-w-0">
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-2">
          {title.length === 0 ? null : (
            <CardTitle>
              <h2 className="font-heading text-2xl font-semibold text-pretty wrap-anywhere">
                <bdi>{title}</bdi>
              </h2>
            </CardTitle>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
      <CardContent className="flex min-w-0 flex-col gap-6">
        {reach === null ? null : <p className={NOTE_CLASS}>{REACH_COPY[reach].description}</p>}
        {data.fallbackOccurred && requestedTag.length > 0 && languageTag.length > 0 && requestedTag !== languageTag ? (
          <p className={NOTE_CLASS}>
            <bdi>{RECEIVING_POST_COPY.languageFallbackStatement(languageLabelOf(requestedTag), languageLabelOf(languageTag))}</bdi>
          </p>
        ) : null}
        <DirectionProvider direction={served.direction}>
          <div dir={served.direction} lang={lang} data-slot="public-reading-view-content" className="min-w-0">
            <ServerHtml html={html} direction={served.direction} lang={lang} />
          </div>
        </DirectionProvider>
        <EditionMedia renditions={data.renditions} html={html} title={title} direction={served.direction} languageTag={languageTag} />
        {data.giving === null ? null : <GivePlacement giving={data.giving} />}
        <div data-slot="public-reading-view-footer" className="flex min-w-0 flex-col gap-2">
          <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} />
          <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.recheckStatement}</p>
          <p className={NOTE_CLASS}>{RECEIVING_POST_COPY.inertStatement}</p>
        </div>
      </CardContent>
    </Card>
  );
}
function readingOf(result: ReadResult<ReceivingPageEnvelope>, onRetry: () => void): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" title={NOTICE_TITLES.denied} description={RECEIVING_POST_COPY.denialNotices["not-authorised"]} reasonCode={result.denied.reasonCode} headingLevel={2} />;
    case "refused":
      return <StateNotice kind="refused" title={NOTICE_TITLES.refused} headingLevel={2} />;
    case "unavailable":
      return <StateNotice kind="unavailable" title={NOTICE_TITLES.unavailable} description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: "Check this address again", onClick: onRetry }} headingLevel={2} />;
    case "envelope": {
      const data = result.envelope.data;
      if (data.state === "withdrawn")
        return (
          <div data-slot="public-reading-view-withdrawn">
            <EditionTombstone />
          </div>
        );
      return data.state !== "served" || data.servedLocale === null ? (
        <LanguageUnavailableReading requestedLocale={data.requestedLocale} />
      ) : (data.html ?? "").trim().length === 0 ? (
        <StateNotice kind="empty" title={NOTICE_TITLES.noText} description={NO_TEXT_DESCRIPTION} headingLevel={2} />
      ) : (
        <ServedEdition data={data} served={data.servedLocale} />
      );
    }
    default: {
      return result;
    }
  }
}
/** What {@link PublicReadingView} needs: the authority the server read under, the address it answered, and that answer. */
export type PublicReadingViewProps = { readonly scope: Scope; readonly pageId: string; readonly locale?: string; readonly initialEnvelope: ReadResult<ReceivingPageEnvelope>; readonly className?: string };
/** One released Page edition served by direct link: its reach, language, media and Give binding, rendered inert. */ export function PublicReadingView({ scope, pageId, locale, initialEnvelope, className }: PublicReadingViewProps): ReactElement {
  const { result, refresh } = useReceivingPage({ scope, params: { pageId, locale }, initialEnvelope });
  return (
    <section data-slot="public-reading-view" data-read-kind={result.kind} aria-label="Page edition" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      {readingOf(result, refresh)}
    </section>
  );
}
export default PublicReadingView;
