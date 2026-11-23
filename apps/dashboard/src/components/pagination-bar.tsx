"use client";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [50, 200];
const SMALLEST_DEFAULT_PAGE_SIZE = 50;
const LARGEST_DEFAULT_PAGE_SIZE = 200;
const PAGE_WINDOW_LIMIT = 7;
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
type PageToken = number | "gap";
/** Props of {@link PaginationBar}. */
export type PaginationBarProps = { total: number; page: number; pageSize: number; pageSizeOptions?: readonly number[]; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void; itemNoun: string; disabled?: boolean; className?: string };
/** The only paging control in the application. */
export function PaginationBar({ total, page, pageSize, pageSizeOptions, onPageChange, onPageSizeChange, itemNoun, disabled = false, className }: PaginationBarProps) {
  const pageSizeFieldId = useId();
  const totalCount = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const options = normalisePageSizeOptions(pageSizeOptions);
  const currentPageSize = clampPageSize(pageSize, options);
  const pageCount = pageCountFor(totalCount, currentPageSize);
  const currentPage = clampPage(page, pageCount);
  const firstRow = totalCount === 0 ? 0 : (currentPage - 1) * currentPageSize + 1;
  const lastRow = Math.min(currentPage * currentPageSize, totalCount);
  const countText = totalCount === 0 ? `No ${itemNoun}` : `Showing ${countFormat.format(firstRow)}\u2013${countFormat.format(lastRow)} of ${countFormat.format(totalCount)} ${itemNoun}`;
  function requestPage(requested: number): void {
    if (disabled) return;
    const nextPage = clampPage(requested, pageCount);
    if (nextPage === currentPage) return;
    onPageChange(nextPage);
  }
  function requestPageSize(requested: number): void {
    if (disabled) return;
    const nextPageSize = clampPageSize(requested, options);
    if (nextPageSize === currentPageSize) return;
    const firstVisibleRow = (currentPage - 1) * currentPageSize;
    const nextPage = clampPage(Math.trunc(firstVisibleRow / nextPageSize) + 1, pageCountFor(totalCount, nextPageSize));
    onPageSizeChange(nextPageSize);
    if (nextPage !== currentPage) onPageChange(nextPage);
  }
  return (
    <div data-slot="pagination-bar" className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", className)}>
      <output className="tabular-figures text-sm text-muted-foreground">
        {countText}
        {disabled ? <span className="sr-only"> Updating results.</span> : null}
      </output>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {totalCount > 0 ? (
          <div className="flex items-center gap-2">
            <Label htmlFor={pageSizeFieldId} className="text-muted-foreground">
              Rows per page
            </Label>
            <NativeSelect id={pageSizeFieldId} size="sm" className="w-20" value={String(currentPageSize)} disabled={disabled} onChange={(event) => requestPageSize(Number(event.currentTarget.value))}>
              {options.map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {countFormat.format(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {pageCount > 1 ? (
          <Pagination aria-label={`Pagination, ${itemNoun}`} aria-busy={disabled || undefined} className="mx-0 w-auto">
            <PaginationContent className="flex-wrap justify-center">
              <PaginationItem>
                <PaginationLink size="default" className="ps-2.5" aria-label={`Previous page of ${itemNoun}`} aria-disabled={currentPage === 1 || disabled || undefined} onClick={() => requestPage(currentPage - 1)}>
                  <DirectionalChevron direction="previous" />
                  <span className="hidden sm:inline">Previous</span>
                </PaginationLink>
              </PaginationItem>
              {pageWindow(currentPage, pageCount).map((token, index) =>
                token === "gap" ? (
                  <PaginationItem key={`gap-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={token}>
                    <PaginationLink isActive={token === currentPage} aria-label={`Page ${countFormat.format(token)} of ${countFormat.format(pageCount)}`} aria-disabled={disabled || undefined} onClick={() => requestPage(token)}>
                      {countFormat.format(token)}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationLink size="default" className="pe-2.5" aria-label={`Next page of ${itemNoun}`} aria-disabled={currentPage === pageCount || disabled || undefined} onClick={() => requestPage(currentPage + 1)}>
                  <span className="hidden sm:inline">Next</span>
                  <DirectionalChevron direction="next" />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </div>
    </div>
  );
}
function DirectionalChevron({ direction }: { direction: "previous" | "next" }) {
  const pointsLeft = direction === "previous";
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4" data-icon={pointsLeft ? "inline-start" : "inline-end"}>
      <path d={pointsLeft ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} className="rtl:hidden" />
      <path d={pointsLeft ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"} className="hidden rtl:block" />
    </svg>
  );
}
function normalisePageSizeOptions(options: readonly number[] | undefined): number[] {
  const source = options ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const usable = source.filter((size) => Number.isInteger(size) && size > 0);
  const unique = [...new Set(usable)].sort((left, right) => left - right);
  return unique.length > 0 ? unique : [...DEFAULT_PAGE_SIZE_OPTIONS];
}
function clampPageSize(requested: number, options: readonly number[]): number {
  const smallest = options[0] ?? SMALLEST_DEFAULT_PAGE_SIZE;
  const largest = options[options.length - 1] ?? LARGEST_DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(requested)) return smallest;
  const size = Math.trunc(requested);
  if (size <= smallest) return smallest;
  if (size >= largest) return largest;
  let offered = smallest;
  for (const option of options) if (option <= size) offered = option;
  return offered;
}
function pageCountFor(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
function clampPage(requested: number, pageCount: number): number {
  if (!Number.isFinite(requested)) return 1;
  const page = Math.trunc(requested);
  if (page <= 1) return 1;
  return page >= pageCount ? pageCount : page;
}
function pageWindow(current: number, pageCount: number): PageToken[] {
  const tokens: PageToken[] = [];
  if (pageCount <= PAGE_WINDOW_LIMIT) {
    for (let page = 1; page <= pageCount; page += 1) tokens.push(page);
    return tokens;
  }
  const candidates = [...new Set([1, pageCount, current - 1, current, current + 1])].filter((page) => page >= 1 && page <= pageCount).sort((left, right) => left - right);
  let previous = 0;
  for (const page of candidates) {
    if (previous !== 0 && page - previous > 1) tokens.push("gap");
    tokens.push(page);
    previous = page;
  }
  return tokens;
}
