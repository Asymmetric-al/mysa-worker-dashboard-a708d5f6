"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import SimulationLabel from "@/components/simulation-label";
import StateNotice from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, statusBadgeProps, VALUE_STATE_WORDS, type SendStatus, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { INBOX_EMPTY_COPY, INBOX_HEADING, INBOX_SIMULATION_EFFECT, ONE_COPY_STATEMENT } from "@/features/audience/copy/inbox";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { FIRST_PAGE, PAGE_SIZE_OPTIONS, offeredPageSize } from "@/lib/page-window";
import { sameScope, type Scope } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { useInbox, type InboxEnvelope } from "../hooks/use-audience-reads";
import MessageReader from "./message-reader";
type InboxMessage = InboxEnvelope["data"]["messages"][number];
type InboxPaging = { readonly page: number; readonly pageSize: number };
export type InboxListProps = {
  /** The exact authority this inbox is read under; the service re-derives scope from it on every read. */ readonly scope: Scope;
  /** The interface locale this surface formats its counts in, stated by the route that composes it. */ readonly locale: string;
  readonly initialEnvelope?: ReadResult<InboxEnvelope>;
  readonly className?: string;
};
const EMPTY_MESSAGES: readonly InboxMessage[] = [];
const COLUMNS = { sender: "Sender", subject: "Subject", audience: "Audience", language: "Language", noticeBody: "Notice body", intendedAt: "Intended at", recordedAt: "Recorded at", sendState: "Send outcome" } as const;
const CLOSE_LABEL = "Close";
const HONESTY_NOTE =
  "An outcome recorded as accepted states that this application took the submission. It is not a delivered message and not a read one. An outcome recorded as unknown says the acknowledgement never arrived rather than that the submission failed: it is checked against the same operation, which returns the result already recorded, and no control on this page repeats a submission under a new one.";
const ORDER_NOTE = "Messages are ordered by the instant the notice was intended, newest first, and then by message identity. " + "This read takes no ordering parameter, so no column is sortable and the order above the list is the order " + "the read applied.";
const STATE_HEADINGS = { loading: "Reading this inbox", unavailable: "The inbox could not be read", denied: "This inbox is not permitted here", refused: "The inbox request was not admitted", partialCoverage: "The source covers only part of the period this inbox records" } as const;
const BEYOND_LAST_PAGE = { title: "This page of the inbox holds no message", action: "Go to the last page" } as const;
const DUPLICATE_DEFECT = {
  title: "Two messages share one recipient and one notification intent",
  lead: "One intent must produce one message for one recipient, so this is a defect in the recorded send results rather than a second message to read. No copy here has been dropped, merged or hidden: both are shown as recorded, and the fix belongs where the results were recorded.",
} as const;
const UNRESOLVED_NOTE = { title: "Some intents produced no readable message", lead: "They are recorded for this recipient and could not be resolved into a message, so this inbox is incomplete rather than empty, and nothing is reconstructed in their place." } as const;
const READING_UNAVAILABLE = { title: "The edition this message points at cannot be rendered now", lead: "The message itself is shown as it was recorded. The edition it links to is not readable at this instant, so nothing of it is reproduced here and no cached copy stands in its place." } as const;
const AUDIENCE_DISPLAY: Readonly<Record<NonNullable<InboxMessage["audience"]>, { readonly label: string; readonly tone: StatusTone }>> = { public: { label: "Public", tone: "neutral" }, "approved-supporter": { label: "Approved supporters", tone: "info" } };
const NOTICE_BODY_DISPLAY: Readonly<Record<"protected" | "public", { readonly label: string; readonly tone: StatusTone }>> = { protected: { label: "Protected notice", tone: "caution" }, public: { label: "Public notice", tone: "neutral" } };
const SEND_STATE_ORDER: readonly SendStatus[] = ["accepted", "failed", "unknown"];
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
const columnOf = (id: string, header: string, cell: (message: InboxMessage) => ReactNode): RecordListColumnDef<InboxMessage> => ({ id, header, enableSorting: false, cell: (context) => cell(context.row.original) });
function usableSeed(seed: ReadResult<InboxEnvelope> | undefined, scope: Scope, paging: InboxPaging): ReadResult<InboxEnvelope> | undefined {
  if (seed === undefined) return undefined;
  if (seed.kind !== "envelope") return seed;
  if (!sameScope(seed.envelope.scope, scope)) return undefined;
  const stated = seed.envelope.data.page;
  return stated.page === paging.page && stated.pageSize === paging.pageSize ? seed : undefined;
}
export function InboxList({ scope, locale, initialEnvelope, className }: InboxListProps): ReactElement {
  const [headingId, readerHeadingId, readerRegionId] = [useId(), useId(), useId()];
  const readerRef = useRef<HTMLElement | null>(null);
  const openTriggerRef = useRef<HTMLButtonElement | null>(null);
  // The window the route's read answered with is the window this surface opens on, and the address owns it from then on: opening a message, reloading or returning from another screen reopens the page the reader left. The columns a worker shows are presentation only and stay in this component.
  const seededWindow = initialEnvelope !== undefined && initialEnvelope.kind === "envelope" ? initialEnvelope.envelope.data.page : undefined;
  const listWindow = useRecordListWindow({ page: seededWindow?.page ?? FIRST_PAGE, pageSize: offeredPageSize(seededWindow?.pageSize ?? 50) });
  const paging = useMemo<InboxPaging>(() => ({ page: listWindow.page, pageSize: offeredPageSize(listWindow.pageSize) }), [listWindow.page, listWindow.pageSize]);
  const setWindow = listWindow.setWindow;
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>({});
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const inbox = useInbox({ scope, query: { page: paging.page, pageSize: paging.pageSize } });
  const seed = useMemo(() => usableSeed(initialEnvelope, scope, paging), [initialEnvelope, scope, paging]);
  const read = inbox.data ?? seed;
  const messages = (read !== undefined && read.kind === "envelope" ? read : undefined)?.envelope.data?.messages ?? EMPTY_MESSAGES;
  const selectedMessage = selectedMessageId === null ? undefined : messages.find((message) => message.messageId === selectedMessageId);
  useEffect(() => {
    if (selectedMessageId === null) return;
    readerRef.current?.focus();
  }, [selectedMessageId]);
  const closeReader = useCallback((): void => {
    setSelectedMessageId(null);
    openTriggerRef.current?.focus();
  }, []);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState): void => {
      setColumnVisibility(next.columnVisibility);
      setWindow({ page: Math.max(FIRST_PAGE, next.page), pageSize: offeredPageSize(next.pageSize) }); // No column is sortable, so the ordering the preset reports is always empty; only the page window travels, in the address the read is driven from.
    },
    [setWindow],
  );
  const getRowId = useCallback((message: InboxMessage): string => message.messageId, []);
  const duplicatedIntents = useMemo<readonly { readonly intentId: string; readonly copies: number }[]>(() => {
    const copies = new Map<string, number>();
    for (const message of messages) copies.set(message.intentId, (copies.get(message.intentId) ?? 0) + 1);
    return [...copies].filter(([, count]) => count > 1).map(([intentId, count]) => ({ intentId, copies: count }));
  }, [messages]);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<InboxMessage>>>(
    () => [
      columnOf("sender", COLUMNS.sender, (message) => <bdi className="min-w-0 font-medium break-words">{message.sender}</bdi>),
      columnOf("subject", COLUMNS.subject, (message) => <bdi className="min-w-0 break-words">{message.subject}</bdi>),
      columnOf("audience", COLUMNS.audience, (message) => (message.audience === null ? <StatusBadge {...NOT_RECORDED} srPrefix={COLUMNS.audience} /> : <StatusBadge {...AUDIENCE_DISPLAY[message.audience]} srPrefix={COLUMNS.audience} />)),
      columnOf("language", COLUMNS.language, (message) => (message.locale === null ? <StatusBadge {...NOT_RECORDED} srPrefix={COLUMNS.language} /> : <bdi>{message.locale.tag}</bdi>)),
      columnOf("noticeBody", COLUMNS.noticeBody, (message) => <StatusBadge {...NOTICE_BODY_DISPLAY[message.protectedNotice ? "protected" : "public"]} srPrefix={COLUMNS.noticeBody} />),
      columnOf("intendedAt", COLUMNS.intendedAt, (message) => <bdi className="tabular-figures whitespace-nowrap">{message.intendedAt}</bdi>),
      columnOf("recordedAt", COLUMNS.recordedAt, (message) => <bdi className="tabular-figures whitespace-nowrap">{message.recordedAt}</bdi>),
      columnOf("sendState", COLUMNS.sendState, (message) => <StatusBadge {...statusBadgeProps(SEND_STATUS, message.state)} srPrefix={COLUMNS.sendState} />),
    ],
    [],
  );
  const rowActions = useCallback(
    (message: InboxMessage): ReactElement => {
      const isOpen = message.messageId === selectedMessageId;
      return (
        <Button type="button" variant={isOpen ? "secondary" : "ghost"} size="sm" aria-expanded={isOpen} aria-controls={isOpen ? readerRegionId : undefined} ref={isOpen ? openTriggerRef : undefined} onClick={() => setSelectedMessageId(isOpen ? null : message.messageId)} className="max-w-full whitespace-normal">
          {isOpen ? CLOSE_LABEL : "Open"}
          <span className="sr-only">{` the message “${message.subject}” from ${message.sender}`}</span>
        </Button>
      );
    },
    [selectedMessageId, readerRegionId],
  );
  const audienceLabel = selectedMessage === undefined || selectedMessage.audience === null ? NOT_RECORDED.label : AUDIENCE_DISPLAY[selectedMessage.audience].label;
  const audienceTone = selectedMessage === undefined || selectedMessage.audience === null ? NOT_RECORDED.tone : AUDIENCE_DISPLAY[selectedMessage.audience].tone;
  const reader =
    selectedMessage === undefined ? null : (
      <section id={readerRegionId} ref={readerRef} tabIndex={-1} aria-labelledby={readerHeadingId} data-slot="inbox-reader" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 {...{ id: readerHeadingId, className: "type-subsection-title text-pretty wrap-anywhere" }}>{"The message as it was produced for this recipient"}</h3>
          <Button type="button" variant="outline" size="sm" onClick={closeReader} className="max-w-full whitespace-normal">
            {CLOSE_LABEL}
            <span className="sr-only"> the message</span>
          </Button>
        </div>
        {selectedMessage.reading.state === "unavailable" ? (
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
          audienceLabel={audienceLabel}
          audienceTone={audienceTone}
          languageTag={selectedMessage.locale?.tag ?? ""}
          direction={selectedMessage.locale?.direction === "rtl" ? "rtl" : "ltr"}
          protected={selectedMessage.protectedNotice}
          html={selectedMessage.html}
          plainText={selectedMessage.plainText}
          noticeHref={selectedMessage.link}
          sendState={selectedMessage.state}
        />
      </section>
    );
  let content: ReactElement;
  if (read === undefined) {
    content = <StateNotice kind="loading" title={STATE_HEADINGS.loading} headingLevel={3} loadingLines={6} />;
  } else if (read.kind === "denied") {
    content = <StateNotice kind="denied" title={STATE_HEADINGS.denied} reasonCode={read.denied.reasonCode} headingLevel={3} />;
  } else if (read.kind === "unavailable") {
    content = <StateNotice kind="unavailable" title={STATE_HEADINGS.unavailable} description={read.unavailable.guidance} source={read.unavailable.source} retry={{ label: "Try again", onClick: (): void => void inbox.refetch() }} headingLevel={3} />;
  } else if (read.kind === "refused") {
    content = <StateNotice kind="refused" title={STATE_HEADINGS.refused} headingLevel={3} />;
  } else {
    const envelope = read.envelope;
    const data = envelope.data;
    const formatCount = countFormatOf(locale); // Every count below is the read's own, grouped in the interface locale the route states.
    const listState = { sort: [], page: data.page.page, pageSize: data.page.pageSize, columnVisibility };
    const beyondLastPageBody = `The result now holds ${formatCount.format(data.page.pageCount)} ${data.page.pageCount === 1 ? "page" : "pages"} of messages, so page ${formatCount.format(data.page.page)} holds none; no message was dropped, and the pager states where they are.`;
    const beyondLastPageAction = { label: BEYOND_LAST_PAGE.action, onClick: () => setWindow({ page: Math.max(FIRST_PAGE, data.page.pageCount), pageSize: paging.pageSize }) };
    const body =
      data.page.total === 0 ? (
        <StateNotice kind="empty" title={INBOX_EMPTY_COPY.title} description={INBOX_EMPTY_COPY.description} headingLevel={3} />
      ) : data.messages.length === 0 ? (
        <StateNotice kind="empty" title={BEYOND_LAST_PAGE.title} description={beyondLastPageBody} action={beyondLastPageAction} headingLevel={3} />
      ) : (
        <>
          <RecordList label={INBOX_HEADING} columns={columns} rows={data.messages} rowCount={data.page.total} queryState={listState} onQueryStateChange={handleQueryStateChange} getRowId={getRowId} rowActions={rowActions} itemNoun="message" locale={locale} pageSizeOptions={PAGE_SIZE_OPTIONS} />
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{ORDER_NOTE}</p>
          {reader}
        </>
      );
    content = (
      <>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-pretty wrap-anywhere">{data.page.total === 1 ? "One message has been produced for this membership." : `${formatCount.format(data.page.total)} messages have been produced for this membership.`}</p>
          <ul aria-label="Send outcomes recorded in this inbox" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            {SEND_STATE_ORDER.map((state) => (
              <li key={state} className="flex min-w-0 flex-wrap items-center gap-1.5">
                <StatusBadge {...statusBadgeProps(SEND_STATUS, state)} srPrefix={COLUMNS.sendState} />
                <span className="tabular-figures text-sm">{formatCount.format(data.sendStates[state])}</span>
              </li>
            ))}
          </ul>
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{HONESTY_NOTE}</p>
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">
            {`${"Read at"} `}
            <bdi className="tabular-figures">{envelope.asOf}</bdi>
            {` — ${"the scenario instant this inbox was evaluated at, so a message recorded after it does not appear here."}`}
          </p>
        </div>
        {envelope.coverage.state === "complete" ? null : <StateNotice kind="partial-coverage" title={STATE_HEADINGS.partialCoverage} coverage={envelope.coverage} headingLevel={3} />}
        {data.unresolvedIntents === 0 ? null : (
          <Alert role={undefined} data-slot="inbox-unresolved-intents">
            <AlertTitle>{UNRESOLVED_NOTE.title}</AlertTitle>
            <AlertDescription>
              <p>{`${formatCount.format(data.unresolvedIntents)} ${data.unresolvedIntents === 1 ? "intent" : "intents"} recorded for this recipient produced no message.`}</p>
              <p>{UNRESOLVED_NOTE.lead}</p>
            </AlertDescription>
          </Alert>
        )}
        {duplicatedIntents.length === 0 ? null : (
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
        <h2 {...{ id: headingId, className: "type-section-title text-pretty wrap-anywhere" }}>{INBOX_HEADING}</h2>
        <p className="max-w-prose type-supporting text-pretty wrap-anywhere">{"Every message this membership's notification purpose has produced, at the copy the recipient was pinned to: " + "the sender, the subject, the body as HTML and as plain text, and the outcome this application recorded for it."}</p>
      </div>
      <SimulationLabel effect={INBOX_SIMULATION_EFFECT} />
      <p className="max-w-prose type-supporting text-pretty wrap-anywhere">{ONE_COPY_STATEMENT}</p>
      {content}
    </section>
  );
}
export default InboxList;
