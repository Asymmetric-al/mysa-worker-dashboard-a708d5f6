"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import ActionReview from "@/components/action-review";
import { lifecycleOf, variantRecordOf } from "@/components/draft-status";
import { FormErrorSummary, FormFieldGroup, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import LocaleSwitcher, { type LocaleEdition } from "@/components/locale-switcher";
import MediaPicker, { type MediaPickerKind, type MediaPickerOutcome, type MediaPlacement as OnScreenPlacement, type MediaRegisterInput } from "@/components/media-picker";
import ProseEditor, { type ProseEditorProps } from "@/components/prose-editor";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import VariantSwitcher, { type VariantTab } from "@/components/variant-switcher";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DirectionProvider } from "@/components/ui/direction";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { CONTENT_PROFILE_VERSION } from "@/modules/content/document";
import type { ContentLocale } from "@/modules/content/locale";
import type { Scope } from "@/modules/data-service/envelope";
import { AUDIENCE_LABELS, DRAFT_VS_RELEASED, REVIEW_ROUND_NOTE } from "../copy/updates-copy";
import { endonymOf } from "../locale-name";
import { useDraftRecovery, type DraftPlacementRef } from "../hooks/use-draft-recovery";
import { useDraft, useRelease, useVariantOverview, type UpdateDraftData, type UpdateDraftReadResult, type UpdateReleaseReadResult, type VariantOverviewData, type VariantOverviewReadResult } from "../hooks/use-update-queries";
import { useRegisterMediaAsset, useRemovePlacement, useSubmitForReview } from "../hooks/use-update-mutations";
import type { MediaPlacement as PlacementDescriptor } from "../schemas";
import type { SubmissionNotifyMode, SubmitForReviewPayload } from "../schemas";
import { AutosaveStatus } from "./autosave-status";
import { CompareWithRelease } from "./compare-with-release";
import { DEFAULT_SUBMISSION_RELEASE_MODE, SubmissionReleaseMode } from "./submission-release-mode";
type DraftData = UpdateDraftData;
type SavedDraft = Extract<DraftData, { readonly status: "draft" }>;
type PlacementView = SavedDraft["placements"][number];
type EditorDocument = ProseEditorProps["initialDocument"];
type EditorDirection = ContentLocale["direction"];
type EditorHeadingLevel = 2 | 3 | 4;
type PickerTarget = { readonly kind: MediaPickerKind; readonly placementId?: string };
const descriptorOf = (placement: PlacementView): PlacementDescriptor => ({ altText: placement.altText, ...(placement.caption === null ? {} : { caption: placement.caption }), ...(placement.credit === null ? {} : { credit: placement.credit }) });
const onScreenPlacementOf = (placement: PlacementView): OnScreenPlacement => ({ placementId: placement.placementId, ...descriptorOf(placement) });
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
const REVIEW_UNAVAILABLE_FALLBACK = "The read this editor is composed from does not offer submission for this edition yet. Saving a revision is what a submission freezes.";
const SUBMIT_ACTION = "submit-for-review";
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
const PLACEMENT_STATE_WORDS = { ready: "Ready" } as const;
const NO_CAPTION = "No caption";
const PRESENT = "Present";
const ABSENT = "None";
const PICKER_LABELS = { manage: "Manage this placement", addImage: "Add an image", addVideo: "Add a video" } as const;
const PANE_LABELS = { group: "Which part of this editor to show", write: "Write", media: "Media" } as const;
const BODY_PANE_TITLE = "The text of this edition";
const EDITOR_LABEL = "The text of this Update edition";
const EDITOR_DESCRIPTION = "Write the edition's own text. A save is sent after a short pause, carries the revision the service last acknowledged, and states the media this draft holds.";
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The one type scale's utility for each level, so every heading this surface renders takes the measure of the level it is given rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<EditorHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
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
function placementRefOf(placement: PlacementView): DraftPlacementRef | null {
  const main = placement.renditions.find((rendition) => rendition.purpose === "display" || rendition.purpose === "playback");
  return main === undefined ? null : { assetId: placement.assetId, purpose: main.purpose };
}
function restatableRefs(placements: readonly PlacementView[]): readonly DraftPlacementRef[] {
  const refs: DraftPlacementRef[] = [];
  for (const placement of placements) {
    const ref = placementRefOf(placement);
    if (ref !== null) refs.push(ref);
  }
  return refs;
}
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
const samePlacements = (left: readonly DraftPlacementRef[], right: readonly DraftPlacementRef[]): boolean => left.length === right.length && left.every((ref, index) => ref.assetId === right[index]?.assetId && ref.purpose === right[index]?.purpose);
const holdsStatedPlacements = (outcome: MediaPickerOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged" || outcome.outcome === "unknown";
const startingDocument = (direction: EditorDirection): EditorDocument => ({ type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction, content: [{ type: "paragraph" }], sections: [] });
function tabsOf(overview: VariantOverviewData): readonly VariantTab[] {
  return overview.editions.map((edition) => ({
    variantId: edition.variantId,
    audience: edition.audience,
    locale: edition.locale,
    lifecycle: lifecycleOf(variantRecordOf(overview.document.documentId, edition), edition.headRelease ?? undefined),
    ...(edition.translation.status === "stale" ? { staleSince: edition.translation.sourceUpdatedAt } : {}),
  }));
}
function localesOfAudience(overview: VariantOverviewData, audience: VariantOverviewData["editions"][number]["audience"]): readonly LocaleEdition[] {
  return [...new Map(overview.editions.filter((edition) => edition.audience === audience).map((edition) => [edition.locale.tag, edition])).values()].map((edition) => ({ tag: edition.locale.tag, direction: edition.locale.direction, endonym: endonymOf(edition.locale.tag) }));
}
const editionInLocale = (overview: VariantOverviewData, audience: VariantOverviewData["editions"][number]["audience"], tag: string): VariantOverviewData["editions"][number] | undefined =>
  overview.editions.find((edition) => edition.audience === audience && edition.locale.tag === tag) ?? overview.editions.find((edition) => edition.locale.tag === tag);
function Heading({ level, id, className, children }: { readonly level: EditorHeadingLevel; readonly id: string; readonly className: string; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return <Tag {...{ id, className: cn(HEADING_SCALE[level], className) }}>{children}</Tag>;
}
const REMOVAL_ON_SAVE = "This session cannot place this file, so saving this draft removes the placement. Everything the record holds about the rest of the draft is unchanged.";
const KIND_WORDS = { image: "Image", video: "Video" } as const;
type PlacementRowProps = { readonly placement: PlacementView; readonly onManage: () => void };
function PlacementRow({ placement, onManage }: PlacementRowProps): ReactElement {
  const purposes = placement.renditions.map((rendition) => rendition.purpose);
  const placeable = placementRefOf(placement) !== null;
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
        <span className="min-w-0 type-supporting wrap-anywhere">
          <span className="sr-only">{`${PLACEMENT_LABELS.state}: `}</span>
          <bdi>{placement.state === "ready" ? PLACEMENT_STATE_WORDS.ready : (placement.reason?.label ?? "")}</bdi>
        </span>
      </div>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 type-body">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-start wrap-anywhere">{row.value}</dd>
          </Fragment>
        ))}
      </dl>
      {placement.state === "ready" ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          {placement.reason?.action === undefined ? null : <p className="type-supporting text-pretty wrap-anywhere">{placement.reason.action}</p>}
          {placeable ? null : <p className="type-supporting text-pretty wrap-anywhere">{REMOVAL_ON_SAVE}</p>}
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button {...{ type: "button", size: "sm", variant: "outline", onClick: onManage }}>{PICKER_LABELS.manage}</Button>
      </div>
    </li>
  );
}
type DraftEditorProps = { readonly scope: Scope; readonly variantId: string; readonly recordRevision: string; readonly asOf: string; readonly data: DraftData; readonly direction: EditorDirection; readonly localeTag: string; readonly headingLevel: EditorHeadingLevel };
function DraftEditor({ scope, variantId, recordRevision, asOf, data, direction, localeTag, headingLevel }: DraftEditorProps): ReactElement {
  const titleId = useId();
  const nestedLevel = NESTED_HEADING_LEVEL[headingLevel];
  const placements = useMemo<readonly PlacementView[]>(() => (data.status === "draft" ? data.placements : []), [data]);
  const readRefs = useMemo<readonly DraftPlacementRef[]>(() => restatableRefs(placements), [placements]);
  const initialBody = useMemo<EditorDocument>(() => (data.status === "draft" ? data.revision.body : startingDocument(direction)), [data, direction]);
  const [pendingRefs, setPendingRefs] = useState<readonly DraftPlacementRef[] | null>(null);
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
  const lastBodyRef = useRef<EditorDocument>(initialBody);
  const mediaPaneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mediaRequests === 0) return;
    mediaPaneRef.current?.focus();
  }, [mediaRequests]);
  const reportChange = (document: EditorDocument): void => {
    lastBodyRef.current = document;
    void recovery.notifyChange(document, statedRefs);
  };
  const placeMedia = async (input: MediaRegisterInput, swappedPlacementId: string | null): Promise<MediaPickerOutcome> => {
    setMediaRefusal(null);
    const registered = await register.submit({ scope, expectedRevision: recordRevision, payload: input });
    const assetId = registered.outcome === "accepted" || registered.outcome === "alreadyAccepted" ? (registered.created?.[0] ?? "") : "";
    if (assetId === "") return registered;
    const added: DraftPlacementRef = { assetId, purpose: input.kind === "image" ? "display" : "playback" };
    const nextRefs = statedRefsWith(placements, added, swappedPlacementId);
    const settled = await recovery.notifyChange(recovery.keptBody ?? lastBodyRef.current, nextRefs);
    if (settled.outcome === "invalid") setMediaRefusal(fieldErrorsFromInvalid(settled));
    if (holdsStatedPlacements(settled)) setPendingRefs(nextRefs);
    return settled;
  };
  const removeMedia = async (placementId: string): Promise<MediaPickerOutcome> => {
    setMediaRefusal(null);
    const settled = await removePlacement.submit({ scope, expectedRevision: recovery.acknowledgedRevision ?? recordRevision, payload: { variantId, placementId } });
    if (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted") recovery.adoptConfirmedRevision(settled.revision);
    if (settled.outcome === "invalid") setMediaRefusal(fieldErrorsFromInvalid(settled));
    if (holdsStatedPlacements(settled)) setPendingRefs(restatableRefs(placements.filter((placement) => placement.placementId !== placementId)));
    return settled;
  };
  const adoptLocalText = (body: EditorDocument): void => {
    setAdoptedBody(body);
    setEditorInstance((count) => count + 1);
    lastBodyRef.current = body;
    recovery.discardLocalRecovery();
    void recovery.notifyChange(body, statedRefs);
  };
  const requestMedia = (): void => {
    setPane("media");
    setMediaRequests((count) => count + 1);
  };
  const images = placements.filter((placement) => placement.kind === "image");
  const videos = placements.filter((placement) => placement.kind === "video");
  const keptText = recovery.localRecovery.present ? recovery.localRecovery.body : null;
  const managed = picker === null || picker.placementId === undefined ? undefined : placements.find((placement) => placement.placementId === picker.placementId);
  const revision = data.status === "draft" ? data.revision : null;
  const editorPane = (
    <div className={cn("flex min-w-0 flex-col gap-4", pane === "write" ? "flex" : "hidden", "md:flex")}>
      <p className="min-w-0 type-supporting text-pretty wrap-anywhere">{EDITOR_DESCRIPTION}</p>
      {keptText === null ? null : (
        <Alert>
          <AlertTitle>{LOCAL_RECOVERY.title}</AlertTitle>
          <AlertDescription>
            <p className="type-supporting">{LOCAL_RECOVERY.whatItIs}</p>
            <p className="type-supporting">{LOCAL_RECOVERY.whatAdopting}</p>
          </AlertDescription>
          <AlertAction>
            <Button {...{ type: "button", size: "sm", variant: "outline", onClick: () => adoptLocalText(keptText) }}>{LOCAL_RECOVERY.action}</Button>
          </AlertAction>
        </Alert>
      )}
      {/* Direction is a property of the content, applied to the editing block and never to the interface around it. */}
      <DirectionProvider direction={direction}>
        <div dir={direction} lang={localeTag} className="min-w-0">
          {/* The editor reports every change here and holds no save state of its own: the recovery hook is the one owner of
              the draft, so it carries the revision each save states and the one place that says whether the text is saved. */}
          <ProseEditor key={`draft-${String(editorInstance)}`} initialDocument={adoptedBody ?? initialBody} direction={direction} label={EDITOR_LABEL} onChange={reportChange} onRequestMedia={requestMedia} />
        </div>
      </DirectionProvider>
      <AutosaveStatus recovery={recovery} acknowledgedAsOf={asOf} />
    </div>
  );
  const mediaList = (kind: MediaPickerKind): ReactElement => {
    const list = kind === "image" ? images : videos;
    if (list.length === 0) return <StateNotice kind="empty" title={MEDIA_EMPTY[kind].title} description={MEDIA_EMPTY[kind].description} headingLevel={nestedLevel} />;
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
      <p className="min-w-0 type-supporting text-pretty wrap-anywhere">{MEDIA_GROUP_DESCRIPTION}</p>
      <FormFieldGroup legend={MEDIA_GROUP_LEGEND} name="add-media" description="The picker states the formats, sizes and lengths it admits before any work begins, requires alternative text, and never keeps the file's own name.">
        {() => (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button {...{ type: "button", size: "sm", variant: "outline", onClick: () => setPicker({ kind: "image" }) }}>{PICKER_LABELS.addImage}</Button>
            <Button {...{ type: "button", size: "sm", variant: "outline", onClick: () => setPicker({ kind: "video" }) }}>{PICKER_LABELS.addVideo}</Button>
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
        <TabsContent {...{ value: "image", "aria-label": MEDIA_LISTS.image, className: "min-w-0" }}>{mediaList("image")}</TabsContent>
        <TabsContent {...{ value: "video", "aria-label": MEDIA_LISTS.video, className: "min-w-0" }}>{mediaList("video")}</TabsContent>
      </Tabs>
    </section>
  );
  return (
    <Card data-slot="editor-shell-body" data-edition={variantId} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Heading {...{ level: headingLevel, id: titleId, className: "text-pretty" }}>{BODY_PANE_TITLE}</Heading>
        </CardTitle>
        {revision === null ? (
          <p className="min-w-0 type-supporting text-pretty wrap-anywhere">Nothing has been saved for this edition yet. The first save records the text as its draft; nothing is published by it.</p>
        ) : (
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-xs">
            {[
              { label: DRAFT_FACTS.revision, value: revision.revisionId },
              { label: DRAFT_FACTS.checksum, value: revision.contentChecksum },
              { label: DRAFT_FACTS.savedAt, value: asOf },
            ].map((fact) => (
              <Fragment key={fact.label}>
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 wrap-anywhere">
                  <bdi className="mono-identifier">{fact.value}</bdi>
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <FormFieldGroup legend={PANE_LABELS.group} name="editor-pane" hideLegend className="md:hidden">
          {() => (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button {...{ type: "button", size: "sm", variant: pane === "write" ? "default" : "outline", "aria-pressed": pane === "write", onClick: () => setPane("write") }}>{PANE_LABELS.write}</Button>
              <Button {...{ type: "button", size: "sm", variant: pane === "media" ? "default" : "outline", "aria-pressed": pane === "media", onClick: () => setPane("media") }}>{PANE_LABELS.media}</Button>
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
        {...(managed === undefined ? {} : { placement: onScreenPlacementOf(managed), onRemove: (input: { readonly placementId: string }) => removeMedia(input.placementId), onReplace: (input: { readonly placementId: string } & MediaRegisterInput) => placeMedia(input, managed.placementId) })}
        onRegister={(input: MediaRegisterInput) => placeMedia(input, null)}
        onSettled={(outcome: MediaPickerOutcome) => {
          if (outcome.outcome === "invalid") setMediaRefusal(fieldErrorsFromInvalid(outcome));
        }}
      />
    </Card>
  );
}
export type EditorShellProps = {
  /** The context the reads run in. The service re-resolves it for every read and every write, so this is a claim the caller makes and not an authority it grants. */ readonly scope: Scope;
  /** The Update whose editions this editor moves between, and whose draft it writes. */ readonly updateId: string;
  /** The edition being written: one audience in one exact content locale. Two editions of one Update are two drafts. */ readonly variantId: string;
  /** The draft the server render already read, so the browser issues no duplicate request for what it was handed. */ readonly initialDraft?: UpdateDraftReadResult;
  /** The release standing at this edition's head, as the server render read it. */ readonly initialRelease?: UpdateReleaseReadResult;
  /** This Update's editions, as the server render read them. */ readonly initialOverview?: VariantOverviewReadResult;
  /** When those answers were produced, so the cache treats the seed as the age it is. */ readonly initialDataUpdatedAt?: number;
  /** The heading level this surface nests beneath. */ readonly headingLevel?: EditorHeadingLevel;
  /** The release mode a new submission asks for, as the browser's publishing preference states it: left out, the submission states no mode and the service's own default — publish only — applies. */ readonly publishing?: SubmissionNotifyMode;
  readonly className?: string;
};
export function EditorShell({ scope, updateId, variantId, initialDraft, initialRelease, initialOverview, initialDataUpdatedAt, headingLevel = 2, publishing, className }: EditorShellProps): ReactElement {
  const titleId = useId();
  const router = useRouter();
  const submitForReview = useSubmitForReview();
  const [reportedDirection, setReportedDirection] = useState<{ readonly edition: string; readonly direction: EditorDirection } | null>(null);
  // The author chooses the release mode once, beside the editor: a save never restates a notice nobody asked for, and the choice travels in the payload the review step submits. It starts at the browser preference where the shell states one.
  const [releaseMode, setReleaseMode] = useState<SubmissionNotifyMode>(publishing ?? DEFAULT_SUBMISSION_RELEASE_MODE);
  const stamped = initialDataUpdatedAt === undefined ? {} : { initialDataUpdatedAt };
  const draft = useDraft({ scope, variantId }, initialDraft === undefined ? {} : { initialData: initialDraft, ...stamped });
  const overview = useVariantOverview({ scope, documentId: updateId }, initialOverview === undefined ? {} : { initialData: initialOverview, ...stamped });
  const release = useRelease({ scope, variantId }, initialRelease === undefined ? {} : { initialData: initialRelease, ...stamped });
  const draftResult = draft.result;
  if (draftResult === undefined || draft.isStale(draftResult)) return <StateNotice kind="loading" title={READING.title} description={READING.description} headingLevel={headingLevel} className={className} />;
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
  const languageName = endonymOf(data.locale.tag);
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
  const openLocale = (tag: string): void => {
    const target = overviewData === undefined ? undefined : editionInLocale(overviewData, data.audience, tag);
    if (target !== undefined) openEdition(target.variantId);
  };
  const submitAction = envelope.actions.find((action) => action.name === SUBMIT_ACTION);
  const submissionOffered = draftRevisionId !== undefined && (submitAction === undefined || submitAction.available);
  const submitPayload: SubmitForReviewPayload | null = draftRevisionId === undefined ? null : { variantId, revisionId: draftRevisionId, notifyMode: releaseMode };
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
        <Heading {...{ level: headingLevel, id: titleId, className: "text-pretty wrap-anywhere" }}>{SURFACE_TITLE}</Heading>
        <p className="min-w-0 type-supporting text-pretty wrap-anywhere">
          {audience.label} edition in <bdi lang={data.locale.tag}>{languageName === "" ? data.locale.tag : languageName}</bdi>. {audience.whoReceives}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link {...{ href: `/communication/${encodeURIComponent(updateId)}/${encodeURIComponent(variantId)}/preview`, className: cn(buttonVariants({ variant: "outline", size: "sm" })), "data-slot": "button" }}>Preview this edition</Link>
        </div>
        <Alert>
          <AlertTitle>A saved draft is not a release, and a release is not a message</AlertTitle>
          <AlertDescription>
            <p className="type-supporting">{DRAFT_VS_RELEASED.draftIsNotWhatReadersSee}</p>
            <p className="type-supporting">{DRAFT_VS_RELEASED.releaseIsWhatRecipientsReceive}</p>
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
          <LocaleSwitcher locales={locales ?? []} requested={data.locale.tag} served={data.locale.tag} onRequest={openLocale} onDirectionChange={(servedDirection: EditorDirection) => setReportedDirection({ edition: variantId, direction: servedDirection })} label="Language edition" />
          <p className="min-w-0 type-supporting text-pretty wrap-anywhere">{EDITION_SWITCHING_NOTE}</p>
        </div>
      )}
      <DraftEditor scope={scope} variantId={variantId} recordRevision={envelope.revision} asOf={envelope.asOf} data={data} direction={direction} localeTag={data.locale.tag} headingLevel={NESTED_HEADING_LEVEL[headingLevel]} />
      {comparison}
      {submissionOffered && submitPayload !== null ? (
        <ActionReview<SubmitForReviewPayload>
          title={REVIEW_TITLE}
          description={
            // A block container rather than an inline one: the release choice below is a fieldset of real radio inputs.
            <div className="flex min-w-0 flex-col gap-1">
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
              <span>{REVIEW_ROUND_NOTE.reviewerCannotAddNotify}</span>
              <SubmissionReleaseMode value={releaseMode} onChange={setReleaseMode} />
            </div>
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
