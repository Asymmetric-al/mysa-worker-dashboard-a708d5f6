"use client";
import { useId } from "react";
import StatusBadge, { statusBadgeProps, type StatusBadgeSpec } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { SESSION_STATES, type SessionState } from "@/modules/data-service/envelope";
/** What a seeded identity is, for the purpose of grouping the switch. */
export type PersonaKind = "reader" | "worker" | "reviewer" | "coach";
/** One seeded persona, as the development runtime read supplies it. */
export interface PersonaOption {
  readonly id: string;
  readonly kind: PersonaKind;
  readonly label: string;
  readonly description: string;
}
/** The closed set of session states the switch can demonstrate, in the order the specification lists them: the four admissions and then the no-access user, whose only honest outcome is. */
export const PERSONA_SESSION_STATES = SESSION_STATES;
/** A member of {@link PERSONA_SESSION_STATES}: the envelope's own session state. */
export type PersonaSessionState = SessionState;
/** The word and tone of each session state. */
export const PERSONA_SESSION_STATE_LABELS: Readonly<Record<PersonaSessionState, StatusBadgeSpec>> = {
  "signed-in": { label: "Signed in", tone: "neutral" },
  unavailable: { label: "Session unavailable", tone: "danger" },
  denied: { label: "Access denied", tone: "danger" },
  expired: { label: "Session expired", tone: "caution" },
  "no-access": { label: "No account access", tone: "caution" },
};
/** What each session state produces, stated beside the state so the scenario is legible without running it (AAP 0.10.1 shell row, criterion 19). */
export const PERSONA_SESSION_STATE_OUTCOMES: Readonly<Record<PersonaSessionState, string>> = {
  "signed-in": "The workspace renders for the selected persona.",
  unavailable: "The session cannot be read, so the surface offers its recovery path instead of any data.",
  denied: "The persona is refused, and no count, title, size or existence of a hidden record is revealed.",
  expired: "The session has expired, so the surface offers the recovery path and shows no data.",
  "no-access": "No admitted identity exists, so only account-recovery guidance is shown.",
};
/** Whether a raw value is one of the five states this control can label. */
export function isPersonaSessionState(value: string): value is PersonaSessionState {
  return Object.hasOwn(PERSONA_SESSION_STATE_LABELS, value);
}
/** How each persona kind reads. */
export const PERSONA_KIND_LABELS: Readonly<Record<PersonaKind, StatusBadgeSpec>> = {
  reader: { label: "Receiving reader", tone: "muted" },
  worker: { label: "Worker", tone: "neutral" },
  reviewer: { label: "Reviewer", tone: "neutral" },
  coach: { label: "Coach", tone: "neutral" },
};
function kindLabel(kind: PersonaKind): StatusBadgeSpec {
  return Object.hasOwn(PERSONA_KIND_LABELS, kind) ? PERSONA_KIND_LABELS[kind] : { label: String(kind), tone: "muted" };
}
const PERSONA_GROUP_ORDER = ["receiving", "worker-side", "other"] as const;

type PersonaGroup = (typeof PERSONA_GROUP_ORDER)[number];

const PERSONA_GROUP_LABELS: Readonly<Record<PersonaGroup, string>> = {
  receiving: "Receiving readers",
  "worker-side": "Worker-side identities",
  other: "Other seeded identities",
};
const PERSONA_GROUP_OF_KIND: Readonly<Record<PersonaKind, PersonaGroup>> = {
  reader: "receiving",
  worker: "worker-side",
  reviewer: "worker-side",
  coach: "worker-side",
};
function groupOfKind(kind: PersonaKind): PersonaGroup {
  return Object.hasOwn(PERSONA_GROUP_OF_KIND, kind) ? PERSONA_GROUP_OF_KIND[kind] : "other";
}
function groupPersonas(personas: readonly PersonaOption[]): Readonly<Record<PersonaGroup, readonly PersonaOption[]>> {
  const groups: Record<PersonaGroup, PersonaOption[]> = {
    receiving: [],
    "worker-side": [],
    other: [],
  };
  for (const persona of personas) {
    groups[groupOfKind(persona.kind)].push(persona);
  }
  return groups;
}
const DEVELOPMENT_CONTROL_NOTICE =
  "Switches the development persona for this session only. No sign-in occurs, and a selection grants " +
  "nothing: every read is authorised again, so a persona that may not read a surface is refused.";
const SESSION_SCENARIO_NOTICE = "Development scenario only: it is not a sign-out, and it does not clear saved development data.";
/** Props of {@link PersonaSwitcher}. */
export interface PersonaSwitcherProps {
  readonly personas: readonly PersonaOption[];
  readonly activePersonaId: string;
  readonly onSelect: (personaId: string) => void;
  readonly sessionStates?: readonly PersonaSessionState[];
  readonly activeSessionState?: string;
  readonly onSelectSessionState?: (state: string) => void;
  readonly label?: string;
  readonly className?: string;
}
/** The single switch over the seeded preview personas and the session states. */
export function PersonaSwitcher({ personas, activePersonaId, onSelect, sessionStates, activeSessionState, onSelectSessionState, label = "Preview persona", className }: PersonaSwitcherProps) {
  const personaSelectId = useId();
  const viewingAsId = useId();
  const sessionStateSelectId = useId();
  const sessionOutcomeId = useId();
  const activeId = activePersonaId.trim();
  const activePersona = activeId === "" ? undefined : personas.find((persona) => persona.id === activeId);
  const groups = groupPersonas(personas);
  // The states this control offers. The active state is added when the surface did not offer it, so the
  // select shows what the development session actually carries instead of a blank selection.
  const stateOptions: string[] = [...(sessionStates ?? [])];
  const activeState = activeSessionState?.trim() ?? "";
  if (activeState !== "" && !stateOptions.includes(activeState)) {
    stateOptions.unshift(activeState);
  }
  // One narrowing over both halves of the active state's presentation, so the word and its outcome can
  // never come from different members.
  const activeStateSpec = isPersonaSessionState(activeState)
    ? {
        label: statusBadgeProps(PERSONA_SESSION_STATE_LABELS, activeState),
        outcome: PERSONA_SESSION_STATE_OUTCOMES[activeState],
      }
    : undefined;
  const canSwitchState = onSelectSessionState !== undefined && stateOptions.length > 0;
  return (
    <fieldset
      // A fieldset is the right container for two related form controls: it gives the pair one
      // accessible group name from its `legend`. `min-w-0` defeats the fieldset's default
      // `min-inline-size: min-content`, which is what would otherwise push the page sideways at
      // 320 CSS px; the border and padding are removed because the frame around this control is the
      // shell's development region, not a browser default.
      className={cn("m-0 min-w-0 border-0 p-0", className)}
      data-slot="persona-switcher"
      data-active-persona={activeId === "" ? undefined : activeId}
      data-active-session-state={activeState === "" ? undefined : activeState}
    >
      <legend className="mb-2 min-w-0 text-sm leading-none font-medium">{label}</legend>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant="outline">Development control</Badge>
          <span className="min-w-0 text-muted-foreground text-pretty wrap-anywhere">{DEVELOPMENT_CONTROL_NOTICE}</span>
        </p>
        <div className="flex min-w-0 flex-col gap-1.5">
          {personas.length === 0 ? null : (
            <>
              <Label htmlFor={personaSelectId}>Persona</Label>
              <NativeSelect
                id={personaSelectId}
                className="w-full max-w-full"
                value={activePersona === undefined ? activeId : activePersona.id}
                aria-describedby={viewingAsId}
                onChange={(event) => {
                  // Asks for a different seeded persona; the runtime decides, and every read that
                  // follows is authorised again against whatever it decided.
                  onSelect(event.target.value);
                }}
              >
                {activeId === "" ? (
                  // A real state, named: a blank select would read as a control that failed to load,
                  // and `disabled` keeps it from being chosen as if it were a persona.
                  <NativeSelectOption value="" disabled>
                    No persona selected
                  </NativeSelectOption>
                ) : null}
                {PERSONA_GROUP_ORDER.map((group) =>
                  groups[group].length === 0 ? null : (
                    <NativeSelectOptGroup key={group} label={PERSONA_GROUP_LABELS[group]}>
                      {groups[group].map((persona) => (
                        <NativeSelectOption key={persona.id} value={persona.id}>
                          {persona.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ),
                )}
                {activeId === "" || activePersona !== undefined ? null : (
                  // The session carries a persona the supplied list does not describe. Listing its
                  // identifier keeps the select truthful; a guessed label would not.
                  <NativeSelectOptGroup label="Unrecognised persona">
                    <NativeSelectOption value={activeId}>{activeId}</NativeSelectOption>
                  </NativeSelectOptGroup>
                )}
              </NativeSelect>
            </>
          )}
          <output
            id={viewingAsId}
            // `output` is the semantic status element: it carries the implicit `status` role and the
            // polite live region a change needs, without a `role` attribute on a generic element. This
            // is the component's only live region — a change of persona is announced once, here — and
            // the sentence stays short by design, because a region that also carried the description
            // would read a paragraph on every switch. `htmlFor` names the control whose value it
            // reports, which is exactly what this sentence does.
            htmlFor={personaSelectId}
            aria-atomic="true"
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          >
            <span className="text-muted-foreground">Viewing as:</span>
            {activeId === "" ? (
              <span className="font-medium">no persona is selected</span>
            ) : activePersona === undefined ? (
              <>
                <span className="font-medium">an unrecognised persona</span>
                <bdi className="min-w-0 mono-identifier break-all">{activeId}</bdi>
              </>
            ) : (
              <>
                <bdi className="min-w-0 font-medium break-words">{activePersona.label}</bdi>
                <StatusBadge {...kindLabel(activePersona.kind)} srPrefix="Identity" />
              </>
            )}
          </output>
          {activePersona === undefined || activePersona.description.trim() === "" ? null : (
            // Outside the live region on purpose: this says what the persona demonstrates, so it is read
            // when the reader chooses to rather than announced on every change.
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{activePersona.description}</p>
          )}
          {personas.length === 0 ? (
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">No seeded personas are available in this session, so there is nothing to switch here.</p>
          ) : null}
        </div>
        {stateOptions.length === 0 ? null : (
          <>
            <Separator />
            <div className="flex min-w-0 flex-col gap-1.5">
              {canSwitchState ? (
                <>
                  <Label htmlFor={sessionStateSelectId}>Session state</Label>
                  <NativeSelect
                    id={sessionStateSelectId}
                    className="w-full max-w-full"
                    value={activeState}
                    aria-describedby={sessionOutcomeId}
                    onChange={(event) => {
                      onSelectSessionState?.(event.target.value);
                    }}
                  >
                    {activeState === "" ? (
                      // Named rather than blank, and `disabled` so a scenario cannot be "cleared" by
                      // picking an empty option that stands for no state at all.
                      <NativeSelectOption value="" disabled>
                        No session state recorded
                      </NativeSelectOption>
                    ) : null}
                    {stateOptions.map((state) => (
                      <NativeSelectOption key={state} value={state}>
                        {isPersonaSessionState(state) ? statusBadgeProps(PERSONA_SESSION_STATE_LABELS, state).label : state}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </>
              ) : null}
              <div id={sessionOutcomeId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {activeStateSpec === undefined ? (
                  <span className="min-w-0 text-pretty wrap-anywhere">
                    {activeState === "" ? (
                      "No session scenario is recorded for this session."
                    ) : (
                      <>
                        {"The session state "}
                        <bdi className="mono-identifier break-all">{activeState}</bdi>
                        {" is not one this control can label."}
                      </>
                    )}
                  </span>
                ) : (
                  <>
                    <StatusBadge {...activeStateSpec.label} srPrefix="Session scenario" />
                    <span className="min-w-0 text-pretty wrap-anywhere">{activeStateSpec.outcome}</span>
                  </>
                )}
              </div>
              {canSwitchState ? <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{SESSION_SCENARIO_NOTICE}</p> : null}
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
}
export default PersonaSwitcher;
