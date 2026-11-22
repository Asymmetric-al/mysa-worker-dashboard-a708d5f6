"use client";
/** The synthetic inbox: every message this reader's purpose has produced, one per recipient and notification intent, each shown at the copy the recipient was pinned to. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import SimulationLabel from "@/components/simulation-label";
import StateNotice from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, statusBadgeProps, VALUE_STATE_WORDS, type SendStatus, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { INBOX_EMPTY_COPY, INBOX_HEADING, INBOX_SIMULATION_EFFECT, ONE_COPY_STATEMENT } from "@/features/audience/copy/inbox";
import { cn } from "@/lib/cn";
import { sameScope, type Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { useInbox, type InboxEnvelope } from "../hooks/use-audience-reads";
import MessageReader, { type MessageDirection } from "./message-reader";
/** One produced message, taken from the read rather than restated, so a field the read adds or renames reaches this surface without a second definition to keep in step. */
type InboxMessage = InboxEnvelope["data"]["messages"][number];
/** The audience a pinned rendition can carry, named from the read's own union. */
type PinnedAudience = NonNullable<InboxMessage["audience"]>;
/** The page window this surface asks the read for. The read answers with the window it executed, and the pager states that one; the address owns the window, so opening a message, reloading or returning from another screen reopens the same page. */
interface InboxPaging {
  readonly page: number;
  readonly pageSize: number;
}
export interface InboxListProps {
  /** The exact authority this inbox is read under; the service re-derives scope from it on every read. */
  readonly scope: Scope;
  /** The interface locale this surface formats its counts in, stated by the route that composes it. */
  readonly locale: string;
  /** The answer the route's Server Component read, shown until this surface's own read answers under the same authority and for the same page window. */
  readonly initialEnvelope?: ReadResult<InboxEnvelope>;
  readonly className?: string;
}
/** The page the read counts from: it slices from `(page - 1) * pageSize`. */
const FIRST_PAGE = 1;
/** The service's documented list defaults and cap: 50 rows a page and 200 at most. The surface asks for these and then states the window the read executed, because the read applies its own clamp rather than honouring any request. */
const DEFAULT_PAGE_SIZE = 50;
const INBOX_PAGE_SIZES: readonly number[] = [50, 200];
const ITEM_NOUN = "message";
const RETRY_LABEL = "Try again";
/** The whole-number formatters this surface counts with, one per interface locale: the locale is a viewer choice, so the formatter is keyed by the one the route states and the constructor is paid once per locale rather than once per formatted count. */
const COUNT_FORMATS = new Map<string, Intl.NumberFormat>();
/** The whole-number formatter for the interface locale the composing route states. */
function countFormatOf(locale: string): Intl.NumberFormat {
  const known = COUNT_FORMATS.get(locale);
  if (known !== undefined) {
    return known;
  }
  const made = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  COUNT_FORMATS.set(locale, made);
  return made;
}
const EMPTY_MESSAGES: readonly InboxMessage[] = [];
// The surface's own words
const SURFACE_INTRO = "Every message this membership's notification purpose has produced, at the copy the recipient was pinned to: " + "the sender, the subject, the body as HTML and as plain text, and the outcome this application recorded for it.";
const COLUMNS = { sender: "Sender", subject: "Subject", audience: "Audience", language: "Language", noticeBody: "Notice body", intendedAt: "Intended at", recordedAt: "Recorded at", sendState: "Send outcome" } as const;
const OPEN_LABEL = "Open";
const CLOSE_LABEL = "Close";
const READER_HEADING = "The message as it was produced for this recipient";
const OUTCOMES_HEADING = "Send outcomes recorded in this inbox";
const HONESTY_NOTE =
  "An outcome recorded as accepted states that this application took the submission. It is not a delivered " +
  "message and not a read one. An outcome recorded as unknown says the acknowledgement never arrived rather " +
  "than that the submission failed: it is checked against the same operation, which returns the result already " +
  "recorded, and no control on this page repeats a submission under a new one.";
const ORDER_NOTE = "Messages are ordered by the instant the notice was intended, newest first, and then by message identity. " + "This read takes no ordering parameter, so no column is sortable and the order above the list is the order " + "the read applied.";
const AS_OF_NOTE = "Read at";
const AS_OF_EXPLANATION = "the scenario instant this inbox was evaluated at, so a message recorded after it does not appear here.";
const STATE_HEADINGS = { loading: "Reading this inbox", unavailable: "The inbox could not be read", denied: "This inbox is not permitted here", refused: "The inbox request was not admitted", partialCoverage: "The source covers only part of the period this inbox records" } as const;
const BEYOND_LAST_PAGE = { title: "This page of the inbox holds no message", action: "Go to the last page" } as const;
/** The statement for a page the result no longer reaches, told with the read's own page count so no number here is computed. */
function beyondLastPageStatement(pageCount: number, page: number, locale: string): string {
  const countFormat = countFormatOf(locale);
  return `The result now holds ${countFormat.format(pageCount)} ${pageCount === 1 ? "page" : "pages"} of messages, so page ${countFormat.format(page)} holds none; no message was dropped, and the pager states where they are.`;
}
const DUPLICATE_DEFECT = {
  title: "Two messages share one recipient and one notification intent",
  lead: "One intent must produce one message for one recipient, so this is a defect in the recorded send results rather than a second message to read. No copy here has been dropped, merged or hidden: both are shown as recorded, and the fix belongs where the results were recorded.",
} as const;
const UNRESOLVED_NOTE = { title: "Some intents produced no readable message", lead: "They are recorded for this recipient and could not be resolved into a message, so this inbox is incomplete rather than empty, and nothing is reconstructed in their place." } as const;
const READING_UNAVAILABLE = { title: "The edition this message points at cannot be rendered now", lead: "The message itself is shown as it was recorded. The edition it links to is not readable at this instant, so nothing of it is reproduced here and no cached copy stands in its place." } as const;
// The vocabularies this surface shows. Each key is the read's own union member, so a value the read adds fails to compile here instead of rendering blank.
/** The two audiences a pinned copy carries. The tone says how to read the label, and the label is the word shown. */
const AUDIENCE_DISPLAY: Readonly<Record<PinnedAudience, { readonly label: string; readonly tone: StatusTone }>> = { public: { label: "Public", tone: "neutral" }, "approved-supporter": { label: "Approved supporters", tone: "info" } };
/** Whether the body is the link-only protected notice or the notice a public edition produces. */
const NOTICE_BODY_DISPLAY: Readonly<Record<"protected" | "public", { readonly label: string; readonly tone: StatusTone }>> = { protected: { label: "Protected notice", tone: "caution" }, public: { label: "Public notice", tone: "neutral" } };
/** The three send outcomes, in the order the specification names them, so the summary always reads accepted, failed, unknown. */
const SEND_STATE_ORDER: readonly SendStatus[] = ["accepted", "failed", "unknown"];
/** The shared word for a value the read did not state, taken from the one value-state vocabulary rather than written again here. */
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
/** The largest offered row size at or below a stated one, so the window this surface asks the read for is a window its own pager can also state. */
function offeredPageSize(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  const stated = Math.trunc(requested);
  let offered = DEFAULT_PAGE_SIZE;
  for (const size of INBOX_PAGE_SIZES) {
    if (size <= stated) offered = size;
  }
  return offered;
}
/** The server's answer, usable only while it is the answer to the request this surface is making. An envelope read in another authority says nothing about this one, and one that states a different page window describes records this page does not hold. */
function usableSeed(seed: ReadResult<InboxEnvelope> | undefined, scope: Scope, paging: InboxPaging): ReadResult<InboxEnvelope> | undefined {
  if (seed === undefined) return undefined;
  // A denial, an outage or a refusal carries no record, so showing it is no less true than showing the busy state it replaces; the read this surface makes replaces it either way.
  if (seed.kind !== "envelope") return seed;
  if (!sameScope(seed.envelope.scope, scope)) return undefined;
  const stated = seed.envelope.data.page;
  return stated.page === paging.page && stated.pageSize === paging.pageSize ? seed : undefined;
}
/** The direction the pinned copy is read in. A message whose copy states no locale is read in the document's own order and its language column states that the value is not recorded; nothing here infers a language from the prose. */
function directionOf(message: InboxMessage): MessageDirection {
  return message.locale?.direction === "rtl" ? "rtl" : "ltr";
}
/** One message count, stated as the whole result rather than as the page on screen. */
function messageCountStatement(total: number, locale: string): string {
  return total === 1 ? "One message has been produced for this membership." : `${countFormatOf(locale).format(total)} messages have been produced for this membership.`;
}
export function InboxList({ scope, locale, initialEnvelope, className }: InboxListProps): ReactElement {
  const headingId = useId();
  const readerHeadingId = useId();
  const readerRegionId = useId();
  const readerRef = useRef<HTMLElement | null>(null);
  const openTriggerRef = useRef<HTMLButtonElement | null>(null);
  // The window the route's read answered with is the window this surface opens on, so the first paint states the
  // rows that answer holds and asks the read for nothing it has not already been asked; the default stands in only
  // when that answer carries no window. The address owns the window from then on, so a reader who opens a message,
  // reloads or returns from another screen reopens the page they left rather than the first one.
  const seededWindow = initialEnvelope !== undefined && initialEnvelope.kind === "envelope" ? initialEnvelope.envelope.data.page : undefined;
  const listWindow = useRecordListWindow({ page: seededWindow?.page ?? FIRST_PAGE, pageSize: offeredPageSize(seededWindow?.pageSize ?? DEFAULT_PAGE_SIZE) });
  const paging = useMemo<InboxPaging>(() => ({ page: listWindow.page, pageSize: offeredPageSize(listWindow.pageSize) }), [listWindow.page, listWindow.pageSize]);
  const setWindow = listWindow.setWindow;
  // The columns a worker shows are presentation only, so they stay in this component rather than in the address.
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const inbox = useInbox({ scope, query: { page: paging.page, pageSize: paging.pageSize } });
  const refetchInbox = inbox.refetch;
  const seed = useMemo(() => usableSeed(initialEnvelope, scope, paging), [initialEnvelope, scope, paging]);
  const read = inbox.data ?? seed;
  const envelopeRead = read !== undefined && read.kind === "envelope" ? read : undefined;
  const view = envelopeRead?.envelope.data;
  const messages = view?.messages ?? EMPTY_MESSAGES;
  const selectedMessage = selectedMessageId === null ? undefined : messages.find((message) => message.messageId === selectedMessageId);
  // Opening a message moves the reader into the message, so a keyboard user arrives at what changed rather than continuing past the table; closing it from inside returns to the control that opened it. Both movements are the surface's own, so no other control loses its place.
  useEffect(() => {
    if (selectedMessageId === null) return;
    readerRef.current?.focus();
  }, [selectedMessageId]);
  const closeReader = useCallback((): void => {
    const trigger = openTriggerRef.current;
    setSelectedMessageId(null);
    trigger?.focus();
  }, []);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState): void => {
      // The columns a worker shows change what this page displays, not which records the read answers with, so they stay out of the query.
      setColumnVisibility(next.columnVisibility);
      // No column is sortable, so the ordering the preset reports is always empty; only the page window travels, and
      // it travels in the address the read is driven from.
      setWindow({ page: Math.max(FIRST_PAGE, next.page), pageSize: offeredPageSize(next.pageSize) });
    },
    [setWindow],
  );
  const getRowId = useCallback((message: InboxMessage): string => message.messageId, []);
  // A duplicate recipient-and-intent pair is checked, never repaired: within one reader's inbox the recipient is fixed, so the intent identifies the pair. The read already keeps one message per intent over the whole inbox, which makes a duplicate here a defect that escaped it rather than a second message to read.
  const duplicatedIntents = useMemo<readonly { readonly intentId: string; readonly copies: number }[]>(() => {
    const copies = new Map<string, number>();
    for (const message of messages) copies.set(message.intentId, (copies.get(message.intentId) ?? 0) + 1);
    const duplicated: { intentId: string; copies: number }[] = [];
    for (const [intentId, count] of copies) if (count > 1) duplicated.push({ intentId, copies: count });
    return duplicated;
  }, [messages]);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<InboxMessage>>>(
    () => [
      {
        id: "sender",
        header: COLUMNS.sender,
        enableSorting: false,
        cell: (context) => (
          <span className="min-w-0 font-medium break-words">
            <bdi>{context.row.original.sender}</bdi>
          </span>
        ),
      },
      {
        id: "subject",
        header: COLUMNS.subject,
        enableSorting: false,
        cell: (context) => (
          <span className="min-w-0 break-words">
            <bdi>{context.row.original.subject}</bdi>
          </span>
        ),
      },
      {
        id: "audience",
        header: COLUMNS.audience,
        enableSorting: false,
        cell: (context) => {
          const audience = context.row.original.audience;
          // The pinned copy states its audience, so an absent value is shown as not recorded rather than guessed from the notice body.
          return audience === null ? <StatusBadge {...NOT_RECORDED} srPrefix={COLUMNS.audience} /> : <StatusBadge {...AUDIENCE_DISPLAY[audience]} srPrefix={COLUMNS.audience} />;
        },
      },
      {
        id: "language",
        header: COLUMNS.language,
        enableSorting: false,
        cell: (context) => {
          const locale = context.row.original.locale;
          return locale === null ? <StatusBadge {...NOT_RECORDED} srPrefix={COLUMNS.language} /> : <bdi>{locale.tag}</bdi>;
        },
      },
      {
        id: "noticeBody",
        header: COLUMNS.noticeBody,
        enableSorting: false,
        cell: (context) => {
          const body = NOTICE_BODY_DISPLAY[context.row.original.protectedNotice ? "protected" : "public"];
          return <StatusBadge {...body} srPrefix={COLUMNS.noticeBody} />;
        },
      },
      { id: "intendedAt", header: COLUMNS.intendedAt, enableSorting: false, cell: (context) => <bdi className="tabular-figures whitespace-nowrap">{context.row.original.intendedAt}</bdi> },
      { id: "recordedAt", header: COLUMNS.recordedAt, enableSorting: false, cell: (context) => <bdi className="tabular-figures whitespace-nowrap">{context.row.original.recordedAt}</bdi> },
      { id: "sendState", header: COLUMNS.sendState, enableSorting: false, cell: (context) => <StatusBadge {...statusBadgeProps(SEND_STATUS, context.row.original.state)} srPrefix={COLUMNS.sendState} /> },
    ],
    [],
  );
  const rowActions = useCallback(
    (message: InboxMessage): ReactElement => {
      const isOpen = message.messageId === selectedMessageId;
      return (
        <Button type="button" variant={isOpen ? "secondary" : "ghost"} size="sm" aria-expanded={isOpen} aria-controls={isOpen ? readerRegionId : undefined} ref={isOpen ? openTriggerRef : undefined} onClick={() => setSelectedMessageId(isOpen ? null : message.messageId)} className="max-w-full whitespace-normal">
          {isOpen ? CLOSE_LABEL : OPEN_LABEL}
          <span className="sr-only">{` the message “${message.subject}” from ${message.sender}`}</span>
        </Button>
      );
    },
    [selectedMessageId, readerRegionId],
  );
  const reader =
    selectedMessage === undefined ? null : (
      <section id={readerRegionId} ref={readerRef} tabIndex={-1} aria-labelledby={readerHeadingId} data-slot="inbox-reader" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 id={readerHeadingId} className="font-heading text-base font-semibold text-pretty wrap-anywhere">
            {READER_HEADING}
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={closeReader} className="max-w-full whitespace-normal">
            {CLOSE_LABEL}
            <span className="sr-only"> the message</span>
          </Button>
        </div>
        {selectedMessage.reading.state === "unavailable" ? (
          // The message is readable and the edition it points at is not, so the two facts stay apart: the notice below is shown as it was recorded, and no cached edition stands in for the unreadable one.
          <Alert role={undefined} data-slot="inbox-reading-unavailable">
            <AlertTitle>{READING_UNAVAILABLE.title}</AlertTitle>
            <AlertDescription>
              <p>{READING_UNAVAILABLE.lead}</p>
              <p>{selectedMessage.reading.reason}</p>
            </AlertDescription>
          </Alert>
        ) : null}
        <MessageReader
          sender={selectedMessage.sender}
          subject={selectedMessage.subject}
          asOfLabel={selectedMessage.recordedAt}
          audienceLabel={selectedMessage.audience === null ? NOT_RECORDED.label : AUDIENCE_DISPLAY[selectedMessage.audience].label}
          audienceTone={selectedMessage.audience === null ? NOT_RECORDED.tone : AUDIENCE_DISPLAY[selectedMessage.audience].tone}
          languageTag={selectedMessage.locale?.tag ?? ""}
          direction={directionOf(selectedMessage)}
          protected={selectedMessage.protectedNotice}
          html={selectedMessage.html}
          plainText={selectedMessage.plainText}
          noticeHref={selectedMessage.link}
          sendState={selectedMessage.state}
        />
      </section>
    );
  const retry = {
    label: RETRY_LABEL,
    onClick: (): void => {
      void refetchInbox();
    },
  };
  let content: ReactElement;
  if (read === undefined) {
    // The read has not answered yet and no server answer stands in for it, so nothing is counted and no empty result is implied.
    content = <StateNotice kind="loading" title={STATE_HEADINGS.loading} headingLevel={3} loadingLines={6} />;
  } else if (read.kind === "denied") {
    // A denial states no count, subject or size: the answer is the same whether or not this reader was sent anything, so nothing here reveals what it cannot show.
    content = <StateNotice kind="denied" title={STATE_HEADINGS.denied} reasonCode={read.denied.reasonCode} headingLevel={3} />;
  } else if (read.kind === "unavailable") {
    // The outcome's own guidance and source are shown rather than a sentence written here, and no empty list stands in for the outage.
    content = <StateNotice kind="unavailable" title={STATE_HEADINGS.unavailable} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={3} />;
  } else if (read.kind === "refused") {
    // The page window this surface asked for is one the read does not admit: the request is the answer, so no source failure is reported in its place and no row is invented.
    content = <StateNotice kind="refused" title={STATE_HEADINGS.refused} headingLevel={3} />;
  } else {
    const envelope = read.envelope;
    const data = envelope.data;
    // Every count below is the read's own, grouped in the interface locale the route states.
    const formatCount = countFormatOf(locale);
    const unresolvedNoun = data.unresolvedIntents === 1 ? "intent" : "intents";
    const body =
      data.page.total === 0 ? (
        // A genuine empty inbox is the membership's own state, and the copy says so in its own words rather than this surface's.
        <StateNotice kind="empty" title={INBOX_EMPTY_COPY.title} description={INBOX_EMPTY_COPY.description} headingLevel={3} />
      ) : data.messages.length === 0 ? (
        // The page asked for is past the last one this result holds — a result that shrank while it was open. Nothing re-reads behind the worker's back: the notice states the window and offers the move.
        <StateNotice kind="empty" title={BEYOND_LAST_PAGE.title} description={beyondLastPageStatement(data.page.pageCount, data.page.page, locale)} action={{ label: BEYOND_LAST_PAGE.action, onClick: () => setWindow({ page: Math.max(FIRST_PAGE, data.page.pageCount), pageSize: paging.pageSize }) }} headingLevel={3} />
      ) : (
        <>
          <RecordList
            label={INBOX_HEADING}
            columns={columns}
            rows={data.messages}
            rowCount={data.page.total}
            queryState={{ sort: [], page: data.page.page, pageSize: data.page.pageSize, columnVisibility }}
            onQueryStateChange={handleQueryStateChange}
            getRowId={getRowId}
            rowActions={rowActions}
            itemNoun={ITEM_NOUN}
            pageSizeOptions={INBOX_PAGE_SIZES}
          />
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{ORDER_NOTE}</p>
          {reader}
        </>
      );
    content = (
      <>
        <div className="flex min-w-0 flex-col gap-2">
          {/* The whole authorised result, counted by the read: the page on screen is never read as the whole inbox. */}
          <p className="text-sm font-medium text-pretty wrap-anywhere">{messageCountStatement(data.page.total, locale)}</p>
          <ul aria-label={OUTCOMES_HEADING} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            {SEND_STATE_ORDER.map((state) => (
              <li key={state} className="flex min-w-0 flex-wrap items-center gap-1.5">
                <StatusBadge {...statusBadgeProps(SEND_STATUS, state)} srPrefix={COLUMNS.sendState} />
                <span className="tabular-figures text-sm">{formatCount.format(data.sendStates[state])}</span>
              </li>
            ))}
          </ul>
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{HONESTY_NOTE}</p>
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">
            {`${AS_OF_NOTE} `}
            <bdi className="tabular-figures">{envelope.asOf}</bdi>
            {` — ${AS_OF_EXPLANATION}`}
          </p>
        </div>
        {envelope.coverage.state === "complete" ? null : (
          // Coverage is the read's own statement of how much of the past it saw, so a partial period means a message may be missing rather than absent.
          <StateNotice kind="partial-coverage" title={STATE_HEADINGS.partialCoverage} coverage={envelope.coverage} headingLevel={3} />
        )}
        {data.unresolvedIntents === 0 ? null : (
          <Alert role={undefined} data-slot="inbox-unresolved-intents">
            <AlertTitle>{UNRESOLVED_NOTE.title}</AlertTitle>
            <AlertDescription>
              <p>{`${formatCount.format(data.unresolvedIntents)} ${unresolvedNoun} recorded for this recipient produced no message.`}</p>
              <p>{UNRESOLVED_NOTE.lead}</p>
            </AlertDescription>
          </Alert>
        )}
        {duplicatedIntents.length === 0 ? null : (
          // A second copy of one intent is a fault in the recorded results, so it is reported where it is seen and neither copy is hidden or merged; the fix belongs at the recording, not in this view.
          <Alert variant="destructive" data-slot="inbox-duplicate-intent">
            <AlertTitle>{DUPLICATE_DEFECT.title}</AlertTitle>
            <AlertDescription>
              <p>{DUPLICATE_DEFECT.lead}</p>
              <ul className="flex list-disc flex-col gap-1 ps-5">
                {duplicatedIntents.map((entry) => (
                  <li key={entry.intentId} className="min-w-0">
                    <bdi className="mono-identifier">{entry.intentId}</bdi>
                    {` — ${formatCount.format(entry.copies)} copies on this page`}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {body}
      </>
    );
  }
  return (
    <section data-slot="inbox-list" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={headingId} className="font-heading text-xl font-semibold text-pretty wrap-anywhere">
          {INBOX_HEADING}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty wrap-anywhere">{SURFACE_INTRO}</p>
      </div>
      {/* The simulation is disclosed on the surface that shows its effects, with the sentence the one shared label owns. */}
      <SimulationLabel effect={INBOX_SIMULATION_EFFECT} />
      <p className="max-w-prose text-sm text-muted-foreground text-pretty wrap-anywhere">{ONE_COPY_STATEMENT}</p>
      {content}
    </section>
  );
}
export default InboxList;
