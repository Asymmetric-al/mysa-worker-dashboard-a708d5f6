"use client";
/**
 * The one review surface for both content families: the frozen revision a reviewer answers, and the
 * single decision they can give it.
 *
 * A candidate whose answer is already recorded is reported as that record, with no decision offered:
 * the review step answers a submission once, and a surface that kept asking would offer an action the
 * review mutations refuse.
 */
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { REVIEW_DECISIONS, variantKeyAllowed, type ReviewDecision, type VariantAudience, type VariantFamily, type VariantLocale } from "@/modules/content/variant";
import type { MediaAssetRenditionPurpose, MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
// The frozen candidate, as the service returns it
/** What a stored rendition is for, taken from the envelope's closed set rather than restated. */
export type RenditionPurpose = MediaAssetRenditionPurpose;
/** One scoped rendition the candidate's rendering referenced, with the URL the read admitted. */
export interface CandidateMediaRendition {
  readonly purpose: RenditionPurpose;
  readonly url: string;
}
/** One frozen candidate, exactly as the review read returned it. */
export interface CandidateView {
  readonly variantId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly revisionId: string;
  readonly contentChecksum: string;
  readonly renderedHtml: string;
  readonly mediaRenditions: readonly CandidateMediaRendition[];
  readonly staleTranslation?: boolean;
  /**
   * The decision the reviewer recorded for this candidate, as the read states it, or `null` while its
   * record still stands at `submitted` — the one state in which the decision is the reviewer's to give.
   */
  readonly decision: ReviewDecision | null;
}
// The decision's payload
/** The decision the reviewer gave, and the frozen identity it answers. */
export interface ApprovedDecisionPayload {
  readonly decision: "approved";
  readonly variantId: string;
  readonly revisionId: string;
  readonly contentChecksum: string;
}
/** A request for changes: the author needs to act, so a note is required and carried. */
export interface ChangesRequestedDecisionPayload {
  readonly decision: "changes-requested";
  readonly variantId: string;
  readonly revisionId: string;
  readonly note: string;
}
/** A rejection: the candidate ends, and the reason is carried so the author is not left guessing. */
export interface RejectedDecisionPayload {
  readonly decision: "rejected";
  readonly variantId: string;
  readonly revisionId: string;
  readonly note: string;
}
/** One review answer with the frozen identity it answers. */
export type ReviewDecisionPayload = ApprovedDecisionPayload | ChangesRequestedDecisionPayload | RejectedDecisionPayload;
// The panel's props
/** The two content families a review serves. */
export type ReviewFamily = "update" | "page";
/** What another edition of the same document stands in after a release attempt. */
export interface ReviewSiblingStanding {
  readonly variantId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly lifecycle: ContentLifecycleState;
  readonly heldPriorGoodRelease?: boolean;
}
/** Props of {@link ReviewPanel}. */
export interface ReviewPanelProps {
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
  readonly headingLevel?: 2 | 3;
  readonly className?: string;
}
// Words: this surface's vocabulary, declared once
/** The longest note a reviewer may leave. */
export const REVIEW_NOTE_MAX_CHARS = 2000;

const SHORT_CHECKSUM_LENGTH = 12;

const NOT_STATED_TEXT = "Not stated";

const PANEL_HEADING_TAG = { 2: "h2", 3: "h3" } as const;

const SUB_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

type SubHeadingLevel = keyof typeof SUB_HEADING_TAG;

function subHeadingLevelOf(panelLevel: 2 | 3): SubHeadingLevel {
  return panelLevel === 2 ? 3 : 4;
}
interface FamilyCopy {
  readonly title: string;
  readonly introduction: string;
}
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
interface DecisionCopy {
  readonly label: string;
  readonly description: string;
  readonly title: string;
  readonly confirmLabel: string;
  readonly consequential: boolean;
  readonly consequence?: string;
}
const DECISION_COPY: Readonly<Record<ReviewDecision, DecisionCopy>> = {
  approved: {
    label: "Approve",
    description: "The frozen revision is approved for this audience and language and can be published as it " + "stands. Approval itself publishes nothing.",
    title: "Approve the frozen revision",
    confirmLabel: "Approve this revision",
    consequential: false,
  },
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
interface RecordedDecisionCopy {
  readonly title: string;
  readonly sentence: string;
}
/** The words for a candidate that has been answered, so the surface states the record instead of the decision form. */
const RECORDED_DECISION_COPY: Readonly<Record<ReviewDecision, RecordedDecisionCopy>> = {
  approved: {
    title: "This candidate is approved",
    sentence:
      "The reviewer's answer is recorded as an approval for this audience and language. Approval " +
      "publishes nothing and notifies nobody: releasing the edition is a separate step on its own " +
      "surface, and a simulated notice is separate again.",
  },
  "changes-requested": {
    title: "A change to this candidate was requested",
    sentence:
      "The reviewer's answer is recorded as a request for changes, so the author's next attempt is a " +
      "new submission with a new revision. This candidate is answered, not re-reviewed, and its earlier " +
      "submission stays on record.",
  },
  rejected: {
    title: "This candidate was rejected",
    sentence:
      "The reviewer's answer is recorded as a rejection, so this candidate ends and the author's next " +
      "attempt is a new submission. Nothing is deleted, no release is withdrawn and no message is sent " +
      "to anyone.",
  },
};
const RECORDED_DECISION_HEADING = "The decision on record";

const NO_FURTHER_DECISION_SENTENCE = "No further decision is offered here: this candidate has already been answered, so a further review needs a new submission with a new revision.";
const RENDITION_PURPOSE_WORDS: Readonly<Record<RenditionPurpose, string>> = {
  display: "Display image",
  playback: "Playback video",
  poster: "Poster image",
  captions: "Caption track",
  transcript: "Transcript",
};
const NO_CANDIDATE_NOTICE = "No revision is frozen for review here, so there is nothing to approve or refuse.";

const NO_ACTIVE_NOTICE = "No edition under review is selected here. Choose the edition you mean from the list above; " + "nothing is approved until you decide on the edition on screen.";

const EDITION_LABEL = "Edition under review";

const FROZEN_HEADING = "The revision you are reviewing";

const FROZEN_EXPLANATION =
  "These identify the exact revision the author submitted. A later save is a different revision " +
  "with a different checksum, so content written after this submission cannot become the revision " +
  "you approve.";
const INTENT_HEADING = "What approval lets happen";

const PUBLISH_ONLY_BADGE = "Publish only";

const NOTIFY_BADGE = "Publish and notify now";

const PUBLISH_ONLY_SENTENCE = "The author chose to publish this edition without notifying anyone.";

const NOTIFY_SENTENCE = "The author chose to publish this edition and then notify the subscribers who are currently " + "eligible for this publisher's Update email purpose.";

const REVIEWER_CANNOT_FLIP_SENTENCE =
  "This is the author's choice, shown as a fact. A reviewer cannot turn Publish only into Publish " +
  "and notify now, or the reverse; if the other choice is the right one, ask for changes and say so " +
  "in the note.";
const PREVIEW_HEADING = "What a released reader would see";

const PREVIEW_EXPLANATION =
  "Shown in its own frame so nothing in the revision can act on this page: it runs no scripts, " +
  "cannot navigate, submit a form or open a window, and loads only the renditions this review was " +
  "admitted to read.";
const MEDIA_LABEL = "Media in this revision";

const NO_RENDERED_BODY_NOTICE =
  "This revision arrived without a rendered body, so what a released reader would see cannot be " +
  "shown here. Nothing has been approved; the read that supplied this candidate should be repeated " +
  "before a decision is given.";
const SIBLING_HEADING = "Other editions in this document";

const HELD_PRIOR_GOOD_SENTENCE = "Not rolled back: this edition still publishes the revision it published before that attempt, and " + "the failure belongs to the edition the attempt named.";

const APPROVAL_IS_PER_VARIANT_SENTENCE = "This decision answers the edition named above only: approving one language or audience approves " + "no other edition of this document.";

const APPROVAL_IS_NOT_DELIVERY_SENTENCE = "A decision is not a publication and not a delivery. It sends no message, and nothing here proves " + "that any reader received or opened anything.";

const DECISION_LEGEND = "Your decision";

const DECISION_DESCRIPTION = "One decision, given once. If something needs to change, the author's next attempt is a new " + "submission with a new revision — this candidate is not re-reviewed.";

const NOTE_LABEL = "Note for the author";

const NOTE_REQUIRED_DESCRIPTION = `Required for this decision: say what the author needs to know, in up to ${REVIEW_NOTE_MAX_CHARS} characters.`;

const NOTE_OPTIONAL_DESCRIPTION =
  "Approving needs no note. Anything typed here stays on this page and is sent only if you choose " + `Request changes or Reject. Up to ${REVIEW_NOTE_MAX_CHARS} characters.`;
const POLICY_NOT_REQUIRED_HEADING = "Review is not required for this document";

const POLICY_NOT_REQUIRED_SENTENCE =
  "Contributor policy for this document requires no review, so this page offers no decision: there " + "is no candidate to approve, no second round to run and nothing for a reviewer to confirm.";
const POLICY_NOT_REQUIRED_NOTHING_APPROVED = "Nothing is approved, published or notified from here. The author's own surface reports what " + "happened when the edition was released.";

const NOTE_FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  note: NOTE_LABEL,
  reason: NOTE_LABEL,
};
const OPEN_RENDITION_PREFIX = "Open the";
// Reading the values the records carry
function reviewDecisionOf(value: unknown): ReviewDecision | null {
  if (typeof value !== "string") {
    return null;
  }
  const named = REVIEW_DECISIONS.find((decision) => decision === value);
  return named ?? null;
}
function lifecycleSpecOf(state: ContentLifecycleState): LifecycleSpec {
  const spec: LifecycleSpec | undefined = LIFECYCLE_STATUS[state];
  return spec ?? { label: String(state), tone: "muted", explanation: "" };
}
function shortChecksumOf(checksum: string): string {
  const trimmed = checksum.trim();
  if (trimmed.length <= SHORT_CHECKSUM_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, SHORT_CHECKSUM_LENGTH)}…`;
}
function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
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
 * The lifecycle word the edition carries on this surface.
 *
 * A frozen candidate still awaiting its answer is the state the lifecycle vocabulary already names.
 * Once a reviewer approves it, the edition is approved and awaiting a release that is a separate step,
 * so the surface says so rather than claiming a review that has already been given. A refusal clears
 * the edition's candidate, so a read that still holds one is a submission state, which is what the
 * edition record itself states.
 */
function lifecycleOfDecision(decision: ReviewDecision | null): ContentLifecycleState {
  return decision === "approved" ? "approved" : "candidate";
}
function variantTabsOf(candidates: readonly CandidateView[]): readonly VariantTab[] {
  return candidates.map((candidate) => ({
    variantId: candidate.variantId,
    audience: candidate.audience,
    locale: candidate.locale,
    lifecycle: lifecycleOfDecision(candidate.decision),
  }));
}
function switcherFamilyOf(family: ReviewFamily): VariantFamily {
  return family === "update" ? "update" : "worker-page";
}
function reviewableCandidatesOf(family: ReviewFamily, candidates: readonly CandidateView[]): readonly CandidateView[] {
  const permitted = switcherFamilyOf(family);
  return candidates.filter((candidate) => variantKeyAllowed(permitted, candidate.audience));
}
function decisionPayloadFor(decision: ReviewDecision, candidate: CandidateView, note: string): ReviewDecisionPayload {
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
// The frozen revision, as the record holds it
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
        <dd className="min-w-0 wrap-anywhere">{variant === "" ? <span className="text-muted-foreground">{NOT_STATED_TEXT}</span> : <bdi className="mono-identifier">{variant}</bdi>}</dd>
        <dt className="text-muted-foreground">Revision under review</dt>
        <dd className="min-w-0 wrap-anywhere">{revision === "" ? <span className="text-muted-foreground">{NOT_STATED_TEXT}</span> : <bdi className="mono-identifier">{revision}</bdi>}</dd>
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
// The author's publish choice, as a fact
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
    <section aria-labelledby={titleId} data-slot="review-publish-intent" data-notify-requested={notifyRequestedByAuthor ? "true" : "false"} className="flex min-w-0 flex-col gap-3">
      <Heading id={titleId} className="text-base font-medium text-pretty">
        {INTENT_HEADING}
      </Heading>
      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge label={notifyRequestedByAuthor ? NOTIFY_BADGE : PUBLISH_ONLY_BADGE} tone={notifyRequestedByAuthor ? "info" : "neutral"} />
          <span className="min-w-0 text-pretty">{notifyRequestedByAuthor ? NOTIFY_SENTENCE : PUBLISH_ONLY_SENTENCE}</span>
        </p>
        <p className="text-muted-foreground text-pretty">{REVIEWER_CANNOT_FLIP_SENTENCE}</p>
        {notifyRequestedByAuthor && scope !== "" ? <p className="text-muted-foreground text-pretty">{`The notices would carry only this: ${scope}`}</p> : null}
      </div>
      <SimulationLabel effect="publication-reach" />
      {notifyRequestedByAuthor ? <SimulationLabel effect="mail-submission" /> : null}
    </section>
  );
}
// The candidate, as the renderer produced it
function CandidatePreview({ candidate, level }: { readonly candidate: CandidateView; readonly level: SubHeadingLevel }): ReactElement {
  const titleId = useId();
  const mediaLabelId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const audience = AUDIENCE_WORDS[candidate.audience];
  const frameTitle = `Frozen revision of the ${audience.label} edition in ${candidate.locale.tag}`;
  const frameDocument = previewDocumentOf(candidate.renderedHtml, candidate.locale, frameTitle);
  return (
    <section aria-labelledby={titleId} data-slot="review-preview" className="flex min-w-0 flex-col gap-3">
      <Heading id={titleId} className="text-base font-medium text-pretty">
        {PREVIEW_HEADING}
      </Heading>
      {candidate.renderedHtml.trim() === "" ? (
        <p className="text-sm text-muted-foreground text-pretty">{NO_RENDERED_BODY_NOTICE}</p>
      ) : (
        <div dir={candidate.locale.direction} className="min-w-0 overflow-hidden rounded-lg border border-border">
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
                <li key={`${rendition.purpose}-${rendition.url}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 text-muted-foreground wrap-anywhere">{purpose}</span>
                  {/* A supplied address, used as it stands. It opens away from this page so the
                   * note a reviewer has typed is still here when they come back. */}
                  <a href={rendition.url} target="_blank" rel="noreferrer" className="inline-flex min-h-target items-center underline underline-offset-4 wrap-anywhere">
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
// The other editions, when a release attempt left one where it stood
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
    <section aria-labelledby={titleId} data-slot="review-sibling-standing" className="flex min-w-0 flex-col gap-3">
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
              {lifecycle.explanation.trim() === "" ? null : <span className="text-pretty text-muted-foreground">{lifecycle.explanation}</span>}
              {edition.heldPriorGoodRelease === true ? <span className="text-pretty">{HELD_PRIOR_GOOD_SENTENCE}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
// The decision
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
    <div data-slot="review-decision" data-decision={decision} data-answered={settled ? "true" : "false"} className="flex min-w-0 flex-col gap-5">
      <FormFieldGroup legend={DECISION_LEGEND} name="review.decision" description={DECISION_DESCRIPTION} required>
        {({ describedBy, invalid, required, legendId }) => (
          <RadioGroup
            value={decision}
            onValueChange={(reported: unknown) => {
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
                <label key={option} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                  <RadioGroupItem id={optionId} value={option} aria-label={optionCopy.label} aria-describedby={optionDescriptionId} className="mt-0.5" />
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
      <FormField label={NOTE_LABEL} name="review.note" description={requiresNote ? NOTE_REQUIRED_DESCRIPTION : NOTE_OPTIONAL_DESCRIPTION} required={requiresNote} optionalHint={!requiresNote}>
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
            className="min-h-24 text-foreground"
          />
        )}
      </FormField>
      {settled ? (
        <p className="text-sm text-muted-foreground text-pretty">
          This candidate is answered, so its decision is fixed. Anything further comes from the author as a new submission with a new revision.
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
          if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") {
            setSettled(true);
          }
        }}
      />
    </div>
  );
}
// The answer, when one is already recorded
function RecordedDecision({ decision, level }: { readonly decision: ReviewDecision; readonly level: SubHeadingLevel }): ReactElement {
  const titleId = useId();
  const Heading = SUB_HEADING_TAG[level];
  const copy = RECORDED_DECISION_COPY[decision];
  return (
    <section aria-labelledby={titleId} data-slot="review-recorded-decision" data-decision={decision} className="flex min-w-0 flex-col gap-3">
      <Heading id={titleId} className="text-base font-medium text-pretty">
        {RECORDED_DECISION_HEADING}
      </Heading>
      <Alert variant="default" role={undefined}>
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>
          <p className="text-pretty">{copy.sentence}</p>
          <p className="text-pretty">{NO_FURTHER_DECISION_SENTENCE}</p>
        </AlertDescription>
      </Alert>
    </section>
  );
}
// The panel
/** The one review surface. */
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
            <VariantSwitcher family={switcherFamilyOf(family)} variants={tabs} activeVariantId={activeId} onSelect={onSelect} label={EDITION_LABEL} />
          )}
          {active === undefined && !nothingToReview ? <p className="text-sm text-muted-foreground text-pretty">{NO_ACTIVE_NOTICE}</p> : null}
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
      {active === undefined ? null : active.decision !== null ? (
        // The read states an answer for this candidate, so the surface reports the record instead of
        // offering a decision the service would refuse as already given.
        <RecordedDecision decision={active.decision} level={partLevel} />
      ) : policyRequiresReview ? (
        <DecisionStep key={active.variantId} candidate={active} scope={scope} expectedRevision={expectedRevision} onDecide={onDecide} level={partLevel} />
      ) : (
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
