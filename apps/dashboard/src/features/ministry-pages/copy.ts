/** The Worker and Project Pages family's single wording module: what each family catalogue offers, why some fields cannot be edited here, how far a released edition reaches, and why a page can say … */
import { REACH_STATUS } from "@/components/status-badge";
import type { PresentationChoice } from "@/modules/content/document";
import type { Reach } from "@/modules/content/reach";
import type { VariantFamily } from "@/modules/content/variant";
import { PAGE_SECTION_TYPES, type PageSectionType } from "@/modules/data-service/envelope";
/** A page is a `worker-page` or a `project-page`; `update` belongs to the Ministry Updates family. */
export type PageFamily = Exclude<VariantFamily, "update">;
/** The two families, in the order the Pages surface lists them. */
export const PAGE_FAMILIES: readonly PageFamily[] = ["worker-page", "project-page"];

export type FamilyCopy = { readonly label: string; readonly description: string; readonly catalogueLabel: string };
const FAMILIES: Record<PageFamily, FamilyCopy> = {
  "worker-page": { label: "Worker Page", description: "A public page about you and the ministry you serve, for people who want to know you.", catalogueLabel: "Sections for your Worker Page" },
  "project-page": { label: "Project Page", description: "A public page about one piece of work, what it needs and how it is going.", catalogueLabel: "Sections for your Project Page" },
};
// The eight section types are the stored record contract's own vocabulary, imported above so a catalogue
// entry here and the type the service stores are added in one change rather than in two that can drift.

export type CatalogueSectionCopy = { readonly label: string; readonly description: string; readonly managed: boolean };
const CATALOGUE: Record<PageSectionType, CatalogueSectionCopy> = {
  introduction: { label: "Introduction", description: "A short opening that says who this page is about and who it is for.", managed: false },
  story: { label: "Story", description: "Your own words on how this work began and what it looks like now.", managed: false },
  prayer: { label: "Prayer", description: "What you would like people to pray for, and how those needs are changing.", managed: false },
  milestone: { label: "Milestone", description: "One dated step in the work, stated plainly, with no target attached.", managed: false },
  image: { label: "Image", description: "A photograph with alternative text, and a caption if the picture needs one.", managed: false },
  video: { label: "Video", description: "One short video with a poster image, a caption track and a transcript.", managed: false },
  giving: { label: "Giving", description: "The giving designation approved for this page, supplied by your organization.", managed: true },
  progress: { label: "Support progress", description: "How support is going, shown only when the source can supply an amount and its coverage.", managed: true },
};
const CATALOGUE_BY_FAMILY: Record<PageFamily, readonly PageSectionType[]> = { "worker-page": PAGE_SECTION_TYPES, "project-page": PAGE_SECTION_TYPES };
const CATALOGUE_COPY = {
  addPrompt: "Add a section to this draft edition. Each type has its own fields and its own presentation choices.",
  addSectionLabel: "Add a section",
  noSectionsYet: "This page has no sections yet. Add the first one to begin.",
  outsideCatalogue: "A section type outside this family's catalogue is not offered, and the service refuses it rather than showing it in another style.",
  orderNote: "The outline lists sections in the order a reader meets them. The move buttons on a section change that order.",
} as const;
export type PresentationOptionCopy = { readonly label: string; readonly description: string };
type Treatment = PresentationChoice["treatment"];
type Layout = PresentationChoice["layout"];
type Alignment = PresentationChoice["alignment"];
type ImageFit = PresentationChoice["imageFit"];

const TREATMENT_COPY: Record<Treatment, PresentationOptionCopy> = { normal: { label: "Normal", description: "The section reads at the page's usual weight." }, emphasized: { label: "Emphasized", description: "The section stands out from those around it." } };
const LAYOUT_COPY: Record<Layout, PresentationOptionCopy> = { "single-column": { label: "Single column", description: "The content runs in one column." }, "two-column-image-text": { label: "Two columns with image and text", description: "An image beside its text, and above it on a narrow screen." } };
const ALIGNMENT_COPY: Record<Alignment, PresentationOptionCopy> = { start: { label: "Start", description: "Text begins at the leading edge of the reading direction." }, center: { label: "Center", description: "Text is centered inside the section." } };
const IMAGE_FIT_COPY: Record<ImageFit, PresentationOptionCopy> = { cover: { label: "Fill the frame", description: "The image fills the frame, so its edges may be cropped." }, contain: { label: "Fit inside the frame", description: "The whole image is shown, inside the frame." } };
const PRESENTATION_COPY = {
  treatment: TREATMENT_COPY,
  layout: LAYOUT_COPY,
  alignment: ALIGNMENT_COPY,
  imageFit: IMAGE_FIT_COPY,
  outOfSetMessage: "The option chosen is not available for this section, so nothing was saved. Choose one of the options this section offers.",
  boundedNote: "Presentation is limited to the options a section offers; a page has no styles of its own.",
} as const;
function positionOption(position: number): string {
  return `Position ${String(position)}`;
}
const BUILDER_COPY = {
  outline: "Sections",
  fields: "Section fields",
  preview: "Preview",
  selectSection: "Choose a section in the outline to change its fields.",
  moveUp: "Move up",
  moveDown: "Move down",
  moveToPosition: "Move to a position",
  moveToPositionDialogTitle: "Move this section",
  moveToPositionHint: "Enter a position between 1 and the number of sections in this edition.",
  positionOption,
  ariaMoveUp: "Move this section up one position",
  ariaMoveDown: "Move this section down one position",
  ariaSelected: "This section is selected",
  duplicate: "Duplicate",
  duplicateHeading: "Duplicate this section?",
  remove: "Remove",
  removeHeading: "Remove this section?",
} as const;
/** The fields and sections a page shows but cannot change, because a source owns them. */
export const MANAGED_FIELD_KEYS = ["page-subject", "legal-identity", "giving-binding", "support-progress", "source-supplied-section"] as const;

export type ManagedFieldKey = (typeof MANAGED_FIELD_KEYS)[number];

const LOCK_REASONS: Record<ManagedFieldKey, string> = {
  "page-subject": "Managed by the source record this page belongs to — the subject the page is about, and that record's identity, stay with the record and are edited there.",
  "legal-identity": "Managed by the Legal Entity record — the approved organization name and its registration details are held there, so they are shown here and cannot be changed on this page.",
  "giving-binding": "Managed by the giving designation approved for this page — the destination is approved in the source, so a page can show it and cannot change or replace it.",
  "support-progress": "Managed by the received-support source — the amount, currency, period and coverage arrive with it, so this section shows exactly what the source supplied.",
  "source-supplied-section": "Managed by the source that supplies this section — its fields are supplied content and are not editable on this page.",
};
const LOCK_COPY = { reasons: LOCK_REASONS, genericLockedReason: "This field is managed by its source, so it is shown read-only here.", lockedReadOnlyLabel: "Read-only" } as const;
/** The four structural changes a section can be given, each reported on its own. */
export const PAGE_SECTION_ACTIONS = ["added", "moved", "duplicated", "removed"] as const;

export type PageSectionAction = (typeof PAGE_SECTION_ACTIONS)[number];

const SECTION_ACTION_RESULTS: Record<PageSectionAction, string> = {
  added: "Section added to this draft edition. Adding a section releases nothing.",
  moved: "Section order changed in this draft edition.",
  duplicated: "Section duplicated after the one it copies, in this draft edition.",
  removed: "Section removed from this draft edition. A released edition keeps what it was released with.",
};
const SECTION_ACTION_COPY = {
  duplicateReview: "Duplicating copies this section's fields into this draft edition, directly after the section it copies. Nothing is released and no released edition changes.",
  removeReview: "Removing takes this section out of this draft edition only. A released edition keeps the section it was released with.",
  removeConfirm: "Remove this section from this draft edition? A release that already includes this section is not changed and is not withdrawn.",
  confirmDuplicate: "Duplicate the section",
  confirmRemove: "Remove the section",
  results: SECTION_ACTION_RESULTS,
} as const;
const PRESET_COPY = { heading: "Start from a preset", apply: "Apply this preset", applyNote: "A preset creates a reviewable draft of this edition. Nothing is released and no released edition changes.", emptyReason: "No preset fits what this edition needs, so add sections one at a time." } as const;
const EDITIONS_COPY = {
  heading: "Language editions",
  localeLabel: "Language",
  addLocaleEdition: "Add a language edition",
  editionIndependenceNote: "Each language edition keeps its own draft, its own reviewed revision and its own released edition. Editing one never overwrites or advances another.",
  publicEditionsOnly: "A Page edition is public. An approved-supporter edition exists for an Update, not for a Page.",
  fallbackNote: "When the requested language has no released edition here, a permitted edition in another language is shown, and the language actually shown is named beside it.",
  languageUnavailable: "Language unavailable",
  unreleasedTitle: "This language edition has nothing to preview yet",
  unreleasedDescription: "This edition has neither a draft nor a released revision, so there is nothing to render. No other edition and no earlier revision is shown in its place.",
  translationSourceNote: "A translation written by hand records the revision it was translated from, so a later change to that source can be shown as stale. A stale translation is never withdrawn for being stale.",
} as const;
function withdrawConfirm(editionCount: number): string {
  const editions = editionCount === 1 ? "released edition" : "released editions";
  return `Withdraw ${String(editionCount)} ${editions}? Every address answers a short notice that the page is no longer available. A copy someone already received or saved is not recalled.`;
}
const RELEASE_COPY = {
  submitForReview: "Submit for review",
  submitForReviewNote: "Review is one step, and only where contributor policy asks for it. Submitting freezes the exact revision a reviewer sees.",
  publish: "Release this edition",
  publishOnly: "Release only",
  publishNote: "Releasing makes this edition readable at the reach you have set. A Page release sends no notice.",
  reachHeading: "How far this edition reaches",
  simulatedEffectKey: "publication-reach",
  requestChanges: "Request changes",
  reject: "Reject",
  withdrawPage: "Withdraw this Page",
  withdrawLocale: "Withdraw this language edition",
  withdrawConfirm,
  perVariantResultHeading: "Result for each edition",
  perVariantResultNote: "Each edition reports its own result. One edition failing leaves another edition's release standing, and no single step rolls the whole page back.",
  priorGoodHeadPreserved: "The edition released before this one is unchanged and stays readable.",
  failedUnderPriorGoodHead: "Release failed for this edition. The edition released before it is unchanged and stays readable.",
  stillNeedsAttention: "Still needs attention",
} as const;
/** What a review link says in words a screen reader reads and its visible words do not: the language edition it belongs to, so two frozen candidates listed together are told apart. */
function openCandidateHint(localeTag: string): string {
  return `for the ${localeTag} language edition`;
}
const REVIEW_COPY = {
  heading: "Review",
  openCandidate: "Review this candidate",
  openCandidateHint,
  frozenRevisionLabel: "Revision under review",
  approveNote: "Approving one language edition approves no other. Each edition is reviewed against its own frozen revision.",
  reviewDoesNotRelease: "Review does not release. Releasing is a separate action, taken for each edition.",
  publishOnlyCannotBecomeNotify: "A reviewer cannot change what a release will do: a Page release sends no notice, and review never adds one.",
} as const;
export type ReachOptionCopy = { readonly label: string; readonly explanation: string; readonly indexable: boolean };
const REACH_COPY: Record<Reach, ReachOptionCopy> = {
  "not-public": { label: REACH_STATUS["not-public"].label, explanation: "Only you can open this edition. The link serves nobody else and the edition is not listed.", indexable: false },
  "link-public": { label: REACH_STATUS["link-public"].label, explanation: "Anyone with the link can read it, but it is not listed in the discovery index and search engines are asked not to index it.", indexable: false },
  listed: { label: REACH_STATUS.listed.label, explanation: "Anyone with the link can read it, and it appears in the public discovery index, where search engines may index it.", indexable: true },
};
function stopShowingResult(containedCount: number): string {
  // The count is every language edition the Page has, because that is what containment covers. An edition with no
  // release was never public, so calling the total "released editions" would overstate what was withdrawn.
  const editions = containedCount === 1 ? "the one language edition" : `all ${String(containedCount)} language editions`;
  return `Stop showing publicly applies to ${editions} of this Page. Any address that served it now answers a short notice that the page is no longer available.`;
}
const STOP_SHOWING_COPY = {
  action: "Stop showing me publicly",
  confirmTitle: "Stop showing this Page publicly?",
  confirmBody: "Every language edition stops being publicly readable as soon as you confirm, including an edition that is listed. It works even when another draft of this Page still needs fixing.",
  resultSummary: stopShowingResult,
  doesNotRecallCopies: "A copy someone already received, saved or shared stays where it is. This stops the page being served here from now on and recalls nothing.",
} as const;
const GIVING_COPY = {
  title: "Giving unavailable",
  explanation: "Giving cannot be shown on this Page right now. The approved giving designation is missing, has been revoked, or does not match this placement.",
  noFallbackNote: "No other fund and no default designation is used in its place, and no amount is shown.",
  neverZeroNote: "Giving unavailable is stated in words: the page never shows a zero, an empty figure or a placeholder amount instead.",
  designationApproved: "Approved giving designation",
  designationLabel: "Giving designation",
  simulationKey: "giving-destination",
  previewInertNote: "This preview shows where giving would go. It cannot start a payment.",
} as const;
const CONSTRAINTS_COPY = {
  imageProfile: "Images: JPEG, PNG or still WebP, up to 10 MiB and up to 8,000 pixels on each side. The copy shown on the page is capped at 2,000 pixels on its longest edge, and the file's own details are removed.",
  videoProfile: "Video: MP4 with H.264 and AAC, or WebM with VP8 or VP9 and Vorbis or Opus, up to 100 MiB, 180 seconds and 1920 × 1080. Captions are WebVTT files.",
  unsupportedValue: "This file's format is one a Page cannot show. The file is not used, and the rest of this draft is unchanged.",
} as const;
const STATES_COPY = {
  emptyPages: "You have no Pages yet. Start one to describe your work in public.",
  emptyPagesAction: "Start a Page",
  emptyEditions: "This Page has no language editions yet. Add a language edition to begin writing.",
  emptyEditionsAction: "Add a language edition",
  invalidDraftBlocksUnrelated: "Another draft of this Page has a problem to fix. You can still stop showing the Page publicly or withdraw an edition while that draft stays exactly as it is.",
  deniedTitle: "You do not have access to this Page",
  unavailableTitle: "This Page cannot be read right now",
  refusedTitle: "This Page's request was refused",
} as const;
const PREVIEW_COPY = {
  inertBanner: "This preview is exact and inert: it starts no payment, sends no mail, subscribes nobody and releases nothing.",
  authorisedAs: "Access is checked for the reader named here",
  recheckedOnOpen: "Access is checked again every time the preview or the edition is opened.",
  exactRevisionNote: "The preview shows the exact revision named above as it renders, not a later draft of it.",
} as const;
/** Every word this family shows, in one place. */
export const copy = {
  families: FAMILIES,
  catalogue: { byFamily: CATALOGUE_BY_FAMILY, sections: CATALOGUE, ...CATALOGUE_COPY },
  presentation: PRESENTATION_COPY,
  builder: BUILDER_COPY,
  lockReasons: LOCK_COPY,
  sectionActions: SECTION_ACTION_COPY,
  preset: PRESET_COPY,
  editions: EDITIONS_COPY,
  release: RELEASE_COPY,
  review: REVIEW_COPY,
  reach: REACH_COPY,
  stopShowingPublicly: STOP_SHOWING_COPY,
  giving: GIVING_COPY,
  constraints: CONSTRAINTS_COPY,
  states: STATES_COPY,
  preview: PREVIEW_COPY,
} as const;
