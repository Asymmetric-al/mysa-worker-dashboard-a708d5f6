"use client";
import type { ReactElement } from "react";
import SharingSummary, { type CoachingGrantView } from "@/features/coaching/components/sharing-summary";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";
/** Renders the sharing summary with the viewer's interface locale. */
export function SharingSummaryLocale({ grant }: { readonly grant: CoachingGrantView | null }): ReactElement {
  const { interfaceLocale } = useViewerPreferences();
  return <SharingSummary grant={grant} locale={interfaceLocale} />;
}
export default SharingSummaryLocale;
