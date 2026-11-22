"use client";
/**
 * The one initiative detail body: the initiative's identity and current state, the work it still owns,
 * its reviewed working list, the Requests it has recorded, the results those Requests are measured
 * against, and the dated history the read supplied.
 *
 * **Every value here is the envelope's own.** The read states each figure with the base it is measured
 * against, resolves every date, and orders every list, so nothing below counts, averages, converts a
 * zone, re-sorts by a date or derives a rate. A fact the read does not carry is shown as not carried —
 * never as a zero, never as an empty list, never filled in from a neighbouring value.
 *
 * **Why the five sections sit beside the shared detail body rather than inside it.** The application has
 * one record detail body (`@/components/record-detail`), and it renders a fixed set of record sections
 * with no free content area. This family's sections therefore follow that body in the same column,
 * rather than a second detail body being built to hold them.
 *
 * **Disclosure.** The tab strip is the only disclosure on this surface: the design system admits one
 * disclosure primitive and it is the tab. The single draft form below is revealed by a button and stays
 * mounted while hidden, so a worker's typed values are never discarded between presses (WCAG 3.3.7).
 */
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useId, useState, type ReactElement, type ReactNode } from "react";
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
import { useInitiative } from "../hooks/use-initiative";
import { invalidateInitiativeReads } from "../hooks/use-initiative-mutations";
import CloseInitiativeDialog from "./close-initiative-dialog";
import InitiativeHeader from "./initiative-header";
import InitiativeResults, { type InitiativeResultsProps } from "./initiative-results";
import ReopenInitiativeDialog from "./reopen-initiative-dialog";
import RequestComposer from "./request-composer";
import RequestPresentation from "./request-presentation";
import WorkingList, { type WorkingListProps } from "./working-list";

// The contract: the detail read's own signature, so a member that moves reaches this file as a compile
// error rather than as a second statement of the shape the service answers with.
type InitiativeReadResult = Awaited<ReturnType<typeof reads.outreach.readInitiative>>;

type InitiativeEnvelope = Extract<InitiativeReadResult, { readonly kind: "envelope" }>["envelope"];

type InitiativeDetailData = InitiativeEnvelope["data"];

type InitiativeRow = InitiativeDetailData["initiative"];

type InitiativeTaskRow = InitiativeDetailData["nextWork"]["items"][number];

type InitiativeHistoryRow = InitiativeDetailData["history"][number];

/** The read's own refusal, which carries no record: not a denial, an outage and a bad request are three different answers. */
type ReadRefusal = Exclude<InitiativeReadResult, { readonly kind: "envelope" }>;

// The addresses this surface links to: one list to return to, and the one Work surface that owns every
// task named here. Both are the shell's own destinations, so a body opened by direct link still has a way
// back and a way onward.
const INITIATIVES_ROUTE = "/partners/initiatives";

const WORK_ROUTE = "/work";

/** The record kind the shared detail body prints under the initiative's name. */
const INITIATIVE_KIND_LABEL = "Initiative";

const RETRY_LABEL = "Try again";

/** The label the tab strip carries, so the strip is a named landmark rather than an unlabelled control group. */
const TAB_LIST_LABEL = "Initiative sections";

const FIRST_TAB = "overview";

const TAB_KEYS = ["overview", "working-list", "requests", "results", "history"] as const;

type TabKey = (typeof TAB_KEYS)[number];

/** Each section's tab word, the name its panel carries on its own, and the sentence a change of section announces. */
const TAB_COPY: Readonly<Record<TabKey, { readonly label: string; readonly panel: string; readonly announced: string }>> = {
  overview: { label: "Overview", panel: "Overview of this initiative", announced: "Overview section selected" },
  "working-list": { label: INITIATIVE_COPY.membersHeading, panel: "The reviewed working list of this initiative", announced: "Working list section selected" },
  requests: { label: INITIATIVE_COPY.requestsHeading, panel: "The Requests recorded for this initiative", announced: "Requests section selected" },
  results: { label: RESULTS_COPY.heading, panel: "The results recorded for this initiative", announced: "Results section selected" },
  history: { label: INITIATIVE_COPY.historyHeading, panel: "The dated history of this initiative", announced: "History section selected" },
};

/** Where the worker returns to; the list context is the one the shell's own navigation links to. */
const BREADCRUMB = [{ label: INITIATIVE_COPY.listHeading, href: INITIATIVES_ROUTE }] as const;

// Owned work. The read answers this initiative's open and reopened tasks and nothing else, so the section
// says exactly that instead of implying a count it did not receive.
const NEXT_WORK_LISTED_NOTE = "Only work this initiative still owns is listed: the tasks its read answered as open or reopened.";

const NEXT_WORK_OWNERSHIP_NOTE = "This initiative never completes, edits, reopens or cancels its work. Each task below is owned on the Work surface, and its link opens that surface.";

const WORK_LINK_SUFFIX = "opens the Work surface, where this task is owned";

const DUE_LABEL = "Due";

const PLANNED_LABEL = "Planned";

const NOT_RECORDED_WORD = "Not recorded";

/** The record's own state, named where the history states the initiative's closure record. */
const STATE_LABEL = "State";

const NEXT_WORK_EMPTY_TITLE = "Work this initiative owns";
const NEXT_WORK_EMPTY_BODY = "The read answers no open or reopened task for this initiative, so nothing is listed here. A task created with this initiative as its context appears on the Work surface first.";
const NEXT_WORK_EMPTY_ACTION = "Open Work";

// Requests. The order is the read's, stated rather than re-derived: a Request keeps its place as its
// state changes, so nothing shifts under the reader's attention between visits.
const REQUESTS_ORDER_NOTE = "Shown in the order the read supplied them — this initiative's Requests by their recorded identifier — so a Request keeps its place while its state changes.";

const DRAFT_REQUEST_LABEL = "Draft a Request";
const DRAFT_REQUEST_HIDE_LABEL = "Hide the draft form";
const DRAFT_REQUEST_ABSENT_BODY = "Drafting is not on offer in this read.";
const REQUESTS_EMPTY_TITLE = "No Request is recorded yet";
const REQUESTS_EMPTY_BODY = "A Request is one independently answerable invitation: who is asked, the organization that person represents, why, and the terms version they would answer. Answering it creates no gift, pledge, task or message of its own.";

// Results. The results surface states each count over its own base, so this section only frames it.
const RESULTS_SECTION_TITLE = "How this initiative's Requests were answered";
const RESULTS_NOT_READ_BODY = "The results read was not part of the answer this page composed, so the counts it would state are unavailable here rather than empty or zero. Nothing stands in for them.";

// History. Every entry below carries the time the read recorded for it, printed exactly as supplied.
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

/**
 * The read stores this one answer hyphenated (`needs-clarification`) while this family names it for
 * readers with a space, so the stored word is joined to the family's own name for it before any wording is
 * read — one exhaustive map rather than a second copy of the seven names.
 */
const COPY_KIND_OF_RECORDED_KIND: Readonly<Record<InitiativeResponseKind, ResponseKind>> = { agreed: "agreed", conditional: "conditional", partial: "partial", deferred: "deferred", declined: "declined", unanswered: "unanswered", "needs-clarification": "needs clarification" };

/**
 * The candidate set this surface shows when the composing page supplied none. The eligible-partner read
 * belongs to the page's own composition and the detail envelope does not carry it, so the picker states
 * that it has no answer rather than offering an empty set or a count of zero it never received.
 */
const CANDIDATES_NOT_SUPPLIED: WorkingListProps["candidates"] = { state: "unavailable", source: { system: "page-composition", reference: "eligible-partner-candidates" } };

/** Whether the read offers one named action. An absent entry is not a refusal, so it is never treated as permission either. */
function admits(actions: readonly ReadAction[], name: string): boolean {
  return actions.some((action) => action.available && action.name === name);
}

/** The read's entry for one named action, so its own reason can be stated where the action is absent or unavailable. */
function actionOf(actions: readonly ReadAction[], name: string): ReadAction | undefined {
  return actions.find((action) => action.name === name);
}

/** The one sentence a field-keyed refusal is summarised with: the messages the read raised, in the order it raised them. */
function refusalSummary(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields)
    .flat()
    .filter((message) => message.trim() !== "");
  return messages.length === 0 ? REFUSED_FALLBACK : messages.join(" ");
}

/** The tab a value names, defaulting to the first section rather than to no section at all. */
function tabOf(value: string): TabKey {
  const match = TAB_KEYS.find((candidate) => candidate === value);
  return match ?? FIRST_TAB;
}

/** The word a task's recorded state carries here. Local to this file because a feature may not import another feature's vocabulary, and the read's own four states must still read as words rather than as tokens. */
function ownedWorkStateWord(status: InitiativeTaskRow["status"]): string {
  switch (status) {
    case "open":
      return "Open";
    case "reopened":
      return "Reopened";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return assertNever(status, "Unexpected task state");
  }
}

/** One labelled fact of a fact list. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-1 break-words">{children}</dd>
    </div>
  );
}

/**
 * One instant exactly as the read supplied it. It is printed, never parsed or reformatted, and it is
 * isolated because a date-time is weak-direction text that must not reorder the runs around it.
 */
function RecordedInstant({ value, className }: { readonly value: string; readonly className?: string }): ReactElement {
  return (
    <bdi>
      <time className={cn("tabular-figures", className)} dateTime={value}>
        {value}
      </time>
    </bdi>
  );
}

/** One piece of work this initiative still owns, as a link to the surface that owns it. Nothing here changes a task. */
function OwnedWorkRow({ task, valueStates }: { readonly task: InitiativeTaskRow; readonly valueStates: InitiativeEnvelope["valueStates"] }): ReactElement {
  const dueState = valueStates[`${task.taskId}.dueOn`];
  const dueRecorded = task.dueOn !== null && dueState !== "unknown";
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <Link href={WORK_ROUTE} className="block min-w-0 py-0.5 text-sm font-medium text-pretty wrap-anywhere underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <bdi>{task.title}</bdi>
        <span className="sr-only">{` — ${WORK_LINK_SUFFIX}`}</span>
      </Link>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{ownedWorkStateWord(task.status)}</span>
        <span className="flex min-w-0 items-baseline gap-x-1">
          <span>{`${DUE_LABEL}:`}</span>
          {dueRecorded && task.dueOn !== null ? <RecordedInstant value={task.dueOn} /> : <span>{NOT_RECORDED_WORD}</span>}
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

interface OverviewPanelProps {
  readonly envelope: InitiativeEnvelope;
  readonly onRequestClose: () => void;
  readonly onRequestReopen: () => void;
}

/**
 * The overview: the initiative's identity, accountable person, period, state, disposition and membership
 * counts from the family's own header, then the work it still owns — read-only, and stated as owned
 * elsewhere so this surface never implies it can finish a task.
 */
function OverviewPanel({ envelope, onRequestClose, onRequestReopen }: OverviewPanelProps): ReactElement {
  const { nextWork } = envelope.data;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <InitiativeHeader envelope={envelope} onRequestClose={onRequestClose} onRequestReopen={onRequestReopen} />
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-base font-medium text-pretty">{INITIATIVE_COPY.nextWorkHeading}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-pretty text-muted-foreground">{NEXT_WORK_LISTED_NOTE}</p>
          <p className="text-sm text-pretty text-muted-foreground">{NEXT_WORK_OWNERSHIP_NOTE}</p>
          {nextWork.items.length === 0 ? (
            <StateNotice kind="empty" headingLevel={3} title={NEXT_WORK_EMPTY_TITLE} description={NEXT_WORK_EMPTY_BODY} action={{ label: NEXT_WORK_EMPTY_ACTION, href: WORK_ROUTE }} />
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {nextWork.items.map((task) => (
                <OwnedWorkRow key={task.taskId} task={task} valueStates={envelope.valueStates} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface RequestsPanelProps {
  readonly initiativeId: string;
  readonly envelope: InitiativeEnvelope;
  readonly onChanged: () => void;
}

/**
 * The Requests this initiative has recorded, each answered on its own: every row is the family's own
 * Request surface, which owns the presentation record, the requested terms and the response bound to the
 * terms version it answers. The draft form is offered only where the read admits drafting, and where it
 * does not, the read's own reason is stated instead of a control that could only fail.
 */
function RequestsPanel({ initiativeId, envelope, onChanged }: RequestsPanelProps): ReactElement {
  const requests = envelope.data.requests.items;
  const draftAction = actionOf(envelope.actions, "draftRequest");
  const draftAdmitted = draftAction !== undefined && draftAction.available;
  const [composerOpen, setComposerOpen] = useState(false);
  const composerRegionId = useId();
  const openComposer = useCallback((): void => {
    setComposerOpen(true);
  }, []);
  const toggleComposer = useCallback((): void => {
    setComposerOpen((open) => !open);
  }, []);
  const draftWithheldReason = draftAction === undefined ? DRAFT_REQUEST_ABSENT_BODY : (draftAction.reason ?? DRAFT_REQUEST_ABSENT_BODY);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="font-heading text-base font-medium text-pretty">{INITIATIVE_COPY.requestsHeading}</h2>
      <p className="text-sm text-pretty text-muted-foreground">{REQUESTS_ORDER_NOTE}</p>
      {draftAdmitted ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <Button type="button" variant="outline" aria-expanded={composerOpen} aria-controls={composerRegionId} onClick={toggleComposer}>
              {composerOpen ? DRAFT_REQUEST_HIDE_LABEL : DRAFT_REQUEST_LABEL}
            </Button>
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
      {requests.length === 0 ? (
        <StateNotice kind="empty" headingLevel={3} title={REQUESTS_EMPTY_TITLE} description={REQUESTS_EMPTY_BODY} action={draftAdmitted ? { label: DRAFT_REQUEST_LABEL, onClick: openComposer } : { label: INITIATIVE_COPY.listHeading, href: INITIATIVES_ROUTE }} />
      ) : (
        <ul className="flex min-w-0 flex-col gap-4">
          {requests.map((request) => (
            <li key={request.requestId} className="min-w-0 border-b border-border pb-4 last:border-b-0 last:pb-0">
              <RequestPresentation initiativeId={initiativeId} request={request} envelope={envelope} onRecorded={onChanged} onCheckResult={onChanged} headingLevel={3} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ResultsPanelProps {
  readonly initiativeId: string;
  readonly resultsEnvelope: NonNullable<InitiativeResultsProps["initialEnvelope"]> | undefined;
}

/**
 * The results section. The family's results surface answers every count over the base it is measured
 * against and needs the results read to do it; when the composing page did not read it, this section says
 * so instead of mounting a surface that would wait for an answer nobody asked for, and shows no zero.
 */
function ResultsPanel({ initiativeId, resultsEnvelope }: ResultsPanelProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="font-heading text-base font-medium text-pretty">{RESULTS_SECTION_TITLE}</h2>
      {resultsEnvelope === undefined ? <StateNotice kind="unavailable" headingLevel={3} title={STATE_NOTICE_COPY.unavailable.title} description={RESULTS_NOT_READ_BODY} /> : <InitiativeResults initiativeId={initiativeId} initialEnvelope={resultsEnvelope} />}
    </div>
  );
}

/** One dated entry of the initiative's history, printed with the time the read recorded and nothing rewritten. */
function HistoryEntry({ entry }: { readonly entry: InitiativeHistoryRow }): ReactElement {
  switch (entry.kind) {
    case "member-state":
      return (
        <li className="flex min-w-0 flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0">
          <RecordedInstant value={entry.at} className="text-sm" />
          <p className="text-sm text-pretty">{`${MEMBERSHIP_CHANGE_LABEL}: ${MEMBERSHIP_STATE_COPY[entry.state].label}`}</p>
          <dl className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            <Fact term={REASON_LABEL}>{entry.reason === null ? NO_REASON_WORD : <bdi>{entry.reason}</bdi>}</Fact>
            <Fact term={RECORDED_BY_LABEL}>
              <bdi className="mono-identifier break-all">{entry.byPrincipalId}</bdi>
            </Fact>
          </dl>
        </li>
      );
    case "request-response":
      return (
        <li className="flex min-w-0 flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0">
          <RecordedInstant value={entry.at} className="text-sm" />
          <p className="text-sm text-pretty">{`${RESPONSE_RECORDED_LABEL}: ${RESPONSE_KIND_COPY[COPY_KIND_OF_RECORDED_KIND[entry.responseKind]].label}`}</p>
          <dl className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            <Fact term={REQUEST_LABEL}>
              <bdi className="mono-identifier break-all">{entry.requestId}</bdi>
            </Fact>
            <Fact term={REQUESTED_TERMS_COPY.versionLabel}>
              <bdi className="mono-identifier break-all">{entry.termsVersionRef}</bdi>
            </Fact>
            <Fact term={RESPONDENT_LABEL}>
              <bdi className="mono-identifier break-all">{entry.respondentId}</bdi>
            </Fact>
          </dl>
        </li>
      );
    default:
      return assertNever(entry, "Unexpected initiative history entry");
  }
}

/**
 * The dated history the read supplied, in the order it supplied it, with the initiative's current closure
 * record above it. A closure is a state of the initiative and a reopen preserves it, so both are stated
 * here as they stand rather than reconstructed from the entries below.
 */
function HistoryPanel({ envelope }: { readonly envelope: InitiativeEnvelope }): ReactElement {
  const { initiative, history } = envelope.data;
  const showsClosure = initiative.state === "closed" || initiative.closureDisposition !== null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="font-heading text-base font-medium text-pretty">{INITIATIVE_COPY.historyHeading}</h2>
      {showsClosure ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              <h3 className="font-heading text-base font-medium text-pretty">{CLOSURE_COPY.closeHeading}</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-2">
            <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Fact term={STATE_LABEL}>{INITIATIVE_STATE_COPY[initiative.state].label}</Fact>
              <Fact term={CLOSURE_COPY.dispositionLabel}>{initiative.closureDisposition === null ? NOT_RECORDED_WORD : <bdi>{dispositionFallback(initiative.closureDisposition)}</bdi>}</Fact>
            </dl>
            <p className="text-xs text-pretty text-muted-foreground">{INITIATIVE_STATE_COPY[initiative.state].description}</p>
            {initiative.lifecycle === "reopened" ? <p className="text-sm text-pretty text-muted-foreground">{CLOSURE_COPY.historyPreservedNote}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <p className="text-sm text-pretty text-muted-foreground">{HISTORY_ORDER_NOTE}</p>
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

/** The read's own refusal, stated as the answer it is: a denial reveals nothing, an outage names its source, a bad request names the field to correct. */
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

/** Props of {@link InitiativeDetail}. */
export interface InitiativeDetailProps {
  /** The envelope the route's Server Component read for this initiative: its scope, revision, value states, advisory actions and every fact this body presents. */
  readonly envelope: InitiativeEnvelope;
  /**
   * The eligible-partner read the composing page supplies to the working list's picker. The detail
   * envelope does not carry it, and this surface computes no candidate set of its own, so a page that
   * omits it leaves the picker stating that it holds no answer rather than offering an empty set.
   */
  readonly candidates?: WorkingListProps["candidates"];
  /**
   * The results read the composing page supplies: each count with the base it is measured against.
   * Omitted, the results section states that this read was not part of the composed answer and shows no
   * count at all, rather than mounting a surface that would wait for an answer nobody requested.
   */
  readonly resultsEnvelope?: NonNullable<InitiativeResultsProps["initialEnvelope"]>;
  readonly className?: string;
}

/**
 * The initiative detail body described at the top of this file. It subscribes to the initiative read with
 * the envelope the Server Component already answered, so the first paint costs no further request, and
 * every settled change is recovered by re-reading this initiative under the scope it started in.
 */
export default function InitiativeDetail({ envelope, candidates, resultsEnvelope, className }: InitiativeDetailProps): ReactElement {
  const initiativeId = envelope.data.initiative.initiativeId;
  const [tab, setTab] = useState<TabKey>(FIRST_TAB);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const queryClient = useQueryClient();
  // This family's one recovery policy: an unconfirmed attempt is checked by re-reading the initiative, and
  // a settled change is followed by the same read, never by repeating the change under a second identity.
  const reread = useCallback((): void => {
    void invalidateInitiativeReads(queryClient, envelope.scope);
  }, [queryClient, envelope.scope]);
  const query = useInitiative<InitiativeDetailData>(initiativeId, envelope);
  const handleTabChange = useCallback((next: unknown): void => {
    setTab(tabOf(String(next)));
  }, []);
  const result = query.status === "ready" ? query.result : undefined;
  const refusal: ReadRefusal | undefined = result !== undefined && result.kind !== "envelope" ? result : undefined;
  const current: InitiativeEnvelope = result !== undefined && result.kind === "envelope" ? result.envelope : envelope;
  if (refusal !== undefined) {
    // Nothing about the initiative is printed beside a refusal — no name, no count, no title and no
    // membership word — so the answer is identical whether or not anything exists behind this address.
    return (
      <div data-slot="initiative-detail" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
        <RefusalNotice refusal={refusal} onRetry={reread} />
      </div>
    );
  }
  const initiative: InitiativeRow = current.data.initiative;
  const closeAdmitted = admits(current.actions, "closeInitiative");
  const reopenAdmitted = admits(current.actions, "reopenInitiative");
  return (
    <div data-slot="initiative-detail" data-initiative-state={initiative.state} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <RecordDetail
        layout="page"
        identity={{ displayName: initiative.name, secondaryName: initiative.purpose, kind: INITIATIVE_KIND_LABEL, reference: { system: current.source.system, reference: initiativeId } }}
        status={<Badge variant={initiative.state === "closed" ? "outline" : "secondary"}>{INITIATIVE_STATE_COPY[initiative.state].label}</Badge>}
        breadcrumb={BREADCRUMB}
      />
      {/*
        The five sections of this initiative, in the only order they render. The strip wraps onto further
        rows inside its own labelled area rather than scrolling the page sideways, so every section stays
        operable at 320 CSS px (WCAG 1.4.10) and arrow keys move between the tabs without a page scroll.
      */}
      <Tabs value={tab} onValueChange={handleTabChange} className="min-w-0 gap-3">
        <TabsList aria-label={TAB_LIST_LABEL} activateOnFocus className="h-auto w-full max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key} className="h-8 flex-none">
              {TAB_COPY[key].label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* The selected section is announced once, politely, and focus stays on the tab the worker moved to. */}
        <output className="sr-only">{TAB_COPY[tab].announced}</output>
        <TabsContent value="overview" aria-label={TAB_COPY.overview.panel} className="min-w-0">
          <OverviewPanel
            envelope={current}
            onRequestClose={() => {
              setCloseOpen(true);
            }}
            onRequestReopen={() => {
              setReopenOpen(true);
            }}
          />
        </TabsContent>
        <TabsContent value="working-list" aria-label={TAB_COPY["working-list"].panel} className="min-w-0">
          <WorkingList initiativeId={initiativeId} envelope={current} candidates={candidates ?? CANDIDATES_NOT_SUPPLIED} onChanged={reread} headingLevel={2} />
        </TabsContent>
        <TabsContent value="requests" aria-label={TAB_COPY.requests.panel} className="min-w-0">
          <RequestsPanel initiativeId={initiativeId} envelope={current} onChanged={reread} />
        </TabsContent>
        <TabsContent value="results" aria-label={TAB_COPY.results.panel} className="min-w-0">
          <ResultsPanel initiativeId={initiativeId} resultsEnvelope={resultsEnvelope} />
        </TabsContent>
        <TabsContent value="history" aria-label={TAB_COPY.history.panel} className="min-w-0">
          <HistoryPanel envelope={current} />
        </TabsContent>
      </Tabs>
      {/*
        Both lifecycle dialogs are mounted only where the read admits that action, and they are opened from
        the header's own triggers: each owns its form, its review step and its receipt, so this surface only
        holds which one is open.
      */}
      {closeAdmitted ? <CloseInitiativeDialog open={closeOpen} onOpenChange={setCloseOpen} initiativeId={initiativeId} envelope={current} onClosed={reread} onCheckResult={reread} /> : null}
      {reopenAdmitted ? <ReopenInitiativeDialog open={reopenOpen} onOpenChange={setReopenOpen} initiativeId={initiativeId} envelope={current} onReopened={reread} /> : null}
    </div>
  );
}
