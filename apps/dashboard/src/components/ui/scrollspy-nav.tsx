"use client";
import * as React from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";
import { pickActiveSectionId, type ScrollspyVisibility } from "@/lib/scrollspy";

export type ScrollspySection = {
  readonly id: string;
  readonly label: string;
};

export type ScrollspyNavProps = {
  readonly label: string;
  readonly sections: readonly ScrollspySection[];
  readonly orientation?: "vertical" | "horizontal";
  readonly className?: string;
};

/**
 * ReUI `@reui/scrollspy`-inspired section tracker backed by `IntersectionObserver`.
 * Tracks the active in-view section with `aria-current="location"`, respects `prefers-reduced-motion`
 * on anchor jumps, and renders either a sticky desktop rail (`vertical`) or compact jump bar (`horizontal`).
 */
export function ScrollspyNav({ label, sections, orientation = "vertical", className }: ScrollspyNavProps) {
  const reducedMotion = usePrefersReducedMotion();
  const orderedIds = React.useMemo(() => sections.map((section) => section.id), [sections]);
  const firstId = orderedIds[0] ?? "";
  const [activeId, setActiveId] = React.useState<string>(firstId);
  const observationsRef = React.useRef<Map<string, ScrollspyVisibility>>(new Map());

  React.useEffect(() => {
    if (orderedIds.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observations = observationsRef.current;
    observations.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (id === "") continue;
          observations.set(id, {
            id,
            isIntersecting: entry.isIntersecting,
            top: entry.boundingClientRect.top,
          });
        }
        setActiveId(pickActiveSectionId(orderedIds, observations, firstId));
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: [0, 0.1, 0.5] },
    );

    for (const id of orderedIds) {
      const target = document.getElementById(id);
      if (target !== null) observer.observe(target);
    }

    return () => {
      observer.disconnect();
    };
  }, [firstId, orderedIds]);

  const handleJump = (event: React.MouseEvent<HTMLAnchorElement>, id: string): void => {
    const target = document.getElementById(id);
    if (target === null) return;
    event.preventDefault();
    setActiveId(id);
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    if (typeof window !== "undefined" && window.history !== undefined) {
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  if (sections.length === 0) return null;

  const isHorizontal = orientation === "horizontal";

  return (
    <nav
      aria-label={label}
      data-slot="scrollspy-nav"
      data-orientation={orientation}
      data-active-section={activeId}
      className={cn(
        isHorizontal
          ? "flex min-w-0 flex-wrap items-center gap-1.5 rounded-2xl border border-border/80 bg-surface-subtle p-1.5"
          : "flex min-w-0 flex-col gap-1 rounded-2xl border border-border/80 bg-surface-subtle p-2",
        className,
      )}
    >
      {sections.map((section) => {
        const active = section.id === activeId;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={active ? "location" : undefined}
            data-active={active ? "true" : "false"}
            onClick={(event) => handleJump(event, section.id)}
            className={cn(
              "inline-flex min-h-8 items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]",
              active
                ? "bg-card text-foreground shadow-xs ring-1 ring-border/80"
                : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
            )}
          >
            {isHorizontal ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-0.5 shrink-0 rounded-full transition-colors",
                  active ? "bg-foreground" : "bg-transparent",
                )}
              />
            )}
            <span className="truncate">
              <bdi>{section.label}</bdi>
            </span>
          </a>
        );
      })}
    </nav>
  );
}

export default ScrollspyNav;
