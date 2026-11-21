import type { ComponentPropsWithoutRef } from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/cn";
/** The closed set of simulated external effects: one member per boundary that would leave the application in production. */
export type SimulatedEffect = "mail-submission" | "publication-reach" | "giving-destination" | "importer-safety" | "media-preparation";
/** The exact sentence each simulated boundary states, in the specification's own words (AAP 0.7.2). */
export const SIMULATION_LABELS = Object.freeze({
  "mail-submission": "simulated — no mail leaves this application",
  "publication-reach": "simulated publication; reach is demonstrated in the receiving preview",
  "giving-destination": "simulated giving destination; no payment is taken",
  "importer-safety": "synthetic files only; a successful local parse is not a safety qualification",
  "media-preparation": "local processing; not production scanning or transcoding",
} as const satisfies Record<SimulatedEffect, string>);
export type SimulationLabelContext = "inline" | "block";
export interface SimulationLabelProps extends Omit<ComponentPropsWithoutRef<"div">, "children" | "style" | "role" | "hidden" | "aria-hidden" | "aria-live" | "aria-atomic" | "dangerouslySetInnerHTML"> {
  effect: SimulatedEffect;
  context?: SimulationLabelContext;
}
const INLINE_SURFACE = "flex w-fit max-w-full items-start gap-2 rounded-md border border-border bg-background px-2.5 " + "py-1.5 text-start text-sm text-muted-foreground text-pretty wrap-anywhere";
const INLINE_ICON = "mt-0.5 size-4 shrink-0";
const BLOCK_ICON = "size-4 shrink-0";
function labelFor(effect: SimulatedEffect): string {
  if (!Object.hasOwn(SIMULATION_LABELS, effect)) {
    throw new Error(`SimulationLabel received an effect it has no sentence for: "${String(effect)}". ` + "Every simulated boundary must state what did not happen, so add the effect to " + "SIMULATION_LABELS instead of passing a value the interface cannot label.");
  }
  return SIMULATION_LABELS[effect];
}
/** Discloses one simulated external effect: the compact sentence beside the control that triggers it, or the block form on the result that follows. */
export function SimulationLabel({ effect, context = "inline", className, ...rest }: SimulationLabelProps) {
  const sentence = labelFor(effect);
  if (context === "block") {
    return (
      <Alert
        {...rest}
        // A disclosure that states a limitation takes the informational variant and never `destructive`: an alarm-toned sentence would present an honest simulation as a fault.
        variant="default"
        role={undefined}
        data-simulation-effect={effect}
        data-simulation-context="block"
        className={className}
      >
        <Info aria-hidden="true" focusable="false" className={BLOCK_ICON} />
        <AlertDescription>{sentence}</AlertDescription>
      </Alert>
    );
  }
  return (
    <p {...rest} data-slot="simulation-label" data-simulation-effect={effect} data-simulation-context="inline" className={cn(INLINE_SURFACE, className)}>
      <Info aria-hidden="true" focusable="false" className={INLINE_ICON} />
      <span>{sentence}</span>
    </p>
  );
}
export default SimulationLabel;
