"use client";
import { createContext, useContext, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";
import { isDevelopment } from "@/lib/guards";
/** Raised in a development build when one `ScrollRegion` is rendered inside another. */
export const SCROLL_REGION_NESTING_ERROR = "ScrollRegion cannot be nested inside another ScrollRegion";

const DEFAULT_STICKY_OFFSET = "var(--app-shell-sticky-offset, 4rem)";

const ScrollRegionContext = createContext<string | null>(null);
/** Props of {@link ScrollRegion}. */
export interface ScrollRegionProps extends Omit<ComponentPropsWithoutRef<"div">, "role" | "aria-label" | "tabIndex"> {
  label: string;
  stickyOffset?: string;
  maxHeight?: string;
  focusable?: boolean;
}
/** The only horizontal scroll container in the application. */
export function ScrollRegion({ label, children, stickyOffset = DEFAULT_STICKY_OFFSET, maxHeight, focusable = true, className, style, ...rest }: ScrollRegionProps) {
  const enclosingLabel = useContext(ScrollRegionContext);
  // Development reports the nesting rather than silently rendering two scroll ports; a
  // production build renders the region, because a duplicated wrapper must not take a
  // worker's page down. The question is asked of `@/lib/guards`, the application's one
  // development gate, so a change to what counts as a development build reaches this
  // component too instead of leaving a second copy of the comparison behind.
  if (isDevelopment() && enclosingLabel !== null) {
    throw new Error(
      `${SCROLL_REGION_NESTING_ERROR}: "${label}" is rendered inside "${enclosingLabel}". ` +
        "Keep the outermost region and remove the inner wrapper, so the content has exactly " +
        "one horizontally scrollable region.",
    );
  }
  return (
    <ScrollRegionContext.Provider value={label}>
      <section
        {...rest}
        aria-label={label}
        tabIndex={focusable ? 0 : undefined}
        // `overflow-x-auto` alone: a scroll port whose vertical axis is not visible, so
        // the region can still grow with its content and never swallows the page's own
        // vertical gesture. `maxHeight` is the one case that adds the vertical scroll, and
        // `scroll-px-2` keeps a scrolled-to cell off the region's inline edges without
        // introducing any physical margin.
        className={cn(
          "overflow-x-auto overscroll-x-contain scroll-px-2",
          maxHeight === undefined ? null : "overflow-y-auto",
          focusable ? "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]" : null,
          className,
        )}
        style={{
          scrollPaddingTop: stickyOffset,
          ...(maxHeight === undefined ? {} : { maxHeight }),
          ...style,
        }}
      >
        {children}
      </section>
    </ScrollRegionContext.Provider>
  );
}
export default ScrollRegion;
