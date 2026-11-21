/**
 * The one Give placement of a Worker or Project Page: the single Designation a release is approved to
 * show, or the honest statement that giving is unavailable at this placement.
 */
import type { ReactElement } from "react";
import { SimulationLabel } from "@/components/simulation-label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import { copy } from "../copy";
/** The approved half of what a give placement receives: the one Designation the release may show. */
export interface GivingDesignationApprovedView {
  readonly state: "approved";
  readonly designationLabel: string;
  readonly designationRef: SourceReference;
  readonly purpose?: string;
}
/** The closed set of reasons a release can show no giving at all. */
export const GIVING_UNAVAILABLE_CAUSES = ["missing", "revoked", "incompatible"] as const;
/** Why a placement can show no giving: nothing approved, approval withdrawn, or the wrong placement. */
export type GivingUnavailableCause = (typeof GIVING_UNAVAILABLE_CAUSES)[number];
/** The unavailable half of what a give placement receives. */
export interface GivingDesignationUnavailableView {
  readonly state: "unavailable";
  readonly cause: GivingUnavailableCause;
}
/** What the read envelope carries for a give placement. */
export type GivingBindingView = GivingDesignationApprovedView | GivingDesignationUnavailableView;
/** Where the placement sits. */
export type GivingDesignationLayout = "panel" | "inline";
/** Props of {@link GivingDesignation}. */
export interface GivingDesignationProps {
  readonly binding: GivingBindingView;
  readonly layout?: GivingDesignationLayout;
  readonly className?: string;
}
const GIVING_UNAVAILABLE_DESCRIPTION = [copy.giving.explanation, copy.giving.noFallbackNote, copy.giving.neverZeroNote].join(" ");

function unavailableDescription(cause: GivingUnavailableCause): string {
  switch (cause) {
    case "missing":
    case "revoked":
    case "incompatible":
      return GIVING_UNAVAILABLE_DESCRIPTION;
    default: {
      const unhandled: never = cause;
      return unhandled;
    }
  }
}
/** The Give placement, showing either the one approved Designation or why giving is unavailable here. */
export function GivingDesignation({ binding, layout = "panel", className }: GivingDesignationProps): ReactElement {
  if (binding.state === "unavailable") {
    // A missing, revoked or incompatible Designation is a stated absence, not a failed read: the source
    // answered, so this state never borrows the source-outage notice's "could not be read" body.
    return (
      <div data-slot="giving-designation" data-giving-state="unavailable" data-giving-cause={binding.cause} data-layout={layout} className={cn("flex flex-col gap-2 text-start", className)}>
        <Alert>
          <AlertTitle>
            <h3 className="font-medium">{copy.giving.title}</h3>
          </AlertTitle>
          <AlertDescription>{unavailableDescription(binding.cause)}</AlertDescription>
        </Alert>
        <SimulationLabel effect={copy.giving.simulationKey} />
        <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.giving.previewInertNote}</p>
      </div>
    );
  }
  // A purpose the source left empty has said nothing, so it renders no paragraph at all rather than an
  // empty line that a reader would read as a purpose the source declined to state.
  const purpose = binding.purpose?.trim() ?? "";
  return (
    <Card size={layout === "panel" ? "default" : "sm"} data-giving-state="approved" data-layout={layout} className={cn("text-start", className)}>
      <CardHeader>
        <CardTitle className="wrap-anywhere">
          <bdi>{binding.designationLabel}</bdi>
        </CardTitle>
        {/*
          The approved word sits on its own line under the Designation rather than beside it: the
          badge is a single-line pill, and a header that shares one row with it squeezes the name into
          breaks inside words at 320 CSS px. Stacked, the name keeps the card's full width and the
          state word still sits beside the thing it describes.
        */}
        <Badge variant="secondary" className="justify-self-start">
          {copy.giving.designationApproved}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{copy.giving.designationLabel}</span>
          {/*
            The identity renders inside `<bdi>` with the identifier utility so a mixed-direction
            neighbour cannot reorder it and a leading zero in the reference survives exactly.
          */}
          <bdi className="mono-identifier wrap-anywhere">{formatSourceReference(binding.designationRef)}</bdi>
        </p>
        {purpose === "" ? null : (
          <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
            <bdi>{purpose}</bdi>
          </p>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-2">
        <SimulationLabel effect={copy.giving.simulationKey} />
        <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.giving.previewInertNote}</p>
      </CardFooter>
    </Card>
  );
}
export default GivingDesignation;
