"use client";
import { createContext, useContext, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";
import { isDevelopment } from "@/lib/guards";
/** Raised in a development build when one `ScrollRegion` is rendered inside another. */
export const SCROLL_REGION_NESTING_ERROR = "ScrollRegion cannot be nested inside another ScrollRegion";
const DEFAULT_STICKY_OFFSET = "var(--app-shell-sticky-offset, 4rem)";
const ScrollRegionContext = createContext<string | null>(null);
// `role` is omitted from the props on purpose: a scroll region's role belongs to the one wrapper every wide table uses, so
// no caller can render a port that scrolls without saying it is one.
export interface ScrollRegionProps extends Omit<ComponentPropsWithoutRef<"div">, "role" | "aria-label" | "tabIndex"> {
  label: string;
  stickyOffset?: string;
  maxHeight?: string;
  focusable?: boolean;
}
/** The only horizontal scroll container in the application. */
export function ScrollRegion({ label, children, stickyOffset = DEFAULT_STICKY_OFFSET, maxHeight, focusable = true, className, style, ...rest }: ScrollRegionProps) {
  const enclosingLabel = useContext(ScrollRegionContext);
  // Development reports the nesting rather than rendering two scroll ports; a production build still renders the region. The question is asked of `@/lib/guards`, the one development gate, so the comparison is not copied here.
  if (isDevelopment() && enclosingLabel !== null) {
    throw new Error(`${SCROLL_REGION_NESTING_ERROR}: "${label}" is rendered inside "${enclosingLabel}". ` + "Keep the outermost region and remove the inner wrapper, so the content has exactly " + "one horizontally scrollable region.");
  }
  return (
    <ScrollRegionContext.Provider value={label}>
      <section
        {...rest}
        // The role is carried by the element, not repeated as an attribute: a named `section` is the region, the
        // accessibility tree reports it as one, and `jsx-a11y/no-redundant-roles` refuses a restatement of it here.
        aria-label={label}
        tabIndex={focusable ? 0 : undefined}
        // `overflow-x-auto` alone keeps the vertical axis visible so the region never swallows the page's own gesture; `relative` makes it the only scroll port, because a wide table's absolutely-positioned `sr-only` text would otherwise resolve above it and stretch the document itself.
        className={cn("relative overflow-x-auto overscroll-x-contain scroll-px-2", maxHeight === undefined ? null : "overflow-y-auto", focusable ? "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]" : null, className)}
        style={{ scrollPaddingTop: stickyOffset, ...(maxHeight === undefined ? {} : { maxHeight }), ...style }}
      >
        {children}
      </section>
    </ScrollRegionContext.Provider>
  );
}
export default ScrollRegion;
