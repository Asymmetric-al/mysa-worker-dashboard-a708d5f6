import * as React from "react";
import { cn } from "@/lib/cn";
const CARD_CLASS =
  "group/card isolate flex flex-col gap-(--card-spacing) overflow-hidden rounded-2xl bg-card py-(--card-spacing) text-sm text-card-foreground [--card-spacing:--spacing(6)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl";
type CardVariant = "default" | "muted" | "soft";
/** The muted and soft card roles (inspired by Shadcn Studio `card-08`) keep one surface step and one ring across every route, while default cards carry multi-step elevation. */ const CARD_VARIANT_CLASS: Readonly<Record<CardVariant, string>> = {
  default: "shadow-card",
  muted: "bg-muted/40 shadow-none ring-1 ring-border",
  soft: "bg-surface-subtle shadow-none ring-1 ring-border/80",
};
const Card = ({ className, size = "default", variant = "default", ...props }: React.ComponentProps<"div"> & { size?: "default" | "sm"; variant?: CardVariant }) => <div data-slot="card" data-size={size} data-variant={variant} className={cn(CARD_CLASS, CARD_VARIANT_CLASS[variant], className)} {...props} />;
const CardHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div data-slot="card-header" className={cn("group/card-header @container/card-header grid auto-rows-min items-start gap-2 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)", className)} {...props} />
);
const CardTitle = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="card-title" className={cn("font-heading text-base font-medium", className)} {...props} />;
const CardDescription = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
const CardAction = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />;
const CardContent = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />;
const CardFooter = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="card-footer" className={cn("flex items-center rounded-b-xl px-(--card-spacing) [.border-t]:pt-(--card-spacing)", className)} {...props} />;
export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
