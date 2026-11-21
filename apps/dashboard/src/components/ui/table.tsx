"use client"

import * as React from "react"
import { cn } from "@/lib/cn"

/*
 * The styled table recipe and nothing else: these parts render what they are given and
 * compute nothing. Sorting, filtering, paging, selection and column visibility belong to
 * `components/record-list`, and every financial value arrives already computed by the
 * report function, so the same query shows the same numbers everywhere.
 *
 * `Table` renders the `<table>` element itself, without a scroll container of its own.
 * The application has exactly one horizontal scroll port — `components/scroll-region`,
 * which is focusable and carries the region's accessible name — and a second
 * `overflow-x-auto` here would take the scrolling away from it: the labelled region would
 * never move, the element that did move would be unlabelled and unreachable by keyboard,
 * and the table's own box would scroll instead of the region the worker was told about
 * (WCAG 1.4.10, 2.4.11, 2.5.7). Callers wrap the table in that region.
 *
 * The two directional utilities are logical (`text-start`, `pe-0`) rather than physical so
 * an Arabic or Hebrew table aligns its headers with its cells; in a left-to-right surface
 * they render exactly the registry's `text-left` and `pr-0`.
 */

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 hover:row-state-indicator has-aria-expanded:bg-muted/50 has-aria-expanded:row-state-indicator data-[state=selected]:bg-muted data-[state=selected]:row-state-indicator",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  // A column header is the default this recipe serves; the attribute sits before the spread so a
  // caller marks a row header by passing `scope="row"` and wins.
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        "h-12 px-3 text-start align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pe-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
