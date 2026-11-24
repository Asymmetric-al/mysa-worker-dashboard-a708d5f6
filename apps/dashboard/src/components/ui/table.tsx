"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
const Table = ({ className, ...props }: React.ComponentProps<"table">) => <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />;
const TableHeader = ({ className, ...props }: React.ComponentProps<"thead">) => <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
const TableBody = ({ className, ...props }: React.ComponentProps<"tbody">) => <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
const TableFooter = ({ className, ...props }: React.ComponentProps<"tfoot">) => <tfoot data-slot="table-footer" className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />;
const TableRow = ({ className, ...props }: React.ComponentProps<"tr">) => (
  <tr data-slot="table-row" className={cn("border-b transition-colors hover:bg-muted/50 hover:row-state-indicator has-aria-expanded:bg-muted/50 has-aria-expanded:row-state-indicator data-[state=selected]:bg-muted data-[state=selected]:row-state-indicator", className)} {...props} />
);
const TableHead = ({ className, ...props }: React.ComponentProps<"th">) => <th data-slot="table-head" scope="col" className={cn("h-12 px-3 text-start align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pe-0", className)} {...props} />;
const TableCell = ({ className, ...props }: React.ComponentProps<"td">) => <td data-slot="table-cell" className={cn("p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0", className)} {...props} />;
const TableCaption = ({ className, ...props }: React.ComponentProps<"caption">) => <caption data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />;
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
