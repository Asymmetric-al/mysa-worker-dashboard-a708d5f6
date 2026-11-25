"use client";
import * as React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  // Default to static non-animated markup during SSR so initial HTML never flashes
  // `opacity: 0` before hydration and reduced-motion clients never mount `<motion.*>` nodes.
  return true;
}

/**
 * SSR-safe media-query hook for `(prefers-reduced-motion: reduce)`.
 * Avoids `motion/react`'s dev-only console warning while staying reactive to OS/browser preference changes.
 */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}
