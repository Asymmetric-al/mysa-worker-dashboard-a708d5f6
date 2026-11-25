import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/** Semantic icon container adapted from ReUI IconTile (`@reui/icon-tile`) for the Maia Zinc palette. */
const iconTileVariants = cva("inline-flex shrink-0 items-center justify-center border transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0", {
  variants: {
    variant: {
      outline: "border-border bg-card text-foreground shadow-xs",
      soft: "border-border/70 bg-muted text-foreground",
      solid: "border-primary bg-primary text-primary-foreground shadow-xs",
      positive: "border-positive/30 bg-positive-soft text-foreground",
      warning: "border-warning/35 bg-warning-soft text-foreground",
      destructive: "border-destructive/30 bg-destructive-soft text-foreground",
      info: "border-info/30 bg-info-soft text-foreground",
    },
    size: { xs: "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5", sm: "size-8 rounded-lg [&_svg:not([class*='size-'])]:size-4", md: "size-9 rounded-xl [&_svg:not([class*='size-'])]:size-4", lg: "size-10 rounded-xl [&_svg:not([class*='size-'])]:size-5" },
  },
  defaultVariants: { variant: "soft", size: "md" },
});

export type IconTileProps = React.ComponentProps<"span"> & VariantProps<typeof iconTileVariants>;

function IconTile({ className, variant, size, ...props }: IconTileProps) {
  return <span data-slot="icon-tile" aria-hidden="true" className={cn(iconTileVariants({ variant, size }), className)} {...props} />;
}

export { IconTile, iconTileVariants };
