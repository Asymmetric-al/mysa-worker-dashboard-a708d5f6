/**
 * The one admission gate: it resolves this session's admission on the server and renders exactly one surface — the
 * admitted route, the session-state notice for a state that grants nothing, or the inline organization-and-ministry
 * chooser.
 *
 * In scope because the first-release shell opens on admission resolved from the synthetic session, with all four
 * session states plus the no-access recovery state, one admitted ministry opening directly and several offering a
 * chooser (AAP 0.10.1 family 1; AAP 0.9.1 places this under `features/shell/`), and because every journey starts at
 * this surface from `/` (AAP 0.12.1 criteria 2 and 21).
 *
 * The read is the service's own answer and the only one this file trusts: a Server Component calls the named read
 * directly rather than fetching this application's own HTTP endpoint (AAP 0.3.2, AAP 0.15.1), no principal is
 * invented when the session cannot be resolved (AAP 0.7.2), and a refusal stays a refusal rather than becoming an
 * empty screen, a zero or a fixture. The recovery wording and the option list belong to `SessionStateNotice` and
 * `ContextChooser`; this file composes them and states no notice, no option and no copy of its own.
 */
import { Suspense, type ReactElement, type ReactNode } from "react";

import StateNotice from "@/components/state-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { reads, type DenialReason } from "@/modules/data-service";

import ContextChooser from "./context-chooser";
import SessionStateNotice from "./session-state-notice";

export interface AdmissionGateProps {
  /** The route this session is admitted to. It is rendered only where admission states a context to read it under. */
  readonly children: ReactNode;
}

/** The admission read, as the service declares it: an envelope, a refusal, an outage, or a request it does not accept. */
type AdmissionRead = Awaited<ReturnType<typeof reads.context.readAdmissionState>>;

/** The chooser read, on the same four arms. */
type ChooserRead = Awaited<ReturnType<typeof reads.context.readContextChooser>>;

/** The admission payload, taken from the read's own signature rather than declared a second time here. */
type AdmissionEnvelope = Extract<AdmissionRead, { readonly kind: "envelope" }>["envelope"];

/** The chooser envelope, which is what its client region is seeded from so the first paint lists the memberships without a second request. */
type ChooserEnvelope = Extract<ChooserRead, { readonly kind: "envelope" }>["envelope"];

/** The source an outage states, taken from the service's own outcome rather than restated as a parallel shape. */
type OutageSource = Extract<AdmissionRead, { readonly kind: "unavailable" }>["unavailable"]["source"];

/** Every session state that grants nothing: `signed-in` renders the route and never a notice. */
type RecoveryState = Exclude<AdmissionEnvelope["data"]["state"], "signed-in">;

/**
 * The state a refusal is reported as. It is total over the service's closed set of denial reasons, so a reason added
 * there fails to compile here rather than reaching a surface that has no wording for it. The three codes that refuse
 * one record or one capability can never be this read's answer; they are reported as the denied session state so the
 * mapping stays total without claiming a state the service did not state.
 */
const STATE_OF_DENIAL: Readonly<Record<DenialReason, RecoveryState>> = Object.freeze({
  "session-expired": "expired",
  "session-unavailable": "unavailable",
  "no-membership": "no-access",
  "not-admitted": "denied",
  "no-permission": "denied",
  "no-export-permission": "denied",
  "no-protected-grant": "denied",
  "capability-absent": "denied",
});

/** What the gate renders, settled before anything is rendered. */
type GateRegion = { readonly kind: "workspace" } | { readonly kind: "chooser"; readonly initial: ChooserEnvelope } | { readonly kind: "state"; readonly state: RecoveryState; readonly source?: OutageSource } | { readonly kind: "refused" };

const REFUSED_TITLE = "The admission state could not be read";
const REFUSED_DESCRIPTION = "This workspace asked for its admission state with a request the service does not accept, so nothing here states a principal, a context or a record — and nothing was changed, because a read changes nothing.";
const LOADING_ANNOUNCEMENT = "Reading this session's admission, and the memberships it admits, before anything is shown.";
const SKELETON_HEADING_CLASS = "h-6 w-1/3";
const SKELETON_LINE_CLASS = "h-4 w-full";
const SKELETON_SHORT_LINE_CLASS = "h-4 w-2/3";

/** Proves the closed read-result set was handled: an added arm fails to compile at the call rather than reaching a blank surface. */
function unhandledReadResult(result: never): never {
  throw new Error(`AdmissionGate has no surface for the read result ${String(result)}.`);
}

/**
 * The memberships a signed-in session with no context in force may choose between. A single admitted ministry opens
 * directly — the chooser's own `directEntry` answer settles it — so the gate renders the route and offers no option
 * list, and a read that failed states its own honest notice instead of an empty list.
 */
async function chooserRegion(): Promise<GateRegion> {
  const chooser = await reads.context.readContextChooser();
  switch (chooser.kind) {
    case "envelope":
      return chooser.envelope.data.directEntry ? { kind: "workspace" } : { kind: "chooser", initial: chooser.envelope };
    case "denied":
      return { kind: "state", state: STATE_OF_DENIAL[chooser.denied.reasonCode] };
    case "unavailable":
      return { kind: "state", state: "unavailable", source: chooser.unavailable.source };
    case "refused":
      return { kind: "refused" };
    default:
      return unhandledReadResult(chooser);
  }
}

/** The one surface this session's admission states, in the order the answers outrank each other. */
async function resolveRegion(admission: AdmissionRead): Promise<GateRegion> {
  switch (admission.kind) {
    case "envelope": {
      const { state, context } = admission.envelope.data;
      // A state that grants nothing states itself and its guidance, and no principal, membership, count or record.
      if (state !== "signed-in") {
        return { kind: "state", state };
      }
      // Admitted and reading under a context that is already in force: the route renders, and it composes no second gate.
      if (context !== null) {
        return { kind: "workspace" };
      }
      // Admitted, with no context in force yet: the chooser is the only honest surface, because nothing here may pick
      // a ministry on the person's behalf.
      return chooserRegion();
    }
    case "denied":
      return { kind: "state", state: STATE_OF_DENIAL[admission.denied.reasonCode] };
    case "unavailable":
      return { kind: "state", state: "unavailable", source: admission.unavailable.source };
    case "refused":
      return { kind: "refused" };
    default:
      return unhandledReadResult(admission);
  }
}

/** A neutral placeholder: three skeleton lines, never an empty screen and never anything that reads as a refusal. */
function AdmissionGateSkeleton(): ReactElement {
  // `output` is the progress-state element, so the placeholder is announced as busy without a role attribute restating what the element already means.
  return (
    <output aria-busy={true} className="flex min-w-0 flex-col gap-3">
      <span className="sr-only">{LOADING_ANNOUNCEMENT}</span>
      <Skeleton className={SKELETON_HEADING_CLASS} />
      <Skeleton className={SKELETON_LINE_CLASS} />
      <Skeleton className={SKELETON_SHORT_LINE_CLASS} />
    </output>
  );
}

/** The chosen surface. The gate adds no landmark of its own: the shell owns the single `main`. */
function GateContent({ region, children }: { readonly region: GateRegion; readonly children: ReactNode }): ReactElement {
  switch (region.kind) {
    case "workspace":
      return <>{children}</>;
    case "chooser":
      // The chooser states its own region heading, so the gate adds no second heading above the option list.
      return <ContextChooser initial={region.initial} presentation="inline" />;
    case "state":
      // A gate that replaces the route opens the page's heading outline, so the notice carries its first-level heading.
      return region.source === undefined ? <SessionStateNotice state={region.state} intent="open-workspace" headingLevel={1} /> : <SessionStateNotice state={region.state} intent="open-workspace" source={region.source} headingLevel={1} />;
    case "refused":
      return <StateNotice kind="refused" title={REFUSED_TITLE} description={REFUSED_DESCRIPTION} headingLevel={1} />;
  }
}

/** Resolves this session's admission and renders exactly one of the admitted route, the session-state notice or the inline chooser. */
export async function AdmissionGate({ children }: AdmissionGateProps): Promise<ReactElement> {
  // The service's own read, in process: no HTTP request is made to this application for what it can read directly,
  // and the session resolver refuses an unknown session rather than inventing a principal to open the route with.
  const region = await resolveRegion(await reads.context.readAdmissionState());
  return (
    <Suspense fallback={<AdmissionGateSkeleton />}>
      <GateContent region={region}>{children}</GateContent>
    </Suspense>
  );
}

export default AdmissionGate;
