"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { cn } from "@/lib/cn";

/**
 * The rows-per-page choices of every list and report: 50 by default, 200 at most. A surface
 * that pages differently passes its own documented set through `pageSizeOptions` — the
 * coaching history lists page 25 with a 100 ceiling — because those are the values its own
 * read enforces, and this component must never offer a size the service would refuse.
 */
const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [50, 200];

/** The smallest and largest size of the default set, used when a caller supplies none. */
const SMALLEST_DEFAULT_PAGE_SIZE = 50;
const LARGEST_DEFAULT_PAGE_SIZE = 200;

/** How many page links are shown before the window collapses to first, last and neighbourhood. */
const PAGE_WINDOW_LIMIT = 7;

/**
 * Counts are grouped with one fixed locale rather than the reader's.
 *
 * The bar renders on the server and again in the browser, and an environment-derived format
 * would produce two different strings for the same page and trip hydration. Only fragment-free
 * integers are formatted here, so a fixed grouping is faithful; the words around the numbers —
 * the item noun and the copy — are the caller's, which is what keeps this file out of grammar
 * and out of translation decisions it cannot make.
 */
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** One node of the page window: a page number, or the mark left where a run of pages was skipped. */
type PageToken = number | "gap";

/** Props of {@link PaginationBar}. */
export interface PaginationBarProps {
  /**
   * The whole-result count the read reported for this query — never the number of rows in the
   * loaded page. It is the number the bar prints, so a filtered page can never be mistaken for
   * the complete result set.
   */
  total: number;
  /** The open page, 1-based. Clamped for display; the owner keeps the authoritative value. */
  page: number;
  /** The rows per page the read applied, which should be one of `pageSizeOptions`. */
  pageSize: number;
  /**
   * The sizes this surface may offer, smallest first after normalising. Defaults to 50 and 200;
   * the coaching history lists pass 25 and 100.
   */
  pageSizeOptions?: readonly number[];
  /** Called with the page the reader asked for, already clamped to a page that exists. */
  onPageChange: (page: number) => void;
  /** Called with the size the reader asked for, already clamped to an offered size. */
  onPageSizeChange: (size: number) => void;
  /**
   * The plural noun the surface counts, for example "partners". The caller inflects it: this
   * component states counts and never guesses grammar, and never inflects a noun that is not
   * English.
   */
  itemNoun: string;
  /** True while a read is in flight: every control goes inert and the busy state is announced once. */
  disabled?: boolean;
  /** Layout classes for the bar itself. Colour and spacing come from the token scale. */
  className?: string;
}

/**
 * The only paging control in the application.
 *
 * It is display-only. The service has already applied the page window over the whole authorised
 * result, and the bar prints the `total` it was given — it never counts, filters or slices rows
 * of its own, and every total on every surface therefore comes from the one read that produced
 * the page. `page` and `pageSize` are controlled by the owner's query state so filter context,
 * sort and the return from a detail survive a visit.
 *
 * Both change callbacks receive a clamped value: a request above the largest offered size
 * dispatches that maximum, and a page is clamped to `1..ceil(total / pageSize)`, so the control
 * can never display a page that does not exist and can never ask the service for one.
 *
 * Previous and next are rendered as `PaginationLink`s carrying a chevron whose glyph is chosen
 * for the writing direction (`ltr:`/`rtl:`), not the design system's `PaginationPrevious` and
 * `PaginationNext`: those two hard-code a left and a right chevron, so under `dir="rtl"` they
 * would point the wrong way, and mirroring them with a transform would mirror the meaning
 * rather than correct it. The page controls inherit the primitive's own semantics — a
 * non-native button, activated by Enter and Space — because these paging controls change the
 * query state of the list in place and never navigate, so they carry no `href` and promise no
 * destination. The item and content primitives, the active-page treatment and the ellipsis are
 * the design system's own.
 */
export function PaginationBar({
  total,
  page,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  itemNoun,
  disabled = false,
  className,
}: PaginationBarProps) {
  const pageSizeFieldId = useId();

  const totalCount = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const options = normalisePageSizeOptions(pageSizeOptions);
  const smallestPageSize = options[0] ?? SMALLEST_DEFAULT_PAGE_SIZE;
  const currentPageSize = clampPageSize(pageSize, options);
  const pageCount = pageCountFor(totalCount, currentPageSize);
  const currentPage = clampPage(page, pageCount);

  // One page at the smallest offered size has nothing to page, so the bar stays out of the way
  // and a twelve-partner roster carries no pager. An empty result still renders: "No partners"
  // is the one honest statement a zero-row list needs, and hiding it would leave the reader
  // unable to tell an empty result from a failed one.
  if (totalCount > 0 && pageCount === 1 && currentPageSize === smallestPageSize) {
    return null;
  }

  const firstRow = totalCount === 0 ? 0 : (currentPage - 1) * currentPageSize + 1;
  const lastRow = Math.min(currentPage * currentPageSize, totalCount);
  const countText =
    totalCount === 0
      ? `No ${itemNoun}`
      : `Showing ${countFormat.format(firstRow)}\u2013${countFormat.format(lastRow)} of ${countFormat.format(totalCount)} ${itemNoun}`;

  function requestPage(requested: number): void {
    if (disabled) {
      return;
    }
    const nextPage = clampPage(requested, pageCount);
    // A request for the page already open produces no change, so it dispatches nothing.
    if (nextPage === currentPage) {
      return;
    }
    onPageChange(nextPage);
  }

  function requestPageSize(requested: number): void {
    if (disabled) {
      return;
    }
    const nextPageSize = clampPageSize(requested, options);
    if (nextPageSize === currentPageSize) {
      return;
    }
    // Keep the reader on the row they were reading: the first visible row of the current window
    // stays visible under the new size, unless the new size pushes it past the end of the result,
    // in which case the page is clamped to the last one that exists.
    const firstVisibleRow = (currentPage - 1) * currentPageSize;
    const nextPage = clampPage(
      Math.trunc(firstVisibleRow / nextPageSize) + 1,
      pageCountFor(totalCount, nextPageSize),
    );
    onPageSizeChange(nextPageSize);
    if (nextPage !== currentPage) {
      onPageChange(nextPage);
    }
  }

  return (
    <div
      data-slot="pagination-bar"
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", className)}
    >
      {/* The live region is the visible count line itself — a native `output`, whose implicit
          status role announces politely — so a page or size change is announced once as the new
          range and never as a second message beside it. */}
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
            <NativeSelect
              id={pageSizeFieldId}
              size="sm"
              className="w-20"
              value={String(currentPageSize)}
              disabled={disabled}
              onChange={(event) => {
                requestPageSize(Number(event.currentTarget.value));
              }}
            >
              {options.map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {countFormat.format(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {pageCount > 1 ? (
          <Pagination
            aria-label={`Pagination, ${itemNoun}`}
            aria-busy={disabled || undefined}
            className="mx-0 w-auto"
          >
            {/* The page list wraps instead of overflowing: at 320 CSS px a full window of
                nine controls is wider than the surface, and reflow must never be paid for by a
                horizontally scrolling page. */}
            <PaginationContent className="flex-wrap justify-center">
              <PaginationItem>
                <PaginationLink
                  size="default"
                  className="ps-2.5"
                  aria-label={`Previous page of ${itemNoun}`}
                  aria-disabled={currentPage === 1 || disabled || undefined}
                  onClick={() => {
                    requestPage(currentPage - 1);
                  }}
                >
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
                    <PaginationLink
                      isActive={token === currentPage}
                      aria-label={`Page ${countFormat.format(token)} of ${countFormat.format(pageCount)}`}
                      aria-disabled={disabled || undefined}
                      onClick={() => {
                        requestPage(token);
                      }}
                    >
                      {countFormat.format(token)}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}

              <PaginationItem>
                <PaginationLink
                  size="default"
                  className="pe-2.5"
                  aria-label={`Next page of ${itemNoun}`}
                  aria-disabled={currentPage === pageCount || disabled || undefined}
                  onClick={() => {
                    requestPage(currentPage + 1);
                  }}
                >
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

/**
 * A chevron that points the way its control moves in the reader's own writing direction.
 *
 * Two glyphs are declared and exactly one of them is shown, chosen by the `ltr:`/`rtl:`
 * variants: mirroring a single glyph with a scale transform would show a mirrored arrow instead
 * of the direction-aware icon the design calls for. The geometry is stroke-only and inherits
 * `currentColor`, so the icon takes the link's own tone in either theme.
 */
function DirectionalChevron({ direction }: { direction: "previous" | "next" }) {
  const pointsLeft = direction === "previous";
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      data-icon={pointsLeft ? "inline-start" : "inline-end"}
    >
      <path d={pointsLeft ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} className="rtl:hidden" />
      <path d={pointsLeft ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"} className="hidden rtl:block" />
    </svg>
  );
}

/**
 * The offered sizes, smallest first and without duplicates.
 *
 * A caller's list decides which sizes this surface may offer, so a malformed entry is dropped
 * rather than printed, and a list with nothing usable falls back to the documented default set
 * instead of leaving the control empty.
 */
function normalisePageSizeOptions(options: readonly number[] | undefined): number[] {
  const source = options ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const usable = source.filter((size) => Number.isInteger(size) && size > 0);
  const unique = [...new Set(usable)].sort((left, right) => left - right);
  return unique.length > 0 ? unique : [...DEFAULT_PAGE_SIZE_OPTIONS];
}

/**
 * The size to display and act on for a requested value.
 *
 * A value above the largest offered size becomes that maximum — a programmatic request for
 * 1,000 on a 200-cap list dispatches 200 — and a value below the smallest becomes the smallest.
 * A value inside the range that is not one of the offered sizes takes the largest offered size
 * that does not exceed it, so the select always displays a size it can actually offer and the
 * page arithmetic matches what the reader sees.
 */
function clampPageSize(requested: number, options: readonly number[]): number {
  const smallest = options[0] ?? SMALLEST_DEFAULT_PAGE_SIZE;
  const largest = options[options.length - 1] ?? LARGEST_DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(requested)) {
    return smallest;
  }
  const size = Math.trunc(requested);
  if (size <= smallest) {
    return smallest;
  }
  if (size >= largest) {
    return largest;
  }
  let offered = smallest;
  for (const option of options) {
    if (option <= size) {
      offered = option;
    }
  }
  return offered;
}

/** The number of pages a whole-result count spans at a size; a result always has at least one. */
function pageCountFor(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The page to display and act on: a page that exists, so `1..pageCount` inclusive. */
function clampPage(requested: number, pageCount: number): number {
  if (!Number.isFinite(requested)) {
    return 1;
  }
  const page = Math.trunc(requested);
  if (page <= 1) {
    return 1;
  }
  return page >= pageCount ? pageCount : page;
}

/**
 * The pages to render for a result of `pageCount` pages with `current` open: every page while
 * they all fit, otherwise the first, the last and the current page's neighbourhood with a single
 * mark for each skipped run — so the control keeps a stable width on a 2,000-page result without
 * ever hiding where the reader is.
 */
function pageWindow(current: number, pageCount: number): PageToken[] {
  const tokens: PageToken[] = [];
  if (pageCount <= PAGE_WINDOW_LIMIT) {
    for (let page = 1; page <= pageCount; page += 1) {
      tokens.push(page);
    }
    return tokens;
  }
  const candidates = [...new Set([1, pageCount, current - 1, current, current + 1])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
  let previous = 0;
  for (const page of candidates) {
    if (previous !== 0 && page - previous > 1) {
      tokens.push("gap");
    }
    tokens.push(page);
    previous = page;
  }
  return tokens;
}

export default PaginationBar;
