/**
 * The comparator every list order the data service builds is ordered by.
 *
 * This module imports nothing on purpose: a read that orders rows may use it without depending on a
 * layer above it. A list takes its order from here rather than from a comparator of its own, and
 * never from `localeCompare`, because a locale-aware comparison makes the same list read differently
 * on another machine.
 */

/**
 * Compares two strings by UTF-16 code unit.
 *
 * Ordering by code unit is deliberate. A locale-aware comparison (`localeCompare`) orders the same
 * two values differently on another machine and in another browser, because the order then comes from
 * the platform's collation data and its default locale — so a list must be ordered the same way on
 * the server, in the browser and between two machines, and a code-unit comparison is the only one
 * that holds. Display text is the surface's job: a reader-facing name, a formatted date or a sorted
 * column header belongs where it is rendered, while a stable order is the service's.
 */
export function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
