import * as React from "react";
import { cn } from "@/lib/cn";

/** Crisp Maia Zinc keycap (`<kbd>`) styled consistently across shortcuts, command palette, and editor hints. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "mono-identifier inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border/90 bg-muted px-1.5 text-xs font-medium text-foreground shadow-2xs select-none",
        className,
      )}
      {...props}
    />
  );
}

/** Groups multiple `<Kbd>` elements cleanly with subtle separation. */
export function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}
