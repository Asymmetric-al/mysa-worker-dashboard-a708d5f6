import type { SimulatedEffect } from "@/components/simulation-label";
import type { ContentKind, VariantAudience } from "@/modules/content/variant";
export type PublishMode = "publish-only" | "publish-and-notify-now";
export const UPDATE_KIND_LABELS: Record<ContentKind, string> = { update: "General update", prayer: "Prayer request", story: "Story", milestone: "Milestone" };
export const AUDIENCE_LABELS: Record<VariantAudience, { readonly label: string; readonly whoReceives: string }> = {
  public: { label: "Public", whoReceives: "Readers of the public edition of this Update can open this variant." },
  "approved-supporter": { label: "Approved supporters", whoReceives: "Only supporters this publisher has approved can open this variant." },
};
export const VARIANT_AXIS_NOTE =
  "Each variant of an Update is one audience in one content locale. A public variant and an " +
  "approved-supporter variant in the same locale are two distinct variants, and each keeps its own " +
  "draft, candidate and release. The permitted pairings are exactly the ones the variant rule " +
  "admits, so no audience-by-locale cross-product exists. A Page variant is a public locale edition, " +
  "which is why the Pages family offers locales and no audience choice.";
export const LOCALE_DISPLAY_NAMES: Readonly<Record<string, string | undefined>> = { en: "English", fr: "Français", ar: "العربية" } satisfies Record<string, string>;
export const PUBLISH_MODE_LABELS: Record<PublishMode, { readonly label: string; readonly consequence: string }> = {
  "publish-only": { label: "Publish only", consequence: "Releases the exact frozen candidate and submits no notice." },
  "publish-and-notify-now": { label: "Publish and notify now", consequence: "Releases the exact frozen candidate and submits one notice for each eligible recipient." },
};
export const DRAFT_VS_RELEASED = {
  draftIsNotWhatReadersSee: "A saved draft is not what readers see, and a candidate waiting for review is not a release either.",
  releaseIsWhatRecipientsReceive: "A release is what a reader is served and what a notice points at; the notice itself is a separate outcome.",
  restoreCreatesNewDraft: "Restoring an earlier revision always creates a new draft and never rewrites what was released.",
} as const;
export const SIMULATED_EFFECT_BY_TRIGGER: Record<"publish" | "notify", SimulatedEffect> = { publish: "publication-reach", notify: "mail-submission" };
export const WITHDRAWAL_WORDING = {
  whatItDoes: "Withdrawal stops this application from serving that edition, so the address no longer shows the " + "content and the discovery index stops listing it. It works even while an unrelated draft of the " + "same Page is invalid, and it contains every locale edition of that Page.",
  whatItDoesNotDo:
    "Withdrawal does not recall a notice that has already been submitted, does not remove a copy " +
    "someone else holds or has already read, does not undo the record that the revision was once " +
    "released, and cannot reverse a message that has already been accepted. It restores nothing " +
    "either: restoring an earlier revision creates a new draft.",
} as const;
export const REVIEW_ROUND_NOTE = {
  oneStepWherePolicyRequires: "There is one review step, and it applies only where contributor policy requires review.",
  furtherRoundIsNewSubmission: "A further round is a new submission of a new candidate, never a silent re-review of the same one.",
  approvalIsPerVariant: "Approving the candidate for one audience or one locale approves no other variant.",
  reviewerCannotAddNotify: "A reviewer cannot turn Publish only into Publish and notify now.",
} as const;
