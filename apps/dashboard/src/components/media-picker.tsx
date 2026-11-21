"use client";

/**
 * The one image and video picker and placement form.
 *
 * Ministry Updates and Worker/Project Pages both attach media, so this file is the single place a
 * file is chosen, described and placed. It composes the installed `Dialog`, `Input`, `Textarea`,
 * `Progress`, `Alert`, `Button` and `Card` primitives with the owned `FormField`, `StateNotice`,
 * `SimulationLabel` and `OperationResult` surfaces rather than re-implementing a form or a receipt,
 * and it renders no playback of its own — `components/video-player.tsx` owns that.
 *
 * The invariants this file holds for its caller:
 *
 * - Selection is never drag-only. The native file input is the control: a real `<Input type="file">`
 *   with a visible label, operable by keyboard, touch and pointer. Dropping a file on the field is an
 *   additional convenience that calls the same handler, never the only way to choose (WCAG 2.5.7).
 * - The file's kind is never inferred here. `accept` is a hint to the platform picker and the two
 *   numbers below are the published limits shown to the person choosing; the authoritative typing,
 *   decoding, re-encoding and metadata stripping belong to `@/modules/media/*`, which this file never
 *   bypasses and never duplicates. A refusal is that module's or the service's to state.
 * - The original file name is shown to the uploader and to nobody else. It is never used as
 *   alternative text, a caption, a stored label, an accessible name or a download name, so no copy of
 *   it can reach a reader through a placement.
 * - The six preparation states are the media module's own closed set, and each is rendered as text,
 *   not only as a bar or a colour. `mediaStateReason()` supplies the label and the next step, so this
 *   surface and every other one say the same thing about the same state.
 * - Preparation is local processing. Nothing here uploads to a third party, scans for malware or
 *   transcodes remotely, and the surface says so at the trigger and again on the result.
 * - No address is built here. Rendition URLs are the service's to mint and re-authorise per request;
 *   this component receives none and constructs none, and it shows no permanent public address.
 * - Nothing here decides authorisation. Registering, replacing and removing are authorised by the
 *   service, and its `denied` outcome renders through `OperationResult` like every other outcome.
 * - Preparing media never touches the draft prose. Cancelling discards the chosen file and nothing
 *   else, and a failed placement leaves the rest of the draft exactly as it was.
 *
 * Why the removal confirmation is this component's own panel rather than `ActionReview`: that step
 * requires the full four-field mutation input — the scope the caller is acting in, the revision it
 * saw, and the payload — and it mints the operation identity itself. This component's transport is
 * supplied as payload-only callbacks (`onRegister`, `onReplace`, `onRemove`), because the feature that
 * owns the variant is the only party that knows its scope and revision. Inventing those values here to
 * satisfy `ActionReview` would make its conflict and replay guarantees meaningless, and dropping the
 * identity it minted would break them outright. So the confirmation is a plain `Dialog` panel with the
 * consequence stated before the write, and every result still renders through `OperationResult`.
 *
 * Scope: AAP 0.3.4 ("one media picker and placement form", consumed by Update images and video, Page
 * image/video sections, posters and caption tracks), 0.4.2 (`Progress` for media preparation, states
 * announced textually), 0.6.3 (the published upload limits), 0.8.6 (the image and video profiles, the
 * six states, alt text required and a failed image leaving the text and other media intact), 0.11.1
 * (the `media-picker` deliverable) and Rule 1 clauses 1-3. Evidence: success criteria 9 and 18.
 */

import { FilmIcon, ImageUpIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from "react";

import {
  FormField,
  FormFieldGroup,
  fieldErrorsFromInvalid,
  type FieldErrorLookup,
} from "@/components/form-field";
import { OperationResult, type OperationResultProps } from "@/components/operation-result";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { mediaStateReason, type MediaPreparationState } from "@/modules/media/asset";

// ---------------------------------------------------------------------------------------------
// The two kinds, the descriptor and the transport shapes
//
// These are declared structurally, in the payload shapes the content family's own schemas validate,
// so a feature passes what it already has and maps it into its four-field mutation input itself. No
// schema, no scope and no revision appears here: only the feature knows those.
// ---------------------------------------------------------------------------------------------

/** The two kinds one placement can show. There is no third. */
export type MediaPickerKind = "image" | "video";

/**
 * The numbers the picker read from the chosen file's own metadata: the decoded dimensions of a still,
 * and the container's duration and display dimensions for a video.
 *
 * They are a hint for the form — never a claim about the bytes. The service measures the same values
 * from the content when it accepts the asset and is the authority on all three, so a payload without
 * them is not a claim that the file is small, only that nothing was measured in this browser.
 */
export interface MediaProbe {
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
}

/**
 * What one placement says about the media it shows: the descriptor a placement carries, exactly as the
 * content family's payload validates it.
 *
 * Alternative text is required and is never derived from the caption: a caption is visible prose about
 * the placement, while alternative text is what a screen-reader user is told instead of the picture and
 * what remains as the text alternative when a video cannot play. Caption, credit, transcript, language
 * and poster are optional, because a placement without them is complete rather than incomplete. The
 * poster is an identifier of an already registered rendition, never an address, so a placement cannot
 * become a way around the per-request authorisation every rendition read performs.
 */
export interface MediaPlacementDescriptor {
  readonly altText: string;
  readonly caption?: string;
  readonly credit?: string;
  readonly transcript?: string;
  readonly language?: string;
  readonly posterAssetId?: string;
}

/**
 * An existing placement, as the caller already holds it: the descriptor plus the identity it carries on
 * the variant.
 *
 * `placementId` is what replacement keeps and removal names. When a caller supplies a descriptor without
 * it, this component treats the work as placing a new file, because a replacement without the identity
 * it preserves would silently become a second placement.
 */
export interface MediaPlacement extends MediaPlacementDescriptor {
  readonly placementId?: string;
}

/**
 * What one call to the caller's registration transport carries: the chosen file, what this browser could
 * measure about it, and the descriptor its placement will carry.
 *
 * The `File` travels rather than its bytes, because its bytes are what the media module types by content
 * and what the service persists; nothing here reads, forwards or stores a name.
 */
export interface MediaRegisterInput {
  readonly kind: MediaPickerKind;
  readonly file: File;
  readonly probe?: MediaProbe;
  readonly placement: MediaPlacementDescriptor;
}

/** One already registered poster rendition a video placement may name, as the caller offers it. */
export interface MediaPosterOption {
  /** The rendition identity the service assigned. It is opaque and never parsed here. */
  readonly assetId: string;
  /** The name the person choosing reads: what the poster shows, never a file name. */
  readonly label: string;
}

/**
 * The outcome every transport answers with, taken from the one receipt that renders it.
 *
 * Deriving it from `OperationResultProps` rather than restating the eight members keeps this file and the
 * receipt from ever disagreeing about the closed set: a ninth member added there reaches here, and a
 * member removed there fails to compile here.
 */
export type MediaPickerOutcome = OperationResultProps["outcome"];

/** Props of {@link MediaPicker}. */
export interface MediaPickerProps {
  /** Whether this placement shows an image or a video. */
  readonly kind: MediaPickerKind;

  /** Whether the picker is open. The caller owns it, so the trigger stays the caller's own control. */
  readonly open: boolean;

  /** Opens or closes the picker. Called on every close, including Escape and the dialog's own control. */
  readonly onOpenChange: (open: boolean) => void;

  /**
   * The placement being replaced or removed, when there is one. Present, it pre-fills the form with the
   * descriptor the placement already carries and shows it above the form so the person can see what
   * changes.
   */
  readonly placement?: MediaPlacement;

  /** Registers one chosen file as a new placement. The feature composes the four-field mutation input. */
  readonly onRegister: (input: MediaRegisterInput) => Promise<MediaPickerOutcome>;

  /**
   * Replaces an existing placement with a newly registered file, keeping the placement's identity.
   * Offered only when the placement carries a `placementId`.
   */
  readonly onReplace?: (
    input: { readonly placementId: string } & MediaRegisterInput,
  ) => Promise<MediaPickerOutcome>;

  /**
   * Removes an existing placement. Removing a placement removes a reference and nothing beside it: a
   * registered asset stays available to every other placement and a release that already served the
   * media keeps serving it, which is what the confirmation states.
   */
  readonly onRemove?: (input: { readonly placementId: string }) => Promise<MediaPickerOutcome>;

  /**
   * Poster renditions already registered for this draft, offered to a video placement. Omitted, no poster
   * control renders, because a poster must name an already registered rendition and nothing else may be
   * invented here.
   */
  readonly posterAssets?: readonly MediaPosterOption[];

  /**
   * Called once each time an attempt settles, with the outcome the receipt renders. A feature uses it to
   * invalidate the reads the change touched; it may not use it to report the result, because the receipt
   * in this dialog is the record.
   */
  readonly onSettled?: (outcome: MediaPickerOutcome) => void;

  /** Layout classes for the dialog panel. Never a colour, radius or shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// The published limits, shown before the work begins
//
// The authoritative numbers belong to `@/modules/media/image` and `@/modules/media/video`, which enforce
// them on the bytes. This file restates them only to disclose what the person choosing is up against
// before anything is sent, and it never refuses a file on them: a warning can be wrong by a rounding and
// cost nothing, where a refusal based on a mirrored constant would block a file the profile admits.
//
// Restating them is the one place this file departs from Rule 1 clause 2's ban on copies of dependency
// source, because the two profile modules are not part of this component's declared dependencies and a
// picker that could not state the ceiling before a file was chosen would fail the reason the limits exist.
// They stay display-only for the same reason: the profiles, not this mirror, decide what is admitted.
// ---------------------------------------------------------------------------------------------

/** One mebibyte in bytes: the unit both media profiles state their byte ceilings in. */
const MEBIBYTE = 1024 * 1024;

/** What an image placement admits, in the words the form shows. */
const IMAGE_LIMITS = Object.freeze({
  bytes: 10 * MEBIBYTE,
  edgePx: 8_000,
  formats: "JPEG, PNG or a still WebP image",
});

/** What a video placement admits, in the words the form shows. */
const VIDEO_LIMITS = Object.freeze({
  bytes: 100 * MEBIBYTE,
  durationS: 180,
  width: 1_920,
  height: 1_080,
  formats: "MP4 with H.264 video and AAC audio, or WebM with VP8 or VP9 video and Vorbis or Opus audio",
});

/** The `accept` hint per kind. A hint to the platform picker only: it never establishes a file's type. */
const ACCEPT_HINT: Readonly<Record<MediaPickerKind, string>> = Object.freeze({
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/webm",
});

/** How long a video is given to report its own metadata before the measurement is abandoned. */
const VIDEO_PROBE_TIMEOUT_MS = 15_000;

/** The number grouping every count and dimension in this dialog uses. */
const COUNT_FORMAT = new Intl.NumberFormat();

/** Field paths the service refuses, paired with the words the receipt's summary reads. */
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

// ---------------------------------------------------------------------------------------------
// Formatting, so a measured number is always shown beside the limit it is measured against
// ---------------------------------------------------------------------------------------------

/** A byte count in mebibytes: `2.4 MiB`, `10 MiB`. */
function formatBytes(bytes: number): string {
  const mebibytes = bytes / MEBIBYTE;
  const shown = Number.isInteger(mebibytes) ? String(mebibytes) : mebibytes.toFixed(1);
  return `${shown} MiB`;
}

/** A duration in the unit a person reads fastest: `48 seconds`, `3 minutes`, `3 minutes 30 seconds`. */
function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  if (minutes === 0) return `${remainder} seconds`;
  const plural = minutes === 1 ? "minute" : "minutes";
  if (remainder === 0) return `${minutes} ${plural}`;
  return `${minutes} ${plural} ${remainder} seconds`;
}

/** A pixel measurement with grouped digits: `1,280 × 720 pixels`. */
function formatPixels(width: number, height: number): string {
  return `${COUNT_FORMAT.format(width)} × ${COUNT_FORMAT.format(height)} pixels`;
}

// ---------------------------------------------------------------------------------------------
// Reading the chosen file in this browser
// ---------------------------------------------------------------------------------------------

/** Measures a still image's decoded dimensions, or reports that this browser could not. */
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

/**
 * Measures a video's duration and display dimensions from its own metadata.
 *
 * The element is never attached to the document and never plays: it loads the container's metadata from
 * an object URL that is revoked as soon as the measurement settles, so nothing is left holding the bytes.
 * A container this browser cannot read resolves `undefined` rather than guessing, which is why the form
 * says the length will be checked when the file is added.
 */
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
      const duration =
        Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined;
      finish({
        ...(element.videoWidth > 0 ? { width: element.videoWidth } : {}),
        ...(element.videoHeight > 0 ? { height: element.videoHeight } : {}),
        ...(duration === undefined ? {} : { durationSeconds: duration }),
      });
    };
    element.onerror = () => finish(undefined);
    element.preload = "metadata";
    element.muted = true;
    element.src = url;
  });
}

/** Measures the chosen file with the reader its kind needs. */
async function probeChosenFile(
  file: File,
  kind: MediaPickerKind,
): Promise<MediaProbe | undefined> {
  return kind === "image" ? probeImage(file) : probeVideo(file);
}


// ---------------------------------------------------------------------------------------------
// The form's own state, kept as text so every control stays controlled and nothing is lost to a re-render
// ---------------------------------------------------------------------------------------------

/** The descriptor as the form holds it: every field present, an empty string meaning "not supplied". */
interface PlacementDraft {
  readonly altText: string;
  readonly caption: string;
  readonly credit: string;
  readonly language: string;
  readonly transcript: string;
  readonly posterAssetId: string;
}

/** The form's starting values: the existing placement's descriptor, or nothing. */
function draftFromPlacement(placement: MediaPlacement | undefined): PlacementDraft {
  return {
    altText: placement?.altText ?? "",
    caption: placement?.caption ?? "",
    credit: placement?.credit ?? "",
    language: placement?.language ?? "",
    transcript: placement?.transcript ?? "",
    posterAssetId: placement?.posterAssetId ?? "",
  };
}

/**
 * The descriptor one submission carries: trimmed, with the empty fields dropped rather than sent blank.
 *
 * The placement identity is deliberately absent. It belongs to the mutation that replaces a placement, not
 * to the descriptor it installs, so a payload built here can never move a placement into another variant or
 * claim an identity it was not given.
 */
function composePlacement(draft: PlacementDraft, kind: MediaPickerKind): MediaPlacementDescriptor {
  const altText = draft.altText.trim();
  const caption = draft.caption.trim();
  const credit = draft.credit.trim();
  const language = draft.language.trim();
  const transcript = draft.transcript.trim();
  const posterAssetId = draft.posterAssetId.trim();

  return {
    altText,
    ...(caption === "" ? {} : { caption }),
    ...(credit === "" ? {} : { credit }),
    ...(kind === "video" && transcript !== "" ? { transcript } : {}),
    ...(language === "" ? {} : { language }),
    ...(kind === "video" && posterAssetId !== "" ? { posterAssetId } : {}),
  };
}

/** The preparation state an outcome leaves the placement in, or `null` where it says nothing about it. */
function mediaStateForOutcome(outcome: MediaPickerOutcome): MediaPreparationState | null {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
      return "ready";
    case "invalid":
      return "rejected";
    case "unavailable":
      return "unavailable";
    case "conflict":
    case "denied":
    case "unknown":
      return null;
  }
}

/**
 * Whether the form stays on the page after this outcome.
 *
 * A refused payload, a stale revision, an unconfirmed effect and a down source are the four outcomes a person
 * corrects or retries beside the input that produced them, so the form stays and the receipt appears beneath
 * it. The other four settle the work: continuing to offer the form would invite a second effect under a new
 * intent, which is exactly what the closed outcome set exists to prevent.
 */
function keepsFormVisible(outcome: MediaPickerOutcome): boolean {
  return (
    outcome.outcome === "invalid" ||
    outcome.outcome === "conflict" ||
    outcome.outcome === "unknown" ||
    outcome.outcome === "unavailable"
  );
}

/** Whether replaying the same work is the honest recovery the receipt may offer. */
function mayReplaySameWork(outcome: MediaPickerOutcome | null): boolean {
  return outcome !== null && (outcome.outcome === "unavailable" || outcome.outcome === "unknown");
}

/** Joins the messages of two field paths, dropping either when it is absent and keeping the order. */
function mergeMessages(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined,
): readonly string[] | undefined {
  const messages = [...(first ?? []), ...(second ?? [])];
  return messages.length === 0 ? undefined : messages;
}

/** What the form says when the alternative text is empty. It never quotes the file name. */
function missingAltText(kind: MediaPickerKind): string {
  return kind === "image"
    ? "Describe what this image shows. It is read aloud in place of the picture."
    : "Describe what this video shows. It stays as the text alternative when the video cannot play.";
}

/** Which of the picker's own stages is showing. */
type PickerPhase =
  | { readonly name: "choosing" }
  | { readonly name: "preparing"; readonly stage: "measuring" | "submitting" }
  | { readonly name: "described" }
  | { readonly name: "cancelled" }
  | { readonly name: "confirming-removal" }
  | { readonly name: "removing" }
  | { readonly name: "settled"; readonly outcome: MediaPickerOutcome };

/** The sentence the dialog opens with, per kind, naming what the file is for and what it is not. */
const OPENING_SENTENCE: Readonly<Record<MediaPickerKind, string>> = Object.freeze({
  image:
    "Choose an image from this device and describe what it shows. It is placed in the draft you are editing; nothing is published and no address is made public.",
  video:
    "Choose a video from this device and describe what it shows. It is placed in the draft you are editing; nothing is published and no address is made public.",
});

// ---------------------------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------------------------

/**
 * The single image and video picker and placement form.
 *
 * Holds only transient form state: the chosen file, what this browser measured, the descriptor being typed,
 * the outcome of the last attempt, and which stage is showing. It reaches no store, no service and no clock,
 * builds no address, and mints no operation identity — its single outbound call for each job is the callback
 * the owning feature supplied.
 */
export function MediaPicker({
  kind,
  open,
  onOpenChange,
  placement,
  onRegister,
  onReplace,
  onRemove,
  posterAssets,
  onSettled,
  className,
}: MediaPickerProps): ReactElement {
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

  /** The identity replacement keeps, present only when the caller offered a replacement transport. */
  const replaceId = onReplace === undefined ? undefined : placement?.placementId;
  /** The identity removal names, present only when the caller offered a removal transport. */
  const removeId = onRemove === undefined ? undefined : placement?.placementId;
  const posterChoices = kind === "video" ? (posterAssets ?? []) : [];

  /* The prop is read when the dialog opens, so a caller that re-renders with a fresh object identity while
   * the person is typing cannot reset the descriptor under them. */
  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);

  /**
   * Resets the picker when it opens and returns the keyboard position when it closes.
   *
   * The trigger is the caller's own control, so the element that had focus is captured here and restored on
   * close: a person who opened the picker from a toolbar button lands back on that button rather than at the
   * start of the page.
   */
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    if (open && !wasOpen) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      attemptRef.current += 1;
      setPhase({ name: "choosing" });
      setFile(null);
      setProbe(undefined);
      setDraft(draftFromPlacement(placementRef.current));
      setLocalErrors({});
      setServerErrors(null);
      setOutcome(null);
      setStoppedWaiting(false);
      setFaulted(false);
      return;
    }

    if (!open && wasOpen) {
      const previous = returnFocusRef.current;
      returnFocusRef.current = null;
      if (previous !== null && previous.isConnected) previous.focus();
    }
  }, [open]);

  /**
   * Records one settled attempt and decides whether the form stays beside its receipt.
   *
   * Only a registration keeps its form: a removal has no file to correct, so its receipt carries the whole
   * answer and its own retry, and returning to a form with no file in it would offer a submit that cannot work.
   */
  const finishAttempt = (settled: MediaPickerOutcome): void => {
    const keepForm = lastAttemptRef.current === "register" && keepsFormVisible(settled);
    setOutcome(settled);
    setServerErrors(settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null);
    setFaulted(false);
    setPhase(keepForm ? { name: "described" } : { name: "settled", outcome: settled });
    onSettled?.(settled);
  };

  /** Measures the chosen file, then shows the form. A later choice, or a cancellation, wins. */
  const chooseFile = async (chosen: File | null): Promise<void> => {
    if (chosen === null) return;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    setFile(chosen);
    setProbe(undefined);
    setOutcome(null);
    setServerErrors(null);
    setLocalErrors({});
    setStoppedWaiting(false);
    setFaulted(false);
    setPhase({ name: "preparing", stage: "measuring" });

    const measured = await probeChosenFile(chosen, kind);
    if (attemptRef.current !== attempt) return;
    setProbe(measured);
    setPhase({ name: "described" });
  };

  /**
   * Stops the work in progress without touching the draft.
   *
   * While this browser is still measuring, the attempt number moves on and the measurement is discarded, so
   * nothing was ever sent. Once a request is in flight it cannot be recalled, so the cancelled panel says the
   * result is still coming and the receipt replaces it when it arrives rather than pretending it did not.
   */
  const cancelPreparation = (): void => {
    const submitting = phase.name === "preparing" && phase.stage === "submitting";
    attemptRef.current += 1;
    setStoppedWaiting(submitting);
    setPhase({ name: "cancelled" });
  };

  /** Adds or replaces the placement with the chosen file and the descriptor as it stands now. */
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

    const input: MediaRegisterInput = {
      kind,
      file,
      ...(probe === undefined ? {} : { probe }),
      placement: composed,
    };

    try {
      const settled =
        replaceId !== undefined && onReplace !== undefined
          ? await onReplace({ placementId: replaceId, ...input })
          : await onRegister(input);
      finishAttempt(settled);
    } catch {
      /* A transport that throws has not answered with one of the eight outcomes, so nothing here is
       * confirmed and nothing is claimed: the fault panel says exactly that. */
      setFaulted(true);
      setPhase({ name: "described" });
    } finally {
      busyRef.current = false;
    }
  };

  /** Removes the existing placement, after the confirmation panel's own press. */
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

  /**
   * Replays the same work under the caller's own attempt identity.
   *
   * The feature's transport holds the identity for an unchanged intent, so replaying answers with the stored
   * result instead of a second effect. This component never mints one, which is what makes that true.
   */
  const replaySameWork = (): void => {
    if (lastAttemptRef.current === "remove") {
      void removePlacement();
      return;
    }
    void submitPlacement();
  };

  /** The messages for one field path: what the form found first, then what the service refused. */
  const errorsFor = (path: string): readonly string[] | undefined =>
    mergeMessages(localErrors[path], serverErrors?.byField[path]);

  /** One draft field's change handler, so every control writes to the same place. */
  const update = (field: keyof PlacementDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    /* Missing alternative text is the one message this form raises itself, so typing it clears the message
     * as it is satisfied rather than leaving a satisfied demand on screen until the next submit. */
    if (field === "altText" && value.trim() !== "") setLocalErrors({});
  };

  /** Clears the chosen file and every message, and returns to the file control. */
  const backToChoosing = (): void => {
    attemptRef.current += 1;
    setFile(null);
    setProbe(undefined);
    setOutcome(null);
    setServerErrors(null);
    setLocalErrors({});
    setFaulted(false);
    setStoppedWaiting(false);
    setPhase({ name: "choosing" });
  };

  /**
   * The file the person picked with the platform picker.
   *
   * The input's own value is cleared afterwards so the same file can be chosen again after a refusal: a file
   * input that keeps its value fires no change event for the file it already holds, which would make the
   * second attempt impossible without choosing something else first.
   */
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    void chooseFile(chosen);
  };

  /** A dropped file travels through the same handler as a picked one, so neither path is a second code path. */
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    void chooseFile(event.dataTransfer.files[0] ?? null);
  };

  // -------------------------------------------------------------------------------------------
  // Choosing: the limits, then the file, then what this browser measured
  // -------------------------------------------------------------------------------------------

  /** Every limit this kind admits, stated before anything is chosen. */
  function renderLimits(): ReactElement {
    const limits =
      kind === "image"
        ? [
            IMAGE_LIMITS.formats,
            `No more than ${formatBytes(IMAGE_LIMITS.bytes)}.`,
            `No more than ${COUNT_FORMAT.format(IMAGE_LIMITS.edgePx)} pixels on either side.`,
          ]
        : [
            VIDEO_LIMITS.formats,
            `No more than ${formatBytes(VIDEO_LIMITS.bytes)}.`,
            `No longer than ${formatDuration(VIDEO_LIMITS.durationS)}.`,
            `No larger than ${formatPixels(VIDEO_LIMITS.width, VIDEO_LIMITS.height)}.`,
          ];

    return (
      <div className="flex flex-col gap-1">
        <p id={instructionsId} className="text-sm font-medium">
          What this placement admits
        </p>
        <ul
          id={limitsId}
          aria-labelledby={instructionsId}
          className="flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground"
        >
          {limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          This application checks the file&rsquo;s content itself, so a name or an extension never decides
          what a file is.
        </p>
      </div>
    );
  }

  /** What the person chose, beside the limit that applies. The name is shown here and nowhere else. */
  function renderChosenFile(): ReactElement | null {
    if (file === null) return null;

    const withinBytes = file.size <= (kind === "image" ? IMAGE_LIMITS.bytes : VIDEO_LIMITS.bytes);
    const byteLimit = formatBytes(kind === "image" ? IMAGE_LIMITS.bytes : VIDEO_LIMITS.bytes);
    const measured =
      kind === "image"
        ? probe?.width !== undefined && probe.height !== undefined
          ? `Measured at ${formatPixels(probe.width, probe.height)}.`
          : "Its dimensions could not be read in this browser, so they are checked when the file is added."
        : renderVideoMeasurement();

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

  /** The video's own length and size against their limits, or the honest statement that neither was read. */
  function renderVideoMeasurement(): string {
    if (probe === undefined) {
      return "Its length and dimensions could not be read in this browser, so they are checked when the file is added.";
    }
    const parts: string[] = [];
    if (probe.durationSeconds !== undefined) {
      parts.push(
        `Runs ${formatDuration(probe.durationSeconds)} of the ${formatDuration(VIDEO_LIMITS.durationS)} admitted.`,
      );
    }
    if (probe.width !== undefined && probe.height !== undefined) {
      parts.push(
        `Displayed at ${formatPixels(probe.width, probe.height)} of the ${formatPixels(VIDEO_LIMITS.width, VIDEO_LIMITS.height)} admitted.`,
      );
    }
    return parts.length === 0
      ? "Its length and dimensions could not be read in this browser, so they are checked when the file is added."
      : parts.join(" ");
  }

  /**
   * The limits the chosen file appears to be past, stated as a warning rather than a refusal.
   *
   * The service and the media module decide what a file is and whether it is admitted; this list is the form
   * telling the person what will be refused, while the submission stays available so the authority on the
   * bytes is the one that answers.
   */
  function renderLimitWarnings(): ReactElement | null {
    const problems: string[] = [];
    const limits = kind === "image" ? IMAGE_LIMITS : VIDEO_LIMITS;

    if (file !== null && file.size > limits.bytes) {
      problems.push(`It is ${formatBytes(file.size)}, over the ${formatBytes(limits.bytes)} admitted.`);
    }

    if (kind === "image") {
      if (probe?.width !== undefined && probe.width > IMAGE_LIMITS.edgePx) {
        problems.push(
          `It is ${COUNT_FORMAT.format(probe.width)} pixels wide, over the ${COUNT_FORMAT.format(IMAGE_LIMITS.edgePx)} pixels admitted on one side.`,
        );
      }
      if (probe?.height !== undefined && probe.height > IMAGE_LIMITS.edgePx) {
        problems.push(
          `It is ${COUNT_FORMAT.format(probe.height)} pixels tall, over the ${COUNT_FORMAT.format(IMAGE_LIMITS.edgePx)} pixels admitted on one side.`,
        );
      }
    } else {
      if (probe?.durationSeconds !== undefined && probe.durationSeconds > VIDEO_LIMITS.durationS) {
        problems.push(
          `It runs ${Math.round(probe.durationSeconds)} seconds (${formatDuration(probe.durationSeconds)}), longer than the ${VIDEO_LIMITS.durationS} seconds admitted.`,
        );
      }
      if (probe?.width !== undefined && probe.width > VIDEO_LIMITS.width) {
        problems.push(
          `It displays ${COUNT_FORMAT.format(probe.width)} pixels wide, over the ${COUNT_FORMAT.format(VIDEO_LIMITS.width)} admitted.`,
        );
      }
      if (probe?.height !== undefined && probe.height > VIDEO_LIMITS.height) {
        problems.push(
          `It displays ${COUNT_FORMAT.format(probe.height)} pixels tall, over the ${COUNT_FORMAT.format(VIDEO_LIMITS.height)} admitted.`,
        );
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
          <p>
            It can still be added: this application measures the file&rsquo;s own content when it accepts it
            and answers with the reason if the profile refuses it.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  /** Keeps a drag from opening the file in the window instead of handing it to the field. */
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };

  /** The file control, the limits and the disclosure that this preparation happens on this device. */
  function renderFileStep(): ReactElement {
    const description =
      kind === "image"
        ? `Choose a file from this device, or drop one on this field. ${IMAGE_LIMITS.formats}, no more than ${formatBytes(IMAGE_LIMITS.bytes)}.`
        : `Choose a file from this device, or drop one on this field. ${VIDEO_LIMITS.formats}, no more than ${formatBytes(VIDEO_LIMITS.bytes)}.`;

    return (
      <div className="flex flex-col gap-4" onDragOver={handleDragOver} onDrop={handleDrop}>
        <FormField
          label="File"
          name="file"
          description={description}
          error={mergeMessages(errorsFor("file"), errorsFor("probe"))}
          required
        >
          {({ id, describedBy, invalid, required }) => (
            <Input
              id={id}
              type="file"
              accept={ACCEPT_HINT[kind]}
              aria-describedby={describedBy === undefined ? limitsId : `${describedBy} ${limitsId}`}
              aria-invalid={invalid}
              aria-required={required}
              className="h-auto cursor-pointer py-2"
              onChange={handleFileInputChange}
            />
          )}
        </FormField>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <UploadIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Dropping a file on the field above does the same thing. The button inside it is the way in with a
            keyboard, a screen reader or a single pointer.
          </span>
        </p>
        {renderLimits()}
        <SimulationLabel effect="media-preparation" />
      </div>
    );
  }

  // -------------------------------------------------------------------------------------------
  // Preparing, and the outcome's own state line
  // -------------------------------------------------------------------------------------------

  /** The work in progress: one bar with no invented percentage, and the state said in words. */
  function renderPreparing(stage: "measuring" | "submitting"): ReactElement {
    const sentence =
      stage === "measuring"
        ? "Reading this file's own details in this browser so the form can show them beside the limit."
        : "Preparing this file with the local media pipeline: it is decoded, checked, re-encoded so its metadata is removed, and stored. Nothing is published.";

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

  /** The placement as it stands, shown before a replacement so the person sees what changes. */
  function renderCurrentPlacement(): ReactElement | null {
    if (placement === undefined) return null;

    return (
      <Card size="sm" data-slot="media-picker-current">
        <CardHeader>
          <CardTitle>What this placement says now</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p className="wrap-anywhere">
            <span className="text-muted-foreground">Alternative text: </span>
            <bdi>{placement.altText}</bdi>
          </p>
          {placement.caption === undefined ? null : (
            <p className="wrap-anywhere">
              <span className="text-muted-foreground">Caption: </span>
              <bdi>{placement.caption}</bdi>
            </p>
          )}
          {placement.credit === undefined ? null : (
            <p className="wrap-anywhere">
              <span className="text-muted-foreground">Credit: </span>
              <bdi>{placement.credit}</bdi>
            </p>
          )}
          {placement.language === undefined ? null : (
            <p>
              <span className="text-muted-foreground">Language: </span>
              <bdi>{placement.language}</bdi>
            </p>
          )}
          {placement.posterAssetId === undefined ? null : (
            <p className="wrap-anywhere">
              <span className="text-muted-foreground">Poster: </span>
              <bdi className="mono-identifier">{placement.posterAssetId}</bdi>
            </p>
          )}
          <p className="text-muted-foreground">
            Replacing keeps this placement and swaps the file and the description below.
          </p>
        </CardContent>
      </Card>
    );
  }



  // -------------------------------------------------------------------------------------------
  // Describing: the placement form
  // -------------------------------------------------------------------------------------------

  /** The descriptor form: alternative text first, because it is the one required field. */
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
          description={
            kind === "image"
              ? "What this image shows, in your words. It is read aloud in place of the picture."
              : "What this video shows, in your words. It stays as the text alternative when the video cannot play."
          }
          error={errorsFor("placement.altText")}
        >
          {({ id, describedBy, invalid, required }) => (
            <Textarea
              id={id}
              ref={altTextRef}
              rows={3}
              value={draft.altText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required={required}
              onChange={(event) => {
                update("altText", event.target.value);
              }}
            />
          )}
        </FormField>

        <FormField
          label="Caption"
          name="placement.caption"
          optionalHint
          description="Shown beneath the media. Leave it empty when a caption would only repeat the alternative text."
          error={errorsFor("placement.caption")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={draft.caption}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                update("caption", event.target.value);
              }}
            />
          )}
        </FormField>

        <FormField
          label="Credit"
          name="placement.credit"
          optionalHint
          description="Who made or supplied this media, as it should read beside it."
          error={errorsFor("placement.credit")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={draft.credit}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                update("credit", event.target.value);
              }}
            />
          )}
        </FormField>

        <FormField
          label="Language"
          name="placement.language"
          optionalHint
          description="The language this media is in, as a tag such as en or ar, or as a name. It is the media's language, never this interface's."
          error={errorsFor("placement.language")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={draft.language}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                update("language", event.target.value);
              }}
            />
          )}
        </FormField>

        {kind === "video" ? (
          <FormField
            label="Transcript"
            name="placement.transcript"
            optionalHint
            description="The video's words as text, for a reader who cannot play it. It is stored and shown as content, never as trusted metadata."
            error={errorsFor("placement.transcript")}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={4}
                value={draft.transcript}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => {
                  update("transcript", event.target.value);
                }}
              />
            )}
          </FormField>
        ) : null}

        {renderPosterChoices()}
      </div>
    );
  }

  /**
   * The poster choice, offered only when the caller supplied poster renditions.
   *
   * A poster must name an already registered rendition, because every rendition read re-authorises on its own
   * and a placement may never become a way around that. With no rendition offered nothing is rendered rather
   * than an empty list, and the video keeps its alternative text as what a reader is given before playback.
   */
  function renderPosterChoices(): ReactElement | null {
    if (posterChoices.length === 0) return null;

    return (
      <FormFieldGroup
        legend="Poster"
        name="placement.posterAssetId"
        optionalHint
        description="An image already registered in this draft, shown before the video plays."
        error={errorsFor("placement.posterAssetId")}
      >
        {() => (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={draft.posterAssetId === "" ? "default" : "outline"}
              aria-pressed={draft.posterAssetId === ""}
              onClick={() => {
                update("posterAssetId", "");
              }}
            >
              No poster
            </Button>
            {posterChoices.map((choice) => (
              <Button
                key={choice.assetId}
                type="button"
                size="sm"
                variant={draft.posterAssetId === choice.assetId ? "default" : "outline"}
                aria-pressed={draft.posterAssetId === choice.assetId}
                onClick={() => {
                  update("posterAssetId", choice.assetId);
                }}
              >
                <bdi>{choice.label}</bdi>
              </Button>
            ))}
          </div>
        )}
      </FormFieldGroup>
    );
  }

  // -------------------------------------------------------------------------------------------
  // Terminal states, the receipt and the removal confirmation
  // -------------------------------------------------------------------------------------------

  /** Nothing was added, and the draft prose is untouched. The one action is choosing again. */
  function renderCancelled(): ReactElement {
    const description = stoppedWaiting
      ? "You stopped waiting. The request had already been sent, so its result appears here when it arrives. Nothing in your draft was changed."
      : mediaStateReason("cancelled").label;

    return (
      <StateNotice
        kind="empty"
        title="No media added"
        description={description}
        action={{ label: "Choose another file", onClick: backToChoosing }}
      />
    );
  }

  /** A transport that threw: nothing is claimed about the effect, and the same attempt may be retried. */
  function renderFaulted(): ReactElement | null {
    if (!faulted) return null;

    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>The request did not complete</AlertTitle>
        <AlertDescription>
          <p>
            Nothing here is confirmed. No answer arrived, so this application does not know whether the work
            was applied.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={replaySameWork}>
            Try the same request again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  /**
   * The one receipt for whatever the attempt answered.
   *
   * The outcome decides the words and the recovery, and the media module's own state line sits beside it so the
   * placement's state is never described in a vocabulary of this component's inventing. The disclosure that
   * preparation happens on this device is repeated here, at the result, and not only where the work was
   * triggered.
   */
  function renderReceipt(settled: MediaPickerOutcome): ReactElement {
    const state = mediaStateForOutcome(settled);
    const reason = state === null ? null : mediaStateReason(state);

    return (
      <div className="flex flex-col gap-3">
        <SimulationLabel effect="media-preparation" context="block" />
        <OperationResult
          outcome={settled}
          headingLevel={3}
          fieldLabels={FIELD_LABELS}
          {...(mayReplaySameWork(settled) ? { onRetrySameWork: replaySameWork } : {})}
        />
        {reason === null ? null : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">{reason.label}</p>
            {reason.action === undefined ? null : (
              <p className="text-sm text-muted-foreground">{reason.action}</p>
            )}
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

  /** What removing the placement does and does not do, stated before the press. */
  function renderRemovalConfirmation(): ReactElement {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Remove this placement?</AlertTitle>
          <AlertDescription>
            <p>
              This removes the {kind} from the draft you are editing and changes released content, so it asks
              before it acts.
            </p>
            <p>
              It recalls nothing that was already sent or read, the registered file stays available to every
              other placement, and the text around the placement is unchanged.
            </p>
          </AlertDescription>
        </Alert>
        {renderFaulted()}
      </div>
    );
  }

  /** Removal in flight: one busy statement, and no control that could send the removal twice. */
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

  // -------------------------------------------------------------------------------------------
  // Which panel and which controls this stage shows
  // -------------------------------------------------------------------------------------------

  /** Every branch returns something a person can read and act on; there is no empty branch. */
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

  /** The controls this stage offers. A control that could do nothing is never rendered. */
  function renderFooter(): ReactElement {
    const close = (): void => {
      onOpenChange(false);
    };
    const removeOffered = removeId !== undefined && onRemove !== undefined;

    switch (phase.name) {
      case "choosing":
        return (
          <DialogFooter>
            {removeOffered ? (
              <Button
                type="button"
                variant="destructive"
                className="sm:me-auto"
                onClick={() => {
                  setFaulted(false);
                  setPhase({ name: "confirming-removal" });
                }}
              >
                Remove placement
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
          </DialogFooter>
        );
      case "preparing":
        return (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelPreparation}>
              {phase.stage === "measuring" ? "Cancel" : "Stop waiting"}
            </Button>
          </DialogFooter>
        );
      case "described":
        return (
          <DialogFooter>
            {removeOffered ? (
              <Button
                type="button"
                variant="destructive"
                className="sm:me-auto"
                onClick={() => {
                  setFaulted(false);
                  setPhase({ name: "confirming-removal" });
                }}
              >
                Remove placement
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={backToChoosing}>
              Choose another file
            </Button>
            <Button
              type="button"
              onClick={() => {
                void submitPlacement();
              }}
            >
              {replaceId === undefined ? `Add this ${kind}` : `Replace this ${kind}`}
            </Button>
          </DialogFooter>
        );
      case "cancelled":
        return (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Close
            </Button>
          </DialogFooter>
        );
      case "confirming-removal":
        return (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPhase(file === null ? { name: "choosing" } : { name: "described" });
              }}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void removePlacement();
              }}
            >
              Remove placement
            </Button>
          </DialogFooter>
        );
      case "removing":
        return (
          <DialogFooter>
            <Button type="button" variant="outline" disabled>
              Removing&hellip;
            </Button>
          </DialogFooter>
        );
      case "settled":
        return (
          <DialogFooter>
            <Button type="button" onClick={close}>
              Done
            </Button>
          </DialogFooter>
        );
    }
  }

  // -------------------------------------------------------------------------------------------
  // The dialog itself
  // -------------------------------------------------------------------------------------------

  const replacing = replaceId !== undefined;
  const removing = phase.name === "confirming-removal" || phase.name === "removing";

  /** The dialog's name: what this pass at the placement is about, in the caller's vocabulary. */
  const title = removing
    ? `Remove this ${kind}`
    : replacing
      ? `Replace this ${kind}`
      : kind === "image"
        ? "Add an image"
        : "Add a video";

  /** The dialog's description: what this stage does, stated once and never as a claim it cannot keep. */
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
      <DialogContent
        data-slot="media-picker"
        data-kind={kind}
        data-phase={phase.name}
        /* Below the small breakpoint the panel takes the whole viewport: a 320 CSS px screen has no room for a
         * floating panel, and a full-height surface keeps the page itself from scrolling in either direction.
         * The body scrolls inside the panel, which the design system's own dialog already permits. */
        className={cn(
          "max-sm:inset-0 max-sm:max-h-dvh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none",
          className,
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "image" ? (
              <ImageUpIcon aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <FilmIcon aria-hidden="true" className="size-4 shrink-0" />
            )}
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

