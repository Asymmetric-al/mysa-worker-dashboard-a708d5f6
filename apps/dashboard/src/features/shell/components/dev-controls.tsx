"use client";
import { useCallback, useId, useRef, useState, type ReactElement } from "react";
import { mayReplay } from "@/components/action-review";
import DevPanel from "@/components/dev-panel";
import { refusalSummary } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import { PERSONA_KIND_LABELS, PERSONA_SESSION_STATE_LABELS, PERSONA_SESSION_STATE_OUTCOMES } from "@/components/persona-switcher";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SectionCard from "@/components/section-card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import type { MutationOutcome, Scope } from "@/modules/data-service";
import { isOutcome, outcomeFromError } from "@/modules/data-service/outcome";
import type { DevState } from "@/modules/data-service/reads/dev";
import { CLOCK_COPY, CLOCK_PRESETS, DEV_READ_COPY, PERSONA_SWITCH_COPY } from "../copy/dev-labels";
import { useDevMutations, type DevMutationTransports } from "../hooks/use-dev-mutations";
import { useDevState } from "../hooks/use-dev-state";
const UNREACHED_ATTEMPT = "dev-controls";
const NOTICE_HEADING_LEVEL = 2;
type ClockPreset = (typeof CLOCK_PRESETS)[number];
const noticeFrame = (state: string, className: string | undefined, notice: ReactElement): ReactElement => <div {...{ "data-slot": "dev-controls", "data-state": state, className: cn("min-w-0", className) }}>{notice}</div>;
export type DevControlsProps = { readonly scope: Scope; readonly developmentControls: boolean; readonly className?: string };
/** The single composition of this session's development controls, or nothing at all in a build without them. */ export function DevControls({ scope, developmentControls, className }: DevControlsProps): ReactElement | null {
  const devRead = useDevState(scope, developmentControls);
  const envelope = devRead.data?.kind === "envelope" ? devRead.data.envelope : null;
  const transports = useDevMutations(scope, envelope, developmentControls);
  const refetch = devRead.refetch;
  const reread = useCallback((): void => void refetch(), [refetch]);
  if (!developmentControls) return null;
  const retry = { label: DEV_READ_COPY.retryLabel, onClick: reread };
  if (devRead.data === undefined) {
    return devRead.isPending || devRead.isFetching
      ? noticeFrame("loading", className, <StateNotice kind="loading" title={DEV_READ_COPY.loadingTitle} headingLevel={NOTICE_HEADING_LEVEL} loadingLines={4} />)
      : noticeFrame("unavailable", className, <StateNotice kind="unavailable" title={DEV_READ_COPY.unavailableTitle} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />);
  }
  const read = devRead.data;
  if (read.kind === "denied") return noticeFrame("denied", className, <StateNotice kind="denied" title={DEV_READ_COPY.deniedTitle} reasonCode={read.denied.reasonCode} headingLevel={NOTICE_HEADING_LEVEL} />);
  if (read.kind === "unavailable") return noticeFrame("unavailable", className, <StateNotice kind="unavailable" title={DEV_READ_COPY.unavailableTitle} source={read.unavailable.source} description={read.unavailable.guidance} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />);
  if (read.kind === "refused") return noticeFrame("refused", className, <StateNotice kind="refused" title={DEV_READ_COPY.refusedTitle} description={refusalSummary(read.refused)} headingLevel={NOTICE_HEADING_LEVEL} />);
  return transports !== null ? <ReadyControls devState={read.envelope.data} transports={transports} onReread={reread} className={className} /> : null;
}
function ReadyControls({ devState, transports, onReread, className }: { readonly devState: DevState; readonly transports: DevMutationTransports; readonly onReread: () => void; readonly className?: string }): ReactElement {
  const presetsHintId = useId();
  const [receipt, setReceipt] = useState<{ readonly preset: string; readonly outcome: MutationOutcome } | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const advancingRef = useRef(false);
  const lastPreset = useRef<ClockPreset | null>(null);
  const advanceBy = useCallback(
    async (preset: ClockPreset): Promise<void> => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      setAdvancing(true);
      lastPreset.current = preset;
      let outcome: MutationOutcome;
      try {
        const answered: unknown = await transports.onAdvanceClock(preset.seconds * 1_000);
        outcome = isOutcome(answered) ? answered : outcomeFromError(UNREACHED_ATTEMPT, answered);
      } catch (error) {
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
    if (preset !== null) void advanceBy(preset);
  }, [advanceBy]);
  const receiptHeading = receipt !== null && (receipt.outcome.outcome === "accepted" || receipt.outcome.outcome === "alreadyAccepted" || receipt.outcome.outcome === "unchanged") ? `${CLOCK_COPY.advanceLabel}: ${receipt.preset}` : undefined;
  return (
    <div data-slot="dev-controls" data-state="ready" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <DevPanel devState={devState} onSetScenario={transports.onSetScenario} onSetClock={transports.onSetClock} onAdvanceClock={transports.onAdvanceClock} onSetFailurePlan={transports.onSetFailurePlan} reset={transports.reset} />
      <fieldset data-slot="dev-controls-presets" aria-describedby={presetsHintId} aria-busy={advancing ? true : undefined} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
        <legend className="px-1 text-sm font-medium">{CLOCK_COPY.presetsLabel}</legend>
        <p {...{ id: presetsHintId, className: "type-supporting text-pretty" }}>{CLOCK_COPY.body}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {CLOCK_PRESETS.map((preset) => (
            <Button key={preset.label} type="button" variant="outline" size="sm" onClick={() => void advanceBy(preset)}>
              {preset.label}
            </Button>
          ))}
        </div>
        {advancing ? <output className="block type-supporting text-pretty">{CLOCK_COPY.presetPendingNote}</output> : null}
        {receipt === null ? null : (
          <div data-slot="dev-controls-preset-result" data-outcome={receipt.outcome.outcome} className="min-w-0">
            <OperationResult outcome={receipt.outcome} heading={receiptHeading} headingLevel={4} onCheckResult={receipt !== null && receipt.outcome.outcome === "unknown" ? onReread : undefined} onRetrySameWork={receipt !== null && mayReplay(receipt.outcome) ? replay : undefined} />
          </div>
        )}
      </fieldset>
      <PersonaControl devState={devState} onSelectPersona={transports.onSelectPersona} onReread={onReread} />
    </div>
  );
}
const isSettledOutcome = (outcome: MutationOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
/** The identity this browser acts as, and the one control that changes it: the seeded sessions the development read lists, offered exactly as that read lists them. */
function PersonaControl({ devState, onSelectPersona, onReread }: { readonly devState: DevState; readonly onSelectPersona: (personaId: string) => Promise<MutationOutcome>; readonly onReread: () => void }): ReactElement {
  const { personaCatalogue: catalogue, activePersonaId, sessionState } = devState;
  const activePersona = catalogue.personas.find((persona) => persona.id === activePersonaId);
  const [receipt, setReceipt] = useState<{ readonly personaId: string; readonly outcome: MutationOutcome } | null>(null);
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const lastPersonaId = useRef<string | null>(null);
  const selectId = useId();
  const switchPersona = useCallback(
    async (personaId: string): Promise<void> => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      setSwitching(true);
      lastPersonaId.current = personaId;
      let outcome: MutationOutcome;
      try {
        const answered: unknown = await onSelectPersona(personaId);
        outcome = isOutcome(answered) ? answered : outcomeFromError(UNREACHED_ATTEMPT, answered);
      } catch (error) {
        outcome = outcomeFromError(UNREACHED_ATTEMPT, error);
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
      setReceipt({ personaId, outcome });
    },
    [onSelectPersona],
  );
  const replay = useCallback((): void => {
    const personaId = lastPersonaId.current;
    if (personaId !== null) void switchPersona(personaId);
  }, [switchPersona]);
  const switched = receipt === null ? undefined : catalogue.personas.find((persona) => persona.id === receipt.personaId);
  const receiptHeading = receipt !== null && isSettledOutcome(receipt.outcome) ? `${PERSONA_SWITCH_COPY.label}: ${switched?.label ?? receipt.personaId}` : undefined;
  return (
    <SectionCard title={PERSONA_SWITCH_COPY.label} headingLevel={3} description={PERSONA_SWITCH_COPY.explanation} cardClassName="min-w-0" dataSlot="dev-controls-identity" contentClassName="flex min-w-0 flex-col gap-4">
      <p className="type-supporting text-pretty">{PERSONA_SWITCH_COPY.selectionNote}</p>
      <p className="type-supporting text-pretty">{PERSONA_SWITCH_COPY.grantsNothingNote}</p>
      {catalogue.state !== "persisted" && catalogue.finding !== null ? <p className="type-supporting text-pretty">{catalogue.finding}</p> : null}
      {catalogue.personas.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={selectId}>{PERSONA_SWITCH_COPY.selectLabel}</Label>
          <NativeSelect id={selectId} className="w-full max-w-full" value={activePersonaId ?? ""} aria-busy={switching ? true : undefined} disabled={switching} onChange={(event) => void switchPersona(event.currentTarget.value)}>
            {activePersonaId === null ? <NativeSelectOption {...{ value: "", disabled: true }}>No persona selected</NativeSelectOption> : null}
            {catalogue.personas.map((persona) => (
              <NativeSelectOption key={persona.id} value={persona.id}>
                {`${persona.label} — ${PERSONA_KIND_LABELS[persona.kind].label}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="type-supporting text-pretty">{activePersona === undefined ? PERSONA_SWITCH_COPY.unlistedIdentityNote : activePersona.description}</p>
          {activePersona === undefined ? null : <output {...{ "aria-atomic": "true", className: "mono-identifier text-xs break-all text-muted-foreground" }}>{activePersona.id}</output>}
        </div>
      )}
      <p className="flex min-w-0 flex-wrap items-center gap-2 type-supporting">
        <Badge variant="outline">{PERSONA_SESSION_STATE_LABELS[sessionState].label}</Badge>
        <span className="min-w-0 text-pretty text-muted-foreground">{PERSONA_SESSION_STATE_OUTCOMES[sessionState]}</span>
      </p>
      {switching ? <output className="block type-supporting text-pretty">{PERSONA_SWITCH_COPY.pendingNote}</output> : null}
      {receipt === null ? null : (
        <div data-slot="dev-controls-persona-result" data-outcome={receipt.outcome.outcome} className="min-w-0">
          <OperationResult outcome={receipt.outcome} heading={receiptHeading} headingLevel={4} onCheckResult={receipt.outcome.outcome === "unknown" ? onReread : undefined} onRetrySameWork={mayReplay(receipt.outcome) ? replay : undefined} />
        </div>
      )}
    </SectionCard>
  );
}
export default DevControls;
