"use client";
import { useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { LIFECYCLE_STATUS, type ContentLifecycleState, type LifecycleSpec } from "@/components/draft-status";
import { FormField, FormFieldGroup } from "@/components/form-field";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge from "@/components/status-badge";
import VariantSwitcher, { AUDIENCE_WORDS, type VariantTab } from "@/components/variant-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DirectionProvider } from "@/components/ui/direction";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { REVIEW_DECISIONS, variantKeyAllowed, type ReviewDecision, type VariantAudience, type VariantFamily, type VariantLocale } from "@/modules/content/variant";
import type { MediaAssetRenditionPurpose, MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
/** What a stored rendition is for, taken from the envelope's closed set rather than restated. */
export type RenditionPurpose = MediaAssetRenditionPurpose;
export type CandidateMediaRendition = { readonly purpose: RenditionPurpose; readonly url: string };
export type RecordedCandidateDecision = {
  readonly decision: ReviewDecision;
  readonly decidedByPrincipalId: string | null;
  /** Whether the principal that gave this answer wrote the frozen revision it answers, as the read states the two identities. */ readonly decidedByAuthor: boolean;
  readonly decidedAt: string | null;
  readonly note: string | null;
};
export type CandidateView = {
  readonly variantId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly revisionId: string;
  readonly contentChecksum: string;
  readonly renderedHtml: string;
  readonly mediaRenditions: readonly CandidateMediaRendition[];
  readonly lifecycle: ContentLifecycleState;
  readonly staleTranslation?: boolean;
  readonly decisionRecord: RecordedCandidateDecision | null;
  /** Whether the principal reading this page wrote the frozen revision, as the read states the two identities. The panel uses it to say whose answer a decision would be; it withholds no decision, because the service records the principal that answers and re-checks the answer on submit. */
  readonly reviewedByAuthor: boolean;
};
export type ApprovedDecisionPayload = { readonly decision: "approved"; readonly variantId: string; readonly revisionId: string; readonly contentChecksum: string };
/** A request for changes: the author needs to act, so a note is required and carried. */
export type ChangesRequestedDecisionPayload = { readonly decision: "changes-requested"; readonly variantId: string; readonly revisionId: string; readonly note: string };
/** A rejection: the candidate ends, and the reason is carried so the author is not left guessing. */
export type RejectedDecisionPayload = { readonly decision: "rejected"; readonly variantId: string; readonly revisionId: string; readonly note: string };
export type ReviewDecisionPayload = ApprovedDecisionPayload | ChangesRequestedDecisionPayload | RejectedDecisionPayload;
export type ReviewFamily = "update" | "page";
export type ReviewSiblingStanding = { readonly variantId: string; readonly audience: VariantAudience; readonly locale: VariantLocale; readonly lifecycle: ContentLifecycleState; readonly heldPriorGoodRelease?: boolean };
export type ReviewPanelProps = {
  readonly family: ReviewFamily;
  readonly candidates: readonly CandidateView[];
  readonly activeVariantId: string;
  readonly onSelect: (variantId: string) => void;
  readonly policyRequiresReview: boolean;
  readonly notifyRequestedByAuthor: boolean;
  readonly protectedNoticeScope?: string;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly onDecide: (input: MutationInput<ReviewDecisionPayload>) => Promise<MutationOutcome>;
  readonly siblingStanding?: readonly ReviewSiblingStanding[];
  readonly headingLevel?: 1 | 2 | 3;
  readonly className?: string;
};
/** The longest note a reviewer may leave. */
export const REVIEW_NOTE_MAX_CHARS = 2000;
const SHORT_CHECKSUM_LENGTH = 12;
const PANEL_HEADING_TAG = { 1: "h1", 2: "h2", 3: "h3" } as const;
const SUB_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
type SubHeadingLevel = keyof typeof SUB_HEADING_TAG;
const subHeadingLevelOf = (panelLevel: keyof typeof PANEL_HEADING_TAG): SubHeadingLevel => (panelLevel === 1 ? 2 : panelLevel === 2 ? 3 : 4);
type FamilyCopy = { readonly title: string; readonly introduction: string };
const FAMILY_COPY: Readonly<Record<ReviewFamily, FamilyCopy>> = {
  update: { title: "Review this Update", introduction: "A review answers the exact revision the author submitted, for one audience and one language. " + "Approving it publishes nothing and notifies nobody: the release is a separate step, and a " + "simulated notice is separate again." },
  page: { title: "Review this Page", introduction: "A review answers the exact revision the author submitted for one language edition of this " + "Page. Approving it publishes nothing and makes the Page public to nobody: release, reach and " + "withdrawal stay separate steps on the Page's own surface." },
};
type DecisionCopy = { readonly label: string; readonly description: string; readonly title: string; readonly confirmLabel: string; readonly consequential: boolean; readonly consequence?: string };
const DECISION_COPY: Readonly<Record<ReviewDecision, DecisionCopy>> = {
  approved: { label: "Approve", description: "The frozen revision is approved for this audience and language and can be published as it " + "stands. Approval itself publishes nothing.", title: "Approve the frozen revision", confirmLabel: "Approve this revision", consequential: false },
  "changes-requested": {
    label: "Request changes",
    description: "The author reads your note and submits a new revision. This candidate is answered, not " + "re-reviewed, and its earlier submission stays on record.",
    title: "Request changes to this revision",
    confirmLabel: "Send this request for changes",
    consequential: false,
  },
  rejected: {
    label: "Reject",
    description: "This candidate ends. The edition keeps whatever it published before, and the author's next " + "attempt is a new submission.",
    title: "Reject this candidate",
    confirmLabel: "Reject this candidate",
    consequential: true,
    consequence: "The candidate is closed and this edition keeps whatever it published before. Nothing is " + "deleted, no release is withdrawn and no message is sent to anyone.",
  },
};
type RecordedDecisionCopy = { readonly title: string; readonly sentence: string };
const RECORDED_DECISION_COPY: Readonly<Record<ReviewDecision, RecordedDecisionCopy>> = {
  approved: { title: "This candidate is approved", sentence: "The reviewer's answer is recorded as an approval for this audience and language. Approval " + "publishes nothing and notifies nobody: releasing the edition is a separate step on its own " + "surface, and a simulated notice is separate again." },
  "changes-requested": { title: "A change to this candidate was requested", sentence: "The reviewer's answer is recorded as a request for changes, so the author's next attempt is a " + "new submission with a new revision. This candidate is answered, not re-reviewed, and its earlier " + "submission stays on record." },
  rejected: { title: "This candidate was rejected", sentence: "The reviewer's answer is recorded as a rejection, so this candidate ends and the author's next " + "attempt is a new submission. Nothing is deleted, no release is withdrawn and no message is sent " + "to anyone." },
};
const RENDITION_PURPOSE_WORDS: Readonly<Record<RenditionPurpose, string>> = { display: "Display image", playback: "Playback video", poster: "Poster image", captions: "Caption track", transcript: "Transcript" };
const FACT_LIST_CLASS = "grid min-w-0 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]";
/** The panel states its own title and each of its parts at the scale of the level they render at, so a part never reads at the same measure as the surface that holds it. */
const PANEL_HEADING_SCALE: Readonly<Record<keyof typeof PANEL_HEADING_TAG, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title" };
const PART_HEADING_SCALE: Readonly<Record<SubHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const COPY = {
  notStated: "Not stated",
  recordedDecisionHeading: "The decision on record",
  decidedByLabel: "Decided by",
  decidedAtLabel: "Decided at",
  decisionNoteLabel: "Note for the author",
  noDecisionNoteText: "No note was left with this answer.",
  decisionInstantSentence: "The instant is stated exactly as the record holds it, in ISO 8601 (UTC), so the same answer reads the same on every device.",
  noFurtherDecisionSentence: "No further decision is offered here: this candidate has already been answered, so a further review needs a new submission with a new revision.",
  noCandidateNotice: "No revision is frozen for review here, so there is nothing to approve or refuse.",
  noActiveNotice: "No edition under review is selected here. Choose the edition you mean from the list above; " + "nothing is approved until you decide on the edition on screen.",
  editionLabel: "Edition under review",
  frozenHeading: "The revision you are reviewing",
  frozenExplanation: "These identify the exact revision the author submitted. A later save is a different revision " + "with a different checksum, so content written after this submission cannot become the revision " + "you approve.",
  intentHeading: "What approval lets happen",
  publishOnlyBadge: "Publish only",
  notifyBadge: "Publish and notify now",
  publishOnlySentence: "The author chose to publish this edition without notifying anyone.",
  notifySentence: "The author chose to publish this edition and then notify the subscribers who are currently " + "eligible for this publisher's Update email purpose.",
  reviewerCannotFlipSentence: "This is the author's choice, shown as a fact. A reviewer cannot turn Publish only into Publish " + "and notify now, or the reverse; if the other choice is the right one, ask for changes and say so " + "in the note.",
  previewHeading: "What a released reader would see",
  previewExplanation: "Shown in its own frame so nothing in the revision can act on this page: it runs no scripts, " + "cannot navigate, submit a form or open a window, and loads only the renditions this review was " + "admitted to read.",
  mediaLabel: "Media in this revision",
  noRenderedBodyNotice: "This revision arrived without a rendered body, so what a released reader would see cannot be " + "shown here. Nothing has been approved; the read that supplied this candidate should be repeated " + "before a decision is given.",
  siblingHeading: "Other editions in this document",
  heldPriorGoodSentence: "Not rolled back: this edition still publishes the revision it published before that attempt, and " + "the failure belongs to the edition the attempt named.",
  approvalIsPerVariantSentence: "This decision answers the edition named above only: approving one language or audience approves " + "no other edition of this document.",
  approvalIsNotDeliverySentence: "A decision is not a publication and not a delivery. It sends no message, and nothing here proves " + "that any reader received or opened anything.",
  selfReviewHeading: "You wrote the revision under review",
  selfReviewSentence:
    "This revision was written by the principal reading it, so approving it records your own review of your own work " +
    "and the decision on record names you as the principal who decided it. A candidate is normally answered by a " +
    "different reviewer, where one is admitted to it; this page states whose answer this one is rather than " +
    "withholding it.",
  authorDecidedSentence: "This answer was the author's own rather than an independent reviewer's: the principal who decided it wrote the revision it answers.",
  decisionLegend: "Your decision",
  decisionDescription: "One decision, given once. If something needs to change, the author's next attempt is a new " + "submission with a new revision — this candidate is not re-reviewed.",
  noteLabel: "Note for the author",
  noteRequiredDescription: `Required for this decision: say what the author needs to know, in up to ${REVIEW_NOTE_MAX_CHARS} characters.`,
  noteOptionalDescription: "Approving needs no note. Anything typed here stays on this page and is sent only if you choose " + `Request changes or Reject. Up to ${REVIEW_NOTE_MAX_CHARS} characters.`,
  policyNotRequiredHeading: "Review is not required for this document",
  policyNotRequiredSentence: "Contributor policy for this document requires no review, so this page offers no decision: there " + "is no candidate to approve, no second round to run and nothing for a reviewer to confirm.",
  policyNotRequiredNothingApproved: "Nothing is approved, published or notified from here. The author's own surface reports what " + "happened when the edition was released.",
  noteFieldLabels: { note: "Note for the author", reason: "Note for the author" },
  openRenditionPrefix: "Open the",
} as const;
const REVIEW_DESCRIPTION = (
  <>
    <p className="text-pretty">{COPY.approvalIsPerVariantSentence}</p>
    <p className="text-pretty">{COPY.approvalIsNotDeliverySentence}</p>
  </>
);
const reviewDecisionOf = (value: unknown): ReviewDecision | null => (typeof value === "string" ? (REVIEW_DECISIONS.find((decision) => decision === value) ?? null) : null);
const lifecycleSpecOf = (state: ContentLifecycleState): LifecycleSpec => LIFECYCLE_STATUS[state] ?? { label: String(state), tone: "muted", explanation: "" };
const shortChecksumOf = (checksum: string): string => (checksum.trim().length <= SHORT_CHECKSUM_LENGTH ? checksum.trim() : `${checksum.trim().slice(0, SHORT_CHECKSUM_LENGTH)}…`);
const escapeAttribute = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const previewDocumentOf = (html: string, locale: VariantLocale, title: string): string => "<!doctype html>" + `<html lang="${escapeAttribute(locale.tag)}" dir="${escapeAttribute(locale.direction)}">` + `<head><meta charset="utf-8"><title>${escapeAttribute(title)}</title></head>` + `<body>${html}</body>` + "</html>";
const lifecycleOfDecision = (decision: ReviewDecision | null, edition: ContentLifecycleState): ContentLifecycleState => (decision === "approved" ? "approved" : edition);
const decisionOf = (candidate: CandidateView): ReviewDecision | null => candidate.decisionRecord?.decision ?? null;
const variantTabsOf = (candidates: readonly CandidateView[]): readonly VariantTab[] => candidates.map((candidate) => ({ variantId: candidate.variantId, audience: candidate.audience, locale: candidate.locale, lifecycle: lifecycleOfDecision(decisionOf(candidate), candidate.lifecycle) }));
const switcherFamilyOf = (family: ReviewFamily): VariantFamily => (family === "update" ? "update" : "worker-page");
const reviewableCandidatesOf = (family: ReviewFamily, candidates: readonly CandidateView[]): readonly CandidateView[] => candidates.filter((candidate) => variantKeyAllowed(switcherFamilyOf(family), candidate.audience));
function decisionPayloadFor(decision: ReviewDecision, candidate: CandidateView, note: string): ReviewDecisionPayload {
  const identity = { variantId: candidate.variantId, revisionId: candidate.revisionId } as const;
  const trimmedNote = note.trim();
  switch (decision) {
    case "approved":
      return { decision: "approved", ...identity, contentChecksum: candidate.contentChecksum };
    case "changes-requested":
      return { decision: "changes-requested", ...identity, note: trimmedNote };
    case "rejected":
      return { decision: "rejected", ...identity, note: trimmedNote };
  }
}
function FrozenRevision({ candidate, level }: { readonly candidate: CandidateView; readonly level: SubHeadingLevel }): ReactElement {
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
    <section aria-labelledby={titleId} data-slot="review-frozen-revision" data-candidate-audience={candidate.audience} data-candidate-locale={candidate.locale.tag} className="flex min-w-0 flex-col gap-3">
      <Heading {...{ id: titleId, className: cn(PART_HEADING_SCALE[level], "text-pretty") }}>{COPY.frozenHeading}</Heading>
      <dl className={FACT_LIST_CLASS}>
        <dt className="text-muted-foreground">Edition</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge label={audience.label} tone={audience.tone} />
          <bdi {...{ lang: candidate.locale.tag, className: "min-w-0 wrap-anywhere" }}>{candidate.locale.tag}</bdi>
        </dd>
        <dt className="text-muted-foreground">Variant</dt>
        <dd className="min-w-0 wrap-anywhere">{variant === "" ? <span className="text-muted-foreground">{COPY.notStated}</span> : <bdi className="mono-identifier">{variant}</bdi>}</dd>
        <dt className="text-muted-foreground">Revision under review</dt>
        <dd className="min-w-0 wrap-anywhere">{revision === "" ? <span className="text-muted-foreground">{COPY.notStated}</span> : <bdi className="mono-identifier">{revision}</bdi>}</dd>
        <dt className="text-muted-foreground">Content checksum</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {checksum === "" ? <span className="text-muted-foreground">{COPY.notStated}</span> : <bdi {...{ id: checksumId, className: "mono-identifier min-w-0 wrap-anywhere" }}>{shownChecksum}</bdi>}
          {canShorten ? (
            <Button type="button" variant="ghost" size="xs" className="min-h-target" aria-expanded={fullChecksum} aria-controls={checksumId} onClick={() => setFullChecksum((shown) => !shown)}>
              {fullChecksum ? "Show the short checksum" : "Show the full checksum"}
            </Button>
          ) : null}
        </dd>
      </dl>
      <p className="text-sm text-muted-foreground text-pretty">{COPY.frozenExplanation}</p>
      {candidate.staleTranslation === true ? (
        <Alert variant="default" role={undefined} data-slot="review-stale-translation">
          <AlertTitle>This is a translation of an edition that has changed</AlertTitle>
          <AlertDescription>
            <p>{lifecycleSpecOf("stale-translation").explanation}</p>
            <p>Approving it approves this language edition as it stands. The source having moved on withdraws nothing here and re-opens nothing for review.</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
function PublishIntent({ notifyRequestedByAuthor, protectedNoticeScope, level }: { readonly notifyRequestedByAuthor: boolean; readonly protectedNoticeScope?: string; readonly level: SubHeadingLevel }): ReactElement {
  const titleId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const scope = protectedNoticeScope?.trim() ?? "";
  return (
    <section aria-labelledby={titleId} data-slot="review-publish-intent" data-notify-requested={notifyRequestedByAuthor ? "true" : "false"} className="flex min-w-0 flex-col gap-3">
      <Heading {...{ id: titleId, className: cn(PART_HEADING_SCALE[level], "text-pretty") }}>{COPY.intentHeading}</Heading>
      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge label={notifyRequestedByAuthor ? COPY.notifyBadge : COPY.publishOnlyBadge} tone={notifyRequestedByAuthor ? "info" : "neutral"} />
          <span className="min-w-0 text-pretty">{notifyRequestedByAuthor ? COPY.notifySentence : COPY.publishOnlySentence}</span>
        </p>
        <p className="text-muted-foreground text-pretty">{COPY.reviewerCannotFlipSentence}</p>
        {notifyRequestedByAuthor && scope !== "" ? <p className="text-muted-foreground text-pretty">{`The notices would carry only this: ${scope}`}</p> : null}
      </div>
      <SimulationLabel effect="publication-reach" />
      {notifyRequestedByAuthor ? <SimulationLabel effect="mail-submission" /> : null}
    </section>
  );
}
function CandidatePreview({ candidate, level }: { readonly candidate: CandidateView; readonly level: SubHeadingLevel }): ReactElement {
  const titleId = useId();
  const mediaLabelId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const audience = AUDIENCE_WORDS[candidate.audience];
  const frameTitle = `Frozen revision of the ${audience.label} edition in ${candidate.locale.tag}`;
  const frameDocument = previewDocumentOf(candidate.renderedHtml, candidate.locale, frameTitle);
  return (
    <section aria-labelledby={titleId} data-slot="review-preview" className="flex min-w-0 flex-col gap-3">
      <Heading {...{ id: titleId, className: cn(PART_HEADING_SCALE[level], "text-pretty") }}>{COPY.previewHeading}</Heading>
      {candidate.renderedHtml.trim() === "" ? (
        <p className="text-sm text-muted-foreground text-pretty">{COPY.noRenderedBodyNotice}</p>
      ) : (
        <DirectionProvider direction={candidate.locale.direction}>
          <div dir={candidate.locale.direction} className="min-w-0 overflow-hidden rounded-lg border border-border">
            <iframe title={frameTitle} srcDoc={frameDocument} sandbox="allow-same-origin" referrerPolicy="no-referrer" data-slot="review-candidate-frame" className="block h-96 max-h-[70svh] min-h-64 w-full border-0 bg-background" />
          </div>
        </DirectionProvider>
      )}
      <p className="text-sm text-muted-foreground text-pretty">{COPY.previewExplanation}</p>
      {candidate.mediaRenditions.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <p id={mediaLabelId} className="font-medium text-pretty">
            {COPY.mediaLabel}
          </p>
          <ul aria-labelledby={mediaLabelId} className="flex min-w-0 flex-col gap-1">
            {candidate.mediaRenditions.map((rendition) => {
              const purpose = RENDITION_PURPOSE_WORDS[rendition.purpose];
              return (
                <li key={`${rendition.purpose}-${rendition.url}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 text-muted-foreground wrap-anywhere">{purpose}</span>
                  <a {...{ href: rendition.url, target: "_blank", rel: "noreferrer", className: "inline-flex min-h-target items-center wrap-anywhere inline-link" }}>{`${COPY.openRenditionPrefix} ${purpose.toLowerCase()}`}</a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
function SiblingStanding({ standing, activeVariantId, level }: { readonly standing: readonly ReviewSiblingStanding[]; readonly activeVariantId: string; readonly level: SubHeadingLevel }): ReactElement | null {
  const titleId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const activeId = activeVariantId.trim();
  const others = standing.filter((edition) => edition.variantId !== activeId);
  if (others.length === 0) return null;
  return (
    <section aria-labelledby={titleId} data-slot="review-sibling-standing" className="flex min-w-0 flex-col gap-3">
      <Heading {...{ id: titleId, className: cn(PART_HEADING_SCALE[level], "text-pretty") }}>{COPY.siblingHeading}</Heading>
      <ul className="flex min-w-0 flex-col gap-3 text-sm">
        {others.map((edition) => {
          const audience = AUDIENCE_WORDS[edition.audience];
          const lifecycle = lifecycleSpecOf(edition.lifecycle);
          return (
            <li key={edition.variantId} className="flex min-w-0 flex-col gap-1">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge label={audience.label} tone={audience.tone} />
                <bdi {...{ lang: edition.locale.tag, className: "min-w-0 wrap-anywhere" }}>{edition.locale.tag}</bdi>
                <StatusBadge label={lifecycle.label} tone={lifecycle.tone} />
              </span>
              {lifecycle.explanation.trim() === "" ? null : <span className="text-pretty text-muted-foreground">{lifecycle.explanation}</span>}
              {edition.heldPriorGoodRelease === true ? <span className="text-pretty">{COPY.heldPriorGoodSentence}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
function DecisionStep({ candidate, scope, expectedRevision, onDecide, level }: { readonly candidate: CandidateView; readonly scope: Scope; readonly expectedRevision: string; readonly onDecide: (input: MutationInput<ReviewDecisionPayload>) => Promise<MutationOutcome>; readonly level: SubHeadingLevel }): ReactElement {
  const idPrefix = useId();
  const [decision, setDecision] = useState<ReviewDecision>("approved");
  const [note, setNote] = useState("");
  const [settled, setSettled] = useState(false);
  const copy = DECISION_COPY[decision];
  const requiresNote = decision !== "approved";
  const payload = decisionPayloadFor(decision, candidate, note);
  const chooseDecision = (reported: unknown): void => {
    const chosen = reviewDecisionOf(reported);
    if (chosen !== null) setDecision(chosen);
  };
  const settleIfApplied = (outcome: MutationOutcome): void => {
    if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") setSettled(true);
  };
  return (
    <div data-slot="review-decision" data-decision={decision} data-answered={settled ? "true" : "false"} className="flex min-w-0 flex-col gap-5">
      {candidate.reviewedByAuthor ? (
        <Alert variant="default" role={undefined} data-slot="review-self-review">
          <AlertTitle>{COPY.selfReviewHeading}</AlertTitle>
          <AlertDescription>
            <p className="text-pretty">{COPY.selfReviewSentence}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      <FormFieldGroup legend={COPY.decisionLegend} name="review.decision" description={COPY.decisionDescription} required>
        {({ describedBy, invalid, required, legendId }) => (
          <RadioGroup {...{ value: decision, onValueChange: chooseDecision, disabled: settled, "aria-labelledby": legendId, "aria-describedby": describedBy, "aria-invalid": invalid, "aria-required": required }}>
            {REVIEW_DECISIONS.map((option) => {
              const optionCopy = DECISION_COPY[option];
              const optionId = `${idPrefix}-decision-${option}`;
              const optionDescriptionId = `${optionId}-description`;
              return (
                <label key={option} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                  <RadioGroupItem id={optionId} value={option} aria-label={optionCopy.label} aria-describedby={optionDescriptionId} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{optionCopy.label}</span>
                    <span {...{ id: optionDescriptionId, className: "text-sm text-muted-foreground" }}>{optionCopy.description}</span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </FormFieldGroup>
      <FormField label={COPY.noteLabel} name="review.note" description={requiresNote ? COPY.noteRequiredDescription : COPY.noteOptionalDescription} required={requiresNote} optionalHint={!requiresNote}>
        {(field) => (
          <Textarea id={field.id} name="review.note" value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={REVIEW_NOTE_MAX_CHARS} disabled={settled} aria-describedby={field.describedBy} aria-invalid={field.invalid} aria-required={field.required} className="min-h-24 text-foreground" />
        )}
      </FormField>
      {settled ? <p className="text-sm text-muted-foreground text-pretty">This candidate is answered, so its decision is fixed. Anything further comes from the author as a new submission with a new revision.</p> : null}
      <ActionReview<ReviewDecisionPayload>
        {...{ title: copy.title, description: REVIEW_DESCRIPTION, consequence: copy.consequence, confirmLabel: copy.confirmLabel, consequential: copy.consequential, input: { scope, expectedRevision, payload }, submit: onDecide, fieldLabels: COPY.noteFieldLabels, headingLevel: level, onSettled: settleIfApplied }}
      />
    </div>
  );
}
function RecordedDecision({ record, level }: { readonly record: RecordedCandidateDecision; readonly level: SubHeadingLevel }): ReactElement {
  const titleId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const copy = RECORDED_DECISION_COPY[record.decision];
  const principal = record.decidedByPrincipalId?.trim() ?? "";
  const instant = record.decidedAt?.trim() ?? "";
  const note = record.note?.trim() ?? "";
  return (
    <section aria-labelledby={titleId} data-slot="review-recorded-decision" data-decision={record.decision} className="flex min-w-0 flex-col gap-3">
      <Heading {...{ id: titleId, className: cn(PART_HEADING_SCALE[level], "text-pretty") }}>{COPY.recordedDecisionHeading}</Heading>
      <Alert variant="default" role={undefined}>
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>
          <p className="text-pretty">{copy.sentence}</p>
          {record.decidedByAuthor ? <p {...{ "data-slot": "review-author-decision", className: "text-pretty" }}>{COPY.authorDecidedSentence}</p> : null}
          <dl data-slot="review-decision-record" className={FACT_LIST_CLASS}>
            <dt className="text-muted-foreground">{COPY.decidedByLabel}</dt>
            <dd className="min-w-0 wrap-anywhere">{principal === "" ? <span className="text-muted-foreground">{COPY.notStated}</span> : <bdi className="mono-identifier">{principal}</bdi>}</dd>
            <dt className="text-muted-foreground">{COPY.decidedAtLabel}</dt>
            <dd className="min-w-0 wrap-anywhere">
              {instant === "" ? (
                <span className="text-muted-foreground">{COPY.notStated}</span>
              ) : (
                <bdi>
                  <time {...{ dateTime: instant, className: "mono-identifier tabular-figures" }}>{instant}</time>
                </bdi>
              )}
            </dd>
            <dt className="text-muted-foreground">{COPY.decisionNoteLabel}</dt>
            <dd className="min-w-0">{note === "" ? <span className="text-muted-foreground">{COPY.noDecisionNoteText}</span> : <bdi className="block break-words text-pretty whitespace-pre-wrap">{note}</bdi>}</dd>
          </dl>
          <p className="text-sm text-muted-foreground text-pretty">{COPY.decisionInstantSentence}</p>
          <p className="text-pretty">{COPY.noFurtherDecisionSentence}</p>
        </AlertDescription>
      </Alert>
    </section>
  );
}
/** The one review surface over frozen content candidates, with approve, changes-requested and reject. */
export function ReviewPanel({ family, candidates, activeVariantId, onSelect, policyRequiresReview, notifyRequestedByAuthor, protectedNoticeScope, scope, expectedRevision, onDecide, siblingStanding, headingLevel = 2, className }: ReviewPanelProps): ReactElement {
  const titleId = useId();
  const Heading = PANEL_HEADING_TAG[headingLevel];
  const partLevel = subHeadingLevelOf(headingLevel);
  const copy = FAMILY_COPY[family];
  const activeId = activeVariantId.trim();
  const reviewable = reviewableCandidatesOf(family, candidates);
  const active = reviewable.find((candidate) => candidate.variantId === activeId);
  const tabs = variantTabsOf(reviewable);
  const standing = siblingStanding ?? [];
  const nothingToReview = reviewable.length === 0;
  return (
    <section aria-labelledby={titleId} data-slot="review-panel" data-family={family} data-policy-requires-review={policyRequiresReview ? "true" : "false"} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <Heading {...{ id: titleId, className: cn(PANEL_HEADING_SCALE[headingLevel], "text-pretty") }}>{copy.title}</Heading>
          </CardTitle>
          <CardDescription className="text-pretty">{copy.introduction}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-6">
          {nothingToReview ? <p className="text-sm text-muted-foreground text-pretty">{COPY.noCandidateNotice}</p> : <VariantSwitcher family={switcherFamilyOf(family)} variants={tabs} activeVariantId={activeId} onSelect={onSelect} label={COPY.editionLabel} />}
          {active === undefined && !nothingToReview ? <p className="text-sm text-muted-foreground text-pretty">{COPY.noActiveNotice}</p> : null}
          {active === undefined ? null : (
            <>
              <Separator />
              <FrozenRevision candidate={active} level={partLevel} />
              <Separator />
              <PublishIntent notifyRequestedByAuthor={notifyRequestedByAuthor} protectedNoticeScope={protectedNoticeScope} level={partLevel} />
              <Separator />
              <CandidatePreview candidate={active} level={partLevel} />
              {standing.length === 0 ? null : (
                <>
                  <Separator />
                  <SiblingStanding standing={standing} activeVariantId={activeId} level={partLevel} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {active === undefined ? null : active.decisionRecord !== null ? (
        <RecordedDecision record={active.decisionRecord} level={partLevel} />
      ) : policyRequiresReview ? (
        <DecisionStep key={active.variantId} candidate={active} scope={scope} expectedRevision={expectedRevision} onDecide={onDecide} level={partLevel} />
      ) : (
        <Alert variant="default" role={undefined} data-slot="review-not-required">
          <AlertTitle>{COPY.policyNotRequiredHeading}</AlertTitle>
          <AlertDescription>
            <p>{COPY.policyNotRequiredSentence}</p>
            <p>{COPY.policyNotRequiredNothingApproved}</p>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
export default ReviewPanel;
