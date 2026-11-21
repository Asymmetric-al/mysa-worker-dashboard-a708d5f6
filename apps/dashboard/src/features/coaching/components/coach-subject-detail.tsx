"use client";
/**
 * The coach's read-only view of one admitted subject: a tab for each module the worker switched on,
 * and nothing else.
 */
import { CalendarXIcon, EyeOffIcon, HourglassIcon } from "lucide-react";
import { useId, type ReactElement } from "react";
import { ChartFigure, type ChartPoint, type ChartSeries, type ChartTable } from "@/components/chart-figure";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps, VALUE_STATE_WORDS, valueStateWord, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COPY, MODULE_READ_STATE_COPY } from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey, type ModuleReadState } from "@/modules/coaching/grant";
import type { TaskShareSummaryState } from "@/modules/coaching/taskshare";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import { parseCivilDate, serialiseCivilDate, type CivilDate, type DatePrecision } from "@/modules/time/civil";
// Wording this surface owns
const CUTOFF_MEANING = "Access ends at this instant, and a read at it is denied. The modules below stay readable only until " + "then; nothing on this page extends or moves that end.";
const CUTOFF_ABSENT = "This relationship states no end instant, so this page states none.";
const READ_ONLY_STATEMENT =
  "This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, " +
  "remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was " +
  "already read.";
const LIFECYCLE_SR_PREFIX = "Access";

const MODULE_TABS_LABEL = "Modules this worker shares";

const SHARED_ON_LABEL = "Shared on";
const NO_QUESTIONS_STATEMENT = "This shared revision carries no questions.";

const NO_ANSWER_WORD = "No answer recorded";

const DUE_DATE_LABEL = "Due";
const STATUS_LABEL = "Status";
const NO_DUE_DATE_WORD = "No due date";

const DUE_PRECISION_WORD: Readonly<Record<DatePrecision, string | null>> = {
  date: null,
  approximate: "approximate",
  unknown: "date not confirmed",
};
const SHARE_STATE_SR_PREFIX = "Summary";

const MODULE_STATE_SR_PREFIX = "State";

const COACH_SHARE_STATE_COPY: Readonly<Record<TaskShareSummaryState, { readonly label: string; readonly sentence: string }>> = {
  shared: {
    label: "Shared",
    sentence: "The worker reviewed this description against the task as it stands, so it is current.",
  },
  "needs-review": {
    label: "Held until reviewed",
    sentence: "The reviewed meaning changed, so the description is withheld until the worker reviews it again. " + "Nothing of it is shown in the meantime, and this is not an empty share.",
  },
  removed: {
    label: "No longer shared",
    sentence: "The worker stopped sharing this summary. The task itself keeps working; only this summary is " + "withdrawn from this view.",
  },
  unavailable: {
    label: "Unavailable",
    sentence: "The task behind this summary cannot be read at the moment. This is an outage, not an empty " + "share and not a removal.",
  },
};
const NOTHING_SHARED_SENTENCE = "No module is shared with you under this relationship, so there is nothing here to read. The " + "lifecycle word above says why.";

const TARGETS_SERIES_LABEL = "Recorded";
const TARGETS_UNITS = "Recorded counts per period";
const TARGETS_CHART_SUMMARY =
  "Each bar is the count recorded for one period, taken from the activity the worker logged. A period " + "with no recorded value is named in the table beneath the chart rather than drawn as zero.";
const TARGETS_CHART_CAPTION = "Bar chart of recorded target counts by period for this worker.";
const TARGETS_TABLE_CAPTION = "Recorded target counts by period, the data table alternative to the chart.";
const PERIOD_COLUMN_LABEL = "Period";
// What a caller passes
type CivilDateInput = CivilDate | string;

interface SharedCheckInQuestion {
  readonly wording: string;
  readonly answer: string;
}
interface SharedCheckIn {
  readonly checkInId: string;
  readonly sharedAt: string;
  readonly questions: readonly SharedCheckInQuestion[];
}
interface SharedTaskSummaryBase {
  readonly shareId: string;
  readonly dueOn: CivilDateInput | null;
  readonly duePrecision: DatePrecision;
  readonly status: string;
}
type SharedTaskSummary =
  | (SharedTaskSummaryBase & { readonly state: "shared"; readonly reviewedDescription: string })
  | (SharedTaskSummaryBase & {
      readonly state: Exclude<TaskShareSummaryState, "shared">;
      readonly reviewedDescription: null;
    });
interface TargetProgressFigure {
  readonly periodLabel: string;
  readonly value: number | null;
  readonly valueState: ValueState;
}
type ModuleBody =
  | { readonly kind: "check-ins"; readonly items: readonly SharedCheckIn[] }
  | { readonly kind: "task-shares"; readonly items: readonly SharedTaskSummary[] }
  | {
      readonly kind: "target-progress";
      readonly figures: readonly TargetProgressFigure[];
      readonly coverage: Coverage;
      readonly asOf: string;
    }
  | { readonly kind: "financial-range"; readonly alreadyRendered: false };
interface AdmittedModule {
  readonly key: ModuleKey;
  readonly state: ModuleReadState | null;
  readonly body: ModuleBody;
}
interface CoachSubjectDetailProps {
  readonly subject: {
    readonly subjectId: string;
    readonly displayName: string;
    readonly grantState: GrantLifecycleState;
    readonly cutoffDisplay: { readonly instant: string; readonly zone: string } | null;
  };
  readonly modules: readonly AdmittedModule[];
  readonly unavailableSource?: SourceReference | null;
  readonly locale: string;
}
// The tone each reading carries
const MODULE_STATE_TONE: Readonly<Record<ModuleReadState, StatusTone>> = {
  empty: "muted",
  partial: "info",
  withheld: "caution",
  unavailable: "danger",
  ended: "neutral",
};
const SHARE_STATE_TONE: Readonly<Record<TaskShareSummaryState, StatusTone>> = {
  shared: "positive",
  "needs-review": "caution",
  removed: "neutral",
  unavailable: "danger",
};
function StatementAlert({ icon, label, sentence }: { readonly icon: ReactElement; readonly label: string; readonly sentence: string }): ReactElement {
  return (
    <Alert role={undefined} variant="default">
      {icon}
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>{sentence}</AlertDescription>
    </Alert>
  );
}
// The five module read states
function ModuleStateStatement({ state, unavailableSource }: { readonly state: ModuleReadState | null; readonly unavailableSource: SourceReference | null | undefined }): ReactElement | null {
  if (state === null) {
    return null;
  }
  const copy = MODULE_READ_STATE_COPY[state];
  switch (state) {
    case "empty":
      return <StateNotice kind="empty" headingLevel={4} title={copy.label} description={copy.description} />;
    case "partial":
      return <StatementAlert icon={<HourglassIcon aria-hidden="true" />} label={copy.label} sentence={copy.description} />;
    case "withheld":
      return <StatementAlert icon={<EyeOffIcon aria-hidden="true" />} label={copy.label} sentence={copy.description} />;
    case "ended":
      return <StatementAlert icon={<CalendarXIcon aria-hidden="true" />} label={copy.label} sentence={copy.description} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={4} title={copy.label} description={copy.description} source={unavailableSource ?? undefined} />;
  }
}
// The shared check-ins module
function CheckInList({ checkIns }: { readonly checkIns: readonly SharedCheckIn[] }): ReactElement {
  return (
    <ul className="flex min-w-0 flex-col gap-4">
      {checkIns.map((checkIn) => (
        <li key={checkIn.checkInId} className="flex min-w-0 flex-col gap-2">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="font-medium">{SHARED_ON_LABEL}</span>
            <bdi className="mono-identifier">{checkIn.sharedAt}</bdi>
          </p>
          {checkIn.questions.length === 0 ? (
            <p className="text-sm text-pretty text-muted-foreground">{NO_QUESTIONS_STATEMENT}</p>
          ) : (
            <dl className="flex min-w-0 flex-col gap-2">
              {checkIn.questions.map((question, index) => (
                // The captured order is the order the worker wrote, which is why the position is part of
                // the key: two questions may legitimately be worded identically.
                <div key={`${checkIn.checkInId}-question-${String(index)}`} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-sm font-medium text-pretty">{question.wording}</dt>
                  {question.answer.trim().length === 0 ? (
                    <dd className="text-sm text-pretty text-muted-foreground">{NO_ANSWER_WORD}</dd>
                  ) : (
                    <dd className="whitespace-pre-line text-sm text-pretty text-muted-foreground">{question.answer}</dd>
                  )}
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
// The task summaries module
function civilDateText(value: CivilDateInput): string {
  if (typeof value !== "string") {
    return serialiseCivilDate(value);
  }
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : value.trim();
}
function DueDateText({ share }: { readonly share: SharedTaskSummary }): ReactElement {
  if (share.dueOn === null) {
    return <bdi>{NO_DUE_DATE_WORD}</bdi>;
  }
  const word = DUE_PRECISION_WORD[share.duePrecision];
  return (
    <>
      <bdi className="mono-identifier">{civilDateText(share.dueOn)}</bdi>
      {word === null ? null : <span className="text-muted-foreground">{` (${word})`}</span>}
    </>
  );
}
function TaskShareList({ shares }: { readonly shares: readonly SharedTaskSummary[] }): ReactElement {
  return (
    <ul className="flex min-w-0 flex-col gap-4">
      {shares.map((share) => {
        const stateCopy = COACH_SHARE_STATE_COPY[share.state];
        const description = share.state === "shared" ? share.reviewedDescription : null;
        const status = share.status.trim();
        return (
          <li key={share.shareId} className="flex min-w-0 flex-col gap-2">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <StatusBadge label={stateCopy.label} tone={SHARE_STATE_TONE[share.state]} srPrefix={SHARE_STATE_SR_PREFIX} />
              <span className="flex min-w-0 items-baseline gap-x-1.5">
                <span className="font-medium">{DUE_DATE_LABEL}</span>
                <DueDateText share={share} />
              </span>
              {status.length === 0 ? null : (
                <span className="flex min-w-0 items-baseline gap-x-1.5">
                  <span className="font-medium">{STATUS_LABEL}</span>
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
}
// The targets module
function figureText(figure: TargetProgressFigure): string {
  const { value, valueState } = figure;
  const carriesNumber = value !== null && Number.isFinite(value);
  const word = valueStateWord(valueState);
  if (word === undefined) {
    if (valueState === "zero") {
      return String(0);
    }
    return carriesNumber ? String(value) : VALUE_STATE_WORDS.unknown.label;
  }
  return carriesNumber ? `${String(value)} (${word.label})` : word.label;
}
function TargetProgressChart({ body, locale }: { readonly body: Extract<ModuleBody, { readonly kind: "target-progress" }>; readonly locale: string }): ReactElement {
  const points: readonly ChartPoint[] = body.figures.map((figure) => ({
    bucket: figure.periodLabel,
    value: figure.value,
    state: figure.valueState,
  }));
  const series: readonly ChartSeries[] = [{ key: "recorded", label: TARGETS_SERIES_LABEL, points }];
  const table: ChartTable = {
    caption: TARGETS_TABLE_CAPTION,
    columns: [
      { key: "period", label: PERIOD_COLUMN_LABEL },
      { key: "recorded", label: TARGETS_SERIES_LABEL },
    ],
    rows: body.figures.map((figure) => ({
      period: figure.periodLabel,
      recorded: figureText(figure),
    })),
  };
  return (
    <ChartFigure
      title={MODULE_COPY.targets.name}
      summary={TARGETS_CHART_SUMMARY}
      caption={TARGETS_CHART_CAPTION}
      kind="bar"
      series={series}
      units={TARGETS_UNITS}
      coverage={body.coverage}
      asOf={body.asOf}
      table={table}
      locale={locale}
    />
  );
}
// The content one admitted module draws
const EXPECTED_BODY_KIND: Readonly<Record<ModuleKey, ModuleBody["kind"]>> = {
  "support-goal": "financial-range",
  "support-results": "financial-range",
  targets: "target-progress",
  "check-ins": "check-ins",
  "task-summaries": "task-shares",
};
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
  // Content is drawn only when the read states no adverse reading, or states that part of the period could
  // be read. An empty, held, ended or unreadable module shows its own statement and nothing else.
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
              <StatusBadge label={stateCopy.label} tone={MODULE_STATE_TONE[entry.state]} srPrefix={MODULE_STATE_SR_PREFIX} />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <ModuleStateStatement state={entry.state} unavailableSource={unavailableSource} />
          {drawsContent && body !== null ? <ModuleBodyView body={body} locale={locale} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}
// The surface
function admittedInOrder(modules: readonly AdmittedModule[]): readonly AdmittedModule[] {
  const byKey = new Map<ModuleKey, AdmittedModule>();
  for (const entry of modules) {
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }
  return MODULE_KEYS.flatMap((key) => {
    const found = byKey.get(key);
    return found === undefined ? [] : [found];
  });
}
/** Read-only coach view of one admitted subject: a tab per module the worker switched on, each carrying its own empty, partial, withheld, unavailable or ended reading, and no control anywhere. */
export default function CoachSubjectDetail({ subject, modules, unavailableSource, locale }: CoachSubjectDetailProps): ReactElement {
  const headingId = useId();
  const admitted = admittedInOrder(modules);
  const first = admitted[0];
  const lifecycle = GRANT_STATE_COPY[subject.grantState];
  const lifecycleTone = statusBadgeProps(COACHING_STATUS, subject.grantState).tone;
  const cutoff = subject.cutoffDisplay;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-5">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="text-lg font-semibold text-pretty">
              {/* The name is data from another system: isolated, so a mixed-direction neighbour cannot
                  reorder it and it cannot reorder them. */}
              <bdi>{subject.displayName}</bdi>
            </h2>
          </CardTitle>
          <CardDescription>{COACHING_COPY.coachSubject.purpose}</CardDescription>
          <CardAction>
            {/*
              The lifecycle word is the coaching family's own and the tone is the status vocabulary's,
              taken from its one mapping rather than written here: both `accepted` and `active` are past
              acceptance, and revoked, expired, ended and left are four different closures.
            */}
            <StatusBadge label={lifecycle.label} tone={lifecycleTone} srPrefix={LIFECYCLE_SR_PREFIX} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          {/*
            The cutoff is the envelope's own rendering, stated as given: this component neither computes
            it, compares against it nor shortens it. An absent cutoff is stated as absent rather than
            left blank, because a blank line would read as an unlimited share.
          */}
          <p className={cn("text-sm text-pretty", cutoff === null ? "text-muted-foreground" : null)}>
            {cutoff === null ? (
              CUTOFF_ABSENT
            ) : (
              <>
                {"Access ends at "}
                <bdi className="mono-identifier">{cutoff.instant}</bdi>
                {" in "}
                <bdi className="mono-identifier">{cutoff.zone}</bdi>
                {`. ${CUTOFF_MEANING}`}
              </>
            )}
          </p>
          <Separator />
          {/*
            The lifecycle word is the whole of what this header says about the episode: the sentences in
            `GRANT_STATE_COPY` beside those words address the worker who chose the modules ("only the
            modules you switched on can be read"), and a coach reading them would be told they hold a
            choice they do not. The word itself names the actor, and the cutoff above states the bound.
          */}
          <p className="text-sm text-pretty">{READ_ONLY_STATEMENT}</p>
        </CardContent>
      </Card>
      {first === undefined ? (
        <StateNotice kind="empty" headingLevel={2} title={COACHING_COPY.coachSubject.heading} description={NOTHING_SHARED_SENTENCE} />
      ) : (
        <Tabs defaultValue={first.key} className="gap-3">
          {/*
            The tab strip wraps onto further rows inside its own labelled strip instead of scrolling the
            page sideways: at 320 CSS px five module names cannot share one row, and a tab strip that
            overflowed would make the page itself scroll horizontally (WCAG 1.4.10 Reflow).
          */}
          <TabsList aria-label={MODULE_TABS_LABEL} className="h-auto w-full max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
            {admitted.map((entry) => (
              <TabsTrigger key={entry.key} value={entry.key} className="h-8 flex-none">
                <bdi>{MODULE_COPY[entry.key].name}</bdi>
              </TabsTrigger>
            ))}
          </TabsList>
          {/*
            Each panel is named here as well as by its tab: the tab primitive links a panel to its tab in
            the browser, and this label keeps the panel identifiable on its own, so a reader is never
            placed in an unnamed region.
          */}
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
