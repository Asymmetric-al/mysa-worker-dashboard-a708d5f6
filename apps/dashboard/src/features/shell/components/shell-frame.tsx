"use client";

/**
 * The client composition between the root layout and the shell: the one place the query client, the
 * context switch and the development region are created.
 *
 * **Why a client component has to exist here.** Three of the facts the shell needs are functions or
 * live cache state and cannot cross the Server Component boundary: the `selectContext` dispatch, the
 * development transports, and the TanStack Query client itself (AAP 0.3.2: a client interaction calls a
 * Route Handler; AAP assumptions rule out Server Actions as a second mutation transport). The root
 * layout renders structure and never fetches, so the shell's client frame is composed here, once, and
 * the layout passes it plain data only.
 *
 * **The query client, created once.** AAP 0.3.1 fixes TanStack Query as the remote-result state and
 * 0.7.2 fixes the cache's lifetime: one cache per browser session, holding envelopes only, cleared when
 * the context changes. So it is created in a `useState` initialiser — once per mounted session, never at
 * module scope, never on a re-render — and the context fence below is what empties it.
 *
 * **The development region's gate is the environment guard.** The region renders only where
 * `isDevelopment()` (the one guard in `lib/guards.ts`) says this build carries the development runtime,
 * and its state then comes from `GET /api/dev`, which refuses the same controls on the server outside a
 * development build (AAP 0.3.2, 0.7.2). A production build therefore renders no development control and
 * sends no development request; it does not hide a control behind a UI condition and call that the
 * boundary.
 *
 * **What it does not do.** It holds no development state of its own, formats no value, reads no clock
 * and holds no record. The state is the read's answer, the personas are the ones that answer carries, and
 * every dispatch is the transport `hooks/use-dev-mutations.ts` owns. A control whose transport this
 * release cannot provide is not passed at all, so the shell renders no control that could not act: the
 * persona switch needs a session-establishment step the application does not yet have, and a control
 * that cannot act is worse than none.
 */

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AppShell, {
  type AdmissionState,
  type AppShellContextSwitch,
  type AppShellDevActions,
} from "@/components/app-shell";
import type { AdmittedContext, ContextRequest } from "@/components/context-indicator";
import { useContextFence } from "@/components/context-switch-guard";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationInput } from "@/modules/data-service";
import { isDevelopment } from "@/lib/guards";
import { CONTEXT_SWITCH_COPY } from "@/features/shell/copy/context-switch";

import { submitContextSelection } from "../api-client";
import { useDevMutations } from "../hooks/use-dev-mutations";
import { useDevState } from "../hooks/use-dev-state";

/** Props of {@link ShellFrame}: the plain facts the root layout could read on the server. */
export interface ShellFrameProps {
  /** The exact authority the server-rendered data was read under, from the read envelope. */
  readonly scope: Scope;
  /** How this session was admitted, which decides whether the route or a recovery surface renders. */
  readonly admissionState: AdmissionState;
  /** Every membership the session admits, as the chooser listed them (support subject included). */
  readonly contextAdmissions: readonly AdmittedContext[];
  /**
   * The context record's revision the server read saw, presented as `expectedRevision` by a switch.
   * An empty string when the session holds no context record at all, in which case no chooser is offered.
   */
  readonly contextRevision: string;
  /** The route's own content, rendered inside the query provider and the shell. */
  readonly children: ReactNode;
}

/**
 * The shell's client frame: one query client, one context switch, one development region.
 *
 * `canSwitchContext` is false when the session has no context record to present a revision from: a
 * switch would then be an attempt with no `expectedRevision`, which the service answers as a conflict
 * the person cannot resolve. The indicator therefore keeps stating the membership in force instead of
 * offering a chooser that cannot complete.
 */
export function ShellFrame(props: ShellFrameProps): ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Nothing in this application retries a read for the reader: a refusal is an answer and an
            // outage names its source and the safe retry, so a silent second request would hide both.
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ShellSurface {...props} />
    </QueryClientProvider>
  );
}

/**
 * Everything inside the query client, split out because it reads the cache the provider above supplies.
 *
 * The development read is enabled by the environment guard and nothing else, and the transports are
 * built from the envelope that read reported, so a refused or unreadable runtime leaves the region
 * absent while the persistent **Development data** label stays in place.
 */
function ShellSurface({
  scope,
  admissionState,
  contextAdmissions,
  contextRevision,
  children,
}: ShellFrameProps): ReactElement {
  const developmentControls = isDevelopment();
  const devRead = useDevState(scope, developmentControls);
  const envelope = devRead.data?.kind === "envelope" ? devRead.data.envelope : null;
  const transports = useDevMutations(scope, envelope, developmentControls);

  const router = useRouter();

  /*
   * The switch's dispatch. It is a plain function over the one transport, so the once-only ordering
   * contract — cancel in-flight reads, empty the cache, move the fence, then dispatch — stays in
   * `components/context-switch-guard` and is not repeated here.
   */
  const selectContext = useCallback(
    (input: MutationInput<Omit<Scope, "principalId">>) => submitContextSelection(input),
    [],
  );
  const fence = useContextFence({ scope, selectContext, copy: CONTEXT_SWITCH_COPY });

  const canSwitchContext = contextRevision.length > 0 && contextAdmissions.length > 0;

  /*
   * The context switch, as the shell asks for it. The target scope is resolved from the memberships the
   * chooser itself listed — including the support subject each ministry row carries — so a switch never
   * names another context's finance projection, and an unadmittable request is answered with `null`
   * rather than with a refusal that would describe an attempt nobody made.
   */
  const contextSwitch = useMemo<AppShellContextSwitch | undefined>(() => {
    if (!canSwitchContext) {
      return undefined;
    }

    const resolvePendingScope = (request: ContextRequest): Scope | null => {
      const admission = contextAdmissions.find(
        (candidate) =>
          candidate.organizationId === request.organizationId &&
          candidate.ministryId === request.ministryId,
      );
      if (admission === undefined) {
        return null;
      }
      const supportSubjectId = request.supportSubjectId ?? admission.supportSubjectId;
      if (supportSubjectId === undefined || supportSubjectId.length === 0) {
        // The selection payload names the finance subject of the context being moved to, so without one
        // there is no request this shell can make: answering `null` leaves the indicator stating the
        // context in force rather than sending a scope completed with a guess.
        return null;
      }
      return {
        organizationId: admission.organizationId as Scope["organizationId"],
        ministryId: admission.ministryId as Scope["ministryId"],
        supportSubjectId: supportSubjectId as Scope["supportSubjectId"],
        principalId: scope.principalId,
      };
    };

    return {
      copy: CONTEXT_SWITCH_COPY,
      resolvePendingScope,
      switchTo: async (pendingScope) => {
        const result = await fence.switchContext({
          pendingScope,
          expectedRevision: contextRevision,
        });
        if (result.switched) {
          // The displayed context changes when the server re-reads under the scope the service
          // accepted: a client-side move would show one context's records under another's heading.
          router.refresh();
        }
        return result;
      },
    };
  }, [canSwitchContext, contextAdmissions, contextRevision, fence, router, scope.principalId]);

  /*
   * The development region's dispatch. `reset` is the reviewed reset the shared review step submits, and
   * it is present only where the runtime reports a deterministic reset available. The persona switch's
   * transport is deliberately absent: changing which seeded session the cookie names is a
   * session-establishment step this release does not carry yet, and the shell renders the switch only
   * where it can act.
   */
  const devActions = useMemo<AppShellDevActions | undefined>(() => {
    if (transports === null) {
      return undefined;
    }
    return {
      onSetScenario: transports.onSetScenario,
      onSetClock: transports.onSetClock,
      onAdvanceClock: transports.onAdvanceClock,
      onSetFailurePlan: transports.onSetFailurePlan,
      reset: transports.reset,
    };
  }, [transports]);

  return (
    <AppShell
      scope={scope}
      admissionState={admissionState}
      contextAdmissions={contextAdmissions}
      contextSwitch={contextSwitch}
      devState={envelope?.data}
      devActions={devActions}
    >
      {children}
    </AppShell>
  );
}

export default ShellFrame;
