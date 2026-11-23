"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
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
import { requestNotificationSchema, PUBLISH_MODES, publishVariantsSchema, type PublishMode, type PublishSelection, type PublishVariantsPayload } from "../schemas";
import PublishResults, { type PublishedEdition, type PublishedEditionNotice, type PublishResultsProps } from "./publish-results";
type PublishOutcome = PublishResultsProps["outcome"];
type PublishRelease = NonNullable<PublishedEdition["release"]>;
type PublishLocale = { readonly tag: string; readonly direction: "ltr" | "rtl" };
type SourceReference = ReadEnvelope<unknown>["source"];
type DenialReasonCode = NonNullable<StateNoticeProps["reasonCode"]>;
export type PublishReleaseView = {
  readonly releaseId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly audience: ContentAudience;
  readonly locale: PublishLocale;
  readonly publishedAt: string;
  readonly reach: PublishRelease["reach"];
  readonly contentChecksum: string;
  readonly withdrawnAt?: string;
  readonly supersededBy?: string;
};
const NOTIFY_NOW_MODE = "publish-and-notify-now" satisfies PublishMode;
const PUBLISH_ONLY_MODE = "publish-only" satisfies PublishMode;
const PUBLISH_SIMULATION = SIMULATED_EFFECT_BY_TRIGGER.publish;
const NOTICE_SIMULATION = SIMULATED_EFFECT_BY_TRIGGER.notify;
export type PublishCandidateView = { readonly candidateId: string; readonly revisionId: string; readonly contentChecksum: string; readonly notifyAdmitted: boolean; readonly notifyRefusal?: string };
export type PublishEditionView = { readonly variantId: string; readonly audience: ContentAudience; readonly locale: PublishLocale; readonly lifecycle: ContentLifecycleState; readonly candidate: PublishCandidateView | null; readonly headRelease: PublishReleaseView | null };
export type PublishExclusionRow = { readonly reason: string; readonly count: number };
export type PublishAudienceCeiling =
  | { readonly state: "stated"; readonly eligible: number; readonly excluded: number; readonly excludedByReason: readonly PublishExclusionRow[] }
  | { readonly state: "unavailable"; readonly source: SourceReference; readonly guidance?: string }
  | { readonly state: "denied"; readonly reasonCode: DenialReasonCode };
export type PublishReviewProps = { readonly scope: Scope; readonly documentId: string; readonly expectedRevision: string; readonly editions: readonly PublishEditionView[]; readonly ceiling?: PublishAudienceCeiling; readonly headingLevel?: ReviewHeadingLevel; readonly className?: string };
type SubmittedEdition = { readonly variantId: string; readonly audience: ContentAudience; readonly locale: PublishLocale; readonly revisionId: string; readonly contentChecksum: string; readonly mode: PublishMode };
type NoticeAttempt = { readonly variantId: string; readonly notice: PublishedEditionNotice } | { readonly variantId: string; readonly withheld: string };
type ReleaseReport = { readonly selectionKey: string; readonly outcome: PublishOutcome; readonly submitted: readonly SubmittedEdition[]; readonly notices: readonly NoticeAttempt[] };
type ReportedEdition = { readonly variantId: string; readonly state: string; readonly releaseId: string | null; readonly reasonCode?: string; readonly reason?: string };
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
const isRecordValue = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const childLevel = (level: ReviewHeadingLevel): ReviewHeadingLevel => (level === 2 ? 3 : 4);
const fixedModeOf = (edition: PublishEditionView): PublishMode => (edition.candidate?.notifyAdmitted === true ? NOTIFY_NOW_MODE : PUBLISH_ONLY_MODE);
const notifyRefusalOf = (edition: PublishEditionView): string => ((edition.candidate?.notifyRefusal ?? "").trim() === "" ? REVIEW_ROUND_NOTE.reviewerCannotAddNotify : (edition.candidate?.notifyRefusal ?? "").trim());
const audienceLabelOf = (edition: PublishEditionView): string => AUDIENCE_LABELS[edition.audience].label;
const localeNameOf = (edition: PublishEditionView): string => LOCALE_DISPLAY_NAMES[edition.locale.tag] ?? edition.locale.tag;
const selectionOf = (edition: PublishEditionView, candidate: PublishCandidateView): PublishSelection => ({ variantId: edition.variantId, revisionId: candidate.revisionId, mode: fixedModeOf(edition), candidateNotifyAdmitted: candidate.notifyAdmitted });
const REPORT_KEY_REVISION = "release-report";
/** The identity of the selection one release attempt is made from — this document and the editions ticked for it. It names the person's selection rather than the candidate content a release consumes, so the receipt of the attempt it answers stays on the surface after the page's own refresh drops the released candidate, and it changes the moment that selection does, which is the only thing that withholds the receipt. */
const selectionKeyOf = (scope: Scope, documentId: string, selected: readonly string[]): string => intentKeyOf({ scope, expectedRevision: REPORT_KEY_REVISION, payload: { documentId, variantIds: selected.toSorted() } });
function storedEditionsOf(result: unknown): readonly ReportedEdition[] {
  if (!isRecordValue(result) || !Array.isArray(result["editions"])) return [];
  const rows: ReportedEdition[] = [];
  for (const entry of result["editions"]) {
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
function reportedEditionsOf(outcome: PublishOutcome): ReadonlyMap<string, ReportedEdition> {
  const reported = new Map<string, ReportedEdition>();
  if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") return reported;
  if (outcome.outcome === "alreadyAccepted") for (const stored of storedEditionsOf(outcome.result)) reported.set(stored.variantId, stored);
  for (const item of outcome.items ?? []) {
    reported.set(item.targetId, { variantId: item.targetId, state: item.state, releaseId: item.state === "released" ? textOf(item.revision) : null, ...(item.reasonCode === undefined ? {} : { reasonCode: item.reasonCode }), ...(item.reason === undefined ? {} : { reason: item.reason }) });
  }
  return reported;
}
function releasedIdsOf(outcome: PublishOutcome): ReadonlyMap<string, string> {
  const releases = new Map<string, string>();
  for (const [variantId, reported] of reportedEditionsOf(outcome)) if (reported.state === "released" && reported.releaseId !== null) releases.set(variantId, reported.releaseId);
  return releases;
}
const publishStateOf = (state: string): PublishedEdition["state"] => (state === "released" ? "released" : state === "failed-prior-good-head" ? "failed-with-prior-good-head" : "needs-attention");
const NOTICE_ATTEMPT = {
  accepted: { state: "accepted", detail: NOTICE_ACCEPTED_DETAIL },
  alreadyAccepted: { state: "accepted", detail: NOTICE_REPLAY_DETAIL },
  unchanged: { state: "accepted", detail: NOTICE_REPLAY_DETAIL },
  conflict: { state: "failed", detail: NOTICE_CONFLICT_DETAIL },
  denied: { state: "failed", detail: NOTICE_DENIED_DETAIL },
  unknown: { state: "unknown", detail: NOTICE_UNKNOWN_DETAIL },
} as const satisfies Readonly<Record<"accepted" | "alreadyAccepted" | "unchanged" | "conflict" | "denied" | "unknown", PublishedEditionNotice>>;
/** The identity the recorded per-send results of one accepted notice are read under, or nothing when the answer states none: a first acceptance mints the intent and then the send result it is recorded in, while a replay answers with the stored submission, whose own `intentId` names that same notice. Nothing here mints, parses or derives an identity. */
function noticeIdentityOf(outcome: PublishOutcome): Pick<PublishedEditionNotice, "intentId"> {
  const stored = outcome.outcome === "alreadyAccepted" ? textOf(isRecordValue(outcome.result) ? outcome.result["intentId"] : undefined) : null;
  const created = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? textOf(outcome.created?.[0]) : null;
  const intentId = stored ?? created;
  return intentId === null ? {} : { intentId };
}
function noticeAttemptOf(variantId: string, outcome: PublishOutcome): NoticeAttempt {
  if (outcome.outcome === "invalid") return { variantId, notice: { state: "failed", detail: refusalSummary(outcome) } };
  if (outcome.outcome === "unavailable") return { variantId, notice: { state: "failed", detail: outcome.guidance } };
  const row = NOTICE_ATTEMPT[outcome.outcome] ?? { state: "unknown", detail: NOTICE_UNEXPECTED_DETAIL };
  return { variantId, notice: outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? { ...row, ...noticeIdentityOf(outcome) } : row };
}
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
const selectionRefusalOf = (payload: PublishVariantsPayload): FieldErrorLookup | null => {
  const checked = publishVariantsSchema.safeParse(payload);
  return checked.success ? null : fieldErrorsFromInvalid({ fields: messagesOfIssues(checked.error) });
};
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The one type scale's utility for each level, so every block this review opens states its own level's measure rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<ReviewHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const instantText = (value: { toString(): string }): string => value.toString();
function releaseRecordOf(view: PublishReleaseView): PublishRelease | undefined {
  try {
    const withdrawnAt = view.withdrawnAt === undefined ? undefined : Temporal.Instant.from(view.withdrawnAt);
    return {
      releaseId: view.releaseId,
      variantId: view.variantId,
      revisionId: view.revisionId,
      audience: view.audience,
      locale: view.locale,
      publishedAt: Temporal.Instant.from(view.publishedAt),
      reach: view.reach,
      contentChecksum: view.contentChecksum,
      ...(withdrawnAt === undefined ? {} : { withdrawnAt }),
      ...(view.supersededBy === undefined ? {} : { supersededBy: view.supersededBy }),
    };
  } catch {
    return undefined;
  }
}
function ReleaseModeChoice({ edition, idPrefix, error }: { readonly edition: PublishEditionView; readonly idPrefix: string; readonly error?: string | readonly string[] }): ReactElement {
  const recorded = fixedModeOf(edition);
  return (
    <FormFieldGroup legend={MODE_LEGEND} name={`publish-mode-${edition.variantId}`} description={MODE_DESCRIPTION} error={error}>
      {({ describedBy, invalid, legendId }) => (
        <div data-slot="publish-mode" data-mode={recorded} className="flex min-w-0 flex-col gap-2">
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
                    <span {...{ id: consequenceId, className: "type-supporting text-pretty" }}>{copy.consequence}</span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
          <p {...{ "data-slot": "publish-mode-reason", className: "type-supporting text-pretty wrap-anywhere" }}>{recorded === NOTIFY_NOW_MODE ? NOTIFY_DROPPED_REASON : notifyRefusalOf(edition)}</p>
        </div>
      )}
    </FormFieldGroup>
  );
}
const FrozenRevisionFacts = ({ candidate }: { readonly candidate: PublishCandidateView }): ReactElement => (
  <dl className="flex min-w-0 flex-col gap-1 type-body">
    {[
      { term: "Frozen revision", value: candidate.revisionId },
      { term: "Content checksum", value: candidate.contentChecksum },
    ].map((fact) => (
      <div key={fact.term} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="text-muted-foreground">{fact.term}</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi className="mono-identifier">{fact.value}</bdi>
        </dd>
      </div>
    ))}
  </dl>
);
type EditionRowProps = { readonly edition: PublishEditionView; readonly index: number; readonly selected: boolean; readonly disabled: boolean; readonly refusal: FieldErrorLookup | null; readonly onSelectedChange: (selected: boolean) => void };
function EditionRow({ edition, index, selected, disabled, refusal, onSelectedChange }: EditionRowProps): ReactElement {
  const idPrefix = useId();
  const candidate = edition.candidate;
  const modeRefusal = refusal?.byField[`variants.${String(index)}.mode`];
  const name = `${audienceLabelOf(edition)} — ${localeNameOf(edition)}`;
  return (
    <li data-slot="publish-review-edition" data-variant-id={edition.variantId} data-selected={selected ? "true" : "false"} data-lifecycle-state={edition.lifecycle} data-mode={fixedModeOf(edition)} className="min-w-0 rounded-lg border border-border p-3">
      <FormFieldGroup legend={name} name={`publish-edition-${edition.variantId}`} description={candidate === null ? NO_CANDIDATE_REASON : EDITION_DESCRIPTION}>
        {({ legendId }) => (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-supporting">
              <span className="sr-only">Language: </span>
              <bdi>{localeNameOf(edition)}</bdi>
              <span className="sr-only">Language tag: </span>
              <bdi className="mono-identifier">{edition.locale.tag}</bdi>
            </p>
            {candidate === null ? null : (
              <p className="flex min-w-0 items-center gap-3 type-body">
                {/* The primitive renders its control beside a labelled input, so the name is stated on the control itself: every tick says which edition it selects. */}
                <Checkbox id={`${idPrefix}-select`} checked={selected} disabled={disabled} aria-label={`Release ${name}`} aria-describedby={legendId} onCheckedChange={(checked: boolean) => onSelectedChange(checked)} />
                <span className="text-pretty">{INCLUDE_HINT}</span>
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
function CeilingBlock({ ceiling, level }: { readonly ceiling: PublishAudienceCeiling | undefined; readonly level: ReviewHeadingLevel }): ReactElement {
  const Heading = HEADING_TAG[level];
  if (ceiling === undefined) return <StateNotice kind="unavailable" headingLevel={level} title={CEILING_UNAVAILABLE_TITLE} description={CEILING_UNAVAILABLE_DESCRIPTION} />;
  if (ceiling.state === "unavailable") return <StateNotice kind="unavailable" headingLevel={level} title={CEILING_UNAVAILABLE_TITLE} description={ceiling.guidance ?? CEILING_UNAVAILABLE_DESCRIPTION} source={ceiling.source} />;
  if (ceiling.state === "denied") return <StateNotice kind="denied" headingLevel={level} title={CEILING_DENIED_TITLE} description={CEILING_DENIED_DESCRIPTION} reasonCode={ceiling.reasonCode} />;
  return (
    <section data-slot="publish-ceiling" data-state="stated" data-eligible={String(ceiling.eligible)} data-excluded={String(ceiling.excluded)} className="flex min-w-0 flex-col gap-2">
      <Heading className={HEADING_SCALE[level]}>{CEILING_HEADING}</Heading>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
        <span className="text-muted-foreground">{`${CEILING_ELIGIBLE_LABEL}:`}</span>
        <bdi className="tabular-figures font-medium text-foreground">{String(ceiling.eligible)}</bdi>
      </p>
      {/* Zero exclusions are stated in words rather than as a numeral: an audience nobody is excluded from and an audience whose exclusions could not be counted must never read the same, and only the first is a fact. */}
      {ceiling.excluded === 0 ? (
        <p className="type-supporting text-pretty">{CEILING_NONE_EXCLUDED}</p>
      ) : (
        <>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
            <span className="text-muted-foreground">{`${CEILING_EXCLUDED_LABEL}:`}</span>
            <bdi className="tabular-figures font-medium text-foreground">{String(ceiling.excluded)}</bdi>
          </p>
          <ul className="flex min-w-0 flex-col gap-1">
            {ceiling.excludedByReason.map((row) => (
              <li key={row.reason} className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-supporting text-pretty wrap-anywhere">
                <bdi className="tabular-figures text-foreground">{String(row.count)}</bdi>
                <span>{row.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="type-supporting text-pretty">{CEILING_ACKNOWLEDGEMENT}</p>
    </section>
  );
}
/** The release standing at the focused edition's head, so a failed release can be read against what it keeps. */
function PublicationStanding({ release, level }: { readonly release: UpdatesQueryState<UpdateReleaseData>; readonly level: ReviewHeadingLevel }): ReactElement {
  const Heading = HEADING_TAG[level];
  const result = release.result;
  if (result === undefined) return <StateNotice kind="loading" headingLevel={level} title={STANDING_HEADING} description={STANDING_CHECKING} loadingLines={1} />;
  if (result.kind === "denied") return <StateNotice kind="denied" headingLevel={level} title={STANDING_HEADING} description={NOTICE_UNREADABLE_REASON} reasonCode={result.denied.reasonCode} />;
  if (result.kind === "unavailable") return <StateNotice kind="unavailable" headingLevel={level} title={STANDING_HEADING} description={result.unavailable.guidance} source={result.unavailable.source} />;
  if (result.kind === "refused") return <StateNotice kind="refused" headingLevel={level} title={STANDING_HEADING} />;
  const data = result.envelope.data;
  return (
    <section data-slot="publish-standing" data-status={data.status} className="flex min-w-0 flex-col gap-1">
      <Heading className={HEADING_SCALE[level]}>{STANDING_HEADING}</Heading>
      {data.status === "released" ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
          <span className="text-muted-foreground">{`${STANDING_RELEASED}:`}</span>
          <bdi className="mono-identifier">{data.release.revisionId}</bdi>
          <span className="text-muted-foreground">{instantText(data.release.publishedAt)}</span>
        </p>
      ) : (
        <p className="type-supporting text-pretty">{data.status === "withdrawn" ? STANDING_WITHDRAWN : STANDING_NONE}</p>
      )}
      {release.isFetching ? <p className="type-supporting text-pretty">{STANDING_CHECKING}</p> : null}
    </section>
  );
}
function NoticeTarget({ edition, share, level }: { readonly edition: PublishEditionView | null; readonly share: UpdatesQueryState<SharePresentationData>; readonly level: ReviewHeadingLevel }): ReactElement {
  const Heading = HEADING_TAG[level];
  const result = share.result;
  const detail = (): ReactElement => {
    if (edition === null) return <p className="type-supporting text-pretty">{NOTICE_NO_NOTIFY}</p>;
    if (result === undefined) return <StateNotice kind="loading" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={STANDING_CHECKING} loadingLines={1} />;
    if (result.kind === "denied") return <StateNotice kind="denied" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={NOTICE_UNREADABLE_REASON} reasonCode={result.denied.reasonCode} />;
    if (result.kind === "unavailable") return <StateNotice kind="unavailable" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={NOTICE_UNREADABLE_REASON} source={result.unavailable.source} />;
    if (result.kind === "refused") return <StateNotice kind="refused" headingLevel={childLevel(level)} title={NOTICE_READING_TITLE} description={NOTICE_UNREADABLE_REASON} />;
    const data = result.envelope.data;
    if (data.status === "no-presentation") return <p className="type-supporting text-pretty wrap-anywhere">{NOTICE_TARGET_NONE}</p>;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {data.status === "shareable" && data.title.trim() !== "" ? (
          <p className="type-body text-pretty wrap-anywhere">
            <span className="text-muted-foreground">Presents: </span>
            <bdi>{data.title}</bdi>
          </p>
        ) : null}
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 type-body">
          <span className="text-muted-foreground">{`${NOTICE_TARGET_LABEL}:`}</span>
          <bdi className="mono-identifier wrap-anywhere">{data.canonicalPath}</bdi>
        </p>
        {data.status === "withdrawn" ? <p className="type-supporting text-pretty">{NOTICE_TARGET_WITHDRAWN}</p> : null}
        {data.status === "shareable" && data.robots === "noindex" ? <p className="type-supporting text-pretty">{NOTICE_TARGET_UNLISTED}</p> : null}
      </div>
    );
  };
  return (
    <section data-slot="publish-notice" data-notice-edition={edition?.variantId ?? ""} className="flex min-w-0 flex-col gap-2">
      <Heading className={HEADING_SCALE[level]}>{NOTICE_HEADING}</Heading>
      <p className="type-supporting text-pretty">{NOTICE_INTRO}</p>
      {detail()}
      {edition === null ? null : <SimulationLabel effect={NOTICE_SIMULATION} />}
    </section>
  );
}
function ReleaseConfirmation({ selections, notifyCount, blockedReason, busy, onConfirm }: { readonly selections: readonly PublishEditionView[]; readonly notifyCount: number; readonly blockedReason: string | null; readonly busy: boolean; readonly onConfirm: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const confirm = (): void => {
    setOpen(false);
    onConfirm();
  };
  const notices = notifyCount === 0 ? " and submits no notice." : selections.length === 1 ? ", and submits one notice." : `, and submits ${String(notifyCount)} notices, one for each edition that asked for one.`;
  const editions = `${selections.length === 1 ? "This releases one edition" : `This releases ${String(selections.length)} editions`}${notices}`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button type="button" disabled={blockedReason !== null || busy} aria-describedby={blockedReason === null ? undefined : reasonId} />}>{RELEASE_CONFIRM_LABEL}</AlertDialogTrigger>
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
            <ul className="flex min-w-0 flex-col gap-1 type-body">
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
              <AlertDialogAction {...{ onClick: confirm, disabled: busy }}>{RELEASE_CONFIRM_LABEL}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <SimulationLabel effect={PUBLISH_SIMULATION} />
      </div>
      {blockedReason === null ? null : <p {...{ id: reasonId, className: "type-supporting text-pretty wrap-anywhere" }}>{blockedReason}</p>}
      {busy ? <output className="block type-supporting text-pretty wrap-anywhere">{WORKING_NOTE}</output> : null}
    </div>
  );
}
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
  const standingEdition = chosen[0] ?? null;
  const release = useRelease({ scope, variantId: standingEdition?.variantId ?? "" });
  const share = useSharePresentation({ scope, variantId: noticeEdition?.variantId ?? "" });
  const payload = useMemo<PublishVariantsPayload>(() => ({ documentId, variants: chosen.flatMap((edition) => (edition.candidate === null ? [] : [selectionOf(edition, edition.candidate)])) }), [documentId, chosen]);
  const selectionKey = selectionKeyOf(scope, documentId, selected);
  const refusal = useMemo(() => (payload.variants.length === 0 ? null : selectionRefusalOf(payload)), [payload]);
  const current = report !== null && report.selectionKey === selectionKey ? report : null;
  const releaseRead = release.result;
  const standingRelease = releaseRead !== undefined && releaseRead.kind === "envelope" && releaseRead.envelope.data.status === "released" ? releaseRead.envelope.data.release : undefined;
  const settled = current !== null && (current.outcome.outcome === "accepted" || current.outcome.outcome === "alreadyAccepted" || current.outcome.outcome === "unchanged");
  const reapplyRevision = reappliableRevision(current?.outcome ?? null);
  const submittedOf = useCallback(
    (): readonly SubmittedEdition[] => chosen.flatMap((edition) => (edition.candidate === null ? [] : [{ variantId: edition.variantId, audience: edition.audience, locale: edition.locale, revisionId: edition.candidate.revisionId, contentChecksum: edition.candidate.contentChecksum, mode: fixedModeOf(edition) }])),
    [chosen],
  );
  const attempt = useCallback(
    async (revision: string): Promise<void> => {
      if (inFlight.current) return;
      const submitted = submittedOf();
      if (submitted.length === 0) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const published = await publish.submit({ scope, expectedRevision: revision, payload });
        const notices: NoticeAttempt[] = [];
        if (published.outcome === "accepted" || published.outcome === "alreadyAccepted") {
          const releases = releasedIdsOf(published);
          for (const edition of chosen) {
            if (fixedModeOf(edition) !== NOTIFY_NOW_MODE) continue;
            const releaseId = releases.get(edition.variantId);
            if (releaseId === undefined) continue;
            const withheld = ceiling === undefined || ceiling.state !== "stated" ? NOTICE_CEILING_REASON : share.result === undefined ? NOTICE_NOT_READY_REASON : share.result.kind !== "envelope" ? NOTICE_UNREADABLE_REASON : null;
            if (withheld !== null) {
              notices.push({ variantId: edition.variantId, withheld });
              continue;
            }
            const noticePayload = { documentId, variantId: edition.variantId, releaseId, acknowledgedCeiling: ceiling !== undefined && ceiling.state === "stated" ? ceiling.eligible : 0 };
            if (!requestNotificationSchema.safeParse(noticePayload).success) {
              notices.push({ variantId: edition.variantId, withheld: NOTICE_REFUSED_REASON });
              continue;
            }
            notices.push(noticeAttemptOf(edition.variantId, await notify.submit({ scope, expectedRevision: published.revision, payload: noticePayload })));
          }
        }
        setReport({ selectionKey, outcome: published, submitted, notices });
        if (published.outcome === "accepted" || published.outcome === "alreadyAccepted") {
          release.refetch();
          router.refresh();
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [ceiling, chosen, documentId, notify, payload, publish, release, router, scope, selectionKey, share.result, submittedOf],
  );
  const confirmRelease = useCallback((): void => {
    void attempt(expectedRevision);
  }, [attempt, expectedRevision]);
  const reapply = useCallback((): void => {
    if (reapplyRevision !== null) void attempt(reapplyRevision);
  }, [attempt, reapplyRevision]);
  const checkResult = useCallback((): void => {
    release.refetch();
    share.refetch();
  }, [release, share]);
  const resultEditions = useMemo<readonly PublishedEdition[]>(() => {
    if (current === null) return [];
    const reported = reportedEditionsOf(current.outcome);
    return current.submitted.flatMap((submitted): readonly PublishedEdition[] => {
      const stated = reported.get(submitted.variantId);
      if (stated === undefined) return [];
      const state = publishStateOf(stated.state);
      const live = editions.find((edition) => edition.variantId === submitted.variantId);
      const fromRoute = live === undefined || live.headRelease === null ? undefined : releaseRecordOf(live.headRelease);
      const fromRead = standingRelease !== undefined && standingRelease.variantId === submitted.variantId && standingRelease.revisionId === submitted.revisionId ? standingRelease : undefined;
      // A release reads this surface's own answer first, because the route's envelope lags a moment behind it and can still name the head this attempt has just superseded; every other outcome reads the route's prior-good head first.
      const publication = state === "released" ? (fromRead ?? fromRoute) : (fromRoute ?? fromRead);
      const named = publication !== undefined && (state === "released" ? publication.revisionId === submitted.revisionId : true) ? publication : undefined;
      const notice = current.notices.find((entry) => entry.variantId === submitted.variantId);
      return [
        {
          variant: { variantId: submitted.variantId, documentId, audience: submitted.audience, locale: submitted.locale },
          state,
          ...(named === undefined ? {} : { release: named }),
          ...(stated.reasonCode === undefined ? {} : { reasonCode: stated.reasonCode }),
          ...(stated.reason === undefined ? {} : { reason: stated.reason }),
          ...(notice === undefined || "withheld" in notice ? {} : { notice: notice.notice }),
        },
      ];
    });
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
    if (current !== null) resultRef.current?.focus();
  }, [current]);
  const selectEdition = (variantId: string, on: boolean): void => setSelected((previous) => (on ? (previous.includes(variantId) ? previous : [...previous, variantId]) : previous.filter((entry) => entry !== variantId)));
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
            <Heading id={titleId} className={HEADING_SCALE[headingLevel]}>
              {REVIEW_TITLE}
            </Heading>
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
                    <EditionRow key={edition.variantId} edition={edition} index={index} selected={chosen.some((entry) => entry.variantId === edition.variantId)} disabled={pending} refusal={refusal} onSelectedChange={(next) => selectEdition(edition.variantId, next)} />
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
              <p className="type-supporting text-pretty">{SIBLING_PROMISE}</p>
              <p className="type-supporting text-pretty">{NOTHING_OUTSIDE}</p>
              {settled ? <p className="type-supporting text-pretty">{SETTLED_NOTE}</p> : <p className="type-supporting text-pretty">{REPLAY_NOTE}</p>}
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
                <li key={entry.variantId} className="type-body text-pretty wrap-anywhere">{`${WITHHELD_PREFIX} ${entry.reason}`}</li>
              ))}
            </ul>
          )}
          <p className="type-supporting text-pretty">{CHECK_READS}</p>
        </div>
      )}
    </section>
  );
}
export default PublishReview;
