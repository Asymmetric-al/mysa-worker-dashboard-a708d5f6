"use client";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { factFrame } from "@/components/fact-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { PAGE_PRESET_IDS, type MutationInput, type PageSectionType, type Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { copy, type CatalogueSectionCopy, type PageFamily } from "../copy";
import { useApplyPagePreset } from "../hooks/page-mutations";
import type { applyPresetPayload } from "../schemas/preset";
const HEADING_LEVEL: ReviewHeadingLevel = 3;
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The one type scale's heading utility per level, so this chooser states the level it lands at with the same measure on every surface. */ const HEADING_SCALE: Readonly<Record<keyof typeof HEADING_TAG, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
/** The section count this surface states, so the draft's own count and a preset's count read with one measure. */ const partCount = (count: number): string => (count === 1 ? "1 section" : `${String(count)} sections`);
const SURFACE_COPY = {
  choiceQuestion: "Choose a starting template",
  proposalHeading: "Included sections",
  presetTerm: "Template",
  familyTerm: "Page type",
  languageTerm: "Language",
  draftTerm: "Draft edition",
  draftSectionsTerm: "Current draft",
  partCount,
  replacementNote: (draftSectionCount: number, presetSectionCount: number): string =>
    draftSectionCount === 0 ? `Starts this empty draft with ${partCount(presetSectionCount)}.` : `Replaces your current ${partCount(draftSectionCount)} with ${partCount(presetSectionCount)}.`,
  unavailable: { "no-target": "Create a draft for this edition before applying a template.", "no-context": "Template actions aren’t available on this screen.", disabled: "Templates can’t be applied right now." },
} as const;
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { presetId: SURFACE_COPY.presetTerm, variantId: SURFACE_COPY.languageTerm, draftRevisionId: SURFACE_COPY.draftTerm };
export type PresetView = { readonly presetId: string; readonly sections: readonly PageSectionType[]; readonly creates: "reviewable-draft" };
export type PresetChooserProps = {
  readonly family: PageFamily;
  readonly presets: readonly PresetView[];
  readonly baseVariantId: string;
  readonly locale: string;
  readonly expectedRevision: string;
  readonly sectionCount: number;
  readonly disabled?: boolean;
  readonly scope?: Scope;
  readonly documentId?: string;
  readonly className?: string;
};
type PresetIntent = Omit<MutationInput<applyPresetPayload>, "operationId">;
type PresetOffer = { readonly preset: PresetView; readonly sections: readonly CatalogueSectionCopy[] };
const isAdmittedPresetId = (value: string): value is applyPresetPayload["presetId"] => (PAGE_PRESET_IDS as readonly string[]).includes(value);
function sectionsOf(preset: PresetView): readonly CatalogueSectionCopy[] | null {
  const described: CatalogueSectionCopy[] = [];
  for (const type of preset.sections) {
    const entry: CatalogueSectionCopy | undefined = copy.catalogue.sections[type];
    if (entry === undefined) return null;
    described.push(entry);
  }
  return described.length === 0 ? null : described;
}
const offersOf = (presets: readonly PresetView[]): readonly PresetOffer[] =>
  presets.flatMap<PresetOffer>((preset) => {
    if (!isAdmittedPresetId(preset.presetId)) return [];
    const sections = sectionsOf(preset);
    return sections === null ? [] : [{ preset, sections }];
  });
const presetLabel = (offer: PresetOffer): string => offer.sections.map((section) => section.label).join(" · ");
const ProposalList = ({ offer }: { readonly offer: PresetOffer }): ReactElement => (
  <ul data-slot="preset-proposal" className="flex min-w-0 flex-col gap-2">
    {offer.sections.map((section, position) => (
      <li key={`${offer.preset.presetId}-${String(position)}`} className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <bdi className="font-medium wrap-anywhere">{section.label}</bdi>
          {section.managed ? <Badge variant="secondary">{copy.lockReasons.lockedReadOnlyLabel}</Badge> : null}
        </span>
        <span className="min-w-0 text-pretty text-muted-foreground wrap-anywhere">{section.description}</span>
      </li>
    ))}
  </ul>
);
const FactRow = factFrame({ rowClassName: "flex min-w-0 flex-wrap items-baseline gap-x-2", termClassName: "text-muted-foreground", valueClassName: "min-w-0" });
/** A withheld or empty offer states its reason, then the apply control it cannot offer, so the reason is never separated from it. */ const WithheldNotice = ({ id, body, offersButton }: { readonly id: string; readonly body: string; readonly offersButton: boolean }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-3">
    <Alert role={undefined}>
      <AlertDescription id={id}>{body}</AlertDescription>
    </Alert>
    {offersButton ? <Button {...{ type: "button" as const, variant: "outline" as const, disabled: true as const, "aria-describedby": id, className: "min-h-target max-w-full self-start whitespace-normal" }}>{copy.preset.apply}</Button> : null}
  </div>
);
/** The preset chooser for the active family, and the one step that applies a preset. */ export function PresetChooser({ family, presets, baseVariantId, locale, expectedRevision, sectionCount, disabled = false, scope, documentId, className }: PresetChooserProps): ReactElement {
  const { mutateAsync } = useApplyPagePreset();
  const headingId = useId();
  const questionId = useId();
  const proposalId = useId();
  const proposalHeadingId = useId();
  const emptyId = useId();
  const withheldId = useId();
  const choicesId = useId();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<PresetIntent | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const offers = useMemo(() => offersOf(presets), [presets]);
  const chosen = offers.find((offer) => offer.preset.presetId === chosenId) ?? offers[0] ?? null;
  const selectedPresetId = chosen === null ? null : chosen.preset.presetId;
  const variantId = baseVariantId.trim();
  const revision = expectedRevision.trim();
  const documentIdValue = documentId?.trim() ?? "";
  const payload = useMemo<applyPresetPayload | null>(() => {
    return selectedPresetId === null || !isAdmittedPresetId(selectedPresetId) || variantId === "" ? null : { presetId: selectedPresetId, variantId };
  }, [selectedPresetId, variantId]);
  const withheld: keyof typeof SURFACE_COPY.unavailable | null = disabled ? "disabled" : variantId === "" || revision === "" ? "no-target" : scope === undefined || documentIdValue === "" ? "no-context" : null;
  const liveInput = useMemo<PresetIntent | null>(() => (payload === null || scope === undefined ? null : { scope, expectedRevision: revision, payload }), [payload, scope, revision]);
  const input = settled !== null && submitted !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged" || settled.outcome === "unknown") && submitted.payload.presetId === payload?.presetId && submitted !== null ? submitted : liveInput;
  const showsReview = input !== null && (withheld === null || settled !== null);
  const submit = useCallback<MutationSubmit<applyPresetPayload>>(
    async (attempt: MutationInput<applyPresetPayload>): Promise<MutationOutcome> => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      return mutateAsync({ operationId: attempt.operationId, scope: attempt.scope, expectedRevision: attempt.expectedRevision, documentId: documentIdValue, payload: attempt.payload });
    },
    [mutateAsync, documentIdValue],
  );
  const Heading = HEADING_TAG[HEADING_LEVEL];
  const reviewFacts = [
    { term: SURFACE_COPY.familyTerm, value: <bdi>{copy.families[family].label}</bdi> },
    { term: SURFACE_COPY.languageTerm, value: <bdi className="mono-identifier">{locale}</bdi> },
    { term: SURFACE_COPY.draftSectionsTerm, value: <bdi>{SURFACE_COPY.partCount(sectionCount)}</bdi> },
    ...(chosen === null
      ? []
      : [
          { term: SURFACE_COPY.presetTerm, value: <bdi>{presetLabel(chosen)}</bdi> },
          { term: SURFACE_COPY.proposalHeading, value: <bdi>{SURFACE_COPY.partCount(chosen.sections.length)}</bdi> },
        ]),
  ];
  return (
    <section data-slot="preset-chooser" data-family={family} data-preset-count={String(offers.length)} data-selected-preset={selectedPresetId ?? undefined} data-withheld={withheld ?? undefined} aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <Card>
        <CardHeader>
          <CardTitle>
            <Heading {...{ id: headingId, className: HEADING_SCALE[HEADING_LEVEL] }}>{copy.preset.heading}</Heading>
          </CardTitle>
          <CardDescription className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <bdi>{copy.families[family].label}</bdi>
            <bdi className="mono-identifier">{locale}</bdi>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <p className={"text-sm text-pretty text-muted-foreground"}>{copy.preset.applyNote}</p>
          {offers.length === 0 ? (
            <WithheldNotice id={emptyId} body={copy.preset.emptyReason} offersButton />
          ) : (
            <>
              {offers.length <= 3 ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <p {...{ id: questionId, className: "type-group-title text-pretty" as const }}>{SURFACE_COPY.choiceQuestion}</p>
                  <RadioGroup
                    value={selectedPresetId ?? ""}
                    onValueChange={(next) => {
                      if (typeof next !== "string") return;
                      setChosenId(next);
                    }}
                    aria-labelledby={questionId}
                    aria-describedby={proposalId}
                    disabled={disabled}
                  >
                    {offers.map((offer) => {
                      const optionId = `${choicesId}-${offer.preset.presetId}`;
                      return (
                        <label key={offer.preset.presetId} htmlFor={optionId} className={"flex min-h-target min-w-0 items-start gap-3 py-1"}>
                          <RadioGroupItem id={optionId} value={offer.preset.presetId} className="mt-0.5" />
                          <span className={"flex min-w-0 flex-col items-start gap-0.5"}>
                            <bdi className={"type-group-title text-pretty wrap-anywhere"}>{presetLabel(offer)}</bdi>
                            <Badge variant="outline">{SURFACE_COPY.partCount(offer.sections.length)}</Badge>
                          </span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label {...{ htmlFor: choicesId, className: "min-h-target" as const }}>{SURFACE_COPY.choiceQuestion}</Label>
                  <NativeSelect id={choicesId} value={selectedPresetId ?? ""} onChange={(event) => setChosenId(event.target.value)} aria-describedby={proposalId} disabled={disabled} className="w-full min-w-0">
                    {offers.map((offer) => (
                      <NativeSelectOption key={offer.preset.presetId} value={offer.preset.presetId}>{`${presetLabel(offer)} · ${SURFACE_COPY.partCount(offer.sections.length)}`}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}
              {chosen === null ? null : (
                <>
                  <Separator />
                  <section id={proposalId} aria-labelledby={proposalHeadingId} className="flex min-w-0 flex-col gap-2">
                    <p {...{ id: proposalHeadingId, className: "type-group-title" as const }}>{SURFACE_COPY.proposalHeading}</p>
                    <ProposalList offer={chosen} />
                    <p className={"text-sm text-pretty text-muted-foreground"}>{SURFACE_COPY.replacementNote(sectionCount, chosen.sections.length)}</p>
                  </section>
                </>
              )}
              {withheld === null ? null : <WithheldNotice id={withheldId} body={SURFACE_COPY.unavailable[withheld]} offersButton={!showsReview} />}
            </>
          )}
        </CardContent>
      </Card>
      {showsReview && input !== null ? (
        <ActionReview<applyPresetPayload>
          title={copy.preset.apply}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <dl className={"flex min-w-0 flex-col gap-1.5 text-sm"}>
                {reviewFacts.map((fact) => (
                  <FactRow key={fact.term} term={fact.term}>
                    {fact.value}
                  </FactRow>
                ))}
              </dl>
              <p>{copy.preset.applyNote}</p>
            </div>
          }
          confirmLabel={copy.preset.apply}
          input={input}
          submit={submit}
          onSettled={setSettled}
          fieldLabels={FIELD_LABELS}
          headingLevel={HEADING_LEVEL}
        />
      ) : null}
    </section>
  );
}
export default PresetChooser;
