"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useId, useState, type ReactElement } from "react";
import { PaginationBar } from "@/components/pagination-bar";
import RecordDetail from "@/components/record-detail";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { ReadAction, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_COPY, INITIATIVE_STATE_COPY, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, RESPONSE_KIND_COPY, RESULTS_COPY, STATE_NOTICE_COPY, dispositionFallback, type ResponseKind } from "../copy";
import { useInitiative, type InitiativeReadWindow } from "../hooks/use-initiative";
import { invalidateInitiativeReads } from "../hooks/use-initiative-mutations";
import CloseInitiativeDialog from "./close-initiative-dialog";
import InitiativeHeader from "./initiative-header";
import InitiativeResults, { type InitiativeResultsProps } from "./initiative-results";
import ReopenInitiativeDialog from "./reopen-initiative-dialog";
import { TermFact } from "./figures";
import RequestComposer from "./request-composer";
import RequestPresentation from "./request-presentation";
import WorkingList, { type WorkingListProps } from "./working-list";
type InitiativeReadResult = Awaited<ReturnType<typeof reads.outreach.readInitiative>>;
type InitiativeEnvelope = Extract<InitiativeReadResult, { readonly kind: "envelope" }>["envelope"];
type InitiativeDetailData = InitiativeEnvelope["data"];
type InitiativeRow = InitiativeDetailData["initiative"];
type InitiativeTaskRow = InitiativeDetailData["nextWork"]["items"][number];
type InitiativeHistoryRow = InitiativeDetailData["history"][number];
type ReadRefusal = Exclude<InitiativeReadResult, { readonly kind: "envelope" }>;
const INITIATIVES_ROUTE = "/partners/initiatives";
const WORK_ROUTE = "/work";
const INITIATIVE_KIND_LABEL = "Initiative";
const RETRY_LABEL = "Try again";
const TAB_LIST_LABEL = "Initiative sections";
const FIRST_TAB = "overview";
const TAB_KEYS = ["overview", "working-list", "requests", "results", "history"] as const;
type TabKey = (typeof TAB_KEYS)[number];
const TAB_COPY: Readonly<Record<TabKey, { readonly label: string; readonly panel: string; readonly announced: string }>> = {
  overview: { label: "Overview", panel: "Overview of this initiative", announced: "Overview section selected" },
  "working-list": { label: INITIATIVE_COPY.membersHeading, panel: "The reviewed working list of this initiative", announced: "Working list section selected" },
  requests: { label: INITIATIVE_COPY.requestsHeading, panel: "The Requests recorded for this initiative", announced: "Requests section selected" },
  results: { label: RESULTS_COPY.heading, panel: "The results recorded for this initiative", announced: "Results section selected" },
  history: { label: INITIATIVE_COPY.historyHeading, panel: "The dated history of this initiative", announced: "History section selected" },
};
const BREADCRUMB = [{ label: INITIATIVE_COPY.listHeading, href: INITIATIVES_ROUTE }] as const;
const NEXT_WORK_LISTED_NOTE = "Only work this initiative still owns is listed: the tasks its read answered as open or reopened.";
const NEXT_WORK_OWNERSHIP_NOTE = "This initiative never completes, edits, reopens or cancels its work. Each task below is owned on the Work surface, and its link opens that surface.";
const WORK_LINK_SUFFIX = "opens the Work surface, where this task is owned";
const DUE_LABEL = "Due";
const PLANNED_LABEL = "Planned";
const NOT_RECORDED_WORD = "Not recorded";
const STATE_LABEL = "State";
const NEXT_WORK_EMPTY_TITLE = "Work this initiative owns";
const NEXT_WORK_EMPTY_BODY = "The read answers no open or reopened task for this initiative, so nothing is listed here. A task created with this initiative as its context appears on the Work surface first.";
const NEXT_WORK_EMPTY_ACTION = "Open Work";
/** The noun each paged list of this record states its window with, so a pager never says "items". */
const NEXT_WORK_ITEM_NOUN = "tasks";
const REQUESTS_ITEM_NOUN = "requests";
const REQUESTS_ORDER_NOTE = "Shown in the order the read supplied them — this initiative's Requests by their recorded identifier — so a Request keeps its place while its state changes.";
const DRAFT_REQUEST_LABEL = "Draft a Request";
const DRAFT_REQUEST_HIDE_LABEL = "Hide the draft form";
const DRAFT_REQUEST_ABSENT_BODY = "Drafting is not on offer in this read.";
const REQUESTS_EMPTY_TITLE = "No Request is recorded yet";
const REQUESTS_EMPTY_BODY = "A Request is one independently answerable invitation: who is asked, the organization that person represents, why, and the terms version they would answer. Answering it creates no gift, pledge, task or message of its own.";
const RESULTS_SECTION_TITLE = "How this initiative's Requests were answered";
const RESULTS_NOT_READ_BODY = "The results read was not part of the answer this page composed, so the counts it would state are unavailable here rather than empty or zero. Nothing stands in for them.";
const HISTORY_ORDER_NOTE = "Newest first: the read orders these entries by the time it recorded for each one.";
const HISTORY_EMPTY_TITLE = "No dated history is recorded";
const HISTORY_EMPTY_BODY = "Nothing is recorded for this initiative with a time attached — no working-list change and no recorded response. Closing or reopening is a state of the initiative itself, and the state above is the current one.";
const MEMBERSHIP_CHANGE_LABEL = "Working-list state recorded";
const RESPONSE_RECORDED_LABEL = "Response recorded";
const REASON_LABEL = "Reason";
const RECORDED_BY_LABEL = "Recorded by";
const RESPONDENT_LABEL = "Respondent";
const REQUEST_LABEL = "Request";
const NO_REASON_WORD = REQUESTED_TERMS_COPY.notStated;
const REFUSED_FALLBACK = STATE_NOTICE_COPY.refused.body;
type InitiativeResponseKind = Extract<InitiativeHistoryRow, { readonly kind: "request-response" }>["responseKind"];
const COPY_KIND_OF_RECORDED_KIND: Readonly<Record<InitiativeResponseKind, ResponseKind>> = { agreed: "agreed", conditional: "conditional", partial: "partial", deferred: "deferred", declined: "declined", unanswered: "unanswered", "needs-clarification": "needs clarification" };
const CANDIDATES_NOT_SUPPLIED: WorkingListProps["candidates"] = { state: "unavailable", source: { system: "page-composition", reference: "eligible-partner-candidates" } };
const admits = (actions: readonly ReadAction[], name: string): boolean => actions.some((action) => action.available && action.name === name);
const actionOf = (actions: readonly ReadAction[], name: string): ReadAction | undefined => actions.find((action) => action.name === name);
function refusalSummary(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields)
    .flat()
    .filter((message) => message.trim() !== "");
  return messages.length === 0 ? REFUSED_FALLBACK : messages.join(" ");
}
const tabOf = (value: string): TabKey => TAB_KEYS.find((candidate) => candidate === value) ?? FIRST_TAB;
const OWNED_WORK_STATE_WORDS: Readonly<Record<InitiativeTaskRow["status"], string>> = { open: "Open", reopened: "Reopened", completed: "Completed", cancelled: "Cancelled" };
const RecordedInstant = ({ value, className }: { readonly value: string; readonly className?: string }): ReactElement => (
  <bdi>
    <time {...{ className: cn("tabular-figures", className), dateTime: value }}>{value}</time>
  </bdi>
);
type PagedWindow = { readonly page: number; readonly pageSize: number; readonly total: number };
/** One paged window of this record: the page and size the service supplied, with the two changes that re-read them, so neither list restates the pager's own wiring. */
const WindowPager = ({ window, itemNoun, disabled, onPage, onPageSize }: { readonly window: PagedWindow; readonly itemNoun: string; readonly disabled: boolean; readonly onPage: (page: number) => void; readonly onPageSize: (pageSize: number) => void }): ReactElement => (
  <PaginationBar total={window.total} page={window.page} pageSize={window.pageSize} onPageChange={onPage} onPageSizeChange={onPageSize} itemNoun={itemNoun} disabled={disabled} />
);
function OwnedWorkRow({ task, valueStates }: { readonly task: InitiativeTaskRow; readonly valueStates: InitiativeEnvelope["valueStates"] }): ReactElement {
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <Link href={WORK_ROUTE} className="block min-w-0 py-0.5 text-sm font-medium text-pretty wrap-anywhere inline-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <bdi>{task.title}</bdi>
        <span className="sr-only">{` — ${WORK_LINK_SUFFIX}`}</span>
      </Link>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{OWNED_WORK_STATE_WORDS[task.status]}</span>
        <span className="flex min-w-0 items-baseline gap-x-1">
          <span>{`${DUE_LABEL}:`}</span>
          {task.dueOn !== null && valueStates[`${task.taskId}.dueOn`] !== "unknown" && task.dueOn !== null ? <RecordedInstant value={task.dueOn} /> : <span>{NOT_RECORDED_WORD}</span>}
        </span>
        {task.plannedTime === null ? null : (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
            <span>{`${PLANNED_LABEL}:`}</span>
            <bdi className="tabular-figures">{task.plannedTime}</bdi>
            {task.timeZone === null ? null : <bdi className="mono-identifier break-all">{task.timeZone}</bdi>}
          </span>
        )}
      </p>
    </li>
  );
}
type OverviewPanelProps = { readonly envelope: InitiativeEnvelope; readonly onRequestClose: () => void; readonly onRequestReopen: () => void; readonly onWindowChange: (change: InitiativeReadWindow) => void; readonly isFetching: boolean };
function OverviewPanel({ envelope, onRequestClose, onRequestReopen, onWindowChange, isFetching }: OverviewPanelProps): ReactElement {
  const { nextWork } = envelope.data;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <InitiativeHeader envelope={envelope} onRequestClose={onRequestClose} onRequestReopen={onRequestReopen} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="type-section-title text-pretty">{INITIATIVE_COPY.nextWorkHeading}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className="type-supporting text-pretty">{NEXT_WORK_LISTED_NOTE}</p>
          <p className="type-supporting text-pretty">{NEXT_WORK_OWNERSHIP_NOTE}</p>
          {nextWork.total === 0 ? (
            <StateNotice kind="empty" headingLevel={3} title={NEXT_WORK_EMPTY_TITLE} description={NEXT_WORK_EMPTY_BODY} action={{ label: NEXT_WORK_EMPTY_ACTION, href: WORK_ROUTE }} />
          ) : (
            <>
              <ul className="flex min-w-0 flex-col gap-2">
                {nextWork.items.map((task) => (
                  <OwnedWorkRow key={task.taskId} task={task} valueStates={envelope.valueStates} />
                ))}
              </ul>
              {/* The whole result this initiative owns, stated beside the page on show: the window belongs to the service, so a page change re-reads the initiative and no count is recomputed here. */}
              <WindowPager window={nextWork} itemNoun={NEXT_WORK_ITEM_NOUN} disabled={isFetching} onPage={(page) => onWindowChange({ nextWorkPage: page })} onPageSize={(pageSize) => onWindowChange({ nextWorkPageSize: pageSize })} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
type RequestsPanelProps = { readonly initiativeId: string; readonly envelope: InitiativeEnvelope; readonly onChanged: () => void; readonly onWindowChange: (change: InitiativeReadWindow) => void; readonly isFetching: boolean };
function RequestsPanel({ initiativeId, envelope, onChanged, onWindowChange, isFetching }: RequestsPanelProps): ReactElement {
  const requests = envelope.data.requests;
  const draftAction = actionOf(envelope.actions, "draftRequest");
  const draftAdmitted = draftAction !== undefined && draftAction.available;
  const [composerOpen, setComposerOpen] = useState(false);
  const composerRegionId = useId();
  const openComposer = useCallback((): void => setComposerOpen(true), []);
  const toggleComposer = useCallback((): void => setComposerOpen((open) => !open), []);
  const draftWithheldReason = draftAction === undefined ? DRAFT_REQUEST_ABSENT_BODY : (draftAction.reason ?? DRAFT_REQUEST_ABSENT_BODY);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="type-section-title text-pretty">{INITIATIVE_COPY.requestsHeading}</h2>
      <p className="type-supporting text-pretty">{REQUESTS_ORDER_NOTE}</p>
      {draftAdmitted ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <Button {...{ type: "button", variant: "outline", "aria-expanded": composerOpen, "aria-controls": composerRegionId, onClick: toggleComposer }}>{composerOpen ? DRAFT_REQUEST_HIDE_LABEL : DRAFT_REQUEST_LABEL}</Button>
          </div>
          <div id={composerRegionId} hidden={!composerOpen} className="min-w-0">
            <RequestComposer initiativeId={initiativeId} envelope={envelope} onDrafted={onChanged} onCheckResult={onChanged} headingLevel={3} />
          </div>
        </div>
      ) : (
        <Alert>
          <AlertDescription>{draftWithheldReason}</AlertDescription>
        </Alert>
      )}
      <Separator />
      {requests.total === 0 ? (
        <StateNotice kind="empty" headingLevel={3} title={REQUESTS_EMPTY_TITLE} description={REQUESTS_EMPTY_BODY} action={draftAdmitted ? { label: DRAFT_REQUEST_LABEL, onClick: openComposer } : { label: INITIATIVE_COPY.listHeading, href: INITIATIVES_ROUTE }} />
      ) : (
        <>
          <ul className="flex min-w-0 flex-col gap-4">
            {requests.items.map((request) => (
              <li key={request.requestId} className="min-w-0 border-b border-border pb-4 last:border-b-0 last:pb-0">
                <RequestPresentation initiativeId={initiativeId} request={request} envelope={envelope} onRecorded={onChanged} onCheckResult={onChanged} headingLevel={3} />
              </li>
            ))}
          </ul>
          {/* The whole result this initiative recorded, stated beside the page on show: the window belongs to the service, so a page change re-reads the initiative and no count is recomputed here. */}
          <WindowPager window={requests} itemNoun={REQUESTS_ITEM_NOUN} disabled={isFetching} onPage={(page) => onWindowChange({ requestsPage: page })} onPageSize={(pageSize) => onWindowChange({ requestsPageSize: pageSize })} />
        </>
      )}
    </div>
  );
}
type ResultsPanelProps = { readonly initiativeId: string; readonly resultsEnvelope: NonNullable<InitiativeResultsProps["initialEnvelope"]> | undefined };
const ResultsPanel = ({ initiativeId, resultsEnvelope }: ResultsPanelProps): ReactElement => (
  <div className="flex min-w-0 flex-col gap-4">
    <h2 className="type-section-title text-pretty">{RESULTS_SECTION_TITLE}</h2>
    {resultsEnvelope === undefined ? <StateNotice kind="unavailable" headingLevel={3} title={STATE_NOTICE_COPY.unavailable.title} description={RESULTS_NOT_READ_BODY} /> : <InitiativeResults initiativeId={initiativeId} initialEnvelope={resultsEnvelope} />}
  </div>
);
/** What one history entry recorded, in the closed vocabulary of its kind: a new kind is a compile error rather than a silently worded entry. */
const historySentenceOf = (entry: InitiativeHistoryRow): string => {
  if (entry.kind === "member-state") return `${MEMBERSHIP_CHANGE_LABEL}: ${MEMBERSHIP_STATE_COPY[entry.state].label}`;
  if (entry.kind === "request-response") return `${RESPONSE_RECORDED_LABEL}: ${RESPONSE_KIND_COPY[COPY_KIND_OF_RECORDED_KIND[entry.responseKind]].label}`;
  return assertNever(entry, "Unexpected initiative history entry");
};
/** One dated history entry: the instant it was recorded, the sentence that says what happened, and the facts the read states with it. */
const HistoryEntry = ({ entry }: { readonly entry: InitiativeHistoryRow }): ReactElement => (
  <li className="flex min-w-0 flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0">
    <RecordedInstant value={entry.at} className="text-sm" />
    <p className="type-body text-pretty">{historySentenceOf(entry)}</p>
    <dl className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {entry.kind === "member-state" ? (
        <>
          <TermFact term={REASON_LABEL} value={entry.reason === null ? NO_REASON_WORD : <bdi>{entry.reason}</bdi>} />
          <TermFact term={RECORDED_BY_LABEL} value={<bdi className="mono-identifier break-all">{entry.byPrincipalId}</bdi>} />
        </>
      ) : (
        <>
          <TermFact term={REQUEST_LABEL} value={<bdi className="mono-identifier break-all">{entry.requestId}</bdi>} />
          <TermFact term={REQUESTED_TERMS_COPY.versionLabel} value={<bdi className="mono-identifier break-all">{entry.termsVersionRef}</bdi>} />
          <TermFact term={RESPONDENT_LABEL} value={<bdi className="mono-identifier break-all">{entry.respondentId}</bdi>} />
        </>
      )}
    </dl>
  </li>
);
function HistoryPanel({ envelope }: { readonly envelope: InitiativeEnvelope }): ReactElement {
  const { initiative, history } = envelope.data;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="type-section-title text-pretty">{INITIATIVE_COPY.historyHeading}</h2>
      {initiative.state === "closed" || initiative.closureDisposition !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 className="type-subsection-title text-pretty">{CLOSURE_COPY.closeHeading}</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-2">
            <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <TermFact term={STATE_LABEL} value={INITIATIVE_STATE_COPY[initiative.state].label} />
              <TermFact term={CLOSURE_COPY.dispositionLabel} value={initiative.closureDisposition === null ? NOT_RECORDED_WORD : <bdi>{dispositionFallback(initiative.closureDisposition)}</bdi>} />
            </dl>
            <p className="text-xs text-pretty text-muted-foreground">{INITIATIVE_STATE_COPY[initiative.state].description}</p>
            {initiative.lifecycle === "reopened" ? <p className="type-supporting text-pretty">{CLOSURE_COPY.historyPreservedNote}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <p className="type-supporting text-pretty">{HISTORY_ORDER_NOTE}</p>
      {history.length === 0 ? (
        <StateNotice kind="empty" headingLevel={3} title={HISTORY_EMPTY_TITLE} description={HISTORY_EMPTY_BODY} />
      ) : (
        <ol className="flex min-w-0 flex-col gap-2">
          {history.map((entry, index) => (
            <HistoryEntry key={`${entry.kind}-${entry.at}-${index}`} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
}
function RefusalNotice({ refusal, onRetry }: { readonly refusal: ReadRefusal; readonly onRetry: () => void }): ReactElement {
  switch (refusal.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={1} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={refusal.denied.reasonCode} action={{ label: INITIATIVE_COPY.listHeading, href: INITIATIVES_ROUTE }} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={1} title={STATE_NOTICE_COPY.unavailable.title} description={refusal.unavailable.guidance} source={refusal.unavailable.source} retry={{ label: RETRY_LABEL, onClick: onRetry }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={1} title={STATE_NOTICE_COPY.refused.title} description={refusalSummary(refusal.refused.fields)} />;
  }
}
export type InitiativeDetailProps = { readonly envelope: InitiativeEnvelope; readonly candidates?: WorkingListProps["candidates"]; readonly resultsEnvelope?: NonNullable<InitiativeResultsProps["initialEnvelope"]>; readonly className?: string };
/** One initiative's detail surface: its header and the overview, working-list, Requests, results and history tabs. */
export default function InitiativeDetail({ envelope, candidates, resultsEnvelope, className }: InitiativeDetailProps): ReactElement {
  const initiativeId = envelope.data.initiative.initiativeId;
  const [tab, setTab] = useState<TabKey>(FIRST_TAB);
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const queryClient = useQueryClient();
  // The window each paged list of this record is read with, seeded from the window the server's own answer states: each list keeps its own page, so paging the Requests leaves the working list and the owned work where the reader left them, and the window is the read's own parameter rather than a slice of an answer held here.
  const seededWindow: InitiativeReadWindow = { page: envelope.data.workingList.page, pageSize: envelope.data.workingList.pageSize, requestsPage: envelope.data.requests.page, requestsPageSize: envelope.data.requests.pageSize, nextWorkPage: envelope.data.nextWork.page, nextWorkPageSize: envelope.data.nextWork.pageSize };
  const [listWindow, setListWindow] = useState<InitiativeReadWindow>(() => ({ ...seededWindow }));
  const changeWindow = useCallback((change: InitiativeReadWindow): void => setListWindow((held) => ({ ...held, ...change })), []);
  const reread = useCallback((): void => void invalidateInitiativeReads(queryClient, envelope.scope), [queryClient, envelope.scope]);
  const query = useInitiative<InitiativeDetailData>(initiativeId, envelope, listWindow, seededWindow); // The same two windows are what the server's envelope was read under, so they are also the only key that envelope may seed: another page is a request, not a re-window of the answer already held.
  const handleTabChange = useCallback((next: unknown): void => setTab(tabOf(String(next))), []);
  const result = query.status === "ready" ? query.result : undefined;
  const refusal: ReadRefusal | undefined = result !== undefined && result.kind !== "envelope" ? result : undefined;
  const current: InitiativeEnvelope = result !== undefined && result.kind === "envelope" ? result.envelope : envelope;
  if (refusal !== undefined) {
    return (
      <div data-slot="initiative-detail" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
        <RefusalNotice refusal={refusal} onRetry={reread} />
      </div>
    );
  }
  const initiative: InitiativeRow = current.data.initiative;
  const identity = { displayName: initiative.name, secondaryName: initiative.purpose, kind: INITIATIVE_KIND_LABEL, reference: { system: current.source.system, reference: initiativeId } };
  const status = <Badge variant={initiative.state === "closed" ? "outline" : "secondary"}>{INITIATIVE_STATE_COPY[initiative.state].label}</Badge>;
  const closeAdmitted = admits(current.actions, "closeInitiative");
  const reopenAdmitted = admits(current.actions, "reopenInitiative");
  return (
    <div data-slot="initiative-detail" data-initiative-state={initiative.state} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <RecordDetail {...{ layout: "page", identity, status, breadcrumb: BREADCRUMB }} />
      <Tabs value={tab} onValueChange={handleTabChange} className="min-w-0 gap-3">
        <TabsList aria-label={TAB_LIST_LABEL} activateOnFocus className="h-auto w-full max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key} className="h-8 flex-none">
              {TAB_COPY[key].label}
            </TabsTrigger>
          ))}
        </TabsList>
        <output className="sr-only">{TAB_COPY[tab].announced}</output>
        <TabsContent value="overview" aria-label={TAB_COPY.overview.panel} className="min-w-0">
          <OverviewPanel envelope={current} onRequestClose={() => setDialog("close")} onRequestReopen={() => setDialog("reopen")} onWindowChange={changeWindow} isFetching={query.isFetching} />
        </TabsContent>
        <TabsContent value="working-list" aria-label={TAB_COPY["working-list"].panel} className="min-w-0">
          <WorkingList initiativeId={initiativeId} envelope={current} candidates={candidates ?? CANDIDATES_NOT_SUPPLIED} onChanged={reread} readWindow={listWindow} onWindowChange={changeWindow} headingLevel={2} />
        </TabsContent>
        <TabsContent value="requests" aria-label={TAB_COPY.requests.panel} className="min-w-0">
          <RequestsPanel initiativeId={initiativeId} envelope={current} onChanged={reread} onWindowChange={changeWindow} isFetching={query.isFetching} />
        </TabsContent>
        <TabsContent value="results" aria-label={TAB_COPY.results.panel} className="min-w-0">
          <ResultsPanel initiativeId={initiativeId} resultsEnvelope={resultsEnvelope} />
        </TabsContent>
        <TabsContent value="history" aria-label={TAB_COPY.history.panel} className="min-w-0">
          <HistoryPanel envelope={current} />
        </TabsContent>
      </Tabs>
      {closeAdmitted ? <CloseInitiativeDialog open={dialog === "close"} onOpenChange={(open) => setDialog(open ? "close" : null)} initiativeId={initiativeId} envelope={current} onClosed={reread} onCheckResult={reread} /> : null}
      {reopenAdmitted ? <ReopenInitiativeDialog open={dialog === "reopen"} onOpenChange={(open) => setDialog(open ? "reopen" : null)} initiativeId={initiativeId} envelope={current} onReopened={reread} /> : null}
    </div>
  );
}
