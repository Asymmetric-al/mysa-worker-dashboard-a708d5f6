import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => <nav aria-label="pagination" data-slot="pagination" className={cn("mx-auto flex w-full justify-center", className)} {...props} />;
const PaginationContent = ({ className, ...props }: React.ComponentProps<"ul">) => <ul data-slot="pagination-content" className={cn("flex items-center gap-1", className)} {...props} />;
const PaginationItem = ({ ...props }: React.ComponentProps<"li">) => <li data-slot="pagination-item" {...props} />;
type PaginationLinkProps = { isActive?: boolean } & Pick<React.ComponentProps<typeof Button>, "size"> & React.ComponentProps<"a">;
const PaginationLink = ({ className, isActive, size = "icon", ...props }: PaginationLinkProps) => (
  <Button variant={isActive ? "outline" : "ghost"} size={size} className={cn(className)} nativeButton={false} render={<a aria-current={isActive ? "page" : undefined} data-slot="pagination-link" data-active={isActive} {...props} />} />
);
const PaginationPrevious = ({ className, text = "Previous", ...props }: React.ComponentProps<typeof PaginationLink> & { text?: string }) => (
  <PaginationLink aria-label="Go to previous page" size="default" className={cn("ps-2!", className)} {...props}>
    <ChevronLeftIcon className="rtl:rotate-180" data-icon="inline-start" />
    <span className="hidden sm:block">{text}</span>
  </PaginationLink>
);
const PaginationNext = ({ className, text = "Next", ...props }: React.ComponentProps<typeof PaginationLink> & { text?: string }) => (
  <PaginationLink aria-label="Go to next page" size="default" className={cn("pe-2!", className)} {...props}>
    <span className="hidden sm:block">{text}</span>
    <ChevronRightIcon className="rtl:rotate-180" data-icon="inline-end" />
  </PaginationLink>
);
const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span data-slot="pagination-ellipsis" className={cn("flex size-9 items-center justify-center [&_svg:not([class*='size-'])]:size-4", className)} {...props}>
    <MoreHorizontalIcon />
    <span className="sr-only">More pages</span>
  </span>
);
export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious };
