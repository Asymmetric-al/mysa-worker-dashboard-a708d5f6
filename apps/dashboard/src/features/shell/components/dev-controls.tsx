"use client";
/**
 * The one development-control composition: the shared development panel and the identity statement this
 * session's runtime supports, bound to the session's development read and to the controls it advertises.
 *
 * The invariants this file holds:
 *
 * - It renders nothing at all outside a development build. The flag arrives from the server-rendered shell
 *   as a prop, so no browser bundle re-derives the build's environment to decide a control surface exists.
 * - It schedules nothing. The runtime is reached only through the sibling hooks (`GET|POST /api/dev`), which
 *   re-read after their own mutation; there is no timer, no interval and no poll, so the scenario clock moves
 *   only when a control here is operated (AAP assumption A12).
 * - It offers only what the development read advertises: the scenarios, the failure modes and named targets,
 *   the presets and the identity roster all arrive in that envelope, so no control names a value the runtime
 *   does not hold (AAP assumption A13).
 * - The identity roster is stated, not switched. The development service advertises the five named controls
 *   of the specification and no call that changes the seeded session a browser acts as, so no selector is
 *   drawn here that no request could honour; switching identities is the seeded session's
 *   `dashboard_session` cookie and a deterministic reset, and the statement says exactly that.
 * - Every state that is not a result renders through the shared `StateNotice` and every outcome a control
 *   produces renders through the shared `OperationResult`, so an outage, a refusal or an unconfirmed effect
 *   can never be mistaken for an empty plan or an empty list.
 */
import { useCallback, useId, useRef, useState, type ReactElement } from "react";

import { mayReplay } from "@/components/action-review";
import DevPanel from "@/components/dev-panel";
import { refusalSummary } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import { PERSONA_KIND_LABELS, PERSONA_SESSION_STATE_LABELS, PERSONA_SESSION_STATE_OUTCOMES } from "@/components/persona-switcher";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationOutcome, Scope } from "@/modules/data-service";
import { isOutcome, outcomeFromError } from "@/modules/data-service/outcome";
import type { DevState } from "@/modules/data-service/reads/dev";

import { CLOCK_COPY, CLOCK_PRESETS, DEV_READ_COPY, PERSONA_SWITCH_COPY } from "../copy/dev-labels";
import { useDevMutations, type DevMutationTransports } from "../hooks/use-dev-mutations";
import { useDevState } from "../hooks/use-dev-state";

/** The attempt identity this surface states when a transport threw instead of answering: it names this panel, never a record. */
const UNREACHED_ATTEMPT = "dev-controls";

/** The heading level the panel's own notices use: the composition sits below the shell's region label. */
const NOTICE_HEADING_LEVEL = 2;

/** The heading level a receipt rendered beside a control uses, one step below the card that holds it. */
const RECEIPT_HEADING_LEVEL = 4;

/** One entry of {@link CLOCK_PRESETS}, taken from the copy module rather than restated. */
type ClockPreset = (typeof CLOCK_PRESETS)[number];

/** The receipt of the last preset advance: which preset was asked for, and what the service answered. */
type PresetReceipt = { readonly preset: string; readonly outcome: MutationOutcome };

/** Whether an outcome records work that was applied, which is when the receipt names what was done. */
const isSettled = (outcome: MutationOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";

export type DevControlsProps = {
  /** The exact authority the server render read under; every control submits it and the service re-authorises it. */
  readonly scope: Scope;
  /** Whether this build carries development controls at all, decided by the server-rendered shell. */
  readonly developmentControls: boolean;
  readonly className?: string;
};

/**
 * The single composition of this session's development controls, or nothing at all in a build without them.
 */
export function DevControls({ scope, developmentControls, className }: DevControlsProps): ReactElement | null {
  const devRead = useDevState(scope, developmentControls);
  const envelope = devRead.data?.kind === "envelope" ? devRead.data.envelope : null;
  const transports = useDevMutations(scope, envelope, developmentControls);
  const refetch = devRead.refetch;
  /** Re-reads the runtime: the one retry this surface offers, and the only refetch it ever issues. */
  const reread = useCallback((): void => {
    void refetch();
  }, [refetch]);

  // A build without development controls renders nothing: no disabled control, no placeholder and no
  // sentence explaining an absence, because an absence is not a surface (AAP 0.10.2).
  if (!developmentControls) {
    return null;
  }

  const retry = { label: DEV_READ_COPY.retryLabel, onClick: reread };

  if (devRead.data === undefined) {
    // A read that has not answered yet is busy rather than empty, and a read that will not answer is an
    // outage with its own retry: neither of them is ever drawn as "no plan armed" (requirement 4).
    return devRead.isPending || devRead.isFetching ? (
      <div data-slot="dev-controls" data-state="loading" className={cn("min-w-0", className)}>
        <StateNotice kind="loading" title={DEV_READ_COPY.loadingTitle} headingLevel={NOTICE_HEADING_LEVEL} loadingLines={4} />
      </div>
    ) : (
      <div data-slot="dev-controls" data-state="unavailable" className={cn("min-w-0", className)}>
        <StateNotice kind="unavailable" title={DEV_READ_COPY.unavailableTitle} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />
      </div>
    );
  }

  const read = devRead.data;

  if (read.kind === "denied") {
    // The reason code is the service's own, and nothing here adds a count, a title or an existence flag to it.
    return (
      <div data-slot="dev-controls" data-state="denied" className={cn("min-w-0", className)}>
        <StateNotice kind="denied" title={DEV_READ_COPY.deniedTitle} reasonCode={read.denied.reasonCode} headingLevel={NOTICE_HEADING_LEVEL} />
      </div>
    );
  }

  if (read.kind === "unavailable") {
    return (
      <div data-slot="dev-controls" data-state="unavailable" className={cn("min-w-0", className)}>
        <StateNotice kind="unavailable" title={DEV_READ_COPY.unavailableTitle} source={read.unavailable.source} description={read.unavailable.guidance} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />
      </div>
    );
  }

  if (read.kind === "refused") {
    // A refused request is the request's own fault rather than the source's, so its per-field messages are
    // the message: the source answered, and calling that an outage would say a source failed that spoke.
    return (
      <div data-slot="dev-controls" data-state="refused" className={cn("min-w-0", className)}>
        <StateNotice kind="refused" title={DEV_READ_COPY.refusedTitle} description={refusalSummary(read.refused)} headingLevel={NOTICE_HEADING_LEVEL} />
      </div>
    );
  }

  if (transports !== null) {
    return <ReadyControls devState={read.envelope.data} transports={transports} onReread={reread} className={className} />;
  }

  // The transports are built from the envelope this branch already holds, so a read that answered an
  // envelope always carries them and nothing reaches this line. It claims nothing rather than drawing a
  // panel whose controls have no transport.
  return null;
}

type ReadyControlsProps = {
  /** The development state the read answered: the scenario, the clock, the armed plan and the roster. */
  readonly devState: DevState;
  /** The controls built from that state, so each one it offers is a control the runtime advertises. */
  readonly transports: DevMutationTransports;
  /** Re-reads the runtime, which is how an unconfirmed advance is checked without resubmitting it. */
  readonly onReread: () => void;
  readonly className?: string;
};

/** The advertised controls: the shared development panel, the preset advances and the identity statement. */
function ReadyControls({ devState, transports, onReread, className }: ReadyControlsProps): ReactElement {
  const presetsHintId = useId();
  const [receipt, setReceipt] = useState<PresetReceipt | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const advancingRef = useRef(false);
  const lastPreset = useRef<ClockPreset | null>(null);

  const advanceBy = useCallback(
    async (preset: ClockPreset): Promise<void> => {
      if (advancingRef.current) {
        return;
      }
      advancingRef.current = true;
      setAdvancing(true);
      lastPreset.current = preset;
      let outcome: MutationOutcome;
      try {
        // The transport moves the clock by milliseconds of elapsed time and the preset states the amount in
        // seconds, so this is the one conversion and it is exact: 60 s stays 60 000 ms.
        const answered: unknown = await transports.onAdvanceClock(preset.seconds * 1_000);
        outcome = isOutcome(answered) ? answered : outcomeFromError(UNREACHED_ATTEMPT, answered);
      } catch (error) {
        // A transport that threw produced no answer at all, so the attempt is reported by the identity it
        // carried rather than as either a success or a failure of the clock.
        outcome = outcomeFromError(UNREACHED_ATTEMPT, error);
      } finally {
        advancingRef.current = false;
        setAdvancing(false);
      }
      setReceipt({ preset: preset.label, outcome });
    },
    [transports],
  );

  const replay = useCallback((): void => {
    const preset = lastPreset.current;
    if (preset !== null) {
      void advanceBy(preset);
    }
  }, [advanceBy]);

  const receiptHeading = receipt !== null && isSettled(receipt.outcome) ? `${CLOCK_COPY.advanceLabel}: ${receipt.preset}` : undefined;
  const receiptReplay = receipt !== null && mayReplay(receipt.outcome) ? replay : undefined;
  const receiptCheck = receipt !== null && receipt.outcome.outcome === "unknown" ? onReread : undefined;

  return (
    <div data-slot="dev-controls" data-state="ready" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <DevPanel devState={devState} onSetScenario={transports.onSetScenario} onSetClock={transports.onSetClock} onAdvanceClock={transports.onAdvanceClock} onSetFailurePlan={transports.onSetFailurePlan} reset={transports.reset} />
      <fieldset data-slot="dev-controls-presets" aria-describedby={presetsHintId} aria-busy={advancing ? true : undefined} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-medium">{CLOCK_COPY.presetsLabel}</legend>
        <p id={presetsHintId} className="text-sm text-pretty text-muted-foreground">
          {CLOCK_COPY.body}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {CLOCK_PRESETS.map((preset) => (
            // Never `disabled` while its own request is in flight: a control that disables itself under the
            // keyboard drops focus to the document body, so the next Tab restarts at the top of the page. The
            // in-flight guard ignores a second press and the busy note states what is happening instead.
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void advanceBy(preset);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        {advancing ? <output className="block text-sm text-pretty text-muted-foreground">{CLOCK_COPY.presetPendingNote}</output> : null}
        {receipt === null ? null : (
          <div data-slot="dev-controls-preset-result" data-outcome={receipt.outcome.outcome} className="min-w-0">
            <OperationResult outcome={receipt.outcome} heading={receiptHeading} headingLevel={RECEIPT_HEADING_LEVEL} onCheckResult={receiptCheck} onRetrySameWork={receiptReplay} />
          </div>
        )}
      </fieldset>
      <IdentityStatement devState={devState} />
    </div>
  );
}

/**
 * The identity this session carries, as the development read reports it: the roster, the one entry that is
 * active and the admission state, stated rather than switched because the runtime advertises no such call.
 */
function IdentityStatement({ devState }: { readonly devState: DevState }): ReactElement {
  const { personaCatalogue: catalogue, activePersonaId, sessionState } = devState;
  const activePersona = catalogue.personas.find((persona) => persona.id === activePersonaId);
  const catalogueFinding = catalogue.finding ?? PERSONA_SWITCH_COPY.unlistedIdentityNote;
  return (
    <Card data-slot="dev-controls-identity" className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h3>{PERSONA_SWITCH_COPY.label}</h3>
        </CardTitle>
        <CardDescription>{PERSONA_SWITCH_COPY.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-pretty text-muted-foreground">{PERSONA_SWITCH_COPY.grantsNothingNote}</p>
        <p className="text-sm text-pretty text-muted-foreground">{PERSONA_SWITCH_COPY.switchUnavailableNote}</p>
        <Separator />
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="text-sm font-medium">{PERSONA_SWITCH_COPY.carriesLabel}</h4>
          {catalogue.state !== "persisted" ? (
            <p className="text-sm text-pretty text-muted-foreground">{catalogueFinding}</p>
          ) : activePersona === undefined ? (
            <p className="text-sm text-pretty text-muted-foreground">{PERSONA_SWITCH_COPY.unlistedIdentityNote}</p>
          ) : (
            <output aria-atomic="true" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <bdi className="min-w-0 font-medium break-words">{activePersona.label}</bdi>
              <Badge variant="outline">{PERSONA_KIND_LABELS[activePersona.kind].label}</Badge>
              <bdi className="mono-identifier text-xs break-all text-muted-foreground">{activePersona.id}</bdi>
            </output>
          )}
        </div>
        {catalogue.state !== "persisted" ? null : (
          <div className="flex min-w-0 flex-col gap-1">
            <h4 className="text-sm font-medium">{PERSONA_SWITCH_COPY.rosterLabel}</h4>
            <ul className="flex min-w-0 flex-col gap-2 text-sm">
              {catalogue.personas.map((persona) => (
                <li key={persona.id} className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <bdi className="min-w-0 font-medium break-words">{persona.label}</bdi>
                    <Badge variant="outline">{PERSONA_KIND_LABELS[persona.kind].label}</Badge>
                    {persona.id === activePersonaId ? <Badge variant="secondary">{PERSONA_SWITCH_COPY.activeMarker}</Badge> : null}
                    <bdi className="mono-identifier text-xs break-all text-muted-foreground">{persona.id}</bdi>
                  </span>
                  <span className="text-xs text-pretty text-muted-foreground break-words">{persona.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Separator />
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="text-sm font-medium">{PERSONA_SWITCH_COPY.sessionStateLabel}</h4>
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{PERSONA_SESSION_STATE_LABELS[sessionState].label}</Badge>
            <span className="min-w-0 text-pretty text-muted-foreground">{PERSONA_SESSION_STATE_OUTCOMES[sessionState]}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default DevControls;
