"use client";
import Image from "next/image";
import { FilmIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState, type ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DirectionProvider } from "@/components/ui/direction";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { MediaPreparationState } from "@/modules/media/asset";
export type VideoPlayerCaption = { readonly src: string; readonly srcLang: string; readonly label: string; readonly default?: boolean };
export type VideoPlayerProps = {
  readonly title: string;
  readonly src?: string;
  readonly poster?: string;
  readonly captions?: readonly VideoPlayerCaption[];
  readonly transcript?: string;
  readonly credit?: string;
  readonly language?: string;
  readonly state: MediaPreparationState;
  readonly direction: "ltr" | "rtl";
  readonly reason?: string;
  readonly nextStep?: string;
  readonly onRetry?: () => void;
  readonly className?: string;
};
const DEFAULT_REJECTION = "It did not pass this application's local video profile check, so nothing was placed.";
const SELECTED_COPY = "Chosen, and not yet prepared. This video is prepared on this device before it can be played.";
const PREPARING_COPY = "Preparing this video on this device. Nothing is uploaded, and the video can be played once preparation finishes.";
const UNAVAILABLE_COPY = "This placement's video could not be read from its source, so the player is not shown.";
const NO_PLAYBACK_RENDITION = "No playback rendition was supplied for this placement, so there is nothing to play.";
const PLAYBACK_FAILED = "The request for this video did not complete, so it is not offered as playable. A restriction applied since this page was opened has the same effect, because every request is re-checked.";
const TRANSCRIPT_TEXT_CLASS = "text-sm text-muted-foreground whitespace-pre-line wrap-anywhere";
/** The single video surface, in whichever of its six states the placement is in. */
export function VideoPlayer({ title, src, poster, captions, transcript, credit, language, state, direction, reason, nextStep, onRetry, className }: VideoPlayerProps): ReactElement {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptId = useId();
  const playableSrc = src;
  const trackList = captions ?? [];
  const defaultTrackIndex = trackList.findIndex((track) => track.default === true);
  const hasTranscript = transcript !== undefined && transcript.trim() !== "";
  const playbackFailed = playableSrc !== undefined && failedSrc === playableSrc;
  const handleRetry = (): void => {
    setFailedSrc(null);
    if (onRetry !== undefined) onRetry();
  };
  function renderPosterFrame(): ReactElement {
    return (
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
        {poster === undefined ? <FilmIcon aria-hidden="true" className="size-8 text-muted-foreground" /> : <Image src={poster} alt="" aria-hidden="true" fill unoptimized sizes="(max-width: 640px) 100vw, 40rem" className="object-cover" />}
      </div>
    );
  }
  function renderChooseAnotherFile(): ReactElement | null {
    if (onRetry === undefined) return null;
    return (
      <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
        Choose another file
      </Button>
    );
  }
  const renderUnavailable = (description: string): ReactElement => <StateNotice kind="unavailable" title="This video is unavailable" description={description} retry={onRetry === undefined ? undefined : { label: "Try loading the video again", onClick: handleRetry }} />;
  function renderRejected(): ReactElement {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>This file was not accepted</AlertTitle>
        <AlertDescription>
          <p>{reason ?? DEFAULT_REJECTION}</p>
          {nextStep === undefined ? null : <p>{nextStep}</p>}
          {renderChooseAnotherFile()}
        </AlertDescription>
      </Alert>
    );
  }
  function renderCancelled(): ReactElement {
    return (
      <Alert role={undefined}>
        <AlertTitle>No video added</AlertTitle>
        <AlertDescription>
          <p>This upload was cancelled, so the placement is unchanged and nothing was prepared.</p>
          {renderChooseAnotherFile()}
        </AlertDescription>
      </Alert>
    );
  }
  function renderSelected(): ReactElement {
    return (
      <div className="flex flex-col gap-3">
        {renderPosterFrame()}
        <p className="text-sm text-muted-foreground">{SELECTED_COPY}</p>
      </div>
    );
  }
  function renderPreparing(): ReactElement {
    return (
      <div aria-busy={true} className="flex flex-col gap-3">
        {renderPosterFrame()}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="shrink-0" />
          <span>{PREPARING_COPY}</span>
        </p>
      </div>
    );
  }
  function renderPlayable(): ReactElement {
    if (playableSrc === undefined) return renderUnavailable(NO_PLAYBACK_RENDITION);
    if (playbackFailed) return renderUnavailable(PLAYBACK_FAILED);
    return (
      // oxlint-disable-next-line jsx-a11y/media-has-caption
      <video aria-label={title} className="aspect-video w-full max-w-full rounded-lg bg-muted object-contain" controls onError={() => setFailedSrc(playableSrc)} playsInline poster={poster} preload="metadata" src={playableSrc}>
        {trackList.map((track, index) => (
          <track key={track.src} kind="captions" src={track.src} srcLang={track.srcLang} label={track.label} {...(index === defaultTrackIndex ? { default: true } : {})} />
        ))}
        <p className="p-4 text-sm text-muted-foreground">{hasTranscript ? "This browser cannot play the video here. The transcript below is the alternative." : "This browser cannot play the video here, and no transcript was admitted for this placement."}</p>
      </video>
    );
  }
  function renderSurface(): ReactElement {
    const surfaces: Readonly<Record<MediaPreparationState, () => ReactElement>> = { ready: renderPlayable, selected: renderSelected, preparing: renderPreparing, rejected: renderRejected, cancelled: renderCancelled, unavailable: () => renderUnavailable(UNAVAILABLE_COPY) };
    return surfaces[state]();
  }
  function renderMeta(): ReactElement | null {
    if (credit === undefined && language === undefined) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {credit === undefined ? null : <bdi>{credit}</bdi>}
        {language === undefined ? null : (
          <span>
            Language: <bdi>{language}</bdi>
          </span>
        )}
      </div>
    );
  }
  function renderTranscript(): ReactElement | null {
    if (transcript === undefined || !hasTranscript) return null;
    const collapsible = state === "ready" && playableSrc !== undefined && !playbackFailed;
    if (!collapsible) {
      return (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Transcript</p>
          <p dir="auto" className={TRANSCRIPT_TEXT_CLASS}>
            {transcript}
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Button type="button" variant="ghost" size="sm" aria-controls={transcriptId} aria-expanded={transcriptOpen} onClick={() => setTranscriptOpen((open) => !open)} className="self-start">
          {transcriptOpen ? "Hide transcript" : "Read transcript"}
        </Button>
        <div id={transcriptId} dir="auto" hidden={!transcriptOpen} className={TRANSCRIPT_TEXT_CLASS}>
          {transcript}
        </div>
      </div>
    );
  }
  // The card states its direction and so does the provider, so a portalled descendant of the player follows the edition's direction rather than the page's.
  return (
    <DirectionProvider direction={direction}>
      <Card dir={direction} data-slot="video-player" data-state={state} className={cn("w-full", className)}>
        <CardContent className="flex flex-col gap-3">
          {renderSurface()}
          {renderMeta()}
          {renderTranscript()}
        </CardContent>
      </Card>
    </DirectionProvider>
  );
}
export default VideoPlayer;
