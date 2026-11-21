/**
 * The dated agenda: the same task rows the five lists state, grouped by the day each one is due.
 *
 * **What it is.** The composition of `reads.work.readAgenda`, which groups the open dated work of this context
 * by due date in the display zone it judged the dates in. Every day states the date it stands at, and every row
 * is the one row component the lists render, so a status, a plan or a linked record is worded the same way on
 * both destinations.
 *
 * **What it is not.** It is a reading of the plan, not a second list: a task is completed, reopened, edited or
 * cancelled on the lists, and undated work is never here because a day cannot group it. Nothing on this surface
 * computes a date, a count or a permission.
 */
import type { ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import WorkTaskRow from "./work-task-row";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** What the agenda read answers, and the envelope arm of it. */
type AgendaResult = Awaited<ReturnType<typeof reads.work.readAgenda>>;

type AgendaEnvelope = Extract<AgendaResult, { readonly kind: "envelope" }>["envelope"];

/** One day the read grouped work into. */
type AgendaDay = AgendaEnvelope["data"]["days"][number];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

const SURFACE_CLASS = "flex min-w-0 flex-col gap-6";

const SECTION_CLASS = "flex min-w-0 flex-col gap-3";

const DAY_LIST_CLASS = "flex min-w-0 flex-col";

const HEADING_CLASS = "font-heading text-lg font-medium text-pretty";

const QUIET_CLASS = "text-sm text-pretty text-muted-foreground";

const EMPTY_AGENDA_TITLE = "No dated work is open";

const EMPTY_AGENDA_DESCRIPTION = "Every open task in this context carries no date, so this agenda groups nothing. Undated work is read on the lists, never here: a day cannot state where a task with no date belongs.";

/** The day's own words: the date it stands at, and where that date is relative to the day the read called today. */
function dayHeadingOf(day: AgendaDay, today: string): string {
  if (day.dueOn === today) return `${day.label} — today`;
  return day.dueOn < today ? `${day.label} — overdue` : day.label;
}

/** The count this agenda states: the whole result the read reported, and how much of it the page carries when the window cut it short. */
function countTextOf(envelope: AgendaEnvelope): string {
  const { total, days } = envelope.data;
  const shown = days.reduce((count, day) => count + day.items.length, 0);
  if (shown < total) return `Showing ${String(shown)} of ${String(total)} dated tasks.`;
  return `${String(total)} open ${total === 1 ? "task" : "tasks"} over ${String(days.length)} ${days.length === 1 ? "day" : "days"}.`;
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

export interface WorkAgendaProps {
  /** The agenda the route read for this session's context: it is rendered as read, and this surface re-reads nothing. */
  readonly envelope: AgendaEnvelope;
  /** The partner labels the roster read admitted, so a linked partner is named rather than only referenced. */
  readonly partnerLabels: Readonly<Record<string, string>>;
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The dated agenda, one section per day, each listing the work that day holds. */
export default function WorkAgenda({ envelope, partnerLabels, className }: WorkAgendaProps): ReactElement {
  const { data, scope } = envelope;
  return (
    <div data-slot="work-agenda" className={cn(SURFACE_CLASS, className)}>
      <p className={QUIET_CLASS}>{countTextOf(envelope)}</p>
      {data.days.length === 0 ? (
        <StateNotice kind="empty" headingLevel={2} title={EMPTY_AGENDA_TITLE} description={EMPTY_AGENDA_DESCRIPTION} />
      ) : (
        data.days.map((day) => (
          <section key={day.dueOn} aria-label={day.label} data-slot="work-agenda-day" data-due-on={day.dueOn} className={SECTION_CLASS}>
            <h2 className={HEADING_CLASS}>{dayHeadingOf(day, data.today)}</h2>
            <ul className={DAY_LIST_CLASS}>
              {day.items.map((row) => (
                <WorkTaskRow key={row.taskId} row={row} scope={scope} partnerLabel={row.partnerId === null ? null : (partnerLabels[row.partnerId] ?? null)} headingLevel={3} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
