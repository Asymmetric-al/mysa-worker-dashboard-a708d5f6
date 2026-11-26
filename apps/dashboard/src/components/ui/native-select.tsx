import * as React from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "lucide-react";
type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" };
const NATIVE_SELECT_CLASS =
  "h-9 w-full min-w-0 appearance-none rounded-4xl border border-input bg-control-surface py-1 pe-8 ps-3 text-base transition-colors duration-150 ease-out outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground hover:bg-control-surface-hover focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-invalid-border aria-invalid:ring-[3px] aria-invalid:ring-invalid-ring data-[size=sm]:h-8 md:text-sm";
const NativeSelect = ({ className, size = "default", ...props }: NativeSelectProps) => (
  <div className={cn("group/native-select relative w-fit has-[select:disabled]:opacity-50", className)} data-slot="native-select-wrapper" data-size={size}>
    <select data-slot="native-select" data-size={size} className={NATIVE_SELECT_CLASS} {...props} />
    <ChevronDownIcon className="pointer-events-none absolute top-1/2 end-3.5 size-4 -translate-y-1/2 text-muted-foreground select-none" aria-hidden="true" data-slot="native-select-icon" />
  </div>
);
const NativeSelectOption = ({ className, ...props }: React.ComponentProps<"option">) => <option data-slot="native-select-option" className={cn("bg-popover text-popover-foreground", className)} {...props} />;
const NativeSelectOptGroup = ({ className, ...props }: React.ComponentProps<"optgroup">) => <optgroup data-slot="native-select-optgroup" className={cn("bg-popover text-popover-foreground", className)} {...props} />;
export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
