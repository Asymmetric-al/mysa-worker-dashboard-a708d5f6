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
 *    break the one-file-per-route accounting the route inventory relies on. The client frame that
 *    owns it is recorded as an integration finding rather than improvised here.
 * 3. *The development and context-switch transports.* They are functions, and a function cannot
 *    cross from a Server Component to a client one; Server Actions would be a second mutation
 *    transport, which this release rules out. So the shell is given none, and it renders exactly
 *    what it can honestly render: the persistent **Development data** label on every screen, and no
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
 * imports the service package root, the shared shell components and one shell-feature provider. It
 * never imports the store, never imports one feature from another, and never imports a route.
 */

import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";

import AppShell, { type AdmissionState } from "@/components/app-shell";
import type { AdmittedContext } from "@/components/context-indicator";
import { DirectionProvider } from "@/components/ui/direction";
import { ViewerPreferencesProvider } from "@/features/shell/components/viewer-preferences-provider";
import { reads, type DenialReason, type Scope } from "@/modules/data-service";

import "@/styles/globals.css";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The application's name, used by the document title and by the manifest-level metadata. */
const APPLICATION_NAME = "Worker Dashboard";

/**
 * The interface language of this release's chrome.
 *
 * It is the document's `lang`, not a claim about the language of any record: content carries its own
 * `lang` and `dir` on the block that holds it, and the viewer's chosen interface language replaces
 * this default once their stored preferences are applied.
 */
const INTERFACE_LANGUAGE = "en";

/** The interface default reading direction, mirrored by the direction provider below. */
const INTERFACE_DIRECTION = "ltr";

/**
 * What the application is for, stated as the product states it: one workspace in which a worker
 * recognises who needs attention, reads the evidence of their support honestly, writes and
 * publishes ministry communication, and completes the follow-through.
 *
 * It says nothing about production readiness, because every record here is synthetic and every
 * external effect is simulated — the persistent label in the shell is where that is stated, once.
 */
const APPLICATION_DESCRIPTION =
  "A daily workspace for seeing who needs attention, reading the financial evidence of support " +
  "honestly, writing and publishing ministry communication, and completing the follow-through.";

/**
 * The authority a session that holds none is described by: every identifier empty.
 *
 * It mirrors the encoding `reads.context.readAdmissionState` itself uses for a session that admits
 * nothing: an empty identifier is not a value any identifier can hold, so this can never be
 * mistaken for an organisation, a ministry, a finance subject or a person, and the shell compares
 * identifiers only. It is reached solely when the service could not establish a session at all,
 * which means there is no authority to name rather than one that was withheld.
 */
const NO_AUTHORITY_SCOPE: Scope = {
  organizationId: "" as Scope["organizationId"],
  ministryId: "" as Scope["ministryId"],
  supportSubjectId: "" as Scope["supportSubjectId"],
  principalId: "" as Scope["principalId"],
};

/**
 * The memberships a session that admits nothing is described by: none.
 *
 * One shared value rather than a fresh array per render, so an absent list cannot be mistaken for a
 * list that was read and came back empty by accident.
 */
const NO_ADMISSIONS: readonly AdmittedContext[] = [];

// ---------------------------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------------------------

/**
 * The document metadata every route inherits.
 *
 * No `robots` directive is set here: `noindex` is a per-edition decision that belongs to the page
 * serving that edition, so a global one would either over-apply it to the whole workspace or invite
 * a page to contradict the root.
 */
export const metadata: Metadata = {
  applicationName: APPLICATION_NAME,
  title: {
    default: APPLICATION_NAME,
    template: `%s · ${APPLICATION_NAME}`,
  },
  description: APPLICATION_DESCRIPTION,
};

/**
 * Every route is rendered per request.
 *
 * Admission, scope and the scenario clock are resolved from the development session on each read,
 * so a cached render would serve one session's context to another — and the shell's recovery
 * surfaces would be frozen at whatever the session was when the page was first produced.
 */
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

/** What the root segment receives: the route's own rendered content. */
export interface RootLayoutProps {
  readonly children: ReactNode;
}

/**
 * The recovery state a refusal from the session resolver is reported as.
 *
 * The three refusals that name a condition keep it — an ended session, a person with no account,
 * an unreadable session — and every other refusal code reads as a plain denial, because it says
 * the caller may not act rather than that the workspace is down. Telling these apart is what stops
 * "you have no account" from being delivered as "the app is broken", and none of them discloses a
 * record.
 */
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

/** The two facts the shell is rendered from, both derived by the service and never by this file. */
interface ShellAdmission {
  readonly scope: Scope;
  readonly admissionState: AdmissionState;
}

/**
 * Resolves the authority and the admission state the shell is drawn in.
 *
 * One read, no retry and no fallback: a session whose records cannot be read is reported as
 * unavailable with its source, and a session that cannot be established is reported as the refusal
 * its reason code names. Neither is answered with an invented principal or with seeded data, which
 * is why there is no branch here that produces a workspace out of nothing.
 */
async function readShellAdmission(): Promise<ShellAdmission> {
  const admission = await reads.context.readAdmissionState();

  if (admission.kind === "envelope") {
    return { scope: admission.envelope.scope, admissionState: admission.envelope.data.state };
  }

  if (admission.kind === "denied") {
    return {
      scope: NO_AUTHORITY_SCOPE,
      admissionState: recoveryStateOf(admission.denied.reasonCode),
    };
  }

  // The only remaining answer is an outage, and an outcome this file does not recognise is reported
  // the same way: the workspace could not be read. Fail closed, because the alternative is claiming
  // authority the service never stated.
  return { scope: NO_AUTHORITY_SCOPE, admissionState: "unavailable" };
}

/**
 * The memberships the header may name, read from the chooser's own listing of what this session
 * admits.
 *
 * Only the memberships the resolver admitted appear — a context the principal does not hold is absent
 * rather than disabled, because a disabled entry would disclose that some other context exists. The
 * identifiers stay the identity and the labels are only words a person recognises: nothing here
 * derives an identity from a name, matches two records on one, or invents a label the source did not
 * state. A session that cannot enumerate (any of the four non-admitted states) yields no memberships
 * rather than a refusal, because the shell has no place to put one here — the recovery surface inside
 * the `main` landmark already states the condition.
 */
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
    })),
  );
}

/**
 * The root segment layout.
 *
 * It renders the document, applies the interface default direction to everything portalled from
 * inside it, hands the viewer's presentation preferences to their single owner, and mounts the
 * shell around the route. The route's own content is only rendered by the shell for a signed-in
 * session; for every other admission the shell renders that state's recovery surface instead, so a
 * page never has to handle admission itself and never renders beside a refusal.
 */
export default async function RootLayout({ children }: RootLayoutProps): Promise<ReactElement> {
  // Both answers describe the same request and neither depends on the other, so they are read
  // together rather than one after the other.
  const [{ scope, admissionState }, contextAdmissions] = await Promise.all([
    readShellAdmission(),
    readContextAdmissions(),
  ]);

  return (
    <html lang={INTERFACE_LANGUAGE} dir={INTERFACE_DIRECTION} suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <DirectionProvider direction={INTERFACE_DIRECTION}>
          <ViewerPreferencesProvider>
            <AppShell
              scope={scope}
              admissionState={admissionState}
              contextAdmissions={contextAdmissions}
            >
              {children}
            </AppShell>
          </ViewerPreferencesProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
