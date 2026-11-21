"use client";

/**
 * The one video playback surface in the application.
 *
 * Every placement reaches a reader through this component and nowhere else — the Update editor, its
 * preview, the receiving post, a Page video section and the protected-link page all render the same
 * element under the same rules — so playback behaves identically in each and the way a video is
 * presented cannot drift between them.
 *
 * What this component holds, and what it refuses to hold:
 *
 * - The element is a native `<video>` with `controls`. That is the release's one recorded departure
 *   from composing a design-system component: the browser's own controls are the only ones certain to
 *   be keyboard operable, exposed to assistive technology as media, and localised for the reader's
 *   language and direction. There is no third-party player, no bespoke control bar and no canvas
 *   surface, and nothing starts playing by itself when a placement renders.
 * - Every address belongs to the caller. `src`, `poster` and each caption `src` are the scoped
 *   rendition URLs the data service returned. This component never assembles one, never keeps one in
 *   state and never falls back to an original, so a restriction applied after the page was opened
 *   takes effect on the next request instead of being bypassed by a remembered address.
 * - A caption track and a transcript are content, not trusted metadata. The transcript is rendered as
 *   escaped text, so what it contains is read as words, and a caption address is passed through
 *   untouched. No `download` attribute, file name or original address appears here, because the
 *   rendition identity the service returned is the whole of what this component knows.
 * - The six preparation states stay six renderings. `selected` reports a chosen file and no work yet;
 *   `preparing` reports work in progress and carries the busy spinner; `ready` plays; `rejected` names
 *   the profile rule that refused the file; `cancelled` reports that nothing was placed; `unavailable`
 *   names the missing source and offers the retry. None of the six is an empty frame, a refusal is
 *   never dressed as an outage, and an outage is never dressed as a refusal.
 * - A request that fails after the state said `ready` — a restriction applied since, an unreachable
 *   source — replaces the player with the same text alternative `unavailable` uses, so the reader is
 *   never left with a broken frame that claims there is something to watch. The element reports the
 *   failure; this component decides nothing about permission. Authorisation lives in
 *   `modules/media/serve.ts` and is re-checked by the route handler on every request, including byte
 *   ranges, so a caption address is never a way around denied playback.
 * - Direction belongs to the document. `dir` sits on the frame, so the credit, the language, the
 *   transcript and the nested native controls follow the page's reading direction, while the media
 *   itself is never mirrored: a flipped picture is a different picture, and it would make a caption
 *   that describes position wrong.
 *
 * Accessibility: the player takes its accessible name from `title`; the credit and the language are
 * text inside the same frame; the transcript is reachable text in the reading order — always visible
 * where the video cannot be played, and behind a real disclosure button where it can; a
 * mixed-direction credit, language or transcript sits inside `<bdi>` with no bidirectionality control
 * characters added to it; each state is stated in words rather than by colour or motion, and the
 * shared reduced-motion rule collapses the one animation the frame uses. The frame reflows at 320 CSS
 * px, so the page never scrolls horizontally, and the native controls stay operable at 200% zoom
 * because they are the browser's own.
 *
 * `jsx-a11y/media-has-caption` is suppressed for the single `<video>` element below: the rule reads
 * this source statically and cannot see through an array of admitted tracks. Whether a placement has a
 * caption rendition is decided by the media module — captions are optional in the accepted profile —
 * and a video admitted without one plays with its transcript as the alternative rather than being
 * refused here.
 *
 * Scope: AAP 0.4.4 (gap 5 — a native `<video>` inside a `Card`), 0.3.4 (one media placement surface),
 * 0.8.6 (the video profile, the six states, captions treated as content, restriction stopping
 * playback) and the evidence for success criterion 18.
 */

import Image from "next/image";
import { FilmIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState, type ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { MediaPreparationState } from "@/modules/media/asset";

/**
 * One admitted caption track.
 *
 * The shape mirrors the caption track the content revision records, so a caller passes what the data
 * service resolved without re-shaping it: `src` is the scoped WebVTT rendition address, `srcLang` the
 * language tag the track declares and `label` the name the player's caption menu shows.
 */
export interface VideoPlayerCaption {
  /** Scoped URL of the caption rendition; the route re-authorises it as it does playback. */
  readonly src: string;
  /** BCP-47 language tag of the track, applied as the track's `srclang`. */
  readonly srcLang: string;
  /** The track's name in the player's caption menu. It names the language, never a file. */
  readonly label: string;
  /** Whether the player offers this track first. Only the first track marked this way is honoured. */
  readonly default?: boolean;
}

/**
 * Props of {@link VideoPlayer}.
 *
 * The addresses are supplied and never derived: a caller that has not received a scoped rendition URL
 * from the service has nothing to pass, which is what keeps an original from reaching a reader.
 */
export interface VideoPlayerProps {
  /** The player's accessible name, in the words of the surface it sits on. */
  readonly title: string;

  /** The scoped playback rendition URL the service returned. Absent when the placement has none. */
  readonly src?: string;

  /** The admitted poster rendition URL, shown while the video is chosen or being prepared. */
  readonly poster?: string;

  /** The admitted WebVTT caption tracks, in the order the player should offer them. */
  readonly captions?: readonly VideoPlayerCaption[];

  /** The transcript as plain text. Treated as content: escaped, never interpreted as markup. */
  readonly transcript?: string;

  /** The credit the placement carries — who made or supplied the video — as plain text. */
  readonly credit?: string;

  /** The language the video is in, as the placement states it: a name or a language tag. */
  readonly language?: string;

  /**
   * Which preparation state the placement is in, drawn from the media module's closed set. The set
   * already contains `unavailable`, which is how a source the service could not read is reported, so
   * no seventh state exists here.
   */
  readonly state: MediaPreparationState;

  /** The reading direction of the document the player sits in. The media is never mirrored. */
  readonly direction: "ltr" | "rtl";

  /**
   * The readable reason the media module gave for refusing the file, for `rejected`. Omitted, the
   * component states the profile check in its own words rather than inventing a code.
   */
  readonly reason?: string;

  /** The next step the media module suggested for a refused file, for `rejected`. */
  readonly nextStep?: string;

  /**
   * The caller's own recovery, offered as the retry for an unavailable or failed video and as "choose
   * another file" after a refusal or a cancellation. It never re-submits a refused file.
   */
  readonly onRetry?: () => void;

  /** Layout classes for the frame. Never a colour, radius, shadow or spacing literal. */
  readonly className?: string;
}

/** The refusal sentence used when the caller has no message from the media module to quote. */
const DEFAULT_REJECTION =
  "It did not pass this application's local video profile check, so nothing was placed.";

/** What `selected` says: the file is chosen and no work has started, so no busy indicator belongs here. */
const SELECTED_COPY =
  "Chosen, and not yet prepared. This video is prepared on this device before it can be played.";

/** What `preparing` says beside the spinner. Nothing leaves the machine, so nothing here claims it does. */
const PREPARING_COPY =
  "Preparing this video on this device. Nothing is uploaded, and the video can be played once preparation finishes.";

/** What an unreadable source says; the fixed wording of the notice carries the rest. */
const UNAVAILABLE_COPY =
  "This placement's video could not be read from its source, so the player is not shown.";

/** What a `ready` placement says when the caller supplied no playback address. */
const NO_PLAYBACK_RENDITION =
  "No playback rendition was supplied for this placement, so there is nothing to play.";

/** What a failed request says. A restriction applied since the page opened reaches the reader here. */
const PLAYBACK_FAILED =
  "The request for this video did not complete, so it is not offered as playable. A restriction applied since this page was opened has the same effect, because every request is re-checked.";

/** The transcript's text treatment: preformatted lines, never a column that widens the page. */
const TRANSCRIPT_TEXT_CLASS = "text-sm text-muted-foreground whitespace-pre-line wrap-anywhere";

/**
 * The single video surface, in whichever of its six states the placement is in.
 *
 * Holds two pieces of state, both about the current address rather than about permission: the address
 * whose request failed, and whether the reader has opened the transcript. Clearing the failed address
 * is what lets a retry actually recover, because the player is unmounted while the alternative shows
 * and re-mounting it issues a fresh request under whatever scope applies now.
 */
export function VideoPlayer({
  title,
  src,
  poster,
  captions,
  transcript,
  credit,
  language,
  state,
  direction,
  reason,
  nextStep,
  onRetry,
  className,
}: VideoPlayerProps): ReactElement {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptId = useId();

  // Read once into consts so every handler below keeps the narrowing its own guard establishes.
  const playableSrc = src;
  const retry = onRetry;
  const trackList = captions ?? [];
  const defaultTrackIndex = trackList.findIndex((track) => track.default === true);
  const hasTranscript = transcript !== undefined && transcript.trim() !== "";

  /** A failure belongs to one rendition address, so a new address starts without a stale failure. */
  const playbackFailed = playableSrc !== undefined && failedSrc === playableSrc;

  /**
   * Runs the caller's recovery, forgetting the failed address first.
   *
   * The player is unmounted while the text alternative shows, so forgetting the failure is what makes
   * the re-mounted element request the rendition again instead of redisplaying what this component
   * remembered about a request that may since have become permitted.
   */
  const handleRetry = (): void => {
    setFailedSrc(null);
    if (retry !== undefined) {
      retry();
    }
  };

  /** The admitted poster while nothing plays, or a neutral panel when the placement has no poster. */
  function renderPosterFrame(): ReactElement {
    return (
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
        {poster === undefined ? (
          <FilmIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        ) : (
          /*
           * `unoptimized` is stated here rather than relied on from the application's own setting: a
           * poster is a scoped rendition, and the optimiser would serve the same bytes from a second
           * path that performs no per-request authorisation. Decorative — the state's words carry the
           * meaning — so it takes empty alternative text.
           */
          <Image
            src={poster}
            alt=""
            aria-hidden="true"
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, 40rem"
            className="object-cover"
          />
        )}
      </div>
    );
  }

  /** The retry a notice offers, absent when the caller supplied no recovery of its own. */
  function renderRetry() {
    return retry === undefined
      ? undefined
      : { label: "Try loading the video again", onClick: handleRetry };
  }

  /** One button inviting a different file. It never resubmits the file that was refused or dropped. */
  function renderChooseAnotherFile(): ReactElement | null {
    if (retry === undefined) {
      return null;
    }
    return (
      <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
        Choose another file
      </Button>
    );
  }

  /** An unreadable source, and the failed request that reads the same way to the person watching. */
  function renderUnavailable(description: string): ReactElement {
    return (
      <StateNotice
        kind="unavailable"
        title="This video is unavailable"
        description={description}
        retry={renderRetry()}
      />
    );
  }

  /** The file the media module refused: the reason it failed, and a way to choose a different file. */
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

  /**
   * A cancelled upload: nothing was placed, so nothing is shown as if it had been.
   *
   * No role here, unlike the refusal above: the reader cancelled this themselves, so the surface states
   * the fact where it stands instead of interrupting them with an announcement of their own action.
   */
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

  /** The chosen-but-not-started state: the poster, the state in words, and no spinner for inert work. */
  function renderSelected(): ReactElement {
    return (
      <div className="flex flex-col gap-3">
        {renderPosterFrame()}
        <p className="text-sm text-muted-foreground">{SELECTED_COPY}</p>
      </div>
    );
  }

  /** The state that is doing work: the poster, the spinner and the sentence that says what is happening. */
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

  /** The player itself, or the same text alternative when there is nothing to play. */
  function renderPlayable(): ReactElement {
    if (playableSrc === undefined) {
      return renderUnavailable(NO_PLAYBACK_RENDITION);
    }
    if (playbackFailed) {
      return renderUnavailable(PLAYBACK_FAILED);
    }
    return (
      // oxlint-disable-next-line jsx-a11y/media-has-caption
      <video
        aria-label={title}
        className="aspect-video w-full max-w-full rounded-lg bg-muted object-contain"
        controls
        onError={() => {
          setFailedSrc(playableSrc);
        }}
        playsInline
        poster={poster}
        preload="metadata"
        src={playableSrc}
      >
        {trackList.map((track, index) => (
          <track
            key={track.src}
            kind="captions"
            src={track.src}
            srcLang={track.srcLang}
            label={track.label}
            {...(index === defaultTrackIndex ? { default: true } : {})}
          />
        ))}
        <p className="p-4 text-sm text-muted-foreground">
          {hasTranscript
            ? "This browser cannot play the video here. The transcript below is the alternative."
            : "This browser cannot play the video here, and no transcript was admitted for this placement."}
        </p>
      </video>
    );
  }

  /** Whichever of the six states applies. Every branch returns something a reader can read. */
  function renderSurface(): ReactElement {
    switch (state) {
      case "ready":
        return renderPlayable();
      case "selected":
        return renderSelected();
      case "preparing":
        return renderPreparing();
      case "rejected":
        return renderRejected();
      case "cancelled":
        return renderCancelled();
      case "unavailable":
        return renderUnavailable(UNAVAILABLE_COPY);
    }
  }

  /** Who supplied the video and what language it is in, isolated so mixed direction cannot reorder it. */
  function renderMeta(): ReactElement | null {
    if (credit === undefined && language === undefined) {
      return null;
    }
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {credit === undefined ? null : (
          <span>
            <bdi>{credit}</bdi>
          </span>
        )}
        {language === undefined ? null : (
          <span>
            Language: <bdi>{language}</bdi>
          </span>
        )}
      </div>
    );
  }

  /**
   * The transcript.
   *
   * It collapses only while the video can be played, because there it is supplementary; wherever the
   * video cannot play it is the alternative itself and stays in the reading order. The disclosure is a
   * real button carrying `aria-expanded` and `aria-controls`, so it is operable by keyboard and touch
   * and never depends on a hover or a drag, and it opens with no animation at all.
   *
   * `dir="auto"` rather than the page's direction: the transcript may be in the video's language rather
   * than the surface's, so its first strong character decides, and no bidirectionality control
   * character is ever added to the text to force an order.
   */
  function renderTranscript(): ReactElement | null {
    if (transcript === undefined || !hasTranscript) {
      return null;
    }
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-controls={transcriptId}
          aria-expanded={transcriptOpen}
          onClick={() => {
            setTranscriptOpen((open) => !open);
          }}
          className="self-start"
        >
          {transcriptOpen ? "Hide transcript" : "Read transcript"}
        </Button>
        <div id={transcriptId} dir="auto" hidden={!transcriptOpen} className={TRANSCRIPT_TEXT_CLASS}>
          {transcript}
        </div>
      </div>
    );
  }

  return (
    <Card
      dir={direction}
      data-slot="video-player"
      data-state={state}
      className={cn("w-full", className)}
    >
      <CardContent className="flex flex-col gap-3">
        {renderSurface()}
        {renderMeta()}
        {renderTranscript()}
      </CardContent>
    </Card>
  );
}

export default VideoPlayer;