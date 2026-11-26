"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import SimulationLabel from "@/components/simulation-label";
import StateNotice from "@/components/state-notice";
import StatusBadge, { SEND_STATUS, statusBadgeProps, VALUE_STATE_WORDS, type SendStatus, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Kbd } from "@/components/ui/kbd";
import { ResizableSplitPane } from "@/components/ui/resizable";
import { INBOX_EMPTY_COPY, INBOX_HEADING, INBOX_SIMULATION_EFFECT, ONE_COPY_STATEMENT } from "@/features/audience/copy/inbox";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { FIRST_PAGE, PAGE_SIZE_OPTIONS, offeredPageSize } from "@/lib/page-window";
import { useShortcut } from "@/lib/ui-sdk";
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
const COLUMNS = { sender: "Sender", subject: "Subject", audience: "Audience", language: "Language", noticeBody: "Privacy", intendedAt: "Sent at", recordedAt: "Recorded at", sendState: "Status" } as const;
const CLOSE_LABEL = "Close";
const HONESTY_NOTE = "Accepted means the simulated email was queued — not that it was delivered or read. Unknown outcomes should be refreshed rather than sent twice.";
const ORDER_NOTE = "Ordered newest first.";
const STATE_HEADINGS = { loading: "Loading Test inbox…", unavailable: "Couldn’t load Test inbox", denied: "Test inbox isn’t available in this session", refused: "Couldn’t open Test inbox", partialCoverage: "Partial inbox coverage" } as const;
const BEYOND_LAST_PAGE = { title: "No messages on this page", action: "Go to last page" } as const;
const DUPLICATE_DEFECT = {
  title: "Duplicate messages detected for one send",
  lead: "Each notification should produce at most one message per recipient. Both copies are shown transparently below.",
} as const;
const UNRESOLVED_NOTE = { title: "Some notifications couldn’t be displayed", lead: "Those notifications were recorded for this subscriber but couldn’t be rendered as messages." } as const;
const READING_UNAVAILABLE = { title: "Linked update isn’t available right now", lead: "The email preview is shown as recorded, though the update it links to can’t be loaded right now." } as const;
const AUDIENCE_DISPLAY: Readonly<Record<NonNullable<InboxMessage["audience"]>, { readonly label: string; readonly tone: StatusTone }>> = { public: { label: "Public", tone: "neutral" }, "approved-supporter": { label: "Approved supporters", tone: "info" } };
const NOTICE_BODY_DISPLAY: Readonly<Record<"protected" | "public", { readonly label: string; readonly tone: StatusTone }>> = { protected: { label: "Protected notice", tone: "caution" }, public: { label: "Public notice", tone: "neutral" } };
const SEND_STATE_ORDER: readonly SendStatus[] = ["accepted", "failed", "unknown"];
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
function senderInitials(sender: string): string {
  const words = sender
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase() || "?";
}
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
  const stepMessage = useCallback(
    (delta: 1 | -1): void => {
      if (messages.length === 0) return;
      const currentIndex = selectedMessageId === null ? -1 : messages.findIndex((item) => item.messageId === selectedMessageId);
      const nextIndex = currentIndex === -1 ? (delta > 0 ? 0 : messages.length - 1) : Math.min(messages.length - 1, Math.max(0, currentIndex + delta));
      const nextMessage = messages[nextIndex];
      if (nextMessage !== undefined) setSelectedMessageId(nextMessage.messageId);
    },
    [messages, selectedMessageId],
  );
  useShortcut("j", () => stepMessage(1));
  useShortcut("k", () => stepMessage(-1));
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
      columnOf("sender", COLUMNS.sender, (message) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar size="sm" aria-hidden="true" className="shrink-0 ring-1 ring-border/80">
            <AvatarFallback className="bg-surface-subtle text-xs font-medium text-foreground">{senderInitials(message.sender)}</AvatarFallback>
          </Avatar>
          <bdi className="min-w-0 font-medium break-words">{message.sender}</bdi>
        </span>
      )),
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
          <h3 {...{ id: readerHeadingId, className: "type-subsection-title text-pretty wrap-anywhere" }}>{"Email preview"}</h3>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Kbd>j</Kbd>
              <span>/</span>
              <Kbd>k</Kbd>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={closeReader} className="max-w-full whitespace-normal">
              {CLOSE_LABEL}
              <span className="sr-only"> the message</span>
            </Button>
          </div>
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
      ) : reader === null ? (
        <>
          <RecordList label={INBOX_HEADING} columns={columns} rows={data.messages} rowCount={data.page.total} queryState={listState} onQueryStateChange={handleQueryStateChange} getRowId={getRowId} initialPinnedColumns={{ start: ["sender"] }} rowActions={rowActions} itemNoun="message" locale={locale} pageSizeOptions={PAGE_SIZE_OPTIONS} />
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{ORDER_NOTE}</p>
        </>
      ) : (
        <ResizableSplitPane
          defaultRatio={54}
          minRatio={35}
          maxRatio={72}
          handleLabel="Resize inbox list and message reader"
          start={
            <div className="flex min-w-0 flex-col gap-3">
              <RecordList label={INBOX_HEADING} columns={columns} rows={data.messages} rowCount={data.page.total} queryState={listState} onQueryStateChange={handleQueryStateChange} getRowId={getRowId} initialPinnedColumns={{ start: ["sender"] }} rowActions={rowActions} itemNoun="message" locale={locale} pageSizeOptions={PAGE_SIZE_OPTIONS} />
              <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{ORDER_NOTE}</p>
            </div>
          }
          end={reader}
        />
      );
    content = (
      <>
        <Frame spacing="sm">
          <FramePanel className="flex min-w-0 flex-col gap-3">
            <p className="text-sm font-medium text-pretty wrap-anywhere">{data.page.total === 1 ? "1 simulated email" : `${formatCount.format(data.page.total)} simulated emails`}</p>
            <ul aria-label="Send statuses" className="grid min-w-0 gap-2.5 @xl/main:grid-cols-3">
              {SEND_STATE_ORDER.map((state) => (
                <li key={state} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface-subtle px-3 py-2.5">
                  <StatusBadge {...statusBadgeProps(SEND_STATUS, state)} srPrefix={COLUMNS.sendState} />
                  <span className="tabular-figures text-base font-semibold text-foreground">{formatCount.format(data.sendStates[state])}</span>
                </li>
              ))}
            </ul>
            <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{HONESTY_NOTE}</p>
            <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">
              {`${"Updated"} `}
              <bdi className="tabular-figures">{envelope.asOf}</bdi>
            </p>
          </FramePanel>
        </Frame>
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
        <p className="max-w-prose type-supporting text-pretty wrap-anywhere">{"Simulated update emails produced for this subscriber, with both HTML and plain-text previews."}</p>
      </div>
      <SimulationLabel effect={INBOX_SIMULATION_EFFECT} />
      <p className="max-w-prose type-supporting text-pretty wrap-anywhere">{ONE_COPY_STATEMENT}</p>
      {content}
    </section>
  );
}
export default InboxList;
