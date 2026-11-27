import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit max-w-full shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-4xl border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 ease-out focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 aria-invalid:border-invalid-border aria-invalid:ring-invalid-ring [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/85",
        secondary: "border-border/60 bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-destructive text-destructive-foreground [a]:hover:bg-destructive-hover",
        outline: "border-border bg-card text-foreground [a]:hover:bg-muted",
        ghost: "hover:bg-ghost-hover hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        "positive-light": "border-positive/35 bg-positive-soft text-foreground",
        "warning-light": "border-warning/40 bg-warning-soft text-foreground",
        "destructive-light": "border-destructive/35 bg-destructive-soft text-foreground",
        "info-light": "border-info/35 bg-info-soft text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
const Badge = ({ className, variant = "default", render, ...props }: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) => useRender({ defaultTagName: "span", props: mergeProps<"span">({ className: cn(badgeVariants({ variant }), className) }, props), render, state: { slot: "badge", variant } });
export { Badge, badgeVariants };
