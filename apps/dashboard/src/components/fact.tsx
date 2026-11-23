"use client";
import type { ReactElement, ReactNode } from "react";
export type FactProps = { readonly term: ReactNode; readonly children: ReactNode; readonly termClassName?: string; readonly detailClassName?: string };
/** One term and its value in a definition list: the one frame a reviewed fact, a stated range and a plan row are each written in. */
export function Fact({ term, children, termClassName = "font-medium text-foreground", detailClassName = "min-w-0" }: FactProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={termClassName}>{term}</dt>
      <dd className={detailClassName}>{children}</dd>
    </div>
  );
}
export default Fact;
