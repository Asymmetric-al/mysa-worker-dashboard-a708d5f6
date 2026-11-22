"use client";
/**
 * The builder composition for one Worker or Project Page: the language editions it carries, the section outline and the
 * field form for the edition being composed, the exact inert preview beside them, and the Page-level controls — the
 * preset chooser, review and release, reach, containment, and the one approved giving Designation.
 *
 * What this file owns, and what it does not. It owns layout, selection, and the plumbing of the read envelopes into the
 * family's read hooks. Every concern it shows already has exactly one implementation: the outline, the field form, the
 * preview frame, the family catalogue, the preset chooser, the release controls, the reach control, the containment
 * action and the giving panel are all children. It therefore mints no operation id, issues no request of its own, holds
 * no copy of a record, recomputes no lifecycle, reach value, permission or revision, and offers no notification: a Page
 * release sends no notice, so no sending control belongs anywhere in this composition.
 *
 * Selection is the whole of the local state — which language edition is open, which section's fields are shown, which
 * pane a narrow screen shows, and which editions are chosen for release. Everything else is read from the service, so a
 * changed record is re-read rather than patched here.
 *
 * Where each read comes from. The route hands this surface the envelopes a server render already produced; each one
 * seeds the first paint and the sibling hook that owns that read takes over as soon as it answers, so a mutation's
 * invalidation re-reads instead of leaving a stale envelope on screen. A refusal and an outage are rendered as the
 * answers they are — never as an empty builder and never as a zero.
 */
import { useId, useState, type ReactElement } from "react";
import { lifecycleOf } from "@/components/draft-status";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { Reach } from "@/modules/content/reach";
import type { ContentVariant } from "@/modules/content/variant";
import { PAGE_SECTION_TYPES, type PageSectionType, type ReadEnvelope } from "@/modules/data-service/envelope";
import { copy, MANAGED_FIELD_KEYS, type ManagedFieldKey, type PageFamily } from "../copy";
import { useGivingBinding, type GivingBindingReadResult } from "../hooks/use-giving-binding";
import { usePage, type PageDetailData, type PageReadResult } from "../hooks/use-page";
import { usePageCatalogues, type PageCataloguesData, type PageCataloguesRead } from "../hooks/use-page-catalogues";
import { usePageLocales, type PageLocalesReadResult } from "../hooks/use-page-locales";
import { usePagePreview, type PagePreviewParams, type PagePreviewReadResult } from "../hooks/use-page-preview";
import FamilyCatalogue, { type FamilyCatalogueView } from "./family-catalogue";
import GivingDesignation, { type GivingBindingView } from "./giving-designation";
import LocaleEditionSwitcher, { type EditionView } from "./locale-edition-switcher";
import PagePreviewFrame, { type PagePreviewView } from "./page-preview-frame";
import PresetChooser from "./preset-chooser";
import ReachControl from "./reach-control";
import ReleaseControls, { type ReleaseVariantView } from "./release-controls";
import SectionFields, { type PageBuilderSection as FieldsSection, type SectionPlacement } from "./section-fields";
import SectionOutline, { type PageBuilderSection as OutlineSection } from "./section-outline";
import StopShowingPublicly from "./stop-showing-publicly";

// ---------------------------------------------------------------------------------------------
// The shapes this surface reads, taken from the reads themselves
// ---------------------------------------------------------------------------------------------

/** One Page as `readPage` states it: the document, its locked fields, its giving binding, the composed draft, the
 * sections of that draft, the presets, every language edition and the reach values those releases may carry. */
export type PageBuilderView = PageDetailData;

/** One section as the Page read states it, with its catalogue element, plain-text fields, presentation and media. */
type SectionRecord = PageBuilderView["sections"][number];

/** One media placement as the Page read states it: the rendition the section shows, and whether it can be shown. */
type PlacementRecord = SectionRecord["placements"][number];

/** One language edition as the Page read states it: its own three pointers, its head release, its reach and its
 * translation record. This is the list the reach, release and preview facts come from. */
type EditionRecord = PageBuilderView["editions"][number];

/** One section as both the outline and the field form read it: the identity a change addresses, the catalogue type it
 * was composed from, its fields and presentation, and the media it places. */
export type PageBuilderSection = OutlineSection & FieldsSection;

/** The three panes of the builder. A wide screen shows all three; a narrow one shows the chosen pane, and only that. */
const PANES = ["outline", "fields", "preview"] as const;

type Pane = (typeof PANES)[number];

/** Which region a narrow screen shows, in this family's own words for the three panes. */
const PANE_LABEL: Readonly<Record<Pane, string>> = { outline: copy.builder.outline, fields: copy.builder.fields, preview: copy.builder.preview };

/** Everything this surface holds locally, and nothing else: which edition, which section, which pane, which editions
 * are chosen for a release. No record, revision, permission or count is ever copied into it. */
interface BuilderSelection {
  /** The language edition the worker is working on, as its exact content locale tag. */
  readonly locale: string;
  /** The section whose fields are shown, or `null` before one is chosen. */
  readonly sectionId: string | null;
  /** The pane a narrow screen shows. */
  readonly pane: Pane;
  /** The language editions explicitly chosen for a release. */
  readonly releaseVariantIds: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Wording this surface states for itself
//
// Every sentence about what an action does comes from the family's copy module. These are the names of regions and the
// statements about this surface's own state, which the copy module does not carry because no other surface shows them.
// ---------------------------------------------------------------------------------------------

const CONTROLS_HEADING = "Review, release, reach and giving";

const PANE_SWITCHER_LABEL = "Which part of this Page to work on";

const NO_EDITION_TITLE = "This Page has no language edition yet";

const NO_DRAFT_TITLE = "This Page has nothing composed yet";

const NO_DRAFT_DESCRIPTION = "No language edition of this Page holds a saved draft, so there are no sections to change and nothing to preview. The catalogue below starts the first edition; starting one releases nothing and notifies nobody.";

const OTHER_EDITION_TITLE = "Sections are composed in one edition at a time";

const PREVIEW_LOADING_TITLE = "Reading this edition's preview";

const PREVIEW_LOADING_DESCRIPTION = "The preview of the exact revision on screen is being read. Nothing is released while it is read, and no other edition is shown in its place.";

const RELEASE_EDITIONS_NOTE = "The editions chosen here are the ones a release covers. Each edition reports its own result, and a Page release sends no notice.";

const GIVING_UNAVAILABLE_TITLE = "The giving placement could not be read";

/** Why the field form is withheld while another edition is open: the read composes one edition, and saying so is
 * honest where editing under another edition's header would not be. */
function otherEditionDescription(composedLocale: string, openLocale: string): string {
  if (composedLocale === "") return `The Page read named no edition to compose, so no section can be changed here. ${openLocale === "" ? "No language edition is open either." : "This edition can still be previewed, reviewed, released and set to its own reach."}`;
  return `The Page read composes the ${composedLocale} draft, so its sections are the ones that can be changed. The ${openLocale === "" ? "edition" : `${openLocale} edition`} you have open can still be previewed, reviewed, released and set to its own reach.`;
}

function openComposedDraftLabel(composedLocale: string): string {
  return `Work on the ${composedLocale} draft`;
}

// ---------------------------------------------------------------------------------------------
// Small readings of the records
//
// Each of these selects a member the read already stated. None of them derives a lifecycle, a reach value, a
// permission or a count, and none of them writes anything.
// ---------------------------------------------------------------------------------------------

/** Whether a stored element is one of the eight section types the catalogue admits. */
function isSectionType(element: string): element is PageSectionType {
  return (PAGE_SECTION_TYPES as readonly string[]).includes(element);
}

/** The lock reason a managed section states, when the read names one the copy module has the words for. */
function managedReasonKeyOf(value: string | null): ManagedFieldKey | null {
  if (value === null) return null;
  return (MANAGED_FIELD_KEYS as readonly string[]).includes(value) ? (value as ManagedFieldKey) : null;
}

/** The identity a section change addresses. The service resolves a section by its position in the edition, stated as
 * `section-<index>`, so the builder names a section the same way rather than inventing an identity the service cannot
 * resolve. */
function sectionIdOf(position: number): string {
  return `section-${String(position)}`;
}

/** The media a section places, as the field form reads it: the rendition's own identity, its kind, its description and
 * whether it can be shown. */
function placementsOf(section: SectionRecord): readonly SectionPlacement[] {
  return section.placements.map((placement: PlacementRecord) => ({ placementId: placement.placementId, kind: placement.kind, altText: placement.altText, ...(placement.caption === null ? {} : { caption: placement.caption }), ...(placement.credit === null ? {} : { credit: placement.credit }), state: placement.state }));
}

/** One section as the outline and the field form read it, or `undefined` where the stored element is not one this
 * family's catalogue admits — such a section is never shown in another style, and the fact that it exists is stated in
 * words instead. */
function builderSectionOf(section: SectionRecord, position: number): PageBuilderSection | undefined {
  if (!isSectionType(section.element)) return undefined;
  const managedReason = managedReasonKeyOf(section.lockReasonKey);
  return { sectionId: sectionIdOf(position), sectionType: section.element, managed: section.managed, ...(managedReason === null ? {} : { managedReasonKey: managedReason }), index: position, fields: section.fields, presentation: section.presentation, placements: placementsOf(section) };
}

/** The sections of the composed draft that this family's catalogue admits, in the order a reader meets them. */
function sectionsOf(builder: PageBuilderView): readonly PageBuilderSection[] {
  const sections: PageBuilderSection[] = [];
  builder.sections.forEach((section, position) => {
    const mapped = builderSectionOf(section, position);
    if (mapped !== undefined) sections.push(mapped);
  });
  return sections;
}

/** How many sections of the composed draft are of a type this family's catalogue does not offer. */
function outsideCatalogueCountOf(builder: PageBuilderView): number {
  return builder.sections.filter((section) => !isSectionType(section.element)).length;
}

/** The edition's own record as the lifecycle vocabulary reads it: its three pointers, its audience and its language,
 * and nothing added. */
function variantRecordOf(documentId: string, edition: EditionRecord): ContentVariant {
  return {
    variantId: edition.variantId,
    documentId,
    audience: edition.audience,
    locale: { tag: edition.locale.tag, direction: edition.locale.direction },
    // An absent pointer is omitted rather than set to `undefined`, so the record states exactly what the read stated.
    ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
  };
}

/** The editions the switcher lists, built from the Page read's own edition records. */
function editionViewsOf(documentId: string, editions: readonly EditionRecord[]): readonly EditionView[] {
  return editions.map((edition) => ({ locale: edition.locale.tag, direction: edition.locale.direction, variant: variantRecordOf(documentId, edition), ...(edition.headRelease === null ? {} : { release: edition.headRelease }), ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }) }));
}

/** The editions this surface works on: the locale read's own list once it answers, the server's list while it is
 * pending, and the Page read's editions when that read refused — so one edition list is shown either way. */
function editionListOf(localesRead: PageLocalesReadResult | undefined, seed: ReadEnvelope<readonly EditionView[]>, documentId: string, editions: readonly EditionRecord[]): readonly EditionView[] {
  if (localesRead === undefined) return seed.data;
  if (localesRead.kind === "envelope") return editionViewsOf(documentId, localesRead.envelope.data.editions);
  return editionViewsOf(documentId, editions);
}

/** The reach a released edition carries now, or `null` when it has no release to carry one. */
function reachOf(edition: EditionRecord | undefined): Reach | null {
  return edition?.headRelease?.reach ?? null;
}

/** One edition as the release controls read it: its own lifecycle, the draft revision a review would freeze, and the
 * candidate a release would publish. */
function releaseVariantsOf(documentId: string, editions: readonly EditionRecord[]): readonly ReleaseVariantView[] {
  return editions.map((edition) => {
    const lifecycle = lifecycleOf(variantRecordOf(documentId, edition), edition.headRelease ?? undefined);
    return {
      variantId: edition.variantId,
      locale: edition.locale.tag,
      lifecycle,
      ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
      ...(edition.draftRevisionId === null ? {} : { revisionId: edition.draftRevisionId }),
      ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
    };
  });
}

/** The acknowledged revision a preview of this edition renders: its saved draft when it has one, and otherwise the
 * revision its head release published. With neither there is nothing exact to render, which is not a refusal. */
function previewParamsOf(documentId: string, edition: EditionRecord | undefined): PagePreviewParams | undefined {
  if (edition === undefined) return undefined;
  const revisionId = edition.draftRevisionId ?? edition.headRelease?.revisionId ?? null;
  if (revisionId === null) return undefined;
  return { documentId, variantId: edition.variantId, revisionId, locale: edition.locale.tag };
}

/** The preview frame's own answers, taken from what the preview read stated. The markup is the one renderer's output
 * for the acknowledged revision, placed unchanged; this mapping renames nothing and authorises nothing. */
function previewViewOf(result: PagePreviewReadResult): PagePreviewView {
  switch (result.kind) {
    case "envelope": {
      const data = result.envelope.data;
      switch (data.status) {
        case "authorised":
          return { status: "authorised", variantId: data.variantId, revisionId: data.revision.revisionId, servedLocale: data.locale.tag, direction: data.locale.direction, html: data.renderedHtml, inert: true, givingAction: "none" };
        case "denied":
          return { status: "denied", reason: data.reason };
        default:
          // A stored revision the one renderer cannot read is the source failing to supply it, not this caller's
          // refusal, so it is named as the source that could not answer.
          return { status: "unavailable", source: result.envelope.source };
      }
    }
    case "denied":
      return { status: "denied", reason: result.denied.reasonCode };
    case "unavailable":
      return { status: "unavailable", source: result.unavailable.source };
    case "refused":
      return { status: "refused" };
  }
}

/** The catalogue one family is offered, once the catalogue read answered with an envelope. */
function catalogueOf(catalogues: PageCataloguesData | undefined, family: PageFamily): FamilyCatalogueView | undefined {
  return catalogues?.catalogues.find((catalogue) => catalogue.family === family);
}

/** The locale this surface opens on: the edition the read named as its draft, and otherwise the first edition the
 * Page holds. Nothing is guessed when the Page holds no edition at all. */
function openingLocaleOf(page: ReadEnvelope<PageBuilderView>, seed: ReadEnvelope<readonly EditionView[]>): string {
  const draftVariantId = page.data.draft?.variantId ?? "";
  const drafted = page.data.editions.find((edition) => edition.variantId === draftVariantId);
  if (drafted !== undefined) return drafted.locale.tag;
  return page.data.editions[0]?.locale.tag ?? seed.data[0]?.locale ?? "";
}

/** What a section's record holds now, so the field form is keyed by it: a change made to this very section opens its
 * own values, while work typed here survives a pane or edition switch unchanged. */
function signatureOf(section: PageBuilderSection): string {
  return JSON.stringify([section.sectionType, section.fields, section.presentation]);
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

const ROOT_CLASS = "flex min-w-0 flex-col gap-8 text-start";
const HEADER_REGION_CLASS = "order-2 flex min-w-0 flex-col gap-6 lg:order-1";
const HEADER_GRID_CLASS = "grid min-w-0 gap-6 lg:grid-cols-2";
const PANES_REGION_CLASS = "order-1 flex min-w-0 flex-col gap-4 lg:order-2";
const PANE_GRID_CLASS = "grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.3fr)]";
const SECTION_CLASS = "flex min-w-0 flex-col gap-4";
const HEADING_CLASS = "font-heading text-lg font-medium text-pretty wrap-anywhere";
const NOTE_CLASS = "text-sm text-pretty text-muted-foreground wrap-anywhere";
const SWITCHER_CLASS = "flex min-w-0 flex-wrap items-center gap-2";
const TOGGLED_CLASS = "min-h-target max-w-full whitespace-normal";

/** The pane a narrow screen shows, with every pane kept mounted: an unmounted field form would take the work typed into
 * it with it, which is exactly the re-entry this surface must never ask for. */
function paneClass(pane: Pane, active: Pane): string {
  return cn(SECTION_CLASS, pane === active ? "flex" : "hidden lg:flex");
}

// ---------------------------------------------------------------------------------------------
// What a refusal states
//
// A denial, an outage and a refused request are three different answers, and each is rendered as the one it is: a
// denial carries no title, count or existence hint, an outage names the source that could not answer, and a refused
// request says the request was the fault.
// ---------------------------------------------------------------------------------------------

const DENIED_DESCRIPTION = "The answer is the same whether or not this Page exists, so nothing here states a title, a section, an edition or how many of either there are.";

const REFUSED_DESCRIPTION = "The request this Page was read with is not one the read admits, so nothing was read here and nothing stands in its place.";

const PAGE_RETRY_LABEL = "Read this Page again";

const UPDATES_ARE_NOT_PAGES = "An Update is not a Page: it carries prose and its own media rather than a section catalogue, a reach setting and language editions of its own.";

const CATALOGUE_UNAVAILABLE_TITLE = "The section catalogue could not be read";

const CATALOGUE_LOADING_TITLE = "Reading the section catalogue";

const CATALOGUE_LOADING_DESCRIPTION = "The catalogue of section types this family offers is being read. The sections already composed are unaffected, and nothing is added while it is read.";

const CATALOGUE_WITHOUT_FAMILY = "The catalogue read answered without a catalogue for this family, so no section type is offered here. None is invented in its place, and the sections already composed are unaffected.";

const CATALOGUE_RETRY_LABEL = "Read the catalogue again";

const GIVING_LOADING_DESCRIPTION = "The approved giving designation for this Page is being read. No other fund and no default designation is shown in the meantime, and no amount is shown at all.";

const GIVING_RETRY_LABEL = "Read the giving designation again";

const GIVING_REFUSED_DESCRIPTION = "The request for this Page's giving designation is not one that read admits, so this placement states no destination rather than an invented one.";

function pageAnswerNotice(answer: Exclude<PageReadResult, { readonly kind: "envelope" }>, retry: () => void, className: string | undefined): ReactElement {
  switch (answer.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={copy.states.deniedTitle} description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} className={className} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={copy.states.unavailableTitle} description={answer.unavailable.guidance} source={answer.unavailable.source} retry={{ label: PAGE_RETRY_LABEL, onClick: retry }} className={className} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={copy.states.refusedTitle} description={REFUSED_DESCRIPTION} className={className} />;
  }
}

type CatalogueAnswer = PageCataloguesRead;

function catalogueAnswerNotice(answer: CatalogueAnswer | undefined, retry: () => void): ReactElement {
  if (answer === undefined) {
    return <StateNotice kind="loading" headingLevel={3} title={CATALOGUE_LOADING_TITLE} description={CATALOGUE_LOADING_DESCRIPTION} />;
  }
  switch (answer.kind) {
    case "envelope":
      return <p className={NOTE_CLASS}>{CATALOGUE_WITHOUT_FAMILY}</p>;
    case "denied":
      return <StateNotice kind="denied" headingLevel={3} title={copy.states.deniedTitle} description={DENIED_DESCRIPTION} reasonCode={answer.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={3} title={CATALOGUE_UNAVAILABLE_TITLE} description={answer.unavailable.guidance} source={answer.unavailable.source} retry={{ label: CATALOGUE_RETRY_LABEL, onClick: retry }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={3} title={copy.states.refusedTitle} description={REFUSED_DESCRIPTION} />;
  }
}

type GivingProblem = GivingBindingReadResult;

function givingAnswerNotice(problem: Exclude<GivingProblem, { readonly kind: "envelope" }> | undefined, retry: () => void): ReactElement {
  if (problem === undefined) {
    return <StateNotice kind="loading" headingLevel={3} title={GIVING_UNAVAILABLE_TITLE} description={GIVING_LOADING_DESCRIPTION} />;
  }
  switch (problem.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={3} title={copy.states.deniedTitle} description={DENIED_DESCRIPTION} reasonCode={problem.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={3} title={GIVING_UNAVAILABLE_TITLE} description={problem.unavailable.guidance} source={problem.unavailable.source} retry={{ label: GIVING_RETRY_LABEL, onClick: retry }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={3} title={copy.states.refusedTitle} description={GIVING_REFUSED_DESCRIPTION} />;
  }
}

/** Props of {@link PageBuilder}. */
export interface PageBuilderProps {
  /** The Page as `readPage` answered it — the document, its locked fields, its giving binding, the composed draft, that
   * draft's sections, the presets, every language edition and the reach values a release may carry. */
  readonly page: ReadEnvelope<PageBuilderView>;
  /** The language editions as `readPageLocales` answered them, each with its own draft, candidate, release and
   * direction. */
  readonly locales: ReadEnvelope<readonly EditionView[]>;
  /** The one approved giving Designation this Page may show, or the stated reason there is none. */
  readonly givingBinding: ReadEnvelope<GivingBindingView>;
  /** The exact, currently authorised, inert preview the route already read for the edition this builder opens on. It is
   * shown until the surface's own preview read answers, and it is never shown for another edition. */
  readonly preview?: PagePreviewView;
  readonly className?: string;
}

/**
 * One Page's builder: the language editions it carries, the section outline and field form for the edition the read
 * composes, the exact inert preview of the edition that is open, and the Page-level controls for review, release, reach,
 * containment and giving.
 */
export function PageBuilder({ page, locales, givingBinding, preview, className }: PageBuilderProps): ReactElement {
  const scope = page.scope;
  const documentId = page.data.document.documentId;
  const openingLocale = openingLocaleOf(page, locales);
  const outlineHeadingId = useId();
  const fieldsHeadingId = useId();
  const controlsHeadingId = useId();
  // The whole of the local state: which edition, which section, which pane, and which editions a release covers.
  const [selection, setSelection] = useState<BuilderSelection>({ locale: openingLocale, sectionId: null, pane: "outline", releaseVariantIds: [] });
  // The reads whose answers can change under this surface. Each hook owns its own cache entry, so an accepted mutation
  // invalidates the read that owns the record instead of leaving a stale envelope on screen.
  const pageRead = usePage(scope, documentId);
  const localesRead = usePageLocales(scope, documentId);
  const givingRead = useGivingBinding(scope, documentId);
  const cataloguesRead = usePageCatalogues(scope);
  // The Page the surface renders: the route's own envelope until the browser read answers, and that read's answer from
  // then on. A refusal is rendered as the answer it is rather than as an empty builder.
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
  // The read composes one edition — the one holding its saved draft — so the section panes act on that edition only.
  const composingDraft = draftVariantId !== "" && draftVariantId === (activeEdition?.variant.variantId ?? "");
  const draftExpectedRevision = readView?.draft?.recordRevision ?? page.revision;
  const sections = readView === undefined ? [] : sectionsOf(readView);
  const chosenSectionId = selection.sectionId !== null && sections.some((section) => section.sectionId === selection.sectionId) ? selection.sectionId : (sections[0]?.sectionId ?? null);
  const selectedSection = sections.find((section) => section.sectionId === chosenSectionId);
  const previewParams = previewParamsOf(documentId, activeRecord);
  const previewRead = usePagePreview(scope, previewParams);
  const previewFromRead = previewRead.data === undefined ? undefined : previewViewOf(previewRead.data);
  const previewSeedApplies = preview !== undefined && (preview.status === "authorised" ? preview.variantId === (activeEdition?.variant.variantId ?? "") : activeLocale === openingLocale);
  const unreleasedPreview: PagePreviewView | undefined = previewParams === undefined && activeLocale !== "" ? { status: "unreleased", locale: activeLocale } : undefined;
  const previewView = previewFromRead ?? (previewSeedApplies ? preview : undefined) ?? unreleasedPreview;
  // Each read's own re-ask, taken as a value: re-asking goes through the query that owns the read, so no second
  // request path is created here.
  const rereadPage = pageRead.refetch;
  const rereadCatalogues = cataloguesRead.refetch;
  const rereadGiving = givingRead.refetch;
  if (pageResult.kind !== "envelope") {
    return pageAnswerNotice(pageResult, () => void rereadPage(), className);
  }
  const builder = pageResult.envelope.data;
  const family = builder.family === "update" ? undefined : builder.family;
  if (family === undefined) {
    // An Update is not a Page, and the service refuses one here; stating that is the only honest answer.
    return <StateNotice kind="refused" headingLevel={2} title={copy.states.refusedTitle} description={UPDATES_ARE_NOT_PAGES} className={className} />;
  }
  const catalogue = catalogueOf(cataloguesRead.data?.kind === "envelope" ? cataloguesRead.data.envelope.data : undefined, family);
  const catalogueDocument = { documentId, expectedRevision: page.revision, ...(composedLocale === "" ? {} : { locale: composedLocale }) };
  const outsideSections = outsideCatalogueCountOf(builder);
  const releaseVariants = releaseVariantsOf(documentId, editionRecords);
  const givingResult = givingRead.data;
  const givingView: ReadEnvelope<GivingBindingView> | undefined = givingResult === undefined ? givingBinding : givingResult.kind === "envelope" ? { ...givingResult.envelope, data: givingResult.envelope.data.binding } : undefined;
  const givingProblem = givingResult === undefined || givingResult.kind === "envelope" ? undefined : givingResult;
  const staleTranslation = activeRecord?.translation.status === "stale";
  const otherEditionNote = otherEditionDescription(composedLocale, activeLocale);
  return (
    <div data-slot="page-builder" data-document-id={documentId} data-family={family} data-locale={activeLocale} data-composing={composingDraft ? "true" : "false"} className={cn(ROOT_CLASS, className)}>
      <div className={HEADER_REGION_CLASS}>
        <div className={SECTION_CLASS}>
          <Badge variant="secondary" className="self-start">
            {copy.families[family].label}
          </Badge>
          <p className={NOTE_CLASS}>{copy.families[family].description}</p>
          <LocaleEditionSwitcher
            editions={editionList}
            selectedLocale={activeLocale}
            onSelectLocale={(locale) => {
              setSelection((current) => ({ ...current, locale }));
            }}
          />
        </div>
        <section aria-labelledby={controlsHeadingId} className={SECTION_CLASS}>
          <h2 id={controlsHeadingId} className={HEADING_CLASS}>
            {CONTROLS_HEADING}
          </h2>
          <div className={HEADER_GRID_CLASS}>
            <div className={SECTION_CLASS}>
              <p className={NOTE_CLASS}>{RELEASE_EDITIONS_NOTE}</p>
              <ReleaseControls
                scope={scope}
                documentId={documentId}
                // Each edition carries its own revision; the release steps this surface opens act on the edition that is
                // open, so its revision is the one they present.
                expectedRevision={activeRecord?.recordRevision ?? page.revision}
                variants={releaseVariants}
                selectedVariantIds={selection.releaseVariantIds}
                onSelectionChange={(releaseVariantIds) => {
                  setSelection((current) => ({ ...current, releaseVariantIds }));
                }}
              />
            </div>
            <div className={SECTION_CLASS}>
              <ReachControl variantId={activeEdition?.variant.variantId ?? ""} documentId={documentId} scope={scope} expectedRevision={page.revision} current={reachOf(activeRecord)} />
              <Separator />
              {/* Containment is a reach change, not an editorial one: it stays offered here whatever state another draft of
                  this Page is in, and it covers every language edition at once. */}
              <StopShowingPublicly scope={scope} documentId={documentId} expectedRevision={page.revision} editionCount={editionList.length} />
            </div>
          </div>
          <Separator />
          <div className={SECTION_CLASS}>{givingView === undefined ? givingAnswerNotice(givingProblem, () => void rereadGiving()) : <GivingDesignation binding={givingView.data} layout="panel" />}</div>
        </section>
      </div>
      <div className={PANES_REGION_CLASS} dir={direction}>
        <fieldset className={cn(SWITCHER_CLASS, "min-w-0 border-0 p-0 lg:hidden")}>
          <legend className="sr-only">{PANE_SWITCHER_LABEL}</legend>
          {PANES.map((pane) => (
            <Button
              key={pane}
              type="button"
              size="sm"
              variant={selection.pane === pane ? "secondary" : "outline"}
              aria-pressed={selection.pane === pane}
              className={TOGGLED_CLASS}
              onClick={() => {
                setSelection((current) => ({ ...current, pane }));
              }}
            >
              {PANE_LABEL[pane]}
            </Button>
          ))}
        </fieldset>
        <div className={PANE_GRID_CLASS}>
          <section data-pane="outline" aria-labelledby={outlineHeadingId} className={paneClass("outline", selection.pane)}>
            <h2 id={outlineHeadingId} className={HEADING_CLASS}>
              {copy.builder.outline}
            </h2>
            {editionList.length === 0 ? (
              <StateNotice kind="empty" headingLevel={3} title={NO_EDITION_TITLE} description={copy.states.emptyEditions} />
            ) : composingDraft ? (
              <>
                <SectionOutline
                  sections={sections}
                  selectedSectionId={chosenSectionId}
                  onSelect={(sectionId) => {
                    setSelection((current) => ({ ...current, sectionId }));
                  }}
                  variantId={draftVariantId}
                  expectedRevision={draftExpectedRevision}
                />
                {outsideSections === 0 ? null : <p className={NOTE_CLASS}>{copy.catalogue.outsideCatalogue}</p>}
              </>
            ) : builder.draft === null ? (
              <StateNotice kind="empty" headingLevel={3} title={NO_DRAFT_TITLE} description={NO_DRAFT_DESCRIPTION} />
            ) : (
              <StateNotice
                kind="empty"
                headingLevel={3}
                title={OTHER_EDITION_TITLE}
                description={otherEditionNote}
                action={
                  composedLocale === ""
                    ? undefined
                    : {
                        label: openComposedDraftLabel(composedLocale),
                        onClick: () => {
                          setSelection((current) => ({ ...current, locale: composedLocale }));
                        },
                      }
                }
              />
            )}
            {/* The catalogue composes into the edition the read named as its draft. With no draft it offers the action
                that starts one, because a Page with nothing saved yet still has to be startable from here. */}
            {catalogue === undefined ? (
              catalogueAnswerNotice(cataloguesRead.data, () => void rereadCatalogues())
            ) : composingDraft ? (
              <FamilyCatalogue family={family} catalogue={catalogue} scope={scope} document={catalogueDocument} target={{ variantId: draftVariantId, expectedRevision: draftExpectedRevision, sectionCount: sections.length }} />
            ) : builder.draft === null ? (
              <FamilyCatalogue family={family} catalogue={catalogue} scope={scope} document={catalogueDocument} />
            ) : null}
            {composingDraft && builder.draft !== null ? <PresetChooser family={family} presets={builder.presets} baseVariantId={draftVariantId} locale={composedLocale} expectedRevision={draftExpectedRevision} scope={scope} documentId={documentId} /> : null}
          </section>
          <section data-pane="fields" aria-labelledby={fieldsHeadingId} className={paneClass("fields", selection.pane)}>
            <h2 id={fieldsHeadingId} className={HEADING_CLASS}>
              {copy.builder.fields}
            </h2>
            {staleTranslation ? (
              <Alert>
                <AlertDescription>{copy.editions.translationSourceNote}</AlertDescription>
              </Alert>
            ) : null}
            {!composingDraft ? (
              <p className={NOTE_CLASS}>{builder.draft === null ? NO_DRAFT_DESCRIPTION : otherEditionNote}</p>
            ) : selectedSection === undefined ? (
              <p className={NOTE_CLASS}>{copy.builder.selectSection}</p>
            ) : (
              // Keyed by the section and by what the record now holds, so a change another action made to this very
              // section opens its own values, while work typed here survives a pane or edition switch unchanged.
              <SectionFields key={`${selectedSection.sectionId}:${signatureOf(selectedSection)}`} section={selectedSection} variantId={draftVariantId} expectedRevision={draftExpectedRevision} direction={direction} scope={scope} documentId={documentId} />
            )}
          </section>
          <section data-pane="preview" className={paneClass("preview", selection.pane)}>
            {previewView === undefined ? <StateNotice kind="loading" headingLevel={2} title={PREVIEW_LOADING_TITLE} description={PREVIEW_LOADING_DESCRIPTION} /> : <PagePreviewFrame layout="builder" preview={previewView} givingBinding={givingView?.data} />}
          </section>
        </div>
      </div>
    </div>
  );
}

export default PageBuilder;
