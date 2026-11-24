"use client";
import { useForm } from "@tanstack/react-form";
import { useCallback, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { attemptForIntent, type ReviewedAttempt } from "@/components/attempt";
import { civilDateConvention, FormErrorSummary, FormField, FormFieldGroup, fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
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
import { useEditionAuthority, usePageReread } from "../hooks/page-reads";
import { useRegisterPageMediaAsset, useRemovePagePlacement, useSaveSectionFields } from "../hooks/page-mutations";
import type { SectionFields as SectionFieldValuesByType } from "../schemas/section";
import { ManagedSectionLock } from "./managed-section-lock";
export type PageSectionType = keyof typeof copy.catalogue.sections;
type AdmittedFieldKeys<Type> = Type extends { readonly sectionType: string } ? Exclude<keyof Type, "sectionType"> : never;
export type SectionFieldKey = AdmittedFieldKeys<SectionFieldValuesByType>;
export type SectionPlacement = { readonly placementId: string; readonly kind: MediaPickerKind; readonly altText: string; readonly caption?: string | null; readonly credit?: string | null; readonly state?: "ready" | "unavailable" };
export type PageBuilderSection = {
  readonly sectionId: string;
  readonly sectionType: PageSectionType;
  readonly managed: boolean;
  readonly managedReasonKey?: ManagedFieldKey | null;
  readonly fields: Readonly<Record<string, string>>;
  readonly presentation: PresentationChoice;
  readonly placements?: readonly SectionPlacement[];
};
export type SectionFieldsProps = {
  readonly section: PageBuilderSection;
  readonly variantId: string;
  readonly expectedRevision: string;
  readonly direction: ContentDirection;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly scope?: Parameters<ReturnType<typeof useSaveSectionFields>["mutateAsync"]>[0]["scope"];
  readonly documentId?: string;
  readonly saveState: SectionSaveState | null;
  readonly onSaveStateChange: (next: SectionSaveState) => void;
};
type FieldControlKind = "text" | "long-text" | "date";
const FIELD_WORDING: Readonly<Record<SectionFieldKey, { readonly label: string; readonly description: string; readonly control: FieldControlKind }>> = {
  heading: { label: "Heading", description: "One short line a reader meets first, in plain text.", control: "text" },
  body: { label: "Body", description: "This section's words, in plain text. A blank line separates one paragraph from the next.", control: "long-text" },
  date: { label: "Date", description: "The civil date this milestone belongs to, as a calendar date rather than a moment.", control: "date" },
  altText: { label: "Alternative text", description: "What the media shows, in your words. It is read aloud in place of it.", control: "long-text" },
  caption: { label: "Caption", description: "Shown beneath the media. Leave it empty when it would only repeat the alternative text.", control: "text" },
  credit: { label: "Credit", description: "Who made or supplied this media, as it should read beside it.", control: "text" },
  language: { label: "Language", description: "The language of this media, as a tag such as en or ar-EG. This is the media's language, never the interface's.", control: "text" },
};
const FIELD_ORDER: readonly SectionFieldKey[] = ["heading", "date", "body", "altText", "caption", "credit", "language"];
// The edition's direction is stated on the writing surfaces that hold the worker's own words. A calendar date and a BCP-47 tag are not authored prose, and every label, description, choice and status line around them is the application's own English chrome, so those stay at the interface's direction.
const AUTHORED_TEXT_KEYS: readonly SectionFieldKey[] = ["heading", "body", "altText", "caption", "credit"];
const TREATMENT_OPTIONS = PRESENTATION_CHOICES.treatment.map((value) => ({ value, ...copy.presentation.treatment[value] }));
const LAYOUT_OPTIONS = PRESENTATION_CHOICES.layout.map((value) => ({ value, ...copy.presentation.layout[value] }));
const ALIGNMENT_OPTIONS = PRESENTATION_CHOICES.alignment.map((value) => ({ value, ...copy.presentation.alignment[value] }));
const IMAGE_FIT_OPTIONS = PRESENTATION_CHOICES.imageFit.map((value) => ({ value, ...copy.presentation.imageFit[value] }));
const memberGuard =
  <Member extends string>(admitted: readonly Member[]) =>
  (candidate: string): candidate is Member =>
    (admitted as readonly string[]).includes(candidate);
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
  saved: (revision: string) => `Section saved to this edition's draft at revision ${revision}. Nothing was released.`,
  savedAlready: (revision: string) => `This change had already been saved at revision ${revision}, so nothing was repeated.`,
  unchanged: (revision: string) => `Nothing changed at revision ${revision}, so nothing was saved.`,
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
  changedIntent: "This change reused an earlier attempt's identity with different text, so it was refused instead of applied twice.",
  refusalCodeLabel: "Refusal code",
  sourceLabel: "Source",
  operationLabel: "Operation",
  storedAsText: " This one is stored as text, so it is shown and edited as text rather than reset to an empty calendar date.",
} as const;
const MEDIA_COPY = {
  heading: "Media in this section",
  addImage: "Add an image",
  addVideo: "Add a video",
  manageImage: "Manage this image",
  manageVideo: "Manage this video",
  placedLabel: "Placed in this section",
  unavailable: "The media placed in this section cannot be shown right now, and no address is served in its place.",
  nonePlaced: "No media is placed in this section yet.",
  mediaLanguageNote: "The media's own description is set in the picker; the section's text fields stay separate from it.",
} as const;
const SOURCE_SYSTEM = "data-service";
const MEDIA_PATH = "/api/media";
const NO_AUTHORITY_GUIDANCE = "Open the Page's draft edition again and make the change from there: the context this section was read in is the only one its save may act in.";
const ISO_CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
type SectionFormValues = { readonly [Key in SectionFieldKey]: string } & PresentationChoice;
const textOf = (fields: Readonly<Record<string, string>>, key: SectionFieldKey): string => fields[key] ?? "";
const admittedFieldKeysOf = (section: PageBuilderSection): readonly SectionFieldKey[] => FIELD_ORDER.filter((key) => Object.hasOwn(section.fields, key));
function formValuesOf(section: PageBuilderSection): SectionFormValues {
  const admitted = admittedFieldKeysOf(section);
  const value = (key: SectionFieldKey): string => (admitted.includes(key) ? textOf(section.fields, key) : "");
  return { heading: value("heading"), date: value("date"), body: value("body"), altText: value("altText"), caption: value("caption"), credit: value("credit"), language: value("language"), ...section.presentation };
}
const fieldsOf = (section: PageBuilderSection, values: SectionFormValues): Readonly<Record<string, string>> => Object.fromEntries(admittedFieldKeysOf(section).map((key) => [key, values[key]]));
const presentationOf = (values: SectionFormValues): PresentationChoice => ({ treatment: values.treatment, layout: values.layout, alignment: values.alignment, imageFit: values.imageFit });
const mediaKindOf = (section: PageBuilderSection): MediaPickerKind => (section.sectionType === "video" ? "video" : "image");
const admitsMedia = (keys: readonly SectionFieldKey[]): boolean => keys.includes("altText");
/** One placement as the picker describes it: the identity it is managed by, and the description the picker states beside the file. */ const placementDescriptorOf = (placed: SectionPlacement): MediaPlacement => ({
  placementId: placed.placementId,
  altText: placed.altText,
  ...(placed.caption === undefined || placed.caption === null ? {} : { caption: placed.caption }),
  ...(placed.credit === undefined || placed.credit === null ? {} : { credit: placed.credit }),
});
const MANAGED_REASON_BY_TYPE: Partial<Readonly<Record<PageSectionType, ManagedFieldKey>>> = { giving: "giving-binding", progress: "support-progress" };
const managedReasonKeyOf = (section: PageBuilderSection): ManagedFieldKey => section.managedReasonKey ?? MANAGED_REASON_BY_TYPE[section.sectionType] ?? "source-supplied-section";
function controlNameOf(path: string): string {
  const trimmed = path.startsWith("payload.") ? path.slice("payload.".length) : path;
  return trimmed.startsWith("fields.") ? trimmed.slice("fields.".length) : trimmed.startsWith("presentation.") ? trimmed.slice("presentation.".length) : "";
}
function refusalsByControl(fields: Readonly<Record<string, readonly string[]>>): Readonly<Record<string, readonly string[]>> {
  const byControl = new Map<string, string[]>();
  for (const [path, messages] of Object.entries(fields)) {
    const control = controlNameOf(path);
    const collected = byControl.get(control) ?? [];
    for (const message of messages) if (!collected.includes(message)) collected.push(message);
    byControl.set(control, collected);
  }
  return Object.fromEntries(byControl);
}
export type SaveSettlement =
  | { readonly kind: "accepted"; readonly repeated: boolean; readonly revision: string }
  | { readonly kind: "unchanged"; readonly revision: string }
  | { readonly kind: "conflict"; readonly currentRevision: string; readonly changedIntent: boolean }
  | { readonly kind: "denied"; readonly reasonCode: string }
  | { readonly kind: "invalid"; readonly errors: FieldErrorLookup }
  | { readonly kind: "unavailable"; readonly sourceSystem: string; readonly guidance: string }
  | { readonly kind: "unknown"; readonly operationId: string };
/** The save result one section holds, owned by the builder above the fields pane: the re-read after an accepted save replaces the form to refresh its values, so a result kept inside the form would go with it. It carries the section it belongs to, the settlement last stated, the revision a conflict re-applies against, and the attempt identity a replay after a remount still has to re-present. */
export type SectionSaveState = { readonly sectionId: string; readonly settlement: SaveSettlement | null; readonly reapplyRevision: string | null; readonly attempt: ReviewedAttempt | null };
function settlementOf(outcome: MediaPickerOutcome): SaveSettlement {
  switch (outcome.outcome) {
    case "accepted":
      return { kind: "accepted", repeated: false, revision: outcome.revision };
    case "alreadyAccepted":
      return { kind: "accepted", repeated: true, revision: outcome.revision };
    case "unchanged":
      return { kind: "unchanged", revision: outcome.revision };
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
const SETTLED_STATUS: Readonly<Record<SaveSettlement["kind"], (settlement: SaveSettlement) => string>> = {
  accepted: (settlement) => (settlement.kind === "accepted" ? (settlement.repeated ? FIELDS_COPY.savedAlready(settlement.revision) : FIELDS_COPY.saved(settlement.revision)) : ""),
  unchanged: (settlement) => (settlement.kind === "unchanged" ? FIELDS_COPY.unchanged(settlement.revision) : ""),
  conflict: () => `${FIELDS_COPY.conflictTitle}. ${FIELDS_COPY.conflictBody}`,
  denied: () => `${FIELDS_COPY.deniedTitle}. ${FIELDS_COPY.deniedBody}`,
  invalid: () => FIELDS_COPY.invalidTitle,
  unavailable: (settlement) => (settlement.kind === "unavailable" ? `${FIELDS_COPY.unavailableTitle}. ${settlement.guidance}` : FIELDS_COPY.unavailableTitle),
  unknown: () => FIELDS_COPY.unknownBody,
};
const statusTextOf = (saving: boolean, settlement: SaveSettlement | null): string => (saving ? FIELDS_COPY.saving : settlement === null ? "" : SETTLED_STATUS[settlement.kind](settlement));
type SaveSectionPayloadBody = { readonly variantId: string; readonly sectionId: string; readonly fields: Readonly<Record<string, string>>; readonly presentation: PresentationChoice };
const payloadBodyOf = (section: PageBuilderSection, variantId: string, values: SectionFormValues): SaveSectionPayloadBody => ({ variantId, sectionId: section.sectionId, fields: fieldsOf(section, values), presentation: presentationOf(values) });
const intentDigestOf = (body: SaveSectionPayloadBody): string =>
  JSON.stringify([
    body.variantId,
    body.sectionId,
    Object.keys(body.fields)
      .sort()
      .map((key) => [key, body.fields[key]]),
    body.presentation.treatment,
    body.presentation.layout,
    body.presentation.alignment,
    body.presentation.imageFit,
  ]);
const fileIdentityOf = (file: File | undefined): string => (file === undefined ? "" : `${file.name}:${String(file.size)}:${String(file.lastModified)}`);
/** The intent a removal carries: the edition it detaches from, and the placement it detaches. The revision is deliberately absent, so a retry after the Page is read again submits the same attempt instead of a new one. */
const removalIntentOf = (variantId: string, placementId: string): string => JSON.stringify([variantId, placementId]);
/** One chosen file as its bytes' base64 half, or as its own text for a caption track, which is carried to the service as WebVTT text rather than as bytes. */ const readChosenFile = (file: File, asText: boolean): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The browser could not read the chosen file, so nothing was sent."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error(asText ? "The browser read the chosen file as something other than text, so nothing was sent." : "The browser read the chosen file as something other than a data URL, so nothing was sent."));
      if (asText) return resolve(result);
      const separator = result.indexOf(",");
      resolve(separator === -1 ? "" : result.slice(separator + 1));
    };
    if (asText) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
type SettlementNotice = { readonly title: string; readonly destructive: boolean; readonly body: ReactNode; readonly detail: readonly [string, string]; readonly again: string | null };
function noticeOf(settlement: SaveSettlement, expectedRevision: string): SettlementNotice | null {
  switch (settlement.kind) {
    case "accepted":
    case "unchanged":
    case "invalid":
      return null;
    case "conflict":
      return {
        title: FIELDS_COPY.conflictTitle,
        destructive: true,
        body: settlement.changedIntent ? FIELDS_COPY.changedIntent : `${FIELDS_COPY.conflictBody} ${FIELDS_COPY.startedRevisionLabel}: ${expectedRevision}.`,
        detail: [FIELDS_COPY.currentRevisionLabel, settlement.currentRevision],
        again: FIELDS_COPY.saveAgain,
      };
    case "denied":
      return { title: FIELDS_COPY.deniedTitle, destructive: true, body: FIELDS_COPY.deniedBody, detail: [FIELDS_COPY.refusalCodeLabel, settlement.reasonCode], again: null };
    case "unavailable":
      return { title: FIELDS_COPY.unavailableTitle, destructive: false, body: settlement.guidance, detail: [FIELDS_COPY.sourceLabel, settlement.sourceSystem], again: FIELDS_COPY.retrySameChange };
    case "unknown":
      return { title: FIELDS_COPY.unknownTitle, destructive: false, body: FIELDS_COPY.unknownBody, detail: [FIELDS_COPY.operationLabel, settlement.operationId], again: FIELDS_COPY.retrySameChange };
  }
}
function SectionFieldsForm({ section, variantId, expectedRevision, direction, disabled = false, className, scope, documentId, saveState, onSaveStateChange }: SectionFieldsProps): ReactElement {
  const headingId = useId();
  const saveReasonId = useId();
  const form = useForm({ defaultValues: formValuesOf(section) });
  const provided = useMemo(() => (scope === undefined || documentId === undefined ? undefined : { scope, documentId }), [scope, documentId]);
  const authority = useEditionAuthority(variantId, provided);
  const rereadPage = usePageReread(authority?.documentId);
  const saveSection = useSaveSectionFields();
  const registerMedia = useRegisterPageMediaAsset();
  const removeMedia = useRemovePagePlacement();
  const settlement = saveState?.settlement ?? null;
  const reapplyRevision = saveState?.reapplyRevision ?? null;
  const attempt = saveState?.attempt ?? null;
  const [managing, setManaging] = useState<{ readonly placementId?: string } | null>(null);
  const mediaAttempt = useRef<ReviewedAttempt | null>(null);
  const removalAttempt = useRef<ReviewedAttempt | null>(null);
  const saving = saveSection.isPending;
  const settle = useCallback((next: { readonly settlement: SaveSettlement | null; readonly reapplyRevision: string | null; readonly attempt: ReviewedAttempt | null }): void => onSaveStateChange({ sectionId: section.sectionId, ...next }), [onSaveStateChange, section.sectionId]);
  const clearSettlement = useCallback((): void => {
    if (settlement === null && reapplyRevision === null) return;
    settle({ settlement: null, reapplyRevision: null, attempt });
  }, [attempt, reapplyRevision, settle, settlement]);
  const submit = useCallback(async (): Promise<void> => {
    if (authority === undefined || disabled || saving) return;
    const body = payloadBodyOf(section, variantId, form.state.values);
    const identity = attemptForIntent(attempt, intentDigestOf(body));
    settle({ settlement, reapplyRevision, attempt: identity });
    try {
      const outcome = await saveSection.mutateAsync({ operationId: identity.operationId, scope: authority.scope, expectedRevision: reapplyRevision ?? expectedRevision, documentId: authority.documentId, payload: body });
      const next = settlementOf(outcome);
      settle({ settlement: next, reapplyRevision: next.kind === "conflict" ? next.currentRevision : null, attempt: identity });
      if (next.kind === "conflict") rereadPage();
    } catch {
      settle({ settlement: { kind: "unknown", operationId: identity.operationId }, reapplyRevision, attempt: identity });
    }
  }, [attempt, authority, disabled, expectedRevision, form, reapplyRevision, rereadPage, saveSection, saving, section, settle, settlement, variantId]);
  const errors = settlement !== null && settlement.kind === "invalid" ? settlement.errors : null;
  const fieldKeys = admittedFieldKeysOf(section);
  const admittedLabels: Readonly<Record<string, string | undefined>> = Object.fromEntries([...fieldKeys.map((key) => [key, FIELD_WORDING[key].label]), ["treatment", "Treatment"], ["layout", "Layout"], ["alignment", "Alignment"], ["imageFit", "Image fit"]]);
  const mediaKind = mediaKindOf(section);
  const withMedia = admitsMedia(fieldKeys);
  // The picker is open for exactly one thing at a time: a placement being managed, or a new placement being added.
  const pickerOpenChange = (open: boolean): void => {
    if (!open) setManaging(null);
  };
  const saveReason = authority === undefined ? FIELDS_COPY.noAuthority : disabled ? FIELDS_COPY.disabledReason : null;
  const registerMediaAsset = useCallback(
    async (input: MediaRegisterInput): Promise<MediaPickerOutcome> => {
      const identity = attemptForIntent(
        mediaAttempt.current,
        [input.kind, fileIdentityOf(input.file), input.placement.altText, input.placement.caption ?? "", input.placement.credit ?? "", input.placement.language ?? "", input.placement.transcript ?? "", fileIdentityOf(input.poster?.file), fileIdentityOf(input.captions?.file), input.captions?.label ?? ""].join("|"),
      );
      mediaAttempt.current = identity;
      if (authority === undefined) return unavailable({ operationId: identity.operationId, source: { system: SOURCE_SYSTEM, reference: MEDIA_PATH }, guidance: NO_AUTHORITY_GUIDANCE });
      const language = input.placement.language === undefined || input.placement.language.trim() === "" ? undefined : input.placement.language.trim();
      const transcript = input.placement.transcript === undefined || input.placement.transcript.trim() === "" ? undefined : input.placement.transcript.trim();
      const descriptor = { altText: input.placement.altText, ...(input.placement.caption === undefined || input.placement.caption === "" ? {} : { caption: input.placement.caption }), ...(input.placement.credit === undefined || input.placement.credit === "" ? {} : { credit: input.placement.credit }) };
      return registerMedia.mutateAsync({
        operationId: identity.operationId,
        scope: authority.scope,
        expectedRevision,
        documentId: authority.documentId,
        payload: {
          kind: input.kind,
          source: { bytesBase64: await readChosenFile(input.file, false), name: input.file.name },
          altText: descriptor.altText,
          ...(descriptor.caption === undefined ? {} : { caption: descriptor.caption }),
          ...(descriptor.credit === undefined ? {} : { credit: descriptor.credit }),
          ...(language === undefined ? {} : { language }),
          placement: descriptor,
          ...(input.poster === undefined ? {} : { poster: { bytesBase64: await readChosenFile(input.poster.file, false), name: input.poster.file.name, altText: descriptor.altText } }),
          ...(input.captions === undefined ? {} : { captions: { vtt: await readChosenFile(input.captions.file, true), language: input.captions.language, ...(input.captions.label === undefined ? {} : { label: input.captions.label }) } }),
          ...(transcript === undefined ? {} : { transcript: { text: transcript } }),
          sectionPlacement: { variantId, sectionElement: section.sectionType },
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    },
    [authority, expectedRevision, registerMedia, section.sectionType, variantId],
  );
  const removePlacedMedia = useCallback(
    async ({ placementId }: { readonly placementId: string }): Promise<MediaPickerOutcome> => {
      const identity = attemptForIntent(removalAttempt.current, removalIntentOf(variantId, placementId));
      removalAttempt.current = identity;
      if (authority === undefined) return unavailable({ operationId: identity.operationId, source: { system: SOURCE_SYSTEM, reference: MEDIA_PATH }, guidance: NO_AUTHORITY_GUIDANCE });
      return removeMedia.mutateAsync({ operationId: identity.operationId, scope: authority.scope, expectedRevision, documentId: authority.documentId, payload: { variantId, placementId } });
    },
    [authority, expectedRevision, removeMedia, variantId],
  );
  function renderField(key: SectionFieldKey): ReactElement {
    const wording = FIELD_WORDING[key];
    const authoringDirection = AUTHORED_TEXT_KEYS.includes(key) ? direction : undefined;
    const initial = formValuesOf(section)[key];
    const dateIsCivil = key !== "date" || initial === "" || ISO_CIVIL_DATE.test(initial);
    return (
      <form.Subscribe key={key} selector={(state) => state.values[key]}>
        {(held) => {
          const civilNote = key === "date" ? ` ${civilDateConvention(dateIsCivil ? held : null)}` : "";
          return (
            <FormField label={wording.label} name={key} description={dateIsCivil ? `${wording.description}${civilNote}` : `${wording.description}${FIELDS_COPY.storedAsText}${civilNote}`} error={errors?.byField[key]}>
              {(control) => (
                <form.Field name={key}>
                  {(field) => {
                    const change = (next: string): void => {
                      field.handleChange(next);
                      clearSettlement();
                    };
                    if (wording.control === "long-text") return <Textarea id={control.id} rows={4} value={field.state.value} dir={authoringDirection} disabled={disabled} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onChange={(event) => change(event.currentTarget.value)} />;
                    return (
                      <Input
                        id={control.id}
                        type={wording.control === "date" && dateIsCivil ? "date" : "text"}
                        value={field.state.value}
                        dir={authoringDirection}
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
        }}
      </form.Subscribe>
    );
  }
  function renderChoice(options: readonly { readonly value: string; readonly label: string; readonly description: string }[], name: "treatment" | "layout", group: { readonly legendId: string; readonly describedBy: string | undefined; readonly invalid: boolean }, isMember: (candidate: string) => boolean): ReactElement {
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
              if (!isMember(next)) return;
              field.handleChange(next);
              clearSettlement();
            }}
          >
            {options.map((option) => {
              const optionId = `${name}-options-${option.value}`;
              return (
                <label key={option.value} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                  <RadioGroupItem id={optionId} value={option.value} aria-label={option.label} aria-describedby={`${optionId}-hint`} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{option.label}</span>
                    <span {...{ id: `${optionId}-hint`, className: "type-supporting text-pretty" as const }}>{option.description}</span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </form.Field>
    );
  }
  const selectControl = (control: { readonly id: string; readonly describedBy: string | undefined; readonly invalid: boolean }, value: string, options: readonly { readonly value: string; readonly label: string }[], change: (next: string) => void): ReactElement => (
    <NativeSelect id={control.id} value={value} disabled={disabled} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onChange={(event) => change(event.currentTarget.value)}>
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
  const notice = saving || settlement === null ? null : noticeOf(settlement, expectedRevision);
  function renderMedia(): ReactElement | null {
    if (!withMedia) return null;
    const placements = section.placements ?? [];
    const managed = managing?.placementId === undefined ? undefined : placements.find((candidate) => candidate.placementId === managing.placementId);
    return (
      <Card data-slot="section-fields-media">
        <CardHeader>
          <CardTitle>{MEDIA_COPY.heading}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="type-supporting text-pretty">{mediaKind === "image" ? copy.constraints.imageProfile : copy.constraints.videoProfile}</p>
          {placements.length === 0 ? (
            <p className="type-supporting">{MEDIA_COPY.nonePlaced}</p>
          ) : (
            <ul className="flex min-w-0 list-none flex-col gap-4 p-0">
              {placements.map((placed) => (
                <li key={placed.placementId} data-slot="section-placement" data-kind={placed.kind} data-state={placed.state ?? "ready"} className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium">{MEDIA_COPY.placedLabel}</p>
                  <p className="type-body text-pretty wrap-anywhere">
                    <bdi>{placed.altText}</bdi>
                  </p>
                  {placed.caption === undefined || placed.caption === null ? null : (
                    <p className="type-body text-pretty wrap-anywhere">
                      <bdi>{placed.caption}</bdi>
                    </p>
                  )}
                  {placed.credit === undefined || placed.credit === null ? null : (
                    <p className="type-body text-pretty wrap-anywhere">
                      <bdi>{placed.credit}</bdi>
                    </p>
                  )}
                  {placed.state === "unavailable" ? <p className="type-supporting">{MEDIA_COPY.unavailable}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || authority === undefined}
                      aria-describedby={authority === undefined ? saveReasonId : undefined}
                      aria-label={`${placed.kind === "image" ? MEDIA_COPY.manageImage : MEDIA_COPY.manageVideo}: ${placed.altText}`}
                      onClick={() => setManaging({ placementId: placed.placementId })}
                    >
                      {placed.kind === "image" ? MEDIA_COPY.manageImage : MEDIA_COPY.manageVideo}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled || authority === undefined} aria-describedby={authority === undefined ? saveReasonId : undefined} onClick={() => setManaging({})}>
              {mediaKind === "image" ? MEDIA_COPY.addImage : MEDIA_COPY.addVideo}
            </Button>
          </div>
          <p className="type-supporting">{MEDIA_COPY.mediaLanguageNote}</p>
          <MediaPicker
            kind={managed === undefined ? mediaKind : managed.kind}
            open={managing !== null}
            onOpenChange={pickerOpenChange}
            direction={direction}
            {...(managed === undefined ? {} : { placement: placementDescriptorOf(managed) })}
            onRegister={registerMediaAsset}
            {...(managed === undefined ? {} : { onRemove: removePlacedMedia })}
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <section data-slot="section-fields" data-section-id={section.sectionId} aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={headingId} className="type-subsection-title wrap-anywhere">
          <bdi>{copy.catalogue.sections[section.sectionType].label}</bdi>
          {` — ${FIELDS_COPY.heading}`}
        </h3>
        <p className="type-supporting text-pretty">{FIELDS_COPY.enterNote}</p>
        {saveReason === null ? null : <p {...{ id: saveReasonId, className: "type-supporting text-pretty" as const }}>{saveReason}</p>}
      </div>
      <FormErrorSummary errors={errors} labels={admittedLabels} order={["treatment", "layout", "alignment", "imageFit", ...fieldKeys]} headingLevel={4} />
      <form
        className="flex min-w-0 flex-col gap-6"
        aria-busy={saving ? true : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {fieldKeys.length === 0 ? null : <div className="flex min-w-0 flex-col gap-5">{fieldKeys.map((key) => renderField(key))}</div>}
        <Separator />
        <div className="flex min-w-0 flex-col gap-5">
          <FormFieldGroup {...{ legend: "Treatment" as const, name: "treatment" as const, error: errors?.byField["treatment"] }}>{(group) => renderChoice(TREATMENT_OPTIONS, "treatment", group, isTreatment)}</FormFieldGroup>
          <FormFieldGroup {...{ legend: "Layout" as const, name: "layout" as const, error: errors?.byField["layout"] }}>{(group) => renderChoice(LAYOUT_OPTIONS, "layout", group, isLayout)}</FormFieldGroup>
          <p className="type-supporting text-pretty">{copy.presentation.boundedNote}</p>
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start">
            {[{ name: "alignment" as const, label: "Alignment", options: ALIGNMENT_OPTIONS, admits: isAlignment }, ...(withMedia ? [{ name: "imageFit" as const, label: "Image fit", options: IMAGE_FIT_OPTIONS, admits: isImageFit }] : [])].map((choice) => (
              <FormField key={choice.name} label={choice.label} name={choice.name} error={errors?.byField[choice.name]}>
                {(control) => (
                  <form.Field name={choice.name}>
                    {(field) =>
                      selectControl(control, field.state.value, choice.options, (next) => {
                        if (!choice.admits(next)) return;
                        field.handleChange(next);
                        clearSettlement();
                      })
                    }
                  </form.Field>
                )}
              </FormField>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button {...{ type: "submit" as const, disabled: disabled || saving || authority === undefined, "aria-describedby": saveReason === null ? undefined : saveReasonId }}>{saving ? "Saving…" : FIELDS_COPY.save}</Button>
          <output {...{ "data-slot": "section-fields-status" as const, className: "type-supporting text-pretty" as const }}>{statusTextOf(saving, settlement)}</output>
        </div>
      </form>
      {notice === null ? null : (
        <Alert {...(notice.destructive ? { variant: "destructive" as const } : {})}>
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>
            <p className="type-supporting">{notice.body}</p>
            <p className="type-supporting">
              {`${notice.detail[0]}: `}
              <bdi className="mono-identifier">{notice.detail[1]}</bdi>
            </p>
            {notice.again === null ? null : <Button {...{ type: "button" as const, variant: "outline" as const, size: "sm" as const, onClick: () => void submit() }}>{notice.again}</Button>}
          </AlertDescription>
        </Alert>
      )}
      {renderMedia()}
    </section>
  );
}
function ManagedSectionSummary({ section }: { readonly section: PageBuilderSection }): ReactElement {
  const stated = admittedFieldKeysOf(section).filter((key) => textOf(section.fields, key).trim() !== "");
  if (stated.length === 0) return <p className="type-supporting text-pretty">{FIELDS_COPY.managedFallback}</p>;
  return (
    <dl className="flex min-w-0 flex-col gap-1 type-body">
      {stated.map((key) => (
        <div key={key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="type-supporting">{FIELD_WORDING[key].label}</dt>
          <dd className="wrap-anywhere">
            <bdi>{textOf(section.fields, key)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
/** The field form for one composed section: a section a source owns states its lock and its supplied content in place of any form. */ export function SectionFields(props: SectionFieldsProps): ReactElement {
  if (props.section.managed) {
    return (
      <ManagedSectionLock sectionTypeLabel={copy.catalogue.sections[props.section.sectionType].label} reasonKey={managedReasonKeyOf(props.section)} className={props.className}>
        <ManagedSectionSummary section={props.section} />
      </ManagedSectionLock>
    );
  }
  return <SectionFieldsForm key={props.section.sectionId} {...props} />;
}
export default SectionFields;
