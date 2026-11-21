/** `/settings` — appearance, interface language, display time zone, source status and the confirmed development reset. **Why this route exists.** AAP 0.10.1's Shell/Home/Settings/Help family states … */
import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import StateNotice from "@/components/state-notice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import DevResetControl from "@/features/shell/components/dev-reset-control";
import SettingsPreferencePanel from "@/features/shell/components/settings-preference-panel";
import { RESET_COPY } from "@/features/shell/copy/dev-labels";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
// The two reads' own shapes, taken from the service rather than restated
/** The result types, inferred from the reads themselves. */
type SourceStatusResult = Awaited<ReturnType<typeof reads.context.readAdmissionState>>;
type DevelopmentResult = Awaited<ReturnType<typeof reads.dev.readDevState>>;
type SourceStatusEnvelope = Extract<SourceStatusResult, { kind: "envelope" }>["envelope"];
type DevelopmentEnvelope = Extract<DevelopmentResult, { kind: "envelope" }>["envelope"];
/** The coverage states the envelope closes, so the words below cannot fall behind the contract. */
type CoverageState = SourceStatusEnvelope["coverage"]["state"];
/** The scenario this session runs in, as the development read reports it. */
type DevelopmentScenario = DevelopmentEnvelope["data"]["scenario"];
// Fixed values
/** Both reads are derived from this session's cookie on every request, and the reset replaces the documents behind them, so the route is rendered per request rather than cached. */
export const dynamic = "force-dynamic";
/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Settings";
/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };
/** The page's own wording: its title, the source-status section's heading and fact labels, and the one sentence the reset section states when this session carries no development runtime. */
const SETTINGS_COPY = {
  title: PAGE_TITLE,
  sourceStatus: {
    heading: "Source status",
    body: "What this session's data came from, how much of the past that source covers, and the instant this page read it at.",
    systemLabel: "Source system",
    referenceLabel: "Source reference",
    coverageLabel: "Coverage",
    asOfLabel: "As of",
    scenarioLabel: "Development scenario",
    denied: "This session may not read the record that holds its own source status, so no source, coverage, as-of instant or development scenario is stated here.",
    unavailable: "The source that reports this session's status did not answer, so its coverage, its as-of instant and its development scenario are unavailable here rather than absent.",
  },
  resetUnavailable: "The destructive reset is a development-only operation, and this session does not carry the development runtime that performs it, so there is no reset control here rather than one that could not act.",
} as const;
/** How each coverage state reads in words. */
const COVERAGE_WORDS: Readonly<Record<CoverageState, string>> = {
  complete: "Complete: the source covers the whole period it reports.",
  partial: "Partial: the source covers only part of the period, so a total built from it is an incomplete subtotal.",
  unknown: "Unknown: the source does not state how much of the period it covers, so a total built from it is an incomplete subtotal.",
};
// The source-status section
/** One labelled fact of the source status, as a definition pair inside the section's list. */
function StatusFact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5 text-sm text-pretty">{children}</dd>
    </div>
  );
}
/** The source status: where this session's data came from, how much of the past it covers, when it was read, and — when the development read answered — which scenario the session is running in. */
function SourceStatusSection({ result, scenario }: { readonly result: SourceStatusResult; readonly scenario: DevelopmentScenario | null }): ReactElement {
  switch (result.kind) {
    case "envelope": {
      const envelope = result.envelope;
      return (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{SETTINGS_COPY.sourceStatus.heading}</h2>
            </CardTitle>
            <CardDescription>{SETTINGS_COPY.sourceStatus.body}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
              <StatusFact label={SETTINGS_COPY.sourceStatus.systemLabel}>
                <bdi className="mono-identifier wrap-anywhere">{envelope.source.system}</bdi>
              </StatusFact>
              <StatusFact label={SETTINGS_COPY.sourceStatus.referenceLabel}>
                <bdi className="mono-identifier wrap-anywhere">{envelope.source.reference}</bdi>
              </StatusFact>
              <StatusFact label={SETTINGS_COPY.sourceStatus.coverageLabel}>{COVERAGE_WORDS[envelope.coverage.state]}</StatusFact>
              <StatusFact label={SETTINGS_COPY.sourceStatus.asOfLabel}>
                <bdi className="mono-identifier wrap-anywhere">{envelope.asOf}</bdi>
              </StatusFact>
              {scenario === null ? null : (
                <StatusFact label={SETTINGS_COPY.sourceStatus.scenarioLabel}>
                  <bdi className="mono-identifier wrap-anywhere">{scenario.id}</bdi>
                  <span className="text-muted-foreground">{scenario.label}</span>
                </StatusFact>
              )}
            </dl>
          </CardContent>
        </Card>
      );
    }
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={SETTINGS_COPY.sourceStatus.heading} description={SETTINGS_COPY.sourceStatus.denied} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={SETTINGS_COPY.sourceStatus.heading} description={SETTINGS_COPY.sourceStatus.unavailable} source={result.unavailable.source} />;
    case "refused":
      // This page calls the admission read directly, so the request here is its own and never one a handler refuses: the arm is stated the same way rather than thrown as an unhandled result.
      return <StateNotice kind="refused" headingLevel={2} title={SETTINGS_COPY.sourceStatus.heading} />;
    default:
      return assertNever(result, "Unhandled admission read result");
  }
}
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
  // The scenario is reported by the development read alone: the admission read answers `null` for it in four of its states, so it is not a second source for the same fact.
  const scenario = developmentEnvelope === null ? null : developmentEnvelope.data.scenario;

  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {/* The one h1 on this page: every section below opens at level two. */}
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{SETTINGS_COPY.title}</h1>
      <SettingsPreferencePanel />
      <SourceStatusSection result={sourceStatus} scenario={scenario} />
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
