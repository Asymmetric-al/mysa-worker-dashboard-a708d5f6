"use client";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-4xl text-sm font-medium whitespace-nowrap transition-colors duration-150 ease-out outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-invalid-border aria-invalid:ring-invalid-ring aria-pressed:bg-highlight aria-pressed:text-highlight-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: { default: "bg-transparent", outline: "border border-input bg-transparent hover:bg-muted" },
      size: { default: "h-9 min-w-9 px-3 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5", sm: "h-8 min-w-8 px-3 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2", lg: "h-10 min-w-10 px-4 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
const Toggle = ({ className, variant = "default", size = "default", ...props }: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) => <TogglePrimitive data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />;
export { Toggle, toggleVariants };
