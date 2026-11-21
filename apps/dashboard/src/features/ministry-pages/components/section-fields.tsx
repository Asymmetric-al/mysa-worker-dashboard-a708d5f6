"use client";
/**
 * One composed section's field form: its admitted plain-text fields, the four bounded presentation choices, the media
 * placement a section of an image or video type carries, and the save that writes them into this edition's draft.
 *
 * Nothing here invents presentation. The four choices are the members of `PRESENTATION_CHOICES` in the content profile,
 * their labels are the copy module's words for those members, and the value sent is the member itself — so a layout or an
 * alignment the profile would refuse cannot be constructed on this side, and `invalid` can only arrive from a client that
 * has gone stale. The four controls are the whole of the styling surface a page has: no colour, size, offset, class, embed
 * or per-page theme is offered anywhere in this form.
 *
 * The save travels as `saveSectionFields` through the family's one transport (`hooks/use-section-mutations`), carrying the
 * revision this form was opened at. Every member of the closed outcome set is stated in place: a refusal leaves the
 * worker's text exactly where it is, a conflict names the revision the record now stands at beside the text that was kept
 * and offers a deliberate re-apply, and an acceptance says a draft was saved and never that anything was released.
 *
 * Where the acting scope comes from: a save must present the scope the section was read in, so this form takes the scope
 * and the Page identity from the Page read the builder already holds (`scope`/`documentId` when the caller passes them,
 * otherwise from that read's envelope in the query cache). A save can therefore never act in a context the section was
 * not read in, and a scope that cannot be resolved disables the save with the reason stated rather than guessing one.
 */
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { FormErrorSummary, FormField, FormFieldGroup, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import { MediaPicker, type MediaPickerKind, type MediaPickerOutcome, type MediaRegisterInput, type MediaPlacement } from "@/components/media-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { PRESENTATION_CHOICES, type ContentDirection, type PresentationChoice } from "@/modules/content/document";
import { unavailable } from "@/modules/data-service/outcome";
import { copy, type ManagedFieldKey } from "../copy";
import { useRegisterPageMediaAsset, useRemovePagePlacement } from "../hooks/use-page-media-mutations";
import { useSaveSectionFields } from "../hooks/use-section-mutations";
import type { SectionFields as SectionFieldValuesByType } from "../schemas/section";
import { ManagedSectionLock } from "./managed-section-lock";

// ---------------------------------------------------------------------------------------------
// The section this form edits
// ---------------------------------------------------------------------------------------------

/** One save's variables, taken from the family transport rather than restated here. */
type SaveVariables = Parameters<ReturnType<typeof useSaveSectionFields>["mutateAsync"]>[0];
/** The scope a save acts under, taken from that same variable type so a service change reaches this file. */
type MutationScope = SaveVariables["scope"];

/** One catalogue section type, taken from the catalogue the copy module already names them by. */
export type PageSectionType = keyof typeof copy.catalogue.sections;

/**
 * The field a section type admits, derived from the sibling schema's discriminated union rather than restated: a key the
 * schema does not carry is not one this form can render or send, and a key it renames reaches this file as a type error.
 */
type AdmittedFieldKeys<Type> = Type extends { readonly sectionType: string } ? Exclude<keyof Type, "sectionType"> : never;
export type SectionFieldKey = AdmittedFieldKeys<SectionFieldValuesByType>;

/** One media placement as the section carries it: the identity a change addresses, the kind, and the description shown. */
export type SectionPlacement = { readonly placementId: string; readonly kind: MediaPickerKind; readonly altText: string; readonly caption?: string | null; readonly credit?: string | null; readonly state?: "ready" | "unavailable" };

/**
 * One section of the draft edition as `readPage` states it: the identity a change addresses, the catalogue type, whether a
 * source owns it, the plain-text fields it holds and the presentation choices it was given.
 */
export type PageBuilderSection = {
  readonly sectionId: string;
  readonly sectionType: PageSectionType;
  readonly managed: boolean;
  readonly managedReasonKey?: ManagedFieldKey | null;
  readonly fields: Readonly<Record<string, string>>;
  readonly presentation: PresentationChoice;
  readonly placements?: readonly SectionPlacement[];
};

export interface SectionFieldsProps {
  readonly section: PageBuilderSection;
  readonly variantId: string;
  /** The revision this form was opened at, presented as `expectedRevision` on every save. */
  readonly expectedRevision: string;
  readonly direction: ContentDirection;
  readonly disabled?: boolean;
  readonly className?: string;
  /** The scope the Page was read in, when the caller already holds it; otherwise it is resolved from that read. */
  readonly scope?: MutationScope;
  /** The Page identity, when the caller already holds it; otherwise it is resolved from the Page's own read. */
  readonly documentId?: string;
}

// ---------------------------------------------------------------------------------------------
// Wording and the admitted choices
// ---------------------------------------------------------------------------------------------

type FieldControlKind = "text" | "long-text" | "date";
type FieldWording = { readonly label: string; readonly description: string; readonly control: FieldControlKind };

/** Every admitted field, with the label a form needs and the control its content asks for. */
const FIELD_WORDING: Readonly<Record<SectionFieldKey, FieldWording>> = {
  heading: { label: "Heading", description: "One short line a reader meets first, in plain text.", control: "text" },
  body: { label: "Body", description: "This section's words, in plain text. A blank line separates one paragraph from the next.", control: "long-text" },
  date: { label: "Date", description: "The civil date this milestone belongs to, as a calendar date rather than a moment.", control: "date" },
  altText: { label: "Alternative text", description: "What the media shows, in your words. It is read aloud in place of it.", control: "long-text" },
  caption: { label: "Caption", description: "Shown beneath the media. Leave it empty when it would only repeat the alternative text.", control: "text" },
  credit: { label: "Credit", description: "Who made or supplied this media, as it should read beside it.", control: "text" },
  language: { label: "Language", description: "The language of this media, as a tag such as en or ar-EG. This is the media's language, never the interface's.", control: "text" },
};

/** The order a section's fields read in, whichever of them its type admits. */
const FIELD_ORDER: readonly SectionFieldKey[] = ["heading", "date", "body", "altText", "caption", "credit", "language"];

/** The four choices, each built from its own admitted tuple so no member can be added here alone. */
const TREATMENT_OPTIONS = PRESENTATION_CHOICES.treatment.map((value) => ({ value, ...copy.presentation.treatment[value] }));
const LAYOUT_OPTIONS = PRESENTATION_CHOICES.layout.map((value) => ({ value, ...copy.presentation.layout[value] }));
const ALIGNMENT_OPTIONS = PRESENTATION_CHOICES.alignment.map((value) => ({ value, ...copy.presentation.alignment[value] }));
const IMAGE_FIT_OPTIONS = PRESENTATION_CHOICES.imageFit.map((value) => ({ value, ...copy.presentation.imageFit[value] }));

function memberGuard<Member extends string>(admitted: readonly Member[]): (candidate: string) => candidate is Member {
  const allowed: readonly string[] = admitted;
  return (candidate: string): candidate is Member => allowed.includes(candidate);
}
const isTreatment = memberGuard(PRESENTATION_CHOICES.treatment);
const isLayout = memberGuard(PRESENTATION_CHOICES.layout);
const isAlignment = memberGuard(PRESENTATION_CHOICES.alignment);
const isImageFit = memberGuard(PRESENTATION_CHOICES.imageFit);

const FIELDS_COPY = {
  heading: copy.builder.fields,
  save: "Save this section",
  saveAgain: "Save my text against the current revision",
  retrySameChange: "Send this change again",
  saving: "Saving this section, so its fields are written to this edition's draft…",
  saved: "Section saved to this edition's draft. Nothing was released.",
  savedAlready: "This change had already been saved, so nothing was repeated.",
  unchanged: "Nothing changed, so nothing was saved.",
  conflictTitle: "A newer version of this edition is on the record",
  conflictBody: "Your text is still in this form and nothing was overwritten. The edition has been read again, so the record as it now stands is beside this form for comparison.",
  deniedTitle: "You cannot change this section",
  deniedBody: "This form holds no count, title or detail about what it could not reach. Your text is still here; nothing was saved.",
  invalidTitle: "This section cannot be saved as it stands",
  unavailableTitle: "The source behind this change could not complete it",
  unknownTitle: "The result of this change is not known yet",
  unknownBody: "The request may or may not have been applied. Send the same change again with the same operation id: a replay answers with the original result instead of repeating the effect.",
  noAuthority: "This section cannot be saved from here, because the draft edition's context was not available on this screen. Reopen the edition to change it.",
  disabledReason: "This edition cannot be changed right now.",
  enterNote: "Text you have typed stays here until you save it. A refusal or an outage never clears it.",
  managedFallback: "This section's content is supplied by its source, so it is shown here and changed there.",
  currentRevisionLabel: "Revision on the record",
  startedRevisionLabel: "Revision this form opened at",
} as const;

const MEDIA_COPY = {
  heading: "Media in this section",
  addImage: "Add an image",
  addVideo: "Add a video",
  placedLabel: "Placed in this section",
  unavailable: "The media placed in this section cannot be shown right now, and no address is served in its place.",
  nonePlaced: "No media is placed in this section yet.",
  mediaLanguageNote: "The media's own description is set in the picker; the section's text fields stay separate from it.",
} as const;

const SOURCE_SYSTEM = "data-service";
const MEDIA_PATH = "/api/media";
const NO_AUTHORITY_GUIDANCE = "Open the Page's draft edition again and make the change from there: the context this section was read in is the only one its save may act in.";

// ---------------------------------------------------------------------------------------------
// Form values, derived from the section in hand
// ---------------------------------------------------------------------------------------------

type SectionFormValues = { readonly [Key in SectionFieldKey]: string } & PresentationChoice;

function textOf(fields: Readonly<Record<string, string>>, key: SectionFieldKey): string {
  return fields[key] ?? "";
}

/** The keys this section type actually carries, in reading order: the record states them, so nothing is guessed. */
function admittedFieldKeysOf(section: PageBuilderSection): readonly SectionFieldKey[] {
  return FIELD_ORDER.filter((key) => Object.hasOwn(section.fields, key));
}

/** The form's starting values: everything the section already holds, so previously entered work is always prefilled. */
function formValuesOf(section: PageBuilderSection): SectionFormValues {
  const admitted = admittedFieldKeysOf(section);
  const valueOf = (key: SectionFieldKey): string => (admitted.includes(key) ? textOf(section.fields, key) : "");
  return {
    heading: valueOf("heading"),
    date: valueOf("date"),
    body: valueOf("body"),
    altText: valueOf("altText"),
    caption: valueOf("caption"),
    credit: valueOf("credit"),
    language: valueOf("language"),
    treatment: section.presentation.treatment,
    layout: section.presentation.layout,
    alignment: section.presentation.alignment,
    imageFit: section.presentation.imageFit,
  };
}

/** The fields to send: the section type's own keys, and only those, so a key another type owns is never posted to it. */
function fieldsOf(section: PageBuilderSection, values: SectionFormValues): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const key of admittedFieldKeysOf(section)) {
    fields[key] = values[key];
  }
  return fields;
}

function presentationOf(values: SectionFormValues): PresentationChoice {
  return { treatment: values.treatment, layout: values.layout, alignment: values.alignment, imageFit: values.imageFit };
}

/** Whether a section admits media at all: the type whose fields describe a picture or a film is the one that does. */
function admitsMedia(section: PageBuilderSection): boolean {
  return admittedFieldKeysOf(section).includes("altText");
}

function mediaKindOf(section: PageBuilderSection): MediaPickerKind {
  return section.sectionType === "video" ? "video" : "image";
}

/** The placement this section carries for its own media kind, when the read supplied one. */
function placementOf(section: PageBuilderSection): MediaPlacement | undefined {
  const kind = mediaKindOf(section);
  const placement = (section.placements ?? []).find((candidate) => candidate.kind === kind);
  if (placement === undefined) {
    return undefined;
  }
  return { placementId: placement.placementId, altText: placement.altText, ...(placement.caption === undefined || placement.caption === null ? {} : { caption: placement.caption }), ...(placement.credit === undefined || placement.credit === null ? {} : { credit: placement.credit }) };
}

/** The lock reason a managed section states: the read's own key when it carries one, otherwise the closest reason. */
function managedReasonKeyOf(section: PageBuilderSection): ManagedFieldKey {
  if (section.managedReasonKey !== undefined && section.managedReasonKey !== null) {
    return section.managedReasonKey;
  }
  switch (section.sectionType) {
    case "giving":
      return "giving-binding";
    case "progress":
      return "support-progress";
    default:
      return "source-supplied-section";
  }
}

// ---------------------------------------------------------------------------------------------
// The acting context
// ---------------------------------------------------------------------------------------------

type DraftEditionAuthority = { readonly scope: MutationScope; readonly documentId: string };

function recordAt(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

/** The Page identity a read envelope states, when it states one. */
function documentIdOf(data: Readonly<Record<string, unknown>>): string | undefined {
  const document = recordAt(data["document"]);
  const documentId = document?.["documentId"];
  return typeof documentId === "string" && documentId.length > 0 ? documentId : undefined;
}

/** Whether one read states the edition this form edits, so the authority taken from it is the one the section was read in. */
function statesEdition(data: Readonly<Record<string, unknown>>, variantId: string): boolean {
  const draft = recordAt(data["draft"]);
  if (draft !== undefined && draft["variantId"] === variantId) {
    return true;
  }
  const editions = data["editions"];
  return Array.isArray(editions) && editions.some((edition) => recordAt(edition)?.["variantId"] === variantId);
}

/**
 * The scope one read envelope states. The identifiers arrive already minted by the service, so this narrows a stored value
 * to that type rather than deriving one: an envelope that does not carry all four is no authority and is skipped.
 */
function scopeAt(value: unknown): MutationScope | undefined {
  const record = recordAt(value);
  if (record === undefined) {
    return undefined;
  }
  const { organizationId, ministryId, supportSubjectId, principalId } = record;
  const stated = [organizationId, ministryId, supportSubjectId, principalId].every((identifier) => typeof identifier === "string" && identifier !== "");
  if (!stated) {
    return undefined;
  }
  return { organizationId, ministryId, supportSubjectId, principalId } as MutationScope;
}

/** The scope and Page identity of the read that carried this edition, taken from the cache the builder filled. */
function authorityInCache(queryClient: ReturnType<typeof useQueryClient>, variantId: string): DraftEditionAuthority | undefined {
  const candidates = queryClient.getQueryCache().findAll({ predicate: (query) => query.queryKey.includes("pages") && query.queryKey.includes("page") });
  for (const query of candidates) {
    const result = recordAt(query.state.data);
    if (result === undefined || result["kind"] !== "envelope") {
      continue;
    }
    const envelope = recordAt(result["envelope"]);
    if (envelope === undefined) {
      continue;
    }
    const data = recordAt(envelope["data"]);
    if (data === undefined || !statesEdition(data, variantId)) {
      continue;
    }
    const documentId = documentIdOf(data);
    const scope = scopeAt(envelope["scope"]);
    if (documentId === undefined || scope === undefined) {
      continue;
    }
    return { scope, documentId };
  }
  return undefined;
}

function sameAuthority(current: DraftEditionAuthority | undefined, next: DraftEditionAuthority | undefined): boolean {
  if (current === undefined || next === undefined) {
    return current === next;
  }
  return current.documentId === next.documentId && current.scope.organizationId === next.scope.organizationId && current.scope.ministryId === next.scope.ministryId && current.scope.supportSubjectId === next.scope.supportSubjectId && current.scope.principalId === next.scope.principalId;
}

/**
 * The scope and Page identity a save acts under: the caller's when it states both, otherwise the ones the Page read of
 * this edition carried. The cache is subscribed to rather than read once, so the authority appears as soon as that read
 * lands and follows it across a re-read — and the snapshot is held by identity, so a re-render that found the same
 * authority returns the same object instead of a new one.
 */
function useDraftEditionAuthority(variantId: string, providedScope: MutationScope | undefined, providedDocumentId: string | undefined): DraftEditionAuthority | undefined {
  const queryClient = useQueryClient();
  const snapshot = useRef<DraftEditionAuthority | undefined>(undefined);
  const getSnapshot = useCallback((): DraftEditionAuthority | undefined => {
    const next = providedScope !== undefined && providedDocumentId !== undefined ? { scope: providedScope, documentId: providedDocumentId } : authorityInCache(queryClient, variantId);
    if (sameAuthority(snapshot.current, next)) {
      return snapshot.current;
    }
    snapshot.current = next;
    return next;
  }, [queryClient, variantId, providedScope, providedDocumentId]);
  const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------------------------
// Field paths and refusals
// ---------------------------------------------------------------------------------------------

/** The key a refusal that belongs to no single control is collected under: the summary reads it as a form-level message. */
const FORM_LEVEL_CONTROL = "";

/** The control a refusal names, from the path the transport reports it under. */
function controlNameOf(path: string): string {
  const trimmed = path.startsWith("payload.") ? path.slice("payload.".length) : path;
  if (trimmed.startsWith("fields.")) {
    return trimmed.slice("fields.".length);
  }
  if (trimmed.startsWith("presentation.")) {
    return trimmed.slice("presentation.".length);
  }
  return FORM_LEVEL_CONTROL;
}

/** A refusal's messages, keyed by the control each one belongs to, in one deduplicating pass. */
function refusalsByControl(fields: Readonly<Record<string, readonly string[]>>): Readonly<Record<string, readonly string[]>> {
  const byControl = new Map<string, string[]>();
  for (const [path, messages] of Object.entries(fields)) {
    const control = controlNameOf(path);
    const existing = byControl.get(control);
    const collected = existing ?? [];
    for (const message of messages) {
      if (!collected.includes(message)) {
        collected.push(message);
      }
    }
    byControl.set(control, collected);
  }
  return Object.fromEntries(byControl);
}

// ---------------------------------------------------------------------------------------------
// What an attempt answered
// ---------------------------------------------------------------------------------------------

type SaveSettlement =
  | { readonly kind: "accepted"; readonly repeated: boolean }
  | { readonly kind: "unchanged" }
  | { readonly kind: "conflict"; readonly currentRevision: string; readonly changedIntent: boolean }
  | { readonly kind: "denied"; readonly reasonCode: string }
  | { readonly kind: "invalid"; readonly errors: FieldErrorLookup }
  | { readonly kind: "unavailable"; readonly sourceSystem: string; readonly guidance: string }
  | { readonly kind: "unknown"; readonly operationId: string };

/** One member of the closed outcome set, kept in the form the surface states it: no outcome is folded into another. */
function settlementOf(outcome: MediaPickerOutcome): SaveSettlement {
  switch (outcome.outcome) {
    case "accepted":
      return { kind: "accepted", repeated: false };
    case "alreadyAccepted":
      return { kind: "accepted", repeated: true };
    case "unchanged":
      return { kind: "unchanged" };
    case "conflict":
      return { kind: "conflict", currentRevision: outcome.currentRevision, changedIntent: outcome.reason === "changed-intent" };
    case "denied":
      return { kind: "denied", reasonCode: outcome.reasonCode };
    case "invalid":
      return { kind: "invalid", errors: fieldErrorsFromInvalid({ fields: refusalsByControl(outcome.fields) }) };
    case "unavailable":
      return { kind: "unavailable", sourceSystem: outcome.source.system, guidance: outcome.guidance };
    case "unknown":
      return { kind: "unknown", operationId: outcome.operationId };
  }
}

/** The short sentence the polite status states for whatever the last attempt answered. */
function statusTextOf(saving: boolean, settlement: SaveSettlement | null): string {
  if (saving) {
    return FIELDS_COPY.saving;
  }
  if (settlement === null) {
    return "";
  }
  switch (settlement.kind) {
    case "accepted":
      return settlement.repeated ? FIELDS_COPY.savedAlready : FIELDS_COPY.saved;
    case "unchanged":
      return FIELDS_COPY.unchanged;
    case "conflict":
      return `${FIELDS_COPY.conflictTitle}. ${FIELDS_COPY.conflictBody}`;
    case "denied":
      return `${FIELDS_COPY.deniedTitle}. ${FIELDS_COPY.deniedBody}`;
    case "invalid":
      return FIELDS_COPY.invalidTitle;
    case "unavailable":
      return `${FIELDS_COPY.unavailableTitle}. ${settlement.guidance}`;
    case "unknown":
      return FIELDS_COPY.unknownBody;
  }
}

/** The body an attempt sends: the section type's own fields and the four admitted choices, plus the draft it edits. */
type SaveSectionPayloadBody = { readonly variantId: string; readonly sectionId: string; readonly fields: Readonly<Record<string, string>>; readonly presentation: PresentationChoice };

function payloadBodyOf(section: PageBuilderSection, variantId: string, values: SectionFormValues): SaveSectionPayloadBody {
  return { variantId, sectionId: section.sectionId, fields: fieldsOf(section, values), presentation: presentationOf(values) };
}

/** One attempt's intent, as a comparable string: the same change keeps its operation id, a changed one takes a new id. */
function intentDigestOf(body: SaveSectionPayloadBody): string {
  const keys = Object.keys(body.fields).sort();
  return JSON.stringify([body.variantId, body.sectionId, keys.map((key) => [key, body.fields[key]]), body.presentation.treatment, body.presentation.layout, body.presentation.alignment, body.presentation.imageFit]);
}

/** One attempt's identity: minted for a new intent, and reused when the same intent is sent again so a replay answers it. */
function attemptIdOf(previous: { readonly operationId: string; readonly digest: string } | null, digest: string): string {
  if (previous !== null && previous.digest === digest) {
    return previous.operationId;
  }
  return globalThis.crypto.randomUUID();
}

const ISO_CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** The bytes one chosen file carries, as the base64 text the registration travels in. */
function readBytesBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error("The browser could not read the chosen file, so nothing was sent."));
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("The browser read the chosen file as something other than a data URL, so nothing was sent."));
        return;
      }
      const separator = result.indexOf(",");
      resolve(separator === -1 ? "" : result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------

function SectionFieldsForm({ section, variantId, expectedRevision, direction, disabled = false, className, scope, documentId }: SectionFieldsProps): ReactElement {
  const headingId = useId();
  const saveReasonId = useId();
  const queryClient = useQueryClient();
  const form = useForm({ defaultValues: formValuesOf(section) });
  const authority = useDraftEditionAuthority(variantId, scope, documentId);
  const saveSection = useSaveSectionFields();
  const registerMedia = useRegisterPageMediaAsset();
  const removeMedia = useRemovePagePlacement();
  const [settlement, setSettlement] = useState<SaveSettlement | null>(null);
  const [reapplyRevision, setReapplyRevision] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const attempt = useRef<{ operationId: string; digest: string } | null>(null);
  const mediaAttempt = useRef<{ operationId: string; digest: string } | null>(null);
  const saving = saveSection.isPending;
  // Correcting anything begins a new intent, so the previous answer stops being shown against values it was not about.
  const clearSettlement = useCallback((): void => {
    setSettlement((current) => (current === null ? current : null));
    setReapplyRevision((current) => (current === null ? current : null));
  }, []);
  // A conflict means the edition moved under this form: the Page read is re-run so the builder shows the record as it now
  // stands, while this form keeps the text the worker entered for comparison.
  const rereadPage = useCallback((): void => {
    if (authority === undefined) {
      return;
    }
    const pageDocumentId = authority.documentId;
    void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("pages") && query.queryKey.includes(pageDocumentId) });
  }, [authority, queryClient]);
  const submit = useCallback(async (): Promise<void> => {
    if (authority === undefined || disabled || saving) {
      return;
    }
    const body = payloadBodyOf(section, variantId, form.state.values);
    const digest = intentDigestOf(body);
    const operationId = attemptIdOf(attempt.current, digest);
    attempt.current = { operationId, digest };
    try {
      const outcome = await saveSection.mutateAsync({ operationId, scope: authority.scope, expectedRevision: reapplyRevision ?? expectedRevision, documentId: authority.documentId, payload: body });
      const next = settlementOf(outcome);
      setSettlement(next);
      setReapplyRevision(next.kind === "conflict" ? next.currentRevision : null);
      if (next.kind === "conflict") {
        rereadPage();
      }
    } catch {
      // A throw is a fault this surface cannot attribute: the effect may or may not have been applied, so the attempt is
      // reported as unknown with its operation id, and the text stays exactly where it is.
      setSettlement({ kind: "unknown", operationId });
    }
  }, [authority, disabled, expectedRevision, form, reapplyRevision, rereadPage, saveSection, saving, section, variantId]);
  const errors = settlement !== null && settlement.kind === "invalid" ? settlement.errors : null;
  const fieldKeys = admittedFieldKeysOf(section);
  const startingValues = formValuesOf(section);
  const admittedLabels: Readonly<Record<string, string | undefined>> = Object.fromEntries([...fieldKeys.map((key) => [key, FIELD_WORDING[key].label]), ["treatment", "Treatment"], ["layout", "Layout"], ["alignment", "Alignment"], ["imageFit", "Image fit"]]);
  const summaryOrder: readonly string[] = ["treatment", "layout", "alignment", "imageFit", ...fieldKeys];
  const placement = placementOf(section);
  const mediaKind = mediaKindOf(section);
  const withMedia = admitsMedia(section);
  const saveDisabled = disabled || saving || authority === undefined;
  const saveReason = authority === undefined ? FIELDS_COPY.noAuthority : disabled ? FIELDS_COPY.disabledReason : null;
  const registerMediaAsset = useCallback(
    async (input: MediaRegisterInput): Promise<MediaPickerOutcome> => {
      const operationIdFor = (digest: string): string => {
        const operationId = attemptIdOf(mediaAttempt.current, digest);
        mediaAttempt.current = { operationId, digest };
        return operationId;
      };
      const digest = [input.kind, input.file.name, String(input.file.size), String(input.file.lastModified), input.placement.altText, input.placement.caption ?? "", input.placement.credit ?? "", input.placement.language ?? ""].join("|");
      if (authority === undefined) {
        return unavailable({ operationId: operationIdFor(digest), source: { system: SOURCE_SYSTEM, reference: MEDIA_PATH }, guidance: NO_AUTHORITY_GUIDANCE });
      }
      const bytesBase64 = await readBytesBase64(input.file);
      const language = input.placement.language === undefined || input.placement.language.trim() === "" ? undefined : input.placement.language.trim();
      const descriptor = { altText: input.placement.altText, ...(input.placement.caption === undefined || input.placement.caption === "" ? {} : { caption: input.placement.caption }), ...(input.placement.credit === undefined || input.placement.credit === "" ? {} : { credit: input.placement.credit }) };
      return registerMedia.mutateAsync({
        operationId: operationIdFor(digest),
        scope: authority.scope,
        expectedRevision,
        documentId: authority.documentId,
        payload: {
          kind: input.kind,
          source: { bytesBase64, name: input.file.name },
          altText: descriptor.altText,
          ...(descriptor.caption === undefined ? {} : { caption: descriptor.caption }),
          ...(descriptor.credit === undefined ? {} : { credit: descriptor.credit }),
          ...(language === undefined ? {} : { language }),
          placement: descriptor,
        },
      });
    },
    [authority, expectedRevision, registerMedia],
  );
  const removePlacedMedia = useCallback(
    async ({ placementId }: { readonly placementId: string }): Promise<MediaPickerOutcome> => {
      if (authority === undefined) {
        return unavailable({ operationId: globalThis.crypto.randomUUID(), source: { system: SOURCE_SYSTEM, reference: MEDIA_PATH }, guidance: NO_AUTHORITY_GUIDANCE });
      }
      return removeMedia.mutateAsync({ operationId: globalThis.crypto.randomUUID(), scope: authority.scope, expectedRevision, documentId: authority.documentId, payload: { variantId, placementId } });
    },
    [authority, expectedRevision, removeMedia, variantId],
  );
  function renderField(key: SectionFieldKey): ReactElement {
    const wording = FIELD_WORDING[key];
    const stored = startingValues[key];
    const dateIsCivil = key !== "date" || stored === "" || ISO_CIVIL_DATE.test(stored);
    const description = key === "date" && !dateIsCivil ? `${wording.description} This one is stored as text, so it is shown and edited as text rather than reset to an empty calendar date.` : wording.description;
    return (
      <FormField key={key} label={wording.label} name={key} description={description} error={errors?.byField[key]}>
        {(control) => (
          <form.Field name={key}>
            {(field) => {
              const change = (next: string): void => {
                field.handleChange(next);
                clearSettlement();
              };
              if (wording.control === "long-text") {
                return <Textarea id={control.id} rows={4} value={field.state.value} disabled={disabled} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onChange={(event) => change(event.currentTarget.value)} />;
              }
              return (
                <Input
                  id={control.id}
                  type={wording.control === "date" && dateIsCivil ? "date" : "text"}
                  value={field.state.value}
                  disabled={disabled}
                  aria-describedby={control.describedBy}
                  aria-invalid={control.invalid ? true : undefined}
                  onChange={(event) => change(event.currentTarget.value)}
                  className={key === "language" ? "font-mono" : undefined}
                />
              );
            }}
          </form.Field>
        )}
      </FormField>
    );
  }
  function renderChoice(options: readonly { readonly value: string; readonly label: string; readonly description: string }[], name: "treatment" | "layout", group: { readonly legendId: string; readonly describedBy: string | undefined; readonly invalid: boolean }, isMember: (candidate: string) => boolean): ReactElement {
    const idPrefix = `${name}-options`;
    return (
      <form.Field name={name}>
        {(field) => (
          <RadioGroup
            value={field.state.value}
            disabled={disabled}
            aria-labelledby={group.legendId}
            aria-describedby={group.describedBy}
            aria-invalid={group.invalid ? true : undefined}
            onValueChange={(next) => {
              if (!isMember(next)) {
                return;
              }
              field.handleChange(next);
              clearSettlement();
            }}
          >
            {options.map((option) => {
              const optionId = `${idPrefix}-${option.value}`;
              const hintId = `${optionId}-hint`;
              return (
                <label key={option.value} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                  <RadioGroupItem id={optionId} value={option.value} aria-label={option.label} aria-describedby={hintId} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{option.label}</span>
                    <span id={hintId} className="text-sm text-pretty text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </form.Field>
    );
  }
  function renderSelectControl(id: string, value: string, describedBy: string | undefined, invalid: boolean, options: readonly { readonly value: string; readonly label: string }[], change: (next: string) => void): ReactElement {
    return (
      <NativeSelect id={id} value={value} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid ? true : undefined} onChange={(event) => change(event.currentTarget.value)}>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  function renderSettlement(): ReactElement | null {
    if (saving || settlement === null) {
      return null;
    }
    switch (settlement.kind) {
      case "accepted":
      case "unchanged":
        return null;
      case "conflict":
        return (
          <Alert variant="destructive">
            <AlertTitle>{FIELDS_COPY.conflictTitle}</AlertTitle>
            <AlertDescription>
              <p>{settlement.changedIntent ? "This change reused an earlier attempt's identity with different text, so it was refused instead of applied twice." : `${FIELDS_COPY.conflictBody} ${FIELDS_COPY.startedRevisionLabel}: ${expectedRevision}.`}</p>
              <p>
                {`${FIELDS_COPY.currentRevisionLabel}: `}
                <bdi className="mono-identifier">{settlement.currentRevision}</bdi>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void submit()}>
                {FIELDS_COPY.saveAgain}
              </Button>
            </AlertDescription>
          </Alert>
        );
      case "denied":
        return (
          <Alert variant="destructive">
            <AlertTitle>{FIELDS_COPY.deniedTitle}</AlertTitle>
            <AlertDescription>
              <p>{FIELDS_COPY.deniedBody}</p>
              <p>
                {"Refusal code: "}
                <bdi className="mono-identifier">{settlement.reasonCode}</bdi>
              </p>
            </AlertDescription>
          </Alert>
        );
      case "invalid":
        return null;
      case "unavailable":
        return (
          <Alert>
            <AlertTitle>{FIELDS_COPY.unavailableTitle}</AlertTitle>
            <AlertDescription>
              <p>{settlement.guidance}</p>
              <p>
                {"Source: "}
                <bdi className="mono-identifier">{settlement.sourceSystem}</bdi>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void submit()}>
                {FIELDS_COPY.retrySameChange}
              </Button>
            </AlertDescription>
          </Alert>
        );
      case "unknown":
        return (
          <Alert>
            <AlertTitle>{FIELDS_COPY.unknownTitle}</AlertTitle>
            <AlertDescription>
              <p>{FIELDS_COPY.unknownBody}</p>
              <p>
                {"Operation: "}
                <bdi className="mono-identifier">{settlement.operationId}</bdi>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void submit()}>
                {FIELDS_COPY.retrySameChange}
              </Button>
            </AlertDescription>
          </Alert>
        );
    }
  }
  function renderMedia(): ReactElement | null {
    if (!withMedia) {
      return null;
    }
    const constraints = mediaKind === "image" ? copy.constraints.imageProfile : copy.constraints.videoProfile;
    return (
      <Card size="sm" data-slot="section-fields-media">
        <CardHeader>
          <CardTitle>{MEDIA_COPY.heading}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-pretty text-muted-foreground">{constraints}</p>
          {placement === undefined ? (
            <p className="text-muted-foreground">{MEDIA_COPY.nonePlaced}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="font-medium">{MEDIA_COPY.placedLabel}</p>
              <p className="text-pretty wrap-anywhere">
                <bdi>{placement.altText}</bdi>
              </p>
              {placement.caption === undefined ? null : (
                <p className="text-pretty wrap-anywhere">
                  <bdi>{placement.caption}</bdi>
                </p>
              )}
              {section.placements?.some((candidate) => candidate.kind === mediaKind && candidate.state === "unavailable") === true ? <p className="text-muted-foreground">{MEDIA_COPY.unavailable}</p> : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled || authority === undefined} aria-describedby={authority === undefined ? saveReasonId : undefined} onClick={() => setPickerOpen(true)}>
              {mediaKind === "image" ? MEDIA_COPY.addImage : MEDIA_COPY.addVideo}
            </Button>
          </div>
          <p className="text-muted-foreground">{MEDIA_COPY.mediaLanguageNote}</p>
          <MediaPicker kind={mediaKind} open={pickerOpen} onOpenChange={setPickerOpen} {...(placement === undefined ? {} : { placement })} onRegister={registerMediaAsset} {...(placement === undefined ? {} : { onRemove: removePlacedMedia })} />
        </CardContent>
      </Card>
    );
  }
  return (
    <section dir={direction} data-slot="section-fields" data-section-id={section.sectionId} aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={headingId} className="font-heading text-base font-medium wrap-anywhere">
          <bdi>{copy.catalogue.sections[section.sectionType].label}</bdi>
          {` — ${FIELDS_COPY.heading}`}
        </h3>
        <p className="text-sm text-pretty text-muted-foreground">{FIELDS_COPY.enterNote}</p>
        {saveReason === null ? null : (
          <p id={saveReasonId} className="text-sm text-pretty text-muted-foreground">
            {saveReason}
          </p>
        )}
      </div>
      <FormErrorSummary errors={errors} labels={admittedLabels} order={summaryOrder} headingLevel={4} />
      <form
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {fieldKeys.length === 0 ? null : <div className="flex min-w-0 flex-col gap-5">{fieldKeys.map((key) => renderField(key))}</div>}
        <Separator />
        <div className="flex min-w-0 flex-col gap-5">
          <FormFieldGroup legend="Treatment" name="treatment" error={errors?.byField["treatment"]}>
            {(group) => renderChoice(TREATMENT_OPTIONS, "treatment", group, isTreatment)}
          </FormFieldGroup>
          <FormFieldGroup legend="Layout" name="layout" error={errors?.byField["layout"]}>
            {(group) => renderChoice(LAYOUT_OPTIONS, "layout", group, isLayout)}
          </FormFieldGroup>
          <p className="text-sm text-pretty text-muted-foreground">{copy.presentation.boundedNote}</p>
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start">
            <FormField label="Alignment" name="alignment" error={errors?.byField["alignment"]}>
              {(control) => (
                <form.Field name="alignment">
                  {(field) =>
                    renderSelectControl(control.id, field.state.value, control.describedBy, control.invalid, ALIGNMENT_OPTIONS, (next) => {
                      if (!isAlignment(next)) {
                        return;
                      }
                      field.handleChange(next);
                      clearSettlement();
                    })
                  }
                </form.Field>
              )}
            </FormField>
            {withMedia ? (
              <FormField label="Image fit" name="imageFit" error={errors?.byField["imageFit"]}>
                {(control) => (
                  <form.Field name="imageFit">
                    {(field) =>
                      renderSelectControl(control.id, field.state.value, control.describedBy, control.invalid, IMAGE_FIT_OPTIONS, (next) => {
                        if (!isImageFit(next)) {
                          return;
                        }
                        field.handleChange(next);
                        clearSettlement();
                      })
                    }
                  </form.Field>
                )}
              </FormField>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saveDisabled} aria-describedby={saveReason === null ? undefined : saveReasonId}>
            {saving ? "Saving…" : FIELDS_COPY.save}
          </Button>
          <output data-slot="section-fields-status" className="text-sm text-pretty text-muted-foreground">
            {statusTextOf(saving, settlement)}
          </output>
        </div>
      </form>
      {renderSettlement()}
      {renderMedia()}
    </section>
  );
}

/** The read-only summary a managed section offers in place of a form: what its source supplied, unchanged. */
function ManagedSectionSummary({ section }: { readonly section: PageBuilderSection }): ReactElement {
  const values = admittedFieldKeysOf(section).filter((key) => textOf(section.fields, key).trim() !== "");
  if (values.length === 0) {
    return <p className="text-sm text-pretty">{FIELDS_COPY.managedFallback}</p>;
  }
  return (
    <dl className="flex min-w-0 flex-col gap-1 text-sm">
      {values.map((key) => (
        <div key={key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-muted-foreground">{FIELD_WORDING[key].label}</dt>
          <dd className="wrap-anywhere">
            <bdi>{textOf(section.fields, key)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The field form for one composed section. A section a source owns states its lock and its supplied content in place of
 * any form, because a lock is neither a refusal nor a disabled control: there is nothing here a worker could have changed.
 */
export function SectionFields(props: SectionFieldsProps): ReactElement {
  if (props.section.managed) {
    return (
      <ManagedSectionLock sectionTypeLabel={copy.catalogue.sections[props.section.sectionType].label} reasonKey={managedReasonKeyOf(props.section)} className={props.className}>
        <ManagedSectionSummary section={props.section} />
      </ManagedSectionLock>
    );
  }
  // Keyed by the section so the form opens at that section's own values, with no state carried over from another one.
  return <SectionFieldsForm key={props.section.sectionId} {...props} />;
}

export default SectionFields;
