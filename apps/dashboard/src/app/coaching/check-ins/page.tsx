import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import CheckInEditor, { type CheckInBody, type CheckInEditorProps } from "@/features/coaching/components/check-in-editor";
import CheckInList from "@/features/coaching/components/check-in-list";
import TaskShareList, { type TaskShareListEntry } from "@/features/coaching/components/task-share-list";
import TaskSummarySelector, { type TaskSummaryCandidate, type TaskSummaryExistingShare } from "@/features/coaching/components/task-summary-selector";
import { COACHING_COPY } from "@/features/coaching/copy";
import { reads } from "@/modules/data-service";
import { ReadNotices, paramOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
type CheckInsEnvelope = Extract<Awaited<ReturnType<typeof reads.coaching.readCheckIns>>, { readonly kind: "envelope" }>["envelope"];
type CheckInRow = CheckInsEnvelope["data"]["checkIns"][number];
type TaskSharesEnvelope = Extract<Awaited<ReturnType<typeof reads.coaching.readTaskShares>>, { readonly kind: "envelope" }>["envelope"];
type TaskShareRow = TaskSharesEnvelope["data"]["shares"][number];
/** One task the read offers for sharing a summary of, in the read's own projection. */
type TaskSummaryCandidateRow = TaskSharesEnvelope["data"]["candidates"][number];
type CheckInRevisionView = NonNullable<CheckInRow["privateDraft"]>;
type CheckInQuestionView = CheckInRevisionView["questions"][number];
type CheckInAnswerView = CheckInRevisionView["answers"][number];
type CheckInsQuery = Parameters<typeof reads.coaching.readCheckIns>[0];
const PAGE_TITLE = COACHING_COPY.checkIns.heading;
export const metadata: Metadata = { title: PAGE_TITLE };
const INTERFACE_LOCALE = "en-GB";
const TASK_SHARE_REGION_TITLE = "Shared task summaries";
const PAGE_PARAM = "page";
const PAGE_SIZE_PARAM = "pageSize";
const FIRST_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const ADDRESS_NUMBER = /^[1-9][0-9]*$/u;
const NOTICE_HEADING_LEVEL = 2;
const NO_CHECK_INS: readonly CheckInRow[] = [];
function positiveIntegerOf(stated: string | undefined): number | undefined {
  if (stated === undefined) return undefined;
  if (!ADDRESS_NUMBER.test(stated)) return undefined;
  const parsed = Number(stated);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
/** One saved revision as the editor reads it: the captured questions with the answer written beside each, and the answers that belong to no question, which hold no position and are kept rather than dropped. */
function bodyOf(questions: readonly CheckInQuestionView[], answers: readonly CheckInAnswerView[]): CheckInBody {
  const ordered = [...questions].sort((one, two) => one.order - two.order);
  const answerFor = new Map<number, string>();
  const unassignedAnswers: string[] = [];
  for (const answer of answers) {
    if (answer.questionOrder === null) {
      unassignedAnswers.push(answer.text);
      continue;
    }
    if (answerFor.has(answer.questionOrder)) continue;
    answerFor.set(answer.questionOrder, answer.text);
  }
  return { questions: ordered.map((question) => question.wording), answers: ordered.map((question) => answerFor.get(question.order) ?? ""), unassignedAnswers };
}
/** The editor's inputs, carrying the revision the editor's four writes present: the revision of the check-in they change, which is the row's own, because the collection's revision the list displays is never what the service compares a record's change against. A page with no check-in has no record to compare, and a save there creates one. */
function editorInputsOf(row: CheckInRow | null, collectionRevision: string): Pick<CheckInEditorProps, "captured" | "revisions" | "checkInId" | "expectedRevision"> {
  if (row === null) return { captured: null, revisions: { draft: null, shared: null }, checkInId: null, expectedRevision: collectionRevision };
  const { privateDraft: draft, shared } = row;
  const capture = draft ?? shared;
  return {
    captured: capture === null ? null : { questions: [...capture.questions].sort((one, two) => one.order - two.order).map((question) => ({ id: `${row.checkInId}-question-${String(question.order)}`, wording: question.wording, order: question.order })), capturedAt: capture.questionsCapturedAt },
    revisions: { draft: draft === null ? null : { revisionId: draft.revisionId, body: bodyOf(draft.questions, draft.answers) }, shared: shared === null ? null : { revisionId: shared.revisionId, body: bodyOf(shared.questions, shared.answers), sharedAt: shared.sharedAt, withdrawnAt: shared.withdrawnAt } },
    checkInId: row.checkInId,
    expectedRevision: row.revision,
  };
}
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
function taskShareEntryOf(share: TaskShareRow, taskStatus: TaskShareListEntry["taskStatus"]): TaskShareListEntry {
  const due = share.dueDate;
  // The task behind the share: an opaque identity that carries none of its title, notes or history, and the identity an existing share is matched by so the same occurrence is never offered for sharing twice. The share record's own revision travels with it, because a stop presents that revision and the service compares it before it writes, so a share stopped from a page that has moved on is a conflict rather than an overwrite.
  return {
    shareId: share.shareId,
    taskId: share.taskId,
    revision: String(share.revision),
    state: share.state,
    reviewedDescription: share.description,
    dueOn: due !== null && due.kind === "dated" ? due.date : null,
    duePrecision: due !== null && due.kind === "dated" ? duePrecisionOf(due.precision) : "unknown",
    taskStatus,
    sharedAt: null,
  };
}
/** One task the read offers, in the selector's own vocabulary: the civil day the read states is handed on as that day, and a task with no due date states no day at all rather than a precision nothing supports. */
function candidateOf(candidate: TaskSummaryCandidateRow): TaskSummaryCandidate {
  const due = candidate.dueDate;
  const dueOn = due.kind === "dated" ? due.date : null; // The read states the day it serialised, so the selector renders that stored day rather than one re-parsed here.
  return { taskId: candidate.taskId, safeLabel: candidate.safeLabel, dueOn, duePrecision: due.kind === "dated" ? duePrecisionOf(due.precision) : "unknown", status: candidate.status, isRecurringSuccessor: candidate.isRecurringSuccessor, reviewedFingerprint: candidate.reviewedFingerprint, revision: candidate.revision };
}
/** One summary that already exists for a task, so the same occurrence is never shared twice. */
const existingShareOf = (share: TaskShareRow): TaskSummaryExistingShare => ({ taskId: share.taskId, state: share.state, reviewedDescription: share.description });
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
const noticeCopyOf = (title: string): ReadNoticeCopy => ({ headingLevel: NOTICE_HEADING_LEVEL, denied: { title }, unavailable: { title }, refused: { title } });
/** The worker's check-ins and shared task summaries: one page window, two reads, and the family's own surfaces rendering them. */
export default async function CheckInsPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const addressPage = positiveIntegerOf(paramOf(stated, PAGE_PARAM)) ?? FIRST_PAGE;
  const addressPageSize = positiveIntegerOf(paramOf(stated, PAGE_SIZE_PARAM));
  const query: CheckInsQuery = { page: addressPage - FIRST_PAGE, ...(addressPageSize === undefined ? {} : { pageSize: addressPageSize }) };
  const [checkIns, taskShares] = await Promise.all([reads.coaching.readCheckIns(query), reads.coaching.readTaskShares(query)]);
  const initialQuery = { sort: [], page: addressPage, pageSize: addressPageSize ?? DEFAULT_PAGE_SIZE, columnVisibility: {} };
  const rows = checkIns.kind === "envelope" ? checkIns.envelope.data.checkIns : NO_CHECK_INS;
  let checkInRegion: ReactElement;
  if (checkIns.kind === "envelope") {
    const editorInputs = editorInputsOf(rows.at(0) ?? null, checkIns.envelope.revision);
    checkInRegion = (
      <>
        <CheckInList initialQuery={initialQuery} scope={checkIns.envelope.scope} locale={INTERFACE_LOCALE} />
        <CheckInEditor {...editorInputs} scope={checkIns.envelope.scope} locale={INTERFACE_LOCALE} />
      </>
    );
  } else {
    checkInRegion = <ReadNotices failure={checkIns} copy={noticeCopyOf(PAGE_TITLE)} />;
  }
  let shareRegion: ReactElement;
  if (taskShares.kind === "envelope") {
    const shares = taskSharesOf(taskShares.envelope.data.shares);
    shareRegion = (
      <>
        <TaskSummarySelector candidates={taskShares.envelope.data.candidates.map(candidateOf)} existing={taskShares.envelope.data.shares.map(existingShareOf)} scope={taskShares.envelope.scope} locale={INTERFACE_LOCALE} asOf={taskShares.envelope.asOf} />
        {shares.unstatedStatus === 0 ? null : <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={TASK_SHARE_REGION_TITLE} source={taskShares.envelope.source} />}
        <TaskShareList shares={shares.entries} scope={taskShares.envelope.scope} locale={INTERFACE_LOCALE} />
      </>
    );
  } else {
    shareRegion = <ReadNotices failure={taskShares} copy={noticeCopyOf(TASK_SHARE_REGION_TITLE)} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <h1 className="type-page-title text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
      {checkInRegion}
      {shareRegion}
    </div>
  );
}
