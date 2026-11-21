/**
 * `/settings` — the five things Settings carries: appearance, interface language, display time zone, source status and the
 * destructive development reset.
 *
 * AAP 0.10.1's Shell/Home/Settings/Help family states those five, and AAP 0.11.1 makes every route under `src/app` a
 * composition that holds no business logic. So this file reads through the one data service, hands the plain results to the
 * shell family's panels, and owns no state, no mutation call and no control of its own.
 *
 * Two boundaries are settled here rather than at a control:
 *
 * - There is no publishing preference. Whether a publication also notifies readers is chosen at publish time in the
 *   Communication family, where the release and its notification are one deliberate act, so a stored default here would be
 *   a second place for that choice and a setting no read or mutation in the service declares. No control, no stored flag and
 *   no settings record exist for it.
 * - The reset is a development control, not a preference. It is offered only where the development read answered an
 *   envelope, because that answer is the one signal that this session carries a runtime able to perform it.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import DevResetControl from "@/features/shell/components/dev-reset-control";
import SettingsPreferencePanel from "@/features/shell/components/settings-preference-panel";
import SettingsSourceStatusPanel from "@/features/shell/components/settings-source-status-panel";
import { RESET_COPY } from "@/features/shell/copy/dev-labels";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
// The development read's own result type, inferred from the read rather than restated, so a change to the contract is a compile error here
type DevelopmentResult = Awaited<ReturnType<typeof reads.dev.readDevState>>;
// Fixed values
/** Both reads answer from this session's cookie on every request, and the reset replaces the documents behind them, so the route renders per request rather than from a cache. */
export const dynamic = "force-dynamic";
/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Settings";
/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };
/** Where a reload re-requests this page: the one retry an outage of either read offers. */
const SELF_HREF = "/settings";
/** The page column and its type scale, so no section states a spacing or a size of its own. */
const PAGE_COLUMN = "flex min-w-0 flex-col gap-6 text-start";
const PAGE_HEADING = "text-2xl font-semibold text-pretty wrap-anywhere";
const BODY_NOTE = "text-sm text-muted-foreground text-pretty wrap-anywhere";
/** The heading level of a section-level notice, which stands where a card's level-two heading would. */
const SECTION_HEADING_LEVEL = 2;
const COPY = {
  // The display time zone formats what is shown; it is not a stored fact. The panel's own hint states that a dateless civil date keeps the day the service recorded, and this sentence adds the second boundary it leaves out: a series' planning time zone.
  displayTimeZone: "The display time zone above changes only how dates and times are shown to you. It never rebases a stored civil date, and a recurring task series keeps the planning time zone it was created with, so no date a series admits moves because of this setting.",
  resetDenied: "The destructive reset is a development-only operation, and this session is not admitted to the development runtime that performs it. No reset control is offered here rather than one that could not act.",
  resetUnavailable: "Until the session store answers, the reset is unavailable rather than absent, so no control is offered that could not confirm an effect.",
  resetRefused: "This page's request for the development state was refused, so nothing was read and no reset control is offered in its place.",
  resetReloadLabel: "Reload this page",
} as const;
// The reset section
/** The field messages a refused development read carried, joined into its notice's one description. */
function refusalDescription(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? COPY.resetRefused : `${COPY.resetRefused} ${messages.join(" ")}`;
}
/**
 * The reset section, in whichever state the development read reported. Only an envelope offers the control: a denial, an
 * outage or a refused request renders as that state, so the page never presents a destructive action it could not carry out.
 */
function ResetSection({ development }: { readonly development: DevelopmentResult }): ReactElement {
  switch (development.kind) {
    case "envelope":
      return <DevResetControl scope={development.envelope.scope} expectedRevision={development.envelope.revision} />;
    case "denied":
      return <StateNotice kind="denied" headingLevel={SECTION_HEADING_LEVEL} title={RESET_COPY.title} description={COPY.resetDenied} reasonCode={development.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={SECTION_HEADING_LEVEL} title={RESET_COPY.title} description={`${development.unavailable.guidance} ${COPY.resetUnavailable}`} source={development.unavailable.source} action={{ label: COPY.resetReloadLabel, href: SELF_HREF }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={SECTION_HEADING_LEVEL} title={RESET_COPY.title} description={refusalDescription(development.refused.fields)} />;
    default:
      return assertNever(development, "Unhandled development read result");
  }
}
// The route
/** The Settings screen: appearance, interface language, display time zone, source status and the destructive development reset. */
export default async function SettingsPage(): Promise<ReactElement> {
  // Both answers describe the same request and neither depends on the other, so they are read together rather than one after the other.
  const [sourceStatus, development] = await Promise.all([reads.context.readAdmissionState(), reads.dev.readDevState()]);
  // Whether development controls exist is the development read's own answer: an envelope means the runtime answered, and every other arm means it did not. No environment variable is consulted here, so this decision cannot drift from the service's own gate.
  const developmentState = development.kind === "envelope" ? development.envelope.data : null;

  return (
    <div className={PAGE_COLUMN}>
      {/* The one h1 on this page: every section below opens at level two. */}
      <h1 className={PAGE_HEADING}>{PAGE_TITLE}</h1>
      <SettingsPreferencePanel />
      <p className={BODY_NOTE}>{COPY.displayTimeZone}</p>
      {/* Source status states only what the admission read carried: an outage, a refusal or a denial renders as that notice rather than as an empty card or a zero. The read instant stays in UTC because a server render cannot know this browser's display time zone, and naming UTC is honest where guessing the host's zone would not be. */}
      <SettingsSourceStatusPanel envelope={sourceStatus} devState={developmentState} retryHref={SELF_HREF} />
      <ResetSection development={development} />
    </div>
  );
}
