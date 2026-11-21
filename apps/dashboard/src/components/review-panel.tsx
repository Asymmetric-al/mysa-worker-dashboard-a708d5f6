"use client";

/**
 * The one review surface for both content families: the frozen revision a reviewer answers, and the
 * single decision they can give it.
 *
 * AAP 0.3.4 makes the review panel a shared concern with exactly one implementation, and 0.9.2 names
 * this file as it: "the one review surface, used by both Updates and Pages". Ministry Updates and
 * Worker/Project Pages ask a reviewer the same question — "is this exact revision, for this audience
 * and this language, allowed to be published?" — so one surface asks it, in one vocabulary, and a
 * second review panel never appears beside it.
 *
 * What it owns, and why each part has to be here rather than in a feature:
 *
 * - **The frozen revision, named exactly.** A candidate freezes one revision, and this panel prints
 *   that revision's identity, its short checksum, its audience and its exact content locale, so
 *   "what I reviewed" survives into a conversation held a week later. A later save produces a new
 *   revision with a new checksum, which is why nothing written after the submission can become the
 *   thing that was approved (AAP 0.8.5).
 * - **One step, only where policy requires it.** `policyRequiresReview === false` states plainly
 *   that there is no review step and offers no review action. A second round is never created here:
 *   a changed candidate is a new submission with new revision ids, and this surface has no way to
 *   re-open one it has answered.
 * - **One decision for one edition.** Approving the edition on screen approves no sibling: not the
 *   same document's other audience, not its other locale. The sentence saying so sits beside the
 *   confirm control, because that is the moment the distinction matters.
 * - **The author's publish choice as a fact, not a control.** Whether this publication would notify
 *   anyone is the author's decision and is displayed as recorded. A reviewer may approve it or ask
 *   for changes; a reviewer cannot turn Publish only into Publish and notify now, or the reverse
 *   (AAP 0.8.5). The only path to the other choice is a request for changes carrying a note that
 *   says so.
 * - **Publication, notification and delivery kept apart.** Approval is a review decision: it is not
 *   a release, not a submitted notice and not a person reading anything. The simulated boundaries it
 *   leads to (`publication-reach`, and `mail-submission` when a notice is requested) are disclosed
 *   where the reviewer sees them, and no sentence here claims delivery or reading.
 *
 * Rendered, never edited. The candidate reaches this panel as the HTML `modules/content/render.ts`
 * produced from the stored document JSON, and that string is displayed as it arrived: this file
 * parses no markup, converts no markdown and imports no editor, because a reviewer never opens a
 * live editing surface. For the same reason the candidate is framed in its own sandboxed document
 * rather than injected into this page: the frame has no scripts, cannot navigate, submit a form or
 * open a window, so a reviewer can look at a revision without the revision being able to act. The
 * frame is given a language and a title of its own so it is a well-formed, nameable document rather
 * than an anonymous embedded blob.
 *
 * The decision runs through `components/action-review`, the application's one review-then-accept
 * step: it mints the attempt identity, fences a second press, and renders the outcome through
 * `components/operation-result`, the one durable receipt. That receipt is deliberately not rendered
 * a second time here — one outcome speaks once — and this file therefore holds no identity of its
 * own, starts no request on render, and keeps no copy of a record.
 *
 * Accessibility, direction and narrow screens. The panel is a labelled region whose heading level is
 * the caller's, with each of its parts below that heading in the document outline, and the edition
 * selector names the edition's lifecycle in the one vocabulary `components/draft-status` owns. The
 * decision is a `FormFieldGroup` legend over a `RadioGroup`, so the group is one named question with
 * one answer and every option carries a visible label and its own explanation; the note is a
 * `FormField` whose described limit is the bound the mutation itself enforces. Every control meets the
 * 24x24 CSS px floor of WCAG 2.5.8 or the spacing exception, nothing here needs a drag (2.5.7), and
 * the preview, the facts and the decision sit in one column, so at 320 CSS px they stack in reading
 * order while the note the reviewer typed stays where it was. Direction belongs to the edition and
 * not to this surface: the framed document is given the candidate's own `dir` and language, while the
 * panel's chrome stays in the interface's direction and uses logical utilities only, so a reviewer
 * reading an Arabic candidate in an English interface sees neither a mirrored control nor a
 * misaligned row.
 *
 * Layering: a shared component above `components/ui` and the two contract modules, below every
 * feature. It imports no feature, no store, no service and no HTTP client; it formats no amount and
 * computes no total, because no financial value belongs on a review of prose.
 */

import { useId, useState, type ReactElement } from "react";

import ActionReview from "@/components/action-review";
import {
  LIFECYCLE_STATUS,
  type ContentLifecycleState,
  type LifecycleSpec,
} from "@/components/draft-status";
import { FormField, FormFieldGroup } from "@/components/form-field";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge from "@/components/status-badge";
import VariantSwitcher, { AUDIENCE_WORDS, type VariantTab } from "@/components/variant-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import {
  REVIEW_DECISIONS,
  variantKeyAllowed,
  type ReviewDecision,
  type VariantAudience,
  type VariantFamily,
  type VariantLocale,
} from "@/modules/content/variant";
import type {
  MediaAssetRenditionPurpose,
  MutationInput,
  Scope,
} from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";

// ---------------------------------------------------------------------------------------------
// The frozen candidate, as the service returns it
// ---------------------------------------------------------------------------------------------

/**
 * What a stored rendition is for, taken from the envelope's closed set rather than restated.
 *
 * Every request for a rendition re-authorises for its purpose, so the purpose is part of the value
 * the panel displays: "Poster image" and "Caption track" are different admissions, and a reviewer
 * reads which one the frame was allowed to load.
 */
export type RenditionPurpose = MediaAssetRenditionPurpose;

/** One scoped rendition the candidate's rendering referenced, with the URL the read admitted. */
export interface CandidateMediaRendition {
  /** What the rendition serves; it decides the word the panel prints beside the link. */
  readonly purpose: RenditionPurpose;
  /**
   * The scoped URL the envelope supplied. It is used verbatim and never assembled, extended or
   * remembered: an address this panel built would be an address it authorised itself.
   */
  readonly url: string;
}

/**
 * One frozen candidate, exactly as the review read returned it.
 *
 * Every field is required except the staleness flag, because a candidate that cannot name its
 * revision, its checksum, its audience, its locale or its rendered body is not something a reviewer
 * can meaningfully answer — and a shape that let those be absent would allow an unfrozen draft to be
 * reviewed by accident. `locale` is the content module's own locale pair (`tag` and `direction`),
 * the same `{ tag, direction }` shape the locale module calls `ContentLocale`, taken from the variant
 * contract so this panel holds no second locale type.
 */
export interface CandidateView {
  /** The edition under review: one audience, one content locale, one document. */
  readonly variantId: string;
  /** The audience this edition serves. The family's permitted axis decides whether it can appear. */
  readonly audience: VariantAudience;
  /** The exact content locale, with the direction the edition is authored and read in. */
  readonly locale: VariantLocale;
  /** The exact revision frozen for this review, never reused and never reissued. */
  readonly revisionId: string;
  /** The checksum recorded on that revision, so the frozen content is identifiable without a read. */
  readonly contentChecksum: string;
  /** The candidate as `modules/content/render.ts` rendered it. Displayed verbatim; never parsed. */
  readonly renderedHtml: string;
  /** The renditions the rendering referenced, in the order the document placed them. */
  readonly mediaRenditions: readonly CandidateMediaRendition[];
  /** Whether the source revision this manual translation copied is no longer current. */
  readonly staleTranslation?: boolean;
}

// ---------------------------------------------------------------------------------------------
// The decision's payload
// ---------------------------------------------------------------------------------------------

/**
 * The decision the reviewer gave, and the frozen identity it answers.
 *
 * Three arms, not one record with optional members: an approval carries the checksum it approves — so
 * an approval cannot drift onto a later draft — while the two arms that ask the author to act carry
 * the note they will read. A single shape with three optional fields would let a payload name an
 * approval and a note at once and leave the mutation guessing which it was.
 *
 * This is the review panel's payload, not any one mutation's. The consuming feature maps it onto the
 * named mutation it calls — `approveCandidate`, `requestChanges` or `rejectCandidate` — adding the
 * review record's own identity from its route, and validating the result with that mutation's own
 * schema. Nothing here is a field map or a generic command: the feature's transport is one call per
 * named mutation, and this shape carries only what the reviewer decided about what they read.
 */
export interface ApprovedDecisionPayload {
  readonly decision: "approved";
  /** The edition answered. Approving it approves no other variant of the document. */
  readonly variantId: string;
  /** The exact revision approved. */
  readonly revisionId: string;
  /** The checksum of that revision, so the approval names the content the reviewer read. */
  readonly contentChecksum: string;
}

/** A request for changes: the author needs to act, so a note is required and carried. */
export interface ChangesRequestedDecisionPayload {
  readonly decision: "changes-requested";
  /** The edition answered. */
  readonly variantId: string;
  /** The frozen revision the author is asked to revise; their next attempt is a new submission. */
  readonly revisionId: string;
  /** What needs changing, already trimmed by the panel. Never empty. */
  readonly note: string;
}

/** A rejection: the candidate ends, and the reason is carried so the author is not left guessing. */
export interface RejectedDecisionPayload {
  readonly decision: "rejected";
  /** The edition answered. */
  readonly variantId: string;
  /** The frozen revision declined. A rejection withdraws nothing that was already published. */
  readonly revisionId: string;
  /** Why the candidate ended, already trimmed by the panel. Never empty. */
  readonly note: string;
}

/** One review answer with the frozen identity it answers. */
export type ReviewDecisionPayload =
  | ApprovedDecisionPayload
  | ChangesRequestedDecisionPayload
  | RejectedDecisionPayload;

// ---------------------------------------------------------------------------------------------
// The panel's props
// ---------------------------------------------------------------------------------------------

/** The two content families a review serves. A Page is a public locale edition; an Update is not. */
export type ReviewFamily = "update" | "page";

/**
 * What another edition of the same document stands in after a release attempt.
 *
 * A release attempt reports one outcome per selected edition, and a sibling's failure never rolls
 * back the edition that succeeded (AAP 0.8.5). A reviewer looking at one edition may therefore need
 * to see that a sibling kept its prior published revision rather than losing it in a batch — that is
 * the fact this carries, and it is supplied by the surface that ran the attempt, because only that
 * surface has the per-variant results. Nothing here is derived from a reason string.
 */
export interface ReviewSiblingStanding {
  /** The other edition this row describes. */
  readonly variantId: string;
  /** The audience it serves. */
  readonly audience: VariantAudience;
  /** Its exact content locale. */
  readonly locale: VariantLocale;
  /** The lifecycle state it stands in now, as the caller derived it from the records. */
  readonly lifecycle: ContentLifecycleState;
  /** True when its last release attempt failed and it therefore still shows its earlier release. */
  readonly heldPriorGoodRelease?: boolean;
}

/** Props of {@link ReviewPanel}. */
export interface ReviewPanelProps {
  /** The content family, which decides the wording of the panel and the permitted audience axis. */
  readonly family: ReviewFamily;

  /**
   * The frozen candidates this caller may review, in any order. A candidate absent from this list is
   * never rendered and nothing here reveals that it exists or was withheld.
   */
  readonly candidates: readonly CandidateView[];

  /**
   * The edition on screen, as a route or query fact of the feature. Empty, or naming a candidate that
   * is not in `candidates`, means no edition is under review here — the panel says so rather than
   * choosing a plausible neighbour and offering a decision on it.
   */
  readonly activeVariantId: string;

  /** Asks the feature to show another candidate. Called only with an id from `candidates`. */
  readonly onSelect: (variantId: string) => void;

  /**
   * Whether this document's contributor policy requires a review step. When it does not, the panel
   * states that and offers no decision: a review action where review is not required would be a
   * second step in the author's way.
   */
  readonly policyRequiresReview: boolean;

  /**
   * The publish choice the author made, displayed as a fact. `false` is *Publish only*; `true` is
   * *Publish and notify now*. The reviewer approves this choice or asks for changes; there is no
   * control here that can alter it.
   */
  readonly notifyRequestedByAuthor: boolean;

  /**
   * A description of the minimal link-only notices this publication would carry, when notices are
   * requested. It is the caller's wording, because only it knows which purpose and which protected
   * scope apply; the panel frames it and claims nothing beyond it.
   */
  readonly protectedNoticeScope?: string;

  /**
   * The context the decision runs in, taken from the review read's envelope. The service re-verifies
   * it, so a stale or wrong scope produces a refusal rather than an unauthorised answer.
   */
  readonly scope: Scope;

  /**
   * The revision the review read carried — the caller's concurrency token for this decision. The
   * panel never derives it and never substitutes a candidate's own revision for it: a stale value is
   * the service's `conflict`, which the receipt shows beside the reviewer's preserved input.
   */
  readonly expectedRevision: string;

  /**
   * The feature's own call for the named mutation behind the chosen decision. The panel supplies the
   * attempt's four-field input — context, expected revision and its own payload — and never a
   * transport of its own; `components/action-review` mints the operation identity.
   */
  readonly onDecide: (input: MutationInput<ReviewDecisionPayload>) => Promise<MutationOutcome>;

  /**
   * What other editions of the same document stand in, when the caller has run a release attempt.
   * Optional: a review read that has not attempted a release has nothing to say about siblings, and
   * an empty list states nothing rather than implying they are unpublished.
   */
  readonly siblingStanding?: readonly ReviewSiblingStanding[];

  /**
   * The heading level that fits the surrounding page: 2 where the panel is a page's main content,
   * 3 where it sits under a document heading. Its own parts render one level below it.
   */
  readonly headingLevel?: 2 | 3;

  /** Layout classes for the panel. Never a colour, radius or shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Words: this surface's vocabulary, declared once
// ---------------------------------------------------------------------------------------------

/**
 * The longest note a reviewer may leave.
 *
 * It mirrors the bound the review mutation itself enforces for a reviewer's note, so a note composed
 * here cannot be refused for its length after a round trip: the field stops at the same number the
 * service stops at, and the field's description states that number rather than leaving the reviewer
 * to discover it.
 */
export const REVIEW_NOTE_MAX_CHARS = 2000;

/**
 * How much of a checksum is shown before the reviewer asks for the whole value.
 *
 * A digest is long enough to dominate a line and short enough that a prefix identifies it, so the
 * short form is what the panel prints and the full form is one press away — a reviewer who has to
 * name the revision they read in a later conversation needs all of it, and a summary view does not.
 */
const SHORT_CHECKSUM_LENGTH = 12;

/** What a value prints as when the service stated none. Never "null" and never "undefined". */
const NOT_STATED_TEXT = "Not stated";

/** The heading element the panel itself renders, by the level its page asks for. */
const PANEL_HEADING_TAG = { 2: "h2", 3: "h3" } as const;

/** The heading elements for parts that sit one level below the panel. */
const SUB_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

/** A heading level a part of the panel may render at. */
type SubHeadingLevel = keyof typeof SUB_HEADING_TAG;

/**
 * The level the panel's own parts render at: one deeper than the panel, and never deeper than the
 * last level HTML offers, so a panel placed under a document heading does not skip a level.
 */
function subHeadingLevelOf(panelLevel: 2 | 3): SubHeadingLevel {
  return panelLevel === 2 ? 3 : 4;
}

/** What one family calls its review, and why a review is not a publication. */
interface FamilyCopy {
  /** The panel's own heading. */
  readonly title: string;
  /** What the review answers and what it never does, read before the candidate. */
  readonly introduction: string;
}

/**
 * The two families' wording: the same questions, the same rules, the family's own noun.
 *
 * The introductions carry the same three promises in both families — approval answers one exact
 * revision, approval publishes nothing, and a release or a notice is a separate step — because those
 * are properties of the review step rather than of a family. Only the noun and the surface the next
 * step lives on differ.
 */
const FAMILY_COPY: Readonly<Record<ReviewFamily, FamilyCopy>> = {
  update: {
    title: "Review this Update",
    introduction:
      "A review answers the exact revision the author submitted, for one audience and one language. " +
      "Approving it publishes nothing and notifies nobody: the release is a separate step, and a " +
      "simulated notice is separate again.",
  },
  page: {
    title: "Review this Page",
    introduction:
      "A review answers the exact revision the author submitted for one language edition of this " +
      "Page. Approving it publishes nothing and makes the Page public to nobody: release, reach and " +
      "withdrawal stay separate steps on the Page's own surface.",
  },
};

/** One decision's words: what it is called, how it reads, and what the confirming step states. */
interface DecisionCopy {
  /** The option's visible label in the decision group. */
  readonly label: string;
  /** What the decision does and does not do, read beside the option. */
  readonly description: string;
  /** The confirming step's heading, so the step names the decision it will apply. */
  readonly title: string;
  /** The confirm control's label, and the name of the dialog when the step confirms through one. */
  readonly confirmLabel: string;
  /** Whether the decision ends the candidate, which confirms through the destructive dialog. */
  readonly consequential: boolean;
  /** What stops being true when the decision is applied, shown inside the confirmation dialog. */
  readonly consequence?: string;
}

/**
 * The three decisions, in the order the reviewer meets them, exhaustive over the content module's
 * closed set: a decision added to that set without its words fails to compile rather than rendering
 * an unlabelled radio.
 *
 * Rejecting is the only `consequential` one: it ends the candidate for good, so it confirms through
 * the design system's alert dialog, which names what stops being true and puts the safe choice first.
 * Requesting changes and approving both confirm inline with one press — a dialog for either would be
 * friction that teaches a reviewer to dismiss dialogs.
 */
const DECISION_COPY: Readonly<Record<ReviewDecision, DecisionCopy>> = {
  approved: {
    label: "Approve",
    description:
      "The frozen revision is approved for this audience and language and can be published as it " +
      "stands. Approval itself publishes nothing.",
    title: "Approve the frozen revision",
    confirmLabel: "Approve this revision",
    consequential: false,
  },
  "changes-requested": {
    label: "Request changes",
    description:
      "The author reads your note and submits a new revision. This candidate is answered, not " +
      "re-reviewed, and its earlier submission stays on record.",
    title: "Request changes to this revision",
    confirmLabel: "Send this request for changes",
    consequential: false,
  },
  rejected: {
    label: "Reject",
    description:
      "This candidate ends. The edition keeps whatever it published before, and the author's next " +
      "attempt is a new submission.",
    title: "Reject this candidate",
    confirmLabel: "Reject this candidate",
    consequential: true,
    consequence:
      "The candidate is closed and this edition keeps whatever it published before. Nothing is " +
      "deleted, no release is withdrawn and no message is sent to anyone.",
  },
};

/** The word for one rendition's purpose, so a reviewer reads which admission they are looking at. */
const RENDITION_PURPOSE_WORDS: Readonly<Record<RenditionPurpose, string>> = {
  display: "Display image",
  playback: "Playback video",
  poster: "Poster image",
  captions: "Caption track",
  transcript: "Transcript",
};

/** Said when the read returned no frozen candidate at all. It implies nothing about other editions. */
const NO_CANDIDATE_NOTICE =
  "No revision is frozen for review here, so there is nothing to approve or refuse.";

/** Said when the chosen edition is not among the candidates this caller may review. */
const NO_ACTIVE_NOTICE =
  "No edition under review is selected here. Choose the edition you mean from the list above; " +
  "nothing is approved until you decide on the edition on screen.";

/** The switcher's label: which edition this review is about. */
const EDITION_LABEL = "Edition under review";

/** The frozen section's heading. */
const FROZEN_HEADING = "The revision you are reviewing";

/** Why the printed identifiers matter, stated once beside them. */
const FROZEN_EXPLANATION =
  "These identify the exact revision the author submitted. A later save is a different revision " +
  "with a different checksum, so content written after this submission cannot become the revision " +
  "you approve.";

/** The publish-intent section's heading. */
const INTENT_HEADING = "What approval lets happen";

/** The badge word for the author's Publish only choice. */
const PUBLISH_ONLY_BADGE = "Publish only";

/** The badge word for the author's Publish and notify now choice. */
const NOTIFY_BADGE = "Publish and notify now";

/** What Publish only means, stated where the reviewer reads it. */
const PUBLISH_ONLY_SENTENCE =
  "The author chose to publish this edition without notifying anyone.";

/** What Publish and notify now means, stated where the reviewer reads it. */
const NOTIFY_SENTENCE =
  "The author chose to publish this edition and then notify the subscribers who are currently " +
  "eligible for this publisher's Update email purpose.";

/**
 * The rule a reviewer most needs beside the publish choice: it is a fact recorded from the author,
 * and only a request for changes reaches the other option.
 */
const REVIEWER_CANNOT_FLIP_SENTENCE =
  "This is the author's choice, shown as a fact. A reviewer cannot turn Publish only into Publish " +
  "and notify now, or the reverse; if the other choice is the right one, ask for changes and say so " +
  "in the note.";

/** The preview section's heading. */
const PREVIEW_HEADING = "What a released reader would see";

/**
 * Why the candidate is framed rather than placed in this page.
 *
 * It states the isolation as a property of the surface, not as an apology: the frame has no
 * scripts, cannot navigate, submit or open a window, and loads only the renditions this read
 * admitted.
 */
const PREVIEW_EXPLANATION =
  "Shown in its own frame so nothing in the revision can act on this page: it runs no scripts, " +
  "cannot navigate, submit a form or open a window, and loads only the renditions this review was " +
  "admitted to read.";

/** The label over the renditions the revision references. */
const MEDIA_LABEL = "Media in this revision";

/** Said when the frozen revision carried no rendered body, so no frame is shown. */
const NO_RENDERED_BODY_NOTICE =
  "This revision arrived without a rendered body, so what a released reader would see cannot be " +
  "shown here. Nothing has been approved; the read that supplied this candidate should be repeated " +
  "before a decision is given.";

/** The sibling section's heading. */
const SIBLING_HEADING = "Other editions in this document";

/** What a sibling that kept its earlier release is, stated so a failure never reads as a rollback. */
const HELD_PRIOR_GOOD_SENTENCE =
  "Not rolled back: this edition still publishes the revision it published before that attempt, and " +
  "the failure belongs to the edition the attempt named.";

/**
 * The rule every decision obeys, printed beside the confirm control.
 *
 * It sits here rather than only in a help page because this is the moment the distinction can be got
 * wrong: two editions of one document look alike, and an approval that quietly covered both would
 * publish a language nobody reviewed.
 */
const APPROVAL_IS_PER_VARIANT_SENTENCE =
  "This decision answers the edition named above only: approving one language or audience approves " +
  "no other edition of this document.";

/** The other rule the confirm control needs: a review decision is neither a release nor a delivery. */
const APPROVAL_IS_NOT_DELIVERY_SENTENCE =
  "A decision is not a publication and not a delivery. It sends no message, and nothing here proves " +
  "that any reader received or opened anything.";

/** The decision group's legend. */
const DECISION_LEGEND = "Your decision";

/** What the decision group states about the one-step rule before any option is read. */
const DECISION_DESCRIPTION =
  "One decision, given once. If something needs to change, the author's next attempt is a new " +
  "submission with a new revision — this candidate is not re-reviewed.";

/** The note field's label. */
const NOTE_LABEL = "Note for the author";

/** The note field's description when the chosen decision carries the note. */
const NOTE_REQUIRED_DESCRIPTION =
  `Required for this decision: say what the author needs to know, in up to ${REVIEW_NOTE_MAX_CHARS} characters.`;

/**
 * What the note field says when the chosen decision needs none, so nothing typed is wasted.
 *
 * The bound is stated here as well as on the required form: the field accepts an optional note for
 * every decision, so a reviewer who drafts one before choosing must not learn its length limit only
 * after switching to the decision that sends it.
 */
const NOTE_OPTIONAL_DESCRIPTION =
  "Approving needs no note. Anything typed here stays on this page and is sent only if you choose " +
  `Request changes or Reject. Up to ${REVIEW_NOTE_MAX_CHARS} characters.`;

/** The statement a document whose policy requires no review shows instead of any decision. */
const POLICY_NOT_REQUIRED_HEADING = "Review is not required for this document";

/** What the absence of a review step means, so nobody looks for a missing control. */
const POLICY_NOT_REQUIRED_SENTENCE =
  "Contributor policy for this document requires no review, so this page offers no decision: there " +
  "is no candidate to approve, no second round to run and nothing for a reviewer to confirm.";

/** What the surface still does not do, said once, so the absence of a control claims nothing. */
const POLICY_NOT_REQUIRED_NOTHING_APPROVED =
  "Nothing is approved, published or notified from here. The author's own surface reports what " +
  "happened when the edition was released.";

/** Display names for the note field's message, whichever path the mutation reports it under. */
const NOTE_FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  note: NOTE_LABEL,
  reason: NOTE_LABEL,
};

/** The opening of a rendition link's accessible name. */
const OPEN_RENDITION_PREFIX = "Open the";

// ---------------------------------------------------------------------------------------------
// Reading the values the records carry
// ---------------------------------------------------------------------------------------------

/**
 * The decision a control reported, or `null` when the value names none.
 *
 * The radio group's value arrives as an untyped value from the primitive, and a value the closed set
 * does not name must not become a decision: an unrecognised answer is ignored and the reviewer's
 * current choice stands, rather than the panel selecting something they did not choose.
 */
function reviewDecisionOf(value: unknown): ReviewDecision | null {
  if (typeof value !== "string") {
    return null;
  }
  const named = REVIEW_DECISIONS.find((decision) => decision === value);
  return named ?? null;
}

/**
 * The wording of one lifecycle state, tolerating a value cast in from a response.
 *
 * The type makes an unknown state impossible, but a value arriving over the wire is not typed until
 * the service's schema has seen it. A state the vocabulary does not describe prints as itself rather
 * than blanking the list that exists to describe editions.
 */
function lifecycleSpecOf(state: ContentLifecycleState): LifecycleSpec {
  const spec: LifecycleSpec | undefined = LIFECYCLE_STATUS[state];
  return spec ?? { label: String(state), tone: "muted", explanation: "" };
}

/** The short form of a checksum: its prefix, or the whole value when it is already short. */
function shortChecksumOf(checksum: string): string {
  const trimmed = checksum.trim();
  if (trimmed.length <= SHORT_CHECKSUM_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, SHORT_CHECKSUM_LENGTH)}…`;
}

/**
 * Escapes a value for use inside an attribute or a text node of the preview document.
 *
 * Only the five characters that end an attribute or open a tag are replaced. The value escaped is
 * the frame's own title and its locale tag — text this panel composes from the record — so the
 * escaping exists to keep a malformed tag from breaking the wrapping document, never to sanitise the
 * candidate's markup, which is inserted exactly as the renderer produced it.
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The document the candidate is framed in.
 *
 * The rendered revision is a fragment — the machine-readable content profile's `<article>` — so it
 * needs a document around it to be framed: a document is what carries the edition's own language and
 * direction to the reader's assistive technology, and what gives the frame a title of its own instead
 * of leaving an anonymous embedded document in the page. The fragment itself is concatenated in
 * untouched: no parsing, no rewriting, no sanitising, because `modules/content/render.ts` is the one
 * renderer and this file is not a second one.
 */
function previewDocumentOf(html: string, locale: VariantLocale, title: string): string {
  return (
    "<!doctype html>" +
    `<html lang="${escapeAttribute(locale.tag)}" dir="${escapeAttribute(locale.direction)}">` +
    `<head><meta charset="utf-8"><title>${escapeAttribute(title)}</title></head>` +
    `<body>${html}</body>` +
    "</html>"
  );
}

/**
 * The tabs the edition switcher offers: one per frozen candidate, each in its one review state.
 *
 * Every candidate in a review read is frozen for its single review step, so the lifecycle word is
 * `candidate` for all of them and the switcher needs no derivation of its own. The audience axis is
 * the family's, and the switcher applies the family rule itself.
 */
function variantTabsOf(candidates: readonly CandidateView[]): readonly VariantTab[] {
  return candidates.map((candidate) => ({
    variantId: candidate.variantId,
    audience: candidate.audience,
    locale: candidate.locale,
    lifecycle: "candidate",
  }));
}

/**
 * The family key the edition switcher understands.
 *
 * A review of an Update is a review of an Update; a review of a Page is a review of a Page edition.
 * Both page families admit exactly one audience — `public` — so the switcher is given the worker-page
 * key for either, whose permitted audience set is identical, and the difference between the two page
 * families is a fact of the document rather than of this control.
 */
function switcherFamilyOf(family: ReviewFamily): VariantFamily {
  return family === "update" ? "update" : "worker-page";
}

/**
 * The candidates this family can review at all.
 *
 * The content module owns the statement of which audience a family admits, and this applies it once
 * so the selector and the decision see the same set: an Update may be reviewed for either audience
 * while a Page is reviewed as a public locale edition. An edition the family does not admit is
 * dropped rather than disabled — the panel then offers no decision on it and says nothing about it,
 * which is the same thing it would say if the edition did not exist.
 */
function reviewableCandidatesOf(
  family: ReviewFamily,
  candidates: readonly CandidateView[],
): readonly CandidateView[] {
  const permitted = switcherFamilyOf(family);
  return candidates.filter((candidate) => variantKeyAllowed(permitted, candidate.audience));
}

/**
 * The payload one decision submits, built from the decision, the frozen candidate and the note.
 *
 * The note is trimmed here, once, so a payload never carries trailing whitespace the mutation would
 * have to strip and a note that is only whitespace becomes the empty string the mutation refuses with
 * a message the reviewer can act on. The frozen identity travels with every arm: the revision the
 * decision answers cannot be inferred by the service from the context, and the approval additionally
 * carries the checksum, which is what makes an approval answer the content that was read.
 */
function decisionPayloadFor(
  decision: ReviewDecision,
  candidate: CandidateView,
  note: string,
): ReviewDecisionPayload {
  const identity = {
    variantId: candidate.variantId,
    revisionId: candidate.revisionId,
  } as const;
  const trimmedNote = note.trim();

  switch (decision) {
    case "approved":
      return {
        decision: "approved",
        ...identity,
        contentChecksum: candidate.contentChecksum,
      };
    case "changes-requested":
      return { decision: "changes-requested", ...identity, note: trimmedNote };
    case "rejected":
      return { decision: "rejected", ...identity, note: trimmedNote };
  }
}


// ---------------------------------------------------------------------------------------------
// The frozen revision, as the record holds it
// ---------------------------------------------------------------------------------------------

/**
 * The revision under review, named exactly: its edition, its variant, its revision and its checksum.
 *
 * The checksum is printed short and expandable rather than truncated for good, because the reviewer
 * needs two different things from it: a glance that this is the revision they read, and the whole
 * value when they have to name it in a later conversation. The expand control is a real button with
 * an expanded state, so the change is announced rather than left to a silent re-render of the text.
 */
function FrozenRevision({
  candidate,
  level,
}: {
  readonly candidate: CandidateView;
  readonly level: SubHeadingLevel;
}): ReactElement {
  const titleId = useId();
  const checksumId = useId();
  const [fullChecksum, setFullChecksum] = useState(false);

  const Heading = SUB_HEADING_TAG[level];
  const audience = AUDIENCE_WORDS[candidate.audience];
  const checksum = candidate.contentChecksum.trim();
  const shortened = shortChecksumOf(checksum);
  const canShorten = shortened !== checksum;
  const shownChecksum = canShorten && !fullChecksum ? shortened : checksum;
  const revision = candidate.revisionId.trim();
  const variant = candidate.variantId.trim();

  return (
    <section
      aria-labelledby={titleId}
      data-slot="review-frozen-revision"
      data-candidate-audience={candidate.audience}
      data-candidate-locale={candidate.locale.tag}
      className="flex min-w-0 flex-col gap-3"
    >
      <Heading id={titleId} className="text-base font-medium text-pretty">
        {FROZEN_HEADING}
      </Heading>

      <dl className="grid min-w-0 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Edition</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge label={audience.label} tone={audience.tone} />
          <bdi lang={candidate.locale.tag} className="min-w-0 wrap-anywhere">
            {candidate.locale.tag}
          </bdi>
        </dd>

        <dt className="text-muted-foreground">Variant</dt>
        <dd className="min-w-0 wrap-anywhere">
          {variant === "" ? (
            <span className="text-muted-foreground">{NOT_STATED_TEXT}</span>
          ) : (
            <bdi className="mono-identifier">{variant}</bdi>
          )}
        </dd>

        <dt className="text-muted-foreground">Revision under review</dt>
        <dd className="min-w-0 wrap-anywhere">
          {revision === "" ? (
            <span className="text-muted-foreground">{NOT_STATED_TEXT}</span>
          ) : (
            <bdi className="mono-identifier">{revision}</bdi>
          )}
        </dd>

        <dt className="text-muted-foreground">Content checksum</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {checksum === "" ? (
            <span className="text-muted-foreground">{NOT_STATED_TEXT}</span>
          ) : (
            <bdi id={checksumId} className="mono-identifier min-w-0 wrap-anywhere">
              {shownChecksum}
            </bdi>
          )}
          {canShorten ? (
            /* The control names what pressing it does and states its current condition through
             * `aria-expanded`, so a screen-reader user hears both the action and the fact. */
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="min-h-target"
              aria-expanded={fullChecksum}
              aria-controls={checksumId}
              onClick={() => {
                setFullChecksum((shown) => !shown);
              }}
            >
              {fullChecksum ? "Show the short checksum" : "Show the full checksum"}
            </Button>
          ) : null}
        </dd>
      </dl>

      <p className="text-sm text-muted-foreground text-pretty">{FROZEN_EXPLANATION}</p>

      {candidate.staleTranslation === true ? (
        /* A static caution rather than a live notification: `Alert`'s default `role="alert"` would
         * announce it on every render, and this sentence is reading matter, not an event. */
        <Alert variant="default" role={undefined} data-slot="review-stale-translation">
          <AlertTitle>This is a translation of an edition that has changed</AlertTitle>
          <AlertDescription>
            <p>{lifecycleSpecOf("stale-translation").explanation}</p>
            <p>
              Approving it approves this language edition as it stands. The source having moved on
              withdraws nothing here and re-opens nothing for review.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The author's publish choice, as a fact
// ---------------------------------------------------------------------------------------------

/**
 * What the author asked to happen after approval, displayed and never offered as a control.
 *
 * The two choices are one badge word and one sentence each, so the fact is readable without a
 * disabled input that would look like something the reviewer could change. Both simulated boundaries
 * are disclosed here, where the reviewer is deciding: the release and — when a notice is requested —
 * the submitted mail are separate labels, because publication is not delivery.
 */
function PublishIntent({
  notifyRequestedByAuthor,
  protectedNoticeScope,
  level,
}: {
  readonly notifyRequestedByAuthor: boolean;
  readonly protectedNoticeScope?: string;
  readonly level: SubHeadingLevel;
}): ReactElement {
  const titleId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const scope = protectedNoticeScope?.trim() ?? "";

  return (
    <section
      aria-labelledby={titleId}
      data-slot="review-publish-intent"
      data-notify-requested={notifyRequestedByAuthor ? "true" : "false"}
      className="flex min-w-0 flex-col gap-3"
    >
      <Heading id={titleId} className="text-base font-medium text-pretty">
        {INTENT_HEADING}
      </Heading>

      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge
            label={notifyRequestedByAuthor ? NOTIFY_BADGE : PUBLISH_ONLY_BADGE}
            tone={notifyRequestedByAuthor ? "info" : "neutral"}
          />
          <span className="min-w-0 text-pretty">
            {notifyRequestedByAuthor ? NOTIFY_SENTENCE : PUBLISH_ONLY_SENTENCE}
          </span>
        </p>
        <p className="text-muted-foreground text-pretty">{REVIEWER_CANNOT_FLIP_SENTENCE}</p>
        {notifyRequestedByAuthor && scope !== "" ? (
          <p className="text-muted-foreground text-pretty">
            {`The notices would carry only this: ${scope}`}
          </p>
        ) : null}
      </div>

      <SimulationLabel effect="publication-reach" />
      {notifyRequestedByAuthor ? <SimulationLabel effect="mail-submission" /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The candidate, as the renderer produced it
// ---------------------------------------------------------------------------------------------

/**
 * The frozen revision, framed.
 *
 * The HTML is the renderer's output for this revision and is displayed as it arrived. It is framed in
 * a sandboxed document rather than inserted into this page, for two reasons that both matter to a
 * reviewer: the frame runs no scripts, cannot navigate, submit a form or open a window, so the
 * revision cannot act on the reviewer's session; and the frame carries the edition's own language and
 * direction, so a right-to-left candidate reads right to left without the surrounding page being
 * mirrored. `allow-same-origin` is the one permission granted, so the frame's own requests for the
 * scoped renditions carry the session they were admitted under — and without scripts that permission
 * leaves the content no way back into this page.
 *
 * The rendition list beneath the frame names what the revision references and links to the exact URLs
 * the read supplied: the panel builds no address of its own, so a link here cannot widen an admission.
 */
function CandidatePreview({
  candidate,
  level,
}: {
  readonly candidate: CandidateView;
  readonly level: SubHeadingLevel;
}): ReactElement {
  const titleId = useId();
  const mediaLabelId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const audience = AUDIENCE_WORDS[candidate.audience];
  const frameTitle = `Frozen revision of the ${audience.label} edition in ${candidate.locale.tag}`;
  const frameDocument = previewDocumentOf(candidate.renderedHtml, candidate.locale, frameTitle);

  return (
    <section
      aria-labelledby={titleId}
      data-slot="review-preview"
      className="flex min-w-0 flex-col gap-3"
    >
      <Heading id={titleId} className="text-base font-medium text-pretty">
        {PREVIEW_HEADING}
      </Heading>

      {candidate.renderedHtml.trim() === "" ? (
        /* A read that carried no rendered body is stated rather than framed: an empty frame would
         * look like a revision whose content is blank, which is a different and false claim. */
        <p className="text-sm text-muted-foreground text-pretty">{NO_RENDERED_BODY_NOTICE}</p>
      ) : (
        /* The wrapper takes the edition's direction so the frame sits in a block that already reads
         * the right way round; the framed document carries it too, which is what a reader's assistive
         * technology actually follows. */
        <div
          dir={candidate.locale.direction}
          className="min-w-0 overflow-hidden rounded-lg border border-border"
        >
          <iframe
            title={frameTitle}
            srcDoc={frameDocument}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            data-slot="review-candidate-frame"
            className="block h-96 max-h-[70svh] min-h-64 w-full border-0 bg-background"
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground text-pretty">{PREVIEW_EXPLANATION}</p>

      {candidate.mediaRenditions.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <p id={mediaLabelId} className="font-medium text-pretty">
            {MEDIA_LABEL}
          </p>
          <ul aria-labelledby={mediaLabelId} className="flex min-w-0 flex-col gap-1">
            {candidate.mediaRenditions.map((rendition) => {
              const purpose = RENDITION_PURPOSE_WORDS[rendition.purpose];
              return (
                <li
                  key={`${rendition.purpose}-${rendition.url}`}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <span className="min-w-0 text-muted-foreground wrap-anywhere">{purpose}</span>
                  {/* A supplied address, used as it stands. It opens away from this page so the
                   * note a reviewer has typed is still here when they come back. */}
                  <a
                    href={rendition.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-target items-center underline underline-offset-4 wrap-anywhere"
                  >
                    {`${OPEN_RENDITION_PREFIX} ${purpose.toLowerCase()}`}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The other editions, when a release attempt left one where it stood
// ---------------------------------------------------------------------------------------------

/**
 * What the document's other editions stand in, stated without a batch claim.
 *
 * A release attempt reports one outcome per selected edition, and a sibling's failure preserves the
 * edition that succeeded. Showing that here — with the state word a reader would meet and, where it
 * applies, the sentence saying the earlier release was not rolled back — keeps "needs attention" a
 * complete result instead of letting one failure read as a batch that undid everything.
 */
function SiblingStanding({
  standing,
  activeVariantId,
  level,
}: {
  readonly standing: readonly ReviewSiblingStanding[];
  readonly activeVariantId: string;
  readonly level: SubHeadingLevel;
}): ReactElement | null {
  const titleId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const activeId = activeVariantId.trim();
  const others = standing.filter((edition) => edition.variantId !== activeId);

  if (others.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={titleId}
      data-slot="review-sibling-standing"
      className="flex min-w-0 flex-col gap-3"
    >
      <Heading id={titleId} className="text-base font-medium text-pretty">
        {SIBLING_HEADING}
      </Heading>
      <ul className="flex min-w-0 flex-col gap-3 text-sm">
        {others.map((edition) => {
          const audience = AUDIENCE_WORDS[edition.audience];
          const lifecycle = lifecycleSpecOf(edition.lifecycle);
          return (
            <li key={edition.variantId} className="flex min-w-0 flex-col gap-1">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge label={audience.label} tone={audience.tone} />
                <bdi lang={edition.locale.tag} className="min-w-0 wrap-anywhere">
                  {edition.locale.tag}
                </bdi>
                <StatusBadge label={lifecycle.label} tone={lifecycle.tone} />
              </span>
              {lifecycle.explanation.trim() === "" ? null : (
                <span className="text-pretty text-muted-foreground">{lifecycle.explanation}</span>
              )}
              {edition.heldPriorGoodRelease === true ? (
                <span className="text-pretty">{HELD_PRIOR_GOOD_SENTENCE}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

/**
 * The reviewer's decision for one frozen candidate, from the choice to the receipt.
 *
 * The component is mounted per edition — the panel keys it by the variant — so an outcome can never
 * be read against an edition it does not belong to, and the note a reviewer typed for one language
 * cannot travel to another. It owns exactly two transient facts, the chosen decision and the note, and
 * one consequence of the attempt: whether this candidate has been answered. Once it has, the choices
 * are disabled rather than left editable under a step that will not submit again — an input that looks
 * live but cannot be used is a false affordance.
 *
 * The note is kept independently of the decision, so choosing Approve after typing one loses nothing;
 * the field's description says plainly that an approval sends no note, which is the only honest thing
 * to say about a value that is deliberately not submitted.
 */
function DecisionStep({
  candidate,
  scope,
  expectedRevision,
  onDecide,
  level,
}: {
  readonly candidate: CandidateView;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly onDecide: (input: MutationInput<ReviewDecisionPayload>) => Promise<MutationOutcome>;
  readonly level: SubHeadingLevel;
}): ReactElement {
  const idPrefix = useId();
  const [decision, setDecision] = useState<ReviewDecision>("approved");
  const [note, setNote] = useState("");
  const [settled, setSettled] = useState(false);

  const copy = DECISION_COPY[decision];
  const requiresNote = decision !== "approved";
  const payload = decisionPayloadFor(decision, candidate, note);

  return (
    <div
      data-slot="review-decision"
      data-decision={decision}
      data-answered={settled ? "true" : "false"}
      className="flex min-w-0 flex-col gap-5"
    >
      <FormFieldGroup
        legend={DECISION_LEGEND}
        name="review.decision"
        description={DECISION_DESCRIPTION}
        required
      >
        {({ describedBy, invalid, required, legendId }) => (
          <RadioGroup
            value={decision}
            onValueChange={(reported: unknown) => {
              /* Only a value the closed set names becomes the decision; anything else leaves the
               * reviewer's current choice standing rather than selecting something unlabelled. */
              const chosen = reviewDecisionOf(reported);
              if (chosen !== null) {
                setDecision(chosen);
              }
            }}
            disabled={settled}
            aria-labelledby={legendId}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-required={required}
          >
            {REVIEW_DECISIONS.map((option) => {
              const optionCopy = DECISION_COPY[option];
              const optionId = `${idPrefix}-decision-${option}`;
              const optionDescriptionId = `${optionId}-description`;
              return (
                /* The label wraps its radio and names it, so the whole row is a pointer target of at
                 * least the 24x24 CSS px floor and the accessible name is the visible word. The
                 * option's explanation is associated rather than inlined, so a reader hears what the
                 * choice does without the group repeating it once per option. */
                <label
                  key={option}
                  htmlFor={optionId}
                  className="flex min-h-target items-start gap-3 py-1"
                >
                  <RadioGroupItem
                    id={optionId}
                    value={option}
                    aria-label={optionCopy.label}
                    aria-describedby={optionDescriptionId}
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{optionCopy.label}</span>
                    <span id={optionDescriptionId} className="text-sm text-muted-foreground">
                      {optionCopy.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </FormFieldGroup>

      <FormField
        label={NOTE_LABEL}
        name="review.note"
        description={requiresNote ? NOTE_REQUIRED_DESCRIPTION : NOTE_OPTIONAL_DESCRIPTION}
        required={requiresNote}
        optionalHint={!requiresNote}
      >
        {(field) => (
          <Textarea
            id={field.id}
            name="review.note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            rows={4}
            maxLength={REVIEW_NOTE_MAX_CHARS}
            disabled={settled}
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid}
            aria-required={field.required}
            /* The design system's textarea inherits its colour, and the surrounding field would hand
             * it the muted surface tint; the value a person typed is body text and takes the body
             * colour so it stays above the AA contrast minimum on the tinted surface. */
            className="min-h-24 text-foreground"
          />
        )}
      </FormField>

      {settled ? (
        <p className="text-sm text-muted-foreground text-pretty">
          This candidate is answered, so its decision is fixed. Anything further comes from the author
          as a new submission with a new revision.
        </p>
      ) : null}

      <ActionReview<ReviewDecisionPayload>
        title={copy.title}
        description={
          <>
            <p className="text-pretty">{APPROVAL_IS_PER_VARIANT_SENTENCE}</p>
            <p className="text-pretty">{APPROVAL_IS_NOT_DELIVERY_SENTENCE}</p>
          </>
        }
        consequence={copy.consequence}
        confirmLabel={copy.confirmLabel}
        consequential={copy.consequential}
        input={{ scope, expectedRevision, payload }}
        submit={onDecide}
        fieldLabels={NOTE_FIELD_LABELS}
        headingLevel={level}
        onSettled={(outcome) => {
          /* Only a settled outcome fixes the decision. A conflict, a refusal, an unreadable source
           * and an unconfirmed attempt all leave the choices editable, because the reviewer has to
           * change or replay them and the note they wrote is what the receipt compares against. */
          if (
            outcome.outcome === "accepted" ||
            outcome.outcome === "alreadyAccepted" ||
            outcome.outcome === "unchanged"
          ) {
            setSettled(true);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------

/**
 * The one review surface.
 *
 * Composed of four parts, in the order a reviewer needs them: which edition is under review, the
 * frozen revision named exactly, what approval would let happen, and what a released reader would
 * see; then, where policy requires it, the single decision. The parts are static reading — the panel
 * itself announces nothing on mount — because the only announcement that belongs here is the
 * receipt's, and one outcome speaks once.
 *
 * It holds no state of its own: the edition on screen, whether policy requires review and the author's
 * publish choice are facts of the read that reached the feature, and the transient decision state
 * lives in the step keyed by the edition it belongs to.
 */
export function ReviewPanel({
  family,
  candidates,
  activeVariantId,
  onSelect,
  policyRequiresReview,
  notifyRequestedByAuthor,
  protectedNoticeScope,
  scope,
  expectedRevision,
  onDecide,
  siblingStanding,
  headingLevel = 2,
  className,
}: ReviewPanelProps): ReactElement {
  const titleId = useId();
  const Heading = PANEL_HEADING_TAG[headingLevel];
  const partLevel = subHeadingLevelOf(headingLevel);
  const copy = FAMILY_COPY[family];

  const activeId = activeVariantId.trim();
  /* The family's own audience rule is applied once, here, so the switcher and the decision cannot
   * disagree: an edition the family does not admit is not offered, and nothing says one exists. */
  const reviewable = reviewableCandidatesOf(family, candidates);
  const active = reviewable.find((candidate) => candidate.variantId === activeId);
  const tabs = variantTabsOf(reviewable);
  const standing = siblingStanding ?? [];
  const nothingToReview = reviewable.length === 0;

  return (
    <section
      aria-labelledby={titleId}
      data-slot="review-panel"
      data-family={family}
      data-policy-requires-review={policyRequiresReview ? "true" : "false"}
      className={cn("flex min-w-0 flex-col gap-6", className)}
    >
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <Heading id={titleId} className="text-pretty">
              {copy.title}
            </Heading>
          </CardTitle>
          <CardDescription className="text-pretty">{copy.introduction}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-6">
          {nothingToReview ? (
            <p className="text-sm text-muted-foreground text-pretty">{NO_CANDIDATE_NOTICE}</p>
          ) : (
            /* The switcher is the one edition selector every content surface composes, so "which
             * edition is on screen" is asked in one vocabulary in the review panel and in the editor.
             * It writes nothing: selecting an edition asks the feature, which owns the route fact. */
            <VariantSwitcher
              family={switcherFamilyOf(family)}
              variants={tabs}
              activeVariantId={activeId}
              onSelect={onSelect}
              label={EDITION_LABEL}
            />
          )}

          {active === undefined && !nothingToReview ? (
            <p className="text-sm text-muted-foreground text-pretty">{NO_ACTIVE_NOTICE}</p>
          ) : null}

          {active === undefined ? null : (
            <>
              <Separator />
              <FrozenRevision candidate={active} level={partLevel} />
              <Separator />
              <PublishIntent
                notifyRequestedByAuthor={notifyRequestedByAuthor}
                protectedNoticeScope={protectedNoticeScope}
                level={partLevel}
              />
              <Separator />
              <CandidatePreview candidate={active} level={partLevel} />
              {standing.length === 0 ? null : (
                <>
                  <Separator />
                  <SiblingStanding
                    standing={standing}
                    activeVariantId={activeId}
                    level={partLevel}
                  />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {active === undefined ? null : policyRequiresReview ? (
        /* Keyed by the edition so a decision's receipt, its attempt identity and the note written for
         * one language can never appear against another. */
        <DecisionStep
          key={active.variantId}
          candidate={active}
          scope={scope}
          expectedRevision={expectedRevision}
          onDecide={onDecide}
          level={partLevel}
        />
      ) : (
        /* Reading matter, not an event: the same sentence would otherwise be announced whenever the
         * page re-rendered, and nothing here changes as a result. */
        <Alert variant="default" role={undefined} data-slot="review-not-required">
          <AlertTitle>{POLICY_NOT_REQUIRED_HEADING}</AlertTitle>
          <AlertDescription>
            <p>{POLICY_NOT_REQUIRED_SENTENCE}</p>
            <p>{POLICY_NOT_REQUIRED_NOTHING_APPROVED}</p>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

export default ReviewPanel;

