"use client";
import * as React from "react";
import { cn } from "@/lib/cn";

export type SpotlightCardProps = React.ComponentProps<"div">;

/**
 * React Bits-inspired `SpotlightCard` built purely with CSS tokens (`.spotlight-surface` in `globals.css`).
 * Zero raw hex colors, inert on touch devices (`@media (hover: hover)`), and disabled under `prefers-reduced-motion: reduce`.
 */
export function SpotlightCard({ className, onPointerMove, ...props }: SpotlightCardProps) {
  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse") {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--spotlight-x", `${String(Math.round(event.clientX - rect.left))}px`);
        event.currentTarget.style.setProperty("--spotlight-y", `${String(Math.round(event.clientY - rect.top))}px`);
      }
      onPointerMove?.(event);
    },
    [onPointerMove],
  );

  return <div data-slot="spotlight-card" onPointerMove={handlePointerMove} className={cn("spotlight-surface", className)} {...props} />;
}

export default SpotlightCard;
