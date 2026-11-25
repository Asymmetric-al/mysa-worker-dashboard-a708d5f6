/** Pure, framework-free layout and reduced-motion guards shared by UI primitives and covered by Node unit tests. */

/** Clamps a resizable split-pane ratio cleanly within declared percentage bounds. */
export function clampSplitRatio(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Whether `CountUp` must skip animation and snap immediately to its final whole-number figure. */
export function shouldSnapCountUp(value: number, reducedMotion: boolean | null): boolean {
  return reducedMotion === true || !Number.isFinite(value) || value <= 0;
}
