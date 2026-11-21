/**
 * The one reviewed, coach-readable summary of a shared task — and the rule that withholds it the
 * moment the task's reviewed meaning changes.
 *
 * A coach may read exactly three things about a task the worker chose to share: the worker's
 * reviewed description, the task's live due date with its recorded precision, and the task's live
 * status. Everything else about the task stays out of this module by construction rather than by
 * redaction: the task's own name, its body text, who it concerns, any financial figure, any file,
 * any link and any private record of earlier contact are not parameters, not fields and not
 * imports here, so no code path in this file can hand one to a reader.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Coaching" row: `src/modules/coaching/*`, key interface `safeTaskSummary()`.
 * - AAP 0.8.4, shared-task-summary rule: a reviewed safe description of at most 240 Unicode code
 *   points plus the live due date and status; a summary withheld the moment the reviewed meaning
 *   changes; a recurring successor requiring a fresh selection; and a stop that leaves the task
 *   intact.
 * - AAP 0.8.7 fixed value "Shared task description": 240 Unicode code points, exactly 240 accepted
 *   and 241 refused with the measured count shown.
 * - AAP 0.9.1 repository tree and the 0.11.1 File Creation Plan row
 *   `modules/coaching/{grant,target,checkin,taskshare}.ts`.
 * - Acceptance criterion 16: the coach sees only admitted modules, with distinct empty, partial,
 *   withheld, unavailable and ended states, source work unchanged by sharing, and no coach write
 *   action anywhere in the coaching surface.
 *
 * Why 240 code points, measured as `Array.from(text).length`: 240 Arabic letters, 240 emoji and
 * 240 Latin letters are each accepted and 241 of each is refused, which is what an author sees and
 * what a reviewer approves. A description over the limit is refused with its measured count and is
 * never shortened — this module holds no clipping path, because a quietly shortened summary would
 * show a coach words the worker never reviewed.
 *
 * Withholding, not annotating. The service fingerprints the task fields the description was
 * reviewed against, at review time and again when the summary is read, and hands both opaque
 * fingerprints here. Equal, and the summary is shared. Different, and the description is withheld
 * completely: not returned with a warning, not partly returned, and not guessable from anything
 * this module returns. This file computes no difference between the two fingerprints, because it
 * cannot see the fields they cover; a reviewer reviews the summary again before any of it is shown
 * again.
 *
 * Layering. Pure and framework-free: no clock read (every instant arrives as a parameter), no
 * store, no data service, no component, no feature, no randomness, no third-party package. The only
 * imports are the civil-date vocabulary and the generic result helpers. `grant.ts` decides whether
 * a coach may read the task-summaries module at all, so admission is settled in one place and this
 * file never re-decides it. Nothing here runs on a timer and nothing here notifies anyone.
 */
import { err, ok, type Result } from "../../lib/result";
import type { CivilDate, CivilDayStart, DatePrecision } from "../time/civil";

/**
 * The maximum length of a reviewed shared-task description, in Unicode code points.
 *
 * Declared once for the whole application so the editor's counter, the review step and the domain
 * validation read the same number: a surface can never show a limit the domain does not enforce.
 */
export const TASK_SUMMARY_MAX_CODE_POINTS = 240;

/**
 * The scenario instant, taken from the resolved day `time/civil.ts` returns.
 *
 * Derived rather than named, so this module never mentions a time library and never reaches for an
 * ambient global: the civil-date module is the one place holding the instant vocabulary, and a
 * parameter typed from it stays assignable to every instant-taking function there.
 */
export type ScenarioInstant = Extract<CivilDayStart, { status: "resolved" }>["instant"];

/**
 * The live status of the task behind a share, as the task model records it.
 *
 * A closed union declared here because no shared task module exists; it mirrors AAP 0.6.2's task
 * status and is not a second task model — this file only ever reads it. `completed` means the
 * worker marked the work done and nothing more: it is not contact, not payment and not a fulfilled
 * promise, so no surface may read it as any of those.
 */
export type TaskStatus = "open" | "completed" | "reopened" | "cancelled";

/**
 * The lifecycle of one share of one task occurrence.
 *
 * Two states only. `shared` means the worker's reviewed summary is available to an admitted coach;
 * `removed` means the worker stopped sharing it. Stopping is a lifecycle change to this record and
 * nothing else — the task keeps its status, its due date and its existence — which is why there is
 * no `deleted` member here.
 */
export type TaskShareState = "shared" | "removed";

/**
 * What a coach-facing surface renders for a share right now: the four readings that must never
 * collapse into one another, and none of which may be rendered as an empty string or a zero.
 *
 * - `shared`: the reviewed summary is current and may be shown.
 * - `needs-review`: the reviewed meaning changed, or the summary was never reviewed, so the
 *   description is withheld until a reviewer reviews it again.
 * - `removed`: the worker stopped sharing it.
 * - `unavailable`: the source behind the summary could not be read — a different fact from "nothing
 *   is shared", and a different fact from an ended relationship.
 */
export type TaskShareSummaryState = "shared" | "needs-review" | "removed" | "unavailable";

/**
 * The machine-readable reasons a function in this module refuses. Each member is produced by at
 * least one exported function, and a caller branches on the value rather than on prose.
 */
export type TaskShareRefusalReason =
  /** The reviewed description is longer than {@link TASK_SUMMARY_MAX_CODE_POINTS}. */
  | "description-too-long"
  /** The description is empty or only whitespace, so there is nothing to review or to show. */
  | "description-empty"
  /** No fingerprint exists on one side, so the summary cannot be treated as current. */
  | "not-reviewed"
  /** A recurring successor was not explicitly selected by the worker. */
  | "successor-needs-fresh-selection"
  /** The caller's expected revision is not the record's current revision. */
  | "stale-revision"
  /** The worker is not sharing this summary, so there is nothing to read or to stop. */
  | "not-shared"
  /** The occurrence this share already covers cannot be selected again as its own successor. */
  | "occurrence-already-shared"
  /** The source behind the summary could not be read. */
  | "unavailable";

/**
 * A refusal, carrying the reason and — where a measurement decided it — the measured value.
 *
 * Expected refusals are values, never exceptions: a caller branches on `reason`, and the
 * length refusal also carries the count it measured beside the limit it broke, so the surface can
 * tell the author exactly how much text to remove without measuring again.
 */
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

/**
 * A task's live due date: dated with the precision it was recorded at, or explicitly undated.
 *
 * Two members on purpose. An undated task is a fact ("no due date") and must stay distinct from a
 * date that is unknown, so `undated` is its own member rather than an absent optional field a
 * caller can forget to handle. The date stays a civil date: no midnight is fabricated and no zone
 * is derived here, which is what keeps a display-zone change from moving a stored due date.
 * `unknown` precision is excluded from the dated member because an unknown date is the undated
 * case, and expressing it twice would let the two disagree.
 */
export type TaskSummaryDueDate =
  | {
      readonly kind: "dated";
      readonly date: CivilDate;
      readonly precision: Exclude<DatePrecision, "unknown">;
    }
  | { readonly kind: "undated" };

/**
 * A description that has passed review: the exact text the worker wrote for sharing, its measured
 * length, and the instant the review happened.
 *
 * The text is returned unaltered, never normalised and never clipped, so what a coach reads is
 * character for character what the worker reviewed.
 */
export type ReviewedTaskSummary = {
  readonly description: string;
  readonly codePoints: number;
  readonly reviewedAt: ScenarioInstant;
};

/**
 * One share of one occurrence of one task.
 *
 * A share covers a single occurrence, which is why the occurrence identity is part of it: a
 * recurring task's next occurrence is a different occurrence and needs a fresh selection
 * ({@link selectSuccessorForSharing}) rather than inheriting this share.
 *
 * `reviewedFingerprint` is the opaque fingerprint the service computed over the task fields this
 * summary was reviewed against. This file never computes it and never interprets it; it compares it
 * with the fingerprint of the fields as they stand at read time, which is how a changed task
 * withholds a stale summary without this module being able to see what changed.
 *
 * `revision` is the share's optimistic revision guard: a command states the revision it read and is
 * refused with `stale-revision` rather than overwriting a newer value.
 */
export type TaskShare = {
  readonly shareId: string;
  readonly occurrenceId: string;
  readonly reviewedSummary: ReviewedTaskSummary;
  readonly reviewedFingerprint: string;
  readonly state: TaskShareState;
  readonly revision: number;
  readonly withdrawnAt?: ScenarioInstant;
};

/**
 * Everything {@link safeTaskSummary} is allowed to know: the reviewed summary's text, the three
 * live values it may pass through, the two fingerprints, whether the source could be read at all,
 * and the share's own state.
 *
 * Both fingerprints are required properties whose type admits absence, so a caller that forgets one
 * fails to compile while a caller that genuinely has none says so. Nothing here names a task field
 * beyond the reviewed description, the due date and the status.
 */
export type SafeTaskSummaryInput = {
  readonly state: TaskShareState;
  readonly description: string;
  readonly dueDate: TaskSummaryDueDate;
  readonly status: TaskStatus;
  readonly reviewedFingerprint: string | undefined;
  readonly currentFingerprint: string | undefined;
  readonly sourceAvailable: boolean;
};

/**
 * The summary a coach may read: the reviewed description, the live due date and the live status,
 * and nothing besides.
 */
export type SharedTaskSummary = {
  readonly state: "shared";
  readonly description: string;
  readonly dueDate: TaskSummaryDueDate;
  readonly status: TaskStatus;
};

/**
 * The summary a coach may not read. It carries the withholding fact and no text at all — not the
 * description, not a shortened form of it, and no hint about which part changed.
 */
export type WithheldTaskSummary = {
  readonly state: "needs-review";
};

/**
 * The result of building a summary: shared, or withheld. Both members' `state` is a member of
 * {@link TaskShareSummaryState}; `removed` and `unavailable` are answered by
 * {@link taskShareReadState} before a summary is built at all.
 */
export type SafeTaskSummary = SharedTaskSummary | WithheldTaskSummary;

/**
 * A stop request: the share as the caller read it, and the revision it read.
 *
 * The input holds nothing else on purpose. Stopping must work while some unrelated draft elsewhere
 * in the application is invalid, so this command validates no other record and depends on no other
 * repository state.
 */
export type StopTaskShareInput = {
  readonly share: TaskShare;
  readonly expectedRevision: number;
};

/**
 * A request to cover a recurring task's next occurrence with a share.
 *
 * `selectedOccurrenceId` is what the worker actually selected in the interface. It is deliberately
 * separate from `occurrenceId`, the occurrence the caller proposes to cover, so a share cannot be
 * inherited by a successor nobody chose: the two must agree exactly.
 */
export type SuccessorSharingRequest = {
  readonly share: TaskShare;
  readonly occurrenceId: string;
  readonly selectedOccurrenceId: string | undefined;
  readonly expectedRevision: number;
};

/**
 * The selected successor occurrence, ready for the service to record as a new share under its own
 * identity: which occurrence is now covered, and the fingerprint its summary is still reviewed
 * against.
 */
export type SelectedSuccessorOccurrence = {
  readonly occurrenceId: string;
  readonly reviewedFingerprint: string;
};

/**
 * What the read-state resolver needs: the share (or its absence, when nothing is shared), the
 * fingerprint of the task fields as they stand now, and whether the source could be read.
 */
export type TaskShareReadStateInput = {
  readonly share: TaskShare | undefined;
  readonly currentFingerprint: string | undefined;
  readonly sourceAvailable: boolean;
};

/**
 * How a reviewed fingerprint stands against the fingerprint of the task fields as they are now.
 *
 * The single comparison in this module: {@link safeTaskSummary} and {@link taskShareReadState} both
 * take their answer from here, so the withholding rule cannot drift between the summary and the
 * state a surface renders. `missing` covers a fingerprint absent on either side — a share that was
 * never reviewed, or a read that could not capture the current fields — and is never treated as
 * current.
 */
type FingerprintVerdict = "current" | "missing" | "changed";

/** The one comparison behind both the summary and the rendered state; see {@link FingerprintVerdict}. */
function fingerprintVerdict(
  reviewedFingerprint: string | undefined,
  currentFingerprint: string | undefined,
): FingerprintVerdict {
  if (reviewedFingerprint === undefined || currentFingerprint === undefined) {
    return "missing";
  }
  return reviewedFingerprint === currentFingerprint ? "current" : "changed";
}

/**
 * Validates a description written for sharing and stamps it as reviewed.
 *
 * The text is validated where it enters the application — here, once — and the reviewed summary is
 * passed through untouched afterwards, so no later layer re-validates it and no layer can shorten
 * it. Whitespace-only text is refused rather than stored: an empty rendering is one of the readings
 * that must stay distinct, so a review with nothing in it never becomes a blank shared summary.
 *
 * @returns the reviewed summary, or a refusal carrying `description-empty`, or
 * `description-too-long` with the measured code-point count and the limit.
 */
export function reviewTaskSummary(
  description: string,
  now: ScenarioInstant,
): Result<ReviewedTaskSummary, TaskShareRefusal> {
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

/**
 * Builds the coach-readable summary, or withholds it.
 *
 * The order of the checks is the order of authority: a removed share has nothing to read; a source
 * that cannot be read is `unavailable` rather than an empty summary; a fingerprint missing on
 * either side is `not-reviewed` rather than assumed current; and only then does the comparison
 * decide between a shared summary and a withheld one.
 *
 * There is no `now` parameter on purpose. Everything this function returns is either a live value
 * the caller read or a verdict about two fingerprints, and none of it ages inside the function; the
 * read envelope the service builds around the result carries the as-of instant surfaces display.
 *
 * @returns the shared summary, the withheld summary, or a refusal (`not-shared`, `unavailable`,
 * `not-reviewed`).
 */
export function safeTaskSummary(
  input: SafeTaskSummaryInput,
): Result<SafeTaskSummary, TaskShareRefusal> {
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

/**
 * Resolves what a coach-facing surface renders for a share, over the closed four-state set.
 *
 * Ordered so a definite local fact outranks an unavailable source: a share the worker stopped is
 * `removed` whether or not the source answers, because that is true regardless. A summary that was
 * never reviewed resolves to `needs-review`, since a reviewer must review it before anything is
 * shown. A task that was never shared for coaching has no share at all and also resolves to
 * `removed`: from the coach's side "nothing is shared now" is what removing a share leaves behind,
 * and the surface offering to share a task works from the absence of a share rather than from this
 * resolver.
 */
export function taskShareReadState(input: TaskShareReadStateInput): TaskShareSummaryState {
  if (input.share === undefined || input.share.state === "removed") {
    return "removed";
  }

  if (!input.sourceAvailable) {
    return "unavailable";
  }

  return fingerprintVerdict(input.share.reviewedFingerprint, input.currentFingerprint) === "current"
    ? "shared"
    : "needs-review";
}

/**
 * Authorises a share to cover a recurring task's next occurrence — only when the worker selected
 * that occurrence explicitly.
 *
 * A completed or skipped occurrence makes its successor actionable, and a share never follows it
 * there on its own: inheriting the predecessor's share would put a summary in front of a coach for
 * a piece of work nobody chose to share. The selection must therefore name the very occurrence
 * being covered, and nothing in this module can produce a successor from the predecessor alone.
 *
 * Checks run in this order: a stopped share covers nothing; a stale expectation cannot act; the
 * occurrence this share already covers is not its own successor; and only a selection naming the
 * proposed occurrence passes.
 *
 * @returns the selected occurrence and the fingerprint its summary is still reviewed against, or a
 * refusal (`not-shared`, `stale-revision`, `occurrence-already-shared`,
 * `successor-needs-fresh-selection`).
 */
export function selectSuccessorForSharing(
  request: SuccessorSharingRequest,
): Result<SelectedSuccessorOccurrence, TaskShareRefusal> {
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

/**
 * Stops sharing one occurrence's summary and returns the share in its removed state.
 *
 * The task is untouched: this function takes a share and returns a share, so no task field exists
 * here to change, and the task's status, due date and existence survive a stop exactly as they
 * were. What a coach could already see is not taken back — stopping never claims to recall, retract
 * or unsend anything already seen — and it is a different effect from withdrawing a check-in,
 * stopping a module, ending the relationship, the coach leaving and revoking the grant.
 *
 * It reads no other record and no other repository state, so a stop succeeds while an unrelated
 * draft elsewhere in the application is invalid: containment must not wait for an editorial
 * cleanup.
 *
 * @returns the share in its removed state with the revision advanced, or a refusal (`not-shared`,
 * `stale-revision`).
 */
export function stopTaskShare(
  input: StopTaskShareInput,
  now: ScenarioInstant,
): Result<TaskShare, TaskShareRefusal> {
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

