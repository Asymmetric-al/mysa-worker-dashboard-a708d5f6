import { LIFECYCLE_STATUS } from "@/components/draft-status";
import { REACH_STATUS } from "@/components/status-badge";
import type { PresentationChoice } from "@/modules/content/document";
import type { Reach } from "@/modules/content/reach";
import type { VariantFamily } from "@/modules/content/variant";
import { PAGE_SECTION_TYPES_BY_FAMILY, type PageSectionType } from "@/modules/data-service/envelope";
/** A page is a `worker-page` or a `project-page`; `update` belongs to Updates. */
export type PageFamily = Exclude<VariantFamily, "update">;
/** The two families, in the order the Pages surface lists them. */
export const PAGE_FAMILIES: readonly PageFamily[] = ["worker-page", "project-page"];
export type FamilyCopy = { readonly label: string; readonly description: string; readonly catalogueLabel: string };
const FAMILIES: Record<PageFamily, FamilyCopy> = {
  "worker-page": { label: "Missionary page", description: "Your public profile introducing you, your story, and the ministry you serve.", catalogueLabel: "Sections for your Missionary page" },
  "project-page": { label: "Project page", description: "A public page highlighting a specific project, its needs, and progress.", catalogueLabel: "Sections for your Project page" },
};
export type CatalogueSectionCopy = { readonly label: string; readonly description: string; readonly managed: boolean };
const CATALOGUE: Record<PageSectionType, CatalogueSectionCopy> = {
  introduction: { label: "Introduction", description: "A brief welcome explaining who you are and how you serve.", managed: false },
  story: { label: "Story", description: "How your ministry began and what God is doing today.", managed: false },
  prayer: { label: "Prayer", description: "Current prayer requests and praises for your partners.", managed: false },
  milestone: { label: "Milestone", description: "A dated ministry milestone.", managed: false },
  image: { label: "Image", description: "A photo with alt text and an optional caption.", managed: false },
  video: { label: "Video", description: "A short video with a poster image, captions, and a transcript.", managed: false },
  giving: { label: "Giving", description: "Your organization-approved giving designation (managed automatically).", managed: true },
  progress: { label: "Support progress", description: "Live support progress when verified coverage data is available (managed automatically).", managed: true },
};
/** The section types each family admits, read from the one per-family declaration the service states. */
const CATALOGUE_BY_FAMILY: Record<PageFamily, readonly PageSectionType[]> = PAGE_SECTION_TYPES_BY_FAMILY;
const CATALOGUE_COPY = {
  addPrompt: "Add a section to this draft edition.",
  addSectionLabel: "Add section",
  noSectionsYet: "No sections yet. Add your first section to start building this page.",
  outsideCatalogue: "Only section types supported by this page type can be added.",
  orderNote: "Sections appear on your page in the order listed below. Use the move controls to reorder them.",
} as const;
export type PresentationOptionCopy = { readonly label: string; readonly description: string };
type Layout = PresentationChoice["layout"];
const TREATMENT_COPY: Record<PresentationChoice["treatment"], PresentationOptionCopy> = { normal: { label: "Standard", description: "Blends naturally with surrounding sections." }, emphasized: { label: "Highlighted", description: "Subtle visual emphasis to draw attention." } };
const LAYOUT_COPY: Record<Layout, PresentationOptionCopy> = { "single-column": { label: "Single column", description: "Full-width stacked content." }, "two-column-image-text": { label: "Image beside text", description: "Side-by-side on desktop, stacked on mobile." } };
const ALIGNMENT_COPY: Record<PresentationChoice["alignment"], PresentationOptionCopy> = { start: { label: "Left aligned", description: "Aligned to the start edge for the language direction." }, center: { label: "Centered", description: "Centered within the section." } };
const IMAGE_FIT_COPY: Record<PresentationChoice["imageFit"], PresentationOptionCopy> = { cover: { label: "Fill frame", description: "Fills the frame cleanly; edges may crop." }, contain: { label: "Fit inside frame", description: "Shows the entire image with no cropping." } };
const PRESENTATION_COPY = {
  treatment: TREATMENT_COPY,
  layout: LAYOUT_COPY,
  alignment: ALIGNMENT_COPY,
  imageFit: IMAGE_FIT_COPY,
  outOfSetMessage: "That layout option isn’t available for this section. Choose one of the listed options.",
  boundedNote: "Each section uses consistent styling from your organization’s page design.",
} as const;
const BUILDER_COPY = {
  outline: "Sections",
  fields: "Section details",
  preview: "Preview",
  openEditionPreview: "Open full-page preview",
  openEditionPreviewNote: "Opens this exact revision in a full-width preview page.",
  selectSection: "Select a section from the list to edit its content.",
  moveUp: "Move up",
  moveDown: "Move down",
  moveToPosition: "Move to position",
  moveToPositionDialogTitle: "Move section",
  moveToPositionHint: "Choose a position from 1 to the total number of sections.",
  positionOption: (position: number): string => `Position ${String(position)}`,
  ariaMoveUp: "Move section up",
  ariaMoveDown: "Move section down",
  ariaSelected: "Selected section",
  duplicate: "Duplicate",
  duplicateHeading: "Duplicate this section?",
  remove: "Remove",
  removeHeading: "Remove this section?",
} as const;
/** The fields and sections a page shows but cannot change, because a source owns them. */
export const MANAGED_FIELD_KEYS = ["page-subject", "legal-identity", "giving-binding", "support-progress", "source-supplied-section"] as const;
export type ManagedFieldKey = (typeof MANAGED_FIELD_KEYS)[number];
const LOCK_REASONS: Record<ManagedFieldKey, string> = {
  "page-subject": "Managed by the underlying missionary or project record and edited there.",
  "legal-identity": "Managed by your organization’s legal entity record (read-only here).",
  "giving-binding": "Managed by your organization’s approved giving designation (read-only here).",
  "support-progress": "Supplied live from your verified support figures (read-only here).",
  "source-supplied-section": "Supplied by your organization and read-only on this page.",
};
const LOCK_COPY = { reasons: LOCK_REASONS, genericLockedReason: "Managed by your organization (read-only here).", lockedReadOnlyLabel: "Read-only" } as const;
/** The four structural changes a section can be given, each reported on its own. */
export const PAGE_SECTION_ACTIONS = ["added", "moved", "duplicated", "removed"] as const;
export type PageSectionAction = (typeof PAGE_SECTION_ACTIONS)[number];
const SECTION_ACTION_RESULTS: Record<PageSectionAction, string> = {
  added: "Section added to this draft. Your published page isn’t changed yet.",
  moved: "Section order updated in this draft.",
  duplicated: "Section duplicated directly below the original in this draft.",
  removed: "Section removed from this draft. Your published page stays unchanged until you publish.",
};
const SECTION_ACTION_COPY = {
  duplicateReview: "Creates a copy of this section right below it in your draft. Nothing is published yet.",
  removeReview: "Removes this section from your draft only. Your published page stays unchanged.",
  removeConfirm: "Remove this section from your draft? Your published page isn’t affected until you publish.",
  confirmDuplicate: "Duplicate section",
  confirmRemove: "Remove section",
  results: SECTION_ACTION_RESULTS,
} as const;
const PRESET_COPY = {
  heading: "Start from a template",
  apply: "Use template",
  applyNote: "Replaces the sections in this draft with a ready-made layout. Your published page stays unchanged until you publish.",
  emptyReason: "No templates available for this page type — add sections individually below.",
} as const;
const EDITIONS_COPY = {
  heading: "Language editions",
  localeLabel: "Language",
  addLocaleEdition: "Add language",
  editionIndependenceNote: "Each language edition has its own draft, review, and published copy. Editing one never overwrites another.",
  publicEditionsOnly: "Ministry pages are always public editions. For supporter-only news, use Updates.",
  fallbackNote: "If a reader’s preferred language isn’t published yet, another available edition is shown and clearly labelled.",
  languageUnavailable: "Language not available",
  unreleasedTitle: "Nothing to preview in this language yet",
  unreleasedDescription: "This language edition has no draft or published content yet.",
  translationSourceNote: "Translations track which source version they came from so you can spot when updates are needed. Older translations stay live until you update them.",
} as const;
function withdrawConfirm(editionCount: number): string {
  const editions = editionCount === 1 ? "published language edition" : "published language editions";
  return `Unpublish ${String(editionCount)} ${editions}? Visitors will see a notice that this page is no longer available. Copies already saved or shared aren’t affected.`;
}
const RELEASE_COPY = {
  submitForReview: "Submit for review",
  submitForReviewNote: "Required only when your organization uses review. Submitting freezes this draft for your reviewer.",
  publish: "Publish edition",
  publishOnly: "Publish only",
  publishNote: "Makes this language edition live at your chosen visibility. Publishing a ministry page doesn’t send emails.",
  reachHeading: "Visibility",
  simulatedEffectKey: "publication-reach",
  requestChanges: "Request changes",
  reject: "Reject",
  withdrawPage: "Unpublish page",
  withdrawLocale: "Unpublish language",
  withdrawConfirm,
  perVariantResultHeading: "Publishing results",
  perVariantResultNote: "Each language edition publishes independently — an error in one won’t undo another.",
  priorGoodHeadPreserved: "Your previously published edition stays live and unchanged.",
  failedUnderPriorGoodHead: "Couldn’t publish this edition. Your previously published edition stays live.",
  stillNeedsAttention: "Needs attention",
} as const;
const openCandidateHint = (localeTag: string): string => `(${localeTag} edition)`;
const REVIEW_COPY = {
  heading: "Review",
  openCandidate: "Open review",
  openCandidateHint,
  frozenRevisionLabel: "Revision under review",
  approveNote: "Approving this language edition doesn’t approve any other language.",
  reviewDoesNotRelease: "Approving marks this revision ready — publishing happens separately.",
  publishOnlyCannotBecomeNotify: "Ministry page releases never send emails, and reviewers can’t add notifications.",
} as const;
export type ReachOptionCopy = { readonly label: string; readonly explanation: string; readonly indexable: boolean };
const REACH_COPY: Record<Reach, ReachOptionCopy> = {
  "not-public": { label: REACH_STATUS["not-public"].label, explanation: "Only visible to you in your workspace. Public links won’t work.", indexable: false },
  "link-public": { label: REACH_STATUS["link-public"].label, explanation: "Anyone with the direct link can view it; hidden from the public directory and search engines.", indexable: false },
  listed: { label: REACH_STATUS.listed.label, explanation: "Visible in the public directory, open to anyone with the link, and open to search engines.", indexable: true },
};
function stopShowingResult(containedCount: number): string {
  const editions = containedCount === 1 ? "the language edition" : `all ${String(containedCount)} language editions`;
  return `Hidden from public view across ${editions}. Public links now show that this page is no longer available.`;
}
const STOP_SHOWING_COPY = {
  action: "Hide page from public",
  confirmTitle: "Hide this page from public view?",
  confirmBody: "Immediately removes every language edition from public view and the public directory, even if another draft has unsaved issues.",
  resultSummary: stopShowingResult,
  doesNotRecallCopies: "Stops future public views here. Copies people have already saved or shared can’t be recalled.",
} as const;
const GIVING_COPY = {
  title: "Giving unavailable",
  explanation: "Giving can’t be shown on this page right now because its approved designation is missing or no longer active.",
  noFallbackNote: "No other fund or default destination is substituted.",
  neverZeroNote: "Shown clearly as unavailable rather than a zero or placeholder.",
  designationApproved: "Approved giving designation",
  designationLabel: "Giving designation",
  simulationKey: "giving-destination",
  previewInertNote: "Preview only — displays the approved fund destination without taking payments.",
} as const;
const CONSTRAINTS_COPY = {
  imageProfile: "Images: JPEG, PNG, or static WebP up to 10 MB (max 8,000 × 8,000 px). Displayed images are resized to 2,000 px and stripped of metadata.",
  videoProfile: "Video: MP4 (H.264/AAC) or WebM (VP8/VP9) up to 100 MB, 3 minutes, 1920 × 1080. Captions use WebVTT.",
  unsupportedValue: "That file format isn’t supported. Your draft wasn’t changed.",
} as const;
const STATES_COPY = {
  emptyPages: "No ministry pages yet. Create one to share your story or project publicly.",
  emptyPagesAction: "Create page",
  emptyEditions: "No language editions yet. Add a language to start writing.",
  emptyEditionsAction: "Add language",
  invalidDraftBlocksUnrelated: "Another draft on this page needs fixing. You can still hide or unpublish the live page anytime.",
  deniedTitle: "You don’t have permission to view this page",
  unavailableTitle: "Couldn’t load this ministry page",
  refusedTitle: "Couldn’t open this ministry page",
} as const;
const PREVIEW_COPY = {
  inertBanner: "Preview only — buttons here don’t take payments, send emails, subscribe anyone, or publish changes.",
  authorisedAs: "Previewing access as",
  recheckedOnOpen: "Permissions are checked fresh every time this preview opens.",
  exactRevisionNote: "Shows this exact saved revision, not later unsaved edits.",
  withdrawnTitle: `${LIFECYCLE_STATUS.withdrawn.label} edition`,
  withdrawnDescription: `${LIFECYCLE_STATUS.withdrawn.explanation} This preview is no longer served.`,
  mediaRetryLabel: "Reload preview",
  unreadyMediaHeading: "Media in this preview",
  unreadyMediaTitle: { image: "Image unavailable", video: "Video unavailable" },
  unreadyMediaFallback: "This media item couldn’t load right now and wasn’t replaced.",
  unreadyMediaNote: "Its alt text and caption appear in its place.",
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
