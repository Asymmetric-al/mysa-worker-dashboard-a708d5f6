"use client";

import { useId } from "react";

import StatusBadge, { statusBadgeProps, type StatusBadgeSpec } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { SESSION_STATES, type SessionState } from "@/modules/data-service/envelope";

/**
 * The one switch over the seeded preview personas and the session states.
 *
 * This is a **development control, not an authentication system** (AAP 0.1.3). It changes which
 * seeded principal the development session carries; it never proves who anybody is, never signs
 * anybody in and never grants a permission. Three consequences are built into the component rather
 * than left to its callers:
 *
 * - **A selection requests a change and grants nothing.** `onSelect` asks the development runtime to
 *   carry a different seeded identity, and every read that follows is authorised again by
 *   `modules/data-service/authorize.ts`. A persona that may not read a surface therefore receives the
 *   `denied` notice from `components/state-notice`. Nothing here computes "can see" flags, greys out a
 *   destination or drops a record to make a persona look permitted: hiding a destination instead of
 *   letting the service refuse it would be a second authorisation path in the interface and would
 *   destroy the evidence that the isolation exists (AAP 0.8.2 clause 3, criterion 19).
 * - **The active persona is always stated in text.** "Viewing as: …" is in the reading order on every
 *   render, including the unmatched cases, so a receiving preview can never be mistaken for a real
 *   session and a blank control can never be read as "no restriction".
 * - **It looks like what it is.** A compact, secondary development control that belongs beside
 *   `components/dev-banner` in the shell's development region — never in the production-looking
 *   account position, and never on a surface where it would read as an account switch, an
 *   impersonation feature or a sign-in. The notice it renders says in words that no sign-in occurs.
 *
 * Every persona it lists is a seeded identity with its own scope (AAP 0.1.2 persona roster): the
 * receiving readers that decide what a preview shows (public, approved supporter, unauthorized
 * reader, subscriber) and the worker-side identities (new worker, established worker, the second
 * worker in another ministry, deputized fundraiser, coach, content reviewer). The list comes from the
 * development runtime read; this file owns no list of its own and no state of it.
 *
 * It holds no state at all: the active persona and the active session state are server facts, passed
 * in as props, so a refused or stale change leaves the control showing what the session really
 * carries rather than what was clicked. It fetches nothing, reads no clock and formats no money. Every
 * class below is a token utility or a variant of an installed component — no colour, radius, shadow or
 * spacing literal appears here (AAP 0.4.3), and only logical utilities are used so a right-to-left
 * shell keeps the control in place.
 *
 * The session states it offers are the four admissions of the specification plus the no-access user
 * (AAP 0.10.1, 0.12.1 criterion 19): signed-in, unavailable, denied, expired and no-access. Choosing
 * one is a development scenario — it is not a sign-out and it does not clear the store — and each
 * state states its documented outcome here rather than relying on a colour.
 *
 * That vocabulary is the read envelope's single declaration of it, re-exported here under this
 * component's own name so the props below keep their type; this file keeps no copy of the closed set,
 * and the state the development runtime stores and the state this control labels are one list.
 * `activeSessionState` is nevertheless accepted as a plain `string` and resolved through
 * {@link isPersonaSessionState}, so a caller holding any raw value needs no cast and an unrecognised
 * value is displayed as itself instead of being silently replaced by a guessed label.
 */

/**
 * What a seeded identity is, for the purpose of grouping the switch. `reader` is a receiving persona
 * whose only surfaces are the previews; the worker-side kinds are the identities that own work.
 */
export type PersonaKind = "reader" | "worker" | "reviewer" | "coach";

/**
 * One seeded persona, as the development runtime read supplies it.
 *
 * `id` is the opaque identifier of the seeded principal — never a display name and never an email
 * address, because neither establishes identity (AAP 0.7.1). `description` is what the persona
 * demonstrates, shown for the active persona so the person operating the preview knows what the switch
 * is for; it is prose, not a label, and is rendered outside the live region.
 */
export interface PersonaOption {
  readonly id: string;
  readonly kind: PersonaKind;
  readonly label: string;
  readonly description: string;
}

/**
 * The closed set of session states the switch can demonstrate, in the order the specification lists
 * them: the four admissions and then the no-access user, whose only honest outcome is account-recovery
 * guidance.
 *
 * It is the envelope contract's own tuple, re-exported under this component's name rather than
 * restated here: the five members are declared once, beside the session context record that stores
 * them, so the states this control offers cannot fall behind the states a session can be in.
 */
export const PERSONA_SESSION_STATES = SESSION_STATES;

/** A member of {@link PERSONA_SESSION_STATES}: the envelope's own session state. */
export type PersonaSessionState = SessionState;

/**
 * The word and tone of each session state.
 *
 * The words distinguish facts a single "signed in / not signed in" flag would collapse: a session that
 * cannot be read is not a session that was refused, and a refusal is not an expiry. `signed-in` is
 * neutral rather than positive because a working session is the ordinary condition, not an outcome —
 * the positive and adverse tones belong to support and to adverse results, not to admission.
 */
export const PERSONA_SESSION_STATE_LABELS: Readonly<Record<PersonaSessionState, StatusBadgeSpec>> =
  {
    "signed-in": { label: "Signed in", tone: "neutral" },
    unavailable: { label: "Session unavailable", tone: "danger" },
    denied: { label: "Access denied", tone: "danger" },
    expired: { label: "Session expired", tone: "caution" },
    "no-access": { label: "No account access", tone: "caution" },
  };

/**
 * What each session state produces, stated beside the state so the scenario is legible without
 * running it (AAP 0.10.1 shell row, criterion 19).
 *
 * The `denied` sentence is deliberately about what is *not* revealed, not about which record failed:
 * a refusal must read identically whether or not anything exists behind it.
 */
export const PERSONA_SESSION_STATE_OUTCOMES: Readonly<Record<PersonaSessionState, string>> = {
  "signed-in": "The workspace renders for the selected persona.",
  unavailable:
    "The session cannot be read, so the surface offers its recovery path instead of any data.",
  denied:
    "The persona is refused, and no count, title, size or existence of a hidden record is revealed.",
  expired: "The session has expired, so the surface offers the recovery path and shows no data.",
  "no-access": "No admitted identity exists, so only account-recovery guidance is shown.",
};

/**
 * Whether a raw value is one of the five states this control can label.
 *
 * Exists because `activeSessionState` is a `string`: the development runtime and the admission read
 * hand over the value a session actually carries, and a value this control cannot label must never be
 * given a guessed one.
 */
export function isPersonaSessionState(value: string): value is PersonaSessionState {
  return Object.hasOwn(PERSONA_SESSION_STATE_LABELS, value);
}

/**
 * How each persona kind reads. The kind is context, not a status, so all four are quiet tones: the
 * receiving reader is `muted` to set it apart from the identities that own work, and the three
 * worker-side kinds are `neutral`. None of them borrows the positive, caution or danger tones, which
 * mean support arriving or an adverse outcome.
 */
export const PERSONA_KIND_LABELS: Readonly<Record<PersonaKind, StatusBadgeSpec>> = {
  reader: { label: "Receiving reader", tone: "muted" },
  worker: { label: "Worker", tone: "neutral" },
  reviewer: { label: "Reviewer", tone: "neutral" },
  coach: { label: "Coach", tone: "neutral" },
};

/**
 * The label of a kind, falling back to the raw value for a kind this control does not know.
 *
 * The union makes an unrecognised kind a compile error, but the read is dynamic data: printing the
 * value it actually carries keeps the persona listed and honest, where a guessed label — or an
 * exception thrown while the shell renders — would not.
 */
function kindLabel(kind: PersonaKind): StatusBadgeSpec {
  return Object.hasOwn(PERSONA_KIND_LABELS, kind)
    ? PERSONA_KIND_LABELS[kind]
    : { label: String(kind), tone: "muted" };
}

/**
 * The two documented groups, in the order the specification presents them: the receiving readers
 * whose persona decides what a preview shows, then the worker-side identities.
 *
 * `other` is not a third documented group. It collects a persona whose `kind` this control does not
 * know, so a seeded identity is never silently dropped from the switch — an identity missing from the
 * list would make the preview claim a session that cannot be reached.
 */
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

/**
 * Splits the supplied personas into the groups the select presents, keeping the order the development
 * runtime supplied inside each group. Written as a loop over a record of arrays so the result is
 * exhaustive: every group in {@link PERSONA_GROUP_ORDER} exists, and an empty group is what tells the
 * renderer to omit its `optgroup` rather than emit an empty one.
 */
function groupPersonas(
  personas: readonly PersonaOption[],
): Readonly<Record<PersonaGroup, readonly PersonaOption[]>> {
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

/**
 * That the control switches the development persona and that nothing is authenticated.
 *
 * The wording avoids "log in", "sign in as", "switch account" and "impersonate" on purpose: each would
 * describe a capability the application deliberately does not have, and each is exactly the reading
 * this sentence exists to prevent. It also states the consequence of a selection, so nobody has to
 * discover by experiment that a switch does not widen what a persona may read.
 */
const DEVELOPMENT_CONTROL_NOTICE =
  "Switches the development persona for this session only. No sign-in occurs, and a selection grants " +
  "nothing: every read is authorised again, so a persona that may not read a surface is refused.";

/**
 * That changing the session state is a development scenario.
 *
 * Two facts matter and both are easy to assume wrongly: it is not a sign-out, and it does not clear
 * the store — accepted edits survive the scenario the shell is showing (AAP 0.7.2).
 */
const SESSION_SCENARIO_NOTICE =
  "Development scenario only: it is not a sign-out, and it does not clear saved development data.";

/** Props of {@link PersonaSwitcher}. */
export interface PersonaSwitcherProps {
  /**
   * The seeded personas available in this session, from the development runtime read. Supplied rather
   * than owned: this file keeps no list of identities, so a persona added to the seed appears here
   * without a second place to maintain.
   */
  readonly personas: readonly PersonaOption[];
  /**
   * The persona the development session currently carries. Required, and possibly empty: an empty
   * value is rendered as "no persona is selected" rather than as a plausible-looking default.
   */
  readonly activePersonaId: string;
  /**
   * Asks the development runtime to carry the named persona. A request, not a grant: the service
   * re-authorises every read that follows, so the control stays controlled by `activePersonaId` and a
   * refused or stale change leaves it showing what the session really carries.
   */
  readonly onSelect: (personaId: string) => void;
  /**
   * The session states this surface offers to demonstrate. Omitted or empty, no switch is rendered and
   * the active state is shown read-only, because a surface should not offer an admission scenario it
   * does not need.
   */
  readonly sessionStates?: readonly PersonaSessionState[];
  /** The session state the development session currently carries, if the surface has one. */
  readonly activeSessionState?: string;
  /**
   * Asks the development runtime to apply the named session scenario. Given only where an admission
   * behaviour is being demonstrated; without it the state renders as a read-only statement.
   */
  readonly onSelectSessionState?: (state: string) => void;
  /**
   * The visible label of the control group, and its accessible group name. Defaults to
   * "Preview persona"; a receiving preview may name the persona it is switching.
   */
  readonly label?: string;
  /**
   * Placement classes from the shell's development region, using logical utilities only. It exists for
   * where the control sits — never to hide it or to restate a colour, radius or spacing the token layer
   * owns.
   */
  readonly className?: string;
}

/**
 * The single switch over the seeded preview personas and the session states.
 *
 * Both controls are native `select` elements inside the installed `NativeSelect`, so the whole control
 * is operable by keyboard, by a screen reader and by a single pointer with no custom listbox to
 * reimplement (WCAG 2.2 AA, AAP non-functional requirements). Each has its own visible `Label` bound by
 * `htmlFor`, each is at least 36 CSS px tall (2.5.8), and each stretches to its container so the
 * control never widens the page at 320 CSS px.
 *
 * The "Viewing as: …" sentence is the component's only live region. It states the active persona —
 * named, or "an unrecognised persona" with the opaque identifier it actually carries — and it is the
 * one place a change is announced, so nothing is announced twice. The session-state label is
 * deliberately *not* live: its change is already announced by the select itself, and a second region
 * would repeat it.
 *
 * Identifiers, words from another script and any raw value render inside `<bdi>`, with the monospace
 * identifier utility for the raw ones, so a mixed-direction neighbour cannot reorder them and a
 * leading zero survives; every space class is logical (`gap-*`, `text-start`, `mb-*`) so the control
 * keeps its place in a right-to-left shell.
 */
export function PersonaSwitcher({
  personas,
  activePersonaId,
  onSelect,
  sessionStates,
  activeSessionState,
  onSelectSessionState,
  label = "Preview persona",
  className,
}: PersonaSwitcherProps) {
  const personaSelectId = useId();
  const viewingAsId = useId();
  const sessionStateSelectId = useId();
  const sessionOutcomeId = useId();

  const activeId = activePersonaId.trim();
  const activePersona =
    activeId === "" ? undefined : personas.find((persona) => persona.id === activeId);
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
          <span className="min-w-0 text-muted-foreground text-pretty wrap-anywhere">
            {DEVELOPMENT_CONTROL_NOTICE}
          </span>
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
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
              {activePersona.description}
            </p>
          )}

          {personas.length === 0 ? (
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
              No seeded personas are available in this session, so there is nothing to switch here.
            </p>
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
                        {isPersonaSessionState(state)
                          ? statusBadgeProps(PERSONA_SESSION_STATE_LABELS, state).label
                          : state}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </>
              ) : null}

              <div
                id={sessionOutcomeId}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
              >
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
                    <span className="min-w-0 text-pretty wrap-anywhere">
                      {activeStateSpec.outcome}
                    </span>
                  </>
                )}
              </div>

              {canSwitchState ? (
                <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
                  {SESSION_SCENARIO_NOTICE}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
}

export default PersonaSwitcher;
