"use client";
/**
 * The publish-and-notify review of one Update: which frozen editions this release publishes, how each one is
 * released, who a notice could reach, and the one durable result of the attempt.
 *
 * **What this surface owns.** The selection of editions, the statement of each edition's recorded release mode, the
 * acknowledged recipient ceiling, the sibling promise that a failed edition is not rolled back, and the submission
 * itself. What it does not own: the one-step review, which approves or returns a frozen candidate on the review route
 * and is never re-implemented or bypassed here; the per-edition results, which are `./publish-results`; and the
 * eligibility, the ceiling, the intended instant and the dedupe key, which are the service's to decide at command time.
 *
 * **The mode is fixed with the submission.** A frozen candidate carries the release mode its author asked for, the
 * reviewer cannot change it, and `publishVariants` refuses a mode the submission never asked for. So the choice is
 * rendered as the recorded one — both options are shown with their consequences, the one that was not submitted is
 * disabled, and where a notice was not asked for the reason is stated instead of an option that would be refused.
 *
 * **Publication, acceptance, delivery and reading are four outcomes.** This surface submits a release and, when the
 * recorded mode asks for it, one deliberate notice per released edition. It never states that a message arrived or was
 * opened, and it never offers a resend: a repeated press is the same attempt under the same intent, so a replay answers
 * with the result already recorded rather than producing a second copy. The notice an attempt submitted is named in the
 * result by its own identity, which is where the recorded per-send outcomes of that one notice are read.
 *
 * **How to wire it.** `editions` is one row per edition of the variant matrix (`readVariantOverview`), its frozen
 * candidate as `readCandidate` states it — including whether the candidate's own release actions admit a notice — and
 * the release standing at its head. `ceiling` is the audience envelope's own count for this publisher and the Update
 * email purpose (`readAudience`: `counts` and `excludedByReason`), because `readSharePresentation` answers the edition's
 * share card and carries no counts: this file renders the numbers it is given, refuses to submit a notice without them,
 * and never counts eligibility itself.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
// The service's instants are decoded for display and never read from a clock: `Temporal.Instant.from` parses the text
// the record already states, and nothing here asks what time it is.
import { Temporal } from "temporal-polyfill";
import { intentKeyOf, reappliableRevision, type ReviewHeadingLevel } from "@/components/action-review";
import { DraftStatus, type ContentLifecycleState } from "@/components/draft-status";
import { FormFieldGroup, fieldErrorsFromInvalid, refusalSummary, type FieldErrorLookup } from "@/components/form-field";
import SimulationLabel from "@/components/simulation-label";
import StateNotice, { type StateNoticeProps } from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { ContentAudience, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import { AUDIENCE_LABELS, LOCALE_DISPLAY_NAMES, PUBLISH_MODE_LABELS, REVIEW_ROUND_NOTE, SIMULATED_EFFECT_BY_TRIGGER } from "../copy/updates-copy";
import { usePublishVariants, useRequestNotification } from "../hooks/use-update-mutations";
import { useRelease, useSharePresentation, type SharePresentationData, type UpdateReleaseData, type UpdatesQueryState } from "../hooks/use-update-queries";
import { requestNotificationSchema } from "../schemas/notify";
import { PUBLISH_MODES, publishVariantsSchema, type PublishMode, type PublishSelection, type PublishVariantsPayload } from "../schemas/publish";
import PublishResults, { type PublishedEdition, type PublishedEditionNotice, type PublishResultsProps } from "./publish-results";

// ---------------------------------------------------------------------------------------------
// Types, derived from the modules that own them rather than restated here
// ---------------------------------------------------------------------------------------------

/** The one outcome vocabulary every write answers with, taken from the receipt that renders it. */
type PublishOutcome = PublishResultsProps["outcome"];

/**
 * A release record, taken from the per-edition result that renders it. It is what the result rows read, and the only
 * shape a release reaches them in: the plain view below is what crosses the server-to-client boundary.
 */
type PublishRelease = NonNullable<PublishedEdition["release"]>;

/** One release as a route hands it over: the record's own fields with its instants already stated as text. */
export interface PublishReleaseView {
  readonly releaseId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly audience: ContentAudience;
  readonly locale: PublishLocale;
  /** The instant this release was published, exactly as the service states it. */
  readonly publishedAt: string;
  readonly reach: PublishRelease["reach"];
  readonly contentChecksum: string;
  readonly withdrawnAt?: string;
  readonly supersededBy?: string;
}

/** An opaque source identity, taken from the read envelope so a diagnostic and a notice state the same shape. */
type SourceReference = ReadEnvelope<unknown>["source"];

/** The denial reasons the one refusal notice knows, taken from that notice rather than restated. */
type DenialReasonCode = NonNullable<StateNoticeProps["reasonCode"]>;

/** A content locale and its direction, stated as the content records state them. */
type PublishLocale = { readonly tag: string; readonly direction: "ltr" | "rtl" };

/** The release mode that asks for a notice, tied to the schema's own vocabulary so a renamed mode fails compilation. */
const NOTIFY_NOW_MODE = "publish-and-notify-now" satisfies PublishMode;

/** The release mode that submits nothing. */
const PUBLISH_ONLY_MODE = "publish-only" satisfies PublishMode;

/**
 * The two simulated boundaries this surface triggers, taken from the copy module so neither sentence is written here:
 * `publication-reach` for the release the worker confirms, and `mail-submission` for the notice a release whose
 * submission asked for one submits. A boundary is labelled where it is triggered, never in a footnote.
 */
const PUBLISH_SIMULATION = SIMULATED_EFFECT_BY_TRIGGER.publish;
const NOTICE_SIMULATION = SIMULATED_EFFECT_BY_TRIGGER.notify;

/** One frozen candidate as this review shows it: the exact revision it releases and whether its submission asked for a notice. */
export interface PublishCandidateView {
  /** The frozen candidate's own identity, which is the revision it froze. */
  readonly candidateId: string;
  /** The exact revision this release publishes. */
  readonly revisionId: string;
  /** The checksum of that revision, stated so the person releasing it can see what is being released. */
  readonly contentChecksum: string;
  /**
   * Whether the submission that froze this candidate asked for a notice. It is read from the candidate envelope's own
   * release actions — the `publish-and-notify-now` action is available only when the submission asked for it — and it
   * grants nothing: the service re-reads the same policy when the release is applied.
   */
  readonly notifyAdmitted: boolean;
  /** Why a notice is not available for this edition, in the service's own words, when `notifyAdmitted` is false. */
  readonly notifyRefusal?: string;
}

/** One edition of the Update as the variant matrix states it. */
export interface PublishEditionView {
  readonly variantId: string;
  readonly audience: ContentAudience;
  readonly locale: PublishLocale;
  /** The lifecycle word this edition's own records state, derived by the route through the one lifecycle implementation. */
  readonly lifecycle: ContentLifecycleState;
  /** The frozen candidate this edition would release, or `null` when it has none and so cannot be selected. */
  readonly candidate: PublishCandidateView | null;
  /**
   * The release standing at this edition's head, so a failed release's prior-good head can be named. It is the record's
   * own fields with its instants as text: a release reaches this client surface as plain data and is decoded here,
   * because an instant object cannot cross the server-to-client boundary.
   */
  readonly headRelease: PublishReleaseView | null;
}

/** One exclusion reason and how many members it accounts for, with the reason already in the audience's own words. */
export interface PublishExclusionRow {
  readonly reason: string;
  readonly count: number;
}

/**
 * The acknowledged recipient ceiling: the audience envelope's own counts for this publisher and purpose, the state of
 * the source that produced them, or the denial that withheld them. A source that could not be read is never presented
 * as an empty audience, and a denied read carries a reason code and no count at all.
 */
export type PublishAudienceCeiling =
  | { readonly state: "stated"; readonly eligible: number; readonly excluded: number; readonly excludedByReason: readonly PublishExclusionRow[] }
  | { readonly state: "unavailable"; readonly source: SourceReference; readonly guidance?: string }
  | { readonly state: "denied"; readonly reasonCode: DenialReasonCode };

export interface PublishReviewProps {
  /** The authority every write states, taken from the envelope the surface was read under. */
  readonly scope: Scope;
  /** The Update this release publishes an edition of. */
  readonly documentId: string;
  /** The revision of that document the caller read; a release states it as the revision it acted against. */
  readonly expectedRevision: string;
  readonly editions: readonly PublishEditionView[];
  /** The audience envelope's counts for this publisher's Update email purpose, or why they are not available. */
  readonly ceiling?: PublishAudienceCeiling;
  /** The heading level this section occupies in its page; the release review is a section, never the page's own title. */
  readonly headingLevel?: ReviewHeadingLevel;
  readonly className?: string;
}

/** One edition as it was submitted: the snapshot the receipt's per-edition rows are reported against. */
type SubmittedEdition = { readonly variantId: string; readonly audience: ContentAudience; readonly locale: PublishLocale; readonly revisionId: string; readonly contentChecksum: string; readonly mode: PublishMode };

/** What became of one notifying edition's notice: a recorded outcome, or the reason no notice was submitted at all. */
type NoticeAttempt = { readonly variantId: string; readonly notice: PublishedEditionNotice } | { readonly variantId: string; readonly withheld: string };

/** The one result of one attempt, held against the release the worker chose. */
interface ReleaseReport {
  /**
   * The fingerprint of the scope and the release that was submitted. It deliberately leaves the revision token out: an
   * accepted release advances the record's revision, so a receipt keyed on the token would be destroyed by the very
   * success it reports. A different selection changes the fingerprint, which is what clears the receipt.
   */
  readonly payloadKey: string;
  readonly outcome: PublishOutcome;
  readonly submitted: readonly SubmittedEdition[];
  readonly notices: readonly NoticeAttempt[];
}

/** One per-edition state as `publishVariants` reports it, from its per-item results or its stored result. */
interface ReportedEdition {
  readonly variantId: string;
  readonly state: string;
  readonly releaseId: string | null;
  readonly reasonCode?: string;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------------------------
// Wording
//
// Every sentence below belongs to this surface. The simulated effects are not written here: they come from
// `SimulationLabel` through the copy module's trigger keys, so the two boundaries state the same thing everywhere.
// ---------------------------------------------------------------------------------------------

const REVIEW_TITLE = "Release the selected editions";
const REVIEW_INTRO = "A release publishes the exact frozen revision of each edition you select. It sends no message by itself: a notice is a separate deliberate request, and it is submitted here only for an edition whose submission asked for one.";
const EDITIONS_LEGEND = "Editions to release";
const EDITIONS_DESCRIPTION = "Each edition keeps its own draft, its own review and its own release. Tick the editions this release publishes: only an edition with a frozen candidate can be released, and one release lists each edition once.";
const EDITION_DESCRIPTION = "Tick this edition's checkbox to publish its frozen revision in this release.";
const INCLUDE_HINT = "Include this edition in the release";
const MODE_LEGEND = "How this edition is released";
const MODE_DESCRIPTION = "The submission for this edition fixed its release mode, and a release cannot change it.";
const NOTIFY_DROPPED_REASON = "This edition's submission asked for a notice, so releasing it without one is refused. A new submission is required to release it and submit nothing.";
const NO_CANDIDATE_REASON = "This edition has no frozen candidate, so this release cannot publish it. Submit a revision for its one review step first.";
const NO_EDITIONS_TITLE = "This Update has no edition to release";
const NO_EDITIONS_DESCRIPTION = "No edition of this Update exists yet, so there is nothing a release could publish and nothing a notice could point at. Add an audience and language edition first.";
const SELECTION_REQUIRED = "Nothing is selected, so this step has nothing to apply. Tick at least one edition above, then return here.";
const RELEASE_CONFIRM_LABEL = "Release these editions";
const RELEASE_CONFIRM_TITLE = "Release the selected editions?";
const CANCEL_LABEL = "Cancel";
const WORKING_NOTE = "Submitting the release. Nothing else on this page changes while it is in flight.";
const SETTLED_NOTE = "This step is complete for this attempt, and the result below is its record. Changing the selection or the acknowledged ceiling begins a new attempt with its own identity.";
const SETTLED_BLOCK = "This attempt is recorded above, so pressing again would replay it rather than release anything new. Change the selection to begin another release.";
const REFUSED_BEFORE_SENDING = "This release would be refused before it was sent: correct the edition whose message appears beside it above.";
const REPLAY_NOTE = "Pressing release again resubmits this same attempt: it keeps its own identity, so work that was already accepted answers with its result instead of happening twice.";
const SIBLING_PROMISE = "If one selected edition cannot be released, the others proceed. The edition that fails keeps the revision it already published, and nothing is rolled back: this is not a batch that reverts.";
const NOTHING_OUTSIDE = "Nothing outside the editions listed below changes: this step creates no financial record, subscribes no one and completes no task.";
const CEILING_HEADING = "Who a notice could reach";
const CEILING_ACKNOWLEDGEMENT = "This ceiling is the count the audience envelope stated when this review was read. It is acknowledged at this instant, so a person who signs up later never expands it, and the number acknowledged here is the number the notice request carries.";
const CEILING_ELIGIBLE_LABEL = "Eligible recipients";
const CEILING_EXCLUDED_LABEL = "Excluded from this purpose";
const CEILING_NONE_EXCLUDED = "No member of this audience is excluded from this purpose right now, so every membership counted above is eligible.";
const CEILING_UNAVAILABLE_TITLE = "The notice audience could not be read";
const CEILING_UNAVAILABLE_DESCRIPTION = "The eligible and excluded counts behind a notice could not be read, so no notice can be acknowledged from this screen. Publishing is unaffected: a release is a separate step, and it is recorded with the notification still needing attention.";
const CEILING_DENIED_TITLE = "This audience is not available in this session";
const CEILING_DENIED_DESCRIPTION = "The notice audience was refused before it was enumerated, so no count, no membership and no exclusion is stated here. Retrying the same read is the only recovery: it is never presented as an audience of nobody.";
const NOTICE_HEADING = "The notice this release would submit";
const NOTICE_READING_TITLE = "Reading what this notice would point at";
const NOTICE_INTRO = "A notice carries a link to the published edition and its own safe wording. Opening that link checks the reader's current access at that moment, so the message itself confers no access.";
const NOTICE_NO_NOTIFY = "No notice is part of this release: neither selected edition's submission asked for one.";
const NOTICE_TARGET_LABEL = "The notice links to";
const NOTICE_TARGET_WITHDRAWN = "This edition currently publishes nothing: its last release was withdrawn. The notice would point at the address below once this release is recorded.";
const NOTICE_TARGET_UNLISTED = "This edition is published but not listed, so the address is not offered for discovery.";
const NOTICE_TARGET_NONE = "This edition has neither a published revision nor a saved draft to present, so the address a notice would carry cannot be stated yet.";
const NOTICE_UNREADABLE_REASON = "The edition's share presentation could not be read, so no notice is submitted for it. The release proceeds and the notification needs attention.";
const NOTICE_NOT_READY_REASON = "The edition's share presentation had not been read when this release was submitted, so no notice went with it. The release stands and the notification needs attention.";
const NOTICE_CEILING_REASON = "The eligible-recipient ceiling could not be read, so no notice is submitted for it. The release proceeds and the notification needs attention.";
const NOTICE_REFUSED_REASON = "The notice request could not be assembled here, so nothing was sent and nothing was recorded from it. The release is unaffected.";
const NOTICE_ACCEPTED_DETAIL = "The notice request was accepted and its per-recipient results were recorded for this publication intent.";
const NOTICE_REPLAY_DETAIL = "A notice for this publication had already been submitted, so this attempt created no second copy.";
const NOTICE_CONFLICT_DETAIL = "The publication moved while this notice was being submitted, so no notice was submitted. Review the release result and submit the notice again against the revision it states.";
const NOTICE_DENIED_DETAIL = "This session may not submit a notice for this publication, so none was submitted.";
const NOTICE_UNKNOWN_DETAIL = "The notice's result was not confirmed. Check the result under this attempt's identity: nothing here states that a message was accepted, and nothing offers to send it again.";
const NOTICE_UNEXPECTED_DETAIL = "The notice answered with a result this surface does not describe, so nothing is claimed about acceptance here.";
const STANDING_HEADING = "What this edition publishes now";
const STANDING_RELEASED = "Currently published";
const STANDING_NONE = "This edition publishes nothing yet, so this release is its first publication.";
const STANDING_WITHDRAWN = "This edition's last publication was withdrawn, so this release publishes it again.";
const STANDING_CHECKING = "Re-reading this edition's release head and its share presentation. Whatever the service now states is what appears here.";
const CHECK_READS = "Checking the result re-reads this edition's release head and its share presentation; the release result above is the record of the attempt, and the service states which revision stands.";
const WITHHELD_PREFIX = "Published. Notification needs attention:";

// ---------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------

/** Whether a value is a plain JSON object, so a stored result is narrowed rather than trusted. */
function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The non-empty text a value carries, or `null`. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The heading level one step below the section's own, for the blocks inside it. */
function childLevel(level: ReviewHeadingLevel): ReviewHeadingLevel {
  return level === 2 ? 3 : 4;
}

/** The release mode the submission for this edition fixed, which is the only mode its release may state. */
function fixedModeOf(edition: PublishEditionView): PublishMode {
  return edition.candidate?.notifyAdmitted === true ? NOTIFY_NOW_MODE : PUBLISH_ONLY_MODE;
}

/** Why a notice is not part of this edition's release, in the service's words where it stated one. */
function notifyRefusalOf(edition: PublishEditionView): string {
  const stated = (edition.candidate?.notifyRefusal ?? "").trim();
  return stated === "" ? REVIEW_ROUND_NOTE.reviewerCannotAddNotify : stated;
}

/** The audience's word for one edition, isolated so a mixed-direction value never reorders the sentence around it. */
function audienceLabelOf(edition: PublishEditionView): string {
  return AUDIENCE_LABELS[edition.audience].label;
}

/** The human name of one edition's content locale, falling back to the tag the read stated. */
function localeNameOf(edition: PublishEditionView): string {
  return LOCALE_DISPLAY_NAMES[edition.locale.tag] ?? edition.locale.tag;
}

/** One edition's selection as the release payload states it, with the mode its submission fixed. */
function selectionOf(edition: PublishEditionView, candidate: PublishCandidateView): PublishSelection {
  return { variantId: edition.variantId, revisionId: candidate.revisionId, mode: fixedModeOf(edition), candidateNotifyAdmitted: candidate.notifyAdmitted };
}

/**
 * The fingerprint a receipt is held against: the scope and the release the worker chose, with the revision token
 * replaced by a fixed marker. A receipt keyed on the token itself would vanish the moment the release advanced it.
 */
const REPORT_KEY_REVISION = "release-report";
const payloadKeyOf = (scope: Scope, payload: PublishVariantsPayload): string => intentKeyOf({ scope, expectedRevision: REPORT_KEY_REVISION, payload });

/** The per-edition states one attempt reported, from its per-item results and its stored result, keyed by edition. */
function reportedEditionsOf(outcome: PublishOutcome): ReadonlyMap<string, ReportedEdition> {
  const reported = new Map<string, ReportedEdition>();
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted": {
      if (outcome.outcome === "alreadyAccepted") {
        for (const stored of storedEditionsOf(outcome.result)) reported.set(stored.variantId, stored);
      }
      for (const item of outcome.items ?? []) {
        const released = item.state === "released";
        reported.set(item.targetId, { variantId: item.targetId, state: item.state, releaseId: released ? textOf(item.revision) : null, ...(item.reasonCode === undefined ? {} : { reasonCode: item.reasonCode }), ...(item.reason === undefined ? {} : { reason: item.reason }) });
      }
      return reported;
    }
    case "unchanged":
    case "conflict":
    case "denied":
    case "invalid":
    case "unavailable":
    case "unknown":
      return reported;
  }
}

/** The per-edition rows a replay's stored result carries, narrowed from the opaque value the ledger holds. */
function storedEditionsOf(result: unknown): readonly ReportedEdition[] {
  if (!isRecordValue(result)) return [];
  const editions = result["editions"];
  if (!Array.isArray(editions)) return [];
  const rows: ReportedEdition[] = [];
  for (const entry of editions) {
    if (!isRecordValue(entry)) continue;
    const variantId = textOf(entry["variantId"]);
    const state = textOf(entry["state"]);
    if (variantId === null || state === null) continue;
    const reasonCode = textOf(entry["reasonCode"]);
    const reason = textOf(entry["reason"]);
    rows.push({ variantId, state, releaseId: state === "released" ? textOf(entry["releaseId"]) : null, ...(reasonCode === null ? {} : { reasonCode }), ...(reason === null ? {} : { reason }) });
  }
  return rows;
}

/** The release each released edition now stands at, as the attempt reported it: the identity a notice is submitted for. */
function releasedIdsOf(outcome: PublishOutcome): ReadonlyMap<string, string> {
  const releases = new Map<string, string>();
  for (const [variantId, reported] of reportedEditionsOf(outcome)) {
    const releaseId = reported.releaseId;
    if (reported.state === "released" && releaseId !== null) releases.set(variantId, releaseId);
  }
  return releases;
}

/** One per-edition state in the words the result rows use, including a state this surface was not told about. */
function publishStateOf(state: string): PublishedEdition["state"] {
  switch (state) {
    case "released":
      return "released";
    case "failed-prior-good-head":
      return "failed-with-prior-good-head";
    case "needs-attention":
      return "needs-attention";
    default:
      // A state this surface does not know is reported as needing attention rather than as a release: claiming a
      // publication the service did not state would be the one error a result must never make.
      return "needs-attention";
  }
}

/**
 * The identity the recorded per-send results of one accepted notice are read under, or nothing when the answer states
 * none. A first acceptance mints the intent and then the send result it is recorded in, so the intent is the first
 * identity the answer reports; a replay answers with the stored submission, whose own `intentId` names that same
 * notice. Nothing here mints, parses or derives an identity, and nothing states one the service did not.
 */
function noticeIdentityOf(outcome: PublishOutcome): Pick<PublishedEditionNotice, "intentId"> {
  const stored = outcome.outcome === "alreadyAccepted" ? textOf(isRecordValue(outcome.result) ? outcome.result["intentId"] : undefined) : null;
  const created = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? textOf(outcome.created?.[0]) : null;
  const intentId = stored ?? created;
  return intentId === null ? {} : { intentId };
}

/** What one notice attempt reported, in the words the result rows use for a notice, with the identity its outcomes are recorded under where the answer states one. */
function noticeAttemptOf(variantId: string, outcome: PublishOutcome): NoticeAttempt {
  switch (outcome.outcome) {
    case "accepted":
      return { variantId, notice: { state: "accepted", detail: NOTICE_ACCEPTED_DETAIL, ...noticeIdentityOf(outcome) } };
    case "alreadyAccepted":
      return { variantId, notice: { state: "accepted", detail: NOTICE_REPLAY_DETAIL, ...noticeIdentityOf(outcome) } };
    case "unchanged":
      // The service answers `unchanged` when this publication's notice was already submitted: no second copy exists
      // and none was created by this attempt, and the answer names no identity for the copy already on record — so
      // this row states that and offers no link rather than pointing at a notice it would have had to guess.
      return { variantId, notice: { state: "accepted", detail: NOTICE_REPLAY_DETAIL } };
    case "conflict":
      return { variantId, notice: { state: "failed", detail: NOTICE_CONFLICT_DETAIL } };
    case "denied":
      return { variantId, notice: { state: "failed", detail: NOTICE_DENIED_DETAIL } };
    case "invalid":
      return { variantId, notice: { state: "failed", detail: refusalSummary(outcome) } };
    case "unavailable":
      return { variantId, notice: { state: "failed", detail: outcome.guidance } };
    case "unknown":
      return { variantId, notice: { state: "unknown", detail: NOTICE_UNKNOWN_DETAIL } };
    default:
      // The outcome union is closed, so this arm is unreachable; it states nothing rather than claiming acceptance.
      return { variantId, notice: { state: "unknown", detail: NOTICE_UNEXPECTED_DETAIL } };
  }
}

/**
 * The per-field messages a schema's issues name, keyed the way the one form presentation reads them. The release
 * schema is checked here so a selection the service would refuse is refused before any request leaves this page —
 * including the one refusal that matters most: a notice chosen for a candidate whose submission never asked for one.
 */
function messagesOfIssues(error: { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] }): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "_root" : issue.path.map((step) => String(step)).join(".");
    const existing = messages[path];
    if (existing === undefined) messages[path] = [issue.message];
    else if (!existing.includes(issue.message)) existing.push(issue.message);
  }
  return messages;
}

/** The refusal one selection would meet, or `null` when the selection is one a release accepts. */
function selectionRefusalOf(payload: PublishVariantsPayload): FieldErrorLookup | null {
  const checked = publishVariantsSchema.safeParse(payload);
  return checked.success ? null : fieldErrorsFromInvalid({ fields: messagesOfIssues(checked.error) });
}

// ---------------------------------------------------------------------------------------------
// The heading a block inside the review occupies, and the one way an instant becomes text
// ---------------------------------------------------------------------------------------------

const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;

/** One instant as the record states it. The value is the service's own, rendered as text and never recomputed here. */
function instantText(value: { toString(): string }): string {
  return value.toString();
}

/**
 * One release view decoded into the record the result rows read, or `undefined` when the stated instant cannot be
 * parsed: a release the surface cannot read is left unnamed rather than crashing the review that reports it.
 */
function releaseRecordOf(view: PublishReleaseView): PublishRelease | undefined {
  try {
    const publishedAt = Temporal.Instant.from(view.publishedAt);
    const withdrawnAt = view.withdrawnAt === undefined ? undefined : Temporal.Instant.from(view.withdrawnAt);
    return {
      releaseId: view.releaseId,
      variantId: view.variantId,
      revisionId: view.revisionId,
      audience: view.audience,
      locale: view.locale,
      publishedAt,
      reach: view.reach,
      contentChecksum: view.contentChecksum,
      ...(withdrawnAt === undefined ? {} : { withdrawnAt }),
      ...(view.supersededBy === undefined ? {} : { supersededBy: view.supersededBy }),
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// One edition: its identity, the exact revision it releases, and the release mode its submission fixed
// ---------------------------------------------------------------------------------------------

/** The release mode of one edition, shown as the choice it is and stated as the choice it is not. */
function ReleaseModeChoice({ edition, idPrefix, error }: { readonly edition: PublishEditionView; readonly idPrefix: string; readonly error?: string | readonly string[] }): ReactElement {
  const recorded = fixedModeOf(edition);
  const admitted = recorded === NOTIFY_NOW_MODE;
  return (
    <FormFieldGroup legend={MODE_LEGEND} name={`publish-mode-${edition.variantId}`} description={MODE_DESCRIPTION} error={error}>
      {({ describedBy, invalid, legendId }) => (
        <div data-slot="publish-mode" data-mode={recorded} className="flex min-w-0 flex-col gap-2">
          {/*
            The group is read-only rather than absent: a person releasing an edition is entitled to see the other choice
            and what it would have meant, and to read why it is not this edition's. The option that was not submitted is
            disabled, so nothing here can turn a publish-only submission into a notice.
          */}
          <RadioGroup value={recorded} readOnly aria-labelledby={legendId} aria-describedby={describedBy} aria-invalid={invalid}>
            {PUBLISH_MODES.map((option) => {
              const copy = PUBLISH_MODE_LABELS[option];
              const optionId = `${idPrefix}-mode-${option}`;
              const consequenceId = `${optionId}-consequence`;
              return (
                <label key={option} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                  <RadioGroupItem id={optionId} value={option} disabled={option !== recorded} aria-label={copy.label} aria-describedby={consequenceId} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{copy.label}</span>
                    <span id={consequenceId} className="text-sm text-muted-foreground text-pretty">
                      {copy.consequence}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
          <p data-slot="publish-mode-reason" className="text-sm text-muted-foreground text-pretty wrap-anywhere">
            {admitted ? NOTIFY_DROPPED_REASON : notifyRefusalOf(edition)}
          </p>
        </div>
      )}
    </FormFieldGroup>
  );
}

/** One frozen candidate's facts: the exact revision and checksum, both isolated and both stated once. */
function FrozenRevisionFacts({ candidate }: { readonly candidate: PublishCandidateView }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-1 text-sm">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="text-muted-foreground">Frozen revision</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi className="mono-identifier">{candidate.revisionId}</bdi>
        </dd>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="text-muted-foreground">Content checksum</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi className="mono-identifier">{candidate.contentChecksum}</bdi>
        </dd>
      </div>
    </dl>
  );
}

interface EditionRowProps {
  readonly edition: PublishEditionView;
  readonly index: number;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly refusal: FieldErrorLookup | null;
  readonly onSelectedChange: (selected: boolean) => void;
}

/** One edition of the release: what it is, what it publishes, and — once selected — how it is released. */
function EditionRow({ edition, index, selected, disabled, refusal, onSelectedChange }: EditionRowProps): ReactElement {
  const idPrefix = useId();
  const candidate = edition.candidate;
  const modeRefusal = refusal?.byField[`variants.${String(index)}.mode`];
  const name = `${audienceLabelOf(edition)} — ${localeNameOf(edition)}`;
  return (
    <li data-slot="publish-review-edition" data-variant-id={edition.variantId} data-selected={selected ? "true" : "false"} data-lifecycle-state={edition.lifecycle} data-mode={fixedModeOf(edition)} className="min-w-0 rounded-lg border border-border p-3">
      {/*
        Each edition is one labelled group: the legend names the audience and language, so a tick, a lifecycle word and a
        release mode all belong to a named edition rather than to an unlabelled list item.
      */}
      <FormFieldGroup legend={name} name={`publish-edition-${edition.variantId}`} description={candidate === null ? NO_CANDIDATE_REASON : EDITION_DESCRIPTION}>
        {({ legendId }) => (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="sr-only">Language: </span>
              <bdi>{localeNameOf(edition)}</bdi>
              <span className="sr-only">Language tag: </span>
              <bdi className="mono-identifier">{edition.locale.tag}</bdi>
            </p>
            {candidate === null ? null : (
              <p className="flex min-w-0 items-center gap-3">
                <Checkbox
                  id={`${idPrefix}-select`}
                  checked={selected}
                  disabled={disabled}
                  // The primitive renders its control beside a labelled input, so the name is stated on the control
                  // itself: every tick says which edition it selects, and the group legend states the same edition.
                  aria-label={`Release ${name}`}
                  aria-describedby={legendId}
                  onCheckedChange={(checked: boolean) => {
                    onSelectedChange(checked);
                  }}
                />
                <span className="text-sm text-pretty">{INCLUDE_HINT}</span>
              </p>
            )}
            <DraftStatus state={edition.lifecycle} />
            {candidate === null ? null : <FrozenRevisionFacts candidate={candidate} />}
            {selected && candidate !== null ? <ReleaseModeChoice edition={edition} idPrefix={idPrefix} error={modeRefusal} /> : null}
          </div>
        )}
      </FormFieldGroup>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// The acknowledged recipient ceiling
// ---------------------------------------------------------------------------------------------

/**
 * Who a notice could reach, stated exactly as the audience envelope stated it. A source that could not be read is a
 * notice of its own and never an audience of nobody; a denial states a reason code and no count at all, because
 * authorisation precedes enumeration.
 */
function CeilingBlock({ ceiling, level }: { readonly ceiling: PublishAudienceCeiling | undefined; readonly level: ReviewHeadingLevel }): ReactElement {
  const Heading = HEADING_TAG[level];
  if (ceiling === undefined) {
    return <StateNotice kind="unavailable" headingLevel={level} title={CEILING_UNAVAILABLE_TITLE} description={CEILING_UNAVAILABLE_DESCRIPTION} />;
  }
  if (ceiling.state === "unavailable") {
    return <StateNotice kind="unavailable" headingLevel={level} title={CEILING_UNAVAILABLE_TITLE} description={ceiling.guidance ?? CEILING_UNAVAILABLE_DESCRIPTION} source={ceiling.source} />;
  }
  if (ceiling.state === "denied") {
    return <StateNotice kind="denied" headingLevel={level} title={CEILING_DENIED_TITLE} description={CEILING_DENIED_DESCRIPTION} reasonCode={ceiling.reasonCode} />;
  }
  return (
    <section data-slot="publish-ceiling" data-state="stated" data-eligible={String(ceiling.eligible)} data-excluded={String(ceiling.excluded)} className="flex min-w-0 flex-col gap-2">
      <Heading className="text-sm font-medium">{CEILING_HEADING}</Heading>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-muted-foreground">{`${CEILING_ELIGIBLE_LABEL}:`}</span>
        <bdi className="tabular-figures font-medium text-foreground">{String(ceiling.eligible)}</bdi>
      </p>
      {/*
        Zero exclusions are stated in words rather than as a numeral: an audience nobody is excluded from and an
        audience whose exclusions could not be counted must never read the same, and only the first is a fact.
      */}
      {ceiling.excluded === 0 ? (
        <p className="text-sm text-muted-foreground text-pretty">{CEILING_NONE_EXCLUDED}</p>
      ) : (
        <>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">{`${CEILING_EXCLUDED_LABEL}:`}</span>
            <bdi className="tabular-figures font-medium text-foreground">{String(ceiling.excluded)}</bdi>
          </p>
          <ul className="flex min-w-0 flex-col gap-1">
            {ceiling.excludedByReason.map((row) => (
              <li key={row.reason} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground text-pretty wrap-anywhere">
                <bdi className="tabular-figures text-foreground">{String(row.count)}</bdi>
                <span>{row.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-sm text-muted-foreground text-pretty">{CEILING_ACKNOWLEDGEMENT}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// What one edition publishes now, and what the notice would point at
// ---------------------------------------------------------------------------------------------

/** The release standing at the focused edition's head, so a failed release can be read against what it keeps. */
function PublicationStanding({ release, level }: { readonly release: UpdatesQueryState<UpdateReleaseData>; readonly level: ReviewHeadingLevel }): ReactElement {
  const Heading = HEADING_TAG[level];
  const result = release.result;
  if (result === undefined) {
    return <StateNotice kind="loading" headingLevel={level} title={STANDING_HEADING} description={STANDING_CHECKING} loadingLines={1} />;
  }
  if (result.kind === "denied") {
    return <StateNotice kind="denied" headingLevel={level} title={STANDING_HEADING} description={NOTICE_UNREADABLE_REASON} reasonCode={result.denied.reasonCode} />;
  }
  if (result.kind === "unavailable") {
    return <StateNotice kind="unavailable" headingLevel={level} title={STANDING_HEADING} description={result.unavailable.guidance} source={result.unavailable.source} />;
  }
  if (result.kind === "refused") {
    return <StateNotice kind="refused" headingLevel={level} title={STANDING_HEADING} />;
  }
  const data = result.envelope.data;
  return (
    <section data-slot="publish-standing" data-status={data.status} className="flex min-w-0 flex-col gap-1">
      <Heading className="text-sm font-medium">{STANDING_HEADING}</Heading>
      {data.status === "released" ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-muted-foreground">{`${STANDING_RELEASED}:`}</span>
          <bdi className="mono-identifier">{data.release.revisionId}</bdi>
          <span className="text-muted-foreground">{instantText(data.release.publishedAt)}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground text-pretty">{data.status === "withdrawn" ? STANDING_WITHDRAWN : STANDING_NONE}</p>
      )}
      {release.isFetching ? <p className="text-sm text-muted-foreground text-pretty">{STANDING_CHECKING}</p> : null}
    </section>
  );
}

/**
 * The notice this release would submit: the address it would carry and the edition it would point at. A share
 * presentation that cannot be read withholds the notice rather than the release, because a release is safe work on its
 * own and a notice is a second, deliberate effect.
 */
function NoticeTarget({ edition, share, level }: { readonly edition: PublishEditionView | null; readonly share: UpdatesQueryState<SharePresentationData>; readonly level: ReviewHeadingLevel }): ReactElement {
  const Heading = HEADING_TAG[level];
  const result = share.result;
  const detail = (): ReactElement => {
    if (edition === null) return <p className="text-sm text-muted-foreground text-pretty">{NOTICE_NO_NOTIFY}</p>;
    if (result === undefined) {
      return <StateNotice kind="loading" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={STANDING_CHECKING} loadingLines={1} />;
    }
    if (result.kind === "denied") {
      return <StateNotice kind="denied" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={NOTICE_UNREADABLE_REASON} reasonCode={result.denied.reasonCode} />;
    }
    if (result.kind === "unavailable") {
      return <StateNotice kind="unavailable" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={NOTICE_UNREADABLE_REASON} source={result.unavailable.source} />;
    }
    if (result.kind === "refused") {
      return <StateNotice kind="refused" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={NOTICE_UNREADABLE_REASON} />;
    }
    const data = result.envelope.data;
    if (data.status === "no-presentation") {
      return <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{NOTICE_TARGET_NONE}</p>;
    }
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {data.status === "shareable" && data.title.trim() !== "" ? (
          <p className="text-sm text-pretty wrap-anywhere">
            <span className="text-muted-foreground">Presents: </span>
            <bdi>{data.title}</bdi>
          </p>
        ) : null}
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-muted-foreground">{`${NOTICE_TARGET_LABEL}:`}</span>
          <bdi className="mono-identifier wrap-anywhere">{data.canonicalPath}</bdi>
        </p>
        {data.status === "withdrawn" ? <p className="text-sm text-muted-foreground text-pretty">{NOTICE_TARGET_WITHDRAWN}</p> : null}
        {data.status === "shareable" && data.robots === "noindex" ? <p className="text-sm text-muted-foreground text-pretty">{NOTICE_TARGET_UNLISTED}</p> : null}
      </div>
    );
  };
  return (
    <section data-slot="publish-notice" data-notice-edition={edition?.variantId ?? ""} className="flex min-w-0 flex-col gap-2">
      <Heading className="text-sm font-medium">{NOTICE_HEADING}</Heading>
      <p className="text-sm text-muted-foreground text-pretty">{NOTICE_INTRO}</p>
      {detail()}
      {edition === null ? null : <SimulationLabel effect={NOTICE_SIMULATION} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The one confirmation, and the attempt it starts
// ---------------------------------------------------------------------------------------------

interface ReleaseConfirmationProps {
  readonly selections: readonly PublishEditionView[];
  readonly notifyCount: number;
  readonly blockedReason: string | null;
  readonly busy: boolean;
  readonly onConfirm: () => void;
}

/**
 * The confirmation a release requires. It repeats what is being released, the sibling promise, the acknowledged
 * ceiling and both simulated boundaries, because the dialog is what a person actually agrees to; the trigger is
 * disabled while there is nothing to release and says why beside it.
 */
function ReleaseConfirmation({ selections, notifyCount, blockedReason, busy, onConfirm }: ReleaseConfirmationProps): ReactElement {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const describedBy = blockedReason === null ? undefined : reasonId;
  const confirm = (): void => {
    setOpen(false);
    onConfirm();
  };
  const editions =
    selections.length === 1
      ? `This releases one edition${notifyCount === 0 ? " and submits no notice." : ", and submits one notice."}`
      : `This releases ${String(selections.length)} editions${notifyCount === 0 ? " and submits no notice." : `, and submits ${String(notifyCount)} notices, one for each edition that asked for one.`}`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button type="button" disabled={blockedReason !== null || busy} aria-describedby={describedBy} />}>{RELEASE_CONFIRM_LABEL}</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{RELEASE_CONFIRM_TITLE}</AlertDialogTitle>
              {/* The description element is itself a paragraph, so each sentence is a span laid out as a block. */}
              <AlertDialogDescription className="flex flex-col gap-2">
                <span>{editions}</span>
                <span>{SIBLING_PROMISE}</span>
                {notifyCount === 0 ? null : <span>{CEILING_ACKNOWLEDGEMENT}</span>}
                <span>{NOTHING_OUTSIDE}</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex min-w-0 flex-col gap-1 text-sm">
              {selections.map((edition) => (
                <li key={edition.variantId} data-slot="publish-confirm-edition" data-mode={fixedModeOf(edition)} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <StatusBadge label={audienceLabelOf(edition)} tone="neutral" srPrefix="Audience" />
                  <bdi className="wrap-anywhere">{localeNameOf(edition)}</bdi>
                  <span className="text-muted-foreground">{PUBLISH_MODE_LABELS[fixedModeOf(edition)].label}</span>
                </li>
              ))}
            </ul>
            <SimulationLabel effect={PUBLISH_SIMULATION} context="block" />
            {notifyCount === 0 ? null : <SimulationLabel effect={NOTICE_SIMULATION} context="block" />}
            <AlertDialogFooter>
              <AlertDialogCancel>{CANCEL_LABEL}</AlertDialogCancel>
              <AlertDialogAction onClick={confirm} disabled={busy}>
                {RELEASE_CONFIRM_LABEL}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <SimulationLabel effect={PUBLISH_SIMULATION} />
      </div>
      {blockedReason === null ? null : (
        <p id={reasonId} className="text-sm text-muted-foreground text-pretty wrap-anywhere">
          {blockedReason}
        </p>
      )}
      {busy ? <output className="block text-sm text-muted-foreground text-pretty wrap-anywhere">{WORKING_NOTE}</output> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/**
 * The publish-and-notify review: the editions this release publishes, the mode each submission fixed, the acknowledged
 * ceiling, the sibling promise, and the one result of the attempt.
 */
export function PublishReview({ scope, documentId, expectedRevision, editions, ceiling, headingLevel = 2, className }: PublishReviewProps): ReactElement {
  const titleId = useId();
  const Heading = HEADING_TAG[headingLevel];
  const childHeading = childLevel(headingLevel);
  const router = useRouter();
  const publish = usePublishVariants();
  const notify = useRequestNotification();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const pending = busy || publish.pending || notify.pending;
  const selectable = useMemo(() => editions.filter((edition) => edition.candidate !== null), [editions]);
  const chosen = useMemo(() => selectable.filter((edition) => selected.includes(edition.variantId)), [selectable, selected]);
  const notifyEditions = useMemo(() => chosen.filter((edition) => fixedModeOf(edition) === NOTIFY_NOW_MODE), [chosen]);
  const noticeEdition = notifyEditions[0] ?? null;
  // The release head is stated only for an edition this release is actually going to publish: naming the first edition
  // of the matrix and then re-scoping to the selected one would show two different publications for one surface.
  const standingEdition = chosen[0] ?? null;

  // The two reads this review needs: the release standing at the head of the edition being released, and the share
  // presentation of the edition whose notice is being prepared. Neither is asked for until there is an edition to ask
  // about, and neither counts eligibility: that is the audience envelope's to state, and it arrives in `ceiling`.
  const release = useRelease({ scope, variantId: standingEdition?.variantId ?? "" });
  const share = useSharePresentation({ scope, variantId: noticeEdition?.variantId ?? "" });

  const payload = useMemo<PublishVariantsPayload>(() => ({ documentId, variants: chosen.flatMap((edition) => (edition.candidate === null ? [] : [selectionOf(edition, edition.candidate)])) }), [documentId, chosen]);
  const releaseKey = payloadKeyOf(scope, payload);
  const refusal = useMemo(() => (payload.variants.length === 0 ? null : selectionRefusalOf(payload)), [payload]);
  const current = report !== null && report.payloadKey === releaseKey ? report : null;
  const releaseRead = release.result;
  const standingRelease = releaseRead !== undefined && releaseRead.kind === "envelope" && releaseRead.envelope.data.status === "released" ? releaseRead.envelope.data.release : undefined;
  const settled = current !== null && (current.outcome.outcome === "accepted" || current.outcome.outcome === "alreadyAccepted" || current.outcome.outcome === "unchanged");
  const reapplyRevision = reappliableRevision(current?.outcome ?? null);

  const submittedOf = useCallback(
    (): readonly SubmittedEdition[] => chosen.flatMap((edition) => (edition.candidate === null ? [] : [{ variantId: edition.variantId, audience: edition.audience, locale: edition.locale, revisionId: edition.candidate.revisionId, contentChecksum: edition.candidate.contentChecksum, mode: fixedModeOf(edition) }])),
    [chosen],
  );

  /**
   * One attempt: release the selected editions, then — for each edition whose submission asked for a notice — submit
   * that notice as its own deliberate request against the release it just produced. The publish keeps one identity for
   * one intent, so a repeated press replays the recorded result; the notice has its own intent for the same reason.
   * Nothing here counts eligibility, mints an instant or offers to send anything a second time.
   */
  const attempt = useCallback(
    async (revision: string): Promise<void> => {
      if (inFlight.current) return;
      const submitted = submittedOf();
      if (submitted.length === 0) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const attemptPayload: PublishVariantsPayload = { documentId, variants: chosen.flatMap((edition) => (edition.candidate === null ? [] : [selectionOf(edition, edition.candidate)])) };
        const published = await publish.submit({ scope, expectedRevision: revision, payload: attemptPayload });
        const notices: NoticeAttempt[] = [];
        if (published.outcome === "accepted" || published.outcome === "alreadyAccepted") {
          const releases = releasedIdsOf(published);
          for (const edition of chosen) {
            if (fixedModeOf(edition) !== NOTIFY_NOW_MODE) continue;
            const releaseId = releases.get(edition.variantId);
            if (releaseId === undefined) continue;
            if (ceiling === undefined || ceiling.state !== "stated") {
              notices.push({ variantId: edition.variantId, withheld: NOTICE_CEILING_REASON });
              continue;
            }
            if (share.result === undefined) {
              notices.push({ variantId: edition.variantId, withheld: NOTICE_NOT_READY_REASON });
              continue;
            }
            if (share.result.kind !== "envelope") {
              notices.push({ variantId: edition.variantId, withheld: NOTICE_UNREADABLE_REASON });
              continue;
            }
            const noticePayload = { documentId, variantId: edition.variantId, releaseId, acknowledgedCeiling: ceiling.eligible };
            if (!requestNotificationSchema.safeParse(noticePayload).success) {
              notices.push({ variantId: edition.variantId, withheld: NOTICE_REFUSED_REASON });
              continue;
            }
            const answered = await notify.submit({ scope, expectedRevision: published.revision, payload: noticePayload });
            notices.push(noticeAttemptOf(edition.variantId, answered));
          }
        }
        setReport({ payloadKey: payloadKeyOf(scope, attemptPayload), outcome: published, submitted, notices });
        // A release moves what every edition's read states, so the page re-reads its own envelope rather than this
        // surface placing the result beside a matrix it does not own. The one edition this surface reads is re-read as
        // well, because the receipt names the revision it published from the service's own record of it.
        if (published.outcome === "accepted" || published.outcome === "alreadyAccepted") {
          release.refetch();
          router.refresh();
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [ceiling, chosen, documentId, notify, publish, release, router, scope, share.result, submittedOf],
  );

  const confirmRelease = useCallback((): void => {
    void attempt(expectedRevision);
  }, [attempt, expectedRevision]);

  const reapply = useCallback((): void => {
    if (reapplyRevision === null) return;
    void attempt(reapplyRevision);
  }, [attempt, reapplyRevision]);

  // Checking the result re-reads the two reads this surface is allowed to read: the release head of the edition being
  // released and the share presentation of its notice. Each result row states what the service said; this never
  // guesses an outcome from the absence of an error.
  const checkResult = useCallback((): void => {
    release.refetch();
    share.refetch();
  }, [release, share]);

  const resultEditions = useMemo<readonly PublishedEdition[]>(() => {
    if (current === null) return [];
    const reported = reportedEditionsOf(current.outcome);
    const rows: PublishedEdition[] = [];
    for (const submitted of current.submitted) {
      const stated = reported.get(submitted.variantId);
      if (stated === undefined) continue;
      const state = publishStateOf(stated.state);
      const live = editions.find((edition) => edition.variantId === submitted.variantId);
      const fromRoute = live?.headRelease == null ? undefined : releaseRecordOf(live.headRelease);
      // The one edition this surface reads for itself supplies the record the release produced, from the service's own
      // statement of it: the route's envelope catches up a moment later, and until it does this is the only honest
      // source for the revision a reader is now served.
      const fromRead = standingRelease !== undefined && standingRelease.variantId === submitted.variantId && standingRelease.revisionId === submitted.revisionId ? standingRelease : undefined;
      // The surface's own read answers first for a release, because the route's envelope lags a moment behind it and
      // can still name the head this attempt has just superseded: preferring the route there would let a stale head
      // mask the revision the service just published, so the row would name no revision at all. Every other outcome
      // reads the route's prior-good head first, falling back to the read when the envelope carries none.
      const publication = state === "released" ? (fromRead ?? fromRoute) : (fromRoute ?? fromRead);
      // A head is named only when it is the revision this attempt released, or when it is the prior-good head an
      // edition kept: naming any other revision would describe a publication this attempt did not produce.
      const named = publication !== undefined && (state === "released" ? publication.revisionId === submitted.revisionId : true) ? publication : undefined;
      const notice = current.notices.find((entry) => entry.variantId === submitted.variantId);
      rows.push({
        variant: { variantId: submitted.variantId, documentId, audience: submitted.audience, locale: submitted.locale },
        state,
        ...(named === undefined ? {} : { release: named }),
        ...(stated.reasonCode === undefined ? {} : { reasonCode: stated.reasonCode }),
        ...(stated.reason === undefined ? {} : { reason: stated.reason }),
        ...(notice === undefined || "withheld" in notice ? {} : { notice: notice.notice }),
      });
    }
    return rows;
  }, [current, documentId, editions, standingRelease]);

  const withheld = useMemo(() => (current === null ? [] : current.notices.flatMap((entry) => ("withheld" in entry ? [{ variantId: entry.variantId, reason: entry.withheld }] : []))), [current]);

  const fieldLabels = useMemo<Readonly<Record<string, string | undefined>>>(() => {
    const labels: Record<string, string> = { documentId: "This Update", variants: EDITIONS_LEGEND };
    current?.submitted.forEach((submitted, index) => {
      const name = `${AUDIENCE_LABELS[submitted.audience].label} — ${LOCALE_DISPLAY_NAMES[submitted.locale.tag] ?? submitted.locale.tag}`;
      labels[`variants.${String(index)}`] = name;
      labels[`variants.${String(index)}.mode`] = `${MODE_LEGEND} — ${name}`;
      labels[`variants.${String(index)}.variantId`] = name;
    });
    return labels;
  }, [current]);

  useEffect(() => {
    // The result region takes focus once an attempt settles, so a keyboard and a screen reader land on what happened
    // instead of being left on a dialog that has just closed.
    if (current === null) return;
    resultRef.current?.focus();
  }, [current]);

  const selectEdition = (variantId: string, on: boolean): void => {
    setSelected((previous) => (on ? (previous.includes(variantId) ? previous : [...previous, variantId]) : previous.filter((entry) => entry !== variantId)));
  };

  const blockedReason = editions.length === 0 ? null : chosen.length === 0 ? SELECTION_REQUIRED : refusal !== null ? REFUSED_BEFORE_SENDING : settled ? SETTLED_BLOCK : null;
  const state = pending ? "working" : settled ? "settled" : "review";

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={pending ? true : undefined}
      data-slot="publish-review"
      data-state={state}
      data-selected-editions={String(chosen.length)}
      data-notify-editions={String(notifyEditions.length)}
      data-ceiling-state={ceiling?.state ?? "absent"}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <Heading id={titleId}>{REVIEW_TITLE}</Heading>
          </CardTitle>
          <CardDescription>{REVIEW_INTRO}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {editions.length === 0 ? (
            <StateNotice kind="empty" headingLevel={childHeading} title={NO_EDITIONS_TITLE} description={NO_EDITIONS_DESCRIPTION} />
          ) : (
            <FormFieldGroup legend={EDITIONS_LEGEND} name="publish-editions" description={EDITIONS_DESCRIPTION}>
              {() => (
                <ul className="flex min-w-0 flex-col gap-3">
                  {editions.map((edition, index) => (
                    <EditionRow
                      key={edition.variantId}
                      edition={edition}
                      index={index}
                      selected={chosen.some((entry) => entry.variantId === edition.variantId)}
                      disabled={pending}
                      refusal={refusal}
                      onSelectedChange={(next) => {
                        selectEdition(edition.variantId, next);
                      }}
                    />
                  ))}
                </ul>
              )}
            </FormFieldGroup>
          )}
          {standingEdition === null ? null : (
            <>
              <Separator />
              <PublicationStanding release={release} level={childHeading} />
            </>
          )}
          {notifyEditions.length === 0 ? null : (
            <>
              <Separator />
              <CeilingBlock ceiling={ceiling} level={childHeading} />
            </>
          )}
          {editions.length === 0 ? null : (
            <>
              <Separator />
              <NoticeTarget edition={noticeEdition} share={share} level={childHeading} />
              <p className="text-sm text-muted-foreground text-pretty">{SIBLING_PROMISE}</p>
              <p className="text-sm text-muted-foreground text-pretty">{NOTHING_OUTSIDE}</p>
              {settled ? <p className="text-sm text-muted-foreground text-pretty">{SETTLED_NOTE}</p> : <p className="text-sm text-muted-foreground text-pretty">{REPLAY_NOTE}</p>}
              <ReleaseConfirmation selections={chosen} notifyCount={notifyEditions.length} blockedReason={blockedReason} busy={pending} onConfirm={confirmRelease} />
            </>
          )}
        </CardContent>
      </Card>
      {current === null ? null : (
        <div ref={resultRef} tabIndex={-1} data-slot="publish-review-result" data-outcome={current.outcome.outcome} className="flex min-w-0 flex-col gap-3">
          <PublishResults outcome={current.outcome} editions={resultEditions} onCheckResult={checkResult} {...(reapplyRevision === null ? {} : { onReapply: reapply })} fieldLabels={fieldLabels} headingLevel={childHeading} />
          {withheld.length === 0 ? null : (
            <ul data-slot="publish-notice-withheld" className="flex min-w-0 flex-col gap-1">
              {withheld.map((entry) => (
                <li key={entry.variantId} className="text-sm text-pretty wrap-anywhere">
                  {`${WITHHELD_PREFIX} ${entry.reason}`}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground text-pretty">{CHECK_READS}</p>
        </div>
      )}
    </section>
  );
}

export default PublishReview;
