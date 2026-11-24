"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactElement, type ReactNode, type RefObject } from "react";
import ContextIndicator, { type AdmittedContext, type ContextRequest } from "@/components/context-indicator";
import ContextSwitchGuard, { type ContextSwitchGuardCopy, type ContextSwitchResult, type UnsavedWorkAnswer } from "@/components/context-switch-guard";
import DevBanner from "@/components/dev-banner";
import { isCurrent, SidebarNav } from "@/components/sidebar-nav";
import StateNotice, { type StateNoticeProps } from "@/components/state-notice";
import { Sidebar, SidebarContent, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/cn";
import type { Scope, SessionState } from "@/modules/data-service/envelope";
/** How a session was admitted, which decides whether the shell renders the route or a recovery surface. */ export type AdmissionState = SessionState;
/** The context switch, so it is available wherever the context indicator is visible. */ export type AppShellContextSwitch = {
  readonly copy: ContextSwitchGuardCopy;
  readonly resolvePendingScope: (request: ContextRequest) => Scope | null;
  readonly switchTo: (pendingScope: Scope, resolution?: UnsavedWorkAnswer) => Promise<ContextSwitchResult>;
  readonly unsavedWork?: { readonly description: string };
  readonly saveUnsavedWork?: () => Promise<void>;
  readonly discardUnsavedWork?: () => void;
};
export type AppShellProps = {
  readonly scope: Scope;
  readonly admissionState: AdmissionState;
  readonly currentPath?: string;
  readonly developmentRegion?: ReactNode;
  readonly devScenarioId?: string;
  readonly contextAdmissions?: readonly AdmittedContext[];
  readonly contextSwitch?: AppShellContextSwitch;
  readonly direction?: "ltr" | "rtl";
  readonly children: ReactNode;
  readonly className?: string;
};
/** The `main` landmark's id, declared once so the skip link and any caller naming the same target cannot disagree about it. */ export const MAIN_CONTENT_ID = "main-content";
type RecoveryCopy = { readonly noticeKind: StateNoticeProps["kind"]; readonly reasonCode?: StateNoticeProps["reasonCode"]; readonly title: string; readonly description: string; readonly actionLabel: string; readonly actionKind: "help" | "refresh" };
const RECOVERY_COPY: Readonly<Record<Exclude<AdmissionState, "signed-in">, RecoveryCopy>> = {
  unavailable: {
    noticeKind: "unavailable",
    title: "This workspace could not be read",
    description: "The application could not read this session's context, so the workspace is not shown at all " + "rather than shown partially or filled in from a guess. Nothing here has been changed, and " + "anything already saved is still saved.",
    actionLabel: "Try this page again",
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
const NO_ADMISSIONS: readonly AdmittedContext[] = [];
const describeMembership = (admission: AdmittedContext): string => `${admission.organizationLabel.trim() || admission.organizationId}, ${admission.ministryLabel.trim() || admission.ministryId}`;
const isCurrentMembership = (admission: AdmittedContext, scope: Scope): boolean => admission.organizationId === scope.organizationId && admission.ministryId === scope.ministryId;
const showsFinancialFacts = (currentPath: string): boolean => isCurrent(currentPath, "/support") || isCurrent(currentPath, "/coaching");
/** The custom property this shell publishes for the sticky chrome's height. */ export const STICKY_OFFSET_PROPERTY = "--app-shell-sticky-offset";
const useStickyOffset = (headerRef: RefObject<HTMLElement | null>): void =>
  void useEffect(() => {
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
const SKIP_LINK_CLASS = cn("absolute start-3 top-3 z-50 -translate-y-[200%] rounded-md border border-border bg-background", "px-3 py-2 text-sm font-medium text-foreground", "focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-[color:var(--ring)]", "print:hidden");
/** The shell: the chrome every route renders inside. Every region of it is screen-only, so print media keeps the page's own content and drops the skip link, the navigation column, the sticky banner and the development region from paper. `Sidebar` puts a caller's class on its fixed inner container alone, which leaves the column's width-reserving wrapper in the printed layout, so the provider hides that whole column from print. */
export const AppShell = ({ className, ...chrome }: AppShellProps): ReactElement => (
  <SidebarProvider className={cn("relative", "print:[&>[data-slot=sidebar]]:hidden", className)}>
    <a href={`#${MAIN_CONTENT_ID}`} className={SKIP_LINK_CLASS}>
      {"Skip to main content"}
    </a>
    <ShellChrome {...chrome} />
  </SidebarProvider>
);
function ShellChrome({ scope, admissionState, currentPath: suppliedPath, developmentRegion, devScenarioId, contextAdmissions, contextSwitch, direction, children }: Omit<AppShellProps, "className">): ReactElement {
  const { setOpenMobile } = useSidebar();
  const headerRef = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<{ readonly request: ContextRequest; readonly scope: Scope } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [lastSwitch, setLastSwitch] = useState<ContextSwitchResult | null>(null);
  const router = useRouter();
  const [, startRefresh] = useTransition();
  useStickyOffset(headerRef);
  const routedPath = usePathname();
  const currentPath = suppliedPath ?? routedPath;
  const closeCompactNav = useCallback((): void => setOpenMobile(false), [setOpenMobile]);
  const requestPageAgain = useCallback((): void => {
    startRefresh(() => router.refresh());
  }, [router, startRefresh]);
  const admissions = contextAdmissions ?? NO_ADMISSIONS;
  const requestContext = useCallback(
    (request: ContextRequest): void => {
      if (contextSwitch === undefined) return;
      const target = contextSwitch.resolvePendingScope(request);
      if (target === null) return;
      setLastSwitch(null);
      setPending({ request, scope: target });
    },
    [contextSwitch],
  );
  const stayOnContext = useCallback((): void => setPending(null), []);
  const discardAndSwitch = useCallback(async (): Promise<void> => {
    if (contextSwitch === undefined || pending === null) return;
    setSwitching(true);
    try {
      const result = await contextSwitch.switchTo(pending.scope, "discard");
      setLastSwitch(result);
      if (result.switched) {
        // The typing is dropped only once the switch is accepted: a refused switch leaves the worker in this context with the work still theirs.
        contextSwitch.discardUnsavedWork?.();
        setPending(null);
      }
    } finally {
      setSwitching(false);
    }
  }, [contextSwitch, pending]);
  const saveAndSwitch = useCallback(async (): Promise<void> => {
    const save = contextSwitch?.saveUnsavedWork;
    if (contextSwitch === undefined || pending === null || save === undefined) return;
    setSwitching(true);
    try {
      // The owning surface's own save runs first and states its refusal by throwing, so a save that did not settle stops the switch before any request is sent.
      await save();
      const result = await contextSwitch.switchTo(pending.scope, "save");
      setLastSwitch(result);
      if (result.switched) setPending(null);
    } finally {
      setSwitching(false);
    }
  }, [contextSwitch, pending]);
  const visibleAdmissions = contextSwitch === undefined ? admissions.filter((admission) => isCurrentMembership(admission, scope)) : admissions;
  const pendingLabel = pending === null ? undefined : describePending(pending.request, admissions);
  const announcement = pending === null && lastSwitch !== null && lastSwitch.switched ? lastSwitch.announcement : "";
  const recovery = admissionState === "signed-in" ? null : RECOVERY_COPY[admissionState];
  const showsDevelopmentRegion = developmentRegion !== undefined;
  return (
    <>
      <output className="sr-only">{announcement}</output>
      <Sidebar side={direction === "rtl" ? "right" : "left"} collapsible="icon" className="print:hidden">
        <SidebarContent>
          <SidebarNav currentPath={currentPath} onNavigate={closeCompactNav} />
        </SidebarContent>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <header ref={headerRef} className="sticky top-0 z-20 flex flex-col gap-1.5 border-b border-border bg-background/95 px-3 py-2 backdrop-blur print:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            <ContextIndicator scope={scope} admissions={visibleAdmissions} onRequestContext={requestContext} showSupportSubject={showsFinancialFacts(currentPath)} lastResult={pending === null ? lastSwitch : null} className="min-w-0 flex-1" />
          </div>
          <DevBanner scenarioId={devScenarioId} />
        </header>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4">
            {recovery === null ? (
              children
            ) : (
              <StateNotice kind={recovery.noticeKind} reasonCode={recovery.reasonCode} title={recovery.title} description={recovery.description} headingLevel={1} action={recovery.actionKind === "refresh" ? { label: recovery.actionLabel, onClick: requestPageAgain } : { label: recovery.actionLabel, href: "/help" }} />
            )}
          </div>
        </main>
        {showsDevelopmentRegion ? (
          <aside aria-label={"Development controls"} className="border-t border-border bg-muted/30 print:hidden">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4">{developmentRegion}</div>
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
          onSaveAndSwitch={contextSwitch.saveUnsavedWork === undefined ? undefined : saveAndSwitch}
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
