/**
 * The root segment layout: the one place in the application where the document, the token
 * stylesheet and the application shell are created.
 *
 * **Why the shell is mounted here and not in a page.** Every route below this segment is a Server
 * Component that states the shell owns the single `main` landmark, the skip link and the
 * Development data label, and that admission is resolved by the shell rather than by the page. That
 * is only true if the shell sits above the routes, so this file renders it once, for all of them.
 *
 * **Where the session comes from.** One read — `reads.context.readAdmissionState()` — called
 * directly on the server. Nothing here fetches the application's own HTTP endpoint: a Server
 * Component that did would pay a second round trip for data it can read in process, and AAP 0.3.2
 * forbids the server reaching its own routes. Scope and admission are facts the service derives
 * from the development session, never values this file invents: the envelope states the authority
 * the session actually holds, and for a session that admits nothing every scope identifier is
 * empty, which no real identifier can equal.
 *
 * **Which context is named.** The shell's header states the organisation and ministry the session is
 * acting in, so it is given the memberships this session admits — read from the service's own
 * chooser listing, never inferred from a label — and it narrows them to the one in force. A context
 * the principal does not hold never appears, and a session that holds none is described as holding
 * none.
 *
 * **What each non-admitted state means.** A resolved session that is not `signed-in` arrives as an
 * envelope carrying its own state, and the shell renders that state's recovery surface in place of
 * the route. A session the service could not establish at all arrives as a `denied` result whose
 * closed reason code is mapped to the same vocabulary below — an ended session reads as expired, a
 * person with no membership as no-access, an unreadable session as unavailable, any other refusal
 * as denied — so four different conditions never collapse into one apology, and no surface claims a
 * record does not exist when the truth is that nothing was read.
 *
 * **The three facts a Server Component cannot own, and where each one is settled.**
 *
 * 1. *The current path.* Next.js 16 does not expose the request pathname to a Server Component —
 *    the `usePathname` reference states that reading the current URL from one is unsupported, by
 *    design, so that layout state survives navigation. The shell therefore takes the path from the
 *    router itself, in the client component that renders the rail, and this file supplies none: a
 *    path guessed here would mark the wrong navigation entry as current on every page.
 * 2. *The query client.* The TanStack Query cache belongs to one browser session and holds
 *    scope-keyed envelopes, so it must be created in client scope. This file cannot create one, and
 *    the build deliberately has no `providers.tsx`: adding a second file under `src/app` would
 *    break the one-file-per-route accounting the route inventory relies on. `ShellFrame` — the shell
 *    feature's own client composition — is mounted here instead and creates that one client per
 *    browser session, which also keeps the cache inside the shell boundary the context switch clears.
 * 3. *The development and context-switch transports.* They are functions, and a function cannot
 *    cross from a Server Component to a client one; Server Actions would be a second mutation
 *    transport, which this release rules out. `ShellFrame` owns them: it reads this session's
 *    development runtime through the namespaced handler behind `isDevelopment()`, builds the
 *    `selectContext` dispatch for the context switch, and holds no state this file supplies beyond
 *    the plain facts above. So this file still passes data only, and the shell never renders a
 *    control that could not act.
 *
 * **No business logic.** This file computes no total, no deadline and no percentage, reads no
 * clock, and infers no permission from anything it renders. Direction, language and appearance are
 * presentation only: `dir` on the document is the interface default for content that carries no
 * direction of its own, and the viewer's stored preferences are applied by their single owner.
 *
 * **Accessibility.** The document declares its language and direction once. The skip link, the one
 * `main` landmark and the Help destination all come from the shell, so this file adds none of them
 * a second time — two content landmarks are worse than none. `suppressHydrationWarning` is on
 * `<html>` because the viewer-preferences owner writes the chosen appearance class and interface
 * language onto that element after hydration; the attribute suppresses a diff on attributes this
 * file does not own, and nothing else.
 *
 * **Decisions this file makes where the plan is silent**, each once: the interface default is
 * `en` with `dir="ltr"` (content carries its own direction; nothing here sets a CSS base
 * direction), the element order inside `<body>` is direction provider → viewer preferences →
 * shell, and the title is a template so a route's own title reads "<route> · Worker Dashboard".
 *
 * **Layering.** `app → features → components → modules/data-service → modules/store`. This file
 * imports the service package root, the shared shell's types, and the shell feature's two composition
 * modules (the viewer-preferences owner and the client frame). It never imports the store, never
 * imports one feature from another, and never imports a route.
 */
import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";

import type { AdmissionState } from "@/components/app-shell";
import type { AdmittedContext } from "@/components/context-indicator";
import { DirectionProvider } from "@/components/ui/direction";
import { ShellFrame } from "@/features/shell/components/shell-frame";
import { ViewerPreferencesProvider } from "@/features/shell/components/viewer-preferences-provider";
import { reads, type DenialReason, type Scope } from "@/modules/data-service";
import "@/styles/globals.css";
// Fixed values
const APPLICATION_NAME = "Worker Dashboard";

const INTERFACE_LANGUAGE = "en";

const INTERFACE_DIRECTION = "ltr";

const APPLICATION_DESCRIPTION =
  "A daily workspace for seeing who needs attention, reading the financial evidence of support " + "honestly, writing and publishing ministry communication, and completing the follow-through.";
const NO_AUTHORITY_SCOPE: Scope = {
  organizationId: "" as Scope["organizationId"],
  ministryId: "" as Scope["ministryId"],
  supportSubjectId: "" as Scope["supportSubjectId"],
  principalId: "" as Scope["principalId"],
};
const NO_ADMISSIONS: readonly AdmittedContext[] = [];
// Metadata
/** The document metadata every route inherits. */
export const metadata: Metadata = {
  applicationName: APPLICATION_NAME,
  title: {
    default: APPLICATION_NAME,
    template: `%s · ${APPLICATION_NAME}`,
  },
  description: APPLICATION_DESCRIPTION,
};
/** Every route is rendered per request. */
export const dynamic = "force-dynamic";
// The document
/** What the root segment receives: the route's own rendered content. */
export interface RootLayoutProps {
  readonly children: ReactNode;
}
function recoveryStateOf(reasonCode: DenialReason | undefined): AdmissionState {
  switch (reasonCode) {
    case "session-expired":
      return "expired";
    case "no-membership":
      return "no-access";
    case "session-unavailable":
      return "unavailable";
    default:
      return "denied";
  }
}

/** The facts the shell is rendered from, all derived by the service and none by this file. */
interface ShellAdmission {
  readonly scope: Scope;
  readonly admissionState: AdmissionState;
  /**
   * The context record's revision this read reported, which a context switch presents as its
   * `expectedRevision`.
   *
   * Empty when no context record was read — a refusal or an outage answers with no envelope — and the
   * shell then offers no chooser, because a switch with no revision could only produce a conflict.
   */
  readonly contextRevision: string;
}
async function readShellAdmission(): Promise<ShellAdmission> {
  const admission = await reads.context.readAdmissionState();
  if (admission.kind === "envelope") {
    return {
      scope: admission.envelope.scope,
      admissionState: admission.envelope.data.state,
      contextRevision: admission.envelope.revision,
    };
  }
  if (admission.kind === "denied") {
    return {
      scope: NO_AUTHORITY_SCOPE,
      admissionState: recoveryStateOf(admission.denied.reasonCode),
      contextRevision: "",
    };
  }
  // The only remaining answer is an outage, and an outcome this file does not recognise is reported
  // the same way: the workspace could not be read. Fail closed, because the alternative is claiming
  // authority the service never stated.
  return { scope: NO_AUTHORITY_SCOPE, admissionState: "unavailable", contextRevision: "" };
}
async function readContextAdmissions(): Promise<readonly AdmittedContext[]> {
  const chooser = await reads.context.readContextChooser();
  if (chooser.kind !== "envelope") {
    return NO_ADMISSIONS;
  }
  return chooser.envelope.data.groups.flatMap((group) =>
    group.ministries.map((ministry) => ({
      organizationId: group.organizationId,
      organizationLabel: group.organizationLabel,
      ministryId: ministry.ministryId,
      ministryLabel: ministry.ministryLabel,
      // The finance subject the chooser listed for this membership: a switch must name that
      // membership's own projection, and only the read that enumerated it can state it.
      supportSubjectId: ministry.supportSubjectId,
    })),
  );
}
/** The root segment layout. */
export default async function RootLayout({ children }: RootLayoutProps): Promise<ReactElement> {
  // Both answers describe the same request and neither depends on the other, so they are read
  // together rather than one after the other.
  const [{ scope, admissionState, contextRevision }, contextAdmissions] = await Promise.all([
    readShellAdmission(),
    readContextAdmissions(),
  ]);

  return (
    <html lang={INTERFACE_LANGUAGE} dir={INTERFACE_DIRECTION} suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <DirectionProvider direction={INTERFACE_DIRECTION}>
          <ViewerPreferencesProvider>
            <ShellFrame
              scope={scope}
              admissionState={admissionState}
              contextAdmissions={contextAdmissions}
              contextRevision={contextRevision}
            >
              {children}
            </ShellFrame>
          </ViewerPreferencesProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
