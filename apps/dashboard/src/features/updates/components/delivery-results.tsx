"use client";
/**
 * The delivery results of one submitted notice: what this application recorded for each recipient, kept as
 * three outcomes that never merge.
 *
 * **What this surface is.** It reports submission acceptance, a definite failure and an unknown outcome for
 * the one notice it was asked about, and it states the copy each recipient was pinned to. It publishes
 * nothing, submits no notice, manages no recipients and offers no submit control: a notification request
 * belongs to the surface that submitted the notice, and repeating one from a results page would be the
 * resend this feature exists to prevent. Acceptance is neither delivery nor reading; a definite failure may
 * be repeated only inside its usefulness window and under the same dedupe identity; an unknown outcome is
 * recovered by reading the same intent again, never by sending anything under a fresh key.
 *
 * **What it never computes.** Every count, the eligible ceiling, the page window, the usefulness deadline,
 * the remaining time and the resolved instant are the service's own values, rendered as it supplied them and
 * read through their value states. No clock is read here and no deadline is compared here, so this screen
 * cannot disagree with the record it is showing.
 *
 * **Why there is no filter or search bar.** The read this surface drives admits exactly three parameters —
 * the intent, the page and the page size — and its transport refuses every other name rather than ignoring
 * it. A search field would therefore either be refused by the read or narrow only the page already loaded,
 * which would claim a narrowing that did not happen and leave the count above the table describing a
 * different result from the rows below it. The whole result is therefore paged, never filtered.
 */
import { usePathname, useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { PaginationBar } from "@/components/pagination-bar";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import SimulationLabel from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, statusBadgeProps, VALUE_STATE_WORDS, type StatusBadgeSpec } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { Coverage, ReadAction, Scope, ValueState } from "@/modules/data-service/envelope";
import { SIMULATED_EFFECT_BY_TRIGGER } from "../copy/updates-copy";
import { useSendResult, type SendResultData, type SendResultReadResult } from "../hooks/use-update-queries";

// ---------------------------------------------------------------------------------------------
// The contract: the read's own shapes, narrowed to the members this surface renders
// ---------------------------------------------------------------------------------------------

/** One recipient's recorded outcome, taken from the read so a renamed or withdrawn member reaches this surface as a compile error rather than drifting into a second contract. */
type SendResultRow = SendResultData["rows"][number];

/** The three outcomes a recorded row may state. This surface adds no fourth: there is no pending, no delivered and no read. */
type SendOutcome = SendResultRow["state"];

/** One eligible recipient the notice did not serve, with the reason the service recorded. */
type UnservedRecipient = SendResultData["unserved"][number];

/** Why no copy could be pinned for an eligible recipient. */
type RenditionRefusal = Extract<UnservedRecipient, { readonly reason: "no-eligible-rendition" }>["renditionRefusal"];

/** The usefulness window as the read resolved it, including the instant it closes. */
type Usefulness = SendResultData["usefulness"];

/** The value state of every field the read answered, keyed by field path. */
type ValueStates = Readonly<Record<string, ValueState>>;

/** The envelope this surface renders once it has one. */
type DeliveryEnvelope = Extract<SendResultReadResult, { readonly kind: "envelope" }>["envelope"];

// ---------------------------------------------------------------------------------------------
// Wording: what this surface states, in the specification's terms
// ---------------------------------------------------------------------------------------------

const SURFACE = {
  heading: "Delivery results",
  intro:
    "One row per recipient of one submitted notice: the copy that was pinned for them, the outcome this " +
    "application recorded, and whether a repeat is still permitted. Acceptance is not delivery and not " +
    "reading, no figure here is added to another, and an unknown outcome is recovered by reading this same " +
    "notice again rather than by sending anything a second time.",
  loadingTitle: "Delivery results",
  loadingDescription: "The recorded outcomes for this notice are being read. No count, no empty row and no zero stands in for " + "them while the read runs.",
  unavailableTitle: "The recorded outcomes could not be read",
  unavailableDescription: "This screen states no acceptance, no failure and no unknown outcome for anyone until the read succeeds: " + "an outage is not a notice that failed and not one that was accepted.",
  deniedTitle: "This notice's results are not available in this session",
  deniedDescription: "The answer is the same whether or not this notice exists, so nothing here reveals what it cannot show.",
  refusedTitle: "This screen's request was refused",
  noNoticeTitle: "No submitted notice is named",
  noNoticeDescription: "This screen reports the delivery results of one notice that was already submitted, so it needs that " + "notice's own identity. Nothing is shown and nothing is counted until one is named, because a screen that " + "guessed would report whichever notice was submitted last.",
  noNoticeAction: "Open the Updates list",
  emptyTitle: "No recipient outcome was recorded for this notice",
  emptyDescription: "Nothing here states that the notice reached anyone: the service recorded no per-recipient outcome for " + "this intent. The eligible recipients it did not serve are listed above, and no outcome is inferred for " + "them.",
  orderNote: "The service states this order and this read takes no ordering parameter, so the table offers no sort " + "that would change nothing.",
  recipientHelp: "A recipient is an opaque reference recorded for this notice. It is not a name, not an address and not a " + "link, and two references describe the same person only when they are the same reference.",
  pinnedHelp:
    "Each recipient's copy was pinned to one rendition when the notice was submitted, so a later change of " +
    "audience, language or restriction cannot substitute a different copy for the one recorded here. A row " +
    "states that copy's identity: the audience and the language belong to the edition this notice was " +
    "submitted for, not to the row, and neither is inferred from a rendition identifier.",
  dedupeHelp:
    "A dedupe identity is four values taken together: the publisher, the purpose, the recipient and the " +
    "intent. One intent yields at most one message per recipient, so a repeat of the same work is recognised " +
    "as the same message rather than becoming a second one. The publisher, the purpose and the intent are the " +
    "same on every row and all four are stated on each row anyway, because a duplicate is the one thing that " +
    "identity exists to make visible.",
  noClockNote: "Every instant here is the one the service resolved when it answered, stated exactly as supplied. This " + "screen reads no clock of its own and compares no deadline, so whether a repeat is still permitted is the " + "service's answer and never a browser's.",
} as const;

const SUMMARY = {
  title: "The notice these outcomes belong to",
  description: "The intent, the edition it was submitted for and the period the figures cover, exactly as the read resolved them.",
  noticeLabel: "Notice",
  releaseLabel: "Edition submitted for",
  publisherLabel: "Publisher",
  purposeLabel: "Purpose",
  intendedLabel: "Meant for",
  recordedLabel: "Result recorded at",
  notRecorded: "No result has been recorded for this notice yet.",
  ceilingLabel: "Eligible recipients the notice could not exceed",
  servedLabel: "Recipients with a recorded outcome",
  unservedLabel: "Eligible recipients not served",
  asOfLabel: "As of",
  coverageLabel: "Coverage",
  sourceLabel: "Source",
  revisionLabel: "Revision",
} as const;

const COLUMN = { recipient: "Recipient", pinned: "Pinned copy", outcome: "Outcome", dedupe: "Dedupe identity", recorded: "Recorded at", repeat: "Repeat" } as const;

/** The one display name for the only purpose a membership can carry, typed against the read so a second purpose cannot pass unlabelled. */
const PURPOSE_LABELS: Readonly<Record<SendResultData["purpose"], string>> = { "update-email": "Update email" };

/** What each of the three outcomes means, stated once per surface for the outcomes this page actually holds. */
const OUTCOME_NARRATIVE: Readonly<Record<SendOutcome, string>> = {
  accepted: "Accepted means this application's simulated submission step took this copy for this recipient. It is not " + "delivery and it is not reading: nothing here states that a message arrived, that anyone received it or " + "that anyone opened it, and no accepted row may be presented as any of those.",
  failed: "Failed is a definite failure for this recipient: the simulated submission step reports that it did not " + "take the copy, so nothing was submitted under this intent for them. A repeat is permitted under the same " + "identity only while the usefulness window is open.",
  unknown: "An unknown outcome means this application does not know whether the effect was applied for this " + "recipient: the acknowledgement was lost. It is neither a success nor a failure, and no second attempt " + "starts from here — the result is recovered by reading this same notice again.",
};

const OUTCOMES_BLOCK = { title: "What the outcomes on this page mean", description: "Only the outcomes this page holds are described, and each is described with what it does not mean." } as const;

const COUNTS = { title: "Outcomes recorded for this notice", intro: "Each of the three outcomes is counted on its own, from that outcome's own value state. They are never " + "added together: one number across three different outcomes would state something none of them means." } as const;

const USEFULNESS_COPY = {
  title: "The usefulness window",
  stateLabel: "Window at this read",
  deadlineLabel: "Closes at",
  remainingLabel: "Remaining when this read ran",
  statement: "A definite failure may be repeated only while this window is open, under the same dedupe identity. The " + "window runs 24 elapsed hours from the instant the notice was meant for and is strict at equality: at " + "exactly that instant it is closed, and nothing on this screen reopens it or extends it.",
} as const;

/** The two states the read states for the window, each in its own words and never derived here. */
const USEFULNESS_STATE: Readonly<Record<Usefulness["state"], StatusBadgeSpec>> = { "within-usefulness": { label: "Within its usefulness window", tone: "info" }, "past-usefulness": { label: "Past its usefulness window", tone: "muted" } };

const UNSERVED_BLOCK = {
  title: "Eligible recipients this notice did not serve",
  description: "These recipients were eligible for the notice and received no copy. Each is listed with the reason the " + "service recorded, and none of them is counted as an outcome above.",
  alreadyCovered: "An earlier notice already pinned a copy for this recipient, so this intent did not make a second one.",
  coveredByIntent: "Earlier notice",
  coveredByRendition: "Copy already pinned",
} as const;

/** The two reasons an eligible recipient was not served, each under the service's own word. */
const UNSERVED_STATE: Readonly<Record<UnservedRecipient["reason"], StatusBadgeSpec>> = { "already-covered": { label: "Already had a copy from an earlier notice", tone: "muted" }, "no-eligible-rendition": { label: "No copy they may read", tone: "caution" } };

/** What each refusal means: why no copy could be pinned for a recipient who was eligible. */
const RENDITION_REFUSAL_NARRATIVE: Readonly<Record<RenditionRefusal, string>> = {
  "no-candidates": "No edition of this notice could be pinned for this recipient when the notice was submitted, so no copy was fixed for them.",
  "no-readable-edition": "Every edition that could have served this recipient was unreadable when the notice was submitted, so no copy was fixed for them.",
  "audience-not-admitted": "This recipient is not admitted to the audience of any edition of this notice, so no copy they may read could be fixed for them.",
};

const DUPLICATE_BLOCK = {
  label: "The recorded results disagree",
  title: "Two recorded rows share one dedupe identity",
  description:
    "One intent yields at most one message per recipient, so this is a defect in the recorded results rather " + "than a second copy. The rows are listed exactly as recorded and are never added together or reduced to " + "one: a screen that quietly merged them would hide the defect the identity exists to expose.",
} as const;

const RECOVERY = {
  title: "Checking the result",
  intro: "Checking the result reads this same notice again, under the same identity. A read performs no effect, " + "so checking can reveal an outcome that was recorded and can never repeat a submission.",
  checkLabel: "Check the result",
  checkingLabel: "Checking the result…",
  checkDescription: "Reading this notice again, under the identity it already has.",
  repeatAvailable:
    "The service reports that at least one recorded recipient may be submitted again under this same identity " + "while the usefulness window is open. That repeat is made from the screen that submitted the notice: this " + "screen states that the read permits it and offers no control that would submit anything.",
  noActionNote: "The service offers no recovery action for this notice, so none is presented here.",
  noRepeatNote: "The service offers no repeat action for this notice, so none is presented here.",
  unavailableNoReason: "The service reports this action as unavailable and stated no reason for it, so none is written here.",
  repeatsLabel: "A repeat under the same identity",
} as const;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const MINUTE_MS = 60_000;

const HOUR_MS = 3_600_000;

/** The page the read counts from: it slices from `(page - 1) * pageSize`, so pages start at one. */
const FIRST_PAGE = 1;

/** The two page sizes this surface offers, and the read's own default when an address states neither. */
const PAGE_SIZES: readonly number[] = [50, 200];

const DEFAULT_PAGE_SIZE = 50;

const NO_SORT: RecordListQueryState["sort"] = [];

const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};

/** The address parameters this surface reads and writes. Everything else in the address is preserved untouched. */
const ADDRESS = { intentId: "intentId", page: "page", pageSize: "pageSize" } as const;

const WHOLE_NUMBER = /^\d+$/u;

/** Where this screen sends a reader who has not named a notice yet. */
const UPDATES_LIST = { label: SURFACE.noNoticeAction, href: "/communication" } as const;

const ITEM_NOUN = "recipients";

const RETRY_LABEL = "Try again";

/** The value state a field carries when the read stated none: a member it did not qualify stands as the value it is. */
function stateOf(valueStates: ValueStates, path: string): ValueState {
  return valueStates[path] ?? "value";
}

/** One count, read through its own value state: a plain figure only where the read says the figure stands, and a distinct rendering for a genuine zero, an incomplete subtotal and every state that is not a number at all. */
function CountFigure({ count, valueState }: { readonly count: number; readonly valueState: ValueState }): ReactElement {
  if (!Number.isFinite(count)) {
    return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  }
  switch (valueState) {
    case "value":
      return <span className="tabular-figures">{countFormat.format(count)}</span>;
    case "zero":
      // A genuine zero is its own rendering rather than an ordinary figure, so "nobody was served" can never
      // be read as a value the source supplied and so never shares a shape with a whole number.
      return <StatusBadge label={countFormat.format(count)} valueState="zero" />;
    case "incomplete-subtotal":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="tabular-figures">{countFormat.format(count)}</span>
          <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "incomplete-subtotal")} />
        </span>
      );
    case "unknown":
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, valueState)} />;
  }
}

/** The remaining time the read supplied, restated in hours and minutes without comparing it to any clock of this page's own. */
function formatSpan(milliseconds: number): string {
  const hours = Math.trunc(milliseconds / HOUR_MS);
  const minutes = Math.trunc((milliseconds - hours * HOUR_MS) / MINUTE_MS);
  const parts: readonly string[] = hours > 0 ? [`${countFormat.format(hours)} h`, `${countFormat.format(minutes)} min`] : [`${countFormat.format(minutes)} min`];
  return parts.join(" ");
}

/** One instant, exactly as the read resolved it: the `datetime` attribute carries the machine reading while the text carries the service's own. */
function InstantFigure({ instant }: { readonly instant: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={instant}>
        {instant}
      </time>
    </bdi>
  );
}

/** One opaque reference, isolated so a value whose direction is unknown cannot reorder the text around it. */
function ReferenceFigure({ reference }: { readonly reference: string }): ReactElement {
  // `whitespace-normal` overrides the cell's own no-wrap setting and `wrap-anywhere` breaks only where a word
  // cannot fit, so a long identity wraps inside its column instead of widening the table past its region.
  return <bdi className="mono-identifier whitespace-normal wrap-anywhere">{reference}</bdi>;
}

/** The period the read's records cover, in words, so a reader of any figure knows what span it describes rather than assuming it covers all of history. */
function coverageSentence(coverage: Coverage): string {
  const { from, to, state } = coverage;
  const span = from !== null && to !== null ? `records from ${from} to ${to}` : from !== null ? `records from ${from} onwards` : to !== null ? `records up to ${to}` : "records with no period stated";
  return state === "complete" ? `${span}, fully covered` : state === "partial" ? `${span}, partly covered` : `${span}, coverage not known`;
}

/** The named action the read offers, or `undefined` when it offers none under that name. */
function actionOf(actions: readonly ReadAction[], name: string): ReadAction | undefined {
  return actions.find((action) => action.name === name);
}

/** The page window this surface reads from the address, before the read has applied its own bounds to it. */
interface AddressWindow {
  readonly intentId: string;
  readonly page: number;
  readonly pageSize: number;
}

/** A whole number an address stated, or `undefined` when it stated something that is not one. */
function wholeNumberOf(value: string | null): number | undefined {
  if (value === null || !WHOLE_NUMBER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** The page a request states: pages start at one, and anything else falls back to the first. */
function pageOf(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= FIRST_PAGE ? value : FIRST_PAGE;
}

/** The page size a request states: one of the two sizes this surface offers, or the read's own default. */
function pageSizeOf(value: number | undefined): number {
  return value !== undefined && PAGE_SIZES.some((size) => size === value) ? value : DEFAULT_PAGE_SIZE;
}

/** The window an address states, including the notice it names, so a reload and a return both show the rows the reader left. */
function addressWindowOf(search: ReadonlyURLSearchParams): AddressWindow {
  return { intentId: (search.get(ADDRESS.intentId) ?? "").trim(), page: pageOf(wholeNumberOf(search.get(ADDRESS.page))), pageSize: pageSizeOf(wholeNumberOf(search.get(ADDRESS.pageSize))) };
}

// ---------------------------------------------------------------------------------------------
// The row: the same facts in the table and in the labelled phone composition
// ---------------------------------------------------------------------------------------------

/** The four values that make one dedupe identity. */
interface DedupeIdentity {
  readonly publisherId: string;
  readonly purpose: SendResultData["purpose"];
  readonly recipientId: string;
  readonly intentId: string;
}

/** The two words a repeat permission is stated in, beside the outcome each row records. */
const REPEAT_LABELS = { permitted: "Repeat permitted", notPermitted: "Repeat not permitted" } as const;

const REPEAT_BLOCK = { title: "Why a repeat is or is not permitted", description: "Each sentence below is the service's own reason, stated once with the outcomes it governs rather than repeated beside every row.", missingReason: "The service states no reason for this recipient." } as const;

/** One distinct repeat reason this page's rows state, with the outcomes it governs. */
interface RepeatReason {
  readonly available: boolean;
  readonly reason: string;
  readonly outcomes: readonly SendOutcome[];
}

/** The distinct repeat reasons this page's rows state, each once, in the order the rows state them. */
function repeatReasonsOf(rows: readonly SendResultRow[]): readonly RepeatReason[] {
  const reasons: { available: boolean; reason: string; outcomes: SendOutcome[] }[] = [];
  for (const row of rows) {
    const stated = row.retry.reason.trim();
    const reason = stated.length === 0 ? REPEAT_BLOCK.missingReason : stated;
    const existing = reasons.find((entry) => entry.available === row.retry.available && entry.reason === reason);
    if (existing === undefined) {
      reasons.push({ available: row.retry.available, reason, outcomes: [row.state] });
      continue;
    }
    if (!existing.outcomes.includes(row.state)) {
      existing.outcomes.push(row.state);
    }
  }
  return reasons;
}

/** The distinct repeat reasons, each with the outcomes it governs: the service's sentence, shown once rather than in every cell. */
function RepeatReasons({ reasons }: { readonly reasons: readonly RepeatReason[] }): ReactElement | null {
  if (reasons.length === 0) {
    return null;
  }
  return (
    <section aria-label={REPEAT_BLOCK.title} data-slot="delivery-repeat-reasons" className="flex min-w-0 flex-col gap-2">
      <h3 className="font-heading text-base font-medium text-pretty">{REPEAT_BLOCK.title}</h3>
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
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{entry.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One named part of a dedupe identity: the name is announced, and the value beside it is isolated. The slot names the value, so it is addressed by what it is rather than by the order the parts are listed in. */
function DedupePart({ slot, label, children }: { readonly slot: string; readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-slot={slot} className="min-w-0">
        {children}
      </dd>
    </div>
  );
}

/** The dedupe identity as its four named parts, so two rows that share one are visible as a duplicate rather than hidden behind a single opaque token. */
function DedupeFigure({ identity }: { readonly identity: DedupeIdentity }): ReactElement {
  return (
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
}

/** The outcome the service recorded, in the one vocabulary that names these three states. */
function OutcomeFigure({ state }: { readonly state: SendOutcome }): ReactElement {
  return <StatusBadge {...SEND_STATUS[state]} />;
}

/** Whether a repeat is permitted for this recipient, as the read stated it: the permission itself, never a sentence repeated on every row. */
function RepeatPermission({ available }: { readonly available: boolean }): ReactElement {
  return <StatusBadge label={available ? REPEAT_LABELS.permitted : REPEAT_LABELS.notPermitted} tone={available ? "info" : "muted"} />;
}

// ---------------------------------------------------------------------------------------------
// The summary: the notice the outcomes belong to, its counts and its usefulness window
// ---------------------------------------------------------------------------------------------

/** One labelled fact in a definition list: the label names the value, and the value is what the read supplied. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div data-slot="delivery-fact" className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-pretty wrap-anywhere">{children}</dd>
    </div>
  );
}

/** The remaining time the read supplied, and the word for it when the read states none. */
function RemainingFigure({ remaining, valueState }: { readonly remaining: number | null; readonly valueState: ValueState }): ReactElement {
  if (remaining !== null && valueState !== "unknown" && valueState !== "withheld" && valueState !== "unavailable") {
    return <span className="tabular-figures">{formatSpan(remaining)}</span>;
  }
  const word: Exclude<ValueState, "value" | "zero" | "incomplete-subtotal"> = valueState === "withheld" || valueState === "unavailable" ? valueState : "unknown";
  return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, word)} />;
}

/** The three outcomes in the closed order they are always stated in, so a count is never read beside a different word from one visit to the next. */
const OUTCOME_ORDER: readonly SendOutcome[] = ["accepted", "failed", "unknown"];

/** The three counts, each on its own and none of them added to another. */
function OutcomeCounts({ counts, valueStates }: { readonly counts: SendResultData["counts"]; readonly valueStates: ValueStates }): ReactElement {
  return (
    <div data-slot="delivery-counts" className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium text-pretty">{COUNTS.title}</p>
      <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        {OUTCOME_ORDER.map((outcome) => (
          <div key={outcome} className="flex min-w-0 flex-col gap-1">
            <dt>
              <StatusBadge {...SEND_STATUS[outcome]} />
            </dt>
            <dd className="min-w-0 text-sm">
              <CountFigure count={counts[outcome]} valueState={stateOf(valueStates, `counts.${outcome}`)} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{COUNTS.intro}</p>
    </div>
  );
}

/** The usefulness window exactly as the read resolved it, with the statement of what it governs. */
function UsefulnessBlock({ usefulness, valueStates }: { readonly usefulness: Usefulness; readonly valueStates: ValueStates }): ReactElement {
  return (
    <div data-slot="delivery-usefulness" className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium text-pretty">{USEFULNESS_COPY.title}</p>
      <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <Fact label={USEFULNESS_COPY.stateLabel}>
          <StatusBadge {...USEFULNESS_STATE[usefulness.state]} />
        </Fact>
        <Fact label={USEFULNESS_COPY.deadlineLabel}>
          <InstantFigure instant={usefulness.deadline} />
        </Fact>
        <Fact label={USEFULNESS_COPY.remainingLabel}>
          <RemainingFigure remaining={usefulness.remainingMilliseconds} valueState={stateOf(valueStates, "usefulness.remainingMilliseconds")} />
        </Fact>
      </dl>
      <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{USEFULNESS_COPY.statement}</p>
      <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{SURFACE.noClockNote}</p>
    </div>
  );
}

/** The notice these outcomes belong to: its identity, the edition it was submitted for, the counts and the window that governs a repeat. */
function DeliverySummary({ envelope }: { readonly envelope: DeliveryEnvelope }): ReactElement {
  const { data, valueStates, coverage, asOf, source, revision } = envelope;
  return (
    <Card data-slot="delivery-summary">
      <CardHeader>
        <CardTitle>{SUMMARY.title}</CardTitle>
        <CardDescription>{SUMMARY.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label={SUMMARY.noticeLabel}>
            <ReferenceFigure reference={data.intentId} />
          </Fact>
          <Fact label={SUMMARY.releaseLabel}>
            <ReferenceFigure reference={data.releaseId} />
          </Fact>
          <Fact label={SUMMARY.publisherLabel}>
            <ReferenceFigure reference={data.publisherId} />
          </Fact>
          <Fact label={SUMMARY.purposeLabel}>
            <span>{PURPOSE_LABELS[data.purpose]} </span>
            <ReferenceFigure reference={data.purpose} />
          </Fact>
          <Fact label={SUMMARY.intendedLabel}>
            <InstantFigure instant={data.intendedAt} />
          </Fact>
          <Fact label={SUMMARY.recordedLabel}>{data.recordedAt === null ? SUMMARY.notRecorded : <InstantFigure instant={data.recordedAt} />}</Fact>
          <Fact label={SUMMARY.ceilingLabel}>
            <CountFigure count={data.ceilingCount} valueState={stateOf(valueStates, "ceilingCount")} />
          </Fact>
          <Fact label={SUMMARY.servedLabel}>
            <CountFigure count={data.page.total} valueState={stateOf(valueStates, "page.total")} />
          </Fact>
          <Fact label={SUMMARY.unservedLabel}>
            <CountFigure count={data.unserved.length} valueState={stateOf(valueStates, "unserved")} />
          </Fact>
          <Fact label={SUMMARY.asOfLabel}>
            <InstantFigure instant={asOf} />
          </Fact>
          <Fact label={SUMMARY.coverageLabel}>{coverageSentence(coverage)}</Fact>
          <Fact label={SUMMARY.sourceLabel}>
            <span>{source.system} </span>
            <ReferenceFigure reference={source.reference} />
          </Fact>
          <Fact label={SUMMARY.revisionLabel}>
            <ReferenceFigure reference={revision} />
          </Fact>
        </dl>
        <Separator />
        <OutcomeCounts counts={data.counts} valueStates={valueStates} />
        <Separator />
        <UsefulnessBlock usefulness={data.usefulness} valueStates={valueStates} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// What the outcomes here mean, the recipients not served, and the defect a duplicate would be
// ---------------------------------------------------------------------------------------------

/** One statement per outcome this page actually holds, each saying what that outcome does not mean. */
function OutcomeNarratives({ outcomes }: { readonly outcomes: readonly SendOutcome[] }): ReactElement {
  return (
    <section aria-label={OUTCOMES_BLOCK.title} data-slot="delivery-outcome-narratives" className="flex min-w-0 flex-col gap-2">
      <h3 className="font-heading text-base font-medium text-pretty">{OUTCOMES_BLOCK.title}</h3>
      <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{OUTCOMES_BLOCK.description}</p>
      <ul className="flex min-w-0 flex-col gap-3">
        {outcomes.map((outcome) => (
          <li key={outcome} className="flex min-w-0 flex-col gap-1">
            <StatusBadge {...SEND_STATUS[outcome]} />
            <p className="text-sm text-pretty wrap-anywhere">{OUTCOME_NARRATIVE[outcome]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The eligible recipients the notice did not serve, each with the reason the service recorded. */
function UnservedCard({ entries }: { readonly entries: readonly UnservedRecipient[] }): ReactElement {
  return (
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
              <p className="text-sm text-pretty wrap-anywhere">
                <span className="text-muted-foreground">Recipient </span>
                <ReferenceFigure reference={entry.recipientId} />
              </p>
              {entry.reason === "already-covered" ? (
                <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
                  {UNSERVED_BLOCK.alreadyCovered} <span className="text-foreground">{UNSERVED_BLOCK.coveredByIntent} </span>
                  <ReferenceFigure reference={entry.coveredByIntentId} /> <span className="text-foreground">{UNSERVED_BLOCK.coveredByRendition} </span>
                  <ReferenceFigure reference={entry.coveredByRenditionId} />
                </p>
              ) : (
                <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{RENDITION_REFUSAL_NARRATIVE[entry.renditionRefusal]}</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Two rows sharing one dedupe identity: stated as the defect it is, with the rows shown as recorded and never merged. */
function DuplicateCard({ rows }: { readonly rows: readonly SendResultRow[] }): ReactElement {
  return (
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
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
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
}

// ---------------------------------------------------------------------------------------------
// Recovery: the one control that re-reads the same notice, and the action states behind it
// ---------------------------------------------------------------------------------------------

/** Recovering an outcome by reading the same intent again: the only action this surface offers, because a read repeats no effect. */
function RecoveryCard({ actions, isFetching, onCheck }: { readonly actions: readonly ReadAction[]; readonly isFetching: boolean; readonly onCheck: () => void }): ReactElement {
  const hintId = useId();
  const recovery = actionOf(actions, "recoverByIntent");
  const repeat = actionOf(actions, "retryRecipient");
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
              <Button type="button" variant="outline" size="sm" disabled={isFetching} aria-describedby={hintId} onClick={onCheck}>
                {isFetching ? RECOVERY.checkingLabel : RECOVERY.checkLabel}
              </Button>
            </div>
            <p id={hintId} className="text-xs text-muted-foreground text-pretty wrap-anywhere">
              {RECOVERY.checkDescription}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{actionReasonOf(recovery, RECOVERY.noActionNote)}</p>
        )}
        <Separator />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-sm font-medium text-pretty">{RECOVERY.repeatsLabel}</p>
          {repeat !== undefined && repeat.available ? <p className="text-sm text-pretty wrap-anywhere">{RECOVERY.repeatAvailable}</p> : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{actionReasonOf(repeat, RECOVERY.noRepeatNote)}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** The reason an action is unavailable, the statement that the read offered no such action, and nothing in between. */
function actionReasonOf(action: ReadAction | undefined, absentNote: string): string {
  if (action === undefined) {
    return absentNote;
  }
  const reason = (action.reason ?? "").trim();
  return reason.length === 0 ? RECOVERY.unavailableNoReason : reason;
}

// ---------------------------------------------------------------------------------------------
// The compositions of one row: the table's columns and the labelled phone card
// ---------------------------------------------------------------------------------------------

/** The three identity values every row of one notice shares; the row itself supplies the recipient. */
interface DedupeBase {
  readonly publisherId: string;
  readonly purpose: SendResultData["purpose"];
  readonly intentId: string;
}

/** What a refused read said the caller must correct, or the statement that it named nothing to correct. */
const REFUSED_WITHOUT_FIELDS = "The read's own request was refused and named no field to correct, so nothing was read and nothing is shown in its place.";

/** Every message the read attached to its refusal, so the reader is told what to correct rather than simply that something was refused. */
function refusalSummaryOf(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields)
    .flat()
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
  return messages.length === 0 ? REFUSED_WITHOUT_FIELDS : messages.join(" ");
}

/** The identity values a whole answer shares, or `undefined` when the answer was not an envelope. */
function identityBaseOf(result: SendResultReadResult | undefined): DedupeBase | undefined {
  if (result === undefined || result.kind !== "envelope") {
    return undefined;
  }
  const { publisherId, purpose, intentId } = result.envelope.data;
  return { publisherId, purpose, intentId };
}

/**
 * One row's whole dedupe identity. The three shared values fall back to empty text only where no envelope is
 * held at all, and the columns that would render them are not shown in that state either, so a fallback can
 * never be presented as a value the read supplied.
 */
function identityOfRow(base: DedupeBase | undefined, row: SendResultRow): DedupeIdentity {
  return { publisherId: base?.publisherId ?? "", purpose: base?.purpose ?? "update-email", recipientId: row.recipientId, intentId: base?.intentId ?? "" };
}

/** Every row whose dedupe identity another row of this page already states, in the order the read returned them. */
function duplicateRowsOf(rows: readonly SendResultRow[]): readonly SendResultRow[] {
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    occurrences.set(row.dedupeKey, (occurrences.get(row.dedupeKey) ?? 0) + 1);
  }
  return rows.filter((row) => (occurrences.get(row.dedupeKey) ?? 0) > 1);
}

/** The table's columns. No column offers a sort, because the read states one order and takes no ordering parameter. */
function deliveryColumns(base: DedupeBase | undefined): ReadonlyArray<RecordListColumnDef<SendResultRow>> {
  return [
    // The recipient is what the row is about, so hiding it would leave a row of values naming nobody.
    { id: "recipient", header: COLUMN.recipient, enableSorting: false, enableHiding: false, cell: ({ row }) => <ReferenceFigure reference={row.original.recipientId} /> },
    { id: "pinned", header: COLUMN.pinned, enableSorting: false, cell: ({ row }) => <ReferenceFigure reference={row.original.renditionId} /> },
    { id: "outcome", header: COLUMN.outcome, enableSorting: false, enableHiding: false, cell: ({ row }) => <OutcomeFigure state={row.original.state} /> },
    { id: "recorded", header: COLUMN.recorded, enableSorting: false, cell: ({ row }) => <InstantFigure instant={row.original.recordedAt} /> },
    { id: "repeat", header: COLUMN.repeat, enableSorting: false, cell: ({ row }) => <RepeatPermission available={row.original.retry.available} /> },
    { id: "dedupe", header: COLUMN.dedupe, enableSorting: false, cell: ({ row }) => <DedupeFigure identity={identityOfRow(base, row.original)} /> },
  ];
}

/** The labelled phone composition of one row: every fact with its own name and no horizontal scroll. */
function RowCard({ row, identity }: { readonly row: SendResultRow; readonly identity: DedupeIdentity }): ReactElement {
  return (
    <li data-slot="delivery-row" data-outcome={row.state} className="flex min-w-0 flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <dl className="flex min-w-0 flex-col gap-1.5 text-sm">
        <Fact label={COLUMN.recipient}>
          <ReferenceFigure reference={row.recipientId} />
        </Fact>
        <Fact label={COLUMN.pinned}>
          <ReferenceFigure reference={row.renditionId} />
        </Fact>
        <Fact label={COLUMN.outcome}>
          <OutcomeFigure state={row.state} />
        </Fact>
        <Fact label={COLUMN.recorded}>
          <InstantFigure instant={row.recordedAt} />
        </Fact>
        <Fact label={COLUMN.repeat}>
          <RepeatPermission available={row.retry.available} />
        </Fact>
        <Fact label={COLUMN.dedupe}>
          <DedupeFigure identity={identity} />
        </Fact>
      </dl>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The heading levels a surrounding page can need; the level is the page's, not this surface's. */
export type DeliveryHeadingLevel = 1 | 2 | 3;

const HEADING_TAG: Readonly<Record<DeliveryHeadingLevel, "h1" | "h2" | "h3">> = { 1: "h1", 2: "h2", 3: "h3" };

/** Props of {@link DeliveryResults}. */
export interface DeliveryResultsProps {
  /** The exact authority this read runs under; the service re-derives scope from it on every request. */
  readonly scope: Scope;
  /** The notice whose results to report. Absent, the address's own `intentId` is read, so a link into this screen can name the notice it reports on. */
  readonly intentId?: string;
  /** The answer a Server Component already read, so the surface paints from that authority instead of asking the same question again. */
  readonly initialData?: SendResultReadResult;
  /** When that answer was produced, so the cache treats the seed as the age it is rather than as brand new. */
  readonly initialDataUpdatedAt?: number;
  /** The page window a composing page controls; absent, the window is read from the address and written back to it. */
  readonly queryState?: RecordListQueryState;
  /** Receives every window or column change as well, for a caller that keeps its own copy of the state. */
  readonly onQueryStateChange?: (next: RecordListQueryState) => void;
  /** The heading level this surface takes from the page that composes it. */
  readonly headingLevel?: DeliveryHeadingLevel;
  readonly className?: string;
}

/** The per-send results of one submitted notice: acceptance, definite failure and unknown outcome, kept apart. */
export default function DeliveryResults({ scope, intentId: statedIntentId, initialData, initialDataUpdatedAt, queryState: controlledState, onQueryStateChange, headingLevel = 2, className }: DeliveryResultsProps): ReactElement {
  const headingId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The address is where this surface's notice and page window live when no caller states them, so a
  // reload, a return from another screen and the browser's Back button all show what the reader left.
  const address = useMemo<AddressWindow>(() => addressWindowOf(searchParams), [searchParams]);
  const intentId = (statedIntentId ?? address.intentId).trim();
  const page = controlledState === undefined ? address.page : controlledState.page;
  const pageSize = controlledState === undefined ? address.pageSize : controlledState.pageSize;
  // Column visibility is presentation and stays in this component, as the preset's other lists keep it.
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(controlledState === undefined ? NO_COLUMNS_HIDDEN : controlledState.columnVisibility);
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: NO_SORT, page, pageSize, columnVisibility }), [page, pageSize, columnVisibility]);
  const read = useSendResult({ scope, intentId, page, pageSize }, { initialData, initialDataUpdatedAt });
  const Heading = HEADING_TAG[headingLevel];
  const result = read.result;
  // A result read under a context this session no longer shows is never presented as the current one, so
  // it is dropped here rather than rendered with the previous context's authority behind it.
  const stale = result !== undefined && read.isStale(result);
  const pageCount = result !== undefined && !stale && result.kind === "envelope" ? result.envelope.data.page.pageCount : 0;
  // The columns are rebuilt only when a different answer arrives, so the table's own column instances stay
  // stable from one render to the next.
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<SendResultRow>>>(() => deliveryColumns(identityBaseOf(result)), [result]);
  const writeWindow = useCallback(
    (next: { readonly page: number; readonly pageSize: number }): void => {
      // Every other parameter the page carries is preserved, so the address still states what the page is about.
      const params = new URLSearchParams(searchParams.toString());
      params.set(ADDRESS.page, String(next.page));
      params.set(ADDRESS.pageSize, String(next.pageSize));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const commitQuery = useCallback(
    (next: RecordListQueryState): void => {
      if (next.columnVisibility !== columnVisibility) {
        setColumnVisibility(next.columnVisibility);
      }
      if (next.page !== page || next.pageSize !== pageSize) {
        writeWindow({ page: next.page, pageSize: next.pageSize });
      }
      onQueryStateChange?.(next);
    },
    [columnVisibility, onQueryStateChange, page, pageSize, writeWindow],
  );
  // A page the address states past the last page the read reports is corrected to that last page, so the
  // rows, the caption and the pager always describe one window. Both numbers in it are the read's own.
  useEffect(() => {
    if (controlledState !== undefined || pageCount === 0 || page <= pageCount) {
      return;
    }
    writeWindow({ page: pageCount, pageSize });
  }, [controlledState, pageCount, page, pageSize, writeWindow]);
  function checkResult(): void {
    // Reading this same notice again, under the identity it already has: a read performs no effect, so this
    // is the only recovery this surface can offer and the only one that cannot repeat a submission.
    read.refetch();
  }
  function frame(children: ReactNode): ReactElement {
    return (
      <section aria-labelledby={headingId} data-slot="delivery-results" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
        <div className="flex min-w-0 flex-col gap-1">
          <Heading id={headingId} className="font-heading text-xl font-semibold text-pretty wrap-anywhere">
            {SURFACE.heading}
          </Heading>
          <p className="max-w-prose text-sm text-muted-foreground text-pretty wrap-anywhere">{SURFACE.intro}</p>
        </div>
        {/* The one simulated-effect disclosure for this surface, stated where the mail-submission boundary is crossed rather than once per row. */}
        <SimulationLabel effect={SIMULATED_EFFECT_BY_TRIGGER.notify} context="block" />
        {children}
      </section>
    );
  }
  const retry = { label: RETRY_LABEL, onClick: checkResult };
  if (intentId === "") {
    // No notice is named, so there is nothing to report on and nothing is counted: this is an empty state
    // with the route that leads to a notice, not an idle spinner that would never end.
    return frame(<StateNotice kind="empty" title={SURFACE.noNoticeTitle} description={SURFACE.noNoticeDescription} action={UPDATES_LIST} headingLevel={headingLevel} />);
  }
  if (read.isPending || stale) {
    // The answer is still awaited, or the answer held belongs to a context this session no longer shows.
    // No count, no row and no zero stands in for it in the meantime.
    return frame(<StateNotice kind="loading" title={SURFACE.loadingTitle} description={SURFACE.loadingDescription} headingLevel={headingLevel} loadingLines={7} />);
  }
  if (result === undefined) {
    // No read result arrived at all, which is an outage with a retry rather than a notice nobody served.
    return frame(<StateNotice kind="unavailable" title={SURFACE.unavailableTitle} description={SURFACE.unavailableDescription} retry={retry} headingLevel={headingLevel} />);
  }
  if (result.kind === "denied") {
    // A denial states no count, no recipient and no size: the answer is the same whether or not this notice
    // exists in the scope this session may not read.
    return frame(<StateNotice kind="denied" title={SURFACE.deniedTitle} description={SURFACE.deniedDescription} reasonCode={result.denied.reasonCode} headingLevel={headingLevel} />);
  }
  if (result.kind === "unavailable") {
    // The outcome's own guidance and source are shown rather than a sentence written here, so the outage
    // names what failed and what to do about it.
    return frame(<StateNotice kind="unavailable" title={SURFACE.unavailableTitle} description={result.unavailable.guidance} source={result.unavailable.source} retry={retry} headingLevel={headingLevel} />);
  }
  if (result.kind === "refused") {
    // The request this surface asked for is not one the read admits: the request itself is the answer, so no
    // count, row or source failure stands in its place.
    return frame(<StateNotice kind="refused" title={SURFACE.refusedTitle} description={refusalSummaryOf(result.refused.fields)} headingLevel={headingLevel} />);
  }
  const envelope = result.envelope;
  const data = envelope.data;
  if (data.intentId !== intentId) {
    // The read is still answering the notice this surface showed a moment ago. Those rows are never shown
    // under another notice's heading, so the previous answer gives way to the pending state.
    return frame(<StateNotice kind="loading" title={SURFACE.loadingTitle} description={SURFACE.loadingDescription} headingLevel={headingLevel} loadingLines={7} />);
  }
  const rows = data.rows;
  const duplicates = duplicateRowsOf(rows);
  // Only the outcomes this answer actually holds are described, so the page never explains a state it has no
  // row or count for.
  const outcomes = OUTCOME_ORDER.filter((outcome) => data.counts[outcome] > 0 || rows.some((row) => row.state === outcome));
  const identityBase: DedupeBase = { publisherId: data.publisherId, purpose: data.purpose, intentId: data.intentId };
  const tableLabel = `${SURFACE.heading}: recorded outcomes for notice ${data.intentId}`;
  const rowsBlock =
    rows.length === 0 ? (
      data.page.total > 0 ? (
        // The address names a page past the end of this result: the correction above re-reads the last page
        // the read states, and an empty table in the meantime would claim the notice served nobody.
        <StateNotice kind="loading" title={SURFACE.loadingTitle} description={SURFACE.loadingDescription} headingLevel={headingLevel} loadingLines={6} />
      ) : (
        <StateNotice kind="empty" title={SURFACE.emptyTitle} description={SURFACE.emptyDescription} headingLevel={headingLevel} />
      )
    ) : (
      <>
        {/*
          Two compositions of one answer with opposite responsive display utilities, so `display: none`
          removes the other from the accessibility tree: a reader meets the table or the labelled cards,
          never both and never neither (WCAG 1.3.1, 1.4.10). Only the table's own scroll region may scroll
          sideways; the page itself never does.
        */}
        <div className="hidden min-w-0 md:block">
          <RecordList label={tableLabel} columns={columns} rows={rows} rowCount={data.page.total} queryState={listQueryState} onQueryStateChange={commitQuery} getRowId={(row) => row.recipientId} itemNoun={ITEM_NOUN} pageSizeOptions={PAGE_SIZES} />
        </div>
        <div className="flex min-w-0 flex-col gap-3 md:hidden">
          <ul aria-label={tableLabel} className="flex min-w-0 flex-col gap-4">
            {rows.map((row, index) => (
              <RowCard key={`${row.dedupeKey}-${String(index)}`} row={row} identity={identityOfRow(identityBase, row)} />
            ))}
          </ul>
          {/* The phone composition's own pager, at the read's own window: 50 rows by default, 200 at most. */}
          <PaginationBar
            total={data.page.total}
            page={data.page.page}
            pageSize={data.page.pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={(nextPage) => {
              commitQuery({ ...listQueryState, page: nextPage });
            }}
            onPageSizeChange={(nextPageSize) => {
              commitQuery({ ...listQueryState, pageSize: nextPageSize });
            }}
            itemNoun={ITEM_NOUN}
          />
        </div>
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
      <DeliverySummary envelope={envelope} />
      {outcomes.length === 0 ? null : <OutcomeNarratives outcomes={outcomes} />}
      {duplicates.length === 0 ? null : <DuplicateCard rows={duplicates} />}
      {data.unserved.length === 0 ? null : <UnservedCard entries={data.unserved} />}
      {rowsBlock}
      <RepeatReasons reasons={repeatReasonsOf(rows)} />
      <RecoveryCard actions={envelope.actions} isFetching={read.isFetching} onCheck={checkResult} />
    </>,
  );
}
