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
const UNAVAILABLE_COPY = "This video couldn’t be loaded right now.";
const TRANSCRIPT_TEXT_CLASS = "text-sm text-muted-foreground whitespace-pre-line wrap-anywhere";
/** The single video surface, in whichever of its six states the placement is in. */ export function VideoPlayer({ title, src, poster, captions, transcript, credit, language, state, direction, reason, nextStep, onRetry, className }: VideoPlayerProps): ReactElement {
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
  const renderPosterFrame = (): ReactElement => (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
      {poster === undefined ? <FilmIcon aria-hidden="true" className="size-8 text-muted-foreground" /> : <Image src={poster} alt="" aria-hidden="true" fill unoptimized sizes="(max-width: 640px) 100vw, 40rem" className="object-cover" />}
    </div>
  );
  function renderChooseAnotherFile(): ReactElement | null {
    if (onRetry === undefined) return null;
    return (
      <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
        Choose another file
      </Button>
    );
  }
  const renderUnavailable = (description: string): ReactElement => <StateNotice kind="unavailable" title="Video unavailable" description={description} retry={onRetry === undefined ? undefined : { label: "Try again", onClick: handleRetry }} />;
  const renderRejected = (): ReactElement => (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>Video couldn’t be added</AlertTitle>
      <AlertDescription>
        <p>{reason ?? "This file didn’t meet the video format or size requirements."}</p>
        {nextStep === undefined ? null : <p>{nextStep}</p>}
        {renderChooseAnotherFile()}
      </AlertDescription>
    </Alert>
  );
  const renderCancelled = (): ReactElement => (
    <Alert role={undefined}>
      <AlertTitle>No video added</AlertTitle>
      <AlertDescription>
        <p>Upload cancelled — nothing was changed.</p>
        {renderChooseAnotherFile()}
      </AlertDescription>
    </Alert>
  );
  const renderSelected = (): ReactElement => (
    <div className="flex flex-col gap-3">
      {renderPosterFrame()}
      <p className="text-sm text-muted-foreground">{"Selected — preparing locally before playback."}</p>
    </div>
  );
  const renderPreparing = (): ReactElement => (
    <div aria-busy={true} className="flex flex-col gap-3">
      {renderPosterFrame()}
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="shrink-0" />
        <span>{"Preparing video locally… Playback will be ready once finished."}</span>
      </p>
    </div>
  );
  function renderPlayable(): ReactElement {
    if (playableSrc === undefined) return renderUnavailable("No playable video is available for this item.");
    if (playbackFailed) return renderUnavailable("Couldn’t play this video. Access may have changed or the file may be unavailable.");
    return (
      // `jsx-a11y/media-has-caption` is suppressed for this player and only this player: its tracks are the `<track kind="captions">` elements `trackList.map` renders, which the rule cannot see statically, and the media profile admits a video without one, which then plays with its transcript as the alternative.
      // oxlint-disable-next-line jsx-a11y/media-has-caption
      <video aria-label={title} className="aspect-video w-full max-w-full rounded-lg bg-muted object-contain" controls onError={() => setFailedSrc(playableSrc)} playsInline poster={poster} preload="metadata" src={playableSrc}>
        {trackList.map((track, index) => (
          <track key={track.src} kind="captions" src={track.src} srcLang={track.srcLang} label={track.label} {...(index === defaultTrackIndex ? { default: true } : {})} />
        ))}
        <p className="p-4 text-sm text-muted-foreground">{hasTranscript ? "Your browser can’t play this video. Read the transcript below instead." : "Your browser can’t play this video."}</p>
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
