/**
 * The reader's words: what each reach setting means, the public discovery index, the editions a
 * membership may open, the reading view itself — the language it is actually served in, the
 * *Language unavailable* state and every reason a preview is refused — the inert giving placement,
 * and the one notice a withdrawn address answers.
 *
 * Plan items that put this file in scope:
 * - AAP 0.10.1 families 10 and 11: purpose-specific memberships with a receiving preview, and the
 *   public and by-link reading of a released Page edition.
 * - AAP 0.8.6 reach rule: exactly Not public, Shared by link: public and Listed publicly, with a real
 *   discovery index at `/preview/pages` that enumerates only `listed` editions, and a direct-link
 *   route that answers `noindex` for a `link-public` edition and a non-identifying tombstone once it
 *   is withdrawn. The directive itself, its status code and its headers belong to that route, so
 *   nothing here emits one; naming the setting in a sentence is the whole of this file's part.
 * - AAP 0.8.6 giving, locale-fallback and preview rules: *Giving unavailable* with no fallback fund;
 *   the language actually served named when a fallback occurs and *Language unavailable* when none is
 *   permitted; a preview that is exact, currently authorised and inert.
 * - AAP 0.11.1 row `apps/dashboard/src/features/audience/**`: this copy set is the family's
 *   vocabulary — plain TypeScript, with no message catalogue and no i18n framework.
 *
 * Sentences, and two effect keys. This module decides no reach (that is `modules/content/reach.ts`),
 * admits no edition and resolves no fallback (that is `modules/content/locale.ts`), refuses no
 * preview (that is `modules/content/preview.ts`), counts nothing, grants nothing and reads no clock,
 * so the same input always produces the same words. It imports the closed vocabularies those modules
 * own, so a reach value or a refusal reason added there stops this file compiling until it has words
 * here.
 *
 * Four vocabularies stay with their owners, because a second copy of one would state the same fact
 * twice: the compact chip beside a reach control is `components/status-badge.tsx`'s `REACH_STATUS`;
 * the five sentences disclosing a simulated effect are `SIMULATION_LABELS` in
 * `components/simulation-label.tsx`; the empty, unavailable, denied and *Language unavailable*
 * presentations are `components/state-notice.tsx`'s, to which this file supplies words; and a video
 * plays in `components/video-player.tsx`. What is declared here is what each reach setting means to
 * a reader, beside the reader's sentences; the three option names themselves are imported from that
 * map rather than re-typed.
 *
 * What these words must never claim: that a publication was delivered to or read by anyone, that a
 * notice reached a person, that a language choice or an open consents to anything, that a refused
 * address holds anything at all, that withdrawal recalls a copy already received or saved, or that
 * the giving placement can take a payment. Reading an edition changes nothing.
 */
import type { SimulatedEffect } from "@/components/simulation-label";
import { REACH_STATUS } from "@/components/status-badge";
import { REACH_VALUES, type Reach } from "@/modules/content/reach";
import { PREVIEW_DENIAL_REASONS } from "@/modules/content/preview";

// ---------------------------------------------------------------------------------------------
// Reach: the three settings, in the reader's and the author's words
// ---------------------------------------------------------------------------------------------

/** One reach setting's words: the fixed option name a control shows, and what it means for a reader. */
interface ReachOptionCopy {
  readonly label: string;
  readonly description: string;
}

/**
 * The three reach settings, keyed by the closed vocabulary so a fourth value stops compiling here
 * until it is worded.
 *
 * `label` is the option name the reach control and the review text show, read from
 * `components/status-badge.tsx`'s `REACH_STATUS` instead of re-typed here, so the reach control, the
 * review text, the receiving view and the chip beside them cannot word a setting differently. The
 * annotation keys the map by the release record's alias and the `satisfies` closes it against the
 * tuple the surfaces order the options by, so the two declarations of the vocabulary must agree
 * before this file compiles.
 */
export const REACH_COPY: Record<Reach, ReachOptionCopy> = {
  "not-public": {
    label: REACH_STATUS["not-public"].label,
    description:
      "Only you can see this edition: your own reading view and your preview show it, and nobody " +
      "else can reach it, with a link or otherwise.",
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
    description:
      "Anyone holding the link can read this edition, and it appears in the public discovery index, " +
      "where it can be opened from there and search engines may index it.",
  },
} satisfies Record<(typeof REACH_VALUES)[number], ReachOptionCopy>;

// ---------------------------------------------------------------------------------------------
// The discovery index, and the editions a membership may open
// ---------------------------------------------------------------------------------------------

/**
 * The public discovery index: the one place that enumerates released editions, and the reason an
 * edition shared only by link is absent from it rather than missing.
 *
 * The wording never reads as a promise of reach or of audience size: appearing here means the edition
 * may be opened from the index, and nothing about how many people will open it.
 */
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

/**
 * The editions one membership may open, and the check that runs again on every open.
 *
 * The empty state is a genuinely empty list of readable editions. A source that could not be read is
 * reported separately as unavailable by `components/state-notice.tsx`, so nothing here describes an
 * absence of information, and nothing hints that editions this membership may not read exist.
 */
export const RECEIVING_LIST_COPY: {
  heading: string;
  description: string;
  recheckStatement: string;
  emptyTitle: string;
  emptyDescription: string;
} = {
  heading: "Editions you can open",
  description:
    "Every released edition this membership may read appears here, in the language it may be served " +
    "in. Each one opens at the address this list gives, where access is checked again.",
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

// ---------------------------------------------------------------------------------------------
// The reading view: what it rechecks, the language it serves, and every refusal
// ---------------------------------------------------------------------------------------------

/** The six refusal reasons, derived from the preview module's own set so none is restated here. */
type PreviewDenialReason = (typeof PREVIEW_DENIAL_REASONS)[number];

/** One exact-post reading view's words, and the single formatter its language statement needs. */
interface ReceivingPostCopy {
  /** The check that runs again on every open. */
  readonly recheckStatement: string;
  /** Names the language asked for and the language actually served; it decides neither. */
  readonly languageFallbackStatement: (requestedLanguage: string, servedLanguage: string) => string;
  /** The state where nothing in the requested or a permitted language may be served. */
  readonly languageUnavailable: { readonly title: string; readonly description: string };
  /** One sentence per refusal reason, none revealing what the refused address holds. */
  readonly denialNotices: Record<PreviewDenialReason, string>;
  /** The statement that the reading view can perform no effect at all. */
  readonly inertStatement: string;
}

/**
 * The reading view, in the five things a reader can meet there: the recheck, a fallback, the
 * *Language unavailable* state, a refusal, and the statement that nothing here acts.
 *
 * The two language statements are deliberately separate. A fallback names the language that was
 * asked for and the language actually served, because a reader must know which one they are reading;
 * *Language unavailable* says no edition readable here exists in the language asked for and no
 * permitted edition in another language stands in for it, which is neither an empty list nor an
 * unreadable source. Neither statement decides anything: which language is served, and whether a
 * fallback is permitted, are `modules/content/locale.ts`'s answers, arriving here already resolved.
 *
 * Each refusal sentence states only what may not be shown. None carries a title, an excerpt, a count,
 * a size, an author or an existence flag, and the three that could be confused with one another stay
 * distinct in words: `unreleased` says nothing here is readable by link, `withdrawn` says the address
 * no longer serves anyone and recalls nothing already received, and `unavailable` reports a surface
 * that could not be read rather than a decision about access.
 */
export const RECEIVING_POST_COPY: ReceivingPostCopy = {
  recheckStatement:
    "Access is checked again every time this edition is opened, so a change to the release or to " +
    "this membership takes effect on the next open rather than in a copy kept from before.",
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
    "not-authorised":
      "This address cannot be read with the access this session holds. The check is repeated every " +
      "time it is opened, so a change in access is reflected on the next open.",
    "revision-not-acknowledged":
      "The revision this request names is not the one that may be shown here. Open the preview " +
      "again from the draft or the review step it belongs to, so the revision on screen is the one " +
      "being acknowledged.",
    "locale-not-admitted":
      "The language this request names is not one this preview serves. Open the preview in the " +
      "edition's own language: a preview never stands in for another edition's content, and another " +
      "language is not substituted for it.",
    unreleased:
      "This address is not public, so it cannot be read here. Nothing at this address is readable " +
      "by link, and the public discovery index does not list it.",
    withdrawn:
      "This address has been withdrawn and no longer serves anyone. Withdrawal ends access from now " +
      "on; it recalls no copy that was already received, saved or shared.",
    unavailable:
      "This surface cannot be read at the moment, so nothing is shown either way. That is a source " +
      "that could not be read rather than a decision about access, so nothing here concludes " +
      "whether an edition exists.",
  },
  inertStatement:
    "Nothing in this reading view can post money, subscribe you to anything, publish content or " +
    "start a checkout. Reading an edition changes nothing.",
};

// ---------------------------------------------------------------------------------------------
// The inert giving placement, and the notice a withdrawn address answers
// ---------------------------------------------------------------------------------------------

/**
 * The giving placement when it cannot be shown: the one approved designation is missing, no longer
 * approved, or incompatible with this placement.
 *
 * It offers no fallback fund or default destination, because offering one would send a reader's
 * giving somewhere nobody approved; and it states in words, rather than as a zero or an empty
 * figure, that nothing is available. No payment is taken here. The sentence disclosing the simulated
 * destination is `SIMULATION_LABELS["giving-destination"]`, which the placement renders beside this.
 */
export const GIVING_UNAVAILABLE_COPY: { heading: string; description: string } = {
  heading: "Giving unavailable",
  description:
    "Giving cannot be placed on this page right now: the one approved designation for it is " +
    "missing, no longer approved, or not compatible with this placement. No other fund and no " +
    "default destination is used in its place, no payment is taken here, and the placement is shown " +
    "for information only.",
};

/**
 * What a withdrawn edition's address answers: one neutral sentence, identical for every withdrawal.
 *
 * It carries no title, excerpt, image, media reference, author, withdrawal date or reason, so an
 * address that once served something cannot be made to say what it served. The words are the ones
 * `modules/content/reach.ts` fixes for the tombstone body, so a withdrawn edition is not told one
 * story at its address and another in a reading view.
 */
export const TOMBSTONE_COPY = "This page is no longer available.";

// ---------------------------------------------------------------------------------------------
// The effect each reader-facing surface discloses
// ---------------------------------------------------------------------------------------------

/**
 * What a receiving surface passes when it shows an edition and the result that followed: the
 * disclosure sentence itself is `SIMULATION_LABELS["publication-reach"]`, and it is never restated
 * here. The receiving list and the exact-post view pass this key; `satisfies` holds it inside the
 * closed effect union, so a renamed member or a mistyped literal fails to compile rather than
 * leaving the effect unlabelled.
 */
export const RECEIVING_SIMULATION_EFFECT = "publication-reach" as const satisfies SimulatedEffect;

/**
 * What the inert giving placement passes: the disclosure sentence is
 * `SIMULATION_LABELS["giving-destination"]`. Only the placement passes this key, and it never renders
 * a live giving control that would make the sentence untrue.
 */
export const GIVING_SIMULATION_EFFECT = "giving-destination" as const satisfies SimulatedEffect;
