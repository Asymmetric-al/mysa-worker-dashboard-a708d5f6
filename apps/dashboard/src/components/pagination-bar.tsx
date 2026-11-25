"use client";
import { useId } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { Pagination, PaginationEllipsis, PaginationItem, PaginationLink, PaginationList, PaginationNext, PaginationPrevious, paginationRange } from "@/lib/ui-sdk";
const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [50, 200];
const SMALLEST_DEFAULT_PAGE_SIZE = 50;
const LARGEST_DEFAULT_PAGE_SIZE = 200;
/** Props of {@link PaginationBar}. */ export type PaginationBarProps = {
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  itemNoun: string;
  disabled?: boolean;
  className?: string;
  /** The interface locale this pager groups its counts in, stated by the route that composes it; left off, the application default interface locale applies. */ readonly locale?: string;
};
/** The only paging control in the application, backed by UI SDK `Pagination` primitives for focus retention and ARIA semantics. */ export function PaginationBar({ total, page, pageSize, pageSizeOptions, onPageChange, onPageSizeChange, itemNoun, disabled = false, className, locale }: PaginationBarProps) {
  const pageSizeFieldId = useId();
  const formatCount = countFormatOf(locale); // One formatter for this render, in the interface locale the composing route states.
  const totalCount = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const options = normalisePageSizeOptions(pageSizeOptions);
  const currentPageSize = clampPageSize(pageSize, options);
  const pageCount = pageCountFor(totalCount, currentPageSize);
  const currentPage = clampPage(page, pageCount);
  const rangeItems = paginationRange({ page: currentPage, pageCount, siblings: 1, boundaries: 1 });
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
    const nextPage = clampPage(Math.trunc(((currentPage - 1) * currentPageSize) / nextPageSize) + 1, pageCountFor(totalCount, nextPageSize));
    onPageSizeChange(nextPageSize);
    if (nextPage !== currentPage) onPageChange(nextPage);
  }
  return (
    <div data-slot="pagination-bar" className={cn("flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3", className)}>
      <output className="tabular-figures text-sm text-muted-foreground">
        {totalCount === 0 ? `Showing 0 of 0 ${itemNoun}` : `Showing ${formatCount.format(totalCount === 0 ? 0 : (currentPage - 1) * currentPageSize + 1)}\u2013${formatCount.format(Math.min(currentPage * currentPageSize, totalCount))} of ${formatCount.format(totalCount)} ${itemNoun}`}
        {disabled ? <span className="sr-only"> Updating results.</span> : null}
      </output>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={pageSizeFieldId} className="text-muted-foreground">
            Rows per page
          </Label>
          <NativeSelect id={pageSizeFieldId} size="sm" className="w-auto min-w-20" value={String(currentPageSize)} disabled={disabled} onChange={(event) => requestPageSize(Number(event.currentTarget.value))}>
            {options.map((option) => (
              <NativeSelectOption key={option} value={String(option)}>
                {formatCount.format(option)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {pageCount > 1 ? (
          <Pagination page={currentPage} pageCount={pageCount} siblings={1} boundaries={1} disabled={disabled} onPageChange={(next) => requestPage(next)} aria-label={`Pagination, ${itemNoun}`} aria-busy={disabled || undefined} className="mx-0 w-auto">
            <PaginationList className="flex flex-wrap items-center justify-center gap-1">
              <PaginationItem>
                <PaginationPrevious aria-label={`Previous page of ${itemNoun}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-8 ps-2.5 pe-3 text-muted-foreground hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-45")}>
                  <DirectionalChevron direction="previous" />
                  <span className="hidden sm:inline">Previous</span>
                </PaginationPrevious>
              </PaginationItem>
              {rangeItems.map((token) =>
                typeof token === "string" ? (
                  <PaginationItem key={token}>
                    <PaginationEllipsis className="flex size-8 items-center justify-center text-muted-foreground">
                      <MoreHorizontalIcon aria-hidden="true" className="size-4" />
                    </PaginationEllipsis>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={token}>
                    <PaginationLink
                      page={token}
                      aria-label={`Page ${formatCount.format(token)} of ${formatCount.format(pageCount)}`}
                      className={cn(
                        buttonVariants({ variant: token === currentPage ? "outline" : "ghost", size: "sm" }),
                        "min-h-8 min-w-8 px-2.5 tabular-figures aria-disabled:pointer-events-none aria-disabled:opacity-45",
                        token === currentPage ? "border-border bg-card font-semibold text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {formatCount.format(token)}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext aria-label={`Next page of ${itemNoun}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-8 ps-3 pe-2.5 text-muted-foreground hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-45")}>
                  <span className="hidden sm:inline">Next</span>
                  <DirectionalChevron direction="next" />
                </PaginationNext>
              </PaginationItem>
            </PaginationList>
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
  const usable = (options ?? DEFAULT_PAGE_SIZE_OPTIONS).filter((size) => Number.isInteger(size) && size > 0);
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
const pageCountFor = (total: number, pageSize: number): number => (total <= 0 || pageSize <= 0 ? 1 : Math.max(1, Math.ceil(total / pageSize)));
function clampPage(requested: number, pageCount: number): number {
  if (!Number.isFinite(requested)) return 1;
  const page = Math.trunc(requested);
  return page <= 1 ? 1 : page >= pageCount ? pageCount : page;
}
