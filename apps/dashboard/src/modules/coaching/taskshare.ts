import { err, ok, type Result } from "../../lib/result";
import type { CivilDate, CivilDayStart, DatePrecision } from "../time/civil";
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
const fingerprintVerdict = (reviewedFingerprint: string | undefined, currentFingerprint: string | undefined): FingerprintVerdict => (reviewedFingerprint === undefined || currentFingerprint === undefined ? "missing" : reviewedFingerprint === currentFingerprint ? "current" : "changed");
export function reviewTaskSummary(description: string, now: ScenarioInstant): Result<ReviewedTaskSummary, TaskShareRefusal> {
  if (description.trim() === "") return err({ outcome: "refused", reason: "description-empty" });
  const codePoints = Array.from(description).length;
  return codePoints > TASK_SUMMARY_MAX_CODE_POINTS ? err({ outcome: "refused", reason: "description-too-long", codePoints, limit: TASK_SUMMARY_MAX_CODE_POINTS }) : ok({ description, codePoints, reviewedAt: now });
}
export function safeTaskSummary(input: SafeTaskSummaryInput): Result<SafeTaskSummary, TaskShareRefusal> {
  if (input.state === "removed") return err({ outcome: "refused", reason: "not-shared" });
  if (!input.sourceAvailable) return err({ outcome: "refused", reason: "unavailable" });
  const verdict = fingerprintVerdict(input.reviewedFingerprint, input.currentFingerprint);
  if (verdict === "missing") return err({ outcome: "refused", reason: "not-reviewed" });
  return verdict === "changed" ? ok({ state: "needs-review" }) : ok({ state: "shared", description: input.description, dueDate: input.dueDate, status: input.status });
}
export const taskShareReadState = (input: TaskShareReadStateInput): TaskShareSummaryState =>
  input.share === undefined || input.share.state === "removed" ? "removed" : !input.sourceAvailable ? "unavailable" : fingerprintVerdict(input.share.reviewedFingerprint, input.currentFingerprint) === "current" ? "shared" : "needs-review";
/** Authorises a share to cover a recurring task's next occurrence — only when the worker selected that occurrence explicitly. */
export function selectSuccessorForSharing(request: SuccessorSharingRequest): Result<SelectedSuccessorOccurrence, TaskShareRefusal> {
  if (request.share.state !== "shared") return err({ outcome: "refused", reason: "not-shared" });
  if (request.expectedRevision !== request.share.revision) return err({ outcome: "refused", reason: "stale-revision" });
  if (request.occurrenceId === request.share.occurrenceId) return err({ outcome: "refused", reason: "occurrence-already-shared" });
  return request.selectedOccurrenceId !== request.occurrenceId ? err({ outcome: "refused", reason: "successor-needs-fresh-selection" }) : ok({ occurrenceId: request.occurrenceId, reviewedFingerprint: request.share.reviewedFingerprint });
}
export const stopTaskShare = (input: StopTaskShareInput, now: ScenarioInstant): Result<TaskShare, TaskShareRefusal> =>
  input.share.state !== "shared" ? err({ outcome: "refused", reason: "not-shared" }) : input.expectedRevision !== input.share.revision ? err({ outcome: "refused", reason: "stale-revision" }) : ok({ ...input.share, state: "removed", revision: input.share.revision + 1, withdrawnAt: now });
