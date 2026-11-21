"use client";
/**
 * The locale-aware composition of the coaching sharing summary, rendered by the `/coaching` route.
 */
import type { ReactElement } from "react";
import SharingSummary, { type CoachingGrantView } from "@/features/coaching/components/sharing-summary";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";
/** Props of {@link SharingSummaryLocale}. */
export interface SharingSummaryLocaleProps {
  readonly grant: CoachingGrantView | null;
}
/** Renders the sharing summary with the viewer's interface locale. */
export function SharingSummaryLocale({ grant }: SharingSummaryLocaleProps): ReactElement {
  const { interfaceLocale } = useViewerPreferences();
  return <SharingSummary grant={grant} locale={interfaceLocale} />;
}
export default SharingSummaryLocale;
