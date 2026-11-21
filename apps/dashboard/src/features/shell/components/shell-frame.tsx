"use client";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppShell, { type AdmissionState, type AppShellContextSwitch } from "@/components/app-shell";
import type { AdmittedContext, ContextRequest } from "@/components/context-indicator";
import { useContextFence } from "@/components/context-switch-guard";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationInput } from "@/modules/data-service";
import { CONTEXT_SWITCH_COPY } from "@/features/shell/copy/context-switch";
import { submitContextSelection } from "../api-client";
import { useDevState } from "../hooks/use-dev-state";
export type ShellFrameProps = {
  /** The exact authority the server-rendered data was read under, from the read envelope. */
  readonly scope: Scope;
  /** How this session was admitted, which decides whether the route or a recovery surface renders. */
  readonly admissionState: AdmissionState;
  readonly contextAdmissions: readonly AdmittedContext[];
  /** The context record's revision the server read saw; empty where the session holds no context record, in which case no chooser is offered. */
  readonly contextRevision: string;
  /**
   * The development region, composed by the server render that decided there are development controls at
   * all. Its presence is the whole flag: the read below is enabled exactly where a region was composed, so
   * no browser bundle has to re-derive the build's environment to decide whether a control surface exists.
   */
  readonly developmentRegion?: ReactNode;
  readonly children: ReactNode;
};
export function ShellFrame(props: ShellFrameProps): ReactElement {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <ShellSurface {...props} />
    </QueryClientProvider>
  );
}
function ShellSurface({ scope, admissionState, contextAdmissions, contextRevision, developmentRegion, children }: ShellFrameProps): ReactElement {
  const developmentControls = developmentRegion !== undefined;
  // This read is the shell's own single observation of the development envelope, and it exists for one fact:
  // the scenario the persistent "Development data" label states. The control region observes the same query
  // key, so both render one request and one cache entry.
  const devRead = useDevState(scope, developmentControls);
  const devScenarioId = devRead.data?.kind === "envelope" ? devRead.data.envelope.data.scenario.id : undefined;
  const router = useRouter();
  const selectContext = useCallback((input: MutationInput<Omit<Scope, "principalId">>) => submitContextSelection(input), []);
  const fence = useContextFence({ scope, selectContext, copy: CONTEXT_SWITCH_COPY });
  /** No read is retried for the reader: a refusal is an answer and an outage names its source and the safe retry, so a silent second request would hide both. */
  const canSwitchContext = contextRevision.length > 0 && contextAdmissions.length > 0;
  /** The context switch, as the shell asks for it: the target scope is resolved from the memberships the chooser listed, so a switch never names another context's finance projection. */
  const contextSwitch = useMemo<AppShellContextSwitch | undefined>(() => {
    if (!canSwitchContext) {
      return undefined;
    }
    const resolvePendingScope = (request: ContextRequest): Scope | null => {
      const admission = contextAdmissions.find((candidate) => candidate.organizationId === request.organizationId && candidate.ministryId === request.ministryId);
      if (admission === undefined) {
        return null;
      }
      const supportSubjectId = request.supportSubjectId ?? admission.supportSubjectId;
      if (supportSubjectId === undefined || supportSubjectId.length === 0) {
        // Without a finance subject there is no request this shell can make: `null` leaves the indicator stating the context in force rather than sending a scope completed with a guess.
        return null;
      }
      return { organizationId: admission.organizationId as Scope["organizationId"], ministryId: admission.ministryId as Scope["ministryId"], supportSubjectId: supportSubjectId as Scope["supportSubjectId"], principalId: scope.principalId };
    };
    return {
      copy: CONTEXT_SWITCH_COPY,
      resolvePendingScope,
      switchTo: async (pendingScope) => {
        const result = await fence.switchContext({ pendingScope, expectedRevision: contextRevision });
        if (result.switched) {
          // The displayed context changes when the server re-reads under the accepted scope: a client-side move would show one context's records under another's heading.
          router.refresh();
        }
        return result;
      },
    };
  }, [canSwitchContext, contextAdmissions, contextRevision, fence, router, scope.principalId]);
  return (
    <AppShell scope={scope} admissionState={admissionState} contextAdmissions={contextAdmissions} contextSwitch={contextSwitch} developmentRegion={developmentRegion} devScenarioId={devScenarioId}>
      {children}
    </AppShell>
  );
}
export default ShellFrame;
