"use client";
/** The preset chooser for the active family: one catalogue preset composed into the draft edition under the shared review step, and the receipt that records what applying it created. */
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
// The contract module rather than the service barrel: this is a browser surface, and the barrel
// re-exports the named reads and mutations that reach `node:fs`. `PAGE_PRESET_IDS` is the catalogue's
// own list of preset identities, so a preset this surface offers is one the payload schema admits.
import { PAGE_PRESET_IDS, type MutationInput, type PageSectionType, type Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { copy, type CatalogueSectionCopy, type PageFamily } from "../copy";
import { useApplyPagePreset } from "../hooks/use-section-mutations";
import type { applyPresetPayload } from "../schemas/preset";
/** The heading level this surface renders at: it sits inside a builder whose Page heading is above it. */
const HEADING_LEVEL: ReviewHeadingLevel = 3;
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** Three presets are compared at once as a radio group; beyond that the closed choice keeps its shape on a narrow screen. */
const RADIO_GROUP_LIMIT = 3;
const ROOT_CLASS = "flex min-w-0 flex-col gap-4";
const ROW_CLASS = "flex min-h-target min-w-0 items-start gap-3 py-1";
const OPTION_TEXT_CLASS = "flex min-w-0 flex-col items-start gap-0.5";
const LABEL_CLASS = "text-sm font-medium text-pretty wrap-anywhere";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const FACTS_CLASS = "flex min-w-0 flex-col gap-1.5 text-sm";
const FACT_ROW_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2";
const FACT_TERM_CLASS = "text-muted-foreground";
const DISABLED_APPLY_CLASS = "min-h-target max-w-full self-start whitespace-normal";
/**
 * This surface's own structural words. Every sentence about what applying a preset does, and about there
 * being none to offer, comes from `copy` — the family's wording has one owner, and it is not this file.
 */
const SURFACE_COPY = {
  choiceQuestion: "Which preset should this edition start from?",
  proposalHeading: "What this preset proposes",
  presetTerm: "Preset",
  familyTerm: "Family",
  languageTerm: "Language edition",
  draftTerm: "Draft edition",
  partCount: (count: number): string => (count === 1 ? "1 section" : `${String(count)} sections`),
  unavailable: { "no-target": "This edition has no draft yet, so there is nothing for a preset to compose into.", "no-context": "The draft's context is not stated on this surface, so no preset can be applied from here.", disabled: "This edition cannot take a preset right now." },
} as const;
type PresetWithheldReason = keyof typeof SURFACE_COPY.unavailable;
/** The field names a refused `applyPreset` request can report, worded once for the receipt. */
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { presetId: SURFACE_COPY.presetTerm, variantId: SURFACE_COPY.languageTerm, draftRevisionId: SURFACE_COPY.draftTerm };
/**
 * One preset as the Page and catalogue reads supply it: the catalogue's own composition and nothing else.
 * The shape mirrors the read's entries, so a preset that moves there reaches this file as a compile error.
 */
export type PresetView = { readonly presetId: string; readonly sections: readonly PageSectionType[]; readonly creates: "reviewable-draft" };
export interface PresetChooserProps {
  /** Which family catalogue these presets come from: a Worker Page and a Project Page each start from their own. */
  readonly family: PageFamily;
  /** The presets the read supplied. Nothing is added to them here, and an empty list is offered as empty. */
  readonly presets: readonly PresetView[];
  /** The edition whose draft the preset composes into, named because a preset applies to an edition, never to a page. */
  readonly baseVariantId: string;
  /** The exact content locale of that edition, displayed as the read states it. */
  readonly locale: string;
  /** The revision the caller read. Any change presents it, so an edition that moved settles as a conflict rather than being overwritten. */
  readonly expectedRevision: string;
  /** Whether this edition admits a section change at all, as the builder decided. Disabling it here states the same fact preventively. */
  readonly disabled?: boolean;
  /**
   * The context the command is submitted in. Optional because a builder that has not resolved the draft
   * renders this chooser with the change withheld and the reason stated, rather than sending a change it
   * cannot scope — the same way the Page read stays idle without a document identifier.
   */
  readonly scope?: Scope;
  /** The Page the settled attempt re-reads, keyed by document in the section transport. */
  readonly documentId?: string;
  readonly className?: string;
}
/** One attempt's identity-less input: what the review step holds while its receipt stands. */
type PresetIntent = Omit<MutationInput<applyPresetPayload>, "operationId">;
/** One offered preset, paired with the catalogue's wording for each section it proposes. */
type PresetOffer = { readonly preset: PresetView; readonly sections: readonly CatalogueSectionCopy[] };
/** Whether a preset identity is one the payload schema admits, so no request carries a preset the catalogue never proposed. */
function isAdmittedPresetId(value: string): value is applyPresetPayload["presetId"] {
  return (PAGE_PRESET_IDS as readonly string[]).includes(value);
}
/** The catalogue's wording for each section a preset proposes, or `null` when the family catalogue cannot describe one. */
function sectionsOf(preset: PresetView): readonly CatalogueSectionCopy[] | null {
  const described: CatalogueSectionCopy[] = [];
  for (const type of preset.sections) {
    const entry: CatalogueSectionCopy | undefined = copy.catalogue.sections[type];
    if (entry === undefined) {
      return null;
    }
    described.push(entry);
  }
  return described.length === 0 ? null : described;
}
/** The presets this surface may offer: an identity the schema admits, with every proposed section described by the catalogue. */
function offersOf(presets: readonly PresetView[]): readonly PresetOffer[] {
  return presets.flatMap<PresetOffer>((preset) => {
    if (!isAdmittedPresetId(preset.presetId)) {
      return [];
    }
    const sections = sectionsOf(preset);
    return sections === null ? [] : [{ preset, sections }];
  });
}
/** A preset named by the sections it proposes, which is the whole of what the catalogue says about it. */
function presetLabel(offer: PresetOffer): string {
  return offer.sections.map((section) => section.label).join(" · ");
}
/** The sections one preset adds, described with the catalogue's own wording for each. */
function ProposalList({ offer }: { readonly offer: PresetOffer }): ReactElement {
  return (
    <ul data-slot="preset-proposal" className="flex min-w-0 flex-col gap-2">
      {offer.sections.map((section, position) => (
        <li key={`${offer.preset.presetId}-${String(position)}`} className="flex min-w-0 flex-col gap-0.5 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium wrap-anywhere">
              <bdi>{section.label}</bdi>
            </span>
            {section.managed ? <Badge variant="secondary">{copy.lockReasons.lockedReadOnlyLabel}</Badge> : null}
          </span>
          <span className="min-w-0 text-pretty text-muted-foreground wrap-anywhere">{section.description}</span>
        </li>
      ))}
    </ul>
  );
}
/** The preset chooser for the active family, and the one step that applies a preset. */
export function PresetChooser({ family, presets, baseVariantId, locale, expectedRevision, disabled = false, scope, documentId, className }: PresetChooserProps): ReactElement {
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
  // The first offered preset is the one shown as chosen before the worker picks another. Showing it
  // applies nothing: only the reviewed action below submits, and it submits only when confirmed.
  const chosen = offers.find((offer) => offer.preset.presetId === chosenId) ?? offers[0] ?? null;
  const selectedPresetId = chosen === null ? null : chosen.preset.presetId;
  const variantId = baseVariantId.trim();
  const revision = expectedRevision.trim();
  const documentIdValue = documentId?.trim() ?? "";
  const payload = useMemo<applyPresetPayload | null>(() => {
    if (selectedPresetId === null || !isAdmittedPresetId(selectedPresetId) || variantId === "") {
      return null;
    }
    // The edition and the preset are the whole of this payload: there is no member here for how far an
    // edition reaches, for a notice, or for an amount, so applying a preset cannot make anything publicly
    // readable and cannot send anything. The locale travels with the variant named here rather than being
    // repeated, so a preset cannot compose into one language edition while its own label claims another.
    // The discriminant is the payload schema's own default, as the sibling section schemas do it, so this
    // control builds the change and nothing else.
    return { presetId: selectedPresetId, variantId };
  }, [selectedPresetId, variantId]);
  const withheld: PresetWithheldReason | null = disabled ? "disabled" : variantId === "" || revision === "" ? "no-target" : scope === undefined || documentIdValue === "" ? "no-context" : null;
  const liveInput = useMemo<PresetIntent | null>(() => (payload === null || scope === undefined ? null : { scope, expectedRevision: revision, payload }), [payload, scope, revision]);
  // A settled attempt advances the edition's revision, and the builder beside this surface then re-reads
  // it. Holding the input that was submitted keeps the receipt in place across that re-read: the review
  // step shows a result only while the input it is handed is the one it reviewed. Choosing a different
  // preset begins a new attempt with its own identity, which is what a second preset needs.
  const carriesReceipt = settled !== null && submitted !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged" || settled.outcome === "unknown") && submitted.payload.presetId === payload?.presetId;
  const input = carriesReceipt && submitted !== null ? submitted : liveInput;
  const showsReview = input !== null && (withheld === null || settled !== null);
  const submit = useCallback<MutationSubmit<applyPresetPayload>>(
    async (attempt: MutationInput<applyPresetPayload>): Promise<MutationOutcome> => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      // The section transport keys its re-read by document, so the Page this surface belongs to travels
      // with the four-field input rather than being guessed from the payload inside the hook.
      return mutateAsync({ operationId: attempt.operationId, scope: attempt.scope, expectedRevision: attempt.expectedRevision, documentId: documentIdValue, payload: attempt.payload });
    },
    [mutateAsync, documentIdValue],
  );
  const Heading = HEADING_TAG[HEADING_LEVEL];
  const applyWithheld =
    withheld === null ? null : (
      <div className="flex min-w-0 flex-col gap-3">
        <Alert role={undefined}>
          <AlertDescription id={withheldId}>{SURFACE_COPY.unavailable[withheld]}</AlertDescription>
        </Alert>
        {showsReview ? null : (
          <Button type="button" variant="outline" disabled aria-describedby={withheldId} className={DISABLED_APPLY_CLASS}>
            {copy.preset.apply}
          </Button>
        )}
      </div>
    );
  return (
    <section data-slot="preset-chooser" data-family={family} data-preset-count={String(offers.length)} data-selected-preset={selectedPresetId ?? undefined} data-withheld={withheld ?? undefined} aria-labelledby={headingId} className={cn(ROOT_CLASS, className)}>
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <Heading id={headingId}>{copy.preset.heading}</Heading>
          </CardTitle>
          <CardDescription className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <bdi>{copy.families[family].label}</bdi>
            <bdi className="mono-identifier">{locale}</bdi>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <p className={SENTENCE_CLASS}>{copy.preset.applyNote}</p>
          {offers.length === 0 ? (
            <div className="flex min-w-0 flex-col gap-3">
              <Alert role={undefined}>
                <AlertDescription id={emptyId}>{copy.preset.emptyReason}</AlertDescription>
              </Alert>
              <Button type="button" variant="outline" disabled aria-describedby={emptyId} className={DISABLED_APPLY_CLASS}>
                {copy.preset.apply}
              </Button>
            </div>
          ) : (
            <>
              {offers.length <= RADIO_GROUP_LIMIT ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <p id={questionId} className="text-sm font-medium text-pretty">
                    {SURFACE_COPY.choiceQuestion}
                  </p>
                  <RadioGroup
                    value={selectedPresetId ?? ""}
                    onValueChange={(next) => {
                      if (typeof next !== "string") {
                        return;
                      }
                      setChosenId(next);
                    }}
                    aria-labelledby={questionId}
                    aria-describedby={proposalId}
                    disabled={disabled}
                  >
                    {offers.map((offer) => {
                      const optionId = `${choicesId}-${offer.preset.presetId}`;
                      return (
                        <label key={offer.preset.presetId} htmlFor={optionId} className={ROW_CLASS}>
                          <RadioGroupItem id={optionId} value={offer.preset.presetId} className="mt-0.5" />
                          <span className={OPTION_TEXT_CLASS}>
                            <span className={LABEL_CLASS}>
                              <bdi>{presetLabel(offer)}</bdi>
                            </span>
                            <Badge variant="outline">{SURFACE_COPY.partCount(offer.sections.length)}</Badge>
                          </span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor={choicesId} className="min-h-target">
                    {SURFACE_COPY.choiceQuestion}
                  </Label>
                  <NativeSelect
                    id={choicesId}
                    value={selectedPresetId ?? ""}
                    onChange={(event) => {
                      setChosenId(event.target.value);
                    }}
                    aria-describedby={proposalId}
                    disabled={disabled}
                    className="w-full min-w-0"
                  >
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
                    <p id={proposalHeadingId} className="text-sm font-medium">
                      {SURFACE_COPY.proposalHeading}
                    </p>
                    <ProposalList offer={chosen} />
                  </section>
                </>
              )}
              {applyWithheld}
            </>
          )}
        </CardContent>
      </Card>
      {showsReview && input !== null ? (
        <ActionReview<applyPresetPayload>
          title={copy.preset.apply}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              {/* The family's wording owns what a preset creates, and this step states the facts beside it:
                  which family, which edition, which preset and how many sections — copy.ts holds no
                  parameterised "a new reviewable draft from <preset>" sentence, so none is coined here. */}
              <dl className={FACTS_CLASS}>
                <div className={FACT_ROW_CLASS}>
                  <dt className={FACT_TERM_CLASS}>{SURFACE_COPY.familyTerm}</dt>
                  <dd className="min-w-0">
                    <bdi>{copy.families[family].label}</bdi>
                  </dd>
                </div>
                <div className={FACT_ROW_CLASS}>
                  <dt className={FACT_TERM_CLASS}>{SURFACE_COPY.languageTerm}</dt>
                  <dd className="min-w-0">
                    <bdi className="mono-identifier">{locale}</bdi>
                  </dd>
                </div>
                {chosen === null ? null : (
                  <>
                    <div className={FACT_ROW_CLASS}>
                      <dt className={FACT_TERM_CLASS}>{SURFACE_COPY.presetTerm}</dt>
                      <dd className="min-w-0">
                        <bdi>{presetLabel(chosen)}</bdi>
                      </dd>
                    </div>
                    <div className={FACT_ROW_CLASS}>
                      <dt className={FACT_TERM_CLASS}>{SURFACE_COPY.proposalHeading}</dt>
                      <dd className="min-w-0">
                        <bdi>{SURFACE_COPY.partCount(chosen.sections.length)}</bdi>
                      </dd>
                    </div>
                  </>
                )}
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
