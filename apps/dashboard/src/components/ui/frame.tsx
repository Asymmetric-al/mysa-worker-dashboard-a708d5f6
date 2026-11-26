import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/** Concentric framed surface inspired by ReUI Frame (`@reui/frame`), styled exclusively with Maia Zinc tokens. */
const frameVariants = cva("relative isolate flex min-w-0 flex-col bg-surface-subtle p-1 text-card-foreground border border-border/80 [--frame-radius:var(--radius-2xl)] rounded-(--frame-radius)", {
  variants: {
    variant: { default: "bg-surface-subtle", muted: "bg-muted/50", ghost: "border-transparent bg-transparent p-0" },
    spacing: {
      default: "[&_[data-slot=frame-panel]]:p-5 [&_[data-slot=frame-header]]:px-5 [&_[data-slot=frame-header]]:py-3.5 [&_[data-slot=frame-footer]]:px-5 [&_[data-slot=frame-footer]]:py-3",
      sm: "[&_[data-slot=frame-panel]]:p-4 [&_[data-slot=frame-header]]:px-4 [&_[data-slot=frame-header]]:py-3 [&_[data-slot=frame-footer]]:px-4 [&_[data-slot=frame-footer]]:py-2.5",
      compact: "[&_[data-slot=frame-panel]]:p-3 [&_[data-slot=frame-header]]:px-3.5 [&_[data-slot=frame-header]]:py-2.5 [&_[data-slot=frame-footer]]:px-3.5 [&_[data-slot=frame-footer]]:py-2",
      flush: "[&_[data-slot=frame-panel]]:p-0 [&_[data-slot=frame-header]]:px-4 [&_[data-slot=frame-header]]:py-3 [&_[data-slot=frame-footer]]:px-4 [&_[data-slot=frame-footer]]:py-2.5",
    },
    stacked: { false: "gap-1", true: "gap-0 [&_[data-slot=frame-panel]:not(:first-of-type)]:rounded-t-none [&_[data-slot=frame-panel]:not(:first-of-type)]:border-t-0 [&_[data-slot=frame-panel]:not(:last-of-type)]:rounded-b-none" },
  },
  defaultVariants: { variant: "default", spacing: "default", stacked: false },
});

function Frame({ className, variant, spacing, stacked, ...props }: React.ComponentProps<"div"> & VariantProps<typeof frameVariants>) {
  return <div data-slot="frame" data-variant={variant ?? "default"} className={cn(frameVariants({ variant, spacing, stacked }), className)} {...props} />;
}

function FramePanel({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-panel" className={cn("relative min-w-0 overflow-hidden rounded-[calc(var(--frame-radius)-0.25rem)] border border-border/80 bg-card text-card-foreground shadow-xs", className)} {...props} />;
}

function FrameHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-header" className={cn("flex min-w-0 flex-wrap items-center justify-between gap-2", className)} {...props} />;
}

function FrameTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-title" className={cn("font-heading text-sm font-medium text-foreground", className)} {...props} />;
}

function FrameDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function FrameFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-footer" className={cn("flex min-w-0 flex-wrap items-center justify-between gap-2", className)} {...props} />;
}

export { Frame, FramePanel, FrameHeader, FrameTitle, FrameDescription, FrameFooter, frameVariants };
