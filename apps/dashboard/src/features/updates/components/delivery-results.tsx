"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import OperationResult from "@/components/operation-result";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import SimulationLabel from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, statusBadgeProps, VALUE_STATE_WORDS, type StatusBadgeSpec } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { SegmentedMeter } from "@/components/ui/segmented-meter";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import type { Coverage, ReadAction, Scope, ValueState } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { SIMULATED_EFFECT_BY_TRIGGER } from "../copy/updates-copy";
import { useRequestNotification } from "../hooks/use-update-mutations";
import { useSendResult, type SendResultData, type SendResultReadResult } from "../hooks/use-update-queries";
import NoticePresentation from "./notice-presentation";
type SendResultRow = SendResultData["rows"][number];
type SendOutcome = SendResultRow["state"];
type UnservedRecipient = SendResultData["unserved"][number];
type Usefulness = SendResultData["usefulness"];
type ValueStates = Readonly<Record<string, ValueState>>;
const SURFACE = {
  heading: "Send results",
  intro:
    "Per-recipient status for this email notification. Failed sends can be retried while the 24-hour window is open; Unknown outcomes should be refreshed rather than sent twice.",
  loadingTitle: "Loading send results…",
  loadingDescription: "Loading recipient outcomes for this notification.",
  unavailableTitle: "Couldn’t load send results",
  unavailableDescription: "Couldn’t reach the send service right now. Try again in a moment.",
  deniedTitle: "Send results aren’t available in this session",
  deniedDescription: "Your current session doesn’t have permission to view this notification’s send results.",
  refusedTitle: "Couldn’t load send results",
  noNoticeTitle: "No send selected",
  noNoticeDescription: "Open a published update and choose View send history to inspect results for a specific email send.",
  noNoticeAction: "Back to Updates",
  emptyTitle: "No recipient results recorded",
  emptyDescription: "No per-recipient outcomes were recorded for this notification. Any unserved eligible partners are listed above.",
  orderNote: "Shown in the exact order recorded by the service.",
  recipientHelp: "Recipients are shown by their opaque partner IDs.",
  pinnedHelp: "Each recipient’s email stays pinned to the exact edition published when the send began.",
  dedupeHelp: "Each notification produces at most one email per recipient using its unique send key (publisher, list, recipient, and notification ID).",
  noClockNote: "All timestamps and retry-window checks come from the server.",
} as const;
const SUMMARY = {
  title: "Notification details",
  description: "Summary of the published edition, audience counts, and retry window for this send.",
  noticeLabel: "Notification ID",
  releaseLabel: "Published edition",
  publisherLabel: "Publisher",
  purposeLabel: "List",
  intendedLabel: "Sent at",
  recordedLabel: "Recorded at",
  notRecorded: "Not recorded yet.",
  ceilingLabel: "Eligible audience ceiling",
  servedLabel: "Recipients with results",
  unservedLabel: "Eligible partners not emailed",
  asOfLabel: "Updated",
  coverageLabel: "Coverage",
  sourceLabel: "Source",
  revisionLabel: "Revision",
} as const;
const COLUMN = { recipient: "Recipient", pinned: "Pinned copy", outcome: "Status", dedupe: "Send key", recorded: "Recorded at", repeat: "Retry" } as const;
const PURPOSE_LABELS: Readonly<Record<SendResultData["purpose"], string>> = { "update-email": "Update emails" };
const OUTCOME_NARRATIVE: Readonly<Record<SendOutcome, string>> = {
  accepted: "Accepted — the simulated email step queued this message (doesn’t prove external delivery or opens).",
  failed: "Failed — the simulated email wasn’t queued. Can be retried once while the 24-hour window stays open.",
  unknown: "Unknown — confirmation was lost. Refresh results rather than resending to avoid duplicates.",
};
const OUTCOMES_BLOCK = { title: "What these statuses mean", description: "Statuses present in this send." } as const;
/** The message the notice carries, stated where its outcomes are read: a notice the records can no longer resolve is stated as absent rather than reconstructed. */ const NOTICE_BLOCK = {
  title: "Email message sent",
  description: "Exact sender, subject, link, and HTML/plain-text preview sent for this notification.",
  absent: "Message preview isn’t available because the underlying release couldn’t be loaded.",
} as const;
/** The one write this surface performs: repeating the copies of this notice that definitely failed, while the notice is still inside its usefulness window. */ const REPEAT = {
  label: "Retry failed sends",
  pendingLabel: "Retrying failed sends…",
  description: "Retries only the recipients whose send failed while the 24-hour window is open. Accepted and unknown rows are never resent.",
  targetsLead: "Failed recipients on this page:",
  openLabel: "View retry send results",
} as const;
const COUNTS = { title: "Results breakdown", intro: "Each status is counted separately and never combined." } as const;
const USEFULNESS_COPY = {
  title: "Retry window",
  stateLabel: "Status",
  deadlineLabel: "Closes at",
  remainingLabel: "Time remaining",
  statement: "Failed sends can be retried within 24 hours of the original send. Once closed, the window doesn’t reopen.",
} as const;
const USEFULNESS_STATE: Readonly<Record<Usefulness["state"], StatusBadgeSpec>> = { "within-usefulness": { label: "Retry window open", tone: "info" }, "past-usefulness": { label: "Retry window closed", tone: "muted" } };
const UNSERVED_BLOCK = {
  title: "Eligible partners not emailed",
  description: "Eligible partners who weren’t sent a copy in this notification and why.",
  alreadyCovered: "Already received a copy from an earlier notification for this update.",
  coveredByIntent: "Earlier notification",
  coveredByRendition: "Pinned copy",
} as const;
const UNSERVED_STATE: Readonly<Record<UnservedRecipient["reason"], StatusBadgeSpec>> = { "already-covered": { label: "Already emailed", tone: "muted" }, "no-eligible-rendition": { label: "No readable edition", tone: "caution" } };
const RENDITION_REFUSAL_NARRATIVE: Readonly<Record<Extract<UnservedRecipient, { readonly reason: "no-eligible-rendition" }>["renditionRefusal"], string>> = {
  "no-candidates": "No matching edition was available when this notification started.",
  "no-readable-edition": "No readable edition was available when this notification started.",
  "audience-not-admitted": "This recipient doesn’t have permission to view any edition in this notification.",
};
const DUPLICATE_BLOCK = {
  label: "Duplicate detected",
  title: "Multiple rows share one send key",
  description: "Each notification should produce at most one email per recipient. Both recorded rows are shown transparently so the duplicate isn’t hidden.",
} as const;
const RECOVERY = {
  title: "Refresh & retry",
  intro: "Refresh checks the latest server status without sending any emails.",
  checkLabel: "Refresh status",
  checkingLabel: "Refreshing…",
  checkDescription: "Re-reads the latest results for this notification.",
  noActionNote: "Status refresh isn’t available for this notification.",
  noRepeatNote: "Retrying failed sends isn’t available for this notification.",
  noRepeatOnThisPage: "No failed recipients appear on this page — check other pages to retry failed rows.",
  unavailableNoReason: "Not available right now.",
  repeatsLabel: "Retry failed sends",
} as const;
const HOUR_MS = 3_600_000;
const FIRST_PAGE = 1;
const PAGE_SIZES: readonly number[] = [50, 200];
const NO_SORT: RecordListQueryState["sort"] = [];
const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};
const ADDRESS = { intentId: "intentId", page: "page", pageSize: "pageSize" } as const;
const UPDATES_LIST = { label: SURFACE.noNoticeAction, href: "/communication" } as const;
/** Where this surface is composed, and the one builder of one notice's results address, so a receipt links to exactly the address this surface reads. */ const DELIVERY_PATH = "/communication/delivery";
export const deliveryPathOf = (intentId: string): string => `${DELIVERY_PATH}?${ADDRESS.intentId}=${encodeURIComponent(intentId)}`;
const stateOf = (valueStates: ValueStates, path: string): ValueState => valueStates[path] ?? "value";
const CountFigure = ({ count, valueState, locale }: { readonly count: number; readonly valueState: ValueState; readonly locale: string }): ReactElement => {
  const format = countFormatOf(locale);
  if (!Number.isFinite(count)) return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  if (valueState === "value") return <span className="tabular-figures">{format.format(count)}</span>;
  if (valueState === "zero") return <StatusBadge label={format.format(count)} valueState="zero" />;
  if (valueState !== "incomplete-subtotal") return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, valueState)} />;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="tabular-figures">{format.format(count)}</span>
      <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "incomplete-subtotal")} />
    </span>
  );
};
const formatSpan = (milliseconds: number, locale: string): string => {
  const hours = Math.trunc(milliseconds / HOUR_MS);
  const minutes = Math.trunc((milliseconds - hours * HOUR_MS) / 60_000);
  const format = countFormatOf(locale);
  return (hours > 0 ? [`${format.format(hours)} h`, `${format.format(minutes)} min`] : [`${format.format(minutes)} min`]).join(" ");
};
const InstantFigure = ({ instant }: { readonly instant: string }): ReactElement => (
  <bdi>
    <time {...{ className: "tabular-figures", dateTime: instant }}>{instant}</time>
  </bdi>
);
const ReferenceFigure = ({ reference }: { readonly reference: string }): ReactElement => <bdi className="mono-identifier whitespace-normal wrap-anywhere">{reference}</bdi>;
const coverageSentence = ({ from, to, state }: Coverage): string => {
  const span = from !== null && to !== null ? `records from ${from} to ${to}` : from !== null ? `records from ${from} onwards` : to !== null ? `records up to ${to}` : "records with no period stated";
  return state === "complete" ? `${span}, fully covered` : state === "partial" ? `${span}, partly covered` : `${span}, coverage not known`;
};
const actionOf = (actions: readonly ReadAction[], name: string): ReadAction | undefined => actions.find((action) => action.name === name);
type AddressWindow = { readonly intentId: string; readonly page: number; readonly pageSize: number };
const wholeNumberOf = (value: string | null): number | undefined => (value !== null && /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined);
const pageOf = (value: number | undefined): number => (value !== undefined && Number.isSafeInteger(value) && value >= FIRST_PAGE ? value : FIRST_PAGE);
const pageSizeOf = (value: number | undefined): number => (value !== undefined && PAGE_SIZES.some((size) => size === value) ? value : 50);
type DedupeIdentity = { readonly publisherId: string; readonly purpose: SendResultData["purpose"]; readonly recipientId: string; readonly intentId: string };
const REPEAT_LABELS = { permitted: "Repeat permitted", notPermitted: "Repeat not permitted" } as const;
const REPEAT_BLOCK = { title: "Why a repeat is or is not permitted", description: "Each sentence below is the service's own reason, stated once with the outcomes it governs rather than repeated beside every row.", missingReason: "The service states no reason for this recipient." } as const;
type RepeatReason = { readonly available: boolean; readonly reason: string; readonly outcomes: readonly SendOutcome[] };
const repeatReasonsOf = (rows: readonly SendResultRow[]): readonly RepeatReason[] => {
  const byReason = new Map<string, { readonly available: boolean; readonly reason: string; readonly outcomes: SendOutcome[] }>();
  for (const row of rows) {
    const reason = row.retry.reason.trim() || REPEAT_BLOCK.missingReason;
    const key = `${row.retry.available ? "permitted" : "not-permitted"}\u001f${reason}`;
    const held = byReason.get(key);
    if (held === undefined) byReason.set(key, { available: row.retry.available, reason, outcomes: [row.state] });
    else if (!held.outcomes.includes(row.state)) held.outcomes.push(row.state);
  }
  return [...byReason.values()];
};
function RepeatReasons({ reasons }: { readonly reasons: readonly RepeatReason[] }): ReactElement | null {
  if (reasons.length === 0) return null;
  return (
    <section aria-label={REPEAT_BLOCK.title} data-slot="delivery-repeat-reasons" className="flex min-w-0 flex-col gap-2">
      <h3 className="type-subsection-title text-pretty">{REPEAT_BLOCK.title}</h3>
      <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{REPEAT_BLOCK.description}</p>
      <ul className="flex min-w-0 flex-col gap-3">
        {reasons.map((entry) => (
          <li key={`${entry.available ? "permitted" : "not-permitted"}-${entry.reason}`} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <RepeatPermission available={entry.available} />
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {entry.outcomes.map((outcome) => (
                  <OutcomeFigure key={outcome} state={outcome} />
                ))}
              </span>
            </div>
            <p className="type-body text-pretty wrap-anywhere">{entry.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
const DedupePart = ({ slot, label, children }: { readonly slot: string; readonly label: string; readonly children: ReactNode }): ReactElement => (
  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <dt className="text-muted-foreground">{label}</dt>
    <dd {...{ "data-slot": slot, className: "min-w-0" }}>{children}</dd>
  </div>
);
const DedupeFigure = ({ identity }: { readonly identity: DedupeIdentity }): ReactElement => (
  <dl data-slot="delivery-dedupe-identity" className="flex min-w-0 flex-col gap-0.5 text-xs">
    <DedupePart slot="delivery-dedupe-publisher" label="Publisher">
      <ReferenceFigure reference={identity.publisherId} />
    </DedupePart>
    <DedupePart slot="delivery-dedupe-purpose" label="Purpose">
      <span>{PURPOSE_LABELS[identity.purpose]} </span>
      <ReferenceFigure reference={identity.purpose} />
    </DedupePart>
    <DedupePart slot="delivery-dedupe-recipient" label="Recipient">
      <ReferenceFigure reference={identity.recipientId} />
    </DedupePart>
    <DedupePart slot="delivery-dedupe-intent" label="Intent">
      <ReferenceFigure reference={identity.intentId} />
    </DedupePart>
  </dl>
);
const OutcomeFigure = ({ state }: { readonly state: SendOutcome }): ReactElement => <StatusBadge {...SEND_STATUS[state]} />;
const RepeatPermission = ({ available }: { readonly available: boolean }): ReactElement => <StatusBadge label={available ? REPEAT_LABELS.permitted : REPEAT_LABELS.notPermitted} tone={available ? "info" : "muted"} />;
const Fact = ({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement => (
  <div data-slot="delivery-fact" className="flex min-w-0 flex-col gap-0.5">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-sm text-pretty wrap-anywhere">{children}</dd>
  </div>
);
const RemainingFigure = ({ remaining, valueState, locale }: { readonly remaining: number | null; readonly valueState: ValueState; readonly locale: string }): ReactElement => {
  if (remaining !== null && valueState !== "unknown" && valueState !== "withheld" && valueState !== "unavailable") return <span className="tabular-figures">{formatSpan(remaining, locale)}</span>;
  return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, valueState === "withheld" || valueState === "unavailable" ? valueState : "unknown")} />;
};
const OUTCOME_ORDER: readonly SendOutcome[] = ["accepted", "failed", "unknown"];
const OutcomeCounts = ({ counts, valueStates, locale }: { readonly counts: SendResultData["counts"]; readonly valueStates: ValueStates; readonly locale: string }): ReactElement => {
  const segments = [
    { key: "accepted", label: SEND_STATUS.accepted.label, count: counts.accepted, tone: "info" as const },
    { key: "failed", label: SEND_STATUS.failed.label, count: counts.failed, tone: "destructive" as const },
    { key: "unknown", label: SEND_STATUS.unknown.label, count: counts.unknown, tone: "warning" as const },
  ];
  return (
    <div data-slot="delivery-counts" className="flex min-w-0 flex-col gap-2.5">
      <p className="text-sm font-medium text-pretty">{COUNTS.title}</p>
      <SegmentedMeter segments={segments} label="Recorded send outcomes distribution" />
      <dl className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
        {OUTCOME_ORDER.map((outcome) => (
          <div key={outcome} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border/80 bg-surface-subtle p-3">
            <dt>
              <StatusBadge {...SEND_STATUS[outcome]} />
            </dt>
            <dd className="min-w-0 text-base font-semibold">
              <CountFigure count={counts[outcome]} valueState={stateOf(valueStates, `counts.${outcome}`)} locale={locale} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{COUNTS.intro}</p>
    </div>
  );
};
const usefulnessRowsOf = (usefulness: Usefulness, valueStates: ValueStates, locale: string): readonly { readonly label: string; readonly figure: ReactNode }[] => [
  { label: USEFULNESS_COPY.stateLabel, figure: <StatusBadge {...USEFULNESS_STATE[usefulness.state]} /> },
  { label: USEFULNESS_COPY.deadlineLabel, figure: <InstantFigure instant={usefulness.deadline} /> },
  { label: USEFULNESS_COPY.remainingLabel, figure: <RemainingFigure remaining={usefulness.remainingMilliseconds} valueState={stateOf(valueStates, "usefulness.remainingMilliseconds")} locale={locale} /> },
];
const UsefulnessBlock = ({ usefulness, valueStates, locale }: { readonly usefulness: Usefulness; readonly valueStates: ValueStates; readonly locale: string }): ReactElement => (
  <div data-slot="delivery-usefulness" className="flex min-w-0 flex-col gap-2.5">
    <p className="text-sm font-medium text-pretty">{USEFULNESS_COPY.title}</p>
    <dl className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
      {usefulnessRowsOf(usefulness, valueStates, locale).map((row) => (
        <div key={row.label} className="rounded-xl border border-border/80 bg-surface-subtle p-3">
          <Fact label={row.label}>{row.figure}</Fact>
        </div>
      ))}
    </dl>
    {[USEFULNESS_COPY.statement, SURFACE.noClockNote].map((note) => (
      <p key={note} className="text-xs text-muted-foreground text-pretty wrap-anywhere">
        {note}
      </p>
    ))}
  </div>
);
const NamedReference = ({ name, reference }: { readonly name: string; readonly reference: string }): ReactElement => (
  <>
    <span>{name} </span>
    <ReferenceFigure reference={reference} />
  </>
);
/** The notice these outcomes belong to, as the message it carries: read through the one notice presentation the receiving surfaces share rather than through a second rendering here. */ function NoticeMessageBlock({ notice }: { readonly notice: SendResultData["notice"] }): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-slot="delivery-notice" data-notice-state={notice === null ? "absent" : "stated"} className="flex min-w-0 flex-col gap-2">
      <h3 {...{ id: headingId, className: "type-subsection-title text-pretty" }}>{NOTICE_BLOCK.title}</h3>
      {notice === null ? (
        <p className="type-supporting text-pretty wrap-anywhere">{NOTICE_BLOCK.absent}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{NOTICE_BLOCK.description}</p>
          <NoticePresentation notice={notice} />
        </>
      )}
    </section>
  );
}
function DeliverySummary({ envelope, locale }: { readonly envelope: Extract<SendResultReadResult, { readonly kind: "envelope" }>["envelope"]; readonly locale: string }): ReactElement {
  const { data, valueStates, coverage, asOf, source, revision } = envelope;
  const facts: ReadonlyArray<{ readonly label: string; readonly value: () => ReactNode }> = [
    {
      label: SUMMARY.noticeLabel,
      value: () => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <ReferenceFigure reference={data.intentId} />
          <CopyButton value={data.intentId} label="Copy notice identifier" />
        </span>
      ),
    },
    {
      label: SUMMARY.releaseLabel,
      value: () => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <ReferenceFigure reference={data.releaseId} />
          <CopyButton value={data.releaseId} label="Copy release identifier" />
        </span>
      ),
    },
    { label: SUMMARY.publisherLabel, value: () => <ReferenceFigure reference={data.publisherId} /> },
    { label: SUMMARY.purposeLabel, value: () => <NamedReference name={PURPOSE_LABELS[data.purpose]} reference={data.purpose} /> },
    { label: SUMMARY.intendedLabel, value: () => <InstantFigure instant={data.intendedAt} /> },
    { label: SUMMARY.recordedLabel, value: () => (data.recordedAt === null ? SUMMARY.notRecorded : <InstantFigure instant={data.recordedAt} />) },
    { label: SUMMARY.ceilingLabel, value: () => <CountFigure count={data.ceilingCount} valueState={stateOf(valueStates, "ceilingCount")} locale={locale} /> },
    { label: SUMMARY.servedLabel, value: () => <CountFigure count={data.page.total} valueState={stateOf(valueStates, "page.total")} locale={locale} /> },
    { label: SUMMARY.unservedLabel, value: () => <CountFigure count={data.unserved.length} valueState={stateOf(valueStates, "unserved")} locale={locale} /> },
    { label: SUMMARY.asOfLabel, value: () => <InstantFigure instant={asOf} /> },
    { label: SUMMARY.coverageLabel, value: () => coverageSentence(coverage) },
    { label: SUMMARY.sourceLabel, value: () => <NamedReference name={source.system} reference={source.reference} /> },
    { label: SUMMARY.revisionLabel, value: () => <ReferenceFigure reference={revision} /> },
  ];
  return (
    <Card data-slot="delivery-summary">
      <CardHeader>
        <CardTitle>{SUMMARY.title}</CardTitle>
        <CardDescription>{SUMMARY.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {facts.map((fact) => (
            <Fact key={fact.label} label={fact.label}>
              {fact.value()}
            </Fact>
          ))}
        </dl>
        <Separator />
        <OutcomeCounts counts={data.counts} valueStates={valueStates} locale={locale} />
        <Separator />
        <UsefulnessBlock usefulness={data.usefulness} valueStates={valueStates} locale={locale} />
        <Separator />
        <NoticeMessageBlock notice={data.notice} />
      </CardContent>
    </Card>
  );
}
const OutcomeNarratives = ({ outcomes }: { readonly outcomes: readonly SendOutcome[] }): ReactElement => (
  <section aria-label={OUTCOMES_BLOCK.title} data-slot="delivery-outcome-narratives" className="flex min-w-0 flex-col gap-2">
    <h3 className="type-subsection-title text-pretty">{OUTCOMES_BLOCK.title}</h3>
    <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{OUTCOMES_BLOCK.description}</p>
    <ul className="flex min-w-0 flex-col gap-3">
      {outcomes.map((outcome) => (
        <li key={outcome} className="flex min-w-0 flex-col gap-1">
          <StatusBadge {...SEND_STATUS[outcome]} />
          <p className="type-body text-pretty wrap-anywhere">{OUTCOME_NARRATIVE[outcome]}</p>
        </li>
      ))}
    </ul>
  </section>
);
const UnservedCard = ({ entries }: { readonly entries: readonly UnservedRecipient[] }): ReactElement => (
  <Card data-slot="delivery-unserved">
    <CardHeader>
      <CardTitle>{UNSERVED_BLOCK.title}</CardTitle>
      <CardDescription>{UNSERVED_BLOCK.description}</CardDescription>
    </CardHeader>
    <CardContent>
      <ul className="flex min-w-0 flex-col gap-3">
        {entries.map((entry) => (
          <li key={entry.recipientId} className="flex min-w-0 flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
            <StatusBadge {...statusBadgeProps(UNSERVED_STATE, entry.reason)} />
            <p className="type-body text-pretty wrap-anywhere">
              <span className="text-muted-foreground">Recipient </span>
              <ReferenceFigure reference={entry.recipientId} />
            </p>
            {entry.reason === "already-covered" ? (
              <p className="type-supporting text-pretty wrap-anywhere">
                {UNSERVED_BLOCK.alreadyCovered} <span className="text-foreground">{UNSERVED_BLOCK.coveredByIntent} </span>
                <ReferenceFigure reference={entry.coveredByIntentId} /> <span className="text-foreground">{UNSERVED_BLOCK.coveredByRendition} </span>
                <ReferenceFigure reference={entry.coveredByRenditionId} />
              </p>
            ) : (
              <p className="type-supporting text-pretty wrap-anywhere">{RENDITION_REFUSAL_NARRATIVE[entry.renditionRefusal]}</p>
            )}
          </li>
        ))}
      </ul>
    </CardContent>
  </Card>
);
const DuplicateCard = ({ rows }: { readonly rows: readonly SendResultRow[] }): ReactElement => (
  <Card data-slot="delivery-duplicates">
    <CardHeader>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge label={DUPLICATE_BLOCK.label} tone="danger" />
      </div>
      <CardTitle>{DUPLICATE_BLOCK.title}</CardTitle>
      <CardDescription>{DUPLICATE_BLOCK.description}</CardDescription>
    </CardHeader>
    <CardContent>
      <ul className="flex min-w-0 flex-col gap-3">
        {rows.map((row, index) => (
          <li key={`${row.dedupeKey}-${String(index)}`} className="flex min-w-0 flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-body">
              <span className="text-muted-foreground">Recipient </span>
              <ReferenceFigure reference={row.recipientId} />
              <OutcomeFigure state={row.state} />
            </p>
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
              <span>Recorded dedupe identity </span>
              <ReferenceFigure reference={row.dedupeKey} />
            </p>
          </li>
        ))}
      </ul>
    </CardContent>
  </Card>
);
/** The repeat this surface can perform: the copies the read marks repeatable, the service's answer to the repeat, and the notice the repeat recorded when it was accepted. `allowed` is false at and past the usefulness boundary, where the read states its own reason and no control is offered at all. */
type RepeatState = {
  /** The rows of this page the read itself marks repeatable: every one of them is a definite failure inside the window. */ readonly targets: readonly SendResultRow[];
  readonly allowed: boolean;
  /** The read's own reason for withholding the repeat, rendered exactly as the service stated it. */ readonly withheldReason: string;
  readonly pending: boolean;
  readonly outcome: MutationOutcome | null;
  /** The notice a repeat recorded, when the service accepted one: a repeat is a notice of its own, never a rewrite. */ readonly repeatedIntentId: string | null;
  readonly onRepeat: () => void;
};
/** The heading level the receipt nests beneath the surface that composes it, so an outcome is never announced out of order. */ const receiptLevelOf = (headingLevel: DeliveryHeadingLevel): 3 | 4 => (headingLevel === 3 ? 4 : 3);
/** The notice a repeat recorded, when the service accepted one: the first identifier that acceptance created is that notice's own. */ const repeatedIntentOf = (outcome: MutationOutcome | null): string | null => {
  if (outcome === null || (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted")) return null;
  const [created] = outcome.created ?? [];
  return created === undefined || created.trim() === "" ? null : created;
};
function RecoveryCard({ actions, isFetching, onCheck, repeat, headingLevel }: { readonly actions: readonly ReadAction[]; readonly isFetching: boolean; readonly onCheck: () => void; readonly repeat: RepeatState; readonly headingLevel: DeliveryHeadingLevel }): ReactElement {
  const hintId = useId();
  const repeatHintId = useId();
  const recovery = actionOf(actions, "recoverByIntent");
  return (
    <Card data-slot="delivery-recovery">
      <CardHeader>
        <CardTitle>{RECOVERY.title}</CardTitle>
        <CardDescription>{RECOVERY.intro}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {recovery !== undefined && recovery.available ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div>
              <Button {...{ type: "button", variant: "outline", size: "sm", disabled: isFetching, "aria-describedby": hintId, onClick: onCheck }}>{isFetching ? RECOVERY.checkingLabel : RECOVERY.checkLabel}</Button>
            </div>
            <p {...{ id: hintId, className: "text-xs text-muted-foreground text-pretty wrap-anywhere" }}>{RECOVERY.checkDescription}</p>
          </div>
        ) : (
          <p className="type-supporting text-pretty wrap-anywhere">{actionReasonOf(recovery, RECOVERY.noActionNote)}</p>
        )}
        <Separator />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-pretty">{RECOVERY.repeatsLabel}</p>
          {repeat.allowed ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <div>
                <Button {...{ type: "button", variant: "outline", size: "sm", disabled: repeat.pending, "aria-describedby": repeatHintId, onClick: repeat.onRepeat }}>{repeat.pending ? REPEAT.pendingLabel : REPEAT.label}</Button>
              </div>
              <p {...{ id: repeatHintId, className: "text-xs text-muted-foreground text-pretty wrap-anywhere" }}>{REPEAT.description}</p>
              {repeat.targets.length === 0 ? null : (
                <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
                  {REPEAT.targetsLead}{" "}
                  {repeat.targets.map((row) => (
                    <span key={row.recipientId} className="me-1.5 inline-block">
                      <ReferenceFigure reference={row.recipientId} />
                    </span>
                  ))}
                </p>
              )}
            </div>
          ) : (
            <p className="type-supporting text-pretty wrap-anywhere">{repeat.withheldReason}</p>
          )}
          {repeat.outcome === null ? null : (
            <div data-slot="delivery-repeat-result" className="flex min-w-0 flex-col gap-2">
              <OperationResult outcome={repeat.outcome} headingLevel={receiptLevelOf(headingLevel)} />
              {repeat.repeatedIntentId === null ? null : <Link {...{ className: "type-body inline-link", href: deliveryPathOf(repeat.repeatedIntentId) }}>{REPEAT.openLabel}</Link>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
const actionReasonOf = (action: ReadAction | undefined, absentNote: string): string => {
  const reason = (action?.reason ?? "").trim();
  return action === undefined ? absentNote : reason.length === 0 ? RECOVERY.unavailableNoReason : reason;
};
type DedupeBase = { readonly publisherId: string; readonly purpose: SendResultData["purpose"]; readonly intentId: string };
const refusalSummaryOf = (fields: Readonly<Record<string, readonly string[]>>): string => {
  const messages = Object.values(fields)
    .flat()
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
  return messages.length === 0 ? "The read's own request was refused and named no field to correct, so nothing was read and nothing is shown in its place." : messages.join(" ");
};
const identityBaseOf = (result: SendResultReadResult | undefined): DedupeBase | undefined => {
  if (result === undefined || result.kind !== "envelope") return undefined;
  const { publisherId, purpose, intentId } = result.envelope.data;
  return { publisherId, purpose, intentId };
};
const identityOfRow = (base: DedupeBase | undefined, row: SendResultRow): DedupeIdentity => ({ publisherId: base?.publisherId ?? "", purpose: base?.purpose ?? "update-email", recipientId: row.recipientId, intentId: base?.intentId ?? "" });
const duplicateRowsOf = (rows: readonly SendResultRow[]): readonly SendResultRow[] => {
  const occurrences = new Map<string, number>();
  for (const row of rows) occurrences.set(row.dedupeKey, (occurrences.get(row.dedupeKey) ?? 0) + 1);
  return rows.filter((row) => (occurrences.get(row.dedupeKey) ?? 0) > 1);
};
type RowField = { readonly id: string; readonly label: string; readonly fixed?: true; readonly render: (row: SendResultRow, identity: DedupeIdentity) => ReactNode };
const ROW_FIELDS: readonly RowField[] = [
  { id: "recipient", label: COLUMN.recipient, fixed: true, render: (row) => <ReferenceFigure reference={row.recipientId} /> },
  { id: "pinned", label: COLUMN.pinned, render: (row) => <ReferenceFigure reference={row.renditionId} /> },
  { id: "outcome", label: COLUMN.outcome, fixed: true, render: (row) => <OutcomeFigure state={row.state} /> },
  { id: "recorded", label: COLUMN.recorded, render: (row) => <InstantFigure instant={row.recordedAt} /> },
  { id: "repeat", label: COLUMN.repeat, render: (row) => <RepeatPermission available={row.retry.available} /> },
  { id: "dedupe", label: COLUMN.dedupe, render: (_row, identity) => <DedupeFigure identity={identity} /> },
];
const deliveryColumns = (base: DedupeBase | undefined): ReadonlyArray<RecordListColumnDef<SendResultRow>> =>
  ROW_FIELDS.map((field) => ({ id: field.id, header: field.label, enableSorting: false, ...(field.fixed === true ? { enableHiding: false } : {}), cell: ({ row }) => field.render(row.original, identityOfRow(base, row.original)) }));
export type DeliveryHeadingLevel = 1 | 2 | 3;
const HEADING_TAG: Readonly<Record<DeliveryHeadingLevel, "h1" | "h2" | "h3">> = { 1: "h1", 2: "h2", 3: "h3" };
/** The one type scale's heading utility for each level, so this surface's heading takes the measure of the level the composing page gives it rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<DeliveryHeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title" };
export type DeliveryResultsProps = {
  /** The exact authority this read runs under; the service re-derives scope from it on every request. */ readonly scope: Scope;
  /** The interface locale this surface formats its counts in, stated by the route that composes it. */ readonly locale: string;
  /** The notice whose results to report. Absent, the address's own `intentId` is read, so a link into this screen can name the notice it reports on. */ readonly intentId?: string;
  /** The answer a Server Component already read, so the surface paints from that authority instead of asking the same question again. */ readonly initialData?: SendResultReadResult;
  /** When that answer was produced, so the cache treats the seed as the age it is rather than as brand new. */ readonly initialDataUpdatedAt?: number;
  /** The page window a composing page controls; absent, the window is read from the address and written back to it. */ readonly queryState?: RecordListQueryState;
  /** Receives every window or column change as well, for a caller that keeps its own copy of the state. */ readonly onQueryStateChange?: (next: RecordListQueryState) => void;
  /** The heading level this surface takes from the page that composes it. */ readonly headingLevel?: DeliveryHeadingLevel;
  readonly className?: string;
};
export default function DeliveryResults({ scope, locale, intentId: statedIntentId, initialData, initialDataUpdatedAt, queryState: controlledState, onQueryStateChange, headingLevel = 2, className }: DeliveryResultsProps): ReactElement {
  const headingId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const address = useMemo<AddressWindow>(() => ((search: ReadonlyURLSearchParams): AddressWindow => ({ intentId: (search.get(ADDRESS.intentId) ?? "").trim(), page: pageOf(wholeNumberOf(search.get(ADDRESS.page))), pageSize: pageSizeOf(wholeNumberOf(search.get(ADDRESS.pageSize))) }))(searchParams), [searchParams]);
  const intentId = (statedIntentId ?? address.intentId).trim();
  const page = controlledState === undefined ? address.page : controlledState.page;
  const pageSize = controlledState === undefined ? address.pageSize : controlledState.pageSize;
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(controlledState === undefined ? NO_COLUMNS_HIDDEN : controlledState.columnVisibility);
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: NO_SORT, page, pageSize, columnVisibility }), [page, pageSize, columnVisibility]);
  const [repeatedFor, setRepeatedFor] = useState<string | null>(null); // The notice a repeat was submitted for, so a receipt is only ever shown beside the notice it belongs to.
  const read = useSendResult({ scope, intentId, page, pageSize }, { initialData, initialDataUpdatedAt });
  const notify = useRequestNotification(); // The one write this surface performs, through the family's own reviewed-mutation hook: the attempt identity, the in-flight fence and the replay of one intent belong to that step, so nothing here mints an identity or resends.
  const Heading = HEADING_TAG[headingLevel];
  const result = read.result;
  const stale = result !== undefined && read.isStale(result);
  const pageCount = result !== undefined && !stale && result.kind === "envelope" ? result.envelope.data.page.pageCount : 0;
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<SendResultRow>>>(() => deliveryColumns(identityBaseOf(result)), [result]);
  const writeWindow = useCallback(
    (next: { readonly page: number; readonly pageSize: number }): void => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(ADDRESS.page, String(next.page));
      params.set(ADDRESS.pageSize, String(next.pageSize));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const commitQuery = useCallback(
    (next: RecordListQueryState): void => {
      if (next.columnVisibility !== columnVisibility) setColumnVisibility(next.columnVisibility);
      if (next.page !== page || next.pageSize !== pageSize) writeWindow({ page: next.page, pageSize: next.pageSize });
      onQueryStateChange?.(next);
    },
    [columnVisibility, onQueryStateChange, page, pageSize, writeWindow],
  );
  useEffect(() => {
    if (controlledState !== undefined || pageCount === 0 || page <= pageCount) return;
    writeWindow({ page: pageCount, pageSize });
  }, [controlledState, pageCount, page, pageSize, writeWindow]);
  const checkResult = (): void => read.refetch();
  const frame = (children: ReactNode): ReactElement => (
    <section aria-labelledby={headingId} data-slot="delivery-results" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading {...{ id: headingId, className: cn(HEADING_SCALE[headingLevel], "text-pretty wrap-anywhere") }}>{SURFACE.heading}</Heading>
        <p className="max-w-prose type-supporting text-pretty wrap-anywhere">{SURFACE.intro}</p>
      </div>
      {/* The one simulated-effect disclosure for this surface, stated where the mail-submission boundary is crossed rather than once per row. */}
      <SimulationLabel effect={SIMULATED_EFFECT_BY_TRIGGER.notify} context="block" />
      {children}
    </section>
  );
  const retry = { label: "Try again", onClick: checkResult };
  if (intentId === "") return frame(<StateNotice kind="empty" title={SURFACE.noNoticeTitle} description={SURFACE.noNoticeDescription} action={UPDATES_LIST} headingLevel={headingLevel} />);
  if (read.isPending || stale) return frame(<StateNotice kind="loading" title={SURFACE.loadingTitle} description={SURFACE.loadingDescription} headingLevel={headingLevel} loadingLines={7} />);
  if (result === undefined) return frame(<StateNotice kind="unavailable" title={SURFACE.unavailableTitle} description={SURFACE.unavailableDescription} retry={retry} headingLevel={headingLevel} />);
  if (result.kind === "denied") return frame(<StateNotice kind="denied" title={SURFACE.deniedTitle} description={SURFACE.deniedDescription} reasonCode={result.denied.reasonCode} headingLevel={headingLevel} />);
  if (result.kind === "unavailable") return frame(<StateNotice kind="unavailable" title={SURFACE.unavailableTitle} description={result.unavailable.guidance} source={result.unavailable.source} retry={retry} headingLevel={headingLevel} />);
  if (result.kind === "refused") return frame(<StateNotice kind="refused" title={SURFACE.refusedTitle} description={refusalSummaryOf(result.refused.fields)} headingLevel={headingLevel} />);
  const envelope = result.envelope;
  const data = envelope.data;
  if (data.intentId !== intentId) return frame(<StateNotice kind="loading" title={SURFACE.loadingTitle} description={SURFACE.loadingDescription} headingLevel={headingLevel} loadingLines={7} />);
  const rows = data.rows;
  const duplicates = duplicateRowsOf(rows);
  const repeatTargets = rows.filter((row) => row.retry.available); // The rows this page's read marks repeatable, each of them a definite failure inside the usefulness window: an accepted copy and one whose outcome is unknown are never among them, so neither can ever receive a control.
  const repeatAction = actionOf(envelope.actions, "retryRecipient");
  const repeatState: RepeatState = {
    targets: repeatTargets,
    allowed: data.usefulness.state === "within-usefulness" && repeatAction !== undefined && repeatAction.available && repeatTargets.length > 0, // A repeat is offered only while the read says the notice is inside its usefulness window and still names a row that may be repeated.
    // Three different facts stay three: why the read withholds the action, that this page holds none of the failed copies, and that the read offers no such action at all.
    withheldReason: repeatAction !== undefined && repeatAction.available && repeatTargets.length === 0 ? RECOVERY.noRepeatOnThisPage : actionReasonOf(repeatAction, RECOVERY.noRepeatNote),
    pending: notify.pending,
    outcome: repeatedFor === data.intentId ? notify.outcome : null,
    repeatedIntentId: repeatedFor === data.intentId ? repeatedIntentOf(notify.outcome) : null,
    onRepeat: () => {
      setRepeatedFor(data.intentId); // The service's own facts, stated as this read supplied them: the notice being repeated, the edition it was recorded for, the instant it was meant for and the ceiling it was accepted for. No recipient is named, so which copies are submitted again is the service's answer alone.
      void notify.submit({ scope: envelope.scope, expectedRevision: envelope.revision, payload: { documentId: data.documentId, variantId: data.variantId, releaseId: data.releaseId, acknowledgedCeiling: data.ceilingCount, intendedAt: data.intendedAt, repeatOfIntentId: data.intentId } });
    },
  };
  const outcomes = OUTCOME_ORDER.filter((outcome) => data.counts[outcome] > 0 || rows.some((row) => row.state === outcome));
  const tableLabel = `${SURFACE.heading}: recorded outcomes for notice ${data.intentId}`;
  const rowsBlock =
    rows.length === 0 ? (
      data.page.total > 0 ? (
        <StateNotice kind="loading" title={SURFACE.loadingTitle} description={SURFACE.loadingDescription} headingLevel={headingLevel} loadingLines={6} />
      ) : (
        <StateNotice kind="empty" title={SURFACE.emptyTitle} description={SURFACE.emptyDescription} headingLevel={headingLevel} />
      )
    ) : (
      <>
        {/* One composition of this answer at every width: the shared record list, whose own labelled, focusable scroll region carries the table on a narrow screen, so a reader meets each recipient's row exactly once instead of through a second rendering beside it (WCAG 1.3.1, 1.4.10). Only that region may scroll
         * sideways; the page itself never does. */}
        <RecordList label={tableLabel} columns={columns} rows={rows} rowCount={data.page.total} queryState={listQueryState} onQueryStateChange={commitQuery} getRowId={(row) => row.recipientId} initialPinnedColumns={{ start: ["recipient"] }} itemNoun="recipients" pageSizeOptions={PAGE_SIZES} locale={locale} />
        <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          <p className="text-pretty wrap-anywhere">{SURFACE.recipientHelp}</p>
          <p className="text-pretty wrap-anywhere">{SURFACE.pinnedHelp}</p>
          <p className="text-pretty wrap-anywhere">{SURFACE.dedupeHelp}</p>
          <p className="text-pretty wrap-anywhere">{SURFACE.orderNote}</p>
        </div>
      </>
    );
  return frame(
    <>
      <DeliverySummary envelope={envelope} locale={locale} />
      {outcomes.length === 0 ? null : <OutcomeNarratives outcomes={outcomes} />}
      {duplicates.length === 0 ? null : <DuplicateCard rows={duplicates} />}
      {data.unserved.length === 0 ? null : <UnservedCard entries={data.unserved} />}
      {rowsBlock}
      <RepeatReasons reasons={repeatReasonsOf(rows)} />
      <RecoveryCard actions={envelope.actions} isFetching={read.isFetching} onCheck={checkResult} repeat={repeatState} headingLevel={headingLevel} />
    </>,
  );
}
