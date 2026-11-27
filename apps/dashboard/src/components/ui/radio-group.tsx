"use client";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@/lib/cn";
function RadioGroup({ className, orientation = "vertical", ...props }: RadioGroupPrimitive.Props & { orientation?: "vertical" | "horizontal" }) {
  return <RadioGroupPrimitive data-slot="radio-group" data-orientation={orientation} aria-orientation={orientation} className={cn("group/radio-group w-full", orientation === "horizontal" ? "flex flex-wrap items-center gap-x-6 gap-y-3" : "grid gap-3", className)} {...props} />;
}
const RADIO_ITEM_CLASS =
  "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input bg-control-check-bg outline-none group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-invalid-border aria-invalid:ring-3 aria-invalid:ring-invalid-ring aria-invalid:aria-checked:border-primary data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary";
const RadioGroupItem = ({ className, ...props }: RadioPrimitive.Root.Props) => (
  <RadioPrimitive.Root data-slot="radio-group-item" className={cn(RADIO_ITEM_CLASS, className)} {...props}>
    <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="flex size-4 items-center justify-center">
      <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
    </RadioPrimitive.Indicator>
  </RadioPrimitive.Root>
);
export { RadioGroup, RadioGroupItem };
