"use client";
import Link from "next/link";
import { useId, useState, type ReactElement } from "react";
import { lifecycleOf } from "@/components/draft-status";
import { StateNotice, type NoticeHeadingLevel } from "@/components/state-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { ContentVariant } from "@/modules/content/variant";
import { PAGE_SECTION_TYPES, type PageSectionType, type ReadEnvelope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { copy, MANAGED_FIELD_KEYS, type ManagedFieldKey, type PageFamily } from "../copy";
import { useGivingBinding, usePage, usePageCatalogues, usePageLocales, usePagePreview, type PageCataloguesData, type PageDetailData, type PageLocalesReadResult, type PagePreviewParams, type PagePreviewReadResult, type PageReadResult } from "../hooks/page-reads";
import FamilyCatalogue, { type FamilyCatalogueView } from "./family-catalogue";
import GivingDesignation, { type GivingBindingView } from "./giving-designation";
import LocaleEditionSwitcher, { type EditionView } from "./locale-edition-switcher";
import PagePreviewFrame, { previewRefusalViewOf, type PagePreviewView } from "./page-preview-frame";
import PresetChooser from "./preset-chooser";
import ReachControl from "./reach-control";
import ReleaseControls, { type ReleaseVariantView } from "./release-controls";
import SectionFields, { type PageBuilderSection as FieldsSection, type SectionPlacement, type SectionSaveState } from "./section-fields";
import SectionOutline, { type PageBuilderSection as OutlineSection } from "./section-outline";
import StopShowingPublicly from "./stop-showing-publicly";
export type PageBuilderView = PageDetailData;
type SectionRecord = PageBuilderView["sections"][number];
type PlacementRecord = SectionRecord["placements"][number];
type EditionRecord = PageBuilderView["editions"][number];
export type PageBuilderSection = OutlineSection & FieldsSection;
const PANES = ["outline", "fields", "preview"] as const;
type Pane = (typeof PANES)[number];
const PANE_LABEL: Readonly<Record<Pane, string>> = { outline: copy.builder.outline, fields: copy.builder.fields, preview: copy.builder.preview };
type BuilderSelection = { readonly locale: string; readonly sectionId: string | null; readonly pane: Pane; readonly releaseVariantIds: readonly string[] };
const NO_DRAFT_DESCRIPTION = "No language edition of this Page holds a saved draft, so there are no sections to change and nothing to preview. The catalogue below starts the first edition; starting one releases nothing and notifies nobody.";
const PREVIEW_LOADING_DESCRIPTION = "The preview of the exact revision on screen is being read. Nothing is released while it is read, and no other edition is shown in its place.";
const GIVING_UNAVAILABLE_TITLE = "The giving placement could not be read";
const DENIED_DESCRIPTION = "The answer is the same whether or not this Page exists, so nothing here states a title, a section, an edition or how many of either there are.";
const REFUSED_DESCRIPTION = "The request this Page was read with is not one the read admits, so nothing was read here and nothing stands in its place.";
const GIVING_LOADING_DESCRIPTION = "The approved giving designation for this Page is being read. No other fund and no default designation is shown in the meantime, and no amount is shown at all.";
const SECTION_CLASS = "flex min-w-0 flex-col gap-4";
const HEADING_CLASS = "type-section-title text-pretty wrap-anywhere";
const NOTE_CLASS = "type-supporting text-pretty wrap-anywhere";
const PREVIEW_LINK_CLASS = "inline-flex min-h-6 w-fit max-w-full min-w-0 items-center text-start text-sm font-medium inline-link text-pretty wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
function otherEditionDescription(composedLocale: string, openLocale: string): string {
  if (composedLocale === "") return `The Page read named no edition to compose, so no section can be changed here. ${openLocale === "" ? "No language edition is open either." : "This edition can still be previewed, reviewed, released and set to its own reach."}`;
  return `The Page read composes the ${composedLocale} draft, so its sections are the ones that can be changed. The ${openLocale === "" ? "edition" : `${openLocale} edition`} you have open can still be previewed, reviewed, released and set to its own reach.`;
}
const isSectionType = (element: string): element is PageSectionType => (PAGE_SECTION_TYPES as readonly string[]).includes(element);
const managedReasonKeyOf = (value: string | null): ManagedFieldKey | null => (value !== null && (MANAGED_FIELD_KEYS as readonly string[]).includes(value) ? (value as ManagedFieldKey) : null);
const placementsOf = (section: SectionRecord): readonly SectionPlacement[] =>
  section.placements.map((placement: PlacementRecord) => ({ placementId: placement.placementId, kind: placement.kind, altText: placement.altText, ...(placement.caption === null ? {} : { caption: placement.caption }), ...(placement.credit === null ? {} : { credit: placement.credit }), state: placement.state }));
function builderSectionOf(section: SectionRecord, position: number): PageBuilderSection | undefined {
  if (!isSectionType(section.element)) return undefined;
  const managedReason = managedReasonKeyOf(section.lockReasonKey);
  return { sectionId: `section-${String(position)}`, sectionType: section.element, managed: section.managed, ...(managedReason === null ? {} : { managedReasonKey: managedReason }), index: position, fields: section.fields, presentation: section.presentation, placements: placementsOf(section) };
}
const sectionsOf = (builder: PageBuilderView): readonly PageBuilderSection[] => builder.sections.flatMap((section, position) => builderSectionOf(section, position) ?? []);
const variantRecordOf = (documentId: string, edition: EditionRecord): ContentVariant => ({
  variantId: edition.variantId,
  documentId,
  audience: edition.audience,
  locale: { tag: edition.locale.tag, direction: edition.locale.direction },
  ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
  ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
  ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
});
const editionViewsOf = (documentId: string, editions: readonly EditionRecord[]): readonly EditionView[] =>
  editions.map((edition) => ({
    locale: edition.locale.tag,
    direction: edition.locale.direction,
    variant: variantRecordOf(documentId, edition),
    ...(edition.headRelease === null ? {} : { release: edition.headRelease }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.candidate === null ? {} : { candidateDecision: edition.candidate.decision }),
  }));
const editionListOf = (localesRead: PageLocalesReadResult | undefined, seed: ReadEnvelope<readonly EditionView[]>, documentId: string, editions: readonly EditionRecord[]): readonly EditionView[] =>
  localesRead === undefined ? seed.data : editionViewsOf(documentId, localesRead.kind === "envelope" ? localesRead.envelope.data.editions : editions);
const releaseVariantsOf = (documentId: string, editions: readonly EditionRecord[]): readonly ReleaseVariantView[] =>
  editions.map((edition) => ({
    variantId: edition.variantId,
    locale: edition.locale.tag,
    lifecycle: lifecycleOf(variantRecordOf(documentId, edition), edition.headRelease ?? undefined, { reviewDecision: edition.candidate?.decision ?? null }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.draftRevisionId === null ? {} : { revisionId: edition.draftRevisionId }),
    ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
  }));
function previewParamsOf(documentId: string, edition: EditionRecord | undefined): PagePreviewParams | undefined {
  const revisionId = edition?.draftRevisionId ?? edition?.headRelease?.revisionId ?? null;
  return edition === undefined || revisionId === null ? undefined : { documentId, variantId: edition.variantId, revisionId, locale: edition.locale.tag };
}
function previewViewOf(result: PagePreviewReadResult): PagePreviewView {
  switch (result.kind) {
    case "envelope": {
      const data = result.envelope.data;
      if (data.status === "authorised") return { status: "authorised", variantId: data.variantId, revisionId: data.revision.revisionId, servedLocale: data.locale.tag, direction: data.locale.direction, html: data.renderedHtml, unreadyMedia: data.unreadyMedia, inert: true, givingAction: "none" };
      if (data.status === "denied") return previewRefusalViewOf(data.reason);
      return { status: "unavailable", source: result.envelope.source };
    }
    case "denied":
      return { status: "denied", reason: result.denied.reasonCode };
    case "unavailable":
      return { status: "unavailable", source: result.unavailable.source };
    case "refused":
      return { status: "refused" };
  }
}
const catalogueOf = (catalogues: PageCataloguesData | undefined, family: PageFamily): FamilyCatalogueView | undefined => catalogues?.catalogues.find((catalogue) => catalogue.family === family);
const openingLocaleOf = (page: ReadEnvelope<PageBuilderView>, seed: ReadEnvelope<readonly EditionView[]>): string => page.data.editions.find((edition) => edition.variantId === (page.data.draft?.variantId ?? ""))?.locale.tag ?? page.data.editions[0]?.locale.tag ?? seed.data[0]?.locale ?? "";
const signatureOf = (section: PageBuilderSection): string => JSON.stringify([section.sectionType, section.fields, section.presentation]);
const paneClass = (pane: Pane, active: Pane): string => cn(SECTION_CLASS, pane === active ? "flex" : "hidden lg:flex");
type Refusal = Exclude<ReadResult<unknown>, { readonly kind: "envelope" }>;
type RefusalWords = { readonly headingLevel: NoticeHeadingLevel; readonly unavailableTitle: string; readonly retryLabel: string; readonly refusedDescription: string };
function refusalNotice(answer: Refusal, words: RefusalWords, retry: () => void, className?: string): ReactElement {
  const placement = className === undefined ? {} : { className };
  switch (answer.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={words.headingLevel} title={copy.states.deniedTitle} description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} {...placement} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={words.headingLevel} title={words.unavailableTitle} description={answer.unavailable.guidance} source={answer.unavailable.source} retry={{ label: words.retryLabel, onClick: retry }} {...placement} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={words.headingLevel} title={copy.states.refusedTitle} description={words.refusedDescription} {...placement} />;
  }
}
const PAGE_REFUSAL: RefusalWords = { headingLevel: 2, unavailableTitle: copy.states.unavailableTitle, retryLabel: "Read this Page again", refusedDescription: REFUSED_DESCRIPTION };
const CATALOGUE_REFUSAL: RefusalWords = { headingLevel: 3, unavailableTitle: "The section catalogue could not be read", retryLabel: "Read the catalogue again", refusedDescription: REFUSED_DESCRIPTION };
const GIVING_REFUSAL: RefusalWords = { headingLevel: 3, unavailableTitle: GIVING_UNAVAILABLE_TITLE, retryLabel: "Read the giving designation again", refusedDescription: "The request for this Page's giving designation is not one that read admits, so this placement states no destination rather than an invented one." };
const LOADING_NOTICE = (headingLevel: NoticeHeadingLevel, title: string, description: string): ReactElement => <StateNotice kind="loading" headingLevel={headingLevel} title={title} description={description} />;
/** The exact, currently authorised, inert preview the route already read for the edition this builder opens on. It is shown until the surface's own preview read answers, and it is never shown for another edition. */
export type PageBuilderProps = { readonly page: ReadEnvelope<PageBuilderView>; readonly locales: ReadEnvelope<readonly EditionView[]>; readonly givingBinding: ReadEnvelope<GivingBindingView>; readonly preview?: PagePreviewView; readonly className?: string };
/** One Page's builder: the language editions it carries, the section outline and field form for the edition the read composes, the exact inert preview of the edition that is open, and the Page-level controls. */
export function PageBuilder({ page, locales, givingBinding, preview, className }: PageBuilderProps): ReactElement {
  const scope = page.scope;
  const documentId = page.data.document.documentId;
  const openingLocale = openingLocaleOf(page, locales);
  const outlineHeadingId = useId();
  const fieldsHeadingId = useId();
  const previewHeadingId = useId();
  const controlsHeadingId = useId();
  const [selection, setSelection] = useState<BuilderSelection>({ locale: openingLocale, sectionId: null, pane: "outline", releaseVariantIds: [] });
  const [sectionSave, setSectionSave] = useState<SectionSaveState | null>(null);
  const pageRead = usePage(scope, documentId);
  const localesRead = usePageLocales(scope, documentId);
  const givingRead = useGivingBinding(scope, documentId);
  const cataloguesRead = usePageCatalogues(scope);
  const pageResult: PageReadResult = pageRead.data ?? { kind: "envelope", envelope: page };
  const readView = pageResult.kind === "envelope" ? pageResult.envelope.data : undefined;
  const editionRecords = readView?.editions ?? [];
  const editionList = editionListOf(localesRead.data, locales, documentId, editionRecords);
  const activeLocale = editionList.some((edition) => edition.locale === selection.locale) ? selection.locale : (editionList[0]?.locale ?? "");
  const activeEdition = editionList.find((edition) => edition.locale === activeLocale);
  const activeRecord = editionRecords.find((edition) => edition.variantId === activeEdition?.variant.variantId);
  const direction = activeEdition?.direction ?? "ltr";
  const draftVariantId = readView?.draft?.variantId ?? "";
  const composedLocale = editionList.find((edition) => edition.variant.variantId === draftVariantId)?.locale ?? "";
  const composingDraft = draftVariantId !== "" && draftVariantId === (activeEdition?.variant.variantId ?? "");
  const draftExpectedRevision = readView?.draft?.recordRevision ?? page.revision;
  const sections = readView === undefined ? [] : sectionsOf(readView);
  const chosenSectionId = selection.sectionId !== null && sections.some((section) => section.sectionId === selection.sectionId) ? selection.sectionId : (sections[0]?.sectionId ?? null);
  const selectedSection = sections.find((section) => section.sectionId === chosenSectionId);
  // One section's save result is ignored while another section is chosen, and choosing another section returns the fields pane to its own unsettled state.
  const selectedSave = sectionSave !== null && sectionSave.sectionId === chosenSectionId ? sectionSave : null;
  const chooseSection = (sectionId: string): void => {
    if (sectionId !== chosenSectionId) setSectionSave(null);
    setSelection((current) => ({ ...current, sectionId }));
  };
  const previewParams = previewParamsOf(documentId, activeRecord);
  const previewSeedApplies = preview !== undefined && (preview.status === "authorised" ? preview.variantId === (activeEdition?.variant.variantId ?? "") : activeLocale === openingLocale);
  const unreleasedPreview: PagePreviewView | undefined = previewParams === undefined && activeLocale !== "" ? { status: "unreleased", locale: activeLocale } : undefined;
  const previewRead = usePagePreview(scope, previewParams);
  const previewFromRead = previewRead.data === undefined ? undefined : previewViewOf(previewRead.data);
  const previewView = previewFromRead ?? (previewSeedApplies ? preview : undefined) ?? unreleasedPreview;
  const rereadGiving = givingRead.refetch;
  if (pageResult.kind !== "envelope") return refusalNotice(pageResult, PAGE_REFUSAL, () => void pageRead.refetch(), className);
  const builder = pageResult.envelope.data;
  // The document record's own revision, as the read that runs again after every accepted write states it: the reach, containment, withdrawal and edition-creation changes all validate that record, so each of them presents this revision rather than one an edition holds.
  const documentRevision = pageResult.envelope.revision;
  const family = builder.family === "update" ? undefined : builder.family;
  if (family === undefined) return <StateNotice kind="refused" headingLevel={2} title={copy.states.refusedTitle} description={"An Update is not a Page: it carries prose and its own media rather than a section catalogue, a reach setting and language editions of its own."} className={className} />;
  const catalogue = catalogueOf(cataloguesRead.data?.kind === "envelope" ? cataloguesRead.data.envelope.data : undefined, family);
  const catalogueDocument = { documentId, expectedRevision: documentRevision, ...(composedLocale === "" ? {} : { locale: composedLocale }) };
  const givingResult = givingRead.data;
  const givingView: ReadEnvelope<GivingBindingView> | undefined = givingResult === undefined ? givingBinding : givingResult.kind === "envelope" ? { ...givingResult.envelope, data: givingResult.envelope.data.binding } : undefined;
  const givingProblem = givingResult === undefined || givingResult.kind === "envelope" ? undefined : givingResult;
  const otherEditionNote = otherEditionDescription(composedLocale, activeLocale);
  const composedAction = composedLocale === "" ? undefined : { label: `Work on the ${composedLocale} draft`, onClick: () => setSelection((current) => ({ ...current, locale: composedLocale })) };
  return (
    <div data-slot="page-builder" data-document-id={documentId} data-family={family} data-locale={activeLocale} data-composing={composingDraft ? "true" : "false"} className={cn("flex min-w-0 flex-col gap-8 text-start", className)}>
      <div className={"order-2 flex min-w-0 flex-col gap-6 lg:order-1"}>
        <div className={SECTION_CLASS}>
          <Badge {...{ variant: "secondary" as const, className: "self-start" as const }}>{copy.families[family].label}</Badge>
          <p className={NOTE_CLASS}>{copy.families[family].description}</p>
          <LocaleEditionSwitcher editions={editionList} selectedLocale={activeLocale} onSelectLocale={(locale) => setSelection((current) => ({ ...current, locale }))} />
        </div>
        <section aria-labelledby={controlsHeadingId} className={SECTION_CLASS}>
          <h2 {...{ id: controlsHeadingId, className: HEADING_CLASS }}>{"Review, release, reach and giving"}</h2>
          <div className={"grid min-w-0 gap-6 lg:grid-cols-2"}>
            <div className={SECTION_CLASS}>
              <p className={NOTE_CLASS}>{"The editions chosen here are the ones a release covers. Each edition reports its own result, and a Page release sends no notice."}</p>
              <ReleaseControls
                scope={scope}
                documentId={documentId}
                documentRevision={documentRevision}
                expectedRevision={activeRecord?.recordRevision ?? page.revision}
                variants={releaseVariantsOf(documentId, editionRecords)}
                selectedVariantIds={selection.releaseVariantIds}
                onSelectionChange={(releaseVariantIds) => setSelection((current) => ({ ...current, releaseVariantIds }))}
              />
            </div>
            <div className={SECTION_CLASS}>
              <ReachControl variantId={activeEdition?.variant.variantId ?? ""} documentId={documentId} scope={scope} expectedRevision={documentRevision} current={activeRecord?.headRelease?.reach ?? null} />
              <Separator />
              <StopShowingPublicly scope={scope} documentId={documentId} expectedRevision={documentRevision} editionCount={editionList.length} />
            </div>
          </div>
          <Separator />
          <div className={SECTION_CLASS}>{givingView === undefined ? givingProblem === undefined ? LOADING_NOTICE(3, GIVING_UNAVAILABLE_TITLE, GIVING_LOADING_DESCRIPTION) : refusalNotice(givingProblem, GIVING_REFUSAL, () => void rereadGiving()) : <GivingDesignation binding={givingView.data} layout="panel" />}</div>
        </section>
      </div>
      <div className={"order-1 flex min-w-0 flex-col gap-4 lg:order-2"}>
        <fieldset className={cn("flex min-w-0 flex-wrap items-center gap-2", "min-w-0 border-0 p-0 lg:hidden")}>
          <legend className="sr-only">{"Which part of this Page to work on"}</legend>
          {PANES.map((pane) => (
            <Button key={pane} type="button" size="sm" variant={selection.pane === pane ? "secondary" : "outline"} aria-pressed={selection.pane === pane} className={"min-h-target max-w-full whitespace-normal"} onClick={() => setSelection((current) => ({ ...current, pane }))}>
              {PANE_LABEL[pane]}
            </Button>
          ))}
        </fieldset>
        <div className={"grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.3fr)]"}>
          <section data-pane="outline" aria-labelledby={outlineHeadingId} className={paneClass("outline", selection.pane)}>
            <h2 {...{ id: outlineHeadingId, className: HEADING_CLASS }}>{copy.builder.outline}</h2>
            {editionList.length === 0 ? (
              <StateNotice kind="empty" headingLevel={3} title={"This Page has no language edition yet"} description={copy.states.emptyEditions} />
            ) : composingDraft ? (
              <>
                <SectionOutline sections={sections} selectedSectionId={chosenSectionId} onSelect={chooseSection} variantId={draftVariantId} expectedRevision={draftExpectedRevision} />
                {builder.sections.filter((section) => !isSectionType(section.element)).length === 0 ? null : <p className={NOTE_CLASS}>{copy.catalogue.outsideCatalogue}</p>}
              </>
            ) : builder.draft === null ? (
              <StateNotice kind="empty" headingLevel={3} title={"This Page has nothing composed yet"} description={NO_DRAFT_DESCRIPTION} />
            ) : (
              <StateNotice kind="empty" headingLevel={3} title={"Sections are composed in one edition at a time"} description={otherEditionNote} action={composedAction} />
            )}
            {catalogue === undefined ? (
              cataloguesRead.data === undefined ? (
                LOADING_NOTICE(3, "Reading the section catalogue", "The catalogue of section types this family offers is being read. The sections already composed are unaffected, and nothing is added while it is read.")
              ) : cataloguesRead.data.kind === "envelope" ? (
                <p className={NOTE_CLASS}>{"The catalogue read answered without a catalogue for this family, so no section type is offered here. None is invented in its place, and the sections already composed are unaffected."}</p>
              ) : (
                refusalNotice(cataloguesRead.data, CATALOGUE_REFUSAL, () => void cataloguesRead.refetch())
              )
            ) : composingDraft ? (
              <FamilyCatalogue family={family} catalogue={catalogue} scope={scope} document={catalogueDocument} target={{ variantId: draftVariantId, expectedRevision: draftExpectedRevision, sectionCount: sections.length }} />
            ) : builder.draft === null ? (
              <FamilyCatalogue family={family} catalogue={catalogue} scope={scope} document={catalogueDocument} />
            ) : null}
            {composingDraft && builder.draft !== null ? <PresetChooser family={family} presets={builder.presets} baseVariantId={draftVariantId} locale={composedLocale} expectedRevision={draftExpectedRevision} scope={scope} documentId={documentId} /> : null}
          </section>
          <section data-pane="fields" aria-labelledby={fieldsHeadingId} className={paneClass("fields", selection.pane)}>
            <h2 {...{ id: fieldsHeadingId, className: HEADING_CLASS }}>{copy.builder.fields}</h2>
            {activeRecord?.translation.status === "stale" ? (
              <Alert>
                <AlertDescription>{copy.editions.translationSourceNote}</AlertDescription>
              </Alert>
            ) : null}
            {!composingDraft ? (
              <p className={NOTE_CLASS}>{builder.draft === null ? NO_DRAFT_DESCRIPTION : otherEditionNote}</p>
            ) : selectedSection === undefined ? (
              <p className={NOTE_CLASS}>{copy.builder.selectSection}</p>
            ) : (
              <SectionFields key={`${selectedSection.sectionId}:${signatureOf(selectedSection)}`} section={selectedSection} variantId={draftVariantId} expectedRevision={draftExpectedRevision} direction={direction} scope={scope} documentId={documentId} saveState={selectedSave} onSaveStateChange={setSectionSave} />
            )}
          </section>
          <section data-pane="preview" aria-labelledby={previewHeadingId} className={paneClass("preview", selection.pane)}>
            <h2 {...{ id: previewHeadingId, className: HEADING_CLASS }}>{copy.builder.preview}</h2>
            {activeLocale === "" ? null : (
              <div className="flex min-w-0 flex-col gap-1">
                <Link {...{ href: `${"/pages/"}${encodeURIComponent(documentId)}/${encodeURIComponent(activeLocale)}${"/preview"}`, className: PREVIEW_LINK_CLASS }}>{copy.builder.openEditionPreview}</Link>
                <p className={NOTE_CLASS}>{copy.builder.openEditionPreviewNote}</p>
              </div>
            )}
            {previewView === undefined ? LOADING_NOTICE(3, "Reading this edition's preview", PREVIEW_LOADING_DESCRIPTION) : <PagePreviewFrame layout="builder" preview={previewView} givingBinding={givingView?.data} retry={{ label: copy.preview.mediaRetryLabel, onClick: () => void previewRead.refetch() }} />}
          </section>
        </div>
      </div>
    </div>
  );
}
export default PageBuilder;
