/** `/coaching/coach/[subjectId]` — one admitted subject as their coach reads them: only the modules the worker switched on, and the coach's single leave action. */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import CoachSubjectDetail from "@/features/coaching/components/coach-subject-detail";
import StopActions, { type StopRole } from "@/features/coaching/components/stop-actions";
import { COACHING_COPY, MEASURE_COPY, type StopEffect } from "@/features/coaching/copy";
import { reads, type ReadAction } from "@/modules/data-service";
/** The coach's own portfolio: the one address that enumerates the relationships a coach holds, and the way back from a refusal. */
const PORTFOLIO_HREF = "/coaching/coach";
/** The application's default interface language (`DEFAULT_INTERFACE_LOCALE` in the viewer preferences), which states the locale this route composed its surfaces for. */
const INTERFACE_LOCALE = "en-GB";
const PAGE_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const TITLE_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
/** The one action name the subject envelope publishes for the coach's own departure, and the stop effect that name moves. */
const LEAVE_ACTION = "leaveCoaching";
const LEAVE_EFFECT = "coach-leave" as const;
/** The identity this route acts as: the coach, who is offered their own departure and none of the worker-side effects. */
const COACH_ROLE: StopRole = "coach";
/** Props of {@link CoachSubjectPage}. */
export interface CoachSubjectPageProps {
  readonly params: Promise<{ subjectId: string }>;
}
/** The page title is the coaching family's own name for this surface, so the coach reads one wording here and in the section below. */
export const metadata: Metadata = { title: COACHING_COPY.coachSubject.heading };
/** The envelope's own shape, taken from the read rather than restated, so a member the service renames fails to compile here instead of drifting into a second contract. */
type CoachSubjectEnvelope = Extract<Awaited<ReturnType<typeof reads.coach.readCoachSubject>>, { readonly kind: "envelope" }>["envelope"];
type CoachSubject = CoachSubjectEnvelope["data"];
type SubjectModule = CoachSubject["modules"][number];
type SubjectDuration = CoachSubject["duration"];
type SharedCheckIn = Extract<SubjectModule, { readonly module: "check-ins" }>["sharedCheckIns"][number];
type SharedTaskSummary = Extract<SubjectModule, { readonly module: "task-summaries" }>["summaries"][number];
type TargetProgress = Extract<SubjectModule, { readonly module: "targets" }>["progress"][number];
type DueDate = SharedTaskSummary["dueDate"];
/**
 * The lifecycle word the envelope itself supports: the read states the frozen bound it resolved and whether that bound was still ahead when it ran, and it answers an envelope only for a relationship it admitted. A bound still ahead is therefore the episode the coach holds, and a reached one is a share window that closed under it — never a revocation or an ending the coach did not make.
 */
function lifecycleWord(duration: SubjectDuration): "active" | "expired" {
  return duration.openAtRead ? "active" : "expired";
}
/** The end instant as the envelope resolved it, reported as given: this route never recomputes, compares or shortens it. */
function cutoffOf(duration: SubjectDuration): { readonly instant: string; readonly zone: string } | null {
  const instant = duration.boundInstant ?? duration.cutoffInstant;
  return instant === null ? null : { instant, zone: duration.frozenZone ?? "" };
}
/** The questions exactly as the worker worded them and in the order they were captured, each with the answer recorded for it; an unanswered question keeps its place rather than disappearing. */
function checkInsOf(items: readonly SharedCheckIn[]) {
  return items.map((item) => ({
    checkInId: item.revisionId,
    sharedAt: item.sharedAt,
    questions: item.questions.map((question, index) => {
      // An answer states the question it answers; where an older record states none, the captured position is the only pairing it offers.
      const paired = item.answers.find((answer) => answer.questionOrder === question.order);
      const positioned = item.answers[index];
      return { wording: question.wording, answer: paired?.text ?? positioned?.text ?? "" };
    }),
  }));
}
/** A due date's stated precision, narrowed to the three words the surface renders; a task with no date states no date rather than an assumed one. */
function duePrecisionOf(dueDate: DueDate): "date" | "approximate" | "unknown" {
  if (dueDate === null || dueDate.kind === "undated") return "unknown";
  return dueDate.precision === "approximate" || dueDate.precision === "unknown" ? dueDate.precision : "date";
}
function dueDateOf(dueDate: DueDate): string | null {
  return dueDate !== null && dueDate.kind === "dated" ? dueDate.date : null;
}
/** The summaries the worker selected and reviewed: a description is drawn only while the read calls it current, and one held for review carries none. */
function taskSummariesOf(items: readonly SharedTaskSummary[]) {
  return items.map((item) => {
    const base = { shareId: item.shareId, dueOn: dueDateOf(item.dueDate), duePrecision: duePrecisionOf(item.dueDate), status: item.status ?? "" };
    return item.state === "shared" ? { ...base, state: "shared" as const, reviewedDescription: item.description ?? "" } : { ...base, state: item.state, reviewedDescription: null };
  });
}
/** One measured target period, labelled period-first so the dates read first at a narrow width and the measure tells two targets in one period apart. */
function figureOf(entry: TargetProgress) {
  return { periodLabel: `${entry.start} to ${entry.endInclusive} · ${MEASURE_COPY[entry.measure].label}`, value: entry.count, valueState: entry.countState };
}
/**
 * The content one admitted module carries, in the vocabulary the composed surfaces render. Each module's own read state travels beside it untouched, so an empty, partly covered, held, ended or unreadable module is drawn as that state and never as content or as a zero.
 */
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
      // The two financial modules were shared as a reviewed range on the one named basis. This surface draws no amount of its own, so no donor, gift or commitment row and no rebuildable total can be read here.
      return { kind: "financial-range" as const, alreadyRendered: false as const };
  }
}
/** Only the modules the read admitted reach the surface, in the read's own order: nothing here adds, filters, re-orders or hints at a module the worker did not switch on. */
function modulesOf(envelope: CoachSubjectEnvelope) {
  return envelope.data.modules.map((module) => ({ key: module.module, state: module.state, body: bodyOf(module, envelope) }));
}
function subjectOf(view: CoachSubject) {
  // The worker is named by the identity this read reports and by nothing else: a resemblance in name, address or email establishes neither identity nor authority, and none of them is read here.
  return { subjectId: view.grantId, displayName: view.workerPrincipalId, grantState: lifecycleWord(view.duration), cutoffDisplay: cutoffOf(view.duration) };
}
/** The stop-type effects the subject envelope itself published, in its own closed vocabulary: the coach holds one, and an effect the read withheld is never invented here. */
function admittedLeave(actions: readonly ReadAction[]): readonly StopEffect[] {
  return actions.some((action) => action.name === LEAVE_ACTION && action.available) ? [LEAVE_EFFECT] : [];
}
/** One subject the coach holds a grant for. */
export default async function CoachSubjectPage({ params }: CoachSubjectPageProps): Promise<ReactElement> {
  const { subjectId } = await params;
  // The organisation, ministry, support subject and principal are derived by the service from this session. The route supplies the opaque subject it was asked for and nothing that could invent authority.
  const result = await reads.coach.readCoachSubject({ grantId: subjectId });
  switch (result.kind) {
    case "envelope": {
      const { envelope } = result;
      const view = envelope.data;
      return (
        <div className={PAGE_CLASS}>
          {/* The one h1 on this page: the composed surfaces open their own sections at level two, so the outline starts here and nothing repeats the shell's chrome. */}
          <h1 className={TITLE_CLASS}>{COACHING_COPY.coachSubject.heading}</h1>
          <CoachSubjectDetail subject={subjectOf(view)} modules={modulesOf(envelope)} locale={INTERFACE_LOCALE} />
          {/* The coach's own departure, and only it: the worker-side stop effects belong to the worker's surfaces, and the component offers a coach nothing else. */}
          <StopActions available={admittedLeave(envelope.actions)} target={{ grantId: view.grantId, episodeState: lifecycleWord(view.duration) }} scope={envelope.scope} expectedRevision={envelope.revision} role={COACH_ROLE} headingLevel={2} />
        </div>
      );
    }
    case "denied":
      // Authorisation precedes enumeration, so an unknown subject and one this coach does not hold answer identically: no module name, count, title, identifier, source reference or size travels with this refusal, and the requested identifier is never echoed. A not-found route is deliberately not used, because it would turn "not yours" into "does not exist".
      return (
        <div className={PAGE_CLASS}>
          <StateNotice kind="denied" headingLevel={1} title={COACHING_COPY.coachSubject.heading} reasonCode={result.denied.reasonCode} action={{ label: COACHING_COPY.coachPortfolio.heading, href: PORTFOLIO_HREF }} />
        </div>
      );
    case "unavailable":
      // The source behind the relationship did not answer, so this is reported as an outage rather than as an empty subject, and the independent work on the portfolio stays usable.
      return (
        <div className={PAGE_CLASS}>
          <StateNotice kind="unavailable" headingLevel={1} title={COACHING_COPY.coachSubject.heading} description={COACHING_COPY.coachSubject.unavailable} source={result.unavailable.source} action={{ label: COACHING_COPY.coachPortfolio.heading, href: PORTFOLIO_HREF }} />
        </div>
      );
    case "refused":
      // This route calls the read directly, so no request of its own is refused and the coaching source did not fail: the arm is stated in the same shape as the others instead of being thrown.
      return (
        <div className={PAGE_CLASS}>
          <StateNotice kind="refused" headingLevel={1} title={COACHING_COPY.coachSubject.heading} action={{ label: COACHING_COPY.coachPortfolio.heading, href: PORTFOLIO_HREF }} />
        </div>
      );
  }
}
