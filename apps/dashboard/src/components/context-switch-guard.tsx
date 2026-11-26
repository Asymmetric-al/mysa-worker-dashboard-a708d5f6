"use client";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { sameScope, type MinistryId, type MutationInput, type OrganizationId, type PrincipalId, type Scope, type SupportSubjectId } from "@/modules/data-service/envelope";
import { unknown as unknownOutcome, type JsonValue, type MutationOutcome } from "@/modules/data-service/outcome";
/** The literal leading segment of every query key: the scope a read ran under. */ export const SCOPE_KEY_ROOT = "scope";
/** The leading four segments every cache key in this application starts with, beside the literal root: the organisation, the ministry, the support subject and the principal, so a key states the whole authority the envelope states. */
export type ScopeKey = readonly [typeof SCOPE_KEY_ROOT, OrganizationId, MinistryId, SupportSubjectId, PrincipalId];
/** The plain JSON values a query's parameters may hold, so a key stays comparable and cacheable. */ export type QueryParams = Readonly<Record<string, JsonValue>>;
export type ScopedQueryKey = readonly [...ScopeKey, string, QueryParams];
/** The scope segments of a query key, in the order every consumer uses. */ export const scopeKey = (scope: Scope): ScopeKey => [SCOPE_KEY_ROOT, scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId];
/** A complete query key for one job in one context. */ export const queryKey = (scope: Scope, job: string, params: QueryParams = {}): ScopedQueryKey => [...scopeKey(scope), job, params];
/** Whether a response that started in `scopeAtRequestTime` has been overtaken by `currentScope`. */ export const isStale = (scopeAtRequestTime: Scope, currentScope: Scope): boolean => !sameScope(scopeAtRequestTime, currentScope);
const mintOperationId = (): string => globalThis.crypto.randomUUID();
export type SwitchTone = "switched" | "refused" | "uncertain";
export type OutcomeDetail = { readonly label: string; readonly value: string };
export type OutcomeSummary = { readonly tone: SwitchTone; readonly sentence: string; readonly detail?: OutcomeDetail };
export type ContextSwitchGuardCopy = { readonly title: string; readonly body: string; readonly saveLabel: string; readonly discardLabel: string; readonly stayLabel: string; readonly saveNote: string; readonly unsavedWorkNote: string; readonly conflictNote: string; readonly stayNote: string };
/** Summarizes a ministry switch result cleanly. */ export function summariseOutcome(outcome: MutationOutcome, copy: ContextSwitchGuardCopy): OutcomeSummary {
  switch (outcome.outcome) {
    case "accepted":
      return { tone: "switched", sentence: "Ministry switch accepted. Loading your selected ministry." };
    case "alreadyAccepted":
      return { tone: "switched", sentence: "This switch was already completed, so nothing was repeated." };
    case "unchanged":
      return { tone: "switched", sentence: "You’re already working in that ministry." };
    case "conflict":
      return { tone: "refused", sentence: copy.conflictNote, detail: { label: "conflict", value: outcome.reason } };
    case "denied":
      return { tone: "refused", sentence: "Couldn’t switch ministry, so you’re still in your current one.", detail: { label: "reason", value: outcome.reasonCode } };
    case "invalid": {
      const fields = Object.keys(outcome.fields);
      return { tone: "refused", sentence: "That ministry selection wasn’t valid, so nothing changed.", ...(fields.length === 0 ? {} : { detail: { label: "fields", value: fields.join(", ") } }) };
    }
    case "unavailable":
      return { tone: "refused", sentence: `Couldn’t reach the service to switch ministries, so you’re still in your current one. ${outcome.guidance}`, detail: { label: "source", value: outcome.source.system } };
    case "unknown":
      return { tone: "uncertain", sentence: "We couldn’t confirm whether the ministry switch completed. Check your active ministry before trying again.", detail: { label: "operation", value: outcome.operationId } };
  }
}
function announcementFor(summary: OutcomeSummary): string {
  if (summary.detail === undefined) return summary.sentence;
  return `${summary.sentence} ${summary.detail.label}: ${summary.detail.value}.`;
}
/** The worker's own answer to the guard's question: the unsaved work is saved through its owning surface, or it is discarded. Staying answers no switch and is sent as nothing at all. */ export type UnsavedWorkAnswer = "save" | "discard";
export type ContextSelection = Omit<Scope, "principalId"> & { readonly resolveUnsavedWork?: UnsavedWorkAnswer };
export type SelectContextDispatch = (input: MutationInput<ContextSelection>) => Promise<MutationOutcome>;
export type ContextSwitchRequest = { readonly pendingScope: Scope; readonly expectedRevision: string; readonly operationId?: string; readonly resolution?: UnsavedWorkAnswer };
export type ContextSwitchResult = { readonly requestedScope: Scope; readonly operationId: string; readonly switched: boolean; readonly outcome: MutationOutcome; readonly summary: OutcomeSummary; readonly announcement: string };
export type ContextFenceOptions = { readonly scope: Scope; readonly selectContext: SelectContextDispatch; readonly copy: ContextSwitchGuardCopy };
export type ContextFence = { readonly switchContext: (request: ContextSwitchRequest) => Promise<ContextSwitchResult>; readonly isSwitching: boolean; readonly lastResult: ContextSwitchResult | null; readonly isStale: (scopeAtRequestTime: Scope) => boolean };
/** The context switch, performed once and safely against the one query cache. */ export function useContextFence({ scope, selectContext, copy }: ContextFenceOptions): ContextFence {
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);
  const [lastResult, setLastResult] = useState<ContextSwitchResult | null>(null);
  const fenceRef = useRef<Scope>(scope);
  const switchingRef = useRef(false);
  const attemptRef = useRef<Promise<ContextSwitchResult> | null>(null);
  useEffect(() => {
    if (!switchingRef.current) fenceRef.current = scope;
  }, [scope]);
  const isStaleFor = useCallback((scopeAtRequestTime: Scope): boolean => isStale(scopeAtRequestTime, fenceRef.current), []);
  const performSwitch = useCallback(
    async (request: ContextSwitchRequest): Promise<ContextSwitchResult> => {
      const operationId = request.operationId ?? mintOperationId();
      switchingRef.current = true;
      setIsSwitching(true);
      setLastResult(null);
      try {
        await queryClient.cancelQueries();
        queryClient.clear();
        fenceRef.current = request.pendingScope;
        const outcome = await selectContext({
          operationId,
          scope,
          expectedRevision: request.expectedRevision,
          payload: { organizationId: request.pendingScope.organizationId, ministryId: request.pendingScope.ministryId, supportSubjectId: request.pendingScope.supportSubjectId, ...(request.resolution === undefined ? {} : { resolveUnsavedWork: request.resolution }) },
        });
        const switched = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
        if (!switched) fenceRef.current = scope;
        const summary = summariseOutcome(outcome, copy);
        const result: ContextSwitchResult = { requestedScope: request.pendingScope, operationId, switched, outcome, summary, announcement: announcementFor(summary) };
        setLastResult(result);
        return result;
      } catch {
        fenceRef.current = scope;
        const outcome = unknownOutcome({ operationId });
        const summary = summariseOutcome(outcome, copy);
        const result: ContextSwitchResult = { requestedScope: request.pendingScope, operationId, switched: false, outcome, summary, announcement: announcementFor(summary) };
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
      if (running !== null) return running;
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
/** One surface's unsaved work: what it holds in the worker's words, how to save it through that surface's own save, and how to drop it. */ export type UnsavedWorkHandle = { readonly description: string; readonly save: () => Promise<void>; readonly discard: () => void };
type UnsavedWorkRegistry = { readonly register: (handle: UnsavedWorkHandle) => () => void };
const NO_REGISTRY: UnsavedWorkRegistry = { register: () => () => undefined };
const UnsavedWorkRegistryContext = createContext<UnsavedWorkRegistry>(NO_REGISTRY);
const UnsavedWorkEntryContext = createContext<UnsavedWorkHandle | null>(null);
/** Holds the unsaved work the surfaces below the shell register, in the order they registered it, so the guard speaks for the surface the worker reached last rather than one form overwriting another. */ export function UnsavedWorkProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [handles, setHandles] = useState<readonly UnsavedWorkHandle[]>([]);
  const registry = useMemo<UnsavedWorkRegistry>(
    () => ({
      register: (handle) => {
        setHandles((current) => [...current, handle]);
        return () => setHandles((current) => current.filter((candidate) => candidate !== handle));
      },
    }),
    [],
  );
  const entry = handles.length === 0 ? null : (handles[handles.length - 1] ?? null);
  return (
    <UnsavedWorkRegistryContext.Provider value={registry}>
      <UnsavedWorkEntryContext.Provider value={entry}>{children}</UnsavedWorkEntryContext.Provider>
    </UnsavedWorkRegistryContext.Provider>
  );
}
/** Registers one surface's unsaved work while it holds some, and withdraws it as soon as it holds none. */ export function useUnsavedWork(handle: UnsavedWorkHandle | null): void {
  const registry = useContext(UnsavedWorkRegistryContext);
  const latest = useRef<UnsavedWorkHandle | null>(handle);
  const active = handle !== null;
  useEffect(() => {
    latest.current = handle;
  }, [handle]);
  useEffect(() => {
    if (!active) return undefined;
    // One stable registration per active period, reading the current handle through the ref: a form re-renders on every keystroke, and registering each of those objects would churn the shell for a change the guard never sees.
    const registered: UnsavedWorkHandle = {
      get description(): string {
        return latest.current?.description ?? "";
      },
      save: async (): Promise<void> => {
        await latest.current?.save();
      },
      discard: (): void => {
        latest.current?.discard();
      },
    };
    return registry.register(registered);
  }, [active, registry]);
}
/** The unsaved work most recently registered below the shell, which is what the guard offers to save or discard. */ export const useUnsavedWorkEntry = (): UnsavedWorkHandle | null => useContext(UnsavedWorkEntryContext);
type GuardAction = "discard" | "save";
export type ContextSwitchGuardProps = {
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
};
const DISCARD_FAILED = "Couldn’t confirm the ministry switch. Nothing was discarded — check your current ministry before trying again.";
const SAVE_FAILED = "Couldn’t confirm your save, so we stayed in your current ministry and kept your changes.";
/** The Save / Discard / Stay guard for a context change. */ export function ContextSwitchGuard({ copy, open, pendingScope, unsavedWork, onStay, onDiscard, onSaveAndSwitch, busy = false, className, pendingScopeLabel, outcome = null }: ContextSwitchGuardProps): ReactElement {
  const [pendingAction, setPendingAction] = useState<GuardAction | null>(null);
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const saveNoteId = useId();
  const pendingRef = useRef<GuardAction | null>(null);
  const stayRef = useRef<HTMLButtonElement | null>(null);
  const busyNow = busy || pendingAction !== null;
  const handleOpenChange = useCallback(
    (nextOpen: boolean, details: { readonly cancel: () => void }): void => {
      if (nextOpen) return;
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
      if (busy || pendingRef.current !== null) return;
      if (action === "save" && onSaveAndSwitch === undefined) return;
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
        } catch (error) {
          // A refusal the owning surface states in its own words is reported as it stands, so the worker reads what actually blocked the save rather than a generic line; the two constants are the fallback for a failure that states nothing.
          setActionFailure(error instanceof Error && error.message.trim() !== "" ? error.message.trim() : action === "save" ? SAVE_FAILED : DISCARD_FAILED);
        } finally {
          pendingRef.current = null;
          setPendingAction(null);
        }
      })();
    },
    [busy, onDiscard, onSaveAndSwitch],
  );
  const label = pendingScopeLabel?.trim() ?? "";
  const notice: OutcomeSummary | null = actionFailure !== null ? { tone: "refused", sentence: actionFailure } : outcome === null ? null : summariseOutcome(outcome, copy);
  return (
    <AlertDialog open={open && pendingScope !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent className={cn(className)} aria-busy={busyNow ? true : undefined} aria-modal="true">
        <AlertDialogHeader>
          {unsavedWork === undefined ? null : (
            <AlertDialogMedia>
              <TriangleAlertIcon aria-hidden="true" />
            </AlertDialogMedia>
          )}
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>{copy.body}</span>
            {label === "" ? null : <bdi className="font-medium text-foreground">{label}</bdi>}
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
          <output className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {pendingAction === "save" ? "Saving your changes before switching…" : "Switching ministry…"}
          </output>
        ) : null}
        {notice === null ? null : (
          <output className="block">
            <Alert variant={notice.tone === "refused" ? "destructive" : "default"} role={undefined}>
              <AlertDescription>
                {notice.sentence}
                {notice.detail === undefined ? null : (
                  <>
                    {" "}
                    {notice.detail.label}: <bdi className={"mono-identifier break-all"}>{notice.detail.value}</bdi>
                  </>
                )}
              </AlertDescription>
            </Alert>
          </output>
        )}
        {onSaveAndSwitch === undefined ? null : (
          <span id={saveNoteId} className="block text-sm text-balance text-muted-foreground">
            {copy.saveNote}
          </span>
        )}
        <AlertDialogFooter>
          <AlertDialogAction ref={stayRef} confirmVariant="outline" onClick={() => onStay()}>
            {copy.stayLabel}
          </AlertDialogAction>
          <AlertDialogAction confirmVariant="destructive" disabled={busyNow} onClick={() => runAction("discard")}>
            {copy.discardLabel}
          </AlertDialogAction>
          {onSaveAndSwitch === undefined ? null : (
            <AlertDialogAction disabled={busyNow} aria-describedby={saveNoteId} onClick={() => runAction("save")}>
              {copy.saveLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export default ContextSwitchGuard;
