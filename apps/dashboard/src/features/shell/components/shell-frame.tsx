"use client";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import AppShell, { type AdmissionState, type AppShellContextSwitch } from "@/components/app-shell";
import type { AdmittedContext, ContextRequest } from "@/components/context-indicator";
import { UnsavedWorkProvider, useContextFence, useUnsavedWorkEntry, type ContextSelection } from "@/components/context-switch-guard";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationInput } from "@/modules/data-service";
import { CONTEXT_SWITCH_COPY } from "@/features/shell/copy/context-switch";
import { submitContextSelection } from "../api-client";
import { useDevState } from "../hooks/use-dev-state";
export type ShellFrameProps = { readonly scope: Scope; readonly admissionState: AdmissionState; readonly contextAdmissions: readonly AdmittedContext[]; readonly contextRevision: string; readonly developmentRegion?: ReactNode; readonly children: ReactNode };
export function ShellFrame(props: ShellFrameProps): ReactElement {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <UnsavedWorkProvider>
          <ShellSurface {...props} />
        </UnsavedWorkProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
function ShellSurface({ scope, admissionState, contextAdmissions, contextRevision, developmentRegion, children }: ShellFrameProps): ReactElement {
  const devRead = useDevState(scope, developmentRegion !== undefined);
  const devScenarioId = devRead.data?.kind === "envelope" ? devRead.data.envelope.data.scenario.id : undefined;
  const router = useRouter();
  const unsavedWork = useUnsavedWorkEntry();
  const selectContext = useCallback((input: MutationInput<ContextSelection>) => submitContextSelection(input), []);
  const fence = useContextFence({ scope, selectContext, copy: CONTEXT_SWITCH_COPY });
  const canSwitchContext = contextRevision.length > 0 && contextAdmissions.length > 0;
  const contextSwitch = useMemo<AppShellContextSwitch | undefined>(() => {
    if (!canSwitchContext) return undefined;
    const resolvePendingScope = (request: ContextRequest): Scope | null => {
      const admission = contextAdmissions.find((candidate) => candidate.organizationId === request.organizationId && candidate.ministryId === request.ministryId);
      if (admission === undefined) return null;
      const supportSubjectId = request.supportSubjectId ?? admission.supportSubjectId;
      return supportSubjectId === undefined || supportSubjectId.length === 0 ? null : { organizationId: admission.organizationId as Scope["organizationId"], ministryId: admission.ministryId as Scope["ministryId"], supportSubjectId: supportSubjectId as Scope["supportSubjectId"], principalId: scope.principalId };
    };
    return {
      copy: CONTEXT_SWITCH_COPY,
      resolvePendingScope,
      switchTo: async (pendingScope, resolution) => {
        const result = await fence.switchContext({ pendingScope, expectedRevision: contextRevision, ...(resolution === undefined ? {} : { resolution }) });
        if (result.switched) router.refresh();
        return result;
      },
      ...(unsavedWork === null ? {} : { unsavedWork, saveUnsavedWork: unsavedWork.save, discardUnsavedWork: unsavedWork.discard }),
    };
  }, [canSwitchContext, contextAdmissions, contextRevision, fence, router, scope.principalId, unsavedWork]);
  return <AppShell {...{ scope, admissionState, contextAdmissions, contextSwitch, developmentRegion, devScenarioId }}>{children}</AppShell>;
}
export default ShellFrame;
