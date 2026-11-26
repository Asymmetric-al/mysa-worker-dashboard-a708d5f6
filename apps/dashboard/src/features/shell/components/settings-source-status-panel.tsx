import type { ReactElement, ReactNode } from "react";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { factFrame } from "@/components/fact-list";
import SectionCard from "@/components/section-card";
import { Separator } from "@/components/ui/separator";
import { formatSourceReference } from "@/lib/ids";
import type { Coverage, ReadEnvelope, ReadResult } from "@/modules/data-service";
import type { DevStateReadResult } from "../hooks/use-dev-state";
type CoverageState = Coverage["state"];
type DevRuntimeState = Extract<DevStateReadResult, { kind: "envelope" }>["envelope"]["data"];
/** What this panel accepts: the read's own envelope, or the read's refusal or outage answer, which are states of a read rather than results. */ export type SourceStatusRead = ReadEnvelope<unknown> | ReadResult<ReadEnvelope<unknown>>;
export type SettingsSourceStatusPanelProps = { readonly envelope: SourceStatusRead; readonly devState?: DevRuntimeState | null; readonly timeZone?: string; readonly locale?: string; readonly retryHref?: string };
const COPY = {
  title: "Data & source status",
  description: "Where your workspace data came from, the date range it covers, and when this page was loaded.",
  sourceHeading: "Data source",
  sourceLabel: "Source reference",
  sourceNote: "Shown exactly as reported by your workspace data source.",
  coverageHeading: "Date coverage",
  coverageLabel: "Coverage status",
  coverageFromLabel: "Covers from",
  coverageToLabel: "Covers through",
  coverageBoundAbsent: "Not specified",
  coverageNote: "Dates are displayed exactly as reported by the source without timezone conversion.",
  asOfHeading: "Snapshot time",
  asOfLabel: "Loaded at",
  asOfNote: "Refresh the page to request a newer snapshot.",
  asOfUnreadable: "Shown as raw source value because it couldn’t be parsed as a timestamp.",
  zoneFallback: "Requested time zone wasn’t available, so UTC is shown.",
  devHeading: "Development scenario",
  devIdLabel: "Scenario ID",
  devLabelLabel: "Scenario",
  devInstantLabel: "Simulated time",
  devNote: "Reported by the local development runtime.",
  denied: "Your current session doesn’t have access to source status details.",
  refused: "Couldn’t load source status for this request.",
  unavailableAffected: "Other parts of the workspace that don’t depend on this source continue to work normally.",
  reloadLabel: "Reload page",
} as const;
const COVERAGE_WORD: Readonly<Record<CoverageState, string>> = { complete: "Complete", partial: "Partial", unknown: "Unknown" };
const COVERAGE_MEANING: Readonly<Record<CoverageState, string>> = {
  complete: "Covers the full reported period.",
  partial: "Covers only part of the reported period.",
  unknown: "Coverage range isn’t confirmed.",
};
const COVERAGE_NOTICE_TITLE: Readonly<Record<Exclude<CoverageState, "complete">, string>> = { partial: "Coverage is partial", unknown: "Coverage is unknown" };
const UTC_ZONE = "UTC";
const INSTANT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "medium" };
const NOTICE_HEADING_LEVEL = 2;
function formatterFor(locale: string, timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(locale, { ...INSTANT_FORMAT, timeZone });
  } catch {
    return null;
  }
}
function readInstant(instant: string, timeZone: string, locale: string): { readonly formatted: string | null; readonly zone: string; readonly zoneFallback: boolean } {
  const milliseconds = Date.parse(instant);
  const requested = formatterFor(locale, timeZone);
  const formatter = requested ?? formatterFor(locale, UTC_ZONE);
  const zone = requested === null ? UTC_ZONE : timeZone;
  return formatter === null || Number.isNaN(milliseconds) ? { formatted: null, zone, zoneFallback: requested === null } : { formatted: formatter.format(milliseconds), zone, zoneFallback: requested === null };
}
const isReadAnswer = (value: SourceStatusRead): value is ReadResult<ReadEnvelope<unknown>> => "kind" in value;
const Fact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-1", termClassName: "text-sm font-medium text-muted-foreground", valueClassName: "flex min-w-0 flex-col gap-1 text-sm text-pretty" });
const FactGroup = ({ heading, children }: { readonly heading: string; readonly children: ReactNode }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-4">
    <h3 className="type-subsection-title text-pretty">{heading}</h3>
    {children}
  </div>
);
const coverageBound = (bound: string | null): ReactNode => (bound === null ? COPY.coverageBoundAbsent : <bdi className="mono-identifier wrap-anywhere">{bound}</bdi>);
function refusalDescription(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? COPY.refused : `${COPY.refused} ${messages.join(" ")}`;
}
function SourceStatusCard({ envelope, devState, timeZone, locale }: { readonly envelope: ReadEnvelope<unknown>; readonly devState: DevRuntimeState | null; readonly timeZone: string; readonly locale: string }): ReactElement {
  const reading = readInstant(envelope.asOf, timeZone, locale);
  return (
    <SectionCard title={COPY.title} description={COPY.description} contentClassName="flex min-w-0 flex-col gap-6">
      <FactGroup heading={COPY.sourceHeading}>
        <dl className="flex min-w-0 flex-col gap-4">
          <Fact term={COPY.sourceLabel}>
            <bdi className="mono-identifier wrap-anywhere">{formatSourceReference(envelope.source)}</bdi>
          </Fact>
        </dl>
        <p className="type-supporting text-pretty">{COPY.sourceNote}</p>
      </FactGroup>
      <Separator />
      <FactGroup heading={COPY.coverageHeading}>
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Fact term={COPY.coverageLabel}>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={envelope.coverage.state === "complete" ? "secondary" : "outline"}>{COVERAGE_WORD[envelope.coverage.state]}</Badge>
              <span>{COVERAGE_MEANING[envelope.coverage.state]}</span>
            </span>
          </Fact>
          <Fact term={COPY.coverageFromLabel}>{coverageBound(envelope.coverage.from)}</Fact>
          <Fact term={COPY.coverageToLabel}>{coverageBound(envelope.coverage.to)}</Fact>
        </dl>
        {envelope.coverage.state === "complete" ? null : <StateNotice kind="partial-coverage" headingLevel={4} title={COVERAGE_NOTICE_TITLE[envelope.coverage.state]} coverage={envelope.coverage} />}
        <p className="type-supporting text-pretty">{COPY.coverageNote}</p>
      </FactGroup>
      <Separator />
      <FactGroup heading={COPY.asOfHeading}>
        <dl className="flex min-w-0 flex-col gap-4">
          <Fact term={COPY.asOfLabel}>
            <span className="flex flex-wrap items-baseline gap-2">
              <bdi className="mono-identifier wrap-anywhere">{reading.formatted ?? envelope.asOf}</bdi>
              <bdi className="mono-identifier text-muted-foreground">{reading.zone}</bdi>
            </span>
            {reading.formatted === null ? <span className="text-muted-foreground">{COPY.asOfUnreadable}</span> : null}
            {reading.zoneFallback ? <span className="text-muted-foreground">{COPY.zoneFallback}</span> : null}
          </Fact>
        </dl>
        <p className="type-supporting text-pretty">{COPY.asOfNote}</p>
      </FactGroup>
      {devState === null ? null : (
        <>
          <Separator />
          <FactGroup heading={COPY.devHeading}>
            <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Fact term={COPY.devIdLabel}>
                <bdi className="mono-identifier wrap-anywhere">{devState.scenario.id}</bdi>
              </Fact>
              <Fact term={COPY.devLabelLabel}>
                <bdi>{devState.scenario.label}</bdi>
              </Fact>
              <Fact term={COPY.devInstantLabel}>
                <bdi className="mono-identifier wrap-anywhere">{devState.clock.derivedInstant}</bdi>
              </Fact>
            </dl>
            <p className="type-supporting text-pretty">{COPY.devNote}</p>
          </FactGroup>
        </>
      )}
    </SectionCard>
  );
}
/** Settings' source-status panel: */ export function SettingsSourceStatusPanel({ envelope, devState = null, timeZone = UTC_ZONE, locale = "en-GB", retryHref }: SettingsSourceStatusPanelProps): ReactElement {
  if (isReadAnswer(envelope)) {
    if (envelope.kind === "denied") return <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title={COPY.title} description={COPY.denied} reasonCode={envelope.denied.reasonCode} />;
    if (envelope.kind === "unavailable")
      return <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={COPY.title} description={`${envelope.unavailable.guidance} ${COPY.unavailableAffected}`} source={envelope.unavailable.source} action={retryHref === undefined ? undefined : { label: COPY.reloadLabel, href: retryHref }} />;
    return envelope.kind === "refused" ? <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={COPY.title} description={refusalDescription(envelope.refused.fields)} /> : <SourceStatusCard envelope={envelope.envelope} devState={devState} timeZone={timeZone} locale={locale} />;
  }
  return <SourceStatusCard envelope={envelope} devState={devState} timeZone={timeZone} locale={locale} />;
}
export default SettingsSourceStatusPanel;
