"use client";

/**
 * The one guard for a deliberate context change, and the one fence that makes it safe.
 *
 * A context change — another organisation, another ministry, another support subject — is the one
 * navigation in this application that can silently replace every record on screen. Three things
 * follow from that, and this file is where each of them has exactly one implementation.
 *
 * (a) The decision offers three honest choices and no fourth: **Stay here**, which is first in
 *     reading order and therefore the control the dialog focuses and the one Escape performs;
 *     **Discard and switch**, which names what is lost and is destructive-toned but never the
 *     default; and **Save and switch**, which appears only where the surface actually has a save
 *     path. There is deliberately no "switch later" queue, no background save, no remembered
 *     decision and no timer: a switch either happens now, after a save, or not at all.
 *
 * (b) The switch is fenced before it is requested. `useContextFence` cancels every in-flight read,
 *     then clears the query cache, and only then dispatches the `selectContext` mutation — in that
 *     order, so no envelope from the previous context can land after the new one becomes current.
 *     Clearing the cache happens here and nowhere else in the application: one fence, one place to
 *     audit. A component that drops a late envelope compares its scope with {@link isStale} rather
 *     than guessing from a response's shape.
 *
 * (c) Nothing is optimistic. The scope the shell displays changes only when the service answers,
 *     so a refusal, a conflict or an outage leaves the current context exactly as it was and is
 *     reported in the words the outcome itself supports. An outcome the service could not confirm
 *     is presented as uncertainty with its `operationId`, never as a success and never as a reason
 *     to repeat the attempt under a new identity.
 *
 * What this file does **not** own. It stores no record and no envelope: the records live in the
 * synthetic store behind the service, the selected context lives in the session's `.meta.json`
 * through `selectContext`, and the envelopes live in the TanStack Query cache that this file
 * empties. Its own state is the busy flag of the action it is running and the notice describing the
 * last result. No TanStack DB or TanStack Store package exists in this application, and nothing
 * here introduces one.
 *
 * Keys. {@link scopeKey} is the leading segment of every query key in the application, and
 * {@link queryKey} appends the job and its parameters, so one shape — `["scope", organizationId,
 * ministryId, supportSubjectId, job, params]` — keys every read. A feature with its own key shape
 * cannot be invalidated by the fence and is a defect.
 *
 * Accessibility. The dialog is a design-system `AlertDialog`: named by its title, described by a
 * description that includes the unsaved-work sentence, modal, focus-contained, and focus returns to
 * the control that started the switch. The three actions are distinguishable by their text, are at
 * least 24x24 CSS px, and follow the reading order in the DOM (Stay, then Discard, then Save). The
 * result is announced once through a polite status region — an accepted switch closes the dialog, so
 * the caller's own live region announces it from {@link ContextSwitchResult.announcement}, while a
 * refusal or an undetermined outcome is announced by the notice rendered in place here. Every opaque
 * value (a refusal code, a source name, an operation id, the caller's own context words) renders
 * inside `<bdi>` with the monospace identifier utility, so a mixed-direction neighbour cannot
 * reorder a leading zero or a code, and no raw identifier is ever shown in place of a name.
 *
 * Layering: this file sits in the shared component layer, above the design system and the two
 * contract modules and below every feature. It imports no feature, no store and no service; the
 * `selectContext` dispatcher is supplied by the caller (the shell), which keeps the transport in one
 * place and lets this file hold the ordering contract without owning a second call path.
 */

import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import {
  sameScope,
  type MinistryId,
  type MutationInput,
  type OrganizationId,
  type Scope,
  type SupportSubjectId,
} from "@/modules/data-service/envelope";
import {
  unknown as unknownOutcome,
  type JsonValue,
  type MutationOutcome,
} from "@/modules/data-service/outcome";

/** The literal leading segment of every query key: the scope a read ran under. */
export const SCOPE_KEY_ROOT = "scope";

/**
 * The leading three segments every cache key in this application starts with, beside the literal
 * root: the organisation, the ministry and the support subject.
 *
 * The principal is deliberately absent. It comes from the session and cannot change without a new
 * session, so a key that carried it would suggest a scope a validator could switch identities in.
 */
export type ScopeKey = readonly [
  typeof SCOPE_KEY_ROOT,
  OrganizationId,
  MinistryId,
  SupportSubjectId,
];

/** The plain JSON values a query's parameters may hold, so a key stays comparable and cacheable. */
export type QueryParams = Readonly<Record<string, JsonValue>>;

/** A complete key: the scope, the job it belongs to, and that job's parameters. */
export type ScopedQueryKey = readonly [...ScopeKey, string, QueryParams];

/**
 * The scope segments of a query key, in the order every consumer uses.
 *
 * Exported and used by every caller instead of each writing its own array, because a key that
 * started somewhere else could not be cancelled or cleared by the fence before a switch.
 */
export function scopeKey(scope: Scope): ScopeKey {
  return [SCOPE_KEY_ROOT, scope.organizationId, scope.ministryId, scope.supportSubjectId];
}

/**
 * A complete query key for one job in one context.
 *
 * `params` carries everything the request varies by — filters, sort, page, period — so two reads
 * with different parameters are two cache entries and neither can answer the other.
 */
export function queryKey(scope: Scope, job: string, params: QueryParams = {}): ScopedQueryKey {
  return [...scopeKey(scope), job, params];
}

/**
 * Whether a response that started in `scopeAtRequestTime` has been overtaken by `currentScope`.
 *
 * A feature that receives an envelope after a context switch asks this before rendering it. The read
 * was authorised in its own scope, so the answer is not an error: it is simply no longer about the
 * context on screen, and dropping it is what keeps the previous context's records from reappearing
 * after the switch. Cancellation covers the common case; this predicate covers a component that
 * ignored it.
 */
export function isStale(scopeAtRequestTime: Scope, currentScope: Scope): boolean {
  return !sameScope(scopeAtRequestTime, currentScope);
}

/**
 * Mints the identity of one switch attempt, as the canonical lowercase UUID v4 the mutation input
 * schema requires.
 *
 * `crypto.randomUUID()` produces exactly that form in the browser, in the Node runtime and in
 * Vitest, and reading the Web Crypto global keeps a Node-only module out of the client bundle. The
 * value is random and caller-generated on purpose: a replay of the same id is answered with the
 * stored result, so an attempt made through this hook can be recovered by identity rather than
 * repeated.
 */
function mintOperationId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * How a settled attempt reads to a person: what happened, in which direction, and — where a machine
 * value is part of the answer — the label and value to render beside the sentence.
 *
 * `tone` is emphasis only. Every sentence states the fact in words, so a reader who cannot see the
 * tint still learns whether the context changed.
 */
export type SwitchTone = "switched" | "refused" | "uncertain";

/** One machine value a summary names, rendered isolated from the surrounding text direction. */
export interface OutcomeDetail {
  /** What the value is, in the reader's language: "refusal code", "operation", "source". */
  readonly label: string;
  /** The value itself: a closed code, an opaque identifier or a source name. */
  readonly value: string;
}

/** The result of one attempt, as a sentence plus the machine values that belong to it. */
export interface OutcomeSummary {
  readonly tone: SwitchTone;
  readonly sentence: string;
  readonly detail?: OutcomeDetail;
}

/** The sentence for a conflict, which is the one outcome whose cause the caller can act on. */
const CONFLICT_SENTENCE =
  "The context changed while you were deciding, so nothing was switched. Check the current context before choosing again.";

/**
 * Says what a mutation outcome means for a context switch, exactly once.
 *
 * The eight outcomes are separate facts and stay separate here: an applied switch is not a replay,
 * a replay is not "nothing changed", a refusal is not an outage, and an outage is never presented as
 * a failure of the person's decision. The function is exhaustive over {@link MutationOutcome} with
 * no default branch, so a ninth outcome cannot be added without a sentence being written for it.
 */
export function summariseOutcome(outcome: MutationOutcome): OutcomeSummary {
  switch (outcome.outcome) {
    case "accepted":
      return {
        tone: "switched",
        sentence: "The switch was accepted. The context you selected is loading.",
      };
    case "alreadyAccepted":
      return {
        tone: "switched",
        sentence: "This switch had already been accepted, so nothing was repeated.",
      };
    case "unchanged":
      return {
        tone: "switched",
        sentence: "The context already matched your selection, so nothing changed.",
      };
    case "conflict":
      return {
        tone: "refused",
        sentence: CONFLICT_SENTENCE,
        detail: { label: "conflict", value: outcome.reason },
      };
    case "denied":
      return {
        tone: "refused",
        sentence: "The switch was refused, so you are still in your current context.",
        detail: { label: "refusal code", value: outcome.reasonCode },
      };
    case "invalid": {
      const fields = Object.keys(outcome.fields);
      return {
        tone: "refused",
        sentence: "The switch request was not valid, so nothing changed.",
        ...(fields.length === 0 ? {} : { detail: { label: "fields", value: fields.join(", ") } }),
      };
    }
    case "unavailable":
      return {
        tone: "refused",
        sentence: `The source behind the switch could not complete it, so you are still in your current context. ${outcome.guidance}`,
        detail: { label: "source", value: outcome.source.system },
      };
    case "unknown":
      return {
        tone: "uncertain",
        sentence:
          "The switch may or may not have been applied. Check the result before trying again.",
        detail: { label: "operation", value: outcome.operationId },
      };
  }
}

/**
 * The plain-text form of a summary, for a caller's single live region.
 *
 * A live region announces text, not markup, so the machine value is joined into the sentence with
 * its label rather than isolated: the reader still learns which code, source or attempt the sentence
 * refers to, and the visually rendered notice keeps `<bdi>` isolation for it.
 */
function announcementFor(summary: OutcomeSummary): string {
  if (summary.detail === undefined) {
    return summary.sentence;
  }
  return `${summary.sentence} ${summary.detail.label}: ${summary.detail.value}.`;
}

// ---------------------------------------------------------------------------------------------
// The fence
// ---------------------------------------------------------------------------------------------

/**
 * The context a switch asks for: everything a scope names except the acting principal.
 *
 * The principal is the session's, never a choice a surface offers, so it is absent from the payload
 * by construction rather than by discipline — a request cannot name another person as the one acting.
 */
export type ContextSelection = Omit<Scope, "principalId">;

/**
 * The `selectContext` mutation, supplied by the caller.
 *
 * It is passed in rather than imported so the shell keeps the one transport it already has, and so
 * this file can hold the ordering contract without reaching into the service layer. The shell passes
 * the shared mutation's `mutateAsync`, or a one-line arrow around it.
 */
export type SelectContextDispatch = (
  input: MutationInput<ContextSelection>,
) => Promise<MutationOutcome>;

/** What a caller asks the fence to do. */
export interface ContextSwitchRequest {
  /** The context to move to. Its identifiers are opaque; nothing here reads meaning into them. */
  readonly pendingScope: Scope;
  /**
   * The revision of the context record the caller saw, presented as `expectedRevision`. A mismatch
   * is a conflict that preserves the person's decision for comparison instead of overwriting it.
   */
  readonly expectedRevision: string;
  /**
   * The attempt's identity, when the caller is recovering an earlier attempt: replaying the same id
   * returns the stored result instead of switching twice. Omitted, one is minted for this attempt.
   */
  readonly operationId?: string;
}

/** What one attempt settled as. */
export interface ContextSwitchResult {
  /** The context that was asked for. */
  readonly requestedScope: Scope;
  /** The attempt's identity: the recovery handle for an undetermined outcome. */
  readonly operationId: string;
  /** Whether the context changed — true only for `accepted`, `alreadyAccepted` and `unchanged`. */
  readonly switched: boolean;
  /** The outcome the service returned, unmodified. */
  readonly outcome: MutationOutcome;
  /** The same outcome as a sentence and its machine values. */
  readonly summary: OutcomeSummary;
  /** The summary as plain text, for the caller's single live region. */
  readonly announcement: string;
}

/** What {@link useContextFence} needs from the shell. */
export interface ContextFenceOptions {
  /** The context the shell currently displays: what the switch is made *from*. */
  readonly scope: Scope;
  /** The service's `selectContext` mutation. */
  readonly selectContext: SelectContextDispatch;
}

/** What {@link useContextFence} returns. */
export interface ContextFence {
  /**
   * Performs the switch: cancel in-flight reads, clear the cache, then dispatch — in that order.
   *
   * A second call while an attempt is running returns that same attempt's result rather than
   * starting a second one, so a double press is one switch. The promise never rejects for a service
   * outcome; a thrown fault arrives as an `unknown` outcome carrying the attempt's id.
   *
   * A refusal or a conflict is returned rather than retried or forced: the caller reopens the guard
   * with the context it now sees, or renders the outcome, and nothing about the switch is decided
   * here on the person's behalf.
   */
  readonly switchContext: (request: ContextSwitchRequest) => Promise<ContextSwitchResult>;
  /** Whether an attempt is running, for the guard's busy state and any progress line. */
  readonly isSwitching: boolean;
  /** The most recent result, for the caller to render or announce. */
  readonly lastResult: ContextSwitchResult | null;
  /**
   * Whether a response that started in `scopeAtRequestTime` is now about a context that is no
   * longer current. Read at call time, so a handler captured before the switch gets the current
   * answer.
   */
  readonly isStale: (scopeAtRequestTime: Scope) => boolean;
}

/**
 * The context switch, performed once and safely against the one query cache.
 *
 * The order is the contract and is not rearrangeable. Cancelling first stops reads already in flight
 * from resolving into a cache that is about to be emptied; clearing second removes every envelope
 * the previous context produced, so a component that re-renders during the switch has nothing stale
 * to read; the fence is then moved to the context being moved to, so a response that arrives anyway
 * is recognised as stale by {@link isStale}; and only then is the mutation dispatched.
 *
 * Nothing here is optimistic. The displayed context changes when the caller re-reads under the scope
 * the service accepted, so a refusal, a conflict or an outage leaves the screen exactly as it was.
 */
export function useContextFence({ scope, selectContext }: ContextFenceOptions): ContextFence {
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);
  const [lastResult, setLastResult] = useState<ContextSwitchResult | null>(null);

  // The context a response must carry to still be current. During an attempt it names the context
  // being moved to, so an envelope from the old one is stale even before the shell re-renders.
  const fenceRef = useRef<Scope>(scope);
  const switchingRef = useRef(false);
  const attemptRef = useRef<Promise<ContextSwitchResult> | null>(null);

  /*
   * Adopts the context the caller now displays. Skipped while an attempt is running, because the
   * fence then names the context being moved to — adopting the old one mid-flight would let a
   * response the switch has already overtaken pass as current.
   */
  useEffect(() => {
    if (!switchingRef.current) {
      fenceRef.current = scope;
    }
  }, [scope]);

  const isStaleFor = useCallback(
    (scopeAtRequestTime: Scope): boolean => isStale(scopeAtRequestTime, fenceRef.current),
    [],
  );

  const performSwitch = useCallback(
    async (request: ContextSwitchRequest): Promise<ContextSwitchResult> => {
      const operationId = request.operationId ?? mintOperationId();

      switchingRef.current = true;
      setIsSwitching(true);
      setLastResult(null);

      try {
        // 1. Nothing in flight from here on: a read that resolves later would be about the context
        //    being left, and this is where it is stopped rather than filtered out afterwards.
        await queryClient.cancelQueries();
        // 2. Every envelope the previous context produced leaves the cache. This is the only clear
        //    in the application.
        queryClient.clear();
        // 3. The fence moves before the request leaves, so a straggler is already stale.
        fenceRef.current = request.pendingScope;

        const outcome = await selectContext({
          operationId,
          // The authority the caller holds now: the context it is switching away from. The payload
          // names where it wants to go, and the service admits that selection too.
          scope,
          expectedRevision: request.expectedRevision,
          payload: {
            organizationId: request.pendingScope.organizationId,
            ministryId: request.pendingScope.ministryId,
            supportSubjectId: request.pendingScope.supportSubjectId,
          },
        });

        const switched =
          outcome.outcome === "accepted" ||
          outcome.outcome === "alreadyAccepted" ||
          outcome.outcome === "unchanged";
        if (!switched) {
          // The context did not change, so the one on screen is current again and its responses are
          // not stale.
          fenceRef.current = scope;
        }

        const summary = summariseOutcome(outcome);
        const result: ContextSwitchResult = {
          requestedScope: request.pendingScope,
          operationId,
          switched,
          outcome,
          summary,
          announcement: announcementFor(summary),
        };
        setLastResult(result);
        return result;
      } catch {
        // A fault past the service — a broken transport, a defect — leaves the change's fate
        // unknown. That is a reported result, not a success and not a reason to send it again under
        // a fresh identity; the attempt's id is what recovers it. The displayed context stands, so
        // the fence names it and the caller's recovery check can still be read.
        fenceRef.current = scope;
        const outcome = unknownOutcome({ operationId });
        const summary = summariseOutcome(outcome);
        const result: ContextSwitchResult = {
          requestedScope: request.pendingScope,
          operationId,
          switched: false,
          outcome,
          summary,
          announcement: announcementFor(summary),
        };
        setLastResult(result);
        return result;
      } finally {
        switchingRef.current = false;
        setIsSwitching(false);
      }
    },
    [queryClient, scope, selectContext],
  );

  const switchContext = useCallback(
    async (request: ContextSwitchRequest): Promise<ContextSwitchResult> => {
      const running = attemptRef.current;
      if (running !== null) {
        // One attempt at a time: a second press asks for the same switch, so it is answered with
        // the attempt already running rather than with a second effect.
        return running;
      }
      const attempt = performSwitch(request);
      attemptRef.current = attempt;
      try {
        return await attempt;
      } finally {
        attemptRef.current = null;
      }
    },
    [performSwitch],
  );

  return { switchContext, isSwitching, lastResult, isStale: isStaleFor };
}

// ---------------------------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------------------------

/** The two actions that move the context, which the dialog can be shown to be running. */
type GuardAction = "discard" | "save";

/** Props of {@link ContextSwitchGuard}. */
export interface ContextSwitchGuardProps {
  /** Whether the dialog is shown. The caller owns this, so a switch is never performed invisibly. */
  readonly open: boolean;

  /**
   * The context the person asked for, or `null` when there is nothing pending. A null scope renders
   * no dialog at all, so a closed guard cannot show a stale decision.
   */
  readonly pendingScope: Scope | null;

  /**
   * What is at stake, in the caller's own words: "an unsaved Update draft in Français", "your edits
   * to this contact". Its presence is what makes the discard honest — the dialog names what the
   * destructive action loses — and it decides whether the warning icon appears, so the frame states
   * the same thing the sentence does.
   */
  readonly unsavedWork?: { readonly description: string };

  /** The person chose to stay. Escape and a backdrop press mean the same thing. */
  readonly onStay: () => void;

  /**
   * The person chose to discard and switch. The caller performs the switch — normally by calling
   * the fence — and closes the dialog when it settles. A rejection leaves the dialog open with a
   * statement that the result is not known.
   */
  readonly onDiscard: () => Promise<void>;

  /**
   * The save path this surface has, if it has one. Omitted, the dialog offers two actions and never
   * implies a save that cannot happen; supplied, Save and switch runs it first and the caller
   * switches only if it settles as applied.
   */
  readonly onSaveAndSwitch?: () => Promise<void>;

  /** Whether the caller's switch is running, so the actions wait for it instead of racing it. */
  readonly busy?: boolean;

  /** Layout classes for the panel. Never a colour, a radius or a shadow. */
  readonly className?: string;

  /**
   * The words the shell uses for the context being switched to — "Ministry B", "Northside
   * Ministry". Names, never identifiers: an opaque id here would be unreadable and could be
   * mistaken for a name. Omitted, the dialog says "the context you selected" and names nothing.
   */
  readonly pendingScopeLabel?: string;

  /**
   * The outcome of the last attempt, so a refusal, a conflict or an undetermined result is
   * explained where the decision is being made rather than only after the dialog closes.
   */
  readonly outcome?: MutationOutcome | null;
}

/** What the dialog says when the caller's discard handler threw rather than settling. */
const DISCARD_FAILED =
  "The switch did not complete and its result is not known. Nothing here has been discarded; check the current context before trying again.";

/** What the dialog says when the caller's save handler threw rather than settling. */
const SAVE_FAILED =
  "The save did not report a result, so the switch did not happen. Nothing here has been discarded; check whether the save is in place before trying again.";

/** How an opaque value renders: isolated from the surrounding direction, in the mono utility. */
const IDENTIFIER_CLASS = "mono-identifier break-all";

/**
 * The Save / Discard / Stay guard for a context change.
 *
 * It composes the design system's alert dialog rather than inventing a modal, and it holds no record
 * state: the caller owns whether the dialog is open and which context is pending, and the fence owns
 * the switch. What it does own is the shape of the decision — the three actions, their order, which
 * one the dialog focuses, what the description says is at stake — because a second hand-written
 * confirmation for the same switch is exactly the drift the project rule forbids.
 */
export function ContextSwitchGuard({
  open,
  pendingScope,
  unsavedWork,
  onStay,
  onDiscard,
  onSaveAndSwitch,
  busy = false,
  className,
  pendingScopeLabel,
  outcome = null,
}: ContextSwitchGuardProps): ReactElement {
  const [pendingAction, setPendingAction] = useState<GuardAction | null>(null);
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  // Read synchronously, so two presses in one frame cannot start two actions.
  const pendingRef = useRef<GuardAction | null>(null);
  const stayRef = useRef<HTMLButtonElement | null>(null);

  const busyNow = busy || pendingAction !== null;

  const handleOpenChange = useCallback(
    (nextOpen: boolean, details: { readonly cancel: () => void }): void => {
      if (nextOpen) {
        return;
      }
      // Every dismissal the dialog performs itself — Escape, a press outside the panel — is refused
      // while a switch is running: the request has left and its outcome has to be reported rather
      // than the dialog vanishing over it. Stay here is not one of those dismissals but the guard's
      // own action, so a deliberate press is always honoured and the attempt keeps running on its
      // own.
      if (busyNow) {
        details.cancel();
        return;
      }
      onStay();
    },
    [busyNow, onStay],
  );

  const runAction = useCallback(
    (action: GuardAction): void => {
      if (busy || pendingRef.current !== null) {
        return;
      }
      if (action === "save" && onSaveAndSwitch === undefined) {
        return;
      }
      pendingRef.current = action;
      setPendingAction(action);
      setActionFailure(null);
      /*
       * The pressed action becomes disabled while it runs, which would drop focus to the document
       * body and leave a keyboard user outside the panel they are still working in. Moving focus to
       * Stay here — enabled throughout — keeps it inside the dialog and on a control that still
       * does something.
       */
      stayRef.current?.focus();
      void (async () => {
        try {
          if (action === "save" && onSaveAndSwitch !== undefined) {
            await onSaveAndSwitch();
          } else {
            await onDiscard();
          }
        } catch {
          // A thrown handler is a defect or a broken transport, and either way the honest answer is
          // that the result is not known — never that the draft was discarded or the save landed.
          setActionFailure(action === "save" ? SAVE_FAILED : DISCARD_FAILED);
        } finally {
          pendingRef.current = null;
          setPendingAction(null);
        }
      })();
    },
    [busy, onDiscard, onSaveAndSwitch],
  );

  const label = pendingScopeLabel?.trim() ?? "";

  // The notice states the last thing that happened, once: a thrown action first, because it is the
  // more recent fact, otherwise the outcome the caller passed in.
  const notice: OutcomeSummary | null =
    actionFailure !== null
      ? { tone: "refused", sentence: actionFailure }
      : outcome === null
        ? null
        : summariseOutcome(outcome);

  return (
    <AlertDialog open={open && pendingScope !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        className={cn(className)}
        // The panel states its own busy state, so a reader who asks what is happening is told once
        // by the progress line rather than by a changed label on each action.
        aria-busy={busyNow ? true : undefined}
        // Modality is a fact here — focus is trapped and the surface behind is hidden from
        // assistive technology — so it is declared rather than left for a reader to infer.
        aria-modal="true"
      >
        <AlertDialogHeader>
          {unsavedWork === undefined ? null : (
            <AlertDialogMedia>
              {/* Decorative: the sentence beside it states that something is unsaved. */}
              <TriangleAlertIcon aria-hidden="true" />
            </AlertDialogMedia>
          )}
          <AlertDialogTitle>Switch context?</AlertDialogTitle>
          {/*
            The description element is itself a paragraph, so both sentences are spans laid out as
            blocks: nesting a paragraph inside one is invalid markup and React reports it as a
            hydration error, while the two sentences still read as two lines.
          */}
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>
              {label === "" ? (
                "Switching to the context you selected."
              ) : (
                <>
                  Switching to <bdi>{label}</bdi>.
                </>
              )}
            </span>{" "}
            {unsavedWork === undefined ? (
              <span>
                What belongs to this context is cleared before the next one loads, so nothing from
                here can appear afterwards.
              </span>
            ) : (
              <span>
                <bdi>{unsavedWork.description}</bdi> would be lost if you switch now. Stay here to
                keep working on it.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {busyNow ? (
          // `<output>` is the element whose implicit role is `status`, so the progress line is a
          // polite live region without stating a role the markup already carries.
          <output className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {pendingAction === "save" ? "Saving your work before switching…" : "Switching context…"}
          </output>
        ) : null}

        {notice === null ? null : (
          // The notice's own frame is the design system's `Alert`, whose default role would be
          // `alert`; inside this `<output>` the surrounding element is the announcing region, so the
          // frame is rendered as a plain surface and the status is announced once, politely.
          <output className="block">
            <Alert
              // A refusal is emphasised; an undetermined result is not dressed as a failure, because
              // the effect may well have been applied. The sentence states which it is either way.
              variant={notice.tone === "refused" ? "destructive" : "default"}
              role={undefined}
            >
              <AlertDescription>
                {notice.sentence}
                {notice.detail === undefined ? null : (
                  <>
                    {" "}
                    {notice.detail.label}:{" "}
                    <bdi className={IDENTIFIER_CLASS}>{notice.detail.value}</bdi>
                  </>
                )}
              </AlertDescription>
            </Alert>
          </output>
        )}

        <AlertDialogFooter>
          {/*
            Stay is first in the DOM, which makes it the control the dialog focuses when it opens
            and the first one a Tab sequence reaches; it is never disabled, so the safe choice stays
            available even while a switch is running. It is the guard's own action rather than the
            dialog's close control, because the two dismissal paths are owned differently: a press
            here always means Stay, while Escape is refused while a switch is in flight.
          */}
          <AlertDialogAction
            ref={stayRef}
            variant="outline"
            onClick={() => {
              onStay();
            }}
          >
            Stay here
          </AlertDialogAction>
          <AlertDialogAction
            variant="destructive"
            disabled={busyNow}
            onClick={() => {
              runAction("discard");
            }}
          >
            Discard and switch
          </AlertDialogAction>
          {onSaveAndSwitch === undefined ? null : (
            <AlertDialogAction
              disabled={busyNow}
              onClick={() => {
                runAction("save");
              }}
            >
              Save and switch
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ContextSwitchGuard;
