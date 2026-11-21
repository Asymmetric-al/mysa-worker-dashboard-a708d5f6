/**
 * `/settings` — appearance, interface language, display time zone, source status and the confirmed
 * development reset.
 *
 * **Why this route exists.** AAP 0.10.1's Shell/Home/Settings/Help family states that "Settings covers
 * appearance, locale, display timezone, source status and reset", and 0.7.2's reset path states that
 * "the Settings screen exposes the same operation through `resetSeed` with a confirmation". The
 * confirmed reset was implemented and reachable only from the development region; this route is the
 * Settings surface the plan names (`apps/dashboard/src/app/settings/page.tsx` in 0.11.1) and the only
 * thing it adds is the composition. `components/sidebar-nav` already lists `/settings` as a
 * destination, so the link existed before the page did.
 *
 * **Two reads, in process, on the server.** The page is an async Server Component and calls
 * `reads.context.readAdmissionState()` and `reads.dev.readDevState()` — the two reads this surface is
 * about. It never fetches `/api/dev` or `/api/session`: a server read must take the same authorisation
 * path the browser handler takes rather than paying a second round trip for data the process can
 * already reach, and AAP 0.3.2 forbids a server request to the application's own endpoint. Scope is
 * derived from the development session inside the service and is never passed in by this file.
 *
 * **Each read is rendered arm by arm, and no arm is an empty surface.** Both reads answer with the
 * closed `ReadResult` union, so each is switched on exhaustively and closed with `assertNever`: a
 * fourth arm added to either contract fails this file's compilation instead of falling through to a
 * blank panel. A refused or unreadable admission read renders `components/state-notice` naming the
 * condition — an outage names the source that did not answer — and never a zero, an empty collection
 * or a "no data" line, because AAP 0.7.1 makes absent different from empty and a refusal is not an
 * empty workspace. The development read's two non-envelope arms render no reset control at all: a
 * destructive action offered by a session that cannot perform it would be a control that only fails.
 *
 * **What this file composes, and what it deliberately does not.**
 *
 * - The three presentation preferences are `features/shell/components/settings-preference-panel`,
 *   which owns its own controls, its own heading and the provider that applies a change immediately.
 *   Nothing here reimplements or wraps them (Rule 1 clause 2: no unnecessary wrapper, no second state
 *   owner).
 * - The reset is `features/shell/components/dev-reset-control`, which composes the shared review step
 *   and the family's one `/api/dev` transport. This file passes it the development envelope's own
 *   `scope` and `revision` and adds no input of its own, so the attempt presents the authority and the
 *   revision the read actually reported.
 * - The source status is read, not computed: the source identity, the coverage state and the as-of
 *   instant are rendered exactly as the envelope states them. Nothing here derives a date, counts a
 *   record or formats an amount.
 *
 * **The reset section stays honest when it cannot be offered.** `readDevState` answers an envelope
 * only where the development build carries the runtime and the session's development document is
 * readable (AAP 0.7.2), so its other two arms render one sentence stating that the destructive reset
 * is a development-only operation this session does not carry and no control whatsoever. The section
 * keeps the same heading in that state, from the same `RESET_COPY` the control renders, so the surface
 * names what is absent instead of dropping the section and leaving the page short of a stated concern.
 *
 * **Landmarks, headings and direction.** The shell above this route owns the single `main` landmark,
 * the navigation rail, the context indicator and the persistent **Development data** label; this file
 * renders none of them and adds no second data-source label of its own. It renders exactly one `h1`
 * and one `h2` per section, in the order the family lists its concerns, so the document outline has a
 * head and each section is a landmark a screen reader can jump to. Spacing is logical and the column
 * starts at the reading edge, every opaque identifier is isolated inside `<bdi>`, every control the
 * sections render is at least 24x24 CSS px, and every colour, radius, shadow and space value resolves
 * to a token declared once in `styles/globals.css` — so nothing here states a visual value of its own
 * and an RTL page mirrors the page without a second style. Nothing scrolls horizontally, so the page
 * reflows to one column at 320 CSS pixels.
 *
 * **Freshness.** `dynamic = "force-dynamic"` is stated rather than inferred: both reads are derived
 * from this session's cookie and its stored documents on every request (AAP 0.7.2 — an accepted edit
 * survives a refresh because the document is on disk, and a reset replaces it), so a cached render
 * would serve a revision the store no longer holds and every later attempt would present a stale
 * `expectedRevision`.
 */

import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";

import StateNotice from "@/components/state-notice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import DevResetControl from "@/features/shell/components/dev-reset-control";
import SettingsPreferencePanel from "@/features/shell/components/settings-preference-panel";
import { RESET_COPY } from "@/features/shell/copy/dev-labels";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The two reads' own shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/**
 * The result types, inferred from the reads themselves.
 *
 * The view interfaces inside `data-service/reads/*` stay local to the service, so a route cannot
 * redeclare them into agreement with it: the shapes below are whatever the reads actually return.
 * That keeps one declaration of what an admission state and a development state are, and makes a
 * change to either read a compile error here rather than a silent mismatch.
 */
type SourceStatusResult = Awaited<ReturnType<typeof reads.context.readAdmissionState>>;
type DevelopmentResult = Awaited<ReturnType<typeof reads.dev.readDevState>>;
type SourceStatusEnvelope = Extract<SourceStatusResult, { kind: "envelope" }>["envelope"];
type DevelopmentEnvelope = Extract<DevelopmentResult, { kind: "envelope" }>["envelope"];

/** The coverage states the envelope closes, so the words below cannot fall behind the contract. */
type CoverageState = SourceStatusEnvelope["coverage"]["state"];

/** The scenario this session runs in, as the development read reports it. */
type DevelopmentScenario = DevelopmentEnvelope["data"]["scenario"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * Both reads are derived from this session's cookie on every request, and the reset replaces the
 * documents behind them, so the route is rendered per request rather than cached.
 */
export const dynamic = "force-dynamic";

/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Settings";

/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };

/**
 * The page's own wording: its title, the source-status section's heading and fact labels, and the one
 * sentence the reset section states when this session carries no development runtime.
 *
 * These are the words no other module owns. Every reset sentence belongs to `RESET_COPY` (imported
 * above, never copied), the **Development data** label belongs to `components/dev-banner`, the effect
 * sentences belong to `components/simulation-label` and the notice vocabulary belongs to
 * `components/state-notice`; nothing here restates any of them.
 */
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
    denied:
      "This session may not read the record that holds its own source status, so no source, coverage, as-of instant or development scenario is stated here.",
    unavailable:
      "The source that reports this session's status did not answer, so its coverage, its as-of instant and its development scenario are unavailable here rather than absent.",
  },
  resetUnavailable:
    "The destructive reset is a development-only operation, and this session does not carry the development runtime that performs it, so there is no reset control here rather than one that could not act.",
} as const;

/**
 * How each coverage state reads in words.
 *
 * Keyed on the envelope's own union rather than a local copy, so a fourth state added to the contract
 * fails this file's compilation instead of rendering an unlabelled value. The three sentences differ
 * because the three facts differ: a whole period, a part of one, and a period whose extent the source
 * does not state.
 */
const COVERAGE_WORDS: Readonly<Record<CoverageState, string>> = {
  complete: "Complete: the source covers the whole period it reports.",
  partial:
    "Partial: the source covers only part of the period, so a total built from it is an incomplete subtotal.",
  unknown:
    "Unknown: the source does not state how much of the period it covers, so a total built from it is an incomplete subtotal.",
};

// ---------------------------------------------------------------------------------------------
// The source-status section
// ---------------------------------------------------------------------------------------------

/** One labelled fact of the source status, as a definition pair inside the section's list. */
function StatusFact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5 text-sm text-pretty">{children}</dd>
    </div>
  );
}

/**
 * The source status: where this session's data came from, how much of the past it covers, when it was
 * read, and — when the development read answered — which scenario the session is running in.
 *
 * The envelope arm renders the facts verbatim: the source's system and reference are opaque text and
 * are shown as such inside `<bdi>`, so a mixed-direction neighbour cannot reorder them and nothing
 * parses them back into parts. A refusal and an outage render the one notice component, at this
 * section's heading level, and neither ever becomes a zero or an empty list.
 */
function SourceStatusSection({
  result,
  scenario,
}: {
  readonly result: SourceStatusResult;
  readonly scenario: DevelopmentScenario | null;
}): ReactElement {
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
              <StatusFact label={SETTINGS_COPY.sourceStatus.coverageLabel}>
                {COVERAGE_WORDS[envelope.coverage.state]}
              </StatusFact>
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
      return (
        <StateNotice
          kind="denied"
          headingLevel={2}
          title={SETTINGS_COPY.sourceStatus.heading}
          description={SETTINGS_COPY.sourceStatus.denied}
          reasonCode={result.denied.reasonCode}
        />
      );
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          headingLevel={2}
          title={SETTINGS_COPY.sourceStatus.heading}
          description={SETTINGS_COPY.sourceStatus.unavailable}
          source={result.unavailable.source}
        />
      );
    default:
      return assertNever(result, "Unhandled admission read result");
  }
}

// ---------------------------------------------------------------------------------------------
// The development read, as the reset section needs it
// ---------------------------------------------------------------------------------------------

/**
 * The development envelope, or `null` when `readDevState` answered with anything else.
 *
 * The two other arms stay named and separate: a refusal means this session holds no development
 * runtime it may use, and an outage means the runtime's state could not be read, which is not the
 * same fact as a runtime that is idle — and neither is a runtime this page may offer a destructive
 * control for. Both therefore answer `null`, and the reset section states that in words instead of
 * mounting a control the service would refuse.
 */
function developmentEnvelopeOf(result: DevelopmentResult): DevelopmentEnvelope | null {
  switch (result.kind) {
    case "envelope":
      return result.envelope;
    case "denied":
      return null;
    case "unavailable":
      return null;
    default:
      return assertNever(result, "Unhandled development read result");
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/**
 * The Settings screen.
 *
 * Two reads, one `h1`, then the family's concerns in the order it lists them: the three presentation
 * preferences, the source status, and the confirmed reset. No arm of either read removes a section —
 * each states its own condition in place — so the page never renders a shorter surface than it
 * describes, and every section keeps the heading its concern is named by.
 */
export default async function SettingsPage(): Promise<ReactElement> {
  // Both answers describe the same request and neither depends on the other, so they are read
  // together rather than one after the other.
  const [sourceStatus, development] = await Promise.all([
    reads.context.readAdmissionState(),
    reads.dev.readDevState(),
  ]);

  const developmentEnvelope = developmentEnvelopeOf(development);
  // The scenario is reported by the development read alone: the admission read answers `null` for it
  // in four of its states, so it is not a second source for the same fact.
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
        <DevResetControl
          scope={developmentEnvelope.scope}
          expectedRevision={developmentEnvelope.revision}
        />
      )}
    </div>
  );
}
