"use client";
import { useId, useMemo, type ReactElement } from "react";
import { ChartFigure, type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps, VALUE_STATE_WORDS, valueStateWord, type StatusTone } from "@/components/status-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COPY, MODULE_READ_STATE_COPY } from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey, type ModuleReadState } from "@/modules/coaching/grant";
import type { TaskShareSummaryState } from "@/modules/coaching/taskshare";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
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
const TARGETS_SERIES_LABEL = "Recorded";
const TARGETS_TABLE_CAPTION = "Recorded target counts by period, the data table alternative to the chart.";
const PERIOD_COLUMN_LABEL = "Period";
type CivilDateInput = CivilDate | string;
type SharedCheckInQuestion = { readonly wording: string; readonly answer: string };
type SharedCheckIn = { readonly checkInId: string; readonly sharedAt: string; readonly questions: readonly SharedCheckInQuestion[] };
type SharedTaskSummaryBase = { readonly shareId: string; readonly dueOn: CivilDateInput | null; readonly duePrecision: DatePrecision; readonly status: string };
type SharedTaskSummary = (SharedTaskSummaryBase & { readonly state: "shared"; readonly reviewedDescription: string }) | (SharedTaskSummaryBase & { readonly state: Exclude<TaskShareSummaryState, "shared">; readonly reviewedDescription: null });
type TargetProgressFigure = { readonly periodLabel: string; readonly value: number | null; readonly valueState: ValueState };
type ModuleBody =
  | { readonly kind: "check-ins"; readonly items: readonly SharedCheckIn[] }
  | { readonly kind: "task-shares"; readonly items: readonly SharedTaskSummary[] }
  | { readonly kind: "target-progress"; readonly figures: readonly TargetProgressFigure[]; readonly coverage: Coverage; readonly asOf: string }
  | { readonly kind: "financial-range"; readonly alreadyRendered: false };
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
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
          <span className="font-medium">{"Shared on"}</span>
          <bdi className="mono-identifier">{checkIn.sharedAt}</bdi>
        </p>
        {checkIn.questions.length === 0 ? (
          <p className="text-sm text-pretty text-muted-foreground">{"This shared revision carries no questions."}</p>
        ) : (
          <dl className="flex min-w-0 flex-col gap-2">
            {checkIn.questions.map((question, index) => (
              <div key={`${checkIn.checkInId}-question-${String(index)}`} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-sm font-medium text-pretty">{question.wording}</dt>
                {question.answer.trim().length === 0 ? <dd className="text-sm text-pretty text-muted-foreground">{"No answer recorded"}</dd> : <dd className="whitespace-pre-line text-sm text-pretty text-muted-foreground">{question.answer}</dd>}
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
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
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
          {description === null || description.trim().length === 0 ? null : <p className="whitespace-pre-line text-sm text-pretty">{description}</p>}
          {share.state === "shared" ? null : <p className="text-sm text-pretty text-muted-foreground">{stateCopy.sentence}</p>}
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
const EXPECTED_BODY_KIND: Readonly<Record<ModuleKey, ModuleBody["kind"]>> = { "support-goal": "financial-range", "support-results": "financial-range", targets: "target-progress", "check-ins": "check-ins", "task-summaries": "task-shares" };
function ModuleBodyView({ body, locale }: { readonly body: ModuleBody; readonly locale: string }): ReactElement | null {
  switch (body.kind) {
    case "check-ins":
      return body.items.length === 0 ? null : <CheckInList checkIns={body.items} />;
    case "task-shares":
      return body.items.length === 0 ? null : <TaskShareList shares={body.items} />;
    case "target-progress":
      return <TargetProgressChart body={body} locale={locale} />;
    case "financial-range":
      return null;
  }
}
function ModulePanel({ entry, unavailableSource, locale }: { readonly entry: AdmittedModule; readonly unavailableSource: SourceReference | null | undefined; readonly locale: string }): ReactElement {
  const baseId = useId();
  const titleId = `${baseId}-module-title`;
  const copy = MODULE_COPY[entry.key];
  const stateCopy = entry.state === null ? null : MODULE_READ_STATE_COPY[entry.state];
  const body = entry.body.kind === EXPECTED_BODY_KIND[entry.key] ? entry.body : null;
  const drawsContent = entry.state === null || entry.state === "partial";
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h3 id={titleId} className="text-base font-medium text-pretty">
              <bdi>{copy.name}</bdi>
            </h3>
          </CardTitle>
          {stateCopy === null || entry.state === null ? null : (
            <CardAction>
              <StatusBadge label={stateCopy.label} tone={MODULE_READ_STATE_TONE[entry.state]} srPrefix={"State"} />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          {entry.state === null ? null : <ModuleReadStateNotice readState={entry.state} source={unavailableSource ?? null} headingLevel={4} />}
          {drawsContent && body !== null ? <ModuleBodyView body={body} locale={locale} /> : null}
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
            <h2 id={headingId} className="text-lg font-semibold text-pretty">
              <bdi>{subject.displayName}</bdi>
            </h2>
          </CardTitle>
          <CardDescription>{COACHING_COPY.coachSubject.purpose}</CardDescription>
          <CardAction>
            <StatusBadge label={lifecycle.label} tone={statusBadgeProps(COACHING_STATUS, subject.grantState).tone} srPrefix={"Access"} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <p className={cn("text-sm text-pretty", cutoff === null ? "text-muted-foreground" : null)}>
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
          <p className="text-sm text-pretty">{"This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was already read."}</p>
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
