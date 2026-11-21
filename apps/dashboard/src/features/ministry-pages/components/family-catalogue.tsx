"use client";
/**
 * One family's guided catalogue: the section types its Page family admits, what each one is for, which of
 * them a source owns rather than the author, and the one control that composes a chosen type into a draft
 * edition — or, for a Page that holds no edition yet, the action that starts one.
 *
 * Two contexts, one implementation. Where `target` names the draft edition being composed, every entry a
 * source does not own carries an insertion-position control and an Add action. Where it does not, the
 * entries state what the family offers and the family's single action starts an edition. Both actions pass
 * through the shared review step, which owns the attempt's identity and renders the durable receipt, so a
 * refusal keeps the chosen entry and its position on screen for a retry of the same operation.
 */
import { useCallback, useId, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { copy, type PageFamily } from "../copy";
import { useCreatePageVariant } from "../hooks/use-page-variant-mutations";
import { useAddPageSection, type SectionMutationVariables } from "../hooks/use-section-mutations";
import type { CreateVariantPayload } from "../schemas/release";
import type { AddSectionPayload } from "../schemas/section";
/** The section types a family's catalogue admits, taken from the one module that carries their wording, so a type added there is offered here without a second list. */
type CatalogueSectionType = keyof typeof copy.catalogue.sections;
/** The presentation options one entry admits, exactly as the read carries them: the entry states the bounded set, and its own fields panel is where one option is chosen. */
export type FamilyCataloguePresentation = {
  readonly treatment: readonly (keyof typeof copy.presentation.treatment)[];
  readonly layout: readonly (keyof typeof copy.presentation.layout)[];
  readonly alignment: readonly (keyof typeof copy.presentation.alignment)[];
  readonly imageFit: readonly (keyof typeof copy.presentation.imageFit)[];
};
/** One section type as a family's catalogue lists it: the read's own shape, held to the wording this family keeps for it. */
export type FamilyCatalogueSection = { readonly key: CatalogueSectionType; readonly labelKey: string; readonly managed: boolean; readonly lockReasonKey: string | null; readonly fields: readonly string[]; readonly presentation: FamilyCataloguePresentation };
/** One family's catalogue — the value `readPageCatalogues` answers for a family, never a list written here. The read states the content families it knows, so its own wide union is carried as it arrives; the component's `family` prop is what decides which wording applies. */
export type FamilyCatalogueView = { readonly family: PageFamily | "update"; readonly labelKey: string; readonly sections: readonly FamilyCatalogueSection[] };
/** The draft edition the catalogue composes into: the section count is what bounds an insertion position, and the revision is what the change presents. */
export type FamilyCatalogueTarget = { readonly variantId: string; readonly expectedRevision: string; readonly sectionCount: number };
/** The Page a family's entries belong to: its identity starts and re-reads an edition, its revision is what that change presents, and its language is the edition's. */
export type FamilyCatalogueDocument = { readonly documentId: string; readonly expectedRevision: string; readonly locale?: string };
/** The scope every change is judged in, named by the family's own mutation contract rather than by a second declaration of it. */
type CatalogueScope = SectionMutationVariables<AddSectionPayload>["scope"];
/** What every context of this component shares: the family, its catalogue, the scope, and the caller's own handling of a started Page. */
type FamilyCatalogueSharedProps = { readonly family: PageFamily; readonly catalogue: FamilyCatalogueView; readonly scope: CatalogueScope; readonly onStarted?: (documentId: string) => void; readonly className?: string };
/**
 * A draft context names the edition it composes and the Page that edition belongs to, because a section
 * change is judged against both. An index context may name neither: with no Page named there is nothing to
 * start an edition of and nothing to compose into, so the entries stay descriptive rather than offering an
 * action the service would refuse.
 */
export type FamilyCatalogueProps = FamilyCatalogueSharedProps & ({ readonly target: FamilyCatalogueTarget; readonly document: FamilyCatalogueDocument } | { readonly target?: undefined; readonly document?: FamilyCatalogueDocument | undefined });
/** One composed decision: which catalogue entry, which seat it takes, and the revisions the change presents, frozen when the author asks for it so a later read cannot rewrite what was reviewed. */
type SectionChoice = { readonly sectionType: CatalogueSectionType; readonly afterSectionId: string | null; readonly seat: number; readonly variantId: string; readonly expectedRevision: string };
/**
 * The family's copy module names the entries, the add action and every position option, but not the field
 * label for choosing a seat, the sentence for a catalogue that listed nothing, or the labels of the payload
 * keys a refusal names. Those are this component's own minor wording decisions, so they sit beside the
 * code that shows them.
 */
const POSITION_LABEL = "Where the section goes";
const NO_SECTION_TYPES = "This family's catalogue listed no section types, so there is nothing to compose here. No type is invented in their place.";
const BUILDER_PATH_PREFIX = "/pages/";
const DEFAULT_EDITION_LOCALE = "en";
const FIELD_LABELS: Readonly<Record<string, string>> = { documentId: "Page", locale: copy.editions.localeLabel, audience: "Audience", variantId: "Draft edition", sectionType: "Section type", afterSectionId: POSITION_LABEL };
/** The seats a section can be added at, counted from one. The service inserts a section after a named position, so a draft that already holds sections admits insertion from the second seat onward; the first seat is the one seat an empty draft has. */
function insertionPositions(sectionCount: number): readonly number[] {
  const held = Number.isInteger(sectionCount) && sectionCount > 0 ? sectionCount : 0;
  if (held === 0) return [1];
  return Array.from({ length: held }, (_unused, index) => index + 2);
}
/** The section a new one follows, in the identifier the service resolves: seat n follows the section the draft numbers n-2, and the first seat follows nothing. */
function afterSectionIdOf(seat: number): string | null {
  return seat <= 1 ? null : String(seat - 2);
}
/** The seat an entry's control holds: the author's last choice while it is still offered, and otherwise the seat that appends, so a draft that grew or shrank never leaves a position selected that it no longer has. */
function seatOf(stored: number | undefined, available: readonly number[]): number {
  if (stored !== undefined && available.includes(stored)) return stored;
  return available[available.length - 1] ?? 1;
}
/** The address of the builder for one Page, where a started edition is composed. */
function builderPathOf(documentId: string): string {
  return `${BUILDER_PATH_PREFIX}${encodeURIComponent(documentId)}`;
}
/** Why a source owns one entry, in the copy module's own words, with the generic reason where the entry states no particular one. */
function lockReasonOf(lockReasonKey: string | null): string {
  if (lockReasonKey === null) return copy.lockReasons.genericLockedReason;
  for (const [key, reason] of Object.entries(copy.lockReasons.reasons)) {
    if (key === lockReasonKey) return reason;
  }
  return copy.lockReasons.genericLockedReason;
}
/** The `addSection` payload one choice presents: one catalogue type, in the draft edition it names, after the section it follows. */
function addPayloadOf(choice: SectionChoice): AddSectionPayload {
  return choice.afterSectionId === null ? { variantId: choice.variantId, sectionType: choice.sectionType } : { variantId: choice.variantId, sectionType: choice.sectionType, afterSectionId: choice.afterSectionId };
}
type SectionAddReviewProps = { readonly scope: CatalogueScope; readonly documentId: string; readonly choice: SectionChoice; readonly onCancel: () => void };
/**
 * The reviewed add for one composed decision. It owns the section mutation so the request always names the
 * Page it edits, and it renders only while its choice is the one on screen, so an abandoned decision leaves
 * no attempt behind and a settled one keeps its receipt in front of the author.
 */
function SectionAddReview({ scope, documentId, choice, onCancel }: SectionAddReviewProps): ReactElement {
  const { mutateAsync: addSection } = useAddPageSection();
  const submit = useCallback<MutationSubmit<AddSectionPayload>>(async (input) => addSection({ ...input, documentId }), [addSection, documentId]);
  const entryCopy = copy.catalogue.sections[choice.sectionType];
  return (
    <ActionReview<AddSectionPayload>
      title={`${copy.catalogue.addSectionLabel}: ${entryCopy.label}`}
      description={
        <div className="flex min-w-0 flex-col gap-2">
          <p>
            <bdi>{entryCopy.description}</bdi>
          </p>
          <p>{copy.catalogue.addPrompt}</p>
          <p>{copy.sectionActions.results.added}</p>
        </div>
      }
      confirmLabel={copy.catalogue.addSectionLabel}
      onCancel={onCancel}
      input={{ scope, expectedRevision: choice.expectedRevision, payload: addPayloadOf(choice) }}
      submit={submit}
      fieldLabels={FIELD_LABELS}
      headingLevel={4}
    />
  );
}
export function FamilyCatalogue({ family, catalogue, scope, document: pageDocument, target, onStarted, className }: FamilyCatalogueProps): ReactElement {
  const headingId = useId();
  const entryIdPrefix = useId();
  const router = useRouter();
  const { mutateAsync: createEdition } = useCreatePageVariant();
  const [startRevision, setStartRevision] = useState<string | null>(null);
  const [choice, setChoice] = useState<SectionChoice | null>(null);
  const [seats, setSeats] = useState<Readonly<Record<string, number>>>({});
  const familyCopy = copy.families[family];
  const positions = insertionPositions(target?.sectionCount ?? 0);
  const statedLocale = pageDocument?.locale?.trim() ?? "";
  const editionLocale = statedLocale === "" ? DEFAULT_EDITION_LOCALE : statedLocale;
  const choose = (sectionType: CatalogueSectionType, seat: number): void => {
    if (target === undefined) return;
    setChoice({ sectionType, afterSectionId: afterSectionIdOf(seat), seat, variantId: target.variantId, expectedRevision: target.expectedRevision });
  };
  const selectSeat = (sectionType: CatalogueSectionType, seat: number): void => {
    setSeats((current) => ({ ...current, [sectionType]: seat }));
  };
  return (
    <section aria-labelledby={headingId} data-slot="family-catalogue" data-family={family} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="wrap-anywhere">
              <bdi>{familyCopy.catalogueLabel}</bdi>
            </h2>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">
            <bdi>{familyCopy.description}</bdi>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {target === undefined && pageDocument !== undefined ? (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button type="button" onClick={() => setStartRevision(pageDocument.expectedRevision)}>
                  {copy.states.emptyPagesAction}
                  <span className="sr-only">
                    {": "}
                    <bdi>{familyCopy.label}</bdi>
                  </span>
                </Button>
              </div>
              {startRevision === null ? null : (
                <ActionReview<CreateVariantPayload>
                  title={copy.states.emptyPagesAction}
                  description={
                    <div className="flex min-w-0 flex-col gap-2">
                      <p>
                        <bdi>{familyCopy.description}</bdi>
                      </p>
                      {/* An edition of a Page is public. The approved-supporter audience belongs to an Update and never to a Page, so the action states the one audience it creates. */}
                      <p>{copy.editions.publicEditionsOnly}</p>
                    </div>
                  }
                  confirmLabel={copy.states.emptyPagesAction}
                  onCancel={() => setStartRevision(null)}
                  input={{ scope, expectedRevision: startRevision, payload: { documentId: pageDocument.documentId, locale: editionLocale, audience: "public" } }}
                  submit={createEdition}
                  onSettled={(outcome) => {
                    // A reported result is the only thing that moves the author on: an unconfirmed outcome keeps them here with its receipt.
                    if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") return;
                    onStarted?.(pageDocument.documentId);
                    router.push(builderPathOf(pageDocument.documentId));
                  }}
                  fieldLabels={FIELD_LABELS}
                  headingLevel={3}
                />
              )}
              <Separator />
            </div>
          ) : null}
          {catalogue.sections.length === 0 ? (
            <p className="text-sm text-pretty text-muted-foreground">{NO_SECTION_TYPES}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-4">
              {catalogue.sections.map((entry) => {
                const entryCopy = copy.catalogue.sections[entry.key];
                const selectId = `${entryIdPrefix}-${entry.key}`;
                const seat = seatOf(seats[entry.key], positions);
                // The catalogue is the map of what the family offers, so every entry is listed; only an entry a
                // source does not own, in a draft that names its edition and its Page, can be composed from here.
                const composesHere = !entry.managed && target !== undefined && pageDocument !== undefined;
                return (
                  <li key={entry.key} data-section-type={entry.key} data-managed={entry.managed ? "true" : undefined} className="flex min-w-0 flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="font-heading text-sm font-medium wrap-anywhere">
                        <bdi>{entryCopy.label}</bdi>
                      </h3>
                      {entry.managed ? <Badge variant="secondary">{copy.lockReasons.lockedReadOnlyLabel}</Badge> : null}
                    </div>
                    <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">
                      <bdi>{entryCopy.description}</bdi>
                    </p>
                    {entry.managed ? (
                      <p className="text-xs text-pretty text-muted-foreground wrap-anywhere">
                        <bdi>{lockReasonOf(entry.lockReasonKey)}</bdi>
                      </p>
                    ) : null}
                    {composesHere && target !== undefined && pageDocument !== undefined ? (
                      <div className="flex min-w-0 flex-wrap items-end gap-2">
                        <div className="flex min-w-0 flex-col gap-1">
                          <Label htmlFor={selectId} className="text-xs text-muted-foreground">
                            {POSITION_LABEL}
                            {/* The six controls read the same, so each one also names the section it places: a screen reader hears which entry's position is being chosen, not one of six identical fields. */}
                            <span className="sr-only">
                              {": "}
                              <bdi>{entryCopy.label}</bdi>
                            </span>
                          </Label>
                          <NativeSelect id={selectId} size="sm" value={String(seat)} onChange={(event) => selectSeat(entry.key, Number(event.target.value))}>
                            {positions.map((position) => (
                              <NativeSelectOption key={position} value={String(position)}>
                                {copy.builder.positionOption(position)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => choose(entry.key, seat)}>
                          {copy.catalogue.addSectionLabel}
                          <span className="sr-only">
                            {": "}
                            <bdi>{entryCopy.label}</bdi>
                            {", "}
                            <bdi>{copy.builder.positionOption(seat)}</bdi>
                          </span>
                        </Button>
                      </div>
                    ) : null}
                    {choice !== null && choice.sectionType === entry.key && pageDocument !== undefined ? <SectionAddReview scope={scope} documentId={pageDocument.documentId} choice={choice} onCancel={() => setChoice(null)} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
export default FamilyCatalogue;
