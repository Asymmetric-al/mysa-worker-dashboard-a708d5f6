import type { SimulatedEffect } from "@/components/simulation-label";
import { AUDIENCE_STATUS, type StatusTone } from "@/components/status-badge";
import type { ContentKind, VariantAudience } from "@/modules/content/variant";
export type PublishMode = "publish-only" | "publish-and-notify-now";
export const UPDATE_KIND_LABELS: Record<ContentKind, string> = { update: "General update", prayer: "Prayer request", story: "Story", milestone: "Milestone" };
/** Each audience's word and tone come from {@link AUDIENCE_STATUS}, and this record adds only what this feature's own reader needs explained beside them. */
export const AUDIENCE_LABELS: Record<VariantAudience, { readonly label: string; readonly tone: StatusTone; readonly whoReceives: string }> = {
  public: { ...AUDIENCE_STATUS.public, whoReceives: "Anyone with the public link can read this edition." },
  "approved-supporter": { ...AUDIENCE_STATUS["approved-supporter"], whoReceives: "Only approved supporters can read this edition." },
};
export const VARIANT_AXIS_NOTE =
  "Each edition pairs one audience with one language. Public and approved-supporter editions in the same language have separate drafts, reviews, and releases.";
export const LOCALE_DISPLAY_NAMES: Readonly<Record<string, string | undefined>> = { en: "English", fr: "Français", ar: "العربية" } satisfies Record<string, string>;
export const PUBLISH_MODE_LABELS: Record<PublishMode, { readonly label: string; readonly consequence: string }> = {
  "publish-only": { label: "Publish only", consequence: "Publishes this edition without sending email notifications." },
  "publish-and-notify-now": { label: "Publish and notify partners", consequence: "Publishes this edition and sends email notifications to eligible partners." },
};
export const SUBMISSION_RELEASE_MODE = {
  legend: "Release option after approval",
  description: "Choose how this edition should be released once approved. Submitting freezes a review copy without publishing or sending emails yet.",
} as const;
export const DRAFT_VS_RELEASED = {
  draftIsNotWhatReadersSee: "Saved drafts and review copies aren’t visible to partners until published.",
  releaseIsWhatRecipientsReceive: "Partners always read the published edition; email notifications are tracked separately.",
  restoreCreatesNewDraft: "Restoring a previous version opens a new draft without altering what’s already published.",
} as const;
export const SIMULATED_EFFECT_BY_TRIGGER: Record<"publish" | "notify", SimulatedEffect> = { publish: "publication-reach", notify: "mail-submission" };
export const WITHDRAWAL_WORDING = {
  whatItDoes: "Unpublishing removes this edition from public view and the public directory across all its language versions, even if another draft still has errors.",
  whatItDoesNotDo:
    "Unpublishing stops future views here. It can’t recall emails already sent, remove copies someone saved, or erase the history that an edition was published.",
} as const;
export const REVIEW_ROUND_NOTE = {
  oneStepWherePolicyRequires: "One review step applies only when your organization requires review.",
  furtherRoundIsNewSubmission: "Changes after feedback start a fresh review submission.",
  approvalIsPerVariant: "Approving one audience or language edition doesn’t approve any others.",
  reviewerCannotAddNotify: "Reviewers can’t switch “Publish only” to “Publish and notify partners”.",
} as const;
