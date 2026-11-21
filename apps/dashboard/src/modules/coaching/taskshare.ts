/**
 * The one reviewed, coach-readable summary of a shared task — and the rule that withholds it the
 * moment the task's reviewed meaning changes.
 */
import { err, ok, type Result } from "../../lib/result";
import type { CivilDate, CivilDayStart, DatePrecision } from "../time/civil";
/** The maximum length of a reviewed shared-task description, in Unicode code points. */
export const TASK_SUMMARY_MAX_CODE_POINTS = 240;
/** The scenario instant, taken from the resolved day `time/civil.ts` returns. */
export type ScenarioInstant = Extract<CivilDayStart, { status: "resolved" }>["instant"];
/** The live status of the task behind a share, as the task model records it. */
export type TaskStatus = "open" | "completed" | "reopened" | "cancelled";
/** The lifecycle of one share of one task occurrence. */
export type TaskShareState = "shared" | "removed";
/** What a coach-facing surface renders for a share right now: the four readings that must never collapse into one another, and none of which may be rendered as an empty string or a zero. */
export type TaskShareSummaryState = "shared" | "needs-review" | "removed" | "unavailable";
/** The machine-readable reasons a function in this module refuses. */
export type TaskShareRefusalReason =
  | "description-too-long"
  | "description-empty"
  | "not-reviewed"
  | "successor-needs-fresh-selection"
  | "stale-revision"
  | "not-shared"
  | "occurrence-already-shared"
  | "unavailable";
/** A refusal, carrying the reason and — where a measurement decided it — the measured value. */
export type TaskShareRefusal =
  | {
      readonly outcome: "refused";
      readonly reason: "description-too-long";
      readonly codePoints: number;
      readonly limit: number;
    }
  | {
      readonly outcome: "refused";
      readonly reason: Exclude<TaskShareRefusalReason, "description-too-long">;
    };
/** A task's live due date: dated with the precision it was recorded at, or explicitly undated. */
export type TaskSummaryDueDate =
  | {
      readonly kind: "dated";
      readonly date: CivilDate;
      readonly precision: Exclude<DatePrecision, "unknown">;
    }
  | { readonly kind: "undated" };
/** A description that has passed review: the exact text the worker wrote for sharing, its measured length, and the instant the review happened. */
export type ReviewedTaskSummary = {
  readonly description: string;
  readonly codePoints: number;
  readonly reviewedAt: ScenarioInstant;
};
/** One share of one occurrence of one task. */
export type TaskShare = {
  readonly shareId: string;
  readonly occurrenceId: string;
  readonly reviewedSummary: ReviewedTaskSummary;
  readonly reviewedFingerprint: string;
  readonly state: TaskShareState;
  readonly revision: number;
  readonly withdrawnAt?: ScenarioInstant;
};
/** Everything {@link safeTaskSummary} is allowed to know: the reviewed summary's text, the three live values it may pass through, the two fingerprints, whether the source could be read at all. */
export type SafeTaskSummaryInput = {
  readonly state: TaskShareState;
  readonly description: string;
  readonly dueDate: TaskSummaryDueDate;
  readonly status: TaskStatus;
  readonly reviewedFingerprint: string | undefined;
  readonly currentFingerprint: string | undefined;
  readonly sourceAvailable: boolean;
};
/** The summary a coach may read: the reviewed description, the live due date and the live status, and nothing besides. */
export type SharedTaskSummary = {
  readonly state: "shared";
  readonly description: string;
  readonly dueDate: TaskSummaryDueDate;
  readonly status: TaskStatus;
};
/** The summary a coach may not read. */
export type WithheldTaskSummary = {
  readonly state: "needs-review";
};
/** The result of building a summary: shared, or withheld. */
export type SafeTaskSummary = SharedTaskSummary | WithheldTaskSummary;
/** A stop request: the share as the caller read it, and the revision it read. */
export type StopTaskShareInput = {
  readonly share: TaskShare;
  readonly expectedRevision: number;
};
/** A request to cover a recurring task's next occurrence with a share. */
export type SuccessorSharingRequest = {
  readonly share: TaskShare;
  readonly occurrenceId: string;
  readonly selectedOccurrenceId: string | undefined;
  readonly expectedRevision: number;
};
/** The selected successor occurrence, ready for the service to record as a new share under its own identity: which occurrence is now covered, and the fingerprint its summary is still reviewed. */
export type SelectedSuccessorOccurrence = {
  readonly occurrenceId: string;
  readonly reviewedFingerprint: string;
};
/** What the read-state resolver needs: the share (or its absence, when nothing is shared), the fingerprint of the task fields as they stand now, and whether the source could be read. */
export type TaskShareReadStateInput = {
  readonly share: TaskShare | undefined;
  readonly currentFingerprint: string | undefined;
  readonly sourceAvailable: boolean;
};
type FingerprintVerdict = "current" | "missing" | "changed";

function fingerprintVerdict(reviewedFingerprint: string | undefined, currentFingerprint: string | undefined): FingerprintVerdict {
  if (reviewedFingerprint === undefined || currentFingerprint === undefined) {
    return "missing";
  }
  return reviewedFingerprint === currentFingerprint ? "current" : "changed";
}
/** Validates a description written for sharing and stamps it as reviewed. */
export function reviewTaskSummary(description: string, now: ScenarioInstant): Result<ReviewedTaskSummary, TaskShareRefusal> {
  if (description.trim() === "") {
    return err({ outcome: "refused", reason: "description-empty" });
  }
  const codePoints = Array.from(description).length;
  if (codePoints > TASK_SUMMARY_MAX_CODE_POINTS) {
    return err({
      outcome: "refused",
      reason: "description-too-long",
      codePoints,
      limit: TASK_SUMMARY_MAX_CODE_POINTS,
    });
  }
  const reviewed: ReviewedTaskSummary = { description, codePoints, reviewedAt: now };
  return ok(reviewed);
}
/** Builds the coach-readable summary, or withholds it. */
export function safeTaskSummary(input: SafeTaskSummaryInput): Result<SafeTaskSummary, TaskShareRefusal> {
  if (input.state === "removed") {
    return err({ outcome: "refused", reason: "not-shared" });
  }
  if (!input.sourceAvailable) {
    return err({ outcome: "refused", reason: "unavailable" });
  }
  const verdict = fingerprintVerdict(input.reviewedFingerprint, input.currentFingerprint);
  if (verdict === "missing") {
    return err({ outcome: "refused", reason: "not-reviewed" });
  }
  if (verdict === "changed") {
    const withheld: WithheldTaskSummary = { state: "needs-review" };
    return ok(withheld);
  }
  const shared: SharedTaskSummary = {
    state: "shared",
    description: input.description,
    dueDate: input.dueDate,
    status: input.status,
  };
  return ok(shared);
}
/** Resolves what a coach-facing surface renders for a share, over the closed four-state set. */
export function taskShareReadState(input: TaskShareReadStateInput): TaskShareSummaryState {
  if (input.share === undefined || input.share.state === "removed") {
    return "removed";
  }
  if (!input.sourceAvailable) {
    return "unavailable";
  }
  return fingerprintVerdict(input.share.reviewedFingerprint, input.currentFingerprint) === "current" ? "shared" : "needs-review";
}
/** Authorises a share to cover a recurring task's next occurrence — only when the worker selected that occurrence explicitly. */
export function selectSuccessorForSharing(request: SuccessorSharingRequest): Result<SelectedSuccessorOccurrence, TaskShareRefusal> {
  if (request.share.state !== "shared") {
    return err({ outcome: "refused", reason: "not-shared" });
  }
  if (request.expectedRevision !== request.share.revision) {
    return err({ outcome: "refused", reason: "stale-revision" });
  }
  if (request.occurrenceId === request.share.occurrenceId) {
    return err({ outcome: "refused", reason: "occurrence-already-shared" });
  }
  if (request.selectedOccurrenceId !== request.occurrenceId) {
    return err({ outcome: "refused", reason: "successor-needs-fresh-selection" });
  }
  const selected: SelectedSuccessorOccurrence = {
    occurrenceId: request.occurrenceId,
    reviewedFingerprint: request.share.reviewedFingerprint,
  };
  return ok(selected);
}
/** Stops sharing one occurrence's summary and returns the share in its removed state. */
export function stopTaskShare(input: StopTaskShareInput, now: ScenarioInstant): Result<TaskShare, TaskShareRefusal> {
  if (input.share.state !== "shared") {
    return err({ outcome: "refused", reason: "not-shared" });
  }
  if (input.expectedRevision !== input.share.revision) {
    return err({ outcome: "refused", reason: "stale-revision" });
  }
  const removed: TaskShare = {
    ...input.share,
    state: "removed",
    revision: input.share.revision + 1,
    withdrawnAt: now,
  };
  return ok(removed);
}
