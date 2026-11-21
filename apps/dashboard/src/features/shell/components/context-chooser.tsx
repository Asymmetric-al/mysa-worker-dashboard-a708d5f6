"use client";
/**
 * The one organization-and-ministry chooser: a region the admission gate renders, and the same choice inside the
 * design system's dialog when the shell's context indicator opens it.
 *
 * In scope because the first-release shell resolves admission from a synthetic session and offers a chooser only
 * where several ministries are admitted (AAP 0.10.1 family 1; AAP 0.9.1 places it in the shell feature folder), because the active
 * context is chosen by an identity-bearing reference and never inferred from a name or an email address (AAP
 * 0.7.1), and because a denied switch leaves the previous context intact (AAP 0.12.1 criterion 19) on a surface
 * that completes at 320 CSS px, by keyboard, with 24x24 CSS px targets (criterion 20).
 *
 * The option list, the dispatch and the outcome mapping are written once and both presentations wrap them, so the
 * region and the dialog cannot drift. The cache fence — cancelling reads in flight and clearing the cache before a
 * switch — belongs to `@/components/context-switch-guard`, and no surface clears or cancels a query itself.
 */
import { useCallback, useId, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";

import ContextSwitchGuard, { summariseOutcome } from "@/components/context-switch-guard";
import { fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { useModalFocusContainment, type DismissReason } from "@/lib/ui-sdk";
import type { MutationOutcome, ReadEnvelope, Scope } from "@/modules/data-service";
// A type-only import of the read's own data shape. It names no value and reaches no store code, so nothing of the
// synthetic store or the development runtime enters the browser bundle.
import type { ContextChooserData } from "@/modules/data-service/reads/shell";

import { CHOOSER_COPY, CONTEXT_CHANGED, CONTEXT_SWITCH_COPY } from "../copy/context-switch";
import { useContextChooser, type ContextChooser as ChooserRead } from "../hooks/use-context-chooser";
import { useSelectContext, type SelectContextIntent } from "../hooks/use-select-context";
import type { SelectContextPayload } from "../schemas/select-context";

/** How the one chooser is presented: a page region, or the same choice inside the design system's dialog. */
export type ContextChooserPresentation = "inline" | "dialog";

export interface ContextChooserProps {
  /** The chooser envelope a Server Component already read, so the first paint lists the memberships without a second request. */
  readonly initial?: ReadEnvelope<ContextChooserData>;
  /** `inline` is a page region; `dialog` is the same option list inside the installed dialog. */
  readonly presentation: ContextChooserPresentation;
  /**
   * Whether this job should be read at all. A caller whose admission envelope reports a single admitted ministry
   * passes `false`, so a one-ministry worker triggers no request and this component renders nothing.
   */
  readonly enabled?: boolean;
  /** The dialog's open state. Omitted, the component controls it and renders its own trigger. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** The inline region's heading level, so the caller's page outline decides it. The dialog's title carries its own. */
  readonly headingLevel?: 1 | 2 | 3;
  readonly className?: string;
}

const OPTIONS_LEGEND = "Admitted memberships";
const OPTIONS_HINT = "Each option is one organization and ministry this session has been admitted to. The list is exactly those memberships: this chooser never searches, widens or re-orders them.";
// The payload field the group answers for: the refusal's messages are keyed by the fields a context selection
// sends, and the group is the one control that states all three of them.
const CHOICE_FIELD = "ministryId";
const CURRENT_TAG = "Current context";
const CURRENT_NOTE = "This is the context in force. Choose a different membership to switch.";
const SUBMIT_LABEL = "Use this context";
const SUBMITTING_LABEL = "Switching context…";
const TRIGGER_LABEL = "Change context";
const HELP_LABEL = "Open Help";
const HELP_HREF = "/help";
const FIELD_LABELS = { organizationId: "Organization", ministryId: "Ministry", supportSubjectId: "Support subject" } as const;
const LOADING_TITLE = "Reading the memberships this session admits";
const LOADING_DESCRIPTION = "The chooser lists nothing until those memberships have been read, so no option is offered here before then.";
const READ_DENIED_TITLE = "The memberships could not be read";
const READ_DENIED_DESCRIPTION = "The read was refused before it enumerated anything, so nothing here names a membership — not a count, not a label and not whether one exists.";
const READ_UNAVAILABLE_TITLE = "The membership list could not be read";
const READ_UNAVAILABLE_DESCRIPTION = "The source behind the list did not answer, so this is an outage rather than an empty list and rather than a refusal.";
const READ_UNKNOWN_TITLE = "The membership list did not answer in a form this workspace recognises";
const READ_UNKNOWN_DESCRIPTION = "Nothing is listed and nothing is assumed in its place, so no membership is offered until the read answers again.";
const NO_MEMBERSHIP_TITLE = "This session admits no organization and ministry";
const NO_MEMBERSHIP_DESCRIPTION = "There is nothing for this chooser to list, because the session holds no membership it may act in.";
const SWITCH_DENIED_TITLE = "The context was not changed";
const SWITCH_DENIED_DESCRIPTION = "You are still in the context the header states. This refusal says nothing about the membership it did not admit — not a count, not a label and not whether one exists.";
const SWITCH_UNAVAILABLE_TITLE = "The switch could not be completed";
const SWITCH_UNKNOWN_TITLE = "The switch result is not confirmed";
const SWITCH_INVALID_TITLE = "The switch request was not valid";
const SWITCH_INVALID_DESCRIPTION = "Nothing was changed. Correct the field this refusal names and submit again.";
const SWITCH_INVALID_UNNAMED = "The request was refused before anything changed, and it named no field to correct. Nothing was applied.";
const RETRY_READ_LABEL = "Read the memberships again";
const RETRY_SWITCH_LABEL = "Try the switch again";
const CHECK_RESULT_LABEL = "Check the result";
const CHECKING_ANNOUNCEMENT = "Checking the result of the earlier attempt. It reads what happened rather than starting a new change.";
const RETRYING_ANNOUNCEMENT = "Asking the source for this same switch again.";
const STAY_ANNOUNCEMENT = "Nothing was switched. You are still in the context the header states.";
const GUARD_SELECTOR = '[data-slot="alert-dialog-content"][data-open]';
const UNSAFE_ID_CHARACTERS = /[^A-Za-z0-9_-]+/g;

/** Where a heading may sit: a surrounding page decides the region's level, and this component stays one below it. */
type NoticeLevel = 2 | 3 | 4;

/** One admitted membership, as the envelope lists it and as the option answers for it. */
interface ChooserOption {
  /** The option's own value: the three references of one membership, never a display name. */
  readonly key: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly ministryId: string;
  readonly ministryName: string;
  readonly supportSubjectId: string;
  /** Whether the envelope marked this membership as the context in force. */
  readonly current: boolean;
  /** The whole label a reader sees and a screen reader hears: organization, then ministry. */
  readonly label: string;
}

/** The attempt whose result the surface is showing, kept so a recovery re-sends that same identity. */
interface Attempt {
  readonly intent: SelectContextIntent;
  readonly option: ChooserOption;
}

/** No membership was read, so there is no option to map over. */
const EMPTY_OPTIONS: readonly ChooserOption[] = [];

/** A name the source of record supplied, or its opaque reference where it supplied none. */
function nameOrReference(label: string, reference: string): string {
  const named = label.trim();
  // A blank label is a context the source named nothing for: the opaque reference is shown rather than a blank
  // presented as a name, and no name is ever derived here.
  return named === "" ? reference : named;
}

/** Every admitted membership, in exactly the order the envelope supplies it. */
function optionsOf(data: ContextChooserData): readonly ChooserOption[] {
  return data.groups.flatMap((group) =>
    group.ministries.map((ministry) => {
      const organizationName = nameOrReference(group.organizationLabel, group.organizationId);
      const ministryName = nameOrReference(ministry.ministryLabel, ministry.ministryId);
      return {
        key: `${group.organizationId}::${ministry.ministryId}::${ministry.supportSubjectId}`,
        organizationId: group.organizationId,
        organizationName,
        ministryId: ministry.ministryId,
        ministryName,
        supportSubjectId: ministry.supportSubjectId,
        current: ministry.selected,
        label: `${organizationName} — ${ministryName}`,
      };
    }),
  );
}

/**
 * The context an attempt moves to, as the scope the guard names: the intent's own target references and the
 * principal it acts for. It is taken from the attempt rather than from the envelope, so a read that answers again
 * while the guard is open cannot change the context the guard is asking about.
 */
function pendingScopeOf(intent: SelectContextIntent): Scope {
  return {
    organizationId: intent.payload.organizationId,
    ministryId: intent.payload.ministryId,
    supportSubjectId: intent.payload.supportSubjectId,
    // The service re-derives the principal from the session, so this is the claim the request presents, never the
    // identity it is granted. It is also why no name and no email address is ever part of the request.
    principalId: intent.scope.principalId,
  };
}

/** The heading level one below the surface's own, capped at the deepest heading a section may use. */
function levelBelow(level: 1 | 2 | 3): NoticeLevel {
  return level === 1 ? 2 : level === 2 ? 3 : 4;
}

/** The honest statement that this session has no membership to choose between. */
function NoMembershipNotice({ headingLevel }: { readonly headingLevel: NoticeLevel }): ReactElement {
  return <StateNotice kind="empty" title={NO_MEMBERSHIP_TITLE} description={NO_MEMBERSHIP_DESCRIPTION} action={{ label: HELP_LABEL, href: HELP_HREF }} headingLevel={headingLevel} />;
}

interface ReadNoticeProps {
  readonly read: ChooserRead;
  readonly headingLevel: NoticeLevel;
}

/** What the chooser shows instead of an option list: a busy region, a refusal, an outage, or a list it cannot state. */
function ReadNotice({ read, headingLevel }: ReadNoticeProps): ReactElement {
  switch (read.state) {
    case "loading":
      // Skeleton lines rather than an empty list, because "no memberships" and "not read yet" are different facts and
      // must not share a rendering.
      return <StateNotice kind="loading" title={LOADING_TITLE} description={LOADING_DESCRIPTION} headingLevel={headingLevel} loadingLines={3} />;
    case "denied":
      // The hook already reduced the refusal to its closed code, so this notice holds no count, label or
      // existence hint even in principle.
      return <StateNotice kind="denied" title={READ_DENIED_TITLE} description={READ_DENIED_DESCRIPTION} reasonCode={read.reason} headingLevel={headingLevel} />;
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          title={READ_UNAVAILABLE_TITLE}
          description={READ_UNAVAILABLE_DESCRIPTION}
          {...(read.source === null ? {} : { source: read.source })}
          retry={{ label: RETRY_READ_LABEL, onClick: read.retry }}
          headingLevel={headingLevel}
        />
      );
    case "unknown":
      return <StateNotice kind="unknown" title={READ_UNKNOWN_TITLE} description={READ_UNKNOWN_DESCRIPTION} retry={{ label: RETRY_READ_LABEL, onClick: read.retry }} headingLevel={headingLevel} />;
    case "ready":
      return <NoMembershipNotice headingLevel={headingLevel} />;
  }
}

interface ChoiceGroupProps {
  readonly options: readonly ChooserOption[];
  readonly value: string;
  readonly errors: FieldErrorLookup | null;
  readonly idPrefix: string;
  readonly onChoose: (key: string) => void;
}

/** The one option list: a labelled radio group, so a keyboard or screen-reader reader meets one tab stop and arrow keys. */
function ChoiceGroup({ options, value, errors, idPrefix, onChoose }: ChoiceGroupProps): ReactElement {
  // Every field a context selection sends describes this one control, so its refusal messages are stated once here,
  // beside the group whose value they are about.
  const choiceErrors = errors === null ? [] : [...(errors.byField.organizationId ?? []), ...(errors.byField.ministryId ?? []), ...(errors.byField.supportSubjectId ?? []), ...errors.form];
  return (
    <FormFieldGroup legend={OPTIONS_LEGEND} name={CHOICE_FIELD} description={OPTIONS_HINT} {...(choiceErrors.length === 0 ? {} : { error: choiceErrors })} required>
      {(group) => (
        <RadioGroup value={value} onValueChange={onChoose} aria-describedby={group.describedBy} aria-invalid={group.invalid ? true : undefined} aria-required={group.required ? true : undefined}>
          {options.map((option, index) => {
            const optionId = `${idPrefix}-option-${String(index)}`;
            const descriptionId = `${optionId}-description`;
            return (
              // The label wraps the control, so the whole row is the pointer target and the row's own text is the
              // name the radio answers to; `aria-label` states the same name for the roving group's announcements.
              <label key={option.key} htmlFor={optionId} className={cn("flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40 motion-safe:transition-colors", option.current && "border-primary/40")}>
                <RadioGroupItem id={optionId} value={option.key} aria-label={option.label} aria-describedby={descriptionId} className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium break-words">
                    {/* Each name is isolated: an organization or ministry name arrives in its own script and direction, and must not reorder the sentence around it. */}
                    <bdi>{option.organizationName}</bdi>
                    <span aria-hidden="true">{" — "}</span>
                    <bdi>{option.ministryName}</bdi>
                  </span>
                  <span id={descriptionId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {/* The opaque reference distinguishes two memberships whose names read alike, and it is shown, never compared or parsed. */}
                    <bdi className="mono-identifier break-all">{option.ministryId}</bdi>
                    {option.current ? <span>{CURRENT_TAG}</span> : null}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
      )}
    </FormFieldGroup>
  );
}

interface ChoiceOutcomeProps {
  readonly settled: MutationOutcome | null;
  readonly headingLevel: NoticeLevel;
  readonly onCheckResult: () => void;
}

/** What the last attempt settled at, stated once and honestly: each refusal keeps its own meaning. */
function ChoiceOutcome({ settled, headingLevel, onCheckResult }: ChoiceOutcomeProps): ReactElement | null {
  if (settled === null) return null;
  switch (settled.outcome) {
    case "denied":
      return <StateNotice kind="denied" title={SWITCH_DENIED_TITLE} description={SWITCH_DENIED_DESCRIPTION} reasonCode={settled.reasonCode} headingLevel={headingLevel} />;
    case "unavailable":
      return <StateNotice kind="unavailable" title={SWITCH_UNAVAILABLE_TITLE} source={settled.source} description={settled.guidance} retry={{ label: RETRY_SWITCH_LABEL, onClick: onCheckResult }} headingLevel={headingLevel} />;
    case "unknown":
      // The recovery is a check of this attempt's own identity, never a second request under a fresh one: the retry
      // sends the same operation, so an applied switch answers with its stored result instead of being applied twice.
      return <StateNotice kind="unknown" title={SWITCH_UNKNOWN_TITLE} operationId={settled.operationId} retry={{ label: CHECK_RESULT_LABEL, onClick: onCheckResult }} headingLevel={headingLevel} />;
    case "invalid": {
      const errors = fieldErrorsFromInvalid(settled);
      if (errors.count === 0) {
        return (
          <p role="alert" className="text-sm text-destructive">
            {SWITCH_INVALID_UNNAMED}
          </p>
        );
      }
      return <FormErrorSummary errors={errors} labels={FIELD_LABELS} title={SWITCH_INVALID_TITLE} description={SWITCH_INVALID_DESCRIPTION} headingLevel={headingLevel} />;
    }
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
    case "conflict":
      // A change this surface did not make and cannot claim: the switch surface states the change, and the guard
      // states the conflict. Saying either here would be a second confirmation of one outcome.
      return null;
  }
}

/**
 * The one organization-and-ministry chooser: every admitted membership, the context in force marked, and one
 * deliberate action that asks the service to switch — as a page region or inside the shared dialog.
 */
export function ContextChooser({ initial, presentation, enabled, open, onOpenChange, headingLevel = 2, className }: ContextChooserProps): ReactElement | null {
  const generatedId = useId();
  const idPrefix = `context-chooser-${generatedId.replace(UNSAFE_ID_CHARACTERS, "")}`;
  const titleId = `${idPrefix}-title`;

  // A single admitted ministry opens directly, so a caller whose envelope already says so enables nothing: no
  // request is issued and nothing renders. Everything below is written so that answer costs no fetch.
  const chooserEnabled = enabled ?? (initial?.data.directEntry !== true);

  const read = useContextChooser(chooserEnabled, initial);
  const retryRead = read.retry;
  const { selectContext, isPending } = useSelectContext();

  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  // The dialog element is kept as state so focus containment binds the moment the dialog exists: the design system
  // mounts its popup a render after opening, so a plain ref would still be empty and the modal would lose its Tab
  // cycle.
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(null);
  const dialogRef = useMemo<RefObject<HTMLDivElement | null>>(() => ({ current: dialogElement }), [dialogElement]);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const dialogOpen = open ?? uncontrolledOpen;
  const setDialogOpen = useCallback(
    (next: boolean): void => {
      onOpenChange?.(next);
      if (open === undefined) setUncontrolledOpen(next);
    },
    [onOpenChange, open],
  );

  const dismiss = useCallback(
    (reason: DismissReason): void => {
      // A window blur is the reader leaving, not a dismissal. And while the conflict guard is open, its own Escape
      // resolves that modal: closing the surface beneath it would discard the decision it is asking for.
      if (reason === "window-blur") return;
      if (document.querySelector(GUARD_SELECTOR) !== null) return;
      setDialogOpen(false);
    },
    [setDialogOpen],
  );

  // One owner for the dialog's focus: it enters at the title, Tab and Shift+Tab wrap inside it, and it returns to the
  // control that opened it. Imported through the application's UI-SDK adapter, never from the primitive package.
  useModalFocusContainment({ open: dialogOpen && presentation === "dialog", dialogRef, initialFocusRef: titleRef, onDismiss: dismiss });

  const envelope = read.state === "ready" ? read.envelope : null;
  const options = useMemo<readonly ChooserOption[]>(() => (envelope === null ? EMPTY_OPTIONS : optionsOf(envelope.data)), [envelope]);
  const currentKey = useMemo<string | null>(() => options.find((option) => option.current)?.key ?? null, [options]);
  // The radio group opens on the context in force, so what is selected is what is in force until the reader chooses.
  const value = chosenKey ?? currentKey ?? "";
  const chosenOption = options.find((option) => option.key === value) ?? null;

  /** One intent for one membership: the context the caller acts in, the revision it saw, and where it wants to go. */
  const intentFor = useCallback(
    (option: ChooserOption, resolution?: SelectContextPayload["resolveUnsavedWork"]): SelectContextIntent | null => {
      if (envelope === null) return null;
      const payload: SelectContextPayload = {
        organizationId: option.organizationId as SelectContextPayload["organizationId"],
        ministryId: option.ministryId as SelectContextPayload["ministryId"],
        supportSubjectId: option.supportSubjectId as SelectContextPayload["supportSubjectId"],
        ...(resolution === undefined ? {} : { resolveUnsavedWork: resolution }),
      };
      return { scope: envelope.scope, expectedRevision: envelope.revision, payload };
    },
    [envelope],
  );

  const applyOutcome = useCallback(
    (outcome: MutationOutcome, intent: SelectContextIntent, option: ChooserOption): void => {
      switch (outcome.outcome) {
        case "accepted":
        case "alreadyAccepted":
        case "unchanged": {
          // Nothing optimistic happened anywhere: the hook refreshes the server render, and the context on screen
          // changes only when that render arrives. The chosen option is dropped so the next envelope decides what is
          // in force rather than this component remembering a guess.
          setSettled(null);
          setAttempt(null);
          setGuardOpen(false);
          setChosenKey(null);
          setDialogOpen(false);
          // Where a switch surface exists it announces the change, so this component says nothing there. The inline
          // region is the admission gate's own surface and has nobody else to announce it, so it states the change.
          setAnnouncement(presentation === "inline" ? `${CONTEXT_CHANGED.title}. ${CONTEXT_CHANGED.body}` : "");
          return;
        }
        case "conflict": {
          // The caller's input is preserved rather than overwritten: the shared guard shows the conflict beside the
          // membership that was asked for, and the memberships are re-read so the next choice is made against the
          // context as it stands now.
          setAttempt({ intent, option });
          setSettled(outcome);
          setGuardOpen(true);
          // One modal at a time: the guard traps its own focus and carries the target's name, so the chooser beneath
          // it closes instead of leaving two focus traps competing for Tab.
          setDialogOpen(false);
          setAnnouncement("");
          retryRead();
          return;
        }
        case "denied":
        case "invalid":
        case "unavailable":
        case "unknown":
          setAttempt({ intent, option });
          setSettled(outcome);
          setGuardOpen(false);
          setAnnouncement(summariseOutcome(outcome, CONTEXT_SWITCH_COPY).sentence);
      }
    },
    [presentation, retryRead, setDialogOpen],
  );

  const runAttempt = useCallback(
    (option: ChooserOption, resolution?: SelectContextPayload["resolveUnsavedWork"]): void => {
      const intent = intentFor(option, resolution);
      if (intent === null || isPending) return;
      setSettled(null);
      setGuardOpen(false);
      setAnnouncement(`Switching context to ${option.label}.`);
      void (async () => {
        applyOutcome(await selectContext(intent), intent, option);
      })();
    },
    [applyOutcome, intentFor, isPending, selectContext],
  );

  /**
   * The recovery a refusal or an uncertain result offers: the same attempt, sent again under its own identity. A
   * repeated intent is answered with the stored result when the change was applied, so this is a check of what
   * happened rather than a second effect.
   */
  const retryAttempt = useCallback((): void => {
    if (attempt === null || isPending) return;
    const { intent, option } = attempt;
    setSettled(null);
    setAnnouncement(settled !== null && settled.outcome === "unknown" ? CHECKING_ANNOUNCEMENT : RETRYING_ANNOUNCEMENT);
    void (async () => {
      applyOutcome(await selectContext(intent), intent, option);
    })();
  }, [applyOutcome, attempt, isPending, selectContext, settled]);

  /** The guard's own decision to switch anyway: one new attempt, against the memberships as they now stand. */
  const discardAndSwitch = useCallback(async (): Promise<void> => {
    if (attempt === null) return;
    const intent = intentFor(attempt.option, "discard");
    if (intent === null) return;
    setAnnouncement(`Switching context to ${attempt.option.label}.`);
    applyOutcome(await selectContext(intent), intent, attempt.option);
  }, [applyOutcome, attempt, intentFor, selectContext]);

  const stayOnContext = useCallback((): void => {
    setGuardOpen(false);
    setSettled(null);
    setAttempt(null);
    setAnnouncement(STAY_ANNOUNCEMENT);
  }, []);

  const choose = useCallback((key: string): void => {
    setChosenKey(key);
    // A refusal belonged to the previous choice, so it leaves with it rather than describing the new one.
    setSettled(null);
    setAnnouncement("");
  }, []);

  const submitChoice = useCallback((): void => {
    if (chosenOption === null || chosenOption.current) return;
    runAttempt(chosenOption);
  }, [chosenOption, runAttempt]);

  const canSubmit = chosenOption !== null && !chosenOption.current && !isPending;

  if (!chooserEnabled) return null;
  // One admitted ministry resolves directly, so there is nothing to choose and this component states nothing.
  if (envelope !== null && envelope.data.directEntry) return null;

  const childLevel = presentation === "dialog" ? 3 : levelBelow(headingLevel);
  const errors = settled !== null && settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null;
  const guardScope = attempt === null ? null : pendingScopeOf(attempt.intent);

  const body = (
    <div data-slot="context-chooser" data-presentation={presentation} className="flex min-w-0 flex-col gap-4">
      {envelope === null ? (
        <ReadNotice read={read} headingLevel={childLevel} />
      ) : options.length === 0 ? (
        <NoMembershipNotice headingLevel={childLevel} />
      ) : (
        <>
          <ChoiceGroup options={options} value={value} errors={errors} idPrefix={idPrefix} onChoose={choose} />
          <div className="flex min-w-0 flex-col gap-2">
            <Button type="button" onClick={submitChoice} disabled={!canSubmit} aria-busy={isPending ? true : undefined} className="h-auto min-h-9 w-full max-w-full py-2 whitespace-normal sm:w-auto">
              {isPending ? SUBMITTING_LABEL : SUBMIT_LABEL}
            </Button>
            {chosenOption !== null && chosenOption.current ? <p className="text-sm text-muted-foreground text-pretty">{CURRENT_NOTE}</p> : null}
          </div>
        </>
      )}
      <ChoiceOutcome settled={settled} headingLevel={childLevel} onCheckResult={retryAttempt} />
      {/* The surface's one announcement: text only, so nothing here depends on a colour or a shape to be understood. */}
      <output className="sr-only">{announcement}</output>
    </div>
  );

  const guard = (
    <ContextSwitchGuard
      copy={CONTEXT_SWITCH_COPY}
      open={guardOpen && guardScope !== null}
      pendingScope={guardScope}
      {...(attempt === null ? {} : { pendingScopeLabel: attempt.option.label })}
      outcome={settled !== null && settled.outcome === "conflict" ? settled : null}
      busy={isPending}
      onStay={stayOnContext}
      onDiscard={discardAndSwitch}
    />
  );

  if (presentation === "dialog") {
    return (
      <>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          {open === undefined ? (
            // A dialog the caller does not control carries its own trigger, so the surface is never a popup with no
            // accessible way to open it. A caller that controls the state owns the trigger itself.
            <DialogTrigger render={<Button type="button" variant="outline" className="h-auto max-w-full min-h-9 py-2 whitespace-normal" />}>{TRIGGER_LABEL}</DialogTrigger>
          ) : null}
          {/* Focus enters at the title and the Tab cycle is the containment hook's, so the dialog's own initial focus is
              turned off: one behaviour, one owner. */}
          <DialogContent ref={setDialogElement} initialFocus={false} className={cn("sm:max-w-lg", className)}>
            <DialogHeader>
              <DialogTitle ref={titleRef} tabIndex={-1} className="break-words">
                {CHOOSER_COPY.title}
              </DialogTitle>
              <DialogDescription>
                {CHOOSER_COPY.body} {CHOOSER_COPY.oneMinistryNote}
              </DialogDescription>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
        {guard}
      </>
    );
  }

  return (
    <>
      <section aria-labelledby={titleId} className={cn("min-w-0", className)}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id={titleId} className="text-base font-medium break-words">
                {CHOOSER_COPY.title}
              </h2>
            </CardTitle>
            <CardDescription>
              {CHOOSER_COPY.body}
              <span className="mt-1 block text-xs">{CHOOSER_COPY.oneMinistryNote}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      </section>
      {guard}
    </>
  );
}

export default ContextChooser;
