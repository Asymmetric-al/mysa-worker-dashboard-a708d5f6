"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { scopeKey } from "@/components/context-switch-guard";
import { factFrame } from "@/components/fact-list";
import StateNotice from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { SourceReference } from "@/lib/ids";
import type { TaskShareRefusalReason, TaskShareSummaryState, TaskStatus } from "@/modules/coaching/taskshare";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import type { CivilDate, DatePrecision } from "@/modules/time/civil";
import { STOP_EFFECT_COPY, TASK_SHARE_STATE_COPY } from "../copy";
import { COACHING_JOB_KEYS, useStopTaskShare } from "../hooks/use-coaching";
import { taskShareStopPayloadSchema, type TaskShareStopPayload } from "../schemas";
import { civilDateText, storedDayText } from "./sharing-summary";
import { Panel } from "./panel";
export type TaskShareDueDate = CivilDate | string;
export interface TaskShareListEntry {
  readonly shareId: string;
  readonly taskId: string;
  /** The share record's own revision, which a stop presents: the service compares it before it writes, so a share that moved since this page read it settles as a conflict rather than being overwritten. */ readonly revision: string;
  readonly state: TaskShareSummaryState;
  readonly reviewedDescription: string | null;
  readonly dueOn: TaskShareDueDate | null;
  readonly duePrecision: DatePrecision;
  readonly taskStatus: TaskStatus;
  readonly sharedAt: string | null;
  readonly withheldReason?: TaskShareRefusalReason | null;
}
export type TaskShareListProps = { readonly shares: ReadonlyArray<TaskShareListEntry>; readonly scope: Scope; readonly locale: string; readonly unavailable?: { readonly source: SourceReference } | null };
const SHARE_TITLE_NOUN = "task summary";
const REVIEW_AGAIN_HREF = "/coaching/check-ins";
const STOP_LABEL = "Stop sharing";
const STOP_REFUSED_FALLBACK = "Missing share details for this row. Reload the page and try again.";
const STOP_REGION_HEADING_LEVEL = 3;
const EMPTY_ACTION_HREF = REVIEW_AGAIN_HREF;
const FIELD_LABELS: Readonly<Record<string, string>> = { taskShareId: "Task summary", operation: "Change" };
const STATE_TONE: Readonly<Record<TaskShareSummaryState, StatusTone>> = { shared: "positive", "needs-review": "caution", removed: "neutral", unavailable: "danger" };
const TASK_STATUS_WORD: Readonly<Record<TaskStatus, string>> = { open: "Open", completed: "Completed", reopened: "Reopened", cancelled: "Cancelled" };
const DUE_PRECISION_WORD: Readonly<Record<DatePrecision, string | null>> = { date: null, approximate: "approximate", unknown: "date not confirmed" };
const STOP_STATE_PHRASE: Readonly<Record<TaskShareSummaryState, string>> = { shared: "currently shared with your coach", "needs-review": "currently pending review", removed: "already stopped", unavailable: "currently unavailable" };
const WITHHELD_REASON_STATEMENT: Readonly<Record<TaskShareRefusalReason, string>> = {
  "description-too-long": "Summary exceeds the character limit and is hidden until shortened and reviewed.",
  "description-empty": "Summary is blank and is hidden until you write a description and review it.",
  "not-reviewed": "Hidden until you review a description for this task.",
  "successor-needs-fresh-selection": "This repeating task moved to a new occurrence — choose the occurrence to share.",
  "stale-revision": "This task changed since it was last reviewed and is hidden until you review it again.",
  "not-shared": "This summary isn’t shared.",
  "occurrence-already-shared": "This occurrence is already shared.",
  unavailable: "The underlying task couldn’t be loaded right now.",
};
const STOP_EFFECT = STOP_EFFECT_COPY["remove-task-share"];
const CONTROL_CLASS = `${BUTTON_WRAP_CLASS} text-start`;
const Fact = factFrame({ rowClassName: "flex min-w-0 items-baseline gap-x-1.5", termClassName: "shrink-0 text-muted-foreground", valueClassName: "min-w-0 wrap-anywhere" });
const withheldReasonStatement = (reason: TaskShareRefusalReason | null | undefined): string => (reason === null || reason === undefined ? "Hidden until you review this summary again." : WITHHELD_REASON_STATEMENT[reason]);
function SharedDescription({ description }: { readonly description: string | null }): ReactElement {
  const text = description === null ? "" : description.trim();
  if (text === "") return <p className="min-w-0 type-supporting text-pretty">{"Marked as shared, but no description was returned. Review it again to update."}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{"Summary your coach sees"}</p>
      <p className="min-w-0 type-body text-pretty whitespace-pre-line wrap-anywhere">{text}</p>
    </div>
  );
}
function ShareStatement({ entry }: { readonly entry: TaskShareListEntry }): ReactElement {
  const copy = TASK_SHARE_STATE_COPY[entry.state];
  switch (entry.state) {
    case "shared":
      return <p className="min-w-0 type-supporting text-pretty">{copy.description}</p>;
    case "needs-review":
      return (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="min-w-0 type-body text-pretty">
            <span className="font-medium">{`Summary hidden. `}</span>
            {copy.description}
          </p>
          <p className="min-w-0 type-supporting text-pretty">{withheldReasonStatement(entry.withheldReason)}</p>
          <p className="min-w-0 type-body">
            <Link {...{ href: REVIEW_AGAIN_HREF, className: "inline-link" }}>{"Review again"}</Link>
          </p>
        </div>
      );
    case "removed":
      return <p className="min-w-0 type-supporting text-pretty">{copy.description}</p>;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={4} title={copy.label} description={copy.description} className="min-w-0" />;
  }
}
type TaskShareItemProps = { readonly entry: TaskShareListEntry; readonly stopping: boolean; readonly reviewRegionId: string; readonly onStop: (entry: TaskShareListEntry) => void };
function TaskShareItem({ entry, stopping, reviewRegionId, onStop }: TaskShareItemProps): ReactElement {
  const titleId = useId();
  const copy = TASK_SHARE_STATE_COPY[entry.state];
  const precisionWord = DUE_PRECISION_WORD[entry.duePrecision];
  return (
    <li className="flex min-w-0 flex-col gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <section aria-labelledby={titleId} data-state={entry.state} className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge label={copy.label} tone={STATE_TONE[entry.state]} srPrefix="Sharing state" />
          <h3 id={titleId} className="min-w-0 type-subsection-title text-pretty">
            {`${copy.label}: ${SHARE_TITLE_NOUN} `}
            <bdi className="mono-identifier">{entry.taskId}</bdi>
          </h3>
        </div>
        <dl className="grid min-w-0 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Fact term="Due">
            {entry.dueOn === null ? (
              <span className="text-muted-foreground">{"No due date"}</span>
            ) : (
              <>
                <bdi className="mono-identifier">{civilDateText(entry.dueOn)}</bdi>
                {precisionWord === null ? null : <span className="text-muted-foreground">{` (${precisionWord})`}</span>}
              </>
            )}
          </Fact>
          <Fact term="Status">
            <bdi>{TASK_STATUS_WORD[entry.taskStatus]}</bdi>
          </Fact>
          <Fact term="Shared on">
            {entry.sharedAt === null ? (
              <span className="text-muted-foreground">{"No share date recorded"}</span>
            ) : (
              <time dateTime={entry.sharedAt} className="tabular-figures">
                <bdi>{storedDayText(entry.sharedAt)}</bdi>
              </time>
            )}
          </Fact>
        </dl>
        {entry.state === "shared" ? <SharedDescription description={entry.reviewedDescription} /> : null}
        <ShareStatement entry={entry} />
        {entry.state === "shared" || entry.state === "needs-review" ? (
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
export default function TaskShareList({ shares, scope, locale, unavailable }: TaskShareListProps): ReactElement {
  const [regionHeadingId, reviewRegionId] = [useId(), useId()];
  const queryClient = useQueryClient();
  const { mutateAsync: stopTaskShare } = useStopTaskShare();
  const [stopping, setStopping] = useState<{ readonly shareId: string; readonly taskId: string; readonly state: TaskShareSummaryState; readonly revision: string } | null>(null);
  const [stopSettled, setStopSettled] = useState(false);
  const unavailableSource = unavailable ?? null;
  const beginStop = (entry: TaskShareListEntry): void => {
    setStopping({ shareId: entry.shareId, taskId: entry.taskId, state: entry.state, revision: entry.revision });
    setStopSettled(false);
  };
  const closeStop = (): void => {
    setStopping(null);
    setStopSettled(false);
  };
  const submitStop = useCallback(async (input: MutationInput<TaskShareStopPayload>): Promise<MutationOutcome> => stopTaskShare({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload, operationId: input.operationId }), [stopTaskShare]);
  const checkStopResult = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: [...scopeKey(scope), COACHING_JOB_KEYS.taskShares] });
  }, [queryClient, scope]);
  const handleStopSettled = (outcome: MutationOutcome): void => {
    if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") setStopSettled(true);
  };
  const stopRequest = stopping === null ? null : taskShareStopPayloadSchema.safeParse({ taskShareId: stopping.shareId });
  // The attempt presents the stopped share's own revision, because the service compares that record's revision before it writes: a share that moved since this page read it is a conflict, never an overwrite.
  const stopInput = stopRequest !== null && stopRequest.success && stopping !== null ? { scope, expectedRevision: stopping.revision, payload: stopRequest.data } : null;
  const stopRefusal = stopRequest !== null && !stopRequest.success ? (stopRequest.error.issues[0]?.message ?? STOP_REFUSED_FALLBACK) : null;
  const panelDescription = "Your coach sees only the description you wrote, the live due date, and status — never your original task title, private notes, or history.";
  const unavailableDescription = "Couldn’t load shared task summaries right now. Your tasks and coaching notes aren’t affected.";
  const emptyDescription = "Choose a task above and write a short summary to share with your coach. Original titles and private notes stay private.";
  return (
    <div lang={locale} data-slot="task-share-list" data-state={unavailableSource !== null ? "unavailable" : shares.length === 0 ? "empty" : "listed"} className="flex min-w-0 flex-col gap-4">
      <Panel titleId={regionHeadingId} headingLevel={2} title="Shared task summaries" description={panelDescription} cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-4">
        {unavailableSource !== null ? (
          <StateNotice kind="unavailable" headingLevel={3} title="Couldn’t load shared task summaries" description={unavailableDescription} source={unavailableSource.source} />
        ) : shares.length === 0 ? (
          <StateNotice kind="empty" headingLevel={3} title="No task summaries shared yet" description={emptyDescription} action={{ label: "Share a task summary", href: EMPTY_ACTION_HREF }} />
        ) : (
          <>
            <p className="min-w-0 type-supporting text-pretty">{"Due dates are shown as calendar dates."}</p>
            <ul aria-labelledby={regionHeadingId} className="flex min-w-0 flex-col gap-4">
              {shares.map((entry) => (
                <TaskShareItem key={entry.shareId} entry={entry} stopping={stopping !== null && stopping.shareId === entry.shareId} reviewRegionId={reviewRegionId} onStop={beginStop} />
              ))}
            </ul>
          </>
        )}
      </Panel>
      {stopping === null ? null : (
        <div id={reviewRegionId} className="flex min-w-0 flex-col gap-3">
          <Separator />
          {stopInput === null ? (
            <StateNotice kind="refused" headingLevel={STOP_REGION_HEADING_LEVEL} title="Couldn’t stop sharing from here" description={stopRefusal ?? STOP_REFUSED_FALLBACK} />
          ) : (
            <>
              <ActionReview<TaskShareStopPayload>
                title={STOP_EFFECT.title}
                description={
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="type-supporting">
                      {`This stops the summary for ${SHARE_TITLE_NOUN} `}
                      <bdi className="mono-identifier">{stopping.taskId}</bdi>
                      {`, ${STOP_STATE_PHRASE[stopping.state]}.`}
                    </p>
                    <p className="type-supporting">{STOP_EFFECT.consequence}</p>
                    <p className="type-supporting">{STOP_EFFECT.assurance}</p>
                  </div>
                }
                consequence={
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="type-supporting">{STOP_EFFECT.consequence}</p>
                    <p className="type-supporting">{STOP_EFFECT.assurance}</p>
                  </div>
                }
                confirmLabel={STOP_LABEL}
                cancelLabel="Keep sharing"
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
                  <Button {...{ type: "button", variant: "outline", className: CONTROL_CLASS, onClick: closeStop }}>{"Done"}</Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
