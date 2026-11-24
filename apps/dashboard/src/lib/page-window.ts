/** The window every paged surface asks a read for: the first page is one, and the sizes offered are the application's 50-row default and its 200-row cap. */ export const FIRST_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_CAP = 200;
export const PAGE_SIZE_OPTIONS: readonly number[] = [DEFAULT_PAGE_SIZE, PAGE_SIZE_CAP];
/** The largest offered row size at or below a stated one, so the window a surface asks the read for is a window its own pager can also state. */ export function offeredPageSize(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  let offered = DEFAULT_PAGE_SIZE;
  for (const size of PAGE_SIZE_OPTIONS) if (size <= Math.trunc(requested)) offered = size;
  return offered;
}
