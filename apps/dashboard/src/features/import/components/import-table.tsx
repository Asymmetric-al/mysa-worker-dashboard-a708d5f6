"use client";
import type { ReactElement, ReactNode } from "react";
import { ScrollRegion } from "@/components/scroll-region";
import { Table, TableBody, TableCaption, TableHead, TableHeader, TableRow } from "@/components/ui/table";
/** Props of {@link ImportTable}. */ export type ImportTableProps = { readonly label: string; readonly headings: readonly string[]; readonly headingWidths?: readonly (string | undefined)[]; readonly fixed?: boolean; readonly busy?: boolean; readonly className?: string; readonly children: ReactNode };
/** One per-row table of the contact import: the scroll region, the caption, the column headings and the body, stated once for the three steps that show rows. A step that states column widths gets a fixed layout, so opening one row's material re-wraps that row rather than redistributing every column. */ export default function ImportTable({
  label,
  headings,
  headingWidths,
  fixed = false,
  busy = false,
  className,
  children,
}: ImportTableProps): ReactElement {
  return (
    <ScrollRegion label={label} className={className} aria-busy={busy ? true : undefined}>
      <Table className={fixed ? "table-fixed" : undefined}>
        <TableCaption className="sr-only">{label}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {headings.map((heading, index) => (
              <TableHead key={heading} scope="col" className={headingWidths?.[index]}>
                {heading}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </ScrollRegion>
  );
}
