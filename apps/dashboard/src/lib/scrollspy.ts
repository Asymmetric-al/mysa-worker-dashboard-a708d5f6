/** Pure, deterministic ReUI Scrollspy helper for selecting the active section ID without visual flicker. */

export type ScrollspyVisibility = {
  readonly id: string;
  readonly isIntersecting: boolean;
  readonly top: number;
};

/**
 * Picks the active section ID given a list of ordered section visibility observations.
 * - Prefers the first intersecting section closest to the top of the viewport.
 * - If nothing currently intersects (e.g., scrolled past a short section), picks the last section whose `top` passed above the activation line.
 * - Falls back cleanly to `fallbackId` (typically the first section).
 */
export function pickActiveSectionId(
  orderedIds: readonly string[],
  observations: ReadonlyMap<string, ScrollspyVisibility>,
  fallbackId: string,
  activationOffsetPx = 120,
): string {
  if (orderedIds.length === 0) return fallbackId;

  let bestIntersecting: ScrollspyVisibility | undefined;
  for (const id of orderedIds) {
    const entry = observations.get(id);
    if (entry === undefined || !entry.isIntersecting) continue;
    if (bestIntersecting === undefined || Math.abs(entry.top - activationOffsetPx) < Math.abs(bestIntersecting.top - activationOffsetPx)) {
      bestIntersecting = entry;
    }
  }
  if (bestIntersecting !== undefined) return bestIntersecting.id;

  let lastAbove: string | undefined;
  for (const id of orderedIds) {
    const entry = observations.get(id);
    if (entry !== undefined && entry.top <= activationOffsetPx) {
      lastAbove = entry.id;
    }
  }
  return lastAbove ?? orderedIds[0] ?? fallbackId;
}
