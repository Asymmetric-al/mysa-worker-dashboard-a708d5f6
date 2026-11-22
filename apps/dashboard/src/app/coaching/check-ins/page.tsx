/**
 * `/coaching/check-ins` — the worker's private check-ins and the task summaries they share with a coach
 * (AAP 0.9.1, 0.10.1 Coaching, 0.6.4 "What help do I want?": prepare, share exact modules and periods,
 * check in, review as coach, revoke).
 *
 * **What this file is.** Composition, nothing else. It awaits exactly two named reads —
 * `reads.coaching.readCheckIns` and `reads.coaching.readTaskShares` — and hands their answers to the
 * family's own four surfaces, which own every row, control, count, limit and word. Nothing here filters,
 * sorts, pages, counts, formats, validates or measures a value: the page window the address states is
 * forwarded untouched, and the service keeps its own default of 25 rows and its cap of 100.
 *
 * **Why the page states the one heading.** Every composed surface opens its own sections at level two, so
 * the outline needs its top level exactly once, and the family copy supplies its words rather than a
 * second copy written here.
 *
 * **What the two envelopes do not carry, and what this page therefore cannot hand on.**
 * - `TaskSummarySelector` chooses among *tasks*: it needs each task's identity, a neutral label and the
 *   fingerprint of its reviewed meaning. Neither read states a task record — the share read states the
 *   occurrence a summary was shared for — so no candidate is offered rather than a fabricated one, and the
 *   selector states its own empty surface.
 * - A share's task identity and share instant are not stated either, so a row is given the occurrence
 *   identity the read does state, rendered by the list as an opaque reference and nothing more, and the
 *   list's own "no share date recorded" words rather than an invented day.
 * - A share whose task status the read does not state cannot be rendered truthfully, because the list
 *   states a status for every row; that outage is therefore stated once above the list instead of being
 *   given a status the read never reported.
 * - A private draft may hold an answer with no question order — a private note beside the questions. The
 *   editor's body is positional, one answer per question, so that note is neither shown nor carried: this
 *   page passes the answers that answer a question, and saving writes the body the editor shows.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import CheckInEditor, { type CheckInBody, type CheckInEditorProps } from "@/features/coaching/components/check-in-editor";
import CheckInList from "@/features/coaching/components/check-in-list";
import TaskShareList, { type TaskShareListEntry } from "@/features/coaching/components/task-share-list";
import TaskSummarySelector, { type TaskSummaryCandidate, type TaskSummaryExistingShare } from "@/features/coaching/components/task-summary-selector";
import { COACHING_COPY } from "@/features/coaching/copy";
import { reads, type ReadResult } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** What `readCheckIns` answers with: the envelope, a denial, an outage behind the records, or a refused request. */
type CheckInsResult = Awaited<ReturnType<typeof reads.coaching.readCheckIns>>;

/** The envelope arm, narrowed once so the surfaces below read the scope and the records from one shape. */
type CheckInsEnvelope = Extract<CheckInsResult, { readonly kind: "envelope" }>["envelope"];

/** One check-in as the read states it: its read state, its private autosave and its shared revision kept apart. */
type CheckInRow = CheckInsEnvelope["data"]["checkIns"][number];

/** What `readTaskShares` answers with, and the envelope arm of it. */
type TaskSharesResult = Awaited<ReturnType<typeof reads.coaching.readTaskShares>>;

type TaskSharesEnvelope = Extract<TaskSharesResult, { readonly kind: "envelope" }>["envelope"];

/** One shared task summary as the read states it. */
type TaskShareRow = TaskSharesEnvelope["data"]["shares"][number];

/** One stored revision of a check-in: its question set in the order it was captured and the answers given. */
type CheckInRevisionView = NonNullable<CheckInRow["privateDraft"]>;

type CheckInQuestionView = CheckInRevisionView["questions"][number];

type CheckInAnswerView = CheckInRevisionView["answers"][number];

/** The page window a coaching read declares, in the read's own vocabulary. */
type CheckInsQuery = Parameters<typeof reads.coaching.readCheckIns>[0];

/** A read's own refusal: the three arms that are not an envelope, so one notice serves both surfaces. */
type SurfaceRefusal = Extract<ReadResult<never>, { readonly kind: "denied" } | { readonly kind: "unavailable" } | { readonly kind: "refused" }>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = COACHING_COPY.checkIns.heading;

/** The document title comes from the same key, so the heading and the title can never disagree. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** The interface locale the composed surfaces record on their regions; the family's surfaces never re-render a stored value in another language. */
const INTERFACE_LOCALE = "en-GB";

/** The one region the family copy does not name: the notice that stands in for the share surface when its read answers without an envelope. */
const TASK_SHARE_REGION_TITLE = "Shared task summaries";

/** The two search parameters this route reads, as the coaching reads declare them. */
const PAGE_PARAM = "page";

const PAGE_SIZE_PARAM = "pageSize";

/** The pager counts from one, while the reads index their window from zero: the two are mapped in one place below. */
const FIRST_PAGE = 1;

/** The documented default page size for coaching lists (AAP 0.8.7); the cap of 100 is the service's, and this route never applies it. */
const DEFAULT_PAGE_SIZE = 25;

/** A page value as an address may state one: a whole number of one or more, and nothing else. */
const ADDRESS_NUMBER = /^[1-9][0-9]*$/u;

/** A notice under the page's heading opens one level below it. */
const NOTICE_HEADING_LEVEL = 2;

/** No check-in and no share is stated yet: the read answered a denial or an outage, so no row stands in for it. */
const NO_CHECK_INS: readonly CheckInRow[] = [];

/**
 * Nothing is offered to the task-summary selector and nothing blocks a selection: neither read states a
 * task record or the fingerprint a share is submitted with, so the selector's own empty surface is shown
 * rather than candidates or blocking states assembled from what these two reads do not carry.
 */
const NO_CANDIDATES: readonly TaskSummaryCandidate[] = [];

const NO_EXISTING_SHARES: readonly TaskSummaryExistingShare[] = [];

// ---------------------------------------------------------------------------------------------
// The address, read and forwarded without being decided here
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and no value is treated as a decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return undefined;
  const trimmed = first.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A stated page or page size, or `undefined` when the address states none or states something that is not one. */
function positiveIntegerOf(stated: string | undefined): number | undefined {
  if (stated === undefined) return undefined;
  if (!ADDRESS_NUMBER.test(stated)) return undefined;
  const parsed = Number(stated);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------------------------
// The read's own records, translated into the surfaces' inputs
// ---------------------------------------------------------------------------------------------

/**
 * The editor's positional body for one stored revision: one answer per question, paired by the question
 * order the record states rather than by array position, so an answer that answers no question can never be
 * shifted onto one. No answer is invented — a question the record answers nothing to carries an empty one.
 */
function bodyOf(questions: readonly CheckInQuestionView[], answers: readonly CheckInAnswerView[]): CheckInBody {
  const ordered = [...questions].sort((one, two) => one.order - two.order);
  const answerFor = new Map<number, string>();
  for (const answer of answers) {
    if (answer.questionOrder === null || answerFor.has(answer.questionOrder)) continue;
    answerFor.set(answer.questionOrder, answer.text);
  }
  return { questions: ordered.map((question) => question.wording), answers: ordered.map((question) => answerFor.get(question.order) ?? "") };
}

/**
 * The editor's inputs for the check-in this page opens: the first the read states, or a new one when it
 * states none, so a private draft that was already saved is continued rather than only creatable. Each
 * captured question keeps a stable identity derived from the order it was frozen at, which is what lets the
 * editor refine its wording without losing the row.
 */
function editorInputsOf(row: CheckInRow | null): Pick<CheckInEditorProps, "captured" | "revisions" | "checkInId"> {
  if (row === null) return { captured: null, revisions: { draft: null, shared: null }, checkInId: null };
  const { privateDraft: draft, shared } = row;
  const capture = draft ?? shared;
  return {
    captured: capture === null ? null : { questions: [...capture.questions].sort((one, two) => one.order - two.order).map((question) => ({ id: `${row.checkInId}-question-${String(question.order)}`, wording: question.wording, order: question.order })), capturedAt: capture.questionsCapturedAt },
    revisions: { draft: draft === null ? null : { revisionId: draft.revisionId, body: bodyOf(draft.questions, draft.answers) }, shared: shared === null ? null : { revisionId: shared.revisionId, body: bodyOf(shared.questions, shared.answers), sharedAt: shared.sharedAt, withdrawnAt: shared.withdrawnAt } },
    checkInId: row.checkInId,
  };
}

/**
 * The one narrowing the share read leaves to its reader: it types a dated share's precision as text, while
 * the list states it in the civil-date vocabulary. A word this surface cannot read is stated as an
 * unconfirmed date rather than as an exact day.
 */
function duePrecisionOf(precision: string): TaskShareListEntry["duePrecision"] {
  switch (precision) {
    case "date":
      return "date";
    case "approximate":
      return "approximate";
    default:
      return "unknown";
  }
}

/** One share as the list renders it, from what the read states and nothing else. */
function taskShareEntryOf(share: TaskShareRow, taskStatus: TaskShareListEntry["taskStatus"]): TaskShareListEntry {
  const due = share.dueDate;
  return {
    shareId: share.shareId,
    // The read states the occurrence a summary was shared for, never the task's own identity: this is that
    // occurrence's opaque reference, and the list draws it as an opaque reference and nothing more.
    taskId: share.occurrenceId,
    state: share.state,
    reviewedDescription: share.description,
    dueOn: due !== null && due.kind === "dated" ? due.date : null,
    duePrecision: due !== null && due.kind === "dated" ? duePrecisionOf(due.precision) : "unknown",
    taskStatus,
    // The read states no share instant, so the list says none was recorded instead of showing a made-up day.
    sharedAt: null,
  };
}

/** The shares the list can state, and how many it cannot because the read states no status for their task. */
function taskSharesOf(shares: readonly TaskShareRow[]): { readonly entries: readonly TaskShareListEntry[]; readonly unstatedStatus: number } {
  const entries: TaskShareListEntry[] = [];
  let unstatedStatus = 0;
  for (const share of shares) {
    if (share.status === null) {
      unstatedStatus += 1;
      continue;
    }
    entries.push(taskShareEntryOf(share, share.status));
  }
  return { entries, unstatedStatus };
}

// ---------------------------------------------------------------------------------------------
// The refusal a surface states in place of its records
// ---------------------------------------------------------------------------------------------

/**
 * The notice one surface states when its read answered with something other than an envelope. A denial
 * discloses no count, question wording, answer text or share state, an outage is never an empty list, and a
 * refused request is the caller's own and never a source that failed.
 */
function SurfaceNotice({ result, title }: { readonly result: SurfaceRefusal; readonly title: string }): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title={title} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={title} description={result.unavailable.guidance} source={result.unavailable.source} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={title} />;
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

export interface CheckInsPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/** The worker's check-ins and shared task summaries: one page window, two reads, and the family's own surfaces rendering them. */
export default async function CheckInsPage({ searchParams }: CheckInsPageProps): Promise<ReactElement> {
  const stated = await searchParams;
  const addressPage = positiveIntegerOf(paramOf(stated, PAGE_PARAM)) ?? FIRST_PAGE;
  const addressPageSize = positiveIntegerOf(paramOf(stated, PAGE_SIZE_PARAM));
  // The reads index their window from zero and clamp both values themselves, so the address's own page is
  // mapped to their indexing here and no value is clamped, counted or repaired on this side.
  const query: CheckInsQuery = { page: addressPage - FIRST_PAGE, ...(addressPageSize === undefined ? {} : { pageSize: addressPageSize }) };
  // The two reads describe the same context at the same instant and neither depends on the other, so the
  // one surface's denial never suppresses the other's honest state: each is answered on its own below.
  const [checkIns, taskShares] = await Promise.all([reads.coaching.readCheckIns(query), reads.coaching.readTaskShares(query)]);
  // The list is seeded with the window the address states, in the pager's own one-based numbering; the
  // service reports the window it actually executed and the whole-result total beside it.
  const initialQuery = { sort: [], page: addressPage, pageSize: addressPageSize ?? DEFAULT_PAGE_SIZE, columnVisibility: {} };
  const rows = checkIns.kind === "envelope" ? checkIns.envelope.data.checkIns : NO_CHECK_INS;
  // The editor opens on the first check-in the page states, so a private draft already saved is continued
  // rather than only creatable; an empty page opens a new one, whose save creates it.
  const editorInputs = editorInputsOf(rows.at(0) ?? null);
  let checkInRegion: ReactElement;
  if (checkIns.kind === "envelope") {
    checkInRegion = (
      <>
        <CheckInList initialQuery={initialQuery} scope={checkIns.envelope.scope} locale={INTERFACE_LOCALE} />
        <CheckInEditor {...editorInputs} scope={checkIns.envelope.scope} expectedRevision={checkIns.envelope.revision} locale={INTERFACE_LOCALE} />
      </>
    );
  } else {
    checkInRegion = <SurfaceNotice result={checkIns} title={PAGE_TITLE} />;
  }
  let shareRegion: ReactElement;
  if (taskShares.kind === "envelope") {
    const shares = taskSharesOf(taskShares.envelope.data.shares);
    shareRegion = (
      <>
        <TaskSummarySelector candidates={NO_CANDIDATES} existing={NO_EXISTING_SHARES} scope={taskShares.envelope.scope} expectedRevision={taskShares.envelope.revision} locale={INTERFACE_LOCALE} asOf={taskShares.envelope.asOf} />
        {shares.unstatedStatus === 0 ? null : <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={TASK_SHARE_REGION_TITLE} source={taskShares.envelope.source} />}
        <TaskShareList shares={shares.entries} scope={taskShares.envelope.scope} expectedRevision={taskShares.envelope.revision} locale={INTERFACE_LOCALE} />
      </>
    );
  } else {
    shareRegion = <SurfaceNotice result={taskShares} title={TASK_SHARE_REGION_TITLE} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {/* The one h1 on this page, from the family's copy: every composed surface below opens its own sections at level two. */}
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
      {checkInRegion}
      {shareRegion}
    </div>
  );
}
