"use client";
import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildCivilMonthGrid, formatCivilMonthTitle, monthFromIsoDate, shiftCivilMonth, weekdayLabels, type CivilMonth } from "@/lib/civil-calendar";
import { cn } from "@/lib/cn";

export type CalendarEventItem = {
  readonly id: string;
  readonly dateIso: string;
  readonly title: string;
  readonly statusLabel: string;
  readonly subtitle?: string;
  readonly overdue?: boolean;
};

export type CalendarGridProps = {
  readonly events: readonly CalendarEventItem[];
  readonly todayIso?: string;
  readonly locale?: string;
  readonly label?: string;
  readonly emptyDayMessage?: string;
  readonly className?: string;
};

const DEFAULT_MONTH: CivilMonth = { year: 2026, month: 1 };

/**
 * ReUI `event-calendar` / Shadcn Studio multi-view read-only month calendar grid.
 * Groups civil-date events strictly by their resolved civil day (no browser TZ conversion, zero drag-rescheduling).
 */
export function CalendarGrid({ events, todayIso, locale, label = "Monthly calendar", emptyDayMessage = "No dated item on this day.", className }: CalendarGridProps) {
  const initialAnchor = todayIso ?? events[0]?.dateIso;
  const [visibleMonth, setVisibleMonth] = React.useState<CivilMonth>(() => monthFromIsoDate(initialAnchor, DEFAULT_MONTH));
  const [selectedIso, setSelectedIso] = React.useState<string | null>(() => initialAnchor ?? null);

  const byDay = React.useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const item of events) {
      const bucket = map.get(item.dateIso);
      if (bucket === undefined) map.set(item.dateIso, [item]);
      else bucket.push(item);
    }
    return map;
  }, [events]);

  const cells = React.useMemo(() => buildCivilMonthGrid(visibleMonth, "sunday"), [visibleMonth]);
  const weekdays = React.useMemo(() => weekdayLabels(locale, "sunday"), [locale]);
  const monthTitle = React.useMemo(() => formatCivilMonthTitle(visibleMonth, locale), [visibleMonth, locale]);
  const selectedEvents = selectedIso === null ? [] : (byDay.get(selectedIso) ?? []);
  const monthEventCount = React.useMemo(() => cells.reduce((sum, cell) => (cell.inMonth ? sum + (byDay.get(cell.iso)?.length ?? 0) : sum), 0), [byDay, cells]);
  const monthOverdueCount = React.useMemo(() => cells.reduce((sum, cell) => (cell.inMonth ? sum + (byDay.get(cell.iso)?.filter((item) => item.overdue === true).length ?? 0) : sum), 0), [byDay, cells]);

  return (
    <div data-slot="calendar-grid" aria-label={label} className={cn("flex min-w-0 flex-col gap-4 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs sm:p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="type-subsection-title text-foreground">
            <bdi>{monthTitle}</bdi>
          </h3>
          <Badge variant="outline" className="tabular-figures">
            {`${String(monthEventCount)} in month`}
          </Badge>
          {monthOverdueCount > 0 ? (
            <Badge variant="warning-light" className="tabular-figures">
              {`${String(monthOverdueCount)} overdue`}
            </Badge>
          ) : null}
          {todayIso === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 min-h-7 px-2.5 text-xs"
              onClick={() => {
                setVisibleMonth(monthFromIsoDate(todayIso, DEFAULT_MONTH));
                setSelectedIso(todayIso);
              }}
            >
              Today
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setVisibleMonth((current) => shiftCivilMonth(current, -1))}>
            <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setVisibleMonth((current) => shiftCivilMonth(current, 1))}>
            <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center" aria-hidden="true">
        {weekdays.map((dayName) => (
          <span key={dayName} className="py-1 text-xs font-medium text-muted-foreground">
            {dayName}
          </span>
        ))}
      </div>

      <fieldset className="m-0 grid grid-cols-7 gap-1 border-0 p-0" aria-label={`Days in ${monthTitle}`}>
        {cells.map((cell) => {
          const dayEvents = byDay.get(cell.iso) ?? [];
          const isToday = todayIso !== undefined && cell.iso === todayIso;
          const isSelected = selectedIso === cell.iso;
          const hasOverdue = dayEvents.some((item) => item.overdue === true);
          return (
            <button
              key={cell.iso}
              type="button"
              aria-label={`${cell.iso}${dayEvents.length > 0 ? `, ${String(dayEvents.length)} item${dayEvents.length === 1 ? "" : "s"}` : ""}`}
              aria-pressed={isSelected}
              onClick={() => setSelectedIso(cell.iso)}
              className={cn(
                "flex min-h-14 min-w-0 cursor-pointer flex-col items-start gap-1 rounded-xl border p-1.5 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] sm:min-h-20 sm:p-2",
                isSelected ? "border-foreground bg-secondary/70" : isToday ? "border-foreground/50 bg-surface-subtle" : "border-border/70 bg-card hover:bg-surface-subtle",
                !cell.inMonth && "opacity-55",
              )}
            >
              <span className="flex w-full items-center justify-between gap-1">
                <span className={cn("tabular-figures text-xs font-medium", isToday ? "rounded-md bg-primary px-1.5 py-0.5 text-primary-foreground" : "text-foreground")}>{cell.day}</span>
                {dayEvents.length > 0 ? (
                  <span className={cn("tabular-figures rounded-full px-1.5 py-0.25 text-xs font-medium", hasOverdue ? "bg-warning-soft text-warning" : "bg-muted text-foreground")}>
                    {dayEvents.length}
                  </span>
                ) : null}
              </span>
              <span className="hidden w-full flex-col gap-0.5 sm:flex">
                {dayEvents.slice(0, 2).map((item) => (
                  <span key={item.id} className="truncate rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground">
                    <bdi>{item.title}</bdi>
                  </span>
                ))}
                {dayEvents.length > 2 ? <span className="px-1 text-xs text-muted-foreground">{`+${String(dayEvents.length - 2)} more`}</span> : null}
              </span>
            </button>
          );
        })}
      </fieldset>

      {selectedIso === null ? null : (
        <div data-slot="calendar-day-detail" className="flex flex-col gap-2 rounded-xl border border-border/80 bg-surface-subtle p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">
              Items on <bdi className="mono-identifier">{selectedIso}</bdi>
            </p>
            <Badge variant="outline" className="tabular-figures">
              {selectedEvents.length}
            </Badge>
          </div>
          {selectedEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyDayMessage}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {selectedEvents.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-2 text-xs">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">
                      <bdi>{item.title}</bdi>
                    </span>
                    {item.subtitle === undefined ? null : <span className="text-muted-foreground">{item.subtitle}</span>}
                  </div>
                  <Badge variant={item.overdue ? "secondary" : "outline"}>{item.statusLabel}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default CalendarGrid;
