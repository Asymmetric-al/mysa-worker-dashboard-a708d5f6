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
  title: "Source status",
  description: "What this session's data came from, how much of the past that source covers, and the instant this page's read was evaluated at. Every fact here is reported by that read: this panel checks nothing live, refreshes nothing in the background and asks the source no second question.",
  sourceHeading: "Source",
  sourceLabel: "Source identity",
  sourceNote:
    "The system name and the reference are opaque. They are shown exactly as the source stated them, joined by the one reference formatter this application uses, and nothing is read into their form: a reference that happens to look like an email address, an account number or a date is neither parsed nor trusted as one.",
  coverageHeading: "Coverage",
  coverageLabel: "How much of the period the source covers",
  coverageFromLabel: "First bound the source stated",
  coverageToLabel: "Last bound the source stated",
  coverageBoundAbsent: "The source stated no such bound.",
  coverageNote: "Both bounds are shown exactly as the source stated them and are neither formatted nor converted, because a civil date and an instant are different facts and this panel cannot tell which one a source meant. It derives no deadline and computes no boundary from either.",
  asOfHeading: "Read instant",
  asOfLabel: "Evaluated at",
  asOfNote: "This is the instant the read behind this page was evaluated at, stated in the zone named beside it. A later page load is a second read with its own instant, so nothing here states that the source is answering now.",
  asOfUnreadable: "This panel cannot read that value as an instant, so it is shown exactly as the source stated it rather than replaced or recalculated.",
  zoneFallback: "The requested time zone could not be used here, so the instant is stated in UTC.",
  devHeading: "Development scenario",
  devIdLabel: "Scenario id",
  devLabelLabel: "Scenario",
  devInstantLabel: "Instant this session reads at",
  devNote: "Both facts are reported by this session's development runtime, which derives the instant from the clock offset it stores. This panel states them as it received them and derives neither, so the instant here is the one this session's boundaries were evaluated against.",
  denied: "This session may not read the record that holds its own source status, so no source identity, coverage, read instant or development scenario is stated here.",
  refused: "This page's own request for the source status was refused, so nothing was read and nothing is stated in its place.",
  unavailableAffected: "Until the source answers, every surface that reads it reports its own outage rather than a zero or an empty list, and the work that does not depend on it stays usable.",
  reloadLabel: "Reload this page",
} as const;
const COVERAGE_WORD: Readonly<Record<CoverageState, string>> = { complete: "Complete", partial: "Partial", unknown: "Unknown" };
const COVERAGE_MEANING: Readonly<Record<CoverageState, string>> = {
  complete: "The source states that its records cover the whole period it reports.",
  partial: "The source states that its records cover only part of the period it reports.",
  unknown: "The source does not state how much of the period its records cover.",
};
const COVERAGE_NOTICE_TITLE: Readonly<Record<Exclude<CoverageState, "complete">, string>> = { partial: "Coverage is partial", unknown: "Coverage is unknown" };
const UTC_ZONE = "UTC";
const INSTANT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "medium" };
const NOTICE_HEADING_LEVEL = 2;
type InstantReading = { readonly formatted: string | null; readonly zone: string; readonly zoneFallback: boolean };
function formatterFor(locale: string, timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(locale, { ...INSTANT_FORMAT, timeZone });
  } catch {
    return null;
  }
}
function readInstant(instant: string, timeZone: string, locale: string): InstantReading {
  const milliseconds = Date.parse(instant);
  const requested = formatterFor(locale, timeZone);
  const formatter = requested ?? formatterFor(locale, UTC_ZONE);
  const zone = requested === null ? UTC_ZONE : timeZone;
  return formatter === null || Number.isNaN(milliseconds) ? { formatted: null, zone, zoneFallback: requested === null } : { formatted: formatter.format(milliseconds), zone, zoneFallback: requested === null };
}
const isReadAnswer = (value: SourceStatusRead): value is ReadResult<ReadEnvelope<unknown>> => "kind" in value;
const Fact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-1", termClassName: "text-sm font-medium text-muted-foreground", valueClassName: "flex min-w-0 flex-col gap-1 text-sm text-pretty" });
const FactGroup = ({ heading, children }: { readonly heading: string; readonly children: ReactNode }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-3">
    <h3 className="type-subsection-title text-pretty">{heading}</h3>
    {children}
  </div>
);
const coverageBound = (bound: string | null): ReactNode => (bound === null ? COPY.coverageBoundAbsent : <bdi className="mono-identifier wrap-anywhere">{bound}</bdi>);
function refusalDescription(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? COPY.refused : `${COPY.refused} ${messages.join(" ")}`;
}
type SourceStatusCardProps = { readonly envelope: ReadEnvelope<unknown>; readonly devState: DevRuntimeState | null; readonly timeZone: string; readonly locale: string };
function SourceStatusCard({ envelope, devState, timeZone, locale }: SourceStatusCardProps): ReactElement {
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
