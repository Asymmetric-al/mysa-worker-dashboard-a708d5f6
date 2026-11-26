import type { SimulatedEffect } from "@/components/simulation-label";
import { REACH_STATUS } from "@/components/status-badge";
import { REACH_VALUES, type Reach } from "@/modules/content/reach";
import { PREVIEW_DENIAL_REASONS } from "@/modules/content/preview";
type ReachOptionCopy = { readonly label: string; readonly description: string };
export const REACH_COPY: Record<Reach, ReachOptionCopy> = {
  "not-public": { label: REACH_STATUS["not-public"].label, description: "Only visible to you in your workspace preview. Public links won’t work." },
  "link-public": { label: REACH_STATUS["link-public"].label, description: "Anyone with the direct link can read it, but it stays hidden from the public directory and search engines." },
  listed: { label: REACH_STATUS.listed.label, description: "Visible in the public directory, open to anyone with the link, and open to search engines." },
} satisfies Record<(typeof REACH_VALUES)[number], ReachOptionCopy>;
export const DISCOVERY_INDEX_COPY: { heading: string; description: string; emptyTitle: string; emptyDescription: string } = {
  heading: "Public pages",
  description:
    "Published ministry pages listed publicly. Unlisted (link-only) pages and drafts don’t appear here, and unpublished pages are removed automatically.",
  emptyTitle: "No public pages listed yet",
  emptyDescription: "Pages set to Listed publicly appear here once published. Unlisted (link-only) pages and drafts stay hidden from this directory.",
};
export const RECEIVING_LIST_COPY: { heading: string; description: string; recheckStatement: string; emptyTitle: string; emptyDescription: string } = {
  heading: "Updates available to read",
  description: "Published updates available to this reader account in its permitted language.",
  recheckStatement: "Access is verified every time you open this list, so unpublished updates or permission changes apply immediately.",
  emptyTitle: "No updates available yet",
  emptyDescription: "Published updates that this reader has permission to view will appear here.",
};
type PreviewDenialReason = (typeof PREVIEW_DENIAL_REASONS)[number];
interface ReceivingPostCopy {
  readonly recheckStatement: string;
  readonly languageFallbackStatement: (requestedLanguage: string, servedLanguage: string) => string;
  readonly languageUnavailable: { readonly title: string; readonly description: string };
  readonly denialNotices: Record<PreviewDenialReason, string>;
  readonly inertStatement: string;
}
export const RECEIVING_POST_COPY: ReceivingPostCopy = {
  recheckStatement: "Access is checked each time this page opens, so changes to publishing or permissions apply right away.",
  languageFallbackStatement: (requestedLanguage, servedLanguage) =>
    `Requested in ${requestedLanguage} — showing the available ${servedLanguage} edition instead. Choosing a language doesn’t change your access or email preferences.`,
  languageUnavailable: {
    title: "Language not available",
    description: "No edition exists in the requested language, and no other language was substituted.",
  },
  denialNotices: {
    "not-authorised": "This reader account doesn’t have permission to view this update.",
    "revision-not-acknowledged": "This preview link points to an outdated revision. Reopen preview from the draft or review page.",
    "locale-not-admitted": "This preview isn’t available in the requested language. Open preview from the edition’s own language.",
    unreleased: "This page isn’t public and isn’t listed in the public directory.",
    withdrawn: "This page was unpublished and is no longer available here. Unpublishing doesn’t recall copies already saved or shared.",
    unavailable: "Couldn’t load this page right now. Try again in a moment.",
  },
  inertStatement: "Preview only — reading here never takes payments, sends emails, subscribes anyone, or publishes content.",
};
export const GIVING_UNAVAILABLE_COPY: { heading: string; description: string } = {
  heading: "Giving unavailable",
  description:
    "Giving details can’t be shown right now because the approved fund designation for this page is missing or no longer approved. No fallback fund is substituted.",
};
export const TOMBSTONE_COPY = "This page is no longer available.";
export const RECEIVING_SIMULATION_EFFECT = "publication-reach" as const satisfies SimulatedEffect;
export const GIVING_SIMULATION_EFFECT = "giving-destination" as const satisfies SimulatedEffect;
