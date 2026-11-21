"use client";

import { createContext, useContext, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";
import { isDevelopment } from "@/lib/guards";

/**
 * Raised in a development build when one `ScrollRegion` is rendered inside another.
 *
 * The release allows exactly one horizontally scrollable region per surface, because two
 * nested scrollers make the same content reachable in two coordinate systems and leave a
 * keyboard user scrolling an inner box inside an outer box. A feature that wraps a table
 * which already brings its own region is the defect this guard reports.
 */
export const SCROLL_REGION_NESTING_ERROR =
  "ScrollRegion cannot be nested inside another ScrollRegion";

/**
 * The height the sticky application shell occupies above a surface, used when the caller
 * does not state the offset itself. The shell publishes `--app-shell-sticky-offset`; the
 * fallback keeps `scroll-padding` meaningful on a surface rendered without the shell (a
 * print view, a standalone preview) instead of collapsing it to zero.
 */
const DEFAULT_STICKY_OFFSET = "var(--app-shell-sticky-offset, 4rem)";

/** The accessible name of the enclosing region, or `null` at the top of a surface. */
const ScrollRegionContext = createContext<string | null>(null);

/** Props of {@link ScrollRegion}. */
export interface ScrollRegionProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "role" | "aria-label" | "tabIndex"
> {
  /**
   * The region's accessible name, and the landmark a screen-reader user hears when
   * navigating by region — for example "Gifts ledger, scrollable". Required: an
   * unlabelled scroll region cannot be identified, so it cannot compile.
   */
  label: string;
  /**
   * The height the sticky shell or the table's own sticky header occupies, applied as
   * `scroll-padding-top` so a focused cell is never hidden beneath it (WCAG 2.2 2.4.11).
   * Any CSS length is accepted, including a `var()` reference to a shell token.
   */
  stickyOffset?: string;
  /**
   * A maximum height, after which the region also scrolls vertically. Omitted, the region
   * only scrolls sideways and never traps a vertical gesture meant for the page.
   */
  maxHeight?: string;
  /**
   * Whether the region takes focus, which is what lets it be scrolled by keyboard
   * (`tabIndex={0}`). Pass `false` only where an inner element is already the focus target
   * and the content cannot overflow sideways.
   */
  focusable?: boolean;
}

/**
 * The only horizontal scroll container in the application.
 *
 * Every wide surface — the Gifts ledger, the commitments table, the partner-by-month
 * matrix, a chart's data-table alternative, per-item result rows — puts its table inside
 * this region and declares no `overflow-x` of its own, so the page never scrolls
 * horizontally (WCAG 1.4.10 Reflow) and a wide table is still reachable by keyboard, wheel
 * and touch without a drag gesture (2.5.7). Focus is never obscured by a sticky header
 * because the padding that `scroll-padding` supplies is what the browser scrolls against
 * (2.4.11).
 *
 * Holds no state, fetches nothing and computes no total: it receives already-processed
 * content and adds only the scrolling behaviour and its accessible name.
 */
export function ScrollRegion({
  label,
  children,
  stickyOffset = DEFAULT_STICKY_OFFSET,
  maxHeight,
  focusable = true,
  className,
  style,
  ...rest
}: ScrollRegionProps) {
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
          focusable
            ? "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
            : null,
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
