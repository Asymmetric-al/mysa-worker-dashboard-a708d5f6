"use client";
/** The one application shell: the chrome every route renders inside, and the only place the page's landmarks are created. */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactElement, type ReactNode, type RefObject } from "react";

import ContextIndicator, { type AdmittedContext, type ContextRequest } from "@/components/context-indicator";
// The one context-change decision, composed here as a shared component of this layer so the dialog and the fence exist once wherever the context indicator is; its words and its dispatch arrive as props.
import ContextSwitchGuard, { type ContextSwitchGuardCopy, type ContextSwitchResult } from "@/components/context-switch-guard";
import DevBanner from "@/components/dev-banner";
import DevPanel, { type DevPanelProps } from "@/components/dev-panel";
import PersonaSwitcher, { type PersonaOption, type PersonaSwitcherProps } from "@/components/persona-switcher";
import { isCurrent, SidebarNav } from "@/components/sidebar-nav";
import StateNotice, { type StateNoticeProps } from "@/components/state-notice";
import { Sidebar, SidebarContent, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/cn";
import type { Scope, SessionState } from "@/modules/data-service/envelope";
/** How a session was admitted, which decides whether the shell renders the route or a recovery surface. */
export type AdmissionState = SessionState;
type RecoveryState = Exclude<AdmissionState, "signed-in">;
export type AppShellDevState = DevPanelProps["devState"];
export type AppShellDevActions = {
  readonly onSetScenario: DevPanelProps["onSetScenario"];
  readonly onSetClock: DevPanelProps["onSetClock"];
  readonly onAdvanceClock: DevPanelProps["onAdvanceClock"];
  readonly onSetFailurePlan: DevPanelProps["onSetFailurePlan"];
  readonly reset: DevPanelProps["reset"];
  /** Asks the development runtime to carry a different seeded persona, where this build can carry one. */
  readonly onSelectPersona?: PersonaSwitcherProps["onSelect"];
  /** Asks the development runtime to apply an admission scenario, where the surface offers one. */
  readonly onSelectSessionState?: PersonaSwitcherProps["onSelectSessionState"];
};
/** The context switch, so it is available wherever the context indicator is visible. */
export type AppShellContextSwitch = {
  readonly copy: ContextSwitchGuardCopy;
  readonly resolvePendingScope: (request: ContextRequest) => Scope | null;
  readonly switchTo: (pendingScope: Scope) => Promise<ContextSwitchResult>;
  readonly unsavedWork?: { readonly description: string };
  readonly onSaveAndSwitch?: () => Promise<void>;
};
export type AppShellProps = {
  readonly scope: Scope;
  readonly admissionState: AdmissionState;
  readonly currentPath?: string;
  readonly devState?: AppShellDevState;
  readonly personas?: readonly PersonaOption[];
  readonly devActions?: AppShellDevActions;
  readonly contextAdmissions?: readonly AdmittedContext[];
  readonly contextSwitch?: AppShellContextSwitch;
  readonly direction?: "ltr" | "rtl";
  readonly children: ReactNode;
  readonly className?: string;
};
/** The `main` landmark's id, declared once so the skip link and any caller naming the same target cannot disagree about it. */
export const MAIN_CONTENT_ID = "main-content";
const SKIP_LINK_LABEL = "Skip to main content";
const DEVELOPMENT_REGION_LABEL = "Development controls";
const HELP_HREF = "/help";

type RecoveryActionKind = "help" | "refresh";

type RecoveryCopy = {
  readonly noticeKind: StateNoticeProps["kind"];
  readonly reasonCode?: StateNoticeProps["reasonCode"];
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  /** How that one action is dispatched, which is all the four surfaces differ in. */
  readonly actionKind: RecoveryActionKind;
};

/** The four recovery surfaces, one sentence set each. */
const RECOVERY_COPY: Readonly<Record<RecoveryState, RecoveryCopy>> = {
  unavailable: {
    noticeKind: "unavailable",
    title: "This workspace could not be read",
    description: "The application could not read this session's context, so the workspace is not shown at all " + "rather than shown partially or filled in from a guess. Nothing here has been changed, and " + "anything already saved is still saved.",
    actionLabel: "Try this page again",
    // A re-request rather than a destination: the page the reader is on is the one to ask for again.
    actionKind: "refresh",
  },
  denied: {
    noticeKind: "denied",
    reasonCode: "not-admitted",
    title: "This workspace is not available to this session",
    description:
      "The session this page resolved does not admit the organisation and ministry it asked for. " + "Nothing about that context is shown — not a count, not a name and not whether a record " + "exists — and this page offers no way to choose another one, so Open Help explains what an " + "admitted session needs.",
    actionLabel: "Open Help",
    actionKind: "help",
  },
  expired: {
    noticeKind: "denied",
    reasonCode: "session-expired",
    title: "This session has expired",
    description: "A read from this point would not be authorised, so the workspace is closed instead of being " + "shown from a session that has ended. Nothing you saved has been discarded — an ended session " + "changes no stored record — and Open Help explains what each admission state means.",
    actionLabel: "Open Help",
    actionKind: "help",
  },
  "no-access": {
    noticeKind: "denied",
    reasonCode: "no-membership",
    title: "No admitted identity for this session",
    description: "There is no account for this session, so there is no workspace to show and nothing has been " + "changed. Recovering the account is the only outcome that would help, and this release carries " + "no authenticator to start it with, so Open Help explains what an admitted session needs.",
    actionLabel: "Open Help",
    actionKind: "help",
  },
};
const NO_PERSONAS: readonly PersonaOption[] = [];
const NO_ADMISSIONS: readonly AdmittedContext[] = [];
type PendingSwitch = { readonly request: ContextRequest; readonly scope: Scope };
const describeMembership = (admission: AdmittedContext): string => `${admission.organizationLabel.trim() || admission.organizationId}, ${admission.ministryLabel.trim() || admission.ministryId}`;
const isCurrentMembership = (admission: AdmittedContext, scope: Scope): boolean => admission.organizationId === scope.organizationId && admission.ministryId === scope.ministryId;
const toPersonaOption = (persona: PersonaOption): PersonaOption => ({ id: persona.id, kind: persona.kind, label: persona.label, description: persona.description });
const showsFinancialFacts = (currentPath: string): boolean => isCurrent(currentPath, "/support") || isCurrent(currentPath, "/coaching");
/** The custom property this shell publishes for the sticky chrome's height. */
export const STICKY_OFFSET_PROPERTY = "--app-shell-sticky-offset";
function useStickyOffset(headerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const header = headerRef.current;
    if (header === null || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = (): void => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      root.style.setProperty(STICKY_OFFSET_PROPERTY, `${height}px`);
      root.style.setProperty("scroll-padding-top", `var(${STICKY_OFFSET_PROPERTY})`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty(STICKY_OFFSET_PROPERTY);
      root.style.removeProperty("scroll-padding-top");
    };
  }, [headerRef]);
}
const SKIP_LINK_CLASS = cn("absolute start-3 top-3 z-50 -translate-y-[200%] rounded-md border border-border bg-background", "px-3 py-2 text-sm font-medium text-foreground", "focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-[color:var(--ring)]");
/** The shell: the chrome every route renders inside. */
export function AppShell({ className, ...chrome }: AppShellProps): ReactElement {
  return (
    <SidebarProvider className={cn("relative", className)}>
      <a href={`#${MAIN_CONTENT_ID}`} className={SKIP_LINK_CLASS}>
        {SKIP_LINK_LABEL}
      </a>
      <ShellChrome {...chrome} />
    </SidebarProvider>
  );
}
type ShellChromeProps = Omit<AppShellProps, "className">;
function ShellChrome({ scope, admissionState, currentPath: suppliedPath, devState, personas, devActions, contextAdmissions, contextSwitch, direction, children }: ShellChromeProps): ReactElement {
  const { setOpenMobile } = useSidebar();
  const headerRef = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [switching, setSwitching] = useState(false);
  const [lastSwitch, setLastSwitch] = useState<ContextSwitchResult | null>(null);

  // The router and the transition the outage surface's retry runs in, so the refresh it starts keeps the notice readable until the fresh server render arrives.
  const router = useRouter();
  const [, startRefresh] = useTransition();

  useStickyOffset(headerRef);

  /** The route to describe, from whichever side knows it. */
  const routedPath = usePathname();
  const currentPath = suppliedPath ?? routedPath;
  // A plain click on a destination closes the compact navigation the reader is looking at. The model reports only real navigations — a modified click that opens another tab is not one — so following a link in place dismisses the sheet while following it in a new tab leaves this page alone.
  const closeCompactNav = useCallback((): void => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  /** The outage surface's one action: ask the router for this route again. */
  const requestPageAgain = useCallback((): void => {
    startRefresh(() => {
      router.refresh();
    });
  }, [router, startRefresh]);

  const admissions = contextAdmissions ?? NO_ADMISSIONS;
  const requestContext = useCallback(
    (request: ContextRequest): void => {
      if (contextSwitch === undefined) return;
      const target = contextSwitch.resolvePendingScope(request);
      if (target === null) {
        // The chooser listed memberships the session admitted, so an unadmittable request means the session changed under the click. Reporting a refusal here would describe an attempt that was never made; the next read is the honest answer.
        return;
      }
      setLastSwitch(null);
      setPending({ request, scope: target });
    },
    [contextSwitch],
  );
  const stayOnContext = useCallback((): void => {
    setPending(null);
  }, []);
  const discardAndSwitch = useCallback(async (): Promise<void> => {
    if (contextSwitch === undefined || pending === null) return;
    setSwitching(true);
    try {
      const result = await contextSwitch.switchTo(pending.scope);
      setLastSwitch(result);
      if (result.switched) setPending(null);
    } finally {
      setSwitching(false);
    }
  }, [contextSwitch, pending]);
  const visibleAdmissions = contextSwitch === undefined ? admissions.filter((admission) => isCurrentMembership(admission, scope)) : admissions;
  const pendingLabel = pending === null ? undefined : describePending(pending.request, admissions);
  const personaOptions: readonly PersonaOption[] = personas ?? (devState === undefined ? NO_PERSONAS : devState.personaCatalogue.personas.map(toPersonaOption));
  const announcement = pending === null && lastSwitch !== null && lastSwitch.switched ? lastSwitch.announcement : "";
  const recovery = admissionState === "signed-in" ? null : RECOVERY_COPY[admissionState];

  /** The development region is rendered only where it has something to show. */
  const personaSelect = devActions?.onSelectPersona;
  const showsPersonaSwitcher = personaSelect !== undefined && personaOptions.length > 0;
  const showsDevPanel = devState !== undefined && devActions !== undefined;
  const showsDevelopmentRegion = showsPersonaSwitcher || showsDevPanel;
  return (
    <>
      {/* The shell's only live region: polite, empty until a switch is accepted, and it never repeats the person's own words — an outcome sentence is all it says, once. */}
      <output className="sr-only">{announcement}</output>
      {/* One navigation model for both layouts: below the compact breakpoint `Sidebar` renders this same content in its own sheet, so every route stays reachable at 320 CSS px, and the resting side comes from the layout's direction. */}
      <Sidebar side={direction === "rtl" ? "right" : "left"} collapsible="icon">
        <SidebarContent>
          <SidebarNav currentPath={currentPath} onNavigate={closeCompactNav} />
        </SidebarContent>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The banner region: sticky so the active context and the Development data label stay in view, and measured by `useStickyOffset` so a focused cell is never obscured (WCAG 2.4.11); `min-w-0` keeps a long ministry name from pushing the page sideways at 320 CSS px. */}
        <header ref={headerRef} className="sticky top-0 z-20 flex flex-col gap-1.5 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            <ContextIndicator scope={scope} admissions={visibleAdmissions} onRequestContext={requestContext} showSupportSubject={showsFinancialFacts(currentPath)} lastResult={pending === null ? lastSwitch : null} className="min-w-0 flex-1" />
          </div>
          {/* The label sits here — outside every admission conditional, every dialog and every route — so no surface can forget it and no screen can be mistaken for production. */}
          <DevBanner scenarioId={devState?.scenario.id} />
        </header>
        {/* The one `main` landmark. The design system's `SidebarInset` is deliberately not used: it renders a `main` element itself, and a second one would give the page two content landmarks where the shell exists to guarantee exactly one. */}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4">
            {recovery === null ? (
              children
            ) : (
              <StateNotice kind={recovery.noticeKind} reasonCode={recovery.reasonCode} title={recovery.title} description={recovery.description} headingLevel={1} action={recovery.actionKind === "refresh" ? { label: recovery.actionLabel, onClick: requestPageAgain } : { label: recovery.actionLabel, href: HELP_HREF }} />
            )}
          </div>
        </main>
        {/* The development region, in a secondary landmark: a preview persona is a scenario and never a sign-in, and each control renders only where the layer above supplied what it dispatches. */}
        {showsDevelopmentRegion ? (
          <aside aria-label={DEVELOPMENT_REGION_LABEL} className="border-t border-border bg-muted/30">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4">
              {personaSelect !== undefined && personaOptions.length > 0 ? (
                <PersonaSwitcher personas={personaOptions} activePersonaId={devState?.activePersonaId ?? ""} onSelect={personaSelect} sessionStates={devState?.sessionStates} activeSessionState={devState?.sessionState} onSelectSessionState={devActions?.onSelectSessionState} />
              ) : null}
              {showsDevPanel && devState !== undefined && devActions !== undefined ? <DevPanel devState={devState} onSetScenario={devActions.onSetScenario} onSetClock={devActions.onSetClock} onAdvanceClock={devActions.onAdvanceClock} onSetFailurePlan={devActions.onSetFailurePlan} reset={devActions.reset} /> : null}
            </div>
          </aside>
        ) : null}
      </div>
      {contextSwitch === undefined ? null : (
        <ContextSwitchGuard
          copy={contextSwitch.copy}
          open={pending !== null}
          pendingScope={pending?.scope ?? null}
          pendingScopeLabel={pendingLabel}
          unsavedWork={contextSwitch.unsavedWork}
          busy={switching}
          outcome={switching ? null : (lastSwitch?.outcome ?? null)}
          onStay={stayOnContext}
          onDiscard={discardAndSwitch}
          onSaveAndSwitch={contextSwitch.onSaveAndSwitch}
        />
      )}
    </>
  );
}
function describePending(request: ContextRequest, admissions: readonly AdmittedContext[]): string | undefined {
  const admission = admissions.find((candidate) => candidate.organizationId === request.organizationId && candidate.ministryId === request.ministryId);
  return admission === undefined ? undefined : describeMembership(admission);
}
export default AppShell;
