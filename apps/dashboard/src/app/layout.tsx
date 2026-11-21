/**
 * The root segment layout: the one place in the application where the document, the token stylesheet
 * and the application shell are created.
 */
import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import AppShell, { type AdmissionState } from "@/components/app-shell";
import type { AdmittedContext } from "@/components/context-indicator";
import { DirectionProvider } from "@/components/ui/direction";
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
interface ShellAdmission {
  readonly scope: Scope;
  readonly admissionState: AdmissionState;
}
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
/** The root segment layout. */
export default async function RootLayout({ children }: RootLayoutProps): Promise<ReactElement> {
  // Both answers describe the same request and neither depends on the other, so they are read
  // together rather than one after the other.
  const [{ scope, admissionState }, contextAdmissions] = await Promise.all([readShellAdmission(), readContextAdmissions()]);
  return (
    <html lang={INTERFACE_LANGUAGE} dir={INTERFACE_DIRECTION} suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <DirectionProvider direction={INTERFACE_DIRECTION}>
          <ViewerPreferencesProvider>
            <AppShell scope={scope} admissionState={admissionState} contextAdmissions={contextAdmissions}>
              {children}
            </AppShell>
          </ViewerPreferencesProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
