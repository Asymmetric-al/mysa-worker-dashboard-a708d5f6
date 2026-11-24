import type { ReactElement } from "react";
import { SimulationLabel } from "@/components/simulation-label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import { copy } from "../copy";
export type GivingDesignationApprovedView = { readonly state: "approved"; readonly designationLabel: string; readonly designationRef: SourceReference; readonly purpose?: string };
export const GIVING_UNAVAILABLE_CAUSES = ["missing", "revoked", "incompatible"] as const;
export type GivingUnavailableCause = (typeof GIVING_UNAVAILABLE_CAUSES)[number];
export type GivingDesignationUnavailableView = { readonly state: "unavailable"; readonly cause: GivingUnavailableCause };
export type GivingBindingView = GivingDesignationApprovedView | GivingDesignationUnavailableView;
export type GivingDesignationLayout = "panel" | "inline";
export type GivingDesignationProps = { readonly binding: GivingBindingView; readonly layout?: GivingDesignationLayout; readonly className?: string };
const GIVING_UNAVAILABLE_DESCRIPTION = [copy.giving.explanation, copy.giving.noFallbackNote, copy.giving.neverZeroNote].join(" ");
/** Every admitted cause states the same reason, so one sentence serves all three and no other fund is ever named in their place. */ const unavailableDescription = (): string => GIVING_UNAVAILABLE_DESCRIPTION;
/** The Give placement, showing either the one approved Designation or why giving is unavailable here. */ export function GivingDesignation({ binding, layout = "panel", className }: GivingDesignationProps): ReactElement {
  if (binding.state === "unavailable") {
    return (
      <div data-slot="giving-designation" data-giving-state="unavailable" data-giving-cause={binding.cause} data-layout={layout} className={cn("flex flex-col gap-2 text-start", className)}>
        <Alert>
          <AlertTitle>
            <h3 className="type-subsection-title">{copy.giving.title}</h3>
          </AlertTitle>
          <AlertDescription>{unavailableDescription()}</AlertDescription>
        </Alert>
        <SimulationLabel effect={copy.giving.simulationKey} />
        <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.giving.previewInertNote}</p>
      </div>
    );
  }
  const purpose = binding.purpose?.trim() ?? "";
  return (
    <Card size={layout === "panel" ? "default" : "sm"} data-giving-state="approved" data-layout={layout} className={cn("text-start", className)}>
      <CardHeader>
        <CardTitle className="wrap-anywhere">
          <bdi>{binding.designationLabel}</bdi>
        </CardTitle>
        <Badge {...{ variant: "secondary" as const, className: "justify-self-start" as const }}>{copy.giving.designationApproved}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{copy.giving.designationLabel}</span>
          <bdi className="mono-identifier wrap-anywhere">{formatSourceReference(binding.designationRef)}</bdi>
        </p>
        {purpose === "" ? null : (
          <p className="type-supporting text-pretty wrap-anywhere">
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
