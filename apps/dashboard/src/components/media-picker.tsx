"use client";
import { FilmIcon, ImageUpIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from "react";
import { mayReplay } from "@/components/attempt";
import { FormField, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import { OperationResult, type OperationResultProps } from "@/components/operation-result";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import type { ContentDirection } from "@/modules/content/document";
import { ADMITTED_IMAGE_FORMATS, ADMITTED_VIDEO_PROFILES, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_S, VIDEO_MAX_HEIGHT, VIDEO_MAX_WIDTH, mediaStateReason, type MediaPreparationState } from "@/modules/media/profile";
export type MediaPickerKind = "image" | "video";
export type MediaProbe = { readonly width?: number; readonly height?: number; readonly durationSeconds?: number };
export type MediaPlacementDescriptor = { readonly altText: string; readonly caption?: string; readonly credit?: string; readonly transcript?: string; readonly language?: string };
export type MediaPlacement = MediaPlacementDescriptor & { readonly placementId?: string };
/** The poster image chosen beside a video: its own file, prepared into a poster rendition when the video is registered. */ export type MediaPosterInput = { readonly file: File };
/** The caption track chosen beside a video: the WebVTT file itself, in the language the placement states. */ export type MediaCaptionInput = { readonly file: File; readonly language: string; readonly label?: string };
/** One registration's own input, with the transport's stop signal beside the media it carries: stopping the wait aborts the request rather than abandoning it, and the signal is never part of what is registered. */
export type MediaRegisterInput = { readonly kind: MediaPickerKind; readonly file: File; readonly placement: MediaPlacementDescriptor; readonly poster?: MediaPosterInput; readonly captions?: MediaCaptionInput; readonly signal?: AbortSignal };
/** The outcome every transport answers with, taken from the one receipt that renders it. */ export type MediaPickerOutcome = OperationResultProps["outcome"];
export type MediaPickerProps = {
  readonly kind: MediaPickerKind;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly placement?: MediaPlacement;
  /** The direction of the edition these words are being written for, stated on the authored fields alone: the picker's own labels, descriptions and controls stay at the interface's direction. */ readonly direction?: ContentDirection;
  readonly onRegister: (input: MediaRegisterInput) => Promise<MediaPickerOutcome>;
  readonly onReplace?: (input: { readonly placementId: string } & MediaRegisterInput) => Promise<MediaPickerOutcome>;
  readonly onRemove?: (input: { readonly placementId: string }) => Promise<MediaPickerOutcome>;
  readonly onSettled?: (outcome: MediaPickerOutcome) => void;
  readonly className?: string;
};
const MEBIBYTE = 1024 * 1024;
const IMAGE_LIMITS = Object.freeze({ bytes: IMAGE_MAX_BYTES, edgePx: IMAGE_MAX_EDGE_PX, formats: "JPEG, PNG or a still WebP image" });
const VIDEO_LIMITS = Object.freeze({ bytes: VIDEO_MAX_BYTES, durationS: VIDEO_MAX_DURATION_S, width: VIDEO_MAX_WIDTH, height: VIDEO_MAX_HEIGHT, formats: "MP4 with H.264 video and AAC audio, or WebM with VP8 or VP9 video and Vorbis or Opus audio" });
const ACCEPT_HINT: Readonly<Record<MediaPickerKind, string>> = Object.freeze({ image: ADMITTED_IMAGE_FORMATS.map((format) => `image/${format}`).join(","), video: ADMITTED_VIDEO_PROFILES.map((profile) => `video/${profile.container}`).join(",") });
const VIDEO_PROBE_TIMEOUT_MS = 15_000;
const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  file: "File",
  poster: "Poster image",
  captions: "Caption track",
  "captions.language": "Caption language",
  "captions.label": "Track label",
  "placement.altText": "Alt text",
  "placement.caption": "Caption",
  "placement.credit": "Credit",
  "placement.transcript": "Transcript",
  "placement.language": "Language",
});
function formatBytes(bytes: number): string {
  const mebibytes = bytes / MEBIBYTE;
  const shown = Number.isInteger(mebibytes) ? String(mebibytes) : mebibytes.toFixed(1);
  return `${shown} MiB`;
}
function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  if (minutes === 0) return `${remainder} seconds`;
  const plural = minutes === 1 ? "minute" : "minutes";
  return remainder === 0 ? `${minutes} ${plural}` : `${minutes} ${plural} ${remainder} seconds`;
}
const formatPixels = (width: number, height: number): string => {
  const formatCount = countFormatOf(); // A pixel count is a whole number, so it groups in the application's default interface locale.
  return `${formatCount.format(width)} × ${formatCount.format(height)} pixels`;
};
async function probeImage(file: File): Promise<MediaProbe | undefined> {
  if (typeof createImageBitmap !== "function") return undefined;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height };
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
}
function probeVideo(file: File): Promise<MediaProbe | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement("video");
    let timer: number | undefined;
    let settled = false;
    const finish = (probe: MediaProbe | undefined): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(probe);
    };
    timer = window.setTimeout(() => finish(undefined), VIDEO_PROBE_TIMEOUT_MS);
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined;
      finish({ ...(element.videoWidth > 0 ? { width: element.videoWidth } : {}), ...(element.videoHeight > 0 ? { height: element.videoHeight } : {}), ...(duration === undefined ? {} : { durationSeconds: duration }) });
    };
    element.onerror = () => finish(undefined);
    element.preload = "metadata";
    element.muted = true;
    element.src = url;
  });
}
const probeChosenFile = async (file: File, kind: MediaPickerKind): Promise<MediaProbe | undefined> => (kind === "image" ? probeImage(file) : probeVideo(file));
type PlacementDraft = { readonly altText: string; readonly caption: string; readonly credit: string; readonly language: string; readonly transcript: string };
const draftFromPlacement = (placement: MediaPlacement | undefined): PlacementDraft => ({ altText: placement?.altText ?? "", caption: placement?.caption ?? "", credit: placement?.credit ?? "", language: placement?.language ?? "", transcript: placement?.transcript ?? "" });
function composePlacement(draft: PlacementDraft, kind: MediaPickerKind): MediaPlacementDescriptor {
  const altText = draft.altText.trim();
  const caption = draft.caption.trim();
  const credit = draft.credit.trim();
  const language = draft.language.trim();
  const transcript = draft.transcript.trim();
  return { altText, ...(caption === "" ? {} : { caption }), ...(credit === "" ? {} : { credit }), ...(kind === "video" && transcript !== "" ? { transcript } : {}), ...(language === "" ? {} : { language }) };
}
const MEDIA_STATE_BY_OUTCOME: Readonly<Record<MediaPickerOutcome["outcome"], MediaPreparationState | null>> = { accepted: "ready", alreadyAccepted: "ready", unchanged: "ready", invalid: "rejected", unavailable: "unavailable", conflict: null, denied: null, unknown: null };
const mediaStateForOutcome = (outcome: MediaPickerOutcome): MediaPreparationState | null => MEDIA_STATE_BY_OUTCOME[outcome.outcome];
const keepsFormVisible = (outcome: MediaPickerOutcome): boolean => outcome.outcome === "invalid" || outcome.outcome === "conflict" || outcome.outcome === "unknown" || outcome.outcome === "unavailable";
function mergeMessages(first: readonly string[] | undefined, second: readonly string[] | undefined): readonly string[] | undefined {
  const messages = [...(first ?? []), ...(second ?? [])];
  return messages.length === 0 ? undefined : messages;
}
const missingAltText = (kind: MediaPickerKind): string => (kind === "image" ? "Describe what this image shows for screen readers." : "Describe what this video shows when it can’t play.");
type PickerPhase =
  | { readonly name: "choosing" }
  | { readonly name: "preparing"; readonly stage: "measuring" | "submitting" }
  | { readonly name: "described" }
  | { readonly name: "cancelled" }
  | { readonly name: "confirming-removal" }
  | { readonly name: "removing" }
  | { readonly name: "settled"; readonly outcome: MediaPickerOutcome };
const OPENING_SENTENCE: Readonly<Record<MediaPickerKind, string>> = Object.freeze({
  image: "Choose an image from your device and add alt text. It stays in your draft and isn’t published yet.",
  video: "Choose a video from your device and add alt text. It stays in your draft and isn’t published yet.",
});
const REMOVAL_DESCRIPTION = "Confirm before removing this media placement.";
const PHASE_DESCRIPTION: Readonly<Record<PickerPhase["name"], (kind: MediaPickerKind) => string>> = {
  choosing: (kind) => OPENING_SENTENCE[kind],
  preparing: (kind) => `Preparing this ${kind} locally on your device.`,
  described: (kind) => `Describe this ${kind}. Alt text is required; all other fields are optional.`,
  cancelled: () => "Cancelled — nothing was added to your draft.",
  "confirming-removal": () => REMOVAL_DESCRIPTION,
  removing: () => REMOVAL_DESCRIPTION,
  settled: () => "Result of your media update.",
};
type FooterAction = { readonly label: string; readonly onClick?: () => void; readonly variant?: "default" | "destructive"; readonly disabled?: boolean; readonly className?: string };
/** The single image and video picker and placement form. */ export function MediaPicker({ kind, open, onOpenChange, placement, direction, onRegister, onReplace, onRemove, onSettled, className }: MediaPickerProps): ReactElement {
  const instructionsId = useId();
  const limitsId = useId();
  const altTextRef = useRef<HTMLTextAreaElement | null>(null);
  const languageRef = useRef<HTMLInputElement | null>(null);
  const placementRef = useRef(placement);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const attemptRef = useRef(0);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastAttemptRef = useRef<"register" | "remove">("register");
  const [phase, setPhase] = useState<PickerPhase>({ name: "choosing" });
  const [file, setFile] = useState<File | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [trackLabel, setTrackLabel] = useState("");
  const [probe, setProbe] = useState<MediaProbe | undefined>(undefined);
  const [draft, setDraft] = useState<PlacementDraft>(() => draftFromPlacement(placement));
  const [localErrors, setLocalErrors] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrorLookup | null>(null);
  const [outcome, setOutcome] = useState<MediaPickerOutcome | null>(null);
  const [faulted, setFaulted] = useState(false);
  const replaceId = onReplace === undefined ? undefined : placement?.placementId;
  const removeId = onRemove === undefined ? undefined : placement?.placementId;
  const clearAttempt = (): void => {
    setFile(null);
    setPosterFile(null);
    setCaptionFile(null);
    setTrackLabel("");
    setProbe(undefined);
    setOutcome(null);
    setServerErrors(null);
    setLocalErrors({});
    setFaulted(false);
  };
  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      attemptRef.current += 1;
      clearAttempt();
      setDraft(draftFromPlacement(placementRef.current));
      setPhase({ name: "choosing" });
      return;
    }
    if (!open && wasOpen) {
      const previous = returnFocusRef.current;
      returnFocusRef.current = null;
      if (previous !== null && previous.isConnected) previous.focus();
    }
  }, [open]);
  const finishAttempt = (attempt: number, settled: MediaPickerOutcome): void => {
    if (attemptRef.current !== attempt) return; // The person stopped waiting on this attempt, so the cancelled state on screen is final and the answer that arrives later is never presented as its result.
    const keepForm = lastAttemptRef.current === "register" && keepsFormVisible(settled);
    setOutcome(settled);
    setServerErrors(settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null);
    setFaulted(false);
    setPhase(keepForm ? { name: "described" } : { name: "settled", outcome: settled });
    onSettled?.(settled);
  };
  const chooseFile = async (chosen: File | null): Promise<void> => {
    if (chosen === null) return;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    clearAttempt();
    setFile(chosen);
    setPhase({ name: "preparing", stage: "measuring" });
    const measured = await probeChosenFile(chosen, kind);
    if (attemptRef.current !== attempt) return;
    setProbe(measured);
    setPhase({ name: "described" });
  };
  const cancelPreparation = (): void => {
    // Both cancel paths stop the work itself: an attempt that is still in flight is aborted, so a registration that had not been written creates nothing, and the cancelled state below states that nothing was added whichever path was taken.
    abortRef.current?.abort();
    abortRef.current = null;
    attemptRef.current += 1;
    setPhase({ name: "cancelled" });
  };
  const submitPlacement = async (): Promise<void> => {
    if (file === null || busyRef.current) return;
    const composed = composePlacement(draft, kind);
    if (composed.altText === "") {
      setLocalErrors({ "placement.altText": [missingAltText(kind)] });
      setPhase({ name: "described" });
      altTextRef.current?.focus();
      return;
    }
    // A caption track is bound to the placement's own language rather than to a second one beside it, so a track with no language is refused here, where the field that states it is on screen, instead of by the service one request later.
    const captionTrack = kind === "video" ? captionFile : null;
    if (captionTrack !== null && composed.language === undefined) {
      setLocalErrors({ "placement.language": ["Add the video’s language above before attaching a caption track."] });
      setPhase({ name: "described" });
      languageRef.current?.focus();
      return;
    }
    setLocalErrors({});
    setFaulted(false);
    busyRef.current = true;
    lastAttemptRef.current = "register";
    setPhase({ name: "preparing", stage: "submitting" });
    const attempt = attemptRef.current;
    // The one controller this attempt is stopped by: it travels beside the file as transport state, so "Stop waiting" reaches the request itself rather than only the screen that was waiting on it.
    const controller = new AbortController();
    abortRef.current = controller;
    const poster = kind === "video" && posterFile !== null ? { file: posterFile } : undefined;
    const captionLanguage = composed.language;
    const label = trackLabel.trim();
    const captions = captionTrack === null || captionLanguage === undefined ? undefined : { file: captionTrack, language: captionLanguage, ...(label === "" ? {} : { label }) };
    const input: MediaRegisterInput = { kind, file, placement: composed, ...(poster === undefined ? {} : { poster }), ...(captions === undefined ? {} : { captions }), signal: controller.signal };
    try {
      const settled = replaceId !== undefined && onReplace !== undefined ? await onReplace({ placementId: replaceId, ...input }) : await onRegister(input);
      finishAttempt(attempt, settled);
    } catch {
      // A stopped attempt is not a fault: the cancelled state already says nothing was added, and the aborted request's own answer, when one arrives, is discarded above rather than shown as a lost acknowledgement.
      if (attemptRef.current === attempt) {
        setFaulted(true);
        setPhase({ name: "described" });
      }
    } finally {
      busyRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  };
  const removePlacement = async (): Promise<void> => {
    if (removeId === undefined || onRemove === undefined || busyRef.current) return;
    busyRef.current = true;
    setFaulted(false);
    lastAttemptRef.current = "remove";
    const attempt = attemptRef.current;
    setPhase({ name: "removing" });
    try {
      const settled = await onRemove({ placementId: removeId });
      finishAttempt(attempt, settled);
    } catch {
      if (attemptRef.current === attempt) {
        setFaulted(true);
        setPhase({ name: "confirming-removal" });
      }
    } finally {
      busyRef.current = false;
    }
  };
  const replaySameWork = (): void => {
    if (lastAttemptRef.current === "remove") {
      void removePlacement();
      return;
    }
    void submitPlacement();
  };
  const errorsFor = (path: string): readonly string[] | undefined => mergeMessages(localErrors[path], serverErrors?.byField[path]);
  const clearLocalError = (path: string): void => {
    setLocalErrors((current) => (current[path] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([key]) => key !== path))));
  };
  const update = (field: keyof PlacementDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "altText" && value.trim() !== "") setLocalErrors({});
    if (field === "language" && value.trim() !== "") clearLocalError("placement.language");
  };
  const backToChoosing = (): void => {
    attemptRef.current += 1;
    clearAttempt();
    setPhase({ name: "choosing" });
  };
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    void chooseFile(chosen);
  };
  const handlePosterInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setPosterFile(event.target.files?.[0] ?? null);
    event.target.value = "";
    clearLocalError("poster");
  };
  const handleCaptionInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setCaptionFile(event.target.files?.[0] ?? null);
    event.target.value = "";
    clearLocalError("captions");
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    void chooseFile(event.dataTransfer.files[0] ?? null);
  };
  function renderLimits(): ReactElement {
    const limits =
      kind === "image"
        ? [IMAGE_LIMITS.formats, `No more than ${formatBytes(IMAGE_LIMITS.bytes)}.`, `No more than ${countFormatOf().format(IMAGE_LIMITS.edgePx)} pixels on either side.`]
        : [VIDEO_LIMITS.formats, `No more than ${formatBytes(VIDEO_LIMITS.bytes)}.`, `No longer than ${formatDuration(VIDEO_LIMITS.durationS)}.`, `No larger than ${formatPixels(VIDEO_LIMITS.width, VIDEO_LIMITS.height)}.`];
    return (
      <div className="flex flex-col gap-1">
        <p id={instructionsId} className="text-sm font-medium">
          Supported formats &amp; limits
        </p>
        <ul id={limitsId} aria-labelledby={instructionsId} className="flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground">
          {limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">Files are inspected by content rather than file extension.</p>
      </div>
    );
  }
  function renderChosenFile(): ReactElement | null {
    if (file === null) return null;
    const withinBytes = file.size <= (kind === "image" ? IMAGE_LIMITS.bytes : VIDEO_LIMITS.bytes);
    const byteLimit = formatBytes(kind === "image" ? IMAGE_LIMITS.bytes : VIDEO_LIMITS.bytes);
    const measured = kind === "image" ? (probe?.width !== undefined && probe.height !== undefined ? `Measured at ${formatPixels(probe.width, probe.height)}.` : "Its dimensions could not be read in this browser, so they are checked when the file is added.") : renderVideoMeasurement();
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="wrap-anywhere">
          <span className="text-muted-foreground">Chosen file: </span>
          <bdi className="mono-identifier">{file.name}</bdi>
        </p>
        <p>
          <bdi className="tabular-figures">{formatBytes(file.size)}</bdi>
          <span className="text-muted-foreground">
            {withinBytes ? " within" : " over"} the {byteLimit} admitted for one {kind}.
          </span>
        </p>
        <p className="text-muted-foreground">{measured}</p>
      </div>
    );
  }
  function renderVideoMeasurement(): string {
    if (probe === undefined) return "Its length and dimensions could not be read in this browser, so they are checked when the file is added.";
    const parts: string[] = [];
    if (probe.durationSeconds !== undefined) parts.push(`Runs ${formatDuration(probe.durationSeconds)} of the ${formatDuration(VIDEO_LIMITS.durationS)} admitted.`);
    if (probe.width !== undefined && probe.height !== undefined) parts.push(`Displayed at ${formatPixels(probe.width, probe.height)} of the ${formatPixels(VIDEO_LIMITS.width, VIDEO_LIMITS.height)} admitted.`);
    return parts.length === 0 ? "Its length and dimensions could not be read in this browser, so they are checked when the file is added." : parts.join(" ");
  }
  function renderLimitWarnings(): ReactElement | null {
    const problems: string[] = [];
    const limits = kind === "image" ? IMAGE_LIMITS : VIDEO_LIMITS;
    if (file !== null && file.size > limits.bytes) problems.push(`It is ${formatBytes(file.size)}, over the ${formatBytes(limits.bytes)} admitted.`);
    if (kind === "image") {
      if (probe?.width !== undefined && probe.width > IMAGE_LIMITS.edgePx) problems.push(`It is ${countFormatOf().format(probe.width)} pixels wide, over the ${countFormatOf().format(IMAGE_LIMITS.edgePx)} pixels admitted on one side.`);
      if (probe?.height !== undefined && probe.height > IMAGE_LIMITS.edgePx) problems.push(`It is ${countFormatOf().format(probe.height)} pixels tall, over the ${countFormatOf().format(IMAGE_LIMITS.edgePx)} pixels admitted on one side.`);
    } else {
      if (probe?.durationSeconds !== undefined && probe.durationSeconds > VIDEO_LIMITS.durationS) problems.push(`It runs ${Math.round(probe.durationSeconds)} seconds (${formatDuration(probe.durationSeconds)}), longer than the ${VIDEO_LIMITS.durationS} seconds admitted.`);
      if (probe?.width !== undefined && probe.width > VIDEO_LIMITS.width) problems.push(`It displays ${countFormatOf().format(probe.width)} pixels wide, over the ${countFormatOf().format(VIDEO_LIMITS.width)} admitted.`);
      if (probe?.height !== undefined && probe.height > VIDEO_LIMITS.height) problems.push(`It displays ${countFormatOf().format(probe.height)} pixels tall, over the ${countFormatOf().format(VIDEO_LIMITS.height)} admitted.`);
    }
    if (problems.length === 0) return null;
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>This file looks larger than the limit</AlertTitle>
        <AlertDescription>
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
          <p>It can still be added: this application measures the file&rsquo;s own content when it accepts it and answers with the reason if the profile refuses it.</p>
        </AlertDescription>
      </Alert>
    );
  }
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => event.preventDefault();
  function renderFileStep(): ReactElement {
    const description = kind === "image" ? `Choose a file from this device, or drop one on this field. ${IMAGE_LIMITS.formats}, no more than ${formatBytes(IMAGE_LIMITS.bytes)}.` : `Choose a file from this device, or drop one on this field. ${VIDEO_LIMITS.formats}, no more than ${formatBytes(VIDEO_LIMITS.bytes)}.`;
    return (
      <div className="flex flex-col gap-4" onDragOver={handleDragOver} onDrop={handleDrop}>
        <FormField label="File" name="file" description={description} error={errorsFor("file")} required>
          {({ id, describedBy, invalid, required }) => <Input id={id} type="file" accept={ACCEPT_HINT[kind]} aria-describedby={describedBy === undefined ? limitsId : `${describedBy} ${limitsId}`} aria-invalid={invalid} aria-required={required} className="h-auto cursor-pointer py-2" onChange={handleFileInputChange} />}
        </FormField>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <UploadIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>Dropping a file on the field above does the same thing. The button inside it is the way in with a keyboard, a screen reader or a single pointer.</span>
        </p>
        {renderLimits()}
        <SimulationLabel effect="media-preparation" />
      </div>
    );
  }
  function renderPreparing(stage: "measuring" | "submitting"): ReactElement {
    const sentence = stage === "measuring" ? "Reading file details…" : "Preparing file locally: checking format, removing metadata, and saving to your draft. Nothing is published.";
    return (
      <div aria-busy={true} className="flex flex-col gap-3">
        <Progress value={null} aria-label={`Preparing this ${kind}`} />
        <output className="flex items-start gap-2 text-sm text-muted-foreground">
          <Spinner className="mt-0.5 shrink-0" />
          <span>
            <span className="font-medium text-foreground">Preparing&hellip;</span> {sentence}
          </span>
        </output>
        <SimulationLabel effect="media-preparation" />
      </div>
    );
  }
  function renderCurrentPlacement(): ReactElement | null {
    if (placement === undefined) return null;
    const rows = [
      { label: "Alternative text", node: <bdi>{placement.altText}</bdi>, wrap: true },
      { label: "Caption", node: placement.caption === undefined ? null : <bdi>{placement.caption}</bdi>, wrap: true },
      { label: "Credit", node: placement.credit === undefined ? null : <bdi>{placement.credit}</bdi>, wrap: true },
      { label: "Language", node: placement.language === undefined ? null : <bdi>{placement.language}</bdi>, wrap: false },
    ].filter((row) => row.node !== null);
    return (
      <Card size="sm" data-slot="media-picker-current">
        <CardHeader>
          <CardTitle>What this placement says now</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {rows.map((row) => (
            <p key={row.label} className={row.wrap ? "wrap-anywhere" : undefined}>
              <span className="text-muted-foreground">{`${row.label}: `}</span>
              {row.node}
            </p>
          ))}
          <p className="text-muted-foreground">Replacing keeps this placement and swaps the file and the description below.</p>
        </CardContent>
      </Card>
    );
  }
  const altTextDescription = kind === "image" ? "Describe what this image shows for screen readers." : "Describe what this video shows when it can’t play.";
  function renderDescriptorForm(): ReactElement | null {
    if (file === null) return null;
    const selectedState = mediaStateReason("selected");
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          {renderChosenFile()}
          <div data-slot="media-preparation-state" data-preparation-state="selected" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge label="Selected" tone="neutral" srPrefix="Media preparation state" />
            <span className="text-pretty">{selectedState.label}</span>
          </div>
          {renderLimitWarnings()}
        </div>
        <FormField {...{ label: "Alt text", name: "placement.altText", required: true, description: altTextDescription, error: errorsFor("placement.altText") }}>
          {({ id, describedBy, invalid, required }) => <Textarea id={id} ref={altTextRef} rows={3} value={draft.altText} dir={direction} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} onChange={(event) => update("altText", event.target.value)} />}
        </FormField>
        <FormField label="Caption" name="placement.caption" optionalHint description="Shown below the media. Leave blank if it only repeats the alt text." error={errorsFor("placement.caption")}>
          {({ id, describedBy, invalid }) => <Input id={id} value={draft.caption} dir={direction} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("caption", event.target.value)} />}
        </FormField>
        <FormField label="Credit" name="placement.credit" optionalHint description="Photographer or source credit shown alongside the media." error={errorsFor("placement.credit")}>
          {({ id, describedBy, invalid }) => <Input id={id} value={draft.credit} dir={direction} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("credit", event.target.value)} />}
        </FormField>
        <FormField label="Language" name="placement.language" optionalHint description="Language tag for this media (for example, en or ar)." error={errorsFor("placement.language")}>
          {({ id, describedBy, invalid }) => <Input id={id} ref={languageRef} value={draft.language} autoComplete="off" spellCheck={false} className="font-mono" aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("language", event.target.value)} />}
        </FormField>
        {kind === "video" ? (
          <FormField label="Transcript" name="placement.transcript" optionalHint description="Text version of the video for readers who can’t play it." error={errorsFor("placement.transcript")}>
            {({ id, describedBy, invalid }) => <Textarea id={id} rows={4} value={draft.transcript} dir={direction} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("transcript", event.target.value)} />}
          </FormField>
        ) : null}
        {kind === "video" ? renderVideoTracks() : null}
      </div>
    );
  }
  function renderChosenTrack(chosen: File | null, what: string): ReactElement | null {
    if (chosen === null) return null;
    return (
      <p className="text-sm text-muted-foreground wrap-anywhere">
        {`${what} chosen: `}
        <bdi className="mono-identifier">{chosen.name}</bdi>
        {` (${formatBytes(chosen.size)})`}
      </p>
    );
  }
  const renderVideoTracks = (): ReactElement => (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">What plays beside the video</p>
        <p className="text-sm text-muted-foreground">Both of these are optional. Each is prepared by this application&rsquo;s own pipeline and served from the same asset as the video, so neither is a file on a public path.</p>
      </div>
      <FormField label="Poster image" name="poster" optionalHint description="The image a player shows before the video starts. It goes through the same image pipeline as a placed image, so its metadata is removed and its alternative text is the one this placement states." error={errorsFor("poster")}>
        {({ id, describedBy, invalid }) => <Input id={id} type="file" accept={ACCEPT_HINT.image} aria-describedby={describedBy} aria-invalid={invalid} className="h-auto cursor-pointer py-2" onChange={handlePosterInputChange} />}
      </FormField>
      {renderChosenTrack(posterFile, "Poster image")}
      <FormField label="Caption track (WebVTT)" name="captions" optionalHint description="The video's cues as a WebVTT file, served with the video and offered in the player's own caption menu. Its language is the video's own language, stated above." error={errorsFor("captions")}>
        {({ id, describedBy, invalid }) => <Input id={id} type="file" accept={".vtt,text/vtt"} aria-describedby={describedBy} aria-invalid={invalid} className="h-auto cursor-pointer py-2" onChange={handleCaptionInputChange} />}
      </FormField>
      {renderChosenTrack(captionFile, "Caption track")}
      {captionFile === null ? null : (
        <FormField label="Track label" name="captions.label" optionalHint description="What the player's caption menu calls this track, such as English. Leave it empty to use the language stated above." error={errorsFor("captions.label")}>
          {({ id, describedBy, invalid }) => <Input id={id} value={trackLabel} dir={direction} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => setTrackLabel(event.target.value)} />}
        </FormField>
      )}
    </div>
  );
  function renderCancelled(): ReactElement {
    const reason = mediaStateReason("cancelled"); // Stopping the wait is the same state whichever stage it stopped, so the canonical wording states that nothing was added and offers the way back.
    return <StateNotice kind="empty" title="No media added" description={reason.action === undefined ? reason.label : `${reason.label} ${reason.action}`} action={{ label: "Choose another file", onClick: backToChoosing }} />;
  }
  function renderFaulted(): ReactElement | null {
    if (!faulted) return null;
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>The request did not complete</AlertTitle>
        <AlertDescription>
          <p>Nothing here is confirmed. No answer arrived, so this application does not know whether the work was applied.</p>
          <Button {...{ type: "button", variant: "outline", size: "sm", onClick: replaySameWork }}>Try the same request again</Button>
        </AlertDescription>
      </Alert>
    );
  }
  function renderReceipt(settled: MediaPickerOutcome): ReactElement {
    const state = mediaStateForOutcome(settled);
    const reason = state === null ? null : mediaStateReason(state);
    return (
      <div className="flex flex-col gap-3">
        <SimulationLabel effect="media-preparation" context="block" />
        <OperationResult outcome={settled} headingLevel={3} fieldLabels={FIELD_LABELS} {...(mayReplay(settled) ? { onRetrySameWork: replaySameWork } : {})} />
        {reason === null ? null : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">{reason.label}</p>
            {reason.action === undefined ? null : <p className="text-sm text-muted-foreground">{reason.action}</p>}
            {state === "rejected" || state === "ready" ? <Button {...{ type: "button", variant: "outline", size: "sm", onClick: backToChoosing }}>Choose another file</Button> : null}
          </div>
        )}
      </div>
    );
  }
  const renderRemovalConfirmation = (): ReactElement => (
    <div className="flex flex-col gap-4">
      <Alert>
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>Remove media?</AlertTitle>
        <AlertDescription>
          <p>Removes this {kind} from your draft. Any published version updates when you next publish.</p>
          <p>Surrounding text stays intact, and copies already sent cannot be recalled.</p>
        </AlertDescription>
      </Alert>
      {renderFaulted()}
    </div>
  );
  const renderRemoving = (): ReactElement => (
    <div aria-busy={true} className="flex flex-col gap-3">
      <output className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="shrink-0" />
        <span>Removing this placement&hellip;</span>
      </output>
    </div>
  );
  function renderBody(): ReactElement {
    switch (phase.name) {
      case "choosing":
        return renderFileStep();
      case "preparing":
        return renderPreparing(phase.stage);
      case "described":
        return (
          <div className="flex flex-col gap-4">
            {replaceId === undefined ? null : renderCurrentPlacement()}
            {renderDescriptorForm()}
            {renderFaulted()}
            {outcome === null ? null : renderReceipt(outcome)}
          </div>
        );
      case "cancelled":
        return renderCancelled();
      case "confirming-removal":
        return renderRemovalConfirmation();
      case "removing":
        return renderRemoving();
      case "settled":
        return renderReceipt(phase.outcome);
    }
  }
  function footerActions(): readonly FooterAction[] {
    const close = (): void => onOpenChange(false);
    const removeOffered = removeId !== undefined && onRemove !== undefined;
    const confirmRemoval = (): void => {
      setFaulted(false);
      setPhase({ name: "confirming-removal" });
    };
    const leading: readonly FooterAction[] = removeOffered && (phase.name === "choosing" || phase.name === "described") ? [{ label: "Remove placement", variant: "destructive", className: "sm:me-auto", onClick: confirmRemoval }] : [];
    switch (phase.name) {
      case "choosing":
        return [...leading, { label: "Cancel", onClick: close }];
      case "preparing":
        return [{ label: phase.stage === "measuring" ? "Cancel" : "Stop waiting", onClick: cancelPreparation }];
      case "described":
        return [...leading, { label: "Choose another file", onClick: backToChoosing }, { label: replaceId === undefined ? `Add this ${kind}` : `Replace this ${kind}`, variant: "default", onClick: () => void submitPlacement() }];
      case "cancelled":
        return [{ label: "Close", onClick: close }];
      case "confirming-removal":
        return [
          { label: "Keep it", onClick: () => setPhase(file === null ? { name: "choosing" } : { name: "described" }) },
          { label: "Remove placement", variant: "destructive", onClick: () => void removePlacement() },
        ];
      case "removing":
        return [{ label: "Removing…", disabled: true }];
      case "settled":
        return [{ label: "Done", variant: "default", onClick: close }];
    }
  }
  const renderFooter = (): ReactElement => (
    <DialogFooter>
      {footerActions().map((action) => (
        <Button key={action.label} type="button" variant={action.variant ?? "outline"} disabled={action.disabled} className={action.className} onClick={action.onClick}>
          {action.label}
        </Button>
      ))}
    </DialogFooter>
  );
  const replacing = replaceId !== undefined;
  const removing = phase.name === "confirming-removal" || phase.name === "removing";
  const title = removing ? `Remove this ${kind}` : replacing ? `Replace this ${kind}` : kind === "image" ? "Add an image" : "Add a video";
  const description = PHASE_DESCRIPTION[phase.name](kind);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="media-picker" data-kind={kind} data-phase={phase.name} className={cn("max-sm:inset-0 max-sm:max-h-dvh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none", className)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "image" ? <ImageUpIcon aria-hidden="true" className="size-4 shrink-0" /> : <FilmIcon aria-hidden="true" className="size-4 shrink-0" />}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {renderBody()}
        {renderFooter()}
      </DialogContent>
    </Dialog>
  );
}
export default MediaPicker;
