"use client";
/** The viewer's display time zone, handed to the Work feature's own surfaces. A feature folder is composed by the route and never reaches the shell's provider, so the route states the worker's choice here and each surface reads in it: the reads themselves already resolve today from the zone they are asked for, and this is the one place that answers which zone that is. */
import type { ReactElement } from "react";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";
import Agenda, { type AgendaProps } from "@/features/work/components/agenda";
import TaskLists, { type TaskListsProps } from "@/features/work/components/task-lists";
/** The five task lists, read in the display time zone the browser chose in Settings: the page's own server read is the seed only for the zone it assumed, and any other zone is asked for on the way in rather than stated in a zone the worker did not choose. */
export function WorkListsSurface(props: Omit<TaskListsProps, "displayTimeZone">): ReactElement {
  const { displayTimeZone } = useViewerPreferences();
  return <TaskLists {...props} displayTimeZone={displayTimeZone} />;
}
/** The dated agenda, read in the display time zone the browser chose in Settings, for the same reason the lists are. */ export function AgendaSurface(props: Omit<AgendaProps, "displayTimeZone">): ReactElement {
  const { displayTimeZone } = useViewerPreferences();
  return <Agenda {...props} displayTimeZone={displayTimeZone} />;
}
