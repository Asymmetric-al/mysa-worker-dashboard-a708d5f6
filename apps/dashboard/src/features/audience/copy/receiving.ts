/**
 * The reader's words: what each reach setting means, the public discovery index, the editions a
 * membership may open, the reading view itself — the language it is actually served in, the *Language
 * unavailable* state and every reason a preview is refused — the inert giving placement, and the one
 * notice a withdrawn address answers.
 */
import type { SimulatedEffect } from "@/components/simulation-label";
import { REACH_STATUS } from "@/components/status-badge";
import { REACH_VALUES, type Reach } from "@/modules/content/reach";
import { PREVIEW_DENIAL_REASONS } from "@/modules/content/preview";
// Reach: the three settings, in the reader's and the author's words
interface ReachOptionCopy {
  readonly label: string;
  readonly description: string;
}
/** The three reach settings, keyed by the closed vocabulary so a fourth value stops compiling here until it is worded. */
export const REACH_COPY: Record<Reach, ReachOptionCopy> = {
  "not-public": {
    label: REACH_STATUS["not-public"].label,
    description: "Only you can see this edition: your own reading view and your preview show it, and nobody " + "else can reach it, with a link or otherwise.",
  },
  "link-public": {
    label: REACH_STATUS["link-public"].label,
    description:
      "Anyone holding the link can read this edition, but it is unlisted: it is kept out of the " +
      "public discovery index, search engines are asked not to index it (noindex), and the link is " +
      "checked again every time it is opened.",
  },
  listed: {
    label: REACH_STATUS.listed.label,
    description: "Anyone holding the link can read this edition, and it appears in the public discovery index, " + "where it can be opened from there and search engines may index it.",
  },
} satisfies Record<(typeof REACH_VALUES)[number], ReachOptionCopy>;
// The discovery index, and the editions a membership may open
/** The public discovery index: the one place that enumerates released editions, and the reason an edition shared only by link is absent from it rather than missing. */
export const DISCOVERY_INDEX_COPY: {
  heading: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
} = {
  heading: "Pages listed publicly",
  description:
    "Only released editions that are listed publicly appear here. An edition shared only by link is " +
    "absent on purpose rather than missing: it opens when someone gives you its link, and it is " +
    "never listed on this page. An edition that has been withdrawn leaves this list, and its " +
    "address answers a short notice instead.",
  emptyTitle: "Nothing is listed publicly yet",
  emptyDescription:
    "Every released edition that is listed publicly appears on this page, so it is empty because " +
    "none is listed publicly at the moment. An edition shared only by link does not appear here by " +
    "design, and an edition still in draft is not released at all.",
};
/** The editions one membership may open, and the check that runs again on every open. */
export const RECEIVING_LIST_COPY: {
  heading: string;
  description: string;
  recheckStatement: string;
  emptyTitle: string;
  emptyDescription: string;
} = {
  heading: "Editions you can open",
  description: "Every released edition this membership may read appears here, in the language it may be served " + "in. Each one opens at the address this list gives, where access is checked again.",
  recheckStatement:
    "Access is checked again every time this list opens, so a release that has been withdrawn, or a " +
    "membership that has changed, is reflected the next time it is opened rather than in a copy " +
    "kept from before.",
  emptyTitle: "No edition is available to this membership yet",
  emptyDescription:
    "This list holds the released editions this membership may read, and it is empty because none " +
    "has been released for it. That is an empty list rather than a source that could not be read: a " +
    "list that cannot be read at all is reported separately, as unavailable.",
};
// The reading view: what it rechecks, the language it serves, and every refusal
type PreviewDenialReason = (typeof PREVIEW_DENIAL_REASONS)[number];

interface ReceivingPostCopy {
  readonly recheckStatement: string;
  readonly languageFallbackStatement: (requestedLanguage: string, servedLanguage: string) => string;
  readonly languageUnavailable: { readonly title: string; readonly description: string };
  readonly denialNotices: Record<PreviewDenialReason, string>;
  readonly inertStatement: string;
}
/** The reading view, in the five things a reader can meet there: the recheck, a fallback, the *Language unavailable* state, a refusal, and the statement that nothing here acts. */
export const RECEIVING_POST_COPY: ReceivingPostCopy = {
  recheckStatement:
    "Access is checked again every time this edition is opened, so a change to the release or to " + "this membership takes effect on the next open rather than in a copy kept from before.",
  languageFallbackStatement: (requestedLanguage, servedLanguage) =>
    `You asked to read this in ${requestedLanguage}, and it is shown in ${servedLanguage}. ` +
    "The language actually served is named so you know which language you are reading; asking for " +
    "a language does not widen what this membership may read, and it does not subscribe you to " +
    "anything.",
  languageUnavailable: {
    title: "Language unavailable",
    description:
      "Nothing readable here exists in the language asked for, and no permitted edition in another " +
      "language stands in for it. This is not an empty list and not a source that could not be " +
      "read: it says only that there is nothing in this language here, and nothing has been " +
      "substituted for it.",
  },
  denialNotices: {
    "not-authorised": "This address cannot be read with the access this session holds. The check is repeated every " + "time it is opened, so a change in access is reflected on the next open.",
    "revision-not-acknowledged":
      "The revision this request names is not the one that may be shown here. Open the preview " +
      "again from the draft or the review step it belongs to, so the revision on screen is the one " +
      "being acknowledged.",
    "locale-not-admitted":
      "The language this request names is not one this preview serves. Open the preview in the " +
      "edition's own language: a preview never stands in for another edition's content, and another " +
      "language is not substituted for it.",
    unreleased: "This address is not public, so it cannot be read here. Nothing at this address is readable " + "by link, and the public discovery index does not list it.",
    withdrawn: "This address has been withdrawn and no longer serves anyone. Withdrawal ends access from now " + "on; it recalls no copy that was already received, saved or shared.",
    unavailable:
      "This surface cannot be read at the moment, so nothing is shown either way. That is a source " +
      "that could not be read rather than a decision about access, so nothing here concludes " +
      "whether an edition exists.",
  },
  inertStatement: "Nothing in this reading view can post money, subscribe you to anything, publish content or " + "start a checkout. Reading an edition changes nothing.",
};
// The inert giving placement, and the notice a withdrawn address answers
/** The giving placement when it cannot be shown: the one approved designation is missing, no longer approved, or incompatible with this placement. */
export const GIVING_UNAVAILABLE_COPY: { heading: string; description: string } = {
  heading: "Giving unavailable",
  description:
    "Giving cannot be placed on this page right now: the one approved designation for it is " +
    "missing, no longer approved, or not compatible with this placement. No other fund and no " +
    "default destination is used in its place, no payment is taken here, and the placement is shown " +
    "for information only.",
};
/** What a withdrawn edition's address answers: one neutral sentence, identical for every withdrawal. */
export const TOMBSTONE_COPY = "This page is no longer available.";
// The effect each reader-facing surface discloses
/** What a receiving surface passes when it shows an edition and the result that followed: the disclosure sentence itself is `SIMULATION_LABELS["publication-reach"]`, and it is never restated. */
export const RECEIVING_SIMULATION_EFFECT = "publication-reach" as const satisfies SimulatedEffect;
/** What the inert giving placement passes: the disclosure sentence is `SIMULATION_LABELS["giving-destination"]`. */
export const GIVING_SIMULATION_EFFECT = "giving-destination" as const satisfies SimulatedEffect;
