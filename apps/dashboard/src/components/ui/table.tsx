"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
const Table = ({ className, ...props }: React.ComponentProps<"table">) => <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />;
const TableHeader = ({ className, ...props }: React.ComponentProps<"thead">) => <thead data-slot="table-header" className={cn("bg-surface-subtle [&_tr]:border-b [&_tr]:border-border/80", className)} {...props} />;
const TableBody = ({ className, ...props }: React.ComponentProps<"tbody">) => <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
const TableFooter = ({ className, ...props }: React.ComponentProps<"tfoot">) => <tfoot data-slot="table-footer" className={cn("border-t bg-surface-subtle font-medium [&>tr]:last:border-b-0", className)} {...props} />;
const TableRow = ({ className, ...props }: React.ComponentProps<"tr">) => (
  <tr data-slot="table-row" className={cn("border-b border-border/70 transition-colors hover:bg-muted/45 hover:row-state-indicator has-aria-expanded:bg-muted/45 has-aria-expanded:row-state-indicator data-[state=selected]:bg-muted/70 data-[state=selected]:row-state-indicator", className)} {...props} />
);
const TableHead = ({ className, ...props }: React.ComponentProps<"th">) => (
  <th data-slot="table-head" scope="col" className={cn("h-11 px-3.5 text-start align-middle text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground group-data-[density=dense]/data-grid:h-9 group-data-[density=dense]/data-grid:px-3 [&:has([role=checkbox])]:pe-0", className)} {...props} />
);
const TableCell = ({ className, ...props }: React.ComponentProps<"td">) => <td data-slot="table-cell" className={cn("px-3.5 py-3 align-middle whitespace-nowrap group-data-[density=dense]/data-grid:px-3 group-data-[density=dense]/data-grid:py-2 [&:has([role=checkbox])]:pe-0", className)} {...props} />;
const TableCaption = ({ className, ...props }: React.ComponentProps<"caption">) => <caption data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />;
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
