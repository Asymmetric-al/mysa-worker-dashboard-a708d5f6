/** `/settings` — appearance, interface language, display time zone, source status and the confirmed development reset. **Why this route exists.** AAP 0.10.1's Shell/Home/Settings/Help family states … */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import DevResetControl from "@/features/shell/components/dev-reset-control";
import SettingsPreferencePanel from "@/features/shell/components/settings-preference-panel";
import SettingsSourceStatusPanel from "@/features/shell/components/settings-source-status-panel";
import { RESET_COPY } from "@/features/shell/copy/dev-labels";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
// The two reads' own shapes, taken from the service rather than restated
/** The development read's own result and envelope types, inferred from the read itself. */
type DevelopmentResult = Awaited<ReturnType<typeof reads.dev.readDevState>>;
type DevelopmentEnvelope = Extract<DevelopmentResult, { kind: "envelope" }>["envelope"];
// Fixed values
/** Both reads are derived from this session's cookie on every request, and the reset replaces the documents behind them, so the route is rendered per request rather than cached. */
export const dynamic = "force-dynamic";
/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Settings";
/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };
/** The page's own wording: its title, the path a reload of the source-status read re-requests, and the one sentence the reset section states when this session carries no development runtime. */
const SETTINGS_COPY = {
  title: PAGE_TITLE,
  sourceStatusHref: "/settings",
  resetUnavailable: "The destructive reset is a development-only operation, and this session does not carry the development runtime that performs it, so there is no reset control here rather than one that could not act.",
} as const;
// The development read, as the reset section needs it
/** The development envelope, or `null` when `readDevState` answered with anything else. */
function developmentEnvelopeOf(result: DevelopmentResult): DevelopmentEnvelope | null {
  switch (result.kind) {
    case "envelope":
      return result.envelope;
    case "denied":
      return null;
    case "unavailable":
      return null;
    case "refused":
      return null;
    default:
      return assertNever(result, "Unhandled development read result");
  }
}
// The route
/** The Settings screen. */
export default async function SettingsPage(): Promise<ReactElement> {
  // Both answers describe the same request and neither depends on the other, so they are read together rather than one after the other.
  const [sourceStatus, development] = await Promise.all([reads.context.readAdmissionState(), reads.dev.readDevState()]);

  const developmentEnvelope = developmentEnvelopeOf(development);
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {/* The one h1 on this page: every section below opens at level two. */}
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{SETTINGS_COPY.title}</h1>
      <SettingsPreferencePanel />
      {/* One panel states the source status, and it reports only what the admission read carried: an outage, a refusal or a denial is rendered as that notice rather than as an empty card or a zero. The read instant stays in UTC because a server render cannot know this browser's display time zone, and naming UTC is honest where guessing the host's zone would not be. */}
      <SettingsSourceStatusPanel envelope={sourceStatus} devState={developmentEnvelope === null ? null : developmentEnvelope.data} retryHref={SETTINGS_COPY.sourceStatusHref} />
      {developmentEnvelope === null ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{RESET_COPY.title}</h2>
            </CardTitle>
            <CardDescription>{SETTINGS_COPY.resetUnavailable}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <DevResetControl scope={developmentEnvelope.scope} expectedRevision={developmentEnvelope.revision} />
      )}
    </div>
  );
}
