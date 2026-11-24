/** The comparator every list order the data service builds is ordered by. */
/** Compares two strings by UTF-16 code unit. */ export function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
