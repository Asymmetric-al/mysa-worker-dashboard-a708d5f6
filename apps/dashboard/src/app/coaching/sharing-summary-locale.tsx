"use client";

/**
 * The locale-aware composition of the coaching sharing summary, rendered by the `/coaching` route.
 *
 * **Why this composition exists.** The summary formats a reviewed amount and its grouping through the
 * reader's interface locale, and that locale is a presentation preference the browser holds rather than
 * a fact any read returns. Two constraints meet here: the route is a Server Component, so it renders
 * before a browser preference exists and cannot read one; and the coaching family may not import the
 * shell feature that owns the preference, because `.oxlintrc.json` forbids a feature-to-feature import.
 * The one layer allowed to compose features is `src/app`, so the join sits beside the route that needs
 * it.
 *
 * **One owner of the locale.** `useViewerPreferences` is the application's single owner of the three
 * presentation preferences, and this file neither reads a locale from the host nor keeps a copy of one:
 * it takes the interface locale from the provider and passes it through. The provider's server snapshot
 * is the documented default (`en-GB`), so the server markup and the first client render agree and no
 * hydration warning is produced; the reader's stored preference takes effect as soon as it has been
 * read on the client.
 *
 * **No logic of its own.** This file holds no state, formats nothing and renders no grant itself: it
 * hands the one preference the summary needs to the summary, which stays the only place a grant is
 * rendered.
 */

import type { ReactElement } from "react";

import SharingSummary, {
  type CoachingGrantView,
} from "@/features/coaching/components/sharing-summary";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";

/** Props of {@link SharingSummaryLocale}. */
export interface SharingSummaryLocaleProps {
  /** The grant the route's read returned, or `null` when no coaching relationship is set up. */
  readonly grant: CoachingGrantView | null;
}

/**
 * Renders the sharing summary with the viewer's interface locale.
 *
 * The locale is the provider's own, so a caller cannot supply a second one and no surface can disagree
 * with the rest of the application about how a number is grouped.
 */
export function SharingSummaryLocale({ grant }: SharingSummaryLocaleProps): ReactElement {
  const { interfaceLocale } = useViewerPreferences();
  return <SharingSummary grant={grant} locale={interfaceLocale} />;
}

export default SharingSummaryLocale;
