/** The one reviewed, coach-readable summary of a shared task — and the rule that withholds it the moment the task's reviewed meaning changes. */
import { err, ok, type Result } from "../../lib/result";
import type { CivilDate, CivilDayStart, DatePrecision } from "../time/civil";
/** The maximum length of a reviewed shared-task description, in Unicode code points. */
export const TASK_SUMMARY_MAX_CODE_POINTS = 240;
export type ScenarioInstant = Extract<CivilDayStart, { status: "resolved" }>["instant"];
export type TaskStatus = "open" | "completed" | "reopened" | "cancelled";
export type TaskShareState = "shared" | "removed";
export type TaskShareSummaryState = "shared" | "needs-review" | "removed" | "unavailable";
export type TaskShareRefusalReason = "description-too-long" | "description-empty" | "not-reviewed" | "successor-needs-fresh-selection" | "stale-revision" | "not-shared" | "occurrence-already-shared" | "unavailable";
export type TaskShareRefusal = { readonly outcome: "refused"; readonly reason: "description-too-long"; readonly codePoints: number; readonly limit: number } | { readonly outcome: "refused"; readonly reason: Exclude<TaskShareRefusalReason, "description-too-long"> };
export type TaskSummaryDueDate = { readonly kind: "dated"; readonly date: CivilDate; readonly precision: Exclude<DatePrecision, "unknown"> } | { readonly kind: "undated" };
export type ReviewedTaskSummary = { readonly description: string; readonly codePoints: number; readonly reviewedAt: ScenarioInstant };
export type TaskShare = { readonly shareId: string; readonly occurrenceId: string; readonly reviewedSummary: ReviewedTaskSummary; readonly reviewedFingerprint: string; readonly state: TaskShareState; readonly revision: number; readonly withdrawnAt?: ScenarioInstant };
export type SafeTaskSummaryInput = { readonly state: TaskShareState; readonly description: string; readonly dueDate: TaskSummaryDueDate; readonly status: TaskStatus; readonly reviewedFingerprint: string | undefined; readonly currentFingerprint: string | undefined; readonly sourceAvailable: boolean };
export type SharedTaskSummary = { readonly state: "shared"; readonly description: string; readonly dueDate: TaskSummaryDueDate; readonly status: TaskStatus };
export type WithheldTaskSummary = { readonly state: "needs-review" };
export type SafeTaskSummary = SharedTaskSummary | WithheldTaskSummary;
export type StopTaskShareInput = { readonly share: TaskShare; readonly expectedRevision: number };
export type SuccessorSharingRequest = { readonly share: TaskShare; readonly occurrenceId: string; readonly selectedOccurrenceId: string | undefined; readonly expectedRevision: number };
export type SelectedSuccessorOccurrence = { readonly occurrenceId: string; readonly reviewedFingerprint: string };
export type TaskShareReadStateInput = { readonly share: TaskShare | undefined; readonly currentFingerprint: string | undefined; readonly sourceAvailable: boolean };
type FingerprintVerdict = "current" | "missing" | "changed";

function fingerprintVerdict(reviewedFingerprint: string | undefined, currentFingerprint: string | undefined): FingerprintVerdict {
  if (reviewedFingerprint === undefined || currentFingerprint === undefined) return "missing";
  return reviewedFingerprint === currentFingerprint ? "current" : "changed";
}
export function reviewTaskSummary(description: string, now: ScenarioInstant): Result<ReviewedTaskSummary, TaskShareRefusal> {
  if (description.trim() === "") return err({ outcome: "refused", reason: "description-empty" });
  const codePoints = Array.from(description).length;
  if (codePoints > TASK_SUMMARY_MAX_CODE_POINTS) return err({ outcome: "refused", reason: "description-too-long", codePoints, limit: TASK_SUMMARY_MAX_CODE_POINTS });
  return ok({ description, codePoints, reviewedAt: now });
}
export function safeTaskSummary(input: SafeTaskSummaryInput): Result<SafeTaskSummary, TaskShareRefusal> {
  if (input.state === "removed") return err({ outcome: "refused", reason: "not-shared" });
  if (!input.sourceAvailable) return err({ outcome: "refused", reason: "unavailable" });
  const verdict = fingerprintVerdict(input.reviewedFingerprint, input.currentFingerprint);
  if (verdict === "missing") return err({ outcome: "refused", reason: "not-reviewed" });
  if (verdict === "changed") {
    return ok({ state: "needs-review" });
  }
  return ok({ state: "shared", description: input.description, dueDate: input.dueDate, status: input.status });
}
export function taskShareReadState(input: TaskShareReadStateInput): TaskShareSummaryState {
  if (input.share === undefined || input.share.state === "removed") return "removed";
  if (!input.sourceAvailable) return "unavailable";
  return fingerprintVerdict(input.share.reviewedFingerprint, input.currentFingerprint) === "current" ? "shared" : "needs-review";
}
/** Authorises a share to cover a recurring task's next occurrence — only when the worker selected that occurrence explicitly. */
export function selectSuccessorForSharing(request: SuccessorSharingRequest): Result<SelectedSuccessorOccurrence, TaskShareRefusal> {
  if (request.share.state !== "shared") return err({ outcome: "refused", reason: "not-shared" });
  if (request.expectedRevision !== request.share.revision) return err({ outcome: "refused", reason: "stale-revision" });
  if (request.occurrenceId === request.share.occurrenceId) return err({ outcome: "refused", reason: "occurrence-already-shared" });
  if (request.selectedOccurrenceId !== request.occurrenceId) return err({ outcome: "refused", reason: "successor-needs-fresh-selection" });
  return ok({ occurrenceId: request.occurrenceId, reviewedFingerprint: request.share.reviewedFingerprint });
}
export function stopTaskShare(input: StopTaskShareInput, now: ScenarioInstant): Result<TaskShare, TaskShareRefusal> {
  if (input.share.state !== "shared") return err({ outcome: "refused", reason: "not-shared" });
  if (input.expectedRevision !== input.share.revision) return err({ outcome: "refused", reason: "stale-revision" });
  return ok({ ...input.share, state: "removed", revision: input.share.revision + 1, withdrawnAt: now });
}
