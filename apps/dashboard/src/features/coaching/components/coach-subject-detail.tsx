"use client";
import { useId, useMemo, type ReactElement } from "react";
import { ChartFigure, type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps, VALUE_STATE_WORDS, valueStateWord, type StatusTone } from "@/components/status-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COMPLETE_COPY, MODULE_COPY, MODULE_READ_STATE_COPY } from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { compareCodeUnits } from "@/lib/ordering";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey, type ModuleReadState } from "@/modules/coaching/grant";
import type { TaskShareSummaryState } from "@/modules/coaching/taskshare";
import type { Coverage, CoverageState, ValueState } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { SUPPORT_MEASURE_LABELS, type SupportMeasure } from "@/modules/support/basis";
import type { CivilDate, DatePrecision } from "@/modules/time/civil";
import { civilDateText, MODULE_READ_STATE_TONE, ModuleReadStateNotice } from "./sharing-summary";
const CUTOFF_ABSENT = "This relationship states no end instant, so this page states none.";
const DUE_PRECISION_WORD: Readonly<Record<DatePrecision, string | null>> = { date: null, approximate: "approximate", unknown: "date not confirmed" };
const COACH_SHARE_STATE_COPY: Readonly<Record<TaskShareSummaryState, { readonly label: string; readonly sentence: string }>> = {
  shared: { label: "Shared", sentence: "The worker reviewed this description against the task as it stands, so it is current." },
  "needs-review": { label: "Held until reviewed", sentence: "The reviewed meaning changed, so the description is withheld until the worker reviews it again. Nothing of it is shown in the meantime, and this is not an empty share." },
  removed: { label: "No longer shared", sentence: "The worker stopped sharing this summary. The task itself keeps working; only this summary is withdrawn from this view." },
  unavailable: { label: "Unavailable", sentence: "The task behind this summary cannot be read at the moment. This is an outage, not an empty share and not a removal." },
};
/** What each module carries for the coach who reads it, in the coach's own voice, beside what it never carries. The worker-facing `MODULE_COPY` sentence addresses the worker and stays on the worker's surfaces. */
const COACH_MODULE_PURPOSE_COPY: Readonly<Record<ModuleKey, string>> = {
  "support-goal": "You read the support goal set for this ministry — its amount, the measure it is counted in and the date it took effect — and never a gift row, a donor, a commitment or a per-record amount behind it.",
  "support-results": "You read the support received over the one fixed range of dates the worker reviewed before sharing it, on the one named basis every figure in this application measures, and never a gift row, a donor, a commitment or any way to rebuild a total.",
  targets: "You read the targets the worker set and the count recorded for each period, and never the label the worker gave a target, a private note or a donor.",
  "check-ins": "You read only the check-in revisions the worker shared deliberately, with the questions as they were worded when the writing started, and never the private draft or an answer the worker kept to themselves.",
  "task-summaries": "You read only the task summaries the worker reviewed for this purpose, with each task's live due date and status, and never the task's own title, notes, links, history or a donor.",
};
/** What a module the read answers `null` for says on this surface: the share is complete, stated for the coach who is reading rather than in the worker's second person the family's complete-share sentence uses. */
const COACH_COMPLETE_SENTENCE = "This module is shared in full for this relationship: nothing in it is held, missing or unavailable, and it stays readable only until the access end stated above.";
/** The statement a list holds when it has nothing to show under this relationship: an empty list is said in words rather than left as a heading. */
const EMPTY_LIST_COPY: Readonly<Record<"check-ins" | "task-shares", string>> = { "check-ins": "No check-in revision has been shared with you under this relationship.", "task-shares": "No task summary has been shared with you under this relationship." };
const TARGETS_SERIES_LABEL = "Recorded";
const TARGETS_TABLE_CAPTION = "Recorded target counts by period, the data table alternative to the chart.";
const PERIOD_COLUMN_LABEL = "Period";
type CivilDateInput = CivilDate | string;
type SharedCheckInQuestion = { readonly wording: string; readonly answer: string };
type SharedCheckIn = { readonly checkInId: string; readonly sharedAt: string; readonly questions: readonly SharedCheckInQuestion[] };
type SharedTaskSummaryBase = { readonly shareId: string; readonly dueOn: CivilDateInput | null; readonly duePrecision: DatePrecision; readonly status: string };
type SharedTaskSummary = (SharedTaskSummaryBase & { readonly state: "shared"; readonly reviewedDescription: string }) | (SharedTaskSummaryBase & { readonly state: Exclude<TaskShareSummaryState, "shared">; readonly reviewedDescription: null });
type TargetProgressFigure = { readonly periodLabel: string; readonly value: number | null; readonly valueState: ValueState };
type GoalFigure = { readonly amount: Money; readonly measure: string; readonly effectiveFrom: CivilDateInput; readonly valueState: ValueState };
type ReceivedFigure = { readonly currency: string; readonly minorUnits: number | null; readonly valueState: ValueState; readonly periodState: string; readonly coverageState: CoverageState; readonly from: CivilDateInput; readonly to: CivilDateInput };
type ReviewedRange = { readonly from: CivilDateInput; readonly to: CivilDateInput; readonly currency: string };
type SupportResultsBody = { readonly kind: "support-results"; readonly basis: string; readonly range: ReviewedRange | null; readonly received: readonly ReceivedFigure[]; readonly figureProblem: string | null; readonly asOf: string };
type ModuleBody =
  | { readonly kind: "check-ins"; readonly items: readonly SharedCheckIn[] }
  | { readonly kind: "task-shares"; readonly items: readonly SharedTaskSummary[] }
  | { readonly kind: "target-progress"; readonly figures: readonly TargetProgressFigure[]; readonly coverage: Coverage; readonly asOf: string }
  | { readonly kind: "support-goal"; readonly goal: GoalFigure | null }
  | SupportResultsBody;
type AdmittedModule = { readonly key: ModuleKey; readonly state: ModuleReadState | null; readonly body: ModuleBody };
type CoachSubjectDetailProps = {
  readonly subject: { readonly subjectId: string; readonly displayName: string; readonly grantState: GrantLifecycleState; readonly cutoffDisplay: { readonly instant: string; readonly zone: string } | null };
  readonly modules: readonly AdmittedModule[];
  readonly unavailableSource?: SourceReference | null;
  readonly locale: string;
};
const SHARE_STATE_TONE: Readonly<Record<TaskShareSummaryState, StatusTone>> = { shared: "positive", "needs-review": "caution", removed: "neutral", unavailable: "danger" };
const CheckInList = ({ checkIns }: { readonly checkIns: readonly SharedCheckIn[] }): ReactElement => (
  <ul className="flex min-w-0 flex-col gap-4">
    {checkIns.map((checkIn) => (
      <li key={checkIn.checkInId} className="flex min-w-0 flex-col gap-2">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 type-body">
          <span className="font-medium">{"Shared on"}</span>
          <bdi className="mono-identifier">{checkIn.sharedAt}</bdi>
        </p>
        {checkIn.questions.length === 0 ? (
          <p className="type-supporting text-pretty">{"This shared revision carries no questions."}</p>
        ) : (
          <dl className="flex min-w-0 flex-col gap-2">
            {checkIn.questions.map((question, index) => (
              <div key={`${checkIn.checkInId}-question-${String(index)}`} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-sm font-medium text-pretty">{question.wording}</dt>
                {question.answer.trim().length === 0 ? <dd className="type-supporting text-pretty">{"No answer recorded"}</dd> : <dd className="whitespace-pre-line type-body text-pretty">{question.answer}</dd>}
              </div>
            ))}
          </dl>
        )}
      </li>
    ))}
  </ul>
);
function DueDateText({ share }: { readonly share: SharedTaskSummary }): ReactElement {
  if (share.dueOn === null) return <bdi>{"No due date"}</bdi>;
  const word = DUE_PRECISION_WORD[share.duePrecision];
  return (
    <>
      <bdi className="mono-identifier">{civilDateText(share.dueOn)}</bdi>
      {word === null ? null : <span className="text-muted-foreground">{` (${word})`}</span>}
    </>
  );
}
const TaskShareList = ({ shares }: { readonly shares: readonly SharedTaskSummary[] }): ReactElement => (
  <ul className="flex min-w-0 flex-col gap-4">
    {shares.map((share) => {
      const stateCopy = COACH_SHARE_STATE_COPY[share.state];
      const description = share.state === "shared" ? share.reviewedDescription : null;
      const status = share.status.trim();
      return (
        <li key={share.shareId} className="flex min-w-0 flex-col gap-2">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 type-body">
            <StatusBadge label={stateCopy.label} tone={SHARE_STATE_TONE[share.state]} srPrefix={"Summary"} />
            <span className="flex min-w-0 items-baseline gap-x-1.5">
              <span className="font-medium">{"Due"}</span>
              <DueDateText share={share} />
            </span>
            {status.length === 0 ? null : (
              <span className="flex min-w-0 items-baseline gap-x-1.5">
                <span className="font-medium">{"Status"}</span>
                <bdi>{status}</bdi>
              </span>
            )}
          </p>
          {description === null || description.trim().length === 0 ? null : <p className="whitespace-pre-line type-body text-pretty">{description}</p>}
          {share.state === "shared" ? null : <p className="type-supporting text-pretty">{stateCopy.sentence}</p>}
        </li>
      );
    })}
  </ul>
);
function figureText(figure: TargetProgressFigure): string {
  const { value, valueState } = figure;
  const carriesNumber = value !== null && Number.isFinite(value);
  const word = valueStateWord(valueState);
  if (word === undefined) {
    if (valueState === "zero") return String(0);
    return carriesNumber ? String(value) : VALUE_STATE_WORDS.unknown.label;
  }
  return carriesNumber ? `${String(value)} (${word.label})` : word.label;
}
function TargetProgressChart({ body, locale }: { readonly body: Extract<ModuleBody, { readonly kind: "target-progress" }>; readonly locale: string }): ReactElement {
  const points = useMemo<readonly ChartPoint[]>(() => body.figures.map((figure) => ({ bucket: figure.periodLabel, value: figure.value, state: figure.valueState })), [body]);
  const series = useMemo<readonly ChartSeries[]>(() => [{ key: "recorded", label: TARGETS_SERIES_LABEL, points }], [points]);
  const table: ChartTable = {
    caption: TARGETS_TABLE_CAPTION,
    columns: [
      { key: "period", label: PERIOD_COLUMN_LABEL },
      { key: "recorded", label: TARGETS_SERIES_LABEL },
    ],
    rows: body.figures.map((figure) => ({ period: figure.periodLabel, recorded: figureText(figure) })),
  };
  return (
    <ChartFigure
      title={MODULE_COPY.targets.name}
      summary={"Each bar is the count recorded for one period, taken from the activity the worker logged. A period with no recorded value is named in the table beneath the chart rather than drawn as zero."}
      caption={"Bar chart of recorded target counts by period for this worker."}
      kind="bar"
      series={series}
      units={"Recorded counts per period"}
      coverage={body.coverage}
      asOf={body.asOf}
      table={table}
      locale={locale}
    />
  );
}
const EXPECTED_BODY_KIND: Readonly<Record<ModuleKey, ModuleBody["kind"]>> = { "support-goal": "support-goal", "support-results": "support-results", targets: "target-progress", "check-ins": "check-ins", "task-summaries": "task-shares" };
/** The word one module carries: the read's own state, or the complete share the read answers `null` for, in the same vocabulary the worker's sharing summary states a module in. */
function moduleStateWord(state: ModuleReadState | null): { readonly label: string; readonly tone: StatusTone } {
  if (state === null) return { label: MODULE_COMPLETE_COPY.label, tone: "positive" };
  return { label: MODULE_READ_STATE_COPY[state].label, tone: MODULE_READ_STATE_TONE[state] };
}
const ISO_TEXT_CLASS = "mono-identifier whitespace-nowrap";
const GOAL_AMOUNT_LABEL = "Goal amount";
const GOAL_COLUMN_LABEL = { amount: "Amount", measure: "Measure", effectiveFrom: "Effective from" } as const;
const GOAL_TABLE_CAPTION = "The support goal this relationship shares, as a table: its amount, the measure it is counted in and the date it took effect.";
const isSupportMeasure = (measure: string): measure is SupportMeasure => Object.hasOwn(SUPPORT_MEASURE_LABELS, measure);
const measureText = (measure: string): ReactElement => (isSupportMeasure(measure) ? <bdi>{SUPPORT_MEASURE_LABELS[measure]}</bdi> : <bdi className="mono-identifier">{measure}</bdi>);
function SupportGoalFigure({ goal, locale }: { readonly goal: GoalFigure; readonly locale: string }): ReactElement {
  const formatting = formatMinor(goal.amount, goal.valueState, locale);
  const measure = measureText(goal.measure);
  const effectiveFrom = civilDateText(goal.effectiveFrom);
  return (
    <figure data-slot="coach-support-goal" className="flex min-w-0 flex-col gap-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        <span>
          <bdi>{MODULE_COPY["support-goal"].name}</bdi>
        </span>
        <StatusBadge label={GOAL_AMOUNT_LABEL} valueState={goal.valueState} />
      </figcaption>
      <p className="tabular-figures text-2xl font-semibold text-end break-words">
        <bdi>{formatting.text}</bdi>
        {formatting.accessibleLabel === formatting.text ? null : <span className="sr-only">{formatting.accessibleLabel}</span>}
      </p>
      <p className="text-sm text-pretty text-muted-foreground">
        {"Counted in "}
        {measure}
        {", taking effect from "}
        <bdi className={ISO_TEXT_CLASS}>{effectiveFrom}</bdi>
        {"."}
      </p>
      <div className="flex min-w-0 flex-col gap-2">
        <p aria-hidden="true" className="text-sm text-muted-foreground">
          {GOAL_TABLE_CAPTION}
        </p>
        <ScrollRegion label={`${MODULE_COPY["support-goal"].name}: data table`}>
          <Table>
            <TableCaption className="sr-only">{GOAL_TABLE_CAPTION}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{GOAL_COLUMN_LABEL.amount}</TableHead>
                <TableHead scope="col">{GOAL_COLUMN_LABEL.measure}</TableHead>
                <TableHead scope="col">{GOAL_COLUMN_LABEL.effectiveFrom}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="tabular-figures">
                  <bdi>{formatting.text}</bdi>
                </TableCell>
                <TableCell>{measure}</TableCell>
                <TableCell>
                  <bdi className={ISO_TEXT_CLASS}>{effectiveFrom}</bdi>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ScrollRegion>
      </div>
    </figure>
  );
}
const RECEIVED_COLUMN_LABEL = { currency: "Currency", received: "Received", period: "Period", valueState: "Value state" } as const;
const RECEIVED_TABLE_CAPTION = "The received support this relationship shares, one row per figure the read projected for the reviewed range: its currency, its amount, the period it covers and the state of the value.";
const RECEIVED_STATE_LABEL: Readonly<Record<ValueState, string>> = { value: "Recorded amount", zero: "Genuine zero", unknown: "Unknown", withheld: "Withheld", unavailable: "Unavailable", "incomplete-subtotal": "Incomplete subtotal" };
const NUMERIC_STATES: ReadonlySet<ValueState> = new Set<ValueState>(["value", "zero", "incomplete-subtotal"]);
const NO_RECEIVED_FIGURE = "The report returned no figure in the reviewed range's currency, which is an empty result rather than a zero.";
const COVERAGE_STATEMENT: Readonly<Record<CoverageState, string>> = {
  complete: "The source reports this reviewed period as fully covered, so the received figure is a whole-period figure rather than a subtotal.",
  partial: "The source reports this reviewed period as only partly covered, so the received figure is an incomplete subtotal and never a whole-period total.",
  unknown: "Whether the source covers this whole reviewed period is not known, so the received figure is an incomplete subtotal rather than a whole-period figure.",
};
/** The coverage each figure was measured under, taken from that figure's own report rather than from the read envelope: a row that states an incomplete subtotal is never announced beside a sentence claiming complete coverage. */
function coverageStatementsOf(figures: readonly ReceivedFigure[]): readonly string[] {
  const states = [...new Set(figures.map((figure) => figure.coverageState))].toSorted(compareCodeUnits);
  return states.map((state) => COVERAGE_STATEMENT[state]);
}
const RUNNING_PERIOD_WORD = "In progress";
/** The read's own reason the figures could not be projected, stated as a sentence of this surface: a figure that could not be read is never shown as zero or left unstated. */
function figureProblemText(problem: string): string {
  const trimmed = problem.trim();
  const terminated = trimmed.endsWith(".") || trimmed.endsWith("!") || trimmed.endsWith("?") ? trimmed : `${trimmed}.`;
  return `No received figure is stated for this reviewed range: ${terminated}`;
}
function receivedTextOf(figure: ReceivedFigure, locale: string): { readonly text: string; readonly accessibleLabel: string; readonly state: ValueState } {
  const state: ValueState = figure.minorUnits === null && NUMERIC_STATES.has(figure.valueState) ? "unknown" : figure.valueState;
  const formatting = formatMinor({ currency: figure.currency, minorUnits: minorUnitsOf(figure.minorUnits ?? 0) }, state, locale);
  return { text: formatting.text, accessibleLabel: formatting.accessibleLabel, state };
}
function SupportResultsFigure({ body, locale }: { readonly body: SupportResultsBody; readonly locale: string }): ReactElement {
  const figures = body.received.map((figure) => ({ currency: figure.currency, ...receivedTextOf(figure, locale), period: `${civilDateText(figure.from)} to ${civilDateText(figure.to)}`, running: figure.periodState === "in-progress" }));
  const summary = figures.length === 1 ? "one received figure" : `${String(figures.length)} received figures`;
  return (
    <figure data-slot="coach-support-results" className="flex min-w-0 flex-col gap-3">
      <figcaption className="flex flex-col gap-1">
        <span className="text-base font-medium">
          <bdi>{MODULE_COPY["support-results"].name}</bdi>
        </span>
        <span className="text-sm text-muted-foreground">
          {"Units: received support on the one named basis, "}
          <bdi className="mono-identifier">{body.basis}</bdi>
          {"."}
        </span>
        {body.range === null ? null : (
          <span className="text-sm text-muted-foreground">
            {"Reviewed range: "}
            <bdi className={ISO_TEXT_CLASS}>{civilDateText(body.range.from)}</bdi>
            {" to "}
            <bdi className={ISO_TEXT_CLASS}>{civilDateText(body.range.to)}</bdi>
            {", in "}
            <bdi className="mono-identifier">{body.range.currency}</bdi>
            {" only."}
          </span>
        )}
        {coverageStatementsOf(body.received).map((sentence) => (
          <span key={sentence} className="text-sm text-muted-foreground">
            {sentence}
          </span>
        ))}
        <span className="text-sm text-muted-foreground">
          {"As of "}
          <bdi className={ISO_TEXT_CLASS}>{body.asOf}</bdi>
          {", which is when these figures were read rather than when the source last changed."}
        </span>
      </figcaption>
      {body.figureProblem === null ? null : <p className="text-sm text-pretty text-muted-foreground">{figureProblemText(body.figureProblem)}</p>}
      {figures.length === 0 ? (
        body.figureProblem === null ? (
          <p className="text-sm text-pretty text-muted-foreground">{NO_RECEIVED_FIGURE}</p>
        ) : null
      ) : (
        <>
          <p className="text-sm text-pretty">{`This figure states ${summary} for the reviewed range, one row per currency the read reports, and never a per-record amount behind them.`}</p>
          <div className="flex min-w-0 flex-col gap-2">
            <p aria-hidden="true" className="text-sm text-muted-foreground">
              {RECEIVED_TABLE_CAPTION}
            </p>
            <ScrollRegion label={`${MODULE_COPY["support-results"].name}: data table`}>
              <Table>
                <TableCaption className="sr-only">{RECEIVED_TABLE_CAPTION}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{RECEIVED_COLUMN_LABEL.currency}</TableHead>
                    <TableHead scope="col">{RECEIVED_COLUMN_LABEL.received}</TableHead>
                    <TableHead scope="col">{RECEIVED_COLUMN_LABEL.period}</TableHead>
                    <TableHead scope="col">{RECEIVED_COLUMN_LABEL.valueState}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {figures.map((figure) => (
                    <TableRow key={figure.currency}>
                      <TableCell>
                        <bdi className="mono-identifier">{figure.currency}</bdi>
                      </TableCell>
                      <TableCell className="tabular-figures">
                        <bdi>{figure.text}</bdi>
                        {figure.accessibleLabel === figure.text ? null : <span className="sr-only">{figure.accessibleLabel}</span>}
                      </TableCell>
                      <TableCell>
                        <bdi className={ISO_TEXT_CLASS}>{figure.period}</bdi>
                        {figure.running ? ` (${RUNNING_PERIOD_WORD})` : null}
                      </TableCell>
                      <TableCell>{RECEIVED_STATE_LABEL[figure.state]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          </div>
        </>
      )}
    </figure>
  );
}
function ModuleBodyView({ body, locale }: { readonly body: ModuleBody; readonly locale: string }): ReactElement | null {
  switch (body.kind) {
    case "check-ins":
      return body.items.length === 0 ? null : <CheckInList checkIns={body.items} />;
    case "task-shares":
      return body.items.length === 0 ? null : <TaskShareList shares={body.items} />;
    case "target-progress":
      return <TargetProgressChart body={body} locale={locale} />;
    case "support-goal":
      return body.goal === null ? null : <SupportGoalFigure goal={body.goal} locale={locale} />;
    case "support-results":
      return <SupportResultsFigure body={body} locale={locale} />;
  }
}
function ModulePanel({ entry, unavailableSource, locale }: { readonly entry: AdmittedModule; readonly unavailableSource: SourceReference | null | undefined; readonly locale: string }): ReactElement {
  const baseId = useId();
  const titleId = `${baseId}-module-title`;
  const copy = MODULE_COPY[entry.key];
  const state = moduleStateWord(entry.state);
  const body = entry.body.kind === EXPECTED_BODY_KIND[entry.key] ? entry.body : null;
  const drawsContent = entry.state === null || entry.state === "partial";
  const listBody = body === null || (body.kind !== "check-ins" && body.kind !== "task-shares") ? null : body;
  const emptyList = listBody !== null && listBody.items.length === 0;
  // A module whose own state word already says nothing is recorded keeps that one statement; a list that is empty under any other state says so in words here, so no panel is left with nothing but its heading.
  const emptyStatement = listBody !== null && emptyList && entry.state !== "empty" ? EMPTY_LIST_COPY[listBody.kind] : null;
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 id={titleId} className="type-subsection-title text-pretty">
              <bdi>{copy.name}</bdi>
            </h3>
          </CardTitle>
          <CardAction>
            <StatusBadge label={state.label} tone={state.tone} srPrefix={"State"} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          {entry.state === null ? <p className="text-sm text-pretty text-muted-foreground">{COACH_COMPLETE_SENTENCE}</p> : <ModuleReadStateNotice readState={entry.state} source={unavailableSource ?? null} headingLevel={4} />}
          <p className="text-sm text-pretty text-muted-foreground">{COACH_MODULE_PURPOSE_COPY[entry.key]}</p>
          {emptyStatement === null ? null : <p className="text-sm text-pretty text-muted-foreground">{emptyStatement}</p>}
          {drawsContent && body !== null && !emptyList ? <ModuleBodyView body={body} locale={locale} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}
function admittedInOrder(modules: readonly AdmittedModule[]): readonly AdmittedModule[] {
  const byKey = new Map<ModuleKey, AdmittedModule>();
  for (const entry of modules) if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
  return MODULE_KEYS.flatMap((key) => {
    const found = byKey.get(key);
    return found === undefined ? [] : [found];
  });
}
export default function CoachSubjectDetail({ subject, modules, unavailableSource, locale }: CoachSubjectDetailProps): ReactElement {
  const headingId = useId();
  const admitted = admittedInOrder(modules);
  const first = admitted[0];
  const lifecycle = GRANT_STATE_COPY[subject.grantState];
  const cutoff = subject.cutoffDisplay;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-5">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="type-section-title text-pretty">
              <bdi>{subject.displayName}</bdi>
            </h2>
          </CardTitle>
          <CardDescription>{COACHING_COPY.coachSubject.purpose}</CardDescription>
          <CardAction>
            <StatusBadge label={lifecycle.label} tone={statusBadgeProps(COACHING_STATUS, subject.grantState).tone} srPrefix={"Access"} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className={cn("type-body text-pretty", cutoff === null ? "text-muted-foreground" : null)}>
            {cutoff === null ? (
              CUTOFF_ABSENT
            ) : (
              <>
                {"Access ends at "}
                <bdi className="mono-identifier">{cutoff.instant}</bdi>
                {" in "}
                <bdi className="mono-identifier">{cutoff.zone}</bdi>
                {`. ${"Access ends at this instant, and a read at it is denied. The modules below stay readable only until then; nothing on this page extends or moves that end."}`}
              </>
            )}
          </p>
          <Separator />
          <p className="type-supporting text-pretty">{"This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was already read."}</p>
        </CardContent>
      </Card>
      {first === undefined ? (
        <StateNotice kind="empty" headingLevel={2} title={COACHING_COPY.coachSubject.heading} description={"No module is shared with you under this relationship, so there is nothing here to read. The lifecycle word above says why."} />
      ) : (
        <Tabs defaultValue={first.key} className="gap-3">
          <TabsList aria-label={"Modules this worker shares"} className="h-auto w-full max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
            {admitted.map((entry) => (
              <TabsTrigger key={entry.key} value={entry.key} className="h-8 flex-none">
                <bdi>{MODULE_COPY[entry.key].name}</bdi>
              </TabsTrigger>
            ))}
          </TabsList>
          {admitted.map((entry) => (
            <TabsContent key={entry.key} value={entry.key} aria-label={MODULE_COPY[entry.key].name} className="min-w-0">
              <ModulePanel entry={entry} unavailableSource={unavailableSource} locale={locale} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}
