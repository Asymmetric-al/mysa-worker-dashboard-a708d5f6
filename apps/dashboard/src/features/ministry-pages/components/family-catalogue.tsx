"use client";
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
import { useAddPageSection, useCreatePageVariant, type SectionMutationVariables } from "../hooks/page-mutations";
import type { CreateVariantPayload } from "../schemas/release";
import type { AddSectionPayload } from "../schemas/section";
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
type CatalogueScope = SectionMutationVariables<AddSectionPayload>["scope"];
type FamilyCatalogueSharedProps = { readonly family: PageFamily; readonly catalogue: FamilyCatalogueView; readonly scope: CatalogueScope; readonly onStarted?: (documentId: string) => void; readonly className?: string };
/** A draft context names the edition it composes and the Page that edition belongs to, because a section change is judged against both. */
export type FamilyCatalogueProps = FamilyCatalogueSharedProps & ({ readonly target: FamilyCatalogueTarget; readonly document: FamilyCatalogueDocument } | { readonly target?: undefined; readonly document?: FamilyCatalogueDocument | undefined });
type SectionChoice = { readonly sectionType: CatalogueSectionType; readonly afterSectionId: string | null; readonly seat: number; readonly variantId: string; readonly expectedRevision: string };
const POSITION_LABEL = "Where the section goes";
const FIELD_LABELS: Readonly<Record<string, string>> = { documentId: "Page", locale: copy.editions.localeLabel, audience: "Audience", variantId: "Draft edition", sectionType: "Section type", afterSectionId: POSITION_LABEL };
const insertionPositions = (sectionCount: number): readonly number[] => (Number.isInteger(sectionCount) && sectionCount > 0 ? Array.from({ length: sectionCount }, (_unused, index) => index + 2) : [1]);
const afterSectionIdOf = (seat: number): string | null => (seat <= 1 ? null : String(seat - 2));
const seatOf = (stored: number | undefined, available: readonly number[]): number => (stored !== undefined && available.includes(stored) ? stored : (available[available.length - 1] ?? 1));
/** The one address a Page is composed at, so the catalogue and the index that opens it cannot state two paths. */
export const builderPathOf = (documentId: string): string => `${"/pages/"}${encodeURIComponent(documentId)}`;
const lockReasonOf = (lockReasonKey: string | null): string => (lockReasonKey === null ? undefined : Object.entries(copy.lockReasons.reasons).find(([key]) => key === lockReasonKey)?.[1]) ?? copy.lockReasons.genericLockedReason;
const addPayloadOf = (choice: SectionChoice): AddSectionPayload => (choice.afterSectionId === null ? { variantId: choice.variantId, sectionType: choice.sectionType } : { variantId: choice.variantId, sectionType: choice.sectionType, afterSectionId: choice.afterSectionId });
type SectionAddReviewProps = { readonly scope: CatalogueScope; readonly documentId: string; readonly choice: SectionChoice; readonly onCancel: () => void };
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
          <p>{copy.catalogue.addPrompt}</p> <p>{copy.sectionActions.results.added}</p>
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
  const choose = (sectionType: CatalogueSectionType, seat: number): void => {
    if (target === undefined) return;
    setChoice({ sectionType, afterSectionId: afterSectionIdOf(seat), seat, variantId: target.variantId, expectedRevision: target.expectedRevision });
  };
  const selectSeat = (sectionType: CatalogueSectionType, seat: number): void => setSeats((current) => ({ ...current, [sectionType]: seat }));
  return (
    <section aria-labelledby={headingId} data-slot="family-catalogue" data-family={family} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="type-section-title wrap-anywhere">
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
                      <p>{copy.editions.publicEditionsOnly}</p>
                    </div>
                  }
                  confirmLabel={copy.states.emptyPagesAction}
                  onCancel={() => setStartRevision(null)}
                  input={{ scope, expectedRevision: startRevision, payload: { documentId: pageDocument.documentId, locale: (pageDocument?.locale?.trim() ?? "") === "" ? "en" : (pageDocument?.locale?.trim() ?? ""), audience: "public" } }}
                  submit={createEdition}
                  onSettled={(outcome) => {
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
            <p className="type-supporting text-pretty">{"This family's catalogue listed no section types, so there is nothing to compose here. No type is invented in their place."}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-4">
              {catalogue.sections.map((entry) => {
                const entryCopy = copy.catalogue.sections[entry.key];
                const selectId = `${entryIdPrefix}-${entry.key}`;
                const seat = seatOf(seats[entry.key], positions);
                return (
                  <li key={entry.key} data-section-type={entry.key} data-managed={entry.managed ? "true" : undefined} className="flex min-w-0 flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="type-subsection-title wrap-anywhere">
                        <bdi>{entryCopy.label}</bdi>
                      </h3>
                      {entry.managed ? <Badge variant="secondary">{copy.lockReasons.lockedReadOnlyLabel}</Badge> : null}
                    </div>
                    <p className="type-supporting text-pretty wrap-anywhere">
                      <bdi>{entryCopy.description}</bdi>
                    </p>
                    {entry.managed ? (
                      <p className="text-xs text-pretty text-muted-foreground wrap-anywhere">
                        <bdi>{lockReasonOf(entry.lockReasonKey)}</bdi>
                      </p>
                    ) : null}
                    {!entry.managed && target !== undefined && pageDocument !== undefined ? (
                      <div className="flex min-w-0 flex-wrap items-end gap-2">
                        <div className="flex min-w-0 flex-col gap-1">
                          <Label htmlFor={selectId} className="text-xs text-muted-foreground">
                            {POSITION_LABEL}
                            <span className="sr-only">
                              {": "}
                              <bdi>{entryCopy.label}</bdi>
                            </span>
                          </Label>
                          <NativeSelect id={selectId} value={String(seat)} onChange={(event) => selectSeat(entry.key, Number(event.target.value))}>
                            {positions.map((position) => (
                              <NativeSelectOption key={position} value={String(position)}>
                                {copy.builder.positionOption(position)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                        <Button type="button" variant="outline" onClick={() => choose(entry.key, seat)}>
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
