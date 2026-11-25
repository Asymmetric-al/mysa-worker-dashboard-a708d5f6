import * as React from "react";
import { cn } from "@/lib/cn";

export type EmptyIllustrationVariant = "inbox" | "filter" | "document" | "ledger";

export type EmptyIllustrationProps = {
  readonly variant?: EmptyIllustrationVariant;
  readonly className?: string;
};

/**
 * Token-themed minimalist geometric empty-state illustration inspired by Shadcn Studio `illustrations` & ReUI `empty-state`.
 * Renders purely with `currentColor` + CSS token utility classes (zero raw hex/rgba/oklch literals).
 */
export function EmptyIllustration({ variant = "inbox", className }: EmptyIllustrationProps) {
  return (
    <div data-slot="empty-illustration" data-variant={variant} aria-hidden="true" className={cn("relative flex size-16 items-center justify-center rounded-2xl border border-border/80 bg-surface-subtle text-muted-foreground shadow-2xs", className)}>
      <svg viewBox="0 0 64 64" fill="none" className="size-12">
        <rect x="10" y="14" width="44" height="36" rx="8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45" />
        {variant === "filter" ? (
          <>
            <path d="M18 24H46L36 35V43L28 40V35L18 24Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
            <circle cx="44" cy="20" r="3" fill="currentColor" fillOpacity="0.35" />
          </>
        ) : variant === "document" ? (
          <>
            <path d="M22 24H42M22 32H38M22 40H32" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <rect x="38" y="37" width="6" height="6" rx="1.5" fill="currentColor" fillOpacity="0.35" />
          </>
        ) : variant === "ledger" ? (
          <>
            <path d="M18 26H46M18 34H46M28 20V44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.7" />
            <circle cx="38" cy="39" r="3" fill="currentColor" fillOpacity="0.4" />
          </>
        ) : (
          <>
            <path d="M14 35H24L27 40H37L40 35H50" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 25H40" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeOpacity="0.6" />
          </>
        )}
      </svg>
    </div>
  );
}

export default EmptyIllustration;
