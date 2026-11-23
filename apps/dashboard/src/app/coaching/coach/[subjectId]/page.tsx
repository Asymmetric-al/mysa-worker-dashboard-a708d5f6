import type { Metadata } from "next";
import type { ReactElement } from "react";
import CoachSubjectDetail from "@/features/coaching/components/coach-subject-detail";
import StopActions, { type StopRole } from "@/features/coaching/components/stop-actions";
import { COACHING_COPY, MEASURE_COPY, type StopEffect } from "@/features/coaching/copy";
import { reads, type ReadAction } from "@/modules/data-service";
import { ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
const PORTFOLIO_HREF = "/coaching/coach";
const PAGE_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const LEAVE_EFFECT = "coach-leave" as const;
const COACH_ROLE: StopRole = "coach";
export const metadata: Metadata = { title: COACHING_COPY.coachSubject.heading };
type CoachSubjectEnvelope = Extract<Awaited<ReturnType<typeof reads.coach.readCoachSubject>>, { readonly kind: "envelope" }>["envelope"];
type CoachSubject = CoachSubjectEnvelope["data"];
type SubjectModule = CoachSubject["modules"][number];
type SubjectDuration = CoachSubject["duration"];
type SharedCheckIn = Extract<SubjectModule, { readonly module: "check-ins" }>["sharedCheckIns"][number];
type SharedTaskSummary = Extract<SubjectModule, { readonly module: "task-summaries" }>["summaries"][number];
type TargetProgress = Extract<SubjectModule, { readonly module: "targets" }>["progress"][number];
type DueDate = SharedTaskSummary["dueDate"];
const lifecycleWord = (duration: SubjectDuration): "active" | "expired" => (duration.openAtRead ? "active" : "expired");
function cutoffOf(duration: SubjectDuration): { readonly instant: string; readonly zone: string } | null {
  const instant = duration.boundInstant ?? duration.cutoffInstant;
  return instant === null ? null : { instant, zone: duration.frozenZone ?? "" };
}
function checkInsOf(items: readonly SharedCheckIn[]) {
  return items.map((item) => ({
    checkInId: item.revisionId,
    sharedAt: item.sharedAt,
    questions: item.questions.map((question, index) => {
      const paired = item.answers.find((answer) => answer.questionOrder === question.order);
      const positioned = item.answers[index];
      return { wording: question.wording, answer: paired?.text ?? positioned?.text ?? "" };
    }),
  }));
}
function duePrecisionOf(dueDate: DueDate): "date" | "approximate" | "unknown" {
  if (dueDate === null || dueDate.kind === "undated") return "unknown";
  return dueDate.precision === "approximate" || dueDate.precision === "unknown" ? dueDate.precision : "date";
}
const dueDateOf = (dueDate: DueDate): string | null => (dueDate !== null && dueDate.kind === "dated" ? dueDate.date : null);
function taskSummariesOf(items: readonly SharedTaskSummary[]) {
  return items.map((item) => {
    const base = { shareId: item.shareId, dueOn: dueDateOf(item.dueDate), duePrecision: duePrecisionOf(item.dueDate), status: item.status ?? "" };
    return item.state === "shared" ? { ...base, state: "shared" as const, reviewedDescription: item.description ?? "" } : { ...base, state: item.state, reviewedDescription: null };
  });
}
const figureOf = (entry: TargetProgress) => ({ periodLabel: `${entry.start} to ${entry.endInclusive} · ${MEASURE_COPY[entry.measure].label}`, value: entry.count, valueState: entry.countState });
function bodyOf(module: SubjectModule, envelope: CoachSubjectEnvelope) {
  switch (module.module) {
    case "check-ins":
      return { kind: "check-ins" as const, items: checkInsOf(module.sharedCheckIns) };
    case "task-summaries":
      return { kind: "task-shares" as const, items: taskSummariesOf(module.summaries) };
    case "targets":
      return { kind: "target-progress" as const, figures: module.progress.map(figureOf), coverage: envelope.coverage, asOf: envelope.asOf };
    case "support-goal":
    case "support-results":
      return { kind: "financial-range" as const, alreadyRendered: false as const };
  }
}
const modulesOf = (envelope: CoachSubjectEnvelope) => envelope.data.modules.map((module) => ({ key: module.module, state: module.state, body: bodyOf(module, envelope) }));
const subjectOf = (view: CoachSubject) => ({ subjectId: view.grantId, displayName: view.workerPrincipalId, grantState: lifecycleWord(view.duration), cutoffDisplay: cutoffOf(view.duration) });
const admittedLeave = (actions: readonly ReadAction[]): readonly StopEffect[] => (actions.some((action) => action.name === "leaveCoaching" && action.available) ? [LEAVE_EFFECT] : []);
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: COACHING_COPY.coachSubject.heading, action: { label: COACHING_COPY.coachPortfolio.heading, href: PORTFOLIO_HREF } },
  unavailable: { title: COACHING_COPY.coachSubject.heading, body: COACHING_COPY.coachSubject.unavailable, action: { label: COACHING_COPY.coachPortfolio.heading, href: PORTFOLIO_HREF } },
  refused: { title: COACHING_COPY.coachSubject.heading, action: { label: COACHING_COPY.coachPortfolio.heading, href: PORTFOLIO_HREF } },
};
/** One subject the coach holds a grant for. */
export default async function CoachSubjectPage({ params }: { readonly params: Promise<{ subjectId: string }> }): Promise<ReactElement> {
  const { subjectId } = await params;
  const result = await reads.coach.readCoachSubject({ grantId: subjectId });
  if (result.kind !== "envelope") return <ReadNotices failure={result} copy={NOTICE_COPY} className={PAGE_CLASS} />;
  const { envelope } = result;
  const view = envelope.data;
  return (
    <div className={PAGE_CLASS}>
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{COACHING_COPY.coachSubject.heading}</h1>
      <CoachSubjectDetail subject={subjectOf(view)} modules={modulesOf(envelope)} locale="en-GB" />
      <StopActions available={admittedLeave(envelope.actions)} target={{ grantId: view.grantId, episodeState: lifecycleWord(view.duration) }} scope={envelope.scope} expectedRevision={envelope.revision} role={COACH_ROLE} headingLevel={2} />
    </div>
  );
}
