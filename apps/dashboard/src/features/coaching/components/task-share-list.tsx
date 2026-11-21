"use client";
/** The worker's shared task summaries: the four states the read reports (`shared`, `needs-review`, `removed`, `unavailable`), a `needs-review` description withheld in full until it is reviewed again, and one action — Stop sharing — which stops future reads without deleting the task, changing its due date or status, or recalling anything a coach has already read. */
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useId, useState, type ReactElement, type ReactNode } from "react";
import ActionReview from "@/components/action-review";
import { scopeKey } from "@/components/context-switch-guard";
import StateNotice from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { SourceReference } from "@/lib/ids";
import type { TaskShareRefusalReason, TaskShareSummaryState, TaskStatus } from "@/modules/coaching/taskshare";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { parseCivilDate, serialiseCivilDate, type CivilDate, type DatePrecision } from "@/modules/time/civil";
import { STOP_EFFECT_COPY, TASK_SHARE_STATE_COPY } from "../copy";
import { useStopTaskShare } from "../hooks/use-coaching-mutations";
import { COACHING_JOB_KEYS } from "../hooks/use-coaching-reads";
import { taskShareStopPayloadSchema, type TaskShareStopPayload } from "../schemas/taskshare";

// ---------------------------------------------------------------------------------------------
// The shape one shared summary is read as, and the props this list takes
// ---------------------------------------------------------------------------------------------

/** A civil due date as the surrounding read reports it: the domain's own `CivilDate`, or the stored `YYYY-MM-DD` text. */
export type TaskShareDueDate = CivilDate | string;

/** One shared task summary as this list renders it. `reviewedDescription` is drawn only in the `shared` state; every other state names itself instead. */
export interface TaskShareListEntry {
  /** The identity of the share itself — the record stopping acts on, never the task's. */
  readonly shareId: string;
  /** The opaque identity of the task behind the share: safe to render, because it carries none of the task's title, notes or history. */
  readonly taskId: string;
  readonly state: TaskShareSummaryState;
  readonly reviewedDescription: string | null;
  readonly dueOn: TaskShareDueDate | null;
  readonly duePrecision: DatePrecision;
  readonly taskStatus: TaskStatus;
  /** The instant the current share was recorded, or `null` when the read states none. */
  readonly sharedAt: string | null;
  /** Why a `needs-review` summary is held, when the read states a reason. */
  readonly withheldReason?: TaskShareRefusalReason | null;
}

/** Props of {@link TaskShareList}. */
export interface TaskShareListProps {
  readonly shares: ReadonlyArray<TaskShareListEntry>;
  /** The exact authority this list was read under; the service re-derives scope from it on every write. */
  readonly scope: Scope;
  /** The revision the surrounding read reported. Stopping presents it, so a share that moved since is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** The direction and language the surrounding document resolved, recorded on this region without re-rendering any stored value. */
  readonly locale: string;
  /** Set when the source behind these summaries cannot be read at all: the whole region then reports the outage, never an empty list. */
  readonly unavailable?: { readonly source: SourceReference } | null;
}

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

const LIST_HEADING = "Task summaries you share";

const LIST_PURPOSE =
  "Only the summaries you selected and reviewed are shared: a description you wrote for this purpose, the task's " +
  "live due date and its live status. A task's own title, notes, links and history are never shared, and stopping " +
  "a summary leaves the work itself alone.";

const STATE_SR_PREFIX = "Sharing state";

const SHARE_TITLE_NOUN = "task summary";

const DUE_LABEL = "Due";

const STATUS_LABEL = "Status";

const SHARED_ON_LABEL = "Shared on";

const NO_DUE_DATE_WORD = "No due date";

const NO_SHARED_DATE_WORD = "No share date recorded";

const DESCRIPTION_LABEL = "The description you reviewed";

const DESCRIPTION_MISSING_STATEMENT =
  "The read states this summary as shared but carries no description for it, so nothing is reproduced here. " +
  "Review it again to share a description.";

const WITHHELD_LABEL = "Description withheld";

const REVIEW_AGAIN_LABEL = "Review it again";

/** Where a held summary is reviewed again: the destination that owns sharing a task summary. */
const REVIEW_AGAIN_HREF = "/coaching/check-ins";

const STOP_LABEL = "Stop sharing";

const KEEP_SHARING_LABEL = "Keep sharing";

const DONE_LABEL = "Done";

const STOP_REFUSED_TITLE = "This share cannot be stopped from here";

const STOP_REFUSED_FALLBACK =
  "This row names no share to stop, so nothing was submitted. Reload the shared summaries and choose the share again.";

const STOP_REGION_HEADING_LEVEL = 3;

const EMPTY_TITLE = "No task summary is shared yet";

const EMPTY_BODY =
  "A summary is shared only when you select a task, write a description for this purpose and review it. Until then " +
  "a coach reads no task title, note, link or history, and nothing here waits to be sent.";

const EMPTY_ACTION_LABEL = "Choose a task summary to share";

const EMPTY_ACTION_HREF = REVIEW_AGAIN_HREF;

const UNAVAILABLE_TITLE = "Shared task summaries cannot be read right now";

const UNAVAILABLE_BODY =
  "The source behind these summaries could not be read, so this region reports the outage instead of an empty list. " +
  "Nothing was removed, no task changed, and the rest of your coaching preparation stays readable.";

const FIELD_LABELS: Readonly<Record<string, string>> = { taskShareId: "Task summary", operation: "Change" };

/** The tone each state carries. The state's own words are always rendered beside it, so colour never carries the state alone. */
const STATE_TONE: Readonly<Record<TaskShareSummaryState, StatusTone>> = { shared: "positive", "needs-review": "caution", removed: "neutral", unavailable: "danger" };

/** The word each task status carries, spelled here rather than derived, because the stored value is an identifier and not a label. */
const TASK_STATUS_WORD: Readonly<Record<TaskStatus, string>> = { open: "Open", completed: "Completed", reopened: "Reopened", cancelled: "Cancelled" };

/** The precision word a due date carries when it is not an exact day; `null` means the date stands on its own. */
const DUE_PRECISION_WORD: Readonly<Record<DatePrecision, string | null>> = { date: null, approximate: "approximate", unknown: "date not confirmed" };

/** Each state as it is named inside the stop review's description, so the sentence reads about the share being stopped rather than about shares in general. */
const STOP_STATE_PHRASE: Readonly<Record<TaskShareSummaryState, string>> = {
  shared: "currently shared with your coach",
  "needs-review": "currently held until you review it again",
  removed: "already stopped",
  unavailable: "currently unreadable from its source",
};

/** Why a held summary is held, in the read's own refusal vocabulary. Every member is stated so a reason the read adds fails to compile here instead of reaching the page as blank text. */
const WITHHELD_REASON_STATEMENT: Readonly<Record<TaskShareRefusalReason, string>> = {
  "description-too-long": "The description reviewed for this share was longer than the length a summary may carry, so it is held until a shorter one is reviewed.",
  "description-empty": "The description reviewed for this share was blank, so it is held until a description is written and reviewed.",
  "not-reviewed": "No reviewed description is recorded against this share, so it is held until one is reviewed.",
  "successor-needs-fresh-selection": "This share covers an earlier occurrence of a repeating task, so the occurrence to share has to be chosen again before anything is shown.",
  "stale-revision": "The share moved since this page read it, so it is held until you review it again.",
  "not-shared": "This summary is not shared, so there is nothing here to withhold.",
  "occurrence-already-shared": "This occurrence is already the shared one, so nothing new is shown for it.",
  unavailable: "The task behind this share cannot be read at the moment, so nothing is shown in its place.",
};

const NO_WITHHELD_REASON_STATEMENT =
  "The read did not state why this summary is held. Nothing is shown until you review it again.";

const CALENDAR_DAY_NOTE = "Dates are calendar days: a due date carries no time of day and no zone.";

/** The calendar-day prefix of a stored ISO instant, which this application records in UTC: the day a share is dated by, taken before any time of day. */
const STORED_DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/u;

const STOP_EFFECT = STOP_EFFECT_COPY["remove-task-share"];

const ROW_CLASS = "flex min-w-0 flex-col gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0";

const CONTROL_CLASS = "h-auto min-h-8 max-w-full py-1.5 whitespace-normal text-start";

/** A share can be stopped while it is shared or held: a held summary is still a share, and stopping it is the one way out that changes nothing about the task. */
const canStop = (state: TaskShareSummaryState): boolean => state === "shared" || state === "needs-review";

// ---------------------------------------------------------------------------------------------
// Pure readings of the values the read states
// ---------------------------------------------------------------------------------------------

/** The stored instant's calendar day as `YYYY-MM-DD`, read back through the one civil-date parser rather than trusted as text. */
function instantDayText(storedInstant: string): string {
  const written = STORED_DAY.exec(storedInstant);
  const day = written === null ? undefined : written[1];
  if (day === undefined) return storedInstant.trim();
  const parsed = parseCivilDate(day);
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : day;
}

/** A civil due date as `YYYY-MM-DD`, whether it arrived as the domain's own date or as its stored text. */
function civilDateText(value: TaskShareDueDate): string {
  if (typeof value !== "string") return serialiseCivilDate(value);
  const parsed = parseCivilDate(value.trim());
  return parsed.status === "parsed" ? serialiseCivilDate(parsed.date) : value.trim();
}

/** One labelled fact of a share, laid out inside a definition list so each word and value pair reads as one fact. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 items-baseline gap-x-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{children}</dd>
    </div>
  );
}

/** The statement a held summary makes instead of its description: what is withheld, why, and where it is reviewed again. */
function withheldReasonStatement(reason: TaskShareRefusalReason | null | undefined): string {
  if (reason === null || reason === undefined) return NO_WITHHELD_REASON_STATEMENT;
  return WITHHELD_REASON_STATEMENT[reason];
}

/** The reviewed description, drawn for a shared summary and for no other state. */
function SharedDescription({ description }: { readonly description: string | null }): ReactElement {
  const text = description === null ? "" : description.trim();
  if (text === "") {
    return <p className="min-w-0 text-sm text-pretty text-muted-foreground">{DESCRIPTION_MISSING_STATEMENT}</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{DESCRIPTION_LABEL}</p>
      <p className="min-w-0 text-sm text-pretty whitespace-pre-line wrap-anywhere">{text}</p>
    </div>
  );
}

/**
 * The sentence a summary makes about itself in its own state. Four states, four statements: a held summary states
 * that its description is withheld and never reproduces it, a stopped one states that only the share stopped, and an
 * unreadable one reports the outage instead of an empty row.
 */
function ShareStatement({ entry }: { readonly entry: TaskShareListEntry }): ReactElement {
  const copy = TASK_SHARE_STATE_COPY[entry.state];
  switch (entry.state) {
    case "shared":
      return <p className="min-w-0 text-sm text-pretty text-muted-foreground">{copy.description}</p>;
    case "needs-review":
      return (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="min-w-0 text-sm text-pretty">
            <span className="font-medium">{`${WITHHELD_LABEL}. `}</span>
            {copy.description}
          </p>
          <p className="min-w-0 text-sm text-pretty text-muted-foreground">{withheldReasonStatement(entry.withheldReason)}</p>
          <p className="min-w-0 text-sm">
            <Link href={REVIEW_AGAIN_HREF} className="underline underline-offset-4">
              {REVIEW_AGAIN_LABEL}
            </Link>
          </p>
        </div>
      );
    case "removed":
      return <p className="min-w-0 text-sm text-pretty text-muted-foreground">{copy.description}</p>;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={4} title={copy.label} description={copy.description} className="min-w-0" />;
  }
}

interface TaskShareItemProps {
  readonly entry: TaskShareListEntry;
  /** Whether this row's stop review is the one showing below the list, so the trigger states what it controls. */
  readonly stopping: boolean;
  readonly reviewRegionId: string;
  readonly onStop: (entry: TaskShareListEntry) => void;
}

/** One shared summary: its state, the live due date and status the read reports, what it says about itself, and — where a share can be stopped — that one control. */
function TaskShareItem({ entry, stopping, reviewRegionId, onStop }: TaskShareItemProps): ReactElement {
  const titleId = useId();
  const copy = TASK_SHARE_STATE_COPY[entry.state];
  const precisionWord = DUE_PRECISION_WORD[entry.duePrecision];
  return (
    <li className={ROW_CLASS}>
      <section aria-labelledby={titleId} data-state={entry.state} className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge label={copy.label} tone={STATE_TONE[entry.state]} srPrefix={STATE_SR_PREFIX} />
          <h3 id={titleId} className="min-w-0 text-sm font-medium text-pretty">
            {`${copy.label}: ${SHARE_TITLE_NOUN} `}
            <bdi className="mono-identifier">{entry.taskId}</bdi>
          </h3>
        </div>
        <dl className="grid min-w-0 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Fact label={DUE_LABEL}>
            {entry.dueOn === null ? (
              <span className="text-muted-foreground">{NO_DUE_DATE_WORD}</span>
            ) : (
              <>
                <bdi className="mono-identifier">{civilDateText(entry.dueOn)}</bdi>
                {precisionWord === null ? null : <span className="text-muted-foreground">{` (${precisionWord})`}</span>}
              </>
            )}
          </Fact>
          <Fact label={STATUS_LABEL}>
            <bdi>{TASK_STATUS_WORD[entry.taskStatus]}</bdi>
          </Fact>
          <Fact label={SHARED_ON_LABEL}>
            {entry.sharedAt === null ? (
              <span className="text-muted-foreground">{NO_SHARED_DATE_WORD}</span>
            ) : (
              <time dateTime={entry.sharedAt} className="tabular-figures">
                <bdi>{instantDayText(entry.sharedAt)}</bdi>
              </time>
            )}
          </Fact>
        </dl>
        {entry.state === "shared" ? <SharedDescription description={entry.reviewedDescription} /> : null}
        <ShareStatement entry={entry} />
        {canStop(entry.state) ? (
          // The stop control is the row's last element and is never auto-focused, so the row's own words are read
          // before the one action it offers. Its name carries the task's opaque identifier and the share's state, so a
          // list of several rows never offers two identically named controls.
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button type="button" variant="destructive" size="sm" className={CONTROL_CLASS} aria-label={`${STOP_LABEL}: ${SHARE_TITLE_NOUN} ${entry.taskId}, ${copy.label}`} aria-expanded={stopping} aria-controls={stopping ? reviewRegionId : undefined} onClick={() => onStop(entry)}>
              {STOP_LABEL}
            </Button>
          </div>
        ) : null}
      </section>
    </li>
  );
}

/** The share one review region is about: taken when the worker presses stop, so the region keeps its subject while the read refreshes beneath it. */
interface StoppingShare {
  readonly shareId: string;
  readonly taskId: string;
  readonly state: TaskShareSummaryState;
}

/**
 * The worker's shared task summaries and their four states, a held description withheld until it is reviewed again,
 * and the one stop action, which ends the share without deleting the task and without claiming any recall.
 */
export default function TaskShareList({ shares, scope, expectedRevision, locale, unavailable }: TaskShareListProps): ReactElement {
  const regionHeadingId = useId();
  const reviewRegionId = useId();
  const queryClient = useQueryClient();
  const { mutateAsync: stopTaskShare } = useStopTaskShare();
  const [stopping, setStopping] = useState<StoppingShare | null>(null);
  const [stopSettled, setStopSettled] = useState(false);
  const unavailableSource = unavailable ?? null;

  const beginStop = (entry: TaskShareListEntry): void => {
    setStopping({ shareId: entry.shareId, taskId: entry.taskId, state: entry.state });
    setStopSettled(false);
  };
  const closeStop = (): void => {
    setStopping(null);
    setStopSettled(false);
  };
  // The attempt's identity comes from the review step, which mints one per intent and replays it under that same
  // identity, so nothing here mints an operationId and a repeated press can never become a second effect.
  const submitStop = useCallback(
    async (input: MutationInput<TaskShareStopPayload>): Promise<MutationOutcome> => stopTaskShare({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload, operationId: input.operationId }),
    [stopTaskShare],
  );
  // An unconfirmed stop is recovered by reading what the share now says, never by sending a fresh attempt: a refresh
  // of this family's task-share read is what tells the worker whether the share had already stopped.
  const checkStopResult = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.taskShares] });
  }, [queryClient, scope]);
  const handleStopSettled = (outcome: MutationOutcome): void => {
    if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") setStopSettled(true);
  };
  // The payload is validated where the worker acts, so a row that names no share refuses to open the review at all
  // rather than submitting a request the service would only refuse.
  const stopRequest = stopping === null ? null : taskShareStopPayloadSchema.safeParse({ taskShareId: stopping.shareId });
  const stopInput = stopRequest !== null && stopRequest.success ? { scope, expectedRevision, payload: stopRequest.data } : null;
  const stopRefusal = stopRequest !== null && !stopRequest.success ? (stopRequest.error.issues[0]?.message ?? STOP_REFUSED_FALLBACK) : null;
  const regionState = unavailableSource !== null ? "unavailable" : shares.length === 0 ? "empty" : "listed";

  return (
    <div lang={locale} data-slot="task-share-list" data-state={regionState} className="flex min-w-0 flex-col gap-4">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={regionHeadingId}>{LIST_HEADING}</h2>
          </CardTitle>
          <CardDescription>{LIST_PURPOSE}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {unavailableSource !== null ? (
            <StateNotice kind="unavailable" headingLevel={3} title={UNAVAILABLE_TITLE} description={UNAVAILABLE_BODY} source={unavailableSource.source} />
          ) : shares.length === 0 ? (
            <StateNotice kind="empty" headingLevel={3} title={EMPTY_TITLE} description={EMPTY_BODY} action={{ label: EMPTY_ACTION_LABEL, href: EMPTY_ACTION_HREF }} />
          ) : (
            <>
              <p className="min-w-0 text-sm text-pretty text-muted-foreground">{CALENDAR_DAY_NOTE}</p>
              <ul aria-labelledby={regionHeadingId} className="flex min-w-0 flex-col gap-4">
                {shares.map((entry) => (
                  <TaskShareItem key={entry.shareId} entry={entry} stopping={stopping !== null && stopping.shareId === entry.shareId} reviewRegionId={reviewRegionId} onStop={beginStop} />
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      {stopping === null ? null : (
        <div id={reviewRegionId} className="flex min-w-0 flex-col gap-3">
          <Separator />
          {stopInput === null ? (
            <StateNotice kind="refused" headingLevel={STOP_REGION_HEADING_LEVEL} title={STOP_REFUSED_TITLE} description={stopRefusal ?? STOP_REFUSED_FALLBACK} />
          ) : (
            <>
              <ActionReview<TaskShareStopPayload>
                title={STOP_EFFECT.title}
                description={
                  <div className="flex min-w-0 flex-col gap-2">
                    <p>
                      {`This stops the summary for ${SHARE_TITLE_NOUN} `}
                      <bdi className="mono-identifier">{stopping.taskId}</bdi>
                      {`, ${STOP_STATE_PHRASE[stopping.state]}.`}
                    </p>
                    <p>{STOP_EFFECT.consequence}</p>
                    <p>{STOP_EFFECT.assurance}</p>
                  </div>
                }
                consequence={
                  <div className="flex min-w-0 flex-col gap-2">
                    <p>{STOP_EFFECT.consequence}</p>
                    <p>{STOP_EFFECT.assurance}</p>
                  </div>
                }
                confirmLabel={STOP_LABEL}
                cancelLabel={KEEP_SHARING_LABEL}
                onCancel={closeStop}
                consequential
                input={stopInput}
                submit={submitStop}
                onSettled={handleStopSettled}
                checkResult={checkStopResult}
                fieldLabels={FIELD_LABELS}
                headingLevel={STOP_REGION_HEADING_LEVEL}
              />
              {stopSettled ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className={CONTROL_CLASS} onClick={closeStop}>
                    {DONE_LABEL}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
