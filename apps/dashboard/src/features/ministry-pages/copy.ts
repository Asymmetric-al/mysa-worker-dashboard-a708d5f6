/**
 * The Worker and Project Pages family's single wording module: what each family catalogue offers, why
 * some fields cannot be edited here, how far a released edition reaches, and why a page can say that
 * giving is unavailable.
 *
 * The family's surfaces read every sentence from this tree and none of them words these things again:
 * the catalogue and its add prompt, the section builder and its move buttons, the section field form,
 * the presentation controls, the locked-field notice, the preset picker, the language edition list,
 * the reach control, the release and review surfaces, the stop-showing-publicly dialog, the giving
 * panel, the media constraints note, the empty and denied states, and the exact preview banner.
 *
 * Wording another module already owns is never restated here, so each sentence has one home:
 * `components/simulation-label.tsx` owns the five simulated-effect sentences (this module supplies
 * only the two `simulationKey` values a page surface passes in), `components/status-badge.tsx` owns
 * the compact badge map beside a control, `components/draft-status.tsx` owns the content lifecycle
 * words, `components/dev-banner.tsx` owns the persistent development-data marker, and
 * `components/state-notice.tsx` owns the notice vocabulary whose `kind` a caller passes beside the
 * titles below.
 *
 * One module rather than several, because a phrase must not acquire a second copy: the family reads
 * its catalogue, lock reasons, reach names and giving explanation from here even where a single
 * component shows only a line of it.
 *
 * Data only: no JSX, no hooks, no store, no data service, no IO, no clock, no validation, and no
 * formatting of a date, an amount or a locale. Types come from the content profile, so an admitted
 * value added upstream fails to compile here until it is worded.
 */
import { REACH_STATUS } from "@/components/status-badge";
import type { PresentationChoice } from "@/modules/content/document";
import type { Reach } from "@/modules/content/reach";
import type { VariantFamily } from "@/modules/content/variant";

// Families

/** A page is a `worker-page` or a `project-page`; `update` belongs to the Ministry Updates family. */
export type PageFamily = Exclude<VariantFamily, "update">;

/** The two families, in the order the Pages surface lists them. */
export const PAGE_FAMILIES: readonly PageFamily[] = ["worker-page", "project-page"];

export interface FamilyCopy {
  readonly label: string;
  readonly description: string;
  readonly catalogueLabel: string;
}

const FAMILIES: Record<PageFamily, FamilyCopy> = {
  "worker-page": {
    label: "Worker Page",
    description:
      "A public page about you and the ministry you serve, for people who want to know you.",
    catalogueLabel: "Sections for your Worker Page",
  },
  "project-page": {
    label: "Project Page",
    description: "A public page about one piece of work, what it needs and how it is going.",
    catalogueLabel: "Sections for your Project Page",
  },
};

// The guided catalogues

/**
 * The eight section types a guided catalogue offers, declared once. A stored section carries an
 * `element` identifier from this set, so a ninth type cannot appear without joining this tuple, and
 * joining it leaves the catalogue and the family lists below incomplete until it is worded.
 */
export const PAGE_SECTION_TYPES = [
  "introduction",
  "story",
  "prayer",
  "milestone",
  "image",
  "video",
  "giving",
  "progress",
] as const;

export type PageSectionType = (typeof PAGE_SECTION_TYPES)[number];

export interface CatalogueSectionCopy {
  readonly label: string;
  readonly description: string;
  /** Whether the source supplies this section's fields, so the builder shows it read-only. */
  readonly managed: boolean;
}

const CATALOGUE: Record<PageSectionType, CatalogueSectionCopy> = {
  introduction: {
    label: "Introduction",
    description: "A short opening that says who this page is about and who it is for.",
    managed: false,
  },
  story: {
    label: "Story",
    description: "Your own words on how this work began and what it looks like now.",
    managed: false,
  },
  prayer: {
    label: "Prayer",
    description: "What you would like people to pray for, and how those needs are changing.",
    managed: false,
  },
  milestone: {
    label: "Milestone",
    description: "One dated step in the work, stated plainly, with no target attached.",
    managed: false,
  },
  image: {
    label: "Image",
    description: "A photograph with alternative text, and a caption if the picture needs one.",
    managed: false,
  },
  video: {
    label: "Video",
    description: "One short video with a poster image, a caption track and a transcript.",
    managed: false,
  },
  giving: {
    label: "Giving",
    description: "The giving designation approved for this page, supplied by your organization.",
    managed: true,
  },
  progress: {
    label: "Support progress",
    description:
      "How support is going, shown only when the source can supply an amount and its coverage.",
    managed: true,
  },
};

/** Which of the eight types each family's catalogue offers, in the order a builder lists them. */
const CATALOGUE_BY_FAMILY: Record<PageFamily, readonly PageSectionType[]> = {
  "worker-page": PAGE_SECTION_TYPES,
  "project-page": PAGE_SECTION_TYPES,
};

/**
 * The catalogue's own words. Composition happens in this draft edition only: a type outside the
 * catalogue is refused rather than given another style, and order changes are made with buttons, so
 * no part of composing a section depends on a continuous pointer movement.
 */
const CATALOGUE_COPY = {
  addPrompt:
    "Add a section to this draft edition. Each type has its own fields and its own presentation choices.",
  addSectionLabel: "Add a section",
  noSectionsYet: "This page has no sections yet. Add the first one to begin.",
  outsideCatalogue:
    "A section type outside this family's catalogue is not offered, and the service refuses it rather than showing it in another style.",
  orderNote:
    "The outline lists sections in the order a reader meets them. The move buttons on a section change that order.",
} as const;

// The four bounded presentation choices

export interface PresentationOptionCopy {
  readonly label: string;
  readonly description: string;
}

type Treatment = PresentationChoice["treatment"];
type Layout = PresentationChoice["layout"];
type Alignment = PresentationChoice["alignment"];
type ImageFit = PresentationChoice["imageFit"];

const TREATMENT_COPY: Record<Treatment, PresentationOptionCopy> = {
  normal: { label: "Normal", description: "The section reads at the page's usual weight." },
  emphasized: { label: "Emphasized", description: "The section stands out from those around it." },
};

const LAYOUT_COPY: Record<Layout, PresentationOptionCopy> = {
  "single-column": { label: "Single column", description: "The content runs in one column." },
  "two-column-image-text": {
    label: "Two columns with image and text",
    description: "An image beside its text, and above it on a narrow screen.",
  },
};

const ALIGNMENT_COPY: Record<Alignment, PresentationOptionCopy> = {
  start: {
    label: "Start",
    description: "Text begins at the leading edge of the reading direction.",
  },
  center: { label: "Center", description: "Text is centered inside the section." },
};

const IMAGE_FIT_COPY: Record<ImageFit, PresentationOptionCopy> = {
  cover: {
    label: "Fill the frame",
    description: "The image fills the frame, so its edges may be cropped.",
  },
  contain: {
    label: "Fit inside the frame",
    description: "The whole image is shown, inside the frame.",
  },
};

/**
 * Presentation as a closed set. The four maps are exhaustive over the profile's values, a value
 * outside the set is refused by the service, and the surface says so: there is no fallback style.
 */
const PRESENTATION_COPY = {
  treatment: TREATMENT_COPY,
  layout: LAYOUT_COPY,
  alignment: ALIGNMENT_COPY,
  imageFit: IMAGE_FIT_COPY,
  outOfSetMessage:
    "The option chosen is not available for this section, so nothing was saved. Choose one of the options this section offers.",
  boundedNote:
    "Presentation is limited to the options a section offers; a page has no styles of its own.",
} as const;

// The section builder

/** The destination position one entry of the move dialog names. */
function positionOption(position: number): string {
  return `Position ${String(position)}`;
}

/**
 * The builder's headings, controls and accessible names. Every change of order is a button or a
 * dialog, so the same job completes with a keyboard, with one pointer and on a phone at 320 CSS
 * pixels without any section being carried across the screen.
 */
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

// Managed fields

/** The fields and sections a page shows but cannot change, because a source owns them. */
export const MANAGED_FIELD_KEYS = [
  "page-subject",
  "legal-identity",
  "giving-binding",
  "support-progress",
  "source-supplied-section",
] as const;

export type ManagedFieldKey = (typeof MANAGED_FIELD_KEYS)[number];

/**
 * Why each managed field is read-only, named with its owner and what that means for the worker. No
 * managed field has an edit path in this release, so no sentence here hints at one.
 */
const LOCK_REASONS: Record<ManagedFieldKey, string> = {
  "page-subject":
    "Managed by the source record this page belongs to — the subject the page is about, and that record's identity, stay with the record and are edited there.",
  "legal-identity":
    "Managed by the Legal Entity record — the approved organization name and its registration details are held there, so they are shown here and cannot be changed on this page.",
  "giving-binding":
    "Managed by the giving designation approved for this page — the destination is approved in the source, so a page can show it and cannot change or replace it.",
  "support-progress":
    "Managed by the received-support source — the amount, currency, period and coverage arrive with it, so this section shows exactly what the source supplied.",
  "source-supplied-section":
    "Managed by the source that supplies this section — its fields are supplied content and are not editable on this page.",
};

const LOCK_COPY = {
  reasons: LOCK_REASONS,
  genericLockedReason: "This field is managed by its source, so it is shown read-only here.",
  lockedReadOnlyLabel: "Read-only",
} as const;

// Section actions

/** The four structural changes a section can be given, each reported on its own. */
export const PAGE_SECTION_ACTIONS = ["added", "moved", "duplicated", "removed"] as const;

export type PageSectionAction = (typeof PAGE_SECTION_ACTIONS)[number];

const SECTION_ACTION_RESULTS: Record<PageSectionAction, string> = {
  added: "Section added to this draft edition. Adding a section releases nothing.",
  moved: "Section order changed in this draft edition.",
  duplicated: "Section duplicated after the one it copies, in this draft edition.",
  removed:
    "Section removed from this draft edition. A released edition keeps what it was released with.",
};

/**
 * What a structural change says before it runs and reports afterwards. Removal touches this draft
 * edition only, so its confirmation names that no release is changed and nothing is withdrawn.
 */
const SECTION_ACTION_COPY = {
  duplicateReview:
    "Duplicating copies this section's fields into this draft edition, directly after the section it copies. Nothing is released and no released edition changes.",
  removeReview:
    "Removing takes this section out of this draft edition only. A released edition keeps the section it was released with.",
  removeConfirm:
    "Remove this section from this draft edition? A release that already includes this section is not changed and is not withdrawn.",
  confirmDuplicate: "Duplicate the section",
  confirmRemove: "Remove the section",
  results: SECTION_ACTION_RESULTS,
} as const;

// Presets

/** A preset proposes a composition; it produces a reviewable draft and releases nothing. */
const PRESET_COPY = {
  heading: "Start from a preset",
  apply: "Apply this preset",
  applyNote:
    "A preset creates a reviewable draft of this edition. Nothing is released and no released edition changes.",
  emptyReason: "No preset fits what this edition needs, so add sections one at a time.",
} as const;

// Language editions

/**
 * Each locale edition keeps its own draft, its own reviewed revision and its own released edition,
 * so editing one never overwrites or advances another. A page edition is public: the
 * approved-supporter audience belongs to an Update, never to a Page.
 */
const EDITIONS_COPY = {
  heading: "Language editions",
  localeLabel: "Language",
  addLocaleEdition: "Add a language edition",
  editionIndependenceNote:
    "Each language edition keeps its own draft, its own reviewed revision and its own released edition. Editing one never overwrites or advances another.",
  publicEditionsOnly:
    "A Page edition is public. An approved-supporter edition exists for an Update, not for a Page.",
  fallbackNote:
    "When the requested language has no released edition here, a permitted edition in another language is shown, and the language actually shown is named beside it.",
  languageUnavailable: "Language unavailable",
  translationSourceNote:
    "A translation written by hand records the revision it was translated from, so a later change to that source can be shown as stale. A stale translation is never withdrawn for being stale.",
} as const;

// Release and review

/** What a withdrawal asks, for one released edition or several. */
function withdrawConfirm(editionCount: number): string {
  const editions = editionCount === 1 ? "released edition" : "released editions";
  return `Withdraw ${String(editionCount)} ${editions}? Every address answers a short notice that the page is no longer available. A copy someone already received or saved is not recalled.`;
}

/**
 * Release. Every edition reports its own result, and a sibling's failure leaves the edition released
 * before it unchanged and readable, so no sentence may suggest that one step releases or rolls back
 * the whole page. Publication is simulated: the sentence that says so belongs to
 * `components/simulation-label.tsx`, which is why only the key appears here.
 */
const RELEASE_COPY = {
  submitForReview: "Submit for review",
  submitForReviewNote:
    "Review is one step, and only where contributor policy asks for it. Submitting freezes the exact revision a reviewer sees.",
  publish: "Release this edition",
  publishOnly: "Release only",
  publishNote:
    "Releasing makes this edition readable at the reach you have set. A Page release sends no notice.",
  reachHeading: "How far this edition reaches",
  simulatedEffectKey: "publication-reach",
  requestChanges: "Request changes",
  reject: "Reject",
  withdrawPage: "Withdraw this Page",
  withdrawLocale: "Withdraw this language edition",
  withdrawConfirm,
  perVariantResultHeading: "Result for each edition",
  perVariantResultNote:
    "Each edition reports its own result. One edition failing leaves another edition's release standing, and no single step rolls the whole page back.",
  priorGoodHeadPreserved: "The edition released before this one is unchanged and stays readable.",
  failedUnderPriorGoodHead:
    "Release failed for this edition. The edition released before it is unchanged and stays readable.",
  stillNeedsAttention: "Still needs attention",
} as const;

/** Review freezes one revision of one edition: it approves no sibling and it releases nothing. */
const REVIEW_COPY = {
  heading: "Review",
  frozenRevisionLabel: "Revision under review",
  approveNote:
    "Approving one language edition approves no other. Each edition is reviewed against its own frozen revision.",
  reviewDoesNotRelease:
    "Review does not release. Releasing is a separate action, taken for each edition.",
  publishOnlyCannotBecomeNotify:
    "A reviewer cannot change what a release will do: a Page release sends no notice, and review never adds one.",
} as const;

// Reach

export interface ReachOptionCopy {
  /** The setting's name, fixed by the specification and used verbatim on every surface. */
  readonly label: string;
  readonly explanation: string;
  readonly indexable: boolean;
}

/**
 * The three reach values, keyed by the vocabulary the content profile declares so a fourth value
 * stops compiling here. The names are the specification's own and are imported from
 * `components/status-badge.tsx`'s `REACH_STATUS`, so the reach control, the review text, the
 * receiving view and the chip beside them cannot word a setting differently.
 */
const REACH_COPY: Record<Reach, ReachOptionCopy> = {
  "not-public": {
    label: REACH_STATUS["not-public"].label,
    explanation:
      "Only you can open this edition. The link serves nobody else and the edition is not listed.",
    indexable: false,
  },
  "link-public": {
    label: REACH_STATUS["link-public"].label,
    explanation:
      "Anyone with the link can read it, but it is not listed in the discovery index and search engines are asked not to index it.",
    indexable: false,
  },
  listed: {
    label: REACH_STATUS.listed.label,
    explanation:
      "Anyone with the link can read it, and it appears in the public discovery index, where search engines may index it.",
    indexable: true,
  },
};

// Stopping public display

/** What *Stop showing me publicly* reports once every released edition is contained. */
function stopShowingResult(containedCount: number): string {
  const editions = containedCount === 1 ? "released edition" : "released editions";
  return `Stop showing publicly applied to ${String(containedCount)} ${editions}. Each address now answers a short notice that the page is no longer available.`;
}

/**
 * Containment takes effect immediately, covers every language edition and works while another draft
 * of the same page still needs fixing. It is a decision about display rather than an editorial
 * cleanup, and it never claims to recall a copy someone already holds.
 */
const STOP_SHOWING_COPY = {
  action: "Stop showing me publicly",
  confirmTitle: "Stop showing this Page publicly?",
  confirmBody:
    "Every language edition stops being publicly readable as soon as you confirm, including an edition that is listed. It works even when another draft of this Page still needs fixing.",
  resultSummary: stopShowingResult,
  doesNotRecallCopies:
    "A copy someone already received, saved or shared stays where it is. This stops the page being served here from now on and recalls nothing.",
} as const;

// Giving

/**
 * A page shows the one designation approved for it, and says so in words when that designation is
 * missing, revoked or incompatible with the placement. No other fund and no default designation is
 * used in its place, and the state is never shown as a zero, an empty figure or a placeholder amount.
 * The sentence labelling the simulated destination belongs to `components/simulation-label.tsx`, so
 * only the key is carried here.
 */
const GIVING_COPY = {
  title: "Giving unavailable",
  explanation:
    "Giving cannot be shown on this Page right now. The approved giving designation is missing, has been revoked, or does not match this placement.",
  noFallbackNote:
    "No other fund and no default designation is used in its place, and no amount is shown.",
  neverZeroNote:
    "Giving unavailable is stated in words: the page never shows a zero, an empty figure or a placeholder amount instead.",
  designationApproved: "Approved giving designation",
  designationLabel: "Giving designation",
  simulationKey: "giving-destination",
  previewInertNote: "This preview shows where giving would go. It cannot start a payment.",
} as const;

// Constraints, states and preview

/**
 * The limits a page states before a file is chosen, quoted as display text. The service and
 * `modules/media` enforce them, and no component in this family re-derives one of them.
 */
const CONSTRAINTS_COPY = {
  imageProfile:
    "Images: JPEG, PNG or still WebP, up to 10 MiB and up to 8,000 pixels on each side. The copy shown on the page is capped at 2,000 pixels on its longest edge, and the file's own details are removed.",
  videoProfile:
    "Video: MP4 with H.264 and AAC, or WebM with VP8 or VP9 and Vorbis or Opus, up to 100 MiB, 180 seconds and 1920 × 1080. Captions are WebVTT files.",
  unsupportedValue:
    "This file's format is one a Page cannot show. The file is not used, and the rest of this draft is unchanged.",
} as const;

/**
 * The states a Pages surface can be in. Each offers a real first action where nothing exists yet,
 * and the denied and unavailable titles are passed to `components/state-notice.tsx` together with its
 * own `kind` rather than replacing that component's wording.
 */
const STATES_COPY = {
  emptyPages: "You have no Pages yet. Start one to describe your work in public.",
  emptyPagesAction: "Start a Page",
  emptyEditions: "This Page has no language editions yet. Add a language edition to begin writing.",
  emptyEditionsAction: "Add a language edition",
  invalidDraftBlocksUnrelated:
    "Another draft of this Page has a problem to fix. You can still stop showing the Page publicly or withdraw an edition while that draft stays exactly as it is.",
  deniedTitle: "You do not have access to this Page",
  unavailableTitle: "This Page cannot be read right now",
} as const;

/**
 * The preview is exact, currently authorised and inert: it releases nothing, sends no notice,
 * subscribes nobody and starts no payment, and it shows the revision named in it rather than a later
 * draft.
 */
const PREVIEW_COPY = {
  inertBanner:
    "This preview is exact and inert: it starts no payment, sends no mail, subscribes nobody and releases nothing.",
  authorisedAs: "Access is checked for the reader named here",
  recheckedOnOpen: "Access is checked again every time the preview or the edition is opened.",
  exactRevisionNote:
    "The preview shows the exact revision named above as it renders, not a later draft of it.",
} as const;

// The tree the family reads

/**
 * Every word this family shows, in one place. A component reads a leaf —
 * `copy.reach.listed.label`, `copy.lockReasons.reasons["giving-binding"]`,
 * `copy.stopShowingPublicly.resultSummary(2)` — and never a string literal of its own.
 */
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
