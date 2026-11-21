"use client";

/**
 * The one application shell: the chrome every route renders inside, and the only place the page's
 * landmarks are created.
 *
 * A worker needs four things from the frame around their work, and each of them is a fact the frame
 * must never lose: **where they are**, **which context they are acting in**, **that this is
 * development data**, and **a way out of a dead end**. So the shell renders, once and only once per
 * page: one banner region (the sticky header), one `Primary` navigation landmark (through
 * `SidebarNav`), one `main` landmark, one polite status region for the outcome of a context change,
 * and the persistent **Development data** label (`DevBanner`) — which sits in the header, outside
 * every conditional, so no admission state, no recovery surface and no route can hide it.
 *
 * **What it is not.** It is not a wrapper carrying business logic, and it is deliberately thin about
 * state: it holds the open flag of the phone navigation, the pending context decision, and the last
 * settled switch. Records live in the synthetic store behind the service, envelopes live in the
 * TanStack Query cache, and the shell fetches nothing and formats no money. It also does not create a
 * direction provider, a query provider or a stylesheet import: `app/layout.tsx` owns those three, and
 * a second one of any of them is a defect rather than a convenience.
 *
 * **Admission, and honesty about it.** `admissionState` is the closed union of the envelope's session
 * states. `signed-in` renders the route's children. The other four — `unavailable`, `denied`,
 * `expired` and `no-access` — render a `StateNotice` with recovery guidance in the same `main`
 * landmark, while the navigation, the context indicator, the Development data label and the Help
 * destination stay exactly where they are on every other screen. None of them is a blank page, a
 * fabricated workspace or a sign-in form: this release has no authenticator, so offering a password
 * field here would promise a control that cannot work. The four sentences are held in one exhaustive
 * record, so a fifth admission state cannot be added without a rendering branch being written for it.
 *
 * **Sticky chrome and focus (WCAG 2.2 2.4.11).** The header is sticky, and the shell measures its
 * height and publishes it as `--app-shell-sticky-offset`, which is exactly the value
 * `components/scroll-region` reads for `scroll-padding-top`. That is what keeps a focused table cell
 * from being hidden underneath the header: the browser scrolls against the padding, so the cell
 * arrives below the chrome instead of behind it. The same measurement is written to the document's
 * `scroll-padding-top`, so page-level focus is not obscured either. The skip link is the first
 * focusable element in the document and moves focus to `#main-content`.
 *
 * **Consistent Help (3.2.6).** The Help destination is the last entry of `PRIMARY_NAV`, in the same
 * position on every page, and the shell does not add a second Help control that could drift from it.
 *
 * **320 CSS px, zoom and reduced motion.** The rail leaves the flow below the design system's compact
 * breakpoint and the same navigation model renders inside the design system's own sheet, so no
 * destination is lost on a phone and no job needs the desktop layout. Nothing here may scroll
 * horizontally: the header's content is `min-w-0` and truncates, the content column is `min-w-0`, and
 * the only horizontal scroll in the application is a table's own `ScrollRegion`. Motion is the design
 * system's, and every transition it ships is already gated on `prefers-reduced-motion`.
 *
 * **Reading direction.** `dir` is a property of the content and is set by the layout's direction
 * provider;
 * this file sets none. It uses logical utilities only (`start`/`end`, `ms-*`, `ps-*`), and takes the
 * resting side of the rail as an optional prop so a right-to-left session puts the navigation on the
 * leading edge without the shell reaching for a second direction source.
 *
 * **Layering.** A shared component: above `components/ui` and the contract modules, below every
 * feature. It imports no feature, no store and no service. That is also why the context switch and
 * the development controls arrive as **props** rather than being resolved here — the copy of the
 * switch decision belongs to the shell feature's own copy module, and the mutation transports belong
 * to the layer that owns them, while a shared component may not import a feature. Each group is
 * optional and degrades honestly: without a switch transport the indicator states the current
 * membership as a label instead of offering a chooser that could not act, and without a development
 * runtime the label stays and the controls are simply absent.
 */

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import ContextIndicator, {
  type AdmittedContext,
  type ContextRequest,
} from "@/components/context-indicator";
// The one context-change decision. It is a shared component of this same layer, not a feature: the
// switch is composed here so the dialog and the fence exist once and are reachable from wherever the
// context indicator is. Its words and its dispatch arrive as props, so importing it couples the shell
// to the decision's shape and to nothing else.
import ContextSwitchGuard, {
  type ContextSwitchGuardCopy,
  type ContextSwitchResult,
} from "@/components/context-switch-guard";
import DevBanner from "@/components/dev-banner";
import DevPanel, { type DevPanelProps } from "@/components/dev-panel";
import PersonaSwitcher, {
  type PersonaOption,
  type PersonaSwitcherProps,
} from "@/components/persona-switcher";
import { isCurrent, SidebarNav } from "@/components/sidebar-nav";
import StateNotice, { type StateNoticeProps } from "@/components/state-notice";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/cn";
import type { Scope, SessionState } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------------

/**
 * How a session was admitted, which decides whether the shell renders the route or a recovery
 * surface.
 *
 * It is the envelope's closed session-state tuple rather than a list repeated here: the state the
 * session resolver stores, the state `components/persona-switcher` offers and the state this shell
 * renders are one set, so they cannot fall out of step.
 */
export type AdmissionState = SessionState;

/** The four admissions that render a recovery surface instead of the route's children. */
type RecoveryState = Exclude<AdmissionState, "signed-in">;

/**
 * This session's development state, exactly as `readDevState` reported it.
 *
 * Taken from the panel's own prop rather than redeclared, so the state the shell passes on is the
 * state the panel renders and a change to either cannot leave the other behind.
 */
export type AppShellDevState = DevPanelProps["devState"];

/**
 * Every transport the development region dispatches, supplied by the layer that owns them.
 *
 * The shell renders the controls and places them; it does not own a second call path to the
 * development route. Each entry is the exact prop its component takes, so the two cannot drift.
 */
export interface AppShellDevActions {
  /** Switches the seeded scenario this session runs in. */
  readonly onSetScenario: DevPanelProps["onSetScenario"];
  /** Sets the clock's offset from the seed instant, in milliseconds. */
  readonly onSetClock: DevPanelProps["onSetClock"];
  /** Moves the clock forward by an amount of elapsed milliseconds. */
  readonly onAdvanceClock: DevPanelProps["onAdvanceClock"];
  /** Arms one failure, or disarms the armed one with `null`. */
  readonly onSetFailurePlan: DevPanelProps["onSetFailurePlan"];
  /** The reviewed deterministic reset of the synthetic store. */
  readonly reset: DevPanelProps["reset"];
  /** Asks the development runtime to carry a different seeded persona. */
  readonly onSelectPersona: PersonaSwitcherProps["onSelect"];
  /** Asks the development runtime to apply an admission scenario, where the surface offers one. */
  readonly onSelectSessionState?: PersonaSwitcherProps["onSelectSessionState"];
}

/**
 * The context switch, so it is available wherever the context indicator is visible.
 *
 * Three things are deliberately the caller's rather than the shell's. **The words** — the heading,
 * the body and the three action labels — because a shared component may not import a feature's copy
 * and a second literal here would give every sentence two owners. **The target scope**, including the
 * finance subject: a switch moves to another context's support projection, so carrying the current
 * projection's subject across would name the wrong one, and only the caller can resolve the right
 * one from the memberships the session admitted. **The dispatch**, because the fence that cancels
 * in-flight reads, empties the query cache and then dispatches belongs beside the single transport
 * the application already has.
 */
export interface AppShellContextSwitch {
  /** The words the decision is asked in, rendered exactly as supplied. */
  readonly copy: ContextSwitchGuardCopy;
  /**
   * Resolves the exact scope a requested context names, or `null` when the session does not admit it.
   * A `null` answer is not reported as a refusal: the membership list the chooser rendered is the
   * session's own, so an unadmittable request means the session changed underneath the click, and the
   * next read is the honest answer.
   */
  readonly resolvePendingScope: (request: ContextRequest) => Scope | null;
  /** Performs the fenced switch and answers what it settled as. */
  readonly switchTo: (pendingScope: Scope) => Promise<ContextSwitchResult>;
  /**
   * What is at stake — "an unsaved Update draft in Français" — so the discard action names what it
   * loses instead of asking the reader to remember. Omitted, the dialog offers two actions and
   * implies nothing unsaved.
   */
  readonly unsavedWork?: { readonly description: string };
  /** The save path this shell has, if it has one: offered only where a save can actually happen. */
  readonly onSaveAndSwitch?: () => Promise<void>;
}

/** Props of {@link AppShell}. */
export interface AppShellProps {
  /**
   * The exact authority the visible data was read under, from the read envelope. Supplied rather than
   * derived: an equal-looking organisation, ministry or support subject id from another record
   * establishes neither identity nor authority.
   */
  readonly scope: Scope;

  /** How this session was admitted, which decides whether the route or a recovery surface renders. */
  readonly admissionState: AdmissionState;

  /**
   * The route currently open, as the router reports it, so the rail never guesses.
   *
   * Omitted by a caller that cannot know it: a Server Component is never told the request pathname
   * (`usePathname` documents that as intentional, so that layout state survives navigation), and the
   * root layout — this shell's only caller — is one. The shell then reads the same fact from the
   * router itself, which is the source this value is defined to come from, so the rail still never
   * guesses and there is still exactly one "where am I" answer rather than two that can disagree.
   */
  readonly currentPath?: string;

  /**
   * This session's development state. Omitted in a build without the development runtime: the
   * Development data label stays, and the controls that would need a state are absent rather than
   * disabled, because a control that cannot act is worse than no control.
   */
  readonly devState?: AppShellDevState;

  /**
   * The seeded personas to offer, from the development runtime read. Omitted, the roster the
   * development state itself carries is used, so the switch cannot fall behind the seed.
   */
  readonly personas?: readonly PersonaOption[];

  /** The development transports. Omitted, the development region renders no dispatchable control. */
  readonly devActions?: AppShellDevActions;

  /**
   * Every membership the session admits. Memberships the principal does not hold must not be listed:
   * a disabled entry would disclose that another context exists and would imply an access request
   * this release does not offer.
   */
  readonly contextAdmissions?: readonly AdmittedContext[];

  /** The one context switch. Omitted, the indicator states the current context and offers no chooser. */
  readonly contextSwitch?: AppShellContextSwitch;

  /**
   * The reading direction the layout put on the document, which decides the resting side of the rail.
   *
   * It is the same value the layout sets as `dir`, not a preference: the design system positions the
   * rail with a physical inset and reserves its space with an in-flow spacer, so the side and the
   * document's direction have to agree. Passing `"rtl"` while the document stays left-to-right would
   * put the rail over the content, which is why the shell mirrors a direction rather than choosing one
   * — and why it sets none of its own. Omitted, the rail rests on the physical left.
   */
  readonly direction?: "ltr" | "rtl";

  /** The route's own content, rendered only for a `signed-in` session. */
  readonly children: ReactNode;

  /** Layout classes for the shell root. Never a colour, a radius or a shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The `main` landmark's id, declared once so the skip link and any caller naming the same target
 * cannot disagree about it.
 */
export const MAIN_CONTENT_ID = "main-content";

/** The skip link's words, and the first thing a keyboard user reaches. */
const SKIP_LINK_LABEL = "Skip to main content";

/** The secondary region's accessible name, which is how it is found in a landmark list. */
const DEVELOPMENT_REGION_LABEL = "Development controls";

/** Where the recovery surfaces send a reader who needs the documented workflows explained. */
const HELP_HREF = "/help";

/** One recovery surface: what happened, what it does not mean, and the one way forward. */
interface RecoveryCopy {
  /** Which of the notice's seven states renders it. */
  readonly noticeKind: StateNoticeProps["kind"];
  /**
   * The closed reason code the notice prints beside the caller's sentence.
   *
   * The codes are what keeps the three refusals distinct even though they share one notice state:
   * `not-admitted` says the context is not one this session holds, `session-expired` says the
   * session ended, and `no-membership` says there is no account at all — the one fact `no-access`
   * knows and a plain denial never discloses. Nothing here reveals whether a record exists.
   */
  readonly reasonCode?: StateNoticeProps["reasonCode"];
  /** The notice's heading, which states the condition and never a record. */
  readonly title: string;
  /** What the state does and does not mean, with no count, amount or record name in it. */
  readonly description: string;
  /** The action's label. */
  readonly actionLabel: string;
  /**
   * Where the action goes. `null` means the page the reader is already on, which re-requests the read
   * this notice is describing — the only retry the shell can offer without inventing a handler.
   */
  readonly actionHref: string | null;
}

/**
 * The four recovery surfaces, one sentence set each.
 *
 * The record is exhaustive over {@link RecoveryState}, so adding an admission state to the envelope's
 * closed tuple fails to compile until its surfaces are written. None of the four offers a sign-in
 * form: there is no authenticator in this release, and a password field would promise one. Each names
 * what is true — nothing was changed, nothing was shown, what the way forward is — instead of the
 * generic apology that leaves a reader unable to decide what to do next.
 *
 * Only `unavailable` uses the notice's outage state; the three refusals use its denial state and are
 * told apart by their reason code and their own sentences. That is deliberate: `components/state-notice`
 * is the application's only surface for a state that is not a result, and a hand-written page for
 * "expired" here would be a second one that could drift from it.
 */
const RECOVERY_COPY: Readonly<Record<RecoveryState, RecoveryCopy>> = {
  unavailable: {
    noticeKind: "unavailable",
    title: "This workspace could not be read",
    description:
      "The application could not read this session's context, so the workspace is not shown at all " +
      "rather than shown partially or filled in from a guess. Nothing here has been changed, and " +
      "anything already saved is still saved.",
    actionLabel: "Try this page again",
    // A fresh request for the same route: the read that failed is the read this repeats.
    actionHref: null,
  },
  denied: {
    noticeKind: "denied",
    reasonCode: "not-admitted",
    title: "This workspace is not available to this session",
    description:
      "The session this page resolved does not admit the organisation and ministry it asked for. " +
      "Nothing about that context is shown — not a count, not a name and not whether a record " +
      "exists — and the honest way forward is to choose a context this session does admit.",
    actionLabel: "Open Help",
    actionHref: HELP_HREF,
  },
  expired: {
    noticeKind: "denied",
    reasonCode: "session-expired",
    title: "This session has expired",
    description:
      "A read from this point would not be authorised, so the workspace is closed instead of being " +
      "shown from a session that has ended. Nothing you saved has been discarded: the development " +
      "controls below can reset this session to the known seed, and Help explains what each " +
      "admission state means.",
    actionLabel: "Open Help",
    actionHref: HELP_HREF,
  },
  "no-access": {
    noticeKind: "denied",
    reasonCode: "no-membership",
    title: "No admitted identity for this session",
    description:
      "There is no account for this session, so there is no workspace to show. Recovering the " +
      "account is the only outcome that would help, and the seeded personas in the development " +
      "controls demonstrate the admission states this release can reach.",
    actionLabel: "Open Help",
    actionHref: HELP_HREF,
  },
};

/** No personas, shared so an empty roster does not mint a new array on every render. */
const NO_PERSONAS: readonly PersonaOption[] = [];

/** No admissions, shared so an absent list does not mint a new array on every render. */
const NO_ADMISSIONS: readonly AdmittedContext[] = [];

/** One pending switch decision: the request as the indicator phrased it, and the scope it resolves to. */
interface PendingSwitch {
  readonly request: ContextRequest;
  readonly scope: Scope;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/**
 * The words that name a membership: its organisation then its ministry, each falling back to its
 * opaque reference when the source stated no name.
 *
 * The ministry comes second because the pair reads as "organisation, ministry" everywhere else in the
 * shell, and a reference is used rather than an empty line so a membership the source never named is
 * still identifiable. Both halves are isolated by the caller's `<bdi>` where they render as values, so
 * a name from another script cannot reorder the sentence around it.
 */
function describeMembership(admission: AdmittedContext): string {
  const organization = admission.organizationLabel.trim() || admission.organizationId;
  const ministry = admission.ministryLabel.trim() || admission.ministryId;
  return `${organization}, ${ministry}`;
}

/** Whether an admitted membership is the context currently in force. Compared by identifier only. */
function isCurrentMembership(admission: AdmittedContext, scope: Scope): boolean {
  return (
    admission.organizationId === scope.organizationId &&
    admission.ministryId === scope.ministryId
  );
}

/**
 * The switch to a persona option, dropping the fields the switch does not use.
 *
 * Written out rather than passed through so the roster's shape is copied field by field: a persona
 * gains an identifier or a description in the read and this component keeps compiling, instead of
 * silently forwarding a member the control does not know how to render.
 */
function toPersonaOption(persona: {
  readonly id: string;
  readonly kind: PersonaOption["kind"];
  readonly label: string;
  readonly description: string;
}): PersonaOption {
  return {
    id: persona.id,
    kind: persona.kind,
    label: persona.label,
    description: persona.description,
  };
}

/**
 * Whether the route in front of the reader reports financial facts.
 *
 * A support projection is scoped to a finance subject that is not the ministry it is reported in, so
 * the indicator states that subject wherever money is reported and stays quiet everywhere else rather
 * than displaying an identifier whose relevance the surface cannot explain. The two families below are
 * the ones whose reads return money: Support and the coaching financial range.
 */
function showsFinancialFacts(currentPath: string): boolean {
  return isCurrent(currentPath, "/support") || isCurrent(currentPath, "/coaching");
}

// ---------------------------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------------------------

/** The custom property this shell publishes for the sticky chrome's height. */
export const STICKY_OFFSET_PROPERTY = "--app-shell-sticky-offset";

/**
 * Publishes the sticky header's measured height for everything that has to scroll beneath it.
 *
 * `components/scroll-region` reads this exact property as its default `scroll-padding-top`, which is
 * the contract that keeps a focused table cell below the header rather than behind it (WCAG 2.2
 * 2.4.11); the same value is written to the document's `scroll-padding-top` so page-level focus is not
 * obscured either. It is measured rather than assumed because the header's height is not a constant:
 * the Development data label wraps onto extra lines at 320 CSS px, and a fixed guess would leave the
 * focused cell hidden. A ref and a `ResizeObserver` rather than React state, so a resize repaints the
 * scroll offset without re-rendering the shell and re-mounting the route underneath it.
 */
function useStickyOffset(headerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const header = headerRef.current;
    if (header === null || typeof ResizeObserver === "undefined") {
      return;
    }
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

/**
 * The skip link, out of view until it is focused.
 *
 * It is first in the document so it is the first tab stop, and it is moved off the page by translating
 * rather than by clipping or hiding: an element clipped to nothing is announced by some screen readers
 * in a state where it cannot be seen, and `display: none` would take it out of the tab order altogether.
 * `focus:` rather than `focus-visible:` is deliberate — the link exists for a keyboard user, and it has
 * to appear the moment it holds focus however that focus arrived.
 */
const SKIP_LINK_CLASS = cn(
  "absolute start-3 top-3 z-50 -translate-y-[200%] rounded-md border border-border bg-background",
  "px-3 py-2 text-sm font-medium text-foreground",
  "focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-[color:var(--ring)]",
);

/**
 * The shell: the chrome every route renders inside.
 *
 * `SidebarProvider` is the outermost element because the rail and the compact navigation both read its
 * collapse state, and the skip link is its first child so it precedes every other focusable element in
 * the document. The direction and query providers and the token stylesheet belong to the layout: a
 * second one of any of them here would be a defect, not a convenience.
 */
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

/** Everything the shell renders, as the props it was given. */
type ShellChromeProps = Omit<AppShellProps, "className">;

/**
 * The shell's contents: the rail, the sticky header, the one `main` landmark and the development region.
 *
 * Split from {@link AppShell} only because it has to read the sidebar context `SidebarProvider` supplies:
 * the compact navigation is closed by asking the provider, which is what keeps the phone sheet's open
 * flag in one place instead of in a second copy here.
 */
function ShellChrome({
  scope,
  admissionState,
  currentPath: suppliedPath,
  devState,
  personas,
  devActions,
  contextAdmissions,
  contextSwitch,
  direction,
  children,
}: ShellChromeProps): ReactElement {
  const { setOpenMobile } = useSidebar();
  const headerRef = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [switching, setSwitching] = useState(false);
  const [lastSwitch, setLastSwitch] = useState<ContextSwitchResult | null>(null);

  useStickyOffset(headerRef);

  /*
   * The route to describe, from whichever side knows it. A client caller passes the path the router
   * reported; a Server Component caller — the root layout — cannot know it and passes none, so it is
   * read here. Both are the same source, which is what keeps the rail, the header's finance-subject
   * disclosure and the recovery action pointing at the one destination the reader is actually on.
   */
  const routedPath = usePathname();
  const currentPath = suppliedPath ?? routedPath;

  // A plain click on a destination closes the compact navigation the reader is looking at. The model
  // reports only real navigations — a modified click that opens another tab is not one — so following a
  // link in place dismisses the sheet while following it in a new tab leaves this page alone.
  const closeCompactNav = useCallback((): void => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const admissions = contextAdmissions ?? NO_ADMISSIONS;

  /*
   * Asks for a context change. Nothing is switched here: the request becomes a pending decision, and
   * the guard's three actions — Stay, Discard and switch, Save and switch — decide what happens. The
   * previous attempt's result is cleared so the dialog can never describe an outcome that belongs to the
   * request before this one.
   */
  const requestContext = useCallback(
    (request: ContextRequest): void => {
      if (contextSwitch === undefined) {
        return;
      }
      const target = contextSwitch.resolvePendingScope(request);
      if (target === null) {
        // The chooser listed memberships the session admitted, so an unadmittable request means the
        // session changed under the click. Reporting a refusal here would describe an attempt that was
        // never made; the next read is the honest answer.
        return;
      }
      setLastSwitch(null);
      setPending({ request, scope: target });
    },
    [contextSwitch],
  );

  /** Stay, Escape and a press outside the panel all mean the same thing: nothing changes. */
  const stayOnContext = useCallback((): void => {
    setPending(null);
  }, []);

  /**
   * Discard and switch, through the caller's fenced switch.
   *
   * The dialog closes only when the service accepted the change. A refusal, a conflict or an
   * undetermined result keeps it open with the outcome stated in place, because the context on screen is
   * still the old one and closing would imply otherwise. A thrown fault is left to the guard, which
   * reports that the result is not known rather than that the switch failed.
   */
  const discardAndSwitch = useCallback(async (): Promise<void> => {
    if (contextSwitch === undefined || pending === null) {
      return;
    }
    setSwitching(true);
    try {
      const result = await contextSwitch.switchTo(pending.scope);
      setLastSwitch(result);
      if (result.switched) {
        setPending(null);
      }
    } finally {
      setSwitching(false);
    }
  }, [contextSwitch, pending]);

  /*
   * Without a switch transport the indicator states the membership in force and offers no chooser: the
   * admitted list is narrowed to the current membership, so there is never a control that opens onto a
   * destination this shell could not move to.
   */
  const visibleAdmissions =
    contextSwitch === undefined
      ? admissions.filter((admission) => isCurrentMembership(admission, scope))
      : admissions;

  const pendingLabel = pending === null ? undefined : describePending(pending.request, admissions);

  /*
   * The roster to offer: the caller's when supplied, otherwise the one the development state carries, so
   * a persona added to the seed appears in the switch without a second list to maintain.
   */
  const personaOptions: readonly PersonaOption[] =
    personas ??
    (devState === undefined ? NO_PERSONAS : devState.personaCatalogue.personas.map(toPersonaOption));

  /*
   * Exactly one place states a switch attempt at a time. While the dialog is open the guard states it;
   * once it has closed, the indicator states a result that did not change the context. A switch that took
   * effect leaves no notice anywhere — the new context is the statement — so the shell's status region
   * announces the accepted outcome once, for a reader who is not looking at the header.
   */
  const announcement =
    pending === null && lastSwitch !== null && lastSwitch.switched ? lastSwitch.announcement : "";

  const recovery = admissionState === "signed-in" ? null : RECOVERY_COPY[admissionState];

  /*
   * The development region is rendered only where it has something to show. An empty labelled
   * complementary landmark would still be announced in a landmark list, so a build without a
   * development runtime simply has no development region rather than an empty one.
   */
  const showsPersonaSwitcher = devActions !== undefined && personaOptions.length > 0;
  const showsDevPanel = devState !== undefined && devActions !== undefined;
  const showsDevelopmentRegion = showsPersonaSwitcher || showsDevPanel;

  return (
    <>
      {/*
        The shell's only live region: polite, empty until a switch is accepted, and it never repeats the
        person's own words — an outcome sentence is all it says, once.
      */}
      <output className="sr-only">{announcement}</output>

      {/*
        One navigation model for both layouts. Below the design system's compact breakpoint `Sidebar`
        renders this same content inside its own sheet — there is no second rail and no second list of
        destinations — so every route stays reachable on a phone and nothing is lost at 320 CSS px. The
        resting side comes from the layout's direction rather than from a direction source read here.
      */}
      <Sidebar side={direction === "rtl" ? "right" : "left"} collapsible="icon">
        <SidebarContent>
          <SidebarNav currentPath={currentPath} onNavigate={closeCompactNav} />
        </SidebarContent>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          The banner region: sticky, so the active context and the Development data label stay in view
          while a long list scrolls underneath, and measured by `useStickyOffset` so a focused cell is
          never obscured by it. `min-w-0` on both rows is what keeps a long ministry name from pushing the
          page sideways at 320 CSS px — the name truncates instead.
        */}
        <header
          ref={headerRef}
          className="sticky top-0 z-20 flex flex-col gap-1.5 border-b border-border bg-background/95 px-3 py-2 backdrop-blur"
        >
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            <ContextIndicator
              scope={scope}
              admissions={visibleAdmissions}
              onRequestContext={requestContext}
              showSupportSubject={showsFinancialFacts(currentPath)}
              lastResult={pending === null ? lastSwitch : null}
              className="min-w-0 flex-1"
            />
          </div>
          {/*
            The label sits here — outside every admission conditional, every dialog and every route — so
            no surface can forget it and no screen can be mistaken for production.
          */}
          <DevBanner scenarioId={devState?.scenario.id} />
        </header>

        {/*
          The one `main` landmark. The design system's `SidebarInset` is deliberately not used: it renders
          a `main` element itself, and a second one would give the page two content landmarks where the
          shell exists to guarantee exactly one.
        */}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4">
            {recovery === null ? (
              children
            ) : (
              <StateNotice
                kind={recovery.noticeKind}
                reasonCode={recovery.reasonCode}
                title={recovery.title}
                description={recovery.description}
                headingLevel={1}
                action={{ label: recovery.actionLabel, href: recovery.actionHref ?? currentPath }}
              />
            )}
          </div>
        </main>

        {/*
          The development region, in a clearly secondary landmark rather than in the account position: a
          preview persona is a development scenario and never a sign-in, and the clock, failure plan and
          reset are controls over the synthetic runtime. Each control renders only where the layer above
          supplied what it dispatches, so the shell never shows a control it cannot act on.
        */}
        {showsDevelopmentRegion ? (
          <aside
            aria-label={DEVELOPMENT_REGION_LABEL}
            className="border-t border-border bg-muted/30"
          >
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4">
              {showsPersonaSwitcher && devActions !== undefined ? (
                <PersonaSwitcher
                  personas={personaOptions}
                  activePersonaId={devState?.activePersonaId ?? ""}
                  onSelect={devActions.onSelectPersona}
                  sessionStates={devState?.sessionStates}
                  activeSessionState={devState?.sessionState}
                  onSelectSessionState={devActions.onSelectSessionState}
                />
              ) : null}
              {showsDevPanel && devState !== undefined && devActions !== undefined ? (
                <DevPanel
                  devState={devState}
                  onSetScenario={devActions.onSetScenario}
                  onSetClock={devActions.onSetClock}
                  onAdvanceClock={devActions.onAdvanceClock}
                  onSetFailurePlan={devActions.onSetFailurePlan}
                  reset={devActions.reset}
                />
              ) : null}
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

/**
 * The words that name the context a pending switch moves to, or `undefined` when the roster no longer
 * carries it.
 *
 * Names only: the guard renders this as the destination of the decision, and an opaque identifier here
 * would be unreadable and could be mistaken for a name. `undefined` is the honest answer when the
 * membership is gone — the dialog then names no context at all rather than naming one it invented.
 */
function describePending(
  request: ContextRequest,
  admissions: readonly AdmittedContext[],
): string | undefined {
  const admission = admissions.find(
    (candidate) =>
      candidate.organizationId === request.organizationId &&
      candidate.ministryId === request.ministryId,
  );
  return admission === undefined ? undefined : describeMembership(admission);
}

export default AppShell;

