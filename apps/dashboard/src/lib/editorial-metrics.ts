/** Pure, framework-free helpers for public editorial reading metrics and scroll progress. */

const TAG_PATTERN = /<[^>]+>/gu;
const ENTITY_PATTERN = /&(?:nbsp|amp|lt|gt|quot|#39|#x27);/gu;
const WORDS_PER_MINUTE = 200;

/** Extracts normalised plain words from sanitised server-rendered HTML for word-count and read-time estimation. */
export function extractPlainTextFromHtml(html: string): string {
  return html
    .replace(TAG_PATTERN, " ")
    .replace(ENTITY_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Counts words across Latin, Arabic, Hebrew, CJK, and mixed Unicode scripts cleanly. */
export function countEditorialWords(html: string): number {
  const plain = extractPlainTextFromHtml(html);
  if (plain === "") return 0;
  return plain.split(/\s+/u).filter((token) => token.length > 0).length;
}

/**
 * Estimates whole reading minutes from rendered HTML (`null` when there is no readable prose).
 * Always rounds up to at least 1 minute when readable text is present.
 */
export function estimateReadingMinutes(html: string): number | null {
  const words = countEditorialWords(html);
  if (words === 0) return null;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** Computes a clamped `0..1` document reading ratio for the GPU-composited hairline progress bar. */
export function computeReadingProgress(scrollY: number, scrollHeight: number, viewportHeight: number): number {
  if (!Number.isFinite(scrollY) || !Number.isFinite(scrollHeight) || !Number.isFinite(viewportHeight)) return 0;
  const scrollable = scrollHeight - viewportHeight;
  if (scrollable <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / scrollable));
}
