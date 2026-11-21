"use client";

/**
 * What one release attempt produced, reported per edition: the receipt for the operation as a whole
 * and, below it, one row for every edition the submission selected.
 *
 * Plan items that put this file in scope:
 * - AAP 0.8.5: "Synthesis results are reported per selected variant; if one release succeeds and a
 *   sibling fails, the success and the sibling's prior-good permitted head are both preserved, and the
 *   failed member recovers under its original operation"; "accepted or possibly accepted work is never
 *   resent under a fresh key"; "withdrawal ... never claims recall". Those three sentences are this
 *   surface's whole job.
 * - AAP 0.9.1 places "publish and notify" in `features/updates/`, and AAP 0.7.1 names `publishVariants`
 *   and `requestNotification` among the release mutations whose results a surface renders.
 * - Criteria 9, 11 and 17, including the partial-failure case: one edition releases while a sibling
 *   keeps the revision it already published.
 *
 * What this file does, and refuses to do:
 *
 * - It renders a result. It performs no mutation, mints no operation identity, holds no copy of a
 *   release head and applies no optimistic patch, so a replay is the same attempt rather than a new
 *   one.
 * - It renders the receipt once, through `components/operation-result.tsx`, and supplies only the
 *   per-edition detail that receipt cannot know about. There is no second success panel and no
 *   transient-only confirmation: a release result stays on the page as the record of what happened.
 * - It reports four outcomes per edition and never rolls them up — released, failed with the edition's
 *   prior-good head kept, needs attention, withdrawn. "Needs attention" is a complete result rather
 *   than an error banner, and a sibling's failure is never presented as a rollback of the editions
 *   that did release.
 * - It states the two distinctions a release must never blur: acceptance by this application is not
 *   delivery and not reading, and a withdrawal stops this application serving the edition while
 *   claiming no recall of a submitted notice or of a copy someone already holds.
 * - Its only recovery offer for an unrecognised result is to check that result by its `operationId`.
 *   Nothing here resends work under a fresh identity, and the receipt is never given a replay control
 *   by this surface.
 *
 * Words come from their owners. The edition's lifecycle word and explanation are
 * `components/draft-status.tsx`'s, derived through `lifecycleOf` from the variant record and the head
 * release the payload reports; a variant's own failed attempt is deliberately not a lifecycle state,
 * and that file assigns its reporting to this surface. Audience names and locale endonyms come from
 * the Updates copy module, the notice state word from `components/status-badge.tsx`'s `SEND_STATUS`,
 * and withdrawal wording from the copy module. This file declares no state vocabulary of its own.
 *
 * Timing and money: no clock is read, no instant is formatted, no amount is computed and no count or
 * percentage is derived. The service supplies each edition's state, its reason and the revision it
 * publishes, and this surface repeats them verbatim.
 *
 * Layout and accessibility: an edition is a list item that wraps — audience, language, lifecycle word,
 * the revision it publishes, the consequence in a sentence, the service's reason, the notice state and
 * the caller's action. Everything is a labelled stack at every width, so nothing forces the page
 * sideways at 320 CSS px and no scroll region is needed. State is always carried by text, never by
 * colour alone; caller- and service-supplied values of unknown direction (a locale tag, a revision id,
 * a reason code) render inside `<bdi>`, so a Latin string in a right-to-left edition cannot reorder
 * its sentence; and this file adds no motion, no timer and no sticky surface of its own.
 *
 * Rule 1: family 9's per-edition release results and the release, notify and withdraw distinctions
 * only, with no provider client, queue, retry scheduler or other deferred-owner surface; the shared
 * receipt, badge, lifecycle indicator, notice and copy module are composed rather than duplicated; and
 * publication, notification submission, acceptance, delivery and reading stay visibly apart.
 */

import { useId, type ReactElement, type ReactNode } from "react";

import { DraftStatus, lifecycleOf, type VariantReleaseOutcome } from "@/components/draft-status";
import { fieldErrorsFromInvalid } from "@/components/form-field";
import OperationResult, { type ReceiptHeadingLevel } from "@/components/operation-result";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, type SendStatus } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationOutcome } from "@/modules/data-service/outcome";

import {
  AUDIENCE_LABELS,
  LOCALE_DISPLAY_NAMES,
  REVIEW_ROUND_NOTE,
  WITHDRAWAL_WORDING,
} from "../copy/updates-copy";

// ---------------------------------------------------------------------------------------------
// The records this surface reads, named by the module that owns them
// ---------------------------------------------------------------------------------------------

/**
 * One edition's variant record, as the content module defines it.
 *
 * The type is taken from `lifecycleOf`'s own parameter rather than restated or re-imported, so this
 * feature file cannot drift from the identity model that derives the lifecycle word: a field added
 * to the variant record reaches this surface through the same declaration the derivation reads.
 */
type PublishingVariant = Parameters<typeof lifecycleOf>[0];

/**
 * The release record one edition publishes: the head this attempt produced, or the earlier publication
 * a failed attempt kept. Also taken from the derivation's parameter, for the same reason.
 */
type PublishingRelease = NonNullable<Parameters<typeof lifecycleOf>[1]>;

// ---------------------------------------------------------------------------------------------
// The per-edition result, as the release payload reports it
// ---------------------------------------------------------------------------------------------

/**
 * The four results one edition can report from one release attempt, listed once so the closed set has
 * a runtime form as well as a type.
 *
 * They stay four because they say four different things: this edition released; it did not, and the
 * revision it had already published is still what readers are served; it needs attention before it can
 * release; or it is withdrawn and this application serves it to nobody. None of them is a lifecycle
 * state, and none is folded into one — the lifecycle word is `draft-status.tsx`'s and is derived from
 * the records, while this file states what the attempt itself produced.
 */
export const PUBLISH_EDITION_STATES = [
  "released",
  "failed-with-prior-good-head",
  "needs-attention",
  "withdrawn",
] as const;

/** One result of one release attempt, for one edition. */
export type PublishEditionState = (typeof PUBLISH_EDITION_STATES)[number];

/**
 * What the notice submission for one edition came to, when a notice was requested with the release.
 *
 * The state word is the audience module's own, through `SEND_STATUS`: `accepted` states that this
 * application took the submission, never that a message arrived or was opened. `detail` is the
 * service's sentence, repeated verbatim — including any recipient-level breakdown it chose to state —
 * because this surface computes no count of its own.
 */
export interface PublishedEditionNotice {
  /** The submission state, from the closed vocabulary `components/status-badge.tsx` labels. */
  readonly state: SendStatus;
  /** The service's own sentence about the submission, when it stated one. Never private content. */
  readonly detail?: string;
}

/**
 * One edition's result, as the publish payload reports it and as the caller holds the records.
 *
 * `release` is the head this edition publishes *after* the attempt: the release this attempt created,
 * or — for an edition that failed and already had one — the earlier publication it kept. Its absence
 * therefore means the edition publishes no revision at all, which is a different statement from a
 * failed attempt on a published edition and is rendered differently.
 */
export interface PublishedEdition {
  /** The variant record the lifecycle word is derived from. */
  readonly variant: PublishingVariant;
  /** What this attempt produced for this edition. */
  readonly state: PublishEditionState;
  /** The head release the edition publishes after the attempt, when it publishes one. */
  readonly release?: PublishingRelease;
  /** The machine reason the service stated for a failure or an attention result. */
  readonly reasonCode?: string;
  /** The reader-facing reason the service stated. Never private preparation or a recipient value. */
  readonly reason?: string;
  /** The notice submission for this edition, when a notice was requested with the release. */
  readonly notice?: PublishedEditionNotice;
}

// ---------------------------------------------------------------------------------------------
// The wording this surface owns
// ---------------------------------------------------------------------------------------------

/** The heading of the per-edition block. It names the rows; it does not report a result. */
const EDITIONS_HEADING = "Result for each edition";

/**
 * What the per-edition block states under its heading.
 *
 * It exists so a reader never takes the first row for the whole result: a submission that released one
 * edition and left another needing attention is two answers, not one.
 */
const EDITIONS_INTRO =
  "Each edition below reports its own result, and editions can differ, so they are read one at a " +
  "time rather than as one result for the whole submission.";

/** What the rows state when the operation was a replay: the stored result, not a second effect. */
const REPLAY_NOTE =
  "These rows are the result stored for that operation, not a new effect: nothing was released a " +
  "second time and no revision advanced.";

/**
 * The acceptance-versus-delivery sentence, shown wherever a notice submission is reported.
 *
 * It is the one claim a notice result must never make stronger than it is, so it sits beside the rows
 * that carry a notice state rather than in a separate explanation.
 */
const NOTICE_HONESTY_NOTE =
  "A notice that was accepted is not a delivered message and not a read one: acceptance states only " +
  "that this application took the submission, and nothing here states that a message arrived or was " +
  "opened.";

/**
 * What a retry would be, stated where unfinished editions are shown.
 *
 * The control belongs to the surface that submitted the work; this row states the condition it must
 * meet, so a retry can only ever resubmit the same operation rather than start a second one.
 */
const RETRY_INTENT_NOTE =
  "If this page offers to retry, it resubmits this same operation rather than starting a new one, so " +
  "work that was already accepted answers with its stored result instead of happening twice.";

/** The heading of the empty case: an applied release that reported no result for any edition. */
const NO_EDITIONS_TITLE = "No result for each edition was reported";

/** What the empty case says instead of inventing a per-edition result. */
const NO_EDITIONS_DESCRIPTION =
  "The submission was recorded, and the service reported no result for the editions it covered. " +
  "Nothing here summarises them, because a summary would state what the service did not.";

/** Where the empty case sends a reader: the family's own list of Updates and drafts. */
const UPDATES_LIST = { label: "Open the Updates list", href: "/communication" } as const;

/** The sentence a refused submission adds about the editions it never attempted. */
const REFUSED_WITH_FIELDS =
  "No edition was released or attempted: correct the fields the summary above names and submit the " +
  "release again.";

/** The sentence a refusal that named no field adds, which is a different statement. */
const REFUSED_WITHOUT_FIELDS =
  "No edition was released or attempted, and the refusal named no field to correct, so nothing here " +
  "can say which edition to change.";

/**
 * The receipt headings this surface states for the two outcomes that report applied work.
 *
 * Every other outcome keeps the receipt's own factual heading from `operation-result.tsx`, which is
 * the reason it is a partial record here: a heading may sharpen the word "saved" into what was saved,
 * but it may not soften any of the other six outcomes.
 */
const RECEIPT_HEADING: Readonly<Partial<Record<MutationOutcome["outcome"], string>>> = {
  accepted: "Release result",
  alreadyAccepted: "Release result for the earlier submission",
};

/** The heading element each level the caller may ask for renders as. */
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

/** The label of the revision a released edition publishes. */
const RELEASED_REVISION_LABEL = "Revision released";

/** The label of the revision an edition keeps when this attempt released nothing new. */
const KEPT_REVISION_LABEL = "Earlier revision still published";

/** The label of the revision a withdrawn edition no longer serves. */
const WITHDRAWN_REVISION_LABEL = "Revision withdrawn";

/** What an edition with no publication at all states in place of a revision. */
const NO_REVISION_STATE = "No revision is published for this edition.";

// ---------------------------------------------------------------------------------------------
// Reading one attempt, without computing anything the service owns
// ---------------------------------------------------------------------------------------------

/**
 * The per-edition outcomes of this attempt, as the lifecycle derivation reads them.
 *
 * `lifecycleOf` needs the sibling outcomes to answer whether an edition that released did so while
 * another failed, which is the fact that makes its own success partial. An edition that is withdrawn
 * contributes nothing: a withdrawal is not a release outcome, and counting it as one would let a
 * sibling's lifecycle word imply a failed release that never happened. An edition reported as released
 * with no release record contributes nothing either, because there is no outcome to describe.
 */
function synthesisOf(editions: readonly PublishedEdition[]): readonly VariantReleaseOutcome[] {
  const evidence: VariantReleaseOutcome[] = [];
  for (const edition of editions) {
    if (edition.state === "withdrawn") {
      continue;
    }
    if (edition.state === "released") {
      if (edition.release !== undefined) {
        evidence.push({
          variantId: edition.variant.variantId,
          outcome: { status: "released", release: edition.release },
        });
      }
      continue;
    }
    evidence.push({
      variantId: edition.variant.variantId,
      outcome: { status: "failed", reason: edition.reason?.trim() ?? "" },
    });
  }
  return evidence;
}

/** The revision line one edition shows, or none when the edition publishes no revision. */
interface EditionPublication {
  /** What this revision is to the edition: released, kept from an earlier attempt, or withdrawn. */
  readonly label: string;
  /** The exact revision identity, printed verbatim. */
  readonly revisionId: string;
}

/**
 * The revision line for one edition, read from the head release the payload reports.
 *
 * The label states the revision's standing in *this* attempt rather than a state word, and the
 * identity is the record's own, so the reader can compare it with the candidate review froze. A blank
 * or absent identity yields no line at all instead of an empty identifier, and the narrative beside it
 * then says that no revision is published.
 */
function publicationOf(edition: PublishedEdition): EditionPublication | null {
  const revisionId = edition.release?.revisionId.trim() ?? "";
  if (revisionId === "") {
    return null;
  }
  switch (edition.state) {
    case "released":
      return { label: RELEASED_REVISION_LABEL, revisionId };
    case "failed-with-prior-good-head":
    case "needs-attention":
      return { label: KEPT_REVISION_LABEL, revisionId };
    case "withdrawn":
      return { label: WITHDRAWN_REVISION_LABEL, revisionId };
    default: {
      /* Unreachable while every member is handled: `edition.state` is `never` here, so a fifth
       * per-edition state fails to compile at this assignment instead of reaching a row with no
       * sentence. */
      const unhandled: never = edition.state;
      throw new Error(`Unhandled per-edition publish state: ${String(unhandled)}`);
    }
  }
}

/**
 * The consequence of this attempt for one edition, in a sentence.
 *
 * The two facts it is written from are the attempt's own state and whether the edition publishes a
 * revision at all, because a failed attempt on a published edition and a failed attempt on an edition
 * that never published are different results for the reader. Every sentence states what happened and,
 * where it applies, what it does *not* mean: a sibling's failure rolls nothing back, a result that
 * needs attention is complete rather than pending, and an edition reported as released with no release
 * record states only what could be established.
 */
function narrativeOf(state: PublishEditionState, publishesRevision: boolean): string {
  switch (state) {
    case "released":
      return publishesRevision
        ? "This attempt released this edition for its audience and language, and the revision " +
            "above is the one it now publishes."
        : "This attempt reports this edition as released and the service named no published " +
            "revision for it, so nothing on this page can state which revision a reader is served.";
    case "failed-with-prior-good-head":
      return publishesRevision
        ? "This attempt did not release this edition. The revision above is its earlier publication " +
            "and is still the one an authorised reader is served, and the editions that did release " +
            "in this attempt stand as they are — this is not a rollback of them."
        : "This attempt did not release this edition, and it has no earlier publication, so no " +
            "reader is served a revision of it. No other edition in this attempt was changed by it.";
    case "needs-attention":
      return publishesRevision
        ? "This attempt left this edition needing attention, so no new revision was released for " +
            "it. The revision above is its earlier publication and is still the one an authorised " +
            "reader is served. A result that needs attention is a complete result, not a pending one."
        : "This attempt left this edition needing attention, so no revision was released for it and " +
            "no reader is served it yet. A result that needs attention is complete: it names what to " +
            "look at rather than an error that stopped the run.";
    case "withdrawn":
      return (
        "This attempt released nothing for this edition, and the edition is withdrawn: this " +
        "application does not serve it to that audience."
      );
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled per-edition publish state: ${String(unhandled)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// One edition's row
// ---------------------------------------------------------------------------------------------

/** Props of {@link EditionRow}. */
interface EditionRowProps {
  /** The edition this row reports: its variant, the head it publishes and the attempt's result. */
  readonly edition: PublishedEdition;
  /** Every edition's outcome from this attempt, which the lifecycle derivation reads for siblings. */
  readonly synthesis: readonly VariantReleaseOutcome[];
  /** The caller's route to this edition, or to the correction it needs. */
  readonly renderAction?: ((edition: PublishedEdition) => ReactNode) | undefined;
}

/**
 * One edition: who it is for, the lifecycle word of the edition as it now stands, the revision it
 * publishes, the consequence of this attempt, the service's reason, the notice state and the caller's
 * action.
 *
 * The row states two facts that are easy to confuse and must not be: the lifecycle word describes the
 * edition (draft, published, withdrawn), while the consequence describes what *this attempt* produced
 * for it. A failed attempt on a published edition therefore shows a published edition plus a sentence
 * saying this attempt released nothing new — never a badge claiming the earlier publication was undone.
 */
function EditionRow({ edition, synthesis, renderAction }: EditionRowProps): ReactElement {
  const { variant, state } = edition;
  const lifecycle = lifecycleOf(variant, edition.release, { synthesis });
  const audience = AUDIENCE_LABELS[variant.audience];
  const localeName = LOCALE_DISPLAY_NAMES[variant.locale.tag] ?? variant.locale.tag;
  const publication = publicationOf(edition);
  const reason = edition.reason?.trim() ?? "";
  const reasonCode = edition.reasonCode?.trim() ?? "";
  const noticeDetail = edition.notice?.detail?.trim() ?? "";
  const action = renderAction?.(edition) ?? null;

  return (
    <li
      data-slot="publish-edition"
      data-edition-state={state}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge label={audience.label} srPrefix="Audience" />
        <span className="text-sm text-muted-foreground">
          <span className="sr-only">Language: </span>
          <bdi>{localeName}</bdi>
        </span>
      </p>

      {/* The edition's own state, from the one derivation the Updates and Pages families share. */}
      <DraftStatus state={lifecycle} />

      {publication === null ? (
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
          {NO_REVISION_STATE}
        </p>
      ) : (
        <p className="min-w-0 text-sm text-pretty wrap-anywhere">
          <span className="text-muted-foreground">{`${publication.label}: `}</span>
          <bdi className="mono-identifier">{publication.revisionId}</bdi>
        </p>
      )}

      <p className="text-sm text-pretty wrap-anywhere">
        {narrativeOf(state, publication !== null)}
      </p>

      {/* What a withdrawal claims and, decisively, what it does not: it never states that a submitted
       * notice was taken back or that a copy someone holds was retrieved. The copy module's other
       * withdrawal sentence is left out here on purpose — it names a Page's locale editions, which is
       * not this family's shape. */}
      {state === "withdrawn" ? (
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
          {WITHDRAWAL_WORDING.whatItDoesNotDo}
        </p>
      ) : null}

      {reason === "" ? null : (
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{reason}</p>
      )}

      {reasonCode === "" ? null : (
        <p className="min-w-0 text-sm text-muted-foreground wrap-anywhere">
          <span>Reason code: </span>
          <bdi className="mono-identifier">{reasonCode}</bdi>
        </p>
      )}

      {edition.notice === undefined ? null : (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">Notice for this edition:</span>
          <StatusBadge {...SEND_STATUS[edition.notice.state]} srPrefix="Notice" />
          {noticeDetail === "" ? null : (
            <span className="min-w-0 text-muted-foreground wrap-anywhere">{noticeDetail}</span>
          )}
        </p>
      )}

      {action === null ? null : <div className="min-w-0">{action}</div>}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// The result of one release attempt
// ---------------------------------------------------------------------------------------------

/** Props of {@link PublishResults}. */
export interface PublishResultsProps {
  /** The outcome the release mutation answered with. One of the closed eight; there is no ninth. */
  readonly outcome: MutationOutcome;

  /**
   * One entry per edition the submission covered, carrying the detail the payload reported and the
   * records the caller holds. Omitted or empty where no per-edition result exists.
   */
  readonly editions?: readonly PublishedEdition[];

  /**
   * Checks the result of the uncertain operation, keyed by its `operationId`.
   *
   * Required rather than optional: an unconfirmed release is the one outcome whose only honest
   * recovery is to re-read what happened, so a surface that could render `unknown` may not be built
   * without that route. The handler receives the operation's own identity, which is what keeps the
   * check a read of this attempt rather than a second attempt.
   */
  readonly onCheckResult: (operationId: string) => void | Promise<void>;

  /**
   * Applies the preserved input against the current publication, for a conflict. The receipt shows
   * what the record holds now beside what the caller submitted, and this is the one way forward from
   * there.
   */
  readonly onReapply?: () => void;

  /** Display names by field path, so a refused submission reads "Editions" and not "editions.0". */
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;

  /**
   * A route to one edition, or to the correction it needs, rendered at the end of that edition's row.
   * The caller supplies it because only it knows which edition a row addresses and what that edition
   * permits next; a row without one simply has no action.
   */
  readonly renderEditionAction?: (edition: PublishedEdition) => ReactNode;

  /** The heading level these blocks render at, so they join the page outline. Defaults to 2. */
  readonly headingLevel?: ReceiptHeadingLevel;

  /** Layout classes for the block this surface occupies. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * The result of one release attempt: the receipt for the operation, then what it produced for each
 * edition it covered.
 *
 * The receipt is `operation-result.tsx`'s and this file adds nothing to it beyond a heading that says
 * what was saved; every one of the eight outcomes is therefore rendered in the one vocabulary the
 * application uses, and a `denied`, `conflict`, `unavailable`, `unknown` or `invalid` answer can never
 * be restated here in stronger terms. In particular `unknown` gets the receipt's own "check the
 * result" recovery and nothing else, because nothing else is honest and a resend under a fresh key
 * would be a second attempt at work that may already have happened.
 *
 * The per-edition block exists only for an applied operation. A refusal, a stale revision, an outage
 * or an unconfirmed effect released nothing this surface could describe per edition, and inventing a
 * row for one would state an effect that may not have occurred.
 *
 * It holds no state, fetches nothing, mints no identifier and reads no clock: the outcome, the
 * per-edition detail and every identifier arrive from the caller, which is what makes rendering a
 * stored result a replay rather than a second release.
 */
export function PublishResults({
  outcome,
  editions,
  onCheckResult,
  onReapply,
  fieldLabels,
  renderEditionAction,
  headingLevel = 2,
  className,
}: PublishResultsProps): ReactElement {
  const titleId = useId();
  const Heading = HEADING_TAG[headingLevel];

  const applied = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
  const reported = applied ? (editions ?? []) : [];

  const synthesis = synthesisOf(reported);
  const anyNotice = reported.some((edition) => edition.notice !== undefined);
  const anyUnfinished = reported.some(
    (edition) =>
      edition.state === "failed-with-prior-good-head" || edition.state === "needs-attention",
  );

  /* A refused submission released nothing, so the receipt above is the whole of what there is to
   * read. The sentence added here says only what the receipt cannot: that no edition was attempted,
   * which is a different statement from a selection that was attempted and reported nothing. */
  const refused = outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : undefined;

  /* The check is bound to this operation's identity here, so the one control the receipt offers for
   * an unconfirmed release reads this attempt and cannot stand for a new one. */
  const operationId = outcome.operationId;
  const checkResult = (): void => {
    void onCheckResult(operationId);
  };

  /* The explanations that belong beside the rows rather than in a footnote elsewhere: what a replay
   * is, that one variant's approval approves no other, that acceptance is not delivery or reading,
   * and what a retry of unfinished work must be. Each is stated only where the rows make it relevant,
   * and none of them reports a result. */
  const notes: readonly string[] = [
    ...(outcome.outcome === "alreadyAccepted" ? [REPLAY_NOTE] : []),
    REVIEW_ROUND_NOTE.approvalIsPerVariant,
    ...(anyNotice ? [NOTICE_HONESTY_NOTE] : []),
    ...(anyUnfinished ? [RETRY_INTENT_NOTE] : []),
  ];

  return (
    <div
      data-slot="publish-results"
      data-outcome={outcome.outcome}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <OperationResult
        outcome={outcome}
        heading={RECEIPT_HEADING[outcome.outcome]}
        headingLevel={headingLevel}
        onCheckResult={checkResult}
        onReapply={onReapply}
        fieldLabels={fieldLabels}
      />

      {refused === undefined ? null : (
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
          {refused.count === 0 ? REFUSED_WITHOUT_FIELDS : REFUSED_WITH_FIELDS}
        </p>
      )}

      {!applied ? null : reported.length === 0 ? (
        <StateNotice
          kind="empty"
          title={NO_EDITIONS_TITLE}
          description={NO_EDITIONS_DESCRIPTION}
          action={UPDATES_LIST}
          headingLevel={headingLevel}
        />
      ) : (
        <Card data-slot="publish-editions" className="min-w-0">
          <CardHeader>
            <CardTitle>
              <Heading id={titleId}>{EDITIONS_HEADING}</Heading>
            </CardTitle>
            <CardDescription>{EDITIONS_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            <ul aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
              {reported.map((edition, index) => (
                <EditionRow
                  key={`${edition.variant.variantId}-${String(index)}`}
                  edition={edition}
                  synthesis={synthesis}
                  renderAction={renderEditionAction}
                />
              ))}
            </ul>
            <Separator />
            <div className="flex min-w-0 flex-col gap-2">
              {notes.map((note) => (
                <p key={note} className="text-sm text-muted-foreground text-pretty wrap-anywhere">
                  {note}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PublishResults;
