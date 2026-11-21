"use client";
import { FilmIcon, ImageUpIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from "react";
import { FormField, FormFieldGroup, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import { OperationResult, type OperationResultProps } from "@/components/operation-result";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { mediaStateReason, type MediaPreparationState } from "@/modules/media/asset";
// The two kinds, the descriptor and the transport shapes, declared structurally in the payload shapes the content family's schemas validate: no schema, scope or revision appears here, because only the feature knows those.
export type MediaPickerKind = "image" | "video";
export type MediaProbe = { readonly width?: number; readonly height?: number; readonly durationSeconds?: number };
export type MediaPlacementDescriptor = { readonly altText: string; readonly caption?: string; readonly credit?: string; readonly transcript?: string; readonly language?: string; readonly posterAssetId?: string };
export interface MediaPlacement extends MediaPlacementDescriptor {
  readonly placementId?: string;
}
export type MediaRegisterInput = { readonly kind: MediaPickerKind; readonly file: File; readonly probe?: MediaProbe; readonly placement: MediaPlacementDescriptor };
export type MediaPosterOption = { readonly assetId: string; readonly label: string };
/** The outcome every transport answers with, taken from the one receipt that renders it. */
export type MediaPickerOutcome = OperationResultProps["outcome"];
export type MediaPickerProps = {
  readonly kind: MediaPickerKind;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly placement?: MediaPlacement;
  readonly onRegister: (input: MediaRegisterInput) => Promise<MediaPickerOutcome>;
  readonly onReplace?: (input: { readonly placementId: string } & MediaRegisterInput) => Promise<MediaPickerOutcome>;
  readonly onRemove?: (input: { readonly placementId: string }) => Promise<MediaPickerOutcome>;
  readonly posterAssets?: readonly MediaPosterOption[];
  readonly onSettled?: (outcome: MediaPickerOutcome) => void;
  readonly className?: string;
};
// Published limits, disclosed before the work begins: `@/modules/media/image` and `@/modules/media/video` enforce the real numbers on the bytes, and this display-only mirror departs from the ban on copies of dependency source so the ceiling is visible before a file is chosen.
const MEBIBYTE = 1024 * 1024;
const IMAGE_LIMITS = Object.freeze({ bytes: 10 * MEBIBYTE, edgePx: 8_000, formats: "JPEG, PNG or a still WebP image" });
const VIDEO_LIMITS = Object.freeze({ bytes: 100 * MEBIBYTE, durationS: 180, width: 1_920, height: 1_080, formats: "MP4 with H.264 video and AAC audio, or WebM with VP8 or VP9 video and Vorbis or Opus audio" });
const ACCEPT_HINT: Readonly<Record<MediaPickerKind, string>> = Object.freeze({ image: "image/jpeg,image/png,image/webp", video: "video/mp4,video/webm" });
const VIDEO_PROBE_TIMEOUT_MS = 15_000;
const COUNT_FORMAT = new Intl.NumberFormat("en-US");
const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  file: "File",
  probe: "File details",
  "probe.width": "Width",
  "probe.height": "Height",
  "probe.durationSeconds": "Length",
  "placement.altText": "Alternative text",
  "placement.caption": "Caption",
  "placement.credit": "Credit",
  "placement.transcript": "Transcript",
  "placement.language": "Language",
  "placement.posterAssetId": "Poster",
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
function formatPixels(width: number, height: number): string {
  return `${COUNT_FORMAT.format(width)} × ${COUNT_FORMAT.format(height)} pixels`;
}
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
async function probeChosenFile(file: File, kind: MediaPickerKind): Promise<MediaProbe | undefined> {
  return kind === "image" ? probeImage(file) : probeVideo(file);
}
// The form's own state, kept as text so every control stays controlled and nothing is lost to a re-render
type PlacementDraft = { readonly altText: string; readonly caption: string; readonly credit: string; readonly language: string; readonly transcript: string; readonly posterAssetId: string };
function draftFromPlacement(placement: MediaPlacement | undefined): PlacementDraft {
  return { altText: placement?.altText ?? "", caption: placement?.caption ?? "", credit: placement?.credit ?? "", language: placement?.language ?? "", transcript: placement?.transcript ?? "", posterAssetId: placement?.posterAssetId ?? "" };
}
function composePlacement(draft: PlacementDraft, kind: MediaPickerKind): MediaPlacementDescriptor {
  const altText = draft.altText.trim();
  const caption = draft.caption.trim();
  const credit = draft.credit.trim();
  const language = draft.language.trim();
  const transcript = draft.transcript.trim();
  const posterAssetId = draft.posterAssetId.trim();
  return { altText, ...(caption === "" ? {} : { caption }), ...(credit === "" ? {} : { credit }), ...(kind === "video" && transcript !== "" ? { transcript } : {}), ...(language === "" ? {} : { language }), ...(kind === "video" && posterAssetId !== "" ? { posterAssetId } : {}) };
}
const MEDIA_STATE_BY_OUTCOME: Readonly<Record<MediaPickerOutcome["outcome"], MediaPreparationState | null>> = { accepted: "ready", alreadyAccepted: "ready", unchanged: "ready", invalid: "rejected", unavailable: "unavailable", conflict: null, denied: null, unknown: null };
const mediaStateForOutcome = (outcome: MediaPickerOutcome): MediaPreparationState | null => MEDIA_STATE_BY_OUTCOME[outcome.outcome];
const keepsFormVisible = (outcome: MediaPickerOutcome): boolean => outcome.outcome === "invalid" || outcome.outcome === "conflict" || outcome.outcome === "unknown" || outcome.outcome === "unavailable";
const mayReplaySameWork = (outcome: MediaPickerOutcome | null): boolean => outcome !== null && (outcome.outcome === "unavailable" || outcome.outcome === "unknown");
function mergeMessages(first: readonly string[] | undefined, second: readonly string[] | undefined): readonly string[] | undefined {
  const messages = [...(first ?? []), ...(second ?? [])];
  return messages.length === 0 ? undefined : messages;
}
const missingAltText = (kind: MediaPickerKind): string => (kind === "image" ? "Describe what this image shows. It is read aloud in place of the picture." : "Describe what this video shows. It stays as the text alternative when the video cannot play.");
type PickerPhase =
  | { readonly name: "choosing" }
  | { readonly name: "preparing"; readonly stage: "measuring" | "submitting" }
  | { readonly name: "described" }
  | { readonly name: "cancelled" }
  | { readonly name: "confirming-removal" }
  | { readonly name: "removing" }
  | { readonly name: "settled"; readonly outcome: MediaPickerOutcome };
const OPENING_SENTENCE: Readonly<Record<MediaPickerKind, string>> = Object.freeze({
  image: "Choose an image from this device and describe what it shows. It is placed in the draft you are editing; nothing is published and no address is made public.",
  video: "Choose a video from this device and describe what it shows. It is placed in the draft you are editing; nothing is published and no address is made public.",
});
type FooterAction = { readonly label: string; readonly onClick?: () => void; readonly variant?: "default" | "destructive"; readonly disabled?: boolean; readonly className?: string };
/** The single image and video picker and placement form. */
export function MediaPicker({ kind, open, onOpenChange, placement, onRegister, onReplace, onRemove, posterAssets, onSettled, className }: MediaPickerProps): ReactElement {
  const instructionsId = useId();
  const limitsId = useId();
  const altTextRef = useRef<HTMLTextAreaElement | null>(null);
  const placementRef = useRef(placement);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const attemptRef = useRef(0);
  const busyRef = useRef(false);
  const lastAttemptRef = useRef<"register" | "remove">("register");
  const [phase, setPhase] = useState<PickerPhase>({ name: "choosing" });
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<MediaProbe | undefined>(undefined);
  const [draft, setDraft] = useState<PlacementDraft>(() => draftFromPlacement(placement));
  const [localErrors, setLocalErrors] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrorLookup | null>(null);
  const [outcome, setOutcome] = useState<MediaPickerOutcome | null>(null);
  const [stoppedWaiting, setStoppedWaiting] = useState(false);
  const [faulted, setFaulted] = useState(false);
  const replaceId = onReplace === undefined ? undefined : placement?.placementId;
  const removeId = onRemove === undefined ? undefined : placement?.placementId;
  const posterChoices = kind === "video" ? (posterAssets ?? []) : [];
  const clearAttempt = (): void => {
    setFile(null);
    setProbe(undefined);
    setOutcome(null);
    setServerErrors(null);
    setLocalErrors({});
    setStoppedWaiting(false);
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
  const finishAttempt = (settled: MediaPickerOutcome): void => {
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
    const submitting = phase.name === "preparing" && phase.stage === "submitting";
    attemptRef.current += 1;
    setStoppedWaiting(submitting);
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
    setLocalErrors({});
    setFaulted(false);
    setStoppedWaiting(false);
    busyRef.current = true;
    lastAttemptRef.current = "register";
    setPhase({ name: "preparing", stage: "submitting" });
    const input: MediaRegisterInput = { kind, file, ...(probe === undefined ? {} : { probe }), placement: composed };
    try {
      const settled = replaceId !== undefined && onReplace !== undefined ? await onReplace({ placementId: replaceId, ...input }) : await onRegister(input);
      finishAttempt(settled);
    } catch {
      setFaulted(true);
      setPhase({ name: "described" });
    } finally {
      busyRef.current = false;
    }
  };
  const removePlacement = async (): Promise<void> => {
    if (removeId === undefined || onRemove === undefined || busyRef.current) return;
    busyRef.current = true;
    setFaulted(false);
    setStoppedWaiting(false);
    lastAttemptRef.current = "remove";
    setPhase({ name: "removing" });
    try {
      const settled = await onRemove({ placementId: removeId });
      finishAttempt(settled);
    } catch {
      setFaulted(true);
      setPhase({ name: "confirming-removal" });
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
  const update = (field: keyof PlacementDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "altText" && value.trim() !== "") setLocalErrors({});
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
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    void chooseFile(event.dataTransfer.files[0] ?? null);
  };
  function renderLimits(): ReactElement {
    const limits =
      kind === "image"
        ? [IMAGE_LIMITS.formats, `No more than ${formatBytes(IMAGE_LIMITS.bytes)}.`, `No more than ${COUNT_FORMAT.format(IMAGE_LIMITS.edgePx)} pixels on either side.`]
        : [VIDEO_LIMITS.formats, `No more than ${formatBytes(VIDEO_LIMITS.bytes)}.`, `No longer than ${formatDuration(VIDEO_LIMITS.durationS)}.`, `No larger than ${formatPixels(VIDEO_LIMITS.width, VIDEO_LIMITS.height)}.`];
    return (
      <div className="flex flex-col gap-1">
        <p id={instructionsId} className="text-sm font-medium">
          What this placement admits
        </p>
        <ul id={limitsId} aria-labelledby={instructionsId} className="flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground">
          {limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">This application checks the file&rsquo;s content itself, so a name or an extension never decides what a file is.</p>
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
    if (probe.durationSeconds !== undefined) {
      parts.push(`Runs ${formatDuration(probe.durationSeconds)} of the ${formatDuration(VIDEO_LIMITS.durationS)} admitted.`);
    }
    if (probe.width !== undefined && probe.height !== undefined) {
      parts.push(`Displayed at ${formatPixels(probe.width, probe.height)} of the ${formatPixels(VIDEO_LIMITS.width, VIDEO_LIMITS.height)} admitted.`);
    }
    return parts.length === 0 ? "Its length and dimensions could not be read in this browser, so they are checked when the file is added." : parts.join(" ");
  }
  function renderLimitWarnings(): ReactElement | null {
    const problems: string[] = [];
    const limits = kind === "image" ? IMAGE_LIMITS : VIDEO_LIMITS;
    if (file !== null && file.size > limits.bytes) {
      problems.push(`It is ${formatBytes(file.size)}, over the ${formatBytes(limits.bytes)} admitted.`);
    }
    if (kind === "image") {
      if (probe?.width !== undefined && probe.width > IMAGE_LIMITS.edgePx) {
        problems.push(`It is ${COUNT_FORMAT.format(probe.width)} pixels wide, over the ${COUNT_FORMAT.format(IMAGE_LIMITS.edgePx)} pixels admitted on one side.`);
      }
      if (probe?.height !== undefined && probe.height > IMAGE_LIMITS.edgePx) {
        problems.push(`It is ${COUNT_FORMAT.format(probe.height)} pixels tall, over the ${COUNT_FORMAT.format(IMAGE_LIMITS.edgePx)} pixels admitted on one side.`);
      }
    } else {
      if (probe?.durationSeconds !== undefined && probe.durationSeconds > VIDEO_LIMITS.durationS) {
        problems.push(`It runs ${Math.round(probe.durationSeconds)} seconds (${formatDuration(probe.durationSeconds)}), longer than the ${VIDEO_LIMITS.durationS} seconds admitted.`);
      }
      if (probe?.width !== undefined && probe.width > VIDEO_LIMITS.width) {
        problems.push(`It displays ${COUNT_FORMAT.format(probe.width)} pixels wide, over the ${COUNT_FORMAT.format(VIDEO_LIMITS.width)} admitted.`);
      }
      if (probe?.height !== undefined && probe.height > VIDEO_LIMITS.height) {
        problems.push(`It displays ${COUNT_FORMAT.format(probe.height)} pixels tall, over the ${COUNT_FORMAT.format(VIDEO_LIMITS.height)} admitted.`);
      }
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
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };
  function renderFileStep(): ReactElement {
    const description = kind === "image" ? `Choose a file from this device, or drop one on this field. ${IMAGE_LIMITS.formats}, no more than ${formatBytes(IMAGE_LIMITS.bytes)}.` : `Choose a file from this device, or drop one on this field. ${VIDEO_LIMITS.formats}, no more than ${formatBytes(VIDEO_LIMITS.bytes)}.`;
    return (
      <div className="flex flex-col gap-4" onDragOver={handleDragOver} onDrop={handleDrop}>
        <FormField label="File" name="file" description={description} error={mergeMessages(errorsFor("file"), errorsFor("probe"))} required>
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
    const sentence = stage === "measuring" ? "Reading this file's own details in this browser so the form can show them beside the limit." : "Preparing this file with the local media pipeline: it is decoded, checked, re-encoded so its metadata is removed, and stored. Nothing is published.";
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
      { label: "Poster", node: placement.posterAssetId === undefined ? null : <bdi className="mono-identifier">{placement.posterAssetId}</bdi>, wrap: true },
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
  function renderDescriptorForm(): ReactElement | null {
    if (file === null) return null;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          {renderChosenFile()}
          {renderLimitWarnings()}
        </div>
        <FormField
          label="Alternative text"
          name="placement.altText"
          required
          description={kind === "image" ? "What this image shows, in your words. It is read aloud in place of the picture." : "What this video shows, in your words. It stays as the text alternative when the video cannot play."}
          error={errorsFor("placement.altText")}
        >
          {({ id, describedBy, invalid, required }) => <Textarea id={id} ref={altTextRef} rows={3} value={draft.altText} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} onChange={(event) => update("altText", event.target.value)} />}
        </FormField>
        <FormField label="Caption" name="placement.caption" optionalHint description="Shown beneath the media. Leave it empty when a caption would only repeat the alternative text." error={errorsFor("placement.caption")}>
          {({ id, describedBy, invalid }) => <Input id={id} value={draft.caption} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("caption", event.target.value)} />}
        </FormField>
        <FormField label="Credit" name="placement.credit" optionalHint description="Who made or supplied this media, as it should read beside it." error={errorsFor("placement.credit")}>
          {({ id, describedBy, invalid }) => <Input id={id} value={draft.credit} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("credit", event.target.value)} />}
        </FormField>
        <FormField label="Language" name="placement.language" optionalHint description="The language this media is in, as a tag such as en or ar, or as a name. It is the media's language, never this interface's." error={errorsFor("placement.language")}>
          {({ id, describedBy, invalid }) => <Input id={id} value={draft.language} autoComplete="off" spellCheck={false} className="font-mono" aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("language", event.target.value)} />}
        </FormField>
        {kind === "video" ? (
          <FormField label="Transcript" name="placement.transcript" optionalHint description="The video's words as text, for a reader who cannot play it. It is stored and shown as content, never as trusted metadata." error={errorsFor("placement.transcript")}>
            {({ id, describedBy, invalid }) => <Textarea id={id} rows={4} value={draft.transcript} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => update("transcript", event.target.value)} />}
          </FormField>
        ) : null}
        {renderPosterChoices()}
      </div>
    );
  }
  function renderPosterChoices(): ReactElement | null {
    if (posterChoices.length === 0) return null;
    return (
      <FormFieldGroup legend="Poster" name="placement.posterAssetId" optionalHint description="An image already registered in this draft, shown before the video plays." error={errorsFor("placement.posterAssetId")}>
        {() => (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={draft.posterAssetId === "" ? "default" : "outline"} aria-pressed={draft.posterAssetId === ""} onClick={() => update("posterAssetId", "")}>
              No poster
            </Button>
            {posterChoices.map((choice) => (
              <Button key={choice.assetId} type="button" size="sm" variant={draft.posterAssetId === choice.assetId ? "default" : "outline"} aria-pressed={draft.posterAssetId === choice.assetId} onClick={() => update("posterAssetId", choice.assetId)}>
                <bdi>{choice.label}</bdi>
              </Button>
            ))}
          </div>
        )}
      </FormFieldGroup>
    );
  }
  function renderCancelled(): ReactElement {
    const description = stoppedWaiting ? "You stopped waiting. The request had already been sent, so its result appears here when it arrives. Nothing in your draft was changed." : mediaStateReason("cancelled").label;
    return <StateNotice kind="empty" title="No media added" description={description} action={{ label: "Choose another file", onClick: backToChoosing }} />;
  }
  function renderFaulted(): ReactElement | null {
    if (!faulted) return null;
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>The request did not complete</AlertTitle>
        <AlertDescription>
          <p>Nothing here is confirmed. No answer arrived, so this application does not know whether the work was applied.</p>
          <Button type="button" variant="outline" size="sm" onClick={replaySameWork}>
            Try the same request again
          </Button>
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
        <OperationResult outcome={settled} headingLevel={3} fieldLabels={FIELD_LABELS} {...(mayReplaySameWork(settled) ? { onRetrySameWork: replaySameWork } : {})} />
        {reason === null ? null : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">{reason.label}</p>
            {reason.action === undefined ? null : <p className="text-sm text-muted-foreground">{reason.action}</p>}
            {state === "rejected" || state === "ready" ? (
              <Button type="button" variant="outline" size="sm" onClick={backToChoosing}>
                Choose another file
              </Button>
            ) : null}
          </div>
        )}
      </div>
    );
  }
  function renderRemovalConfirmation(): ReactElement {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Remove this placement?</AlertTitle>
          <AlertDescription>
            <p>This removes the {kind} from the draft you are editing and changes released content, so it asks before it acts.</p>
            <p>It recalls nothing that was already sent or read, the registered file stays available to every other placement, and the text around the placement is unchanged.</p>
          </AlertDescription>
        </Alert>
        {renderFaulted()}
      </div>
    );
  }
  function renderRemoving(): ReactElement {
    return (
      <div aria-busy={true} className="flex flex-col gap-3">
        <output className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="shrink-0" />
          <span>Removing this placement&hellip;</span>
        </output>
      </div>
    );
  }
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
        return (
          <div className="flex flex-col gap-4">
            {renderCancelled()}
            {outcome === null ? null : renderReceipt(outcome)}
          </div>
        );
      case "confirming-removal":
        return renderRemovalConfirmation();
      case "removing":
        return renderRemoving();
      case "settled":
        return renderReceipt(phase.outcome);
    }
  }
  function footerActions(): readonly FooterAction[] {
    const close = (): void => {
      onOpenChange(false);
    };
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
  function renderFooter(): ReactElement {
    return (
      <DialogFooter>
        {footerActions().map((action) => (
          <Button key={action.label} type="button" variant={action.variant ?? "outline"} disabled={action.disabled} className={action.className} onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
      </DialogFooter>
    );
  }
  const replacing = replaceId !== undefined;
  const removing = phase.name === "confirming-removal" || phase.name === "removing";
  const title = removing ? `Remove this ${kind}` : replacing ? `Replace this ${kind}` : kind === "image" ? "Add an image" : "Add a video";
  const description = removing
    ? "Removing a placement changes released content, so this asks before it acts."
    : phase.name === "described"
      ? `Describe the ${kind} this placement shows. Alternative text is required; every other field is optional.`
      : phase.name === "preparing"
        ? `This ${kind} is being prepared with this application's own media pipeline, on this device.`
        : phase.name === "cancelled"
          ? "Nothing was added, and the draft you were editing is unchanged."
          : phase.name === "settled"
            ? "This is what the attempt answered. The record stays on screen until you close the picker."
            : OPENING_SENTENCE[kind];
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
