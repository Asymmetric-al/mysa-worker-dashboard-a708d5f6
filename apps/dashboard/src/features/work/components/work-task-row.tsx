"use client";
/**
 * One task as the Work surface states it: the status it holds, the day it stands at, the records it is
 * linked to and the actions its own read admitted.
 *
 * **Why one row serves both surfaces.** `reads.work.listTasks` and `reads.work.readAgenda` project the same
 * row from the same stored task, so the five lists and the dated agenda render it through this one component
 * and neither restates a status word, a date or an action. Every fact here is the read's: the status, the
 * date relation, the planned time with the zone it was stated in, and the advisory action list an action's
 * enabled state comes from. Nothing on this row derives a date, a count or a permission.
 *
 * **Selection belongs to the host.** A row renders a checkbox only when the host passes a selection, because
 * the three bulk actions act on rows a worker explicitly selected — never on a filter, a saved view or a page
 * — and the checkbox's enabled state is the read's `selectable`, whose refusal sentence is stated beside it.
 *
 * **Completing a task proves nothing.** The actions carry the finished-work meaning the family states once:
 * a completed task records that the work was closed and says nothing about contact, payment or a message.
 */
import Link from "next/link";
import { useId, type ReactElement } from "react";

import type { ReceiptHeadingLevel } from "@/components/operation-result";
import StatusBadge from "@/components/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import type { Scope, TaskRecord } from "@/modules/data-service/envelope";
import { CATEGORY_LABEL, PLANNED_MEETING_LABEL, TASK_KIND_LABELS, TASK_STATUS_LABELS, UNDATED_LABEL } from "../copy/task-status";
import TaskActions, { TASK_STATUS_TONES } from "./task-actions";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** What one task list read answers, and the envelope arm of it. */
type TaskListResult = Awaited<ReturnType<typeof reads.work.listTasks>>;

type TaskListEnvelope = Extract<TaskListResult, { readonly kind: "envelope" }>["envelope"];

/** One row as that read projects it: the read's own type, so a second description of a task row cannot drift from it. */
export type WorkTaskRowView = TaskListEnvelope["data"]["tasks"][number];

// ---------------------------------------------------------------------------------------------
// The record an edit form opens with
// ---------------------------------------------------------------------------------------------

/**
 * The task record a row's edit form opens with, or `null` when this session may not change the row.
 *
 * The list read projects every field a task holds except the owner principal, which it withholds because a
 * list of one worker's work does not enumerate other principals. It reports `selectable` only after `canEdit`
 * proved the row's owner *is* the session's principal — a task is changed by its owner and by nobody else —
 * so on a selectable row the scope's principal is that owner and stating it assumes nothing. Every field this
 * form can change is already on the row, which is why the derivation is exact rather than a reconstruction.
 */
export function editableTaskRecord(row: WorkTaskRowView, scope: Scope): TaskRecord | null {
  if (!row.selectable) return null;
  return {
    taskId: row.taskId,
    title: row.title,
    category: row.category,
    dueOn: row.dueOn,
    plannedTime: row.plannedTime,
    timeZone: row.timeZone,
    kind: row.kind,
    status: row.status,
    partnerId: row.partnerId,
    initiativeId: row.initiativeId,
    seriesId: row.seriesId,
    ownerPrincipalId: scope.principalId,
    note: row.note,
    revision: row.revision,
  };
}

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The row's own wording. Status, kind, category and date words come from `../copy/task-status`. */
const STATUS_SR_PREFIX = "Task status";

const LINKED_RECORD_LABEL = "Linked record";

const NO_LINKED_RECORD = "This task is linked to no record.";

const PARTNER_HREF = "/partners";

const SERIES_HREF = "/work/series";

const SERIES_LINK_LABEL = "Repeating plan";

/** How the row states where its due date stands, in the display zone the read judged it in. */
const DATE_RELATION_WORDS: Readonly<Record<WorkTaskRowView["dateRelation"], string>> = { today: "Due today", future: "Due", past: "Overdue", undated: UNDATED_LABEL };

const ROW_CLASS = "flex min-w-0 flex-col gap-2 border-b border-border py-3 last:border-b-0";

const BODY_CLASS = "flex min-w-0 flex-1 flex-col gap-1";

const FACT_LINE_CLASS = "flex min-w-0 flex-wrap items-center gap-2 text-sm";

const QUIET_CLASS = "text-muted-foreground";

const IDENTIFIER_CLASS = "mono-identifier";

/** One row's selection, owned by the host that renders the three bulk actions over the rows it selected. */
export interface WorkTaskRowSelection {
  readonly selected: boolean;
  readonly onSelectedChange: (selected: boolean) => void;
}

export interface WorkTaskRowProps {
  /** The row the read projected. Every fact rendered here is read from it. */
  readonly row: WorkTaskRowView;
  /** The authority the row was read under, handed to its actions unchanged so the service re-checks it. */
  readonly scope: Scope;
  /** The partner's display label from the roster read that admitted it; the opaque reference is stated when that read did not. */
  readonly partnerLabel?: string | null;
  /** Renders a checkbox when the host collects a selection; omitted where the surface acts on no selection. */
  readonly selection?: WorkTaskRowSelection;
  /** Opens the host's edit form. Omitted where the surface offers no editing. */
  readonly onEdit?: (row: WorkTaskRowView) => void;
  /** Reads back what an unconfirmed action did, by operation identity. Offered by a host that can read one result. */
  readonly onCheckResult?: () => void;
  /** The heading level the action receipts render at, which the host knows because it owns the outline. */
  readonly headingLevel: ReceiptHeadingLevel;
  readonly className?: string;
}

/** The partner a row is linked to, named by the roster's own label when that read admitted it and by its opaque reference otherwise. */
function PartnerLink({ partnerId, partnerLabel }: { readonly partnerId: string; readonly partnerLabel?: string | null }): ReactElement {
  const label = partnerLabel === undefined || partnerLabel === null || partnerLabel.trim() === "" ? partnerId : partnerLabel;
  return (
    <Link href={`${PARTNER_HREF}/${encodeURIComponent(partnerId)}`}>
      <bdi>{label}</bdi>
    </Link>
  );
}

/** The records one task is linked to, each at the destination this application actually serves; an initiative is stated as its reference because no surface reads one yet. */
function LinkedRecords({ row, partnerLabel }: { readonly row: WorkTaskRowView; readonly partnerLabel?: string | null }): ReactElement {
  const nothingLinked = row.partnerId === null && row.initiativeId === null && row.seriesId === null;
  return (
    <p className={FACT_LINE_CLASS}>
      <span className={QUIET_CLASS}>{LINKED_RECORD_LABEL}</span>
      {nothingLinked ? <span>{NO_LINKED_RECORD}</span> : null}
      {row.partnerId === null ? null : <PartnerLink partnerId={row.partnerId} partnerLabel={partnerLabel} />}
      {row.seriesId === null ? null : <Link href={`${SERIES_HREF}/${encodeURIComponent(row.seriesId)}`}>{SERIES_LINK_LABEL}</Link>}
      {row.initiativeId === null ? null : (
        <span>
          <bdi className={IDENTIFIER_CLASS}>{row.initiativeId}</bdi>
        </span>
      )}
    </p>
  );
}

/** The one row the Work lists and the dated agenda render: status, day, plan, linked records and the actions the read admitted. */
export default function WorkTaskRow({ row, scope, partnerLabel, selection, onEdit, onCheckResult, headingLevel, className }: WorkTaskRowProps): ReactElement {
  const instanceId = useId();
  const selectionId = `${instanceId}-select`;
  const selectionReasonId = `${instanceId}-selection-reason`;
  const selectionReason = row.selectable ? undefined : row.selectionReason;
  const dateText = row.dueOn === null ? UNDATED_LABEL : DATE_RELATION_WORDS[row.dateRelation];
  return (
    <li data-slot="work-task-row" data-task-id={row.taskId} data-status={row.status} data-list-date-relation={row.dateRelation} className={cn(ROW_CLASS, className)}>
      <div className="flex min-w-0 items-start gap-3">
        {selection === undefined ? null : (
          <Label htmlFor={selectionId} className="mt-1 items-start leading-snug font-normal">
            <Checkbox
              id={selectionId}
              checked={selection.selected}
              disabled={!row.selectable}
              onCheckedChange={(checked: boolean) => {
                selection.onSelectedChange(checked);
              }}
              aria-describedby={selectionReason === undefined ? undefined : selectionReasonId}
            />
            {/* The checkbox's own name, because a row's visible title is outside the label it belongs to. */}
            <span className="sr-only">
              {"Select "}
              <bdi>{row.title}</bdi>
            </span>
          </Label>
        )}
        <div className={BODY_CLASS}>
          <p className="font-medium text-pretty wrap-anywhere">
            <bdi>{row.title}</bdi>
          </p>
          <p className={FACT_LINE_CLASS}>
            <StatusBadge label={TASK_STATUS_LABELS[row.status]} tone={TASK_STATUS_TONES[row.status]} srPrefix={STATUS_SR_PREFIX} />
            <span className={QUIET_CLASS}>{TASK_KIND_LABELS[row.kind]}</span>
            <span>
              {dateText}
              {row.dueOn === null ? null : (
                <>
                  {" "}
                  <bdi className={IDENTIFIER_CLASS}>{row.dueOn}</bdi>
                </>
              )}
            </span>
          </p>
          {row.plannedTime === null || row.timeZone === null ? null : (
            <p className={FACT_LINE_CLASS}>
              <span className={QUIET_CLASS}>{PLANNED_MEETING_LABEL}</span>
              <bdi className={IDENTIFIER_CLASS}>{row.plannedTime}</bdi>
              <bdi>{row.timeZone}</bdi>
            </p>
          )}
          {row.category === null ? null : (
            <p className={FACT_LINE_CLASS}>
              <span className={QUIET_CLASS}>{CATEGORY_LABEL}</span>
              <bdi>{row.category}</bdi>
            </p>
          )}
          <LinkedRecords row={row} partnerLabel={partnerLabel} />
          {selectionReason === undefined ? null : (
            <p id={selectionReasonId} className={cn(QUIET_CLASS, "text-xs text-pretty")}>
              {selectionReason}
            </p>
          )}
        </div>
        {onEdit === undefined ? null : (
          <TaskActions
            taskId={row.taskId}
            title={row.title}
            status={row.status}
            revision={row.revision}
            scope={scope}
            actions={row.actions}
            presentation="row"
            onEdit={() => {
              onEdit(row);
            }}
            onCheckResult={onCheckResult}
            headingLevel={headingLevel}
          />
        )}
      </div>
    </li>
  );
}
