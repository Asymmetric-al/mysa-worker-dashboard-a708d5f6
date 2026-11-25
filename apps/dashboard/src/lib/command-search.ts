/** Pure search & ranking utilities shared by the Global Command Palette (`⌘K`) and searchable Help FAQ. */

export type SearchableCommandItem = {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly keywords?: readonly string[];
  readonly href?: string;
  readonly description?: string;
};

/** Normalises user search text for case-insensitive, whitespace-trimmed matching. */
export function normaliseSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/gu, " ");
}

/**
 * Scores one candidate item against a normalised query:
 * - 3: exact or prefix match on label
 * - 2: word-boundary / substring match on label
 * - 1: match in group, description, or keywords
 * - 0: no match
 */
export function scoreSearchItem(item: SearchableCommandItem, rawQuery: string): number {
  const query = normaliseSearchQuery(rawQuery);
  if (query === "") return 1;
  const label = item.label.toLowerCase();
  if (label === query || label.startsWith(query)) return 3;
  if (label.includes(query)) return 2;
  const tokens = query.split(" ");
  const haystack = [label, item.group.toLowerCase(), (item.description ?? "").toLowerCase(), ...(item.keywords ?? []).map((kw) => kw.toLowerCase())].join(" ");
  return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
}

/** Filters and ranks searchable items deterministically (higher score first, preserving original order on ties). */
export function filterAndRankItems<T extends SearchableCommandItem>(items: readonly T[], rawQuery: string): readonly T[] {
  const query = normaliseSearchQuery(rawQuery);
  if (query === "") return items;
  return items
    .map((item, index) => ({ item, index, score: scoreSearchItem(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => (right.score !== left.score ? right.score - left.score : left.index - right.index))
    .map((entry) => entry.item);
}
