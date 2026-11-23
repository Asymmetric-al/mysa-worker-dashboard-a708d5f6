import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import DevResetControl from "@/features/shell/components/dev-reset-control";
import SettingsPreferencePanel from "@/features/shell/components/settings-preference-panel";
import SettingsSourceStatusPanel from "@/features/shell/components/settings-source-status-panel";
import { RESET_COPY } from "@/features/shell/copy/dev-labels";
import { reads } from "@/modules/data-service";
import { PageColumn } from "../page-frame";
type DevelopmentResult = Awaited<ReturnType<typeof reads.dev.readDevState>>;
export const dynamic = "force-dynamic";
const PAGE_TITLE = "Settings";
export const metadata: Metadata = { title: PAGE_TITLE };
const SELF_HREF = "/settings";
const SECTION_HEADING_LEVEL = 2;
const COPY = {
  displayTimeZone: "The display time zone above changes only how dates and times are shown to you. It never rebases a stored civil date, and a recurring task series keeps the planning time zone it was created with, so no date a series admits moves because of this setting.",
  resetDenied: "The destructive reset is a development-only operation, and this session is not admitted to the development runtime that performs it. No reset control is offered here rather than one that could not act.",
  resetUnavailable: "Until the session store answers, the reset is unavailable rather than absent, so no control is offered that could not confirm an effect.",
  resetRefused: "This page's request for the development state was refused, so nothing was read and no reset control is offered in its place.",
  resetReloadLabel: "Reload this page",
} as const;
function refusalDescription(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? COPY.resetRefused : `${COPY.resetRefused} ${messages.join(" ")}`;
}
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
  }
}
/** The Settings screen: appearance, interface language, display time zone, source status and the destructive development reset. */
export default async function SettingsPage(): Promise<ReactElement> {
  const [sourceStatus, development] = await Promise.all([reads.context.readAdmissionState(), reads.dev.readDevState()]);
  const developmentState = development.kind === "envelope" ? development.envelope.data : null;
  return (
    <PageColumn>
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
      <SettingsPreferencePanel />
      <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{COPY.displayTimeZone}</p>
      <SettingsSourceStatusPanel envelope={sourceStatus} devState={developmentState} retryHref={SELF_HREF} />
      <ResetSection development={development} />
    </PageColumn>
  );
}
