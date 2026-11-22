"use client";
/**
 * The locale-aware composition of one repeating plan, rendered by `/work/series/[seriesId]`.
 *
 * The record body belongs to the work feature, and a feature may not reach another feature's provider, so the
 * route states the viewer's interface locale here and hands it to the body: the plan's next-dates preview
 * formats its dates in the locale this browser chose. Nothing else about the plan depends on it — the zone the
 * dates are planned in is the plan's own, and the locale never decides which date a rule produces.
 */
import type { ReactElement } from "react";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";
import OccurrenceActions, { type OccurrenceActionsProps } from "@/features/work/components/occurrence-actions";

/** What the series route hands its body: the one series read's envelope and nothing re-derived. */
export interface SeriesPlanViewProps {
  readonly envelope: OccurrenceActionsProps["envelope"];
}

/** Renders one repeating plan's record body with the viewer's interface locale. */
export default function SeriesPlanView({ envelope }: SeriesPlanViewProps): ReactElement {
  const { interfaceLocale } = useViewerPreferences();
  return <OccurrenceActions envelope={envelope} displayLocale={interfaceLocale} />;
}
