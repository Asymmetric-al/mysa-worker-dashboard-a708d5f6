"use client";
import * as React from "react";
import { Timeline, TimelineConnector, TimelineDescription, TimelineItem, TimelineMarker, TimelineTime, TimelineTitle } from "@/lib/ui-sdk";
import { cn } from "@/lib/cn";

export type ActivityTimelineTone = "neutral" | "positive" | "info" | "warning" | "destructive";

const MARKER_TONE: Readonly<Record<ActivityTimelineTone, string>> = {
  neutral: "border-border bg-card text-muted-foreground",
  positive: "border-positive/40 bg-positive-soft text-foreground",
  info: "border-info/40 bg-info-soft text-foreground",
  warning: "border-warning/45 bg-warning-soft text-foreground",
  destructive: "border-destructive/40 bg-destructive-soft text-foreground",
};

const DOT_TONE: Readonly<Record<ActivityTimelineTone, string>> = { neutral: "bg-muted-foreground", positive: "bg-positive", info: "bg-info", warning: "bg-warning", destructive: "bg-destructive" };

export type ActivityTimelineEntry = {
  readonly id: string;
  readonly title: React.ReactNode;
  readonly time?: string;
  readonly dateTime?: string;
  readonly badge?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly meta?: React.ReactNode;
  readonly tone?: ActivityTimelineTone;
  readonly icon?: React.ReactNode;
};

export type ActivityTimelineProps = { readonly entries: readonly ActivityTimelineEntry[]; readonly label?: string; readonly className?: string };

/** Structured vertical timeline powered by UI SDK `Timeline` and styled after Shadcn Studio `widget-component-28` and ReUI Timeline. Uses semantic list/listitem roles so accessible list queries continue to work. */
export function ActivityTimeline({ entries, label, className }: ActivityTimelineProps) {
  return (
    <Timeline aria-label={label} className={cn("flex min-w-0 flex-col", className)}>
      {entries.map((entry, index) => {
        const tone = entry.tone ?? "neutral";
        const isLast = index === entries.length - 1;
        return (
          <TimelineItem key={entry.id} value={entry.id} className="group/timeline-item relative flex min-w-0 gap-3.5 pb-5 last:pb-0 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]">
            <div className="relative flex shrink-0 flex-col items-center">
              <TimelineMarker className={cn("z-1 flex size-7 shrink-0 items-center justify-center rounded-full border shadow-xs [&_svg]:size-3.5", MARKER_TONE[tone])}>{entry.icon ?? <span className={cn("size-2 rounded-full", DOT_TONE[tone])} />}</TimelineMarker>
              {isLast ? null : <TimelineConnector className="mt-1 w-px flex-1 bg-border" />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border border-border/80 bg-card px-3.5 py-2.5 shadow-xs">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <TimelineTitle className="min-w-0 text-sm font-medium text-foreground">{entry.title}</TimelineTitle>
                  {entry.badge}
                </div>
                {entry.time === undefined ? null : (
                  <TimelineTime dateTime={entry.dateTime} className="shrink-0 text-xs text-muted-foreground tabular-figures">
                    {entry.time}
                  </TimelineTime>
                )}
              </div>
              {entry.description === undefined ? null : <TimelineDescription className="min-w-0 text-sm text-pretty text-foreground/90">{entry.description}</TimelineDescription>}
              {entry.meta === undefined ? null : <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{entry.meta}</div>}
            </div>
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}

export default ActivityTimeline;
