"use client";
/**
 * The per-variant grid of one Update: every permitted edition with its own saved draft, frozen candidate and
 * published revision, the translation state of an edition that was written from another language, and the
 * writes this surface may offer.
 *
 * What this file deliberately does not decide. A lifecycle word, a checksum, a count, a frozen revision and a
 * staleness fact are displayed either from the envelope or from the read that owns them (`useCandidate`), never
 * derived here. The four action names the matrix publishes are stated with the read's own reason when one is
 * withheld. The three writes the matrix publishes no name for — submit for review, restore a revision and
 * withdraw — are offered on the record facts the matrix does state, and the service re-checks every one of them
 * on submit, so a stale screen answers `denied` and never performs an unauthorised change.
 */
import Link from "next/link";
import { useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import ActionReview from "@/components/action-review";
import DraftStatus, { LIFECYCLE_STATUS, lifecycleOf } from "@/components/draft-status";
import LocaleSwitcher, { type LocaleEdition } from "@/components/locale-switcher";
import { StateNotice, type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import VariantSwitcher, { AUDIENCE_WORDS, type VariantTab } from "@/components/variant-switcher";
import { cn } from "@/lib/cn";
import type { ContentVariant, Release, VariantAudience } from "@/modules/content/variant";
import type { MutationInput, ReadAction, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import { LOCALE_DISPLAY_NAMES, AUDIENCE_LABELS, DRAFT_VS_RELEASED, REVIEW_ROUND_NOTE, VARIANT_AXIS_NOTE, WITHDRAWAL_WORDING } from "../copy/updates-copy";
import { useCandidate, useVariantOverview, type UpdateCandidateData, type VariantOverviewData, type VariantOverviewReadResult } from "../hooks/use-update-queries";
import { useRestoreRevisionAsDraft, useSubmitForReview, useWithdrawLocale, useWithdrawUpdate } from "../hooks/use-update-mutations";
import type { RestoreRevisionAsDraftPayload } from "../schemas/review";
import type { WithdrawLocalePayload, WithdrawUpdatePayload } from "../schemas/withdraw";

// ------------------------------------------------------------------------------------------------
// The shapes this surface reads, taken from the reads themselves
// ------------------------------------------------------------------------------------------------

/** One edition of the Update as its variant matrix states it: three independent pointers, the head release and the translation record. */
type EditionView = VariantOverviewData["editions"][number];
/** The envelope the variant matrix answered with, once a read produced one. */
type OverviewEnvelope = ReadEnvelope<VariantOverviewData>;
/** The result a read of this surface can carry: the envelope, a denial, an unreadable source or a refused request. */
type OverviewReadResult = VariantOverviewReadResult;
/** The result a candidate read can carry. */
type CandidateReadResult = ReturnType<typeof useCandidate>["result"];
/** The attempt a mutation takes, before the review step supplies its own operation identity. */
type ReviewInput<P> = Omit<MutationInput<P>, "operationId">;
/** The payload `submitForReview` takes, read off the hook that posts it so a field the schema changes reaches this file as a compile error. */
type SubmitReviewPayload = Parameters<ReturnType<typeof useSubmitForReview>["submit"]>[0]["payload"];

// ------------------------------------------------------------------------------------------------
// The words this surface owns
// ------------------------------------------------------------------------------------------------

const HEADING = "Editions, candidates and releases";
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

/** The introduction states the two distinctions the whole grid depends on, in the copy module's own words. */
const INTRO = `${DRAFT_VS_RELEASED.draftIsNotWhatReadersSee} ${DRAFT_VS_RELEASED.releaseIsWhatRecipientsReceive}`;

/**
 * Why sibling editions are never summarised into one status. The matrix states each edition's own head release,
 * and a release attempt that fails for one edition leaves every other edition's head standing — so a surface that
 * rolled them up would report a rollback the application never performs.
 */
const SIBLING_NOTE =
  "Each edition below states its own published revision, and a release attempt that fails for one edition leaves " + "every other edition's published revision standing. Nothing here is a rollback, no sibling's release is removed, " + "and the editions are never added up into one status for the whole Update.";

const SWITCHER_LABEL = "Edition";
const LOCALE_LABEL = "Language";

const FACT_LABEL = { draft: "Saved draft", candidate: "Submitted for review", release: "Published revision", translation: "Translation" } as const;

const ABSENT = { draft: "No draft is saved for this edition yet, so there is nothing to submit for review.", candidate: "No revision of this edition is frozen for review.", release: "This edition publishes nothing yet, so no reader is served a revision of it." } as const;

const RELEASE_COPY = {
  revision: "Revision",
  publishedFor: "Published for",
  publishedAt: "Published",
  publication: "Publication",
  noInstant: "No instant was stated",
  withdrawn: "Withdrawn",
  superseded: "Replaced by a later release of this edition",
  withdrawnNote: "A withdrawn publication is no longer served: its address answers with a short notice that carries no identifying content. The record that it was once published stays.",
  supersededNote: "A later release of this edition is what a reader is served now; this revision is no longer the head.",
  noindexNote: "No search engine is asked to index this edition.",
} as const;

const CANDIDATE_COPY = {
  awaitngDecision: "Frozen and waiting for its one review step.",
  frozenAt: "Frozen",
  checksum: "Checksum of the frozen revision",
  reading: "Reading the frozen candidate…",
  deniedTitle: "The frozen candidate cannot be shown here",
  deniedDescription: "This context may read the edition's pointers but not the frozen revision itself, so nothing about what a reviewer would approve is stated here.",
  unavailableTitle: "The frozen candidate could not be read",
  unavailableDescription: "Its source could not be read, so the frozen revision and checksum are not stated. Retry the same read: an outage is never presented as a candidate that does not exist.",
  refusedTitle: "The frozen candidate was refused",
  refusedDescription: "The request for this candidate was refused before anything was read, so no revision is stated here.",
  invalidTitle: "The frozen candidate cannot be read as content",
  invalidDescription: "The stored revision it names could not be read as content, so what a reviewer would approve cannot be stated.",
  decision: { approved: "A reviewer approved this candidate.", "changes-requested": "A reviewer asked for changes, so a further round is a new submission.", rejected: "A reviewer ended this candidate." },
} as const;

/** The one state a translated edition can be in besides current, and the fact that neither of them withdraws anything. */
const TRANSLATION_COPY = { unresolved: "This edition was written from another edition, and the source revision it names is no longer in the store, so " + "whether it is current cannot be stated. Nothing was withdrawn for it.", direction: { ltr: "written left to right", rtl: "written right to left" } } as const;

const ACTION_COPY = {
  editor: "Open the editor",
  preview: "Open the preview",
  submit: "Submit for review",
  restore: "Restore the published revision as a new draft",
  withdrawLocale: "Withdraw this language edition",
  withdrawUpdate: "Withdraw the whole Update",
  noPreview: "There is no draft, candidate or publication of this edition to preview yet.",
  withheldReasons: {
    submit: "This edition has no saved draft, so there is nothing to freeze for review yet.",
    restore: "This edition publishes no revision, so there is none to restore as a draft.",
    withdrawLocale: "This edition publishes no revision, or its publication is already withdrawn, so there is nothing to withdraw.",
    withdrawUpdate: "No edition of this Update holds a publication that is still served, so there is nothing to withdraw.",
  },
} as const;

/** The five writes in one place: the label, the heading of its review step and the sentence that says what it does. */
const REVIEW_COPY = {
  submit: { title: "Submit this edition for its review", confirm: "Submit for review", what: "This freezes the exact saved revision as the candidate its one review step answers. It publishes nothing and " + "notifies nobody: a release is a separate step, and a notice is a separate outcome again." },
  restore: { title: "Restore the published revision as a new draft", confirm: "Restore as a new draft", what: "The revision restored is the one this edition publishes today. It becomes a new draft to edit, with its own " + "identity, and the published revision keeps standing until a later release replaces it." },
  withdrawLocale: { title: "Withdraw this language edition", confirm: "Withdraw this edition", consequence: "It stops being served as soon as you confirm it. Every other edition of this Update is left exactly as it is." },
  withdrawUpdate: { title: "Withdraw the whole Update", confirm: "Withdraw every edition", consequence: "Every edition of this Update stops being served as soon as you confirm it, in every language and for every audience." },
} as const;

/** The words one published action name reads as. A name the matrix publishes that is absent from this record is stated as its raw name rather than guessed at. */
const PUBLISHED_ACTION_LABELS: Readonly<Record<string, string>> = { "create-variant": "Add an edition", "open-draft": "Open a saved draft", "review-candidate": "Review a submitted edition", "publish-variants": "Publish a frozen candidate" };

const PERMITS_HEADING = "What this Update permits here";
const PERMITS_INTRO =
  "These are the actions the read states for this Update, with the read's own reason wherever one is withheld. An " + "action this screen offers below is re-checked by the service when it is submitted, so a screen that has gone " + "stale answers that the change is not permitted rather than making it.";
const PERMITS_AVAILABLE = "offered in this context";
const PERMITS_WITHHELD = "withheld";

const REVIEW_OFFER = {
  heading: "Editions waiting for a release",
  intro: "A frozen candidate is answered by one review step and is not a release, so these editions are listed here for " + "their reviewer rather than shown as published.",
  none: "No edition of this Update holds a frozen candidate waiting for a release.",
  link: "Open the review",
  countNoun: "editions awaiting a release",
  singularCountNoun: "edition awaiting a release",
} as const;

const READ_STATE = {
  reading: { title: "Reading this Update's editions", description: "The editions, their candidates and their published revisions are being read under the selected context." },
  denied: { title: "These editions cannot be read here", description: "The selected context is not permitted to read this Update's editions, so no edition, revision, candidate or count is stated here." },
  unavailable: { title: "The editions could not be read", description: "The source holding this Update could not be read, so no edition, revision or candidate is stated. Retry the same read: an outage is never presented as an Update with no editions." },
  refused: { title: "The read was refused", description: "The request for this Update was refused before anything was read, so nothing about its editions is stated here." },
  empty: { title: "This Update has no editions yet", description: "An Update carries one edition per audience and content language, and none exists for this one yet. Nothing here can be drafted, reviewed or released until an edition exists." },
  stale: { title: "This Update is being read again", description: "The context changed since this Update was read, so the previous context's editions are not shown under the current one." },
} as const;

const NOTE_CLASS = "text-sm text-pretty text-muted-foreground";
const SENTENCE_CLASS = "text-sm text-pretty";
const FACT_LIST_CLASS = "flex min-w-0 flex-col gap-3 text-sm";
const FACT_ROW_CLASS = "flex min-w-0 flex-col gap-1";
const FACT_TERM_CLASS = "text-muted-foreground";
const FACT_VALUE_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
const LINK_CLASS = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto min-h-8 max-w-full py-1.5 whitespace-normal");
const ACTION_LIST_CLASS = "flex min-w-0 flex-wrap items-center gap-2";
const ROOT_CLASS = "flex min-w-0 flex-col gap-6";

// ------------------------------------------------------------------------------------------------
// Small readings of the records, and nothing that computes a state
// ------------------------------------------------------------------------------------------------

/** The edition's own record as the lifecycle vocabulary reads it: the three pointers and its audience and language, nothing added. */
function variantRecordOf(documentId: string, edition: EditionView): ContentVariant {
  return {
    variantId: edition.variantId,
    documentId,
    audience: edition.audience,
    locale: edition.locale,
    // Absent pointers are omitted rather than set to `undefined`, so the record states exactly what the envelope stated.
    ...(edition.draftRevisionId === null ? {} : { draftRevisionId: edition.draftRevisionId }),
    ...(edition.candidateId === null ? {} : { candidateId: edition.candidateId }),
    ...(edition.releaseHeadId === null ? {} : { releaseHeadId: edition.releaseHeadId }),
  };
}

/** An instant as the read states it: the exact ISO text, shown unchanged because formatting one needs a display zone this surface has no authority over. */
function instantTextOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || typeof value !== "object") return "";
  return String(value).trim();
}

/** The language's own name for itself where the copy module names it, and the platform's name for it otherwise. */
function endonymOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") return "";
  const named = LOCALE_DISPLAY_NAMES[trimmed]?.trim() ?? "";
  if (named !== "") return named;
  const language = (trimmed.split("-")[0] ?? trimmed).toLowerCase();
  try {
    const names = new Intl.DisplayNames([language], { type: "language" });
    const name = names.of(language);
    return name === undefined || name.trim() === "" ? trimmed : name;
  } catch {
    return trimmed;
  }
}

/** What the read published for one action name, or `null` when it published no such name at all. */
function availabilityOf(actions: readonly ReadAction[], name: string): ReadAction | null {
  return actions.find((action) => action.name === name) ?? null;
}

/** The next heading level down, so a block nested in a section never skips a level and never leaves the 2-4 range this surface renders at. */
function nestedLevel(level: 2 | 3 | 4): 2 | 3 | 4 {
  return level === 4 ? 4 : ((level + 1) as 3 | 4);
}

function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className={FACT_ROW_CLASS}>
      <dt className={FACT_TERM_CLASS}>{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Identifier({ value }: { readonly value: string }): ReactElement | null {
  const stated = value.trim();
  return stated === "" ? null : <bdi className={IDENTIFIER_CLASS}>{stated}</bdi>;
}

// ------------------------------------------------------------------------------------------------
// The frozen candidate of one edition, read through the edition that holds it
// ------------------------------------------------------------------------------------------------

interface FrozenCandidateProps {
  readonly scope: Scope;
  readonly variantId: string;
  readonly headingLevel: NoticeHeadingLevel;
}

/**
 * What the reviewer will approve: the exact frozen revision and its checksum, read from the candidate's own named
 * read rather than inferred from the edition's pointer. A candidate the matrix reports but this read cannot resolve
 * states that fact, because a candidate whose revision cannot be read is not the same as one that does not exist.
 */
function FrozenCandidate({ scope, variantId, headingLevel }: FrozenCandidateProps): ReactElement {
  const candidate = useCandidate({ scope, variantId });
  const result: CandidateReadResult = candidate.result;
  if (result === undefined) {
    return <p className={NOTE_CLASS}>{candidate.isPending ? CANDIDATE_COPY.reading : CANDIDATE_COPY.unavailableDescription}</p>;
  }
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" title={CANDIDATE_COPY.deniedTitle} description={CANDIDATE_COPY.deniedDescription} headingLevel={headingLevel} />;
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          title={CANDIDATE_COPY.unavailableTitle}
          description={result.unavailable.guidance.trim() === "" ? CANDIDATE_COPY.unavailableDescription : result.unavailable.guidance}
          source={result.unavailable.source}
          retry={{ label: "Read it again", onClick: () => candidate.refetch() }}
          headingLevel={headingLevel}
        />
      );
    case "refused":
      return <StateNotice kind="refused" title={CANDIDATE_COPY.refusedTitle} description={CANDIDATE_COPY.refusedDescription} headingLevel={headingLevel} />;
    case "envelope":
      break;
  }
  const data: UpdateCandidateData = result.envelope.data;
  switch (data.status) {
    case "reviewable":
      break;
    case "none":
      return <p className={NOTE_CLASS}>{ABSENT.candidate}</p>;

    case "invalid":
      return <StateNotice kind="refused" title={CANDIDATE_COPY.invalidTitle} description={CANDIDATE_COPY.invalidDescription} retry={{ label: "Read it again", onClick: () => candidate.refetch() }} headingLevel={headingLevel} />;
    case "unavailable":
      return <StateNotice kind="unavailable" title={CANDIDATE_COPY.unavailableTitle} description={data.reason} retry={{ label: "Read it again", onClick: () => candidate.refetch() }} headingLevel={headingLevel} />;
  }
  const decision = data.review.decision;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className={FACT_VALUE_CLASS}>
        <span className="text-muted-foreground">{CANDIDATE_COPY.checksum}</span>
        <Identifier value={data.candidate.contentChecksum} />
      </p>
      <p className={NOTE_CLASS}>
        {CANDIDATE_COPY.frozenAt} <time dateTime={instantTextOf(data.candidate.frozenAt)}>{instantTextOf(data.candidate.frozenAt)}</time>.
      </p>
      <p className={NOTE_CLASS}>{decision === null ? CANDIDATE_COPY.awaitngDecision : CANDIDATE_COPY.decision[decision]}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// The writes this surface offers, each as a snapshot of what was chosen
// ------------------------------------------------------------------------------------------------

/**
 * What a worker chose, captured as an intent rather than read live from the edition. The snapshot is what keeps a
 * receipt in place: a settled attempt advances the record's revision, and an intent rebuilt from the re-read edition
 * would state a different revision the moment the grid refetched, so the review step would drop the result it had
 * just shown. The revision the worker saw is the revision the attempt presents, which is also why a change made
 * elsewhere in the meantime answers `conflict` with both values rather than overwriting one of them.
 */
export type ReviewIntent =
  | { readonly kind: "submit-for-review"; readonly variantId: string; readonly revisionId: string; readonly expectedRevision: string; readonly audience: VariantAudience; readonly localeTag: string }
  | { readonly kind: "restore-revision"; readonly variantId: string; readonly revisionId: string; readonly expectedRevision: string; readonly audience: VariantAudience; readonly localeTag: string }
  | { readonly kind: "withdraw-locale"; readonly variantId: string; readonly localeTag: string; readonly expectedRevision: string; readonly audience: VariantAudience }
  | { readonly kind: "withdraw-update"; readonly documentId: string; readonly expectedRevision: string };

/** The edition a step names, in the words the grid uses for it. */
function editionNameOf(audience: VariantAudience, localeTag: string): string {
  return `${AUDIENCE_WORDS[audience].label}, ${endonymOf(localeTag)}`;
}

interface ReviewStepProps {
  readonly scope: Scope;
  readonly intent: ReviewIntent | null;
  readonly submitForReview: ReturnType<typeof useSubmitForReview>["submit"];
  readonly restoreRevision: ReturnType<typeof useRestoreRevisionAsDraft>["submit"];
  readonly withdrawLocale: ReturnType<typeof useWithdrawLocale>["submit"];
  readonly withdrawUpdate: ReturnType<typeof useWithdrawUpdate>["submit"];
  readonly checkResult: () => void;
  readonly onClose: () => void;
  readonly headingLevel: 2 | 3 | 4;
}

/** One review step at a time, for the write the worker chose. Each branch is its own component, so choosing another write starts with a review that holds no earlier attempt. */
function ReviewStep({ scope, intent, submitForReview, restoreRevision, withdrawLocale, withdrawUpdate, checkResult, onClose, headingLevel }: ReviewStepProps): ReactElement | null {
  const stepHeading: 3 | 4 = headingLevel === 2 ? 3 : 4;
  const submitInput = useMemo<ReviewInput<SubmitReviewPayload> | null>(() => (intent !== null && intent.kind === "submit-for-review" ? { scope, expectedRevision: intent.expectedRevision, payload: { variantId: intent.variantId, revisionId: intent.revisionId } } : null), [scope, intent]);
  const restoreInput = useMemo<ReviewInput<RestoreRevisionAsDraftPayload> | null>(() => (intent !== null && intent.kind === "restore-revision" ? { scope, expectedRevision: intent.expectedRevision, payload: { revisionId: intent.revisionId } } : null), [scope, intent]);
  const localeInput = useMemo<ReviewInput<WithdrawLocalePayload> | null>(() => (intent !== null && intent.kind === "withdraw-locale" ? { scope, expectedRevision: intent.expectedRevision, payload: { variantId: intent.variantId, locale: intent.localeTag } } : null), [scope, intent]);
  const updateInput = useMemo<ReviewInput<WithdrawUpdatePayload> | null>(() => (intent !== null && intent.kind === "withdraw-update" ? { scope, expectedRevision: intent.expectedRevision, payload: { documentId: intent.documentId } } : null), [scope, intent]);
  if (intent === null) return null;
  switch (intent.kind) {
    case "submit-for-review":
      if (submitInput === null) return null;
      return (
        <ActionReview<SubmitReviewPayload>
          key="submit-for-review"
          title={REVIEW_COPY.submit.title}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p>
                This freezes one exact saved revision of <bdi>{editionNameOf(intent.audience, intent.localeTag)}</bdi>: <Identifier value={intent.revisionId} />.
              </p>
              <p>{REVIEW_COPY.submit.what}</p>
              <p>{REVIEW_ROUND_NOTE.oneStepWherePolicyRequires}</p>
              <p>{REVIEW_ROUND_NOTE.furtherRoundIsNewSubmission}</p>
              <p>{REVIEW_ROUND_NOTE.approvalIsPerVariant}</p>
              <p>{REVIEW_ROUND_NOTE.reviewerCannotAddNotify}</p>
            </div>
          }
          confirmLabel={REVIEW_COPY.submit.confirm}
          onCancel={onClose}
          input={submitInput}
          submit={submitForReview}
          checkResult={checkResult}
          headingLevel={stepHeading}
        />
      );
    case "restore-revision":
      if (restoreInput === null) return null;
      return (
        <ActionReview<RestoreRevisionAsDraftPayload>
          key="restore-revision"
          title={REVIEW_COPY.restore.title}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p>
                The revision restored is <Identifier value={intent.revisionId} />, the one <bdi>{editionNameOf(intent.audience, intent.localeTag)}</bdi> publishes today.
              </p>
              <p>{DRAFT_VS_RELEASED.restoreCreatesNewDraft}</p>
              <p>{REVIEW_COPY.restore.what}</p>
            </div>
          }
          confirmLabel={REVIEW_COPY.restore.confirm}
          onCancel={onClose}
          input={restoreInput}
          submit={restoreRevision}
          checkResult={checkResult}
          headingLevel={stepHeading}
        />
      );
    case "withdraw-locale":
      if (localeInput === null) return null;
      return (
        <ActionReview<WithdrawLocalePayload>
          key="withdraw-locale"
          title={REVIEW_COPY.withdrawLocale.title}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p>
                This withdraws <bdi>{editionNameOf(intent.audience, intent.localeTag)}</bdi> and leaves every other edition of this Update exactly as it is.
              </p>
              <p>{WITHDRAWAL_WORDING.whatItDoes}</p>
              <p>{WITHDRAWAL_WORDING.whatItDoesNotDo}</p>
            </div>
          }
          consequence={
            <div className="flex min-w-0 flex-col gap-2">
              <p>{REVIEW_COPY.withdrawLocale.consequence}</p>
              {/* The confirmation dialog is where the decision is taken, so the sentence that says what a withdrawal
                  cannot undo is stated inside it rather than only in the review beside it. */}
              <p>{WITHDRAWAL_WORDING.whatItDoesNotDo}</p>
            </div>
          }
          confirmLabel={REVIEW_COPY.withdrawLocale.confirm}
          cancelLabel="Not now"
          onCancel={onClose}
          consequential
          input={localeInput}
          submit={withdrawLocale}
          checkResult={checkResult}
          headingLevel={stepHeading}
        />
      );
    case "withdraw-update":
      if (updateInput === null) return null;
      return (
        <ActionReview<WithdrawUpdatePayload>
          key="withdraw-update"
          title={REVIEW_COPY.withdrawUpdate.title}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p>{WITHDRAWAL_WORDING.whatItDoes}</p>
              <p>{WITHDRAWAL_WORDING.whatItDoesNotDo}</p>
            </div>
          }
          consequence={
            <div className="flex min-w-0 flex-col gap-2">
              <p>{REVIEW_COPY.withdrawUpdate.consequence}</p>
              <p>{WITHDRAWAL_WORDING.whatItDoesNotDo}</p>
            </div>
          }
          confirmLabel={REVIEW_COPY.withdrawUpdate.confirm}
          cancelLabel="Not now"
          onCancel={onClose}
          consequential
          input={updateInput}
          submit={withdrawUpdate}
          checkResult={checkResult}
          headingLevel={stepHeading}
        />
      );
  }
}

// ------------------------------------------------------------------------------------------------
// One edition
// ------------------------------------------------------------------------------------------------

/** What the edition publishes today, stated from the head release the matrix carries: its revision, the audience and language it was published for, its instant, its reach, and whether it was withdrawn or replaced. */
function ReleaseFacts({ edition }: { readonly edition: EditionView }): ReactElement {
  const head = edition.headRelease;
  if (head === null) return <p className={NOTE_CLASS}>{ABSENT.release}</p>;
  const publishedAt = instantTextOf(head.publishedAt);
  const withdrawnAt = head.withdrawnAt === undefined ? "" : instantTextOf(head.withdrawnAt);
  const supersededBy = head.supersededBy?.trim() ?? "";
  const reach = REACH_STATUS[head.reach];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className={FACT_VALUE_CLASS}>
        <span className={FACT_TERM_CLASS}>{RELEASE_COPY.revision}</span>
        <Identifier value={head.revisionId} />
      </p>
      <p className={FACT_VALUE_CLASS}>
        <span className={FACT_TERM_CLASS}>{RELEASE_COPY.publishedFor}</span>
        <span className="min-w-0 wrap-anywhere">{AUDIENCE_LABELS[head.audience].label}</span>
        <bdi lang={head.locale.tag} className="min-w-0 wrap-anywhere">
          {endonymOf(head.locale.tag)}
        </bdi>
        <bdi className={IDENTIFIER_CLASS}>{head.locale.tag}</bdi>
      </p>
      <p className={FACT_VALUE_CLASS}>
        <span className={FACT_TERM_CLASS}>{RELEASE_COPY.publishedAt}</span>
        <time dateTime={publishedAt === "" ? undefined : publishedAt}>{publishedAt === "" ? RELEASE_COPY.noInstant : publishedAt}</time>
      </p>
      <p className={FACT_VALUE_CLASS}>
        <StatusBadge label={reach.label} tone={reach.tone} srPrefix="Reach" />
        {edition.reach !== null && edition.reach.robots === "noindex" ? <span className={NOTE_CLASS}>{RELEASE_COPY.noindexNote}</span> : null}
      </p>
      <p className={FACT_VALUE_CLASS}>
        <span className={FACT_TERM_CLASS}>{RELEASE_COPY.publication}</span>
        <Identifier value={head.releaseId} />
      </p>
      {withdrawnAt === "" ? null : (
        <p className={SENTENCE_CLASS}>
          {RELEASE_COPY.withdrawn} <time dateTime={withdrawnAt}>{withdrawnAt}</time>. {RELEASE_COPY.withdrawnNote}
        </p>
      )}
      {supersededBy === "" ? null : (
        <p className={SENTENCE_CLASS}>
          {RELEASE_COPY.superseded}: <Identifier value={supersededBy} />. {RELEASE_COPY.supersededNote}
        </p>
      )}
    </div>
  );
}

interface EditionCellProps {
  readonly documentId: string;
  readonly edition: EditionView;
  readonly scope: Scope;
  readonly headingLevel: 2 | 3 | 4;
  readonly onChoose: (intent: ReviewIntent) => void;
}

/**
 * One edition: its audience and language, the lifecycle word the shared vocabulary gives its pointers, the three
 * pointers themselves with the frozen candidate's exact revision and checksum, the published revision, and the writes
 * the record facts allow. A write is withheld with its reason rather than shown disabled, because the reason is the
 * useful part of the answer.
 */
function EditionCell({ documentId, edition, scope, headingLevel, onChoose }: EditionCellProps): ReactElement {
  const titleId = useId();
  const variant = variantRecordOf(documentId, edition);
  const head: Release | null = edition.headRelease;
  const lifecycle = lifecycleOf(variant, head ?? undefined);
  const translation = edition.translation;
  const staleSince = translation.status === "stale" ? instantTextOf(translation.sourceUpdatedAt) : "";
  const unresolved = translation.status === "unresolved";
  const staleWords = LIFECYCLE_STATUS["stale-translation"];
  const audience = AUDIENCE_WORDS[edition.audience];
  const endonym = endonymOf(edition.locale.tag);
  const Heading = HEADING_TAG[nestedLevel(headingLevel)];
  const noticeLevel = nestedLevel(nestedLevel(headingLevel));
  const editorHref = `/communication/${encodeURIComponent(documentId)}/${encodeURIComponent(edition.variantId)}`;
  const canPreview = edition.draftRevisionId !== null || edition.candidateId !== null || head !== null;
  const draftRevisionId = edition.draftRevisionId;
  const canSubmit = draftRevisionId !== null;
  const releasedRevisionId = head === null ? "" : head.revisionId;
  const canRestore = head !== null;
  const canWithdrawLocale = head !== null && head.withdrawnAt === undefined;
  const base = { variantId: edition.variantId, audience: edition.audience, localeTag: edition.locale.tag, expectedRevision: edition.recordRevision };
  return (
    // The cell is an article named by its own heading, not a labelled `div`: `aria-labelledby` on an element with no
    // role names nothing a screen reader can announce, and the heading already says which audience and language this
    // edition serves. `dir` is the edition's own direction, so an Arabic edition lays itself out right to left.
    <article dir={edition.locale.direction} data-slot="edition-cell" data-variant-id={edition.variantId} data-audience={edition.audience} data-locale={edition.locale.tag} aria-labelledby={titleId} className="min-w-0">
      <Card className="min-w-0">
        <CardHeader className="flex min-w-0 flex-col gap-2">
          <CardTitle>
            <Heading id={titleId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-base">
              <StatusBadge label={audience.label} tone={audience.tone} srPrefix="Audience" />
              <bdi lang={edition.locale.tag} className="min-w-0 wrap-anywhere">
                {endonym}
              </bdi>
            </Heading>
          </CardTitle>
          <p className={NOTE_CLASS}>{AUDIENCE_LABELS[edition.audience].whoReceives}</p>
          <p className={FACT_VALUE_CLASS}>
            <bdi className={IDENTIFIER_CLASS} lang={edition.locale.tag}>
              {edition.locale.tag}
            </bdi>
            <span className={NOTE_CLASS}>{TRANSLATION_COPY.direction[edition.locale.direction]}</span>
            {translation.status === "stale" ? <StatusBadge label={staleWords.label} tone={staleWords.tone} srPrefix="Translation" /> : null}
          </p>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <DraftStatus state={lifecycle} staleSince={staleSince === "" ? undefined : staleSince} />
          {translation.status === "stale" ? <p className={NOTE_CLASS}>{staleWords.explanation}</p> : null}
          {unresolved ? <p className={NOTE_CLASS}>{TRANSLATION_COPY.unresolved}</p> : null}
          <Separator />
          <dl className={FACT_LIST_CLASS}>
            <Fact term={FACT_LABEL.draft}>{edition.draftRevisionId === null ? <p className={NOTE_CLASS}>{ABSENT.draft}</p> : <Identifier value={edition.draftRevisionId} />}</Fact>
            <Fact term={FACT_LABEL.candidate}>
              {edition.candidateId === null ? (
                <p className={NOTE_CLASS}>{ABSENT.candidate}</p>
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <Identifier value={edition.candidateId} />
                  <FrozenCandidate scope={scope} variantId={edition.variantId} headingLevel={noticeLevel} />
                </div>
              )}
            </Fact>
            <Fact term={FACT_LABEL.release}>
              <ReleaseFacts edition={edition} />
            </Fact>
          </dl>
          <Separator />
          <div className="flex min-w-0 flex-col gap-2">
            <div className={ACTION_LIST_CLASS}>
              <Link href={editorHref} className={LINK_CLASS}>
                {ACTION_COPY.editor}
              </Link>
              {canPreview ? (
                <Link href={`${editorHref}/preview`} className={LINK_CLASS}>
                  {ACTION_COPY.preview}
                </Link>
              ) : (
                <p className={NOTE_CLASS}>{ACTION_COPY.noPreview}</p>
              )}
            </div>
            <div className={ACTION_LIST_CLASS}>
              {draftRevisionId === null ? null : (
                <Button type="button" variant="secondary" size="sm" className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal" onClick={() => onChoose({ kind: "submit-for-review", revisionId: draftRevisionId, ...base })}>
                  {ACTION_COPY.submit}
                </Button>
              )}
              {canRestore ? (
                <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal" onClick={() => onChoose({ kind: "restore-revision", revisionId: releasedRevisionId, ...base })}>
                  {ACTION_COPY.restore}
                </Button>
              ) : null}
              {canWithdrawLocale ? (
                <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal" onClick={() => onChoose({ kind: "withdraw-locale", ...base })}>
                  {ACTION_COPY.withdrawLocale}
                </Button>
              ) : null}
            </div>
            {canSubmit ? null : <p className={NOTE_CLASS}>{ACTION_COPY.withheldReasons.submit}</p>}
            {canRestore ? null : <p className={NOTE_CLASS}>{ACTION_COPY.withheldReasons.restore}</p>}
            {canWithdrawLocale ? null : <p className={NOTE_CLASS}>{ACTION_COPY.withheldReasons.withdrawLocale}</p>}
          </div>
        </CardContent>
      </Card>
    </article>
  );
}

// ------------------------------------------------------------------------------------------------
// The surface
// ------------------------------------------------------------------------------------------------

export interface VariantOverviewProps {
  /** The context the reads run in. The service re-resolves it for every read and every write, so this is a claim the caller makes and not an authority it grants. */
  readonly scope: Scope;
  /** The Update whose editions are listed. Absent until a route resolves one, and then the read stays idle rather than asking about a document nobody named. */
  readonly documentId: string;
  /** The envelope a server render already produced, so the browser issues no duplicate request for what it was handed. */
  readonly initialResult?: VariantOverviewReadResult;
  /** When that answer was produced, so the cache treats the seed as the age it is. */
  readonly initialDataUpdatedAt?: number;
  /** The heading level of this surface, so it nests under whatever heading the page above it reaches. */
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
}

/**
 * One Update's editions: what each one is in words, what its saved draft, frozen candidate and published revision
 * are, whether a translation is stale, and the writes the record facts allow — each write taken to one review step
 * and answered with its own eight-outcome receipt.
 */
export function VariantOverview({ scope, documentId, initialResult, initialDataUpdatedAt, headingLevel = 2, className }: VariantOverviewProps): ReactElement {
  const headingId = useId();
  const seedOptions = initialResult === undefined ? {} : initialDataUpdatedAt === undefined ? { initialData: initialResult } : { initialData: initialResult, initialDataUpdatedAt };
  const overview = useVariantOverview({ scope, documentId }, seedOptions);
  // The four writes are declared once here and handed to whichever review step the worker opens, so no step composes a
  // transport of its own and no hook depends on the intent currently chosen.
  const submitForReview = useSubmitForReview();
  const restoreRevision = useRestoreRevisionAsDraft();
  const withdrawLocale = useWithdrawLocale();
  const withdrawUpdate = useWithdrawUpdate();
  const [chosenVariantId, setChosenVariantId] = useState("");
  const [intent, setIntent] = useState<ReviewIntent | null>(null);
  const result: OverviewReadResult | undefined = overview.result;
  if (result === undefined || overview.isStale(result)) {
    const state = result === undefined ? READ_STATE.reading : READ_STATE.stale;
    return <StateNotice kind="loading" title={state.title} description={state.description} headingLevel={headingLevel} className={className} />;
  }
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" title={READ_STATE.denied.title} description={READ_STATE.denied.description} reasonCode={result.denied.reasonCode} operationId={result.denied.operationId} headingLevel={headingLevel} className={className} />;
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          title={READ_STATE.unavailable.title}
          description={result.unavailable.guidance.trim() === "" ? READ_STATE.unavailable.description : result.unavailable.guidance}
          source={result.unavailable.source}
          retry={{ label: "Read this Update again", onClick: () => overview.refetch() }}
          headingLevel={headingLevel}
          className={className}
        />
      );
    case "refused":
      return <StateNotice kind="refused" title={READ_STATE.refused.title} description={READ_STATE.refused.description} headingLevel={headingLevel} className={className} />;
    case "envelope":
      break;
  }
  const envelope: OverviewEnvelope = result.envelope;
  const data: VariantOverviewData = envelope.data;
  const editions: readonly EditionView[] = data.editions;
  if (editions.length === 0) {
    return <StateNotice kind="empty" title={READ_STATE.empty.title} description={READ_STATE.empty.description} headingLevel={headingLevel} className={className} />;
  }
  const tabs: readonly VariantTab[] = editions.map((edition) => {
    const lifecycle = lifecycleOf(variantRecordOf(data.document.documentId, edition), edition.headRelease ?? undefined);
    const staleSince = edition.translation.status === "stale" ? instantTextOf(edition.translation.sourceUpdatedAt) : "";
    return { variantId: edition.variantId, audience: edition.audience, locale: edition.locale, lifecycle, ...(staleSince === "" ? {} : { staleSince }) };
  });
  const activeEdition = editions.find((edition) => edition.variantId === chosenVariantId) ?? editions[0];
  const localeEditions: LocaleEdition[] = [];
  const seenLocales = new Set<string>();
  for (const edition of editions) {
    if (seenLocales.has(edition.locale.tag)) continue;
    seenLocales.add(edition.locale.tag);
    localeEditions.push({ tag: edition.locale.tag, direction: edition.locale.direction, endonym: endonymOf(edition.locale.tag) });
  }
  const requestLocale = (tag: string): void => {
    // The choice moves the selection to an edition in that language, keeping the audience the worker was reading
    // where that pairing exists. Admission is re-checked against the list this control was given, so a stale or
    // tampered option value moves nothing.
    const sameAudience = editions.find((edition) => edition.locale.tag === tag && edition.audience === activeEdition?.audience);
    const anyInLocale = editions.find((edition) => edition.locale.tag === tag);
    const target = sameAudience ?? anyInLocale;
    if (target !== undefined) setChosenVariantId(target.variantId);
  };
  const awaiting: readonly string[] = data.awaitingRelease;
  const awaitingEditions = editions.filter((edition) => edition.candidateId !== null && awaiting.includes(edition.variantId));
  const canWithdrawUpdate = editions.some((edition) => edition.headRelease !== null && edition.headRelease.withdrawnAt === undefined);
  const reviewCandidateAction = availabilityOf(envelope.actions, "review-candidate");
  const Heading = HEADING_TAG[headingLevel];
  const SectionHeading = HEADING_TAG[nestedLevel(headingLevel)];
  const checkResult = (): void => {
    overview.refetch();
  };
  return (
    <div data-slot="variant-overview" data-document-id={data.document.documentId} data-edition-count={String(editions.length)} className={cn(ROOT_CLASS, className)}>
      <header className="flex min-w-0 flex-col gap-2">
        <Heading id={headingId} className="text-start text-lg font-medium text-pretty">
          {HEADING}
        </Heading>
        <p className={NOTE_CLASS}>{INTRO}</p>
        <p className={NOTE_CLASS}>{SIBLING_NOTE}</p>
      </header>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <VariantSwitcher family="update" variants={tabs} activeVariantId={activeEdition?.variantId ?? ""} onSelect={setChosenVariantId} label={SWITCHER_LABEL} className="min-w-0 md:max-w-xl" />
          <LocaleSwitcher locales={localeEditions} requested={activeEdition?.locale.tag ?? ""} onRequest={requestLocale} label={LOCALE_LABEL} className="min-w-0 md:max-w-xs" />
        </div>
        <p className={NOTE_CLASS}>{VARIANT_AXIS_NOTE}</p>
      </section>

      <ul className="grid min-w-0 list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
        {editions.map((edition) => (
          <li key={edition.variantId} className="min-w-0">
            <EditionCell documentId={data.document.documentId} edition={edition} scope={envelope.scope} headingLevel={nestedLevel(headingLevel)} onChoose={setIntent} />
          </li>
        ))}
      </ul>

      <ReviewStep scope={envelope.scope} intent={intent} submitForReview={submitForReview.submit} restoreRevision={restoreRevision.submit} withdrawLocale={withdrawLocale.submit} withdrawUpdate={withdrawUpdate.submit} checkResult={checkResult} onClose={() => setIntent(null)} headingLevel={headingLevel} />

      <section aria-labelledby={`${headingId}-review`} className="flex min-w-0 flex-col gap-3">
        <SectionHeading id={`${headingId}-review`} className="text-start text-base font-medium text-pretty">
          {REVIEW_OFFER.heading}
        </SectionHeading>
        <p className={NOTE_CLASS}>{REVIEW_OFFER.intro}</p>
        <StatusBadge label={`${String(awaitingEditions.length)} ${awaitingEditions.length === 1 ? REVIEW_OFFER.singularCountNoun : REVIEW_OFFER.countNoun}`} valueState={envelope.valueStates.awaitingRelease} srPrefix="Editions" />
        {awaitingEditions.length === 0 ? (
          <p className={NOTE_CLASS}>{REVIEW_OFFER.none}</p>
        ) : (
          <ul className="flex min-w-0 list-none flex-col gap-2 p-0">
            {awaitingEditions.map((edition) => (
              <li key={edition.variantId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 text-sm wrap-anywhere">{editionNameOf(edition.audience, edition.locale.tag)}</span>
                {edition.candidateId === null ? null : (
                  <Link href={`/communication/review/${encodeURIComponent(edition.candidateId)}`} className={LINK_CLASS}>
                    {REVIEW_OFFER.link}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className={NOTE_CLASS}>{REVIEW_ROUND_NOTE.oneStepWherePolicyRequires}</p>
        <p className={NOTE_CLASS}>{REVIEW_ROUND_NOTE.approvalIsPerVariant}</p>
        {reviewCandidateAction === null || reviewCandidateAction.available ? null : <p className={NOTE_CLASS}>{reviewCandidateAction.reason ?? PERMITS_WITHHELD}</p>}
      </section>

      <section aria-labelledby={`${headingId}-withdraw`} className="flex min-w-0 flex-col gap-3">
        <SectionHeading id={`${headingId}-withdraw`} className="text-start text-base font-medium text-pretty">
          {REVIEW_COPY.withdrawUpdate.title}
        </SectionHeading>
        <p className={NOTE_CLASS}>{WITHDRAWAL_WORDING.whatItDoes}</p>
        <p className={NOTE_CLASS}>{WITHDRAWAL_WORDING.whatItDoesNotDo}</p>
        {canWithdrawUpdate ? (
          <div className={ACTION_LIST_CLASS}>
            <Button type="button" variant="outline" className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal" onClick={() => setIntent({ kind: "withdraw-update", documentId: data.document.documentId, expectedRevision: data.document.recordRevision })}>
              {ACTION_COPY.withdrawUpdate}
            </Button>
          </div>
        ) : (
          <p className={NOTE_CLASS}>{ACTION_COPY.withheldReasons.withdrawUpdate}</p>
        )}
      </section>

      <section aria-labelledby={`${headingId}-permits`} className="flex min-w-0 flex-col gap-3">
        <SectionHeading id={`${headingId}-permits`} className="text-start text-base font-medium text-pretty">
          {PERMITS_HEADING}
        </SectionHeading>
        <p className={NOTE_CLASS}>{PERMITS_INTRO}</p>
        <ul className="flex min-w-0 list-none flex-col gap-2 p-0">
          {envelope.actions.map((action) => (
            <li key={action.name} className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium wrap-anywhere">{PUBLISHED_ACTION_LABELS[action.name] ?? action.name}</span>
              <span className={NOTE_CLASS}>{action.available ? PERMITS_AVAILABLE : `${PERMITS_WITHHELD}: ${action.reason ?? "no reason was stated for withholding it"}`}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default VariantOverview;
