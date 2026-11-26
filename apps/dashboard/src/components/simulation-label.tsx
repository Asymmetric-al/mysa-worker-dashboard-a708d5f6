import type { ComponentPropsWithoutRef } from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/cn";
/** The closed set of simulated external effects: one member per boundary that would leave the application in production. */ export type SimulatedEffect = "mail-submission" | "publication-reach" | "giving-destination" | "importer-safety" | "media-preparation";
/** Clear, honest disclosure for each simulated boundary. */ export const SIMULATION_LABELS = Object.freeze({
  "mail-submission": "Simulated — no email leaves this workspace.",
  "publication-reach": "Simulated publishing — preview how readers see it in Reader preview.",
  "giving-destination": "Simulated giving link — no payment is taken.",
  "importer-safety": "Sample import only — files are parsed locally and not virus-scanned.",
  "media-preparation": "Processed locally — not production media scanning or transcoding.",
} as const satisfies Record<SimulatedEffect, string>);
export type SimulationLabelContext = "inline" | "block";
export type SimulationLabelProps = Omit<ComponentPropsWithoutRef<"div">, "children" | "style" | "role" | "hidden" | "aria-hidden" | "aria-live" | "aria-atomic" | "dangerouslySetInnerHTML"> & { effect: SimulatedEffect; context?: SimulationLabelContext };
const INLINE_SURFACE = "flex w-fit max-w-full items-start gap-2 rounded-xl border border-border/80 bg-surface-subtle px-3 " + "py-1.5 type-supporting text-start text-pretty wrap-anywhere";
function labelFor(effect: SimulatedEffect): string {
  if (!Object.hasOwn(SIMULATION_LABELS, effect)) throw new Error(`SimulationLabel received an effect it has no sentence for: "${String(effect)}". ` + "Every simulated boundary must state what did not happen, so add the effect to " + "SIMULATION_LABELS instead of passing a value the interface cannot label.");
  return SIMULATION_LABELS[effect];
}
/** Discloses one simulated external effect: the compact sentence beside the control that triggers it, or the block form on the result that follows. */ export function SimulationLabel({ effect, context = "inline", className, ...rest }: SimulationLabelProps) {
  const sentence = labelFor(effect);
  if (context === "block") {
    return (
      <Alert {...rest} variant="default" role={undefined} data-simulation-effect={effect} data-simulation-context="block" className={className}>
        <Info aria-hidden="true" focusable="false" className={"size-4 shrink-0"} />
        <AlertDescription>{sentence}</AlertDescription>
      </Alert>
    );
  }
  return (
    <p {...rest} data-slot="simulation-label" data-simulation-effect={effect} data-simulation-context="inline" className={cn(INLINE_SURFACE, className)}>
      <Info aria-hidden="true" focusable="false" className={"mt-0.5 size-4 shrink-0"} />
      <span>{sentence}</span>
    </p>
  );
}
export default SimulationLabel;
