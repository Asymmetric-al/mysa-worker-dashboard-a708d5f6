"use client";
/**
 * The one editing surface of a Ministry Update: the text of one edition, the images and video it places, the state of
 * every save, and the single step that freezes the exact revision for review.
 *
 * What this file is, and what it deliberately is not. It arranges the editing surface and the affordances around it; it
 * implements no editor, no toolbar, no picker, no player and no diff. The prose is `@/components/prose-editor`, the only
 * Tiptap surface in the application, with its own bounded toolbar and its deliberate three-choice paste handling. Media
 * is `@/components/media-picker`, the only image and video picker and placement form, which states the admitted limits
 * before work begins and never echoes the file a person chose. The durable status line is `./autosave-status`, the
 * comparison with the last release is `./compare-with-release`, the review step is `@/components/action-review`, and the
 * audience and locale axes are `@/components/variant-switcher` and `@/components/locale-switcher`.
 *
 * Where the text lives. Nothing typed here is copied into the query cache or kept beside the editor: the editor holds it
 * transiently, `useDraftRecovery` owns when it is sent, which revision it is sent against, and what is kept when the
 * service does not acknowledge it, and the records themselves stay in the store behind the service. This surface keeps
 * one thing of its own — the last body the editor reported — because a placement the worker adds has to travel with the
 * next save and the editor is the only holder of the text being written.
 *
 * Why every save states the draft's placements. A draft save replaces the media a draft holds with the list the request
 * states, so an attempt carrying prose alone would erase the worker's images and video. Every attempt this surface
 * reports therefore states the current list, and a placement it has just added or swapped is handed to the save that
 * reports it, because the read that would list it has not answered yet. A placement the session cannot place is never
 * restated, and the row says so plainly rather than letting a save remove it silently.
 *
 * What is never decided here: a lifecycle word, a checksum, a count, a limit or a deadline. An edition's lifecycle comes
 * from `lifecycleOf`, revisions, placements and checksums come from the envelopes, and the media limits come from the
 * picker's own declaration. Publication is not notification and not delivery: this surface states neither.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import ActionReview from "@/components/action-review";
import { lifecycleOf } from "@/components/draft-status";
import { FormErrorSummary, FormFieldGroup, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import LocaleSwitcher, { type LocaleEdition } from "@/components/locale-switcher";
import MediaPicker, { type MediaPickerKind, type MediaPickerOutcome, type MediaPlacement as OnScreenPlacement, type MediaPosterOption, type MediaRegisterInput } from "@/components/media-picker";
import ProseEditor, { type ProseEditorProps } from "@/components/prose-editor";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import VariantSwitcher, { type VariantTab } from "@/components/variant-switcher";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { CONTENT_PROFILE_VERSION } from "@/modules/content/document";
import type { ContentLocale } from "@/modules/content/locale";
import type { Scope } from "@/modules/data-service/envelope";
import { AUDIENCE_LABELS, DRAFT_VS_RELEASED, LOCALE_DISPLAY_NAMES, REVIEW_ROUND_NOTE } from "../copy/updates-copy";
import { useDraftRecovery, type DraftPlacementRef } from "../hooks/use-draft-recovery";
import { useDraft, useRelease, useVariantOverview, type UpdateDraftData, type UpdateDraftReadResult, type UpdateReleaseReadResult, type VariantOverviewData, type VariantOverviewReadResult } from "../hooks/use-update-queries";
import { useRegisterMediaAsset, useRemovePlacement, useSubmitForReview } from "../hooks/use-update-mutations";
import type { MediaPlacement as PlacementDescriptor } from "../schemas/media";
import type { SubmissionNotifyMode, SubmitForReviewPayload } from "../schemas/draft";
import { AutosaveStatus } from "./autosave-status";
import { CompareWithRelease } from "./compare-with-release";

// ---------------------------------------------------------------------------------------------
// The shapes this surface reads, taken from the reads that answer them
// ---------------------------------------------------------------------------------------------

/** One edition's draft as its envelope states it. */
type DraftData = UpdateDraftData;
/** The draft data of an edition that holds a saved revision: the only shape that carries a body, placements and a rendered revision. */
type SavedDraft = Extract<DraftData, { readonly status: "draft" }>;
/** One media placement as the draft read reports it. */
type PlacementView = SavedDraft["placements"][number];
/** The document this editor stores and renders. */
type EditorDocument = ProseEditorProps["initialDocument"];
/** The direction an edition is authored in, stated by the record rather than inferred from a language name. */
type EditorDirection = ContentLocale["direction"];
/** The heading level the surrounding page reaches, so every heading here nests beneath it. */
type EditorHeadingLevel = 2 | 3 | 4;

/** One media attempt this surface is about to open the picker for: the kind to add, and the placement it acts on when it acts on one. */
type PickerTarget = { readonly kind: MediaPickerKind; readonly placementId?: string };

/** The placement fields the picker's form edits, taken from the schema the media writes validate with rather than restated. */
function descriptorOf(placement: PlacementView): PlacementDescriptor {
  return { altText: placement.altText, ...(placement.caption === null ? {} : { caption: placement.caption }), ...(placement.credit === null ? {} : { credit: placement.credit }) };
}

/** The one placement row the picker acts on, when the worker asked to manage a placement rather than add one. */
function onScreenPlacementOf(placement: PlacementView): OnScreenPlacement {
  return { placementId: placement.placementId, ...descriptorOf(placement) };
}

// ---------------------------------------------------------------------------------------------
// Fixed wording
// ---------------------------------------------------------------------------------------------

/** The surface's own name: it states the job and names no record. */
const SURFACE_TITLE = "Write this Update edition";

const READING = { title: "This edition is being read", description: "The draft, the edition's own lifecycle and the placement it holds are read together, so nothing is shown until the read answers. An unread draft is never presented as an empty one." } as const;

const DENIED = { title: "This edition is not available in this session", description: "This session may not write this edition, so no text, revision, placement or release is stated here. A refusal is not an edition with nothing written." } as const;

const UNAVAILABLE = { title: "This edition could not be read", description: "The records behind this edition could not be read, so no editor, revision or placement is shown in their place. Nothing is written until the read succeeds." } as const;

const REFUSED = { title: "This editor's address was refused", description: "The request this editor would make is not one the read admits, so nothing was read and nothing is written. Open the Update from its list and choose the edition again." } as const;

const EDITION_SWITCHING_NOTE = "Each edition keeps its own draft. Moving to another edition leaves this one's text in this browser until a save is acknowledged, and offers it back when you return.";

const DRAFT_FACTS = { revision: "Draft revision", checksum: "Content checksum", savedAt: "Read at" } as const;

const REVIEW_TITLE = "Submit this edition for review";

const REVIEW_CONFIRM = "Submit for review";

const REVIEW_DESCRIPTION = "Submitting freezes the exact revision named here as the candidate one review step answers. Editing the draft afterwards changes nothing about what was submitted.";

const REVIEW_CONSEQUENCE = REVIEW_ROUND_NOTE.approvalIsPerVariant + " " + REVIEW_ROUND_NOTE.furtherRoundIsNewSubmission;

/** The release mode the submission records, in the words the review step states it with: the release does the work, and a mode sends no notice by itself. */
const REVIEW_MODE_SENTENCES: Readonly<Record<SubmissionNotifyMode, string>> = {
  "publish-only": "It asks for Publish only, so its release publishes the exact frozen candidate and submits no notice.",
  "publish-and-notify": "It asks for Publish and notify now, so its release also asks for one simulated notice for each eligible recipient.",
};

const REVIEW_UNAVAILABLE_TITLE = "This draft cannot be submitted yet";

/** Said when the read states no reason of its own: the action is withheld, and this surface does not invent why. */
const REVIEW_UNAVAILABLE_FALLBACK = "The read this editor is composed from does not offer submission for this edition yet. Saving a revision is what a submission freezes.";

/** The action the draft envelope publishes for the submission step. */
const SUBMIT_ACTION = "submit-for-review";

// ---------------------------------------------------------------------------------------------
// The media pane's own wording
// ---------------------------------------------------------------------------------------------

const MEDIA_PANE_TITLE = "Media in this draft";

const MEDIA_GROUP_LEGEND = "Add media to this draft";

const MEDIA_GROUP_DESCRIPTION = "An image or a video is prepared on this device before it is placed, and the limits it must meet are stated in the picker. The editor's own media buttons bring you here.";

const MEDIA_LISTS = { image: "Images", video: "Videos" } as const;

const MEDIA_EMPTY = {
  image: { title: "No image in this draft yet", description: "An image is placed from this panel and travels with the draft: a page or a notice shows only what the released revision places." },
  video: { title: "No video in this draft yet", description: "A video is placed from this panel with its poster and caption track, and it is prepared on this device before the draft holds it." },
} as const;

const PLACEMENT_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({ mediaPlacements: "Media placements", altText: "Alternative text", caption: "Caption", credit: "Credit", transcript: "Transcript" });

const PLACEMENT_LABELS = { kind: "Kind", purpose: "Placed for", altText: "Alternative text", caption: "Caption", credit: "Credit", poster: "Poster", captions: "Caption track", transcript: "Transcript", state: "State" } as const;

/** The two words a placement's own state can be: the read states `ready` when it can serve the placement's main rendition, and the reason it supplies carries the rest. */
const PLACEMENT_STATE_WORDS = { ready: "Ready" } as const;

const NO_CAPTION = "No caption";

const PRESENT = "Present";

const ABSENT = "None";

const PICKER_LABELS = { manage: "Manage this placement", addImage: "Add an image", addVideo: "Add a video" } as const;

const PANE_LABELS = { group: "Which part of this editor to show", write: "Write", media: "Media" } as const;

/** The body card's own name, and the accessible name of the editing region inside it. */
const BODY_PANE_TITLE = "The text of this edition";

const EDITOR_LABEL = "The text of this Update edition";

const EDITOR_DESCRIPTION = "Write the edition's own text. A save is sent after a short pause, carries the revision the service last acknowledged, and states the media this draft holds.";

/** The heading tag each level renders as, and the level a nested heading inside it may occupy. */
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

const NESTED_HEADING_LEVEL: Readonly<Record<EditorHeadingLevel, EditorHeadingLevel>> = { 2: 3, 3: 4, 4: 4 };

const LOCAL_RECOVERY = {
  title: "This browser kept text the service never acknowledged",
  action: "Use the text this browser kept",
  whatItIs: "Only this browser holds it: it was typed after a save the service did not confirm, and it is not part of the draft record.",
  whatAdopting: "Using it puts that text in the editor and saves it like any other change, against the revision the service reports now.",
} as const;

const COMPARE_UNAVAILABLE = {
  withdrawn: { title: "The last release of this edition was withdrawn", description: "A withdrawn release is not content a reader can open, so it is not compared with this draft. Restoring an earlier revision as a new draft is offered from the Update's edition list." },
  unreadable: { title: "The last release could not be read", description: "The revision standing at this edition's head could not be read, so no comparison is shown and nothing is claimed about what is published." },
} as const;

// ---------------------------------------------------------------------------------------------
// The draft's placements, as a save must state them
// ---------------------------------------------------------------------------------------------

/**
 * The rendition one placement of the draft is placed for: the main rendition the read reports, which is the only
 * purpose a save may restate without a decision. A placement whose main rendition cannot be served states none, and a
 * save can no more restate it than the read could show it.
 */
function placementRefOf(placement: PlacementView): DraftPlacementRef | null {
  const main = placement.renditions.find((rendition) => rendition.purpose === "display" || rendition.purpose === "playback");
  return main === undefined ? null : { assetId: placement.assetId, purpose: main.purpose };
}

/** Every placement the draft can restate, in the order it holds them. */
function restatableRefs(placements: readonly PlacementView[]): readonly DraftPlacementRef[] {
  const refs: DraftPlacementRef[] = [];
  for (const placement of placements) {
    const ref = placementRefOf(placement);
    if (ref !== null) refs.push(ref);
  }
  return refs;
}

/**
 * The placements the next save states: the ones the draft already holds, with `added` inserted at the end or swapped in
 * at the position the worker replaced, so a replacement moves the file without duplicating the placement.
 */
function statedRefsWith(placements: readonly PlacementView[], added: DraftPlacementRef, swappedPlacementId: string | null): readonly DraftPlacementRef[] {
  const refs: DraftPlacementRef[] = [];
  for (const placement of placements) {
    if (swappedPlacementId !== null && placement.placementId === swappedPlacementId) {
      refs.push(added);
      continue;
    }
    const ref = placementRefOf(placement);
    if (ref === null) continue;
    refs.push(ref);
  }
  if (swappedPlacementId === null && !refs.some((ref) => ref.assetId === added.assetId)) refs.push(added);
  return refs;
}

/** Whether two placement lists state the same assets for the same purposes, in the same order. */
function samePlacements(left: readonly DraftPlacementRef[], right: readonly DraftPlacementRef[]): boolean {
  return left.length === right.length && left.every((ref, index) => ref.assetId === right[index]?.assetId && ref.purpose === right[index]?.purpose);
}

/** Whether an answer means the record now holds what was asked for, so the placements this surface stated are the ones to keep. */
function holdsStatedPlacements(outcome: MediaPickerOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged" || outcome.outcome === "unknown";
}

/** The empty document an edition with no draft yet begins from: a paragraph, the profile version and the edition's own direction. */
function startingDocument(direction: EditorDirection): EditorDocument {
  return { type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction, content: [{ type: "paragraph" }], sections: [] };
}

// ---------------------------------------------------------------------------------------------
// The edition axes
// ---------------------------------------------------------------------------------------------

/** The language's own name where the copy module names it, and the platform's name otherwise. */
function languageNameOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") return "";
  const named = LOCALE_DISPLAY_NAMES[trimmed]?.trim() ?? "";
  if (named !== "") return named;
  const language = (trimmed.split("-")[0] ?? trimmed).toLowerCase();
  try {
    const names = new Intl.DisplayNames([language], { type: "language" });
    const name = names.of(language);
    return name === undefined || name.trim() === "" ? trimmed : name;
  } catch {
    return trimmed;
  }
}

/** The edition as its envelope states it, with the lifecycle the one derivation reads from those facts. */
function tabsOf(overview: VariantOverviewData): readonly VariantTab[] {
  return overview.editions.map((edition) => ({
    variantId: edition.variantId,
    audience: edition.audience,
    locale: edition.locale,
    lifecycle: lifecycleOf(
      {
        variantId: edition.variantId,
        documentId: overview.document.documentId,
        audience: edition.audience,
        locale: edition.locale,
        ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
        ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
        ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
      },
      edition.headRelease ?? undefined,
    ),
    ...(edition.translation.status === "stale" ? { staleSince: edition.translation.sourceUpdatedAt } : {}),
  }));
}

/** The editions of one audience, one per language: what the locale switcher offers an author of that audience. */
function localesOfAudience(overview: VariantOverviewData, audience: VariantOverviewData["editions"][number]["audience"]): readonly LocaleEdition[] {
  const locales: LocaleEdition[] = [];
  const seen = new Set<string>();
  for (const edition of overview.editions) {
    if (edition.audience !== audience) continue;
    if (seen.has(edition.locale.tag)) continue;
    seen.add(edition.locale.tag);
    locales.push({ tag: edition.locale.tag, direction: edition.locale.direction, endonym: languageNameOf(edition.locale.tag) });
  }
  return locales;
}

/** The edition of one audience in one language, when it exists: the one a locale choice moves to. */
function editionInLocale(overview: VariantOverviewData, audience: VariantOverviewData["editions"][number]["audience"], tag: string): VariantOverviewData["editions"][number] | undefined {
  return overview.editions.find((edition) => edition.audience === audience && edition.locale.tag === tag) ?? overview.editions.find((edition) => edition.locale.tag === tag);
}

// ---------------------------------------------------------------------------------------------
// The heading this file renders, and the one way a level nests beneath it
// ---------------------------------------------------------------------------------------------

function Heading({ level, id, className, children }: { readonly level: EditorHeadingLevel; readonly id: string; readonly className: string; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------------------------
// One placement, as the media pane states it
// ---------------------------------------------------------------------------------------------

/** Said only for a placement this session cannot place: the next save states the placements it can, and this one is not among them. */
const REMOVAL_ON_SAVE = "This session cannot place this file, so saving this draft removes the placement. Everything the record holds about the rest of the draft is unchanged.";

const KIND_WORDS = { image: "Image", video: "Video" } as const;

type PlacementRowProps = { readonly placement: PlacementView; readonly onManage: () => void };

/**
 * One placement of the draft: what it is, how it is placed, what it says, what a video carries beside it, and the state
 * the read reported. Colour never carries that state: the word is always present, and the read's own reason and next
 * step are stated where it gave them.
 */
function PlacementRow({ placement, onManage }: PlacementRowProps): ReactElement {
  const purposes = placement.renditions.map((rendition) => rendition.purpose);
  const placeable = placementRefOf(placement) !== null;
  const stateWord = placement.state === "ready" ? PLACEMENT_STATE_WORDS.ready : (placement.reason?.label ?? "");
  const facts: readonly { readonly label: string; readonly value: ReactNode }[] = [
    { label: PLACEMENT_LABELS.kind, value: KIND_WORDS[placement.kind] },
    { label: PLACEMENT_LABELS.purpose, value: purposes.length === 0 ? ABSENT : <bdi>{purposes.join(", ")}</bdi> },
    { label: PLACEMENT_LABELS.altText, value: <bdi>{placement.altText}</bdi> },
    { label: PLACEMENT_LABELS.caption, value: placement.caption === null ? NO_CAPTION : <bdi>{placement.caption}</bdi> },
  ];
  const withCredit = placement.credit === null ? facts : [...facts, { label: PLACEMENT_LABELS.credit, value: <bdi>{placement.credit}</bdi> }];
  const rows =
    placement.kind === "video"
      ? [...withCredit, { label: PLACEMENT_LABELS.poster, value: purposes.includes("poster") ? PRESENT : ABSENT }, { label: PLACEMENT_LABELS.captions, value: placement.captionTracks.length > 0 ? PRESENT : ABSENT }, { label: PLACEMENT_LABELS.transcript, value: purposes.includes("transcript") ? PRESENT : ABSENT }]
      : withCredit;
  return (
    <li data-slot="placement-row" data-kind={placement.kind} data-state={placement.state} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{KIND_WORDS[placement.kind]}</span>
        <span className="min-w-0 text-sm text-muted-foreground wrap-anywhere">
          <span className="sr-only">{`${PLACEMENT_LABELS.state}: `}</span>
          <bdi>{stateWord}</bdi>
        </span>
      </div>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-sm">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-start wrap-anywhere">{row.value}</dd>
          </Fragment>
        ))}
      </dl>
      {placement.state === "ready" ? null : (
        <div className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground">
          {placement.reason?.action === undefined ? null : <p className="text-pretty wrap-anywhere">{placement.reason.action}</p>}
          {placeable ? null : <p className="text-pretty wrap-anywhere">{REMOVAL_ON_SAVE}</p>}
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onManage}>
          {PICKER_LABELS.manage}
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// The editing surface of one edition
// ---------------------------------------------------------------------------------------------

/** The outcome a save reports, taken from the editor's own contract so a change there reaches this file as a compile error. */
type SaveOutcome = Awaited<ReturnType<ProseEditorProps["onSave"]>>;

type DraftEditorProps = {
  readonly scope: Scope;
  readonly variantId: string;
  /** The revision the draft read returned, which the first save states as the one it saw. */
  readonly recordRevision: string;
  /** The instant the read was evaluated: shown beside an acknowledged revision exactly as the service supplied it. */
  readonly asOf: string;
  readonly data: DraftData;
  readonly direction: EditorDirection;
  readonly localeTag: string;
  readonly headingLevel: EditorHeadingLevel;
};

/**
 * One edition's text, its media and the state of every save.
 *
 * It exists as its own component because the recovery hook is mounted with the revision the draft read returned: a hook
 * cannot wait for that answer, and mounting it with a placeholder revision would chain every later save against a
 * reference the record never held.
 */
function DraftEditor({ scope, variantId, recordRevision, asOf, data, direction, localeTag, headingLevel }: DraftEditorProps): ReactElement {
  const titleId = useId();
  const nestedLevel = NESTED_HEADING_LEVEL[headingLevel];
  const placements = useMemo<readonly PlacementView[]>(() => (data.status === "draft" ? data.placements : []), [data]);
  const readRefs = useMemo<readonly DraftPlacementRef[]>(() => restatableRefs(placements), [placements]);
  const initialBody = useMemo<EditorDocument>(() => (data.status === "draft" ? data.revision.body : startingDocument(direction)), [data, direction]);
  // The placements this surface has stated that the read has not reported yet: the list a save must carry until it does.
  const [pendingRefs, setPendingRefs] = useState<readonly DraftPlacementRef[] | null>(null);
  // Once the read states the same placement list this surface stated, the two are one list and the read's own governs.
  const statedRefs = pendingRefs !== null && samePlacements(pendingRefs, readRefs) ? readRefs : (pendingRefs ?? readRefs);
  const recovery = useDraftRecovery({ scope, variantId, initialRevision: recordRevision, initialBody, placements: statedRefs });
  const register = useRegisterMediaAsset();
  const removePlacement = useRemovePlacement();
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [mediaRefusal, setMediaRefusal] = useState<FieldErrorLookup | null>(null);
  const [pane, setPane] = useState<"write" | "media">("write");
  const [mediaRequests, setMediaRequests] = useState(0);
  const [adoptedBody, setAdoptedBody] = useState<EditorDocument | null>(null);
  const [editorInstance, setEditorInstance] = useState(0);
  // The last body the editor reported. A placement has to travel with the save that reports it, and the editor is the
  // only holder of the text being written, so this surface keeps the one body it was last handed and nothing else.
  const lastBodyRef = useRef<EditorDocument>(initialBody);
  const mediaPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // The editor's media toolbar brings the media pane into view and hands it the keyboard, so focus is never left on a
    // control the pane switch has just hidden. The request is counted rather than consumed, so the effect reacts to a
    // request without changing the state that produced it.
    if (mediaRequests === 0) return;
    mediaPaneRef.current?.focus();
  }, [mediaRequests]);

  const saveText = async (document: EditorDocument): Promise<SaveOutcome> => {
    lastBodyRef.current = document;
    return recovery.notifyChange(document, statedRefs);
  };

  /**
   * Places one prepared file in the draft. Registering an asset and placing it are two effects: the registration answers
   * with the asset's own identity, and only a draft save states where the draft holds it — which is why the answer this
   * returns is the save's, the one that means the placement exists.
   */
  const placeMedia = async (input: MediaRegisterInput, swappedPlacementId: string | null): Promise<MediaPickerOutcome> => {
    setMediaRefusal(null);
    const registered = await register.submit({ scope, expectedRevision: recordRevision, payload: input });
    const assetId = registered.outcome === "accepted" || registered.outcome === "alreadyAccepted" ? (registered.created?.[0] ?? "") : "";
    if (assetId === "") return registered;
    // A freshly registered asset is placed for the rendition the record itself defaults to: an image's display rendition,
    // or a video's playback rendition. The read reports the same purpose as the placement's main rendition afterwards.
    const added: DraftPlacementRef = { assetId, purpose: input.kind === "image" ? "display" : "playback" };
    const nextRefs = statedRefsWith(placements, added, swappedPlacementId);
    // The newest text this session holds travels with the save: the text a failed attempt kept comes first, because it is
    // the only copy of work the service has not acknowledged.
    const settled = await recovery.notifyChange(recovery.keptBody ?? lastBodyRef.current, nextRefs);
    if (settled.outcome === "invalid") setMediaRefusal(fieldErrorsFromInvalid(settled));
    if (holdsStatedPlacements(settled)) setPendingRefs(nextRefs);
    return settled;
  };

  /** Removes one placement from the draft, and tells the save chain the revision that removal confirmed. */
  const removeMedia = async (placementId: string): Promise<MediaPickerOutcome> => {
    setMediaRefusal(null);
    const settled = await removePlacement.submit({ scope, expectedRevision: recovery.acknowledgedRevision ?? recordRevision, payload: { variantId, placementId } });
    if (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted") recovery.adoptConfirmedRevision(settled.revision);
    if (settled.outcome === "invalid") setMediaRefusal(fieldErrorsFromInvalid(settled));
    // The record no longer holds the placement, whatever the read has answered yet, so the next save must not state it.
    if (holdsStatedPlacements(settled)) setPendingRefs(restatableRefs(placements.filter((placement) => placement.placementId !== placementId)));
    return settled;
  };

  /** Puts the text this browser kept into the editor and saves it like any other change. */
  const adoptLocalText = (body: EditorDocument): void => {
    setAdoptedBody(body);
    setEditorInstance((count) => count + 1);
    lastBodyRef.current = body;
    recovery.discardLocalRecovery();
    void recovery.notifyChange(body, statedRefs);
  };

  const images = placements.filter((placement) => placement.kind === "image");
  const videos = placements.filter((placement) => placement.kind === "video");
  const posterChoices: readonly MediaPosterOption[] = images.map((placement) => ({ assetId: placement.assetId, label: placement.altText }));
  const keptText = recovery.localRecovery.present ? recovery.localRecovery.body : null;
  const managed = picker === null || picker.placementId === undefined ? undefined : placements.find((placement) => placement.placementId === picker.placementId);
  const revision = data.status === "draft" ? data.revision : null;

  const editorPane = (
    <div className={cn("flex min-w-0 flex-col gap-4", pane === "write" ? "flex" : "hidden", "md:flex")}>
      <p className="min-w-0 text-sm text-muted-foreground text-pretty wrap-anywhere">{EDITOR_DESCRIPTION}</p>
      {keptText === null ? null : (
        <Alert>
          <AlertTitle>{LOCAL_RECOVERY.title}</AlertTitle>
          <AlertDescription>
            <p>{LOCAL_RECOVERY.whatItIs}</p>
            <p>{LOCAL_RECOVERY.whatAdopting}</p>
          </AlertDescription>
          <AlertAction>
            <Button type="button" size="sm" variant="outline" onClick={() => adoptLocalText(keptText)}>
              {LOCAL_RECOVERY.action}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {/* Direction is a property of the content, applied to the editing block and never to the interface around it. */}
      <div dir={direction} lang={localeTag} className="min-w-0">
        {/* The editor's numeric counter shapes only its own local "not saved" wording: the revision every save states is
            the opaque one the recovery hook carries, and an opaque reference has no number to take from it. */}
        <ProseEditor
          key={`draft-${String(editorInstance)}`}
          initialDocument={adoptedBody ?? initialBody}
          expectedRevision={0}
          direction={direction}
          label={EDITOR_LABEL}
          onSave={saveText}
          onRequestMedia={() => {
            setPane("media");
            setMediaRequests((count) => count + 1);
          }}
        />
      </div>
      <AutosaveStatus recovery={recovery} acknowledgedAsOf={asOf} />
    </div>
  );

  const mediaList = (kind: MediaPickerKind): ReactElement => {
    const list = kind === "image" ? images : videos;
    if (list.length === 0) {
      return <StateNotice kind="empty" title={MEDIA_EMPTY[kind].title} description={MEDIA_EMPTY[kind].description} headingLevel={nestedLevel} />;
    }
    return (
      <ScrollRegion label={`${MEDIA_LISTS[kind]} in this draft, scrollable`} maxHeight="20rem" className="rounded-lg">
        <ul className="flex min-w-0 list-none flex-col gap-2 p-0">
          {list.map((placement) => (
            <PlacementRow key={placement.placementId} placement={placement} onManage={() => setPicker({ kind: placement.kind, placementId: placement.placementId })} />
          ))}
        </ul>
      </ScrollRegion>
    );
  };

  const mediaPane = (
    <section ref={mediaPaneRef} tabIndex={-1} aria-label={MEDIA_PANE_TITLE} data-slot="editor-media-pane" className={cn("min-w-0 flex-col gap-4 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]", pane === "media" ? "flex" : "hidden", "md:flex")}>
      <p className="min-w-0 text-sm text-muted-foreground text-pretty wrap-anywhere">{MEDIA_GROUP_DESCRIPTION}</p>
      <FormFieldGroup legend={MEDIA_GROUP_LEGEND} name="add-media" description="The picker states the formats, sizes and lengths it admits before any work begins, requires alternative text, and never keeps the file's own name.">
        {() => (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setPicker({ kind: "image" })}>
              {PICKER_LABELS.addImage}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPicker({ kind: "video" })}>
              {PICKER_LABELS.addVideo}
            </Button>
          </div>
        )}
      </FormFieldGroup>
      <FormErrorSummary errors={mediaRefusal} labels={PLACEMENT_FIELD_LABELS} title="This media was not placed" description="The service refused at least one field, so the draft was not changed by this attempt. The text and the placements already in it are untouched." headingLevel={nestedLevel} />
      <Tabs defaultValue="image" className="min-w-0 gap-3">
        <TabsList aria-label={MEDIA_PANE_TITLE}>
          <TabsTrigger value="image">{MEDIA_LISTS.image}</TabsTrigger>
          <TabsTrigger value="video">{MEDIA_LISTS.video}</TabsTrigger>
        </TabsList>
        {/* Each panel is named as well as labelled by its tab, so a reader is never placed in an unnamed region. */}
        <TabsContent value="image" aria-label={MEDIA_LISTS.image} className="min-w-0">
          {mediaList("image")}
        </TabsContent>
        <TabsContent value="video" aria-label={MEDIA_LISTS.video} className="min-w-0">
          {mediaList("video")}
        </TabsContent>
      </Tabs>
    </section>
  );

  return (
    <Card data-slot="editor-shell-body" data-edition={variantId} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Heading level={headingLevel} id={titleId} className="text-base font-medium text-pretty">
            {BODY_PANE_TITLE}
          </Heading>
        </CardTitle>
        {revision === null ? (
          <p className="min-w-0 text-sm text-muted-foreground text-pretty wrap-anywhere">Nothing has been saved for this edition yet. The first save records the text as its draft; nothing is published by it.</p>
        ) : (
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{DRAFT_FACTS.revision}</dt>
            <dd className="min-w-0 wrap-anywhere">
              <bdi className="mono-identifier">{revision.revisionId}</bdi>
            </dd>
            <dt className="text-muted-foreground">{DRAFT_FACTS.checksum}</dt>
            <dd className="min-w-0 wrap-anywhere">
              <bdi className="mono-identifier">{revision.contentChecksum}</bdi>
            </dd>
            <dt className="text-muted-foreground">{DRAFT_FACTS.savedAt}</dt>
            <dd className="min-w-0 wrap-anywhere">
              <bdi className="mono-identifier">{asOf}</bdi>
            </dd>
          </dl>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <FormFieldGroup legend={PANE_LABELS.group} name="editor-pane" hideLegend className="md:hidden">
          {() => (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant={pane === "write" ? "default" : "outline"} aria-pressed={pane === "write"} onClick={() => setPane("write")}>
                {PANE_LABELS.write}
              </Button>
              <Button type="button" size="sm" variant={pane === "media" ? "default" : "outline"} aria-pressed={pane === "media"} onClick={() => setPane("media")}>
                {PANE_LABELS.media}
              </Button>
            </div>
          )}
        </FormFieldGroup>
        {editorPane}
        {mediaPane}
      </CardContent>
      <MediaPicker
        kind={picker?.kind ?? "image"}
        open={picker !== null}
        onOpenChange={(next) => {
          if (!next) setPicker(null);
        }}
        {...(managed === undefined
          ? {}
          : {
              placement: onScreenPlacementOf(managed),
              onRemove: (input: { readonly placementId: string }) => removeMedia(input.placementId),
              onReplace: (input: { readonly placementId: string } & MediaRegisterInput) => placeMedia({ kind: input.kind, file: input.file, ...(input.probe === undefined ? {} : { probe: input.probe }), placement: input.placement }, managed.placementId),
            })}
        onRegister={(input: MediaRegisterInput) => placeMedia(input, null)}
        posterAssets={posterChoices}
        onSettled={(outcome: MediaPickerOutcome) => {
          if (outcome.outcome === "invalid") setMediaRefusal(fieldErrorsFromInvalid(outcome));
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

export interface EditorShellProps {
  /** The context the reads run in. The service re-resolves it for every read and every write, so this is a claim the caller makes and not an authority it grants. */
  readonly scope: Scope;
  /** The Update whose editions this editor moves between, and whose draft it writes. */
  readonly updateId: string;
  /** The edition being written: one audience in one exact content locale. Two editions of one Update are two drafts. */
  readonly variantId: string;
  /** The draft the server render already read, so the browser issues no duplicate request for what it was handed. */
  readonly initialDraft?: UpdateDraftReadResult;
  /** The release standing at this edition's head, as the server render read it. */
  readonly initialRelease?: UpdateReleaseReadResult;
  /** This Update's editions, as the server render read them. */
  readonly initialOverview?: VariantOverviewReadResult;
  /** When those answers were produced, so the cache treats the seed as the age it is. */
  readonly initialDataUpdatedAt?: number;
  /** The heading level this surface nests beneath. */
  readonly headingLevel?: EditorHeadingLevel;
  /**
   * The release mode a new submission asks for, as the browser's publishing preference states it. Left out, the submission
   * states no mode and the service's own default — publish only — applies, so a caller that knows no preference submits
   * exactly what this surface submitted before the preference existed.
   */
  readonly publishing?: SubmissionNotifyMode;
  readonly className?: string;
}

/**
 * One Update edition's editor: the text, the media it places, and the single step that freezes the exact revision for
 * review, arranged over the reads that describe the edition.
 *
 * Three reads compose it. The draft is the gate: while it is unread this surface shows a loading state rather than an
 * empty editor, a denial rather than a title, and an outage rather than seeded content. The editions read feeds the two
 * switch controls, and the release read feeds the comparison with the last release; neither is allowed to stop the
 * worker writing, so a failure there is stated in its own place and the editor stays usable.
 */
export function EditorShell({ scope, updateId, variantId, initialDraft, initialRelease, initialOverview, initialDataUpdatedAt, headingLevel = 2, publishing, className }: EditorShellProps): ReactElement {
  const titleId = useId();
  const router = useRouter();
  const submitForReview = useSubmitForReview();
  // The direction the locale control reports, kept with the edition it describes: a report about the edition this
  // component was showing must never describe the edition it now shows.
  const [reportedDirection, setReportedDirection] = useState<{ readonly edition: string; readonly direction: EditorDirection } | null>(null);
  const stamped = initialDataUpdatedAt === undefined ? {} : { initialDataUpdatedAt };
  const draft = useDraft({ scope, variantId }, initialDraft === undefined ? {} : { initialData: initialDraft, ...stamped });
  const overview = useVariantOverview({ scope, documentId: updateId }, initialOverview === undefined ? {} : { initialData: initialOverview, ...stamped });
  const release = useRelease({ scope, variantId }, initialRelease === undefined ? {} : { initialData: initialRelease, ...stamped });

  const draftResult = draft.result;
  if (draftResult === undefined || draft.isStale(draftResult)) {
    return <StateNotice kind="loading" title={READING.title} description={READING.description} headingLevel={headingLevel} className={className} />;
  }
  switch (draftResult.kind) {
    case "denied":
      return <StateNotice kind="denied" title={DENIED.title} description={DENIED.description} reasonCode={draftResult.denied.reasonCode} operationId={draftResult.denied.operationId} headingLevel={headingLevel} className={className} />;
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          title={UNAVAILABLE.title}
          description={draftResult.unavailable.guidance.trim() === "" ? UNAVAILABLE.description : draftResult.unavailable.guidance}
          source={draftResult.unavailable.source}
          retry={{ label: "Read this edition again", onClick: () => draft.refetch() }}
          headingLevel={headingLevel}
          className={className}
        />
      );
    case "refused":
      return <StateNotice kind="refused" title={REFUSED.title} description={REFUSED.description} headingLevel={headingLevel} className={className} />;
    case "envelope":
      break;
  }

  const envelope = draftResult.envelope;
  const data = envelope.data;
  const direction: EditorDirection = reportedDirection !== null && reportedDirection.edition === variantId ? reportedDirection.direction : data.locale.direction;
  const languageName = languageNameOf(data.locale.tag);
  const audience = AUDIENCE_LABELS[data.audience];
  const overviewData = overview.result !== undefined && overview.result.kind === "envelope" ? overview.result.envelope.data : undefined;
  const tabs = overviewData === undefined ? undefined : tabsOf(overviewData);
  const locales = overviewData === undefined ? undefined : localesOfAudience(overviewData, data.audience);
  const draftRevisionId = data.status === "draft" ? data.revision.revisionId : undefined;
  const draftChecksum = data.status === "draft" ? data.revision.contentChecksum : "";

  const openEdition = (nextVariantId: string): void => {
    if (nextVariantId === variantId) return;
    router.push(`/communication/${encodeURIComponent(updateId)}/${encodeURIComponent(nextVariantId)}`);
  };

  const submitAction = envelope.actions.find((action) => action.name === SUBMIT_ACTION);
  const submissionOffered = draftRevisionId !== undefined && (submitAction === undefined || submitAction.available);
  const submitPayload: SubmitForReviewPayload | null = draftRevisionId === undefined ? null : { variantId, revisionId: draftRevisionId, ...(publishing === undefined ? {} : { notifyMode: publishing }) };

  let comparison: ReactElement;
  const releaseResult = release.result;
  if (releaseResult === undefined || release.isStale(releaseResult)) {
    comparison = <StateNotice kind="loading" title="Reading the last release" description="The release standing at this edition's head is being read, so no comparison is shown yet. The editor stays usable while it is." headingLevel={headingLevel} />;
  } else if (releaseResult.kind === "denied") {
    comparison = (
      <StateNotice
        kind="denied"
        title="The last release cannot be compared in this session"
        description="This session may not read the release standing at this edition's head, so the comparison states nothing about it — not its revision, its checksum or its content."
        reasonCode={releaseResult.denied.reasonCode}
        operationId={releaseResult.denied.operationId}
        headingLevel={headingLevel}
      />
    );
  } else if (releaseResult.kind === "unavailable") {
    comparison = <StateNotice kind="unavailable" title={COMPARE_UNAVAILABLE.unreadable.title} description={COMPARE_UNAVAILABLE.unreadable.description} source={releaseResult.unavailable.source} retry={{ label: "Read the last release again", onClick: () => release.refetch() }} headingLevel={headingLevel} />;
  } else if (releaseResult.kind === "refused") {
    comparison = <StateNotice kind="refused" title="This comparison's request was refused" description="The request behind this comparison is not one the read admits, so nothing is compared and nothing is claimed about what is published." headingLevel={headingLevel} />;
  } else {
    const releaseData = releaseResult.envelope.data;
    const draftSide: ComponentProps<typeof CompareWithRelease>["draft"] = data.status === "draft" ? { status: "revision", revision: data.revision, renderedHtml: data.renderedHtml, asOf: envelope.asOf, author: data.revision.authorPrincipalId } : { status: "none" };
    if (releaseData.status === "released") {
      comparison = (
        <CompareWithRelease variant={data.variant} draft={draftSide} release={{ status: "revision", revision: releaseData.revision, renderedHtml: releaseData.renderedHtml, asOf: releaseResult.envelope.asOf, author: releaseData.revision.authorPrincipalId, release: releaseData.release }} headingLevel={headingLevel} />
      );
    } else if (releaseData.status === "no-release") {
      comparison = <CompareWithRelease variant={data.variant} draft={draftSide} release={{ status: "none" }} headingLevel={headingLevel} />;
    } else if (releaseData.status === "withdrawn") {
      comparison = <StateNotice kind="empty" title={COMPARE_UNAVAILABLE.withdrawn.title} description={COMPARE_UNAVAILABLE.withdrawn.description} headingLevel={headingLevel} />;
    } else {
      comparison = <StateNotice kind="unavailable" title={COMPARE_UNAVAILABLE.unreadable.title} description={COMPARE_UNAVAILABLE.unreadable.description} headingLevel={headingLevel} />;
    }
  }

  return (
    <section aria-labelledby={titleId} data-slot="editor-shell" data-edition={variantId} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <header className="flex min-w-0 flex-col gap-3">
        <Heading level={headingLevel} id={titleId} className="text-2xl font-semibold text-pretty wrap-anywhere">
          {SURFACE_TITLE}
        </Heading>
        <p className="min-w-0 text-sm text-muted-foreground text-pretty wrap-anywhere">
          {audience.label} edition in <bdi lang={data.locale.tag}>{languageName === "" ? data.locale.tag : languageName}</bdi>. {audience.whoReceives}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link href={`/communication/${encodeURIComponent(updateId)}/${encodeURIComponent(variantId)}/preview`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Preview this edition
          </Link>
        </div>
        <Alert>
          <AlertTitle>A saved draft is not a release, and a release is not a message</AlertTitle>
          <AlertDescription>
            <p>{DRAFT_VS_RELEASED.draftIsNotWhatReadersSee}</p>
            <p>{DRAFT_VS_RELEASED.releaseIsWhatRecipientsReceive}</p>
          </AlertDescription>
        </Alert>
      </header>

      {tabs === undefined ? (
        <StateNotice
          kind="empty"
          title="This Update's other editions could not be listed"
          description="The editions of this Update could not be read, so this editor lists no edition to switch to and hides no fact about one. The edition you opened is still editable here."
          headingLevel={NESTED_HEADING_LEVEL[headingLevel]}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <VariantSwitcher family="update" variants={tabs} activeVariantId={variantId} onSelect={openEdition} label="Edition being written" />
          <LocaleSwitcher
            locales={locales ?? []}
            requested={data.locale.tag}
            served={data.locale.tag}
            onRequest={(tag: string) => {
              const target = overviewData === undefined ? undefined : editionInLocale(overviewData, data.audience, tag);
              if (target !== undefined) openEdition(target.variantId);
            }}
            onDirectionChange={(servedDirection: EditorDirection) => setReportedDirection({ edition: variantId, direction: servedDirection })}
            label="Language edition"
          />
          <p className="min-w-0 text-sm text-muted-foreground text-pretty wrap-anywhere">{EDITION_SWITCHING_NOTE}</p>
        </div>
      )}

      <DraftEditor scope={scope} variantId={variantId} recordRevision={envelope.revision} asOf={envelope.asOf} data={data} direction={direction} localeTag={data.locale.tag} headingLevel={NESTED_HEADING_LEVEL[headingLevel]} />

      {comparison}

      {submissionOffered && submitPayload !== null ? (
        <ActionReview<SubmitForReviewPayload>
          title={REVIEW_TITLE}
          description={
            <span className="flex min-w-0 flex-col gap-1">
              <span>{REVIEW_DESCRIPTION}</span>
              {publishing === undefined ? null : <span>{REVIEW_MODE_SENTENCES[publishing]}</span>}
              <span className="min-w-0 wrap-anywhere">
                Revision <bdi className="mono-identifier">{submitPayload.revisionId}</bdi>
                {draftChecksum === "" ? null : (
                  <>
                    {", checksum "}
                    <bdi className="mono-identifier">{draftChecksum}</bdi>
                  </>
                )}
                .
              </span>
              <span>{REVIEW_ROUND_NOTE.oneStepWherePolicyRequires}</span>
            </span>
          }
          consequence={REVIEW_CONSEQUENCE}
          confirmLabel={REVIEW_CONFIRM}
          consequential
          input={{ scope, expectedRevision: envelope.revision, payload: submitPayload }}
          submit={submitForReview.submit}
          headingLevel={headingLevel}
        />
      ) : (
        <StateNotice kind="empty" title={REVIEW_UNAVAILABLE_TITLE} description={submitAction?.reason?.trim() === undefined || submitAction.reason.trim() === "" ? REVIEW_UNAVAILABLE_FALLBACK : submitAction.reason.trim()} headingLevel={headingLevel} />
      )}
    </section>
  );
}

export default EditorShell;
