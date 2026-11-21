"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}
function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />;
}
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 hover:row-state-indicator has-aria-expanded:bg-muted/50 has-aria-expanded:row-state-indicator data-[state=selected]:bg-muted data-[state=selected]:row-state-indicator",
        className,
      )}
      {...props}
    />
  );
}
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  // A column header is the default this recipe serves; the attribute sits before the spread so a
  // caller marks a row header by passing `scope="row"` and wins.
  return (
    <th data-slot="table-head" scope="col" className={cn("h-12 px-3 text-start align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pe-0", className)} {...props} />
  );
}
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0", className)} {...props} />;
}
function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />;
}
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
