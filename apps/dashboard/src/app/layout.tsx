import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import type { AdmissionState } from "@/components/app-shell";
import type { AdmittedContext } from "@/components/context-indicator";
import { DirectionProvider } from "@/components/ui/direction";
import { DevControls } from "@/features/shell/components/dev-controls";
import { ShellFrame } from "@/features/shell/components/shell-frame";
import { ViewerPreferencesProvider } from "@/features/shell/components/viewer-preferences-provider";
import { reads, type DenialReason, type Scope } from "@/modules/data-service";
import { APPLICATION_NAME } from "@/lib/application-name";
import { isDevelopment } from "@/lib/guards";
import "@/styles/globals.css";
const INTERFACE_DIRECTION = "ltr";
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };
const NO_ADMISSIONS: readonly AdmittedContext[] = [];
/** Pre-paint theme bootstrap: resolves the stored appearance preference before first paint so reloads in dark mode never flash light. */
const THEME_HYDRATION_SCRIPT =
  '(function(){try{var raw=localStorage.getItem("dashboard:viewer-preferences");var pref=raw?JSON.parse(raw):null;var mode=pref&&typeof pref.appearance==="string"?pref.appearance:"system";var dark=mode==="dark"||(mode==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}catch(e){}})();';
export const metadata: Metadata = {
  applicationName: APPLICATION_NAME,
  title: { default: APPLICATION_NAME, template: `%s · ${APPLICATION_NAME}` },
  description: "Your missionary workspace for staying close to partners, following monthly support honestly, sharing ministry updates, and keeping up with follow-through.",
};
export const dynamic = "force-dynamic";
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
type ShellAdmission = { readonly scope: Scope; readonly admissionState: AdmissionState; readonly contextRevision: string };
async function readShellAdmission(): Promise<ShellAdmission> {
  const admission = await reads.context.readAdmissionState();
  if (admission.kind === "envelope") return { scope: admission.envelope.scope, admissionState: admission.envelope.data.state, contextRevision: admission.envelope.revision };
  if (admission.kind === "denied") return { scope: NO_AUTHORITY_SCOPE, admissionState: recoveryStateOf(admission.denied.reasonCode), contextRevision: "" };
  return { scope: NO_AUTHORITY_SCOPE, admissionState: "unavailable", contextRevision: "" };
}
async function readContextAdmissions(): Promise<readonly AdmittedContext[]> {
  const chooser = await reads.context.readContextChooser();
  if (chooser.kind !== "envelope") return NO_ADMISSIONS;
  return chooser.envelope.data.groups.flatMap((group) => group.ministries.map((ministry) => ({ organizationId: group.organizationId, organizationLabel: group.organizationLabel, ministryId: ministry.ministryId, ministryLabel: ministry.ministryLabel, supportSubjectId: ministry.supportSubjectId })));
}
/** The root segment layout. */ export default async function RootLayout({ children }: { readonly children: ReactNode }): Promise<ReactElement> {
  const [{ scope, admissionState, contextRevision }, contextAdmissions] = await Promise.all([readShellAdmission(), readContextAdmissions()]);
  const developmentControls = isDevelopment();
  return (
    <html lang="en" dir={INTERFACE_DIRECTION} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_HYDRATION_SCRIPT }} />
      </head>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <DirectionProvider direction={INTERFACE_DIRECTION}>
          <ViewerPreferencesProvider>
            <ShellFrame scope={scope} admissionState={admissionState} contextAdmissions={contextAdmissions} contextRevision={contextRevision} developmentRegion={developmentControls ? <DevControls scope={scope} developmentControls={developmentControls} /> : undefined}>
              {children}
            </ShellFrame>
          </ViewerPreferencesProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
