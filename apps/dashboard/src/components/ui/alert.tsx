import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
const alertVariants = cva(
  "group/alert relative grid w-full gap-1 rounded-2xl border px-4 py-3.5 text-start text-sm shadow-xs wrap-anywhere has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        destructive: "border-destructive/35 bg-destructive-soft text-foreground *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-destructive",
        warning: "border-warning/40 bg-warning-soft text-foreground *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-warning",
        info: "border-info/35 bg-info-soft text-foreground *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-info",
        positive: "border-positive/35 bg-positive-soft text-foreground *:data-[slot=alert-description]:text-foreground/85 *:[svg]:text-positive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
const Alert = ({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) => <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
const AlertTitle = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="alert-title" className={cn("font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground", className)} {...props} />;
const AlertDescription = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="alert-description" className={cn("text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4", className)} {...props} />;
const AlertAction = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="alert-action" className={cn("absolute top-2.5 end-3", className)} {...props} />;
export { Alert, AlertTitle, AlertDescription, AlertAction, alertVariants };
