"use client";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/cn";
const SWITCH_CLASS =
  "peer group/switch relative inline-flex shrink-0 touch-manipulation items-center rounded-full border border-transparent transition-colors duration-150 ease-out outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-invalid-border aria-invalid:ring-[3px] aria-invalid:ring-invalid-ring data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] data-checked:bg-primary data-unchecked:bg-switch-unchecked data-disabled:cursor-not-allowed data-disabled:opacity-50";
const Switch = ({ className, size = "default", ...props }: SwitchPrimitive.Root.Props & { size?: "sm" | "default" }) => (
  <SwitchPrimitive.Root data-slot="switch" data-size={size} className={cn(SWITCH_CLASS, className)} {...props}>
    <SwitchPrimitive.Thumb
      data-slot="switch-thumb"
      className="pointer-events-none block rounded-full bg-switch-thumb-unchecked ring-0 transition-transform duration-150 ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 ltr:group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] rtl:group-data-[size=default]/switch:data-checked:-translate-x-[calc(100%-2px)] ltr:group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] rtl:group-data-[size=sm]/switch:data-checked:-translate-x-[calc(100%-2px)] data-checked:bg-switch-thumb-checked group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
    />
  </SwitchPrimitive.Root>
);
export { Switch };
