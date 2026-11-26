import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import { ScrollspyNav } from "@/components/ui/scrollspy-nav";
import DevResetControl from "@/features/shell/components/dev-reset-control";
import SettingsPreferencePanel from "@/features/shell/components/settings-preference-panel";
import SettingsSourceStatusPanel from "@/features/shell/components/settings-source-status-panel";
import { RESET_COPY } from "@/features/shell/copy/dev-labels";
import { reads } from "@/modules/data-service";
import { PageColumn } from "../page-frame";
export const dynamic = "force-dynamic";
const PAGE_TITLE = "Settings";
export const metadata: Metadata = { title: PAGE_TITLE };
const SELF_HREF = "/settings";
const SECTION_HEADING_LEVEL = 2;
const COPY = {
  subtitle: "Manage your display preferences, time zone, publishing defaults, and workspace data.",
  displayTimeZone: "Your display time zone only changes how timestamps appear on screen — calendar due dates and repeating task schedules keep their original dates.",
  resetDenied: "Resetting sample data is only available in development sessions with development access.",
  resetUnavailable: "Couldn’t reach the local session store, so reset isn’t available right now.",
  resetRefused: "Couldn’t load development settings for this request.",
  resetReloadLabel: "Reload page",
} as const;
const SETTINGS_SECTIONS = [
  { id: "settings-preferences", label: "Display & defaults" },
  { id: "settings-source-status", label: "Data & source status" },
  { id: "settings-dev-reset", label: "Reset sample data" },
] as const;
function refusalDescription(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? COPY.resetRefused : `${COPY.resetRefused} ${messages.join(" ")}`;
}
function ResetSection({ development }: { readonly development: Awaited<ReturnType<typeof reads.dev.readDevState>> }): ReactElement {
  switch (development.kind) {
    case "envelope":
      return <DevResetControl scope={development.envelope.scope} expectedRevision={development.envelope.revision} />;
    case "denied":
      return <StateNotice kind="denied" headingLevel={SECTION_HEADING_LEVEL} title={RESET_COPY.title} description={COPY.resetDenied} reasonCode={development.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={SECTION_HEADING_LEVEL} title={RESET_COPY.title} description={`${development.unavailable.guidance} ${COPY.resetUnavailable}`} source={development.unavailable.source} action={{ label: COPY.resetReloadLabel, href: SELF_HREF }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={SECTION_HEADING_LEVEL} title={RESET_COPY.title} description={refusalDescription(development.refused.fields)} />;
  }
}
/** Settings screen: appearance, formatting, time zone, update publishing default, data status, and local sample reset. */
export default async function SettingsPage(): Promise<ReactElement> {
  const [sourceStatus, development] = await Promise.all([reads.context.readAdmissionState(), reads.dev.readDevState()]);
  const developmentState = development.kind === "envelope" ? development.envelope.data : null;
  return (
    <PageColumn>
      <header className="flex min-w-0 flex-col gap-1.5">
        <h1 className="type-page-title text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="type-supporting text-pretty wrap-anywhere">{COPY.subtitle}</p>
      </header>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start">
        <ScrollspyNav label="Settings sections" sections={SETTINGS_SECTIONS} orientation="vertical" className="hidden lg:sticky lg:top-20 lg:flex" />
        <div className="flex min-w-0 flex-col gap-6">
          <div id="settings-preferences" className="flex min-w-0 flex-col gap-4">
            <SettingsPreferencePanel />
            <p className="type-supporting text-pretty wrap-anywhere">{COPY.displayTimeZone}</p>
          </div>
          <div id="settings-source-status" className="min-w-0">
            <SettingsSourceStatusPanel envelope={sourceStatus} devState={developmentState} retryHref={SELF_HREF} />
          </div>
          <div id="settings-dev-reset" className="min-w-0">
            <ResetSection development={development} />
          </div>
        </div>
      </div>
    </PageColumn>
  );
}
