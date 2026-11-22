/**
 * Settings → Source status.
 *
 * States what this page's own read reports about its data source and nothing more: the opaque source identity, how much of
 * the past that source covers, the instant the read was evaluated at, and — when this session carries one — the development
 * scenario the runtime itself reported.
 *
 * Required by AAP 0.10.1 (the Shell/Home/Settings/Help family states that Settings covers source status), AAP 0.7.1 (every
 * read carries `source`, `coverage` and `asOf`, and `unavailable` is a state of its own rather than a zero or an empty list)
 * and the honesty requirement of AAP 0.6.4/0.15.2: no surface claims a freshness or a completeness the envelope it was given
 * does not carry. This panel asks the source nothing of its own: every fact it states is one the page's read already carried.
 */
import type { ReactElement, ReactNode } from "react";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { Coverage, ReadEnvelope, ReadResult } from "@/modules/data-service";
import type { DevStateReadResult } from "../hooks/use-dev-state";

/** The coverage vocabulary, taken from the envelope so the words here cannot fall behind the contract. */
type CoverageState = Coverage["state"];
/** The development runtime state this session reports, taken from the read the sibling hook returns rather than restated. */
type DevRuntimeState = Extract<DevStateReadResult, { kind: "envelope" }>["envelope"]["data"];
/** What this panel accepts: the read's own envelope, or the read's refusal or outage answer, which are states of a read rather than results. */
export type SourceStatusRead = ReadEnvelope<unknown> | ReadResult<ReadEnvelope<unknown>>;

export interface SettingsSourceStatusPanelProps {
  /** The read whose source, coverage and as-of instant this panel states: its envelope, or its refusal or outage answer. */
  readonly envelope: SourceStatusRead;
  /** The development runtime this session reports. Absent (or `null`), the scenario group is omitted entirely rather than filled with a substitute. */
  readonly devState?: DevRuntimeState | null;
  /** The viewer's display time zone for the as-of instant. Absent, the instant is stated in UTC and labelled UTC — never in the host's own zone. */
  readonly timeZone?: string;
  /** The language the as-of instant is formatted in. Defaults to the language this copy is written in. */
  readonly locale?: string;
  /** Where a reload re-requests this read. Supplied, the outage notice offers it as a link; otherwise the notice states the retry guidance alone. */
  readonly retryHref?: string;
}

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

/** The zone an as-of instant is stated in when the caller names none: UTC, because a host's own zone would make the reading depend on where the server happens to run. */
const UTC_ZONE = "UTC";

/** The application's own default interface language (`DEFAULT_INTERFACE_LOCALE` in the viewer preferences), used for the as-of instant unless the caller states the viewer's own. */
const DEFAULT_LOCALE = "en-GB";

/** A medium date and a medium time; the zone name is deliberately not inside the string, because it is named beside the reading so it can never be missed. */
const INSTANT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "medium" };

/** The notices that replace the whole panel open at the same level as the card they stand in for. */
const NOTICE_HEADING_LEVEL = 2;

interface InstantReading {
  /** The formatted instant, or `null` when the source's value cannot be read as an instant. */
  readonly formatted: string | null;
  /** The zone the reading is stated in, always a named zone. */
  readonly zone: string;
  /** Whether the requested zone was unusable and UTC stood in for it. */
  readonly zoneFallback: boolean;
}

/**
 * Builds the formatter for one zone, or answers `null` when this platform refuses the zone or the language tag. A settings
 * page is the last place that may throw over the caller's own value, so the refusal is answered as a value here.
 */
function formatterFor(locale: string, timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(locale, { ...INSTANT_FORMAT, timeZone });
  } catch {
    return null;
  }
}

/**
 * Reads one instant as far as formatting goes and no further: the value is parsed, formatted in a named zone and left alone.
 * No boundary is computed, no civil date is converted, and the clock is never consulted — the instant shown is the one the
 * read reported.
 */
function readInstant(instant: string, timeZone: string, locale: string): InstantReading {
  const milliseconds = Date.parse(instant);
  const requested = formatterFor(locale, timeZone);
  const formatter = requested ?? formatterFor(locale, UTC_ZONE);
  const zone = requested === null ? UTC_ZONE : timeZone;
  if (formatter === null || Number.isNaN(milliseconds)) {
    return { formatted: null, zone, zoneFallback: requested === null };
  }
  return { formatted: formatter.format(milliseconds), zone, zoneFallback: requested === null };
}

/** Reports whether the value is the read's own answer rather than its envelope, so the two are told apart by their shape. */
function isReadAnswer(value: SourceStatusRead): value is ReadResult<ReadEnvelope<unknown>> {
  return "kind" in value;
}

/** The source identity as one opaque string, through the application's only reference formatter. */
function SourceIdentity({ source }: { readonly source: SourceReference }): ReactElement {
  return <bdi className="mono-identifier wrap-anywhere">{formatSourceReference(source)}</bdi>;
}

/** One labelled fact, as a definition pair inside a group's list. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-sm text-pretty">{children}</dd>
    </div>
  );
}

/** One group of facts under its own heading, so the card's level-two heading is followed by level-three headings in order. */
function FactGroup({ heading, children }: { readonly heading: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="text-base font-semibold text-pretty">{heading}</h3>
      {children}
    </div>
  );
}

/** One coverage bound exactly as the source stated it, or the sentence that says it stated none. */
function coverageBound(bound: string | null): ReactNode {
  return bound === null ? COPY.coverageBoundAbsent : <bdi className="mono-identifier wrap-anywhere">{bound}</bdi>;
}

/**
 * The coverage state's consequence, in the one wording the application already owns: a period the source only partly covers,
 * or whose coverage it does not state, cannot be presented as a whole-period figure.
 */
function CoverageNotice({ coverage }: { readonly coverage: Coverage }): ReactElement | null {
  if (coverage.state === "complete") {
    return null;
  }
  return <StateNotice kind="partial-coverage" headingLevel={4} title={COVERAGE_NOTICE_TITLE[coverage.state]} coverage={coverage} />;
}

/** The field messages a refused request carried, joined into the notice's one description. */
function refusalDescription(fields: Readonly<Record<string, readonly string[]>>): string {
  const messages = Object.values(fields).flat();
  return messages.length === 0 ? COPY.refused : `${COPY.refused} ${messages.join(" ")}`;
}

interface SourceStatusCardProps {
  readonly envelope: ReadEnvelope<unknown>;
  readonly devState: DevRuntimeState | null;
  readonly timeZone: string;
  readonly locale: string;
}

/** The report itself: the four groups the envelope and the development runtime can state, and nothing inferred between them. */
function SourceStatusCard({ envelope, devState, timeZone, locale }: SourceStatusCardProps): ReactElement {
  const reading = readInstant(envelope.asOf, timeZone, locale);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{COPY.title}</h2>
        </CardTitle>
        <CardDescription>{COPY.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-6">
        <FactGroup heading={COPY.sourceHeading}>
          <dl className="flex min-w-0 flex-col gap-4">
            <Fact label={COPY.sourceLabel}>
              <SourceIdentity source={envelope.source} />
            </Fact>
          </dl>
          <p className="text-sm text-muted-foreground text-pretty">{COPY.sourceNote}</p>
        </FactGroup>
        <Separator />
        <FactGroup heading={COPY.coverageHeading}>
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Fact label={COPY.coverageLabel}>
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={envelope.coverage.state === "complete" ? "secondary" : "outline"}>{COVERAGE_WORD[envelope.coverage.state]}</Badge>
                <span>{COVERAGE_MEANING[envelope.coverage.state]}</span>
              </span>
            </Fact>
            <Fact label={COPY.coverageFromLabel}>{coverageBound(envelope.coverage.from)}</Fact>
            <Fact label={COPY.coverageToLabel}>{coverageBound(envelope.coverage.to)}</Fact>
          </dl>
          <CoverageNotice coverage={envelope.coverage} />
          <p className="text-sm text-muted-foreground text-pretty">{COPY.coverageNote}</p>
        </FactGroup>
        <Separator />
        <FactGroup heading={COPY.asOfHeading}>
          <dl className="flex min-w-0 flex-col gap-4">
            <Fact label={COPY.asOfLabel}>
              <span className="flex flex-wrap items-baseline gap-2">
                <bdi className="mono-identifier wrap-anywhere">{reading.formatted ?? envelope.asOf}</bdi>
                <bdi className="mono-identifier text-muted-foreground">{reading.zone}</bdi>
              </span>
              {reading.formatted === null ? <span className="text-muted-foreground">{COPY.asOfUnreadable}</span> : null}
              {reading.zoneFallback ? <span className="text-muted-foreground">{COPY.zoneFallback}</span> : null}
            </Fact>
          </dl>
          <p className="text-sm text-muted-foreground text-pretty">{COPY.asOfNote}</p>
        </FactGroup>
        {devState === null ? null : (
          <>
            <Separator />
            <FactGroup heading={COPY.devHeading}>
              <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
                <Fact label={COPY.devIdLabel}>
                  <bdi className="mono-identifier wrap-anywhere">{devState.scenario.id}</bdi>
                </Fact>
                <Fact label={COPY.devLabelLabel}>
                  <bdi>{devState.scenario.label}</bdi>
                </Fact>
                <Fact label={COPY.devInstantLabel}>
                  <bdi className="mono-identifier wrap-anywhere">{devState.clock.derivedInstant}</bdi>
                </Fact>
              </dl>
              <p className="text-sm text-muted-foreground text-pretty">{COPY.devNote}</p>
            </FactGroup>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Settings' source-status panel: the source identity, its coverage and the instant the read was evaluated at, plus the
 * development scenario when this session carries one — or the honest outage, refusal or denial notice when the read answered
 * with that instead. It never renders an outage as a zero, an empty list or a partial success.
 */
export function SettingsSourceStatusPanel({ envelope, devState = null, timeZone = UTC_ZONE, locale = DEFAULT_LOCALE, retryHref }: SettingsSourceStatusPanelProps): ReactElement {
  if (isReadAnswer(envelope)) {
    if (envelope.kind === "denied") {
      return <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title={COPY.title} description={COPY.denied} reasonCode={envelope.denied.reasonCode} />;
    }
    if (envelope.kind === "unavailable") {
      return <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={COPY.title} description={`${envelope.unavailable.guidance} ${COPY.unavailableAffected}`} source={envelope.unavailable.source} action={retryHref === undefined ? undefined : { label: COPY.reloadLabel, href: retryHref }} />;
    }
    if (envelope.kind === "refused") {
      return <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={COPY.title} description={refusalDescription(envelope.refused.fields)} />;
    }
    return <SourceStatusCard envelope={envelope.envelope} devState={devState} timeZone={timeZone} locale={locale} />;
  }
  return <SourceStatusCard envelope={envelope} devState={devState} timeZone={timeZone} locale={locale} />;
}

export default SettingsSourceStatusPanel;
