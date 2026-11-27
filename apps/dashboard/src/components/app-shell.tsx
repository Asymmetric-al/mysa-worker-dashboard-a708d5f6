"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronRightIcon, KeyboardIcon, Layers3Icon, SearchIcon, WrenchIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, useTransition, type ReactElement, type ReactNode, type RefObject } from "react";
import CommandPalette from "@/components/command-palette";
import ContextIndicator, { type AdmittedContext, type ContextRequest } from "@/components/context-indicator";
import ContextSwitchGuard, { type ContextSwitchGuardCopy, type ContextSwitchResult, type UnsavedWorkAnswer } from "@/components/context-switch-guard";
import DevBanner from "@/components/dev-banner";
import ShortcutsSheet from "@/components/shortcuts-sheet";
import { isCurrent, SidebarNav } from "@/components/sidebar-nav";
import StateNotice, { type StateNoticeProps } from "@/components/state-notice";
import { Button } from "@/components/ui/button";
import { Frame, FrameHeader, FramePanel } from "@/components/ui/frame";
import { IconTile } from "@/components/ui/icon-tile";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { buildRouteBreadcrumbs } from "@/lib/route-breadcrumbs";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger, useShortcutHint } from "@/lib/ui-sdk";
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
  readonly onToggleTheme?: () => void;
  readonly direction?: "ltr" | "rtl";
  readonly children: ReactNode;
  readonly className?: string;
};
/** The `main` landmark's id, declared once so the skip link and any caller naming the same target cannot disagree about it. */ export const MAIN_CONTENT_ID = "main-content";
type RecoveryCopy = { readonly noticeKind: StateNoticeProps["kind"]; readonly reasonCode?: StateNoticeProps["reasonCode"]; readonly title: string; readonly description: string; readonly actionLabel: string; readonly actionKind: "help" | "refresh" };
const RECOVERY_COPY: Readonly<Record<Exclude<AdmissionState, "signed-in">, RecoveryCopy>> = {
  unavailable: {
    noticeKind: "unavailable",
    title: "We couldn’t load your workspace",
    description: "We couldn’t reach your session information right now, so nothing is shown rather than guessing or showing partial data. Nothing has been changed and your saved work is safe.",
    actionLabel: "Try again",
    actionKind: "refresh",
  },
  denied: {
    noticeKind: "denied",
    reasonCode: "not-admitted",
    title: "You don’t have access to this workspace",
    description: "Your current session isn’t authorized for this organization and ministry. No names, counts, or records are shown here. Open Help to see how workspace access works.",
    actionLabel: "Open Help",
    actionKind: "help",
  },
  expired: {
    noticeKind: "denied",
    reasonCode: "session-expired",
    title: "Your session has expired",
    description: "Your session has ended, so this workspace is closed until you return with a fresh session. Everything you saved before the session ended is still saved.",
    actionLabel: "Open Help",
    actionKind: "help",
  },
  "no-access": {
    noticeKind: "denied",
    reasonCode: "no-membership",
    title: "No ministry workspace is linked to this account",
    description: "This account doesn’t currently have access to a ministry workspace, so there’s nothing to show here yet. Ask your sending organization to confirm your access, or open Help for guidance.",
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
const SKIP_LINK_CLASS = cn("absolute start-3 top-3 z-(--z-skip-link) -translate-y-[200%] rounded-md border border-border bg-background", "px-3 py-2 text-sm font-medium text-foreground", "focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-[color:var(--ring)]", "print:hidden");
/** The shell: the chrome every route renders inside. Every region of it is screen-only, so print media keeps the page's own content and drops the skip link, the navigation column, the sticky banner and the development region from paper. `Sidebar` puts a caller's class on its fixed inner container alone, which leaves the column's width-reserving wrapper in the printed layout, so the provider hides that whole column from print. */
export const AppShell = ({ className, ...chrome }: AppShellProps): ReactElement => (
  <TooltipProvider delay={200} timeout={400}>
    <SidebarProvider className={cn("relative", "print:[&>[data-slot=sidebar]]:hidden", className)}>
      <a href={`#${MAIN_CONTENT_ID}`} className={SKIP_LINK_CLASS}>
        {"Skip to main content"}
      </a>
      <ShellChrome {...chrome} />
    </SidebarProvider>
  </TooltipProvider>
);
function ShellChrome({ scope, admissionState, currentPath: suppliedPath, developmentRegion, devScenarioId, contextAdmissions, contextSwitch, onToggleTheme, direction, children }: Omit<AppShellProps, "className">): ReactElement {
  const { setOpenMobile } = useSidebar();
  const headerRef = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<{ readonly request: ContextRequest; readonly scope: Scope } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [lastSwitch, setLastSwitch] = useState<ContextSwitchResult | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
  const sidebarShortcut = useShortcutHint("mod+b");
  const commandShortcut = useShortcutHint("mod+k");
  const breadcrumbs = buildRouteBreadcrumbs(currentPath);
  return (
    <>
      <output className="sr-only">{announcement}</output>
      <Sidebar side={direction === "rtl" ? "right" : "left"} variant="inset" collapsible="icon" className="print:hidden">
        <SidebarHeader className="border-b border-sidebar-border/70 pb-3">
          <div className="flex min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <IconTile variant="solid" size="sm">
              <Layers3Icon />
            </IconTile>
            <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate font-heading text-sm font-semibold tracking-tight text-sidebar-foreground">MYSA</span>
              <span className="truncate text-xs text-muted-foreground">Missionary workspace</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav currentPath={currentPath} onNavigate={closeCompactNav} />
        </SidebarContent>
        <SidebarFooter className="gap-1.5 border-t border-sidebar-border/70 pt-2.5 group-data-[collapsible=icon]:hidden">
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-sidebar-border/80 bg-card/70 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              <KeyboardIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">Keyboard shortcuts</span>
            </span>
            <Kbd aria-hidden="true">?</Kbd>
          </button>
          <div aria-hidden="true" className="flex items-center justify-between gap-2 rounded-xl border border-sidebar-border/80 bg-card/70 px-2.5 py-1.5 text-xs text-muted-foreground">
            <span className="truncate">Collapse sidebar</span>
            <Kbd>{sidebarShortcut.text}</Kbd>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header ref={headerRef} className="sticky top-0 z-(--z-header) flex flex-col gap-1.5 border-b border-border/80 bg-background/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md md:rounded-t-2xl sm:px-5 print:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger aria-keyshortcuts={sidebarShortcut.ariaKeyshortcuts} />
            <Separator orientation="vertical" className="h-5" />
            <ContextIndicator scope={scope} admissions={visibleAdmissions} onRequestContext={requestContext} showSupportSubject={showsFinancialFacts(currentPath)} lastResult={pending === null ? lastSwitch : null} className="min-w-0 flex-1" />
            {breadcrumbs.length > 0 ? (
              <nav aria-label="Breadcrumb" data-slot="shell-breadcrumb" className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground xl:flex">
                {breadcrumbs.map((crumb, index) => (
                  <Fragment key={`${crumb.label}-${String(index)}`}>
                    {index > 0 ? <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/70 rtl:rotate-180" /> : null}
                    {crumb.href !== undefined ? (
                      <Link
                        href={crumb.href}
                        aria-label={`Return to ${crumb.label}`}
                        className="inline-flex min-h-6 items-center truncate rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current="page" className="truncate px-1 font-medium text-foreground">
                        {crumb.label}
                      </span>
                    )}
                  </Fragment>
                ))}
              </nav>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-slot="command-palette-trigger"
              aria-keyshortcuts={commandShortcut.ariaKeyshortcuts}
              onClick={() => setPaletteOpen(true)}
              className="h-8 min-h-8 shrink-0 gap-2 rounded-4xl px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <SearchIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="sr-only sm:not-sr-only">Search…</span>
              <Kbd aria-hidden="true" className="hidden sm:inline-flex">
                {commandShortcut.text}
              </Kbd>
            </Button>
          </div>
          <DevBanner scenarioId={devScenarioId} />
        </header>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="@container/main min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-6">
            {recovery === null ? (
              children
            ) : (
              <StateNotice kind={recovery.noticeKind} reasonCode={recovery.reasonCode} title={recovery.title} description={recovery.description} headingLevel={1} action={recovery.actionKind === "refresh" ? { label: recovery.actionLabel, onClick: requestPageAgain } : { label: recovery.actionLabel, href: "/help" }} />
            )}
          </div>
        </main>
        {showsDevelopmentRegion ? (
          <aside aria-label={"Development controls"} className="border-t border-border/80 bg-surface-subtle print:hidden md:rounded-b-2xl">
            <div className="mx-auto flex w-full max-w-6xl flex-col px-3 py-4 sm:px-6">
              <Collapsible defaultOpen>
                <Frame spacing="sm">
                  <FrameHeader>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <IconTile variant="outline" size="xs">
                        <WrenchIcon />
                      </IconTile>
                      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Development tools</span>
                    </div>
                    <CollapsibleTrigger className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-4xl border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)] [&[data-open]_svg]:rotate-180">
                      <span>Toggle controls</span>
                      <ChevronDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground transition-transform" />
                    </CollapsibleTrigger>
                  </FrameHeader>
                  <CollapsiblePanel>
                    <FramePanel className="flex flex-col gap-4">{developmentRegion}</FramePanel>
                  </CollapsiblePanel>
                </Frame>
              </Collapsible>
            </div>
          </aside>
        ) : null}
      </SidebarInset>
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
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenShortcuts={() => setShortcutsOpen(true)} onToggleTheme={onToggleTheme} currentPath={currentPath} />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
function describePending(request: ContextRequest, admissions: readonly AdmittedContext[]): string | undefined {
  const admission = admissions.find((candidate) => candidate.organizationId === request.organizationId && candidate.ministryId === request.ministryId);
  return admission === undefined ? undefined : describeMembership(admission);
}
export default AppShell;
