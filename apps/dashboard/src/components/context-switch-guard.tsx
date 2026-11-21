"use client";
/**
 * The one guard for a deliberate context change, and the one fence that makes it safe.
 */
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { sameScope, type MinistryId, type MutationInput, type OrganizationId, type Scope, type SupportSubjectId } from "@/modules/data-service/envelope";
import { unknown as unknownOutcome, type JsonValue, type MutationOutcome } from "@/modules/data-service/outcome";
/** The literal leading segment of every query key: the scope a read ran under. */
export const SCOPE_KEY_ROOT = "scope";
/** The leading three segments every cache key in this application starts with, beside the literal root: the organisation, the ministry and the support subject. */
export type ScopeKey = readonly [typeof SCOPE_KEY_ROOT, OrganizationId, MinistryId, SupportSubjectId];
/** The plain JSON values a query's parameters may hold, so a key stays comparable and cacheable. */
export type QueryParams = Readonly<Record<string, JsonValue>>;
/** A complete key: the scope, the job it belongs to, and that job's parameters. */
export type ScopedQueryKey = readonly [...ScopeKey, string, QueryParams];
/** The scope segments of a query key, in the order every consumer uses. */
export function scopeKey(scope: Scope): ScopeKey {
  return [SCOPE_KEY_ROOT, scope.organizationId, scope.ministryId, scope.supportSubjectId];
}
/** A complete query key for one job in one context. */
export function queryKey(scope: Scope, job: string, params: QueryParams = {}): ScopedQueryKey {
  return [...scopeKey(scope), job, params];
}
/** Whether a response that started in `scopeAtRequestTime` has been overtaken by `currentScope`. */
export function isStale(scopeAtRequestTime: Scope, currentScope: Scope): boolean {
  return !sameScope(scopeAtRequestTime, currentScope);
}
function mintOperationId(): string {
  return globalThis.crypto.randomUUID();
}
/** How a settled attempt reads to a person: what happened, in which direction, and — where a machine value is part of the answer — the label and value to render beside the sentence. */
export type SwitchTone = "switched" | "refused" | "uncertain";
/** One machine value a summary names, rendered isolated from the surrounding text direction. */
export interface OutcomeDetail {
  readonly label: string;
  readonly value: string;
}
/** The result of one attempt, as a sentence plus the machine values that belong to it. */
export interface OutcomeSummary {
  readonly tone: SwitchTone;
  readonly sentence: string;
  readonly detail?: OutcomeDetail;
}
/** The words this dialog renders, supplied by the caller. */
export interface ContextSwitchGuardCopy {
  readonly title: string;
  readonly body: string;
  readonly saveLabel: string;
  readonly discardLabel: string;
  readonly stayLabel: string;
  readonly saveNote: string;
  readonly unsavedWorkNote: string;
  readonly conflictNote: string;
  readonly stayNote: string;
}
/** Says what a mutation outcome means for a context switch, exactly once. */
export function summariseOutcome(outcome: MutationOutcome, copy: ContextSwitchGuardCopy): OutcomeSummary {
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
        sentence: copy.conflictNote,
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
        sentence: "The switch may or may not have been applied. Check the result before trying again.",
        detail: { label: "operation", value: outcome.operationId },
      };
  }
}
function announcementFor(summary: OutcomeSummary): string {
  if (summary.detail === undefined) {
    return summary.sentence;
  }
  return `${summary.sentence} ${summary.detail.label}: ${summary.detail.value}.`;
}
// The fence
/** The context a switch asks for: everything a scope names except the acting principal. */
export type ContextSelection = Omit<Scope, "principalId">;
/** The `selectContext` mutation, supplied by the caller. */
export type SelectContextDispatch = (input: MutationInput<ContextSelection>) => Promise<MutationOutcome>;
/** What a caller asks the fence to do. */
export interface ContextSwitchRequest {
  readonly pendingScope: Scope;
  readonly expectedRevision: string;
  readonly operationId?: string;
}
/** What one attempt settled as. */
export interface ContextSwitchResult {
  readonly requestedScope: Scope;
  readonly operationId: string;
  readonly switched: boolean;
  readonly outcome: MutationOutcome;
  readonly summary: OutcomeSummary;
  readonly announcement: string;
}
/** What {@link useContextFence} needs from the shell. */
export interface ContextFenceOptions {
  readonly scope: Scope;
  readonly selectContext: SelectContextDispatch;
  readonly copy: ContextSwitchGuardCopy;
}
/** What {@link useContextFence} returns. */
export interface ContextFence {
  readonly switchContext: (request: ContextSwitchRequest) => Promise<ContextSwitchResult>;
  readonly isSwitching: boolean;
  readonly lastResult: ContextSwitchResult | null;
  readonly isStale: (scopeAtRequestTime: Scope) => boolean;
}
/** The context switch, performed once and safely against the one query cache. */
export function useContextFence({ scope, selectContext, copy }: ContextFenceOptions): ContextFence {
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);
  const [lastResult, setLastResult] = useState<ContextSwitchResult | null>(null);
  // The context a response must carry to still be current. During an attempt it names the context
  // being moved to, so an envelope from the old one is stale even before the shell re-renders.
  const fenceRef = useRef<Scope>(scope);
  const switchingRef = useRef(false);
  const attemptRef = useRef<Promise<ContextSwitchResult> | null>(null);
  useEffect(() => {
    if (!switchingRef.current) {
      fenceRef.current = scope;
    }
  }, [scope]);
  const isStaleFor = useCallback((scopeAtRequestTime: Scope): boolean => isStale(scopeAtRequestTime, fenceRef.current), []);
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
        const switched = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
        if (!switched) {
          // The context did not change, so the one on screen is current again and its responses are
          // not stale.
          fenceRef.current = scope;
        }
        const summary = summariseOutcome(outcome, copy);
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
        const summary = summariseOutcome(outcome, copy);
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
    [queryClient, scope, selectContext, copy],
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
// The guard
type GuardAction = "discard" | "save";
/** Props of {@link ContextSwitchGuard}. */
export interface ContextSwitchGuardProps {
  readonly copy: ContextSwitchGuardCopy;
  readonly open: boolean;
  readonly pendingScope: Scope | null;
  readonly unsavedWork?: { readonly description: string };
  readonly onStay: () => void;
  readonly onDiscard: () => Promise<void>;
  readonly onSaveAndSwitch?: () => Promise<void>;
  readonly busy?: boolean;
  readonly className?: string;
  readonly pendingScopeLabel?: string;
  readonly outcome?: MutationOutcome | null;
}
const DISCARD_FAILED = "The switch did not complete and its result is not known. Nothing here has been discarded; check the current context before trying again.";

const SAVE_FAILED = "The save did not report a result, so the switch did not happen. Nothing here has been discarded; check whether the save is in place before trying again.";

const IDENTIFIER_CLASS = "mono-identifier break-all";
/** The Save / Discard / Stay guard for a context change. */
export function ContextSwitchGuard({
  copy,
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
  // Names the save note so the save action can carry it as its accessible description.
  const saveNoteId = useId();
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
  const notice: OutcomeSummary | null = actionFailure !== null ? { tone: "refused", sentence: actionFailure } : outcome === null ? null : summariseOutcome(outcome, copy);
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
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          {/*
            The description element is itself a paragraph, so every line is a span laid out as a block:
            nesting a paragraph inside one is invalid markup and React reports it as a hydration
            error, while each sentence still reads as its own line.
          */}
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>{copy.body}</span>
            {label === "" ? null : (
              // The context being switched to, named by the caller from the membership it read and
              // isolated from the surrounding direction. A name only: the component adds no sentence
              // of its own around it.
              <span className="font-medium text-foreground">
                <bdi>{label}</bdi>
              </span>
            )}
            {unsavedWork === undefined ? null : (
              <>
                <span>
                  <bdi>{unsavedWork.description}</bdi>
                </span>
                <span>{copy.unsavedWorkNote}</span>
              </>
            )}
            <span>{copy.stayNote}</span>
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
                    {notice.detail.label}: <bdi className={IDENTIFIER_CLASS}>{notice.detail.value}</bdi>
                  </>
                )}
              </AlertDescription>
            </Alert>
          </output>
        )}
        {onSaveAndSwitch === undefined ? null : (
          // A button label cannot carry this explanation, so the note sits beside the actions it
          // belongs to and the save action names it as its accessible description.
          <span id={saveNoteId} className="block text-sm text-balance text-muted-foreground">
            {copy.saveNote}
          </span>
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
            confirmVariant="outline"
            onClick={() => {
              onStay();
            }}
          >
            {copy.stayLabel}
          </AlertDialogAction>
          <AlertDialogAction
            confirmVariant="destructive"
            disabled={busyNow}
            onClick={() => {
              runAction("discard");
            }}
          >
            {copy.discardLabel}
          </AlertDialogAction>
          {onSaveAndSwitch === undefined ? null : (
            <AlertDialogAction
              disabled={busyNow}
              aria-describedby={saveNoteId}
              onClick={() => {
                runAction("save");
              }}
            >
              {copy.saveLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export default ContextSwitchGuard;
